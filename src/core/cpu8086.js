// Intel 8086 CPU core.
// Instruction-level emulator with a functional 6-byte prefetch queue, Intel cycle
// counts and an optional micro-event trace (see ARCHITECTURE.md).

const F_CF = 0x001, F_PF = 0x004, F_AF = 0x010, F_ZF = 0x040, F_SF = 0x080,
  F_TF = 0x100, F_IF = 0x200, F_DF = 0x400, F_OF = 0x800;
const F_ARITH = F_CF | F_PF | F_AF | F_ZF | F_SF | F_OF;

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let b = i, p = 1;
  while (b) { p ^= b & 1; b >>= 1; }
  PARITY[i] = p;
}

const REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
const REG8 = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'];
const SREG = ['ES', 'CS', 'SS', 'DS'];
const ALU_OPS = ['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP'];
const SHIFT_OPS = ['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SETMO', 'SAR'];
const ES = 0, CS = 1, SS = 2, DS = 3;
const AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;

// Count a bus cycle in bus.stats. The two frequent types use named fields: one keyed
// access (st[type]) with many different keys becomes slow in V8, and then all the bus
// cycles become slow.
function countCycle(st, type) {
  if (type === 'memr') st.memr++;
  else if (type === 'memw') st.memw++;
  else st[type]++;
}

class CPU8086 {
  constructor(bus) {
    this.bus = bus;
    // All the fields of all the cores (8086 to 80486) start here, with their value types.
    // A field that code adds later changes the hidden class of the CPU in V8, and then the
    // whole emulator can become 3 times slower (tools/latefields.mjs finds such fields).
    this.clk = 0; this.seg = -1; this.rep = 0; this.op = 0; this.op2 = -1;
    this.mod = -1; this.reg = 0; this.rm = 0; this.eaOff = 0; this.eaSeg = 0; this.eaESP = false;
    this.decIP = 0; this.decCS = 0; this.decBits = 16; this.batch = false;
    this.repStateText = null; this.ibytes = []; this.snap = null;
    this.lastFillEv = null; this.cacheEv = []; this.pfEv = [];
    this.regs = new Uint16Array(8);
    this.sregs = new Uint16Array(4);
    this.ip = 0;
    this.f = 0xF002;
    this.q = [];            // prefetch queue bytes (next byte to execute first)
    this.qip = 0;           // offset in CS of the next byte the BIU will fetch
    this.trace = null;
    this.cycles = 0;
    this.instructions = 0;
    this.halted = false;
    this.repState = null;   // active REP string operation between iterations
    this.lastIP = 0; this.lastCS = 0;
    this.nEU = 0; this.nStall = 0;
    this.ev = []; this.euEv = []; this.stallEv = [];
    this.reset();
  }

  reset() {
    this.regs.fill(0);
    this.sregs.fill(0);
    this.sregs[CS] = 0xFFFF;
    this.ip = 0;
    this.f = 0xF002;
    this.flush();
    this.halted = false;
    this.repState = null;
    this.inhibit = false;
    this.cycles = 0;
    this.instructions = 0;
  }

  get flags() { return (this.f & 0x0FD5) | 0xF002; }
  set flags(v) { this.f = (v & 0x0FD5) | 0xF002; }

  // ---------- register helpers ----------
  r8(i) { const v = this.regs[i & 3]; return i & 4 ? v >> 8 : v & 0xFF; }
  w8(i, v) {
    const k = i & 3;
    this.regs[k] = i & 4 ? (this.regs[k] & 0x00FF) | ((v & 0xFF) << 8) : (this.regs[k] & 0xFF00) | (v & 0xFF);
  }
  phys(s, o) { return ((this.sregs[s] << 4) + (o & 0xFFFF)) & 0xFFFFF; }

  // ---------- bus cycles ----------
  busEv(type, a, v, width, s) {
    this.nEU++;
    const st = this.bus.stats;
    if (st) countCycle(st, type);
    if (this.trace) {
      this.euEv.push({ k: 'bus', type, addr: a, data: v, width, seg: s < 0 ? null : SREG[s],
        dev: this.bus.devAt ? (type === 'ior' || type === 'iow' ? this.bus.ioDevAt(a) : this.bus.devAt(a)) : 'ram', owner: 'cpu' });
    }
  }
  rb(s, o) {
    const a = this.phys(s, o), v = this.bus.read8(a);
    this.busEv('memr', a, v, 1, s);
    return v;
  }
  wb(s, o, v) {
    const a = this.phys(s, o);
    this.bus.write8(a, v & 0xFF);
    this.busEv('memw', a, v & 0xFF, 1, s);
  }
  rw(s, o) {
    const a = this.phys(s, o);
    if (!(a & 1)) {
      const v = this.bus.read8(a) | (this.bus.read8((a + 1) & 0xFFFFF) << 8);
      this.busEv('memr', a, v, 2, s);
      return v;
    }
    this.clk += 4;
    return this.rb(s, o) | (this.rb(s, o + 1) << 8);
  }
  ww(s, o, v) {
    const a = this.phys(s, o);
    if (!(a & 1)) {
      this.bus.write8(a, v & 0xFF);
      this.bus.write8((a + 1) & 0xFFFFF, (v >> 8) & 0xFF);
      this.busEv('memw', a, v & 0xFFFF, 2, s);
      return;
    }
    this.clk += 4;
    this.wb(s, o, v);
    this.wb(s, o + 1, v >> 8);
  }
  rwAbs(a) {
    const v = this.bus.read8(a) | (this.bus.read8(a + 1) << 8);
    this.busEv('memr', a, v, 2, -1);
    return v;
  }
  inb(p) { const v = this.bus.in8(p) & 0xFF; this.busEv('ior', p, v, 1, -1); return v; }
  outb(p, v) { this.bus.out8(p, v & 0xFF); this.busEv('iow', p, v & 0xFF, 1, -1); }
  inw(p) {
    if (!(p & 1)) {
      const v = this.bus.in16 ? this.bus.in16(p) & 0xFFFF : this.bus.in8(p) | (this.bus.in8((p + 1) & 0xFFFF) << 8);
      this.busEv('ior', p, v, 2, -1);
      return v;
    }
    this.clk += 4;
    return this.inb(p) | (this.inb((p + 1) & 0xFFFF) << 8);
  }
  outw(p, v) {
    if (!(p & 1)) {
      if (this.bus.out16) this.bus.out16(p, v & 0xFFFF);
      else { this.bus.out8(p, v & 0xFF); this.bus.out8((p + 1) & 0xFFFF, (v >> 8) & 0xFF); }
      this.busEv('iow', p, v & 0xFFFF, 2, -1);
      return;
    }
    this.clk += 4;
    this.outb(p, v); this.outb((p + 1) & 0xFFFF, v >> 8);
  }
  push(v) { this.regs[SP] -= 2; this.ww(SS, this.regs[SP], v); }
  pop() { const v = this.rw(SS, this.regs[SP]); this.regs[SP] += 2; return v; }

