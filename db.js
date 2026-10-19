// All IndexedDB access lives here. Durations are stored as integer SECONDS.
const DB_NAME = 'lifeos', DB_VERSION = 1;
// Fires 'change' after every real data write (not timers/meta), so cloud sync can react. detail.imported = a backup import.
export const events = new EventTarget();
const changed = (detail = {}) => events.dispatchEvent(new CustomEvent('change', { detail }));
export const STORES = ['settings', 'courses', 'semesters', 'routineActivities', 'routineExceptions', 'routineLogs', 'tasks',
  'focusSessions', 'distractionLogs', 'habits', 'habitLogs', 'milestones', 'weeklyReviews', 'tombstones', 'meta'];
let db;
export const uid = () => crypto.randomUUID();
const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export function openDB() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB is not available in this browser.'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { // only ever ADDS stores, never clears data
      for (const n of STORES) if (!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n, { keyPath: 'id' });
    };
    req.onsuccess = () => { db = req.result; db.onversionchange = () => db.close(); res(db); };
    req.onerror = () => rej(req.error);
    req.onblocked = () => rej(new Error('Close other LifeOS tabs and reload.'));
  });
}
// Resolves only after the transaction has committed, so "saved" is never claimed early.
function tx(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode); let out;
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transaction aborted'));
    out = fn(t);
  });
}
export const get = (s, id) => new Promise(r => {
  const q = db.transaction(s).objectStore(s).get(id); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null);
});
export const all = s => new Promise((res, rej) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
export async function put(s, rec) {
  const now = new Date().toISOString();
  const r = { ...rec, id: rec.id || uid(), createdAt: rec.createdAt || now, updatedAt: now };
  await tx(s, 'readwrite', t => { t.objectStore(s).put(r); }); if (s !== 'meta') changed(); return r;
}
export async function remove(s, id) { // leaves a tombstone so an old backup cannot resurrect it
  await tx([s, 'tombstones'], 'readwrite', t => {
    t.objectStore(s).delete(id);
    if (s !== 'tombstones') t.objectStore('tombstones').put({ id: `${s}:${id}`, store: s, recordId: id, deletedAt: new Date().toISOString() });
  });
  changed();
}
export async function putMany(s, recs) {
  const now = new Date().toISOString();
  const rs = recs.map(r => ({ ...r, id: r.id || uid(), createdAt: r.createdAt || now, updatedAt: now }));
  await tx(s, 'readwrite', t => { rs.forEach(r => t.objectStore(s).put(r)); }); if (s !== 'meta') changed(); return rs;
}
export async function clearAll() { await tx(STORES, 'readwrite', t => { STORES.forEach(n => t.objectStore(n).clear()); }); }

export const getSettings = () => get('settings', 'main');
export const saveSettings = v => put('settings', { ...v, id: 'main' });

const PALETTE = ['#1d4ed8', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f'];
export const colorFor = i => PALETTE[i % PALETTE.length];

// Sample data: every record carries isSample:true so it can be removed without touching real records.
export async function addSample() {
  const h = n => new Date(Date.now() + n * 36e5).toISOString();
  await putMany('tasks', [
    { title: '[Sample] Lab report draft', category: 'Lab reports', priority: 'High', status: 'In progress', deadlineAt: h(30), estimateSec: 7200 },
    { title: '[Sample] Quiz revision', category: 'Quizzes', priority: 'Medium', status: 'Not started', deadlineAt: h(80), estimateSec: 5400 },
  ].map(x => ({ ...x, isSample: true })));
  await putMany('habits', [
    { name: '[Sample] Lecture revision', type: 'binary', target: 1, weekdays: [0, 1, 2, 3, 4], startDate: null, archived: false },
    { name: '[Sample] IELTS practice (min)', type: 'duration', target: 60, weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: null, archived: false },
  ].map(x => ({ ...x, isSample: true })));
  await put('meta', { id: 'sampleLoaded', value: true });
}
export async function removeSample() { // tombstones are written so the deletion also reaches your other devices
  const now = new Date().toISOString();
  for (const s of STORES) {
    if (s === 'settings' || s === 'tombstones' || s === 'meta') continue;
    const ids = (await all(s)).filter(r => r.isSample).map(r => r.id);
    if (ids.length) await tx([s, 'tombstones'], 'readwrite', t => { ids.forEach(i => { t.objectStore(s).delete(i); t.objectStore('tombstones').put({ id: `${s}:${i}`, store: s, recordId: i, deletedAt: now }); }); });
  }
  await tx('meta', 'readwrite', t => { t.objectStore('meta').delete('sampleLoaded'); });
  changed();
}

// Saves a finished focus session and clears the running-timer record in ONE transaction.
// The session id is the key, so saving the same session twice overwrites instead of duplicating.
export async function saveSession(rec) {
  const now = new Date().toISOString(), r = { ...rec, createdAt: now, updatedAt: now };
  await tx(['focusSessions', 'meta'], 'readwrite', t => { t.objectStore('focusSessions').put(r); t.objectStore('meta').delete('timer'); });
  changed(); return r;
}
export async function deleteMeta(id) { await tx('meta', 'readwrite', t => { t.objectStore('meta').delete(id); }); }

// Whole-database helpers for backup/import. applyOps runs in ONE transaction: it fully commits or changes nothing.
export async function exportAll() { const o = {}; for (const s of STORES) if (s !== 'meta') o[s] = await all(s); return o; }
// source: 'import' (default, backup file) or 'sync' (cloud pull, which must not trigger another push).
export async function applyOps(puts, dels, source = 'import') {
  const stores = [...new Set([...puts.map(p => p.store), ...dels.map(d => d.store)])]; if (!stores.length) return;
  await tx(stores, 'readwrite', t => { puts.forEach(p => t.objectStore(p.store).put(p.rec)); dels.forEach(d => t.objectStore(d.store).delete(d.id)); });
  if (source !== 'sync') changed({ imported: true });
}
