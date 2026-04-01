import { type FSWatcher, watch } from 'fs';
import { basename, join } from 'path';
import { mkdir, readFile, readdir } from 'fs/promises';
import matter from 'gray-matter';
import type { AgentDefinition } from '../../types';
import { TASK_CAPABILITY_IDS, type TaskCapabilityId, type TaskMode } from '../../types';
import { getDataDir } from '../config';

// ── Built-in agents (fallbacks) ─────────────────────────────────────────────

const BUILTINS: AgentDefinition[] = [
  {
    name: 'researcher',
    maxSteps: 30,
    description: 'Read-only research agent — searches, reads, summarizes.',
    allowedTools: ['file_read', 'file_search', 'web_scrape', 'file_list', 'done', 'fail'],
    mode: 'code',
    systemPrompt:
      'You are a research agent. Your job is to find, read, and summarize information. ' +
      'Do NOT modify files or execute destructive operations. ' +
      'Use file_search to find relevant files, file_read to read them, and web_scrape for web content. ' +
      'When done, provide a clear summary of your findings.',
    sourcePath: '__builtin__',
  },
  {
    name: 'executor',
    maxSteps: 50,
    description: 'Full-capability code executor — reads, writes, runs shell commands.',
    allowedTools: [], // all allowed
    mode: 'code',
    systemPrompt:
      'You are an executor agent. You can read, write, and modify files, run shell commands, ' +
      'and perform any necessary operations to complete the task. ' +
      'Always explain what you are doing before executing potentially destructive actions.',
    sourcePath: '__builtin__',
  },
  {
    name: 'monitor',
    maxSteps: 20,
    description: 'Position/condition monitor — checks status, sends alerts.',
    allowedTools: ['web_scrape', 'file_read', 'done', 'fail'],
    mode: 'code',
    systemPrompt:
      'You are a monitoring agent. Your job is to check the status of a condition or position ' +
      'and report back. You read data sources, compare against thresholds, and decide if action is needed. ' +
      'Keep your responses concise and focused on the monitored condition.',
    sourcePath: '__builtin__',
  },
];

// ── Frontmatter schema validation ────────────────────────────────────────────

function validateFrontmatter(data: Record<string, unknown>, filePath: string): void {
  if (!data.name || typeof data.name !== 'string') {
    throw new Error(`Agent file ${filePath}: "name" is required and must be a string`);
  }
  if (!data.description || typeof data.description !== 'string') {
    throw new Error(`Agent file ${filePath}: "description" is required and must be a string`);
  }
  if (data.model !== undefined && typeof data.model !== 'string') {
    throw new Error(`Agent file ${filePath}: "model" must be a string`);
  }
  if (data.maxSteps !== undefined && (typeof data.maxSteps !== 'number' || data.maxSteps < 1)) {
    throw new Error(`Agent file ${filePath}: "maxSteps" must be a positive number`);
  }
  if (data.allowedTools !== undefined && !Array.isArray(data.allowedTools)) {
    throw new Error(`Agent file ${filePath}: "allowedTools" must be an array`);
  }
  if (data.mode !== undefined && data.mode !== 'browser' && data.mode !== 'code') {
    throw new Error(`Agent file ${filePath}: "mode" must be "browser" or "code"`);
  }
  if (data.capabilities !== undefined) {
    if (!Array.isArray(data.capabilities)) {
      throw new Error(`Agent file ${filePath}: "capabilities" must be an array`);
    }
    for (const cap of data.capabilities) {
      if (!TASK_CAPABILITY_IDS.includes(cap as TaskCapabilityId)) {
        throw new Error(
          `Agent file ${filePath}: invalid capability "${cap}". Valid: ${TASK_CAPABILITY_IDS.join(', ')}`
        );
      }
    }
  }
}

function parseAgentFile(content: string, filePath: string): AgentDefinition {
  const { data, content: systemPrompt } = matter(content);

  validateFrontmatter(data, filePath);

  const trimmedPrompt = systemPrompt.trim();
  if (!trimmedPrompt) {
    throw new Error(`Agent file ${filePath}: system prompt (body after frontmatter) is empty`);
  }

  return {
    name: data.name as string,
    description: data.description as string,
    model: data.model as string | undefined,
    maxSteps: data.maxSteps as number | undefined,
    allowedTools: (data.allowedTools as string[]) ?? [],
    mode: data.mode as TaskMode | undefined,
    capabilities: data.capabilities as TaskCapabilityId[] | undefined,
    systemPrompt: trimmedPrompt,
    sourcePath: filePath,
  };
}

// ── AgentRegistry ────────────────────────────────────────────────────────────

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  private watcher: FSWatcher | null = null;
  private agentsDir: string;

  constructor(agentsDir?: string) {
    this.agentsDir = agentsDir ?? join(getDataDir(), 'agents');
  }

  /** Scan the agents directory and load all .md files. */
  async scan(): Promise<void> {
    try {
      await mkdir(this.agentsDir, { recursive: true });
      const files = await readdir(this.agentsDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      for (const file of mdFiles) {
        try {
          const filePath = join(this.agentsDir, file);
          const content = await readFile(filePath, 'utf8');
          const agent = parseAgentFile(content, filePath);
          this.agents.set(agent.name, agent);
        } catch (e) {
          console.warn(`[AgentRegistry] Failed to load ${file}:`, e instanceof Error ? e.message : e);
        }
      }

      console.log(`[AgentRegistry] Loaded ${this.agents.size} agents from ${this.agentsDir}`);
    } catch (e) {
      console.warn('[AgentRegistry] Could not scan agents directory:', e);
    }
  }

  /** Get an agent by name. Checks custom agents first, then builtins. */
  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name) ?? BUILTINS.find((a) => a.name === name);
  }

  /** List all registered agents (custom + built-in). */
  list(): AgentDefinition[] {
    const custom = Array.from(this.agents.values());
    const builtinNames = new Set(custom.map((a) => a.name));
    const builtins = BUILTINS.filter((a) => !builtinNames.has(a.name));
    return [...custom, ...builtins];
  }

  /** Get only built-in agents. */
  getBuiltins(): AgentDefinition[] {
    return [...BUILTINS];
  }

  /** Register or update an agent programmatically. */
  register(agent: AgentDefinition): void {
    this.agents.set(agent.name, agent);
  }

  /** Remove an agent by name. */
  remove(name: string): boolean {
    return this.agents.delete(name);
  }

  /** Start watching the agents directory for changes. */
  startWatching(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(this.agentsDir, { recursive: true }, async (eventType, filename) => {
        if (!filename || !filename.toString().endsWith('.md')) return;

        const filePath = join(this.agentsDir, filename.toString());

        try {
          const content = await readFile(filePath, 'utf8');
          const agent = parseAgentFile(content, filePath);
          this.agents.set(agent.name, agent);
          console.log(`[AgentRegistry] Hot-reloaded: ${agent.name} (${basename(filePath)})`);
        } catch (e) {
          console.warn(`[AgentRegistry] Hot-reload failed for ${filename}:`, e instanceof Error ? e.message : e);
        }
      });
      console.log(`[AgentRegistry] Watching ${this.agentsDir} for changes`);
    } catch (e) {
      console.warn('[AgentRegistry] Could not start watching:', e);
    }
  }

  /** Stop watching for changes. */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** Cleanup resources. */
  dispose(): void {
    this.stopWatching();
    this.agents.clear();
  }
}
