// Intel Pentium Pro (P6) CPU core. It extends CPU80586 (src/core/cpu80586.js) and keeps its step()
// and micro-event contract (see ARCHITECTURE.md, "Pentium Pro core (CPU80686)").
//
// - The P6 instructions: CMOVcc, FCMOVcc, FCOMI / FCOMIP / FUCOMI / FUCOMIP, RDPMC, UD2. CPUID gives
//   family 6, model 1, stepping 9 (a Pentium Pro 200) and the cache descriptors (leaf 2).
// - CR4: TSD, DE, PSE, MCE, PGE (global pages: the G bit of a PTE or of a 4 MB PDE; MOV CR3 keeps
//   the global TLB entries) and PCE (RDPMC at CPL 3). The P6 MSRs: the TSC, the performance
//   counters (C1h, C2h) with their event selects (186h, 187h), the machine-check registers (MCA:
//   179h-17Bh, 400h-413h) and the microcode update registers (79h, 8Bh).
// - The caches: an L1 code cache of 8 KB (4-way), an L1 data cache of 8 KB (2-way, write-back,
//   MESI, write-allocate) and an L2 of 256 KB (4-way) on the back-side bus. All lines are 32 bytes.
//   An L2 miss goes to the 64-bit front-side bus (FSB) at the bus clock (bus.busRatio core clocks
//   for each bus clock). The emulator writes each store to memory at once, so memory always has
//   the newest bytes: the M state and the write-back bursts are only for the timing and the views.
// - The out-of-order model: each x86 instruction becomes µops (decoders D0 / D1 / D2 with the 4-1-1
//   rule, the MSROM for complex instructions), the RAT renames the registers to the 40 entries of
//   the ROB, the reservation station (20 entries) dispatches up to 5 µops each clock to the ports
//   0-4, and the ROB retires up to 3 µops each clock in program order. A BTB of 512 entries with a
//   4-bit history for each branch (two-level prediction) and a return stack buffer predict the
//   branches; a wrong prediction flushes the front end.
//
// The architectural result is always the result of the in-order interpreter of the base classes:
// the instruction runs first, then the model computes its µops and their times (see ooo()). The
// clock rule of a step is at finish(). With cpu.trace = null the model makes no objects, arrays or
// strings: all its state is in typed arrays that the constructor (reset()) makes.
//
// Why the class extends CPU80586: the P6 keeps the Pentium system features (CPUID, RDTSC, the MSR
// frame, CMPXCHG8B, CR4, 4 MB pages with the three TLBs, the 8 KB 2-way data cache with the MESI
// states, the 64-bit bus events, the snoop of the prefetch queue). The P5 parts that the P6 does
// not have (the U and V pipes, the P5 BTB, the P5 clocks) never run: this class replaces step(),
// exec(), stringOp() and finish(), so pairCheck(), branch(), clocks486() and clocks586() are not
// called (and no clock is computed twice).

const C4_PGE = 0x80, C4_PCE = 0x100;
const P686_CR4 = C4_TSD | C4_DE | C4_PSE | C4_MCE | C4_PGE | C4_PCE;   // the CR4 bits of this core
// The registers of the RAT: EAX..EDI (0-7), EFLAGS (8), the FPU status word (9) and the eight
// physical FPU registers R0-R7 (10-17; ST(i) is R((TOP + i) & 7)).
const P686_RN = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI', 'EFLAGS', 'FSW', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'];
const P6M_EAX = 1, P6M_ECX = 2, P6M_EDX = 4, P6M_EBX = 8, P6M_ESP = 16, P6M_EBP = 32, P6M_ESI = 64, P6M_EDI = 128;
// The kinds of µops (the 'kind' of the 'uop' events and the index in cpu.rob.kind).
const P686_UK = ['alu', 'shift', 'lea', 'mul', 'div', 'branch', 'load', 'sta', 'std', 'esp', 'fadd', 'fmul', 'fdiv', 'fmov',
  'fxch', 'fcmp', 'cmov', 'msrom', 'nop'];
const UK_ALU = 0, UK_SHIFT = 1, UK_LEA = 2, UK_MUL = 3, UK_DIV = 4, UK_BR = 5, UK_LOAD = 6, UK_STA = 7, UK_STD = 8, UK_ESP = 9,
  UK_FADD = 10, UK_FMUL = 11, UK_FDIV = 12, UK_FMOV = 13, UK_FXCH = 14, UK_FCMP = 15, UK_CMOV = 16, UK_MS = 17, UK_NOP = 18;
// Port classes: port 0 only, port 1 only, port 0 or 1, the load port (2), the store address port
// (3), the store data port (4), no port (FXCH: the RAT does the work).
const PC_0 = 0, PC_1 = 1, PC_01 = 2, PC_LD = 3, PC_STA = 4, PC_STD = 5, PC_NONE = 6;
const P686_PORT = [0, 1, -1, 2, 3, 4, -1];
// Branch kinds of a recipe.
const BK_JCC = 1, BK_JMP = 2, BK_CALL = 3, BK_RET = 4, BK_JMPI = 5, BK_CALLI = 6, BK_LOOP = 7, BK_FAR = 8;
const P686_BK = ['', 'jcc', 'jmp', 'call', 'ret', 'jmpi', 'calli', 'loop', 'far'];
// Address modes of the loads and stores: the ModR/M operand, the stack (ESP), the string registers
// (ESI, EDI), a fixed mask of registers (aM).
const AM_EA = 0, AM_STACK = 1, AM_STR = 2, AM_FIX = 3;
// Units that do not take a new µop each clock: the divider (integer DIV, FDIV, FSQRT) and FMUL.
const UN_DIV = 1, UN_FMUL = 2;
// Operand size of the register operands: by the w bit of the opcode, a byte, the operand size.
const SZ_W = 0, SZ_B = 1, SZ_O = 2;
// Pipeline constants (clocks).
const P686_DEC_ISS = 2;       // decode -> the RAT (the µops can issue 2 clocks after the decode)
const P686_DQ = 3;            // the decoders stop when they are more than 3 clocks ahead of the RAT
const P686_FE_RESTART = 8;    // a wrong prediction: the fetch starts again 8 clocks after the branch executes
const P686_BACLEAR = 5;       // a taken branch that the decoder finds (no BTB entry): 5 clocks
const P686_L2LAT = 4;         // an L2 hit: 4 clocks more than an L1 hit (the L1 load latency is 3)
const P686_FSBREQ = 2;        // the request and snoop phases of an FSB transaction (bus clocks)
const P686_SPLIT = 6;         // a load that crosses a cache line
const P686_REPSTART = 6;      // the MSROM start of a REP string instruction (µops)
const P686_MAXM = 16;         // loads and stores that the model keeps for each step (more: MSROM µops)
const P686_CAL = 512;         // the clocks in the calendar of each port

