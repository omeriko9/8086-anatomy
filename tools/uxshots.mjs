// Screenshots of the page in many states, for a review of the UI.
// Usage: node tools/uxshots.mjs --out DIR [--model 80486] [--w 1440 --h 900] [--only name,name]
//          [--frame MS (the virtual frame, 33 if not given)] [--no-tour (Explain: no tour pictures)]
// The states: the first view, each tab, the trace while an instruction runs, the model menu,
// the help, and Explain (the tour, an instruction, a unit at work, the settings, the end).
// Explain uses a virtual clock (as xpfilm.mjs), so the pictures come at known times.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt('--out', path.join(root, 'tools', 'out', 'ux')));
const model = opt('--model', '80486'), W = +opt('--w', 1440), H = +opt('--h', 900);
const only = opt('--only', null), want = n => !only || only.split(',').includes(n);
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
await page.evaluateOnNewDocument(m => {
  if (sessionStorage.getItem('ux:init')) return;
  sessionStorage.setItem('ux:init', '1');
  localStorage.clear();
  localStorage.setItem('a86:cpu', JSON.stringify(m));
}, model);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
await new Promise(r => setTimeout(r, 4000));

const wait = ms => new Promise(r => setTimeout(r, ms));
// move the virtual clock by ms, in frames of --frame ms (33 ms if not given)
const FR = +opt('--frame', 33);
const adv = async ms => { await page.evaluate((ms, FR) => { __vt.auto = false; for (let t = 0; t < ms; t += FR) __vt.step(FR); }, ms, FR); };
const shot = async name => { await page.screenshot({ path: path.join(out, name + '.png') }); console.log('[shot]', name); };
const click = sel => page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);

if (want('first')) await shot('first');
for (const t of ['top', 'runner', 'die', 'timing', 'memory']) {
  if (!want(t)) continue;
  // (top and runner are modes of the Board tab)
  if (t === 'top' || t === 'runner') await click(`#board-modes [data-mode="${t}"]`); else await click('#tab-' + t);
  await wait(1500); await shot('tab-' + t);
}
await page.evaluate(() => __app.selectTab('board')); await wait(800);
if (want('trace')) {
  // one instruction in the trace: Next, then some time
  await click('#trace-next'); await adv(1800); await shot('trace-a');
  await click('#trace-next'); await adv(1500); await shot('trace-b');
  await page.evaluate(() => { __vt.auto = true; });
}
if (want('decap')) {
  await page.evaluate(() => { const c = document.getElementById('opt-decap'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await wait(1500); await shot('decap');
  await page.evaluate(() => { const c = document.getElementById('opt-decap'); c.checked = false; c.dispatchEvent(new Event('change')); });
}
if (want('menu')) { await click('#brand-btn'); await wait(500); await shot('menu'); await click('#brand-btn'); await wait(300); }
if (want('help')) { await click('#btn-help'); await wait(500); await shot('help'); await page.keyboard.press('Escape'); await wait(300); }
if (want('max')) { await click('#btn-max'); await wait(1200); await shot('max'); await click('#btn-max'); await wait(800); }

if (want('xp')) {
  await page.evaluate(() => { __vt.auto = true; });
  await click('#btn-explain'); await wait(1500);
  await page.evaluate(() => { __vt.auto = false; });
  if (!args.includes('--no-tour')) {
    await adv(1500); await shot('xp-tour-1');
    await adv(12000); await shot('xp-tour-2');
    await adv(12000); await shot('xp-tour-3');
  }
  await page.evaluate(() => __app.explain.go(1));
  await adv(2500); await shot('xp-i1-a');
  for (let k = 0; k < 7; k++) { await adv(5000); await shot('xp-i1-' + 'bcdefgh'[k]); }
  await page.evaluate(() => __app.explain.go(4));
  for (let k = 0; k < 6; k++) { await adv(6000); await shot('xp-i4-' + 'abcdef'[k]); }
  await page.evaluate(() => { const b = [...document.querySelectorAll('.xp3-btn')].find(x => x.textContent === 'Timing'); if (b) b.click(); });
  await adv(300); await shot('xp-timing');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.xp3-btn')].find(x => x.textContent === 'Timing'); if (b) b.click(); });
  await page.evaluate(() => __app.explain.go(5));
  await adv(4000); await shot('xp-end');
}
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
