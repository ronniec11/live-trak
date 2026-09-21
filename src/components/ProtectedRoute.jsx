import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useEffect, useState } from 'react'

export default function ProtectedRoute({ children }) {
  const { user, profile, loading, signOut } = useAuth()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => setTimedOut(true), 4000)
    return () => clearTimeout(t)
  }, [loading])

  // A removed team member's auth session is still technically valid —
  // removal only flips profiles.active (there's no service-role access
  // from client code to revoke the session itself, see Team.jsx's
  // removePerson) — so this is the actual lockout: sign them out the
  // moment their profile loads showing active === false, rather than
  // leaving them signed in until that session naturally expires.
  useEffect(() => {
    if (profile?.active === false) signOut()
  }, [profile, signOut])

  if (loading && !timedOut) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-muted text-sm">Loading Live-Trak...</p>
        </div>
      </div>
    )
  }

  if (!user || profile?.active === false) return <Navigate to="/login" replace />
  return children
}