  // ---------- prefetch queue ----------
  flush() { this.q.length = 0; this.qip = this.ip; if (this.trace) this.ev.push({ k: 'queue', op: 'flush', n: 0, q: [] }); }
  // One BIU code fetch: a word from an even address, a byte from an odd one.
  prefetch(stall) {
    const a = this.phys(CS, this.qip);
    let data, width;
    if (!(this.qip & 1)) {
      const b0 = this.bus.read8(a), b1 = this.bus.read8(this.phys(CS, this.qip + 1));
      this.q.push(b0, b1); data = b0 | (b1 << 8); width = 2;
      this.qip = (this.qip + 2) & 0xFFFF;
    } else {
      data = this.bus.read8(a); this.q.push(data); width = 1;
      this.qip = (this.qip + 1) & 0xFFFF;
    }
    if (this.bus.stats) this.bus.stats.fetch++;
    if (this.trace) {
      const e = { k: 'fetch', addr: a, data, width, seg: 'CS', dev: this.bus.devAt ? this.bus.devAt(a) : 'ram', q: this.q.slice() };
      if (stall) this.stallEv.push(e); else this.ev.push(e);
    }
  }
  fetch() {
    if (!this.q.length) { this.nStall++; this.prefetch(true); }
    const b = this.q.shift();
    this.ip = (this.ip + 1) & 0xFFFF;
    if (this.trace) this.ibytes.push(b);
    return b;
  }
  fetchW() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  fetchS8() { return (this.fetch() << 24) >> 24; }

  // ---------- ModR/M ----------
  modrm() {
    const m = this.fetch();
    this.mod = m >> 6; this.reg = (m >> 3) & 7; this.rm = m & 7;
    if (this.mod !== 3) this.calcEA();
  }
  calcEA() {
    const R = this.regs;
    let off, seg = DS, c;
    switch (this.rm) {
      case 0: off = R[BX] + R[SI]; c = 7; break;
      case 1: off = R[BX] + R[DI]; c = 8; break;
      case 2: off = R[BP] + R[SI]; c = 8; seg = SS; break;
      case 3: off = R[BP] + R[DI]; c = 7; seg = SS; break;
      case 4: off = R[SI]; c = 5; break;
      case 5: off = R[DI]; c = 5; break;
      case 6:
        if (this.mod === 0) { off = this.fetchW(); c = 6; } else { off = R[BP]; c = 5; seg = SS; }
        break;
      default: off = R[BX]; c = 5;
    }
    if (this.mod === 1) { off += this.fetchS8(); c += 4; }
    else if (this.mod === 2) { off += this.fetchW(); c += 4; }
    if (this.seg >= 0) { seg = this.seg; c += 2; }
    this.eaOff = off & 0xFFFF; this.eaSeg = seg;
    this.clk += c;
    if (this.trace) this.ev.push({ k: 'ea', seg: SREG[seg], segv: this.sregs[seg], off: this.eaOff, phys: this.phys(seg, this.eaOff) });
  }
  getE(w) {
    if (this.mod === 3) return w ? this.regs[this.rm] : this.r8(this.rm);
    return w ? this.rw(this.eaSeg, this.eaOff) : this.rb(this.eaSeg, this.eaOff);
  }
  setE(w, v) {
    if (this.mod === 3) { if (w) this.regs[this.rm] = v; else this.w8(this.rm, v); }
    else if (w) this.ww(this.eaSeg, this.eaOff, v); else this.wb(this.eaSeg, this.eaOff, v);
  }
  getG(w) { return w ? this.regs[this.reg] : this.r8(this.reg); }
  setG(w, v) { if (w) this.regs[this.reg] = v; else this.w8(this.reg, v); }
  // clocks for "reg" vs "memory" operand forms
  rc(r, m) { this.clk += this.mod === 3 ? r : m; }

