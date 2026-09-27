// Intel 80386 CPU core. It extends CPU80286 (src/core/cpu80286.js) and keeps its step() and
// micro-event contract (see ARCHITECTURE.md, "80386 CPU").
//
// - 32-bit registers (cpu.regs32), EIP (cpu.ip = cpu.eip), EFLAGS (cpu.f, cpu.eflags) with
//   IOPL, NT, RF and VM. cpu.regs (Uint16Array) is a mirror of the low 16 bits for the views.
// - Operand size and address size: the D bit of the CS descriptor, then the 66h / 67h
//   prefixes. ModR/M with SIB and 32-bit displacements. Segments ES CS SS DS FS GS.
// - Real mode (the segment loads keep the cached limit, as on the real 80386), protected
//   mode with 32-bit descriptors (G and D/B bits), 286 and 386 gates and TSS, privilege
//   checks, exceptions with error codes, virtual-8086 mode with the I/O permission bitmap,
//   paging (CR0.PG, CR2, CR3, 4 KB pages, two-level tables) with a 32-entry TLB.
// - The bus takes 32-bit physical addresses. The machine has a 16-bit data bus (as the
//   386SX): a bus cycle moves at most 2 bytes, so a dword is 2 bus cycles.
// - Clock counts are approximate values from the Intel 386 data sheet.
//
// A fault stops the instruction with a thrown Fault286. step() catches it, sets EIP and
// ESP back to the start of the instruction and starts the exception handler.

const P386_NT = 0x4000, P386_RF = 0x10000, P386_VM = 0x20000;
const P386_FMASK = 0x37FD5;                 // the EFLAGS bits of the 80386 (bit 1 is always 1)
const P386_REG32 = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI'];
const P386_SREG = ['ES', 'CS', 'SS', 'DS', 'FS', 'GS'];
const P386_EXC = ['#DE', '#DB', 'NMI', '#BP', '#OF', '#BR', '#UD', '#NM', '#DF', '#CSO', '#TS', '#NP', '#SS', '#GP', '#PF', 'INT 15', '#MF'];
// Contributory exceptions (#DE, #9, #TS, #NP, #SS, #GP). #PF has its own rules (see exception()).
const P386_CONTRIB = [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0];
const P386_MASK = [0, 0xFF, 0xFFFF, 0, 0xFFFFFFFF];
const P386_SIGN = [0, 0x80, 0x8000, 0, 0x80000000];
const P386_FS = 4, P386_GS = 5;
// One-byte opcodes that accept LOCK (with a memory destination; see lockCheck()).
const P386_LOCK = new Uint8Array(256);
for (const o of [0x00, 0x01, 0x08, 0x09, 0x10, 0x11, 0x18, 0x19, 0x20, 0x21, 0x28, 0x29, 0x30, 0x31,
  0x80, 0x81, 0x82, 0x83, 0x86, 0x87, 0xF6, 0xF7, 0xFE, 0xFF, 0x0F]) P386_LOCK[o] = 1;

class CPU80386 extends CPU80286 {
  // The constructor of CPU8086 calls reset(), which makes the 386 state on the first call.
  reset() {
    if (!this.regs32) {
      this.regs32 = new Uint32Array(8);
      this.r = this.regs32;
      this.regsOut = new Uint16Array(8);     // the values that step() wrote last to cpu.regs
      this.sregs = new Uint16Array(6);
      this.cache = [0, 1, 2, 3, 4, 5].map(() => ({ sel: 0, base: 0, limit: 0xFFFF, access: 0x93, flags: 0, big: false, lo: 0, hi: 0xFFFF, rd: true, wr: true }));
      this.gdtr = { base: 0, limit: 0xFFFF };
      this.idtr = { base: 0, limit: 0x3FF };
      this.ldtr = { sel: 0, base: 0, limit: 0xFFFF, access: 0x82, valid: false };
      this.tr = { sel: 0, base: 0, limit: 0xFFFF, access: 0x8B };
      this.cr = new Uint32Array(5);
      this.dr = new Uint32Array(8);
      this.tlb = [];
      for (let i = 0; i < 32; i++) this.tlb.push({ lin: 0, phys: 0, flags: 0, valid: false });
      this.tlbNext = new Uint8Array(8);
      this.tlbStats = { hits: 0, misses: 0, flushes: 0 };
      this.trace = null;
    }
    const R = this.r;
    R.fill(0);
    R[2] = 0x0308;                          // EDX after reset: component ID 03h, revision 08h (D1)
    this.regs.fill(0);
    this.cr.fill(0);
    this.cr[0] = 0x7FFFFFE0 | (this.bus && this.bus.fpu ? 0x10 : 0);   // reserved bits read as 1; ET
    this.paging = false;
    this.dr.fill(0); this.dr[6] = 0xFFFF0FF0; this.dbgOn = false;
    this.tr6 = 0; this.tr7 = 0;
    this.flushTLB();
    this.tlbStats.flushes = 0; this.tlbStats.hits = 0; this.tlbStats.misses = 0;
    this.cpl = 0;
    this.f = 2;
    for (let i = 0; i < 6; i++) this.setCache(i, i === CS ? 0xF000 : 0, i === CS ? 0xFFFF0000 : 0, 0xFFFF, 0x93, 'real', 0);
    Object.assign(this.gdtr, { base: 0, limit: 0xFFFF });
    Object.assign(this.idtr, { base: 0, limit: 0x3FF });
    Object.assign(this.ldtr, { sel: 0, base: 0, limit: 0xFFFF, access: 0x82, valid: false });
    Object.assign(this.tr, { sel: 0, base: 0, limit: 0xFFFF, access: 0x8B });
    this.ip = 0xFFF0;
    this.halted = false; this.shutdownState = false;
    this.repState = null; this.inhibit = false; this.keepRF = false; this.pendingDB = 0;
    this.cycles = 0; this.instructions = 0;
    this.seg = -1; this.rep = 0; this.lock = false; this.ext = 0;
    this.osz = 2; this.a32 = false; this.opPfx = false; this.adPfx = false;
    this.ws = 0; this.busLen = 2; this.didFlush = false; this.ilen = 0;
    this.lastIP = this.ip; this.lastCS = 0xF000; this.lastBase = 0xFFFF0000; this.spStart = 0;
    this.faultRF = false; this.tlbSeen = false;
    this.q = [];
    this.flush();
    this.syncOut();
  }

  // ---------- register views ----------
  get eip() { return this.ip; }
  set eip(v) { this.ip = v >>> 0; }
  // this.fmask: the EFLAGS bits of the processor. this.xfl: the bits above bit 17 that
  // POPFD and IRETD can change (0 on the 80386; the 80486 adds AC and ID). Both are on
  // the prototype (see the end of this file).
  get flags() { return (this.f & 0x7FD5) | 2; }
  set flags(v) { this.f = (this.f & ~0xFFFF) | (v & 0x7FD5) | 2; }
  get eflags() { return ((this.f & this.fmask) | 2) >>> 0; }
  set eflags(v) { this.f = (v & this.fmask) | 2; }
  get pe() { return (this.cr[0] & 1) === 1; }
  set pe(v) { if (v) this.cr[0] |= 1; else this.cr[0] &= ~1; }
  get msw() { return this.cr[0] & 0xFFFF; }
  set msw(v) { this.cr[0] = (this.cr[0] & 0xFFFF0000) | (v & 0xFFFF); }
  get vm() { return (this.f & P386_VM) !== 0; }
  get linearIP() { return (this.cache[CS].base + this.ip) >>> 0; }
  // Linear and physical address of seg:off for the views (no bus cycles, no faults).
  linear(s, o) { return (this.cache[s].base + o) >>> 0; }
  phys(s, o) { const p = this.peekPhys(this.linear(s, o)); return p < 0 ? 0 : p; }

  // cpu.regs mirrors the low 16 bits of cpu.regs32. Other code (the machine, a debugger)
  // can write cpu.regs; step() then copies the change into regs32.
  syncIn() {
    const R = this.r, G = this.regs, O = this.regsOut;
    for (let i = 0; i < 8; i++) if (G[i] !== O[i]) R[i] = (R[i] & 0xFFFF0000) | G[i];
    const s = this.sregs, c = this.cache;
    if (!(this.cr[0] & 1)) {
      for (let i = 0; i < 6; i++) if (s[i] !== c[i].sel) this.loadSegReal(i, s[i]);
    } else if (this.f & P386_VM) {
      for (let i = 0; i < 6; i++) if (s[i] !== c[i].sel) this.loadSegV86(i, s[i]);
    }
  }
  syncOut() {
    const R = this.r, G = this.regs, O = this.regsOut;
    for (let i = 0; i < 8; i++) { G[i] = R[i]; O[i] = G[i]; }
  }
  syncSegs() { this.syncIn(); }

  // Register i of size s (1, 2 or 4 bytes; for bytes: AL CL DL BL AH CH DH BH).
  rget(i, s) {
    const R = this.r;
    if (s === 4) return R[i];
    if (s === 2) return R[i] & 0xFFFF;
    return i & 4 ? (R[i & 3] >>> 8) & 0xFF : R[i] & 0xFF;
  }
  rset(i, s, v) {
    const R = this.r;
    if (s === 4) R[i] = v;
    else if (s === 2) R[i] = (R[i] & 0xFFFF0000) | (v & 0xFFFF);
    else if (i & 4) { const k = i & 3; R[k] = (R[k] & 0xFFFF00FF) | ((v & 0xFF) << 8); }
    else R[i] = (R[i] & 0xFFFFFF00) | (v & 0xFF);
  }

  fault(vec, err) { return new Fault286(vec, err === undefined ? -1 : err); }
  fsel(vec, sel) { return new Fault286(vec, (sel & 0xFFFC) | this.ext); }

  // ---------- descriptor caches ----------
  calcCache(d) {
    const a = d.access;
    if ((a & 0x1C) === 0x14) { d.lo = d.limit + 1; d.hi = d.big ? 0xFFFFFFFF : 0xFFFF; } else { d.lo = 0; d.hi = d.limit; }
    if (!(this.cr[0] & 1) || (this.f & P386_VM)) { d.rd = true; d.wr = true; }
    else if (a & 8) { d.rd = (a & 2) !== 0; d.wr = false; } else { d.rd = true; d.wr = (a & 2) !== 0; }
  }
  // flags: bits 20-23 of the descriptor (G, D/B, 0, AVL).
  setCache(i, sel, base, limit, access, table, flags) {
    const d = this.cache[i];
    d.sel = sel; d.base = base >>> 0; d.limit = limit >>> 0; d.access = access; d.flags = flags || 0;
    d.big = (d.flags & 4) !== 0;
    this.calcCache(d);
    this.sregs[i] = sel;
    if (this.trace) this.ev.push({ k: 'desc', sreg: P386_SREG[i], sel, base: d.base, limit: d.limit, access, table: table || (this.cr[0] & 1 ? (sel & 4 ? 'LDT' : 'GDT') : 'real') });
  }
  setNull(i, sel) {
    const d = this.cache[i];
    d.sel = sel; d.base = 0; d.limit = 0; d.access = 0; d.flags = 0; d.big = false; d.lo = 1; d.hi = 0; d.rd = false; d.wr = false;
    this.sregs[i] = sel;
    if (this.trace) this.ev.push({ k: 'desc', sreg: P386_SREG[i], sel, base: 0, limit: 0, access: 0, table: 'null' });
  }
  // Real mode: the selector sets the base (selector * 16). Limit and access stay.
  loadSegReal(i, sel) {
    const d = this.cache[i];
    d.sel = sel; d.base = sel << 4; this.sregs[i] = sel;
    if (this.trace) this.ev.push({ k: 'desc', sreg: P386_SREG[i], sel, base: d.base, limit: d.limit, access: d.access, table: 'real' });
  }
  // Virtual-8086 mode: base = selector * 16, limit FFFFh, a DPL 3 read/write segment.
  loadSegV86(i, sel) {
    const d = this.cache[i];
    d.sel = sel; d.base = sel << 4; d.limit = 0xFFFF; d.access = i === CS ? 0xFB : 0xF3; d.flags = 0; d.big = false;
    d.lo = 0; d.hi = 0xFFFF; d.rd = true; d.wr = true;
    this.sregs[i] = sel;
    if (this.trace) this.ev.push({ k: 'desc', sreg: P386_SREG[i], sel, base: d.base, limit: 0xFFFF, access: d.access, table: 'v86' });
  }
  loadSeg(i, sel) {
    sel &= 0xFFFF;
    if (!(this.cr[0] & 1)) { this.loadSegReal(i, sel); return; }
    if (this.f & P386_VM) { this.loadSegV86(i, sel); return; }
    if (i === SS) this.loadSS(sel);
    else if (i === CS) { const d = this.desc(sel, 13); this.setCS(sel, d, sel & 3); }
    else this.loadDataSeg(i, sel);
  }

  // Read the 8-byte descriptor of a selector. Returns null when the selector is outside
  // its table. limit is in bytes (the G bit is applied).
  readDesc(sel) {
    let tb, tl;
    if (sel & 4) { if (!this.ldtr.valid) return null; tb = this.ldtr.base; tl = this.ldtr.limit; }
    else { tb = this.gdtr.base; tl = this.gdtr.limit; }
    if ((sel | 7) > tl) return null;
    const a = (tb + (sel & 0xFFF8)) >>> 0;
    const lo = this.rdSysD(a), hi = this.rdSysD(a + 4);
    const w0 = lo & 0xFFFF, w1 = lo >>> 16, w2 = hi & 0xFFFF, w3 = hi >>> 16;
    const access = (hi >>> 8) & 0xFF, flags = (hi >>> 20) & 0xF;
    let limit = w0 | (hi & 0xF0000);
    if (flags & 8) limit = ((limit << 12) | 0xFFF) >>> 0;
    const base = (w1 | ((hi & 0xFF) << 16) | (hi & 0xFF000000)) >>> 0;
    return { sel, addr: a, limit, base, access, flags, w0, w1, w2, w3 };
  }
  desc(sel, vec) {
    const d = this.readDesc(sel);
    if (!d) throw this.fsel(vec, sel);
    return d;
  }
  setAccessed(d) {
    if ((d.access & 0x10) && !(d.access & 1)) { d.access |= 1; this.wrSysB(d.addr + 5, d.access); }
  }
  loadDataSeg(i, sel) {
    if (!(sel & 0xFFFC)) { this.setNull(i, sel); return; }
    const d = this.desc(sel, 13), a = d.access;
    if (!(a & 0x10) || (a & 0x0A) === 0x08) throw this.fsel(13, sel);
    if ((a & 0x0C) !== 0x0C && Math.max(this.cpl, sel & 3) > ((a >> 5) & 3)) throw this.fsel(13, sel);
    if (!(a & 0x80)) throw this.fsel(11, sel);
    this.setAccessed(d);
    this.setCache(i, sel, d.base, d.limit, d.access, undefined, d.flags);
  }
  loadSS(sel) {
    if (!(sel & 0xFFFC)) throw this.fault(13, this.ext);
    const d = this.desc(sel, 13), a = d.access;
    if ((sel & 3) !== this.cpl || ((a >> 5) & 3) !== this.cpl || (a & 0x1A) !== 0x12) throw this.fsel(13, sel);
    if (!(a & 0x80)) throw this.fsel(12, sel);
    this.setAccessed(d);
    this.setCache(SS, sel, d.base, d.limit, d.access, undefined, d.flags);
  }
  setCS(sel, d, cpl) {
    this.cpl = cpl;
    this.setAccessed(d);
    this.setCache(CS, (sel & 0xFFFC) | cpl, d.base, d.limit, d.access, undefined, d.flags);
  }
  // DS, ES, FS and GS get a null selector when their DPL is below the new (outer) CPL.
  nullOuter() {
    for (const i of [ES, DS, P386_FS, P386_GS]) {
      const a = this.cache[i].access;
      if ((a & 0x10) && (a & 0x0C) !== 0x0C && ((a >> 5) & 3) < this.cpl) this.setNull(i, 0);
    }
  }

  // ---------- bus cycles (16-bit data bus) ----------
  busEv(type, a, v, width, s) {
    this.nEU++;
    const st = this.bus.stats;
    if (st) countCycle(st, type);
    if (this.trace) {
      this.euEv.push({ k: 'bus', type, addr: a, data: v, width, seg: s < 0 ? null : P386_SREG[s],
        dev: this.bus.devAt ? (type === 'ior' || type === 'iow' ? this.bus.ioDevAt(a) : this.bus.devAt(a)) : 'ram', owner: 'cpu', len: this.busLen });
    }
  }
  // The bus cycles of an n-byte access at physical address pa: an aligned word is one
  // cycle, the other bytes are one cycle each (as on the 386SX).
  memEv(type, pa, v, n, s) {
    if (n === 1) { this.busEv(type, pa, v & 0xFF, 1, s); return; }
    if (!(pa & 1)) {
      this.busEv(type, pa, v & 0xFFFF, 2, s);
      if (n === 4) this.busEv(type, (pa + 2) >>> 0, v >>> 16, 2, s);
      return;
    }
    this.clk += 2;
    this.busEv(type, pa, v & 0xFF, 1, s);
    if (n === 2) { this.busEv(type, (pa + 1) >>> 0, (v >>> 8) & 0xFF, 1, s); return; }
    this.busEv(type, (pa + 1) >>> 0, (v >>> 8) & 0xFFFF, 2, s);
    this.busEv(type, (pa + 3) >>> 0, v >>> 24, 1, s);
  }
  // Limit or access violation: #SS(0) for SS, else #GP(0).
  segFault(s) { throw this.fault(s === SS ? 12 : 13, 0); }

  // Segment access: s = segment, o = offset, n = 1, 2 or 4 bytes.
  rd(s, o, n) {
    const d = this.cache[s];
    if (o < d.lo || o + n - 1 > d.hi || !d.rd) this.segFault(s);
    return this.rdLin((d.base + o) >>> 0, n, s, this.cpl === 3);
  }
  wr(s, o, n, v) {
    const d = this.cache[s];
    if (o < d.lo || o + n - 1 > d.hi || !d.wr) this.segFault(s);
    this.wrLin((d.base + o) >>> 0, n, v, s, this.cpl === 3);
  }
  // Only the checks of wr() (for instructions that must fault before they change state).
  wrCheck(s, o, n) {
    const d = this.cache[s];
    if (o < d.lo || o + n - 1 > d.hi || !d.wr) this.segFault(s);
    if (this.paging) this.probe((d.base + o) >>> 0, n, true, this.cpl === 3);
  }
  rdCheck(s, o, n) {
    const d = this.cache[s];
    if (o < d.lo || o + n - 1 > d.hi || !d.rd) this.segFault(s);
    if (this.paging) this.probe((d.base + o) >>> 0, n, false, this.cpl === 3);
  }
  // The 8086-style helpers of the base classes (byte / word).
  rb(s, o) { return this.rd(s, o, 1); }
  wb(s, o, v) { this.wr(s, o, 1, v); }
  rw(s, o) { return this.rd(s, o, 2); }
  ww(s, o, v) { this.wr(s, o, 2, v); }

