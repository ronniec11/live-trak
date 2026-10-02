// Lists the contents of a Google Drive folder (default: "My Drive" root).
// Unlike Autodesk's hub/project/folder hierarchy, Drive is just folders
// containing files and other folders — a single flat endpoint is enough
// for the whole browsing experience.
import { getSupabaseUser, getValidGoogleToken } from './_lib.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const folderId = req.query.folderId || 'root'

  const googleToken = await getValidGoogleToken(user.id)
  if (!googleToken) { res.status(409).json({ error: 'not_connected', message: 'Connect your Google account first.' }); return }

  try {
    const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType)',
      orderBy: 'folder,name',
      pageSize: '1000',
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
