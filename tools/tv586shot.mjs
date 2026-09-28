// Pictures of the Bus timing tab after some trace steps, with a zoom and an open signal card.
// Usage: node tools/tv586shot.mjs --file page.html --out prefix [--model 80586] [--steps 20]
//          [--until c7,06] [--run ms] [--zoom 3] [--card d] [--w 1440] [--h 900] [--fast 3000] [--sample id]
// It uses the test program of tools/p5shot.mjs (read from that file) unless --sample is given.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const shotSrc = fs.readFileSync(path.join(root, 'tools', 'p5shot.mjs'), 'utf8');
const prog = shotSrc.slice(shotSrc.indexOf('String.raw`') + 11, shotSrc.indexOf('\n`;', shotSrc.indexOf('String.raw`')) + 1);
const w = +opt('--w', 1440), h = +opt('--h', 900), steps = +opt('--steps', 20), fastMs = +opt('--fast', 0);
const set = { tab: 'timing', trace: false, speedPos: fastMs ? 90 : opt('--run') ? 60 : 30, speedSet: true, cpu: opt('--model', '80586') };
if (opt('--sample')) set.sample = opt('--sample'); else { set.src = prog; set.sample = 'custom'; }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')); });
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
await page.setViewport({ width: w, height: h });
await page.evaluateOnNewDocument(s => { localStorage.clear(); for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(opt('--file')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const out = opt('--out');
if (opt('--until')) {
  // run the machine (with no views) to the first instruction whose bytes at CS:IP start with these hex bytes
  const r0 = await page.evaluate(hexs => {
    const m = window.__app.machine, c = m.cpu, want = hexs.split(',').map(x => parseInt(x, 16));
    for (let n = 0; n < 2000000; n++) {
      const a = ((c.sregs[1] << 4) + c.ip) >>> 0;
      if (!c.pairNext && want.every((b, k) => m.mem[a + k] === b)) return 'at ' + a.toString(16) + ' after ' + n;
      m.tickDevices(c.step());
    }
    return 'not found';
  }, opt('--until'));
  console.log('[until]', r0);
}
if (fastMs) {
  await page.click('#btn-run'); await sleep(fastMs);
  await page.screenshot({ path: out + '_fast.png' });
  await page.click('#btn-run'); await sleep(800);
} else if (opt('--run')) {
  await page.click('#btn-run'); await sleep(+opt('--run'));
  await page.click('#btn-run'); await sleep(800);
} else {
  for (let i = 0; i < steps; i++) { await page.click('#btn-step'); await sleep(250); }
  await sleep(1500);
}
const r = await page.evaluate((z, card) => {
  const v = window.__app.views.timing;
  if (z) v.zoomBy(+z);
  if (card) v.openCard(card, false);
  return { m586: v.m586, m486: v.m486, notes: v.notes.length, pipe: v.xnotes ? v.xnotes.pipe.length : -1, btb: v.xnotes ? v.xnotes.btb.map(n => n.text) : [] };
}, opt('--zoom', null), opt('--card', null));
console.log('[view]', JSON.stringify(r));
if (args.includes('--texts')) {
  const t = await page.evaluate(() => {
    const v = window.__app.views.timing, out = [], seen = new Set();
    for (const r of v.flat) out.push('TIP ' + v.nameTip(r));
    for (let p = Math.max(v.firstLive(), v.head - 60); p < v.head; p++) {
      if (!v.validPos(p)) continue;
      for (const r of v.flat) {
        const w = v.meaning(r, p, v.sampleF(r)), k = r.id + '|' + w.t.replace(/[0-9A-F]{4,}h?/g, '#');
        if (seen.has(k)) continue;
        seen.add(k); out.push(`${r.id} = ${w.v}: ${w.t.split(String.fromCharCode(10)).join(' / ')}`);
      }
    }
    for (const id of ['pipe', 'btb', 'cache', 'd', 'be', 'cachen']) { v.openCard(id, false); v.renderCard(); out.push('CARD ' + id + ': ' + v.cardBody.textContent.slice(0, 300)); }
    out.push('SIDE ' + v.sideHtml(v.lastRevealed()).replace(/<[^>]+>/g, ' ').slice(0, 600));
    return out;
  });
  for (const x of t) console.log(x);
}
await sleep(900);
await page.screenshot({ path: out + '.png' });
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