  // Linear access: paging (when CR0.PG = 1), then the bus.
  rdLin(la, n, s, user) {
    const bus = this.bus;
    let pa = la;
    if (this.paging) {
      if ((la & 0xFFF) + n > 0x1000) return this.rdSplit(la, n, s, user);
      pa = this.xlate(la, false, user);
    }
    let v;
    if (n === 1) v = bus.read8(pa);
    else if (n === 2) v = bus.read8(pa) | (bus.read8((pa + 1) >>> 0) << 8);
    else v = (bus.read8(pa) | (bus.read8((pa + 1) >>> 0) << 8) | (bus.read8((pa + 2) >>> 0) << 16) | (bus.read8((pa + 3) >>> 0) << 24)) >>> 0;
    this.memEv('memr', pa, v, n, s);
    if (this.dbgOn) this.dataBreak(la, n, false);
    return v;
  }
  wrLin(la, n, v, s, user) {
    const bus = this.bus;
    let pa = la;
    if (this.paging) {
      if ((la & 0xFFF) + n > 0x1000) { this.wrSplit(la, n, v, s, user); return; }
      pa = this.xlate(la, true, user);
    }
    bus.write8(pa, v & 0xFF);
    if (n > 1) {
      bus.write8((pa + 1) >>> 0, (v >>> 8) & 0xFF);
      if (n === 4) { bus.write8((pa + 2) >>> 0, (v >>> 16) & 0xFF); bus.write8((pa + 3) >>> 0, v >>> 24); }
    }
    this.memEv('memw', pa, n === 4 ? v >>> 0 : v & P386_MASK[n], n, s);
    if (this.dbgOn) this.dataBreak(la, n, true);
  }
  // An access that crosses a page boundary: both pages are translated first.
  rdSplit(la, n, s, user) {
    const k = 0x1000 - (la & 0xFFF), la2 = (la + k) >>> 0;
    const p0 = this.xlate(la, false, user), p1 = this.xlate(la2, false, user);
    let v = 0;
    for (let i = 0; i < n; i++) {
      const pa = i < k ? p0 + i : p1 + i - k, b = this.bus.read8(pa);
      this.busEv('memr', pa, b, 1, s);
      v |= b << (8 * i);
    }
    return n === 4 ? v >>> 0 : v;
  }
  wrSplit(la, n, v, s, user) {
    const k = 0x1000 - (la & 0xFFF), la2 = (la + k) >>> 0;
    const p0 = this.xlate(la, true, user), p1 = this.xlate(la2, true, user);
    for (let i = 0; i < n; i++) {
      const pa = i < k ? p0 + i : p1 + i - k, b = (v >>> (8 * i)) & 0xFF;
      this.bus.write8(pa, b);
      this.busEv('memw', pa, b, 1, s);
    }
  }
  // Translate every page of an n-byte access (it gives #PF before the instruction changes
  // any state).
  probe(la, n, write, user) {
    this.xlate(la, write, user);
    if ((la & 0xFFF) + n > 0x1000) this.xlate(((la | 0xFFF) + 1) >>> 0, write, user);
  }
  // System accesses (descriptor tables, TSS, IDT) at a linear address, at privilege level 0.
  rdSysB(a) { return this.rdLin(a >>> 0, 1, -1, false); }
  rdSys(a) { return this.rdLin(a >>> 0, 2, -1, false); }
  rdSysD(a) { return this.rdLin(a >>> 0, 4, -1, false); }
  wrSysB(a, v) { this.wrLin(a >>> 0, 1, v, -1, false); }
  wrSys(a, v) { this.wrLin(a >>> 0, 2, v, -1, false); }
  wrSysD(a, v) { this.wrLin(a >>> 0, 4, v, -1, false); }
  // Physical dword (page directory and page table entries).
  rdPhysD(pa) {
    const b = this.bus;
    const v = (b.read8(pa) | (b.read8(pa + 1) << 8) | (b.read8(pa + 2) << 16) | (b.read8(pa + 3) << 24)) >>> 0;
    this.memEv('memr', pa, v, 4, -1);
    return v;
  }
  wrPhysD(pa, v) {
    const b = this.bus;
    b.write8(pa, v & 0xFF); b.write8(pa + 1, (v >>> 8) & 0xFF); b.write8(pa + 2, (v >>> 16) & 0xFF); b.write8(pa + 3, v >>> 24);
    this.memEv('memw', pa, v >>> 0, 4, -1);
  }

  // ---------- paging and TLB ----------
  // The TLB: 32 entries, 8 sets of 4 ways, set = linear address bits 12-14 (as the 80386).
  // Entry i = set * 4 + way: { lin (page), phys (page frame), flags, valid }. flags: bit 1
  // R/W and bit 2 U/S (PDE AND PTE), bit 5 A, bit 6 D (of the PTE). A new entry replaces
  // the ways of a set in turn (round robin).
  flushTLB() {
    for (const e of this.tlb) e.valid = false;
    this.tlbStats.flushes++;
  }
  tlbFind(la) {
    const set = (la >>> 12) & 7, page = (la & 0xFFFFF000) >>> 0, T = this.tlb;
    for (let i = set * 4; i < set * 4 + 4; i++) { const e = T[i]; if (e.valid && e.lin === page) return e; }
    return null;
  }
  tlbPut(page, frame, flags) {
    const set = (page >>> 12) & 7;
    let way = -1;
    for (let w = 0; w < 4; w++) { const e = this.tlb[set * 4 + w]; if (e.valid && e.lin === page) { way = w; break; } }
    if (way < 0) { way = this.tlbNext[set]; this.tlbNext[set] = (way + 1) & 3; }
    const e = this.tlb[set * 4 + way];
    e.lin = page; e.phys = frame; e.flags = flags; e.valid = true;
    return e;
  }
  pageFault(la, err) {
    this.cr[2] = la;
    return this.fault(14, err);
  }
  // Linear -> physical. user: the access is at CPL 3 (not a system access).
  xlate(la, write, user) {
    const e = this.tlbFind(la);
    if (e) {
      const fl = e.flags;
      if (user && (!(fl & 4) || (write && !(fl & 2)))) return this.walk(la, write, user);
      if (!write || (fl & 0x40)) {
        this.tlbStats.hits++;
        const pa = (e.phys | (la & 0xFFF)) >>> 0;
        if (this.trace && !this.tlbSeen) { this.tlbSeen = true; this.ev.push({ k: 'tlb', lin: la, phys: pa, hit: true }); }
        return pa;
      }
    }
    return this.walk(la, write, user);
  }
  // Page walk: the directory entry, then the table entry. Sets the A bits (and D on a write).
  walk(la, write, user) {
    this.tlbStats.misses++;
    const dir = la >>> 22, tbl = (la >>> 12) & 0x3FF;
    const pdeA = ((this.cr[3] & 0xFFFFF000) + dir * 4) >>> 0;
    const pde = this.rdPhysD(pdeA);
    const ev = this.trace ? { k: 'page', lin: la, phys: 0, dir, tbl, hit: false, pde, pte: 0, fault: false } : null;
    const err = (write ? 2 : 0) | (user ? 4 : 0);
    const fail = code => { if (ev) { ev.fault = true; ev.err = code; this.ev.push(ev); } return this.pageFault(la, code); };
    if (!(pde & 1)) throw fail(err);
    const pteA = ((pde & 0xFFFFF000) + tbl * 4) >>> 0;
    const pte = this.rdPhysD(pteA);
    if (ev) ev.pte = pte;
    if (!(pte & 1)) throw fail(err);
    const us = pde & pte & 4, rw = pde & pte & 2;
    if (user && (!us || (write && !rw))) throw fail(err | 1);
    if (!(pde & 0x20)) this.wrPhysD(pdeA, pde | 0x20);
    const npte = pte | 0x20 | (write ? 0x40 : 0);
    if (npte !== pte) this.wrPhysD(pteA, npte);
    const frame = (pte & 0xFFFFF000) >>> 0;
    this.tlbPut((la & 0xFFFFF000) >>> 0, frame, us | rw | 0x21 | (npte & 0x40));
    const pa = (frame | (la & 0xFFF)) >>> 0;
    if (ev) { ev.phys = pa; this.ev.push(ev); }
    return pa;
  }
  // Translation for the views: no bus cycles, no A/D bits, no faults (-1 = not present).
  peekPhys(la) {
    la >>>= 0;
    if (!this.paging) return la;
    const e = this.tlbFind(la);
    if (e) return (e.phys | (la & 0xFFF)) >>> 0;
    const b = this.bus, rd = a => (b.read8(a) | (b.read8(a + 1) << 8) | (b.read8(a + 2) << 16) | (b.read8(a + 3) << 24)) >>> 0;
    const pde = rd(((this.cr[3] & 0xFFFFF000) + (la >>> 22) * 4) >>> 0);
    if (!(pde & 1)) return -1;
    const pte = rd(((pde & 0xFFFFF000) + ((la >>> 12) & 0x3FF) * 4) >>> 0);
    if (!(pte & 1)) return -1;
    return ((pte & 0xFFFFF000) | (la & 0xFFF)) >>> 0;
  }
  // Test registers TR6 (command) and TR7 (data): write or look up a TLB entry.
  tlbTest() {
    const t6 = this.tr6, t7 = this.tr7, page = (t6 & 0xFFFFF000) >>> 0;
    if (t6 & 1) {                             // C = 1: look up
      const e = this.tlbFind(page);
      if (e) { const way = this.tlb.indexOf(e) & 3; this.tr7 = ((e.phys & 0xFFFFF000) | 0x10 | (way << 2)) >>> 0; }
      else this.tr7 = (t7 & ~0x10) >>> 0;
      return;
    }
    // C = 0: write the entry. TR6 bits: 11 V, 10 D, 8 U, 6 W (the true bits).
    const set = (page >>> 12) & 7, way = (t7 >> 2) & 3, e = this.tlb[set * 4 + way];
    e.lin = page; e.phys = (t7 & 0xFFFFF000) >>> 0; e.valid = (t6 & 0x800) !== 0;
    e.flags = 0x21 | ((t6 & 0x400) ? 0x40 : 0) | ((t6 & 0x100) ? 4 : 0) | ((t6 & 0x40) ? 2 : 0);
  }

  // ---------- debug registers ----------
  updateDebug() {
    const d7 = this.dr[7];
    this.dbgOn = false; this.dbgExec = false;
    for (let i = 0; i < 4; i++) {
      if (!((d7 >> (2 * i)) & 3)) continue;
      const rw = (d7 >>> (16 + 4 * i)) & 3;
      if (rw === 0) this.dbgExec = true; else this.dbgOn = true;
    }
  }
  // Data breakpoints (DR7 R/W = 01 write, 11 read/write): a trap after the instruction.
  dataBreak(la, n, write) {
    const d7 = this.dr[7];
    for (let i = 0; i < 4; i++) {
      if (!((d7 >> (2 * i)) & 3)) continue;
      const rw = (d7 >>> (16 + 4 * i)) & 3;
      if (rw === 0 || rw === 2 || (rw === 1 && !write)) continue;
      const len = ((d7 >>> (18 + 4 * i)) & 3) + 1, a = this.dr[i] & ~(len - 1);
      if (la < a + len && la + n > a) this.pendingDB |= 1 << i;
    }
  }
  // Instruction breakpoints (R/W = 00): a fault before the instruction (RF = 1 skips it).
  execBreak() {
    if (this.f & P386_RF) return 0;
    const d7 = this.dr[7], la = this.linearIP;
    let hit = 0;
    for (let i = 0; i < 4; i++) {
      if (!((d7 >> (2 * i)) & 3) || ((d7 >>> (16 + 4 * i)) & 3) !== 0) continue;
      if (this.dr[i] >>> 0 === la) hit |= 1 << i;
    }
    return hit;
  }

  // ---------- I/O ----------
  ioIn(p, s) {
    if (s === 1) return this.inb(p);
    if (s === 2) return this.inw(p);
    return (this.inw(p) | (this.inw((p + 2) & 0xFFFF) << 16)) >>> 0;
  }
  ioOut(p, s, v) {
    if (s === 1) this.outb(p, v);
    else if (s === 2) this.outw(p, v);
    else { this.outw(p, v & 0xFFFF); this.outw((p + 2) & 0xFFFF, v >>> 16); }
  }
  // I/O permission: in protected mode with CPL > IOPL, and always in virtual-8086 mode,
  // the I/O permission bitmap of the 386 TSS must have 0 bits for all the ports.
  ioPerm(p, n) {
    if (!(this.cr[0] & 1)) return;
    if (!(this.f & P386_VM) && this.cpl <= this.iopl) return;
    const t = this.tr;
    if ((t.access & 0x1F) !== 0x0B || t.limit < 0x67) throw this.fault(13, 0);
    const map = this.rdSys(t.base + 0x66), at = map + (p >> 3);
    if (at + 1 > t.limit) throw this.fault(13, 0);
    const bits = this.rdSys(t.base + at);
    if (bits & (((1 << n) - 1) << (p & 7))) throw this.fault(13, 0);
  }
  // CLI, STI (and IN/OUT in protected mode without a bitmap): CPL <= IOPL, IOPL 3 in V86.
  ioCheck() {
    if (!(this.cr[0] & 1)) return;
    if (this.f & P386_VM ? this.iopl < 3 : this.cpl > this.iopl) throw this.fault(13, 0);
  }
  v86Check() { if ((this.f & P386_VM) && this.iopl < 3) throw this.fault(13, 0); }

  // ---------- stack (ESP when the SS descriptor has B = 1, else SP) ----------
  getSP() { return this.cache[SS].big ? this.r[4] : this.r[4] & 0xFFFF; }
  setSP(v) { const R = this.r; if (this.cache[SS].big) R[4] = v; else R[4] = (R[4] & 0xFFFF0000) | (v & 0xFFFF); }
  stackOff(k) { return this.cache[SS].big ? (this.r[4] + k) >>> 0 : (this.r[4] + k) & 0xFFFF; }
  push(v, s) {
    s = s || 2;
    const R = this.r;
    if (this.cache[SS].big) { const sp = (R[4] - s) >>> 0; this.wr(SS, sp, s, v); R[4] = sp; }
    else { const sp = (R[4] - s) & 0xFFFF; this.wr(SS, sp, s, v); R[4] = (R[4] & 0xFFFF0000) | sp; }
  }
  pop(s) {
    s = s || 2;
    const R = this.r;
    if (this.cache[SS].big) { const v = this.rd(SS, R[4], s); R[4] = (R[4] + s) >>> 0; return v; }
    const sp = R[4] & 0xFFFF, v = this.rd(SS, sp, s);
    R[4] = (R[4] & 0xFFFF0000) | ((sp + s) & 0xFFFF);
    return v;
  }
  // The value k bytes above the top of the stack (no pop).
  peekStack(k, s) { return this.rd(SS, this.stackOff(k), s); }

  // ---------- prefetch queue (16 bytes; one aligned word per bus cycle) ----------
  flush() {
    this.q.length = 0; this.qip = this.ip; this.didFlush = true;
    if (this.trace) this.ev.push({ k: 'queue', op: 'flush', n: 0, q: [] });
  }
  // stall = true: the EU waits for this byte (a fault is raised); else the BIU stops at the
  // CS limit or at a page that is not in the TLB.
  prefetch(stall) {
    const qip = this.qip, d = this.cache[CS], bus = this.bus;
    if (!stall && qip > d.hi) return false;
    const la = (d.base + qip) >>> 0;
    let pa = la;
    if (this.paging) {
      if (stall) pa = this.xlate(la, false, this.cpl === 3);
      else {
        const e = this.tlbFind(la);
        if (!e || (this.cpl === 3 && !(e.flags & 4))) return false;
        pa = (e.phys | (la & 0xFFF)) >>> 0;
      }
    }
    let data, width;
    if (!(la & 1) && qip < d.hi) {
      const b0 = bus.read8(pa), b1 = bus.read8((pa + 1) >>> 0);
      this.q.push(b0, b1); data = b0 | (b1 << 8); width = 2;
      this.qip = (qip + 2) >>> 0;
    } else {
      data = bus.read8(pa); this.q.push(data); width = 1;
      this.qip = (qip + 1) >>> 0;
    }
    if (bus.stats) bus.stats.fetch++;
    if (this.trace) {
      const e = { k: 'fetch', addr: pa, data, width, seg: 'CS', dev: bus.devAt ? bus.devAt(pa) : 'ram', q: this.q.slice(), len: this.busLen };
      if (stall) this.stallEv.push(e); else this.ev.push(e);
    }
    return true;
  }
  fetch() {
    const ip = this.ip;
    // A byte past the CS limit, or an instruction longer than 15 bytes: #GP(0).
    if (ip > this.cache[CS].hi || ++this.ilen > 15) throw this.fault(13, 0);
    if (!this.q.length) { this.nStall++; this.prefetch(true); }
    const b = this.q.shift();
    this.ip = (ip + 1) >>> 0;
    if (this.trace) this.ibytes.push(b);
    return b;
  }
  fetchW() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  fetchD() { const lo = this.fetchW(); return (lo | (this.fetchW() << 16)) >>> 0; }
  fetchS8() { return (this.fetch() << 24) >> 24; }
  fetchImm(s) { return s === 1 ? this.fetch() : s === 2 ? this.fetchW() : this.fetchD(); }

