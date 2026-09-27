// 80386 protected-mode tests: small NASM programs (tests/asm386/*.asm) run on CPU80386 with
// a minimal bus in Node. Each expected value comes from the Intel 80386 rules; the rule is
// next to each check.
// Usage: node tests/pm386.test.mjs [--build] [--verbose]
//   --build  assembles tests/asm386/*.asm again with tools/nasm (writes .bin and .sym.json)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU80386 = vm.runInThisContext('CPU80386');
const FPU8087 = vm.runInThisContext('FPU8087');
const asmDir = path.join(root, 'tests/asm386');
const nasm = path.join(root, 'tools/nasm/nasm-2.16.03/nasm.exe');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');

// ---- build: .asm -> .bin + .sym.json (symbol values from the NASM map file) ----
function build(name) {
  const src = path.join(asmDir, name + '.asm'), bin = path.join(asmDir, name + '.bin'), sym = path.join(asmDir, name + '.sym.json');
  const stale = !fs.existsSync(bin) || !fs.existsSync(sym) || fs.statSync(src).mtimeMs > fs.statSync(bin).mtimeMs
    || fs.statSync(path.join(asmDir, 'pm386.inc')).mtimeMs > fs.statSync(bin).mtimeMs;
  if (!args.includes('--build') && !stale) return;
  if (!fs.existsSync(nasm)) { if (!fs.existsSync(bin)) throw new Error(`${name}.bin is missing and NASM is not in tools/nasm`); return; }
  const wrap = path.join(asmDir, `_${name}.asm`), map = path.join(asmDir, `_${name}.map`);
  fs.writeFileSync(wrap, `[map symbols _${name}.map]\n%include "${name}.asm"\n`);
  try {
    execFileSync(nasm, ['-f', 'bin', '-o', bin, `_${name}.asm`], { cwd: asmDir, stdio: 'pipe' });
  } catch (e) { throw new Error(`nasm ${name}.asm:\n${e.stderr}`); } finally { fs.rmSync(wrap, { force: true }); }
  const syms = {};
  for (const line of fs.readFileSync(map, 'utf8').split(/\r?\n/)) {
    // "Value Name" (constants) or "Real Virtual Name" (labels)
    const m = line.trim().match(/^([0-9A-F]+)\s+(?:([0-9A-F]+)\s+)?([A-Za-z_.$?@][\w.$?@]*)$/);
    if (m) syms[m[3]] = parseInt(m[1], 16);
  }
  fs.rmSync(map, { force: true });
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

// Minimal bus: 16 MB RAM, a port log, an IRQ line (OUT E0h, AL = vector raises INTR), and
// a shutdown counter.
function makeBus(fpuModel) {
  const mem = new Uint8Array(1 << 24);
  const bus = {
    mem, io: [], shutdowns: 0, irq: -1, waitStates: 0,
    read8: a => mem[a & 0xFFFFFF], write8: (a, v) => { mem[a & 0xFFFFFF] = v; },
    in8: p => { bus.io.push(['in', p]); return 0xFF; },
    out8: (p, v) => { bus.io.push(['out', p, v]); if (p === 0xE0) bus.irq = v; },
    irqPending: () => bus.irq >= 0,
    ackIrq: () => { const v = bus.irq; bus.irq = -1; return v; },
    shutdown: () => { bus.shutdowns++; },
    fpu: null,
  };
  if (fpuModel) bus.fpu = new FPU8087({ read8: bus.read8, write8: bus.write8 }, { model: fpuModel });
  return bus;
}
function run(name, { maxSteps = 200000, fpu, trace, setup } = {}) {
  build(name);
  const bin = fs.readFileSync(path.join(asmDir, name + '.bin'));
  const sym = JSON.parse(fs.readFileSync(path.join(asmDir, name + '.sym.json'), 'utf8'));
  const bus = makeBus(fpu);
  bus.mem.set(bin, BASE);
  if (setup) setup(bus.mem);
  const cpu = new CPU80386(bus);
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
    if (cpu.halted && cpu.f & 0x200 && bus.irq >= 0) cpu.step();
  }
  const S = n => { if (!(n in sym)) throw new Error(`${name}: no symbol ${n}`); return sym[n]; };
  const m = bus.mem;
  const d = (n, i = 0) => { const a = BASE + S(n) + 4 * i; return (m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24)) >>> 0; };
  const w = (n, i = 0) => { const a = BASE + S(n) + 2 * i; return m[a] | (m[a + 1] << 8); };
  const b = (n, i = 0) => m[BASE + S(n) + i];
  const pd = a => (m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24)) >>> 0;
  const log = [];
  if ('log_n' in sym) {
    for (let i = 0; i < d('log_n'); i++) {
      log.push({ vec: d('log', 8 * i), err: d('log', 8 * i + 1), eip: d('log', 8 * i + 2), cs: d('log', 8 * i + 3) & 0xFFFF,
        fl: d('log', 8 * i + 4), esp: d('log', 8 * i + 5), ss: d('log', 8 * i + 6) & 0xFFFF, cr2: d('log', 8 * i + 7) });
    }
  }
  return { cpu, bus, mem: m, sym, S, d, w, b, pd, log, steps, events };
}
function logCheck(r, i, vec, err, rule) {
  const e = r.log[i];
  check(e && e.vec === vec && e.err === err, `log[${i}] ${rule}`, () => (e ? `got vector ${e.vec} error ${hx(e.err, 4)}` : 'no entry') + `, want vector ${vec} error ${hx(err, 4)}`);
}

