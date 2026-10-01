// Builds a standard vCard from a profile-shaped object (full_name/
// company/phone/email) and opens it — shared by every "download this
// person's contact" button (MemberCardModal, Team.jsx's PersonCard) so
// the format/behavior can't drift between them.
//
// Deliberately NOT a forced file download (no `download` attribute) —
// that saves a bare .vcf into Files, leaving the person to go find it and
// hit Share -> Add to Contacts themselves. Navigating straight to a
// text/vcard URL instead lets iOS/iPadOS Safari's own built-in handling
// kick in: it recognizes the MIME type and shows the native "Add to
// Contacts" card as an overlay on the current page, no Files/Share
// detour — and no real page navigation despite the <a> click, since
// Safari intercepts vCard content before it ever renders as a page.
//
// A data: URI, not a Blob/createObjectURL — a blob: URL only resolves
// inside the exact browsing context that created it, so opening one in a
// new tab (target="_blank", tried first) loaded a blank page there
// instead of showing the contact. data: URIs are self-contained (the
// vCard text is right there in the URL), so there's nothing to resolve
// and nothing to revoke, and it works in the SAME tab/context — which is
// also what Safari's contact-overlay behavior actually needs.
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
  const url = 'data:text/vcard;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'))
  const a = document.createElement('a')
  a.href = url
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
