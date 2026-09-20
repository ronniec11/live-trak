import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Scopes from './pages/Scopes'
import ScopeDetail from './pages/ScopeDetail'
import Canvas from './pages/Canvas'
import Profile from './pages/Profile'
import Reports from './pages/Reports'
import Team from './pages/Team'

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
            <Route path="/canvas/:pageId" element={<ProtectedRoute><Canvas /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/" element={<RootRedirect />} />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
