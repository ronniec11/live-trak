-- ============================================
-- Session-level category tagging
-- Run this in the Supabase SQL editor.
-- ============================================
--
-- Lets one session be tagged with one of the tags already attached to its
-- page (via page_tags, see supabase-migration-page-tags.sql) — e.g. a
-- "Final Clean" sheet with both "Cold Aisle" and "Hot Aisle" tags attached
-- can have each session say which one it was, so progress/the Sheet
-- Report can be broken out per category instead of one flat total for the
-- whole sheet. Nullable: an untagged session (or a page with no tags at
-- all) behaves exactly as before.
--
-- Not constrained to the session's own page_tags here — RLS trusts the
-- app to only offer a page's own attached tags in the picker, same as
-- page_tags itself isn't cross-checked against the page's project/org
-- beyond its own RLS policies.

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS tag_id UUID REFERENCES public.tags ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_tag_id_idx ON public.sessions(tag_id);
