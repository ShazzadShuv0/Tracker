import * as DB from './db.js';
import { zoned, greeting, graduationCountdown, isDateStr, currentAndNext, sortTasks, deadlineState, sumByDay, habitStatus, routineAdherence, WEEKDAY_INDEX } from './calculations.js';
import { createAcademic } from './academic.js';
import { createTracking } from './tracking.js';
import { createReports } from './reports.js';
import { backupCard } from './portability.js';
import * as Sync from './sync.js';
import { syncCard, signInDialog } from './syncui.js';

const $ = s => document.querySelector(s);
const view = $('#view');
let settings = null, timer = null, A = null, T = null, R = null;

const SECTIONS = [['dashboard', 'Dashboard'], ['routine', 'My Routine'], ['tasks', 'Tasks & Deadlines'], ['focus', 'Focus Tracker'],
  ['habits', 'Habits'], ['reports', 'Reports & Analytics'], ['planner', 'Academic Planner'], ['settings', 'Settings']];
const PHASE = { routine: 3, tasks: 3, planner: 3, focus: 4, habits: 4, reports: 5 };

// Safe DOM builder: text always goes through textContent, never innerHTML.
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(c => e.append(c instanceof Node ? c : document.createTextNode(c ?? '')));
  return e;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2600); }
function fail(e) { console.error(e); const b = $('#banner'); b.hidden = false; b.textContent = `Your data was not saved: ${e.message || e}`; }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { fail(e); } };

function applyTheme(t) {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('lifeos.theme', t); } catch {}
}

// ---------- Profile form (shared by onboarding and Settings) ----------
const FIELDS = [
  ['Profile', [['name', 'Display name', 'text', { req: 1 }], ['university', 'University', 'text'], ['program', 'Degree program', 'text']]],
  ['Graduation', [['gradDate', 'Target graduation date', 'date', { req: 1, hint: 'May 2027 is your goal. Choose the exact day yourself; this is a personal target, not an official date.' }],
    ['timezone', 'Timezone', 'text', { req: 1, hint: 'IANA name, e.g. Asia/Dhaka' }]]],
  ['Targets', [['dailyStudyMin', 'Daily study target (minutes)', 'number', { min: 0 }], ['weeklyStudyMin', 'Weekly study target (minutes)', 'number', { min: 0 }],
    ['dailyDistractionMin', 'Daily distraction limit (minutes)', 'number', { min: 0, hint: '0 is allowed.' }], ['ielts', 'IELTS target band', 'number', { min: 0, max: 9, step: 0.5 }]]],
  ['Sleep and theme', [['bedtime', 'Bedtime', 'time'], ['wake', 'Wake time', 'time']]],
];
const DEFAULTS = { name: '', university: 'BRAC University', program: 'BSc in Electrical and Electronic Engineering', gradDate: '', timezone: 'Asia/Dhaka',
  dailyStudyMin: 240, weeklyStudyMin: 1680, dailyDistractionMin: 60, ielts: 7, bedtime: '22:00', wake: '05:30', theme: 'light' };
const validTZ = z => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };

function profileForm(vals, { submitLabel, withCourses, onSubmit, extra }) {
  const f = h('form', { class: 'f', novalidate: true });
  const inputs = {};
  for (const [legend, fields] of FIELDS) {
    const fs = h('fieldset', {}, h('legend', {}, legend));
    for (const [k, label, type, o = {}] of fields) {
      const i = h('input', { id: `f-${k}`, name: k, type, value: vals[k] ?? '', min: o.min, max: o.max, step: o.step, required: !!o.req, 'aria-describedby': `e-${k}` });
      inputs[k] = i; fs.append(h('label', {}, label, o.hint ? h('small', {}, o.hint) : '', i, h('span', { class: 'err', id: `e-${k}` })));
    }
    if (legend === 'Sleep and theme') {
      const sel = h('select', { id: 'f-theme', name: 'theme' }, ['light', 'dark', 'system'].map(v => h('option', { value: v, selected: vals.theme === v }, v[0].toUpperCase() + v.slice(1))));
      inputs.theme = sel; fs.append(h('label', {}, 'Theme', sel));
    }
    f.append(fs);
  }
  let ta;
  if (withCourses) {
    ta = h('textarea', { id: 'f-courses', rows: 6 }, 'EEE415 | \nEEE421 | \nEEE403 | \nCST314 | \nEEE421L | Lab\nFYDP | Final year design project\nIELTS | Preparation');
    f.append(h('fieldset', {}, h('legend', {}, 'Courses'), h('label', {}, 'One per line: CODE | optional name', h('small', {}, 'No class days or times are assumed. You will enter those in the routine.'), ta)));
  }
  if (extra) f.append(extra);
  f.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, submitLabel)));
  f.addEventListener('submit', guard(async ev => {
    ev.preventDefault(); let ok = true;
    const v = {};
    for (const [k, i] of Object.entries(inputs)) {
      const err = f.querySelector(`#e-${k}`); let m = '';
      v[k] = i.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value.trim();
      if (i.required && !v[k]) m = 'This field is required.';
      else if (k === 'gradDate' && !isDateStr(v[k])) m = 'Enter a valid date.';
      else if (k === 'timezone' && !validTZ(v[k])) m = 'Unknown timezone. Try Asia/Dhaka.';
      else if (i.type === 'number' && v[k] != null && (v[k] < (i.min || 0) || (i.max && v[k] > +i.max))) m = 'Value is out of range.';
      if (err) err.textContent = m; if (i.setAttribute) i.setAttribute('aria-invalid', !!m); if (m) ok = false;
    }
    if (!ok) { f.querySelector('[aria-invalid=true]')?.focus(); return; }
    await onSubmit(v, ta?.value);
  }));
  return f;
}

