import { execSync } from 'child_process';
import { Hono } from 'hono';

const ollama = new Hono()
  .get('/ping', async (c) => {
    try {
      // Try to ping Ollama server
      const response = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        return c.json({ ok: true });
      }
      return c.json({ error: 'Ollama not responding' }, 503);
    } catch {
      return c.json({ error: 'Ollama not running' }, 503);
    }
  })
  .get('/installed', (c) => {
    try {
      // Check if ollama command exists
      execSync('which ollama', { stdio: 'ignore' });
      return c.json({ installed: true });
    } catch {
      // Also check for Windows
      try {
        execSync('where ollama', { stdio: 'ignore' });
        return c.json({ installed: true });
      } catch {
        return c.json({ installed: false });
      }
    }
  })
  .get('/models', async (c) => {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) throw new Error('Failed to fetch models');

      const data = (await response.json()) as { models: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) || [];
      return c.json(models);
    } catch {
      return c.json([]);
    }
  });

export { ollama };
export type OllamaRoute = typeof ollama;
