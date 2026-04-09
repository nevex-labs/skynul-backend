import type { BrowserEngine } from './engine/browser-engine';

const registry = new Map<string, BrowserEngine>();

export function registerScreencast(taskId: string, engine: BrowserEngine): void {
  registry.set(taskId, engine);
}

export function unregisterScreencast(taskId: string): void {
  registry.delete(taskId);
}

export function getScreencastEngine(taskId: string): BrowserEngine | undefined {
  return registry.get(taskId);
}
