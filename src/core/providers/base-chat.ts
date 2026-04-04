/**
 * Base chat provider factory — eliminates boilerplate across all OpenAI-compatible
 * and Anthropic-compatible providers.
 *
 * Each provider is pure config (~15-25 lines). No inline fetch logic.
 */

import type { ChatMessage } from '../../shared/types';

export type ChatProviderConfig = {
  name: string;
  url: string | ((dynamic: string) => string);
  model?: string;
  maxTokens?: number;
  truncateMessages?: number;
  headers?: (dynamic: string) => Record<string, string>;
  buildBody: (
    messages: { role: string; content: string }[],
    model: string,
    maxTokens: number
  ) => Record<string, unknown>;
  extractContent: (data: unknown) => string;
};

export function createChatProvider(config: ChatProviderConfig) {
  const { name, url, model = '', maxTokens = 4096, truncateMessages = 20, headers, buildBody, extractContent } = config;

  return async function chatProvider({
    dynamic,
    model: modelOverride,
    messages,
  }: {
    dynamic: string;
    model?: string;
    messages: ChatMessage[];
  }): Promise<string> {
    const truncated = messages.slice(-truncateMessages);
    const resolvedUrl = typeof url === 'function' ? url(dynamic) : url;
    const resolvedHeaders = headers ? headers(dynamic) : {};
    const resolvedModel = modelOverride ?? model;

    const res = await fetch(resolvedUrl, {
      method: 'POST',
      headers: resolvedHeaders,
      body: JSON.stringify(
        buildBody(
          truncated.map((m) => ({ role: m.role, content: m.content })),
          resolvedModel,
          maxTokens
        )
      ),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${name} error ${res.status}: ${txt || res.statusText}`);
    }

    const data = await res.json();
    const content = extractContent(data);
    if (!content.trim()) throw new Error(`${name} returned an empty response`);
    return content;
  };
}
