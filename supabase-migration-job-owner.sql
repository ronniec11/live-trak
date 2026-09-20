-- ============================================
-- Add an Owner field to jobs, alongside the existing GC (gc_name)
-- Run this in the Supabase SQL editor
-- ============================================

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS owner_name text;
