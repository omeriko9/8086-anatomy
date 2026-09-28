// A contact sheet of the unit drawings (UnitFx) of the Explain program: for each model, the cards
// of the given kinds that the program makes, drawn at three moments of the work (u = 0.25, 0.6, 1)
// on a canvas of the size of a close unit shot. No 3D: a quick check of the drawings.
// Usage: node tools/unitsheet.mjs --out sheet.png [--models 80486,80586,80686] [--kinds cache,bus,pipe,rat,rs,rob,port] [--rows DIR]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const models = opt('--models', '80486,80586,80686').split(','), kinds = opt('--kinds', 'cache,bus,pipe,rat,rs,rob,port').split(',');
const out = path.resolve(opt('--out', path.join(root, 'tools', 'unitsheet.png')));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const shots = [];
for (const model of models) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(m => { localStorage.setItem('a86:cpu', JSON.stringify(m)); localStorage.setItem('a86:tab', JSON.stringify('board')); localStorage.setItem('a86:sfx', 'false'); }, model);
  await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
  await new Promise(r => setTimeout(r, 3500));
  const imgs = await page.evaluate(kinds => {
    const a = __app, x = a.explain, bd = a.views.board, got = [], seen = new Set();
    x.start();
    for (let c = 1; c <= x.program().list.length; c++) {
      x.go(c); a.traceNext();
      const p = a.play;
      if (p && p.story) p.story.steps.forEach(s => {
        for (const g of bd.trJourney(s).segs) {
          const k = g.card && g.card.kind;
          if (!k || !kinds.includes(k) || !g.dive) continue;
          const key = g.dive.e.part + '|' + g.block + '|' + g.card.title;
          if (seen.has(key)) continue;
          seen.add(key);
          // the canvas of the unit overlay (768 px on the long side, the aspect of the block)
          const L = bd.layOf(g.dive.e), b = L.blocks[bd.bIdx(g.dive.e, g.block)];
          const e = g.dive.e, bw = b ? b.w / e.cw * e.d.L : 1, bh = b ? b.h / e.ch * e.d.W : 1;
          const W = bw >= bh ? 768 : Math.max(128, Math.round(768 * bw / bh)), H = bw >= bh ? Math.max(128, Math.round(768 * bh / bw)) : 768;
          const row = document.createElement('canvas'); row.width = 3 * W + 40; row.height = H + 30;
          const rg = row.getContext('2d'); rg.fillStyle = '#000'; rg.fillRect(0, 0, row.width, row.height);
          rg.fillStyle = '#fff'; rg.font = '16px monospace'; rg.fillText(`${e.part} · ${g.block} · ${g.card.kind} · ${g.card.title}`, 8, 20);
          [0.25, 0.6, 1].forEach((u, i) => {
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            const cg = cv.getContext('2d'); cg.fillStyle = 'rgba(6,8,16,0.9)'; cg.fillRect(0, 0, W, H);
            UnitFx.draw(cg, W, H, g.card, u, 1000, false);
            rg.drawImage(cv, 10 + i * (W + 10), 28);
          });
          got.push(row.toDataURL('image/png'));
        }
      });
      a.finishInstr();
    }
    x.stop();
    return got;
  }, kinds);
  for (const d of imgs) {
    shots.push(d);
    // --rows DIR: each drawing in its own file too
    if (opt('--rows')) { fs.mkdirSync(opt('--rows'), { recursive: true }); fs.writeFileSync(path.join(opt('--rows'), `${model}_${String(shots.length).padStart(2, '0')}.png`), Buffer.from(d.split(',')[1], 'base64')); }
  }
  console.log(`${model}: ${imgs.length} drawings${errors.length ? ', errors: ' + errors.slice(0, 2).join(' | ') : ''}`);
  await page.close();
}
// one sheet: the rows under each other (scaled to 1600 px wide)
const page = await browser.newPage();
const sheet = await page.evaluate(async list => {
  const ims = await Promise.all(list.map(src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; })));
  const Wd = 1600, rows = ims.map(i => ({ i, h: Math.round(i.height * Wd / i.width) }));
  const c = document.createElement('canvas'); c.width = Wd; c.height = rows.reduce((n, r) => n + r.h + 6, 0);
  const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
  let y = 0; for (const r of rows) { g.drawImage(r.i, 0, y, Wd, r.h); y += r.h + 6; }
  return c.toDataURL('image/png');
}, shots);
fs.writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
await browser.close();
console.log('sheet: ' + out);
