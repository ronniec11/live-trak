import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const PRESET_COLORS = [
  '#4ade80', '#22d3ee', '#f472b6', '#fb923c', '#a78bfa',
  '#fbbf24', '#f87171', '#34d399', '#60a5fa', '#e879f9',
]

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'pm', label: 'PM' },
  { value: 'superintendent', label: 'Superintendent' },
  { value: 'foreman', label: 'Foreman' },
]

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, r.label]))

function PersonModal({ person, onClose, onSaved }) {
  const isEdit = !!person
  const [form, setForm] = useState({
    full_name: person?.full_name || '',
    email: person?.email || '',
    phone: person?.phone || '',
    company: person?.company || '',
    role: person?.role || 'foreman',
    avatar_color: person?.avatar_color || PRESET_COLORS[0],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.full_name.trim() || !form.email.trim()) return
    setSaving(true)
    setError('')
    try {
      const email = form.email.trim().toLowerCase()
      if (isEdit) {
        const { error: uErr } = await supabase.from('profiles').update({
          full_name: form.full_name.trim(),
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          role: form.role,
          avatar_color: form.avatar_color,
        }).eq('id', person.id)
        if (uErr) throw uErr
      } else {
        // Passwordless invite: creates the auth.users row (firing the
        // existing handle_new_user trigger) and emails them a sign-in link.
        // Never use supabase.auth.admin.* here — that needs the service_role
        // key, which must not exist in client code.
        const { error: authErr } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
            data: { full_name: form.full_name.trim(), role: form.role },
            emailRedirectTo: `${window.location.origin}/projects`,
          },
        })
        if (authErr) throw authErr
        // The trigger may not know about every field (phone/company/
        // avatar_color, and possibly not full_name/role either, depending on
        // its exact metadata keys) — set them directly regardless.
        const { error: uErr } = await supabase.from('profiles').update({
          full_name: form.full_name.trim(),
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          role: form.role,
          avatar_color: form.avatar_color,
        }).eq('email', email)
        if (uErr) throw uErr
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{isEdit ? 'Edit Person' : 'Add Person'}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Full Name *</label>
            <input className="input" value={form.full_name} onChange={e => set('full_name', e.target.value)} required />
          </div>
          <div>
            <label className="label">Email *</label>
            <input
              className="input" type="email" value={form.email}
              onChange={e => set('email', e.target.value)} required disabled={isEdit}
              placeholder="you@company.com"
            />
            {isEdit && <p className="text-xs text-muted mt-1">Email can't be changed here.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Phone</label>
              <input className="input" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="label">Company</label>
              <input className="input" value={form.company} onChange={e => set('company', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Avatar Color</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {PRESET_COLORS.map(c => (
                <button
                  key={c} type="button" onClick={() => set('avatar_color', c)}
                  className={`w-8 h-8 rounded-lg transition-all duration-100 ${
                    form.avatar_color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-white scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Team() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editPerson, setEditPerson] = useState(null)
  const [resendingId, setResendingId] = useState(null)
  const [toast, setToast] = useState('')

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    if (profile && !isAdmin) navigate('/projects', { replace: true })
  }, [profile, isAdmin, navigate])

  async function loadPeople() {
    setLoading(true)
    const { data, error } = await supabase.from('profiles').select('*').order('full_name')
    if (error) console.error('[Team] load error:', error)
    setPeople(data || [])
    setLoading(false)
  }

  useEffect(() => { if (isAdmin) loadPeople() }, [isAdmin])

  async function resendInvite(person) {
    setResendingId(person.id)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: person.email,
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/projects` },
      })
      if (error) throw error
      setToast(`Invite resent to ${person.email}`)
      setTimeout(() => setToast(''), 3000)
    } catch (err) {
      setToast(err.message)
      setTimeout(() => setToast(''), 4000)
    } finally {
      setResendingId(null)
    }
  }

  if (!isAdmin) return null

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Team</h1>
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Person
          </button>
        </div>

        {toast && (
          <div className="bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 text-accent text-sm mb-4">{toast}</div>
        )}

        {loading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : (
          <div className="card divide-y divide-border">
            {people.map(p => (
              <div key={p.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-bg shrink-0"
                  style={{ backgroundColor: p.avatar_color || '#4ade80' }}
                >
                  {(p.full_name || p.email || 'U')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.full_name || '(no name)'}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${p.last_login_at ? 'bg-accent/10 text-accent' : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'}`}>
                      {p.last_login_at ? 'Active' : 'Invited'}
                    </span>
                  </div>
                  <p className="text-xs text-muted truncate">
                    {p.email}{p.phone ? ` · ${p.phone}` : ''}{p.company ? ` · ${p.company}` : ''}
                  </p>
                </div>
                <span className="text-xs text-muted capitalize shrink-0">{ROLE_LABELS[p.role] || p.role}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {!p.last_login_at && (
                    <button
                      onClick={() => resendInvite(p)} disabled={resendingId === p.id}
                      className="btn-ghost py-1 px-2 text-xs"
                    >
                      {resendingId === p.id ? 'Sending...' : 'Resend Invite'}
                    </button>
                  )}
                  <button onClick={() => setEditPerson(p)} className="btn-ghost py-1 px-2 text-xs">Edit</button>
                </div>
              </div>
            ))}
            {people.length === 0 && <p className="text-sm text-muted py-4">No one yet.</p>}
          </div>
        )}
      </div>

      {showAdd && (
        <PersonModal onClose={() => setShowAdd(false)} onSaved={loadPeople} />
      )}
      {editPerson && (
        <PersonModal person={editPerson} onClose={() => setEditPerson(null)} onSaved={loadPeople} />
      )}
    </Layout>
  )
}
