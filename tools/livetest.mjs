// Live unit drawings outside the trace: Trace off, focus the CPU die, run slowly and take
// screenshots; count the unit overlays that show.
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
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, { tab: 'board', cpu: opt('--model', '8086'), trace: false, speedPos: +opt('--speed', 20), codeHidden: true, dockHidden: true });
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
await page.evaluate(k => __app.views.board.focusChip(k), opt('--chip', 'cpu'));
await sleep(2500);
await page.click('#btn-run');
const box = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
for (let i = 0; i < 3; i++) {
  await sleep(1500);
  const n = await page.evaluate(() => { const b = __app.views.board; return `jobs ${(b.liveJobs || []).length} overlays ${[...(b.uFx ? b.uFx.values() : [])].filter(o => o.v > 0.1).length} detail ${b.dtMesh ? b.dtMesh.visible : '-'} ${__app.play ? __app.play.text : ''}`; });
  console.log(i, n);
  await page.screenshot({ path: path.join(root, 'tools', `lv_${i}.png`), clip: box });
}
// zoom in deep with the wheel and measure the time to the sharp die picture
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
for (let i = 0; i < 10; i++) { await page.mouse.wheel({ deltaY: -150 }); await sleep(40); }
const t0 = Date.now();
let sharp = false;
while (Date.now() - t0 < 6000) {
  sharp = await page.evaluate(() => { const b = __app.views.board; return !!(b.dtMesh && b.dtMesh.visible && b.detail && b.detail.key); });
  if (sharp) break;
  await sleep(100);
}
console.log('sharp after', Date.now() - t0, 'ms:', sharp, await page.evaluate(() => 'r ' + __app.views.board.cam.r.toFixed(2)));
await page.screenshot({ path: path.join(root, 'tools', 'lv_zoom.png'), clip: box });
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