// A µop recipe of an x86 instruction. All recipes have the same fields (one shape):
//   uR / uM: the compute µops (register form / memory form); loads and stores come from the
//     accesses that the instruction really made (a load µop for each read, STA + STD for each write)
//   pc, lat, kind, unit: the port class, the latency, the kind and the unit of the last compute
//     µop (the others are 1-clock ALU µops in a chain)
//   rG / wG, rE / wE, rO / wO: the ModR/M reg field, the ModR/M r/m register, the register in the
//     opcode (read / write); rM / wM: fixed register masks; fR / fW: EFLAGS
//   sz: the operand size of the registers (SZ_W, SZ_B, SZ_O)
//   am / amS / aM: the address mode of the loads / of the stores, the fixed address registers
//   esp: a separate µop adds to ESP (PUSH, POP, CALL, RET ...)
//   br: the branch kind; ser: serializing (it waits until all older µops retire, and the next
//   instruction is fetched after it); ms: decoded by the MSROM; dyn: more µops when the 80386 clock
//   count of the base class is larger (far transfers, gates, task switches); lea: the compute µop
//   reads the address registers; lk: the memory form is locked (serializing)
//   fp: an FPU recipe; fs: the FPU sources (1 = ST0, 2 = ST(i), 4 = FSW); fd: the FPU destination
//   (1 = ST0, 2 = ST(i), 3 = the new ST0 of a push); fsw: it writes the FPU status word
function P686R(o) {
  const r = { uR: 1, uM: 1, pc: PC_01, lat: 1, kind: UK_ALU, unit: 0, rG: 0, wG: 0, rE: 0, wE: 0, rO: 0, wO: 0, rM: 0, wM: 0,
    fR: 0, fW: 0, sz: SZ_W, am: AM_EA, amS: -1, aM: 0, esp: 0, br: 0, ser: 0, ms: 0, dyn: 0, lea: 0, lk: 0, fp: 0, fs: 0, fd: 0, fsw: 0, id: -1 };
  for (const k in o) { if (!(k in r) || k === 'id') throw new Error('P686R: ' + k); r[k] = o[k]; }
  if (r.amS < 0) r.amS = r.am;
  return r;
}
const P686_R1 = new Array(256).fill(null);    // one-byte opcodes
const P686_G1 = new Array(256).fill(null);    // one-byte group opcodes: 8 recipes by the reg field
const P686_R0F = new Array(256).fill(null);   // 0F xx
const P686_G0F = new Array(256).fill(null);   // 0F xx groups
const P686_EXC = P686R({ uR: 16, uM: 16, esp: 1, am: AM_STACK, br: BK_FAR, ms: 1, ser: 1, dyn: 1 });   // an exception
const P686_INT = P686R({ uR: 16, uM: 16, esp: 1, am: AM_STACK, br: BK_FAR, ms: 1, ser: 1, dyn: 1 });   // an IRQ or NMI
const P686_RUD = P686R({ uR: 4, uM: 4, ms: 1 });
{
  const R = P686R;
  const alu = (n, f) => {                          // ADD OR ADC SBB AND SUB XOR CMP
    const cmp = n === 7, adc = n === 2 || n === 3;
    const o = { fW: 1, fR: adc ? 1 : 0, uR: adc ? 2 : 1, uM: adc ? 2 : 1, sz: f === 4 ? SZ_B : f === 5 ? SZ_O : SZ_W };
    if (f < 4) { o.rG = 1; o.rE = 1; if (!cmp) { if (f < 2) o.wE = 1; else o.wG = 1; } } else { o.rM = P6M_EAX; if (!cmp) o.wM = P6M_EAX; }
    return R(o);
  };
  const grp1 = n => R({ rE: 1, wE: n === 7 ? 0 : 1, fW: 1, fR: n === 2 || n === 3 ? 1 : 0, uR: n === 2 || n === 3 ? 2 : 1, uM: n === 2 || n === 3 ? 2 : 1 });
  const push = o => R(Object.assign({ uR: 0, uM: 0, esp: 1, am: AM_STACK }, o));
  for (let b = 0; b < 0x40; b++) {
    const f = b & 7;
    if (f < 6) P686_R1[b] = alu(b >> 3, f);
  }
  for (const b of [0x06, 0x0E, 0x16, 0x1E]) P686_R1[b] = push({});
  for (const b of [0x07, 0x17, 0x1F]) P686_R1[b] = R({ uR: 4, uM: 4, esp: 1, am: AM_STACK, dyn: 1, ms: 1 });
  P686_R1[0x27] = P686_R1[0x2F] = R({ rM: P6M_EAX, wM: P6M_EAX, fR: 1, fW: 1, sz: SZ_B });
  P686_R1[0x37] = P686_R1[0x3F] = R({ uR: 2, uM: 2, rM: P6M_EAX, wM: P6M_EAX, fR: 1, fW: 1, sz: SZ_O });
  for (let b = 0x40; b < 0x50; b++) P686_R1[b] = R({ rO: 1, wO: 1, fW: 1, sz: SZ_O });
  for (let b = 0x50; b < 0x58; b++) P686_R1[b] = push({ rO: 1, sz: SZ_O });
  for (let b = 0x58; b < 0x60; b++) P686_R1[b] = R({ uR: 0, uM: 0, esp: 1, am: AM_STACK, wO: 1, sz: SZ_O });
  P686_R1[0x60] = R({ uR: 1, uM: 1, esp: 1, am: AM_STACK, rM: 0xFF, ms: 1, sz: SZ_O });
  P686_R1[0x61] = R({ uR: 1, uM: 1, esp: 1, am: AM_STACK, wM: 0xEF, ms: 1, sz: SZ_O });
  P686_R1[0x62] = R({ uR: 4, uM: 4, rG: 1, ms: 1, sz: SZ_O });
  P686_R1[0x63] = R({ uR: 4, uM: 4, rG: 1, rE: 1, wE: 1, fW: 1, sz: SZ_O });
  P686_R1[0x68] = P686_R1[0x6A] = push({});
  P686_R1[0x69] = P686_R1[0x6B] = R({ pc: PC_0, lat: 4, kind: UK_MUL, rE: 1, wG: 1, fW: 1, sz: SZ_O });
  P686_R1[0x6C] = P686_R1[0x6D] = R({ uR: 14, uM: 14, am: AM_STR, rM: P6M_EDX | P6M_EDI, wM: P6M_EDI, ms: 1, ser: 1 });
  P686_R1[0x6E] = P686_R1[0x6F] = R({ uR: 14, uM: 14, am: AM_STR, rM: P6M_EDX | P6M_ESI, wM: P6M_ESI, ms: 1, ser: 1 });
  for (let b = 0x70; b < 0x80; b++) P686_R1[b] = R({ pc: PC_1, kind: UK_BR, fR: 1, br: BK_JCC });
  for (const b of [0x80, 0x81, 0x82, 0x83]) P686_G1[b] = [0, 1, 2, 3, 4, 5, 6, 7].map(grp1);
  P686_R1[0x84] = P686_R1[0x85] = R({ rG: 1, rE: 1, fW: 1 });
  P686_R1[0x86] = P686_R1[0x87] = R({ uR: 3, uM: 3, rG: 1, rE: 1, wG: 1, wE: 1, lk: 1 });
  P686_R1[0x88] = P686_R1[0x89] = R({ uR: 1, uM: 0, rG: 1, wE: 1 });
  P686_R1[0x8A] = P686_R1[0x8B] = R({ uR: 1, uM: 0, rE: 1, wG: 1 });
  P686_R1[0x8C] = R({ uR: 1, uM: 0, wE: 1, sz: SZ_O });
  P686_R1[0x8D] = R({ pc: PC_0, kind: UK_LEA, lea: 1, wG: 1, sz: SZ_O });
  P686_R1[0x8E] = R({ uR: 2, uM: 2, rE: 1, dyn: 1, sz: SZ_O });
  P686_R1[0x8F] = R({ uR: 0, uM: 0, esp: 1, am: AM_STACK, amS: AM_EA, wE: 1, sz: SZ_O });
  P686_R1[0x90] = R({ kind: UK_NOP });
  for (let b = 0x91; b < 0x98; b++) P686_R1[b] = R({ uR: 3, uM: 3, rO: 1, wO: 1, rM: P6M_EAX, wM: P6M_EAX, sz: SZ_O });
  P686_R1[0x98] = R({ rM: P6M_EAX, wM: P6M_EAX, sz: SZ_O });
  P686_R1[0x99] = R({ rM: P6M_EAX, wM: P6M_EDX, sz: SZ_O });
  P686_R1[0x9A] = R({ uR: 20, uM: 20, esp: 1, am: AM_STACK, br: BK_FAR, dyn: 1, ms: 1 });
  P686_R1[0x9B] = R({ uR: 2, uM: 2 });
  P686_R1[0x9C] = R({ uR: 10, uM: 10, esp: 1, am: AM_STACK, fR: 1, ms: 1 });
  P686_R1[0x9D] = R({ uR: 12, uM: 12, esp: 1, am: AM_STACK, fW: 1, ms: 1 });
  P686_R1[0x9E] = R({ rM: P6M_EAX, fW: 1, sz: SZ_B });
  P686_R1[0x9F] = R({ fR: 1, wM: P6M_EAX, sz: SZ_B });
  P686_R1[0xA0] = P686_R1[0xA1] = R({ uR: 0, uM: 0, am: AM_FIX, wM: P6M_EAX });
  P686_R1[0xA2] = P686_R1[0xA3] = R({ uR: 0, uM: 0, am: AM_FIX, rM: P6M_EAX });
  P686_R1[0xA4] = P686_R1[0xA5] = R({ am: AM_STR, rM: P6M_ESI | P6M_EDI, wM: P6M_ESI | P6M_EDI });
  P686_R1[0xA6] = P686_R1[0xA7] = R({ uR: 2, uM: 2, am: AM_STR, rM: P6M_ESI | P6M_EDI, wM: P6M_ESI | P6M_EDI, fW: 1 });
  P686_R1[0xA8] = P686_R1[0xA9] = R({ rM: P6M_EAX, fW: 1 });
  P686_R1[0xAA] = P686_R1[0xAB] = R({ am: AM_STR, rM: P6M_EDI | P6M_EAX, wM: P6M_EDI });
  P686_R1[0xAC] = P686_R1[0xAD] = R({ am: AM_STR, rM: P6M_ESI, wM: P6M_ESI | P6M_EAX });
  P686_R1[0xAE] = P686_R1[0xAF] = R({ uR: 2, uM: 2, am: AM_STR, rM: P6M_EDI | P6M_EAX, wM: P6M_EDI, fW: 1 });
  for (let b = 0xB0; b < 0xB8; b++) P686_R1[b] = R({ wO: 1, sz: SZ_B });
  for (let b = 0xB8; b < 0xC0; b++) P686_R1[b] = R({ wO: 1, sz: SZ_O });
  const shift = (n, cl, one) => (n === 2 || n === 3
    ? R({ uR: one ? 2 : 4, uM: one ? 2 : 4, pc: PC_0, kind: UK_SHIFT, rE: 1, wE: 1, fR: 1, fW: 1, rM: cl ? P6M_ECX : 0 })
    : R({ pc: PC_0, kind: UK_SHIFT, rE: 1, wE: 1, fW: 1, rM: cl ? P6M_ECX : 0 }));
  for (const b of [0xC0, 0xC1, 0xD0, 0xD1, 0xD2, 0xD3]) P686_G1[b] = [0, 1, 2, 3, 4, 5, 6, 7].map(n => shift(n, b >= 0xD2, b === 0xD0 || b === 0xD1));
  P686_R1[0xC2] = R({ uR: 2, uM: 2, esp: 1, am: AM_STACK, pc: PC_1, kind: UK_BR, br: BK_RET });
  P686_R1[0xC3] = R({ esp: 1, am: AM_STACK, pc: PC_1, kind: UK_BR, br: BK_RET });
  P686_R1[0xC4] = P686_R1[0xC5] = R({ uR: 3, uM: 3, wG: 1, dyn: 1, sz: SZ_O });
  P686_G1[0xC6] = P686_G1[0xC7] = [R({ uR: 1, uM: 0, wE: 1 }), P686_RUD, P686_RUD, P686_RUD, P686_RUD, P686_RUD, P686_RUD, P686_RUD];
  P686_R1[0xC8] = R({ uR: 8, uM: 8, esp: 1, am: AM_STACK, rM: P6M_EBP, wM: P6M_EBP, ms: 1 });
  P686_R1[0xC9] = R({ am: AM_FIX, aM: P6M_EBP, rM: P6M_EBP, wM: P6M_ESP | P6M_EBP, sz: SZ_O });
  P686_R1[0xCA] = P686_R1[0xCB] = R({ uR: 16, uM: 16, esp: 1, am: AM_STACK, br: BK_FAR, dyn: 1, ms: 1 });
  P686_R1[0xCC] = P686_R1[0xCD] = P686_R1[0xCE] = P686_R1[0xF1] = R({ uR: 20, uM: 20, esp: 1, am: AM_STACK, br: BK_FAR, dyn: 1, ms: 1 });
  P686_R1[0xCF] = R({ uR: 20, uM: 20, esp: 1, am: AM_STACK, br: BK_FAR, dyn: 1, ms: 1, ser: 1 });
  P686_R1[0xD4] = R({ uR: 3, uM: 3, pc: PC_0, lat: 13, rM: P6M_EAX, wM: P6M_EAX, fW: 1, sz: SZ_B });
  P686_R1[0xD5] = R({ uR: 3, uM: 3, pc: PC_0, lat: 4, rM: P6M_EAX, wM: P6M_EAX, fW: 1, sz: SZ_B });
  P686_R1[0xD6] = R({ uR: 2, uM: 2, fR: 1, wM: P6M_EAX, sz: SZ_B });
  P686_R1[0xD7] = R({ uR: 0, uM: 0, am: AM_FIX, aM: P6M_EBX | P6M_EAX, wM: P6M_EAX, sz: SZ_B });
  P686_R1[0xE0] = P686_R1[0xE1] = R({ uR: 6, uM: 6, rM: P6M_ECX, wM: P6M_ECX, fR: 1, pc: PC_1, kind: UK_BR, br: BK_LOOP });
  P686_R1[0xE2] = R({ uR: 6, uM: 6, rM: P6M_ECX, wM: P6M_ECX, pc: PC_1, kind: UK_BR, br: BK_LOOP });
  P686_R1[0xE3] = R({ uR: 2, uM: 2, rM: P6M_ECX, pc: PC_1, kind: UK_BR, br: BK_LOOP });
  P686_R1[0xE4] = P686_R1[0xE5] = R({ uR: 14, uM: 14, wM: P6M_EAX, ms: 1, ser: 1 });
  P686_R1[0xE6] = P686_R1[0xE7] = R({ uR: 14, uM: 14, rM: P6M_EAX, ms: 1, ser: 1 });
  P686_R1[0xEC] = P686_R1[0xED] = R({ uR: 14, uM: 14, rM: P6M_EDX, wM: P6M_EAX, ms: 1, ser: 1 });
  P686_R1[0xEE] = P686_R1[0xEF] = R({ uR: 14, uM: 14, rM: P6M_EDX | P6M_EAX, ms: 1, ser: 1 });
  P686_R1[0xE8] = R({ esp: 1, am: AM_STACK, pc: PC_1, kind: UK_BR, br: BK_CALL });
  P686_R1[0xE9] = P686_R1[0xEB] = R({ pc: PC_1, kind: UK_BR, br: BK_JMP });
  P686_R1[0xEA] = R({ uR: 12, uM: 12, br: BK_FAR, dyn: 1, ms: 1 });
  P686_R1[0xF4] = R({ uR: 8, uM: 8, ser: 1, ms: 1 });
  P686_R1[0xF5] = R({ fR: 1, fW: 1 });
  P686_R1[0xF8] = P686_R1[0xF9] = R({ fW: 1 });
  P686_R1[0xFA] = P686_R1[0xFB] = R({ uR: 3, uM: 3, fW: 1 });
  P686_R1[0xFC] = P686_R1[0xFD] = R({ uR: 4, uM: 4, fW: 1 });
  const mul = R({ uR: 3, uM: 3, pc: PC_0, lat: 2, kind: UK_MUL, rE: 1, rM: P6M_EAX, wM: P6M_EAX | P6M_EDX, fW: 1 });   // 4 clocks in all
  const div = R({ uR: 4, uM: 4, pc: PC_0, lat: 39, kind: UK_DIV, unit: UN_DIV, rE: 1, rM: P6M_EAX | P6M_EDX, wM: P6M_EAX | P6M_EDX, fW: 1 });
  P686_G1[0xF6] = P686_G1[0xF7] = [R({ rE: 1, fW: 1 }), R({ rE: 1, fW: 1 }), R({ rE: 1, wE: 1 }), R({ rE: 1, wE: 1, fW: 1 }), mul, mul, div, div];
  const incdec = R({ rE: 1, wE: 1, fW: 1 });
  P686_G1[0xFE] = [incdec, incdec, P686_RUD, P686_RUD, P686_RUD, P686_RUD, P686_RUD, P686_RUD];
  P686_G1[0xFF] = [incdec, incdec,
    R({ esp: 1, am: AM_EA, amS: AM_STACK, pc: PC_1, kind: UK_BR, br: BK_CALLI, rE: 1, sz: SZ_O }),
    R({ uR: 20, uM: 20, esp: 1, am: AM_EA, amS: AM_STACK, br: BK_FAR, dyn: 1, ms: 1 }),
    R({ pc: PC_1, kind: UK_BR, br: BK_JMPI, rE: 1, sz: SZ_O }),
    R({ uR: 12, uM: 12, br: BK_FAR, dyn: 1, ms: 1 }),
    R({ uR: 0, uM: 0, esp: 1, am: AM_EA, amS: AM_STACK, rE: 1, sz: SZ_O }),
    P686_RUD];
  // 0F xx
  const sys = o => R(Object.assign({ uR: 8, uM: 8, ms: 1 }, o));
  P686_G0F[0x00] = [R({ uR: 2, uM: 2, wE: 1 }), R({ uR: 2, uM: 2, wE: 1 }), sys({ rE: 1, ser: 1, dyn: 1 }), sys({ rE: 1, ser: 1, dyn: 1 }),
    sys({ uR: 6, uM: 6, rE: 1, fW: 1, dyn: 1 }), sys({ uR: 6, uM: 6, rE: 1, fW: 1, dyn: 1 }), P686_RUD, P686_RUD];
  P686_G0F[0x01] = [R({ uR: 4, uM: 4 }), R({ uR: 4, uM: 4 }), sys({ ser: 1 }), sys({ ser: 1 }), R({ uR: 2, uM: 2, wE: 1 }), P686_RUD,
    sys({ rE: 1, ser: 1 }), sys({ uR: 10, uM: 10, ser: 1 })];
  P686_R0F[0x02] = P686_R0F[0x03] = sys({ rE: 1, wG: 1, fW: 1, dyn: 1, sz: SZ_O });
  P686_R0F[0x06] = sys({ ser: 1 });
  P686_R0F[0x08] = P686_R0F[0x09] = sys({ uR: 16, uM: 16, ser: 1 });
  P686_R0F[0x20] = P686_R0F[0x21] = R({ uR: 3, uM: 3 });
  P686_R0F[0x22] = P686_R0F[0x23] = sys({ uR: 10, uM: 10, ser: 1 });
  P686_R0F[0x30] = sys({ uR: 24, uM: 24, ser: 1, rM: P6M_EAX | P6M_ECX | P6M_EDX });
  P686_R0F[0x31] = sys({ uR: 15, uM: 15, wM: P6M_EAX | P6M_EDX });
  P686_R0F[0x32] = P686_R0F[0x33] = sys({ uR: 20, uM: 20, rM: P6M_ECX, wM: P6M_EAX | P6M_EDX });
  for (let b = 0x40; b < 0x50; b++) P686_R0F[b] = R({ uR: 2, uM: 2, kind: UK_CMOV, rG: 1, rE: 1, wG: 1, fR: 1, sz: SZ_O });
  for (let b = 0x80; b < 0x90; b++) P686_R0F[b] = R({ pc: PC_1, kind: UK_BR, fR: 1, br: BK_JCC });
  for (let b = 0x90; b < 0xA0; b++) P686_R0F[b] = R({ fR: 1, wE: 1, sz: SZ_B });
  P686_R0F[0xA0] = P686_R0F[0xA8] = push({});
  P686_R0F[0xA1] = P686_R0F[0xA9] = R({ uR: 4, uM: 4, esp: 1, am: AM_STACK, dyn: 1, ms: 1 });
  P686_R0F[0xA2] = sys({ uR: 36, uM: 36, ser: 1, rM: P6M_EAX | P6M_ECX, wM: P6M_EAX | P6M_EBX | P6M_ECX | P6M_EDX });
  P686_R0F[0xA3] = R({ uR: 1, uM: 6, rG: 1, rE: 1, fW: 1, sz: SZ_O });
  P686_R0F[0xAB] = P686_R0F[0xB3] = P686_R0F[0xBB] = R({ uR: 1, uM: 8, rG: 1, rE: 1, wE: 1, fW: 1, sz: SZ_O });
  P686_R0F[0xA4] = P686_R0F[0xAC] = R({ uR: 2, uM: 2, pc: PC_0, kind: UK_SHIFT, rG: 1, rE: 1, wE: 1, fW: 1, sz: SZ_O });
  P686_R0F[0xA5] = P686_R0F[0xAD] = R({ uR: 2, uM: 2, pc: PC_0, kind: UK_SHIFT, rG: 1, rE: 1, wE: 1, fW: 1, rM: P6M_ECX, sz: SZ_O });
  P686_R0F[0xAF] = R({ pc: PC_0, lat: 4, kind: UK_MUL, rG: 1, rE: 1, wG: 1, fW: 1, sz: SZ_O });
  P686_R0F[0xB0] = P686_R0F[0xB1] = R({ uR: 4, uM: 4, rG: 1, rE: 1, wE: 1, rM: P6M_EAX, wM: P6M_EAX, fW: 1 });
  P686_R0F[0xB2] = P686_R0F[0xB4] = P686_R0F[0xB5] = R({ uR: 4, uM: 4, wG: 1, dyn: 1, sz: SZ_O });
  for (const b of [0xB6, 0xB7, 0xBE, 0xBF]) P686_R0F[b] = R({ uR: 1, uM: 0, rE: 1, wG: 1, sz: SZ_O });
  P686_G0F[0xBA] = [P686_RUD, P686_RUD, P686_RUD, P686_RUD, R({ rE: 1, fW: 1, sz: SZ_O }),
    R({ rE: 1, wE: 1, fW: 1, sz: SZ_O }), R({ rE: 1, wE: 1, fW: 1, sz: SZ_O }), R({ rE: 1, wE: 1, fW: 1, sz: SZ_O })];
  P686_R0F[0xBC] = P686_R0F[0xBD] = R({ uR: 2, uM: 2, rE: 1, wG: 1, fW: 1, sz: SZ_O });
  P686_R0F[0xC0] = P686_R0F[0xC1] = R({ uR: 3, uM: 3, rG: 1, rE: 1, wG: 1, wE: 1, fW: 1 });
  const c8b = R({ uR: 8, uM: 8, rM: P6M_EAX | P6M_EDX | P6M_EBX | P6M_ECX, wM: P6M_EAX | P6M_EDX, fW: 1, ms: 1 });
  P686_G0F[0xC7] = [P686_RUD, c8b, P686_RUD, P686_RUD, P686_RUD, P686_RUD, P686_RUD, P686_RUD];
  for (let b = 0xC8; b < 0xD0; b++) P686_R0F[b] = R({ uR: 2, uM: 2, rO: 1, wO: 1, sz: SZ_O });
}
// FPU recipes by opcode (D8-DF) and ModR/M byte: P686_FP[(op & 7) * 256 + modrm].
const P686_FP = [];
{
  const F = o => P686R(Object.assign({ fp: 1, pc: PC_0, kind: UK_FADD, lat: 3 }, o));
  const ms = n => F({ uR: n, uM: n, ms: 1, kind: UK_MS, lat: 1, fs: 1, fd: 1, fsw: 1 });
  const arith = (reg, fd) => (reg === 2 || reg === 3 ? F({ kind: UK_FCMP, lat: 1, fs: fd === 0 ? 1 : 3, fsw: 1 })
    : reg === 1 ? F({ kind: UK_FMUL, lat: 5, unit: UN_FMUL, fs: fd === 0 ? 1 : 3, fd: fd || 1 })
      : reg >= 6 ? F({ kind: UK_FDIV, lat: 37, unit: UN_DIV, fs: fd === 0 ? 1 : 3, fd: fd || 1 })
        : F({ fs: fd === 0 ? 1 : 3, fd: fd || 1 }));
  const iarith = reg => (reg === 2 || reg === 3 ? F({ uR: 3, uM: 3, kind: UK_FCMP, lat: 1, fs: 1, fsw: 1 })
    : reg === 1 ? F({ uR: 3, uM: 3, kind: UK_FMUL, lat: 5, unit: UN_FMUL, fs: 1, fd: 1 })
      : reg >= 6 ? F({ uR: 3, uM: 3, kind: UK_FDIV, lat: 37, unit: UN_DIV, fs: 1, fd: 1 }) : F({ uR: 3, uM: 3, fs: 1, fd: 1 }));
  for (let x = 0; x < 8; x++) {
    const op = 0xD8 + x;
    for (let m = 0; m < 256; m++) {
      const mod = m >> 6, reg = (m >> 3) & 7;
      let r = null;
      if (mod !== 3) {
        switch (op) {
          case 0xD8: case 0xDC: r = arith(reg, 0); break;
          case 0xDA: case 0xDE: r = iarith(reg); break;
          case 0xD9: r = [F({ uM: 0, kind: UK_FMOV, fd: 3 }), null, F({ uM: 0, kind: UK_FMOV, fs: 1 }), F({ uM: 0, kind: UK_FMOV, fs: 1 }),
            ms(30), F({ uM: 3, lat: 1, kind: UK_MS, fsw: 1 }), ms(48), F({ uM: 0, kind: UK_FMOV })][reg]; break;
          case 0xDB: r = [F({ uM: 2, lat: 5, kind: UK_FMOV, fd: 3 }), null, F({ uM: 2, lat: 5, kind: UK_FMOV, fs: 1 }), F({ uM: 2, lat: 5, kind: UK_FMOV, fs: 1 }),
            null, F({ uM: 2, lat: 1, kind: UK_FMOV, fd: 3 }), null, F({ uM: 2, lat: 1, kind: UK_FMOV, fs: 1 })][reg]; break;
          case 0xDD: r = [F({ uM: 0, kind: UK_FMOV, fd: 3 }), null, F({ uM: 0, kind: UK_FMOV, fs: 1 }), F({ uM: 0, kind: UK_FMOV, fs: 1 }),
            ms(80), null, F({ uM: 120, uR: 120, ms: 1, ser: 1, kind: UK_MS, lat: 1, fs: 1 }), F({ uM: 0, kind: UK_FMOV, fs: 4 })][reg]; break;
          default: r = [F({ uM: 2, lat: 5, kind: UK_FMOV, fd: 3 }), null, F({ uM: 2, lat: 5, kind: UK_FMOV, fs: 1 }), F({ uM: 2, lat: 5, kind: UK_FMOV, fs: 1 }),
            F({ uM: 36, uR: 36, ms: 1, kind: UK_MS, lat: 1, fd: 3 }), F({ uM: 2, lat: 5, kind: UK_FMOV, fd: 3 }),
            F({ uM: 160, uR: 160, ms: 1, kind: UK_MS, lat: 1, fs: 1 }), F({ uM: 2, lat: 5, kind: UK_FMOV, fs: 1 })][reg];
        }
      } else {
        switch (op) {
          case 0xD8: r = arith(reg, 1); break;
          case 0xDC: r = arith(reg, 2); break;
          case 0xDE: r = m === 0xD9 ? F({ uR: 2, kind: UK_FCMP, lat: 1, fs: 3, fsw: 1 }) : arith(reg, 2); break;
          case 0xD9:
            if (reg === 0) r = F({ kind: UK_FMOV, lat: 1, fs: 2, fd: 3 });
            else if (reg === 1) r = F({ kind: UK_FXCH, pc: PC_NONE, lat: 0, fs: 3 });
            else if (m === 0xD0) r = F({ kind: UK_NOP, lat: 1 });
            else if (m === 0xE0 || m === 0xE1) r = F({ kind: UK_FMOV, lat: 1, fs: 1, fd: 1 });
            else if (m === 0xE4) r = F({ kind: UK_FCMP, lat: 1, fs: 1, fsw: 1 });
            else if (m === 0xE5) r = F({ kind: UK_FCMP, lat: 2, fs: 1, fsw: 1 });
            else if (m >= 0xE8 && m <= 0xEE) r = F({ uR: 2, kind: UK_FMOV, lat: 1, fd: 3 });
            else if (m === 0xF6 || m === 0xF7) r = F({ kind: UK_FMOV, lat: 1 });
            else if (m === 0xFA) r = F({ kind: UK_FDIV, lat: 69, unit: UN_DIV, fs: 1, fd: 1 });
            else if (m >= 0xF0) r = ms({ 0xF0: 60, 0xF1: 100, 0xF2: 200, 0xF3: 150, 0xF4: 15, 0xF5: 30, 0xF8: 30, 0xF9: 100, 0xFB: 150, 0xFC: 30, 0xFD: 6, 0xFE: 100, 0xFF: 100 }[m] || 20);
            break;
          case 0xDA:
            if (m < 0xE0) r = F({ uR: 2, kind: UK_FMOV, lat: 1, fR: 1, fs: 3, fd: 1 });
            else if (m === 0xE9) r = F({ uR: 2, kind: UK_FCMP, lat: 1, fs: 3, fsw: 1 });
            break;
          case 0xDB:
            if (m < 0xE0) r = F({ uR: 2, kind: UK_FMOV, lat: 1, fR: 1, fs: 3, fd: 1 });
            else if (m === 0xE3) r = ms(12);
            else if (m === 0xE2) r = F({ uR: 3, kind: UK_MS, lat: 1, fsw: 1 });
            else if (m >= 0xE8 && m <= 0xF7) r = F({ kind: UK_FCMP, lat: 1, fs: 3, fW: 1 });
            else r = F({ kind: UK_NOP, lat: 1 });
            break;
          case 0xDD:
            if (reg === 0) r = F({ kind: UK_NOP, lat: 1 });
            else if (reg === 2 || reg === 3) r = F({ kind: UK_FMOV, lat: 1, fs: 1, fd: 2 });
            else if (reg === 4 || reg === 5) r = F({ kind: UK_FCMP, lat: 1, fs: 3, fsw: 1 });
            break;
          default:
            if (m === 0xE0) r = F({ uR: 3, kind: UK_FMOV, lat: 3, fs: 4, wM: P6M_EAX });
            else if (m >= 0xE8 && m <= 0xF7) r = F({ uR: 2, kind: UK_FCMP, lat: 1, fs: 3, fW: 1 });
            else if (reg === 0) r = F({ kind: UK_NOP, lat: 1 });
        }
      }
      P686_FP.push(r || F({ uR: 2, uM: 2, kind: UK_MS, lat: 1 }));
    }
  }
}
// Scalar state of the model (cpu.oS, a Float64Array): the indexes.
const O_DCLK = 0, O_DSLOT = 1, O_DBYTES = 2, O_FETCH = 3, O_ICLK = 4, O_ICNT = 5, O_RCLK = 6, O_RCNT = 7, O_DIV = 8,
  O_FMUL = 9, O_FSB = 10, O_STA = 11, O_SBLAST = 12, O_PREV = 13, O_AVAIL = 14, O_MINISS = 15, O_UOP = 16, O_SEQ = 17,
  O_TOG = 18, O_URET = 19, O_UDISP = 20, O_CYC = 21, O_N = 22;
