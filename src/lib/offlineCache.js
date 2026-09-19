// Full offline mode: downloads everything a project needs (floor plans +
// existing markup/session data) onto the device while there's a
// connection, so Projects/ProjectDetail/Canvas can all fall back to this
// local copy when a fetch fails — not just queue new writes (see
// offlineSync.js), but actually open and view something with zero
// connectivity from a cold start.
//
// A tiled page already has a pyramid rendered ONCE, at upload time (see
// tileGenerator.js) — not on whichever device happens to be viewing it.
// Stitching an appropriately-sized level of that pyramid into the offline
// copy (stitchTilesToImage) reuses that existing render instead of asking
// this device to redo it, the same "render once, every device just
// downloads the result" model Autodesk/Procore use. It also means no
// pdf.js dependency at all for these pages, sidestepping a confirmed iOS
// Safari issue: pdf.js needs to load its worker script as a module, and
// Safari's module-worker loading doesn't reliably use the HTTP cache with
// zero connectivity even when that exact script was fetched moments
// earlier ("setting up fake worker failed: importing a module script
// failed" on-device, even after pre-warming it during download).
//
// A page with no pyramid (never tiled) still needs pdf.js if its source is
// a PDF — but that only ever runs here, during download, while there's
// definitely a connection; a non-PDF (raster) source is cached as-is.
// Either way, offline viewing always renders flat (no OpenSeadragon) —
// initFromCache in Canvas.jsx just displays whatever single flat image
// ended up cached, regardless of which of these three paths produced it.
import { supabase } from './supabase'
import { dbPut, dbGet, dbGetAll, requestPersistentStorage } from './offlineDb'

const isIPadOrSafari = /iPad|Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  || /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
// A tiled page's ONLINE path caps its overlay canvases at 2048 specifically
// because every session on the sheet gets its own full-size hl+pen canvas
// resident at once (see Canvas.jsx's OVERLAY_MAX_DIM) — a heavily-marked-up
// sheet at 4096 was confirmed to crash iOS Safari from memory pressure
// (multiple 4096×4096 canvases, ~64MB each, add up fast). The offline
// render is exactly that same "many full-size session canvases" shape —
// initFromCache decodes every cached session's markup to match this same
// size — so it needs the same iPad-specific cap, not the more generous one
// a non-tiled desktop page can afford.
const MAX_CACHED_DIM = isIPadOrSafari ? 2048 : 4096

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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Needed to draw a cross-origin (Storage) image onto a canvas and then
    // read it back out via toBlob() without the canvas being tainted.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load tile: ' + url))
    img.src = url
  })
}

// Same pyramid math tileGenerator.js used to build each level in the first
// place, needed here in reverse to know a level's exact pixel dimensions.
function levelDims(fullW, fullH, maxLevel, level) {
  const factor = 2 ** (maxLevel - level)
  return { w: Math.max(1, Math.ceil(fullW / factor)), h: Math.max(1, Math.ceil(fullH / factor)) }
}

// Picks the SMALLEST level that's still at least as big as MAX_CACHED_DIM
// in some dimension (falling back to the largest level of all if even that
// one is smaller — a sheet whose full pyramid never reaches the cap), not
// the largest level that fits UNDER it. Pyramid levels only come in
// power-of-2 steps, so "fits under" can land well below the target (e.g.
// ~1300px instead of 2048px on a large sheet) and looks noticeably blurrier
// than necessary — stitching a level that's a bit larger than the target
// and downscaling it precisely afterward stays sharp, the same as scaling
// any other image down.
async function stitchTilesToImage(tileMeta) {
  const { baseUrl, width, height, tileSize, minLevel, maxLevel, format } = tileMeta
  let level = maxLevel
  let dims = levelDims(width, height, maxLevel, maxLevel)
  for (let l = minLevel; l <= maxLevel; l++) {
    const d = levelDims(width, height, maxLevel, l)
    level = l; dims = d
    if (d.w >= MAX_CACHED_DIM || d.h >= MAX_CACHED_DIM) break
  }

  const stitched = document.createElement('canvas')
  stitched.width = dims.w; stitched.height = dims.h
  const sctx = stitched.getContext('2d')

  const cols = Math.ceil(dims.w / tileSize)
  const rows = Math.ceil(dims.h / tileSize)
  const jobs = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      jobs.push((async () => {
        try {
          const img = await loadImage(`${baseUrl}/${level}/${col}_${row}.${format}`)
          sctx.drawImage(img, col * tileSize, row * tileSize)
        } catch (e) {
          console.warn('[offlineCache] Tile failed, leaving blank:', level, col, row, e)
        }
      })())
    }
  }
  await Promise.all(jobs)

  // The chosen level can come in larger than the cap (that's the point —
  // see above) — downscale to it exactly, sharper than either an
  // undersized level or upscaling one.
  if (dims.w <= MAX_CACHED_DIM && dims.h <= MAX_CACHED_DIM) {
    return new Promise(resolve => stitched.toBlob(resolve, 'image/png'))
  }
  const scale = MAX_CACHED_DIM / Math.max(dims.w, dims.h)
  const final = document.createElement('canvas')
  final.width = Math.round(dims.w * scale); final.height = Math.round(dims.h * scale)
  const fctx = final.getContext('2d')
  fctx.imageSmoothingEnabled = true
  fctx.imageSmoothingQuality = 'high'
  fctx.drawImage(stitched, 0, 0, final.width, final.height)
  return new Promise(resolve => final.toBlob(resolve, 'image/png'))
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
  let sourceBlob = null
  let sourceIsPdf = false

  if (pg.tile_meta) {
    // Preferred path: reuse the pyramid already rendered once at upload
    // time instead of re-rendering the source file on this device — see
    // the file header for why. Only reads small tile images, no pdf.js
    // involved at all.
    try {
      sourceBlob = await stitchTilesToImage(pg.tile_meta)
    } catch (e) {
      console.warn('[offlineCache] Failed to stitch tiles, falling back to source file:', e)
    }
  }

  if (!sourceBlob) {
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

    if (isPdf && sourceUrl) {
      try {
        sourceBlob = await renderPdfToPngBlob(sourceUrl)
      } catch (e) {
        // Falls back to caching the raw PDF bytes — initFromCache will
        // still try pdf.js at view time offline, which at worst behaves
        // exactly like before this fix (no better, but no worse either).
        console.warn('[offlineCache] Failed to pre-render PDF for offline use, caching raw file instead:', e)
        sourceBlob = rawBlob
        sourceIsPdf = true
      }
    } else {
      sourceBlob = rawBlob
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
