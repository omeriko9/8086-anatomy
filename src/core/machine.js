// The whole computer: memory map, I/O map, CPU, 8087 and support chips.

const MEM_SIZE = 1 << 20;
const RAM_TOP = 0xA0000;          // 640 KB
const VRAM_BASE = 0xB8000, VRAM_END = 0xBC000;
const ROM_BASE = 0xF0000;
const VGA_LO = 0xA0000, VGA_HI = 0xC0000;   // VGA video memory window (the GC maps it)
const VROM_LO = 0xC0000, VROM_HI = 0xC8000; // VGA video BIOS (option ROM)
const PROG_SEG = 0x1000;
const CPU_HZ = 4772727;

// The ports whose value can change with time alone (no write and no interrupt): the 8253/8254,
// the refresh bit of port 61h, the keyboard controller, the video status, the OPL2 and DSP
// status and the floppy status. A wait loop that reads one of them gets short skips (run).
const IDLE_TIME_PORTS = (() => {
  const t = new Uint8Array(0x10000);
  for (const p of [0x40, 0x41, 0x42, 0x43, 0x60, 0x61, 0x64, 0x3BA, 0x3DA, 0x388, 0x389, 0x228, 0x229, 0x22A, 0x22C, 0x22E, 0x3F4, 0x3F5]) t[p] = 1;
  return t;
})();

