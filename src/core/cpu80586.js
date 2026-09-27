// Intel Pentium (P5) CPU core. It extends CPU80486 (src/core/cpu80486.js) and keeps its step()
// and micro-event contract (see ARCHITECTURE.md, "Pentium core (CPU80586)").
//
// - The P5 instructions: RDTSC, RDMSR, WRMSR, CMPXCHG8B, MOV to / from CR4. CPUID gives family 5,
//   model 1, stepping 7 (a Pentium 60 / 66).
// - CR4: TSD (RDTSC only at CPL 0), DE (I/O breakpoints; DR4 / DR5 give #UD), PSE (4 MB pages),
//   MCE (no machine check occurs). VME and PVI are not in the core: MOV CR4 with them gives #GP.
// - Two caches of 8 KB: a code cache and a data cache. Each is 2-way set associative with 128
//   sets of 32-byte lines. The data cache is write-back with the MESI states. The emulator
//   writes each store to memory at once, so memory always has the newest bytes: the M state
//   and the write-back bursts are only for the timing and the views.
// - The 64-bit data bus: a line fill is a burst of 4 transfers of 8 bytes (2-1-1-1 clocks).
// - Two pipes, U and V. The core looks at the next instruction at the end of each instruction
//   and applies the P5 pairing rules. A pair takes the clocks of the longer instruction, but a
//   step always takes 1 clock or more (see the clock rule at finish()).
// - A branch target buffer (BTB) of 256 entries (64 sets of 4 ways, 2-bit counters). A wrong
//   prediction costs 3 clocks in the U pipe and 4 clocks in the V pipe.
// - P5 clock counts (Intel Pentium manual; cache hits) and the P5 FPU clocks. The FDIV bug of
//   the first Pentium steps is a switch: cpu.fdivBug = true (off by default).
//
// The machine does not see a cache hit (no bus cycle). A write that stays in the cache (an E
// or M line) goes to memory through bus.poke8 when the bus has it (no bus cycle, no heat, no
// counters), else through bus.write8.

const C4_VME = 0x1, C4_PVI = 0x2, C4_TSD = 0x4, C4_DE = 0x8, C4_PSE = 0x10, C4_MCE = 0x40;
const P586_CR4 = C4_TSD | C4_DE | C4_PSE | C4_MCE;        // the CR4 bits of this core
// MESI states of the data cache lines (the code cache lines are S or I).
const P5_I = 0, P5_S = 1, P5_E = 2, P5_M = 3;
const P586_MESI = ['I', 'S', 'E', 'M'];
// TR12 (MSR 0Eh): NBP (no branch prediction), SE (single pipe execution), CI (cache inhibit).
const TR12_NBP = 0x1, TR12_SE = 0x2, TR12_CI = 0x200;
// The first byte of an instruction: 2 = a prefix (the instruction does not pair), 4 = an opcode
// that never pairs, 0 = pairInfo() must look at the instruction.
const P586_PK = new Uint8Array(256).fill(4);
for (let b = 0; b < 0x40; b++) if ((b & 7) < 6) P586_PK[b] = 0;
for (let b = 0x40; b < 0x60; b++) P586_PK[b] = 0;
for (let b = 0x70; b < 0x80; b++) P586_PK[b] = 0;
for (let b = 0xB0; b < 0xC0; b++) P586_PK[b] = 0;
for (let b = 0xD8; b < 0xE0; b++) P586_PK[b] = 0;
for (const b of [0x0F, 0x68, 0x6A, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x88, 0x89, 0x8A, 0x8B, 0x8D, 0x90, 0xA0, 0xA1, 0xA2, 0xA3,
  0xA8, 0xA9, 0xC0, 0xC1, 0xC6, 0xC7, 0xD0, 0xD1, 0xE8, 0xE9, 0xEB, 0xFE, 0xFF]) P586_PK[b] = 0;
for (const b of [0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65, 0x66, 0x67, 0xF0, 0xF2, 0xF3]) P586_PK[b] = 2;
// The registers of a 16-bit address (ModR/M rm field): BX = 8, BP = 32, SI = 64, DI = 128.
const P586_EA16 = [72, 136, 96, 160, 64, 128, 32, 8];
// Pair information bits (see pairInfo): the pipe (bits 16-17), the stack and FPU kinds.
const PI_UV = 1, PI_PU = 2, PI_PV = 3;
const PI_PUSH = 0x40000, PI_POP = 0x80000, PI_FP = 0x100000, PI_FXCH = 0x200000;
// The reasons why an instruction in the U pipe has no partner ($ = a register name).
const P586_WHY = [
  '',                                              // 0: the pair forms
  'V is not in the queue',                         // 1
  'U has a prefix', 'V has a prefix',              // 2, 3
  'U is not a simple instruction', 'V is not a simple instruction',   // 4, 5
  'U has a displacement and an immediate', 'V has a displacement and an immediate',   // 6, 7
  'U is a jump: a jump goes only into the V pipe', // 8
  'V goes only into the U pipe',                   // 9
  'V reads $, which U writes',                     // 10
  'U and V both write $',                          // 11
  'an FPU instruction pairs only with FXCH',       // 12
  'pairing is off (TR12.SE = 1)',                  // 13
  'single step (TF = 1)',                          // 14
  'U changes the flow of the program',             // 15
  'U does not complete (a fault or an exception)', // 16
  'no instruction (an interrupt or HLT)',          // 17
];
// String instructions: [clocks without REP, REP start, clocks for each REP iteration].
const P586_STR = { 0xA4: [4, 13, 1], 0xA6: [5, 9, 4], 0xAA: [3, 9, 1], 0xAC: [2, 7, 3], 0xAE: [4, 9, 4], 0x6C: [9, 11, 3], 0x6E: [13, 13, 4] };
// FPU clocks (Pentium manual, the latency) by the mnemonic that the FPU core reports.
const P586_FPU = [
  [/^FN?INIT/, 16], [/^FN?CLEX/, 9], [/^FN?STSW|^FN?STCW/, 2], [/^FLDCW/, 7], [/^FN?STENV/, 50], [/^FLDENV/, 32],
  [/^FN?SAVE/, 124], [/^FRSTOR/, 70], [/^FLD(1|Z)$/, 2], [/^FLD(PI|L2T|L2E|LG2|LN2)/, 3], [/^FLD$/, 1],
  [/^FSTP?$/, 2], [/^FILD/, 3], [/^FISTP?/, 6], [/^FBLD/, 48], [/^FBSTP/, 148], [/^FI(ADD|SUB|MUL)/, 7],
  [/^FIDIV/, 42], [/^FICOM/, 8], [/^F(ADD|SUB|MUL)/, 3], [/^FDIV/, 39], [/^FU?COM|^FTST/, 1], [/^FXAM/, 21],
  [/^FCHS|^FABS|^FXCH|^FFREE|^FNOP|^FINCSTP|^FDECSTP/, 1], [/^FSQRT/, 70], [/^FPREM/, 40], [/^FSCALE/, 20],
  [/^FRNDINT/, 20], [/^FXTRACT/, 13], [/^FPTAN/, 120], [/^FPATAN/, 100], [/^F2XM1/, 40], [/^FYL2XP1/, 80], [/^FYL2X/, 80],
];
const P586_FPU_MEMO = new Map();

class CPU80586 extends CPU80486 {
  constructor(bus) {
    super(bus);
    this.fdivBug = false;       // true: FDIV, FDIVR and FIDIV give the wrong results of the first P5 steps
    // true (the P5): a write to the bytes in the prefetch queue empties the queue. The 386 test
    // suite sets false, because the 80386 runs the old bytes of its queue.
    this.queueSnoop = true;
  }
  // The constructor of CPU8086 calls reset(), which makes the P5 state on the first call.
  reset() {
    super.reset();                            // the 486 reset calls cacheMake() and cacheFlush()
    this.cache486 = null;                     // the P5 has no unified cache (see dcache, icache)
    if (this.tlb.length !== 64) {             // the 386 reset makes a TLB of 32 entries
      this.tlb = [];
      for (let i = 0; i < 64; i++) this.tlb.push({ lin: 0, phys: 0, flags: 0, valid: false });
      this.tlbNext = new Uint8Array(16);
    }
    this.flushTLB();
    const ts = this.tlbStats;
    ts.hits = 0; ts.misses = 0; ts.flushes = 0; ts.codeHits = 0; ts.codeMisses = 0; ts.bigHits = 0;
    this.r[2] = CPU80586.SIGNATURE;           // EDX after reset: the CPUID signature
    this.cr[4] = 0;
    this.tscOff = 0n; this.tr12 = 0; this.mcAddr = 0; this.mcType = 0;
    this.cesr = 0;
    if (!this.ctrBase) { this.ctrBase = new Float64Array(2); this.ctrRaw = new Float64Array(2); }
    this.ctrBase.fill(0); this.ctrRaw.fill(0);
    for (const C of [this.dcache, this.icache]) for (const k of Object.keys(C.stats)) C.stats[k] = 0;
    const B = this.btb;
    B.tag.fill(-1); B.counter.fill(0); B.target.fill(0); B.next.fill(0);
    for (const k of Object.keys(B.stats)) B.stats[k] = 0;
    const P = this.pipeStats;
    P.u = 0; P.v = 0; P.floor = 0; P.why.fill(0);
    this.pairNext = false; this.pairIP = 0; this.isV = false; this.uClk = 0; this.uRet = 0;
    this.execOk = false; this.pWhy = 0; this.pReg = 0; this.lastWhy = 0; this.wbLine = -1;
    this.vInfo = 0; this.vWhy = 0; this.vIP = -1; this.vBase = 0;
    this.snapCr4 = 0; this.ioBp = false; this.spClk = 0;
    if (!this.ib) this.ib = new Uint8Array(16);
  }

