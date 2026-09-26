// Shared helpers for the Stripe billing integration — same pattern as
// api/autodesk/_lib.js (see that file for the fuller rationale): callers
// are identified by their own Supabase session (a normal bearer token),
// never by anything the client sends in a request body, and service-role
// access to Supabase never reaches the browser.
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vzqopjbwkxpawogdtvmf.supabase.co'
// Public by design (same key used in src/lib/supabase.js) — safe to embed.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6cW9wamJ3a3hwYXdvZ2R0dm1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI2NjEsImV4cCI6MjA4OTkzODY2MX0.f34d9XvNldLCSe2ZwSUZZva1gpJVYpAhONzZdzVdkUE'

export function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

// Service-role client — bypasses RLS entirely, so every route here resolves
// WHO is calling from their verified Supabase session first (getSupabaseUser
// below), then uses this only to read/write that same person's own company,
// never anything a request body claims.
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

// Looks up the caller's own organization_id + role — every route here
// needs both: organization_id to know whose billing to touch, role to
// confirm they're actually allowed to touch it (billing is admin-only,
// same as everything else in Company Hub — see CompanyHub.jsx's own
// isAdmin gate). There is no RLS to fall back on for that check: these
// routes read/write through adminClient(), which bypasses RLS entirely,
// so the admin-only rule has to be enforced here in code instead.
export async function getCallerProfile(userId) {
  const admin = adminClient()
  const { data, error } = await admin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .single()
  if (error || !data) return null
  return data
}
