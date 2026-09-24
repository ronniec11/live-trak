// Offline write queue for session saves. When a save can't reach Supabase
// (no signal, or a flaky in-building connection that drops mid-request), the
// session's canvases/photos/fields get queued here as plain Blobs + data
// instead of being lost, and synced automatically once a connection is back
// — see syncPendingOps(), called from Canvas.jsx (on save-time network
// failure, on the browser's 'online' event, and periodically while a page
// is open) and from the Projects/ProjectDetail "Sync" buttons.
import { supabase } from './supabase'
import { dbPut, dbGetAll, dbDelete, requestPersistentStorage } from './offlineDb'
import { refreshCachedPageIfDownloaded } from './offlineCache'

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

// Supabase-js throws a plain fetch failure (not a resolved {error}) when the
// network is genuinely unreachable — that's the signal an op should stay
// queued for later rather than being treated as a real, permanent rejection.
export function isNetworkError(err) {
  if (!err) return false
  if (err instanceof TypeError) return true
  const msg = String(err.message || err).toLowerCase()
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')
}

export async function enqueueSessionOp(op) {
  await requestPersistentStorage()
  const id = op.id || newId()
  await dbPut('pendingOps', { ...op, id, createdAt: op.createdAt || Date.now(), lastError: null })
  return id
}

export async function getPendingOps() {
  return dbGetAll('pendingOps')
}

// Deleting a session that still has an unsynced queued save (e.g. it was
// created entirely offline and never reached the database at all) needs to
// cancel that queued op too — otherwise the next successful sync would
// still insert/update it, resurrecting a session the user just deleted.
export async function cancelOp(id) {
  if (!id) return
  await dbDelete('pendingOps', id)
}

// Cancels every still-queued op for one session (its original insert, any
// queued photo updates, etc.) — called right before deleting that session,
// since a sync running any of them afterward would either resurrect the row
// or fail forever trying to update one that's already gone.
export async function cancelOpsForSession({ supabaseId, localSessionId }) {
  const ops = await getPendingOps()
  const matches = ops.filter(op =>
    (supabaseId && op.supabaseId === supabaseId) ||
    (localSessionId != null && op.localSessionId === localSessionId))
  await Promise.all(matches.map(op => dbDelete('pendingOps', op.id)))
}

async function uploadBlob(projectId, pageId, storageKey, blob, type, ext) {
  const path = `${projectId}/sessions/${pageId}/${storageKey}_${type}.${ext}`
  const { error } = await supabase.storage.from('floor-plans')
    .upload(path, blob, { upsert: true, contentType: blob.type || 'image/png' })
  if (error) throw error
  return path
}

// Same "database is missing this optional column" resilience already used
// for the online save path (see Canvas.jsx), factored out so the offline
// queue doesn't silently fail an entire sync over a migration nobody's run
// yet. Order matters no differently than it does online: each group is only
// tried once the previous attempt's error names it specifically.
const OPTIONAL_COLUMN_GROUPS = [
  { test: /crew_size|hours_worked/, keys: ['crew_size', 'hours_worked'] },
  { test: /\btotal_hours\b/, keys: ['total_hours'] },
  { test: /\blf\b|lf_data/, keys: ['lf', 'lf_data'] },
  { test: /\bphotos\b/, keys: ['photos'] },
]

async function withMissingColumnFallback(basePayload, run) {
  let payload = { ...basePayload }
  let { data, error } = await run(payload)
  for (const group of OPTIONAL_COLUMN_GROUPS) {
    if (!error || !group.test.test(error.message || '')) continue
    console.warn('[offlineSync] Retrying without columns (migration not run yet?):', group.keys, error.message)
    payload = { ...payload }
    group.keys.forEach(k => delete payload[k])
    ;({ data, error } = await run(payload))
  }
  if (error) throw error
  return data
}

async function syncOneOp(op) {
  if (op.kind === 'delete') {
    const { error } = await supabase.from('sessions').delete().eq('id', op.supabaseId)
    if (error) throw error
    return { supabaseId: op.supabaseId, deleted: true }
  }
  const [highlight_data, pen_data] = await Promise.all([
    op.hlBlob ? uploadBlob(op.projectId, op.pageId, op.storageKey, op.hlBlob, 'hl', 'png') : Promise.resolve(undefined),
    op.penBlob ? uploadBlob(op.projectId, op.pageId, op.storageKey, op.penBlob, 'pen', 'png') : Promise.resolve(undefined),
  ])
  const newPhotoUrls = op.newPhotoBlobs?.length
    ? await Promise.all(op.newPhotoBlobs.map((blob, i) =>
        uploadBlob(op.projectId, op.pageId, op.storageKey, blob, `photo${i}`, 'jpg')))
    : []
  const photos = [...(op.keptPhotoUrls || []), ...newPhotoUrls]

  const payload = { ...op.fields, photos, updated_at: new Date().toISOString() }
  if (highlight_data !== undefined) payload.highlight_data = highlight_data
  if (pen_data !== undefined) payload.pen_data = pen_data

  if (op.kind === 'insert') {
    payload.page_id = op.pageId
    payload.project_id = op.projectId
    payload.user_id = op.userId
    const data = await withMissingColumnFallback(payload,
      p => supabase.from('sessions').insert(p).select('id').single())
    return { supabaseId: data?.id, photos }
  }
  await withMissingColumnFallback(payload,
    p => supabase.from('sessions').update(p).eq('id', op.supabaseId))
  return { supabaseId: op.supabaseId, photos }
}

let syncing = false
// onOpSynced(op, result) lets the caller (Canvas.jsx) reattach the real
// supabaseId/photos URLs to whatever in-memory session object this op came
// from — the queue itself has no idea that object still exists.
export async function syncPendingOps(onOpSynced) {
  if (syncing) return { synced: 0, remaining: (await getPendingOps()).length, stillOffline: false }
  syncing = true
  try {
    const ops = (await getPendingOps()).sort((a, b) => a.createdAt - b.createdAt)
    let synced = 0
    // Every page touched by a successfully-synced op needs its offline
    // snapshot refreshed below (see refreshCachedPageIfDownloaded) — a Set
    // so a page with several queued ops (or several pages synced in one
    // pass, e.g. from the global Sync button rather than one open sheet)
    // only gets re-cached once each, not once per op.
    const syncedPageIds = new Set()
    for (const op of ops) {
      try {
        const result = await syncOneOp(op)
        await dbDelete('pendingOps', op.id)
        synced++
        if (op.pageId) syncedPageIds.add(op.pageId)
        onOpSynced?.(op, result)
      } catch (err) {
        if (isNetworkError(err)) {
          return { synced, remaining: ops.length - synced, stillOffline: true }
        }
        console.error('[offlineSync] Op failed (not a connectivity issue):', op.id, err)
        await dbPut('pendingOps', { ...op, lastError: err.message || String(err) })
      }
    }
    // Best-effort — a failure here shouldn't turn an otherwise-successful
    // sync into an error, it just means the offline snapshot stays stale
    // until the next sync retries it (or a manual re-download).
    for (const pageId of syncedPageIds) {
      try { await refreshCachedPageIfDownloaded(pageId) }
      catch (e) { console.warn('[offlineSync] Failed to refresh offline cache for page:', pageId, e) }
    }
    return { synced, remaining: (await getPendingOps()).length, stillOffline: false }
  } finally {
    syncing = false
  }
}
