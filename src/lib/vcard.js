// Builds a standard vCard from a profile-shaped object (full_name/
// company/phone/email) and opens it — shared by every "download this
// person's contact" button (MemberCardModal, Team.jsx's PersonCard) so
// the format/behavior can't drift between them.
//
// Deliberately NOT a forced file download (no `download` attribute) —
// that saves a bare .vcf into Files, leaving the person to go find it and
// hit Share -> Add to Contacts themselves. Navigating straight to a
// text/vcard blob URL instead lets iOS/iPadOS Safari's own built-in
// handling kick in: it recognizes the MIME type and shows the native
// "Add to Contacts" card directly, no Files/Share detour. target="_blank"
// keeps that in its own tab/sheet rather than navigating the app itself
// away from wherever the person was.
export function downloadVCard(person) {
  const displayName = person.full_name || person.email || 'Contact'
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${displayName}`]
  // N (structured name) is technically required alongside FN by the
  // vCard spec — without it, some contacts apps (notably iOS/macOS) can
  // silently fall back to displaying the first TEL/EMAIL value as the
  // contact's name instead of FN. Splitting on the first space is a
  // rough given/family split, good enough for sorting/display; a
  // single-word name just becomes the given name with an empty family.
  const [given, ...rest] = displayName.trim().split(/\s+/)
  lines.push(`N:${rest.join(' ')};${given};;;`)
  if (person.company) lines.push(`ORG:${person.company}`)
  if (person.phone) lines.push(`TEL;TYPE=CELL,VOICE:${person.phone}`)
  if (person.email) lines.push(`EMAIL;TYPE=INTERNET:${person.email}`)
  lines.push('END:VCARD')
  const blob = new Blob([lines.join('\r\n')], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Longer-lived than the old download's 1s — a new tab/sheet opening
  // the blob URL needs it to still be valid by the time that tab
  // actually loads it, not just by the time .click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
