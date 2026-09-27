// Boots the user's DOS 6.22 floppy (dos6.img) UNCHANGED. Its CONFIG.SYS loads HIMEM.SYS and the
// Oak CD-ROM driver (DEVICE=cd1.SYS /D:banana), and AUTOEXEC.BAT starts MSCDEX.
// - 80386 (default), 80486, 80586 and 80686: the driver finds no CD-ROM drive and stops ("No drives found"), MSCDEX
//   reports that, and DOS gets to the A:\> prompt. Then MEM must show the 15 MB of XMS memory.
// - 80286: the driver has 80386 instructions. The BIOS INT 6 handler shows the invalid
//   opcode and stops the machine (it must not hang without a message).
// Usage: node tests/dos6.test.mjs [dos6.img] [--model 80386|80486|80586|80686|80286] [--video cga|vga]
// The image is the user's own file; the test skips when it is missing.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js',
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js',
  'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js', 'src/core/vgabios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const G = n => vm.runInThisContext(n);
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const MODEL = arg('--model', '80386'), VIDEO = arg('--video', 'cga');
const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));
const IMG = pos[0] || 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files/msdos/dos6.img';
if (!fs.existsSync(IMG)) { console.log('skip: no DOS 6.22 image at', IMG); process.exit(0); }

let pass = 0, fail = 0;
const check = (ok, name) => { if (ok) pass++; else fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };

const img = new Uint8Array(fs.readFileSync(IMG));
{
  const f = new (G('Fat12'))(img);
  const cfg = Buffer.from(f.read(f.find('', 'CONFIG.SYS'))).toString('latin1');
  check(/^DEVICE=cd1\.SYS \/D:banana\s*$/im.test(cfg), 'CONFIG.SYS loads the CD-ROM driver (the image is not changed)');
}
const M = G(MODEL === '80686' ? 'Machine686' : MODEL === '80586' ? 'Machine586' : MODEL === '80486' ? 'Machine486' : MODEL === '80386' ? 'Machine386' : 'Machine286');
const bios = G('Asm86').assemble(G('biosSource')(MODEL), { origin: 0 });
const m = new M({ video: VIDEO });
const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
m.setRom(rom, bios.symbols);
if (VIDEO === 'vga') m.setVgaRom(G('makeVgaRom')(null).bytes);
m.reset();
m.insertDisk(0, 'dos6', img.slice());                  // a copy: the file on the disk does not change
console.log(`model ${MODEL} (${m.cpu.constructor.name} @ ${m.clockHz / 1e6} MHz), video ${VIDEO}`);

const screen = () => {
  const v = m.vram(), rows = [];
  for (let r = 0; r < 25; r++) { let s = ''; for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(r * 80 + c) * 2] || 32); rows.push(s.trimEnd()); }
  return rows.join('\n').replace(/\n+$/, '');
};
const SC = { '\r': 0x1C, ' ': 0x39 };
'abcdefghijklmnopqrstuvwxyz'.split('').forEach(ch => {
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], base = [0x10, 0x1E, 0x2C];
  rows.forEach((r, i) => { const k = r.indexOf(ch); if (k >= 0) SC[ch] = base[i] + k; });
});
const keys = [];
const type = s => { for (const ch of s) keys.push(SC[ch]); };
// run up to `secs` emulated seconds, in steps of 20 ms; stop when until() is true
const run = (secs, until) => {
  const end = m.cpu.cycles + secs * m.clockHz;
  while (m.cpu.cycles < end) {
    const r = m.run(m.clockHz / 50);
    if (keys.length && !m.kbd.fifo.length) { const k = keys.shift(); m.keyDown(k); m.keyUp(k); }
    if (until && until()) return true;
    if (r === 'halt') return false;
  }
  return false;
};
const prompt = () => /A:\\>\s*$/.test(screen());
const t0 = Date.now();
const show = () => console.log(screen().split('\n').filter(l => l.trim()).map(l => '  | ' + l).join('\n'));

if (MODEL === '80386' || MODEL === '80486' || MODEL === '80586' || MODEL === '80686') {
  const ok = run(30, prompt);
  const secs = m.cpu.cycles / m.clockHz;
  check(ok, `A:\\> prompt after ${secs.toFixed(2)} emulated s (${Date.now() - t0} ms real)`);
  const s = screen();
  show();
  check(/CD-ROM Device Driver for IDE[\s\S]*Device Name {8}: BANANA/.test(s), 'the Oak CD-ROM driver starts');
  check(/No drives found, aborting installation/.test(s), 'the driver finds no CD-ROM drive and ends');
  check(/Device driver not found: 'BANANA'/.test(s), 'MSCDEX finds no CD-ROM driver');
  check(!/Invalid opcode/.test(s), 'no invalid opcode');
  type('mem\r');
  const t1 = Date.now();
  const memOk = run(10, () => /Extended \(XMS\)[\s\S]*A:\\>\s*$/.test(screen()));
  const s2 = screen();
  check(memOk, `MEM ends (${Date.now() - t1} ms real)`);
  check(/Extended \(XMS\) +15,360K/.test(s2), 'MEM: 15,360K of extended memory (XMS, HIMEM.SYS)');
  check(/The high memory area is available\./.test(s2), 'MEM: the high memory area (A20) is available');
  show();
} else {
  // the 80286: the driver stops at its first 80386 instruction, with a message
  const stopped = run(30, () => /This code needs a newer CPU/.test(screen()));
  show();
  check(stopped, `the INT 6 message after ${(m.cpu.cycles / m.clockHz).toFixed(2)} emulated s (${Date.now() - t0} ms real)`);
  check(/Invalid opcode \(INT 6\) at [0-9A-F]{4}:[0-9A-F]{4} {2}bytes: 66 /.test(screen()), 'the bad instruction has a 66h prefix (32-bit operand)');
}
console.log(fail ? `${fail} DOS 6.22 test(s) failed, ${pass} passed` : `all ${pass} DOS 6.22 tests passed`);
process.exitCode = fail ? 1 : 0;
