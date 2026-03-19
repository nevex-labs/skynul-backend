/**
 * Code mode — file/shell execution, no browser.
 * Action execution lives in TaskRunner (via callbacks).
 */

import type { Task } from '../../../types';
import type { VisionMessage } from '../../providers/codex-vision';
import type { TaskManager } from '../task-manager';
import { buildCodeSystemPrompt } from '../system-prompt';
import type { LoopCallbacks } from './agent-loop';

export type CodeLoopSetup = {
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

export function setupCodeLoop(setup: CodeLoopSetup): {
  systemPrompt: string;
  history: VisionMessage[];
  callbacks: LoopCallbacks;
} {
  const { task, memoryContext, taskManager, parentTaskId } = setup.deps;
  const systemPrompt = buildCodeSystemPrompt(task.capabilities, !!parentTaskId);
  const history: VisionMessage[] = [];
  const memCtx = memoryContext ?? '';
  const isAppScripting = task.capabilities.includes('app.scripting');

  const initialText = isAppScripting
    ? `Task: ${task.prompt}${memCtx}\n\n[APP SCRIPTING MODE] Use ONLY app_script actions. Keep scripts under 6 lines. Do NOT use file_write for design files.\n\nIMPORTANT: Take your time. Build the design in MANY small steps (10-20+ steps). Do NOT rush to save/done after 2-3 shapes. Each step should add ONE element: a shape, a color, a text, an alignment. Build up complexity gradually.`
    : `Task: ${task.prompt}${memCtx}\n\n[CODE MODE] You have NO screen access. Do NOT use click, scroll, move, or other screen actions.${isAppScripting ? ' [APP SCRIPTING ACTIVE] You MUST use app_script for design tasks. Do NOT use file_write for design files. Keep scripts under 6 lines.' : ' Use file_read, file_write, file_edit, file_list, file_search, and shell.'}`;

  history.push({
    role: 'user',
    content: [{ type: 'input_text', text: initialText }],
  });

  const blockedInCodeMode = new Set(['click', 'double_click', 'scroll', 'move']);

  const callbacks: LoopCallbacks = {
    taskManager,
    buildTurnMessage(stepIndex) {
      if (stepIndex === 0) {
        return { text: initialText };
      }
      const recentSteps = task.steps.slice(-8);
      const actionLog = recentSteps
        .map((s) => {
          const a = s.action as Record<string, unknown>;
          let desc: string = a.type as string;
          if (a.type === 'shell') desc = `shell "${((a.command as string) ?? '').slice(0, 80)}"`;
          else if (a.type === 'file_read') desc = `file_read ${a.path}`;
          else if (a.type === 'file_write') desc = `file_write ${a.path}`;
          else if (a.type === 'file_edit') desc = `file_edit ${a.path}`;
          else if (a.type === 'file_list') desc = `file_list "${a.pattern}"`;
          else if (a.type === 'file_search') desc = `file_search "${a.pattern}"`;
          const resultSuffix = s.result ? ` → ${s.result.slice(0, 300)}` : '';
          const errorSuffix = s.error ? ` [ERROR: ${s.error.slice(0, 100)}]` : '';
          return `Step ${s.index + 1}: ${desc}${resultSuffix}${errorSuffix}`;
        })
        .join('\n');
      return { text: `Step ${stepIndex + 1}.\n\nRecent actions:\n${actionLog}\n\nContinue with the next step.` };
    },
    executeAction(_action) {
      throw new Error('executeAction must be provided by TaskRunner');
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
