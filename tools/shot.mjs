// Headless Chrome check of dist/8086-anatomy.html.
// Usage: node tools/shot.mjs [out.png] [--model 80286] [--video vga] [--w 1440] [--h 900] [--wait 2500] [--eval "js"] [--reduced]
// Prints console messages and page errors; exits 1 if any error was logged.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] && !args[0].startsWith('--') ? args[0] : path.join(root, 'tools', 'shot.png');
const w = +opt('--w', 1440), h = +opt('--h', 900), wait = +opt('--wait', 2500);
const evalJs = opt('--eval', null);
const file = opt('--file', path.join(root, 'dist', '8086-anatomy.html'));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
let errors = 0;
page.on('console', async m => {
  const t = m.type();
  if (t === 'error') errors++;
  let txt = m.text();
  try {
    const parts = await Promise.all(m.args().map(a => a.evaluate(x => x instanceof Error ? x.stack : (typeof x === 'object' ? JSON.stringify(x) : String(x)))));
    txt = parts.join(' ');
  } catch (e) { /* keep text */ }
  console.log(`[console.${t}] ${txt}`);
});
page.on('pageerror', e => { errors++; console.log(`[pageerror] ${e.message}`); });
await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
const model = opt('--model', null);
if (model) await page.evaluateOnNewDocument(m => { try { localStorage.setItem('a86:cpu', JSON.stringify(m)); } catch (e) { /* file origin */ } }, model);
const video = opt('--video', null);
if (video) await page.evaluateOnNewDocument(v => { try { localStorage.setItem('a86:video', JSON.stringify(v)); } catch (e) { /* file origin */ } }, video);
if (args.includes('--reduced')) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, wait));
if (evalJs) {
  const r = await page.evaluate(async (src) => { try { return await (0, eval)(src); } catch (e) { return 'EVAL ERROR ' + e.message; } }, evalJs);
  console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
  await new Promise(r => setTimeout(r, +opt('--after', 800)));
}
const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
if (scroll.sw > scroll.cw) console.log(`[layout] horizontal overflow: ${scroll.sw} > ${scroll.cw}`);
await page.screenshot({ path: out });
console.log(`[shot] ${out} (${w}x${h}), errors: ${errors}`);
await browser.close();
process.exitCode = errors ? 1 : 0;
