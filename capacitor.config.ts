import type { CapacitorConfig } from '@capacitor/cli'

// appId is the iOS bundle identifier — must match whatever you register
// in App Store Connect / your Apple Developer account exactly, so check
// this before archiving (Signing & Capabilities tab in Xcode shows/sets
// it too, and must agree with this value).
const config: CapacitorConfig = {
  appId: 'com.livetrak.app',
  appName: 'Live-Trak',
  // dist — the real production build (vite build), not source. The app
  // bundles this at build/submission time rather than loading it live
  // from the server: this is what lets the native app pass App Review as
  // a real app (not "just a website in a wrapper") and keeps it working
  // offline on the jobsite the same way the installed PWA already does.
  // Shipping a UI/content change to the native app means rebuilding and
  // resubmitting through TestFlight/App Review — the web app and PWA
  // keep deploying instantly as before, this only affects the native app.
  webDir: 'dist',
  ios: {
    // Matches the PWA's own manifest.json background_color — avoids a
    // flash of the wrong color before the app's own CSS paints.
    backgroundColor: '#ffffff',
  },
}

export default config
