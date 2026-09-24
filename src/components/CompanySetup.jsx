import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// Rendered by ProtectedRoute in place of the app whenever a signed-in
// user's profile has no organization_id yet — the state a brand new
// self-signup account is in between confirming their email and actually
// having a company (see Login.jsx's "Create your company" mode and
// supabase-migration-org-scoping-stage5-signup.sql). Everyone else (every
// existing invited team member) already has organization_id set from the
// moment their profile is created, so they never see this at all.
export default function CompanySetup() {
  const { user, signOut, refreshProfile } = useAuth()
  const [companyName, setCompanyName] = useState(user?.user_metadata?.pending_organization_name || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!companyName.trim()) return
    setSaving(true)
    setError('')
    try {
      const { error: rpcErr } = await supabase.rpc('create_organization_and_claim_admin', {
        org_name: companyName.trim(),
      })
      if (rpcErr) throw rpcErr
      await refreshProfile()
    } catch (err) {
      setError(err.message || 'Could not create your company — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-4 mb-8">
          <img src="/live-trak-icon.svg?v=3" style={{ width: '56px', height: '56px' }} />
          <h1 className="text-3xl font-extralight text-gray-900 dark:text-white tracking-tight">Live-Trak</h1>
        </div>

        <div className="card border-border/60">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">One last step</h2>
          <p className="text-sm text-muted mb-5">
            Confirm your company name to finish setting up your account. You'll be the first admin — you can invite the rest of your team afterward from the Team page.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Company Name</label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="input"
                placeholder="Mopping Man"
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
                  Setting up...
                </>
              ) : 'Continue'}
            </button>
            <button type="button" onClick={signOut} className="btn-ghost w-full text-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
