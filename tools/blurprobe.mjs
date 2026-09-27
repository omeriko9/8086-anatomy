// Blur of the dies in Explain, measured: at each moment (steps of 100 ms on a virtual clock) the
// resolution that the view needs on the die in the middle of the view (screen px for each base px
// of the die picture) and the best one that is there (the die texture: 1, or a detail tile that
// has the point, at 5 x 5 points of the view; the lowest). ready / need < 0.7 is a blurred moment.
// Usage: node tools/blurprobe.mjs [--model 80486] [--chapter 1] [--secs 60] [--page dist/8086-anatomy.html]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const model = opt('--model', '80486'), chapter = +opt('--chapter', 1), secs = +opt('--secs', 60);
const pageFile = path.resolve(root, opt('--page', 'dist/8086-anatomy.html'));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((model) => {
  let vt = 0, id = 0, last = null; const q = [];
  const realRaf = window.requestAnimationFrame.bind(window), realNow = performance.now.bind(performance);
  // the clock of the page moves with the virtual time, and also during a frame (real ms), so the
  // time budgets of the page work as in a browser
  let base = 0, inFrame = false;
  performance.now = () => (inFrame ? vt + (realNow() - base) : vt);
  window.requestAnimationFrame = cb => { q.push([++id, cb]); return id; };
  window.cancelAnimationFrame = i => { const k = q.findIndex(x => x[0] === i); if (k >= 0) q.splice(k, 1); };
  const run = () => { const cbs = q.splice(0); inFrame = true; base = realNow(); for (const [, cb] of cbs) { try { cb(vt); } catch (e) { console.error(e && e.stack || e); } } inFrame = false; };
  const vc = window.__vt = { auto: true, get t() { return vt; }, step(ms) { vt += ms; run(); } };
  const pump = () => { const r = realNow(); if (vc.auto) { vt += last === null ? 16 : Math.min(100, r - last); run(); } last = r; realRaf(pump); };
  realRaf(pump);
  localStorage.setItem('a86:cpu', JSON.stringify(model)); localStorage.setItem('a86:tab', JSON.stringify('board')); localStorage.setItem('a86:sfx', 'false');
  localStorage.setItem('a86:xpSet', JSON.stringify({ speed: 1, travel: 1, work: 1, read: 1, wait: false }));
}, model);
await page.goto(pathToFileURL(pageFile).href);
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => document.getElementById('btn-explain').click());
await new Promise(r => setTimeout(r, 1000));
await page.evaluate(c => { __app.explain.go(c); __vt.auto = false; }, chapter);
const rows = [];
for (let k = 0; k < secs * 10; k++) {
  const r = await page.evaluate(() => {
    __vt.step(100);
    const bd = __app.views.board, rc = bd.renderer.domElement.getBoundingClientRect();
    const e = bd.decapAt(rc.left + rc.width * (bd.viewCx || 0.5), rc.top + rc.height / 2);
    if (!e || !bd.isOpen(e)) return null;
    const reg = bd.regionOnDie(e);
    if (!reg) return null;
    const [x0, y0, x1, y1] = reg, need = Math.min(rc.width / (x1 - x0), rc.height / (y1 - y0));
    if (need < 1.2) return null;
    // the tiles there: (new) bd.tiles; (old) the one tile bd.dtMesh with its region in bd.detail.key
    // the best scale that is there, at 5 x 5 points of the view (the die texture: 1; a visible tile
    // that has the point); ready = the lowest of them
    let ready = Infinity;
    for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) {
      const px = x0 + (x1 - x0) * (i + 0.5) / 5, py = y0 + (y1 - y0) * (k + 0.5) / 5;
      let best = 1;
      for (const t of bd.tiles || []) if (t.e === e && t.mesh.visible && px >= t.x0 && px <= t.x1 && py >= t.y0 && py <= t.y1) best = Math.max(best, t.tex.image.width / (t.x1 - t.x0));
      if (bd.dtMesh && bd.dtMesh.visible && bd.detail && bd.detail.key) {
        const p = bd.detail.key.split('|').map(Number);
        if (px >= p[1] && px <= p[3] && py >= p[2] && py <= p[4]) best = Math.max(best, bd.dtTex.image.width / (p[3] - p[1]));
      }
      ready = Math.min(ready, best);
    }
    const bl = ready / need < 0.4;
    const dump = bl && (window.__dumps = (window.__dumps || 0) + 1) <= 3 ? { view: reg.map(Math.round), tiles: (bd.tiles || []).map(t => [t.e.key, Math.round(t.x0), Math.round(t.y0), Math.round(t.x1), Math.round(t.y1), +t.S.toFixed(2), t.mesh.visible ? 'v' : '-']), jobs: (window.__jobs || []).slice(-12) } : undefined;
    return { dump, t: __vt.t, need: +need.toFixed(2), ready: +ready.toFixed(2), die: e.key, tiles: (bd.tiles || []).length, q: (bd.tileQ || []).length, job: !!bd.tileJob, auto: !!e.auto, win: !!e.win };
  });
  if (r) rows.push(r);
}
await browser.close();
const blur = rows.filter(r => r.ready / r.need < 0.7), bad = rows.filter(r => r.ready / r.need < 0.4);
console.log(`${model} chapter ${chapter}: ${rows.length} moments on a die (of ${secs * 10}); blurred (ready < 0.7 of need): ${blur.length} (${(100 * blur.length / Math.max(1, rows.length)).toFixed(0)}%), very blurred (< 0.4): ${bad.length}`);
const R = rows.map(r => r.ready / r.need).sort((p, q) => p - q), P = f => (R.length ? R[Math.floor(f * (R.length - 1))].toFixed(2) : '-');
console.log(`ready / need: lowest ${P(0)}, 5% ${P(0.05)}, median ${P(0.5)}`);
if (args.includes('--verbose')) for (const r of blur) console.log(JSON.stringify(r));
if (errors.length) console.log('errors: ' + errors.slice(0, 3).join(' | '));
