// Headless Chrome check of the on-die unit drawings (src/ui/unitfx.js).
// Usage: node tools/unitfx-demo.mjs [--file dist/unitfx-test.html] [--out tools/unitfx] [--model 80286]
// Builds its own copy of the page (dist/unitfx-test.html) unless --file is given. For each real
// unit (the aspect ratio of its rectangle on the die) it draws the spec that the trace makes at
// 128, 256 and 512 px wide and u = 0.3, 0.6, 1 over a dark die-like ground, and saves one grid
// screenshot per unit, plus a sheet of all kinds at 256 px. It prints the draw time per call.
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
  file = path.join(root, 'dist', 'unitfx-test.html');
  execFileSync(process.execPath, [path.join(root, 'build.mjs'), '--out', file], { cwd: root, stdio: 'inherit' });
}
const outDir = path.resolve(root, opt('--out', path.join('tools', 'unitfx')));
fs.mkdirSync(outDir, { recursive: true });
const model = opt('--model', null);

// The same builders as the trace (src/ui/board3d.js, "Trace models").
const tcard = (kind, title, chip, sub, o) => Object.assign({ kind, title, chip, sub }, o || {});
const STATUS_ROWS = [['000', 'interrupt acknowledge', 'INTA'], ['001', 'I/O read', 'IORC'], ['010', 'I/O write', 'IOWC'], ['011', 'halt', '—'],
  ['100', 'code fetch', 'MRDC'], ['101', 'memory read', 'MRDC'], ['110', 'memory write', 'MWTC'], ['111', 'passive', '—']];
const STATUS_286 = [['000', 'interrupt acknowledge', 'INTA'], ['001', 'I/O read', 'IORC'], ['010', 'I/O write', 'IOWC'], ['100', 'halt', '—'],
  ['101', 'memory read (code: COD high)', 'MRDC'], ['110', 'memory write', 'MWTC'], ['111', 'passive', '—']];
const statusCard = (chip, code, title, rows = STATUS_ROWS) => tcard('status', title, chip, `Status ${code}.`,
  { code, rows: rows.map(r => ({ code: r[0], name: r[1], cmd: r[2] })), label: 'S2 S1 S0' });
const adderCard = (title, chip, seg, base, off, r, bits = 20) => tcard('adder', title, chip, `${seg} × 16 plus the offset gives the address.`,
  { width: bits, a: base, b: off & 0xFFFF, cin: 0, r, aLabel: `${seg} × 16`, bLabel: 'offset', rLabel: 'address' });
const REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
const regVals = [0x0000, 0x0000, 0x0000, 0x0000, 0xFFFE, 0x0000, 0x0000, 0x0000];

