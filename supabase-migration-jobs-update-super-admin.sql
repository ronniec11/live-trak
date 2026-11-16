-- SuperAdmin.jsx's "Move Job" action moves a job to a different company by
-- updating jobs.organization_id. supabase-migration-super-admin.sql gave
-- super admins a SELECT bypass on jobs but never an UPDATE one (only
-- organizations and profiles got that) — without this, the move silently
-- affects zero rows under RLS, with no error surfaced to explain why.
--
-- Run this in the Supabase SQL editor.

CREATE POLICY "jobs_update_super_admin" ON public.jobs FOR UPDATE USING (public.is_super_admin());
