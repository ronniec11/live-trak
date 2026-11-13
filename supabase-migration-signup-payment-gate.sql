-- ============================================
-- Gate self-signup behind payment (14-day trial)
-- Run this in the Supabase SQL editor.
-- ============================================
--
-- Today, create_organization_and_claim_admin (supabase-migration-org-
-- scoping-stage5-signup.sql) hands a brand new self-signup company a
-- fully working organization for free — organizations.plan_status
-- defaults to 'active', so there was never anything to pay for. That's
-- the exact gap that let someone sign up and get in with zero gate: the
-- "Create your company" form (Login.jsx) has no invite and no payment
-- check anywhere in its path.
--
-- This doesn't touch the invite flow (Team.jsx) at all — an invited
-- person's organization_id is set directly from the inviter's existing
-- org and never calls this RPC, so nothing here affects them.
--
-- 'incomplete': a NEW plan_status meaning "organization exists, but
-- hasn't started a trial or paid yet" — set only by
-- create_organization_and_claim_admin below, for a BRAND NEW self-signup
-- org. src/components/SubscribeGate.jsx (rendered by ProtectedRoute
-- whenever profile.organizations.plan_status === 'incomplete') is the
-- only way out of it: starting Stripe Checkout for the 'basic' plan
-- (api/stripe/create-checkout.js, 14-day trial, card required upfront).
-- The checkout.session.completed webhook then moves plan_status to
-- 'trialing' the same way it already does for every other plan.
--
-- Existing organizations are untouched — this only changes what a FUTURE
-- call to the RPC inserts; nothing here updates already-existing rows,
-- so no currently-paying (or even currently-free) company is affected.
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_plan_status_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_plan_status_check
  CHECK (plan_status IN ('active', 'cancelled', 'past_due', 'trialing', 'incomplete'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_plan_check
  CHECK (plan IN ('free', 'basic', 'starter', 'pro', 'business', 'enterprise'));

CREATE OR REPLACE FUNCTION public.create_organization_and_claim_admin(org_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  trimmed_name text := btrim(org_name);
BEGIN
  IF trimmed_name IS NULL OR trimmed_name = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'No profile found for the current user';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'You already belong to a company';
  END IF;

  -- plan_status starts 'incomplete', not the column default of 'active' —
  -- this one line is the entire gate. SubscribeGate.jsx is the only path
  -- that moves it forward (via a real Stripe trial/subscription).
  INSERT INTO public.organizations (name, plan, plan_status)
  VALUES (trimmed_name, 'free', 'incomplete')
  RETURNING id INTO new_org_id;

  UPDATE public.profiles
  SET organization_id = new_org_id, role = 'admin'
  WHERE id = auth.uid();

  RETURN new_org_id;
END;
$$;
