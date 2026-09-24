// Resolves a selected ACC file (an "item" from sheets.js's folder listing)
// to a directly-downloadable URL and its display name.
//
// Deliberately does NOT proxy the file's bytes through this function —
// Vercel Node Serverless Functions cap a response around 4.5MB, and
// construction drawing sheets (scanned/high-DPI PDFs) routinely exceed
// that. Instead this resolves the item's storage location and asks
// Autodesk's OSS API for a pre-signed S3 URL, which the browser then
// downloads directly — the actual file bytes never pass through this
// server at all, only a small JSON payload with the URL.
import { getSupabaseUser, getValidApsToken } from './_lib.js'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { projectId, itemId } = req.query
  if (!projectId || !itemId) { res.status(400).json({ error: 'projectId and itemId are required.' }); return }

  const apsToken = await getValidApsToken(user.id)
  if (!apsToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Autodesk account first.' }); return }

  try {
    const tipResp = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/tip`,
      { headers: { Authorization: `Bearer ${apsToken}` } }
    )
    const tip = await tipResp.json()
    if (!tipResp.ok) { res.status(tipResp.status).json(tip); return }

    const displayName = tip?.data?.attributes?.displayName || 'sheet'
    const storageUrn = tip?.data?.relationships?.storage?.data?.id
    if (!storageUrn) {
      res.status(422).json({ error: 'no_storage', message: 'This file has no downloadable version.' })
      return
    }

    // Storage urn shape: urn:adsk.objects:os.object:{bucketKey}/{objectKey}
    const rest = storageUrn.replace('urn:adsk.objects:os.object:', '')
    const slash = rest.indexOf('/')
    if (slash < 0) { res.status(422).json({ error: 'bad_storage_urn', message: 'Unexpected storage reference from Autodesk.' }); return }
    const bucketKey = rest.slice(0, slash)
    const objectKey = rest.slice(slash + 1)

    const signResp = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3download`,
      { headers: { Authorization: `Bearer ${apsToken}` } }
    )
    const signed = await signResp.json()
    if (!signResp.ok || !signed.url) {
      console.error('[autodesk/download] signeds3download failed:', signed)
      res.status(signResp.status || 502).json({ error: 'sign_failed', message: 'Could not get a download link from Autodesk.' })
      return
    }

    res.status(200).json({ url: signed.url, name: displayName })
  } catch (err) {
    console.error('[autodesk/download] failed:', err)
    res.status(502).json({ error: 'Failed to reach Autodesk.' })
  }
}
