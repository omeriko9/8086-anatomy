// Trace Skip: step to the INT 10h line of the Hello sample, push S, and check that the
// trace continues at the next line of the program (the BIOS routine ran fast).
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
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
await page.setViewport({ width: 1200, height: 760 });
const set = { tab: 'memory', speed: 6, trace: true, traceRep: 'once', sample: 'hello' };
if (opt('--model')) set.cpu = opt('--model');
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(opt('--file', path.join(root, 'dist', '8086-anatomy.html'))).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const text = () => page.evaluate(() => (__app.play ? __app.play.text : '-') + ' | ' + document.getElementById('trace-text').textContent.slice(0, 90));
for (let i = 0; i < 12; i++) {
  const t = await text();
  if (t.startsWith('int 0x10')) break;
  await page.evaluate(() => __app.stepInstr());
  await sleep(300);
}
console.log('before:', await text());
await page.keyboard.press('s');
await sleep(2500);
console.log('after S:', await text());
await page.keyboard.press('s');
await sleep(2500);
console.log('after S:', await text());
console.log('screen row 5:', await page.evaluate(() => { const v = __app.machine.vram(); let s = ''; for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(5 * 80 + c) * 2] || 32); return s.trimEnd(); }));
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
