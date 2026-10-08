// Supabase Auth's "Send Email Hook" — fires for every outgoing auth email
// (magic link, password reset, etc.) INSTEAD of Supabase's own built-in
// templates, once this endpoint is wired up in Supabase Dashboard ->
// Authentication -> Hooks -> "Send Email". Without this, Team.jsx's invite
// flow (supabase.auth.signInWithOtp) sends whatever's configured in
// Supabase's own Email Templates editor — a completely separate system
// from Resend's own saved templates, which don't understand Supabase's
// {{ .ConfirmationURL }} style variables at all. This hook is what lets an
// invite actually go out through a real Resend template instead.
//
// Raw body is required for the webhook signature check below — same
// reason as api/stripe/webhook.js's own bodyParser:false.
import { Webhook } from 'standardwebhooks'
import { Resend } from 'resend'

export const config = { api: { bodyParser: false } }

// Hardcoded rather than env-derived — same project this whole app talks
// to (see api/stripe/_lib.js's identical constant), and this is the one
// piece .ConfirmationURL-equivalent link construction below actually
// needs: GoTrue's own verify endpoint lives on the Supabase project
// itself, not on live-trak.ai.
const SUPABASE_URL = 'https://vzqopjbwkxpawogdtvmf.supabase.co'

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Login.jsx's OTP second-factor step calls supabase.auth.signInWithOtp on
// an EXISTING user (shouldCreateUser: false) — the exact same API Team.jsx
// uses to resend an invite to someone who already has an account, so both
// land here as email_action_type 'magiclink' with no way to tell them
// apart from that alone. Login.jsx deliberately passes this as its
// emailRedirectTo (distinct from Team.jsx's INVITE_REDIRECT_URL below) so
// the branch below can tell which one actually happened. Already
// allow-listed in Supabase (it's the same URL Login.jsx's own password
// reset/signup confirm use) — no extra Supabase config needed for this.
const LOGIN_OTP_REDIRECT_URL = 'https://www.live-trak.ai/profile'

