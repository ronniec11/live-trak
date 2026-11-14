import { Capacitor } from '@capacitor/core'

// True only inside the native iOS app (Capacitor's WebView) — false for
// every web visit, including the installed Home Screen PWA. Used to keep
// the native app strictly a "sign in and use it" tool: no company
// signup, no Stripe checkout, no billing management reachable from
// inside it. Apple requires paid digital subscriptions sold FROM WITHIN
// an app to go through their own In-App Purchase (their cut, their
// rules) — the standard way B2B apps like this avoid that is simply
// never offering a way to pay from inside the app at all. Every
// Basic/Starter/Pro/Business subscription still only ever starts or
// changes on the web (live-trak.ai); the native app is purely for people
// who already have an account to do their actual work.
export function isNativeApp() {
  return Capacitor.isNativePlatform()
}
