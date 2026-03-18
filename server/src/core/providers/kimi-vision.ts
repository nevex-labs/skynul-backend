/**
 * Kimi K2.5 vision provider — Anthropic-compatible messages API
 * at api.kimi.com/coding/v1/messages.
 *
 * K2.5 is a native multimodal model that supports text + image input.
 * Images are sent as base64 in Anthropic's image content block format.
 */

import { getSecret } from '../stores/secret-store'
import type { VisionMessage } from './codex-vision'

/** Anthropic-style content block */
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export async function kimiVisionRespond(opts: {
  systemPrompt: string
  messages: VisionMessage[]
}): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const apiKey = await getSecret('kimi.apiKey')
  if (!apiKey) throw new Error('Kimi API key is not set. Configure it in Settings.')

  // Convert internal VisionMessage format → Anthropic messages format
  const anthropicMessages: AnthropicMessage[] = []

  for (const m of opts.messages.slice(-10)) {
    if (m.role === 'assistant') {
      const text = m.content
        .filter((p) => p.type === 'output_text' || p.type === 'input_text')
        .map((p) => p.text)
        .join('')
      anthropicMessages.push({ role: 'assistant', content: text })
    } else {
      const parts: ContentBlock[] = []
      for (const part of m.content) {
        if (part.type === 'input_image') {
          // Extract base64 data and media type from data URL
          const match = part.image_url.match(/^data:(image\/[^;]+);base64,(.+)$/)
          if (match) {
            parts.push({
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] }
            })
          }
        } else {
          parts.push({ type: 'text', text: part.text })
        }
      }
      anthropicMessages.push({ role: 'user', content: parts })
    }
  }

  // Retry with exponential backoff on 429
  let res: Response | null = null
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    res = await fetch('https://api.kimi.com/coding/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'k2p5',
        max_tokens: 4096,
        system: opts.systemPrompt,
        messages: anthropicMessages
      })
    })

    if (res.status !== 429) break

    if (attempt < MAX_RETRIES - 1) {
      const waitMs = Math.min(15_000 * (attempt + 1), 60_000)
      await new Promise((r) => setTimeout(r, waitMs))
    } else {
      const txt = await res.text().catch(() => '')
      throw new Error(
        `Kimi vision error: 429 Too Many Requests after ${MAX_RETRIES} retries${txt ? ` - ${txt}` : ''}`
      )
    }
  }

  if (!res!.ok) {
    const txt = await res!.text().catch(() => '')
    console.error('[Kimi Vision] API error:', res!.status, txt)
    throw new Error(`Kimi API error ${res!.status}: ${txt || res!.statusText}`)
  }

  const data = (await res!.json()) as {
    content?: Array<{ type: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }

  const content = data.content?.find((c) => c.type === 'text')?.text ?? ''
  console.log(
    '[Kimi Vision] response length:',
    content.length,
    'first 300 chars:',
    content.slice(0, 300)
  )

  if (!content.trim()) throw new Error('Kimi returned an empty response')

  const inputTokens = data.usage?.input_tokens
  const outputTokens = data.usage?.output_tokens
  const usage =
    typeof inputTokens === 'number' && typeof outputTokens === 'number'
      ? { inputTokens, outputTokens }
      : undefined

  return { text: content, usage }
}
