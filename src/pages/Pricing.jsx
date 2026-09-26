import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// Feature bullets are placeholders — swap them for whatever each tier
// actually enforces once there's a real limit behind them (there isn't
// one yet; see CompanyHub.jsx's PLAN_MEMBER_LIMIT comment).
const PLANS = [
  {
    key: 'starter', name: 'Starter', price: 49,
    features: ['Up to 3 active jobs', 'Up to 5 team members', 'Unlimited floor plans & sessions', 'Email support'],
  },
  {
    key: 'pro', name: 'Pro', price: 149,
    features: ['Up to 15 active jobs', 'Up to 25 team members', 'Everything in Starter', 'Priority email support'],
  },
  {
    key: 'business', name: 'Business', price: 399,
    features: ['Unlimited active jobs', 'Unlimited team members', 'Everything in Pro', 'Priority phone & email support'],
  },
]

const PLAN_LABELS = { free: 'Free', starter: 'Starter', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' }

export default function Pricing() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'

  const [org, setOrg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyPlan, setBusyPlan] = useState(null) // which plan's Subscribe button is mid-checkout
  const [managing, setManaging] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (profile && !isAdmin) navigate('/projects', { replace: true })
  }, [profile, isAdmin, navigate])

  useEffect(() => {
    if (!isAdmin || !profile?.organization_id) return
    supabase.from('organizations').select('*').eq('id', profile.organization_id).single()
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setOrg(data)
        setLoading(false)
      })
  }, [isAdmin, profile?.organization_id])

  async function authedFetch(url, options = {}) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not signed in.')
    const res = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || data.error || 'Request failed.')
    return data
  }

  async function subscribe(plan) {
    setBusyPlan(plan)
    setError('')
    try {
      const { url } = await authedFetch('/api/stripe/create-checkout', { method: 'POST', body: JSON.stringify({ plan }) })
      window.location.href = url
    } catch (err) {
      setError(err.message)
      setBusyPlan(null)
    }
  }

  async function manageBilling() {
    setManaging(true)
    setError('')
    try {
      const { url } = await authedFetch('/api/stripe/portal', { method: 'POST' })
      window.location.href = url
    } catch (err) {
      setError(err.message)
      setManaging(false)
    }
  }

  if (!isAdmin) return null

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Plans & Pricing</h1>
          <p className="text-sm text-muted">
            {org ? <>Current plan: <span className="font-medium text-gray-900 dark:text-white">{PLAN_LABELS[org.plan] || org.plan}</span></> : 'Choose the plan that fits your team.'}
          </p>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-6 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm text-center">{error}</div>
        )}

        {loading ? (
          <p className="text-sm text-muted text-center">Loading...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map(plan => {
              const isCurrent = org?.plan === plan.key
              return (
                <div key={plan.key} className={`card flex flex-col ${isCurrent ? 'border-accent' : ''}`}>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{plan.name}</h2>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                    ${plan.price}<span className="text-sm font-normal text-muted">/month</span>
                  </p>
                  <ul className="space-y-2 mb-6 flex-1">
                    {plan.features.map(f => (
                      <li key={f} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                        <span className="text-accent shrink-0">✓</span>{f}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <button disabled className="btn-secondary w-full opacity-60 cursor-default">Current Plan</button>
                  ) : (
                    <button onClick={() => subscribe(plan.key)} disabled={busyPlan === plan.key} className="btn-primary w-full">
                      {busyPlan === plan.key ? 'Redirecting...' : 'Subscribe'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {org?.stripe_customer_id && (
          <div className="text-center mt-8">
            <button onClick={manageBilling} disabled={managing} className="btn-secondary">
              {managing ? 'Opening...' : 'Manage Billing'}
            </button>
          </div>
        )}
      </div>
    </Layout>
  )
}
