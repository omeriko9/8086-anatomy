// The 80286 machine: an AT-class board. 80286 at 8 MHz with one memory wait state,
// 80287, two cascaded 8259A, 8254, 8042 keyboard controller (A20 gate, CPU reset),
// MC146818 clock + CMOS, two 8237, 640 KB + 1 MB extended RAM, the A20 gate on port 92h,
// the uPD765 floppy controller with the AT data rate register (3F7h).

const MEM_286 = 1 << 24;                 // 16 MB address space (24-bit bus)
const XRAM_BASE = 0x100000, XRAM_END = 0x200000;
const CPU_HZ_286 = 8000000;
const PIT_HZ = 1193182;

class Machine286 extends Machine {
  // opts: { video: 'cga' | 'vga', soundCard }. Machine386 also gives model, memSize, clockHz,
  // cpuClass, fpuModel and xramEnd (the end of the extended RAM).
  constructor(opts = {}) {
    super({ model: opts.model || '80286', memSize: opts.memSize || MEM_286, clockHz: opts.clockHz || CPU_HZ_286,
      cpuClass: opts.cpuClass || (typeof CPU80286 !== 'undefined' ? CPU80286 : CPU8086), fpuModel: opts.fpuModel || '80287', video: opts.video,
      soundCard: opts.soundCard, wasmMem: opts.wasmMem });
    this.xramEnd = opts.xramEnd || XRAM_END;
    this.refreshClk = 64 * this.clockHz / CPU_HZ_286;   // port 61h bit 4 (refresh) changes each 8 us
    this.pic2 = new PIC8259();
    this.kbc = new KBC8042(this.kbd);
    this.rtc = new RTC146818();
    this.dma2 = new DMA8237();
    this.a20 = true;
    this.port92 = 0;
    this.shutdowns = 0;
    const m = this, mem = this.mem, heat = this.heat;
    const romAt = a => (a >= ROM_BASE && a < 0x100000) ? a : (a >= 0xFF0000 ? 0xF0000 + (a & 0xFFFF) : -1);
    this.bus.read8 = a => {
      a &= 0xFFFFFF;
      // the ROM at the top of the 16 MB is decoded before the A20 gate (the reset vector)
      if (a >= 0xFF0000) { heat.read[a >> 8] += 1; m.stats.dev.rom++; return mem[0xF0000 + (a & 0xFFFF)]; }
      if (!m.a20) a &= ~0x100000;
      heat.read[a >> 8] += 1;
      const d = m.stats.dev;
      if (a < RAM_TOP) { d.ram++; return mem[a]; }
      if (a >= VRAM_BASE && a < VRAM_END) { d.vram++; return mem[a]; }
      if (a >= XRAM_BASE && a < XRAM_END) { d.xram = (d.xram || 0) + 1; return mem[a]; }
      const r = romAt(a);
      if (r >= 0) { d.rom++; return mem[r]; }
      return 0xFF;
    };
    this.bus.write8 = (a, v) => {
      a &= 0xFFFFFF;
      if (!m.a20) a &= ~0x100000;
      heat.write[a >> 8] += 1;
      const d = m.stats.dev;
      if (a < RAM_TOP) { d.ram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
      else if (a >= VRAM_BASE && a < VRAM_END) { d.vram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
      else if (a >= XRAM_BASE && a < XRAM_END) { d.xram = (d.xram || 0) + 1; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
    };
    if (this.vga) {
      // VGA: A0000-BFFFF through the graphics controller, C0000-C7FFF the video BIOS
      const vga = this.vga;
      this.bus.read8 = a => {
        a &= 0xFFFFFF;
        if (a >= 0xFF0000) { heat.read[a >> 8] += 1; m.stats.dev.rom++; return mem[0xF0000 + (a & 0xFFFF)]; }
        if (!m.a20) a &= ~0x100000;
        heat.read[a >> 8] += 1;
        const d = m.stats.dev;
        if (a < RAM_TOP) { d.ram++; return mem[a]; }
        if (a < VGA_HI) { d.vram++; return vga.read8(a); }
        if (a < VROM_HI) { d.vrom++; return mem[a]; }
        if (a >= XRAM_BASE && a < XRAM_END) { d.xram++; return mem[a]; }
        const r = romAt(a);
        if (r >= 0) { d.rom++; return mem[r]; }
        return 0xFF;
      };
      this.bus.write8 = (a, v) => {
        a &= 0xFFFFFF;
        if (!m.a20) a &= ~0x100000;
        heat.write[a >> 8] += 1;
        const d = m.stats.dev;
        if (a < RAM_TOP) { d.ram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
        else if (a < VGA_HI) { d.vram++; m.wrChg++; vga.write8(a, v); }
        else if (a >= XRAM_BASE && a < XRAM_END) { d.xram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
      };
    }
    this.bus.waitStates = 1;
    this.bus.shutdown = () => this.cpuReset('shutdown');
    // IRQ2 of the master is the slave's INT output
    this.bus.irqPending = () => { m.cascade(); return m.pic.pending(); };
    this.bus.ackIrq = () => {
      m.cascade();
      const v = m.pic.ack();
      return m.pic.lastAck === 2 ? m.pic2.ack() : v;
    };
    this.wire286();
    this.setRatios();
  }
  // The PIT (1.193182 MHz) and the CGA frame timing (4.77 MHz clocks) keep their real
  // rates at any CPU clock.
  setRatios() {
    this.pit.ratio = PIT_HZ / this.clockHz;
    if (this.crtc) this.crtc.scale = CPU_HZ / this.clockHz;
  }
  static newStats() {
    const s = Machine.newStats();
    Object.assign(s.dev, { xram: 0, pic2: 0, kbc: 0, rtc: 0, a20: 0, dma2: 0, fpu: 0 });
    return s;
  }
  wire286() {
    this.kbc.onA20 = on => { this.a20 = on || !!(this.port92 & 2); };
    this.kbc.onReset = () => this.cpuReset('8042');
    this.rtc.irq = () => this.pic2.raise(0);            // IRQ8
    for (const k of ['xram', 'pic2', 'kbc', 'rtc', 'a20', 'dma2', 'fpu']) if (!(k in this.stats.dev)) this.stats.dev[k] = 0;
  }
  cascade() { if (this.pic2.pending()) this.pic.raise(2); else this.pic.lower(2); }

  devAt(a) {
    a &= 0xFFFFFF;
    if (a >= 0xFF0000) return 'rom';
    if (!this.a20) a &= ~0x100000;
    if (a < RAM_TOP) return 'ram';
    if (this.vga && a < VROM_HI) return a < VGA_HI ? 'vram' : 'vrom';
    if (a >= VRAM_BASE && a < VRAM_END) return 'vram';
    if (a >= XRAM_BASE && a < XRAM_END) return 'xram';
    if ((a >= ROM_BASE && a < 0x100000) || a >= 0xFF0000) return 'rom';
    return 'none';
  }
  ioDevAt(p) {
    if (p < 0x10) return 'dma';
    if (p === 0x3F2 || p === 0x3F4 || p === 0x3F5 || p === 0x3F7) return 'fdc';
    if ((p >= 0x1F0 && p <= 0x1F7) || p === 0x3F6) return 'hdc';
    if (p === 0x20 || p === 0x21) return 'pic';
    if (p === 0xA0 || p === 0xA1) return 'pic2';
    if (p >= 0x40 && p <= 0x43) return 'pit';
    if (p === 0x60 || p === 0x64) return 'kbc';
    if (p === 0x61) return 'ppi';
    if (p === 0x70 || p === 0x71) return 'rtc';
    if (p === 0x92) return 'a20';
    if (p >= 0x80 && p <= 0x8F) return 'dma';
    if (p >= 0xC0 && p <= 0xDF) return 'dma2';
    if (p >= 0xE0 && p <= 0xE7) return 'fdc';
    if (p >= 0xF0 && p <= 0xFF) return 'fpu';
    if (this.vga) { if (this.vga.isPort(p)) return 'vga'; if (p >= 0x3B0 && p <= 0x3DF) return 'none'; }
    if (p === 0x3D4 || p === 0x3D5) return 'crtc';
    if (p >= 0x3D8 && p <= 0x3DA) return 'cga';
    return this.cardDev(p) || 'none';
  }
  ioRead(p) {
    const dv = this.ioDevAt(p);
    if (dv in this.stats.dev) this.stats.dev[dv]++;
    let v = 0xFF;
    switch (dv) {
      case 'dma': v = p < 0x10 ? this.dma.read(p) : this.pageRegs[p & 15]; break;
      case 'dma2': v = this.dma2.read((p - 0xC0) >> 1); break;
      case 'pic': v = this.pic.read(p); break;
      case 'pic2': v = this.pic2.read(p); break;
      case 'pit': v = this.pit.read(p - 0x40); break;
      case 'kbc': v = p === 0x60 ? this.kbc.readData() : this.kbc.status(); break;
      case 'ppi': v = (this.ppi.portB & 0x0F) | ((this.pit.ch[2].out ? 1 : 0) << 5) | ((Math.floor(this.cpu.cycles / this.refreshClk) & 1) << 4); break;
      case 'rtc': v = this.rtc.read(p); break;
      case 'a20': v = this.port92; break;
      case 'crtc': case 'cga': v = this.crtc.read(p); break;
      case 'vga': v = this.vga.ioRead(p); break;
      case 'fdc': v = this.fdcRead(p); break;
      case 'hdc': v = this.ideRead(p); break;
      case 'sb': case 'opl': v = this.cardRead(dv, p); break;
    }
    this.logIO('in', p, v);
    return v;
  }
  ioWrite(p, v) {
    const dv = this.ioDevAt(p);
    if (dv in this.stats.dev) this.stats.dev[dv]++;
    switch (dv) {
      case 'dma': if (p < 0x10) this.dma.write(p, v); else this.writePage(p, v); break;
      case 'dma2': this.dma2.write((p - 0xC0) >> 1, v); break;
      case 'pic': this.pic.write(p, v); break;
      case 'pic2': this.pic2.write(p, v); break;
      case 'pit': this.pit.write(p - 0x40, v); break;
      case 'kbc': if (p === 0x60) this.kbc.writeData(v); else this.kbc.writeCommand(v); break;
      case 'ppi': this.ppi.write(1, v); break;
      case 'rtc': this.rtc.write(p, v); break;
      case 'a20':
        this.port92 = v;
        this.a20 = !!(v & 2) || !!(this.kbc.outPort & 2);
        if (v & 1) this.cpuReset('port 92h');
        break;
      case 'crtc': case 'cga': this.crtc.write(p, v); break;
      case 'vga': this.vga.ioWrite(p, v); break;
      case 'fdc':
        if (p === 0xE4) this.blockMove();
        else this.fdcWrite(p, v);
        break;
      case 'fpu':
        if (p === 0xF0 && this.fpuIrqOn) { this.fpuIrqOn = false; this.pic2.lower(5); }   // clear the 287 error latch
        break;
      case 'hdc': this.ideWrite(p, v); break;
      case 'sb': case 'opl': this.cardWrite(dv, p, v); break;
    }
    this.logIO('out', p, v);
  }

  // A CPU reset without a power cycle (8042 reset line, port 92h or a triple fault).
  // The BIOS reads the CMOS shutdown byte (0Fh) to decide where to go.
  cpuReset(why) {
    this.shutdowns++;
    this.lastReset = why;
    this.cpu.reset();
    this.nmiLatch = false;
  }

  // INT 15h AH=87h block move (the BIOS passes it here through port E4h): CX words from
  // the source to the destination descriptor of the GDT at ES:SI. A real AT BIOS enters
  // protected mode for this; the simplified helper copies through the bus.
  // The 80386 descriptors are compatible: byte 7 holds the base bits 24-31 (0 on the 80286).
  // The 80386 core keeps its registers in cpu.regs32 during an instruction.
  // Returns { src, dst, n } (n = the bytes; Machine486 uses it for its cache).
  blockMove() {
    const c = this.cpu, R = c.regs32 || c.regs;
    const esBase = c.cache ? c.cache[0].base : c.sregs[0] << 4;
    const gdt = (esBase + (R[6] & 0xFFFF)) >>> 0;
    const rd = a => this.peek8(a >>> 0), b24 = c.regs32 ? 7 : -1;
    const base = o => (rd(gdt + o + 2) | (rd(gdt + o + 3) << 8) | (rd(gdt + o + 4) << 16) | (b24 > 0 ? rd(gdt + o + b24) << 24 : 0)) >>> 0;
    const src = base(0x10), dst = base(0x18), n = (R[1] & 0xFFFF) * 2;
    const wasA20 = this.a20;
    this.a20 = true;
    for (let i = 0; i < n; i++) this.bus.write8((dst + i) >>> 0, this.bus.read8((src + i) >>> 0));
    this.a20 = wasA20;
    R[0] = (R[0] & ~0xFF00) >>> 0;                         // AH = 0: no error
    c.f &= ~1;
    return { src, dst, n };
  }

  // DMA addresses do not go through the A20 gate: the page register gives the bits 16-23.
  dmaRead(a) { const w = this.a20; this.a20 = true; const v = this.bus.read8(a & 0xFFFFFF); this.a20 = w; return v; }
  dmaWrite(a, v) { const w = this.a20; this.a20 = true; this.bus.write8(a & 0xFFFFFF, v); this.a20 = w; }

  // The drive types in CMOS register 10h (A: high nibble, B: low nibble): a 1.44 MB
  // drive (type 4), or a 2.88 MB drive (type 5) when a 2.88 MB disk is in it.
  // The hard disk types in CMOS registers 12h and 19h: F0h and type 47 (the user type) when a
  // hard disk is in the machine, else 0 (no hard disk).
  insertDisk(i, name, bytes) { const d = super.insertDisk(i, name, bytes); this.syncDriveTypes(); return d; }
  insertHardDisk(name, bytes, geo) { const d = super.insertHardDisk(name, bytes, geo); this.syncDriveTypes(); return d; }
  ejectHardDisk() { super.ejectHardDisk(); this.syncDriveTypes(); }
  syncDriveTypes() {
    const t = i => (this.disks[i] && this.disks[i].type === 5 ? 5 : 4);
    const v = (t(0) << 4) | t(1), C = this.rtc.cmos, h = this.hdisk ? 0xF0 : 0, h19 = this.hdisk ? 47 : 0;
    if (C[0x10] !== v || C[0x12] !== h || C[0x19] !== h19) { C[0x10] = v; C[0x12] = h; C[0x19] = h19; this.rtc.checksum(); }
  }

  reset() {
    super.reset();
    this.mem.fill(0, XRAM_BASE, this.xramEnd);
    this.pic2.reset(); this.kbc.reset(); this.rtc.reset(); this.dma2.reset(); this.dma2.page.fill(0);
    // CMOS 17h-18h and 30h-31h: the extended memory in KB (the POST writes 30h-31h)
    const kb = (this.xramEnd - XRAM_BASE) >> 10, cm = this.rtc.cmos;
    cm[0x17] = cm[0x30] = kb & 0xFF; cm[0x18] = cm[0x31] = kb >> 8;
    this.rtc.checksum();
    this.syncDriveTypes();
    this.setRatios();
    this.wire286();
    this.a20 = true; this.port92 = 0; this.shutdowns = 0;     // the 8042 powers on with A20 on
  }
  vram() { return this.vga ? this.vga.textBuffer(VRAM_END - VRAM_BASE) : this.mem.subarray(VRAM_BASE, VRAM_END); }
  peek8(a) {
    a &= 0xFFFFFF;
    if (a >= 0xFF0000) return this.mem[0xF0000 + (a & 0xFFFF)];
    if (!this.a20) a &= ~0x100000;
    if (this.vga && a >= VGA_LO && a < VGA_HI) return this.vga.peek8(a);
    return a < 0x200000 ? this.mem[a] : 0xFF;
  }

  tickDevices(c) {
    super.tickDevices(c);
    this.rtc.tick(c / this.clockHz);
    // NMI on the AT: masked by port 70h bit 7 (the 8086 board uses port A0h)
    if (!this.fpuIrqOn && this.fpuErr()) { this.fpuIrqOn = true; this.pic2.raise(5); }   // 287 ERROR -> IRQ13
  }
  // The coprocessor ERROR line (the 80486: FERR#) that the board sends to IRQ 13.
  fpuErr() { return !!(this.fpu && this.fpu.intRequest); }
}