// Built here instead of referencing the Resend-hosted "Team Invitation"
// template's own template:{id,variables} send mode — Resend has a
// confirmed bug (resend/react-email#3247) where a URL variable sitting
// inside an href="{{{...}}}" attribute gets corrupted by their template
// storage/substitution when sent through the REST API (works fine in
// their dashboard's own "Send test" preview, breaks on a real send,
// surfacing as a 422 "validation_error" with a blank field name — exactly
// what this hook hit). Sending the same design as plain html instead
// sidesteps that bug entirely. Keep this in sync by hand if the Resend
// template's design changes.
//
// Fixed light theme, deliberately not adaptive — an earlier version tried
// genuine dual light/dark support (prefers-color-scheme + Gmail's
// [data-ogsc] hack), but confirmed on-device: Gmail's own dark-mode
// engine didn't reliably honor those explicit overrides, instead
// partially re-darkening the light-mode base styles into a muted
// black-and-grey mess that matched neither palette cleanly. Forcing
// color-scheme:light tells clients that DO respect it to leave these
// colors alone; clients that don't (older Gmail apps) still auto-convert
// a plain light card reasonably well, since that's the overwhelmingly
// common case their dark-mode heuristics are tuned for — better than
// fighting it with overrides it won't consistently apply. The logo is
// the icon mark alone, no wordmark baked in (the heading right below it
// already says "Live-Trak") — also deliberate: a transparent icon with no
// text needs no light/dark handling at all to stay legible, unlike the
// text-bearing wordmark version this replaced.
function inviteEmailHtml({ confirmationUrl, inviterName, organizationName }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#f7f7f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;padding:40px 0;">
  <tr>
    <td align="center">
      <div style="font-family:'Inter',system-ui,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;padding:40px;border-radius:12px;border:1px solid #d8d8d4;">

        <img src="https://live-trak.ai/logo-icon.png" width="72" style="margin-bottom:24px;border-radius:14px;" alt="Live-Trak">

        <h1 style="font-size:24px;font-weight:700;margin-bottom:8px;color:#1c1c1a;">
          You've been invited to Live-Trak
        </h1>

        <p style="color:#6b7280;font-size:16px;margin-bottom:32px;line-height:1.5;">
          ${escapeHtml(inviterName)} has invited you to join
          <strong style="color:#1c1c1a;">${escapeHtml(organizationName)}</strong>
          on Live-Trak — the production tracking platform for construction trades.
        </p>

        <a href="${confirmationUrl}"
           style="background:#16a34a;color:#f7f7f5;font-size:16px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block;margin-bottom:32px;">
          Accept Invitation
        </a>

        <p style="color:#6b7280;font-size:13px;">
          This link expires in 24 hours. If you didn't expect this invitation contact
          <a href="mailto:hello@live-trak.ai" style="color:#16a34a;">hello@live-trak.ai</a>
        </p>

        <hr style="border:none;border-top:1px solid #d8d8d4;margin:32px 0;">

        <p style="color:#6b7280;font-size:12px;">
          Live-Trak by Calderon Technologies ·
          <a href="https://live-trak.ai" style="color:#16a34a;">live-trak.ai</a>
        </p>

      </div>
    </td>
  </tr>
</table>
</body>
</html>`
}

// Dark theme (unlike inviteEmailHtml's light one above) — matches the
// design actually requested for this screen, and plain HTML/inline styles
// for the same Resend-template-substitution-bug reason noted on
// inviteEmailHtml. No exact "expires in N minutes" claim — Supabase's own
// Email OTP expiration setting (Authentication -> Providers -> Email) is
// what actually governs that, lives entirely outside this repo, and has
// already changed once this project; a hardcoded number here would just be
// one more place to remember to keep in sync with it.
function otpEmailHtml({ token }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background:#0a0a0f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 0;">
  <tr>
    <td align="center">
      <div style="font-family:'Inter',system-ui,sans-serif;max-width:500px;margin:0 auto;background:#0a0a0f;color:#f1f1f3;padding:40px;border-radius:12px;">

        <h2 style="font-size:20px;margin:0 0 8px;">Your verification code</h2>
        <p style="color:#8888a0;margin:0 0 24px;">Enter this code to complete your login to Live-Trak.</p>

        <div style="background:#1c1c26;border:1px solid #2a2a3a;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#22c55e;">${escapeHtml(token)}</span>
        </div>

        <p style="color:#8888a0;font-size:13px;margin:0;">
          If you didn't request this, contact
          <a href="mailto:hello@live-trak.ai" style="color:#22c55e;">hello@live-trak.ai</a>.
        </p>

      </div>
    </td>
  </tr>
</table>
</body>
</html>`
}

