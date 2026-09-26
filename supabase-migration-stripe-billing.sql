-- ============================================
-- Stripe subscription billing: organizations columns
-- Run this in the Supabase SQL editor
-- ============================================
--
-- Backs the Pricing page (src/pages/Pricing.jsx) and Company Hub's
-- "Plan & Billing" card (src/pages/CompanyHub.jsx). Written and read
-- almost entirely by the api/stripe/*.js serverless functions through the
-- service-role client (bypasses RLS) — there is no RLS bypass added for
-- these columns the way supabase-migration-super-admin.sql added one for
-- is_super_admin, since nothing needs to read another company's billing
-- info; each company can already read/update its own organizations row
-- (see the existing organizations RLS policies CompanyHub.jsx already
-- relies on).
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS stripe_customer_id text,
ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
ADD COLUMN IF NOT EXISTS plan text DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'business', 'enterprise')),
ADD COLUMN IF NOT EXISTS plan_status text DEFAULT 'active' CHECK (plan_status IN ('active', 'cancelled', 'past_due', 'trialing'));
