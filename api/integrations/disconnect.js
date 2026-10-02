// Disconnects one integration — just deletes its stored tokens. Reconnecting
// later (api/<provider>/auth.js) always re-authorizes from scratch, so
// there's no "revoke" step needed beyond removing our own copy.
import { adminClient, getSupabaseUser } from '../_shared/auth.js'
import { PROVIDERS } from './status.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return }

  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { provider } = req.body || {}
  if (!PROVIDERS.includes(provider)) { res.status(400).json({ error: 'Unknown provider.' }); return }

  try {
    const admin = adminClient()
    const { error } = await admin
      .from('integration_connections')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', provider)
    if (error) throw error
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[integrations/disconnect] failed:', err)
    res.status(500).json({ error: err.message || 'Failed to disconnect.' })
  }
}
