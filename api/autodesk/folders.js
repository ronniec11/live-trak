// Lists a project's top-level folders — the starting point for browsing
// into it, before sheets.js can list any given folder's contents.
import { getSupabaseUser, getValidApsToken } from './_lib.js'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { hubId, projectId } = req.query
  if (!hubId || !projectId) { res.status(400).json({ error: 'hubId and projectId are required.' }); return }

  const apsToken = await getValidApsToken(user.id)
  if (!apsToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Autodesk account first.' }); return }

  try {
    const response = await fetch(
      `https://developer.api.autodesk.com/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`,
      { headers: { Authorization: `Bearer ${apsToken}` } }
    )
    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    console.error('[autodesk/folders] failed:', err)
    res.status(502).json({ error: 'Failed to reach Autodesk.' })
  }
}
