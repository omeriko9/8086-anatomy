// Film strip of the trace mode: frames of the Board stage during Run, in one image.
// Usage: node tools/filmstrip.mjs [out.png] [--model 80286] [--video vga] [--frames 12] [--gap 300] [--speed 3] [--skip 0]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] && !args[0].startsWith('--') ? args[0] : path.join(root, 'tools', 'film.png');
const frames = +opt('--frames', 12), gap = +opt('--gap', 300);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
await page.setViewport({ width: 1440, height: 900 });
const set = { tab: 'board', speed: +opt('--speed', 3), trace: true, codeHidden: true, dockHidden: true };
if (opt('--model')) set.cpu = opt('--model');
if (opt('--video')) set.video = opt('--video');
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(opt('--file', path.join(root, 'dist', '8086-anatomy.html'))).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
for (let i = 0; i < +opt('--skip', 0); i++) { await page.click('#trace-next'); await sleep(60); }
await page.click('#btn-run');
const box = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const shots = [];
for (let i = 0; i < frames; i++) {
  const b64 = await page.screenshot({ clip: box, encoding: 'base64' });
  const cap = await page.evaluate(() => document.getElementById('now-micro').textContent);
  shots.push({ b64, cap });
  await sleep(gap);
}
await page.click('#btn-run');
const cols = 3;
const html = `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;font:13px monospace;color:#fff">` +
  shots.map((s, i) => `<figure style="margin:0;position:relative"><img src="data:image/png;base64,${s.b64}" style="width:100%;display:block"><figcaption style="position:absolute;left:6px;top:4px;background:#000a;padding:2px 6px">${i * gap} ms · ${s.cap}</figcaption></figure>`).join('') + '</body>';
const p2 = await browser.newPage();
await p2.setViewport({ width: 1800, height: 400 });
await p2.setContent(html);
await sleep(300);
await p2.screenshot({ path: out, fullPage: true });
console.log(`[film] ${out}, ${frames} frames, errors: ${errors}`);
await browser.close();
process.exitCode = errors ? 1 : 0;
