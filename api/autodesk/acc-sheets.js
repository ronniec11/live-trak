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
    if (!response.ok) { res.status(response.status).json(data); return }

    const list = data?.results || data?.data || []
    if (list.length > 0) { res.status(200).json(data); return }

    // A confirmed-nonempty ACC project (real sheets visible in Autodesk's
    // own app) still coming back empty here points at sheets being reachable
    // only through their version-set/collection (what the ACC UI shows as
    // e.g. "Production Tracking"), not as a flat per-project list. Pulling
    // version-sets alongside the empty list means the next screenshot shows
    // both shapes at once instead of a second round trip.
    const vsResponse = await fetch(
      `https://developer.api.autodesk.com/construction/sheets/v1/projects/${encodeURIComponent(bareProjectId)}/version-sets?limit=200`,
      { headers: { Authorization: `Bearer ${apsToken}` } }
    )
    const versionSets = await vsResponse.json().catch(() => null)

    // Also surface exactly which Autodesk identity this server-side token
    // belongs to — this integration has already hit one case of "connected
    // as the wrong Autodesk account" earlier, and ACC additionally requires
    // explicit per-project membership (account-admin access doesn't imply
    // project-level Sheets access), so knowing who the token is and
    // whether that user is a member of THIS project is the next fastest
    // way to tell a scope/membership problem from an API-shape problem.
    const whoamiResp = await fetch('https://api.userprofile.autodesk.com/userinfo', {
      headers: { Authorization: `Bearer ${apsToken}` },
    })
    const whoami = await whoamiResp.json().catch(() => null)

    let members = null
    if (whoamiResp.ok && whoami?.sub) {
      const membersResp = await fetch(
        `https://developer.api.autodesk.com/construction/admin/v1/projects/${encodeURIComponent(bareProjectId)}/users?filter[autodeskId]=${encodeURIComponent(whoami.sub)}`,
        { headers: { Authorization: `Bearer ${apsToken}` } }
      )
      members = { status: membersResp.status, body: await membersResp.json().catch(() => null) }
    }

    res.status(200).json({
      ...data,
      _debugVersionSets: { status: vsResponse.status, body: versionSets },
      _debugWhoAmI: { status: whoamiResp.status, body: whoami },
      _debugProjectMembership: members,
    })
  } catch (err) {
    console.error('[autodesk/acc-sheets] failed:', err)
    res.status(502).json({ error: 'Failed to reach Autodesk.' })
  }
}
