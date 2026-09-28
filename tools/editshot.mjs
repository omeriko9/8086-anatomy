// Browser test of the disk file editor: load a DOS image, edit CONFIG.SYS, save & reboot.
// Usage: MODEL=80286 node tools/editshot.mjs [image]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const img = process.argv[2] || 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files/msdos/dos6.img';
if (!fs.existsSync(img)) { console.log('skip: no image'); process.exit(0); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
await page.setViewport({ width: 1440, height: 900 });
if (process.env.MODEL) await page.evaluateOnNewDocument(m => { try { localStorage.setItem('a86:cpu', JSON.stringify(m)); } catch (e) { /* */ } }, process.env.MODEL);
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);
await page.evaluate(() => __app.selectTab('memory'));   // a light view keeps the headless page fast
await page.click('#ptab-disks');
const [ch] = await Promise.all([page.waitForFileChooser(), page.click('#drive-0 [data-act=load]')]);
await ch.accept([img]);
await sleep(600);
// open CONFIG.SYS from the list
const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('#drive-0-files button')].find(x => x.textContent.startsWith('CONFIG.SYS'));
  if (!b) return 'no CONFIG.SYS in the list';
  b.click();
  return document.getElementById('fedit').open ? 'open' : 'not open';
});
console.log('editor:', opened);
await page.screenshot({ path: path.join(root, 'tools', 'edit1.png') });
// change the CD driver line, like a user would, through the textarea
await page.evaluate(() => {
  const t = document.getElementById('fedit-text');
  t.value = t.value.replace(/^DEVICE=cd1\.SYS \/D:banana$/m, 'REM DEVICE=cd1.SYS /D:banana');
  t.dispatchEvent(new Event('input'));
});
await page.click('#fedit-reboot');
const t0 = Date.now();
let screen = '';
while (Date.now() - t0 < 90000) {
  await sleep(1000);
  screen = await page.evaluate(() => {
    const v = __app.machine.vram(); const out = [];
    for (let r = 0; r < 25; r++) { let s = ''; for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(r * 80 + c) * 2] || 32); out.push(s.trimEnd()); }
    return out.join('\n');
  });
  if (/A:\\>\s*$/.test(screen.trimEnd())) break;
}
console.log(screen.trimEnd().split('\n').filter(l => l.trim()).map(l => '  | ' + l).join('\n'));
console.log('status:', await page.$eval('#disk-status', e => e.textContent));
const cfg = await page.evaluate(() => {
  document.querySelector('#drive-0-files button') && [...document.querySelectorAll('#drive-0-files button')].find(x => x.textContent.startsWith('CONFIG.SYS')).click();
  const v = document.getElementById('fedit-text').value;
  document.getElementById('fedit-cancel').click();
  return v;
});
const NL = String.fromCharCode(10);
console.log('CONFIG.SYS after the save (reopened in the editor):' + NL + cfg.split(NL).map(l => '    ' + JSON.stringify(l)).join(NL));
await page.screenshot({ path: path.join(root, 'tools', 'edit2.png') });
console.log('errors:', errors);
await browser.close();
