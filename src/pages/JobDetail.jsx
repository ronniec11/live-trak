import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const STATUS_OPTIONS = ['active', 'completed', 'on hold']
// Austin, TX — used for the weather widget whenever a job has no address
// set yet, so the widget always has something to show rather than an empty
// box.
const DEFAULT_WEATHER_LOCATION = { lat: 30.26, lon: -97.74, label: 'Austin, TX' }

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
}

// Distinct from badgeClass above — this is a left-edge accent stripe on the
// scope cards themselves (a quick color scan across a grid of cards), not
// the small text badge. Uses plain hex via inline style rather than a
// Tailwind border-color utility since it only needs to override one edge of
// the "card" class's existing all-sides border, not fight its specificity.
function scopeAccentColor(status) {
  if (status === 'active') return '#4ade80'
  if (status === 'completed') return '#9ca3af'
  return '#facc15'
}

// Open-Meteo's WMO weather codes collapsed to a short human label — see
// https://open-meteo.com/en/docs for the full table.
function weatherDescription(code) {
  const map = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
    56: 'Freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Heavy freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
    85: 'Light snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Severe thunderstorm, hail',
  }
  return map[code] || 'Weather'
}

function WeatherIcon({ code }) {
  const common = { className: 'w-7 h-7 text-accent shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.5 }
  if (code === 0 || code === 1) {
    return <svg {...common}><circle cx="12" cy="12" r="4.5" /><path strokeLinecap="round" d="M12 2.5v2.5M12 19v2.5M4.22 4.22l1.77 1.77M18 18l1.78 1.78M2.5 12H5M19 12h2.5M4.22 19.78L6 18M18 6l1.78-1.78" /></svg>
  }
  if ([2, 3, 45, 48].includes(code)) {
    return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 15.75a4.5 4.5 0 01.72-8.933 5.25 5.25 0 0110.06 1.5A4.001 4.001 0 0117.25 16H6.75z" /></svg>
  }
  if ([95, 96, 99].includes(code)) {
    return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12.75a4.5 4.5 0 01.72-8.933 5.25 5.25 0 0110.06 1.5A4.001 4.001 0 0117.25 13H6.75z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13 14l-2.5 4h2.5l-2 4" /></svg>
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12.75a4.5 4.5 0 01.72-8.933 5.25 5.25 0 0110.06 1.5A4.001 4.001 0 0117.25 13H6.75z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 17v2.5M12 17v2.5M16 17v2.5" /></svg>
  }
  // Drizzle / rain / showers (the remaining, most common construction-relevant case)
  return (
    <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12.75a4.5 4.5 0 01.72-8.933 5.25 5.25 0 0110.06 1.5A4.001 4.001 0 0117.25 13H6.75z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 16.5l-1 3M12 16.5l-1 3M16 16.5l-1 3" /></svg>
  )
}

// Resolves a job's address to coordinates once (Open-Meteo's free
// geocoding API, no key), falling back to Austin, TX when there's no
// address or geocoding fails. Shared by WeatherWidget and LocationMap
// below so the sidebar only geocodes the address a single time instead of
// each widget doing its own redundant lookup.
function useJobLocation(address) {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setState({ status: 'loading' })
      let { lat, lon, label } = DEFAULT_WEATHER_LOCATION
      let usedDefault = true
      if (address) {
        try {
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(address)}&count=1`)
          const geo = await geoRes.json()
          const match = geo?.results?.[0]
          if (match) {
            lat = match.latitude; lon = match.longitude
            label = [match.name, match.admin1 || match.country].filter(Boolean).join(', ')
            usedDefault = false
          }
        } catch (e) {
          console.warn('[JobDetail] Geocoding failed, using default location:', e)
        }
      }
      if (!cancelled) setState({ status: 'ready', lat, lon, label, usedDefault })
    }
    load()
    return () => { cancelled = true }
  }, [address])

  return state
}

function WeatherWidget({ location }) {
  const [weather, setWeather] = useState({ status: 'loading' })

  useEffect(() => {
    if (location.status !== 'ready') return
    let cancelled = false
    async function load() {
      setWeather({ status: 'loading' })
      try {
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`)
        const data = await weatherRes.json()
        if (cancelled) return
        if (!data?.current) { setWeather({ status: 'error' }); return }
        setWeather({ status: 'ready', current: data.current })
      } catch (e) {
        console.warn('[JobDetail] Weather fetch failed:', e)
        if (!cancelled) setWeather({ status: 'error' })
      }
    }
    load()
    return () => { cancelled = true }
  }, [location.status, location.lat, location.lon])

  if (location.status !== 'ready' || weather.status === 'loading') {
    return <div className="card animate-pulse h-[88px]" />
  }
  if (weather.status === 'error') {
    return (
      <div className="card flex items-center justify-center text-xs text-muted h-[88px]">
        Weather unavailable
      </div>
    )
  }

  const { current } = weather
  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <WeatherIcon code={current.weather_code} />
        <div className="min-w-0">
          <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight">{Math.round(current.temperature_2m)}°F</p>
          <p className="text-xs text-muted truncate">{weatherDescription(current.weather_code)} · {Math.round(current.wind_speed_10m)} mph</p>
        </div>
      </div>
      <p className="text-xs text-muted mt-2">
        {location.usedDefault
          ? <>No job address set — showing <span className="font-medium text-gray-700 dark:text-gray-300">{location.label}</span></>
          : location.label}
      </p>
    </div>
  )
}

