// Trace zoom: during an address step, turn the wheel toward the active unit and take
// screenshots; hover the die and check that no chip tooltip shows.
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
await page.setViewport({ width: 1440, height: 900 });
const set = { tab: 'board', speed: 3, trace: true, codeHidden: true, dockHidden: true, motion: 1 };
if (opt('--model')) set.cpu = opt('--model');
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(opt('--file', path.join(root, 'dist', '8086-anatomy.html'))).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
for (let i = 0; i < +opt('--skip', 6); i++) { await page.click('#trace-next'); await sleep(80); }
await page.click('#trace-next');
await sleep(2500);
const box = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const info = () => page.evaluate(() => { const b = __app.views.board; return `r ${b.cam.r.toFixed(2)} zoom ${(b.trZoom || 1).toFixed(2)} tip ${b.tip.classList.contains('bv-on')}`; });
console.log('before:', await info());
await page.screenshot({ path: path.join(root, 'tools', 'zt_0.png'), clip: box });
await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: -120 }); await sleep(120); }
await sleep(2500);
console.log('zoomed:', await info());
await page.screenshot({ path: path.join(root, 'tools', 'zt_1.png'), clip: box });
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
