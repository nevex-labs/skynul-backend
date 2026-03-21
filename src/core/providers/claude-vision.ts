/**
 * Claude vision provider — routes vision requests through the Supabase
 * edge function `chat-claude`, which holds the Anthropic API key.
 */

import type { VisionMessage } from '../../types';
import { buildSupabaseVisionRequest, createVisionProvider } from './base-vision';
import { convertToEdgeMessages } from './vision-utils';

export const claudeVisionRespond = createVisionProvider({
  name: 'Claude',
  buildRequest: (opts) => ({
    ...buildSupabaseVisionRequest({ ...opts, edgeFunction: 'chat-claude' }),
    body: { messages: convertToEdgeMessages(opts.messages), mode: 'vision', systemPrompt: opts.systemPrompt },
  }),
  extractContent: (data) => (data as { content?: string }).content ?? '',
});
