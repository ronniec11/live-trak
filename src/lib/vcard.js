// Builds a standard vCard (.vcf) from a profile-shaped object (full_name/
// company/phone/email) and triggers a browser download — shared by every
// "download this person's contact" button (MemberCardModal, Team.jsx's
// PersonCard) so the format/behavior can't drift between them.
export function downloadVCard(person) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${person.full_name || person.email || 'Contact'}`]
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
