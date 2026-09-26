-- ============================================
-- Unlimited access: move the grant from per-JOB to per-COMPANY
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Supersedes the "unlimited access" half of supabase-migration-plan-
-- limits.sql — that version put the override on jobs.unlimited_until,
-- exempting one project's own scope/session limits. This moves it to
-- organizations.unlimited_until instead: granted from the Super Admin
-- panel on the COMPANY itself, exempting every limit in
-- src/lib/planLimits.js (users, projects, scopes per project, sessions
-- per project — all of it) for the whole org, for the period granted.
--
-- Safe to run whether or not the old jobs-side migration was ever applied
-- (every statement below is IF EXISTS/IF NOT EXISTS).

-- ── Undo the old per-job version ────────────────────────────────────────
DROP TRIGGER IF EXISTS jobs_guard_unlimited_until ON public.jobs;
DROP FUNCTION IF EXISTS public.guard_jobs_unlimited_until();
ALTER TABLE public.jobs DROP COLUMN IF EXISTS unlimited_until;
-- jobs_update_super_admin (added alongside the old column) is left in
-- place — it's a generically useful grant for the Super Admin panel to
-- edit any job, not something specific to unlimited_until.

-- ── New per-company version ──────────────────────────────────────────────
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS unlimited_until timestamptz;

-- Same reasoning as the jobs trigger this replaces: a company's own admin
-- already has unrestricted UPDATE on their OWN organizations row (see
-- CompanyHub.jsx's save calls, backed by supabase-migration-company-
-- hub.sql's organizations_update_admin) — with no column-level
-- restriction, they could set this column directly and hand themselves a
-- free bypass of their own plan's limits, even with no UI for it. This
-- reverts any change to it from a caller who ISN'T is_super_admin().
-- (organizations_update_super_admin, letting a super admin actually SET
-- it on any company, already exists from supabase-migration-super-
-- admin.sql — nothing new needed there.)
CREATE OR REPLACE FUNCTION public.guard_organizations_unlimited_until()
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

DROP TRIGGER IF EXISTS organizations_guard_unlimited_until ON public.organizations;
CREATE TRIGGER organizations_guard_unlimited_until
BEFORE INSERT OR UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.guard_organizations_unlimited_until();
