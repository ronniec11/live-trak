import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isOtpRequiredForProfile, markDeviceTrusted, readOtpVerified, writeOtpVerified, clearOtpVerified } from '../lib/otpPolicy'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Whether EMAIL OTP (the second-factor step in Login.jsx) has been
  // completed for this user in this browser session — see otpPolicy.js.
  // Meaningless while there's no user; otpPending below is what actually
  // gates the app, and it already accounts for that.
  const [otpVerified, setOtpVerified] = useState(true)

  async function fetchProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (!error && data) {
        setProfile(data)
        return data
      }
      // Profile row missing — synthesize a minimal one from auth user so the
      // app can still render rather than spinning forever. _synthesized
      // marks this as a fetch failure, not a real "no organization yet"
      // state, so ProtectedRoute's CompanySetup gate (which also has no
      // organization_id to go on) doesn't mistake an existing user's
      // transient profile-fetch error for a brand new signup.
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        const fallback = { id: authUser.id, email: authUser.email, full_name: authUser.email?.split('@')[0] || 'User', role: 'foreman', avatar_color: '#4ade80', _synthesized: true }
        setProfile(fallback)
        return fallback
      }
    } catch (err) {
      console.error('fetchProfile error:', err)
    }
    return null
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      console.log('[AuthContext] 4s timeout — unblocking app')
      setLoading(false)
    }, 4000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[AuthContext] getSession resolved, user:', session?.user?.email ?? 'none')
      clearTimeout(timeout)
      const u = session?.user ?? null
      setUser(u)
      setOtpVerified(readOtpVerified(u?.id))
      if (u) {
        fetchProfile(u.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    }).catch(err => {
      console.error('[AuthContext] getSession error:', err)
      clearTimeout(timeout)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] onAuthStateChange:', event, session?.user?.email ?? 'none')
      const u = session?.user ?? null
      setUser(u)
      // Re-derived from sessionStorage every time we learn about a user,
      // rather than just reset on SIGNED_IN — a page refresh mid-OTP-step
      // goes through this same handler (via the INITIAL_SESSION event) with
      // an already-valid Supabase session, and treating that as "session
      // restored, skip OTP" would let the whole second factor be bypassed
      // by simply reloading the page before entering the code. Reading it
      // fresh here means "did THIS browser session actually complete OTP"
      // survives a refresh but not a real relaunch — see otpPolicy.js.
      setOtpVerified(readOtpVerified(u?.id))
      if (u) {
        if (event === 'SIGNED_IN') {
          // Keep `loading` true until profile actually resolves — both
          // ProtectedRoute and otpPending below need profile.role to decide
          // what to show, and clearing loading before fetchProfile resolves
          // would let a protected route render briefly before that's known.
          // (Only done for SIGNED_IN, not every event — an ordinary
          // background TOKEN_REFRESHED shouldn't flash the app into a
          // loading state for an already-settled session.)
          setLoading(true)
          fetchProfile(u.id).finally(() => setLoading(false))
          // Drives the Team page's Invited/Active status — auth.users itself
          // isn't queryable from client code, so this is the only record of
          // "has this person ever actually signed in" available to the app.
          supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', u.id)
            .then(({ error }) => { if (error) console.error('[AuthContext] last_login_at update failed:', error) })
        } else {
          fetchProfile(u.id)
          setLoading(false)
        }
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  // Once profile has loaded, drop otpVerified's "pending" state immediately
  // for anyone OTP doesn't actually apply to (any role besides admin/pm, on
  // a device already marked trusted) — they should never see the OTP step
  // at all, not even for a moment.
  useEffect(() => {
    if (profile && !otpVerified && !isOtpRequiredForProfile(profile)) setOtpVerified(true)
  }, [profile, otpVerified])

  // True exactly when Login.jsx's OTP step (or ProtectedRoute's bounce back
  // to it) should be showing instead of the real app — see otpPolicy.js for
  // who this applies to and markOtpVerified below for how it clears.
  const otpPending = !!user && !!profile && isOtpRequiredForProfile(profile) && !otpVerified

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  // Called by Login.jsx's OTP step once supabase.auth.verifyOtp succeeds.
  // Also marks this device trusted for superintendent/foreman (see
  // otpPolicy.js) — admins/PMs ignore that flag entirely and stay pending
  // on their next fresh app launch regardless.
  function markOtpVerified() {
    if (!user) return
    writeOtpVerified(user.id)
    markDeviceTrusted(profile)
    setOtpVerified(true)
  }

  async function signOut() {
    // Clear local state immediately so the UI reacts even if the network call fails
    if (user) clearOtpVerified(user.id)
    setUser(null)
    setProfile(null)
    setOtpVerified(true)
    await supabase.auth.signOut().catch(err => console.error('signOut error:', err))
  }

  async function updateProfile(updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single()
    if (error) throw error
    setProfile(data)
    return data
  }

  async function refreshProfile() {
    if (user) return fetchProfile(user.id)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, updateProfile, refreshProfile, otpPending, markOtpVerified }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
