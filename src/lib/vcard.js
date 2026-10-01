// Builds a standard vCard (.vcf) from a profile-shaped object (full_name/
// company/phone/email) and triggers a browser download — shared by every
// "download this person's contact" button (MemberCardModal, Team.jsx's
// PersonCard) so the format/behavior can't drift between them.
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
  a.download = `${(person.full_name || 'contact').trim().replace(/[^a-z0-9]+/gi, '-')}.vcf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
