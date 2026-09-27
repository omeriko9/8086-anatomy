// Floppy subsystem tests: the uPD765A controller (src/core/fdc765.js), the 8237 DMA
// channel 2, the drive mechanics, the trace events, and a boot of a small FAT12 disk
// through the BIOS INT 13h in both disk timing modes.
// The 80386 machine runs the AT parts too.
// Usage: node tests/fdc.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js',
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js',
  'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const G = n => vm.runInThisContext(n);
const [Asm86, Machine, Machine286, Machine386, DMA8237, fat12Blank, fat12AddFiles, biosSource] =
  ['Asm86', 'Machine', 'Machine286', 'Machine386', 'DMA8237', 'fat12Blank', 'fat12AddFiles', 'biosSource'].map(G);
const newMachine = model => (model === '80686' ? new (G('Machine686'))() : model === '80586' ? new (G('Machine586'))() : model === '80486' ? new (G('Machine486'))() : model === '80386' ? new Machine386() : model === '80286' ? new Machine286() : new Machine());

let pass = 0, fail = 0, section = '';
const check = (ok, name) => { if (ok) pass++; else { fail++; console.log(`FAIL [${section}] ${name}`); } };
const eq = (a, b, name) => { const A = JSON.stringify(a), B = JSON.stringify(b); check(A === B, `${name}: got ${A}, want ${B}`); };
const begin = s => { section = s; console.log(`- ${s}`); };
const hex = v => v.toString(16);

