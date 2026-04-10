/**
 * ActionExecutors - Routing central
 * Delega a executors/ según tipo de acción
 */

import type { TaskAction } from '../../types';
import { executeFileEdit, executeFileList, executeFileRead, executeFileWrite, executeShell } from './executors/file';
import { executeImageAction } from './executors/image';
import type { ExecutorContext, ExecutorResult } from './executors/index';
import { executeInterTaskAction } from './executors/inter-task';
import { executeFactAction, executeMemoryAction } from './executors/memory';

export {
  executeFileEdit,
  executeFileList,
  executeFileRead,
  executeFileWrite,
  executeShell,
} from './executors/file';

export { executeImageAction } from './executors/image';
export { executeInterTaskAction } from './executors/inter-task';
export { executeFactAction, executeMemoryAction } from './executors/memory';
export type { ExecutorContext, ExecutorResult };

export function resolveAttachments(attachments: string[]): { filePaths: string[]; dataUrls: string[] } {
  return {
    filePaths: attachments.filter((a) => !a.startsWith('data:')),
    dataUrls: attachments.filter((a) => a.startsWith('data:')),
  };
}

export async function executeAction(ctx: ExecutorContext, action: TaskAction): Promise<ExecutorResult> {
  switch (action.type) {
    case 'generate_image':
      return executeImageAction(ctx, action);

    case 'set_identity':
      ctx.task.agentName = action.name;
      if (action.role) ctx.task.agentRole = action.role;
      ctx.task.updatedAt = Date.now();
      ctx.pushUpdate();
      return { ok: true, value: `Identity set: ${action.name}${action.role ? ` (${action.role})` : ''}` };

    case 'task_list_peers':
    case 'task_send':
    case 'task_read':
    case 'task_message':
      return executeInterTaskAction(ctx, action);

    case 'remember_fact':
    case 'forget_fact':
      return executeFactAction(ctx, action);

    case 'memory_save':
    case 'memory_search':
    case 'memory_context':
      return executeMemoryAction(ctx, action);

    case 'file_read':
      return executeFileRead(action.path, action.cwd, action.offset, action.limit);

    case 'file_write':
      return executeFileWrite(action.path, action.content, action.cwd);

    case 'file_edit':
      return executeFileEdit(action.path, action.old_string, action.new_string, action.cwd);

    case 'file_list':
      return executeFileList(action.pattern, action.cwd);

    case 'file_search': {
      const glob = action.glob ? `--glob '${action.glob}'` : '';
      const searchPath = action.path ?? '.';
      return executeShell(`rg -l ${glob} '${action.pattern}' ${searchPath}`, action.cwd, 30_000);
    }

    case 'shell':
      return executeShell(action.command, action.cwd, action.timeout);

    default:
      return { ok: false, error: `Unknown action type: ${(action as TaskAction).type}` };
  }
}
