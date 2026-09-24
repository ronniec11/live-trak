-- ============================================
-- Multi-tenant Stage 5 fix: a brand new signup couldn't read their OWN
-- profile row, which made self-signup completely unreachable
-- Run this in the Supabase SQL editor (after Stage 5)
-- ============================================
--
-- profiles_select_own_org (added in Stage 3) checks:
--   organization_id = public.my_organization_id()
-- For a brand new self-signup user, before they've ever completed
-- "Create your company," their own organization_id is NULL. In SQL,
-- NULL = NULL evaluates to NULL, not true — so their own row was
-- invisible to them. AuthContext's fetchProfile() treated that as a
-- failure and fell back to a synthesized placeholder profile (hardcoded
-- role: 'foreman', no organization_id) — and that placeholder is flagged
-- specifically so ProtectedRoute's CompanySetup gate SKIPS it (so a real
-- transient fetch error never wrongly traps an existing user on the
-- "create your company" screen). Combined, a new signup never even saw
-- that screen: it landed straight on the main app with a broken,
-- org-less profile, stuck on Projects's loading state forever with no
-- organization to query against.
--
-- The fix: you can always read your own row, full stop, regardless of
-- whether you have an organization yet — same as
-- profiles_update_own_or_admin already allows (auth.uid() = id OR ...).
-- This doesn't loosen visibility into anyone else's profile; the org
-- check still gates every other row exactly as before.
DROP POLICY IF EXISTS "profiles_select_own_org" ON public.profiles;
CREATE POLICY "profiles_select_own_org" ON public.profiles FOR SELECT USING (
  auth.uid() = id OR organization_id = public.my_organization_id()
);

-- Verify afterward:
--   1. As your existing (Calderon) admin, confirm Team page still shows
--      your whole roster normally — nothing should look different.
--   2. For the test signup account that got stuck earlier: sign out of
--      it and sign back in (or a hard refresh) — it should now actually
--      show the "One last step" / Create your company screen for the
--      first time, instead of a broken, permanently-loading Projects
--      page. Complete it and confirm you land in a real, empty company
--      as its admin.
