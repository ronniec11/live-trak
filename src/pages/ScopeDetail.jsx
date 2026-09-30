import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import OfflineSyncButton from '../components/OfflineSyncButton'
import ScopeSettingsModal from '../components/ScopeSettingsModal'
import UomProgressBar from '../components/UomProgressBar'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { generatePdfTiles, generateRasterTiles, deleteTiles } from '../lib/tileGenerator'
import { getCachedProject } from '../lib/offlineCache'
import { resolveStorageUrl, storagePathFrom } from '../lib/storageUrls'

const UPLOAD_TIMEOUT_MS = 30_000

// Shared by AddPageModal (a local file picker) and ImportAutodeskModal (a
// File downloaded from Autodesk) so both go through the exact same
// upload/timeout/insert path instead of two copies that can drift —
// PDF rendering happens lazily later in Canvas.jsx either way, this only
// ever handles the raw file bytes.
//
// floor_plan_url stores the bare Storage PATH now, not a public URL — the
// floor-plans bucket is private (see
// supabase-migration-org-scoping-stage4-storage.sql), so there's no public
// URL to get at upload time anyway. Wherever this actually needs to be
// displayed/fetched, it gets resolved to a fresh signed URL right before
// use via resolveStorageUrl() (src/lib/storageUrls.js) — signing it once
// here and storing THAT would just be a URL that's already partway through
// expiring by the time it's ever shown.
async function createPageFromFile(projectId, name, file, onStep) {
  let floor_plan_url = null

  if (file) {
    const ext = (file.name || '').split('.').pop().toLowerCase() || 'bin'
    const path = `${projectId}/${Date.now()}.${ext}`
    onStep?.('Uploading file…')

    const uploadPromise = supabase.storage
      .from('floor-plans')
      .upload(path, file, { upsert: true, contentType: file.type })
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Upload timed out after 30 seconds — check your connection and try again')), UPLOAD_TIMEOUT_MS)
    )
    const { error: upErr } = await Promise.race([uploadPromise, timeoutPromise])
    if (upErr) throw upErr

    floor_plan_url = path
  }

  onStep?.('Saving page…')
  const { data, error: pErr } = await supabase
    .from('pages')
    .insert({ project_id: projectId, name: name.trim(), floor_plan_url })
    .select()
    .single()
  if (pErr) throw pErr
  return data
}

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
      const data = await createPageFromFile(projectId, name, file, setUploadStep)
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !loading && onClose()}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
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

// SF/LF/each — deliberately its own vocabulary, separate from the scope's
// own uom ('SF'/'LF'/'Count', capital C, set in Scope Settings) — a single
// scope can now hold pages tracked in different units, so each page needs
// its own independent choice rather than inheriting one shared value.
const PAGE_UOM_OPTIONS = ['SF', 'LF', 'each']
// The stored value stays lowercase 'each' (matches the DB value and every
// uom === 'each' check elsewhere) — this is display-only, for the dropdown
// and the Progress-by-Unit labels below.
const pageUomLabel = u => u === 'each' ? 'Each' : u

