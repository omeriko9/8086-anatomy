// Die tab zoom / pan / double-click test with real mouse and touch events.
// Usage: node tools/dz/dztest.mjs [--model 80286] [--trace false] [--phone] [--tag name]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const model = opt('--model', '8086'), trace = opt('--trace', 'true') !== 'false', phone = args.includes('--phone');
const tag = opt('--tag', `${model}_${trace ? 'tr' : 'nt'}${phone ? '_ph' : ''}`);
const shot = n => path.join(here, `${tag}_${n}.png`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
let errors = 0;
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
await page.setViewport(phone ? { width: 360, height: 780, deviceScaleFactor: 1, hasTouch: true, isMobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((m, t) => {
  try { localStorage.setItem('a86:cpu', JSON.stringify(m)); localStorage.setItem('a86:trace', JSON.stringify(t)); } catch (e) { /* */ }
}, model, trace);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href, { waitUntil: 'load' });
await sleep(2500);
await page.evaluate(() => __app.selectTab('die'));
await sleep(800);
const st = () => page.evaluate(() => {
  const v = __app.views.die;
  return { z: +v.zv.z.toFixed(3), vb: v.svg.getAttribute('viewBox'), tip: v.tip.classList.contains('dv-on'), tab: __app.activeTab };
});
const box = id => page.evaluate(i => {
  const g = document.querySelector(`#view-die [data-id="${i}"]`);
  const r = (g.querySelector('.dv-frame') || g).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, id);
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) errors++; };

await page.screenshot({ path: shot('1fit') });
let s0 = await st();
console.log('start', s0);
const regs = await box('regs');

if (!phone) {
  // wheel zoom at the pointer
  await page.mouse.move(regs.x, regs.y);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: -200 }); await sleep(60); }
  await sleep(200);
  const s1 = await st();
  const regs1 = await box('regs');
  ok(s1.z > 2, `wheel zoom in: z=${s1.z}`);
  ok(Math.hypot(regs1.x - regs.x, regs1.y - regs.y) < 12, `point under the pointer stays: ${regs.x.toFixed(0)},${regs.y.toFixed(0)} -> ${regs1.x.toFixed(0)},${regs1.y.toFixed(0)}`);
  await page.screenshot({ path: shot('2wheel') });
  // a simple click still selects (no pan)
  await page.mouse.click(regs1.x, regs1.y);
  await sleep(250);
  let s2 = await st();
  ok(s2.tip && s2.vb === s1.vb, 'click selects, no pan');
  // drag pan
  await page.mouse.move(regs1.x, regs1.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(regs1.x + i * 15, regs1.y + i * 8); await sleep(16); }
  await page.mouse.up();
  await sleep(250);
  const s3 = await st();
  const regs3 = await box('regs');
  ok(s3.vb !== s1.vb && !s3.tip, `drag pans (${s1.vb} -> ${s3.vb}), tip hidden`);
  ok(Math.abs(regs3.x - regs1.x - 150) < 6 && Math.abs(regs3.y - regs1.y - 80) < 6, `content follows the drag: dx=${(regs3.x - regs1.x).toFixed(1)} dy=${(regs3.y - regs1.y).toFixed(1)}`);
  await page.screenshot({ path: shot('3pan') });
  // keys
  await page.evaluate(() => document.querySelector('#view-die .dv-svg').focus());
  await page.keyboard.press('0'); await sleep(400);
  ok((await st()).z === 1, 'key 0 fits');
  await page.keyboard.press('+'); await sleep(400);
  const s4 = await st();
  ok(s4.z > 1.5, `key + zooms: ${s4.z}`);
  await page.keyboard.press('-'); await sleep(700);
  { const z = (await st()).z; ok(z === 1, 'key - zooms out: ' + z); }
  // buttons
  await page.click('#view-die .dv-zb:nth-of-type(2)'); await sleep(400);
  const s5 = await st();
  ok(s5.z > 1.5, `+ button: ${s5.z}`);
  await page.screenshot({ path: shot('4btn') });
  await page.click('#view-die .dv-zb:last-child'); await sleep(400);
  ok((await st()).z === 1, 'fit button');
  // zoom max
  await page.mouse.move(regs.x, regs.y);
  for (let i = 0; i < 20; i++) { await page.mouse.wheel({ deltaY: -400 }); await sleep(20); }
  await sleep(200);
  const s6 = await st();
  ok(s6.z === 8, `zoom stops at 8: ${s6.z}`);
  await page.screenshot({ path: shot('5max') });
  await page.keyboard.press('0'); await sleep(400);
} else {
  // touch: pinch with two fingers, then a one-finger pan, then a double tap
  const cdp = await page.createCDPSession();
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  const c = [regs.x, regs.y];
  await T('touchStart', [[c[0] - 20, c[1]], [c[0] + 20, c[1]]]);
  for (let i = 1; i <= 10; i++) { await T('touchMove', [[c[0] - 20 - i * 8, c[1]], [c[0] + 20 + i * 8, c[1]]]); await sleep(16); }
  await T('touchEnd', []);
  await sleep(300);
  const s1 = await st();
  ok(s1.z > 2.5, `pinch zoom: z=${s1.z}`);
  await page.screenshot({ path: shot('2pinch') });
  await T('touchStart', [[c[0], c[1]]]);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [[c[0] - i * 10, c[1] - i * 5]]); await sleep(16); }
  await T('touchEnd', []);
  await sleep(300);
  const s2 = await st();
  ok(s2.vb !== s1.vb && !s2.tip, `one-finger pan: ${s2.vb}`);
  await page.screenshot({ path: shot('3pan') });
  // two-finger pan (same distance)
  await T('touchStart', [[c[0] - 30, c[1]], [c[0] + 30, c[1]]]);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [[c[0] - 30 + i * 6, c[1] + i * 4], [c[0] + 30 + i * 6, c[1] + i * 4]]); await sleep(16); }
  await T('touchEnd', []);
  await sleep(300);
  const s3 = await st();
  ok(s3.vb !== s2.vb && Math.abs(s3.z - s2.z) < 0.05, `two-finger pan keeps zoom: ${s3.z}`);
  await page.evaluate(() => __app.views.die.viewTo({ z: 1, cx: null, cy: null }, false));
  await sleep(200);
}

// double-click (or double tap) on a block: the Board tab opens and shows the part
const id = model === '80286' ? 'iq' : 'alu';
const b = await box(id);
if (phone) {
  await page.touchscreen.tap(b.x, b.y); await sleep(120);
  await page.touchscreen.tap(b.x, b.y);
} else {
  await page.mouse.click(b.x, b.y);
  await page.mouse.click(b.x, b.y, { clickCount: 2 });
}
await sleep(300);
const s7 = await st();
ok(s7.tab === 'board', `double-click on ${id} opens the board: ${s7.tab}`);
await sleep(3000);
await page.screenshot({ path: shot('6board') });
// the 8087 / 80287 register stack
await page.evaluate(() => __app.selectTab('die'));
await sleep(500);
const f = await box('f87neu');
if (phone) { await page.touchscreen.tap(f.x, f.y); await sleep(120); await page.touchscreen.tap(f.x, f.y); }
else { await page.mouse.click(f.x, f.y); await page.mouse.click(f.x, f.y, { clickCount: 2 }); }
await sleep(3300);
ok((await st()).tab === 'board', 'double-click on the FPU register stack opens the board');
await page.screenshot({ path: shot('7fpu') });
console.log(`${tag}: errors ${errors}`);
await browser.close();
process.exitCode = errors ? 1 : 0;
