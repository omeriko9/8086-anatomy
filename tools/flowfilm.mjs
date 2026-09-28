// Frame-exact film of the trace animation. The tool replaces performance.now() and
// requestAnimationFrame in the page with a virtual clock. Then it moves the clock forward by
// exactly 1/fps second for each frame, lets the page draw that frame, and takes a screenshot.
// The result does not depend on how fast the headless browser draws: each frame is the frame
// that a real screen shows at that time.
//
// Output (in --out): f0001.jpg ... (every --every frames), state.json (for each frame: the
// time, the trace step, the camera and the screen position of the moving token), and
// film.mp4 (when --every 1 and ffmpeg is on the PATH).
//
// Usage: node tools/flowfilm.mjs --out DIR [--model 8086] [--tab top|board|die] [--asm "mov ax, bx"]
//          [--fps 30] [--every 1] [--secs 60] [--speed 0..6 (0 = very slow)] [--w 1280 --h 720]
//          [--instr N (trace instruction N of the program, default 1)]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt('--out', path.join(root, 'tools', 'out', 'film')));
const model = opt('--model', '8086'), tab = opt('--tab', 'top');
const fps = +opt('--fps', 30), every = +opt('--every', 1), secs = +opt('--secs', 60);
const speed = +opt('--speed', 0), W = +opt('--w', 1280), H = +opt('--h', 720), instrN = +opt('--instr', 1);
const asm = opt('--asm', 'mov ax, [bx]');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (/^f\d+\.(jpg|png)$/.test(f)) fs.unlinkSync(path.join(out, f));

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: W, height: H });

// The virtual clock. auto = true: it follows the real clock (for the start of the page).
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
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); },
  { cpu: model, tab, trace: true, codeHidden: true, dockHidden: true, speedPos: speed * 10, sfx: false });
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
await new Promise(r => setTimeout(r, 3500));

// Load the program: the instruction under test, then HLT.
const src = `org 0x100\n${asm.split(';').map(s => '        ' + s.trim()).join('\n')}\n        hlt\n`;
await page.evaluate(src => { __app.editor.value = src; __app.assembleAndLoad(); }, src);
await new Promise(r => setTimeout(r, 800));
// Trace instruction N (step over the ones before it).
await page.evaluate(n => {
  for (let k = 1; k < n; k++) { __app.traceNext(); const p = __app.play; if (p && p.story) { while (p.si < p.story.steps.length - 1) __app.enterStep(p.si + 1); } __app.finishInstr(); }
}, instrN);
await page.evaluate(() => { __vt.auto = false; });
await page.evaluate(() => { __app.traceNext(); if (__app.play) __app.play.auto = true; });

