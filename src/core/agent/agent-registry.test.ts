import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from './agent-registry';

const { mockReadFile, mockReaddir, mockMkdir, mockWatch } = vi.hoisted(() => {
  return {
    mockReadFile: vi.fn(),
    mockReaddir: vi.fn(),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockWatch: vi.fn(),
  };
});

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  readdir: mockReaddir,
  mkdir: mockMkdir,
  writeFile: vi.fn(),
}));

vi.mock('fs', () => ({
  watch: mockWatch,
}));

vi.mock('../config', () => ({
  getDataDir: vi.fn(() => '/tmp/test-data'),
}));

const AGENTS_DIR = '/tmp/test-data/agents';

function makeMdFile(fm: Record<string, unknown>, body: string): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => (typeof x === 'string' ? `"${x}"` : x)).join(', ')}]`);
    } else {
      lines.push(`${k}: ${typeof v === 'string' ? `"${v}"` : v}`);
    }
  }
  lines.push('---');
  lines.push(body);
  return lines.join('\n');
}

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReaddir.mockResolvedValue([]);
    mockMkdir.mockResolvedValue(undefined);
    registry = new AgentRegistry(AGENTS_DIR);
  });

  afterEach(() => {
    registry.dispose();
  });

  describe('scan', () => {
    it('creates agents directory if missing', async () => {
      await registry.scan();
      expect(mockMkdir).toHaveBeenCalledWith(AGENTS_DIR, { recursive: true });
    });

    it('loads .md files and parses frontmatter', async () => {
      const researcherMd = makeMdFile(
        {
          name: 'researcher',
          description: 'A research agent',
          maxSteps: 30,
          allowedTools: ['file_read', 'web_scrape'],
        },
        'You are a research agent. Find and summarize information.'
      );
      mockReaddir.mockResolvedValue(['researcher.md', 'not-an-agent.txt']);
      mockReadFile.mockResolvedValue(researcherMd);

      await registry.scan();

      const agent = registry.get('researcher');
      expect(agent).toBeDefined();
      expect(agent!.name).toBe('researcher');
      expect(agent!.description).toBe('A research agent');
      expect(agent!.maxSteps).toBe(30);
      expect(agent!.allowedTools).toEqual(['file_read', 'web_scrape']);
      expect(agent!.systemPrompt).toContain('You are a research agent');
      expect(agent!.sourcePath).toBe(join(AGENTS_DIR, 'researcher.md'));
    });

    it('parses mode and model from frontmatter', async () => {
      const md = makeMdFile(
        { name: 'browser-agent', description: 'Browser agent', mode: 'browser', model: 'sonnet' },
        'You browse the web.'
      );
      mockReaddir.mockResolvedValue(['browser-agent.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      const agent = registry.get('browser-agent');
      expect(agent!.mode).toBe('browser');
      expect(agent!.model).toBe('sonnet');
    });

    it('parses capabilities from frontmatter', async () => {
      const md = makeMdFile(
        { name: 'trader', description: 'Trading agent', capabilities: ['cex.trading', 'polymarket.trading'] },
        'You trade things.'
      );
      mockReaddir.mockResolvedValue(['trader.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      const agent = registry.get('trader');
      expect(agent!.capabilities).toEqual(['cex.trading', 'polymarket.trading']);
    });

    it('skips files with missing name', async () => {
      const md = makeMdFile({ description: 'No name agent' }, 'Some prompt');
      mockReaddir.mockResolvedValue(['no-name.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      expect(registry.get('anything')).toBeUndefined();
    });

    it('skips files with empty body', async () => {
      const md = makeMdFile({ name: 'empty', description: 'Empty agent' }, '   ');
      mockReaddir.mockResolvedValue(['empty.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      expect(registry.get('empty')).toBeUndefined();
    });

    it('skips files with invalid capabilities', async () => {
      const md = makeMdFile(
        { name: 'bad-caps', description: 'Bad', capabilities: ['nonexistent.cap'] },
        'You do things.'
      );
      mockReaddir.mockResolvedValue(['bad-caps.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      expect(registry.get('bad-caps')).toBeUndefined();
    });

    it('skips files with invalid mode', async () => {
      const md = makeMdFile({ name: 'bad-mode', description: 'Bad', mode: 'invalid' }, 'You do things.');
      mockReaddir.mockResolvedValue(['bad-mode.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      expect(registry.get('bad-mode')).toBeUndefined();
    });

    it('handles readdir error gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));
      await registry.scan();
      // Should not throw
      expect(registry.list()).toEqual(registry.getBuiltins());
    });
  });

  describe('get', () => {
    it('returns custom agent over builtin', async () => {
      const md = makeMdFile({ name: 'researcher', description: 'Custom researcher' }, 'Custom prompt.');
      mockReaddir.mockResolvedValue(['researcher.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      const agent = registry.get('researcher');
      expect(agent!.description).toBe('Custom researcher');
      expect(agent!.sourcePath).not.toBe('__builtin__');
    });

    it('falls back to builtins when not found', () => {
      const agent = registry.get('researcher');
      expect(agent).toBeDefined();
      expect(agent!.sourcePath).toBe('__builtin__');
    });

    it('returns undefined for truly unknown agent', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns custom + builtins, custom first', async () => {
      const md = makeMdFile({ name: 'my-agent', description: 'My agent' }, 'Custom.');
      mockReaddir.mockResolvedValue(['my-agent.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      const agents = registry.list();
      expect(agents[0].name).toBe('my-agent');
      expect(agents.some((a) => a.name === 'researcher')).toBe(true);
      expect(agents.some((a) => a.name === 'executor')).toBe(true);
      expect(agents.some((a) => a.name === 'monitor')).toBe(true);
    });

    it('does not duplicate when custom overrides builtin', async () => {
      const md = makeMdFile({ name: 'executor', description: 'Custom executor' }, 'Custom.');
      mockReaddir.mockResolvedValue(['executor.md']);
      mockReadFile.mockResolvedValue(md);

      await registry.scan();

      const names = registry.list().map((a) => a.name);
      expect(names.filter((n) => n === 'executor')).toHaveLength(1);
    });
  });

  describe('register / remove', () => {
    it('registers an agent programmatically', () => {
      registry.register({
        name: 'custom',
        description: 'Custom',
        allowedTools: [],
        systemPrompt: 'Custom prompt.',
        sourcePath: 'manual',
      });
      expect(registry.get('custom')!.description).toBe('Custom');
    });

    it('removes an agent', () => {
      registry.register({
        name: 'temp',
        description: 'Temp',
        allowedTools: [],
        systemPrompt: 'Temp.',
        sourcePath: 'manual',
      });
      expect(registry.remove('temp')).toBe(true);
      expect(registry.get('temp')).toBeUndefined();
    });

    it('remove returns false for unknown agent', () => {
      expect(registry.remove('nonexistent')).toBe(false);
    });
  });

  describe('getBuiltins', () => {
    it('returns the 3 builtin agents', () => {
      const builtins = registry.getBuiltins();
      expect(builtins).toHaveLength(3);
      expect(builtins.map((a) => a.name)).toEqual(['researcher', 'executor', 'monitor']);
    });

    it('builtins have __builtin__ sourcePath', () => {
      for (const b of registry.getBuiltins()) {
        expect(b.sourcePath).toBe('__builtin__');
      }
    });
  });

  describe('hot-reload', () => {
    it('startWatching creates fs watcher', () => {
      const closeFn = vi.fn();
      mockWatch.mockReturnValue({ close: closeFn });

      registry.startWatching();

      expect(mockWatch).toHaveBeenCalledWith(AGENTS_DIR, { recursive: true }, expect.any(Function));
    });

    it('startWatching is idempotent', () => {
      const closeFn = vi.fn();
      mockWatch.mockReturnValue({ close: closeFn });

      registry.startWatching();
      registry.startWatching();

      expect(mockWatch).toHaveBeenCalledTimes(1);
    });

    it('stopWatching closes watcher', () => {
      const closeFn = vi.fn();
      mockWatch.mockReturnValue({ close: closeFn });

      registry.startWatching();
      registry.stopWatching();

      expect(closeFn).toHaveBeenCalled();
    });

    it('stopWatching is safe when not watching', () => {
      expect(() => registry.stopWatching()).not.toThrow();
    });

    it('reloads modified .md file on change', async () => {
      let watcherCallback: (...args: unknown[]) => void = () => {};
      mockWatch.mockImplementation((_dir: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
        watcherCallback = cb;
        return { close: vi.fn() };
      });

      registry.startWatching();

      const md = makeMdFile({ name: 'live-agent', description: 'Live agent' }, 'Updated prompt.');
      mockReadFile.mockResolvedValue(md);

      // Simulate file change
      await watcherCallback('change', 'live-agent.md');

      const agent = registry.get('live-agent');
      expect(agent).toBeDefined();
      expect(agent!.systemPrompt).toBe('Updated prompt.');
    });

    it('ignores non-.md file changes', async () => {
      let watcherCallback: (...args: unknown[]) => void = () => {};
      mockWatch.mockImplementation((_dir: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
        watcherCallback = cb;
        return { close: vi.fn() };
      });

      registry.startWatching();

      await watcherCallback('change', 'data.json');

      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('clears agents and stops watcher', () => {
      const closeFn = vi.fn();
      mockWatch.mockReturnValue({ close: closeFn });

      registry.register({
        name: 'temp',
        description: 'Temp',
        allowedTools: [],
        systemPrompt: 'Temp.',
        sourcePath: 'manual',
      });
      registry.startWatching();

      registry.dispose();

      expect(closeFn).toHaveBeenCalled();
      expect(registry.get('temp')).toBeUndefined();
    });
  });
});
