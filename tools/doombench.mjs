// A speed test with a real program: DOS 6.22 boots from a new drive C: that also holds the
// user's DOOM folder, DOOM starts, and the run is timed for some emulated seconds. The result
// is the emulated speed (emulated seconds for each real second; 1.0 = real time).
// Usage: node tools/doombench.mjs [--model 80486] [--secs 4] [--dir <DOOM folder>] [--warm 25] [--js] (--js: no WebAssembly core)
// With node --cpu-prof the profile shows where the time goes. The DOS and DOOM files are the
// user's own; they are never copied into src/ or dist/.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js',
  'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/p6ooo.wasm.js', 'src/core/cpu80686.js', 'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js',
  'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/x86core.wasm.js', 'src/core/x86wasm.js', 'src/core/machine.js', 'src/core/devices286.js', 'src/core/machine286.js', 'src/core/machine386.js',
  'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js', 'src/core/vgabios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const G = n => vm.runInThisContext(n);
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const model = arg('--model', '80486'), secs = +arg('--secs', 4), warm = +arg('--warm', 25);
const DIR = arg('--dir', 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS_X/c_drive_backup/DOOM');
const DOS = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files/msdos/dos6.img';
const CLS = { 80386: 'Machine386', 80486: 'Machine486', 80586: 'Machine586', 80686: 'Machine686' };
if (!fs.existsSync(DOS) || !fs.existsSync(DIR)) { console.log('skip: no DOS 6.22 image or no DOOM folder'); process.exit(0); }

// the disk (20 MB: DOS and the DOOM folder fit)
const hd = G('hdBlank')('DRIVE C');
G('hdMakeBootable')(hd, new Uint8Array(fs.readFileSync(DOS)));
const files = fs.readdirSync(DIR).filter(n => fs.statSync(path.join(DIR, n)).isFile()).map(n => ({ path: 'DOOM/' + n, bytes: new Uint8Array(fs.readFileSync(path.join(DIR, n))) }));
const tree = G('fatAddTree')(G('hdFs')(hd), files);
console.log(`C: ${files.length} files of DOOM (${tree.files} added)`);

const bios = G('Asm86').assemble(G('biosSource')(model), { origin: 0 });
const m = new (G(CLS[model]))({ video: 'vga', wasm: !process.argv.includes('--js') });
const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
m.setRom(rom, bios.symbols);
m.setVgaRom(G('makeVgaRom')(null).bytes);
m.reset();
m.insertHardDisk('c', hd);

const SC = { '\r': 0x1C, ' ': 0x39, '\\': 0x2B, '.': 0x34 };
'abcdefghijklmnopqrstuvwxyz'.split('').forEach(ch => { const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], base = [0x10, 0x1E, 0x2C]; rows.forEach((r, i) => { const k = r.indexOf(ch); if (k >= 0) SC[ch] = base[i] + k; }); });
const keys = [];
const type = s => { for (const ch of s) keys.push(SC[ch.toLowerCase()]); };
const pump = () => { if (!keys.length || m.kbd.fifo.length) return; const k = keys.shift(); m.keyDown(k); m.keyUp(k); };
const text = () => { const v = m.vram(); let s = ''; for (let i = 0; i < 2000; i++) s += String.fromCharCode(v[i * 2] || 32); return s; };
const runFor = (emSecs, pred) => { const end = m.cpu.cycles + emSecs * m.clockHz, slice = Math.round(m.clockHz / 100); while (m.cpu.cycles < end) { m.run(slice); pump(); if (pred && pred()) return true; } return false; };

let t = Date.now();
runFor(60, () => /C:\\>/.test(text()) || /Enter new date/.test(text()));
if (/Enter new date/.test(text())) { type('\r'); runFor(5); type('\r'); runFor(10, () => /C:\\>/.test(text())); }
console.log(`DOS: ${(m.cpu.cycles / m.clockHz).toFixed(1)} emulated s, ${Date.now() - t} ms real`);
type('cd doom\r'); runFor(3);
type('doom\r');
t = Date.now();
let c0 = m.cpu.cycles;
runFor(warm);
const gfx = m.vga ? { base: m.vga.memBase.toString(16), chain4: m.vga.chain4, graphics: !!(m.vga.gc[6] & 1), writes: m.vga.writes } : null;
console.log(`DOOM start: ${warm} emulated s in ${Date.now() - t} ms real (${(warm * 1000 / (Date.now() - t)).toFixed(3)}x); VGA ${gfx ? JSON.stringify(gfx).slice(0, 160) : '-'}`);
if (arg('--text')) console.log(text().match(/.{80}/g).map(l => l.trimEnd()).filter(Boolean).join('\n'));
// the measured part
if (m.wx && arg('--hist')) m.wx.hist = {};
t = Date.now(); c0 = m.cpu.cycles;
runFor(secs);
const ms = Date.now() - t, em = (m.cpu.cycles - c0) / m.clockHz;
console.log(`MEASURE ${model}: ${em.toFixed(2)} emulated s in ${ms} ms real = ${(em * 1000 / ms).toFixed(3)}x real time (${((m.cpu.cycles - c0) / ms / 1000).toFixed(2)} M clocks/s)`);
if (m.wx) console.log(`the WebAssembly core: ${m.wx.cSteps()} steps in C, ${m.wx.jsSteps()} in JavaScript (since the start)`);
if (m.wx && m.wx.hist) console.log('to JavaScript in the measured part:', Object.entries(m.wx.hist).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => `${k}: ${n}`).join(', '));
if (arg('--shot')) {
  // the frame as a PPM: mode 13h (chain 4) or mode Y (4 planes, 80 bytes a line), the DAC colours
  const v = m.vga, W = 320, H = 200, img = Buffer.alloc(W * H * 3), st = (v.crtc[0x0C] << 8) | v.crtc[0x0D];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = v.chain4 ? v.vram[(((y * W + x) & 0xFFFC) | ((y * W + x) >> 14)) << 2 | (x & 3)] : v.vram[((st + y * 80 + (x >> 2)) & 0xFFFF) << 2 | (x & 3)];
    for (let c = 0; c < 3; c++) img[(y * W + x) * 3 + c] = v.dac[i * 3 + c] * 4;
  }
  fs.writeFileSync(arg('--shot'), Buffer.concat([Buffer.from(`P6 ${W} ${H} 255
`), img]));
}