// ---------- helpers: a machine without a running CPU; the test talks to the ports ----------
function patternDisk(size = 1474560) {
  const d = fat12Blank('TEST', size);
  for (let i = 512; i < d.length; i++) d[i] = (i * 7 + (i >> 9) * 13) & 0xFF;
  return d;
}
function mk(model = '8086', timing = 'fast') {
  const m = newMachine(model);
  m.diskTiming = timing;
  m.reset();
  return m;
}
const out = (m, p, v) => m.ioWrite(p, v);
const inp = (m, p) => m.ioRead(p);
// advance the devices by n clocks (in small slices, like instructions)
function adv(m, n) { for (let k = 0; k < n; k += 64) m.tickDevices(64); }
function until(m, pred, max = 5e6) { let n = 0; while (!pred() && n < max) { m.tickDevices(64); n += 64; } return pred(); }
function fdcCmd(m, bytes) {
  for (const b of bytes) {
    if (!until(m, () => (inp(m, 0x3F4) & 0xC0) === 0x80, 1e5)) throw new Error(`the controller does not take byte ${hex(b)} (MSR ${hex(inp(m, 0x3F4))})`);
    out(m, 0x3F5, b);
  }
}
function fdcResult(m) { const r = []; while ((inp(m, 0x3F4) & 0xC0) === 0xC0 && r.length < 16) r.push(inp(m, 0x3F5)); return r; }
const irq6 = m => !!(m.pic.irr & 0x40);
function waitIrq(m, max = 2e7) { return until(m, () => m.fdc.irq, max); }
function resetFdc(m, dor = 0x1C) {
  out(m, 0x3F2, dor & ~4);
  out(m, 0x3F2, dor);
  waitIrq(m);
  const st = [];
  for (let i = 0; i < 4; i++) { fdcCmd(m, [0x08]); st.push(fdcResult(m)[0]); }
  fdcCmd(m, [0x03, 0xDF, 0x02]);                      // SPECIFY like the IBM BIOS
  return st;
}
function dmaSetup(m, mode, addr, count) {
  out(m, 0x0A, 0x06);                                  // mask channel 2
  out(m, 0x0C, 0);                                     // clear the flip-flop
  out(m, 0x0B, mode);
  out(m, 0x04, addr & 0xFF); out(m, 0x04, (addr >> 8) & 0xFF);
  out(m, 0x81, addr >> 16);
  out(m, 0x05, (count - 1) & 0xFF); out(m, 0x05, (count - 1) >> 8);
  out(m, 0x0A, 0x02);                                  // unmask channel 2
}
function seek(m, cyl, hd = 0) { fdcCmd(m, [0x0F, hd << 2, cyl]); waitIrq(m); fdcCmd(m, [0x08]); return fdcResult(m); }
function rw(m, cmd, hd, C, H, R, eot = 18) { fdcCmd(m, [cmd, hd << 2, C, H, R, 2, eot, 0x1B, 0xFF]); waitIrq(m, 5e7); return fdcResult(m); }
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------- 1. DMA 8237 ----------
begin('8237 DMA channel 2: count, TC, mask, modes');
{
  const d = new DMA8237(), mem = new Uint8Array(0x30000);
  const io = { read: a => mem[a], write: (a, v) => { mem[a] = v; } };
  d.write(0x0C, 0); d.write(0x0B, 0x46);               // single, write to memory, channel 2
  d.write(4, 0xFE); d.write(4, 0xFF); d.page[2] = 1;
  d.write(5, 2); d.write(5, 0);                        // count 2 = 3 transfers
  check(d.transfer(2, io, 1) === null, 'a masked channel does not answer');
  d.write(0x0A, 2);
  const r1 = d.transfer(2, io, 0xA1), r2 = d.transfer(2, io, 0xA2), r3 = d.transfer(2, io, 0xA3);
  eq([hex(r1.addr), r1.tc, r2.tc, r3.tc], ['1fffe', false, false, true], 'addresses and TC');
  eq([mem[0x1FFFE], mem[0x1FFFF], mem[0x10000]], [0xA1, 0xA2, 0xA3], 'the address wraps inside the 64 KB page');
  eq(d.count[2], 0xFFFF, 'count after TC');
  check(d.transfer(2, io, 0) === null, 'the channel masks itself at TC');
  eq(d.read(8) & 4, 4, 'status: TC of channel 2');
  eq(d.read(8) & 4, 0, 'reading the status clears TC');
  d.write(0x0B, 0x56); d.write(0x0C, 0);               // auto-init
  d.write(4, 0x00); d.write(4, 0x20); d.write(5, 1); d.write(5, 0); d.write(0x0A, 2);
  d.transfer(2, io, 1); const a2 = d.transfer(2, io, 2);
  eq([a2.tc, d.addr[2], d.count[2], d.mask & 4], [true, 0x2000, 1, 0], 'auto-init reloads the base registers');
  d.write(0x0B, 0x66); d.write(0x0C, 0); d.write(4, 0x10); d.write(4, 0x00); d.write(5, 3); d.write(5, 0); d.write(0x0A, 2);
  const dec = [0, 1, 2].map(() => d.transfer(2, io, 9).addr & 0xFFFF);
  eq(dec, [0x10, 0x0F, 0x0E], 'address decrement');
  mem[0x10020] = 0x5C;
  d.write(0x0B, 0x4A); d.write(0x0C, 0); d.write(4, 0x20); d.write(4, 0x00); d.write(5, 0); d.write(5, 0); d.write(0x0A, 2);
  const rd = d.transfer(2, io, 0);
  eq([rd.read, rd.data, rd.tc], [true, 0x5C, true], 'read mode: memory to the device');
  mem[0x10030] = 0x77;
  d.write(0x0B, 0x42); d.write(0x0C, 0); d.write(4, 0x30); d.write(4, 0x00); d.write(5, 0); d.write(5, 0); d.write(0x0A, 2);
  d.transfer(2, io, 0x11);
  eq(mem[0x10030], 0x77, 'verify mode: no memory cycle');
  d.write(8, 4); d.write(0x0A, 2);
  check(d.transfer(2, io, 0) === null, 'command bit 2: the controller is off');
  const m = mk(), m2 = mk('80286');
  out(m, 0x81, 0x1F); out(m, 0x87, 0x03); out(m2, 0x81, 0x1F);
  eq([m.dma.page[2], m.dma.page[0], m2.dma.page[2], inp(m, 0x81)], [0x0F, 0x03, 0x1F, 0x1F], 'page registers 81h/87h (4 bits on the XT)');
}

