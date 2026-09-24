-- ============================================
-- Autodesk Platform Services (APS) connection tokens
-- Run this in the Supabase SQL editor
-- ============================================
--
-- A dedicated table, NOT columns on profiles. profiles has a
-- "profiles_select_all" policy (FOR SELECT USING (true)) — any signed-in
-- teammate can read any other teammate's profile row, and the app already
-- does this all over the place (e.g. CompanyHub's team list does
-- `.from('profiles').select('*')`). Storing APS tokens as profile columns
-- would have handed every teammate everyone else's Autodesk credentials.
--
-- RLS is enabled here with NO policies at all — nothing is selectable or
-- writable by the anon/authenticated roles. Only the serverless functions
-- (using SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS) ever touch this
-- table. The app checks connection status through api/autodesk/status.js,
-- which reports true/false and never returns the tokens themselves.

CREATE TABLE IF NOT EXISTS public.aps_connections (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aps_connections ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies — service role only (see comment above).
