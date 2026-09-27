// Pentium Pro (P6) unit tests: CPUID, CMOVcc (16 conditions, the read of a memory operand when the
// condition is false), FCMOVcc, FCOMI / FCOMIP / FUCOMI / FUCOMIP, RDPMC and the P6 MSRs (the
// performance counters, MCA, the TSC), UD2, CR4.PGE / PCE, the µops of common instructions, the
// 4-1-1 decode rule, the out-of-order timing (a µop that waits for its operand, a younger µop that
// passes it, the retire order), the branch predictor (a pattern of the 2-level history, the penalty,
// the static prediction, the return stack buffer), the caches (L1 hit, L2 hit, L2 miss, write-back,
// write-allocate, cacheInvalidate on L1 and L2, CD), the same clocks with and without a trace, and
// no late fields. The protected-mode parts are in tests/pm686.test.mjs.
// Usage: node tests/cpu686.test.mjs [--verbose]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js',
  'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU80686 = vm.runInThisContext('CPU80686');
const CPU80586 = vm.runInThisContext('CPU80586');
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
// A bus with 16 MB of RAM, 1 wait state and a bus ratio of 3 (200 MHz core, 66 MHz FSB). All memory is
// cacheable (KEN#) except A0000h-BFFFFh.
const CODE = 0x10000, DATA = 0x20000;
function makeBus({ fpu = true, cacheable, ws = 1, ratio = 3, poke = true } = {}) {
  const mem = new Uint8Array(1 << 24);
  const bus = {
    mem, waitStates: ws, busRatio: ratio, io: [], pokes: 0,
    read8: a => mem[a & 0xFFFFFF], write8: (a, v) => { mem[a & 0xFFFFFF] = v; }, peek8: a => mem[a & 0xFFFFFF],
    in8: () => 0xFF, out8: (p, v) => { bus.io.push([p, v]); }, in16: () => 0xFFFF, out16: () => {},
    cacheable: cacheable || (pa => !(pa >= 0xA0000 && pa < 0xC0000)),
    fpu: null,
  };
  if (poke) bus.poke8 = (a, v) => { bus.pokes++; mem[a & 0xFFFFFF] = v; };
  if (fpu) bus.fpu = new FPU8087({ read8: bus.read8, write8: bus.write8 }, { model: '80387' });
  return bus;
}
// Each program starts at 1000:0000 in real mode (DS = ES = FS = GS = SS = 2000h, SP = FFF0h). The IVT
// sends the exceptions 0-17 to stubs that store the vector in excvec and halt.
const HEAD = ['cpu 686', 'bits 16', 'org 0', 'jmp start'];
for (let v = 0; v < 18; v++) HEAD.push(`exc${v}: mov byte [cs:excvec], ${v}`, 'hlt');
HEAD.push('excvec: db 0xFF', 'start:');
const CACHE_ON = ['mov eax, cr0', 'and eax, 0x9FFFFFFF', 'mov cr0, eax'];
function run(lines, { cpuClass = CPU80686, bus: busOpts, setup, pre, maxSteps = 200000, trace = false } = {}) {
  const a = Asm86.assemble([...HEAD, ...lines].join('\n'), { origin: 0, cpu: '686' });
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
    // the steps of the instruction at label k (in order)
    at$: k => steps.filter(s => s.ip === S(k)),
  };
}
function data(lines) { return ['hlt', 'align 16', ...lines]; }
const ev = (s, k) => s.ev.filter(e => e.k === k);
const one = (s, k) => s.ev.find(e => e.k === k);

// =====================================================================================
section = 'reset';
{
  const c = new CPU80686(makeBus());
  eq(c.regs32[2], 0x0619, 'EDX after reset = 0619h (family 6, model 1, stepping 9; the CPUID signature)');
  eq(c.cr[0], 0x60000010, 'CR0 after reset = 60000010h (CD = 1, NW = 1, ET = 1)');
  eq(c.cr[4], 0, 'CR4 after reset = 0');
  eq(c.eflags, 2, 'EFLAGS after reset = 2');
  check(c.dcache.sets === 128 && c.dcache.ways === 2 && c.dcache.lineSize === 32 && c.dcache.tag.length === 256, 'L1 data cache: 128 sets x 2 ways x 32 bytes (8 KB)');
  check(c.icache.sets === 64 && c.icache.ways === 4 && c.icache.lineSize === 32 && c.icache.tag.length === 256, 'L1 code cache: 64 sets x 4 ways x 32 bytes (8 KB)');
  check(c.l2.sets === 2048 && c.l2.ways === 4 && c.l2.lineSize === 32 && c.l2.tag.length === 8192, 'L2: 2048 sets x 4 ways x 32 bytes (256 KB)');
  check([c.dcache.tag, c.icache.tag, c.l2.tag].every(t => t.every(x => x === -1)), 'all lines of the three caches are invalid after reset');
  check(c.btb.tag.length === 512 && c.btb.sets === 128 && c.btb.ways === 4 && c.btb.tag.every(t => t === -1) && c.btb.pht.length === 8192 && c.btb.rsb.length === 16,
    'BTB: 512 entries (128 sets x 4 ways) with a 4-bit history and 16 counters each, a return stack buffer of 16');
  check(c.rob.size === 40 && c.rob.retire.length === 40 && c.rs.size === 20 && c.rat.rob.length === 18 && c.ports.uops.length === 5 && c.sb.size === 12,
    'the ROB (40), the RS (20), the RAT (18 registers), 5 ports, the store buffer (12)');
  check(c.rob.uop.every(x => x === -1) && c.rat.rob.every(x => x === -1), 'after reset: no µop in the ROB, the RAT maps all registers to the RRF');
  check(c.cache486 === null && c.queueSnoop === true, 'cache486 = null; queueSnoop = true');
}