async function buffer(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(400).json({ error: 'not allowed' }); return }

  const payload = (await buffer(req)).toString('utf8')
  const headers = {
    'webhook-id': req.headers['webhook-id'],
    'webhook-timestamp': req.headers['webhook-timestamp'],
    'webhook-signature': req.headers['webhook-signature'],
  }

  let user, email_data
  try {
    // The secret Supabase shows you when you enable this hook arrives
    // prefixed "v1,whsec_..." — the Webhook class wants just the
    // whsec_... part, same strip the official Supabase example does.
    const hookSecret = requireEnv('SEND_EMAIL_HOOK_SECRET').replace('v1,', '')
    const wh = new Webhook(hookSecret)
    ;({ user, email_data } = wh.verify(payload, headers))
  } catch (err) {
    // A failed signature check must 401, never 200 — a 200 here would
    // tell Supabase the email was handled when it wasn't, silently
    // dropping every invite/reset email with no error anywhere.
    console.error('[auth/send-email] signature verification failed:', err.message)
    res.status(401).json({ error: { message: err.message } })
    return
  }

  try {
    const { token, token_hash, redirect_to, email_action_type } = email_data
    // Logged unconditionally (not just on error) — 'magiclink' and
    // 'signup' turned out not to be the only two values this app
    // actually sees in practice (handling both still produced the plain
    // fallback once), so the fastest way to find the real value for a
    // given attempt is reading it straight from here instead of guessing
    // a third one blind.
    console.log('[auth/send-email] email_action_type:', email_action_type, 'redirect_to:', redirect_to)

    const resend = new Resend(requireEnv('RESEND_API_KEY'))

    // Login.jsx's OTP step — see LOGIN_OTP_REDIRECT_URL above for why
    // redirect_to (not just email_action_type, which 'magiclink' alone
    // can't disambiguate from a resend-invite below) is what catches this.
    // Checked first/separately: this is the one case where the code itself
    // is what the person needs, not a clickable link, so it skips
    // confirmationUrl entirely.
    if (email_action_type === 'magiclink' && redirect_to === LOGIN_OTP_REDIRECT_URL) {
      const { error } = await resend.emails.send({
        from: requireEnv('INVITE_EMAIL_FROM'),
        to: [user.email],
        subject: 'Your Live-Trak verification code',
        html: otpEmailHtml({ token }),
        // iOS's "Security Code AutoFill" (the suggestion bar above the
        // keyboard — confirmed on-device for a Gmail-app inbox not even
        // added to Apple Mail) reads this from the push notification
        // PREVIEW TEXT the mail app shows, which comes from the plain-text
        // part of the email, not the HTML. Without an explicit `text`
        // here, Resend auto-generates one by stripping the HTML card —
        // serviceable, but the code ends up a sentence or two in, right at
        // the edge of (or past) how much a notification banner actually
        // shows before truncating. Leading with the code itself, the same
        // way the working example that prompted this was phrased ("092800
        // is your one-time code..."), keeps it inside the preview length
        // every time instead of leaving it to chance.
        text: `${token} is your Live-Trak verification code. Enter it to finish signing in. If you didn't request this, contact hello@live-trak.ai.`,
      })
      if (error) throw error
      res.status(200).json({})
      return
    }

    // Same link GoTrue's own default templates build from
    // {{ .ConfirmationURL }} — hitting this verifies the token, then
    // 302-redirects the browser to redirect_to (Team.jsx's
    // INVITE_REDIRECT_URL, already allow-listed in Supabase's Auth ->
    // URL Configuration).
    const confirmationUrl = `${SUPABASE_URL}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to)}`

    if (email_action_type === 'magiclink' || email_action_type === 'signup') {
      // Both of these come from Team.jsx's own signInWithOtp calls —
      // confirmed on-device that Supabase fires 'signup' for a genuinely
      // brand-new email (first-ever invite to that address, the
      // shouldCreateUser:true path actually creating the auth user) and
      // 'magiclink' once that person already exists (every "Resend
      // Invite" after that first one) — a quirk of signInWithOtp, not
      // something this app controls (see github.com/orgs/supabase/
      // discussions/28947). Missing 'signup' here was exactly why a
      // first-time invite sent the plain fallback link below instead of
      // this styled template, while a resend to an existing invitee
      // looked correct. inviter_name/organization_name come from the
      // invited person's own user_metadata (set once, at invite time, by
      // PersonModal's signInWithOtp call) — this hook has no other way to
      // know who invited them or what company they're joining, since
      // Supabase's payload only ever describes the invitee, never the
      // admin who triggered the invite.
      const { error } = await resend.emails.send({
        from: requireEnv('INVITE_EMAIL_FROM'),
        to: [user.email],
        subject: "You've been invited to Live-Trak",
        html: inviteEmailHtml({
          confirmationUrl,
          inviterName: user.user_metadata?.inviter_name || 'A teammate',
          organizationName: user.user_metadata?.organization_name || 'their company',
        }),
      })
      if (error) throw error
    } else {
      // Every other auth email type (password reset, email change, ...)
      // isn't wired to its own branded Resend template yet — a bare link
      // beats silently never sending anything once this hook is enabled
      // project-wide.
      const { error } = await resend.emails.send({
        from: requireEnv('INVITE_EMAIL_FROM'),
        to: [user.email],
        subject: 'Your Live-Trak sign-in link',
        html: `<p><a href="${confirmationUrl}">Click here to continue</a></p>`,
      })
      if (error) throw error
    }
  } catch (err) {
    console.error('[auth/send-email] send failed:', err)
    res.status(500).json({ error: { message: err.message || 'Failed to send email' } })
    return
  }

  res.status(200).json({})
}
