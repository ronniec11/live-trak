-- ============================================
-- Multi-tenant Stage 4: private floor-plans bucket + signed URLs,
-- separate public floor-plan-tiles bucket
-- Run this in the Supabase SQL editor (after Stage 1, 2 and 3)
-- ============================================
--
-- Today the floor-plans bucket is PUBLIC — floor_plans_select_public grants
-- SELECT to anyone with a Storage path (any signed-in user, since the app
-- reads it that way, but really anyone who guesses/leaks a URL, since
-- "public" bucket reads bypass RLS entirely). Every floor plan, session
-- paint layer, and completion photo for BOTH companies currently lives in
-- this one bucket at predictable `${projectId}/...` paths — with Stage 1-3
-- now walling off the database tables themselves, Storage was the one
-- remaining place Mopping Man could still reach Calderon's (or vice versa)
-- floor plans/photos, just by guessing/enumerating a project id.
--
-- This flips floor-plans to private and replaces its policies with
-- org-scoped ones (via a path-derived project -> job -> organization
-- lookup). The app (src/lib/storageUrls.js) already resolves every stored
-- reference to a signed URL right before use rather than reading
-- `pages.floor_plan_url`/`sessions.photos`/etc. directly, and every upload
-- site already stores the bare Storage path rather than a public URL — so
-- this migration is the server-side half of that already-shipped client
-- change, not the other way around.
--
-- Tile pyramids (tileGenerator.js) move to their own NEW bucket,
-- floor-plan-tiles, and stay public on purpose — OpenSeadragon's tile
-- loader builds hundreds of tile URLs synchronously per pan/zoom, which a
-- signed-URL scheme can't practically support, and tiles are small,
-- low-sensitivity chunks at unguessable UUID-based paths. This is an
-- explicit, confirmed trade-off (not an oversight) — see the comment atop
-- src/lib/tileGenerator.js.

-- ── floor-plan-tiles: new public bucket ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'floor-plan-tiles',
  'floor-plan-tiles',
  true,
  5242880,  -- 5 MB — plenty for a single 256x256 tile
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "floor_plan_tiles_select_public" ON storage.objects FOR SELECT USING (
  bucket_id = 'floor-plan-tiles'
);
CREATE POLICY "floor_plan_tiles_insert_pm" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'floor-plan-tiles' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
CREATE POLICY "floor_plan_tiles_update_pm" ON storage.objects FOR UPDATE USING (
  bucket_id = 'floor-plan-tiles' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);
