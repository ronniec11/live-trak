import { supabase } from './supabase'

// Its own bucket, separate from floor-plans (which went private in
// supabase-migration-org-scoping-stage4-storage.sql) — tiles are small,
// low-sensitivity chunks of an already-uploaded floor plan at unguessable
// UUID-based paths, and OpenSeadragon's tile loader builds hundreds of
// these URLs synchronously per pan/zoom, which a signed-URL scheme can't
// practically support. Kept public on purpose; the actual source files,
// paint layers, and photos are what needed locking down.
const BUCKET = 'floor-plan-tiles'
const TILE_SIZE = 256
// Default largest single render/decode allowed per canvas — same ceiling
// used elsewhere in the app for iPad memory safety (Canvas.jsx MAX_DIM).
// generatePdfTiles accepts a bigger chunkSize override for desktop callers
// (see its own comment) — this default stays put as the safe floor for
// anything still running on an iPad.
const CHUNK = 2048
// Cross-browser-safe ceiling for a single canvas axis. generatePdfTiles
// assembles one canvas at the full maxLevel resolution (see its comment) —
// this guards against ever trying to allocate something bigger than any
// real browser will actually give a canvas, rather than silently failing.
const MAX_CANVAS_DIM = 16384
// Generous — a chunk render on a genuinely dense real-world drawing has
// been observed taking minutes on its own (see generatePdfTiles' comment);
// this just needs to not give up before a slow-but-working render finishes.
const RENDER_TIMEOUT_MS = 600000
// Base render quality for the sharpest (max) pyramid level — matches the
// desktop RENDER_SCALE used elsewhere in the app (Canvas.jsx) so tiles look
// as sharp as today's desktop floor plan rendering.
export const TILE_BASE_SCALE = 4.0

function levelDims(fullW, fullH, maxLevel, level) {
  const factor = 2 ** (maxLevel - level)
  return { w: Math.max(1, Math.ceil(fullW / factor)), h: Math.max(1, Math.ceil(fullH / factor)) }
}

function pyramidLevels(fullW, fullH) {
  const maxLevel = Math.ceil(Math.log2(Math.max(fullW, fullH)))
  let minLevel = maxLevel
  while (minLevel > 0) {
    const { w, h } = levelDims(fullW, fullH, maxLevel, minLevel)
    if (w <= TILE_SIZE && h <= TILE_SIZE) break
    minLevel -= 1
  }
  return { maxLevel, minLevel }
}

// Races `promise` against a timeout so a hung fetch/render can never stall
// generation forever — throws instead, so it surfaces as a visible error.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ])
}

// Runs `tasks` (array of functions returning promises) with bounded
// parallelism. A single failed task (a render timeout, a flaky upload) no
// longer aborts every other task queued behind it — it's logged and
// skipped instead, returned in `errors` for the caller to decide what a
// failure count actually means (a handful of missing tiles at one zoom
// level is a minor, OSD-tolerated gap; every task failing is a real,
// nothing-usable-produced failure). This one queue previously being
// all-or-nothing is exactly what turned one unusually slow chunk (an
// especially complex source PDF — see generatePdfTiles) into a fully
// wasted run with zero usable tiles, instead of a mostly-complete pyramid
// with one thin zoom level.
async function runPool(tasks, concurrency, onEach) {
  let next = 0
  let completed = 0
  const errors = []
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      try {
        await tasks[i]()
      } catch (e) {
        console.warn('[tileGenerator] Task failed, skipping:', e)
        errors.push(e)
      }
      completed++
      onEach?.(completed, tasks.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return errors
}

async function uploadTile(pathPrefix, level, col, row, blob, format) {
  const path = `${pathPrefix}/${level}/${col}_${row}.${format}`
  const { error } = await withTimeout(
    supabase.storage.from(BUCKET).upload(path, blob, {
      upsert: true,
      contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    }),
    20000,
    `Upload of ${path}`,
  )
  if (error) throw error
}

function canvasToBlob(canvas, format, quality) {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob returned null')), mime, quality)
  })
}

