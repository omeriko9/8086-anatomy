// Close pictures of the Pentium Pro die (the Die tab), for the checks of the Die686View.
// Usage: node tools/p6dieshot.mjs --out prefix [--file page.html] [--steps 12] [--stepms 900]
//          [--zoom 3] [--parts rob,rs,dec] [--until 'div ebx'] [--then 1] [--w 1600] [--h 1000] [--fast ms] [--src file.asm] [--mid 0.5] [--series n --every ms]
// After the steps (trace mode, Next), it zooms the die to each part and takes a picture of the view.
// --mid f: the pictures come f of the time into the next step (the model clock of the view moves).
// Parts (the centre in the landscape plan of the CPU die, or 'l2' for the L2 die): see PARTS below;
// or a block id with a zoom (rob:2.5), for all plans.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PARTS = {
  all: null, fr: [330, 210, 1.9], dc: [850, 210, 2], ms: [1270, 210, 2.4], rat: [175, 535, 2.6], rob: [610, 535, 1.9], rs: [1050, 535, 2.6],
  rrf: [1315, 535, 2.6], ex: [305, 830, 2.2], mob: [680, 830, 2.6], dm: [968, 830, 2.4], bi: [1300, 830, 2.4], l2: [1820, 340, 2],
};
const prog = fs.readFileSync(path.join(root, 'tools', 'p6shot.mjs'), 'utf8').match(/const P6_PROG = String\.raw`([\s\S]*?)\n`;/)[1] + '\n';
const src = opt('--src', null) ? fs.readFileSync(opt('--src'), 'utf8') : prog;
const w = +opt('--w', 1600), h = +opt('--h', 1000), steps = +opt('--steps', 12), fastMs = +opt('--fast', 0);
const prefix = opt('--out', path.join(root, 'tools', 'p6d'));
const file = opt('--file', path.join(root, 'dist', '8086-anatomy.p6test.html'));
const set = { tab: 'die', trace: !fastMs, speedPos: fastMs ? 90 : +opt('--speed', 30), speedSet: true, cpu: opt('--model', '80686'), src, sample: 'custom' };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message, e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : ''); });
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
await page.setViewport({ width: w, height: h, deviceScaleFactor: +opt('--dpr', 1) });
await page.evaluateOnNewDocument(s => { localStorage.clear(); for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(file).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
// the floating screen covers the die: dock it (the layout then uses all the stage)
await page.evaluate(() => { const m = document.querySelector('.monitor'); if (m) m.style.display = 'none'; const v = window.__app.views.die; if (v) v.resize(); });
const nextClick = async () => {
  const next = await page.$('#trace-next');
  if (next && await page.evaluate(() => !document.getElementById('trace').hidden)) await next.click();
  else await page.click('#btn-step');
};
for (let i = 0; i < steps; i++) { await nextClick(); await sleep(+opt('--stepms', 900)); }
// --until re: click Next until the traced instruction matches re (then --then n more instructions)
if (opt('--until', null)) {
  const re = opt('--until');
  const then = +opt('--then', 0);
  let found = false, count = 0, last = '';
  for (let i = 0; i < 600; i++) {
    const t = await page.evaluate(() => (document.getElementById('trace-instr') || {}).textContent || '');
    if (t !== last) {
      last = t;
      if (found) count++; else if (new RegExp(re, 'i').test(t)) found = true;
      if (found && count >= then) break;
    }
    await nextClick();
    await sleep(+opt('--stepms2', 120));
  }
  await sleep(+opt('--stepms', 900));
}
if (fastMs) { await page.click('#btn-run'); await sleep(fastMs); }
if (opt('--mid', null)) {
  const next = await page.$('#trace-next');
  if (next) await next.click();
  await sleep(+opt('--mid') * 1000);
}
const parts = opt('--parts', 'all').split(',');
const series = +opt('--series', 1), every = +opt('--every', 300);
for (let si = 0; si < series; si++) for (const p of parts) {
  if (si) await sleep(every);
  const c = PARTS[p] !== undefined ? PARTS[p] : p;
  await page.evaluate(c => {
    if (typeof c === 'string') {
      // a block id (for example rob:2.5): zoom to the centre of that block
      const [id, z] = c.split(':'), v = window.__app.views.die, g = v.els.blocks[id];
      if (!g) return;
      const r = g.getBoundingClientRect(), M = v.svg.getScreenCTM().inverse(), pt = v.svg.createSVGPoint();
      pt.x = r.left + r.width / 2; pt.y = r.top + r.height / 2;
      const q = pt.matrixTransform(M);
      v.viewTo({ z: +(z || 2.5), cx: q.x, cy: q.y }, false);
      return;
    }
    const v = window.__app.views.die, L = v.L;
    if (!c) { v.viewTo({ z: 1, cx: null, cy: null }, false); return; }
    let [x, y, z] = c;
    if (x > 1560) { x = x - 1580 + L.p87[0]; y += L.p87[1] - 20; } else { x += L.p86[0]; y += L.p86[1]; }
    v.viewTo({ z: +(z * (window.__zk || 1)).toFixed(2), cx: x, cy: y }, false);
  }, c);
  await sleep(250);
  const el = await page.$('.dv-root');
  const nm = p.replace(/[^a-z0-9]+/gi, '_');
  const f = series > 1 ? `${prefix}_${nm}_${si}.png` : `${prefix}_${nm}.png`;
  await el.screenshot({ path: f });
  console.log('[shot]', f);
}
if (fastMs) { await page.click('#btn-run'); await sleep(500); }
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
