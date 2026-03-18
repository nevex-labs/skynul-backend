/**
 * Gemini vision provider — Google Generative Language API (generateContent).
 */

import { getSecret } from '../stores/secret-store'
import type { VisionMessage } from './codex-vision'

const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'

const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash'

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
}

function extractDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (m) return { mimeType: m[1], base64: m[2] }
  // Fallback: assume png base64 without prefix
  return { mimeType: 'image/png', base64: dataUrl }
}

function toText(m: VisionMessage): string {
  return m.content
    .filter((p) => p.type === 'output_text' || p.type === 'input_text')
    .map((p) => p.text)
    .join('')
}

export async function geminiVisionRespond(opts: {
  systemPrompt: string
  messages: VisionMessage[]
}): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const apiKey = await getSecret('gemini.apiKey')
  if (!apiKey) throw new Error('Gemini API key is not set. Configure it in Settings.')

  const contents: Array<{ role: 'user' | 'model'; parts: any[] }> = []

  // Put system prompt first as a user message prefix (Gemini's system_instruction exists,
  // but keeping it simple and consistent with other providers).
  if (opts.systemPrompt.trim()) {
    contents.push({ role: 'user', parts: [{ text: opts.systemPrompt }] })
  }

  for (const m of opts.messages.slice(-10)) {
    if (m.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: toText(m) }] })
      continue
    }

    const parts: any[] = []
    const text = toText(m)
    if (text.trim()) parts.push({ text })

    for (const part of m.content) {
      if (part.type !== 'input_image') continue
      const { mimeType, base64 } = extractDataUrl(part.image_url)
      parts.push({ inlineData: { mimeType, data: base64 } })
    }

    contents.push({ role: 'user', parts })
  }

  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_VISION_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: 4096
      }
    })
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Gemini vision error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`)
  }

  const data = (await res.json()) as GeminiResponse
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text.trim()) throw new Error('Gemini vision returned an empty response')
  return { text }
}
