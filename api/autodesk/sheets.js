// Lists the contents of one ACC project folder (sheets/files to import).
// Same server-side token resolution as projects.js — see that file.
import { getSupabaseUser, getValidApsToken } from './_lib.js'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { projectId, folderId } = req.query
  if (!projectId || !folderId) { res.status(400).json({ error: 'projectId and folderId are required.' }); return }

  const apsToken = await getValidApsToken(user.id)
  if (!apsToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Autodesk account first.' }); return }

  try {
    const response = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`,
      { headers: { Authorization: `Bearer ${apsToken}` } }
    )
    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    console.error('[autodesk/sheets] failed:', err)
    res.status(502).json({ error: 'Failed to reach Autodesk.' })
  }
}
