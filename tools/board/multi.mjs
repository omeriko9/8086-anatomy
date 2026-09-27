// Several screenshots in one page session: node tools/board/multi.mjs setup.js step1.js ...
// Each step file is evaluated (it may return a promise), then a screenshot tools/board/m<i>.png is taken.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const files = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
if (process.env.VIDEO) await page.evaluateOnNewDocument(v => { try { localStorage.setItem('a86:video', JSON.stringify(v)); } catch (e) { /* file origin */ } }, process.env.VIDEO);
if (process.env.MODEL) await page.evaluateOnNewDocument(m => { try { localStorage.setItem('a86:cpu', JSON.stringify(m)); } catch (e) { /* file origin */ } }, process.env.MODEL);
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', e => console.log(`[pageerror] ${e.message}`));
await page.setViewport({ width: +(process.env.W || 1440), height: +(process.env.H || 900), deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.resolve('tools/board/board.html')).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 3000));
for (let i = 0; i < files.length; i++) {
  const src = fs.readFileSync(files[i], 'utf8');
  const r = await page.evaluate(async s => { try { return await (0, eval)(s); } catch (e) { return 'ERR ' + e.message; } }, src);
  console.log(`[${i}]`, r);
  await page.screenshot({ path: `tools/board/${process.env.PREFIX || 'm'}${i}.png` });
}
await browser.close();