// ---- The out-of-order model in WebAssembly (src/core/p6ooo.c; the module is in p6ooo.wasm.js) ----
// The fast mode uses the C model; the trace uses the JavaScript model (it makes the trace events).
// Both use the same state: after the attach, the typed arrays of the model are views into the
// memory of the module. The inputs of a step (IN_*), the counters (ST_*: oooStats and btb.stats
// are objects of getters and setters over them) and the ring positions (SC_*) are there too.
const IN_OP = 0, IN_OP2 = 1, IN_MOD = 2, IN_REG = 3, IN_RM = 4, IN_OSZ = 5, IN_A32 = 6, IN_REP = 7, IN_LOCK = 8, IN_ILEN = 9,
  IN_CLK = 10, IN_NLD = 11, IN_NST = 12, IN_FPTOP = 13, IN_CODELAT = 14, IN_CODEBUS = 15, IN_CYCLES = 16, IN_FPUPC = 17, IN_EA = 18,
  IN_LA = 19, IN_TAKEN = 20, IN_TARGET = 21, IN_SBYTE = 22, IN_CALLRET = 23;
const P686_STN = ['steps', 'instructions', 'uops', 'floor', 'robFull', 'rsFull', 'sbFull', 'partial', 'forwards', 'ldBlocks',
  'splitLoads', 'serial', 'mispredicts', 'baclears', 'mul', 'div', 'flops', 'haltClk'];
const P686_BSN = ['branches', 'lookups', 'hits', 'misses', 'right', 'wrong', 'allocs', 'taken', 'staticRight', 'staticWrong', 'rsbRight', 'rsbWrong'];
const SC_ROBPOS = 0, SC_RSPOS = 1, SC_SBPOS = 2, SC_RSBTOP = 3;
const P686_RF = ['uR', 'uM', 'pc', 'lat', 'kind', 'unit', 'rG', 'wG', 'rE', 'wE', 'rO', 'wO', 'rM', 'wM', 'fR', 'fW', 'sz', 'am', 'amS', 'aM',
  'esp', 'br', 'ser', 'ms', 'dyn', 'lea', 'lk', 'fp', 'fs', 'fd', 'fsw'];
// All the recipes, with their index (the same order in each module instance).
let P686_RECS = null;
function p686Recipes() {
  if (P686_RECS) return P686_RECS;
  const out = [], add = r => { if (r && typeof r === 'object' && r.uR !== undefined && r.id < 0) { r.id = out.length; out.push(r); } };
  const walk = a => { for (const x of a) { if (Array.isArray(x)) walk(x); else add(x); } };
  add(P686_EXC); add(P686_INT); add(P686_RUD);
  walk(P686_R1); walk(P686_G1); walk(P686_R0F); walk(P686_G0F); walk(P686_FP);
  return (P686_RECS = out);
}
// The module: compiled once (in the background in a page: a large module may not compile on the
// main thread), then one instance for each CPU.
const P6W = { mod: null, busy: false };
function p6wModule() {
  if (P6W.mod || P6W.busy || typeof P6OOO_WASM === 'undefined' || typeof WebAssembly === 'undefined') return P6W.mod;
  const bin = typeof Buffer !== 'undefined' ? Uint8Array.from(Buffer.from(P6OOO_WASM, 'base64')) : Uint8Array.from(atob(P6OOO_WASM), c => c.charCodeAt(0));
  if (typeof window === 'undefined') { try { P6W.mod = new WebAssembly.Module(bin); } catch (e) { P6W.mod = null; } return P6W.mod; }
  P6W.busy = true;
  WebAssembly.compile(bin).then(m => { P6W.mod = m; }, () => {}).finally(() => { P6W.busy = false; });
  return null;
}
// An object of getters and setters for the names, over the array A from index k0.
function p6wStats(names, A, k0, extra) {
  const o = {};
  names.forEach((n, i) => Object.defineProperty(o, n, { get: () => A[k0 + i], set: v => { A[k0 + i] = v; }, enumerable: true }));
  if (extra) Object.assign(o, extra);
  return o;
}

// Pseudo-LRU of a 4-way set (the 80486 tree: B0 selects the half, B1 / B2 the way in the half).
function p686Touch(L, set, w) {
  let b = L[set];
  switch (w) { case 0: b |= 3; break; case 1: b = (b | 1) & ~2; break; case 2: b = (b & ~1) | 4; break; default: b &= ~5; }
  L[set] = b;
}
function p686Victim(T, L, set) {
  const k = set << 2;
  if (T[k] < 0) return 0;
  if (T[k + 1] < 0) return 1;
  if (T[k + 2] < 0) return 2;
  if (T[k + 3] < 0) return 3;
  const b = L[set];
  return !(b & 1) ? (b & 2 ? 1 : 0) : (b & 4 ? 3 : 2);
}
// The P6 performance events of this core (the event select numbers of PerfEvtSel0 / 1, bits 0-7).
const P686_EVENTS = {
  0x03: 'LD_BLOCKS', 0x12: 'MUL', 0x13: 'DIV', 0x24: 'L2_LINES_IN', 0x26: 'L2_LINES_OUT', 0x2E: 'L2_RQSTS', 0x43: 'DATA_MEM_REFS',
  0x45: 'DCU_LINES_IN', 0x47: 'DCU_M_LINES_OUT', 0x79: 'CPU_CLK_UNHALTED', 0x80: 'IFU_IFETCH', 0x81: 'IFU_IFETCH_MISS',
  0x85: 'ITLB_MISS', 0xA2: 'RESOURCE_STALLS', 0xC0: 'INST_RETIRED', 0xC1: 'FLOPS', 0xC2: 'UOPS_RETIRED',
  0xC4: 'BR_INST_RETIRED', 0xC5: 'BR_MISS_PRED_RETIRED', 0xC9: 'BR_TAKEN_RETIRED', 0xD0: 'INST_DECODED',
  0xD2: 'PARTIAL_RAT_STALLS', 0xE2: 'BTB_MISSES', 0xE6: 'BACLEARS',
};

class CPU80686 extends CPU80586 {
  constructor(bus) {
    super(bus);
    this.fdivBug = false;       // the P6 has no FDIV bug (the P5 switch has no effect here)
  }
  // The constructor of CPU8086 calls reset(), which makes the P6 state on the first call.
  reset() {
    super.reset();                              // the P5 reset (the 486 reset calls cacheMake())
    this.r[2] = CPU80686.SIGNATURE;             // EDX after reset: the CPUID signature
    this.cr[4] = 0;
    this.evtSel = this.evtSel || new Float64Array(2);   // PerfEvtSel0 / 1 (the P5 reset clears ctrBase and ctrRaw)
    this.evtSel.fill(0);
    this.mcgCtl = this.mcgCtl || new Uint32Array(2);
    this.mcCtl = this.mcCtl || new Uint32Array(10);   // MC0_CTL - MC4_CTL (low and high dwords)
    this.mcgCtl.fill(0); this.mcCtl.fill(0);
    this.ucodeRev = 0;
    this.oooReset();
  }