// A sheet's own unit of measure + daily/total target, overriding the
// scope-level target for just this one page (read by Canvas.jsx on load —
// see its "page overrides scope" comment). Opened from the small gear icon
// on each page's thumbnail (bottom-left corner, alongside Rename/Delete/
// Generate Tiles), same modal shape as AddPageModal above.
//
// Tags moved here from Scope Settings too (see
// supabase-migration-page-tags.sql) — a scope can hold sheets doing
// different kinds of work, so tagging (and the rate it can drive) is a
// per-sheet thing now, matching this page's own Unit of Measure rather
// than a scope-wide one. This tag picker/create/rate-match logic is a
// direct port of the old ScopeSettingsModal's, just keyed off page_id and
// this page's own uom instead of the scope's.
function PageSettingsModal({ page, onClose, onSaved }) {
  const { profile } = useAuth()
  const [name, setName] = useState(page.name || '')
  const [uom, setUom] = useState(page.unit_of_measure || 'SF')
  const [dailyTarget, setDailyTarget] = useState(page.daily_target ?? '')
  const [totalTarget, setTotalTarget] = useState(page.total_target ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [allTags, setAllTags] = useState([])
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [initialTagIds, setInitialTagIds] = useState([])
  const [tagQuery, setTagQuery] = useState('')
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const [creatingTag, setCreatingTag] = useState(false)
  const [tagsError, setTagsError] = useState('')

  useEffect(() => {
    if (!profile?.organization_id) return
    supabase.from('tags').select('*').order('name')
      .then(({ data, error: err }) => { if (!err) setAllTags(data || []) })
    supabase.from('page_tags').select('tag_id').eq('page_id', page.id)
      .then(({ data, error: err }) => {
        if (err) { setTagsError('Could not load this sheet\'s tags — run supabase-migration-page-tags.sql if you haven\'t yet.'); return }
        const ids = (data || []).map(r => r.tag_id)
        setSelectedTagIds(ids)
        setInitialTagIds(ids)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.organization_id, page.id])

  const uomLower = uom === 'each' ? 'each' : uom.toLowerCase()
  const selectedTags = selectedTagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean)
  // A tag only drives the target if it actually has a rate for the unit
  // this SHEET is tracked in — a purely descriptive tag (no rate set) or
  // one whose rate is in a different unit is just a label here.
  const rateTagsForUom = selectedTags.filter(t => t.uom === uomLower && (t.rate_per_day != null || t.rate_per_man_hour != null))
  const activeRateTag = rateTagsForUom.length === 1 ? rateTagsForUom[0] : null
  const tagRateConflict = rateTagsForUom.length > 1

  const matchingTags = allTags.filter(t =>
    !selectedTagIds.includes(t.id) && t.name.toLowerCase().includes(tagQuery.trim().toLowerCase())
  )
  const exactMatch = allTags.some(t => t.name.toLowerCase() === tagQuery.trim().toLowerCase())

  function addTag(tagId) {
    setSelectedTagIds(ids => [...ids, tagId])
    setTagQuery('')
    setTagDropdownOpen(false)
  }

  function removeTag(tagId) {
    setSelectedTagIds(ids => ids.filter(id => id !== tagId))
  }

  async function createAndAddTag() {
    const trimmed = tagQuery.trim()
    if (!trimmed || !profile?.organization_id) return
    setCreatingTag(true)
    setTagsError('')
    try {
      const { data, error: err } = await supabase.from('tags')
        .insert({ organization_id: profile.organization_id, name: trimmed, uom: uomLower })
        .select().single()
      if (err) throw err
      setAllTags(t => [...t, data])
      addTag(data.id)
    } catch (err) {
      setTagsError(err.code === '23505' ? 'A tag with this name already exists.' : (err.message || 'Failed to create tag.'))
    } finally {
      setCreatingTag(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    setLoading(true)
    const updates = {
      name: name.trim(),
      unit_of_measure: uom,
      daily_target: dailyTarget === '' ? null : parseFloat(dailyTarget) || 0,
      total_target: totalTarget === '' ? null : parseFloat(totalTarget) || 0,
    }
    try {
      const { error: upErr } = await supabase.from('pages').update(updates).eq('id', page.id)
      if (upErr) throw upErr

      const addedIds = selectedTagIds.filter(id => !initialTagIds.includes(id))
      const removedIds = initialTagIds.filter(id => !selectedTagIds.includes(id))
      if (addedIds.length > 0) {
        const { error: insErr } = await supabase.from('page_tags')
          .insert(addedIds.map(tag_id => ({ page_id: page.id, tag_id })))
        if (insErr) throw insErr
      }
      if (removedIds.length > 0) {
        const { error: delErr } = await supabase.from('page_tags')
          .delete().eq('page_id', page.id).in('tag_id', removedIds)
        if (delErr) throw delErr
      }

      onSaved({ ...updates, tags: selectedTags })
      onClose()
    } catch (err) {
      console.error('[PageSettings] save failed:', err)
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !loading && onClose()}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 overflow-y-auto min-h-0">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Sheet Settings</h2>
          <button onClick={onClose} disabled={loading} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Sheet Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Unit of Measure</label>
            <select className="input" value={uom} onChange={e => setUom(e.target.value)}>
              {PAGE_UOM_OPTIONS.map(u => <option key={u} value={u}>{pageUomLabel(u)}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Tags</label>
            <p className="text-xs text-muted mb-1.5">
              Tag this sheet with a line item from Company Hub to compare its production against your company's standard rate.
            </p>
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedTags.map(t => (
                  <span key={t.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/30">
                    {t.name}
                    <button type="button" onClick={() => removeTag(t.id)} className="hover:text-red-500">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                className="input" placeholder="Search or create a tag..."
                value={tagQuery}
                onChange={e => { setTagQuery(e.target.value); setTagDropdownOpen(true) }}
                onFocus={() => setTagDropdownOpen(true)}
                onBlur={() => setTimeout(() => setTagDropdownOpen(false), 150)}
              />
              {tagDropdownOpen && tagQuery.trim() && (
                <div className="absolute z-10 top-full mt-1 w-full bg-surface border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {matchingTags.map(t => (
                    <button
                      key={t.id} type="button" onMouseDown={() => addTag(t.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex items-center justify-between"
                    >
                      <span>{t.name}</span>
                      <span className="text-xs text-muted uppercase">{t.uom}</span>
                    </button>
                  ))}
                  {!exactMatch && (
                    <button
                      type="button" onMouseDown={createAndAddTag} disabled={creatingTag}
                      className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-surface-2"
                    >
                      {creatingTag ? 'Creating...' : `+ Create "${tagQuery.trim()}"`}
                    </button>
                  )}
                  {matchingTags.length === 0 && exactMatch && (
                    <div className="px-3 py-2 text-sm text-muted">Already added.</div>
                  )}
                </div>
              )}
            </div>
            {tagsError && <p className="text-xs text-red-500 mt-1.5">{tagsError}</p>}
          </div>

          {activeRateTag && (
            <div className="bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 text-accent text-sm">
              Following "{activeRateTag.name}"'s rate:{' '}
              {activeRateTag.rate_per_day != null && <>{activeRateTag.rate_per_day.toLocaleString()} {pageUomLabel(uom)}/day</>}
              {activeRateTag.rate_per_day != null && activeRateTag.rate_per_man_hour != null && ' · '}
              {activeRateTag.rate_per_man_hour != null && <>{activeRateTag.rate_per_man_hour.toLocaleString()} {pageUomLabel(uom)}/man-hr</>}
              . Leave the daily target below blank to use it, or set a number to override just this sheet.
            </div>
          )}
          {tagRateConflict && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-yellow-700 dark:text-yellow-400 text-sm">
              This sheet has more than one {pageUomLabel(uom)} tag with a rate ({rateTagsForUom.map(t => t.name).join(', ')}) — remove one, or set a manual target below to make it explicit.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Daily Target</label>
              <input className="input" type="number" min="0" value={dailyTarget} onChange={e => setDailyTarget(e.target.value)} placeholder={activeRateTag?.rate_per_day ? `${activeRateTag.rate_per_day} (from tag)` : 'e.g. 5000'} />
            </div>
            <div>
              <label className="label">Total Target</label>
              <input className="input" type="number" min="0" value={totalTarget} onChange={e => setTotalTarget(e.target.value)} placeholder="e.g. 250000" />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={loading} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

// Drills Hubs -> ACC Projects -> Folders -> Files, then downloads the
// picked file and runs it through the exact same upload+insert path as a
// local file pick (createPageFromFile) — the only difference is where the
// bytes come from. Never touches a raw Autodesk token itself: every call
// sends this browser's own Supabase session and lets the server resolve/
// refresh the Autodesk one (see api/autodesk/_lib.js's getValidApsToken).
function ImportAutodeskModal({ projectId, onClose, onCreated }) {
  const [checking, setChecking] = useState(true)
  const [connected, setConnected] = useState(false)
  const [crumbs, setCrumbs] = useState([{ label: 'Hubs', view: { type: 'hubs' } }])
  const [items, setItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(null) // the chosen file entry, while naming it
  const [pageName, setPageName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importStep, setImportStep] = useState('')
  // Temporary diagnostic aid — Autodesk's exact response shape here hasn't
  // been verified against a real account yet (see the Phase 3 commit).
  // Surfacing it directly means a screenshot is enough to debug an empty
  // list, instead of needing someone non-technical to dig through DevTools.
  const [rawResponse, setRawResponse] = useState(null)

  async function authedFetch(url) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not signed in.')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || data.error || 'Request failed.')
    return data
  }

  const currentView = crumbs[crumbs.length - 1].view

  async function loadView(view) {
    setLoadingItems(true)
    setError('')
    setRawResponse(null)
    try {
      let data
      if (view.type === 'hubs') {
        data = await authedFetch('/api/autodesk/projects')
        setItems((data.data || []).map(h => ({ id: h.id, name: h.attributes?.name || 'Hub', kind: 'hub' })))
      } else if (view.type === 'accProjects') {
        data = await authedFetch(`/api/autodesk/projects?hubId=${encodeURIComponent(view.hubId)}`)
        setItems((data.data || []).map(p => ({ id: p.id, name: p.attributes?.name || 'Project', kind: 'accProject' })))
      } else if (view.type === 'topFolders') {
        data = await authedFetch(`/api/autodesk/folders?hubId=${encodeURIComponent(view.hubId)}&projectId=${encodeURIComponent(view.projectId)}`)
        setItems((data.data || []).map(f => ({ id: f.id, name: f.attributes?.displayName || 'Folder', kind: 'folder' })))
      } else if (view.type === 'folder') {
        data = await authedFetch(`/api/autodesk/sheets?projectId=${encodeURIComponent(view.projectId)}&folderId=${encodeURIComponent(view.folderId)}`)
        setItems((data.data || []).map(e => ({
          id: e.id,
          name: e.attributes?.displayName || 'Untitled',
          kind: e.type === 'folders' ? 'folder' : 'file',
        })))
      }
      if (!data?.data?.length) setRawResponse(data)
    } catch (err) {
      setError(err.message)
      setItems([])
    } finally {
      setLoadingItems(false)
    }
  }

  useEffect(() => {
    authedFetch('/api/autodesk/status')
      .then(s => {
        setConnected(!!s.connected)
        setChecking(false)
        if (s.connected) loadView({ type: 'hubs' })
      })
      .catch(err => { setConnected(false); setChecking(false); setError(err.message) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function enter(entry) {
    if (entry.kind === 'hub') {
      const view = { type: 'accProjects', hubId: entry.id }
      setCrumbs(c => [...c, { label: entry.name, view }])
      loadView(view)
    } else if (entry.kind === 'accProject') {
      const view = { type: 'topFolders', hubId: currentView.hubId, projectId: entry.id }
      setCrumbs(c => [...c, { label: entry.name, view }])
      loadView(view)
    } else if (entry.kind === 'folder') {
      const view = { type: 'folder', projectId: currentView.projectId, folderId: entry.id }
      setCrumbs(c => [...c, { label: entry.name, view }])
      loadView(view)
    } else if (entry.kind === 'file') {
      setPicked(entry)
      setPageName(entry.name.replace(/\.[^.]+$/, ''))
    }
  }

  function goTo(idx) {
    const next = crumbs.slice(0, idx + 1)
    setCrumbs(next)
    loadView(next[next.length - 1].view)
  }

  async function doImport() {
    if (!picked || !pageName.trim()) return
    setImporting(true)
    setError('')
    try {
      setImportStep('Locating file on Autodesk…')
      const { url, name: fileName } = await authedFetch(
        `/api/autodesk/download?projectId=${encodeURIComponent(currentView.projectId)}&itemId=${encodeURIComponent(picked.id)}`
      )
      setImportStep('Downloading from Autodesk…')
      const fileResp = await fetch(url)
      if (!fileResp.ok) throw new Error('Failed to download the file from Autodesk.')
      const blob = await fileResp.blob()
      const file = new File([blob], fileName || picked.name, { type: blob.type || 'application/octet-stream' })

      const data = await createPageFromFile(projectId, pageName, file, setImportStep)
      setImportStep('')
      onCreated(data)
      onClose()
    } catch (err) {
      setError(err.message || 'Import failed. Please try again.')
      setImportStep('')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !importing && onClose()}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Import from Autodesk</h2>
          <button onClick={onClose} disabled={importing} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {checking ? (
          <p className="text-sm text-muted">Checking your Autodesk connection…</p>
        ) : !connected ? (
          <div className="text-sm text-gray-600 dark:text-gray-300 space-y-3">
            <p>Your Autodesk account isn't connected yet.</p>
            <a href="/company-hub" className="btn-primary inline-block">Go to Company Hub to connect it</a>
          </div>
        ) : picked ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Importing <span className="text-gray-900 dark:text-white font-medium">{picked.name}</span></p>
            <div>
              <label className="label">Page Name *</label>
              <input className="input" value={pageName} onChange={e => setPageName(e.target.value)} required />
            </div>
            {importStep && !error && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
                {importStep}
              </div>
            )}
            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setPicked(null); setError('') }} disabled={importing} className="btn-secondary flex-1">Back</button>
              <button type="button" onClick={doImport} disabled={importing || !pageName.trim()} className="btn-primary flex-1">
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-1 flex-wrap text-xs text-muted">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span>/</span>}
                  <button
                    onClick={() => goTo(i)}
                    disabled={i === crumbs.length - 1}
                    className={i === crumbs.length - 1 ? 'text-gray-900 dark:text-white font-medium' : 'hover:text-accent'}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>}

            <div className="border border-border rounded-lg max-h-80 overflow-y-auto divide-y divide-border">
              {loadingItems ? (
                <p className="text-sm text-muted p-4">Loading…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted p-4">Nothing here.</p>
              ) : items.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => enter(entry)}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-surface-2 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    {entry.kind === 'file' ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v6.75a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25v-4.5zm0 0V6a2.25 2.25 0 012.25-2.25h5.379a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H19.5A2.25 2.25 0 0121.75 9v.75" />
                    )}
                  </svg>
                  <span className="text-gray-900 dark:text-white truncate">{entry.name}</span>
                </button>
              ))}
            </div>

            {rawResponse && (
              <div>
                <p className="text-xs text-muted mb-1">Raw response from Autodesk (for debugging — screenshot this if the list above looks wrong):</p>
                <pre className="text-xs bg-surface-2 border border-border rounded-lg p-2 overflow-auto max-h-40 text-gray-600 dark:text-gray-300">
                  {JSON.stringify(rawResponse, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
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
      // Excludes anyone removed from the team (see Team.jsx) — filtered
      // client-side so this still works before
      // supabase-migration-team-active.sql has been run.
      setDirectory((data || []).filter(p => !existingMemberIds.includes(p.id) && p.active !== false))
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm p-6 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Add Scope Member</h2>
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


export default function ScopeDetail() {
  const { projectId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [pages, setPages] = useState([])
  const [members, setMembers] = useState([])
  const [todaySessions, setTodaySessions] = useState([])
  const [scopeTags, setScopeTags] = useState([])
  const [activePage, setActivePage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [offlineMode, setOfflineMode] = useState(false)
  const [notCachedOffline, setNotCachedOffline] = useState(false)
  const [showAddPage, setShowAddPage] = useState(false)
  const [showImportAutodesk, setShowImportAutodesk] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [pageSettingsTarget, setPageSettingsTarget] = useState(null) // the page currently open in Sheet Settings, or null
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
  const [tilingServerSide, setTilingServerSide] = useState(false)
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

  // Server-side fallback (api/tiles/generate.js) for when client-side
  // tiling itself fails — see supabase-migration-server-tiling.sql for the
  // full rationale. Only handles PDFs; a customer with no technical
  // recourse (no Bluebeam, no idea what "chunk size" means) still ends up
  // with working tiles instead of a dead end.
  async function generateTilesServerSide(page) {
    // Optimistic — api/tiles/generate.js sets this itself server-side
    // moments later anyway, but setting it here means the yellow banner
    // shows immediately rather than waiting on that round trip.
    setPages(ps => ps.map(p => p.id === page.id ? { ...p, tile_status: 'processing', tile_error: null } : p))
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Your session expired — sign in again and retry.')
    const res = await fetch('/api/tiles/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: page.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Server-side tile generation failed.')
    return data.tile_meta
  }

  async function generateTiles(page, forceServerSide = false) {
    if (tilingRef.current) return
    if (!page.floor_plan_url) { alert('This page has no floor plan file to tile.'); return }
    tilingRef.current = true
    setTilingPageId(page.id); setTilingProgress(0); setTilingServerSide(forceServerSide)
    // Declared outside the try block on purpose — the catch block below
    // needs to read it too, and a `let` inside try isn't visible there.
    let usedServerSide = forceServerSide
    try {
      if (page.tile_meta) {
        // Regenerating — clear out any stale/partial tiles from a previous
        // attempt (e.g. a different pyramid depth) before writing new ones.
        await deleteTiles(projectId, page.id)
      }
      const isPdf = /\.pdf($|\?)/i.test(page.floor_plan_url) || page.floor_plan_url.toLowerCase().includes('.pdf')

      let tile_meta
      // Shift-click (see the button's title) skips straight to server-side
      // (mupdf) — for a file already known/suspected to be slow across the
      // WHOLE page rather than one isolated spot, there's no reason to make
      // anyone sit through pdf.js failing first every single time it's
      // regenerated.
      if (forceServerSide) {
        if (!isPdf) throw new Error('Server-side generation only handles PDF floor plans.')
        tile_meta = await generateTilesServerSide(page)
      } else {
        // Tiling needs to actually fetch the source file, which lives in the
        // now-private floor-plans bucket — resolveStorageUrl signs it first
        // (floor_plan_url is a bare path now; it also tolerates a leftover
        // legacy full URL from before this bucket went private).
        const url = await resolveStorageUrl(page.floor_plan_url)
        if (!url) throw new Error('Could not access the source floor plan file to tile it.')
        const onProgress = (done, total) => setTilingProgress(total ? Math.round((done / total) * 100) : 0)
        // generatePdfTiles' default chunkSize is deliberately small (iPad-safe
        // memory ceiling) — an iPad doing this same generation needs that
        // ceiling, but a desktop browser doing it has far more RAM to spare,
        // so a bigger chunkSize here cuts the number of separate pdf.js
        // render() calls needed for a dense sheet (each one costly — see
        // generatePdfTiles' own comment) without changing TILE_BASE_SCALE or
        // final tile resolution/quality at all.
        const isIPad = /iPad|Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
        const opts = { projectId, pageId: page.id, onProgress, ...(isIPad ? {} : { chunkSize: 4096 }) }

        try {
          tile_meta = isPdf
            ? await generatePdfTiles(url, opts)
            : await generateRasterTiles(url, opts)
        } catch (clientErr) {
          // pdf.js is a browser-embedded VIEWER, not a hardened production
          // rasterizer — real-world CAD-exported PDFs can contain leftover
          // invisible content that hangs it regardless of chunk size (see
          // tileGenerator.js). Only PDFs have a server-side fallback; a
          // failed raster (plain image) upload has no such path, since
          // generateRasterTiles doesn't touch pdf.js at all.
          if (!isPdf) throw clientErr
          console.warn('[ScopeDetail] Client-side tiling failed, falling back to server-side:', clientErr)
          usedServerSide = true
          setTilingServerSide(true)
          tile_meta = await generateTilesServerSide(page)
        }
      }

      const tile_status = usedServerSide ? 'complete' : null
      const { error } = await supabase.from('pages').update({ tile_meta, tile_status, tile_error: null }).eq('id', page.id)
      if (error) throw error
      setPages(ps => ps.map(p => p.id === page.id ? { ...p, tile_meta, tile_status, tile_error: null } : p))
    } catch (err) {
      console.error('[ProjectDetail] Tile generation failed:', err)
      if (usedServerSide) {
        // api/tiles/generate.js already wrote tile_status='failed'/tile_error
        // server-side when ITS attempt failed — reflect that here too so the
        // red banner shows immediately, without waiting for a reload.
        setPages(ps => ps.map(p => p.id === page.id ? { ...p, tile_status: 'failed', tile_error: err.message } : p))
      }
      alert(
        'Tile generation failed: ' + (err.message || 'check console') +
        '\n\nThis file may have a compatibility issue we can\'t render directly. Try re-exporting it as a flattened/printed PDF, or upload it as a JPG/PNG instead.'
      )
    } finally {
      setTilingPageId(null); setTilingProgress(0); setTilingServerSide(false)
      tilingRef.current = false
    }
  }

  // Clears the completed/failed server-side tiling banner once acknowledged
  // — tile_status only exists to drive that banner, so once someone's seen
  // it there's nothing left for it to track until the next generation.
  async function dismissTileBanner(page) {
    setPages(ps => ps.map(p => p.id === page.id ? { ...p, tile_status: null, tile_error: null } : p))
    await supabase.from('pages').update({ tile_status: null, tile_error: null }).eq('id', page.id)
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

    // 3. Delete storage files if present — floor_plan_url/cached_image_url
    // are bare Storage paths now (storagePathFrom also strips a legacy
    // full-URL prefix if an old row still has one).
    const filesToRemove = [page.floor_plan_url, page.cached_image_url]
      .filter(Boolean)
      .map(storagePathFrom)
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
      const [projRes, pgsRes, memsRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('pages').select('*').eq('project_id', projectId).order('created_at'),
        supabase.from('project_members').select('user_id, profiles(*)').eq('project_id', projectId),
      ])
      if (projRes.error) throw projRes.error
      const proj = projRes.data
      const { data: pgs, error: pgsErr } = pgsRes
      const { data: mems } = memsRes
      if (pgsErr) throw pgsErr

      setProject(proj)
      setPages(pgs || [])
      setMembers((mems || []).map(m => m.profiles))
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

  // Server-side tiling (generateTilesServerSide) can genuinely take several
  // minutes on a large sheet — long enough that iOS Safari has been seen
  // suspending the backgrounded tab mid-request, which loses that fetch's
  // response entirely. The server itself finishes and writes tile_status
  // fine; without this, the banner is left showing "processing" forever
  // (looking indistinguishable from a genuine hang) until something else
  // happens to reload this page's data — a manual navigate-away-and-back.
  // Polling here means the banner catches up on its own once the server
  // actually finishes, independent of whatever happened to the original
  // request/response in this tab.
  useEffect(() => {
    // Also watches pages the CLIENT marked 'failed' (generateTiles' own
    // catch block, e.g. a gateway timeout on the fetch itself) — not just
    // ones still 'processing'. That client-side 'failed' is only ever a
    // guess about what the server is doing; the server can easily still be
    // running past it (same underlying risk the comment above describes)
    // and finish successfully moments later, which this would otherwise
    // never notice until a manual reload. Confirmed happening in practice:
    // a page showed the failure banner, then flipped to complete on its
    // own after a refresh with no further action taken.
    const watchIds = pages.filter(p => p.tile_status === 'processing' || p.tile_status === 'failed').map(p => p.id)
    if (watchIds.length === 0) return
    const interval = setInterval(async () => {
      const { data, error } = await supabase.from('pages').select('id, tile_status, tile_meta, tile_error').in('id', watchIds)
      if (error || !data) return
      setPages(ps => ps.map(p => {
        const fresh = data.find(d => d.id === p.id)
        return fresh ? { ...p, ...fresh } : p
      }))
    }, 8000)
    return () => clearInterval(interval)
  }, [pages])

  // Tags now live on individual sheets (Sheet Settings), not the scope
  // itself (see supabase-migration-page-tags.sql) — a scope's own "Tags"
  // widget rolls up whichever tags are attached to ANY of its pages,
  // deduped by tag id (the same tag can be attached to more than one
  // sheet in this scope).
  useEffect(() => {
    if (pages.length === 0) { setScopeTags([]); return }
    supabase.from('page_tags').select('tags(*)').in('page_id', pages.map(p => p.id))
      .then(({ data, error }) => {
        if (error) { setScopeTags([]); return }
        const byId = new Map()
        ;(data || []).forEach(row => { if (row.tags) byId.set(row.tags.id, row.tags) })
        setScopeTags([...byId.values()])
      })
  }, [pages])

  const today = new Date().toLocaleDateString('en-CA')

  // Per-page UOM breakdown — replaces the old scope-wide Unit of
  // Measure/target entirely (see ScopeSettingsModal.jsx's comment on why:
  // a scope's sheets can now track different kinds of work in different
  // units). Groups pages by their own unit_of_measure (defaulting an unset
  // page to 'SF'), summing each group's sessions against that group's
  // pages' own daily_target/total_target — same three-way sf/lf/each
  // split ProjectDetail.jsx's own per-scope totals use.
  const pageUnitValue = (s, uom) => uom === 'LF' ? (parseFloat(s.lf) || 0)
    : uom === 'each' ? (s.count_data?.length ?? s.count_data?.markers?.length ?? 0)
    : (parseFloat(s.sf) || 0)
  const uomGroups = (() => {
    const groups = {}
    pages.forEach(pg => {
      const u = pg.unit_of_measure || 'SF'
      if (!groups[u]) groups[u] = { unit: u, pageIds: new Set(), dailyTarget: 0, totalTarget: 0 }
      groups[u].pageIds.add(pg.id)
      groups[u].dailyTarget += pg.daily_target || 0
      groups[u].totalTarget += pg.total_target || 0
    })
    return Object.values(groups)
  })()
  const dailyGroups = uomGroups.map(g => {
    const value = todaySessions
      .filter(s => g.pageIds.has(s.page_id) && s.work_date === today)
      .reduce((sum, s) => sum + pageUnitValue(s, g.unit), 0)
    return { unit: g.unit, value, target: g.dailyTarget, pct: g.dailyTarget > 0 ? Math.min(100, Math.round((value / g.dailyTarget) * 100)) : 0 }
  })
  const totalGroups = uomGroups.map(g => {
    const value = todaySessions
      .filter(s => g.pageIds.has(s.page_id))
      .reduce((sum, s) => sum + pageUnitValue(s, g.unit), 0)
    return { unit: g.unit, value, target: g.totalTarget, pct: g.totalTarget > 0 ? Math.min(100, Math.round((value / g.totalTarget) * 100)) : 0 }
  })

  // Last Activity — todaySessions (despite its name) already holds every
  // session across every page in this scope, ordered newest-first, so the
  // most recent one is just its first entry.
  const lastSession = todaySessions[0] || null
  function relativeDay(dateStr) {
    if (!dateStr) return ''
    const days = Math.round((new Date(today + 'T00:00:00') - new Date(dateStr + 'T00:00:00')) / 86400000)
    if (days <= 0) return 'Today'
    if (days === 1) return 'Yesterday'
    return `${days} days ago`
  }

  // This Week's Man-Hours — same crew x (hours - lunch break) math as the
  // Sheet Report (Canvas.jsx) and Reports.jsx, summed over the last 7
  // calendar days (today included) across every page in this scope.
  const weekStart = new Date(today + 'T00:00:00')
  weekStart.setDate(weekStart.getDate() - 6)
  const weekStartStr = weekStart.toLocaleDateString('en-CA')
  const lunchHours = (project?.lunch_break_minutes || 0) / 60
  const sessionManHours = s => (s.total_hours != null ? s.total_hours : (s.crew_size || 0) * Math.max(0, (s.hours_worked || 0) - lunchHours))
  const weekManHours = todaySessions
    .filter(s => s.work_date >= weekStartStr)
    .reduce((sum, s) => sum + sessionManHours(s), 0)

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
      {/* Main column and sidebar scroll independently of each other (same
          technique as the job dashboard, ProjectDetail.jsx) — each is its
          own overflow-auto panel inside a fixed-height row, instead of the
          whole page scrolling as one. */}
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
                  <>
                    <button onClick={() => setShowImportAutodesk(true)} className="btn-secondary flex items-center gap-1.5 text-xs">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Import from Autodesk
                    </button>
                    <button onClick={() => setShowAddPage(true)} className="btn-primary flex items-center gap-1.5 text-xs">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add Floor Plan
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="px-6 sm:px-10 lg:px-16 pb-8 space-y-6">
          {/* Floor plans — a card, same as every other section here and on
              the job dashboard, instead of a bottom-border strip. */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Floor Plans</h2>
            {/* Server-side tiling (api/tiles/generate.js) can take minutes and
                doesn't need this page open to finish — tile_status is read
                straight from the page rows loadData() already fetched, so
                this shows correctly even after leaving and coming back. */}
            {pages.filter(p => p.tile_status === 'processing' || p.tile_status === 'complete' || p.tile_status === 'failed').map(page => (
              <div
                key={page.id}
                className={`flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg border text-sm ${
                  page.tile_status === 'processing' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400'
                    : page.tile_status === 'complete' ? 'bg-accent/10 border-accent/30 text-accent'
                    : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {page.tile_status === 'processing' && (
                    <div className="w-3.5 h-3.5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin shrink-0" />
                  )}
                  <span className="truncate">
                    {page.tile_status === 'processing' && <>"{page.name}" is still processing on our servers…</>}
                    {page.tile_status === 'complete' && <>"{page.name}" is complete!</>}
                    {page.tile_status === 'failed' && <>"{page.name}" failed to process on our servers{page.tile_error ? `: ${page.tile_error}` : '.'}</>}
                  </span>
                </span>
                {page.tile_status !== 'processing' && (
                  <button onClick={() => dismissTileBanner(page)} className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
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
                            onClick={e => { e.stopPropagation(); setPageSettingsTarget(page) }}
                            className="absolute bottom-1 left-1 p-0.5 rounded bg-black/60 opacity-0 group-hover/tab:opacity-100 transition-opacity"
                            title="Sheet Settings — unit of measure, daily/total target"
                          >
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); generateTiles(page, e.shiftKey) }}
                            disabled={!!tilingPageId}
                            className={`absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 transition-opacity flex items-center gap-0.5 ${
                              tilingPageId === page.id ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'
                            } ${page.tile_meta ? 'hover:bg-black/60' : 'hover:bg-accent/60'}`}
                            title={
                              (page.tile_meta ? 'Regenerate deep-zoom tiles' : 'Generate deep-zoom tiles (smooth, fast zoom on iPad and desktop)') +
                              ' — Shift+click to generate on our servers directly (skips the browser attempt; use this if it failed/hung before)'
                            }
                          >
                            {tilingPageId === page.id ? (
                              <span className="text-[9px] text-white font-medium">{tilingServerSide ? 'Server…' : `${tilingProgress}%`}</span>
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
              <div>
                <span className="text-xs text-muted font-medium block mb-2">Daily Progress</span>
                <UomProgressBar groups={dailyGroups} />
              </div>
              <div>
                <span className="text-xs text-muted font-medium block mb-2">Total Progress</span>
                <UomProgressBar groups={totalGroups} />
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
                      // A session can carry sf and/or lf depending on which
                      // tools were used, independent of this scope's own
                      // target unit — show whichever the day's sessions
                      // actually produced rather than assuming SF.
                      const dateSF = dateSessions.reduce((sum, s) => sum + (parseFloat(s.sf) || 0), 0)
                      const dateLF = dateSessions.reduce((sum, s) => sum + (parseFloat(s.lf) || 0), 0)
                      const dateTotals = [
                        dateSF > 0 && `${dateSF.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF`,
                        dateLF > 0 && `${dateLF.toLocaleString(undefined, { maximumFractionDigits: 0 })} LF`,
                      ].filter(Boolean).join(' · ') || '0 SF'
                      const label = (() => {
                        try { return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
                        catch { return date }
                      })()
                      return (
                        <div key={date} className="px-4 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{label}{date === today && <span className="ml-1.5 text-accent">Today</span>}</p>
                            <p className="text-xs text-muted">{dateTotals}</p>
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
                                    (() => { const sf = parseFloat(session.sf) || 0; const lf = parseFloat(session.lf) || 0; const ct = session.count_data?.length || 0; const parts = [sf > 0 && `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF`, lf > 0 && `${lf.toLocaleString(undefined, { maximumFractionDigits: 0 })} LF`, ct > 0 && `${ct} items`].filter(Boolean); return parts.length > 0 ? parts.join(' · ') : '0 SF' })(),
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

        {/* Sidebar — its own scroll panel (see the row's comment above),
            plus a left border on lg so it reads as its own column rather
            than an extension of the main content it sits beside. */}
        <div className="lg:w-72 shrink-0 overflow-auto lg:border-l lg:border-border">
          <div className="p-4 sm:p-6 space-y-4">
            {/* Scope Tags — rolled up from whichever of this scope's
                sheets are tagged (Sheet Settings), since tags live
                per-sheet now, not on the scope itself. Always shown
                (with an empty state) rather than disappearing when a
                scope has no tagged sheets yet, so every scope's sidebar
                has the same shape. Just the tag name — its rate lives in
                Sheet Settings/Company Hub, not repeated here. */}
            <div>
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Scope Tags</h3>
              {scopeTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {scopeTags.map(t => (
                    <span key={t.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/30">
                      {t.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">No tags on this scope's sheets yet</p>
              )}
            </div>

            {/* Last Activity — the single most recent session across every
                page in this scope, so a stalled scope is obvious at a
                glance instead of requiring a scroll through Recent
                Sessions to notice. */}
            <div>
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Last Activity</h3>
              {lastSession ? (
                <div className="bg-surface-2 rounded-lg p-2.5 flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-full shrink-0" style={{ backgroundColor: lastSession.color || '#facc15' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{lastSession.name || 'Session'}</p>
                    <p className="text-xs text-muted">{relativeDay(lastSession.work_date)} · {lastSession.profiles?.full_name || 'Unknown'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted">No sessions yet</p>
              )}
            </div>

            {/* This Week's Man-Hours — same crew x (hours - lunch break)
                math as the Sheet Report/Reports.jsx, last 7 calendar days
                across every page in this scope. */}
            <div>
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">This Week's Man-Hours</h3>
              <div className="bg-surface-2 rounded-lg p-3">
                <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight">{weekManHours.toFixed(1)}</p>
                <p className="text-xs text-muted mt-0.5">last 7 days</p>
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
                          {(() => { const sf = parseFloat(session.sf) || 0; const lf = parseFloat(session.lf) || 0; const ct = session.count_data?.length || 0; const parts = [sf > 0 && `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF`, lf > 0 && `${lf.toLocaleString(undefined, { maximumFractionDigits: 0 })} LF`, ct > 0 && `${ct} items`].filter(Boolean); return parts.length > 0 ? parts.join(' · ') : '0 SF' })()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scope Members */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Scope Members</h3>
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
      {showImportAutodesk && (
        <ImportAutodeskModal
          projectId={projectId}
          onClose={() => setShowImportAutodesk(false)}
          onCreated={newPage => {
            setShowImportAutodesk(false)
            loadData().then(() => setActivePage(newPage))
          }}
        />
      )}
      {pageSettingsTarget && (
        <PageSettingsModal
          page={pageSettingsTarget}
          onClose={() => setPageSettingsTarget(null)}
          onSaved={updates => {
            setPages(ps => ps.map(p => p.id === pageSettingsTarget.id ? { ...p, ...updates } : p))
            if (activePage?.id === pageSettingsTarget.id) setActivePage(a => ({ ...a, ...updates }))
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
          scope={project}
          canEditCost={canEditFinancials}
          onClose={() => setShowScopeSettings(false)}
          onSaved={patch => setProject(p => ({ ...p, ...patch }))}
        />
      )}
    </Layout>
  )
}
