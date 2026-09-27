// Boots a real DOS floppy image and starts a program from drive B:.
// Usage: node tests/dos.test.mjs [boot.img] [program.exe] [--model 80286|80386|80486|80586|80686] [--video vga] [--timing real] [--cpu 80386]
// --cpu 80386 (with --model 80286): the AT machine runs with the CPU80386 core instead.
// --timing real: the floppy drives wait for the motor, the steps and the rotation.
// The images are the user's own files; the test skips if they are missing.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js',
  ...(fs.existsSync(path.join(root, 'src/core/cpu80286.js')) ? ['src/core/cpu80286.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/cpu80386.js')) ? ['src/core/cpu80386.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/cpu80486.js')) ? ['src/core/cpu80486.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/cpu80586.js')) ? ['src/core/cpu80586.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/cpu80686.js')) ? ['src/core/cpu80686.js'] : []),
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js', 'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', ...(fs.existsSync(path.join(root, 'src/core/machine586.js')) ? ['src/core/machine586.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/machine686.js')) ? ['src/core/machine686.js'] : []), 'src/core/bios.js', 'src/core/vgabios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const [Asm86, Machine, BIOS_SOURCE, fat12Blank, fat12AddFiles] =
  ['Asm86', 'Machine', 'BIOS_SOURCE', 'fat12Blank', 'fat12AddFiles'].map(n => vm.runInThisContext(n));

const DOS_DIR = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files';
const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1].startsWith('--'));
const bootImg = pos[0] || path.join(DOS_DIR, 'msdos.img');
const prog = pos[1] || path.join(DOS_DIR, 'CAT.EXE');
if (!fs.existsSync(bootImg)) { console.log('skip: no boot image at', bootImg); process.exit(0); }

const MODEL = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : '8086';
const MachineClass = MODEL === '80686' ? vm.runInThisContext('Machine686') : MODEL === '80586' ? vm.runInThisContext('Machine586') : MODEL === '80486' ? vm.runInThisContext('Machine486') : MODEL === '80386' ? vm.runInThisContext('Machine386') : MODEL === '80286' ? vm.runInThisContext('Machine286') : Machine;
const VIDEO = process.argv.includes('--video') ? process.argv[process.argv.indexOf('--video') + 1] : 'cga';
const TIMING = process.argv.includes('--timing') ? process.argv[process.argv.indexOf('--timing') + 1] : 'fast';
const SLOW = TIMING === 'real' ? 10 : 1;           // real disk timing: allow more emulated time
const bios = Asm86.assemble(vm.runInThisContext('biosSource')(MODEL), { origin: 0 });
console.log(`model ${MODEL}, video ${VIDEO}, disk timing ${TIMING}` + (MODEL !== '8086' ? ` (CPU core: ${new MachineClass().cpu.constructor.name})` : ''));
const m = new MachineClass({ video: VIDEO });
const CPU_OPT = process.argv.includes('--cpu') ? process.argv[process.argv.indexOf('--cpu') + 1] : '';
if (CPU_OPT === '80386') { m.cpu = new (vm.runInThisContext('CPU80386'))(m.bus); console.log('CPU core: CPU80386 on the AT machine'); }
const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
m.setRom(rom, bios.symbols);
if (VIDEO === 'vga') m.setVgaRom(vm.runInThisContext('makeVgaRom')(null).bytes);
m.diskTiming = TIMING;
m.reset();
m.insertDisk(0, 'boot', new Uint8Array(fs.readFileSync(bootImg)));
if (fs.existsSync(prog)) {
  const b = fat12Blank('GAMES');
  fat12AddFiles(b, [{ name: path.basename(prog), bytes: new Uint8Array(fs.readFileSync(prog)) }]);
  m.insertDisk(1, 'games', b);
}

