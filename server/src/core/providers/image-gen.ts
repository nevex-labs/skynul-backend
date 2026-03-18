import { writeFile } from 'fs/promises'
import os from 'os'
import { getSecret } from '../stores/secret-store'

export async function generateImage(
  prompt: string,
  size: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024'
): Promise<string> {
  const openaiKey = await getSecret('openai.apiKey')
  if (openaiKey) return generateWithDalle(prompt, size, openaiKey)

  const geminiKey = await getSecret('gemini.apiKey')
  if (geminiKey) return generateWithImagen(prompt, geminiKey)

  throw new Error(
    'No image generation provider configured. Set an OpenAI or Gemini API key in Settings.'
  )
}

async function generateWithDalle(prompt: string, size: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size, response_format: 'b64_json' })
  })
  if (!res.ok) throw new Error(`DALL-E error ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data: Array<{ b64_json: string }> }
  return saveBase64Png(json.data[0].b64_json)
}

async function generateWithImagen(prompt: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1 }
    })
  })
  if (!res.ok) throw new Error(`Imagen error ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { predictions: Array<{ bytesBase64Encoded: string }> }
  return saveBase64Png(json.predictions[0].bytesBase64Encoded)
}

async function saveBase64Png(b64: string): Promise<string> {
  const path = `${os.tmpdir()}/skynul-gen-${Date.now()}.png`
  await writeFile(path, Buffer.from(b64, 'base64'))
  return path
}