  // ---------- the two caches, the TLBs, the BTB and the pipe counters ----------
  // The 486 reset calls this when cache486 is not set. It makes the P5 parts one time and gives
  // the 486 reset a small cache486 object (reset() sets cache486 to null after it).
  cacheMake() {
    this.cache486 = { stats: {} };
    if (this.dcache) return;
    // Line i = set * 2 + way. tag[i] = physical address bits 12-31, or -1 (invalid). lru[set] = the
    // way that the next fill replaces. data[i * 32 + k] = byte k of the line.
    const mk = () => ({ sets: 128, ways: 2, lineSize: 32, tag: new Int32Array(256).fill(-1), lru: new Uint8Array(128), data: new Uint8Array(8192) });
    this.dcache = Object.assign(mk(), { state: new Uint8Array(256),
      stats: { hits: 0, misses: 0, fills: 0, uncached: 0, writeHits: 0, writeMisses: 0, writeHitsME: 0, writeBacks: 0, flushes: 0, invalidations: 0 } });
    this.icache = Object.assign(mk(), { stats: { hits: 0, misses: 0, fills: 0, uncached: 0, flushes: 0, invalidations: 0 } });
    this.dtag = this.dcache.tag; this.itag = this.icache.tag; this.ctag = this.dtag;
    // TLBs: tlb (4 KB data pages, made again by reset()), tlb4m (4 MB data pages, 2 sets of 4
    // ways), itlb (code: 8 sets of 4 ways; a 4 MB page goes in as a 4 KB entry).
    const ents = n => { const a = []; for (let i = 0; i < n; i++) a.push({ lin: 0, phys: 0, flags: 0, valid: false }); return a; };
    this.tlb4m = ents(8); this.tlb4mNext = new Uint8Array(2);
    this.itlb = ents(32); this.itlbNext = new Uint8Array(8);
    this.btb = { sets: 64, ways: 4, tag: new Int32Array(256).fill(-1), target: new Uint32Array(256), counter: new Uint8Array(256),
      next: new Uint8Array(64), stats: { lookups: 0, hits: 0, right: 0, wrong: 0, allocs: 0, taken: 0 } };
    this.pipeStats = { u: 0, v: 0, floor: 0, why: new Uint32Array(P586_WHY.length), reasons: P586_WHY };
    this.pMemo = new Int32Array(1024); this.pMemoV = new Int32Array(1024); this.pMemoW = new Uint8Array(1024);
  }
  // INVD, WBINVD, reset: all lines of both caches become invalid.
  cacheFlush() {
    if (!this.dcache) return;
    this.dtag.fill(-1); this.itag.fill(-1); this.dcache.state.fill(P5_I);
    this.dcache.lru.fill(0); this.icache.lru.fill(0);
    this.dcache.stats.flushes++; this.icache.stats.flushes++;
  }
  // The machine calls this when a DMA channel (or another bus master) writes memory: the lines
  // of phys .. phys + len - 1 become invalid in both caches. The core ignores it with CR0.NW = 1
  // (as the 486). Memory has the newest CPU bytes, so an M line needs no write-back here.
  // Returns the number of lines that became invalid.
  cacheInvalidate(phys, len = 1) {
    if (this.cr[0] & C0_NW) return 0;
    const DT = this.dtag, IT = this.itag, end = phys + len;
    let nd = 0, ni = 0;
    if (len >= 0x2000) {
      for (let i = 0; i < 256; i++) {
        const so = (i >> 1) << 5;                     // the set part of the line address
        if (DT[i] >= 0) { const a = ((DT[i] << 12) | so) >>> 0; if (a + 32 > phys && a < end) { DT[i] = -1; this.dcache.state[i] = P5_I; nd++; } }
        if (IT[i] >= 0) { const a = ((IT[i] << 12) | so) >>> 0; if (a + 32 > phys && a < end) { IT[i] = -1; ni++; } }
      }
    } else {
      for (let a = phys - (phys & 31); a < end; a += 32) {
        const pa = a >>> 0, i = ((pa >>> 5) & 127) << 1, tag = pa >>> 12;
        if (DT[i] === tag) { DT[i] = -1; this.dcache.state[i] = P5_I; nd++; } else if (DT[i + 1] === tag) { DT[i + 1] = -1; this.dcache.state[i + 1] = P5_I; nd++; }
        if (IT[i] === tag) { IT[i] = -1; ni++; } else if (IT[i + 1] === tag) { IT[i + 1] = -1; ni++; }
      }
    }
    this.dcache.stats.invalidations += nd; this.icache.stats.invalidations += ni;
    return nd + ni;
  }
  // The line index (set * 2 + way) of a physical address in the data cache or the code cache (-1: none).
  dFind(pa) { const i = ((pa >>> 5) & 127) << 1, t = pa >>> 12, T = this.dtag; return T[i] === t ? i : T[i + 1] === t ? i + 1 : -1; }
  iFind(pa) { const i = ((pa >>> 5) & 127) << 1, t = pa >>> 12, T = this.itag; return T[i] === t ? i : T[i + 1] === t ? i + 1 : -1; }
  cacheFind(pa) { return this.dFind(pa >>> 0); }
  lineAddr(tag, i) { return ((tag << 12) | ((i >> 1) << 5)) >>> 0; }
  fillTime() { return this.busLen + 3 * (this.busLen - 1); }

  // Data line fill: 32 bytes from the bus in a burst of 4 transfers of 8 bytes. The first transfer
  // has the 8 bytes that the CPU needs (the order 0-8-10-18, 8-0-18-10, 10-18-0-8, 18-10-8-0). The
  // new line is E (S when the page has PWT = 1). An M line that the fill replaces goes to the bus
  // in a write-back burst after the fill. Returns the line index.
  dFill(pa, s, attr) {
    const DC = this.dcache, T = this.dtag, set = (pa >>> 5) & 127, line = (pa - (pa & 31)) >>> 0, bus = this.bus;
    const w = T[set << 1] < 0 ? 0 : T[(set << 1) + 1] < 0 ? 1 : DC.lru[set];
    const i = (set << 1) + w, D = DC.data, base = i << 5, tr = this.trace;
    const old = T[i] >= 0 && DC.state[i] === P5_M ? this.lineAddr(T[i], i) : -1;
    const oldData = old >= 0 && tr ? D.slice(base, base + 32) : null;
    for (let k = 0; k < 32; k++) D[base + k] = bus.read8((line + k) >>> 0);
    T[i] = pa >>> 12; DC.state[i] = attr & 8 ? P5_S : P5_E; DC.lru[set] = w ^ 1;
    DC.stats.fills++;
    const first = (pa >>> 3) & 3;
    this.lastFillEv = null;
    for (let j = 0; j < 4; j++) {
      const o = (first ^ j) << 3, a = (line + o) >>> 0, len = j ? this.busLen - 1 : this.busLen;
      const e = this.busEv('memr', a, tr ? this.dw(D, base + o) : 0, 8, s, len, tr ? { burst: true, line, beat: j, hi: this.dw(D, base + o + 4) } : undefined);
      if (!j) this.lastFillEv = e;
    }
    this.wbLine = old;
    if (old >= 0) this.wbBurst(old, s, oldData);
    return i;
  }
  // The write-back of an M line: a burst of 4 transfers of 8 bytes ('memw', wb: true).
  wbBurst(line, s, data) {
    this.dcache.stats.writeBacks++;
    for (let j = 0; j < 4; j++) {
      const len = j ? this.busLen - 1 : this.busLen;
      this.busEv('memw', (line + (j << 3)) >>> 0, data ? this.dw(data, j << 3) : 0, 8, s, len,
        this.trace ? { burst: true, line, beat: j, hi: data ? this.dw(data, (j << 3) + 4) : 0, wb: true } : undefined);
    }
  }
  dw(D, o) { return (D[o] | (D[o + 1] << 8) | (D[o + 2] << 16) | (D[o + 3] << 24)) >>> 0; }
  // WBINVD: all M lines go to the bus (write-back bursts). Returns their number.
  writeBackAll() {
    const DC = this.dcache;
    let n = 0;
    for (let i = 0; i < 256; i++) {
      if (this.dtag[i] < 0 || DC.state[i] !== P5_M) continue;
      this.wbBurst(this.lineAddr(this.dtag[i], i), -1, this.trace ? DC.data.slice(i << 5, (i << 5) + 32) : null);
      n++;
    }
    return n;
  }
  // Code line fill: the same burst on the bus, as 'fetch' cycles. Returns the line index.
  iFill(pa, stall) {
    const IC = this.icache, T = this.itag, set = (pa >>> 5) & 127, line = (pa - (pa & 31)) >>> 0, bus = this.bus;
    const w = T[set << 1] < 0 ? 0 : T[(set << 1) + 1] < 0 ? 1 : IC.lru[set];
    const i = (set << 1) + w, D = IC.data, base = i << 5, tr = this.trace;
    for (let k = 0; k < 32; k++) D[base + k] = bus.read8((line + k) >>> 0);
    T[i] = pa >>> 12; IC.lru[set] = w ^ 1;
    IC.stats.fills++;
    const first = (pa >>> 3) & 3;
    this.lastFillEv = null;
    for (let j = 0; j < 4; j++) {
      const o = (first ^ j) << 3, len = j ? this.busLen - 1 : this.busLen;
      const e = this.codeEv((line + o) >>> 0, tr ? this.dw(D, base + o) : 0, 8, len, stall, tr ? { burst: true, line, beat: j, hi: this.dw(D, base + o + 4) } : null);
      if (!j) this.lastFillEv = e;
    }
    return i;
  }
  // The first data access and the first code miss of an instruction give a 'cache' event.
  cacheNote586(pa, i, hit, fill, write, code, nc) {
    const e = { k: 'cache', cache: code ? 'code' : 'data', phys: pa, set: (pa >>> 5) & 127, way: i < 0 ? -1 : i & 1, hit, fill, write,
      state: i < 0 ? 'I' : code ? 'S' : P586_MESI[this.dcache.state[i]] };
    if (code) { e.code = true; this.codeSeen = true; } else this.cacheSeen = true;
    if (nc) e.nc = true;
    if (fill && !code && this.wbLine >= 0) { e.wb = true; e.wbLine = this.wbLine; }
    if (fill) e.ref = this.lastFillEv;
    this.cacheEv.push(e);
  }

  // ---------- bus cycles (64-bit data bus) ----------
  // An access that is not a line fill: one transfer for each aligned group of 8 bytes that it
  // touches (width = the bytes of the group).
  memCycles(type, pa, v, n, s) {
    const k = 8 - (pa & 7);
    if (n <= k) { this.busEv(type, pa, v, n, s); return; }
    this.busEv(type, pa, v & ((1 << (8 * k)) - 1), k, s);
    this.busEv(type, (pa + k) >>> 0, v >>> (8 * k), n - k, s);
  }

