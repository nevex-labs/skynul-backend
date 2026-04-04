/**
 * Vision stream — wraps provider calls as an AsyncGenerator yielding text chunks.
 * For streaming providers (Codex), yields deltas as they arrive.
 * For non-streaming providers, yields the full response as a single chunk.
 */

import type { ProviderId } from '../../../types';
import type { VisionMessage } from '../../../types';
import { codexVisionRespond } from '../../providers/codex-vision';
import { parseSSE } from '../../providers/sse';

export type StreamChunk = {
  type: 'delta' | 'done' | 'error';
  text?: string;
  fullText?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
};

/**
 * Stream vision response as an async generator.
 * Yields { type: 'delta', text } for each chunk.
 * Yields { type: 'done', fullText, usage } at the end.
 * Yields { type: 'error', error } on failure.
 */
export async function* streamVision(
  provider: ProviderId,
  systemPrompt: string,
  messages: VisionMessage[],
  sessionId?: string,
  model?: string
): AsyncGenerator<StreamChunk> {
  if (provider === 'chatgpt') {
    yield* streamCodex(systemPrompt, messages, sessionId, model);
    return;
  }

  // Non-streaming providers: call normally, yield full text as single chunk
  try {
    const { callVision } = await import('../vision-dispatch');
    const result = await callVision(provider, systemPrompt, messages, sessionId, model);
    yield { type: 'delta', text: result.text };
    yield { type: 'done', fullText: result.text, usage: result.usage };
  } catch (e) {
    yield { type: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Stream Codex (ChatGPT) responses via SSE.
 * Yields text deltas as they arrive from the API.
 */
async function* streamCodex(
  systemPrompt: string,
  messages: VisionMessage[],
  sessionId?: string,
  model?: string
): AsyncGenerator<StreamChunk> {
  // Reuse the fetch + auth logic from codexVisionRespond but stream the events.
  // We import the internal pieces we need.
  const { CHATGPT_CODEX_API_ENDPOINT, loadTokens, refreshIfNeeded, saveTokens } = await import(
    '../../providers/chatgpt-oauth'
  );

  let tokens = await loadTokens();
  if (!tokens || !tokens.access) {
    yield { type: 'error', error: 'Provider not connected. Sign in from Settings.' };
    return;
  }

  tokens = await refreshIfNeeded(tokens);
  await saveTokens(tokens);

  // Convert messages to Codex format (reuse the internal logic)
  const { codexVisionRespond: _unused, ...codexModule } = await import('../../providers/codex-vision');

  // Build request inline since convertMessages is not exported
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'responses=experimental',
    originator: 'pi',
    accept: 'text/event-stream',
  };
  if (tokens.accountId) {
    headers['chatgpt-account-id'] = tokens.accountId;
  }

  // Convert our VisionMessages to Codex input format
  const input = convertToCodexInput(messages.slice(-20));

  const body: Record<string, unknown> = {
    model: model || 'gpt-5.3-codex',
    store: false,
    stream: true,
    instructions: systemPrompt,
    input,
    text: { verbosity: 'medium' },
    include: ['reasoning.encrypted_content'],
    tool_choice: 'auto',
    parallel_tool_calls: true,
    reasoning: { effort: 'medium', summary: 'auto' },
  };

  if (sessionId) {
    body.prompt_cache_key = sessionId;
  }

  let res: Response;
  try {
    res = await fetch(CHATGPT_CODEX_API_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    yield { type: 'error', error: `ChatGPT fetch error: ${e instanceof Error ? e.message : String(e)}` };
    return;
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    yield {
      type: 'error',
      error: `ChatGPT Codex vision error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`,
    };
    return;
  }

  if (!res.body) {
    yield { type: 'error', error: 'ChatGPT returned no response body' };
    return;
  }

  let accumulated = '';

  try {
    for await (const evt of parseSSE(res)) {
      if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
        accumulated += evt.delta;
        yield { type: 'delta', text: evt.delta };
      }
      if (evt.type === 'response.done' || evt.type === 'response.completed') {
        break;
      }
      if (evt.type === 'response.failed' || evt.type === 'error') {
        const msg = (evt.message as string) ?? (evt.code as string) ?? 'Unknown error';
        yield { type: 'error', error: `ChatGPT stream error: ${msg}` };
        return;
      }
    }
  } catch (e) {
    yield { type: 'error', error: `Stream read error: ${e instanceof Error ? e.message : String(e)}` };
    return;
  }

  if (!accumulated.trim()) {
    yield { type: 'error', error: 'ChatGPT vision returned an empty response' };
    return;
  }

  yield { type: 'done', fullText: accumulated };
}

// ── Message conversion for Codex ──────────────────────────────────────────

type UserContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; detail: 'auto' | 'low' | 'high'; image_url: string };

let _msgCounter = 0;

function convertToCodexInput(messages: VisionMessage[]): unknown[] {
  return messages.map((msg) => {
    if (msg.role === 'user') {
      return {
        role: 'user',
        content: msg.content.map((part) => {
          if (part.type === 'input_image') {
            return {
              type: 'input_image' as const,
              detail: 'auto' as const,
              image_url: part.image_url,
            };
          }
          return { type: 'input_text' as const, text: part.text };
        }),
      };
    }

    return {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      id: `msg_skynul_${++_msgCounter}`,
      content: msg.content
        .filter((p) => p.type === 'output_text' || p.type === 'input_text')
        .map((p) => ({
          type: 'output_text' as const,
          text: p.type === 'output_text' ? p.text : (p as { type: 'input_text'; text: string }).text,
          annotations: [],
        })),
    };
  });
}
