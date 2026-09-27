// The lockstep test of the WebAssembly core (src/core/x86core.c): two machines (--model 80386, 80486, 80586 or 80686) with the
// same disk, one with the JavaScript core only, one with the C core. They run the same slices of
// clocks (m.run(slice)); after each slice the registers, flags, clocks, queue and device
// counters must be the same, and from time to time the memory, the cache, the TLB, the heat maps
// and the bus counters too. The same clocks keep the devices in step, so the keys go in at the
// same place. When a slice differs, the test makes new machines, runs to the slice before, and
// then goes one instruction at a time (m.run(1)) to find the first instruction that differs.
// Usage: node tools/x86lockstep.mjs [--slices 20000] [--slice 20000] [--doom] [--every 100] [--quiet]
//   [--step] (one instruction at a time from the start)
// DOS 6.22 (and DOOM with --doom) come from the user's folders; nothing is copied into src/.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js',
  'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/p6ooo.wasm.js', 'src/core/cpu80686.js', 'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js',
  'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/x86core.wasm.js', 'src/core/x86wasm.js', 'src/core/machine.js', 'src/core/devices286.js',
  'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js', 'src/core/vgabios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const G = n => vm.runInThisContext(n);
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const has = k => process.argv.includes(k);
const SLICES = +arg('--slices', 20000), SLICE = +arg('--slice', 20000), EVERY = +arg('--every', 100), QUIET = has('--quiet');
const MODEL = arg('--model', '80486'), CLS = { 80386: 'Machine386', 80486: 'Machine486', 80586: 'Machine586', 80686: 'Machine686' }[MODEL];
const DOS = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files/msdos/dos6.img';
const DOOM = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS_X/c_drive_backup/DOOM';
if (!fs.existsSync(DOS)) { console.log('skip: no DOS 6.22 image'); process.exit(0); }

const hd0 = G('hdBlank')('DRIVE C');
G('hdMakeBootable')(hd0, new Uint8Array(fs.readFileSync(DOS)));
if (has('--doom') && fs.existsSync(DOOM)) {
  const files = fs.readdirSync(DOOM).filter(n => fs.statSync(path.join(DOOM, n)).isFile()).map(n => ({ path: 'DOOM/' + n, bytes: new Uint8Array(fs.readFileSync(path.join(DOOM, n))) }));
  G('fatAddTree')(G('hdFs')(hd0), files);
}
const bios = G('Asm86').assemble(G('biosSource')(MODEL), { origin: 0 });
const vrom = G('makeVgaRom')(null).bytes;
function machine(wasm) {
  const m = new (G(CLS))({ video: 'vga', wasm });
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
  m.setRom(rom, bios.symbols); m.setVgaRom(vrom);
  m.reset();
  m.insertHardDisk('c', new Uint8Array(hd0));
  return m;
}