const frames = [], dt = 1000 / fps, maxF = Math.round(secs * fps);
let f = 0, endAt = -1;
for (; f < maxF; f++) {
  const st = await page.evaluate((dt, tab) => {
    __vt.step(dt);
    const a = __app, p = a.play, v = a.views[tab] || a.activeView;
    const s = { t: __vt.t, si: p && p.story ? p.si : -1, n: p && p.story ? p.story.steps.length : 0, title: p && p.story && p.story.steps[p.si] ? p.story.steps[p.si].title : '', done: !p };
    if (tab === 'top' && v.view) {
      // screen positions in page px (the screenshots): the view canvas starts at (ox, oy)
      const vr = v.root.getBoundingClientRect(), ox = vr.left, oy = vr.top;
      s.view = [vr.left, vr.top, vr.width, vr.height];
      s.cam = { cx: v.view.cx, cz: v.view.cz, z: v.view.z };
      let r = v.trAt && v.trAt();
      // the token that the camera follows: after the main token, the one of the work in parallel
      if (r && r.E >= 1 && v.tr && v.tr.bg && v.tr.bg.length && v.bgFollow) { const rb = v.bgFollow(v.tr, __vt.t, r); if (rb) { r = rb; s.bg = true; } }
      if (r) s.tok = [ox + (r.pos[0] - v.view.cx) * v.view.z + v.w / 2, oy + (r.pos[1] - v.view.cz) * v.view.z + v.h / 2], s.seg = r.sg.kind + (r.sg.label ? ':' + r.sg.label : '');
      if (r && r.sg.unit && r.sg.p) {
        const b = v.blockRect(r.sg.p, r.sg.block) || v.dieRect(r.sg.p), A = v.toScreen(b.x0, b.z0), B = v.toScreen(b.x1, b.z1);
        s.unit = { name: r.sg.p.part + ' ' + r.sg.block, kind: r.sg.card ? r.sg.card.kind : '', u: r.local, rect: [ox + Math.min(A[0], B[0]), oy + Math.min(A[1], B[1]), Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1])] };
        if (v.card && v.cardShown) { const c = v.card.el.getBoundingClientRect(); s.card = [c.left, c.top, c.width, c.height]; }
      }
    } else if (tab === 'board' && v.camera) {
      // the camera (its target and distance: the pan in screen px and the zoom), and the token
      // (the rider of the step, projected; after it, a token in parallel in the same die)
      const c = v.camera, d = c.getWorldDirection(new c.position.constructor()), C = v.cam;
      s.cam = { x: c.position.x, y: c.position.y, z: c.position.z, dx: d.x, dy: d.y, dz: d.z, fov: c.fov, tx: C.target.x, ty: C.target.y, tz: C.target.z, r: C.r, px: v.pxAt ? v.pxAt(C.r) : 1 };
      const cr = v.renderer.domElement.getBoundingClientRect();
      s.view = [cr.left, cr.top, cr.width, cr.height];
      const scr = p => { const q = p.clone().project(c); return [cr.left + (q.x + 1) / 2 * cr.width, cr.top + (1 - q.y) / 2 * cr.height]; };
      const t = v.tr, r = t && t.rider;
      let at = r && __vt.t >= r.t0 ? r.at : null;
      if (at && r.E >= 1 && t.bg && t.bg.length) {
        const b = t.bg[0], ab = b.at, last = r.J.segs[r.J.segs.length - 1];
        if (ab && b.E < 1 && ab.dive && last && last.dive && ab.dive.e === last.dive.e) t.__bgf = true;
        if (t.__bgf && ab && b.E < 1) { at = ab; s.bg = true; }
      }
      if (at) {
        s.tok = scr(at.pos); s.seg = (at.seg.unit ? 'unit' : 'move') + (at.seg.label ? ':' + at.seg.label : '');
        if (at.seg.unit && at.dive) {
          const e = at.dive.e, b = v.layOf(e).blocks[v.bIdx(e, at.seg.block)];
          if (b) {
            const q = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(p => scr(v.dieW(e, p, 0.006)));
            const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
            s.unit = { name: e.part + ' ' + at.seg.block, kind: at.seg.card ? at.seg.card.kind : '', u: at.local, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] };
            if (v.bcard && v.cardShown) { const k = v.bcard.el.getBoundingClientRect(); s.card = [k.left, k.top, k.width, k.height]; }
          }
        }
      }
    }
    return s;
  }, dt, tab);
  frames.push(st);
  if (f % every === 0) await page.screenshot({ path: path.join(out, `f${String(f / every + 1).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 82 });
  if (st.done && endAt < 0) endAt = f + Math.round(fps * 0.8);    // a short tail after the end
  if (endAt >= 0 && f >= endAt) break;
}
fs.writeFileSync(path.join(out, 'state.json'), JSON.stringify({ model, tab, asm, fps, every, frames, errors }, null, 0));
await browser.close();
let video = '';
if (every === 1) {
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(out, 'f%04d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(out, 'film.mp4')]); video = path.join(out, 'film.mp4'); } catch (e) { video = 'ffmpeg failed: ' + e.message; }
}
console.log(`${frames.length} frames (${(frames.length / fps).toFixed(1)} s of animation), ${errors.length} errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}${video ? ', video ' + video : ''}`);
