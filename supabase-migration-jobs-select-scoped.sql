-- ============================================
-- Scope the jobs list to membership (fixes foremen seeing every job)
-- Run this in the Supabase SQL editor
-- ============================================
--
-- projects (scopes), pages, and sessions all already scope their SELECT to
-- "admin/pm, or a member of this project" (see
-- supabase-migration-membership-function.sql) — jobs itself never got the
-- same treatment. It apparently only ever had a single wide-open SELECT
-- policy (same situation supabase-migration-jobs-write-policies.sql found
-- for INSERT/UPDATE — jobs isn't in supabase-schema.sql or any tracked
-- migration, it was set up directly in the dashboard), so a foreman added
-- to just one scope under one job sees every job on the Projects page, not
-- only the one they were actually added to.
--
-- The existing policy's real name isn't known (it was never created from a
-- tracked migration), so this drops every SELECT policy currently on jobs
-- by querying pg_policies directly, rather than guessing a name to DROP IF
-- EXISTS, then replaces it with one policy.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.jobs', pol.policyname);
  END LOOP;
END $$;

-- SECURITY DEFINER for the same reason is_project_member is — a foreman's
-- membership check has to look at project_members, which has its own RLS
-- that (correctly) also checks project_members, and that recursion breaks
-- when nested inside another table's policy instead of run as a direct
-- top-level query (see supabase-migration-membership-function.sql's own
-- note on this exact failure mode).
CREATE OR REPLACE FUNCTION public.is_job_member(target_job_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
    WHERE p.job_id = target_job_id AND pm.user_id = auth.uid()
  );
$$;

CREATE POLICY "jobs_select_all_or_member" ON public.jobs FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR public.is_job_member(id)
);

-- Verify afterward — as the foreman who was only added to one scope, the
-- Projects page should show only that scope's job, not every job. And as
-- an admin/pm, it should still show everything.
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'jobs' ORDER BY cmd;
