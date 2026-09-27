// 80486 unit tests: the new instructions, CPUID and the CPU detection code of real software,
// the EFLAGS AC / ID bits, #MF with CR0.NE, the on-chip cache (hit / miss / fill counts, the
// pseudo-LRU order, write-through, INVD, CD / NW, DMA invalidation, the test registers), the
// micro-events (cache, burst, pipe) and the 486 clock counts. The protected-mode parts (#AC,
// WP, INVLPG, PCD) are in tests/pm486.test.mjs.
// Usage: node tests/cpu486.test.mjs [--verbose]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js',
  'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU80486 = vm.runInThisContext('CPU80486');
const CPU80386 = vm.runInThisContext('CPU80386');
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
// A bus with 16 MB of RAM. cacheable(pa): KEN# (default: the code at 10000h-1FFFFh is not
// cacheable, so that the cache counters show only the data accesses).
const CODE = 0x10000, DATA = 0x20000;
function makeBus({ fpu = true, cacheable, ws = 0 } = {}) {
  const mem = new Uint8Array(1 << 24);
  const bus = {
    mem, waitStates: ws, io: [],
    read8: a => mem[a & 0xFFFFFF], write8: (a, v) => { mem[a & 0xFFFFFF] = v; },
    in8: () => 0xFF, out8: (p, v) => { bus.io.push([p, v]); }, in16: () => 0xFFFF, out16: () => {},
    cacheable: cacheable || (pa => !(pa >= CODE && pa < CODE + 0x10000) && !(pa >= 0xA0000 && pa < 0xC0000)),
    fpu: null,
  };
  if (fpu) bus.fpu = new FPU8087({ read8: bus.read8, write8: bus.write8 }, { model: '80387' });
  return bus;
}
// Each program starts at 1000:0000 in real mode (DS = ES = FS = GS = SS = 2000h, SP = FFF0h).
// The IVT sends the exceptions 0-17 to stubs that store the vector in excvec and halt.
const HEAD = ['cpu 486', 'bits 16', 'org 0', 'jmp start'];
for (let v = 0; v < 18; v++) HEAD.push(`exc${v}: mov byte [cs:excvec], ${v}`, 'hlt');
HEAD.push('excvec: db 0xFF', 'start:');
const CACHE_ON = ['mov eax, cr0', 'and eax, 0x9FFFFFFF', 'mov cr0, eax'];
function run(lines, { cpuClass = CPU80486, bus: busOpts, setup, maxSteps = 100000, trace = false, steps } = {}) {
  const a = Asm86.assemble([...HEAD, ...lines].join('\n'), { origin: 0, cpu: '486' });
  if (!a.ok) throw new Error('assembler: ' + JSON.stringify(a.errors.slice(0, 3)));
  const bus = makeBus(busOpts);
  bus.mem.set(a.bytes, CODE);
  bus.mem.set(a.bytes, DATA);                // the data labels are offsets in segment 2000h
  for (let v = 0; v < 18; v++) { const o = a.symbols['exc' + v]; bus.mem[v * 4] = o & 0xFF; bus.mem[v * 4 + 1] = o >> 8; bus.mem[v * 4 + 2] = 0x00; bus.mem[v * 4 + 3] = 0x10; }
  if (setup) setup(bus.mem, a.symbols);
  const cpu = new cpuClass(bus);
  for (let i = 0; i < 6; i++) cpu.loadSeg(i, i === 1 ? 0x1000 : 0x2000);
  cpu.regs[4] = 0xFFF0;
  cpu.ip = 0; cpu.flush();
  const events = [], clocks = [];
  let n = 0;
  while (!cpu.halted && n++ < maxSteps) {
    if (trace) cpu.trace = [];
    const ip = cpu.ip, T = cpu.step();
    clocks.push([ip, T]);
    if (trace) { events.push(cpu.trace); cpu.trace = null; }
    if (steps && n >= steps) break;
  }
  const m = bus.mem, S = k => { if (!(k in a.symbols)) throw new Error('no symbol ' + k); return a.symbols[k]; };
  return {
    cpu, bus, mem: m, sym: a.symbols, events, clocks,
    exc: m[CODE + S('excvec')],
    d: (k, i = 0) => { const p = DATA + S(k) + 4 * i; return (m[p] | (m[p + 1] << 8) | (m[p + 2] << 16) | (m[p + 3] << 24)) >>> 0; },
    w: (k, i = 0) => { const p = DATA + S(k) + 2 * i; return m[p] | (m[p + 1] << 8); },
    at: p => (m[p] | (m[p + 1] << 8) | (m[p + 2] << 16) | (m[p + 3] << 24)) >>> 0,
  };
}
// The data of a program: the labels are offsets in segment 2000h (run() copies the program there too).
function data(lines) { return ['hlt', 'align 16', ...lines]; }

// =====================================================================================
section = 'reset';
{
  const c = new CPU80486(makeBus());
  eq(c.regs32[2], 0x0415, 'EDX after reset = 0415h (family 4, model 1, stepping 5; the CPUID signature)');
  eq(c.cr[0], 0x60000010, 'CR0 after reset = 60000010h (CD = 1, NW = 1, ET = 1)');
  eq(c.eflags, 2, 'EFLAGS after reset = 2');
  eq(c.ip, 0xFFF0, 'EIP = FFF0h');
  eq(c.cache[1].base, 0xFFFF0000, 'CS base = FFFF0000h');
  check(c.cache486.lines.length === 512 && c.cache486.lines.every(l => !l.valid), 'cache486: 512 lines (128 sets x 4 ways), all invalid');
  check(c.cache486.sets === 128 && c.cache486.ways === 4 && c.cache486.lru.length === 128, 'cache486: sets 128, ways 4, one LRU byte per set');
  check(!c.cacheOn, 'the cache is off after reset (CD = 1)');
  const c3 = new CPU80386(makeBus());
  eq(c3.regs32[2], 0x0308, 'the 80386 still gives EDX = 0308h');
}

