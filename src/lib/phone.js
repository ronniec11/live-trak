// (xxx) xxx-xxxx everywhere a phone number is typed or shown — shared so a
// change here reaches every input (Team.jsx's Add Person, Company Hub's
// org phone) and every display (Team.jsx's list rows/contact card,
// MemberCardModal, the downloaded vCard) at once, rather than drifting
// out of sync across copies. Strips everything but digits first, so
// pasting "555.123.4567" or "+1 (555) 123-4567" lands on the same format
// as typing it digit by digit — and so a number already stored in some
// other format (legacy data entered before this existed) still displays
// consistently without needing a migration.
export function formatPhone(raw) {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length < 4) return `(${digits}`
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}
