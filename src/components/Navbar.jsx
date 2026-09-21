import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Navbar() {
  const { profile } = useAuth()
  const location = useLocation()

  const isCanvas = location.pathname.includes('/canvas/')

  return (
    <header className="h-14 bg-surface border-b border-border flex items-center px-4 gap-4 shrink-0 z-40">
      {/* The wordmark used to be baked into one combined icon+text SVG,
          loaded via <img> — an externally-referenced SVG image can't see
          fonts the page itself loaded (Google Fonts, here), so its text
          silently stayed on the SVG's own fallback stack through a font
          change instead of picking up the new one, unlike every other
          "Live-Trak" text in the app (plain HTML, e.g. Login.jsx's own
          title). Splitting the icon from the text fixes that at the root
          — the text is now real HTML and always tracks the page font. */}
      <Link to="/projects" className="flex items-center gap-2 group">
        <img src="/live-trak-icon.svg?v=3" alt="" className="h-10 w-10 shrink-0" />
        <span className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Live-Trak</span>
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
          {/* Admins reach Team via the Company Hub's own Team card now, so
              this top-level link is only needed for pm/superintendent —
              they can manage the team but don't have Hub access. */}
          {(profile?.role === 'pm' || profile?.role === 'superintendent') && (
            <Link
              to="/team"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname.startsWith('/team') ? 'text-accent bg-accent/10' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300 hover:bg-surface-2'
              }`}
            >
              Team
            </Link>
          )}
          {profile?.role === 'admin' && (
            <Link
              to="/hub"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname.startsWith('/hub') ? 'text-accent bg-accent/10' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300 hover:bg-surface-2'
              }`}
            >
              Company Hub
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
