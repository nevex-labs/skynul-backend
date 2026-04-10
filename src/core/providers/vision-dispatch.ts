import type { ProviderId, VisionMessage } from '../../types';
import { codexVisionRespond } from './codex-vision';

export type VisionResult = {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export async function callVision(
  provider: ProviderId,
  systemPrompt: string,
  messages: VisionMessage[],
  sessionId?: string,
  model?: string
): Promise<VisionResult> {
  if (provider === 'chatgpt') {
    const text = await codexVisionRespond({ systemPrompt, messages, sessionId, model });
    return { text };
  }
  if (provider === 'claude') {
    const { claudeVisionRespond } = await import('./claude-vision');
    return claudeVisionRespond({ systemPrompt, messages });
  }
  if (provider === 'ollama') {
    const { ollamaVisionRespond } = await import('./ollama-vision');
    return ollamaVisionRespond({ systemPrompt, messages });
  }
  if (provider === 'openrouter') {
    const { openrouterVisionRespond } = await import('./openrouter-vision');
    return openrouterVisionRespond({ systemPrompt, messages });
  }
  throw new Error(`Unsupported provider: ${provider}`);
}
