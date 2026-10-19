# Auto-sync with Supabase: setup guide

LifeOS stays local-first: every change is saved to IndexedDB instantly and works offline. Sync mirrors it to your own Supabase project, so phone and laptop stay identical with no manual export/import.

## 1. Create the Supabase project (5 min)
1. Sign up at https://supabase.com and click **New project** (free tier is plenty). Pick a region close to you and save the database password.
2. Open **SQL Editor > New query**, paste all of `supabase/schema.sql`, click **Run**. This creates the `records` table, locks it down so each user can only touch their own rows (Row Level Security), ignores stale writes, and enables Realtime.
3. **Authentication > Providers > Email**: keep Email enabled. For a personal app you can turn **Confirm email** off so sign-up works instantly; if you leave it on, click the link in the confirmation email before signing in.

## 2. Connect the app
1. **Project Settings > API**: copy the **Project URL** and the **anon public** key.
2. Paste them into `config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   The anon key is meant to be public; RLS protects the data. Never use the `service_role` key.
3. **Authentication > URL Configuration**: set Site URL to where you host the app (e.g. `https://USERNAME.github.io/REPOSITORY/`). Add `http://localhost:8000` under Redirect URLs for local testing.

## 3. Deploy and first sign-in
1. Push the updated project to GitHub Pages (or run `python3 -m http.server 8000` locally).
2. Open the app and click **Sign in to sync** in the sidebar (or use **Settings > Cloud sync**, now the first card). Enter email + password, click **Create account**, then **Sign in**. The first sync uploads everything on this device.
3. On your second device: open the app. On the setup screen use **Sign in and restore** (do not fill the setup form), or if already set up, sign in from Settings. Records merge by ID.

## How it behaves
- **Triggers:** app start, 2 seconds after any change, when you come back online, when the tab becomes visible, every 60 s, and instantly when another device saves (Realtime).
- **Conflicts:** the most recent edit of each record wins. Deletions sync too and beat older edits. Pulled changes refresh the screen unless you are typing or a dialog is open.
- **Offline:** edits queue naturally (they are just local changes) and upload when you reconnect.
- **Not synced:** the running focus timer (per device, stored in `meta`).
- Sidebar badge and Settings show status: Synced, Syncing, Offline, Sync error.
- Manual backup still works; importing a backup uploads those records too.

## Test it
1. Sign in on laptop and phone. Add a task on the laptop; it should appear on the phone within seconds.
2. Turn on airplane mode on the phone, edit a task, turn it off; it uploads and the laptop updates.
3. In Supabase **Table Editor > records** you should see your rows (JSON in `data`).

## Troubleshooting
- *"relation public.records does not exist"*: schema.sql was not run.
- *Sign-in says invalid credentials after sign-up*: confirm the email first, or disable Confirm email.
- *No instant updates, only every 60 s*: Realtime is not enabled for `records` (re-run the last block of schema.sql, or Database > Replication).
- *Sync error banner after editing config*: reload twice so the service worker serves the new `config.js`.
- *Reset a device*: Settings > Delete all local data. It signs out and keeps the cloud copy; sign in again to re-download.
- *Wipe the cloud copy*: in Supabase run `delete from public.records;` (affects all users of the project).

## Privacy notes
Data is stored unencrypted in your Supabase project (readable by you as project owner; other users cannot read it thanks to RLS). The app downloads the Supabase library from cdn.jsdelivr.net (pinned to version 2.117.2, then cached for offline use).
