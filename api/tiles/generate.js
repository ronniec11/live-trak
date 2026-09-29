// Server-side fallback for deep-zoom tile generation. Client-side tiling
// (src/lib/tileGenerator.js, pdf.js in the browser) stays the default —
// this only runs when that path already failed. See
// supabase-migration-server-tiling.sql for the full rationale: pdf.js is a
// browser-embedded VIEWER, not a hardened production rasterizer, and a real
// customer's sheet was confirmed to hang indefinitely on invisible
// leftover CAD-export content, independent of how the render was chunked.
//
// Uses mupdf (Artifex's C/WASM PDF library — the same engine family behind
// Ghostscript, not pdf.js) to rasterize the WHOLE page in one call, then
// sharp (already used elsewhere in this repo — scripts/generate-icons.js)
// to build the lower pyramid levels and slice every level into TILE_SIZE
// tiles. No manual chunking of the render itself is needed here the way
// tileGenerator.js needs client-side: this runs on a real server with real
// memory, not a browser tab.
import * as mupdf from 'mupdf'
import sharp from 'sharp'
import { adminClient, getSupabaseUser, loadPageForCaller } from './_lib.js'

// Vercel Serverless Function config. A dense sheet's render can genuinely
// take minutes — maxDuration needs a paid Vercel plan to actually take
// effect beyond Hobby's ~60s ceiling (see the cost conversation this was
// built from). memory is set high since a full-resolution pixmap for a
// large sheet is easily a few hundred MB in RAM.
export const config = {
  maxDuration: 300,
  memory: 3009,
}

// Must produce comparable resolution to src/lib/tileGenerator.js's own
// TILE_BASE_SCALE/TILE_SIZE — the two paths don't need to interoperate
// (each produces its own complete, self-consistent tile_meta), but a
// customer shouldn't see a quality difference depending on which path
// happened to generate their tiles.
const TILE_BASE_SCALE = 4.0
const TILE_SIZE = 256
const TILES_BUCKET = 'floor-plan-tiles'
const FLOOR_PLANS_BUCKET = 'floor-plans'
const PUBLIC_URL_PREFIX = /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/floor-plans\//

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

// Bounded-concurrency runner — same shape as tileGenerator.js's runPool,
// just without the progress callback (this route reports status via
// pages.tile_status, not a live progress stream).
async function runPool(tasks, concurrency) {
  let next = 0
  const errors = []
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      try { await tasks[i]() } catch (e) { errors.push(e) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return errors
}

async function sliceAndUploadLevel(admin, buffer, level, w, h, pathPrefix) {
  const jobs = []
  const cols = Math.ceil(w / TILE_SIZE)
  const rows = Math.ceil(h / TILE_SIZE)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const left = col * TILE_SIZE, top = row * TILE_SIZE
      const tw = Math.min(TILE_SIZE, w - left), th = Math.min(TILE_SIZE, h - top)
      jobs.push(async () => {
        const tileBuf = await sharp(buffer).extract({ left, top, width: tw, height: th }).png().toBuffer()
        const path = `${pathPrefix}/${level}/${col}_${row}.png`
        const { error } = await admin.storage.from(TILES_BUCKET).upload(path, tileBuf, { upsert: true, contentType: 'image/png' })
        if (error) throw error
      })
    }
  }
  const errors = await runPool(jobs, 8)
  if (errors.length === jobs.length) throw errors[0]
  if (errors.length) console.warn('[tiles/generate]', errors.length, '/', jobs.length, `tile(s) failed to upload at level ${level}`)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { pageId } = req.body || {}
  if (!pageId) { res.status(400).json({ error: 'Missing pageId.' }); return }

  const admin = adminClient()
  const { page, projectId, error: loadErr } = await loadPageForCaller(admin, pageId, user.id)
  if (loadErr) { res.status(403).json({ error: loadErr }); return }

  const rawPath = page.floor_plan_url || ''
  const isPdf = /\.pdf($|\?)/i.test(rawPath)
  if (!isPdf) { res.status(400).json({ error: 'Server-side tiling only handles PDF floor plans.' }); return }
  const storagePath = rawPath.replace(PUBLIC_URL_PREFIX, '')

  await admin.from('pages').update({ tile_status: 'processing', tile_error: null }).eq('id', pageId)

  try {
    const { data: fileBlob, error: dlErr } = await admin.storage.from(FLOOR_PLANS_BUCKET).download(storagePath)
    if (dlErr || !fileBlob) throw new Error(dlErr?.message || 'Could not download the source PDF from storage.')
    const pdfBytes = Buffer.from(await fileBlob.arrayBuffer())

    const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf')
    if (doc.countPages() < 1) throw new Error('PDF has no pages.')
    const mupdfPage = doc.loadPage(0)
    const bounds = mupdfPage.getBounds() // [x0, y0, x1, y1] in PDF points
    const fullW = Math.round((bounds[2] - bounds[0]) * TILE_BASE_SCALE)
    const fullH = Math.round((bounds[3] - bounds[1]) * TILE_BASE_SCALE)
    const { maxLevel, minLevel } = pyramidLevels(fullW, fullH)
    console.log('[tiles/generate] page', pageId, 'size at TILE_BASE_SCALE:', fullW, 'x', fullH, 'levels:', minLevel, '-', maxLevel)

    const pixmap = mupdfPage.toPixmap(mupdf.Matrix.scale(TILE_BASE_SCALE, TILE_BASE_SCALE), mupdf.ColorSpace.DeviceRGB, false, true)
    const topBuffer = Buffer.from(pixmap.asPNG())

    const pathPrefix = `${projectId}/tiles/${pageId}`
    const levelBuffers = { [maxLevel]: topBuffer }
    for (let level = maxLevel - 1; level >= minLevel; level--) {
      const { w, h } = levelDims(fullW, fullH, maxLevel, level)
      levelBuffers[level] = await sharp(levelBuffers[level + 1]).resize(w, h).png().toBuffer()
    }

    for (let level = minLevel; level <= maxLevel; level++) {
      const { w, h } = levelDims(fullW, fullH, maxLevel, level)
      await sliceAndUploadLevel(admin, levelBuffers[level], level, w, h, pathPrefix)
    }

    const { data: urlData } = admin.storage.from(TILES_BUCKET).getPublicUrl(pathPrefix)
    const tile_meta = { baseUrl: urlData.publicUrl, width: fullW, height: fullH, tileSize: TILE_SIZE, minLevel, maxLevel, format: 'png' }

    const { error: updateErr } = await admin.from('pages').update({ tile_meta, tile_status: 'complete', tile_error: null }).eq('id', pageId)
    if (updateErr) throw updateErr

    res.status(200).json({ tile_meta })
  } catch (err) {
    console.error('[tiles/generate] failed for page', pageId, ':', err)
    await admin.from('pages').update({ tile_status: 'failed', tile_error: err.message || 'Unknown error' }).eq('id', pageId)
    res.status(500).json({ error: err.message || 'Server-side tile generation failed.' })
  }
}
