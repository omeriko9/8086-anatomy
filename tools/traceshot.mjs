// Headless check of the trace mode on the Board tab: Next / Back, the step panel, run.
// Usage: node tools/traceshot.mjs [--model 80286] [--video vga] [--w 1440] [--h 900] [--steps 6] [--prefix tr]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const w = +opt('--w', 1440), h = +opt('--h', 900), steps = +opt('--steps', 6), prefix = opt('--prefix', 'tr');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
page.on('console', async m => { if (m.type() === 'error') { errors++; let t = m.text(); try { t = (await Promise.all(m.args().map(a => a.evaluate(x => x instanceof Error ? x.stack : String(x))))).join(' '); } catch (e) { /* keep */ } console.log('[console.error]', t); } });
await page.setViewport({ width: w, height: h });
const set = { tab: 'board', speed: 3, trace: true };
if (opt('--model')) set.cpu = opt('--model');
if (opt('--video')) set.video = opt('--video');
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(opt('--file', path.join(root, 'dist', '8086-anatomy.html'))).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const panel = () => page.evaluate(() => ({
  hidden: document.getElementById('trace').hidden,
  instr: document.getElementById('trace-instr').textContent,
  count: document.getElementById('trace-count').textContent,
  title: document.getElementById('trace-stitle').textContent,
  text: document.getElementById('trace-text').textContent,
  tok: document.querySelector('.bv-tok') ? document.querySelector('.bv-tok').textContent : '',
  labs: [...document.querySelectorAll('.bv-lab')].filter(x => x.style.opacity === '1').map(x => x.textContent),
}));
console.log('start', JSON.stringify(await panel()));
for (let i = 0; i < steps; i++) {
  await page.click('#trace-next');
  await sleep(1400);
  const p = await panel();
  console.log(`next ${i + 1}: [${p.count}] ${p.instr} · ${p.title} · tok ${p.tok} · labels ${p.labs.join(' | ')}`);
  console.log('   ', p.text);
  if (i === 2 || i === steps - 1) await page.screenshot({ path: path.join(root, 'tools', `${prefix}_${i + 1}.png`) });
}
await page.click('#trace-prev');
await sleep(900);
console.log('back:', JSON.stringify((await panel()).count));
// run for a while in trace mode
await page.click('#btn-run');
await sleep(5000);
await page.screenshot({ path: path.join(root, 'tools', `${prefix}_run.png`) });
const p = await panel();
console.log(`run: [${p.count}] ${p.instr} · ${p.title}`);
await page.click('#btn-run');
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
