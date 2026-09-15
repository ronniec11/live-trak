import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
      // app can still render rather than spinning forever
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        const fallback = { id: authUser.id, email: authUser.email, full_name: authUser.email?.split('@')[0] || 'User', role: 'foreman', avatar_color: '#4ade80' }
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
      if (u) {
        fetchProfile(u.id)
        // Drives the Team page's Invited/Active status — auth.users itself
        // isn't queryable from client code, so this is the only record of
        // "has this person ever actually signed in" available to the app.
        if (event === 'SIGNED_IN') {
          supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', u.id)
            .then(({ error }) => { if (error) console.error('[AuthContext] last_login_at update failed:', error) })
        }
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    // Clear local state immediately so the UI reacts even if the network call fails
    setUser(null)
    setProfile(null)
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
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, updateProfile, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
