import type { AgentDefinition } from '../../../shared/types';

export const EXECUTOR_BUILTIN: AgentDefinition = {
  name: 'executor',
  maxSteps: 50,
  description: 'Full-capability code executor.',
  allowedTools: [],
  mode: 'code',
  systemPrompt: 'You are an executor agent. Read, write, and run shell commands to complete tasks.',
  sourcePath: '__builtin__',
};
