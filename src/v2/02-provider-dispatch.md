# Layer 2: Provider Dispatch

## Purpose

**Single entry point** for all LLM interactions. Takes a `ProviderId`, reads the API key from secrets, calls the correct provider implementation, and returns the raw text response.

## Contract

```typescript
interface ProviderDispatch {
  /**
   * Send messages to an LLM provider and get a text response.
   * 
   * @param provider - The LLM provider to use (already resolved or explicitly chosen).
   * @param messages - Array of chat messages (role + content).
   * @param userId - Optional user ID for reading user-specific secrets.
   * @returns string - The raw text response from the LLM.
   * @throws Error - If the provider is not configured or the API call fails.
   */
  chat(provider: ProviderId, messages: ChatMessage[], userId?: number): Promise<string>;
  
  /**
   * Send messages with streaming support.
   * 
   * @returns AsyncIterable<string> - Chunks of text as they arrive.
   */
  stream(provider: ProviderId, messages: ChatMessage[], userId?: number): AsyncIterable<string>;
}
```

## Responsibilities

1. **Read API key from secrets table** (via `getSecret(keyName, userId)`)
2. **Route to the correct provider implementation** (gemini, claude, openai, etc.)
3. **Handle provider-specific request formatting** (each provider has its own API shape)
4. **Extract and return the text content** from the response
5. **Throw on failure** (no key, API error, empty response)

## What This Layer Does NOT Do

- Does NOT resolve which provider to use (that's Layer 1's job)
- Does NOT manage conversation history
- Does NOT parse actions or tool calls
- Does NOT retry with different providers
- Does NOT read from `.env`

## Provider Implementations

Each provider is a thin adapter (~15-25 lines) that knows:
- Its API endpoint URL
- How to format the request (headers, body shape)
- How to extract the response text

```
src/core/providers/
├── dispatch.ts          ← Single entry point (this layer)
├── gemini.ts            ← Gemini adapter
├── claude.ts            ← Claude adapter
├── deepseek.ts          ← DeepSeek adapter
├── openai.ts            ← OpenAI adapter (for chatgpt)
├── openrouter.ts        ← OpenRouter adapter
├── kimi.ts              ← Kimi adapter
├── glm.ts               ← GLM adapter
├── minimax.ts           ← MiniMax adapter
├── ollama.ts            ← Ollama adapter (local, no key)
├── base-chat.ts         ← Shared factory for OpenAI-compatible providers
└── secret-adapter.ts    ← Secret table access (shared utility)
```

## Request Flow

```
dispatch.chat('gemini', messages, userId)
  │
  ├─ 1. getSecret('gemini.apiKey', userId)
  │     └─ Returns API key or null
  │
  ├─ 2. If no key → throw Error
  │
  ├─ 3. Call geminiRespond({ dynamic: apiKey, messages })
  │     └─ Build request → fetch → extract content
  │
  └─ 4. Return text response
```

## Error Handling

| Error | Behavior |
|-------|----------|
| No API key in secrets | `throw Error("gemini API key is not configured")` |
| API returns 4xx/5xx | `throw Error("Gemini error 429: ...")` |
| Empty response | `throw Error("Gemini returned an empty response")` |
| Network timeout | Propagated from fetch |

## Dependencies

- `secrets` table (via `getSecret`)
- Individual provider implementations
- `ChatMessage` type from shared types

## File

```
src/v2/provider-dispatch.ts  ← Re-exports from src/core/providers/dispatch.ts
```

The existing `dispatch.ts` already follows this pattern. The v2 version will:
- Remove any remaining `.env` fallbacks
- Remove any hardcoded keys
- Ensure all providers go through `getSecret`
