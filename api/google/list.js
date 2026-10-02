// Lists the contents of a Google Drive folder (default: "My Drive" root),
// or — with ?starred=1 — every file/folder the user has starred in Drive,
// regardless of which folder it actually lives in. Unlike Autodesk's hub/
// project/folder hierarchy, Drive is just folders containing files and
// other folders — a single flat endpoint, switched by query, is enough
// for the whole browsing experience.
import { getSupabaseUser, getValidGoogleToken } from './_lib.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const starred = req.query.starred === '1'
  const folderId = req.query.folderId || 'root'

  const googleToken = await getValidGoogleToken(user.id)
  if (!googleToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Google account first.' }); return }

  try {
    const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
      q: starred ? 'starred = true and trashed = false' : `'${folderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType)',
      orderBy: 'folder,name',
      pageSize: '1000',
      // Drive's API excludes Shared Drive (Team Drive) content from
      // results by default — these two flags are both required to see it.
      // Without them, anything living in an org's shared drive (common for
      // a company's job/project folders, as opposed to someone's personal
      // My Drive) silently vanishes from every listing, starred or not.
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    })
    const response = await fetch(url, { headers: { Authorization: `Bearer ${googleToken}` } })
    const data = await response.json()
    if (!response.ok) { res.status(response.status).json(data); return }

    res.status(200).json({
      data: (data.files || []).map(f => ({
        id: f.id,
        name: f.name,
        kind: f.mimeType === FOLDER_MIME ? 'folder' : 'file',
      })),
    })
  } catch (err) {
    console.error('[google/list] failed:', err)
    res.status(502).json({ error: 'Failed to reach Google Drive.' })
  }
}
