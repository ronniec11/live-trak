-- ============================================
-- Multi-tenant Stage 2: org-scope the jobs -> scopes -> pages -> sessions
-- RLS chain
-- Run this in the Supabase SQL editor (after Stage 1)
-- ============================================
--
-- Stage 1 gave every profile an organization_id. This stage is where that
-- actually starts mattering: every "admin/pm can do X" policy on jobs,
-- projects (scopes), project_members, pages, and sessions currently checks
-- ONLY the role — admin/pm anywhere, not admin/pm of a particular company.
-- With a second organization sharing this database, that's the difference
-- between "Mopping Man's admin manages Mopping Man's jobs" and "Mopping
-- Man's admin can read, edit, or delete Calderon Technologies' jobs too."
--
-- jobs.organization_id is the only table with a direct link to
-- organizations — everything below it has to walk up the chain
-- (jobs -> projects.job_id -> pages.project_id -> sessions.page_id) to find
-- which org a row ultimately belongs to. is_project_member()/is_job_member()
-- themselves don't need org checks added — membership is only ever granted
-- via project_members, and this migration locks down WHO can grant it (see
-- members_insert_pm below), so membership itself can no longer cross an org
-- boundary once this is applied.
--
-- Storage (the floor-plans bucket) is deliberately NOT touched here — it's
-- getting a full rework (private bucket + signed URLs) in Stage 4, so an
-- interim patch here would just be thrown away.

-- Looks up the caller's own organization once, reusable in every policy
-- below — SECURITY DEFINER + STABLE, same pattern as is_project_member/
-- is_job_member, so it isn't blocked by (or itself triggers recursion
-- through) any table's own RLS.
CREATE OR REPLACE FUNCTION public.my_organization_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ============================================
-- JOBS — organization_id lives directly on this table
-- ============================================

DROP POLICY IF EXISTS "jobs_select_all_or_member" ON public.jobs;
CREATE POLICY "jobs_select_all_or_member" ON public.jobs FOR SELECT USING (
  (organization_id = public.my_organization_id()
   AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm'))
  OR public.is_job_member(id)
);

DROP POLICY IF EXISTS "jobs_insert_admin" ON public.jobs;
CREATE POLICY "jobs_insert_admin" ON public.jobs FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  AND organization_id = public.my_organization_id()
);

DROP POLICY IF EXISTS "jobs_update_admin" ON public.jobs;
CREATE POLICY "jobs_update_admin" ON public.jobs FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  AND organization_id = public.my_organization_id()
);

-- ============================================
-- PROJECTS (aka "Scopes") — org via job_id -> jobs.organization_id
-- ============================================

DROP POLICY IF EXISTS "projects_select_all_or_member" ON public.projects;
CREATE POLICY "projects_select_all_or_member" ON public.projects FOR SELECT USING (
  ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
   AND job_id IN (SELECT id FROM public.jobs WHERE organization_id = public.my_organization_id()))
  OR public.is_project_member(id)
);

DROP POLICY IF EXISTS "projects_insert_pm" ON public.projects;
CREATE POLICY "projects_insert_pm" ON public.projects FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND job_id IN (SELECT id FROM public.jobs WHERE organization_id = public.my_organization_id())
);

DROP POLICY IF EXISTS "projects_update_pm" ON public.projects;
CREATE POLICY "projects_update_pm" ON public.projects FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND job_id IN (SELECT id FROM public.jobs WHERE organization_id = public.my_organization_id())
);

-- ============================================
-- PROJECT_MEMBERS — org via project_id -> projects.job_id -> jobs.organization_id
-- ============================================

DROP POLICY IF EXISTS "members_select_all_or_member" ON public.project_members;
CREATE POLICY "members_select_all_or_member" ON public.project_members FOR SELECT USING (
  ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
   AND project_id IN (
     SELECT p.id FROM public.projects p JOIN public.jobs j ON j.id = p.job_id
     WHERE j.organization_id = public.my_organization_id()
   ))
  OR public.is_project_member(project_id)
);

