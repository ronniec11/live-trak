-- ============================================
-- Let PM create new projects (jobs), not just admin
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Reports already allowed pm (Reports.jsx's own canView), but the
-- Projects page's "New Project" and "Reports" buttons were both gated
-- to admin-only in the UI, and the jobs table's own INSERT policy only
-- ever allowed admin at the database level too — so even flipping the
-- UI gate alone would have left PM hitting a blocked insert. Widening
-- both together.

DROP POLICY IF EXISTS "jobs_insert_admin" ON public.jobs;
CREATE POLICY "jobs_insert_admin_or_pm" ON public.jobs FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND organization_id = public.my_organization_id()
);

-- Verify afterward: as a pm-role account, the Projects page should show
-- both the "Reports" and "New Project" buttons, and creating a new
-- project should actually save (not just appear to, then vanish on
-- refresh).
