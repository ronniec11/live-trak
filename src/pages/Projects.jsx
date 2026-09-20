import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import OfflineSyncButton from '../components/OfflineSyncButton'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { downloadProjectForOffline, isProjectCached } from '../lib/offlineCache'

// Single-tenant for now — there's only one organization, so this is hard-
// coded rather than built out into an org switcher nobody needs yet.
const ORGANIZATION_ID = '2fc904e9-daa0-4d4d-8fb3-85fb0e84360e'

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
}

const GripIcon = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
    <circle cx="6" cy="5" r="1.4" /><circle cx="14" cy="5" r="1.4" />
    <circle cx="6" cy="10" r="1.4" /><circle cx="14" cy="10" r="1.4" />
    <circle cx="6" cy="15" r="1.4" /><circle cx="14" cy="15" r="1.4" />
  </svg>
)

function CreateProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', gc_name: '', owner_name: '', address: '', status: 'active' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data: job, error: jErr } = await supabase
        .from('jobs')
        .insert({
          organization_id: ORGANIZATION_ID,
          name: form.name.trim(),
          gc_name: form.gc_name.trim() || null,
          owner_name: form.owner_name.trim() || null,
          address: form.address.trim() || null,
          status: form.status,
        })
        .select()
        .single()
      if (jErr) throw jErr
      onCreated(job)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">New Project</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Project Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. CyrusOne DFW10" required />
          </div>
          <div>
            <label className="label">General Contractor</label>
            <input className="input" value={form.gc_name} onChange={e => set('gc_name', e.target.value)} placeholder="e.g. DPR Construction" />
          </div>
          <div>
            <label className="label">Owner</label>
            <input className="input" value={form.owner_name} onChange={e => set('owner_name', e.target.value)} placeholder="e.g. Bosque" />
          </div>
          <div>
            <label className="label">Project Address</label>
            <input className="input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="e.g. 123 Main St, Dallas, TX" />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="on hold">On Hold</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Compact icon-only download for full offline mode (see
