-- ============================================
-- Super Admin panel: cross-company visibility for is_super_admin users
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Every RLS policy added by the Stage 1-6 multi-tenant migrations (see
-- supabase-migration-org-scoping-stage*.sql) deliberately scopes reads and
-- writes to the CALLER'S OWN organization — that's the entire point of
-- those migrations. src/pages/SuperAdmin.jsx needs the opposite: one
-- trusted, explicitly-flagged account that can see and manage every
-- company at once (list every organization, every user, every job, roll
-- up total SF per company, suspend a company, reassign a user's role or
-- company).
--
-- This is purely ADDITIVE — every policy below is a new, separate policy,
-- never a DROP/replace of an existing one. Postgres evaluates multiple
-- permissive policies for the same command as OR'd together, so this only
-- ever WIDENS access (for is_super_admin() callers only), never narrows
-- anything the Stage 1-6 policies already allow everyone else.

-- ── profiles.is_super_admin ─────────────────────────────────────────────
-- Defaults false — nobody is a super admin until this is set by hand
-- (there is no self-serve way to become one, on purpose):
--   UPDATE public.profiles SET is_super_admin = true WHERE email = 'you@yourcompany.com';
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- ── organizations.status ────────────────────────────────────────────────
-- Backs the Companies table's Suspend action. Nothing else in the app
-- reads this yet — a suspended company's users can still sign in and use
-- Live-Trak normally today; this column only exists for the super admin
-- panel to set and display. Enforcing an actual lockout (e.g. in
-- ProtectedRoute.jsx, the way profiles.active already works) is a
-- deliberate follow-up, not bundled into this migration.
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));

-- ── is_super_admin() helper ──────────────────────────────────────────────
-- Same SECURITY DEFINER + STABLE pattern as my_organization_id()
-- (supabase-migration-org-scoping-stage2-rls.sql) — reads profiles.
-- directly under elevated privilege so it isn't blocked by (or doesn't
-- itself trigger recursion through) profiles' own RLS.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()), false);
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ── Read access across every company ────────────────────────────────────
-- One SELECT bypass per table the panel needs to read. jobs/projects/pages
-- are all read so the panel can compute each company's job count and roll
-- up total SF client-side by walking sessions -> pages -> projects -> jobs
-- -> organization_id (sessions has no organization_id of its own — see
-- Stage 2's own comment on that same chain).
CREATE POLICY "organizations_select_super_admin" ON public.organizations FOR SELECT USING (public.is_super_admin());
CREATE POLICY "profiles_select_super_admin"      ON public.profiles      FOR SELECT USING (public.is_super_admin());
CREATE POLICY "jobs_select_super_admin"          ON public.jobs          FOR SELECT USING (public.is_super_admin());
CREATE POLICY "projects_select_super_admin"      ON public.projects      FOR SELECT USING (public.is_super_admin());
CREATE POLICY "pages_select_super_admin"         ON public.pages         FOR SELECT USING (public.is_super_admin());
CREATE POLICY "sessions_select_super_admin"      ON public.sessions      FOR SELECT USING (public.is_super_admin());

-- ── Writes the panel actually performs ──────────────────────────────────
-- organizations: Suspend/reactivate a company (sets status).
CREATE POLICY "organizations_update_super_admin" ON public.organizations FOR UPDATE USING (public.is_super_admin());
-- profiles: Change Role, Change Company, Deactivate, and the Change Admin
-- modal's "make this person admin" — all just column updates on profiles
-- (role / organization_id / active). There is no per-project "role" on
-- project_members to update alongside it — role has only ever lived on
-- profiles.role in this schema.
CREATE POLICY "profiles_update_super_admin" ON public.profiles FOR UPDATE USING (public.is_super_admin());

-- Verify afterward, signed in as the account you flagged is_super_admin:
--   select * from organizations; -- should return every company, not just yours
--   select * from profiles;      -- should return every user, not just your org's
-- And signed in as anyone else: both should still return only your own
-- company's rows, exactly as before this migration.