  // ---------- physical access through the data cache ----------
  // attr: bit 4 = PCD (no line fill), bit 3 = PWT (write-through: the line stays S).
  physRd(pa, n, s, attr) {
    const off = pa & 31;
    if (off + n > 32) {
      const k = 32 - off;
      return (this.physRd(pa, k, s, attr) | (this.physRd((pa + k) >>> 0, n - k, s, attr) << (8 * k))) >>> 0;
    }
    const DC = this.dcache, st = DC.stats, T = this.dtag, i0 = ((pa >>> 5) & 127) << 1, tag = pa >>> 12;
    let i = T[i0] === tag ? i0 : T[i0 + 1] === tag ? i0 + 1 : -1, fill = false;
    const hit = i >= 0;
    if (hit) { st.hits++; DC.lru[i0 >> 1] = (i & 1) ^ 1; }
    else {
      st.misses++;
      this.wbLine = -1;
      if (!(this.cr[0] & C0_CD) && !(attr & 0x10) && !(this.tr12 & TR12_CI) && this.cacheable(pa)) { i = this.dFill(pa, s, attr); fill = true; }
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
    }
    if (this.trace && !this.cacheSeen) this.cacheNote586(pa, i, hit, fill, false, false, i < 0);
    return v;
  }
  // Write n bytes (1-4). A write miss goes to the bus (no line fill). A write hit changes the line:
  // an M line stays M and an E line becomes M with no bus cycle; an S line goes to the bus
  // (write-through) and becomes E when the page has PWT = 0. CR0.CD = 1: all write hits go to the
  // bus and the states stay. CR0.NW = 1: no write hit goes to the bus. Memory always gets the bytes.
  // A write to a line of the code cache makes that code line invalid (self-modifying code).
  physWr(pa, n, v, s, attr) {
    const off = pa & 31;
    if (off + n > 32) {
      const k = 32 - off;
      this.physWr(pa, k, v & (0xFFFFFFFF >>> (32 - 8 * k)), s, attr);
      this.physWr((pa + k) >>> 0, n - k, v >>> (8 * k), s, attr);
      return;
    }
    const DC = this.dcache, st = DC.stats, T = this.dtag, i0 = ((pa >>> 5) & 127) << 1, tag = pa >>> 12, c0 = this.cr[0];
    const i = T[i0] === tag ? i0 : T[i0 + 1] === tag ? i0 + 1 : -1;
    let cyc = true;
    if (i >= 0) {
      const D = DC.data, b = (i << 5) + off;
      for (let k = 0; k < n; k++) D[b + k] = (v >>> (8 * k)) & 0xFF;
      st.writeHits++; DC.lru[i0 >> 1] = (i & 1) ^ 1;
      if (c0 & C0_NW) cyc = false;
      else if (!(c0 & C0_CD)) {
        const sti = DC.state[i];
        if (sti >= P5_E) { cyc = false; st.writeHitsME++; DC.state[i] = P5_M; }
        else if (!(attr & 8)) DC.state[i] = P5_E;
      }
    } else st.writeMisses++;
    const bus = this.bus;
    if (cyc) {
      for (let k = 0; k < n; k++) bus.write8((pa + k) >>> 0, (v >>> (8 * k)) & 0xFF);
      this.memCycles('memw', pa, n === 4 ? v >>> 0 : v & ((1 << (8 * n)) - 1), n, s);
    } else if (bus.poke8) for (let k = 0; k < n; k++) bus.poke8((pa + k) >>> 0, (v >>> (8 * k)) & 0xFF);
    else for (let k = 0; k < n; k++) bus.write8((pa + k) >>> 0, (v >>> (8 * k)) & 0xFF);
    const IT = this.itag;
    if (IT[i0] === tag) { IT[i0] = -1; this.icache.stats.invalidations++; } else if (IT[i0 + 1] === tag) { IT[i0 + 1] = -1; this.icache.stats.invalidations++; }
    if (this.trace && !this.cacheSeen) this.cacheNote586(pa, i, i >= 0, false, true, false, false);
  }
  rdPhysD(pa, attr) { return this.physRd(pa >>> 0, 4, -1, attr || 0); }
  wrPhysD(pa, v, attr) { this.physWr(pa >>> 0, 4, v >>> 0, -1, attr || 0); }

  // ---------- linear access (the page attributes go to the cache) ----------
  wrLin(la, n, v, s, user) {
    let pa = la, attr = 0;
    if (this.paging) {
      if ((la & 0xFFF) + n > 0x1000) { this.wrSplit(la, n, v, s, user); return; }
      pa = this.xlate(la, true, user); attr = this.xPcd;
    }
    this.physWr(pa, n, n === 4 ? v >>> 0 : v & P386_MASK[n], s, attr);
    if (this.qt > this.qh && this.queueSnoop) this.smcCheck(la, n);
    if (this.dbgOn) this.dataBreak(la, n, true);
  }
  wrSplit(la, n, v, s, user) {
    const k = 0x1000 - (la & 0xFFF), la2 = (la + k) >>> 0;
    const p0 = this.xlate(la, true, user), a0 = this.xPcd, p1 = this.xlate(la2, true, user), a1 = this.xPcd;
    this.physWr(p0, k, v & (0xFFFFFFFF >>> (32 - 8 * k)), s, a0);
    this.physWr(p1, n - k, v >>> (8 * k), s, a1);
    if (this.qt > this.qh && this.queueSnoop) this.smcCheck(la, n);
    if (this.dbgOn) this.dataBreak(la, n, true);
  }
  // The P5 sees a write to the bytes in its prefetch buffers: the queue becomes empty and the
  // next fetch gets the new bytes (the core compares the linear addresses).
  smcCheck(la, n) {
    const q = this.qt - this.qh, s0 = (this.cache[CS].base + this.qip - q) >>> 0;
    if (((la - s0) >>> 0) < q || ((s0 - la) >>> 0) < n) { this.qh = 0; this.qt = 0; this.qip = this.ip; }
  }

