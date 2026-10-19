// Phase 5: Reports & Analytics. Every number comes from stored records via calculations.js.
import { zoned, rangeFor, dailyRows, habitRange, taskStats, studyByCourse, routineReport, addDays, weekdayOf, dateRange, isDateStr, WEEKDAY_INDEX } from './calculations.js';
import { drawChart, destroyCharts } from './charts.js';
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], KINDS = [['today', 'Today'], ['7d', 'Last 7 days'], ['week', 'Current week'], ['30d', 'Last 30 days'], ['month', 'Current month'], ['custom', 'Custom range']];
const hrs = sec => `${(sec / 3600).toFixed(1)} h`, sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);

export function createReports({ h, toast, guard, DB, getSettings, ui }) {
  const { btn, empty } = ui; let kind = '7d', custom = { from: '', to: '' };
  async function renderReports() {
    destroyCharts(); const S = getSettings(), tz = S.timezone, z = zoned(new Date(), tz), today = z.date, nowMin = z.h * 60 + z.min, root = document.querySelector('#view');
    const [sessions, dists, habits, hlogs, tasks, acts, rlogs, courses, reviews] = await Promise.all(['focusSessions', 'distractionLogs', 'habits', 'habitLogs', 'tasks', 'routineActivities', 'routineLogs', 'courses', 'weeklyReviews'].map(s => DB.all(s)));
    const dates = rangeFor(kind, today, custom), inR = r => dates.includes(r.date), sS = sessions.filter(inR), dD = dists.filter(inR);
    const kindSel = h('select', { 'aria-label': 'Date range' }, KINDS.map(([v, l]) => h('option', { value: v, selected: v === kind }, l))); kindSel.addEventListener('change', () => { kind = kindSel.value; renderReports(); });
    const di = k => { const i = h('input', { type: 'date', value: custom[k], 'aria-label': k === 'from' ? 'From date' : 'To date' }); i.addEventListener('change', () => { custom[k] = i.value; renderReports(); }); return i; };
    const sec = (title, ...kids) => h('section', { class: 'card', style: 'margin-bottom:1rem' }, h('h2', {}, title), ...kids);
    const box = () => h('div', {}), p = t => h('p', {}, t), cname = id => courses.find(c => c.id === id)?.code || 'No course';
    const out = [h('h1', {}, 'Reports & Analytics'), h('div', { class: 'row noprint', style: 'margin:0 0 1rem;align-items:center' }, kindSel, ...(kind === 'custom' ? [di('from'), di('to')] : []), btn('Print or save as PDF', () => window.print()))];
    if (!dates.length) { out.push(empty(kind === 'custom' ? 'Choose a valid From and To date (From must not be after To).' : 'No dates in range.')); return root.replaceChildren(...out); }
    const daily = dailyRows(dates, sessions, dists), lab = dates.map(d => d.slice(5)), noData = !sS.length && !dD.length;
    out.push(p(`${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days, ${tz}). Study and distraction figures are manual or timer records. A gap or "no record" means nothing was logged, which is not the same as zero.`));

    const b1 = box(), b2 = box(), b3 = box(), b5 = box();
    out.push(sec('Study vs distraction', noData ? empty('No study or distraction records in this range.') : b1));
    out.push(sec('Social media', noData ? empty('Nothing recorded.') : b2, p(`Dashed line: your daily distraction limit (${S.dailyDistractionMin ?? 0} min). Use Settings to change it.`)));
    // habits
    const hr = habitRange(dates, habits, hlogs, today), tot = hr.per.reduce((a, x) => ({ s: a.s + x.scheduled, c: a.c + x.completed }), { s: 0, c: 0 });
    out.push(sec('Habits', hr.per.length ? b3 : empty('No active habits.'), ...hr.per.map(x => p(`${x.habit.name}: ${x.scheduled ? `${x.completed} of ${x.scheduled} scheduled days done (${x.pct}%)${x.nodata ? `, ${x.nodata} with no record` : ''}` : 'no scheduled days in range'}`))));
    // academic
    const ts = taskStats(tasks, sessions, dates, tz), bc = studyByCourse(sessions, dates);
    out.push(sec('Academic', p(`Tasks completed: ${ts.completed} (${ts.onTime} before their deadline). Overdue now: ${ts.overdue}. Upcoming: ${ts.upcoming}.`),
      p(ts.rate == null ? 'No deadlines fell in this range, so there is no completion rate.' : `Due in range: ${ts.dueInRange}, completed: ${ts.dueCompleted} (${ts.rate}%).`),
      p(ts.compare.length ? 'Estimate vs actual: ' + ts.compare.map(c => `${c.title} ${Math.round(c.est / 60)}m est, ${Math.round(c.act / 60)}m actual`).join('; ') : 'Estimate vs actual: no completed tasks with both an estimate and linked focus time.'),
      p(Object.keys(bc).length ? 'Study by course: ' + Object.entries(bc).map(([id, s]) => `${cname(id)} ${hrs(s)}`).join(', ') : 'Study by course: no focus sessions in range.')));
    // routine
    const rr = routineReport(acts, rlogs, dates, today, nowMin), anyR = rr.byWeekday.some(x => x.elig);
    out.push(sec('Routine', anyR ? b5 : empty('No finished scheduled activities in this range.'), p(`Completed ${rr.counts.completed}, skipped ${rr.counts.skipped}, cancelled ${rr.counts.cancelled}, not logged ${rr.counts.unlogged}. Not-logged activities count as not done.`),
      p(rr.missed.length ? 'Most often not completed: ' + rr.missed.map(([t, n]) => `${t} (${n}x)`).join(', ') : 'No missed blocks.')));
    // summary
    const fSec = daily.reduce((s, r) => s + (r.focusMin || 0) * 60, 0), dSec = daily.reduce((s, r) => s + (r.distMin || 0) * 60, 0), best = daily.filter(r => r.focusMin != null).sort((a, b) => b.focusMin - a.focusMin)[0];
    const worst = [...hr.per].filter(x => x.scheduled).sort((a, b) => (b.scheduled - b.completed) - (a.scheduled - a.completed))[0], tgt = S.weeklyStudyMin;
    const adAll = rr.byWeekday.reduce((a, x) => ({ d: a.d + x.done, e: a.e + x.elig }), { d: 0, e: 0 });
    out.push(sec('Summary for this range', p(`Focused study ${hrs(fSec)}, distraction ${hrs(dSec)}. Tasks completed ${ts.completed}, overdue ${ts.overdue}.`),
      p(`Habit completion: ${tot.s ? Math.round(tot.c / tot.s * 100) + '%' : 'no scheduled days'}. Routine adherence: ${adAll.e ? Math.round(adAll.d / adAll.e * 100) + '%' : 'no data'}.`),
      p(`Strongest study day: ${best ? `${best.date} (${Math.round(best.focusMin)} min)` : 'no sessions'}. Habit most often not completed: ${worst && worst.scheduled > worst.completed ? worst.habit.name : 'none'}.`),
      ...(kind === 'week' && tgt ? [p(`Weekly study target: ${hrs(fSec)} of ${(tgt / 60).toFixed(1)} h (${Math.round(fSec / (tgt * 60) * 100)}%).`)] : [])));
    // monthly comparison
    const m0 = today.slice(0, 8) + '01', pm = addDays(m0, -1), pm0 = pm.slice(0, 8) + '01', cur = dailyRows(dateRange(m0, today), sessions, dists), prev = dailyRows(dateRange(pm0, pm), sessions, dists);
    const mt = r => ({ f: r.reduce((s, x) => s + (x.focusMin || 0), 0), d: r.reduce((s, x) => s + (x.distMin || 0), 0), n: r.filter(x => x.focusMin != null || x.distMin != null).length });
    const a = mt(cur), b = mt(prev), dim = dateRange(m0, today).length;
    out.push(sec('This month vs last month', p(`This month: ${(a.f / 60).toFixed(1)} h focused (${Math.round(a.f / dim)} min per day on average), ${(a.d / 60).toFixed(1)} h distraction.`),
      p(b.n ? `Last month: ${(b.f / 60).toFixed(1)} h focused, ${(b.d / 60).toFixed(1)} h distraction (${b.n} days with records).` : 'Last month: not enough data to compare.')));
    // weekly review
    const wk = addDays(today, -weekdayOf(today)), rid = `week:${wk}`, rv = reviews.find(x => x.id === rid) || {}, ta = {};
    const f = h('form', { class: 'f noprint' }, ...[['reflection', 'Reflection'], ['achievements', 'Achievements'], ['obstacles', 'Obstacles'], ['priorities', 'Priorities for next week']].map(([k, l]) => h('label', {}, l, ta[k] = h('textarea', { rows: 2 }, rv[k] || ''))), h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save review')));
    f.addEventListener('submit', guard(async e => { e.preventDefault(); await DB.put('weeklyReviews', { ...rv, id: rid, weekStart: wk, ...Object.fromEntries(Object.entries(ta).map(([k, v]) => [k, v.value.trim()])) }); toast('Review saved'); }));
    out.push(sec(`Weekly review (week of ${wk})`, f));
    root.replaceChildren(...out);

    const rowsD = daily.map(r => [r.date, r.focusMin, r.distMin]);
    if (!noData) {
      await drawChart(b1, { title: 'Daily focused study and recorded distraction in minutes', type: 'line', labels: lab, yTitle: 'Minutes', datasets: [{ label: 'Focused study', data: daily.map(r => r.focusMin), color: '#1d4ed8' }, { label: 'Recorded distraction', data: daily.map(r => r.distMin), color: '#b45309' }], head: ['Date', 'Focused min', 'Distraction min'], rows: rowsD });
      await drawChart(b2, { title: 'Daily social media minutes against limit', type: 'bar', labels: lab, yTitle: 'Minutes', datasets: [{ label: 'Social media', data: daily.map(r => r.socialMin), color: '#be123c' }, ...(S.dailyDistractionMin != null ? [{ label: 'Daily limit', data: dates.map(() => S.dailyDistractionMin), color: '#64748b', dashed: true, type: 'line' }] : [])], head: ['Date', 'Social media min'], rows: daily.map(r => [r.date, r.socialMin]) });
    }
    if (hr.per.length) await drawChart(b3, { title: 'Habits completed and scheduled per day', type: 'bar', labels: lab, yTitle: 'Habits', datasets: [{ label: 'Completed', data: hr.daily.map(r => r.completed), color: '#157347' }, { label: 'Scheduled', data: hr.daily.map(r => r.scheduled), color: '#94a3b8' }], head: ['Date', 'Completed', 'Scheduled'], rows: hr.daily.map(r => [r.date, r.completed, r.scheduled]) });
    if (anyR) await drawChart(b5, { title: 'Routine adherence by weekday, percent', type: 'bar', labels: WD, yTitle: '% of planned minutes done', datasets: [{ label: 'Adherence', data: rr.byWeekday.map(x => x.pct), color: '#0f766e' }], head: ['Weekday', 'Adherence %'], rows: rr.byWeekday.map((x, i) => [WD[i], x.pct]) });
  }
  return { reports: renderReports };
}