// ---------- Onboarding ----------
function showOnboarding() {
  const dlg = $('#onboard');
  dlg.addEventListener('cancel', e => e.preventDefault()); // setup is required once
  const sample = h('input', { type: 'checkbox', id: 'f-sample' });
  const extra = h('fieldset', {}, h('legend', {}, 'Starting data'),
    h('label', {}, h('span', {}, sample, ' Load labeled sample data'), h('small', {}, 'Optional. Sample items are marked [Sample] and can be removed in Settings. Leave unchecked for a clean start.')));
  const restore = !Sync.enabled ? '' : (() => {
    const em = h('input', { type: 'email', autocomplete: 'email', 'aria-label': 'Email' }), pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password' }), msg = h('p', { class: 'err', role: 'alert' });
    return h('fieldset', {}, h('legend', {}, 'Already use LifeOS on another device?'), h('label', {}, 'Email', em), h('label', {}, 'Password', pw), msg,
      h('button', { class: 'btn', type: 'button', onclick: guard(async () => { msg.textContent = '';
        try { await Sync.signIn(em.value.trim(), pw.value); await Sync.syncNow(); } catch (e) { msg.textContent = e.message || String(e); return; }
        settings = await DB.getSettings();
        if (settings?.onboarded) { try { localStorage.setItem('lifeos.onboarded', '1'); } catch {} dlg.close(); await boot(); }
        else msg.textContent = 'Signed in, but no cloud data was found. Finish the setup below instead.'; }) }, 'Sign in and restore'));
  })();
  dlg.replaceChildren(h('h1', { id: 'onboardTitle' }, 'Set up LifeOS'), restore, h('p', { class: 'muted' }, 'Everything stays in this browser. You can change any of this later in Settings.'),
    profileForm(DEFAULTS, { submitLabel: 'Finish setup', withCourses: true, extra, onSubmit: async (v, courseText) => {
      await DB.saveSettings({ ...v, onboarded: true });
      const lines = courseText.split('\n').map(l => l.split('|').map(x => x.trim())).filter(l => l[0]);
      await DB.putMany('courses', lines.map((l, i) => ({ code: l[0], name: l[1] || '', color: DB.colorFor(i), instructor: '', targetGrade: '', result: '' })));
      if (sample.checked) await DB.addSample();
      try { localStorage.setItem('lifeos.onboarded', '1'); } catch {}
      dlg.close(); await boot();
    } }));
  dlg.showModal();
}