  // ---------- paging: 4 KB and 4 MB pages, a data TLB and a code TLB ----------
  // TLB flags: bit 1 R/W and bit 2 U/S (both levels), bit 3 PWT, bit 4 PCD, bit 5 A, bit 6 D,
  // bit 7 = a 4 MB page. this.xPcd = the PWT and PCD bits of the last translation.
  flushTLB() {
    for (const e of this.tlb) e.valid = false;
    if (this.tlb4m) { for (const e of this.tlb4m) e.valid = false; for (const e of this.itlb) e.valid = false; }
    this.tlbStats.flushes++;
  }
  tlbFind(la) {
    const set = (la >>> 12) & 15, page = (la & 0xFFFFF000) >>> 0, T = this.tlb;
    for (let i = set * 4; i < set * 4 + 4; i++) { const e = T[i]; if (e.valid && e.lin === page) return e; }
    return null;
  }
  tlbPut(page, frame, flags) { return this.tPut(this.tlb, this.tlbNext, (page >>> 12) & 15, page, frame, flags); }
  tlb4mFind(la) {
    const set = (la >>> 22) & 1, page = (la & 0xFFC00000) >>> 0, T = this.tlb4m;
    for (let i = set * 4; i < set * 4 + 4; i++) { const e = T[i]; if (e.valid && e.lin === page) return e; }
    return null;
  }
  itlbFind(la) {
    const set = (la >>> 12) & 7, page = (la & 0xFFFFF000) >>> 0, T = this.itlb;
    for (let i = set * 4; i < set * 4 + 4; i++) { const e = T[i]; if (e.valid && e.lin === page) return e; }
    return null;
  }
  // Put an entry into a TLB set: the way of the same page, else the ways in turn (round robin).
  tPut(T, next, set, page, frame, flags) {
    let way = -1;
    for (let w = 0; w < 4; w++) { const e = T[set * 4 + w]; if (e.valid && e.lin === page) { way = w; break; } }
    if (way < 0) { way = next[set]; next[set] = (way + 1) & 3; }
    const e = T[set * 4 + way];
    e.lin = page; e.phys = frame; e.flags = flags; e.valid = true;
    return e;
  }
  // Data translation. With CR4.PSE = 1 the core also looks in the 4 MB TLB.
  xlate(la, write, user) {
    let e = this.tlbFind(la), big = false;
    if (!e && (this.cr[4] & C4_PSE)) { e = this.tlb4mFind(la); big = e !== null; }
    if (e) {
      const fl = e.flags;
      if (user ? !(fl & 4) || (write && !(fl & 2)) : write && !(fl & 2) && (this.cr[0] & C0_WP)) return this.walk(la, write, user, false);
      if (!write || (fl & 0x40)) {
        this.tlbStats.hits++;
        if (big) this.tlbStats.bigHits++;
        const pa = big ? (e.phys | (la & 0x3FFFFF)) >>> 0 : (e.phys | (la & 0xFFF)) >>> 0;
        if (this.trace && !this.tlbSeen) { this.tlbSeen = true; this.ev.push(big ? { k: 'tlb', lin: la, phys: pa, hit: true, big: true } : { k: 'tlb', lin: la, phys: pa, hit: true }); }
        this.xPcd = fl & 0x18;
        return pa;
      }
    }
    return this.walk(la, write, user, false);
  }
  // Code translation (the prefetcher): the code TLB.
  xlateCode(la, user) {
    const e = this.itlbFind(la);
    if (e && (!user || (e.flags & 4))) { this.tlbStats.codeHits++; this.xPcd = e.flags & 0x18; return (e.phys | (la & 0xFFF)) >>> 0; }
    return this.walk(la, false, user, true);
  }
  // Page walk. The PDE (the PWT / PCD bits of CR3), then the PTE (the bits of the PDE). With
  // CR4.PSE = 1, a PDE with PS = 1 (bit 7) maps a 4 MB page: bits 22-31 are the frame, bits 12-21
  // must be 0 (else #PF with the RSVD bit 3 in the error code), A and D are in the PDE.
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
      const frame = (pde & 0xFFC00000) >>> 0, fl = us | rw | 0x21 | (npde & 0x40) | (pde & 0x18) | 0x80;
      if (code) this.tPut(this.itlb, this.itlbNext, (la >>> 12) & 7, (la & 0xFFFFF000) >>> 0, (frame | (la & 0x3FF000)) >>> 0, fl);
      else this.tPut(this.tlb4m, this.tlb4mNext, (la >>> 22) & 1, (la & 0xFFC00000) >>> 0, frame, fl);
      this.xPcd = pde & 0x18;
      const pa = (frame | (la & 0x3FFFFF)) >>> 0;
      if (ev) { ev.phys = pa; this.ev.push(ev); }
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
    const frame = (pte & 0xFFFFF000) >>> 0, fl = us | rw | 0x21 | (npte & 0x40) | (pte & 0x18);
    if (code) this.tPut(this.itlb, this.itlbNext, (la >>> 12) & 7, (la & 0xFFFFF000) >>> 0, frame, fl);
    else this.tlbPut((la & 0xFFFFF000) >>> 0, frame, fl);
    this.xPcd = pte & 0x18;
    const pa = (frame | (la & 0xFFF)) >>> 0;
    if (ev) { ev.phys = pa; this.ev.push(ev); }
    return pa;
  }
  // Translation for the views: no bus cycles, no A / D bits, no faults (-1 = not present).
  peekPhys(la) {
    la >>>= 0;
    if (!this.paging) return la;
    let e = this.tlbFind(la) || this.itlbFind(la);
    if (e) return (e.phys | (la & 0xFFF)) >>> 0;
    if (this.cr[4] & C4_PSE) { e = this.tlb4mFind(la); if (e) return (e.phys | (la & 0x3FFFFF)) >>> 0; }
    const b = this.bus, p8 = b.peek8 ? a => b.peek8(a) : a => b.read8(a);
    const rd = a => (p8(a) | (p8(a + 1) << 8) | (p8(a + 2) << 16) | (p8(a + 3) << 24)) >>> 0;
    const pde = rd(((this.cr[3] & 0xFFFFF000) + (la >>> 22) * 4) >>> 0);
    if (!(pde & 1)) return -1;
    if ((pde & 0x80) && (this.cr[4] & C4_PSE)) return ((pde & 0xFFC00000) | (la & 0x3FFFFF)) >>> 0;
    const pte = rd(((pde & 0xFFFFF000) + ((la >>> 12) & 0x3FF) * 4) >>> 0);
    if (!(pte & 1)) return -1;
    return ((pte & 0xFFFFF000) | (la & 0xFFF)) >>> 0;
  }
  // 0F 01 /7: INVLPG m (CPL 0). The entries of the page go from the data TLB, the 4 MB TLB and the
  // code TLB (with a 4 MB entry, also the code entries of that 4 MB page).
  grp0F01() {
    if (this.reg !== 7) { super.grp0F01(); return; }
    this.memOnly();
    this.priv0();
    const la = this.linear(this.eaSeg, this.eaOff), page = (la & 0xFFFFF000) >>> 0;
    let n = 0;
    const e = this.tlbFind(la), b = this.tlb4mFind(la);
    if (e) { e.valid = false; n++; }
    if (b) { b.valid = false; n++; }
    for (const c of this.itlb) {
      if (c.valid && (c.lin === page || (b && (c.flags & 0x80) && ((c.lin ^ la) & 0xFFC00000) === 0))) { c.valid = false; n++; }
    }
    if (this.trace) this.sysEv('INVLPG', `TLB entries of page ${page.toString(16).toUpperCase().padStart(8, '0')}: ${n ? n + ' removed' : 'not in the TLB'}`);
  }

  // ---------- prefetch: 64-byte queue, 32-byte lines from the code cache ----------
  // stall: the EU waits for the bytes. room: the free bus clocks (not for a stall). Returns the bus
  // clocks that it used, -1 when it cannot fetch (CS limit, a page not in the code TLB), -2 when
  // the bus cycles do not fit in room.
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
    if (k > 16) k = 16;                               // at most 16 bytes in one call (less to copy)
    if (d.hi - qip + 1 < k) k = d.hi - qip + 1;
    const T = this.itag, i0 = ((pa >>> 5) & 127) << 1, tag = pa >>> 12;
    let i = T[i0] === tag ? i0 : T[i0 + 1] === tag ? i0 + 1 : -1, used = 0, fill = false;
    const hit = i >= 0;
    if (hit) { st.hits++; IC.lru[i0 >> 1] = (i & 1) ^ 1; }
    else if (!(this.cr[0] & C0_CD) && !(attr & 0x10) && !(this.tr12 & TR12_CI) && this.cacheable(pa)) {
      used = this.fillTime();
      if (!stall && used > room) return -2;
      st.misses++;
      i = this.iFill(pa, stall); fill = true;
    }
    const Q = this.qb;
    if (i >= 0) {
      const D = IC.data, b = (i << 5) + (pa & 31);
      let t = this.qt;
      for (let j = 0; j < k; j++) Q[t++] = D[b + j];
      this.qt = t;
      this.qip = (qip + k) >>> 0;
    } else {
      // Not cacheable: one aligned group of 8 bytes (up to the CS limit).
      if (!stall && this.busLen > room) return -2;
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
      this.codeEv(pa, lo >>> 0, w, this.busLen, stall, w > 4 ? { hi: hi >>> 0 } : null);
      used = this.busLen;
    }
    if (tr) {
      for (let j = n0; j < list.length; j++) list[j].q = this.q;
      if (!hit && !this.codeSeen) this.cacheNote586(pa, i, false, fill, false, true, !fill);
    }
    return used;
  }
  // The same as the 486 fetch, but it keeps the bytes of the instruction in this.ib (the pairing
  // rules look at them).
  fetch() {
    const ip = this.ip;
    if (ip > this.cache[CS].hi || ++this.ilen > 15) throw this.fault(13, 0);
    if (this.qh >= this.qt) { this.qh = 0; this.qt = 0; this.prefetch(true); }
    const b = this.qb[this.qh++];
    this.ip = (ip + 1) >>> 0;
    this.ib[this.ilen - 1] = b;
    if (this.trace) this.ibytes.push(b);
    return b;
  }

  // ---------- the pairing rules ----------
  // The ModR/M byte at B[q] (the default address size of the code, n bytes in B from q on):
  // bits 0-7 = the address registers, bits 8-10 = the bytes after the ModR/M byte (SIB and
  // displacement), bit 11 = a displacement. -1: the bytes are not all in B.
  eaInfo(B, q, n, big) {
    if (n < 1) return -1;
    const m = B[q], mod = m >> 6, rm = m & 7;
    if (mod === 3) return 0;
    if (!big) {
      const direct = mod === 0 && rm === 6, dl = mod === 1 ? 1 : mod === 2 || direct ? 2 : 0;
      return (direct ? 0 : P586_EA16[rm]) | (dl << 8) | (dl ? 0x800 : 0);
    }
    let regs = 0, ex = 0, dl = mod === 1 ? 1 : mod === 2 ? 4 : 0;
    if (rm === 4) {
      if (n < 2) return -1;
      const sib = B[q + 1], base = sib & 7, idx = (sib >> 3) & 7;
      ex = 1;
      if (base === 5 && mod === 0) dl = 4; else regs |= 1 << base;
      if (idx !== 4) regs |= 1 << idx;
    } else if (rm === 5 && mod === 0) dl = 4;
    else regs = 1 << rm;
    return regs | ((ex + dl) << 8) | (dl ? 0x800 : 0);
  }
  // The pair data of the instruction at B[p] (n bytes in B from p on), or 0 when it cannot pair
  // (this.pWhy: 1 = the bytes are not all there, 2 = a prefix, 4 = not a simple instruction,
  // 6 = a displacement and an immediate). Bits 0-7: the registers that it reads, 8-15: the
  // registers that it writes (AL and AH are parts of EAX), 16-17: the pipe (1 = U or V, 2 = U
  // only, 3 = V only), PI_PUSH / PI_POP: a stack instruction (ESP is implicit), PI_FP /
  // PI_FXCH: the FPU pair, bits 24-27: the length.
  pairInfo(B, p, n) {
    // The result depends only on the first 3 bytes and the code size: a memo of 1024 entries.
    if (n < 3) return this.pairScan(B, p, n);
    const b0 = B[p], pk = P586_PK[b0];
    if (pk) { this.pWhy = pk; return 0; }
    const key = (b0 | (B[p + 1] << 8) | (B[p + 2] << 16) | (this.cache[CS].big ? 0x1000000 : 0)) + 1;
    const h = Math.imul(key, 0x9E3779B1) >>> 22, M = this.pMemo;
    let v;
    if (M[h] === key) { v = this.pMemoV[h]; this.pWhy = this.pMemoW[h]; }
    else { v = this.pairScan(B, p, 15); M[h] = key; this.pMemoV[h] = v; this.pMemoW[h] = this.pWhy; }
    if (v && (v >>> 24) > n) { this.pWhy = 1; return 0; }
    return v;
  }
  // The work of pairInfo (n: the bytes in B from p on).
  pairScan(B, p, n) {
    if (n < 1) { this.pWhy = 1; return 0; }
    const b0 = B[p];
    const pk = P586_PK[b0];
    if (pk) { this.pWhy = pk; return 0; }
    const big = this.cache[CS].big, S = big ? 4 : 2;
    let len = 1, rd = 0, wr = 0, pipe = PI_UV, x = 0, imm = 0, ea = 0;
    if (b0 < 0x40 && (b0 & 7) < 6) {                  // ALU: ADD OR ADC SBB AND SUB XOR CMP
      const f = b0 & 7, op = b0 >> 3, byte = !(f & 1);
      if (op === 2 || op === 3) pipe = PI_PU;
      if (f >= 4) { rd = 1; wr = op === 7 ? 0 : 1; imm = byte ? 1 : S; }
      else {
        if (n < 2) { this.pWhy = 1; return 0; }
        const mm = B[p + 1], reg = (mm >> 3) & 7;
        ea = this.eaInfo(B, p + 1, n - 1, big);
        if (ea < 0) { this.pWhy = 1; return 0; }
        const g = 1 << (byte ? reg & 3 : reg), e = (mm >> 6) === 3 ? 1 << (byte ? mm & 3 : mm & 7) : 0;
        rd = g | e | (ea & 0xFF);
        if (op !== 7) wr = f < 2 ? e : g;
        len = 2 + ((ea >> 8) & 7);
      }
    } else if (b0 >= 0x40 && b0 < 0x50) { rd = 1 << (b0 & 7); wr = rd; }                 // INC, DEC reg
    else if (b0 >= 0x50 && b0 < 0x58) { rd = (1 << (b0 & 7)) | 16; wr = 16; x = PI_PUSH; }  // PUSH reg
    else if (b0 >= 0x58 && b0 < 0x60) { rd = 16; wr = (1 << (b0 & 7)) | 16; x = PI_POP; }  // POP reg
    else if (b0 === 0x68 || b0 === 0x6A) { rd = 16; wr = 16; x = PI_PUSH; imm = b0 === 0x68 ? S : 1; }
    else if (b0 >= 0x70 && b0 < 0x80) { pipe = PI_PV; imm = 1; }                       // Jcc short
    else if (b0 >= 0xB0 && b0 < 0xC0) { wr = 1 << (b0 < 0xB8 ? b0 & 3 : b0 & 7); imm = b0 < 0xB8 ? 1 : S; }
    else {
      switch (b0) {
        case 0x80: case 0x81: case 0x82: case 0x83: case 0x84: case 0x85: case 0x88: case 0x89: case 0x8A: case 0x8B:
        case 0x8D: case 0xC0: case 0xC1: case 0xC6: case 0xC7: case 0xD0: case 0xD1: case 0xFE: case 0xFF: {
          if (n < 2) { this.pWhy = 1; return 0; }
          const mm = B[p + 1], reg = (mm >> 3) & 7, mod = mm >> 6, byte = !(b0 & 1);
          ea = this.eaInfo(B, p + 1, n - 1, big);
          if (ea < 0) { this.pWhy = 1; return 0; }
          const g = 1 << (byte ? reg & 3 : reg), e = mod === 3 ? 1 << (byte ? mm & 3 : mm & 7) : 0, a = ea & 0xFF;
          len = 2 + ((ea >> 8) & 7);
          switch (b0) {
            case 0x80: case 0x81: case 0x82: case 0x83:
              if (reg === 2 || reg === 3) pipe = PI_PU;
              rd = e | a; wr = reg === 7 ? 0 : e; imm = b0 === 0x81 ? S : 1; break;
            case 0x84: case 0x85: rd = g | e | a; break;
            case 0x88: case 0x89: rd = g | a; wr = e; break;
            case 0x8A: case 0x8B: rd = e | a; wr = g; break;
            case 0x8D: if (mod === 3) { this.pWhy = 4; return 0; } rd = a; wr = g; break;
            case 0xC0: case 0xC1: if (reg < 4) { this.pWhy = 4; return 0; } pipe = PI_PU; rd = e | a; wr = e; imm = 1; break;
            case 0xD0: case 0xD1: pipe = PI_PU; rd = e | a; wr = e; break;
            case 0xC6: case 0xC7: if (reg) { this.pWhy = 4; return 0; } rd = a; wr = e; imm = byte ? 1 : S; break;
            default: if (reg > 1) { this.pWhy = 4; return 0; } rd = e | a; wr = e;   // INC, DEC r/m
          }
          break;
        }
        case 0x90: break;
        case 0xA0: case 0xA1: wr = 1; len = 1 + S; break;   // MOV eAX, moffs (the address size = S)
        case 0xA2: case 0xA3: rd = 1; len = 1 + S; break;
        case 0xA8: rd = 1; imm = 1; break;
        case 0xA9: rd = 1; imm = S; break;
        case 0xE8: pipe = PI_PV; rd = 16; wr = 16; x = PI_PUSH; imm = S; break;
        case 0xE9: pipe = PI_PV; imm = S; break;
        case 0xEB: pipe = PI_PV; imm = 1; break;
        case 0x0F:
          if (n < 2) { this.pWhy = 1; return 0; }
          if ((B[p + 1] & 0xF0) !== 0x80) { this.pWhy = 4; return 0; }
          pipe = PI_PV; len = 2; imm = S; break;
        default:
          if (b0 >= 0xD8 && b0 <= 0xDF) return this.fpPairInfo(B, p, n, big);
          this.pWhy = 4; return 0;
      }
    }
    if (imm && (ea & 0x800)) { this.pWhy = 6; return 0; }
    len += imm;
    if (len > n) { this.pWhy = 1; return 0; }
    return rd | (wr << 8) | (pipe << 16) | x | (len << 24);
  }
  // The FPU pair: FLD, FADD, FSUB, FMUL, FDIV, FCOM, FUCOM, FTST, FABS, FCHS in U with FXCH in V.
  fpPairInfo(B, p, n, big) {
    if (n < 2) { this.pWhy = 1; return 0; }
    const b0 = B[p], mm = B[p + 1], mod = mm >> 6, reg = (mm >> 3) & 7;
    if (mod === 3) {
      let fx = 0;
      if (b0 === 0xD8 || b0 === 0xDC) fx = PI_FP;
      else if (b0 === 0xDE) fx = (reg !== 2 && reg !== 3) || mm === 0xD9 ? PI_FP : 0;
      else if (b0 === 0xD9) fx = reg === 0 || mm === 0xE0 || mm === 0xE1 || mm === 0xE4 ? PI_FP : reg === 1 ? PI_FXCH : 0;
      else if (b0 === 0xDD) fx = reg === 4 || reg === 5 ? PI_FP : 0;
      else if (b0 === 0xDA) fx = mm === 0xE9 ? PI_FP : 0;
      if (!fx) { this.pWhy = 4; return 0; }
      return fx | (2 << 24);
    }
    if (!(b0 === 0xD8 || b0 === 0xDC || ((b0 === 0xD9 || b0 === 0xDD) && reg === 0))) { this.pWhy = 4; return 0; }
    const ea = this.eaInfo(B, p + 1, n - 1, big);
    if (ea < 0) { this.pWhy = 1; return 0; }
    const len = 2 + ((ea >> 8) & 7);
    if (len > n) { this.pWhy = 1; return 0; }
    return PI_FP | (len << 24);
  }
  // At the end of an instruction in the U pipe: can the next instruction go into the V pipe?
  // Returns 0 (yes) or the reason (an index of P586_WHY; this.pReg = the register of 10 / 11).
  pairCheck(text, halted) {
    if (text || halted) return 17;
    if (!this.execOk) return 16;
    if (!this.ilen) return 4;                          // a REP iteration
    if (this.tr12 & TR12_SE) return 13;
    if (this.f & F_TF) return 14;
    // The previous step looked at this instruction as a V candidate: use that result again (not
    // when its bytes were not all in the queue then).
    let u;
    if (this.vIP === this.lastIP && this.vBase === this.lastBase) { u = this.vInfo; this.pWhy = this.vWhy; }
    else u = this.pairInfo(this.ib, 0, this.ilen);
    if (!u) return this.pWhy === 1 ? 4 : this.pWhy;
    if (((u >>> 16) & 3) === PI_PV) return 8;
    if (this.didFlush) return 15;
    const v = this.pairInfo(this.qb, this.qh, this.qt - this.qh);
    this.vIP = v || this.pWhy !== 1 ? this.ip : -1; this.vInfo = v; this.vWhy = this.pWhy; this.vBase = this.cache[CS].base;
    if (!v) return this.pWhy === 1 ? 1 : this.pWhy + 1;
    if ((u | v) & (PI_FP | PI_FXCH)) return (u & PI_FP) && (v & PI_FXCH) ? 0 : 12;
    if (((v >>> 16) & 3) === PI_PU) return 9;
    let ur = u & 0xFF, uw = (u >>> 8) & 0xFF, vr = v & 0xFF, vw = (v >>> 8) & 0xFF;
    // PUSH / PUSH (or CALL) and POP / POP: the P5 adjusts ESP for both (no dependency).
    if (((u & PI_PUSH) && (v & PI_PUSH)) || ((u & PI_POP) && (v & PI_POP))) { ur &= ~16; uw &= ~16; vr &= ~16; vw &= ~16; }
    let dep = uw & vr;
    if (dep) { this.pReg = 31 - Math.clz32(dep & -dep); return 10; }
    dep = uw & vw;
    if (dep) { this.pReg = 31 - Math.clz32(dep & -dep); return 11; }
    return 0;
  }

  // ---------- the branch target buffer ----------
  // 64 sets of 4 ways: set = bits 2-7 of the linear address of the branch, tag = the whole address.
  // A branch that is taken and not in the BTB gets an entry (counter 3 = strongly taken). The
  // prediction: taken when the entry is there and its counter is 2 or 3 (and the target must be
  // the same); not taken when there is no entry. A wrong prediction costs 3 clocks (U) or 4 (V).
  branch() {
    const B = this.btb, st = B.stats, la = (this.lastBase + this.lastIP) >>> 0, tag = la | 0, set = (la >>> 2) & 63;
    const taken = this.didFlush, tgt = taken ? (this.cache[CS].base + this.ip) >>> 0 : 0, nbp = (this.tr12 & TR12_NBP) !== 0;
    let i = -1;
    if (!nbp) for (let k = set * 4; k < set * 4 + 4; k++) if (B.tag[k] === tag) { i = k; break; }
    const hit = i >= 0, predT = hit && B.counter[i] >= 2;
    const right = predT === taken && (!taken || B.target[i] === tgt);
    st.lookups++;
    if (hit) st.hits++;
    if (hit || taken) st.taken++;
    if (right) st.right++; else st.wrong++;
    if (!nbp) {
      if (hit) {
        const c = B.counter[i];
        B.counter[i] = taken ? (c < 3 ? c + 1 : 3) : (c > 0 ? c - 1 : 0);
        if (taken) B.target[i] = tgt;
      } else if (taken) {
        const w = B.next[set];
        B.next[set] = (w + 1) & 3;
        i = set * 4 + w;
        B.tag[i] = tag; B.target[i] = tgt; B.counter[i] = 3;
        st.allocs++;
      }
    }
    const pen = right ? 0 : this.isV ? 4 : 3;
    this.clk += pen;
    if (this.trace) {
      this.ev.push({ k: 'btb', lin: la, target: tgt, taken, hit, predicted: predT, right, set, way: i < 0 ? -1 : i & 3,
        counter: i < 0 ? -1 : B.counter[i], pipe: this.isV ? 'V' : 'U', penalty: pen, alloc: !hit && taken && !nbp });
    }
  }

  // ---------- step, clocks and the timeline ----------
  step() {
    this.isV = this.pairNext && this.ip === this.pairIP;
    this.pairNext = false;
    this.execOk = false;
    if (this.trace) this.snapCr4 = this.cr[4];
    return super.step();
  }
  exec(op) {
    const c0 = this.clk, npfx = this.ilen - 1;       // the prefix bytes before the opcode
    super.exec(op);                                   // the 486 core runs the instruction (this method replaces its clocks)
    const t = this.clocks586(op);
    if (t >= 0) this.clk = c0 + t;
    this.clk += npfx;                                 // the P5 decodes each prefix in 1 clock
    if ((op >= 0x70 && op < 0x80) || op === 0xE8 || op === 0xE9 || op === 0xEB || (op === 0x0F && this.op2 >= 0x80 && this.op2 < 0x90)) this.branch();
    this.execOk = true;
  }
  stringOp(op, first) {
    const c0 = this.clk, rep = this.rep, R = this.r;
    const zero = rep && first && (this.a32 ? R[1] : R[1] & 0xFFFF) === 0;
    super.stringOp(op, first);
    const t = P586_STR[op & 0xFE];
    if (t) this.clk = c0 + (!rep ? t[0] : zero ? 6 : (first ? t[1] : 0) + t[2]);
    this.execOk = true;
  }
  // P5 clocks with cache hits (-1: keep the value of the 80386 core, for example the
  // protected-mode far transfers, the gates and the task switches). A branch gets its BTB penalty
  // in branch(), and exec() adds 1 clock for each prefix byte (66h, 67h, a segment, LOCK, REP).
  clocks586(op) {
    const m = this.mod >= 0 && this.mod !== 3, S = this.osz, taken = this.didFlush;
    const pm = (this.cr[0] & 1) !== 0 && !(this.f & P386_VM);
    if (op < 0x40) {
      if ((op & 7) < 6) { const f = op & 7; return f >= 4 || !m ? 1 : f < 2 ? (op >> 3 === 7 ? 2 : 3) : 2; }
      if (op === 0x0F) return this.clocks0F586();
      if ((op & 7) === 6) return 1;                  // PUSH ES / CS / SS / DS
      if (op === 0x27 || op === 0x2F || op === 0x37 || op === 0x3F) return 3;
      return pm ? 8 : 3;                             // POP ES / SS / DS
    }
    if (op < 0x60) return 1;                         // INC, DEC, PUSH, POP reg
    if (op >= 0x70 && op < 0x80) return 1;
    if (op >= 0xB0 && op < 0xC0) return 1;
    if (op >= 0x91 && op <= 0x97) return 2;
    if (op >= 0xD8 && op <= 0xDF) return -1;         // esc() sets the FPU clocks
    switch (op) {
      case 0x60: case 0x61: return 5;
      case 0x62: return 8;
      case 0x63: return 7;
      case 0x68: case 0x6A: return 1;
      case 0x69: case 0x6B: return 10;
      case 0x80: case 0x81: case 0x82: case 0x83: return !m ? 1 : this.reg === 7 ? 2 : 3;
      case 0x84: case 0x85: return m ? 2 : 1;
      case 0x86: case 0x87: return 3;
      case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8C: case 0x8D: return 1;
      case 0x8E: return pm ? 8 : 2;
      case 0x8F: return 3;
      case 0x90: return 1;
      case 0x98: return 3;
      case 0x99: return 2;
      case 0x9A: return pm ? -1 : 4;
      case 0x9B: return 1;
      case 0x9C: return pm ? 3 : 4;
      case 0x9D: return pm ? 4 : 6;
      case 0x9E: case 0x9F: return 2;
      case 0xA0: case 0xA1: case 0xA2: case 0xA3: case 0xA8: case 0xA9: return 1;
      case 0xC0: case 0xC1: case 0xD0: case 0xD1: case 0xD2: case 0xD3: {
        const one = op === 0xD0 || op === 0xD1, cl = op >= 0xD2;
        if (this.reg === 2 || this.reg === 3) return one ? (m ? 3 : 1) : cl ? (m ? 9 : 7) : (m ? 10 : 8);
        return cl ? 4 : m ? 3 : 1;
      }
      case 0xC2: return 3;
      case 0xC3: return 2;
      case 0xC4: case 0xC5: return pm ? 13 : 4;
      case 0xC6: case 0xC7: return 1;
      case 0xC9: return 3;
      case 0xCA: case 0xCB: return pm ? -1 : 4;
      case 0xCC: return pm ? -1 : 13;
      case 0xCD: return pm ? -1 : 16;
      case 0xCE: return !taken ? 4 : pm ? -1 : 13;
      case 0xCF: return pm ? -1 : 8;
      case 0xD4: return 18;
      case 0xD5: return 10;
      case 0xD6: return 2;
      case 0xD7: return 4;
      case 0xE0: case 0xE1: return taken ? 7 : 8;
      case 0xE2: case 0xE3: return taken ? 5 : 6;
      case 0xE4: case 0xE5: case 0xEC: case 0xED: return this.ioClk(7, 4, 21, 19);
      case 0xE6: case 0xE7: case 0xEE: case 0xEF: return this.ioClk(12, 9, 26, 24);
      case 0xE8: case 0xE9: case 0xEB: return 1;
      case 0xEA: return pm ? -1 : 3;
      case 0xF4: return 4;
      case 0xF5: case 0xF8: case 0xF9: case 0xFC: case 0xFD: return 2;
      case 0xFA: case 0xFB: return 7;
      case 0xF6: case 0xF7: {
        const s = op & 1 ? S : 1;
        switch (this.reg) {
          case 0: case 1: return m ? 2 : 1;
          case 2: case 3: return m ? 3 : 1;
          case 4: case 5: return s === 4 ? 10 : 11;
          case 6: return s === 1 ? 17 : s === 2 ? 25 : 41;
          default: return s === 1 ? 22 : s === 2 ? 30 : 46;
        }
      }
      case 0xFE: case 0xFF:
        switch (this.reg) {
          case 0: case 1: return m ? 3 : 1;
          case 2: case 4: return 2;
          case 3: return pm ? -1 : 5;
          case 5: return pm ? -1 : 4;
          default: return 2;
        }
      default: return -1;
    }
  }
  clocks0F586() {
    const op2 = this.op2, m = this.mod >= 0 && this.mod !== 3, pm = (this.cr[0] & 1) !== 0 && !(this.f & P386_VM);
    if (op2 >= 0x80 && op2 <= 0x8F) return 1;
    if (op2 >= 0x90 && op2 <= 0x9F) return m ? 2 : 1;
    if (op2 >= 0xC8 && op2 <= 0xCF) return 1;
    switch (op2) {
      case 0x00: return [2, 2, 9, 10, 7, 7][this.reg];
      case 0x01: return [4, 4, 6, 6, 4, -1, 8, 25][this.reg];
      case 0x02: case 0x03: return 8;
      case 0x06: return 10;
      case 0x08: case 0x09: return 15;
      case 0x20: case 0x21: case 0x22: case 0x23: return this.spClk;   // set by movSpecial()
      case 0x30: return 30;
      case 0x31: case 0x32: return 20;
      case 0xA0: case 0xA8: return 1;
      case 0xA1: case 0xA9: return pm ? 8 : 3;
      case 0xA2: return 14;
      case 0xA3: return m ? 9 : 4;
      case 0xAB: case 0xB3: case 0xBB: return m ? 13 : 7;
      case 0xBA: return this.reg === 4 ? 4 : m ? 8 : 7;
      case 0xA4: case 0xAC: return 4;
      case 0xA5: case 0xAD: return m ? 5 : 4;
      case 0xAF: return 10;
      case 0xB0: case 0xB1: return m ? 6 : 5;
      case 0xB2: case 0xB4: case 0xB5: return pm ? 13 : 4;
      case 0xB6: case 0xB7: case 0xBE: case 0xBF: return 3;
      case 0xBC: case 0xBD: {
        if (this.f & F_ZF) return 6;
        const i = this.r[this.reg] & 31;
        return op2 === 0xBC ? 6 + i : 7 + (31 - i);
      }
      case 0xC0: case 0xC1: return m ? 4 : 3;
      case 0xC7: return 10;
      default: return -1;
    }
  }

  // The timeline (as the 486 core): the code stalls, the EU bus cycles over the instruction (the
  // beats of a burst stay together), the prefetcher in the free bus time. The instruction takes
  // its P5 clocks plus the bus time of its reads (fills, uncached reads, I/O) and of its code
  // stalls, and at least the bus time of all its cycles.
  //
  // The clock rule of a pair: the pair takes P = the clocks of the longer instruction. The step of
  // the U instruction returns its own clocks minus 1 (at least 1); the step of the V instruction
  // returns P minus the U step (at least 1). So the two steps give exactly P, but a pair of two
  // 1-clock instructions gives 2 (a step always has 1 clock or more; pipeStats.floor counts these
  // clocks). The prefetcher runs before the pairing check, the same with and without a trace.
  finish(text, halted) {
    if (!this.batch) this.syncOut();
    const S = this.stallT, BT = this.busT;
    let T = S + this.clk + this.rdT;
    if (T < S + BT) T = S + BT;
    if (T < 1) T = 1;
    const fpu = this.bus.fpu;
    if (fpu) fpu.busyCycles = 0;
    if (!halted && !this.didFlush) {
      let room = T - S - BT;
      while (this.qt - this.qh < 16) { const u = this.prefetch(false, room); if (u < 0) break; room -= u; }
    }
    const full = T, isV = this.isV, P = this.pipeStats;
    let why = 0;
    if (isV) {
      T = (this.uClk > T ? this.uClk : T) - this.uRet;
      if (T < 1) { P.floor += 1 - T; T = 1; }
      P.v++;
    } else {
      why = this.pairCheck(text, halted);
      if (why !== 17) P.u++;
      if (!why) {
        this.pairNext = true; this.pairIP = this.ip; this.inhibit = true;
        this.uClk = T; T = T > 1 ? T - 1 : 1; this.uRet = T;
      } else P.why[why]++;
    }
    this.lastWhy = why;
    this.cycles += T;
    const tr = this.trace;
    if (!tr) return T;

    // The layout: the EU groups spread over the instruction; the prefetch cycles go into the gaps.
    const groups = [];
    for (const e of this.euEv) { if (e.beat > 0 && groups.length) groups[groups.length - 1].push(e); else groups.push([e]); }
    const pf = this.pfEv, G = groups.length, gap = Math.max(0, Math.floor((full - S - BT) / (G + 1)));
    let pos = S, pi = 0;
    const placed = [];
    for (let g = 0; g <= G; g++) {
      let room = g === G ? full - pos : gap;
      while (pi < pf.length) {
        let j = pi, len = 0;
        do { len += pf[j].len; j++; } while (j < pf.length && pf[j].beat > 0);
        if (len > room && g < G) break;
        for (let k = pi; k < j; k++) { pf[k].t = pos; pos += pf[k].len; placed.push(pf[k]); }
        room -= len; pi = j;
      }
      if (room > 0) pos += room;
      if (g < G) for (const e of groups[g]) { e.t = pos; pos += e.len; placed.push(e); }
    }
    for (const e of placed) if (e.t > T - 1) e.t = T - 1;

    const out = [], bus = this.bus;
    const cs = this.decCS, ip = this.decIP, base = this.lastBase, bits = this.decBits;
    const peek = bus.peek8 ? a => bus.peek8(a) : a => bus.read8(a);
    const reader = (b, o) => i => { const pa = this.peekPhys((b + o + i) >>> 0); return pa < 0 ? 0 : peek(pa); };
    let dtext = text;
    if (!dtext) {
      if (typeof Disasm86 !== 'undefined') {
        try { dtext = Disasm86.decode(reader(base, ip), ip, { cpu: '586', bits }).text; } catch (e) { dtext = 'op ' + (this.op | 0).toString(16); }
      } else dtext = 'op ' + (this.op | 0).toString(16);
      if (this.repStateText) dtext += this.repStateText;
    }
    out.push({ k: 'decode', t: 0, cs, ip, len: this.ibytes.length, text: dtext, bytes: this.ibytes.slice(), bits });
    // The pipeline: prefetch, decode 1, decode 2 hold the next instructions, execute holds this
    // one, write-back the one before it. pipe: the pipe of this instruction; paired: it is one of
    // a pair; partner: the other instruction of the pair; reason: why the pair did not form.
    const next = ['', '', ''];
    if (typeof Disasm86 !== 'undefined' && !halted) {
      const nb = this.cache[CS].base, nbits = this.cache[CS].big ? 32 : 16;
      let o = this.ip;
      for (let k = 0; k < 3; k++) {
        try {
          const dd = Disasm86.decode(reader(nb, o), o, { cpu: '586', bits: nbits });
          next[k] = dd.text; o = nbits === 32 ? (o + dd.len) >>> 0 : (o + dd.len) & 0xFFFF;
        } catch (e) { break; }
      }
    }
    const paired = isV || !why;
    out.push({ k: 'pipe', t: 0, stage: [next[2], next[1], next[0], dtext, this.prevText || ''], pipe: isV ? 'V' : 'U', paired,
      partner: isV ? this.prevText || '' : paired ? next[0] : '', reason: why ? P586_WHY[why].replace('$', P386_REG32[this.pReg]) : '', clocks: full });
    this.prevText = dtext;
    let sp = 0;
    for (const e of this.stallEv) { e.t = Math.min(sp, T - 1); sp += e.len; out.push(e); }
    if (this.ibytes.length) out.push({ k: 'queue', t: Math.min(S, T - 1), op: 'pop', n: this.ibytes.length, q: this.q });
    const mid = Math.min(S + Math.max(0, Math.floor((T - S) / 2)), T - 1);
    for (const e of this.ev) {
      if (e.k === 'ea') e.t = Math.min(S + 1, T - 1);
      else if (e.k === 'queue') e.t = T - 1;
      else e.t = e.t !== undefined ? Math.min(e.t, T - 1) : mid;
      out.push(e);
    }
    for (const e of placed) out.push(e);
    for (const e of this.cacheEv) { e.t = e.ref ? e.ref.t : Math.min(S, T - 1); delete e.ref; out.push(e); }
    const sn = this.snap;
    for (let i = 0; i < 8; i++) if (sn.r[i] !== this.r[i]) out.push({ k: 'reg', t: T - 1, r: P386_REG32[i], v: this.r[i] });
    for (let i = 0; i < 6; i++) if (sn.s[i] !== this.sregs[i]) out.push({ k: 'reg', t: T - 1, r: P386_SREG[i], v: this.sregs[i] });
    if (sn.f !== this.eflags) out.push({ k: 'flags', t: T - 1, v: this.eflags, old: sn.f });
    if (sn.cr0 !== this.cr[0]) out.push({ k: 'reg', t: T - 1, r: 'CR0', v: this.cr[0] });
    if (sn.cr2 !== this.cr[2]) out.push({ k: 'reg', t: T - 1, r: 'CR2', v: this.cr[2] });
    if (sn.cr3 !== this.cr[3]) out.push({ k: 'reg', t: T - 1, r: 'CR3', v: this.cr[3] });
    if (this.snapCr4 !== this.cr[4]) out.push({ k: 'reg', t: T - 1, r: 'CR4', v: this.cr[4] });
    out.push({ k: 'reg', t: T - 1, r: 'EIP', v: this.ip });
    out.push({ k: 'iq', t: T - 1, n: Math.min(3, (this.qt - this.qh) >> 1) });
    out.push({ k: 'end', t: T });
    out.sort((a, b) => a.t - b.t);
    this.trace = out;
    this.repStateText = null;
    return T;
  }

  // ---------- the P5 instructions ----------
  exec0Fop(op2) {
    this.op2 = op2;
    if (op2 === 0xC7) { this.cmpxchg8b(); return; }
    if (this.lock) { super.exec0Fop(op2); return; }
    switch (op2) {
      case 0x20: case 0x21: case 0x22: case 0x23: this.movSpecial(op2); return;
      case 0x24: case 0x26: throw this.fault(6);      // the P5 has no MOV TRn (the test registers are MSRs)
      case 0x30: this.wrmsr(); return;
      case 0x31: this.rdtsc(); return;
      case 0x32: this.rdmsr(); return;
      case 0x08: case 0x09: {                         // INVD / WBINVD (CPL 0): both caches become empty
        this.priv0();
        const n = op2 === 9 ? this.writeBackAll() : 0;
        this.cacheFlush();
        if (this.trace) this.sysEv(op2 === 8 ? 'INVD' : 'WBINVD', `the code cache and the data cache are empty${op2 === 9 ? `; ${n} modified line(s) written back` : ''}`);
        return;
      }
      default: super.exec0Fop(op2);
    }
  }
  // MOV to / from CR0-CR4 and DR0-DR7 (the core ignores the mod bits). CPL 0 only (#GP(0)). CR1, CR5-CR7:
  // #UD. With CR4.DE = 1, DR4 and DR5 give #UD (else they are DR6 and DR7).
  movSpecial(op2) {
    const m = this.fetch(), n = (m >> 3) & 7, rm = m & 7, R = this.r;
    if ((this.cr[0] & 1) && ((this.f & P386_VM) || this.cpl !== 0)) throw this.fault(13, 0);
    if (op2 === 0x20) { if (n === 1 || n > 4) throw this.fault(6); R[rm] = this.cr[n]; this.spClk = 4; return; }
    if (op2 === 0x22) {
      const v = R[rm];
      if (n === 0) { this.setCR0(v); this.spClk = 22; }
      else if (n === 2) { this.cr[2] = v; this.spClk = 12; }
      else if (n === 3) {
        this.cr[3] = v; this.flushTLB(); this.spClk = 21;
        if (this.trace) this.sysEv('CR3', `CR3 = ${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')} (page directory; TLB flushed)`);
      } else if (n === 4) { this.setCR4(v); this.spClk = 14; }
      else throw this.fault(6);
      return;
    }
    if ((n === 4 || n === 5) && (this.cr[4] & C4_DE)) throw this.fault(6);
    const k = n === 4 ? 6 : n === 5 ? 7 : n;
    if (op2 === 0x21) { R[rm] = this.dr[k]; this.spClk = 2; return; }
    const v = R[rm];
    if (k === 6) this.dr[6] = (v & 0xE00F) | 0xFFFF0FF0; else this.dr[k] = v;
    if (k === 7) this.updateDebug();
    this.spClk = 12;
  }
  // CR4: TSD, DE, PSE and MCE can change; the other bits give #GP(0). A change of PSE flushes the TLBs.
  setCR4(v) {
    v >>>= 0;
    if (v & ~P586_CR4) throw this.fault(13, 0);
    const old = this.cr[4];
    this.cr[4] = v;
    if ((old ^ v) & C4_PSE) this.flushTLB();
    if ((old ^ v) & C4_DE) this.updateDebug();
    if (this.trace) {
      const on = [[C4_TSD, 'TSD'], [C4_DE, 'DE'], [C4_PSE, 'PSE'], [C4_MCE, 'MCE']].filter(([b]) => v & b).map(([, s]) => s);
      this.sysEv('CR4', `CR4 = ${v.toString(16).toUpperCase().padStart(8, '0')}${on.length ? ' (' + on.join(' ') + ')' : ''}`);
    }
  }
  // CPUID: leaf 0 = the highest leaf (1) and "GenuineIntel"; leaf 1 = the signature (family 5,
  // model 1, stepping 7) and the feature bits (FPU, DE, PSE, TSC, MSR, MCE, CX8).
  cpuid() {
    const R = this.r, leaf = R[0];
    if (leaf === 0) { R[0] = 1; R[3] = 0x756E6547; R[2] = 0x49656E69; R[1] = 0x6C65746E; }
    else if (leaf === 1) { R[0] = CPU80586.SIGNATURE; R[3] = 0; R[1] = 0; R[2] = CPU80586.FEATURES | (this.bus.fpu ? 1 : 0); }
    else { R[0] = 0; R[1] = 0; R[2] = 0; R[3] = 0; }
    if (this.trace) this.sysEv('CPUID', `leaf ${leaf}: EAX ${(R[0] >>> 0).toString(16).toUpperCase()}h, EDX ${(R[2] >>> 0).toString(16).toUpperCase()}h`);
  }
  // The time-stamp counter: the clocks of the CPU (cpu.cycles and the clocks of this instruction up
  // to now) plus the offset that WRMSR 10h sets (64 bits).
  tscTo(R) {
    const now = this.cycles + this.clk;
    if (this.tscOff === 0n) { R[0] = now % 4294967296; R[2] = Math.floor(now / 4294967296); return; }
    const v = BigInt.asUintN(64, BigInt(Math.floor(now)) + this.tscOff);
    R[0] = Number(v & 0xFFFFFFFFn); R[2] = Number(v >> 32n);
  }
  // RDTSC: #GP(0) when CR4.TSD = 1 and CPL > 0 (protected mode and virtual-8086 mode).
  rdtsc() {
    if ((this.cr[4] & C4_TSD) && (this.cr[0] & 1) && this.cpl !== 0) throw this.fault(13, 0);
    this.tscTo(this.r);
    if (this.trace) this.sysEv('RDTSC', `TSC = ${this.hex64(this.r[2], this.r[0])}`);
  }
  hex64(hi, lo) { return (hi >>> 0).toString(16).toUpperCase().padStart(8, '0') + (lo >>> 0).toString(16).toUpperCase().padStart(8, '0') + 'h'; }
  msrPriv() { if ((this.cr[0] & 1) && this.cpl !== 0) throw this.fault(13, 0); }
  // RDMSR / WRMSR (CPL 0): ECX = the MSR. 00h P5_MC_ADDR, 01h P5_MC_TYPE (no machine check occurs:
  // both read 0), 0Eh TR12 (NBP bit 0, SE bit 1, CI bit 9), 10h TSC, 11h CESR, 12h CTR0, 13h CTR1.
  // Another number gives #GP(0).
  rdmsr() {
    this.msrPriv();
    const R = this.r, n = R[1];
    switch (n) {
      case 0x00: R[0] = this.mcAddr; R[2] = 0; break;
      case 0x01: R[0] = this.mcType; R[2] = 0; this.mcType &= ~1; break;
      case 0x0E: R[0] = this.tr12; R[2] = 0; break;
      case 0x10: this.tscTo(R); break;
      case 0x11: R[0] = this.cesr; R[2] = 0; break;
      case 0x12: case 0x13: {
        const v = this.ctrValue(n - 0x12);
        R[0] = v % 4294967296; R[2] = Math.floor(v / 4294967296) & 0xFF;
        break;
      }
      default: throw this.fault(13, 0);
    }
    if (this.trace) this.sysEv('RDMSR', `MSR ${n.toString(16).toUpperCase()}h = ${this.hex64(R[2], R[0])}`);
  }
  wrmsr() {
    this.msrPriv();
    const R = this.r, n = R[1], lo = R[0], hi = R[2];
    switch (n) {
      case 0x00: case 0x01: break;
      case 0x0E: this.tr12 = lo & (TR12_NBP | TR12_SE | 0x8 | TR12_CI); break;
      case 0x10: this.tscOff = ((BigInt(hi) << 32n) | BigInt(lo)) - BigInt(Math.floor(this.cycles + this.clk)); break;
      case 0x11:
        for (let k = 0; k < 2; k++) { this.ctrBase[k] = this.ctrValue(k); }
        this.cesr = lo & 0x03FF03FF;
        for (let k = 0; k < 2; k++) this.ctrRaw[k] = this.pmcRaw(k);
        break;
      case 0x12: case 0x13: {
        const k = n - 0x12;
        this.ctrBase[k] = (hi & 0xFF) * 4294967296 + lo;
        this.ctrRaw[k] = this.pmcRaw(k);
        break;
      }
      default: throw this.fault(13, 0);
    }
    if (this.trace) this.sysEv('WRMSR', `MSR ${n.toString(16).toUpperCase()}h = ${this.hex64(hi, lo)}`);
  }
  // The performance counters: CESR bits 0-5 = the event of CTR0, bits 6-8 = its control (0 = off),
  // bits 16-21 and 22-24 the same for CTR1. A counter counts the change of its event since the
  // last write (the core does not look at the CPL). The events: 00h data reads, 01h data writes,
  // 02h data TLB misses, 03h data read misses, 04h data write misses, 05h write hits to M or E
  // lines, 06h data write-backs, 0Ch code reads, 0Dh code TLB misses, 0Eh code cache misses,
  // 12h branches, 13h BTB hits, 14h taken branches or BTB hits, 15h pipeline flushes (wrong
  // predictions), 16h instructions, 17h instructions in the V pipe.
  pmcRaw(k) {
    const c = (this.cesr >>> (16 * k)) & 0x3FF;
    if (!(c & 0x1C0)) return 0;
    const d = this.dcache.stats, ic = this.icache.stats, t = this.tlbStats, b = this.btb.stats;
    switch (c & 0x3F) {
      case 0x00: return d.hits + d.misses;
      case 0x01: return d.writeHits + d.writeMisses;
      case 0x02: return t.misses;
      case 0x03: return d.misses;
      case 0x04: return d.writeMisses;
      case 0x05: return d.writeHitsME;
      case 0x06: return d.writeBacks;
      case 0x0C: return ic.hits + ic.misses;
      case 0x0D: return t.codeMisses;
      case 0x0E: return ic.misses;
      case 0x12: return b.lookups;
      case 0x13: return b.hits;
      case 0x14: return b.taken;
      case 0x15: return b.wrong;
      case 0x16: return this.instructions;
      case 0x17: return this.pipeStats.v;
      default: return 0;
    }
  }
  ctrValue(k) {
    const c = (this.cesr >>> (16 * k)) & 0x1C0;
    const v = this.ctrBase[k] + (c ? this.pmcRaw(k) - this.ctrRaw[k] : 0);
    return v % 1099511627776;
  }
  // CMPXCHG8B m64 (0F C7 /1): compare EDX:EAX with m64. Equal: ZF = 1 and m64 = ECX:EBX. Not equal:
  // ZF = 0, EDX:EAX = m64, and m64 gets its own value again (the P5 always writes it). A register
  // operand or another reg field gives #UD. The instruction can have a LOCK prefix.
  cmpxchg8b() {
    this.modrm();
    if (this.reg !== 1 || this.mod === 3) throw this.fault(6);
    const sg = this.eaSeg, o = this.eaOff, R = this.r;
    if ((this.linear(sg, o) & 7) && this.acOn()) throw this.fault(17, 0);
    this.wrCheck(sg, o, 8);
    const lo = this.rd(sg, o, 4), hi = this.rd(sg, this.addA(o, 4), 4);
    const ok = lo === R[0] && hi === R[2];
    if (ok) { this.wr(sg, o, 4, R[3]); this.wr(sg, this.addA(o, 4), 4, R[1]); this.f |= F_ZF; }
    else { this.wr(sg, o, 4, lo); this.wr(sg, this.addA(o, 4), 4, hi); R[0] = lo; R[2] = hi; this.f &= ~F_ZF; }
    if (this.trace) this.ev.push({ k: 'alu', op: 'CMPXCHG8B', a: R[0], b: lo, r: ok ? 1 : 0, w: 32 });
  }
  // The P5 has no test registers TR3-TR7 (MOV TRn gives #UD; the MSRs replace them).
  rdTR() { throw this.fault(6); }
  wrTR() { throw this.fault(6); }

  // ---------- debug: I/O breakpoints (CR4.DE = 1, DR7 R/W = 10) ----------
  updateDebug() {
    super.updateDebug();
    const d7 = this.dr[7];
    let io = false;
    for (let i = 0; i < 4; i++) if (((d7 >> (2 * i)) & 3) && ((d7 >>> (16 + 4 * i)) & 3) === 2) io = true;
    this.ioBp = io && (this.cr[4] & C4_DE) !== 0;
  }
  ioBreak(p, s) {
    const d7 = this.dr[7];
    for (let i = 0; i < 4; i++) {
      if (!((d7 >> (2 * i)) & 3) || ((d7 >>> (16 + 4 * i)) & 3) !== 2) continue;
      const len = [1, 2, 1, 4][(d7 >>> (18 + 4 * i)) & 3], a = this.dr[i] & 0xFFFF & ~(len - 1);
      if (p < a + len && p + s > a) this.pendingDB |= 1 << i;
    }
  }
  ioIn(p, s) { if (this.ioBp) this.ioBreak(p, s); return super.ioIn(p, s); }
  ioOut(p, s, v) { if (this.ioBp) this.ioBreak(p, s); super.ioOut(p, s, v); }

  // ---------- the FPU on the chip (the 486 path with the P5 clocks) ----------
  fpuClocks(res) {
    const mn = (res.text || '').split(':')[0];
    let c = P586_FPU_MEMO.get(mn);
    if (c === undefined) {
      const row = P586_FPU.find(([re]) => re.test(mn));
      c = row ? row[1] : Math.max(1, Math.round((res.cycles || 0) / 8));
      if (P586_FPU_MEMO.size < 512) P586_FPU_MEMO.set(mn, c);
    }
    return c;
  }
  // The FDIV bug: at the first FPU instruction with cpu.fdivBug = true, the FPU object gets its
  // own _arith method (one time; it stays). The method uses the P5 divider while fdivBug = true.
  fdivHook(fpu) {
    const cpu = this, base = FPU8087.prototype._arith;
    fpu._arith = function (op, a, b) { return cpu.fdivBug && op === 'div' ? p586BuggyArith.call(this, op, a, b) : base.call(this, op, a, b); };
  }
  esc(op) {
    const fpu = this.bus.fpu;
    if (!fpu) { CPU80386.prototype.esc.call(this, op); return; }
    if (this.cr[0] & 0xC) throw this.fault(7);      // EM or TS: #NM
    this.modrm();
    const mem = this.mod !== 3, modrm = (this.mod << 6) | (this.reg << 3) | this.rm;
    const control = mem ? (op === 0xD9 || op === 0xDD) && this.reg >= 4
      : (op === 0xDB && modrm >= 0xE0 && modrm <= 0xE4) || (op === 0xDF && modrm === 0xE0);
    if (!control && this.fpuError()) throw this.fault(16);
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
    if (this.fdivBug && fpu._arith === FPU8087.prototype._arith) this.fdivHook(fpu);
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
    this.clk += this.fpuClocks(res);
    if (this.trace) this.ev.push({ k: 'fpu', text: res.text || '', cycles: res.cycles || 0 });
  }
}

