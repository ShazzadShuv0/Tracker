// Settings card: JSON export/import (manual sync between devices) and CSV exports.
import { buildBackup, validateBackup, planImport, resolvePlan, toCSV, CSV_SETS } from './backup.js';
export function backupCard({ h, toast, guard, DB }) {
  const area = h('div', {}), dl = (name, text, type) => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const day = () => new Date().toISOString().slice(0, 10), btn = (t, fn, c = '') => h('button', { class: `btn ${c}`, type: 'button', onclick: guard(fn) }, t);
  const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Choose backup file' });
  file.addEventListener('change', guard(async () => {
    const f = file.files[0]; if (!f) return; area.replaceChildren(); let b;
    try { b = JSON.parse(await f.text()); } catch { return area.replaceChildren(h('p', { class: 'err', role: 'alert' }, 'This file is not valid JSON. Nothing was changed.')); }
    const errs = validateBackup(b); if (errs.length) return area.replaceChildren(h('p', { class: 'err', role: 'alert' }, 'Import blocked. Nothing was changed.'), h('ul', {}, errs.slice(0, 10).map(e => h('li', {}, e))));
    const cur = await DB.exportAll(), plan = planImport(b, cur), sel = h('select', { 'aria-label': 'Conflict handling' }, [['mine', 'Keep my version'], ['theirs', 'Use the imported version'], ['newer', 'Whichever was edited last']].map(([v, l]) => h('option', { value: v }, l)));
    area.replaceChildren(h('h3', {}, 'Import preview'), h('p', {}, `Backup from ${b.exportedAt || 'unknown time'}, app version ${b.appVersion || '?'}, schema ${b.schemaVersion}.`),
      h('p', {}, Object.entries(b.stores).map(([k, v]) => `${k}: ${v.length}`).join(' · ')),
      h('p', {}, `${plan.adds.length} new records will be added, ${plan.skipped} identical skipped, ${plan.blocked} blocked because you deleted them later, ${plan.deletes.length} removed to match deletions, ${plan.conflicts.length} conflicts.`),
      ...(plan.conflicts.length ? [h('p', {}, 'Conflicts (same record, different content):'), h('ul', {}, plan.conflicts.slice(0, 8).map(c => h('li', {}, `${c.store}: ${c.theirs.title || c.theirs.name || c.theirs.code || c.id}`))), h('label', {}, 'For conflicts', sel)] : []),
      h('p', { class: 'muted' }, 'Nothing is written until you confirm. The import is all-or-nothing.'),
      h('div', { class: 'row' }, btn('Confirm import', async () => { const fresh = planImport(b, await DB.exportAll()), r = resolvePlan(fresh, sel.value);
        await DB.applyOps(r.puts, r.dels); area.replaceChildren(h('p', {}, `Imported ${r.puts.length} records. Open any page to see them.`)); file.value = ''; toast('Import complete'); }, 'primary'),
        btn('Cancel', async () => { area.replaceChildren(); file.value = ''; })));
  }));
  return h('div', { class: 'card', style: 'margin-top:1rem;max-width:640px' }, h('h2', {}, 'Backup and device sync'),
    h('p', { class: 'muted' }, 'Manual backup works with or without cloud sync. Export a backup before big changes: browser storage is not encrypted and is not a backup. Importing a backup also uploads the imported records when cloud sync is on.'),
    h('div', { class: 'row' }, btn('Export Backup', async () => { dl(`lifeos-backup-${day()}.json`, JSON.stringify(buildBackup(await DB.exportAll()), null, 2), 'application/json'); toast('Backup downloaded'); }, 'primary')),
    h('label', {}, 'Import Backup', file), area, h('h3', {}, 'CSV exports'),
    h('div', { class: 'row' }, ...Object.entries(CSV_SETS).map(([s, cols]) => btn(`${s}.csv`, async () => { dl(`lifeos-${s}-${day()}.csv`, toCSV(await DB.all(s), cols), 'text/csv'); }))));
}
