import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import OfflineSyncButton from '../components/OfflineSyncButton'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { generatePdfTiles, generateRasterTiles, deleteTiles } from '../lib/tileGenerator'
import { getCachedProject } from '../lib/offlineCache'

const UPLOAD_TIMEOUT_MS = 30_000

const STATUS_OPTIONS = ['active', 'completed', 'on hold']

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
}

function StatusBadge({ status, onSave }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function select(s) {
    setOpen(false)
    if (s !== status) await onSave(s)
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen(o => !o)}
        className={`${badgeClass(status)} cursor-pointer hover:opacity-80 transition-opacity capitalize`}
      >
        {status}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 min-w-[110px] py-1 overflow-hidden">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => select(s)}
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

function AddPageModal({ projectId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploadStep, setUploadStep] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef()

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    setLoading(true)
    setUploadStep('')

    try {
      let floor_plan_url = null

      if (file) {
        const ext = file.name.split('.').pop().toLowerCase()
        const path = `${projectId}/${Date.now()}.${ext}`
        console.log('[AddPage] Starting upload to bucket "floor-plans", path:', path, 'size:', file.size)
        setUploadStep('Uploading file…')

        // Upload raw file bytes only — NO PDF rendering happens here.
        // PDF.js rendering runs lazily in Canvas.jsx when the user opens the canvas,
        // keeping the upload lightweight and off the main thread.
        const uploadPromise = supabase.storage
          .from('floor-plans')
          .upload(path, file, { upsert: true, contentType: file.type })

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload timed out after 30 seconds — check your connection and try again')), UPLOAD_TIMEOUT_MS)
        )

        const { data: uploadData, error: upErr } = await Promise.race([uploadPromise, timeoutPromise])

        if (upErr) {
          console.error('[AddPage] Storage upload error:', upErr)
          throw upErr
        }
        console.log('[AddPage] Upload succeeded:', uploadData)

        setUploadStep('Getting public URL…')
        const { data: urlData } = supabase.storage.from('floor-plans').getPublicUrl(path)
        floor_plan_url = urlData.publicUrl
        console.log('[AddPage] Public URL:', floor_plan_url)
      }

      setUploadStep('Saving page…')
      console.log('[AddPage] Inserting page row, name:', name.trim(), 'floor_plan_url:', floor_plan_url)

      const { data, error: pErr } = await supabase
        .from('pages')
        .insert({ project_id: projectId, name: name.trim(), floor_plan_url })
        .select()
        .single()

      if (pErr) {
        console.error('[AddPage] DB insert error:', pErr)
        throw pErr
      }
      console.log('[AddPage] Page created:', data)

      setUploadStep('')
      onCreated(data)
      onClose()
    } catch (err) {
      console.error('[AddPage] handleSubmit failed:', err)
      setError(err.message || 'Something went wrong. Please try again.')
      setUploadStep('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Add Floor Plan</h2>
          <button onClick={onClose} disabled={loading} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Page Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Level 1, Section A" required />
          </div>
          <div>
            <label className="label">Floor Plan Image (optional)</label>
            <div
              onClick={() => !loading && fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${loading ? 'border-border opacity-50 cursor-not-allowed' : 'border-border hover:border-accent/50 cursor-pointer'}`}
            >
              {file ? (
                <p className="text-sm text-accent font-medium">{file.name}</p>
              ) : (
                <>
                  <svg className="w-8 h-8 text-muted mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-sm text-muted">Click to upload floor plan</p>
                  <p className="text-xs text-muted mt-1">PNG, JPG, PDF up to 20MB</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => setFile(e.target.files[0])} />
          </div>

          {uploadStep && !error && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
              {uploadStep}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={loading} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? (
                <span className="flex items-center justify-center gap-1.5">
                  <div className="w-3.5 h-3.5 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
                  {file ? 'Uploading…' : 'Adding…'}
                </span>
              ) : 'Add Page'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddMemberModal({ projectId, existingMemberIds, onClose, onAdded }) {
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
        .insert({ project_id: projectId, user_id: person.id })
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
            <p className="text-sm text-muted">{directory.length === 0 ? 'Everyone in the directory is already on this project.' : 'No matches.'}</p>
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

// Consolidates the fields that used to be edited piecemeal via pencil
// icons scattered across the header and both Progress cards — Contract
// Cost especially, which was showing (and separately editable) in two
// places at once. Name/status/targets still keep their own quick-edit
// affordances elsewhere on the page too; this is just the one place
// Contract Cost lives now. canEditCost mirrors the page's own
// canEditFinancials — Superintendent can open this (canManage) and see
// cost, same as everywhere else on this page, but not change it.
function ScopeSettingsModal({ project, canEditCost, onClose, onSaved }) {
  const [name, setName] = useState(project.name || '')
  const [status, setStatus] = useState(project.status || 'active')
  const [dailyTarget, setDailyTarget] = useState(project.daily_sf_target ?? '')
  const [totalTarget, setTotalTarget] = useState(project.total_sf_target ?? '')
  const [cost, setCost] = useState(project.cost ?? '')
  const [lunchBreak, setLunchBreak] = useState(project.lunch_break_minutes ?? '')
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
        status,
        daily_sf_target: parseFloat(dailyTarget) || 0,
        total_sf_target: parseFloat(totalTarget) || 0,
        lunch_break_minutes: lunchBreak === '' ? null : (parseFloat(lunchBreak) || null),
      }
      if (canEditCost) patch.cost = cost === '' ? null : (parseFloat(cost) || null)
      const { data, error: sErr } = await supabase.from('projects').update(patch).eq('id', project.id).select().single()
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
            <input className="input" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input capitalize" value={status} onChange={e => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Daily SF Target</label>
              <input className="input" type="number" min="0" value={dailyTarget} onChange={e => setDailyTarget(e.target.value)} placeholder="5000" />
            </div>
            <div>
              <label className="label">Total SF Target</label>
              <input className="input" type="number" min="0" value={totalTarget} onChange={e => setTotalTarget(e.target.value)} placeholder="e.g. 250000" />
            </div>
          </div>
          <div>
            <label className="label">Contract Cost ($)</label>
            <input
              className="input" type="number" min="0" value={cost}
              onChange={e => setCost(e.target.value)}
              disabled={!canEditCost}
              placeholder="e.g. 500000"
            />
          </div>
          <div>
            {/* Deducted per crew member from a session's logged hours when
                the Sheet Report computes man-hours (Total Hours column and
                SF/Man-Hour) — the session itself still keeps the raw crew
                size and hours exactly as entered. */}
            <label className="label">Lunch Break (minutes)</label>
            <input className="input" type="number" min="0" value={lunchBreak} onChange={e => setLunchBreak(e.target.value)} placeholder="e.g. 30" />
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

export default function ScopeDetail() {
  const { projectId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [pages, setPages] = useState([])
  const [members, setMembers] = useState([])
  const [todaySessions, setTodaySessions] = useState([])
  const [activePage, setActivePage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [offlineMode, setOfflineMode] = useState(false)
  const [notCachedOffline, setNotCachedOffline] = useState(false)
  const [showAddPage, setShowAddPage] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [editingTarget, setEditingTarget] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [savingTarget, setSavingTarget] = useState(false)
  const [editingTotalTarget, setEditingTotalTarget] = useState(false)
  const [totalTargetInput, setTotalTargetInput] = useState('')
  const [savingTotalTarget, setSavingTotalTarget] = useState(false)
  const [showScopeSettings, setShowScopeSettings] = useState(false)
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false)
  const [editingPageId, setEditingPageId] = useState(null)
  const [editingPageName, setEditingPageName] = useState('')
  const [editingProjectInfo, setEditingProjectInfo] = useState(false)
  const [editInfoName, setEditInfoName] = useState('')
  const [editInfoDesc, setEditInfoDesc] = useState('')
  const [savingProjectInfo, setSavingProjectInfo] = useState(false)
  const [tilingPageId, setTilingPageId] = useState(null)
  const [tilingProgress, setTilingProgress] = useState(0)
  // setTilingPageId is async (React state), so a burst of clicks/duplicate
  // events landing before the next render can all read the same stale
  // tilingPageId and slip past the `if (tilingPageId) return` guard below —
  // confirmed in practice as multiple concurrent generatePdfTiles() runs
  // fighting over the same storage path. A ref is synchronous, so it blocks
  // every duplicate call starting from the very first line.
  const tilingRef = useRef(false)

  // General project management (floor plans, team assignment, project
  // info, calibrate, opening Scope Settings) — Superintendent gets this
  // too, just not editing financials below. Foreman gets neither, so
  // Contract Cost (only reachable through Scope Settings now) is
  // effectively hidden from them without a separate view-only check.
  const canManage = profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'superintendent'
  // Editing SF targets/cost stays admin+PM only — Superintendent can open
  // Scope Settings (see canManage) and see cost there, just not change it.
  const canEditFinancials = profile?.role === 'admin' || profile?.role === 'pm'

  async function generateTiles(page) {
    if (tilingRef.current) return
    if (!page.floor_plan_url) { alert('This page has no floor plan file to tile.'); return }
    tilingRef.current = true
    setTilingPageId(page.id); setTilingProgress(0)
    try {
      if (page.tile_meta) {
        // Regenerating — clear out any stale/partial tiles from a previous
        // attempt (e.g. a different pyramid depth) before writing new ones.
        await deleteTiles(projectId, page.id)
      }
      let url = page.floor_plan_url
      if (!url.startsWith('http')) {
        const { data } = supabase.storage.from('floor-plans').getPublicUrl(url)
        url = data.publicUrl
      }
      const isPdf = /\.pdf($|\?)/i.test(url) || url.toLowerCase().includes('.pdf')
      const onProgress = (done, total) => setTilingProgress(total ? Math.round((done / total) * 100) : 0)
      const opts = { projectId, pageId: page.id, onProgress }
      const tile_meta = isPdf
        ? await generatePdfTiles(url, opts)
        : await generateRasterTiles(url, opts)

      const { error } = await supabase.from('pages').update({ tile_meta }).eq('id', page.id)
      if (error) throw error
      setPages(ps => ps.map(p => p.id === page.id ? { ...p, tile_meta } : p))
    } catch (err) {
      console.error('[ProjectDetail] Tile generation failed:', err)
      alert('Tile generation failed: ' + (err.message || 'check console'))
    } finally {
      setTilingPageId(null); setTilingProgress(0)
      tilingRef.current = false
    }
  }

  async function saveProjectInfo() {
    const name = editInfoName.trim()
    if (!name) return
    setSavingProjectInfo(true)
    const description = editInfoDesc.trim() || null
    await supabase.from('projects').update({ name, description }).eq('id', projectId)
    setProject(p => ({ ...p, name, description }))
    setSavingProjectInfo(false)
    setEditingProjectInfo(false)
  }

  async function removeMember(member) {
    if (!confirm(`Remove ${member.full_name || 'this person'} from this project?`)) return
    const { error } = await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', member.id)
    if (error) { alert('Failed to remove: ' + error.message); return }
    setMembers(ms => ms.filter(m => m?.id !== member.id))
  }

  async function savePageRename(page) {
    const trimmed = editingPageName.trim()
    if (!trimmed || trimmed === page.name) { setEditingPageId(null); return }
    await supabase.from('pages').update({ name: trimmed }).eq('id', page.id)
    setPages(ps => ps.map(p => p.id === page.id ? { ...p, name: trimmed } : p))
    if (activePage?.id === page.id) setActivePage(p => ({ ...p, name: trimmed }))
    setEditingPageId(null)
  }

  async function deletePage(page) {
    if (!confirm(`Delete "${page.name}"? This will also delete all sessions on this page. This cannot be undone.`)) return

    // 1. Delete all sessions for this page
    await supabase.from('sessions').delete().eq('page_id', page.id)

    // 2. Delete the page record
    await supabase.from('pages').delete().eq('id', page.id)

    // 3. Delete storage files if present
    const filesToRemove = []
    if (page.floor_plan_url && !page.floor_plan_url.startsWith('http')) {
      filesToRemove.push(page.floor_plan_url)
    } else if (page.floor_plan_url) {
      // Extract storage path from public URL
      const match = page.floor_plan_url.match(/floor-plans\/(.+)$/)
      if (match) filesToRemove.push(match[1])
    }
    if (page.cached_image_url) {
      const match = page.cached_image_url.match(/floor-plans\/(.+)$/)
      if (match) filesToRemove.push(match[1])
    }
    if (filesToRemove.length > 0) {
      await supabase.storage.from('floor-plans').remove(filesToRemove)
    }
    if (page.tile_meta) {
      await deleteTiles(projectId, page.id)
    }

    // 4. Update local state
    setPages(ps => {
      const remaining = ps.filter(p => p.id !== page.id)
      if (activePage?.id === page.id) {
        setActivePage(remaining[0] || null)
      }
      return remaining
    })
    setTodaySessions(ts => ts.filter(s => s.page_id !== page.id))
  }

  async function loadTodaySessions(pgs) {
    if (!pgs?.length) return
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*, profiles(full_name)')
      .in('page_id', pgs.map(p => p.id))
      .order('created_at', { ascending: false })
    console.log('[ProjectDetail] Sessions fetch:', {
      pageIds: pgs.map(p => p.id),
      sessionsFound: sessions?.length,
      error,
    })
    setTodaySessions(sessions || [])
  }

  async function refreshSessions() {
    setSessionsRefreshing(true)
    try { await loadTodaySessions(pages) }
    finally { setSessionsRefreshing(false) }
  }

  async function loadData() {
    setLoading(true)
    try {
      const [{ data: proj, error: projErr }, { data: pgs, error: pgsErr }, { data: mems }] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('pages').select('*').eq('project_id', projectId).order('created_at'),
        supabase.from('project_members').select('user_id, profiles(*)').eq('project_id', projectId),
      ])
      if (projErr) throw projErr
      if (pgsErr) throw pgsErr

      setProject(proj)
      setPages(pgs || [])
      setMembers((mems || []).map(m => m.profiles))
      setTargetInput(proj?.daily_sf_target || 0)
      setTotalTargetInput(proj?.total_sf_target || 0)
      if (pgs && pgs.length > 0) setActivePage(pgs[0])
      setOfflineMode(false)
      setNotCachedOffline(false)

      await loadTodaySessions(pgs || [])
    } catch (err) {
      console.error(err)
      // No connection — fall back to whatever was downloaded for offline
      // use (see the Download for Offline button on the Projects page).
      // Sessions/today's totals aren't part of that cache, so they're left
      // empty here rather than attempting another network call that would
      // just fail too.
      try {
        const cached = await getCachedProject(projectId)
        if (cached) {
          setProject(cached)
          setPages(cached.pages || [])
          setMembers([])
          setTargetInput(cached.daily_sf_target || 0)
          setTotalTargetInput(cached.total_sf_target || 0)
          if (cached.pages?.length > 0) setActivePage(cached.pages[0])
          setOfflineMode(true)
        } else {
          // Reached this project some way other than tapping its card on
          // the Projects page (that page only lists downloaded projects
          // once it's shown the same offline fallback) — a stale link, the
          // browser's back button, etc. Nothing to show without either a
          // connection or a prior download.
          setNotCachedOffline(true)
        }
      } catch (cacheErr) {
        console.error('[ProjectDetail] offline cache fallback failed:', cacheErr)
        setNotCachedOffline(true)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [projectId])

  const today = new Date().toLocaleDateString('en-CA')
  console.log('[ProjectDetail] today:', today)
  console.log('[ProjectDetail] session work_dates:', todaySessions.map(s => s.work_date))
  const todaySF = todaySessions.filter(s => s.work_date === today).reduce((sum, s) => sum + (parseFloat(s.sf) || 0), 0)
  console.log('[ProjectDetail] todaySF:', todaySF)
  const totalSF = todaySessions.reduce((sum, s) => sum + (parseFloat(s.sf) || 0), 0)
  const dailyBarColor = todaySF >= (project?.daily_sf_target || 0) && (project?.daily_sf_target || 0) > 0 ? '#4ade80' : '#facc15'
  const pct = project?.daily_sf_target > 0
    ? Math.min(100, Math.round((todaySF / project.daily_sf_target) * 100))
    : 0
  const totalPct = project?.total_sf_target > 0
    ? Math.min(100, Math.round((totalSF / project.total_sf_target) * 100))
    : 0

  async function saveTarget() {
    setSavingTarget(true)
    try {
      await supabase.from('projects').update({ daily_sf_target: parseFloat(targetInput) || 0 }).eq('id', projectId)
      setProject(p => ({ ...p, daily_sf_target: parseFloat(targetInput) || 0 }))
      setEditingTarget(false)
    } catch (err) { console.error(err) }
    finally { setSavingTarget(false) }
  }

  async function saveTotalTarget() {
    setSavingTotalTarget(true)
    try {
      await supabase.from('projects').update({ total_sf_target: parseFloat(totalTargetInput) || 0 }).eq('id', projectId)
      setProject(p => ({ ...p, total_sf_target: parseFloat(totalTargetInput) || 0 }))
      setEditingTotalTarget(false)
    } catch (err) { console.error(err) }
    finally { setSavingTotalTarget(false) }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    )
  }

  if (!project) {
    return (
      <Layout>
        <div className="text-center py-16 text-muted">
          {notCachedOffline
            ? "No connection, and this project hasn't been downloaded for offline use. Connect once, or download it in advance from the Projects page."
            : 'Project not found or access denied.'}
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem)]">
        {/* Main area */}
        <div className="flex-1 overflow-auto">
          {offlineMode && (
            <div className="mx-4 mt-4 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-blue-700 dark:text-blue-300">
              No connection — showing the copy downloaded for offline use. Open a sheet to keep working; it'll sync once you're back online.
            </div>
          )}
          {/* Project header — same plain, borderless strip as the job
              dashboard's own header (ProjectDetail.jsx), rather than a
              bordered/tinted box. */}
          <div className="px-4 sm:px-6 pt-6">
            <div className="flex items-start gap-3 mb-6">
              {/* Scopes are always opened from within their parent project's
                  dashboard now, not from a standalone list — back goes there
                  when we know it (job_id), falling back to the orphaned
                  /scopes list only if this project somehow has none. */}
              <button onClick={() => navigate(project?.job_id ? `/projects/${project.job_id}` : '/scopes')} className="btn-ghost p-1.5 mt-0.5 shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                {editingProjectInfo ? (
                  <div className="space-y-1.5">
                    <input
                      autoFocus
                      className="input py-0.5 text-sm w-full"
                      value={editInfoName}
                      onChange={e => setEditInfoName(e.target.value)}
                      placeholder="Project name"
                      onKeyDown={e => { if (e.key === 'Escape') setEditingProjectInfo(false) }}
                    />
                    <input
                      className="input py-0.5 text-xs w-full"
                      value={editInfoDesc}
                      onChange={e => setEditInfoDesc(e.target.value)}
                      placeholder="Add description..."
                      onKeyDown={e => { if (e.key === 'Escape') setEditingProjectInfo(false) }}
                    />
                    <div className="flex gap-1.5">
                      <button onClick={saveProjectInfo} disabled={savingProjectInfo || !editInfoName.trim()} className="btn-primary py-0.5 px-2 text-xs flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        {savingProjectInfo ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingProjectInfo(false)} className="btn-ghost py-0.5 px-2 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-lg font-bold text-gray-900 dark:text-white">{project.name}</h1>
                      <StatusBadge
                        status={project.status}
                        onSave={async s => {
                          await supabase.from('projects').update({ status: s }).eq('id', projectId)
                          setProject(p => ({ ...p, status: s }))
                        }}
                      />
                      {canManage && (
                        <button
                          onClick={() => { setEditInfoName(project.name); setEditInfoDesc(project.description || ''); setEditingProjectInfo(true) }}
                          className="btn-ghost p-0.5 opacity-60 hover:opacity-100"
                          title="Edit project"
                        >
                          <svg className="w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
                        </button>
                      )}
                    </div>
                    {project.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{project.description}</p>}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <OfflineSyncButton className="text-xs" />
                {canManage && (
                  <button onClick={() => setShowAddPage(true)} className="btn-primary flex items-center gap-1.5 text-xs">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add Floor Plan
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="max-w-[1600px] px-6 sm:px-10 lg:px-16 pb-8 space-y-6">
          {/* Floor plans — a card, same as every other section here and on
              the job dashboard, instead of a bottom-border strip. */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Floor Plans</h2>
            {pages.length > 0 ? (
              <div className="card">
              <div className="flex gap-2 overflow-x-auto">
                {pages.map(page => {
                  const isActive = activePage?.id === page.id
                  const isEditingThis = editingPageId === page.id
                  return (
                    <div key={page.id} className="shrink-0 group/tab relative">
                      {isEditingThis ? (
                        <div className="flex flex-col items-center gap-1" style={{ width: 120 }}>
                          <input
                            autoFocus
                            className="text-xs bg-surface-3 border border-accent/50 rounded px-2 py-1 w-full text-gray-900 dark:text-white text-center"
                            value={editingPageName}
                            onChange={e => setEditingPageName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') savePageRename(page); if (e.key === 'Escape') setEditingPageId(null) }}
                          />
                          <div className="flex gap-1">
                            <button onClick={() => savePageRename(page)} className="text-accent text-xs">Save</button>
                            <button onClick={() => setEditingPageId(null)} className="text-muted text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => setActivePage(page)}
                          onDoubleClick={() => navigate(`/canvas/${page.id}`)}
                          className={`cursor-pointer rounded-xl border-2 flex items-center justify-center text-center font-semibold text-sm transition-all px-2 ${
                            isActive ? 'border-accent text-accent bg-surface' : 'border-border text-gray-500 dark:text-gray-400 bg-surface hover:border-gray-500'
                          }`}
                          style={{ width: 120, height: 80 }}
                        >
                          {page.name}
                        </div>
                      )}
                      {canManage && !isEditingThis && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); setEditingPageId(page.id); setEditingPageName(page.name) }}
                            className="absolute top-1 right-1 p-0.5 rounded bg-black/60 opacity-0 group-hover/tab:opacity-100 transition-opacity"
                            title="Rename"
                          >
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); deletePage(page) }}
                            className="absolute top-1 left-1 p-0.5 rounded bg-black/60 opacity-0 group-hover/tab:opacity-100 transition-opacity hover:bg-red-600/80"
                            title="Delete floor plan"
                          >
                            <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); generateTiles(page) }}
                            disabled={!!tilingPageId}
                            className={`absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 transition-opacity flex items-center gap-0.5 ${
                              tilingPageId === page.id ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'
                            } ${page.tile_meta ? 'hover:bg-black/60' : 'hover:bg-accent/60'}`}
                            title={page.tile_meta ? 'Regenerate deep-zoom tiles' : 'Generate deep-zoom tiles (smooth iPad zoom)'}
                          >
                            {tilingPageId === page.id ? (
                              <span className="text-[9px] text-white font-medium">{tilingProgress}%</span>
                            ) : (
                              <svg className={`w-3 h-3 ${page.tile_meta ? 'text-accent' : 'text-white'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="pt-2 text-xs text-muted">Double-click to open</p>
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="w-12 h-12 bg-surface-2 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                  </svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400 font-medium">No floor plans yet</p>
                {canManage && (
                  <button onClick={() => setShowAddPage(true)} className="btn-primary mt-4 flex items-center gap-1.5 mx-auto">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add First Floor Plan
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Progress — one card holding both bars (no border lines between
              them, just spacing), same as every other section here and on
              the job dashboard. */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Progress</h2>
              <button
                onClick={refreshSessions}
                disabled={sessionsRefreshing}
                className="btn-ghost py-1 px-2 text-xs flex items-center gap-1"
              >
                {sessionsRefreshing
                  ? <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                  : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                }
                Refresh
              </button>
            </div>
            <div className="card space-y-4">
              {/* Total progress bar (blue) */}
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-xs text-muted font-medium">Total Progress</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {totalSF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      {project?.total_sf_target > 0 && (
                        <span className="text-muted font-normal"> / {project.total_sf_target.toLocaleString()} SF</span>
                      )}
                    </span>
                    {canEditFinancials && !editingTotalTarget && (
                      <button onClick={() => setEditingTotalTarget(true)} className="btn-ghost p-1 ml-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {editingTotalTarget && (
                  <div className="flex items-center gap-1 mb-2">
                    <input
                      type="number"
                      value={totalTargetInput}
                      onChange={e => setTotalTargetInput(e.target.value)}
                      className="input w-28 text-xs py-1"
                      min="0"
                      placeholder="Total SF target"
                    />
                    <button onClick={saveTotalTarget} disabled={savingTotalTarget} className="btn-primary text-xs py-1 px-2">
                      {savingTotalTarget ? '...' : 'Save'}
                    </button>
                    <button onClick={() => setEditingTotalTarget(false)} className="btn-ghost text-xs py-1 px-2">Cancel</button>
                  </div>
                )}
                {project?.total_sf_target > 0 && (
                  <>
                    <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${totalPct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-muted">{totalPct}% complete</span>
                      {totalPct >= 100 && <span className="text-blue-600 dark:text-blue-400 font-medium">Building complete!</span>}
                    </div>
                  </>
                )}
              </div>

              {/* Daily progress bar (green) */}
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-xs text-muted font-medium">Daily Progress</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {todaySF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    {project?.daily_sf_target > 0 && (
                      <span className="text-muted font-normal"> / {project.daily_sf_target.toLocaleString()} SF</span>
                    )}
                  </span>
                </div>
                {project?.daily_sf_target > 0 && (
                  <>
                    <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: dailyBarColor }} />
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-muted">{pct}% complete</span>
                      {pct >= 100 && <span className="text-accent font-medium">Target reached!</span>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Recent Sessions — grouped by date; this is history across the
              whole scope, not just today, despite living in the state
              variable named todaySessions. */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Recent Sessions</h2>
            <div className="border border-border rounded-xl overflow-hidden elevated">
              {todaySessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted">No sessions saved yet</div>
              ) : (() => {
                const pageMap = Object.fromEntries(pages.map(p => [p.id, p.name]))
                const byDate = {}
                todaySessions.forEach(s => {
                  const d = s.work_date || s.created_at?.slice(0, 10) || 'Unknown'
                  if (!byDate[d]) byDate[d] = []
                  byDate[d].push(s)
                })
                const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))
                return (
                  <div className="divide-y divide-border">
                    {sortedDates.map(date => {
                      const dateSessions = byDate[date]
                      const dateSF = dateSessions.reduce((sum, s) => sum + (parseFloat(s.sf) || 0), 0)
                      const label = (() => {
                        try { return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
                        catch { return date }
                      })()
                      return (
                        <div key={date} className="px-4 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{label}{date === today && <span className="ml-1.5 text-accent">Today</span>}</p>
                            <p className="text-xs text-muted">{dateSF.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF</p>
                          </div>
                          <div className="space-y-2">
                            {dateSessions.map(session => (
                              <div key={session.id} className="flex items-center gap-2.5">
                                <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: session.color || '#facc15' }} />
                                <p className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{session.name || 'Session'}</p>
                                <p className="text-xs text-muted shrink-0">
                                  {[
                                    session.profiles?.full_name || 'Unknown',
                                    pageMap[session.page_id],
                                    (() => { const sf = parseFloat(session.sf) || 0; const ct = session.count_data?.length || 0; return sf > 0 && ct > 0 ? `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF · ${ct} items` : ct > 0 ? `${ct} items` : `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF` })(),
                                    session.created_at ? new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
                                  ].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:w-72 shrink-0 overflow-auto">
          <div className="p-4 sm:p-6 space-y-4">
            {/* Progress */}
            <div>
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Progress</h3>
              <div className="bg-surface-2 rounded-xl p-3 space-y-4 elevated">

                {/* Total progress (blue) */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-xs text-muted font-medium">Total Progress</p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-gray-700 dark:text-gray-300">
                        {totalSF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        {project?.total_sf_target > 0 && <span className="text-muted"> / {project.total_sf_target.toLocaleString()}</span>}
                        {' SF'}
                      </p>
                      {canEditFinancials && !editingTotalTarget && (
                        <button onClick={() => setEditingTotalTarget(true)} className="btn-ghost p-0.5">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {editingTotalTarget && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <input
                        type="number"
                        value={totalTargetInput}
                        onChange={e => setTotalTargetInput(e.target.value)}
                        className="input w-24 text-xs py-1"
                        min="0"
                        placeholder="Total SF"
                      />
                      <button onClick={saveTotalTarget} disabled={savingTotalTarget} className="btn-primary text-xs py-1 px-2">
                        {savingTotalTarget ? '...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingTotalTarget(false)} className="btn-ghost text-xs py-1 px-1">✕</button>
                    </div>
                  )}
                  {project?.total_sf_target > 0 ? (
                    <>
                      <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${totalPct}%` }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-muted">{totalPct}%</span>
                        {totalPct >= 100 && <span className="text-blue-600 dark:text-blue-400 font-medium">Complete!</span>}
                      </div>
                    </>
                  ) : (
                    <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500/30 rounded-full" style={{ width: '0%' }} />
                    </div>
                  )}
                </div>

                {/* Daily progress (green) */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-xs text-muted font-medium">Daily Progress</p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-gray-700 dark:text-gray-300">
                        {todaySF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        {project?.daily_sf_target > 0 && <span className="text-muted"> / {project.daily_sf_target.toLocaleString()}</span>}
                        {' SF'}
                      </p>
                      {canEditFinancials && !editingTarget && (
                        <button onClick={() => setEditingTarget(true)} className="btn-ghost p-0.5">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {editingTarget && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <input
                        type="number"
                        value={targetInput}
                        onChange={e => setTargetInput(e.target.value)}
                        className="input w-24 text-xs py-1"
                        min="0"
                        placeholder="Daily SF"
                      />
                      <button onClick={saveTarget} disabled={savingTarget} className="btn-primary text-xs py-1 px-2">
                        {savingTarget ? '...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingTarget(false)} className="btn-ghost text-xs py-1 px-1">✕</button>
                    </div>
                  )}
                  {project?.daily_sf_target > 0 ? (
                    <>
                      <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: dailyBarColor }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-muted">{pct}%</span>
                        {pct >= 100 && <span className="text-accent font-medium">Target reached!</span>}
                      </div>
                    </>
                  ) : (
                    <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full bg-accent/30 rounded-full" style={{ width: '0%' }} />
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Today's Sessions */}
            {todaySessions.filter(s => s.work_date === today).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Today's Sessions</h3>
                <div className="space-y-2">
                  {todaySessions.filter(s => s.work_date === today).map(session => (
                    <div key={session.id} className="bg-surface-2 rounded-lg p-2.5 flex items-center gap-2.5">
                      <div
                        className="w-6 h-6 rounded-full shrink-0"
                        style={{ backgroundColor: session.color || '#facc15' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{session.name || 'Session'}</p>
                        <p className="text-xs text-muted">
                          {(() => { const sf = parseFloat(session.sf) || 0; const ct = session.count_data?.length || 0; return sf > 0 && ct > 0 ? `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF · ${ct} items` : ct > 0 ? `${ct} items` : `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF` })()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Team Members */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Team Members</h3>
                {canManage && (
                  <button onClick={() => setShowAddMember(true)} className="btn-ghost py-0.5 px-2 text-xs">
                    + Add
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {members.map(member => member && (
                  <div key={member.id} className="flex items-center gap-2.5 group">
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
                    {canManage && (
                      <button
                        onClick={() => removeMember(member)}
                        className="btn-ghost p-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Remove from project"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-muted">No members yet</p>
                )}
              </div>
            </div>

            {canManage && (
              <button
                onClick={() => setShowScopeSettings(true)}
                className="flex items-center gap-2 text-xs text-muted hover:text-gray-700 dark:hover:text-gray-300 transition-colors pt-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Scope Settings
              </button>
            )}
          </div>
        </div>
      </div>

      {showAddPage && (
        <AddPageModal
          projectId={projectId}
          onClose={() => setShowAddPage(false)}
          onCreated={newPage => {
            setShowAddPage(false)
            // Full reload so the pages list reflects the saved floor_plan_url from DB
            loadData().then(() => setActivePage(newPage))
          }}
        />
      )}
      {showAddMember && (
        <AddMemberModal
          projectId={projectId}
          existingMemberIds={members.filter(Boolean).map(m => m.id)}
          onClose={() => setShowAddMember(false)}
          onAdded={loadData}
        />
      )}
      {showScopeSettings && (
        <ScopeSettingsModal
          project={project}
          canEditCost={canEditFinancials}
          onClose={() => setShowScopeSettings(false)}
          onSaved={patch => setProject(p => ({ ...p, ...patch }))}
        />
      )}
    </Layout>
  )
}