// ---------- 2. reset, SPECIFY, SENSE, invalid command ----------
begin('reset through DOR bit 2, 4 polls, SPECIFY, invalid command');
{
  const m = mk();
  eq(inp(m, 0x3F4), 0, 'after power-on the controller is in reset (MSR 00h)');
  out(m, 0x3F2, 0x0C);
  eq(inp(m, 0x3F4), 0, 'no RQM just after the reset');
  check(waitIrq(m, 1e5) && irq6(m), 'IRQ 6 after the reset');
  eq(inp(m, 0x3F4), 0x80, 'MSR 80h: ready for a command');
  const st = [];
  for (let i = 0; i < 4; i++) { fdcCmd(m, [0x08]); st.push(fdcResult(m)); if (i < 3) check(m.fdc.irq, `the interrupt stays after poll ${i + 1}`); }
  eq(st, [[0xC0, 0], [0xC1, 0], [0xC2, 0], [0xC3, 0]], 'SENSE INTERRUPT STATUS x4: ST0 = C0h-C3h');
  check(!m.fdc.irq && !irq6(m), 'the interrupt ends after the 4 polls');
  fdcCmd(m, [0x08]); eq(fdcResult(m), [0x80], 'no interrupt: SENSE INTERRUPT STATUS gives 80h');
  fdcCmd(m, [0x03, 0xAF, 0x02]);
  eq([inp(m, 0x3F4), m.fdc.srt, m.fdc.hut, m.fdc.hlt, m.fdc.nd], [0x80, 0xA, 0xF, 1, 0], 'SPECIFY: no result phase, the values');
  fdcCmd(m, [0x1F]);
  eq([inp(m, 0x3F4), m.fdc.phase], [0xD0, 'result'], 'invalid command: the result phase at once');
  eq(fdcResult(m), [0x80], 'invalid command: ST0 = 80h');
  eq(inp(m, 0x3F4), 0x80, 'idle again');
  // DOR bit 3 = 0: the interrupt does not reach the 8259A
  out(m, 0x3F2, 0x00); out(m, 0x3F2, 0x04);
  waitIrq(m, 1e5);
  check(m.fdc.irq && !irq6(m), 'DOR bit 3 = 0 gates IRQ 6');
  out(m, 0x3F2, 0x0C);
  check(irq6(m), 'DOR bit 3 = 1 lets the pending IRQ 6 through');
}

// ---------- 3. drive status, recalibrate, seek ----------
begin('SENSE DRIVE STATUS, RECALIBRATE, SEEK');
{
  const m = mk();
  m.insertDisk(0, 'a', patternDisk());
  resetFdc(m, 0x0C);                                   // motors off
  fdcCmd(m, [0x04, 0x00]); eq(fdcResult(m), [0x18], 'ST3: two sides, track 0, not ready (motor off)');
  out(m, 0x3F2, 0x1C); adv(m, 100);
  fdcCmd(m, [0x04, 0x00]); eq(fdcResult(m), [0x38], 'ST3: ready with the motor on');
  fdcCmd(m, [0x04, 0x05]); eq(fdcResult(m), [0x5D], 'ST3 of drive B: (no disk): write protected, head 1');
  fdcCmd(m, [0x0F, 0x00, 40]);
  eq([m.fdc.phase, inp(m, 0x3F4) & 0x81, m.fdc.drives[0].stepping, m.fdc.drives[0].targetCyl], ['idle', 0x81, true, 40], 'SEEK: the drive is busy, the controller is free');
  waitIrq(m);
  fdcCmd(m, [0x08]); eq(fdcResult(m), [0x20, 40], 'SEEK end: ST0 20h, PCN 40');
  eq([m.fdc.drives[0].cyl, m.fdc.drives[0].stepping], [40, false], 'the head is on track 40');
  seek(m, 80);
  fdcCmd(m, [0x07, 0x00]); waitIrq(m);
  fdcCmd(m, [0x08]);
  eq([fdcResult(m), m.fdc.drives[0].cyl], [[0x70, 0], 3], 'RECALIBRATE from track 80: 77 steps, equipment check');
  fdcCmd(m, [0x07, 0x00]); waitIrq(m);
  fdcCmd(m, [0x08]);
  eq([fdcResult(m), m.fdc.drives[0].cyl], [[0x20, 0], 0], 'the second RECALIBRATE reaches track 0');
  // real timing: 6 ms a step (SRT Dh, 250 kbit/s clock on the XT) + 15 ms head settle
  const r = mk('8086', 'real');
  r.insertDisk(0, 'a', patternDisk());
  resetFdc(r);
  const c0 = r.cpu.cycles; let clocks = 0;
  fdcCmd(r, [0x0F, 0x00, 10]);
  while (!r.fdc.irq && clocks < 5e6) { r.tickDevices(64); clocks += 64; }
  const ms = clocks / r.clockHz * 1000;
  check(Math.abs(ms - 75) < 3, `real timing: a seek of 10 tracks takes ${ms.toFixed(1)} ms (want about 75 ms)`);
  check(r.cpu.cycles === c0, 'no DMA cycles during a seek');
}

