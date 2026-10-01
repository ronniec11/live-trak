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
        template: {
          id: requireEnv('RESEND_INVITE_TEMPLATE_ID'),
          variables: {
            CONFIRMATION_URL: confirmationUrl,
            INVITER_NAME: user.user_metadata?.inviter_name || 'A teammate',
            ORGANIZATION_NAME: user.user_metadata?.organization_name || 'their company',
          },
        },
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
