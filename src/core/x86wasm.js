// The JavaScript side of the WebAssembly instruction core (src/core/x86core.c; the module is in
// src/core/x86core.wasm.js). The C core runs the machine without a trace (Machine.run) for the
// 80386, 80486, Pentium and Pentium Pro models; the JavaScript cores (CPU80386 / 80486 / 80586 / 80686) stay the reference: it does the trace, the steps
// that the C core sends back (the far transfers, INT, IRET, the FPU, the system instructions,
// the interrupts) and the faults.
//
// - X86W.memory(memSize): the machine makes its RAM and heat maps in a WebAssembly.Memory (at
//   fixed places that the C core knows), before its CPU and its bus functions.
// - X86W.attach(m): after the machine is made. The CPU gets views of the shared state (cpu.r,
//   cpu.sregs, cpu.cr, cpu.dr, the queue buffer, the cache arrays, the TLB counter, m.idleS/P),
//   so both cores see the same bytes. The other fields go across in push() / pull().
// - core.run(max): Machine.run in C (null: the C core cannot run now; the machine uses its own
//   run). The module compiles in the background in a page (Chrome does not compile a large
//   module on the main thread at once); until then the JavaScript core runs.
// - m.wasmCore = false (or X86W.off = true) turns the C core off.

const X86W = (() => {
  const PAGES = 336;                      // 21 MB: the C data, the guest RAM at 4 MB, the heat maps
  const GUEST = 0x400000, HEATR = 0x1400000, HEATW = 0x1440000;
  const W = { mod: null, busy: false, off: false };

  function available() { return !W.off && typeof WebAssembly !== 'undefined' && typeof X86CORE_WASM !== 'undefined'; }
  function b64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const t = atob(s), a = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i);
    return a;
  }
  function compile() {
    if (W.mod || W.busy || !available()) return W.mod;
    const bin = b64(X86CORE_WASM);
    if (typeof window === 'undefined') { try { W.mod = new WebAssembly.Module(bin); } catch (e) { W.off = true; } return W.mod; }
    W.busy = true;
    WebAssembly.compile(bin).then(m => { W.mod = m; }, () => { W.off = true; }).finally(() => { W.busy = false; });
    return null;
  }
  // The memory of a machine: the RAM (memSize must be 16 MB) and the heat maps.
  function memory(memSize) {
    if (!available() || memSize !== 0x1000000) return null;
    compile();
    let mem;
    try { mem = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES }); } catch (e) { return null; }
    const buf = mem.buffer;
    return { mem, ram: new Uint8Array(buf, GUEST, memSize), heatR: new Float32Array(buf, HEATR, memSize >> 8), heatW: new Float32Array(buf, HEATW, memSize >> 8) };
  }

  class Core {
    constructor(m) {
      this.m = m; this.cpu = m.cpu;
      this.e = null;                        // the exports (after the module is ready)
      this.inst = undefined;                // the instance (null while it is made in the background)
      this.hist = null;                     // (see note)
      this.V = null; this.Vi = null; this.D = null;
      this.resets = 0; this.seenResets = 0;
      // a reset of the CPU in a device call (the 8042, port 92h) ends the C run at once
      const orig = m.cpuReset;
      if (orig) m.cpuReset = (...a) => { this.resets++; return orig.apply(m, a); };
    }
    ready() {
      if (this.e) return true;
      if (!W.mod) { compile(); if (!W.mod) return false; }
      if (this.inst === undefined) {
        // Node: at once; a page: in the background (the next run uses it)
        this.inst = null;
        if (typeof window === 'undefined') { try { this.inst = new WebAssembly.Instance(W.mod, { env: this.imports() }); } catch (e) { W.off = true; } }
        else WebAssembly.instantiate(W.mod, { env: this.imports() }).then(i => { this.inst = i; }, () => { W.off = true; });
      }
      if (!this.inst) return false;
      this.connect(this.inst);
      return true;
    }
    connect(inst) {
      const m = this.m, cpu = this.cpu, self = this;
      this.e = inst.exports;
      const buf = m.wasmMem.mem.buffer, L = new Uint32Array(buf, this.e.init(), 52);
      this.L = L;
      this.p5 = !!cpu.dcache;                 // the Pentium (CPU80586): its caches, TLBs, BTB and pipes
      this.p6 = !!cpu.l2;                     // the Pentium Pro (CPU80686): p5 too, and the L2 and the out-of-order model
      this.i386 = !cpu.cache486 && !cpu.dcache;   // the 80386 (CPU80386): no cache; its queue is the array cpu.q
      this.V = new Uint32Array(buf, L[0], 1024); this.Vi = new Int32Array(buf, L[0], 1024);
      this.D = new Float64Array(buf, L[1], 64);
      // the shared views: the values move to the WebAssembly memory, then the CPU uses the views
      const view = (T, at, n, old) => { const v = new T(buf, at, n); v.set(old); return v; };
      cpu.r = cpu.regs32 = view(Uint32Array, L[0], 8, cpu.r);
      cpu.cr = view(Uint32Array, L[0] + 32, 5, cpu.cr);
      cpu.dr = view(Uint32Array, L[0] + 64, 8, cpu.dr);
      cpu.sregs = view(Uint16Array, L[2], 6, cpu.sregs);
      cpu.qb = view(Uint8Array, L[3], 128, cpu.qb || new Uint8Array(128));
      if (this.p5) {
        const dc = cpu.dcache, ic = cpu.icache, B = cpu.btb;
        dc.tag = cpu.dtag = cpu.ctag = view(Int32Array, L[27], 256, dc.tag);
        dc.state = view(Uint8Array, L[28], 256, dc.state); dc.lru = view(Uint8Array, L[29], 128, dc.lru); dc.data = view(Uint8Array, L[30], 8192, dc.data);
        ic.tag = cpu.itag = view(Int32Array, L[31], 256, ic.tag);
        ic.lru = view(Uint8Array, L[32], ic.lru.length, ic.lru); ic.data = view(Uint8Array, L[33], 8192, ic.data);
        if (!this.p6) {
          B.tag = view(Int32Array, L[34], 256, B.tag); B.target = view(Uint32Array, L[35], 256, B.target);
          B.counter = view(Uint8Array, L[36], 256, B.counter); B.next = view(Uint8Array, L[37], 64, B.next);
        }
        cpu.ib = view(Uint8Array, L[38], 16, cpu.ib);
        cpu.pipeStats.why = view(Uint32Array, L[39], cpu.pipeStats.why.length, cpu.pipeStats.why);
        cpu.tlb4mNext = view(Uint8Array, L[21], 2, cpu.tlb4mNext);
        cpu.itlbNext = view(Uint8Array, L[26], 8, cpu.itlbNext);
        cpu.tlbNext = view(Uint8Array, L[7], 16, cpu.tlbNext);
        if (this.p6) this.connect6(L, view);
      } else if (this.i386) {
        cpu.tlbNext = view(Uint8Array, L[7], 8, cpu.tlbNext);
      } else {
        cpu.ctag = view(Int32Array, L[4], 512, cpu.ctag);
        cpu.cache486.data = view(Uint8Array, L[5], 8192, cpu.cache486.data);
        cpu.cache486.lru = view(Uint8Array, L[6], 128, cpu.cache486.lru);
        cpu.tlbNext = view(Uint8Array, L[7], 8, cpu.tlbNext);
      }
      // the TLB entries (copied in push / pull: the JavaScript core keeps objects)
      const A = (k, n) => new Uint32Array(buf, L[k], n);
      this.T = [A(13, 64), A(14, 64), A(15, 64), A(16, 64)];
      this.T4 = [A(17, 8), A(18, 8), A(19, 8), A(20, 8)];
      this.TI = [A(22, 32), A(23, 32), A(24, 32), A(25, 32)];
      m.idleS = view(Float64Array, L[8], 20, m.idleS);
      m.idleP = view(Float64Array, L[9], 20, m.idleP);
      self.seenResets = self.resets;
    }
    // The Pentium Pro: the L2 tags, the out-of-order model of the C module (the JavaScript core uses
    // it too: cpu.w6Attach moves the model state into it) and the recipe numbers of the opcodes.
    connect6(L, view) {
      const cpu = this.cpu, l2 = cpu.l2, e = this.e, buf = this.m.wasmMem.mem.buffer;
      l2.tag = cpu.l2tag = view(Int32Array, L[40], 8192, l2.tag);
      l2.state = view(Uint8Array, L[41], 8192, l2.state); l2.lru = view(Uint8Array, L[42], 2048, l2.lru);
      cpu.w6Attach({ exports: { memory: this.m.wasmMem.mem, offsets: e.offsets, ooo: e.ooo } });
      if (!cpu.w6) { W.off = true; return; }
      const id = r => (r && r.id >= 0 ? r.id : -1);
      const R1 = new Int32Array(buf, L[43], 256), G1 = new Int32Array(buf, L[44], 2048), R0F = new Int32Array(buf, L[45], 256),
        G0F = new Int32Array(buf, L[46], 2048), FP = new Int32Array(buf, L[47], 2048), MISC = new Int32Array(buf, L[48], 4);
      for (let i = 0; i < 256; i++) {
        R1[i] = id(P686_R1[i]); R0F[i] = id(P686_R0F[i]);
        for (let r = 0; r < 8; r++) { G1[i * 8 + r] = P686_G1[i] ? id(P686_G1[i][r]) : -1; G0F[i * 8 + r] = P686_G0F[i] ? id(P686_G0F[i][r]) : -1; }
      }
      for (let i = 0; i < 2048; i++) FP[i] = id(P686_FP[i]);
      MISC[0] = id(P686_EXC); MISC[1] = id(P686_INT); MISC[2] = id(P686_RUD);
    }
    // The C core can run now: no trace, no breakpoints, no debug registers.
    usable() {
      const m = this.m, c = this.cpu;
      return m.wasmCore !== false && !W.off && !c.trace && !m.breakpoints.size && !c.dbgOn && !c.dbgExec && !c.ioBp && this.ready();
    }
    imports() {
      const self = this;
      const pre = () => {
        const m = self.m, D = self.D; m.tickDue = D[2]; self.cpu.cycles = D[0]; m.wrChg = D[3]; m.ioRdN = D[4]; m.ioWrN = D[5];
        if (self.i386 && m.bus.fpu) m.bus.fpu.busyCycles = D[15];
      };
      const post = () => {
        const m = self.m, D = self.D, V = self.V;
        D[2] = m.tickDue; D[0] = self.cpu.cycles; D[3] = m.wrChg; D[4] = m.ioRdN; D[5] = m.ioWrN;
        if (self.i386 && m.bus.fpu) D[15] = m.bus.fpu.busyCycles;
        V[56] = m.bus.irqPending() ? 1 : 0; V[57] = m.nmiLatch ? 1 : 0; V[50] = m.a20 ? 1 : 0;
        if (self.resets !== self.seenResets) V[167] = 1;           // (the C core stops: see run)
      };
      const call = f => (...a) => { pre(); const r = f(...a); post(); return r; };
      return {
        memory: self.m.wasmMem.mem,
        jtick: call(() => self.m.tickPending()),
        jtickn: call(n => self.m.tickDevices(n)),
        jin8: call(p => self.m.bus.in8(p)),
        jin16: call(p => self.m.bus.in16(p)),
        jout8: call((p, v) => self.m.bus.out8(p, v)),
        jout16: call((p, v) => self.m.bus.out16(p, v)),
        jvrd: a => self.m.vga.read8(a),
        jvwr: (a, v) => self.m.vga.write8(a, v),
        jvpeek: a => self.m.vga.peek8(a),
        jirq: () => (self.m.bus.irqPending() ? 1 : 0),
        // one instruction in the JavaScript core (the machine loop stays in C)
        jstep: () => {
          self.pull();
          if (self.hist) self.note();
          const c = self.cpu.step();
          self.push();
          return c;
        },
        // a fault in C: JavaScript delivers it (raise) and ends the instruction (finish)
        jfault: (vec, err) => {
          self.pull();
          const c = self.cpu;
          c.pendingDB = 0;
          c.raise(new Fault286(vec, err));
          const T = c.finish(null, c.halted);
          self.push();
          return T;
        },
        jdebug: db => {
          self.pull();
          const c = self.cpu;
          c.dr[6] |= db;
          c.exception(1, -1);
          const T = c.finish(null, c.halted);
          self.push();
          return T;
        },
      };
    }
    // JavaScript -> C: the fields that are not shared views
    push() {
      const c = this.cpu, m = this.m, V = this.V, D = this.D;
      V[24] = c.ip; V[25] = c.f; V[26] = c.cpl; V[27] = c.halted ? 1 : 0; V[28] = c.shutdownState ? 1 : 0; V[29] = c.inhibit ? 1 : 0;
      V[30] = c.keepRF ? 1 : 0; V[31] = c.pendingDB; V[32] = c.paging ? 1 : 0; V[33] = c.qip; V[34] = c.qh; V[35] = c.qt;
      V[36] = c.lastIP; V[37] = c.lastCS; V[38] = c.lastBase; V[39] = c.spStart;
      const ws = m.bus.waitStates; V[40] = ws === undefined ? 0 : ws; V[41] = 2 + V[40];
      const rs = c.repState;
      V[42] = rs ? 1 : 0;
      if (rs) { V[43] = rs.op; this.Vi[44] = rs.seg; V[45] = rs.rep; V[46] = rs.start; V[47] = rs.osz; V[48] = rs.a32 ? 1 : 0; }
      V[49] = c.xPcd; V[50] = m.a20 ? 1 : 0; V[51] = m.cacheSetup ? 1 : 0; V[52] = m.vga ? 1 : 0; V[53] = c.xfl; V[54] = c.fmask;
      V[55] = m.idleSkip ? 1 : 0; V[56] = m.bus.irqPending() ? 1 : 0; V[57] = m.nmiLatch ? 1 : 0; V[58] = m.clockHz;
      V[60] = c.gdtr.base; V[61] = c.gdtr.limit; V[62] = c.idtr.base; V[63] = c.idtr.limit;
      const l = c.ldtr, t = c.tr;
      V[64] = l.sel; V[65] = l.base; V[66] = l.limit; V[67] = l.access; V[68] = l.valid ? 1 : 0;
      V[69] = t.sel; V[70] = t.base; V[71] = t.limit; V[72] = t.access;
      for (let i = 0; i < 6; i++) {
        const d = c.cache[i];
        V[80 + i] = d.base; V[86 + i] = d.limit; V[92 + i] = d.access; V[98 + i] = d.flags; V[104 + i] = d.big ? 1 : 0;
        V[110 + i] = d.lo; V[134 + i] = d.lo >= 4294967296 ? 1 : 0; V[116 + i] = d.hi; V[122 + i] = d.rd ? 1 : 0; V[128 + i] = d.wr ? 1 : 0;
      }
      const tin = (list, A) => { for (let i = 0; i < list.length; i++) { const e = list[i]; A[0][i] = e.lin; A[1][i] = e.phys; A[2][i] = e.flags; A[3][i] = e.valid ? 1 : 0; } };
      tin(c.tlb, this.T);
      V[260] = this.p5 ? 1 : 0;
      if (this.p5) {
        tin(c.tlb4m, this.T4); tin(c.itlb, this.TI);
        V[261] = c.pairNext ? 1 : 0; V[262] = c.pairIP; V[263] = c.isV ? 1 : 0; V[264] = c.uClk; V[265] = c.uRet; V[266] = c.execOk ? 1 : 0;
        V[267] = c.pWhy; V[268] = c.pReg; V[269] = c.lastWhy; V[271] = c.wbLine >= 0 ? 1 : 0; V[270] = c.wbLine >= 0 ? c.wbLine : 0;
        V[272] = c.vInfo; V[273] = c.vWhy; V[275] = c.vIP >= 0 ? 1 : 0; V[274] = c.vIP >= 0 ? c.vIP : 0; V[276] = c.vBase;
        V[277] = c.tr12; V[278] = c.queueSnoop ? 1 : 0;
      }
      V[279] = this.p6 ? 1 : 0;
      V[289] = this.i386 ? 1 : 0;
      if (this.i386) {
        // the queue (an array in CPU80386) goes into the ring of the C core
        const q = c.q;
        c.qb.set(q); V[34] = 0; V[35] = q.length;
        V[288] = c.nStall | 0; D[15] = m.bus.fpu ? m.bus.fpu.busyCycles : 0;
      }
      if (this.p6) {
        const br = m.bus.busRatio;
        V[280] = c.fpTop; V[281] = (m.bus.fpu ? m.bus.fpu.cw >> 8 : 3) & 3; V[283] = c.strCont ? 1 : 0; V[284] = c.opPos;
        V[285] = c.nLd; V[286] = c.nSt;
        D[10] = c.accLat; D[11] = c.accBus; D[12] = c.codeLat; D[13] = c.codeBus; D[14] = br > 0 ? br : 3;
      }
      // the decode fields of the last instruction (the P6 model reads them)
      V[290] = c.op | 0; this.Vi[291] = c.op2 === undefined ? -1 : c.op2; this.Vi[292] = c.mod === undefined ? -1 : c.mod; V[293] = c.reg | 0; V[294] = c.rm | 0;
      V[295] = c.osz | 0; V[296] = c.a32 ? 1 : 0; V[297] = c.rep | 0; V[298] = c.lock ? 1 : 0; this.Vi[299] = c.seg === undefined ? -1 : c.seg;
      D[0] = c.cycles; D[1] = c.instructions; D[2] = m.tickDue; D[3] = m.wrChg; D[4] = m.ioRdN; D[5] = m.ioWrN;
      D[6] = m.idleT; D[7] = m.idleSaved; D[8] = m.haltSaved;
      this.Vi[210] = m.idleIp; V[211] = m.idleN; V[212] = m.idleSkips; V[213] = m.haltWaits;
      V[167] = 0;
      this.seenResets = this.resets;
    }
    // C -> JavaScript (and the counters of the C core go into the JavaScript objects)
    pull() {
      const c = this.cpu, m = this.m, V = this.V, Vi = this.Vi, D = this.D;
      c.ip = V[24]; c.f = V[25]; c.cpl = V[26]; c.halted = V[27] !== 0; c.shutdownState = V[28] !== 0; c.inhibit = V[29] !== 0;
      c.keepRF = V[30] !== 0; c.pendingDB = V[31]; c.paging = V[32] !== 0; c.qip = V[33]; if (!this.i386) { c.qh = V[34]; c.qt = V[35]; }
      c.lastIP = V[36]; c.lastCS = V[37]; c.lastBase = V[38]; c.spStart = V[39];
      if (V[42]) {
        const rs = c.repState && c.repState.op === V[43] && c.repState.start === V[46] ? c.repState : {};
        rs.op = V[43]; rs.seg = Vi[44]; rs.rep = V[45]; rs.start = V[46]; rs.osz = V[47]; rs.a32 = V[48] !== 0;
        c.repState = rs;
      } else c.repState = null;
      c.xPcd = V[49];
      c.gdtr.base = V[60]; c.gdtr.limit = V[61]; c.idtr.base = V[62]; c.idtr.limit = V[63];
      const l = c.ldtr, t = c.tr;
      l.sel = V[64]; l.base = V[65]; l.limit = V[66]; l.access = V[67]; l.valid = V[68] !== 0;
      t.sel = V[69]; t.base = V[70]; t.limit = V[71]; t.access = V[72];
      const sr = c.sregs;
      for (let i = 0; i < 6; i++) {
        const d = c.cache[i];
        d.sel = sr[i]; d.base = V[80 + i]; d.limit = V[86 + i]; d.access = V[92 + i]; d.flags = V[98 + i]; d.big = V[104 + i] !== 0;
        d.lo = V[134 + i] ? 4294967296 : V[110 + i]; d.hi = V[116 + i]; d.rd = V[122 + i] !== 0; d.wr = V[128 + i] !== 0;
      }
      const tout = (list, A) => { for (let i = 0; i < list.length; i++) { const e = list[i]; e.lin = A[0][i]; e.phys = A[1][i]; e.flags = A[2][i]; e.valid = A[3][i] !== 0; } };
      tout(c.tlb, this.T);
      if (this.p5) {
        tout(c.tlb4m, this.T4); tout(c.itlb, this.TI);
        c.pairNext = V[261] !== 0; c.pairIP = V[262]; c.isV = V[263] !== 0; c.uClk = V[264]; c.uRet = V[265]; c.execOk = V[266] !== 0;
        c.pWhy = V[267]; c.pReg = V[268]; c.lastWhy = V[269]; c.wbLine = V[271] ? V[270] : -1;
        c.vInfo = V[272]; c.vWhy = V[273]; c.vIP = V[275] ? V[274] : -1; c.vBase = V[276];
      }
      if (this.p6) {
        c.strCont = V[283] !== 0; c.opPos = V[284]; c.nLd = V[285]; c.nSt = V[286];
        c.accLat = D[10]; c.accBus = D[11]; c.codeLat = D[12]; c.codeBus = D[13]; c.busRatio = D[14];
      }
      if (this.i386) {
        c.q = Array.from(c.qb.subarray(V[34], V[35]));
        c.nStall = V[288]; c.ws = V[40]; c.busLen = V[41];
        if (m.bus.fpu) m.bus.fpu.busyCycles = D[15];
      }
      c.op = V[290]; c.op2 = Vi[291]; c.mod = Vi[292]; c.reg = V[293]; c.rm = V[294];
      c.osz = V[295]; c.a32 = V[296] !== 0; c.rep = V[297]; c.lock = V[298] !== 0; c.seg = Vi[299];
      // the parts of the instruction (for jfault and jdebug)
      c.clk = V[140]; c.nEU = V[141]; c.stallT = V[142]; c.busT = V[143]; c.rdT = V[144]; c.didFlush = V[145] !== 0; c.ilen = V[146];
      c.ext = V[154]; c.faultRF = V[155] !== 0;
      c.cycles = D[0]; c.instructions = D[1]; m.tickDue = D[2]; m.wrChg = D[3]; m.ioRdN = D[4]; m.ioWrN = D[5];
      m.idleT = D[6]; m.idleSaved = D[7]; m.haltSaved = D[8];
      m.idleIp = Vi[210]; m.idleN = V[211]; m.idleSkips = V[212]; m.haltWaits = V[213];
      // the counters
      const st = m.stats, dv = st.dev, cs = this.p5 ? c.dcache.stats : this.i386 ? null : c.cache486.stats, ts = c.tlbStats;
      if (this.p5) {
        const is = c.icache.stats, bs = c.btb.stats, ps = c.pipeStats;
        cs.writeHitsME += V[220]; cs.writeBacks += V[221];
        is.hits += V[222]; is.misses += V[223]; is.fills += V[224]; is.uncached += V[225]; is.flushes += V[226]; is.invalidations += V[227];
        ts.codeHits += V[228]; ts.codeMisses += V[229]; ts.bigHits += V[230];
        bs.lookups += V[231]; bs.hits += V[232]; bs.right += V[233]; bs.wrong += V[234]; bs.allocs += V[235]; bs.taken += V[236];
        ps.u += V[237]; ps.v += V[238]; ps.floor += V[239];
        if (this.p6) {
          const l2 = c.l2.stats;
          cs.rfo += V[241]; l2.requests += V[242]; l2.hits += V[243]; l2.misses += V[244]; l2.codeRequests += V[245]; l2.codeMisses += V[246];
          l2.fills += V[247]; l2.writeBacks += V[248]; l2.flushes += V[249]; l2.invalidations += V[250];
        }
        V.fill(0, 220, 251);
      }
      st.fetch += V[170]; st.memr += V[171]; st.memw += V[172]; st.ior += V[173]; st.iow += V[174]; st.halt += V[175]; st.inta += V[176];
      dv.ram += V[180]; dv.rom += V[181]; dv.xram += V[182]; dv.vram += V[183]; if (V[184]) dv.vrom += V[184];
      if (cs) {
        cs.hits += V[190]; cs.misses += V[191]; cs.fills += V[192]; cs.uncached += V[193]; cs.writeHits += V[194]; cs.writeMisses += V[195];
        cs.flushes += V[196]; cs.invalidations += V[197];
      }
      ts.hits += V[200]; ts.misses += V[201]; ts.flushes += V[202];
      V.fill(0, 170, 203);
    }
    // cache486.lines for the views (the cores use cpu.ctag)
    lines() {
      if (this.p5 || this.i386) return;
      const L = this.cpu.cache486.lines, t = this.cpu.ctag;
      for (let i = 0; i < 512; i++) {
        const l = L[i], g = t[i];
        l.valid = g >= 0;
        if (g >= 0) { l.tag = g; l.addr = ((g << 11) | ((i >> 2) << 4)) >>> 0; }
      }
    }
    // Machine.run in C. Returns 'budget' or 'halt' (null: the C core cannot run now).
    run(maxCycles) {
      if (!this.usable()) return null;
      const m = this.m, cpu = this.cpu;
      cpu.syncIn(); cpu.batch = true;
      this.push();
      let r = 0;
      try {
        r = this.e.run(maxCycles);
      } finally {
        if (this.resets === this.seenResets) this.pull();
        else { this.V.fill(0, 170, 203); this.V.fill(0, 220, 251); }   // (a reset: the JavaScript state is the new one)
        if (m.tickDue) m.tickPending();
        cpu.batch = false; cpu.syncOut();
        this.lines();
      }
      return r === 1 ? 'halt' : 'budget';
    }
    // A count of the instructions that go to JavaScript, by the first byte (core.hist = {} turns it
    // on; 'irq' = an interrupt, 'hlt' = the halted state).
    note() {
      const c = this.cpu, m = this.m, H = this.hist;
      let k;
      if (!c.inhibit && (m.nmiLatch || ((c.f & 0x200) && !c.shutdownState && m.bus.irqPending()))) k = 'irq';
      else if (c.halted) k = 'hlt';
      else {
        const b = c.cache[1].base;
        let i = 0, o = m.peek8((b + c.ip) >>> 0);
        while (i < 14 && ((o & 0xE7) === 0x26 || o === 0x64 || o === 0x65 || o === 0x66 || o === 0x67 || o === 0xF0 || o === 0xF2 || o === 0xF3)) o = m.peek8((b + c.ip + ++i) >>> 0);
        k = o.toString(16).padStart(2, '0');
        if (o === 0x0F) k += ' ' + m.peek8((b + c.ip + i + 1) >>> 0).toString(16).padStart(2, '0');
        if (o === 0xFF) k += ' /' + ((m.peek8((b + c.ip + i + 1) >>> 0) >> 3) & 7);
        if (c.cr[0] & 1) k += c.f & 0x20000 ? ' v86' : ' pm';
      }
      H[k] = (H[k] || 0) + 1;
    }
    // The number of steps that went to JavaScript since the last call (for the tests).
    jsSteps() { if (!this.V) return -1; const n = this.V[203]; this.V[203] = 0; return n; }
    cSteps() { if (!this.V) return -1; const n = this.V[204]; this.V[204] = 0; return n; }
  }

  function attach(m) {
    if (!m.wasmMem || !available()) return null;
    return new Core(m);
  }
  return { memory, attach, compile, available, get off() { return W.off; }, set off(v) { W.off = !!v; } };
})();
