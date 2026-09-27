// Intel 80486 CPU core. It extends CPU80386 (src/core/cpu80386.js) and keeps its step() and
// micro-event contract (see ARCHITECTURE.md, "80486 CPU").
//
// - The 486 instructions: BSWAP, XADD, CMPXCHG (0F B0 / B1), INVD, WBINVD, INVLPG, CPUID.
// - EFLAGS: AC (bit 18) and ID (bit 21) can change. At CPL 3 with CR0.AM = 1 and AC = 1, a
//   data access that is not aligned gives #AC (vector 17, error code 0).
// - CR0: CD (30), NW (29), AM (18), WP (16), NE (5); ET (4) is always 1. The other bits read 0.
//   WP = 1: a supervisor write to a read-only page gives #PF.
// - The FPU is on the chip: no coprocessor bus cycles. CR0.NE = 1: an FPU error gives #MF
//   (vector 16) at the next FPU instruction or WAIT; NE = 0: the machine sends it to IRQ 13.
// - The 8 KB on-chip cache (cpu.cache486): unified, 4-way set associative, 128 sets of 16-byte
//   lines, pseudo-LRU (three bits for each set), write-through, a line fill on a read miss, no
//   fill on a write miss. The cache holds data; memory always has the last CPU write. The
//   machine must call cpu.cacheInvalidate(phys, len) when a DMA channel writes memory.
// - The 5-stage pipeline shows as one 'pipe' event for each instruction; the clock counts are
//   approximate values from the Intel i486 manual (cache hits: most simple instructions take
//   1 clock).
//
// The machine data bus stays 16 bits wide. A line fill is a burst of 8 word cycles (the 486
// makes 4 dword cycles in 2-1-1-1 timing); each of its bus events has burst: true and line.

const P486_AC = 0x40000, P486_ID = 0x200000;
const C0_NE = 0x20, C0_WP = 0x10000, C0_AM = 0x40000, C0_NW = 0x20000000, C0_CD = 0x40000000;
const P486_CR0 = 0xE005003F;               // the CR0 bits of the 80486
const P486_SREG = ['ES', 'CS', 'SS', 'DS', 'FS', 'GS'];
// String instructions: [clocks without REP, REP start, clocks for each REP iteration].
const P486_STR = { 0xA4: [7, 12, 3], 0xA6: [8, 7, 7], 0xAA: [5, 7, 4], 0xAC: [5, 7, 4], 0xAE: [6, 7, 5], 0x6C: [17, 16, 8], 0x6E: [17, 17, 5] };
// FPU clocks (i486 manual, typical values) by the mnemonic that the FPU core reports.
const P486_FPU = [
  [/^FN?(INIT)/, 17], [/^FN?CLEX/, 7], [/^FN?STSW|^FN?STCW|^FLDCW/, 3], [/^FN?STENV/, 67], [/^FLDENV/, 44],
  [/^FN?SAVE/, 154], [/^FRSTOR/, 131], [/^FLD(1|Z)$/, 4], [/^FLD(PI|L2T|L2E|LG2|LN2)/, 8], [/^FLD$/, 3],
  [/^FSTP?$/, 3], [/^FILD/, 14], [/^FISTP?/, 31], [/^FBLD/, 75], [/^FBSTP/, 172], [/^FI(ADD|SUB)/, 22],
  [/^FIMUL/, 23], [/^FIDIV/, 73], [/^FICOM/, 18], [/^F(ADD|SUB)/, 10], [/^FMUL/, 16], [/^FDIV/, 73],
  [/^FCOM|^FTST/, 4], [/^FXAM/, 8], [/^FCHS/, 6], [/^FABS|^FXCH|^FFREE|^FNOP|^FINCSTP|^FDECSTP/, 3],
  [/^FSQRT/, 85], [/^FPREM/, 84], [/^FSCALE/, 31], [/^FRNDINT/, 21], [/^FXTRACT/, 18], [/^FPTAN/, 244],
  [/^FPATAN/, 289], [/^F2XM1/, 242], [/^FYL2XP1/, 313], [/^FYL2X/, 311],
];

class CPU80486 extends CPU80386 {
  constructor(bus) {
    super(bus);
    // With CR0.NE = 1 an unmasked FPU exception (the ES bit of the status word) gives #MF.
    this.fpuError = () => (this.cr[0] & C0_NE) !== 0 && !!this.bus.fpu && (this.bus.fpu.sw & 0x80) !== 0;
  }

  // The constructor of CPU8086 calls reset(), which makes the 486 state on the first call.
  reset() {
    if (!this.cache486) this.cacheMake();
    super.reset();
    this.r[2] = CPU80486.SIGNATURE;           // EDX after reset: the CPUID signature
    this.cr[0] = 0x60000010;                  // CD = 1, NW = 1, ET = 1
    this.tr3 = 0; this.tr4 = 0; this.tr5 = 0; this.qh = 0;
    this.fillBuf = new Uint32Array(4); this.readBuf = new Uint32Array(4);
    this.cacheFlush();
    const st = this.cache486.stats;
    for (const k of Object.keys(st)) st[k] = 0;
    this.stallT = 0; this.busT = 0; this.rdT = 0; this.xPcd = 0; this.noAC = false;
    this.cacheSeen = false; this.codeSeen = false; this.prevText = '';
    this.syncOut();
  }

  get cacheOn() { return (this.cr[0] & C0_CD) === 0; }

