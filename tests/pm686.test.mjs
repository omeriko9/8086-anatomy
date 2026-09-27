// Pentium Pro (P6) protected-mode tests: small NASM programs (tests/asm686/*.asm) run on CPU80686
// with a minimal bus in Node: global pages (CR4.PGE and the G bit: MOV CR3, INVLPG, a change of
// CR4.PGE or CR0.PG), the P6 instructions at CPL 3 (RDPMC with CR4.PCE, RDMSR, CMOVcc, FCOMIP, UD2),
// and loops timed with RDTSC whose clock totals show the out-of-order execution (independent work
// runs while the divider works; dependent work waits; the ROB limit). The rule is next to each check.
// Usage: node tests/pm686.test.mjs [--build] [--verbose]
//   --build  assembles tests/asm686/*.asm again with tools/nasm (writes .bin and .sym.json)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js',
  'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU80686 = vm.runInThisContext('CPU80686');
const FPU8087 = vm.runInThisContext('FPU8087');
const asmDir = path.join(root, 'tests/asm686');
const nasm = path.join(root, 'tools/nasm/nasm-2.16.03/nasm.exe');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');

// ---- build: .asm -> .bin + .sym.json (symbol values from the NASM map file) ----
function build(name) {
  const src = path.join(asmDir, name + '.asm'), bin = path.join(asmDir, name + '.bin'), sym = path.join(asmDir, name + '.sym.json');
  const incs = [path.join(asmDir, 'pm686.inc'), path.join(root, 'tests/asm586/pm586.inc'), path.join(root, 'tests/asm486/pm486.inc'), path.join(root, 'tests/asm386/pm386.inc')];
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

// Minimal bus: 16 MB RAM (all cacheable), one wait state, a bus ratio of 3 (the FSB at 1/3 of the core
// clock), an FPU on the chip, a shutdown counter.
function makeBus() {
  const mem = new Uint8Array(1 << 24);
  const bus = {
    mem, shutdowns: 0, waitStates: 1, busRatio: 3,
    read8: a => mem[a & 0xFFFFFF], write8: (a, v) => { mem[a & 0xFFFFFF] = v; }, peek8: a => mem[a & 0xFFFFFF],
    poke8: (a, v) => { mem[a & 0xFFFFFF] = v; },
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
  const cpu = new CPU80686(bus);
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
  const log = [];
  for (let i = 0; i < d('log_n'); i++) {
    log.push({ vec: d('log', 8 * i), err: d('log', 8 * i + 1), eip: d('log', 8 * i + 2), cs: d('log', 8 * i + 3) & 0xFFFF,
      fl: d('log', 8 * i + 4), esp: d('log', 8 * i + 5), ss: d('log', 8 * i + 6) & 0xFFFF, cr2: d('log', 8 * i + 7) });
  }
  return { cpu, bus, mem: m, sym, S, d, log, steps, events };
}
function logCheck(r, i, vec, err, rule) {
  const e = r.log[i];
  check(e && e.vec === vec && e.err === err, `log[${i}] ${rule}`,
    () => (e ? `got vector ${e.vec} error ${hx(e.err, 4)}` : 'no entry') + `, want vector ${vec} error ${hx(err, 4)}`);
}
const put = (m, a, v) => { for (let i = 0; i < 4; i++) m[a + i] = (v >>> (8 * i)) & 0xFF; };

// =====================================================================================
section = 'pm686_pge';
{
  const r = run('pm686_pge', { trace: true, setup: m => {
    put(m, 0x100000, 0x11111111); put(m, 0x101000, 0x22222222); put(m, 0x102000, 0x33333333); put(m, 0x103000, 0x44444444);
  } });
  const { cpu, d } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(r.log.length, 0, 'no fault');
  eq(d('r_g0'), 0x11111111, 'linear 400000h (G = 1) -> frame 100000h');
  eq(d('r_n0'), 0x22222222, 'linear 401000h (G = 0) -> frame 101000h');
  eq(d('r_g1'), 0x11111111, 'CR4.PGE = 1: after MOV CR3 the global TLB entry stays (the old frame, the new PTE is not read)');
  eq(d('r_n1'), 0x44444444, 'after MOV CR3 the entry that is not global goes (the new frame 103000h)');
  eq(d('r_g2'), 0x33333333, 'INVLPG removes a global entry: the new frame 102000h');
  eq(d('r_g3'), 0x11111111, 'a change of CR4.PGE removes all entries (also the global ones)');
  eq(d('r_g4'), 0x33333333, 'CR4.PGE = 0: the G bit has no effect, MOV CR3 removes the entry');
  eq(d('r_g5'), 0x11111111, 'a change of CR0.PG removes the global entries');
  eq(d('r_cr4') & 0x80, 0x80, 'CR4.PGE = 1 at the end');
  check(r.events.some(e => e.k === 'page' && e.global === true), "trace: a 'page' event of a global page has global: true");
  check(r.events.some(e => e.k === 'sys' && e.op === 'CR4' && /PGE/.test(e.text)), "trace: a 'sys' CR4 event names PGE");
}

// =====================================================================================
section = 'pm686_pmc';
{
  const r = run('pm686_pmc');
  const { cpu, d } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  logCheck(r, 0, 13, 0, '#GP(0): RDPMC at CPL 3 with CR4.PCE = 0');
  logCheck(r, 1, 13, 0, '#GP(0): RDPMC with ECX = 2');
  logCheck(r, 2, 13, 0, '#GP(0): RDMSR at CPL 3');
  logCheck(r, 3, 6, 0, '#UD: UD2 at CPL 3');
  eq(r.log.length, 4, 'four faults in all');
  eq(d('r_cr4') & 0x100, 0x100, 'CPL 0 sets CR4.PCE');
  check(d('r_pmc0') > 20 && d('r_pmc0') < 120 && d('r_pmc0h') === 0, 'RDPMC 0 at CPL 3 (INST_RETIRED): the instructions since the counters started (at CPL 0 and 3)', d('r_pmc0'));
  check(d('r_pmc1') > d('r_pmc0'), 'RDPMC 1 (UOPS_RETIRED): more µops than instructions', () => `${d('r_pmc1')} ${d('r_pmc0')}`);
  eq(d('r_cmov'), 2, 'CMOVE at CPL 3 (ZF = 1): EAX = EBX');
  eq(d('r_fcomi') & 0xFF, 1, 'FCOMIP at CPL 3: 0 < 1 sets CF');
  eq(d('r_after'), 0x12345678, 'the program continues after the faults');
}

// =====================================================================================
section = 'pm686_ooo';
{
  const r = run('pm686_ooo');
  const { cpu, d } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(r.log.length, 0, 'no fault');
  const P = 50, ind = d('r_indep'), dep = d('r_dep'), big = d('r_big');
  if (verbose) console.log(`  indep ${ind} (${(ind / P).toFixed(1)} a pass), dep ${dep} (${(dep / P).toFixed(1)}), big ${big} (${(big / P).toFixed(1)})`);
  // In one pass: the DIV chain (39 clocks), 20 ADDs, DEC, JNZ. An in-order core needs 39 + 20 + 2 = 61.
  check(ind >= P * 39 && ind <= P * 39 + 80, 'indep: about 39 clocks for each pass (the ADDs run while the divider works)', ind);
  check(dep >= P * 59 && dep <= P * 59 + 60, 'dep: about 59 clocks for each pass (the DIV, then the 20 dependent ADDs)', dep);
  check(dep - ind >= P * 19 && dep - ind <= P * 21, 'the difference is the chain of the 20 dependent ADDs (20 clocks for each pass)', dep - ind);
  // 60 ADDs: 66 µops in a pass. During the DIV the ROB (40 entries) fills: the RAT stops (robFull).
  check(big > P * 39 + P * 5 && big < P * 70, 'big: 60 independent ADDs do not fit in the ROB during the DIV: more than 39 clocks for each pass', big);
  check(cpu.oooStats.robFull >= P, 'oooStats.robFull counts the times that the RAT waited for a free ROB entry (one or more in each pass of big)', cpu.oooStats.robFull);
}

console.log(`pm686: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
