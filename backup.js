// Pure backup/import/CSV logic (no DOM, no database), so it can be unit-tested.
import { STORES } from './db.js';
export const SCHEMA_VERSION = 1, APP_VERSION = '1.0.0';
const BSTORES = STORES.filter(s => s !== 'meta');
export const buildBackup = (data, now = new Date()) => ({ app: 'LifeOS', schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: now.toISOString(), stores: data });
export function validateBackup(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ['This file is not a LifeOS backup.'];
  const e = []; if (b.app !== 'LifeOS') e.push('The LifeOS marker is missing.');
  if (b.schemaVersion !== SCHEMA_VERSION) e.push(`Unsupported schema version ${b.schemaVersion}. This app reads version ${SCHEMA_VERSION}.`);
  if (!b.stores || typeof b.stores !== 'object' || Array.isArray(b.stores)) return [...e, 'The data section is missing.'];
  for (const [name, recs] of Object.entries(b.stores)) {
    if (!BSTORES.includes(name)) { e.push(`Unknown data group "${name}".`); continue; }
    if (!Array.isArray(recs)) { e.push(`"${name}" is not a list.`); continue; }
    const seen = new Set();
    recs.forEach((r, i) => { if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !r.id) e.push(`${name}[${i}] has no valid id.`);
      else if (seen.has(r.id)) e.push(`${name} has a duplicate id: ${r.id}.`); else seen.add(r.id); });
  }
  return e;
}
const norm = r => JSON.stringify(r, (k, v) => k === 'updatedAt' || k === 'createdAt' ? undefined : (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
// Safe merge: new ids are added, identical records skipped, same-id/different-content records become conflicts (never overwritten here),
// and a deletion newer than the backed-up record blocks it from coming back.
export function planImport(b, cur) {
  const tomb = new Map(); for (const t of [...(cur.tombstones || []), ...(b.stores.tombstones || [])]) tomb.set(t.id, t.deletedAt || '');
  const plan = { adds: [], conflicts: [], deletes: [], skipped: 0, blocked: 0 };
  for (const [store, recs] of Object.entries(b.stores)) {
    const mine = new Map((cur[store] || []).map(r => [r.id, r]));
    for (const r of recs) {
      if (store === 'tombstones') {
        if (mine.has(r.id)) plan.skipped++; else plan.adds.push({ store, rec: r });
        const loc = (cur[r.store] || []).find(x => x.id === r.recordId); if (loc && (loc.updatedAt || '') < (r.deletedAt || '')) plan.deletes.push({ store: r.store, id: r.recordId });
        continue;
      }
      const d = tomb.get(`${store}:${r.id}`); if (d !== undefined && d > (r.updatedAt || '')) { plan.blocked++; continue; }
      const m = mine.get(r.id);
      if (!m) plan.adds.push({ store, rec: r }); else if (norm(m) === norm(r)) plan.skipped++; else plan.conflicts.push({ store, id: r.id, mine: m, theirs: r });
    }
  }
  return plan;
}
// policy: 'mine' (keep local), 'theirs' (take imported), 'newer' (later updatedAt wins)
export function resolvePlan(plan, policy) {
  const puts = [...plan.adds];
  for (const c of plan.conflicts) if (policy === 'theirs' || (policy === 'newer' && (c.theirs.updatedAt || '') > (c.mine.updatedAt || ''))) puts.push({ store: c.store, rec: c.theirs });
  return { puts, dels: plan.deletes };
}
const esc = v => { if (v == null) return ''; let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // blocks spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCSV = (rows, cols) => [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
export const CSV_SETS = { tasks: ['id', 'title', 'courseId', 'category', 'priority', 'status', 'deadlineAt', 'estimateSec', 'completedAt', 'description'],
  focusSessions: ['id', 'date', 'mode', 'focusedSec', 'breakSec', 'courseId', 'taskId', 'status', 'source', 'notes'], distractionLogs: ['id', 'date', 'category', 'durationSec', 'startAt', 'endAt', 'notes'],
  habitLogs: ['habitId', 'date', 'value'], routineLogs: ['activityId', 'date', 'status'] };
