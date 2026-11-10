// CrosSum puzzle engine: evaluation, seeded RNG, level configs, generator.
// Plain script (globals in the browser), also require()-able from node for tests.

const OPS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => (b !== 0 && a % b === 0 ? a / b : NaN),
  '^': (a, b) => (b >= 0 && b <= 6 ? a ** b : NaN),
  '%': (a, b) => (b > 0 ? a % b : NaN),
};
const PREC = { '^': 3, '×': 2, '÷': 2, '%': 2, '+': 1, '-': 1 };

// Standard precedence, left-to-right within a level. NaN on any invalid step.
function evalExpr(nums, ops) {
  const n = nums.slice(), o = ops.slice();
  for (const p of [3, 2, 1]) {
    for (let i = 0; i < o.length; ) {
      if (PREC[o[i]] !== p) { i++; continue; }
      const v = OPS[o[i]](n[i], n[i + 1]);
      if (!Number.isFinite(v) || Math.abs(v) > 1e9) return NaN;
      n.splice(i, 2, v);
      o.splice(i, 1);
    }
  }
  return n[0];
}

// cells = [num, op, num, op, ..., num]. True iff exactly one '=' and both sides are equal.
function checkEquation(cells) {
  const eq = cells.indexOf('=');
  if (eq < 0 || cells.lastIndexOf('=') !== eq) return false;
  const side = (s) => evalExpr(s.filter((_, i) => i % 2 === 0), s.filter((_, i) => i % 2));
  const l = side(cells.slice(0, eq)), r = side(cells.slice(eq + 1));
  return Number.isFinite(l) && l === r;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

// Difficulty curve: gentle for ~3 levels, then ramps fast.
function levelConfig(n) {
  const ops = ['+', '-'];
  if (n >= 3) ops.push('×');
  if (n >= 6) ops.push('÷');
  if (n >= 12) ops.push('^');
  if (n >= 18) ops.push('%');
  return {
    ops,
    eqs: Math.min(12, 1 + Math.ceil(n * 0.6)),
    long: Math.min(0.6, Math.max(0, (n - 3) * 0.07)), // chance of a 3-operand equation
    maxNum: n < 8 ? 9 : n < 15 ? 12 : 20,
    maxResult: n < 3 ? 18 : Math.min(200, 20 + n * 8),
    reveal: Math.max(0.05, 0.9 - n * 0.07), // chance a non-crossing operator is pre-filled
    size: n < 4 ? 7 : n < 9 ? 9 : 11,
  };
}

function genEquation(rand, cfg, terms) {
  for (let t = 0; t < 60; t++) {
    const nums = [], ops = [];
    for (let i = 0; i < terms; i++) nums.push(int(rand, 1, cfg.maxNum));
    for (let i = 0; i < terms - 1; i++) ops.push(pick(rand, cfg.ops));
    // nudge operands so ÷, ^ and % produce sensible numbers
    ops.forEach((op, i) => {
      if (op === '÷') { nums[i + 1] = int(rand, 2, 9); nums[i] = nums[i + 1] * int(rand, 1, 9); }
      if (op === '^') { nums[i] = int(rand, 2, 5); nums[i + 1] = int(rand, 2, 3); }
      if (op === '%') { nums[i + 1] = int(rand, 2, 9); nums[i] = int(rand, nums[i + 1] + 1, 30); }
    });
    const v = evalExpr(nums, ops);
    if (!Number.isInteger(v) || v < 0 || v > cfg.maxResult) continue;
    const expr = nums.flatMap((x, i) => (i ? [ops[i - 1], x] : [x]));
    return rand() < 0.3 ? [v, '=', ...expr] : [...expr, '=', v];
  }
  return null;
}

function generate(seed, cfg) {
  for (let s = seed; ; s++) {
    const p = tryGenerate(s, cfg);
    if (p) return p;
  }
}

function tryGenerate(seed, cfg) {
  const rand = rng(seed);
  const grid = new Map(), eqs = [];
  const key = (r, c) => r + ',' + c;
  const dirv = (d) => (d === 'h' ? [0, 1] : [1, 0]);
  const terms = () => (rand() < cfg.long ? 3 : 2);
  let box = null;

  function fits(eq) {
    const [dr, dc] = dirv(eq.dir), n = eq.cells.length;
    if (grid.has(key(eq.r - dr, eq.c - dc)) || grid.has(key(eq.r + dr * n, eq.c + dc * n))) return false;
    for (let i = 0; i < n; i++) {
      const r = eq.r + dr * i, c = eq.c + dc * i, cell = grid.get(key(r, c));
      if (cell) {
        // may only cross at an operator with the same value, perpendicular to its owner
        if (i % 2 === 0 || cell.val !== eq.cells[i] || cell[eq.dir] !== undefined) return false;
      } else if (grid.has(key(r + dc, c + dr)) || grid.has(key(r - dc, c - dr))) return false;
    }
    const r1 = eq.r + dr * (n - 1), c1 = eq.c + dc * (n - 1);
    return Math.max(box.r1, r1) - Math.min(box.r0, eq.r) < cfg.size &&
      Math.max(box.c1, c1) - Math.min(box.c0, eq.c) < cfg.size;
  }

  function place(eq) {
    const [dr, dc] = dirv(eq.dir), idx = eqs.length;
    eq.refs = eq.cells.map((val, i) => {
      const r = eq.r + dr * i, c = eq.c + dc * i, k = key(r, c);
      const cell = grid.get(k) || { r, c, val };
      cell[eq.dir] = idx;
      grid.set(k, cell);
      return cell;
    });
    const r1 = eq.r + dr * (eq.cells.length - 1), c1 = eq.c + dc * (eq.cells.length - 1);
    box = box
      ? { r0: Math.min(box.r0, eq.r), r1: Math.max(box.r1, r1), c0: Math.min(box.c0, eq.c), c1: Math.max(box.c1, c1) }
      : { r0: eq.r, r1, c0: eq.c, c1 };
    eqs.push(eq);
  }

  const first = genEquation(rand, cfg, terms());
  if (!first) return null;
  place({ dir: rand() < 0.5 ? 'h' : 'v', r: 0, c: 0, cells: first });

  for (let tries = 0; eqs.length < cfg.eqs && tries < 4000; tries++) {
    const open = [...grid.values()].filter((x) => typeof x.val === 'string' && (x.h === undefined || x.v === undefined));
    if (!open.length) break;
    const at = pick(rand, open), dir = at.h === undefined ? 'h' : 'v';
    const cells = genEquation(rand, cfg, terms());
    if (!cells) continue;
    const slots = cells.map((v, i) => i).filter((i) => i % 2 && cells[i] === at.val);
    if (!slots.length) continue;
    const i = pick(rand, slots);
    const eq = { dir, cells, r: dir === 'v' ? at.r - i : at.r, c: dir === 'h' ? at.c - i : at.c };
    if (fits(eq)) place(eq);
  }
  if (eqs.length < Math.ceil(cfg.eqs * 0.8)) return null;

  const cells = [...grid.values()].sort((a, b) => a.r - b.r || a.c - b.c);
  cells.forEach((cell, i) => {
    cell.i = i;
    cell.r -= box.r0;
    cell.c -= box.c0;
    cell.key = cell.r + ',' + cell.c;
    cell.op = typeof cell.val === 'string';
    cell.eqs = [cell.h, cell.v].filter((x) => x !== undefined);
    // crossings are always blank; other operators are sometimes given as footholds
    cell.given = !cell.op || (cell.eqs.length === 1 && rand() < cfg.reveal);
    delete cell.h; delete cell.v;
  });
  return {
    rows: box.r1 - box.r0 + 1,
    cols: box.c1 - box.c0 + 1,
    cells,
    eqs: eqs.map((e) => e.refs.map((c) => c.i)),
    ops: cfg.ops,
  };
}

if (typeof module === 'object') module.exports = { evalExpr, checkEquation, rng, hash, levelConfig, generate };
