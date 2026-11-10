'use strict';
const $ = (s) => document.querySelector(s);
const sym = (v) => (v === '-' ? '−' : String(v));
const KEYS = { '+': '+', '-': '-', '*': '×', x: '×', X: '×', '/': '÷', ':': '÷', '=': '=', '^': '^', '%': '%', '.': '.', ',': '.', '<': '<', '>': '>' };
const NAMES = {
  '+': 'plus', '-': 'minus', '×': 'times', '÷': 'divided by', '^': 'power', '%': 'remainder', '.': 'decimal point',
  '=': 'equals', '<': 'less than', '>': 'greater than',
};
const FIRST_TIP = 'Tap a blank tile, then pick an operator. Every row and column must be <b>true</b>. Where lines cross, <b>one symbol</b> has to work both ways.';
const OP_TIPS = { // shown on the level where an operator first appears
  '×': 'New: <b>×</b> — it happens before + and −.',
  '÷': 'New: <b>÷</b> — division has to come out exact.',
  '^': 'New: <b>^</b> power — 2 ^ 3 = 8, worked out before × and +.',
  '.': 'New: <b>.</b> decimal point — 3 . 5 is 3.5, so 7 ÷ 2 = 3 . 5',
  '%': 'New: <b>%</b> remainder — 7 % 3 = 1.',
  '<': 'New: <b>&lt;</b> and <b>&gt;</b> — some lines are inequalities, like 3 + 4 &lt; 9.',
};
const ICON_ON = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6"/></svg>';
const ICON_ERASE = '<svg viewBox="0 0 24 24"><path d="M9 5h11v14H9l-6-7 6-7zM12 9l5 6M17 9l-5 6"/></svg>';

// ---------- storage ----------
let store = {};
try { store = JSON.parse(localStorage.getItem('crossum2')) || {}; } catch {}
store = { packs: {}, daily: {}, saves: {}, muted: false, seenHelp: false, ...store };
for (const k in PACKS) store.packs[k] ??= { unlocked: 1, stars: {} };
const persist = () => { try { localStorage.setItem('crossum2', JSON.stringify(store)); } catch {} };

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function streak() {
  const d = new Date();
  const any = () => Object.keys(store.daily[ymd(d)] || {}).length > 0; // any difficulty counts
  if (!any()) d.setDate(d.getDate() - 1);
  let n = 0;
  for (; any(); d.setDate(d.getDate() - 1)) n++;
  return n;
}

// ---------- sound (synthesized, no assets) ----------
const sfx = (() => {
  let ctx;
  function tone(freq, { dur = 0.12, type = 'sine', vol = 0.15, at = 0, slide } = {}) {
    if (store.muted) return;
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch {}
  }
  const note = (semi) => 523.25 * 2 ** (semi / 12);
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  return {
    tap: () => tone(880, { dur: 0.04, type: 'triangle', vol: 0.05 }),
    place: () => { tone(440, { dur: 0.09, type: 'triangle', vol: 0.14, slide: 620 }); tone(1240, { dur: 0.05, vol: 0.03, at: 0.02 }); },
    erase: () => tone(360, { dur: 0.1, type: 'triangle', vol: 0.1, slide: 180 }),
    good: (n) => { const s = SCALE[Math.min(n, SCALE.length - 1)]; [0, 4, 7].forEach((d, i) => tone(note(s + d), { dur: 0.3, vol: 0.09, at: i * 0.05 })); },
    bad: () => { tone(196, { dur: 0.22, type: 'square', vol: 0.035, slide: 140 }); tone(185, { dur: 0.22, type: 'square', vol: 0.035, slide: 130 }); },
    hint: () => [12, 19, 24].forEach((s, i) => tone(note(s), { dur: 0.18, vol: 0.06, at: i * 0.07, type: 'triangle' })),
    win: () => [0, 4, 7, 12, 7, 12, 16, 19, 24].forEach((s, i) =>
      tone(note(s), { dur: i === 8 ? 0.9 : 0.22, vol: 0.1, at: i * 0.085, type: i % 2 ? 'triangle' : 'sine' })),
  };
})();

function syncSound() {
  for (const b of document.querySelectorAll('.js-sound')) {
    b.innerHTML = store.muted ? ICON_OFF : ICON_ON;
    b.setAttribute('aria-pressed', String(!store.muted));
  }
}

