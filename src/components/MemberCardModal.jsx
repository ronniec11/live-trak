import { downloadVCard } from '../lib/vcard'

// A quick "business card" for a Project/Scope Member — tap their row to
// see it, tap email/phone to actually call or email them straight from
// the app via mailto:/tel: links (the OS/browser handles what opens).
// Remove lives here now (not a hover-reveal icon on the row itself — on
// touch devices a hover-styled button needs a first tap just to show
// before a second tap actually hits it, which read as "nothing happened"
// on a single tap). The corner slot that used to be the close X is now a
// download-contact button (a .vcf file, see lib/vcard.js) — some people
// want this person's real contact card saved to their phone/iPad's own
// Contacts app, not just a tap-to-call/email link inside Live-Trak. Close
// already lives at the bottom, so there isn't a second close control to
// confuse it with. Team.jsx's own PersonCard mirrors this same layout.
export default function MemberCardModal({ person, onClose, onRemove }) {
  const hasContact = person.email || person.phone || person.company

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-panel bg-surface border border-border rounded-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Profile</h2>
          {hasContact && (
            <button onClick={() => downloadVCard(person)} className="btn-ghost p-1.5" title="Save to Contacts">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 12m0 0l4.5-4.5M12 12V3" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-bg shrink-0"
            style={{ backgroundColor: person.avatar_color || '#4ade80' }}
          >
            {(person.full_name || person.email || 'U')[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{person.full_name || '(no name)'}</p>
            <p className="text-xs text-muted capitalize">{person.role}</p>
          </div>
        </div>

        <div className="space-y-1 mb-5">
          {person.email && (
            <a href={`mailto:${person.email}`} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300 hover:text-accent px-2 py-2 -mx-2 rounded-lg hover:bg-surface-2 transition-colors">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <span className="truncate">{person.email}</span>
            </a>
          )}
          {person.phone && (
            <a href={`tel:${person.phone}`} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300 hover:text-accent px-2 py-2 -mx-2 rounded-lg hover:bg-surface-2 transition-colors">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              <span className="truncate">{person.phone}</span>
            </a>
          )}
          {person.company && (
            <div className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300 px-2 py-2 -mx-2">
              <svg className="w-4 h-4 shrink-0 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
              <span className="truncate">{person.company}</span>
            </div>
          )}
          {!hasContact && <p className="text-sm text-muted">No contact info on file.</p>}
        </div>

        <div className="flex gap-2">
          {onRemove && (
            <button
              onClick={() => { onRemove(person); onClose() }}
              className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-medium px-4 py-2 rounded-lg border border-red-500/40 transition-all duration-150 text-sm"
            >
              Remove
            </button>
          )}
          <button onClick={onClose} className="btn-secondary flex-1">Close</button>
        </div>
      </div>
    </div>
  )
}
