// Pure sync logic (no network, no DOM, no database), so it can be unit-tested. Conflict rule: the later edit wins.
import { STORES } from './db.js';
export const SYNC_STORES = STORES.filter(s => s !== 'meta' && s !== 'tombstones');
// Postgres returns "+00:00" timestamps and the app stores "Z" ones, so compare as numbers, never as strings.
const ms = s => { const n = Date.parse(s); return Number.isNaN(n) ? 0 : n; };
export const isoOf = s => new Date(ms(s)).toISOString();

// rows: cloud rows. local: { store: [records], tombstones: [...] }. Returns the local writes to apply.
export function planPull(rows, local) {
  const recs = {}; for (const s of SYNC_STORES) recs[s] = new Map((local[s] || []).map(r => [r.id, r]));
  const tombs = new Map((local.tombstones || []).map(t => [t.id, t]));
  const puts = [], dels = [], seen = new Map();
  for (const row of rows) {
    if (!SYNC_STORES.includes(row.store)) continue;
    const key = `${row.store}:${row.id}`, rts = ms(row.updated_at), mine = recs[row.store].get(row.id), tomb = tombs.get(key);
    seen.set(key, rts);
    if (row.deleted) {
      if (mine && ms(mine.updatedAt) >= rts) continue;               // my copy is newer: keep it, it will be pushed
      if (mine) dels.push({ store: row.store, id: row.id });
      if (!tomb || ms(tomb.deletedAt) < rts) puts.push({ store: 'tombstones', rec: { id: key, store: row.store, recordId: row.id, deletedAt: isoOf(row.updated_at) } });
    } else {
      const rec = row.data; if (!rec || typeof rec !== 'object' || rec.id !== row.id) continue;
      if (tomb && ms(tomb.deletedAt) > rts) continue;                // I deleted it more recently
      if (!mine || ms(mine.updatedAt) < rts) { puts.push({ store: row.store, rec }); if (tomb) dels.push({ store: 'tombstones', id: tomb.id }); }
    }
  }
  return { puts, dels, seen };
}

// Local changes since `since` (ISO string, or null = everything). `seen` (from planPull) stops us echoing back what we just received.
export function planPush(local, since, uid, seen = new Map()) {
  const floor = since ? ms(since) : -1, out = new Map();
  const add = (store, id, data, deleted, ts) => {
    const t = ms(ts), key = `${store}:${id}`; if (t < floor || seen.get(key) === t) return;
    const cur = out.get(key); if (!cur || cur.t < t) out.set(key, { t, row: { user_id: uid, store, id, data, deleted, updated_at: new Date(t).toISOString() } });
  };
  for (const s of SYNC_STORES) for (const r of local[s] || []) add(s, r.id, r, false, r.updatedAt || r.createdAt);
  for (const t of local.tombstones || []) if (SYNC_STORES.includes(t.store)) add(t.store, t.recordId, null, true, t.deletedAt);
  return [...out.values()].map(x => x.row);   // one row per record, so the upsert never touches the same row twice
}
