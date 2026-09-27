// The hard disk (drive C:): the IDE controller, the BIOS (INT 13h for drive 80h, the POST line,
// the boot from C:) and the disk tools of disk.js. For each case: a new 20 MB disk (hdBlank),
// made bootable from the user's DOS floppy (hdMakeBootable, as SYS C:), a folder tree copied
// into it (fatAddTree: long names become 8.3 names). Then the machine starts with no floppy in
// A:, boots DOS from C:, lists and reads files, and copies one; the copy must be on the disk
// image (read back with the FAT16 tools).
// Usage: node tests/hd.test.mjs [--model 8086|80286|...] [--dos 3.3|6.22]
// Without options: DOS 3.3 on the 8086 and the 80286, DOS 6.22 on the 80386 and the Pentium Pro.
// The DOS images are the user's own files; a case skips when its image is missing.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js',
  'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/p6ooo.wasm.js', 'src/core/cpu80686.js', 'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js',
  'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js', 'src/core/machine286.js', 'src/core/machine386.js',
  'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js', 'src/core/vgabios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const G = n => vm.runInThisContext(n);
const DOS_DIR = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files';
const IMG = { '3.3': path.join(DOS_DIR, 'msdos.img'), '6.22': path.join(DOS_DIR, 'msdos/dos6.img') };
const CLS = { 8086: 'Machine', 80286: 'Machine286', 80386: 'Machine386', 80486: 'Machine486', 80586: 'Machine586', 80686: 'Machine686' };
const arg = k => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const cases = arg('--model') || arg('--dos') ? [[arg('--model') || '80386', arg('--dos') || '6.22']]
  : [['8086', '3.3'], ['80286', '3.3'], ['80386', '6.22'], ['80686', '6.22']];

let pass = 0, fail = 0;
const check = (ok, name) => { if (ok) pass++; else fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); return ok; };

// 1. the MBR bytes are the same as tools/hdmbr.asm
{
  const a = G('Asm86').assemble(fs.readFileSync(path.join(root, 'tools/hdmbr.asm'), 'utf8'), { origin: 0x600 });
  const b = G('b64bytes')(G('HD_MBR'));
  check(!(a.errors && a.errors.length) && a.bytes.length === b.length && a.bytes.every((x, i) => x === b[i]), 'HD_MBR = tools/hdmbr.asm');
}

const SC = { '\r': 0x1C, ' ': 0x39, ':': 0x27, '.': 0x34, '\\': 0x2B, '>': 0x34, '~': 0x29 };
'abcdefghijklmnopqrstuvwxyz'.split('').forEach(ch => {
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], base = [0x10, 0x1E, 0x2C];
  rows.forEach((r, i) => { const k = r.indexOf(ch); if (k >= 0) SC[ch] = base[i] + k; });
});
'1234567890'.split('').forEach((d, i) => { SC[d] = 2 + i; });

