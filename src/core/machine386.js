// The 80386 machine: the AT-class board of Machine286 with an 80386 at 25 MHz, an 80387
// and 16 MB of RAM. The data bus of the CPU core is 16 bits wide (as on the 386SX), with
// one memory wait state. The chips (two 8259A, 8254, 8042, MC146818, two 8237, uPD765,
// CGA or VGA) and their I/O ports are the same as on the 80286 machine.
//
// Physical address map (32-bit addresses):
//   00000000-0009FFFF  RAM (640 KB)
//   000A0000-000BFFFF  VGA memory window (CGA: B8000-BBFFF)
//   000C0000-000C7FFF  VGA video BIOS (option ROM)
//   000F0000-000FFFFF  BIOS ROM (64 KB)
//   00100000-00FFFFFF  extended RAM (15 MB)
//   FFFF0000-FFFFFFFF  BIOS ROM again (the 80386 starts at FFFFFFF0h)
//   all other addresses read FFh
// The A20 gate forces address bit 20 to 0 (not for the ROM at the top of the 4 GB).

const MEM_386 = 1 << 24;                 // 16 MB of RAM
const CPU_HZ_386 = 25000000;
const ROM_TOP_386 = 0xFFFF0000;          // the ROM at the top of the 4 GB address space

class Machine386 extends Machine286 {
  // opts: { video: 'cga' | 'vga', soundCard: false (no Sound Blaster) }. Machine486 also gives
  // model, clockHz and cpuClass.
  constructor(opts = {}) {
    // The WebAssembly core (src/core/x86core.c) runs the 80386 model too: the RAM must be in its
    // memory. (Machine486 makes the memory itself and gives it in opts.wasmMem.)
    const own = !opts.model || opts.model === '80386';
    const wasmMem = opts.wasmMem || (own && opts.wasm !== false && typeof X86W !== 'undefined' ? X86W.memory(MEM_386) : null);
    super({ model: opts.model || '80386', memSize: MEM_386, xramEnd: MEM_386, clockHz: opts.clockHz || CPU_HZ_386,
      cpuClass: opts.cpuClass || (typeof CPU80386 !== 'undefined' ? CPU80386 : CPU80286), fpuModel: '80387', video: opts.video, soundCard: opts.soundCard,
      wasmMem });
    const m = this, mem = this.mem, heat = this.heat, top = this.memSize, vga = this.vga;
    // The heat maps have one entry for each 256 bytes of the 16 MB. The top ROM counts
    // on the pages of F0000-FFFFF.
    this.bus.read8 = a => {
      a >>>= 0;
      if (a < RAM_TOP) { heat.read[a >> 8] += 1; m.stats.dev.ram++; return mem[a]; }
      if (a >= top) {
        if (a < ROM_TOP_386) return 0xFF;
        a = ROM_BASE + (a & 0xFFFF);
        heat.read[a >> 8] += 1; m.stats.dev.rom++; return mem[a];
      }
      if (!m.a20) a &= ~0x100000;
      heat.read[a >> 8] += 1;
      const d = m.stats.dev;
      if (a >= XRAM_BASE) { d.xram++; return mem[a]; }
      if (a < RAM_TOP) { d.ram++; return mem[a]; }
      if (a >= ROM_BASE) { d.rom++; return mem[a]; }
      if (vga) {
        if (a < VGA_HI) { d.vram++; return vga.read8(a); }
        if (a < VROM_HI) { d.vrom++; return mem[a]; }
      } else if (a >= VRAM_BASE && a < VRAM_END) { d.vram++; return mem[a]; }
      return 0xFF;
    };
    this.bus.write8 = (a, v) => {
      a >>>= 0;
      if (a < RAM_TOP) { heat.write[a >> 8] += 1; m.stats.dev.ram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } return; }
      if (a >= top) return;                                 // the ROM, or no memory
      if (!m.a20) a &= ~0x100000;
      heat.write[a >> 8] += 1;
      const d = m.stats.dev;
      if (a >= XRAM_BASE) { d.xram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
      else if (a < RAM_TOP) { d.ram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
      else if (vga) { if (a < VGA_HI) { d.vram++; m.wrChg++; vga.write8(a, v); } }
      else if (a >= VRAM_BASE && a < VRAM_END) { d.vram++; if (mem[a] !== v) { m.wrChg++; mem[a] = v; } }
    };
    // the C core (null: JavaScript only); m.wasmCore = false turns it off. Machine486 attaches it
    // after its own setup.
    this.wasmCore = true;
    this.wx = own && wasmMem && !opts.wasmMem ? X86W.attach(this) : null;
  }

  // Machine.run in the WebAssembly core when it can (see src/core/x86wasm.js), else in JavaScript.
  run(maxCycles) {
    const r = this.wx ? this.wx.run(maxCycles) : null;
    return r === null ? super.run(maxCycles) : r;
  }

  // The device at a physical address (the 'dev' of the bus events).
  devAt(a) {
    a >>>= 0;
    if (a >= this.memSize) return a >= ROM_TOP_386 ? 'rom' : 'none';
    if (!this.a20) a &= ~0x100000;
    if (a < RAM_TOP) return 'ram';
    if (a >= XRAM_BASE) return 'xram';
    if (a >= ROM_BASE) return 'rom';
    if (this.vga) return a < VGA_HI ? 'vram' : a < VROM_HI ? 'vrom' : 'none';
    return a >= VRAM_BASE && a < VRAM_END ? 'vram' : 'none';
  }
  // Read memory for a display (no bus cycle, no heat, no counters). a: a physical address.
  peek8(a) {
    a >>>= 0;
    if (a >= this.memSize) return a >= ROM_TOP_386 ? this.mem[ROM_BASE + (a & 0xFFFF)] : 0xFF;
    if (!this.a20) a &= ~0x100000;
    if (this.vga && a >= VGA_LO && a < VGA_HI) return this.vga.peek8(a);
    return this.mem[a];
  }
  // The physical address of a linear address (paging, then the ROM at the top of the 4 GB
  // shows as F0000-FFFFF, and the A20 gate). -1: the page is not present.
  physOf(lin) {
    let a = this.cpu.paging ? this.cpu.peekPhys(lin) : lin >>> 0;
    if (a < 0) return -1;
    if (a >= ROM_TOP_386) return ROM_BASE + (a & 0xFFFF);
    if (!this.a20 && a < this.memSize) a &= ~0x100000;
    return a;
  }
  // CS:EIP as a physical address (for the breakpoints and the listing)
  get physIP() { return this.physOf((this.csBase + this.cpu.ip) >>> 0); }
}
