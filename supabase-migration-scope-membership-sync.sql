-- ============================================
-- Scope membership sync: being on a job's team means being on every
-- scope under it, enforced at the database level
-- Run this in the Supabase SQL editor
-- ============================================
--
-- The app's own UI (AddMemberModal, AddScopeModal in ProjectDetail.jsx)
-- already does this correctly — adding someone inserts them into every
-- CURRENTLY LOADED scope, and creating a scope carries over the job's
-- CURRENTLY LOADED team. But that's only as good as whatever the client
-- has in state at that moment, and doesn't cover any other way a row
-- could ever land in project_members (SuperAdmin tooling, direct SQL,
-- a future code path) — which is exactly how Bosque DFW10's "Under
-- Floor Cleaning" scope ended up with zero of its two foreman despite
-- both being on the job.
--
-- These two triggers make the invariant hold regardless of how a row
-- gets there, going forward. Deliberately one-directional: removing
-- someone from a scope does NOT cascade to other scopes — that stays a
-- manual, scope-specific action on the Scope Details page, same as today.

-- Adding someone to ANY one scope fans them out to every sibling scope
-- under the same job. SECURITY DEFINER so this runs regardless of the
-- inserting caller's own role (bypasses project_members' own RLS for
-- this specific, narrow fan-out — same pattern as is_project_member/
-- my_organization_id elsewhere in this schema). ON CONFLICT DO NOTHING
-- both avoids a duplicate-key error when they're already on a sibling
-- scope and is what makes this safe to let re-trigger itself: each
-- fanned-out insert re-fires this trigger, but by then every sibling
-- already has the row, so the recursive pass inserts nothing and stops.
CREATE OR REPLACE FUNCTION public.sync_member_to_sibling_scopes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id)
  SELECT p2.id, NEW.user_id
  FROM public.projects p1
  JOIN public.projects p2 ON p2.job_id = p1.job_id AND p2.id <> p1.id
  WHERE p1.id = NEW.project_id
  ON CONFLICT (project_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_member_to_sibling_scopes ON public.project_members;
CREATE TRIGGER trg_sync_member_to_sibling_scopes
AFTER INSERT ON public.project_members
FOR EACH ROW
EXECUTE FUNCTION public.sync_member_to_sibling_scopes();

-- A brand new scope inherits everyone already on any of the job's other
-- scopes, so it isn't invisible to the team already working that job
-- until someone remembers to add them one at a time.
CREATE OR REPLACE FUNCTION public.seed_new_scope_with_job_members()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id)
  SELECT DISTINCT NEW.id, pm.user_id
  FROM public.project_members pm
  JOIN public.projects p ON p.id = pm.project_id
  WHERE p.job_id = NEW.job_id AND p.id <> NEW.id
  ON CONFLICT (project_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_new_scope_with_job_members ON public.projects;
CREATE TRIGGER trg_seed_new_scope_with_job_members
AFTER INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.seed_new_scope_with_job_members();

-- Backfill: sync everyone who's already on at least one scope of a job
-- onto every other scope of that same job, one time, for all EXISTING
-- data (this is what closes the Bosque DFW10 gap generally, beyond the
-- one INSERT already run for Ronnie G/Armani specifically — any other
-- job with the same kind of gap gets fixed here too).
INSERT INTO public.project_members (project_id, user_id)
SELECT DISTINCT p2.id, pm.user_id
FROM public.project_members pm
JOIN public.projects p1 ON p1.id = pm.project_id
JOIN public.projects p2 ON p2.job_id = p1.job_id AND p2.id <> p1.id
ON CONFLICT (project_id, user_id) DO NOTHING;

-- Verify afterward:
--   1. Add a team member to a job with 2+ scopes — they should show up
--      as a member of ALL of them immediately, not just one.
--   2. Create a new scope on a job that already has team members — the
--      new scope should already list them as members, unadded by hand.
--   3. Remove someone from one scope's team (Scope Details page) —
--      confirm they're still a member of the job's OTHER scopes
--      afterward (removal didn't cascade).
