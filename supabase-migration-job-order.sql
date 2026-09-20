-- ============================================
-- Drag-to-reorder jobs (top-level Projects page)
-- Run this in the Supabase SQL editor
-- ============================================

-- Shared across everyone who can see the list (not per-user), same model
-- as the existing scope/project reorder (see
-- supabase-migration-project-order.sql).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS sort_order numeric;

-- Seed existing rows to match today's default (newest first), so nothing
-- visibly reshuffles the first time this loads.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM public.jobs
)
UPDATE public.jobs j SET sort_order = ordered.rn
FROM ordered WHERE ordered.id = j.id;

-- Mirrors set_project_sort_order's shape (SECURITY DEFINER, boolean
-- return so a blocked update is visible to the client instead of quietly
-- reverting on next load) — see that function's comments for why.
DROP FUNCTION IF EXISTS public.set_job_sort_order(uuid, numeric);
CREATE OR REPLACE FUNCTION public.set_job_sort_order(target_job_id uuid, new_order numeric)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE jobs SET sort_order = new_order
  WHERE id = target_job_id
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm', 'superintendent');
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;
