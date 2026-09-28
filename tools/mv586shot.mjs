// A close picture of one part of the Memory tab (for the Pentium work).
// Usage: node tools/mv586shot.mjs --file page.html --out pic.png [--src prog.asm] [--model 80586]
//          [--run ms] [--sel .mv-root] [--scale 2] [--w 1440] [--h 900] [--eval "js"]
// The page runs the program in fast mode for --run ms, then stops; then the picture of --sel.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const set = { tab: 'memory', trace: false, speedPos: 90, speedSet: true, cpu: opt('--model', '80586'), sample: 'custom' };
if (opt('--src')) set.src = fs.readFileSync(opt('--src'), 'utf8');
if (opt('--sample')) set.sample = opt('--sample');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
await page.setViewport({ width: +opt('--w', 1440), height: +opt('--h', 900), deviceScaleFactor: +opt('--scale', 2) });
await page.evaluateOnNewDocument(s => { localStorage.clear(); for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(opt('--file')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const run = +opt('--run', 0);
if (run) { await page.click('#btn-run'); await sleep(run); await page.click('#btn-run'); await sleep(600); }
if (opt('--eval')) {
  const r = await page.evaluate(async s => { try { return await (0, eval)(s); } catch (e) { return 'EVAL ERROR ' + e.message; } }, opt('--eval'));
  console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
  await sleep(600);
}
const el = await page.$(opt('--sel', '.mv-root'));
await (el || page).screenshot({ path: opt('--out') });
console.log('[shot]', opt('--out'), 'errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
