// Boot a floppy image in Node and report where the machine spends its time.
// Usage: node tools/bootprobe.mjs <image> [--model 80286|80386|80486|80586|80686] [--seconds 20]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js',
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/machine.js', 'src/core/devices286.js', 'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const MODEL = arg('--model') || '8086';
const secs = +(arg('--seconds') || 20);
const img = process.argv[2];
const Asm86 = vm.runInThisContext('Asm86'), Disasm86 = vm.runInThisContext('Disasm86');
const M = vm.runInThisContext(MODEL === '80686' ? 'Machine686' : MODEL === '80586' ? 'Machine586' : MODEL === '80486' ? 'Machine486' : MODEL === '80386' ? 'Machine386' : MODEL === '80286' ? 'Machine286' : 'Machine');
const bios = Asm86.assemble(vm.runInThisContext('biosSource')(MODEL), { origin: 0 });
const m = new M();
const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
m.setRom(rom, bios.symbols); m.reset();
m.insertDisk(0, 'boot', new Uint8Array(fs.readFileSync(img)));
const screen = () => {
  const v = m.vram(); const out = [];
  for (let r = 0; r < 25; r++) { let s = ''; for (let c = 0; c < 80; c++) s += String.fromCharCode(v[(r * 80 + c) * 2] || 32); out.push(s.trimEnd()); }
  return out.join('\n').replace(/\n+$/, '');
};
// run in slices; sample CS:IP and the I/O ports used
const hot = new Map(), ports = new Map();
const origIn = m.ioRead.bind(m), origOut = m.ioWrite.bind(m);
m.ioRead = p => { ports.set('in ' + p.toString(16), (ports.get('in ' + p.toString(16)) || 0) + 1); return origIn(p); };
m.ioWrite = (p, v) => { ports.set('out ' + p.toString(16), (ports.get('out ' + p.toString(16)) || 0) + 1); return origOut(p, v); };
const total = secs * m.clockHz;
let done = 0, lastScreen = '';
while (done < total) {
  m.run(20000); done += 20000;
  const k = m.cpu.sregs[1].toString(16).padStart(4, '0') + ':' + m.cpu.ip.toString(16).padStart(4, '0');
  hot.set(k, (hot.get(k) || 0) + 1);
  if (done > total / 2 && !lastScreen) { lastScreen = screen(); ports.clear(); hot.clear(); }
}
console.log(`model ${MODEL}, ${secs} emulated s, halted=${m.cpu.halted}, IF=${(m.cpu.flags >> 9) & 1}`);
console.log(screen().split('\n').map(l => '  | ' + l).join('\n'));
const top = [...hot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log('second half, CS:IP samples:', top.map(([k, n]) => `${k} x${n}`).join(', '));
for (const [k] of top.slice(0, 2)) {
  const [cs, ip] = k.split(':').map(x => parseInt(x, 16));
  let o = ip, text = [];
  for (let i = 0; i < 6; i++) {
    const d = Disasm86.decode(j => m.peek8(((cs << 4) + ((o + j) & 0xFFFF))), o, MODEL === '80686' ? { cpu: '686' } : MODEL === '80586' ? { cpu: '586' } : MODEL === '80486' ? { cpu: '486' } : MODEL === '80386' ? { cpu: '386' } : MODEL === '80286' ? { cpu: '286' } : undefined);
    text.push(`${o.toString(16)}: ${d.text}`); o = (o + d.len) & 0xFFFF;
  }
  console.log(`  code at ${k}:\n    ` + text.join('\n    '));
}
console.log('second half, I/O ports:', [...ports.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} x${n}`).join(', '));
