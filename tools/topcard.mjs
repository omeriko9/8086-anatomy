// Top view and the video card: play real video bus cycles (video RAM write, CRTC and mode
// ports, DAC, status read, video BIOS) on the view, and take screenshots of the card.
// Usage: node tools/topcard.mjs [--video vga] [--model 80286]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
page.on('console', async m => { if (m.type() === 'error') { errors++; let t = m.text(); try { t = (await Promise.all(m.args().map(a => a.evaluate(x => x instanceof Error ? x.stack : String(x))))).join(' '); } catch (e) { /* keep */ } console.log('[console.error]', t); } });
await page.setViewport({ width: 1440, height: 900 });
const vga = opt('--video') === 'vga';
const set = { tab: 'top', trace: false, codeHidden: true, dockHidden: true, speedPos: 20 };
if (opt('--model')) set.cpu = opt('--model');
if (vga) set.video = 'vga';
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const box = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const EV = vga ? [
  { k: 'bus', t: 0, type: 'memw', addr: 0xA0010, data: 0x3C, width: 1, dev: 'vram', owner: 'cpu', seg: 'ES' },
  { k: 'bus', t: 4, type: 'iow', addr: 0x3C9, data: 0x2A, width: 1, dev: 'vga', owner: 'cpu' },
  { k: 'bus', t: 8, type: 'iow', addr: 0x3D5, data: 0x0E, width: 1, dev: 'vga', owner: 'cpu' },
  { k: 'bus', t: 12, type: 'memr', addr: 0xC0003, data: 0x55, width: 1, dev: 'vrom', owner: 'cpu', seg: 'DS' },
] : [
  { k: 'bus', t: 0, type: 'memw', addr: 0xB8010, data: 0x41, width: 1, dev: 'vram', owner: 'cpu', seg: 'ES' },
  { k: 'bus', t: 4, type: 'iow', addr: 0x3D4, data: 0x0E, width: 1, dev: 'crtc', owner: 'cpu' },
  { k: 'bus', t: 8, type: 'iow', addr: 0x3D8, data: 0x29, width: 1, dev: 'cga', owner: 'cpu' },
  { k: 'bus', t: 12, type: 'ior', addr: 0x3DA, data: 0x09, width: 1, dev: 'cga', owner: 'cpu' },
];
const targets = await page.evaluate(evs => {
  const t = __app.views.top;
  t.follow = false; t.syncFollow();
  const card = t.cards[0];
  t.fitBox({ x0: card.x - card.len / 2 - 0.5, x1: card.x + card.len / 2 + 0.5, z0: card.z - card.h / 2 - 0.3, z1: t.rail.z + 2 }, true);
  t.userMoved = true;
  return t.demo(evs, 250);
}, EV);
console.log('targets:', targets.join(' | '));
let prev = 0;
for (const [k, ms] of [700, 1600, 2600, 3600].entries()) {
  await sleep(ms - prev); prev = ms;
  const st = await page.evaluate(() => { const t = __app.views.top; return `sigs ${t.sigs.length} jobs ${t.jobs.length}: ${[...new Set(t.jobs.map(j => j.p.key + ':' + j.label))].join(', ')}`; });
  console.log(ms, st);
  await page.screenshot({ path: path.join(root, 'tools', `tc_${vga ? 'vga' : 'cga'}_${k}.png`), clip: box });
}
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
