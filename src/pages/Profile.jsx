import { useNavigate, useLocation } from 'react-router-dom'
import Layout from '../components/Layout'
import ProfileForm from '../components/ProfileForm'

// Stays a real standalone page (not just a modal) — Team.jsx's invite links
// and Login.jsx's password-reset links point straight at /profile, so
// someone can land here directly from an email before ever seeing the rest
// of the app. The Navbar's profile icon opens the same content as a modal
// instead (see components/ProfileModal.jsx) for everyone already inside.
export default function Profile() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = location.state?.returnTo

  return (
    <Layout>
      <div className="max-w-lg mx-auto px-4 py-8">
        {returnTo && (
          <button
            onClick={() => navigate(returnTo, { replace: true })}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-gray-900 dark:hover:text-white mb-5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back to canvas
          </button>
        )}
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-6">My Profile</h1>
        <ProfileForm returnTo={returnTo} />
      </div>
    </Layout>
  )
}
