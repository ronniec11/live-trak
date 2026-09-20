-- ============================================
-- Company Hub: organization profile + settings columns
-- Run this in the Supabase SQL editor before using the Company Hub page.
-- ============================================

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS unit_system text DEFAULT 'imperial' CHECK (unit_system IN ('imperial', 'metric')),
ADD COLUMN IF NOT EXISTS measurement_display text DEFAULT 'decimal' CHECK (measurement_display IN ('decimal', 'fraction')),
ADD COLUMN IF NOT EXISTS date_format text DEFAULT 'MM/DD/YYYY',
ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Chicago',
ADD COLUMN IF NOT EXISTS default_daily_target numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS website text,
ADD COLUMN IF NOT EXISTS address text;

-- organizations had no UPDATE policy (only ever read, via the
-- organizations(name) embed on Projects.jsx/ProjectDetail.jsx) — without
-- this, CompanyHub.jsx's save buttons would silently update zero rows
-- (see supabase-migration-fix-missing-policies.sql's note on exactly this
-- failure mode) rather than actually erroring.
DROP POLICY IF EXISTS "organizations_update_admin" ON public.organizations;
CREATE POLICY "organizations_update_admin" ON public.organizations FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);
