import type { AgentDefinition } from '../../../types';

export const MONITOR_BUILTIN: AgentDefinition = {
  name: 'monitor',
  maxSteps: 20,
  description: 'Condition monitor — checks status, sends alerts.',
  allowedTools: ['web_scrape', 'file_read', 'done', 'fail'],
  mode: 'code',
  systemPrompt: 'You are a monitoring agent. Check conditions and report status.',
  sourcePath: '__builtin__',
};