// Unit rectangles: [name, w, h] as fractions of the die, die aspect a (die width / height).
const UNITS = [
  { name: 'alu_add', unit: 'ALU', a: 1.06, fw: 0.27, fh: 0.29,
    spec: tcard('adder', 'ALU', '8086', 'ADD 1234h, 0FCDh gives 2201h.', { width: 16, a: 0x1234, b: 0x0FCD, cin: 0, r: 0x2201, aLabel: 'A', bLabel: 'B', rLabel: 'sum' }) },
  { name: 'addr_adder', unit: 'ADDRESS ADDER', a: 1.06, fw: 0.2, fh: 0.26, spec: adderCard('ADDRESS ADDER', '8086', 'DS', 0x10000, 0x010F, 0x1010F) },
  { name: 'queue_take', unit: 'QUEUE', a: 1.06, fw: 0.22, fh: 0.25,
    spec: tcard('bytes', 'QUEUE', '8086', 'The EU takes 3 bytes from the queue.', { cells: [0xBE, 0x0F, 0x01, 0xAC, 0x08, 0xC0].map(v => ({ v })), cap: 6, take: [0, 1, 2], put: [], note: 'to the decoder' }) },
  { name: 'regs_si', unit: 'REGISTERS', a: 1.06, fw: 0.25, fh: 0.53,
    spec: tcard('regfile', 'REGISTERS', '8086', 'SI gets 010Fh.', { regs: REG16.map((nm, i) => ({ name: nm, v: regVals[i] })), write: 'SI', v: 0x010F, read: [] }) },
  { name: 'row_dec', unit: 'ROW DEC', a: 1.7, fw: 0.14, fh: 0.43,
    spec: tcard('decoder', 'ROW DECODER', '4164', 'RAS takes the row 087h from the address pins.', { bits: 8, value: 0x87, inLabel: 'row address', outLabel: 'word lines' }) },
  { name: 'dram_cells', unit: 'CELL ARRAY', a: 1.7, fw: 0.42, fh: 0.43,
    spec: tcard('cells', 'CELL ARRAY', '4164', 'The word line of row 087h opens.', { rows: 8, cols: 8, row: 7, col: 3, rowLabel: '087h', colLabel: '003h', bit: 1, write: false, mem: 'dram' }) },
  { name: 'status_8288', unit: 'STATUS DECODER', a: 1.3, fw: 0.45, fh: 0.48, spec: statusCard('8288', '101', 'STATUS DECODER') },
  { name: 'decoder_op', unit: 'DECODER', a: 1.06, fw: 0.52, fh: 0.21,
    spec: tcard('opcode', 'DECODER', '8086', 'The decoder reads the bits of the opcode: "mov si, 0x10F".',
      { bytes: [0xBE, 0x0F, 0x01], text: 'mov si, 0x10F', fields: [{ name: 'opcode', from: 7, to: 4, v: 0xB }, { name: 'w', from: 3, to: 3, v: 1 }, { name: 'reg', from: 2, to: 0, v: 6 }] }) },
];
// All kinds at 256 px wide, with more real aspect ratios.
const KINDS = [
  { name: 'logic AND 8', r: 1.0, spec: tcard('logic', 'ALU', '8086', '', { op: 'AND', width: 8, a: 0x96, b: 0x5A, r: 0x12 }) },
  { name: 'xor 16', r: 1.0, spec: tcard('logic', 'ALU', '8086', '', { op: 'XOR', width: 16, a: 0xF0F5, b: 0x3C3C }) },
  { name: 'shift ROR 3', r: 1.0, spec: tcard('shift', 'ALU', '8086', '', { op: 'ROR', width: 8, a: 0x96, count: 3 }) },
  { name: 'shift SHL 1 w16', r: 1.0, spec: tcard('shift', 'ALU', '8086', '', { op: 'SHL', width: 16, a: 0x8421, count: 1 }) },
  { name: 'SUB 286 ALU tall', r: 0.4, spec: tcard('adder', 'ALU', '80286', '', { width: 16, a: 0x0050, b: 0x0023, subtract: true, cin: 1, r: 0x002D }) },
  { name: 'flags', r: 1.3, spec: tcard('flags', 'FLAGS', '8086', '', { old: 0xF083, v: 0xF046, names: ['CF', '', 'PF', '', 'AF', '', 'ZF', 'SF', 'TF', 'IF', 'DF', 'OF'] }) },
  { name: 'col dec mux', r: 2.0, spec: tcard('mux', 'COLUMN DECODER', '4164', '', { n: 32, sel: 3, value: 1, label: 'columns' }) },
  { name: 'y gating (5.8:1)', r: 5.8, spec: tcard('mux', 'Y GATING', '2764', '', { n: 32, sel: 0x1A, value: 0xB8, label: 'columns' }) },
  { name: 'rom cells', r: 1.19, spec: tcard('cells', 'CELL ARRAY', '2764', '', { rows: 8, cols: 8, row: 6, col: 1, rowLabel: '1Fh', colLabel: '02h', bit: 0, write: false, mem: 'rom' }) },
  { name: 'dram write', r: 1.66, spec: tcard('cells', 'CELL ARRAY', '4164', '', { rows: 8, cols: 8, row: 3, col: 5, rowLabel: '0A3h', colLabel: '03Dh', bit: 1, write: true, mem: 'dram' }) },
  { name: 'latch', r: 1.2, spec: tcard('latch', 'ADDRESS LATCH', '8282', '', { bits: 8, value: 0x3C, strobe: 'STB', label: 'latch' }) },
  { name: 'buffer in 16', r: 1.3, spec: tcard('buffer', 'DATA IN', '8086', '', { bits: 16, value: 0x34B8, dir: 'in', enable: 'DT/R low, DEN', label: 'into the chip' }) },
  { name: 'out buffers 8', r: 1.56, spec: tcard('buffer', 'OUTPUT BUFFERS', '2764', '', { bits: 8, value: 0xB8, dir: 'out', enable: 'DT/R high, DEN' }) },
  { name: 'counter', r: 2.7, spec: tcard('counter', 'COUNTER 0', '8253', '', { v: 0x8000, reload: 0, mode: 3, label: 'counter 0' }) },
  { name: 'text (microcode)', r: 1.11, spec: tcard('text', 'MICROCODE', '8086', 'Task switch.', { lines: ['INT 10h: save FLAGS, CS, IP', 'Vector 10h', 'Table address 00040h'] }) },
  { name: 'text 8087', r: 1.06, spec: tcard('text', 'REGISTER STACK', '8087', '', { lines: ['Operand 3F80h'] }) },
  { name: 'status 82288', r: 1.22, spec: statusCard('82288', '101', 'STATUS DECODER', STATUS_286) },
  { name: 'queue put 2', r: 0.93, spec: tcard('bytes', 'QUEUE', '8086', '', { cells: [0x1A, 0x00, 0xB8, 0x34].map(v => ({ v })), cap: 6, put: [2, 3], take: [], note: 'from the bus' }) },
  { name: 'queue flush', r: 0.93, spec: tcard('bytes', 'QUEUE', '8086', '', { cells: [], cap: 6, take: [], put: [], note: 'empty' }) },
  { name: 'opcode modrm', r: 2.6, spec: tcard('opcode', 'DECODER', '8086', '', { bytes: [0x8B, 0x1E, 0x1A, 0x00], text: 'mov bx, [0x1A]',
    fields: [{ name: 'opcode', from: 7, to: 2 }, { name: 'd', from: 1, to: 1 }, { name: 'w', from: 0, to: 0 }, { name: 'mod', from: 15, to: 14 }, { name: 'reg', from: 13, to: 11 }, { name: 'r/m', from: 10, to: 8 }] }) },
  { name: 'regs read+write', r: 0.5, spec: tcard('regfile', 'REGISTERS', '8086', '', { regs: REG16.map((nm, i) => ({ name: nm, v: [0x1234, 3, 0, 0xFF, 0xFFFE, 0, 0x200, 0x100][i] })), write: 'BX', v: 0x2201, read: ['SI'] }) },
  { name: 'seg regs', r: 0.85, spec: tcard('regfile', 'SEGMENT REGS', '8086', '', { regs: ['ES', 'CS', 'SS', 'DS'].map(nm => ({ name: nm, v: 0x1000 })), write: 'DS', v: 0x2000, read: [] }) },
  { name: '24-bit adder 286', r: 0.55, spec: tcard('adder', 'PHYSICAL ADDER', '80286', '', { width: 24, a: 0x0F0000, b: 0xFFF0, cin: 0 }) },
  { name: 'priority (3 bit dec)', r: 0.35, spec: tcard('decoder', 'PRIORITY RESOLVER', '8259A', '', { bits: 3, value: 5, inLabel: 'IRQ', outLabel: 'in service' }) },
  { name: 'reg select (2 bit)', r: 1.4, spec: tcard('decoder', 'REGISTER SELECT', '8253', '', { bits: 2, value: 1, inLabel: 'A1 A0' }) },
  { name: 'unknown kind', r: 1.0, spec: tcard('nonsense', 'Unknown', '?', 'An unknown kind.') },
  { name: 'bad values', r: 1.0, spec: tcard('adder', 'Bad', '8086', '', { a: 'x', b: null, width: 'abc' }) },
  { name: 'null spec', r: 1.0, spec: null },
];

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
let errors = 0;
page.on('console', m => { if (m.type() === 'error') { errors++; console.log(`[console.error] ${m.text()}`); } });
page.on('pageerror', e => { errors++; console.log(`[pageerror] ${e.message}`); });
await page.setViewport({ width: 1700, height: 1000, deviceScaleFactor: 1 });
if (model) await page.evaluateOnNewDocument(m => { try { localStorage.setItem('a86:cpu', JSON.stringify(m)); } catch (e) { /* file origin */ } }, model);
await page.goto(pathToFileURL(path.resolve(root, file)).href, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));
const ok = await page.evaluate(() => typeof window.UnitFx === 'object' && typeof window.UnitFx.draw === 'function');
if (!ok) { console.log('UnitFx is not on window'); await browser.close(); process.exit(1); }

