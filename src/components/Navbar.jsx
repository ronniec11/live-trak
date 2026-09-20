import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import LiveTrakLogoDark from '../assets/live-trak-logo-full.svg'
import LiveTrakLogoLight from '../assets/live-trak-logo-full-light.svg'

export default function Navbar() {
  const { profile } = useAuth()
  const { theme } = useTheme()
  const location = useLocation()

  const isCanvas = location.pathname.includes('/canvas/')

  return (
    <header className="h-14 bg-surface border-b border-border flex items-center px-4 gap-4 shrink-0 z-40">
      <Link to="/projects" className="flex items-center group">
        <img src={theme === 'light' ? LiveTrakLogoLight : LiveTrakLogoDark} alt="Live-Trak" className="h-11 w-auto" />
      </Link>

      {!isCanvas && (
        <nav className="flex items-center gap-1 ml-2">
          <Link
            to="/projects"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              location.pathname.startsWith('/projects') ? 'text-accent bg-accent/10' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300 hover:bg-surface-2'
            }`}
          >
            Projects
          </Link>
          {(profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'superintendent') && (
            <Link
              to="/team"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname.startsWith('/team') ? 'text-accent bg-accent/10' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300 hover:bg-surface-2'
              }`}
            >
              Team
            </Link>
          )}
        </nav>
      )}

      <div className="ml-auto flex items-center gap-2">
        {profile && (
          <Link
            to="/profile"
            className="flex items-center gap-2 hover:bg-surface-2 px-2 py-1.5 rounded-lg transition-colors group"
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-bg shrink-0"
              style={{ backgroundColor: profile.avatar_color || '#4ade80' }}
            >
              {(profile.full_name || 'U')[0].toUpperCase()}
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 hidden sm:block">{profile.full_name}</span>
            <span className="text-xs text-muted capitalize hidden md:block">({profile.role})</span>
          </Link>
        )}
      </div>
    </header>
  )
}
