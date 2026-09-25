// Full offline mode: downloads everything a project needs (floor plans +
// existing markup/session data) onto the device while there's a
// connection, so Projects/ProjectDetail/Canvas can all fall back to this
// local copy when a fetch fails — not just queue new writes (see
// offlineSync.js), but actually open and view something with zero
// connectivity from a cold start.
//
// A tiled page already has a pyramid rendered ONCE, at upload time (see
// tileGenerator.js) — not on whichever device happens to be viewing it.
// Downloading that whole pyramid (downloadTilePyramid) and feeding it back
// to OpenSeadragon offline (buildOfflineTileSource, used from Canvas.jsx's
// initFromCache) reuses that existing render and gets the exact same
// zoom-dependent sharpness online viewing has — the same "render once,
// every device just downloads the result" model Autodesk/Procore use.
// Critically, this doesn't reopen the memory-crash risk a flat capped image
// was originally chosen to avoid: OSD manages its own tile memory
// independently of the overlay canvases (only ever holding the
// currently-visible tiles, discarding the rest), so the overlay canvases —
// where that risk actually lives (every session's full-size hl+pen
// canvas) — stay capped exactly as they already are online, regardless of
// how much tile data sits in IndexedDB. It also means no pdf.js dependency
// at all for these pages, sidestepping a confirmed iOS Safari issue: pdf.js
// needs to load its worker script as a module, and Safari's module-worker
// loading doesn't reliably use the HTTP cache with zero connectivity even
// when that exact script was fetched moments earlier ("setting up fake
// worker failed: importing a module script failed" on-device, even after
// pre-warming it during download).
//
// If downloading the whole pyramid fails partway (e.g. connection drops
// mid-download), this falls back to stitching one flat capped image from
// whatever pyramid level fits (stitchTilesToImage) — worse fidelity at high
// zoom, but still viewable offline rather than nothing. A page with no
// pyramid at all (never tiled) falls back further still to rendering its
// PDF directly — but that only ever runs here, during download, while
// there's definitely a connection; a non-PDF (raster) source is cached
// as-is.
import { supabase } from './supabase'
import { dbPut, dbGet, dbGetAll, dbPutMany, dbGetAllByIndex, dbDeleteAllByIndex, requestPersistentStorage } from './offlineDb'
import { resolveStorageUrl } from './storageUrls'

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