  // ---------- the on-chip cache ----------
  // cpu.cache486.lines[set * 4 + way] = { valid, tag (physical address bits 11-31), addr (the
  // physical address of the line) }; lru[set] = the pseudo-LRU bits (bit 0 = B0, bit 1 = B1,
  // bit 2 = B2); data[(set * 4 + way) * 16 + i] = byte i of the line. The views only read
  // them. this.ctag[i] = the tag of line i, or -1 when it is not valid (the fast lookup).
  cacheMake() {
    this.ctag = new Int32Array(512).fill(-1);
    const lines = [];
    for (let i = 0; i < 512; i++) lines.push({ valid: false, tag: 0, addr: 0 });
    this.cache486 = { sets: 128, ways: 4, lineSize: 16, lines, lru: new Uint8Array(128), data: new Uint8Array(8192),
      stats: { hits: 0, misses: 0, fills: 0, uncached: 0, writeHits: 0, writeMisses: 0, flushes: 0, invalidations: 0 } };
  }
  // INVD, WBINVD, TR5 flush, reset: all lines become invalid.
  cacheFlush() {
    const C = this.cache486;
    for (const l of C.lines) l.valid = false;
    this.ctag.fill(-1);
    C.lru.fill(0);
    C.stats.flushes++;
  }
  // The machine calls this when a DMA channel (or another bus master) writes memory: the lines
  // of phys .. phys + len - 1 become invalid. With CR0.NW = 1 the 486 ignores such cycles.
  // Returns the number of lines that became invalid.
  cacheInvalidate(phys, len = 1) {
    if (this.cr[0] & C0_NW) return 0;
    const C = this.cache486, end = phys + len;
    let n = 0;
    if (len >= 0x4000) {
      const t = this.ctag;
      for (let i = 0; i < 512; i++) {
        if (t[i] < 0) continue;
        const addr = ((t[i] << 11) | ((i >> 2) << 4)) >>> 0;
        if (addr + 16 > phys && addr < end) { C.lines[i].valid = false; t[i] = -1; n++; }
      }
    } else {
      for (let a = phys - (phys & 15); a < end; a += 16) {
        const i = this.cacheFind(a >>> 0);
        if (i >= 0) { C.lines[i].valid = false; this.ctag[i] = -1; n++; }
      }
    }
    C.stats.invalidations += n;
    return n;
  }
  // KEN#: the machine says which physical addresses can be in the cache (bus.cacheable). The
  // default keeps the video memory (A0000-BFFFF) out of the cache.
  cacheable(pa) {
    const b = this.bus;
    return b.cacheable ? b.cacheable(pa) : !(pa >= 0xA0000 && pa < 0xC0000);
  }
  cacheFind(pa) {
    const i = ((pa >>> 4) & 127) * 4, tag = pa >>> 11, t = this.ctag;
    if (t[i] === tag) return i;
    if (t[i + 1] === tag) return i + 1;
    if (t[i + 2] === tag) return i + 2;
    if (t[i + 3] === tag) return i + 3;
    return -1;
  }
  // Pseudo-LRU: an access to way 0 sets B0 and B1, way 1 sets B0 and clears B1, way 2 clears
  // B0 and sets B2, way 3 clears B0 and B2.
  lruTouch(i) {
    const lru = this.cache486.lru, set = i >> 2;
    let b = lru[set];
    switch (i & 3) {
      case 0: b |= 3; break;
      case 1: b = (b | 1) & ~2; break;
      case 2: b = (b & ~1) | 4; break;
      default: b &= ~5;
    }
    lru[set] = b;
  }
  // The way that a new line replaces: the first invalid way, else B0 = 0: B1 selects way 0 or
  // 1; B0 = 1: B2 selects way 2 or 3.
  lruVictim(set) {
    const C = this.cache486;
    for (let w = 0; w < 4; w++) if (this.ctag[set * 4 + w] < 0) return w;   // (ctag: the C core keeps it too)
    const b = C.lru[set];
    if (!(b & 1)) return b & 2 ? 1 : 0;
    return b & 4 ? 3 : 2;
  }
  // Line fill: 16 bytes from the bus into a line. The bus cycles follow the 486 burst order
  // (the dword that the CPU needs first: 0-4-8-C, 4-0-C-8, 8-C-0-4, C-8-4-0). code: the
  // prefetcher asks ('fetch' events). Returns the line index (set * 4 + way).
  cacheFill(pa, s, code, stall) {
    const C = this.cache486, line = (pa - (pa & 15)) >>> 0, set = (pa >>> 4) & 127;
    const i = set * 4 + this.lruVictim(set), D = C.data, base = i * 16, bus = this.bus;
    for (let k = 0; k < 16; k++) D[base + k] = bus.read8((line + k) >>> 0);
    const l = C.lines[i];
    l.valid = true; l.tag = pa >>> 11; l.addr = line; this.ctag[i] = l.tag;
    this.lruTouch(i);
    C.stats.fills++;
    const first = (pa >>> 2) & 3;
    let beat = 0;
    this.lastFillEv = null;
    for (let j = 0; j < 4; j++) {
      const dw = first ^ j;
      for (let h = 0; h < 2; h++, beat++) {
        const o = dw * 4 + h * 2, a = (line + o) >>> 0, v = D[base + o] | (D[base + o + 1] << 8);
        const len = beat ? this.busLen - 1 : this.busLen, extra = { burst: true, line, beat };
        const e = code ? this.codeEv(a, v, 2, len, stall, extra) : this.busEv('memr', a, v, 2, s, len, extra);
        if (!beat) this.lastFillEv = e;
      }
    }
    return i;
  }
  fillTime() { return this.busLen + 7 * (this.busLen - 1); }
  // The first data access and the first code miss of an instruction give a 'cache' event.
  cacheNote(pa, i, hit, fill, write, code, nc) {
    const e = { k: 'cache', phys: pa, set: (pa >>> 4) & 127, way: i < 0 ? -1 : i & 3, hit, fill, write };
    if (code) { e.code = true; this.codeSeen = true; } else this.cacheSeen = true;
    if (nc) e.nc = true;
    if (fill) e.ref = this.lastFillEv;
    this.cacheEv.push(e);
  }

