// Screenshots of the views for the Pentium work (and the other models, to compare).
// Usage: node tools/p5shot.mjs --out prefix [--file page.html] [--model 80586] [--tab die]
//          [--w 1440] [--h 900] [--steps 6] [--fast 3000] [--src file.asm] [--sample id]
//          [--dock] [--eval "js"] [--speed 30] [--trace 0] [--run ms] [--dpr 2] [--el css]
// --steps N: trace mode, N clicks on Next (a picture after each third click and after the last).
// --fast ms: fast mode (speed position 90), run for ms, one picture while it runs, one after it.
// --dock: pictures of the dock too (the element .dock).
// Without --src and --sample the page runs P5_PROG (a small test program with pairs and branches).
// Prints the console errors; exits 1 when there is an error.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const P5_PROG = String.raw`; Test program for the Pentium views: pairs, no pairs, branches,
; memory reads and writes, a write-back of an M line, FPU and RDTSC.
        cpu 586
        org 0x100
start:  mov cx, 12
        xor bx, bx
        mov si, buf
again:  mov ax, [si]          ; U: a memory read
        add bx, ax            ; V reads AX: no pair
        mov dx, cx            ; U
        inc si                ; V: a pair
        inc si
        add word [si], 5      ; a write: E -> M
        push ax
        push bx               ; PUSH / PUSH pair
        pop bx
        pop ax                ; POP / POP pair
        shl ax, cl            ; not simple
        mov eax, 1            ; a prefix (66h)
        dec cx                ; U
        jnz again             ; V: the branch pairs with DEC
        mov word [buf], 0x1234
        mov ax, [buf + 4096]
        mov ax, [buf + 8192]  ; the same set: the M line goes back to memory
        fld dword [f1]
        fxch st1              ; FLD / FXCH pair
        fstp dword [f2]
        rdtsc
        imul bx
        jmp start
f1:     dd 1.5
f2:     dd 0
buf:    times 64 db 0
`;
const w = +opt('--w', 1440), h = +opt('--h', 900), steps = +opt('--steps', 0), fastMs = +opt('--fast', 0);
const prefix = opt('--out', path.join(root, 'tools', 'p5'));
const file = opt('--file', path.join(root, 'dist', '8086-anatomy.p5test.html'));
const src = opt('--src', null) ? fs.readFileSync(opt('--src'), 'utf8') : P5_PROG;
const set = { tab: opt('--tab', 'die'), trace: !fastMs && opt('--trace', '1') !== '0', speedPos: fastMs ? 90 : +opt('--speed', 30), speedSet: true, cpu: opt('--model', '80586') };
if (opt('--sample', null)) { set.sample = opt('--sample'); }
else { set.src = src; set.sample = 'custom'; }
if (opt('--video')) set.video = opt('--video');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage();
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message, e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : ''); });
page.on('console', async m => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  if (m.type() === 'error') errors++;
  let t = m.text();
  try { t = (await Promise.all(m.args().map(a => a.evaluate(x => x instanceof Error ? x.stack : String(x))))).join(' '); } catch (e) { /* keep */ }
  console.log(`[console.${m.type()}]`, t);
});
await page.setViewport({ width: w, height: h, deviceScaleFactor: +opt('--dpr', 1) });
if (args.includes('--reduced')) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.evaluateOnNewDocument(s => { localStorage.clear(); for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
await page.goto(pathToFileURL(file).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(+opt('--wait', 2500));
const shot = async name => {
  const p = `${prefix}_${name}.png`;
  const sel = opt('--el', null), el0 = sel ? await page.$(sel) : null;
  if (el0) await el0.screenshot({ path: p }); else await page.screenshot({ path: p });
  if (args.includes('--dock')) {
    const el = await page.$('.dock');
    if (el) { try { await el.screenshot({ path: `${prefix}_${name}_dock.png` }); } catch (e) { console.log('[dock]', e.message); } }
  }
  console.log('[shot]', p);
};
if (opt('--eval', null)) {
  const r = await page.evaluate(async s => { try { return await (0, eval)(s); } catch (e) { return 'EVAL ERROR ' + e.message; } }, opt('--eval'));
  console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
  await sleep(600);
}
const info = await page.evaluate(() => { const a = window.__app, c = a && a.machine && a.machine.cpu; return { machine: a && a.machine.constructor.name, cpu: c && c.constructor.name, model: a && a.model }; });
console.log('[page]', JSON.stringify(info));
await shot('start');
for (let i = 0; i < steps; i++) {
  const next = await page.$('#trace-next');
  if (next && await page.evaluate(() => !document.getElementById('trace').hidden)) await next.click();
  else await page.click('#btn-step');
  await sleep(+opt('--stepms', 1300));
  if ((i + 1) % 3 === 0 || i === steps - 1) await shot('s' + (i + 1));
}
const runMs = +opt('--run', 0);
if (runMs) {
  await page.click('#btn-run');
  await sleep(runMs);
  await page.click('#btn-run');
  await sleep(+opt('--after', 900));
  await shot('run');
}
if (fastMs) {
  await page.click('#btn-run');
  await sleep(fastMs);
  await shot('fast');
  await page.click('#btn-run');
  await sleep(700);
  await shot('stop');
}
const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
if (scroll.sw > scroll.cw) console.log(`[layout] horizontal overflow: ${scroll.sw} > ${scroll.cw}`);
console.log('errors:', errors);
await browser.close();
process.exitCode = errors ? 1 : 0;
