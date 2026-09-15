-- ============================================
-- Fix project_members SELECT policy — wrong condition applied
-- ============================================
--
-- Confirmed via pg_get_expr(polqual, polrelid): the live policy reads
--   (role IN ('admin','pm')) OR (user_id = auth.uid())
-- instead of the intended
--   (role IN ('admin','pm')) OR (project_id IN (member's own projects))
--
-- "user_id = auth.uid()" only ever matches the REQUESTING user's own
-- membership row, never any other member of a project they share — so a
-- foreman opening a project they're genuinely on only ever saw themselves
-- in the Team Members list, never the admin/PM/other foremen also on it.

DROP POLICY IF EXISTS "members_select_all_or_member" ON public.project_members;
CREATE POLICY "members_select_all_or_member" ON public.project_members FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR project_id IN (SELECT project_id FROM public.project_members WHERE user_id = auth.uid())
);

-- Verify afterward:
-- SELECT polname, pg_get_expr(polqual, polrelid) AS full_expression
-- FROM pg_policy WHERE polrelid = 'project_members'::regclass AND polcmd = 'r';