  // ---------- ModR/M and SIB ----------
  modrm() {
    const m = this.fetch();
    this.mod = m >> 6; this.reg = (m >> 3) & 7; this.rm = m & 7; this.eaESP = false;
    if (this.mod !== 3) { if (this.a32) this.calcEA32(); else this.calcEA(); }
  }
  calcEA() {
    const R = this.r;
    let off, seg = DS;
    const bx = R[3] & 0xFFFF, bp = R[5] & 0xFFFF, si = R[6] & 0xFFFF, di = R[7] & 0xFFFF;
    switch (this.rm) {
      case 0: off = bx + si; break;
      case 1: off = bx + di; break;
      case 2: off = bp + si; seg = SS; break;
      case 3: off = bp + di; seg = SS; break;
      case 4: off = si; break;
      case 5: off = di; break;
      case 6: if (this.mod === 0) off = this.fetchW(); else { off = bp; seg = SS; } break;
      default: off = bx;
    }
    if (this.mod === 1) off += this.fetchS8();
    else if (this.mod === 2) off += this.fetchW();
    if (this.seg >= 0) seg = this.seg;
    this.eaOff = off & 0xFFFF; this.eaSeg = seg;
    if (this.trace) this.eaEvent();
  }
  calcEA32() {
    const R = this.r;
    let off, seg = DS;
    if (this.rm === 4) {
      const sib = this.fetch(), sc = sib >> 6, idx = (sib >> 3) & 7, base = sib & 7;
      if (base === 5 && this.mod === 0) off = this.fetchD();
      else { off = R[base]; if (base === 4 || base === 5) seg = SS; this.eaESP = base === 4; }
      if (idx !== 4) off += R[idx] * (1 << sc);
      else if (sc && !(base === 5 && this.mod === 0)) off *= 1 << sc;   // no index: the 80386 scales the base
      this.clk++;
    } else if (this.rm === 5 && this.mod === 0) off = this.fetchD();
    else { off = R[this.rm]; if (this.rm === 5) seg = SS; }
    if (this.mod === 1) off += this.fetchS8();
    else if (this.mod === 2) off += this.fetchD();
    if (this.seg >= 0) seg = this.seg;
    this.eaOff = off >>> 0; this.eaSeg = seg;
    if (this.trace) this.eaEvent();
  }
  eaEvent() {
    const s = this.eaSeg, lin = this.linear(s, this.eaOff);
    const pa = this.peekPhys(lin);
    this.ev.push({ k: 'ea', seg: P386_SREG[s], segv: this.sregs[s], off: this.eaOff, lin, phys: pa < 0 ? lin : pa });
  }
  eaNote(s, off) {
    if (!this.trace) return;
    const lin = this.linear(s, off), pa = this.peekPhys(lin);
    this.ev.push({ k: 'ea', seg: P386_SREG[s], segv: this.sregs[s], off, lin, phys: pa < 0 ? lin : pa });
  }
  // An address + k in the current address size.
  addA(o, k) { return this.a32 ? (o + k) >>> 0 : (o + k) & 0xFFFF; }
  getE(s) { return this.mod === 3 ? this.rget(this.rm, s) : this.rd(this.eaSeg, this.eaOff, s); }
  setE(s, v) { if (this.mod === 3) this.rset(this.rm, s, v); else this.wr(this.eaSeg, this.eaOff, s, v); }
  getG(s) { return this.rget(this.reg, s); }
  setG(s, v) { this.rset(this.reg, s, v); }
  rc(r, m) { this.clk += this.mod === 3 ? r : m; }
  memOnly() { if (this.mod === 3) throw this.fault(6); }
  // LOCK needs a memory destination (and one of the lockable instructions).
  lockCheck(ok) { if (this.lock && (this.mod === 3 || !ok)) throw this.fault(6); }

  // ---------- flags / ALU (s = operand size in bytes) ----------
  szpS(r, s) {
    let f = this.f & ~(F_SF | F_ZF | F_PF);
    if (!(r & P386_MASK[s])) f |= F_ZF;
    if (r & P386_SIGN[s]) f |= F_SF;
    if (PARITY[r & 0xFF]) f |= F_PF;
    this.f = f;
  }
  addS(a, b, c, s) {
    const m = P386_MASK[s], r = a + b + c;
    let f = this.f & ~(F_CF | F_AF | F_OF);
    if (r > m) f |= F_CF;
    if ((a ^ b ^ r) & 0x10) f |= F_AF;
    if ((a ^ r) & (b ^ r) & P386_SIGN[s]) f |= F_OF;
    this.f = f; this.szpS(r, s);
    return s === 4 ? r >>> 0 : r & m;
  }
  subS(a, b, c, s) {
    const m = P386_MASK[s], r = a - b - c;
    let f = this.f & ~(F_CF | F_AF | F_OF);
    if (r < 0) f |= F_CF;
    if ((a ^ b ^ r) & 0x10) f |= F_AF;
    if ((a ^ b) & (a ^ r) & P386_SIGN[s]) f |= F_OF;
    this.f = f; this.szpS(r, s);
    return s === 4 ? r >>> 0 : r & m;
  }
  logicS(r, s) { this.f &= ~(F_CF | F_AF | F_OF); r = s === 4 ? r >>> 0 : r & P386_MASK[s]; this.szpS(r, s); return r; }
  aluS(op, a, b, s) {
    let r;
    switch (op) {
      case 0: r = this.addS(a, b, 0, s); break;
      case 1: r = this.logicS(a | b, s); break;
      case 2: r = this.addS(a, b, this.f & F_CF, s); break;
      case 3: r = this.subS(a, b, this.f & F_CF, s); break;
      case 4: r = this.logicS(a & b, s); break;
      case 5: case 7: r = this.subS(a, b, 0, s); break;
      default: r = this.logicS(a ^ b, s);
    }
    if (this.trace) this.ev.push({ k: 'alu', op: ALU_OPS[op], a, b, r, w: s * 8 });
    return r;
  }
  aluNote(op, a, b, r, s) { if (this.trace) this.ev.push({ k: 'alu', op, a, b, r, w: s * 8 }); }

  // Shifts and rotates. The count is masked to 5 bits by the caller; n = 0 changes nothing.
  shiftS(op, v, n, s) {
    if (!n) return v;
    const bits = s * 8, m = P386_MASK[s], sb = P386_SIGN[s], a0 = v;
    let cf = this.f & F_CF, prev = v;
    for (let i = 0; i < n; i++) {
      prev = v;
      switch (op) {
        case 0: cf = (v & sb) ? 1 : 0; v = ((v << 1) | cf) & m; break;
        case 1: cf = v & 1; v = (v >>> 1) | (cf ? sb : 0); break;
        case 2: { const c = (v & sb) ? 1 : 0; v = ((v << 1) | cf) & m; cf = c; break; }
        case 3: { const c = v & 1; v = (v >>> 1) | (cf ? sb : 0); cf = c; break; }
        case 4: case 6: cf = (v & sb) ? 1 : 0; v = (v << 1) & m; break;
        case 5: cf = v & 1; v >>>= 1; break;
        default: cf = v & 1; v = (v >>> 1) | (v & sb); break;
      }
      if (s === 4) v >>>= 0;
    }
    // SHL / SHR of a byte or word with a count above the operand size (the result is 0): on
    // the 80386 CF is the last bit out only when the count is a multiple of the size, else 0.
    if (n > bits && (op === 4 || op === 5 || op === 6)) cf = n % bits ? 0 : op === 5 ? (a0 >>> (bits - 1)) & 1 : a0 & 1;
    let f = (this.f & ~(F_CF | F_OF)) | cf;
    if (op < 4) {
      // Rotates: OF = the sign change of the last step (ROL/RCL: MSB XOR CF).
      if (op === 0 || op === 2) { if (((v & sb) ? 1 : 0) ^ cf) f |= F_OF; }
      else if ((v ^ (v << 1)) & sb) f |= F_OF;
      this.f = f;
    } else {
      if (op === 4 || op === 6) { if (((v & sb) ? 1 : 0) ^ cf) f |= F_OF; }
      else if (op === 5) { if (n === 1 ? a0 & sb : 0) f |= F_OF; }
      this.f = f;
      this.szpS(v, s);
      this.f &= ~F_AF;
    }
    if (this.trace) this.ev.push({ k: 'alu', op: SHIFT_OPS[op === 6 ? 4 : op], a: a0, b: n, r: v, w: bits });
    return v;
  }

  // ---------- control transfer ----------
  // Near jump: the target is cut to 16 bits with a 16-bit operand size.
  jump(t, s) {
    t = (s || this.osz) === 2 ? t & 0xFFFF : t >>> 0;
    if (t > this.cache[CS].hi) throw this.fault(13, 0);
    this.ip = t; this.flush();
  }
  farJump(cs, ip) { this.farXfer(cs, ip, false, this.osz); }
  // JMP / CALL far to sel:off. s = operand size (the size of the pushed CS and EIP).
  farXfer(sel, off, call, s) {
    sel &= 0xFFFF;
    if (s === 2) off &= 0xFFFF;
    if ((this.cr[0] & 1) && !(this.f & P386_VM)) { this.farPM(sel, off, call, s); return; }
    // Real and virtual-8086 mode: the limit (FFFFh in V86) is checked before CS changes.
    if (off > ((this.f & P386_VM) ? 0xFFFF : this.cache[CS].hi)) throw this.fault(13, 0);
    if (call) { this.push(this.sregs[CS], s); this.push(this.ip, s); }
    if (this.f & P386_VM) this.loadSegV86(CS, sel); else this.loadSegReal(CS, sel);
    this.ip = off; this.flush();
    this.clk += call ? 17 : 12;
  }
  farPM(sel, off, call, s) {
    const retCS = this.sregs[CS], retIP = this.ip, cpl = this.cpl, rpl = sel & 3;
    if (!(sel & 0xFFFC)) throw this.fault(13, 0);
    const d = this.desc(sel, 13), a = d.access, dpl = (a >> 5) & 3;
    if (a & 0x10) {
      if (!(a & 8)) throw this.fsel(13, sel);
      if (a & 4) { if (dpl > cpl) throw this.fsel(13, sel); } else if (rpl > cpl || dpl !== cpl) throw this.fsel(13, sel);
      if (!(a & 0x80)) throw this.fsel(11, sel);
      if (off > d.limit) throw this.fault(13, 0);
      if (call) { this.push(retCS, s); this.push(retIP, s); }
      this.setCS(sel, d, cpl);
      this.ip = off; this.flush();
      this.clk += call ? 34 : 27;
      return;
    }
    switch (a & 0x1F) {
      case 4: case 0xC: this.callGate(sel, d, call, retCS, retIP); return;
      case 5: {                                   // task gate
        if (dpl < Math.max(cpl, rpl)) throw this.fsel(13, sel);
        if (!(a & 0x80)) throw this.fsel(11, sel);
        const ts = d.w1, td = this.tssDesc(ts);
        this.taskSwitch(ts, td, call ? 'call' : 'jmp', retIP);
        this.clk += 310;
        return;
      }
      case 1: case 9: {                           // available TSS
        if (dpl < Math.max(cpl, rpl)) throw this.fsel(13, sel);
        if (!(a & 0x80)) throw this.fsel(11, sel);
        this.taskSwitch(sel, d, call ? 'call' : 'jmp', retIP);
        this.clk += 300;
        return;
      }
      default: throw this.fsel(13, sel);
    }
  }
  // The TSS of a task gate: an available 286 or 386 TSS in the GDT.
  tssDesc(sel) {
    if (sel & 4) throw this.fsel(13, sel);
    const d = this.readDesc(sel);
    if (!d || ((d.access & 0x1F) !== 1 && (d.access & 0x1F) !== 9)) throw this.fsel(13, sel);
    if (!(d.access & 0x80)) throw this.fsel(11, sel);
    return d;
  }
  // Call gates: type 4 (286: 16-bit pushes, 16-bit offset) or 0Ch (386: 32-bit).
  callGate(gsel, g, call, retCS, retIP) {
    const cpl = this.cpl, a = g.access, gdpl = (a >> 5) & 3, g32 = (a & 8) !== 0, gs = g32 ? 4 : 2;
    if (gdpl < cpl || gdpl < (gsel & 3)) throw this.fsel(13, gsel);
    if (!(a & 0x80)) throw this.fsel(11, gsel);
    const tsel = g.w1, toff = g32 ? (g.w0 | (g.w3 << 16)) >>> 0 : g.w0, wc = g.w2 & 0x1F;
    if (!(tsel & 0xFFFC)) throw this.fault(13, 0);
    const d = this.desc(tsel, 13), ta = d.access, tdpl = (ta >> 5) & 3;
    if ((ta & 0x18) !== 0x18 || tdpl > cpl) throw this.fsel(13, tsel);
    if (!(ta & 0x80)) throw this.fsel(11, tsel);
    if (toff > d.limit) throw this.fault(13, 0);
    const conforming = (ta & 4) !== 0;
    if (!call) {
      if (!conforming && tdpl !== cpl) throw this.fsel(13, tsel);
      this.setCS(tsel, d, cpl); this.ip = toff; this.flush();
      this.clk += 45;
      return;
    }
    if (!conforming && tdpl < cpl) {
      // Call to an inner level: the new stack comes from the TSS; the gate copies wc
      // parameters (words for a 286 gate, dwords for a 386 gate).
      const [nsp, nss] = this.tssStack(tdpl);
      const sd = this.checkNewSS(nss, tdpl);
      this.stackRoom(sd, nsp, (4 + wc) * gs, nss);
      const params = [];
      for (let i = 0; i < wc; i++) params.push(this.peekStack(i * gs, gs));
      const oss = this.sregs[SS], osp = this.r[4];
      this.cpl = tdpl;
      this.setAccessed(sd);
      this.setCache(SS, nss, sd.base, sd.limit, sd.access, undefined, sd.flags);
      this.setSP(nsp);
      this.push(oss, gs); this.push(osp, gs);
      for (let i = wc - 1; i >= 0; i--) this.push(params[i], gs);
      this.push(retCS, gs); this.push(retIP, gs);
      this.setCS(tsel, d, tdpl);
      this.ip = toff; this.flush();
      this.clk += 86 + 4 * wc;
      if (this.trace) this.ev.push({ k: 'sys', op: 'CALLGATE', text: `${g32 ? '386' : '286'} call gate: CPL ${cpl} -> ${tdpl}, ${wc} parameter ${g32 ? 'dword' : 'word'}(s) copied` });
      return;
    }
    this.push(retCS, gs); this.push(retIP, gs);
    this.setCS(tsel, d, cpl); this.ip = toff; this.flush();
    this.clk += 52;
  }
  // SS:ESP for privilege level n from the current TSS (286 or 386 format).
  tssStack(n) {
    const t = this.tr;
    if (t.access & 8) {
      const off = 4 + 8 * n;
      if (off + 5 > t.limit) throw this.fsel(10, t.sel);
      return [this.rdSysD(t.base + off), this.rdSys(t.base + off + 4)];
    }
    const off = 2 + 4 * n;
    if (off + 3 > t.limit) throw this.fsel(10, t.sel);
    return [this.rdSys(t.base + off), this.rdSys(t.base + off + 2)];
  }
  checkNewSS(sel, ncpl) {
    if (!(sel & 0xFFFC)) throw this.fault(10, this.ext);
    const d = this.readDesc(sel);
    if (!d) throw this.fsel(10, sel);
    const a = d.access;
    if ((sel & 3) !== ncpl || ((a >> 5) & 3) !== ncpl || (a & 0x1A) !== 0x12) throw this.fsel(10, sel);
    if (!(a & 0x80)) throw this.fsel(12, sel);
    return d;
  }
  // #SS(sel) when n bytes do not fit below sp in the stack segment d.
  stackRoom(d, sp, n, sel) {
    const big = (d.flags & 4) !== 0, ed = (d.access & 0x1C) === 0x14, m = big ? 0xFFFFFFFF : 0xFFFF;
    const lo = ed ? d.limit + 1 : 0, hi = ed ? m : d.limit;
    let top = big ? sp >>> 0 : sp & 0xFFFF;
    if (top === 0) top = m + 1;                    // SP = 0: the pushes go to the top of the segment
    if (top - n < lo || top - 1 > hi) throw this.fsel(12, sel);
  }
  // Check the CS selector that RET far / IRET take from the stack.
  retCode(cs) {
    if (!(cs & 0xFFFC)) throw this.fault(13, 0);
    const d = this.desc(cs, 13), a = d.access, dpl = (a >> 5) & 3, rpl = cs & 3;
    if ((a & 0x18) !== 0x18 || rpl < this.cpl) throw this.fsel(13, cs);
    if (a & 4 ? dpl > rpl : dpl !== rpl) throw this.fsel(13, cs);
    if (!(a & 0x80)) throw this.fsel(11, cs);
    return d;
  }
  retSS(ss, rpl) {
    if (!(ss & 0xFFFC)) throw this.fault(13, 0);
    const d = this.desc(ss, 13), a = d.access;
    if ((ss & 3) !== rpl || ((a >> 5) & 3) !== rpl || (a & 0x1A) !== 0x12) throw this.fsel(13, ss);
    if (!(a & 0x80)) throw this.fsel(12, ss);
    return d;
  }
  // RET far (n = the bytes to release, RET imm16).
  retFar(n) {
    const s = this.osz;
    const ip = this.peekStack(0, s), cs = this.peekStack(s, s) & 0xFFFF;
    if (!(this.cr[0] & 1) || (this.f & P386_VM)) {
      if (ip > ((this.f & P386_VM) ? 0xFFFF : this.cache[CS].hi)) throw this.fault(13, 0);
      if (this.f & P386_VM) this.loadSegV86(CS, cs); else this.loadSegReal(CS, cs);
      this.setSP(this.getSP() + 2 * s + n);
      this.ip = ip; this.flush();
      this.clk += 18;
      return;
    }
    const d = this.retCode(cs), rpl = cs & 3;
    if (rpl === this.cpl) {
      if (ip > d.limit) throw this.fault(13, 0);
      this.setSP(this.getSP() + 2 * s + n);
      this.setCS(cs, d, rpl); this.ip = ip; this.flush();
      this.clk += 32;
      return;
    }
    const nsp = this.peekStack(2 * s + n, s), nss = this.peekStack(3 * s + n, s) & 0xFFFF;
    const sd = this.retSS(nss, rpl);
    if (ip > d.limit) throw this.fault(13, 0);
    const from = this.cpl;
    this.setCS(cs, d, rpl);
    this.setAccessed(sd);
    this.setCache(SS, nss, sd.base, sd.limit, sd.access, undefined, sd.flags);
    this.setSP(s === 2 ? (nsp + n) & 0xFFFF : nsp + n);
    this.ip = ip; this.flush();
    this.nullOuter();
    this.clk += 68;
    if (this.trace) this.ev.push({ k: 'sys', op: 'RETF', text: `return to an outer level: CPL ${from} -> ${rpl}` });
  }
  // POPF / IRET in protected mode: IOPL changes only at CPL 0, IF only when CPL <= IOPL.
  // VM does not change here (IRET to V86 mode is a separate path).
  setFlagsPM(v, cpl, s, rf) {
    let mask = 0x4DD5;
    if (cpl === 0) mask |= 0x3000;
    if (cpl <= this.iopl) mask |= 0x200;
    if (s === 4) mask |= this.xfl;
    if (s === 4 && rf) mask |= P386_RF;
    this.f = (this.f & ~mask) | (v & mask) | 2;
  }
  iret() {
    const s = this.osz;
    if (!(this.cr[0] & 1)) {
      const ip = this.peekStack(0, s), cs = this.peekStack(s, s) & 0xFFFF, fl = this.peekStack(2 * s, s);
      if (ip > this.cache[CS].hi) throw this.fault(13, 0);
      this.loadSegReal(CS, cs);
      this.setSP(this.getSP() + 3 * s);
      if (s === 4) this.f = (this.f & P386_VM) | (fl & (this.fmask & ~P386_VM)) | 2;
      else this.f = (this.f & 0xFFFF0000) | (fl & 0x7FD5) | 2;
      this.ip = ip; this.flush();
      this.keepRF = true;
      this.clk += 22;
      return;
    }
    if (this.f & P386_VM) {
      // Virtual-8086 mode: IRET works only with IOPL 3 (IOPL and VM do not change).
      if (this.iopl < 3) throw this.fault(13, 0);
      const ip = this.peekStack(0, s), cs = this.peekStack(s, s) & 0xFFFF, fl = this.peekStack(2 * s, s);
      if (ip > 0xFFFF) throw this.fault(13, 0);
      this.loadSegV86(CS, cs);
      this.setSP(this.getSP() + 3 * s);
      const mask = (s === 4 ? 0x14DD5 | this.xfl : 0x4DD5) | 0x200;
      this.f = (this.f & ~mask) | (fl & mask) | 2;
      this.ip = ip; this.flush();
      this.keepRF = true;
      this.clk += 22;
      return;
    }
    if (this.f & P386_NT) {
      // Return from a nested task: the back link in the current TSS.
      const link = this.rdSys(this.tr.base);
      if (link & 4) throw this.fsel(10, link);
      const d = this.readDesc(link);
      if (!d || ((d.access & 0x1F) !== 3 && (d.access & 0x1F) !== 0xB)) throw this.fsel(10, link);
      if (!(d.access & 0x80)) throw this.fsel(11, link);
      this.taskSwitch(link, d, 'iret', this.ip);
      this.keepRF = true;
      this.clk += 280;
      return;
    }
    const ip = this.peekStack(0, s), cs = this.peekStack(s, s) & 0xFFFF, fl = this.peekStack(2 * s, s);
    if (s === 4 && (fl & P386_VM) && this.cpl === 0) { this.iretV86(ip, cs, fl); return; }
    const d = this.retCode(cs), rpl = cs & 3, cpl = this.cpl;
    if (rpl === cpl) {
      if (ip > d.limit) throw this.fault(13, 0);
      this.setSP(this.getSP() + 3 * s);
      this.setFlagsPM(fl, cpl, s, true);
      this.setCS(cs, d, rpl); this.ip = ip; this.flush();
      this.keepRF = true;
      this.clk += 38;
      return;
    }
    const nsp = this.peekStack(3 * s, s), nss = this.peekStack(4 * s, s) & 0xFFFF;
    const sd = this.retSS(nss, rpl);
    if (ip > d.limit) throw this.fault(13, 0);
    this.setFlagsPM(fl, cpl, s, true);
    this.setCS(cs, d, rpl);
    this.setAccessed(sd);
    this.setCache(SS, nss, sd.base, sd.limit, sd.access, undefined, sd.flags);
    this.setSP(nsp);
    this.ip = ip; this.flush();
    this.nullOuter();
    this.keepRF = true;
    this.clk += 82;
    if (this.trace) this.ev.push({ k: 'sys', op: 'IRET', text: `return to an outer level: CPL ${cpl} -> ${rpl}` });
  }
  // IRETD at CPL 0 with VM = 1 in the EFLAGS image: back to virtual-8086 mode. The stack
  // holds EIP CS EFLAGS ESP SS ES DS FS GS (dwords).
  iretV86(ip, cs, fl) {
    const v = [];
    for (let i = 3; i < 9; i++) v.push(this.peekStack(4 * i, 4));
    const [nsp, nss, es, ds, fs, gs] = v;
    this.f = (fl & this.fmask) | 2;
    this.cpl = 3;
    this.loadSegV86(CS, cs); this.loadSegV86(SS, nss & 0xFFFF);
    this.loadSegV86(ES, es & 0xFFFF); this.loadSegV86(DS, ds & 0xFFFF);
    this.loadSegV86(P386_FS, fs & 0xFFFF); this.loadSegV86(P386_GS, gs & 0xFFFF);
    this.r[4] = nsp;
    this.ip = ip & 0xFFFF; this.flush();
    this.keepRF = true;
    this.clk += 60;
    if (this.trace) this.ev.push({ k: 'sys', op: 'IRET', text: 'return to virtual-8086 mode (VM = 1, CPL 3)' });
  }

