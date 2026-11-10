// node test.js — checks the evaluator and that the generator produces valid, well-formed puzzles.
const assert = require('assert');
const { checkEquation, evalExpr, levelConfig, generate, hash, PACKS, PACK_SIZE, packDifficulty } = require('./gen.js');

assert(checkEquation([2, '+', 3, '×', 4, '=', 14]));
assert(checkEquation([12, '=', 3, '×', 4]));
assert(!checkEquation([2, '+', 3, '=', 4, '=', 5]));
assert(!checkEquation([7, '÷', 2, '=', 3]));
assert.strictEqual(evalExpr([2, 3, 2], ['^', '×']), 16);
assert.strictEqual(evalExpr([17, 5, 1], ['%', '+']), 3);
// decimal point
assert(checkEquation([7, '÷', 2, '=', 3, '.', 5]));
assert(checkEquation([1, '.', 5, '×', 4, '=', 6]));
assert(checkEquation([0, '.', 1, '+', 0, '.', 2, '=', 0, '.', 3])); // no float drift
assert(checkEquation([3, '.', 25, '×', 4, '=', 13]));
assert(!checkEquation([1, '.', 2, '.', 3, '=', 1])); // can't chain
assert(!checkEquation([1, '÷', 3, '=', 0, '.', 33])); // 1/3 doesn't terminate
// inequalities
assert(checkEquation([3, '+', 4, '<', 8]));
assert(checkEquation([9, '>', 2, '×', 4]));
assert(!checkEquation([3, '+', 5, '<', 8]));
assert(!checkEquation([3, '<', 4, '=', 4])); // exactly one relation

const keys = [];
for (const k of Object.keys(PACKS)) for (let n = 1; n <= PACK_SIZE; n++) keys.push([k + n, packDifficulty(k, n)]);
for (const k of Object.keys(PACKS)) keys.push(['D' + k + '2026-11-10', PACKS[k].daily]);

const t0 = Date.now(), seen = new Set();
for (const [k, d] of keys) {
  const cfg = levelConfig(d), p = generate(hash(k), cfg);
  const at = new Map(p.cells.map((c) => [c.key, c]));
  for (const eq of p.eqs) assert(checkEquation(eq.map((i) => p.cells[i].val)), k + ' bad eq');
  for (const c of p.cells) {
    if (c.eqs.length > 1) assert(c.op && !c.given, k + ' crossing');
    if (c.op) seen.add(c.val);
  }
  // every maximal run of >=2 cells is exactly one equation (no accidental adjacency)
  const runs = new Set(p.eqs.map((e) => e.join()));
  for (const [dr, dc] of [[0, 1], [1, 0]]) {
    for (const c of p.cells) {
      if (at.has(c.r - dr + ',' + (c.c - dc))) continue;
      const run = [];
      for (let r = c.r, cc = c.c; at.has(r + ',' + cc); r += dr, cc += dc) run.push(at.get(r + ',' + cc).i);
      if (run.length > 1) assert(runs.has(run.join()), k + ' stray run ' + run);
    }
  }
  assert(p.rows <= cfg.size && p.cols <= cfg.size, k + ' too big');
  if (/^([EMH](1|30)$|D)/.test(k)) {
    const blanks = p.cells.filter((c) => c.op && !c.given).length;
    console.log(k.padEnd(14), 'difficulty', String(d).padEnd(3), `${p.eqs.length} eqs`, `${p.cols}x${p.rows}`, `${blanks} blanks`, [...p.ops, ...p.rels].join(' '));
  }
}
for (const op of ['.', '<', '>', '%', '^']) assert(seen.has(op), 'never generated ' + op);
console.log('ok', keys.length, 'puzzles', Date.now() - t0, 'ms');