// Downloads every tile across every level of a page's pyramid into
// IndexedDB, keyed by pageId, with bounded concurrency (small tiles, but a
// large sheet's full pyramid can run into the thousands — fetching them all
// at once would be excessive). A handful of individual tile failures don't
// fail the whole download; buildOfflineTileSource below just has a gap at
// that spot, same trade-off stitchTilesToImage already makes.
async function downloadTilePyramid(pg, onProgress) {
  const { baseUrl, width, height, tileSize, minLevel, maxLevel, format } = pg.tile_meta

  // Clear anything previously cached for this page first — re-downloading
  // (e.g. after adding new markup) shouldn't leave stale tiles from an
  // older pyramid mixed in with a newer one.
  await dbDeleteAllByIndex('cachedTiles', 'pageId', pg.id)

  const jobs = []
  for (let level = minLevel; level <= maxLevel; level++) {
    const { w, h } = levelDims(width, height, maxLevel, level)
    const cols = Math.ceil(w / tileSize)
    const rows = Math.ceil(h / tileSize)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) jobs.push({ level, col, row })
    }
  }

  const CONCURRENCY = 8
  const records = []
  let nextIdx = 0, done = 0
  async function worker() {
    while (nextIdx < jobs.length) {
      const { level, col, row } = jobs[nextIdx++]
      try {
        const blob = await fetchAsBlob(`${baseUrl}/${level}/${col}_${row}.${format}`)
        records.push({ id: `${pg.id}/${level}/${col}_${row}`, pageId: pg.id, blob })
      } catch (e) {
        console.warn('[offlineCache] Tile download failed, skipping:', level, col, row, e)
      }
      done++
      if (done % 25 === 0 || done === jobs.length) {
        onProgress?.(`${pg.name} — tiles ${done}/${jobs.length}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))

  // Require most tiles to have actually made it — a handful of gaps is
  // fine, but if the connection genuinely died partway through, treat this
  // as a failure so cachePage falls back to a flat stitched image instead
  // of caching a mostly-empty pyramid.
  if (records.length < jobs.length * 0.9) {
    throw new Error(`Only ${records.length}/${jobs.length} tiles downloaded`)
  }
  await dbPutMany('cachedTiles', records)
}

// Builds an OpenSeadragon-compatible tile source backed by already-cached
// blobs (see downloadTilePyramid) instead of network requests — passed to
// Canvas.jsx's setupOsdViewer exactly like buildTileSource() is for the
// online path (in tileGenerator.js), so OSD itself has no idea these aren't
// coming from the network. Every blob: URL is created up front (cheap — it
// doesn't decode anything) since OSD's getTileUrl must return synchronously,
// not look one up asynchronously.
export function buildOfflineTileSource(tileMeta, tileRecords) {
  const urlMap = new Map()
  for (const rec of tileRecords) {
    // id shape is `${pageId}/${level}/${col}_${row}` — drop the pageId
    // prefix, every record passed in here is already scoped to one page.
    const key = rec.id.split('/').slice(1).join('/')
    urlMap.set(key, URL.createObjectURL(rec.blob))
  }
  return {
    width: tileMeta.width, height: tileMeta.height, tileSize: tileMeta.tileSize,
    minLevel: tileMeta.minLevel, maxLevel: tileMeta.maxLevel,
    getTileUrl(level, x, y) {
      return urlMap.get(`${level}/${x}_${y}`) || null
    },
    // Not an OSD field — Canvas.jsx's teardownOsdViewer calls this so the
    // blob: URLs created above don't outlive the page view (they're cheap
    // individually, but a heavily-tiled sheet can create thousands of them).
    revoke() {
      for (const url of urlMap.values()) URL.revokeObjectURL(url)
    },
  }
}

export async function getCachedTilesForPage(pageId) {
  return dbGetAllByIndex('cachedTiles', 'pageId', pageId)
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
  let cachedTileMeta = null

  if (pg.tile_meta) {
    // Preferred path (see file header): the whole pyramid, giving offline
    // viewing the same zoom-dependent sharpness as online.
    try {
      await downloadTilePyramid(pg, onProgress)
      cachedTileMeta = pg.tile_meta
    } catch (e) {
      console.warn('[offlineCache] Failed to download tile pyramid, falling back to a flat stitched image:', e)
      try {
        sourceBlob = await stitchTilesToImage(pg.tile_meta)
      } catch (e2) {
        console.warn('[offlineCache] Failed to stitch tiles either, falling back to source file:', e2)
      }
    }
  }

  if (!cachedTileMeta && !sourceBlob) {
    const sourceUrl = pg.floor_plan_url ? await resolveStorageUrl(pg.floor_plan_url) : null
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
    try { if (dbSess.highlight_data) hlBlob = await fetchAsBlob(await resolveStorageUrl(dbSess.highlight_data)) } catch (e) { console.warn('[offlineCache] hl fetch failed:', e) }
    try { if (dbSess.pen_data) penBlob = await fetchAsBlob(await resolveStorageUrl(dbSess.pen_data)) } catch (e) { console.warn('[offlineCache] pen fetch failed:', e) }
    // Completion photos, cached as real bytes rather than stored paths —
    // a signed URL captured now would just expire before this cache is
    // ever opened offline. initFromCache turns each blob back into a
    // (session-lifetime) blob: URL, which resolveStorageUrl passes through
    // as already-usable.
    const photoBlobs = []
    for (const storedPath of (dbSess.photos || [])) {
      try {
        const signed = await resolveStorageUrl(storedPath)
        if (signed) photoBlobs.push(await fetchAsBlob(signed))
      } catch (e) { console.warn('[offlineCache] photo fetch failed:', e) }
    }
    sessions.push({
      id: dbSess.id, name: dbSess.name, color: dbSess.color,
      sf: dbSess.sf, lf: dbSess.lf, work_date: dbSess.work_date, created_at: dbSess.created_at,
      crew_size: dbSess.crew_size, hours_worked: dbSess.hours_worked,
      count_data: dbSess.count_data, lf_data: dbSess.lf_data, text_data: dbSess.text_data, photoBlobs,
      profiles: dbSess.profiles, hlBlob, penBlob,
    })
  }

  await dbPut('cachedPages', {
    id: pg.id, projectId, name: pg.name, scale: pg.scale, ppi: pg.ppi,
    pixels_per_foot: pg.pixels_per_foot, calibrated: pg.calibrated,
    tileMeta: cachedTileMeta, sourceBlob, sourceIsPdf, sessions, cachedAt: Date.now(),
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
    // jobId ties this scope back to its parent job (see downloadJobForOffline)
    // so the job dashboard and the Projects list can rebuild themselves from
    // cached scopes alone with no network at all.
    jobId: project.job_id, sort_order: project.sort_order,
    name: project.name, description: project.description, status: project.status, uom: project.uom,
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

// Re-caches one page after offline-queued edits for it have synced —
// offlineSync.js's syncPendingOps() only pushes those edits to Supabase,
// it never touches this page's own offline snapshot, so without this the
// next time the device goes offline it would show the pre-sync version
// again: edits sync and look right online, but reappear reverted the next
// time offline, needing a full manual re-download to actually fix. Only
// refreshes a page that was already downloaded — one nobody downloaded has
// no snapshot to go stale in the first place.
export async function refreshCachedPageIfDownloaded(pageId, onProgress) {
  const existing = await getCachedPage(pageId)
  if (!existing) return false
  const { data: pg, error } = await supabase.from('pages').select('*').eq('id', pageId).single()
  if (error || !pg) {
    console.warn('[offlineCache] Could not refresh cached page after sync:', pageId, error)
    return false
  }
  await cachePage(pg, existing.projectId, onProgress)
  return true
}

export async function listCachedProjects() {
  return dbGetAll('cachedProjects')
}

export async function isProjectCached(projectId) {
  return !!(await getCachedProject(projectId))
}

// Job-level download: caches the job's own row plus every one of its
// scopes (each via downloadProjectForOffline above, which is what tags the
// resulting cachedProjects record with this jobId). ProjectDetail.jsx (the
// job dashboard) and Projects.jsx (the job list) previously had no offline
// fallback at all — only a scope's own dashboard (ScopeDetail.jsx) did —
// so downloading a job from the Projects page would let you view a scope
// offline but not the job dashboard you'd tap into it from, or the
// Projects list itself.
export async function downloadJobForOffline(jobId, onProgress) {
  await requestPersistentStorage()

  const { data: job, error: jobErr } = await supabase
    .from('jobs').select('*').eq('id', jobId).single()
  if (jobErr) throw jobErr

  const { data: scopes, error: scopesErr } = await supabase
    .from('projects').select('*').eq('job_id', jobId)
  if (scopesErr) throw scopesErr

  for (const scope of (scopes || [])) {
    await downloadProjectForOffline(scope.id, text => onProgress?.(`${scope.name}: ${text}`))
  }

  await dbPut('cachedJobs', {
    id: jobId,
    name: job.name, status: job.status, gc_name: job.gc_name,
    owner_name: job.owner_name, address: job.address,
    scopeIds: (scopes || []).map(s => s.id),
    cachedAt: Date.now(),
  })
}

export async function getCachedJob(jobId) {
  return dbGet('cachedJobs', jobId)
}

export async function listCachedJobs() {
  return dbGetAll('cachedJobs')
}

export async function isJobCached(jobId) {
  return !!(await getCachedJob(jobId))
}

// Same shape-handling as Reports.jsx/ProjectDetail.jsx's countItemsFor —
// count_data is a bare array of markers on older sessions, or
// {markers, w, h} on newer ones.
function countItemsFor(countData) {
  if (Array.isArray(countData)) return countData.length
  return countData?.markers?.length ?? 0
}

// Rebuilds what ProjectDetail.jsx's loadJobDetail() computes from Supabase
// (per-scope SF totals, today's activity, recent sessions), but from the
// local cache — used when that fetch fails with no connection. Every
// cached scope's own pages (see cachePage) already carry their sessions,
// so nothing extra needs to be cached just for this.
export async function getCachedJobDetail(jobId) {
  const job = await getCachedJob(jobId)
  if (!job) return null

  const scopes = (await listCachedProjects())
    .filter(s => s.jobId === jobId)
    .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity))
  const today = new Date().toLocaleDateString('en-CA')

  const sfTodayByScope = {}
  const sfTotalByScope = {}
  const todaySessions = []
  const recentSessions = []

  for (const scope of scopes) {
    const uom = scope.uom || 'SF'
    for (const pg of (scope.pages || [])) {
      const cachedPage = await getCachedPage(pg.id)
      for (const s of (cachedPage?.sessions || [])) {
        const value = uom === 'LF' ? (parseFloat(s.lf) || 0)
          : uom === 'Count' ? countItemsFor(s.count_data)
          : (parseFloat(s.sf) || 0)
        sfTotalByScope[scope.id] = (sfTotalByScope[scope.id] || 0) + value
        const withNames = { ...s, scopeName: scope.name, pageName: pg.name }
        recentSessions.push(withNames)
        if (s.work_date === today) {
          sfTodayByScope[scope.id] = (sfTodayByScope[scope.id] || 0) + value
          todaySessions.push(withNames)
        }
      }
    }
  }
  recentSessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

  return {
    job,
    scopes: scopes.map(s => ({
      id: s.id, name: s.name, description: s.description, status: s.status, uom: s.uom,
      daily_sf_target: s.daily_sf_target, total_sf_target: s.total_sf_target,
    })),
    sfTodayByScope, sfTotalByScope,
    todaySessions, recentSessions: recentSessions.slice(0, 15),
  }
}

// Same idea for the Projects list page — rebuilds each job card's active-
// scope count and overall progress from cached scopes instead of Supabase.
// Matches loadProjects()'s own (uom-blind) overallPctByJob math: it sums
// raw sf across every session regardless of a scope's uom.
export async function getCachedJobsList() {
  const jobs = await listCachedJobs()
  const allScopes = await listCachedProjects()

  const activeScopesByJob = {}
  const overallPctByJob = {}
  const scopeIdsByJob = {}

  for (const job of jobs) {
    const scopes = allScopes.filter(s => s.jobId === job.id)
    scopeIdsByJob[job.id] = scopes.map(s => s.id)
    activeScopesByJob[job.id] = scopes.filter(s => s.status === 'active').length

    let totalSF = 0
    let targetSF = 0
    for (const scope of scopes) {
      targetSF += parseFloat(scope.total_sf_target) || 0
      for (const pg of (scope.pages || [])) {
        const cachedPage = await getCachedPage(pg.id)
        for (const s of (cachedPage?.sessions || [])) totalSF += parseFloat(s.sf) || 0
      }
    }
    overallPctByJob[job.id] = targetSF > 0 ? Math.min(100, Math.round((totalSF / targetSF) * 100)) : null
  }

  return { jobs, activeScopesByJob, overallPctByJob, scopeIdsByJob }
}