  // ---------- task switch (286 TSS: 44 bytes, 386 TSS: 104 bytes) ----------
  // reason: 'jmp' | 'call' | 'int' | 'iret'. nextIP: EIP to save in the old TSS.
  taskSwitch(sel, d, reason, nextIP) {
    const R = this.r, old = this.tr, from = old.sel;
    const n386 = (d.access & 8) !== 0;
    if (d.limit < (n386 ? 103 : 43)) throw this.fsel(10, sel);
    // 1. Read the new state (a fault here changes nothing).
    const nb = d.base, nr = new Array(8), ns = [0, 0, 0, 0, 0, 0];
    let ip, nf, ldt, cr3 = -1, tbit = 0;
    if (n386) {
      cr3 = this.rdSysD(nb + 0x1C); ip = this.rdSysD(nb + 0x20); nf = this.rdSysD(nb + 0x24);
      for (let i = 0; i < 8; i++) nr[i] = this.rdSysD(nb + 0x28 + 4 * i);
      for (let i = 0; i < 6; i++) ns[i] = this.rdSys(nb + 0x48 + 4 * i);
      ldt = this.rdSys(nb + 0x60); tbit = this.rdSys(nb + 0x64) & 1;
    } else {
      ip = this.rdSys(nb + 14); nf = this.rdSys(nb + 16);
      // A 286 TSS has 16-bit registers; the high words become FFFFh (as Bochs does).
      for (let i = 0; i < 8; i++) nr[i] = 0xFFFF0000 | this.rdSys(nb + 18 + 2 * i);
      for (let i = 0; i < 4; i++) ns[i] = this.rdSys(nb + 34 + 2 * i);
      ldt = this.rdSys(nb + 42);
    }
    // 2. Save the state of the old task.
    const b = old.base;
    let fl = this.eflags;
    if (reason === 'iret') fl &= ~P386_NT;
    if (old.access & 8) {
      this.wrSysD(b + 0x20, nextIP); this.wrSysD(b + 0x24, fl);
      for (let i = 0; i < 8; i++) this.wrSysD(b + 0x28 + 4 * i, R[i]);
      for (let i = 0; i < 6; i++) this.wrSys(b + 0x48 + 4 * i, this.sregs[i]);
    } else {
      this.wrSys(b + 14, nextIP); this.wrSys(b + 16, fl);
      for (let i = 0; i < 8; i++) this.wrSys(b + 18 + 2 * i, R[i]);
      for (let i = 0; i < 4; i++) this.wrSys(b + 34 + 2 * i, this.sregs[i]);
    }
    // 3. Busy bits and the back link.
    const gdt = this.gdtr.base;
    if (reason === 'jmp' || reason === 'iret') {
      const ab = (gdt + (from & 0xFFF8) + 5) >>> 0;
      this.wrSysB(ab, this.rdSysB(ab) & ~2);
    }
    if (reason === 'call' || reason === 'int') this.wrSys(nb, from);
    if (reason !== 'iret') { d.access |= 2; this.wrSysB(d.addr + 5, d.access); }
    Object.assign(this.tr, { sel, base: d.base, limit: d.limit, access: d.access });
    this.cr[0] |= 8;
    // 4. Load the new state.
    if (cr3 >= 0 && this.paging && cr3 !== this.cr[3]) { this.cr[3] = cr3; this.flushTLB(); }
    else if (cr3 >= 0) this.cr[3] = cr3;
    for (let i = 0; i < 8; i++) R[i] = nr[i];
    this.f = n386 ? (nf & this.fmask) | 2 :(this.f & 0xFFFF0000 & ~P386_VM) | (nf & 0x7FD5) | 2;
    if (reason === 'call' || reason === 'int') this.f |= P386_NT;
    this.ip = n386 ? ip : ip & 0xFFFF;
    for (let i = 0; i < 6; i++) this.setNull(i, ns[i]);
    if (this.trace) this.ev.push({ k: 'task', from, to: sel, reason, tss: n386 ? 386 : 286 });
    // Faults from here on belong to the new task.
    this.lastIP = this.ip; this.lastCS = ns[CS]; this.spStart = R[4];
    if (tbit) this.pendingDB |= 0x8000;
    // 5. LDT, then the segment registers (errors give #TS).
    this.ldtr.sel = ldt; this.ldtr.valid = false;
    if (ldt & 0xFFFC) {
      if (ldt & 4) throw this.fsel(10, ldt);
      const ld = this.readDesc(ldt);
      if (!ld || (ld.access & 0x1F) !== 2 || !(ld.access & 0x80)) throw this.fsel(10, ldt);
      Object.assign(this.ldtr, { base: ld.base, limit: ld.limit, access: ld.access, valid: true });
    }
    if (this.f & P386_VM) {
      this.cpl = 3;
      for (let i = 0; i < 6; i++) this.loadSegV86(i, ns[i]);
      this.flush();
      return;
    }
    this.cpl = ns[CS] & 3;
    const cs = ns[CS];
    if (!(cs & 0xFFFC)) throw this.fault(10, this.ext);
    const cd = this.readDesc(cs);
    if (!cd) throw this.fsel(10, cs);
    const ca = cd.access, cdpl = (ca >> 5) & 3;
    if ((ca & 0x18) !== 0x18 || (ca & 4 ? cdpl > (cs & 3) : cdpl !== (cs & 3))) throw this.fsel(10, cs);
    if (!(ca & 0x80)) throw this.fsel(11, cs);
    this.setCS(cs, cd, cs & 3);
    const sd = this.checkNewSS(ns[SS], this.cpl);
    this.setAccessed(sd);
    this.setCache(SS, ns[SS], sd.base, sd.limit, sd.access, undefined, sd.flags);
    for (const i of [ES, DS, P386_FS, P386_GS]) {
      const sl = ns[i];
      if (!(sl & 0xFFFC)) continue;
      const dd = this.readDesc(sl);
      if (!dd) throw this.fsel(10, sl);
      const a = dd.access;
      if (!(a & 0x10) || (a & 0x0A) === 0x08) throw this.fsel(10, sl);
      if ((a & 0x0C) !== 0x0C && Math.max(this.cpl, sl & 3) > ((a >> 5) & 3)) throw this.fsel(10, sl);
      if (!(a & 0x80)) throw this.fsel(11, sl);
      this.setAccessed(dd);
      this.setCache(i, sl, dd.base, dd.limit, dd.access, undefined, dd.flags);
    }
    this.flush();
    if (this.ip > this.cache[CS].hi) throw this.fault(13, 0);
  }

  // ---------- interrupts and exceptions ----------
  // src: 'sw' (INT n, INT 3, INTO), 'irq', 'nmi', 'exc'. err: error code (-1 = none).
  intr(vec, src, err) {
    if (this.trace) {
      this.ev.push(src === 'exc' ? { k: 'int', vec, src, err: err >= 0 && (this.cr[0] & 1) ? err : undefined, name: P386_EXC[vec] || 'INT ' + vec }
        : { k: 'int', vec, src });
    }
    if (!(this.cr[0] & 1)) this.intReal(vec); else this.intPM(vec, src === 'sw', err);
    this.halted = false;
  }
  intReal(vec) {
    if (vec * 4 + 3 > this.idtr.limit) throw this.fault(13, 0);
    // The 80386 reads the vector before it pushes the frame (the frame can overwrite it).
    const a = this.idtr.base + vec * 4, ip = this.rdSys(a), cs = this.rdSys(a + 2);
    this.push(this.flags, 2); this.push(this.sregs[CS], 2); this.push(this.ip & 0xFFFF, 2);
    this.f &= ~(F_IF | F_TF | P386_RF | 0x40000);  // bit 18 (AC of the 80486) is 0 on the 80386
    this.loadSegReal(CS, cs);
    this.ip = ip; this.flush();
    this.clk += 37;
  }
  intPM(vec, soft, err) {
    const ext = soft ? 0 : 1;
    this.ext = ext;
    const verr = vec * 8 + 2 + ext;
    if (vec * 8 + 7 > this.idtr.limit) throw this.fault(13, verr);
    const ga = (this.idtr.base + vec * 8) >>> 0;
    const lo = this.rdSysD(ga), hi = this.rdSysD(ga + 4);
    const gsel = lo >>> 16, a = (hi >>> 8) & 0xFF, type = a & 0x1F;
    if (type !== 5 && type !== 6 && type !== 7 && type !== 0xE && type !== 0xF) throw this.fault(13, verr);
    if (soft && ((a >> 5) & 3) < this.cpl) throw this.fault(13, verr);
    if (!(a & 0x80)) throw this.fault(11, verr);
    if (type === 5) {
      const td = this.tssDesc(gsel);
      this.taskSwitch(gsel, td, 'int', this.ip);
      if (err >= 0) this.push(err, td.access & 8 ? 4 : 2);
      this.clk += 300;
      return;
    }
    const g32 = (type & 8) !== 0, gs = g32 ? 4 : 2;
    const goff = g32 ? ((lo & 0xFFFF) | (hi & 0xFFFF0000)) >>> 0 : lo & 0xFFFF;
    if (!(gsel & 0xFFFC)) throw this.fault(13, ext);
    const d = this.desc(gsel, 13), ca = d.access, dpl = (ca >> 5) & 3, cpl = this.cpl;
    if ((ca & 0x18) !== 0x18 || dpl > cpl) throw this.fsel(13, gsel);
    if (!(ca & 0x80)) throw this.fsel(11, gsel);
    if (goff > d.limit) throw this.fault(13, ext);
    const fl = this.eflags | (this.faultRF ? P386_RF : 0), ocs = this.sregs[CS], oip = this.ip;
    if (this.f & P386_VM) {
      // From virtual-8086 mode: only to a non-conforming DPL 0 segment. The frame also
      // holds GS FS DS ES; the four data segment registers become null.
      if ((ca & 4) || dpl !== 0) throw this.fsel(13, gsel);
      const [nsp, nss] = this.tssStack(0);
      const sd = this.checkNewSS(nss, 0);
      this.stackRoom(sd, nsp, (err >= 0 ? 10 : 9) * gs, nss);
      const oseg = [this.sregs[P386_GS], this.sregs[P386_FS], this.sregs[DS], this.sregs[ES]];
      const oss = this.sregs[SS], osp = this.r[4];
      this.f &= ~P386_VM;
      this.cpl = 0;
      this.setAccessed(sd);
      this.setCache(SS, nss, sd.base, sd.limit, sd.access, undefined, sd.flags);
      this.setSP(nsp);
      for (const v of oseg) this.push(v, gs);
      this.push(oss, gs); this.push(osp, gs);
      this.push(fl, gs); this.push(ocs, gs); this.push(oip, gs);
      if (err >= 0) this.push(err, gs);
      for (const i of [ES, DS, P386_FS, P386_GS]) this.setNull(i, 0);
      this.setCS(gsel, d, 0);
      this.clk += 119;
      if (this.trace) this.ev.push({ k: 'sys', op: 'V86INT', text: `interrupt ${vec} leaves virtual-8086 mode (CPL 3 -> 0)` });
    } else if (!(ca & 4) && dpl < cpl) {
      const [nsp, nss] = this.tssStack(dpl);
      const sd = this.checkNewSS(nss, dpl);
      this.stackRoom(sd, nsp, (err >= 0 ? 6 : 5) * gs, nss);
      const oss = this.sregs[SS], osp = this.r[4];
      this.cpl = dpl;
      this.setAccessed(sd);
      this.setCache(SS, nss, sd.base, sd.limit, sd.access, undefined, sd.flags);
      this.setSP(nsp);
      this.push(oss, gs); this.push(osp, gs);
      this.push(fl, gs); this.push(ocs, gs); this.push(oip, gs);
      if (err >= 0) this.push(err, gs);
      this.setCS(gsel, d, dpl);
      this.clk += 99;
    } else if ((ca & 4) || dpl === cpl) {
      this.push(fl, gs); this.push(ocs, gs); this.push(oip, gs);
      if (err >= 0) this.push(err, gs);
      this.setCS(gsel, d, cpl);
      this.clk += 59;
    } else throw this.fsel(13, gsel);
    this.f &= ~(F_TF | P386_NT | P386_RF | P386_VM);
    if (!(type & 1)) this.f &= ~F_IF;
    this.ip = goff; this.flush();
  }
  // A fault in the current instruction: restart address, then the handler (RF = 1 in the
  // pushed EFLAGS).
  raise(f) {
    this.r[4] = this.spStart;
    this.ip = this.lastIP;
    this.repState = null;
    this.faultRF = true;
    this.exception(f.vec, f.err);
    this.faultRF = false;
  }
  saveState() {
    return { esp: this.r[4], cpl: this.cpl, f: this.f, ss: Object.assign({}, this.cache[SS]), sss: this.sregs[SS] };
  }
  restoreState(st) {
    this.r[4] = st.esp; this.cpl = st.cpl; this.f = st.f;
    Object.assign(this.cache[SS], st.ss); this.sregs[SS] = st.sss;
  }
  // Start an exception handler. Two contributory exceptions, or #PF then a contributory
  // exception or #PF, give #DF; a fault during the start of #DF shuts the processor down.
  exception(vec, err) {
    for (;;) {
      const st = this.saveState();
      try { this.intr(vec, 'exc', err); this.ext = 0; return; } catch (e) {
        if (!(e instanceof Fault286)) throw e;
        this.restoreState(st);
        if (vec === 8) { this.shutdown(); return; }
        const c2 = P386_CONTRIB[e.vec] === 1;
        if ((P386_CONTRIB[vec] === 1 && c2) || (vec === 14 && (c2 || e.vec === 14))) { vec = 8; err = 0; } else { vec = e.vec; err = e.err; }
      }
    }
  }
  extInt(vec, src) {
    const st = this.saveState();
    try { this.intr(vec, src, -1); } catch (e) {
      if (!(e instanceof Fault286)) throw e;
      this.restoreState(st);
      this.exception(e.vec, e.err);
    }
    this.ext = 0;
  }