  // ---------- the caches, the BTB and the out-of-order state ----------
  // The 486 reset calls this when cache486 is not set (the P5 reset sets it to null after it).
  // It makes all the P6 parts one time.
  cacheMake() {
    this.cache486 = { stats: {} };
    if (this.l2) return;
    // L1 data cache: 128 sets x 2 ways (line i = set * 2 + way), the P5 layout: tag = physical
    // address bits 12-31 (-1 = invalid), state = MESI, lru[set] = the way that the next fill replaces.
    this.dcache = { sets: 128, ways: 2, lineSize: 32, tag: new Int32Array(256).fill(-1), state: new Uint8Array(256), lru: new Uint8Array(128),
      data: new Uint8Array(8192),
      stats: { hits: 0, misses: 0, fills: 0, uncached: 0, writeHits: 0, writeMisses: 0, writeHitsME: 0, writeBacks: 0, rfo: 0, flushes: 0, invalidations: 0 } };
    // L1 code cache: 64 sets x 4 ways (line i = set * 4 + way): tag = physical address bits 11-31,
    // lru[set] = the pseudo-LRU bits. The code lines are S or I.
    this.icache = { sets: 64, ways: 4, lineSize: 32, tag: new Int32Array(256).fill(-1), lru: new Uint8Array(64), data: new Uint8Array(8192),
      stats: { hits: 0, misses: 0, fills: 0, uncached: 0, flushes: 0, invalidations: 0 } };
    // L2: 2048 sets x 4 ways (line i = set * 4 + way): tag = physical address bits 16-31. The L2 keeps
    // no data (memory has the newest bytes): the tags and the MESI states are for the timing.
    this.l2 = { sets: 2048, ways: 4, lineSize: 32, tag: new Int32Array(8192).fill(-1), state: new Uint8Array(8192), lru: new Uint8Array(2048),
      stats: { requests: 0, hits: 0, misses: 0, codeRequests: 0, codeMisses: 0, fills: 0, writeBacks: 0, flushes: 0, invalidations: 0 } };
    this.dtag = this.dcache.tag; this.itag = this.icache.tag; this.ctag = this.dtag; this.l2tag = this.l2.tag;
    // The TLBs of the P5 (the P6 has the same sizes): tlb4m (4 MB data pages), itlb (code).
    const ents = n => { const a = []; for (let i = 0; i < n; i++) a.push({ lin: 0, phys: 0, flags: 0, valid: false }); return a; };
    this.tlb4m = ents(8); this.tlb4mNext = new Uint8Array(2);
    this.itlb = ents(32); this.itlbNext = new Uint8Array(8);
    // BTB: 128 sets x 4 ways (entry = set * 4 + way, set = linear address bits 0-6, the tag = the
    // whole address). Each entry has the target, a history of the last 4 outcomes of the branch and
    // a table of 16 2-bit counters (pht[entry * 16 + history]): the two-level prediction.
    // counter[entry] = the counter that the next prediction of the entry uses (for the views).
    // rsb: the return stack buffer (16 return addresses; rsbTop = the next free slot).
    this.btb = { sets: 128, ways: 4, tag: new Int32Array(512).fill(-1), target: new Uint32Array(512), hist: new Uint8Array(512),
      pht: new Uint8Array(8192), counter: new Uint8Array(512), next: new Uint8Array(128), rsb: new Uint32Array(16), rsbTop: 0,
      stats: { branches: 0, lookups: 0, hits: 0, misses: 0, right: 0, wrong: 0, allocs: 0, taken: 0, staticRight: 0, staticWrong: 0, rsbRight: 0, rsbWrong: 0 } };
    this.pipeStats = { u: 0, v: 0, floor: 0, why: new Uint32Array(P586_WHY.length), reasons: P586_WHY };   // the P5 reset clears it
    this.pMemo = new Int32Array(1); this.pMemoV = new Int32Array(1); this.pMemoW = new Uint8Array(1);
    // The ROB: 40 entries in a ring; the entry number is the physical register of the µop's result.
    // The state of an entry at clock t: empty (t < issue or t >= retire), waiting in the RS (issue
    // <= t < dispatch), executing (dispatch <= t < done), done (done <= t < retire).
    this.rob = { size: 40, head: 0, uop: new Float64Array(40), instr: new Float64Array(40), kind: new Uint8Array(40), port: new Int8Array(40),
      src1: new Int8Array(40), src2: new Int8Array(40), dst: new Int8Array(40), issue: new Float64Array(40), dispatch: new Float64Array(40),
      done: new Float64Array(40), retire: new Float64Array(40), kinds: P686_UK, regs: P686_RN };
    // The reservation station: 20 entries; an entry holds a µop from its issue to its dispatch.
    this.rs = { size: 20, uop: new Float64Array(20), rob: new Int8Array(20), issue: new Float64Array(20), dispatch: new Float64Array(20) };
    // The RAT: for each register of P686_RN the ROB entry of its newest producer (-1 = the RRF, the
    // retired register file), the clock at which its value is ready, the retire clock of the
    // producer and the width of the last write (1, 2 or 4 bytes: a wider read waits for the retire).
    this.rat = { rob: new Int8Array(18), ready: new Float64Array(18), retire: new Float64Array(18), width: new Uint8Array(18), names: P686_RN };
    // The ports: busy[p * 512 + (t & 511)] = t when port p takes a µop at clock t (a calendar),
    // uops[p] = the µops that port p took. names: the units of each port.
    this.ports = { busy: new Float64Array(5 * P686_CAL), uops: new Float64Array(5),
      names: ['port 0: ALU, shift, LEA, multiply, divide, FPU', 'port 1: ALU, branch', 'port 2: load', 'port 3: store address', 'port 4: store data'] };
    // The store buffer: 12 entries in a ring (linear address, size, the clock of the data (STD) and the
    // clock at which the store is in the cache (commit, after its retire)).
    this.sb = { size: 12, addr: new Uint32Array(12), bytes: new Uint8Array(12), std: new Float64Array(12), commit: new Float64Array(12), rob: new Int8Array(12) };
    this.oS = new Float64Array(O_N);
    // The loads and stores of the current step (the rd() / wr() accesses): linear address, size, the
    // latency more than an L1 hit, the FSB clocks.
    this.ldAddr = new Uint32Array(P686_MAXM); this.ldSize = new Uint8Array(P686_MAXM); this.ldLat = new Float64Array(P686_MAXM); this.ldBus = new Float64Array(P686_MAXM);
    this.stAddr = new Uint32Array(P686_MAXM); this.stSize = new Uint8Array(P686_MAXM); this.stLat = new Float64Array(P686_MAXM); this.stBus = new Float64Array(P686_MAXM);
    this.oooStats = { steps: 0, instructions: 0, uops: 0, floor: 0, robFull: 0, rsFull: 0, sbFull: 0, partial: 0, forwards: 0, ldBlocks: 0,
      splitLoads: 0, serial: 0, mispredicts: 0, baclears: 0, mul: 0, div: 0, flops: 0, haltClk: 0,
      decoders: new Float64Array(4) };    // decoders: the instructions of D0, D1, D2 and the MSROM
    // Scratch fields of a step (numbers and trace arrays).
    this.nLd = 0; this.nSt = 0; this.accLat = 0; this.accBus = 0; this.codeLat = 0; this.codeBus = 0;
    this.strCont = false; this.opPos = 0; this.fpTop = 0; this.l2Seen = false; this.l2cSeen = false;
    this.uRob = 0; this.uWait = 0; this.robPos = 0; this.rsPos = 0; this.sbPos = 0; this.sbRob = -1; this.ldFwd = 0;
    // The WebAssembly model: w6 = its exports after the attach (null: the JavaScript model only),
    // w6In / w6SC = the views of its inputs and ring positions, w6Off = false: never attach.
    this.w6 = null; this.w6In = null; this.w6SC = null; this.w6Inst = null; this.w6Off = false; this.w6Wait = false;
    this.busRatio = 3; this.trDec = 0; this.trDecoder = 0; this.trN = 0; this.trT0 = -1; this.trFirst = 0; this.trFloor = 0;
    this.uopEv = []; this.trSrc = []; this.trRat = null; this.btbEv = null;
  }
  // The out-of-order state after reset: no µop in the machine, all clocks 0.
  oooReset() {
    const R = this.rob, S = this.rs, T = this.rat, P = this.ports, B = this.btb, st = this.oooStats;
    R.uop.fill(-1); R.instr.fill(-1); R.kind.fill(0); R.port.fill(-1); R.src1.fill(-1); R.src2.fill(-1); R.dst.fill(-1);
    R.issue.fill(-1); R.dispatch.fill(-1); R.done.fill(-1); R.retire.fill(-1); R.head = 0;
    S.uop.fill(-1); S.rob.fill(-1); S.issue.fill(-1); S.dispatch.fill(-1);
    T.rob.fill(-1); T.ready.fill(0); T.retire.fill(0); T.width.fill(4);
    P.busy.fill(-1); P.uops.fill(0);
    this.sb.addr.fill(0); this.sb.bytes.fill(0); this.sb.std.fill(-1); this.sb.commit.fill(-1); this.sb.rob.fill(-1);
    this.oS.fill(0);
    B.hist.fill(0); B.pht.fill(0); B.rsb.fill(0); B.rsbTop = 0;
    for (const k of Object.keys(B.stats)) B.stats[k] = 0;
    for (const k of Object.keys(st)) if (typeof st[k] === 'number') st[k] = 0;
    st.decoders.fill(0);
    const L = this.l2;
    for (const k of Object.keys(L.stats)) L.stats[k] = 0;
    this.robPos = 0; this.rsPos = 0; this.sbPos = 0;
    if (this.w6) this.w6Push();
  }
  // ---- the WebAssembly model ----
  // Start the instance (in a page: in the background; the JavaScript model runs until it is there).
  w6Start() {
    if (this.w6Off || this.w6 || this.w6Wait) return;
    if (typeof P6OOO_WASM === 'undefined' || typeof WebAssembly === 'undefined') { this.w6Off = true; return; }
    const mod = p6wModule();
    if (!mod) return;
    if (typeof window === 'undefined') { this.w6Attach(new WebAssembly.Instance(mod)); return; }
    this.w6Wait = true;
    WebAssembly.instantiate(mod).then(i => { this.w6Inst = i; }, () => { this.w6Off = true; });
  }
  // Move the state of the model into the module memory, and use views of it from now on.
  w6Attach(inst) {
    const X = inst.exports, buf = X.memory.buffer, off = new Int32Array(buf, X.offsets(), 64);
    let k = 0;
    const V = (T, n, src) => { const a = new T(buf, off[k++], n); if (src) a.set(src); return a; };
    const R = this.rob, S = this.rs, T = this.rat, P = this.ports, SB = this.sb, B = this.btb;
    this.oS = V(Float64Array, 22, this.oS);
    this.w6In = V(Float64Array, 24);
    const STA = V(Float64Array, 30);
    const dec = V(Float64Array, 4, this.oooStats.decoders);
    P686_STN.forEach((n, i) => { STA[i] = this.oooStats[n]; });
    P686_BSN.forEach((n, i) => { STA[18 + i] = B.stats[n]; });
    for (const f of ['uop', 'instr', 'issue', 'dispatch', 'done', 'retire']) R[f] = V(Float64Array, 40, R[f]);
    for (const f of ['port', 'src1', 'src2', 'dst']) R[f] = V(Int8Array, 40, R[f]);
    R.kind = V(Uint8Array, 40, R.kind);
    for (const f of ['uop', 'issue', 'dispatch']) S[f] = V(Float64Array, 20, S[f]);
    S.rob = V(Int8Array, 20, S.rob);
    T.rob = V(Int8Array, 18, T.rob); T.ready = V(Float64Array, 18, T.ready); T.retire = V(Float64Array, 18, T.retire); T.width = V(Uint8Array, 18, T.width);
    P.busy = V(Float64Array, 5 * P686_CAL, P.busy); P.uops = V(Float64Array, 5, P.uops);
    SB.addr = V(Uint32Array, 12, SB.addr); SB.bytes = V(Uint8Array, 12, SB.bytes); SB.std = V(Float64Array, 12, SB.std); SB.commit = V(Float64Array, 12, SB.commit); SB.rob = V(Int8Array, 12, SB.rob);
    this.ldAddr = V(Uint32Array, P686_MAXM, this.ldAddr); this.ldSize = V(Uint8Array, P686_MAXM, this.ldSize); this.ldLat = V(Float64Array, P686_MAXM, this.ldLat); this.ldBus = V(Float64Array, P686_MAXM, this.ldBus);
    this.stAddr = V(Uint32Array, P686_MAXM, this.stAddr); this.stSize = V(Uint8Array, P686_MAXM, this.stSize); this.stLat = V(Float64Array, P686_MAXM, this.stLat); this.stBus = V(Float64Array, P686_MAXM, this.stBus);
    B.tag = V(Int32Array, 512, B.tag); B.target = V(Uint32Array, 512, B.target); B.hist = V(Uint8Array, 512, B.hist); B.pht = V(Uint8Array, 8192, B.pht);
    B.counter = V(Uint8Array, 512, B.counter); B.next = V(Uint8Array, 128, B.next); B.rsb = V(Uint32Array, 16, B.rsb);
    this.w6SC = V(Int32Array, 4);
    const recOff = off[k++], recSize = off[k++];
    const recs = p686Recipes();
    if (recs.length > 4096) { this.w6Off = true; return; }       // (MAXREC in p6ooo.c)
    const RI = new Int32Array(buf, recOff, recs.length * (recSize >> 2));
    recs.forEach((r, i) => P686_RF.forEach((f, j) => { RI[i * (recSize >> 2) + j] = r[f]; }));
    this.oooStats = p6wStats(P686_STN, STA, 0, { decoders: dec });
    B.stats = p6wStats(P686_BSN, STA, 18);
    this.w6 = X;
    this.w6Push();
  }
  // The ring positions: JavaScript fields -> the module (after the JavaScript model or a reset).
  w6Push() { const C = this.w6SC; C[SC_ROBPOS] = this.robPos; C[SC_RSPOS] = this.rsPos; C[SC_SBPOS] = this.sbPos; C[SC_RSBTOP] = this.btb.rsbTop; }
  // One step of the C model (the same as ooo(mode) without the trace). R: the recipe of the step.
  w6Ooo(mode, R) {
    const I = this.w6In, mod = this.mod;
    I[IN_OP] = this.op; I[IN_OP2] = this.op2; I[IN_MOD] = mod; I[IN_REG] = this.reg; I[IN_RM] = this.rm;
    I[IN_OSZ] = this.osz; I[IN_A32] = this.a32 ? 1 : 0; I[IN_REP] = this.rep !== 0 ? 1 : 0; I[IN_LOCK] = this.lock ? 1 : 0;
    I[IN_ILEN] = this.ilen; I[IN_CLK] = this.clk; I[IN_NLD] = this.nLd; I[IN_NST] = this.nSt; I[IN_FPTOP] = this.fpTop;
    I[IN_CODELAT] = this.codeLat; I[IN_CODEBUS] = this.codeBus; I[IN_CYCLES] = this.cycles;
    I[IN_FPUPC] = (this.bus.fpu ? this.bus.fpu.cw >> 8 : 3) & 3;
    I[IN_EA] = mod >= 0 && mod !== 3 ? this.eaRegs() : 0;
    if (R.br && mode === 0 && R.br !== BK_FAR) {
      const taken = this.didFlush;
      I[IN_LA] = (this.lastBase + this.lastIP) >>> 0; I[IN_TAKEN] = taken ? 1 : 0;
      I[IN_TARGET] = taken ? (this.cache[CS].base + this.ip) >>> 0 : 0;
      I[IN_SBYTE] = this.ib[this.ilen - 1] & 0x80;
      const ip = this.cache[CS].big ? (this.lastIP + this.ilen) >>> 0 : (this.lastIP + this.ilen) & 0xFFFF;
      I[IN_CALLRET] = (this.lastBase + ip) >>> 0;
    }
    const M = this.w6.ooo(mode, R.id);
    const C = this.w6SC;
    this.robPos = C[SC_ROBPOS]; this.rsPos = C[SC_RSPOS]; this.sbPos = C[SC_SBPOS]; this.btb.rsbTop = C[SC_RSBTOP];
    this.rob.head = this.robPos;
    return M;
  }
  // INVD, WBINVD, reset: all lines of the three caches become invalid.
  cacheFlush() {
    if (!this.dcache) return;
    this.dtag.fill(-1); this.itag.fill(-1); this.dcache.state.fill(P5_I);
    this.dcache.lru.fill(0); this.icache.lru.fill(0);
    this.dcache.stats.flushes++; this.icache.stats.flushes++;
    if (this.l2) { this.l2tag.fill(-1); this.l2.state.fill(P5_I); this.l2.lru.fill(0); this.l2.stats.flushes++; }
  }
  // The machine calls this when a DMA channel (or another bus master) writes memory: the lines of
  // phys .. phys + len - 1 become invalid in the three caches. The core ignores it with CR0.NW = 1
  // (as the 486 and the P5). Memory has the newest CPU bytes, so an M line needs no write-back
  // here. Returns the number of lines that became invalid (L1 and L2).
  cacheInvalidate(phys, len = 1) {
    if (this.cr[0] & C0_NW) return 0;
    const DT = this.dtag, IT = this.itag, LT = this.l2tag, end = phys + len;
    let nd = 0, ni = 0, nl = 0;
    if (len >= 0x2000) {
      for (let i = 0; i < 256; i++) {
        if (DT[i] >= 0) { const a = this.lineAddr(DT[i], i); if (a + 32 > phys && a < end) { DT[i] = -1; this.dcache.state[i] = P5_I; nd++; } }
        if (IT[i] >= 0) { const a = this.iLineAddr(IT[i], i); if (a + 32 > phys && a < end) { IT[i] = -1; ni++; } }
      }
      for (let i = 0; i < 8192; i++) {
        if (LT[i] >= 0) { const a = this.l2LineAddr(LT[i], i); if (a + 32 > phys && a < end) { LT[i] = -1; this.l2.state[i] = P5_I; nl++; } }
      }
    } else {
      for (let a = phys - (phys & 31); a < end; a += 32) {
        const pa = a >>> 0;
        let i = this.dFind(pa);
        if (i >= 0) { DT[i] = -1; this.dcache.state[i] = P5_I; nd++; }
        i = this.iFind(pa);
        if (i >= 0) { IT[i] = -1; ni++; }
        i = this.l2Find(pa);
        if (i >= 0) { LT[i] = -1; this.l2.state[i] = P5_I; nl++; }
      }
    }
    this.dcache.stats.invalidations += nd; this.icache.stats.invalidations += ni; this.l2.stats.invalidations += nl;
    return nd + ni + nl;
  }
  iFind(pa) { const b = ((pa >>> 5) & 63) << 2, t = pa >>> 11, T = this.itag; return T[b] === t ? b : T[b + 1] === t ? b + 1 : T[b + 2] === t ? b + 2 : T[b + 3] === t ? b + 3 : -1; }
  l2Find(pa) { const b = ((pa >>> 5) & 2047) << 2, t = pa >>> 16, T = this.l2tag; return T[b] === t ? b : T[b + 1] === t ? b + 1 : T[b + 2] === t ? b + 2 : T[b + 3] === t ? b + 3 : -1; }
  iLineAddr(tag, i) { return ((tag << 11) | ((i >> 2) << 5)) >>> 0; }
  l2LineAddr(tag, i) { return ((tag << 16) | ((i >> 2) << 5)) >>> 0; }
  // One FSB transfer: 2 + wait states bus clocks (the first transfer of a burst), 1 + wait states
  // for the other transfers; bus.busRatio core clocks for each bus clock (rounded up to whole core
  // clocks, for example with a ratio of 2.5). fsbReq: the request and snoop phases.
  fsbFirst() { return Math.ceil(this.busRatio * (2 + this.ws)); }
  fsbNext() { return Math.ceil(this.busRatio * (1 + this.ws)); }
  fsbReq() { return Math.ceil(this.busRatio * P686_FSBREQ); }
  // The default length of a bus event (an I/O or an uncached access) is one FSB transfer.
  busEv(type, a, v, width, s, len, extra) { return super.busEv(type, a, v, width, s, len === undefined ? this.fsbFirst() : len, extra); }

  // The L2 part of an L1 miss (code or data). j = the L2 line of pa (-1 = none); D / base = the
  // bytes of the new L1 line (for the trace). A hit costs P686_L2LAT clocks. A miss fills the L2
  // line (E, or S with PWT = 1) with a burst of 4 transfers of 8 bytes on the FSB (the 8 bytes that
  // the CPU needs first); an M line that it replaces goes to the FSB first (a write-back burst).
  // The latency goes to accLat (codeLat for code) and the FSB clocks to accBus (codeBus).
  l2Fill(pa, j, attr, code, s, D, base, stall) {
    const L = this.l2, st = L.stats, tr = this.trace, hit = j >= 0;
    st.requests++;
    if (code) st.codeRequests++;
    let lat, busT = 0, wb = -1;
    if (hit) {
      st.hits++;
      p686Touch(L.lru, j >> 2, j & 3);
      lat = P686_L2LAT;
    } else {
      st.misses++;
      if (code) st.codeMisses++;
      const set = (pa >>> 5) & 2047, w = p686Victim(this.l2tag, L.lru, set);
      j = (set << 2) + w;
      if (this.l2tag[j] >= 0 && L.state[j] === P5_M) {
        wb = this.l2LineAddr(this.l2tag[j], j);
        busT += this.wbBurst6(wb, s);
      }
      this.l2tag[j] = pa >>> 16; L.state[j] = attr & 8 ? P5_S : P5_E; st.fills++;
      p686Touch(L.lru, set, w);
      const line = (pa - (pa & 31)) >>> 0, first = (pa >>> 3) & 3, f1 = this.fsbFirst(), fn = this.fsbNext();
      for (let k = 0; k < 4; k++) {
        const o = (first ^ k) << 3, len = k ? fn : f1;
        const extra = tr ? { burst: true, line, beat: k, hi: this.dw(D, base + o + 4) } : undefined;
        if (code) this.codeEv((line + o) >>> 0, tr ? this.dw(D, base + o) : 0, 8, len, stall, extra || null);
        else this.busEv('memr', (line + o) >>> 0, tr ? this.dw(D, base + o) : 0, 8, s, len, extra);
      }
      busT += f1 + 3 * fn + this.fsbReq();
      lat = P686_L2LAT + this.fsbReq() + f1;
    }
    if (code) { this.codeLat += lat; this.codeBus += busT; } else { this.accLat += lat; this.accBus += busT; }
    if (tr && (code ? !this.l2cSeen : !this.l2Seen)) {
      if (code) this.l2cSeen = true; else this.l2Seen = true;
      const e = { k: 'cache', level: 'L2', cache: code ? 'code' : 'data', phys: pa, set: (pa >>> 5) & 2047, way: j & 3, hit,
        fill: !hit, write: false, state: P586_MESI[L.state[j]] };
      if (wb >= 0) { e.wb = true; e.wbLine = wb; }
      this.cacheEv.push(e);
    }
    return j;
  }
  // A write-back burst of a line on the FSB (4 transfers of 8 bytes, 'memw', wb: true). Returns its
  // FSB clocks. The data of the events comes from memory (bus.peek8), which has the newest bytes.
  wbBurst6(line, s) {
    this.l2.stats.writeBacks++;
    const tr = this.trace, f1 = this.fsbFirst(), fn = this.fsbNext(), b = this.bus;
    const pk = tr ? (b.peek8 ? a => b.peek8(a) : a => b.read8(a)) : null;
    const dw = tr ? a => (pk(a) | (pk(a + 1) << 8) | (pk(a + 2) << 16) | (pk(a + 3) << 24)) >>> 0 : null;
    for (let k = 0; k < 4; k++) {
      const a = (line + (k << 3)) >>> 0;
      this.busEv('memw', a, tr ? dw(a) : 0, 8, s, k ? fn : f1, tr ? { burst: true, line, beat: k, hi: dw(a + 4), wb: true } : undefined);
    }
    return f1 + 3 * fn + this.fsbReq();
  }
  // An M line of the L1 data cache goes to the L2 (no FSB cycle): the L2 line becomes M (a new L2
  // line when the L2 does not have it; an M line that it replaces goes to the FSB).
  l2Put(line) {
    const L = this.l2;
    let j = this.l2Find(line);
    if (j < 0) {
      const set = (line >>> 5) & 2047, w = p686Victim(this.l2tag, L.lru, set);
      j = (set << 2) + w;
      if (this.l2tag[j] >= 0 && L.state[j] === P5_M) this.accBus += this.wbBurst6(this.l2LineAddr(this.l2tag[j], j), -1);
      this.l2tag[j] = line >>> 16; L.stats.fills++;
    }
    L.state[j] = P5_M;
    p686Touch(L.lru, j >> 2, j & 3);
  }
  // Data line fill (a read miss, or the RFO of a write miss): the L2, then the FSB. An M line that
  // the fill replaces goes into the L2 (no FSB cycle). The new line is E (S with PWT = 1). Returns
  // the line index.
  dFill(pa, s, attr) {
    const DC = this.dcache, T = this.dtag, set = (pa >>> 5) & 127, line = (pa - (pa & 31)) >>> 0, bus = this.bus;
    const w = T[set << 1] < 0 ? 0 : T[(set << 1) + 1] < 0 ? 1 : DC.lru[set];
    const i = (set << 1) + w, D = DC.data, base = i << 5;
    this.wbLine = -1;
    if (T[i] >= 0 && DC.state[i] === P5_M) { this.wbLine = this.lineAddr(T[i], i); DC.stats.writeBacks++; this.l2Put(this.wbLine); }
    const j = this.l2Find(pa);
    if (j >= 0 && bus.peek8) for (let k = 0; k < 32; k++) D[base + k] = bus.peek8((line + k) >>> 0);
    else for (let k = 0; k < 32; k++) D[base + k] = bus.read8((line + k) >>> 0);
    T[i] = pa >>> 12; DC.state[i] = attr & 8 ? P5_S : P5_E; DC.lru[set] = w ^ 1;
    DC.stats.fills++;
    this.l2Fill(pa, j, attr, false, s, D, base, false);
    return i;
  }
  // WBINVD: the M lines of the L1 data cache go to the L2, then all M lines of the L2 go to the FSB
  // (write-back bursts). Returns the number of bursts. The FSB clocks go to accBus and accLat (the
  // instruction waits for them).
  writeBackAll() {
    const DC = this.dcache, L = this.l2;
    for (let i = 0; i < 256; i++) if (this.dtag[i] >= 0 && DC.state[i] === P5_M) { DC.stats.writeBacks++; this.l2Put(this.lineAddr(this.dtag[i], i)); }
    let n = 0, t = 0;
    for (let i = 0; i < 8192; i++) {
      if (this.l2tag[i] < 0 || L.state[i] !== P5_M) continue;
      t += this.wbBurst6(this.l2LineAddr(this.l2tag[i], i), -1);
      L.state[i] = P5_E;
      n++;
    }
    this.accBus += t; this.accLat += t;
    return n;
  }
  // Code line fill: the L2, then the FSB ('fetch' events). Returns the line index.
  iFill(pa, stall, attr) {
    const IC = this.icache, T = this.itag, set = (pa >>> 5) & 63, line = (pa - (pa & 31)) >>> 0, bus = this.bus;
    const w = p686Victim(T, IC.lru, set), i = (set << 2) + w, D = IC.data, base = i << 5;
    const j = this.l2Find(pa);
    if (j >= 0 && bus.peek8) for (let k = 0; k < 32; k++) D[base + k] = bus.peek8((line + k) >>> 0);
    else for (let k = 0; k < 32; k++) D[base + k] = bus.read8((line + k) >>> 0);
    T[i] = pa >>> 11; p686Touch(IC.lru, set, w);
    IC.stats.fills++;
    this.l2Fill(pa, j, attr, true, -1, D, base, stall);
    return i;
  }
  // The first access of each cache in an instruction gives a 'cache' event (level 'L1').
  cacheNote686(pa, i, hit, fill, write, code, nc) {
    const e = { k: 'cache', level: 'L1', cache: code ? 'code' : 'data', phys: pa, set: code ? (pa >>> 5) & 63 : (pa >>> 5) & 127,
      way: i < 0 ? -1 : code ? i & 3 : i & 1, hit, fill, write, state: i < 0 ? 'I' : code ? 'S' : P586_MESI[this.dcache.state[i]] };
    if (code) { e.code = true; this.codeSeen = true; } else this.cacheSeen = true;
    if (nc) e.nc = true;
    if (fill && !code && this.wbLine >= 0) { e.wb = true; e.wbLine = this.wbLine; }
    this.cacheEv.push(e);
  }