// =====================================================================================
section = 'CPUID';
{
  const L = ['xor eax, eax', 'cpuid', 'mov [r0a], eax', 'mov [r0b], ebx', 'mov [r0d], edx', 'mov [r0c], ecx',
    'mov eax, 1', 'cpuid', 'mov [r1a], eax', 'mov [r1b], ebx', 'mov [r1c], ecx', 'mov [r1d], edx',
    'mov eax, 2', 'cpuid', 'mov [r2a], eax', 'mov [r2b], ebx', 'mov [r2c], ecx', 'mov [r2d], edx',
    'mov eax, 3', 'cpuid', 'mov [r3a], eax', 'mov [r3d], edx', 'hlt',
    ...data(['r0a: dd 0', 'r0b: dd 0', 'r0d: dd 0', 'r0c: dd 0', 'r1a: dd 0', 'r1b: dd 0', 'r1c: dd 0', 'r1d: dd 0',
      'r2a: dd 0', 'r2b: dd 0', 'r2c: dd 0', 'r2d: dd 0', 'r3a: dd 0', 'r3d: dd 0'])];
  const r = run(L);
  eq(r.d('r0a'), 2, 'CPUID 0: EAX = 2 (the highest leaf)');
  const vendor = Buffer.alloc(12);
  vendor.writeUInt32LE(r.d('r0b'), 0); vendor.writeUInt32LE(r.d('r0d'), 4); vendor.writeUInt32LE(r.d('r0c'), 8);
  check(vendor.toString('latin1') === 'GenuineIntel', 'CPUID 0: EBX EDX ECX = "GenuineIntel"', vendor.toString('latin1'));
  eq(r.d('r1a'), 0x0619, 'CPUID 1: EAX = 0619h');
  eq((r.d('r1a') >> 8) & 15, 6, 'CPUID 1: family 6');
  eq((r.d('r1a') >> 4) & 15, 1, 'CPUID 1: model 1 (Pentium Pro)');
  eq(r.d('r1a') & 15, 9, 'CPUID 1: stepping 9');
  eq(r.d('r1d'), 0xE1BD, 'CPUID 1: EDX = E1BDh');
  const f = r.d('r1d'), bits = { FPU: 0, DE: 2, PSE: 3, TSC: 4, MSR: 5, MCE: 7, CX8: 8, PGE: 13, MCA: 14, CMOV: 15 };
  for (const [k, b] of Object.entries(bits)) check((f >> b) & 1, `CPUID 1 EDX: ${k} (bit ${b}) = 1`);
  for (const [k, b] of Object.entries({ VME: 1, PAE: 6, APIC: 9, SEP: 11, MTRR: 12 })) check(!((f >> b) & 1), `CPUID 1 EDX: ${k} (bit ${b}) = 0 (not in the core)`);
  eq(r.d('r1b') | r.d('r1c'), 0, 'CPUID 1: EBX = ECX = 0');
  eq(r.d('r2a'), 0x03020101, 'CPUID 2: EAX = 03020101h (1 call; ITLB 4 KB, ITLB 4 MB, DTLB 4 KB)');
  eq(r.d('r2d'), 0x06040A42, 'CPUID 2: EDX = 06040A42h (L2 256 KB 4-way, L1 data 8 KB 2-way, DTLB 4 MB, L1 code 8 KB 4-way)');
  eq(r.d('r2b') | r.d('r2c'), 0, 'CPUID 2: EBX = ECX = 0');
  eq(r.d('r3a') | r.d('r3d'), 0, 'CPUID 3 (above the highest leaf): 0');
  eq(run(L, { bus: { fpu: false } }).d('r1d'), 0xE1BC, 'CPUID 1 without an FPU: EDX bit 0 = 0');
  const D = run(['mov eax, 1', 'cpuid', 'shr eax, 8', 'and eax, 15', 'mov [fam], eax', 'hlt', ...data(['fam: dd 0'])]);
  eq(D.d('fam'), 6, 'the detection code finds family 6 (a Pentium Pro)');
}

// =====================================================================================
section = 'CMOVcc';
{
  // All 16 conditions against a table of flag values (FLAGS from POPF). The result is the source
  // (2222h) when the condition is true, else the destination keeps 1111h.
  const FL = [0x0002, 0x0003, 0x0042, 0x0082, 0x0802, 0x0006, 0x0882, 0x0043, 0x0842, 0x08C7, 0x00C6];
  const CC = ['o', 'no', 'b', 'nb', 'z', 'nz', 'be', 'a', 's', 'ns', 'p', 'np', 'l', 'ge', 'le', 'g'];
  const cond = (c, f) => {
    const CF = f & 1, PF = (f >> 2) & 1, ZF = (f >> 6) & 1, SF = (f >> 7) & 1, OF = (f >> 11) & 1;
    const v = [OF, CF, ZF, CF | ZF, SF, PF, SF ^ OF, (SF ^ OF) | ZF][c >> 1];
    return c & 1 ? !v : !!v;
  };
  const L = [];
  let k = 0;
  for (let c = 0; c < 16; c++) for (const f of FL) {
    L.push(`push word 0x${f.toString(16)}`, 'popf', 'mov ax, 0x1111', 'mov bx, 0x2222', `cmov${CC[c]} ax, bx`, `mov [res + ${2 * k}], ax`);
    k++;
  }
  L.push('hlt', ...data([`res: times ${k} dw 0`]));
  const r = run(L);
  let bad = 0;
  k = 0;
  for (let c = 0; c < 16; c++) for (const f of FL) {
    const want = cond(c, f) ? 0x2222 : 0x1111, got = r.w('res', k);
    if (got !== want) { bad++; if (bad < 5) check(false, `cmov${CC[c]} with FLAGS ${hx(f, 4)}`, `got ${hx(got, 4)}, want ${hx(want, 4)}`); }
    k++;
  }
  check(bad === 0, `CMOVcc: all 16 conditions with ${FL.length} flag values (${16 * FL.length} cases)`);
  eq(r.exc, 0xFF, 'no exception');
  // 32 bits and memory operands
  const m = run(['mov eax, 0x12345678', 'mov ebx, 0x9ABCDEF0', 'xor cx, cx', 'cmovz eax, ebx', 'mov [a1], eax',
    'mov eax, 0x12345678', 'cmovnz eax, ebx', 'mov [a2], eax', 'mov bx, val', 'mov dx, 0x5555', 'cmp ax, ax', 'cmove dx, [bx]', 'mov [a3], dx',
    'mov dx, 0x5555', 'cmovne dx, [bx]', 'mov [a4], dx', 'hlt', ...data(['a1: dd 0', 'a2: dd 0', 'a3: dd 0', 'a4: dd 0', 'val: dw 0x7777'])]);
  eq(m.d('a1'), 0x9ABCDEF0, 'cmovz eax, ebx (ZF = 1): EAX = EBX');
  eq(m.d('a2'), 0x12345678, 'cmovnz eax, ebx (ZF = 1): EAX keeps its 32 bits');
  eq(m.d('a3') & 0xFFFF, 0x7777, 'cmove dx, [bx] (true): DX = the word in memory');
  eq(m.d('a4') & 0xFFFF, 0x5555, 'cmovne dx, [bx] (false): DX does not change');
  // the memory operand is read also when the condition is false: a word at offset FFFFh gives #GP
  const g = run(['mov bx, 0xFFFF', 'cmp ax, ax', 'cmovne ax, [bx]', 'hlt']);
  eq(g.exc, 13, 'cmovne ax, [0FFFFh] with a false condition: #GP (the P6 reads the operand)');
  const t = run(['mov bx, val', 'cmp ax, ax', 'x: cmovne ax, [bx]', 'hlt', ...data(['val: dw 1'])], { trace: true });
  const xs = t.at$('x')[0];
  check(ev(xs, 'uop').some(e => e.kind === 'load') && ev(xs, 'bus').length + ev(xs, 'cache').length > 0, 'a false CMOV with a memory operand makes a load µop and a data access');
  eq(run(['lock cmovz ax, bx', 'hlt'].map(l => l.replace('lock cmovz ax, bx', 'db 0xF0, 0x0F, 0x44, 0xC3'))).exc, 6, 'LOCK CMOVcc: #UD');
  eq(run(['db 0x0F, 0x44, 0xC3', 'hlt'], { cpuClass: CPU80586 }).exc, 6, 'CMOVcc on the Pentium (P5): #UD');
}