// ---------- mini boards (logo & help) ----------
function mini(el, rows, blanks = '') {
  el.style.setProperty('--cols', rows[0].length);
  el.style.setProperty('--rows', rows.length);
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '.') return;
    const d = document.createElement('div');
    const isOp = '+-×÷='.includes(ch);
    d.className = 'cell ' + (isOp ? 'op' : 'num');
    if (isOp) Object.assign(d.style, blanks.includes(r + ',' + c)
      ? { border: '2px dashed var(--accent)' }
      : { background: 'var(--op)', color: 'var(--op-ink)', boxShadow: '0 3px 0 var(--op-edge)' });
    if (!blanks.includes(r + ',' + c)) d.textContent = sym(ch);
    d.style.gridArea = `${r + 1} / ${c + 1}`;
    d.style.setProperty('--d', (r + c) * 50 + 'ms');
    el.append(d);
  }));
}

// ---------- screens ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  if (id === 'home') renderHome();
}

function renderHome() {
  const t = ymd(new Date()), recs = store.daily[t] || {}, st = streak();
  $('#daily-meta').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    (st ? `  ·  🔥 ${st}` : '');
  $('#daily-btns').replaceChildren(...Object.entries(PACKS).map(([k, pk]) => {
    const b = document.createElement('button'), r = recs[k];
    b.className = `daily-btn tier-${k}${r ? ' done' : ''}`;
    b.innerHTML = `<b>${pk.name}</b><small>${r ? '✓ ' + fmt(r.t) : store.saves['D' + k + t] ? 'Resume' : 'Play'}</small>`;
    b.onclick = () => start(k, null, t);
    return b;
  }));
  $('#pack-btns').replaceChildren(...Object.entries(PACKS).map(([k, pk]) => {
    const pp = store.packs[k], done = Object.keys(pp.stars).length;
    const b = document.createElement('button');
    b.className = `pack-btn tier-${k}`;
    b.innerHTML = `<span class="pack-name">${pk.name}</span>
      <span class="pack-bar"><i style="width:${(done / PACK_SIZE) * 100}%"></i></span>
      <span class="pack-count">${done}/${PACK_SIZE}</span>`;
    b.setAttribute('aria-label', `${pk.name} pack, ${done} of ${PACK_SIZE} solved`);
    const next = firstUnsolved(pp);
    b.onclick = () => (next ? start(k, next) : openLevels(k));
    return b;
  }));
}

// ---------- game ----------
let G = null, timer = null;
const editable = (c) => c.op && !c.given && !G.hinted.has(c.key);
const valOf = (c) => (c.op && !c.given ? G.fills.get(c.key) : c.val);

// start(pack, n) plays pack level n; start(pack, null, date) plays that day's daily of that difficulty.
function start(pack, n, date = null) {
  const key = date ? 'D' + pack + date : pack + n;
  const diff = date ? PACKS[pack].daily : packDifficulty(pack, n);
  const p = generate(hash(key), levelConfig(diff));
  const s = store.saves[key] || {};
  G = { pack, n, date, key, p, fills: new Map(s.fills), hinted: new Set(s.hinted), elapsed: s.elapsed || 0, sel: null, done: false, states: [] };

  $('#g-title').textContent = date ? `Daily · ${PACKS[pack].name}` : `${PACKS[pack].name} · ${n}`;
  $('#g-sub').textContent = [...p.ops, ...p.rels].map(sym).join(' ');
  if (date) $('#tip').textContent = `One ${PACKS[pack].name.toLowerCase()} puzzle a day — the same for everyone.`;
  else if (n === 1) $('#tip').innerHTML = FIRST_TIP;
  else {
    const prev = levelConfig(packDifficulty(pack, n - 1)), had = [...prev.ops, ...prev.rels];
    const fresh = [...p.ops, ...p.rels].filter((o) => !had.includes(o) && OP_TIPS[o]);
    $('#tip').innerHTML = fresh.map((o) => OP_TIPS[o]).join('<br>');
  }

  buildBoard();
  buildPalette();
  show('game');
  G.sel = nextEmpty(null);
  refresh(false);
  $('#timer').textContent = fmt(G.elapsed);
  clearInterval(timer);
  timer = setInterval(tick, 1000);
}

