// Intel 80286 CPU core. It extends CPU8086 (src/core/cpu8086.js) and keeps its step() and
// micro-event contract (see ARCHITECTURE.md, "80286 model").
//
// - All 80186/80286 instructions, #UD for undefined opcodes, 286 real-mode behaviour.
// - Protected mode: MSW, GDTR/IDTR/LDTR/TR, descriptor caches (cpu.cache[i]), CPL/DPL/RPL
//   checks, limit checks on each access, call/interrupt/trap/task gates, 286 TSS task
//   switches, double fault and triple-fault shutdown, LOADALL (0F 05).
// - 24-bit physical addresses go to bus.read8/write8 (the machine applies A20).
// - Clock counts come from the Intel 80286 data sheet. A bus cycle is 2 clocks plus
//   bus.waitStates (default 1). Each 'fetch' and 'bus' event has `len` (its clocks).
// - The prefetch queue holds 6 bytes; the BIU fetches aligned words.
//
// A fault stops the instruction with a thrown Fault286. step() catches it, sets IP back
// to the start of the instruction, sets SP back, and starts the exception handler.

const P286_NT = 0x4000;
const P286_EXC = ['#DE', '#DB', 'NMI', '#BP', '#OF', '#BR', '#UD', '#NM', '#DF', '#PSO', '#TS', '#NP', '#SS', '#GP', 'INT 14', 'INT 15', '#MF'];
// Contributory exceptions: a second one during the start of the first gives #DF.
const P286_CONTRIB = [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1];

class Fault286 {
  constructor(vec, err) { this.vec = vec; this.err = err; }
}

class CPU80286 extends CPU8086 {
  constructor(bus) {
    super(bus);
    // fpuError: null, or a function that returns true when the 80287 ERROR line is
    // active. Then WAIT and ESC raise #MF (INT 16). The AT does not connect this line
    // (it sends 80287 errors to IRQ 13), so the default is null.
    this.fpuError = null;
  }

  reset() {
    if (!this.cache) {
      this.cache = [0, 1, 2, 3].map(() => ({ sel: 0, base: 0, limit: 0xFFFF, access: 0x93, lo: 0, hi: 0xFFFF, rd: true, wr: true }));
      this.gdtr = { base: 0, limit: 0xFFFF };
      this.idtr = { base: 0, limit: 0x3FF };
      this.ldtr = { sel: 0, base: 0, limit: 0xFFFF, access: 0x82, valid: false };
      this.tr = { sel: 0, base: 0, limit: 0xFFFF, access: 0x83 };
      this.trace = null;
    }
    this.regs.fill(0);
    this.msw = 0xFFF0; this.pe = false; this.cpl = 0;
    for (let i = 0; i < 4; i++) this.setCache(i, i === CS ? 0xF000 : 0, i === CS ? 0xFF0000 : 0, 0xFFFF, 0x93, 'real');
    Object.assign(this.gdtr, { base: 0, limit: 0xFFFF });
    Object.assign(this.idtr, { base: 0, limit: 0x3FF });
    Object.assign(this.ldtr, { sel: 0, base: 0, limit: 0xFFFF, access: 0x82, valid: false });
    Object.assign(this.tr, { sel: 0, base: 0, limit: 0xFFFF, access: 0x83 });
    this.ip = 0xFFF0;
    this.f = 0x0002;
    this.halted = false; this.shutdownState = false;
    this.repState = null; this.inhibit = false;
    this.cycles = 0; this.instructions = 0;
    this.seg = -1; this.rep = 0; this.lock = false; this.ext = 0;
    this.ws = 1; this.busLen = 3; this.didFlush = false; this.ilen = 0;
    this.lastIP = this.ip; this.lastCS = 0xF000; this.lastBase = 0xFF0000; this.spStart = 0;
    this.flush();
  }

  // Bits 12-15 read 0 in real mode. In protected mode IOPL (12-13) and NT (14) are used.
  get flags() { return (this.f & 0x7FD5) | 2; }
  set flags(v) { this.f = (v & (this.pe ? 0x7FD5 : 0x0FD5)) | 2; }
  get iopl() { return (this.f >> 12) & 3; }
  get linearIP() { return (this.cache[CS].base + this.ip) & 0xFFFFFF; }
  phys(s, o) { return (this.cache[s].base + (o & 0xFFFF)) & 0xFFFFFF; }

  fault(vec, err) { return new Fault286(vec, err === undefined ? -1 : err); }
  // Error code for a selector: index, TI and the EXT bit.
  fsel(vec, sel) { return new Fault286(vec, (sel & 0xFFFC) | this.ext); }

  // ---------- descriptor caches ----------
  calcCache(d) {
    const a = d.access;
    if ((a & 0x1C) === 0x14) { d.lo = d.limit + 1; d.hi = 0xFFFF; } else { d.lo = 0; d.hi = d.limit; }
    if (!this.pe) { d.rd = true; d.wr = true; } else if (a & 8) { d.rd = (a & 2) !== 0; d.wr = false; } else { d.rd = true; d.wr = (a & 2) !== 0; }
  }
  setCache(i, sel, base, limit, access, table) {
    const d = this.cache[i];
    d.sel = sel; d.base = base & 0xFFFFFF; d.limit = limit; d.access = access;
    this.calcCache(d);
    this.sregs[i] = sel;
    if (this.trace) this.ev.push({ k: 'desc', sreg: SREG[i], sel, base: d.base, limit, access, table: table || (this.pe ? (sel & 4 ? 'LDT' : 'GDT') : 'real') });
  }
  // A null selector in DS or ES: each access through it gives #GP(0).
  setNull(i, sel) {
    const d = this.cache[i];
    d.sel = sel; d.base = 0; d.limit = 0; d.access = 0; d.lo = 0x10000; d.hi = 0; d.rd = false; d.wr = false;
    this.sregs[i] = sel;
    if (this.trace) this.ev.push({ k: 'desc', sreg: SREG[i], sel, base: 0, limit: 0, access: 0, table: 'null' });
  }
  // Real mode: the selector sets the base (selector * 16). Limit and access stay.
  loadSegReal(i, sel) {
    const d = this.cache[i];
    d.sel = sel; d.base = sel << 4; this.sregs[i] = sel;
    if (this.trace) this.ev.push({ k: 'desc', sreg: SREG[i], sel, base: d.base, limit: d.limit, access: d.access, table: 'real' });
  }
  // Other code (the machine, a debugger) can write cpu.sregs in real mode; step() then
  // loads the matching caches.
  syncSegs() {
    for (let i = 0; i < 4; i++) if (this.cache[i].sel !== this.sregs[i]) this.loadSegReal(i, this.sregs[i]);
  }
  // Load a segment register as MOV / POP / LDS do (protected-mode checks when PE = 1).
  loadSeg(i, sel) {
    sel &= 0xFFFF;
    if (!this.pe) { this.loadSegReal(i, sel); return; }
    if (i === SS) this.loadSS(sel);
    else if (i === CS) {
      const d = this.desc(sel, 13);
      this.setCS(sel, d, sel & 3);
    } else this.loadDataSeg(i, sel);
  }

  // Read the descriptor of a selector (3 words; bytes 6-7 are reserved on the 80286).
  // Returns null when the selector is outside its table.
  readDesc(sel) {
    let tb, tl;
    if (sel & 4) { if (!this.ldtr.valid) return null; tb = this.ldtr.base; tl = this.ldtr.limit; }
    else { tb = this.gdtr.base; tl = this.gdtr.limit; }
    if ((sel | 7) > tl) return null;
    const a = (tb + (sel & 0xFFF8)) & 0xFFFFFF;
    const w0 = this.rdSys(a), w1 = this.rdSys(a + 2), w2 = this.rdSys(a + 4);
    return { sel, addr: a, limit: w0, base: w1 | ((w2 & 0xFF) << 16), access: w2 >> 8, w1, w2 };
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
    this.setCache(i, sel, d.base, d.limit, d.access);
  }
  loadSS(sel) {
    if (!(sel & 0xFFFC)) throw this.fault(13, this.ext);
    const d = this.desc(sel, 13), a = d.access;
    if ((sel & 3) !== this.cpl || ((a >> 5) & 3) !== this.cpl || (a & 0x1A) !== 0x12) throw this.fsel(13, sel);
    if (!(a & 0x80)) throw this.fsel(12, sel);
    this.setAccessed(d);
    this.setCache(SS, sel, d.base, d.limit, d.access);
  }
  setCS(sel, d, cpl) {
    this.cpl = cpl;
    this.setAccessed(d);
    this.setCache(CS, (sel & 0xFFFC) | cpl, d.base, d.limit, d.access);
  }
  // DS and ES get a null selector when their DPL is below the new (outer) CPL.
  nullOuter() {
    for (const i of [ES, DS]) {
      const a = this.cache[i].access;
      if ((a & 0x10) && (a & 0x0C) !== 0x0C && ((a >> 5) & 3) < this.cpl) this.setNull(i, 0);
    }
  }

