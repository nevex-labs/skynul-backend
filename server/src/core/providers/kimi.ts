/**
 * Kimi chat provider — Anthropic-compatible Messages API
 * Endpoint: https://api.kimi.com/coding/v1/messages
 */

import type { ChatMessage } from '../../types'

type AnthropicMessage = { role: 'user' | 'assistant'; content: string }

export async function kimiRespond(opts: {
  apiKey: string
  messages: ChatMessage[]
}): Promise<string> {
  const { apiKey, messages } = opts
  const truncated = messages.slice(-20)

  const anthropicMessages: AnthropicMessage[] = truncated.map((m) => ({
    role: m.role,
    content: m.content
  }))

  const res = await fetch('https://api.kimi.com/coding/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'kimi-for-coding',
      max_tokens: 4096,
      messages: anthropicMessages
    })
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Kimi error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`)
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>
  }

  const content = data.content?.find((c) => c.type === 'text')?.text ?? ''
  if (!content.trim()) throw new Error('Kimi returned an empty response')
  return content
}