// =====================================================================================
section = 'pm32_basic';
{
  const r = run('pm32_basic', { setup: m => { m[0x50FFC] = 0x78; m[0x50FFD] = 0x56; m[0x50FFE] = 0x34; m[0x50FFF] = 0x12; } });
  const { cpu, d, S, pd } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(d('r_cs') & 0xFFFF, 0x08, 'far JMP (66 EA) loads CS = 08h, a 32-bit code segment');
  eq(d('r_add'), 0xACF13568, '32-bit ADD: 12345678h + 9ABCDEF0h = ACF13568h');
  eq(d('r_add_fl') & 0x8D5, 0x080, 'ADD flags: SF = 1, CF = 0, OF = 0 (PUSHFD)');
  eq(d('r_sib'), 0x0BADF00D, 'SIB addressing [EBX + ESI*4 + 4]');
  eq(d('r_lea'), S('table') + 3 * 8 + 0x100, 'LEA ECX, [EBX + ESI*8 + 100h]');
  eq(d('r_movzx'), 0x11, 'MOVZX EAX, byte');
  eq(d('r_movsx'), 0xFFFF99AA, 'MOVSX EAX, word 99AAh = FFFF99AAh');
  eq(d('r_bsf'), 20, 'BSF of 00F00000h = 20');
  eq(d('r_bsr'), 23, 'BSR of 00F00000h = 23');
  eq(d('bits_v'), 8, 'BTS dword [m], 3 sets bit 3');
  eq(d('bits_v', 1), 0x100, 'BTS [m], EAX = 40: the bit offset selects the next dword (bit 8)');
  eq(d('r_shld'), 0x11, 'SHLD EAX, EDX, 4');
  eq(d('r_imul'), 0xFFFFFFEB, 'IMUL EAX, EAX, -3 = -21');
  eq(d('r_mul_lo'), 1, 'MUL: FFFFFFFFh * FFFFFFFFh, low dword = 1');
  eq(d('r_mul_hi'), 0xFFFFFFFE, 'MUL: high dword (EDX) = FFFFFFFEh');
  eq(d('r_div_q'), 0x55555555, 'DIV ECX: 1_00000000h / 3 = 55555555h');
  eq(d('r_div_r'), 1, 'DIV ECX: remainder 1');
  eq(d('r_sete') & 0xFF, 1, 'SETE after CMP of equal values = 1');
  for (let i = 0; i < 4; i++) eq(d('copy', i), d('table', i), `REP MOVSD copies dword ${i}`);
  eq(d('r_pop'), 0xCAFEBABE, 'PUSH imm32 / POP m32');
  eq(d('r_esp'), 0x10000, 'ESP is back at 10000h (32-bit stack, B = 1)');
  eq(d('r_small'), 0x12345678, 'limit 0 with G = 1: offset FFCh is inside (4 KB segment)');
  eq(pd(0x123456), 0x600DF00D, 'flat segment (base 0, 4 GB): write to linear 123456h');
  eq(d('r_c16'), 0x16161616, '16-bit code segment: MOV EAX (66h prefix), then O32 RETF back to 32-bit code');
  eq(d('r_c16w') & 0xFFFF, 0x1234, '16-bit code segment: the default operand size is 16 bits');
  eq(d('r_user_cs') & 0xFFFF, 0x33, 'IRETD to CPL 3: CS = 33h');
  eq(d('r_g_param'), 0xA5A5A5A5, '386 call gate: the dword parameter is copied to the level 0 stack');
  eq(d('r_g_cs'), 0x33, 'call gate: the return CS (a dword slot)');
  eq(d('r_g_eip'), S('after_gate'), 'call gate: the return EIP (a dword slot)');
  eq(d('r_g_ss'), 0x43, 'call gate: the old SS is pushed (dword)');
  eq(d('r_g_esp'), 0xFFEC, 'call gate: the old ESP (after the parameter push)');
  eq(d('r_g_mycs') & 0xFFFF, 0x58, 'call gate target runs in the flat code segment (gate offset above 64 KB)');
  eq(d('r_g_myss') & 0xFFFF, 0x18, 'call gate: SS0 from the 386 TSS');
  eq(d('r_g_myesp'), 0x8000 - 20 - 8, 'call gate: ESP0 from the 386 TSS minus the 5-dword frame and 2 pushes');
  eq(d('r_gate_ret'), 0x11111111, 'RETF 4 returns to CPL 3');
  eq(d('r_gate_esp'), 0xFFF0, 'RETF 4 to the outer level releases the parameter on the CPL 3 stack');
  eq(d('r_i_eip'), S('after_int'), 'INT 40h through a 386 interrupt gate: the pushed EIP is a dword');
  eq(d('r_i_cs'), 0x33, 'INT 40h: the pushed CS');
  eq(d('r_i_efl'), 0x202, 'INT 40h: the pushed EFLAGS (IF = 1)');
  eq(d('r_i_esp'), 0xFFF0, 'INT 40h: the pushed ESP of CPL 3');
  eq(d('r_i_ss'), 0x43, 'INT 40h: the pushed SS of CPL 3');
  eq(d('r_i_fl') & 0x200, 0, 'an interrupt gate clears IF');
  eq(d('r_i_eax'), 0x13579BDF, 'INT 40h: EAX arrives unchanged');
  eq(d('r_int_ret'), 0x22222222, 'IRETD returns to CPL 3');
  eq(d('r_int_esp'), 0xFFF0, 'IRETD restores the CPL 3 ESP');
  logCheck(r, 0, 13, 0, '#GP(0): dword at offset FFEh passes the 4 KB limit');
  logCheck(r, 1, 13, 0, '#GP(0): CLI at CPL 3 with IOPL 0');
  check(r.log[1] && r.log[1].cs === 0x33 && r.log[1].ss === 0x43, 'log[1] the fault frame holds the CPL 3 CS and SS');
  logCheck(r, 2, 13, 0, '#GP(0): HLT at CPL 3');
  logCheck(r, 3, 13, 0, '#GP(0): MOV EAX, CR0 at CPL 3');
  logCheck(r, 4, 13, 0x10, '#GP(10h): a DPL 0 data segment at CPL 3');
  eq(d('r_end_cs') & 0xFFFF, 0x08, 'INT 41h ends at CPL 0');
}

