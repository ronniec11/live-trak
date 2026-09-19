// Full offline mode: downloads everything a project needs (floor plans +
// existing markup/session data) onto the device while there's a
// connection, so Projects/ProjectDetail/Canvas can all fall back to this
// local copy when a fetch fails — not just queue new writes (see
// offlineSync.js), but actually open and view something with zero
// connectivity from a cold start.
//
// A PDF source gets rendered to a flat PNG HERE, during download (while
// there's definitely a connection), rather than caching the raw PDF bytes
// and reaching for pdf.js again later offline. That was tried first and
// confirmed unreliable: pdf.js needs to load its worker script as a module,
// and iOS Safari's module-worker loading doesn't reliably use the HTTP
// cache with zero connectivity even when that exact script was already
// fetched — "setting up fake worker failed: importing a module script
// failed" on-device even after pre-warming it during download. A cached
// plain image needs nothing but <img>, which has no such dependency.
// A non-PDF (raster) source is cached as-is. Either way, offline viewing
// always renders flat (no OpenSeadragon/tiling) regardless of whether the
// page normally tiles on this device when online — there's no tile
// pyramid here to tile from, only ever a single flat image.
import { supabase } from './supabase'
import { dbPut, dbGet, dbGetAll, requestPersistentStorage } from './offlineDb'

const isIPadOrSafari = /iPad|Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  || /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
// Same cap used elsewhere in the app (Canvas.jsx's MAX_DIM) to keep a
// rendered floor plan from being too large a canvas for iOS Safari.
const MAX_CACHED_DIM = 4096

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

// Renders a PDF's first page to a PNG Blob, live, via the given URL —
// requires a real connection (pdf.js + its worker both need to load), which
// is exactly why this only ever runs at download time, never from
// initFromCache's offline path.
async function renderPdfToPngBlob(url) {
  const pdfjsLib = await import('pdfjs-dist')
  const { default: pdfWorkerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const pdfDoc = await pdfjsLib.getDocument({ url, withCredentials: false }).promise
  const page = await pdfDoc.getPage(1)
  const RENDER_SCALE = isIPadOrSafari ? 2.0 : 3.0
  let viewport = page.getViewport({ scale: RENDER_SCALE })
  if (viewport.width > MAX_CACHED_DIM || viewport.height > MAX_CACHED_DIM) {
    const scale = RENDER_SCALE * (MAX_CACHED_DIM / Math.max(viewport.width, viewport.height))
    viewport = page.getViewport({ scale })
  }
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width; canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

// Downloads one page's floor plan source + all its sessions (with their
// hl/pen markup images and photos) into a single cachedPages record.
async function cachePage(pg, projectId, onProgress) {
  let sourceUrl = pg.floor_plan_url
  if (sourceUrl && !sourceUrl.startsWith('http')) sourceUrl = resolveStorageUrl(sourceUrl)
  const rawBlob = sourceUrl ? await fetchAsBlob(sourceUrl) : null
  // The upload itself sets Storage's Content-Type from the browser File
  // object's own MIME type (see ProjectDetail.jsx's upload call), so the
  // fetched blob's .type is a direct, reliable signal — unlike guessing
  // from the URL string, which breaks if the stored path/filename doesn't
  // literally contain ".pdf" (e.g. a UUID-based storage key).
  const isPdf = rawBlob?.type === 'application/pdf'
    || (!!sourceUrl && (/\.pdf($|\?)/i.test(sourceUrl) || sourceUrl.toLowerCase().includes('.pdf')))

  let sourceBlob = rawBlob
  let sourceIsPdf = false
  if (isPdf && sourceUrl) {
    try {
      sourceBlob = await renderPdfToPngBlob(sourceUrl)
    } catch (e) {
      // Falls back to caching the raw PDF bytes — initFromCache will still
      // try pdf.js at view time offline, which at worst behaves exactly
      // like before this fix (no better, but no worse either).
      console.warn('[offlineCache] Failed to pre-render PDF for offline use, caching raw file instead:', e)
      sourceBlob = rawBlob
      sourceIsPdf = true
    }
  }

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
    await cachePage(pg, projectId, onProgress)
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
