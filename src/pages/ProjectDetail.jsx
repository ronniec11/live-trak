import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Layout from '../components/Layout'
import MemberCardModal from '../components/MemberCardModal'
import ScopeSettingsModal from '../components/ScopeSettingsModal'
import UomProgressBar from '../components/UomProgressBar'
import WeatherWidget, { useJobLocation } from '../components/WeatherWidget'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'
import { getCachedJobDetail } from '../lib/offlineCache'
import { limitError } from '../lib/planLimits'

const STATUS_OPTIONS = ['active', 'completed', 'on hold']

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
}

// Same shape-handling as Reports.jsx's countItemsFor — count_data is a
// bare array of markers on older sessions, or {markers, w, h} on newer
// ones (added once the count tool started needing to rescale markers
// against a resized image).
function countItemsFor(countData) {
  if (Array.isArray(countData)) return countData.length
  return countData?.markers?.length ?? 0
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
  if (status === 'completed') return '#3b82f6'
  return '#f97316' // on hold
}

// Raw OSM tiles — no API key, ever. (CartoDB's free anonymous basemap
// tiles, used here briefly, started demanding a Carto API key with no
// warning — the "API KEY REQUIRED" watermark that broke both light AND
// dark once that changed is exactly why this doesn't depend on a second
// tile provider that could pull the same trick.) Dark mode reuses these
// same tiles: a grayscale+invert filter on the tile pane gets them dark
// with real tonal variation (roads vs. water vs. land), then a flat navy
// overlay in 'color' blend mode recolors that grayscale into the app's own
// --color-bg navy instead of a generic desaturated dark — blend-mode
// 'color' takes hue/saturation from the overlay and keeps luminosity from
// the tiles underneath, so it tints without flattening the map into a
// single shade.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const DARK_TILE_FILTER = 'grayscale(1) invert(1) brightness(1.05) contrast(1.05)'

function appNavy() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
  return raw ? `rgb(${raw.replace(/\s+/g, ' ')})` : 'rgb(20 22 40)'
}

// Shared by the small sidebar preview and the enlarged modal — each gets
// its own Leaflet instance (a map is bound to one DOM node for life).
function LocationMapView({ location, theme, interactive, height }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const tintRef = useRef(null)

  useEffect(() => {
    if (location.status !== 'ready' || !elRef.current || mapRef.current) return
    const { lat, lon } = location
    const map = L.map(elRef.current, {
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive, // only the enlarged/interactive map takes over the scroll wheel — the small preview shouldn't hijack page scroll
      doubleClickZoom: interactive,
      touchZoom: interactive,
      keyboard: interactive,
      attributionControl: interactive,
    }).setView([lat, lon], 15)
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map)
    L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#4f46e5', fillOpacity: 1 }).addTo(map)
    const tint = document.createElement('div')
    // z-index 450: Leaflet's own .leaflet-map-pane carries z-index 400 (via
    // its .leaflet-pane class) — a lower value here renders invisibly
    // behind the whole map instead of tinting it, confirmed with a local
    // repro against real Leaflet DOM output. 450 clears that but stays
    // below the marker/tooltip/popup/control panes (500-800).
    tint.style.cssText = 'position:absolute;inset:0;pointer-events:none;mix-blend-mode:color;z-index:450;opacity:0'
    map.getContainer().appendChild(tint)
    tintRef.current = tint
    mapRef.current = map
    // The modal's map mounts while its open transition may still be
    // resolving layout, so its container can report a stale (often zero)
    // size at creation time — nudge Leaflet to re-measure after paint.
    requestAnimationFrame(() => map.invalidateSize())
    return () => { map.remove(); mapRef.current = null; tintRef.current = null }
  }, [location.status, location.lat, location.lon])

  useEffect(() => {
    const pane = mapRef.current?.getPane('tilePane')
    if (pane) pane.style.filter = theme === 'dark' ? DARK_TILE_FILTER : ''
    if (tintRef.current) {
      tintRef.current.style.background = appNavy()
      tintRef.current.style.opacity = theme === 'dark' ? '1' : '0'
    }
  }, [theme, location.status])

  if (location.status !== 'ready') {
    return <div className="bg-surface-2 animate-pulse" style={{ height, width: '100%' }} />
  }
  return <div ref={elRef} style={{ height, width: '100%' }} />
}

