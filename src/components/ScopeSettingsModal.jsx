import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const STATUS_OPTIONS = ['active', 'completed', 'on hold']
const UOM_OPTIONS = ['SF', 'LF', 'Count']

// Shared by both ProjectDetail.jsx (the gear icon on a scope's card in the
// Scopes list) and ScopeDetail.jsx (the gear icon once you're inside a
// scope) — these used to be two separate copies of this modal that had
// quietly drifted apart (one had the Tags/production-rate picker and unit
// selector, the other didn't; one gated Contract Cost by role, the other
// always allowed it). One shared modal means a feature added here shows up
// in both places automatically instead of drifting apart again.
//
// Deliberately never touches `description` — ScopeDetail.jsx's own "Edit
// Info" is the one place that field is actually meant to be a distinct
// subtitle from the name (shown below it when set); this modal only ever
// edits `name`, matching how ScopeDetail.jsx's settings always worked.
export default function ScopeSettingsModal({ scope, canEditCost = true, onClose, onSaved }) {
  const { profile } = useAuth()
  const [name, setName] = useState(scope.name || '')
  const [status, setStatus] = useState(scope.status || 'active')
  const [uom, setUom] = useState(scope.uom || 'SF')
  const [dailyTarget, setDailyTarget] = useState(scope.daily_sf_target ?? '')
  const [totalTarget, setTotalTarget] = useState(scope.total_sf_target ?? '')
  const [cost, setCost] = useState(scope.cost ?? '')
  const [lunchBreak, setLunchBreak] = useState(scope.lunch_break_minutes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Tags: fetched once from the org's shared list (Company Hub) plus this
  // scope's current selections, so picking one is a dropdown rather than
  // free typing — see supabase-migration-tags-production-rates.sql. A
  // tag's own uom is always lowercase sf/lf (its DB CHECK constraint);
  // this scope's uom is the pre-existing SF/LF/Count field, so matching
  // the two is case-insensitive throughout.
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
    supabase.from('project_tags').select('tag_id').eq('project_id', scope.id)
      .then(({ data, error: err }) => {
        if (err) { setTagsError('Could not load this scope\'s tags — run supabase-migration-tags-production-rates.sql if you haven\'t yet.'); return }
        const ids = (data || []).map(r => r.tag_id)
        setSelectedTagIds(ids)
        setInitialTagIds(ids)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.organization_id, scope.id])

  const uomLower = uom.toLowerCase()
  const selectedTags = selectedTagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean)
  // A tag only drives the target if it actually has a rate for the unit
  // this scope is tracked in — a purely descriptive tag (no rate set), one
  // whose rate is in the other unit, or any tag at all on a Count scope
  // (tags only support sf/lf rates) is just a label here.
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
      // tags.uom only allows 'sf'/'lf' — a Count-uom scope creating a new
      // tag still needs a valid value, so it defaults to 'sf' (the tag
      // just won't drive this scope's target either way, same as any
      // other uom mismatch).
      const { data, error: err } = await supabase.from('tags')
        .insert({ organization_id: profile.organization_id, name: trimmed, uom: uomLower === 'lf' ? 'lf' : 'sf' })
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
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setError('')
    try {
      const patch = {
        name: trimmedName,
        status,
        uom,
        daily_sf_target: parseFloat(dailyTarget) || 0,
        total_sf_target: parseFloat(totalTarget) || 0,
        lunch_break_minutes: lunchBreak === '' ? null : (parseFloat(lunchBreak) || null),
      }
      if (canEditCost) patch.cost = cost === '' ? null : (parseFloat(cost) || null)
      const { data, error: sErr } = await supabase.from('projects').update(patch).eq('id', scope.id).select().single()
      if (sErr) throw sErr
      if (!data) throw new Error('Nothing was saved — you may not have permission to edit this scope.')

      const addedIds = selectedTagIds.filter(id => !initialTagIds.includes(id))
      const removedIds = initialTagIds.filter(id => !selectedTagIds.includes(id))
      if (addedIds.length > 0) {
        const { error: insErr } = await supabase.from('project_tags')
          .insert(addedIds.map(tag_id => ({ project_id: scope.id, tag_id })))
        if (insErr) throw insErr
      }
      if (removedIds.length > 0) {
        const { error: delErr } = await supabase.from('project_tags')
          .delete().eq('project_id', scope.id).in('tag_id', removedIds)
        if (delErr) throw delErr
      }

      onSaved({ ...patch, tags: selectedTags })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Rounding and scrolling on separate layers (see ProfileModal.jsx's
          copy of this comment) — this form is long enough to need actual
          scrolling once tags/targets are both showing. */}
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 overflow-y-auto min-h-0">
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Status</label>
                <select className="input capitalize" value={status} onChange={e => setStatus(e.target.value)}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                {/* Not every scope is measured in square feet — base
                    install is tracked in linear feet, fixture counts in
                    units, etc. This is what a session in this scope
                    defaults to unless its own markup says otherwise. */}
                <label className="label">Unit of Measure</label>
                <select className="input" value={uom} onChange={e => setUom(e.target.value)}>
                  {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="label">Tags</label>
              <p className="text-xs text-muted mb-1.5">
                Tag this scope with a line item from Company Hub to compare its production against your company's standard rate.
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
                {activeRateTag.rate_per_day != null && <>{activeRateTag.rate_per_day.toLocaleString()} {uom}/day</>}
                {activeRateTag.rate_per_day != null && activeRateTag.rate_per_man_hour != null && ' · '}
                {activeRateTag.rate_per_man_hour != null && <>{activeRateTag.rate_per_man_hour.toLocaleString()} {uom}/man-hr</>}
                . Leave the daily target below blank to use it, or set a number to override just this scope.
              </div>
            )}
            {tagRateConflict && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-yellow-700 dark:text-yellow-400 text-sm">
                This scope has more than one {uom} tag with a rate ({rateTagsForUom.map(t => t.name).join(', ')}) — remove one, or set a manual target below to make it explicit.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Daily {uom} Target</label>
                <input className="input" type="number" min="0" value={dailyTarget} onChange={e => setDailyTarget(e.target.value)} placeholder={activeRateTag?.rate_per_day ? `${activeRateTag.rate_per_day} (from tag)` : '5000'} />
              </div>
              <div>
                <label className="label">Total {uom} Target</label>
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
    </div>
  )
}
