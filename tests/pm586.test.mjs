// Pentium (P5) protected-mode tests: small NASM programs (tests/asm586/*.asm) run on CPU80586
// with a minimal bus in Node: 4 MB pages (CR4.PSE) with the TLBs, the page bits and the data
// cache, the P5 instructions at CPL 3 (CR4.TSD, RDMSR, WRMSR, MOV CR4), and a loop with pairs
// whose clock total (RDTSC) follows the clock rule of the pairs. Each expected value comes from
// the Intel Pentium rules; the rule is next to each check.
// Usage: node tests/pm586.test.mjs [--build] [--verbose]
//   --build  assembles tests/asm586/*.asm again with tools/nasm (writes .bin and .sym.json)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js',
  'src/core/cpu80486.js', 'src/core/cpu80586.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU80586 = vm.runInThisContext('CPU80586');
const FPU8087 = vm.runInThisContext('FPU8087');
const asmDir = path.join(root, 'tests/asm586');
const nasm = path.join(root, 'tools/nasm/nasm-2.16.03/nasm.exe');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');

// ---- build: .asm -> .bin + .sym.json (symbol values from the NASM map file) ----
function build(name) {
  const src = path.join(asmDir, name + '.asm'), bin = path.join(asmDir, name + '.bin'), sym = path.join(asmDir, name + '.sym.json');
  const incs = [path.join(asmDir, 'pm586.inc'), path.join(root, 'tests/asm486/pm486.inc'), path.join(root, 'tests/asm386/pm386.inc')];
  const stale = !fs.existsSync(bin) || !fs.existsSync(sym) || [src, ...incs].some(f => fs.statSync(f).mtimeMs > fs.statSync(bin).mtimeMs);
  if (!args.includes('--build') && !stale) return;
  if (!fs.existsSync(nasm)) { if (!fs.existsSync(bin)) throw new Error(`${name}.bin is missing and NASM is not in tools/nasm`); return; }
  const wrap = path.join(asmDir, `_${name}.asm`), map = path.join(asmDir, `_${name}.map`);
  fs.writeFileSync(wrap, `[map symbols _${name}.map]\n%include "${name}.asm"\n`);
  try {
    execFileSync(nasm, ['-f', 'bin', '-o', bin, `_${name}.asm`], { cwd: asmDir, stdio: 'pipe' });
  } catch (e) { throw new Error(`nasm ${name}.asm:\n${e.stderr}`); } finally { fs.rmSync(wrap, { force: true, maxRetries: 20, retryDelay: 100 }); }
  const syms = {};
  for (const line of fs.readFileSync(map, 'utf8').split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9A-F]+)\s+(?:([0-9A-F]+)\s+)?([A-Za-z_.$?@][\w.$?@]*)$/);
    if (m) syms[m[3]] = parseInt(m[1], 16);
  }
  fs.rmSync(map, { force: true, maxRetries: 20, retryDelay: 100 });
  fs.writeFileSync(sym, JSON.stringify(syms, null, 1));
}

