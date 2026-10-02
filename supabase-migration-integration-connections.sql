-- ============================================
-- Generalized third-party integration connection tokens
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Replaces the Autodesk-only aps_connections table now that a second
-- integration (Google Drive) needs the exact same shape (one row per
-- user per provider, tokens never exposed to the browser) — the Company
-- Hub's Integrations panel needs to show connect/disconnect status for
-- however many providers exist from a single query, which a table per
-- provider would make needlessly awkward.
--
-- Same RLS posture as aps_connections: enabled with NO policies at all.
-- Only serverless functions using SUPABASE_SERVICE_ROLE_KEY ever touch
-- this table; the app only ever sees true/false connected status through
-- api/integrations/status.js, never the tokens themselves.

CREATE TABLE IF NOT EXISTS public.integration_connections (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz,
  connected_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies — service role only (see comment above).

-- Carry over existing Autodesk connections so nobody has to reconnect
-- just because the storage moved.
INSERT INTO public.integration_connections (user_id, provider, access_token, refresh_token, expires_at, connected_at, updated_at)
SELECT user_id, 'autodesk', access_token, refresh_token, expires_at, created_at, updated_at
FROM public.aps_connections
ON CONFLICT (user_id, provider) DO NOTHING;

-- aps_connections is no longer written to as of this migration. Left in
-- place as a safety net — once you've confirmed the Integrations panel
-- still shows Autodesk as connected, it's safe to drop:
-- DROP TABLE IF EXISTS public.aps_connections;
