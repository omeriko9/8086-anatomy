// Private zoom screenshot: node tools/tm/zshot.mjs out.png [--model 80286] [--w --h] [--scale 2] [--sel css] [--reduced] --eval js [--after ms] ...
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire('C:/Users/Omer/Dropbox/Documents/8086/tools/package.json');
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage();
let errors = 0;
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message, e.stack); });
await page.setViewport({ width: +opt('--w', 1440), height: +opt('--h', 900), deviceScaleFactor: +opt('--scale', 1) });
const model = opt('--model', null);
if (model) await page.evaluateOnNewDocument(m => { try { localStorage.setItem('a86:cpu', JSON.stringify(m)); } catch (e) {} }, model);
if (args.includes('--reduced')) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.goto(pathToFileURL(opt('--file', 'C:/Users/Omer/Dropbox/Documents/8086/tools/tm/tm.html')).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, +opt('--wait', 1500)));
for (const js of args.filter((a, i) => args[i - 1] === '--eval')) {
  const r = await page.evaluate(async src => { try { return await (0, eval)(src); } catch (e) { return 'EVAL ERROR ' + e.message + e.stack; } }, js);
  if (r !== undefined && r !== '') console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
  await new Promise(r => setTimeout(r, +opt('--after', 800)));
}
const sel = opt('--sel', null);
let c;
if (sel) c = await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, sel);
await page.screenshot({ path: args[0], clip: c });
console.log('[shot]', args[0], 'errors', errors);
await browser.close();