  // ---------- bus cycles ----------
  // len: the clocks of the cycle (default 2 + wait states). busT counts the bus time of the
  // execution unit, rdT the part that the EU must wait for (all but memory writes, which go
  // into the write buffers).
  busEv(type, a, v, width, s, len, extra) {
    if (len === undefined) len = this.busLen;
    this.nEU++; this.busT += len;
    if (type !== 'memw') this.rdT += len;
    const st = this.bus.stats;
    if (st) countCycle(st, type);
    if (!this.trace) return null;
    const e = { k: 'bus', type, addr: a, data: v, width, seg: s < 0 || s === undefined ? null : P486_SREG[s],
      dev: this.bus.devAt ? (type === 'ior' || type === 'iow' ? this.bus.ioDevAt(a) : this.bus.devAt(a)) : 'ram', owner: 'cpu', len };
    if (extra) Object.assign(e, extra);
    this.euEv.push(e);
    return e;
  }
  fpuIO(type, port, v) { const e = this.busEv(type, port, v & 0xFFFF, 2, -1); if (e) e.dev = 'fpu'; }
  // A code fetch bus cycle. stall: the EU waits for it.
  codeEv(a, v, width, len, stall, extra) {
    const bus = this.bus;
    if (bus.stats) bus.stats.fetch++;
    if (stall) this.stallT += len;
    if (!this.trace) return null;
    const e = { k: 'fetch', addr: a, data: v, width, seg: 'CS', dev: bus.devAt ? bus.devAt(a) : 'ram', q: null, len };
    if (extra) Object.assign(e, extra);
    (stall ? this.stallEv : this.pfEv).push(e);
    return e;
  }
  // Bus cycles for n bytes (1-4) at pa: an aligned word is one cycle, the other bytes are one
  // cycle each (16-bit data bus).
  memCycles(type, pa, v, n, s) {
    for (let k = 0; k < n;) {
      const a = (pa + k) >>> 0;
      if (!(a & 1) && n - k >= 2) { this.busEv(type, a, (v >>> (8 * k)) & 0xFFFF, 2, s); k += 2; }
      else { this.busEv(type, a, (v >>> (8 * k)) & 0xFF, 1, s); k++; }
    }
  }

  // ---------- physical access through the cache ----------
  // Read n bytes (1-4) at physical address pa. pcd: the page has PCD = 1 (no line fill).
  physRd(pa, n, s, pcd) {
    const off = pa & 15;
    if (off + n > 16) {
      const k = 16 - off;
      return (this.physRd(pa, k, s, pcd) | (this.physRd((pa + k) >>> 0, n - k, s, pcd) << (8 * k))) >>> 0;
    }
    const C = this.cache486;
    let i = this.cacheFind(pa), fill = false;
    const hit = i >= 0;
    if (hit) { C.stats.hits++; this.lruTouch(i); }
    else {
      C.stats.misses++;
      if (!(this.cr[0] & C0_CD) && !pcd && this.cacheable(pa)) { i = this.cacheFill(pa, s, false, false); fill = true; }
    }
    let v;
    if (i >= 0) {
      const D = C.data, b = i * 16 + off;
      v = D[b];
      if (n > 1) v |= D[b + 1] << 8;
      if (n > 2) v |= D[b + 2] << 16;
      if (n > 3) v = (v | (D[b + 3] << 24)) >>> 0;
    } else {
      C.stats.uncached++;
      const bus = this.bus;
      v = bus.read8(pa);
      for (let k = 1; k < n; k++) v |= bus.read8((pa + k) >>> 0) << (8 * k);
      v >>>= 0;
      this.memCycles('memr', pa, v, n, s);
    }
    if (this.trace && !this.cacheSeen) this.cacheNote(pa, i, hit, fill, false, false, i < 0);
    return v;
  }
  // Write n bytes (1-4): a write hit changes the line; the write goes to the bus (write-through),
  // but not a write hit with CR0.NW = 1. A write miss does not fill a line.
  physWr(pa, n, v, s) {
    const off = pa & 15;
    if (off + n > 16) {
      const k = 16 - off;
      this.physWr(pa, k, v & (0xFFFFFFFF >>> (32 - 8 * k)), s);
      this.physWr((pa + k) >>> 0, n - k, v >>> (8 * k), s);
      return;
    }
    const C = this.cache486, i = this.cacheFind(pa);
    if (i >= 0) {
      const D = C.data, b = i * 16 + off;
      for (let k = 0; k < n; k++) D[b + k] = (v >>> (8 * k)) & 0xFF;
      C.stats.writeHits++; this.lruTouch(i);
    } else C.stats.writeMisses++;
    if (i < 0 || !(this.cr[0] & C0_NW)) {
      const bus = this.bus;
      for (let k = 0; k < n; k++) bus.write8((pa + k) >>> 0, (v >>> (8 * k)) & 0xFF);
      this.memCycles('memw', pa, n === 4 ? v >>> 0 : v & ((1 << (8 * n)) - 1), n, s);
    }
    if (this.trace && !this.cacheSeen) this.cacheNote(pa, i, i >= 0, false, true, false, false);
  }
  rdPhysD(pa, pcd) { return this.physRd(pa >>> 0, 4, -1, pcd || 0); }
  wrPhysD(pa, v) { this.physWr(pa >>> 0, 4, v >>> 0, -1); }

  // ---------- segment and linear access ----------
  acOn() { return this.cpl === 3 && (this.cr[0] & C0_AM) !== 0 && (this.f & P486_AC) !== 0 && !this.noAC; }
  rd(s, o, n) {
    const d = this.cache[s];
    if (o < d.lo || o + n - 1 > d.hi || !d.rd) this.segFault(s);
    const la = (d.base + o) >>> 0;
    if ((la & (n - 1)) && this.acOn()) throw this.fault(17, 0);
    return this.rdLin(la, n, s, this.cpl === 3);
  }
  wr(s, o, n, v) {
    const d = this.cache[s];
    if (o < d.lo || o + n - 1 > d.hi || !d.wr) this.segFault(s);
    const la = (d.base + o) >>> 0;
    if ((la & (n - 1)) && this.acOn()) throw this.fault(17, 0);
    this.wrLin(la, n, v, s, this.cpl === 3);
  }
  rdLin(la, n, s, user) {
    let pa = la, pcd = 0;
    if (this.paging) {
      if ((la & 0xFFF) + n > 0x1000) return this.rdSplit(la, n, s, user);
      pa = this.xlate(la, false, user); pcd = this.xPcd;
    }
    const v = this.physRd(pa, n, s, pcd);
    if (this.dbgOn) this.dataBreak(la, n, false);
    return v;
  }
  wrLin(la, n, v, s, user) {
    let pa = la;
    if (this.paging) {
      if ((la & 0xFFF) + n > 0x1000) { this.wrSplit(la, n, v, s, user); return; }
      pa = this.xlate(la, true, user);
    }
    this.physWr(pa, n, n === 4 ? v >>> 0 : v & P386_MASK[n], s);
    if (this.dbgOn) this.dataBreak(la, n, true);
  }
  // An access that crosses a page boundary: both pages are translated first.
  rdSplit(la, n, s, user) {
    const k = 0x1000 - (la & 0xFFF), la2 = (la + k) >>> 0;
    const p0 = this.xlate(la, false, user), c0 = this.xPcd, p1 = this.xlate(la2, false, user), c1 = this.xPcd;
    const v = (this.physRd(p0, k, s, c0) | (this.physRd(p1, n - k, s, c1) << (8 * k))) >>> 0;
    if (this.dbgOn) this.dataBreak(la, n, false);
    return v;
  }
  wrSplit(la, n, v, s, user) {
    const k = 0x1000 - (la & 0xFFF), la2 = (la + k) >>> 0;
    const p0 = this.xlate(la, true, user), p1 = this.xlate(la2, true, user);
    this.physWr(p0, k, v & (0xFFFFFFFF >>> (32 - 8 * k)), s);
    this.physWr(p1, n - k, v >>> (8 * k), s);
    if (this.dbgOn) this.dataBreak(la, n, true);
  }

