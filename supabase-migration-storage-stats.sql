-- ============================================
-- Super Admin: per-company Storage usage (bytes) across all 3 buckets
-- Run this in the Supabase SQL editor (after supabase-migration-super-admin.sql
-- and supabase-migration-org-scoping-stage4-storage.sql — this reuses
-- public.is_super_admin() and public.storage_path_org_id() from those)
-- ============================================
--
-- storage.objects.metadata->>'size' holds each object's byte size (Supabase
-- writes this on upload). Walking that per-org via the Storage JS client
-- would mean recursively listing every folder in floor-plans/floor-plan-tiles
-- (which can be thousands of small tile files) from the browser — this does
-- the same rollup as a single indexed query instead, restricted to a super
-- admin the same way every other cross-company read in this app is.
--
-- org-logos paths are already `${organizationId}/...` directly (see
-- supabase-migration-org-logo.sql); floor-plans and floor-plan-tiles both
-- start with a project (Scope) id and need the project -> job -> org walk
-- storage_path_org_id() already does for RLS.

CREATE OR REPLACE FUNCTION public.storage_usage_by_org()
RETURNS TABLE (
  organization_id uuid,
  floor_plans_bytes bigint,
  floor_plan_tiles_bytes bigint,
  org_logos_bytes bigint,
  total_bytes bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can call storage_usage_by_org()';
  END IF;

  RETURN QUERY
  WITH fp AS (
    SELECT public.storage_path_org_id(o.name) AS org_id,
           SUM(COALESCE((o.metadata->>'size')::bigint, 0)) AS bytes
    FROM storage.objects o
    WHERE o.bucket_id = 'floor-plans'
    GROUP BY 1
  ),
  ft AS (
    SELECT public.storage_path_org_id(o.name) AS org_id,
           SUM(COALESCE((o.metadata->>'size')::bigint, 0)) AS bytes
    FROM storage.objects o
    WHERE o.bucket_id = 'floor-plan-tiles'
    GROUP BY 1
  ),
  ol AS (
    SELECT ((storage.foldername(o.name))[1])::uuid AS org_id,
           SUM(COALESCE((o.metadata->>'size')::bigint, 0)) AS bytes
    FROM storage.objects o
    WHERE o.bucket_id = 'org-logos'
    GROUP BY 1
  )
  SELECT
    org.id,
    COALESCE(fp.bytes, 0),
    COALESCE(ft.bytes, 0),
    COALESCE(ol.bytes, 0),
    COALESCE(fp.bytes, 0) + COALESCE(ft.bytes, 0) + COALESCE(ol.bytes, 0)
  FROM public.organizations org
  LEFT JOIN fp ON fp.org_id = org.id
  LEFT JOIN ft ON ft.org_id = org.id
  LEFT JOIN ol ON ol.org_id = org.id;
END;
$$;

-- Verify afterward (as your super admin account):
--   select * from storage_usage_by_org();
--   -- should return one row per company with a non-zero total for any
--   -- company that has actually uploaded a floor plan/logo/tiled a page.
--   As a non-super-admin, the same call should raise the exception above.
