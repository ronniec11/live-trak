// Resolves a stored floor-plans reference (a bare Storage path, going
// forward — see supabase-migration-org-scoping-stage4-storage.sql) into
// something actually usable: a signed, time-limited URL.
//
// Also tolerates two legacy shapes so this works correctly regardless of
// whether that migration's data-conversion step has run yet on a given
// deployment: a full "public" URL from before the floor-plans bucket went
// private (the prefix gets stripped back down to a bare path, then that's
// what gets signed), and an inline base64 data: URL (very old rows,
// self-contained — returned as-is, nothing to sign).
import { supabase } from './supabase'

const PUBLIC_URL_PREFIX = /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/floor-plans\//

// Field workers can plausibly leave a floor plan open for a full shift —
// long enough that "resign on every render" isn't worth the complexity,
// but short enough that a link is never valid indefinitely, unlike the
// public URLs this replaces.
export const SIGNED_URL_TTL_SECONDS = 8 * 60 * 60

export function storagePathFrom(stored) {
  if (!stored) return null
  return stored.replace(PUBLIC_URL_PREFIX, '')
}

export async function resolveStorageUrl(stored, ttlSeconds = SIGNED_URL_TTL_SECONDS) {
  if (!stored) return null
  // data: URLs are old inline rows; blob: URLs are offline-cached bytes
  // (see offlineCache.js) — both are already directly usable, nothing to sign.
  if (stored.startsWith('data:') || stored.startsWith('blob:')) return stored
  const path = storagePathFrom(stored)
  const { data, error } = await supabase.storage.from('floor-plans').createSignedUrl(path, ttlSeconds)
  if (error || !data?.signedUrl) {
    console.error('[storageUrls] Failed to sign floor-plans path:', path, error)
    return null
  }
  return data.signedUrl
}

// Batch form — session photo arrays are the common multi-URL case. Skips
// nulls from failed individual signs rather than failing the whole batch.
export async function resolveStorageUrls(storedList, ttlSeconds = SIGNED_URL_TTL_SECONDS) {
  const resolved = await Promise.all((storedList || []).map(s => resolveStorageUrl(s, ttlSeconds)))
  return resolved.filter(Boolean)
}
