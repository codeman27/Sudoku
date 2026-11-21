/* Node unit tests for js/sudoku.js and js/storage.js (localStorage stubbed). */
const assert = require('node:assert');
const S = require('../js/sudoku.js');

// localStorage stub for storage.js in node
globalThis.localStorage = {
  _m: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; }
};
const Store = require('../js/storage.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok -', name); }
  catch (e) { failed++; console.log('FAIL -', name, '\n   ', e.message); }
}

test('PEERS: 81 entries, 20 peers each, no self', () => {
  assert.strictEqual(S.PEERS.length, 81);
  for (let i = 0; i < 81; i++) {
    assert.strictEqual(S.PEERS[i].length, 20);
    assert.ok(!S.PEERS[i].includes(i));
    for (const p of S.PEERS[i]) assert.ok(S.PEERS[p].includes(i)); // symmetric
  }
});

test('canPlace respects row/col/box', () => {
  const g = new Array(81).fill(0);
  g[0] = 5;
  assert.ok(!S.canPlace(g, 1, 5));   // same row
  assert.ok(!S.canPlace(g, 9, 5));   // same col
  assert.ok(!S.canPlace(g, 4, 5));   // same box
  assert.ok(S.canPlace(g, 80, 5));
});

test('generateFullGrid produces valid grid', () => {
  for (let t = 0; t < 5; t++) {
    const g = S.generateFullGrid();
    assert.strictEqual(g.length, 81);
    assert.ok(S.isValidFullGrid(g));
  }
});

test('isValidFullGrid rejects duplicates', () => {
  const g = S.generateFullGrid();
  g[1] = g[0]; // duplicate in row 0
  assert.ok(!S.isValidFullGrid(g));
});

test('generatePuzzle: unique solution, givens subset, target givens', () => {
  for (const diff of ['easy', 'medium', 'hard']) {
    const p = S.generatePuzzle(diff);
    assert.strictEqual(p.difficulty, diff);
    assert.strictEqual(p.puzzle.length, 81);
    assert.ok(S.isValidFullGrid(p.solution));
    // givens match solution
    for (let i = 0; i < 81; i++) {
      if (p.puzzle[i] !== 0) assert.strictEqual(p.puzzle[i], p.solution[i]);
    }
    // unique solution
    assert.strictEqual(S.countSolutions(p.puzzle, 2), 1);
    const givens = p.puzzle.filter((v) => v !== 0).length;
    const target = S.TARGET_GIVENS[diff];
    assert.ok(givens >= target && givens <= target + 4,
      'givens ' + givens + ' vs target ' + target);
  }
});

test('countSolutions does not mutate grid', () => {
  const p = S.generatePuzzle('easy');
  const copy = p.puzzle.slice();
  S.countSolutions(p.puzzle, 2);
  assert.deepStrictEqual(p.puzzle, copy);
});

test('getHint returns legal placement matching solution', () => {
  const p = S.generatePuzzle('easy');
  const g = p.puzzle.slice();
  let guard = 0;
  while (g.indexOf(0) !== -1 && guard++ < 100) {
    const h = S.getHint(g);
    assert.ok(h, 'hint exists while empty cells remain');
    assert.ok(g[h.idx] === 0, 'hint targets an empty cell');
    assert.ok(S.canPlace(g, h.idx, h.val), 'hint value is legal');
    assert.strictEqual(h.val, p.solution[h.idx], 'hint matches solution');
    g[h.idx] = h.val;
  }
  assert.ok(S.isValidFullGrid(g));
});

test('getHint returns null on full grid', () => {
  const g = S.generateFullGrid();
  assert.strictEqual(S.getHint(g), null);
});

test('Store: game round-trip', () => {
  const state = { grid: new Array(81).fill(0), solution: new Array(81).fill(1),
    notes: Array.from({ length: 81 }, () => []), givens: new Array(81).fill(false),
    difficulty: 'easy', elapsed: 12, hints: 1, won: false };
  Store.saveGame(state);
  const g = Store.loadGame();
  assert.deepStrictEqual(g, state);
  Store.clearGame();
  assert.strictEqual(Store.loadGame(), null);
});

