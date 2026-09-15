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

-- Sanity check afterward — should return zero rows:
-- SELECT tablename, policyname FROM pg_policies
-- WHERE policyname ILIKE '%allow all%' OR qual ILIKE '%authenticated%';
