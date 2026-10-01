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

// Built here instead of referencing the Resend-hosted "Team Invitation"
// template's own template:{id,variables} send mode — Resend has a
// confirmed bug (resend/react-email#3247) where a URL variable sitting
// inside an href="{{{...}}}" attribute gets corrupted by their template
// storage/substitution when sent through the REST API (works fine in
// their dashboard's own "Send test" preview, breaks on a real send,
// surfacing as a 422 "validation_error" with a blank field name — exactly
// what this hook hit). Sending the same design as plain html instead
// sidesteps that bug entirely. Keep this in sync by hand if the Resend
// template's design changes — this card's styling matches the app's own
// dark-mode tokens (src/index.css's :root.dark block), not arbitrary
// colors.
function inviteEmailHtml({ confirmationUrl, inviterName, organizationName }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#141628;padding:40px 0;">
  <tr>
    <td align="center">
      <div style="font-family:'Inter',system-ui,sans-serif;max-width:600px;margin:0 auto;background:#1c1f36;color:#e8eaf6;padding:40px;border-radius:12px;border:1px solid #333a5c;">

        <img src="https://live-trak.ai/logo.png" width="120" style="margin-bottom:32px;" alt="Live-Trak">

        <h1 style="font-size:24px;font-weight:700;margin-bottom:8px;color:#e8eaf6;">
          You've been invited to Live-Trak
        </h1>

        <p style="color:#8b90b3;font-size:16px;margin-bottom:32px;line-height:1.5;">
          ${escapeHtml(inviterName)} has invited you to join
          <strong style="color:#e8eaf6;">${escapeHtml(organizationName)}</strong>
          on Live-Trak — the production tracking platform for construction trades.
        </p>

        <a href="${confirmationUrl}"
           style="background:#4ade80;color:#141628;font-size:16px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block;margin-bottom:32px;">
          Accept Invitation
        </a>

        <p style="color:#8b90b3;font-size:13px;">
          This link expires in 24 hours. If you didn't expect this invitation contact
          <a href="mailto:hello@live-trak.ai" style="color:#4ade80;">hello@live-trak.ai</a>
        </p>

        <hr style="border:none;border-top:1px solid #333a5c;margin:32px 0;">

        <p style="color:#8b90b3;font-size:12px;">
          Live-Trak by Calderon Technologies ·
          <a href="https://live-trak.ai" style="color:#4ade80;">live-trak.ai</a>
        </p>

      </div>
    </td>
  </tr>
</table>`
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
    const { token_hash, redirect_to, email_action_type } = email_data
    // Same link GoTrue's own default templates build from
    // {{ .ConfirmationURL }} — hitting this verifies the token, then
    // 302-redirects the browser to redirect_to (Team.jsx's
    // INVITE_REDIRECT_URL, already allow-listed in Supabase's Auth ->
    // URL Configuration).
    const confirmationUrl = `${SUPABASE_URL}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to)}`

    const resend = new Resend(requireEnv('RESEND_API_KEY'))

    if (email_action_type === 'magiclink') {
      // The only auth email this app sends today — both the initial
      // invite and "Resend Invite" in Team.jsx call signInWithOtp, which
      // always fires as 'magiclink'. inviter_name/organization_name come
      // from the invited person's own user_metadata (set once, at invite
      // time, by PersonModal's signInWithOtp call) — this hook has no
      // other way to know who invited them or what company they're
      // joining, since Supabase's payload only ever describes the
      // invitee, never the admin who triggered the invite.
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
