/**
 * Claude vision provider — routes vision requests through the Supabase
 * edge function `chat-claude`, which holds the Anthropic API key.
 */

import { getSupabaseToken } from '../ipc-stub'
import type { VisionMessage } from './codex-vision'

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? process.env.VITE_SUPABASE_URL ?? ''

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; base64: string }

type EdgeMessage = {
  role: 'user' | 'assistant'
  content: string | ContentPart[]
}

/**
 * Convert internal VisionMessage[] to the format our edge function expects.
 */
function convertMessages(messages: VisionMessage[]): EdgeMessage[] {
  return messages.map((msg) => {
    const parts: ContentPart[] = msg.content.map((part) => {
      if (part.type === 'input_image') {
        // Extract base64 from data URL
        const dataUrl = part.image_url
        const commaIdx = dataUrl.indexOf(',')
        const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl
        const mediaType = dataUrl.startsWith('data:')
          ? dataUrl.slice(5, dataUrl.indexOf(';'))
          : 'image/png'
        return { type: 'image', mediaType, base64 }
      }
      // input_text or output_text → text
      return { type: 'text', text: part.text }
    })

    return { role: msg.role, content: parts }
  })
}

export async function claudeVisionRespond(opts: {
  systemPrompt: string
  messages: VisionMessage[]
}): Promise<string> {
  const token = getSupabaseToken()
  if (!token) throw new Error('Not signed in. Sign in with Google from Settings.')

  if (!SUPABASE_URL) throw new Error('Supabase is not configured')

  const edgeMessages = convertMessages(opts.messages.slice(-10))

  // Retry with exponential backoff on 429 — up to 3 attempts.
  let res: Response | null = null
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    res = await fetch(`${SUPABASE_URL}/functions/v1/chat-claude`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: edgeMessages,
        mode: 'vision',
        systemPrompt: opts.systemPrompt
      })
    })

    if (res.status !== 429) break

    if (attempt < MAX_RETRIES - 1) {
      const waitMs = Math.min(15_000 * (attempt + 1), 60_000)
      await new Promise((r) => setTimeout(r, waitMs))
    } else {
      const txt = await res.text().catch(() => '')
      throw new Error(
        `Claude vision error: 429 Too Many Requests after ${MAX_RETRIES} retries${txt ? ` - ${txt}` : ''}`
      )
    }
  }

  if (!res!.ok) {
    const txt = await res!.text().catch(() => '')
    throw new Error(
      `Claude vision error: ${res!.status} ${res!.statusText}${txt ? ` - ${txt}` : ''}`
    )
  }

  const data = (await res!.json()) as { content?: string }
  const content = data.content ?? ''
  if (!content.trim()) throw new Error('Claude vision returned an empty response')
  return content
}