  // ---------- paging (the 386 TLB, with WP and the PCD / PWT bits) ----------
  // TLB flags: the 386 bits, and bit 3 PWT, bit 4 PCD of the page table entry. this.xPcd =
  // the PCD bit of the last translation.
  xlate(la, write, user) {
    const e = this.tlbFind(la);
    if (e) {
      const fl = e.flags;
      if (user ? !(fl & 4) || (write && !(fl & 2)) : write && !(fl & 2) && (this.cr[0] & C0_WP)) return this.walk(la, write, user);
      if (!write || (fl & 0x40)) {
        this.tlbStats.hits++;
        const pa = (e.phys | (la & 0xFFF)) >>> 0;
        if (this.trace && !this.tlbSeen) { this.tlbSeen = true; this.ev.push({ k: 'tlb', lin: la, phys: pa, hit: true }); }
        this.xPcd = fl & 0x10;
        return pa;
      }
    }
    return this.walk(la, write, user);
  }
  // Page walk: the directory entry (PCD of CR3), then the table entry (PCD of the PDE). With
  // CR0.WP = 1 a supervisor write needs R/W = 1 at both levels.
  walk(la, write, user) {
    this.tlbStats.misses++;
    const dir = la >>> 22, tbl = (la >>> 12) & 0x3FF, cr3 = this.cr[3];
    const pdeA = ((cr3 & 0xFFFFF000) + dir * 4) >>> 0;
    const pde = this.rdPhysD(pdeA, cr3 & 0x10);
    const ev = this.trace ? { k: 'page', lin: la, phys: 0, dir, tbl, hit: false, pde, pte: 0, fault: false } : null;
    const err = (write ? 2 : 0) | (user ? 4 : 0);
    const fail = code => { if (ev) { ev.fault = true; ev.err = code; this.ev.push(ev); } return this.pageFault(la, code); };
    if (!(pde & 1)) throw fail(err);
    const pteA = ((pde & 0xFFFFF000) + tbl * 4) >>> 0;
    const pte = this.rdPhysD(pteA, pde & 0x10);
    if (ev) ev.pte = pte;
    if (!(pte & 1)) throw fail(err);
    const us = pde & pte & 4, rw = pde & pte & 2;
    if (user && (!us || (write && !rw))) throw fail(err | 1);
    if (!user && write && !rw && (this.cr[0] & C0_WP)) throw fail(err | 1);
    if (!(pde & 0x20)) this.wrPhysD(pdeA, pde | 0x20);
    const npte = pte | 0x20 | (write ? 0x40 : 0);
    if (npte !== pte) this.wrPhysD(pteA, npte);
    const frame = (pte & 0xFFFFF000) >>> 0;
    this.tlbPut((la & 0xFFFFF000) >>> 0, frame, us | rw | 0x21 | (npte & 0x40) | (pte & 0x18));
    this.xPcd = pte & 0x10;
    const pa = (frame | (la & 0xFFF)) >>> 0;
    if (ev) { ev.phys = pa; this.ev.push(ev); }
    return pa;
  }

