/* UI wiring: board, selection, number pad, notes, undo, erase, hint,
   timer, completion, stats, accessibility. */
(function () {
  const S = globalThis.Sudoku;
  const Store = globalThis.Store;

  const boardEl = document.getElementById('board');
  const padEl = document.getElementById('pad');
  const timerEl = document.getElementById('timer');
  const badgeEl = document.getElementById('difficulty-badge');
  const statsEl = document.getElementById('stats-line');
  const announceEl = document.getElementById('announce');
  const overlayEl = document.getElementById('win-overlay');
  const winDetailEl = document.getElementById('win-detail');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (error) {
        console.error('Offline support could not be enabled.', error);
        announceEl.textContent = 'Offline support could not be enabled.';
      });
    });
  }

  let grid, solution, notes, givens, difficulty, elapsed, hints, won;
  let undoStack = [];
  let notesMode = false;
  let selected = -1;
  let timerId = null;
  let hinted = {};

  const cells = [];
  const padBtns = [];

  function rowOf(i) { return (i / 9) | 0; }
  function colOf(i) { return i % 9; }
  function fmt(sec) {
    const m = (sec / 60) | 0, s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }
  function announce(msg) { announceEl.textContent = msg; }

  function buildBoard() {
    for (let r = 0; r < 9; r++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'row');
      for (let c = 0; c < 9; c++) {
        const i = r * 9 + c;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell';
        b.setAttribute('role', 'gridcell');
        b.tabIndex = -1;
        b.dataset.idx = i;
        b.addEventListener('focus', function () {
          if (selected !== i) select(i, false);
        });
        b.addEventListener('click', function () { select(i, true); });
        row.appendChild(b);
        cells.push(b);
      }
      boardEl.appendChild(row);
    }
    boardEl.addEventListener('keydown', onBoardKey);
  }

  function buildPad() {
    for (let v = 1; v <= 9; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'number';
      b.dataset.val = v;
      b.innerHTML = v + '<span class="count"></span>';
      b.addEventListener('click', function () { place(v); });
      padEl.appendChild(b);
      padBtns.push(b);
    }
  }

  function conflicts() {
    const bad = {};
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0) continue;
      for (const p of S.PEERS[i]) {
        if (grid[p] === grid[i]) { bad[i] = true; bad[p] = true; }
      }
    }
    return bad;
  }

  function renderAll() {
    const bad = conflicts();
    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      const v = grid[i];
      const n = notes[i];
      el.className = 'cell';
      if (givens[i]) el.classList.add('given');
      else if (v !== 0) el.classList.add('entered');
      if (bad[i]) el.classList.add('conflict');
      if (hinted[i]) el.classList.add('hinted');
      if (i === selected) {
        el.classList.add('selected');
        el.tabIndex = 0;
      } else {
        el.tabIndex = -1;
        if (selected >= 0 && S.PEERS[selected].indexOf(i) !== -1) {
          el.classList.add(grid[i] !== 0 && grid[i] === grid[selected] ? 'same' : 'peer');
        }
      }
      if (v !== 0) {
        el.textContent = v;
      } else if (n.length) {
        el.classList.add('notes');
        el.textContent = '';
        const g = document.createElement('span');
        g.className = 'pencil';
        for (let d = 1; d <= 9; d++) {
          const sp = document.createElement('span');
          if (n.indexOf(d) !== -1) sp.textContent = d;
          g.appendChild(sp);
        }
        el.appendChild(g);
      } else {
        el.textContent = '';
      }
      el.setAttribute('aria-label',
        'Row ' + (rowOf(i) + 1) + ', Column ' + (colOf(i) + 1) + ': ' +
        (v !== 0 ? v : (n.length ? 'notes ' + n.join(' ') : 'empty')));
    }
    if (selected < 0) cells[0].tabIndex = 0;
    for (let v = 1; v <= 9; v++) {
      let count = 0;
      for (let i = 0; i < 81; i++) if (grid[i] === v) count++;
      const left = 9 - count;
      const b = padBtns[v - 1];
      b.classList.toggle('exhausted', left <= 0);
      b.querySelector('.count').textContent = left > 0 ? left : '';
      b.setAttribute('aria-label', 'Place ' + v + (left > 0 ? ', ' + left + ' remaining' : ', all placed'));
    }
  }

  function renderTimer() { timerEl.textContent = '\u25f7 ' + fmt(elapsed); }

  function renderStats() {
    const st = Store.loadStats();
    const best = st.best[difficulty];
    statsEl.innerHTML = 'Games <strong>' + st.games[difficulty] + '</strong>' +
      ' \u00b7 Wins <strong>' + st.wins[difficulty] + '</strong>' +
      ' \u00b7 Best ' + difficulty + ' <strong>' + (best != null ? fmt(best) : '\u2014') + '</strong>' +
      ' \u00b7 Hints <strong>' + st.hints + '</strong>';
  }

  // Only in-progress boards are kept; a finished puzzle frees its slot.
  function save() {
    if (won) { Store.clearGame(difficulty); return; }
    Store.saveGame({ grid: grid, solution: solution, notes: notes, givens: givens,
      difficulty: difficulty, elapsed: elapsed, hints: hints, won: won });
  }

  // Saved in-progress board for a difficulty (default: the selected one).
  function resumeGame(diff) {
    const d = diff || Store.loadSelected() || currentDiff();
    const g = Store.loadGame(d);
    if (!g) return null;
    if (g.won) { Store.clearGame(g.difficulty); return null; }
    return g;
  }

  function startTimer() {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(function () {
      if (won) return;
      elapsed++;
      renderTimer();
      save();
    }, 1000);
  }

  function select(i, focus) {
    selected = i;
    renderAll();
    if (focus) cells[i].focus();
  }

  function onBoardKey(e) {
    const i = selected;
    if (i < 0) return;
    const r = rowOf(i), c = colOf(i);
    let ni = -1;
    if (e.key === 'ArrowUp') ni = (r + 8) % 9 * 9 + c;
    else if (e.key === 'ArrowDown') ni = (r + 1) % 9 * 9 + c;
    else if (e.key === 'ArrowLeft') ni = r * 9 + (c + 8) % 9;
    else if (e.key === 'ArrowRight') ni = r * 9 + (c + 1) % 9;
    if (ni >= 0) { e.preventDefault(); select(ni, true); return; }
    const d = parseInt(e.key, 10);
    if (d >= 1 && d <= 9) { e.preventDefault(); place(d); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); erase(); }
  }

  function place(v) {
    if (won) return;
    if (selected < 0) { announce('Select a cell first.'); return; }
    const i = selected;
    if (givens[i]) { announce('That cell is a clue and cannot be changed.'); return; }
    if (notesMode) {
      undoStack.push({ idx: i, prev: grid[i], prevNotes: notes[i].slice() });
      const k = notes[i].indexOf(v);
      if (k === -1) notes[i].push(v); else notes[i].splice(k, 1);
      notes[i].sort(function (a, b) { return a - b; });
      hinted[i] = false;
      renderAll(); save();
      announce('Note ' + v + ' row ' + (rowOf(i) + 1) + ' column ' + (colOf(i) + 1) + '.');
      return;
    }
    undoStack.push({ idx: i, prev: grid[i], prevNotes: notes[i].slice() });
    grid[i] = v;
    notes[i] = [];
    hinted[i] = false;
    renderAll(); save();
    const bad = conflicts();
    if (bad[i]) announce('Placed ' + v + ' at row ' + (rowOf(i) + 1) + ' column ' + (colOf(i) + 1) + '. Conflict detected.');
    else announce('Placed ' + v + ' at row ' + (rowOf(i) + 1) + ' column ' + (colOf(i) + 1) + '.');
    checkWin();
  }

  function erase() {
    if (won) return;
    if (selected < 0) { announce('Select a cell first.'); return; }
    const i = selected;
    if (givens[i]) { announce('That cell is a clue and cannot be erased.'); return; }
    if (grid[i] === 0 && notes[i].length === 0) { announce('Cell is already empty.'); return; }
    undoStack.push({ idx: i, prev: grid[i], prevNotes: notes[i].slice() });
    grid[i] = 0;
    notes[i] = [];
    hinted[i] = false;
    renderAll(); save();
    announce('Erased row ' + (rowOf(i) + 1) + ' column ' + (colOf(i) + 1) + '.');
  }

  function undo() {
    if (won) return;
    const e = undoStack.pop();
    if (!e) { announce('Nothing to undo.'); return; }
    grid[e.idx] = e.prev;
    notes[e.idx] = e.prevNotes.slice();
    hinted[e.idx] = false;
    select(e.idx, true);
    renderAll(); save();
    announce('Undid last change at row ' + (rowOf(e.idx) + 1) + ' column ' + (colOf(e.idx) + 1) + '.');
  }

  function hint() {
    if (won) return;
    const wrong = grid.findIndex(function (v, i) { return !givens[i] && v !== 0 && v !== solution[i]; });
    const h = wrong >= 0 ? { idx: wrong, val: solution[wrong] } : S.getHint(grid);
    if (!h) { announce('No hint available.'); return; }
    undoStack.push({ idx: h.idx, prev: grid[h.idx], prevNotes: notes[h.idx].slice() });
    grid[h.idx] = h.val;
    notes[h.idx] = [];
    hinted[h.idx] = true;
    hints++;
    const st = Store.loadStats();
    st.hints++;
    Store.saveStats(st);
    select(h.idx, true);
    renderAll(); renderStats(); save();
    announce('Hint: row ' + (rowOf(h.idx) + 1) + ' column ' + (colOf(h.idx) + 1) + ' is ' + h.val + '.');
    checkWin();
  }

  function checkWin() {
    if (grid.indexOf(0) !== -1) return;
    if (!S.isValidFullGrid(grid)) return;
    won = true;
    const st = Store.loadStats();
    st.wins[difficulty]++;
    if (st.best[difficulty] === null || elapsed < st.best[difficulty]) st.best[difficulty] = elapsed;
    Store.saveStats(st);
    save();
    renderStats();
    winDetailEl.textContent = 'A ' + difficulty + ' puzzle solved in ' + fmt(elapsed) + ' with ' + hints + ' hint' + (hints === 1 ? '' : 's') + '.';
    overlayEl.hidden = false;
    document.getElementById('win-new').focus();
    announce('Puzzle solved in ' + fmt(elapsed) + '.');
  }

  function newGame(diff) {
    difficulty = diff;
    const p = S.generatePuzzle(diff);
    grid = p.puzzle.slice();
    solution = p.solution.slice();
    givens = grid.map(function (v) { return v !== 0; });
    notes = [];
    for (let i = 0; i < 81; i++) notes.push([]);
    undoStack = [];
    hinted = {};
    elapsed = 0;
    hints = 0;
    won = false;
    selected = -1;
    const st = Store.loadStats();
    st.games[difficulty]++;
    Store.saveStats(st);
    badgeEl.textContent = diff;
    renderTimer();
    renderAll();
    renderStats();
    save();
    startTimer();
    overlayEl.hidden = true;
    announce('New ' + diff + ' puzzle with ' + grid.filter(function (v) { return v; }).length + ' clues.');
  }

  function restore(g) {
    grid = g.grid;
    solution = g.solution;
    notes = g.notes;
    givens = g.givens;
    difficulty = g.difficulty;
    elapsed = g.elapsed;
    hints = g.hints;
    won = g.won;
    undoStack = [];
    hinted = {};
    selected = -1;
    document.querySelectorAll('.diff-btn').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.diff === difficulty));
    });
    badgeEl.textContent = difficulty;
    renderTimer();
    renderAll();
    renderStats();
    if (!won) startTimer();
    announce('Restored ' + difficulty + ' puzzle, ' + fmt(elapsed) + ' elapsed.');
  }

  // Wire controls
  document.getElementById('tool-undo').addEventListener('click', undo);
  document.getElementById('tool-erase').addEventListener('click', erase);
  document.getElementById('tool-hint').addEventListener('click', hint);
  const notesBtn = document.getElementById('tool-notes');
  notesBtn.addEventListener('click', function () {
    notesMode = !notesMode;
    notesBtn.setAttribute('aria-pressed', String(notesMode));
    announce('Notes ' + (notesMode ? 'on' : 'off') + '.');
  });
  document.getElementById('new-game').addEventListener('click', function () {
    newGame(currentDiff());
  });
  document.getElementById('win-new').addEventListener('click', function () {
    overlayEl.hidden = true;
    newGame(currentDiff());
  });
  document.getElementById('win-close').addEventListener('click', function () {
    overlayEl.hidden = true;
    if (selected >= 0) cells[selected].focus();
  });
  overlayEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { overlayEl.hidden = true; }
  });

  function currentDiff() {
    const checked = document.querySelector('.diff-btn[aria-checked="true"]');
    return checked ? checked.dataset.diff : 'easy';
  }
  function selectDiff(diff) {
    document.querySelectorAll('.diff-btn').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.diff === diff));
    });
  }

  document.querySelectorAll('.diff-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const diff = btn.dataset.diff;
      if (diff === difficulty) return;
      save();                       // park the board we are leaving in its own slot
      selectDiff(diff);
      const held = resumeGame(diff);
      if (held) restore(held); else newGame(diff);
    });
  });

  buildBoard();
  buildPad();
  const saved = resumeGame();
  if (saved) restore(saved);
  else newGame(currentDiff());

  // Small read-only debug hook used by the automated tests.
  globalThis.debugState = function () {
    return { grid: grid, solution: solution, difficulty: difficulty,
             elapsed: elapsed, hints: hints, won: won, notes: notes,
             givens: givens, selected: selected };
  };
})();
