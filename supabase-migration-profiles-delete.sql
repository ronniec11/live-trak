-- ============================================
-- Team page: "Delete Permanently" support
-- Run this in the Supabase SQL editor
-- ============================================
--
-- profiles never had a DELETE policy at all (only SELECT and the admin-or-
-- self UPDATE from supabase-migration-team.sql) — same missing-write-
-- policy situation this repo keeps finding on other tables. Without this,
-- Team.jsx's new "Delete Permanently" button (for someone already removed/
-- deactivated — see supabase-migration-team-active.sql) fails outright.
--
-- Admin-only, matching removing/restoring (profiles_update_own_or_admin).

CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);