// A grid of canvases over a die-like ground. cells: [{ label, w, h, spec, u }], cols per row.
async function sheet(cells, cols, out, tint) {
  const size = await page.evaluate((cells, cols, tint) => {
    let box = document.getElementById('ufx-demo');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'ufx-demo';
    box.style.cssText = `position:fixed;left:0;top:0;z-index:99999;background:#0a0710;padding:10px;display:grid;gap:10px;align-items:start;
      grid-template-columns:repeat(${cols}, max-content);font:12px ui-monospace,Consolas,monospace;color:#bbb;`;
    document.body.appendChild(box);
    for (const c of cells) {
      const cell = document.createElement('div');
      const lab = document.createElement('div');
      lab.textContent = c.label;
      lab.style.cssText = 'margin-bottom:3px;white-space:nowrap;';
      cell.appendChild(lab);
      // the die ground: the tint of the unit, metal lines, other units around it
      const ground = document.createElement('div');
      ground.style.cssText = `padding:14px;background:
        repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 5px),
        repeating-linear-gradient(90deg, rgba(0,0,0,0.25) 0 2px, transparent 2px 9px), ${tint};`;
      const cv = document.createElement('canvas');
      cv.width = c.w; cv.height = c.h;
      cv.style.cssText = `display:block;width:${c.w}px;height:${c.h}px;`;
      ground.appendChild(cv);
      cell.appendChild(ground);
      box.appendChild(cell);
      window.UnitFx.draw(cv.getContext('2d'), c.w, c.h, c.spec, c.u, 1234, false);
    }
    return { w: box.offsetWidth, h: box.offsetHeight };
  }, cells, cols, tint);
  await page.setViewport({ width: Math.max(400, size.w), height: Math.max(300, size.h), deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 100));
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size.w, height: size.h } });
  console.log(`[shot] ${out} (${size.w}x${size.h})`);
}

