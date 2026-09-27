// Speed of the full machine (CPU, bus, devices) in Node: the BIOS starts, then the
// benchmark program tests/asm286/bench.bin runs in a loop under Machine.run. Compare with
// tests/bench.mjs (the CPU core alone on a plain bus): the difference is the cost of the
// machine. Each model runs in its own process.
// Usage: node tools/machbench.mjs [seconds] [model] [--prof out.cpuprofile]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCore } from './vgapng.mjs';
const self = fileURLToPath(import.meta.url);
const root = path.join(path.dirname(self), '..');
const secs = +(process.argv[2] || 2), which = process.argv[3];
if (!which) {
  for (const m of ['8086', '80286', '80386', '80486', '80586', '80686']) process.stdout.write(execFileSync(process.execPath, [self, String(secs), m]));
  process.exit(0);
}
const G = loadCore();
const cls = { 8086: 'Machine', 80286: 'Machine286', 80386: 'Machine386', 80486: 'Machine486', 80586: 'Machine586', 80686: 'Machine686' }[which];
const m = new (G(cls))({ video: process.argv.includes('--vga') ? 'vga' : 'cga' });
if (process.argv.includes('--js')) m.cpu.w6Off = true;     // (the Pentium Pro: the JavaScript model only)
const bios = G('Asm86').assemble(G('biosSource')(which), { origin: 0 });
const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
m.setRom(rom);
if (m.vga) m.setVgaRom(G('makeVgaRom')(null).bytes);
m.reset();
m.loadProgram(fs.readFileSync(path.join(root, 'tests/asm286/bench.bin')), 0x100);
m.pokeMem(0x4F0, [0x00, 0x01, 0x00, 0x10, 0x86]);
const slice = Math.round(m.clockHz / 100);
for (let i = 0; i < 200; i++) m.run(slice);        // the BIOS, then the warm-up
const pi = process.argv.indexOf('--prof');
let sess = null, post = null;
if (pi > 0) {
  const inspector = await import('node:inspector');
  sess = new inspector.Session(); sess.connect();
  post = (k, p) => new Promise((ok, no) => sess.post(k, p || {}, (e, r) => (e ? no(e) : ok(r))));
  await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 200 }); await post('Profiler.start');
}
const c0 = m.cpu.cycles, i0 = m.cpu.instructions, t0 = process.hrtime.bigint();
while (Number(process.hrtime.bigint() - t0) / 1e9 < secs) m.run(slice);
const dt = Number(process.hrtime.bigint() - t0) / 1e9, ins = m.cpu.instructions - i0, cyc = m.cpu.cycles - c0;
if (sess) { const { profile } = await post('Profiler.stop'); fs.writeFileSync(process.argv[pi + 1], JSON.stringify(profile)); }
console.log(`${cls.padEnd(10)} ${(ins / dt / 1e6).toFixed(2)} M instr/s, ${(cyc / dt / m.clockHz).toFixed(2)} x real time (${(m.clockHz / 1e6).toFixed(2)} MHz, ${(cyc / ins).toFixed(2)} clocks/instr)`);