// =====================================================================================
section = 'pm32_task';
{
  const r = run('pm32_task', { trace: true });
  const { cpu, d, S, events } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT in task A');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(r.log.length, 0, 'no exceptions');
  // CALL to a 386 TSS
  eq(d('r_b_eax'), 0xBBBB0001, 'task B starts with EAX from its 386 TSS');
  eq(d('r_b_esp'), 0x8000, 'task B: ESP from its TSS');
  eq(d('r_b_ss') & 0xFFFF, 0x40, 'task B: SS from its TSS');
  eq(d('r_b_fs') & 0xFFFF, 0x10, 'task B: FS from its TSS (a 386 TSS holds FS and GS)');
  eq(d('r_b_fl') & 0x4000, 0x4000, 'CALL to a task sets NT in the new task');
  eq(d('r_b_tr') & 0xFFFF, 0x28, 'STR in task B = 28h');
  eq(d('r_b_link') & 0xFFFF, 0x20, 'the back link in TSS B = the TSS of task A');
  eq(d('r_a_saved_eax'), 0xAAAA0001, 'the old task state: EAX saved in TSS A (offset 28h)');
  eq(d('r_a_saved_eip'), S('after_call'), 'the old task state: EIP saved in TSS A = the instruction after CALL');
  eq(d('r_a_saved_fl') & 0x4000, 0, 'the saved EFLAGS of task A has NT = 0');
  eq(d('r_b_busy') & 0xFF, 0x8B, 'TSS B is busy (type 0Bh) while it runs');
  eq(d('r_a_busy') & 0xFF, 0x8B, 'TSS A stays busy after a CALL (a nested task)');
  // IRETD back
  eq(d('r_a_eax'), 0xAAAA0001, 'IRETD with NT = 1 returns to task A: EAX of task A');
  eq(d('r_a_ebx'), 0xAAAA0002, 'task A: EBX restored');
  eq(d('r_a_esi'), 0xAAAA0006, 'task A: ESI restored');
  eq(d('r_a_fl') & 0x4000, 0, 'task A: NT = 0');
  eq(d('r_msw') & 8, 8, 'a task switch sets CR0.TS');
  eq(d('r_msw2') & 8, 0, 'CLTS clears CR0.TS');
  eq(d('r_b_busy_after') & 0xFF, 0x89, 'IRET from task B clears its busy bit (type 09h)');
  // INT 50h through a task gate
  eq(d('r_b2_ecx'), 0xBBBB0002, 'INT 50h through a task gate: task B continues with its saved ECX');
  eq(d('r_b2_fl') & 0x4000, 0x4000, 'an interrupt through a task gate sets NT');
  eq(d('r_b2_link') & 0xFFFF, 0x20, 'the back link again = TSS A');
  eq(d('r_a_ecx'), 0x0000C0C0, 'after IRETD task A has its own ECX');
  // JMP to a 286 TSS and back
  eq(d('r_c_ax') & 0xFFFF, 0xC001, 'task C (286 TSS) starts with AX from its TSS');
  eq(d('r_c_fl') & 0x4000, 0, 'JMP to a task does not set NT');
  eq(d('r_c_abusy') & 0xFF, 0x89, 'JMP clears the busy bit of the old task (A)');
  eq(d('r_c_a_eip'), S('after_jmp'), 'EIP of task A saved at the JMP');
  eq(d('r_c_busy_after') & 0xFF, 0x81, 'after task C jumps away, its 286 TSS is not busy (type 01h)');
  eq(d('r_a_busy_after') & 0xFF, 0x8B, 'task A is busy again');
  eq(d('r_c_saved_ip') & 0xFFFF, S('after_c_jmp'), 'the 286 TSS of task C holds IP after its JMP (a 16-bit TSS)');
  eq(d('r_a_fl2') & 0x4000, 0, 'task A after the JMP back: NT = 0');
  eq(cpu.tr.sel, 0x20, 'TR = TSS A at the end');
  const tasks = events.filter(e => e.k === 'task');
  check(tasks.length === 6 && tasks.map(e => e.reason).join() === 'call,iret,int,iret,jmp,jmp' && tasks[4].tss === 286 && tasks[5].tss === 386,
    'trace: 6 task events (CALL, IRET, INT, IRET, JMP to the 286 TSS, JMP back to the 386 TSS)', () => JSON.stringify(tasks.map(e => [e.from, e.to, e.reason, e.tss])));
}

