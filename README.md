# Sudoku Journal (PWA)

A plain HTML/CSS/JS Sudoku progressive web app styled after approved mockup
Design 1/A ("The quiet journal" — sepia palette, Georgia serif, watercolor
paper). No backend, accounts, external services, or external fonts. Game
progress and stats persist only in `localStorage`.

## Run

Serve the workspace over HTTP (a service worker requires a http(s) origin):

```
python3 -m http.server 8080
```

Then open http://localhost:8080/ in a browser. No persistent server is left
running by this project; start/stop it as needed.

## Features

- Unique-solution puzzles generated per difficulty (Easy/Medium/Hard)
- Number pad, notes (pencil marks), erase, undo, hint
- Keyboard play: arrows move, 1–9 place, Backspace/Delete erases
- Timer, win overlay, local stats (games, wins, best time, hints)
- Accessible: grid/row/gridcell roles, roving tabindex, live announcements,
  contrast-adjusted palette (≥ 4.5:1 for text)
- Mobile-friendly responsive layout
- PWA: `manifest.webmanifest`, `sw.js` (cache-first app shell), local icons
  (`icons/icon-192.png`, `icons/icon-512.png`). Installable and fully
  offline after the first load.

## Install / offline

Browsers require a secure origin (https, or localhost) to install a PWA.
Visit the app online first and allow the service worker to finish caching its
files. After that, the installed app can be opened offline, resume saved games,
and generate new puzzles at every difficulty without downloading boards.
Offline availability depends on the browser retaining the site data.

The version shown in the footer matches `package.json`; update both when
releasing a new version.

## Tests

```
node tests/unit.js        # game logic + storage (12 tests)
node tests/browser.js     # Playwright UI/persistence/offline
# or run both:
npm test
```

`tests/browser.js` starts an ephemeral `python3 -m http.server` on port 8123
in the workspace and kills it when done. Playwright is installed as a
dependency (`npm install` in this workspace; Chromium headless shell in
`~/.cache/ms-playwright`).

## Layout

- `index.html` — app shell + service-worker registration
- `css/style.css` — Design A visual styling
- `js/sudoku.js` — solver, unique-solution generator, hints, validation
- `js/storage.js` — localStorage game/stats with shape validation
- `js/app.js` — UI wiring, timer, undo/notes/hints, stats, win flow
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA
- `mockups/sudoku-directions.html` — approved visual reference (unchanged)
