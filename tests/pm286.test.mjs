// 80286 protected-mode tests: small NASM programs (tests/asm286/*.asm) run on CPU80286 with
// a minimal bus in Node. Each expected value comes from the Intel 80286 rules; the rule is
// next to each check.
// Usage: node tests/pm286.test.mjs [--build] [--verbose]
//   --build  assembles tests/asm286/*.asm again with tools/nasm (writes .bin and .sym.json)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU80286 = vm.runInThisContext('CPU80286');
const FPU8087 = vm.runInThisContext('FPU8087');
const F80 = vm.runInThisContext('F80');
const asmDir = path.join(root, 'tests/asm286');
const nasm = path.join(root, 'tools/nasm/nasm-2.16.03/nasm.exe');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');

// ---- build: .asm -> .bin + .sym.json (symbol values from the NASM map file) ----
function build(name) {
  const src = path.join(asmDir, name + '.asm'), bin = path.join(asmDir, name + '.bin'), sym = path.join(asmDir, name + '.sym.json');
  const stale = !fs.existsSync(bin) || !fs.existsSync(sym) || fs.statSync(src).mtimeMs > fs.statSync(bin).mtimeMs
    || fs.statSync(path.join(asmDir, 'pm.inc')).mtimeMs > fs.statSync(bin).mtimeMs;
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
const hx = (v, n = 4) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
function eq(got, want, rule) { check(got === want, rule, () => `got ${hx(got)}, want ${hx(want)}`); }

// Minimal bus: 16 MB RAM with no A20 gate, port log, an IRQ line (OUT E0h, AL = vector
// raises INTR), and a shutdown counter.
function makeBus(fpuModel) {
  const mem = new Uint8Array(1 << 24);
  const bus = {
    mem, io: [], shutdowns: 0, irq: -1, waitStates: 1,
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
function run(name, { maxSteps = 200000, fpu, trace } = {}) {
  build(name);
  const bin = fs.readFileSync(path.join(asmDir, name + '.bin'));
  const sym = JSON.parse(fs.readFileSync(path.join(asmDir, name + '.sym.json'), 'utf8'));
  const bus = makeBus(fpu);
  bus.mem.set(bin, BASE);
  const cpu = new CPU80286(bus);
  // OUT E8h / E9h: switch the 80287 ERROR line (cpu.fpuError) on / off
  const out8 = bus.out8;
  bus.out8 = (p, v) => { out8(p, v); if (p === 0xE8) cpu.fpuError = () => true; if (p === 0xE9) cpu.fpuError = null; };
  cpu.reset();
  for (let i = 0; i < 4; i++) cpu.loadSeg(i, 0x1000);
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
  const w = (n, i = 0) => { const a = BASE + S(n) + 2 * i; return m[a] | (m[a + 1] << 8); };
  const b = (n, i = 0) => m[BASE + S(n) + i];
  const log = [];
  if ('log_n' in sym) for (let i = 0; i < w('log_n'); i++) log.push({ vec: w('log', 8 * i), err: w('log', 8 * i + 1), ip: w('log', 8 * i + 2), cs: w('log', 8 * i + 3), fl: w('log', 8 * i + 4), sp: w('log', 8 * i + 5), ss: w('log', 8 * i + 6) });
  return { cpu, bus, mem: m, sym, S, w, b, log, steps, events };
}
function logCheck(r, i, vec, err, rule) {
  const e = r.log[i];
  check(e && e.vec === vec && e.err === err, `log[${i}] ${rule}`, () => (e ? `got vector ${e.vec} error ${hx(e.err)}` : 'no entry') + `, want vector ${vec} error ${hx(err)}`);
}
const ZF = f => (f >> 6) & 1;

// =====================================================================================
section = 'pm_basic';
{
  const r = run('pm_basic');
  const { cpu, w, b, mem } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0');
  eq(w('r_msw_real'), 0xFFF0, 'SMSW after reset reads FFF0h (reserved MSW bits read as 1)');
  eq(w('r_msw_pm'), 0xFFF1, 'LMSW with bit 0 set enters protected mode: MSW = FFF1h');
  eq(w('r_cs'), 0x0008, 'far JMP loads CS with the selector; RPL = CPL = 0');
  eq(mem[0x123410] | (mem[0x123411] << 8), 0xBEEF, 'descriptor base 123400h: offset 10h goes to physical 123410h (24-bit address)');
  eq(b('r_acc_high'), 0x93, 'a segment load sets the accessed bit in the descriptor (92h -> 93h)');
  eq(w('r_sgdt'), 0x77, 'SGDT stores the GDT limit');
  eq(w('r_sgdt', 1) | ((w('r_sgdt', 2) & 0xFF) << 16), BASE + r.S('gdt'), 'SGDT stores the 24-bit GDT base');
  eq(w('r_sgdt', 2) >> 8, 0xFF, 'the 80286 stores FFh in byte 5 of SGDT');
  eq(w('r_sidt'), 17 * 8 - 1, 'SIDT stores the IDT limit');
  eq(w('r_sidt', 2) >> 8, 0xFF, 'the 80286 stores FFh in byte 5 of SIDT');
  eq(w('r_small_ok') & 0xFF, 0, 'a byte at offset = limit is inside the segment (no fault)');
  eq(w('r_rx_word'), mem[BASE] | (mem[BASE + 1] << 8), 'a readable code segment can be loaded into ES and read');
  eq(w('r_es_d3'), 0x58, 'a DPL 3 data segment can be loaded at CPL 0 (DPL >= max(CPL, RPL))');
  eq(mem[0x42000] | (mem[0x42001] << 8), 0x1234, 'expand-down segment: offset 2000h > limit is valid');
  eq(mem[0x41000] | (mem[0x41001] << 8), 0x5678, 'expand-down segment: offset limit+1 is valid');
  eq(w('r_sldt'), 0x60, 'SLDT stores the LDTR selector');
  eq(mem[0x60000] | (mem[0x60001] << 8), 0x5555, 'selector 0004h (TI = 1) uses LDT entry 0 (base 60000h)');
  eq(w('r_div'), 0x55AA, 'code after #DE continues');
  eq(w('r_after'), 0xC0DE, 'BOUND inside the bounds does not fault');
  const L = [
    [13, 0, '#GP(0): word at offset 100h > limit FFh'],
    [13, 0, '#GP(0): word at offset FFh ends past the limit'],
    [13, 0, '#GP(0): write to a read-only data segment'],
    [11, 0x40, '#NP(sel): descriptor not present'],
    [13, 0x100, '#GP(sel): selector outside the GDT limit'],
    [13, 0x48, '#GP(sel): execute-only code segment into ES'],
    [13, 0x10, '#GP(sel): RPL 3 > DPL 0 (error code has RPL bits 0)'],
    [13, 0x58, '#GP(sel): SS needs DPL = CPL'],
    [13, 0x30, '#GP(sel): SS needs a writable data segment'],
    [13, 0, '#GP(0): null selector into SS'],
    [12, 0x40, '#SS(sel): SS descriptor not present'],
    [13, 0, '#GP(0): memory access through a null ES'],
    [13, 0, '#GP(0): expand-down segment, offset <= limit'],
    [12, 0, '#SS(0): SS limit violation'],
    [13, 0x14, '#GP(sel): selector outside the LDT limit (TI bit in the error code)'],
    [13, 0x30 * 8 + 2, '#GP(vector*8+2): INT n outside the IDT limit (IDT bit = 2, EXT = 0)'],
    [6, 0, '#UD: 0F FF is not defined'],
    [0, 0, '#DE: divide by zero'],
    [5, 0, '#BR: BOUND out of range'],
  ];
  L.forEach(([v, e, rule], i) => logCheck(r, i, v, e, rule));
  eq(r.log.length, L.length, 'number of faults');
  const ipOf = n => r.log.find(e => e.vec === n);
  eq(ipOf(6) && ipOf(6).ip, r.S('f_ud'), '#UD pushes the IP of the undefined opcode');
  eq(ipOf(0) && ipOf(0).ip, r.S('f_div'), '#DE is a fault: it pushes the IP of the DIV');
  eq(ipOf(5) && ipOf(5).ip, r.S('f_bound'), '#BR is a fault: it pushes the IP of the BOUND');
  eq(ipOf(0) && ipOf(0).cs, 0x08, 'the exception frame holds the CS selector');
  const Z = [['VERR data', 1], ['VERW data', 1], ['VERR execute-only code', 0], ['VERR readable code', 1], ['VERW code', 0],
    ['VERW read-only data', 0], ['VERR null selector', 0], ['VERR selector outside the GDT', 0], ['LAR data', 1], ['LAR LDT descriptor', 1],
    ['LSL data', 1], ['LSL call gate (no limit)', 0], ['LAR call gate', 1], ['ARPL raises RPL', 1], ['ARPL no change', 0]];
  Z.forEach(([rule, z], i) => eq(ZF(w(`r_f${i + 1}`)), z, `${rule}: ZF = ${z}`));
  eq(w('r_a9'), 0x9300, 'LAR: AH = access byte (93h: accessed), AL = 0');
  eq(w('r_a10'), 0x8200, 'LAR: LDT descriptor access byte 82h');
  eq(w('r_a11'), 0x00FF, 'LSL: the segment limit');
  eq(w('r_a12'), 0x7777, 'LSL on a gate: destination unchanged');
  eq(w('r_a13'), 0xE400, 'LAR: call gate access byte E4h');
  eq(w('r_a14'), 0x0013, 'ARPL: RPL of the destination becomes 3');
  eq(w('r_a15'), 0x0013, 'ARPL: no change when RPL is already >= source RPL');
  eq(w('r_msw_nope'), 0xFFF1, 'LMSW cannot clear PE');
  eq(w('r_msw_ts'), 0xFFF9, 'LMSW sets TS');
  eq(w('r_msw_clts'), 0xFFF1, 'CLTS clears TS');
}

// =====================================================================================
section = 'pm_rings';
{
  const r = run('pm_rings');
  const { cpu, w } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT at CPL 0 (reached through a DPL 3 call gate)');
  eq(w('r_str'), 0x38, 'STR stores the TR selector after LTR');
  eq(w('r3_cs'), 0x23, 'RETF to an outer level: CS = ring-3 selector, CPL = RPL = 3');
  eq(w('r3_ss'), 0x33, 'RETF to an outer level pops SS');
  eq(w('r3_sp'), 0x7000, 'RETF to an outer level pops SP');
  eq(w('r3_ds'), 0, 'RETF to an outer level loads a null selector into DS when DPL(DS) < new CPL');
  eq(w('r3_es'), 0x2B, 'ES with DPL 3 stays valid after the return to ring 3');
  eq(w('g_cs'), 0x08, 'call gate to a more privileged non-conforming segment: CS = target selector, CPL = DPL = 0');
  eq(w('g_ss'), 0x18, 'inner-level call: SS comes from SS0 of the TSS');
  eq(w('g_sp'), 0x8000 - 12, 'inner-level call: new SP = SP0 - (SS, SP, 2 parameters, CS, IP)');
  eq(w('g_rcs'), 0x23, 'inner-level call pushes the caller CS');
  eq(w('g_p0'), 0x2222, 'call gate copies the parameter words (last pushed word at the lowest address)');
  eq(w('g_p1'), 0x1111, 'call gate copies word count = 2 words');
  eq(w('g_osp'), 0x6FFC, 'inner-level call pushes the caller SP');
  eq(w('g_oss'), 0x33, 'inner-level call pushes the caller SS');
  eq(w('r3_sp_after'), 0x7000, 'RETF 4 to the outer level removes the parameters from both stacks');
  eq(w('r3_ax_after'), 0xAAAA, 'the gate routine ran');
  eq(w('r3_cs_after'), 0x23, 'RETF returns to CPL 3');
  const L = [
    [13, 0, '#GP(0): CLI at CPL 3 > IOPL 0'],
    [13, 0, '#GP(0): HLT needs CPL 0'],
    [13, 0, '#GP(0): LGDT needs CPL 0'],
    [13, 0, '#GP(0): IN at CPL 3 > IOPL 0'],
    [13, 0x10, '#GP(sel): data segment DPL 0 < CPL 3'],
    [12, 0, '#SS(0): word at SS:FFFFh'],
    [13, 0x41 * 8 + 2, '#GP(vector*8+2): INT n through a gate with DPL < CPL'],
    [13, 0x50, '#GP(gate selector): call gate DPL 0 < CPL 3'],
    [13, 0x08, '#GP(sel): JMP to non-conforming code with DPL != CPL'],
    [13, 0, '#GP(0): LOCK prefix at CPL 3 > IOPL 0 (LOCK is IOPL-sensitive on the 80286)'],
  ];
  L.forEach(([v, e, rule], i) => logCheck(r, i, v, e, rule));
  eq(r.log.length, L.length, 'number of faults');
  check(r.log.every(e => e.cs === 0x23), 'each fault frame holds the ring-3 CS (23h)');
  const ss = r.log[5] || {};
  eq(ss.ss, 0x33, 'fault at CPL 3 with a DPL 0 handler: the handler stack holds the old SS');
  eq(ss.sp, 0x7000, 'fault at CPL 3: the handler stack holds the old SP');
  eq(w('i40_cs'), 0x23, 'INT 40h through a DPL 3 trap gate: frame holds CS 23h');
  eq(w('i40_ss'), 0x33, 'INT from CPL 3 to a ring-0 handler switches stacks (old SS in the frame)');
  eq(w('i40_myss'), 0x18, 'the handler runs on SS0 from the TSS');
  eq(w('i40_mycs'), 0x08, 'the handler runs at CPL 0');
  eq(w('i40_fl') & 0x200, 0x200, 'trap gate: IF is not cleared');
  eq(w('i40_ofl') & 0x200, 0x200, 'the FLAGS image holds IF = 1');
  eq(w('i42_fl') & 0x200, 0, 'interrupt gate: IF = 0 in the handler');
  eq(w('c_cs'), 0x4B, 'CALL to a conforming segment: CPL does not change, CS.RPL = 3');
  eq(w('r3_fl_after'), 0x0202, 'POPF at CPL 3 > IOPL: IF and IOPL keep their values');
  eq(w('r3_done'), 0xD0E0, 'ring-3 code ran to the end');
  eq(w('f_cs'), 0x08, 'DPL 3 call gate to ring 0 (no parameters)');
}

// =====================================================================================
section = 'pm_tasks';
{
  const r = run('pm_tasks');
  const { cpu, w, b, mem, S } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT');
  eq(w('b1_ax'), 0xB0B0, 'task switch loads AX from the new TSS');
  eq(w('b1_cx'), 0xB1B1, 'task switch loads CX from the new TSS');
  eq(w('b1_tr'), 0x28, 'TR holds the new TSS selector');
  eq(w('b1_msw'), 0xFFF9, 'a task switch sets MSW.TS');
  eq(w('b1_fl'), 0x0002, 'JMP to a TSS: FLAGS from the TSS, NT not set');
  eq(w('b1_ss'), 0x48, 'SS from the new TSS');
  eq(w('b1_sp'), 0x1000, 'SP from the new TSS');
  eq(w('b1_ldt'), 0x40, 'LDTR from the LDT field of the new TSS');
  eq(mem[0x90000] | (mem[0x90001] << 8), 0xB00B, 'ES = 0004h selects entry 0 of the new LDT');
  eq(w('b1_acc_a') & 0xFF, 0x81, 'JMP: the old TSS becomes available (busy bit cleared)');
  eq(w('b1_acc_b') & 0xFF, 0x83, 'the new TSS is marked busy');
  eq(w('b1_a_ip'), S('back_a1'), 'the old TSS holds the IP of the instruction after the JMP');
  eq(w('a1_ax'), 0xA0A0, 'JMP back: AX of task A restored from its TSS');
  eq(w('a1_bx'), 0xA1A1, 'JMP back: BX of task A restored');
  eq(w('a1_acc_a') & 0xFF, 0x83, 'task A busy again');
  eq(w('a1_acc_b') & 0xFF, 0x81, 'task B available after its JMP');
  eq(w('a1_b_ip'), S('task_b2'), 'TSS B holds the IP after its JMP');
  eq(w('a1_b_ax'), 0xBEBE, 'TSS B holds its AX at the switch');
  eq(w('b2_ax'), 0xBEBE, 'task B continues with its saved registers');
  eq(w('b2_fl') & 0x4000, 0x4000, 'CALL through a task gate sets NT in the new task');
  eq(w('b2_link'), 0x20, 'CALL writes the old TSS selector into the back link');
  eq(w('b2_acc_a') & 0xFF, 0x83, 'CALL: the old task stays busy');
  eq(w('b2_acc_b') & 0xFF, 0x83, 'CALL: the new task is busy');
  eq(w('a2_ax'), 0xA2A2, 'IRET with NT = 1 returns to the task in the back link');
  eq(w('a2_fl') & 0x4000, 0, 'task A has NT = 0 after the return');
  eq(w('a2_acc_a') & 0xFF, 0x83, 'task A busy after the return');
  eq(w('a2_acc_b') & 0xFF, 0x81, 'IRET clears the busy bit of the task that returns');
  eq(w('c_fl') & 0x4000, 0x4000, 'INT through a task gate: NT = 1 in the new task');
  eq(w('c_link'), 0x20, 'INT through a task gate: back link = old TSS');
  eq(w('c_tr'), 0x30, 'INT through a task gate: TR = TSS selector of the gate');
  eq(w('a3_done'), 0x3333, 'IRET from the interrupt task returns to task A');
  eq(w('d_err'), 0x60, 'exception through a task gate: the error code is pushed on the new task stack (#NP(60h))');
  eq(w('d_a_ip'), S('f_np'), 'a fault saves the IP of the faulting instruction in the old TSS');
  eq(w('a4_done'), 0x4444, 'the handler task changed the saved IP and returned');
  logCheck(r, 0, 10, 0x50, '#TS(sel): TSS limit < 43 (2Bh)');
  logCheck(r, 1, 13, 0x20, '#GP(sel): JMP to a busy TSS');
  eq(r.log.length, 2, 'number of logged faults');
  eq(w('a_msw'), 0xFFF9, 'MSW.TS stays set until CLTS');
}

// =====================================================================================
section = 'pm_intr';
{
  const r = run('pm_intr');
  const { cpu, w, bus, S } = r;
  eq(w('r20_ip'), S('after_out'), 'INTR is taken at the next instruction boundary; the frame holds the IP of the next instruction');
  eq(w('r20_fl') & 0x200, 0, 'INTR through an interrupt gate: IF = 0 in the handler');
  eq(w('r20_ofl') & 0x200, 0x200, 'the FLAGS image holds IF = 1');
  eq(w('r_count_cli'), 1, 'INTR waits while IF = 0');
  eq(w('r21_ip'), S('after_sti_nop'), 'after STI, INTR waits until the next instruction is done');
  eq(w('r21_fl') & 0x200, 0x200, 'INTR through a trap gate: IF stays 1');
  eq(w('irq_count'), 2, 'two INTR handlers ran');
  logCheck(r, 0, 11, 0x22 * 8 + 2 + 1, '#NP(vector*8+2+EXT): INTR to a not-present gate (EXT = 1 for an external event)');
  logCheck(r, 1, 8, 0, '#DF(0): #NP while the CPU starts the #GP handler (two contributory exceptions)');
  logCheck(r, 2, 11, 6 * 8 + 2 + 1, '#NP(6*8+2+EXT) and no #DF: #UD is not contributory');
  eq(r.log.length, 3, 'number of logged faults');
  eq(w('r_before_tf'), 0x7777, 'code before the triple fault ran');
  eq(w('r_after_tf'), 0, 'no instruction runs after the shutdown');
  eq(bus.shutdowns, 1, 'triple fault: #GP (IDT limit) -> #GP -> #DF -> fault during #DF: the CPU calls bus.shutdown()');
  check(cpu.halted && cpu.shutdownState, 'the CPU is in the shutdown state (only NMI or RESET continue)');
}

// =====================================================================================
section = 'rm_misc';
{
  const r = run('rm_misc');
  const { cpu, w, bus, S, mem } = r;
  eq(w('r_fl0') & 0xF000, 0, 'real mode: FLAGS bits 12-15 read 0');
  eq(w('r_fl1') & 0xF000, 0, 'real mode: POPF cannot set FLAGS bits 12-15');
  eq(w('r_pushsp'), w('r_sp'), 'PUSH SP pushes the value of SP before the push');
  eq(w('r_msw'), 0xFFF0, 'SMSW in real mode after reset: FFF0h');
  const L = [
    [6, 'f_ud', 'INT 6: undefined opcode 0F FF; IP of the opcode'],
    [13, 'f_ffff', 'INT 13: word operand at offset FFFFh; IP of the instruction'],
    [13, 'f_ssffff', 'INT 13 (not 12) in real mode for SS:FFFFh too'],
    [13, 'f_long', 'INT 13: instruction longer than 10 bytes'],
    [6, 'f_arpl', 'INT 6: ARPL is not recognized in real mode'],
    [6, 'f_sldt', 'INT 6: SLDT is not recognized in real mode'],
    [0, 'f_div', 'INT 0: divide error; IP of the DIV (80286: the faulting instruction)'],
    [13, 'f_int40', 'INT 13: vector 40h is outside the IDT limit 7Fh set by LIDT'],
  ];
  L.forEach(([v, lab, rule], i) => {
    const e = r.log[i];
    check(e && e.vec === v && e.ip === S(lab) && e.cs === 0x1000, `log[${i}] ${rule}`, () => e ? `got vector ${e.vec} IP ${hx(e.ip)} CS ${hx(e.cs)}` : 'no entry');
  });
  eq(r.log.length, L.length, 'number of faults');
  eq(w('r_reloc'), 0xAAAA, 'LIDT base 5000h: INT 20h uses the vector at 5000h + 20h*4');
  eq(w('n_old'), 1, 'the table at 0 is used again only after LIDT with base 0');
  eq(mem[0x200010] | (mem[0x200011] << 8), 0x7777, 'LOADALL: DS cache base 200000h is used in real mode (not selector * 16)');
  eq(mem[0x20010] | (mem[0x20011] << 8), 0, 'LOADALL: nothing written at selector 2000h * 16');
  eq(w('r_la_ax'), 0x7777, 'LOADALL loads AX');
  eq(w('r_la_bx'), 0x4444, 'LOADALL loads BX');
  eq(w('r_la_cx'), 0x6666, 'LOADALL loads CX');
  eq(w('r_la_dx'), 0x5555, 'LOADALL loads DX');
  eq(w('r_la_si'), 0x2222, 'LOADALL loads SI');
  eq(w('r_la_di'), 0x1111, 'LOADALL loads DI');
  eq(w('r_la_bp'), 0x3333, 'LOADALL loads BP');
  eq(w('r_la_sp'), 0xFF00, 'LOADALL loads SP');
  eq(w('r_la_ds'), 0x2000, 'LOADALL loads the DS selector');
  eq(w('r_la_fl'), 0x0003, 'LOADALL loads FLAGS');
  eq(mem[0x10012] | (mem[0x10013] << 8), 0x4321, 'a real-mode MOV DS sets the base to selector * 16 again');
  eq(mem[0x100000], 0x77, 'FFFF:0010 is physical 100000h (the 80286 has address line 20; no wrap)');
  eq(w('r_before_tf'), 0x7777, 'code before the triple fault ran');
  eq(w('r_after_tf'), 0, 'nothing runs after the shutdown');
  eq(bus.shutdowns, 1, 'real mode, IDT limit 0: INT 3 -> INT 13 -> INT 8 -> shutdown');
  check(cpu.shutdownState, 'the CPU is in the shutdown state');
}

// =====================================================================================
section = 'pm_fpu';
{
  const r = run('pm_fpu', { fpu: '80287', trace: true });
  const { cpu, w, mem, S, events } = r;
  check(cpu.halted && !cpu.shutdownState, 'program ends with HLT');
  eq(w('r_sw1'), 0x3800, 'FSTSW AX (DF E0) after one FLD: TOP = 7, no exception flags');
  eq(w('r_sw2'), 0x0000, 'FSTSW AX after FADD + FSTP: TOP = 0');
  const d = Buffer.from(mem.subarray(0x150040, 0x150048)).readDoubleLE(0);
  check(d === 3.0, 'FLD / FSTP operands use the descriptor base 150000h (1.5 + 1.5 = 3.0 at 150040h)', `got ${d}`);
  const env = i => mem[0x150060 + 2 * i] | (mem[0x150061 + 2 * i] << 8);
  eq(env(3), S('f_fld2'), 'after FSETPM, FSTENV word 3 = IP offset of the last ESC instruction');
  eq(env(4), 0x08, 'FSTENV (protected-mode format) word 4 = CS selector');
  eq(env(5), 0x20, 'FSTENV word 5 = operand offset');
  eq(env(6), 0x20, 'FSTENV word 6 = operand selector');
  const L = [
    [9, 0, 'INT 9: operand starts inside the segment and runs past the limit (segment overrun)'],
    [13, 0, '#GP(0): operand starts past the segment limit'],
    [7, 0, '#NM: ESC with MSW.EM = 1'],
    [7, 0, '#NM: WAIT with MSW.MP = 1 and MSW.TS = 1'],
    [7, 0, '#NM: ESC with MSW.TS = 1'],
    [16, 0, '#MF: WAIT while the ERROR line (cpu.fpuError) is active'],
  ];
  L.forEach(([v, e, rule], i) => logCheck(r, i, v, e, rule));
  eq(r.log.length, L.length, 'number of faults (WAIT with EM only, WAIT with TS only, ESC after CLTS: no fault)');
  eq(w('r_done'), 0xF00D, 'program ran to the end');
  // micro-events
  const iow = events.filter(e => e.k === 'bus' && e.type === 'iow' && e.dev === 'fpu');
  check(iow.some(e => e.addr === 0xF8), 'ESC writes the opcode to port 00F8h (bus event, dev fpu)');
  check(iow.some(e => e.addr === 0xFC), 'ESC writes the instruction / operand pointers to port 00FCh');
  const i0 = events.findIndex(e => e.k === 'bus' && e.type === 'memr' && e.addr === 0x150020);
  const seq = events.slice(i0).filter(e => e.k === 'bus').slice(0, 8).map(e => `${e.type}:${hx(e.addr, 6)}`).join(' ');
  check(seq === 'memr:150020 iow:0000FA memr:150022 iow:0000FA memr:150024 iow:0000FA memr:150026 iow:0000FA',
    'FLD m64: the 80286 reads each operand word and writes it to port 00FAh', seq);
  const lens = new Set(events.filter(e => e.k === 'bus' || e.k === 'fetch').map(e => e.len));
  check(lens.size === 1 && lens.has(3), "each 'fetch' / 'bus' event has len = 2 + waitStates (3)", [...lens].join(','));
  check(events.some(e => e.k === 'desc' && e.sreg === 'ES' && e.base === 0x150000 && e.table === 'GDT'), "'desc' event for the ES load (base 150000h, GDT)");
  check(events.some(e => e.k === 'int' && e.src === 'exc' && e.vec === 7 && e.name === '#NM'), "'int' event with name #NM");
  check(events.some(e => e.k === 'int' && e.vec === 13 && e.err === 0 && e.name === '#GP'), "'int' event for #GP carries err = 0");
  check(events.some(e => e.k === 'sys' && e.op === 'LMSW'), "'sys' event for LMSW");
  check(events.some(e => e.k === 'iq'), "'iq' events (decoded-instruction queue depth)");
  check(events.some(e => e.k === 'fpu' && /FSTSW AX/.test(e.text)), "'fpu' event text for FSTSW AX");
}

console.log(`\npm286: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