// ---------- Screens ----------
function renderDashboard() {
  const tz = settings.timezone;
  view.replaceChildren(
    h('section', { class: 'hero' }, h('h1', { id: 'greet' }), h('div', { class: 'muted clock', id: 'now' })),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('h2', {}, 'Graduation'), h('div', { class: 'big', id: 'gradDays' }), h('div', { class: 'muted', id: 'gradSub' })),
      h('div', { class: 'card' }, h('h2', {}, 'What is on now'), h('div', { id: 'curAct' }), h('div', { class: 'row', id: 'actBtns' })),
      h('div', { class: 'card' }, h('h2', {}, 'Today'), h('div', { id: 'stats' })),
      h('div', { class: 'card' }, h('h2', {}, 'Priorities'), h('div', { id: 'prio' }))));
  let acts = [], curId = null, n = 0;
  const mk = st => h('button', { class: 'btn', type: 'button', onclick: guard(async () => { if (!curId) return toast('No activity is running now'); const d = zoned(new Date(), tz).date;
    await DB.put('routineLogs', { id: `${curId}:${d}`, activityId: curId, date: d, status: st }); toast(st === 'completed' ? 'Marked complete' : 'Marked skipped'); stats(); }) }, st === 'completed' ? 'Mark complete' : 'Mark skipped');
  $('#actBtns').append(mk('completed'), mk('skipped'));
  async function stats() {
    acts = await DB.all('routineActivities'); const z = zoned(new Date(), tz), d = z.date;
    const [fs, ds, hb, hl, rl] = await Promise.all([DB.all('focusSessions'), DB.all('distractionLogs'), DB.all('habits'), DB.all('habitLogs'), DB.all('routineLogs')]);
    const f = (sumByDay(fs, 'focusedSec')[d] || 0) / 60, x = (sumByDay(ds, 'durationSec')[d] || 0) / 60;
    const hv = {}; hl.filter(l => l.date === d).forEach(l => { hv[l.habitId] = l.value; });
    const sts = hb.filter(q => !q.archived).map(q => habitStatus(q, hv[q.id], d, d)).filter(q => q !== 'unscheduled' && q !== 'future');
    const st = {}; rl.filter(l => l.date === d).forEach(l => { st[l.activityId] = l.status; });
    const ad = routineAdherence(acts, st, WEEKDAY_INDEX[z.weekday], z.h * 60 + z.min);
    const now = new Date(), open = sortTasks(await DB.all('tasks'), now).filter(t => !['done', 'cancelled'].includes(deadlineState(t, now).kind)).slice(0, 5);
    $('#prio').replaceChildren(...(open.length ? open.map(t => { const d = deadlineState(t, now); return h('div', { style: d.kind === 'overdue' ? 'color:var(--err)' : d.kind === 'soon' ? 'color:var(--warn)' : '' }, `${t.title}: ${d.text}`); }) : [h('div', { class: 'muted' }, 'No open tasks. Add one in Tasks & Deadlines.')]));
    $('#stats').replaceChildren(...[`Focused study: ${Math.round(f)} of ${settings.dailyStudyMin ?? 0} min (${Math.max(0, (settings.dailyStudyMin ?? 0) - Math.round(f))} left)`,
      `Distraction (manually recorded): ${Math.round(x)} of ${settings.dailyDistractionMin ?? 0} min limit`,
      sts.length ? `Habits: ${sts.filter(q => q === 'completed').length} of ${sts.length} done` : 'Habits: none scheduled today',
      ad.pct == null ? 'Routine adherence: no finished activities yet' : `Routine adherence: ${ad.pct}% of ${ad.eligibleMin} planned min`].map(t => h('div', {}, t)));
  }
  stats();
  const tick = () => {
    const z = zoned(new Date(), tz);
    $('#greet').textContent = `${greeting(z.h)}, ${settings.name}`;
    $('#now').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'medium' }).format(new Date());
    if (++n % 30 === 0) stats();
    const cn = currentAndNext(acts, new Date(), tz), ca = $('#curAct'); curId = cn.current?.act.id || null;
    ca.textContent = !acts.length ? 'No routine yet. Add activities in My Routine.' : cn.current
      ? `${cn.current.act.title} (${cn.current.act.start}–${cn.current.act.end}). ${cn.remainingMin} min left, ${cn.progressPct}% through.` + (cn.next ? ` Next: ${cn.next.act.title} at ${cn.next.act.start}.` : '')
      : 'Nothing scheduled right now.' + (cn.next ? ` Next: ${cn.next.act.title} at ${cn.next.act.start}.` : '');
    const g = graduationCountdown(settings.gradDate, new Date(), tz);
    $('#gradDays').textContent = g.passed ? 'Target date passed' : `${g.days} days`;
    $('#gradSub').textContent = g.passed ? `Target was ${settings.gradDate}. Update it in Settings.` : `${g.months} months, ${g.remDays} days until ${settings.gradDate}`;
  };
  tick(); timer = setInterval(tick, 1000); // repaint only; values come from the real clock
}
function renderSettings() {
  const sampleBtn = h('button', { class: 'btn', onclick: guard(async () => { await DB.addSample(); toast('Sample data loaded'); }) }, 'Load sample data');
  const rmBtn = h('button', { class: 'btn', onclick: guard(async () => { if (confirm('Remove all [Sample] records? Your own records stay.')) { await DB.removeSample(); toast('Sample data removed'); } }) }, 'Remove sample data');
  const wipe = h('button', { class: 'btn danger', onclick: guard(async () => {
    if (!confirm('Delete ALL LifeOS data on this device? Your cloud copy (if any) is kept and this device is signed out. Export a backup first.')) return;
    if (prompt('Type DELETE to confirm') !== 'DELETE') return;
    await Sync.signOut(); // keeps the cloud copy; this only wipes THIS device and signs it out so it cannot re-download
    await DB.clearAll(); localStorage.removeItem('lifeos.onboarded'); location.hash = ''; location.reload(); }) }, 'Delete all local data');
  view.replaceChildren(h('h1', {}, 'Settings'),
    syncCard({ h, toast, guard, Sync }),
    profileForm(settings, { submitLabel: 'Save settings', onSubmit: async v => { settings = await DB.saveSettings({ ...settings, ...v }); applyTheme(settings.theme); toast('Settings saved'); } }),
    h('div', { class: 'card', style: 'margin-top:1.5rem;max-width:640px' }, h('h2', {}, 'Sample data'), h('div', { class: 'row' }, sampleBtn, rmBtn)),
    backupCard({ h, toast, guard, DB }),
    h('div', { class: 'card', style: 'margin-top:1rem;max-width:640px' }, h('h2', {}, 'Danger zone'), wipe));
}
function renderPlaceholder(id, title) {
  view.replaceChildren(h('h1', {}, title), h('div', { class: 'empty' }, `This section is built in Phase ${PHASE[id]}.`));
}