  // ---------- main step ----------
  step() {
    const tr = this.trace, bus = this.bus;
    this.clk = 0; this.nEU = 0; this.nStall = 0; this.didFlush = false; this.ilen = 0; this.ext = 0;
    this.tlbSeen = false; this.faultRF = false; this.keepRF = false;
    const ws = bus.waitStates;
    this.ws = ws === undefined ? 0 : ws; this.busLen = 2 + this.ws;
    if (!this.batch) this.syncIn();   // batch: Machine.run syncs at its start and end
    if (tr) {
      this.ev = []; this.euEv = []; this.stallEv = []; this.ibytes = [];
      this.snap = { r: this.r.slice(), s: this.sregs.slice(), ip: this.ip, f: this.eflags, cr0: this.cr[0], cr2: this.cr[2], cr3: this.cr[3] };
    }
    this.lastBase = this.cache[CS].base;
    this.decIP = this.ip; this.decCS = this.sregs[CS]; this.decBits = this.cache[CS].big ? 32 : 16;
    const trapBefore = (this.f & F_TF) !== 0 && !this.inhibit;

    // External interrupts are sampled between instructions and between REP iterations.
    if (!this.inhibit) {
      if (bus.nmiPending && bus.nmiPending()) {
        this.abortRep(); bus.ackNmi();
        this.lastIP = this.ip; this.lastCS = this.sregs[CS];
        this.halted = false; this.shutdownState = false;
        this.clk += 3; this.extInt(2, 'nmi');
        return this.finish('NMI');
      }
      if ((this.f & F_IF) && !this.shutdownState && bus.irqPending && bus.irqPending()) {
        this.abortRep();
        this.lastIP = this.ip; this.lastCS = this.sregs[CS];
        this.busEv('inta', 0, 0, 1, -1);
        const vec = bus.ackIrq() & 0xFF;
        this.busEv('inta', 0, vec, 1, -1);
        this.clk += 3; this.extInt(vec, 'irq');
        return this.finish('INTR ' + vec.toString(16).toUpperCase().padStart(2, '0') + 'h');
      }
    }
    this.inhibit = false;
    if (this.halted) { this.clk = 2; return this.finish(this.shutdownState ? 'shutdown' : 'hlt (halted)', true); }

    try {
      if (this.repState) {
        const rs = this.repState;
        this.decIP = rs.start;
        this.lastIP = rs.start; this.lastCS = this.sregs[CS]; this.spStart = this.r[4];
        this.seg = rs.seg; this.rep = rs.rep; this.osz = rs.osz; this.a32 = rs.a32; this.lock = false;
        this.stringOp(rs.op, false);
      } else {
        this.lastIP = this.ip; this.lastCS = this.sregs[CS]; this.spStart = this.r[4];
        if (this.dbgExec) {
          const hit = this.execBreak();
          if (hit) { this.dr[6] = (this.dr[6] & ~0xF) | hit; throw this.fault(1); }
        }
        this.seg = -1; this.rep = 0; this.lock = false;
        let op, opP = false, adP = false;
        for (;;) {
          op = this.fetch();
          if ((op & 0xE7) === 0x26) this.seg = (op >> 3) & 3;
          else if (op === 0x64 || op === 0x65) this.seg = op - 0x60;
          else if (op === 0x66) opP = true;
          else if (op === 0x67) adP = true;
          else if (op === 0xF2 || op === 0xF3) this.rep = op - 0xF1;
          else if (op === 0xF0) this.lock = true;
          else break;
        }
        const big = this.cache[CS].big;
        this.osz = big !== opP ? 4 : 2; this.a32 = big !== adP;
        this.opPfx = opP; this.adPfx = adP;
        if (this.lock && !P386_LOCK[op]) throw this.fault(6);
        this.op = op;
        this.exec(op);
        this.instructions++;
      }
      if (!this.keepRF) this.f &= ~P386_RF;
      let db = this.pendingDB;
      this.pendingDB = 0;
      if (trapBefore && !this.repState) db |= 0x4000;
      if (db) { this.dr[6] |= db; this.exception(1, -1); }
    } catch (e) {
      if (!(e instanceof Fault286)) throw e;
      this.pendingDB = 0;
      this.raise(e);
    }
    return this.finish(null, this.halted);
  }
  abortRep() {
    if (this.repState) {
      this.ip = this.repState.start;
      this.repState = null;
      this.flush();
    }
  }
  shutdown() {
    this.halted = true; this.shutdownState = true;
    this.busEv('halt', 0, 0, 0, -1);
    if (this.trace) this.ev.push({ k: 'sys', op: 'SHUTDOWN', text: 'triple fault: the processor shuts down' });
    if (this.bus.shutdown) this.bus.shutdown();
  }

  // Timeline: stall fetches, EU bus cycles over the instruction, prefetches in the free
  // bus slots (not after a queue flush).
  finish(text, halted) {
    if (!this.batch) this.syncOut();
    const BL = this.busLen, n = this.nEU, S = this.nStall * BL;
    const minT = S + n * BL;
    let T = this.clk + this.ws * n + S;
    if (T < minT) T = minT;
    if (T < 2) T = 2;
    const fpu = this.bus.fpu;
    if (fpu && fpu.busyCycles > 0) fpu.busyCycles = Math.max(0, fpu.busyCycles - T);
    const tr = this.trace;
    const canFetch = !halted && !this.didFlush;
    if (!tr) {
      if (canFetch) {
        let room = T - minT;
        while (room >= BL && this.q.length <= 14 && this.prefetch(false)) room -= BL;
      }
      this.cycles += T;
      return T;
    }
    const slack = T - minT, gap = Math.floor(slack / (n + 1));
    let pos = S, ei = 0, more = canFetch;
    const placed = [];
    for (let g = 0; g <= n; g++) {
      let room = g === n ? T - pos : gap;
      while (room >= BL && more && this.q.length <= 14) {
        const before = this.ev.length;
        if (!this.prefetch(false)) { more = false; break; }
        const e = this.ev.pop(); e.t = pos; placed.push(e); this.ev.length = before;
        pos += BL; room -= BL;
      }
      pos += room;
      if (g < n) {
        if (ei < this.euEv.length) { const e = this.euEv[ei++]; e.t = pos; placed.push(e); }
        pos += BL;
      }
    }
    while (ei < this.euEv.length) { const e = this.euEv[ei++]; e.t = Math.min(pos, T - 1); placed.push(e); }
    this.cycles += T;

    const out = [];
    const cs = this.decCS, ip = this.decIP, base = this.lastBase, bits = this.decBits;
    let dtext = text;
    if (!dtext) {
      if (typeof Disasm86 !== 'undefined') {
        const bus = this.bus, self = this;
        const rd = i => { const pa = self.peekPhys((base + ip + i) >>> 0); return pa < 0 ? 0 : bus.read8(pa); };
        try { dtext = Disasm86.decode(rd, ip, { cpu: '386', bits }).text; } catch (e) { dtext = 'op ' + (this.op | 0).toString(16); }
      } else dtext = 'op ' + (this.op | 0).toString(16);
      if (this.repStateText) dtext += this.repStateText;
    }
    out.push({ k: 'decode', t: 0, cs, ip, len: this.ibytes.length, text: dtext, bytes: this.ibytes.slice(), bits });
    this.stallEv.forEach((e, i) => { e.t = i * BL; out.push(e); });
    if (this.ibytes.length) out.push({ k: 'queue', t: S, op: 'pop', n: this.ibytes.length, q: this.q.slice() });
    const mid = S + Math.max(1, Math.floor((T - S) / 2));
    for (const e of this.ev) {
      if (e.k === 'ea') e.t = S + 1;
      else if (e.k === 'queue') e.t = T - 1;
      else e.t = e.t !== undefined ? e.t : mid;
      out.push(e);
    }
    for (const e of placed) out.push(e);
    const sn = this.snap;
    for (let i = 0; i < 8; i++) if (sn.r[i] !== this.r[i]) out.push({ k: 'reg', t: T - 1, r: P386_REG32[i], v: this.r[i] });
    for (let i = 0; i < 6; i++) if (sn.s[i] !== this.sregs[i]) out.push({ k: 'reg', t: T - 1, r: P386_SREG[i], v: this.sregs[i] });
    if (sn.f !== this.eflags) out.push({ k: 'flags', t: T - 1, v: this.eflags, old: sn.f });
    if (sn.cr0 !== this.cr[0]) out.push({ k: 'reg', t: T - 1, r: 'CR0', v: this.cr[0] });
    if (sn.cr2 !== this.cr[2]) out.push({ k: 'reg', t: T - 1, r: 'CR2', v: this.cr[2] });
    if (sn.cr3 !== this.cr[3]) out.push({ k: 'reg', t: T - 1, r: 'CR3', v: this.cr[3] });
    out.push({ k: 'reg', t: T - 1, r: 'EIP', v: this.ip });
    out.push({ k: 'iq', t: T - 1, n: Math.min(3, this.q.length >> 1) });
    out.push({ k: 'end', t: T });
    out.sort((a, b) => a.t - b.t);
    this.trace = out;
    this.repStateText = null;
    return T;
  }

  // ---------- instruction execution ----------
  sx(v, s) { return s === 4 ? v | 0 : s === 2 ? (v << 16) >> 16 : (v << 24) >> 24; }
  exec(op) { P386_OPS[op].call(this, op); }

  // PUSH / POP of a segment register.
  pushSeg(v) { this.push(v, this.osz); }
  popSeg(i) {
    const S = this.osz, big = this.cache[SS].big, v = this.peekStack(0, 2);   // a 32-bit POP reads 2 bytes
    const R = this.r, nsp = big ? (R[4] + S) >>> 0 : (R[4] & 0xFFFF0000) | ((R[4] + S) & 0xFFFF);
    this.loadSeg(i, v);
    R[4] = nsp;
    this.clk += (this.cr[0] & 1) && !(this.f & P386_VM) ? 21 : 7;
    if (i === SS) this.inhibit = true;
  }

  // Signed multiply with an s-byte result; CF = OF = the result does not fit.
  imulS(a, b, s) {
    const p = a * b;
    let lo, of;
    if (s === 4) { lo = Math.imul(a, b); of = p !== lo; lo >>>= 0; }
    else { lo = p & P386_MASK[s]; of = p !== this.sx(lo, s); }
    this.f = of ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
    this.szpS(lo, s); this.f &= ~F_AF;
    return lo;
  }

  shiftGroup(op) {
    const s = op & 1 ? this.osz : 1;
    this.modrm();
    const one = op === 0xD0 || op === 0xD1;
    const n = one ? 1 : (op >= 0xD2 ? this.r[1] & 0xFF : this.fetch()) & 0x1F;
    const v = this.getE(s);
    if (n) this.setE(s, this.shiftS(this.reg, v, n, s));
    this.rc(3, 7);
  }

  group3(s) {
    const R = this.r;
    this.modrm();
    const reg = this.reg, m = P386_MASK[s];
    this.lockCheck(reg === 2 || reg === 3);
    const v = this.getE(s);
    switch (reg) {
      case 0: case 1: {
        const b = this.fetchImm(s), r = this.logicS(v & b, s);
        this.aluNote('TEST', v, b, r, s); this.rc(2, 5); return;
      }
      case 2: { const r = s === 4 ? ~v >>> 0 : ~v & m; this.setE(s, r); this.aluNote('NOT', v, 0, r, s); this.rc(2, 6); return; }
      case 3: { const r = this.subS(0, v, 0, s); this.setE(s, r); this.aluNote('NEG', 0, v, r, s); this.rc(2, 6); return; }
      case 4: case 5: {
        const a0 = this.rget(0, s);
        let lo, hi, of;
        if (reg === 4) {
          if (s === 4) { [lo, hi] = this.mul32(R[0], v); R[0] = lo; R[2] = hi; }
          else if (s === 2) { const r = (R[0] & 0xFFFF) * v; lo = r & 0xFFFF; hi = Math.floor(r / 65536); this.rset(0, 2, lo); this.rset(2, 2, hi); }
          else { const r = (R[0] & 0xFF) * v; lo = r & 0xFF; hi = r >> 8; this.rset(0, 2, r); }
          of = hi !== 0;
        } else if (s === 4) {
          const p = BigInt(R[0] | 0) * BigInt(v | 0);
          lo = Number(BigInt.asUintN(32, p)); hi = Number(BigInt.asUintN(32, p >> 32n));
          R[0] = lo; R[2] = hi;
          of = p !== BigInt(lo | 0);
        } else {
          const p = this.sx(a0, s) * this.sx(v, s);
          lo = p & m; hi = (s === 2 ? p >> 16 : p >> 8) & m;
          if (s === 2) { this.rset(0, 2, lo); this.rset(2, 2, hi); } else this.rset(0, 2, p & 0xFFFF);
          of = p !== this.sx(lo, s);
        }
        this.f = of ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
        this.szpS(lo, s); this.f &= ~F_AF;
        this.aluNote(reg === 4 ? 'MUL' : 'IMUL', a0, v, lo, s);
        this.rc(s === 4 ? 38 : s === 2 ? 22 : 14, s === 4 ? 41 : s === 2 ? 25 : 17);
        return;
      }
      default: {                                     // DIV / IDIV
        const signed = reg === 7;
        this.rc(s === 4 ? 38 : s === 2 ? 22 : 14, s === 4 ? 41 : s === 2 ? 25 : 17);
        if (signed) this.clk += 5;
        if (v === 0) throw this.fault(0);
        let q, rem;
        if (s === 4) {
          const num = (BigInt(R[2]) << 32n) | BigInt(R[0]);
          if (!signed) {
            const bq = num / BigInt(v);
            if (bq > 0xFFFFFFFFn) throw this.fault(0);
            q = Number(bq); rem = Number(num % BigInt(v));
          } else {
            const sn = BigInt.asIntN(64, num), d = BigInt(v | 0), bq = sn / d;
            if (bq > 0x7FFFFFFFn || bq < -0x80000000n) throw this.fault(0);
            q = Number(bq); rem = Number(sn % d);
          }
          R[0] = q; R[2] = rem;
        } else if (!signed) {
          const num = s === 2 ? (R[2] & 0xFFFF) * 65536 + (R[0] & 0xFFFF) : R[0] & 0xFFFF;
          q = Math.floor(num / v); rem = num % v;
          if (q > m) throw this.fault(0);
          if (s === 2) { this.rset(0, 2, q); this.rset(2, 2, rem); } else this.rset(0, 2, q | (rem << 8));
        } else {
          const num = s === 2 ? ((R[2] & 0xFFFF) << 16) | (R[0] & 0xFFFF) : this.sx(R[0], 2);
          const d = this.sx(v, s);
          q = Math.trunc(num / d); rem = num - q * d;
          const lim = s === 2 ? 0x8000 : 0x80;
          if (q > lim - 1 || q < -lim) {
            // As on the 80286: with a negative result and |dividend| = lim * (|divisor| + lim) + r,
            // 0 <= r < |divisor|, there is no #DE; the quotient is -lim, the remainder r with
            // the sign of the dividend.
            const a = Math.abs(num), b = Math.abs(d), r = a - lim * (b + lim);
            if ((num < 0) === (d < 0) || r < 0 || r >= b) throw this.fault(0);
            q = -lim; rem = num < 0 ? -r : r;
          }
          if (s === 2) { this.rset(0, 2, q); this.rset(2, 2, rem); } else this.rset(0, 2, (q & 0xFF) | ((rem & 0xFF) << 8));
        }
        this.aluNote(signed ? 'IDIV' : 'DIV', 0, v, q & m, s);
      }
    }
  }
  // Unsigned 32 x 32 -> 64 bits: [low, high].
  mul32(a, b) {
    const al = a & 0xFFFF, ah = a >>> 16, bl = b & 0xFFFF, bh = b >>> 16;
    const ll = al * bl, lh = al * bh, hl = ah * bl, hh = ah * bh;
    const mid = (ll >>> 16) + (lh & 0xFFFF) + (hl & 0xFFFF);
    const lo = (((mid & 0xFFFF) << 16) | (ll & 0xFFFF)) >>> 0;
    const hi = (hh + (lh >>> 16) + (hl >>> 16) + Math.floor(mid / 65536)) >>> 0;
    return [lo, hi];
  }

  group45(op) {
    const S = this.osz, s = op & 1 ? S : 1;
    this.modrm();
    const reg = this.reg;
    if ((!(op & 1) && reg > 1) || reg === 7) throw this.fault(6);
    this.lockCheck(reg < 2);
    switch (reg) {
      case 0: case 1: {
        const v = this.getE(s), cf = this.f & F_CF;
        const r = reg === 0 ? this.addS(v, 1, 0, s) : this.subS(v, 1, 0, s);
        this.f = (this.f & ~F_CF) | cf;
        this.setE(s, r); this.aluNote(reg === 0 ? 'INC' : 'DEC', v, 1, r, s);
        this.rc(2, 6); return;
      }
      case 2: { const t = this.getE(S); this.push(this.ip, S); this.jump(t, S); this.rc(7, 10); return; }
      case 3: {
        this.memOnly();
        const off = this.rd(this.eaSeg, this.eaOff, S), sel = this.rd(this.eaSeg, this.addA(this.eaOff, S), 2);
        this.farXfer(sel, off, true, S); this.clk += 5; return;
      }
      case 4: this.jump(this.getE(S), S); this.rc(7, 10); return;
      case 5: {
        this.memOnly();
        const off = this.rd(this.eaSeg, this.eaOff, S), sel = this.rd(this.eaSeg, this.addA(this.eaOff, S), 2);
        this.farXfer(sel, off, false, S); this.clk += 5; return;
      }
      default: { const v = this.getE(S); this.push(v, S); this.rc(2, 5); }
    }
  }

