// Focus mode and fine speed: focus the VGA controller on the 80286 board, drag with the
// left button (move) and the right button (turn), check what hides, then Esc.
// Also set fine speed positions and read the labels.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, { tab: 'board', cpu: opt('--model', '80286'), video: 'vga', trace: false, codeHidden: true, dockHidden: true });
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
// fine speed
for (const v of [70, 75, 79, 80, 84, 85, 89, 90, 65]) {
  const r = await page.evaluate(v => { const s = document.getElementById('speed'); s.value = v; s.dispatchEvent(new Event('input')); return `${v} -> pos ${__app.speedPos} ${__app.spd.mode} ${__app.spd.label}`; }, v);
  console.log('speed', r);
}
await page.evaluate(() => { const s = document.getElementById('speed'); s.value = 85; s.dispatchEvent(new Event('input')); });
await page.click('#btn-run');
await sleep(3000);
console.log('effective:', await page.evaluate(() => document.getElementById('st-speed').textContent));
await page.click('#btn-run');
// focus
const key = opt('--chip', 'vgac');
await page.evaluate(k => __app.views.board.focusChip(k), key);
await sleep(3000);
const info = () => page.evaluate(() => { const b = __app.views.board; const hid = [...(b.focusHidden || [])].map(o => o.name || o.type + (o.userData.pick ? ':' + o.userData.pick : '') + (o === b.xcard ? ':xcard' : o === b.card ? ':card' : o === b.dcard ? ':dcard' : '')); return `focus ${b.focus ? b.focus.name : '-'} · pill ${!b.focusPill.hidden} · hidden ${hid.length}: ${hid.slice(0, 8).join(', ')}`; });
console.log('focus:', await info());
const box = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
await page.screenshot({ path: path.join(root, 'tools', 'fo_1.png'), clip: box });
// right drag: turn to the side
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 10; i++) { await page.mouse.move(cx + i * 30, cy + i * 8); await sleep(30); }
await page.mouse.up({ button: 'right' });
await sleep(2000);
console.log('after turn:', await info());
await page.screenshot({ path: path.join(root, 'tools', 'fo_2.png'), clip: box });
// left drag: move the view
await page.mouse.move(cx, cy); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(cx - i * 25, cy); await sleep(30); }
await page.mouse.up();
await sleep(1500);
console.log('after move:', await info());
await page.screenshot({ path: path.join(root, 'tools', 'fo_3.png'), clip: box });
await page.keyboard.press('Escape');
await sleep(800);
console.log('after Esc:', await info());
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