  // ---------- flags / ALU ----------
  szp(r, w) {
    let f = this.f & ~(F_SF | F_ZF | F_PF);
    if (!(r & (w ? 0xFFFF : 0xFF))) f |= F_ZF;
    if (r & (w ? 0x8000 : 0x80)) f |= F_SF;
    if (PARITY[r & 0xFF]) f |= F_PF;
    this.f = f;
  }
  add(a, b, c, w) {
    const m = w ? 0xFFFF : 0xFF, s = w ? 0x8000 : 0x80, r = a + b + c;
    let f = this.f & ~(F_CF | F_AF | F_OF);
    if (r > m) f |= F_CF;
    if ((a ^ b ^ r) & 0x10) f |= F_AF;
    if ((a ^ r) & (b ^ r) & s) f |= F_OF;
    this.f = f; this.szp(r, w);
    return r & m;
  }
  sub(a, b, c, w) {
    const m = w ? 0xFFFF : 0xFF, s = w ? 0x8000 : 0x80, r = a - b - c;
    let f = this.f & ~(F_CF | F_AF | F_OF);
    if (r < 0) f |= F_CF;
    if ((a ^ b ^ r) & 0x10) f |= F_AF;
    if ((a ^ b) & (a ^ r) & s) f |= F_OF;
    this.f = f; this.szp(r & m, w);
    return r & m;
  }
  logic(r, w) { this.f &= ~(F_CF | F_AF | F_OF); this.szp(r, w); return r; }
  alu(op, a, b, w) {
    let r;
    switch (op) {
      case 0: r = this.add(a, b, 0, w); break;
      case 1: r = this.logic(a | b, w); break;
      case 2: r = this.add(a, b, this.f & F_CF, w); break;
      case 3: r = this.sub(a, b, this.f & F_CF, w); break;
      case 4: r = this.logic(a & b, w); break;
      case 5: case 7: r = this.sub(a, b, 0, w); break;
      default: r = this.logic(a ^ b, w);
    }
    if (this.trace) this.ev.push({ k: 'alu', op: ALU_OPS[op], a, b, r, w: w ? 16 : 8 });
    return r;
  }
  aluNote(op, a, b, r, w) { if (this.trace) this.ev.push({ k: 'alu', op, a, b, r, w: w ? 16 : 8 }); }

  shift(op, v, n, w) {
    if (!n) return v;
    const bits = w ? 16 : 8, m = w ? 0xFFFF : 0xFF, s = w ? 0x8000 : 0x80;
    const a0 = v;
    let f = this.f, cf = f & F_CF, prev = v;
    for (let i = 0; i < n; i++) {
      prev = v;
      switch (op) {
        case 0: cf = (v & s) ? 1 : 0; v = ((v << 1) | cf) & m; break;
        case 1: cf = v & 1; v = (v >> 1) | (cf ? s : 0); break;
        case 2: { const c = (v & s) ? 1 : 0; v = ((v << 1) | cf) & m; cf = c; break; }
        case 3: { const c = v & 1; v = (v >> 1) | (cf ? s : 0); cf = c; break; }
        case 4: cf = (v & s) ? 1 : 0; v = (v << 1) & m; break;
        case 5: cf = v & 1; v >>= 1; break;
        case 6: cf = 0; v = m; break;
        default: cf = v & 1; v = (v >> 1) | (v & s); break;
      }
    }
    f = (f & ~(F_CF | F_OF)) | cf;
    if ((prev ^ v) & s) f |= F_OF;
    this.f = f;
    if (op >= 4) { this.szp(v, w); this.f &= ~F_AF; }
    if (this.trace) this.ev.push({ k: 'alu', op: SHIFT_OPS[op], a: a0, b: n, r: v, w: bits });
    return v;
  }

  cond(c) {
    const f = this.f;
    switch (c >> 1) {
      case 0: return !!(f & F_OF) !== !!(c & 1);
      case 1: return !!(f & F_CF) !== !!(c & 1);
      case 2: return !!(f & F_ZF) !== !!(c & 1);
      case 3: return !!(f & (F_CF | F_ZF)) !== !!(c & 1);
      case 4: return !!(f & F_SF) !== !!(c & 1);
      case 5: return !!(f & F_PF) !== !!(c & 1);
      case 6: return (!!(f & F_SF) !== !!(f & F_OF)) !== !!(c & 1);
      default: return ((!!(f & F_SF) !== !!(f & F_OF)) || !!(f & F_ZF)) !== !!(c & 1);
    }
  }

  jump(ip) { this.ip = ip & 0xFFFF; this.flush(); }
  farJump(cs, ip) { this.sregs[CS] = cs; this.ip = ip & 0xFFFF; this.flush(); }

  // Interrupt entry (software, hardware or exception).
  interrupt(vec, src) {
    if (this.trace) this.ev.push({ k: 'int', vec, src });
    this.push(this.flags);
    this.f &= ~(F_IF | F_TF);
    this.push(this.sregs[CS]);
    this.push(this.ip);
    const ip = this.rwAbs(vec * 4), cs = this.rwAbs(vec * 4 + 2);
    this.farJump(cs, ip);
    this.halted = false;
  }

  // ---------- main step ----------
  step() {
    const tr = this.trace;
    this.clk = 0; this.nEU = 0; this.nStall = 0;
    if (tr) {
      this.ev = []; this.euEv = []; this.stallEv = []; this.ibytes = [];
      this.snap = { r: this.regs.slice(), s: this.sregs.slice(), ip: this.ip, f: this.flags };
    }
    const trapBefore = (this.f & F_TF) && !this.inhibit;
    const bus = this.bus;

    // External interrupts are sampled between instructions and between REP iterations.
    if (!this.inhibit) {
      if (bus.nmiPending && bus.nmiPending()) {
        this.abortRep(); bus.ackNmi();
        this.clk += 50; this.interrupt(2, 'nmi');
        return this.finish(false, 'NMI');
      }
      if ((this.f & F_IF) && bus.irqPending && bus.irqPending()) {
        this.abortRep();
        this.busEv('inta', 0, 0, 1, -1);
        const vec = bus.ackIrq();
        this.busEv('inta', 0, vec, 1, -1);
        this.clk += 61; this.interrupt(vec, 'irq');
        return this.finish(false, 'INTR ' + vec.toString(16).toUpperCase().padStart(2, '0') + 'h');
      }
    }
    this.inhibit = false;
    if (this.halted) { this.clk = 2; return this.finish(false, 'hlt (halted)', true); }

    if (this.repState) {
      this.lastIP = this.repState.start; this.lastCS = this.sregs[CS];
      this.seg = this.repState.seg; this.rep = this.repState.rep;
      this.stringOp(this.repState.op, false);
      return this.finish(trapBefore && !this.repState, null);
    }

    this.lastIP = this.ip; this.lastCS = this.sregs[CS];
    this.seg = -1; this.rep = 0;
    let op;
    for (;;) {
      op = this.fetch();
      if (op === 0x26 || op === 0x2E || op === 0x36 || op === 0x3E) { this.seg = (op >> 3) & 3; this.clk += 2; }
      else if (op === 0xF2 || op === 0xF3) { this.rep = op - 0xF1; }
      else if (op === 0xF0 || op === 0xF1) { this.clk += 2; }
      else break;
    }
    this.op = op;
    this.exec(op);
    this.instructions++;
    return this.finish(trapBefore && !this.repState, null);
  }

