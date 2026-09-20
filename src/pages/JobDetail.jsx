import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
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
      className="card hover:border-accent/40 hover:bg-surface/80 cursor-pointer transition-all duration-150 group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-accent truncate">{scope.name}</h3>
          {scope.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{scope.description}</p>
          )}
        </div>
        <span className={`${badgeClass(scope.status)} ml-2 shrink-0 capitalize`}>{scope.status || 'active'}</span>
      </div>

      <div className="bg-surface-2 rounded-lg p-2.5 mb-3">
        <p className="text-xs text-muted mb-0.5">Total SF Cleaned</p>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {allTimeSF.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs font-normal text-muted">SF</span>
        </p>
      </div>

      {/* Daily progress bar (green) */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted">Daily progress</span>
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

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <span className="text-xs text-muted">Click to open scope</span>
        <svg className="w-4 h-4 text-muted group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  )
}

export default function JobDetail() {
  const { jobId } = useParams()
  const navigate = useNavigate()

  const [job, setJob] = useState(null)
  const [scopes, setScopes] = useState([])
  const [sfTodayByScope, setSfTodayByScope] = useState({})
  const [sfTotalByScope, setSfTotalByScope] = useState({})
  const [recentSessions, setRecentSessions] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

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
        setSfTodayByScope({}); setSfTotalByScope({}); setRecentSessions([]); setMembers([])
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
        setSfTodayByScope({}); setSfTotalByScope({}); setRecentSessions([])
        return
      }

      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, page_id, sf, work_date, created_at, name, color, profiles(full_name)')
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

      setRecentSessions((sessions || []).slice(0, 15).map(s => ({
        ...s,
        scopeName: scopeNameById[pageToScope[s.page_id]] || 'Unknown scope',
        pageName: pageToName[s.page_id] || 'Unknown sheet',
      })))
    } catch (err) {
      console.error('[JobDetail] loadJobDetail error:', err)
      setLoadError(err.message || 'Failed to load this job. Please try refreshing.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadJobDetail() }, [jobId])

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
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start gap-3 mb-6">
          <button onClick={() => navigate('/jobs')} className="btn-ghost p-1.5 mt-0.5 shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">{job.organizations?.name}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{job.name}</h1>
              <span className={`${badgeClass(job.status)} capitalize`}>{job.status || 'active'}</span>
            </div>
            {job.gc_name && <p className="text-sm text-muted mt-0.5">GC: {job.gc_name}</p>}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Main: scope cards */}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Scopes</h2>
            {scopes.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 dark:text-gray-400 font-medium">No scopes on this job yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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

            {/* Recent sessions across all scopes */}
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Recent Sessions</h2>
            <div className="border border-border rounded-xl overflow-hidden">
              {recentSessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted">No sessions saved yet</div>
              ) : (
                <div className="divide-y divide-border">
                  {recentSessions.map(session => (
                    <div key={session.id} className="px-4 py-3 flex items-center gap-2.5">
                      <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: session.color || '#facc15' }} />
                      <p className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{session.name || 'Session'}</p>
                      <p className="text-xs text-muted shrink-0">
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

          {/* Sidebar: team members */}
          <div className="lg:w-64 shrink-0">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Team Members</h3>
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
    </Layout>
  )
}
