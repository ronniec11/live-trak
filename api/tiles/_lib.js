// Shared helpers for the server-side tile generation fallback — same
// pattern as api/stripe/_lib.js (see that file for the fuller rationale):
// callers are identified by their own Supabase session, never by anything
// the client sends in a request body, and service-role access to Supabase
// never reaches the browser.
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vzqopjbwkxpawogdtvmf.supabase.co'
// Public by design (same key used in src/lib/supabase.js) — safe to embed.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6cW9wamJ3a3hwYXdvZ2R0dm1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI2NjEsImV4cCI6MjA4OTkzODY2MX0.f34d9XvNldLCSe2ZwSUZZva1gpJVYpAhONzZdzVdkUE'

export function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

// Service-role client — bypasses RLS entirely (needed to read the private
// floor-plans bucket and write floor-plan-tiles/pages regardless of whose
// session is calling), so generate.js resolves WHO is calling and checks
// their role BEFORE touching anything through this.
export function adminClient() {
  return createClient(SUPABASE_URL, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Verifies the caller's Supabase session (sent as a normal bearer token)
// and returns the authenticated user, or null if it's missing/invalid.
export async function getSupabaseUser(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

// Resolves a page id to everything generate.js needs: the page row itself,
// its owning organization (walking page -> project (Scope) -> job ->
// organization, the same chain storage_path_org_id() walks for RLS — see
// supabase-migration-org-scoping-stage4-storage.sql), and whether the
// caller is allowed to trigger tiling for it (same roles ScopeDetail.jsx's
// own canManage allows: admin, pm, superintendent).
export async function loadPageForCaller(admin, pageId, userId) {
  const { data: page, error: pageErr } = await admin
    .from('pages')
    .select('id, name, floor_plan_url, project_id, projects!inner(id, job_id, jobs!inner(id, organization_id))')
    .eq('id', pageId)
    .single()
  if (pageErr || !page) return { error: 'Page not found.' }

  const organizationId = page.projects?.jobs?.organization_id
  if (!organizationId) return { error: 'Could not resolve this page\'s organization.' }

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .single()
  if (profileErr || !profile) return { error: 'Profile not found.' }
  if (profile.organization_id !== organizationId) return { error: 'This page does not belong to your company.' }
  if (!['admin', 'pm', 'superintendent'].includes(profile.role)) return { error: 'Only an admin, PM, or superintendent can generate tiles.' }

  return { page, projectId: page.project_id }
}
