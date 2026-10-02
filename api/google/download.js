// Streams a picked Drive file straight through to the browser. Unlike
// Autodesk's download.js, which hands back a pre-signed S3 URL the
// browser fetches directly (no auth needed on that URL), Google Drive's
// `alt=media` download requires the OAuth bearer on every single request
// — there's no signed-URL equivalent for a private file without changing
// its sharing settings — so the token has to be used here, server-side,
// and the bytes proxied through this function instead.
//
// Streamed rather than buffered into one response, but Vercel serverless
// functions still cap total response size (~4.5MB) regardless — the same
// constraint api/autodesk/download.js sidesteps via a signed URL. A Drive
// file larger than that will still fail to import; if that turns out to
// matter in practice, revisit this as a streaming Edge Function instead.
import { getSupabaseUser, getValidGoogleToken } from './_lib.js'

const NATIVE_PREFIX = 'application/vnd.google-apps.'
// Google Docs/Sheets/Slides/Drawings aren't real files — they have to be
// exported to a concrete format first. PDF covers every case this app
// cares about (floor plans, scanned sheets); anything else native (Forms,
// Sites, …) just isn't something you'd be importing as a floor plan.
const EXPORT_MIME_FOR = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
}

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { fileId } = req.query
  if (!fileId) { res.status(400).json({ error: 'fileId is required.' }); return }

  const googleToken = await getValidGoogleToken(user.id)
  if (!googleToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Google account first.' }); return }

  try {
    // supportsAllDrives is required on every call here, not just listing —
    // a file picked from inside a Shared Drive 404s on both the metadata
    // lookup and the download itself without it.
    const metaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    )
    const meta = await metaResp.json()
    if (!metaResp.ok) { res.status(metaResp.status).json(meta); return }

    const isNative = meta.mimeType?.startsWith(NATIVE_PREFIX)
    const exportMime = EXPORT_MIME_FOR[meta.mimeType]
    if (isNative && !exportMime) {
      res.status(422).json({
        error: 'unsupported_type',
        message: `"${meta.name}" is a Google ${meta.mimeType.replace(NATIVE_PREFIX, '')} file, which can't be exported as a PDF automatically.`,
      })
      return
    }

    const downloadUrl = isNative
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`

    const fileResp = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${googleToken}` } })
    if (!fileResp.ok) {
      const errBody = await fileResp.json().catch(() => ({}))
      console.error('[google/download] fetch failed:', errBody)
      res.status(fileResp.status).json({ error: 'download_failed', message: 'Could not download the file from Google Drive.', debug: errBody })
      return
    }

    const fileName = isNative ? `${meta.name}.pdf` : meta.name
    res.setHeader('Content-Type', fileResp.headers.get('content-type') || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`)

    const reader = fileResp.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    console.error('[google/download] failed:', err)
    if (!res.headersSent) res.status(502).json({ error: 'Failed to reach Google Drive.' })
    else res.end()
  }
}
