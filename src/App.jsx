import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Jobs from './pages/Jobs'
import JobDetail from './pages/JobDetail'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Canvas from './pages/Canvas'
import Profile from './pages/Profile'
import Reports from './pages/Reports'
import Team from './pages/Team'

// A magic-link click can land on "/" or an unmatched path carrying the
// session as a #access_token=... hash fragment (see supabase.js — implicit
// flow). <Navigate to="/jobs"> with a plain string target resets
// pathname/search/hash entirely, silently dropping that fragment before
// Supabase's client ever reads it. Carrying the current location's
// search/hash forward keeps it intact through the redirect.
function RootRedirect() {
  const location = useLocation()
  return <Navigate to={{ pathname: '/jobs', search: location.search, hash: location.hash }} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/jobs" element={<ProtectedRoute><Jobs /></ProtectedRoute>} />
            <Route path="/jobs/:jobId" element={<ProtectedRoute><JobDetail /></ProtectedRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
            <Route path="/projects/:projectId" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
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
