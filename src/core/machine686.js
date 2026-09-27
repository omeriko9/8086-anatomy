// The Pentium Pro machine: the AT board of Machine586 with an Intel Pentium Pro (P6) at 200 MHz.
// The FPU, an 8 KB code cache, an 8 KB data cache and a 256 KB L2 cache (in the same package, on
// the back-side bus) are on the CPU. RAM, chips, I/O ports and the memory map are the same as on
// the Pentium machine (16 MB, CGA or VGA, the uPD765, the 8237 DMA, the Sound Blaster).
//
// - The CPU core is CPU80686 (src/core/cpu80686.js): the out-of-order model gives the clocks of
//   each instruction. The front-side bus (FSB) runs at 66 MHz: bus.busRatio = 3 core clocks for
//   each bus clock. The machine keeps 1 wait state (bus.waitStates = 1): an L2 miss takes 22
//   clocks to the first 8 bytes, and the burst of 4 x 8 bytes keeps the FSB busy for 33 clocks.
// - All device rates come from m.clockHz, as on the other AT machines (the 8254, the CGA and VGA
//   timing, the RTC, the floppy, the Sound Blaster, port 61h bit 4 (each 1600 clocks = 8 us), the
//   ISA I/O time of the Sound Blaster ports (m.isaIo = 172 clocks)).
// - KEN# (bus.cacheable), the A20 rules, the cache switch (m.cacheEnabled, CMOS 2Dh bit 0),
//   bus.poke8 and memChanged are the ones of Machine486 and Machine586. cpu.cacheInvalidate of
//   the P6 core removes the old copies from the three caches (L1 code, L1 data and L2).
// - The FPU on the chip (the '80387' mode of FPU8087): no coprocessor port cycles. An FPU error
//   goes to IRQ 13 only while CR0.NE = 0, as on the 80486 and Pentium machines.
// - The P6 has no FDIV bug: m.fdivBug is always false, and a write to it has no effect.
// - 16 MB of RAM, as on the 80386, 80486 and Pentium machines: DOS, Wolf3D and the samples need
//   less, and the views and the heat maps (one entry for each 256 bytes) use this size.
// - The halt wait (Machine.run, haltWait, for all models): while the CPU is in HLT with IF = 1,
//   the machine gives the clocks to the devices in groups, with no CPU steps.

const CPU_HZ_686 = 200000000;
const BUS_RATIO_686 = 3;                 // 200 MHz core / 66 MHz FSB

class Machine686 extends Machine586 {
  // opts: { video: 'cga' | 'vga', soundCard: false (no Sound Blaster), cache: false (cache off) }
  constructor(opts = {}) {
    super({ model: '80686', clockHz: CPU_HZ_686, cpuClass: typeof CPU80686 !== 'undefined' ? CPU80686 : undefined,
      video: opts.video, soundCard: opts.soundCard, cache: opts.cache, wasm: opts.wasm });
    // The core reads these two at each step: the core clocks for each FSB clock, and the FSB
    // wait states (the memory latency of an L2 miss).
    this.bus.busRatio = BUS_RATIO_686;
    this.bus.waitStates = 1;
  }

  // The P6 has no FDIV bug: the switch of the Pentium machine has no effect here.
  get fdivBug() { return false; }
  set fdivBug(on) { }
}