test('Store: rejects malformed game data', () => {
  localStorage.setItem(Store.GAME_KEY, JSON.stringify({ grid: [1, 2, 3] }));
  assert.strictEqual(Store.loadGame(), null);
  localStorage.setItem(Store.GAME_KEY, 'not json');
  assert.strictEqual(Store.loadGame(), null);
  localStorage.removeItem(Store.GAME_KEY);
});

function blankGame(diff, elapsed) {
  return { grid: new Array(81).fill(0), solution: new Array(81).fill(1),
    notes: Array.from({ length: 81 }, () => []), givens: new Array(81).fill(false),
    difficulty: diff, elapsed: elapsed, hints: 0, won: false };
}

test('Store: one in-progress board per difficulty', () => {
  Store.saveGame(blankGame('easy', 5));
  Store.saveGame(blankGame('medium', 25));
  const easy = Store.loadGame('easy');
  const medium = Store.loadGame('medium');
  assert.strictEqual(easy.elapsed, 5);
  assert.strictEqual(medium.elapsed, 25);
  assert.strictEqual(Store.loadGame('hard'), null);
  const all = Store.loadAllGames();
  assert.deepStrictEqual(Object.keys(all), ['easy', 'medium', 'hard']);
  assert.strictEqual(all.hard, null);
  Store.clearGame('medium');
  assert.strictEqual(Store.loadGame('medium'), null);
  assert.strictEqual(Store.loadGame('easy').elapsed, 5, 'clearing one slot must not clear another');
});

test('Store: selected difficulty survives a reload', () => {
  Store.saveGame(blankGame('hard', 60));
  assert.strictEqual(Store.loadSelected(), 'hard');
  assert.strictEqual(Store.loadGame().difficulty, 'hard', 'no-arg load resumes the selected slot');
  Store.saveSelected('easy');
  assert.strictEqual(Store.loadSelected(), 'easy');
  assert.strictEqual(Store.loadGame().difficulty, 'easy');
});

test('Store: legacy single-game save migrates into its slot', () => {
  for (const d of Store.DIFFICULTIES) localStorage.removeItem(Store.slotKey(d));
  localStorage.removeItem(Store.SELECTED_KEY);
  const legacy = blankGame('medium', 42);
  localStorage.setItem(Store.GAME_KEY, JSON.stringify(legacy));
  const all = Store.loadAllGames();
  assert.deepStrictEqual(all.medium, legacy);
  assert.strictEqual(all.easy, null);
  assert.strictEqual(Store.loadSelected(), 'medium');
  assert.strictEqual(localStorage.getItem(Store.GAME_KEY), null, 'legacy key is consumed');
  // A newer per-difficulty save wins over the stale legacy copy.
  const kept = blankGame('medium', 7);
  localStorage.setItem(Store.GAME_KEY, JSON.stringify(legacy));
  Store.saveGame(kept);
  assert.strictEqual(Store.loadGame('medium').elapsed, 7);
  localStorage.removeItem(Store.GAME_KEY);
});

test('Store: malformed slot data is dropped, siblings kept', () => {
  Store.saveGame(blankGame('easy', 3));
  localStorage.setItem(Store.slotKey('hard'), 'not json');
  const all = Store.loadAllGames();
  assert.strictEqual(all.hard, null);
  assert.deepStrictEqual(all.easy, blankGame('easy', 3));
  localStorage.removeItem(Store.slotKey('hard'));
});

test('Store: stats defaults and round-trip', () => {
  localStorage.removeItem(Store.STATS_KEY);
  const d = Store.loadStats();
  assert.deepStrictEqual(d, Store.defaultStats());
  d.wins.easy = 3; d.best.easy = 90; d.hints = 5;
  Store.saveStats(d);
  const s = Store.loadStats();
  assert.strictEqual(s.wins.easy, 3);
  assert.strictEqual(s.best.easy, 90);
  assert.strictEqual(s.hints, 5);
});

test('Store: corrupt stats reset to defaults', () => {
  localStorage.setItem(Store.STATS_KEY, JSON.stringify({ games: null }));
  assert.deepStrictEqual(Store.loadStats(), Store.defaultStats());
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
