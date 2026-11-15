import { createClient } from '@supabase/supabase-js'
import { isNativeApp } from './platform'

const supabaseUrl = 'https://vzqopjbwkxpawogdtvmf.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6cW9wamJ3a3hwYXdvZ2R0dm1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI2NjEsImV4cCI6MjA4OTkzODY2MX0.f34d9XvNldLCSe2ZwSUZZva1gpJVYpAhONzZdzVdkUE'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // PKCE (the default) stores a verifier in the browser that *requested*
    // a magic link, then needs it again in the browser that *clicks* it —
    // fine for self-service password reset (same browser both times), but
    // it can never work for inviting someone else (Team.jsx): the admin's
    // browser holds the verifier, the invitee's browser doesn't. Implicit
    // flow puts the session token directly in the link itself instead, so
    // any device can complete it.
    flowType: 'implicit',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

// Supabase's token auto-refresh is a plain JS timer, which a browser tab
// keeps running (just throttled) while backgrounded — but iOS freezes a
// Capacitor WebView's JS outright once it's backgrounded for a bit, so the
// timer never fires. Resuming the app then makes requests with a quietly
// expired access token, which every RLS check rejects as if signed out
// (e.g. saving a canvas session fails with "new row violates row-level
// security policy" even though the UI still looks signed in). Tying
// refresh to Capacitor's own foreground/background events keeps the token
// valid across that instead of relying on the timer alone.
if (isNativeApp()) {
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
    })
  })
}
