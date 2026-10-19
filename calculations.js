// Pure functions only: no DOM, no database. Shared by every screen and by tests.
export function zoned(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday: p.weekday };
}
export const greeting = h => (h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night');
const utcDay = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const isDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(utcDay(s)) && new Date(utcDay(s)).toISOString().slice(0, 10) === s;
// Calendar-day countdown in the configured timezone. Never negative.
export function graduationCountdown(targetStr, now, tz) {
  if (!isDateStr(targetStr || '')) return { valid: false };
  const t = zoned(now, tz).date;
  const days = Math.round((utcDay(targetStr) - utcDay(t)) / 864e5);
  if (days < 0) return { valid: true, passed: true, days: 0, months: 0, remDays: 0 };
  const [ty, tm, td] = t.split('-').map(Number), [gy, gm, gd] = targetStr.split('-').map(Number);
  let months = (gy - ty) * 12 + (gm - tm); if (gd < td) months--;
  const anchor = Date.UTC(ty, tm - 1 + months, td);
  return { valid: true, passed: false, days, months, remDays: Math.round((utcDay(targetStr) - anchor) / 864e5) };
}

// ---------- Phase 3: deadlines, routine, task ordering ----------
const p2 = n => String(n).padStart(2, '0');
export const toMin = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
export const WEEKDAY_INDEX = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 }; // Monday = 0
// 'YYYY-MM-DDTHH:mm' typed in the configured timezone -> UTC ISO string
export function localToISO(str, tz) {
  const [d, t] = str.split('T'), [y, m, da] = d.split('-').map(Number), [hh, mm] = t.split(':').map(Number);
  const want = Date.UTC(y, m - 1, da, hh, mm); let g = want;
  for (let i = 0; i < 2; i++) { const z = zoned(new Date(g), tz); g += want - Date.UTC(z.y, z.m - 1, z.d, z.h, z.min); }
  return new Date(g).toISOString();
}
export function isoToLocal(iso, tz) { const z = zoned(new Date(iso), tz); return `${z.date}T${p2(z.h)}:${p2(z.min)}`; }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function formatSpan(ms) {
  const m = Math.floor(ms / 6e4), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${plural(d, 'day')}, ${plural(h, 'hour')}` : h ? `${plural(h, 'hour')}, ${plural(m % 60, 'minute')}` : plural(m, 'minute');
}
// Always computed from the real clock; never from a decrementing counter. Passing the deadline never completes a task.
export function deadlineState(task, now = new Date()) {
  if (task.status === 'Completed') return { kind: 'done', text: 'Completed' + (task.completedAt && task.deadlineAt ? (task.completedAt <= task.deadlineAt ? ' on time' : ' late') : '') };
  if (task.status === 'Cancelled') return { kind: 'cancelled', text: 'Cancelled' };
  if (!task.deadlineAt) return { kind: 'none', text: 'No deadline' };
  const ms = new Date(task.deadlineAt) - now;
  if (ms < 0) return { kind: 'overdue', text: `Overdue by ${formatSpan(-ms)}` };
  return { kind: ms < 864e5 ? 'soon' : 'ok', text: ms < 36e5 ? `Due in ${plural(Math.max(1, Math.ceil(ms / 6e4)), 'minute')}` : `${formatSpan(ms)} remaining` };
}
const PRI = { Critical: 0, High: 1, Medium: 2, Low: 3 };
export function sortTasks(tasks, now = new Date()) {
  const rank = t => { const k = deadlineState(t, now).kind; return k === 'overdue' ? 0 : (k === 'done' || k === 'cancelled') ? 2 : 1; };
  return [...tasks].sort((a, b) => rank(a) - rank(b) || (a.deadlineAt || '9').localeCompare(b.deadlineAt || '9') ||
    (PRI[a.priority] ?? 9) - (PRI[b.priority] ?? 9) || (b.estimateSec || 0) - (a.estimateSec || 0));
}
// Activities running past midnight (end <= start) are split into today's tail and the next day's head.
function segments(acts, day) {
  const out = [];
  for (const a of acts) {
    const s = toMin(a.start), e = toMin(a.end);
    if (e > s) { if (a.days.includes(day)) out.push({ act: a, s, e }); }
    else { if (a.days.includes(day)) out.push({ act: a, s, e: 1440 }); if (a.days.includes((day + 6) % 7) && e > 0) out.push({ act: a, s: 0, e }); }
  }
  return out;
}
export function findOverlaps(acts) {
  const res = [];
  for (let d = 0; d < 7; d++) {
    const sg = segments(acts, d);
    for (let i = 0; i < sg.length; i++) for (let j = i + 1; j < sg.length; j++)
      if (sg[i].act.id !== sg[j].act.id && sg[i].s < sg[j].e && sg[j].s < sg[i].e) res.push({ day: d, a: sg[i].act, b: sg[j].act });
  }
  return res;
}
export function currentAndNext(acts, now, tz) {
  const z = zoned(now, tz), day = WEEKDAY_INDEX[z.weekday], m = z.h * 60 + z.min;
  const sg = segments(acts, day).sort((a, b) => a.s - b.s);
  const cur = sg.find(x => x.s <= m && m < x.e) || null, next = sg.find(x => x.s > m) || null;
  return { current: cur, next, remainingMin: cur ? cur.e - m : null, progressPct: cur ? Math.round((m - cur.s) / (cur.e - cur.s) * 100) : null };
}

// ---------- Phase 4: timer, aggregation, habits, routine adherence ----------
export const dayOf = (iso, tz) => zoned(new Date(iso), tz).date;
// Elapsed focus time comes from timestamps, so refreshes and background-tab throttling cannot cause drift.
export const elapsedMs = (t, now = Date.now()) => Math.max(0, (t.pausedAt ?? now) - t.startedAt - (t.accPausedMs || 0));
export function sumByDay(recs, field) { const m = {}; for (const r of recs) m[r.date] = (m[r.date] || 0) + (r[field] || 0); return m; }
export const weekdayOf = s => (new Date(utcDay(s)).getUTCDay() + 6) % 7; // Monday = 0
// completed | partial | missed (recorded 0) | nodata (scheduled, nothing recorded) | unscheduled | future
export function habitStatus(hb, value, date, today) {
  if (date > today) return 'future';
  if ((hb.startDate && date < hb.startDate) || (hb.endDate && date > hb.endDate) || !hb.weekdays.includes(weekdayOf(date))) return 'unscheduled';
  if (value == null) return 'nodata';
  return value >= hb.target ? 'completed' : value > 0 ? 'partial' : 'missed';
}
export const monthDays = (y, m) => Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${y}-${p2(m)}-${p2(i + 1)}`);
// Rate = completed / scheduled days up to today. 'nodata' days are reported separately, never treated as verified zeros.
export function habitMonthStats(hb, valueByDate, y, m, today) {
  const s = { scheduled: 0, completed: 0, partial: 0, missed: 0, nodata: 0 };
  for (const d of monthDays(y, m)) { const st = habitStatus(hb, valueByDate[d], d, today); if (st in s) { s[st]++; s.scheduled++; } }
  return { ...s, pct: s.scheduled ? Math.round(s.completed / s.scheduled * 100) : null };
}
// Eligible = non-overnight activities scheduled today that have already ended, minus cancelled ones.
// completed counts fully; skipped or unlogged counts as not done. Partial credit is not implemented yet.
export function routineAdherence(acts, statusById, day, nowMin) {
  let el = 0, done = 0;
  for (const a of acts) {
    const s = toMin(a.start), e = toMin(a.end);
    if (e <= s || !a.days.includes(day) || e > nowMin || statusById[a.id] === 'cancelled') continue;
    el += e - s; if (statusById[a.id] === 'completed') done += e - s;
  }
  return { pct: el ? Math.round(done / el * 100) : null, eligibleMin: el, doneMin: done };
}

