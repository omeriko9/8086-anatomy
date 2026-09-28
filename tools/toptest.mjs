// Top view checks: see all, a chip that fills the view, trace steps, normal run.
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
page.on('console', async m => { if (m.type() === 'error') { errors++; let t = m.text(); try { t = (await Promise.all(m.args().map(a => a.evaluate(x => x instanceof Error ? x.stack : String(x))))).join(' '); } catch (e) { /* keep */ } console.log('[console.error]', t); } });
await page.setViewport({ width: +opt('--w', 1440), height: +opt('--h', 900) });
const set = { tab: 'top', trace: opt('--trace', 'true') === 'true', codeHidden: true, dockHidden: true, speedPos: +opt('--speed', 30), motion: +opt('--motion', 6) };
if (opt('--model')) set.cpu = opt('--model');
if (opt('--video')) set.video = opt('--video');
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const box = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const shot = n => page.screenshot({ path: path.join(root, 'tools', `tt_${n}.png`), clip: box });
const pre = opt('--prefix', '');
await shot(pre + 'all');
if (opt('--chip')) {
  await page.evaluate(k => { const t = __app.views.top; t.follow = false; t.syncFollow(); t.fitChip(t.byKey.get(k), true); t.userMoved = true; }, opt('--chip'));
  await sleep(1200);
  await shot(pre + 'chip');
}
for (let i = 0; i < +opt('--steps', 0); i++) {
  await page.click('#trace-next');
  await sleep(+opt('--gap', 1500));
  const st = await page.evaluate(() => { const t = __app.views.top, at = t.tr && t.trAt(); return (__app.play && __app.play.story ? (__app.play.si + 1) + '/' + __app.play.story.steps.length + ' ' + __app.play.story.steps[__app.play.si].title : '-') + ' · ' + (at ? at.sg.kind + (at.sg.block ? ':' + at.sg.block : '') : '-') + ' · zoom ' + t.view.z.toFixed(1); });
  console.log('step', i + 1, st);
  await shot(pre + 's' + (i + 1));
}
if (opt('--run')) {
  await page.click('#btn-run');
  await sleep(+opt('--run'));
  await shot(pre + 'run');
  await page.click('#btn-run');
}
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