// Leaflet's tile layer runs on CSS transforms for panning, which puts it in
// its own compositing layer — in some browsers that layer paints in front
// of ANY fixed backdrop-blur overlay instead of getting blurred/dimmed with
// the rest of the page behind it. That's not specific to the map's own
// enlarge modal — it happens behind every modal in the app (profile,
// project/scope settings, add member, ...), since they're all separate
// component trees the map has no direct relationship with. Rather than
// teach every modal about the map, this watches the DOM for the one thing
// they all already share — the .modal-backdrop class (see index.css) —
// and the widget hides itself whenever any of them is open, anywhere on
// the page, present or future.
function useAnyModalOpen() {
  const [open, setOpen] = useState(() => !!document.querySelector('.modal-backdrop'))
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector('.modal-backdrop'))
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    check()
    return () => observer.disconnect()
  }, [])
  return open
}

// The sidebar widget is a static preview (no drag/zoom of its own — there's
// no room to usefully pan around in 160px) that opens a full, interactive
// map in a modal on click; clicking off the modal closes it, matching every
// other modal in the app (see ScopeSettingsModal's backdrop/panel split).
function LocationMap({ location }) {
  const { theme } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const anyModalOpen = useAnyModalOpen()

  if (location.status !== 'ready') {
    return <div className="rounded-xl border border-border overflow-hidden elevated h-40 bg-surface-2 animate-pulse" />
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(true)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true) } }}
        aria-label="Open map"
        // expanded covers this widget's own modal the instant it opens
        // (synchronous with render); anyModalOpen covers every other modal
        // via the MutationObserver above, which fires a beat later.
        style={{ visibility: (expanded || anyModalOpen) ? 'hidden' : 'visible' }}
        className="relative block w-full rounded-xl border border-border overflow-hidden elevated cursor-pointer group"
      >
        <LocationMapView location={location} theme={theme} interactive={false} height={160} />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/60 text-white text-[10px] px-1.5 py-0.5 leading-none pointer-events-none">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
          </svg>
          Tap to enlarge
        </div>
      </div>

      {expanded && (
        <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setExpanded(false)}>
          <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white truncate pr-2">{location.label}</h2>
              <button onClick={() => setExpanded(false)} className="btn-ghost p-1.5 shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <LocationMapView location={location} theme={theme} interactive height={480} />
          </div>
        </div>
      )}
    </>
  )
}

