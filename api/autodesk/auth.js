// Starts the APS 3-legged OAuth flow. Requires the caller to already be
// signed into Live-Trak (their Supabase access_token as a normal bearer
// header) — the resulting `state` carries that verified identity through
// Autodesk's redirect so callback.js knows whose account to connect,
// without ever putting a token of any kind in a URL.
//
// Returns the Autodesk auth URL as JSON rather than doing the redirect
// itself, so the browser can send its Authorization header on a plain
// fetch() — a top-level navigation (e.g. window.location.href = this
// endpoint) can't carry a header, which would force the Supabase token
// into a query string instead.
import { getSupabaseUser, requireEnv, signState } from './_lib.js'

export default async function handler(req, res) {
  try {
    const user = await getSupabaseUser(req)
    if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

    const clientId = requireEnv('APS_CLIENT_ID')
    // /auth/autodesk/callback (not api/autodesk/callback.js's own path) —
    // this is the URL already registered in the APS developer portal;
    // vercel.json rewrites it through to the actual serverless function.
    // Must match callback.js's own default exactly, and whatever's
    // registered as this app's callback URL in the APS developer portal.
    const callbackUrl = process.env.APS_CALLBACK_URL || 'https://live-trak.ai/auth/autodesk/callback'
    const state = signState({ uid: user.id })

    const authUrl = 'https://developer.api.autodesk.com/authentication/v2/authorize?' +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'data:read data:write',
        state,
      })

    res.status(200).json({ authUrl })
  } catch (err) {
    console.error('[autodesk/auth] failed:', err)
    res.status(500).json({ error: err.message || 'Failed to start Autodesk sign-in.' })
  }
}
