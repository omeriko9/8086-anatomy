// Pentium (P5) unit tests: CPUID, RDTSC, RDMSR / WRMSR (the TSC, TR12, the performance
// counters), CMPXCHG8B, CR4 (TSD, DE with the I/O breakpoints, PSE, MCE), the two caches (fills,
// hits, the MESI states, the write-back at a replacement, INVD / WBINVD, CD / NW, KEN#,
// cacheInvalidate, the 64-bit bus, self-modifying code), the pairing rules of the U and V pipes
// (a table of pairs with the reasons and the clocks), the BTB, the FDIV bug and the P5 clocks.
// The protected-mode parts (4 MB pages, PCD / PWT, TSD at CPL 3) are in tests/pm586.test.mjs.
// Usage: node tests/cpu586.test.mjs [--verbose]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js',
  'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU80586 = vm.runInThisContext('CPU80586');
const CPU80486 = vm.runInThisContext('CPU80486');
const FPU8087 = vm.runInThisContext('FPU8087');
const Asm86 = vm.runInThisContext('Asm86');
const verbose = process.argv.includes('--verbose');

let pass = 0, fail = 0, section = '';
function check(cond, rule, detail) {
  if (cond) { pass++; if (verbose) console.log(`  ok   ${rule}`); return; }
  fail++;
  console.log(`  FAIL [${section}] ${rule}${detail !== undefined ? ` -- ${typeof detail === 'function' ? detail() : detail}` : ''}`);
}
const hx = (v, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
function eq(got, want, rule) { check((got >>> 0) === (want >>> 0), rule, () => `got ${hx(got)}, want ${hx(want)}`); }

// ---- harness ----
// A bus with 16 MB of RAM. All memory is cacheable (KEN#) except A0000h-BFFFFh, so the code runs
// from the code cache (the pairing rules need the next instruction in the queue).
const CODE = 0x10000, DATA = 0x20000;
function makeBus({ fpu = true, cacheable, ws = 0, poke = false } = {}) {
  const mem = new Uint8Array(1 << 24);
  const bus = {
    mem, waitStates: ws, io: [], pokes: 0,
    read8: a => mem[a & 0xFFFFFF], write8: (a, v) => { mem[a & 0xFFFFFF] = v; },
    in8: () => 0xFF, out8: (p, v) => { bus.io.push([p, v]); }, in16: () => 0xFFFF, out16: () => {},
    cacheable: cacheable || (pa => !(pa >= 0xA0000 && pa < 0xC0000)),
    fpu: null,
  };
  if (poke) bus.poke8 = (a, v) => { bus.pokes++; mem[a & 0xFFFFFF] = v; };
  if (fpu) bus.fpu = new FPU8087({ read8: bus.read8, write8: bus.write8 }, { model: '80387' });
  return bus;
}
// Each program starts at 1000:0000 in real mode (DS = ES = FS = GS = SS = 2000h, SP = FFF0h).
// The IVT sends the exceptions 0-17 to stubs that store the vector in excvec and halt.
const HEAD = ['cpu 586', 'bits 16', 'org 0', 'jmp start'];
for (let v = 0; v < 18; v++) HEAD.push(`exc${v}: mov byte [cs:excvec], ${v}`, 'hlt');
HEAD.push('excvec: db 0xFF', 'start:');
const CACHE_ON = ['mov eax, cr0', 'and eax, 0x9FFFFFFF', 'mov cr0, eax'];
function run(lines, { cpuClass = CPU80586, bus: busOpts, setup, pre, maxSteps = 100000, trace = false } = {}) {
  const a = Asm86.assemble([...HEAD, ...lines].join('\n'), { origin: 0, cpu: '586' });
  if (!a.ok) throw new Error('assembler: ' + JSON.stringify(a.errors.slice(0, 3)));
  const bus = makeBus(busOpts);
  bus.mem.set(a.bytes, CODE);
  bus.mem.set(a.bytes, DATA);                // the data labels are offsets in segment 2000h
  for (let v = 0; v < 18; v++) { const o = a.symbols['exc' + v]; bus.mem[v * 4] = o & 0xFF; bus.mem[v * 4 + 1] = o >> 8; bus.mem[v * 4 + 2] = 0x00; bus.mem[v * 4 + 3] = 0x10; }
  if (setup) setup(bus.mem, a.symbols);
  const cpu = new cpuClass(bus);
  if (pre) pre(cpu);
  for (let i = 0; i < 6; i++) cpu.loadSeg(i, i === 1 ? 0x1000 : 0x2000);
  cpu.regs[4] = 0xFFF0;
  cpu.ip = 0; cpu.flush();
  const steps = [];
  let n = 0;
  while (!cpu.halted && n++ < maxSteps) {
    if (trace) cpu.trace = [];
    const ip = cpu.ip, T = cpu.step();
    steps.push({ ip, T, ev: trace ? cpu.trace : null });
    if (trace) cpu.trace = null;
  }
  const m = bus.mem, S = k => { if (!(k in a.symbols)) throw new Error('no symbol ' + k); return a.symbols[k]; };
  return {
    cpu, bus, mem: m, sym: a.symbols, steps, S,
    exc: m[CODE + S('excvec')],
    d: (k, i = 0) => { const p = DATA + S(k) + 4 * i; return (m[p] | (m[p + 1] << 8) | (m[p + 2] << 16) | (m[p + 3] << 24)) >>> 0; },
    w: (k, i = 0) => { const p = DATA + S(k) + 2 * i; return m[p] | (m[p + 1] << 8); },
    at: p => (m[p] | (m[p + 1] << 8) | (m[p + 2] << 16) | (m[p + 3] << 24)) >>> 0,
    // the steps (the last one first) of the instruction at label k
    at$: k => steps.filter(s => s.ip === S(k)),
  };
}
function data(lines) { return ['hlt', 'align 16', ...lines]; }
const lineOf = (cpu, pa) => cpu.dFind(pa >>> 0);
const MESI = ['I', 'S', 'E', 'M'];

// =====================================================================================
section = 'reset';
{
  const c = new CPU80586(makeBus());
  eq(c.regs32[2], 0x0517, 'EDX after reset = 0517h (family 5, model 1, stepping 7; the CPUID signature)');
  eq(c.cr[0], 0x60000010, 'CR0 after reset = 60000010h (CD = 1, NW = 1, ET = 1)');
  eq(c.cr[4], 0, 'CR4 after reset = 0');
  eq(c.eflags, 2, 'EFLAGS after reset = 2');
  eq(c.ip, 0xFFF0, 'EIP = FFF0h');
  for (const [name, C] of [['dcache', c.dcache], ['icache', c.icache]]) {
    check(C.sets === 128 && C.ways === 2 && C.lineSize === 32 && C.tag.length === 256 && C.data.length === 8192 && C.lru.length === 128,
      `${name}: 128 sets x 2 ways x 32 bytes (8 KB)`);
    check(C.tag.every(t => t === -1), `${name}: all lines invalid after reset`);
  }
  check(c.dcache.state.length === 256 && c.dcache.state.every(s => s === 0), 'dcache.state: 256 MESI states, all I');
  check(c.tlb.length === 64 && c.tlb4m.length === 8 && c.itlb.length === 32, 'TLBs: 64 data entries (4 KB), 8 entries (4 MB), 32 code entries');
  check(c.btb.tag.length === 256 && c.btb.tag.every(t => t === -1) && c.btb.sets === 64 && c.btb.ways === 4, 'BTB: 256 entries (64 sets x 4 ways), all empty');
  check(c.cache486 === null, 'cache486 = null (the P5 has two caches)');
  check(c.fdivBug === false && c.queueSnoop === true, 'fdivBug = false, queueSnoop = true');
  eq(new CPU80486(makeBus()).regs32[2], 0x0415, 'the 80486 still gives EDX = 0415h');
}

// =====================================================================================
section = 'CPUID';
{
  const L = ['xor eax, eax', 'cpuid', 'mov [r0a], eax', 'mov [r0b], ebx', 'mov [r0d], edx', 'mov [r0c], ecx',
    'mov eax, 1', 'cpuid', 'mov [r1a], eax', 'mov [r1b], ebx', 'mov [r1c], ecx', 'mov [r1d], edx',
    'mov eax, 2', 'cpuid', 'mov [r2a], eax', 'mov [r2d], edx', 'hlt',
    ...data(['r0a: dd 0', 'r0b: dd 0', 'r0d: dd 0', 'r0c: dd 0', 'r1a: dd 0', 'r1b: dd 0', 'r1c: dd 0', 'r1d: dd 0', 'r2a: dd 0', 'r2d: dd 0'])];
  const r = run(L);
  eq(r.d('r0a'), 1, 'CPUID 0: EAX = 1 (the highest leaf)');
  const vendor = Buffer.alloc(12);
  vendor.writeUInt32LE(r.d('r0b'), 0); vendor.writeUInt32LE(r.d('r0d'), 4); vendor.writeUInt32LE(r.d('r0c'), 8);
  check(vendor.toString('latin1') === 'GenuineIntel', 'CPUID 0: EBX EDX ECX = "GenuineIntel"', vendor.toString('latin1'));
  eq(r.d('r1a'), 0x0517, 'CPUID 1: EAX = 0517h');
  eq((r.d('r1a') >> 8) & 15, 5, 'CPUID 1: family 5');
  eq((r.d('r1a') >> 4) & 15, 1, 'CPUID 1: model 1 (Pentium 60 / 66)');
  eq(r.d('r1a') & 15, 7, 'CPUID 1: stepping 7');
  eq(r.d('r1d'), 0x1BD, 'CPUID 1: EDX = 1BDh');
  const f = r.d('r1d');
  check((f & 1) && (f & 4) && (f & 8) && (f & 0x10) && (f & 0x20) && (f & 0x80) && (f & 0x100), 'CPUID 1 EDX: FPU (0), DE (2), PSE (3), TSC (4), MSR (5), MCE (7), CX8 (8)');
  check(!(f & 2), 'CPUID 1 EDX: VME (bit 1) = 0 (the core has no VME)');
  eq(r.d('r1b') | r.d('r1c'), 0, 'CPUID 1: EBX = ECX = 0');
  eq(r.d('r2a') | r.d('r2d'), 0, 'CPUID 2 (above the highest leaf): 0');
  eq(run(L, { bus: { fpu: false } }).d('r1d'), 0x1BC, 'CPUID 1 without an FPU: EDX bit 0 = 0');
  // the ID flag test, then CPUID family 5
  const D = run(['pushfd', 'pop eax', 'mov ecx, eax', 'xor eax, 0x200000', 'push eax', 'popfd', 'pushfd', 'pop eax', 'xor eax, ecx',
    'mov [iddiff], eax', 'mov eax, 1', 'cpuid', 'shr eax, 8', 'and eax, 15', 'mov [fam], eax', 'hlt', ...data(['iddiff: dd 0', 'fam: dd 0'])]);
  eq(D.d('iddiff'), 0x200000, 'the ID flag (bit 21) changes: CPUID is present');
  eq(D.d('fam'), 5, 'the detection code finds family 5 (a Pentium)');
}

// =====================================================================================
section = 'RDTSC';
{
  const r = run([...CACHE_ON, 't0: rdtsc', 'mov [a0], eax', 'mov [a0h], edx', 'nop', 'nop', 'mov cx, 20', 'l: loop l', 't1: rdtsc', 'mov [a1], eax', 'mov [a1h], edx',
    'mov eax, cr4', 'or eax, 4', 'mov cr4, eax', 'rdtsc', 'mov [a2], eax', 'hlt', ...data(['a0: dd 0', 'a0h: dd 0', 'a1: dd 0', 'a1h: dd 0', 'a2: dd 0'])]);
  const i0 = r.steps.findIndex(s => s.ip === r.S('t0')), i1 = r.steps.findIndex(s => s.ip === r.S('t1'));
  const sum = r.steps.slice(i0, i1).reduce((a, s) => a + s.T, 0);
  check(r.d('a1') > r.d('a0'), 'RDTSC counts up', () => `${r.d('a0')} -> ${r.d('a1')}`);
  eq(r.d('a1') - r.d('a0'), sum, 'the difference of two RDTSC = the clocks of the steps between them (cpu.cycles)');
  eq(r.d('a0'), r.steps.slice(0, i0).reduce((a, s) => a + s.T, 0), 'the TSC = cpu.cycles at the start of the RDTSC');
  eq(r.d('a0h') | r.d('a1h'), 0, 'EDX = the high 32 bits (0 here)');
  eq(r.exc, 0xFF, 'CR4.TSD = 1 in real mode (CPL 0): RDTSC works');
  check(r.d('a2') > r.d('a1'), 'RDTSC after TSD = 1 at CPL 0');
  const r4 = run(['db 0x0F, 0x31', 'hlt'], { cpuClass: CPU80486 });
  eq(r4.exc, 6, 'RDTSC on the 80486: #UD');
}

// =====================================================================================
section = 'RDMSR / WRMSR';
{
  const r = run([
    'mov ecx, 0x10', 'xor eax, eax', 'mov edx, 1', 'wrmsr', 'rdtsc', 'mov [t1a], eax', 'mov [t1d], edx',
    'mov ecx, 0x10', 'mov eax, 0xFFFFFFF0', 'xor edx, edx', 'wrmsr', 'mov cx, 10', 'l1: loop l1', 'mov ecx, 0x10', 'rdmsr', 'mov [t2a], eax', 'mov [t2d], edx',
    'xor ecx, ecx', 'rdmsr', 'mov [m0], eax', 'mov ecx, 1', 'rdmsr', 'mov [m1], eax',
    'mov ecx, 0x0E', 'mov eax, 0x203', 'xor edx, edx', 'wrmsr', 'rdmsr', 'mov [tr12], eax', 'xor eax, eax', 'wrmsr',
    // CTR0: event 16h (instructions), CC = 3; CTR1: event 17h (the V pipe), CC = 3
    'mov ecx, 0x11', 'mov eax, 0x16 | (3 << 6) | ((0x17 | (3 << 6)) << 16)', 'xor edx, edx', 'wrmsr',
    'mov ecx, 0x12', 'xor eax, eax', 'wrmsr', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'mov ecx, 0x12', 'rdmsr', 'mov [ctr0], eax',
    'mov ecx, 0x11', 'rdmsr', 'mov [cesr], eax',
    'mov ecx, 0x1B', 'rdmsr', 'hlt',
    ...data(['t1a: dd 0', 't1d: dd 0', 't2a: dd 0', 't2d: dd 0', 'm0: dd 0xFF', 'm1: dd 0xFF', 'tr12: dd 0', 'ctr0: dd 0', 'cesr: dd 0'])]);
  eq(r.d('t1d'), 1, 'WRMSR 10h = 1_00000000h, then RDTSC: EDX = 1');
  check(r.d('t1a') < 64, 'RDTSC after WRMSR 10h: EAX = the few clocks since the write', r.d('t1a'));
  eq(r.d('t2d'), 1, 'the TSC is 64 bits: FFFFFFF0h + more than 16 clocks gives EDX = 1 (RDMSR 10h)');
  eq(r.d('m0') | r.d('m1'), 0, 'RDMSR 0 and 1 (P5_MC_ADDR, P5_MC_TYPE) = 0: no machine check');
  eq(r.d('tr12'), 0x203, 'TR12 (MSR 0Eh): NBP, SE and CI read back');
  eq(r.d('ctr0'), 12, 'CTR0 with event 16h counts the instructions from the WRMSR 12h on (WRMSR, 10 NOP, MOV ECX)');
  eq(r.d('cesr'), 0x16 | (3 << 6) | ((0x17 | (3 << 6)) << 16), 'CESR (MSR 11h) reads back');
  eq(r.exc, 13, 'RDMSR of an unknown MSR (1Bh): #GP(0)');
  eq(run(['mov ecx, 0x20', 'wrmsr', 'hlt']).exc, 13, 'WRMSR of an unknown MSR (20h): #GP(0)');
  eq(run(['db 0x0F, 0x32', 'hlt'], { cpuClass: CPU80486 }).exc, 6, 'RDMSR on the 80486: #UD');
}

// =====================================================================================
section = 'CMPXCHG8B';
{
  const r = run([...CACHE_ON,
    'mov dword [m1], 0x55667788', 'mov dword [m1 + 4], 0x11223344',
    'mov eax, 0x55667788', 'mov edx, 0x11223344', 'mov ebx, 0xEEFF0011', 'mov ecx, 0xAABBCCDD', 'stc',
    'cmpxchg8b [m1]', 'pushf', 'pop word [f1]', 'mov [a1], eax', 'mov [d1], edx',
    'mov dword [m2], 0x05060708', 'mov dword [m2 + 4], 0x01020304', 'xor eax, eax', 'xor edx, edx', 'clc',
    'x2: lock cmpxchg8b [m2]', 'pushf', 'pop word [f2]', 'mov [a2], eax', 'mov [d2], edx',
    'db 0x0F, 0xC7, 0xC8', 'hlt',
    ...data(['m1: dq 0', 'm2: dq 0', 'f1: dd 0', 'a1: dd 0', 'd1: dd 0', 'f2: dd 0', 'a2: dd 0', 'd2: dd 0'])], { bus: { poke: true }, trace: true });
  eq(r.d('m1'), 0xEEFF0011, 'equal: m64 low = EBX');
  eq(r.d('m1', 1), 0xAABBCCDD, 'equal: m64 high = ECX');
  eq(r.w('f1') & 0x41, 0x41, 'equal: ZF = 1; CF (set before) does not change');
  eq(r.d('a1'), 0x55667788, 'equal: EAX does not change');
  eq(r.d('d1'), 0x11223344, 'equal: EDX does not change');
  eq(r.w('f2') & 0x41, 0, 'not equal: ZF = 0 (CF = 0 does not change)');
  eq(r.d('a2'), 0x05060708, 'not equal: EAX = m64 low');
  eq(r.d('d2'), 0x01020304, 'not equal: EDX = m64 high');
  eq(r.d('m2'), 0x05060708, 'not equal: m64 keeps its value');
  const ev = r.at$('x2')[0].ev, cw = ev.find(e => e.k === 'cache' && e.cache === 'data');
  const li = lineOf(r.cpu, DATA + r.S('m2'));
  check(ev.some(e => e.k === 'alu' && e.op === 'CMPXCHG8B'), "trace: an 'alu' event CMPXCHG8B");
  check(li >= 0 && r.cpu.dcache.state[li] === 3, 'not equal: the P5 writes m64 (its line is M after the instruction)', () => MESI[r.cpu.dcache.state[li]]);
  check(cw && !cw.write, 'the first data access of CMPXCHG8B is the read', () => JSON.stringify(cw));
  eq(r.exc, 6, 'CMPXCHG8B with a register operand (0F C7 C8): #UD');
  eq(run(['db 0x0F, 0xC7, 0x07', 'hlt']).exc, 6, '0F C7 with the reg field 0 (not 1): #UD');
  eq(run(['db 0x0F, 0xC7, 0x0F', 'hlt'], { cpuClass: CPU80486 }).exc, 6, 'CMPXCHG8B on the 80486: #UD');
}

// =====================================================================================
section = 'CR4';
{
  const r = run(['mov eax, cr4', 'mov [c0], eax', 'mov eax, 0x5C', 'mov cr4, eax', 'mov eax, cr4', 'mov [c1], eax',
    'xor eax, eax', 'mov cr4, eax', 'mov eax, 1', 'mov cr4, eax', 'hlt', ...data(['c0: dd 0xFF', 'c1: dd 0'])], { trace: true });
  eq(r.d('c0'), 0, 'MOV EAX, CR4 after reset = 0');
  eq(r.d('c1'), 0x5C, 'CR4 keeps TSD (2), DE (3), PSE (4) and MCE (6)');
  eq(r.exc, 13, 'MOV CR4 with VME (bit 0): #GP(0) (VME is not in the core)');
  check(r.steps.some(s => s.ev.some(e => e.k === 'reg' && e.r === 'CR4' && e.v === 0x5C)), "trace: a 'reg' event CR4");
  check(r.steps.some(s => s.ev.some(e => e.k === 'sys' && e.op === 'CR4' && /TSD DE PSE MCE/.test(e.text))), "trace: a 'sys' event CR4 with the bit names");
  for (const [v, why] of [[2, 'PVI'], [0x20, 'PAE (not on the P5)'], [0x80, 'bit 7'], [0x100, 'bit 8']]) {
    eq(run([`mov eax, ${v}`, 'mov cr4, eax', 'hlt']).exc, 13, `MOV CR4 with ${why}: #GP(0)`);
  }
  eq(run(['db 0x0F, 0x20, 0xE8', 'hlt']).exc, 6, 'MOV EAX, CR5: #UD');
  eq(run(['db 0x0F, 0x20, 0xC8', 'hlt']).exc, 6, 'MOV EAX, CR1: #UD');
  eq(run(['mov eax, cr4', 'hlt'], { cpuClass: CPU80486 }).exc, 6, 'MOV EAX, CR4 on the 80486: #UD');
  // DE: DR4 / DR5
  const d0 = run(['mov eax, dr4', 'mov [v], eax', 'mov eax, dr6', 'mov [v6], eax', 'mov eax, 8', 'mov cr4, eax', 'mov eax, dr4', 'hlt', ...data(['v: dd 0', 'v6: dd 0'])]);
  eq(d0.d('v'), d0.d('v6'), 'CR4.DE = 0: DR4 is DR6');
  eq(d0.exc, 6, 'CR4.DE = 1: MOV EAX, DR4 gives #UD');
  eq(run(['db 0x0F, 0x24, 0xC0', 'hlt']).exc, 6, 'MOV EAX, TR4 (0F 24): #UD (the P5 has no test registers)');
  // I/O breakpoints: DR0 = port 80h, DR7: L0, R/W0 = 10 (I/O), LEN0 = 00
  const io = de => run([...(de ? ['mov eax, 8', 'mov cr4, eax'] : []), 'mov eax, 0x80', 'mov dr0, eax', 'mov eax, 0x20001', 'mov dr7, eax',
    'mov al, 1', 'out 0x81, al', 'mov byte [r1], 1', 'out 0x80, al', 'mov byte [r2], 1', 'hlt', ...data(['r1: dd 0', 'r2: dd 0'])]);
  const i1 = io(true);
  eq(i1.exc, 1, 'CR4.DE = 1: OUT to the port in DR0 (R/W = 10) gives #DB');
  eq(i1.cpu.dr[6] & 1, 1, '#DB for an I/O breakpoint: DR6.B0 = 1');
  eq(i1.d('r1') & 0xFF, 1, 'an OUT to another port (81h): no #DB');
  eq(i1.d('r2') & 0xFF, 0, 'the #DB is a trap after the OUT (the next instruction does not run)');
  check(i1.bus.io.some(([p]) => p === 0x80), 'the OUT completes before the trap');
  const i0 = io(false);
  eq(i0.exc, 0xFF, 'CR4.DE = 0: R/W = 10 gives no I/O breakpoint');
}

// =====================================================================================
section = 'cache: fills, hits, MESI';
{
  const r = run([...CACHE_ON,
    'rd1: mov eax, [0x100]',     // read miss: a fill of 100h-11Fh, state E
    'mov ebx, [0x11C]',          // read hit (the last dword of the line)
    'mov ecx, [0x120]',          // read miss: the next line
    'wh: mov dword [0x104], 0x12345678',   // write hit on E: the line becomes M, no bus cycle
    'wm: mov dword [0x400], 0x0BADF00D',   // write miss: a bus cycle, no fill
    'mov esi, [0x104]',          // hit: the new value
    'hlt'], { trace: true, bus: { poke: true }, setup: m => { for (let i = 0; i < 0x40; i++) m[DATA + 0x100 + i] = i; } });
  const st = r.cpu.dcache.stats, C = r.cpu.dcache;
  eq(st.fills, 2, 'two line fills (100h and 120h)');
  eq(st.hits, 2, 'two read hits');
  eq(st.writeHits, 1, 'one write hit');
  eq(st.writeMisses, 1, 'one write miss (no line fill on a write)');
  eq(r.cpu.regs32[6], 0x12345678, 'the read after the write hit gives the new value');
  eq(r.at(DATA + 0x104), 0x12345678, 'memory has the new bytes at once (the emulator writes each store)');
  eq(r.at(DATA + 0x400), 0x0BADF00D, 'a write miss goes to memory');
  const l1 = lineOf(r.cpu, DATA + 0x100), l2 = lineOf(r.cpu, DATA + 0x120);
  eq(C.state[l1], 3, 'the written line is M');
  eq(C.state[l2], 2, 'a line that was only read is E (WB/WT# = 1, PWT = 0)');
  eq(C.tag[l1], (DATA + 0x100) >>> 12, 'dcache.tag = physical address bits 12-31');
  eq(l1 >> 1, ((DATA + 0x100) >>> 5) & 127, 'the set = physical address bits 5-11');
  eq(lineOf(r.cpu, DATA + 0x400), -1, 'no line for the write miss');
  const ev = r.at$('rd1')[0].ev, c = ev.find(e => e.k === 'cache' && e.cache === 'data');
  check(c && c.cache === 'data' && !c.hit && c.fill && c.state === 'E' && c.set === (((DATA + 0x100) >>> 5) & 127) && c.way === 0,
    "a read miss: { k:'cache', cache:'data', hit:false, fill:true, state:'E', set, way }", () => JSON.stringify(c));
  const beats = ev.filter(e => e.k === 'bus' && e.burst);
  check(beats.length === 4 && beats.every(b => b.type === 'memr' && b.width === 8 && b.line === DATA + 0x100), 'the fill: 4 transfers of 8 bytes (burst: true, width 8, line)', () => JSON.stringify(beats));
  check(beats[0].data === 0x03020100 && beats[0].hi === 0x07060504, 'a beat: data = the low dword, hi = the high dword', () => JSON.stringify(beats[0]));
  const evh = r.at$('wh')[0].ev, ch = evh.find(e => e.k === 'cache' && e.cache === 'data');
  check(ch && ch.write && ch.hit && ch.state === 'M', 'a write hit on E: state M', () => JSON.stringify(ch));
  check(!evh.some(e => e.k === 'bus' && e.type === 'memw'), 'a write hit on E or M has no bus cycle');
  eq(r.bus.pokes, 4, 'the 4 bytes of the write hit go to memory with bus.poke8 (no bus cycle)');
  const evm = r.at$('wm')[0].ev;
  check(evm.some(e => e.k === 'bus' && e.type === 'memw' && e.width === 4 && e.data === 0x0BADF00D), 'a write miss: one bus transfer (an aligned dword in one 8-byte group)');
}

// =====================================================================================
section = 'cache: burst order, the 64-bit bus';
{
  const r = run([...CACHE_ON, 'b1: mov eax, [0x118]', 'u1: mov eax, [0x7806]', 'u2: mov eax, [0x7800]', 'hlt'],
    { trace: true, bus: { ws: 1, cacheable: pa => !(pa >= DATA + 0x7800 && pa < DATA + 0x7900) } });
  const beats = r.at$('b1')[0].ev.filter(e => e.k === 'bus' && e.burst);
  check(JSON.stringify(beats.map(b => b.addr - DATA - 0x100)) === '[24,16,8,0]', 'burst order from the 8 bytes that the CPU needs: 18-10-8-0', () => JSON.stringify(beats.map(b => b.addr - DATA)));
  check(JSON.stringify(beats.map(b => b.len)) === '[3,2,2,2]', 'burst timing 2-1-1-1 (+1 wait state each): 3, 2, 2, 2 clocks', () => JSON.stringify(beats.map(b => b.len)));
  check(beats.every((b, i) => i === 0 || b.t >= beats[i - 1].t + beats[i - 1].len), 'the beats follow one another in time');
  const u1 = r.at$('u1')[0].ev.filter(e => e.k === 'bus');
  check(u1.length === 2 && u1[0].addr === DATA + 0x7806 && u1[0].width === 2 && u1[1].addr === DATA + 0x7808 && u1[1].width === 2,
    'an uncached dword at 8n+6: one transfer for each 8-byte group (2 bytes + 2 bytes)', () => JSON.stringify(u1));
  const u2 = r.at$('u2')[0].ev.filter(e => e.k === 'bus');
  check(u2.length === 1 && u2[0].width === 4, 'an uncached aligned dword: one transfer', () => JSON.stringify(u2));
  const cn = r.at$('u1')[0].ev.find(e => e.k === 'cache' && e.cache === 'data');
  check(cn && cn.nc && cn.way === -1 && cn.state === 'I', "an uncached read: nc: true, way -1, state 'I'", () => JSON.stringify(cn));
}

// =====================================================================================
section = 'cache: LRU, write-back';
{
  // Three lines of one set (a stride of 4 KB): A and B fill ways 0 and 1; a write makes B M; a
  // read of A makes B the LRU way; C replaces B, and B goes to the bus in a write-back burst.
  const A = 0x400, B = 0x1400, Cc = 0x2400;
  const r = run([...CACHE_ON, `mov eax, [${A}]`, `mov eax, [${B}]`, `mov dword [${B}], 0x11111111`, `mov eax, [${A}]`, `rc: mov eax, [${Cc}]`, 'hlt'], { trace: true });
  const D = r.cpu.dcache, set = ((DATA + A) >>> 5) & 127;
  eq(D.tag[set * 2], (DATA + A) >>> 12, 'way 0 keeps A (the most recent use)');
  eq(D.tag[set * 2 + 1], (DATA + Cc) >>> 12, 'C replaces way 1 (B, the LRU way)');
  eq(D.lru[set], 0, 'lru[set] = 0: the next fill replaces way 0 (A is now the older line)');
  eq(D.stats.writeBacks, 1, 'one write-back (B was M)');
  const ev = r.at$('rc')[0].ev, bus = ev.filter(e => e.k === 'bus' && e.burst);
  const fill = bus.filter(e => e.type === 'memr'), wb = bus.filter(e => e.type === 'memw');
  check(fill.length === 4 && wb.length === 4 && wb.every(e => e.wb && e.line === DATA + B && e.width === 8), 'the fill of C (4 reads), then the write-back burst of B (4 writes, wb: true)', () => JSON.stringify(bus.map(e => [e.type, e.addr - DATA, e.wb])));
  check(JSON.stringify(wb.map(e => e.addr - DATA - B)) === '[0,8,16,24]' && wb[0].data === 0x11111111, 'the write-back: the line in order, with its data');
  check(ev.indexOf(fill[3]) < ev.indexOf(wb[0]) || fill[3].t <= wb[0].t, 'the write-back comes after the fill');
  const c = ev.find(e => e.k === 'cache' && e.cache === 'data');
  check(c && c.fill && c.wb && c.wbLine === DATA + B && c.way === 1, "the cache event: wb: true, wbLine = B", () => JSON.stringify(c));
}

// =====================================================================================
section = 'cache: INVD, WBINVD, CD / NW, KEN#';
{
  const r = run([...CACHE_ON, 'mov dword [0x0], 1', 'mov eax, [0x0]', 'mov dword [0x0], 2', 'mov eax, [0x40]', 'mov dword [0x40], 3',
    'i1: invd', 'mov eax, [0x80]', 'mov dword [0x80], 4', 'mov eax, [0xC0]', 'mov dword [0xC0], 5', 'mov eax, [0x100]', 'w1: wbinvd', 'hlt'], { trace: true });
  const st = r.cpu.dcache.stats;
  eq(st.writeBacks, 2, 'INVD drops the M lines (no write-back); WBINVD writes back the 2 M lines');
  check(r.cpu.dtag.every(t => t === -1) && r.cpu.itag.filter(t => t !== -1).length <= 1, 'after WBINVD both caches are empty (the HLT after it fills one code line again)');
  eq(r.at(DATA), 2, 'memory has the stores of the lines that INVD dropped (the emulator writes each store)');
  const wev = r.at$('w1')[0].ev;
  check(wev.filter(e => e.k === 'bus' && e.wb).length === 8, 'WBINVD: 2 write-back bursts of 4 transfers');
  check(wev.some(e => e.k === 'sys' && e.op === 'WBINVD' && /2 modified/.test(e.text)), "trace: a 'sys' WBINVD event");
  check(r.at$('i1')[0].ev.some(e => e.k === 'sys' && e.op === 'INVD'), "trace: a 'sys' INVD event");
  // CD = 1 after reset: no fills
  const r0 = run(['mov eax, [0x0]', 'mov ebx, [0x0]', 'hlt']);
  eq(r0.cpu.dcache.stats.fills + r0.cpu.icache.stats.fills, 0, 'CD = 1 (after reset): no line fills in either cache');
  // CD = 1, NW = 0: the lines give hits, no new fills, a write hit goes to the bus and the state stays
  const r1 = run([...CACHE_ON, 'mov eax, [0x0]', 'mov eax, cr0', 'or eax, 0x40000000', 'mov cr0, eax',
    'mov ebx, [0x0]', 'mov ecx, [0x40]', 'wt: mov dword [0x4], 5', 'hlt'], { trace: true });
  const s1 = r1.cpu.dcache.stats;
  eq(s1.fills, 1, 'CD = 1, NW = 0: no fill for 40h');
  eq(s1.hits, 1, 'CD = 1, NW = 0: the line of 0 still gives a hit');
  check(r1.at$('wt')[0].ev.some(e => e.k === 'bus' && e.type === 'memw'), 'CD = 1, NW = 0: a write hit goes to the bus');
  eq(r1.cpu.dcache.state[lineOf(r1.cpu, DATA)], 2, 'CD = 1, NW = 0: the E line stays E');
  // CD = NW = 1: a write hit has no bus cycle; memory still gets the bytes; the core ignores cacheInvalidate
  const r2 = run([...CACHE_ON, 'mov eax, [0x0]', 'mov eax, cr0', 'or eax, 0x60000000', 'mov cr0, eax', 'wn: mov dword [0x0], 0xAABBCCDD', 'mov ebx, [0x0]', 'hlt'], { trace: true });
  check(!r2.at$('wn')[0].ev.some(e => e.k === 'bus' && e.type === 'memw'), 'CD = NW = 1: a write hit has no bus cycle');
  eq(r2.at(DATA), 0xAABBCCDD, 'CD = NW = 1: memory has the bytes (the emulator rule)');
  eq(r2.cpu.cacheInvalidate(DATA, 32), 0, 'CD = NW = 1: the core ignores cacheInvalidate');
  // KEN#
  const r3 = run([...CACHE_ON, 'mov eax, [0x0]', 'mov eax, [0x0]', 'hlt'], { bus: { cacheable: () => false } });
  eq(r3.cpu.dcache.stats.fills + r3.cpu.icache.stats.fills, 0, 'bus.cacheable = false (KEN#): no line fills');
  const c = new CPU80586(makeBus({ cacheable: undefined }));
  c.bus.cacheable = undefined;
  check(!c.cacheable(0xA0000) && !c.cacheable(0xBFFFF) && c.cacheable(0x9FFFF), 'the default KEN#: A0000h-BFFFFh is not cacheable');
}

// =====================================================================================
section = 'cache: cacheInvalidate, code cache, self-modifying code';
{
  const bus = makeBus();
  const a = Asm86.assemble(['cpu 586', 'mov eax, cr0', 'and eax, 0x9FFFFFFF', 'mov cr0, eax', 'times 64 nop', 'mov eax, [0x0]', 'l1: mov ebx, [0x0]', 'l2: mov ecx, [0x0]', 'hlt'].join('\n'), { origin: 0, cpu: '586' });
  bus.mem.set(a.bytes, CODE);
  bus.mem[DATA] = 0x11;
  const cpu = new CPU80586(bus);
  for (let i = 0; i < 6; i++) cpu.loadSeg(i, i === 1 ? 0x1000 : 0x2000);
  cpu.ip = 0; cpu.flush();
  while (cpu.ip !== a.symbols.l1) cpu.step();
  bus.mem[DATA] = 0x22;                     // a DMA write that does not tell the CPU
  cpu.step();
  eq(cpu.regs32[3], 0x11, 'without invalidation the CPU reads the old line (a stale copy)');
  eq(cpu.cacheInvalidate(DATA, 1), 1, 'cpu.cacheInvalidate(phys, 1) makes one data line invalid');
  cpu.step();
  eq(cpu.regs32[1], 0x22, 'after cacheInvalidate the CPU reads the new data');
  eq(cpu.dcache.stats.invalidations, 1, 'dcache.stats.invalidations = 1');
  check(cpu.cacheInvalidate(CODE, 0x100) >= 1 && cpu.icache.stats.invalidations >= 1, 'cacheInvalidate makes the code lines of the range invalid too');
  cpu.cacheInvalidate(0, 0x1000000);
  check(cpu.dtag.every(t => t === -1) && cpu.itag.every(t => t === -1), 'cacheInvalidate(0, 16 MB): no valid line in either cache');
  // a loop runs from the code cache
  const r = run([...CACHE_ON, 'mov cx, 50', 'l: add ax, cx', 'loop l', 'hlt'], { trace: true });
  const ic = r.cpu.icache.stats;
  check(ic.fills >= 1 && ic.fills <= 4 && ic.hits >= 45, 'the loop runs from the code cache (few fills, many hits)', () => JSON.stringify(ic));
  const all = r.steps.flatMap(s => s.ev);
  const fb = all.filter(e => e.k === 'fetch' && e.burst);
  check(fb.length >= 4 && fb.every(e => e.width === 8 && typeof e.line === 'number'), "code line fills: 'fetch' events with width 8, burst: true and line", fb.length);
  check(all.some(e => e.k === 'cache' && e.cache === 'code' && e.code && e.fill && e.state === 'S'), "a code miss: a 'cache' event with cache: 'code' and state 'S'");
  // self-modifying code: the P5 sees a write to the bytes in its prefetch queue
  const smc = ['mov byte [cs:target + 1], 0x42', 'target: mov al, 0x11', 'mov [r_al], al', 'hlt', ...data(['r_al: dd 0'])];
  eq(run([...CACHE_ON, ...smc]).d('r_al') & 0xFF, 0x42, 'self-modifying code: the P5 runs the new byte (the queue is empty after the write)');
  eq(run([...CACHE_ON, ...smc], { pre: c => { c.queueSnoop = false; } }).d('r_al') & 0xFF, 0x11, 'queueSnoop = false: the old byte in the queue runs (as on the 386)');
  const rs = run([...CACHE_ON, 'mov cx, 2', 'l: mov al, [cs:0]', 'loop l', 'mov byte [cs:target2], 0x90', 'target2: nop', 'hlt']);
  check(rs.cpu.icache.stats.invalidations >= 1, 'a data write to a line in the code cache makes that code line invalid', () => JSON.stringify(rs.cpu.icache.stats));
}

// =====================================================================================
// The pairing rules. Each case runs: loop 2 times { CLD (not simple), A, B, CLD, DEC, JNZ }. In
// the second pass the code is in the code cache, and A is always in the U pipe (CLD cannot pair).
section = 'pairing';
function pairCase(a, b, opts = {}) {
  const r = run([...CACHE_ON, ...(opts.init || []), 'mov cx, 2', 'l:', 'cld', `ia: ${a}`, `ib: ${b}`, 'ic: cld', 'dec cx', 'jnz l', 'hlt'], { trace: true, pre: opts.pre, bus: opts.bus });
  const A = r.at$('ia').pop(), B = r.at$('ib').pop();
  const pa = A.ev.find(e => e.k === 'pipe'), pb = B.ev.find(e => e.k === 'pipe');
  return { r, pa, pb, clocks: A.T + B.T, ta: A.T, tb: B.T };
}
const PAIRS = [
  // [U, V, pairs, reason (a part of the text), the clocks of both steps]
  ['mov ax, 1', 'mov bx, 2', true, '', 2],
  ['mov ax, 1', 'mov bx, ax', false, 'V reads EAX, which U writes', 2],
  ['mov ax, 1', 'mov ax, 2', false, 'U and V both write EAX', 2],
  ['mov al, 1', 'mov ah, 2', false, 'U and V both write EAX', 2],
  ['inc ax', 'dec bx', true, '', 2],
  ['add ax, bx', 'adc cx, dx', false, 'V goes only into the U pipe', 2],
  ['adc cx, dx', 'add ax, bx', true, '', 2],
  ['shl ax, 1', 'mov bx, 2', true, '', 2],
  ['sar ax, 3', 'mov bx, 2', true, '', 2],
  ['mov bx, 2', 'shr ax, 1', false, 'V goes only into the U pipe', 2],
  ['rol ax, 3', 'mov bx, 2', false, 'U is not a simple instruction', 2],
  ['shl ax, cl', 'mov bx, 2', false, 'U is not a simple instruction', 5],
  ['cmp ax, ax', 'jne ic', true, '', 2],
  ['test ax, bx', 'jz ic', true, '', null],
  ['push ax', 'push bx', true, '', 2],
  ['pop ax', 'pop bx', true, '', 2],
  ['push ax', 'pop bx', false, 'V reads ESP, which U writes', 2],
  ['push ax', 'call ic', true, '', null],
  ['lea si, [di+4]', 'mov ax, [si]', false, 'V reads ESI, which U writes', 2],
  ['mov ax, [si]', 'lea si, [di+4]', true, '', 2],
  ['mov eax, 1', 'mov bx, 2', false, 'U has a prefix', 3],
  ['mov bx, 2', 'mov eax, 1', false, 'V has a prefix', 3],
  ['mov ax, [es:0x100]', 'mov bx, 2', false, 'U has a prefix', 3],
  ['mov word [0x100], 5', 'mov bx, 2', false, 'U has a displacement and an immediate', 3],   // a write miss: 2 clocks on the bus
  ['mov bx, 2', 'add word [0x100], 5', false, 'V has a displacement and an immediate', 4],
  ['mov word [bx], 5', 'mov cx, 2', true, '', 2],
  ['mul bx', 'mov ax, 1', false, 'U is not a simple instruction', 12],
  ['mov ax, 1', 'mul bx', false, 'V is not a simple instruction', 12],
  ['jmp short ib', 'mov ax, 1', false, 'U is a jump', null],
  ['add word [0x100], ax', 'mov bx, 1', true, '', 3],
  ['mov ax, [0x100]', 'add bx, [0x102]', true, '', 2],
  ['add ax, [0x100]', 'add word [0x102], bx', true, '', 3],
  ['fadd st0, st1', 'fxch st2', true, '', 3],
  ['fadd st0, st1', 'mov ax, 1', false, 'an FPU instruction pairs only with FXCH', 4],
  ['mov ax, 1', 'fxch st2', false, 'an FPU instruction pairs only with FXCH', 2],
];
for (const [a, b, pairs, why, clk] of PAIRS) {
  const x = pairCase(a, b, { init: a.startsWith('f') || b.startsWith('f') ? ['fninit', 'fldz', 'fld1', 'fldz'] : [] });
  check(x.pa && x.pa.pipe === 'U' && x.pa.paired === pairs && (pairs ? x.pb.pipe === 'V' && x.pb.paired : x.pb.pipe === 'U'),
    `${a} / ${b}: ${pairs ? 'a pair (U, V)' : 'no pair'}`, () => JSON.stringify({ a: x.pa, b: x.pb }));
  if (!pairs) check(x.pa && x.pa.reason.includes(why), `${a} / ${b}: reason "${why}"`, () => x.pa && x.pa.reason);
  if (clk !== null) eq(x.clocks, clk, `${a} / ${b}: the two steps take ${clk} clocks`);
}
{
  const x = pairCase('mov ax, 1', 'mov bx, 2');
  check(x.pa.partner === 'mov bx, 0x2' && x.pb.partner === 'mov ax, 0x1', "the 'pipe' event: partner = the other instruction of the pair", () => JSON.stringify([x.pa.partner, x.pb.partner]));
  check(x.pa.stage.length === 5 && x.pa.stage[3] === 'mov ax, 0x1' && x.pa.stage[2] === 'mov bx, 0x2', "the 'pipe' event keeps the 5 stages of the 486 event", () => JSON.stringify(x.pa.stage));
  eq(x.ta, 1, 'the clock rule: U = its clocks minus 1 (at least 1)');
  eq(x.tb, 1, 'the clock rule: V = the pair minus the U step (at least 1)');
  const y = pairCase('add word [0x100], ax', 'mov bx, 1');
  eq(y.ta, 2, 'a (3, 1) pair: the U step gives 3 - 1 = 2');
  eq(y.tb, 1, 'a (3, 1) pair: the V step gives 3 - 2 = 1 (the pair takes 3, the clocks of the longer one)');
  eq(y.pa.clocks, 3, "the 'pipe' event: clocks = the clocks of the instruction alone");
  const z = pairCase('mov ax, 1', 'mov bx, 2', { pre: c => { c.tr12 = 2; } });
  check(!z.pa.paired && z.pa.reason === 'pairing is off (TR12.SE = 1)', 'TR12.SE = 1: no pairs', () => z.pa.reason);
  const P = x.r.cpu.pipeStats;
  check(P.v > 0 && P.u > P.v && P.floor > 0 && P.why[10] === 0, 'pipeStats: u, v, floor, why[reason]', () => JSON.stringify(P));
}
{
  // An interrupt cannot come between the two instructions of a pair.
  const bus = makeBus();
  const a = Asm86.assemble(['cpu 586', 'mov eax, cr0', 'and eax, 0x9FFFFFFF', 'mov cr0, eax', 'sti', 'mov cx, 3', 'l: cld', 'mov ax, 1', 'mov bx, 2', 'loop l', 'hlt'].join('\n'), { origin: 0, cpu: '586' });
  bus.mem.set(a.bytes, CODE);
  let irq = false, taken = 0;
  bus.irqPending = () => irq; bus.ackIrq = () => { irq = false; taken++; return 0x40; };
  bus.mem.set([0x00, 0x00, 0x00, 0x30], 0x40 * 4);     // INT 40h -> 3000:0000: HLT
  bus.mem[0x30000] = 0xF4;
  const cpu = new CPU80586(bus);
  for (let i = 0; i < 6; i++) cpu.loadSeg(i, i === 1 ? 0x1000 : 0x2000);
  cpu.regs[4] = 0xFFF0; cpu.ip = 0; cpu.flush();
  let n = 0, sawV = false, vIP = -1;
  while (n++ < 200 && !cpu.halted) {
    if (cpu.pairNext) { sawV = true; vIP = cpu.ip; irq = true; }
    cpu.step();
    if (vIP >= 0) break;
  }
  check(sawV && taken === 0 && cpu.ip !== 0 && cpu.sregs[1] === 0x1000, 'an IRQ that comes up after the U instruction waits: the V instruction runs first', () => JSON.stringify({ sawV, taken, ip: cpu.ip }));
  cpu.step();
  eq(taken, 1, 'the IRQ comes at the next step');
}

// =====================================================================================
section = 'BTB';
{
  const r = run([...CACHE_ON, 'mov cx, 10', 'l: dec cx', 'j: jnz l', 'hlt'], { trace: true });
  const js = r.at$('j'), btb = js.map(s => s.ev.find(e => e.k === 'btb'));
  eq(js.length, 10, 'the loop runs 10 times');
  check(!btb[0].hit && btb[0].taken && !btb[0].right && btb[0].alloc && btb[0].counter === 3, 'the first branch: a BTB miss, taken: a wrong prediction; a new entry (counter 3)', () => JSON.stringify(btb[0]));
  check(btb[0].pipe === 'V' && btb[0].penalty === 4, 'a wrong prediction in the V pipe costs 4 clocks', () => JSON.stringify(btb[0]));
  check(btb.slice(1, 9).every(b => b.hit && b.predicted && b.taken && b.right && b.penalty === 0), 'then the BTB predicts the loop: hit, taken, right, no penalty');
  check(btb[9].hit && btb[9].predicted && !btb[9].taken && !btb[9].right && btb[9].penalty === 4 && btb[9].counter === 2, 'the last branch (not taken) after "taken": a wrong prediction (4 clocks); the counter goes to 2', () => JSON.stringify(btb[9]));
  const la = CODE + r.S('j'), set = (la >>> 2) & 63;
  check(btb.every(b => b.set === set && b.lin === la) && btb[0].way >= 0, "the 'btb' event: lin, set (bits 2-7 of the address), way");
  const st = r.cpu.btb.stats;
  check(st.lookups === 11 && st.hits === 9 && st.right === 8 && st.wrong === 3 && st.allocs === 2, 'btb.stats (the loop and the JMP at the start): 11 lookups, 9 hits, 8 right, 3 wrong, 2 new entries', () => JSON.stringify(st));
  const dec = r.at$('l');
  eq(dec[0].T + js[0].T, 1 + 4, 'dec + jnz with a wrong prediction: 1 + 4 clocks');
  eq(dec[4].T + js[4].T, 2, 'dec + jnz predicted right: 2 clocks (a 1 + 1 pair takes 2 steps of 1 clock)');
  const i = r.cpu.btb.tag.indexOf(la | 0);
  check(i >= 0 && r.cpu.btb.target[i] === CODE + r.S('l') && r.cpu.btb.counter[i] === 2, 'cpu.btb: the tag, the target and the counter of the entry');
  // a branch alone in the U pipe: a wrong prediction costs 3 clocks
  const u = run([...CACHE_ON, 'cmp ax, ax', 'cld', 'j2: jz t2', 'nop', 't2: hlt'], { trace: true });
  const b2 = u.at$('j2')[0].ev.find(e => e.k === 'btb');
  check(b2 && b2.pipe === 'U' && !b2.right && b2.penalty === 3, 'a wrong prediction in the U pipe costs 3 clocks', () => JSON.stringify(b2));
  eq(u.at$('j2')[0].T, 4, 'Jcc in U with a wrong prediction: 1 + 3 clocks');
  // TR12.NBP = 1: no prediction
  const n = run([...CACHE_ON, 'mov cx, 5', 'l: dec cx', 'jnz l', 'hlt'], { pre: c => { c.tr12 = 1; } });
  check(n.cpu.btb.stats.hits === 0 && n.cpu.btb.stats.wrong === 5 && n.cpu.btb.tag.every(t => t === -1), 'TR12.NBP = 1: the BTB is not used (each taken branch, 4 JNZ and the first JMP, is a wrong prediction)', () => JSON.stringify(n.cpu.btb.stats));
}

// =====================================================================================
section = 'FDIV bug';
{
  const prog = (a, b, op = 'fdiv') => ['fninit', `fld qword [x]`, `${op} qword [y]`, 'fstp qword [q]', 'hlt',
    ...data([`x: dq ${a}`, `y: dq ${b}`, 'q: dq 0'])];
  const q = (r) => Buffer.from(r.mem.subarray(DATA + r.S('q'), DATA + r.S('q') + 8)).readDoubleLE(0);
  const good = q(run(prog('4195835.0', '3145727.0')));
  check(good === 4195835 / 3145727, 'fdivBug = false: 4195835 / 3145727 = 1.333820449136241', good);
  const bug = run(prog('4195835.0', '3145727.0'), { pre: c => { c.fdivBug = true; } });
  check(q(bug) === 1.3337390689020376, 'fdivBug = true: 4195835 / 3145727 = 1.333739068902 (the Pentium result)', q(bug));
  check(4195835 - q(bug) * 3145727 === 256, 'the famous check: x - (x / y) * y = 256 (0 on a correct FPU)', 4195835 - q(bug) * 3145727);
  const b2 = q(run(prog('5505001.0', '294911.0'), { pre: c => { c.fdivBug = true; } }));
  check(Math.abs(b2 - 18.66600093) < 1e-8, 'fdivBug = true: 5505001 / 294911 = 18.66600093 (correct: 18.66665197)', b2);
  const b3 = q(run(prog('4.999999', '14.999999'), { pre: c => { c.fdivBug = true; } }));
  check(Math.abs(b3 - 0.33332922) < 1e-8, 'fdivBug = true: 4.999999 / 14.999999 = 0.33332922 (correct: 0.33333329)', b3);
  const b4 = q(run(prog('3145727.0', '4195835.0', 'fdivr'), { pre: c => { c.fdivBug = true; } }));
  check(b4 === 1.3337390689020376, 'FDIVR uses the same divider', b4);
  const ok = q(run(prog('10.0', '7.0'), { pre: c => { c.fdivBug = true; } }));
  check(ok === 10 / 7, 'fdivBug = true: most divisions are correct (10 / 7)', ok);
}

// =====================================================================================
section = 'clocks';
{
  // TR12.SE = 1 (no pairs): each step gives the clocks of its instruction. The loop runs twice;
  // the second pass has the code and the data in the caches.
  const body = ['mov ax, bx', 'mov ax, [0x100]', 'add ax, [0x100]', 'add [0x100], ax', 'cmp [0x100], ax', 'push ax', 'pop ax', 'inc word [0x100]',
    'imul bx', 'xor dx, dx', 'div bx', 'imul eax, ebx', 'bswap eax', 'lea si, [bx+di+4]', 'xchg ax, bx', 'xchg cx, bx', 'cpuid', 'rdtsc', 'mov ecx, 0x10', 'rdmsr', 'wrmsr', 'mov eax, cr0', 'mov cr0, eax', 'fld1', 'fadd st0, st0', 'fdiv st0, st1', 'fxch st1', 'fstp st0'];
  const r = run([...CACHE_ON, 'fninit', 'fld1', 'mov bx, 1', 'mov dx, 0', 'mov cx, 2', 'l:', ...body.map((l, i) => `i${i}: ${l}`), 'mov dx, 0', 'mov bx, 1', 'loop l', 'hlt'],
    { pre: c => { c.tr12 = 2; } });
  const want = [1, 1, 2, 3, 2, 1, 1, 3, 11, 1, 25, 11, 2, 1, 2, 3, 14, 20, 2, 20, 30, 4, 22, 2, 3, 39, 1, 2];
  body.forEach((l, i) => eq(r.at$('i' + i).pop().T, want[i], `${l}: ${want[i]} clocks${/eax|ebx|ecx/.test(l) && !/cr0/.test(l) ? ' (with 1 clock for the 66h prefix)' : ''}`));
  const lp = run([...CACHE_ON, 'mov cx, 3', 'l: nop', 'j: loop l', 'hlt'], { pre: c => { c.tr12 = 2; } });
  check(lp.at$('j')[1].T === 5 && lp.at$('j')[2].T === 6, 'LOOP: 5 clocks taken, 6 not taken', () => JSON.stringify(lp.at$('j').map(s => s.T)));
  eq(r.exc, 0xFF, 'no exception in the clock program');
  check(r.cpu.cycles > 0, 'cpu.cycles counts');
}

// =====================================================================================
section = 'no trace';
{
  // The same program with and without a trace: the same clocks (the prefetcher and the pairing
  // work the same way in both paths).
  const L = [...CACHE_ON, 'mov cx, 30', 'l: mov ax, [0x100]', 'add bx, ax', 'mov [0x200], bx', 'push ax', 'pop dx', 'dec cx', 'jnz l', 'hlt'];
  const a = run(L, { trace: true }), b = run(L);
  eq(a.cpu.cycles, b.cpu.cycles, 'the clocks are the same with and without a trace');
  check(JSON.stringify(a.steps.map(s => s.T)) === JSON.stringify(b.steps.map(s => s.T)), 'each step gives the same clocks');
  eq(a.cpu.pipeStats.v, b.cpu.pipeStats.v, 'the same pairs');
}

console.log(`cpu586: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
