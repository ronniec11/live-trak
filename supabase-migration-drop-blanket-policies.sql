-- ============================================
-- Remove blanket "any authenticated user can do anything" policies
-- Run this in the Supabase SQL editor after supabase-migration-team.sql
-- ============================================
--
-- Found via: SELECT tablename, policyname, cmd, qual FROM pg_policies
--            WHERE policyname ILIKE '%allow all%' OR qual ILIKE '%authenticated%';
--
-- These sat alongside the properly role/membership-scoped policies and,
-- since Postgres RLS policies are OR'd together, silently granted every
-- signed-in user (any role) full access regardless of the specific policies
-- meant to restrict it — e.g. a foreman could see every project (not just
-- assigned ones), see/edit/delete any project's pages, remove anyone from
-- any project's membership, and delete or overwrite any floor plan file.
-- None of these are needed: the specific policies already in place (admin/pm
-- for writes, membership/role for reads, public read for floor-plan files)
-- cover every legitimate action the app performs.

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can manage pages" ON public.pages;
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete project members" ON public.project_members;
DROP POLICY IF EXISTS "Users can view project members" ON public.project_members;
DROP POLICY IF EXISTS "Users can update project members" ON public.project_members;
DROP POLICY IF EXISTS "Authenticated users can read floor plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete floor plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update floor plans" ON storage.objects;

-- IMPORTANT: on this database, "Profiles are viewable by authenticated
-- users" (just dropped above) turned out to be the ONLY SELECT policy that
-- actually existed on profiles — the "profiles_select_all USING (true)"
-- policy documented in supabase-schema.sql was never actually created here
-- (this project's live schema has drifted from that file in several other
-- ways too — see its own inline notes). Dropping it without this line left
-- profiles completely unreadable: every profile fetch failed, including the
-- app's own "who am I" lookup on login, which made the client fall back to
-- a hardcoded default role. Every other table this migration touches
-- already had its own broadened replacement created in
-- supabase-migration-team.sql, which is why only this one needs restoring.
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);

-- Sanity check afterward — should return zero rows:
-- SELECT tablename, policyname FROM pg_policies
-- WHERE policyname ILIKE '%allow all%' OR qual ILIKE '%authenticated%';
