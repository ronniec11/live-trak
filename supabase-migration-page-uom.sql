-- ============================================
-- Multi-UOM support: per-page unit of measure + targets
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Every page/sheet already inherits its scope's uom (SF/LF/Count) and
-- target (daily_sf_target/total_sf_target on projects) — fine as long as
-- every sheet under one scope is tracked the same way. This adds a
-- per-PAGE override: a sheet can now carry its own unit_of_measure
-- (SF/LF/each — a separate, page-level vocabulary from the scope's own
-- SF/LF/Count) and its own daily_target/total_target, set from Sheet
-- Settings (the gear icon on each page's thumbnail in ScopeDetail.jsx).
-- A page-level target always wins over the scope's when both exist — see
-- Canvas.jsx's "page overrides scope" comment at its page-load fetch.
--
-- Session rows also get unit_of_measure, recording which unit was active
-- on the page at save time — denormalized the same way sf/lf/count_data
-- already are (every session carries all of them regardless of which
-- tool was used; the page's unit_of_measure just says which one is "the"
-- progress number). Not read back anywhere today — there for future
-- reports/exports that may want it without re-joining pages.

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS unit_of_measure text DEFAULT 'SF';
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS daily_target numeric;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS total_target numeric;

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS unit_of_measure text;

-- Verify afterward:
--   1. Open a sheet's thumbnail on ScopeDetail.jsx, hover it, click the
--      new gear icon (bottom-left) — Sheet Settings should open with the
--      page's current name/unit/targets, editable and saveable.
--   2. Set a page's unit to LF with a total target, save a session with
--      the LF tool on it, then open that sheet in Canvas — the header
--      should read "Session LF"/"Total LF" instead of SF, and the
--      numbers should reflect the lf field, not sf.
--   3. Give a scope two pages with different units (one SF, one LF) —
--      ScopeDetail.jsx's Progress card should show a "Progress by Unit
--      of Measure" section with one bar per unit, and the job dashboard's
--      scope card (ProjectDetail.jsx) should show the same breakdown.