function buildBoard() {
  const b = $('#board');
  b.replaceChildren();
  b.className = 'board';
  b.style.setProperty('--cols', G.p.cols);
  b.style.setProperty('--rows', G.p.rows);
  for (const cell of G.p.cells) {
    const edit = cell.op && !cell.given;
    const el = document.createElement(edit ? 'button' : 'div');
    el.className = `cell ${cell.op ? 'op' : 'num'}${cell.given ? ' given' : ''}${String(cell.val).length > 2 ? ' long' : ''}`;
    el.style.gridArea = `${cell.r + 1} / ${cell.c + 1}`;
    el.style.setProperty('--d', (cell.r + cell.c) * 28 + 'ms');
    if (!edit) el.textContent = sym(cell.val);
    cell.el = el;
    b.append(el);
  }
  G.states = G.p.eqs.map(() => 'open');
}

function buildPalette() {
  const pal = $('#palette');
  pal.replaceChildren();
  for (const op of [...G.p.ops, ...G.p.rels]) {
    const k = document.createElement('button');
    k.className = 'key' + (G.p.rels.includes(op) ? ' eq' : '');
    k.textContent = sym(op);
    k.dataset.op = op;
    k.setAttribute('aria-label', NAMES[op]);
    k.onclick = () => place(op);
    pal.append(k);
  }
  const e = document.createElement('button');
  e.className = 'key erase';
  e.innerHTML = ICON_ERASE;
  e.setAttribute('aria-label', 'Clear tile');
  e.onclick = () => place(null);
  pal.append(e);
}

function refresh(sound) {
  const { p } = G, prev = G.states;
  const states = p.eqs.map((eq) => {
    const v = eq.map((i) => valOf(p.cells[i]));
    return v.includes(undefined) ? 'open' : checkEquation(v) ? 'ok' : 'bad';
  });
  G.states = states;
  if (sound) {
    const fresh = (s) => states.some((x, i) => x === s && prev[i] !== s);
    if (fresh('bad')) sfx.bad();
    else if (fresh('ok')) sfx.good(states.filter((s) => s === 'ok').length - 1);
  }
  const selEqs = G.sel ? G.sel.eqs : [];
  for (const cell of p.cells) {
    const st = cell.eqs.map((e) => states[e]), el = cell.el;
    el.classList.toggle('ok', st.every((s) => s === 'ok'));
    el.classList.toggle('bad', st.includes('bad'));
    el.classList.toggle('hl', !G.done && cell.eqs.some((e) => selEqs.includes(e)));
    el.classList.toggle('sel', !G.done && cell === G.sel);
    if (cell.op && !cell.given) {
      const v = G.fills.get(cell.key);
      el.textContent = v ? sym(v) : '';
      el.classList.toggle('filled', !!v);
      el.classList.toggle('hinted', G.hinted.has(cell.key));
      el.setAttribute('aria-label', v ? NAMES[v] : 'empty tile');
    }
    if (sound && cell.eqs.some((e) => states[e] === 'bad' && prev[e] !== 'bad')) flash(el, 'shake');
  }
  if (!G.done && states.every((s) => s === 'ok')) win();
}

function flash(el, cls) {
  el.classList.remove('pop', 'shake');
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function nextEmpty(from) {
  const cells = G.p.cells.filter((c) => editable(c));
  const start = from ? cells.findIndex((c) => c.i > from.i) : 0;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[(Math.max(start, 0) + k) % cells.length];
    if (!G.fills.has(c.key)) return c;
  }
  return null;
}

function place(op) {
  if (!G || G.done) return;
  if (!G.sel || !editable(G.sel)) G.sel = nextEmpty(null);
  const cell = G.sel;
  if (!cell) return;
  if (op) {
    G.fills.set(cell.key, op);
    sfx.place();
    flash(cell.el, 'pop');
    G.sel = nextEmpty(cell) || cell;
  } else {
    if (!G.fills.delete(cell.key)) return;
    sfx.erase();
  }
  refresh(true);
  saveGame();
}

function move(dr, dc) {
  const s = G.sel;
  if (!s) return;
  let best = null, bs = Infinity;
  for (const c of G.p.cells) {
    if (!editable(c) || c === s) continue;
    const along = (c.r - s.r) * dr + (c.c - s.c) * dc;
    if (along <= 0) continue;
    const score = along + 2 * (Math.abs(c.r - s.r) * Math.abs(dc) + Math.abs(c.c - s.c) * Math.abs(dr));
    if (score < bs) { bs = score; best = c; }
  }
  if (best) { G.sel = best; sfx.tap(); refresh(false); }
}

