// Trace "Repeats: once" and Skip: run the Hello sample in trace mode and check that the
// loops run fast and the program still prints its text.
// Usage: node tools/fftest.mjs [--file dist/x.html] [--model 80286] [--secs 25]
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
page.on('console', async m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
await page.setViewport({ width: 1200, height: 760 });
const set = { tab: 'memory', speed: 6, trace: true, traceRep: 'once', sample: 'hello' };
if (opt('--model')) set.cpu = opt('--model');
if (args.includes('--loops')) { set.sample = 'custom'; set.src = ['org 0x100', ' mov cx, 20', ' mov si, 0x100', ' mov di, 0x400', ' rep movsb', ' mov cx, 6', ' xor ax, ax', 'l: add ax, cx', ' loop l', ' mov [0x500], ax', ' ret'].join(String.fromCharCode(10)); }
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(opt('--file', path.join(root, 'dist', '8086-anatomy.html'))).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const screen = () => page.evaluate(() => { const v = __app.machine.vram(); const out = []; for (let r = 0; r < 25; r++) { let s = ''; for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(r * 80 + c) * 2] || 32); if (s.trim()) out.push(s.trimEnd()); } return out.join('\n'); });
await page.click('#btn-run');
const notes = new Set(); let last = null;
const t0 = Date.now();
while (Date.now() - t0 < +opt('--secs', 25) * 1000) {
  await sleep(700);
  const t = await page.evaluate(() => document.getElementById('trace-text').textContent);
  if (/^(Fast|Skip)/.test(t)) notes.add(t.slice(0, 110));
  const st = await page.evaluate(() => ({ ff: __app.ff ? __app.ff.why + ' ' + __app.ff.n : '', ip: __app.machine.physIP.toString(16), n: __app.traceCount, running: __app.running, text: __app.play && __app.play.text }));
  if (st.ff) notes.add('ff ' + st.ff.split(' ')[0]);
  last = st;
  if (!st.running) break;
}
console.log('last', JSON.stringify(last)); console.log('notes:\n  ' + [...notes].join('\n  '));
console.log('screen:\n' + (await screen()));
// Skip test: pause, reset, press S at the INT 10h line
await page.click('#btn-run').catch(() => {});
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
