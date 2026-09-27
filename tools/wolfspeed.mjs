// Speed of the emulator: boot DOS 6.22 + WOLF3D (the user's files, not in the project) on a
// model and print the real time for each emulated second.
// Usage: node tools/wolfspeed.mjs [--model 80486|80386|80586|80686] [--secs 25] [--nocache]
//   [--steady --out f.cpuprofile]: a CPU profile from emulated second 2 to the end
//   [--dis --from 0xAB0 --to 0xB30]: disassemble the game code at the end
import fs from 'node:fs';
import path from 'node:path';
import { loadCore } from './vgapng.mjs';
const G = loadCore();
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const MODEL = arg('--model', '80486'), SECS = +arg('--secs', 25);
const DOS = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files', WOLF = path.join(DOS, 'WOLF3D');
const M = G({ '80686': 'Machine686', '80586': 'Machine586', '80486': 'Machine486', '80386': 'Machine386' }[MODEL]);
const m = new M({ video: 'vga', cache: !process.argv.includes('--nocache') });
const bios = G('Asm86').assemble(G('biosSource')(MODEL), { origin: 0 });
const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
m.setRom(rom, bios.symbols); m.setVgaRom(G('makeVgaRom')(null).bytes); m.reset();
const disk = G('fat12Blank')('WOLF3D', 2949120);
G('fat12AddFiles')(disk, fs.readdirSync(WOLF).map(n => ({ name: n, bytes: new Uint8Array(fs.readFileSync(path.join(WOLF, n))) })));
m.insertDisk(0, 'dos6', new Uint8Array(fs.readFileSync(path.join(DOS, 'msdos/dos6.img')))); m.insertDisk(1, 'wolf', disk);
const SC = { '\r': 0x1C, ' ': 0x39, ':': 0x27, '=': 0x0D, '3': 4 };
'abcdefghijklmnopqrstuvwxyz'.split('').forEach(ch => { const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], base = [0x10, 0x1E, 0x2C]; rows.forEach((r, i) => { const k = r.indexOf(ch); if (k >= 0) SC[ch] = base[i] + k; }); });
const keys = [];
const type = s => { for (const ch of s) keys.push(ch === ':' ? 0x127 : SC[ch]); };
let a20cuts = 0, mc = 0;
const cut = m.a20Cut ? m.a20Cut.bind(m) : null; if (cut) m.a20Cut = () => { a20cuts++; cut(); };
const mch = m.memChanged.bind(m); m.memChanged = (a, l) => { mc++; mch(a, l); };
const run = secs => { const end = m.cpu.cycles + secs * m.clockHz; while (m.cpu.cycles < end) { m.run(40000); if (keys.length && !m.kbd.fifo.length) { const k = keys.shift(); if (k & 0x100) m.keyDown(0x2A); m.keyDown(k & 0xFF); m.keyUp(k & 0xFF); if (k & 0x100) m.keyUp(0x2A); } } };
run(8); type('b:\r'); run(1); type('wolf3d\r');
const ports = {};
if (process.argv.includes('--idle')) { const r = m.ioRead.bind(m); m.ioRead = p => { ports[p.toString(16)] = (ports[p.toString(16)] || 0) + 1; return r(p); }; }
let sess = null;
const inspector = await import('node:inspector');
const post = (m, p) => new Promise((ok, no) => sess.post(m, p || {}, (e, r) => (e ? no(e) : ok(r))));
for (let s = 0; s < SECS; s++) {
  if (process.argv.includes('--steady') && s === 2) { sess = new inspector.Session(); sess.connect(); await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 200 }); await post('Profiler.start'); }
  if ([12, 24, 38, 44].includes(s)) { m.keyDown(0x1C); run(0.1); m.keyUp(0x1C); }
  const C = m.cpu.cache486 || m.cpu.dcache;           // the 80486 cache, or the Pentium data cache
  const t = Date.now(), i0 = m.cpu.instructions, st = C ? { ...C.stats } : null; a20cuts = 0; mc = 0;
  run(1);
  const cs = C ? C.stats : null;
  const d = k => cs[k] - st[k];
  if (process.argv.includes('--idle')) { console.log(`idle skips ${m.idleSkips} saved ${(m.idleSaved / m.clockHz).toFixed(2)} s, watch ${m.idleIp.toString(16)} n ${m.idleN}, ports ${JSON.stringify(ports)}`); m.idleSkips = 0; m.idleSaved = 0; for (const k in ports) delete ports[k]; }
  console.log(`s ${s}: ${Date.now() - t} ms real, ${((m.cpu.instructions - i0) / 1e6).toFixed(2)} M instr, a20Cut ${a20cuts}, memChanged ${mc}` + (cs ? `, hits ${d('hits')} miss ${d('misses')} unc ${d('uncached')} fills ${d('fills')} inval ${d('invalidations')}` : '') + ` CS:IP ${m.cpu.sregs[1].toString(16)}:${m.cpu.ip.toString(16)}`);
}
if (process.argv.includes('--dis')) {
  const D = G('Disasm86'), c = m.cpu, base = c.cache[1].base;
  let ip = +arg('--from', 0xAB0);
  const end = +arg('--to', 0xB30);
  while (ip < end) { const r = D.decode(i => m.peek8(base + ip + i), ip, { cpu: MODEL === '80686' ? '686' : MODEL === '80586' ? '586' : '386', bits: 16 }); console.log(ip.toString(16), r.text); ip += r.len || 1; }
}

if (sess) { const { profile } = await post('Profiler.stop'); fs.writeFileSync(arg('--out', 'steady.cpuprofile'), JSON.stringify(profile)); }