  // ---------- physical access through the L1 data cache and the L2 ----------
  // attr: bit 4 = PCD (no line fill), bit 3 = PWT (write-through: the line stays S).
  physRd(pa, n, s, attr) {
    const off = pa & 31;
    if (off + n > 32) {
      const k = 32 - off;
      this.oooStats.splitLoads++; this.accLat += P686_SPLIT;
      return (this.physRd(pa, k, s, attr) | (this.physRd((pa + k) >>> 0, n - k, s, attr) << (8 * k))) >>> 0;
    }
    const DC = this.dcache, st = DC.stats, T = this.dtag, i0 = ((pa >>> 5) & 127) << 1, tag = pa >>> 12;
    let i = T[i0] === tag ? i0 : T[i0 + 1] === tag ? i0 + 1 : -1, fill = false;
    const hit = i >= 0;
    if (hit) { st.hits++; DC.lru[i0 >> 1] = (i & 1) ^ 1; }
    else {
      st.misses++;
      this.wbLine = -1;
      if (!(this.cr[0] & C0_CD) && !(attr & 0x10) && this.cacheable(pa)) { i = this.dFill(pa, s, attr); fill = true; }
    }
    let v;
    if (i >= 0) {
      const D = DC.data, b = (i << 5) + off;
      v = D[b];
      if (n > 1) v |= D[b + 1] << 8;
      if (n > 2) v |= D[b + 2] << 16;
      if (n > 3) v = (v | (D[b + 3] << 24)) >>> 0;
    } else {
      st.uncached++;
      const bus = this.bus;
      v = bus.read8(pa);
      for (let k = 1; k < n; k++) v |= bus.read8((pa + k) >>> 0) << (8 * k);
      v >>>= 0;
      this.memCycles('memr', pa, v, n, s);
      const f = this.fsbFirst() + this.fsbReq();
      this.accLat += f; this.accBus += f;
    }
    if (this.trace && !this.cacheSeen) this.cacheNote686(pa, i, hit, fill, false, false, i < 0);
    return v;
  }
  // Write n bytes (1-4). A write hit changes the line: M stays M and E becomes M with no bus cycle; an S
  // line goes to the bus (write-through) and becomes E when the page has PWT = 0. A write miss to a
  // write-back page fills the line first (the RFO: write-allocate), then the line is M. A write miss
  // to a page with PWT or PCD (or with CR0.CD = 1, or no KEN#) goes to the bus with no fill.
  // CR0.CD = 1: the write hits go to the bus and the states stay; CR0.NW = 1: no write hit goes to the
  // bus. Memory always gets the bytes. A write to a line of the code cache makes that line invalid.
  physWr(pa, n, v, s, attr) {
    const off = pa & 31;
    if (off + n > 32) {
      const k = 32 - off;
      this.physWr(pa, k, v & (0xFFFFFFFF >>> (32 - 8 * k)), s, attr);
      this.physWr((pa + k) >>> 0, n - k, v >>> (8 * k), s, attr);
      return;
    }
    const DC = this.dcache, st = DC.stats, T = this.dtag, i0 = ((pa >>> 5) & 127) << 1, tag = pa >>> 12, c0 = this.cr[0];
    let i = T[i0] === tag ? i0 : T[i0 + 1] === tag ? i0 + 1 : -1, fill = false;
    const hit = i >= 0;
    if (!hit) {
      st.writeMisses++;
      this.wbLine = -1;
      if (!(c0 & C0_CD) && !(attr & 0x18) && this.cacheable(pa)) { st.rfo++; i = this.dFill(pa, s, attr); fill = true; }
    }
    let cyc = true;
    if (i >= 0) {
      const D = DC.data, b = (i << 5) + off;
      for (let k = 0; k < n; k++) D[b + k] = (v >>> (8 * k)) & 0xFF;
      if (hit) st.writeHits++;
      DC.lru[i0 >> 1] = (i & 1) ^ 1;
      if (c0 & C0_NW) cyc = false;
      else if (!(c0 & C0_CD)) {
        const sti = DC.state[i];
        if (sti >= P5_E) { cyc = false; if (hit) st.writeHitsME++; DC.state[i] = P5_M; }
        else if (!(attr & 8)) DC.state[i] = P5_E;
      }
    }
    const bus = this.bus;
    if (cyc) {
      for (let k = 0; k < n; k++) bus.write8((pa + k) >>> 0, (v >>> (8 * k)) & 0xFF);
      this.memCycles('memw', pa, n === 4 ? v >>> 0 : v & ((1 << (8 * n)) - 1), n, s);
      this.accBus += this.fsbFirst() + this.fsbReq();
    } else if (bus.poke8) for (let k = 0; k < n; k++) bus.poke8((pa + k) >>> 0, (v >>> (8 * k)) & 0xFF);
    else for (let k = 0; k < n; k++) bus.write8((pa + k) >>> 0, (v >>> (8 * k)) & 0xFF);
    const j = this.iFind(pa);
    if (j >= 0) { this.itag[j] = -1; this.icache.stats.invalidations++; }
    if (this.trace && !this.cacheSeen) this.cacheNote686(pa, i, hit, fill, true, false, false);
  }

  // ---------- segment access: the loads and stores of the µop model ----------
  // The same checks as the 80486 rd() / wr(); each operand access is one load µop (a write: an STA
  // and an STD µop). The latency more than an L1 hit (L2, FSB, page walk) is kept for the model.
  rd(s, o, n) {
    const d = this.cache[s];
    if (o < d.lo || o + n - 1 > d.hi || !d.rd) this.segFault(s);
    const la = (d.base + o) >>> 0;
    if ((la & (n - 1)) && this.acOn()) throw this.fault(17, 0);
    const a0 = this.accLat, b0 = this.accBus;
    const v = this.rdLin(la, n, s, this.cpl === 3);
    const k = this.nLd;
    if (k < P686_MAXM) { this.ldAddr[k] = la; this.ldSize[k] = n; this.ldLat[k] = this.accLat - a0; this.ldBus[k] = this.accBus - b0; }
    this.nLd = k + 1;
    return v;
  }
  wr(s, o, n, v) {
    const d = this.cache[s];
    if (o < d.lo || o + n - 1 > d.hi || !d.wr) this.segFault(s);
    const la = (d.base + o) >>> 0;
    if ((la & (n - 1)) && this.acOn()) throw this.fault(17, 0);
    const a0 = this.accLat, b0 = this.accBus;
    this.wrLin(la, n, v, s, this.cpl === 3);
    const k = this.nSt;
    if (k < P686_MAXM) { this.stAddr[k] = la; this.stSize[k] = n; this.stLat[k] = this.accLat - a0; this.stBus[k] = this.accBus - b0; }
    this.nSt = k + 1;
  }

  // ---------- paging: global pages (CR4.PGE) ----------
  // TLB flags: the P5 bits, and bit 8 = G (a global page: MOV CR3 and a task switch keep it when
  // CR4.PGE = 1). flushTLB() is the flush of MOV CR3; flushTLBAll() also removes the global entries
  // (a change of CR4.PGE or CR4.PSE, a change of CR0.PG).
  flushTLB() {
    const keep = this.cr && (this.cr[4] & C4_PGE) !== 0;
    for (const e of this.tlb) if (!keep || !(e.flags & 0x100)) e.valid = false;
    if (this.tlb4m) {
      for (const e of this.tlb4m) if (!keep || !(e.flags & 0x100)) e.valid = false;
      for (const e of this.itlb) if (!keep || !(e.flags & 0x100)) e.valid = false;
    }
    this.tlbStats.flushes++;
  }
  flushTLBAll() {
    for (const e of this.tlb) e.valid = false;
    for (const e of this.tlb4m) e.valid = false;
    for (const e of this.itlb) e.valid = false;
    this.tlbStats.flushes++;
  }
  modeChange(old) {
    super.modeChange(old);
    if ((old ^ this.cr[0]) & 0x80000000) this.flushTLBAll();
  }
  // Page walk: the P5 walk (4 KB and 4 MB pages), and the G bit (bit 8 of the PTE, or of a 4 MB PDE)
  // goes into the TLB flags.
  walk(la, write, user, code) {
    if (code) this.tlbStats.codeMisses++; else this.tlbStats.misses++;
    const dir = la >>> 22, tbl = (la >>> 12) & 0x3FF, cr3 = this.cr[3];
    const pdeA = ((cr3 & 0xFFFFF000) + dir * 4) >>> 0;
    const pde = this.rdPhysD(pdeA, cr3 & 0x18);
    const ev = this.trace ? { k: 'page', lin: la, phys: 0, dir, tbl, hit: false, pde, pte: 0, fault: false } : null;
    if (ev && code) ev.code = true;
    const err = (write ? 2 : 0) | (user ? 4 : 0);
    const fail = c => { if (ev) { ev.fault = true; ev.err = c; this.ev.push(ev); } return this.pageFault(la, c); };
    if (!(pde & 1)) throw fail(err);
    if ((pde & 0x80) && (this.cr[4] & C4_PSE)) {
      if (ev) { ev.big = true; ev.tbl = -1; }
      if (pde & 0x3FF000) throw fail(err | 9);
      const us = pde & 4, rw = pde & 2;
      if (user && (!us || (write && !rw))) throw fail(err | 1);
      if (!user && write && !rw && (this.cr[0] & C0_WP)) throw fail(err | 1);
      const npde = pde | 0x20 | (write ? 0x40 : 0);
      if (npde !== pde) this.wrPhysD(pdeA, npde, cr3 & 0x18);
      const frame = (pde & 0xFFC00000) >>> 0, fl = us | rw | 0x21 | (npde & 0x40) | (pde & 0x118) | 0x80;
      if (code) this.tPut(this.itlb, this.itlbNext, (la >>> 12) & 7, (la & 0xFFFFF000) >>> 0, (frame | (la & 0x3FF000)) >>> 0, fl);
      else this.tPut(this.tlb4m, this.tlb4mNext, (la >>> 22) & 1, (la & 0xFFC00000) >>> 0, frame, fl);
      this.xPcd = pde & 0x18;
      const pa = (frame | (la & 0x3FFFFF)) >>> 0;
      if (ev) { ev.phys = pa; ev.global = (pde & 0x100) !== 0; this.ev.push(ev); }
      return pa;
    }
    const pteA = ((pde & 0xFFFFF000) + tbl * 4) >>> 0;
    const pte = this.rdPhysD(pteA, pde & 0x18);
    if (ev) ev.pte = pte;
    if (!(pte & 1)) throw fail(err);
    const us = pde & pte & 4, rw = pde & pte & 2;
    if (user && (!us || (write && !rw))) throw fail(err | 1);
    if (!user && write && !rw && (this.cr[0] & C0_WP)) throw fail(err | 1);
    if (!(pde & 0x20)) this.wrPhysD(pdeA, pde | 0x20, cr3 & 0x18);
    const npte = pte | 0x20 | (write ? 0x40 : 0);
    if (npte !== pte) this.wrPhysD(pteA, npte, pde & 0x18);
    const frame = (pte & 0xFFFFF000) >>> 0, fl = us | rw | 0x21 | (npte & 0x40) | (pte & 0x118);
    if (code) this.tPut(this.itlb, this.itlbNext, (la >>> 12) & 7, (la & 0xFFFFF000) >>> 0, frame, fl);
    else this.tlbPut((la & 0xFFFFF000) >>> 0, frame, fl);
    this.xPcd = pte & 0x18;
    const pa = (frame | (la & 0xFFF)) >>> 0;
    if (ev) { ev.phys = pa; ev.global = (pte & 0x100) !== 0; this.ev.push(ev); }
    return pa;
  }

  // ---------- prefetch: 16 bytes at most from the L1 code cache for each call ----------
  // The P6 front end has no prefetch queue of the P5 kind; fetch() asks for the bytes of the
  // instruction (the model counts the decode rate, see ooo()). A code-cache miss fills the line from
  // the L2 or the FSB, and its latency goes to codeLat (the decode of this instruction waits).
  prefetch(stall, room) {
    const qip = this.qip, d = this.cache[CS], bus = this.bus;
    if (!stall && qip > d.hi) return -1;
    if (this.qt > 96) this.qCompact();
    const la = (d.base + qip) >>> 0;
    let pa = la, attr = 0;
    if (this.paging) {
      if (stall) { pa = this.xlateCode(la, this.cpl === 3); attr = this.xPcd; }
      else {
        const e = this.itlbFind(la);
        if (!e || (this.cpl === 3 && !(e.flags & 4))) return -1;
        pa = (e.phys | (la & 0xFFF)) >>> 0; attr = e.flags & 0x18;
      }
    }
    const IC = this.icache, st = IC.stats, tr = this.trace, list = tr ? (stall ? this.stallEv : this.pfEv) : null, n0 = tr ? list.length : 0;
    let k = 32 - (la & 31);
    if (k > 16) k = 16;
    if (d.hi - qip + 1 < k) k = d.hi - qip + 1;
    let i = this.iFind(pa), fill = false;
    const hit = i >= 0;
    if (hit) { st.hits++; p686Touch(IC.lru, i >> 2, i & 3); }
    else if (!(this.cr[0] & C0_CD) && !(attr & 0x10) && this.cacheable(pa)) {
      if (!stall && room < this.fsbFirst()) return -2;
      st.misses++;
      i = this.iFill(pa, stall, attr); fill = true;
    }
    const Q = this.qb;
    if (i >= 0) {
      const D = IC.data, b = (i << 5) + (pa & 31);
      let t = this.qt;
      for (let j = 0; j < k; j++) Q[t++] = D[b + j];
      this.qt = t;
      this.qip = (qip + k) >>> 0;
    } else {
      // Not cacheable: one aligned group of 8 bytes (up to the CS limit) on the FSB.
      st.misses++; st.uncached++;
      let w = 8 - (la & 7);
      if (d.hi - qip + 1 < w) w = d.hi - qip + 1;
      let lo = 0, hi = 0;
      for (let j = 0; j < w; j++) {
        const x = bus.read8((pa + j) >>> 0);
        Q[this.qt++] = x;
        if (j < 4) lo |= x << (8 * j); else hi |= x << (8 * (j - 4));
      }
      this.qip = (qip + w) >>> 0;
      const f = this.fsbFirst();
      this.codeEv(pa, lo >>> 0, w, f, stall, w > 4 ? { hi: hi >>> 0 } : null);
      this.codeLat += f + this.fsbReq(); this.codeBus += f + this.fsbReq();
    }
    if (tr) {
      for (let j = n0; j < list.length; j++) list[j].q = this.q;
      if (!hit && !this.codeSeen) this.cacheNote686(pa, i, false, fill, false, true, !fill);
    }
    return 0;
  }

