import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// EMAIL OTP SECOND FACTOR — depends on dashboard-only Supabase config this
// file can't set:
//   - Authentication -> Providers -> Email -> "Enable email provider" is
//     what actually governs OTP in this dashboard version (there's no
//     separate "Email OTP" switch) — confirmed on for this project.
//     "Email OTP length" there must match OTP_CODE_LENGTH below exactly,
//     or a correctly-typed code can never satisfy the Verify button —
//     set to 6 on this project.
//   - Authentication -> Email Templates -> whichever template carries the
//     code (an "OTP" entry if the dashboard has one, otherwise "Magic
//     Link") -> make sure {{ .Token }} is present in the body so the code
//     actually gets emailed, not just a bare link.
// See otpPolicy.js for who this applies to and why, and AuthContext.jsx for
// how otpPending/otpVerified are tracked.

// Shared chrome for every Login.jsx screen (password form, forgot/signup,
// and the OTP step below) — factored out so the OTP step can reuse the same
// logo/card framing without duplicating it.
function AuthShell({ children, footer }) {
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
          <img src="/live-trak-icon.svg?v=3" style={{ width: '56px', height: '56px' }} />
          <h1 className="text-3xl font-extralight text-gray-900 dark:text-white tracking-tight">Live-Trak</h1>
        </div>

        {/* Card */}
        <div className="card border-border/60">
          {children}
        </div>

        {footer && <p className="text-center text-xs text-muted mt-4">{footer}</p>}
      </div>
    </div>
  )
}

const OTP_RESEND_COOLDOWN = 60
// Must match Supabase -> Authentication -> Providers -> Email -> "Email OTP
// length" exactly, or a correctly-entered code can never reach this length
// and Verify stays disabled.
const OTP_CODE_LENGTH = 6

