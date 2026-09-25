-- ============================================
-- Company logo: shown top-right on Sheet Reports (on-screen and PDF)
-- Run this in the Supabase SQL editor
-- ============================================

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS logo_url text;

-- New, dedicated public bucket. A logo is meant to be printed on reports
-- handed to clients/GCs — there's no confidentiality to protect the way
-- there is for floor plans/photos, so this deliberately stays public
-- rather than going through the signed-URL machinery the floor-plans
-- bucket needs (same reasoning as floor-plan-tiles staying public — see
-- supabase-migration-org-scoping-stage4-storage.sql).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  true,
  2097152,  -- 2 MB — plenty for a logo
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Every path is `${organizationId}/logo.<ext>` (see CompanyHub.jsx) — the
-- leading folder segment IS the organization id directly here, unlike
-- floor-plans where it has to be resolved through a project -> job chain.
CREATE POLICY "org_logos_select_public" ON storage.objects FOR SELECT USING (
  bucket_id = 'org-logos'
);

CREATE POLICY "org_logos_insert_admin" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'org-logos' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' AND
  (storage.foldername(name))[1]::uuid = public.my_organization_id()
);

CREATE POLICY "org_logos_update_admin" ON storage.objects FOR UPDATE USING (
  bucket_id = 'org-logos' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' AND
  (storage.foldername(name))[1]::uuid = public.my_organization_id()
);

CREATE POLICY "org_logos_delete_admin" ON storage.objects FOR DELETE USING (
  bucket_id = 'org-logos' AND
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' AND
  (storage.foldername(name))[1]::uuid = public.my_organization_id()
);

-- Verify afterward:
--   1. As your Calderon admin, Company Hub -> Company Profile -> upload a
--      logo. It should appear in the preview box immediately, and in the
--      top-right of a Sheet Report (both the on-screen view and the
--      printed/PDF version).
--   2. Confirm a non-admin (foreman/pm/superintendent) can still SEE the
--      logo on a report, just can't upload/replace/remove one from
--      Company Hub (that page is admin-only already, at the route level).
