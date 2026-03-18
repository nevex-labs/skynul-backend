export type CapabilityId = 'fs.read' | 'fs.write' | 'cmd.run' | 'net.http'

export type LanguageCode = 'en' | 'es'

export type ThemeMode = 'system' | 'light' | 'dark'

export type ProviderId =
  | 'chatgpt'
  | 'claude'
  | 'deepseek'
  | 'kimi'
  | 'glm'
  | 'minimax'
  | 'openrouter'
  | 'gemini'
  | 'ollama'

export type PolicyState = {
  workspaceRoot: string | null
  capabilities: Record<CapabilityId, boolean>
  themeMode: ThemeMode
  language: LanguageCode
  provider: {
    active: ProviderId
    openaiModel: string
  }
  taskMemoryEnabled: boolean
  taskAutoApprove: boolean
}

export const DEFAULT_POLICY: PolicyState = {
  workspaceRoot: null,
  capabilities: {
    'fs.read': false,
    'fs.write': false,
    'cmd.run': false,
    'net.http': false
  },
  themeMode: 'dark',
  language: 'en',
  provider: {
    active: 'chatgpt',
    openaiModel: 'gpt-4.1-mini'
  },
  taskMemoryEnabled: true,
  taskAutoApprove: false
}

export type SetLanguageRequest = {
  language: LanguageCode
}

export type SetCapabilityRequest = {
  id: CapabilityId
  enabled: boolean
}

export type SetThemeRequest = {
  themeMode: ThemeMode
}

export type SetOpenAIModelRequest = {
  model: string
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type ChatSendRequest = {
  messages: ChatMessage[]
}

export type ChatSendResponse = {
  content: string
}

export type ReadTextFileRequest = {
  /** Relative to workspaceRoot. */
  path: string
}

export type WriteTextFileRequest = {
  /** Relative to workspaceRoot. */
  path: string
  content: string
  ifExists?: 'fail' | 'overwrite'
}
