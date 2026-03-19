/**
 * CDP / Polymarket mode — API-only, no browser.
 * Action execution lives in TaskRunner (via callbacks).
 */

import type { Task } from '../../../types';
import type { VisionMessage } from '../../providers/codex-vision';
import type { TaskManager } from '../task-manager';
import { buildCdpSystemPrompt } from '../system-prompt';
import { buildActionLog } from '../history-manager';
import type { LoopCallbacks } from './agent-loop';

export type CdpLoopSetup = {
  deps: {
    task: Task;
    memoryContext?: string;
    taskManager: TaskManager | null;
    parentTaskId?: string;
    maxSteps: number;
  };
  onStatus: (msg: string) => void;
  onUpdate: (task: Task) => void;
  isAborted: () => boolean;
};

export function setupCdpLoop(setup: CdpLoopSetup): {
  systemPrompt: string;
  history: VisionMessage[];
  callbacks: LoopCallbacks;
} {
  const { task, memoryContext, taskManager, parentTaskId } = setup.deps;
  const systemPrompt = buildCdpSystemPrompt(task.capabilities, !!parentTaskId);
  const history: VisionMessage[] = [];
  const memCtxCdp = memoryContext ?? '';

  const allAttachments = (task.attachments ?? []).filter((x) => typeof x === 'string');
  const imageDataUrls = allAttachments.filter((a) => a.startsWith('data:image/'));
  const filePaths = allAttachments.filter((a) => !a.startsWith('data:image/'));
  const attachmentsBlock =
    filePaths.length > 0
      ? `\n\nAttached local files (absolute paths):\n${filePaths.slice(0, 12).map((p) => `- ${p}`).join('\n')}`
      : '';

  history.push({
    role: 'user',
    content: [
      { type: 'input_text', text: `Task: ${task.prompt}${attachmentsBlock}${memCtxCdp}` },
      ...imageDataUrls.slice(0, 4).map((url) => ({
        type: 'input_image' as const,
        detail: 'auto' as const,
        image_url: url,
      })),
    ],
  });

  const callbacks: LoopCallbacks = {
    taskManager,
    buildTurnMessage(stepIndex) {
      if (stepIndex === 0) {
        return {
          text: `Task: ${task.prompt}\n\nYou are in API-only mode. Use the polymarket_* actions directly. Do NOT use shell, navigate, or evaluate.`,
        };
      }
      const actionLog = buildActionLog(task.steps, 8, { truncateResult: 200, truncateError: 100 });
      return { text: `Step ${stepIndex + 1}.${actionLog}` };
    },
    recordStep() {
      task.updatedAt = Date.now();
      setup.onUpdate(task);
    },
    pushStatus: setup.onStatus,
    isAborted: setup.isAborted,
  };

  return { systemPrompt, history, callbacks };
}