// =====================================================================================
section = 'FCMOVcc';
{
  // ST1 = 2, ST0 = 1; FLAGS from POPF; FCMOVcc ST0, ST1; then FSTP gives ST0.
  const cases = [['fcmovb', 0x0003, 2], ['fcmovb', 0x0002, 1], ['fcmove', 0x0042, 2], ['fcmove', 0x0002, 1], ['fcmovbe', 0x0042, 2], ['fcmovbe', 0x0003, 2],
    ['fcmovbe', 0x0002, 1], ['fcmovu', 0x0006, 2], ['fcmovu', 0x0002, 1], ['fcmovnb', 0x0002, 2], ['fcmovnb', 0x0003, 1], ['fcmovne', 0x0002, 2],
    ['fcmovne', 0x0042, 1], ['fcmovnbe', 0x0002, 2], ['fcmovnbe', 0x0042, 1], ['fcmovnbe', 0x0003, 1], ['fcmovnu', 0x0002, 2], ['fcmovnu', 0x0006, 1]];
  const L = ['fninit'];
  cases.forEach(([mn, f], i) => L.push('fld1', 'fld1', 'fadd st0, st0', 'fld1', `push word 0x${f.toString(16)}`, 'popf', `${mn} st0, st1`, `fstp dword [res + ${4 * i}]`, 'fstp st0', 'fstp st0'));
  L.push('fnstsw ax', 'mov [sw], ax', 'hlt', ...data([`res: times ${cases.length} dd 0`, 'sw: dw 0']));
  const r = run(L);
  cases.forEach(([mn, f, want], i) => {
    const got = Buffer.from(r.mem.subarray(DATA + r.S('res') + 4 * i, DATA + r.S('res') + 4 * i + 4)).readFloatLE(0);
    check(got === want, `${mn} st0, st1 with FLAGS ${hx(f, 4)}: ST0 = ${want}`, got);
  });
  eq(r.w('sw') & 0x3F, 0, 'no FPU exception');
  // an empty ST(i): stack underflow, ST0 = indefinite (IE masked)
  const u = run(['fninit', 'fld1', 'stc', 'fcmovb st0, st5', 'fstp qword [q]', 'fnstsw ax', 'mov [sw], ax', 'hlt', ...data(['q: dq 0', 'sw: dw 0'])]);
  eq(u.w('sw') & 0x41, 0x41, 'FCMOVB with an empty ST5: IE and SF (stack underflow)');
  check(Buffer.from(u.mem.subarray(DATA + u.S('q'), DATA + u.S('q') + 8)).toString('hex') === '000000000000f8ff', 'the masked response: ST0 = the indefinite NaN');
}

// =====================================================================================
section = 'FCOMI / FCOMIP / FUCOMI / FUCOMIP';
{
  // ST0 = a, ST1 = b. FLAGS before = 0891h (OF, SF, AF, CF set) + ZF / PF clear. The flags after: ZF, PF, CF.
  const cmp = (mn, a, b) => run(['fninit', `fld dword [vb]`, `fld dword [va]`, 'fnclex', 'push word 0x0891', 'popf', 'fldz', 'ftst', 'fstp st0', `${mn} st0, st1`,
    'pushf', 'pop word [fl]', 'fnstsw ax', 'mov [sw], ax', 'hlt', ...data([`va: dd ${a}`, `vb: dd ${b}`, 'fl: dw 0', 'sw: dw 0'])]);
  const NAN = '0x7FC00000';
  for (const [a, b, zpc, name] of [['2.0', '1.0', 0, 'greater'], ['1.0', '2.0', 1, 'less'], ['1.5', '1.5', 0x40, 'equal'], [NAN, '1.0', 0x45, 'unordered']]) {
    for (const mn of ['fcomi', 'fucomi']) {
      const r = cmp(mn, a, b), fl = r.w('fl'), sw = r.w('sw');
      eq(fl & 0x45, zpc, `${mn} ${name}: ZF PF CF = ${(zpc >> 6) & 1}${(zpc >> 2) & 1}${zpc & 1}`);
      eq(fl & 0x890, 0, `${mn} ${name}: OF, SF and AF are 0`);
      eq(sw & 0x4000, 0x4000, `${mn} ${name}: C3 (set by FTST before) does not change`);
      eq(sw & 0x200, 0, `${mn} ${name}: C1 = 0`);
      if (name === 'unordered') eq(sw & 1, mn === 'fcomi' ? 1 : 0, `${mn} with a QNaN: IE = ${mn === 'fcomi' ? 1 : 0} (FUCOMI signals only for an SNaN)`);
      else eq(sw & 1, 0, `${mn} ${name}: no IE`);
    }
  }
  // an 80-bit SNaN (FLD m80 loads it with no exception): exponent 7FFFh, significand 8000000000000001h
  const sn = run(['fninit', 'fld1', 'fld tword [va]', 'fnstsw ax', 'mov [s0], ax', 'fucomi st0, st1', 'pushf', 'pop word [fl]', 'fnstsw ax', 'mov [sw], ax', 'hlt',
    ...data(['va: db 1, 0, 0, 0, 0, 0, 0, 0x80, 0xFF, 0x7F', 's0: dw 0', 'fl: dw 0', 'sw: dw 0'])]);
  eq(sn.w('s0') & 1, 0, 'FLD m80 of a signaling NaN: no exception');
  eq(sn.w('sw') & 1, 1, 'fucomi with a signaling NaN: IE = 1');
  eq(sn.w('fl') & 0x45, 0x45, 'fucomi with a signaling NaN (IE masked): unordered');
  // FCOMIP / FUCOMIP pop: TOP goes up by one
  const p = run(['fninit', 'fld1', 'fldz', 'fnstsw ax', 'mov [s0], ax', 'fcomip st0, st1', 'fnstsw ax', 'mov [s1], ax', 'fucomip st0, st0', 'fnstsw ax', 'mov [s2], ax',
    'pushf', 'pop word [fl]', 'hlt', ...data(['s0: dw 0', 's1: dw 0', 's2: dw 0', 'fl: dw 0'])]);
  eq((((p.w('s1') >> 11) & 7) - ((p.w('s0') >> 11) & 7)) & 7, 1, 'FCOMIP pops: TOP + 1');
  eq((((p.w('s2') >> 11) & 7) - ((p.w('s1') >> 11) & 7)) & 7, 1, 'FUCOMIP pops: TOP + 1');
  eq(p.w('fl') & 0x45, 0x40, 'FUCOMIP ST0, ST0: equal (ZF = 1)');
  // an empty register: stack underflow, the flags show "unordered"
  const e = run(['fninit', 'fld1', 'fcomi st0, st3', 'pushf', 'pop word [fl]', 'fnstsw ax', 'mov [sw], ax', 'hlt', ...data(['fl: dw 0', 'sw: dw 0'])]);
  eq(e.w('fl') & 0x45, 0x45, 'FCOMI with an empty ST3: ZF PF CF = 111 (unordered)');
  eq(e.w('sw') & 0x41, 0x41, 'FCOMI with an empty ST3: IE and SF (stack underflow)');
  // unmasked IE: no flags, no pop
  const x = run(['fninit', 'fldcw [cw]', 'fld dword [vn]', 'fld1', 'fnstsw ax', 'mov [s0], ax', 'push word 0x0002', 'popf', 'fcomip st0, st1', 'pushf', 'pop word [fl]',
    'fnstsw ax', 'mov [s1], ax', 'hlt', ...data(['cw: dw 0x037E', `vn: dd ${NAN}`, 's0: dw 0', 's1: dw 0', 'fl: dw 0'])]);
  eq(x.w('fl') & 0x45, 0, 'FCOMIP with an unmasked IE: the flags do not change');
  eq((x.w('s1') >> 11) & 7, (x.w('s0') >> 11) & 7, 'FCOMIP with an unmasked IE: no pop');
  eq(x.w('s1') & 0x81, 0x81, 'FCOMIP with an unmasked IE: IE and ES');
}

