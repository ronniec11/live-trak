import ProfileForm from './ProfileForm'

// Same modal shell pattern as Scope/Project Settings (ScopeDetail.jsx,
// ProjectDetail.jsx) — a window within a window over whatever page is
// already open, rather than navigating away to /profile.
export default function ProfileModal({ onClose }) {
  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Rounding and scrolling deliberately live on separate layers: a
          native scrollbar's square top/bottom arrow buttons don't respect
          a rounded corner on the same element, so they poke out past it as
          a small jagged notch. This outer shell clips everything (the
          scrollbar included) to the rounded shape; only the inner div
          actually scrolls. min-h-0 overrides flexbox's default
          min-height:auto on a column child, which would otherwise refuse
          to shrink below its content size and defeat overflow-y-auto
          entirely. */}
      <div
        className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 overflow-y-auto min-h-0">
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
    </div>
  )
}
