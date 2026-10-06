// Email-OTP second-factor policy: who needs it, and how "this device/
// session already proved it" gets remembered.
//
// Two different persistence lifetimes are deliberately in play here:
//  - sessionStorage (otp_verified_<id>) — "this browser tab/app session has
//    already completed OTP". Survives a page refresh (so admins/PMs aren't
//    re-prompted every reload mid-session) but clears when the tab/app is
//    actually closed and relaunched, which is what makes "require OTP every
//    login" for admin/pm actually hold — a fresh launch means a fresh
//    sessionStorage, so the next isOtpRequiredForProfile check starts
//    pending again regardless of Supabase's own persisted (localStorage)
//    session still being valid underneath.
//  - localStorage (trusted_<id>) — "this device has completed OTP at least
//    once, ever". Never expires (matches the spec this was built from
//    exactly). Only superintendents/foremen consult it; admins/PMs ignore
//    it entirely and are always pending until this session's own OTP step
//    runs, per sessionStorage above.
export function isOtpRequiredForProfile(profile) {
  if (!profile) return false
  if (profile.role === 'admin' || profile.role === 'pm') return true
  if (profile.role === 'superintendent' || profile.role === 'foreman') {
    try { return !localStorage.getItem(`trusted_${profile.id}`) } catch { return true }
  }
  // Unrecognized/missing role (e.g. a synthesized fallback profile from a
  // profile-fetch failure) — don't lock someone out over a role we don't
  // otherwise enforce OTP for.
  return false
}

export function markDeviceTrusted(profile) {
  if (!profile) return
  if (profile.role === 'superintendent' || profile.role === 'foreman') {
    try { localStorage.setItem(`trusted_${profile.id}`, 'true') } catch {}
  }
}

export function readOtpVerified(userId) {
  if (!userId) return true
  try { return sessionStorage.getItem(`otp_verified_${userId}`) === 'true' } catch { return false }
}

export function writeOtpVerified(userId) {
  if (!userId) return
  try { sessionStorage.setItem(`otp_verified_${userId}`, 'true') } catch {}
}

export function clearOtpVerified(userId) {
  if (!userId) return
  try { sessionStorage.removeItem(`otp_verified_${userId}`) } catch {}
}
