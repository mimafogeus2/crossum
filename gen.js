// CrosSum puzzle engine: evaluation, seeded RNG, level configs, generator.
// Plain script (globals in the browser), also require()-able from node for tests.

const OPS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '×': (a, b) => a * b,
  // division must terminate within 2 decimals: 7 ÷ 2 = 3.5 ok, 1 ÷ 3 not
  '÷': (a, b) => { const q = a / b; return b !== 0 && Math.abs(q * 100 - Math.round(q * 100)) < 1e-6 ? q : NaN; },
  '^': (a, b) => (Number.isInteger(b) && b >= 0 && b <= 6 ? a ** b : NaN),
  '%': (a, b) => (Number.isInteger(a) && Number.isInteger(b) && b > 0 ? a % b : NaN),
  // decimal point: 2 . 5 = 2.5, 3 . 25 = 3.25; binds tightest, can't chain
  '.': (a, b) => (Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 ? a + b / 10 ** String(b).length : NaN),
};
const PREC = { '.': 4, '^': 3, '×': 2, '÷': 2, '%': 2, '+': 1, '-': 1 };
const REL = { '=': (l, r) => Math.abs(l - r) < 1e-9, '<': (l, r) => l < r - 1e-9, '>': (l, r) => l > r + 1e-9 };
const FLIP = { '=': '=', '<': '>', '>': '<' };

// Standard precedence, left-to-right within a level. NaN on any invalid step.
// strict: every intermediate must be a whole number (generator, before decimals are introduced).
function evalExpr(nums, ops, strict = false) {
  const n = nums.slice(), o = ops.slice();
  for (const p of [4, 3, 2, 1]) {
    for (let i = 0; i < o.length; ) {
      if (PREC[o[i]] !== p) { i++; continue; }
      const v = OPS[o[i]](n[i], n[i + 1]);
      if (!Number.isFinite(v) || Math.abs(v) > 1e9 || (strict && !Number.isInteger(v))) return NaN;
      n.splice(i, 2, v);
      o.splice(i, 1);
    }
  }
  return n[0];
}

// cells = [num, op, num, op, ..., num]. True iff exactly one of = < > and it holds.
function checkEquation(cells) {
  const rels = cells.filter((c, i) => i % 2 && c in REL);
  if (rels.length !== 1) return false;
  const at = cells.indexOf(rels[0]);
  const side = (s) => evalExpr(s.filter((_, i) => i % 2 === 0), s.filter((_, i) => i % 2));
  const l = side(cells.slice(0, at)), r = side(cells.slice(at + 1));
  return Number.isFinite(l) && Number.isFinite(r) && REL[rels[0]](l, r);
}

// Where the cursor goes after filling cell: the next blank along the equation in progress (eq),
// wrapping within it. Without one, the cell's own equations in order, horizontal first (cell.eqs is [h, v]).
function nextInEquation(p, cell, eq, blank) {
  for (const e of cell.eqs.includes(eq) ? [eq, ...cell.eqs] : cell.eqs) {
    const line = p.eqs[e], at = line.indexOf(cell.i);
    for (let k = 1; k < line.length; k++) {
      const c = p.cells[line[(at + k) % line.length]];
      if (blank(c)) return { cell: c, eq: e };
    }
  }
  return null;
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

// Three packs of 1000 seeded levels. Each ramps across its slice of the difficulty scale over the
// first RAMP levels, then stays at its top difficulty.
// ponytail: flat after the ramp; more headroom needs harder puzzle shapes, not more levels.
const PACK_SIZE = 1000, RAMP = 60;
const PACKS = {
  E: { name: 'Easy', from: 1, to: 8, daily: 4 },
  M: { name: 'Medium', from: 5, to: 18, daily: 11 },
  H: { name: 'Hard', from: 12, to: 28, daily: 22 },
};
const packDifficulty = (pack, n) =>
  Math.round(PACKS[pack].from + (PACKS[pack].to - PACKS[pack].from) * Math.min(1, (n - 1) / (RAMP - 1)));

// Difficulty n: new operators arrive at 3, 6, 12, 14, 18, 22.
function levelConfig(n) {
  const ops = ['+', '-'];
  if (n >= 3) ops.push('×');
  if (n >= 6) ops.push('÷');
  if (n >= 12) ops.push('^');
  if (n >= 14) ops.push('.');
  if (n >= 18) ops.push('%');
  return {
    ops,
    rels: n >= 22 ? ['=', '<', '>'] : ['='],
    ineq: n >= 22 ? 0.3 : 0, // chance a line is an inequality
    eqs: Math.min(12, 1 + Math.ceil(n * 0.6)),
    long: Math.min(0.6, Math.max(0, (n - 3) * 0.07)), // chance of a 3-operand equation
    maxNum: n < 8 ? 9 : n < 15 ? 12 : 20,
    maxResult: n < 3 ? 18 : Math.min(200, 20 + n * 8),
    reveal: Math.max(0.05, 0.9 - n * 0.07), // chance a non-crossing operator is pre-filled
    size: n < 4 ? 7 : n < 9 ? 9 : 11,
  };
}

// A result as cells: 7 -> [7], 3.5 -> [3, '.', 5], 2.25 -> [2, '.', 25]; null if not representable.
function numCells(x) {
  if (Number.isInteger(x)) return [x];
  const c = Math.round(x * 100), f = c % 100;
  if (Math.abs(x * 100 - c) > 1e-6 || (f < 10 && f % 10)) return null;
  return [Math.floor(c / 100), '.', f % 10 ? f : f / 10];
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
      if (op === '.') nums[i + 1] = int(rand, 1, 9);
    });
    if (ops.every((o) => o === '.')) continue; // "3 . 5 = 3 . 5" is no puzzle
    const dec = cfg.ops.includes('.');
    const v = evalExpr(nums, ops, !dec);
    if (!(v >= 0) || v > cfg.maxResult) continue;
    let rel = '=', rhs = v;
    if (cfg.ineq && rand() < cfg.ineq) {
      const k = int(rand, 1, 3);
      if (v - k < 0 || rand() < 0.5) { rel = '<'; rhs = v + k; } else { rel = '>'; rhs = v - k; }
    }
    const side = numCells(rhs);
    if (!side || (!dec && side.length > 1)) continue;
    const expr = nums.flatMap((x, i) => (i ? [ops[i - 1], x] : [x]));
    return rand() < 0.3 ? [...side, FLIP[rel], ...expr] : [...expr, rel, ...side];
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
    rels: cfg.rels,
  };
}

if (typeof module === 'object') module.exports = { evalExpr, checkEquation, nextInEquation, rng, hash, levelConfig, generate, PACKS, PACK_SIZE, packDifficulty };