// ---- harness ----
const BASE = 0x10000;
let pass = 0, fail = 0, section = '';
function check(cond, rule, detail) {
  if (cond) { pass++; if (verbose) console.log(`  ok   ${rule}`); return; }
  fail++;
  console.log(`  FAIL [${section}] ${rule}${detail !== undefined ? ` -- ${typeof detail === 'function' ? detail() : detail}` : ''}`);
}
const hx = (v, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
function eq(got, want, rule) { check((got >>> 0) === (want >>> 0), rule, () => `got ${hx(got)}, want ${hx(want)}`); }

// Minimal bus: 16 MB RAM (all cacheable), one wait state, an FPU on the chip, a shutdown counter.
function makeBus() {
  const mem = new Uint8Array(1 << 24);
  const bus = {
    mem, shutdowns: 0, waitStates: 1,
    read8: a => mem[a & 0xFFFFFF], write8: (a, v) => { mem[a & 0xFFFFFF] = v; },
    in8: () => 0xFF, out8: () => {}, cacheable: () => true,
    shutdown: () => { bus.shutdowns++; },
  };
  bus.fpu = new FPU8087({ read8: bus.read8, write8: bus.write8 }, { model: '80387' });
  return bus;
}
function run(name, { maxSteps = 300000, trace, setup } = {}) {
  build(name);
  const bin = fs.readFileSync(path.join(asmDir, name + '.bin'));
  const sym = JSON.parse(fs.readFileSync(path.join(asmDir, name + '.sym.json'), 'utf8'));
  const bus = makeBus();
  bus.mem.set(bin, BASE);
  if (setup) setup(bus.mem);
  const cpu = new CPU80586(bus);
  cpu.reset();
  for (let i = 0; i < 6; i++) cpu.loadSeg(i, 0x1000);
  cpu.regs[4] = 0xFFF0;
  cpu.ip = 0; cpu.flush();
  let steps = 0;
  const events = [];
  while (!cpu.halted && steps++ < maxSteps) {
    if (trace) cpu.trace = [];
    cpu.step();
    if (trace) { for (const e of cpu.trace) events.push(e); cpu.trace = null; }
  }
  const S = n => { if (!(n in sym)) throw new Error(`${name}: no symbol ${n}`); return sym[n]; };
  const m = bus.mem;
  const d = (n, i = 0) => { const a = BASE + S(n) + 4 * i; return (m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24)) >>> 0; };
  const pd = a => (m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24)) >>> 0;
  const log = [];
  for (let i = 0; i < d('log_n'); i++) {
    log.push({ vec: d('log', 8 * i), err: d('log', 8 * i + 1), eip: d('log', 8 * i + 2), cs: d('log', 8 * i + 3) & 0xFFFF,
      fl: d('log', 8 * i + 4), esp: d('log', 8 * i + 5), ss: d('log', 8 * i + 6) & 0xFFFF, cr2: d('log', 8 * i + 7) });
  }
  return { cpu, bus, mem: m, sym, S, d, pd, log, steps, events };
}
function logCheck(r, i, vec, err, rule, cr2) {
  const e = r.log[i];
  check(e && e.vec === vec && e.err === err && (cr2 === undefined || e.cr2 === cr2), `log[${i}] ${rule}`,
    () => (e ? `got vector ${e.vec} error ${hx(e.err, 4)} CR2 ${hx(e.cr2)}` : 'no entry') + `, want vector ${vec} error ${hx(err, 4)}${cr2 === undefined ? '' : ' CR2 ' + hx(cr2)}`);
}
const put = (m, a, v) => { for (let i = 0; i < 4; i++) m[a + i] = (v >>> (8 * i)) & 0xFF; };
const lineOf = (cpu, pa) => cpu.dFind(pa);

// =====================================================================================
section = 'pm586_pse';
{
  const r = run('pm586_pse', { trace: true, setup: m => {
    put(m, 0x400010, 0x5A5A5A5A); put(m, 0x800010, 0x88888888); put(m, 0xC00000, 0xC3C3C3C3); put(m, 0xC00040, 0x40404040); put(m, 0xC00080, 0x80808080);
  } });
  const { cpu, d, pd } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  logCheck(r, 0, 14, 0, '#PF(0): CR4.PSE = 0, the PS bit has no effect (the page table entry at 400000h is 0)', 0x400010);
  eq(d('r_cr4') & 0x10, 0x10, 'CR4.PSE = 1');
  eq(d('r_big'), 0x5A5A5A5A, 'PSE = 1: PDE 1 (PS = 1) maps 400000h-7FFFFFh to the 4 MB frame 400000h');
  eq(pd(0x400020), 0x12345678, 'a write through the 4 MB page');
  eq(pd(0x80000 + 4), 0x004000E3, 'the PDE of the 4 MB page gets A and D (400000h | PS | D | A | R/W | P)');
  eq(d('r_alias'), 0x5A5A5A5A, 'PDE 2 maps linear 800000h to the same frame');
  logCheck(r, 1, 14, 9, '#PF(9): bit 12 of a 4 MB PDE is reserved (P | RSVD)', 0xC00000);
  logCheck(r, 2, 14, 3, '#PF(3): CR0.WP = 1, a supervisor write to a read-only 4 MB page', 0x800030);
  eq(d('r_pcd'), 0xC3C3C3C3, 'PCD = 1: the read gives the data');
  check(lineOf(cpu, 0xC00000) < 0, 'PCD = 1: no cache line for the 4 MB page');
  const lx = lineOf(cpu, 0xC00040), ly = lineOf(cpu, 0xC00080);
  check(lx >= 0 && cpu.dcache.state[lx] === 1, 'PWT = 1: the line fills as S and a write hit keeps it S (write-through)', () => lx < 0 ? 'no line' : 'state ' + cpu.dcache.state[lx]);
  eq(pd(0xC00040), 0x44444444, 'PWT = 1: the write goes to memory');
  check(ly >= 0 && cpu.dcache.state[ly] === 2, 'a write hit on S through a page with PWT = 0: the line becomes E', () => ly < 0 ? 'no line' : 'state ' + cpu.dcache.state[ly]);
  eq(d('r_inv_old'), 0x5A5A5A5A, 'INVLPG: before it, the 4 MB TLB entry keeps the old frame');
  eq(d('r_inv_new'), 0x88888888, 'INVLPG (an address in the 4 MB page) removes the 4 MB entry: the new frame 800000h');
  eq(d('r_hi'), 0x5A5A5A5A, 'code in a 4 MB page (PDE 6) runs');
  check(cpu.itlb.some(e => e.valid && (e.flags & 0x80) && e.lin >= 0x1800000 && e.lin < 0x1C00000), 'the code TLB keeps a 4 KB entry of the 4 MB code page (flags bit 7)',
    () => JSON.stringify(cpu.itlb.filter(e => e.valid)));
  eq(d('r_user'), 0x5A5A5A5A, 'CPL 3: a read of a user, read-only 4 MB page works');
  logCheck(r, 3, 14, 7, '#PF(7): CPL 3, a write to a read-only 4 MB page (P | W | U)', 0x800010);
  logCheck(r, 4, 14, 5, '#PF(5): CPL 3, a read of a supervisor 4 MB page (P | U)', 0x400010);
  eq(r.log.length, 5, 'five faults in all');
  check(cpu.tlb4m.some(e => e.valid && (e.flags & 0x80)) && cpu.tlbStats.bigHits > 0, 'cpu.tlb4m holds 4 MB entries (flags bit 7); tlbStats.bigHits counts their hits',
    () => JSON.stringify({ t: cpu.tlb4m.filter(e => e.valid), s: cpu.tlbStats }));
  const big = r.events.filter(e => e.k === 'page' && e.big);
  check(big.length > 0 && big.every(e => e.tbl === -1 && e.pte === 0), "trace: 'page' events of 4 MB walks have big: true, tbl = -1", () => JSON.stringify(big[0]));
  check(r.events.some(e => e.k === 'page' && e.big && e.fault && e.err === 9), "trace: the RSVD fault in a 'page' event (err 9)");
  check(r.events.some(e => e.k === 'page' && e.code), "trace: a code walk has code: true");
  check(r.events.some(e => e.k === 'tlb' && e.big), "trace: a 'tlb' hit in a 4 MB entry has big: true");
}