// =====================================================================================
section = 'pm32_paging';
{
  const put = (m, a, v) => { for (let i = 0; i < 4; i++) m[a + i] = (v >>> (8 * i)) & 0xFF; };
  const r = run('pm32_paging', { trace: true, setup: m => { put(m, 0x91000, 0x91919191); put(m, 0x92010, 0x92929292); put(m, 0x93000, 0x93939393); } });
  const { cpu, d, pd, events } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(d('r_cr0') & 0x80000001, 0x80000001, 'CR0: PG = 1 and PE = 1');
  eq(pd(0x90010), 0x5A5A1234, 'linear 200010h goes to physical 90010h (the PTE frame)');
  eq(pd(0x200010), 0, 'physical 200010h does not change');
  eq(d('r_pte200'), 0x90063, 'the PTE gets A (20h) and, after a write, D (40h)');
  eq(d('r_pde0'), 0x81027, 'the PDE gets A (20h); a PDE has no D bit change');
  eq(d('r_ro_read'), 0x91919191, 'read of a user read-only page at CPL 0');
  eq(pd(0x91004), 0x11112222, 'a supervisor write to a read-only page is allowed on the 80386 (no WP bit)');
  eq(d('r_pte202'), 0x91065, 'the read-only PTE also gets A and D');
  logCheck(r, 0, 14, 0, '#PF: read of a not-present page, error code 0');
  eq(r.log[0] && r.log[0].cr2, 0x201000, 'CR2 = 201000h');
  logCheck(r, 1, 14, 2, '#PF: write to a not-present page, error code 2 (W/R)');
  eq(r.log[1] && r.log[1].cr2, 0x201234, 'CR2 = 201234h (the full linear address)');
  logCheck(r, 2, 14, 0, '#PF: the page directory entry is not present');
  eq(r.log[2] && r.log[2].cr2, 0x400000, 'CR2 = 400000h');
  logCheck(r, 3, 14, 0, '#PF: a dword across into a not-present page');
  eq(r.log[3] && r.log[3].cr2, 0x201000, 'CR2 = 201000h (the start of the page that faults)');
  eq(d('r_tlb_old'), 0x5A5A1234, 'TLB: after a PTE change without a flush, the old translation stays');
  eq(d('r_tlb_new'), 0x92929292, 'TLB: MOV CR3 flushes the TLB; the new PTE is used');
  eq(d('r_tr7_hit') & 0xFFFFF010, 0x92010, 'TR6 lookup of 200000h: TR7 = physical 92000h with PL = 1 (hit)');
  eq(d('r_tr7_miss') & 0x10, 0, 'TR6 lookup of 300000h: PL = 0 (miss)');
  eq(d('r_tr_read'), 0x93939393, 'a TLB entry written with TR6/TR7 maps 300000h to 93000h (not the tables)');
  eq(d('r_user_read'), 0x91919191, 'CPL 3 reads a user read-only page');
  logCheck(r, 4, 14, 7, '#PF: CPL 3 write to a read-only page, error code 7 (P, W/R, U/S)');
  eq(r.log[4] && r.log[4].cr2, 0x202000, 'CR2 = 202000h');
  check(r.log[4] && r.log[4].cs === 0x33 && r.log[4].ss === 0x43, 'the #PF frame holds the CPL 3 CS and SS');
  logCheck(r, 5, 14, 5, '#PF: CPL 3 read of a supervisor page, error code 5 (P, U/S)');
  eq(r.log[5] && r.log[5].cr2, 0x200000, 'CR2 = 200000h');
  eq(r.log.length, 6, 'six page faults in all');
  // TLB contents and trace events
  const valid = cpu.tlb.filter(e => e.valid);
  check(valid.length > 0 && valid.length <= 32, 'cpu.tlb holds valid entries (32 at most)', valid.length);
  const code = valid.find(e => e.lin === 0x10000);
  check(code && code.phys === 0x10000 && (code.flags & 4), 'cpu.tlb: the code page 10000h -> 10000h, U/S = 1', () => JSON.stringify(code));
  check(valid.every(e => (e.lin >>> 12 & 7) === (cpu.tlb.indexOf(e) >> 2)), 'cpu.tlb: entry i is in set i/4 = linear bits 12-14');
  check(cpu.tlbStats.hits > cpu.tlbStats.misses && cpu.tlbStats.flushes >= 2, 'cpu.tlbStats: more hits than misses; CR3 writes flush', () => JSON.stringify(cpu.tlbStats));
  const pf = events.find(e => e.k === 'page' && e.fault && e.lin === 0x201000);
  check(pf && pf.err === 0 && pf.dir === 0 && pf.tbl === 0x201 && pf.pte === 0, "trace: a 'page' event with fault = true for 201000h", () => JSON.stringify(pf));
  const walk = events.find(e => e.k === 'page' && !e.fault && e.lin === 0x200010);
  check(walk && walk.phys === 0x90010 && walk.tbl === 0x200 && walk.pde === 0x81027 && !walk.hit, "trace: a 'page' event of a walk (dir, tbl, pde, pte, phys)", () => JSON.stringify(walk));
  const hits = events.filter(e => e.k === 'tlb');
  check(hits.length > 10 && hits.every(e => e.hit), "trace: 'tlb' hit events", hits.length);
  const perInstr = [];
  let n = 0;
  for (const e of events) { if (e.k === 'decode') { perInstr.push(n); n = 0; } if (e.k === 'tlb') n++; }
  check(Math.max(...perInstr) <= 1, "trace: at most one 'tlb' event per instruction");
  const ea = events.find(e => e.k === 'ea' && e.lin === 0x200010);
  check(ea && ea.phys === 0x90010, "trace: the 'ea' event has lin and the 32-bit phys", () => JSON.stringify(ea));
}