  abortRep() {
    if (this.repState) {
      this.ip = this.repState.start;
      this.repState = null;
      this.flush();
    }
  }

  // Build the timeline: stall fetches, EU bus cycles spread over the instruction,
  // and BIU prefetches in the free bus slots.
  finish(trap, text, halted) {
    const S = this.nStall * 4;
    let T = Math.max(this.clk + S, S + this.nEU * 4, 2);
    if (this.bus.fpu && this.bus.fpu.busyCycles > 0) this.bus.fpu.busyCycles = Math.max(0, this.bus.fpu.busyCycles - T);
    const tr = this.trace;
    const n = this.nEU, slack = T - S - 4 * n;
    const gap = Math.floor(slack / (n + 1));
    let pos = S, ei = 0;
    const placed = [];
    for (let g = 0; g <= n; g++) {
      let room = g === n ? T - pos : gap;
      while (room >= 4 && !halted && this.q.length <= 4) {
        const before = tr ? this.ev.length : 0;
        this.prefetch(false);
        if (tr) { const e = this.ev.pop(); e.t = pos; placed.push(e); this.ev.length = before; }
        pos += 4; room -= 4;
      }
      pos += room;
      if (g < n) {
        if (tr && ei < this.euEv.length) { const e = this.euEv[ei++]; e.t = pos; placed.push(e); }
        pos += 4;
      }
    }
    // FPU bus cycles and INTA/extra EU events that did not get a slot
    while (tr && ei < this.euEv.length) { const e = this.euEv[ei++]; e.t = Math.min(pos, T - 1); placed.push(e); }
    this.cycles += T;

    if (tr) {
      const out = [];
      const cs = this.lastCS, ip = this.lastIP;
      let dtext = text;
      if (!dtext) {
        if (typeof Disasm86 !== 'undefined') {
          const b = this;
          dtext = Disasm86.decode(i => b.bus.read8(((cs << 4) + ((ip + i) & 0xFFFF)) & 0xFFFFF), ip).text;
        } else dtext = 'op ' + this.op.toString(16);
        if (this.repStateText) dtext += this.repStateText;
      }
      out.push({ k: 'decode', t: 0, cs, ip, len: this.ibytes.length, text: dtext, bytes: this.ibytes.slice() });
      this.stallEv.forEach((e, i) => { e.t = i * 4; out.push(e); });
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
      out.push({ k: 'reg', t: T - 1, r: 'IP', v: this.ip });
      out.push({ k: 'end', t: T });
      out.sort((a, b) => a.t - b.t);
      this.trace = out;
    }
    this.repStateText = null;
    if (trap) { this.interrupt(1, 'exc'); this.cycles += 50; }
    return T;
  }

