// Starts Google's OAuth flow for Drive access. Mirrors api/autodesk/auth.js
// exactly — see that file's comments for why this returns the auth URL as
// JSON instead of redirecting directly, and why `state` carries the
// caller's verified Live-Trak identity through Google's redirect.
import { getSupabaseUser, requireEnv, signState } from './_lib.js'

export default async function handler(req, res) {
  try {
    const user = await getSupabaseUser(req)
    if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

    const clientId = requireEnv('GOOGLE_CLIENT_ID')
    // /auth/google/callback (not api/google/callback.js's own path) — this
    // is the URL registered in the Google Cloud Console's OAuth client.
    // Must match callback.js's own default exactly.
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || 'https://live-trak.ai/auth/google/callback'
    const state = signState({ uid: user.id })

    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        access_type: 'offline', // request a refresh_token, not just a short-lived access token
        prompt: 'consent', // force Google to reissue a refresh_token even on a reconnect
        state,
      })

    res.status(200).json({ authUrl })
  } catch (err) {
    console.error('[google/auth] failed:', err)
    res.status(500).json({ error: err.message || 'Failed to start Google sign-in.' })
  }
}
