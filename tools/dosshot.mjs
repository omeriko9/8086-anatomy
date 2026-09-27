// Browser test: boot the user's DOS floppy in the page, copy a program to B:, run it.
// Usage: node tools/dosshot.mjs [page.html] [boot.img] [program.exe]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOS_DIR = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files';
const file = process.argv[2] || path.join(root, 'dist', '8086-anatomy.html');
const img = process.argv[3] || path.join(DOS_DIR, 'msdos.img');
const prog = process.argv[4] || path.join(DOS_DIR, 'CAT.EXE');
if (!fs.existsSync(img)) { console.log('skip: no image'); process.exit(0); }

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
let errors = 0;
page.on('console', m => { if (m.type() === 'error') errors++; if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
await page.setViewport({ width: 1440, height: 900 });
if (process.env.VIDEO) await page.evaluateOnNewDocument(v => { try { localStorage.setItem('a86:video', JSON.stringify(v)); } catch (e) { /* ignore */ } }, process.env.VIDEO);
if (process.env.MODEL) await page.evaluateOnNewDocument(m => { try { localStorage.setItem('a86:cpu', JSON.stringify(m)); } catch (e) { /* ignore */ } }, process.env.MODEL);
await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1200));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const screen = () => page.evaluate(() => {
  const v = __app.machine.vram(); const out = [];
  for (let r = 0; r < 25; r++) { let s = ''; for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(r * 80 + c) * 2] || 32); out.push(s.trimEnd()); }
  return out.join('\n').trimEnd();
});
async function waitFor(re, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (re.test(await screen())) return true; await sleep(250); }
  console.log('timeout waiting for', re); return false;
}
await page.click('#ptab-disks');
let [ch] = await Promise.all([page.waitForFileChooser(), page.click('#drive-0 [data-act=load]')]);
await ch.accept([img]);
await sleep(500);
if (fs.existsSync(prog)) {
  [ch] = await Promise.all([page.waitForFileChooser(), page.click('#drive-1 [data-act=new]').then(() => page.click('#drive-1 [data-act=add]'))]);
  await ch.accept([prog]);
  await sleep(500);
}
console.log('status:', await page.$eval('#disk-status', e => e.textContent));
await page.screenshot({ path: path.join(root, 'tools', 'dos0.png') });
await page.click('#btn-boot-disk');
await waitFor(/Enter new date/, 20000);
await page.focus('#crt');
await page.keyboard.press('Enter');
await waitFor(/Enter new time/, 10000);
await page.keyboard.press('Enter');
await waitFor(/A>\s*$/, 10000);
await page.keyboard.type('dir b:', { delay: 60 });
await page.keyboard.press('Enter');
await waitFor(/bytes free\s*\n*A>\s*$/, 20000);
await page.screenshot({ path: path.join(root, 'tools', 'dos1.png') });
console.log(await screen());
await page.keyboard.type('b:', { delay: 60 });
await page.keyboard.press('Enter');
await waitFor(/B>\s*$/, 10000);
await page.keyboard.type(path.basename(prog, path.extname(prog)).toLowerCase(), { delay: 60 });
await page.keyboard.press('Enter');
await sleep(6000);
const st = await page.evaluate(() => ({ mode: __app.machine.crtc ? __app.machine.crtc.mode.toString(16) : JSON.stringify(__app.machine.vga.mode), pal: __app.machine.crtc ? __app.machine.crtc.color.toString(16) : '-', csip: __app.machine.cpu.sregs[1].toString(16) + ':' + __app.machine.cpu.ip.toString(16), mhz: (__app.fastMeter.cps / 1e6).toFixed(2) }));
console.log('after start:', JSON.stringify(st));
await page.screenshot({ path: path.join(root, 'tools', 'dos2.png') });
await page.keyboard.press('Enter');
await sleep(4000);
await page.screenshot({ path: path.join(root, 'tools', 'dos3.png') });
console.log('errors:', errors);
await browser.close();
