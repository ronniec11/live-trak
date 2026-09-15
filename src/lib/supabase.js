import { createClient } from '@supabase/supabase-js'

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