// ---------- 4. READ ID, READ DATA, WRITE DATA, multi-track, end of track ----------
for (const model of ['8086', '80286', '80386', '80486', '80586', '80686']) {
  begin(`${model}: READ ID, READ DATA, WRITE DATA, MT, end of track`);
  const m = mk(model);
  const img = patternDisk();
  m.insertDisk(0, 'a', img);
  resetFdc(m);
  adv(m, 1000);
  fdcCmd(m, [0x4A, 0x00]); waitIrq(m);
  const id = fdcResult(m);
  check(id.length === 7 && id[0] === 0 && id[3] === 0 && id[4] === 0 && id[5] >= 1 && id[5] <= 18 && id[6] === 2, `READ ID: ${id.map(hex)}`);
  // READ DATA C0 H0 R1, 2 sectors, into 1000:0000. The 80486 and the Pentium: the CPU reads the buffer first,
  // so the cache has old lines of it; the DMA writes must make them invalid.
  const c486 = m.cpu.cache486 || m.cpu.dcache ? m.cpu : null, cst = c486 ? (m.cpu.cache486 || m.cpu.dcache).stats : null;
  if (c486) { c486.cr[0] &= 0x9FFFFFFF; for (let a = 0x10000; a < 0x10400; a += 16) c486.physRd(a, 1, -1, 0); }
  dmaSetup(m, 0x46, 0x10000, 1024);
  const events = [];
  fdcCmd(m, [0xE6, 0x00, 0, 0, 1, 2, 18, 0x1B]);
  m.devTrace = events;                                 // the last command byte starts the execution phase
  fdcCmd(m, [0xFF]);
  eq([m.fdc.phase, inp(m, 0x3F4), m.fdc.cmd, m.fdc.drives[0].reading], ['execution', 0x10, 'READ DATA', true], 'execution phase: RQM = 0, CB = 1');
  const dma0 = m.stats.dev.dma, cyc0 = m.cpu.cycles;
  waitIrq(m);
  m.devTrace = null;
  check(irq6(m), 'IRQ 6 at the end of READ DATA');
  eq([m.fdc.phase, inp(m, 0x3F4)], ['result', 0xD0], 'result phase');
  eq(fdcResult(m), [0x00, 0, 0, 0, 0, 3, 2], 'result: normal end, next sector R=3');
  check(!irq6(m) && !m.fdc.irq, 'reading the result ends the interrupt');
  check(same(m.mem.subarray(0x10000, 0x10400), img.subarray(0, 1024)), 'the 2 sectors are in memory');
  if (c486) {
    const seen = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) seen[i] = c486.physRd(0x10000 + i, 1, -1, 0);
    const lines = c486.dcache ? 32 : 64;                // 32-byte lines on the Pentium, 16-byte lines on the 80486
    check(same(seen, img.subarray(0, 1024)) && cst.invalidations >= lines, `${model}: the CPU reads the new bytes through its cache (${cst.invalidations} lines invalid after the DMA)`);
  }
  eq([m.stats.dev.dma - dma0, m.cpu.cycles - cyc0], [1024, 4096], '1024 DMA transfers, 4 clocks each for the DMA');
  eq([inp(m, 0x08) & 4, m.dma.mask & 4, m.dma.count[2]], [4, 4, 0xFFFF], 'DMA: TC, the channel is masked');
  const ops = events.filter(e => e.k === 'fdc').map(e => e.op);
  eq([ops.filter(o => o === 'read').length, ops.includes('result'), ops.includes('irq')], [2, true, true], 'trace: 2 read events, result, irq');
  // WRITE DATA C0 H1 R5 from memory
  for (let i = 0; i < 512; i++) m.mem[0x20000 + i] = (255 - i) & 0xFF;
  dmaSetup(m, 0x4A, 0x20000, 512);
  eq(rw(m, 0xC5, 1, 0, 1, 5), [0x04, 0, 0, 0, 1, 6, 2], 'WRITE DATA result');
  check(same(img.subarray(22 * 512, 23 * 512), m.mem.subarray(0x20000, 0x20200)), 'the sector on the disk has the new bytes');
  check(m.disks[0].dirty && m.disks[0].writes === 1 && m.fdc.drives[0].dirty, 'the disk is dirty');
  // multi-track: C2 H0 R17 .. C2 H1 R2
  eq(seek(m, 2), [0x20, 2], 'seek to track 2');
  dmaSetup(m, 0x46, 0x30000, 4 * 512);
  eq(rw(m, 0xE6, 0, 2, 0, 17), [0x04, 0, 0, 2, 1, 3, 2], 'MT read over the two sides: ends on head 1, R=3');
  check(same(m.mem.subarray(0x30000, 0x30800), img.subarray(88 * 512, 92 * 512)), 'MT: the 4 sectors in order');
  dmaSetup(m, 0x46, 0x30000, 512);
  eq(rw(m, 0xE6, 1, 2, 1, 18), [0x04, 0, 0, 3, 0, 1, 2], 'MT: the last sector of head 1 -> C+1, H=0, R=1');
  // no MT: end of the track without TC
  dmaSetup(m, 0x46, 0x30000, 4 * 512);
  eq(rw(m, 0x46, 0, 2, 0, 17), [0x40, 0x80, 0, 3, 0, 1, 2], 'no MT: EN (end of cylinder) after R=EOT');
  eq(m.dma.count[2], 1023, 'no MT: 2 sectors moved');
  // errors: sector not found, wrong cylinder, DMA overrun
  dmaSetup(m, 0x46, 0x30000, 512);
  eq(rw(m, 0xE6, 0, 2, 0, 19).slice(0, 3), [0x40, 0x04, 0], 'R=19: ND');
  eq(rw(m, 0xE6, 0, 5, 0, 1).slice(0, 3), [0x40, 0x04, 0x10], 'C=5 on track 2: ND, WC');
  out(m, 0x0A, 0x06);
  eq(rw(m, 0xE6, 0, 2, 0, 1).slice(0, 3), [0x40, 0x10, 0], 'masked DMA: OR (overrun)');
  out(m, 0x3F2, 0x0C); adv(m, 2e6);
  eq(rw(m, 0xE6, 0, 2, 0, 1)[0], 0x48, 'motor off: NR (not ready)');
  // data rate: the AT checks it, the XT takes any
  out(m, 0x3F2, 0x1C); adv(m, 1000);
  out(m, 0x3F7, 2);                                    // 250 kbit/s
  dmaSetup(m, 0x46, 0x30000, 512);
  const r = rw(m, 0xE6, 0, 2, 0, 1);
  if (model !== '8086') {
    eq(r.slice(0, 3), [0x40, 0x01, 0], 'AT: 250 kbit/s on a 1.44 MB disk: MA (no address mark)');
    out(m, 0x3F7, 0); dmaSetup(m, 0x46, 0x30000, 512);
    eq(rw(m, 0xE6, 0, 2, 0, 1)[0], 0x00, 'AT: 500 kbit/s reads it');
  } else eq(r[0], 0x00, 'XT: no data rate register, the read works');
}