// =====================================================================================
section = 'BSWAP';
{
  const L = ['mov eax, 0x12345678'];
  const R = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
  R.forEach((r, i) => L.push(`mov ${r}, 0x${(0x11223344 + i).toString(16)}`, `bswap ${r}`, `mov [r_${r}], ${r}`));
  L.push('mov esp, 0xFFF0', 'stc', 'bswap eax', 'pushf', 'pop word [r_fl]', 'o16 bswap eax', 'mov [r_16], eax', 'hlt');
  const r = run([...L, ...data([...R.map(x => `r_${x}: dd 0`), 'r_fl: dd 0', 'r_16: dd 0'])]);
  R.forEach((x, i) => { const v = 0x11223344 + i; eq(r.d('r_' + x), ((v & 0xFF) << 24 | ((v >> 8) & 0xFF) << 16 | ((v >> 16) & 0xFF) << 8 | (v >>> 24)) >>> 0, `BSWAP ${x}`); });
  eq(r.w('r_fl') & 1, 1, 'BSWAP does not change the flags (CF stays 1)');
  eq(r.d('r_16'), 0x11220000, 'BSWAP with a 16-bit operand size (undefined): the 486 clears the 16-bit register');
}

// =====================================================================================
section = 'XADD';
{
  const r = run([
    'mov al, 0x7F', 'mov bl, 0x01', 'xadd al, bl', 'pushf', 'pop word [r_f8]', 'mov [r_al], al', 'mov [r_bl], bl',
    'mov ax, 0xFFFF', 'mov cx, 1', 'xadd ax, cx', 'pushf', 'pop word [r_f16]', 'mov [r_ax], ax', 'mov [r_cx], cx',
    'mov eax, 0x80000000', 'mov edx, 0x80000000', 'xadd eax, edx', 'pushf', 'pop word [r_f32]', 'mov [r_eax], eax', 'mov [r_edx], edx',
    'mov eax, 5', 'xadd eax, eax', 'mov [r_same], eax',
    'mov ax, 0x0102', 'xadd al, ah', 'mov [r_ah], ax',
    'mov dword [m32], 1000', 'mov ecx, 234', 'lock xadd [m32], ecx', 'mov [r_mc], ecx',
    'mov word [m16], 0x8000', 'mov dx, 0x8000', 'xadd [m16], dx', 'pushf', 'pop word [r_fm]', 'mov [r_md], dx',
    'mov byte [m8], 0x0F', 'mov bh, 0x01', 'xadd [m8], bh', 'pushf', 'pop word [r_fb]',
    'lock xadd eax, ebx',
    'hlt',
    ...data(['r_f8: dd 0', 'r_al: dd 0', 'r_bl: dd 0', 'r_f16: dd 0', 'r_ax: dd 0', 'r_cx: dd 0', 'r_f32: dd 0', 'r_eax: dd 0',
      'r_edx: dd 0', 'r_same: dd 0', 'r_ah: dd 0', 'm32: dd 0', 'r_mc: dd 0', 'm16: dd 0', 'r_fm: dd 0', 'r_md: dd 0', 'm8: dd 0', 'r_fb: dd 0']),
  ]);
  eq(r.d('r_al') & 0xFF, 0x80, 'XADD AL, BL: AL = 7Fh + 1 = 80h');
  eq(r.d('r_bl') & 0xFF, 0x7F, 'XADD AL, BL: BL = the old AL (7Fh)');
  eq(r.w('r_f8') & 0x8D5, 0x890, 'XADD byte: OF = 1, SF = 1, AF = 1, ZF = 0, CF = 0 (the flags of ADD)');
  eq(r.d('r_ax') & 0xFFFF, 0, 'XADD AX, CX: FFFFh + 1 = 0');
  eq(r.d('r_cx') & 0xFFFF, 0xFFFF, 'XADD AX, CX: CX = FFFFh');
  eq(r.w('r_f16') & 0x8D5, 0x55, 'XADD word: CF = 1, ZF = 1, AF = 1, PF = 1');
  eq(r.d('r_eax'), 0, 'XADD EAX, EDX: 80000000h + 80000000h = 0');
  eq(r.d('r_edx'), 0x80000000, 'XADD EAX, EDX: EDX = the old EAX');
  eq(r.w('r_f32') & 0x8C5, 0x845, 'XADD dword: OF = 1, CF = 1, ZF = 1, PF = 1');
  eq(r.d('r_same'), 10, 'XADD EAX, EAX: the destination is written last (5 + 5 = 10)');
  eq(r.d('r_ah') & 0xFFFF, 0x0203, 'XADD AL, AH (AX = 0102h): AL = 2 + 1 = 3, AH = the old AL (2)');
  eq(r.d('m32'), 1234, 'LOCK XADD [m32], ECX: memory = 1000 + 234');
  eq(r.d('r_mc'), 1000, 'LOCK XADD: ECX = the old memory value');
  eq(r.d('m16') & 0xFFFF, 0, 'XADD [m16], DX: 8000h + 8000h = 0');
  eq(r.d('r_md') & 0xFFFF, 0x8000, 'XADD [m16], DX: DX = 8000h');
  eq(r.w('r_fm') & 0x8C1, 0x841, 'XADD word memory: OF = 1, CF = 1, ZF = 1');
  eq(r.d('m8') & 0xFF, 0x10, 'XADD [m8], BH: 0Fh + 1 = 10h');
  eq(r.w('r_fb') & 0x10, 0x10, 'XADD byte memory: AF = 1');
  eq(r.exc, 6, 'LOCK XADD with a register destination: #UD');
}

