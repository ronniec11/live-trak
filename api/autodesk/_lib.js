// Shared helpers for the Autodesk Platform Services (APS) integration.
// Leading underscore keeps Vercel from treating this file as its own route.
//
// Design notes — why this isn't a literal port of the original sketch:
// - APS tokens never reach the browser. auth.js/callback.js/status.js/
//   projects.js/sheets.js all resolve "who is this" from the caller's own
//   Supabase session (the same access_token the app already holds from
//   supabase.auth.getSession()) and keep the APS access/refresh token
//   server-side the whole time, in a table the client has no SELECT/UPDATE
//   access to at all (see supabase-migration-aps-connections.sql) —
//   `profiles` has a `FOR SELECT USING (true)` policy (any signed-in
//   teammate can read any other teammate's profile row — used throughout
//   the app, e.g. CompanyHub's team list), so storing tokens as profile
//   columns would have handed every teammate everyone else's Autodesk
//   credentials.
// - The OAuth `state` param is an HMAC-signed, timestamped blob carrying
//   the Live-Trak user id that started the flow — it's both this flow's
//   CSRF protection and how callback.js knows which account to attach the
//   resulting tokens to (a bare redirect-based callback has no other way
//   to know that).
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SUPABASE_URL = 'https://vzqopjbwkxpawogdtvmf.supabase.co'
// Public by design (same key used in src/lib/supabase.js) — safe to embed.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6cW9wamJ3a3hwYXdvZ2R0dm1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI2NjEsImV4cCI6MjA4OTkzODY2MX0.f34d9XvNldLCSe2ZwSUZZva1gpJVYpAhONzZdzVdkUE'

export function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

// Service-role client — bypasses RLS entirely, so this must never be built
// from or exposed to anything the browser can influence beyond the
// already-verified Supabase user id.
export function adminClient() {
  return createClient(SUPABASE_URL, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Verifies the caller's Supabase session (sent as a normal bearer token)
// and returns the authenticated user, or null if it's missing/invalid.
// Uses the anon key deliberately — this only needs to ask Supabase Auth
// "whose token is this", not bypass RLS.
export async function getSupabaseUser(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes to complete the Autodesk consent screen

function stateSecret() {
  // Falls back to the client secret rather than requiring yet another env
  // var up front — it's already a server-only secret with the right
  // properties (long, random, never sent to the browser). Set a dedicated
  // APS_STATE_SECRET later if you'd rather not reuse it.
  return process.env.APS_STATE_SECRET || requireEnv('APS_CLIENT_SECRET')
}

export function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(state) {
  if (!state || !state.includes('.')) return null
  const [body, sig] = state.split('.')
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  // Constant-time compare — this is a CSRF/integrity token, so timing
  // differences on the comparison shouldn't leak anything about it.
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (Date.now() - payload.ts > STATE_TTL_MS) return null
  return payload
}

// Looks up the caller's stored APS tokens and refreshes them first if
// they're at/near expiry, so every proxy endpoint can just call this and
// get back something usable — refresh_token rotation (APS issues a new
// one on every refresh) is handled here once instead of in each route.
export async function getValidApsToken(userId) {
  const admin = adminClient()
  const { data: conn, error } = await admin
    .from('aps_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !conn) return null

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0
  if (expiresAt - Date.now() > 60 * 1000) return conn.access_token // still good for >1min

  if (!conn.refresh_token) return null
  const resp = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      client_id: requireEnv('APS_CLIENT_ID'),
      client_secret: requireEnv('APS_CLIENT_SECRET'),
    }),
  })
  const tokens = await resp.json()
  if (!resp.ok || tokens.error) {
    console.error('[aps] refresh failed:', tokens)
    return null
  }
  await admin.from('aps_connections').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || conn.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId)
  return tokens.access_token
}
