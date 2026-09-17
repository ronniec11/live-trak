-- ============================================
-- Drag-to-reorder projects
-- Run this in the Supabase SQL editor
-- ============================================

-- Shared across everyone who can see the list (not per-user) — simplest
-- model for a small team where the order is meant to be a shared,
-- agreed-upon arrangement rather than a personal preference.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS sort_order numeric;

-- Seed existing rows to match today's default (newest first), so nothing
-- visibly reshuffles the first time this loads.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM public.projects
)
UPDATE public.projects p SET sort_order = ordered.rn
FROM ordered WHERE ordered.id = p.id;

-- A dedicated, narrow function rather than broadening the general
-- projects_update_pm policy: that policy is admin/pm only specifically so
-- Superintendent can't edit cost/SF fields via a raw API call (the app's
-- canEditFinancials only hides the UI control — RLS is the real
-- enforcement, and it can't distinguish "which column changed" from a
-- plain UPDATE). This function only ever touches sort_order, so it can
-- safely allow Superintendent too, matching canManage elsewhere in the
-- app, without reopening that gap.
--
-- Returns whether a row was actually updated. The WHERE clause's role
-- check can silently match zero rows (wrong/missing role, or auth.uid()
-- not matching a profiles row) without ever raising a Postgres error — a
-- plain `RETURNS void` version of this function looks like it succeeded
-- to the client in that case, and the reorder then reverts on next load
-- with no indication why. Returning false lets the client tell the two
-- apart and say so.
CREATE OR REPLACE FUNCTION public.set_project_sort_order(target_project_id uuid, new_order numeric)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE projects SET sort_order = new_order
  WHERE id = target_project_id
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm', 'superintendent');
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;
