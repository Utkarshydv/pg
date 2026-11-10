/*
 * End-to-end tests for the merge game.
 *   node tests/run.js            (needs the `playwright` package + a Chromium)
 * Serves the site from the parent folder, drives it with REAL mouse / touch
 * input and checks every mechanic. Screenshots go to tests/screenshots/.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const ORDER = ['pout', 'frown', 'bed', 'bluetee', 'monkey', 'saree', 'couple', 'selfie'];
const MAX = ORDER.length;               // 8
const CAP = MAX - 1;                    // highest level reachable by merging (couple)
const TOTAL = 2 ** (MAX - 2);           // 64 level-1 photos over the whole game
const ONLY_FINAL = [0, 0, 0, 0, MAX, 0, 0, 0, 0];

let passed = 0, failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? passed++ : failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => eq(name, !!cond, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const levels = () => page.evaluate(() => window.__mergeGame.levels());
  const settle = async () => { await page.waitForFunction(() => !window.__mergeGame.isBusy(), null, { timeout: 10000 }); await sleep(20); };
  const set = async (arr) => { await page.evaluate((a) => window.__mergeGame.set(a), arr); await sleep(30); };
  const cellCentre = async (i) => {
    const b = await page.locator('#stage').boundingBox();
    const g = 4, c = (b.width - 2 * g) / 3;
    return { x: b.x + (i % 3) * (c + g) + c / 2, y: b.y + Math.floor(i / 3) * (c + g) + c / 2, c };
  };
  const DELTA = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const dragMouse = async (from, dir) => {
    const s = await cellCentre(from);
    const [dx, dy] = DELTA[dir];
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x + dx * s.c * 0.5, s.y + dy * s.c * 0.5, { steps: 3 });
    await page.mouse.move(s.x + dx * s.c * 0.9, s.y + dy * s.c * 0.9, { steps: 3 });
    await page.mouse.up();
    await settle();
  };

  await page.goto(url);
  await settle();

  console.log('\n[1] Loading & start state');
  eq('9 tiles on board, all level 1', await levels(), [1, 1, 1, 1, 1, 1, 1, 1, 1]);
  eq('game is configured for 8 photos / 64 level-1 tiles', await page.evaluate(() => [window.__mergeGame.MAX, window.__mergeGame.TOTAL_L1]), [MAX, TOTAL]);
  const imgs = await page.evaluate(() => [...document.querySelectorAll('#progress img')].map((i) => [i.getAttribute('src'), i.complete && i.naturalWidth > 0]));
  eq('all 8 photos load, in the requested order', imgs, ORDER.map((n) => [`images/${n}.png`, true]));
  eq('start board shows only the pout photo', await page.$$eval('.tile img', (a) => [...new Set(a.map((i) => i.getAttribute('src')))]), ['images/pout.png']);
  eq('supply used at start = 9', await page.evaluate(() => window.__mergeGame.spawned()), 9);
  await page.screenshot({ path: path.join(SHOTS, '1-start.png') });

  console.log('\n[2] Merge: drag a tile onto an equal neighbour');
  await dragMouse(0, 'right');
  eq('0 -> 1 merges: source empty, target level 2', (await levels()).slice(0, 3), [0, 2, 1]);
  eq('only that pair merged (7 other level-1 tiles untouched)', (await levels()).filter((l) => l === 1).length, 7);
  eq('merged tile now shows the frown photo', await page.$eval('.tile[data-level="2"] img', (i) => i.getAttribute('src')), 'images/frown.png');
  await page.screenshot({ path: path.join(SHOTS, '2-after-first-merge.png') });

  console.log('\n[3] Blocked move onto a different level');
  const before = await levels();
  await dragMouse(1, 'right');
  eq('different levels do not merge or swap', await levels(), before);

  console.log('\n[4] Move into an empty cell');
  await dragMouse(1, 'left');
  eq('level-2 tile slides into empty cell 0', (await levels()).slice(0, 3), [2, 0, 1]);

  console.log('\n[5] Edge of the board');
  const b5 = await levels();
  await dragMouse(0, 'left');
  eq('dragging off the board does nothing', await levels(), b5);

  console.log('\n[6] Short drag snaps back');
  {
    const s = await cellCentre(2);
    await page.mouse.move(s.x, s.y); await page.mouse.down();
    await page.mouse.move(s.x - s.c * 0.1, s.y, { steps: 3 });
    await sleep(400);
    await page.mouse.up(); await settle();
    eq('tiny slow drag cancels the move', await levels(), b5);
  }

  console.log('\n[7] Vertical merge, tap-select then tap neighbour, keyboard');
  await set([1, 0, 0, 1, 0, 0, 2, 2, 0]);
  await dragMouse(0, 'down');
  eq('vertical merge works', await levels(), [0, 0, 0, 2, 0, 0, 2, 2, 0]);
  await set([2, 0, 0, 0, 1, 1, 0, 0, 2]);
  const t4 = await cellCentre(4), t5 = await cellCentre(5);
  await page.mouse.click(t4.x, t4.y);
  ok('tap selects a tile', await page.$('.tile.selected'));
  await page.mouse.click(t5.x, t5.y); await settle();
  eq('tap neighbour merges selected tile into it', await levels(), [2, 0, 0, 0, 0, 2, 0, 0, 2]);
  await set([0, 0, 0, 0, 2, 0, 0, 0, 0]);
  const tc = await cellCentre(4);
  await page.mouse.click(tc.x, tc.y);
  await page.keyboard.press('ArrowUp'); await settle();
  eq('arrow key moves the selected tile', await levels(), [0, 2, 0, 0, 0, 0, 0, 0, 0]);

  console.log('\n[8] Refill when no pairs remain');
  await set([2, 2, 1, 0, 0, 0, 0, 0, 0]);
  await dragMouse(0, 'right');
  await page.waitForFunction(() => window.__mergeGame.levels().every((l) => l > 0), null, { timeout: 8000 });
  await settle();
  eq('all empty cells refilled with level 1', await levels(), [1, 3, 1, 1, 1, 1, 1, 1, 1]);
  await page.screenshot({ path: path.join(SHOTS, '3-after-refill.png') });

  console.log('\n[9] No refill while a pair still exists');
  await set([1, 1, 2, 2, 0, 0, 0, 0, 0]);
  await dragMouse(0, 'right');
  await sleep(700);
  eq('board is not refilled when merges remain', await levels(), [0, 2, 2, 2, 0, 0, 0, 0, 0]);

  console.log('\n[10] Supply is exact: the refill never over-spawns');
  // value on board = 63 (levels 1..4 once, level 5 three times) -> only ONE level-1 photo is left to hand out
  await set([1, 2, 3, 4, 5, 5, 0, 0, 5]);
  await dragMouse(4, 'right');           // 5+5 -> 6, leaves {1,2,3,4,5,6}: no pair -> refill with the last 1 tile
  await page.waitForFunction(() => window.__mergeGame.spawned() === 64, null, { timeout: 8000 });
  await settle();
  const after = await levels();
  eq('exactly one new level-1 tile appeared (supply 63 -> 64)', after.filter(Boolean).length, 7);
  eq('supply used is exactly 64, never more', await page.evaluate(() => window.__mergeGame.spawned()), 64);
  eq('board keeps free cells so tiles can still move', after.filter((l) => l === 0).length, 2);

  console.log('\n[11] Final photo ends the game, alone in the centre');
  await set([6, 6, 0, 0, 0, 0, 0, 0, 0]);          // value 64 = the whole supply
  await page.evaluate(() => window.__mergeGame.move(1, 'left'));
  await page.waitForFunction(() => window.__mergeGame.levels().includes(7), null, { polling: 'raf', timeout: 4000 });
  eq('6+6 -> the couple photo (2nd last) is alone on the board', await levels(), [7, 0, 0, 0, 0, 0, 0, 0, 0]);
  eq('couple tile shows the couple photo', await page.$eval('.tile img', (i) => i.getAttribute('src')), 'images/couple.png');
  await page.screenshot({ path: path.join(SHOTS, '4b-couple-before-finale.png') });
  await page.waitForSelector('#win:not([hidden])', { timeout: 6000 });
  eq('couple morphs into the final photo, ONLY tile left, in the centre', await levels(), ONLY_FINAL);
  eq('exactly one tile in the DOM', await page.$$eval('.tile', (a) => a.length), 1);
  eq('final tile is the selfie photo (last)', await page.$eval('.tile img', (i) => i.getAttribute('src')), 'images/selfie.png');
  await page.screenshot({ path: path.join(SHOTS, '5-win.png') });
  const lockBefore = await levels();
  await dragMouse(4, 'left');
  eq('input is locked after winning', await levels(), lockBefore);
  await page.click('#again'); await sleep(800); await settle();
  eq('Play again restores the full level-1 board', await levels(), [1, 1, 1, 1, 1, 1, 1, 1, 1]);
  await set([6, 6, 1, 0, 0, 0, 0, 0, 0]);   // safety net: a stray tile must vanish too
  await dragMouse(0, 'right');
  await page.waitForSelector('#win:not([hidden])', { timeout: 6000 });
  eq('a stray leftover tile (should be impossible) vanishes', await levels(), ONLY_FINAL);

  console.log('\n[12] Touch swipe (mobile)');
  await page.evaluate(() => window.__mergeGame.newGame()); await sleep(900); await settle();
  {
    const cdp = await ctx.newCDPSession(page);
    const s = await cellCentre(3), e = await cellCentre(4);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', s.x, s.y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', s.x + (e.x - s.x) * i / 8, s.y); await sleep(12); }
    await touch('touchEnd');
    await settle();
    eq('finger swipe merges tiles', (await levels()).slice(3, 6), [0, 2, 1]);
  }

  console.log('\n[13] Stress test: 40 whole games, mixed random + greedy play, at high speed');
  const sim = await page.evaluate(async (games) => {
    const G = window.__mergeGame;
    const sl = (t) => new Promise((r) => setTimeout(r, t));
    const D = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const tgt = (i, d) => { const r = Math.floor(i / 3) + D[d][0], c = (i % 3) + D[d][1]; return r < 0 || r > 2 || c < 0 || c > 2 ? -1 : r * 3 + c; };
    const results = [];
    G.setSpeed(0.005);
    for (let g = 0; g < games; g++) {
      let seed = 1234 + g * 7919;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
      const randomness = [0, 0.2, 0.5, 0.8][g % 4];
      G.newGame();
      let moves = 0, fail = null, maxSpawn = 0;
      while (!G.isWon() && moves < 30000) {
        while (G.isBusy()) await sl(1);
        if (G.isWon()) break;
        const L = G.levels();
        maxSpawn = Math.max(maxSpawn, G.spawned());
        const legal = [];
        for (let i = 0; i < 9; i++) if (L[i]) for (const d of Object.keys(D)) {
          const t = tgt(i, d);
          if (t >= 0 && (L[t] === 0 || (L[t] === L[i] && L[i] < G.MERGE_CAP))) legal.push({ i, d, merge: L[t] === L[i] });
        }
        if (!legal.length) { fail = 'DEADLOCK ' + JSON.stringify(L); break; }
        const merges = legal.filter((m) => m.merge);
        let pick;
        if (merges.length && rnd() >= randomness) pick = merges[Math.floor(rnd() * merges.length)];
        else pick = legal[Math.floor(rnd() * legal.length)];
        G.move(pick.i, pick.d);
        moves++;
      }
      while (G.isBusy()) await sl(2);
      results.push({ g, randomness, moves, won: G.isWon(), fail, spawned: G.spawned(), maxSpawn, merges: G.merges(), board: G.levels() });
    }
    G.setSpeed(1);
    return results;
  }, 40);
  const bad = sim.filter((r) => !r.won || r.fail || r.spawned !== TOTAL || r.maxSpawn > TOTAL || r.merges !== TOTAL - 1 || JSON.stringify(r.board) !== JSON.stringify(ONLY_FINAL));
  eq('all 40 games are won (no deadlock, no stuck state)', sim.filter((r) => r.won).length, 40);
  eq('every game hands out exactly 64 level-1 tiles, never more', sim.every((r) => r.spawned === TOTAL && r.maxSpawn <= TOTAL), true);
  eq('every game needs exactly 63 merges (nothing wasted, nothing left over)', sim.every((r) => r.merges === TOTAL - 1), true);
  eq('every game ends with only the final photo on the board', bad.length, 0);
  if (bad.length) console.log('        offenders:', JSON.stringify(bad.slice(0, 3)));
  console.log(`        moves per game: min ${Math.min(...sim.map((r) => r.moves))}, max ${Math.max(...sim.map((r) => r.moves))}`);

  console.log('\n[14] Full playthrough with a bot using real mouse drags (all 63 merges)');
  await page.evaluate(() => window.__mergeGame.newGame()); await sleep(900); await settle();
  const adj = (i) => [[-1, 0, 'up'], [1, 0, 'down'], [0, -1, 'left'], [0, 1, 'right']]
    .map(([dr, dc, d]) => { const r = Math.floor(i / 3) + dr, c = (i % 3) + dc; return r < 0 || r > 2 || c < 0 || c > 2 ? null : [r * 3 + c, d]; }).filter(Boolean);
  const planner = (L) => {
    for (let i = 0; i < 9; i++) for (const [j, d] of adj(i)) if (L[i] && L[i] === L[j] && L[i] < CAP) return [i, d];
    for (let lv = 1; lv < CAP; lv++) {
      const ids = L.map((v, i) => (v === lv ? i : -1)).filter((i) => i >= 0);
      for (const a of ids) for (const b of ids) {
        if (a === b) continue;
        const q = [[a, null]], seen = new Set([a]);
        while (q.length) {
          const [cur, first] = q.shift();
          for (const [n, d] of adj(cur)) {
            if (n === b && first) return [a, first];
            if (!seen.has(n) && L[n] === 0) { seen.add(n); q.push([n, first || d]); }
          }
        }
      }
    }
    const slides = [];
    for (let i = 0; i < 9; i++) if (L[i]) for (const [j, d] of adj(i)) if (L[j] === 0) slides.push([i, d]);
    return slides.length ? slides[Math.floor(Math.random() * slides.length)] : null;
  };
  const runBot = async () => {
    let moves = 0;
    while (!(await page.evaluate(() => window.__mergeGame.isWon())) && moves < 1500) {
      const L = await levels();
      const plan = planner(L);
      if (!plan) { console.log('   bot stuck on', L); break; }
      await dragMouse(plan[0], plan[1]);
      moves++;
      if (moves === 60) await page.screenshot({ path: path.join(SHOTS, '4-midgame.png') });
    }
    return moves;
  };
  const moves = await runBot();
  ok(`bot wins with real drags (${moves} drags)`, await page.evaluate(() => window.__mergeGame.isWon()));
  await page.waitForSelector('#win:not([hidden])', { timeout: 6000 });
  eq('real playthrough: only the final photo is left', await levels(), ONLY_FINAL);
  eq('real playthrough: exactly 64 level-1 tiles were handed out', await page.evaluate(() => window.__mergeGame.spawned()), TOTAL);
  eq('real playthrough: exactly 63 merges', await page.evaluate(() => window.__mergeGame.merges()), TOTAL - 1);
  await page.screenshot({ path: path.join(SHOTS, '6-win-real-playthrough.png') });

  console.log('\n[15] Desktop layout');
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await dctx.newPage();
  await dp.goto(url); await sleep(900);
  await dp.screenshot({ path: path.join(SHOTS, '7-desktop.png') });
  const bb = await dp.locator('#board').boundingBox();
  ok('board is square and fits the viewport', Math.abs(bb.width - bb.height) < 1 && bb.y >= 0 && bb.y + bb.height <= 800);
  const strip = await page.locator('#progress').boundingBox();
  ok('8-photo progress strip fits on a 390px phone', strip.x >= 0 && strip.x + strip.width <= 390);

  eq('no console / page errors', errors, []);
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
