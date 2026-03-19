/**
 * Vision model dispatch — routes to the appropriate provider's vision function.
 * Normalizes different return types to { text, usage? }.
 */

import type { ProviderId } from '../../types';
import type { VisionMessage } from '../providers/codex-vision';
import { codexVisionRespond } from '../providers/codex-vision';

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
  switch (provider) {
    case 'chatgpt': {
      const text = await codexVisionRespond({ systemPrompt, messages, sessionId, model });
      return { text };
    }
    case 'claude': {
      const { claudeVisionRespond } = await import('../providers/claude-vision');
      return claudeVisionRespond({ systemPrompt, messages });
    }
    case 'deepseek': {
      const { deepseekVisionRespond } = await import('../providers/deepseek-vision');
      return deepseekVisionRespond({ systemPrompt, messages });
    }
    case 'kimi':
    case 'glm':
    case 'minimax':
    case 'openrouter':
    case 'gemini': {
      const modMap: Record<string, () => Promise<(...args: any[]) => any>> = {
        kimi: () => import('../providers/kimi-vision').then((m) => m.kimiVisionRespond),
        glm: () => import('../providers/glm-vision').then((m) => m.glmVisionRespond),
        minimax: () => import('../providers/minimax-vision').then((m) => m.minimaxVisionRespond),
        openrouter: () => import('../providers/openrouter-vision').then((m) => m.openrouterVisionRespond),
        gemini: () => import('../providers/gemini-vision').then((m) => m.geminiVisionRespond),
      };
      const fn = await modMap[provider]();
      const result = await fn({ systemPrompt, messages });
      return result;
    }
    case 'ollama': {
      const { ollamaVisionRespond } = await import('../providers/ollama-vision');
      const result = await ollamaVisionRespond({ systemPrompt, messages });
      return result;
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