// Step 2 of login for roles OTP applies to (see otpPolicy.js) — rendered by
// Login.jsx once `user` is set (password already verified, or a restored
// session that still needs this) but otpPending is still true. Sends the
// first code itself on mount so the person doesn't need an extra tap after
// already submitting their password.
function OtpStep({ email, onVerified, onUseDifferentAccount }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(OTP_RESEND_COOLDOWN)
  const sentRef = useRef(false)

  async function sendCode() {
    setSending(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
      if (err) throw err
      setCooldown(OTP_RESEND_COOLDOWN)
    } catch (err) {
      setError(err.message || 'Could not send a verification code — try again.')
    } finally {
      setSending(false)
    }
  }

  // Ref guard, not just an empty dep array — React 18 StrictMode (see
  // main.jsx) mounts/unmounts/remounts every component once in dev, which
  // would otherwise send two codes for one actual screen view.
  useEffect(() => {
    if (sentRef.current) return
    sentRef.current = true
    sendCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  async function handleVerify(e) {
    e.preventDefault()
    setError('')
    setVerifying(true)
    try {
      const { error: err } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
      if (err) throw err
      onVerified()
    } catch (err) {
      setError(err.message || 'Invalid or expired code')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Enter verification code</h2>
      <p className="text-sm text-muted mb-5">
        We sent a verification code to <span className="font-medium text-gray-700 dark:text-gray-300">{email}</span>.
      </p>

      <form onSubmit={handleVerify} className="space-y-4">
        <div>
          <label className="label">{OTP_CODE_LENGTH}-digit code</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={OTP_CODE_LENGTH}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH))}
            className="input text-center text-lg tracking-[0.5em]"
            placeholder={'·'.repeat(OTP_CODE_LENGTH)}
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
          disabled={verifying || code.length !== OTP_CODE_LENGTH}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {verifying ? (
            <>
              <div className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
              Verifying...
            </>
          ) : 'Verify'}
        </button>

        <button
          type="button"
          onClick={sendCode}
          disabled={sending || cooldown > 0}
          className="btn-ghost w-full text-sm"
        >
          {sending ? 'Sending...' : cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
        </button>

        <button
          type="button"
          onClick={onUseDifferentAccount}
          className="text-center text-xs text-muted hover:text-gray-700 dark:hover:text-gray-300 w-full"
        >
          Not you? Sign out
        </button>
      </form>
    </>
  )
}

// Same canonical URL Team.jsx's invite flow redirects to (see
// INVITE_REDIRECT_URL there) — /profile is where the password field
// actually lives (Profile.jsx's "Password" card), and it's already
// allow-listed in Supabase's Auth -> Redirect URLs for that same reason.
// Duplicated rather than imported/shared, matching how this app already
// keeps a couple of other one-off constants local to whichever page uses
// them instead of a shared constants file.
const RESET_REDIRECT_URL = 'https://www.live-trak.ai/profile'
// Same URL, reused rather than a fresh one — it's already allow-listed in
// Supabase's Auth -> Redirect URLs (see the comment above), and which
// protected route a confirmation link lands on doesn't actually matter:
// ProtectedRoute/CompanySetup decides what to show from the session alone.
const SIGNUP_REDIRECT_URL = RESET_REDIRECT_URL

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'forgot' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [signupSent, setSignupSent] = useState(false)
  const { signIn, user, loading: authLoading, otpPending, markOtpVerified, signOut } = useAuth()
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
  //
  // Gated on !authLoading && !otpPending rather than firing the instant
  // `user` is set: whether OTP is even required isn't known until profile
  // has loaded (authLoading covers that window — see AuthContext), and if
  // it IS required, this should render the OTP step below instead of
  // leaving for /projects, not navigate away before that step runs.
  useEffect(() => {
    if (user && !authLoading && !otpPending) navigate('/projects', { replace: true })
  }, [user, authLoading, otpPending, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      // No navigate() here — the effect above owns it once `user` and
      // otpPending settle, since this component needs to stay put and
      // render the OTP step below instead when one's required.
    } catch (err) {
      setError(err.message || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignup(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true)
    try {
      // pending_organization_name rides along in user metadata rather than
      // being created right here — signUp() may not return a live session
      // at all (email confirmation is required on this project), so there's
      // nothing yet to attach an organization to. CompanySetup.jsx reads it
      // back out after the person confirms and actually signs in, and calls
      // create_organization_and_claim_admin with it — see
      // supabase-migration-org-scoping-stage5-signup.sql.
      const { error: err } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { full_name: fullName.trim(), pending_organization_name: companyName.trim() },
          emailRedirectTo: SIGNUP_REDIRECT_URL,
        },
      })
      if (err) throw err
      setSignupSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // Same recovery-link mechanism as Team.jsx's invite (signInWithOtp) —
      // clicking it signs them in and lands them on RESET_REDIRECT_URL,
      // where Profile.jsx's Password card is what actually sets the new
      // one. Doesn't reveal whether the email exists either way, so this
      // can't be used to probe the directory.
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT_URL })
      if (err) throw err
      setResetSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Signed in (password just verified, or a restored session) but still
  // waiting on profile to resolve before otpPending is known — see the
  // redirect effect above and AuthContext's SIGNED_IN handling.
  if (user && authLoading) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted">
          <div className="w-4 h-4 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
          Signing you in...
        </div>
      </AuthShell>
    )
  }

  // Password verified, but this role/device needs the OTP second factor
  // too (see otpPolicy.js) — also what ProtectedRoute bounces back to if a
  // signed-in-but-unverified session lands directly on a protected route.
  if (user && otpPending) {
    return (
      <AuthShell>
        <OtpStep email={user.email} onVerified={markOtpVerified} onUseDifferentAccount={signOut} />
      </AuthShell>
    )
  }

  return (
    <AuthShell
      footer={mode === 'signup' ? 'Already have a Live-Trak account at your company? Ask an admin to invite you from the Team page instead.' : 'Contact your project administrator for access.'}
    >
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-5">
        {mode === 'forgot' ? 'Reset your password' : mode === 'signup' ? 'Create your company' : 'Sign in to your account'}
      </h2>

          {linkError && mode === 'signin' && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-yellow-700 dark:text-yellow-400 text-sm mb-4">
              {linkError} If you were trying to open an invite link, ask your admin to resend it from the Team page — or set a password once you're in, under Profile, so you don't need a fresh link next time.
            </div>
          )}

          {mode === 'forgot' ? (
            resetSent ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Check <span className="font-medium">{email}</span> for a link to reset your password.
                </p>
                <button
                  type="button"
                  onClick={() => { setMode('signin'); setResetSent(false); setError('') }}
                  className="btn-secondary w-full"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-4">
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
                      Sending...
                    </>
                  ) : 'Send Reset Link'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('signin'); setError('') }}
                  className="btn-ghost w-full text-sm"
                >
                  Back to sign in
                </button>
              </form>
            )
          ) : mode === 'signup' ? (
            signupSent ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Check <span className="font-medium">{email}</span> for a confirmation link — click it, then sign in below to finish setting up {companyName}.
                </p>
                <button
                  type="button"
                  onClick={() => { setMode('signin'); setSignupSent(false); setError('') }}
                  className="btn-secondary w-full"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <label className="label">Your Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    className="input"
                    placeholder="Jane Smith"
                    required
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label className="label">Company Name</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    className="input"
                    placeholder="Mopping Man"
                    required
                  />
                </div>
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
                    placeholder="At least 6 characters"
                    required
                    autoComplete="new-password"
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
                      Creating account...
                    </>
                  ) : 'Create Company'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('signin'); setError('') }}
                  className="btn-ghost w-full text-sm"
                >
                  Already have an account? Sign in
                </button>
              </form>
            )
          ) : (
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
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">Password</label>
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError('') }}
                    className="text-xs text-muted hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    Forgot password?
                  </button>
                </div>
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
              <button
                type="button"
                onClick={() => { setMode('signup'); setError('') }}
                className="btn-ghost w-full text-sm"
              >
                New company? Create your account
              </button>
            </form>
          )}
    </AuthShell>
  )
}