function screenText() {
  const v = m.vram(); const lines = [];
  for (let r = 0; r < 25; r++) {
    let s = '';
    for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(r * 80 + c) * 2] || 32);
    lines.push(s.replace(/\s+$/, ''));
  }
  return lines.join('\n').replace(/\n+$/, '');
}
const SC = { '\r': 0x1C, ' ': 0x39, ':': 0x27, '.': 0x34 };
'abcdefghijklmnopqrstuvwxyz'.split('').forEach(ch => {
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], base = [0x10, 0x1E, 0x2C];
  rows.forEach((r, i) => { const k = r.indexOf(ch); if (k >= 0) SC[ch] = base[i] + k; });
});
'1234567890'.split('').forEach((d, i) => { SC[d] = 2 + i; });
let keyQueue = [];
function type(s) { for (const ch of s) { const lower = ch.toLowerCase(); const shift = ch !== lower || ch === ':'; keyQueue.push({ code: SC[lower], shift }); } }
function pumpKeys() {
  // one key per call, with shift where needed
  if (!keyQueue.length || m.kbd.fifo.length) return;
  const k = keyQueue.shift();
  if (k.shift) m.keyDown(0x2A);
  m.keyDown(k.code); m.keyUp(k.code);
  if (k.shift) m.keyUp(0x2A);
}
function runUntil(pred, maxCycles, label) {
  let n = 0;
  maxCycles *= SLOW * Math.max(1, m.clockHz / 8e6);   // the same emulated time at a faster clock
  while (n < maxCycles) {
    m.run(50000); n += 50000;
    pumpKeys();
    if (pred()) return true;
  }
  console.log(`timeout waiting for: ${label}`);
  return false;
}
const t0 = Date.now();
let ok = true;
ok = runUntil(() => /Enter new date|A>/.test(screenText()), 60e6, 'DOS start') && ok;
console.log(`DOS started after ${(m.cpu.cycles / m.clockHz).toFixed(1)} emulated s (${Date.now() - t0} ms real)`);
if (/Enter new date/.test(screenText())) { type('\r'); ok = runUntil(() => /Enter new time/.test(screenText()), 20e6, 'time prompt') && ok; type('\r'); }
ok = runUntil(() => /A>\s*$/.test(screenText()), 30e6, 'A> prompt') && ok;
type('dir\r');
ok = runUntil(() => /bytes free/.test(screenText()), 60e6, 'DIR output') && ok;
console.log(screenText().split('\n').map(l => '  | ' + l).join('\n'));
if (m.disks[1]) {
  type('b:\r');
  ok = runUntil(() => /B>\s*$/.test(screenText()), 30e6, 'B> prompt') && ok;
  type(path.basename(prog, path.extname(prog)) + '\r');
  const before = m.cpu.cycles;
  const isGfx = () => m.vga ? m.vga.mode.graphics : (m.crtc.mode & 2) !== 0;
  const gfx = runUntil(isGfx, 200e6, 'graphics mode');
  const how = m.vga ? `VGA ${m.vga.mode.width}x${m.vga.mode.height}, ${m.vga.mode.colors} colours, BIOS mode ${m.mem[0x449].toString(16)}h`
    : `mode reg ${m.crtc.mode.toString(16)}, palette ${m.crtc.color.toString(16)}`;
  console.log(`program switched to graphics mode: ${gfx} (${how}) after ${((m.cpu.cycles - before) / m.clockHz).toFixed(1)} emulated s`);
  // let it run a few emulated seconds and count lit pixels
  m.run(30e6);
  const v = m.vram(); let lit = 0;
  for (let i = 0; i < 0x4000; i++) if (v[i]) lit++;
  console.log(`non-zero video bytes: ${lit}; speaker changes logged: ${m.spkLog.length}; CS:IP ${m.cpu.sregs[1].toString(16)}:${m.cpu.ip.toString(16)}`);
  ok = ok && gfx && lit > 500;
}
const dk = m.disks.filter(Boolean).map((d, i) => `${'AB'[i]}: ${d.reads} sectors read, ${d.writes} written`).join('; ');
console.log(`disks: ${dk}; ${(m.cpu.cycles / m.clockHz).toFixed(1)} emulated s in all, ${Date.now() - t0} ms real`);
console.log(ok ? 'DOS test passed' : 'DOS test FAILED');
process.exitCode = ok ? 0 : 1;
