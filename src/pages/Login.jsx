import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, user } = useAuth()
  const navigate = useNavigate()

  // A magic-link/invite click that failed to authenticate lands here
  // (ProtectedRoute carries the hash forward) with an error Supabase put
  // right in the URL — most often because the one-time link was already
  // used by the time the person actually clicked it. That's not always
  // user error: some email providers/corporate scanners pre-fetch links in
  // incoming mail to check them for malware, which silently consumes a
  // single-use auth link before the real recipient ever opens it. Reading
  // it here turns "why am I on a plain login form?" into an actual answer.
  const [linkError, setLinkError] = useState('')
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('error=')) return
    const params = new URLSearchParams(hash.slice(1))
    const description = params.get('error_description')
    setLinkError(
      description
        ? description.replace(/\+/g, ' ')
        : 'That link has expired or was already used.'
    )
    // Drop the error out of the URL so refreshing/sharing it doesn't keep
    // re-showing a stale message.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  // Covers a magic-link click landing here: exchanging the link's code for
  // a session is a network round-trip, so this page can render before it
  // resolves. Without this, the user is signed in moments later but just
  // sits on the login form with no indication anything happened.
  useEffect(() => {
    if (user) navigate('/projects', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      navigate('/projects')
    } catch (err) {
      setError(err.message || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <img src="/live-trak-icon.svg?v=2" style={{ width: '56px', height: '56px' }} />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Live-Trak</h1>
        </div>

        {/* Card */}
        <div className="card border-border/60">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-5">Sign in to your account</h2>

          {linkError && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-yellow-700 dark:text-yellow-400 text-sm mb-4">
              {linkError} If you were trying to open an invite link, ask your admin to resend it from the Team page — or set a password once you're in, under Profile, so you don't need a fresh link next time.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
                  Signing in...
                </>
              ) : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted mt-4">
          Contact your project administrator for access.
        </p>
      </div>
    </div>
  )
}
