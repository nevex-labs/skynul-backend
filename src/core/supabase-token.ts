/**
 * In-memory Supabase auth token store for vision providers.
 */

let _supabaseToken: string | null = null;

export function getSupabaseToken(): string | null {
  return _supabaseToken;
}

export function setSupabaseToken(token: string | null): void {
  _supabaseToken = token;
}
