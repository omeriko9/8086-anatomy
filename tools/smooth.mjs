// Smoothness probe for the trace mode: samples the token and the camera in each frame
// during Run and reports the largest jumps. Usage: node tools/smooth.mjs [--speed 3] [--secs 6]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.setViewport({ width: 1000, height: 640 });
const set = { tab: 'board', speed: +opt('--speed', 3), trace: true, codeHidden: true, dockHidden: true };
if (opt('--model')) set.cpu = opt('--model');
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
await new Promise(r => setTimeout(r, 2500));
await page.click('#btn-run');
const res = await page.evaluate(secs => new Promise(done => {
  const b = __app.views.board, out = [];
  const t0 = performance.now();
  const f = () => {
    const now = performance.now();
    const tok = document.querySelector('.bv-tok');
    const m = tok && tok.style.opacity === '1' ? /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(tok.style.transform) : null;
    out.push({ t: now, step: __app.play && __app.play.story ? __app.play.story.text + '#' + __app.play.si : '-',
      tok: m ? [+m[1], +m[2]] : null, cam: [b.cam.target.x, b.cam.target.z, b.cam.r] });
    if (now - t0 < secs * 1000) requestAnimationFrame(f); else done(out);
  };
  requestAnimationFrame(f);
}), +opt('--secs', 6));
await page.click('#btn-run');
await browser.close();
const dts = [];
let worstTok = { v: 0 }, worstCam = { v: 0 }, worstAcc = { v: 0 }, steps = new Set();
for (let i = 1; i < res.length; i++) {
  const a = res[i - 1], b = res[i], dt = b.t - a.t;
  dts.push(dt);
  steps.add(b.step);
  if (a.tok && b.tok && a.step === b.step) {
    const v = Math.hypot(b.tok[0] - a.tok[0], b.tok[1] - a.tok[1]) / dt;   // px per ms
    if (v > worstTok.v) worstTok = { v, i, step: b.step };
  }
  const cv = Math.hypot(b.cam[0] - a.cam[0], b.cam[1] - a.cam[1]) / dt * 1000;   // units per s
  if (cv > worstCam.v) worstCam = { v: cv, i };
  if (i > 1) {
    const z = res[i - 2], dt0 = a.t - z.t;
    const v0 = Math.hypot(a.cam[0] - z.cam[0], a.cam[1] - z.cam[1]) / dt0 * 1000;
    const acc = Math.abs(cv - v0) / dt * 1000;   // units per s^2
    if (acc > worstAcc.v) worstAcc = { v: acc, i };
  }
}
dts.sort((x, y) => x - y);
console.log(`frames ${res.length}, frame time median ${dts[dts.length >> 1].toFixed(1)} ms, max ${dts[dts.length - 1].toFixed(1)} ms, steps seen ${steps.size}`);
console.log(`token: fastest ${(worstTok.v * 1000).toFixed(0)} px/s (${worstTok.step || ''})`);
console.log(`camera: fastest ${worstCam.v.toFixed(2)} units/s, largest change of speed ${worstAcc.v.toFixed(1)} units/s²`);
