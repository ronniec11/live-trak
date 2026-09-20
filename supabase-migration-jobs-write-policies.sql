-- ============================================
-- Restore missing write policies on jobs
-- Run this in the Supabase SQL editor
-- ============================================
--
-- jobs (the top-level "Project" in the current UI) isn't in
-- supabase-schema.sql or any tracked migration — it was set up directly in
-- the dashboard, and apparently only ever got a SELECT policy. Creating a
-- new project from Projects.jsx's "New Project" button inserts into this
-- table and has been failing outright with "new row violates row-level
-- security policy for table jobs" — the same missing-write-policy failure
-- mode supabase-migration-fix-missing-policies.sql found and fixed on
-- projects/pages/project_members earlier.
--
-- Job editing (ProjectDetail.jsx's JobSettingsModal and the status badge)
-- is admin-only in the UI (canManage = profile?.role === 'admin'), so both
-- policies below match that rather than the wider admin/pm the sibling
-- projects/pages policies use.

CREATE POLICY "jobs_insert_admin" ON public.jobs FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

DROP POLICY IF EXISTS "jobs_update_admin" ON public.jobs;
CREATE POLICY "jobs_update_admin" ON public.jobs FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- Verify via:
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'jobs' ORDER BY cmd;
