-- Session writes (INSERT/UPDATE/DELETE) currently require the caller to
-- have an explicit row in project_members for that specific scope, with
-- no equivalent to sessions_select_all_or_member's SELECT bypass, which
-- already lets any admin/pm see every session in their own org regardless
-- of project_members. An admin who manages a job but was never explicitly
-- added to one of its scopes (because someone else does the actual field
-- markup there) could see that scope's sessions fine but got a bare "new
-- row violates row-level security policy" trying to save their own —
-- surfaced when an admin tried marking up and saving a session themself
-- for the first time, not anything specific to how they signed in.
--
-- Run this in the Supabase SQL editor.

CREATE POLICY "sessions_insert_org_admin" ON public.sessions FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND page_id IN (
    SELECT pg.id FROM public.pages pg
    JOIN public.projects p ON p.id = pg.project_id
    JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

CREATE POLICY "sessions_update_org_admin" ON public.sessions FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND page_id IN (
    SELECT pg.id FROM public.pages pg
    JOIN public.projects p ON p.id = pg.project_id
    JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

CREATE POLICY "sessions_delete_org_admin" ON public.sessions FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND page_id IN (
    SELECT pg.id FROM public.pages pg
    JOIN public.projects p ON p.id = pg.project_id
    JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);