// ---------- 5. the AT change line, FORMAT TRACK ----------
begin('AT change line (3F7h bit 7), FORMAT TRACK');
{
  const m = mk('80286');
  m.insertDisk(0, 'a', patternDisk());
  resetFdc(m); adv(m, 100);
  eq(inp(m, 0x3F7) & 0x80, 0x80, 'a new disk sets the change line');
  seek(m, 0);
  eq(inp(m, 0x3F7) & 0x80, 0x80, 'a seek without a step pulse keeps it');
  seek(m, 1);
  eq(inp(m, 0x3F7) & 0x80, 0, 'a step pulse with a disk in clears it');
  m.insertDisk(0, 'b', patternDisk()); adv(m, 100);
  eq(inp(m, 0x3F7) & 0x80, 0x80, 'a disk change sets it again');
  // format track 1 side 0: 18 sectors, filler E5h
  const ids = []; for (let r = 1; r <= 18; r++) ids.push(1, 0, r, 2);
  m.mem.set(ids, 0x40000);
  dmaSetup(m, 0x4A, 0x40000, ids.length);
  fdcCmd(m, [0x4D, 0x00, 2, 18, 0x54, 0xE5]); waitIrq(m, 5e7);
  const res = fdcResult(m);
  eq(res.slice(0, 3), [0, 0, 0], 'FORMAT TRACK: normal end');
  const d = m.disks[0].data, t = (1 * 2) * 18 * 512;
  check(d.subarray(t, t + 18 * 512).every(x => x === 0xE5) && d[t - 1] !== 0xE5 && d[t + 18 * 512] !== 0xE5, 'the track has the filler byte, the next tracks do not');
}

