-- ============================================
-- Move tags from the scope to the page/sheet level
-- Run this in the Supabase SQL editor (after supabase-migration-page-uom.sql)
-- ============================================
--
-- project_tags (scope-level) stays in the schema untouched — existing rows
-- are deliberately NOT migrated. A scope can now hold sheets tracked in
-- different units doing different kinds of work (e.g. "Final Clean" has an
-- LF floor-cleaning sheet and an Each "Generators" sheet), so one tag on
-- the whole scope can no longer represent that; tagging stops being a
-- scope-level concept and old scope-tag assignments just go unused from
-- here on. Attach tags to the individual sheets that need them instead, via
-- Sheet Settings (ScopeDetail.jsx's PageSettingsModal).
--
-- 'each' joins sf/lf as a tag rate unit, matching pages.unit_of_measure's
-- own vocabulary (supabase-migration-page-uom.sql) — a "Generators" tag can
-- now carry a rate_per_day meaning "N generators/day", driving an
-- auto-suggested daily target for an Each-tracked sheet the same way an
-- sf/lf tag already does for SF/LF sheets.
ALTER TABLE public.tags DROP CONSTRAINT IF EXISTS tags_uom_check;
ALTER TABLE public.tags ADD CONSTRAINT tags_uom_check CHECK (uom IN ('sf', 'lf', 'each'));

CREATE TABLE IF NOT EXISTS public.page_tags (
  page_id  UUID REFERENCES public.pages ON DELETE CASCADE NOT NULL,
  tag_id   UUID REFERENCES public.tags ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (page_id, tag_id)
);

ALTER TABLE public.page_tags ENABLE ROW LEVEL SECURITY;

-- Same org/membership shape as project_tags' own policies, just walking
-- one level further down (page -> its scope -> its job) to find the org.
DROP POLICY IF EXISTS "page_tags_select_all_or_member" ON public.page_tags;
CREATE POLICY "page_tags_select_all_or_member" ON public.page_tags FOR SELECT USING (
  ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
   AND page_id IN (
     SELECT pg.id FROM public.pages pg
     JOIN public.projects p ON p.id = pg.project_id
     JOIN public.jobs j ON j.id = p.job_id
     WHERE j.organization_id = public.my_organization_id()
   ))
  OR page_id IN (SELECT pg.id FROM public.pages pg WHERE public.is_project_member(pg.project_id))
);

DROP POLICY IF EXISTS "page_tags_insert_pm" ON public.page_tags;
CREATE POLICY "page_tags_insert_pm" ON public.page_tags FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND page_id IN (
    SELECT pg.id FROM public.pages pg
    JOIN public.projects p ON p.id = pg.project_id
    JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

DROP POLICY IF EXISTS "page_tags_delete_pm" ON public.page_tags;
CREATE POLICY "page_tags_delete_pm" ON public.page_tags FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND page_id IN (
    SELECT pg.id FROM public.pages pg
    JOIN public.projects p ON p.id = pg.project_id
    JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

-- Verify afterward:
--   1. Company Hub: create/edit a tag with unit "Each" — should save and
--      show up as an option same as SF/LF tags.
--   2. Sheet Settings (ScopeDetail.jsx, gear icon on a page thumbnail):
--      tag search/picker should attach/detach tags to that ONE page.
--   3. Reports' tag filter: pick a tag attached to a page — should list
--      that page's job/scope/sheet with its actual-vs-rate numbers, not
--      every sheet in its scope.