  // ---------- instruction execution ----------
  exec(op) {
    const R = this.regs;
    // ALU group 00-3D
    if (op < 0x40 && (op & 7) < 6) {
      const alu = op >> 3, form = op & 7, w = op & 1;
      if (form < 4) {
        this.modrm();
        if (form < 2) {           // E, G
          const a = this.getE(w), r = this.alu(alu, a, this.getG(w), w);
          if (alu !== 7) this.setE(w, r);
          this.rc(3, alu === 7 ? 9 : 16);
        } else {                  // G, E
          const r = this.alu(alu, this.getG(w), this.getE(w), w);
          if (alu !== 7) this.setG(w, r);
          this.rc(3, 9);
        }
      } else {                    // acc, imm
        if (w) { const r = this.alu(alu, R[AX], this.fetchW(), 1); if (alu !== 7) R[AX] = r; }
        else { const r = this.alu(alu, R[AX] & 0xFF, this.fetch(), 0); if (alu !== 7) this.w8(0, r); }
        this.clk += 4;
      }
      return;
    }
    if (op >= 0x40 && op < 0x60) {
      const r = op & 7;
      if (op < 0x48) { const cf = this.f & F_CF; R[r] = this.add(R[r], 1, 0, 1); this.f = (this.f & ~F_CF) | cf; this.aluNote('INC', R[r] - 1 & 0xFFFF, 1, R[r], 1); this.clk += 2; }
      else if (op < 0x50) { const cf = this.f & F_CF; R[r] = this.sub(R[r], 1, 0, 1); this.f = (this.f & ~F_CF) | cf; this.aluNote('DEC', R[r] + 1 & 0xFFFF, 1, R[r], 1); this.clk += 2; }
      else if (op < 0x58) { if (r === SP) { R[SP] -= 2; this.ww(SS, R[SP], R[SP]); } else this.push(R[r]); this.clk += 11; }
      else { R[r] = this.pop(); this.clk += 8; }
      return;
    }
    if (op >= 0x60 && op < 0x80) {   // Jcc (60-6F are 8086 aliases)
      const d = this.fetchS8();
      if (this.cond(op & 15)) { this.jump(this.ip + d); this.clk += 16; } else this.clk += 4;
      return;
    }
    if (op >= 0x91 && op <= 0x97) {
      const r = op & 7, t = R[AX]; R[AX] = R[r]; R[r] = t; this.clk += 3; return;
    }
    if (op >= 0xB0 && op <= 0xBF) {
      if (op & 8) R[op & 7] = this.fetchW(); else this.w8(op & 7, this.fetch());
      this.clk += 4; return;
    }
    if (op >= 0xD8 && op <= 0xDF) { this.esc(op); return; }

    switch (op) {
      case 0x06: case 0x0E: case 0x16: case 0x1E: this.push(this.sregs[op >> 3]); this.clk += 10; return;
      case 0x07: case 0x0F: case 0x17: case 0x1F:
        this.sregs[op >> 3] = this.pop(); this.clk += 8;
        if (op === 0x0F) this.flush();
        this.inhibit = true; return;
      case 0x27: this.daa(); return;
      case 0x2F: this.das(); return;
      case 0x37: this.aaa(); return;
      case 0x3F: this.aas(); return;
      case 0x80: case 0x81: case 0x82: case 0x83: {
        const w = op & 1;
        this.modrm();
        const a = this.getE(w);
        const b = op === 0x81 ? this.fetchW() : op === 0x83 ? this.fetchS8() & 0xFFFF : this.fetch();
        const r = this.alu(this.reg, a, b, w);
        if (this.reg !== 7) this.setE(w, r);
        this.rc(4, this.reg === 7 ? 10 : 17);
        return;
      }
      case 0x84: case 0x85: {
        const w = op & 1; this.modrm();
        const r = this.getE(w) & this.getG(w); this.logic(r, w);
        this.aluNote('TEST', this.getG(w), r, r, w);
        this.rc(3, 9); return;
      }
      case 0x86: case 0x87: {
        const w = op & 1; this.modrm();
        const a = this.getE(w), b = this.getG(w);
        this.setG(w, a); this.setE(w, b);
        this.rc(4, 17); return;
      }
      case 0x88: case 0x89: { const w = op & 1; this.modrm(); this.setE(w, this.getG(w)); this.rc(2, 9); return; }
      case 0x8A: case 0x8B: { const w = op & 1; this.modrm(); this.setG(w, this.getE(w)); this.rc(2, 8); return; }
      case 0x8C: this.modrm(); this.setE(1, this.sregs[this.reg & 3]); this.rc(2, 9); return;
      case 0x8D: this.modrm(); R[this.reg] = this.mod === 3 ? R[this.rm] : this.eaOff; this.clk += 2; return;
      case 0x8E: this.modrm(); this.sregs[this.reg & 3] = this.getE(1); this.rc(2, 8); this.inhibit = true; return;
      case 0x8F: {
        this.modrm();
        const v = this.pop();
        if (this.mod !== 3) this.calcEAAgain();
        this.setE(1, v); this.rc(8, 17); return;
      }
      case 0x90: this.clk += 3; return;
      case 0x98: R[AX] = (R[AX] & 0x80) ? R[AX] | 0xFF00 : R[AX] & 0xFF; this.clk += 2; return;
      case 0x99: R[DX] = (R[AX] & 0x8000) ? 0xFFFF : 0; this.clk += 5; return;
      case 0x9A: { const ip = this.fetchW(), cs = this.fetchW(); this.push(this.sregs[CS]); this.push(this.ip); this.farJump(cs, ip); this.clk += 28; return; }
      case 0x9B: {
        const fpu = this.bus.fpu;
        let busy = fpu ? fpu.busyCycles : 0;
        this.clk += 3 + busy;
        if (fpu) fpu.busyCycles = 0;
        return;
      }
      case 0x9C: this.push(this.flags); this.clk += 10; return;
      case 0x9D: this.flags = this.pop(); this.clk += 8; return;
      case 0x9E: this.f = (this.f & ~0xD5) | (R[AX] >> 8 & 0xD5); this.clk += 4; return;
      case 0x9F: this.w8(4, this.flags & 0xFF); this.clk += 4; return;
      case 0xA0: case 0xA1: case 0xA2: case 0xA3: {
        const off = this.fetchW(), s = this.seg >= 0 ? this.seg : DS, w = op & 1;
        if (this.trace) this.ev.push({ k: 'ea', seg: SREG[s], segv: this.sregs[s], off, phys: this.phys(s, off) });
        if (op < 0xA2) { if (w) R[AX] = this.rw(s, off); else this.w8(0, this.rb(s, off)); }
        else if (w) this.ww(s, off, R[AX]); else this.wb(s, off, R[AX]);
        this.clk += 10; return;
      }
      case 0xA4: case 0xA5: case 0xA6: case 0xA7: case 0xAA: case 0xAB:
      case 0xAC: case 0xAD: case 0xAE: case 0xAF:
        this.stringOp(op, true); return;
      case 0xA8: { const b = this.fetch(), r = R[AX] & 0xFF & b; this.logic(r, 0); this.aluNote('TEST', R[AX] & 0xFF, b, r, 0); this.clk += 4; return; }
      case 0xA9: { const b = this.fetchW(), r = R[AX] & b; this.logic(r, 1); this.aluNote('TEST', R[AX], b, r, 1); this.clk += 4; return; }
      case 0xC0: case 0xC2: { const n = this.fetchW(); this.jump(this.pop()); R[SP] += n; this.clk += 12; return; }
      case 0xC1: case 0xC3: this.jump(this.pop()); this.clk += 8; return;
      case 0xC4: case 0xC5: {
        this.modrm();
        R[this.reg] = this.rw(this.eaSeg, this.eaOff);
        this.sregs[op === 0xC4 ? ES : DS] = this.rw(this.eaSeg, this.eaOff + 2);
        this.clk += 16; return;
      }
      case 0xC6: this.modrm(); this.setE(0, this.fetch()); this.rc(4, 10); return;
      case 0xC7: this.modrm(); this.setE(1, this.fetchW()); this.rc(4, 10); return;
      case 0xC8: case 0xCA: { const n = this.fetchW(), ip = this.pop(), cs = this.pop(); this.farJump(cs, ip); R[SP] += n; this.clk += 17; return; }
      case 0xC9: case 0xCB: { const ip = this.pop(), cs = this.pop(); this.farJump(cs, ip); this.clk += 18; return; }
      case 0xCC: this.clk += 52; this.interrupt(3, 'sw'); return;
      case 0xCD: { const v = this.fetch(); this.clk += 51; this.interrupt(v, 'sw'); return; }
      case 0xCE: if (this.f & F_OF) { this.clk += 53; this.interrupt(4, 'sw'); } else this.clk += 4; return;
      case 0xCF: { const ip = this.pop(), cs = this.pop(); this.flags = this.pop(); this.farJump(cs, ip); this.clk += 24; return; }
      case 0xD0: case 0xD1: case 0xD2: case 0xD3: {
        const w = op & 1; this.modrm();
        const n = op < 0xD2 ? 1 : R[CX] & 0xFF;
        const v = this.getE(w);
        if (op >= 0xD2 && n === 0) { this.rc(8, 20); return; }
        this.setE(w, this.shift(this.reg, v, n, w));
        if (op < 0xD2) this.rc(2, 15); else this.rc(8 + 4 * n, 20 + 4 * n);
        return;
      }
      case 0xD4: this.aam(this.fetch()); return;
      case 0xD5: this.aad(this.fetch()); return;
      case 0xD6: this.w8(0, this.f & F_CF ? 0xFF : 0); this.clk += 3; return;
      case 0xD7: {
        const s = this.seg >= 0 ? this.seg : DS, off = (R[BX] + (R[AX] & 0xFF)) & 0xFFFF;
        if (this.trace) this.ev.push({ k: 'ea', seg: SREG[s], segv: this.sregs[s], off, phys: this.phys(s, off) });
        this.w8(0, this.rb(s, off)); this.clk += 11; return;
      }
      case 0xE0: case 0xE1: case 0xE2: {
        const d = this.fetchS8();
        R[CX]--;
        const zf = !!(this.f & F_ZF);
        const take = R[CX] !== 0 && (op === 0xE2 || (op === 0xE1 ? zf : !zf));
        if (take) { this.jump(this.ip + d); this.clk += op === 0xE2 ? 17 : op === 0xE1 ? 18 : 19; }
        else this.clk += op === 0xE1 ? 6 : 5;
        return;
      }
      case 0xE3: { const d = this.fetchS8(); if (R[CX] === 0) { this.jump(this.ip + d); this.clk += 18; } else this.clk += 6; return; }
      case 0xE4: this.w8(0, this.inb(this.fetch())); this.clk += 10; return;
      case 0xE5: R[AX] = this.inw(this.fetch()); this.clk += 10; return;
      case 0xE6: this.outb(this.fetch(), R[AX]); this.clk += 10; return;
      case 0xE7: this.outw(this.fetch(), R[AX]); this.clk += 10; return;
      case 0xE8: { const d = this.fetchW(); this.push(this.ip); this.jump(this.ip + d); this.clk += 19; return; }
      case 0xE9: { const d = this.fetchW(); this.jump(this.ip + d); this.clk += 15; return; }
      case 0xEA: { const ip = this.fetchW(), cs = this.fetchW(); this.farJump(cs, ip); this.clk += 15; return; }
      case 0xEB: { const d = this.fetchS8(); this.jump(this.ip + d); this.clk += 15; return; }
      case 0xEC: this.w8(0, this.inb(R[DX])); this.clk += 8; return;
      case 0xED: R[AX] = this.inw(R[DX]); this.clk += 8; return;
      case 0xEE: this.outb(R[DX], R[AX]); this.clk += 8; return;
      case 0xEF: this.outw(R[DX], R[AX]); this.clk += 8; return;
      case 0xF4: this.halted = true; this.clk += 2; return;
      case 0xF5: this.f ^= F_CF; this.clk += 2; return;
      case 0xF6: case 0xF7: this.group3(op & 1); return;
      case 0xF8: this.f &= ~F_CF; this.clk += 2; return;
      case 0xF9: this.f |= F_CF; this.clk += 2; return;
      case 0xFA: this.f &= ~F_IF; this.clk += 2; return;
      case 0xFB: this.f |= F_IF; this.clk += 2; this.inhibit = true; return;
      case 0xFC: this.f &= ~F_DF; this.clk += 2; return;
      case 0xFD: this.f |= F_DF; this.clk += 2; return;
      case 0xFE: case 0xFF: this.group45(op & 1); return;
    }
  }

