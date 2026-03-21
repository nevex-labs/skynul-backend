import { deleteSecret, getSecret, setSecret } from '../stores/secret-store';

export const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CHATGPT_OAUTH_ISSUER = 'https://auth.openai.com';
export const CHATGPT_CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

// ─── PKCE helpers ──────────────────────────────────────────────────────────

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('');
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomString(43);
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = base64UrlEncode(hash);
  return { verifier, challenge };
}

export function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer);
}

export function buildAuthorizeUrl(
  redirectUri: string,
  pkce: { verifier: string; challenge: string },
  state: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CHATGPT_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'skynul',
  });
  return `${CHATGPT_OAUTH_ISSUER}/oauth/authorize?${params.toString()}`;
}

// ─── Token types & storage ─────────────────────────────────────────────────

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export type StoredTokens = {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
};

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return undefined;
  }
}

function extractAccountId(tokens: TokenResponse): string | undefined {
  for (const tok of [tokens.id_token, tokens.access_token]) {
    if (!tok) continue;
    const claims = parseJwtClaims(tok) as
      | {
          chatgpt_account_id?: string;
          'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
          organizations?: Array<{ id: string }>;
        }
      | undefined;
    if (!claims) continue;
    const id =
      claims.chatgpt_account_id ||
      claims['https://api.openai.com/auth']?.chatgpt_account_id ||
      claims.organizations?.[0]?.id;
    if (id) return id;
  }
  return undefined;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkceVerifier: string
): Promise<StoredTokens> {
  const response = await fetch(`${CHATGPT_OAUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CHATGPT_CLIENT_ID,
      code_verifier: pkceVerifier,
    }).toString(),
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    throw new Error(`Token exchange failed: ${response.status}${txt ? ` - ${txt}` : ''}`);
  }
  const data = (await response.json()) as TokenResponse;
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountId: extractAccountId(data),
  };
}

async function refreshStoredTokens(stored: StoredTokens): Promise<StoredTokens> {
  const response = await fetch(`${CHATGPT_OAUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh,
      client_id: CHATGPT_CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    throw new Error(`Token refresh failed: ${response.status}${txt ? ` - ${txt}` : ''}`);
  }
  const data = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return {
    access: data.access_token,
    refresh: data.refresh_token || stored.refresh,
    expires: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountId: stored.accountId,
  };
}

export async function refreshIfNeeded(tokens: StoredTokens, marginMs = 30_000): Promise<StoredTokens> {
  if (tokens.expires - marginMs >= Date.now()) return tokens;
  return refreshStoredTokens(tokens);
}

const TOKENS_KEY = 'chatgpt.oauth.tokens';

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await setSecret(TOKENS_KEY, JSON.stringify(tokens));
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const raw = await getSecret(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await deleteSecret(TOKENS_KEY);
}
