-- projects (scopes) had INSERT/UPDATE for admin/pm (see
-- supabase-migration-fix-missing-policies.sql) but no DELETE at all —
-- deleting a scope was simply impossible for anyone, admin included, with
-- Postgres RLS silently deleting zero rows rather than erroring.
--
-- Run this in the Supabase SQL editor.

CREATE POLICY "projects_delete_pm" ON public.projects FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