  // ---------- prefetch (32-byte queue, 16-byte lines from the cache) ----------
  // The queue bytes are qb[qh] to qb[qt - 1], the next byte first (a fixed buffer: an array
  // that grows and shrinks at each instruction is slow). cpu.q gives a copy for the views.
  get q() { return this.qb ? Array.from(this.qb.subarray(this.qh, this.qt)) : []; }
  set q(v) { if (!this.qb) this.qb = new Uint8Array(128); this.qb.set(v); this.qh = 0; this.qt = v.length; }
  flush() {
    this.qh = 0; this.qt = 0; this.qip = this.ip; this.didFlush = true;
    if (this.trace) this.ev.push({ k: 'queue', op: 'flush', n: 0, q: [] });
  }
  fetch() {
    const ip = this.ip;
    // A byte past the CS limit, or an instruction longer than 15 bytes: #GP(0).
    if (ip > this.cache[CS].hi || ++this.ilen > 15) throw this.fault(13, 0);
    if (this.qh >= this.qt) { this.qh = 0; this.qt = 0; this.prefetch(true); }
    const b = this.qb[this.qh++];
    this.ip = (ip + 1) >>> 0;
    if (this.trace) this.ibytes.push(b);
    return b;
  }
  // Move the queue bytes to the start of the buffer.
  qCompact() {
    const h = this.qh;
    if (!h) return;
    const n = this.qt - h;
    if (n) this.qb.copyWithin(0, h, this.qt);
    this.qh = 0; this.qt = n;
  }
  // stall: the EU waits for the bytes. room: the free bus clocks (not for a stall). Returns the
  // bus clocks that it used, -1 when it cannot fetch (CS limit, a page not in the TLB), -2
  // when the bus cycles do not fit in room.
  prefetch(stall, room) {
    const qip = this.qip, d = this.cache[CS], bus = this.bus;
    if (!stall && qip > d.hi) return -1;
    if (this.qt > 112) this.qCompact();
    const la = (d.base + qip) >>> 0;
    let pa = la, pcd = 0;
    if (this.paging) {
      if (stall) { pa = this.xlate(la, false, this.cpl === 3); pcd = this.xPcd; }
      else {
        const e = this.tlbFind(la);
        if (!e || (this.cpl === 3 && !(e.flags & 4))) return -1;
        pa = (e.phys | (la & 0xFFF)) >>> 0; pcd = e.flags & 0x10;
      }
    }
    const C = this.cache486, tr = this.trace, list = tr ? (stall ? this.stallEv : this.pfEv) : null, n0 = tr ? list.length : 0;
    let k = 16 - (la & 15);
    if (d.hi - qip + 1 < k) k = d.hi - qip + 1;
    let i = this.cacheFind(pa), used = 0, fill = false;
    const hit = i >= 0;
    if (!hit && !(this.cr[0] & C0_CD) && !pcd && this.cacheable(pa)) {
      used = this.fillTime();
      if (!stall && used > room) return -2;
      C.stats.misses++;
      i = this.cacheFill(pa, -1, true, stall); fill = true;
    } else if (hit) { C.stats.hits++; this.lruTouch(i); }
    if (i >= 0) {
      const D = C.data, b = i * 16 + (pa & 15);
      const Q = this.qb;
      let t = this.qt;
      for (let j = 0; j < k; j++) Q[t++] = D[b + j];
      this.qt = t;
      this.qip = (qip + k) >>> 0;
    } else {
      // Not cacheable: one aligned word (or a byte), as on the 80386.
      if (!stall && this.busLen > room) return -2;
      C.stats.misses++; C.stats.uncached++;
      let data, width;
      if (!(la & 1) && qip < d.hi) {
        const b0 = bus.read8(pa), b1 = bus.read8((pa + 1) >>> 0);
        this.qb[this.qt++] = b0; this.qb[this.qt++] = b1; data = b0 | (b1 << 8); width = 2;
      } else { data = bus.read8(pa); this.qb[this.qt++] = data; width = 1; }
      this.qip = (qip + width) >>> 0;
      this.codeEv(pa, data, width, this.busLen, stall, null);
      used = this.busLen;
    }
    if (tr) {
      for (let j = n0; j < list.length; j++) list[j].q = this.q;
      if (!hit && !this.codeSeen) this.cacheNote(pa, i, false, fill, false, true, !fill);
    }
    return used;
  }

  // ---------- flags, CR0, exceptions ----------
  setCR0(v) {
    v >>>= 0;
    if ((v & 0x80000000) && !(v & 1)) throw this.fault(13, 0);
    if ((v & C0_NW) && !(v & C0_CD)) throw this.fault(13, 0);   // NW = 1 needs CD = 1
    const old = this.cr[0];
    this.cr[0] = ((v & P486_CR0) | 0x10) >>> 0;
    this.modeChange(old);
    const h8 = x => (x >>> 0).toString(16).toUpperCase().padStart(8, '0'), c = this.cr[0];
    this.sysEv('CR0', `CR0 = ${h8(c)}${c & 1 ? ' (protected mode)' : ''}${c & 0x80000000 ? ' (paging)' : ''}${c & C0_CD ? ' (cache off)' : ' (cache on)'}`);
  }
  // #AC is vector 17.
  intr(vec, src, err) {
    const k = this.trace && vec === 17 && src === 'exc' ? this.ev.length : -1;
    try { super.intr(vec, src, err); } finally { if (k >= 0 && this.ev[k] && this.ev[k].k === 'int') this.ev[k].name = '#AC'; }
  }

