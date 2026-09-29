-- ============================================
-- Tags + per-tag production rates + cross-project tag reporting
-- Run this in the Supabase SQL editor.
-- ============================================
--
-- tags: company-wide line items (e.g. "Wood Floor", "Carpet Tile", "Rubber
-- Base") each with its own unit (sf/lf) and an optional rate per man-hour
-- and/or per day, set once in Company Hub. Rates are looked up LIVE from
-- here wherever a scope needs one — never copied onto the scope — so
-- editing a rate in Company Hub instantly updates every scope using that
-- tag, matching how these are meant to be a company-wide standard rather
-- than something re-entered per scope.
--
-- project_tags: join table — a scope (projects row) can carry several tags
-- (e.g. "Carpet Tile" + "First Floor"), but only tags that have a rate set
-- actually drive a target; a purely descriptive tag with no rate is fine
-- and just ignored for that purpose.
--
-- projects.target_uom/daily_lf_target/total_lf_target: the existing
-- daily_sf_target/total_sf_target columns stay exactly as they are (still
-- what SF-tracked scopes use, and still a per-scope MANUAL OVERRIDE that
-- takes precedence over a tag's rate when both exist). These three new
-- columns are the LF-tracked equivalent, since a scope's sessions can
-- already produce sf and/or lf but scopes had no LF target concept at all
-- before now. target_uom just says which pair of columns (sf or lf) is the
-- one this particular scope is actually being measured against.

CREATE TABLE IF NOT EXISTS public.tags (
  id                 UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id    UUID REFERENCES public.organizations ON DELETE CASCADE NOT NULL,
  name               TEXT NOT NULL,
  uom                TEXT NOT NULL DEFAULT 'sf' CHECK (uom IN ('sf', 'lf')),
  rate_per_day       NUMERIC,
  rate_per_man_hour  NUMERIC,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- Any org member can read tags (they show up wherever a tagged scope is
-- shown, not just in Company Hub) — only admin/pm can manage the list.
DROP POLICY IF EXISTS "tags_select_org" ON public.tags;
CREATE POLICY "tags_select_org" ON public.tags FOR SELECT USING (
  organization_id = public.my_organization_id()
);

DROP POLICY IF EXISTS "tags_insert_admin_pm" ON public.tags;
CREATE POLICY "tags_insert_admin_pm" ON public.tags FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND organization_id = public.my_organization_id()
);

DROP POLICY IF EXISTS "tags_update_admin_pm" ON public.tags;
CREATE POLICY "tags_update_admin_pm" ON public.tags FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND organization_id = public.my_organization_id()
);

DROP POLICY IF EXISTS "tags_delete_admin_pm" ON public.tags;
CREATE POLICY "tags_delete_admin_pm" ON public.tags FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND organization_id = public.my_organization_id()
);

CREATE TABLE IF NOT EXISTS public.project_tags (
  project_id  UUID REFERENCES public.projects ON DELETE CASCADE NOT NULL,
  tag_id      UUID REFERENCES public.tags ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (project_id, tag_id)
);

ALTER TABLE public.project_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_tags_select_all_or_member" ON public.project_tags;
CREATE POLICY "project_tags_select_all_or_member" ON public.project_tags FOR SELECT USING (
  ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
   AND project_id IN (
     SELECT p.id FROM public.projects p
     JOIN public.jobs j ON j.id = p.job_id
     WHERE j.organization_id = public.my_organization_id()
   ))
  OR public.is_project_member(project_id)
);

DROP POLICY IF EXISTS "project_tags_insert_pm" ON public.project_tags;
CREATE POLICY "project_tags_insert_pm" ON public.project_tags FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND project_id IN (
    SELECT p.id FROM public.projects p
    JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

DROP POLICY IF EXISTS "project_tags_delete_pm" ON public.project_tags;
CREATE POLICY "project_tags_delete_pm" ON public.project_tags FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  AND project_id IN (
    SELECT p.id FROM public.projects p
    JOIN public.jobs j ON j.id = p.job_id
    WHERE j.organization_id = public.my_organization_id()
  )
);

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS target_uom text DEFAULT 'sf' CHECK (target_uom IN ('sf', 'lf')),
ADD COLUMN IF NOT EXISTS daily_lf_target numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_lf_target numeric DEFAULT 0;