// =====================================================================================
section = 'CMPXCHG';
{
  const r = run([
    'mov eax, 0x1234', 'mov ebx, 0x1234', 'mov ecx, 0xABCD', 'cmpxchg ebx, ecx', 'pushf', 'pop word [r_f1]', 'mov [r_b1], ebx', 'mov [r_a1], eax',
    'mov eax, 5', 'mov ebx, 7', 'cmpxchg ebx, ecx', 'pushf', 'pop word [r_f2]', 'mov [r_b2], ebx', 'mov [r_a2], eax',
    'mov al, 0x10', 'mov byte [m8], 0x10', 'mov dl, 0x99', 'cmpxchg [m8], dl', 'pushf', 'pop word [r_f3]',
    'mov ax, 0x0001', 'mov word [m16], 0x0002', 'mov dx, 0x7777', 'lock cmpxchg [m16], dx', 'pushf', 'pop word [r_f4]', 'mov [r_a4], ax',
    'mov eax, 0x55', 'mov dword [m32], 0x55', 'mov edx, 0xCAFEBABE', 'lock cmpxchg [m32], edx', 'mov [r_a5], eax',
    'mov al, 3', 'cmpxchg al, bl', 'mov [r_a6], eax',
    'hlt',
    ...data(['r_f1: dd 0', 'r_b1: dd 0', 'r_a1: dd 0', 'r_f2: dd 0', 'r_b2: dd 0', 'r_a2: dd 0', 'm8: dd 0', 'r_f3: dd 0', 'm16: dd 0',
      'r_f4: dd 0', 'r_a4: dd 0', 'm32: dd 0', 'r_a5: dd 0', 'r_a6: dd 0']),
  ], { trace: true });
  eq(r.d('r_b1'), 0xABCD, 'CMPXCHG equal: the destination = the source');
  eq(r.d('r_a1'), 0x1234, 'CMPXCHG equal: EAX does not change');
  eq(r.w('r_f1') & 0x40, 0x40, 'CMPXCHG equal: ZF = 1');
  eq(r.d('r_b2'), 7, 'CMPXCHG not equal: the destination does not change');
  eq(r.d('r_a2'), 7, 'CMPXCHG not equal: EAX = the destination');
  eq(r.w('r_f2') & 0x8D5, 0x91, 'CMPXCHG not equal: the flags of CMP 5, 7 = FFFFFFFEh (CF, SF, AF; ZF = 0, PF = 0)');
  eq(r.d('m8') & 0xFF, 0x99, 'CMPXCHG [m8], DL (equal): memory = DL');
  eq(r.w('r_f3') & 0x40, 0x40, 'CMPXCHG byte: ZF = 1');
  eq(r.d('m16') & 0xFFFF, 2, 'LOCK CMPXCHG [m16] (not equal): memory keeps its value');
  eq(r.d('r_a4') & 0xFFFF, 2, 'LOCK CMPXCHG (not equal): AX = the memory value');
  eq(r.w('r_f4') & 0x81, 0x81, 'CMPXCHG 1 - 2: CF = 1, SF = 1');
  eq(r.d('m32'), 0xCAFEBABE, 'LOCK CMPXCHG [m32] (equal): memory = EDX');
  eq(r.d('r_a5'), 0x55, 'LOCK CMPXCHG (equal): EAX does not change');
  eq(r.d('r_a6') & 0xFF, 7, 'CMPXCHG AL, BL with AL = the destination: equal, AL = BL');
  // The 486 writes the destination also when the values are not equal (a locked read-modify-write).
  const ev = r.events.find(e => e.some(x => x.k === 'decode' && /lock cmpxchg \[0x/.test(x.text) && /word/.test(x.text) === false && x.text.includes(r.sym.m16.toString(16).toUpperCase())));
  check(ev && ev.some(x => x.k === 'bus' && x.type === 'memw' && x.addr === DATA + r.sym.m16), 'CMPXCHG not equal: a memory write cycle of the old value', () => ev && JSON.stringify(ev.filter(x => x.k === 'bus')));
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
  eq(r.d('r1a'), 0x0415, 'CPUID 1: EAX = 0415h (family 4, model 1 = 486DX, stepping 5)');
  eq((r.d('r1a') >> 8) & 15, 4, 'CPUID 1: family 4');
  eq(r.d('r1d'), 1, 'CPUID 1: EDX = 1 (FPU on the chip)');
  eq(r.d('r1b') | r.d('r1c'), 0, 'CPUID 1: EBX = ECX = 0');
  eq(r.d('r2a') | r.d('r2d'), 0, 'CPUID 2 (above the highest leaf): 0');
  const sx = run(L, { bus: { fpu: false } });
  eq(sx.d('r1d'), 0, 'CPUID 1 without an FPU (a 486SX): EDX bit 0 = 0');
  const r3 = run(['cpuid', 'hlt']);
  eq(r3.exc, 0xFF, 'CPUID works in real mode (no fault)');
  const r4 = run(['cpuid', 'hlt'], { cpuClass: CPU80386 });
  eq(r4.exc, 6, 'CPUID on the 80386: #UD');
}

// =====================================================================================
// The classic detection code (as in Intel AP-485 and the BIOS / DOS utilities): the 8086
// keeps FLAGS bits 12-15 at 1, the 286 keeps 12-14 at 0 in real mode, the 386 cannot change
// EFLAGS.AC (bit 18), the 486 can; a 486 that can change EFLAGS.ID (bit 21) has CPUID.
section = 'CPU detection';
{
  const DETECT = [
    'pushf', 'pop ax', 'mov cx, ax', 'and ax, 0x0FFF', 'push ax', 'popf', 'pushf', 'pop ax', 'and ax, 0xF000', 'cmp ax, 0xF000',
    'mov byte [type], 0', 'je done',
    'or cx, 0xF000', 'push cx', 'popf', 'pushf', 'pop ax', 'and ax, 0xF000', 'mov byte [type], 2', 'jz done',
    // 386 or later: toggle AC
    'mov byte [type], 3',
    'mov bx, sp', 'and sp, 0xFFFC',          // aligned stack (AC can give #AC at CPL 3)
    'pushfd', 'pop eax', 'mov ecx, eax', 'xor eax, 0x40000', 'push eax', 'popfd', 'pushfd', 'pop eax',
    'xor eax, ecx', 'mov [acdiff], eax', 'push ecx', 'popfd', 'mov sp, bx',
    'test eax, 0x40000', 'jz done',
    'mov byte [type], 4',
    // CPUID: toggle ID
    'pushfd', 'pop eax', 'mov ecx, eax', 'xor eax, 0x200000', 'push eax', 'popfd', 'pushfd', 'pop eax', 'xor eax, ecx',
    'mov [iddiff], eax', 'push ecx', 'popfd',
    'test eax, 0x200000', 'jz done',
    'mov byte [hascpuid], 1', 'mov eax, 1', 'cpuid', 'mov [sig], eax',
    'done:', 'pushfd', 'pop dword [flags_end]', 'hlt',
    ...data(['type: dd 0', 'acdiff: dd 0', 'iddiff: dd 0', 'hascpuid: dd 0', 'sig: dd 0', 'flags_end: dd 0']),
  ];
  const r4 = run(DETECT), r3 = run(DETECT, { cpuClass: CPU80386 });
  eq(r4.d('type') & 0xFF, 4, '80486: the detection code finds a 486 (AC changes)');
  eq(r4.d('acdiff'), 0x40000, '80486: only bit 18 (AC) changes with POPFD / PUSHFD');
  eq(r4.d('iddiff'), 0x200000, '80486: bit 21 (ID) changes: CPUID is present');
  eq(r4.d('hascpuid') & 0xFF, 1, '80486: the code runs CPUID');
  eq((r4.d('sig') >> 8) & 15, 4, '80486: CPUID family = 4');
  eq(r4.d('flags_end') & 0x240000, 0, 'the code restores AC and ID');
  eq(r3.d('type') & 0xFF, 3, '80386: the same code finds a 386 (AC stays 0)');
  eq(r3.d('acdiff'), 0, '80386: POPFD does not keep bit 18');
  eq(r3.exc, 0xFF, '80386: no fault in the detection code');
}

// =====================================================================================
section = 'EFLAGS AC / ID';
{
  const r = run([
    'pushfd', 'pop eax', 'or eax, 0x240000', 'push eax', 'popfd', 'pushfd', 'pop dword [f1]',
    'pushf', 'pop word [f16]', 'push word 0x0002', 'popf', 'pushfd', 'pop dword [f2]',   // a 16-bit POPF keeps AC and ID
    'int 0x40', 'pushfd', 'pop dword [f4]', 'hlt',
    'handler:', 'pushfd', 'pop dword [f3]', 'iret',
    ...data(['f1: dd 0', 'f16: dd 0', 'f2: dd 0', 'f3: dd 0', 'f4: dd 0']),
  ], { setup: (m, s) => { m[0x100] = s.handler & 0xFF; m[0x101] = s.handler >> 8; m[0x102] = 0; m[0x103] = 0x10; } });
  eq(r.d('f1') & 0x240000, 0x240000, 'POPFD sets AC and ID; PUSHFD pushes them');
  eq(r.w('f16'), r.d('f1') & 0xFFFF, 'PUSHF (16 bits) pushes only the low word');
  eq(r.d('f2') & 0x240000, 0x240000, 'a 16-bit POPF does not change AC and ID');
  eq(r.d('f3') & 0x40000, 0, 'a real-mode interrupt clears AC');
  eq(r.d('f4') & 0x40000, 0, 'the 16-bit IRET does not restore AC (it is in the high word)');
  const c = new CPU80486(makeBus());
  c.eflags = 0xFFFFFFFF;
  eq(c.eflags, 0x277FD7, 'cpu.eflags: the 80486 bits (ID, AC, VM, RF, NT, IOPL, OF..CF; bit 1 = 1)');
}

// =====================================================================================
section = 'CR0';
{
  const r = run([
    'mov eax, cr0', 'mov [c0], eax',
    'mov eax, 0xFFFFFFE0', 'and eax, 0x7FFFFFFE', 'mov cr0, eax', 'mov eax, cr0', 'mov [c1], eax',
    'mov eax, 0x00000000', 'mov cr0, eax', 'mov eax, cr0', 'mov [c2], eax',
    'smsw ax', 'mov [c3], ax',
    'mov eax, 0x20000000', 'mov cr0, eax',       // NW = 1 with CD = 0: #GP
    'hlt', ...data(['c0: dd 0', 'c1: dd 0', 'c2: dd 0', 'c3: dd 0']),
  ]);
  eq(r.d('c0'), 0x60000010, 'MOV EAX, CR0 after reset = 60000010h');
  eq(r.d('c1'), 0x60050030, 'CR0 keeps only CD NW AM WP NE ET MP EM TS PE (the reserved bits read 0)');
  eq(r.d('c2'), 0x00000010, 'CR0.ET stays 1 (the FPU is on the chip)');
  eq(r.d('c3') & 0xFFFF, 0x0010, 'SMSW = 0010h');
  eq(r.exc, 13, 'MOV CR0 with NW = 1 and CD = 0: #GP(0)');
}

// =====================================================================================
section = 'FPU on the chip';
{
  const r = run([...CACHE_ON, 'fninit', 'fld dword [a]', 'fadd dword [b]', 'fstp qword [c]', 'fnstsw [sw]', 'fld1', 'fistp word [i]', 'hlt',
    ...data(['a: dd 1.5', 'b: dd 2.25', 'c: dq 0', 'sw: dw 0xFFFF', 'i: dw 0'])], { trace: true });
  const c = Buffer.from(r.mem.subarray(DATA + r.sym.c, DATA + r.sym.c + 8)).readDoubleLE(0);
  check(c === 3.75, 'FLD / FADD / FSTP: 1.5 + 2.25 = 3.75', c);
  eq(r.w('sw'), 0, 'FNSTSW m16 = 0');
  eq(r.w('i'), 1, 'FISTP word: 1');
  const all = r.events.flat();
  check(!all.some(e => e.k === 'bus' && e.dev === 'fpu'), 'no coprocessor bus cycles (ports F8h / FAh / FCh): the FPU is on the chip');
  check(all.some(e => e.k === 'fpu' && /FADD/.test(e.text)), "the FPU gives an 'fpu' event");
  const st = all.find(e => e.k === 'decode' && /fstp qword/.test(e.text));
  check(!!st, 'the trace decodes fstp qword');
}
{
  // CR0.NE = 1: an unmasked FPU error gives #MF (INT 16) at the next FPU instruction.
  const prog = ne => [
    ...(ne ? ['mov eax, cr0', 'or eax, 0x20', 'mov cr0, eax'] : ['mov eax, cr0', 'and eax, ~0x20', 'mov cr0, eax']),
    'fninit', 'fldcw [cw]', 'fld1', 'fldz', 'fdivp st1, st0', 'mov byte [r_div], 1', 'fld1', 'mov byte [r_after], 1', 'hlt',
    ...data(['cw: dw 0x037B', 'r_div: dd 0', 'r_after: dd 0']),
  ];
  const r1 = run(prog(true));
  eq(r1.exc, 16, 'CR0.NE = 1: the FPU instruction after an unmasked zero divide gives #MF (vector 16)');
  eq(r1.d('r_div') & 0xFF, 1, 'the instruction with the error completes; the fault comes at the next FPU instruction');
  eq(r1.d('r_after') & 0xFF, 0, '#MF stops the next FPU instruction');
  const r0 = run(prog(false));
  eq(r0.exc, 0xFF, 'CR0.NE = 0: no #MF (the error goes to the external IRQ 13 path)');
  eq(r0.d('r_after') & 0xFF, 1, 'CR0.NE = 0: the program continues');
  check(r0.bus.fpu.intRequest === true, 'CR0.NE = 0: fpu.intRequest = true (the machine raises IRQ 13)');
  const r2 = run(['mov eax, cr0', 'or eax, 0x20', 'mov cr0, eax', 'fninit', 'fldcw [cw]', 'fld1', 'fldz', 'fdivp st1, st0', 'fnstsw ax', 'mov [r_sw], ax', 'fnclex', 'fld1', 'wait', 'mov byte [r_ok], 1', 'hlt',
    ...data(['cw: dw 0x037B', 'r_sw: dd 0', 'r_ok: dd 0'])]);
  eq(r2.exc, 0xFF, 'FNSTSW and FNCLEX do not give #MF; after FNCLEX the FPU works');
  eq(r2.d('r_sw') & 0x84, 0x84, 'FNSTSW: ZE (bit 2) and ES (bit 7) are set');
  eq(r2.d('r_ok') & 0xFF, 1, 'WAIT after FNCLEX: no #MF');
  const r3 = run(['mov eax, cr0', 'or eax, 0x20', 'mov cr0, eax', 'fninit', 'fldcw [cw]', 'fld1', 'fldz', 'fdivp st1, st0', 'wait', 'hlt', ...data(['cw: dw 0x037B'])]);
  eq(r3.exc, 16, 'WAIT with a pending error and CR0.NE = 1: #MF');
}

// =====================================================================================
section = 'cache: hit / miss / fill counts';
{
  const r = run([...CACHE_ON,
    'mov eax, [0x100]',     // miss: a line fill (100h-10Fh)
    'mov ebx, [0x104]',     // hit
    'mov cl, [0x10F]',      // hit (the last byte of the line)
    'mov edx, [0x110]',     // miss: the next line
    'mov dword [0x200], 0x11223344',   // write miss: no fill
    'mov esi, [0x200]',     // miss: fill
    'mov dword [0x200], 0x55667788',   // write hit
    'mov edi, [0x200]',     // hit: the new value
    'mov eax, [0x10E]',     // a dword across two lines (10E-111): two hits
    'hlt'], { setup: m => { for (let i = 0; i < 0x40; i++) m[DATA + 0x100 + i] = i; } });
  const st = r.cpu.cache486.stats;
  eq(st.fills, 3, 'three line fills (100h, 110h, 200h)');
  eq(st.hits, 5, 'five read hits (104h, 10Fh, 200h after the fill, 10E-10Fh and 110-111h)');
  eq(st.misses - st.uncached, 3, 'three cacheable read misses');
  eq(st.writeMisses, 1, 'one write miss (no line fill on a write)');
  eq(st.writeHits, 1, 'one write hit');
  eq(r.cpu.regs32[7], 0x55667788, 'the read after the write hit gives the new value');
  eq(r.at(DATA + 0x200), 0x55667788, 'write-through: memory has the new value');
  eq(r.cpu.regs32[0], 0x11100F0E, 'a dword across two lines');
  const L = r.cpu.cache486.lines, set = ((DATA + 0x100) >>> 4) & 127;
  const l = L.find((x, i) => x.valid && (i >> 2) === set);
  check(l && l.tag === (DATA + 0x100) >>> 11 && l.addr === DATA + 0x100, 'cache486.lines: the line of 20100h is in set 10h with tag = phys >> 11', () => JSON.stringify(l));
}

// =====================================================================================
section = 'cache: pseudo-LRU';
{
  // Five lines of set 0 (a stride of 2048 bytes): A0-A3 fill ways 0-3; a hit on A0; then A4
  // replaces the way that the tree bits select (way 2 = A2); then A2 replaces way 1 (A1).
  const A = [0, 1, 2, 3, 4].map(k => 0x0000 + k * 0x800);
  const r = run([...CACHE_ON, ...A.slice(0, 4).map(a => `mov eax, [0x${a.toString(16)}]`), 'hlt'], {});
  const C = r.cpu.cache486, ways = () => [0, 1, 2, 3].map(w => C.lines[w].valid ? C.lines[w].addr - DATA : -1);
  check(JSON.stringify(ways()) === JSON.stringify(A.slice(0, 4)), 'four misses in one set fill ways 0, 1, 2, 3 (the invalid ways first)', () => JSON.stringify(ways()));
  eq(C.lru[0], 0, 'LRU bits after an access to way 3: B0 = 0, B2 = 0 (B1 = 0 from way 1)');
  const r2 = run([...CACHE_ON, ...A.slice(0, 4).map(a => `mov eax, [0x${a.toString(16)}]`), 'mov eax, [0x0]', 'hlt']);
  eq(r2.cpu.cache486.lru[0], 3, 'a hit on way 0 sets B0 and B1');
  const r3 = run([...CACHE_ON, ...A.slice(0, 4).map(a => `mov eax, [0x${a.toString(16)}]`), 'mov eax, [0x0]', `mov eax, [0x${A[4].toString(16)}]`, 'hlt']);
  const C3 = r3.cpu.cache486, w3 = [0, 1, 2, 3].map(w => C3.lines[w].addr - DATA);
  check(JSON.stringify(w3) === JSON.stringify([A[0], A[1], A[4], A[3]]), 'B0 = 1, B2 = 0: the new line replaces way 2', () => JSON.stringify(w3));
  eq(C3.lru[0], 6, 'after the fill of way 2: B0 = 0, B1 = 1, B2 = 1');
  const r4 = run([...CACHE_ON, ...A.slice(0, 4).map(a => `mov eax, [0x${a.toString(16)}]`), 'mov eax, [0x0]', `mov eax, [0x${A[4].toString(16)}]`,
    `mov eax, [0x${A[2].toString(16)}]`, 'mov eax, [0x0]', `mov eax, [0x${A[3].toString(16)}]`, 'hlt']);
  const C4 = r4.cpu.cache486, w4 = [0, 1, 2, 3].map(w => C4.lines[w].addr - DATA);
  check(JSON.stringify(w4) === JSON.stringify([A[0], A[2], A[4], A[3]]), 'B0 = 0, B1 = 1: the next new line replaces way 1', () => JSON.stringify(w4));
  eq(C4.stats.fills, 6, 'six fills in all; A0 and A3 stay (hits)');
  eq(C4.stats.hits, 3, 'three hits: A0, A0 and A3 (they stay in the cache)');
}

// =====================================================================================
section = 'cache: INVD, WBINVD, CD / NW';
{
  const r = run([...CACHE_ON, 'mov eax, [0x0]', 'mov ebx, [0x10]', 'invd', 'mov ecx, [0x0]', 'wbinvd', 'hlt']);
  const st = r.cpu.cache486.stats;
  eq(st.fills, 3, 'INVD: the line of 0 is not in the cache after INVD (a second fill)');
  check(r.cpu.cache486.lines.every(l => !l.valid), 'WBINVD: all lines are invalid');
  eq(st.flushes, 2, 'stats.flushes: INVD and WBINVD (reset sets the counters to 0)');
  const r2 = run(['mov eax, [0x0]', 'mov ebx, [0x0]', 'hlt']);
  eq(r2.cpu.cache486.stats.fills, 0, 'CD = 1 (after reset): no line fills');
  eq(r2.cpu.cache486.stats.hits, 0, 'CD = 1: no hits (the reads go to the bus)');
  // CD = 1, NW = 0: the lines in the cache still give hits; no new fills; writes go through.
  const r3 = run([...CACHE_ON, 'mov eax, [0x0]', 'mov eax, cr0', 'or eax, 0x40000000', 'mov cr0, eax',
    'mov ebx, [0x0]', 'mov ecx, [0x20]', 'mov dword [0x0], 0x12345678', 'mov edx, [0x0]', 'hlt']);
  const s3 = r3.cpu.cache486.stats;
  eq(s3.fills, 1, 'CD = 1, NW = 0: no fill for 20h');
  eq(s3.hits, 2, 'CD = 1, NW = 0: the line of 0 still gives hits');
  eq(r3.at(DATA), 0x12345678, 'CD = 1, NW = 0: a write hit goes to memory (write-through)');
  eq(r3.cpu.regs32[2], 0x12345678, 'CD = 1, NW = 0: the line has the new value');
  // CD = 1, NW = 1: a write hit changes only the cache; invalidation cycles do nothing.
  const r4 = run([...CACHE_ON, 'mov eax, [0x0]', 'mov eax, cr0', 'or eax, 0x60000000', 'mov cr0, eax',
    'mov dword [0x0], 0xAABBCCDD', 'mov ebx, [0x0]', 'mov dword [0x40], 0x01020304', 'hlt'],
  { setup: m => { m[DATA] = 0x11; m[DATA + 1] = 0; m[DATA + 2] = 0; m[DATA + 3] = 0; } });
  eq(r4.cpu.regs32[3], 0xAABBCCDD, 'CD = 1, NW = 1: the CPU reads the new value from the line');
  eq(r4.at(DATA), 0x00000011, 'CD = 1, NW = 1: memory keeps the old value (no write-through for a hit)');
  eq(r4.at(DATA + 0x40), 0x01020304, 'CD = 1, NW = 1: a write miss goes to memory');
  eq(r4.cpu.cacheInvalidate(DATA, 16), 0, 'CD = 1, NW = 1: cacheInvalidate is ignored');
}

// =====================================================================================
section = 'cache: DMA invalidation';
{
  const bus = makeBus();
  const a = Asm86.assemble(['cpu 486', 'mov eax, cr0', 'and eax, 0x9FFFFFFF', 'mov cr0, eax', 'mov eax, [0x0]', 'l1: mov ebx, [0x0]', 'l2: mov ecx, [0x0]', 'hlt'].join('\n'), { origin: 0, cpu: '486' });
  bus.mem.set(a.bytes, CODE);
  bus.mem[DATA] = 0x11;
  const cpu = new CPU80486(bus);
  for (let i = 0; i < 6; i++) cpu.loadSeg(i, i === 1 ? 0x1000 : 0x2000);
  cpu.ip = 0; cpu.flush();
  while (cpu.ip !== a.symbols.l1) cpu.step();
  bus.mem[DATA] = 0x22;                     // a DMA write that does not tell the CPU
  cpu.step();
  eq(cpu.regs32[3], 0x11, 'without invalidation the CPU reads the old line (a stale copy)');
  eq(cpu.cacheInvalidate(DATA, 1), 1, 'cpu.cacheInvalidate(phys, 1) makes one line invalid');
  cpu.step();
  eq(cpu.regs32[1], 0x22, 'after cacheInvalidate the CPU reads the DMA data');
  eq(cpu.cache486.stats.invalidations, 1, 'stats.invalidations = 1');
  // a large range
  cpu.cacheInvalidate(0, 0x1000000);
  check(cpu.cache486.lines.every(l => !l.valid), 'cacheInvalidate(0, 16 MB): no valid lines');
}

// =====================================================================================
section = 'cache: code, KEN#, test registers';
{
  // All memory cacheable: the code lines fill too; a loop then runs from the cache.
  const r = run([...CACHE_ON, 'mov cx, 20', 'l: add ax, cx', 'loop l', 'hlt'], { bus: { cacheable: () => true } });
  const st = r.cpu.cache486.stats;
  check(st.fills >= 1 && st.fills <= 3, 'the code fills one to three lines', st.fills);
  check(st.hits >= 19, 'the loop runs from the cache (each taken LOOP gets the line from the cache: a code hit)', st.hits);
  // KEN# = 0 (bus.cacheable false): no fills
  const r2 = run([...CACHE_ON, 'mov eax, [0x0]', 'mov eax, [0x0]', 'hlt'], { bus: { cacheable: () => false } });
  eq(r2.cpu.cache486.stats.fills, 0, 'bus.cacheable = false (KEN#): no line fills');
  // the video memory is not cacheable by default
  const c = new CPU80486(makeBus({ cacheable: undefined }));
  check(!c.cacheable(0xA0000) && !c.cacheable(0xBFFFF) && c.cacheable(0x9FFFF) && c.cacheable(0xC0000), 'the default KEN#: A0000h-BFFFFh is not cacheable');
  // TR3-TR5: read a line with a cache read, write a line with a cache write, flush
  const r3 = run([...CACHE_ON, 'mov eax, [0x30]',
    `mov eax, ${(((DATA + 0x30) >>> 4) & 127) << 4 | 2}`, 'mov tr5, eax', 'mov eax, tr4', 'mov [t4], eax', 'mov eax, tr3', 'mov [t3], eax',
    'mov eax, 0xCAFEF00D', 'mov tr3, eax', 'mov eax, 0x00000400 | (0x12345 << 11)', 'mov tr4, eax', `mov eax, ${(5 << 4) | (3 << 2) | 1}`, 'mov tr5, eax',
    'mov eax, 3', 'mov tr5, eax', 'hlt', ...data(['t4: dd 0', 't3: dd 0'])], { setup: m => { m[DATA + 0x30] = 0xEF; m[DATA + 0x31] = 0xBE; m[DATA + 0x32] = 0xAD; m[DATA + 0x33] = 0xDE; } });
  eq(r3.d('t4') >>> 11, (DATA + 0x30) >>> 11, 'TR5 cache read: TR4 bits 11-31 = the tag of the line');
  eq((r3.d('t4') >> 10) & 1, 1, 'TR4 bit 10: valid');
  eq((r3.d('t4') >> 3) & 15, 1, 'TR4 bits 3-6: the valid bits of the set (way 0)');
  eq(r3.d('t3'), 0xDEADBEEF, 'TR3: dword 0 of the line (the read buffer)');
  check(r3.cpu.cache486.lines.every(l => !l.valid), 'TR5 control 3: flush');
  const r5 = run([...CACHE_ON, 'mov eax, 0xCAFEF00D', 'mov tr3, eax', 'mov eax, 0x00000400 | (0x12345 << 11)', 'mov tr4, eax',
    `mov eax, ${(5 << 4) | (3 << 2) | 1}`, 'mov tr5, eax', 'hlt']);
  const l5 = r5.cpu.cache486.lines[5 * 4 + 3];
  check(l5.valid && l5.tag === 0x12345 && r5.cpu.cache486.data[(5 * 4 + 3) * 16] === 0x0D, 'TR5 cache write: set 5, way 3 gets the tag, the valid bit and the fill buffer', () => JSON.stringify(l5));
}

// =====================================================================================
section = 'micro-events';
{
  const r = run([...CACHE_ON, 'mov eax, [0x108]', 'mov ebx, [0x10C]', 'nop', 'nop', 'hlt'], { trace: true, bus: { ws: 1 } });
  const E = r.events.find(e => e.some(x => x.k === 'decode' && x.text === 'mov eax, [0x108]'));
  const c = E.find(x => x.k === 'cache');
  check(c && c.hit === false && c.fill === true && c.write === false && c.phys === DATA + 0x108 && c.set === ((DATA + 0x108) >>> 4 & 127) && c.way === 0,
    "a read miss: { k:'cache', hit:false, fill:true, write:false, phys, set, way }", () => JSON.stringify(c));
  const beats = E.filter(x => x.k === 'bus' && x.burst);
  check(beats.length === 8 && beats.every(x => x.type === 'memr' && x.line === DATA + 0x100 && x.width === 2), 'the fill: 8 word cycles with burst: true and line = 20100h', () => JSON.stringify(beats));
  check(JSON.stringify(beats.map(x => x.addr - DATA - 0x100)) === '[8,10,12,14,0,2,4,6]', 'the burst order starts at the dword that the CPU needs (8-C-0-4)', () => JSON.stringify(beats.map(x => x.addr - DATA)));
  check(JSON.stringify(beats.map(x => x.len)) === '[3,2,2,2,2,2,2,2]', 'burst timing: the first cycle 2 + 1 wait state, the others 1 + 1 (2-1-1-1 on the 486 bus)', () => JSON.stringify(beats.map(x => x.len)));
  check(beats.every((x, i) => i === 0 || x.t >= beats[i - 1].t + beats[i - 1].len), 'the beats follow one another in time');
  const E2 = r.events.find(e => e.some(x => x.k === 'decode' && x.text === 'mov ebx, [0x10C]'));
  const c2 = E2.find(x => x.k === 'cache');
  check(c2 && c2.hit && !c2.fill && c2.way === 0, 'a read hit: hit:true, fill:false', () => JSON.stringify(c2));
  check(!E2.some(x => x.k === 'bus' && x.type === 'memr'), 'a read hit has no bus cycle');
  const pipes = r.events.map(e => e.find(x => x.k === 'pipe'));
  check(pipes.every(p => p && p.stage.length === 5), "one 'pipe' event for each instruction, 5 stages");
  const p = E2.find(x => x.k === 'pipe');
  check(p.stage[3] === 'mov ebx, [0x10C]' && p.stage[4] === 'mov eax, [0x108]' && p.stage[2] === 'nop' && p.stage[1] === 'nop' && p.stage[0] === 'hlt',
    'pipe stages: [prefetch, decode 1, decode 2, execute, write-back] = [hlt, nop, nop, this, the one before]', () => JSON.stringify(p.stage));
  const w = run([...CACHE_ON, 'mov dword [0x40], 1', 'hlt'], { trace: true });
  const cw = w.events.flat().find(x => x.k === 'cache' && x.write);
  check(cw && !cw.hit && !cw.fill && cw.way === -1, 'a write miss: write:true, hit:false, fill:false, way -1', () => JSON.stringify(cw));
  // code fill: the fetch events of the line fill carry burst and line
  const cf = run([...CACHE_ON, 'jmp next', 'align 16', 'next: nop', 'hlt'], { trace: true, bus: { cacheable: () => true } });
  const all = cf.events.flat();
  const fb = all.filter(x => x.k === 'fetch' && x.burst);
  check(fb.length >= 8 && fb.every(x => x.width === 2 && typeof x.line === 'number'), "code line fills: 'fetch' events with burst: true and line", fb.length);
  check(all.some(x => x.k === 'cache' && x.code && x.fill), "a code miss gives a 'cache' event with code: true");
}

// =====================================================================================
section = 'clocks';
{
  const byText = {};
  const t = run([...CACHE_ON, 'mov cx, 3', 'l: mov ax, bx', 'add ax, cx', 'inc si', 'push ax', 'pop dx', 'mov ax, [0x0]', 'loop l',
    'jz j1', 'j1: jnz j2', 'j2: nop', 'bswap eax', 'imul eax, ebx', 'hlt'], { bus: { cacheable: () => true }, trace: true });
  for (const e of t.events) {
    const d = e.find(x => x.k === 'decode'), end = e.find(x => x.k === 'end');
    if (d) (byText[d.text] = byText[d.text] || []).push(end.t);
  }
  const last = k => byText[k][byText[k].length - 1];
  eq(last('mov ax, bx'), 1, 'MOV reg, reg: 1 clock (code in the cache)');
  eq(last('add ax, cx'), 1, 'ADD reg, reg: 1 clock');
  eq(last('inc si'), 1, 'INC reg: 1 clock');
  eq(last('push ax'), 2, 'PUSH reg: 1 clock, but at least the bus time of its write-through cycle (2 clocks on this bus)');
  eq(last('pop dx'), 1, 'POP reg: 1 clock (a cache hit)');
  eq(last('mov ax, [0x0]'), 1, 'MOV reg, mem: 1 clock with a cache hit');
  check(byText['mov ax, [0x0]'][0] > 1, 'MOV reg, mem with a miss: the line fill adds its bus time', byText['mov ax, [0x0]'][0]);
  const loops = Object.keys(byText).filter(k => k.startsWith('loop'));
  check(loops.length === 1 && byText[loops[0]][0] === 7 && last(loops[0]) === 6, 'LOOP: 7 clocks taken, 6 not taken', () => JSON.stringify(loops.map(k => byText[k])));
  const jz = Object.keys(byText).find(k => k.startsWith('jz')), jnz = Object.keys(byText).find(k => k.startsWith('jnz'));
  eq(byText[jz][0], 1, 'Jcc not taken: 1 clock');
  eq(byText[jnz][0], 3, 'Jcc taken: 3 clocks');
  eq(last('bswap eax'), 1, 'BSWAP: 1 clock');
  eq(last('imul eax, ebx'), 28, 'IMUL r32, r32: 28 clocks (13-42)');
  check(t.cpu.cycles > 0, 'cpu.cycles counts');
}

console.log(`cpu486: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
