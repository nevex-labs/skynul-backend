/**
 * Codex vision provider — sends screenshots + text through the ChatGPT Pro
 * endpoint using OAuth tokens, following the same format as Clawdbot/OpenClaw.
 */

import type { VisionMessage } from '../../types';
import { CHATGPT_CODEX_API_ENDPOINT, loadTokens, refreshIfNeeded, saveTokens } from './chatgpt-oauth';
import { parseSSE } from './sse';

// ─── Types ────────────────────────────────────────────────────────────────────

type UserContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; detail: 'auto' | 'low' | 'high'; image_url: string };

type AssistantContentPart = {
  type: 'output_text';
  text: string;
  annotations?: unknown[];
};

// User/system messages use role+content format
type UserMessage = {
  role: 'user' | 'system';
  content: UserContentPart[];
};

// Assistant messages use the Responses API item format (type: "message")
type AssistantMessage = {
  type: 'message';
  role: 'assistant';
  content: AssistantContentPart[];
  status: 'completed';
  id: string;
};

type InputItem = UserMessage | AssistantMessage;

// ─── Message conversion ────────────────────────────────────────────────────

let _msgCounter = 0;

/**
 * Convert our internal VisionMessage[] to the flat input array
 * the Responses API expects. Key rules from Clawdbot:
 * - System prompt goes in `instructions` field ONLY (not in input)
 * - User messages: { role, content: [{ type: "input_text"|"input_image" }] }
 * - Assistant messages: { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text" }] }
 * - Images: must include `detail: "auto"`
 */
function convertMessages(messages: VisionMessage[]): InputItem[] {
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
      } as UserMessage;
    }

    // Assistant message — Responses API item format
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
    } as AssistantMessage;
  });
}

const SSE_DONE_TYPES = new Set(['response.done', 'response.completed']);
const SSE_ERROR_TYPES = new Set(['response.failed', 'error']);

function codexStreamError(evt: Record<string, unknown>): Error {
  const msg = (evt.message as string) ?? (evt.code as string) ?? 'Unknown error';
  return new Error(`ChatGPT stream error: ${msg}`);
}

async function processCodexVisionSSE(res: Response): Promise<string> {
  if (!res.body) throw new Error('ChatGPT returned no response body');
  let accumulated = '';
  for await (const evt of parseSSE(res)) {
    if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') accumulated += evt.delta;
    if (SSE_DONE_TYPES.has(evt.type as string)) break;
    if (SSE_ERROR_TYPES.has(evt.type as string)) throw codexStreamError(evt);
  }
  if (!accumulated.trim()) throw new Error('ChatGPT vision returned an empty response');
  return accumulated;
}

// ─── Main export ───────────────────────────────────────────────────────────

export async function codexVisionRespond(opts: {
  systemPrompt: string;
  messages: VisionMessage[];
  sessionId?: string;
  model?: string;
}): Promise<string> {
  let tokens = await loadTokens();
  if (!tokens?.access) {
    throw new Error('ChatGPT: not connected. Sign in from Settings.');
  }

  // Refresh if expired (with 30s margin)
  tokens = await refreshIfNeeded(tokens);
  await saveTokens(tokens);

  const input = convertMessages(opts.messages.slice(-20));

  // Extract accountId from stored tokens
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access}`,
    'Content-Type': 'application/json',
    // Required header discovered from Clawdbot
    'OpenAI-Beta': 'responses=experimental',
    originator: 'pi',
    accept: 'text/event-stream',
  };
  if (tokens.accountId) {
    headers['chatgpt-account-id'] = tokens.accountId;
  }

  const body: Record<string, unknown> = {
    model: opts.model || 'gpt-5.3-codex',
    store: false,
    stream: true,
    // System prompt goes in `instructions`, NOT as a message in input
    instructions: opts.systemPrompt,
    input,
    text: { verbosity: 'medium' },
    include: ['reasoning.encrypted_content'],
    tool_choice: 'auto',
    parallel_tool_calls: true,
    reasoning: { effort: 'medium', summary: 'auto' },
  };

  if (opts.sessionId) {
    body.prompt_cache_key = opts.sessionId;
  }

  const res = await fetch(CHATGPT_CODEX_API_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ChatGPT Codex vision error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
  }

  return processCodexVisionSSE(res);
}
