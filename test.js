// node test.js — checks the generator produces valid, well-formed puzzles.
const assert = require('assert');
const { checkEquation, evalExpr, levelConfig, generate, hash } = require('./gen.js');

assert(checkEquation([2, '+', 3, '×', 4, '=', 14]));
assert(checkEquation([12, '=', 3, '×', 4]));
assert(!checkEquation([2, '+', 3, '=', 4, '=', 5]));
assert(!checkEquation([7, '÷', 2, '=', 3]));
assert.strictEqual(evalExpr([2, 3, 2], ['^', '×']), 16);
assert.strictEqual(evalExpr([17, 5, 1], ['%', '+']), 3);

const keys = [...Array(40)].map((_, i) => 'L' + (i + 1)).concat(['D2026-11-10', 'D2026-11-15', 'D2027-01-01']);
const t0 = Date.now();
for (const k of keys) {
  const n = k[0] === 'L' ? +k.slice(1) : 14;
  const cfg = levelConfig(n), p = generate(hash(k), cfg);
  const at = new Map(p.cells.map((c) => [c.key, c]));
  // each equation is solved by the reference solution
  for (const eq of p.eqs) assert(checkEquation(eq.map((i) => p.cells[i].val)), k + ' bad eq');
  // crossings are blank operators
  for (const c of p.cells) if (c.eqs.length > 1) assert(c.op && !c.given, k + ' crossing');
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
  const blanks = p.cells.filter((c) => c.op && !c.given).length;
  console.log(k.padEnd(12), `${p.eqs.length}/${cfg.eqs} eqs`, `${p.cols}x${p.rows}`, `${blanks} blanks`);
}
console.log('ok', Date.now() - t0, 'ms');
