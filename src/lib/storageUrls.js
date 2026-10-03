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

// Shared by the two batch forms below. One real HTTP request signs every
// Storage path at once (the Storage API's own createSignedUrls, plural) —
// looping resolveStorageUrl() per path instead issues one round trip per
// path, which on a page with many stored references (a long job's worth of
// session markup, say) is the dominant cost of loading it, especially on a
// slow mobile connection where each extra round trip's latency adds up
// rather than overlapping. data:/blob: entries need no network call either
// way and are passed through untouched, same as resolveStorageUrl.
async function batchResolve(storedList, ttlSeconds) {
  const list = storedList || []
  const pairs = list.map(stored => ({ stored, url: null }))
  const toSign = [] // { idx, path }
  pairs.forEach((p, idx) => {
    if (!p.stored) return
    if (p.stored.startsWith('data:') || p.stored.startsWith('blob:')) { p.url = p.stored; return }
    toSign.push({ idx, path: storagePathFrom(p.stored) })
  })
  if (toSign.length) {
    const { data, error } = await supabase.storage.from('floor-plans').createSignedUrls(toSign.map(t => t.path), ttlSeconds)
    if (error) {
      console.error('[storageUrls] Batch sign failed:', error)
    } else {
      data.forEach((d, i) => { pairs[toSign[i].idx].url = d.signedUrl || null })
    }
  }
  return pairs
}

// Batch form — session photo arrays are the common multi-URL case. Skips
// nulls from failed individual signs rather than failing the whole batch.
export async function resolveStorageUrls(storedList, ttlSeconds = SIGNED_URL_TTL_SECONDS) {
  const pairs = await batchResolve(storedList, ttlSeconds)
  return pairs.map(p => p.url).filter(Boolean)
}

// Batch form that keeps each result keyed to its original stored value
// (rather than resolveStorageUrls' plain filtered array) — for callers that
// need to look a resolved URL back up per source row, e.g. loading many
// sessions' hl/pen canvases where each row's own highlight_data/pen_data
// string is the lookup key. A failed individual sign is simply absent from
// the map; callers already treat "no resolved URL" as the normal not-found
// case.
export async function resolveStorageUrlMap(storedList, ttlSeconds = SIGNED_URL_TTL_SECONDS) {
  const pairs = await batchResolve(storedList, ttlSeconds)
  const map = new Map()
  for (const p of pairs) if (p.url) map.set(p.stored, p.url)
  return map
}
