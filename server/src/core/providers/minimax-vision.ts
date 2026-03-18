/**
 * MiniMax vision provider.
 *
 * NOTE: This assumes an OpenAI-compatible chat completions endpoint that
 * accepts multimodal `content` parts (text + image_url). If your MiniMax
 * account uses a different payload shape, this file is the one to adjust.
 */

import { getSecret } from '../stores/secret-store'
import type { VisionMessage } from './codex-vision'

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1'
const MINIMAX_VISION_MODEL = process.env.MINIMAX_VISION_MODEL || 'MiniMax-M2.5'
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || ''

type ImageUrlPart = { type: 'image_url'; image_url: { url: string } }
type TextPart = { type: 'text'; text: string }

type MMMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<TextPart | ImageUrlPart>
}

type OpenAIChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function toText(m: VisionMessage): string {
  return m.content
    .filter((p) => p.type === 'output_text' || p.type === 'input_text')
    .map((p) => p.text)
    .join('')
}

function toMMMessages(systemPrompt: string, messages: VisionMessage[]): MMMessage[] {
  const out: MMMessage[] = [{ role: 'system', content: systemPrompt }]

  for (const m of messages.slice(-10)) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: toText(m) })
      continue
    }

    const parts: Array<TextPart | ImageUrlPart> = []
    for (const part of m.content) {
      if (part.type === 'input_image') {
        parts.push({ type: 'image_url', image_url: { url: part.image_url } })
      } else {
        parts.push({ type: 'text', text: part.text })
      }
    }
    out.push({ role: 'user', content: parts })
  }

  return out
}

export async function minimaxVisionRespond(opts: {
  systemPrompt: string
  messages: VisionMessage[]
}): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const apiKey = await getSecret('minimax.apiKey')
  if (!apiKey) throw new Error('MiniMax API key is not set. Configure it in Settings.')

  const mmMessages = toMMMessages(opts.systemPrompt, opts.messages)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
  if (MINIMAX_GROUP_ID) headers['X-Group-Id'] = MINIMAX_GROUP_ID

  const res = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MINIMAX_VISION_MODEL,
      max_tokens: 4096,
      messages: mmMessages
    })
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(
      `MiniMax vision error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`
    )
  }

  const data = (await res.json()) as OpenAIChatCompletionResponse
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('MiniMax vision returned an empty response')

  const inputTokens = data.usage?.prompt_tokens
  const outputTokens = data.usage?.completion_tokens
  const usage =
    typeof inputTokens === 'number' && typeof outputTokens === 'number'
      ? { inputTokens, outputTokens }
      : undefined

  return { text, usage }
}