const US = [0.3, 0.6, 1];
const TINT = { ALU: '#2b6664', 'ADDRESS ADDER': '#2b6664', QUEUE: '#35487f', REGISTERS: '#2b6664', 'ROW DEC': '#695632', 'CELL ARRAY': '#35487f', 'STATUS DECODER': '#695632', DECODER: '#695632' };
const only = opt('--only', null);
for (const U of UNITS) {
  if (only && !U.name.includes(only)) continue;
  const ratio = (U.fw * U.a) / U.fh;
  const cells = [];
  for (const W of [128, 256, 512]) for (const u of US) cells.push({ label: `${U.unit} ${W}px u=${u}`, w: W, h: Math.round(W / ratio), spec: U.spec, u });
  await sheet(cells, 3, path.join(outDir, `unit_${U.name}.png`), TINT[U.unit] || '#35487f');
}
if (!only) {
  for (const u of [0.45, 1]) {
    const cells = KINDS.map(k => ({ label: `${k.name} u=${u}`, w: 256, h: Math.round(256 / k.r), spec: k.spec, u }));
    await sheet(cells, 6, path.join(outDir, `kinds_${u === 1 ? 'end' : 'mid'}.png`), '#2e3350');
  }
  // small sizes: every kind at 96 px on the short side
  const cells = KINDS.map(k => ({ label: k.name.slice(0, 14), w: k.r >= 1 ? Math.round(96 * k.r) : 96, h: k.r >= 1 ? 96 : Math.round(96 / k.r), spec: k.spec, u: 0.6 }));
  await sheet(cells, 8, path.join(outDir, 'kinds_small.png'), '#2e3350');
}

