-- ============================================
-- Multi-tenant Stage 3: org-scope the profiles table itself
-- Run this in the Supabase SQL editor (after Stage 1 and Stage 2)
-- ============================================
--
-- Stage 2 locked down jobs/scopes/pages/sessions. This closes the last big
-- gap: profiles_select_all is still USING (true) today — every signed-in
-- user, at either company, can read every other user's full profile row
-- (name, email, phone, role, ...). And profiles_update_own_or_admin /
-- profiles_delete_admin's admin branch checks only "is the caller an
-- admin somewhere," not "an admin of this same person's company" — so
-- today any admin can edit or delete any OTHER company's user account
-- outright, not just view it.

DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_own_org" ON public.profiles FOR SELECT USING (
  organization_id = public.my_organization_id()
);

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_own_or_admin" ON public.profiles FOR UPDATE USING (
  auth.uid() = id
  OR (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    AND organization_id = public.my_organization_id()
  )
);

DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  AND organization_id = public.my_organization_id()
);

-- profiles_insert_own (auth.uid() = id) is untouched — a user can only ever
-- insert their own row, and organization_id on it is already set correctly
-- by handle_new_user()/Team.jsx's invite flow (Stage 1), so there's nothing
-- for this policy itself to check.

-- Verify afterward, signed in as your own (Calderon) admin account:
--   Team page should show your existing team exactly as before — everyone
--   there is already in your org. You should still be able to view/edit/
--   remove them normally. This only matters once a second organization's
--   users exist to be walled off from.
