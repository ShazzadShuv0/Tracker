// Phase 4 screens: Focus Tracker (timer, study history, distractions) and Habits.
import { elapsedMs, zoned, sumByDay, habitStatus, habitMonthStats, monthDays, isDateStr } from './calculations.js';
const MODES = { pomodoro: ['Pomodoro focus', 25], custom: ['Custom focus', 45], stopwatch: ['Stopwatch', 0], short: ['Short break', 5], long: ['Long break', 15] };
const DCATS = ['Social media', 'Video streaming', 'Unplanned browsing', 'Gaming', 'Other distractions'];
const mmss = ms => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const dur = sec => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const SYM = { completed: '✓', partial: '◐', missed: '✕', nodata: '·', unscheduled: '–', future: '' };

export function createTracking({ h, toast, guard, DB, getSettings, setTick, ui }) {
  const { formDialog, row, btn, confirmDel, empty } = ui;
  const root = () => document.querySelector('#view');
  let mode = 'pomodoro', mins = 25, selCourse = '', selTask = '', dCat = DCATS[0], ym = null;

  async function renderFocus() {
    const tz = getSettings().timezone, today = zoned(new Date(), tz).date;
    const [tm, sessions, dists, courses, tasks, dt] = await Promise.all([DB.get('meta', 'timer'), DB.all('focusSessions'), DB.all('distractionLogs'), DB.all('courses'), DB.all('tasks'), DB.get('meta', 'distTimer')]);
    const cname = id => courses.find(c => c.id === id)?.code || 'No course', paints = [];
    const cOpts = [['', 'No course'], ...courses.map(c => [c.id, c.code])];
    const sel = (opts, val, fn, label) => { const s = h('select', { 'aria-label': label }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l))); s.addEventListener('change', () => fn(s.value)); return h('label', {}, label, s); };

    // ----- focus timer -----
    let timerCard;
    if (tm) {
      const disp = h('div', { class: 'big clock', role: 'timer' });
      paints.push(() => { const el = elapsedMs(tm), tg = tm.targetMin * 60000; disp.textContent = tg ? (el >= tg ? `Time is up · ${mmss(el)}` : mmss(tg - el)) : mmss(el); });
      timerCard = h('div', { class: 'card' }, h('h2', {}, `${MODES[tm.mode][0]} (${tm.state})`), h('p', { class: 'muted' }, `${cname(tm.courseId)}`), disp, h('div', { class: 'row' },
        tm.state === 'running' ? btn('Pause', async () => { await DB.put('meta', { ...tm, state: 'paused', pausedAt: Date.now() }); renderFocus(); })
          : btn('Resume', async () => { await DB.put('meta', { ...tm, state: 'running', accPausedMs: (tm.accPausedMs || 0) + Date.now() - tm.pausedAt, pausedAt: null }); renderFocus(); }),
        btn('Stop and save', async () => {
          const now = Date.now(), el = elapsedMs(tm, now), brk = tm.mode === 'short' || tm.mode === 'long';
          if (el < 1000) { await DB.deleteMeta('timer'); toast('Under 1 second, nothing saved'); return renderFocus(); }
          await DB.saveSession({ id: tm.sessionId, mode: tm.mode, startAt: new Date(tm.startedAt).toISOString(), endAt: new Date(now).toISOString(), date: zoned(new Date(now), tz).date,
            focusedSec: brk ? 0 : Math.round(el / 1000), breakSec: brk ? Math.round(el / 1000) : 0, courseId: tm.courseId, taskId: tm.taskId,
            status: tm.targetMin && el < tm.targetMin * 60000 ? 'stopped_early' : 'completed', source: 'timer' });
          toast('Session saved'); renderFocus(); }, 'primary'),
        btn('Discard', async () => { if (confirm('Discard this session without saving?')) { await DB.deleteMeta('timer'); renderFocus(); } }, 'danger')));
    } else {
      const mi = h('input', { type: 'number', min: 1, value: mins, 'aria-label': 'Minutes' }); mi.addEventListener('input', () => { mins = +mi.value; });
      timerCard = h('div', { class: 'card' }, h('h2', {}, 'Focus timer'), h('div', { class: 'grid' },
        sel(Object.entries(MODES).map(([k, v]) => [k, v[0]]), mode, v => { mode = v; mins = MODES[v][1]; mi.value = mins; mi.disabled = v === 'stopwatch'; }, 'Mode'), h('label', {}, 'Minutes', mi),
        sel(cOpts, selCourse, v => { selCourse = v; }, 'Course'), sel([['', 'No task'], ...tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled').map(t => [t.id, t.title])], selTask, v => { selTask = v; }, 'Task')),
        h('div', { class: 'row' }, btn('Start', async () => {
          if (mode !== 'stopwatch' && !(mins > 0)) return toast('Enter minutes above 0');
          await DB.put('meta', { id: 'timer', state: 'running', mode, startedAt: Date.now(), pausedAt: null, accPausedMs: 0, targetMin: mode === 'stopwatch' ? 0 : mins, courseId: selCourse, taskId: selTask, sessionId: DB.uid() }); renderFocus(); }, 'primary')));
    }
    // ----- manual study record -----
    const manual = r => formDialog(r ? 'Edit study record' : 'Add study record', [['date', 'Date', 'date'], ['minutes', 'Focused minutes', 'number'], ['courseId', 'Course', 'select', { opts: cOpts }], ['notes', 'Notes', 'textarea']],
      r ? { ...r, minutes: Math.round(r.focusedSec / 60) } : { date: today, minutes: 30, courseId: '' }, async v => {
        if (!isDateStr(v.date)) return 'Enter a valid date.'; if (v.date > today) return 'Date cannot be in the future.'; if (!(v.minutes > 0)) return 'Minutes must be above 0.';
        await DB.put('focusSessions', { ...(r || {}), mode: 'manual', date: v.date, focusedSec: Math.round(v.minutes * 60), breakSec: 0, courseId: v.courseId, notes: v.notes, status: 'completed', source: 'manual' }); }, renderFocus);

    // ----- distractions -----
    let dCard;
    if (dt) {
      const dd = h('div', { class: 'big clock', role: 'timer' }); paints.push(() => { dd.textContent = mmss(Date.now() - dt.startedAt); });
      dCard = h('div', { class: 'card' }, h('h2', {}, `Distraction running: ${dt.category}`), dd, h('div', { class: 'row' }, btn('Stop and save', async () => {
        const end = Date.now(), s = new Date(dt.startedAt).toISOString(), e = new Date(end).toISOString();
        if (dists.some(r => r.id !== dt.id && r.startAt && r.startAt < e && s < r.endAt)) return toast('This overlaps an existing distraction record. Edit that record or discard this timer.');
        await DB.put('distractionLogs', { id: dt.id, category: dt.category, startAt: s, endAt: e, date: zoned(new Date(end), tz).date, durationSec: Math.round((end - dt.startedAt) / 1000), notes: '', source: 'timer' });
        await DB.deleteMeta('distTimer'); toast('Saved'); renderFocus(); }, 'primary'), btn('Discard', async () => { await DB.deleteMeta('distTimer'); renderFocus(); }, 'danger')));
    } else dCard = h('div', { class: 'card' }, h('h2', {}, 'Distractions (recorded by hand)'), h('p', { class: 'muted' }, 'LifeOS cannot measure screen time automatically. These are your own entries.'),
      h('div', { class: 'row' }, sel(DCATS.map(c => [c, c]), dCat, v => { dCat = v; }, 'Category'),
        btn('Start timer', async () => { await DB.put('meta', { id: 'distTimer', startedAt: Date.now(), category: dCat }); renderFocus(); }, 'primary'), btn('Add manually', () => manualD())));
    const manualD = r => formDialog(r ? 'Edit distraction' : 'Add distraction', [['date', 'Date', 'date'], ['category', 'Category', 'select', { opts: DCATS }], ['minutes', 'Minutes', 'number'], ['notes', 'Notes', 'textarea']],
      r ? { ...r, minutes: Math.round(r.durationSec / 60) } : { date: today, category: dCat }, async v => {
        if (!isDateStr(v.date) || v.date > today) return 'Enter a valid, non-future date.'; if (!(v.minutes > 0)) return 'Minutes must be above 0.';
        await DB.put('distractionLogs', { ...(r || {}), date: v.date, category: v.category, durationSec: Math.round(v.minutes * 60), notes: v.notes, source: r?.source || 'manual' }); }, renderFocus);

    const fs = sumByDay(sessions, 'focusedSec'), ds = sumByDay(dists, 'durationSec'), S = getSettings();
    const hist = [...sessions].sort((a, b) => (b.endAt || b.date).localeCompare(a.endAt || a.date)).slice(0, 15);
    const dhist = [...dists].sort((a, b) => (b.endAt || b.date).localeCompare(a.endAt || a.date)).slice(0, 15);
    root().replaceChildren(h('h1', {}, 'Focus Tracker'),
      h('p', {}, `Today: ${dur(fs[today] || 0)} focused of ${S.dailyStudyMin ?? 0}m target. ${dur(ds[today] || 0)} distraction recorded (limit ${S.dailyDistractionMin ?? 0}m).`
        + ((S.dailyDistractionMin != null && (ds[today] || 0) > S.dailyDistractionMin * 60) ? ' Distraction is above your limit today; a short focus session can reset the afternoon.' : '')),
      h('div', { class: 'grid' }, timerCard, dCard),
      h('h2', { style: 'margin-top:1.5rem' }, 'Study history'), h('div', { class: 'row', style: 'margin:0 0 .75rem' }, btn('Add study record', () => manual())),
      ...(hist.length ? hist.map(r => row(`${r.date} · ${r.mode === 'short' || r.mode === 'long' ? 'Break ' + dur(r.breakSec) : dur(r.focusedSec)} (${r.mode})`, `${cname(r.courseId)} · ${r.status} · ${r.source}`,
        ...(r.source === 'manual' ? [btn('Edit', () => manual(r))] : []), confirmDel('focusSessions', r, 'this record', renderFocus))) : [empty('No sessions yet. Start the timer or add one by hand.')]),
      h('h2', { style: 'margin-top:1.5rem' }, 'Distraction history'),
      ...(dhist.length ? dhist.map(r => row(`${r.date} · ${r.category} · ${dur(r.durationSec)}`, r.notes || r.source, btn('Edit', () => manualD(r)), confirmDel('distractionLogs', r, 'this record', renderFocus))) : [empty('No distraction records. That may simply mean none were logged.')]));
    const paint = () => paints.forEach(f => f()); paint(); setTick(paint);
  }

  // ---------- Habits ----------
  async function renderHabits() {
    const tz = getSettings().timezone, z = zoned(new Date(), tz), today = z.date;
    ym = ym || { y: z.y, m: z.m };
    const [habits, logs] = await Promise.all([DB.all('habits'), DB.all('habitLogs')]), days = monthDays(ym.y, ym.m);
    const val = {}; logs.forEach(l => { (val[l.habitId] ||= {})[l.date] = l.value; });
    const hedit = hb => formDialog(hb ? 'Edit habit' : 'Add habit', [['name', 'Name', 'text'], ['type', 'Type', 'select', { opts: [['binary', 'Done / not done'], ['count', 'Count'], ['duration', 'Duration (minutes)']] }], ['target', 'Daily target (1 for done / not done)', 'number'],
      ['weekdays', 'Applicable days', 'days'], ['startDate', 'Start date (optional)', 'date'], ['endDate', 'End date (optional)', 'date'], ['archived', 'Status', 'select', { opts: [['false', 'Active'], ['true', 'Archived']] }]],
      hb ? { ...hb, archived: String(!!hb.archived) } : { type: 'binary', target: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], archived: 'false' }, async v => {
        if (!v.name) return 'Name is required.'; if (!v.weekdays.length) return 'Choose at least one day.'; if (!(v.target > 0)) return 'Target must be above 0.';
        await DB.put('habits', { ...(hb || {}), name: v.name, type: v.type, target: v.type === 'binary' ? 1 : v.target, weekdays: v.weekdays, startDate: v.startDate || null, endDate: v.endDate || null, archived: v.archived === 'true' }); }, renderHabits);
    const setLog = async (hb, d, value) => { const id = `${hb.id}:${d}`; if (value == null) await DB.remove('habitLogs', id); else await DB.put('habitLogs', { id, habitId: hb.id, date: d, value }); renderHabits(); };
    const cell = (hb, d) => {
      const v = val[hb.id]?.[d], st = habitStatus(hb, v, d, today), label = `${hb.name}, ${d}: ${st}${v != null ? ` (${v})` : ''}`;
      const b = h('button', { class: 'btn', type: 'button', 'aria-label': label, title: label, style: `min-width:34px;padding:0;${st === 'completed' ? 'background:var(--ok);color:#fff' : st === 'missed' ? 'color:var(--err)' : st === 'partial' ? 'color:var(--warn)' : ''}`, disabled: st === 'future' || st === 'unscheduled' }, SYM[st] + (hb.type !== 'binary' && v != null ? v : ''));
      b.addEventListener('click', guard(async () => {
        if (hb.type === 'binary') return setLog(hb, d, v == null ? 1 : v >= 1 ? 0 : null); // done -> missed -> cleared
        const a = prompt(`${hb.name} on ${d}: enter ${hb.type === 'duration' ? 'minutes' : 'count'} (target ${hb.target}). Leave blank to clear.`, v ?? '');
        if (a === null) return; if (a.trim() === '') return setLog(hb, d, null);
        const n = Number(a); if (!(n >= 0)) return toast('Enter a number, 0 or more'); setLog(hb, d, n); }));
      return h('td', {}, b);
    };
    const nav = d => { ym = { y: ym.y + Math.floor((ym.m - 1 + d) / 12), m: ((ym.m - 1 + d) % 12 + 12) % 12 + 1 }; renderHabits(); };
    const active = habits.filter(x => !x.archived), shown = habits.sort((a, b) => !!a.archived - !!b.archived);
    root().replaceChildren(h('h1', {}, 'Habits'), h('div', { class: 'row', style: 'margin:0 0 1rem;align-items:center' }, btn('Add habit', () => hedit(), 'primary'), btn('Previous month', () => nav(-1)), h('strong', {}, `${ym.y}-${String(ym.m).padStart(2, '0')}`), btn('Next month', () => nav(1))),
      shown.length ? h('div', { style: 'overflow-x:auto' }, h('table', { style: 'border-collapse:collapse;min-width:100%' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col', style: 'text-align:left;padding:4px' }, 'Habit'), h('th', { scope: 'col' }, 'Month'), days.map(d => h('th', { scope: 'col', style: 'font-weight:400;font-size:.75rem' }, d.slice(8))))),
        h('tbody', {}, shown.map(hb => { const st = habitMonthStats(hb, val[hb.id] || {}, ym.y, ym.m, today);
          return h('tr', { style: hb.archived ? 'opacity:.55' : '' }, h('th', { scope: 'row', style: 'text-align:left;padding:4px;min-width:150px' }, hb.name + (hb.archived ? ' (archived)' : ''), h('div', {}, btn('Edit', () => hedit(hb)), ' ', confirmDel('habits', hb, `"${hb.name}"`, renderHabits))),
            h('td', { style: 'font-size:.8rem;white-space:nowrap' }, st.scheduled ? `${st.completed}/${st.scheduled} (${st.pct}%)${st.nodata ? `, ${st.nodata} no record` : ''}` : 'No scheduled days'), days.map(d => cell(hb, d))); })))) : empty('No habits yet. Add one to start a monthly grid.'),
      h('p', { class: 'muted' }, 'Key: ✓ done, ◐ partly done, ✕ recorded as missed, · scheduled but nothing recorded, – not scheduled. Future days are blank and never count against you. Click a day to record it; for done / not done habits it cycles done, missed, cleared.'));
  }
  return { focus: renderFocus, habits: renderHabits };
}