  // ---------- step, the recipes and the out-of-order model ----------
  step() {
    // Clocks that the machine added to cpu.cycles since the last step (the wait-loop skip, DMA cycles,
    // the ISA I/O time): the model moves forward by the same amount.
    const O = this.oS, ext = this.cycles - O[O_CYC];
    if (ext > 0) this.oooSync(O[O_PREV] + ext);
    this.nLd = 0; this.nSt = 0; this.accLat = 0; this.accBus = 0; this.codeLat = 0; this.codeBus = 0;
    this.execOk = false; this.strCont = false; this.isV = false; this.pairNext = false;
    const br = this.bus.busRatio;
    this.busRatio = br > 0 ? br : 3;
    if (this.trace) {
      this.snapCr4 = this.cr[4]; this.l2Seen = false; this.l2cSeen = false;
      this.uopEv = []; this.trSrc = []; this.trRat = { reads: [], writes: [] }; this.btbEv = null; this.trT0 = -1;
    }
    return CPU80486.prototype.step.call(this);
  }
  exec(op) {
    this.mod = -1; this.op2 = -1; this.opPos = this.ilen;
    P386_OPS[op].call(this, op);      // the 80386 core runs the instruction (no 486 / P5 clock code)
    this.execOk = true;
  }
  stringOp(op, first) {
    this.strCont = !first;
    CPU80386.prototype.stringOp.call(this, op, first);
    this.execOk = true;
  }
  // The recipe of the instruction of this step.
  recipe() {
    const op = this.op;
    if (op === 0x0F) {
      const r = P686_R0F[this.op2];
      if (r) return r;
      const g = P686_G0F[this.op2];
      return g ? g[this.reg] : P686_RUD;
    }
    if (op >= 0xD8 && op <= 0xDF) return this.mod < 0 ? P686_RUD : P686_FP[((op & 7) << 8) | (this.mod << 6) | (this.reg << 3) | this.rm];
    const r = P686_R1[op];
    if (r) return r;
    const g = P686_G1[op];
    return g ? g[this.reg] : P686_RUD;
  }
  // The address registers of the ModR/M memory operand (a mask of EAX..EDI), from the ModR/M (and
  // SIB) bytes of the instruction (this.ib).
  eaRegs() {
    const B = this.ib, p = this.opPos + (this.op === 0x0F ? 1 : 0), m = B[p], mod = m >> 6, rm = m & 7;
    if (!this.a32) return mod === 0 && rm === 6 ? 0 : P586_EA16[rm];
    if (rm === 4) {
      const sib = B[p + 1], base = sib & 7, idx = (sib >> 3) & 7;
      return (base === 5 && mod === 0 ? 0 : 1 << base) | (idx === 4 ? 0 : 1 << idx);
    }
    return rm === 5 && mod === 0 ? 0 : 1 << rm;
  }
  // The ready clock of the registers of a mask (and this.uWait = the register that is ready last).
  rdyOf(m) {
    const RDY = this.rat.ready;
    let t = 0, w = -1;
    for (; m; m &= m - 1) { const r = 31 - Math.clz32(m & -m); if (RDY[r] > t) { t = RDY[r]; w = r; } }
    this.uWait = w;
    return t;
  }
  // The ROB entry of the producer of register r when it is not retired at clock t (-1: the RRF).
  srcOf(r, t) { return r >= 0 && this.rat.retire[r] > t ? this.rat.rob[r] : -1; }

  // Schedule one µop (see ooo()). pc: the port class, lat: the latency, ready: the clock at which
  // its sources are ready, unit: UN_DIV / UN_FMUL / 0, kind: the µop kind, dst: the register of
  // the RAT that it writes (-1: none; for the views), s1 / s2: the ROB entries of its sources,
  // busT: the FSB clocks of a load that misses the L2. Returns the done clock; this.uRob = its ROB
  // entry, oS[O_URET] = its retire clock, oS[O_UDISP] = its dispatch clock.
  sch(pc, lat, ready, unit, kind, dst, s1, s2, busT) {
    const O = this.oS, R = this.rob;
    // ---- issue (the RAT, the ROB and the RS): in program order, 3 µops each clock ----
    let iss = O[O_ICLK], cnt = O[O_ICNT], av = O[O_AVAIL];
    if (O[O_MINISS] > av) av = O[O_MINISS];
    if (av > iss) { iss = av; cnt = 0; } else if (cnt >= 3) { iss++; cnt = 0; }
    const e = this.robPos;
    if (R.retire[e] >= iss) { iss = R.retire[e] + 1; cnt = 0; this.oooStats.robFull++; }
    const S = this.rs, SD = S.dispatch;
    let s = this.rsPos;
    if (SD[s] >= iss) {
      let bt = SD[s];
      for (let j = 0; j < 20; j++) {
        const x = SD[j];
        if (x < iss) { s = j; bt = -1; break; }
        if (x < bt) { bt = x; s = j; }
      }
      if (bt >= iss) { iss = bt + 1; cnt = 0; this.oooStats.rsFull++; }
    }
    O[O_ICLK] = iss; O[O_ICNT] = cnt + 1;
    // ---- dispatch: the sources are ready, the unit is free, a free port ----
    let d = iss + 1, why = 0;                      // why: 1 = an operand, 2 = the unit, 3 = the port
    if (ready > d) { d = ready; why = 1; }
    if (unit) { const f = unit === UN_DIV ? O[O_DIV] : O[O_FMUL]; if (f > d) { d = f; why = 2; } }
    const C = this.ports.busy, d0 = d;
    let p;
    if (pc === PC_01) {
      for (;;) {
        const i = d & 511, f0 = C[i] !== d, f1 = C[P686_CAL + i] !== d;
        if (f0 && f1) { p = O[O_TOG] = 1 - O[O_TOG]; break; }
        if (f0) { p = 0; break; }
        if (f1) { p = 1; break; }
        d++;
      }
    } else if (pc === PC_NONE) p = -1;
    else { p = P686_PORT[pc]; const b = p * P686_CAL; while (C[b + (d & 511)] === d) d++; }
    if (d > d0) why = 3;
    if (p >= 0) C[p * P686_CAL + (d & 511)] = d;
    if (unit) { if (unit === UN_DIV) O[O_DIV] = d + lat; else O[O_FMUL] = d + 2; }
    if (busT > 0) {                                // a load that goes to the FSB: the bus may be busy
      let bs = d + 3 + P686_L2LAT;
      if (O[O_FSB] > bs) { lat += O[O_FSB] - bs; bs = O[O_FSB]; }
      O[O_FSB] = bs + busT;
    }
    const done = d + lat;
    // ---- retire: in program order, 3 µops each clock ----
    let r = done + 1;
    const rc = O[O_RCLK];
    if (r < rc) r = rc;
    if (r === rc) { if (O[O_RCNT] >= 3) { r++; O[O_RCNT] = 1; } else O[O_RCNT]++; } else O[O_RCNT] = 1;
    O[O_RCLK] = r;
    // ---- the ROB entry, the RS entry and the port (for the views) ----
    const id = O[O_UOP]++;
    R.uop[e] = id; R.instr[e] = O[O_SEQ]; R.kind[e] = kind; R.port[e] = p; R.src1[e] = s1; R.src2[e] = s2; R.dst[e] = dst;
    R.issue[e] = iss; R.dispatch[e] = d; R.done[e] = done; R.retire[e] = r;
    S.uop[s] = id; S.rob[s] = e; S.issue[s] = iss; SD[s] = d;
    this.rsPos = s === 19 ? 0 : s + 1;
    this.robPos = e === 39 ? 0 : e + 1;
    R.head = this.robPos;
    if (p >= 0) this.ports.uops[p]++;
    this.uRob = e; O[O_URET] = r; O[O_UDISP] = d;
    if (this.trace) {
      const src = [], regs = [];
      for (const x of this.trSrc) { if (x.rob >= 0 && !src.includes(x.rob)) src.push(x.rob); regs.push(x.r); }
      this.uopEv.push({ k: 'uop', t: 0, id, n: O[O_SEQ], text: '', kind: P686_UK[kind], port: p, rob: e, rs: s, src, srcRegs: regs,
        dst: dst >= 0 ? P686_RN[dst] : '', issue: iss, dispatch: d, done, retire: r, lat,
        wait: why === 1 ? (kind === UK_LOAD && this.ldFwd ? (this.ldFwd === 1 ? 'store data' : 'store buffer') : 'operand') : why === 2 ? (unit === UN_DIV ? 'divider' : 'fmul') : why === 3 ? 'port' : '', passed: 0 });
      this.trSrc = [];
    }
    return done;
  }
  // Trace only: the sources of the next µop (the register names and their ROB entries).
  trNote(mask, t, local, localName) {
    for (let m = mask; m; m &= m - 1) { const r = 31 - Math.clz32(m & -m); this.trSrc.push({ r: P686_RN[r], rob: this.srcOf(r, t) }); }
    if (local >= 0) this.trSrc.push({ r: localName, rob: local });
  }

  // The µops of this step and their times. mode: 0 = an instruction, 1 = a REP iteration (the
  // MSROM continues), 2 = an exception (the instruction did not complete), 3 = an IRQ or NMI.
  // Returns the retire clock of the last µop.
  //
  // The µops: a load for each read of the instruction, the ESP µop of a stack instruction, the
  // compute µops of the recipe (a chain), and an STA + STD pair for each write. The front end:
  // D0 takes an instruction of up to 4 µops, D1 and D2 take 1-µop instructions, up to 16 bytes in a
  // clock; an instruction of more than 4 µops goes through the MSROM (4 µops each clock), and the
  // next instruction starts a new decode group. A code-cache miss delays the decode. The RAT issues 3
  // µops each clock in program order when the ROB (40) and the RS (20) have a free entry. A µop
  // dispatches when its sources are ready and its port is free (older µops that wait do not stop it),
  // and retires in program order, 3 each clock. Loads wait for the addresses of older stores; a load
  // of bytes that an older store (in the store buffer) writes gets its data from the store.
  ooo(mode) {
    const O = this.oS, st = this.oooStats, RT = this.rat, RDY = RT.ready, RRB = RT.rob, RRT = RT.retire, RW = RT.width;
    const tr = this.trace !== null;
    const R = mode === 2 ? P686_EXC : mode === 3 ? P686_INT : this.recipe();
    const op = this.op, mod = this.mod, memForm = mod >= 0 && mod !== 3;
    const nLd = this.nLd < P686_MAXM ? this.nLd : P686_MAXM, nSt = this.nSt < P686_MAXM ? this.nSt : P686_MAXM;
    let u = memForm ? R.uM : R.uR;
    if (R.dyn) { u += this.clk >> 2; if (u > 64) u = 64; }
    u += (this.nLd - nLd) + 2 * (this.nSt - nSt);        // accesses that the model does not keep: MSROM µops
    const rep = mode <= 1 && R.am === AM_STR && this.rep !== 0;
    if (rep && mode === 0) u += P686_REPSTART;
    if (u > 64) u = 64;                                    // longer MSROM flows: 64 µops
    const esp = R.esp;
    let n = nLd + esp + u + 2 * nSt;
    if (n === 0) { u = 1; n = 1; }
    const ms = R.ms !== 0 || n > 4 || rep || mode >= 2;
    const seq = ++O[O_SEQ];
    st.steps++; st.uops += n;
    // ---- the registers: widths and masks ----
    const w = R.sz === SZ_B ? 1 : R.sz === SZ_O ? this.osz : ((op === 0x0F ? this.op2 : op) & 1) ? this.osz : 1;
    let rdM = R.rM, wrM = R.wM;
    if (rep) { rdM |= P6M_ECX; wrM |= P6M_ECX; }
    if (R.rG || R.wG) { const g = w === 1 ? this.reg & 3 : this.reg; if (R.rG) rdM |= 1 << g; if (R.wG) wrM |= 1 << g; }
    if (mod === 3 && (R.rE || R.wE)) { const x = w === 1 ? this.rm & 3 : this.rm; if (R.rE) rdM |= 1 << x; if (R.wE) wrM |= 1 << x; }
    if (R.rO || R.wO) { const x = R.sz === SZ_B ? op & 3 : (op === 0x0F ? this.op2 : op) & 7; if (R.rO) rdM |= 1 << x; if (R.wO) wrM |= 1 << x; }
    if (R.fR) rdM |= 0x100;
    if (R.fW) wrM |= 0x100;
    let fx0 = -1, fx1 = -1;
    if (R.fp) {
      const t0 = this.fpTop, i = this.rm & 7;
      if (R.fs & 1) rdM |= 1 << (10 + t0);
      if (R.fs & 2) rdM |= 1 << (10 + ((t0 + i) & 7));
      if (R.fs & 4) rdM |= 0x200;
      if (R.fd === 1) wrM |= 1 << (10 + t0);
      else if (R.fd === 2) wrM |= 1 << (10 + ((t0 + i) & 7));
      else if (R.fd === 3) wrM |= 1 << (10 + ((t0 + 7) & 7));
      if (R.fsw) wrM |= 0x200;
      if (R.kind === UK_FXCH) { fx0 = 10 + t0; fx1 = 10 + ((t0 + i) & 7); }
    }
    // the address registers of the loads (aL) and of the stores (aS)
    let aL = 0, aS = 0;
    if (nLd + nSt > 0 || R.lea) {
      const ea = memForm ? this.eaRegs() : 0;
      aL = R.am === AM_EA ? ea : R.am === AM_STACK ? P6M_ESP : R.am === AM_STR ? P6M_ESI | P6M_EDI : R.aM;
      aS = R.amS === AM_EA ? ea : R.amS === AM_STACK ? P6M_ESP : R.amS === AM_STR ? P6M_EDI : R.aM;
      if (mode >= 2) { aL = 0; aS = P6M_ESP; }
      if (R.lea) rdM |= ea;
    }
    // ---- the front end: the decode clock ----
    const len = mode === 0 ? this.ilen : 0;
    let dc = O[O_DCLK], slot = O[O_DSLOT], bytes = O[O_DBYTES], fe = O[O_FETCH];
    const iq = O[O_ICLK] - P686_DQ;
    if (iq > fe) fe = iq;                            // the decoded-µop queue is full: the decoders wait
    if (this.codeLat > 0) {                          // a code-cache miss for the bytes of this instruction
      let cs = dc > fe ? dc : fe;
      if (this.codeBus > 0) { if (O[O_FSB] > cs) cs = O[O_FSB]; O[O_FSB] = cs + this.codeBus; }
      if (cs + this.codeLat > fe) fe = cs + this.codeLat;
    }
    if (fe > dc) { dc = fe; slot = 0; bytes = 0; }
    if (ms || n > 1) { if (slot > 0) { dc++; slot = 0; bytes = 0; } }
    else if (slot >= 3 || (slot > 0 && bytes + len > 16)) { dc++; slot = 0; bytes = 0; }
    const dec = dc, decoder = ms ? 3 : slot;
    if (ms) { dc += (n + 3) >> 2; slot = 0; bytes = 0; } else { slot++; bytes += len; }
    st.decoders[decoder]++;
    let av = dec + P686_DEC_ISS;
    // serializing: all older µops retire first (and the reported clock of the step start)
    const ser = R.ser !== 0 || mode >= 2 || (mode === 0 && (this.lock || (R.lk !== 0 && memForm)));
    if (ser) {
      let t = O[O_RCLK] + 1;
      if (this.cycles > t) t = this.cycles;
      if (t > av) av = t;
      st.serial++;
    }
    O[O_AVAIL] = av; O[O_MINISS] = 0;
    // partial register stall: a read of a register that a narrower write (not yet retired) wrote
    const aw = this.a32 ? 4 : 2;
    for (let m = (rdM | aL | aS) & 0xFF; m; m &= m - 1) {
      const r = 31 - Math.clz32(m & -m), rw = (aL | aS) & (1 << r) ? aw : w;
      if (RW[r] < rw && RRT[r] > av) { if (RRT[r] + 1 > O[O_MINISS]) O[O_MINISS] = RRT[r] + 1; st.partial++; }
    }
    const first = this.robPos;
    if (tr) {
      const t = av, rr = this.trRat;
      for (let m = rdM | aL | aS; m; m &= m - 1) { const r = 31 - Math.clz32(m & -m); rr.reads.push({ r: P686_RN[r], rob: this.srcOf(r, t), ready: RDY[r] }); }
      this.trDec = dec; this.trDecoder = decoder; this.trN = n; this.trFirst = first;
    }
    // ---- loads ----
    const aLr = this.rdyOf(aL), aLw = this.uWait;
    let ldDone = 0, ldRob = -1;
    const ldDst = u === 0 ? (wrM ? 31 - Math.clz32(wrM & -wrM) : -1) : -1;
    for (let k = 0; k < nLd; k++) {
      let ready = aLr;
      if (O[O_STA] > ready) ready = O[O_STA];                           // older stores: their addresses first
      this.ldFwd = 0; this.sbRob = -1;
      if (O[O_SBLAST] > ready) ready = this.sbCheck(this.ldAddr[k], this.ldSize[k], ready > av + 1 ? ready : av + 1);
      if (tr) this.trNote(aL, av, this.sbRob, 'store');
      const done = this.sch(PC_LD, 3 + this.ldLat[k], ready, 0, UK_LOAD, k === nLd - 1 ? ldDst : -1, this.srcOf(aLw, av), this.sbRob, this.ldBus[k]);
      if (tr && this.trT0 < 0) this.trT0 = O[O_UDISP];
      if (done > ldDone) { ldDone = done; ldRob = this.uRob; }
    }
    // ---- the ESP µop of a stack instruction ----
    let espDone = 0, espRob = -1, espRet = 0;
    if (esp) {
      if (tr) this.trNote(P6M_ESP, av, -1, '');
      espDone = this.sch(PC_01, 1, RDY[4], 0, UK_ESP, 4, this.srcOf(4, av), -1, 0);
      espRob = this.uRob; espRet = O[O_URET];
    }
    // ---- the compute µops (a chain) ----
    let cDone = 0, cRob = -1;
    const regR = this.rdyOf(rdM), regW = this.uWait;
    if (u > 0) {
      let ready = regR, s1 = this.srcOf(regW, av);
      if (ldDone > ready) { ready = ldDone; s1 = ldRob; }
      let lat = R.lat, unit = R.unit;
      // DIV: 19 / 23 / 39 clocks in all (8 / 16 / 32 bits): the µops before the divide µop take 1 clock each
      if (R.kind === UK_DIV) lat = (w === 1 ? 19 : w === 2 ? 23 : 39) - (u - 1);
      else if (R.kind === UK_FDIV) { const pc = (this.bus.fpu ? this.bus.fpu.cw >> 8 : 3) & 3; lat = R.lat === 37 ? [17, 37, 32, 37][pc] : [29, 69, 58, 69][pc]; }
      if (R.kind === UK_MUL || R.kind === UK_FMUL) st.mul++;
      if (R.kind === UK_DIV || R.kind === UK_FDIV) st.div++;
      if (R.fp && (R.kind === UK_FADD || R.kind === UK_FMUL || R.kind === UK_FDIV)) st.flops++;
      const dst = wrM ? 31 - Math.clz32(wrM & -wrM) : -1;
      for (let j = 0; j < u; j++) {
        const last = j === u - 1;
        if (tr) { if (j === 0) this.trNote(rdM, av, ldRob, 'load'); else this.trNote(0, av, cRob, 'µop'); }
        cDone = this.sch(last ? R.pc : PC_01, last ? lat : 1, ready, last ? unit : 0, last ? R.kind : ms ? UK_MS : UK_ALU,
          last ? dst : -1, j === 0 ? s1 : cRob, j === 0 && ldRob >= 0 && s1 !== ldRob ? ldRob : -1, 0);
        cRob = this.uRob;
        ready = cDone;
      }
    }
    // ---- stores: STA (the address) and STD (the data), then the store buffer ----
    if (nSt > 0) {
      const aSr = this.rdyOf(aS), aSw = this.uWait;
      let dR = u > 0 ? cDone : regR, dRob = u > 0 ? cRob : this.srcOf(regW, av);
      if (u === 0 && ldDone > dR) { dR = ldDone; dRob = ldRob; }
      const SB = this.sb;
      for (let k = 0; k < nSt; k++) {
        const p = this.sbPos;
        if (SB.commit[p] >= O[O_ICLK] && SB.commit[p] + 1 > O[O_MINISS]) { O[O_MINISS] = SB.commit[p] + 1; st.sbFull++; }
        if (tr) this.trNote(aS, av, -1, '');
        const staDone = this.sch(PC_STA, 1, aSr, 0, UK_STA, -1, this.srcOf(aSw, av), -1, 0);
        if (tr && this.trT0 < 0) this.trT0 = O[O_UDISP];
        if (staDone > O[O_STA]) O[O_STA] = staDone;
        if (tr) this.trNote(0, av, dRob, 'data');
        const stdDone = this.sch(PC_STD, 1, dR, 0, UK_STD, -1, dRob, -1, 0);
        SB.rob[p] = this.uRob;
        // the store is in the cache after its retire, in order, one each clock (+ the RFO of a miss)
        let c = O[O_URET] + 1;
        if (O[O_SBLAST] + 1 > c) c = O[O_SBLAST] + 1;
        const b = this.stBus[k];
        if (b > 0) { if (O[O_FSB] > c) c = O[O_FSB]; O[O_FSB] = c + b; }
        c += this.stLat[k];
        SB.addr[p] = this.stAddr[k]; SB.bytes[p] = this.stSize[k]; SB.std[p] = stdDone; SB.commit[p] = c;
        O[O_SBLAST] = c;
        this.sbPos = p === 11 ? 0 : p + 1;
      }
    }
    const M = O[O_RCLK];
    // ---- the RAT: the new producers of the registers that the instruction writes ----
    let pDone = cDone, pRob = cRob;
    if (u === 0) { pDone = nLd ? ldDone : espDone; pRob = nLd ? ldRob : espRob; }
    if (fx0 >= 0) {                                  // FXCH: the RAT exchanges the two registers
      let x = RDY[fx0]; RDY[fx0] = RDY[fx1]; RDY[fx1] = x;
      x = RRT[fx0]; RRT[fx0] = RRT[fx1]; RRT[fx1] = x;
      x = RRB[fx0]; RRB[fx0] = RRB[fx1]; RRB[fx1] = x;
    } else {
      for (let m = wrM; m; m &= m - 1) {
        const r = 31 - Math.clz32(m & -m);
        RDY[r] = pDone; RRB[r] = pRob; RRT[r] = M; RW[r] = r < 8 ? w : 4;
        if (tr) this.trRat.writes.push({ r: P686_RN[r], rob: pRob });
      }
    }
    if (esp) { RDY[4] = espDone; RRB[4] = espRob; RRT[4] = espRet; RW[4] = 4; if (tr) this.trRat.writes.push({ r: 'ESP', rob: espRob }); }
    // The decode state of this step goes back first: branch6 can start a new decode group after it.
    O[O_DCLK] = dc; O[O_DSLOT] = slot; O[O_DBYTES] = bytes;
    // ---- branches, far transfers and serializing instructions: the front end ----
    if (R.br && mode === 0) {
      if (R.br === BK_FAR) { const t = cDone + P686_FE_RESTART; if (t > O[O_FETCH]) O[O_FETCH] = t; }
      else this.branch6(R.br, cDone, dec);
    }
    if (ser) { const t = mode >= 2 ? M : M + 1; if (t > O[O_FETCH]) O[O_FETCH] = t; }
    O[O_PREV] = M;
    if (mode === 0) st.instructions++;
    return M;
  }
  // Store forwarding: a load of la .. la + n - 1 that can dispatch at clock t. The store buffer
  // (newest first) up to the first store that is in the cache at t. A store that has all the bytes
  // gives them to the load when its data is ready; a store with a part of them blocks the load until
  // the store is in the cache (P6: no forwarding of a part). Returns the new ready clock; sbRob = the
  // ROB entry of the STD of that store, ldFwd = 1 (forwarding) or 2 (blocked).
  sbCheck(la, n, t) {
    const SB = this.sb;
    let p = this.sbPos;
    for (let j = 0; j < 12; j++) {
      p = p === 0 ? 11 : p - 1;
      const c = SB.commit[p];
      if (c <= t) break;
      const a = SB.addr[p], z = SB.bytes[p];
      if (la < a + z && a < la + n) {
        this.sbRob = SB.rob[p];
        if (a <= la && la + n <= a + z) { this.oooStats.forwards++; this.ldFwd = 1; return SB.std[p] > t ? SB.std[p] : t; }
        this.oooStats.ldBlocks++; this.ldFwd = 2;
        return c + 1 > t ? c + 1 : t;
      }
    }
    return t;
  }
  // The branch prediction of a branch µop (kind: BK_JCC ... BK_LOOP) that is done at clock bDone and
  // was decoded at clock dec. The BTB (and the history of the branch), the static prediction of the
  // decoder for a branch that is not in the BTB (backward: taken; forward: not taken; JMP / CALL
  // direct: taken), the return stack buffer for RET. A wrong prediction: the fetch starts again
  // P686_FE_RESTART clocks after the branch executes; a taken branch that only the decoder finds:
  // P686_BACLEAR clocks; a right taken prediction of the BTB: the next instruction starts a new
  // decode group.
  branch6(kind, bDone, dec) {
    const B = this.btb, st = B.stats, O = this.oS;
    const la = (this.lastBase + this.lastIP) >>> 0, taken = this.didFlush;
    const target = taken ? (this.cache[CS].base + this.ip) >>> 0 : 0;
    const cond = kind === BK_JCC || kind === BK_LOOP;
    st.branches++;
    if (taken) st.taken++;
    let how = 0, predT = false, predTgt = 0, e = -1, hist = -1, ctr = -1, alloc = false;
    const set = la & 127, b = set << 2;
    if (kind === BK_RET) {
      how = 2;
      B.rsbTop = (B.rsbTop + 15) & 15;
      predT = true; predTgt = B.rsb[B.rsbTop];
    } else {
      st.lookups++;
      const tag = la | 0;
      if (B.tag[b] === tag) e = b; else if (B.tag[b + 1] === tag) e = b + 1; else if (B.tag[b + 2] === tag) e = b + 2; else if (B.tag[b + 3] === tag) e = b + 3;
      if (e >= 0) {
        st.hits++;
        if (cond) { hist = B.hist[e]; ctr = B.pht[(e << 4) | hist]; predT = ctr >= 2; } else predT = true;
        predTgt = B.target[e];
      } else {
        st.misses++; how = 1;
        // the static prediction of the decoder: the sign of the displacement is the top bit of the
        // last byte of the instruction (Jcc, LOOP, JCXZ)
        if (cond) predT = (this.ib[this.ilen - 1] & 0x80) !== 0;
        else predT = kind === BK_JMP || kind === BK_CALL;
        predTgt = predT ? target : 0;
      }
    }
    const right = predT === taken && (!taken || predTgt === target);
    // the update: the counter of the history, the history, the target; a new entry for a taken branch
    if (e >= 0 && cond) {
      const k = (e << 4) | hist, c = B.pht[k];
      B.pht[k] = taken ? (c < 3 ? c + 1 : 3) : (c > 0 ? c - 1 : 0);
      B.hist[e] = ((hist << 1) | (taken ? 1 : 0)) & 15;
    }
    if (kind !== BK_RET) {
      if (e >= 0) { if (taken) B.target[e] = target; }
      else if (taken) {
        const x = B.next[set];
        B.next[set] = (x + 1) & 3;
        e = b + x; alloc = true; st.allocs++;
        B.tag[e] = la | 0; B.target[e] = target; B.hist[e] = 1;
        B.pht.fill(2, e << 4, (e << 4) + 16);   // new counters: weakly taken
      }
      if (e >= 0) B.counter[e] = B.pht[(e << 4) | B.hist[e]];
    }
    if (kind === BK_CALL || kind === BK_CALLI) {
      const ip = this.cache[CS].big ? (this.lastIP + this.ilen) >>> 0 : (this.lastIP + this.ilen) & 0xFFFF;
      B.rsb[B.rsbTop] = (this.lastBase + ip) >>> 0; B.rsbTop = (B.rsbTop + 1) & 15;
    }
    let pen = 0;
    if (right) {
      st.right++;
      if (how === 1) st.staticRight++; else if (how === 2) st.rsbRight++;
      if (taken) {
        if (how === 1) { pen = P686_BACLEAR; this.oooStats.baclears++; if (dec + P686_BACLEAR > O[O_FETCH]) O[O_FETCH] = dec + P686_BACLEAR; }
        else if (O[O_DCLK] <= dec) { O[O_DCLK] = dec + 1; O[O_DSLOT] = 0; O[O_DBYTES] = 0; pen = 1; }
      }
    } else {
      st.wrong++;
      if (how === 1) st.staticWrong++; else if (how === 2) st.rsbWrong++;
      this.oooStats.mispredicts++;
      const t = bDone + P686_FE_RESTART;
      pen = t - dec;
      if (t > O[O_FETCH]) O[O_FETCH] = t;
    }
    if (this.trace) {
      this.btbEv = { k: 'btb', t: 0, lin: la, target, kind: P686_BK[kind], taken, hit: how === 0 && e >= 0 && !alloc, predicted: predT, right,
        how: ['btb', 'static', 'rsb'][how], set: kind === BK_RET ? -1 : set, way: e < 0 || kind === BK_RET ? -1 : e & 3, history: hist,
        counter: ctr, penalty: pen, alloc, resolve: bDone };
    }
  }
  // The model follows the reported clock: a halted CPU, an interrupt, a serializing instruction.
  oooSync(t) {
    const O = this.oS;
    if (O[O_DCLK] < t) { O[O_DCLK] = t; O[O_DSLOT] = 0; O[O_DBYTES] = 0; }
    if (O[O_FETCH] < t) O[O_FETCH] = t;
    if (O[O_ICLK] < t) { O[O_ICLK] = t; O[O_ICNT] = 0; }
    if (O[O_RCLK] < t) { O[O_RCLK] = t; O[O_RCNT] = 0; }
    if (O[O_PREV] < t) O[O_PREV] = t;
  }