DROP POLICY IF EXISTS "members_insert_pm" ON public.project_members;
CREATE POLICY "members_insert_pm" ON public.project_members FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND project_id IN (
    SELECT p.id FROM public.projects p JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
  -- Without this, an admin could still add a DIFFERENT company's user_id as
  -- a member of one of their own projects (if they somehow had/guessed
  -- it), and is_project_member() would then legitimately let that person
  -- see this org's data — membership itself has to stay inside one org.
  AND (SELECT organization_id FROM public.profiles WHERE id = user_id) = public.my_organization_id()
);

DROP POLICY IF EXISTS "members_delete_pm" ON public.project_members;
CREATE POLICY "members_delete_pm" ON public.project_members FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND project_id IN (
    SELECT p.id FROM public.projects p JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

-- ============================================
-- PAGES — org via project_id -> projects.job_id -> jobs.organization_id
-- ============================================

DROP POLICY IF EXISTS "pages_select_all_or_member" ON public.pages;
CREATE POLICY "pages_select_all_or_member" ON public.pages FOR SELECT USING (
  ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
   AND project_id IN (
     SELECT p.id FROM public.projects p JOIN public.jobs j ON j.id = p.job_id
     WHERE j.organization_id = public.my_organization_id()
   ))
  OR public.is_project_member(project_id)
);

DROP POLICY IF EXISTS "pages_insert_pm" ON public.pages;
CREATE POLICY "pages_insert_pm" ON public.pages FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND project_id IN (
    SELECT p.id FROM public.projects p JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

DROP POLICY IF EXISTS "pages_update_pm" ON public.pages;
CREATE POLICY "pages_update_pm" ON public.pages FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND project_id IN (
    SELECT p.id FROM public.projects p JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

DROP POLICY IF EXISTS "pages_delete_pm" ON public.pages;
CREATE POLICY "pages_delete_pm" ON public.pages FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND project_id IN (
    SELECT p.id FROM public.projects p JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

-- ============================================
-- SESSIONS — org via page_id -> pages.project_id -> projects.job_id -> jobs.organization_id
-- ============================================
-- INSERT/UPDATE are deliberately left alone: they already only allow
-- auth.uid() = user_id (no admin/pm override exists today), and a user can
-- only ever be a project member within their own org after the
-- members_insert_pm fix above, so cross-org writes are already impossible
-- here without any direct change.

DROP POLICY IF EXISTS "sessions_select_all_or_member" ON public.sessions;
CREATE POLICY "sessions_select_all_or_member" ON public.sessions FOR SELECT USING (
  ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
   AND page_id IN (
     SELECT pg.id FROM public.pages pg
     JOIN public.projects p ON p.id = pg.project_id
     JOIN public.jobs j ON j.id = p.job_id
     WHERE j.organization_id = public.my_organization_id()
   ))
  OR page_id IN (SELECT pg.id FROM public.pages pg WHERE public.is_project_member(pg.project_id))
);

-- ============================================
-- Sort-order functions — same admin/pm/superintendent check as before,
-- now also requiring the target row to be in the caller's own org
-- ============================================

DROP FUNCTION IF EXISTS public.set_project_sort_order(uuid, numeric);
CREATE OR REPLACE FUNCTION public.set_project_sort_order(target_project_id uuid, new_order numeric)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE projects SET sort_order = new_order
  WHERE id = target_project_id
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm', 'superintendent')
  AND job_id IN (SELECT id FROM jobs WHERE organization_id = public.my_organization_id());
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

DROP FUNCTION IF EXISTS public.set_job_sort_order(uuid, numeric);
CREATE OR REPLACE FUNCTION public.set_job_sort_order(target_job_id uuid, new_order numeric)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE jobs SET sort_order = new_order
  WHERE id = target_job_id
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm', 'superintendent')
  AND organization_id = public.my_organization_id();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

-- Verify afterward, signed in as your own (Calderon) admin account:
--   Projects/Scopes/Reports/Team should all look exactly the same as
--   before this migration — everything you can see today is still in your
--   own org, so nothing should visibly change yet. This only matters once
--   a second organization actually has data to be walled off from.