  // POP r/m computes the EA after SP moves (matters for [bp+..] / [sp]-free forms: no-op here)
  calcEAAgain() {}

  group3(w) {
    const R = this.regs;
    this.modrm();
    const v = this.getE(w);
    const m = w ? 0xFFFF : 0xFF;
    switch (this.reg) {
      case 0: case 1: {
        const b = w ? this.fetchW() : this.fetch(), r = v & b;
        this.logic(r, w); this.aluNote('TEST', v, b, r, w); this.rc(5, 11); return;
      }
      case 2: this.setE(w, ~v & m); this.aluNote('NOT', v, 0, ~v & m, w); this.rc(3, 16); return;
      case 3: {
        const r = this.sub(0, v, 0, w); this.setE(w, r); this.aluNote('NEG', 0, v, r, w);
        this.rc(3, 16); return;
      }
      case 4: case 5: {        // MUL / IMUL
        let r, hi;
        if (this.reg === 4) {
          if (w) { r = R[AX] * v; R[AX] = r & 0xFFFF; R[DX] = hi = (r >>> 16) & 0xFFFF; }
          else { r = (R[AX] & 0xFF) * v; R[AX] = r; hi = r >> 8; }
          if (this.rep) r = this.negMul(w);
          this.f = hi ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
          this.rc(w ? 126 : 74, w ? 134 : 80);
        } else {
          if (w) {
            r = ((R[AX] << 16) >> 16) * ((v << 16) >> 16);
            R[AX] = r & 0xFFFF; R[DX] = (r >> 16) & 0xFFFF;
            if (this.rep) r = this.negMul(w);
            const ext = (R[AX] & 0x8000) ? 0xFFFF : 0;
            this.f = R[DX] !== ext ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
          } else {
            r = (((R[AX] & 0xFF) << 24) >> 24) * ((v << 24) >> 24);
            R[AX] = r & 0xFFFF;
            if (this.rep) r = this.negMul(w);
            const ext = (R[AX] & 0x80) ? 0xFF : 0;
            this.f = (R[AX] >> 8) !== ext ? this.f | F_CF | F_OF : this.f & ~(F_CF | F_OF);
          }
          this.rc(w ? 141 : 89, w ? 147 : 95);
        }
        this.szp(w ? R[DX] : R[AX] >> 8, w);
        this.f &= ~F_AF;
        if (!(w ? R[AX] | R[DX] : R[AX])) this.f |= F_ZF; else this.f &= ~F_ZF;
        this.aluNote(this.reg === 4 ? 'MUL' : 'IMUL', w ? this.snapAX() : 0, v, w ? (R[DX] * 65536 + R[AX]) : R[AX], w);
        return;
      }
      default: {               // DIV / IDIV
        const signed = this.reg === 7;
        this.rc(signed ? (w ? 175 : 107) : (w ? 153 : 85), signed ? (w ? 181 : 113) : (w ? 159 : 91));
        if (v === 0) { this.divError(); return; }
        let q, rem;
        if (!signed) {
          const num = w ? R[DX] * 65536 + R[AX] : R[AX];
          q = Math.floor(num / v); rem = num % v;
          if (q > m) { this.divError(); return; }
        } else {
          const num = w ? ((R[DX] << 16) | R[AX]) : (R[AX] << 16) >> 16;
          const d = w ? (v << 16) >> 16 : (v << 24) >> 24;
          q = Math.trunc(num / d); rem = num - q * d;
          if (this.rep) q = -q;
          const lim = w ? 0x7FFF : 0x7F;
          if (q > lim || q < -lim) { this.divError(); return; }
        }
        if (w) { R[AX] = q & 0xFFFF; R[DX] = rem & 0xFFFF; }
        else { R[AX] = (q & 0xFF) | ((rem & 0xFF) << 8); }
        this.aluNote(signed ? 'IDIV' : 'DIV', 0, v, q & m, w);
        return;
      }
    }
  }
  snapAX() { return this.snap ? this.snap.r[AX] : 0; }
  negMul(w) {
    const R = this.regs;
    if (w) { const r = (-(R[DX] * 65536 + R[AX])) >>> 0; R[AX] = r & 0xFFFF; R[DX] = r >>> 16; return r; }
    R[AX] = (-R[AX]) & 0xFFFF; return R[AX];
  }
  divError() {
    this.interrupt(0, 'exc');
  }

