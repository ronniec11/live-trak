// Resolves a picked ACC Sheet to a downloadable PDF URL.
//
// The Sheets API has no single "give me the PDF" endpoint — sheets:batch-get
// returns richer per-sheet detail than the list endpoint, which (per
// Autodesk's docs) includes a reference back to the file version it was
// published from. That reference is then resolved through the exact same
// Data Management + OSS flow download.js already uses for a plain file —
// same signed-S3-URL approach, so the actual PDF bytes never pass through
// this server (Vercel's response-size cap), only a small JSON payload.
//
// The exact field name holding that reference on a sheet's detail hasn't
// been confirmed against a live account yet — this tries the field names
// Autodesk's own docs/schema reference, and falls back to handing back the
// raw sheet detail (`debug`) if none of them resolve, so this can be fixed
// from one real screenshot instead of guessing blind — same pattern that
// found and fixed the empty-hubs 403 and the wrong APS Client ID earlier
// in this same integration.
import { getSupabaseUser, getValidApsToken } from './_lib.js'

async function resolveStorageDownload(apsToken, res, storageUrn, displayName) {
  const rest = storageUrn.replace('urn:adsk.objects:os.object:', '')
  const slash = rest.indexOf('/')
  if (slash < 0) {
    res.status(422).json({ error: 'bad_storage_urn', message: 'Unexpected storage reference from Autodesk.', debug: storageUrn })
    return
  }
  const bucketKey = rest.slice(0, slash)
  const objectKey = rest.slice(slash + 1)
  const signResp = await fetch(
    `https://developer.api.autodesk.com/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3download`,
    { headers: { Authorization: `Bearer ${apsToken}` } }
  )
  const signed = await signResp.json()
  if (!signResp.ok || !signed.url) {
    console.error('[autodesk/sheet-download] signeds3download failed:', signed)
    res.status(signResp.status || 502).json({ error: 'sign_failed', message: 'Could not get a download link from Autodesk.' })
    return
  }
  res.status(200).json({ url: signed.url, name: displayName })
}

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { projectId, sheetId } = req.query
  if (!projectId || !sheetId) { res.status(400).json({ error: 'projectId and sheetId are required.' }); return }

  const apsToken = await getValidApsToken(user.id)
  if (!apsToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Autodesk account first.' }); return }

  const bareProjectId = projectId.replace(/^b\./, '')

  try {
    const detailResp = await fetch(
      `https://developer.api.autodesk.com/construction/sheets/v1/projects/${encodeURIComponent(bareProjectId)}/sheets:batch-get`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apsToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [sheetId] }),
      }
    )
    const detail = await detailResp.json()
    if (!detailResp.ok) { res.status(detailResp.status).json(detail); return }

    const sheet = detail?.results?.[0] || detail?.data?.[0] || (Array.isArray(detail) ? detail[0] : detail)
    const displayName = sheet?.title || sheet?.name || sheet?.sheetNumber || 'sheet'

    const storageUrn = sheet?.storageUrn || sheet?.fileVersionUrn || sheet?.sourceFileVersionUrn || sheet?.source?.storageUrn
    if (storageUrn) {
      await resolveStorageDownload(apsToken, res, storageUrn, displayName)
      return
    }

    res.status(422).json({ error: 'no_download_path', message: 'Could not find a downloadable file for this sheet.', debug: sheet })
  } catch (err) {
    console.error('[autodesk/sheet-download] failed:', err)
    res.status(502).json({ error: 'Failed to reach Autodesk.' })
  }
}