  enter() {
    const R = this.r, S = this.osz, size = this.fetchW(), level = this.fetch() & 0x1F, big = this.cache[SS].big;
    this.push(R[5], S);
    const frame = this.getSP();
    if (level > 0) {
      let bp = big ? R[5] : R[5] & 0xFFFF;
      for (let i = 1; i < level; i++) {
        bp = big ? (bp - S) >>> 0 : (bp - S) & 0xFFFF;
        this.push(this.rd(SS, bp, S), S);
      }
      this.push(frame, S);
    }
    this.rset(5, S, frame);
    this.setSP(this.getSP() - size);
    this.clk += level === 0 ? 10 : level === 1 ? 12 : 15 + 4 * (level - 1);
  }

  // String instructions (address size: SI/DI/CX or ESI/EDI/ECX), one iteration per step()
  // when a REP prefix is active.
  stringOp(op, first) {
    const R = this.r, s = op & 1 ? this.osz : 1, a32 = this.a32;
    const d = (this.f & F_DF) ? -s : s;
    const src = this.seg >= 0 ? this.seg : DS, kind = op & 0xFE, rep = this.rep;
    if (rep && first) {
      this.clk += 5;
      if ((a32 ? R[1] : R[1] & 0xFFFF) === 0) { this.repState = null; return; }
    }
    const si = a32 ? R[6] : R[6] & 0xFFFF, di = a32 ? R[7] : R[7] & 0xFFFF;
    const adv = (i, v) => { if (a32) R[i] = v + d; else R[i] = (R[i] & 0xFFFF0000) | ((v + d) & 0xFFFF); };
    const m = P386_MASK[s];
    switch (kind) {
      case 0x6C: { const v = this.ioIn(R[2] & 0xFFFF, s); this.wr(ES, di, s, v); adv(7, di); this.clk += 15; break; }
      case 0x6E: { const v = this.rd(src, si, s); this.ioOut(R[2] & 0xFFFF, s, v); adv(6, si); this.clk += 14; break; }
      case 0xA4: { const v = this.rd(src, si, s); this.wr(ES, di, s, v); adv(6, si); adv(7, di); this.clk += rep ? 4 : 7; break; }
      case 0xA6: {
        const a = this.rd(src, si, s), b = this.rd(ES, di, s);
        const r = this.subS(a, b, 0, s); this.aluNote('CMP', a, b, r, s);
        adv(6, si); adv(7, di); this.clk += rep ? 9 : 10; break;
      }
      case 0xAA: this.wr(ES, di, s, this.rget(0, s)); adv(7, di); this.clk += rep ? 5 : 4; break;
      case 0xAC: this.rset(0, s, this.rd(src, si, s)); adv(6, si); this.clk += rep ? 5 : 5; break;
      case 0xAE: {
        const a = this.rget(0, s), b = this.rd(ES, di, s);
        const r = this.subS(a, b, 0, s); this.aluNote('CMP', a, b, r & m, s);
        adv(7, di); this.clk += rep ? 8 : 7; break;
      }
    }
    if (!rep) { this.repState = null; return; }
    const c = a32 ? (R[1] - 1) >>> 0 : (R[1] - 1) & 0xFFFF;
    if (a32) R[1] = c; else this.rset(1, 2, c);
    let more = c !== 0;
    if (more && (kind === 0xA6 || kind === 0xAE)) {
      const zf = (this.f & F_ZF) !== 0;
      more = rep === 2 ? zf : !zf;
    }
    if (more) {
      const start = this.repState ? this.repState.start : this.lastIP;
      this.repState = { op, seg: this.seg, rep, start, osz: this.osz, a32 };
      this.repStateText = `  ; ${a32 ? 'ECX' : 'CX'}=` + c.toString(16).toUpperCase().padStart(a32 ? 8 : 4, '0') + 'h';
    } else this.repState = null;
  }

  // ---------- BCD ----------
  daa386(sub) {
    const R = this.r, old = R[0] & 0xFF, ocf = this.f & F_CF;
    let al = old, f = this.f & ~(F_CF | F_AF);
    if ((old & 0x0F) > 9 || (this.f & F_AF)) {
      al = sub ? al - 6 : al + 6;
      if (al < 0 || al > 0xFF) f |= F_CF;
      f |= F_AF;
    }
    if (old > 0x99 || ocf) { al = sub ? al - 0x60 : al + 0x60; f |= F_CF; }
    al &= 0xFF;
    this.f = f;
    this.rset(0, 1, al); this.szpS(al, 1);
    if (sub ? (old & 0x80) && !(al & 0x80) : !(old & 0x80) && (al & 0x80)) this.f |= F_OF; else this.f &= ~F_OF;
    this.aluNote(sub ? 'DAS' : 'DAA', old, 0, al, 1);
    this.clk += 4;
  }
  aaa386(sub) {
    const R = this.r, old = R[0] & 0xFF;
    if ((old & 0x0F) > 9 || (this.f & F_AF)) {
      const ax = R[0] & 0xFFFF;
      this.rset(0, 2, sub ? ((ax - 6) & 0xFFFF) - 0x100 : ax + 0x106);
      this.f |= F_AF | F_CF;
    } else this.f &= ~(F_AF | F_CF);
    this.rset(0, 1, R[0] & 0x0F);
    this.szpS(old, 1);
    this.aluNote(sub ? 'AAS' : 'AAA', old, 0, R[0] & 0xFF, 1);
    this.clk += 4;
  }

  // ---------- 80387 interface ----------
  // The 386 sends the opcode and the pointers to the coprocessor ports (shown as 00F8h /
  // 00FCh) and moves the memory operand. With paging, or an operand that the FPU cannot
  // address with a 24-bit base and a 16-bit offset, a small map gives the FPU the physical
  // bytes.
  esc(op) {
    if (this.cr[0] & 0xC) throw this.fault(7);      // EM or TS: #NM
    this.modrm();
    const fpu = this.bus.fpu, mem = this.mod !== 3, bus = this.bus;
    const modrm = (this.mod << 6) | (this.reg << 3) | this.rm;
    const control = mem ? (op === 0xD9 || op === 0xDD) && this.reg >= 4
      : (op === 0xDB && modrm >= 0xE0 && modrm <= 0xE4) || (op === 0xDF && modrm === 0xE0);
    if (!control && this.fpuError && this.fpuError()) throw this.fault(16);
    let la = 0, n = 2;
    if (mem) {
      const info = fpu && fpu.memOperand ? fpu.memOperand(op, modrm) : null;
      n = info ? info.bytes : 2;
      if (info && info.write) this.wrCheck(this.eaSeg, this.eaOff, n); else this.rdCheck(this.eaSeg, this.eaOff, n);
      la = this.linear(this.eaSeg, this.eaOff);
    }
    this.fpuIO('iow', 0xF8, op | (modrm << 8));
    this.fpuIO('iow', 0xFC, this.lastIP);
    this.fpuIO('iow', 0xFC, this.lastCS);
    if (mem) { this.fpuIO('iow', 0xFC, this.eaOff); this.fpuIO('iow', 0xFC, this.sregs[this.eaSeg]); }
    this.clk += 9;
    if (!fpu) return;
    if (fpu.busyCycles > 0) { this.clk += fpu.busyCycles; fpu.busyCycles = 0; }
    let ea = null, map = null;
    if (mem) {
      if (!this.paging && this.eaOff + n <= 0x10000 && la + n <= 0x1000000) ea = { seg: this.sregs[this.eaSeg], off: this.eaOff, base: this.cache[this.eaSeg].base };
      else {
        const off16 = this.eaOff & 0xFFFF;
        ea = { seg: this.sregs[this.eaSeg], off: off16, base: 0 };
        map = a => { const l = (la + ((a - off16) & 0xFFFF)) >>> 0, p = this.peekPhys(l); return p < 0 ? l : p; };
      }
    }
    fpu.instrPtr = this.linear(CS, this.lastIP);
    fpu.nextIpOff = this.lastIP & 0xFFFF; fpu.nextIpSel = this.lastCS;
    let res;
    if (map) {
      const saved = fpu.mem;
      fpu.mem = { read8: a => bus.read8(map(a)), write8: (a, v) => bus.write8(map(a), v) };
      try { res = fpu.exec(op, modrm, ea) || { cycles: 0 }; } finally { fpu.mem = saved; }
    } else res = fpu.exec(op, modrm, ea) || { cycles: 0 };
    if (res.ax !== undefined) this.rset(0, 2, res.ax);
    const lm = fpu.lastMem;
    if (lm && lm.length) {
      for (let i = 0; i < lm.length; i += 2) {
        const m0 = lm[i], m1 = lm[i + 1] && lm[i + 1].write === m0.write ? lm[i + 1] : null;
        const v = m0.value | (m1 ? m1.value << 8 : 0), width = m1 ? 2 : 1, a = map ? map(m0.addr) : m0.addr;
        if (!m1) i--;
        if (m0.write) { this.fpuIO('ior', 0xFA, v); this.memEvFpu('memw', a, v, width); }
        else { this.memEvFpu('memr', a, v, width); this.fpuIO('iow', 0xFA, v); }
      }
    }
    if (this.trace) this.ev.push({ k: 'fpu', text: res.text || '', cycles: res.cycles || 0 });
  }

  // ---------- 0F: two-byte opcodes ----------
  priv0() { if ((this.cr[0] & 1) && this.cpl !== 0) throw this.fault(13, 0); }
  exec0F() { this.exec0Fop(this.fetch()); }
  // op2: the second opcode byte (a subclass can decode its own opcodes first).
  exec0Fop(op2) {
    const R = this.r, S = this.osz;
    const h4 = v => v.toString(16).toUpperCase().padStart(4, '0'), h8 = v => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const pm = (this.cr[0] & 1) === 1, v86 = (this.f & P386_VM) !== 0;
    if (this.lock && op2 !== 0xA3 && op2 !== 0xAB && op2 !== 0xB3 && op2 !== 0xBB && op2 !== 0xBA) throw this.fault(6);
    if (op2 >= 0x80 && op2 <= 0x8F) {                // Jcc rel16/32
      const d = S === 4 ? this.fetchD() | 0 : (this.fetchW() << 16) >> 16;
      if (this.cond(op2 & 15)) { this.jump(this.ip + d); this.clk += 7; } else this.clk += 3;
      return;
    }
    if (op2 >= 0x90 && op2 <= 0x9F) {                // SETcc r/m8
      this.modrm();
      this.setE(1, this.cond(op2 & 15) ? 1 : 0);
      this.rc(4, 5); return;
    }
    switch (op2) {
      case 0x00: {
        if (!pm || v86) throw this.fault(6);
        this.modrm();
        switch (this.reg) {
          case 0: if (this.mod === 3) this.rset(this.rm, S, this.ldtr.sel); else this.setE(2, this.ldtr.sel); this.rc(2, 2); return;
          case 1: if (this.mod === 3) this.rset(this.rm, S, this.tr.sel); else this.setE(2, this.tr.sel); this.rc(2, 2); return;
          case 2: { this.priv0(); const s = this.getE(2); this.lldt(s); this.rc(20, 24); this.sysEv('LLDT', `LDTR = ${h4(s)} (base ${h8(this.ldtr.base)}, limit ${h8(this.ldtr.limit)})`); return; }
          case 3: { this.priv0(); const s = this.getE(2); this.ltr(s); this.rc(23, 27); this.sysEv('LTR', `TR = ${h4(s)} (base ${h8(this.tr.base)}, limit ${h8(this.tr.limit)})`); return; }
          case 4: case 5: {
            const s = this.getE(2), ok = this.verify(s, this.reg === 5);
            this.f = ok ? this.f | F_ZF : this.f & ~F_ZF;
            this.rc(10, 11); this.sysEv(this.reg === 5 ? 'VERW' : 'VERR', `${h4(s)}: ZF = ${ok ? 1 : 0}`); return;
          }
          default: throw this.fault(6);
        }
      }
      case 0x01: this.modrm(); this.grp0F01(); return;
      case 0x02: case 0x03: {                          // LAR / LSL
        if (!pm || v86) throw this.fault(6);
        this.modrm();
        const s = this.getE(2), d = (s & 0xFFFC) ? this.readDesc(s) : null;
        let ok = false;
        if (d) {
          const a = d.access, dpl = (a >> 5) & 3, t = a & 0x1F;
          const priv = (a & 0x1C) === 0x1C || dpl >= Math.max(this.cpl, s & 3);
          const typeOk = (a & 0x10) ? true : op2 === 0x02 ? [1, 2, 3, 4, 5, 9, 0xB, 0xC].includes(t) : [1, 2, 3, 9, 0xB].includes(t);
          if (priv && typeOk) {
            const v = op2 === 0x02 ? ((a << 8) | (d.flags << 20)) >>> 0 : d.limit;
            this.setG(S, S === 4 ? v : v & 0xFFFF); ok = true;
          }
        }
        this.f = ok ? this.f | F_ZF : this.f & ~F_ZF;
        this.rc(15, 16);
        this.sysEv(op2 === 0x02 ? 'LAR' : 'LSL', `${h4(s)}: ZF = ${ok ? 1 : 0}`);
        return;
      }
      case 0x06:                                       // CLTS
        this.priv0(); if (v86) throw this.fault(13, 0);
        this.cr[0] &= ~8; this.clk += 5; this.sysEv('CLTS', 'CR0.TS = 0'); return;
      case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x26: {
        // MOV to / from CRn, DRn, TRn: always the register form (the mod bits are ignored).
        const m = this.fetch(), n = (m >> 3) & 7, rm = m & 7;
        if (pm && (v86 || this.cpl !== 0)) throw this.fault(13, 0);
        this.clk += 6;
        switch (op2) {
          case 0x20: if (n === 1 || n > 3) throw this.fault(6); R[rm] = this.cr[n]; return;
          case 0x22: {
            const v = R[rm];
            if (n === 0) this.setCR0(v);
            else if (n === 2) this.cr[2] = v;
            else if (n === 3) { this.cr[3] = v; this.flushTLB(); this.sysEv('CR3', `CR3 = ${h8(v)} (page directory; TLB flushed)`); }
            else throw this.fault(6);
            this.clk += 4; return;
          }
          case 0x21: { const k = n === 4 ? 6 : n === 5 ? 7 : n; R[rm] = this.dr[k]; return; }
          case 0x23: {
            const k = n === 4 ? 6 : n === 5 ? 7 : n, v = R[rm];
            if (k === 6) this.dr[6] = (v & 0xE00F) | 0xFFFF0FF0; else this.dr[k] = v;
            if (k === 7) this.updateDebug();
            this.clk += 16; return;
          }
          case 0x24: R[rm] = this.rdTR(n); return;
          default: this.wrTR(n, R[rm]); return;
        }
      }
      default: this.exec0Fmore(op2);
    }
  }
  // Test registers: TR6 and TR7 (the TLB test). The other numbers give #UD on the 80386.
  rdTR(n) { if (n < 6) throw this.fault(6); return n === 6 ? this.tr6 : this.tr7; }
  wrTR(n, v) {
    if (n < 6) throw this.fault(6);
    if (n === 6) { this.tr6 = v; this.tlbTest(); this.sysEv('TR6', `TLB test command ${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`); } else this.tr7 = v;
  }
  // 0F 01 /reg (after the ModR/M byte): SGDT SIDT LGDT LIDT SMSW LMSW.
  grp0F01() {
    const S = this.osz;
    const h4 = v => v.toString(16).toUpperCase().padStart(4, '0'), h8 = v => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const reg = this.reg;
    if (reg < 4) {
      this.memOnly();
      const t = reg & 1 ? this.idtr : this.gdtr, name = reg & 1 ? 'IDTR' : 'GDTR';
      const sg = this.eaSeg, o = this.eaOff;
      if (reg < 2) {                                 // SGDT / SIDT: limit and the 32-bit base
        this.wrCheck(sg, o, 6);
        this.wr(sg, o, 2, t.limit); this.wr(sg, this.addA(o, 2), 4, t.base);
        this.clk += 9;
        this.sysEv(reg & 1 ? 'SIDT' : 'SGDT', `store ${name}`);
      } else {                                       // LGDT / LIDT (a 16-bit operand size loads 24 base bits)
        this.priv0();
        const limit = this.rd(sg, o, 2), base = this.rd(sg, this.addA(o, 2), 4);
        t.limit = limit; t.base = S === 4 ? base : base & 0xFFFFFF;
        this.clk += 11;
        this.sysEv(reg & 1 ? 'LIDT' : 'LGDT', `${name} = base ${h8(t.base)}, limit ${h4(t.limit)}`);
      }
      return;
    }
    if (reg === 4) {                                 // SMSW
      if (this.mod === 3) this.rset(this.rm, S, S === 4 ? this.cr[0] : this.cr[0] & 0xFFFF); else this.setE(2, this.cr[0] & 0xFFFF);
      this.rc(2, 3); return;
    }
    if (reg === 6) {                                 // LMSW
      this.priv0();
      const v = this.getE(2);
      this.lmsw(v);
      this.rc(10, 13);
      this.sysEv('LMSW', `MSW = ${h4(this.cr[0] & 0xFFFF)}${this.cr[0] & 1 ? ' (protected mode)' : ''}`);
      return;
    }
    throw this.fault(6);
  }
  // The other two-byte opcodes of the 80386.
  exec0Fmore(op2) {
    const S = this.osz;
    const pm = (this.cr[0] & 1) === 1, v86 = (this.f & P386_VM) !== 0;
    switch (op2) {
      case 0xA0: case 0xA8: this.pushSeg(this.sregs[op2 === 0xA0 ? P386_FS : P386_GS]); this.clk += 2; return;
      case 0xA1: case 0xA9: this.popSeg(op2 === 0xA1 ? P386_FS : P386_GS); return;
      case 0xA3: this.bitOp(0, false); return;
      case 0xAB: this.bitOp(1, false); return;
      case 0xB3: this.bitOp(2, false); return;
      case 0xBB: this.bitOp(3, false); return;
      case 0xBA: this.bitOp(-1, true); return;       // BT/BTS/BTR/BTC r/m, imm8 (reg 4-7)
      case 0xA4: case 0xA5: this.shxd(false, op2 === 0xA5); return;
      case 0xAC: case 0xAD: this.shxd(true, op2 === 0xAD); return;
      case 0xAF: {                                     // IMUL r, r/m
        this.modrm();
        const r = this.imulS(this.sx(this.getG(S), S), this.sx(this.getE(S), S), S);
        this.setG(S, r);
        this.rc(12, 15); return;
      }
      case 0xB2: case 0xB4: case 0xB5: {               // LSS / LFS / LGS
        this.modrm(); this.memOnly();
        const off = this.rd(this.eaSeg, this.eaOff, S), sel = this.rd(this.eaSeg, this.addA(this.eaOff, S), 2);
        this.loadSeg(op2 === 0xB2 ? SS : op2 === 0xB4 ? P386_FS : P386_GS, sel);
        this.rset(this.reg, S, off);
        this.clk += pm && !v86 ? 25 : 7; return;
      }
      case 0xB6: case 0xB7: case 0xBE: case 0xBF: {   // MOVZX / MOVSX
        const ss = op2 & 1 ? 2 : 1;
        this.modrm();
        const v = this.getE(ss);
        this.setG(S, op2 >= 0xBE ? this.sx(v, ss) >>> 0 : v);
        this.rc(3, 6); return;
      }
      case 0xBC: case 0xBD: {                          // BSF / BSR
        this.modrm();
        const v = this.getE(S);
        if (!v) this.f |= F_ZF;
        else {
          this.f &= ~F_ZF;
          let i;
          if (op2 === 0xBC) { i = 0; while (!((v >>> i) & 1)) i++; } else i = 31 - Math.clz32(v);
          this.setG(S, i);
          this.clk += 3 * i;
        }
        this.rc(10, 10); return;
      }
      default: throw this.fault(6);
    }
  }
  sysEv(op, text) { if (this.trace) this.ev.push({ k: 'sys', op, text }); }
  setCR0(v) {
    v >>>= 0;
    if ((v & 0x80000000) && !(v & 1)) throw this.fault(13, 0);
    const old = this.cr[0];
    this.cr[0] = ((v & 0x8000001F) | 0x7FFFFFE0) >>> 0;
    this.modeChange(old);
    const h8 = x => (x >>> 0).toString(16).toUpperCase().padStart(8, '0');
    this.sysEv('CR0', `CR0 = ${h8(this.cr[0])}${v & 1 ? ' (protected mode)' : ''}${v & 0x80000000 ? ' (paging)' : ''}`);
  }
  modeChange(old) {
    const c0 = this.cr[0];
    if ((old ^ c0) & 1) { for (const d of this.cache) this.calcCache(d); if (!(c0 & 1)) this.cpl = 0; }
    this.paging = (c0 & 0x80000000) !== 0;
    if ((old ^ c0) & 0x80000000) this.flushTLB();
  }
  lmsw(v) {
    const old = this.cr[0], pe = (old | v) & 1;       // LMSW cannot clear PE
    this.cr[0] = ((old & ~0xF) | (v & 0xE) | pe) >>> 0;
    this.modeChange(old);
  }
  lldt(sel) {
    const L = this.ldtr;
    if (!(sel & 0xFFFC)) { L.sel = sel; L.valid = false; L.base = 0; L.limit = 0; return; }
    if (sel & 4) throw this.fsel(13, sel);
    const d = this.desc(sel, 13);
    if ((d.access & 0x1F) !== 2) throw this.fsel(13, sel);
    if (!(d.access & 0x80)) throw this.fsel(11, sel);
    Object.assign(L, { sel, base: d.base, limit: d.limit, access: d.access, valid: true });
  }
  ltr(sel) {
    if (!(sel & 0xFFFC)) throw this.fault(13, 0);
    if (sel & 4) throw this.fsel(13, sel);
    const d = this.desc(sel, 13);
    if ((d.access & 0x1F) !== 1 && (d.access & 0x1F) !== 9) throw this.fsel(13, sel);
    if (!(d.access & 0x80)) throw this.fsel(11, sel);
    d.access |= 2; this.wrSysB(d.addr + 5, d.access);
    Object.assign(this.tr, { sel, base: d.base, limit: d.limit, access: d.access });
  }

