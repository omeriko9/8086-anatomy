// The units that the Explain program visits, for each model: for each story step, the chip,
// the unit, the kind of its card, the caption of the unit (xpUnitCap) and the text of its card.
// It also lists the texts that more than one unit uses (each unit must have its own text).
// Usage: node tools/xpunits.mjs [--models 8086,80286,...] [--out file.json]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const models = opt('--models', '8086,80286,80386,80486,80586,80686').split(',');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const all = {};
let dups = 0;
for (const model of models) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(m => { localStorage.setItem('a86:cpu', JSON.stringify(m)); localStorage.setItem('a86:tab', JSON.stringify('board')); localStorage.setItem('a86:sfx', 'false'); }, model);
  await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
  await new Promise(r => setTimeout(r, 3500));
  const rows = await page.evaluate(() => {
    const a = __app, x = a.explain, bd = a.views.board, out = [];
    x.start();
    const P = x.program();
    for (let c = 1; c <= P.list.length; c++) {
      x.go(c);
      a.traceNext();
      const p = a.play;
      if (!p || !p.story) continue;
      p.story.steps.forEach((s, i) => {
        const J = bd.trJourney(s);
        for (const g of J.segs) {
          if (!g.unit || !g.dive) continue;
          // the texts of the drawing (for the tooltips of its terms)
          let texts = [];
          if (g.card && typeof BlockPanel !== 'undefined') {
            const host = document.createElement('div'); document.body.appendChild(host);
            const P = new BlockPanel(host); P.show(g.card); P.update(1);
            texts = [...P.el.querySelectorAll('svg text')].map(t => t.textContent.trim()).filter(Boolean);
            host.remove();
          }
          out.push({ c, i, step: s.title || s.kind, chip: g.dive.e.part, key: g.dive.e.key, unit: g.block, kind: g.card ? g.card.kind : '',
            title: g.card ? g.card.title : '', sub: g.card ? g.card.sub || '' : '', cap: bd.xpUnitCap ? bd.xpUnitCap(g) : '', texts,
            tips: bd.xpTermTip ? texts.map(t => [t, (bd.xpTermTip(t, g.card) || {}).text || '']) : [] });
        }
      });
      a.finishInstr();
    }
    x.stop();
    return out;
  });
  // the same text for two different units
  const by = new Map();
  for (const r of rows) {
    const t = r.cap || r.sub, u = r.chip + ' / ' + r.unit;
    if (!t) continue;
    if (!by.has(t)) by.set(t, new Set());
    by.get(t).add(u);
  }
  const same = [...by].filter(([, s]) => s.size > 1).map(([t, s]) => ({ text: t, units: [...s] }));
  dups += same.length;
  all[model] = { rows, same, errors };
  console.log(`${model}: ${rows.length} unit visits, ${new Set(rows.map(r => r.chip + '/' + r.unit)).size} units, ${same.length} shared texts${errors.length ? ', errors: ' + errors.slice(0, 2).join(' | ') : ''}`);
  for (const d of same) console.log(`   "${d.text.slice(0, 110)}"  <- ${d.units.join(', ')}`);
  await page.close();
}
await browser.close();
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(all, null, 1));
if (opt('--terms')) {
  // the texts of all drawings, with the tooltip of each (an empty tip: no meaning yet)
  const T = new Map();
  for (const m of Object.values(all)) for (const r of m.rows) for (const [t, tip] of r.tips.length ? r.tips : r.texts.map(x => [x, ''])) {
    const k = r.kind + ' | ' + t;
    if (!T.has(k)) T.set(k, tip);
  }
  fs.writeFileSync(opt('--terms'), [...T].map(([k, v]) => k + '  =>  ' + v).sort().join('\n'));
  console.log(`${T.size} drawing texts, ${[...T.values()].filter(v => !v).length} without a tip`);
}
console.log(dups ? `${dups} shared texts` : 'each unit has its own text');
