/* Playwright browser tests: UI play, persistence, offline, accessibility.
   Uses an ephemeral localhost server, killed at the end. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8123;
let passed = 0, failed = 0;
function test(name, fn) {
  return fn().then(() => { passed++; console.log('ok -', name); })
    .catch((e) => { failed++; console.log('FAIL -', name, '\n   ', e.message); });
}

function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '-d', process.env.SUDOKU_TEST_DIR || process.cwd()], { stdio: 'ignore' });
  return (async () => {
    for (let i = 0; i < 100; i++) {
      const ok = await new Promise((res) => {
        const req = http.get('http://localhost:' + PORT + '/', (r) => res(r.statusCode === 200));
        req.on('error', () => res(false));
      });
      if (ok) return proc;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('server did not start');
  })().then((p) => [proc, p]);
}

(async () => {
  const [server] = await startServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const url = 'http://localhost:' + PORT + '/';

  try {
    await test('page loads, board renders 81 cells (mobile viewport)', async () => {
      await page.goto(url);
      const n = await page.locator('.cell').count();
      if (n !== 81) throw new Error('cells: ' + n);
      const rows = await page.locator('#board [role=row]').count();
      if (rows !== 9) throw new Error('rows: ' + rows);
      const bb = await page.locator('#board').boundingBox();
      if (bb.width > 390) throw new Error('board too wide: ' + bb.width);
    });

    await test('board is horizontally centered, no overflow at phone sizes', async () => {
      for (const [w, h] of [[390, 844], [360, 740]]) {
        const phone = await browser.newContext({ viewport: { width: w, height: h } });
        const p = await phone.newPage();
        await p.goto(url);
        const m = await p.evaluate(() => {
          const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, right: r.x + r.width }; };
          const version = document.querySelector('.app-version').getBoundingClientRect();
          return { vw: window.innerWidth, screen: box('.screen'), board: box('#board'), versionBottom: version.bottom, scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight };
        });
        const left = m.board.x - m.screen.x;
        const right = m.screen.right - m.board.right;
        if (Math.abs(left - right) > 1)
          throw new Error(w + 'x' + h + ' off-center: left ' + left.toFixed(1) + ' vs right ' + right.toFixed(1));
        if (m.board.x < 0 || m.board.right > m.vw)
          throw new Error(w + 'x' + h + ' overflows viewport: board ' + m.board.x.toFixed(1) + '..' + m.board.right.toFixed(1));
        if (m.scrollH > m.innerH + 1)
          throw new Error(w + 'x' + h + ' scrolls: ' + m.scrollH + ' > ' + m.innerH);
        if (m.versionBottom > m.innerH)
          throw new Error(w + 'x' + h + ' version is below the viewport');
        await phone.close();
      }
    });

    await test('footer displays the current app version', async () => {
      const version = await page.locator('.app-version').textContent();
      if (version.trim() !== 'v' + require('../package.json').version) throw new Error('version: ' + version);
    });

    await test('accessibility roles and roving tabindex', async () => {
      const a = await page.evaluate(() => ({
        grid: document.getElementById('board').getAttribute('role'),
        cell: document.querySelector('.cell').getAttribute('role'),
        group: document.getElementById('diff-picker').getAttribute('role'),
        timer: document.getElementById('timer').getAttribute('role'),
        live: document.getElementById('announce').getAttribute('aria-live'),
        tab0: [...document.querySelectorAll('.cell')].filter((c) => c.tabIndex === 0).length,
        labels: [...document.querySelectorAll('.cell')].every((c) => /^Row \d+, Column \d+: /.test(c.getAttribute('aria-label')))
      }));
      if (a.grid !== 'grid' || a.cell !== 'gridcell' || a.group !== 'radiogroup' || a.timer !== 'timer') throw new Error('roles: ' + JSON.stringify(a));
      if (a.live !== 'polite') throw new Error('live region');
      if (a.tab0 !== 1) throw new Error('tabindex0 count: ' + a.tab0);
      if (!a.labels) throw new Error('missing aria-labels');
    });

    await test('keyboard access works on first focus without a click', async () => {
      await page.locator('.cell[tabindex="0"]').focus();
      await page.keyboard.press('ArrowRight');
      if (await page.evaluate(() => debugState().selected) !== 1) throw new Error('arrow did not move selection');
    });

    await test('fresh game: easy, unique solution, givens ~40', async () => {
      const s = await page.evaluate(() => debugState());
      if (s.difficulty !== 'easy') throw new Error('diff: ' + s.difficulty);
      const givens = s.grid.filter((v) => v !== 0).length;
      if (givens < 40 || givens > 44) throw new Error('givens: ' + givens);
      const cnt = await page.evaluate(() => Sudoku.countSolutions(debugState().grid, 2));
      if (cnt !== 1) throw new Error('solutions: ' + cnt);
    });

    await test('click cell + number pad places digit', async () => {
      const idx = await page.evaluate(() => debugState().grid.indexOf(0));
      await page.click('.cell[data-idx="' + idx + '"]');
      await page.click('#pad button[data-val="5"]');
      const g = await page.evaluate(() => debugState().grid);
      if (g[idx] !== 5) throw new Error('grid[idx]: ' + g[idx]);
      const cellText = await page.locator('.cell[data-idx="' + idx + '"]').textContent();
      if (cellText.trim() !== '5') throw new Error('cell text: ' + cellText);
    });

    await test('undo restores empty cell', async () => {
      await page.click('#tool-undo');
      const g = await page.evaluate(() => debugState().grid);
      const idx = await page.evaluate(() => debugState().selected);
      // undo moves selection to the undone cell
      if (g[idx] !== 0) throw new Error('after undo: ' + g[idx]);
    });

    await test('notes mode toggles and stores pencil marks', async () => {
      const idx = await page.evaluate(() => debugState().grid.indexOf(0));
      await page.click('.cell[data-idx="' + idx + '"]');
      await page.click('#tool-notes');
      const pressed = await page.getAttribute('#tool-notes', 'aria-pressed');
      if (pressed !== 'true') throw new Error('pressed: ' + pressed);
      await page.click('#pad button[data-val="3"]');
      await page.click('#pad button[data-val="7"]');
      const n = await page.evaluate((i) => debugState().notes[i], idx);
      if (n.join(',') !== '3,7') throw new Error('notes: ' + n);
      const pencil = await page.locator('.cell[data-idx="' + idx + '"] .pencil span:nth-child(3)').textContent();
      if (pencil.trim() !== '3') throw new Error('pencil render: ' + pencil);
      await page.click('#tool-notes'); // off
      await page.click('#pad button[data-val="5"]');
      const st = await page.evaluate((i) => ({ v: debugState().grid[i], n: debugState().notes[i] }), idx);
      if (st.v !== 5 || st.n.length !== 0) throw new Error('after place over notes: ' + JSON.stringify(st));
    });

    await test('erase clears a user-entered cell', async () => {
      const idx = await page.evaluate(() => debugState().selected);
      await page.click('#tool-erase');
      const g = await page.evaluate(() => debugState().grid);
      if (g[idx] !== 0) throw new Error('after erase: ' + g[idx]);
    });

    await test('givens cannot be changed', async () => {
      const idx = await page.evaluate(() => debugState().grid.findIndex((v) => v !== 0));
      await page.click('.cell[data-idx="' + idx + '"]');
      const before = await page.evaluate(() => debugState().grid);
      await page.click('#pad button[data-val="9"]');
      const after = await page.evaluate(() => debugState().grid);
      if (before[idx] !== after[idx]) throw new Error('given changed');
    });

    await test('hint fills a cell with the solution value', async () => {
      await page.click('#tool-hint');
      const s = await page.evaluate(() => debugState());
      const filled = s.grid.filter((v, i) => v !== 0 && !s.givens[i]).length;
      if (filled < 1) throw new Error('no hint placed');
      for (let i = 0; i < 81; i++) {
        if (s.grid[i] !== 0 && !s.givens[i] && s.grid[i] !== s.solution[i])
          throw new Error('hint mismatch at ' + i);
      }
      if (s.hints !== 1) throw new Error('hints: ' + s.hints);
      const stats = await page.evaluate(() => Store.loadStats());
      if (stats.hints !== 1) throw new Error('total hints: ' + stats.hints);
    });

    await test('hint corrects an incorrect entry', async () => {
      const { idx, wrong } = await page.evaluate(() => {
        const s = debugState(), idx = s.grid.indexOf(0);
        return { idx, wrong: s.solution[idx] % 9 + 1 };
      });
      await page.click('.cell[data-idx="' + idx + '"]');
      await page.click('#pad button[data-val="' + wrong + '"]');
      await page.click('#tool-hint');
      const s = await page.evaluate(() => debugState());
      if (s.grid[idx] !== s.solution[idx]) throw new Error('incorrect entry not corrected');
    });

    await test('keyboard: arrows move selection, digits place, backspace erases', async () => {
      const idx = await page.evaluate(() => {
        for (let i = 0; i < 80; i++) {
          const g = debugState().grid;
          // stay inside one row so ArrowRight means i + 1
          if (i % 9 !== 8 && g[i] === 0 && g[i + 1] === 0) return i;
        }
        return -1;
      });
      if (idx < 0) throw new Error('no adjacent empty pair');
      await page.click('.cell[data-idx="' + idx + '"]');
      await page.keyboard.press('ArrowRight');
      const sel = await page.evaluate(() => debugState().selected);
      if (sel !== idx + 1) throw new Error('arrow moved to ' + sel);
      await page.keyboard.press('4');
      const g = await page.evaluate(() => debugState().grid);
      if (g[sel] !== 4) throw new Error('key place: ' + g[sel]);
      await page.keyboard.press('Backspace');
      const g2 = await page.evaluate(() => debugState().grid);
      if (g2[sel] !== 0) throw new Error('backspace erase: ' + g2[sel]);
    });

    await test('persistence: reload restores game, timer, and stats', async () => {
      const before = await page.evaluate(() => debugState());
      await page.reload();
      const after = await page.evaluate(() => debugState());
      if (after.grid.join(',') !== before.grid.join(',')) throw new Error('grid changed');
      if (after.difficulty !== before.difficulty) throw new Error('difficulty changed');
      if (after.elapsed < before.elapsed) throw new Error('timer lost');
      const timerText = await page.textContent('#timer');
      if (!/\u25f7 \d\d:\d\d/.test(timerText)) throw new Error('timer text: ' + timerText);
      const statsText = await page.textContent('#stats-line');
      if (!/Games/.test(statsText)) throw new Error('stats line: ' + statsText);
    });

    await test('difficulty radio changes badge; New puzzle starts new game', async () => {
      const before = await page.evaluate(() => debugState().grid.join(','));
      await page.click('.diff-btn[data-diff="medium"]');
      const checked = await page.getAttribute('.diff-btn[data-diff="medium"]', 'aria-checked');
      if (checked !== 'true') throw new Error('radio not checked');
      await page.click('#new-game');
      const s = await page.evaluate(() => debugState());
      if (s.difficulty !== 'medium') throw new Error('diff: ' + s.difficulty);
      if (s.grid.join(',') === before) throw new Error('same grid');
      const givens = s.grid.filter((v) => v !== 0).length;
      if (givens < 30 || givens > 34) throw new Error('medium givens: ' + givens);
      await page.reload();
      if (await page.getAttribute('.diff-btn[data-diff="medium"]', 'aria-checked') !== 'true')
        throw new Error('restored difficulty not selected');
      if ((await page.textContent('#difficulty-badge')).trim() !== 'medium')
        throw new Error('restored badge does not match game');
    });

    await test('win flow: hints to completion, overlay, stats recorded', async () => {
      await page.click('.diff-btn[data-diff="easy"]');
      await page.click('#new-game');
      let guard = 0;
      while (!(await page.locator('#win-overlay').isVisible()) && guard++ < 100) {
        await page.click('#tool-hint');
      }
      if (!(await page.locator('#win-overlay').isVisible())) throw new Error('overlay never shown');
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem(Store.STATS_KEY)));
      if (st.wins.easy !== 1) throw new Error('wins: ' + JSON.stringify(st.wins));
      if (st.best.easy === null) throw new Error('best not recorded');
      const detail = await page.textContent('#win-detail');
      if (!/solved in \d\d:\d\d/.test(detail)) throw new Error('detail: ' + detail);
      await page.click('#win-new');
      if (await page.locator('#win-overlay').isVisible()) throw new Error('overlay not closed');
      const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem(Store.STATS_KEY)));
      if (st2.games.easy !== 3) throw new Error('games: ' + st2.games.easy);
    });

    await test('service worker registers and controls the page', async () => {
      const scope = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        return r.scope;
      });
      if (!scope.includes(String(PORT))) throw new Error('scope: ' + scope);
      const ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
      if (!ctrl) throw new Error('no controller yet');
    });

    await test('manifest is valid and precached', async () => {
      const m = await page.evaluate(async () => {
        const r = await fetch('manifest.webmanifest');
        return r.status === 200 ? JSON.parse(await r.text()) : null;
      });
      if (!m || m.display !== 'standalone' || m.icons.length < 2) throw new Error('manifest: ' + JSON.stringify(m));
    });

    await test('production CSP permits offline launch and new puzzles at every difficulty', async () => {
      const offlineCtx = await browser.newContext();
      try {
        await offlineCtx.route(url, async (route) => {
          const response = await route.fetch();
          await route.fulfill({
            response,
            headers: { ...response.headers(), 'content-security-policy': "default-src 'self'; script-src 'self'" }
          });
        });
        const onlinePage = await offlineCtx.newPage();
        await onlinePage.goto(url);
        await onlinePage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
        await offlineCtx.setOffline(true);
        await onlinePage.close();
        const offlinePage = await offlineCtx.newPage();
        await offlinePage.goto(url + 'index.html');
        for (const diff of ['easy', 'medium', 'hard']) {
          await offlinePage.click('.diff-btn[data-diff="' + diff + '"]');
          await offlinePage.click('#new-game');
          const state = await offlinePage.evaluate(() => ({
            ...debugState(),
            solutions: Sudoku.countSolutions(debugState().grid, 2)
          }));
          if (state.difficulty !== diff || state.solutions !== 1) throw new Error('invalid offline ' + diff + ' puzzle');
          const idx = state.grid.indexOf(0);
          if (idx < 0) throw new Error('no empty cells in ' + diff + ' puzzle');
          await offlinePage.click('.cell[data-idx="' + idx + '"]');
          await offlinePage.click('#pad button[data-val="' + state.solution[idx] + '"]');
          if (await offlinePage.evaluate((i) => debugState().grid[i], idx) !== state.solution[idx])
            throw new Error('offline entry failed for ' + diff);
        }
        const before = await offlinePage.evaluate(() => debugState().grid.join(','));
        await offlinePage.reload();
        if (await offlinePage.evaluate(() => debugState().grid.join(',')) !== before)
          throw new Error('offline progress not restored');
      } finally {
        await offlineCtx.close();
      }
    });

    await test('offline: server stopped, reload loads from cache and plays', async () => {
      server.kill();
      await new Promise((r) => setTimeout(r, 300));
      await page.reload();
      const n = await page.locator('.cell').count();
      if (n !== 81) throw new Error('offline cells: ' + n);
      const s0 = await page.evaluate(() => debugState());
      await page.click('#new-game');
      const s1 = await page.evaluate(() => debugState());
      if (s1.grid.join(',') === s0.grid.join(',')) throw new Error('offline new game failed');
      const idx = s1.grid.indexOf(0);
      await page.click('.cell[data-idx="' + idx + '"]');
      await page.click('#pad button[data-val="6"]');
      const g = await page.evaluate(() => debugState().grid);
      if (g[idx] !== 6) throw new Error('offline play failed');
    });
  } catch (e) {
    failed++;
    console.log('FAIL - (suite) \n   ', e.message);
  }

  await browser.close();
  server.kill();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
