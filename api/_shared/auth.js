// Supabase + OAuth-state helpers shared by every integration (api/autodesk,
// api/google, …) and by the provider-agnostic api/integrations endpoints.
// Pulled out of what used to be api/autodesk/_lib.js once a second
// integration needed the exact same plumbing — see
// supabase-migration-integration-connections.sql for why the token
// storage itself was generalized at the same time.
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

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes to complete the provider's consent screen

function stateSecret() {
  // Falls back to the Autodesk client secret rather than requiring yet
  // another env var up front — it's already a server-only secret with the
  // right properties (long, random, never sent to the browser). Set a
  // dedicated INTEGRATION_STATE_SECRET later if you'd rather not reuse it.
  return process.env.INTEGRATION_STATE_SECRET || process.env.APS_STATE_SECRET || requireEnv('APS_CLIENT_SECRET')
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
