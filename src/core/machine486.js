// The 80486 machine: the AT board of Machine386 with an Intel 80486DX at 33 MHz. The FPU and
// an 8 KB cache are on the CPU chip. RAM, chips, I/O ports and the memory map are the same as
// on the 80386 machine (16 MB, CGA or VGA, the uPD765, the 8237 DMA, the Sound Blaster).
//
// - The CPU core is CPU80486 (src/core/cpu80486.js). The machine data bus stays 16 bits wide
//   with one wait state (a line fill is a burst of 8 word cycles).
// - KEN# (bus.cacheable): RAM can go into the cache. A0000-FFFFF (the video memory, the option
//   ROMs, the BIOS ROM), the ROM at the top of the 4 GB and the addresses with no memory
//   cannot. With A20 off, an address with bit 20 = 1 cannot either (see a20Cut).
// - The on-chip cache keeps copies of RAM. Each write to RAM that does not come from the CPU
//   (the DMA of the floppy and of the Sound Blaster, the INT 15h block move, the BIOS clock
//   from the host, loadProgram, the UI) calls memChanged(addr, len): the cache removes its
//   old copies of those bytes.
// - The FPU on the chip: no coprocessor port cycles. An FPU error goes to IRQ 13 only while
//   CR0.NE = 0 (the AT way that DOS programs expect); with NE = 1 the CPU gives #MF itself.
// - The setup switch "cache off" (m.cacheEnabled = false, or new Machine486({ cache: false })):
//   CMOS 2Dh bit 0 = 1 tells the BIOS to keep CR0.CD = 1, and KEN# stays off.

const CPU_HZ_486 = 33000000;
const CMOS_CACHE_486 = 0x2D;             // CMOS setup byte: bit 0 = 1: the internal cache is off

class Machine486 extends Machine386 {
  // opts: { video: 'cga' | 'vga', soundCard: false (no Sound Blaster), cache: false (cache off) }.
  // Machine586 also gives model, clockHz and cpuClass.
  constructor(opts = {}) {
    // The WebAssembly core (src/core/x86core.c) runs the 80486, Pentium and Pentium Pro models: the
    // RAM must be in its memory. (Machine386.run uses this.wx.)
    const own = !opts.model || opts.model === '80486' || opts.model === '80586' || opts.model === '80686';
    const wasmMem = own && opts.wasm !== false && typeof X86W !== 'undefined' ? X86W.memory(MEM_386) : null;
    super({ model: opts.model || '80486', clockHz: opts.clockHz || CPU_HZ_486,
      cpuClass: opts.cpuClass || (typeof CPU80486 !== 'undefined' ? CPU80486 : undefined),
      video: opts.video, soundCard: opts.soundCard, wasmMem });
    const m = this, top = this.memSize;
    this.cacheSetup = opts.cache !== false;
    this.a20Seen = this.a20;
    // KEN#: RAM only. With A20 off the cache must not hold a line of an address with bit 20 = 1
    // (the bus sends it to the byte with bit 20 = 0).
    this.bus.cacheable = pa => m.cacheSetup && (pa < RAM_TOP || (pa >= XRAM_BASE && pa < top && (m.a20 || !(pa & 0x100000))));
    this.bus.peek8 = a => m.peek8(a);
    // With A20 off, a CPU write to an address with bit 20 = 1 changes the byte with bit 20 = 0.
    // The cache looks at the address before the gate, so the line of that byte must go.
    const w8 = this.bus.write8;
    this.bus.write8 = (a, v) => {
      w8(a, v);
      if (!m.a20 && (a & 0x100000) && a < top) m.memChanged(a & ~0x100000, 1);
    };
    this.setupCmos();
    // the C core (null: JavaScript only); m.wasmCore = false turns it off
    this.wasmCore = true;
    this.wx = wasmMem ? X86W.attach(this) : null;
  }


  // The setup switch: true = the BIOS turns the cache on (the default). "Off" works at once
  // (KEN# off, the cache becomes empty); "on" works after the next reset (the BIOS clears
  // CR0.CD and NW).
  get cacheEnabled() { return this.cacheSetup; }
  set cacheEnabled(on) {
    this.cacheSetup = !!on;
    this.setupCmos();
    const c = this.cpu;
    if (!on && c.cacheFlush && !(c.cr[0] & 0x20000000)) c.cacheFlush();   // not with CR0.NW = 1: memory can be old
  }
  setupCmos() {
    const cm = this.rtc.cmos, v = this.cacheSetup ? cm[CMOS_CACHE_486] & ~1 : cm[CMOS_CACHE_486] | 1;
    if (v !== cm[CMOS_CACHE_486]) { cm[CMOS_CACHE_486] = v; this.rtc.checksum(); }
  }

  // RAM at addr .. addr + len - 1 changed, but not by the CPU: the cache lines of these bytes
  // become invalid (cpu.cacheInvalidate; nothing happens with CR0.NW = 1, as on the 80486).
  memChanged(addr, len = 1) {
    const c = this.cpu;
    this.wrChg++;                                        // (the wait-loop skip sees the change)
    if (c.cacheInvalidate && len > 0) c.cacheInvalidate(addr >>> 0, len);
  }
  // A20 goes off: the lines of the addresses with bit 20 = 1 become invalid (with A20 off those
  // addresses read the bytes with bit 20 = 0). tickDevices looks at the gate after each
  // instruction.
  a20Cut() {
    for (let a = 0x100000; a < this.memSize; a += 0x200000) this.memChanged(a, 0x100000);
  }

  reset() {
    super.reset();
    this.setupCmos();
    this.a20Seen = this.a20;
  }
  tickDevices(c) {
    if (this.a20 !== this.a20Seen) {
      this.a20Seen = this.a20;
      if (!this.a20) this.a20Cut();
    }
    super.tickDevices(c);
  }
  // FERR# goes to IRQ 13 only while CR0.NE = 0.
  fpuErr() { return super.fpuErr() && !(this.cpu.cr && (this.cpu.cr[0] & 0x20)); }

  // The writes to memory that do not come from the CPU
  dmaWrite(a, v) { super.dmaWrite(a, v); this.memChanged(a & 0xFFFFFF, 1); }
  blockMove() {
    const r = super.blockMove();
    if (r) this.memChanged(r.dst, r.n);
    return r;
  }
  setClockFromHost() { super.setClockFromHost(); this.memChanged(0x46C, 4); }
  loadProgram(bytes, origin = 0x100) { super.loadProgram(bytes, origin); this.memChanged(PROG_SEG << 4, 0x10000); }
  startProgram() { super.startProgram(); this.memChanged((PROG_SEG << 4) + 0xFFFE, 2); }
  fdcWrite(p, v) {
    super.fdcWrite(p, v);
    if (p === 0xE0) {                                    // the old disk service: the buffer at ES:BX
      const c = this.cpu;
      this.memChanged(c.cache ? c.cache[0].base : c.sregs[0] << 4, 0x10000);
    }
  }
}
