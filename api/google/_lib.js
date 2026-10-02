// Google-specific helpers for the Drive integration. Generic Supabase/
// OAuth-state plumbing lives in api/_shared/auth.js (shared with the
// Autodesk integration) — this file only keeps what's actually Google-
// specific: refreshing a stored Drive token.
import { adminClient, getSupabaseUser, requireEnv, signState, verifyState } from '../_shared/auth.js'

export { adminClient, getSupabaseUser, requireEnv, signState, verifyState }

const PROVIDER = 'google_drive'

// Looks up the caller's stored Google tokens and refreshes them first if
// they're at/near expiry. Google access tokens are short-lived (~1hr);
// refresh_tokens, unlike Autodesk's, are NOT rotated on refresh — Google
// keeps issuing the same one, so the existing value is always kept if a
// refresh response happens not to include one.
export async function getValidGoogleToken(userId) {
  const admin = adminClient()
  const { data: conn, error } = await admin
    .from('integration_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', PROVIDER)
    .maybeSingle()
  if (error || !conn) return null

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0
  if (expiresAt - Date.now() > 60 * 1000) return conn.access_token // still good for >1min

  if (!conn.refresh_token) return null
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    }),
  })
  const tokens = await resp.json()
  if (!resp.ok || tokens.error) {
    console.error('[google] refresh failed:', tokens)
    return null
  }
  await admin.from('integration_connections').update({
    access_token: tokens.access_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId).eq('provider', PROVIDER)
  return tokens.access_token
}
