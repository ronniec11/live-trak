-- ============================================
-- Sessions: editable Total Hours override
-- Run this in the Supabase SQL editor
-- ============================================
--
-- The Save/Edit Session modals show a "Total Hours" field that defaults to
-- crew_size x hours_worked (live-recomputed as either field is typed), but
-- is itself editable so it can be overridden when that math doesn't match
-- reality — e.g. 8 crew logged for 8 hours, but one person actually left
-- after 4. Only saved as an explicit value when it differs from the
-- crew x hours default; otherwise left null so it keeps auto-deriving.
--
-- When set, this overrides the crew x (hours - lunch break) man-hours
-- calculation used by both the in-app Sheet Report (Canvas.jsx) and the
-- Production Report (src/pages/Reports.jsx) — see sessionManHours /
-- shapeRow in those files.

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS total_hours numeric;