// =====================================================================================
section = 'pm32_v86';
{
  const r = run('pm32_v86');
  const { cpu, d, S, bus } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(d('r_v86_add') & 0xFFFF, 0x2345, 'V86 mode runs real-mode code (DS = 1000h: linear 10000h + offset)');
  eq(d('r_v86_eax'), 0x87654321, 'V86 mode: a 32-bit register with the 66h prefix');
  eq(d('r_v86_cs') & 0xFFFF, 0x1000, 'V86 mode: CS holds the real-mode segment 1000h');
  eq(d('r_v86_in') & 0xFF, 0xFF, 'IN AL, 60h: the bitmap bit is 0, the port is read');
  const want = [0xFA, 0xE6, 0xE5, 0xE4, 0xCD, 0x9C, 0xF4];
  const names = ['CLI with IOPL 0', 'OUT 61h (bitmap bit 1)', 'IN AX, 60h (61h is also needed)', 'IN AL, 80h (past the bitmap)', 'INT 21h with IOPL 0', 'PUSHF with IOPL 0', 'HLT at CPL 3'];
  want.forEach((op, i) => {
    logCheck(r, i, 13, 0, `#GP(0) in V86 mode: ${names[i]}`);
    eq(d('ops', i), op, `the monitor finds opcode ${op.toString(16)} at CS:IP`);
  });
  check(r.log.slice(0, 7).every(e => (e.fl & 0x20000) && e.cs === 0x1000 && e.ss === 0x1000 && e.cr2 === 0x1000),
    'the #GP frames from V86 mode hold VM = 1, CS, SS and DS (1000h)');
  eq(d('r_mon_ds'), 0, 'in the monitor (CPL 0) DS is a null selector (the CPU cleared DS, ES, FS, GS)');
  eq(d('r_v86_done') & 0xFFFF, 0x600D, 'V86 code continues after each skipped instruction');
  check(bus.io.length === 1 && bus.io[0][0] === 'in' && bus.io[0][1] === 0x60, 'only the allowed port access reaches the bus', JSON.stringify(bus.io));
  eq(d('r_v2_fl') & 0x3200, 0x3000, 'IOPL 3: CLI and PUSHF work (IOPL = 3, IF = 0)');
  eq(d('r_i30_efl') & 0x23200, 0x23200, 'INT 30h from V86 mode: the pushed EFLAGS has VM = 1, IOPL 3, IF = 1');
  eq(d('r_i30_cs') & 0xFFFF, 0x1000, 'INT 30h: the pushed CS = 1000h');
  eq(d('r_i30_eip'), S('after_int30'), 'INT 30h: the pushed EIP');
  eq(d('r_i30_ss') & 0xFFFF, 0x1000, 'INT 30h: the pushed SS = 1000h');
  eq(d('r_i30_vds') & 0xFFFF, 0x1000, 'INT 30h: the pushed DS = 1000h (the frame of a V86 interrupt holds ES DS FS GS)');
  eq(d('r_i30_ds'), 0, 'INT 30h: DS in the handler is null');
  eq(d('r_v2_after') & 0xFFFF, 0x3030, 'IRETD with VM = 1 in the image returns to V86 mode');
  logCheck(r, 7, 13, 0, '#GP(0): HLT in V86 mode ends part 2');
  eq(r.log.length, 8, 'eight #GP faults in all');
  eq(cpu.f & 0x20000, 0, 'VM = 0 at the end');
}