// timing: draw calls on a 512 px canvas for each unit spec (u moves)
const times = await page.evaluate((units, kinds) => {
  const cv = document.createElement('canvas');
  const out = [];
  cv.width = 512; cv.height = 512;
  for (let k = 0; k < 3; k++) for (const U of units.concat(kinds)) for (let i = 0; i < 20; i++) window.UnitFx.draw(cv.getContext('2d'), 512, 512, U.spec, i / 20, i, false);
  cv.getContext('2d').getImageData(0, 0, 1, 1);   // wait for the warm-up draws
  for (const U of units.concat(kinds)) {
    const w = 512, h = Math.round(512 / U.ratio);
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    for (let i = 0; i < 20; i++) window.UnitFx.draw(g, w, h, U.spec, i / 20, i * 16, false);
    g.getImageData(0, 0, 1, 1);
    const N = 200, t0 = performance.now();
    for (let i = 0; i < N; i++) window.UnitFx.draw(g, w, h, U.spec, (i % 100) / 100, i * 16, false);
    g.getImageData(0, 0, 1, 1);
    out.push([U.name, w + 'x' + h, ((performance.now() - t0) / N).toFixed(3)]);
  }
  return out;
}, UNITS.map(U => ({ name: U.name, spec: U.spec, ratio: (U.fw * U.a) / U.fh })), KINDS.map(k => ({ name: k.name, spec: k.spec, ratio: k.r })));
for (const [n, s, ms] of times) console.log(`[time] ${n.padEnd(22)} ${s.padEnd(9)} ${ms} ms/draw`);
// no internal state: drawing u = 0.6 after u = 1 gives the same pixels as u = 0.6 alone
const same = await page.evaluate(spec => {
  const a = document.createElement('canvas'), b = document.createElement('canvas');
  a.width = b.width = 256; a.height = b.height = 256;
  window.UnitFx.draw(a.getContext('2d'), 256, 256, spec, 0.6, 0, true);
  window.UnitFx.draw(b.getContext('2d'), 256, 256, spec, 1, 0, true);
  window.UnitFx.draw(b.getContext('2d'), 256, 256, spec, 0.6, 0, true);
  return a.toDataURL() === b.toDataURL();
}, UNITS[0].spec);
console.log(`[stateless] u jumps back gives the same picture: ${same}`);
// the context state is restored after a draw
const restored = await page.evaluate(spec => {
  const c = document.createElement('canvas').getContext('2d');
  c.globalAlpha = 0.5; c.font = '10px serif'; c.fillStyle = '#123456';
  window.UnitFx.draw(c, 200, 200, spec, 0.5, 0, false);
  window.UnitFx.draw(c, 200, 200, { kind: 'adder', width: {} }, 0.5, 0, false);
  return c.globalAlpha === 0.5 && c.font === '10px serif' && c.fillStyle === '#123456';
}, UNITS[2].spec);
console.log(`[state] context state restored: ${restored}`);
console.log(`errors: ${errors}`);
await browser.close();
process.exitCode = errors || !same || !restored ? 1 : 0;
