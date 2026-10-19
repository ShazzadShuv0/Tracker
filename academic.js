// Phase 3 screens: Tasks & Deadlines, My Routine, Academic Planner (milestones + courses).
import { localToISO, isoToLocal, deadlineState, sortTasks, findOverlaps } from './calculations.js';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CATS = { Class: '#1d4ed8', Study: '#0f766e', Revision: '#0f766e', Project: '#7c3aed', IELTS: '#be123c', Prayer: '#4d7c0f', Exercise: '#b45309', Travel: '#64748b', Meal: '#a16207', Personal: '#0369a1', Sleep: '#475569', Break: '#94a3b8' };
const TASK_CATS = ['Assignments', 'Quizzes', 'Examinations', 'Lab reports', 'FYDP', 'Course revision', 'IELTS', 'University applications', 'Personal', 'Other'];
const TEMPLATES = [['05:30', '06:30', 'Fajr prayer and exercise', 'Exercise'], ['06:30', '07:00', 'Shower and getting ready', 'Personal'], ['07:00', '08:00', 'University travel and personal time', 'Travel'],
  ['08:00', '09:20', 'Previous lecture revision', 'Revision'], ['15:30', '16:50', 'FYDP or project work', 'Project'], ['17:00', '18:00', 'Prayer, refreshment, personal time', 'Prayer'],
  ['18:00', '19:30', 'Course revision or assignments', 'Study'], ['19:30', '21:00', 'IELTS preparation', 'IELTS'], ['21:00', '21:30', 'Prayer, dinner, personal time', 'Meal'],
  ['21:30', '22:00', 'Revision or IELTS preparation', 'Study'], ['22:00', '05:30', 'Sleep', 'Sleep']];
const MILESTONES = ['Complete remaining coursework', 'Finish the FYDP', 'Complete the final semester', 'Prepare a professional CV', "Prepare master's applications", 'Meet English-language requirements', 'Submit university application documents'];

