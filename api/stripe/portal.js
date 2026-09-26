// Opens a Stripe billing portal session for the CALLER's own company —
// resolved from their Supabase session, never a client-supplied
// customerId (which would otherwise let anyone request a portal link into
// a different company's payment methods and invoice history).
import Stripe from 'stripe'
import { adminClient, getCallerProfile, getSupabaseUser, requireEnv } from './_lib.js'

const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'))
const APP_URL = process.env.APP_URL || 'https://www.live-trak.ai'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const user = await getSupabaseUser(req)
  if (!user) { res.status(401).json({ error: 'Sign in to Live-Trak first.' }); return }

  try {
    const profile = await getCallerProfile(user.id)
    if (!profile?.organization_id) { res.status(409).json({ error: "Your account isn't linked to a company yet." }); return }
    if (profile.role !== 'admin') { res.status(403).json({ error: 'Only a company admin can manage billing.' }); return }

    const admin = adminClient()
    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', profile.organization_id)
      .single()
    if (orgErr || !org?.stripe_customer_id) {
      res.status(409).json({ error: 'no_subscription', message: 'This company has no billing history yet — subscribe to a plan first.' })
      return
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${APP_URL}/hub`,
    })
    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[stripe/portal] failed:', err)
    res.status(500).json({ error: err.message || 'Failed to open billing portal.' })
  }
}