// =====================================================================================
section = 'UD2, CR4';
{
  eq(run(['ud2', 'hlt']).exc, 6, 'UD2 (0F 0B): #UD');
  const t = run(['x: ud2', 'hlt'], { trace: true });
  check(t.at$('x')[0].ev.some(e => e.k === 'int' && e.vec === 6), "UD2: the trace shows the 'int' event of #UD");
  const r = run(['mov eax, 0x1DC', 'mov cr4, eax', 'mov eax, cr4', 'mov [c1], eax', 'hlt', ...data(['c1: dd 0'])], { trace: true });
  eq(r.d('c1'), 0x1DC, 'CR4 keeps TSD, DE, PSE, MCE, PGE (bit 7) and PCE (bit 8)');
  for (const [v, why] of [[1, 'VME'], [2, 'PVI'], [0x20, 'PAE (not in the core)'], [0x200, 'bit 9'], [0x400, 'bit 10']]) {
    eq(run([`mov eax, ${v}`, 'mov cr4, eax', 'hlt']).exc, 13, `MOV CR4 with ${why}: #GP(0)`);
  }
  check(r.steps.some(s => s.ev.some(e => e.k === 'sys' && e.op === 'CR4' && /PGE PCE/.test(e.text))), "trace: the 'sys' CR4 event names PGE and PCE");
}

// =====================================================================================
section = 'MSRs, RDPMC';
{
  const r = run([
    // counter 0: INST_RETIRED (C0h), counter 1: UOPS_RETIRED (C2h); EN in PerfEvtSel0, USR + OS in both
    'mov ecx, 0xC1', 'xor eax, eax', 'xor edx, edx', 'wrmsr', 'mov ecx, 0xC2', 'wrmsr',
    'mov ecx, 0x187', 'mov eax, 0x0300C2', 'wrmsr', 'mov ecx, 0x186', 'mov eax, 0x4300C0', 'wrmsr',
    'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop',
    'xor ecx, ecx', 'rdpmc', 'mov [c0], eax', 'mov [c0h], edx', 'mov ecx, 1', 'rdpmc', 'mov [c1], eax',
    'mov ecx, 0x186', 'rdmsr', 'mov [sel0], eax', 'mov ecx, 0x187', 'mov eax, 0x7FFFFF', 'wrmsr', 'rdmsr', 'mov [sel1], eax',
    'mov ecx, 0x186', 'xor eax, eax', 'wrmsr',
    'mov ecx, 0xC1', 'mov eax, 0x80000000', 'xor edx, edx', 'wrmsr', 'rdmsr', 'mov [w0], eax', 'mov [w0h], edx',
    'mov ecx, 0x179', 'rdmsr', 'mov [mcg], eax', 'mov ecx, 0x400', 'mov eax, 0xFFFFFFFF', 'mov edx, eax', 'wrmsr', 'rdmsr', 'mov [mc0], eax', 'mov [mc0h], edx',
    'mov ecx, 0x401', 'rdmsr', 'mov [st0], eax', 'xor eax, eax', 'xor edx, edx', 'wrmsr',
    'mov ecx, 0x8B', 'rdmsr', 'mov [sig], edx',
    'mov ecx, 0x10', 'xor eax, eax', 'mov edx, 1', 'wrmsr', 'rdtsc', 'mov [tsch], edx',
    'mov ecx, 2', 'rdpmc', 'hlt',
    ...data(['c0: dd 0', 'c0h: dd 0xFF', 'c1: dd 0', 'sel0: dd 0', 'sel1: dd 0', 'w0: dd 0', 'w0h: dd 0', 'mcg: dd 0', 'mc0: dd 0', 'mc0h: dd 0',
      'st0: dd 0xFF', 'sig: dd 0xFF', 'tsch: dd 0xFF'])]);
  eq(r.d('c0'), 12, 'RDPMC 0 (INST_RETIRED): the WRMSR that starts the counters, 10 NOP and XOR ECX (12)');
  eq(r.d('c0h'), 0, 'RDPMC: EDX = bits 32-39 of the counter (0)');
  // the WRMSR that starts the counters (24 µops), 10 NOP, XOR ECX (1), the first RDPMC (20), two MOV to
  // memory (2 + 2) and MOV ECX (1)
  eq(r.d('c1'), 24 + 10 + 1 + 20 + 4 + 1, 'RDPMC 1 (UOPS_RETIRED): the µops of the instructions from the WRMSR on');
  eq(r.d('sel0'), 0x4300C0, 'PerfEvtSel0 (186h) reads back');
  eq(r.d('sel1'), 0x1FFFFF, 'PerfEvtSel1: 7FFFFFh reads 1FFFFFh (bit 21 is reserved, EN (bit 22) is only in PerfEvtSel0)');
  eq(r.d('w0'), 0x80000000, 'WRMSR C1h, then RDMSR: the low 32 bits');
  eq(r.d('w0h'), 0xFF, 'WRMSR C1h: bits 32-39 = bit 31 (sign extension to 40 bits)');
  eq(r.d('mcg'), 0x105, 'MCG_CAP (179h) = 105h: 5 banks, MCG_CTL present');
  check(r.d('mc0') === 0xFFFFFFFF && r.d('mc0h') === 0xFFFFFFFF, 'MC0_CTL (400h) reads back');
  eq(r.d('st0'), 0, 'MC0_STATUS (401h) = 0: no machine check occurs');
  eq(r.d('sig'), 0, 'BIOS_SIGN (8Bh): EDX = the microcode revision (0)');
  eq(r.d('tsch'), 0, 'WRMSR 10h (TSC) writes the low 32 bits: the high 32 bits become 0 (P6)');
  eq(r.exc, 13, 'RDPMC with ECX = 2: #GP(0)');
  for (const [msr, why] of [[0x11, 'the P5 CESR'], [0x0E, 'the P5 TR12'], [0x1B, 'APIC_BASE (no local APIC)'], [0x403, 'MC0_MISC'], [0x200, 'an MTRR (not in the core)']]) {
    eq(run([`mov ecx, 0x${msr.toString(16)}`, 'rdmsr', 'hlt']).exc, 13, `RDMSR ${hx(msr, 3)}h (${why}): #GP(0)`);
  }
  eq(run(['mov ecx, 0x401', 'mov eax, 1', 'xor edx, edx', 'wrmsr', 'hlt']).exc, 13, 'WRMSR MC0_STATUS with a value that is not 0: #GP(0)');
  eq(run(['db 0x0F, 0x33', 'hlt'], { cpuClass: CPU80586 }).exc, 6, 'RDPMC on the Pentium (P5): #UD');
  // CPU_CLK_UNHALTED (79h) follows the clocks of the steps
  const k = run(['mov ecx, 0xC1', 'xor eax, eax', 'xor edx, edx', 'wrmsr', 'mov ecx, 0x186', 'mov eax, 0x430079', 'wrmsr', 'xor ecx, ecx', 't0: rdpmc', 'mov ebx, eax',
    'mov cx, 20', 'l: loop l', 'xor ecx, ecx', 't1: rdpmc', 'sub eax, ebx', 'mov [dc], eax', 'hlt', ...data(['dc: dd 0'])]);
  const i0 = k.steps.findIndex(s => s.ip === k.S('t0')), i1 = k.steps.findIndex(s => s.ip === k.S('t1'));
  eq(k.d('dc'), k.steps.slice(i0, i1).reduce((a, s) => a + s.T, 0), 'CPU_CLK_UNHALTED: the difference of two RDPMC = the clocks of the steps between them');
}

