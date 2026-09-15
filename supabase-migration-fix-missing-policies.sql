-- ============================================
-- Restore missing admin/pm write policies
-- Run this in the Supabase SQL editor
-- ============================================
--
-- The earlier blanket-policy cleanup (supabase-migration-drop-blanket-
-- policies.sql) dropped several "any authenticated user" policies on the
-- assumption that supabase-schema.sql's documented admin/pm-scoped
-- replacements already existed on this database. Verified via pg_policies
-- that almost none of them actually did — this database's live policy set
-- has drifted further from that file than previously known. Net effect:
-- creating/editing projects, creating/editing/deleting pages, and removing
-- project members have all been silently no-ops (Postgres RLS deletes/
-- updates zero rows rather than erroring when no policy allows it) since
-- that cleanup ran.
--
-- This also tightens two policies discovered to still be wide open to any
-- authenticated user rather than admin/pm as originally intended: adding
-- project members, and uploading floor plan files.

-- projects: INSERT/UPDATE (only SELECT existed)
CREATE POLICY "projects_insert_pm" ON public.projects FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
CREATE POLICY "projects_update_pm" ON public.projects FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- pages: INSERT/UPDATE/DELETE (only SELECT existed) — DELETE is used by
-- ProjectDetail.jsx's deletePage()
CREATE POLICY "pages_insert_pm" ON public.pages FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
CREATE POLICY "pages_update_pm" ON public.pages FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
CREATE POLICY "pages_delete_pm" ON public.pages FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- project_members: replace the wide-open INSERT with an admin/pm-scoped
-- one, add the missing DELETE (this is the bug just reported — removing a
-- member appeared to work client-side but silently deleted zero rows)
DROP POLICY IF EXISTS "Users can insert project members" ON public.project_members;
CREATE POLICY "members_insert_pm" ON public.project_members FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
CREATE POLICY "members_delete_pm" ON public.project_members FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- storage.objects (floor-plans bucket): replace the wide-open INSERT with
-- an admin/pm-scoped one, add the missing UPDATE (needed for upsert:true
-- tile re-uploads in tileGenerator.js) and DELETE (needed for deleteTiles()
-- and deletePage()'s storage cleanup)
DROP POLICY IF EXISTS "Authenticated users can upload floor plans" ON storage.objects;
CREATE POLICY "floor_plans_insert_pm" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'floor-plans' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
CREATE POLICY "floor_plans_update_pm" ON storage.objects FOR UPDATE USING (
  bucket_id = 'floor-plans' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
CREATE POLICY "floor_plans_delete_pm" ON storage.objects FOR DELETE USING (
  bucket_id = 'floor-plans' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- objects also had no SELECT policy at all (found via the verification
-- query below). The public bucket flag bypasses RLS for the public URL
-- read path (why images/tiles still displayed fine), but authenticated
-- .list() calls — e.g. deleteTiles() enumerating files before regenerating
-- a floor plan's tile pyramid — go through RLS and were silently seeing
-- zero files, leaving old tiles orphaned instead of actually clearing them.
CREATE POLICY "floor_plans_select_public" ON storage.objects FOR SELECT USING (
  bucket_id = 'floor-plans'
);

-- Verified clean via:
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE tablename IN ('projects','pages','project_members','objects','sessions','profiles')
-- ORDER BY tablename, cmd;