  // The clock rule of a step. The model gives M = the retire clock of the last µop of the step (the
  // instruction retires). The step returns T = M - S, where S = cpu.cycles at the start of the step
  // (the sum of all earlier steps), but at least 1 clock. So the sum of the steps is S(n) =
  // max(S(n-1) + 1, M(n)): it follows the model, and it is ahead of the model only when the model
  // retires more than one instruction in a clock. oooStats.floor counts the clocks that this
  // floor of 1 clock adds; the model does not lose them: later slow instructions (a cache miss, a
  // divide, a wrong prediction) take them back, because M(n) - S(n-1) is then smaller. A halted step
  // takes 2 clocks and the model follows the clock (oooSync). Clocks that the machine adds to
  // cpu.cycles between the steps (the wait-loop skip, DMA, the ISA I/O time) move the model by the
  // same amount (see step()), so they do not become a debt of the model.
  finish(text, halted) {
    if (!this.batch) this.syncOut();
    const fpu = this.bus.fpu;
    if (fpu) fpu.busyCycles = 0;
    const st = this.oooStats, prev = this.oS[O_PREV];
    let T, M;
    if (halted && text !== null) {
      T = 2; st.haltClk += 2; M = this.cycles + 2;
      this.oooSync(M);
      this.trFloor = 0;
    } else {
      const mode = text !== null ? 3 : !this.execOk ? 2 : this.strCont ? 1 : 0;
      if (this.w6 === null && !this.w6Off) { if (this.w6Inst) { this.w6Attach(this.w6Inst); this.w6Inst = null; } else this.w6Start(); }
      const R6 = this.w6 !== null && this.trace === null ? (mode === 2 ? P686_EXC : mode === 3 ? P686_INT : this.recipe()) : null;
      if (R6 !== null && R6.id >= 0) M = this.w6Ooo(mode, R6);
      else { M = this.ooo(mode); if (this.w6 !== null) this.w6Push(); }
      T = M - this.cycles;
      this.trFloor = 0;
      if (T < 1) { st.floor++; T = 1; this.trFloor = 1; }
    }
    this.cycles += T;
    this.oS[O_CYC] = this.cycles;
    const tr = this.trace;
    if (!tr) return T;

    // ---- the trace: the model times go into the step (t = 0 is the model clock M - T) ----
    const base = M - T, rel = x => { const t = x - base; return t < 0 ? 0 : t > T - 1 ? T - 1 : t; };
    const out = [], bus = this.bus;
    const cs = this.decCS, ip = this.decIP, lb = this.lastBase, bits = this.decBits;
    const peek = bus.peek8 ? a => bus.peek8(a) : a => bus.read8(a);
    const reader = (b, o) => i => { const pa = this.peekPhys((b + o + i) >>> 0); return pa < 0 ? 0 : peek(pa); };
    let dtext = text;
    if (!dtext) {
      if (typeof Disasm86 !== 'undefined') {
        try { dtext = Disasm86.decode(reader(lb, ip), ip, { cpu: '686', bits }).text; } catch (e) { dtext = 'op ' + (this.op | 0).toString(16); }
      } else dtext = 'op ' + (this.op | 0).toString(16);
      if (this.repStateText) dtext += this.repStateText;
    }
    const idle = halted && text !== null, seq = this.oS[O_SEQ];
    out.push({ k: 'decode', t: 0, cs, ip, len: this.ibytes.length, text: dtext, bytes: this.ibytes.slice(), bits,
      uops: idle ? 0 : this.trN, decoder: idle ? '' : ['D0', 'D1', 'D2', 'MS'][this.trDecoder], dclk: idle ? -1 : this.trDec });
    let sp = rel(this.trDec - this.codeLat);
    for (const e of this.stallEv) { e.t = sp < T - 1 ? sp : T - 1; sp += e.len; out.push(e); }
    let bp = this.trT0 >= 0 ? rel(this.trT0) : 0;
    for (const e of this.euEv) { e.t = bp < T - 1 ? bp : T - 1; bp += e.len; out.push(e); }
    if (this.ibytes.length) out.push({ k: 'queue', t: 0, op: 'pop', n: this.ibytes.length, q: this.q });
    const mid = T >> 1;
    for (const e of this.ev) {
      if (e.k === 'ea') e.t = 0;
      else if (e.k === 'queue') e.t = T - 1;
      else e.t = e.t !== undefined ? (e.t < T - 1 ? e.t : T - 1) : mid;
      out.push(e);
    }
    for (const e of this.cacheEv) { e.t = 0; out.push(e); }
    if (!idle) {
      const R = this.rob;
      for (const e of this.uopEv) {
        e.text = dtext;
        let passed = 0;
        for (let k = 0; k < 40; k++) if (R.uop[k] >= 0 && R.uop[k] < e.id && R.dispatch[k] > e.dispatch && R.retire[k] > e.dispatch) passed++;
        e.passed = passed;
        out.push(e);
      }
      out.push({ k: 'rat', t: 0, n: seq, reads: this.trRat.reads, writes: this.trRat.writes });
      if (this.btbEv) { this.btbEv.t = rel(this.btbEv.resolve); out.push(this.btbEv); }
      const t0 = this.uopEv.length ? this.uopEv[0].issue : M;
      let robUsed = 0, rsUsed = 0;
      for (let k = 0; k < 40; k++) if (R.issue[k] >= 0 && R.issue[k] <= t0 && R.retire[k] > t0) robUsed++;
      for (let k = 0; k < 20; k++) if (this.rs.issue[k] >= 0 && this.rs.issue[k] <= t0 && this.rs.dispatch[k] > t0) rsUsed++;
      out.push({ k: 'rob', t: T - 1, n: seq, uops: this.trN, first: this.trFirst, retire: M, prev, base, rob: robUsed, rs: rsUsed,
        floor: this.trFloor, debt: this.cycles - M });
    }
    const sn = this.snap;
    for (let i = 0; i < 8; i++) if (sn.r[i] !== this.r[i]) out.push({ k: 'reg', t: T - 1, r: P386_REG32[i], v: this.r[i] });
    for (let i = 0; i < 6; i++) if (sn.s[i] !== this.sregs[i]) out.push({ k: 'reg', t: T - 1, r: P386_SREG[i], v: this.sregs[i] });
    if (sn.f !== this.eflags) out.push({ k: 'flags', t: T - 1, v: this.eflags, old: sn.f });
    if (sn.cr0 !== this.cr[0]) out.push({ k: 'reg', t: T - 1, r: 'CR0', v: this.cr[0] });
    if (sn.cr2 !== this.cr[2]) out.push({ k: 'reg', t: T - 1, r: 'CR2', v: this.cr[2] });
    if (sn.cr3 !== this.cr[3]) out.push({ k: 'reg', t: T - 1, r: 'CR3', v: this.cr[3] });
    if (this.snapCr4 !== this.cr[4]) out.push({ k: 'reg', t: T - 1, r: 'CR4', v: this.cr[4] });
    out.push({ k: 'reg', t: T - 1, r: 'EIP', v: this.ip });
    out.push({ k: 'end', t: T });
    out.sort((a, b) => a.t - b.t);
    this.trace = out;
    this.repStateText = null;
    return T;
  }