  // ---------- bus cycles ----------
  busEv(type, a, v, width, s) {
    this.nEU++;
    const st = this.bus.stats;
    if (st) countCycle(st, type);
    if (this.trace) {
      this.euEv.push({ k: 'bus', type, addr: a, data: v, width, seg: s < 0 ? null : SREG[s],
        dev: this.bus.devAt ? (type === 'ior' || type === 'iow' ? this.bus.ioDevAt(a) : this.bus.devAt(a)) : 'ram', owner: 'cpu', len: this.busLen });
    }
  }
  // Bus cycles to the processor extension ports 00F8h / 00FAh / 00FCh.
  fpuIO(type, port, v) {
    this.nEU++;
    const st = this.bus.stats;
    if (st) countCycle(st, type);
    if (this.trace) this.euEv.push({ k: 'bus', type, addr: port, data: v & 0xFFFF, width: 2, seg: null, dev: 'fpu', owner: 'cpu', len: this.busLen });
  }
  // Limit or access violation: #SS(0) for SS in protected mode, else #GP(0). (In real mode
  // the 80286 gives INT 13 for every segment, SS too.)
  segFault(s) { throw this.fault(s === SS && this.pe ? 12 : 13, 0); }
  rb(s, o) {
    const d = this.cache[s];
    if (o < d.lo || o > d.hi || !d.rd) this.segFault(s);
    const a = (d.base + o) & 0xFFFFFF, v = this.bus.read8(a);
    this.busEv('memr', a, v, 1, s);
    return v;
  }
  wb(s, o, v) {
    const d = this.cache[s];
    if (o < d.lo || o > d.hi || !d.wr) this.segFault(s);
    const a = (d.base + o) & 0xFFFFFF;
    this.bus.write8(a, v & 0xFF);
    this.busEv('memw', a, v & 0xFF, 1, s);
  }
  rw(s, o) {
    const d = this.cache[s];
    if (o < d.lo || o >= d.hi || !d.rd) this.segFault(s);
    const a = (d.base + o) & 0xFFFFFF, bus = this.bus;
    if (!(a & 1)) {
      const v = bus.read8(a) | (bus.read8(a + 1) << 8);
      this.busEv('memr', a, v, 2, s);
      return v;
    }
    this.clk += 2;
    const lo = bus.read8(a);
    this.busEv('memr', a, lo, 1, s);
    const a1 = (a + 1) & 0xFFFFFF, hi = bus.read8(a1);
    this.busEv('memr', a1, hi, 1, s);
    return lo | (hi << 8);
  }
  ww(s, o, v) {
    const d = this.cache[s];
    if (o < d.lo || o >= d.hi || !d.wr) this.segFault(s);
    const a = (d.base + o) & 0xFFFFFF, bus = this.bus;
    if (!(a & 1)) {
      bus.write8(a, v & 0xFF);
      bus.write8(a + 1, (v >> 8) & 0xFF);
      this.busEv('memw', a, v & 0xFFFF, 2, s);
      return;
    }
    this.clk += 2;
    bus.write8(a, v & 0xFF);
    this.busEv('memw', a, v & 0xFF, 1, s);
    const a1 = (a + 1) & 0xFFFFFF;
    bus.write8(a1, (v >> 8) & 0xFF);
    this.busEv('memw', a1, (v >> 8) & 0xFF, 1, s);
  }
  // System accesses at a physical address (descriptor tables, TSS, IVT, LOADALL table).
  rdSys(a) {
    a &= 0xFFFFFF;
    const v = this.bus.read8(a) | (this.bus.read8((a + 1) & 0xFFFFFF) << 8);
    this.busEv('memr', a, v, 2, -1);
    return v;
  }
  rdSysB(a) { a &= 0xFFFFFF; const v = this.bus.read8(a); this.busEv('memr', a, v, 1, -1); return v; }
  wrSys(a, v) {
    a &= 0xFFFFFF;
    this.bus.write8(a, v & 0xFF); this.bus.write8((a + 1) & 0xFFFFFF, (v >> 8) & 0xFF);
    this.busEv('memw', a, v & 0xFFFF, 2, -1);
  }
  wrSysB(a, v) { a &= 0xFFFFFF; this.bus.write8(a, v & 0xFF); this.busEv('memw', a, v & 0xFF, 1, -1); }
  inb(p) { const v = this.bus.in8(p) & 0xFF; this.busEv('ior', p, v, 1, -1); return v; }
  outb(p, v) { this.bus.out8(p, v & 0xFF); this.busEv('iow', p, v & 0xFF, 1, -1); }
  inw(p) {
    if (!(p & 1)) {
      const v = this.bus.in16 ? this.bus.in16(p) & 0xFFFF : this.bus.in8(p) | (this.bus.in8((p + 1) & 0xFFFF) << 8);
      this.busEv('ior', p, v, 2, -1);
      return v;
    }
    this.clk += 2;
    return this.inb(p) | (this.inb((p + 1) & 0xFFFF) << 8);
  }
  outw(p, v) {
    if (!(p & 1)) {
      if (this.bus.out16) this.bus.out16(p, v & 0xFFFF);
      else { this.bus.out8(p, v & 0xFF); this.bus.out8((p + 1) & 0xFFFF, (v >> 8) & 0xFF); }
      this.busEv('iow', p, v & 0xFFFF, 2, -1);
      return;
    }
    this.clk += 2;
    this.outb(p, v); this.outb((p + 1) & 0xFFFF, v >> 8);
  }
  push(v) { const sp = (this.regs[SP] - 2) & 0xFFFF; this.ww(SS, sp, v); this.regs[SP] = sp; }
  pop() { const v = this.rw(SS, this.regs[SP]); this.regs[SP] += 2; return v; }

  // ---------- prefetch queue (6 bytes, aligned word fetches) ----------
  flush() {
    this.q.length = 0; this.qip = this.ip; this.didFlush = true;
    if (this.trace) this.ev.push({ k: 'queue', op: 'flush', n: 0, q: [] });
  }
  prefetch(stall) {
    const qip = this.qip, bus = this.bus;
    const a = (this.cache[CS].base + qip) & 0xFFFFFF;
    let data, width, addr;
    if (!(a & 1) && qip !== 0xFFFF) {
      const b0 = bus.read8(a), b1 = bus.read8((a + 1) & 0xFFFFFF);
      this.q.push(b0, b1); data = b0 | (b1 << 8); width = 2; addr = a;
      this.qip = (qip + 2) & 0xFFFF;
    } else {
      // Odd address: the BIU reads the aligned word and keeps the high byte.
      const b = bus.read8(a);
      this.q.push(b); data = b; width = 1; addr = a;
      this.qip = (qip + 1) & 0xFFFF;
    }
    if (bus.stats) bus.stats.fetch++;
    if (this.trace) {
      const e = { k: 'fetch', addr, data, width, seg: 'CS', dev: bus.devAt ? bus.devAt(addr) : 'ram', q: this.q.slice(), len: this.busLen };
      if (stall) this.stallEv.push(e); else this.ev.push(e);
    }
  }
  fetch() {
    if (!this.q.length) { this.nStall++; this.prefetch(true); }
    const ip = this.ip;
    // An instruction longer than 10 bytes, or a byte past the CS limit: #GP(0).
    if (ip > this.cache[CS].hi || ++this.ilen > 10) throw this.fault(13, 0);
    const b = this.q.shift();
    this.ip = (ip + 1) & 0xFFFF;
    if (this.trace) this.ibytes.push(b);
    return b;
  }

  // ---------- ModR/M: the 80286 address unit adds 1 clock for base + index + disp ----------
  calcEA() {
    const R = this.regs;
    let off, seg = DS;
    switch (this.rm) {
      case 0: off = R[BX] + R[SI]; break;
      case 1: off = R[BX] + R[DI]; break;
      case 2: off = R[BP] + R[SI]; seg = SS; break;
      case 3: off = R[BP] + R[DI]; seg = SS; break;
      case 4: off = R[SI]; break;
      case 5: off = R[DI]; break;
      case 6: if (this.mod === 0) off = this.fetchW(); else { off = R[BP]; seg = SS; } break;
      default: off = R[BX];
    }
    if (this.mod === 1) { off += this.fetchS8(); if (this.rm < 4) this.clk++; }
    else if (this.mod === 2) { off += this.fetchW(); if (this.rm < 4) this.clk++; }
    if (this.seg >= 0) seg = this.seg;
    this.eaOff = off & 0xFFFF; this.eaSeg = seg;
    if (this.trace) this.ev.push({ k: 'ea', seg: SREG[seg], segv: this.sregs[seg], off: this.eaOff, phys: this.phys(seg, this.eaOff) });
  }
  memOnly() { if (this.mod === 3) throw this.fault(6); }

