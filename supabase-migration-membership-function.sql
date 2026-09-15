-- ============================================
-- Replace recursive project_members subqueries with a helper function
-- ============================================
--
-- projects_select_all_or_member, pages_select_all_or_member, and
-- sessions_select_all_or_member all check membership via a subquery on
-- project_members — which itself has to pass project_members' OWN SELECT
-- policy, which (correctly, after the last fix) ALSO subqueries
-- project_members. That self-referencing chain evaluates fine as a direct,
-- top-level query (confirmed: Team Members list works), but broke when
-- nested inside another table's policy (confirmed: opening a project as
-- foreman started returning "not found" right after that same fix).
--
-- A SECURITY DEFINER function sidesteps this: it runs with the function
-- owner's privileges, bypassing project_members' RLS entirely for this one
-- specific, narrow check, so nothing has to recurse through RLS at all.

CREATE OR REPLACE FUNCTION public.is_project_member(target_project_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = target_project_id AND user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "members_select_all_or_member" ON public.project_members;
CREATE POLICY "members_select_all_or_member" ON public.project_members FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR public.is_project_member(project_id)
);

DROP POLICY IF EXISTS "projects_select_all_or_member" ON public.projects;
CREATE POLICY "projects_select_all_or_member" ON public.projects FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR public.is_project_member(id)
);

DROP POLICY IF EXISTS "pages_select_all_or_member" ON public.pages;
CREATE POLICY "pages_select_all_or_member" ON public.pages FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR public.is_project_member(project_id)
);

DROP POLICY IF EXISTS "sessions_select_all_or_member" ON public.sessions;
CREATE POLICY "sessions_select_all_or_member" ON public.sessions FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR page_id IN (
    SELECT p.id FROM public.pages p WHERE public.is_project_member(p.project_id)
  )
);

-- Verify afterward — as the foreman test account, opening Project Hendrix
-- should load normally and show every member, not "not found".
