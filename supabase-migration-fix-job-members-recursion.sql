-- ============================================
-- Fix "infinite recursion detected in policy for job_members" (42P17)
-- Run this in the Supabase SQL editor
-- ============================================
--
-- job_members' own SELECT policy self-references job_members directly
-- (job_id IN (SELECT job_id FROM job_members WHERE user_id = auth.uid())),
-- which Postgres can't evaluate without recursing into itself forever.
-- This codebase hit the exact same mistake twice before, for
-- project_members (supabase-migration-membership-function.sql) and jobs
-- (supabase-migration-jobs-select-scoped.sql) — both fixed the same way:
-- a SECURITY DEFINER function that runs with the function owner's
-- privileges, bypassing job_members' own RLS for this one specific,
-- narrow "is auth.uid() a row in job_members for this job" check, so
-- nothing has to recurse through RLS at all.
--
-- This has been silently breaking every read of job_members since it was
-- created — every "Project Members shows nobody" report so far was this,
-- not a display bug.

CREATE OR REPLACE FUNCTION public.is_job_member_row(target_job_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.job_members
    WHERE job_id = target_job_id AND user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "job_members_select_all_or_member" ON public.job_members;
CREATE POLICY "job_members_select_all_or_member" ON public.job_members FOR SELECT USING (
  ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
   AND job_id IN (SELECT id FROM public.jobs WHERE organization_id = public.my_organization_id()))
  OR public.is_job_member_row(job_id)
);

-- Verify afterward:
--   1. Open any job's dashboard — Project Members should actually list
--      people now instead of showing empty.
--   2. Add someone via Project Members' own "+ Add" — they should show
--      up in the list immediately after, no error.
