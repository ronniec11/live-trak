import ProfileForm from './ProfileForm'

// Same modal shell pattern as Scope/Project Settings (ScopeDetail.jsx,
// ProjectDetail.jsx) — a window within a window over whatever page is
// already open, rather than navigating away to /profile.
export default function ProfileModal({ onClose }) {
  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Profile</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ProfileForm embedded />
      </div>
    </div>
  )
}
