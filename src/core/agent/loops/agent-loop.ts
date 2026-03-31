/**
 * Generic agent loop runner — shared iteration pattern for all three modes.
 *
 * Usage: create LoopCallbacks (with TaskRunner's action executors),
 * then call runAgentLoop.
 */

import type { Task, TaskAction, TaskStep } from '../../../types';
import type { ProviderId } from '../../../types';
import type { VisionMessage } from '../../../types';
import { type ParserState, parseModelResponse } from '../action-parser';
import { computeBudget } from '../context-budget';
import { formatError } from '../errors';
import { compressHistory, drainInbox, summarizeHistory, truncateHistory } from '../history-manager';
import type { TaskManager } from '../task-manager';
import { callVision } from '../vision-dispatch';

export type LoopCallbacks = {
  taskManager: TaskManager | null;
  buildTurnMessage(
    stepIndex: number,
    budget?: { applyLevel1: boolean }
  ): Promise<{ text: string; images?: string[] }> | { text: string; images?: string[] };
  executeAction?(action: TaskAction): Promise<string | undefined>;
  recordStep(step: TaskStep): void;
  pushStatus(msg: string): void;
  isAborted(): boolean;
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

    if (history.length > 20) {
      truncateHistory(history, 19);
    } else {
      compressHistory(history, 6);
    }

    // Level 3: LLM-driven summarization when context pressure is critical
    if (budget.applyLevel3) {
      try {
        await summarizeHistory(history, provider, task.id);
      } catch {
        // Non-critical: L3 failure doesn't break the loop
      }
    }

    history.push(turnMessage);

    callbacks.pushStatus('Thinking...');

    if (callbacks.isAborted()) {
      return finish(task, 'cancelled', callbacks, task.error);
    }

    // Level 2: switch to compact system prompt when context pressure is high
    const activeSystemPrompt = systemPromptCompact && budget.applyLevel2 ? systemPromptCompact : systemPrompt;

    let rawResponse: string;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    try {
      const result = await callVision(provider, activeSystemPrompt, history, task.id, openaiModel);
      rawResponse = result.text;
      usage = result.usage;
    } catch (e) {
      if (callbacks.isAborted()) {
        return finish(task, 'cancelled', callbacks, task.error);
      }
      const rawError = e instanceof Error ? e.message : String(e);
      const formatted = formatError(rawError);
      return finish(task, 'failed', callbacks, `[${formatted.code}] ${formatted.userMessage}`);
    }

    if (callbacks.isAborted()) {
      return finish(task, 'cancelled', callbacks, task.error);
    }

    if (usage) {
      if (!task.usage) task.usage = { inputTokens: 0, outputTokens: 0 };
      task.usage.inputTokens += usage.inputTokens;
      task.usage.outputTokens += usage.outputTokens;
      lastReportedInputTokens = usage.inputTokens;
    }

    history.push({ role: 'assistant', content: [{ type: 'output_text', text: rawResponse }] });

    const { thought, action } = parseModelResponse(rawResponse, parserState);

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
      task.summary = action.summary;
      task.steps.push(step);
      callbacks.recordStep(step);
      return finish(task, 'completed', callbacks);
    }
    if (action.type === 'fail') {
      task.steps.push(step);
      callbacks.recordStep(step);
      return finish(task, 'failed', callbacks, action.reason);
    }

    let stepResult: string | undefined;
    let stepError: string | undefined;
    try {
      if (callbacks.isAborted()) {
        return finish(task, 'cancelled', callbacks, task.error);
      }
      stepResult = await callbacks.executeAction!(action);
    } catch (e) {
      const rawError = e instanceof Error ? e.message : String(e);
      const formatted = formatError(rawError);
      stepError = formatted.userMessage;
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
