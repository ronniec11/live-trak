-- ============================================
-- Independent job-level membership (Project Members)
-- Run this in the Supabase SQL editor
-- ============================================
--
-- "Project Members" (ProjectDetail.jsx's sidebar) used to be a derived
-- view — everyone who's a member of AT LEAST ONE scope (project_members)
-- under the job, with no table of its own. That meant removing someone
-- from their only scope silently removed them from the job's member
-- list too, even though the person only meant to take them off that one
-- scope's work. This adds a real, independent job_members table so
-- "Scope Members" (project_members) and "Project Members" (job_members)
-- can differ: removing someone from a scope never touches job_members,
-- and being on the job no longer requires staying on any particular
-- scope.
--
-- Both directions still auto-sync on ADD, same spirit as the existing
-- scope-to-sibling-scope sync: adding someone to a scope adds them to
-- the job too, and adding someone to the job adds them to every one of
-- its scopes. Removal is never auto-cascaded either direction — taking
-- someone off a scope is scope-specific, and (new) taking someone off
-- the job's own Project Members list is job-specific and doesn't touch
-- whatever scopes they're already on.

CREATE TABLE IF NOT EXISTS public.job_members (
  job_id     UUID REFERENCES public.jobs ON DELETE CASCADE NOT NULL,
  user_id    UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (job_id, user_id)
);

ALTER TABLE public.job_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_members_select_all_or_member" ON public.job_members;
CREATE POLICY "job_members_select_all_or_member" ON public.job_members FOR SELECT USING (
  ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
   AND job_id IN (SELECT id FROM public.jobs WHERE organization_id = public.my_organization_id()))
  OR job_id IN (SELECT job_id FROM public.job_members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "job_members_insert_pm" ON public.job_members;
CREATE POLICY "job_members_insert_pm" ON public.job_members FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND job_id IN (SELECT id FROM public.jobs WHERE organization_id = public.my_organization_id())
);

DROP POLICY IF EXISTS "job_members_delete_pm" ON public.job_members;
CREATE POLICY "job_members_delete_pm" ON public.job_members FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND job_id IN (SELECT id FROM public.jobs WHERE organization_id = public.my_organization_id())
);

-- Backfill: everyone currently showing as a Project Member (member of at
-- least one scope) becomes a real job_members row, so this migration
-- doesn't make anyone disappear from a job they're already working.
INSERT INTO public.job_members (job_id, user_id)
SELECT DISTINCT p.job_id, pm.user_id
FROM public.project_members pm
JOIN public.projects p ON p.id = pm.project_id
ON CONFLICT (job_id, user_id) DO NOTHING;

-- Adding someone to a scope also adds them to the job (in addition to
-- the existing sibling-scope fan-out) — ON CONFLICT DO NOTHING is what
-- keeps this and the job_members trigger below from recursing forever
-- once every row that should exist already does.
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

  INSERT INTO public.job_members (job_id, user_id)
  SELECT p1.job_id, NEW.user_id
  FROM public.projects p1
  WHERE p1.id = NEW.project_id
  ON CONFLICT (job_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_member_to_sibling_scopes ON public.project_members;
CREATE TRIGGER trg_sync_member_to_sibling_scopes
AFTER INSERT ON public.project_members
FOR EACH ROW
EXECUTE FUNCTION public.sync_member_to_sibling_scopes();

-- Adding someone directly to the job (Project Members' own "+ Add") fans
-- them out to every one of the job's scopes.
CREATE OR REPLACE FUNCTION public.sync_job_member_to_scopes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id)
  SELECT p.id, NEW.user_id
  FROM public.projects p
  WHERE p.job_id = NEW.job_id
  ON CONFLICT (project_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_job_member_to_scopes ON public.job_members;
CREATE TRIGGER trg_sync_job_member_to_scopes
AFTER INSERT ON public.job_members
FOR EACH ROW
EXECUTE FUNCTION public.sync_job_member_to_scopes();

-- A brand new scope now inherits the job's own roster (job_members),
-- not "whatever the other scopes happen to have" — job_members is the
-- authoritative list now.
CREATE OR REPLACE FUNCTION public.seed_new_scope_with_job_members()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id)
  SELECT DISTINCT NEW.id, jm.user_id
  FROM public.job_members jm
  WHERE jm.job_id = NEW.job_id
  ON CONFLICT (project_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_new_scope_with_job_members ON public.projects;
CREATE TRIGGER trg_seed_new_scope_with_job_members
AFTER INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.seed_new_scope_with_job_members();

-- Verify afterward:
--   1. Remove someone from a scope's own Scope Members list — they
--      should still show up in that job's Project Members afterward.
--   2. Add someone via Project Members' own "+ Add" — they should show
--      up on every scope of that job, not just get a bare job_members
--      row with no scope access.
--   3. Add someone to just one scope — they should show up in that
--      job's Project Members too, plus every sibling scope (unchanged
--      from before).
--   4. Create a new scope on a job that already has members — the new
--      scope should already list them, unadded by hand.
