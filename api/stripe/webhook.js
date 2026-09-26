// Stripe calls this directly — there's no Live-Trak session involved at
// all, so identity here comes entirely from the verified webhook
// signature (constructEvent below), never a bearer token. Every DB write
// goes through adminClient() (service role, bypasses RLS) since there's
// no authenticated Supabase user to act as.
import Stripe from 'stripe'
import { adminClient, requireEnv } from './_lib.js'

const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'))

// Raw body is required for constructEvent's signature check — Vercel's
// default JSON body-parsing would otherwise re-serialize the payload
// slightly differently than what Stripe actually signed, and every event
// would fail verification.
export const config = { api: { bodyParser: false } }

const PRICE_PLAN_MAP = {
  [process.env.STRIPE_PRICE_STARTER]: 'starter',
  [process.env.STRIPE_PRICE_PRO]: 'pro',
  [process.env.STRIPE_PRICE_BUSINESS]: 'business',
}

function planForPriceId(priceId) {
  return PRICE_PLAN_MAP[priceId] || null
}

// Maps Stripe's own subscription statuses onto the four values
// organizations.plan_status actually allows (see
// supabase-migration-stripe-billing.sql's CHECK constraint) — trialing/
// active pass straight through, canceled is re-spelled to match (Stripe
// spells it with one L, the constraint uses "cancelled"), and anything
// else (unpaid, incomplete, incomplete_expired, paused) collapses to
// past_due as the "something needs attention" catch-all.
function planStatusFor(stripeStatus) {
  if (stripeStatus === 'active') return 'active'
  if (stripeStatus === 'trialing') return 'trialing'
  if (stripeStatus === 'canceled') return 'cancelled'
  return 'past_due'
}

async function buffer(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return }

  const sig = req.headers['stripe-signature']
  let event
  try {
    const buf = await buffer(req)
    event = stripe.webhooks.constructEvent(buf, sig, requireEnv('STRIPE_WEBHOOK_SECRET'))
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed:', err.message)
    res.status(400).send(`Webhook Error: ${err.message}`)
    return
  }

  try {
    const admin = adminClient()

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const organizationId = session.metadata?.organizationId
      const plan = session.metadata?.plan
      if (!organizationId || !plan) {
        console.error('[stripe/webhook] checkout.session.completed missing metadata on session', session.id)
      } else {
        // The subscription's actual status right after checkout can be
        // 'trialing' (a free trial is configured) or briefly 'incomplete'
        // (e.g. a card awaiting 3D Secure confirmation), not just
        // 'active' — read it back rather than assuming.
        const subscription = await stripe.subscriptions.retrieve(session.subscription)
        const { error } = await admin.from('organizations').update({
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          plan,
          plan_status: planStatusFor(subscription.status),
        }).eq('id', organizationId)
        if (error) throw error
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object
      // A plan switch made through the Stripe customer portal (rather than
      // our own checkout flow) changes the subscription's price/items but
      // does NOT update its metadata — reading the CURRENT price id is the
      // only way to catch that; metadata.plan is only a fallback for the
      // (expected) case where the price id doesn't match any of the three
      // known plans.
      const priceId = subscription.items?.data?.[0]?.price?.id
      const plan = planForPriceId(priceId) || subscription.metadata?.plan
      const patch = { plan_status: planStatusFor(subscription.status) }
      if (plan) patch.plan = plan
      const { error } = await admin.from('organizations').update(patch).eq('stripe_subscription_id', subscription.id)
      if (error) throw error
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object
      const { error } = await admin.from('organizations')
        .update({ plan_status: 'cancelled', plan: 'free' })
        .eq('stripe_subscription_id', subscription.id)
      if (error) throw error
    }

    res.status(200).json({ received: true })
  } catch (err) {
    // A non-2xx response makes Stripe retry this same event automatically
    // (with backoff, for several days) — better than swallowing a failed
    // DB write and silently leaving an organization's plan out of sync
    // with what Stripe actually charged them.
    console.error('[stripe/webhook] handler failed for event', event.type, err)
    res.status(500).json({ error: 'Webhook handler failed' })
  }
}