function hint() {
  if (!G || G.done) return;
  const wrong = G.p.cells.filter((c) => editable(c) && G.fills.get(c.key) !== c.val);
  const c = wrong.includes(G.sel) ? G.sel : wrong[Math.floor(Math.random() * wrong.length)];
  if (!c) return;
  G.fills.set(c.key, c.val);
  G.hinted.add(c.key);
  sfx.hint();
  flash(c.el, 'pop');
  G.sel = nextEmpty(c);
  refresh(true);
  saveGame();
}

function reset() {
  if (!G || G.done || !G.fills.size) return;
  if (!confirm('Clear all the tiles you placed?')) return;
  for (const k of [...G.fills.keys()]) if (!G.hinted.has(k)) G.fills.delete(k);
  sfx.erase();
  G.sel = nextEmpty(null);
  refresh(false);
  saveGame();
}

function saveGame() {
  if (G.done) return;
  store.saves[G.key] = { fills: [...G.fills], hinted: [...G.hinted], elapsed: G.elapsed };
  persist();
}

function tick() {
  if (!G || G.done || document.hidden || $('#game').hidden || document.querySelector('dialog[open]')) return;
  G.elapsed++;
  $('#timer').textContent = fmt(G.elapsed);
  if (G.elapsed % 5 === 0) saveGame();
}

function win() {
  G.done = true;
  clearInterval(timer);
  delete store.saves[G.key];
  const h = G.hinted.size, stars = h === 0 ? 3 : h <= 2 ? 2 : 1;
  if (G.date) ((store.daily[G.date] ??= {})[G.pack] ??= { t: G.elapsed, h });
  else {
    const pp = store.packs[G.pack];
    pp.stars[G.n] = Math.max(pp.stars[G.n] || 0, stars);
    pp.unlocked = Math.max(pp.unlocked, Math.min(G.n + 1, PACK_SIZE));
  }
  persist();
  $('#board').classList.add('solved');
  sfx.win();
  confetti();

  const g = G;
  setTimeout(() => {
    if (G !== g) return;
    $('#win-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}" style="--i:${i}">★</span>`).join('');
    $('#win-title').textContent = ['Brilliant!', 'Solved!', 'Nicely done!', 'Sharp!'][Math.floor(Math.random() * 4)];
    const st = streak();
    $('#win-stats').innerHTML = `<b>${fmt(g.elapsed)}</b> · ${h ? `${h} hint${h > 1 ? 's' : ''}` : 'no hints'}` +
      (g.date && st ? ` · 🔥 ${st}-day streak` : '');
    const last = !g.date && g.n === PACK_SIZE;
    if (last) $('#win-title').textContent = `${PACKS[g.pack].name} pack complete!`;
    $('#win-next').hidden = last;
    $('#win-next b').textContent = g.date ? 'Share result' : `Level ${g.n + 1}  →`;
    $('#dlg-win').showModal();
  }, 1100);
}

async function share() {
  const r = store.daily[G.date][G.pack];
  const text = `CrosSum daily · ${G.date} · ${PACKS[G.pack].name}\n⏱ ${fmt(r.t)}  ${r.h ? '💡'.repeat(r.h) : '⭐ no hints'}` +
    (location.protocol.startsWith('http') ? '\n' + location.origin + location.pathname : '');
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); $('#win-next b').textContent = 'Copied ✓'; }
  } catch {}
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#fx'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const colors = ['--op', '--accent', '--gold', '--ok'].map((v) => css.getPropertyValue(v).trim());
  const glyphs = ['+', '−', '×', '÷', '='];
  const parts = Array.from({ length: 150 }, (_, i) => ({
    x: W / 2 + (Math.random() - 0.5) * 80, y: H * 0.42,
    vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 5,
    s: 6 + Math.random() * 7, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
    c: colors[i % colors.length], g: i % 3 === 0 ? glyphs[i % glyphs.length] : null,
  }));
  const t0 = performance.now();
  (function frame(now) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.38; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      if (p.g) { ctx.font = `700 ${p.s * 2.6}px Outfit, sans-serif`; ctx.fillText(p.g, 0, 0); }
      else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (now - t0 < 3500) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  })(t0);
}