  group45(w) {
    const R = this.regs;
    this.modrm();
    switch (this.reg) {
      case 0: case 1: {
        const v = this.getE(w), cf = this.f & F_CF;
        const r = this.reg === 0 ? this.add(v, 1, 0, w) : this.sub(v, 1, 0, w);
        this.f = (this.f & ~F_CF) | cf;
        this.setE(w, r); this.aluNote(this.reg === 0 ? 'INC' : 'DEC', v, 1, r, w);
        this.rc(3, 15); return;
      }
      case 2: {                                  // CALL near r/m
        const t = this.getE(1); this.push(this.ip); this.jump(t); this.rc(16, 21); return;
      }
      case 3: {                                  // CALL far m32
        const ip = this.rw(this.eaSeg, this.eaOff), cs = this.rw(this.eaSeg, this.eaOff + 2);
        this.push(this.sregs[CS]); this.push(this.ip); this.farJump(cs, ip); this.clk += 37; return;
      }
      case 4: this.jump(this.getE(1)); this.rc(11, 18); return;
      case 5: {
        const ip = this.rw(this.eaSeg, this.eaOff), cs = this.rw(this.eaSeg, this.eaOff + 2);
        this.farJump(cs, ip); this.clk += 24; return;
      }
      default: {                                 // PUSH r/m (reg 6 and alias 7)
        if (this.mod === 3 && this.rm === SP) { R[SP] -= 2; this.ww(SS, R[SP], R[SP]); }
        else { const v = this.getE(1); this.push(v); }
        this.rc(11, 16); return;
      }
    }
  }

