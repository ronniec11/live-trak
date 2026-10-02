// Connection status for every known integration in one call, so the
// Company Hub's Integrations panel and Scope Detail's "Import from …"
// buttons can both ask once instead of hitting a separate status
// endpoint per provider. Never returns the tokens themselves — see
// supabase-migration-integration-connections.sql.
import { adminClient, getSupabaseUser } from '../_shared/auth.js'

// The single place that knows every integration this app supports —
// adding a provider here is enough for it to show up in this response;
// the Company Hub panel and Scope Detail's button row both drive off it.
export const PROVIDERS = ['autodesk', 'google_drive']

export default async function handler(req, res) {
  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  try {
    const admin = adminClient()
    const { data, error } = await admin
      .from('integration_connections')
      .select('provider, updated_at')
      .eq('user_id', user.id)
    if (error) throw error

    const byProvider = {}
    for (const p of PROVIDERS) byProvider[p] = { connected: false, connectedAt: null }
    for (const row of data || []) {
      byProvider[row.provider] = { connected: true, connectedAt: row.updated_at }
    }
    res.status(200).json(byProvider)
  } catch (err) {
    console.error('[integrations/status] failed:', err)
    res.status(500).json({ error: err.message || 'Failed to check integration status.' })
  }
}