// ---------- Routing (hash-based: works on GitHub Pages with no rewrite rules) ----------
function route() {
  clearInterval(timer);
  const id = (location.hash.replace('#/', '') || 'dashboard');
  const sec = SECTIONS.find(s => s[0] === id) || SECTIONS[0];
  document.title = `${sec[1]} · LifeOS`;
  document.querySelectorAll('#navList a').forEach(a => a.dataset.id === sec[0] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  if (sec[0] === 'dashboard') renderDashboard(); else if (sec[0] === 'settings') renderSettings(); else if (A[sec[0]] || T[sec[0]] || R[sec[0]]) guard(A[sec[0]] || T[sec[0]] || R[sec[0]])(); else renderPlaceholder(...sec);
  view.focus({ preventScroll: true });
}
async function boot() {
  settings = await DB.getSettings();
  if (!settings?.onboarded) return showOnboarding();
  applyTheme(settings.theme);
  A = createAcademic({ h, toast, guard, DB, getSettings: () => settings, setTick: fn => { clearInterval(timer); timer = setInterval(fn, 1000); } });
  T = createTracking({ h, toast, guard, DB, getSettings: () => settings, setTick: fn => { clearInterval(timer); timer = setInterval(fn, 1000); }, ui: A._ui });
  R = createReports({ h, toast, guard, DB, getSettings: () => settings, ui: A._ui });
  $('#navList').replaceChildren(...SECTIONS.map(([id, label]) => h('li', {}, h('a', { href: `#/${id}`, 'data-id': id }, label))));
  route();
}
window.addEventListener('hashchange', () => settings && route());
// Called when a cloud pull changed local data. Never re-render while the person is typing or a dialog is open.
async function onRemoteChange() {
  const was = settings; settings = await DB.getSettings();
  if (!was?.onboarded) { if (settings?.onboarded) { $('#onboard').open && $('#onboard').close(); await boot(); } return; }
  if (!settings) return; applyTheme(settings.theme);
  const busy = document.querySelector('dialog[open]') || view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (!busy && A) route();
}
(async () => {
  try { applyTheme(localStorage.getItem('lifeos.theme') || 'light'); } catch {}
  try { await DB.openDB(); await boot(); } catch (e) { fail(e); }
  const badge = $('#syncStatus'), paint = s => { badge.textContent = Sync.badge(s); badge.hidden = !badge.textContent; };
  badge.addEventListener('click', () => { if (Sync.user()) location.hash = '#/settings'; else signInDialog({ h, Sync }); });
  Sync.subscribe(paint); paint(Sync.getStatus());
  Sync.init({ onRemote: () => onRemoteChange().catch(fail) });
})();

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Offline mode unavailable:', e.message)));