// Adding someone here inserts one job_members row (see
// supabase-migration-job-members.sql) — an independent job-level roster,
// not derived from scope membership, and doesn't touch any scope's own
// membership either. Being on the project doesn't put someone on every
// scope automatically (not every superintendent works every scope of a
// job) — that's chosen per scope, at scope creation (AddScopeModal) or
// after, from the scope's own Add Scope Member. The one auto-sync that
// does still happen is the other direction: adding someone to a scope
// adds them to the project too, since working a scope obviously means
// working the job.
// directory is prefetched by JobDetail's loadJobDetail() alongside
// everything else this page needs, rather than fetched fresh the moment
// this modal opens — the fetch-then-render gap was exactly the "lag then
// pop" the Add Team Member button felt like: the modal appeared instantly
// but sat on a bare "Loading..." for a beat, then the whole list snapped
// in and pushed the modal's height out all at once. With the directory
// already in hand, the modal opens already populated.
function AddMemberModal({ directory, jobId, existingMemberIds, onClose, onAdded }) {
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState(null)
  const [error, setError] = useState('')
  const [added, setAdded] = useState([]) // ids added this session, hidden immediately without waiting on onAdded's reload

  async function addPerson(person) {
    setAddingId(person.id)
    setError('')
    try {
      const { error: mErr } = await supabase
        .from('job_members')
        .insert({ job_id: jobId, user_id: person.id })
      // Already a member (e.g. the list was stale) — treat it as success
      // rather than surfacing a raw constraint error for something that's
      // already true.
      if (mErr && !mErr.message.includes('duplicate key')) throw mErr
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
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-sm p-6 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Add Project Member</h2>
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

function AddScopeModal({ jobId, job, currentScopeCount, userId, members, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', status: 'active', cost: '' })
  // Deliberately opt-in, not "everyone on the job" — a scope's crew isn't
  // always the whole project team (e.g. one superintendent only ever
  // looks after one particular scope), so a new scope starts empty
  // except for whoever's creating it, picked here rather than inherited.
  const [selectedMemberIds, setSelectedMemberIds] = useState([userId])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function toggleMember(id) {
    setSelectedMemberIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const scopeLimitMsg = limitError(job?.organizations, 'maxScopesPerJob', currentScopeCount)
    if (scopeLimitMsg) { setError(scopeLimitMsg); return }
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
          cost: form.cost === '' ? null : parseFloat(form.cost) || null,
          created_by: userId,
        })
        .select()
        .single()
      if (sErr) throw sErr

      if (selectedMemberIds.length > 0) {
        const { error: mErr } = await supabase
          .from('project_members')
          .insert(selectedMemberIds.map(user_id => ({ project_id: scope.id, user_id })))
        if (mErr && !mErr.message.includes('duplicate key')) throw mErr
      }

      onCreated(scope)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
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
          <div>
            <label className="label">Status</label>
            <select className="input capitalize" value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Contract Cost ($)</label>
            <input className="input" type="number" min="0" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="e.g. 500000" />
          </div>
          <div>
            <label className="label">Scope Members</label>
            <p className="text-xs text-muted mb-1.5">
              Not every project member has to be on every scope — pick who's actually working this one. You can add or remove people later from the scope's own page.
            </p>
            {members.length === 0 ? (
              <p className="text-xs text-muted">No project members yet — add some from the sidebar first, or add them to this scope afterward.</p>
            ) : (
              <div className="space-y-0.5 max-h-40 overflow-y-auto border border-border rounded-lg p-1.5">
                {members.map(m => (
                  <label key={m.id} className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-surface-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={selectedMemberIds.includes(m.id)} onChange={() => toggleMember(m.id)} />
                    <span className="truncate text-gray-800 dark:text-gray-200">{m.full_name}</span>
                    <span className="text-xs text-muted capitalize ml-auto shrink-0">{m.role}</span>
                  </label>
                ))}
              </div>
            )}
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

function JobSettingsModal({ job, onClose, onSaved }) {
  const [name, setName] = useState(job.name || '')
  const [gcName, setGcName] = useState(job.gc_name || '')
  const [ownerName, setOwnerName] = useState(job.owner_name || '')
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
        owner_name: ownerName.trim() || null,
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
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
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
            <label className="label">Project Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Job name" required />
          </div>
          <div>
            <label className="label">General Contractor</label>
            <input className="input" value={gcName} onChange={e => setGcName(e.target.value)} placeholder="e.g. DPR Construction" />
          </div>
          <div>
            <label className="label">Owner</label>
            <input className="input" value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="e.g. Bosque" />
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

const GripIcon = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
    <circle cx="6" cy="5" r="1.4" /><circle cx="14" cy="5" r="1.4" />
    <circle cx="6" cy="10" r="1.4" /><circle cx="14" cy="10" r="1.4" />
    <circle cx="6" cy="15" r="1.4" /><circle cx="14" cy="15" r="1.4" />
  </svg>
)

function ScopeCard({ scope, dailyGroups, totalGroups, onClick, onUpdateStatus, onOpenSettings, canManageScope, canReorder, isDragging, isDropTarget, onDragStart }) {
  const [pressing, setPressing] = useState(false)

  // Long-press-anywhere-on-the-card reorder trigger, same pattern as the
  // Scopes list's own project cards — the grip handle alone is too small a
  // target to hit reliably with a fingertip. Holding still for ~450ms
  // starts the drag; a normal tap or a swipe past a small threshold
  // cancels it and behaves as a plain click.
  const longPressTimerRef = useRef(null)
  const pointerStartRef = useRef(null)
  const longPressFiredRef = useRef(false)

  function clearLongPress() {
    clearTimeout(longPressTimerRef.current)
    pointerStartRef.current = null
    setPressing(false)
  }

  function handleCardPointerDown(e) {
    if (!canReorder) return
    if (e.target.closest('button, input, textarea, a')) return
    pointerStartRef.current = { x: e.clientX, y: e.clientY }
    longPressFiredRef.current = false
    setPressing(true)
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true
      setPressing(false)
      onDragStart(e, scope.id)
    }, 450)
  }

  function handleCardPointerMove(e) {
    if (!pointerStartRef.current) return
    const dx = e.clientX - pointerStartRef.current.x
    const dy = e.clientY - pointerStartRef.current.y
    if (Math.hypot(dx, dy) > 10) clearLongPress()
  }

  function handleCardClick(e) {
    // Swallow the click that follows a long-press-triggered drag so it
    // doesn't also navigate into the scope right as the user meant to
    // pick it up.
    if (longPressFiredRef.current) {
      e.preventDefault(); e.stopPropagation()
      longPressFiredRef.current = false
      return
    }
    onClick?.(e)
  }

  return (
    <div
      data-scope-id={scope.id}
      onPointerDown={handleCardPointerDown}
      onPointerMove={handleCardPointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onClick={handleCardClick}
      className={`card hover:bg-surface/80 cursor-pointer transition-all duration-150 group select-none ${
        isDragging ? 'opacity-40' : ''
      } ${isDropTarget ? 'ring-2 ring-accent' : ''} ${pressing ? 'scale-[0.98]' : ''}`}
      style={{ borderLeftWidth: 4, borderLeftColor: scopeAccentColor(scope.status), WebkitTouchCallout: 'none' }}
    >
      <div className="flex items-start justify-between mb-3">
        {canReorder && (
          <button
            onPointerDown={e => { e.stopPropagation(); onDragStart(e, scope.id) }}
            onClick={e => e.stopPropagation()}
            className="btn-ghost p-1 mr-1 -ml-1 shrink-0 cursor-grab active:cursor-grabbing text-muted"
            style={{ touchAction: 'none' }}
            title="Drag to reorder"
          >
            <GripIcon />
          </button>
        )}
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

      {/* Daily/Total Progress — each one bar, split into a compartment per
          unit present, percentage only (no actual/target numbers — those
          are a click away on the scope's own page). */}
      <div className="mb-3">
        <span className="text-xs text-muted font-medium block mb-1.5">Daily Progress</span>
        <UomProgressBar groups={dailyGroups} showValues={false} />
      </div>
      <div>
        <span className="text-xs text-muted font-medium block mb-1.5">Total Progress</span>
        <UomProgressBar groups={totalGroups} showValues={false} />
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

export default function ProjectDetail() {
  const { jobId } = useParams()
  const { profile, user } = useAuth()
  const navigate = useNavigate()

  const [job, setJob] = useState(null)
  const [scopes, setScopes] = useState([])
  // scope.id -> [{unit, value, target, pct}, ...] — one entry per distinct
  // unit_of_measure among that scope's own pages (Sheet Settings), rolled
  // up from every session on those pages.
  const [dailyGroupsByScope, setDailyGroupsByScope] = useState({})
  const [totalGroupsByScope, setTotalGroupsByScope] = useState({})
  const [todaySessions, setTodaySessions] = useState([])
  const [recentSessions, setRecentSessions] = useState([])
  const [members, setMembers] = useState([])
  const [directory, setDirectory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [offlineMode, setOfflineMode] = useState(false)
  const [notCachedOffline, setNotCachedOffline] = useState(false)

  const [showJobSettings, setShowJobSettings] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showJobProgressDetail, setShowJobProgressDetail] = useState(false)
  const [memberCardTarget, setMemberCardTarget] = useState(null)
  const [showAddScope, setShowAddScope] = useState(false)
  const [scopeSettingsTarget, setScopeSettingsTarget] = useState(null)

  const canManage = profile?.role === 'admin' || profile?.role === 'pm'
  // Matches canManage above — a PM can also see/edit Project Settings now.
  const canManageMembers = profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'superintendent'
  // Matches Projects.jsx's own gate for creating a project — a scope is a
  // projects row under the hood, same permission level applies.
  const canCreateScope = profile?.role === 'admin' || profile?.role === 'pm'
  // Same role gate as the Scopes list's own drag-to-reorder.
  const canReorderScope = canManageMembers

  const [dragScopeId, setDragScopeId] = useState(null)
  const [dragScopePos, setDragScopePos] = useState({ x: 0, y: 0 })
  const [hoverScopeId, setHoverScopeId] = useState(null)
  const [scopeReorderError, setScopeReorderError] = useState('')

  function handleScopeDragStart(e, scopeId) {
    setDragScopeId(scopeId)
    setDragScopePos({ x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!dragScopeId) return

    function onMove(e) {
      setDragScopePos({ x: e.clientX, y: e.clientY })
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const target = el?.closest('[data-scope-id]')
      const targetId = target?.getAttribute('data-scope-id')
      setHoverScopeId(targetId && targetId !== dragScopeId ? targetId : null)
    }

    async function onUp() {
      const droppedOnId = hoverScopeId
      const draggedId = dragScopeId
      setDragScopeId(null)
      setHoverScopeId(null)
      if (!droppedOnId) return

      const fromIdx = scopes.findIndex(s => s.id === draggedId)
      const toIdx = scopes.findIndex(s => s.id === droppedOnId)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
      const reordered = [...scopes]
      const [moved] = reordered.splice(fromIdx, 1)
      reordered.splice(toIdx, 0, moved)
      setScopes(reordered)

      // Reuses the projects table's own set_project_sort_order RPC — a
      // scope is a projects row under the hood (see canCreateScope above),
      // so there's no separate reorder function to maintain for it.
      try {
        const results = await Promise.all(
          reordered.map((s, idx) => supabase.rpc('set_project_sort_order', { target_project_id: s.id, new_order: idx }))
        )
        const failedRpc = results.find(r => r?.error)
        const noOpRpc = results.find(r => !r?.error && r?.data === false)
        if (failedRpc) {
          console.error('[JobDetail] set_project_sort_order failed:', failedRpc.error)
          setScopeReorderError('Reordering was not saved: ' + (failedRpc.error.message || 'unknown error'))
          return
        }
        if (noOpRpc) {
          console.error('[JobDetail] set_project_sort_order ran but updated no row (role check failed).')
          setScopeReorderError('Reordering was not saved — your account role is not allowed to reorder scopes.')
          return
        }
        setScopes(ss => ss.map((s, idx) => ({ ...s, sort_order: idx })))
      } catch (err) {
        console.error('[JobDetail] Scope reorder save threw:', err)
        setScopeReorderError('Reordering failed to save: ' + (err.message || String(err)))
      }
    }

    function preventScroll(e) { e.preventDefault() }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('touchmove', preventScroll, { passive: false })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('touchmove', preventScroll)
    }
  }, [dragScopeId, hoverScopeId, scopes])

  async function loadJobDetail() {
    setLoading(true)
    setLoadError('')
    setOfflineMode(false)
    setNotCachedOffline(false)
    try {
      // The profile directory (for Add Team Member) is fetched here, up
      // front with everything else this page needs, rather than only once
      // that modal opens — an org's directory doesn't change mid-visit, so
      // there's no reason to make "+ Add" wait on a fresh fetch every time.
      const [{ data: jobData, error: jobErr }, scopesRes, { data: directoryData }, memberRes] = await Promise.all([
        supabase.from('jobs').select('*, organizations(name, plan, unlimited_until)').eq('id', jobId).single(),
        supabase.from('projects').select('*').eq('job_id', jobId).order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
        supabase.from('profiles').select('*').order('full_name'),
        // job_members is its own independent roster (see
        // supabase-migration-job-members.sql), not derived from scope
        // membership — someone stays a Project Member even if later
        // removed from every scope under this job. Plain user_id list,
        // not an embedded profiles(*) join — job_members is a brand new
        // table and PostgREST's schema cache doesn't always pick up a
        // new table's relationships right away, which silently failed
        // the embed (and so the whole member list) with no error surfaced.
        // Matching against directoryData (already fetched above) instead
        // sidesteps that entirely.
        supabase.from('job_members').select('user_id').eq('job_id', jobId),
      ])
      if (jobErr) throw jobErr
      if (scopesRes.error) throw scopesRes.error
      const scopesData = scopesRes.data

      setJob(jobData)
      setScopes(scopesData || [])
      // Excludes anyone removed from the team (see Team.jsx) — filtered
      // client-side rather than with .eq('active', true) so this still
      // works before supabase-migration-team-active.sql has been run
      // (active is undefined on every row until then, which reads as
      // "not removed" here, same as PersonCard/Team.jsx's own check).
      setDirectory((directoryData || []).filter(p => p.active !== false))
      if (memberRes.error) console.error('[JobDetail] job_members fetch failed:', memberRes.error)
      const memberUserIds = new Set((memberRes.data || []).map(m => m.user_id))
      setMembers((directoryData || []).filter(p => memberUserIds.has(p.id)))

      const scopeIds = (scopesData || []).map(s => s.id)
      if (scopeIds.length === 0) {
        setDailyGroupsByScope({}); setTotalGroupsByScope({}); setTodaySessions([]); setRecentSessions([])
        return
      }

      const { data: pages } = await supabase
        .from('pages').select('id, project_id, name, unit_of_measure, daily_target, total_target').in('project_id', scopeIds)

      const pageToScope = {}
      const pageToName = {}
      ;(pages || []).forEach(pg => { pageToScope[pg.id] = pg.project_id; pageToName[pg.id] = pg.name })
      const pageIds = Object.keys(pageToScope)
      if (pageIds.length === 0) {
        setDailyGroupsByScope({}); setTotalGroupsByScope({}); setTodaySessions([]); setRecentSessions([])
        return
      }

      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, page_id, sf, lf, count_data, work_date, created_at, name, color, profiles(full_name, avatar_color)')
        .in('page_id', pageIds)
        .order('created_at', { ascending: false })

      const scopeNameById = Object.fromEntries((scopesData || []).map(s => [s.id, s.name]))
      const today = new Date().toLocaleDateString('en-CA')

      // Grouped by each page's OWN unit (Sheet Settings) — a scope's pages
      // can each track a different unit now, so this rolls up target/actual
      // per unit, per scope, computed here across every scope on this job
      // at once.
      const pageUnitById = {}
      const groupByScope = {} // scopeId -> unit -> { dailyTarget, totalTarget, dailyValue, totalValue }
      ;(pages || []).forEach(pg => {
        const u = pg.unit_of_measure || 'SF'
        pageUnitById[pg.id] = u
        const scopeId = pg.project_id
        if (!groupByScope[scopeId]) groupByScope[scopeId] = {}
        if (!groupByScope[scopeId][u]) groupByScope[scopeId][u] = { dailyTarget: 0, totalTarget: 0, dailyValue: 0, totalValue: 0 }
        groupByScope[scopeId][u].dailyTarget += pg.daily_target || 0
        groupByScope[scopeId][u].totalTarget += pg.total_target || 0
      })
      const pageUnitValue = (s, uom) => uom === 'LF' ? (parseFloat(s.lf) || 0)
        : uom === 'each' ? countItemsFor(s.count_data)
        : (parseFloat(s.sf) || 0)
      ;(sessions || []).forEach(s => {
        const u = pageUnitById[s.page_id]
        const g = groupByScope[pageToScope[s.page_id]]?.[u]
        if (!g) return
        const value = pageUnitValue(s, u)
        g.totalValue += value
        if (s.work_date === today) g.dailyValue += value
      })
      const dailyGroupsMap = {}
      const totalGroupsMap = {}
      Object.entries(groupByScope).forEach(([scopeId, units]) => {
        dailyGroupsMap[scopeId] = Object.entries(units).map(([unit, g]) => ({
          unit, value: g.dailyValue, target: g.dailyTarget,
          pct: g.dailyTarget > 0 ? Math.min(100, Math.round((g.dailyValue / g.dailyTarget) * 100)) : 0,
        }))
        totalGroupsMap[scopeId] = Object.entries(units).map(([unit, g]) => ({
          unit, value: g.totalValue, target: g.totalTarget,
          pct: g.totalTarget > 0 ? Math.min(100, Math.round((g.totalValue / g.totalTarget) * 100)) : 0,
        }))
      })
      setDailyGroupsByScope(dailyGroupsMap)
      setTotalGroupsByScope(totalGroupsMap)

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
      // No connection — fall back to whatever was downloaded for offline
      // use (see the Download for Offline button on the Projects page).
      // Team members aren't part of that cache, so they're left empty here
      // rather than attempting another network call that would just fail
      // too (matches ScopeDetail.jsx's own offline fallback).
      try {
        const cached = await getCachedJobDetail(jobId)
        if (cached) {
          setJob(cached.job)
          setScopes(cached.scopes)
          setMembers([])
          setDailyGroupsByScope(cached.dailyGroupsByScope)
          setTotalGroupsByScope(cached.totalGroupsByScope)
          setTodaySessions(cached.todaySessions)
          setRecentSessions(cached.recentSessions)
          setOfflineMode(true)
        } else {
          // Reached this job some way other than tapping its card on the
          // Projects page (that page only lists downloaded jobs once it's
          // shown the same offline fallback) — a stale link, the browser's
          // back button, etc. Nothing to show without either a connection
          // or a prior download.
          setNotCachedOffline(true)
        }
      } catch (cacheErr) {
        console.error('[JobDetail] offline cache fallback failed:', cacheErr)
        setNotCachedOffline(true)
      }
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

  // job_members is its own independent roster (see
  // supabase-migration-job-members.sql) — removing someone here never
  // touches any scope's own Scope Members, and vice versa.
  async function removeMember(member) {
    if (!confirm(`Remove ${member.full_name || 'this person'} from this project?`)) return
    const { error } = await supabase.from('job_members').delete().eq('job_id', jobId).eq('user_id', member.id)
    if (error) { alert('Failed to remove: ' + error.message); return }
    setMembers(ms => ms.filter(m => m.id !== member.id))
  }

  // "Overall Progress" lives here, once per job, not on any one scope card
  // — every scope's every unit combined, same segmented-bar treatment as a
  // scope's own Daily/Total Progress.
  const jobTotalGroups = (() => {
    const byUnit = {}
    Object.values(totalGroupsByScope).forEach(groups => {
      (groups || []).forEach(g => {
        if (!byUnit[g.unit]) byUnit[g.unit] = { unit: g.unit, value: 0, target: 0 }
        byUnit[g.unit].value += g.value
        byUnit[g.unit].target += g.target
      })
    })
    return Object.values(byUnit).map(g => ({
      ...g, pct: g.target > 0 ? Math.min(100, Math.round((g.value / g.target) * 100)) : 0,
    }))
  })()
  const jobOverallPct = jobTotalGroups.length > 0
    ? Math.round(jobTotalGroups.reduce((sum, g) => sum + g.pct, 0) / jobTotalGroups.length)
    : 0
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

  if (loadError || notCachedOffline || !job) {
    return (
      <Layout>
        <div className="text-center py-16">
          <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">
            {notCachedOffline ? "Can't open this project offline" : loadError ? 'Failed to load project' : 'Project not found'}
          </p>
          {notCachedOffline && (
            <p className="text-sm text-muted mb-4">No connection, and this project hasn't been downloaded for offline use. Connect once, or download it in advance from the Projects page.</p>
          )}
          {loadError && <p className="text-sm text-muted mb-4">{loadError}</p>}
          <button onClick={() => navigate('/projects')} className="btn-secondary">Back to Projects</button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      {scopeReorderError && (
        <div
          onClick={() => setScopeReorderError('')}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: '#facc15', color: '#000', fontSize: '12px',
            padding: '10px 12px', wordBreak: 'break-word', cursor: 'pointer',
          }}
        >
          {scopeReorderError} <strong>(tap to dismiss)</strong>
        </div>
      )}
      {/* Main column and sidebar scroll independently of each other on lg+
          (same technique as the scope dashboard, ScopeDetail.jsx) — each is
          its own overflow-auto panel inside a fixed-height row, instead of
          the whole page scrolling as one, which used to carry the sidebar
          (weather/map/team) away with the main content. Below lg, this is
          OFF (just lg: — this used to apply unconditionally): the
          sidebar's own content easily needs more height than the viewport,
          and with shrink-0 in a fixed-height flex-col row it claimed
          however much it needed, squeezing the main column (the actual
          Scopes list) down into whatever sliver was left, scrollable in a
          tiny window of its own. Below lg this is now one normal page
          scroll instead. */}
      <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-3.5rem)]">
        <div className="flex-1 lg:overflow-auto">
          {offlineMode && (
            <div className="mx-4 mt-4 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-blue-700 dark:text-blue-300">
              No connection — showing the copy downloaded for offline use. Open a scope to keep working; it'll sync once you're back online.
            </div>
          )}
          {/* Header sits in its own, tighter-padded strip — closer to the
              true screen edge than the roomier main content below,
              matching the back-button-near-the-edge feel of a native app
              rather than matching the wide gutters the cards use. */}
          <div className="px-4 sm:px-6 pt-6">
            <div className="flex items-start gap-3 mb-6">
              <button onClick={() => navigate('/projects')} className="btn-ghost p-1.5 mt-2 shrink-0">
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

          <div className="px-6 sm:px-10 lg:px-16 pb-8 space-y-6">
          {/* Overall job progress — every scope's every unit combined into
              one plain bar; the one place "Overall Progress" is shown (not
              on a scope card). Click it for the SF/LF/Each breakdown. */}
          <button
            onClick={() => setShowJobProgressDetail(true)}
            className="card w-full text-left hover:bg-surface/80 transition-colors"
          >
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Overall Job Progress</span>
              <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{jobOverallPct}%</span>
            </div>
            <div className="h-2.5 bg-surface-3 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${jobOverallPct}%` }} />
            </div>
            <p className="text-xs text-muted mt-1.5">across {scopes.length} {scopes.length === 1 ? 'scope' : 'scopes'} · tap for SF/LF/EA detail</p>
          </button>

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
                    dailyGroups={dailyGroupsByScope[scope.id]}
                    totalGroups={totalGroupsByScope[scope.id]}
                    onClick={() => navigate(`/scopes/${scope.id}`)}
                    onUpdateStatus={updateScopeStatus}
                    onOpenSettings={setScopeSettingsTarget}
                    canManageScope={canCreateScope}
                    canReorder={canReorderScope}
                    isDragging={dragScopeId === scope.id}
                    isDropTarget={hoverScopeId === scope.id}
                    onDragStart={handleScopeDragStart}
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
            <div className="border border-border rounded-xl overflow-hidden elevated">
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
            <div className="border border-border rounded-xl overflow-hidden elevated">
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
        </div>

        {/* Sidebar — weather on top, then a map of the job location, then
            the team members, mirroring the layout of a scope's own
            dashboard (ScopeDetail.jsx). Its own overflow-auto panel (see
            the outer row above) rather than scrolling away with the main
            content, plus a left border on lg so it reads as its own
            column, same as the scope dashboard's sidebar. */}
        <div className="lg:w-72 shrink-0 lg:overflow-auto lg:border-l lg:border-border">
          <div className="p-4 sm:p-6 space-y-4">
            <WeatherWidget location={location} />
            <LocationMap location={location} />
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Project Members</h3>
                {canManageMembers && (
                  <button onClick={() => setShowAddMember(true)} className="btn-ghost py-0.5 px-2 text-xs">
                    + Add
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {members.map(member => (
                  <div
                    key={member.id}
                    onClick={() => setMemberCardTarget(member)}
                    className="flex items-center gap-2.5 bg-surface-2 rounded-lg p-2.5 cursor-pointer hover:bg-surface-3 transition-colors"
                  >
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

      {dragScopeId && (
        <div
          className="fixed z-[100] pointer-events-none px-3 py-2 rounded-lg bg-surface border border-accent shadow-xl text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2"
          style={{ left: dragScopePos.x + 14, top: dragScopePos.y + 14 }}
        >
          <GripIcon />
          {(() => { const s = scopes.find(s => s.id === dragScopeId); return s?.description || s?.name })()}
        </div>
      )}

      {showJobProgressDetail && (
        <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowJobProgressDetail(false)}>
          <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Overall Job Progress</h2>
              <button onClick={() => setShowJobProgressDetail(false)} className="btn-ghost p-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-muted mb-4">Every scope's total, broken down by unit, across this job.</p>
            <UomProgressBar groups={jobTotalGroups} size="lg" />
          </div>
        </div>
      )}

      {memberCardTarget && (
        <MemberCardModal
          person={memberCardTarget}
          onClose={() => setMemberCardTarget(null)}
          onRemove={canManageMembers ? removeMember : undefined}
        />
      )}

      {showAddMember && (
        <AddMemberModal
          directory={directory}
          jobId={jobId}
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
          job={job}
          currentScopeCount={scopes.length}
          userId={user.id}
          members={members}
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

