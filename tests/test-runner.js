// Tiny dependency-free test runner. Works in the browser (test-runner.html) and in Node.
import * as C from '../calculations.js';
import * as B from '../backup.js';
import * as S from '../syncmerge.js';
const results = []; const test = (n, f) => { try { f(); results.push([n, true]); } catch (e) { results.push([n, false, e.message]); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const tz = 'Asia/Dhaka', now = new Date('2026-10-18T10:00:00Z');
test('graduation before target', () => eq(C.graduationCountdown('2027-05-15', now, tz).days, 209));
test('graduation after target is never negative', () => eq(C.graduationCountdown('2026-01-01', now, tz), { valid: true, passed: true, days: 0, months: 0, remDays: 0 }));
test('graduation on the day', () => eq(C.graduationCountdown('2026-10-18', now, tz).days, 0));
test('deadline before', () => eq(C.deadlineState({ deadlineAt: '2026-10-18T10:40:00Z' }, now).text, 'Due in 40 minutes'));
test('deadline after is overdue, not completed', () => eq(C.deadlineState({ status: 'Not started', deadlineAt: '2026-10-17T09:00:00Z' }, now).kind, 'overdue'));
test('completed on time / late', () => { eq(C.deadlineState({ status: 'Completed', deadlineAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-17T00:00:00Z' }).text, 'Completed on time'); eq(C.deadlineState({ status: 'Completed', deadlineAt: '2026-10-17T00:00:00Z', completedAt: '2026-10-18T00:00:00Z' }).text, 'Completed late'); });
test('timezone crosses midnight and year', () => eq(C.zoned(new Date('2026-12-31T19:00:00Z'), tz).date, '2027-01-01'));
test('month boundary', () => { eq(C.monthDays(2027, 2).length, 28); eq(C.addDays('2026-12-31', 1), '2027-01-01'); });
test('timer pause and resume', () => { eq(C.elapsedMs({ startedAt: 1000, pausedAt: 31000, accPausedMs: 0 }, 999999), 30000); eq(C.elapsedMs({ startedAt: 1000, pausedAt: null, accPausedMs: 60000 }, 151000), 90000); });
test('habit statuses', () => { const hb = { weekdays: [0, 1, 2, 3, 4], target: 1 }; eq(['2026-10-19', '2026-10-17', '2026-10-16'].map(d => C.habitStatus(hb, undefined, d, '2026-10-18')), ['future', 'unscheduled', 'nodata']); eq(C.habitStatus({ ...hb, target: 3 }, 2, '2026-10-16', '2026-10-18'), 'partial'); });
test('routine adherence excludes cancelled and unfinished', () => eq(C.routineAdherence([{ id: 'a', days: [6], start: '08:00', end: '09:00' }, { id: 'b', days: [6], start: '09:00', end: '10:00' }, { id: 'c', days: [6], start: '10:00', end: '11:00' }, { id: 'd', days: [6], start: '12:00', end: '13:00' }], { a: 'completed', b: 'skipped', c: 'cancelled' }, 6, 690).pct, 50));
test('missing data is null, zero stays zero', () => { const r = C.dailyRows(['2026-10-16', '2026-10-17'], [], [{ date: '2026-10-17', category: 'Social media', durationSec: 0 }]); eq([r[0].distMin, r[1].distMin], [null, 0]); });
test('overlap detection', () => eq(C.findOverlaps([{ id: '1', days: [0], start: '10:00', end: '11:00' }, { id: '2', days: [0], start: '10:30', end: '12:00' }]).length, 1));
const mk = (id, extra = {}) => ({ id, updatedAt: '2026-10-01T00:00:00Z', ...extra });
const bk = stores => B.buildBackup(stores);
test('invalid / unsupported / duplicate backups are rejected', () => { eq(B.validateBackup(null).length > 0, true); eq(B.validateBackup({ ...bk({}), schemaVersion: 99 }).length > 0, true); eq(B.validateBackup(bk({ tasks: [mk('x'), mk('x')] })).length > 0, true); });
test('valid backup passes', () => eq(B.validateBackup(bk({ tasks: [mk('x')] })), []));
test('new added, identical skipped, different = conflict (not overwritten)', () => {
  const p = B.planImport(bk({ tasks: [mk('n'), mk('same', { title: 'A' }), mk('c', { title: 'Theirs' })] }), { tasks: [mk('same', { title: 'A', updatedAt: '2026-11-01' }), mk('c', { title: 'Mine' })] });
  eq([p.adds.length, p.skipped, p.conflicts.length], [1, 1, 1]); eq(B.resolvePlan(p, 'mine').puts.length, 1); eq(B.resolvePlan(p, 'theirs').puts.length, 2); });
test('deleted record is not resurrected by an older backup', () => eq(B.planImport(bk({ tasks: [mk('d')] }), { tasks: [], tombstones: [{ id: 'tasks:d', store: 'tasks', recordId: 'd', deletedAt: '2026-10-10T00:00:00Z' }] }).blocked, 1));
test('round trip: export then import into empty db adds everything', () => { const d = { tasks: [mk('a'), mk('b')], habits: [mk('h')] }; const p = B.planImport(bk(d), {}); eq([p.adds.length, p.conflicts.length], [3, 0]); });
test('CSV escapes quotes, commas, newlines and formulas', () => eq(B.toCSV([{ a: 'x,"y"\nz', b: '=SUM(A1)', c: 5 }], ['a', 'b', 'c']), 'a,b,c\r\n"x,""y""\nz",\'=SUM(A1),5'));
const row = (store, id, ts, extra = {}) => ({ store, id, updated_at: ts, deleted: false, data: { id, updatedAt: ts, ...extra }, ...extra.row });
test('sync: timestamps with +00:00 and Z compare as time, not text', () => { const p = S.planPull([row('tasks', 'a', '2026-10-19T10:00:00.500000+00:00')], { tasks: [{ id: 'a', updatedAt: '2026-10-19T10:00:00.000Z' }] }); eq(p.puts.length, 1); });
test('sync: newer remote wins, older remote loses', () => { const loc = { tasks: [{ id: 'a', updatedAt: '2026-10-19T10:00:00.000Z' }] };
  eq(S.planPull([row('tasks', 'a', '2026-10-19T09:00:00.000Z')], loc).puts.length, 0); eq(S.planPull([row('tasks', 'a', '2026-10-19T11:00:00.000Z')], loc).puts.length, 1); });
test('sync: remote deletion removes older local record and leaves a tombstone', () => { const p = S.planPull([{ store: 'tasks', id: 'a', deleted: true, data: null, updated_at: '2026-10-19T11:00:00.000Z' }], { tasks: [{ id: 'a', updatedAt: '2026-10-19T10:00:00.000Z' }] });
  eq([p.dels.length, p.puts[0].store], [1, 'tombstones']); });
test('sync: my newer edit survives an older remote deletion', () => eq(S.planPull([{ store: 'tasks', id: 'a', deleted: true, data: null, updated_at: '2026-10-19T09:00:00.000Z' }], { tasks: [{ id: 'a', updatedAt: '2026-10-19T10:00:00.000Z' }] }).dels.length, 0));
test('sync: my newer local deletion blocks an older remote copy', () => eq(S.planPull([row('tasks', 'a', '2026-10-19T09:00:00.000Z')], { tombstones: [{ id: 'tasks:a', store: 'tasks', recordId: 'a', deletedAt: '2026-10-19T10:00:00.000Z' }] }).puts.length, 0));
test('sync: unknown stores from the cloud are ignored', () => eq(S.planPull([row('evil', 'a', '2026-10-19T09:00:00.000Z')], {}).puts.length, 0));
test('sync: push sends only changes since last push, plus deletions', () => { const loc = { tasks: [{ id: 'old', updatedAt: '2026-10-01T00:00:00.000Z' }, { id: 'new', updatedAt: '2026-10-19T00:00:00.000Z' }], tombstones: [{ id: 'tasks:x', store: 'tasks', recordId: 'x', deletedAt: '2026-10-19T01:00:00.000Z' }] };
  eq(S.planPush(loc, '2026-10-10T00:00:00.000Z', 'u').map(r => `${r.id}:${r.deleted}`).sort(), ['new:false', 'x:true']); eq(S.planPush(loc, null, 'u').length, 3); });
test('sync: push never sends two rows for the same record (habit log delete then re-add)', () => { const loc = { habitLogs: [{ id: 'h:d', updatedAt: '2026-10-19T02:00:00.000Z' }], tombstones: [{ id: 'habitLogs:h:d', store: 'habitLogs', recordId: 'h:d', deletedAt: '2026-10-19T01:00:00.000Z' }] };
  const r = S.planPush(loc, null, 'u'); eq([r.length, r[0].deleted], [1, false]); });
test('sync: records just pulled are not echoed back', () => { const loc = { tasks: [{ id: 'a', updatedAt: '2026-10-19T10:00:00.000Z' }] }; const p = S.planPull([row('tasks', 'a', '2026-10-19T10:00:00.000+00:00')], {}); eq(S.planPush(loc, null, 'u', p.seen).length, 0); });
const failed = results.filter(r => !r[1]);
if (typeof document !== 'undefined') { const ul = document.getElementById('out'); results.forEach(([n, ok, m]) => { const li = document.createElement('li'); li.textContent = `${ok ? 'PASS' : 'FAIL'}: ${n}${m ? ' (' + m + ')' : ''}`; ul.append(li); }); document.getElementById('sum').textContent = `${results.length - failed.length} of ${results.length} passed`; }
else { results.forEach(([n, ok, m]) => console.log(ok ? 'PASS' : 'FAIL', n, m || '')); console.log(`${results.length - failed.length}/${results.length} passed`); }