  // ---------- control transfer ----------
  jump(ip) {
    ip &= 0xFFFF;
    if (ip > this.cache[CS].hi) throw this.fault(13, 0);
    this.ip = ip; this.flush();
  }
  farJump(cs, ip) { this.farJmp(cs, ip, false, 0); }
  // JMP / CALL far. extra: clocks for the indirect forms.
  farJmp(cs, ip, call, extra) {
    cs &= 0xFFFF; ip &= 0xFFFF;
    if (this.pe) { this.farPM(cs, ip, call, extra); return; }
    if (call) { this.push(this.sregs[CS]); this.push(this.ip); }
    this.loadSegReal(CS, cs);
    if (ip > this.cache[CS].hi) throw this.fault(13, 0);
    this.ip = ip; this.flush();
    this.clk += (call ? 13 : 11) + extra;
  }
  farPM(sel, off, call, extra) {
    const retCS = this.sregs[CS], retIP = this.ip, cpl = this.cpl, rpl = sel & 3;
    if (!(sel & 0xFFFC)) throw this.fault(13, 0);
    const d = this.desc(sel, 13), a = d.access, dpl = (a >> 5) & 3;
    if (a & 0x10) {
      if (!(a & 8)) throw this.fsel(13, sel);
      if (a & 4) { if (dpl > cpl) throw this.fsel(13, sel); } else if (rpl > cpl || dpl !== cpl) throw this.fsel(13, sel);
      if (!(a & 0x80)) throw this.fsel(11, sel);
      if (off > d.limit) throw this.fault(13, 0);
      if (call) { this.push(retCS); this.push(retIP); }
      this.setCS(sel, d, cpl);
      this.ip = off; this.flush();
      this.clk += (call ? 26 : 23) + extra;
      return;
    }
    switch (a & 0x1F) {
      case 4: this.callGate(sel, d, call, retCS, retIP, extra); return;
      case 5: {                                   // task gate
        if (dpl < Math.max(cpl, rpl)) throw this.fsel(13, sel);
        if (!(a & 0x80)) throw this.fsel(11, sel);
        const ts = d.w1, td = this.tssDesc(ts);
        this.taskSwitch(ts, td, call ? 'call' : 'jmp', retIP);
        this.clk += (call ? 182 : 180) + extra;
        return;
      }
      case 1: {                                   // available 286 TSS
        if (dpl < Math.max(cpl, rpl)) throw this.fsel(13, sel);
        if (!(a & 0x80)) throw this.fsel(11, sel);
        if (d.limit < 43) throw this.fsel(10, sel);
        this.taskSwitch(sel, d, call ? 'call' : 'jmp', retIP);
        this.clk += (call ? 177 : 175) + extra;
        return;
      }
      default: throw this.fsel(13, sel);
    }
  }
  // Selector of a TSS in a task gate: it must be an available 286 TSS in the GDT.
  tssDesc(sel) {
    if (sel & 4) throw this.fsel(13, sel);
    const d = this.readDesc(sel);
    if (!d || (d.access & 0x1F) !== 1) throw this.fsel(13, sel);
    if (!(d.access & 0x80)) throw this.fsel(11, sel);
    if (d.limit < 43) throw this.fsel(10, sel);
    return d;
  }
  callGate(gsel, g, call, retCS, retIP, extra) {
    const cpl = this.cpl, a = g.access, gdpl = (a >> 5) & 3;
    if (gdpl < cpl || gdpl < (gsel & 3)) throw this.fsel(13, gsel);
    if (!(a & 0x80)) throw this.fsel(11, gsel);
    const tsel = g.w1, toff = g.limit, wc = g.w2 & 0x1F;
    if (!(tsel & 0xFFFC)) throw this.fault(13, 0);
    const d = this.desc(tsel, 13), ta = d.access, tdpl = (ta >> 5) & 3;
    if ((ta & 0x18) !== 0x18 || tdpl > cpl) throw this.fsel(13, tsel);
    if (!(ta & 0x80)) throw this.fsel(11, tsel);
    if (toff > d.limit) throw this.fault(13, 0);
    const conforming = (ta & 4) !== 0;
    if (!call) {
      if (!conforming && tdpl !== cpl) throw this.fsel(13, tsel);
      this.setCS(tsel, d, cpl); this.ip = toff; this.flush();
      this.clk += 38 + extra;
      return;
    }
    if (!conforming && tdpl < cpl) {
      // Call to an inner level: the new stack comes from the TSS; the gate copies wc words.
      const [nsp, nss] = this.tssStack(tdpl);
      const sd = this.checkNewSS(nss, tdpl);
      this.stackRoom(sd, nsp, 8 + 2 * wc, nss);
      const R = this.regs, params = [];
      for (let i = 0; i < wc; i++) params.push(this.rw(SS, (R[SP] + 2 * i) & 0xFFFF));
      const oss = this.sregs[SS], osp = R[SP];
      this.cpl = tdpl;
      this.setAccessed(sd);
      this.setCache(SS, nss, sd.base, sd.limit, sd.access);
      R[SP] = nsp;
      this.push(oss); this.push(osp);
      for (let i = wc - 1; i >= 0; i--) this.push(params[i]);
      this.push(retCS); this.push(retIP);
      this.setCS(tsel, d, tdpl);
      this.ip = toff; this.flush();
      this.clk += (wc ? 86 + 4 * wc : 82) + extra;
      if (this.trace) this.ev.push({ k: 'sys', op: 'CALLGATE', text: `call gate: CPL ${cpl} -> ${tdpl}, ${wc} parameter word(s) copied` });
      return;
    }
    this.push(retCS); this.push(retIP);
    this.setCS(tsel, d, cpl); this.ip = toff; this.flush();
    this.clk += 41 + extra;
  }
  // SS:SP for privilege level n from the current TSS.
  tssStack(n) {
    const off = 2 + 4 * n;
    if (off + 3 > this.tr.limit) throw this.fsel(10, this.tr.sel);
    return [this.rdSys(this.tr.base + off), this.rdSys(this.tr.base + off + 2)];
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
    const ed = (d.access & 0x1C) === 0x14, lo = ed ? d.limit + 1 : 0, hi = ed ? 0xFFFF : d.limit;
    for (let k = 2; k <= n; k += 2) {
      const o = (sp - k) & 0xFFFF;
      if (o < lo || o + 1 > hi) throw this.fsel(12, sel);
    }
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
  retFar(n) {
    const R = this.regs, sp = R[SP];
    const ip = this.rw(SS, sp), cs = this.rw(SS, (sp + 2) & 0xFFFF);
    if (!this.pe) {
      R[SP] = (sp + 4 + n) & 0xFFFF;
      this.loadSegReal(CS, cs);
      if (ip > this.cache[CS].hi) throw this.fault(13, 0);
      this.ip = ip; this.flush();
      this.clk += 15;
      return;
    }
    const d = this.retCode(cs), rpl = cs & 3;
    if (rpl === this.cpl) {
      if (ip > d.limit) throw this.fault(13, 0);
      R[SP] = (sp + 4 + n) & 0xFFFF;
      this.setCS(cs, d, rpl); this.ip = ip; this.flush();
      this.clk += 25;
      return;
    }
    const nsp = this.rw(SS, (sp + 4 + n) & 0xFFFF), nss = this.rw(SS, (sp + 6 + n) & 0xFFFF);
    const sd = this.retSS(nss, rpl);
    if (ip > d.limit) throw this.fault(13, 0);
    const from = this.cpl;
    this.setCS(cs, d, rpl);
    this.setAccessed(sd);
    this.setCache(SS, nss, sd.base, sd.limit, sd.access);
    R[SP] = (nsp + n) & 0xFFFF;
    this.ip = ip; this.flush();
    this.nullOuter();
    this.clk += 55;
    if (this.trace) this.ev.push({ k: 'sys', op: 'RETF', text: `return to an outer level: CPL ${from} -> ${rpl}` });
  }
  // POPF / IRET in protected mode: IOPL changes only at CPL 0, IF only when CPL <= IOPL.
  setFlagsPM(v, cpl) {
    let mask = 0x4DD5;
    if (cpl === 0) mask |= 0x3000;
    if (cpl <= this.iopl) mask |= 0x200;
    this.f = (this.f & ~mask) | (v & mask) | 2;
  }
  iret() {
    const R = this.regs;
    if (!this.pe) {
      const ip = this.pop(), cs = this.pop(), fl = this.pop();
      this.flags = fl;
      this.loadSegReal(CS, cs);
      if (ip > this.cache[CS].hi) throw this.fault(13, 0);
      this.ip = ip; this.flush();
      this.clk += 17;
      return;
    }
    if (this.f & P286_NT) {
      // Return from a nested task: the back link in the current TSS.
      const link = this.rdSys(this.tr.base);
      if (link & 4) throw this.fsel(10, link);
      const d = this.readDesc(link);
      if (!d || (d.access & 0x1F) !== 3) throw this.fsel(10, link);
      if (!(d.access & 0x80)) throw this.fsel(11, link);
      this.taskSwitch(link, d, 'iret', this.ip);
      this.clk += 169;
      return;
    }
    const sp = R[SP];
    const ip = this.rw(SS, sp), cs = this.rw(SS, (sp + 2) & 0xFFFF), fl = this.rw(SS, (sp + 4) & 0xFFFF);
    const d = this.retCode(cs), rpl = cs & 3, cpl = this.cpl;
    if (rpl === cpl) {
      if (ip > d.limit) throw this.fault(13, 0);
      R[SP] = (sp + 6) & 0xFFFF;
      this.setFlagsPM(fl, cpl);
      this.setCS(cs, d, rpl); this.ip = ip; this.flush();
      this.clk += 31;
      return;
    }
    const nsp = this.rw(SS, (sp + 6) & 0xFFFF), nss = this.rw(SS, (sp + 8) & 0xFFFF);
    const sd = this.retSS(nss, rpl);
    if (ip > d.limit) throw this.fault(13, 0);
    this.setFlagsPM(fl, cpl);
    this.setCS(cs, d, rpl);
    this.setAccessed(sd);
    this.setCache(SS, nss, sd.base, sd.limit, sd.access);
    R[SP] = nsp;
    this.ip = ip; this.flush();
    this.nullOuter();
    this.clk += 55;
    if (this.trace) this.ev.push({ k: 'sys', op: 'IRET', text: `return to an outer level: CPL ${cpl} -> ${rpl}` });
  }

  // ---------- task switch (286 TSS, 44 bytes) ----------
  // reason: 'jmp' | 'call' | 'int' | 'iret'. nextIP: IP to save in the old TSS.
  taskSwitch(sel, d, reason, nextIP) {
    const R = this.regs, old = this.tr, from = old.sel;
    if (d.limit < 43) throw this.fsel(10, sel);
    // 1. Save the state of the old task.
    const b = old.base;
    let fl = this.flags;
    if (reason === 'iret') fl &= ~P286_NT;
    this.wrSys(b + 14, nextIP); this.wrSys(b + 16, fl);
    for (let i = 0; i < 8; i++) this.wrSys(b + 18 + 2 * i, R[i]);
    for (let i = 0; i < 4; i++) this.wrSys(b + 34 + 2 * i, this.sregs[i]);
    // 2. Busy bits and the back link.
    const gdt = this.gdtr.base;
    if (reason === 'jmp' || reason === 'iret') {
      const ab = (gdt + (from & 0xFFF8) + 5) & 0xFFFFFF;
      this.wrSysB(ab, this.rdSysB(ab) & ~2);
    }
    if (reason === 'call' || reason === 'int') this.wrSys(d.base, from);
    if (reason !== 'iret') { d.access |= 2; this.wrSysB(d.addr + 5, d.access); }
    Object.assign(this.tr, { sel, base: d.base, limit: d.limit, access: d.access });
    this.msw |= 8;
    // 3. Load the state of the new task.
    const nb = d.base;
    const ip = this.rdSys(nb + 14), nf = this.rdSys(nb + 16);
    for (let i = 0; i < 8; i++) R[i] = this.rdSys(nb + 18 + 2 * i);
    const sel4 = [0, 1, 2, 3].map(i => this.rdSys(nb + 34 + 2 * i));
    const ldt = this.rdSys(nb + 42);
    this.f = (nf & 0x7FD5) | 2;
    if (reason === 'call' || reason === 'int') this.f |= P286_NT;
    this.ip = ip;
    for (let i = 0; i < 4; i++) { this.setNull(i, sel4[i]); }
    if (this.trace) this.ev.push({ k: 'task', from, to: sel, reason });
    // Faults from here on belong to the new task.
    this.lastIP = ip; this.lastCS = sel4[CS]; this.spStart = R[SP];
    this.cpl = sel4[CS] & 3;
    // 4. LDT, then the segment registers (errors give #TS).
    this.ldtr.sel = ldt;
    if (!(ldt & 0xFFFC)) this.ldtr.valid = false;
    else {
      this.ldtr.valid = false;
      if (ldt & 4) throw this.fsel(10, ldt);
      const ld = this.readDesc(ldt);
      if (!ld || (ld.access & 0x1F) !== 2 || !(ld.access & 0x80)) throw this.fsel(10, ldt);
      Object.assign(this.ldtr, { base: ld.base, limit: ld.limit, access: ld.access, valid: true });
    }
    const cs = sel4[CS];
    if (!(cs & 0xFFFC)) throw this.fault(10, this.ext);
    const cd = this.readDesc(cs);
    if (!cd) throw this.fsel(10, cs);
    const ca = cd.access, cdpl = (ca >> 5) & 3;
    if ((ca & 0x18) !== 0x18 || (ca & 4 ? cdpl > (cs & 3) : cdpl !== (cs & 3))) throw this.fsel(10, cs);
    if (!(ca & 0x80)) throw this.fsel(11, cs);
    this.setCS(cs, cd, cs & 3);
    const ss = sel4[SS];
    const sd = this.checkNewSS(ss, this.cpl);
    this.setAccessed(sd);
    this.setCache(SS, ss, sd.base, sd.limit, sd.access);
    for (const i of [DS, ES]) {
      const s = sel4[i];
      if (!(s & 0xFFFC)) continue;
      const dd = this.readDesc(s);
      if (!dd) throw this.fsel(10, s);
      const a = dd.access;
      if (!(a & 0x10) || (a & 0x0A) === 0x08) throw this.fsel(10, s);
      if ((a & 0x0C) !== 0x0C && Math.max(this.cpl, s & 3) > ((a >> 5) & 3)) throw this.fsel(10, s);
      if (!(a & 0x80)) throw this.fsel(11, s);
      this.setAccessed(dd);
      this.setCache(i, s, dd.base, dd.limit, dd.access);
    }
    this.flush();
    if (ip > this.cache[CS].hi) throw this.fault(13, 0);
  }

  // ---------- interrupts and exceptions ----------
  // src: 'sw' (INT n, INT 3, INTO), 'irq', 'nmi', 'exc'. err: error code (-1 = none).
  intr(vec, src, err) {
    if (this.trace) {
      this.ev.push(src === 'exc' ? { k: 'int', vec, src, err: err >= 0 && this.pe ? err : undefined, name: P286_EXC[vec] || 'INT ' + vec }
        : { k: 'int', vec, src });
    }
    if (!this.pe) this.intReal(vec); else this.intPM(vec, src === 'sw', err);
    this.halted = false;
  }
  intReal(vec) {
    if (vec * 4 + 3 > this.idtr.limit) throw this.fault(13, 0);
    const a = this.idtr.base + vec * 4;
    this.push(this.flags); this.push(this.sregs[CS]); this.push(this.ip);
    this.f &= ~(F_IF | F_TF);
    const ip = this.rdSys(a), cs = this.rdSys(a + 2);
    this.loadSegReal(CS, cs);
    this.ip = ip; this.flush();
    this.clk += 23;
  }
  intPM(vec, soft, err) {
    const ext = soft ? 0 : 1;
    this.ext = ext;
    const verr = vec * 8 + 2 + ext;
    if (vec * 8 + 7 > this.idtr.limit) throw this.fault(13, verr);
    const ga = (this.idtr.base + vec * 8) & 0xFFFFFF;
    const goff = this.rdSys(ga), gsel = this.rdSys(ga + 2), w2 = this.rdSys(ga + 4);
    const a = w2 >> 8, type = a & 0x1F;
    if (type !== 5 && type !== 6 && type !== 7) throw this.fault(13, verr);
    if (soft && ((a >> 5) & 3) < this.cpl) throw this.fault(13, verr);
    if (!(a & 0x80)) throw this.fault(11, verr);
    if (type === 5) {
      const td = this.tssDesc(gsel);
      this.taskSwitch(gsel, td, 'int', this.ip);
      if (err >= 0) this.push(err);
      this.clk += 167;
      return;
    }
    if (!(gsel & 0xFFFC)) throw this.fault(13, ext);
    const d = this.desc(gsel, 13), ca = d.access, dpl = (ca >> 5) & 3, cpl = this.cpl;
    if ((ca & 0x18) !== 0x18 || dpl > cpl) throw this.fsel(13, gsel);
    if (!(ca & 0x80)) throw this.fsel(11, gsel);
    if (goff > d.limit) throw this.fault(13, ext);
    const fl = this.flags, ocs = this.sregs[CS], oip = this.ip;
    if (!(ca & 4) && dpl < cpl) {
      const [nsp, nss] = this.tssStack(dpl);
      const sd = this.checkNewSS(nss, dpl);
      this.stackRoom(sd, nsp, err >= 0 ? 12 : 10, nss);
      const oss = this.sregs[SS], osp = this.regs[SP];
      this.cpl = dpl;
      this.setAccessed(sd);
      this.setCache(SS, nss, sd.base, sd.limit, sd.access);
      this.regs[SP] = nsp;
      this.push(oss); this.push(osp);
      this.push(fl); this.push(ocs); this.push(oip);
      if (err >= 0) this.push(err);
      this.setCS(gsel, d, dpl);
      this.clk += 78;
    } else if ((ca & 4) || dpl === cpl) {
      this.push(fl); this.push(ocs); this.push(oip);
      if (err >= 0) this.push(err);
      this.setCS(gsel, d, cpl);
      this.clk += 40;
    } else throw this.fsel(13, gsel);
    this.f &= ~(F_TF | P286_NT);
    if (type === 6) this.f &= ~F_IF;
    this.ip = goff; this.flush();
  }
  // A fault in the current instruction: restart address, then the handler.
  raise(f) {
    this.regs[SP] = this.spStart;
    this.ip = this.lastIP;
    this.repState = null;
    this.exception(f.vec, f.err);
  }
  // Start an exception handler. A contributory fault during the start of a contributory
  // exception gives #DF; a fault during the start of #DF shuts the processor down.
  exception(vec, err) {
    for (;;) {
      const sp = this.regs[SP];
      try { this.intr(vec, 'exc', err); this.ext = 0; return; } catch (e) {
        if (!(e instanceof Fault286)) throw e;
        this.regs[SP] = sp;
        if (vec === 8) { this.shutdown(); return; }
        if (P286_CONTRIB[vec] && P286_CONTRIB[e.vec]) { vec = 8; err = 0; } else { vec = e.vec; err = e.err; }
      }
    }
  }
  // External interrupt (INTR or NMI) at an instruction boundary.
  extInt(vec, src) {
    const sp = this.regs[SP];
    try { this.intr(vec, src, -1); } catch (e) {
      if (!(e instanceof Fault286)) throw e;
      this.regs[SP] = sp;
      this.exception(e.vec, e.err);
    }
    this.ext = 0;
  }
  interrupt(vec, src) { if (src === 'exc') this.exception(vec, -1); else this.extInt(vec, src); }
  divError() { throw this.fault(0); }
  shutdown() {
    this.halted = true; this.shutdownState = true;
    this.busEv('halt', 0, 0, 0, -1);
    if (this.trace) this.ev.push({ k: 'sys', op: 'SHUTDOWN', text: 'triple fault: the processor shuts down' });
    if (this.bus.shutdown) this.bus.shutdown();
  }

  // ---------- main step ----------
  step() {
    const tr = this.trace, bus = this.bus;
    this.clk = 0; this.nEU = 0; this.nStall = 0; this.didFlush = false; this.ilen = 0; this.ext = 0;
    const ws = bus.waitStates;
    this.ws = ws === undefined ? 1 : ws; this.busLen = 2 + this.ws;
    if (!this.pe) {
      const s = this.sregs, c = this.cache;
      if (s[0] !== c[0].sel || s[1] !== c[1].sel || s[2] !== c[2].sel || s[3] !== c[3].sel) this.syncSegs();
    }
    if (tr) {
      this.ev = []; this.euEv = []; this.stallEv = []; this.ibytes = [];
      this.snap = { r: this.regs.slice(), s: this.sregs.slice(), ip: this.ip, f: this.flags, msw: this.msw };
    }
    this.lastBase = this.cache[CS].base;
    this.decIP = this.ip; this.decCS = this.sregs[CS];
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
        this.decIP = this.repState.start;
        this.lastIP = this.repState.start; this.lastCS = this.sregs[CS]; this.spStart = this.regs[SP];
        this.seg = this.repState.seg; this.rep = this.repState.rep;
        this.stringOp(this.repState.op, false);
      } else {
        this.lastIP = this.ip; this.lastCS = this.sregs[CS]; this.spStart = this.regs[SP];
        this.seg = -1; this.rep = 0; this.lock = false;
        let op;
        for (;;) {
          op = this.fetch();
          if ((op & 0xE7) === 0x26) this.seg = (op >> 3) & 3;
          else if (op === 0xF2 || op === 0xF3) this.rep = op - 0xF1;
          else if (op === 0xF0 || op === 0xF1) this.lock = true;
          else break;
        }
        // LOCK is IOPL-sensitive in protected mode.
        if (this.lock && this.pe && this.cpl > this.iopl) throw this.fault(13, 0);
        this.op = op;
        this.exec(op);
        this.instructions++;
      }
      if (trapBefore && !this.repState) this.exception(1, -1);
    } catch (e) {
      if (!(e instanceof Fault286)) throw e;
      this.raise(e);
    }
    return this.finish(null, this.halted);
  }

  // Timeline: stall fetches, EU bus cycles over the instruction, prefetches in the free
  // bus slots (not after a queue flush: the "+m" of the data sheet shows as stall fetches
  // of the next instruction).
  finish(text, halted) {
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
        while (room >= BL && this.q.length <= 4) { this.prefetch(false); room -= BL; }
      }
      this.cycles += T;
      return T;
    }
    const slack = T - minT, gap = Math.floor(slack / (n + 1));
    let pos = S, ei = 0;
    const placed = [];
    for (let g = 0; g <= n; g++) {
      let room = g === n ? T - pos : gap;
      while (room >= BL && canFetch && this.q.length <= 4) {
        const before = this.ev.length;
        this.prefetch(false);
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
    const cs = this.decCS, ip = this.decIP, base = this.lastBase;
    let dtext = text;
    if (!dtext) {
      if (typeof Disasm86 !== 'undefined') {
        const bus = this.bus;
        dtext = Disasm86.decode(i => bus.read8((base + ((ip + i) & 0xFFFF)) & 0xFFFFFF), ip, { cpu: '286' }).text;
      } else dtext = 'op ' + (this.op | 0).toString(16);
      if (this.repStateText) dtext += this.repStateText;
    }
    out.push({ k: 'decode', t: 0, cs, ip, len: this.ibytes.length, text: dtext, bytes: this.ibytes.slice() });
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
    for (let i = 0; i < 8; i++) if (sn.r[i] !== this.regs[i]) out.push({ k: 'reg', t: T - 1, r: REG16[i], v: this.regs[i] });
    for (let i = 0; i < 4; i++) if (sn.s[i] !== this.sregs[i]) out.push({ k: 'reg', t: T - 1, r: SREG[i], v: this.sregs[i] });
    if (sn.f !== this.flags) out.push({ k: 'flags', t: T - 1, v: this.flags, old: sn.f });
    if (sn.msw !== this.msw) out.push({ k: 'reg', t: T - 1, r: 'MSW', v: this.msw });
    out.push({ k: 'reg', t: T - 1, r: 'IP', v: this.ip });
    // Decoded-instruction queue depth (an estimate from the bytes in the prefetch queue).
    out.push({ k: 'iq', t: T - 1, n: Math.min(3, this.q.length >> 1) });
    out.push({ k: 'end', t: T });
    out.sort((a, b) => a.t - b.t);
    this.trace = out;
    this.repStateText = null;
    return T;
  }

  // ---------- instruction execution ----------
  exec(op) {
    const R = this.regs;
    if (op < 0x40 && (op & 7) < 6) {
      const alu = op >> 3, form = op & 7, w = op & 1;
      if (form < 4) {
        this.modrm();
        if (form < 2) {
          const a = this.getE(w), r = this.alu(alu, a, this.getG(w), w);
          if (alu !== 7) this.setE(w, r);
          this.rc(2, 7);
        } else {
          const r = this.alu(alu, this.getG(w), this.getE(w), w);
          if (alu !== 7) this.setG(w, r);
          this.rc(2, alu === 7 ? 6 : 7);
        }
      } else {
        if (w) { const r = this.alu(alu, R[AX], this.fetchW(), 1); if (alu !== 7) R[AX] = r; }
        else { const r = this.alu(alu, R[AX] & 0xFF, this.fetch(), 0); if (alu !== 7) this.w8(0, r); }
        this.clk += 3;
      }
      return;
    }
    if (op >= 0x40 && op < 0x60) {
      const r = op & 7;
      if (op < 0x48) { const cf = this.f & F_CF; R[r] = this.add(R[r], 1, 0, 1); this.f = (this.f & ~F_CF) | cf; this.aluNote('INC', (R[r] - 1) & 0xFFFF, 1, R[r], 1); this.clk += 2; }
      else if (op < 0x50) { const cf = this.f & F_CF; R[r] = this.sub(R[r], 1, 0, 1); this.f = (this.f & ~F_CF) | cf; this.aluNote('DEC', (R[r] + 1) & 0xFFFF, 1, R[r], 1); this.clk += 2; }
      else if (op < 0x58) { this.push(R[r]); this.clk += 3; }          // PUSH SP pushes the old SP
      else { const v = this.rw(SS, R[SP]); R[SP] += 2; R[r] = v; this.clk += 5; }
      return;
    }
    if (op >= 0x70 && op < 0x80) {
      const d = this.fetchS8();
      if (this.cond(op & 15)) { this.jump(this.ip + d); this.clk += 7; } else this.clk += 3;
      return;
    }
    if (op >= 0x91 && op <= 0x97) {
      const r = op & 7, t = R[AX]; R[AX] = R[r]; R[r] = t; this.clk += 3; return;
    }
    if (op >= 0xB0 && op <= 0xBF) {
      if (op & 8) R[op & 7] = this.fetchW(); else this.w8(op & 7, this.fetch());
      this.clk += 2; return;
    }
    if (op >= 0xD8 && op <= 0xDF) { this.esc(op); return; }

    switch (op) {
      case 0x06: case 0x0E: case 0x16: case 0x1E: this.push(this.sregs[op >> 3]); this.clk += 3; return;
      case 0x07: case 0x17: case 0x1F: {
        const i = op >> 3, v = this.rw(SS, R[SP]);
        this.loadSeg(i, v);
        R[SP] += 2;
        this.clk += this.pe ? 20 : 5;
        if (i === SS) this.inhibit = true;
        return;
      }
      case 0x0F: this.exec0F(); return;
      case 0x27: this.daa286(false); return;
      case 0x2F: this.daa286(true); return;
      case 0x37: this.aaa286(false); return;
      case 0x3F: this.aaa286(true); return;
      case 0x60: {                                   // PUSHA
        const t = R[SP];
        for (let i = 0; i < 8; i++) this.push(i === SP ? t : R[i]);
        this.clk += 17; return;
      }
      case 0x61: {                                   // POPA: no register changes on a fault
        const v = [];
        for (let i = 0; i < 8; i++) v.push(this.rw(SS, (R[SP] + 2 * i) & 0xFFFF));
        for (let i = 0; i < 8; i++) if (7 - i !== SP) R[7 - i] = v[i];
        R[SP] += 16;
        this.clk += 19; return;
      }
      case 0x62: {                                   // BOUND
        this.modrm(); this.memOnly();
        const lo = this.rw(this.eaSeg, this.eaOff), hi = this.rw(this.eaSeg, (this.eaOff + 2) & 0xFFFF);
        const v = (R[this.reg] << 16) >> 16;
        this.clk += 13;
        if (v < ((lo << 16) >> 16) || v > ((hi << 16) >> 16)) throw this.fault(5);
        return;
      }
      case 0x63: {                                   // ARPL (protected mode only)
        if (!this.pe) throw this.fault(6);
        this.modrm();
        const dst = this.getE(1), src = this.getG(1);
        if ((dst & 3) < (src & 3)) { this.setE(1, (dst & ~3) | (src & 3)); this.f |= F_ZF; } else this.f &= ~F_ZF;
        this.rc(10, 11); return;
      }
      case 0x68: this.push(this.fetchW()); this.clk += 3; return;
      case 0x6A: this.push(this.fetchS8() & 0xFFFF); this.clk += 3; return;
      case 0x69: case 0x6B: {                        // IMUL r16, r/m16, imm
        this.modrm();
        const a = (this.getE(1) << 16) >> 16;
        const b = op === 0x69 ? (this.fetchW() << 16) >> 16 : this.fetchS8();
        const r = a * b, lo = r & 0xFFFF;
        this.setG(1, lo);
        this.f = r !== ((lo << 16) >> 16) ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
        this.szp((r >> 16) & 0xFFFF, 1); this.f &= ~F_AF;      // SF ZF PF come from the high word
        this.aluNote('IMUL', a & 0xFFFF, b & 0xFFFF, lo, 1);
        this.rc(21, 24); return;
      }
      case 0x6C: case 0x6D: case 0x6E: case 0x6F:
        this.ioCheck(); this.stringOp(op, true); return;
      case 0x80: case 0x81: case 0x82: case 0x83: {
        const w = op & 1;
        this.modrm();
        const a = this.getE(w);
        const b = op === 0x81 ? this.fetchW() : op === 0x83 ? this.fetchS8() & 0xFFFF : this.fetch();
        const r = this.alu(this.reg, a, b, w);
        if (this.reg !== 7) this.setE(w, r);
        this.rc(3, this.reg === 7 ? 6 : 7);
        return;
      }
      case 0x84: case 0x85: {
        const w = op & 1; this.modrm();
        const g = this.getG(w), r = this.getE(w) & g; this.logic(r, w);
        this.aluNote('TEST', g, r, r, w);
        this.rc(2, 6); return;
      }
      case 0x86: case 0x87: {
        const w = op & 1; this.modrm();
        const a = this.getE(w), b = this.getG(w);
        this.setE(w, b); this.setG(w, a);
        this.rc(3, 5); return;
      }
      case 0x88: case 0x89: { const w = op & 1; this.modrm(); this.setE(w, this.getG(w)); this.rc(2, 3); return; }
      case 0x8A: case 0x8B: { const w = op & 1; this.modrm(); this.setG(w, this.getE(w)); this.rc(2, 5); return; }
      case 0x8C:
        this.modrm();
        if (this.reg > 3) throw this.fault(6);
        this.setE(1, this.sregs[this.reg]); this.rc(2, 3); return;
      case 0x8D: this.modrm(); this.memOnly(); R[this.reg] = this.eaOff; this.clk += 3; return;
      case 0x8E: {
        this.modrm();
        const i = this.reg;
        if (i === CS || i > 3) throw this.fault(6);
        this.loadSeg(i, this.getE(1));
        if (this.pe) this.rc(17, 19); else this.rc(2, 5);
        if (i === SS) this.inhibit = true;
        return;
      }
      case 0x8F: {
        this.modrm();
        if (this.reg !== 0) throw this.fault(6);
        const v = this.rw(SS, R[SP]);
        R[SP] += 2;
        this.spStart = R[SP];                        // SP stays incremented when the store faults
        this.setE(1, v); this.clk += 5; return;
      }
      case 0x90: this.clk += 3; return;
      case 0x98: R[AX] = (R[AX] & 0x80) ? R[AX] | 0xFF00 : R[AX] & 0xFF; this.clk += 2; return;
      case 0x99: R[DX] = (R[AX] & 0x8000) ? 0xFFFF : 0; this.clk += 2; return;
      case 0x9A: { const ip = this.fetchW(), cs = this.fetchW(); this.farJmp(cs, ip, true, 0); return; }
      case 0x9B: {                                   // WAIT
        if ((this.msw & 0xA) === 0xA) throw this.fault(7);
        if (this.fpuError && this.fpuError()) throw this.fault(16);
        const fpu = this.bus.fpu, busy = fpu ? fpu.busyCycles : 0;
        this.clk += 3 + busy;
        if (fpu) fpu.busyCycles = 0;
        return;
      }
      case 0x9C: this.push(this.flags); this.clk += 3; return;
      case 0x9D: {
        const v = this.pop();
        if (this.pe) this.setFlagsPM(v, this.cpl); else this.flags = v;
        this.clk += 5; return;
      }
      case 0x9E: this.f = (this.f & ~0xD5) | ((R[AX] >> 8) & 0xD5); this.clk += 2; return;
      case 0x9F: this.w8(4, this.flags & 0xFF); this.clk += 2; return;
      case 0xA0: case 0xA1: case 0xA2: case 0xA3: {
        const off = this.fetchW(), s = this.seg >= 0 ? this.seg : DS, w = op & 1;
        if (this.trace) this.ev.push({ k: 'ea', seg: SREG[s], segv: this.sregs[s], off, phys: this.phys(s, off) });
        if (op < 0xA2) { if (w) R[AX] = this.rw(s, off); else this.w8(0, this.rb(s, off)); this.clk += 5; }
        else { if (w) this.ww(s, off, R[AX]); else this.wb(s, off, R[AX]); this.clk += 3; }
        return;
      }
      case 0xA4: case 0xA5: case 0xA6: case 0xA7: case 0xAA: case 0xAB:
      case 0xAC: case 0xAD: case 0xAE: case 0xAF:
        this.stringOp(op, true); return;
      case 0xA8: { const b = this.fetch(), r = R[AX] & 0xFF & b; this.logic(r, 0); this.aluNote('TEST', R[AX] & 0xFF, b, r, 0); this.clk += 3; return; }
      case 0xA9: { const b = this.fetchW(), r = R[AX] & b; this.logic(r, 1); this.aluNote('TEST', R[AX], b, r, 1); this.clk += 3; return; }
      case 0xC0: case 0xC1: case 0xD0: case 0xD1: case 0xD2: case 0xD3: this.shiftGroup(op); return;
      case 0xC2: { const n = this.fetchW(), ip = this.pop(); R[SP] += n; this.jump(ip); this.clk += 11; return; }
      case 0xC3: this.jump(this.pop()); this.clk += 11; return;
      case 0xC4: case 0xC5: {
        this.modrm(); this.memOnly();
        const off = this.rw(this.eaSeg, this.eaOff), sel = this.rw(this.eaSeg, (this.eaOff + 2) & 0xFFFF);
        this.loadSeg(op === 0xC4 ? ES : DS, sel);
        R[this.reg] = off;
        this.clk += this.pe ? 21 : 7; return;
      }
      case 0xC6: case 0xC7: {
        this.modrm();
        if (this.reg !== 0) throw this.fault(6);
        if (op === 0xC6) this.setE(0, this.fetch()); else this.setE(1, this.fetchW());
        this.rc(2, 3); return;
      }
      case 0xC8: this.enter(); return;
      case 0xC9: { R[SP] = R[BP]; R[BP] = this.pop(); this.clk += 5; return; }
      case 0xCA: this.retFar(this.fetchW()); return;
      case 0xCB: this.retFar(0); return;
      case 0xCC: this.intr(3, 'sw', -1); return;
      case 0xCD: { const v = this.fetch(); this.intr(v, 'sw', -1); return; }
      case 0xCE: if (this.f & F_OF) { this.clk += 1; this.intr(4, 'sw', -1); } else this.clk += 3; return;
      case 0xCF: this.iret(); return;
      case 0xD4: {                                   // AAM
        const b = this.fetch(), al = R[AX] & 0xFF;
        this.clk += 16;
        if (b === 0) {
          // Undefined flags. The 80286 divide step leaves SF ZF PF of (dividend >> 1); for
          // AAM the dividend is AL (matches all hardware samples).
          this.szp(al >> 1, 0);
          throw this.fault(0);
        }
        this.w8(4, Math.floor(al / b)); this.w8(0, al % b);
        this.logic(R[AX] & 0xFF, 0);
        this.aluNote('AAM', al, b, R[AX], 1);
        return;
      }
      case 0xD5: {                                   // AAD
        const b = this.fetch(), al = R[AX] & 0xFF, ah = R[AX] >> 8;
        const r = this.add(al, (ah * b) & 0xFF, 0, 0);
        R[AX] = r;
        this.aluNote('AAD', al, b, r, 1);
        this.clk += 14; return;
      }
      case 0xD6: this.w8(0, this.f & F_CF ? 0xFF : 0); this.clk += 2; return;
      case 0xD7: {
        const s = this.seg >= 0 ? this.seg : DS, off = (R[BX] + (R[AX] & 0xFF)) & 0xFFFF;
        if (this.trace) this.ev.push({ k: 'ea', seg: SREG[s], segv: this.sregs[s], off, phys: this.phys(s, off) });
        this.w8(0, this.rb(s, off)); this.clk += 5; return;
      }
      case 0xE0: case 0xE1: case 0xE2: {
        const d = this.fetchS8();
        const cx = (R[CX] - 1) & 0xFFFF;
        const zf = !!(this.f & F_ZF);
        const take = cx !== 0 && (op === 0xE2 || (op === 0xE1 ? zf : !zf));
        if (take) this.jump(this.ip + d);
        R[CX] = cx;
        this.clk += take ? 8 : 4;
        return;
      }
      case 0xE3: { const d = this.fetchS8(); if (R[CX] === 0) { this.jump(this.ip + d); this.clk += 8; } else this.clk += 4; return; }
      case 0xE4: { const p = this.fetch(); this.ioCheck(); this.w8(0, this.inb(p)); this.clk += 5; return; }
      case 0xE5: { const p = this.fetch(); this.ioCheck(); R[AX] = this.inw(p); this.clk += 5; return; }
      case 0xE6: { const p = this.fetch(); this.ioCheck(); this.outb(p, R[AX]); this.clk += 3; return; }
      case 0xE7: { const p = this.fetch(); this.ioCheck(); this.outw(p, R[AX]); this.clk += 3; return; }
      case 0xE8: { const d = this.fetchW(), t = this.ip + d; this.push(this.ip); this.jump(t); this.clk += 7; return; }
      case 0xE9: { const d = this.fetchW(); this.jump(this.ip + d); this.clk += 7; return; }
      case 0xEA: { const ip = this.fetchW(), cs = this.fetchW(); this.farJmp(cs, ip, false, 0); return; }
      case 0xEB: { const d = this.fetchS8(); this.jump(this.ip + d); this.clk += 7; return; }
      case 0xEC: this.ioCheck(); this.w8(0, this.inb(R[DX])); this.clk += 5; return;
      case 0xED: this.ioCheck(); R[AX] = this.inw(R[DX]); this.clk += 5; return;
      case 0xEE: this.ioCheck(); this.outb(R[DX], R[AX]); this.clk += 3; return;
      case 0xEF: this.ioCheck(); this.outw(R[DX], R[AX]); this.clk += 3; return;
      case 0xF4:                                     // HLT (CPL 0 in protected mode)
        if (this.pe && this.cpl) throw this.fault(13, 0);
        this.halted = true; this.clk += 2;
        this.busEv('halt', 2, 0, 0, -1);
        return;
      case 0xF5: this.f ^= F_CF; this.clk += 2; return;
      case 0xF6: case 0xF7: this.group3(op & 1); return;
      case 0xF8: this.f &= ~F_CF; this.clk += 2; return;
      case 0xF9: this.f |= F_CF; this.clk += 2; return;
      case 0xFA: this.ioCheck(); this.f &= ~F_IF; this.clk += 3; return;
      case 0xFB: this.ioCheck(); this.f |= F_IF; this.clk += 2; this.inhibit = true; return;
      case 0xFC: this.f &= ~F_DF; this.clk += 2; return;
      case 0xFD: this.f |= F_DF; this.clk += 2; return;
      case 0xFE: case 0xFF: this.group45(op & 1); return;
      default: throw this.fault(6);               // 64-67 and other undefined opcodes
    }
  }

  // IN / OUT / INS / OUTS / CLI / STI: CPL <= IOPL in protected mode.
  ioCheck() { if (this.pe && this.cpl > ((this.f >> 12) & 3)) throw this.fault(13, 0); }

  // DAA / DAS as on the 80286: the 0x60 step depends on the old AL > 99h or the old CF;
  // CF also takes the carry (borrow) of the +/-6 step.
  daa286(sub) {
    const R = this.regs, old = R[AX] & 0xFF, ocf = this.f & F_CF;
    let al = old, f = this.f & ~(F_CF | F_AF);
    if ((old & 0x0F) > 9 || (this.f & F_AF)) {
      al = sub ? al - 6 : al + 6;
      if (al < 0 || al > 0xFF) f |= F_CF;
      f |= F_AF;
    }
    if (old > 0x99 || ocf) { al = sub ? al - 0x60 : al + 0x60; f |= F_CF; }
    al &= 0xFF;
    this.f = f;
    this.w8(0, al); this.szp(al, 0);
    if (sub ? (old & 0x80) && !(al & 0x80) : !(old & 0x80) && (al & 0x80)) this.f |= F_OF; else this.f &= ~F_OF;
    this.aluNote(sub ? 'DAS' : 'DAA', old, 0, al, 0);
    this.clk += 3;
  }

  // AAA / AAS as on the 80286: the +/-6 correction is applied to AX.
  aaa286(sub) {
    const R = this.regs, old = R[AX] & 0xFF;
    if ((old & 0x0F) > 9 || (this.f & F_AF)) {
      R[AX] = sub ? ((R[AX] - 6) & 0xFFFF) - 0x100 : R[AX] + 0x106;
      this.f |= F_AF | F_CF;
    } else this.f &= ~(F_AF | F_CF);
    this.w8(0, R[AX] & 0x0F);
    this.szp(old, 0);
    this.aluNote(sub ? 'AAS' : 'AAA', old, 0, R[AX] & 0xFF, 0);
    this.clk += 3;
  }

  shiftGroup(op) {
    const w = op & 1;
    this.modrm();
    const one = op === 0xD0 || op === 0xD1;
    const n = one ? 1 : op >= 0xD2 ? this.regs[CX] & 0x1F : this.fetch() & 0x1F;
    const v = this.getE(w);
    // reg 6 is an alias of SHL (reg 4) on the 80286.
    if (n) this.setE(w, this.shift(this.reg === 6 ? 4 : this.reg, v, n, w));
    if (one) this.rc(2, 7); else this.rc(5 + n, 8 + n);
  }

  group3(w) {
    const R = this.regs;
    this.modrm();
    const v = this.getE(w), m = w ? 0xFFFF : 0xFF;
    switch (this.reg) {
      case 0: case 1: {
        const b = w ? this.fetchW() : this.fetch(), r = v & b;
        this.logic(r, w); this.aluNote('TEST', v, b, r, w); this.rc(3, 6); return;
      }
      case 2: this.setE(w, ~v & m); this.aluNote('NOT', v, 0, ~v & m, w); this.rc(2, 7); return;
      case 3: { const r = this.sub(0, v, 0, w); this.setE(w, r); this.aluNote('NEG', 0, v, r, w); this.rc(2, 7); return; }
      case 4: case 5: {
        const a0 = R[AX];
        if (this.reg === 4) {
          let hi;
          if (w) { const r = R[AX] * v; R[AX] = r & 0xFFFF; R[DX] = hi = Math.floor(r / 65536) & 0xFFFF; }
          else { const r = (R[AX] & 0xFF) * v; R[AX] = r; hi = r >> 8; }
          this.f = hi ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
        } else if (w) {
          const r = ((R[AX] << 16) >> 16) * ((v << 16) >> 16);
          R[AX] = r & 0xFFFF; R[DX] = (r >> 16) & 0xFFFF;
          const ext = (R[AX] & 0x8000) ? 0xFFFF : 0;
          this.f = R[DX] !== ext ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
        } else {
          const r = (((R[AX] & 0xFF) << 24) >> 24) * ((v << 24) >> 24);
          R[AX] = r & 0xFFFF;
          const ext = (R[AX] & 0x80) ? 0xFF : 0;
          this.f = (R[AX] >> 8) !== ext ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
        }
        this.szp(w ? R[AX] : R[AX] & 0xFF, w);
        this.f &= ~F_AF;
        this.aluNote(this.reg === 4 ? 'MUL' : 'IMUL', a0, v, w ? (R[DX] * 65536 + R[AX]) : R[AX], w);
        this.rc(w ? 21 : 13, w ? 24 : 16);
        return;
      }
      default: {
        const signed = this.reg === 7;
        this.rc(signed ? (w ? 25 : 17) : (w ? 22 : 14), signed ? (w ? 28 : 20) : (w ? 25 : 17));
        if (v === 0) {
          // Undefined flags; for DIV the 80286 leaves SF ZF PF of (dividend >> 1).
          if (!signed) this.szp(w ? ((R[DX] * 65536 + R[AX]) >>> 1) & 0xFFFF : R[AX] >> 1 & 0xFF, w);
          throw this.fault(0);
        }
        let q, rem;
        if (!signed) {
          const num = w ? R[DX] * 65536 + R[AX] : R[AX];
          q = Math.floor(num / v); rem = num % v;
          if (q > m) throw this.fault(0);
        } else {
          const num = w ? ((R[DX] << 16) | R[AX]) : (R[AX] << 16) >> 16;
          const d = w ? (v << 16) >> 16 : (v << 24) >> 24;
          q = Math.trunc(num / d); rem = num - q * d;
          const lim = w ? 0x8000 : 0x80;
          if (q > lim - 1 || q < -lim) {
            // 80286 quirk (seen on hardware for IDIV r/m8): with a negative result and
            // |dividend| = lim * (|divisor| + lim) + r, 0 <= r < |divisor|, there is no #DE;
            // the quotient is -lim and the remainder is r with the sign of the dividend.
            const a = Math.abs(num), b = Math.abs(d), r = a - lim * (b + lim);
            if ((num < 0) === (d < 0) || r < 0 || r >= b) throw this.fault(0);
            q = -lim; rem = num < 0 ? -r : r;
          }
        }
        if (w) { R[AX] = q & 0xFFFF; R[DX] = rem & 0xFFFF; } else R[AX] = (q & 0xFF) | ((rem & 0xFF) << 8);
        this.aluNote(signed ? 'IDIV' : 'DIV', 0, v, q & m, w);
      }
    }
  }

  group45(w) {
    const R = this.regs;
    this.modrm();
    const reg = this.reg;
    if (!w && reg > 1) throw this.fault(6);
    switch (reg) {
      case 0: case 1: {
        const v = this.getE(w), cf = this.f & F_CF;
        const r = reg === 0 ? this.add(v, 1, 0, w) : this.sub(v, 1, 0, w);
        this.f = (this.f & ~F_CF) | cf;
        this.setE(w, r); this.aluNote(reg === 0 ? 'INC' : 'DEC', v, 1, r, w);
        this.rc(2, 7); return;
      }
      case 2: { const t = this.getE(1); this.push(this.ip); this.jump(t); this.rc(7, 11); return; }
      case 3: {
        this.memOnly();
        const ip = this.rw(this.eaSeg, this.eaOff), cs = this.rw(this.eaSeg, (this.eaOff + 2) & 0xFFFF);
        this.farJmp(cs, ip, true, 3); return;
      }
      case 4: this.jump(this.getE(1)); this.rc(7, 11); return;
      case 5: {
        this.memOnly();
        const ip = this.rw(this.eaSeg, this.eaOff), cs = this.rw(this.eaSeg, (this.eaOff + 2) & 0xFFFF);
        this.farJmp(cs, ip, false, this.pe ? 3 : 4); return;
      }
      default: { const v = this.getE(1); this.push(v); this.rc(3, 5); }
    }
  }

  enter() {
    const R = this.regs, size = this.fetchW(), level = this.fetch() & 0x1F;
    this.push(R[BP]);
    const frame = R[SP];
    if (level > 0) {
      let bp = R[BP];
      for (let i = 1; i < level; i++) { bp = (bp - 2) & 0xFFFF; this.push(this.rw(SS, bp)); }
      this.push(frame);
    }
    R[BP] = frame;
    R[SP] = (R[SP] - size) & 0xFFFF;
    this.clk += level === 0 ? 11 : level === 1 ? 15 : 12 + 4 * (level - 1);
  }

  // String instructions, one iteration per step() when a REP prefix is active.
  stringOp(op, first) {
    const R = this.regs, w = op & 1, d = (this.f & F_DF) ? -(w + 1) : (w + 1);
    const src = this.seg >= 0 ? this.seg : DS, kind = op & 0xFE;
    if (this.rep && first) {
      this.clk += kind === 0xAA ? 4 : 5;
      if (R[CX] === 0) { this.repState = null; return; }
    }
    const rep = this.rep;
    // The 80286 moves SI / DI when it starts the access. When an access faults inside
    // REP, CX is already 1 lower for a read and 2 lower for a write (the next iteration
    // starts before the write completes). CMPS reads ES:DI first.
    let dec = 1;
    try {
      switch (kind) {
        case 0x6C: {
          const v = w ? this.inw(R[DX]) : this.inb(R[DX]);
          const o = R[DI]; R[DI] += d; dec = 2;
          if (w) this.ww(ES, o, v); else this.wb(ES, o, v);
          this.clk += rep ? 4 : 5; break;
        }
        case 0x6E: {
          const o = R[SI]; R[SI] += d;
          const v = w ? this.rw(src, o) : this.rb(src, o);
          if (w) this.outw(R[DX], v); else this.outb(R[DX], v);
          this.clk += rep ? 4 : 5; break;
        }
        case 0xA4: {
          const o = R[SI]; R[SI] += d;
          const v = w ? this.rw(src, o) : this.rb(src, o);
          const p = R[DI]; R[DI] += d; dec = 2;
          if (w) this.ww(ES, p, v); else this.wb(ES, p, v);
          this.clk += rep ? 4 : 5; break;
        }
        case 0xA6: {
          const p = R[DI]; R[DI] += d; dec = 0;
          const b = w ? this.rw(ES, p) : this.rb(ES, p);
          const o = R[SI]; R[SI] += d; dec = 1;
          const a = w ? this.rw(src, o) : this.rb(src, o);
          this.sub(a, b, 0, w); this.aluNote('CMP', a, b, (a - b) & (w ? 0xFFFF : 0xFF), w);
          this.clk += rep ? 9 : 8; break;
        }
        case 0xAA: { const p = R[DI]; R[DI] += d; dec = 2; if (w) this.ww(ES, p, R[AX]); else this.wb(ES, p, R[AX]); this.clk += 3; break; }
        case 0xAC: { const o = R[SI]; R[SI] += d; if (w) R[AX] = this.rw(src, o); else this.w8(0, this.rb(src, o)); this.clk += rep ? 4 : 5; break; }
        case 0xAE: {
          const p = R[DI]; R[DI] += d;
          const a = w ? R[AX] : R[AX] & 0xFF, b = w ? this.rw(ES, p) : this.rb(ES, p);
          this.sub(a, b, 0, w); this.aluNote('CMP', a, b, (a - b) & (w ? 0xFFFF : 0xFF), w);
          this.clk += rep ? 8 : 7; break;
        }
      }
    } catch (e) {
      if (rep && e instanceof Fault286) R[CX] -= dec;
      throw e;
    }
    if (!rep) { this.repState = null; return; }
    R[CX]--;
    let more = R[CX] !== 0;
    if (more && (kind === 0xA6 || kind === 0xAE)) {
      const zf = !!(this.f & F_ZF);
      more = rep === 2 ? zf : !zf;
    }
    if (more) {
      const start = this.repState ? this.repState.start : this.lastIP;
      this.repState = { op, seg: this.seg, rep, start };
      this.repStateText = '  ; CX=' + R[CX].toString(16).toUpperCase().padStart(4, '0') + 'h';
    } else this.repState = null;
  }

  // ---------- 80287 interface ----------
  // The 80286 sends the opcode to port 00F8h and the instruction and operand pointers to
  // 00FCh, and moves the memory operand itself (memory cycles and port 00FAh).
  esc(op) {
    if (this.msw & 0xC) throw this.fault(7);        // EM or TS: #NM
    this.modrm();
    const fpu = this.bus.fpu, mem = this.mod !== 3;
    const modrm = (this.mod << 6) | (this.reg << 3) | this.rm;
    const control = mem ? (op === 0xD9 || op === 0xDD) && this.reg >= 4
      : (op === 0xDB && modrm >= 0xE0 && modrm <= 0xE4) || (op === 0xDF && modrm === 0xE0);
    if (!control && this.fpuError && this.fpuError()) throw this.fault(16);
    if (mem) {
      // The 80286 checks the first word of the operand (offset FFFFh gives #GP in real
      // mode). An operand that goes past the limit gives #9 (segment overrun).
      const d = this.cache[this.eaSeg], off = this.eaOff;
      const info = fpu && fpu.memOperand ? fpu.memOperand(op, modrm) : null;
      if (off < d.lo || off >= d.hi || (info && (info.write ? !d.wr : !d.rd))) this.segFault(this.eaSeg);
      if (info && off + info.bytes - 1 > d.hi) throw this.fault(9);
    }
    this.fpuIO('iow', 0xF8, op | (modrm << 8));
    this.fpuIO('iow', 0xFC, this.lastIP);
    this.fpuIO('iow', 0xFC, this.lastCS);
    if (mem) { this.fpuIO('iow', 0xFC, this.eaOff); this.fpuIO('iow', 0xFC, this.sregs[this.eaSeg]); }
    this.clk += 9;
    if (!fpu) return;
    // The 80286 waits for the 80287 BUSY line before it sends the next ESC instruction.
    if (fpu.busyCycles > 0) { this.clk += fpu.busyCycles; fpu.busyCycles = 0; }
    const ea = mem ? { seg: this.sregs[this.eaSeg], off: this.eaOff, base: this.cache[this.eaSeg].base } : null;
    fpu.instrPtr = (this.lastBase + this.lastIP) & 0xFFFFFF;
    fpu.nextIpOff = this.lastIP; fpu.nextIpSel = this.lastCS;
    const res = fpu.exec(op, modrm, ea) || { cycles: 0 };
    if (res.ax !== undefined) this.regs[AX] = res.ax & 0xFFFF;
    const lm = fpu.lastMem;
    if (lm && lm.length) {
      for (let i = 0; i < lm.length; i += 2) {
        const m0 = lm[i], m1 = lm[i + 1] && lm[i + 1].write === m0.write ? lm[i + 1] : null;
        const v = m0.value | (m1 ? m1.value << 8 : 0), width = m1 ? 2 : 1;
        if (!m1) i--;
        if (m0.write) { this.fpuIO('ior', 0xFA, v); this.memEvFpu('memw', m0.addr, v, width); }
        else { this.memEvFpu('memr', m0.addr, v, width); this.fpuIO('iow', 0xFA, v); }
      }
    }
    if (this.trace) this.ev.push({ k: 'fpu', text: res.text || '', cycles: res.cycles || 0 });
  }
  memEvFpu(type, a, v, width) {
    this.nEU++;
    const st = this.bus.stats;
    if (st) countCycle(st, type);
    if (this.trace) this.euEv.push({ k: 'bus', type, addr: a, data: v, width, seg: null, dev: this.bus.devAt ? this.bus.devAt(a) : 'ram', owner: 'cpu', len: this.busLen });
  }

  // ---------- 0F: system instructions ----------
  sysEv(op, text) { if (this.trace) this.ev.push({ k: 'sys', op, text }); }
  priv0() { if (this.pe && this.cpl !== 0) throw this.fault(13, 0); }
  exec0F() {
    const R = this.regs, op2 = this.fetch();
    const h4 = v => v.toString(16).toUpperCase().padStart(4, '0'), h6 = v => v.toString(16).toUpperCase().padStart(6, '0');
    switch (op2) {
      case 0x00: {
        this.modrm();
        if (!this.pe) throw this.fault(6);
        switch (this.reg) {
          case 0: this.setE(1, this.ldtr.sel); this.rc(2, 3); return;
          case 1: this.setE(1, this.tr.sel); this.rc(2, 3); return;
          case 2: { this.priv0(); const s = this.getE(1); this.lldt(s); this.rc(17, 19); this.sysEv('LLDT', `LDTR = ${h4(s)} (base ${h6(this.ldtr.base)}, limit ${h4(this.ldtr.limit)})`); return; }
          case 3: { this.priv0(); const s = this.getE(1); this.ltr(s); this.rc(17, 19); this.sysEv('LTR', `TR = ${h4(s)} (base ${h6(this.tr.base)}, limit ${h4(this.tr.limit)})`); return; }
          case 4: case 5: {
            const s = this.getE(1), ok = this.verify(s, this.reg === 5);
            this.f = ok ? this.f | F_ZF : this.f & ~F_ZF;
            this.rc(14, 16); this.sysEv(this.reg === 5 ? 'VERW' : 'VERR', `${h4(s)}: ZF = ${ok ? 1 : 0}`); return;
          }
          default: throw this.fault(6);
        }
      }
      case 0x01: {
        this.modrm();
        const reg = this.reg;
        if (reg < 4) {
          this.memOnly();
          const t = reg & 1 ? this.idtr : this.gdtr, name = reg & 1 ? 'IDTR' : 'GDTR';
          const s = this.eaSeg, o = this.eaOff;
          if (reg < 2) {                                 // SGDT / SIDT: byte 5 is stored as FFh
            this.ww(s, o, t.limit); this.ww(s, (o + 2) & 0xFFFF, t.base & 0xFFFF); this.ww(s, (o + 4) & 0xFFFF, 0xFF00 | (t.base >> 16));
            this.clk += reg & 1 ? 12 : 11;
            this.sysEv(reg & 1 ? 'SIDT' : 'SGDT', `store ${name}`);
          } else {                                       // LGDT / LIDT
            this.priv0();
            const limit = this.rw(s, o), b0 = this.rw(s, (o + 2) & 0xFFFF), b1 = this.rw(s, (o + 4) & 0xFFFF);
            t.limit = limit; t.base = b0 | ((b1 & 0xFF) << 16);
            this.clk += reg & 1 ? 12 : 11;
            this.sysEv(reg & 1 ? 'LIDT' : 'LGDT', `${name} = base ${h6(t.base)}, limit ${h4(t.limit)}`);
          }
          return;
        }
        if (reg === 4) { this.setE(1, this.msw); this.rc(2, 3); return; }
        if (reg === 6) {
          this.priv0();
          const v = this.getE(1);
          this.lmsw(v);
          this.rc(3, 6);
          this.sysEv('LMSW', `MSW = ${h4(this.msw)}${this.msw & 1 ? ' (protected mode)' : ''}`);
          return;
        }
        throw this.fault(6);
      }
      case 0x02: case 0x03: {                          // LAR / LSL
        if (!this.pe) throw this.fault(6);
        this.modrm();
        const s = this.getE(1), d = (s & 0xFFFC) ? this.readDesc(s) : null;
        let ok = false;
        if (d) {
          const a = d.access, dpl = (a >> 5) & 3, t = a & 0x1F;
          const priv = (a & 0x1C) === 0x1C || dpl >= Math.max(this.cpl, s & 3);
          const typeOk = (a & 0x10) ? true : op2 === 0x02 ? t >= 1 && t <= 7 : t >= 1 && t <= 3;
          if (priv && typeOk) { this.setG(1, op2 === 0x02 ? a << 8 : d.limit); ok = true; }
        }
        this.f = ok ? this.f | F_ZF : this.f & ~F_ZF;
        this.rc(14, 16);
        this.sysEv(op2 === 0x02 ? 'LAR' : 'LSL', `${h4(s)}: ZF = ${ok ? 1 : 0}`);
        return;
      }
      case 0x05: this.loadall(); return;
      case 0x06: this.priv0(); this.msw &= ~8; this.clk += 2; this.sysEv('CLTS', 'MSW.TS = 0'); return;
      default: throw this.fault(6);
    }
  }
  // VERR / VERW: ZF = 1 when the segment is readable (writable) at the current CPL.
  verify(sel, write) {
    if (!(sel & 0xFFFC)) return false;
    const d = this.readDesc(sel);
    if (!d) return false;
    const a = d.access, dpl = (a >> 5) & 3;
    if (!(a & 0x10)) return false;
    if (a & 8) {
      if (write || !(a & 2)) return false;
      return (a & 4) !== 0 || dpl >= Math.max(this.cpl, sel & 3);
    }
    if (write && !(a & 2)) return false;
    return dpl >= Math.max(this.cpl, sel & 3);
  }
  lmsw(v) {
    const pe = (this.msw | v) & 1;                   // LMSW cannot clear PE
    this.msw = 0xFFF0 | (v & 0xE) | pe;
    if (pe && !this.pe) { this.pe = true; for (const d of this.cache) this.calcCache(d); }
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
    if ((d.access & 0x1F) !== 1) throw this.fsel(13, sel);
    if (!(d.access & 0x80)) throw this.fsel(11, sel);
    d.access |= 2; this.wrSysB(d.addr + 5, d.access);
    Object.assign(this.tr, { sel, base: d.base, limit: d.limit, access: d.access });
  }
  // LOADALL (0F 05, undocumented): all registers and descriptor caches from the 102-byte
  // table at physical 000800h. PE cannot be cleared.
  loadall() {
    this.priv0();
    const T = 0x800, R = this.regs;
    const w = o => this.rdSys(T + o), b = o => this.rdSysB(T + o);
    const msw = w(0x06);
    const pe = (this.msw | msw) & 1;
    this.msw = 0xFFF0 | (msw & 0xE) | pe;
    this.pe = pe === 1;
    const trSel = w(0x16), fl = w(0x18), ip = w(0x1A), ldtSel = w(0x1C);
    const sel = [w(0x24), w(0x22), w(0x20), w(0x1E)];      // ES CS SS DS
    const order = [DI, SI, BP, SP, BX, DX, CX, AX];
    order.forEach((r, i) => { R[r] = w(0x26 + 2 * i); });
    const cacheAt = o => ({ base: w(o) | (b(o + 2) << 16), access: b(o + 3), limit: w(o + 4) });
    [0x36, 0x3C, 0x42, 0x48].forEach((o, i) => { const c = cacheAt(o); this.setCache(i, sel[i], c.base, c.limit, c.access, 'loadall'); });
    const g = cacheAt(0x4E); this.gdtr.base = g.base; this.gdtr.limit = g.limit;
    const l = cacheAt(0x54); Object.assign(this.ldtr, { sel: ldtSel, base: l.base, limit: l.limit, access: l.access, valid: (ldtSel & 0xFFFC) !== 0 });
    const id = cacheAt(0x5A); this.idtr.base = id.base; this.idtr.limit = id.limit;
    const t = cacheAt(0x60); Object.assign(this.tr, { sel: trSel, base: t.base, limit: t.limit, access: t.access });
    this.f = (fl & (this.pe ? 0x7FD5 : 0x0FD5)) | 2;
    this.cpl = this.pe ? (this.cache[CS].access >> 5) & 3 : 0;
    this.ip = ip; this.flush();
    this.clk += 195;
    this.sysEv('LOADALL', 'all registers and descriptor caches loaded from 000800h');
  }
}
