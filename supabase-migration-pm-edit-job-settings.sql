-- ============================================
-- Let PM edit Project Settings, not just admin
-- Run this in the Supabase SQL editor
-- ============================================
--
-- The "Project Settings" button on the Project page (name/GC/owner/
-- address/status) was gated to admin-only in the UI (ProjectDetail.jsx's
-- canManage), and the jobs table's own UPDATE policy only ever allowed
-- admin at the database level too — widening both together, same as
-- supabase-migration-pm-create-jobs.sql did for creating a new project.

DROP POLICY IF EXISTS "jobs_update_admin" ON public.jobs;
CREATE POLICY "jobs_update_admin_or_pm" ON public.jobs FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND organization_id = public.my_organization_id()
);

-- Verify afterward: as a pm-role account, the Project page should show
-- the "Project Settings" button, and saving a change there should
-- actually persist (not just appear to, then revert on refresh).