  // ---------- step, clocks and the timeline ----------
  step() {
    this.stallT = 0; this.busT = 0; this.rdT = 0; this.cacheSeen = false; this.codeSeen = false; this.noAC = false;
    if (this.trace) { this.cacheEv = []; this.pfEv = []; }
    return super.step();
  }
  exec(op) {
    const c0 = this.clk;
    this.mod = -1; this.op2 = -1;
    super.exec(op);
    const t = this.clocks486(op);
    if (t >= 0) this.clk = c0 + t;
  }
  stringOp(op, first) {
    const c0 = this.clk, rep = this.rep, R = this.r;
    const zero = rep && first && (this.a32 ? R[1] : R[1] & 0xFFFF) === 0;
    super.stringOp(op, first);
    const t = P486_STR[op & 0xFE];
    if (t) this.clk = c0 + (!rep ? t[0] : zero ? 5 : (first ? t[1] : 0) + t[2]);
  }
  ioClk(real, ok, bad, v86) {
    if (!(this.cr[0] & 1)) return real;
    if (this.f & P386_VM) return v86;
    return this.cpl <= this.iopl ? ok : bad;
  }
  // i486 clocks with cache hits (-1: keep the 80386 value, for example the protected-mode
  // far transfers and task switches).
  clocks486(op) {
    const m = this.mod >= 0 && this.mod !== 3, S = this.osz, taken = this.didFlush;
    const pm = (this.cr[0] & 1) !== 0 && !(this.f & P386_VM);
    if (op < 0x40) {
      if ((op & 7) < 6) { const f = op & 7; return f >= 4 || !m ? 1 : f < 2 ? (op >> 3 === 7 ? 2 : 3) : 2; }
      if (op === 0x0F) return this.clocks0F();
      if ((op & 7) === 6) return 3;                  // PUSH ES / CS / SS / DS
      if (op === 0x27 || op === 0x2F) return 2;
      if (op === 0x37 || op === 0x3F) return 3;
      return pm ? 9 : 3;                              // POP ES / SS / DS
    }
    if (op < 0x60) return 1;                          // INC, DEC, PUSH, POP reg
    if (op >= 0x70 && op < 0x80) return taken ? 3 : 1;
    if (op >= 0xB0 && op < 0xC0) return 1;
    if (op >= 0x91 && op <= 0x97) return 3;
    if (op >= 0xD8 && op <= 0xDF) return -1;           // the FPU sets its own clocks
    switch (op) {
      case 0x60: return 11;
      case 0x61: return 9;
      case 0x62: return 7;
      case 0x63: return 9;
      case 0x68: case 0x6A: return 1;
      case 0x69: case 0x6B: return S === 4 ? 26 : 18;
      case 0x80: case 0x81: case 0x82: case 0x83: return !m ? 1 : this.reg === 7 ? 2 : 3;
      case 0x84: case 0x85: return m ? 2 : 1;
      case 0x86: case 0x87: return m ? 5 : 3;
      case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8D: return 1;
      case 0x8C: return 3;
      case 0x8E: return pm ? 9 : 3;
      case 0x8F: return 6;
      case 0x90: return 1;
      case 0x98: case 0x99: return 3;
      case 0x9A: return pm ? -1 : 18;
      case 0x9B: return 1;
      case 0x9C: return pm ? 3 : 4;
      case 0x9D: return pm ? 6 : 9;
      case 0x9E: return 2;
      case 0x9F: return 3;
      case 0xA0: case 0xA1: case 0xA2: case 0xA3: case 0xA8: case 0xA9: return 1;
      case 0xC0: case 0xC1: case 0xD0: case 0xD1: case 0xD2: case 0xD3:
        if (this.reg === 2 || this.reg === 3) return m ? 10 : op === 0xD0 || op === 0xD1 ? 3 : 8;
        return m ? 4 : op <= 0xC1 ? 2 : 3;
      case 0xC2: case 0xC3: return 5;
      case 0xC4: case 0xC5: return pm ? 12 : 6;
      case 0xC6: case 0xC7: return 1;
      case 0xC9: return 5;
      case 0xCA: case 0xCB: return pm ? -1 : 13;
      case 0xCC: return pm ? -1 : 26;
      case 0xCD: return pm ? -1 : 30;
      case 0xCE: return !taken ? 3 : pm ? -1 : 28;
      case 0xCF: return pm ? -1 : 15;
      case 0xD4: return 15;
      case 0xD5: return 14;
      case 0xD6: return 2;
      case 0xD7: return 4;
      case 0xE0: case 0xE1: return taken ? 9 : 6;
      case 0xE2: return taken ? 7 : 6;
      case 0xE3: return taken ? 8 : 5;
      case 0xE4: case 0xE5: return this.ioClk(14, 9, 29, 27);
      case 0xEC: case 0xED: return this.ioClk(14, 8, 28, 27);
      case 0xE6: case 0xE7: return this.ioClk(16, 11, 31, 29);
      case 0xEE: case 0xEF: return this.ioClk(16, 10, 30, 29);
      case 0xE8: case 0xE9: case 0xEB: return 3;
      case 0xEA: return pm ? -1 : 17;
      case 0xF4: return 4;
      case 0xF5: case 0xF8: case 0xF9: case 0xFC: case 0xFD: return 2;
      case 0xFA: case 0xFB: return 5;
      case 0xF6: case 0xF7: {
        const s = op & 1 ? S : 1;
        switch (this.reg) {
          case 0: case 1: return m ? 2 : 1;
          case 2: case 3: return m ? 3 : 1;
          case 4: case 5: return s === 1 ? 13 : s === 2 ? 18 : 28;
          case 6: return s === 1 ? 16 : s === 2 ? 24 : 40;
          default: return s === 1 ? 19 : s === 2 ? 27 : 43;
        }
      }
      case 0xFE: case 0xFF:
        switch (this.reg) {
          case 0: case 1: return m ? 3 : 1;
          case 2: case 4: return 5;
          case 3: return pm ? -1 : 17;
          case 5: return pm ? -1 : 13;
          default: return 4;
        }
      default: return -1;
    }
  }
  clocks0F() {
    const op2 = this.op2, m = this.mod >= 0 && this.mod !== 3, pm = (this.cr[0] & 1) !== 0 && !(this.f & P386_VM);
    if (op2 >= 0x80 && op2 <= 0x8F) return this.didFlush ? 3 : 1;
    if (op2 >= 0x90 && op2 <= 0x9F) return m ? 3 : 4;
    if (op2 >= 0xC8 && op2 <= 0xCF) return 1;
    switch (op2) {
      case 0x00: return [2, 2, 11, 20, 11, 11][this.reg];
      case 0x01: return [10, 10, 11, 11, 2, -1, 13, 12][this.reg];
      case 0x02: return 11;
      case 0x03: return 10;
      case 0x06: return 7;
      case 0x08: return 4;
      case 0x09: return 5;
      case 0x20: case 0x21: case 0x24: case 0x26: return 4;
      case 0x22: return 16;
      case 0x23: return 11;
      case 0xA0: case 0xA8: return 3;
      case 0xA1: case 0xA9: return pm ? 9 : 3;
      case 0xA2: return 14;
      case 0xA3: return m ? 8 : 3;
      case 0xAB: case 0xB3: case 0xBB: return m ? 13 : 6;
      case 0xBA: return this.reg === 4 ? 3 : m ? 8 : 6;
      case 0xA4: case 0xAC: return m ? 3 : 2;
      case 0xA5: case 0xAD: return m ? 4 : 3;
      case 0xAF: return this.osz === 4 ? 28 : 18;
      case 0xB0: case 0xB1: return !m ? 6 : this.cmpxOk ? 7 : 10;
      case 0xB2: case 0xB4: case 0xB5: return pm ? 12 : 6;
      case 0xB6: case 0xB7: case 0xBE: case 0xBF: return 3;
      case 0xBC: case 0xBD: return 10;
      case 0xC0: case 0xC1: return m ? 4 : 3;
      default: return -1;
    }
  }