// =====================================================================================
section = 'µops and the decoders';
{
  // The code runs twice (the second pass: code in the cache, the BTB knows the loop).
  const table = [
    ['mov ax, bx', 1, 'D'], ['mov ax, [bx]', 1, 'D'], ['mov [bx], ax', 2, 'D0'], ['add ax, bx', 1, 'D'], ['add ax, [bx]', 2, 'D0'],
    ['add [bx], ax', 4, 'D0'], ['adc ax, bx', 2, 'D0'], ['push ax', 3, 'D0'], ['pop ax', 2, 'D0'], ['lea si, [bx+di+4]', 1, 'D'],
    ['inc word [bx]', 4, 'D0'], ['xchg ax, cx', 3, 'D0'], ['movzx ax, bl', 1, 'D'], ['imul ax, cx', 1, 'D'], ['mul cx', 3, 'D0'],
    ['div cx', 4, 'D0'], ['cmovz ax, cx', 2, 'D0'], ['cmovz ax, [bx]', 3, 'D0'], ['nop', 1, 'D'], ['shl ax, 3', 1, 'D'], ['cpuid', 36, 'MS'],
    ['rdtsc', 15, 'MS'], ['cld', 4, 'D0'], ['pushf', 13, 'MS'],
  ];
  const r = run([...CACHE_ON, 'mov bx, buf', 'mov cx, 3', 'mov dx, 0', 'mov bp, 2', 'l:', ...table.map(([ins], i) => `i${i}: ${ins}`), 'popf', 'mov cx, 3', 'mov dx, 0',
    'dec bp', 'jnz l', 'hlt', ...data(['buf: dw 5, 6'])], { trace: true });
  table.forEach(([ins, n, dec], i) => {
    const s = r.at$('i' + i).pop(), d = one(s, 'decode'), u = ev(s, 'uop');
    check(u.length === n && d.uops === n, `${ins}: ${n} µop${n > 1 ? 's' : ''}`, () => `${u.length} µops (${u.map(e => e.kind).join(' ')})`);
    check(dec === 'D' ? /^D[012]$/.test(d.decoder) : d.decoder === dec, `${ins}: decoder ${dec === 'D' ? 'D0, D1 or D2' : dec}`, d.decoder);
  });
  const k = r.at$('i5').pop();
  check(JSON.stringify(ev(k, 'uop').map(e => e.kind)) === '["load","alu","sta","std"]' && JSON.stringify(ev(k, 'uop').map(e => e.port)) !== '', 'add [bx], ax: load (port 2), ALU (port 0 or 1), STA (port 3), STD (port 4)');
  check(ev(k, 'uop').map(e => e.port).join() === `2,${ev(k, 'uop')[1].port},3,4` && ev(k, 'uop')[1].port <= 1, 'the ports of add [bx], ax: 2, 0 or 1, 3, 4', () => ev(k, 'uop').map(e => e.port).join());
  const p = ev(r.at$('i7').pop(), 'uop');
  check(p.map(e => e.kind).join() === 'esp,sta,std', 'push ax: the ESP µop, STA, STD', () => p.map(e => e.kind).join());
  const dv = ev(r.at$('i15').pop(), 'uop').find(e => e.kind === 'div');
  const du = ev(r.at$('i15').pop(), 'uop');
  check(dv && dv.port === 0 && dv.lat === 20 && du[3].done - du[0].dispatch >= 23, 'div cx: 23 clocks in all (16 bits): 3 µops, then the divide µop on port 0 (20 clocks)', () => JSON.stringify(dv));
}

// =====================================================================================
section = '4-1-1 decode';
{
  // Each case: the loop runs twice; in the second pass the group starts after the taken JNZ.
  const group = (lines) => {
    const r = run([...CACHE_ON, 'mov bx, buf', 'mov bp, 2', 'l:', ...lines.map((x, i) => `g${i}: ${x}`), 'dec bp', 'jnz l', 'hlt', ...data(['buf: dw 1, 2'])], { trace: true });
    return lines.map((_, i) => one(r.at$('g' + i).pop(), 'decode'));
  };
  const a = group(['add ax, [bx]', 'mov cx, dx', 'mov si, di', 'mov di, si']);
  check(a[0].decoder === 'D0' && a[1].decoder === 'D1' && a[2].decoder === 'D2' && a[0].dclk === a[1].dclk && a[1].dclk === a[2].dclk,
    '4-1-1: a 2-µop instruction in D0 and two 1-µop instructions in D1 and D2 decode in one clock', () => JSON.stringify(a.map(d => [d.decoder, d.dclk])));
  check(a[3].decoder === 'D0' && a[3].dclk === a[0].dclk + 1, 'a fourth instruction goes to D0 in the next clock');
  const b = group(['mov cx, dx', 'add ax, [bx]', 'mov si, di']);
  check(b[0].decoder === 'D0' && b[1].decoder === 'D0' && b[1].dclk === b[0].dclk + 1 && b[2].decoder === 'D1' && b[2].dclk === b[1].dclk,
    '4-1-1: a 2-µop instruction after a 1-µop one waits for D0 in the next clock', () => JSON.stringify(b.map(d => [d.decoder, d.dclk])));
  const c = group(['add ax, [bx]', 'add cx, [bx]', 'add dx, [bx]']);
  check(c[1].dclk === c[0].dclk + 1 && c[2].dclk === c[1].dclk + 1 && c.every(d => d.decoder === 'D0'), 'three 2-µop instructions: three clocks (only D0 takes them)',
    () => JSON.stringify(c.map(d => [d.decoder, d.dclk])));
  const d = group(['nop', 'cpuid', 'nop']);
  check(d[1].decoder === 'MS' && d[1].dclk > d[0].dclk && d[2].dclk >= d[1].dclk + 9, 'CPUID (36 µops) goes through the MSROM (4 µops each clock); the next instruction waits',
    () => JSON.stringify(d.map(x => [x.decoder, x.dclk])));
}

