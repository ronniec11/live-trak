import { useEffect, useState } from 'react'
import { getPendingOps, syncPendingOps } from '../lib/offlineSync'

// Manual trigger for the offline queue (see src/lib/offlineSync.js) — saves
// made with no signal already sync automatically once a connection is back,
// but this gives a way to check/force it on demand and see what's still
// waiting, rather than only trusting it's happening in the background.
export default function OfflineSyncButton({ className = '' }) {
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState('')

  async function refreshCount() {
    try { setPending((await getPendingOps()).length) } catch { setPending(0) }
  }

  useEffect(() => {
    refreshCount()
    const interval = setInterval(refreshCount, 15000)
    window.addEventListener('online', handleSync)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', handleSync)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setLastResult('')
    try {
      const { synced, remaining, stillOffline } = await syncPendingOps()
      setPending(remaining)
      if (synced > 0) setLastResult(`Synced ${synced}`)
      else if (stillOffline) setLastResult('No connection')
      else if (remaining === 0) setLastResult('Up to date')
      setTimeout(() => setLastResult(''), 3000)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={syncing}
      className={`btn-secondary flex items-center gap-1.5 ${className}`}
      title="Push any offline saves and check for updates"
    >
      <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
      {syncing ? 'Syncing…' : lastResult || (pending > 0 ? `Sync (${pending})` : 'Sync')}
    </button>
  )
}
