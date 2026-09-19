// Minimal, dependency-free IndexedDB wrapper — the storage layer offline
// mode is built on. No library (idb/dexie) is in this project, and this
// app's needs are simple enough (a handful of stores, get/getAll/put/delete)
// that pulling one in isn't worth it.

const DB_NAME = 'livetrak_offline'
// IndexedDB only runs onupgradeneeded (where object stores get created)
// when this number goes UP from whatever's already on the device — a
// device that already opened the DB at version 1 (e.g. during earlier
// write-queue testing, before cachedProjects existed) never got that store
// created just because the code added it here, and every put/get against
// it then fails with "One of the specified object stores was not found."
// Bump this whenever STORES (or a store's indexes) changes.
const DB_VERSION = 3

// Every store offline mode uses, created up front on first open so nothing
// downstream has to think about schema versioning.
const STORES = ['pendingOps', 'cachedPages', 'cachedProjects', 'cachedTiles']

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
      // cachedTiles needs to be queried "every tile for this page" at view
      // time — a plain keyPath lookup can only fetch one record at a time,
      // so it needs a secondary index to range-query by pageId instead.
      const tx = req.transaction
      const tilesStore = tx.objectStore('cachedTiles')
      if (!tilesStore.indexNames.contains('pageId')) {
        tilesStore.createIndex('pageId', 'pageId')
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

// One transaction for many records (e.g. a page's whole tile pyramid, which
// can run into the thousands) instead of one transaction per record — both
// much faster and avoids holding the DB connection busy with thousands of
// tiny back-to-back transactions.
export async function dbPutMany(storeName, values) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  for (const value of values) store.put(value)
  await txDone(tx)
}

export async function dbGetAllByIndex(storeName, indexName, value) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readonly')
  const result = await reqToPromise(tx.objectStore(storeName).index(indexName).getAll(value))
  await txDone(tx)
  return result || []
}

// Deletes every record whose index value matches (e.g. all of one page's
// cached tiles before re-downloading it) — a single cursor pass in one
// transaction rather than fetching ids and deleting them individually.
export async function dbDeleteAllByIndex(storeName, indexName, value) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readwrite')
  const req = tx.objectStore(storeName).index(indexName).openCursor(IDBKeyRange.only(value))
  await new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) { cursor.delete(); cursor.continue() } else { resolve() }
    }
    req.onerror = () => reject(req.error)
  })
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
