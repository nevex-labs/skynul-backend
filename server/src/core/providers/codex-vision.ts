/**
 * Codex vision provider — sends screenshots + text through the ChatGPT Pro
 * endpoint using OAuth tokens, following the same format as Clawdbot/OpenClaw.
 */

import { loadTokens, saveTokens } from "./codex";

const ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

// ─── Types ────────────────────────────────────────────────────────────────────

type UserContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; detail: "auto" | "low" | "high"; image_url: string };

type AssistantContentPart = {
  type: "output_text";
  text: string;
  annotations?: unknown[];
};

// User/system messages use role+content format
type UserMessage = {
  role: "user" | "system";
  content: UserContentPart[];
};

// Assistant messages use the Responses API item format (type: "message")
type AssistantMessage = {
  type: "message";
  role: "assistant";
  content: AssistantContentPart[];
  status: "completed";
  id: string;
};

type InputItem = UserMessage | AssistantMessage;

export type VisionMessage = {
  role: "user" | "assistant";
  content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string }
    | { type: "output_text"; text: string }
  >;
};

interface StoredTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

// ─── Token refresh ─────────────────────────────────────────────────────────

async function refreshStoredTokens(
  stored: StoredTokens,
): Promise<StoredTokens> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: stored.refresh,
      client_id: CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(
      `Token refresh failed: ${response.status}${txt ? ` - ${txt}` : ""}`,
    );
  }
  const data = (await response.json()) as TokenResponse;
  return {
    access: data.access_token,
    refresh: data.refresh_token || stored.refresh,
    expires: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountId: stored.accountId,
  };
}

// ─── Message conversion ────────────────────────────────────────────────────

let _msgCounter = 0;

/**
 * Convert our internal VisionMessage[] to the flat input array
 * the Responses API expects. Key rules from Clawdbot:
 * - System prompt goes in `instructions` field ONLY (not in input)
 * - User messages: { role, content: [{ type: "input_text"|"input_image" }] }
 * - Assistant messages: { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text" }] }
 * - Images: must include `detail: "auto"`
 */
function convertMessages(messages: VisionMessage[]): InputItem[] {
  return messages.map((msg) => {
    if (msg.role === "user") {
      return {
        role: "user",
        content: msg.content.map((part) => {
          if (part.type === "input_image") {
            return {
              type: "input_image" as const,
              detail: "auto" as const,
              image_url: part.image_url,
            };
          }
          return { type: "input_text" as const, text: part.text };
        }),
      } as UserMessage;
    }

    // Assistant message — Responses API item format
    return {
      type: "message",
      role: "assistant",
      status: "completed",
      id: `msg_skynul_${++_msgCounter}`,
      content: msg.content
        .filter((p) => p.type === "output_text" || p.type === "input_text")
        .map((p) => ({
          type: "output_text" as const,
          text:
            p.type === "output_text"
              ? p.text
              : (p as { type: "input_text"; text: string }).text,
          annotations: [],
        })),
    } as AssistantMessage;
  });
}

// ─── SSE parser (Clawdbot style: split on \n\n) ────────────────────────────

async function* parseSSE(
  response: Response,
): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are delimited by double newline
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const dataLines = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());

      if (dataLines.length > 0) {
        const data = dataLines.join("\n").trim();
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data) as Record<string, unknown>;
          } catch {
            // ignore malformed SSE
          }
        }
      }

      idx = buffer.indexOf("\n\n");
    }
  }
}

// ─── Main export ───────────────────────────────────────────────────────────

export async function codexVisionRespond(opts: {
  systemPrompt: string;
  messages: VisionMessage[];
  sessionId?: string;
  model?: string;
}): Promise<string> {
  let tokens = await loadTokens();
  if (!tokens || !tokens.access) {
    throw new Error("ChatGPT: not connected. Sign in from Settings.");
  }

  // Refresh if expired (with 30s margin)
  if (tokens.expires - 30_000 < Date.now()) {
    tokens = await refreshStoredTokens(tokens);
    await saveTokens(tokens);
  }

  const input = convertMessages(opts.messages.slice(-20));

  // Extract accountId from stored tokens
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access}`,
    "Content-Type": "application/json",
    // Required header discovered from Clawdbot
    "OpenAI-Beta": "responses=experimental",
    originator: "pi",
    accept: "text/event-stream",
  };
  if (tokens.accountId) {
    headers["chatgpt-account-id"] = tokens.accountId;
  }

  const body: Record<string, unknown> = {
    model: opts.model || "gpt-5.3-codex",
    store: false,
    stream: true,
    max_output_tokens: 4096,
    // System prompt goes in `instructions`, NOT as a message in input
    instructions: opts.systemPrompt,
    input,
    text: { verbosity: "medium" },
    include: ["reasoning.encrypted_content"],
    tool_choice: "auto",
    parallel_tool_calls: true,
    reasoning: { effort: "medium", summary: "auto" },
  };

  if (opts.sessionId) {
    body.prompt_cache_key = opts.sessionId;
  }

  const res = await fetch(CODEX_API_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `ChatGPT Codex vision error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ""}`,
    );
  }

  if (!res.body) throw new Error("ChatGPT returned no response body");

  let accumulated = "";

  for await (const evt of parseSSE(res)) {
    // Clawdbot listens for these events:
    if (
      evt.type === "response.output_text.delta" &&
      typeof evt.delta === "string"
    ) {
      accumulated += evt.delta;
    }
    if (evt.type === "response.done" || evt.type === "response.completed") {
      // Stream finished
      break;
    }
    if (evt.type === "response.failed" || evt.type === "error") {
      const msg =
        (evt.message as string) ?? (evt.code as string) ?? "Unknown error";
      throw new Error(`ChatGPT stream error: ${msg}`);
    }
  }

  if (!accumulated.trim())
    throw new Error("ChatGPT vision returned an empty response");
  return accumulated;
}
