import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const STATUS_OPTIONS = ['active', 'completed', 'on hold']
// A scope's default unit of measure — not every scope is measured in SF
// (e.g. base installation is tracked in linear feet, fixture counts in
// units), so this is what a scope is expected to be tracked in unless a
// given session's markup says otherwise.
const UOM_OPTIONS = ['SF', 'LF', 'Count']
// Austin, TX — used for the weather widget whenever a job has no address
// set yet, so the widget always has something to show rather than an empty
// box.
const DEFAULT_WEATHER_LOCATION = { lat: 30.26, lon: -97.74, label: 'Austin, TX' }

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
}

// Tap-to-change status badge, matching the one already on Projects.jsx —
// same dropdown, same dot colors, so status editing feels identical
// whether you're looking at a job, a scope, or (on that other page) a
// project. e.stopPropagation() throughout because both places this is
// used (the job header, and a scope card) sit inside or next to a
// whole-element onClick (the scope card navigates on click), which would
// otherwise fire every time the badge itself is tapped.
function StatusBadge({ status, onSave, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function select(e, s) {
    e.stopPropagation()
    setOpen(false)
    if (s !== status) await onSave(s)
  }

  return (
    <div ref={ref} className={`relative inline-flex ${className}`} onClick={e => e.stopPropagation()}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className={`${badgeClass(status)} cursor-pointer hover:opacity-80 transition-opacity capitalize`}
      >
        {status}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 min-w-[110px] py-1 overflow-hidden">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={e => select(e, s)}
              className={`w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-surface-2 transition-colors flex items-center gap-2 ${s === status ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-gray-400'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s === 'active' ? 'bg-accent' : s === 'completed' ? 'bg-blue-400' : 'bg-yellow-400'}`} />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
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
          // Nominatim (OpenStreetMap's own geocoder), not Open-Meteo's
          // geocoding API — Open-Meteo only indexes place names (cities,
          // towns, landmarks), not street addresses, so a real job address
          // like "2801 W Bethel Rd, Coppell, TX" returned zero results
          // there every time and silently fell back to the Austin, TX
          // default, which is exactly why the weather/map never matched
          // the address actually set in Project Settings. Nominatim
          // geocodes full street addresses correctly.
          const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`)
          const results = await geoRes.json()
          const match = results?.[0]
          if (match) {
            lat = parseFloat(match.lat); lon = parseFloat(match.lon)
            const city = match.address?.city || match.address?.town || match.address?.village
            label = [city, match.address?.state].filter(Boolean).join(', ') || match.display_name
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
// directory is prefetched by JobDetail's loadJobDetail() alongside
// everything else this page needs, rather than fetched fresh the moment
// this modal opens — the fetch-then-render gap was exactly the "lag then
// pop" the Add Team Member button felt like: the modal appeared instantly
// but sat on a bare "Loading..." for a beat, then the whole list snapped
// in and pushed the modal's height out all at once. With the directory
// already in hand, the modal opens already populated.
function AddMemberModal({ directory, scopeIds, existingMemberIds, onClose, onAdded }) {
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState(null)
  const [error, setError] = useState('')
  const [added, setAdded] = useState([]) // ids added this session, hidden immediately without waiting on onAdded's reload

  async function addPerson(person) {
    setAddingId(person.id)
    setError('')
    try {
      const { error: mErr } = await supabase
        .from('project_members')
        .insert(scopeIds.map(project_id => ({ project_id, user_id: person.id })))
      if (mErr) throw mErr
      setAdded(a => [...a, person.id])
      onAdded()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingId(null)
    }
  }

  const available = (directory || []).filter(p => !existingMemberIds.includes(p.id) && !added.includes(p.id))
  const filtered = available.filter(p => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
  })

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-sm p-6 max-h-[80vh] flex flex-col">
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
          {filtered.length === 0 && (
            <p className="text-sm text-muted">{available.length === 0 ? 'Everyone in the directory is already on this job.' : 'No matches.'}</p>
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

function AddScopeModal({ jobId, userId, existingMemberIds, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', status: 'active', uom: 'SF', daily_sf_target: '', total_sf_target: '', cost: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // name and description end up holding the same text — the scope
      // card's title reads description first, falling back to name, and
      // splitting one "what is this scope" answer across two fields that
      // said the same thing (e.g. "Final Clean" / "Final Clean") read as
      // a bug, not a feature. Keeping both columns in sync means it never
      // matters which one anything else in the app happens to read.
      const trimmedName = form.name.trim()
      const { data: scope, error: sErr } = await supabase
        .from('projects')
        .insert({
          job_id: jobId,
          name: trimmedName,
          description: trimmedName,
          status: form.status,
          uom: form.uom,
          daily_sf_target: parseFloat(form.daily_sf_target) || 0,
          total_sf_target: parseFloat(form.total_sf_target) || 0,
          cost: form.cost === '' ? null : parseFloat(form.cost) || null,
          created_by: userId,
        })
        .select()
        .single()
      if (sErr) throw sErr

      // Carry over the job's existing team (plus whoever's creating this,
      // in case they're not on it yet) rather than starting the new scope
      // with zero members — otherwise it'd be invisible to everyone
      // already working this job until someone remembered to add them
      // back one at a time.
      const memberIds = [...new Set([...existingMemberIds, userId])]
      const { error: mErr } = await supabase
        .from('project_members')
        .insert(memberIds.map(user_id => ({ project_id: scope.id, user_id })))
      if (mErr && !mErr.message.includes('duplicate key')) throw mErr

      onCreated(scope)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">New Scope</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Scope Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Final Clean, Under Floor Cleaning" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select className="input capitalize" value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Unit of Measure</label>
              <select className="input" value={form.uom} onChange={e => set('uom', e.target.value)}>
                {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Daily {form.uom} Target</label>
              <input className="input" type="number" min="0" value={form.daily_sf_target} onChange={e => set('daily_sf_target', e.target.value)} placeholder="5000" />
            </div>
            <div>
              <label className="label">Total {form.uom} Target</label>
              <input className="input" type="number" min="0" value={form.total_sf_target} onChange={e => set('total_sf_target', e.target.value)} placeholder="e.g. 250000" />
            </div>
          </div>
          <div>
            <label className="label">Contract Cost ($)</label>
            <input className="input" type="number" min="0" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="e.g. 500000" />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading || !form.name.trim()} className="btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Scope'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ScopeSettingsModal({ scope, onClose, onSaved }) {
  // Pre-filled with whichever of name/description the card is actually
  // showing as its title (see ScopeCard) — what you see is what you edit,
  // and saving writes the same text back to both columns (see handleSubmit)
  // so the two can't drift apart into two different answers to the same
  // "what is this scope" question again.
  const [name, setName] = useState(scope.description || scope.name || '')
  const [status, setStatus] = useState(scope.status || 'active')
  const [uom, setUom] = useState(scope.uom || 'SF')
  const [dailyTarget, setDailyTarget] = useState(scope.daily_sf_target ?? '')
  const [totalTarget, setTotalTarget] = useState(scope.total_sf_target ?? '')
  const [cost, setCost] = useState(scope.cost ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setError('')
    try {
      const patch = {
        name: trimmedName,
        description: trimmedName,
        status,
        uom,
        daily_sf_target: parseFloat(dailyTarget) || 0,
        total_sf_target: parseFloat(totalTarget) || 0,
        cost: cost === '' ? null : (parseFloat(cost) || null),
      }
      // .select().single() the same way JobSettingsModal does — a blocked
      // update should surface as a real error, not silently revert the
      // next time this job's scopes are reloaded.
      const { data, error: sErr } = await supabase.from('projects').update(patch).eq('id', scope.id).select().single()
      if (sErr) throw sErr
      if (!data) throw new Error('Nothing was saved — you may not have permission to edit this scope.')
      onSaved(patch)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Scope Settings</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Scope Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Final Clean, Under Floor Cleaning" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select className="input capitalize" value={status} onChange={e => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              {/* Not every scope is measured in square feet — base install
                  is tracked in linear feet, fixture counts in units, etc.
                  This is what a session in this scope defaults to unless
                  its own markup says otherwise. */}
              <label className="label">Unit of Measure</label>
              <select className="input" value={uom} onChange={e => setUom(e.target.value)}>
                {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Daily {uom} Target</label>
              <input className="input" type="number" min="0" value={dailyTarget} onChange={e => setDailyTarget(e.target.value)} placeholder="5000" />
            </div>
            <div>
              <label className="label">Total {uom} Target</label>
              <input className="input" type="number" min="0" value={totalTarget} onChange={e => setTotalTarget(e.target.value)} placeholder="e.g. 250000" />
            </div>
          </div>
          <div>
            <label className="label">Contract Cost ($)</label>
            <input className="input" type="number" min="0" value={cost} onChange={e => setCost(e.target.value)} placeholder="e.g. 500000" />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving || !name.trim()} className="btn-primary flex-1">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function JobSettingsModal({ job, onClose, onSaved }) {
  const [name, setName] = useState(job.name || '')
  const [gcName, setGcName] = useState(job.gc_name || '')
  const [address, setAddress] = useState(job.address || '')
  const [status, setStatus] = useState(job.status || 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setError('')
    try {
      const patch = {
        name: trimmedName,
        gc_name: gcName.trim() || null,
        address: address.trim() || null,
        status,
      }
      // .select().single() on purpose — a plain .update() with no .select()
      // returns success with an empty result if RLS blocks the row (a
      // WHERE/policy match of zero rows is not an error to Postgres), which
      // is exactly why this looked like it saved (the local onSaved(patch)
      // below still ran) but reverted the moment the job was reloaded from
      // the database. Asking for the row back turns that silent no-op into
      // a real, visible error instead.
      const { data, error: sErr } = await supabase.from('jobs').update(patch).eq('id', job.id).select().single()
      if (sErr) throw sErr
      if (!data) throw new Error('Nothing was saved — you may not have permission to edit this job (check the jobs table\'s RLS update policy).')
      onSaved(patch)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Project Settings</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Job Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Job name" required />
          </div>
          <div>
            <label className="label">GC Name</label>
            <input className="input" value={gcName} onChange={e => setGcName(e.target.value)} placeholder="e.g. DPR Construction" />
          </div>
          <div>
            <label className="label">Project Address</label>
            <input className="input" value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. 123 Main St, Dallas, TX" />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input capitalize" value={status} onChange={e => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving || !name.trim()} className="btn-primary flex-1">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ScopeCard({ scope, todaySF, allTimeSF, onClick, onUpdateStatus, onOpenSettings, canManageScope }) {
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
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <StatusBadge
            status={scope.status || 'active'}
            onSave={s => onUpdateStatus(scope.id, s)}
          />
          {canManageScope && (
            <button
              onClick={e => { e.stopPropagation(); onOpenSettings(scope) }}
              className="btn-ghost p-1 opacity-60 hover:opacity-100"
              title="Scope settings"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="bg-surface-2 rounded-lg p-3 mb-3">
        <p className="text-xs text-muted mb-0.5">Total SF</p>
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
  const { profile, user } = useAuth()
  const navigate = useNavigate()

  const [job, setJob] = useState(null)
  const [scopes, setScopes] = useState([])
  const [sfTodayByScope, setSfTodayByScope] = useState({})
  const [sfTotalByScope, setSfTotalByScope] = useState({})
  const [todaySessions, setTodaySessions] = useState([])
  const [recentSessions, setRecentSessions] = useState([])
  const [members, setMembers] = useState([])
  const [directory, setDirectory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [showJobSettings, setShowJobSettings] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showAddScope, setShowAddScope] = useState(false)
  const [scopeSettingsTarget, setScopeSettingsTarget] = useState(null)

  const canManage = profile?.role === 'admin'
  // Broader than canManage above (job editing stays admin-only) — matches
  // ProjectDetail.jsx's own gate for adding/removing a scope's members.
  const canManageMembers = profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'superintendent'
  // Matches Projects.jsx's own gate for creating a project — a scope is a
  // projects row under the hood, same permission level applies.
  const canCreateScope = profile?.role === 'admin' || profile?.role === 'pm'

  async function loadJobDetail() {
    setLoading(true)
    setLoadError('')
    try {
      // The profile directory (for Add Team Member) is fetched here, up
      // front with everything else this page needs, rather than only once
      // that modal opens — an org's directory doesn't change mid-visit, so
      // there's no reason to make "+ Add" wait on a fresh fetch every time.
      const [{ data: jobData, error: jobErr }, { data: scopesData, error: scopesErr }, { data: directoryData }] = await Promise.all([
        supabase.from('jobs').select('*, organizations(name)').eq('id', jobId).single(),
        supabase.from('projects').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
        supabase.from('profiles').select('*').order('full_name'),
      ])
      if (jobErr) throw jobErr
      if (scopesErr) throw scopesErr

      setJob(jobData)
      setScopes(scopesData || [])
      setDirectory(directoryData || [])

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

  // Scope status lives on the projects table, which every other status
  // edit in the app (Projects.jsx, ProjectDetail.jsx) already writes to
  // successfully with a plain .update() and no .select() — unlike jobs
  // (see JobSettingsModal/updateJobStatus below), there's no reason to
  // suspect its RLS is missing an UPDATE policy.
  async function updateScopeStatus(scopeId, status) {
    const { error } = await supabase.from('projects').update({ status }).eq('id', scopeId)
    if (error) { alert('Failed to update status: ' + error.message); return }
    setScopes(ss => ss.map(s => s.id === scopeId ? { ...s, status } : s))
  }

  // jobs is a newer table than projects and was confirmed to have at
  // least one missing/broken RLS policy already (see JobSettingsModal) —
  // .select().single() here for the same reason: surface a blocked update
  // as a real error instead of silently reverting on the next reload.
  async function updateJobStatus(status) {
    const { data, error } = await supabase.from('jobs').update({ status }).eq('id', jobId).select().single()
    if (error) { alert('Failed to update status: ' + error.message); return }
    if (!data) { alert('Nothing was saved — you may not have permission to edit this job.'); return }
    setJob(j => ({ ...j, status }))
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
      {/* Header sits in its own, tighter-padded strip — closer to the true
          screen edge than the roomier main content below, matching the
          back-button-near-the-edge feel of a native app rather than
          matching the wide gutters the cards/sidebar use. */}
      <div className="px-4 sm:px-6 pt-6">
        <div className="flex items-start gap-3 mb-6">
          <button onClick={() => navigate('/jobs')} className="btn-ghost p-1.5 mt-2 shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            {/* GC name / address stay in Project Settings only for now
                (not shown here) — flagged as not wanted under the job
                name in the header. */}
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{job.name}</h1>
              <StatusBadge status={job.status || 'active'} onSave={updateJobStatus} />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-16 pb-8">
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
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Scopes</h2>
              {canCreateScope && (
                <button onClick={() => setShowAddScope(true)} className="btn-primary py-1 px-2.5 text-xs flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add Scope
                </button>
              )}
            </div>
            {scopes.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 dark:text-gray-400 font-medium">No scopes on this job yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {scopes.map(scope => (
                  <ScopeCard
                    key={scope.id}
                    scope={scope}
                    todaySF={sfTodayByScope[scope.id] || 0}
                    allTimeSF={sfTotalByScope[scope.id] || 0}
                    onClick={() => navigate(`/projects/${scope.id}`)}
                    onUpdateStatus={updateScopeStatus}
                    onOpenSettings={setScopeSettingsTarget}
                    canManageScope={canCreateScope}
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

            {canManage && (
              <button
                onClick={() => setShowJobSettings(true)}
                className="flex items-center gap-2 text-xs text-muted hover:text-gray-700 dark:hover:text-gray-300 transition-colors pt-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Project Settings
              </button>
            )}
          </div>
        </div>
      </div>

      {showAddMember && (
        <AddMemberModal
          directory={directory}
          scopeIds={scopes.map(s => s.id)}
          existingMemberIds={members.map(m => m.id)}
          onClose={() => setShowAddMember(false)}
          onAdded={loadJobDetail}
        />
      )}
      {showJobSettings && (
        <JobSettingsModal
          job={job}
          onClose={() => setShowJobSettings(false)}
          onSaved={patch => setJob(j => ({ ...j, ...patch }))}
        />
      )}
      {showAddScope && (
        <AddScopeModal
          jobId={jobId}
          userId={user.id}
          existingMemberIds={members.map(m => m.id)}
          onClose={() => setShowAddScope(false)}
          onCreated={loadJobDetail}
        />
      )}
      {scopeSettingsTarget && (
        <ScopeSettingsModal
          scope={scopeSettingsTarget}
          onClose={() => setScopeSettingsTarget(null)}
          onSaved={patch => setScopes(ss => ss.map(s => s.id === scopeSettingsTarget.id ? { ...s, ...patch } : s))}
        />
      )}
    </Layout>
  )
}