// ---------- 6. real timing: a whole track ----------
for (const model of ['8086', '80286', '80386', '80486', '80586', '80686']) {
  begin(`${model}: real timing of READ DATA (a whole track)`);
  const m = mk(model, 'real');
  m.insertDisk(0, 'a', patternDisk());
  resetFdc(m);
  const t0 = m.cpu.cycles;
  let n = 0;
  while (!(m.fdc.drives[0].spin >= 1) && n < m.clockHz) { m.tickDevices(64); n += 64; }   // at most 1 s
  const spin = n / m.clockHz * 1000;
  check(spin > 450 && spin < 560, `motor spin-up ${spin.toFixed(0)} ms`);
  dmaSetup(m, 0x46, 0x10000, 18 * 512);
  // the time (CPU clocks, with the clocks that the DMA takes) when each sector starts
  const starts = [], dma0 = m.stats.dev.dma, cyc0 = m.cpu.cycles;
  let clocks = 0;
  fdcCmd(m, [0xE6, 0x00, 0, 0, 1, 2, 18, 0x1B, 0xFF]);
  while (!m.fdc.irq && clocks < 1e8) {
    m.tickDevices(16); clocks += 16;
    if (m.stats.dev.dma - dma0 > starts.length * 512) starts.push(clocks + m.cpu.cycles - cyc0);
  }
  const per = (starts[17] - starts[0]) / 17, want = 0.2 * m.clockHz / 18;
  const data = (clocks + m.cpu.cycles - cyc0 - starts[17]) / m.clockHz * 1000;
  console.log(`  ${model}: ${per.toFixed(0)} clocks from sector to sector (300 rpm, 18 sectors: ${want.toFixed(0)}), 512 bytes in ${data.toFixed(2)} ms, rotation wait ${(starts[0] / m.clockHz * 1000).toFixed(1)} ms`);
  check(starts.length === 18 && Math.abs(per - want) / want < 0.02, `clocks per 512-byte sector ${per.toFixed(0)}, want about ${want.toFixed(0)}`);
  check(Math.abs(data - 8.192) < 0.1, `512 bytes at 500 kbit/s take 8.19 ms (${data.toFixed(2)} ms)`);
  eq(fdcResult(m).slice(0, 6), [0x00, 0, 0, 0, 1, 1], 'the track read ends after R=EOT of head 0: next H=1, R=1');
  eq(m.cpu.cycles - cyc0, 18 * 512 * 4, 'the DMA took 4 clocks a byte from the CPU');
}

