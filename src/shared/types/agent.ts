import type { TaskCapabilityId, TaskMode } from './task';

export type AgentDefinition = {
  /** Unique name used to reference this agent (from frontmatter `name`). */
  name: string;
  /** Model override (e.g. "sonnet", "haiku", "opus"). Optional. */
  model?: string;
  /** Allowed tool/action types for this agent. Empty = all allowed. */
  allowedTools: string[];
  /** Max steps override. Falls back to task default if not set. */
  maxSteps?: number;
  /** Short description shown in UI/lists. */
  description: string;
  /** Task mode override ('browser' | 'code'). */
  mode?: TaskMode;
  /** Capability overrides. */
  capabilities?: TaskCapabilityId[];
  /** The system prompt content (everything after the frontmatter closing `---`). */
  systemPrompt: string;
  /** Source file path for debugging. */
  sourcePath: string;
};
