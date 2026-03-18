/**
 * OpenRouter chat provider — OpenAI-compatible Chat Completions API.
 */

import type { ChatMessage } from '../../types'

type OpenAIChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

export async function openrouterRespond(opts: {
  apiKey: string
  messages: ChatMessage[]
}): Promise<string> {
  const { apiKey, messages } = opts
  const truncated = messages.slice(-20)

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      // OpenRouter Auto Router
      model: 'openrouter/auto',
      max_tokens: 4096,
      messages: truncated.map((m) => ({ role: m.role, content: m.content }))
    })
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OpenRouter error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`)
  }

  const data = (await res.json()) as OpenAIChatCompletionResponse
  const content = data.choices?.[0]?.message?.content ?? ''
  if (!content.trim()) throw new Error('OpenRouter returned an empty response')
  return content
}
