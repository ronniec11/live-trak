-- ============================================
-- Server-side tile generation fallback: status tracking columns
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Client-side tiling (src/lib/tileGenerator.js, pdf.js in the browser) stays
-- the default — fast, free, and correct for the overwhelming majority of
-- real-world sheets. But pdf.js is a browser-embedded VIEWER, not a
-- hardened production rasterizer: a real customer's sheet was confirmed to
-- hang indefinitely (independent of chunk size — see tileGenerator.js's own
-- comments) on invisible leftover CAD-export content that a customer would
-- have no way to diagnose or work around themselves.
--
-- api/tiles/generate.js is the fallback: when client-side tiling fails, the
-- app now hands the same page off to a server-side function that uses
-- mupdf (a mature, production-grade C/WASM PDF library, not pdf.js) to
-- rasterize it instead — same tile_meta shape, same Storage bucket/paths,
-- so the viewer (OpenSeadragon/buildTileSource) doesn't need to know or
-- care which path produced the tiles.
--
-- These columns track that server-side job's state, since it can take
-- several minutes and the page needs to show something better than a blank
-- "is this stuck?" state while it runs.

ALTER TABLE public.pages
ADD COLUMN IF NOT EXISTS tile_status text,
ADD COLUMN IF NOT EXISTS tile_error text;

-- No new RLS policy needed — api/tiles/generate.js writes through the
-- service-role client (adminClient(), see api/tiles/_lib.js), which
-- bypasses RLS entirely; the route itself verifies the caller's session
-- and role before touching anything (same pattern as api/stripe/*).
-- Existing SELECT policies on pages already let the page's own org read
-- these two new columns like any other column on the row.

-- Verify afterward:
--   select tile_status, tile_error from pages limit 1;
--   -- should succeed with both columns present (NULL is fine — no job run yet).
