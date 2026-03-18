/**
 * Stub for Electron IPC functions used by vision providers.
 * In server mode, Supabase token is managed here instead of via IPC.
 */

let _supabaseToken: string | null = null

export function getSupabaseToken(): string | null {
  return _supabaseToken
}

export function setSupabaseToken(token: string | null): void {
  _supabaseToken = token
}
