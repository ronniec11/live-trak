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

// A company with organizations.unlimited_until in the future is exempt
// from EVERY limit below (users, projects, scopes per project, sessions
// per project) regardless of its plan — granted from the Super Admin
// panel (e.g. a timed trial for the whole company) and enforced
// server-side too: see supabase-migration-unlimited-access-org.sql's
// trigger, which reverts any change to this column from a non-super-admin
// caller. `org` here is whatever shape a call site already has on hand —
// only .plan and .unlimited_until are read.
export function orgIsUnlimited(org) {
  return !!org?.unlimited_until && new Date(org.unlimited_until) > new Date()
}

const PLAN_NAME = { free: 'Free', starter: 'Starter', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' }

const LIMIT_TEXT = {
  maxUsers: limit => `up to ${limit} user${limit === 1 ? '' : 's'}`,
  maxJobs: limit => `up to ${limit} project${limit === 1 ? '' : 's'}`,
  maxScopesPerJob: limit => `${limit} scope${limit === 1 ? '' : 's'} per project`,
  maxSessionsPerJob: limit => `${limit} session${limit === 1 ? '' : 's'} per project`,
}

// Returns an error message if adding ONE MORE of `kind` would exceed the
// org's plan limit, or null if it's fine to proceed (including when the
// org itself is unlimited — see orgIsUnlimited above). currentCount is
// whatever already exists before the one being added — checked as
// currentCount >= limit (not >), so hitting the cap blocks the next
// attempt rather than letting one extra slip through first.
export function limitError(org, kind, currentCount) {
  if (orgIsUnlimited(org)) return null
  const limits = limitsForPlan(org?.plan)
  if (!limits) return null
  const limit = limits[kind]
  if (limit == null || currentCount < limit) return null
  const planName = PLAN_NAME[org?.plan] || org?.plan || 'Free'
  return `Your ${planName} plan allows ${LIMIT_TEXT[kind](limit)}. Upgrade to add more, or ask your Super Admin for unlimited access.`
}