CREATE POLICY "floor_plan_tiles_delete_pm" ON storage.objects FOR DELETE USING (
  bucket_id = 'floor-plan-tiles' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- ── floor-plans: org-scoped policies ────────────────────────────────────
-- Every path in this bucket starts with its owning scope's (projects table)
-- id — `${projectId}/...`, `${projectId}/sessions/${pageId}/...`,
-- `${projectId}/cache_${pageId}.png` (see src/pages/ScopeDetail.jsx and
-- src/pages/Canvas.jsx's upload call sites). This resolves that leading
-- path segment to its organization the same way Stage 2 resolved
-- projects/pages/sessions rows: project -> job -> organization. Returns
-- NULL (and so fails every USING/WITH CHECK comparison, denying access) for
-- a malformed path or one whose project no longer exists.
CREATE OR REPLACE FUNCTION public.storage_path_org_id(path text)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT j.organization_id
  FROM public.projects p
  JOIN public.jobs j ON j.id = p.job_id
  WHERE p.id = (regexp_match(path, '^([0-9a-fA-F-]{36})/'))[1]::uuid
$$;

DROP POLICY IF EXISTS "floor_plans_select_public" ON storage.objects;
CREATE POLICY "floor_plans_select_org" ON storage.objects FOR SELECT USING (
  bucket_id = 'floor-plans' AND
  public.storage_path_org_id(name) = public.my_organization_id()
);

DROP POLICY IF EXISTS "floor_plans_insert_pm" ON storage.objects;
CREATE POLICY "floor_plans_insert_org" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'floor-plans' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm') AND
  public.storage_path_org_id(name) = public.my_organization_id()
);

DROP POLICY IF EXISTS "floor_plans_update_pm" ON storage.objects;
CREATE POLICY "floor_plans_update_org" ON storage.objects FOR UPDATE USING (
  bucket_id = 'floor-plans' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm') AND
  public.storage_path_org_id(name) = public.my_organization_id()
);

DROP POLICY IF EXISTS "floor_plans_delete_pm" ON storage.objects;
CREATE POLICY "floor_plans_delete_org" ON storage.objects FOR DELETE USING (
  bucket_id = 'floor-plans' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm') AND
  public.storage_path_org_id(name) = public.my_organization_id()
);

UPDATE storage.buckets SET public = false WHERE id = 'floor-plans';

-- ── Data cleanup: strip legacy full public URLs down to bare paths ─────
-- Not strictly required — src/lib/storageUrls.js's resolveStorageUrl()
-- already tolerates either shape — but keeps the data itself clean going
-- forward instead of leaning on that fallback indefinitely.
UPDATE public.pages
SET floor_plan_url = regexp_replace(floor_plan_url, '^https?://[^/]+/storage/v1/object/public/floor-plans/', '')
WHERE floor_plan_url ~ '^https?://[^/]+/storage/v1/object/public/floor-plans/';

UPDATE public.pages
SET cached_image_url = regexp_replace(cached_image_url, '^https?://[^/]+/storage/v1/object/public/floor-plans/', '')
WHERE cached_image_url ~ '^https?://[^/]+/storage/v1/object/public/floor-plans/';

UPDATE public.sessions
SET highlight_data = regexp_replace(highlight_data, '^https?://[^/]+/storage/v1/object/public/floor-plans/', '')
WHERE highlight_data ~ '^https?://[^/]+/storage/v1/object/public/floor-plans/';

UPDATE public.sessions
SET pen_data = regexp_replace(pen_data, '^https?://[^/]+/storage/v1/object/public/floor-plans/', '')
WHERE pen_data ~ '^https?://[^/]+/storage/v1/object/public/floor-plans/';

UPDATE public.sessions s
SET photos = sub.new_photos
FROM (
  SELECT s2.id, jsonb_agg(
    CASE WHEN elem ~ '^https?://[^/]+/storage/v1/object/public/floor-plans/'
      THEN to_jsonb(regexp_replace(elem, '^https?://[^/]+/storage/v1/object/public/floor-plans/', ''))
      ELSE to_jsonb(elem)
    END
  ) AS new_photos
  FROM public.sessions s2, jsonb_array_elements_text(s2.photos) AS elem
  WHERE s2.photos IS NOT NULL AND jsonb_typeof(s2.photos) = 'array'
  GROUP BY s2.id
) sub
WHERE s.id = sub.id;

-- Existing tile pyramids live at their OLD floor-plans-bucket paths (e.g.
-- `${projectId}/tiles/${pageId}/...`), not in the new floor-plan-tiles
-- bucket — moving thousands of individual tile objects between buckets via
-- SQL isn't practical, and floor-plans is about to go private anyway, which
-- would break OSD's public tile URLs regardless. Clearing tile_meta makes
-- every already-tiled page fall back to its flat cached/rendered image
-- (still fully viewable) until an admin re-runs "Generate Tiles" on it,
-- which now writes to floor-plan-tiles.
UPDATE public.pages SET tile_meta = NULL WHERE tile_meta IS NOT NULL;

-- Verify afterward:
--   1. Open an existing scope with a floor plan that was NOT tiled — it
--      should still load normally (signed URL resolution).
--   2. Open an existing scope with a floor plan that WAS tiled — it should
--      fall back to a flat image (tile_meta cleared) rather than break; use
--      "Generate Tiles" to re-tile it into floor-plan-tiles.
--   3. Open a session with completion photos — thumbnails and full-size
--      view/download should still work.
--   4. Upload a brand new floor plan and generate tiles for it end-to-end.
--   5. As a second organization's user (once Stage 5 exists), confirm you
--      cannot open another org's floor-plan Storage paths even with a
--      guessed/known project id.