// =====================================================================================
section = 'pm32_fault';
{
  const r = run('pm32_fault', { trace: true });
  const { cpu, d, S, bus, events } = r;
  logCheck(r, 0, 8, 0, '#DF(0): #GP, then #NP (the #GP gate is not present): two contributory exceptions');
  eq(d('r_part1'), 1, 'the program continues after the #DF handler');
  eq(d('r_df'), 0xDF, '#PF, then #PF during its delivery (stack page not present): #DF through a task gate');
  eq(d('r_df_cr2'), 0x3EFFC, 'CR2 = the address of the failed push (linear 3EFFCh)');
  eq(d('r_df_err'), 0, 'the #DF error code (0) is on the stack of the new task');
  eq(d('r_df_esp0'), 0x8000 - 4, 'the new task pushes the error code as a dword (386 TSS)');
  eq(d('r_df_esp'), 0xF000, 'the saved ESP of the main task = ESP before the fault');
  eq(d('r_df_eip'), S('fault_here'), 'the saved EIP of the main task = the instruction that faulted');
  eq(d('r_df_link') & 0xFFFF, 0x28, 'the back link = the main TSS');
  eq(d('r_df_fl') & 0x4000, 0x4000, 'NT = 1 in the double-fault task');
  eq(d('r_after'), 0, 'no code runs after the faults');
  check(cpu.halted && cpu.shutdownState, 'IDT limit 0: INT 3 -> #GP -> #DF -> a fault during #DF: shutdown (triple fault)');
  eq(bus.shutdowns, 1, 'the bus sees one shutdown (the AT resets the CPU)');
  check(events.some(e => e.k === 'sys' && e.op === 'SHUTDOWN'), "trace: a 'sys' SHUTDOWN event");
  check(events.some(e => e.k === 'bus' && e.type === 'halt'), "trace: a 'halt' bus cycle for the shutdown");
  const ints = events.filter(e => e.k === 'int').map(e => e.vec);
  check(ints.join() === '13,8,14,8,3,13,8', 'trace: int events 13 8 (the #NP turns into #DF), 14 8, 3 13 8 (then shutdown)', ints.join());
}

