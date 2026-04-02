/**
 * Generic agent loop runner — shared iteration pattern for all three modes.
 *
 * Usage: create LoopCallbacks (with TaskRunner's action executors),
 * then call runAgentLoop.
 *
 * Supports two execution modes:
 * - Streaming (default): vision → detect JSON → execute (real-time thinking)
 * - Blocking (fallback): vision → parse → execute (original behavior)
 */

import type { Task, TaskAction, TaskStep } from '../../../types';
import type { ProviderId } from '../../../types';
import type { VisionMessage } from '../../../types';
import { childLogger } from '../../logger';
import { type ParserState, parseModelResponse } from '../action-parser';
import { attemptRecovery, autoCompact, isContextLengthError, snipHistory } from '../compaction';
import { computeBudget } from '../context-budget';
import { formatError } from '../errors';
import { compressHistory, drainInbox, summarizeHistory, truncateHistory } from '../history-manager';
import { runStreamingTurn } from '../streaming/streaming-loop';
import type { TaskManager } from '../task-manager';
import { callVision } from '../vision-dispatch';

function isStreamingEnabled() {
  return process.env.SKYNUL_STREAMING === 'true';
}

export type LoopCallbacks = {
  taskManager: TaskManager | null;
  buildTurnMessage(
    stepIndex: number,
    budget?: { applyLevel1: boolean }
  ): Promise<{ text: string; images?: string[] }> | { text: string; images?: string[] };
  executeAction?(action: TaskAction): Promise<string | undefined>;
  recordStep(step: TaskStep): void;
  pushStatus(msg: string): void;
  /** Called during streaming with partial thinking text. Optional — no-op if omitted. */
  pushThinking?(taskId: string, stepIndex: number, partial: string): void;
  isAborted(): boolean;
  /** If set, only these action types are allowed. Empty/undefined = all allowed. */
  allowedTools?: string[];
};

