/**
 * ActionExecutors - Re-export hub.
 * Centraliza imports de executors/ para los loops.
 */

import type { ExecutorContext, ExecutorResult } from './executors/index';

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