  // ---------- the P6 instructions ----------
  exec0Fop(op2) {
    this.op2 = op2;
    if (op2 >= 0x40 && op2 <= 0x4F) { if (this.lock) throw this.fault(6); this.cmov(op2); return; }
    if (op2 === 0x0B) throw this.fault(6);         // UD2: the defined #UD
    if (op2 === 0x33) { if (this.lock) throw this.fault(6); this.rdpmc(); return; }
    super.exec0Fop(op2);
  }
  // CMOVcc r, r/m (0F 40-4F): the P6 reads the source operand also when the condition is false (a
  // memory operand can fault); only a true condition writes the destination.
  cmov(op2) {
    this.modrm();
    const S = this.osz, v = this.getE(S);
    if (this.cond(op2 & 15)) this.setG(S, v);
    if (this.trace) this.ev.push({ k: 'alu', op: 'CMOV', a: this.cond(op2 & 15) ? 1 : 0, b: v, r: this.getG(S), w: S * 8 });
  }
  // CR4: TSD, DE, PSE, MCE, PGE and PCE can change; the other bits (VME, PVI, PAE, the reserved bits)
  // give #GP(0). A change of PSE or PGE flushes all TLB entries (also the global ones).
  setCR4(v) {
    v >>>= 0;
    if (v & ~P686_CR4) throw this.fault(13, 0);
    const old = this.cr[4];
    this.cr[4] = v;
    if ((old ^ v) & (C4_PSE | C4_PGE)) this.flushTLBAll();
    if ((old ^ v) & C4_DE) this.updateDebug();
    if (this.trace) {
      const on = [[C4_TSD, 'TSD'], [C4_DE, 'DE'], [C4_PSE, 'PSE'], [C4_MCE, 'MCE'], [C4_PGE, 'PGE'], [C4_PCE, 'PCE']].filter(([b]) => v & b).map(([, s]) => s);
      this.sysEv('CR4', `CR4 = ${v.toString(16).toUpperCase().padStart(8, '0')}${on.length ? ' (' + on.join(' ') + ')' : ''}`);
    }
  }
  // CPUID: leaf 0 = the highest leaf (2) and "GenuineIntel"; leaf 1 = the signature (family 6, model 1,
  // stepping 9) and the feature bits; leaf 2 = the cache and TLB descriptors of the Pentium Pro
  // (256 KB L2); higher leaves give 0.
  cpuid() {
    const R = this.r, leaf = R[0];
    if (leaf === 0) { R[0] = 2; R[3] = 0x756E6547; R[2] = 0x49656E69; R[1] = 0x6C65746E; }
    else if (leaf === 1) { R[0] = CPU80686.SIGNATURE; R[3] = 0; R[1] = 0; R[2] = CPU80686.FEATURES | (this.bus.fpu ? 1 : 0); }
    else if (leaf === 2) { R[0] = 0x03020101; R[3] = 0; R[1] = 0; R[2] = 0x06040A42; }
    else { R[0] = 0; R[1] = 0; R[2] = 0; R[3] = 0; }
    if (this.trace) this.sysEv('CPUID', `leaf ${leaf}: EAX ${(R[0] >>> 0).toString(16).toUpperCase()}h, EDX ${(R[2] >>> 0).toString(16).toUpperCase()}h`);
  }
  // RDMSR / WRMSR (CPL 0): ECX = the MSR (the P6 numbers).
  //   00h, 01h P5_MC_ADDR / P5_MC_TYPE (read 0), 10h TSC (WRMSR writes the low 32 bits and clears the
  //   high 32 bits, as the P6), 79h BIOS_UPDT_TRIG (write only: no update occurs), 8Bh BIOS_SIGN
  //   (EDX = the microcode revision: 0), C1h / C2h PerfCtr0 / 1 (40 bits; WRMSR: bits 32-39 = bit 31),
  //   179h MCG_CAP (5 banks, MCG_CTL present), 17Ah MCG_STATUS, 17Bh MCG_CTL, 186h / 187h PerfEvtSel0 / 1,
  //   400h-413h MC0-MC4 CTL, STATUS, ADDR, MISC (no machine check occurs: STATUS and ADDR are 0; MISC
  //   gives #GP, as on the P6). Another number gives #GP(0).
  rdmsr() {
    this.msrPriv();
    const R = this.r, n = R[1] >>> 0;
    switch (n) {
      case 0x00: case 0x01: case 0x17A: R[0] = 0; R[2] = 0; break;
      case 0x10: this.tscTo(R); break;
      case 0x8B: R[0] = 0; R[2] = this.ucodeRev; break;
      case 0xC1: case 0xC2: { const v = this.pmcValue(n - 0xC1); R[0] = v % 4294967296; R[2] = Math.floor(v / 4294967296) & 0xFF; break; }
      case 0x179: R[0] = 0x105; R[2] = 0; break;
      case 0x17B: R[0] = this.mcgCtl[0]; R[2] = this.mcgCtl[1]; break;
      case 0x186: case 0x187: R[0] = this.evtSel[n - 0x186]; R[2] = 0; break;
      default:
        if (n >= 0x400 && n < 0x414) {
          const b = (n - 0x400) >> 2, f = n & 3;
          if (f === 3) throw this.fault(13, 0);
          if (f === 0) { R[0] = this.mcCtl[2 * b]; R[2] = this.mcCtl[2 * b + 1]; } else { R[0] = 0; R[2] = 0; }
          break;
        }
        throw this.fault(13, 0);
    }
    if (this.trace) this.sysEv('RDMSR', `MSR ${n.toString(16).toUpperCase()}h = ${this.hex64(R[2], R[0])}`);
  }
  wrmsr() {
    this.msrPriv();
    const R = this.r, n = R[1] >>> 0, lo = R[0] >>> 0, hi = R[2] >>> 0;
    switch (n) {
      case 0x00: case 0x01: case 0x79: case 0x17A: break;
      case 0x10: this.tscOff = BigInt(lo) - BigInt(Math.floor(this.cycles + this.clk)); break;
      case 0x8B: this.ucodeRev = 0; break;
      case 0xC1: case 0xC2: {
        const k = n - 0xC1;
        this.ctrBase[k] = (lo & 0x80000000 ? 0xFF * 4294967296 : 0) + lo;
        this.ctrRaw[k] = this.pmcEvent(k);
        break;
      }
      case 0x17B: this.mcgCtl[0] = lo; this.mcgCtl[1] = hi; break;
      case 0x186: case 0x187: {
        for (let k = 0; k < 2; k++) this.ctrBase[k] = this.pmcValue(k);
        this.evtSel[n - 0x186] = lo & (n === 0x186 ? 0xFFDFFFFF : 0xFF9FFFFF);   // bit 21 reserved; EN (bit 22) only in PerfEvtSel0
        for (let k = 0; k < 2; k++) this.ctrRaw[k] = this.pmcEvent(k);
        break;
      }
      default:
        if (n >= 0x400 && n < 0x414) {
          const b = (n - 0x400) >> 2, f = n & 3;
          if (f === 0) { this.mcCtl[2 * b] = lo; this.mcCtl[2 * b + 1] = hi; break; }
          if (f === 3 || lo !== 0 || hi !== 0) throw this.fault(13, 0);   // STATUS / ADDR: only 0 can be written
          break;
        }
        throw this.fault(13, 0);
    }
    if (this.trace) {
      const ev = (n === 0x186 || n === 0x187) && P686_EVENTS[lo & 0xFF] ? ` (the event ${P686_EVENTS[lo & 0xFF]})` : '';
      this.sysEv('WRMSR', `MSR ${n.toString(16).toUpperCase()}h = ${this.hex64(hi, lo)}${ev}`);
    }
  }
  // RDPMC (0F 33): EDX:EAX = the performance counter ECX (0 or 1; 40 bits). #GP(0) for another ECX,
  // and at CPL > 0 (protected mode and virtual-8086 mode) when CR4.PCE = 0.
  rdpmc() {
    const R = this.r, n = R[1] >>> 0;
    if (n > 1) throw this.fault(13, 0);
    if ((this.cr[0] & 1) && this.cpl !== 0 && !(this.cr[4] & C4_PCE)) throw this.fault(13, 0);
    const v = this.pmcValue(n);
    R[0] = v % 4294967296; R[2] = Math.floor(v / 4294967296) & 0xFF;
    if (this.trace) this.sysEv('RDPMC', `counter ${n} = ${this.hex64(R[2], R[0])}`);
  }
  // The performance counters. PerfEvtSel bits 0-7 = the event (P686_EVENTS), bit 16 USR, bit 17 OS,
  // bit 22 EN (in PerfEvtSel0: it starts both counters). A counter counts the change of its event
  // while EN = 1 and USR or OS = 1 (the core does not look at the CPL, the edge bit, the invert bit
  // or the counter mask).
  pmcEvent(k) {
    const sel = this.evtSel[k];
    if (!(this.evtSel[0] & 0x400000) || !(sel & 0x30000)) return 0;
    const st = this.oooStats, d = this.dcache.stats, ic = this.icache.stats, l2 = this.l2.stats, b = this.btb.stats;
    switch (sel & 0xFF) {
      case 0x03: return st.ldBlocks;
      case 0x12: return st.mul;
      case 0x13: return st.div;
      case 0x24: return l2.fills;
      case 0x26: return l2.writeBacks;
      case 0x2E: return l2.requests;
      case 0x43: return d.hits + d.misses + d.writeHits + d.writeMisses;
      case 0x45: return d.fills;
      case 0x47: return d.writeBacks;
      case 0x79: return this.cycles + this.clk - st.haltClk;
      case 0x80: return ic.hits + ic.misses;
      case 0x81: return ic.misses;
      case 0x85: return this.tlbStats.codeMisses;
      case 0xA2: return st.robFull + st.rsFull + st.sbFull;
      case 0xC0: case 0xD0: return this.instructions;
      case 0xC1: return st.flops;
      case 0xC2: return st.uops;
      case 0xC4: return b.branches;
      case 0xC5: return b.wrong;
      case 0xC9: return b.taken;
      case 0xD2: return st.partial;
      case 0xE2: return b.misses;
      case 0xE6: return st.baclears;
      default: return 0;
    }
  }
  pmcValue(k) {
    const v = this.ctrBase[k] + this.pmcEvent(k) - this.ctrRaw[k];
    return ((v % 1099511627776) + 1099511627776) % 1099511627776;
  }

  // ---------- the FPU on the chip: the P5 path, and FCMOVcc and FCOMI / FUCOMI (P6) ----------
  esc(op) {
    const fpu = this.bus.fpu;
    if (!fpu) { CPU80386.prototype.esc.call(this, op); return; }
    if (this.cr[0] & 0xC) throw this.fault(7);      // EM or TS: #NM
    this.modrm();
    const mem = this.mod !== 3, modrm = (this.mod << 6) | (this.reg << 3) | this.rm;
    this.fpTop = fpu.top;
    const control = mem ? (op === 0xD9 || op === 0xDD) && this.reg >= 4
      : (op === 0xDB && modrm >= 0xE0 && modrm <= 0xE4) || (op === 0xDF && modrm === 0xE0);
    if (!control && this.fpuError()) throw this.fault(16);
    if (!mem && ((op === 0xDA || op === 0xDB) && modrm < 0xE0 || (op === 0xDB || op === 0xDF) && modrm >= 0xE8 && modrm <= 0xF7)) {
      this.fpuP6(fpu, op, modrm);
      return;
    }
    const info = mem && fpu.memOperand ? fpu.memOperand(op, modrm) : null, n = info ? info.bytes : 0;
    const sg = this.eaSeg, off = this.eaOff;
    let buf = null;
    if (n) {
      const al = n === 2 ? 2 : n === 4 ? 4 : n === 8 || n === 10 ? 8 : this.osz;
      if ((this.linear(sg, off) & (al - 1)) && this.acOn()) throw this.fault(17, 0);
      this.noAC = true;
      if (info.write) this.wrCheck(sg, off, n);
      else {
        buf = new Uint8Array(n);
        for (let k = 0; k < n;) {
          const z = n - k >= 4 ? 4 : n - k >= 2 ? 2 : 1, v = this.rd(sg, this.addA(off, k), z);
          for (let j = 0; j < z; j++) buf[k + j] = (v >>> (8 * j)) & 0xFF;
          k += z;
        }
      }
    }
    const base = mem ? this.cache[sg].base & 0xFFFFFF : 0, off16 = off & 0xFFFF;
    const ea = mem ? { seg: this.sregs[sg], off: off16, base } : null;
    const idx = a => ((((a - base) & 0xFFFFFF) - off16) & 0xFFFF);
    const wbuf = [];
    const saved = fpu.mem;
    fpu.mem = { read8: a => (buf ? buf[idx(a)] | 0 : 0), write8: (a, v) => { wbuf[idx(a)] = v & 0xFF; } };
    fpu.instrPtr = this.linear(CS, this.lastIP);
    fpu.nextIpOff = this.lastIP & 0xFFFF; fpu.nextIpSel = this.lastCS;
    let res;
    try { res = fpu.exec(op, modrm, ea) || { cycles: 0 }; } finally { fpu.mem = saved; }
    if (res.ax !== undefined) this.rset(0, 2, res.ax);
    for (let k = 0; k < wbuf.length;) {
      if (wbuf[k] === undefined) { k++; continue; }
      let z = wbuf.length - k >= 4 ? 4 : wbuf.length - k >= 2 ? 2 : 1;
      while (z > 1 && wbuf[k + z - 1] === undefined) z >>= 1;
      let v = 0;
      for (let j = 0; j < z; j++) v |= wbuf[k + j] << (8 * j);
      this.wr(sg, this.addA(off, k), z, z === 4 ? v >>> 0 : v);
      k += z;
    }
    this.noAC = false;
    fpu.busyCycles = 0;
    if (this.trace) this.ev.push({ k: 'fpu', text: res.text || '', cycles: res.cycles || 0 });
  }
  // FCMOVcc ST0, ST(i) (DA / DB C0-DF): ST0 = ST(i) when the condition (CF, ZF, CF | ZF, PF; DB: not)
  // is true. FUCOMI / FCOMI (DB E8-F7) and FUCOMIP / FCOMIP (DF E8-F7): compare ST0 with ST(i) and set
  // ZF, PF, CF (greater 000, less 001, equal 100, unordered 111); OF, SF and AF are 0. FCOMI gives
  // IE for any NaN, FUCOMI only for a signaling NaN. An empty register gives a stack underflow (IE
  // and SF). With IE masked the flags show "unordered"; an unmasked IE writes no flags and does not
  // pop. C1 = 0; C0, C2 and C3 do not change.
  fpuP6(fpu, op, modrm) {
    const i = modrm & 7, p0 = fpu.top & 7, pi = (fpu.top + i) & 7, f = this.f;
    fpu.instrPtr = this.linear(CS, this.lastIP);
    fpu.nextIpOff = this.lastIP & 0xFFFF; fpu.nextIpSel = this.lastCS;
    const empty = fpu.empty[p0] || fpu.empty[pi];
    let text;
    if (modrm < 0xE0) {
      const c = (modrm >> 3) & 3, neg = op === 0xDB;
      let cond = c === 0 ? (f & F_CF) !== 0 : c === 1 ? (f & F_ZF) !== 0 : c === 2 ? (f & (F_CF | F_ZF)) !== 0 : (f & F_PF) !== 0;
      if (neg) cond = !cond;
      const mn = (neg ? 'FCMOVN' : 'FCMOV') + ['B', 'E', 'BE', 'U'][c];
      fpu._sw &= ~0x200;
      if (empty) {
        fpu._sw |= 0x41;                          // IE and SF: stack underflow
        if (fpu.cw & 1) { fpu._set(0, F80.INDEF); text = `${mn}: stack underflow, ST0 = indefinite`; } else text = `${mn}: stack underflow (unmasked), no result`;
      } else if (cond) { fpu._set(0, fpu.regs[pi]); text = `${mn}: condition true, ST0 = ST${i} = ${F80.toString(fpu.regs[pi], 18)}`; }
      else text = `${mn}: condition false, ST0 does not change`;
    } else {
      const unord = modrm < 0xF0, pop = op === 0xDF;
      const mn = 'F' + (unord ? 'U' : '') + 'COMI' + (pop ? 'P' : '');
      fpu._sw &= ~0x200;
      let rel = 2, ok = true;                     // rel: -1 less, 0 equal, 1 greater, 2 unordered
      if (empty) { fpu._sw |= 0x41; ok = (fpu.cw & 1) !== 0; }
      else {
        const a = fpu.regs[p0], b = fpu.regs[pi], ca = F80.cls(a), cb = F80.cls(b);
        if (ca === 'nan' || cb === 'nan') {
          const snan = v => F80.cls(v) === 'nan' && !(v.mant & 0x4000000000000000n);
          if (!unord || snan(a) || snan(b)) { fpu._sw |= 1; ok = (fpu.cw & 1) !== 0; }
        } else {
          if (ca === 'denormal' || cb === 'denormal') { fpu._sw |= 2; ok = (fpu.cw & 2) !== 0; }
          if (ok) rel = F80.cmp(a, b);
        }
      }
      if (ok) {
        let nf = f & ~(F_CF | F_PF | F_ZF | F_OF | F_SF | F_AF);
        if (rel === 0) nf |= F_ZF; else if (rel === -1) nf |= F_CF; else if (rel === 2) nf |= F_ZF | F_PF | F_CF;
        this.f = nf;
        if (pop) fpu._pop();
        text = `${mn}: ST0 ${['<', '=', '>', 'unordered'][rel + 1]} ST${i}: ZF = ${rel === 0 || rel === 2 ? 1 : 0}, PF = ${rel === 2 ? 1 : 0}, CF = ${rel === -1 || rel === 2 ? 1 : 0}${pop ? ', pop' : ''}`;
      } else text = `${mn}: unmasked exception, no result`;
    }
    fpu._updateIR();
    fpu.opcode11 = ((op & 7) << 8) | modrm;
    fpu.ipOff = fpu.nextIpOff; fpu.ipSel = fpu.nextIpSel;
    fpu.busyCycles = 0;
    if (this.trace) this.ev.push({ k: 'fpu', text, cycles: 0 });
  }
}

// The CPUID signature and the EDX value after reset: family 6, model 1, stepping 9 (Pentium Pro).
CPU80686.SIGNATURE = 0x0619;
// CPUID leaf 1 EDX (without the FPU bit 0): DE (2), PSE (3), TSC (4), MSR (5), MCE (7), CX8 (8),
// PGE (13), MCA (14), CMOV (15). Not in the core (0): VME, PAE, APIC, SEP, MTRR.
CPU80686.FEATURES = 0xE1BC;
