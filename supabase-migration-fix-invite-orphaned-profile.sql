-- ============================================
-- Fix "Cannot coerce the result to a single JSON object" on Add Person
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Team.jsx's Add Person flow called signInWithOtp to create the invited
-- person's auth.users row, which fires handle_new_user (a trigger) to
-- create their matching profiles row, then immediately ran a plain
-- .update(...).eq('email', email).select().single() to fill in the fields
-- the trigger doesn't know about (phone/company/avatar_color).
--
-- Two different things can make that update match zero rows, and
-- .single() turns either one into a raw, confusing
-- "Cannot coerce the result to a single JSON object" instead of this
-- flow's own friendlier message:
--   1. A genuine timing race — the trigger just hadn't landed yet.
--   2. signInWithOtp silently NO-OPS when the email already has an
--      auth.users row (e.g. a prior attempt that got this far before
--      failing some other way, or two people adding the same person at
--      once) — no new row is ever inserted, so the trigger never fires
--      at all, and every future attempt for that same email fails this
--      exact way forever, not just once.
--
-- This RPC replaces that plain update: it looks up the auth user directly
-- by email and upserts their profile itself (ON CONFLICT DO UPDATE),
-- instead of depending on a trigger it has no control over timing-wise —
-- fixing both cases, not just the first one.

CREATE OR REPLACE FUNCTION public.upsert_invited_profile(
  p_email text,
  p_full_name text,
  p_phone text,
  p_company text,
  p_role text,
  p_avatar_color text,
  p_organization_id uuid
)
RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user found for %', p_email;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, phone, company, role, avatar_color, organization_id)
  VALUES (v_user_id, p_full_name, p_email, p_phone, p_company, p_role, p_avatar_color, p_organization_id)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    company = EXCLUDED.company,
    role = EXCLUDED.role,
    avatar_color = EXCLUDED.avatar_color,
    organization_id = EXCLUDED.organization_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_invited_profile(text, text, text, text, text, text, uuid) TO authenticated;

-- Verify afterward: Add Person for a brand-new email should work as
-- before, and re-adding an email stuck in the "Cannot coerce..." state
-- (an auth user with no matching profile) should now succeed instead of
-- failing the same way every time.
