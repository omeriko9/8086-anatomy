// Top view and the floppy drives: load a DOS image into A:, boot from A: at a slow clock,
// zoom to the drives and the disk card, and take screenshots.
// Usage: node tools/topdisk.mjs [image] [--model 80286] [--speed 75] [--secs 8] [--timing real]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const img = args[0] && !args[0].startsWith('--') ? args[0] : 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files/msdos.img';
if (!fs.existsSync(img)) { console.log('skip: no image'); process.exit(0); }
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
page.on('console', async m => { if (m.type() === 'error') { errors++; let t = m.text(); try { t = (await Promise.all(m.args().map(a => a.evaluate(x => x instanceof Error ? x.stack : String(x))))).join(' '); } catch (e) { /* keep */ } console.log('[console.error]', t); } });
await page.setViewport({ width: 1440, height: 900 });
const set = { tab: 'top', trace: false, codeHidden: false, dockHidden: true, pane: 'disks', monMin: true };
if (opt('--model')) set.cpu = opt('--model');
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const [ch] = await Promise.all([page.waitForFileChooser(), page.click('#drive-0 [data-act=load]')]);
await ch.accept([img]);
await sleep(800);
await page.evaluate(t => { if (t) __app.machine.diskTiming = t; }, opt('--timing', ''));
await page.click('#btn-boot-disk');
await sleep(300);
await page.evaluate(p => { const s = document.getElementById('speed'); s.value = p; s.dispatchEvent(new Event('input')); }, +opt('--speed', 75));
await page.evaluate(() => {
  const t = __app.views.top;
  t.follow = false; t.syncFollow(); t.userMoved = true;
  const d = t.drives[0], c = t.cards.find(x => x.title === 'FLOPPY CONTROLLER');
  t.fitBox({ x0: d.x - d.w / 2 - 0.5, x1: c ? c.x + c.len / 2 : d.x + 12, z0: (c ? c.z - c.h / 2 : d.z - 6) - 1, z1: d.z + d.h / 2 + 0.5 }, true);
});
const box = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
for (let i = 0; i < 4; i++) {
  await sleep(+opt('--secs', 8) * 250);
  await page.evaluate(() => {
    const t = __app.views.top, d = t.drives[0];
    t.follow = false; t.syncFollow(); t.userMoved = true;
    const c = t.cards.find(x => x.title === 'FLOPPY CONTROLLER'); t.fitBox({ x0: d.x - d.w / 2 - 0.3, x1: c ? c.x + c.len / 2 : d.x + 12, z0: (c ? c.z - c.h / 2 : d.z - 6) - 0.5, z1: d.z + d.h / 2 + 0.3 }, true);
  });
  await sleep(300);
  const st = await page.evaluate(() => { const t = __app.views.top, s = t.driveState(0), m = __app.machine; return `cyl ${s.cyl} head ${s.head} sector ${s.sector} motor ${s.motor} reading ${s.reading} ${s.simple ? '(simple model)' : '(uPD765)'} · fdc ${m.fdc ? m.fdc.phase + ' ' + (m.fdc.cmd || '') : '-'} · sigs ${t.sigs.length} jobs ${t.jobs.length} · ${document.getElementById('now-text').textContent}`; });
  console.log(i, st);
  await page.screenshot({ path: path.join(root, 'tools', `td_${i}.png`), clip: box });
}
console.log('screen:', await page.evaluate(() => { const v = __app.machine.vram(); const out = []; for (let r = 0; r < 25; r++) { let s = ''; for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(r * 80 + c) * 2] || 32); if (s.trim()) out.push(s.trimEnd()); } return out.slice(-3).join(' / '); }));
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
