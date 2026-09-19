// Full offline mode: downloads everything a project needs (floor plans +
// existing markup/session data) onto the device while there's a
// connection, so Projects/ProjectDetail/Canvas can all fall back to this
// local copy when a fetch fails — not just queue new writes (see
// offlineSync.js), but actually open and view something with zero
// connectivity from a cold start.
//
// Floor plans are cached as the ORIGINAL source file (the PDF/raster bytes
// behind floor_plan_url), not a rendered image or a tile pyramid — the same
// choice already made for sheet report snapshots on tiled pages (see
// renderFloorPlanBase in Canvas.jsx): re-rendering the source locally sidesteps
// needing to cache a whole tile pyramid (hundreds of small files) or read
// pixels back out of OpenSeadragon's WebGL canvas. Offline viewing always
// renders flat (no OSD/tiling) regardless of whether the page normally
// tiles on this device when online.
import { supabase } from './supabase'
import { dbPut, dbGet, dbGetAll, requestPersistentStorage } from './offlineDb'

async function fetchAsBlob(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`)
  return res.blob()
}

function resolveStorageUrl(value) {
  if (!value) return null
  if (value.startsWith('http')) return value
  const { data } = supabase.storage.from('floor-plans').getPublicUrl(value)
  return data?.publicUrl || null
}

// Downloads one page's floor plan source + all its sessions (with their
// hl/pen markup images and photos) into a single cachedPages record.
async function cachePage(pg, projectId, onProgress) {
  let sourceUrl = pg.floor_plan_url
  if (sourceUrl && !sourceUrl.startsWith('http')) sourceUrl = resolveStorageUrl(sourceUrl)
  const sourceBlob = sourceUrl ? await fetchAsBlob(sourceUrl) : null
  const sourceIsPdf = !!sourceUrl && (/\.pdf($|\?)/i.test(sourceUrl) || sourceUrl.toLowerCase().includes('.pdf'))

  const { data: dbSessions, error } = await supabase
    .from('sessions')
    .select('*, profiles(full_name, avatar_color)')
    .eq('page_id', pg.id)
    .order('created_at', { ascending: true })
  if (error) throw error

  const sessions = []
  for (const dbSess of (dbSessions || [])) {
    onProgress?.(`${pg.name} — ${dbSess.name}`)
    let hlBlob = null, penBlob = null
    try { if (dbSess.highlight_data) hlBlob = await fetchAsBlob(dbSess.highlight_data) } catch (e) { console.warn('[offlineCache] hl fetch failed:', e) }
    try { if (dbSess.pen_data) penBlob = await fetchAsBlob(dbSess.pen_data) } catch (e) { console.warn('[offlineCache] pen fetch failed:', e) }
    sessions.push({
      id: dbSess.id, name: dbSess.name, color: dbSess.color,
      sf: dbSess.sf, lf: dbSess.lf, work_date: dbSess.work_date, created_at: dbSess.created_at,
      crew_size: dbSess.crew_size, hours_worked: dbSess.hours_worked,
      count_data: dbSess.count_data, lf_data: dbSess.lf_data, photos: dbSess.photos,
      profiles: dbSess.profiles, hlBlob, penBlob,
    })
  }

  await dbPut('cachedPages', {
    id: pg.id, projectId, name: pg.name, scale: pg.scale, ppi: pg.ppi,
    pixels_per_foot: pg.pixels_per_foot, calibrated: pg.calibrated,
    sourceBlob, sourceIsPdf, sessions, cachedAt: Date.now(),
  })
}

// onProgress(text) is called with a short human-readable status as each
// sheet/session downloads — this can take a while for a project with many
// sheets or heavily-marked-up sessions, so the caller should show it.
export async function downloadProjectForOffline(projectId, onProgress) {
  await requestPersistentStorage()

  const { data: project, error: projErr } = await supabase
    .from('projects').select('*').eq('id', projectId).single()
  if (projErr) throw projErr

  const { data: pages, error: pagesErr } = await supabase
    .from('pages').select('*').eq('project_id', projectId).order('created_at', { ascending: true })
  if (pagesErr) throw pagesErr

  for (const pg of (pages || [])) {
    onProgress?.(`Downloading ${pg.name}…`)
    await cachePage(pg, projectId)
  }

  await dbPut('cachedProjects', {
    id: projectId,
    name: project.name, description: project.description, status: project.status,
    daily_sf_target: project.daily_sf_target, total_sf_target: project.total_sf_target, cost: project.cost,
    pages: (pages || []).map(p => ({ id: p.id, name: p.name })),
    cachedAt: Date.now(),
  })
}

export async function getCachedProject(projectId) {
  return dbGet('cachedProjects', projectId)
}

export async function getCachedPage(pageId) {
  return dbGet('cachedPages', pageId)
}

export async function listCachedProjects() {
  return dbGetAll('cachedProjects')
}

export async function isProjectCached(projectId) {
  return !!(await getCachedProject(projectId))
}