  // BT / BTS / BTR / BTC (kind 0-3). A register bit offset can address memory outside the
  // operand (signed offset / operand bits); the immediate form (0F BA) uses offset mod size.
  bitOp(kind, imm) {
    const S = this.osz, bits = S * 8;
    this.modrm();
    if (imm) { if (this.reg < 4) throw this.fault(6); kind = this.reg - 4; }
    this.lockCheck(kind > 0);                        // LOCK BT gives #UD on the chip (the manual lists BT)
    const off = imm ? this.fetch() : this.getG(S);
    let v, bit, o = this.eaOff;
    if (this.mod === 3 || imm) bit = off & (bits - 1);
    else {
      const so = this.sx(off, S), k = Math.floor(so / bits);
      bit = so - k * bits;
      o = this.a32 ? (o + k * S) >>> 0 : (o + k * S) & 0xFFFF;
      if (this.trace) this.eaNote(this.eaSeg, o);
    }
    v = this.mod === 3 ? this.rget(this.rm, S) : this.rd(this.eaSeg, o, S);
    const cf = (v >>> bit) & 1, mask = bit === 31 ? 0x80000000 : 1 << bit;
    this.f = (this.f & ~F_CF) | cf;
    if (kind) {
      const r = (kind === 1 ? v | mask : kind === 2 ? v & ~mask : v ^ mask) >>> 0;
      if (this.mod === 3) this.rset(this.rm, S, r); else this.wr(this.eaSeg, o, S, r);
    }
    this.aluNote(['BT', 'BTS', 'BTR', 'BTC'][kind], v, bit, cf, S);
    this.rc(kind ? 6 : 3, kind ? 13 : 12);
  }
  // SHLD / SHRD r/m, r, imm8 or CL (the count is masked to 5 bits).
  shxd(right, useCL) {
    const S = this.osz, bits = S * 8;
    this.modrm();
    const n = (useCL ? this.r[1] : this.fetch()) & 31;
    const dst = this.getE(S), src = this.getG(S);
    if (!n) { this.rc(3, 7); return; }
    let r, cf;
    if (S === 4) {
      if (right) { r = ((dst >>> n) | (src << (32 - n))) >>> 0; cf = (dst >>> (n - 1)) & 1; }
      else { r = ((dst << n) | (src >>> (32 - n))) >>> 0; cf = (dst >>> (32 - n)) & 1; }
    } else {
      // 16-bit: the 80386 shifts the 48-bit value dst:src:src (SHLD) or src:src:dst (SHRD),
      // so a count above 16 gives a rotate of src.
      const x = right ? (BigInt(src) << 32n) | (BigInt(src) << 16n) | BigInt(dst) : (BigInt(dst) << 32n) | (BigInt(src) << 16n) | BigInt(src);
      const k = BigInt(n);
      if (right) { r = Number((x >> k) & 0xFFFFn); cf = Number((x >> (k - 1n)) & 1n); }
      else { r = Number((x >> (32n - k)) & 0xFFFFn); cf = Number((x >> (48n - k)) & 1n); }
    }
    const sb = P386_SIGN[S];
    let f = (this.f & ~(F_CF | F_OF)) | cf;
    if ((dst ^ r) & sb) f |= F_OF;
    this.f = f;
    this.szpS(r, S);
    this.setE(S, r);
    this.aluNote(right ? 'SHRD' : 'SHLD', dst, n, r, S);
    this.rc(3, 7);
  }
}
// The EFLAGS bits of the 80386 (see the flags getters). CPU80486 sets its own values.
CPU80386.prototype.fmask = P386_FMASK;
CPU80386.prototype.xfl = 0;

