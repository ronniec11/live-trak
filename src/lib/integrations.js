// Every third-party integration Live-Trak supports — adding a provider
// here (plus its api/<provider>/auth.js + callback.js backend) is enough
// for it to show up both in Company Hub's Integrations panel (connect/
// disconnect) and, once connected, as an "Import from …" button in Scope
// Detail. paramPrefix matches each provider's callback.js redirect query
// params — e.g. autodesk/callback.js redirects to
// ?aps_connected=1 / ?aps_error=.
export const INTEGRATIONS = [
  {
    provider: 'autodesk',
    label: 'Autodesk Construction Cloud',
    shortLabel: 'Autodesk',
    connectedCopy: 'Connected — files can be imported from ACC.',
    authUrl: '/api/autodesk/auth',
    paramPrefix: 'aps',
  },
  {
    provider: 'google_drive',
    label: 'Google Drive',
    shortLabel: 'Google Drive',
    connectedCopy: 'Connected — files can be imported from Drive.',
    authUrl: '/api/google/auth',
    paramPrefix: 'google',
  },
]