export function createAcademic({ h, toast, guard, DB, getSettings, setTick }) {
  const pairs = o => o.map(x => Array.isArray(x) ? x : [x, x]);
  const empty = t => h('div', { class: 'empty' }, t);
  const row = (main, meta, ...btns) => h('div', { class: 'card', style: 'display:flex;gap:.75rem;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:.5rem' },
    h('div', {}, main, meta ? h('div', { class: 'muted' }, meta) : ''), h('div', { class: 'row', style: 'margin:0' }, ...btns));
  const btn = (label, fn, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick: guard(fn) }, label);
  const confirmDel = (store, rec, what, rerender) => btn('Delete', async () => { if (confirm(`Delete ${what}? This cannot be undone.`)) { await DB.remove(store, rec.id); toast('Deleted'); await rerender(); } }, 'danger');

  // Generic add/edit dialog. onSave returns an error string, or nothing on success.
  function formDialog(title, fields, vals, onSave, rerender) {
    const dlg = h('dialog', { 'aria-label': title }), f = h('form', { class: 'f', novalidate: true }), ctl = {}, msg = h('div', { class: 'err', role: 'alert' });
    for (const [k, label, type, o = {}] of fields) {
      let c;
      if (type === 'select') c = h('select', {}, pairs(o.opts).map(([v, l]) => h('option', { value: v, selected: String(vals[k] ?? '') === String(v) }, l)));
      else if (type === 'textarea') c = h('textarea', { rows: 3 }, vals[k] ?? '');
      else if (type === 'days') { c = h('div', { class: 'row', style: 'margin:0' }, DAYS.map((d, i) => h('label', {}, h('span', {}, h('input', { type: 'checkbox', value: i, checked: (vals[k] || []).includes(i), style: 'width:auto;min-height:0' }), ' ' + d)))); f.append(h('fieldset', {}, h('legend', {}, label), c)); ctl[k] = [c, type]; continue; }
      else c = h('input', { type: type === 'datetime' ? 'datetime-local' : type, value: vals[k] ?? '', min: o.min });
      ctl[k] = [c, type]; f.append(h('label', {}, label, c));
    }
    f.append(msg, h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'), h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    f.addEventListener('submit', guard(async e => {
      e.preventDefault(); const v = {};
      for (const [k, [c, t]] of Object.entries(ctl)) v[k] = t === 'days' ? [...c.querySelectorAll('input:checked')].map(i => +i.value) : t === 'number' ? (c.value === '' ? null : Number(c.value)) : c.value.trim();
      const err = await onSave(v); if (err) { msg.textContent = err; return; }
      dlg.close(); toast('Saved'); await rerender();
    }));
    dlg.addEventListener('close', () => dlg.remove());
    dlg.append(h('h1', {}, title), f); document.body.append(dlg); dlg.showModal();
  }

  // ---------- Tasks ----------
  let tFilter = 'open', tSearch = '';
  async function renderTasks() {
    const S = getSettings(), tz = S.timezone, courses = await DB.all('courses'), tasks = await DB.all('tasks'), view = document.querySelector('#view');
    const cmap = Object.fromEntries(courses.map(c => [c.id, c]));
    const fields = [['title', 'Title', 'text'], ['courseId', 'Course', 'select', { opts: [['', 'None'], ...courses.map(c => [c.id, c.code])] }], ['category', 'Category', 'select', { opts: TASK_CATS }],
      ['deadline', `Deadline (${tz} time)`, 'datetime'], ['priority', 'Priority', 'select', { opts: ['Critical', 'High', 'Medium', 'Low'] }], ['status', 'Status', 'select', { opts: ['Not started', 'In progress', 'Completed', 'Cancelled'] }],
      ['estimateMin', 'Estimated effort (minutes)', 'number', { min: 0 }], ['description', 'Description', 'textarea']];
    const edit = t => formDialog(t ? 'Edit task' : 'Add task', fields,
      t ? { ...t, deadline: t.deadlineAt ? isoToLocal(t.deadlineAt, tz) : '', estimateMin: t.estimateSec ? t.estimateSec / 60 : '' } : { priority: 'Medium', status: 'Not started', category: 'Assignments' },
      async v => {
        if (!v.title) return 'Title is required.';
        if (v.estimateMin != null && v.estimateMin < 0) return 'Effort cannot be negative.';
        const done = v.status === 'Completed';
        await DB.put('tasks', { ...(t || {}), title: v.title, courseId: v.courseId, category: v.category, priority: v.priority, status: v.status, description: v.description,
          deadlineAt: v.deadline ? localToISO(v.deadline, tz) : null, estimateSec: v.estimateMin ? Math.round(v.estimateMin * 60) : 0,
          completedAt: done ? (t?.completedAt || new Date().toISOString()) : null });
      }, renderTasks);
    const f = h('select', { 'aria-label': 'Filter' }, [['open', 'Open'], ['overdue', 'Overdue'], ['done', 'Completed'], ['all', 'All']].map(([v, l]) => h('option', { value: v, selected: v === tFilter }, l)));
    f.addEventListener('change', () => { tFilter = f.value; renderTasks(); });
    const q = h('input', { type: 'search', placeholder: 'Search tasks', 'aria-label': 'Search tasks', value: tSearch });
    q.addEventListener('input', () => { tSearch = q.value; drawList(); });
    const list = h('div', {}); const live = [];
    const drawList = () => {
      const now = new Date(); live.length = 0;
      const rows = sortTasks(tasks, now).filter(t => { const k = deadlineState(t, now).kind;
        return (tFilter === 'all' || (tFilter === 'open' && k !== 'done' && k !== 'cancelled') || (tFilter === 'overdue' && k === 'overdue') || (tFilter === 'done' && k === 'done'))
          && (`${t.title} ${t.description || ''}`).toLowerCase().includes(tSearch.toLowerCase()); });
      list.replaceChildren(...(rows.length ? rows.map(t => {
        const c = cmap[t.courseId], cd = h('strong', {}); live.push([t, cd]);
        return row(h('span', {}, h('strong', {}, t.title), c ? h('span', { style: `margin-left:.5rem;color:${c.color}` }, c.code) : ''), '', 
          h('span', { class: 'muted' }, `${t.category} · ${t.priority} · `), cd,
          btn(t.status === 'Completed' ? 'Reopen' : 'Complete', async () => { const done = t.status !== 'Completed'; await DB.put('tasks', { ...t, status: done ? 'Completed' : 'In progress', completedAt: done ? new Date().toISOString() : null }); renderTasks(); }),
          btn('Edit', () => edit(t)), confirmDel('tasks', t, `"${t.title}"`, renderTasks));
      }) : [empty(tasks.length ? 'No tasks match this filter.' : 'No tasks yet. Add your first assignment, quiz or exam.')]));
      paint();
    };
    const paint = () => { const now = new Date(); live.forEach(([t, el]) => { const s = deadlineState(t, now); el.textContent = s.text; el.style.color = s.kind === 'overdue' ? 'var(--err)' : s.kind === 'soon' ? 'var(--warn)' : s.kind === 'done' ? 'var(--ok)' : ''; }); };
    view.replaceChildren(h('h1', {}, 'Tasks & Deadlines'), h('div', { class: 'row', style: 'margin:0 0 1rem' }, btn('Add task', () => edit(), 'primary'), f, q), list);
    drawList(); setTick(paint);
  }

  // ---------- Routine ----------
  async function renderRoutine() {
    const acts = await DB.all('routineActivities'), view = document.querySelector('#view');
    const fields = [['title', 'Activity', 'text'], ['category', 'Category', 'select', { opts: Object.keys(CATS) }], ['days', 'Days', 'days'], ['start', 'Start', 'time'], ['end', 'End (earlier than start means it runs past midnight)', 'time']];
    const edit = (a, dup) => formDialog(a ? (dup ? 'Duplicate activity' : 'Edit activity') : 'Add activity', fields, a ? { ...a, title: dup ? a.title + ' (copy)' : a.title } : { category: 'Study', days: [0, 1, 2, 3, 4], start: '18:00', end: '19:30' },
      async v => {
        if (!v.title) return 'Activity name is required.'; if (!v.days.length) return 'Choose at least one day.'; if (!v.start || !v.end) return 'Start and end times are required.';
        if (v.start === v.end) return 'Start and end cannot be the same.';
        const rec = { ...(dup ? { ...a, id: undefined, createdAt: undefined } : a || {}), title: v.title, category: v.category, days: v.days, start: v.start, end: v.end, color: CATS[v.category] };
        await DB.put('routineActivities', rec);
      }, renderRoutine);
    const ov = findOverlaps(acts);
    const body = [h('h1', {}, 'My Routine'), h('div', { class: 'row', style: 'margin:0 0 1rem' }, btn('Add activity', () => edit(), 'primary'),
      btn('Add suggested templates', async () => { if (!confirm('Add 11 editable suggestions on every day? You can edit or delete each one.')) return;
        await DB.putMany('routineActivities', TEMPLATES.map(([start, end, title, category]) => ({ title, category, start, end, days: [0, 1, 2, 3, 4, 5, 6], color: CATS[category], fromTemplate: true }))); renderRoutine(); }))];
    if (ov.length) body.push(h('div', { class: 'card', role: 'status', style: 'border-color:var(--warn);margin-bottom:1rem' }, h('h2', {}, `${ov.length} overlap warning${ov.length > 1 ? 's' : ''}`),
      ...ov.slice(0, 8).map(o => h('div', {}, `${DAYS[o.day]}: "${o.a.title}" overlaps "${o.b.title}"`))));
    if (!acts.length) body.push(empty('No routine yet. Add activities one by one, or load the suggested templates and edit them. Class times are never assumed.'));
    DAYS.forEach((d, i) => {
      const day = acts.filter(a => a.days.includes(i)).sort((a, b) => a.start.localeCompare(b.start)); if (!day.length) return;
      body.push(h('h2', { style: 'margin-top:1.25rem' }, d), ...day.map(a => row(h('span', {}, h('span', { 'aria-hidden': 'true', style: `display:inline-block;width:10px;height:10px;border-radius:50%;background:${a.color || CATS[a.category]};margin-right:.5rem` }), h('strong', {}, `${a.start}–${a.end}`), ' ' + a.title), `${a.category}${a.days.length < 7 ? ' · ' + a.days.map(x => DAYS[x]).join(', ') : ' · every day'}`,
        btn('Edit', () => edit(a)), btn('Duplicate', () => edit(a, true)), confirmDel('routineActivities', a, `"${a.title}" (all days)`, renderRoutine))));
    });
    view.replaceChildren(...body);
  }

  // ---------- Planner: milestones + courses ----------
  async function renderPlanner() {
    const ms = (await DB.all('milestones')).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')), courses = await DB.all('courses'), view = document.querySelector('#view');
    const done = ms.filter(m => m.done).length;
    const medit = m => formDialog(m ? 'Edit milestone' : 'Add milestone', [['title', 'Milestone', 'text'], ['dueDate', 'Target date (optional)', 'date']], m || {},
      async v => { if (!v.title) return 'Title is required.'; await DB.put('milestones', { ...(m || { done: false }), title: v.title, dueDate: v.dueDate || null }); }, renderPlanner);
    const cedit = c => formDialog(c ? 'Edit course' : 'Add course', [['code', 'Course code', 'text'], ['name', 'Name', 'text'], ['instructor', 'Instructor', 'text'], ['color', 'Color', 'color'], ['targetGrade', 'Target grade (optional)', 'text'], ['result', 'Result (optional, entered by you)', 'text']],
      c || { color: '#1d4ed8' }, async v => { if (!v.code) return 'Course code is required.'; await DB.put('courses', { ...(c || {}), ...v }); }, renderPlanner);
    view.replaceChildren(h('h1', {}, 'Academic Planner'),
      h('h2', {}, `Graduation milestones${ms.length ? ` (${done} of ${ms.length} done)` : ''}`),
      h('div', { class: 'row', style: 'margin:0 0 1rem' }, btn('Add milestone', () => medit(), 'primary'),
        btn('Add suggested milestones', async () => { await DB.putMany('milestones', MILESTONES.map(title => ({ title, done: false, dueDate: null }))); renderPlanner(); })),
      ...(ms.length ? ms.map(m => row(h('span', {}, m.done ? '✓ ' : '', h('strong', {}, m.title)), m.dueDate ? `Target ${m.dueDate}` : 'No target date',
        btn(m.done ? 'Mark not done' : 'Mark done', async () => { await DB.put('milestones', { ...m, done: !m.done }); renderPlanner(); }), btn('Edit', () => medit(m)), confirmDel('milestones', m, `"${m.title}"`, renderPlanner))) : [empty('No milestones yet.')]),
      h('h2', { style: 'margin-top:1.5rem' }, 'Courses'), h('div', { class: 'row', style: 'margin:0 0 1rem' }, btn('Add course', () => cedit(), 'primary')),
      ...(courses.length ? courses.map(c => row(h('span', {}, h('span', { 'aria-hidden': 'true', style: `display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.color};margin-right:.5rem` }), h('strong', {}, c.code), ' ' + (c.name || '')),
        [c.instructor, c.targetGrade && `Target: ${c.targetGrade}`, c.result && `Result: ${c.result}`].filter(Boolean).join(' · '), btn('Edit', () => cedit(c)), confirmDel('courses', c, c.code, renderPlanner))) : [empty('No courses yet.')]),
      h('p', { class: 'muted' }, 'Add quizzes, exams and assignment dates as tasks with the matching category. No GPA is calculated because no grading system is configured.'));
  }
  return { tasks: renderTasks, routine: renderRoutine, planner: renderPlanner, _ui: { formDialog, row, btn, confirmDel, empty } };
}
