// 80486 protected-mode tests: small NASM programs (tests/asm486/*.asm) run on CPU80486 with a
// minimal bus in Node: the alignment check (#AC), CR0.WP, INVLPG, PCD / PWT and the cache,
// the privileged 486 instructions at CPL 3, CMPXCHG and paging, the FPU on the chip (#MF with
// CR0.NE). Each expected value comes from the Intel i486 rules; the rule is next to each check.
// Usage: node tests/pm486.test.mjs [--build] [--verbose]
//   --build  assembles tests/asm486/*.asm again with tools/nasm (writes .bin and .sym.json)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU80486 = vm.runInThisContext('CPU80486');
const FPU8087 = vm.runInThisContext('FPU8087');
const asmDir = path.join(root, 'tests/asm486');
const nasm = path.join(root, 'tools/nasm/nasm-2.16.03/nasm.exe');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');

// ---- build: .asm -> .bin + .sym.json (symbol values from the NASM map file) ----
function build(name) {
  const src = path.join(asmDir, name + '.asm'), bin = path.join(asmDir, name + '.bin'), sym = path.join(asmDir, name + '.sym.json');
  const incs = [path.join(asmDir, 'pm486.inc'), path.join(root, 'tests/asm386/pm386.inc')];
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

// Minimal bus: 16 MB RAM (all cacheable), an FPU on the chip, a shutdown counter.
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
  const cpu = new CPU80486(bus);
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
function logCheck(r, i, vec, err, rule) {
  const e = r.log[i];
  check(e && e.vec === vec && e.err === err, `log[${i}] ${rule}`, () => (e ? `got vector ${e.vec} error ${hx(e.err, 4)}` : 'no entry') + `, want vector ${vec} error ${hx(err, 4)}`);
}
// The line of physical address pa in the cache (or null).
const lineOf = (cpu, pa) => { const i = cpu.cacheFind(pa); return i < 0 ? null : cpu.cache486.lines[i]; };

// =====================================================================================
section = 'pm486_ac';
{
  const r = run('pm486_ac', { trace: true });
  const { cpu, d, S } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(d('r_cr0') & 0x40000, 0x40000, 'CR0.AM = 1');
  eq(d('r_cpl0'), 0x55443322, 'CPL 0 with AM = 1 and AC = 1: a dword at 4n+1 reads with no fault');
  eq(d('r_user_fl') & 0x40000, 0x40000, 'CPL 3: EFLAGS.AC = 1 (from the IRETD image)');
  eq(d('r_aligned'), 0x44332211, 'CPL 3: an aligned dword: no fault');
  logCheck(r, 0, 17, 0, '#AC(0): a dword at 4n+1 at CPL 3 with AM = 1 and AC = 1');
  check(r.log[0] && r.log[0].cs === 0x2B && r.log[0].eip > S('user') && r.log[0].eip < S('int40'), 'log[0] the #AC frame: the CPL 3 CS and the EIP of the instruction (a fault)');
  logCheck(r, 1, 17, 0, '#AC(0): a word write at an odd address');
  logCheck(r, 2, 17, 0, '#AC(0): a dword write at 4n+2');
  eq(d('r_word2') & 0xFFFF, 0x4433, 'a word at an even address: no fault');
  eq(d('r_byte3') & 0xFF, 0x44, 'a byte access: never #AC');
  logCheck(r, 3, 17, 0, '#AC(0): PUSH of a dword with ESP = 4n+2');
  check(Math.abs(Buffer.from(r.mem.subarray(BASE + S('r_fpu_ok'), BASE + S('r_fpu_ok') + 4)).readFloatLE(0) - Buffer.from([0x11, 0x22, 0x33, 0x44]).readFloatLE(0)) < 1e-3, 'an aligned FPU operand: no fault');
  logCheck(r, 4, 17, 0, '#AC(0): an FPU dword operand at 4n+2');
  logCheck(r, 5, 17, 0, '#AC(0): an FPU qword operand at 8n+4 (a qword needs 8-byte alignment)');
  eq(d('r_ac0'), 0x55443322, 'EFLAGS.AC = 0: no alignment check');
  eq(d('r_am0'), 0x55443322, 'CR0.AM = 0: no alignment check');
  eq(r.log.length, 6, 'six #AC faults in all');
  const ints = r.events.filter(e => e.k === 'int' && e.vec === 17);
  check(ints.length === 6 && ints.every(e => e.name === '#AC' && e.err === 0), "trace: 'int' events with vector 17, name '#AC', error code 0", () => JSON.stringify(ints[0]));
}

// =====================================================================================
section = 'pm486_paging';
{
  const put = (m, a, v) => { for (let i = 0; i < 4; i++) m[a + i] = (v >>> (8 * i)) & 0xFF; };
  const r = run('pm486_paging', { trace: true, setup: m => { put(m, 0x93000, 0x93939393); put(m, 0x94010, 0x94949494); put(m, 0x95000, 0x95959595); put(m, 0x96000, 0x96969696); } });
  const { cpu, d, pd, S } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(pd(0x90000), 0x11111111, 'WP = 0: a supervisor write to a user read-only page works (as on the 80386)');
  eq(pd(0x91000), 0x22222222, 'WP = 0: a supervisor write to a supervisor read-only page works');
  eq(d('r_cr0') & 0x10000, 0x10000, 'CR0.WP = 1');
  eq(d('r_wp_read'), 0, 'WP = 1: a supervisor read of a read-only page works');
  logCheck(r, 0, 14, 3, '#PF(3): WP = 1, a supervisor write to a user read-only page (P, W/R; U/S = 0)');
  eq(r.log[0] && r.log[0].cr2, 0x200008, 'CR2 = 200008h');
  logCheck(r, 1, 14, 3, '#PF(3): WP = 1, a supervisor write to a supervisor read-only page');
  eq(r.log[1] && r.log[1].cr2, 0x201008, 'CR2 = 201008h');
  eq(pd(0x92000), 0x33333333, 'WP = 1: a write to a R/W page works');
  eq(pd(0x90008), 0x44444444, 'WP = 0 again: the write works');
  eq(d('r_inv_old'), 0x33333333, 'INVLPG: before it, the TLB keeps the old translation of 202000h');
  eq(d('r_inv_new'), 0x95959595, 'INVLPG [202000h]: the next access walks the tables (the new frame 95000h)');
  eq(d('r_inv_other'), 0x22222222, 'INVLPG removes one entry: 201000h keeps its old translation');
  eq(d('r_inv_all'), 0x96969696, 'MOV CR3 flushes the TLB: 201000h gets the new frame');
  eq(d('r_pcd'), 0x93939393, 'PCD = 1: the read gives the data');
  eq(d('r_pwt'), 0x94949494, 'PWT = 1: the read gives the data');
  check(lineOf(cpu, 0x93000) === null, 'PCD = 1: no cache line for the page (93000h)');
  check(lineOf(cpu, 0x94010) !== null, 'PWT = 1: the line is in the cache (the 486 cache is write-through anyway)');
  eq(pd(0x94010), 0x5A5A5A5A, 'PWT page: the write goes to memory');
  const t203 = cpu.tlbFind(0x203000);
  check(t203 && (t203.flags & 0x10) && !(t203.flags & 8), 'cpu.tlb: the entry of 203000h has PCD (flags bit 4)', () => JSON.stringify(t203));
  const t204 = cpu.tlbFind(0x204000);
  check(t204 && (t204.flags & 8) && !(t204.flags & 0x10), 'cpu.tlb: the entry of 204000h has PWT (flags bit 3)', () => JSON.stringify(t204));
  check(lineOf(cpu, 0x81000 + 0x200 * 4) !== null, 'the page table entries are in the cache (PCD = 0 in the PDE)');
  logCheck(r, 2, 13, 0, '#GP(0): INVLPG at CPL 3');
  logCheck(r, 3, 13, 0, '#GP(0): INVD at CPL 3');
  logCheck(r, 4, 13, 0, '#GP(0): WBINVD at CPL 3');
  eq(d('r_cpuid'), 0x756E6547, 'CPUID at CPL 3: EBX = "Genu"');
  logCheck(r, 5, 14, 7, '#PF(7): LOCK CMPXCHG with values not equal writes its destination (a user read-only page)');
  eq(d('r_cmpx_eax'), 1, 'the #PF comes before CMPXCHG changes EAX');
  logCheck(r, 6, 14, 7, '#PF(7): CMPXCHG with equal values');
  eq(r.log.length, 7, 'seven faults in all');
  const inv = r.events.find(e => e.k === 'sys' && e.op === 'INVLPG');
  check(inv && /00202000/.test(inv.text) && /removed/.test(inv.text), "trace: a 'sys' INVLPG event", () => JSON.stringify(inv));
  const st = cpu.cache486.stats;
  check(st.hits > st.misses && st.fills > 0 && st.writeHits > 0, 'cache486.stats: more hits than misses', () => JSON.stringify(st));
}

// =====================================================================================
section = 'pm486_fpu';
{
  const r = run('pm486_fpu');
  const { cpu, d, pd } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(d('r_cr0') & 0xFFFFFFFF, 0x00000011, 'CR0 in protected mode with the cache on: ET = 1, PE = 1');
  eq(d('r_div'), 1, 'the FDIVP with the error completes');
  logCheck(r, 0, 16, 0, '#MF: CR0.NE = 1, the next FPU instruction');
  eq(d('r_sw') & 0x84, 0x84, 'FNSTSW after #MF: ZE and ES');
  eq(d('r_one'), 0x3F800000, 'after FNCLEX the FPU works (FSTP dword 1.0)');
  eq(d('r_ne0'), 1, 'CR0.NE = 0: no #MF');
  eq(d('r_sw0') & 0x80, 0x80, 'CR0.NE = 0: the error stays pending (ES = 1; the machine sends it to IRQ 13)');
  eq(r.log.length, 1, 'one #MF in all');
  const b = Buffer.alloc(8); b.writeUInt32LE(pd(0x90FFC), 0); b.writeUInt32LE(pd(0x91000), 4);
  check(b.readDoubleLE(0) === 3.375, 'FSTP qword across two pages: bytes at physical 90FFCh and 91000h', b.readDoubleLE(0));
  const back = Buffer.from(r.mem.subarray(BASE + r.S('r_back'), BASE + r.S('r_back') + 8)).readDoubleLE(0);
  check(back === 3.375, 'FLD qword across two pages reads it back (through the cache)', back);
}

console.log(`pm486: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
