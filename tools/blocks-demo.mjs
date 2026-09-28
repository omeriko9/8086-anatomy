// Headless Chrome check of the block cards (src/ui/blocks.js).
// Usage: node tools/blocks-demo.mjs [--file dist/blocks-test.html] [--model 80286] [--out tools/blocks]
// Builds its own copy of the page (dist/blocks-test.html) unless --file is given, makes one
// BlockPanel per kind, draws each at u = 0.35 and u = 1, and saves grid screenshots.
// Exits 1 if the page logs an error.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
let file = opt('--file', null);
if (!file) {
  file = path.join(root, 'dist', 'blocks-test.html');
  execFileSync(process.execPath, [path.join(root, 'build.mjs'), '--out', file], { cwd: root, stdio: 'inherit' });
}
const outDir = path.resolve(root, opt('--out', path.join('tools', 'blocks')));
fs.mkdirSync(outDir, { recursive: true });
const model = opt('--model', null);

const SPECS = [
  { kind: 'adder', title: 'ALU', chip: '8086', sub: 'ADD AX, CX: the ALU adds two 16-bit numbers.', width: 16, a: 0x1234, b: 0x0FCD, aLabel: 'AX', bLabel: 'CX', rLabel: 'AX' },
  { kind: 'adder', title: 'Address adder', chip: '8086', sub: 'The BIU makes the 20-bit physical address.', width: 20, a: 0x1000 << 4, b: 0x010F, aLabel: 'DS × 16', bLabel: 'offset', rLabel: 'address', col: 'addr' },
  { kind: 'logic', op: 'CMP', title: 'ALU', chip: '8086', sub: 'CMP AL, 23h', width: 8, a: 0x50, b: 0x23 },
  { kind: 'logic', op: 'AND', title: 'ALU', chip: '8086', sub: 'AND AX, 3C3Ch', width: 16, a: 0xF0F5, b: 0x3C3C },
  { kind: 'logic', op: 'XOR', title: 'ALU', chip: '8086', sub: 'XOR AL, BL', width: 8, a: 0x96, b: 0x5A },
  { kind: 'shift', op: 'SHL', title: 'Shifter', chip: '8086', sub: 'SHL AX, 1', width: 16, a: 0x8421, count: 1 },
  { kind: 'shift', op: 'ROR', title: 'Shifter', chip: '8086', sub: 'ROR BL, 3', width: 8, a: 0x96, count: 3 },
  { kind: 'shift', op: 'RCL', title: 'Shifter', chip: '8086', sub: 'RCL DX, 2 (CF = 1)', width: 16, a: 0x4001, count: 2, cf: 1 },
  { kind: 'bytes', title: 'Prefetch queue', chip: '8086', sub: 'The EU takes 2 bytes of the instruction.', cells: [{ v: 0x8B, label: 'op' }, { v: 0x1E, label: 'modrm' }, { v: 0x1A }, { v: 0x00 }], cap: 6, take: [0, 1], note: 'The decoder gets 8B 1E.' },
  { kind: 'bytes', title: 'Prefetch queue', chip: '8086', sub: 'A word fetch puts 2 bytes in the queue.', cells: [{ v: 0x1A }, { v: 0x00 }, { v: 0xB8 }, { v: 0x34 }], cap: 6, put: [2, 3], note: 'The bus gives the word 34B8h.' },
  { kind: 'regfile', title: 'Registers', chip: '8086', sub: 'MOV BX, [SI]: the EU reads SI and writes BX.', regs: [
    { name: 'AX', v: 0x1234 }, { name: 'CX', v: 0x0003 }, { name: 'DX', v: 0 }, { name: 'BX', v: 0x00FF },
    { name: 'SP', v: 0xFFFE }, { name: 'BP', v: 0 }, { name: 'SI', v: 0x0200 }, { name: 'DI', v: 0x0100 }], write: 'BX', v: 0x2201, read: ['SI'] },
  { kind: 'regfile', title: 'Registers', chip: '8086', sub: 'MOV AL, 7Fh writes the low byte of AX.', regs: [
    { name: 'AX', v: 0x1234 }, { name: 'CX', v: 0x0003 }, { name: 'DX', v: 0 }, { name: 'BX', v: 0x00FF }], write: 'AL', v: 0x7F, read: [] },
  { kind: 'decoder', title: 'Row decoder', chip: '4164', sub: 'The 8 row address bits select 1 of 256 word lines.', bits: 8, value: 0x87, inLabel: 'row address', outLabel: 'word lines' },
  { kind: 'decoder', title: 'Port decoder', chip: '74LS138', sub: '', bits: 3, value: 5, inLabel: 'A7..A5', outLabel: 'chip selects' },
  { kind: 'cells', title: 'Cell array', chip: '4164', sub: 'The DRAM reads the bit at row 87h, column 3Ch.', rows: 8, cols: 8, row: 3, col: 5, rowLabel: 'row 87h', colLabel: 'col 3Ch', bit: 1, mem: 'dram' },
  { kind: 'cells', title: 'Cell array', chip: '4164', sub: 'The DRAM writes a 0 into the cell.', rows: 8, cols: 8, row: 3, col: 5, rowLabel: 'row 87h', colLabel: 'col 3Ch', bit: 0, write: true, mem: 'dram' },
  { kind: 'rom', title: 'Cell array', chip: '2764', sub: 'The EPROM reads one bit of the byte.', rows: 8, cols: 8, row: 6, col: 1, rowLabel: 'row 1Fh', colLabel: 'col 02h', bit: 0 },
  { kind: 'mux', title: 'Column mux', chip: '4164', sub: 'The column address selects 1 of 256 bit lines.', n: 256, sel: 0x3C, value: 1, label: 'column mux' },
  { kind: 'latch', title: 'Address latch', chip: '8282', sub: 'ALE keeps A7..A0 while the bus carries data.', bits: 8, value: 0x3C, strobe: 'ALE', label: '8282 latch' },
  { kind: 'buffer', title: 'Data transceiver', chip: '8286', sub: 'A read: the data goes from the bus to the CPU.', bits: 8, value: 0xA5, dir: 'in', enable: 'DEN', label: '8286' },
  { kind: 'buffer', title: 'Data buffer', chip: '74LS245', sub: '', bits: 16, value: 0x34B8, dir: 'CPU→bus', enable: 'OE', label: '74LS245 x2' },
  { kind: 'flags', title: 'FLAGS', chip: '8086', sub: 'SUB AX, AX: the result is zero.', old: 0xF083, v: 0xF046, names: ['CF', 'PF', 'AF', 'ZF', 'SF', 'OF'] },
  { kind: 'status', title: 'Status decoder', chip: '8288', sub: 'The 8288 reads S2 S1 S0 from the CPU.', code: '101' },
  { kind: 'opcode', title: 'Instruction decoder', chip: '8086', sub: 'The decoder reads the fields of the first bytes.', bytes: [0x8B, 0x1E, 0x1A, 0x00], text: 'mov bx, [0x1A]',
    fields: [{ name: 'op', from: 7, to: 2 }, { name: 'd', from: 1, to: 1 }, { name: 'w', from: 0, to: 0 }, { name: 'mod', from: 7, to: 6 }, { name: 'reg', from: 5, to: 3 }, { name: 'r/m', from: 2, to: 0 }] },
  { kind: 'opcode', title: 'Instruction decoder', chip: '8086', sub: 'No fields given: the card finds them.', bytes: [0x81, 0xC3, 0x10, 0x00], text: 'add bx, 0x10' },
  { kind: 'counter', title: 'Counter 0', chip: '8253', sub: 'The timer tick: IRQ0 about 18.2 times each second.', v: 0x8000, reload: 0, mode: 3, label: 'counter 0' },
  { kind: 'alu', op: 'MUL', title: 'ALU', chip: '8086', sub: 'MUL CL', width: 16, a: 0x0012, b: 0x0034, r: 0x03A8, aLabel: 'AL', bLabel: 'CL', rLabel: 'AX' },
  { kind: 'adder', title: 'Address unit', chip: '80286', sub: 'The 24-bit address: segment base + offset.', width: 24, a: 0x0F0000, b: 0xFFF0, aLabel: 'CS base', bLabel: 'IP', rLabel: 'address', col: 'addr' },
  { kind: 'adder', title: 'ALU', chip: '8086', sub: true, width: 8, a: 0x05, b: 0x09, aLabel: 'AL', bLabel: 'BL' },
  { kind: 'text', title: 'Bus interface unit', chip: '8086', sub: '', lines: ['The BIU does all bus cycles.', 'It fills the queue when the bus is free.'] },
  { kind: 'nonsense', title: 'Unknown', chip: '?', sub: 'An unknown kind falls back to text.' },
  { kind: 'adder', title: 'Bad values', chip: '8086', sub: 'Strings and a missing width.', a: 'x', b: null, width: 'abc' },
];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
let errors = 0;
page.on('console', m => { if (m.type() === 'error') { errors++; console.log(`[console.error] ${m.text()}`); } });
page.on('pageerror', e => { errors++; console.log(`[pageerror] ${e.message}`); });
const COLS = 3, CARD_W = 356, CARD_H = 300;
await page.setViewport({ width: COLS * CARD_W + 20, height: 900, deviceScaleFactor: 1 });
if (model) await page.evaluateOnNewDocument(m => { try { localStorage.setItem('a86:cpu', JSON.stringify(m)); } catch (e) { /* file origin */ } }, model);
await page.goto(pathToFileURL(path.resolve(root, file)).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));
const ok = await page.evaluate(() => typeof window.BlockPanel === 'function');
if (!ok) { console.log('BlockPanel is not on window'); await browser.close(); process.exit(1); }