// =====================================================================================
section = 'pm32_fpu';
{
  const r = run('pm32_fpu', { fpu: '80287' });
  const { cpu, d, pd } = r;
  const f64 = a => { const b = Buffer.from(r.mem.subarray(a, a + 8)); return b.readDoubleLE(0); };
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(d('r_cr0') & 0x10, 0x10, 'CR0.ET = 1 with a coprocessor (80387 protocol)');
  check(f64(BASE + r.S('r_sum')) === 3.75, 'FLD / FADD dword with 32-bit offsets: 1.5 + 2.25 = 3.75', f64(BASE + r.S('r_sum')));
  const lo = pd(0x90FFC), hi = pd(0x201000);
  const b = Buffer.alloc(8); b.writeUInt32LE(lo, 0); b.writeUInt32LE(hi, 4);
  check(b.readDoubleLE(0) === 3.375, 'FSTP qword across two pages with paging: bytes at physical 90FFCh and 201000h', b.readDoubleLE(0));
  eq(d('r_sw') & 0x4700, 0x0000, 'FSTSW AX: the status word after FLD1 / FCHS (C3 C2 C0 = 0)');
  eq((d('r_sw') >> 11) & 7, 7, 'FSTSW AX: TOP = 7 (one value on the stack)');
  logCheck(r, 0, 7, 0, '#NM: ESC with CR0.TS = 1');
  logCheck(r, 1, 7, 0, '#NM: WAIT with CR0.TS = 1 and CR0.MP = 1 (not with MP = 0)');
  logCheck(r, 2, 7, 0, '#NM: ESC with CR0.EM = 1');
  eq(r.log.length, 3, 'three #NM faults in all');
  eq(d('r_one'), 1, 'the FPU works again after CLTS and EM = 0');
}

