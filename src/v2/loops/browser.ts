import type { LoopSetupFn, LoopSetupResult } from '../loop-registry';
import type { TaskAction } from '../task-runner';

export interface BrowserEngine {
  navigate(url: string): Promise<void>;
  click(selector: string, frameId?: string): Promise<void>;
  type(selector: string, text: string, frameId?: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  evaluate(script: string, frameId?: string): Promise<string | undefined>;
  uploadFile(selector: string, filePaths: string[], frameId?: string): Promise<void>;
  snapshot(): Promise<{ url: string; title: string; snapshot: string }>;
  close(): Promise<void>;
}

export type BrowserEngineFactory = () => Promise<{
  engine: BrowserEngine;
  release: () => Promise<void>;
}>;

export type BrowserLoopOpts = {
  engineFactory: BrowserEngineFactory;
};

export function createBrowserLoopSetup(opts: BrowserLoopOpts): LoopSetupFn {
  return async (task): Promise<LoopSetupResult> => {
    const { engine, release } = await opts.engineFactory();

    const actionExecutors: Record<string, (action: TaskAction) => Promise<string | undefined>> = {
      navigate: async (action) => {
        const url = String((action as any).url ?? '');
        await engine.navigate(url);
        await sleep(1500);
        return undefined;
      },
      click: async (action) => {
        await engine.click((action as any).selector as string, (action as any).frameId);
        return undefined;
      },
      type: async (action) => {
        await engine.type((action as any).selector as string, (action as any).text as string, (action as any).frameId);
        return undefined;
      },
      pressKey: async (action) => {
        await engine.pressKey((action as any).key as string);
        return undefined;
      },
      key: async (action) => {
        await engine.pressKey(((action as any).key as string) || ((action as any).combo as string));
        return undefined;
      },
      evaluate: async (action) => {
        const result = await engine.evaluate((action as any).script as string, (action as any).frameId);
        return result || undefined;
      },
      upload_file: async (action) => {
        const selector = (action as any).selector as string;
        const filePaths = (action as any).filePaths as string[];
        if (!selector || !Array.isArray(filePaths) || filePaths.length === 0) {
          throw new Error('upload_file requires selector + filePaths[]');
        }
        await engine.uploadFile(selector, filePaths, (action as any).frameId);
        return undefined;
      },
      scroll: async (action) => {
        await engine.evaluate(`window.scrollBy(0, ${(action as any).direction === 'up' ? -400 : 400})`);
        return undefined;
      },
      scrollIntoView: async (action) => {
        const selector = ((action as any).selector as string).replace(/'/g, "\\'");
        await engine.evaluate(
          `document.querySelector('${selector}')?.scrollIntoView({block:'center',behavior:'instant'})`,
          (action as any).frameId
        );
        return undefined;
      },
      screenshot: async () => '[BLOCKED] screenshot action is disabled.',
      wait: async () => '[BLOCKED] wait is disabled.',
    };

    const systemPrompt = [
      `You are an autonomous browser agent. Execute the user's task by interacting with web pages.`,
      `Respond with JSON: {"thought": "...", "action": {"type": "...", ...}}`,
      `When done: {"action": {"type": "done", "summary": "..."}}`,
      `When failing: {"action": {"type": "fail", "reason": "..."}}`,
      `\nAvailable actions: navigate, click, type, pressKey, evaluate, upload_file, scroll, scrollIntoView`,
    ].join('\n');

    const attachPaths = (task.attachments ?? []).filter((a) => !a.startsWith('data:'));
    const attachBlock =
      attachPaths.length > 0 ? `\n\nReference files:\n${attachPaths.map((p) => `- ${p}`).join('\n')}` : '';

    const initialHistory = [
      {
        role: 'user' as const,
        content: `Task: ${task.prompt}${attachBlock}`,
      },
    ];

    const formatObservation = async (
      _action: TaskAction,
      result: string | undefined,
      error?: string
    ): Promise<string> => {
      let snap = { url: '', title: '', snapshot: '(page not available)' };
      try {
        snap = await engine.snapshot();
      } catch {
        // ignore
      }

      const parts: string[] = [];
      if (result) parts.push(result);
      if (error) parts.push(`Error: ${error}`);
      parts.push(`\n[Browser state]\nURL: ${snap.url}\nTitle: ${snap.title}\nSnapshot: ${snap.snapshot}`);
      return parts.join('\n');
    };

    return {
      actionExecutors,
      systemPrompt,
      initialHistory,
      cleanup: release,
      formatObservation,
    };
  };
}

export function createPlaywrightBrowserEngineFactory(): BrowserEngineFactory {
  return async () => {
    const { acquireBrowserEngine } = await import('../engine/playwright');
    const acquired = await acquireBrowserEngine();
    const inner = acquired.engine;
    return {
      engine: {
        navigate: inner.navigate.bind(inner),
        click: inner.click.bind(inner),
        type: inner.type.bind(inner),
        pressKey: inner.pressKey.bind(inner),
        evaluate: async (script, frameId) => {
          const r = await inner.evaluate(script, frameId);
          return r || undefined;
        },
        uploadFile: inner.uploadFile.bind(inner),
        snapshot: inner.snapshot.bind(inner),
        close: async () => {},
      },
      release: acquired.release,
    };
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
