// Lists the caller's ACC hubs/projects. Resolves their Autodesk token
// server-side (refreshing it if needed) from their Live-Trak session — the
// client never needs to hold or send a raw APS token itself.
import { getSupabaseUser, getValidApsToken } from './_lib.js'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const apsToken = await getValidApsToken(user.id)
  if (!apsToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Autodesk account first.' }); return }

  try {
    const response = await fetch('https://developer.api.autodesk.com/project/v1/hubs', {
      headers: { Authorization: `Bearer ${apsToken}` },
    })
    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    console.error('[autodesk/projects] failed:', err)
    res.status(502).json({ error: 'Failed to reach Autodesk.' })
  }
}
