-- ============================================
-- Multi-tenant Stage 1: profiles.organization_id
-- Run this in the Supabase SQL editor
-- ============================================
--
-- First step of making Live-Trak genuinely multi-tenant (a second real
-- company, e.g. Mopping Man, with its own fully walled-off data). Today
-- NOTHING ties a user to a company — "admin"/"pm" are global roles, and
-- `jobs.organization_id` is only ever filtered client-side via a hardcoded
-- constant (see Projects.jsx/CompanyHub.jsx). This is the foundation every
-- later stage (RLS on jobs/scopes/pages/sessions, RLS on profiles itself,
-- the private-Storage rework, the actual company-signup flow) builds on.
--
-- Left NULLABLE for now on purpose, not NOT NULL yet: the invite flow
-- (Team.jsx) and the future "create a new company" signup flow both create
-- rows through handle_new_user() below, and until every one of those paths
-- reliably supplies an organization_id, forcing NOT NULL here would risk
-- breaking signup/invites outright. A later migration tightens this once
-- Stage 5 (company signup) is in place and every path is confirmed to set
-- it.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- Backfill: every account that exists today was created before any of this
-- existed, so all of it belongs to Calderon Technologies (the one and only
-- organization so far — same id already hardcoded as ORGANIZATION_ID in
-- Projects.jsx/CompanyHub.jsx).
UPDATE public.profiles
SET organization_id = '2fc904e9-daa0-4d4d-8fb3-85fb0e84360e'
WHERE organization_id IS NULL;

-- Reads organization_id out of the new user's signup metadata, same as it
-- already does for full_name/role — Team.jsx's invite call is being updated
-- to pass the inviting admin's own organization_id here (see that file's
-- diff), so every newly invited teammate lands in the right company
-- immediately instead of needing a manual fix-up afterward.
--
-- Also corrects this function to the columns profiles actually has live
-- today (full_name/avatar_color) — the version tracked in
-- supabase-schema.sql still references name/color, which stopped matching
-- the real table at some undocumented point (see that file's own drift
-- notes). This CREATE OR REPLACE is the first time that correction is
-- captured in a tracked migration rather than existing only as a hand-edit
-- in the dashboard.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, avatar_color, organization_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'foreman'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_color', '#4ade80'),
    NULLIF(NEW.raw_user_meta_data->>'organization_id', '')::uuid
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Verify afterward:
--   SELECT id, full_name, email, role, organization_id FROM public.profiles ORDER BY created_at;
-- Every row should show the Calderon Technologies org id above.
