// Lets the UI show "Connected" vs "Connect Autodesk Account" without ever
// handing the tokens themselves to the browser.
import { adminClient, getSupabaseUser } from './_lib.js'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  try {
    const admin = adminClient()
    const { data, error } = await admin
      .from('aps_connections')
      .select('updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) throw error
    res.status(200).json({ connected: !!data, connectedAt: data?.updated_at || null })
  } catch (err) {
    console.error('[autodesk/status] failed:', err)
    res.status(500).json({ error: err.message || 'Failed to check Autodesk connection status.' })
  }
}
