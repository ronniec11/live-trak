import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Phoenix', label: 'Mountain — no DST (AZ)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
]

const CURRENCY_OPTIONS = ['USD', 'CAD', 'MXN']

const ROLE_LABELS = { admin: 'Admin', pm: 'PM', superintendent: 'Superintendent', foreman: 'Foreman' }

// Pilot-tier seat allowance — there's no billing/plan table behind this
// yet, so it's a display-only constant matching the "Enterprise Pilot"
// label below, not something enforced anywhere (adding a member past it
// still works, same as every role today).
const PLAN_MEMBER_LIMIT = 25

function ToggleGroup({ options, value, onChange }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
            value === opt.value
              ? 'bg-accent/10 text-accent border-accent/30'
              : 'bg-surface-2 text-muted hover:text-gray-700 dark:hover:text-gray-300 border-border'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function CompanyProfileCard({ org, onSaved }) {
  const [name, setName] = useState(org.name || '')
  const [address, setAddress] = useState(org.address || '')
  const [phone, setPhone] = useState(org.phone || '')
  const [website, setWebsite] = useState(org.website || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const patch = {
        name: trimmedName,
        address: address.trim() || null,
        phone: phone.trim() || null,
        website: website.trim() || null,
      }
      // .select().single() on purpose — a plain .update() with no .select()
      // reports success even if RLS blocks the row (a zero-row match isn't
      // an error to Postgres), which would otherwise look like it saved
      // here but silently revert on the next reload. See
      // supabase-migration-company-hub.sql for the UPDATE policy this
      // depends on.
      const { data, error: sErr } = await supabase.from('organizations').update(patch).eq('id', org.id).select().single()
      if (sErr) throw sErr
      if (!data) throw new Error("Nothing was saved — you may not have permission to edit the company profile (check the organizations table's RLS update policy).")
      onSaved(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Company Profile</h2>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="label">Company Name *</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Address</label>
          <input className="input" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St, Dallas, TX" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Phone</label>
            <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 555-5555" />
          </div>
          <div>
            <label className="label">Website</label>
            <input className="input" type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
          </div>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>}
        {saved && <div className="bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 text-accent text-sm">Saved.</div>}

        <div className="flex justify-end">
          <button type="submit" disabled={saving || !name.trim()} className="btn-primary">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function SettingsCard({ org, onSaved }) {
  const [unitSystem, setUnitSystem] = useState(org.unit_system || 'imperial')
  const [measurementDisplay, setMeasurementDisplay] = useState(org.measurement_display || 'decimal')
  const [dateFormat, setDateFormat] = useState(org.date_format || 'MM/DD/YYYY')
  const [timezone, setTimezone] = useState(org.timezone || 'America/Chicago')
  const [dailyTarget, setDailyTarget] = useState(org.default_daily_target ?? 0)
  const [currency, setCurrency] = useState(org.currency || 'USD')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const patch = {
        unit_system: unitSystem,
        measurement_display: measurementDisplay,
        date_format: dateFormat,
        timezone,
        currency,
        default_daily_target: parseFloat(dailyTarget) || 0,
      }
      const { data, error: sErr } = await supabase.from('organizations').update(patch).eq('id', org.id).select().single()
      if (sErr) throw sErr
      if (!data) throw new Error("Nothing was saved — you may not have permission to edit company settings (check the organizations table's RLS update policy).")
      onSaved(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Settings & Preferences</h2>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="label">Units</label>
          <ToggleGroup
            value={unitSystem}
            onChange={setUnitSystem}
            options={[
              { value: 'imperial', label: 'Imperial (SF, LF, in)' },
              { value: 'metric', label: 'Metric (m², cm, m)' },
            ]}
          />
        </div>
        <div>
          <label className="label">Measurement Display</label>
          <ToggleGroup
            value={measurementDisplay}
            onChange={setMeasurementDisplay}
            options={[
              { value: 'decimal', label: 'Decimal (0.125")' },
              { value: 'fraction', label: 'Fraction (1/8")' },
            ]}
          />
        </div>
        <div>
          <label className="label">Date Format</label>
          <ToggleGroup
            value={dateFormat}
            onChange={setDateFormat}
            options={[
              { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
              { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Time Zone</label>
            <select className="input" value={timezone} onChange={e => setTimezone(e.target.value)}>
              {TIMEZONE_OPTIONS.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Currency</label>
            <select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Default Daily SF Target</label>
          <input className="input" type="number" min="0" value={dailyTarget} onChange={e => setDailyTarget(e.target.value)} placeholder="e.g. 5000" />
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>}
        {saved && <div className="bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 text-accent text-sm">Saved.</div>}

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  )
}

function TeamCard({ people }) {
  const navigate = useNavigate()
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Team</h2>
        <span className="text-xs text-muted">{people.length} {people.length === 1 ? 'member' : 'members'}</span>
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-muted mb-4">No one yet.</p>
      ) : (
        <div className="divide-y divide-border mb-4">
          {people.map(p => (
            <div key={p.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-bg shrink-0"
                style={{ backgroundColor: p.avatar_color || '#4ade80' }}
              >
                {(p.full_name || p.email || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.full_name || '(no name)'}</p>
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${p.last_login_at ? 'bg-accent/10 text-accent' : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'}`}>
                {p.last_login_at ? 'Active' : 'Invited'}
              </span>
              <span className="text-xs text-muted capitalize shrink-0 w-24 text-right">{ROLE_LABELS[p.role] || p.role}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => navigate('/team')} className="btn-secondary w-full">Manage Team</button>
    </div>
  )
}

// Autodesk Construction Cloud connection — Phase 1 of the APS integration.
// The actual tokens never pass through this component: connect() asks
// api/autodesk/auth for a ready-made auth URL (sending the user's own
// Supabase session so the server knows who's connecting) and just
// navigates there; status is a plain connected/not-connected flag from
// api/autodesk/status, never the tokens themselves (see
// supabase-migration-aps-connections.sql for why).
function IntegrationsCard() {
  const [status, setStatus] = useState(null) // null = still checking
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  async function authedFetch(url) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not signed in.')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || data.error || 'Request failed.')
    return data
  }

  useEffect(() => {
    authedFetch('/api/autodesk/status').then(setStatus).catch(err => {
      // Swallowing this used to hide real failures (e.g. a missing
      // SUPABASE_SERVICE_ROLE_KEY on the deployed function) behind a plain
      // "Not connected" — no way to tell that apart from a genuine
      // never-connected state. Show it instead.
      setStatus({ connected: false })
      setError('Could not check Autodesk connection status: ' + err.message)
    })
    // Coming back from Autodesk's consent screen — surface any error, then
    // drop the query params so refreshing the page doesn't replay them.
    const params = new URLSearchParams(window.location.search)
    if (params.has('aps_connected') || params.has('aps_error')) {
      if (params.get('aps_error')) setError('Autodesk connection failed: ' + params.get('aps_error'))
      window.history.replaceState({}, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect() {
    setConnecting(true)
    setError('')
    try {
      const { authUrl } = await authedFetch('/api/autodesk/auth')
      window.location.href = authUrl
    } catch (err) {
      setError(err.message)
      setConnecting(false)
    }
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Integrations</h2>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">Autodesk Construction Cloud</p>
          <p className="text-sm text-muted">
            {status === null ? 'Checking connection…' : status.connected ? 'Connected — sheets can be imported from ACC.' : 'Not connected.'}
          </p>
        </div>
        <button type="button" onClick={connect} disabled={connecting} className="btn-secondary shrink-0">
          {connecting ? 'Connecting…' : status?.connected ? 'Reconnect Autodesk Account' : 'Connect Autodesk Account'}
        </button>
      </div>
      {error && <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>}
    </div>
  )
}

function PlanUsageCard({ people, usage }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Plan & Usage</h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted shrink-0">Current Plan</span>
          <span className="text-sm font-medium text-gray-900 dark:text-white text-right">Enterprise Pilot — Calderon Technologies</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted shrink-0">Storage Used</span>
          <span className="text-sm font-medium text-gray-900 dark:text-white text-right">
            {usage.pages} {usage.pages === 1 ? 'floor plan' : 'floor plans'} · {usage.sessions} {usage.sessions === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted shrink-0">Team Members</span>
          <span className={`text-sm font-medium ${people.length > PLAN_MEMBER_LIMIT ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
            {people.length} / {PLAN_MEMBER_LIMIT}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function CompanyHub() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [org, setOrg] = useState(null)
  const [people, setPeople] = useState([])
  const [usage, setUsage] = useState({ sessions: 0, pages: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    if (profile && !isAdmin) navigate('/projects', { replace: true })
  }, [profile, isAdmin, navigate])

  async function loadAll() {
    if (!profile?.organization_id) {
      setLoading(false)
      setLoadError('Your account isn\'t linked to a company yet — try refreshing the page.')
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const [{ data: orgData, error: orgErr }, { data: peopleData }, { count: sessionCount }, { count: pageCount }] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', profile.organization_id).single(),
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('sessions').select('id', { count: 'exact', head: true }),
        supabase.from('pages').select('id', { count: 'exact', head: true }),
      ])
      if (orgErr) throw orgErr
      setOrg(orgData)
      // Excludes anyone removed from the team (see Team.jsx) — filtered
      // client-side so this still works before
      // supabase-migration-team-active.sql has been run. The full roster,
      // removed people included, still lives on the Team page this links
      // to ("Manage Team" below).
      setPeople((peopleData || []).filter(p => p.active !== false))
      setUsage({ sessions: sessionCount ?? 0, pages: pageCount ?? 0 })
    } catch (err) {
      console.error('[CompanyHub] load error:', err)
      setLoadError(err.message || 'Failed to load the company hub.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (isAdmin) loadAll() }, [isAdmin])

  if (!isAdmin) return null

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Company Hub</h1>

        {loading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : loadError ? (
          <div className="text-center py-16">
            <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">Failed to load</p>
            <p className="text-sm text-muted mb-4">{loadError}</p>
            <button onClick={loadAll} className="btn-secondary">Try again</button>
          </div>
        ) : (
          <div className="space-y-6">
            <CompanyProfileCard org={org} onSaved={updated => setOrg(o => ({ ...o, ...updated }))} />
            <SettingsCard org={org} onSaved={updated => setOrg(o => ({ ...o, ...updated }))} />
            <TeamCard people={people} />
            <IntegrationsCard />
            <PlanUsageCard people={people} usage={usage} />
          </div>
        )}
      </div>
    </Layout>
  )
}
