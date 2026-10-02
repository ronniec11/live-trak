// Lists sheets from Autodesk Construction Cloud's dedicated Sheets feature
// (the "Sheets" tab — sheet number/title/version metadata) — a completely
// separate API family from the generic file/folder browsing in
// folders.js/sheets.js, which only ever sees whatever's sitting in a
// project's Files, not sheets published through ACC's own Sheets workflow.
//
// Construction Cloud APIs (construction/*) want the bare project GUID,
// not the "b."-prefixed id Data Management APIs (project/v1, data/v1 —
// what projects.js/folders.js/sheets.js/download.js all use) hand back —
// stripped here so the frontend can keep passing the exact same
// projectId it already has from the hub/project picker, same as every
// other endpoint in this integration.
import { getSupabaseUser, getValidApsToken } from './_lib.js'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { projectId } = req.query
  if (!projectId) { res.status(400).json({ error: 'projectId is required.' }); return }

  const apsToken = await getValidApsToken(user.id)
  if (!apsToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Autodesk account first.' }); return }

  const bareProjectId = projectId.replace(/^b\./, '')

  try {
    const response = await fetch(
      `https://developer.api.autodesk.com/construction/sheets/v1/projects/${encodeURIComponent(bareProjectId)}/sheets?currentOnly=true&limit=200`,
      { headers: { Authorization: `Bearer ${apsToken}` } }
    )
    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    console.error('[autodesk/acc-sheets] failed:', err)
    res.status(502).json({ error: 'Failed to reach Autodesk.' })
  }
}
