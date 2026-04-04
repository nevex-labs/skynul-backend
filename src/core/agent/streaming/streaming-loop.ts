/**
 * Streaming loop — replaces the blocking vision → parse → execute cycle
 * with a streaming pipeline: stream → detect JSON → execute → continue.
 *
 * This module provides runStreamingTurn() which is called from agent-loop.ts
 * as a drop-in replacement for the blocking callVision + parseModelResponse flow.
 */

import type { Task, TaskAction, TaskStep } from '../../../shared/types';
import type { ProviderId } from '../../../shared/types';
import type { VisionMessage } from '../../../shared/types';
import { type DetectedAction, detectAction } from './json-detector';
import { budgetResult } from './tool-result-budget';
import { type StreamChunk, streamVision } from './vision-stream';

export type StreamingCallbacks = {
  /** Called for each text delta as it arrives from the model. */
  onDelta?(delta: string, accumulated: string): void;
  /** Called when thinking text is being generated (before action detected). */
  onThinking?(partialThought: string): void;
  /** Called when a complete action is detected and about to be executed. */
  onActionReady?(action: TaskAction, thought?: string): void;
  /** Called after action execution with the result. */
  onActionResult?(result: string | undefined, error: string | undefined): void;
};

export type StreamingTurnResult = {
  /** The full raw response from the model. */
  rawResponse: string;
  /** Parsed thought + action. */
  thought?: string;
  action: TaskAction;
  /** Execution result (after budget). */
  result?: string;
  error?: string;
  /** Token usage if reported. */
  usage?: { inputTokens: number; outputTokens: number };
};

/**
 * Run a single streaming turn:
 * 1. Stream the vision response, yielding deltas
 * 2. Detect complete JSON as soon as it's available
 * 3. Execute the action immediately (don't wait for remaining text)
 * 4. Apply result budget
 *
 * Returns the turn result for the agent loop to record.
 */
export async function runStreamingTurn(
  provider: ProviderId,
  systemPrompt: string,
  history: VisionMessage[],
  taskId: string,
  openaiModel: string,
  executeAction: (action: TaskAction) => Promise<string | undefined>,
  callbacks?: StreamingCallbacks
): Promise<StreamingTurnResult> {
  let accumulated = '';
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let detected: DetectedAction | null = null;
  let streamError: string | undefined;

  // Phase 1: Stream and detect
  for await (const chunk of streamVision(provider, systemPrompt, history, taskId, openaiModel)) {
    if (chunk.type === 'error') {
      streamError = chunk.error;
      break;
    }

    if (chunk.type === 'delta' && chunk.text) {
      accumulated += chunk.text;
      callbacks?.onDelta?.(chunk.text, accumulated);

      // Try to detect action on each chunk (cheap — pure string scan)
      if (!detected) {
        const result = detectAction(accumulated);
        if (result.detected) {
          detected = { thought: result.thought, action: result.action };
        } else if (accumulated.includes('"thought"')) {
          // Emit partial thinking for UI feedback
          const thoughtMatch = accumulated.match(/"thought"\s*:\s*"([^"]*)/);
          if (thoughtMatch?.[1]) {
            callbacks?.onThinking?.(thoughtMatch[1]);
          }
        }
      }
    }

    if (chunk.type === 'done') {
      usage = chunk.usage;
      // If we haven't detected yet, try one more time with full text
      if (!detected) {
        const result = detectAction(chunk.fullText ?? accumulated);
        if (result.detected) {
          detected = { thought: result.thought, action: result.action };
        }
      }
    }
  }

  // Handle stream error
  if (streamError) {
    return {
      rawResponse: accumulated,
      action: { type: 'fail', reason: streamError } as TaskAction,
      error: streamError,
    };
  }

  // If we never detected an action, fail
  if (!detected) {
    return {
      rawResponse: accumulated,
      action: {
        type: 'fail',
        reason: `Could not parse model response: ${accumulated.slice(0, 200)}`,
      } as TaskAction,
      error: 'Model response could not be parsed as a valid action',
    };
  }

  const { thought, action } = detected;
  callbacks?.onActionReady?.(action, thought);

  // Phase 2: Execute the action
  let result: string | undefined;
  let error: string | undefined;

  try {
    result = await executeAction(action);
    // Apply budget to large results
    if (result) {
      result = budgetResult(result, action.type);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  callbacks?.onActionResult?.(result, error);

  return {
    rawResponse: accumulated,
    thought,
    action,
    result,
    error,
    usage,
  };
}
