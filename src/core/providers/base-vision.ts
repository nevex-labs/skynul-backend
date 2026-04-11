/**
 * Base vision provider factory — shared retry logic, error handling, and response extraction.
 *
 * Each provider is pure config (~15-25 lines). No inline fetch logic.
 *
 * Pattern from spec:
 * export type VisionProviderConfig = {
 *   name: string;
 *   maxRetries?: number;
 *   messageSlice?: number;
 *   buildRequest: (opts) => { url, headers, body };
 *   extractContent: (data) => string;
 *   extractUsage?: (data) => { inputTokens, outputTokens } | undefined;
 * };
 */

import { getSecret } from '../../services/secrets';
import type { VisionMessage } from '../../types';

export type VisionProviderConfig = {
  name: string;
  maxRetries?: number;
  messageSlice?: number;
  buildRequest: (opts: {
    systemPrompt: string;
    messages: VisionMessage[];
  }) =>
    | Promise<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }>
    | { url: string; headers: Record<string, string>; body: Record<string, unknown> };
  extractContent: (data: unknown) => string;
  extractUsage?: (data: unknown) => { inputTokens: number; outputTokens: number } | undefined;
};

type RetryDecision = { retry: true; backoffMs: number } | { retry: false };

function shouldRetry(err: unknown, attempt: number, maxRetries: number): RetryDecision {
  if (attempt >= maxRetries - 1) return { retry: false };
  const msg = err instanceof Error ? err.message : String(err);
  const isRateLimit = msg.includes('429');
  const isTimeout = msg.includes('timed out') || msg.includes('ETIMEDOUT');
  if (!isRateLimit && !isTimeout) return { retry: false };
  return { retry: true, backoffMs: Math.min(15_000 * (attempt + 1), 60_000) };
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number, timeoutMs: number): Promise<T> {
  const attempts = Math.max(1, maxRetries);
  let lastError: unknown = new Error('withRetry called with maxRetries <= 0');

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastError = err;
      const decision = shouldRetry(err, attempt, maxRetries);
      if (!decision.retry) throw err;
      const reason = decision.backoffMs >= 15_000 ? 'timeout' : '429';
      console.error(`[llm:retry] attempt ${attempt + 1}/${maxRetries} failed (${reason}), retrying...`);
      await new Promise((r) => setTimeout(r, decision.backoffMs));
    }
  }
  throw lastError;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`Request timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createVisionProvider(config: VisionProviderConfig) {
  const { name, maxRetries: _maxRetries = 3, messageSlice = 10, buildRequest, extractContent, extractUsage } = config;
  const LLM_TIMEOUT_MS = 60_000;
  const LLM_TIMEOUT_RETRIES = 2;

  return async function visionProvider(opts: { systemPrompt: string; messages: VisionMessage[] }): Promise<{
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    console.log(`[llm:${name}] calling with model from request`);
    const { url, headers, body } = await buildRequest({
      systemPrompt: opts.systemPrompt,
      messages: opts.messages.slice(-messageSlice),
    });

    const res = await withRetry(
      async () => {
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!response.ok) {
          const txt = await response.text().catch(() => '');
          throw new Error(`${name} vision error ${response.status}: ${txt || response.statusText}`);
        }
        return response;
      },
      LLM_TIMEOUT_RETRIES,
      LLM_TIMEOUT_MS
    );

    console.log(`[llm:${name}] response received`);
    const data = await res.json();
    const text = extractContent(data);
    if (!text.trim()) throw new Error(`${name} vision returned an empty response`);

    const usage = extractUsage ? extractUsage(data) : undefined;
    return { text, usage };
  };
}

export async function buildApiKeyVisionRequest(opts: {
  systemPrompt: string;
  messages: VisionMessage[];
  url: string;
  keyName: string;
  extraHeaders?: Record<string, string>;
  buildBody: (opts: { systemPrompt: string; messages: VisionMessage[] }) => Record<string, unknown>;
}): Promise<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> {
  const apiKey = await getSecret(opts.keyName);
  if (!apiKey) throw new Error(`${opts.keyName.split('.')[0]} API key is not set. Configure it in Settings.`);
  return {
    url: opts.url,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...opts.extraHeaders },
    body: opts.buildBody(opts),
  };
}
