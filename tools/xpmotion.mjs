// The motion of Explain, measured (no pictures): the page runs on a virtual clock in steps of
// 100 ms, and between two steps the tool takes 6 samples of the camera and the token (the camera
// of Explain is a function of the time: xpCamera). For each sample: the token on the screen, the
// pan of the camera (view widths per second) and the zoom rate (log r per second), in the time
// of the animation. The result: the largest values, the jumps of the token speed, and the times of
// the steps and the units.
// Usage: node tools/xpmotion.mjs [--model 80486] [--chapter 1] [--secs 80] [--speed 1] [--travel 1]
//          [--work 1] [--read 1] [--w 1280 --h 800] [--out file.json] [--page dist/8086-anatomy.html]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const model = opt('--model', '80486'), chapter = +opt('--chapter', 1), secs = +opt('--secs', 80);
const W = +opt('--w', 1280), H = +opt('--h', 800);
const set = { speed: +opt('--speed', 1), travel: +opt('--travel', 1), work: +opt('--work', 1), read: +opt('--read', 1), wait: false };
const pageFile = path.resolve(root, opt('--page', 'dist/8086-anatomy.html'));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  let vt = 0, id = 0, last = null;
  const q = [];
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  performance.now = () => vt;
  window.requestAnimationFrame = cb => { q.push([++id, cb]); return id; };
  window.cancelAnimationFrame = i => { const k = q.findIndex(x => x[0] === i); if (k >= 0) q.splice(k, 1); };
  const run = () => { const cbs = q.splice(0); for (const [, cb] of cbs) { try { cb(vt); } catch (e) { console.error(e && e.stack || e); } } };
  const vc = window.__vt = { auto: true, get t() { return vt; }, step(ms) { vt += ms; run(); }, set(ms) { vt = ms; } };
  const pump = () => { const r = realNow(); if (vc.auto) { vt += last === null ? 16 : Math.min(100, r - last); run(); } last = r; realRaf(pump); };
  realRaf(pump);
});
await page.evaluateOnNewDocument((model, set) => {
  const s = { cpu: model, tab: 'board', trace: true, sfx: false };
  for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k]));
  localStorage.setItem('a86:xpSet', JSON.stringify(set));
}, model, set);
await page.goto(pathToFileURL(pageFile).href);
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => document.getElementById('btn-explain').click());
await new Promise(r => setTimeout(r, 1500));
await page.evaluate(c => __app.explain.go(c), chapter);
await page.evaluate(() => { __vt.auto = false; });
// the animation time: the first frame after go() starts a beat at animNow() (Explain.bT0); the
// speed stays the same, so animNow = a0 + (vt - vt0) * speed
await page.evaluate(sp => { __vt.step(16); window.__a0 = __app.explain.bT0; window.__vt0 = __vt.t; window.__sp = sp; }, set.speed);

const samples = [];
for (let k = 0; k < secs * 10; k++) {
  const S = await page.evaluate(() => {
    const out = [], a = __app, bd = a.views.board, x = a.explain, t0 = __vt.t;
    const KW = () => 2 * Math.tan(bd.camera.fov * Math.PI / 360) * (bd.camera.aspect || 1.6);
    for (let j = 0; j < 6; j++) {
      __vt.set(t0 + j * 100 / 6);
      const now = window.__a0 + (__vt.t - window.__vt0) * window.__sp;
      bd.updateCamera(100 / 6, now);
      bd.camera.updateMatrixWorld();
      const c = bd.cam, s = { t: now, r: c.r, tx: c.target.x, ty: c.target.y, tz: c.target.z, kw: KW(), cap: x.ui ? x.ui.cap.textContent.slice(0, 60) : '' };
      const r = bd.tr && bd.tr.rider;
      if (r && now >= r.t0 && !r.done) {
        const at = bd.riderAt(r, Math.min(1, (now - r.t0) / r.dur));
        if (at) {
          const q = at.pos.clone().project(bd.camera);
          s.x = (q.x + 1) / 2 * bd.w; s.y = (1 - q.y) / 2 * bd.h; s.seg = (at.seg.unit ? (at.seg.card ? 'work:' : 'pass:') + at.seg.block : 'move');
          s.i = bd.tr.i;
        }
      }
      out.push(s);
    }
    __vt.set(t0);
    __vt.step(100);
    return out;
  });
  samples.push(...S);
}
await browser.close();
// the measures
const rows = [];
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1], b = samples[i], dt = (b.t - a.t) / 1000;
  if (!(dt > 0)) continue;
  const pan = Math.hypot(b.tx - a.tx, b.ty - a.ty, b.tz - a.tz) / (b.kw * Math.min(a.r, b.r)) / dt;
  const zoom = Math.abs(Math.log(b.r / a.r)) / dt;
  const tok = a.x !== undefined && b.x !== undefined && a.i === b.i ? Math.hypot(b.x - a.x, b.y - a.y) / dt : null;
  rows.push({ t: b.t, pan, zoom, tok, seg: b.seg, i: b.i });
}
const top = (k, n = 5) => [...rows].filter(r => r[k] !== null).sort((p, q) => q[k] - p[k]).slice(0, n).map(r => `${r[k].toFixed(k === 'tok' ? 0 : 2)} at ${(r.t / 1000).toFixed(2)} s (${r.seg || '-'})`);
// jumps of the token speed: a change of more than 400 px/s between two samples (1/60 s)
let jumps = 0;
for (let i = 1; i < rows.length; i++) if (rows[i].tok !== null && rows[i - 1].tok !== null && Math.abs(rows[i].tok - rows[i - 1].tok) > 400) jumps++;
const moveTok = rows.filter(r => r.tok !== null && r.seg === 'move').map(r => r.tok).sort((p, q) => p - q);
const pct = p => moveTok.length ? moveTok[Math.floor(p * (moveTok.length - 1))].toFixed(0) : '-';
console.log(`${model} chapter ${chapter}, speed ${set.speed}, travel ${set.travel}, work ${set.work}: ${(samples.length / 60).toFixed(1)} s of animation`);
console.log(`token on a move (px/s): median ${pct(0.5)}, 90% ${pct(0.9)}, max ${pct(1)}; speed jumps (> 400 px/s in 1/60 s): ${jumps}`);
console.log('largest token speed: ' + top('tok').join('; '));
console.log('largest pan (views/s): ' + top('pan').join('; '));
console.log('largest zoom rate (log r/s): ' + top('zoom').join('; '));
// the time of each unit at work
const units = [];
for (const s of samples) {
  const L = units[units.length - 1];
  if (s.seg && s.seg.startsWith('work:')) { if (L && L.seg === s.seg && L.i === s.i) L.t1 = s.t; else units.push({ seg: s.seg, i: s.i, t0: s.t, t1: s.t, cap: s.cap }); }
}
console.log('units at work: ' + units.map(u => `${u.seg.slice(5)} ${((u.t1 - u.t0) / 1000).toFixed(1)} s`).join(', '));
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify({ set, samples, rows, errors }, null, 0));
if (errors.length) console.log('errors: ' + errors.slice(0, 3).join(' | '));