// Slices `srcCanvas` (a rendered chunk/level, positioned at (chunkX,chunkY)
// within the full level) into TILE_SIZE output tiles and queues an
// upload job for each — shared by both the PDF chunk renderer and the
// raster level slicer below, since once a source canvas exists in memory
// this step is identical for both.
function queueTileSlices(jobs, srcCanvas, chunkX, chunkY, levelW, levelH, pathPrefix, level, format, quality) {
  // chunkX/chunkY are always exact multiples of TILE_SIZE at both call sites
  // (CHUNK is a multiple of TILE_SIZE for the PDF path; 0 for the raster path).
  const firstCol = Math.floor(chunkX / TILE_SIZE)
  const firstRow = Math.floor(chunkY / TILE_SIZE)
  const lastCol = Math.floor((Math.min(chunkX + srcCanvas.width, levelW) - 1) / TILE_SIZE)
  const lastRow = Math.floor((Math.min(chunkY + srcCanvas.height, levelH) - 1) / TILE_SIZE)
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const tileX = col * TILE_SIZE, tileY = row * TILE_SIZE
      const tw = Math.min(TILE_SIZE, levelW - tileX)
      const th = Math.min(TILE_SIZE, levelH - tileY)
      const sx = tileX - chunkX, sy = tileY - chunkY
      jobs.push(async () => {
        const tileCanvas = document.createElement('canvas')
        tileCanvas.width = tw; tileCanvas.height = th
        tileCanvas.getContext('2d').drawImage(srcCanvas, sx, sy, tw, th, 0, 0, tw, th)
        const blob = await canvasToBlob(tileCanvas, format, quality)
        await uploadTile(pathPrefix, level, col, row, blob, format)
      })
    }
  }
}

/**
 * Generates a tile pyramid from a PDF's first page.
 *
 * Renders the page only ONCE per region, at the sharpest (max) pyramid
 * level, in chunkSize-sized pieces (memory-bounded — never allocates a
 * canvas bigger than chunkSize×chunkSize). Every LOWER zoom level is then
 * derived by cheap canvas downsampling from that single assembled image
 * (the same technique generateRasterTiles already uses for plain image
 * uploads) instead of calling pdf.js's page.render() again at every level.
 *
 * That matters because each render() call replays the page's FULL vector
 * operator list — every line, fill, and hatch — regardless of how small the
 * output canvas is. For an ordinary sheet that's cheap enough not to notice.
 * For a genuinely dense real-world drawing, that per-call cost dominates:
 * confirmed in practice taking several minutes even for a tiny, low-res
 * pyramid level, so the old one-render-call-per-(level,chunk) approach
 * added up to hours across a 7-8 level pyramid. Rendering the PDF only at
 * its top level and downsampling the rest cuts that to just the top
 * level's chunks — same final sharpness (maxLevel is untouched), a
 * fraction of the render() calls.
 */
