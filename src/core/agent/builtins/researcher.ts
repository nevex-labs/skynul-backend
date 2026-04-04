import type { AgentDefinition } from '../../../shared/types';

export const RESEARCHER_BUILTIN: AgentDefinition = {
  name: 'researcher',
  maxSteps: 30,
  description: 'Read-only research agent.',
  allowedTools: ['file_read', 'file_search', 'web_scrape', 'file_list', 'done', 'fail'],
  mode: 'code',
  systemPrompt: 'You are a research agent. Find and summarize information. Do NOT modify files.',
  sourcePath: '__builtin__',
};
