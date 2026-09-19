// Minimal, dependency-free IndexedDB wrapper — the storage layer offline
// mode is built on. No library (idb/dexie) is in this project, and this
// app's needs are simple enough (a handful of stores, get/getAll/put/delete)
// that pulling one in isn't worth it.

const DB_NAME = 'livetrak_offline'
const DB_VERSION = 1

// Every store offline mode uses, created up front on first open so nothing
// downstream has to think about schema versioning.
const STORES = ['pendingOps', 'cachedPages', 'cachedProjects']

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function dbPut(storeName, value) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readwrite')
  const result = reqToPromise(tx.objectStore(storeName).put(value))
  await txDone(tx)
  return result
}

export async function dbGet(storeName, id) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readonly')
  const result = await reqToPromise(tx.objectStore(storeName).get(id))
  await txDone(tx)
  return result
}

export async function dbGetAll(storeName) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readonly')
  const result = await reqToPromise(tx.objectStore(storeName).getAll())
  await txDone(tx)
  return result || []
}

export async function dbDelete(storeName, id) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readwrite')
  tx.objectStore(storeName).delete(id)
  await txDone(tx)
}

// Best-effort — asks the browser not to evict this data under storage
// pressure. Never guaranteed (especially on iOS Safari), so offline mode
// never assumes it succeeded; it just improves the odds a day's queued
// work survives until it can sync.
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {}
  return false
}
