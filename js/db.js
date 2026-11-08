// IndexedDB storage. Same records as the Android Room tables, so a backup file moves
// between the two apps unchanged:
//   events     — the append-only review log (review_events)
//   answers    — answered GRE questions (question_answers)
//   kv         — settings, deck/word selections, custom words, question serving state

const DB_NAME = 'greword';
const VERSION = 1;

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('answers', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      // WebKit drops the connection after a long time in the background; reopen next call.
      db.onclose = () => { dbp = null; };
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

/**
 * Runs `work(store)` in one transaction and resolves once the transaction has committed,
 * not merely when the request succeeded, so an app killed straight after cannot lose it.
 * A dead connection is reopened and the work retried once.
 */
async function run(name, mode, work, retry = true) {
  try {
    const tx = (await open()).transaction(name, mode);
    const req = work(tx.objectStore(name));
    return await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
  } catch (e) {
    dbp = null;
    if (retry) return run(name, mode, work, false);
    throw e;
  }
}

export const getAll = (name) => run(name, 'readonly', (s) => s.getAll());

/** Adds one row and resolves to its generated id. */
export const add = (name, row) => run(name, 'readwrite', (s) => s.add(row));

export const addMany = (name, rows) => (rows.length ? run(name, 'readwrite', (s) => { for (const r of rows) s.add(r); }) : Promise.resolve());

export const remove = (name, id) => run(name, 'readwrite', (s) => s.delete(id));

export async function kvGet(key, fallback) {
  const v = await run('kv', 'readonly', (s) => s.get(key));
  return v === undefined ? fallback : v;
}

export const kvPut = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));
