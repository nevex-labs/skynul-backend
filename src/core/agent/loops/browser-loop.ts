/**
 * Browser mode — setup, turn building, and cleanup.
 * Action execution lives in TaskRunner (via callbacks).
 */

import type { Task } from '../../../types';
import type { BrowserEngine } from '../../browser/engine/browser-engine';
import type { VisionMessage } from '../../providers/codex-vision';
import type { TaskManager } from '../task-manager';
import { acquireBrowserEngine } from '../../browser/engine/factory';
import { buildBrowserSystemPrompt } from '../system-prompt';
import { resolveAttachments } from '../action-executors';
import { buildActionLog } from '../history-manager';
import type { LoopCallbacks } from './agent-loop';

export type BrowserLoopSetup = {
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

export type BrowserLoopResult = {
  engine: BrowserEngine;
  release: () => Promise<void>;
  systemPrompt: string;
  history: VisionMessage[];
  callbacks: LoopCallbacks;
};

export async function setupBrowserLoop(setup: BrowserLoopSetup): Promise<BrowserLoopResult> {
  const { task, memoryContext, taskManager, parentTaskId } = setup.deps;
  setup.onStatus('Launching browser...');

  let engine: BrowserEngine;
  let release: (() => Promise<void>) | null = null;
  try {
    const acquired = await acquireBrowserEngine();
    engine = acquired.engine;
    release = acquired.release;
    setup.onStatus('Browser ready');
  } catch (e) {
    task.status = 'failed';
    task.error = `Browser launch failed: ${e instanceof Error ? e.message : String(e)}`;
    task.updatedAt = Date.now();
    setup.onUpdate(task);
    throw e;
  }

  if (setup.isAborted()) {
    if (release) await release().catch(() => {});
    const err = new Error('cancelled') as Error & { __cancelled?: true };
    err.__cancelled = true;
    throw err;
  }

  const systemPrompt = buildBrowserSystemPrompt(!!parentTaskId);
  const history: VisionMessage[] = [];
  const memCtx = memoryContext ? `\n\nContext from memory:\n${memoryContext}` : '';

  const { filePaths: attachPaths, dataUrls: attachDataUrls } = await resolveAttachments(task.attachments ?? []);
  const attachBlock =
    attachPaths.length > 0
      ? `\n\nReference files (use upload_file with these paths to upload them to any site):\n${attachPaths.map((p) => `- ${p}`).join('\n')}`
      : '';

  await autoDelegateForSocialPost(task, taskManager, history, setup.onStatus);

  const callbacks: LoopCallbacks = {
    taskManager,
    async buildTurnMessage(stepIndex) {
      let snap = { url: '', title: '', snapshot: '(page not available)' };
      try {
        snap = await engine.snapshot();
      } catch (_) { /* ignore snapshot errors */ }
      if (stepIndex === 0) {
        return {
          text: `Task: ${task.prompt}${attachBlock}${memCtx}\n\nCurrent page:\nURL: ${snap.url}\nTitle: ${snap.title}\n\nPage snapshot:\n${snap.snapshot}`,
          images: attachDataUrls.slice(0, 4),
        };
      }
      const actionLog = buildActionLog(task.steps, 8, {
        includeFailedSelectors: true,
        truncateResult: 200,
        truncateError: 100,
      });
      return {
        text: `Step ${stepIndex + 1}.\nURL: ${snap.url}\nTitle: ${snap.title}\n\nPage snapshot:\n${snap.snapshot}${actionLog}`,
      };
    },
    recordStep() {
      task.updatedAt = Date.now();
      setup.onUpdate(task);
    },
    pushStatus: setup.onStatus,
    isAborted: setup.isAborted,
  };

  return { engine, release: release!, systemPrompt, history, callbacks };
}

async function autoDelegateForSocialPost(
  task: Task,
  taskManager: TaskManager | null,
  history: VisionMessage[],
  onStatus: (msg: string) => void,
): Promise<void> {
  if (!taskManager || task.parentTaskId) return;
  const p = task.prompt.toLowerCase();
  const wantsPost = /(\bpost\b|\btweet\b|\bpublish\b|poste(a|ar)|public(a|ar)|borrador|draft)/.test(p);
  const wantsX = /(\bx\b|twitter|x\.com)/.test(p);
  const wantsImage = /(\bimage\b|\bimagen\b|\bmeme\b|\bpicture\b|\bgenerate\b.*\bimage\b)/.test(p);
  const wantsCopy = /(\bcopy\b|caption|two\s*lines|2\s*lines|dos\s*lineas|hashtags|cta)/.test(p);
  if (!((wantsPost && wantsX && wantsImage && wantsCopy) || (wantsPost && wantsImage && wantsCopy))) return;

  onStatus('Setting up multi-agent plan (Copy + Design)...');
  const [copyRes, designRes] = await Promise.all([
    taskManager.spawnAndWait(
      'You MUST respond using the Skynul agent JSON protocol (thought + action). Return ONE JSON object only. action.type MUST be "done". action.summary must contain plain text with: 3 numbered options (TWO lines each) and then "Recommended:". Constraints: English, bullish BTC meme vibe, short and punchy.',
      [],
      task.id,
      { agentRole: 'Copy' },
    ),
    taskManager.spawnAndWait(
      'You MUST respond using the Skynul agent JSON protocol (thought + action). Return ONE JSON object only. action.type MUST be "done". action.summary must contain plain text with: (1) image-gen prompt, (2) on-image text, (3) composition notes, (4) aspect ratio for X.',
      [],
      task.id,
      { agentRole: 'Design' },
    ),
  ]);

  history.push({
    role: 'user',
    content: [
      {
        type: 'input_text',
        text:
          `Sub-agent outputs (use these; do NOT redo):\n` +
          `- Copy (${copyRes.taskId}): ${copyRes.output}\n` +
          `- Design (${designRes.taskId}): ${designRes.output}\n\n` +
          `Now execute the full flow in X: open composer, generate/upload image based on Design, paste final chosen copy, and POST.`,
      },
    ],
  });
}
