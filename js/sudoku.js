/* Sudoku logic: solver, unique-puzzle generator, hints.
   Browser global `Sudoku`; Node: module.exports. */
(function () {
  const Sudoku = {};

  function rowOf(i) { return (i / 9) | 0; }
  function colOf(i) { return i % 9; }
  function boxOf(i) { return ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0); }

  const PEERS = [];
  for (let i = 0; i < 81; i++) {
    const peers = [];
    const r = rowOf(i), c = colOf(i), b = boxOf(i);
    for (let j = 0; j < 81; j++) {
      if (j !== i && (rowOf(j) === r || colOf(j) === c || boxOf(j) === b)) peers.push(j);
    }
    PEERS.push(peers);
  }

  function canPlace(grid, idx, val) {
    for (let k = 0; k < PEERS[idx].length; k++) if (grid[PEERS[idx][k]] === val) return false;
    return true;
  }

  function candidates(grid, idx) {
    const c = [];
    for (let v = 1; v <= 9; v++) if (canPlace(grid, idx, v)) c.push(v);
    return c;
  }

  // Count solutions up to limit (default 2). Does not mutate grid.
  function countSolutions(grid, limit) {
    limit = limit || 2;
    const g = grid.slice();
    let count = 0;
    (function solve() {
      let best = -1, bestC = null;
      for (let i = 0; i < 81; i++) {
        if (g[i] === 0) {
          const c = candidates(g, i);
          if (c.length === 0) return;
          if (bestC === null || c.length < bestC.length) { best = i; bestC = c; }
          if (c.length === 1) break;
        }
      }
      if (best === -1) { count++; return; }
      for (let k = 0; k < bestC.length; k++) {
        g[best] = bestC[k];
        solve();
        g[best] = 0;
        if (count >= limit) return;
      }
    })();
    return count;
  }

  // Mutates grid into a solution; returns true if solvable.
  function solveGrid(grid) {
    let best = -1, bestC = null;
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0) {
        const c = candidates(grid, i);
        if (c.length === 0) return false;
        if (bestC === null || c.length < bestC.length) { best = i; bestC = c; }
      }
    }
    if (best === -1) return true;
    for (let k = 0; k < bestC.length; k++) {
      grid[best] = bestC[k];
      if (solveGrid(grid)) return true;
      grid[best] = 0;
    }
    return false;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function generateFullGrid() {
    const g = new Array(81).fill(0);
    (function fill(i) {
      if (i === 81) return true;
      const vals = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (let k = 0; k < 9; k++) {
        const v = vals[k];
        if (canPlace(g, i, v)) {
          g[i] = v;
          if (fill(i + 1)) return true;
          g[i] = 0;
        }
      }
      return false;
    })(0);
    return g;
  }

  const TARGET_GIVENS = { easy: 40, medium: 30, hard: 24 };

  // Generate a puzzle with a unique solution; givens near the difficulty target.
  function generatePuzzle(difficulty) {
    const target = TARGET_GIVENS[difficulty] || 30;
    const full = generateFullGrid();
    const grid = full.slice();
    const order = shuffle(Array.from({ length: 81 }, (_, i) => i));
    let givens = 81;
    for (let k = 0; k < 81 && givens > target; k++) {
      const i = order[k];
      const saved = grid[i];
      grid[i] = 0;
      if (countSolutions(grid, 2) === 1) givens--;
      else grid[i] = saved;
    }
    return { puzzle: grid, solution: full, difficulty: difficulty };
  }

  // Hint: prefer a cell with a single legal candidate, else solve and reveal one cell.
  function getHint(grid) {
    const empties = [];
    for (let i = 0; i < 81; i++) if (grid[i] === 0) empties.push(i);
    if (!empties.length) return null;
    const singles = [];
    for (let k = 0; k < empties.length; k++) {
      const c = candidates(grid, empties[k]);
      if (c.length === 1) singles.push({ idx: empties[k], val: c[0] });
    }
    if (singles.length) return singles[(Math.random() * singles.length) | 0];
    const g = grid.slice();
    if (solveGrid(g)) {
      const i = empties[(Math.random() * empties.length) | 0];
      return { idx: i, val: g[i] };
    }
    return null;
  }

  function isValidFullGrid(grid) {
    for (let r = 0; r < 9; r++) {
      const rowSet = new Set(), colSet = new Set(), boxSet = new Set();
      for (let k = 0; k < 9; k++) {
        rowSet.add(grid[r * 9 + k]);
        colSet.add(grid[k * 9 + r]);
        boxSet.add(grid[((r / 3 | 0) * 3 + (k / 3 | 0)) * 9 + (r % 3) * 3 + (k % 3)]);
      }
      if (rowSet.size !== 9 || colSet.size !== 9 || boxSet.size !== 9) return false;
    }
    return true;
  }

  Sudoku.canPlace = canPlace;
  Sudoku.candidates = candidates;
  Sudoku.countSolutions = countSolutions;
  Sudoku.solveGrid = solveGrid;
  Sudoku.generateFullGrid = generateFullGrid;
  Sudoku.generatePuzzle = generatePuzzle;
  Sudoku.getHint = getHint;
  Sudoku.isValidFullGrid = isValidFullGrid;
  Sudoku.TARGET_GIVENS = TARGET_GIVENS;
  Sudoku.PEERS = PEERS;

  globalThis.Sudoku = Sudoku;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sudoku;
})();