  // String instructions, one iteration per step() when a REP prefix is active.
  stringOp(op, first) {
    const R = this.regs, w = op & 1, d = (this.f & F_DF) ? -(w + 1) : (w + 1);
    const src = this.seg >= 0 ? this.seg : DS;
    if (this.rep && first) {
      this.clk += 9;
      if (R[CX] === 0) { this.repState = null; return; }
    }
    const kind = op & 0xFE;
    switch (kind) {
      case 0xA4: { const v = w ? this.rw(src, R[SI]) : this.rb(src, R[SI]); if (w) this.ww(ES, R[DI], v); else this.wb(ES, R[DI], v); R[SI] += d; R[DI] += d; this.clk += this.rep ? 17 : 18; break; }
      case 0xA6: {
        const a = w ? this.rw(src, R[SI]) : this.rb(src, R[SI]), b = w ? this.rw(ES, R[DI]) : this.rb(ES, R[DI]);
        this.sub(a, b, 0, w); this.aluNote('CMP', a, b, (a - b) & (w ? 0xFFFF : 0xFF), w);
        R[SI] += d; R[DI] += d; this.clk += 22; break;
      }
      case 0xAA: if (w) this.ww(ES, R[DI], R[AX]); else this.wb(ES, R[DI], R[AX]); R[DI] += d; this.clk += this.rep ? 10 : 11; break;
      case 0xAC: if (w) R[AX] = this.rw(src, R[SI]); else this.w8(0, this.rb(src, R[SI])); R[SI] += d; this.clk += this.rep ? 13 : 12; break;
      case 0xAE: {
        const a = w ? R[AX] : R[AX] & 0xFF, b = w ? this.rw(ES, R[DI]) : this.rb(ES, R[DI]);
        this.sub(a, b, 0, w); this.aluNote('CMP', a, b, (a - b) & (w ? 0xFFFF : 0xFF), w);
        R[DI] += d; this.clk += 15; break;
      }
    }
    if (!this.rep) { this.repState = null; return; }
    R[CX]--;
    let more = R[CX] !== 0;
    if (more && (kind === 0xA6 || kind === 0xAE)) {
      const zf = !!(this.f & F_ZF);
      more = this.rep === 2 ? zf : !zf;
    }
    if (more) {
      const start = this.repState ? this.repState.start : this.lastIP;
      this.repState = { op, seg: this.seg, rep: this.rep, start };
      this.repStateText = '  ; CX=' + R[CX].toString(16).toUpperCase().padStart(4, '0') + 'h';
    } else this.repState = null;
  }

  // ---------- BCD ----------
  daa() {
    const R = this.regs;
    let al = R[AX] & 0xFF, cf = this.f & F_CF, af = this.f & F_AF;
    const old = al;
    let f = this.f & ~(F_CF | F_AF);
    if ((al & 0x0F) > 9 || af) { al += 6; f |= F_AF; }
    if (old > (af ? 0x9F : 0x99) || cf) { al += 0x60; f |= F_CF; }
    this.f = f; al &= 0xFF;
    this.w8(0, al); this.szp(al, 0);
    // OF is undefined on the 8086; hardware sets it like an add
    if (!(old & 0x80) && (al & 0x80)) this.f |= F_OF; else this.f &= ~F_OF;
    this.aluNote('DAA', old, 0, al, 0);
    this.clk += 4;
  }
  das() {
    const R = this.regs;
    let al = R[AX] & 0xFF;
    const cf = this.f & F_CF, af = this.f & F_AF, old = al;
    let f = this.f & ~(F_CF | F_AF);
    if ((al & 0x0F) > 9 || af) { al -= 6; f |= F_AF; }
    if (old > (af ? 0x9F : 0x99) || cf) { al -= 0x60; f |= F_CF; }
    this.f = f; al &= 0xFF;
    this.w8(0, al); this.szp(al, 0);
    if ((old & 0x80) && !(al & 0x80)) this.f |= F_OF; else this.f &= ~F_OF;
    this.aluNote('DAS', old, 0, al, 0);
    this.clk += 4;
  }
  aaa() {
    const R = this.regs;
    const old = R[AX] & 0xFF;
    if ((old & 0x0F) > 9 || (this.f & F_AF)) {
      this.w8(0, old + 6); this.w8(4, (R[AX] >> 8) + 1);
      this.f |= F_AF | F_CF;
    } else this.f &= ~(F_AF | F_CF);
    this.w8(0, R[AX] & 0x0F);
    this.szp(old, 0);
    this.aluNote('AAA', old, 0, R[AX] & 0xFF, 0);
    this.clk += 4;
  }
  aas() {
    const R = this.regs;
    const old = R[AX] & 0xFF;
    if ((old & 0x0F) > 9 || (this.f & F_AF)) {
      this.w8(0, old - 6); this.w8(4, (R[AX] >> 8) - 1);
      this.f |= F_AF | F_CF;
    } else this.f &= ~(F_AF | F_CF);
    this.w8(0, R[AX] & 0x0F);
    this.szp(old, 0);
    this.aluNote('AAS', old, 0, R[AX] & 0xFF, 0);
    this.clk += 4;
  }
  aam(b) {
    const R = this.regs;
    this.clk += 83;
    if (b === 0) { this.f &= ~(F_SF | F_PF); this.f |= F_ZF | F_PF; this.divError(); return; }
    const al = R[AX] & 0xFF;
    this.w8(4, Math.floor(al / b)); this.w8(0, al % b);
    this.logic(R[AX] & 0xFF, 0);
    this.aluNote('AAM', al, b, R[AX], 1);
  }
  aad(b) {
    const R = this.regs;
    const al = R[AX] & 0xFF, ah = R[AX] >> 8;
    const r = this.add(al, (ah * b) & 0xFF, 0, 0);
    R[AX] = r;
    this.aluNote('AAD', R[AX], b, r, 1);
    this.clk += 60;
  }

  // ---------- 8087 escape ----------
  esc(op) {
    this.modrm();
    const fpu = this.bus.fpu;
    let ea = null;
    if (this.mod !== 3) {
      ea = { seg: this.sregs[this.eaSeg], off: this.eaOff };
      // The 8086 does a dummy read so the 8087 can latch the address and first word.
      this.rw(this.eaSeg, this.eaOff);
      this.clk += 8;
    } else this.clk += 2;
    if (!fpu) return;
    fpu.instrPtr = ((this.lastCS << 4) + this.lastIP) & 0xFFFFF;
    const res = fpu.exec(op, (this.mod << 6) | (this.reg << 3) | this.rm, ea) || { cycles: 0 };
    if (this.trace) {
      this.ev.push({ k: 'fpu', text: res.text || '', cycles: res.cycles || 0 });
      if (fpu.lastMem) {
        for (const m of fpu.lastMem) {
          this.euEv.push({ k: 'bus', type: m.write ? 'memw' : 'memr', addr: m.addr, data: m.value, width: 1, seg: null,
            dev: this.bus.devAt ? this.bus.devAt(m.addr) : 'ram', owner: 'fpu' });
        }
      }
    }
  }
}