// ---------- 7. boot a small FAT12 disk through the BIOS ----------
// The boot sector reads a file (60 sectors) with INT 13h AH=02h one sector at a time,
// checks a 64 KB DMA boundary error (AH=09h), and prints the sum of the bytes.
// size: 1.44 MB or 2.88 MB (FAT12 disks with the file), or 720 KB (the bytes at sector 33).
function bootDisk(size = 1474560) {
  const file = new Uint8Array(60 * 512).map((_, i) => (i * 31 + (i >> 8)) & 0xFF);
  let img, first = 33, spt = 18;
  if (size === 737280) {
    img = new Uint8Array(size);
    img.set(fat12Blank('BOOT').subarray(0, 512));
    img.set(file, first * 512);
    spt = 9;
  } else {
    img = fat12Blank('BOOT', size);
    fat12AddFiles(img, [{ name: 'DATA.BIN', bytes: file }]);
    if (size === 2949120) { first = 34; spt = 36; }
  }
  let sum = 0; for (const b of file) sum = (sum + b) & 0xFFFF;
  const src = `
        org 0x7C3E
start:  cli
        xor ax, ax
        mov ds, ax
        mov ss, ax
        mov sp, 0x7C00
        sti
        mov ax, 0x1FF0        ; 1FF0:0000 + 1024 bytes crosses 20000h
        mov es, ax
        xor bx, bx
        mov ax, 0x0202
        mov cx, 0x0001
        xor dx, dx
        int 0x13
        jnc bad
        cmp ah, 0x09
        jne bad
        mov ax, 0x1000
        mov es, ax
        xor bx, bx
        mov si, ${first}            ; the first data sector (cluster 2)
        mov di, 60
next:   mov ax, si
        xor dx, dx
        mov cx, ${spt}
        div cx
        inc dl
        mov cl, dl            ; sector
        mov dh, al
        and dh, 1             ; head
        shr ax, 1
        mov ch, al            ; cylinder
        xor dl, dl
        mov ax, 0x0201
        int 0x13
        jc bad
        cmp al, 1
        jne bad
        add bx, 512
        inc si
        dec di
        jnz next
        xor si, si            ; the sum of the bytes
        xor dx, dx
        mov cx, 60 * 512
        push es
        pop ds
sum:    lodsb
        xor ah, ah
        add dx, ax
        loop sum
        cmp dx, ${sum}
        jne bad
        mov si, msg_ok
        jmp print
bad:    mov si, msg_bad
print:  push cs
        pop ds
.l:     lodsb
        or al, al
        jz .h
        mov ah, 0x0E
        mov bx, 7
        int 0x10
        jmp .l
.h:     cli
        hlt
msg_ok:  db "BOOT OK", 0
msg_bad: db "BOOT BAD", 0
`;
  const a = Asm86.assemble(src, { origin: 0x7C3E });
  if (!a.ok) throw new Error(JSON.stringify(a.errors));
  img.set(a.bytes, 0x3E);
  return img;
}
const screenText = m => { const v = m.vram(); let s = ''; for (let i = 0; i < 4000; i += 2) s += String.fromCharCode(v[i] || 32); return s; };
const bootResults = {};
for (const model of ['8086', '80286', '80386', '80486', '80586', '80686']) {
  const bios = Asm86.assemble(biosSource(model), { origin: 0 });
  check(bios.ok, `${model} BIOS assembles`);
  for (const timing of ['fast', 'real']) {
    begin(`${model}: BIOS boot of a FAT12 disk, ${timing} timing`);
    const m = newMachine(model);
    const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
    m.setRom(rom, bios.symbols);
    m.diskTiming = timing;
    m.reset();
    m.insertDisk(0, 'boot', bootDisk());
    const t = Date.now();
    let why = '';
    // (the same emulated time up to 66 MHz: 3 s; the Pentium Pro at 200 MHz gets 3 s too)
    const slice = Math.round(500000 * Math.max(1, m.clockHz / 66e6));
    for (let i = 0; i < 400 && !why; i++) { if (m.run(slice) === 'halt') why = 'halt'; }
    const txt = screenText(m), secs = m.cpu.cycles / m.clockHz;
    check(/BOOT OK/.test(txt), `the boot sector read the file (${/BOOT BAD/.test(txt) ? 'BOOT BAD' : 'no message'})`);
    eq([m.disks[0].reads, m.mem[0x441]], [61, 0], 'sectors read (boot sector + 60), BIOS status 0');
    bootResults[`${model} ${timing}`] = secs;
    console.log(`  ${model} ${timing}: BOOT OK after ${secs.toFixed(2)} emulated s (${Date.now() - t} ms real)`);
    // the motor stops about 2 s after the last access (INT 08h and MOTOR_CNT)
    m.cpu.halted = false; m.cpu.f |= 0x200;
    m.pokeMem(0x7C00, [0xEB, 0xFE]);                     // JMP $ with interrupts on (pokeMem: the 80486 cache too)
    m.cpu.sregs[1] = 0; m.cpu.ip = 0x7C00; m.cpu.flush();
    m.run(3 * m.clockHz);
    eq([m.fdc.drives[0].motor, m.mem[0x43F] & 1], [false, 0], 'the motor stops after the time-out');
  }
}
// other media: on the AT the BIOS finds the data rate (500, then 250 kbit/s, then 1 Mbit/s)
for (const model of ['8086', '80286', '80386', '80486', '80586', '80686']) {
  const bios = Asm86.assemble(biosSource(model), { origin: 0 });
  for (const [size, rate] of [[737280, 0x90], [2949120, 0xD0]]) {
    begin(`${model}: BIOS boot of a ${size / 1024} KB disk`);
    const m = newMachine(model);
    const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
    m.setRom(rom, bios.symbols);
    m.reset();
    m.insertDisk(0, 'boot', bootDisk(size));
    for (let i = 0; i < 100; i++) if (m.run(500000) === 'halt') break;
    check(/BOOT OK/.test(screenText(m)), 'the boot sector read the file');
    if (model !== '8086') eq(hex(m.mem[0x490]), hex(rate | 0x10), 'media state 0040:0090: the data rate, the media is known');
  }
}
check(bootResults['8086 fast'] < 1.5 && bootResults['80286 fast'] < 1.5 && bootResults['80386 fast'] < 1.5 && bootResults['80486 fast'] < 1.5 && bootResults['80586 fast'] < 1.5 && bootResults['80686 fast'] < 1.5, 'fast timing: the boot stays quick');
check(bootResults['8086 real'] > bootResults['8086 fast'] + 0.5, 'real timing: the boot takes longer (motor, steps, rotation)');

