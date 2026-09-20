-- ============================================
-- Lunch break deduction (per scope) for Sheet Report man-hours
-- Run this in the Supabase SQL editor
-- ============================================

-- Minutes per crew member deducted from a session's logged hours before
-- man-hours (crew x hours) is computed for the Sheet Report's Total Hours
-- column/total and SF/Man-Hour rate. Sessions still store the raw crew
-- size and hours worked exactly as entered — this only affects the
-- report's derived production numbers, not the logged data itself.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS lunch_break_minutes numeric;
