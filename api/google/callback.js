// Google redirects here after the user signs in/consents. Mirrors
// api/autodesk/callback.js — exchanges the code for tokens server-side,
// verifies `state` to recover which Live-Trak user started the flow, and
// writes straight into integration_connections via the service-role
// client. Nothing Google-related ever reaches the browser here.
import { adminClient, requireEnv, verifyState } from './_lib.js'

export default async function handler(req, res) {
  const { code, state, error: googleError } = req.query

  if (googleError) { res.redirect(`/company-hub?google_error=${encodeURIComponent(googleError)}`); return }
  if (!code) { res.status(400).json({ error: 'No code provided' }); return }

  const payload = verifyState(state)
  if (!payload?.uid) { res.status(400).json({ error: 'Invalid or expired state — please try connecting again.' }); return }

  try {
    const clientId = requireEnv('GOOGLE_CLIENT_ID')
    const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET')
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || 'https://live-trak.ai/auth/google/callback'

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
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
      console.error('[google/callback] token exchange failed:', tokens)
      res.redirect(`/company-hub?google_error=${encodeURIComponent(tokens.error_description || tokens.error || 'token_exchange_failed')}`)
      return
    }

    const admin = adminClient()

    // Google only sends a refresh_token on the very first consent for a
    // given client/user pair unless prompt=consent forces a fresh one
    // (which auth.js always sets) — but fall back to keeping whatever's
    // already stored rather than overwriting it with nothing, just in case.
    let refreshToken = tokens.refresh_token
    if (!refreshToken) {
      const { data: existing } = await admin
        .from('integration_connections')
        .select('refresh_token')
        .eq('user_id', payload.uid)
        .eq('provider', 'google_drive')
        .maybeSingle()
      refreshToken = existing?.refresh_token
    }
    if (!refreshToken) {
      res.redirect('/company-hub?google_error=no_refresh_token')
      return
    }

    const { error: dbErr } = await admin.from('integration_connections').upsert({
      user_id: payload.uid,
      provider: 'google_drive',
      access_token: tokens.access_token,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' })
    if (dbErr) throw dbErr

    res.redirect('/company-hub?google_connected=1')
  } catch (err) {
    console.error('[google/callback] failed:', err)
    res.redirect(`/company-hub?google_error=${encodeURIComponent('connection_failed')}`)
  }
}