// Free embed, no API key — OpenStreetMap's own export/embed endpoint takes
// a bounding box + marker and returns an iframe-able map page directly.
function LocationMap({ location }) {
  if (location.status !== 'ready') {
    return <div className="rounded-xl border border-border overflow-hidden h-40 bg-surface-2 animate-pulse" />
  }
  const { lat, lon } = location
  const delta = 0.01
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(',')
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <iframe
        title="Job location"
        width="100%"
        height="160"
        style={{ border: 0, display: 'block' }}
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`}
      />
    </div>
  )
}

// Adding someone to a job means adding them to every scope under it —
// jobs.jsx/JobDetail's "Team Members" is an aggregate view (see
// loadJobDetail's memberMap dedup), not a table of its own, so there's no
// single job-level membership row to insert. scopeIds is always the full
// set for this job; the directory already excludes anyone who's a member
// of at least one scope (existingMemberIds), so this only ever runs for
// someone with zero scopes on the job — never a partial-membership case
// that could conflict with project_members' one-row-per-(project,user)
// constraint.
function AddMemberModal({ scopeIds, existingMemberIds, onClose, onAdded }) {
  const [directory, setDirectory] = useState(null) // null = still loading
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('profiles').select('*').order('full_name').then(({ data, error: dErr }) => {
      if (dErr) { setError(dErr.message); setDirectory([]); return }
      setDirectory((data || []).filter(p => !existingMemberIds.includes(p.id)))
    })
  }, [])

  async function addPerson(person) {
    setAddingId(person.id)
    setError('')
    try {
      const { error: mErr } = await supabase
        .from('project_members')
        .insert(scopeIds.map(project_id => ({ project_id, user_id: person.id })))
      if (mErr) throw mErr
      setDirectory(d => d.filter(p => p.id !== person.id))
      onAdded()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingId(null)
    }
  }

  const filtered = (directory || []).filter(p => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
  })

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm p-6 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Add Team Member</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <input
          className="input mb-3" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search the directory..."
        />
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm mb-3">{error}</div>}
        <div className="flex-1 overflow-auto space-y-1 -mx-2 px-2">
          {directory === null && <p className="text-sm text-muted">Loading...</p>}
          {directory !== null && filtered.length === 0 && (
            <p className="text-sm text-muted">{directory.length === 0 ? 'Everyone in the directory is already on this job.' : 'No matches.'}</p>
          )}
          {filtered.map(p => (
            <button
              key={p.id} onClick={() => addPerson(p)} disabled={addingId === p.id}
              className="w-full flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-surface-2 transition-colors text-left disabled:opacity-50"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-bg shrink-0"
                style={{ backgroundColor: p.avatar_color || '#4ade80' }}
              >
                {(p.full_name || p.email || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.full_name || '(no name)'}</p>
                <p className="text-xs text-muted capitalize truncate">{p.role} · {p.email}</p>
              </div>
              <span className="text-xs text-accent shrink-0">{addingId === p.id ? 'Adding...' : '+ Add'}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="btn-secondary w-full mt-4">Done</button>
      </div>
    </div>
  )
}

function ScopeCard({ scope, todaySF, allTimeSF, onClick }) {
  const dailyPct = scope.daily_sf_target > 0
    ? Math.min(100, Math.round((todaySF / scope.daily_sf_target) * 100))
    : 0
  const totalPct = scope.total_sf_target > 0
    ? Math.min(100, Math.round((allTimeSF / scope.total_sf_target) * 100))
    : 0

  return (
    <div
      onClick={onClick}
      className="card hover:bg-surface/80 cursor-pointer transition-all duration-150 group"
      style={{ borderLeftWidth: 4, borderLeftColor: scopeAccentColor(scope.status) }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          {/* The type of work (e.g. "Under Floor Cleaning") is what a
              foreman actually scans for on this card — falls back to the
              scope's own name as the title when no description is set,
              rather than rendering an empty heading. */}
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-accent truncate">
            {scope.description || scope.name}
          </h3>
        </div>
        <span className={`${badgeClass(scope.status)} ml-2 shrink-0 capitalize`}>{scope.status || 'active'}</span>
      </div>

      <div className="bg-surface-2 rounded-lg p-3 mb-3">
        <p className="text-xs text-muted mb-0.5">Total SF Cleaned</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight">
          {allTimeSF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          {scope.total_sf_target > 0 && (
            <span className="text-sm font-normal text-muted"> / {scope.total_sf_target.toLocaleString()}</span>
          )}
          <span className="text-xs font-normal text-muted"> SF</span>
        </p>
      </div>

      {/* Daily progress bar (green) */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted">Daily progress · {todaySF.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF</span>
          <span className={dailyPct >= 100 ? 'text-accent font-medium' : 'text-gray-500 dark:text-gray-400'}>
            {scope.daily_sf_target > 0 ? `${dailyPct}%` : '—'}
          </span>
        </div>
        <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all duration-700" style={{ width: `${dailyPct}%` }} />
        </div>
      </div>

      {/* Total progress bar (blue) */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted">Total progress</span>
          <span className={totalPct >= 100 ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-500 dark:text-gray-400'}>
            {scope.total_sf_target > 0 ? `${totalPct}%` : 'Total target not set'}
          </span>
        </div>
        <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${totalPct}%` }} />
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border">
        {/* No onClick here — a click bubbles up to the card's own onClick
            (the whole card is already the navigation target), so this
            stays a single source of truth for "open this scope" instead
            of two handlers that could drift apart. */}
        <button className="btn-primary w-full flex items-center justify-center gap-1.5">
          Open Scope
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default function JobDetail() {
  const { jobId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [job, setJob] = useState(null)
  const [scopes, setScopes] = useState([])
  const [sfTodayByScope, setSfTodayByScope] = useState({})
  const [sfTotalByScope, setSfTotalByScope] = useState({})
  const [todaySessions, setTodaySessions] = useState([])
  const [recentSessions, setRecentSessions] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [editingJob, setEditingJob] = useState(false)
  const [editName, setEditName] = useState('')
  const [editGc, setEditGc] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [savingJob, setSavingJob] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)

  const canManage = profile?.role === 'admin'
  // Broader than canManage above (job editing stays admin-only) — matches
  // ProjectDetail.jsx's own gate for adding/removing a scope's members.
  const canManageMembers = profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'superintendent'

  async function loadJobDetail() {
    setLoading(true)
    setLoadError('')
    try {
      const [{ data: jobData, error: jobErr }, { data: scopesData, error: scopesErr }] = await Promise.all([
        supabase.from('jobs').select('*, organizations(name)').eq('id', jobId).single(),
        supabase.from('projects').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
      ])
      if (jobErr) throw jobErr
      if (scopesErr) throw scopesErr

      setJob(jobData)
      setScopes(scopesData || [])

      const scopeIds = (scopesData || []).map(s => s.id)
      if (scopeIds.length === 0) {
        setSfTodayByScope({}); setSfTotalByScope({}); setTodaySessions([]); setRecentSessions([]); setMembers([])
        return
      }

      const [{ data: pages }, { data: memberRows }] = await Promise.all([
        supabase.from('pages').select('id, project_id, name').in('project_id', scopeIds),
        supabase.from('project_members').select('user_id, profiles(*)').in('project_id', scopeIds),
      ])

      // Dedupe team members across scopes — the same person is often on
      // more than one scope for the same job.
      const memberMap = new Map()
      ;(memberRows || []).forEach(m => { if (m.profiles) memberMap.set(m.profiles.id, m.profiles) })
      setMembers([...memberMap.values()])

      const pageToScope = {}
      const pageToName = {}
      ;(pages || []).forEach(pg => { pageToScope[pg.id] = pg.project_id; pageToName[pg.id] = pg.name })
      const pageIds = Object.keys(pageToScope)
      if (pageIds.length === 0) {
        setSfTodayByScope({}); setSfTotalByScope({}); setTodaySessions([]); setRecentSessions([])
        return
      }

      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, page_id, sf, work_date, created_at, name, color, profiles(full_name, avatar_color)')
        .in('page_id', pageIds)
        .order('created_at', { ascending: false })

      const scopeNameById = Object.fromEntries((scopesData || []).map(s => [s.id, s.name]))
      const today = new Date().toLocaleDateString('en-CA')
      const todayMap = {}
      const totalMap = {}
      ;(sessions || []).forEach(s => {
        const scopeId = pageToScope[s.page_id]
        if (!scopeId) return
        const sf = parseFloat(s.sf) || 0
        totalMap[scopeId] = (totalMap[scopeId] || 0) + sf
        if (s.work_date === today) todayMap[scopeId] = (todayMap[scopeId] || 0) + sf
      })
      setSfTodayByScope(todayMap)
      setSfTotalByScope(totalMap)

      const withNames = (sessions || []).map(s => ({
        ...s,
        scopeName: scopeNameById[pageToScope[s.page_id]] || 'Unknown scope',
        pageName: pageToName[s.page_id] || 'Unknown sheet',
      }))
      // sessions is already ordered by created_at desc — today's activity is
      // just the subset with work_date === today, so no second round-trip
      // to the database is needed for it.
      setTodaySessions(withNames.filter(s => s.work_date === today))
      setRecentSessions(withNames.slice(0, 15))
    } catch (err) {
      console.error('[JobDetail] loadJobDetail error:', err)
      setLoadError(err.message || 'Failed to load this job. Please try refreshing.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadJobDetail() }, [jobId])

  const location = useJobLocation(job?.address)

  function openEditJob() {
    setEditName(job.name || '')
    setEditGc(job.gc_name || '')
    setEditAddress(job.address || '')
    setEditStatus(job.status || 'active')
    setEditingJob(true)
  }

  async function saveJobInfo() {
    const name = editName.trim()
    if (!name) return
    setSavingJob(true)
    try {
      const patch = {
        name,
        gc_name: editGc.trim() || null,
        address: editAddress.trim() || null,
        status: editStatus,
      }
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId)
      if (error) throw error
      setJob(j => ({ ...j, ...patch }))
      setEditingJob(false)
    } catch (err) {
      console.error('[JobDetail] Failed to save job info:', err)
      alert('Failed to save: ' + (err.message || 'check console'))
    } finally {
      setSavingJob(false)
    }
  }

  const overallTotalSF = Object.values(sfTotalByScope).reduce((sum, sf) => sum + sf, 0)
  const overallTargetSF = scopes.reduce((sum, s) => sum + (parseFloat(s.total_sf_target) || 0), 0)
  const overallPct = overallTargetSF > 0 ? Math.min(100, Math.round((overallTotalSF / overallTargetSF) * 100)) : 0
  const todayTotalSF = todaySessions.reduce((sum, s) => sum + (parseFloat(s.sf) || 0), 0)

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    )
  }

  if (loadError || !job) {
    return (
      <Layout>
        <div className="text-center py-16">
          <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">{loadError ? 'Failed to load job' : 'Job not found'}</p>
          {loadError && <p className="text-sm text-muted mb-4">{loadError}</p>}
          <button onClick={() => navigate('/jobs')} className="btn-secondary">Back to Jobs</button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start gap-3 mb-6">
          <button onClick={() => navigate('/jobs')} className="btn-ghost p-1.5 mt-0.5 shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">{job.organizations?.name}</p>
            {editingJob ? (
                <div className="space-y-1.5 mt-1 max-w-sm">
                  <input
                    autoFocus
                    className="input py-1 text-sm w-full"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="Job name"
                    onKeyDown={e => { if (e.key === 'Escape') setEditingJob(false) }}
                  />
                  <input
                    className="input py-1 text-xs w-full"
                    value={editGc}
                    onChange={e => setEditGc(e.target.value)}
                    placeholder="GC name"
                    onKeyDown={e => { if (e.key === 'Escape') setEditingJob(false) }}
                  />
                  <input
                    className="input py-1 text-xs w-full"
                    value={editAddress}
                    onChange={e => setEditAddress(e.target.value)}
                    placeholder="Address"
                    onKeyDown={e => { if (e.key === 'Escape') setEditingJob(false) }}
                  />
                  <select className="input py-1 text-xs w-full capitalize" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="flex gap-1.5">
                    <button onClick={saveJobInfo} disabled={savingJob || !editName.trim()} className="btn-primary py-0.5 px-2 text-xs flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                      {savingJob ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => setEditingJob(false)} className="btn-ghost py-0.5 px-2 text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">{job.name}</h1>
                    <span className={`${badgeClass(job.status)} capitalize`}>{job.status || 'active'}</span>
                    {canManage && (
                      <button onClick={openEditJob} className="btn-ghost p-0.5 opacity-60 hover:opacity-100" title="Edit job">
                        <svg className="w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
                      </button>
                    )}
                  </div>
                  {job.gc_name && <p className="text-sm text-muted mt-0.5">GC: {job.gc_name}</p>}
                  {job.address && <p className="text-sm text-muted">{job.address}</p>}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Main column starts here, alongside the sidebar (weather/map/team)
            to its right — the overall progress bar lives inside the main
            column now instead of spanning full width above it, so the
            sidebar's top edge lines up with it instead of starting lower. */}
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0 space-y-6">
          {/* Overall job progress — every scope's total SF vs every scope's total target */}
          <div className="card">
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Overall Job Progress</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {overallTotalSF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                {overallTargetSF > 0 && <span className="text-muted font-normal"> / {overallTargetSF.toLocaleString()} SF</span>}
                {overallTargetSF === 0 && <span className="text-muted font-normal"> SF</span>}
              </span>
            </div>
            <div className="h-2.5 bg-surface-3 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${overallPct}%` }} />
            </div>
            {overallTargetSF > 0 && (
              <div className="flex justify-between text-xs mt-1">
                <span className="text-muted">{overallPct}% complete across {scopes.length} {scopes.length === 1 ? 'scope' : 'scopes'}</span>
                {overallPct >= 100 && <span className="text-blue-600 dark:text-blue-400 font-medium">Job complete!</span>}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Scopes</h2>
            {scopes.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 dark:text-gray-400 font-medium">No scopes on this job yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {scopes.map(scope => (
                  <ScopeCard
                    key={scope.id}
                    scope={scope}
                    todaySF={sfTodayByScope[scope.id] || 0}
                    allTimeSF={sfTotalByScope[scope.id] || 0}
                    onClick={() => navigate(`/projects/${scope.id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Today's Activity — every session saved today, across every scope on this job */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Today's Activity</h2>
              {todaySessions.length > 0 && (
                <span className="text-xs text-muted">{todayTotalSF.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF today</span>
              )}
            </div>
            <div className="border border-border rounded-xl overflow-hidden">
              {todaySessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted">No sessions saved yet today</div>
              ) : (
                <div className="divide-y divide-border">
                  {todaySessions.map(session => (
                    <div key={session.id} className="px-4 py-3 flex items-center gap-2.5">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-bg shrink-0"
                        style={{ backgroundColor: session.profiles?.avatar_color || session.color || '#4ade80' }}
                      >
                        {(session.profiles?.full_name || 'U')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{session.profiles?.full_name || 'Unknown'}</p>
                        <p className="text-xs text-muted truncate">{session.scopeName} · {session.pageName}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{(parseFloat(session.sf) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} SF</p>
                        <p className="text-xs text-muted">{session.created_at ? new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent sessions across all scopes (not limited to today) */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Recent Sessions</h2>
            <div className="border border-border rounded-xl overflow-hidden">
              {recentSessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted">No sessions saved yet</div>
              ) : (
                <div className="divide-y divide-border">
                  {recentSessions.map(session => (
                    <div key={session.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: session.color || '#facc15' }} />
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">{session.name || 'Session'}</p>
                      <p className="text-xs text-muted shrink-0 text-right">
                        {[
                          session.profiles?.full_name || 'Unknown',
                          session.scopeName,
                          session.pageName,
                          `${(parseFloat(session.sf) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} SF`,
                          session.created_at ? new Date(session.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Sidebar — weather on top, then a map of the job location, then
              the team members, mirroring the layout of a scope's own
              dashboard (ProjectDetail.jsx). */}
          <div className="lg:w-72 shrink-0 space-y-4">
            <WeatherWidget location={location} />
            <LocationMap location={location} />
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Team Members</h3>
                {canManageMembers && (
                  <button onClick={() => setShowAddMember(true)} className="btn-ghost py-0.5 px-2 text-xs">
                    + Add
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {members.map(member => (
                  <div key={member.id} className="flex items-center gap-2.5 bg-surface-2 rounded-lg p-2.5">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-bg shrink-0"
                      style={{ backgroundColor: member.avatar_color || '#4ade80' }}
                    >
                      {(member.full_name || 'U')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{member.full_name}</p>
                      <p className="text-xs text-muted capitalize">{member.role}</p>
                    </div>
                  </div>
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-muted">No members yet</p>
                )}
              </div>
            </div>
          </div>
        </div>

      {showAddMember && (
        <AddMemberModal
          scopeIds={scopes.map(s => s.id)}
          existingMemberIds={members.map(m => m.id)}
          onClose={() => setShowAddMember(false)}
          onAdded={loadJobDetail}
        />
      )}
    </Layout>
  )
}

