export type BrowserSessionMode = 'shared' | 'per-task';

export function parseBrowserSessionMode(env = process.env.SKYNUL_BROWSER_SESSION): BrowserSessionMode {
  const raw = (env ?? 'per-task').trim().toLowerCase();
  if (raw === 'per-task' || raw === 'per_task' || raw === 'task') return 'per-task';
  return 'shared';
}

export function isPerTaskBrowserSessionMode(mode: BrowserSessionMode): boolean {
  return mode === 'per-task';
}