// src/lib/offlineCache.js) — a job has no offline cache entry of its own,
// so this downloads each of its scopes in turn (the same per-scope cache
// the Scopes list's own download button writes to), which is what
// ScopeDetail's offline fallback actually reads from.
function DownloadOfflineButton({ jobName, scopeIds, onStatus }) {
  const [state, setState] = useState('idle') // 'idle' | 'downloading' | 'done' | 'error'

  useEffect(() => {
    let cancelled = false
    async function checkCached() {
      if (!scopeIds || scopeIds.length === 0) return
      const cached = await Promise.all(scopeIds.map(isProjectCached))
      if (!cancelled && cached.every(Boolean)) setState('done')
    }
    checkCached()
    return () => { cancelled = true }
  }, [scopeIds])

  async function handleDownload(e) {
    e.stopPropagation()
    if (state === 'downloading' || !scopeIds || scopeIds.length === 0) return
    setState('downloading')
    onStatus?.({ text: `Downloading ${jobName} for offline use…`, isError: false })
    try {
      for (const scopeId of scopeIds) {
        await downloadProjectForOffline(scopeId, text => onStatus?.({ text: `${jobName}: ${text}`, isError: false }))
      }
      setState('done')
      onStatus?.({ text: `${jobName} downloaded for offline use.`, isError: false })
    } catch (err) {
      console.error('[Projects] Download for offline failed:', err)
      setState('error')
      onStatus?.({ text: `Failed to download ${jobName}: ${err.message || 'check console'}`, isError: true })
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const noScopes = !scopeIds || scopeIds.length === 0
  const titles = {
    idle: noScopes ? 'No scopes to download yet' : 'Download for offline use',
    downloading: 'Downloading…',
    done: 'Downloaded for offline use — tap to refresh',
    error: 'Download failed — tap to retry',
  }

  return (
    <button
      onClick={handleDownload}
      disabled={state === 'downloading' || noScopes}
      className={`btn-ghost p-1.5 shrink-0 ${state === 'done' ? 'text-accent' : state === 'error' ? 'text-red-500' : 'text-muted'} ${noScopes ? 'opacity-40' : ''}`}
      title={titles[state]}
    >
      <svg className={`w-4 h-4 ${state === 'downloading' ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {state === 'downloading' ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        )}
      </svg>
    </button>
  )
}

function ProjectCard({ job, activeScopeCount, overallPct, scopeIds, onClick, canReorder, isDragging, isDropTarget, onDragStart, onDownloadStatus }) {
  const [pressing, setPressing] = useState(false)

  // Long-press-anywhere-on-the-card reorder trigger, same as the Scopes
  // list's own project cards — the grip handle alone is too small a
  // target to hit reliably with a fingertip. Holding still for ~450ms
  // starts the drag; a normal tap or a swipe past a small threshold
  // cancels it and behaves as a plain click. Presses starting on an
  // actual control are left alone so their own behavior still works.
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
      onDragStart(e, job.id)
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
    // doesn't also navigate into the project right as the user meant to
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
      data-job-id={job.id}
      onPointerDown={handleCardPointerDown}
      onPointerMove={handleCardPointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onClick={handleCardClick}
      className={`card hover:border-accent/40 hover:bg-surface/80 cursor-pointer transition-all duration-150 group select-none ${
        isDragging ? 'opacity-40' : ''
      } ${isDropTarget ? 'ring-2 ring-accent' : ''} ${pressing ? 'scale-[0.98]' : ''}`}
      style={{ WebkitTouchCallout: 'none' }}
    >
      <div className="flex items-start justify-between mb-3">
        {canReorder && (
          <button
            onPointerDown={e => { e.stopPropagation(); onDragStart(e, job.id) }}
            onClick={e => e.stopPropagation()}
            className="btn-ghost p-1 mr-1 -ml-1 shrink-0 cursor-grab active:cursor-grabbing text-muted"
            style={{ touchAction: 'none' }}
            title="Drag to reorder"
          >
            <GripIcon />
          </button>
        )}
        <h3 className="flex-1 min-w-0 font-semibold text-gray-900 dark:text-gray-100 group-hover:text-accent truncate">{job.name}</h3>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <DownloadOfflineButton jobName={job.name} scopeIds={scopeIds} onStatus={onDownloadStatus} />
          <span className={`${badgeClass(job.status)} capitalize`}>{job.status || 'active'}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-2 rounded-lg p-2.5">
          <p className="text-xs text-muted mb-0.5">Active Scopes</p>
          <p className="text-sm font-semibold text-accent">{activeScopeCount}</p>
        </div>
        <div className="bg-surface-2 rounded-lg p-2.5">
          <p className="text-xs text-muted mb-0.5">Overall Progress</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{overallPct != null ? `${overallPct}%` : '—'}</p>
        </div>
      </div>
    </div>
  )
}

export default function Projects() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [orgName, setOrgName] = useState('')
  const [jobs, setJobs] = useState([])
  const [activeScopesByJob, setActiveScopesByJob] = useState({})
  const [overallPctByJob, setOverallPctByJob] = useState({})
  const [scopeIdsByJob, setScopeIdsByJob] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  // Shared with each card's DownloadOfflineButton so a status/failure is
  // actually visible — alert() has been confirmed to silently do nothing on
  // an iPad's home-screen (standalone) install (see Scopes.jsx, which this
  // mirrors).
  const [downloadBanner, setDownloadBanner] = useState({ text: '', isError: false })

  const canCreate = profile?.role === 'admin'
  const canReorderRole = profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'superintendent'

  const [dragId, setDragId] = useState(null)
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 })
  const [hoverId, setHoverId] = useState(null)
  const [reorderError, setReorderError] = useState('')

  // Reordering is only meaningful against the full, unfiltered list — with a
  // search/status filter active there's no sensible place to drop a card
  // relative to items that are hidden. Matches the same rule on the Scopes
  // list's own reorder.
  const canReorder = canReorderRole && filterStatus === 'all' && !searchTerm

  function handleDragStart(e, jobId) {
    setDragId(jobId)
    setDragPos({ x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!dragId) return

    function onMove(e) {
      setDragPos({ x: e.clientX, y: e.clientY })
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const target = el?.closest('[data-job-id]')
      const targetId = target?.getAttribute('data-job-id')
      setHoverId(targetId && targetId !== dragId ? targetId : null)
    }

    async function onUp() {
      const droppedOnId = hoverId
      const draggedId = dragId
      setDragId(null)
      setHoverId(null)
      if (!droppedOnId) return

      const fromIdx = jobs.findIndex(j => j.id === draggedId)
      const toIdx = jobs.findIndex(j => j.id === droppedOnId)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
      const reordered = [...jobs]
      const [moved] = reordered.splice(fromIdx, 1)
      reordered.splice(toIdx, 0, moved)
      setJobs(reordered)

      try {
        const results = await Promise.all(
          reordered.map((j, idx) => supabase.rpc('set_job_sort_order', { target_job_id: j.id, new_order: idx }))
        )
        const failedRpc = results.find(r => r?.error)
        const noOpRpc = results.find(r => !r?.error && r?.data === false)
        if (failedRpc) {
          console.error('[Projects] set_job_sort_order failed:', failedRpc.error)
          setReorderError('Reordering was not saved: ' + (failedRpc.error.message || 'unknown error'))
          return
        }
        if (noOpRpc) {
          console.error('[Projects] set_job_sort_order ran but updated no row (role check failed).')
          setReorderError('Reordering was not saved — your account role is not allowed to reorder projects.')
          return
        }
        setJobs(js => js.map((j, idx) => ({ ...j, sort_order: idx })))
      } catch (err) {
        console.error('[Projects] Reorder save threw:', err)
        setReorderError('Reordering failed to save: ' + (err.message || String(err)))
      }
    }

    // Once a drag is active, stop touchmove from also scrolling the page.
    function preventScroll(e) { e.preventDefault() }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('touchmove', preventScroll, { passive: false })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('touchmove', preventScroll)
    }
  }, [dragId, hoverId, jobs])

  async function loadProjects() {
    setLoading(true)
    setLoadError('')
    try {
      const { data: jobsData, error: jobsErr } = await supabase
        .from('jobs')
        .select('*, organizations(name)')
        .eq('organization_id', ORGANIZATION_ID)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (jobsErr) throw jobsErr

      setJobs(jobsData || [])
      setOrgName(jobsData?.[0]?.organizations?.name || '')

      const jobIds = (jobsData || []).map(j => j.id)
      if (jobIds.length === 0) {
        setActiveScopesByJob({}); setOverallPctByJob({}); setScopeIdsByJob({})
        return
      }

      // Scopes (projects) under these jobs — active count, per-job scope
      // ids (for the download-offline button), and each job's total SF
      // target (the denominator for Overall Progress below).
      const { data: scopes } = await supabase
        .from('projects')
        .select('id, job_id, status, total_sf_target')
        .in('job_id', jobIds)

      const activeMap = {}
      const targetMap = {}
      const scopeIdMap = {}
      const scopeToJob = {}
      ;(scopes || []).forEach(s => {
        scopeToJob[s.id] = s.job_id
        if (s.status === 'active') activeMap[s.job_id] = (activeMap[s.job_id] || 0) + 1
        targetMap[s.job_id] = (targetMap[s.job_id] || 0) + (parseFloat(s.total_sf_target) || 0)
        if (!scopeIdMap[s.job_id]) scopeIdMap[s.job_id] = []
        scopeIdMap[s.job_id].push(s.id)
      })
      setActiveScopesByJob(activeMap)
      setScopeIdsByJob(scopeIdMap)

      const scopeIds = Object.keys(scopeToJob)
      if (scopeIds.length === 0) { setOverallPctByJob({}); return }

      const { data: pages } = await supabase
        .from('pages')
        .select('id, project_id')
        .in('project_id', scopeIds)

      const pageToJob = {}
      ;(pages || []).forEach(pg => { pageToJob[pg.id] = scopeToJob[pg.project_id] })
      const pageIds = Object.keys(pageToJob)
      if (pageIds.length === 0) { setOverallPctByJob({}); return }

      const { data: sessions } = await supabase
        .from('sessions')
        .select('page_id, sf')
        .in('page_id', pageIds)

      const sfMap = {}
      ;(sessions || []).forEach(sess => {
        const jobId = pageToJob[sess.page_id]
        if (!jobId) return
        sfMap[jobId] = (sfMap[jobId] || 0) + (parseFloat(sess.sf) || 0)
      })

      // null (rendered as "—") rather than 0% whenever no target's been set
      // yet — 0% reads as "nothing done," which isn't the same claim as
      // "there's nothing to measure against."
      const pctMap = {}
      jobIds.forEach(jobId => {
        const target = targetMap[jobId] || 0
        pctMap[jobId] = target > 0 ? Math.min(100, Math.round(((sfMap[jobId] || 0) / target) * 100)) : null
      })
      setOverallPctByJob(pctMap)
    } catch (err) {
      console.error('[Jobs] loadJobs error:', err)
      setLoadError(err.message || 'Failed to load jobs. Please try refreshing.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) loadProjects()
  }, [user])

  const filtered = jobs.filter(j => {
    const matchSearch = !searchTerm || j.name.toLowerCase().includes(searchTerm.toLowerCase()) || (j.gc_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = filterStatus === 'all' || j.status === filterStatus
    return matchSearch && matchStatus
  })

  return (
    <Layout>
      {reorderError && (
        <div
          onClick={() => setReorderError('')}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: '#facc15', color: '#000', fontSize: '12px',
            padding: '10px 12px', wordBreak: 'break-word', cursor: 'pointer',
          }}
        >
          {reorderError} <strong>(tap to dismiss)</strong>
        </div>
      )}
      {downloadBanner.text && (
        <div
          onClick={() => setDownloadBanner({ text: '', isError: false })}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: downloadBanner.isError ? '#ef4444' : '#60a5fa', color: '#000', fontSize: '12px',
            padding: '10px 12px', wordBreak: 'break-word', cursor: 'pointer',
          }}
        >
          {downloadBanner.text} <strong>(tap to dismiss)</strong>
        </div>
      )}
      <div className="max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-16 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">{orgName || 'Loading…'}</p>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Projects</h1>
            <p className="text-sm text-muted mt-0.5">
              {jobs.length} {jobs.length === 1 ? 'project' : 'projects'}
            </p>
          </div>
          <div className="flex gap-2 self-start sm:self-auto">
            <OfflineSyncButton />
            {canCreate && (
              <>
                <button onClick={() => navigate('/reports')} className="btn-secondary flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h12M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5-6h6m-6 3h6m-6-6h6" />
                  </svg>
                  Reports
                </button>
                <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Project
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <svg className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search projects..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="input pl-9"
            />
          </div>
          <div className="flex gap-2">
            {['all', 'active', 'completed', 'on hold'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                  filterStatus === s ? 'bg-accent/10 text-accent border border-accent/30' : 'bg-surface-2 text-muted hover:text-gray-700 dark:hover:text-gray-300 border border-border'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="card animate-pulse">
                <div className="h-5 bg-surface-3 rounded w-3/4 mb-3" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-12 bg-surface-3 rounded-lg" />
                  <div className="h-12 bg-surface-3 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">Failed to load projects</p>
            <p className="text-sm text-muted mb-4">{loadError}</p>
            <button onClick={loadProjects} className="btn-secondary">
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-surface-2 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">No projects found</p>
            <p className="text-sm text-muted mt-1">
              {jobs.length === 0 ? 'No projects have been created yet.' : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(job => (
              <ProjectCard
                key={job.id}
                job={job}
                activeScopeCount={activeScopesByJob[job.id] || 0}
                overallPct={overallPctByJob[job.id] ?? null}
                scopeIds={scopeIdsByJob[job.id] || []}
                onClick={() => navigate(`/projects/${job.id}`)}
                canReorder={canReorder}
                isDragging={dragId === job.id}
                isDropTarget={hoverId === job.id}
                onDragStart={handleDragStart}
                onDownloadStatus={setDownloadBanner}
              />
            ))}
          </div>
        )}
      </div>

      {dragId && (
        <div
          className="fixed z-[100] pointer-events-none px-3 py-2 rounded-lg bg-surface border border-accent shadow-xl text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2"
          style={{ left: dragPos.x + 14, top: dragPos.y + 14 }}
        >
          <GripIcon />
          {jobs.find(j => j.id === dragId)?.name}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={() => loadProjects()}
        />
      )}
    </Layout>
  )
}
