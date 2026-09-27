// Emulated speed of the CPU cores in Node: untraced step() loop on a real-mode program
// (tests/asm286/bench.asm). Each core runs in its own process, as in the page (one CPU per
// page load): V8 specializes the optimized code to one bus, and a second CPU instance in
// the same process makes that code deoptimize.
// Usage: node tests/bench.mjs [seconds]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const root = path.join(path.dirname(self), '..');
const secs = +(process.argv[2] || 2);
const which = process.argv[3];

if (!which) {
  for (const core of ['8086', '286', '386', '486', '586', '686']) process.stdout.write(execFileSync(process.execPath, [self, String(secs), core]));
  process.exit(0);
}
for (const f of ['src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: f });
}
const prog = fs.readFileSync(path.join(root, 'tests/asm286/bench.bin'));
const name = { 8086: 'CPU8086', 386: 'CPU80386', 486: 'CPU80486', 586: 'CPU80586', 686: 'CPU80686' }[which] || 'CPU80286';
if (vm.runInThisContext(`typeof ${name}`) === 'undefined') process.exit(0);
const Cls = vm.runInThisContext(name);
const mem = new Uint8Array(1 << 24);
const bus = { read8: a => mem[a], write8: (a, v) => { mem[a] = v; }, in8: () => 0xFF, out8: () => {}, fpu: null, waitStates: 1, busRatio: 3 };
mem.set(prog, 0x10100);
const cpu = new Cls(bus);
cpu.reset();
if (cpu.loadSeg) { for (let i = 0; i < cpu.sregs.length; i++) cpu.loadSeg(i, 0x1000); } else cpu.sregs.fill(0x1000);
if (which === '486' || which === '586' || which === '686') cpu.cr[0] &= ~0x60000000;   // the caches on
cpu.ip = 0x100; cpu.flush();
if (cpu.regs32) { cpu.syncIn(); cpu.batch = true; }   // as in Machine.run
for (let i = 0; i < 2e6; i++) cpu.step();             // warm-up
const c0 = cpu.cycles, i0 = cpu.instructions, t0 = process.hrtime.bigint();
for (;;) {
  for (let i = 0; i < 1e5; i++) cpu.step();
  if (Number(process.hrtime.bigint() - t0) / 1e9 >= secs) break;
}
const dt = Number(process.hrtime.bigint() - t0) / 1e9;
const cyc = cpu.cycles - c0, ins = cpu.instructions - i0;
console.log(`${name.padEnd(9)} ${(ins / dt / 1e6).toFixed(2)} M instr/s, ${(cyc / dt / 1e6).toFixed(1)} MHz equivalent (${(cyc / ins).toFixed(2)} clocks/instr)`);
