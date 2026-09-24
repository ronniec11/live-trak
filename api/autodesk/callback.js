// Autodesk redirects here after the user signs in/consents. Exchanges the
// code for tokens server-side (client_secret never leaves this function),
// verifies `state` to recover which Live-Trak user started the flow, and
// writes the tokens straight into aps_connections via the service-role
// client — nothing APS-related ever reaches the browser here, unlike a
// raw `?aps_token=...&aps_refresh=...` redirect, which would put a
// long-lived refresh token in the URL (browser history, Vercel/proxy
// access logs, Referer headers on any outbound request the landing page
// happens to make).
import { adminClient, requireEnv, verifyState } from './_lib.js'

export default async function handler(req, res) {
  const { code, state, error: apsError } = req.query

  if (apsError) { res.redirect(`/company-hub?aps_error=${encodeURIComponent(apsError)}`); return }
  if (!code) { res.status(400).json({ error: 'No code provided' }); return }

  const payload = verifyState(state)
  if (!payload?.uid) { res.status(400).json({ error: 'Invalid or expired state — please try connecting again.' }); return }

  try {
    const clientId = requireEnv('APS_CLIENT_ID')
    const clientSecret = requireEnv('APS_CLIENT_SECRET')
    const callbackUrl = process.env.APS_CALLBACK_URL || 'https://live-trak.ai/api/autodesk/callback'

    const tokenResp = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
      }),
    })
    const tokens = await tokenResp.json()
    if (!tokenResp.ok || tokens.error) {
      console.error('[autodesk/callback] token exchange failed:', tokens)
      res.redirect(`/company-hub?aps_error=${encodeURIComponent(tokens.error_description || tokens.error || 'token_exchange_failed')}`)
      return
    }

    const admin = adminClient()
    const { error: dbErr } = await admin.from('aps_connections').upsert({
      user_id: payload.uid,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (dbErr) throw dbErr

    res.redirect('/company-hub?aps_connected=1')
  } catch (err) {
    console.error('[autodesk/callback] failed:', err)
    res.redirect(`/company-hub?aps_error=${encodeURIComponent('connection_failed')}`)
  }
}