const SC = { '\r': 0x1C, ' ': 0x39, '\\': 0x2B, '.': 0x34 };
'abcdefghijklmnopqrstuvwxyz'.split('').forEach(ch => { const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], base = [0x10, 0x1E, 0x2C]; rows.forEach((r, i) => { const k = r.indexOf(ch); if (k >= 0) SC[ch] = base[i] + k; }); });
const text = m => { const v = m.vram(); let s = ''; for (let i = 0; i < 2000; i++) s += String.fromCharCode(v[i * 2] || 32); return s; };
const h = (v, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

function state(m) {
  const c = m.cpu;
  return { r: Array.from(c.r), eip: c.ip, f: c.f, s: Array.from(c.sregs), cpl: c.cpl, cyc: c.cycles, ins: c.instructions, qh: c.qh, qt: c.qt, qip: c.qip,
    q: c.q ? c.q.join(',') : '', nStall: c.nStall | 0, halted: c.halted, rep: c.repState ? `${c.repState.op}:${c.repState.start}` : '', tick: m.tickDue, wr: m.wrChg, ioR: m.ioRdN, ioW: m.ioWrN,
    cr0: c.cr[0], cr2: c.cr[2], cr3: c.cr[3], idleIp: m.idleIp, idleN: m.idleN, a20: m.a20,
    pair: c.dcache ? `${c.pairNext}:${c.pairIP}:${c.isV}:${c.uClk}:${c.uRet}:${c.lastWhy}:${c.inhibit}` : '' };
}
function diff(J, C) {
  const a = state(J), b = state(C), out = [];
  for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${k}: JS ${JSON.stringify(a[k])} C ${JSON.stringify(b[k])}`);
  return out;
}
function deep(J, C) {
  const out = [];
  if (Buffer.compare(Buffer.from(J.mem.buffer, J.mem.byteOffset, J.mem.length), Buffer.from(C.mem.buffer, C.mem.byteOffset, C.mem.length))) {
    for (let i = 0; i < J.mem.length; i++) if (J.mem[i] !== C.mem[i]) { out.push(`memory ${h(i, 6)}: JS ${h(J.mem[i], 2)} C ${h(C.mem[i], 2)}`); if (out.length > 5) break; }
  }
  const arr = (name, a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { out.push(`${name}[${i}]: JS ${a[i]} C ${b[i]}`); return; } };
  const obj = (name, a, b) => { for (const k of Object.keys(a)) if (typeof a[k] === 'number' && a[k] !== b[k]) out.push(`${name}.${k}: JS ${a[k]} C ${b[k]}`); };
  const cj0 = J.cpu, cc0 = C.cpu;
  if (cj0.dcache) {
    arr('dtag', cj0.dcache.tag, cc0.dcache.tag); arr('dstate', cj0.dcache.state, cc0.dcache.state); arr('dlru', cj0.dcache.lru, cc0.dcache.lru);
    arr('itag', cj0.icache.tag, cc0.icache.tag); arr('ilru', cj0.icache.lru, cc0.icache.lru);
    arr('btb.tag', cj0.btb.tag, cc0.btb.tag); arr('btb.target', cj0.btb.target, cc0.btb.target); arr('btb.counter', cj0.btb.counter, cc0.btb.counter);
    obj('dcache.stats', cj0.dcache.stats, cc0.dcache.stats); obj('icache.stats', cj0.icache.stats, cc0.icache.stats);
    obj('btb.stats', cj0.btb.stats, cc0.btb.stats); obj('pipeStats', cj0.pipeStats, cc0.pipeStats); arr('pipeStats.why', cj0.pipeStats.why, cc0.pipeStats.why);
    for (const k of ['codeHits', 'codeMisses', 'bigHits']) if (cj0.tlbStats[k] !== cc0.tlbStats[k]) out.push(`tlbStats.${k}: JS ${cj0.tlbStats[k]} C ${cc0.tlbStats[k]}`);
    if (cj0.l2) {
      // the Pentium Pro: the L2, the out-of-order model and its BTB
      arr('l2.tag', cj0.l2.tag, cc0.l2.tag); arr('l2.state', cj0.l2.state, cc0.l2.state); arr('l2.lru', cj0.l2.lru, cc0.l2.lru);
      obj('l2.stats', cj0.l2.stats, cc0.l2.stats); obj('oooStats', cj0.oooStats, cc0.oooStats);
      arr('oS', cj0.oS, cc0.oS); arr('rob.retire', cj0.rob.retire, cc0.rob.retire); arr('rat.ready', cj0.rat.ready, cc0.rat.ready);
      arr('btb.hist', cj0.btb.hist, cc0.btb.hist); arr('btb.pht', cj0.btb.pht, cc0.btb.pht); arr('btb.rsb', cj0.btb.rsb, cc0.btb.rsb);
    }
    for (const [n, a, b] of [['itlb', cj0.itlb, cc0.itlb], ['tlb4m', cj0.tlb4m, cc0.tlb4m]]) for (let i = 0; i < a.length; i++) if (a[i].valid !== b[i].valid || (a[i].valid && (a[i].lin !== b[i].lin || a[i].phys !== b[i].phys || a[i].flags !== b[i].flags))) { out.push(`${n}[${i}]`); break; }
  } else if (J.cpu.cache486) {
    const tj = J.cpu.ctag, tc = C.cpu.ctag;
    for (let i = 0; i < 512; i++) if (tj[i] !== tc[i]) { out.push(`ctag[${i}]: JS ${tj[i]} C ${tc[i]}`); break; }
    for (let i = 0; i < 8192; i++) if (tj[i >> 4] >= 0 && J.cpu.cache486.data[i] !== C.cpu.cache486.data[i]) { out.push(`cache data ${i}`); break; }
    const cj = J.cpu.cache486.stats, cc = C.cpu.cache486.stats;
    for (const k of Object.keys(cj)) if (cj[k] !== cc[k]) out.push(`cache.${k}: JS ${cj[k]} C ${cc[k]}`);
  }
  const sj = J.stats, sc = C.stats;
  for (const k of ['fetch', 'memr', 'memw', 'ior', 'iow', 'halt', 'inta']) if (sj[k] !== sc[k]) out.push(`stats.${k}: JS ${sj[k]} C ${sc[k]}`);
  for (const k of Object.keys(sj.dev)) if (sj.dev[k] !== sc.dev[k]) out.push(`stats.dev.${k}: JS ${sj.dev[k]} C ${sc.dev[k]}`);
  for (const k of ['hits', 'misses', 'flushes']) if (J.cpu.tlbStats[k] !== C.cpu.tlbStats[k]) out.push(`tlbStats.${k}: JS ${J.cpu.tlbStats[k]} C ${C.cpu.tlbStats[k]}`);
  for (let i = 0; i < J.heat.read.length; i++) if (J.heat.read[i] !== C.heat.read[i] || J.heat.write[i] !== C.heat.write[i]) { out.push(`heat[${i}]`); break; }
  for (let i = 0; i < 6; i++) {
    const a = J.cpu.cache[i], b = C.cpu.cache[i];
    for (const k of ['sel', 'base', 'limit', 'access', 'flags', 'big', 'lo', 'hi', 'rd', 'wr']) if (a[k] !== b[k]) out.push(`cache[${i}].${k}: JS ${a[k]} C ${b[k]}`);
  }
  for (let i = 0; i < J.cpu.tlb.length; i++) { const a = J.cpu.tlb[i], b = C.cpu.tlb[i]; if (a.valid !== b.valid || (a.valid && (a.lin !== b.lin || a.phys !== b.phys || a.flags !== b.flags))) { out.push(`tlb[${i}]`); break; } }
  for (const k of ['idleSkips', 'idleSaved', 'haltWaits', 'haltSaved']) if (J[k] !== C[k]) out.push(`${k}: JS ${J[k]} C ${C[k]}`);
  return out;
}
function where(m, last) {
  const c = m.cpu, base = c.cache[1].base, ip = last ? c.lastIP : c.ip;
  let t = '';
  try { t = G('Disasm86').decode(i => m.peek8((base + ip + i) >>> 0), ip, { cpu: '486', bits: c.cache[1].big ? 32 : 16 }).text; } catch (e) { /* */ }
  return `${h(c.sregs[1], 4)}:${h(ip)} ${t}`;
}
// the keys: the date and time prompts, then DOOM. The screen of the JavaScript machine decides,
// at the end of a slice; both machines get the key at the same place.
function driver() {
  const keys = [];
  let stage = 0;
  const type = s => { for (const ch of s) keys.push(SC[ch.toLowerCase()]); };
  return (J, C) => {
    const s = text(J);
    if (stage === 0 && /Enter new date/.test(s)) { type('\r'); stage = 1; }
    else if (stage === 1 && /Enter new time/.test(s)) { type('\r'); stage = 2; }
    else if (stage === 2 && /C:\\>\s*$/.test(s.replace(/\s+$/, ''))) { if (has('--doom')) { type('cd doom\r'); stage = 3; } else stage = 9; }
    else if (stage === 3 && /C:\\DOOM>/.test(s)) { type('doom\r'); stage = 4; }
    if (keys.length && !J.kbd.fifo.length && !C.kbd.fifo.length) { const k = keys.shift(); J.keyDown(k); J.keyUp(k); C.keyDown(k); C.keyUp(k); }
  };
}

function report(J, C, head, d) {
  console.log(head);
  for (const l of d) console.log('  ' + l);
  for (const l of deep(J, C)) console.log('  ' + l);
}
const t0 = Date.now();
let J = machine(false), C = machine(true), keysAt = driver();
if (!C.wx) { console.log('FAIL: no WebAssembly core'); process.exit(1); }
let cS = 0, jS = 0;
const count = () => { cS += Math.max(0, C.wx.cSteps()); jS += Math.max(0, C.wx.jsSteps()); };

// one instruction at a time (from the state of the two machines now); returns false at a difference
function stepMode(n, label) {
  for (let i = 1; i <= n; i++) {
    const before = where(J, false);
    J.run(1); C.run(1); count();
    const d = diff(J, C);
    if (d.length) { report(J, C, `FAIL ${label} + ${i} instructions: the instruction at ${before}; now at ${where(J, false)}`, d); return false; }
  }
  return true;
}
if (has('--step')) {
  const ok = stepMode(SLICES, 'from the start');
  console.log(ok ? `all ${SLICES} instructions the same (${cS} in C, ${jS} in JavaScript)` : '');
  process.exit(ok ? 0 : 1);
}
for (let k = 1; k <= SLICES; k++) {
  J.run(SLICE); C.run(SLICE); count();
  keysAt(J, C);
  let d = diff(J, C);
  if (!d.length && k % EVERY === 0) d = deep(J, C);
  if (d.length) {
    report(J, C, `slice ${k} differs (${(J.cpu.cycles / J.clockHz).toFixed(3)} emulated s): the search for the instruction`, d);
    // again to the slice before, then one instruction at a time
    J = machine(false); C = machine(true); keysAt = driver();
    for (let i = 1; i < k; i++) { J.run(SLICE); C.run(SLICE); keysAt(J, C); }
    const dd = diff(J, C).concat(deep(J, C));
    if (dd.length) { report(J, C, `the machines differ already before slice ${k} (a deep difference found late)`, dd); process.exit(1); }
    stepMode(SLICE * 4, `slice ${k}`);
    process.exit(1);
  }
  if (k % EVERY === 0 && !QUIET) console.log(`slice ${k}: the same (${((Date.now() - t0) / 1000).toFixed(0)} s real, ${(J.cpu.cycles / J.clockHz).toFixed(2)} emulated s, ${cS} steps in C, ${jS} in JavaScript), ${where(J, false)}`);
}
console.log(`all ${SLICES} slices the same (${(J.cpu.cycles / J.clockHz).toFixed(2)} emulated s, ${cS} steps in C, ${jS} in JavaScript, ${((Date.now() - t0) / 1000).toFixed(0)} s real)`);
