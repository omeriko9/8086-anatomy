// Frame-exact film of the Explain player on the 3D board (the virtual clock of flowfilm.mjs).
// For each frame, state.json has: the time, the beat and the caption, the story step, the camera
// (target, distance, angles), the token on the screen, the unit that works, and the size of that
// unit on the screen. Screenshots every --every frames.
//
// Usage: node tools/xpfilm.mjs --out DIR [--model 80486] [--chapter 1] [--secs 60] [--fps 30]
//          [--every 15] [--speed 0.25] [--travel 1] [--work 1] [--read 1] [--w 1440 --h 900]
//          [--skip S (move the clock S seconds first, in steps of 250 ms, with no pictures)]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt('--out', path.join(root, 'tools', 'out', 'xpfilm')));
const model = opt('--model', '80486'), chapter = +opt('--chapter', 1);
const fps = +opt('--fps', 30), every = +opt('--every', 15), secs = +opt('--secs', 60);
const W = +opt('--w', 1440), H = +opt('--h', 900);
const set = { speed: +opt('--speed', 0.25), travel: +opt('--travel', 1), work: +opt('--work', 1), read: +opt('--read', 1), wait: false };
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (/^f\d+\.(jpg|png)$/.test(f)) fs.unlinkSync(path.join(out, f));

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
  const vc = window.__vt = { auto: true, get t() { return vt; }, step(ms) { vt += ms; run(); } };
  const pump = () => { const r = realNow(); if (vc.auto) { vt += last === null ? 16 : Math.min(100, r - last); run(); } last = r; realRaf(pump); };
  realRaf(pump);
});
await page.evaluateOnNewDocument((model, set) => {
  const s = { cpu: model, tab: 'board', trace: true, sfx: false };
  for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k]));
  localStorage.setItem('a86:xpSet', JSON.stringify(set));
}, model, set);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => document.getElementById('btn-explain').click());
await new Promise(r => setTimeout(r, 1500));
await page.evaluate(c => { const x = __app.explain || window.__explain; if (x) x.go(c); }, chapter);
await page.evaluate(() => { __vt.auto = false; });
const skip = +opt('--skip', 0);
for (let k = 0; k < skip * 4; k++) await page.evaluate(() => __vt.step(250));

const frames = [], dt = 1000 / fps, maxF = Math.round(secs * fps);
for (let f = 0; f < maxF; f++) {
  const st = await page.evaluate(dt => {
    __vt.step(dt);
    const a = __app, v = a.views.board, x = a.explain || window.__explain, p = a.play;
    const s = { t: Math.round(__vt.t), cap: x && x.ui ? x.ui.cap.textContent.slice(0, 90) : '', chap: x ? x.chapter : -1, si: p && p.story ? p.si : -1 };
    if (p && p.story && p.story.steps[p.si]) s.step = p.story.steps[p.si].title || p.story.steps[p.si].kind;
    const c = v.camera, C = v.cam;
    s.cam = { tx: +C.target.x.toFixed(3), ty: +C.target.y.toFixed(3), tz: +C.target.z.toFixed(3), r: +C.r.toFixed(4), th: +C.theta.toFixed(3), ph: +C.phi.toFixed(3) };
    const cr = v.renderer.domElement.getBoundingClientRect();
    const scr = q0 => { const q = q0.clone().project(c); return [Math.round(cr.left + (q.x + 1) / 2 * cr.width), Math.round(cr.top + (1 - q.y) / 2 * cr.height)]; };
    const t = v.tr, r = t && t.rider, at = r && __vt.t >= r.t0 ? r.at : null;
    if (at) {
      s.tok = scr(at.pos); s.seg = (at.seg.unit ? 'unit' : 'move') + (at.seg.label ? ':' + at.seg.label : '') + (at.seg.block ? ':' + at.seg.block : '');
      if (at.seg.unit && at.dive) {
        const e = at.dive.e, b = v.layOf(e).blocks[v.bIdx(e, at.seg.block)];
        if (b) {
          const q = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(p0 => scr(v.dieW(e, p0, 0.006)));
          const xs = q.map(p0 => p0[0]), ys = q.map(p0 => p0[1]);
          s.unit = { name: e.part + ' ' + at.seg.block, kind: at.seg.card ? at.seg.card.kind : '', w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        }
      }
    }
    return s;
  }, dt);
  frames.push(st);
  if (f % every === 0) await page.screenshot({ path: path.join(out, `f${String(f / every + 1).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 80 });
}
fs.writeFileSync(path.join(out, 'state.json'), JSON.stringify({ model, chapter, fps, every, set, frames, errors }, null, 0));
await browser.close();
console.log(`${frames.length} frames (${(frames.length / fps).toFixed(1)} s), ${errors.length} errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
