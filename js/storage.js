/* localStorage persistence for game state and stats.
   One in-progress board is saved per difficulty ('...game.v1.easy' etc.). The
   older single-game save ('sudoku.journal.game.v1') is migrated into the slot
   matching its difficulty the first time saved games are read.
   Browser global `Storage`; Node: module.exports. */
(function () {
  const GAME_KEY = 'sudoku.journal.game.v1';        // legacy single-game key
  const SLOT_PREFIX = GAME_KEY + '.';               // per-difficulty slots
  const STATS_KEY = 'sudoku.journal.stats.v1';
  const SELECTED_KEY = 'sudoku.journal.selected.v1';
  const DIFFICULTIES = ['easy', 'medium', 'hard'];

  let warned = false;
  function warn(message, error) {
    if (warned) return;
    warned = true;
    console.error(message, error || '');
    if (typeof document !== 'undefined') {
      const notice = document.getElementById('storage-warning');
      if (notice) notice.hidden = false;
    }
  }

  function get(k) {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; }
    catch (e) { warn('Could not read saved Sudoku data.', e); return null; }
  }
  function set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { warn('Could not save Sudoku data.', e); }
  }
  function remove(k) {
    try { localStorage.removeItem(k); }
    catch (e) { warn('Could not clear saved Sudoku data.', e); }
  }
  function raw(k) {
    try { return localStorage.getItem(k); }
    catch (e) { warn('Could not read saved Sudoku data.', e); return undefined; }
  }

  function nonnegativeInteger(v) { return Number.isSafeInteger(v) && v >= 0; }
  function validGame(g) {
    return g && Array.isArray(g.grid) && g.grid.length === 81 &&
      g.grid.every((v) => Number.isInteger(v) && v >= 0 && v <= 9) &&
      Array.isArray(g.solution) && g.solution.length === 81 &&
      g.solution.every((v) => Number.isInteger(v) && v >= 1 && v <= 9) &&
      Array.isArray(g.givens) && g.givens.length === 81 &&
      g.givens.every((v, i) => typeof v === 'boolean' && (!v || g.grid[i] === g.solution[i])) &&
      Array.isArray(g.notes) && g.notes.length === 81 &&
      g.notes.every((n) => Array.isArray(n) && n.every((v) => Number.isInteger(v) && v >= 1 && v <= 9)) &&
      ['easy', 'medium', 'hard'].includes(g.difficulty) &&
      nonnegativeInteger(g.elapsed) && nonnegativeInteger(g.hints) && typeof g.won === 'boolean';
  }
  function validStats(s) {
    return s && s.games && s.wins && s.best &&
      ['easy', 'medium', 'hard'].every((d) =>
        nonnegativeInteger(s.games[d]) && nonnegativeInteger(s.wins[d]) &&
        (s.best[d] === null || nonnegativeInteger(s.best[d]))) &&
      nonnegativeInteger(s.hints);
  }

  function defaultStats() {
    return { games: { easy: 0, medium: 0, hard: 0 },
             wins: { easy: 0, medium: 0, hard: 0 },
             best: { easy: null, medium: null, hard: null },
             hints: 0 };
  }

  function slotKey(diff) { return SLOT_PREFIX + diff; }

  // Move the pre-per-difficulty single-game save into its difficulty slot.
  function migrateLegacy() {
    const rawValue = raw(GAME_KEY);
    if (rawValue === undefined || rawValue === null) return;
    const legacy = get(GAME_KEY);
    if (!legacy || !validGame(legacy)) {
      if (!legacy) warn('Saved Sudoku game is invalid.');
      remove(GAME_KEY);
      return;
    }
    const diff = legacy.difficulty;
    if (!raw(slotKey(diff))) set(slotKey(diff), legacy);
    if (!DIFFICULTIES.includes(get(SELECTED_KEY))) set(SELECTED_KEY, diff);
    remove(GAME_KEY);
  }

  function resolveDiff(diff) {
    if (DIFFICULTIES.includes(diff)) return diff;
    const sel = get(SELECTED_KEY);
    return DIFFICULTIES.includes(sel) ? sel : null;
  }

  const Store = {
    saveGame(state) {
      if (!state || !DIFFICULTIES.includes(state.difficulty)) { warn('Saved Sudoku game is invalid.'); return; }
      set(slotKey(state.difficulty), state);
      set(SELECTED_KEY, state.difficulty);
    },
    loadGame(diff) {
      migrateLegacy();
      const d = resolveDiff(diff);
      if (!d) return null;
      const g = get(slotKey(d));
      if (!g) return null;
      if (!validGame(g)) { warn('Saved Sudoku game is invalid.'); return null; }
      return g;
    },
    loadAllGames() {
      migrateLegacy();
      const out = {};
      for (const d of DIFFICULTIES) {
        const g = get(slotKey(d));
        if (!g) { out[d] = null; continue; }
        if (!validGame(g)) { warn('Saved Sudoku game is invalid.'); out[d] = null; continue; }
        out[d] = g;
      }
      return out;
    },
    saveSelected(diff) {
      if (DIFFICULTIES.includes(diff)) set(SELECTED_KEY, diff);
    },
    loadSelected() {
      const sel = get(SELECTED_KEY);
      return DIFFICULTIES.includes(sel) ? sel : null;
    },
    clearGame(diff) {
      const d = resolveDiff(diff);
      if (d) remove(slotKey(d));
    },
    loadStats() {
      const s = get(STATS_KEY);
      if (!s) return defaultStats();
      if (!validStats(s)) { warn('Saved Sudoku statistics are invalid.'); return defaultStats(); }
      return s;
    },
    saveStats(s) { set(STATS_KEY, s); },
    defaultStats: defaultStats,
    GAME_KEY: GAME_KEY,
    STATS_KEY: STATS_KEY,
    SLOT_PREFIX: SLOT_PREFIX,
    SELECTED_KEY: SELECTED_KEY,
    DIFFICULTIES: DIFFICULTIES,
    slotKey: slotKey
  };

  globalThis.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})();
