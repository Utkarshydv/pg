/*
 * Merge the Photos
 *
 * Rules (reverse-engineered from the screen recording):
 *  - 3x3 board that starts completely full of level-1 photos.
 *  - Drag ONE photo one cell up/down/left/right.
 *      · onto an empty cell      -> it just slides there
 *      · onto the same level     -> both merge into the next level (at the target cell)
 *      · onto a different level  -> blocked, the photo bounces back
 *  - When no two photos of the same level are left on the board, every empty
 *    cell is refilled with fresh level-1 photos (a new "round").
 *  - The last level ends the game and is left alone in the centre.
 *
 * The math: a merge turns two level-n photos into one level-(n+1) photo, so
 * the "value" of the board (a level-n photo is worth 2^(n-1) level-1 photos)
 * never changes by merging. Players merge up to the second-last photo (level 7)
 * and the game hands out exactly 2^6 = 64 level-1 photos in total, then stops
 * refilling. 64 photos merge down to ONE level-7 photo (63 merges) with
 * NOTHING left over, and that last photo then morphs into the final (8th) one.
 * (8 photos with pure pair-merging would need 128 tiles / 127 merges.)
 */
(() => {
  'use strict';

  const IMAGES = [
    'images/pout.png',     // 1
    'images/frown.png',    // 2
    'images/bed.png',      // 3  lying on bed using phone
    'images/bluetee.png',  // 4  blue t-shirt
    'images/monkey.png',   // 5
    'images/saree.png',    // 6  red saree
    'images/couple.png',   // 7  second last
    'images/selfie.png',   // 8  final
  ];
  const MAX = IMAGES.length;
  const MERGE_CAP = MAX - 1;              // highest level reachable by merging (the 2nd-last photo)
  const TOTAL_L1 = 2 ** (MAX - 2);        // level-1 photos handed out over the whole game (64)
  const N = 3;
  const CELLS = N * N;

  let speed = 1;                          // tests set this near 0 to run fast
  const ms = (v) => Math.round(v * speed);
  const SLIDE_MS = 180;
  const POP_MS = 300;
  const SPAWN_STAGGER = 45;
  const WIN_STEP = [250, 750, 1500];

  const DIRS = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };

  const board = document.getElementById('board');
  const stage = document.getElementById('stage');
  const winEl = document.getElementById('win');
  const againBtn = document.getElementById('again');
  const progress = document.getElementById('progress');

  /** @type {({id:number, level:number, el:HTMLElement, idx:number}|null)[]} */
  let cells = new Array(CELLS).fill(null);
  let busy = false;
  let won = false;
  let selected = -1;
  let drag = null;
  let timers = [];
  let spawned = 0;                        // level-1 photos handed out so far
  let merges = 0;

  IMAGES.forEach((src) => { const i = new Image(); i.src = src; });   // preload

  /* ---------- helpers ---------- */
  const later = (fn, t) => { const id = setTimeout(fn, ms(t)); timers.push(id); return id; };
  const rc = (idx) => [Math.floor(idx / N), idx % N];
  const targetOf = (from, dir) => {
    const [r, c] = rc(from);
    const [dr, dc] = DIRS[dir];
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= N || nc < 0 || nc >= N) return -1;
    return nr * N + nc;
  };
  const dirBetween = (from, to) => {
    for (const d of Object.keys(DIRS)) if (targetOf(from, d) === to) return d;
    return null;
  };
  const neighbours = (i) => Object.keys(DIRS).map((d) => targetOf(i, d)).filter((j) => j >= 0);
  const valueOf = (level) => 2 ** (level - 1);

  /* ---------- progress strip (built from IMAGES) ---------- */
  const steps = IMAGES.map((src, i) => {
    const s = document.createElement('div');
    s.className = 'step' + (i === 0 ? ' on' : '');
    s.dataset.level = i + 1;
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Level ' + (i + 1);
    s.appendChild(img);
    progress.appendChild(s);
    return s;
  });
  function markProgress(level, flash) {
    steps.forEach((s) => { if (+s.dataset.level <= level) s.classList.add('on'); });
    if (flash) {
      const s = steps[level - 1];
      s.classList.add('just');
      setTimeout(() => s.classList.remove('just'), 350);
    }
  }
  function resetProgress() {
    steps.forEach((s) => s.classList.toggle('on', s.dataset.level === '1'));
  }
  document.getElementById('win-img').src = IMAGES[MAX - 1];

  /* ---------- DOM: slots + tiles ---------- */
  for (let i = 0; i < CELLS; i++) {
    const s = document.createElement('div');
    s.className = 'slot';
    s.dataset.idx = i;
    stage.appendChild(s);
  }

  function place(tile, idx, dx = 0, dy = 0) {
    const [r, c] = rc(idx);
    tile.idx = idx;
    tile.el.style.setProperty('--r', r);
    tile.el.style.setProperty('--c', c);
    tile.el.style.setProperty('--dx', dx + 'px');
    tile.el.style.setProperty('--dy', dy + 'px');
  }

  let nextId = 1;
  function createTile(level, idx, anim) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.level = level;
    const face = document.createElement('div');
    face.className = 'face' + (anim ? ' spawn' : '');
    const img = document.createElement('img');
    img.src = IMAGES[level - 1];
    img.alt = '';
    img.draggable = false;
    face.appendChild(img);
    el.appendChild(face);
    const tile = { id: nextId++, level, el, idx };
    el._tile = tile;
    place(tile, idx);
    stage.appendChild(el);
    cells[idx] = tile;
    return tile;
  }

  function setLevel(tile, level) {
    tile.level = level;
    tile.el.dataset.level = level;
    const face = tile.el.firstChild;
    face.firstChild.src = IMAGES[level - 1];
    face.classList.remove('pop', 'spawn');
    void face.offsetWidth;            // restart the CSS animation
    face.classList.add('pop');
  }

  function clearBoard() {
    timers.forEach(clearTimeout);
    timers = [];
    stage.querySelectorAll('.tile').forEach((t) => t.remove());
    cells = new Array(CELLS).fill(null);
    busy = false;
    drag = null;
    selected = -1;
  }

  /* ---------- game flow ---------- */
  function newGame() {
    clearBoard();
    won = false;
    merges = 0;
    winEl.hidden = true;
    resetProgress();
    spawned = CELLS;                                  // the opening board
    for (let i = 0; i < CELLS; i++) {
      const t = createTile(1, i, true);
      t.el.firstChild.style.animationDelay = ms(i * 30) + 'ms';
    }
    busy = true;
    later(() => { busy = false; }, CELLS * 30 + POP_MS);
  }

  function select(idx) {
    if (selected >= 0 && cells[selected]) cells[selected].el.classList.remove('selected');
    selected = idx;
    if (idx >= 0 && cells[idx]) cells[idx].el.classList.add('selected');
  }

  /** Try to move the tile in `from` one step in `dir`. Returns what happened. */
  function move(from, dir) {
    if (busy || won) return 'busy';
    const a = cells[from];
    if (!a) return 'none';
    select(-1);
    const to = targetOf(from, dir);
    const b = to >= 0 ? cells[to] : null;

    if (to >= 0 && !b) {                       // slide into an empty cell
      a.el.classList.remove('dragging');
      cells[from] = null;
      cells[to] = a;
      place(a, to);
      busy = true;
      later(() => { busy = false; }, SLIDE_MS);
      return 'move';
    }

    if (to >= 0 && b.level === a.level && a.level < MERGE_CAP) {   // merge
      busy = true;
      a.el.classList.remove('dragging');
      a.el.classList.add('merging');
      cells[from] = null;
      place(a, to);
      later(() => {
        a.el.remove();
        setLevel(b, b.level + 1);
        merges++;
        markProgress(b.level, true);
        busy = false;
        afterMerge();
      }, SLIDE_MS);
      return 'merge';
    }

    bounce(a, from, dir);                       // blocked
    return 'blocked';
  }

  function bounce(tile, idx, dir) {
    busy = true;
    const [dr, dc] = DIRS[dir];
    tile.el.classList.remove('dragging');
    tile.el.classList.add('nudge');
    place(tile, idx, dc * 14, dr * 14);
    later(() => { place(tile, idx); }, 90);
    later(() => { tile.el.classList.remove('nudge'); busy = false; }, 90 + SLIDE_MS);
  }

  function snapBack(tile) {
    tile.el.classList.remove('dragging');
    place(tile, tile.idx);
  }

  function afterMerge() {
    if (cells.some((t) => t && t.level === MAX)) { win(); return; }
    const top = cells.find((t) => t && t.level === MERGE_CAP);
    if (top) { finale(top); return; }            // 64 tiles merged into one: time for the last photo
    const counts = new Array(MAX + 1).fill(0);
    cells.forEach((t) => { if (t) counts[t.level]++; });
    if (!counts.some((n) => n >= 2)) refill();   // nothing left to merge -> new round
  }

  /* Which empty cells get a fresh level-1 photo this round.
     Fill every empty cell (as in the video) as long as the supply lasts, but
     never produce a completely full board in which nothing can move or merge. */
  function planRefill() {
    const empties = [];
    cells.forEach((t, i) => { if (!t) empties.push(i); });
    const supply = TOTAL_L1 - spawned;
    const n = Math.min(empties.length, supply);
    if (n <= 0) return [];
    const occupied = cells.filter(Boolean).length;

    const levelAt = (i, combo) => (combo.includes(i) ? 1 : (cells[i] ? cells[i].level : 0));
    const hasAdjacentPair = (combo) => {
      for (let i = 0; i < CELLS; i++) {
        const l = levelAt(i, combo);
        if (l && l < MERGE_CAP && neighbours(i).some((j) => j > i && levelAt(j, combo) === l)) return true;
      }
      return false;
    };
    const combos = (arr, k, start = 0, cur = [], out = []) => {
      if (cur.length === k) { out.push(cur.slice()); return out; }
      for (let i = start; i < arr.length; i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); }
      return out;
    };
    for (let k = n; k >= 1; k--) {
      const list = combos(empties, k);
      const withPair = list.find(hasAdjacentPair);
      if (withPair) return withPair;
      if (occupied + k < CELLS) return list[0];      // there is a hole, so tiles can still be slid together
    }
    return [];
  }

  function refill() {
    const plan = planRefill();
    if (!plan.length) return;
    busy = true;
    spawned += plan.length;
    plan.forEach((i, k) => {
      later(() => {
        const t = createTile(1, i, true);
        t.el.firstChild.style.animationDelay = '0ms';
      }, k * SPAWN_STAGGER);
    });
    later(() => { busy = false; }, plan.length * SPAWN_STAGGER + POP_MS);
  }

  function finale(top) {
    // The couple photo is alone on the board (the exact supply guarantees it).
    // After a beat it morphs into the very last photo.
    won = true;
    busy = true;
    later(() => {
      setLevel(top, MAX);
      markProgress(MAX, true);
      later(win, 700);
    }, 800);
  }

  function win() {
    // With the exact supply nothing is left over. If anything ever were
    // (it cannot happen), it fades away so the final photo is truly alone.
    won = true;
    busy = true;
    const final = cells.find((t) => t && t.level === MAX);
    final.el.classList.add('final');
    later(() => {
      cells.forEach((t) => { if (t && t !== final) t.el.classList.add('vanish'); });
    }, WIN_STEP[0]);
    later(() => {
      cells.forEach((t, i) => { if (t && t !== final) { t.el.remove(); cells[i] = null; } });
      const centre = Math.floor(CELLS / 2);
      if (final.idx !== centre) {
        cells[final.idx] = null;
        cells[centre] = final;
        place(final, centre);
      }
    }, WIN_STEP[1]);
    later(() => { winEl.hidden = false; busy = false; }, WIN_STEP[2]);
  }

  /* ---------- input: drag / tap / keyboard ---------- */
  const stepSize = () => {
    const t = stage.querySelector('.tile');
    const w = t ? t.offsetWidth : stage.clientWidth / 3;
    return w + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--g') || 4);
  };

  function neighbourTap(idx) {
    // tap-to-select, then tap an adjacent cell
    if (selected >= 0 && selected !== idx) {
      const dir = dirBetween(selected, idx);
      if (dir) { move(selected, dir); return; }
    }
    if (idx >= 0 && cells[idx]) select(selected === idx ? -1 : idx);
    else select(-1);
  }

  stage.addEventListener('pointerdown', (e) => {
    if (busy || won) return;
    const tileEl = e.target.closest('.tile');
    if (!tileEl) {
      const slot = e.target.closest('.slot');
      if (slot) neighbourTap(+slot.dataset.idx);
      return;
    }
    const tile = tileEl._tile;
    drag = {
      tile, idx: tile.idx, pid: e.pointerId,
      sx: e.clientX, sy: e.clientY, t0: performance.now(),
      axis: null, ox: 0, oy: 0, moved: false,
    };
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      drag.moved = true;
      select(-1);
      drag.tile.el.classList.add('dragging');
    }
    const step = stepSize();
    let ox = 0, oy = 0;
    if (drag.axis === 'x') {
      ox = Math.max(-step, Math.min(step, dx));
      if (targetOf(drag.idx, ox > 0 ? 'right' : 'left') < 0) ox *= 0.2;   // rubber band at the edge
    } else {
      oy = Math.max(-step, Math.min(step, dy));
      if (targetOf(drag.idx, oy > 0 ? 'down' : 'up') < 0) oy *= 0.2;
    }
    drag.ox = ox; drag.oy = oy;
    place(drag.tile, drag.idx, ox, oy);
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    if (!d.moved) { neighbourTap(d.idx); return; }

    const step = stepSize();
    const off = d.axis === 'x' ? d.ox : d.oy;
    const quick = performance.now() - d.t0 < 300 && Math.abs(off) > 14;
    if (e.type !== 'pointercancel' && (Math.abs(off) > step * 0.3 || quick)) {
      const dir = d.axis === 'x' ? (off > 0 ? 'right' : 'left') : (off > 0 ? 'down' : 'up');
      move(d.idx, dir);
    } else {
      snapBack(d.tile);
    }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const dir = map[e.key];
    if (!dir || selected < 0) return;
    e.preventDefault();
    move(selected, dir);
  });

  againBtn.addEventListener('click', newGame);

  /* ---------- hooks used by the automated tests ---------- */
  window.__mergeGame = {
    MAX, MERGE_CAP, TOTAL_L1,
    levels: () => cells.map((t) => (t ? t.level : 0)),
    isBusy: () => busy,
    isWon: () => won,
    spawned: () => spawned,
    merges: () => merges,
    setSpeed: (v) => { speed = v; },
    move,
    newGame,
    /** Replace the board with an exact layout (0 = empty). No animation.
        Supply is set so that the tiles on the board count as already handed out. */
    set(levels) {
      clearBoard();
      won = false;
      merges = 0;
      winEl.hidden = true;
      resetProgress();
      levels.forEach((lv, i) => { if (lv) createTile(lv, i, false); });
      spawned = levels.reduce((s, lv) => s + (lv ? valueOf(lv) : 0), 0);
      markProgress(Math.max(1, ...levels), false);
    },
  };

  newGame();
})();
