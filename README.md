# LifeOS — Personal Academic Productivity

A local-first, offline-capable web app (HTML, CSS and vanilla JavaScript only; no build step, no server, no accounts). Your data stays in your browser.

## Run it locally
ES modules and service workers need HTTP, so do not double-click `index.html`. In this folder run `python3 -m http.server 8000`, then open http://localhost:8000.

## Deploy to GitHub Pages
1. Push the project to a GitHub repository, keeping the folder layout (`assets/` and `tests/` stay as folders).
2. Settings > Pages > deploy from the `main` branch, root folder.
3. Open `https://USERNAME.github.io/REPOSITORY/`. All paths are relative, so the project sub-path works. GitHub Pages serves HTTPS, which service workers and installing the app require.

## Files
`index.html` shell · `style.css` design · `app.js` routing, dashboard, settings · `academic.js` tasks, routine, planner · `tracking.js` focus timer, distractions, habits · `reports.js` + `charts.js` analytics · `calculations.js` all formulas · `db.js` IndexedDB · `backup.js` + `portability.js` export/import/CSV · `sync.js` + `syncmerge.js` + `syncui.js` + `config.js` Supabase auto-sync (`supabase/schema.sql`) · `sw.js` offline cache · `tests/` browser tests.

## Syncing phone and laptop
**Automatic (optional):** follow `SYNC_SETUP.md` to connect your own Supabase project. Edits upload within seconds, other devices update live, and everything still works offline. Last edit wins per record; deletions sync.

**Manual:** Settings > Export Backup on one device, Settings > Import Backup on the other. Import is a safe merge: new records are added, identical ones skipped, and records with the same ID but different content are listed as conflicts (keep mine, use imported, or latest edit). Records you deleted are not resurrected by an older backup. Nothing is written until you confirm, and the write is all-or-nothing.

## Data and privacy
Durations are stored as integer seconds, event times as ISO 8601, dates as `YYYY-MM-DD`. With cloud sync off (the default), nothing is sent anywhere. With it on, your records go only to your own Supabase project. Browser storage is not encrypted, and clearing site data erases it, so export backups regularly. Library requests: Chart.js from cdnjs and, if sync is on, the Supabase client from jsDelivr; no personal data is sent to them.

## Tests
Open `tests/test-runner.html` through the local server, or run `node tests/test-runner.js`.

## Known limitations
- Reminders and notifications are not implemented yet; a web page cannot reliably alert you when the browser is closed.
- Distraction time is entered by you; a web app cannot measure other apps.
- Charts need the Chart.js CDN once online (then cached); without it you get data tables.
- Not built: weekly timetable grid with drag-and-drop, subtasks, Kanban/calendar views, routine exceptions and rescheduling, habit reminders.
- Service worker offline behavior and installation have not been verified in a real browser.

## Troubleshooting
Blank page: use a server, not `file://`. Old version after an update: reload twice or clear site data (export first). Red banner: a save failed; export a backup and check browser storage settings.
