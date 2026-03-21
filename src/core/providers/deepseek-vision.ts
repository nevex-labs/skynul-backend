/**
 * Deepseek vision provider — routes vision requests through the Supabase
 * edge function `chat-deepseek`, which holds the Deepseek API key.
 */

import type { VisionMessage } from '../../types';
import { buildSupabaseVisionRequest, createVisionProvider } from './base-vision';
import { convertToEdgeMessages } from './vision-utils';

export const deepseekVisionRespond = createVisionProvider({
  name: 'Deepseek',
  buildRequest: (opts) => ({
    ...buildSupabaseVisionRequest({ ...opts, edgeFunction: 'chat-deepseek' }),
    body: { messages: convertToEdgeMessages(opts.messages), mode: 'vision', systemPrompt: opts.systemPrompt },
  }),
  extractContent: (data) => (data as { content?: string }).content ?? '',
});