// ---------- Phase 5: ranges and report aggregation ----------
export const addDays = (s, n) => new Date(utcDay(s) + n * 864e5).toISOString().slice(0, 10);
export function dateRange(a, b) { const o = []; for (let d = a; d <= b && o.length < 366; d = addDays(d, 1)) o.push(d); return o; }
export function rangeFor(kind, today, c) {
  switch (kind) {
    case 'today': return [today];
    case '7d': return dateRange(addDays(today, -6), today);
    case 'week': return dateRange(addDays(today, -weekdayOf(today)), today);
    case '30d': return dateRange(addDays(today, -29), today);
    case 'month': return dateRange(today.slice(0, 8) + '01', today);
    default: return c && isDateStr(c.from) && isDateStr(c.to) && c.from <= c.to ? dateRange(c.from, c.to) : [];
  }
}
// null means "nothing recorded that day"; 0 means "recorded, and it was zero". Charts show null as a gap.
export function dailyRows(dates, sessions, dists) {
  const f = sumByDay(sessions, 'focusedSec'), d = sumByDay(dists, 'durationSec'), soc = {};
  dists.filter(r => r.category === 'Social media').forEach(r => { soc[r.date] = (soc[r.date] || 0) + r.durationSec; });
  const hf = new Set(sessions.map(r => r.date)), hd = new Set(dists.map(r => r.date));
  return dates.map(date => ({ date, focusMin: hf.has(date) ? f[date] / 60 : null, distMin: hd.has(date) ? d[date] / 60 : null, socialMin: hd.has(date) ? (soc[date] || 0) / 60 : null }));
}
export function habitRange(dates, habits, logs, today) {
  const act = habits.filter(x => !x.archived), val = {}; logs.forEach(l => { (val[l.habitId] ||= {})[l.date] = l.value; });
  const per = act.map(hb => ({ habit: hb, scheduled: 0, completed: 0, nodata: 0 }));
  const daily = dates.map(date => { let s = 0, c = 0;
    act.forEach((hb, i) => { const st = habitStatus(hb, val[hb.id]?.[date], date, today); if (st === 'future' || st === 'unscheduled') return; s++; per[i].scheduled++; if (st === 'completed') { c++; per[i].completed++; } else if (st === 'nodata') per[i].nodata++; });
    return { date, scheduled: date > today ? null : s, completed: date > today ? null : c }; });
  per.forEach(p => { p.pct = p.scheduled ? Math.round(p.completed / p.scheduled * 100) : null; });
  return { daily, per };
}
export function taskStats(tasks, sessions, dates, tz, now = new Date()) {
  if (!dates.length) return null;
  const inR = d => d >= dates[0] && d <= dates[dates.length - 1], k = t => deadlineState(t, now).kind;
  const completed = tasks.filter(t => t.status === 'Completed' && t.completedAt && inR(dayOf(t.completedAt, tz)));
  const act = {}; sessions.forEach(s => { if (s.taskId) act[s.taskId] = (act[s.taskId] || 0) + (s.focusedSec || 0); });
  const due = tasks.filter(t => t.deadlineAt && t.status !== 'Cancelled' && inR(dayOf(t.deadlineAt, tz))), dueDone = due.filter(t => t.status === 'Completed').length;
  return { completed: completed.length, onTime: completed.filter(t => t.deadlineAt && t.completedAt <= t.deadlineAt).length, overdue: tasks.filter(t => k(t) === 'overdue').length,
    upcoming: tasks.filter(t => ['ok', 'soon'].includes(k(t))).length, compare: completed.filter(t => t.estimateSec > 0 && act[t.id] > 0).map(t => ({ title: t.title, est: t.estimateSec, act: act[t.id] })),
    dueInRange: due.length, dueCompleted: dueDone, rate: due.length ? Math.round(dueDone / due.length * 100) : null };
}
export function studyByCourse(sessions, dates) { const m = {}; sessions.filter(s => dates.includes(s.date)).forEach(s => { m[s.courseId || ''] = (m[s.courseId || ''] || 0) + (s.focusedSec || 0); }); return m; }
export function routineReport(acts, logs, dates, today, nowMin) {
  const by = Array.from({ length: 7 }, () => ({ done: 0, elig: 0 })), missed = {}, counts = { completed: 0, skipped: 0, cancelled: 0, unlogged: 0 }, st = {};
  logs.forEach(l => { (st[l.date] ||= {})[l.activityId] = l.status; });
  for (const date of dates) {
    if (date > today) continue; const wd = weekdayOf(date), lim = date === today ? nowMin : 1440, sm = st[date] || {};
    const r = routineAdherence(acts, sm, wd, lim); by[wd].done += r.doneMin; by[wd].elig += r.eligibleMin;
    for (const a of acts) { if (toMin(a.end) <= toMin(a.start) || !a.days.includes(wd) || toMin(a.end) > lim) continue;
      const s = sm[a.id] || 'unlogged'; counts[s] = (counts[s] || 0) + 1; if (s !== 'completed' && s !== 'cancelled') missed[a.title] = (missed[a.title] || 0) + 1; }
  }
  return { byWeekday: by.map(x => ({ ...x, pct: x.elig ? Math.round(x.done / x.elig * 100) : null })), counts, missed: Object.entries(missed).sort((a, b) => b[1] - a[1]).slice(0, 5) };
}
