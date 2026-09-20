import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// Single-tenant for now — there's only one organization, so this is hard-
// coded rather than built out into an org switcher nobody needs yet.
const ORGANIZATION_ID = '2fc904e9-daa0-4d4d-8fb3-85fb0e84360e'

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
}

function JobCard({ job, totalSF, activeScopeCount, onClick }) {
  return (
    <div
      onClick={onClick}
      className="card hover:border-accent/40 hover:bg-surface/80 cursor-pointer transition-all duration-150 group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-accent truncate">{job.name}</h3>
          {job.gc_name && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">GC: {job.gc_name}</p>
          )}
        </div>
        <span className={`${badgeClass(job.status)} ml-2 shrink-0 capitalize`}>{job.status || 'active'}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-surface-2 rounded-lg p-2.5">
          <p className="text-xs text-muted mb-0.5">Total SF Cleaned</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {totalSF.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs font-normal text-muted">SF</span>
          </p>
        </div>
        <div className="bg-surface-2 rounded-lg p-2.5">
          <p className="text-xs text-muted mb-0.5">Active Scopes</p>
          <p className="text-sm font-semibold text-accent">{activeScopeCount}</p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <span className="text-xs text-muted">Click to open job</span>
        <svg className="w-4 h-4 text-muted group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  )
}

export default function Jobs() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [orgName, setOrgName] = useState('')
  const [jobs, setJobs] = useState([])
  const [sfByJob, setSfByJob] = useState({})
  const [activeScopesByJob, setActiveScopesByJob] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  async function loadJobs() {
    setLoading(true)
    setLoadError('')
    try {
      const { data: jobsData, error: jobsErr } = await supabase
        .from('jobs')
        .select('*, organizations(name)')
        .eq('organization_id', ORGANIZATION_ID)
        .order('created_at', { ascending: false })
      if (jobsErr) throw jobsErr

      setJobs(jobsData || [])
      setOrgName(jobsData?.[0]?.organizations?.name || '')

      const jobIds = (jobsData || []).map(j => j.id)
      if (jobIds.length === 0) { setSfByJob({}); setActiveScopesByJob({}); return }

      // Scopes (projects) under these jobs — needed for both the active-
      // scope count and to map each page/session back to its job.
      const { data: scopes } = await supabase
        .from('projects')
        .select('id, job_id, status')
        .in('job_id', jobIds)

      const activeMap = {}
      const scopeToJob = {}
      ;(scopes || []).forEach(s => {
        scopeToJob[s.id] = s.job_id
        if (s.status === 'active') activeMap[s.job_id] = (activeMap[s.job_id] || 0) + 1
      })
      setActiveScopesByJob(activeMap)

      const scopeIds = Object.keys(scopeToJob)
      if (scopeIds.length === 0) { setSfByJob({}); return }

      const { data: pages } = await supabase
        .from('pages')
        .select('id, project_id')
        .in('project_id', scopeIds)

      const pageToJob = {}
      ;(pages || []).forEach(pg => { pageToJob[pg.id] = scopeToJob[pg.project_id] })
      const pageIds = Object.keys(pageToJob)
      if (pageIds.length === 0) { setSfByJob({}); return }

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
      setSfByJob(sfMap)
    } catch (err) {
      console.error('[Jobs] loadJobs error:', err)
      setLoadError(err.message || 'Failed to load jobs. Please try refreshing.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) loadJobs()
  }, [user])

  const filtered = jobs.filter(j => {
    const matchSearch = !searchTerm || j.name.toLowerCase().includes(searchTerm.toLowerCase()) || (j.gc_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = filterStatus === 'all' || j.status === filterStatus
    return matchSearch && matchStatus
  })

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">{orgName || 'Loading…'}</p>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Jobs</h1>
            <p className="text-sm text-muted mt-0.5">
              {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
            </p>
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
              placeholder="Search jobs..."
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
                <div className="h-4 bg-surface-3 rounded w-1/2 mb-4" />
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="h-14 bg-surface-3 rounded-lg" />
                  <div className="h-14 bg-surface-3 rounded-lg" />
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
            <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">Failed to load jobs</p>
            <p className="text-sm text-muted mb-4">{loadError}</p>
            <button onClick={loadJobs} className="btn-secondary">
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
            <p className="text-gray-500 dark:text-gray-400 font-medium">No jobs found</p>
            <p className="text-sm text-muted mt-1">
              {jobs.length === 0 ? 'No jobs have been created yet.' : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(job => (
              <JobCard
                key={job.id}
                job={job}
                totalSF={sfByJob[job.id] || 0}
                activeScopeCount={activeScopesByJob[job.id] || 0}
                onClick={() => navigate(`/jobs/${job.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
