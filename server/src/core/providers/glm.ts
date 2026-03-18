/**
 * GLM chat provider — Zhipu AI (GLM) OpenAI-compatible chat completions.
 */

import type { ChatMessage } from '../../types'

type OpenAIChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

export async function glmRespond(opts: {
  apiKey: string
  messages: ChatMessage[]
}): Promise<string> {
  const { apiKey, messages } = opts
  const truncated = messages.slice(-20)

  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'glm-4-plus',
      max_tokens: 4096,
      messages: truncated.map((m) => ({ role: m.role, content: m.content }))
    })
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`GLM error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`)
  }

  const data = (await res.json()) as OpenAIChatCompletionResponse
  const content = data.choices?.[0]?.message?.content ?? ''
  if (!content.trim()) throw new Error('GLM returned an empty response')
  return content
}
