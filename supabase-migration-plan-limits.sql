-- ============================================
-- Free-plan usage limits: per-job unlimited override
-- Run this in the Supabase SQL editor
-- ============================================
--
-- SUPERSEDED: the unlimited-override half of this file (jobs.
-- unlimited_until + its guard trigger) was replaced by
-- supabase-migration-unlimited-access-org.sql, which moves the grant to
-- organizations.unlimited_until instead (per-company, not per-job) — run
-- that one too (or instead, if this file was never run). The free-plan
-- limit numbers themselves (src/lib/planLimits.js) are unaffected.
--
-- Backs src/lib/planLimits.js's free-plan caps (1 user, 2 projects, 1
-- scope per project, 5 sessions per project — enforced client-side, see
-- that file's own header) plus one override: a specific job can be
-- granted unlimited access for a period of time (e.g. a timed trial/demo
-- on one project), regardless of the company's plan. Granted from the
-- Super Admin panel (src/pages/SuperAdmin.jsx's company detail view).

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS unlimited_until timestamptz;

-- A company's own admin/pm already has unrestricted UPDATE on their own
-- jobs (see supabase-migration-org-scoping-stage2-rls.sql's
-- jobs_update_pm) — with no column-level restriction, they could set this
-- new column directly (even without any UI for it) and hand themselves a
-- free bypass of their own plan's limits. This trigger closes that: any
-- change to unlimited_until from a caller who ISN'T is_super_admin() is
-- silently reverted (on both INSERT and UPDATE), so only the Super Admin
-- panel's own action can actually set it.
CREATE OR REPLACE FUNCTION public.guard_jobs_unlimited_until()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.unlimited_until IS NOT NULL AND NOT public.is_super_admin() THEN
      NEW.unlimited_until := NULL;
    END IF;
  ELSE
    IF NEW.unlimited_until IS DISTINCT FROM OLD.unlimited_until AND NOT public.is_super_admin() THEN
      NEW.unlimited_until := OLD.unlimited_until;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_guard_unlimited_until ON public.jobs;
CREATE TRIGGER jobs_guard_unlimited_until
BEFORE INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_jobs_unlimited_until();

-- supabase-migration-super-admin.sql gave a super admin SELECT on jobs
-- across every company, but no UPDATE — needed now so the panel can
-- actually set unlimited_until on a job outside their own organization.
-- Additive, same as every other policy in that migration.
CREATE POLICY "jobs_update_super_admin" ON public.jobs FOR UPDATE USING (public.is_super_admin());
