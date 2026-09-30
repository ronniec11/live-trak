import { useState } from 'react'
import { supabase } from '../lib/supabase'

const STATUS_OPTIONS = ['active', 'completed', 'on hold']

// Shared by both ProjectDetail.jsx (the gear icon on a scope's card in the
// Scopes list) and ScopeDetail.jsx (the gear icon once you're inside a
// scope) — these used to be two separate copies of this modal that had
// quietly drifted apart (one had the Tags/production-rate picker and unit
// selector, the other didn't; one gated Contract Cost by role, the other
// always allowed it). One shared modal means a feature added here shows up
// in both places automatically instead of drifting apart again.
//
// Unit of Measure, Tags, and Daily/Total Target all moved OUT of this modal
// and onto the individual sheet (ScopeDetail.jsx's Sheet Settings, opened
// from a page thumbnail's own gear icon) — see
// supabase-migration-page-uom.sql/supabase-migration-page-tags.sql. A scope
// can now hold sheets doing different kinds of work in different units
// (e.g. an LF floor-cleaning sheet and an Each "Generators" sheet in the
// same scope), so a single scope-wide unit/tag/target could never
// correctly represent that; each sheet owns its own.
//
// Deliberately never touches `description` — ScopeDetail.jsx's own "Edit
// Info" is the one place that field is actually meant to be a distinct
// subtitle from the name (shown below it when set); this modal only ever
// edits `name`, matching how ScopeDetail.jsx's settings always worked.
export default function ScopeSettingsModal({ scope, canEditCost = true, onClose, onSaved }) {
  const [name, setName] = useState(scope.name || '')
  const [status, setStatus] = useState(scope.status || 'active')
  const [cost, setCost] = useState(scope.cost ?? '')
  const [lunchBreak, setLunchBreak] = useState(scope.lunch_break_minutes ?? '')
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
        lunch_break_minutes: lunchBreak === '' ? null : (parseFloat(lunchBreak) || null),
      }
      if (canEditCost) patch.cost = cost === '' ? null : (parseFloat(cost) || null)
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
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
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
            <div>
              <label className="label">Status</label>
              <select className="input capitalize" value={status} onChange={e => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
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