// =====================================================================================
section = 'rm_386';
{
  const r = run('rm_386', { fpu: '80287' });
  const { cpu, d, pd } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT');
  eq(d('r_done'), 0xD0D0, 'the program reaches the end');
  eq(d('r_fl') & 0xF000, 0x7000, 'real mode: POPF sets IOPL and NT (bits 12-14); bit 15 stays 0 (the 80286 keeps 12-15 at 0)');
  eq(d('r_eax'), 0x12345678, 'real mode: 32-bit register and [EBX*2 - 4 + disp] addressing');
  eq(d('r_msw') & 0xFFFF, 0xFFF0, 'SMSW in real mode = FFF0h (ET = 1, reserved bits 1)');
  eq(d('r_cr0'), 0x7FFFFFF0, 'MOV EAX, CR0 in real mode = 7FFFFFF0h');
  eq(pd(0x200000), 0x0DDBA11, 'unreal mode: FS:EBX reaches linear 200000h after the return to real mode');
  eq(d('r_unreal'), 0x0DDBA11, 'unreal mode: the read back');
  eq(cpu.cache[4].limit, 0xFFFFFFFF, 'FS keeps the 4 GB limit after a real-mode load (only the base changes)');
  eq(cpu.cache[4].base, 0, 'the real-mode load sets the FS base = 0');
  const c = new CPU80386(makeBus('80287'));
  eq(c.regs32[2], 0x0308, 'after reset EDX = 0308h (component ID 03h, revision 08h): the CPU type for a BIOS');
  eq(c.ip, 0xFFF0, 'after reset EIP = FFF0h');
  eq(c.cache[1].base, 0xFFFF0000, 'after reset the CS base = FFFF0000h (the first fetch is at FFFFFFF0h)');
  eq(c.cr[0], 0x7FFFFFF0, 'after reset CR0 = 7FFFFFF0h');
  eq(c.dr[6], 0xFFFF0FF0, 'after reset DR6 = FFFF0FF0h');
}

console.log(`pm386: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