// =====================================================================================
section = 'out-of-order timing';
{
  // A 32-bit DIV (39 clocks on the divider), then an ADD that needs its result and an ADD that does not.
  const r = run([...CACHE_ON, 'mov bp, 2', 'p: cpuid', 'mov ebx, 3', 'mov eax, 100', 'xor edx, edx', 'dv: div ebx', 'dep: add eax, 1', 'ind: add ecx, 1', 'ind2: add esi, 1',
    'dec bp', 'jnz p', 'hlt'], { trace: true });
  const U = k => ev(r.at$(k).pop(), 'uop');
  const d = U('dv').find(e => e.kind === 'div'), a = U('dep')[0], b = U('ind')[0], c = U('ind2')[0];
  const dd = U('dv');
  eq(d.done - d.dispatch, 36, 'div ebx: the divide µop takes 36 clocks');
  eq(d.done - dd[0].dispatch, 39, 'div ebx: 39 clocks from the first µop to the result');
  check(a.dispatch >= d.done && a.wait === 'operand', 'add eax, 1 waits in the RS for the result of the DIV (wait: operand)', () => JSON.stringify(a));
  check(b.dispatch < d.done && b.done < d.done, 'add ecx, 1 (independent) executes before the DIV is done', () => JSON.stringify(b));
  check(b.passed >= 1 && c.passed >= 1, 'the independent µops pass the older µop that waits (passed >= 1)', () => `${b.passed} ${c.passed}`);
  check(b.retire >= a.retire && c.retire >= b.retire && a.retire >= d.retire, 'the retire order is the program order', () => [d.retire, a.retire, b.retire, c.retire].join());
  // the ROB: the retire clocks of all µops go up, at most 3 in a clock
  const all = r.steps.flatMap(s => ev(s, 'uop')).sort((x, y) => x.id - y.id);
  let ordered = true, max3 = true;
  for (let i = 1; i < all.length; i++) if (all[i].retire < all[i - 1].retire) ordered = false;
  const per = new Map();
  for (const e of all) per.set(e.retire, (per.get(e.retire) || 0) + 1);
  for (const n of per.values()) if (n > 3) max3 = false;
  check(ordered && max3, 'all µops retire in program order, at most 3 in a clock');
  check(all.every(e => e.issue < e.dispatch && e.dispatch < e.done + (e.lat === 0 ? 1 : 0) && e.done < e.retire), 'each µop: issue < dispatch <= done < retire');
  // the model times: 10 independent ADDs retire soon after the DIV; 10 dependent ADDs one after the other
  const tail = (ind) => {
    const body = [];
    for (let i = 0; i < 10; i++) body.push(ind ? `add ${['ecx', 'esi', 'edi', 'ebp'][i % 4]}, 1` : 'add eax, 1');
    const t = run([...CACHE_ON, 'mov bp, 2', 'p: cpuid', 'mov ebx, 3', 'mov eax, 100', 'xor edx, edx', 'dv: div ebx', ...body, 'last: nop', 'dec bp', 'jnz p', 'hlt'], { trace: true });
    return one(t.at$('last').pop(), 'rob').retire - one(t.at$('dv').pop(), 'rob').retire;
  };
  const ti = tail(true), td = tail(false);
  check(ti <= 6 && td >= 10, 'after the DIV retires: 10 independent ADDs retire in about 4 clocks (3 each clock), 10 dependent ADDs need about 10', () => `${ti} ${td}`);
  // the RAT event: the reads and writes of an instruction
  const ra = one(r.at$('dep').pop(), 'rat');
  check(ra && ra.reads.some(x => x.r === 'EAX' && x.rob >= 0) && ra.writes.some(x => x.r === 'EAX' && x.rob === a.rob) && ra.writes.some(x => x.r === 'EFLAGS'),
    "the 'rat' event: add eax, 1 reads EAX from the ROB entry of the DIV, and maps EAX and EFLAGS to its own ROB entry", () => JSON.stringify(ra));
  const rb = one(r.at$('dep').pop(), 'rob');
  check(rb && rb.uops === 1 && rb.rob >= 1 && rb.retire === a.retire, "the 'rob' event: the µops, the ROB occupancy, the retire clock", () => JSON.stringify(rb));
  // store forwarding: a load of the bytes of an older store gets the data of the STD; a load of
  // more bytes than the store has waits until the store is in the cache
  const f = run([...CACHE_ON, 'mov bx, buf', 'mov ax, [bx]', 'cpuid', 'mov ebx, 3', 'mov eax, 9', 'xor edx, edx', 'div ebx', 'mov bx, buf', 's1: mov [bx], ax', 'l1: mov cx, [bx]',
    's2: mov [bx], al', 'l2: mov dx, [bx]', 'hlt', ...data(['buf: dw 0x1234'])], { trace: true });
  const std1 = ev(f.at$('s1')[0], 'uop').find(e => e.kind === 'std'), ld1 = ev(f.at$('l1')[0], 'uop')[0];
  check(ld1.src.includes(std1.rob) && ld1.wait === 'store data' && ld1.dispatch >= std1.done, 'a load of the bytes of an older store: the STD gives the data (wait: store data)',
    () => JSON.stringify([std1, ld1]));
  const st2 = one(f.at$('s2')[0], 'rob'), ld2 = ev(f.at$('l2')[0], 'uop')[0];
  check(ld2.wait === 'store buffer' && ld2.dispatch > st2.retire, 'a word load over a byte store: the load waits until the store is in the cache (after its retire)', () => JSON.stringify(ld2));
  check(f.cpu.oooStats.forwards >= 1 && f.cpu.oooStats.ldBlocks >= 1, 'oooStats.forwards and oooStats.ldBlocks count them');
}

