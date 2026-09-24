-- ============================================
-- Multi-tenant Stage 5: self-serve company signup
-- Run this in the Supabase SQL editor (after Stages 1-4)
-- ============================================
--
-- Up to now the only way to get a new person into Live-Trak was Team.jsx's
-- invite flow — which adds them into the CALLER's own organization. There
-- was no way for a brand new company (Mopping Man) to get their OWN
-- organization at all; every profile has always landed under Calderon
-- Technologies (the Stage 1 backfill target). This adds the missing path:
-- a person signs up with a password (src/pages/Login.jsx's new "Create
-- your company" mode), and once they're confirmed and signed in for the
-- first time, src/components/CompanySetup.jsx calls the RPC below to spin
-- up their own organization and make them its first admin.
--
-- The organizations table itself never got an INSERT policy in any
-- tracked migration (it predates all of them, created directly in the
-- dashboard) — on purpose, this doesn't add a public one. Routing
-- creation through one SECURITY DEFINER function keeps it auditable and
-- lets it enforce "only for yourself, only if you don't already have a
-- company" server-side, rather than trusting the client to behave.

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

  -- The one real safety check this function exists to enforce: without it,
  -- calling this twice (or a bug retrying it) would silently re-parent an
  -- existing team member into a brand new, empty organization, cutting
  -- them off from their real team's jobs with no warning.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'You already belong to a company';
  END IF;

  INSERT INTO public.organizations (name) VALUES (trimmed_name) RETURNING id INTO new_org_id;

  -- Only ever touches the CALLER's own row (auth.uid(), never a passed-in
  -- id) — this can't be used to promote or re-org anyone else.
  UPDATE public.profiles
  SET organization_id = new_org_id, role = 'admin'
  WHERE id = auth.uid();

  RETURN new_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_and_claim_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization_and_claim_admin(text) TO authenticated;

-- ── organizations table: close the read/write gap while we're in here ──
-- Company Hub (src/pages/CompanyHub.jsx) already successfully reads and
-- updates the organizations table today, which means SOME policy already
-- grants that — but it was never added by any tracked migration, so its
-- exact name/shape is unknown, and going by this database's track record
-- (see supabase-migration-drop-blanket-policies.sql's own notes), the
-- likeliest explanation is a blanket USING (true). With a second
-- organization about to exist for real, that would let anyone read (and
-- organizations_update_admin, added in supabase-migration-company-hub.sql,
-- already lets any admin at ANY company WRITE) another company's name,
-- address, phone, and settings.
--
-- This adds the correctly-scoped versions. It can't DROP a policy it
-- doesn't know the name of — Postgres evaluates RLS policies as OR, so if
-- an old permissive one is still sitting there after this runs, it wins
-- and nothing looks different yet. Run this check afterward:
--   SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'organizations';
-- and paste the result back — any policy whose USING isn't scoped to
-- `id = my_organization_id()` (or an equivalent admin-of-this-org check)
-- needs to be dropped.
DROP POLICY IF EXISTS "organizations_select_own_org" ON public.organizations;
CREATE POLICY "organizations_select_own_org" ON public.organizations FOR SELECT USING (
  id = public.my_organization_id()
);

DROP POLICY IF EXISTS "organizations_update_admin" ON public.organizations;
CREATE POLICY "organizations_update_admin" ON public.organizations FOR UPDATE USING (
  id = public.my_organization_id()
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- Verify afterward:
--   1. Run the pg_policies check above — confirm no other SELECT/UPDATE
--      policy on organizations besides the two just created.
--   2. As your existing (Calderon) admin, confirm Company Hub still loads
--      and Save still works — nothing should look different day to day.
--   3. Sign up as a brand new user (a throwaway email works) through
--      Login.jsx's new "Create your company" flow, confirm the email,
--      sign in, and confirm you land in a new, empty company — Projects
--      page shows no jobs, Company Hub shows your new company's own name,
--      Team page shows only you.