class Machine {
  // opts (for other models): { model, memSize, clockHz, cpuClass, fpuModel, video: 'cga' | 'vga',
  //   soundCard: false (no Sound Blaster) }
  constructor(opts = {}) {
    this.tickDue = 0; this.progOrigin = 0x100; this.progLen = 0;   // all the fields start here (see CPU8086)
    // The wait-loop skip (see run): wrChg counts the memory writes that change a byte, ioRdN
    // the reads of the ports in IDLE_TIME_PORTS, ioWrN the port writes; idle* is the state of the loop that run() watches.
    this.wrChg = 0; this.ioRdN = 0; this.ioWrN = 0;
    this.idleSkip = true; this.idleIp = -1; this.idleN = 0; this.idleC = 0; this.idleI = 0; this.idleT = 0;
    this.haltWaits = 0; this.haltSaved = 0;     // the counters of haltWait (see run)
    this.idleRd = 0; this.idleS = new Float64Array(20); this.idleP = new Float64Array(20); this.idleSkips = 0; this.idleSaved = 0;
    this.model = opts.model || '8086';
    this.memSize = opts.memSize || MEM_SIZE;
    this.clockHz = opts.clockHz || CPU_HZ;
    // opts.wasmMem (X86W.memory): the RAM and the heat maps in the memory of the WebAssembly core
    this.wasmMem = opts.wasmMem || null;
    this.mem = this.wasmMem ? this.wasmMem.ram : new Uint8Array(this.memSize);
    this.heat = this.wasmMem ? { read: this.wasmMem.heatR, write: this.wasmMem.heatW } : { read: new Float32Array(this.memSize >> 8), write: new Float32Array(this.memSize >> 8) };
    this.breakpoints = new Set();
    this.kbd = new Keyboard();
    this.pic = new PIC8259();
    this.pit = new PIT8253();
    this.ppi = new PPI8255(this.kbd);
    this.dma = new DMA8237();
    this.video = opts.video === 'vga' && typeof VGA !== 'undefined' ? 'vga' : 'cga';
    this.crtc = this.video === 'cga' ? new CRTC6845() : null;
    this.vga = this.video === 'vga' ? new VGA({ clockHz: this.clockHz }) : null;
    this.vgaRom = null;
    this.nmiMask = 0;
    this.nmiLatch = false;
    this.fpuIntPrev = false;
    // The last 64 port accesses: a ring of fixed objects (no new object for each access).
    // ioCount counts all the accesses; the getter ioLog gives them oldest first.
    this.ioRing = Array.from({ length: 64 }, () => ({ dir: 'in', port: 0, v: 0, c: 0 }));
    this.ioPos = 0; this.ioCount = 0;
    this.speakerCb = null;
    this.lastTone = 0;
    this.romImage = null;
    this.biosSym = {};
    this.disks = [null, null];
    this.hdisk = null;
    this.diskStatus = 0;
    this.diskClock = 0;
    // Floppy: the uPD765 controller and the page registers (80h-8Fh) of the DMA channels
    this.diskTiming = 'fast';           // 'fast' | 'real' (see src/core/fdc765.js)
    this.pageRegs = new Uint8Array(16);
    this.devTrace = null;               // in step(): the 'fdc', 'dma', 'sb' and 'opl' events of the instruction
    this.dmaSteal = 0; this.fdcLag = 0; this.ioSeq = 0; this.ioSeqs = {}; this.dmaEv = null;
    // Sound Blaster 2.0 + OPL2 (src/core/soundblaster.js). An 8-bit ISA I/O cycle to the card
    // takes about 0.9 us: a fast CPU waits (ioStall) for the clocks above its own count.
    this.audioRate = 44100;             // the sample rate of takeSound() (the UI sets it)
    this.audioOn = false;               // true: the OPL2 makes its samples at each register write
    this.sb = null; this.opl = null;
    this.isaIo = Math.max(0, Math.round(this.clockHz * 0.9e-6) - 8);
    this.ioStall = 0;
    this.spkLog = [];
    this.spkPrev = { c: 0, bit1: 0, gate: 0, mode: 3, reload: 0x10000, phase0: 0 };
    this.stats = Machine.newStats();
    if (this.vga) Object.assign(this.stats.dev, { vga: 0, vrom: 0 });
    const m = this;
    const mem = this.mem, heat = this.heat;
    this.bus = {
      read8(a) {
        heat.read[a >> 8] += 1;
        const d = m.stats.dev;
        if (a < RAM_TOP) { d.ram++; return mem[a]; }
        if (a >= ROM_BASE) { d.rom++; return mem[a]; }
        if (a >= VRAM_BASE && a < VRAM_END) { d.vram++; return mem[a]; }
        return 0xFF;
      },
      write8(a, v) {
        heat.write[a >> 8] += 1;
        const d = m.stats.dev;
        if (a < RAM_TOP) { d.ram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
        else if (a >= VRAM_BASE && a < VRAM_END) { d.vram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
      },
      // a port access brings the devices up to date first (see run)
      in8: p => { if (m.tickDue) m.tickPending(); if (IDLE_TIME_PORTS[p & 0xFFFF]) m.ioRdN++; return m.ioRead(p); },
      out8: (p, v) => { if (m.tickDue) m.tickPending(); m.ioWrN++; m.ioWrite(p, v); },
      // 16-bit port accesses: the data port of the IDE controller (1F0h) moves a word; the
      // other ports get two byte accesses (the low byte first)
      in16: p => ((p & 0xFFFF) === 0x1F0 && m.hdisk && m.ide ? m.ideData(-1) : m.bus.in8(p) | (m.bus.in8((p + 1) & 0xFFFF) << 8)),
      out16: (p, v) => { if ((p & 0xFFFF) === 0x1F0 && m.hdisk && m.ide) m.ideData(v & 0xFFFF); else { m.bus.out8(p, v & 0xFF); m.bus.out8((p + 1) & 0xFFFF, (v >> 8) & 0xFF); } },
      devAt: a => m.devAt(a),
      ioDevAt: p => m.ioDevAt(p),
      irqPending: () => m.pic.pending(),
      ackIrq: () => m.pic.ack(),
      nmiPending: () => m.nmiLatch,
      ackNmi: () => { m.nmiLatch = false; },
      fpu: null,
      stats: this.stats,
    };
    if (this.vga) {
      // VGA: A0000-BFFFF go through the graphics controller, C0000-C7FFF is the video BIOS
      const vga = this.vga;
      this.bus.read8 = a => {
        heat.read[a >> 8] += 1;
        const d = m.stats.dev;
        if (a < RAM_TOP) { d.ram++; return mem[a]; }
        if (a >= ROM_BASE) { d.rom++; return mem[a]; }
        if (a < VGA_HI) { d.vram++; return vga.read8(a); }
        if (a < VROM_HI) { d.vrom++; return mem[a]; }
        return 0xFF;
      };
      this.bus.write8 = (a, v) => {
        heat.write[a >> 8] += 1;
        const d = m.stats.dev;
        if (a < RAM_TOP) { d.ram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
        else if (a < VGA_HI) { d.vram++; m.wrChg++; vga.write8(a, v); }
      };
    }
    if (typeof FPU8087 !== 'undefined') {
      const amask = this.memSize - 1;
      this.fpu = new FPU8087({
        read8: a => { m.stats.fpu++; return m.bus.read8(a & amask); },
        write8: (a, v) => { m.stats.fpu++; m.bus.write8(a & amask, v); },
      }, opts.fpuModel ? { model: opts.fpuModel } : undefined);
      this.bus.fpu = this.fpu;
    } else this.fpu = null;
    this.cpu = new (opts.cpuClass || CPU8086)(this.bus);
    this.fdc = typeof FDC765 !== 'undefined' ? new FDC765(this, { at: this.model !== '8086' }) : null;
    // the hard disk: the IDE controller (ports 1F0h-1F7h, 3F6h) and the disk in it (hdisk)
    this.ide = typeof IDEController !== 'undefined' ? new IDEController(this, { at: this.model !== '8086' }) : null;
    this.soundCard = opts.soundCard !== false;
    this.wireChips();
  }

  wireChips() {
    this.pit.onOut0 = () => this.pic.raise(0);
    this.pit.onChange = () => this.updateSpeaker();
    this.pit.cycleNow = () => this.cpu.cycles;
    this.ppi.onPortB = () => this.updateSpeaker();
    this.kbd.raise = () => this.pic.raise(1);
  }

  static newStats() {
    return { fetch: 0, memr: 0, memw: 0, ior: 0, iow: 0, inta: 0, halt: 0, fpu: 0,
      dev: { ram: 0, rom: 0, vram: 0, pic: 0, pit: 0, ppi: 0, dma: 0, crtc: 0, cga: 0, nmi: 0, fdc: 0, hdc: 0, sb: 0, opl: 0 } };
  }
  // The Sound Blaster card: true = in the machine (the default), false = removed.
  get soundCard() { return !!this.sb; }
  set soundCard(on) {
    if (on && !this.sb && typeof SoundBlaster !== 'undefined') { this.sb = new SoundBlaster(this); this.opl = this.sb.opl; }
    else if (!on && this.sb) { if (this.sb.irq) this.pic.lower(7); this.sb = null; this.opl = null; }
  }
  // The device name of a Sound Blaster port, or null: 220h-22Fh 'sb' (228h-229h 'opl'), 388h-389h 'opl'.
  cardDev(p) {
    if (!this.sb) return null;
    if (p >= 0x220 && p <= 0x22F) return p === 0x228 || p === 0x229 ? 'opl' : 'sb';
    if (p === 0x388 || p === 0x389) return 'opl';
    return null;
  }
  // The mixed audio of the sound card for the emulated time since the last call:
  // { rate (m.audioRate), samples: Float32Array (mono, about -1..1) }. No card: no samples.
  takeSound() {
    const rate = this.audioRate || 44100;
    return this.sb ? this.sb.takeSound(rate) : { rate, samples: new Float32Array(0) };
  }
  // Return the counters since the last call and start new ones.
  takeStats() {
    const s = this.stats, out = { ...s, dev: { ...s.dev } };
    for (const k in s) if (k !== 'dev') s[k] = 0;
    for (const k in s.dev) s.dev[k] = 0;
    return out;
  }

  devAt(a) {
    if (this.vga) return a < RAM_TOP ? 'ram' : a < VGA_HI ? 'vram' : a < VROM_HI ? 'vrom' : a >= ROM_BASE ? 'rom' : 'none';
    if (a < RAM_TOP) return 'ram';
    if (a >= VRAM_BASE && a < VRAM_END) return 'vram';
    if (a >= ROM_BASE) return 'rom';
    return 'none';
  }
  ioDevAt(p) {
    if (p < 0x10) return 'dma';
    if (p === 0x3F2 || p === 0x3F4 || p === 0x3F5) return 'fdc';
    if ((p >= 0x1F0 && p <= 0x1F7) || p === 0x3F6) return 'hdc';
    if (p === 0x20 || p === 0x21) return 'pic';
    if (p >= 0x40 && p <= 0x43) return 'pit';
    if (p >= 0x60 && p <= 0x63) return 'ppi';
    if (p === 0xA0) return 'nmi';
    if (this.vga) { if (this.vga.isPort(p)) return 'vga'; if (p >= 0x3B0 && p <= 0x3DF) return 'none'; }
    if (p === 0x3D4 || p === 0x3D5) return 'crtc';
    if (p >= 0x3D8 && p <= 0x3DA) return 'cga';
    if (p >= 0x80 && p <= 0x8F) return 'dma';
    if (p >= 0xE0 && p <= 0xE7) return 'fdc';
    return this.cardDev(p) || 'none';
  }
  ioRead(p) {
    let v = 0xFF;
    const dv = this.ioDevAt(p);
    if (dv in this.stats.dev) this.stats.dev[dv]++;
    switch (dv) {
      case 'dma': v = p < 0x10 ? this.dma.read(p) : this.pageRegs[p & 15]; break;
      case 'pic': v = this.pic.read(p); break;
      case 'pit': v = this.pit.read(p - 0x40); break;
      case 'ppi': v = this.ppi.read(p - 0x60); break;
      case 'nmi': v = this.nmiMask; break;
      case 'crtc': case 'cga': v = this.crtc.read(p); break;
      case 'vga': v = this.vga.ioRead(p); break;
      case 'fdc': v = this.fdcRead(p); break;
      case 'hdc': v = this.ideRead(p); break;
      case 'sb': case 'opl': v = this.cardRead(dv, p); break;
    }
    this.logIO('in', p, v);
    return v;
  }
  // The IDE controller (all machines use these helpers). It is an ISA card: each access
  // takes the ISA I/O time.
  ideRead(p) { this.ioStall += this.isaIo; return this.ide ? this.ide.read(p) : 0xFF; }
  ideWrite(p, v) { this.ioStall += this.isaIo; if (this.ide) this.ide.write(p, v); }
  // A word of the data port 1F0h (v < 0: a read).
  ideData(v) {
    if (this.tickDue) this.tickPending();
    this.stats.dev.hdc++;
    this.ioStall += this.isaIo;
    if (v < 0) { const r = this.ide.read16(); this.logIO('in', 0x1F0, r); return r; }
    this.ide.write16(v);
    this.logIO('out', 0x1F0, v);
    return 0;
  }
  // The Sound Blaster ports (all machines use these two helpers).
  cardRead(dv, p) {
    if (this.devTrace) this.ioSeqs[dv] = (this.ioSeqs[dv] || 0) + 1;
    this.ioStall += this.isaIo;
    return dv === 'sb' ? this.sb.read(p) : this.sb.oplRead(p);
  }
  cardWrite(dv, p, v) {
    if (this.devTrace) this.ioSeqs[dv] = (this.ioSeqs[dv] || 0) + 1;
    this.ioStall += this.isaIo;
    if (dv === 'sb') this.sb.write(p, v); else this.sb.oplWrite(p, v);
  }
  ioWrite(p, v) {
    const dv = this.ioDevAt(p);
    if (dv in this.stats.dev) this.stats.dev[dv]++;
    switch (dv) {
      case 'dma': if (p < 0x10) this.dma.write(p, v); else this.writePage(p, v); break;
      case 'pic': this.pic.write(p, v); break;
      case 'pit': this.pit.write(p - 0x40, v); break;
      case 'ppi': this.ppi.write(p - 0x60, v); break;
      case 'nmi': this.nmiMask = v; break;
      case 'crtc': case 'cga': this.crtc.write(p, v); break;
      case 'vga': this.vga.ioWrite(p, v); break;
      case 'fdc': this.fdcWrite(p, v); break;
      case 'hdc': this.ideWrite(p, v); break;
      case 'sb': case 'opl': this.cardWrite(dv, p, v); break;
    }
    this.logIO('out', p, v);
  }
  // DMA page registers 80h-8Fh: 87h channel 0, 83h channel 1, 81h channel 2, 82h channel 3
  // (the AT adds 8Fh, 8Bh, 89h, 8Ah for the channels 4-7 of the second 8237).
  writePage(p, v) {
    this.pageRegs[p & 15] = v;
    const ch = { 0x87: 0, 0x83: 1, 0x81: 2, 0x82: 3 }[p];
    if (ch !== undefined) this.dma.page[ch] = this.model !== '8086' ? v : v & 0x0F;   // the XT has 4-bit page registers
    else if (this.dma2) { const c2 = { 0x8F: 0, 0x8B: 1, 0x89: 2, 0x8A: 3 }[p]; if (c2 !== undefined) this.dma2.page[c2] = v; }
  }
  // The floppy controller ports (3F2h, 3F4h, 3F5h; 3F7h on the AT). The ports of the old
  // simplified controller stay for the tests: E0h runs diskService, E1h its status,
  // E2h sets the BIOS clock from the host (the BIOS uses it at start-up).
  fdcRead(p) {
    if (p >= 0x3F0) { if (this.devTrace) this.ioSeq++; return this.fdc ? this.fdc.read(p) : 0xFF; }
    return p === 0xE1 ? this.diskStatus : 0;
  }
  fdcWrite(p, v) {
    if (p >= 0x3F0) { if (this.devTrace) this.ioSeq++; if (this.fdc) this.fdc.write(p, v); return; }
    if (p === 0xE0) diskService(this);
    else if (p === 0xE2) this.setClockFromHost();
  }
  // DRQ of a device on a channel of the first 8237: one transfer. The DMA takes the bus
  // from the CPU for 4 clocks. Returns { addr, data, read, tc } or null (no DACK).
  // t: the clock in the instruction (none from the floppy controller: its tOff is used).
  dmaRequest(ch, toMem, data, t) {
    if (!this.dmaMem) this.dmaMem = { read: a => this.dmaRead(a), write: (a, v) => this.dmaWrite(a, v) };
    const r = this.dma.transfer(ch, this.dmaMem, data);
    if (!r) return null;
    this.stats.dev.dma++;
    this.dmaSteal += 4;
    if (this.devTrace) {
      if (!this.dmaEv || this.dmaEv.ch !== ch) {
        this.dmaEv = { k: 'dma', t: t !== undefined ? t : this.fdc ? Math.round(this.fdc.tOff) : 0, ch, addr: r.addr, data: r.data, read: r.read, n: 1, count: this.dma.count[ch] };
        this.devTrace.push(this.dmaEv);
      } else { this.dmaEv.n++; this.dmaEv.count = this.dma.count[ch]; }
    }
    return r;
  }
  dmaRead(a) { return this.bus.read8(a & 0xFFFFF); }
  dmaWrite(a, v) { this.bus.write8(a & 0xFFFFF, v); }
  // A trace event of a device (the floppy controller, the sound card). t undefined: the
  // event comes from a port access of the CPU to device dev ('fdc' | 'sb' | 'opl'), and
  // step() gives it the time of that bus cycle.
  traceDev(e, dev = 'fdc') {
    if (!this.devTrace) return;
    if (e.t === undefined) { e.io = (dev === 'fdc' ? this.ioSeq : this.ioSeqs[dev] || 0) - 1; e.iodev = dev; }
    this.devTrace.push(e);
  }
  logIO(dir, port, v) {
    const e = this.ioRing[this.ioPos];
    e.dir = dir; e.port = port; e.v = v; e.c = this.cpu ? this.cpu.cycles : 0;
    this.ioPos = (this.ioPos + 1) & 63; this.ioCount++;
  }
  get ioLog() {
    const n = Math.min(64, this.ioCount), out = [];
    for (let k = n; k > 0; k--) out.push(this.ioRing[(this.ioPos - k) & 63]);
    return out;
  }

  // The clock port (like the add-on clock cards of the time): BIOS ticks since midnight.
  setClockFromHost() {
    const d = new Date();
    const secs = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    const t = Math.floor(secs * 1193182 / 65536);
    this.mem[0x46C] = t & 0xFF; this.mem[0x46D] = (t >> 8) & 0xFF; this.mem[0x46E] = (t >> 16) & 0xFF; this.mem[0x46F] = 0;
  }

  // Speaker input changes since the last call (for the sampled sound).
  takeSpeaker() {
    const prev = this.spkPrev, log = this.spkLog;
    this.spkLog = [];
    if (log.length) this.spkPrev = log[log.length - 1];
    return { prev, log };
  }

  insertDisk(i, name, bytes) { this.disks[i] = new FloppyDisk(name, bytes); return this.disks[i]; }
  ejectDisk(i) { this.disks[i] = null; }
  // The hard disk (drive C:): an image of whole sectors (see HardDisk in disk.js). The BIOS finds
  // it at the start-up (POST), so a change needs a reset.
  insertHardDisk(name, bytes, geo) { this.hdisk = new HardDisk(name, bytes, geo); if (this.ide) this.ide.reset(); return this.hdisk; }
  ejectHardDisk() { this.hdisk = null; if (this.ide) this.ide.reset(); }

  onSpeaker(cb) { this.speakerCb = cb; }
  updateSpeaker() {
    const b = this.ppi.portB, ch = this.pit.ch[2];
    if ((b & 1) && !ch.gate) ch.loadCycle = this.cpu ? this.cpu.cycles : 0;   // gate rise restarts mode 3
    this.pit.ch[2].gate = b & 1;
    const st = { c: this.cpu ? this.cpu.cycles : 0, bit1: (b >> 1) & 1, gate: b & 1, mode: ch.mode, reload: ch.reload, phase0: ch.loadCycle || 0, armed: ch.armed };
    const last = this.spkLog.length ? this.spkLog[this.spkLog.length - 1] : this.spkPrev;
    if (st.bit1 !== last.bit1 || st.gate !== last.gate || st.mode !== last.mode || st.reload !== last.reload || st.phase0 !== last.phase0) {
      this.spkLog.push(st);
      if (this.spkLog.length > 200000) this.spkLog.splice(0, 100000);
    }
    const hz = (b & 3) === 3 ? this.pit.toneHz() : 0;
    if (hz !== this.lastTone) {
      this.lastTone = hz;
      if (this.speakerCb) this.speakerCb(hz);
    }
  }

  setRom(bytes, symbols) {
    this.romImage = bytes;
    if (symbols) this.biosSym = symbols;
  }
  // The VGA video BIOS (32 KB at C0000); reset() copies it into place.
  setVgaRom(bytes) { this.vgaRom = bytes; }

  // Power-on reset: clear RAM, reload ROM, reset every chip.
  reset() {
    this.tickDue = 0;
    if (this.ide) this.ide.reset();
    this.mem.fill(0, 0, RAM_TOP);
    if (this.vga) {
      this.vga.reset();
      this.mem.fill(0xFF, VROM_LO, VROM_HI);
      if (this.vgaRom) this.mem.set(this.vgaRom.subarray(0, VROM_HI - VROM_LO), VROM_LO);
    } else {
      this.mem.fill(0, VRAM_BASE, VRAM_END);
      for (let i = VRAM_BASE; i < VRAM_BASE + 4000; i += 2) this.mem[i + 1] = 0x07;
    }
    this.mem.fill(0xFF, ROM_BASE);
    if (this.romImage) this.mem.set(this.romImage.subarray(0, 0x10000), ROM_BASE);
    this.pic.reset(); this.pit.reset(); this.ppi.reset(); this.dma.reset(); if (this.crtc) this.crtc.reset(); this.kbd.reset();
    this.wireChips();
    this.spkLog.length = 0;
    this.spkPrev = { c: 0, bit1: 0, gate: 0, mode: 3, reload: 0x10000, phase0: 0 };
    this.diskStatus = 0;
    this.pageRegs.fill(0); this.dma.page.fill(0);
    if (this.fdc) this.fdc.powerOn();
    if (this.sb) this.sb.powerOn();
    this.dmaSteal = 0; this.fdcLag = 0; this.ioStall = 0;
    if (this.fpu) this.fpu.reset();
    this.nmiMask = 0; this.nmiLatch = false; this.fpuIntPrev = false;
    this.cpu.reset();
    this.heat.read.fill(0); this.heat.write.fill(0);
    this.ioPos = 0; this.ioCount = 0;
    this.lastTone = -1; this.updateSpeaker();
  }

  // Copy a .COM style program to 1000:origin with a PSP (INT 20h at 1000:0000).
  loadProgram(bytes, origin = 0x100) {
    const base = PROG_SEG << 4;
    this.mem.fill(0, base, base + 0x10000);
    this.mem[base] = 0xCD; this.mem[base + 1] = 0x20;
    this.mem.set(bytes.subarray(0, 0x10000 - origin), base + origin);
    this.progOrigin = origin;
    this.progLen = bytes.length;
  }
  // Point the CPU at the loaded program (used after the BIOS finishes, or directly).
  startProgram() {
    const c = this.cpu, origin = this.progOrigin || 0x100;
    c.sregs.fill(PROG_SEG);
    c.regs.fill(0);
    c.regs[4] = 0xFFFE;
    if (c.regs32) { c.regs32.fill(0); c.regs32[4] = 0xFFFE; }   // the 80386: the high halves too
    this.mem[(PROG_SEG << 4) + 0xFFFE] = 0; this.mem[(PROG_SEG << 4) + 0xFFFF] = 0;
    c.ip = origin; c.halted = false; c.repState = null;
    // IF = 1. The 8086 shows the bits 12-15 as 1 (F202h). Do not set them here: on the
    // 80386 they are IOPL and NT, and they can change in real mode.
    c.flags = 0x0202;
    c.flush();
  }

  // Writes to memory that do not come from the CPU. The UI and the tools must use these (not
  // m.mem directly) while the machine runs: the 80486 machine (Machine486) must then remove
  // the old copies of these bytes from the on-chip cache. addr: a physical address.
  // pokeMem copies bytes (an array, a Uint8Array or one number) into m.mem at addr.
  pokeMem(addr, bytes) {
    if (typeof bytes === 'number') bytes = [bytes];
    this.mem.set(bytes, addr);
    this.memChanged(addr, bytes.length);
  }
  // Tell the machine that addr .. addr + len - 1 changed in m.mem (only Machine486 does work here).
  memChanged(addr, len) { this.wrChg++; }   // (the wait-loop skip sees the change)

  // The text buffer as a program sees it at B8000 (with VGA: planes 0 and 1, odd/even).
  vram() { return this.vga ? this.vga.textBuffer(VRAM_END - VRAM_BASE) : this.mem.subarray(VRAM_BASE, VRAM_END); }
  // Read memory for a display (no bus cycle, no heat, no counters).
  peek8(a) {
    a &= 0xFFFFF;
    if (this.vga && a >= VGA_LO && a < VGA_HI) return this.vga.peek8(a);
    return this.mem[a];
  }
  // CS base: the descriptor cache on the 80286, segment * 16 on the 8086
  get csBase() { const c = this.cpu; return c.cache ? c.cache[1].base : c.sregs[1] << 4; }
  get physIP() { return (this.csBase + this.cpu.ip) & (this.memSize - 1); }

  tickDevices(c) {
    if (this.ioStall) { this.cpu.cycles += this.ioStall; c += this.ioStall; this.ioStall = 0; }
    if (this.fdc || this.sb) {
      // The DMA devices run first. Their DMA cycles take clocks from the CPU (the CPU waits
      // in HOLD): they count for the other devices now, and for the DMA devices next time.
      const lag = this.fdcLag;
      if (this.fdc) this.fdc.tick(c + lag);
      if (this.sb) this.sb.tick(c + lag);
      this.fdcLag = 0;
      const s = this.dmaSteal;
      if (s) { this.dmaSteal = 0; this.cpu.cycles += s; c += s; this.fdcLag = s; }
    }
    this.pit.tick(c);
    this.kbd.tick(c);
    if (this.vga) this.vga.tick(c); else this.crtc.tick(c);
    const dk = this.disks;
    for (let i = 0; i < dk.length; i++) { const d = dk[i]; if (d && d.busy > 0) d.busy = Math.max(0, d.busy - c / (this.clockHz * 0.2933)); }   // about 0.3 s
    const hd = this.hdisk;
    if (hd && hd.busy > 0) hd.busy = Math.max(0, hd.busy - c / (this.clockHz * 0.2933));
    const fi = this.fpu && this.fpu.intRequest;
    if (fi && !this.fpuIntPrev && (this.nmiMask & 0x80)) this.nmiLatch = true;
    this.fpuIntPrev = !!fi;
  }

  // The clocks of the instructions that run() did not give to the devices yet.
  tickPending() { const c = this.tickDue; this.tickDue = 0; this.tickDevices(c); }

  // One instruction with a full micro-event trace.
  step() {
    const cpu = this.cpu;
    if (this.tickDue) this.tickPending();
    cpu.trace = [];
    this.devTrace = []; this.ioSeq = 0; this.ioSeqs = {}; this.dmaEv = null;
    const cycles = cpu.step();
    const events = cpu.trace;
    cpu.trace = null;
    this.tickDevices(cycles);
    const dev = this.devTrace;
    this.devTrace = null; this.dmaEv = null;
    if (dev.length) {
      // An event of a port access gets the time of that bus cycle; the others keep the
      // clock inside the instruction when the controller did the work.
      const ioAt = {};
      for (const e of dev) {
        if (e.io !== undefined) {
          const io = ioAt[e.iodev] || (ioAt[e.iodev] = events.filter(b => b.k === 'bus' && b.dev === e.iodev).map(b => b.t));
          e.t = io.length ? io[Math.max(0, Math.min(io.length - 1, e.io))] + 1 : 0;
          delete e.io; delete e.iodev;
        }
        e.t = Math.max(0, Math.min(cycles - 1, e.t));
        events.push(e);
      }
      events.sort((a, b) => a.t - b.t);
    }
    return { cycles, events };
  }

  // Run without trace. Stops at a breakpoint, at HLT with interrupts off, or at the
  // cycle budget. Returns the reason.
  // The devices get the clocks in groups of 64 or more (tickDue), not after each
  // instruction: this is faster. A port access gives them the clocks first, so the
  // program sees the same device state. An interrupt can come up to 64 clocks later.
  run(maxCycles) {
    const cpu = this.cpu, bp = this.breakpoints;
    let done = 0;
    const useBp = bp.size > 0;
    // The 80386 and 80486 cores copy their registers to and from the cpu.regs mirror of the
    // views only at the start and the end of the run (batch), not at each instruction.
    const batch = !!cpu.regs32;
    if (batch) { cpu.syncIn(); cpu.batch = true; }
    const idle = this.idleSkip && !useBp;
    try {
      while (done < maxCycles) {
        const c = cpu.step();
        done += c;
        if ((this.tickDue += c) >= 64) { this.tickPending(); if (idle && cpu.cycles - this.idleT > 4096) this.idleWatch(); }
        if (idle && cpu.ip === this.idleIp) done += this.idleArrive();
        if (cpu.halted) {
          if (!(cpu.f & 0x200)) { this.tickPending(); if (!this.nmiLatch) return 'halt'; }
          else if (idle && done < maxCycles) done += this.haltWait(maxCycles - done);
        }
        if (useBp && !cpu.repState && bp.has(this.physIP)) return 'break';
      }
      return 'budget';
    } finally {
      if (this.tickDue) this.tickPending();
      if (batch) { cpu.batch = false; cpu.syncOut(); }
    }
  }

  // The CPU is in HLT with IF = 1: give the devices their clocks in groups (64 clocks, or
  // 1.28 us on a fast CPU), up to room clocks or 0.25 ms, and stop when an interrupt or an NMI
  // waits. The next step of the CPU then takes the interrupt, at most one group late. The
  // Pentium Pro core moves its out-of-order model by the clocks that the machine adds to
  // cpu.cycles; oooStats.haltClk gets them too, so its counter CPU_CLK_UNHALTED (event 79h)
  // does not count them. Returns the clocks. (Before: a halted step gave only 2 clocks.)
  haltWait(room) {
    const c = this.cpu, bus = this.bus, lim = Math.min(room, this.clockHz / 4000);
    const group = Math.max(64, Math.round(this.clockHz * 1.28e-6));
    if (this.tickDue) this.tickPending();
    let skip = 0;
    while (skip < lim && !this.nmiLatch && !bus.irqPending()) {
      const n = Math.min(group, lim - skip);
      c.cycles += n; skip += n;
      this.tickDevices(n);
    }
    if (skip) {
      if (c.oooStats) c.oooStats.haltClk += skip;
      this.haltWaits++; this.haltSaved += skip;
    }
    return skip;
  }

  // ---------- the wait-loop skip ----------
  // A program often waits in a loop for an interrupt or a device (a key, the timer tick, the
  // retrace). When the CPU comes back to the same address with the same registers, flags and
  // segments, and the pass changed no byte of memory and wrote no port, the next pass does
  // exactly the same. Then run() moves the clock forward by whole passes (see idleArrive for
  // the limits: a port of IDLE_TIME_PORTS can change its value with time) and gives the
  // clocks to the devices, as if the CPU ran the passes. An interrupt or a changed value ends
  // the skip at once. The bus counters, the heat and the cache counters do not count the
  // skipped passes. Machine.step (the trace) never skips. m.idleSkip = false turns it off.
  // Watch the address of the current instruction (after 4096 clocks with no pass).
  idleWatch() {
    this.idleIp = this.cpu.ip; this.idleN = 0; this.idleT = this.cpu.cycles;
  }
  // The CPU is at the watched address again: compare with the last pass there, and with the
  // first pass (then a loop inside a loop also repeats: its period is the outer pass). Equal:
  // skip whole periods, up to 0.25 ms of CPU time (10 us when the loop reads a port of
  // IDLE_TIME_PORTS).
  idleArrive() {
    const c = this.cpu, A = this.idleS, P = this.idleP;
    this.idleT = c.cycles;
    if (this.idleN > 0 && !c.halted && !c.repState) {
      const S = this.idleSame(P) ? P : this.idleSame(A) ? A : null;
      if (S && c.cycles > S[17]) {
        const D = c.cycles - S[17], I = c.instructions - S[18];
        const cap = this.ioRdN !== S[19] ? this.clockHz / 100000 : this.clockHz / 4000;   // 10 us or 0.25 ms
        // one period at a time: stop when an interrupt waits or a device changes memory, so
        // an interrupt comes at most one pass late (as when the CPU runs the passes)
        const k = Math.max(1, Math.floor(cap / D)), w0 = this.wrChg, bus = this.bus;
        let skip = 0;
        for (let j = 0; j < k; j++) {
          c.cycles += D; c.instructions += I; skip += D;
          this.tickDue += D; this.tickPending();
          if (this.wrChg !== w0 || this.nmiLatch || ((c.f & 0x200) && bus.irqPending())) break;
        }
        this.idleKeep(A); this.idleKeep(P);
        this.idleT = c.cycles; this.idleSkips++; this.idleSaved += skip;
        return skip;
      }
    }
    if (this.idleN === 0) this.idleKeep(A);             // the first pass
    this.idleKeep(P);                                  // the last pass
    // no repeat after 64 passes (a counter, or a changed memory byte): watch another address
    if (++this.idleN > 64) this.idleIp = -1;
    return 0;
  }
  // A snapshot of the state that a pass must not change: the registers, the flags, the
  // segments, the counters of the changed bytes and of the port writes; then the clock, the
  // instruction count and the reads of the ports that change with time.
  idleKeep(S) {
    const c = this.cpu, R = c.regs32 || c.regs, sr = c.sregs;
    for (let i = 0; i < 8; i++) S[i] = R[i];
    S[8] = c.f; S[9] = this.wrChg; S[10] = this.ioWrN;
    for (let i = 0; i < sr.length; i++) S[11 + i] = sr[i];
    S[17] = c.cycles; S[18] = c.instructions; S[19] = this.ioRdN;
  }
  idleSame(S) {
    const c = this.cpu, R = c.regs32 || c.regs, sr = c.sregs;
    if (S[8] !== c.f || S[9] !== this.wrChg || S[10] !== this.ioWrN) return false;
    for (let i = 0; i < 8; i++) if (S[i] !== R[i]) return false;
    for (let i = 0; i < sr.length; i++) if (S[11 + i] !== sr[i]) return false;
    return true;
  }


  keyDown(code) { this.kbd.press(code); }
  keyUp(code) { this.kbd.press(code | 0x80); }
}
