import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// NOTE: Run supabase-migration-super-admin.sql before using this page — it
// adds profiles.is_super_admin, organizations.status, and the additive RLS
// policies that let an is_super_admin account read/write across every
// company. Without it, every query below silently returns only the
// caller's own organization (same as any other user), which looks like an
// empty/broken panel rather than an obvious error.

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'pm', label: 'PM' },
  { value: 'superintendent', label: 'Superintendent' },
  { value: 'foreman', label: 'Foreman' },
]
const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, r.label]))

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}

function fmtDateTime(iso) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString()
}

function fmtSF(n) {
  return Math.round(n || 0).toLocaleString()
}

function CloseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function ModalShell({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-surface border border-border rounded-2xl w-full ${wide ? 'max-w-lg' : 'max-w-md'} p-6 max-h-[85vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate pr-4">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 shrink-0"><CloseIcon /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── View company ──────────────────────────────────────────────────────────
function CompanyViewModal({ org, users, jobs, sfByOrg, onClose }) {
  const orgUsers = users.filter(u => u.organization_id === org.id)
  const orgJobs = jobs.filter(j => j.organization_id === org.id)
  return (
    <ModalShell title={org.name} onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div><p className="label">Users</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{orgUsers.length}</p></div>
        <div><p className="label">Jobs</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{orgJobs.length}</p></div>
        <div><p className="label">SF Tracked</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{fmtSF(sfByOrg[org.id])}</p></div>
      </div>
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Users</h3>
      <div className="space-y-1 mb-5">
        {orgUsers.map(u => (
          <div key={u.id} className="flex items-center justify-between text-sm py-1">
            <span className="text-gray-800 dark:text-gray-200 truncate">{u.full_name || u.email}</span>
            <span className="text-xs text-muted capitalize shrink-0">{ROLE_LABELS[u.role] || u.role}</span>
          </div>
        ))}
        {orgUsers.length === 0 && <p className="text-sm text-muted">No users yet.</p>}
      </div>
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Jobs</h3>
      <div className="space-y-1">
        {orgJobs.map(j => (
          <div key={j.id} className="flex items-center justify-between text-sm py-1">
            <span className="text-gray-800 dark:text-gray-200 truncate">{j.name}</span>
            <span className="text-xs text-muted capitalize shrink-0">{j.status}</span>
          </div>
        ))}
        {orgJobs.length === 0 && <p className="text-sm text-muted">No jobs yet.</p>}
      </div>
      <button onClick={onClose} className="btn-secondary w-full mt-5">Close</button>
    </ModalShell>
  )
}

// ── Edit Admin ───────────────────────────────────────────────────────────
// Promotes the picked user to Admin — it does not demote whoever already
// holds that role (multiple admins per company is already normal
// everywhere else in the app, e.g. Team.jsx).
function ChangeAdminModal({ org, users, onClose, onSaved }) {
  const orgUsers = users.filter(u => u.organization_id === org.id)
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!selectedId) return
    setSaving(true)
    setError('')
    try {
      const { data, error: uErr } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', selectedId).select().single()
      if (uErr) throw uErr
      if (!data) throw new Error('Nothing was saved — check the profiles_update_super_admin RLS policy (see supabase-migration-super-admin.sql).')
      onSaved(`${data.full_name || data.email} is now an admin at ${org.name}.`)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title={`Edit Admin — ${org.name}`} onClose={onClose}>
      <p className="text-xs text-muted mb-3">Pick who should be an admin at this company. This sets their role to Admin — it doesn't remove admin from anyone else.</p>
      <div className="space-y-1.5 max-h-72 overflow-y-auto mb-4">
        {orgUsers.map(u => (
          <label key={u.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selectedId === u.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-2'}`}>
            <input type="radio" name="admin-pick" className="accent-accent" checked={selectedId === u.id} onChange={() => setSelectedId(u.id)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-900 dark:text-white truncate">{u.full_name || u.email}</p>
              <p className="text-xs text-muted truncate">{u.email} · {ROLE_LABELS[u.role] || u.role}{u.role === 'admin' ? ' (already admin)' : ''}</p>
            </div>
          </label>
        ))}
        {orgUsers.length === 0 && <p className="text-sm text-muted py-2">No users at this company yet.</p>}
      </div>
      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm mb-4">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button onClick={handleSave} disabled={!selectedId || saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Make Admin'}</button>
      </div>
    </ModalShell>
  )
}

// ── Change Role ──────────────────────────────────────────────────────────
function ChangeRoleModal({ user, onClose, onSaved }) {
  const [role, setRole] = useState(user.role || 'foreman')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const { data, error: uErr } = await supabase.from('profiles').update({ role }).eq('id', user.id).select().single()
      if (uErr) throw uErr
      if (!data) throw new Error('Nothing was saved — check the profiles_update_super_admin RLS policy.')
      onSaved(`${data.full_name || data.email}'s role is now ${ROLE_LABELS[role] || role}.`)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title={`Change Role — ${user.full_name || user.email}`} onClose={onClose}>
      <label className="label">Role</label>
      <select className="input mb-4" value={role} onChange={e => setRole(e.target.value)}>
        {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm mb-4">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </ModalShell>
  )
}

// ── Change Company ──────────────────────────────────────────────────────
function ChangeCompanyModal({ user, orgs, onClose, onSaved }) {
  const [orgId, setOrgId] = useState(user.organization_id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (orgId === user.organization_id) { onClose(); return }
    const targetName = orgs.find(o => o.id === orgId)?.name || 'that company'
    if (!confirm(`Move ${user.full_name || user.email} to ${targetName}? They'll immediately lose access to their current company's jobs and gain access to whatever ${targetName} has.`)) return
    setSaving(true)
    setError('')
    try {
      const { data, error: uErr } = await supabase.from('profiles').update({ organization_id: orgId }).eq('id', user.id).select().single()
      if (uErr) throw uErr
      if (!data) throw new Error('Nothing was saved — check the profiles_update_super_admin RLS policy.')
      onSaved(`${data.full_name || data.email} moved to ${targetName}.`)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title={`Change Company — ${user.full_name || user.email}`} onClose={onClose}>
      <label className="label">Company</label>
      <select className="input mb-4" value={orgId} onChange={e => setOrgId(e.target.value)}>
        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm mb-4">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button onClick={handleSave} disabled={saving || !orgId} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </ModalShell>
  )
}

export default function SuperAdmin() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isSuperAdmin = profile?.is_super_admin === true

  const [loading, setLoading] = useState(true)
  const [orgs, setOrgs] = useState([])
  const [users, setUsers] = useState([])
  const [jobs, setJobs] = useState([])
  const [sfByOrg, setSfByOrg] = useState({})
  const [totalSF, setTotalSF] = useState(0)
  const [toast, setToast] = useState('')

  const [viewOrg, setViewOrg] = useState(null)
  const [adminOrg, setAdminOrg] = useState(null)
  const [changeRoleUser, setChangeRoleUser] = useState(null)
  const [changeCompanyUser, setChangeCompanyUser] = useState(null)

  useEffect(() => {
    if (profile && !isSuperAdmin) navigate('/projects', { replace: true })
  }, [profile, isSuperAdmin, navigate])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  async function loadAll() {
    setLoading(true)
    const [
      { data: orgsData, error: orgsErr },
      { data: usersData, error: usersErr },
      { data: jobsData, error: jobsErr },
      { data: projectsData, error: projectsErr },
      { data: pagesData, error: pagesErr },
      { data: sessionsData, error: sessionsErr },
    ] = await Promise.all([
      supabase.from('organizations').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('jobs').select('*'),
      supabase.from('projects').select('id, job_id'),
      supabase.from('pages').select('id, project_id'),
      supabase.from('sessions').select('id, sf, page_id'),
    ])
    if (orgsErr) console.error('[SuperAdmin] organizations load error:', orgsErr)
    if (usersErr) console.error('[SuperAdmin] profiles load error:', usersErr)
    if (jobsErr) console.error('[SuperAdmin] jobs load error:', jobsErr)
    if (projectsErr) console.error('[SuperAdmin] projects load error:', projectsErr)
    if (pagesErr) console.error('[SuperAdmin] pages load error:', pagesErr)
    if (sessionsErr) console.error('[SuperAdmin] sessions load error:', sessionsErr)

    setOrgs(orgsData || [])
    setUsers(usersData || [])
    setJobs(jobsData || [])

    // sessions has no organization_id of its own — the only way to roll up
    // "SF per company" is walking sessions -> pages -> projects -> jobs ->
    // organization_id (same chain the RLS policies themselves walk — see
    // supabase-migration-org-scoping-stage2-rls.sql).
    const jobOrg = new Map((jobsData || []).map(j => [j.id, j.organization_id]))
    const projectJob = new Map((projectsData || []).map(p => [p.id, p.job_id]))
    const pageProject = new Map((pagesData || []).map(pg => [pg.id, pg.project_id]))
    const sfMap = {}
    let total = 0
    for (const s of (sessionsData || [])) {
      const sf = parseFloat(s.sf) || 0
      total += sf
      const projectId = pageProject.get(s.page_id)
      const jobId = projectId != null ? projectJob.get(projectId) : undefined
      const orgId = jobId != null ? jobOrg.get(jobId) : undefined
      if (orgId) sfMap[orgId] = (sfMap[orgId] || 0) + sf
    }
    setSfByOrg(sfMap)
    setTotalSF(total)
    setLoading(false)
  }

  useEffect(() => { if (isSuperAdmin) loadAll() }, [isSuperAdmin])

  async function toggleSuspend(org) {
    const next = org.status === 'suspended' ? 'active' : 'suspended'
    if (!confirm(`${next === 'suspended' ? 'Suspend' : 'Reactivate'} ${org.name}?`)) return
    const { data, error } = await supabase.from('organizations').update({ status: next }).eq('id', org.id).select().single()
    if (error) { showToast(error.message); return }
    if (!data) { showToast('Nothing changed — check the organizations_update_super_admin RLS policy.'); return }
    showToast(`${org.name} ${next === 'suspended' ? 'suspended' : 'reactivated'}.`)
    loadAll()
  }

  async function toggleActive(user) {
    const next = !(user.active !== false)
    if (!confirm(next
      ? `Reactivate ${user.full_name || user.email}? They'll be able to sign in again.`
      : `Deactivate ${user.full_name || user.email}? They'll be signed out and unable to sign back in.`
    )) return
    const { data, error } = await supabase.from('profiles').update({ active: next }).eq('id', user.id).select().single()
    if (error) { showToast(error.message); return }
    if (!data) { showToast('Nothing changed — check the profiles_update_super_admin RLS policy.'); return }
    showToast(`${user.full_name || user.email} ${next ? 'reactivated' : 'deactivated'}.`)
    loadAll()
  }

  if (!isSuperAdmin) return null

  const orgById = new Map(orgs.map(o => [o.id, o]))
  const usersByOrg = new Map()
  const jobsByOrg = new Map()
  for (const u of users) usersByOrg.set(u.organization_id, (usersByOrg.get(u.organization_id) || 0) + 1)
  for (const j of jobs) jobsByOrg.set(j.organization_id, (jobsByOrg.get(j.organization_id) || 0) + 1)

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Super Admin</h1>
          <button onClick={loadAll} className="btn-secondary">Refresh</button>
        </div>

        {toast && <div className="bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 text-accent text-sm mb-4">{toast}</div>}

        {loading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : (
          <>
            {/* Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <div className="card">
                <p className="label">Total Companies</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{orgs.length}</p>
              </div>
              <div className="card">
                <p className="label">Total Users</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{users.length}</p>
              </div>
              <div className="card">
                <p className="label">Total Jobs</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{jobs.length}</p>
              </div>
              <div className="card">
                <p className="label">Total SF Tracked</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{fmtSF(totalSF)}</p>
              </div>
            </div>

            {/* Companies */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Companies</h2>
              <p className="text-xs text-muted">{orgs.length} compan{orgs.length === 1 ? 'y' : 'ies'}</p>
            </div>
            <div className="card overflow-x-auto mb-8">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-border">
                    <th className="py-2 pr-4">Company</th>
                    <th className="py-2 pr-4 text-right">Users</th>
                    <th className="py-2 pr-4 text-right">Jobs</th>
                    <th className="py-2 pr-4 text-right">SF Tracked</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map(org => (
                    <tr key={org.id} className="border-b border-border/50 text-gray-700 dark:text-gray-300">
                      <td className="py-2 pr-4 text-gray-900 dark:text-white font-medium">{org.name}</td>
                      <td className="py-2 pr-4 text-right">{usersByOrg.get(org.id) || 0}</td>
                      <td className="py-2 pr-4 text-right">{jobsByOrg.get(org.id) || 0}</td>
                      <td className="py-2 pr-4 text-right">{fmtSF(sfByOrg[org.id])}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full capitalize ${org.status === 'suspended' ? 'bg-red-500/10 text-red-500' : 'bg-accent/10 text-accent'}`}>
                          {org.status || 'active'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(org.created_at)}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setViewOrg(org)} className="btn-ghost py-1 px-2 text-xs">View</button>
                          <button onClick={() => setAdminOrg(org)} className="btn-ghost py-1 px-2 text-xs">Edit Admin</button>
                          <button
                            onClick={() => toggleSuspend(org)}
                            className={`btn-ghost py-1 px-2 text-xs ${org.status === 'suspended' ? '' : 'text-red-500 hover:bg-red-500/10'}`}
                          >
                            {org.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {orgs.length === 0 && (
                    <tr><td colSpan={7} className="py-4 text-muted text-center">No companies yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Users */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Users</h2>
              <p className="text-xs text-muted">{users.length} user{users.length === 1 ? '' : 's'}</p>
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-border">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Company</th>
                    <th className="py-2 pr-4">Super Admin</th>
                    <th className="py-2 pr-4">Last Login</th>
                    <th className="py-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const isActive = u.active !== false
                    return (
                      <tr key={u.id} className={`border-b border-border/50 text-gray-700 dark:text-gray-300 ${isActive ? '' : 'opacity-50'}`}>
                        <td className="py-2 pr-4 text-gray-900 dark:text-white font-medium whitespace-nowrap">
                          {u.full_name || '(no name)'}
                          {!isActive && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 align-middle">Deactivated</span>}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">{u.email}</td>
                        <td className="py-2 pr-4 capitalize whitespace-nowrap">{ROLE_LABELS[u.role] || u.role}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">{orgById.get(u.organization_id)?.name || '—'}</td>
                        <td className="py-2 pr-4">{u.is_super_admin ? (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">Yes</span>
                        ) : '—'}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">{fmtDateTime(u.last_login_at)}</td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setChangeRoleUser(u)} className="btn-ghost py-1 px-2 text-xs">Change Role</button>
                            <button onClick={() => setChangeCompanyUser(u)} className="btn-ghost py-1 px-2 text-xs">Change Company</button>
                            <button
                              onClick={() => toggleActive(u)}
                              className={`btn-ghost py-1 px-2 text-xs ${isActive ? 'text-red-500 hover:bg-red-500/10' : ''}`}
                            >
                              {isActive ? 'Deactivate' : 'Reactivate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {users.length === 0 && (
                    <tr><td colSpan={7} className="py-4 text-muted text-center">No users yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {viewOrg && (
        <CompanyViewModal org={viewOrg} users={users} jobs={jobs} sfByOrg={sfByOrg} onClose={() => setViewOrg(null)} />
      )}
      {adminOrg && (
        <ChangeAdminModal
          org={adminOrg} users={users}
          onClose={() => setAdminOrg(null)}
          onSaved={msg => { showToast(msg); loadAll() }}
        />
      )}
      {changeRoleUser && (
        <ChangeRoleModal
          user={changeRoleUser}
          onClose={() => setChangeRoleUser(null)}
          onSaved={msg => { showToast(msg); loadAll() }}
        />
      )}
      {changeCompanyUser && (
        <ChangeCompanyModal
          user={changeCompanyUser} orgs={orgs}
          onClose={() => setChangeCompanyUser(null)}
          onSaved={msg => { showToast(msg); loadAll() }}
        />
      )}
    </Layout>
  )
}
