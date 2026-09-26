// Free-plan usage limits, enforced client-side right before the relevant
// insert (Team.jsx's invite, Projects.jsx's New Project, ProjectDetail.jsx's
// Add Scope, Canvas.jsx's Save Session). This is a soft usage cap for the
// billing model, not a security boundary — every one of those call sites
// already has (or cheaply fetches) the count itself; this file only holds
// the numbers and the one comparison, so all four read the same limits.
//
// Paid plans (starter/pro/business/enterprise) have no entry here, so
// limitsForPlan returns null and limitError always passes — they're
// unlimited until real per-plan limits are decided.
export const PLAN_LIMITS = {
  free: { maxUsers: 1, maxJobs: 2, maxScopesPerJob: 1, maxSessionsPerJob: 10 },
}

export function limitsForPlan(plan) {
  return PLAN_LIMITS[plan || 'free'] || null
}

// A job with jobs.unlimited_until in the future is exempt from its own
// per-job limits (maxScopesPerJob/maxSessionsPerJob) regardless of the
// org's plan — granted from the Super Admin panel (e.g. a timed trial on
// one project) and enforced server-side too: see
// supabase-migration-plan-limits.sql's trigger, which reverts any change
// to this column from a non-super-admin caller. maxUsers/maxJobs are
// org-wide, not per-job, so this never exempts those two.
export function jobIsUnlimited(job) {
  return !!job?.unlimited_until && new Date(job.unlimited_until) > new Date()
}

const PLAN_NAME = { free: 'Free', starter: 'Starter', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' }

const LIMIT_TEXT = {
  maxUsers: limit => `up to ${limit} user${limit === 1 ? '' : 's'}`,
  maxJobs: limit => `up to ${limit} project${limit === 1 ? '' : 's'}`,
  maxScopesPerJob: limit => `${limit} scope${limit === 1 ? '' : 's'} per project`,
  maxSessionsPerJob: limit => `${limit} session${limit === 1 ? '' : 's'} per project`,
}

// Returns an error message if adding ONE MORE of `kind` would exceed the
// plan's limit, or null if it's fine to proceed. currentCount is whatever
// already exists before the one being added — checked as currentCount >=
// limit (not >), so hitting the cap blocks the next attempt rather than
// letting one extra slip through first.
export function limitError(plan, kind, currentCount) {
  const limits = limitsForPlan(plan)
  if (!limits) return null
  const limit = limits[kind]
  if (limit == null || currentCount < limit) return null
  const planName = PLAN_NAME[plan] || plan || 'Free'
  return `Your ${planName} plan allows ${LIMIT_TEXT[kind](limit)}. Upgrade to add more.`
}