// 50 levels per page; opens on the page holding the first unsolved level.
const PAGE = 50;
const firstUnsolved = (pp) => Array.from({ length: pp.unlocked }, (_, i) => i + 1).find((n) => !pp.stars[n]);
function openLevels(pack = store.lastPack || 'E', page) {
  store.lastPack = pack;
  $('#pack-tabs').replaceChildren(...Object.entries(PACKS).map(([k, pk]) => {
    const t = document.createElement('button');
    t.className = `tab tier-${k}`;
    t.textContent = pk.name;
    t.setAttribute('aria-selected', String(k === pack));
    t.onclick = () => openLevels(k);
    return t;
  }));
  const pp = store.packs[pack], grid = $('#level-grid');
  const lastPage = Math.floor((pp.unlocked - 1) / PAGE);
  page ??= Math.floor(((firstUnsolved(pp) || pp.unlocked) - 1) / PAGE);
  const from = page * PAGE + 1, to = Math.min(from + PAGE - 1, PACK_SIZE);
  $('#pg-label').textContent = `${from}–${to}`;
  $('#pg-prev').disabled = page === 0;
  $('#pg-next').disabled = page >= lastPage;
  $('#pg-prev').onclick = () => openLevels(pack, page - 1);
  $('#pg-next').onclick = () => openLevels(pack, page + 1);
  grid.className = `level-grid tier-${pack}`;
  grid.replaceChildren();
  for (let n = from; n <= to; n++) {
    const b = document.createElement('button'), s = pp.stars[n] || 0;
    b.className = 'lvl' + (n === pp.unlocked && !s ? ' current' : '');
    b.disabled = n > pp.unlocked;
    b.innerHTML = `<span>${n}</span><small>${b.disabled ? '🔒' : s ? '★'.repeat(s) + '☆'.repeat(3 - s) : ''}</small>`;
    b.setAttribute('aria-label', `Level ${n}${b.disabled ? ', locked' : s ? `, ${s} stars` : ''}`);
    b.onclick = () => { $('#dlg-levels').close(); start(pack, n); };
    grid.append(b);
  }
  if (!$('#dlg-levels').open) $('#dlg-levels').showModal();
  grid.querySelector('.current')?.scrollIntoView({ block: 'center' });
}

// ---------- wiring ----------
$('#btn-levels').onclick = () => openLevels();
$('#btn-help').onclick = () => $('#dlg-help').showModal();
$('#btn-back').onclick = () => { if (G && !G.done) saveGame(); clearInterval(timer); show('home'); };
// Tiles get small on big boards, so a tap anywhere near a blank selects the nearest one.
$('.board-wrap').addEventListener('click', (e) => {
  if (!G || G.done) return;
  const direct = G.p.cells.find((c) => c.el === e.target.closest('.cell'));
  let best = direct && editable(direct) ? direct : null, bd = best ? 0 : Infinity;
  if (!best && e.detail) {
    for (const c of G.p.cells) {
      if (!editable(c)) continue;
      const r = c.el.getBoundingClientRect();
      const d = Math.hypot(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2) / Math.max(r.width, 1);
      if (d < bd) { bd = d; best = c; }
    }
  }
  if (best && bd < 1.6 && best !== G.sel) { G.sel = best; sfx.tap(); refresh(false); }
});
$('#btn-hint').onclick = hint;
$('#btn-reset').onclick = reset;
$('#win-home').onclick = () => { $('#dlg-win').close(); show('home'); };
$('#win-next').onclick = () => {
  if (G.date) share(); else { $('#dlg-win').close(); start(G.pack, G.n + 1); }
};
$('#dlg-help').addEventListener('close', () => { store.seenHelp = true; persist(); });
for (const b of document.querySelectorAll('.js-sound')) b.onclick = () => { store.muted = !store.muted; persist(); syncSound(); sfx.tap(); };

document.addEventListener('keydown', (e) => {
  if (!G || $('#game').hidden || document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const op = KEYS[e.key];
  const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (op && [...G.p.ops, ...G.p.rels].includes(op)) {
    place(op);
    const k = $(`.key[data-op="${op}"]`);
    if (k) { k.classList.add('press'); setTimeout(() => k.classList.remove('press'), 100); }
  } else if (e.key === 'Backspace' || e.key === 'Delete') place(null);
  else if (arrows[e.key]) move(...arrows[e.key]);
  else if (e.key === 'Escape') return $('#btn-back').click();
  else return;
  e.preventDefault();
});

mini($('#logo'), ['.5.8.', '4+3=7', '.1.1.', '.=.+.', '.6.7.']);
mini($('#help-grid'), ['.2...', '3+5=8', '.4...', '.=...', '.6...'], ['1,1', '1,3']);
syncSound();
show('home');
if (!store.seenHelp) $('#dlg-help').showModal();
