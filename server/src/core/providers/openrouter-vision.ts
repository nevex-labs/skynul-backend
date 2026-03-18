/**
 * OpenRouter vision provider — OpenAI-compatible Chat Completions API.
 */

import { getSecret } from '../stores/secret-store'
import type { VisionMessage } from './codex-vision'

type ImageUrlPart = { type: 'image_url'; image_url: { url: string } }
type TextPart = { type: 'text'; text: string }

type ORMessage = {
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

function toORMessages(systemPrompt: string, messages: VisionMessage[]): ORMessage[] {
  const out: ORMessage[] = [{ role: 'system', content: systemPrompt }]

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

export async function openrouterVisionRespond(opts: {
  systemPrompt: string
  messages: VisionMessage[]
}): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const apiKey = await getSecret('openrouter.apiKey')
  if (!apiKey) throw new Error('OpenRouter API key is not set. Configure it in Settings.')

  const orMessages = toORMessages(opts.systemPrompt, opts.messages)

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      // Use a vision-capable default.
      model: 'openai/gpt-4o-mini',
      max_tokens: 4096,
      messages: orMessages
    })
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(
      `OpenRouter vision error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`
    )
  }

  const data = (await res.json()) as OpenAIChatCompletionResponse
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('OpenRouter vision returned an empty response')

  const inputTokens = data.usage?.prompt_tokens
  const outputTokens = data.usage?.completion_tokens
  const usage =
    typeof inputTokens === 'number' && typeof outputTokens === 'number'
      ? { inputTokens, outputTokens }
      : undefined

  return { text, usage }
}
