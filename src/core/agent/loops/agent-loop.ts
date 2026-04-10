/**
 * Generic agent loop runner — shared iteration pattern for all three modes.
 *
 * Usage: create LoopCallbacks (with TaskRunner's action executors),
 * then call runAgentLoop.
 */

import type { ProviderId, Task, TaskAction, TaskStep, VisionMessage } from '../../../types';
import { callVision } from '../../providers/vision-dispatch';
import { type ParserState, parseModelResponse } from '../action-parser';
import { computeBudget } from '../context-budget';
import { formatError } from '../errors';
import { compressHistory, drainInbox, summarizeHistory, truncateHistory } from '../history-manager';
import type { TaskManager } from '../task-manager';

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

type LoopContext = {
  systemPrompt: string;
  systemPromptCompact?: string;
  history: VisionMessage[];
  task: Task;
  provider: ProviderId;
  model: string;
  callbacks: LoopCallbacks;
  contextWindowOverride?: number;
  parserState: ParserState;
  lastReportedInputTokens?: number;
};

async function buildTurn(ctx: LoopContext, stepIndex: number): Promise<VisionMessage | null> {
  const { systemPrompt, history, task, provider, model, callbacks, contextWindowOverride } = ctx;
  const budget = computeBudget(
    systemPrompt,
    history,
    provider,
    model,
    contextWindowOverride,
    ctx.lastReportedInputTokens
  );

  let turnText: string;
  let images: string[] | undefined;
  try {
    const turn = await callbacks.buildTurnMessage(stepIndex, budget);
    turnText = turn.text;
    images = turn.images;
  } catch (e) {
    finish(task, 'failed', callbacks, `Turn message error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  const inboxBlock = drainInbox(callbacks.taskManager, task.id);
  const maxImages = budget.applyLevel1 ? 2 : 4;
  const turnMessage: VisionMessage = {
    role: 'user',
    content: [
      { type: 'input_text' as const, text: turnText + inboxBlock },
      ...(images
        ? images
            .slice(0, maxImages)
            .map((url) => ({ type: 'input_image' as const, detail: 'auto' as const, image_url: url }))
        : []),
    ],
  };

  if (history.length > 20) truncateHistory(history, 19);
  else compressHistory(history, 6);

  if (budget.applyLevel3) {
    try {
      await summarizeHistory(history, provider, task.id);
    } catch {
      /* non-critical */
    }
  }

  history.push(turnMessage);
  return turnMessage;
}

async function callLLM(
  ctx: LoopContext
): Promise<{ rawResponse: string; usage?: { inputTokens: number; outputTokens: number } } | null> {
  const { systemPrompt, systemPromptCompact, history, task, provider, model, callbacks } = ctx;
  const budget = computeBudget(
    systemPrompt,
    history,
    provider,
    model,
    ctx.contextWindowOverride,
    ctx.lastReportedInputTokens
  );
  const activeSystemPrompt = systemPromptCompact && budget.applyLevel2 ? systemPromptCompact : systemPrompt;

  try {
    const result = await callVision(provider, activeSystemPrompt, history, task.id, model);
    return { rawResponse: result.text, usage: result.usage };
  } catch (e) {
    if (callbacks.isAborted()) {
      finish(task, 'cancelled', callbacks, task.error);
      return null;
    }
    const formatted = formatError(e instanceof Error ? e.message : String(e));
    finish(task, 'failed', callbacks, `[${formatted.code}] ${formatted.userMessage}`);
    return null;
  }
}

async function executeStep(ctx: LoopContext, action: TaskAction): Promise<{ result?: string; error?: string }> {
  const { task, callbacks } = ctx;
  if (callbacks.isAborted()) {
    finish(task, 'cancelled', callbacks, task.error);
    return {};
  }
  try {
    const result = await callbacks.executeAction?.(action);
    return { result };
  } catch (e) {
    const formatted = formatError(e instanceof Error ? e.message : String(e));
    return { error: formatted.userMessage };
  }
}

function accumulateUsage(task: Task, ctx: LoopContext, usage: { inputTokens: number; outputTokens: number }): void {
  if (!task.usage) task.usage = { inputTokens: 0, outputTokens: 0 };
  task.usage.inputTokens += usage.inputTokens;
  task.usage.outputTokens += usage.outputTokens;
  ctx.lastReportedInputTokens = usage.inputTokens;
}

async function processLoopStep(ctx: LoopContext, stepIndex: number): Promise<Task | null> {
  const { task, callbacks, history, systemPrompt, provider, model, contextWindowOverride } = ctx;
  await buildTurn(ctx, stepIndex);
  if (task.status === 'failed') return task;
  callbacks.pushStatus('Thinking...');
  if (callbacks.isAborted()) return finish(task, 'cancelled', callbacks, task.error);

  const llmResult = await callLLM(ctx);
  if (!llmResult) return task;
  if (callbacks.isAborted()) return finish(task, 'cancelled', callbacks, task.error);

  if (llmResult.usage) accumulateUsage(task, ctx, llmResult.usage);

  history.push({ role: 'assistant', content: [{ type: 'output_text', text: llmResult.rawResponse }] });
  const budget = computeBudget(
    systemPrompt,
    history,
    provider,
    model,
    contextWindowOverride,
    ctx.lastReportedInputTokens
  );
  const { thought, action } = parseModelResponse(llmResult.rawResponse, ctx.parserState);
  const step: TaskStep = {
    index: task.steps.length,
    timestamp: Date.now(),
    screenshotBase64: '',
    action,
    thought,
    contextPct: budget.contextPct,
    contextTokens: { used: budget.usedTokens, max: budget.maxTokens, estimated: budget.estimated },
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

  const { result: stepResult, error: stepError } = await executeStep(ctx, action);
  if (callbacks.isAborted()) return finish(task, 'cancelled', callbacks, task.error);

  step.result = stepResult;
  step.error = stepError;
  task.steps.push(step);
  callbacks.recordStep(step);

  if (action.type === 'monitor_position' && task.status === 'monitoring') return task;
  return null;
}

export async function runAgentLoop(
  systemPrompt: string,
  history: VisionMessage[],
  maxSteps: number,
  task: Task,
  provider: ProviderId,
  model: string,
  callbacks: LoopCallbacks,
  contextWindowOverride?: number,
  systemPromptCompact?: string
): Promise<Task> {
  const ctx: LoopContext = {
    systemPrompt,
    systemPromptCompact,
    history,
    task,
    provider,
    model,
    callbacks,
    contextWindowOverride,
    parserState: { consecutiveTruncations: 0 },
  };

  while (task.steps.length < maxSteps && !callbacks.isAborted()) {
    const result = await processLoopStep(ctx, task.steps.length);
    if (result) return result;
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
