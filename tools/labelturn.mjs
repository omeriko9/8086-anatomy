// Die labels on turned chips: zoom on a DRAM chip with rot in the Top view and in the
// Board 3D, and take screenshots (tools/out/labelturn-*.png). No label may be upside down.
// Usage: node tools/labelturn.mjs [--model 80286] [--key <chip key>]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.join(root, 'tools', 'out');
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
await page.setViewport({ width: 1440, height: 900 });
const set = { tab: 'top', trace: false, codeHidden: true, dockHidden: true };
if (opt('--model')) set.cpu = opt('--model');
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const key = await page.evaluate(want => {
  const t = __app.views.top;
  t.follow = false; t.syncFollow();
  const p = want ? t.byKey.get(want) : t.parts.find(q => q.rot && /41|44|4464/.test(q.part));
  const r = t.pkgRect(p), cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, hw = (r.x1 - r.x0) * 0.35;
  t.fitBox({ x0: cx - hw, x1: cx + hw, z0: cz - hw * 0.6, z1: cz + hw * 0.6 }, true);
  return p.key + ' ' + p.part;
}, opt('--key'));
console.log('top chip', key);
await sleep(1500);
await page.screenshot({ path: path.join(out, 'labelturn-top.png') });
await page.evaluate(k => { __app.selectTab('board'); }, key);
await sleep(1500);
await page.evaluate(k => { const b = __app.views.board; b.focusChip(k.split(' ')[0]); }, key);
await sleep(4000);
await page.screenshot({ path: path.join(out, 'labelturn-board.png') });
console.log('errors:', errors);
await browser.close();
