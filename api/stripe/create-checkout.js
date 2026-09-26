// Creates a Stripe Checkout session for a company to subscribe to a plan.
// The organization is resolved from the CALLER's own Supabase session,
// never from client input (the original sketch this was built from took
// organizationId/userId/email straight from the request body — anyone
// could have POSTed an arbitrary company's id and attached a paid
// subscription's billing metadata to it). Only `plan` comes from the
// client, and it's just a lookup key into this server's own price-id env
// vars, not a raw Stripe price id — so the client can't submit an
// unrecognized/unintended price either.
import Stripe from 'stripe'
import { getCallerProfile, getSupabaseUser, requireEnv } from './_lib.js'

const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'))
// Same "hardcode the canonical domain" reasoning as Team.jsx's
// INVITE_REDIRECT_URL — an env var is still honored if set (APP_URL, not
// the Next.js-only NEXT_PUBLIC_APP_URL naming the original sketch used,
// which means nothing in this Vite app), but nothing NEEDS to be added in
// Vercel for this to work.
const APP_URL = process.env.APP_URL || 'https://www.live-trak.ai'

const PLAN_PRICE_ENV = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
  business: 'STRIPE_PRICE_BUSINESS',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  const { plan } = req.body || {}
  const priceEnvVar = PLAN_PRICE_ENV[plan]
  if (!priceEnvVar) { res.status(400).json({ error: `Unknown plan: ${plan}` }); return }

  try {
    const profile = await getCallerProfile(user.id)
    if (!profile?.organization_id) { res.status(409).json({ error: "Your account isn't linked to a company yet." }); return }
    if (profile.role !== 'admin') { res.status(403).json({ error: 'Only a company admin can change billing.' }); return }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: requireEnv(priceEnvVar), quantity: 1 }],
      customer_email: user.email,
      // Stashed on BOTH the session and the subscription it creates — the
      // checkout.session.completed webhook event reads it straight off the
      // session (no line_items lookup needed: that field isn't included on
      // this event unless separately expanded, which is a common gotcha),
      // and subscription_data.metadata carries the same info onto the
      // subscription object itself for later customer.subscription.updated/
      // deleted events, which only ever hand back the subscription, not
      // the checkout session.
      metadata: { organizationId: profile.organization_id, userId: user.id, plan },
      subscription_data: { metadata: { organizationId: profile.organization_id, plan } },
      success_url: `${APP_URL}/hub?payment=success`,
      cancel_url: `${APP_URL}/hub?payment=cancelled`,
    })

    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[stripe/create-checkout] failed:', err)
    res.status(500).json({ error: err.message || 'Failed to start checkout.' })
  }
}