// =====================================================================================
section = 'the clock rule';
{
  const r = run([...CACHE_ON, 'mov cx, 30', 'l: add ax, bx', 'inc si', 'dec cx', 'jnz l', 'mov ebx, 3', 'mov eax, 9', 'xor edx, edx', 'div ebx', 'div ebx', 'hlt'], { trace: true });
  check(r.steps.every(s => s.T >= 1), 'each step takes 1 clock or more');
  const robs = r.steps.map(s => one(s, 'rob')).filter(Boolean);
  let sum = 0, ok = true;
  for (let i = 0; i < r.steps.length; i++) {
    sum += r.steps[i].T;
    const rb = one(r.steps[i], 'rob');
    if (rb && sum !== Math.max(rb.retire, sum) ) ok = false;
    if (rb && rb.debt !== sum - rb.retire) ok = false;
  }
  check(ok, 'the sum of the steps S(n) = max(S(n-1) + 1, the retire clock); debt = S(n) - the retire clock');
  check(r.cpu.oooStats.floor > 0 && robs.some(e => e.debt > 0), 'the loop retires more than one instruction in a clock: the floor adds clocks (oooStats.floor, debt > 0)');
  check(robs[robs.length - 2].debt === 0, 'the slow DIV takes the extra clocks back (debt 0 after it)', () => robs.slice(-3).map(e => e.debt).join());
  // clocks that the machine adds to cpu.cycles (the wait-loop skip, DMA): the model moves with them
  const ext = (jump) => {
    const bus = makeBus();
    const a = Asm86.assemble(['cpu 686', ...CACHE_ON, 'mov ebx, 3', 'mov eax, 9', 'xor edx, edx', 'mov cx, 40', 'l: dec cx', 'jnz l', 'd: div ebx', 'hlt'].join('\n'), { origin: 0, cpu: '686' });
    bus.mem.set(a.bytes, CODE);
    const cpu = new CPU80686(bus);
    for (let i = 0; i < 6; i++) cpu.loadSeg(i, i === 1 ? 0x1000 : 0x2000);
    cpu.ip = 0; cpu.flush();
    while (cpu.ip !== a.symbols.d) cpu.step();
    cpu.cycles += jump;
    cpu.trace = [];
    cpu.step();
    const rb = cpu.trace.find(e => e.k === 'rob');
    cpu.trace = null;
    return rb.debt;
  };
  const d0 = ext(0), d1 = ext(5000);
  check(d0 === 0 && d1 === 0, 'after 5000 clocks that the machine adds (as a wait-loop skip does), the model moves with them: no debt of 5000 clocks', () => `${d0} ${d1}`);
}

// =====================================================================================
section = 'branch prediction';
{
  // An inner loop of 3 passes in an outer loop of 40: the inner JNZ gives the pattern T T N. The 4-bit
  // history of its BTB entry learns it: after a few outer passes, no more wrong predictions.
  const r = run([...CACHE_ON, 'mov bp, 40', 'o: mov cx, 3', 'i: dec cx', 'j: jnz i', 'dec bp', 'jnz o', 'hlt'], { trace: true });
  const js = r.at$('j').map(s => one(s, 'btb'));
  eq(js.length, 120, 'the inner JNZ runs 120 times');
  const late = js.slice(60);
  check(late.every(b => b.right), 'the 2-level predictor learns T T N: the last 60 predictions are all right', () => late.filter(b => !b.right).length + ' wrong');
  check(late.some(b => !b.taken && b.predicted === false && b.history >= 0), 'it predicts the not-taken branch of the pattern by the history');
  check(js[0].how === 'static' && js[0].taken && js[0].right && js[0].alloc && js[0].penalty === 5, 'the first backward JNZ: no BTB entry, the static prediction (taken) is right, 5 clocks (the decoder)',
    () => JSON.stringify(js[0]));
  const w = js.filter(b => !b.right);
  check(w.length > 0 && w.every(b => b.penalty >= 10 && b.penalty <= 16), 'a wrong prediction costs 10-16 clocks (from the decode to the fetch again)', () => w.map(b => b.penalty).join());
  const st = r.cpu.btb.stats;
  check(st.branches === 161 && st.wrong === st.branches - st.right && st.allocs === 3, 'btb.stats: 161 branches (the inner and outer JNZ, the JMP at the start), 3 new entries', () => JSON.stringify(st));
  // the penalty in the model: a wrong prediction delays the next instructions
  const cost = (t) => {
    const x = run([...CACHE_ON, `mov ax, ${t}`, 'cmp ax, 1', 'b: je fwd', 'nop', 'fwd: nop', 'n: nop', 'hlt'], { trace: true });
    return one(x.at$('n')[0], 'rob').retire - one(x.at$('b')[0], 'rob').retire;
  };
  const right = cost(0), wrong = cost(1);
  check(wrong - right >= 9 && wrong - right <= 16, 'a forward JE: not taken (the static prediction is right) vs taken (wrong): 9-16 clocks more', () => `${right} ${wrong}`);
  // the return stack buffer
  const c = run([...CACHE_ON, 'mov cx, 5', 'l: call f', 'loop l', 'hlt', 'f: ret'], { trace: true });
  const rets = c.steps.filter(s => s.ip === c.S('f')).map(s => one(s, 'btb'));
  check(rets.length === 5 && rets.every(b => b.kind === 'ret' && b.how === 'rsb' && b.right), 'RET: the return stack buffer predicts the 5 returns', () => JSON.stringify(rets[0]));
  eq(c.cpu.btb.stats.rsbRight, 5, 'btb.stats.rsbRight = 5');
}