export async function generatePdfTiles(pdfUrl, { projectId, pageId, format = 'png', onProgress, chunkSize = CHUNK } = {}) {
  console.log('[tileGenerator] Starting PDF tile generation:', pdfUrl)
  const pdfjsLib = await import('pdfjs-dist')
  const { default: pdfWorkerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

  const pdfDoc = await pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false }).promise
  const page = await pdfDoc.getPage(1)
  const baseViewport = page.getViewport({ scale: TILE_BASE_SCALE })
  const fullW = Math.round(baseViewport.width)
  const fullH = Math.round(baseViewport.height)
  const { maxLevel, minLevel } = pyramidLevels(fullW, fullH)
  const pathPrefix = `${projectId}/tiles/${pageId}`
  console.log('[tileGenerator] PDF page size at TILE_BASE_SCALE:', fullW, 'x', fullH, 'levels:', minLevel, '-', maxLevel)

  if (fullW > MAX_CANVAS_DIM || fullH > MAX_CANVAS_DIM) {
    throw new Error(`This sheet renders too large to tile at full quality (${fullW}x${fullH}px at ${TILE_BASE_SCALE}x scale) — it exceeds what a browser canvas can hold in one piece.`)
  }

  // Assembled once at maxLevel resolution, then reused as the source for
  // every lower level below (see levelCanvases). Sized to the full page
  // (not chunkSize) — chunking below only bounds each individual render()
  // call/canvas, not this accumulator.
  const maxLevelCanvas = document.createElement('canvas')
  maxLevelCanvas.width = fullW
  maxLevelCanvas.height = fullH
  const maxLevelCtx = maxLevelCanvas.getContext('2d')

  const chunkCols = Math.ceil(fullW / chunkSize)
  const chunkRows = Math.ceil(fullH / chunkSize)
  const renderJobs = []
  let chunkCount = 0
  for (let cr = 0; cr < chunkRows; cr++) {
    for (let cc = 0; cc < chunkCols; cc++) {
      const chunkX = cc * chunkSize, chunkY = cr * chunkSize
      const cw = Math.min(chunkSize, fullW - chunkX)
      const ch = Math.min(chunkSize, fullH - chunkY)
      const chunkIndex = chunkCount
      chunkCount++
      renderJobs.push(async () => {
        const t0 = performance.now()
        if (chunkIndex === 0) console.log('[tileGenerator] Rendering chunk 0 — first render on this page, can take a while to parse a dense drawing...')
        const chunkCanvas = document.createElement('canvas')
        chunkCanvas.width = cw; chunkCanvas.height = ch
        // 30s wasn't enough for a genuinely complex real-world drawing's
        // first render, then 120s wasn't either (confirmed hitting the wall
        // repeatedly on this same large/detailed PDF) — RENDER_TIMEOUT_MS
        // gives real headroom on slower hardware without letting a truly
        // hung render block generation forever.
        await withTimeout(
          page.render({
            canvasContext: chunkCanvas.getContext('2d'),
            viewport: baseViewport,
            transform: [1, 0, 0, 1, -chunkX, -chunkY],
          }).promise,
          RENDER_TIMEOUT_MS,
          `Render of chunk ${chunkIndex}`,
        )
        maxLevelCtx.drawImage(chunkCanvas, chunkX, chunkY)
        console.log('[tileGenerator] chunk', chunkIndex, '/', chunkCount, 'rendered in', Math.round(performance.now() - t0), 'ms')
      })
    }
  }
  console.log('[tileGenerator] Rendering', chunkCount, 'chunk(s) at full', fullW, 'x', fullH, 'resolution (chunkSize', chunkSize, ')')

  // Render and upload are wildly different costs per step (a chunk render on
  // a dense sheet can be the single slowest thing in this whole function;
  // a tile upload is fast and there can be thousands of them) — weighting
  // progress by raw step count would make finishing the one render that
  // actually matters look like it barely moved the bar. RENDER_WEIGHT
  // reserves most of the bar for the render phase regardless of how many
  // cheap upload steps come after it.
  const RENDER_WEIGHT = 80
  let done = 0

  // Sequential (concurrency 1) on purpose: pdf.js's shared operator-list
  // state across concurrent render() tasks on one page has been observed
  // hanging when two calls with different transforms race each other. One
  // render at a time removes that race entirely.
  const renderErrors = await runPool(renderJobs, 1, () => {
    done++
    console.log('[tileGenerator] Rendered chunk', done, '/', chunkCount)
    onProgress?.(Math.round((done / chunkCount) * RENDER_WEIGHT), 100)
  })
  // Every chunk failing means nothing usable got produced at all — a real
  // failure. A handful of chunks failing still leaves a mostly-complete
  // maxLevel (and so every level below it) with a few gaps; OSD falls back
  // to the nearest available level/tile rather than failing to display the
  // sheet at all.
  if (renderErrors.length === chunkCount) throw renderErrors[0]
  if (renderErrors.length) console.warn('[tileGenerator]', renderErrors.length, '/', chunkCount, 'chunk(s) failed to render — pyramid will have gaps in that region at every level.')

  // Build every lower pyramid level by halving the level above — sharper
  // than re-downsampling from the original each time (same technique as
  // generateRasterTiles), and never touches the PDF/pdf.js again.
  const levelCanvases = { [maxLevel]: maxLevelCanvas }
  for (let level = maxLevel - 1; level >= minLevel; level--) {
    const { w: lw, h: lh } = levelDims(fullW, fullH, maxLevel, level)
    const prev = levelCanvases[level + 1]
    const c = document.createElement('canvas')
    c.width = lw; c.height = lh
    c.getContext('2d').drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, lw, lh)
    levelCanvases[level] = c
  }

  const tileJobs = []
  for (let level = minLevel; level <= maxLevel; level++) {
    const src = levelCanvases[level]
    queueTileSlices(tileJobs, src, 0, 0, src.width, src.height, pathPrefix, level, format)
  }
  console.log('[tileGenerator] Slicing/uploading', tileJobs.length, 'tile(s) across', maxLevel - minLevel + 1, 'levels')

  let uploaded = 0
  const uploadErrors = await runPool(tileJobs, 6, () => {
    uploaded++
    onProgress?.(RENDER_WEIGHT + Math.round((uploaded / tileJobs.length) * (100 - RENDER_WEIGHT)), 100)
  })
  if (uploadErrors.length === tileJobs.length) throw uploadErrors[0]
  if (uploadErrors.length) console.warn('[tileGenerator]', uploadErrors.length, '/', tileJobs.length, 'tile(s) failed to upload — pyramid has some gaps but is otherwise usable.')

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathPrefix)
  console.log('[tileGenerator] PDF tiling complete:', data.publicUrl)
  return { baseUrl: data.publicUrl, width: fullW, height: fullH, tileSize: TILE_SIZE, minLevel, maxLevel, format }
}