// ---------- 8. trace events ----------
begin('trace: fdc and dma events from m.step()');
{
  const bios = Asm86.assemble(biosSource('8086'), { origin: 0 });
  const m = new Machine();
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
  m.setRom(rom, bios.symbols);
  m.reset();
  m.insertDisk(0, 'boot', bootDisk());
  const kinds = {}, ops = {};
  let bad = 0, dmaSteps = 0, busFdc = 0;
  // the POST runs without the trace up to the first INT 13h (the diskette reset)
  const i13 = 0xF0000 + bios.symbols.int13;
  while (m.physIP !== i13 && m.cpu.cycles < 5e6) m.tickDevices(m.cpu.step());
  for (let i = 0; i < 3e6 && !/BOOT (OK|BAD)/.test(screenText(m)); i++) {
    const { cycles, events } = m.step();
    let nd = 0;
    for (const e of events) {
      if (e.k === 'bus' && e.dev === 'fdc') busFdc++;
      if (e.k !== 'fdc' && e.k !== 'dma') continue;
      kinds[e.k] = (kinds[e.k] || 0) + 1;
      if (!(e.t >= 0 && e.t < cycles)) bad++;
      if (e.k === 'fdc') {
        ops[e.op] = (ops[e.op] || 0) + 1;
        if (![e.drive, e.cyl, e.head, e.sec].every(Number.isInteger) || typeof e.text !== 'string') bad++;
      } else {
        nd++;
        if (e.ch !== 2 || !Number.isInteger(e.addr) || !(e.n >= 1) || typeof e.read !== 'boolean' || !Number.isInteger(e.count)) bad++;
      }
    }
    if (nd > 1) bad++;
    if (nd) dmaSteps++;
  }
  check(/BOOT OK/.test(screenText(m)), `the traced boot works (reads ${m.disks[0].reads}, ${(m.cpu.cycles / m.clockHz).toFixed(2)} s, ${screenText(m).trim().slice(-120)})`);
  eq(bad, 0, 'events with bad fields or times');
  check(['command', 'seek', 'step', 'read', 'result', 'irq', 'reset'].every(k => ops[k] > 0), `fdc ops: ${JSON.stringify(ops)}`);
  check(kinds.dma > 50 && busFdc > 100, `dma events ${kinds.dma}, CPU bus cycles to the fdc ${busFdc}`);
  check(m.ioDevAt(0x3F5) === 'fdc' && m.ioDevAt(0x3F2) === 'fdc' && m.ioDevAt(0x3F7) === 'none' && new Machine286().ioDevAt(0x3F7) === 'fdc', 'ioDevAt: 3F2h-3F5h (3F7h on the AT) are the fdc');
}

console.log(fail ? `${fail} floppy test(s) failed, ${pass} passed` : `all ${pass} floppy tests passed`);
process.exitCode = fail ? 1 : 0;
