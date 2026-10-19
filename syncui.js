// Cloud sync UI: a reusable sign-in form, a sign-in dialog (opened from the sidebar badge) and the Settings card.
export function authForm({ h, Sync, onDone }) {
  const msg = h('p', { class: 'err', role: 'alert' });
  const email = h('input', { type: 'email', autocomplete: 'email', 'aria-label': 'Email' }), pw = h('input', { type: 'password', autocomplete: 'current-password', minlength: 6, 'aria-label': 'Password' });
  const act = fn => async () => { msg.textContent = ''; try { await fn(email.value.trim(), pw.value); } catch (e) { msg.textContent = e.message || String(e); } };
  const el = h('div', {}, h('p', { class: 'muted' }, 'Sign in to keep your devices in sync automatically. Data goes only to your own Supabase project.'),
    h('label', {}, 'Email', email), h('label', {}, 'Password (at least 6 characters)', pw), msg,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: act(async (e, p) => { await Sync.signIn(e, p); onDone(); Sync.syncNow(); }) }, 'Sign in'),
      h('button', { class: 'btn', type: 'button', onclick: act(async (e, p) => { const r = await Sync.signUp(e, p); if (r.needsConfirm) msg.textContent = 'Account created. Check your email to confirm it, then press Sign in.'; else { onDone(); Sync.syncNow(); } }) }, 'Create account')));
  return { el, email };
}
export function signInDialog({ h, Sync }) {
  const dlg = h('dialog', { 'aria-label': 'Sign in to cloud sync' }), f = authForm({ h, Sync, onDone: () => dlg.close() });
  dlg.append(h('h1', {}, 'Cloud sync'), f.el, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal(); f.email.focus();
}
export function syncCard({ h, toast, guard, Sync }) {
  const body = h('div', {}), line = h('p', { class: 'muted', role: 'status' });
  const card = h('div', { id: 'cloud-sync', class: 'card', style: 'margin-bottom:1rem;max-width:640px' }, h('h2', {}, 'Cloud sync'), body);
  const btn = (t, fn, c = '') => h('button', { class: `btn ${c}`, type: 'button', onclick: guard(fn) }, t);
  let wasIn = !!Sync.user();
  function render() {
    line.textContent = Sync.describe(Sync.getStatus());
    if (!Sync.enabled) return body.replaceChildren(h('p', { class: 'muted' }, 'Cloud sync is off. Add your Supabase URL and anon key to config.js to turn it on (see SYNC_SETUP.md). Until then, use the manual backup below.'));
    const u = Sync.user();
    if (u) return body.replaceChildren(h('p', {}, `Signed in as ${u.email}. Changes sync automatically between your devices.`), line,
      h('div', { class: 'row' }, btn('Sync now', async () => { await Sync.syncNow(); toast('Sync finished'); }, 'primary'),
        btn('Sign out', async () => { await Sync.signOut(); render(); toast('Signed out. Data on this device is kept.'); })));
    body.replaceChildren(authForm({ h, Sync, onDone: () => { wasIn = true; render(); } }).el);
  }
  const unsub = Sync.subscribe(s => { if (!card.isConnected) return unsub(); line.textContent = Sync.describe(s); const now = !!Sync.user(); if (now !== wasIn) { wasIn = now; render(); } });
  render();
  return card;
}
