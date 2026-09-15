-- ============================================
-- Team management — run this once in the Supabase SQL editor
-- (supabase-schema.sql is the original reference schema; this file is a
-- dated migration on top of it, same pattern as the ALTER TABLE notes
-- already inline in that file)
-- ============================================

-- New profile fields for the company directory
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS company text,
  -- Set the first time someone actually logs in (see AuthContext.jsx) — used
  -- to show "Invited" vs "Active" on the Team page. auth.users itself isn't
  -- queryable from client code, so this is tracked here instead.
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Allow the new "superintendent" role alongside the existing three
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'pm', 'superintendent', 'foreman'));

-- Admins/PMs manage the whole company, so they need to see every project —
-- not just ones they happen to be a project_members row on. Broaden the
-- four SELECT policies that previously gated strictly on membership.
-- Superintendents/foremen are unaffected: they still only see projects
-- (and those projects' pages/sessions/members) they're assigned to.

DROP POLICY IF EXISTS "projects_select_members" ON public.projects;
CREATE POLICY "projects_select_all_or_member" ON public.projects FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR id IN (SELECT project_id FROM public.project_members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "pages_select_members" ON public.pages;
CREATE POLICY "pages_select_all_or_member" ON public.pages FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR project_id IN (SELECT project_id FROM public.project_members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "sessions_select_members" ON public.sessions;
CREATE POLICY "sessions_select_all_or_member" ON public.sessions FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR page_id IN (
    SELECT p.id FROM public.pages p
    JOIN public.project_members pm ON pm.project_id = p.project_id
    WHERE pm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "members_select" ON public.project_members;
CREATE POLICY "members_select_all_or_member" ON public.project_members FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  OR project_id IN (SELECT project_id FROM public.project_members WHERE user_id = auth.uid())
);

-- The Team page's "Edit" flow needs an admin to update OTHER people's
-- profiles (phone/company/role/avatar_color) — the existing policy only
-- ever allowed a user to update their own row.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own_or_admin" ON public.profiles FOR UPDATE USING (
  auth.uid() = id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);
