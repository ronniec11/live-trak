-- ============================================
-- Scope membership is independent per scope (no more auto fan-out)
-- Run this in the Supabase SQL editor (after supabase-migration-job-members.sql)
-- ============================================
--
-- Reverses part of the original scope-membership-sync design: being on
-- one scope, or on the job's Project Members, used to automatically put
-- someone on every OTHER scope of that job too. In practice that's
-- wrong — a scope's crew isn't always the whole project team (e.g. one
-- superintendent only ever looks after one particular scope), so scope
-- membership needs to be chosen per scope, not inherited.
--
-- What stays: adding someone to a scope still adds them to the job
-- (Project Members) — working a scope obviously means working the job.
-- What goes: adding someone to a scope no longer fans out to sibling
-- scopes; adding someone to the job (Project Members' own "+ Add") no
-- longer fans out to any scope; a brand new scope no longer auto-seeds
-- with the job's existing members. All scope membership is now a
-- deliberate, per-scope action (AddScopeModal's member picker at
-- creation time, or the scope's own Add Scope Member afterward).
--
-- This does NOT remove anyone who already got added to a scope by the
-- old fan-out behavior — there's no way to tell an intentional add from
-- an auto-fanned one, so existing project_members rows are left alone.
-- This only changes what happens going forward.

-- Drop the job-level fan-out entirely (Project Members "+ Add" no
-- longer touches any scope's project_members).
DROP TRIGGER IF EXISTS trg_sync_job_member_to_scopes ON public.job_members;
DROP FUNCTION IF EXISTS public.sync_job_member_to_scopes();

-- Drop the new-scope auto-seed entirely (a new scope starts with
-- whatever AddScopeModal's own member picker sends, nothing more).
DROP TRIGGER IF EXISTS trg_seed_new_scope_with_job_members ON public.projects;
DROP FUNCTION IF EXISTS public.seed_new_scope_with_job_members();

-- Replace the scope-level trigger: keep the "also add to the job" half,
-- drop the "also add to every sibling scope" half.
DROP TRIGGER IF EXISTS trg_sync_member_to_sibling_scopes ON public.project_members;
DROP FUNCTION IF EXISTS public.sync_member_to_sibling_scopes();

CREATE OR REPLACE FUNCTION public.sync_scope_member_to_job()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.job_members (job_id, user_id)
  SELECT p.job_id, NEW.user_id
  FROM public.projects p
  WHERE p.id = NEW.project_id
  ON CONFLICT (job_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_scope_member_to_job ON public.project_members;
CREATE TRIGGER trg_sync_scope_member_to_job
AFTER INSERT ON public.project_members
FOR EACH ROW
EXECUTE FUNCTION public.sync_scope_member_to_job();

-- Verify afterward:
--   1. Add someone to just one scope — they should show up in that
--      job's Project Members, but NOT in the job's other scopes.
--   2. Add someone via Project Members' own "+ Add" — they should NOT
--      show up on any scope until explicitly added to one.
--   3. Create a new scope — it should start with only whoever you
--      checked in the New Scope form, not the whole project team.
