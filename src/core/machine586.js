// The Pentium machine: the AT board of Machine486 with an Intel Pentium (P5) at 66 MHz. The FPU,
// an 8 KB code cache and an 8 KB data cache are on the CPU chip. RAM, chips, I/O ports and the
// memory map are the same as on the 80486 machine (16 MB, CGA or VGA, the uPD765, the 8237 DMA,
// the Sound Blaster).
//
// - The CPU core is CPU80586 (src/core/cpu80586.js). The P5 bus runs at the core clock (66 MHz)
//   and is 64 bits wide. The machine keeps 1 wait state: one transfer takes 3 clocks, a line
//   fill is a burst of 4 transfers of 8 bytes (3-2-2-2 = 9 clocks).
// - All device rates come from m.clockHz, as on the other AT machines (the 8254, the CGA and
//   VGA timing, the RTC, the floppy, the Sound Blaster, port 61h bit 4).
// - KEN# (bus.cacheable), the A20 rules, the cache switch (m.cacheEnabled, CMOS 2Dh bit 0) and
//   memChanged are the ones of Machine486. cpu.cacheInvalidate of the P5 core removes the old
//   copies from both caches (the code cache and the data cache).
// - bus.poke8: the P5 data cache is write-back. A store to an E or M line makes no bus cycle,
//   but the core writes the byte to memory at once through bus.poke8 (no heat, no counters).
//   poke8 does the same A20 work as bus.write8.
// - The FPU on the chip (the '80387' mode of FPU8087): no coprocessor port cycles. An FPU error
//   goes to IRQ 13 only while CR0.NE = 0, as on the 80486 machine.
// - m.fdivBug (or new Machine586({ fdivBug: true })): the FDIV bug of the first Pentium steps
//   (cpu.fdivBug). It is off by default.

const CPU_HZ_586 = 66000000;

class Machine586 extends Machine486 {
  // opts: { video: 'cga' | 'vga', soundCard: false (no Sound Blaster), cache: false (cache off),
  //   fdivBug: true (the FDIV bug of the first Pentium steps) }. Machine686 also gives model,
  //   clockHz and cpuClass.
  constructor(opts = {}) {
    super({ model: opts.model || '80586', clockHz: opts.clockHz || CPU_HZ_586,
      cpuClass: opts.cpuClass || (typeof CPU80586 !== 'undefined' ? CPU80586 : undefined),
      video: opts.video, soundCard: opts.soundCard, cache: opts.cache, wasm: opts.wasm });
    const m = this, mem = this.mem, top = this.memSize, vga = this.vga;
    // A write to memory with no bus cycle (a store that stays in the data cache). The same
    // memory and A20 work as bus.write8: with A20 off, an address with bit 20 = 1 changes the
    // byte with bit 20 = 0, and the cache line of that byte must go.
    this.bus.poke8 = (a, v) => {
      a >>>= 0;
      if (a < RAM_TOP) { if (mem[a] !== v) { m.wrChg++; mem[a] = v; } return; }
      if (a >= top) return;                              // the ROM, or no memory
      if (!m.a20 && (a & 0x100000)) { a &= ~0x100000; m.memChanged(a, 1); }
      if (a >= XRAM_BASE || a < RAM_TOP) { if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
      else if (vga) { if (a < VGA_HI) { m.wrChg++; vga.write8(a, v); } }
      else if (a >= VRAM_BASE && a < VRAM_END) { if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
    };
    // The FDIV bug hook of the core puts its own _arith method on the FPU object. The machine
    // makes that field now, so the FPU object keeps its hidden class (see "Speed of the run loop").
    if (this.fpu) this.fpu._arith = FPU8087.prototype._arith;
    if (this.cpu.fdivBug !== undefined) this.cpu.fdivBug = !!opts.fdivBug;
  }

  // The FDIV bug switch (cpu.fdivBug). A CPU reset keeps it.
  get fdivBug() { return !!this.cpu.fdivBug; }
  set fdivBug(on) { this.cpu.fdivBug = !!on; }
}
