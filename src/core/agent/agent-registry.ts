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
    description: 'Read-only research agent.',
    allowedTools: ['file_read', 'file_search', 'web_scrape', 'file_list', 'done', 'fail'],
    mode: 'code',
    systemPrompt: 'You are a research agent. Find and summarize information. Do NOT modify files.',
    sourcePath: '__builtin__',
  },
  {
    name: 'executor',
    maxSteps: 50,
    description: 'Full-capability code executor.',
    allowedTools: [],
    mode: 'code',
    systemPrompt: 'You are an executor agent. Read, write, and run shell commands to complete tasks.',
    sourcePath: '__builtin__',
  },
  {
    name: 'monitor',
    maxSteps: 20,
    description: 'Condition monitor — checks status, sends alerts.',
    allowedTools: ['web_scrape', 'file_read', 'done', 'fail'],
    mode: 'code',
    systemPrompt: 'You are a monitoring agent. Check conditions and report status.',
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
  private watchers: FSWatcher[] = [];
  private scanDirs: string[];

  /**
   * @param scanDirs Directories to scan in order. First directory wins on name conflicts.
   * Defaults to [project/agents/, ~/.skynul/agents/].
   */
  constructor(scanDirs?: string[]) {
    this.scanDirs = scanDirs ?? [join(process.cwd(), 'agents'), join(getDataDir(), 'agents')];
  }

  /** Scan all configured directories and load .md files. */
  async scan(): Promise<void> {
    let totalLoaded = 0;

    for (const dir of this.scanDirs) {
      try {
        await mkdir(dir, { recursive: true });
        const files = await readdir(dir);
        const mdFiles = files.filter((f) => f.endsWith('.md'));

        for (const file of mdFiles) {
          try {
            const filePath = join(dir, file);
            const content = await readFile(filePath, 'utf8');
            const agent = parseAgentFile(content, filePath);
            // First directory wins — don't override already-loaded agents
            if (!this.agents.has(agent.name)) {
              this.agents.set(agent.name, agent);
              totalLoaded++;
            }
          } catch (e) {
            console.warn(`[AgentRegistry] Failed to load ${file}:`, e instanceof Error ? e.message : e);
          }
        }
      } catch {
        // Directory doesn't exist or can't be read — skip silently
      }
    }

    console.log(`[AgentRegistry] Loaded ${totalLoaded} agents from ${this.scanDirs.join(', ')}`);
  }

  /** Get an agent by name. Checks custom agents first, then builtins. */
  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name) ?? BUILTINS.find((a) => a.name === name);
  }

  /** List all registered agents (custom + built-in). No duplicates by name. */
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

  /** Start watching all scan directories for changes. */
  startWatching(): void {
    if (this.watchers.length > 0) return;

    for (const dir of this.scanDirs) {
      try {
        const w = watch(dir, { recursive: true }, async (_eventType, filename) => {
          if (!filename || !filename.toString().endsWith('.md')) return;

          const filePath = join(dir, filename.toString());
          try {
            const content = await readFile(filePath, 'utf8');
            const agent = parseAgentFile(content, filePath);
            this.agents.set(agent.name, agent);
            console.log(`[AgentRegistry] Hot-reloaded: ${agent.name} (${basename(filePath)})`);
          } catch (e) {
            console.warn(`[AgentRegistry] Hot-reload failed for ${filename}:`, e instanceof Error ? e.message : e);
          }
        });
        this.watchers.push(w);
      } catch {
        // Directory may not exist yet — skip
      }
    }

    if (this.watchers.length > 0) {
      console.log(`[AgentRegistry] Watching ${this.scanDirs.join(', ')} for changes`);
    }
  }

  /** Stop watching for changes. */
  stopWatching(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }

  /** Cleanup resources. */
  dispose(): void {
    this.stopWatching();
    this.agents.clear();
  }
}