for (const [model, dos] of cases) {
  if (!fs.existsSync(IMG[dos])) { console.log(`skip: no DOS ${dos} image at ${IMG[dos]}`); continue; }
  console.log(`--- DOS ${dos} from drive C: on the ${model}`);
  // the disk
  const hd = G('hdBlank')('DRIVE C'), floppy = new Uint8Array(fs.readFileSync(IMG[dos]));
  const sys = G('hdMakeBootable')(hd, floppy);
  check(sys.join(' ') === 'IO.SYS MSDOS.SYS COMMAND.COM', `SYS C: copies ${sys.join(', ')}`);
  const tree = G('fatAddTree')(G('hdFs')(hd), [
    { path: 'Tools/hello.txt', bytes: new TextEncoder().encode('HELLO FROM THE PAGE\r\n') },
    { path: 'Long Folder Name/a long file name.text', bytes: new TextEncoder().encode('LONG NAME FILE\r\n') },
    { path: 'Long Folder Name/Sub/deep.txt', bytes: new Uint8Array(5000).fill(0x41) },
  ]);
  check(tree.files === 3 && tree.dirs === 3 && tree.renamed.some(r => r.to === 'LONGFO~1\\ALONGF~1.TEX'), `a folder tree: ${tree.files} files, ${tree.dirs} directories, ${tree.renamed.length} new 8.3 names`);
  // the machine: no floppy, the hard disk
  const bios = G('Asm86').assemble(G('biosSource')(model), { origin: 0 });
  const m = new (G(CLS[model]))({ video: 'cga' });
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
  m.setRom(rom, bios.symbols);
  m.reset();
  m.insertHardDisk('c', hd);
  const screen = () => {
    const v = m.vram(), rows = [];
    for (let r = 0; r < 25; r++) { let s = ''; for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(r * 80 + c) * 2] || 32); rows.push(s.trimEnd()); }
    return rows.join('\n').replace(/\n+$/, '');
  };
  const keys = [];
  const type = s => { for (const ch of s) { const lo = ch.toLowerCase(); keys.push({ code: SC[lo], shift: ch !== lo || ch === ':' || ch === '>' || ch === '~' }); } };
  const pump = () => { if (!keys.length || m.kbd.fifo.length) return; const k = keys.shift(); if (k.shift) m.keyDown(0x2A); m.keyDown(k.code); m.keyUp(k.code); if (k.shift) m.keyUp(0x2A); };
  const until = (pred, secs, label) => {
    const end = m.cpu.cycles + secs * m.clockHz, slice = Math.round(m.clockHz / 100);
    while (m.cpu.cycles < end) { m.run(slice); pump(); if (pred()) return true; }
    console.log(`  time-out: ${label}\n` + screen().split('\n').map(l => '  | ' + l).join('\n'));
    return false;
  };
  const t0 = Date.now();
  check(until(() => /DISK {2}C: IDE hard disk, 20 MB \(615 cylinders, 4 heads, 17 sectors\)/.test(screen()), 5, 'the POST line'), 'POST: "DISK  C: IDE hard disk, 20 MB (615 cylinders, 4 heads, 17 sectors)"');
  check(until(() => /Booting from drive C:/.test(screen()), 10, 'boot from C:'), 'no floppy in A: -> "Booting from drive C:"');
  const prompt = () => /(^|\n)C:?\\?>\s*$/.test(screen());
  until(() => /Enter new date|(^|\n)C:?\\?>/.test(screen()), 60, 'DOS start');
  if (/Enter new date/.test(screen())) { type('\r'); until(() => /Enter new time/.test(screen()), 20, 'time prompt'); type('\r'); }
  check(until(prompt, 30, 'the C> prompt'), `DOS ${dos} starts from drive C: (${(m.cpu.cycles / m.clockHz).toFixed(1)} emulated s)`);
  type('dir\r');
  check(until(() => /bytes free/.test(screen()), 30, 'DIR') && /TOOLS\s+<DIR>/.test(screen()) && /LONGFO~1\s+<DIR>/.test(screen()), 'DIR shows the directories of the folder tree');
  type('type tools\\hello.txt\r');
  check(until(() => /HELLO FROM THE PAGE/.test(screen()), 20, 'TYPE'), 'TYPE TOOLS\\HELLO.TXT reads the file');
  type('copy longfo~1\\sub\\deep.txt c:\\copy.txt\r');
  check(until(() => /1 [Ff]ile\(s\) copied/.test(screen()) && prompt(), 30, 'COPY'), 'COPY writes a file to drive C:');
  const fsys = G('hdFs')(m.hdisk.data), en = fsys.find('', 'COPY.TXT');
  check(!!en && en.size === 5000 && fsys.read(en).every(x => x === 0x41), 'the copy is on the disk image (5000 bytes, the same data)');
  console.log(`  C: ${m.hdisk.reads} sectors read, ${m.hdisk.writes} written; ${(m.cpu.cycles / m.clockHz).toFixed(1)} emulated s, ${Date.now() - t0} ms real`);
}
console.log(fail ? `${fail} hard disk test(s) failed, ${pass} passed` : `all ${pass} hard disk tests passed`);
process.exitCode = fail ? 1 : 0;