export async function runAgentLoop(
  systemPrompt: string,
  history: VisionMessage[],
  maxSteps: number,
  task: Task,
  provider: ProviderId,
  openaiModel: string,
  callbacks: LoopCallbacks,
  contextWindowOverride?: number,
  systemPromptCompact?: string
): Promise<Task> {
  const log = childLogger({ taskId: task.id, provider });
  const parserState: ParserState = { consecutiveTruncations: 0 };

  // Track last reported input tokens for accurate budget when provider supports it
  let lastReportedInputTokens: number | undefined;

  while (task.steps.length < maxSteps && !callbacks.isAborted()) {
    const stepIndex = task.steps.length;

    // Compute context budget before building the turn (uses current history)
    const budget = computeBudget(
      systemPrompt,
      history,
      provider,
      openaiModel,
      contextWindowOverride,
      lastReportedInputTokens
    );

    let turnText: string;
    let images: string[] | undefined;
    try {
      const turn = await callbacks.buildTurnMessage(stepIndex, budget);
      turnText = turn.text;
      images = turn.images;
    } catch (e) {
      return finish(task, 'failed', callbacks, `Turn message error: ${e instanceof Error ? e.message : String(e)}`);
    }

    const inboxBlock = drainInbox(callbacks.taskManager, task.id);
    // Level 1: reduce screenshot count when context is getting full
    const maxImages = budget.applyLevel1 ? 2 : 4;
    const turnMessage: VisionMessage = {
      role: 'user',
      content: [
        { type: 'input_text' as const, text: turnText + inboxBlock },
        ...(images
          ? images.slice(0, maxImages).map((url) => ({
              type: 'input_image' as const,
              detail: 'auto' as const,
              image_url: url,
            }))
          : []),
      ],
    };

    // Layer 2: Snip compaction — remove oldest messages when context exceeds threshold
    if (budget.applyLevel2 || budget.applyLevel3) {
      const snipResult = snipHistory(history, budget.usedTokens, budget.maxTokens);
      if (snipResult.snipped) {
        log.info(
          {
            step: stepIndex,
            removed: snipResult.removedCount,
            tokensBefore: snipResult.tokensBefore,
            tokensAfter: snipResult.tokensAfter,
          },
          'Snip compaction applied'
        );

        // Re-inject file references if any were found
        if (snipResult.fileReferences.length > 0) {
          const reinjectMsg = {
            role: 'user' as const,
            content: [
              {
                type: 'input_text' as const,
                text: `[PRESERVED CONTEXT]\nFiles referenced in removed conversation:\n${snipResult.fileReferences
                  .slice(0, 10)
                  .map((r) => `- ${r}`)
                  .join('\n')}\n[/PRESERVED CONTEXT]`,
              },
            ],
          };
          history.splice(history.length - 1, 0, reinjectMsg);
        }
      }
    }

    // Layer 3: Auto-compact — LLM-driven summarization when context pressure is critical
    if (budget.applyLevel3) {
      try {
        const compactResult = await autoCompact(history, budget.usedTokens, budget.maxTokens, provider, task.id);
        if (compactResult.compacted) {
          log.info(
            {
              step: stepIndex,
              removed: compactResult.removedCount,
              tokensSaved: compactResult.tokensBefore - compactResult.tokensAfter,
            },
            'Auto-compact applied'
          );
        }
      } catch (compactError) {
        log.warn({ step: stepIndex, error: compactError }, 'Auto-compact failed');
      }
    }

    // Legacy compaction (kept as fallback)
    if (history.length > 20) {
      truncateHistory(history, 19);
    } else {
      compressHistory(history, 6);
    }

    history.push(turnMessage);

    callbacks.pushStatus('Thinking...');

    if (callbacks.isAborted()) {
      return finish(task, 'cancelled', callbacks, task.error);
    }

    // Level 2: switch to compact system prompt when context pressure is high
    const activeSystemPrompt = systemPromptCompact && budget.applyLevel2 ? systemPromptCompact : systemPrompt;

    // ── Execute turn: streaming or blocking ────────────────────────────

    let rawResponse: string;
    let thought: string | undefined;
    let action: TaskAction;
    let stepResult: string | undefined;
    let stepError: string | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    if (isStreamingEnabled() && callbacks.executeAction) {
      // Streaming path: vision → detect JSON → execute (real-time)
      // Wrap executeAction with allowedTools check
      const safeExecuteAction = async (a: TaskAction): Promise<string | undefined> => {
        if (callbacks.allowedTools && callbacks.allowedTools.length > 0 && !callbacks.allowedTools.includes(a.type)) {
          throw new Error(
            `Action "${a.type}" is not allowed for this agent. Allowed: ${callbacks.allowedTools.join(', ')}`
          );
        }
        return callbacks.executeAction!(a);
      };

      const turn = await runStreamingTurn(
        provider,
        activeSystemPrompt,
        history,
        task.id,
        openaiModel,
        safeExecuteAction,
        {
          onThinking: (partial) => callbacks.pushThinking?.(task.id, stepIndex, partial),
          onDelta: () => {
            // Delta received — status already shows "Thinking..."
          },
        }
      );

      rawResponse = turn.rawResponse;
      thought = turn.thought;
      action = turn.action;
      stepResult = turn.result;
      stepError = turn.error;
      usage = turn.usage;
    } else {
      // Blocking path: original behavior (vision → parse → execute)
      log.debug({ step: stepIndex }, 'Vision call start');
      try {
        const result = await callVision(provider, activeSystemPrompt, history, task.id, openaiModel);
        rawResponse = result.text;
        usage = result.usage;
        log.debug({ step: stepIndex, duration: undefined }, 'Vision call complete');
      } catch (e) {
        if (callbacks.isAborted()) {
          return finish(task, 'cancelled', callbacks, task.error);
        }
        const rawError = e instanceof Error ? e.message : String(e);

        // Reactive 413 recovery: try compaction strategies
        if (isContextLengthError(e)) {
          log.warn({ step: stepIndex, error: rawError }, 'Context length error detected, attempting recovery');
          callbacks.pushStatus('Compacting context...');

          const recovery = await attemptRecovery(
            e,
            history,
            budget.usedTokens,
            budget.maxTokens,
            provider,
            openaiModel,
            task.id
          );

          if (recovery.recovered) {
            log.info({ step: stepIndex, attempts: recovery.attempts.length }, 'Context recovery successful, retrying');
            // Retry the vision call with compacted history
            try {
              const result = await callVision(
                provider,
                activeSystemPrompt,
                history,
                task.id,
                recovery.fallbackModel || openaiModel
              );
              rawResponse = result.text;
              usage = result.usage;
            } catch (retryError) {
              const retryRawError = retryError instanceof Error ? retryError.message : String(retryError);
              const formatted = formatError(retryRawError);
              return finish(
                task,
                'failed',
                callbacks,
                `Context recovery failed: [${formatted.code}] ${formatted.userMessage}`
              );
            }
          } else {
            const formatted = formatError(rawError);
            return finish(
              task,
              'failed',
              callbacks,
              `[${formatted.code}] ${formatted.userMessage}\n\nRecovery attempts failed after ${recovery.attempts.length} strategies.`
            );
          }
        } else {
          const formatted = formatError(rawError);
          return finish(task, 'failed', callbacks, `[${formatted.code}] ${formatted.userMessage}`);
        }
      }

      if (callbacks.isAborted()) {
        return finish(task, 'cancelled', callbacks, task.error);
      }

      const parsed = parseModelResponse(rawResponse, parserState);
      thought = parsed.thought;
      action = parsed.action;

      if (action.type !== 'done' && action.type !== 'fail') {
        try {
          if (callbacks.isAborted()) {
            return finish(task, 'cancelled', callbacks, task.error);
          }
          // Check allowedTools restriction from agent definition
          if (
            callbacks.allowedTools &&
            callbacks.allowedTools.length > 0 &&
            !callbacks.allowedTools.includes(action.type)
          ) {
            stepError = `Action "${action.type}" is not allowed for this agent. Allowed: ${callbacks.allowedTools.join(', ')}`;
          } else {
            stepResult = await callbacks.executeAction!(action);
            log.debug({ step: stepIndex, action: action.type }, 'Action executed');
          }
        } catch (e) {
          const rawError = e instanceof Error ? e.message : String(e);
          const formatted = formatError(rawError);
          stepError = formatted.userMessage;
          log.warn({ step: stepIndex, action: action.type, err: rawError }, 'Action failed');
        }

        if (callbacks.isAborted()) {
          return finish(task, 'cancelled', callbacks, task.error);
        }
      }
    }

    // ── Record usage ───────────────────────────────────────────────────

    if (usage) {
      if (!task.usage) task.usage = { inputTokens: 0, outputTokens: 0 };
      task.usage.inputTokens += usage.inputTokens;
      task.usage.outputTokens += usage.outputTokens;
      lastReportedInputTokens = usage.inputTokens;
    }

    history.push({ role: 'assistant', content: [{ type: 'output_text', text: rawResponse }] });

    // ── Build step ─────────────────────────────────────────────────────

    const step: TaskStep = {
      index: task.steps.length,
      timestamp: Date.now(),
      screenshotBase64: '',
      action,
      thought,
      contextPct: budget.contextPct,
      contextTokens: {
        used: budget.usedTokens,
        max: budget.maxTokens,
        estimated: budget.estimated,
      },
    };

    if (action.type === 'done') {
      log.info({ step: stepIndex, tokens: usage }, 'Task completed');
      task.summary = action.summary;
      task.steps.push(step);
      callbacks.recordStep(step);
      return finish(task, 'completed', callbacks);
    }
    if (action.type === 'fail') {
      log.warn({ step: stepIndex, reason: action.reason }, 'Task failed');
      task.steps.push(step);
      callbacks.recordStep(step);
      return finish(task, 'failed', callbacks, action.reason);
    }

    if (callbacks.isAborted()) {
      return finish(task, 'cancelled', callbacks, task.error);
    }

    step.result = stepResult;
    step.error = stepError;
    task.steps.push(step);
    callbacks.recordStep(step);

    // monitor_position hands off to system-level monitoring — exit the agent loop
    if (action.type === 'monitor_position' && task.status === 'monitoring') {
      return task;
    }
  }

  if (callbacks.isAborted()) return finish(task, 'cancelled', callbacks);
  return finish(task, 'failed', callbacks, `Reached max steps (${maxSteps})`);
}

function finish(
  task: Task,
  status: 'completed' | 'failed' | 'cancelled',
  callbacks: LoopCallbacks,
  error?: string
): Task {
  task.status = status;
  if (error) task.error = error;
  task.updatedAt = Date.now();
  callbacks.recordStep({
    index: task.steps.length,
    timestamp: Date.now(),
    screenshotBase64: '',
    action: { type: 'done' } as TaskAction,
  });
  return task;
}