/**
 * Generates a tile pyramid from a plain raster image (JPG/PNG upload).
 * A raster source has to be decoded once in full before any region can be
 * cropped from it — so this decodes it exactly once, bounded to the same
 * MAX_DIM-equivalent (CHUNK) cap already used for iPad viewing elsewhere in
 * the app, then progressively halves that single in-memory canvas to build
 * each lower pyramid level (sharper than re-downsampling from the original
 * each time) and slices tiles from each level.
 */
export async function generateRasterTiles(imageUrl, { projectId, pageId, format = 'jpeg', quality = 0.9, onProgress } = {}) {
  console.log('[tileGenerator] Starting raster tile generation:', imageUrl)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = imageUrl })

  const scale = Math.min(1, CHUNK / Math.max(img.width, img.height))
  const fullW = Math.round(img.width * scale)
  const fullH = Math.round(img.height * scale)
  let levelCanvas = document.createElement('canvas')
  levelCanvas.width = fullW; levelCanvas.height = fullH
  levelCanvas.getContext('2d').drawImage(img, 0, 0, fullW, fullH)

  const { maxLevel, minLevel } = pyramidLevels(fullW, fullH)
  const pathPrefix = `${projectId}/tiles/${pageId}`
  console.log('[tileGenerator] Raster image size (capped):', fullW, 'x', fullH, 'levels:', minLevel, '-', maxLevel)
  const levelCanvases = { [maxLevel]: levelCanvas }
  for (let level = maxLevel - 1; level >= minLevel; level--) {
    const { w: lw, h: lh } = levelDims(fullW, fullH, maxLevel, level)
    const prev = levelCanvases[level + 1]
    const c = document.createElement('canvas')
    c.width = lw; c.height = lh
    c.getContext('2d').drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, lw, lh)
    levelCanvases[level] = c
  }

  const jobs = []
  for (let level = minLevel; level <= maxLevel; level++) {
    const src = levelCanvases[level]
    queueTileSlices(jobs, src, 0, 0, src.width, src.height, pathPrefix, level, format, quality)
  }
  console.log('[tileGenerator] Slicing', jobs.length, 'tile(s)')

  let done = 0
  const errors = await runPool(jobs, 6, () => { done++; onProgress?.(done, jobs.length) })
  if (errors.length === jobs.length) throw errors[0]
  if (errors.length) console.warn('[tileGenerator]', errors.length, '/', jobs.length, 'tile(s) failed — pyramid has some gaps but is otherwise usable.')

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathPrefix)
  console.log('[tileGenerator] Raster tiling complete:', data.publicUrl)
  return { baseUrl: data.publicUrl, width: fullW, height: fullH, tileSize: TILE_SIZE, minLevel, maxLevel, format }
}

/** Builds an OpenSeadragon custom TileSource object from stored tile_meta. */
export function buildTileSource(tileMeta) {
  return {
    width: tileMeta.width,
    height: tileMeta.height,
    tileSize: tileMeta.tileSize,
    minLevel: tileMeta.minLevel,
    maxLevel: tileMeta.maxLevel,
    getTileUrl(level, x, y) {
      return `${tileMeta.baseUrl}/${level}/${x}_${y}.${tileMeta.format}`
    },
  }
}

/** Removes all generated tile files for a page (call before regenerating or on page delete). */
export async function deleteTiles(projectId, pageId) {
  const prefix = `${projectId}/tiles/${pageId}`
  const levelDirs = await supabase.storage.from(BUCKET).list(prefix)
  if (levelDirs.error || !levelDirs.data?.length) return
  for (const dir of levelDirs.data) {
    const files = await supabase.storage.from(BUCKET).list(`${prefix}/${dir.name}`)
    if (files.data?.length) {
      await supabase.storage.from(BUCKET).remove(files.data.map(f => `${prefix}/${dir.name}/${f.name}`))
    }
  }
}
