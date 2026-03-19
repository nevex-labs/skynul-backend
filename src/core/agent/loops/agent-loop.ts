/**
 * Generic agent loop runner — shared iteration pattern for all three modes.
 *
 * Usage: create LoopCallbacks (with TaskRunner's action executors),
 * then call runAgentLoop.
 */

import type { Task, TaskAction, TaskStep } from '../../../types';
import type { ProviderId } from '../../../types';
import type { VisionMessage } from '../../providers/codex-vision';
import { type ParserState, parseModelResponse } from '../action-parser';
import { compressHistory, drainInbox, truncateHistory } from '../history-manager';
import type { TaskManager } from '../task-manager';
import { callVision } from '../vision-dispatch';

export type LoopCallbacks = {
  taskManager: TaskManager | null;
  buildTurnMessage(
    stepIndex: number
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
  callbacks: LoopCallbacks
): Promise<Task> {
  const parserState: ParserState = { consecutiveTruncations: 0 };

  while (task.steps.length < maxSteps && !callbacks.isAborted()) {
    const stepIndex = task.steps.length;

    let turnText: string;
    let images: string[] | undefined;
    try {
      const turn = await callbacks.buildTurnMessage(stepIndex);
      turnText = turn.text;
      images = turn.images;
    } catch (e) {
      return finish(task, 'failed', callbacks, `Turn message error: ${e instanceof Error ? e.message : String(e)}`);
    }

    const inboxBlock = drainInbox(callbacks.taskManager, task.id);
    const turnMessage: VisionMessage = {
      role: 'user',
      content: [
        { type: 'input_text' as const, text: turnText + inboxBlock },
        ...(images
          ? images.slice(0, 4).map((url) => ({
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
    history.push(turnMessage);

    callbacks.pushStatus('Thinking...');

    let rawResponse: string;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    try {
      const result = await callVision(provider, systemPrompt, history, task.id, openaiModel);
      rawResponse = result.text;
      usage = result.usage;
    } catch (e) {
      return finish(task, 'failed', callbacks, `Model call error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (usage) {
      if (!task.usage) task.usage = { inputTokens: 0, outputTokens: 0 };
      task.usage.inputTokens += usage.inputTokens;
      task.usage.outputTokens += usage.outputTokens;
    }

    history.push({ role: 'assistant', content: [{ type: 'output_text', text: rawResponse }] });

    const { thought, action } = parseModelResponse(rawResponse, parserState);

    const step: TaskStep = {
      index: task.steps.length,
      timestamp: Date.now(),
      screenshotBase64: '',
      action,
      thought,
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
      stepResult = await callbacks.executeAction!(action);
    } catch (e) {
      stepError = e instanceof Error ? e.message : String(e);
    }

    step.result = stepResult;
    step.error = stepError;
    task.steps.push(step);
    callbacks.recordStep(step);
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