// The one-byte opcodes of the 80386: one small function for each opcode group, in the table
// P386_OPS (exec calls it with this = the CPU). V8 optimizes each small function alone; one
// large switch became slow after the BIOS ran (see "Speed of the run loop" in ARCHITECTURE.md).
function P386_OP_00_etc(op) {   // 00h-3Dh (48)
  const S = this.osz;
    const alu = op >> 3, form = op & 7, s = op & 1 ? S : 1;
    if (form < 4) {
      this.modrm();
      if (form < 2) {
        this.lockCheck(true);
        const a = this.getE(s), r = this.aluS(alu, a, this.getG(s), s);
        if (alu !== 7) this.setE(s, r);
        this.rc(2, alu === 7 ? 5 : 7);
      } else {
        const r = this.aluS(alu, this.getG(s), this.getE(s), s);
        if (alu !== 7) this.setG(s, r);
        this.rc(2, 6);
      }
    } else {
      const b = this.fetchImm(s), r = this.aluS(alu, this.rget(0, s), b, s);
      if (alu !== 7) this.rset(0, s, r);
      this.clk += 2;
    }
    return;
}
function P386_OP_40_etc(op) {   // 40h-4Fh (16)
  const S = this.osz;
    const i = op & 7, v = this.rget(i, S), cf = this.f & F_CF;
    const r = op < 0x48 ? this.addS(v, 1, 0, S) : this.subS(v, 1, 0, S);
    this.f = (this.f & ~F_CF) | cf;
    this.rset(i, S, r);
    this.aluNote(op < 0x48 ? 'INC' : 'DEC', v, 1, r, S);
    this.clk += 2;
    return;
}
function P386_OP_50_etc(op) {   // 50h, 51h, 52h, 53h, 54h, 55h, 56h, 57h
  const S = this.osz;
    this.push(this.rget(op & 7, S), S); this.clk += 2; return;  // PUSH ESP pushes the old ESP
}
function P386_OP_58_etc(op) {   // 58h, 59h, 5Ah, 5Bh, 5Ch, 5Dh, 5Eh, 5Fh
  const S = this.osz;
    const v = this.pop(S); this.rset(op & 7, S, v); this.clk += 4; return;
}
function P386_OP_70_etc(op) {   // 70h-7Fh (16)
    const d = this.fetchS8();
    if (this.cond(op & 15)) { this.jump(this.ip + d); this.clk += 7; } else this.clk += 3;
    return;
}
function P386_OP_91_etc(op) {   // 91h, 92h, 93h, 94h, 95h, 96h, 97h
  const S = this.osz;
    const i = op & 7, t = this.rget(0, S);
    this.rset(0, S, this.rget(i, S)); this.rset(i, S, t); this.clk += 3; return;
}
function P386_OP_B0_etc(op) {   // B0h-BFh (16)
  const S = this.osz;
    if (op & 8) this.rset(op & 7, S, this.fetchImm(S)); else this.rset(op & 7, 1, this.fetch());
    this.clk += 2; return;
}
function P386_OP_D8_etc(op) {   // D8h, D9h, DAh, DBh, DCh, DDh, DEh, DFh
    this.esc(op); return;
}
function P386_OP_06_etc(op) {   // 06h, 0Eh, 16h, 1Eh
    this.pushSeg(this.sregs[op >> 3]); this.clk += 2; return;
}
function P386_OP_07_etc(op) {   // 07h, 17h, 1Fh
    this.popSeg(op >> 3); return;
}
function P386_OP_0F(op) {   // 0Fh
    this.exec0F(); return;
}
function P386_OP_27(op) {   // 27h
    this.daa386(false); return;
}
function P386_OP_2F(op) {   // 2Fh
    this.daa386(true); return;
}
function P386_OP_37(op) {   // 37h
    this.aaa386(false); return;
}
function P386_OP_3F(op) {   // 3Fh
    this.aaa386(true); return;
}
function P386_OP_60(op) {   // 60h
  const R = this.r, S = this.osz;
    {                                   // PUSHA / PUSHAD
      // The 80386 writes from the lowest address up (EDI first); a fault keeps the writes.
      const low = this.stackOff(-8 * S);
      for (let k = 0; k < 8; k++) this.wr(SS, this.cache[SS].big ? (low + k * S) >>> 0 : (low + k * S) & 0xFFFF, S, R[7 - k]);
      this.setSP(low);
      this.clk += 18; return;
    }
}
function P386_OP_61(op) {   // 61h
  const R = this.r, S = this.osz;
    {                                   // POPA / POPAD
      // One register at a time (DI first); a fault keeps the registers loaded before it.
      const v = [];
      for (let i = 0; i < 8; i++) { v.push(this.peekStack(i * S, S)); if (7 - i !== 4) this.rset(7 - i, S, v[i]); }
      this.setSP(this.getSP() + 8 * S);
      // POPAD with a 16-bit stack: the 80386 loads bits 16-31 of ESP from the ESP image.
      if (S === 4 && !this.cache[SS].big) R[4] = (v[3] & 0xFFFF0000) | (R[4] & 0xFFFF);
      this.clk += 24; return;
    }
}
function P386_OP_62(op) {   // 62h
  const S = this.osz;
    {                                   // BOUND
      this.modrm(); this.memOnly();
      const lo = this.sx(this.rd(this.eaSeg, this.eaOff, S), S), hi = this.sx(this.rd(this.eaSeg, this.addA(this.eaOff, S), S), S);
      const v = this.sx(this.rget(this.reg, S), S);
      this.clk += 10;
      if (v < lo || v > hi) throw this.fault(5);
      return;
    }
}
function P386_OP_63(op) {   // 63h
    {                                   // ARPL (protected mode only)
      if (!(this.cr[0] & 1) || (this.f & P386_VM)) throw this.fault(6);
      this.modrm();
      const dst = this.getE(2), src = this.getG(2);
      if ((dst & 3) < (src & 3)) { this.setE(2, (dst & ~3) | (src & 3)); this.f |= F_ZF; } else this.f &= ~F_ZF;
      this.rc(20, 21); return;
    }
}
function P386_OP_68(op) {   // 68h
  const S = this.osz;
    this.push(this.fetchImm(S), S); this.clk += 2; return;
}
function P386_OP_6A(op) {   // 6Ah
  const S = this.osz;
    this.push(this.fetchS8(), S); this.clk += 2; return;
}
function P386_OP_69_etc(op) {   // 69h, 6Bh
  const S = this.osz;
    {                        // IMUL r, r/m, imm
      this.modrm();
      const a = this.sx(this.getE(S), S);
      const b = op === 0x69 ? this.sx(this.fetchImm(S), S) : this.fetchS8();
      const r = this.imulS(a, b, S);
      this.setG(S, r);
      this.aluNote('IMUL', a >>> 0, b >>> 0, r, S);
      this.rc(12, 15); return;
    }
}
function P386_OP_6C_etc(op) {   // 6Ch, 6Dh, 6Eh, 6Fh
  const R = this.r, S = this.osz;
      this.ioPerm(R[2] & 0xFFFF, op & 1 ? S : 1); this.stringOp(op, true); return;
}
function P386_OP_80_etc(op) {   // 80h, 81h, 82h, 83h
  const S = this.osz;
    {
      const s = op & 1 ? S : 1;
      this.modrm();
      this.lockCheck(this.reg !== 7);
      const a = this.getE(s);
      const b = op === 0x81 ? this.fetchImm(S) : op === 0x83 ? this.fetchS8() & P386_MASK[s] : this.fetch();
      const r = this.aluS(this.reg, a, s === 4 ? b >>> 0 : b, s);
      if (this.reg !== 7) this.setE(s, r);
      this.rc(2, this.reg === 7 ? 5 : 7);
      return;
    }
}
function P386_OP_84_etc(op) {   // 84h, 85h
  const S = this.osz;
    {
      const s = op & 1 ? S : 1; this.modrm();
      const g = this.getG(s), r = this.logicS(this.getE(s) & g, s);
      this.aluNote('TEST', g, r, r, s);
      this.rc(2, 5); return;
    }
}
function P386_OP_86_etc(op) {   // 86h, 87h
  const S = this.osz;
    {
      const s = op & 1 ? S : 1; this.modrm();
      this.lockCheck(true);
      const a = this.getE(s), b = this.getG(s);
      this.setE(s, b); this.setG(s, a);
      this.rc(3, 5); return;
    }
}
function P386_OP_88_etc(op) {   // 88h, 89h
  const S = this.osz;
    { const s = op & 1 ? S : 1; this.modrm(); this.setE(s, this.getG(s)); this.rc(2, 2); return; }
}
function P386_OP_8A_etc(op) {   // 8Ah, 8Bh
  const S = this.osz;
    { const s = op & 1 ? S : 1; this.modrm(); this.setG(s, this.getE(s)); this.rc(2, 4); return; }
}
function P386_OP_8C(op) {   // 8Ch
  const S = this.osz;
    {                                   // MOV r/m, Sreg
      this.modrm();
      if (this.reg > 5) throw this.fault(6);
      const v = this.sregs[this.reg];
      if (this.mod === 3) this.rset(this.rm, S, v); else this.wr(this.eaSeg, this.eaOff, 2, v);
      this.rc(2, 2); return;
    }
}
function P386_OP_8D(op) {   // 8Dh
  const S = this.osz;
    this.modrm(); this.memOnly(); this.rset(this.reg, S, this.eaOff); this.clk += 2; return;
}
function P386_OP_8E(op) {   // 8Eh
    {                                   // MOV Sreg, r/m
      this.modrm();
      const i = this.reg;
      if (i === CS || i > 5) throw this.fault(6);
      this.loadSeg(i, this.getE(2));
      if ((this.cr[0] & 1) && !(this.f & P386_VM)) this.rc(18, 19); else this.rc(2, 5);
      if (i === SS) this.inhibit = true;
      return;
    }
}
function P386_OP_8F(op) {   // 8Fh
  const S = this.osz;
    {                                   // POP r/m
      this.modrm();
      if (this.reg !== 0) throw this.fault(6);
      const v = this.pop(S);                       // a fault in the store restores ESP
      if (this.mod !== 3 && this.eaESP) { this.eaOff = (this.eaOff + S) >>> 0; if (this.trace) this.eaEvent(); }
      this.setE(S, v); this.rc(4, 5); return;
    }
}
function P386_OP_90(op) {   // 90h
    this.clk += 3; return;
}
function P386_OP_98(op) {   // 98h
  const R = this.r, S = this.osz;
      if (S === 4) R[0] = (R[0] << 16) >> 16; else this.rset(0, 2, (R[0] << 24) >> 24);
      this.clk += 3; return;
}
function P386_OP_99(op) {   // 99h
  const R = this.r, S = this.osz;
      if (S === 4) R[2] = R[0] & 0x80000000 ? 0xFFFFFFFF : 0; else this.rset(2, 2, R[0] & 0x8000 ? 0xFFFF : 0);
      this.clk += 2; return;
}
function P386_OP_9A(op) {   // 9Ah
  const S = this.osz;
    { const off = this.fetchImm(S), sel = this.fetchW(); this.farXfer(sel, off, true, S); return; }
}
function P386_OP_9B(op) {   // 9Bh
    {                                   // WAIT: #NM when MP and TS are 1
      if ((this.cr[0] & 0xA) === 0xA) throw this.fault(7);
      if (this.fpuError && this.fpuError()) throw this.fault(16);
      const fpu = this.bus.fpu, busy = fpu ? fpu.busyCycles : 0;
      this.clk += 6 + busy;
      if (fpu) fpu.busyCycles = 0;
      return;
    }
}
function P386_OP_9C(op) {   // 9Ch
  const S = this.osz;
    // PUSHFD: VM and RF read 0
      this.v86Check(); this.push(S === 4 ? (this.f & (0x7FD5 | this.xfl)) | 2 : this.flags, S); this.clk += 4; return;
}
function P386_OP_9D(op) {   // 9Dh
  const S = this.osz;
    {
      this.v86Check();
      const v = this.pop(S);
      if (!(this.cr[0] & 1)) this.f = S === 4 ? (this.f & P386_VM) | (v & (0x7FD5 | this.xfl)) | 2 : (this.f & 0xFFFF0000) | (v & 0x7FD5) | 2;
      else this.setFlagsPM(v, this.cpl, S, false);
      this.clk += 5; return;
    }
}
function P386_OP_9E(op) {   // 9Eh
  const R = this.r;
    this.f = (this.f & ~0xD5) | ((R[0] >>> 8) & 0xD5); this.clk += 3; return;
}
function P386_OP_9F(op) {   // 9Fh
    this.rset(4, 1, this.flags & 0xFF); this.clk += 2; return;
}
function P386_OP_A0_etc(op) {   // A0h, A1h, A2h, A3h
  const S = this.osz;
    {
      const off = this.a32 ? this.fetchD() : this.fetchW(), sg = this.seg >= 0 ? this.seg : DS, s = op & 1 ? S : 1;
      this.eaNote(sg, off);
      if (op < 0xA2) this.rset(0, s, this.rd(sg, off, s)); else this.wr(sg, off, s, this.rget(0, s));
      this.clk += 4; return;
    }
}
function P386_OP_A4_etc(op) {   // A4h-AFh (10)
      this.stringOp(op, true); return;
}
function P386_OP_A8_etc(op) {   // A8h, A9h
  const S = this.osz;
    {
      const s = op & 1 ? S : 1, b = this.fetchImm(s), a = this.rget(0, s), r = this.logicS(a & b, s);
      this.aluNote('TEST', a, b, r, s); this.clk += 2; return;
    }
}
function P386_OP_C0_etc(op) {   // C0h, C1h, D0h, D1h, D2h, D3h
    this.shiftGroup(op); return;
}
function P386_OP_C2(op) {   // C2h
  const S = this.osz;
    { const n = this.fetchW(), ip = this.pop(S); this.jump(ip, S); this.setSP(this.getSP() + n); this.clk += 10; return; }
}
function P386_OP_C3(op) {   // C3h
  const S = this.osz;
    { const ip = this.pop(S); this.jump(ip, S); this.clk += 10; return; }
}
function P386_OP_C4_etc(op) {   // C4h, C5h
  const S = this.osz;
    {                        // LES / LDS
      this.modrm(); this.memOnly();
      const off = this.rd(this.eaSeg, this.eaOff, S), sel = this.rd(this.eaSeg, this.addA(this.eaOff, S), 2);
      this.loadSeg(op === 0xC4 ? ES : DS, sel);
      this.rset(this.reg, S, off);
      this.clk += (this.cr[0] & 1) && !(this.f & P386_VM) ? 22 : 7; return;
    }
}
function P386_OP_C6_etc(op) {   // C6h, C7h
  const S = this.osz;
    {
      const s = op & 1 ? S : 1;
      this.modrm();
      if (this.reg !== 0) throw this.fault(6);
      this.setE(s, this.fetchImm(s));
      this.rc(2, 2); return;
    }
}
function P386_OP_C8(op) {   // C8h
    this.enter(); return;
}
function P386_OP_C9(op) {   // C9h
  const R = this.r, S = this.osz;
    {                                   // LEAVE
      if (this.cache[SS].big) R[4] = R[5]; else this.rset(4, 2, R[5]);
      const v = this.pop(S);
      this.rset(5, S, v);
      this.clk += 4; return;
    }
}
function P386_OP_CA(op) {   // CAh
    this.retFar(this.fetchW()); return;
}
function P386_OP_CB(op) {   // CBh
    this.retFar(0); return;
}
function P386_OP_CC(op) {   // CCh
    this.intr(3, 'sw', -1); return;
}
function P386_OP_CD(op) {   // CDh
    { const v = this.fetch(); this.v86Check(); this.intr(v, 'sw', -1); return; }
}
function P386_OP_CE(op) {   // CEh
    if (this.f & F_OF) { this.clk += 3; this.intr(4, 'sw', -1); } else this.clk += 3; return;
}
function P386_OP_CF(op) {   // CFh
    this.iret(); return;
}
function P386_OP_D4(op) {   // D4h
  const R = this.r;
    {                                   // AAM
      const b = this.fetch(), al = R[0] & 0xFF;
      this.clk += 17;
      if (b === 0) { this.szpS(al >> 1, 1); throw this.fault(0); }   // undefined flags: as the 80286
      this.rset(4, 1, Math.floor(al / b)); this.rset(0, 1, al % b);
      this.logicS(R[0] & 0xFF, 1);
      this.aluNote('AAM', al, b, R[0] & 0xFFFF, 2);
      return;
    }
}
function P386_OP_D5(op) {   // D5h
  const R = this.r;
    {                                   // AAD
      const b = this.fetch(), al = R[0] & 0xFF, ah = (R[0] >>> 8) & 0xFF;
      const r = this.addS(al, (ah * b) & 0xFF, 0, 1);
      this.rset(0, 2, r);
      this.aluNote('AAD', al, b, r, 2);
      this.clk += 19; return;
    }
}
function P386_OP_D6(op) {   // D6h
    this.rset(0, 1, this.f & F_CF ? 0xFF : 0); this.clk += 2; return;   // SALC
}
function P386_OP_D7(op) {   // D7h
  const R = this.r;
    {                                   // XLAT
      const sg = this.seg >= 0 ? this.seg : DS, off = this.a32 ? (R[3] + (R[0] & 0xFF)) >>> 0 : ((R[3] & 0xFFFF) + (R[0] & 0xFF)) & 0xFFFF;
      this.eaNote(sg, off);
      this.rset(0, 1, this.rd(sg, off, 1)); this.clk += 5; return;
    }
}
function P386_OP_E0_etc(op) {   // E0h, E1h, E2h
  const R = this.r;
    {             // LOOPNZ / LOOPZ / LOOP (CX or ECX by address size)
      const d = this.fetchS8();
      const c = this.a32 ? (R[1] - 1) >>> 0 : (R[1] - 1) & 0xFFFF;
      const zf = (this.f & F_ZF) !== 0;
      const take = c !== 0 && (op === 0xE2 || (op === 0xE1 ? zf : !zf));
      if (take) this.jump(this.ip + d);
      if (this.a32) R[1] = c; else this.rset(1, 2, c);
      this.clk += take ? 11 : 4;
      return;
    }
}
function P386_OP_E3(op) {   // E3h
  const R = this.r;
    {                                   // JCXZ / JECXZ
      const d = this.fetchS8(), c = this.a32 ? R[1] : R[1] & 0xFFFF;
      if (c === 0) { this.jump(this.ip + d); this.clk += 9; } else this.clk += 5;
      return;
    }
}
function P386_OP_E4_etc(op) {   // E4h, E5h
  const S = this.osz;
    {
      const p = this.fetch(), s = op & 1 ? S : 1;
      this.ioPerm(p, s); this.rset(0, s, this.ioIn(p, s)); this.clk += 12; return;
    }
}
function P386_OP_E6_etc(op) {   // E6h, E7h
  const S = this.osz;
    {
      const p = this.fetch(), s = op & 1 ? S : 1;
      this.ioPerm(p, s); this.ioOut(p, s, this.rget(0, s)); this.clk += 10; return;
    }
}
function P386_OP_E8(op) {   // E8h
  const S = this.osz;
    { const d = this.fetchImm(S), t = this.ip + d; this.push(this.ip, S); this.jump(t, S); this.clk += 7; return; }
}
function P386_OP_E9(op) {   // E9h
  const S = this.osz;
    { const d = this.fetchImm(S); this.jump(this.ip + d, S); this.clk += 7; return; }
}
function P386_OP_EA(op) {   // EAh
  const S = this.osz;
    { const off = this.fetchImm(S), sel = this.fetchW(); this.farXfer(sel, off, false, S); return; }
}
function P386_OP_EB(op) {   // EBh
    { const d = this.fetchS8(); this.jump(this.ip + d); this.clk += 7; return; }
}
function P386_OP_EC_etc(op) {   // ECh, EDh
  const R = this.r, S = this.osz;
    {
      const p = R[2] & 0xFFFF, s = op & 1 ? S : 1;
      this.ioPerm(p, s); this.rset(0, s, this.ioIn(p, s)); this.clk += 13; return;
    }
}
function P386_OP_EE_etc(op) {   // EEh, EFh
  const R = this.r, S = this.osz;
    {
      const p = R[2] & 0xFFFF, s = op & 1 ? S : 1;
      this.ioPerm(p, s); this.ioOut(p, s, this.rget(0, s)); this.clk += 11; return;
    }
}
function P386_OP_F1(op) {   // F1h
    this.intr(1, 'exc', -1); return;   // ICEBP: INT 1 (a trap: EIP of the next instruction)
}
function P386_OP_F4(op) {   // F4h
    // HLT (CPL 0 in protected mode)
      if ((this.cr[0] & 1) && this.cpl) throw this.fault(13, 0);
      this.halted = true; this.clk += 5;
      this.busEv('halt', 2, 0, 0, -1);
      return;
}
function P386_OP_F5(op) {   // F5h
    this.f ^= F_CF; this.clk += 2; return;
}
function P386_OP_F6_etc(op) {   // F6h, F7h
  const S = this.osz;
    this.group3(op & 1 ? S : 1); return;
}
function P386_OP_F8(op) {   // F8h
    this.f &= ~F_CF; this.clk += 2; return;
}
function P386_OP_F9(op) {   // F9h
    this.f |= F_CF; this.clk += 2; return;
}
function P386_OP_FA(op) {   // FAh
    this.ioCheck(); this.f &= ~F_IF; this.clk += 3; return;
}
function P386_OP_FB(op) {   // FBh
    this.ioCheck(); this.f |= F_IF; this.clk += 3; this.inhibit = true; return;
}
function P386_OP_FC(op) {   // FCh
    this.f &= ~F_DF; this.clk += 2; return;
}
function P386_OP_FD(op) {   // FDh
    this.f |= F_DF; this.clk += 2; return;
}
function P386_OP_FE_etc(op) {   // FEh, FFh
    this.group45(op); return;
}
function P386_OP_UD() { throw this.fault(6); }
const P386_OPS = new Array(256).fill(P386_OP_UD);
for (const o of [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D]) P386_OPS[o] = P386_OP_00_etc;
for (const o of [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E, 0x4F]) P386_OPS[o] = P386_OP_40_etc;
for (const o of [0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57]) P386_OPS[o] = P386_OP_50_etc;
for (const o of [0x58, 0x59, 0x5A, 0x5B, 0x5C, 0x5D, 0x5E, 0x5F]) P386_OPS[o] = P386_OP_58_etc;
for (const o of [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F]) P386_OPS[o] = P386_OP_70_etc;
for (const o of [0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97]) P386_OPS[o] = P386_OP_91_etc;
for (const o of [0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF]) P386_OPS[o] = P386_OP_B0_etc;
for (const o of [0xD8, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF]) P386_OPS[o] = P386_OP_D8_etc;
for (const o of [0x06, 0x0E, 0x16, 0x1E]) P386_OPS[o] = P386_OP_06_etc;
for (const o of [0x07, 0x17, 0x1F]) P386_OPS[o] = P386_OP_07_etc;
for (const o of [0x0F]) P386_OPS[o] = P386_OP_0F;
for (const o of [0x27]) P386_OPS[o] = P386_OP_27;
for (const o of [0x2F]) P386_OPS[o] = P386_OP_2F;
for (const o of [0x37]) P386_OPS[o] = P386_OP_37;
for (const o of [0x3F]) P386_OPS[o] = P386_OP_3F;
for (const o of [0x60]) P386_OPS[o] = P386_OP_60;
for (const o of [0x61]) P386_OPS[o] = P386_OP_61;
for (const o of [0x62]) P386_OPS[o] = P386_OP_62;
for (const o of [0x63]) P386_OPS[o] = P386_OP_63;
for (const o of [0x68]) P386_OPS[o] = P386_OP_68;
for (const o of [0x6A]) P386_OPS[o] = P386_OP_6A;
for (const o of [0x69, 0x6B]) P386_OPS[o] = P386_OP_69_etc;
for (const o of [0x6C, 0x6D, 0x6E, 0x6F]) P386_OPS[o] = P386_OP_6C_etc;
for (const o of [0x80, 0x81, 0x82, 0x83]) P386_OPS[o] = P386_OP_80_etc;
for (const o of [0x84, 0x85]) P386_OPS[o] = P386_OP_84_etc;
for (const o of [0x86, 0x87]) P386_OPS[o] = P386_OP_86_etc;
for (const o of [0x88, 0x89]) P386_OPS[o] = P386_OP_88_etc;
for (const o of [0x8A, 0x8B]) P386_OPS[o] = P386_OP_8A_etc;
for (const o of [0x8C]) P386_OPS[o] = P386_OP_8C;
for (const o of [0x8D]) P386_OPS[o] = P386_OP_8D;
for (const o of [0x8E]) P386_OPS[o] = P386_OP_8E;
for (const o of [0x8F]) P386_OPS[o] = P386_OP_8F;
for (const o of [0x90]) P386_OPS[o] = P386_OP_90;
for (const o of [0x98]) P386_OPS[o] = P386_OP_98;
for (const o of [0x99]) P386_OPS[o] = P386_OP_99;
for (const o of [0x9A]) P386_OPS[o] = P386_OP_9A;
for (const o of [0x9B]) P386_OPS[o] = P386_OP_9B;
for (const o of [0x9C]) P386_OPS[o] = P386_OP_9C;
for (const o of [0x9D]) P386_OPS[o] = P386_OP_9D;
for (const o of [0x9E]) P386_OPS[o] = P386_OP_9E;
for (const o of [0x9F]) P386_OPS[o] = P386_OP_9F;
for (const o of [0xA0, 0xA1, 0xA2, 0xA3]) P386_OPS[o] = P386_OP_A0_etc;
for (const o of [0xA4, 0xA5, 0xA6, 0xA7, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF]) P386_OPS[o] = P386_OP_A4_etc;
for (const o of [0xA8, 0xA9]) P386_OPS[o] = P386_OP_A8_etc;
for (const o of [0xC0, 0xC1, 0xD0, 0xD1, 0xD2, 0xD3]) P386_OPS[o] = P386_OP_C0_etc;
for (const o of [0xC2]) P386_OPS[o] = P386_OP_C2;
for (const o of [0xC3]) P386_OPS[o] = P386_OP_C3;
for (const o of [0xC4, 0xC5]) P386_OPS[o] = P386_OP_C4_etc;
for (const o of [0xC6, 0xC7]) P386_OPS[o] = P386_OP_C6_etc;
for (const o of [0xC8]) P386_OPS[o] = P386_OP_C8;
for (const o of [0xC9]) P386_OPS[o] = P386_OP_C9;
for (const o of [0xCA]) P386_OPS[o] = P386_OP_CA;
for (const o of [0xCB]) P386_OPS[o] = P386_OP_CB;
for (const o of [0xCC]) P386_OPS[o] = P386_OP_CC;
for (const o of [0xCD]) P386_OPS[o] = P386_OP_CD;
for (const o of [0xCE]) P386_OPS[o] = P386_OP_CE;
for (const o of [0xCF]) P386_OPS[o] = P386_OP_CF;
for (const o of [0xD4]) P386_OPS[o] = P386_OP_D4;
for (const o of [0xD5]) P386_OPS[o] = P386_OP_D5;
for (const o of [0xD6]) P386_OPS[o] = P386_OP_D6;
for (const o of [0xD7]) P386_OPS[o] = P386_OP_D7;
for (const o of [0xE0, 0xE1, 0xE2]) P386_OPS[o] = P386_OP_E0_etc;
for (const o of [0xE3]) P386_OPS[o] = P386_OP_E3;
for (const o of [0xE4, 0xE5]) P386_OPS[o] = P386_OP_E4_etc;
for (const o of [0xE6, 0xE7]) P386_OPS[o] = P386_OP_E6_etc;
for (const o of [0xE8]) P386_OPS[o] = P386_OP_E8;
for (const o of [0xE9]) P386_OPS[o] = P386_OP_E9;
for (const o of [0xEA]) P386_OPS[o] = P386_OP_EA;
for (const o of [0xEB]) P386_OPS[o] = P386_OP_EB;
for (const o of [0xEC, 0xED]) P386_OPS[o] = P386_OP_EC_etc;
for (const o of [0xEE, 0xEF]) P386_OPS[o] = P386_OP_EE_etc;
for (const o of [0xF1]) P386_OPS[o] = P386_OP_F1;
for (const o of [0xF4]) P386_OPS[o] = P386_OP_F4;
for (const o of [0xF5]) P386_OPS[o] = P386_OP_F5;
for (const o of [0xF6, 0xF7]) P386_OPS[o] = P386_OP_F6_etc;
for (const o of [0xF8]) P386_OPS[o] = P386_OP_F8;
for (const o of [0xF9]) P386_OPS[o] = P386_OP_F9;
for (const o of [0xFA]) P386_OPS[o] = P386_OP_FA;
for (const o of [0xFB]) P386_OPS[o] = P386_OP_FB;
for (const o of [0xFC]) P386_OPS[o] = P386_OP_FC;
for (const o of [0xFD]) P386_OPS[o] = P386_OP_FD;
for (const o of [0xFE, 0xFF]) P386_OPS[o] = P386_OP_FE_etc;
