import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import { isNativeApp } from './lib/platform'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Scopes from './pages/Scopes'
import ScopeDetail from './pages/ScopeDetail'
import Canvas from './pages/Canvas'
import Profile from './pages/Profile'
import Reports from './pages/Reports'
import Team from './pages/Team'
import CompanyHub from './pages/CompanyHub'
import SuperAdmin from './pages/SuperAdmin'
import Pricing from './pages/Pricing'

// A magic-link click can land on "/" or an unmatched path carrying the
// session as a #access_token=... hash fragment (see supabase.js — implicit
// flow). <Navigate to="/projects"> with a plain string target resets
// pathname/search/hash entirely, silently dropping that fragment before
// Supabase's client ever reads it. Carrying the current location's
// search/hash forward keeps it intact through the redirect.
function RootRedirect() {
  const location = useLocation()
  return <Navigate to={{ pathname: '/projects', search: location.search, hash: location.hash }} replace />
}

// "/" specifically (not the catch-all above) — the one URL a prospective
// customer actually types/clicks, so it's the only place the public
// Landing page can show. Everyone else still gets sent straight into the
// app, same as "/" has always behaved:
//   - a magic-link/invite click landing here with its session in the
//     hash (see RootRedirect's own comment) — has to reach ProtectedRoute
//     before Supabase's client consumes that hash, a marketing page in
//     the way would drop it
//   - the installed Home Screen PWA (manifest start_url is "/") — always
//     wants the app, signed in or not; showing marketing copy there on
//     every cold launch would be bizarre
//   - the native iOS app (see src/lib/platform.js) — it's strictly a
//     sign-in-and-use tool, never a signup/marketing surface
//   - anyone already signed in, in an ordinary browser tab — they're a
//     customer, not a prospect, by the time they're looking at this
function RootGate() {
  const location = useLocation()
  const { user, loading } = useAuth()
  const isStandalone = typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone
  )
  const hasAuthHash = /access_token|refresh_token|error=/.test(location.hash)

  if (loading) return null
  if (hasAuthHash || isStandalone || isNativeApp() || user) {
    return <Navigate to={{ pathname: '/projects', search: location.search, hash: location.hash }} replace />
  }
  return <Landing />
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
            <Route path="/projects/:jobId" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
            <Route path="/scopes" element={<ProtectedRoute><Scopes /></ProtectedRoute>} />
            <Route path="/scopes/:projectId" element={<ProtectedRoute><ScopeDetail /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />
            <Route path="/hub" element={<ProtectedRoute><CompanyHub /></ProtectedRoute>} />
            {/* is_super_admin gate lives inside SuperAdmin.jsx itself (redirects
                non-super-admins to /projects), same pattern as Team.jsx's own
                role check — not a separate wrapper component. */}
            <Route path="/super-admin" element={<ProtectedRoute><SuperAdmin /></ProtectedRoute>} />
            <Route path="/pricing" element={<ProtectedRoute><Pricing /></ProtectedRoute>} />
            <Route path="/canvas/:pageId" element={<ProtectedRoute><Canvas /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/" element={<RootGate />} />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
