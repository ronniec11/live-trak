import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// Rendered by ProtectedRoute whenever profile.organizations.plan_status
// is 'incomplete' — a brand new self-signup company (CompanySetup.jsx
// already ran) that hasn't started its trial/subscription yet. This is
// the actual gate: nothing past this screen until Stripe Checkout
// completes and the webhook (api/stripe/webhook.js) moves plan_status to
// 'trialing'. An invited team member never sees this — their org's
// plan_status was already something else (active/trialing/past_due) long
// before they joined.
export default function SubscribeGate() {
  const { signOut, refreshProfile } = useAuth()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  // Set only on the way back from a cancelled Checkout session — a
  // completed one lands here too, but by the time this renders,
  // ProtectedRoute will have already moved on to the real app the moment
  // the retry below picks up the webhook's plan_status update, so this
  // never has a chance to show for that case.
  const [cancelled, setCancelled] = useState(false)

  // Checkout's success_url points back at /hub?payment=success (same
  // URL every other plan's checkout already uses) — the webhook that
  // actually flips plan_status can lag the redirect by a second or two,
  // so this retries refreshProfile a few times rather than checking once
  // and giving up back on this same screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'cancelled') { setCancelled(true); return }
    if (params.get('payment') !== 'success') return
    let aborted = false
    let attempt = 0
    async function poll() {
      if (aborted) return
      const p = await refreshProfile()
      if (p?.organizations?.plan_status && p.organizations.plan_status !== 'incomplete') return
      attempt++
      if (attempt < 6 && !aborted) setTimeout(poll, 1500)
    }
    poll()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startTrial() {
    setStarting(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in.')
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'basic' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start checkout.')
      window.location.href = data.url
    } catch (err) {
      setError(err.message || 'Could not start checkout — try again.')
      setStarting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-4 mb-8">
          <img src="/live-trak-icon.svg?v=3" style={{ width: '56px', height: '56px' }} />
          <h1 className="text-3xl font-extralight text-gray-900 dark:text-white tracking-tight">Live-Trak</h1>
        </div>

        <div className="card border-border/60">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Start your free trial</h2>
          <p className="text-sm text-muted mb-5">
            Your company's set up — one step left. Start a 14-day free trial to unlock Live-Trak for your team. A card is required to start the trial; you won't be charged until it ends, and you can cancel anytime before then.
          </p>

          {cancelled && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-600 dark:text-amber-400 text-sm mb-4">
              Checkout was cancelled — no charge was made. Start the trial whenever you're ready.
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              onClick={startTrial}
              disabled={starting}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {starting ? (
                <>
                  <div className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
                  Starting...
                </>
              ) : 'Start 14-Day Free Trial'}
            </button>
            <button type="button" onClick={signOut} className="btn-ghost w-full text-sm">
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
