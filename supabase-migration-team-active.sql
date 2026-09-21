-- ============================================
-- Team page: "Remove from Team" support
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Removing someone deactivates their profile rather than deleting it —
-- sessions.user_id references auth.users (not profiles), so deleting the
-- profiles row wouldn't touch their past work either way, but deleting it
-- would still break the session.profiles(full_name) join those old
-- sessions/reports rely on to show who logged them. Deactivating keeps
-- that name intact and is reversible (Team.jsx's Restore button).
--
-- No new RLS policy needed — profiles already has an admin-or-self UPDATE
-- policy (see supabase-migration-team.sql's profiles_update_own_or_admin)
-- that covers this new column the same as it covers role/phone/company.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
