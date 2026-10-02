import { formatPhone } from './phone'

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
// Two things that look like they should work here don't, on iOS Safari
// specifically:
//   - blob: URL + target="_blank" — a blob: URL only resolves inside the
//     exact browsing context that created it, so a new tab just loaded
//     blank instead of showing the contact.
//   - data: URI (tried next, to dodge that) — WebKit silently blocks
//     top-level navigation to data: URLs triggered from script at all,
//     as an anti-phishing measure; the click did nothing, no error.
// blob: URL + a plain same-tab navigation (no target, no download) is
// the one combination that's both allowed and resolvable: a blob: URL
// isn't blocked the way data: is, and staying in the same tab means the
// blob is still valid in whatever context is trying to load it.
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
  if (person.phone) lines.push(`TEL;TYPE=CELL,VOICE:${formatPhone(person.phone)}`)
  if (person.email) lines.push(`EMAIL;TYPE=INTERNET:${person.email}`)
  lines.push('END:VCARD')
  const blob = new Blob([lines.join('\r\n')], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Safari's own contact-overlay handling needs a moment to actually load
  // the blob before it's revoked out from under it.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
