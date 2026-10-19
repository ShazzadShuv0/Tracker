// Supabase auto-sync. IndexedDB stays the source of truth and the app works fully offline; this module mirrors it to the cloud.
// Triggers: app start, every local change (2 s debounce), back online, tab visible again, every 60 s, and instant Realtime pushes from other devices.
import * as DB from './db.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { SYNC_STORES, planPull, planPush, isoOf } from './syncmerge.js';
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const PAGE = 1000, CHUNK = 200;
export const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null, session = null, current = null, again = false, debounce = null, channel = null, channelUid = null, forceFull = false, wired = false, onRemote = () => {};
let status = { state: enabled ? 'signedout' : 'off', msg: '' };
const subs = new Set();
const setStatus = (state, msg = '') => { status = { state, msg, at: new Date() }; subs.forEach(f => f(status)); };
export const getStatus = () => status;
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const user = () => session?.user || null;
export const badge = s => ({ off: '', signedout: 'Sign in to sync', syncing: 'Syncing…', ok: 'Synced', offline: 'Offline', error: 'Sync error' })[s.state] || '';
export const describe = s => ({ off: 'Cloud sync is not configured.', signedout: 'Not signed in.', syncing: 'Syncing…',
  ok: `Up to date. Last sync ${s.at?.toLocaleTimeString?.() || ''}.`, offline: 'Offline. Changes are saved on this device and will sync when you are back online.',
  error: `Sync problem: ${s.msg}. It will retry automatically.` })[s.state] || '';

const requireClient = () => { if (!sb) throw new Error('Sync is not available right now (the sync library could not load; check your connection).'); return sb; };
const schedule = ms => { clearTimeout(debounce); debounce = setTimeout(syncNow, ms); };

async function ensureClient() {
  if (sb) return true;
  try {
    const { createClient } = await import(SDK);
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    sb.auth.onAuthStateChange((ev, s) => {
      session = s; // do not await Supabase calls inside this callback; defer them
      setTimeout(() => { if (!s) { unlisten(); setStatus('signedout'); } else if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') { listen(); schedule(0); } }, 0);
    });
    return true;
  } catch (e) { console.warn('Supabase SDK failed to load:', e.message); return false; }
}
function listen() {
  const uid = session?.user?.id; if (!sb || !uid || channelUid === uid) return; unlisten();
  channelUid = uid;
  channel = sb.channel(`records-${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${uid}` }, () => schedule(500)).subscribe();
}
function unlisten() { if (channel && sb) sb.removeChannel(channel); channel = null; channelUid = null; }

export async function init(opts = {}) {
  onRemote = opts.onRemote || onRemote;
  if (!enabled || wired) return; wired = true;
  DB.events.addEventListener('change', e => { if (e.detail?.imported) forceFull = true; if (session) schedule(2000); });
  addEventListener('online', async () => { if (!sb) await ensureClient(); syncNow(); });
  addEventListener('offline', () => { if (session) setStatus('offline'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  if (!(await ensureClient())) setStatus('error', 'sync library could not load (offline?)');
}

export async function signIn(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password }); if (error) throw error;
  session = data.session; return data.user;
}
export async function signUp(email, password) {
  const { data, error } = await requireClient().auth.signUp({ email, password }); if (error) throw error;
  session = data.session; return { needsConfirm: !data.session };
}
export async function signOut() { unlisten(); if (sb) await sb.auth.signOut({ scope: 'local' }); session = null; setStatus('signedout'); } // local only: other devices stay signed in

export function syncNow() {
  if (!sb || !session) return Promise.resolve();
  if (!navigator.onLine) { setStatus('offline'); return Promise.resolve(); }
  if (current) { again = true; return current; }
  current = (async () => {
    try { setStatus('syncing'); await cycle(); setStatus('ok'); }
    catch (e) { console.error('Sync failed:', e); setStatus(navigator.onLine ? 'error' : 'offline', e.message || String(e)); }
    finally { current = null; if (again) { again = false; schedule(500); } }
  })();
  return current;
}

async function cycle() {
  const uid = session.user.id;
  let st = (await DB.get('meta', 'syncState')) || { id: 'syncState' };
  if (st.userId !== uid) st = { id: 'syncState', userId: uid, cursor: null, lastPush: null }; // different account: start from scratch
  const full = forceFull; if (full) st.lastPush = null;

  // 1) PULL everything the cloud changed since the cursor
  const rows = []; let from = 0;
  for (;;) {
    let q = sb.from('records').select('store,id,data,deleted,updated_at,server_ts').order('server_ts').order('store').order('id').range(from, from + PAGE - 1);
    if (st.cursor) q = q.gte('server_ts', st.cursor);
    const { data, error } = await q; if (error) throw error;
    rows.push(...data); if (data.length < PAGE) break; from += PAGE;
  }
  const local = await DB.exportAll(), pulled = planPull(rows, local);
  if (pulled.puts.length || pulled.dels.length) { await DB.applyOps(pulled.puts, pulled.dels, 'sync'); onRemote(); }
  if (rows.length) st.cursor = rows[rows.length - 1].server_ts;

  // 2) PUSH local changes since the last push
  const startedAt = new Date().toISOString();
  const out = planPush(pulled.puts.length || pulled.dels.length ? await DB.exportAll() : local, st.lastPush, uid, pulled.seen);
  for (let i = 0; i < out.length; i += CHUNK) {
    const { error } = await sb.from('records').upsert(out.slice(i, i + CHUNK), { onConflict: 'user_id,store,id' }); if (error) throw error;
  }
  st.lastPush = startedAt; if (full) forceFull = false;
  await DB.put('meta', st);
}
