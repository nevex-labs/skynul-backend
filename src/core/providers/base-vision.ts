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

import type { VisionMessage } from '../../shared/types';
import { getSupabaseToken } from '../supabase-token';
import { getSecret } from './secret-adapter';

export type VisionProviderConfig = {
  name: string;
  maxRetries?: number;
  messageSlice?: number;
  buildRequest: (opts: { systemPrompt: string; messages: VisionMessage[] }) =>
    | Promise<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }>
    | { url: string; headers: Record<string, string>; body: Record<string, unknown> };
  extractContent: (data: unknown) => string;
  extractUsage?: (data: unknown) => { inputTokens: number; outputTokens: number } | undefined;
};

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1 && err instanceof Error && err.message.includes('429')) {
        await new Promise((r) => setTimeout(r, Math.min(15_000 * (attempt + 1), 60_000)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export function createVisionProvider(config: VisionProviderConfig) {
  const { name, maxRetries = 3, messageSlice = 10, buildRequest, extractContent, extractUsage } = config;

  return async function visionProvider(opts: { systemPrompt: string; messages: VisionMessage[] }): Promise<{
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    const { url, headers, body } = await buildRequest({
      systemPrompt: opts.systemPrompt,
      messages: opts.messages.slice(-messageSlice),
    });

    const res = await withRetry(async () => {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!response.ok) {
        const txt = await response.text().catch(() => '');
        throw new Error(`${name} vision error ${response.status}: ${txt || response.statusText}`);
      }
      return response;
    }, maxRetries);

    const data = await res.json();
    const text = extractContent(data);
    if (!text.trim()) throw new Error(`${name} vision returned an empty response`);

    const usage = extractUsage ? extractUsage(data) : undefined;
    return { text, usage };
  };
}

export async function buildSupabaseVisionRequest(opts: {
  systemPrompt: string;
  messages: VisionMessage[];
  edgeFunction: string;
}) {
  const token = getSupabaseToken();
  if (!token) throw new Error('Not signed in. Sign in with Google from Settings.');
  const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? process.env.VITE_SUPABASE_URL ?? '';
  if (!SUPABASE_URL) throw new Error('Supabase is not configured');
  return {
    url: `${SUPABASE_URL}/functions/v1/${opts.edgeFunction}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: { messages: opts.messages, mode: 'vision', systemPrompt: opts.systemPrompt },
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
