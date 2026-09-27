// Bus timing view check: hover tooltips, the detail card, both models.
// Usage: node tools/tvcheck.mjs [--model 80286] [--w 1440] [--h 900] [--trace false] [--tag x]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const w = +opt('--w', 1440), h = +opt('--h', 900);
const model = opt('--model', '8086'), trace = opt('--trace', 'true'), tag = opt('--tag', model + (w < 600 ? 'm' : ''));
const video = opt('--video', 'cga');
const out = n => path.join(root, 'tools', 'tv', `${tag}_${n}.png`);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
let errors = 0;
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { if (m.type() === 'error') errors++; console.log(`[console.${m.type()}] ${m.text()}`); } });
page.on('pageerror', e => { errors++; console.log(`[pageerror] ${e.message}`); });
if (args.includes('--reduced')) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((m, t, v) => { try { localStorage.setItem('a86:cpu', JSON.stringify(m)); localStorage.setItem('a86:trace', JSON.stringify(t === 'true')); localStorage.setItem('a86:video', JSON.stringify(v)); } catch (e) { /* */ } }, model, trace, video);
// count the sound effects by the pitch of their oscillators (see sfx.js)
await page.evaluateOnNewDocument(() => {
  window.__sfx = { edge: 0, ctrl: 0, data: 0, select: 0 };
  const orig = AudioParam.prototype.setValueAtTime;
  AudioParam.prototype.setValueAtTime = function (v, t) {
    if (v === 2100 || v === 1700) __sfx.edge++;
    else if (v === 990) __sfx.ctrl++;
    else if (v === 660) __sfx.data++;
    else if (v === 1320) __sfx.select++;
    return orig.call(this, v, t);
  };
});
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 2500));
const sleep = ms => new Promise(r => setTimeout(r, ms));
await page.mouse.click(700, 60);   // a user gesture starts the audio
await page.evaluate(() => {
  __app.selectTab('timing'); for (let k = 0; k < 6; k++) __app.stepInstr();
});
await sleep(2500);
// geometry of the view (read it again before each action: the plot scrolls)
const geom = () => page.evaluate(() => {
  const v = __app.views.timing, L = v.lay, r = v.svg.getBoundingClientRect();
  const row = id => L.rows[id] ? { y: r.top + L.rows[id].y + L.rows[id].h / 2 } : null;
  const span = L.plotW / v.px, left = v.shownRight - span;
  const xAt = pos => r.left + L.plotX + (pos - left) * v.px;
  let t1 = null;
  for (let p = Math.ceil(v.reveal) - 3; p > left; p--) { const c = v.cyc[p & 2047]; if (c && v.ts[p & 2047] === 1 && c.s !== 3 && c.s !== 0) { t1 = p; break; } }
  return { ale: row('ale'), mrdc: row('mrdc'), ad: row(v.m286 ? 'a' : 'ad'), x1: t1 !== null ? xAt(t1 + 0.7) : null, x2: t1 !== null ? xAt(t1 + 1.5) : null, x3: t1 !== null ? xAt(t1 + 2.5) : null, nameX: r.left + 40, sc: v.scrollEl.scrollHeight + '/' + v.scrollEl.clientHeight };
});
const tipText = () => page.evaluate(() => { const t = document.querySelector('.tv-ptip'); return t && !t.hidden ? t.textContent : '(none)'; });
let g = await geom();
console.log('geom', JSON.stringify(g));
// 1. hover a name label (Tips helper)
await page.mouse.move(g.nameX, g.ale.y);
await sleep(700);
console.log('name tip:', await page.evaluate(() => { const t = document.querySelector('.tip:not(.tv-ptip)'); return t && !t.hidden ? t.textContent : '(none)'; }));
await page.screenshot({ path: out('1name') });
// 2. hover the ALE waveform in T1
g = await geom();
if (g.x1) {
  await page.mouse.move(g.x1, g.ale.y);
  await sleep(450);
  g = await geom();
  await page.mouse.move(g.x1, g.ale.y + 1);
  await sleep(30);
  console.log('wave tip:', await tipText());
  await page.screenshot({ path: out('2wave') });
  g = await geom();
  await page.mouse.move(g.x1, g.ad.y);
  await sleep(30);
  console.log('bus tip T1:', await tipText());
  g = await geom();
  await page.mouse.move(g.x3, g.ad.y);
  await sleep(30);
  console.log('bus tip T3:', await tipText());
  g = await geom();
  await page.mouse.move(g.x3, g.mrdc.y);
  await sleep(30);
  console.log('mrdc tip:', await tipText());
  // 3. click on the MRDC row
  g = await geom();
  await page.mouse.click(g.x3, g.mrdc.y);
  await sleep(500);
  console.log('card:', await page.evaluate(() => { const c = document.getElementById('tv-card'); return c.hidden ? '(hidden)' : c.innerText.split(String.fromCharCode(10)).filter(Boolean).join(' | ').slice(0, 900); }));
  await page.mouse.move(5, 5);
  await sleep(300);
  await page.screenshot({ path: out('3card') });
}
// 4. keyboard: focus the name button of ALE, Enter, arrows, Escape
await page.evaluate(() => { __app.views.timing.focusName('ale'); });
await page.keyboard.press('Enter');
await sleep(300);
console.log('card after Enter:', await page.evaluate(() => __app.views.timing.sel));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await sleep(300);
console.log('card after Down+Enter:', await page.evaluate(() => __app.views.timing.sel + ' focus=' + document.activeElement.dataset.id));
await page.screenshot({ path: out('4kbd') });
await page.keyboard.press('Escape');
await sleep(200);
console.log('after Esc:', await page.evaluate(() => __app.views.timing.sel + ' hidden=' + document.getElementById('tv-card').hidden));
// 5. open the bus row card, then run a while
await page.evaluate(() => { __app.views.timing.openCard(__app.views.timing.m286 ? 'd' : 'ad'); });
await page.evaluate(() => { for (let k = 0; k < 3; k++) __app.stepInstr(); });
await sleep(1500);
await page.screenshot({ path: out('5bus') });
console.log('sfx calls', await page.evaluate(() => JSON.stringify(__sfx)));
// 6. hidden view: no sounds
await page.evaluate(() => { __sfx.edge = 0; __app.selectTab('board'); for (let k = 0; k < 3; k++) __app.stepInstr(); });
await sleep(1500);
console.log('sfx while hidden', await page.evaluate(() => JSON.stringify(__sfx)));
await page.evaluate(() => { __app.selectTab('timing'); });
await sleep(300);
console.log(`[done] errors: ${errors}`);
await browser.close();
process.exitCode = errors ? 1 : 0;