// =====================================================================================
section = 'caches';
{
  // latencies of the load µop: L1 hit 3, L2 hit 3 + 4, L2 miss 3 + 4 + FSB (ratio 3, 1 wait state:
  // 3 x (2 request/snoop + 3) = 15)
  const A = 0x400, B = 0x1400, Cc = 0x2400;       // three lines of one L1 set (the L1 has 2 ways)
  const r = run([...CACHE_ON, 'mov bp, 2', 'xor si, si', 'p: cpuid', `m1: mov eax, [si + ${A}]`, `h1: mov ebx, [si + ${A}]`, `mov eax, [si + ${B}]`, `mov eax, [si + ${Cc}]`,
    'cpuid', `l2: mov eax, [si + ${A}]`, 'add si, 0x4000', 'dec bp', 'jnz p', 'hlt'], { trace: true });
  const lat = k => { const u = ev(r.at$(k).pop(), 'uop').find(e => e.kind === 'load'); return u.done - u.dispatch; };
  eq(lat('h1'), 3, 'an L1 hit: the load takes 3 clocks');
  eq(lat('l2'), 7, 'an L1 miss that hits the L2: 3 + 4 clocks');
  eq(lat('m1'), 22, 'an L2 miss: 3 + 4 + 15 clocks (the FSB at 1/3 of the core clock)');
  const cm = ev(r.at$('m1').pop(), 'cache'), cl = ev(r.at$('l2').pop(), 'cache');
  check(cm.some(e => e.level === 'L1' && !e.hit && e.fill) && cm.some(e => e.level === 'L2' && !e.hit && e.fill), "an L2 miss: 'cache' events of level L1 (miss, fill) and L2 (miss, fill)", () => JSON.stringify(cm));
  check(cl.some(e => e.level === 'L2' && e.hit), "an L2 hit: a 'cache' event of level L2 with hit: true", () => JSON.stringify(cl));
  const burst = ev(r.at$('m1').pop(), 'bus').filter(e => e.burst);
  check(burst.length === 4 && burst.every(e => e.width === 8) && burst[0].len === 9 && burst[1].len === 6, 'an L2 miss: a burst of 4 x 8 bytes on the FSB (3 x 3 clocks, then 3 x 2)', () => JSON.stringify(burst.map(e => e.len)));
  check(ev(r.at$('l2').pop(), 'bus').length === 0, 'an L2 hit makes no FSB cycle');
  // write-allocate, write-back into the L2, WBINVD
  const w = run([...CACHE_ON, `wa: mov dword [${A}], 0x11111111`, `mov eax, [${B}]`, `mov eax, [${Cc}]`, 'wb: wbinvd', 'hlt'], { trace: true, bus: { poke: true } });
  const D = w.cpu.dcache, L = w.cpu.l2;
  eq(D.stats.rfo, 1, 'a write miss to a write-back page fills the line first (write-allocate: one RFO)');
  eq(w.at(DATA + A), 0x11111111, 'memory has the bytes of the store');
  eq(D.stats.writeBacks, 1, 'the M line leaves the L1 (A: replaced by C) and goes into the L2');
  check(ev(w.at$('wb')[0], 'bus').filter(e => e.wb).length >= 4, 'WBINVD writes the M line of the L2 back to the FSB (a burst with wb: true)');
  check(D.tag.every(t => t === -1) && L.tag.filter(t => t !== -1).length <= 1, 'after WBINVD the L1 and the L2 are empty (the HLT after it fills one code line again)');
  // cacheInvalidate: a DMA write that the CPU does not see, then the invalidation
  const bus = makeBus();
  const a = Asm86.assemble(['cpu 686', ...CACHE_ON, 'mov eax, [0]', 'l1: mov ebx, [0]', 'l2: mov ecx, [0]', 'hlt'].join('\n'), { origin: 0, cpu: '686' });
  bus.mem.set(a.bytes, CODE); bus.mem[DATA] = 0x11;
  const cpu = new CPU80686(bus);
  for (let i = 0; i < 6; i++) cpu.loadSeg(i, i === 1 ? 0x1000 : 0x2000);
  cpu.ip = 0; cpu.flush();
  while (cpu.ip !== a.symbols.l1) cpu.step();
  bus.mem[DATA] = 0x22;
  cpu.step();
  eq(cpu.regs32[3], 0x11, 'without the invalidation the CPU reads the old L1 line');
  check(cpu.l2Find(DATA) >= 0, 'the line is in the L2 too');
  eq(cpu.cacheInvalidate(DATA, 1), 2, 'cacheInvalidate(phys, 1): the L1 line and the L2 line become invalid (returns 2)');
  check(cpu.dFind(DATA) < 0 && cpu.l2Find(DATA) < 0, 'the line is in neither cache');
  cpu.step();
  eq(cpu.regs32[1], 0x22, 'after cacheInvalidate the CPU reads the new data');
  cpu.cacheInvalidate(0, 0x1000000);
  check(cpu.dtag.every(t => t === -1) && cpu.itag.every(t => t === -1) && cpu.l2tag.every(t => t === -1), 'cacheInvalidate(0, 16 MB): no valid line in the three caches');
  // CD = 1 (after reset): no fills
  const n = run(['mov eax, [0x0]', 'mov ebx, [0x0]', 'hlt']);
  eq(n.cpu.dcache.stats.fills + n.cpu.icache.stats.fills + n.cpu.l2.stats.fills, 0, 'CD = 1 (after reset): no line fills in any cache');
  // the code cache has 4 ways: 4 code lines of one set stay
  const ic = run([...CACHE_ON, 'mov cx, 3', 'l: call 0x3000:0', 'call 0x3080:0', 'call 0x3100:0', 'call 0x3180:0', 'loop l', 'hlt'],
    { setup: m => { for (const b of [0x30000, 0x30800, 0x31000, 0x31800]) m[b] = 0xCB; } });
  check(ic.cpu.icache.stats.fills <= 8 && ic.cpu.icache.stats.hits > 12, 'the code cache keeps 4 lines of one set (4 ways): the far calls hit in the second pass', () => JSON.stringify(ic.cpu.icache.stats));
  // PWT: the line is S (write-through)
  const s = run([...CACHE_ON, 'mov eax, [0x40]', 'mov dword [0x40], 1', 'hlt']);
  eq(s.cpu.dcache.state[s.cpu.dFind(DATA + 0x40)], 3, 'a read, then a write hit: the line is M');
}

// =====================================================================================
section = 'no trace';
{
  const L = [...CACHE_ON, 'fninit', 'fld1', 'mov cx, 30', 'l: mov ax, [0x100]', 'add bx, ax', 'mov [0x200], bx', 'push ax', 'pop dx', 'imul dx', 'fadd st0, st0',
    'cmovz si, di', 'dec cx', 'jnz l', 'mov ebx, 3', 'div ebx', 'cpuid', 'hlt'];
  const a = run(L, { trace: true }), b = run(L);
  eq(a.cpu.cycles, b.cpu.cycles, 'the clocks are the same with and without a trace');
  check(JSON.stringify(a.steps.map(s => s.T)) === JSON.stringify(b.steps.map(s => s.T)), 'each step gives the same clocks');
  check(JSON.stringify(a.cpu.oooStats) === JSON.stringify(b.cpu.oooStats) && JSON.stringify(a.cpu.btb.stats) === JSON.stringify(b.cpu.btb.stats), 'the same counters');
}

// =====================================================================================
section = 'late fields';
{
  // All fields start in the constructor or reset(): no step adds one (traced or not), also after an
  // exception, an IRQ, the FPU, a REP string, HLT.
  const bus = makeBus();
  const a = Asm86.assemble(['cpu 686', ...CACHE_ON, 'sti', 'mov cx, 20', 'l: push cx', 'pop dx', 'fld1', 'fcomi st0, st0', 'fcmovb st0, st1', 'fstp st0', 'cmovz ax, bx',
    'mov si, 0', 'mov di, 0x100', 'rep movsb', 'loop l', 'mov ecx, 0x186', 'mov eax, 0x4300C0', 'wrmsr', 'xor ecx, ecx', 'rdpmc', 'ud2'].join('\n'), { origin: 0, cpu: '686' });
  bus.mem.set(a.bytes, CODE);
  bus.mem.set([0x00, 0x00, 0x00, 0x30], 6 * 4); bus.mem.set([0x00, 0x00, 0x00, 0x30], 0x40 * 4); bus.mem[0x30000] = 0xF4;
  let irq = false;
  bus.irqPending = () => irq; bus.ackIrq = () => { irq = false; return 0x40; };
  const cpu = new CPU80686(bus);
  const keys = new Set(Object.keys(cpu));
  for (let i = 0; i < 6; i++) cpu.loadSeg(i, i === 1 ? 0x1000 : 0x2000);
  cpu.regs[4] = 0xFFF0; cpu.ip = 0; cpu.flush();
  let n = 0;
  while (!cpu.halted && n < 400) { if (n % 3 === 0) cpu.trace = []; if (n === 100) irq = true; cpu.step(); cpu.trace = null; n++; }
  for (let i = 0; i < 5; i++) cpu.step();
  cpu.reset();
  const late = Object.keys(cpu).filter(k => !keys.has(k));
  check(late.length === 0, 'no field is added after the constructor', late.join(', '));
  check(n > 100 && cpu.oooStats.steps === 0, 'the program ran (and reset() cleared the counters)');
}

console.log(`cpu686: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