// ---------- the FDIV bug (cpu.fdivBug = true) ----------
// The P5 divider makes 2 quotient bits in each step (radix-4 SRT, digits -2..2). It keeps the
// partial remainder in carry-save form and selects the next digit from a table: the row is the
// top 7 bits of the partial remainder (the sum of the truncated sum and carry words, in steps of
// 1/8), the column is the top 5 bits of the divisor (1.dddd). Five cells of the table must hold
// 2 but hold 0: the top cells of the columns 1.0001, 1.0100, 1.0111, 1.1010 and 1.1101 (the rows
// 23/8, 27/8, 31/8, 35/8 and 39/8). In these five columns the line p = (8/3) D, the top of the
// region that the divider can reach, falls on a row boundary; the table generator took the cell
// below the line as outside the region, and all cells outside the region hold 0. When the partial
// remainder gets to one of these cells, the quotient is wrong from that digit on (for example
// 4195835 / 3145727 = 1.333739068902037589, not 1.333820449136241002).
const P586_BAD = { 17: 23, 20: 27, 23: 31, 26: 35, 29: 39 };
// The digit of the cell (p8, d): p8 = the partial remainder in steps of 1/8 (-64..63), d = the
// column (16-31, the divisor 1.dddd = d / 16). In each region where two digits are correct, the
// table gives the digit with the larger magnitude. With these thresholds the model gives the
// known wrong results of the first Pentium steps (see tests/cpu586.test.mjs).
const P586_SRT = [];
for (let d = 0; d < 32; d++) {
  const top = Math.ceil((4 * (d + 1)) / 3) - 1, bot = Math.floor((-4 * (d + 1)) / 3) - 1;
  const t2 = Math.ceil((2 * (d + 1)) / 3), t1 = Math.ceil((d + 1) / 6);         // 8 * 4/3 D and 8 * 1/3 D, D = (d + 1) / 16
  const t0 = Math.floor(-(d + 1) / 6 - 1), tm1 = Math.floor((-2 * (d + 1)) / 3 - 1);   // (d + 1) / 16: the largest D of the column
  const col = new Int8Array(128);
  for (let p8 = -64; p8 < 64; p8++) {
    col[p8 & 127] = p8 > top || p8 < bot || P586_BAD[d] === p8 ? 0 : p8 >= t2 ? 2 : p8 >= t1 ? 1 : p8 >= t0 ? 0 : p8 >= tm1 ? -1 : -2;
  }
  P586_SRT.push(col);
}
// The quotient of two significands (BigInt, 64 bits with the J bit) by the P5 method. Returns the
// quotient scaled by 2^(2 * steps) with the sign of the last remainder as a sticky bit.
function p586SrtDivide(nm, dm) {
  const F = 70n, W = 76n, MASK = (1n << W) - 1n;   // fixed point: F fraction bits, W bits in all
  const toFix = m => (m << (F - 63n)) & MASK;      // a significand in [1, 2) as a fixed-point value
  const D = toFix(dm), d = Number(dm >> 59n);      // the column: 1.dddd = 16..31
  let s = toFix(nm) >> 2n, c = 0n, q = 0n;         // r0 = N / 4, carry = 0
  const steps = 34;
  const top = x => { const v = Number((x >> (F - 3n)) & 0x7Fn); return v; };
  for (let j = 0; j < steps; j++) {
    s = (s << 2n) & MASK; c = (c << 2n) & MASK;
    const qd = P586_SRT[d][(top(s) + top(c)) & 0x7F];   // the 7-bit sum (two's complement, steps of 1/8)
    q = q * 4n + BigInt(qd);
    // -q * D: for q > 0 the ones' complement of q * D, and the carry-in 1 goes into bit 0 of the carry word
    const x = qd > 0 ? ~(BigInt(qd) * D) & MASK : qd < 0 ? BigInt(-qd) * D : 0n;
    const ns = s ^ c ^ x, nc = ((((s & c) | (s & x) | (c & x)) << 1n) | (qd > 0 ? 1n : 0n)) & MASK;
    s = ns; c = nc;
  }
  let r = (s + c) & MASK;
  if (r >> (W - 1n)) r -= 1n << W;                 // the final remainder (signed)
  return { q, steps, r, D };
}
// FPU8087._arith with the P5 divider for finite, normal operands (the other cases and the other
// operations use the normal path). See fdivHook().
function p586BuggyArith(op, a, b) {
  const base = FPU8087.prototype._arith;
  if (op !== 'div' || F80.cls(a) !== 'normal' || F80.cls(b) !== 'normal') return base.call(this, op, a, b);
  const { q, steps, r } = p586SrtDivide(a.mant, b.mant);
  // q * 4^-steps * 4 = N / D (the first remainder was N / 4). A negative remainder: q is too big.
  let m = q, sticky = r !== 0n ? 1n : 0n;
  if (r < 0n) { m -= 1n; }
  const A = F80.unpack(a), B = F80.unpack(b);
  // N = A.m * 2^(A.e), D = B.m * 2^(B.e); the significands are A.m / 2^63 and B.m / 2^63.
  const e = A.e - B.e - (2 * steps - 2);
  return this._toReg(a.sign ^ b.sign, (m << 1n) | sticky, e - 1);
}

// The CPUID signature and the EDX value after reset: family 5, model 1, stepping 7.
CPU80586.SIGNATURE = 0x0517;
// CPUID leaf 1 EDX (without the FPU bit 0): DE (2), PSE (3), TSC (4), MSR (5), MCE (7), CX8 (8).
CPU80586.FEATURES = 0x1BC;
