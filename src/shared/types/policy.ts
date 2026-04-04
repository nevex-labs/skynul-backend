export type CapabilityId = 'fs.read' | 'fs.write' | 'cmd.run' | 'net.http';

export type LanguageCode = 'en' | 'es';

export type ThemeMode = 'system' | 'light' | 'dark';

export type ProviderId =
  | 'chatgpt'
  | 'claude'
  | 'deepseek'
  | 'kimi'
  | 'glm'
  | 'minimax'
  | 'openrouter'
  | 'gemini'
  | 'ollama';

export type PolicyState = {
  capabilities: Record<CapabilityId, boolean>;
  themeMode: ThemeMode;
  language: LanguageCode;
  provider: {
    active: ProviderId;
    openaiModel: string;
  };
  taskMemoryEnabled: boolean;
  taskAutoApprove: boolean;
  paperTradingEnabled: boolean;
};

export const DEFAULT_POLICY: PolicyState = {
  capabilities: {
    'fs.read': true,
    'fs.write': true,
    'cmd.run': true,
    'net.http': true,
  },
  themeMode: 'dark',
  language: 'en',
  provider: {
    active: 'chatgpt',
    openaiModel: 'gpt-4.1-mini',
  },
  taskMemoryEnabled: true,
  taskAutoApprove: false,
  paperTradingEnabled: false,
};

export type SetLanguageRequest = {
  language: LanguageCode;
};

export type SetCapabilityRequest = {
  id: CapabilityId;
  enabled: boolean;
};

export type SetThemeRequest = {
  themeMode: ThemeMode;
};

export type SetOpenAIModelRequest = {
  model: string;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type ChatSendRequest = {
  messages: ChatMessage[];
};

export type ChatSendResponse = {
  content: string;
};

export type ReadTextFileRequest = {
  path: string;
};

export type WriteTextFileRequest = {
  path: string;
  content: string;
  ifExists?: 'fail' | 'overwrite';
};