const perShot = 6;
const shots = [];
for (let g = 0; g * perShot < SPECS.length; g++) {
  const specs = SPECS.slice(g * perShot, (g + 1) * perShot);
  for (const u of [0.35, 1]) {
    const heights = await page.evaluate((specs, u, COLS, CARD_W, CARD_H) => {
      let box = document.getElementById('bk-demo');
      if (box) box.remove();
      box = document.createElement('div');
      box.id = 'bk-demo';
      box.style.cssText = `position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;overflow:auto;background:var(--void);padding:10px;display:grid;grid-template-columns:repeat(${COLS}, ${CARD_W}px);grid-auto-rows:${CARD_H}px;`;
      document.body.appendChild(box);
      const hs = [];
      for (const spec of specs) {
        const host = document.createElement('div');
        host.style.cssText = 'position:relative;';
        box.appendChild(host);
        const p = new window.BlockPanel(host);
        p.setReducedMotion(false);
        p.place(4, 4);
        p.show(spec);
        p.show(spec);   // the same spec again: no rebuild
        p.update(u);
        p.el.classList.add('bk-rm');   // no fade for the picture
        hs.push(p.el.offsetHeight);
      }
      return hs;
    }, specs, u, COLS, CARD_W, CARD_H);
    await new Promise(r => setTimeout(r, 150));
    const out = path.join(outDir, `blocks_${g}_${u === 1 ? 'end' : 'mid'}.png`);
    const rows = Math.ceil(specs.length / COLS);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: COLS * CARD_W + 20, height: Math.min(900, rows * CARD_H + 20) } });
    shots.push(out);
    console.log(`[shot] ${out}  card heights: ${heights.join(' ')}`);
  }
}
// reduced motion: update(0.2) must draw the final state
const rm = await page.evaluate(spec => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const p = new window.BlockPanel(host);
  p.setReducedMotion(true);
  p.show(spec);
  p.update(0.2);
  const a = p.el.querySelector('svg').innerHTML;
  p.update(1);
  const b = p.el.querySelector('svg').innerHTML;
  p.hide();
  host.remove();
  return a === b;
}, SPECS[0]);
console.log(`[reduced] update(0.2) draws the final state: ${rm}`);
// timing: 1000 updates of the biggest card
const ms = await page.evaluate(spec => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const p = new window.BlockPanel(host);
  p.show(spec);
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) p.update((i % 100) / 100);
  const t = performance.now() - t0;
  host.remove();
  return t;
}, SPECS[14]);
console.log(`[perf] 1000 updates of the DRAM card: ${ms.toFixed(1)} ms`);
console.log(`errors: ${errors}`);
await browser.close();
process.exitCode = errors || !rm ? 1 : 0;