  // Timeline (as the 80386 core): the code stalls, the EU bus cycles over the instruction (the
  // beats of a burst stay together), the prefetcher in the free bus time (not after a flush).
  // The instruction takes its 486 clocks plus the bus time of reads (writes go into the write
  // buffers), and at least the bus time of all its cycles.
  finish(text, halted) {
    if (!this.batch) this.syncOut();
    const S = this.stallT, BT = this.busT;
    let T = S + this.clk + this.rdT;
    if (T < S + BT) T = S + BT;
    if (T < 1) T = 1;
    const fpu = this.bus.fpu;
    if (fpu) fpu.busyCycles = 0;
    const tr = this.trace, canFetch = !halted && !this.didFlush;
    if (!tr) {
      if (canFetch) {
        let room = T - S - BT;
        while (this.qt - this.qh <= 16) { const u = this.prefetch(false, room); if (u < 0) break; room -= u; }
      }
      this.cycles += T;
      return T;
    }
    const groups = [];
    for (const e of this.euEv) { if (e.beat > 0 && groups.length) groups[groups.length - 1].push(e); else groups.push([e]); }
    const G = groups.length, gap = Math.floor((T - S - BT) / (G + 1));
    let pos = S, more = canFetch;
    const placed = [];
    for (let g = 0; g <= G; g++) {
      let room = g === G ? T - pos : gap;
      while (more && this.qt - this.qh <= 16) {
        const n0 = this.pfEv.length, u = this.prefetch(false, room);
        if (u === -1) { more = false; break; }
        if (u < 0) break;
        let p = pos;
        for (let j = n0; j < this.pfEv.length; j++) { const e = this.pfEv[j]; e.t = p; p += e.len; placed.push(e); }
        pos += u; room -= u;
      }
      pos += room;
      if (g < G) for (const e of groups[g]) { e.t = Math.min(pos, T - 1); pos += e.len; placed.push(e); }
    }
    this.cycles += T;

    const out = [], bus = this.bus;
    const cs = this.decCS, ip = this.decIP, base = this.lastBase, bits = this.decBits;
    const peek = bus.peek8 ? a => bus.peek8(a) : a => bus.read8(a);
    const reader = (b, o) => i => { const pa = this.peekPhys((b + o + i) >>> 0); return pa < 0 ? 0 : peek(pa); };
    let dtext = text;
    if (!dtext) {
      if (typeof Disasm86 !== 'undefined') {
        try { dtext = Disasm86.decode(reader(base, ip), ip, { cpu: '486', bits }).text; } catch (e) { dtext = 'op ' + (this.op | 0).toString(16); }
      } else dtext = 'op ' + (this.op | 0).toString(16);
      if (this.repStateText) dtext += this.repStateText;
    }
    out.push({ k: 'decode', t: 0, cs, ip, len: this.ibytes.length, text: dtext, bytes: this.ibytes.slice(), bits });
    // The pipeline: prefetch, decode 1, decode 2 hold the next instructions, execute holds this
    // one, write-back the one before it.
    const next = ['', '', ''];
    if (typeof Disasm86 !== 'undefined' && !halted) {
      const nb = this.cache[CS].base, nbits = this.cache[CS].big ? 32 : 16;
      let o = this.ip;
      for (let k = 0; k < 3; k++) {
        try {
          const dd = Disasm86.decode(reader(nb, o), o, { cpu: '486', bits: nbits });
          next[k] = dd.text; o = nbits === 32 ? (o + dd.len) >>> 0 : (o + dd.len) & 0xFFFF;
        } catch (e) { break; }
      }
    }
    out.push({ k: 'pipe', t: 0, stage: [next[2], next[1], next[0], dtext, this.prevText || ''] });
    this.prevText = dtext;
    let sp = 0;
    for (const e of this.stallEv) { e.t = sp; sp += e.len; out.push(e); }
    if (this.ibytes.length) out.push({ k: 'queue', t: S, op: 'pop', n: this.ibytes.length, q: this.q });
    const mid = S + Math.max(0, Math.floor((T - S) / 2));
    for (const e of this.ev) {
      if (e.k === 'ea') e.t = Math.min(S + 1, T - 1);
      else if (e.k === 'queue') e.t = T - 1;
      else e.t = e.t !== undefined ? e.t : Math.min(mid, T - 1);
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
    out.push({ k: 'reg', t: T - 1, r: 'EIP', v: this.ip });
    out.push({ k: 'iq', t: T - 1, n: Math.min(3, (this.qt - this.qh) >> 1) });
    out.push({ k: 'end', t: T });
    out.sort((a, b) => a.t - b.t);
    this.trace = out;
    this.repStateText = null;
    return T;
  }

  // ---------- the 486 instructions ----------
  exec0Fop(op2) {
    this.op2 = op2;
    const S = this.osz, R = this.r;
    if (op2 === 0xB0 || op2 === 0xB1) { this.cmpxchg(op2 & 1 ? S : 1); return; }
    if (op2 === 0xC0 || op2 === 0xC1) { this.xadd(op2 & 1 ? S : 1); return; }
    if (this.lock) { super.exec0Fop(op2); return; }
    if (op2 >= 0xC8 && op2 <= 0xCF) {               // BSWAP r32
      const i = op2 & 7, v = R[i];
      // A 16-bit operand size is not defined; the 486 clears the 16-bit register.
      if (S === 4) R[i] = ((v >>> 24) | ((v >>> 8) & 0xFF00) | ((v & 0xFF00) << 8) | (v << 24)) >>> 0;
      else this.rset(i, 2, 0);
      this.aluNote('BSWAP', v, 0, R[i], S);
      return;
    }
    switch (op2) {
      case 0x08: case 0x09: {                        // INVD / WBINVD (CPL 0)
        this.priv0();
        this.cacheFlush();
        this.sysEv(op2 === 8 ? 'INVD' : 'WBINVD', `the internal cache is empty (512 lines invalid)${op2 === 9 ? '; write-back cycle to the external cache' : ''}`);
        return;
      }
      case 0xA2: this.cpuid(); return;
      default: super.exec0Fop(op2);
    }
  }
  // 0F 01 /7: INVLPG m (CPL 0). It removes the TLB entry of the linear address.
  grp0F01() {
    if (this.reg !== 7) { super.grp0F01(); return; }
    this.memOnly();
    this.priv0();
    const la = this.linear(this.eaSeg, this.eaOff), e = this.tlbFind(la);
    if (e) e.valid = false;
    this.sysEv('INVLPG', `TLB entry of page ${((la & 0xFFFFF000) >>> 0).toString(16).toUpperCase().padStart(8, '0')}: ${e ? 'removed' : 'not in the TLB'}`);
  }
  // CPUID (a 486 with CPUID): leaf 0 = the highest leaf (1) and "GenuineIntel", leaf 1 = the
  // signature (family, model, stepping) and the feature bits (bit 0 = FPU on the chip).
  cpuid() {
    const R = this.r, leaf = R[0];
    if (leaf === 0) { R[0] = 1; R[3] = 0x756E6547; R[2] = 0x49656E69; R[1] = 0x6C65746E; }
    else if (leaf === 1) { R[0] = CPU80486.SIGNATURE; R[3] = 0; R[1] = 0; R[2] = this.bus.fpu ? 1 : 0; }
    else { R[0] = 0; R[1] = 0; R[2] = 0; R[3] = 0; }
    this.sysEv('CPUID', `leaf ${leaf}: EAX ${(R[0] >>> 0).toString(16).toUpperCase()}h`);
  }
  // XADD r/m, r: TEMP = DEST + SRC; SRC = DEST; DEST = TEMP (the flags of ADD).
  xadd(s) {
    this.modrm();
    this.lockCheck(true);
    if (this.mod !== 3) this.wrCheck(this.eaSeg, this.eaOff, s);
    const d = this.getE(s), g = this.getG(s), r = this.aluS(0, d, g, s);
    if (this.mod === 3) { this.setG(s, d); this.setE(s, r); } else { this.setE(s, r); this.setG(s, d); }
  }
  // CMPXCHG r/m, r: compare the accumulator with DEST (the flags of CMP). Equal: DEST = SRC.
  // Not equal: the accumulator = DEST (a memory DEST is written with its own value).
  cmpxchg(s) {
    this.modrm();
    this.lockCheck(true);
    if (this.mod !== 3) this.wrCheck(this.eaSeg, this.eaOff, s);
    const d = this.getE(s), a = this.rget(0, s), r = this.subS(a, d, 0, s);
    this.aluNote('CMPXCHG', a, d, r, s);
    this.cmpxOk = a === d;
    if (this.cmpxOk) this.setE(s, this.getG(s));
    else { if (this.mod !== 3) this.setE(s, d); this.rset(0, s, d); }
  }
  // Test registers TR3-TR5 (the cache test). TR5: bits 0-1 control (0 = the buffers, 1 = cache
  // write, 2 = cache read, 3 = flush), bits 2-3 entry (a dword of the buffer, or the way),
  // bits 4-10 the set. TR4: bits 11-31 tag, bit 10 valid, bits 7-9 LRU and bits 3-6 the valid
  // bits of the set (after a cache read). TR3: a dword of the fill buffer (write) or of the
  // read buffer (read).
  rdTR(n) {
    if (n === 3) return this.readBuf[(this.tr5 >> 2) & 3];
    if (n === 4) return this.tr4;
    if (n === 5) return this.tr5;
    return super.rdTR(n);
  }
  wrTR(n, v) {
    if (n === 3) { this.fillBuf[(this.tr5 >> 2) & 3] = v; return; }
    if (n === 4) { this.tr4 = v >>> 0; return; }
    if (n !== 5) { super.wrTR(n, v); return; }
    this.tr5 = v & 0x7FF;
    const C = this.cache486, set = (v >> 4) & 127, i = set * 4 + ((v >> 2) & 3), l = C.lines[i], D = C.data;
    switch (v & 3) {
      case 1:                                         // cache write: the fill buffer and TR4 into the line
        for (let k = 0; k < 16; k++) D[i * 16 + k] = (this.fillBuf[k >> 2] >>> (8 * (k & 3))) & 0xFF;
        l.tag = this.tr4 >>> 11; l.valid = (this.tr4 & 0x400) !== 0; l.addr = ((l.tag << 11) | (set << 4)) >>> 0;
        this.ctag[i] = l.valid ? l.tag : -1;
        break;
      case 2: {                                       // cache read: the line into the read buffer and TR4
        for (let k = 0; k < 4; k++) this.readBuf[k] = (D[i * 16 + 4 * k] | (D[i * 16 + 4 * k + 1] << 8) | (D[i * 16 + 4 * k + 2] << 16) | (D[i * 16 + 4 * k + 3] << 24)) >>> 0;
        let vb = 0;
        for (let w = 0; w < 4; w++) if (this.ctag[set * 4 + w] >= 0) vb |= 1 << w;
        const g = this.ctag[i];
        this.tr4 = (((g >= 0 ? g : l.tag) << 11) | (g >= 0 ? 0x400 : 0) | (C.lru[set] << 7) | (vb << 3)) >>> 0;
        break;
      }
      case 3: this.cacheFlush(); break;
      default: break;
    }
    this.sysEv('TR5', `cache test: ${['buffer', 'write', 'read', 'flush'][v & 3]}, set ${set}, entry ${(v >> 2) & 3}`);
  }

  // ---------- the FPU on the chip ----------
  // The CPU reads the memory operand before the FPU works and writes the result after it
  // (normal data cycles through the cache, no coprocessor ports). Without an FPU (bus.fpu =
  // null) the 80386 path runs (as with no coprocessor).
  esc(op) {
    const fpu = this.bus.fpu;
    if (!fpu) { super.esc(op); return; }
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
      // #AC: 2, 4 or 8 bytes by the operand (the environment and the state: 2 or 4)
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
    const mn = (res.text || '').split(':')[0];
    const row = P486_FPU.find(([re]) => re.test(mn));
    this.clk += row ? row[1] : Math.max(3, Math.round((res.cycles || 0) / 5));
    if (this.trace) this.ev.push({ k: 'fpu', text: res.text || '', cycles: res.cycles || 0 });
  }
}
// The CPUID signature and the EDX value after reset: family 4, model 1 (486DX), stepping 5.
CPU80486.SIGNATURE = 0x0415;
CPU80486.prototype.fmask = P386_FMASK | P486_AC | P486_ID;
CPU80486.prototype.xfl = P486_AC | P486_ID;