// =====================================================================================
section = 'pm586_tsd';
{
  const r = run('pm586_tsd');
  const { cpu, d } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  check(d('r_tsc3') > 0 && d('r_tsc3h') === 0, 'CR4.TSD = 0: RDTSC works at CPL 3', () => `${hx(d('r_tsc3h'))}:${hx(d('r_tsc3'))}`);
  eq(d('r_cpuid'), 0x756E6547, 'CPUID at CPL 3: EBX = "Genu"');
  eq(d('r_cr4') & 4, 4, 'CPL 0 sets CR4.TSD');
  check(d('r_tsc0') > d('r_tsc3'), 'CR4.TSD = 1 at CPL 0: RDTSC works (and counts up)');
  check(d('r_msr0') >= d('r_tsc0'), 'RDMSR 10h at CPL 0 reads the TSC');
  logCheck(r, 0, 13, 0, '#GP(0): RDTSC at CPL 3 with CR4.TSD = 1');
  logCheck(r, 1, 13, 0, '#GP(0): RDMSR at CPL 3');
  logCheck(r, 2, 13, 0, '#GP(0): WRMSR at CPL 3');
  logCheck(r, 3, 13, 0, '#GP(0): MOV EAX, CR4 at CPL 3');
  eq(d('r_after'), 0x12345678, 'the program continues after the faults');
  eq(r.log.length, 4, 'four faults in all');
}

// =====================================================================================
section = 'pm586_pair';
{
  const r = run('pm586_pair');
  const { cpu, d } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  // Between the two RDTSC: RDTSC (20); MOV EBP and CALL (5: this CALL is not in the BTB, so it is a
  // wrong prediction: as V 1 + 4 in a pair with MOV, with one pipe 1 + 1 + 3); the 50 passes; the
  // wrong prediction of the last JNZ (3 more clocks: 1 + 4 in V in place of 2, or 1 + 3 in U in
  // place of 1); RET (2).
  eq(d('r_pair'), 20 + 5 + 50 * 9 + 3 + 2, 'the pairs: 9 clocks for each pass of the loop (480 in all)');
  eq(d('r_single'), 20 + 5 + 50 * 11 + 3 + 2, 'TR12.SE = 1 (one pipe): 11 clocks for each pass (580 in all)');
  const P = cpu.pipeStats;
  check(P.v >= 50 * 4, 'pipeStats.v counts the V instructions (4 in each pass of the first run)', P.v);
  eq(P.why[13] >= 50 * 8 ? 1 : 0, 1, 'pipeStats.why counts "pairing is off (TR12.SE = 1)"');
  eq(cpu.dcache.stats.writeBacks, 0, 'no write-back (the data lines stay in the cache)');
}

console.log(`pm586: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
