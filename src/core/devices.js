// Support chips of the board: 8259A PIC, 8253 PIT, 8255 PPI + keyboard, 8237 DMA
// (registers only), 6845 CRTC with the CGA mode/status registers.

class PIC8259 {
  constructor() { this.reset(); }
  reset() {
    this.irr = 0; this.isr = 0; this.imr = 0xFF; this.base = 8;
    this.initStep = 0; this.needIcw4 = false; this.single = true;
    this.readIsr = false; this.autoEoi = false;
    this.lastAck = -1;
  }
  raise(n) { this.irr |= 1 << n; }
  lower(n) { this.irr &= ~(1 << n); }
  // Highest priority request that is not masked and outranks any in-service level.
  best() {
    const req = this.irr & ~this.imr;
    if (!req) return -1;
    for (let i = 0; i < 8; i++) {
      if (this.isr & (1 << i)) return -1;
      if (req & (1 << i)) return i;
    }
    return -1;
  }
  pending() { return this.best() >= 0; }
  ack() {
    const n = this.best();
    if (n < 0) return this.base + 7;      // spurious IRQ7
    this.irr &= ~(1 << n);
    if (!this.autoEoi) this.isr |= 1 << n;
    this.lastAck = n;
    return this.base + n;
  }
  read(port) {
    if (port & 1) return this.imr;
    return this.readIsr ? this.isr : this.irr;
  }
  write(port, v) {
    if (!(port & 1)) {
      if (v & 0x10) {                      // ICW1
        this.initStep = 1; this.needIcw4 = !!(v & 1); this.single = !!(v & 2);
        this.imr = 0; this.isr = 0; this.irr = 0; this.readIsr = false;
      } else if (!(v & 0x08)) {            // OCW2
        const cmd = v >> 5;
        if (cmd === 1) {                   // non-specific EOI
          for (let i = 0; i < 8; i++) if (this.isr & (1 << i)) { this.isr &= ~(1 << i); break; }
        } else if (cmd === 3) this.isr &= ~(1 << (v & 7));
      } else {                             // OCW3
        if (v & 2) this.readIsr = !!(v & 1);
      }
      return;
    }
    if (this.initStep === 1) { this.base = v & 0xF8; this.initStep = this.single ? (this.needIcw4 ? 3 : 0) : 2; }
    else if (this.initStep === 2) { this.initStep = this.needIcw4 ? 3 : 0; }
    else if (this.initStep === 3) { this.autoEoi = !!(v & 2); this.initStep = 0; }
    else this.imr = v;
  }
}

class PIT8253 {
  constructor() { this.reset(); }
  reset() {
    this.ch = [0, 1, 2].map(() => ({
      mode: 3, rw: 3, bcd: 0, reload: 0x10000, count: 0x10000, out: 1, gate: 1,
      latched: false, latch: 0, readHi: false, writeHi: false, armed: false, pendingLo: 0,
    }));
    this.ch[2].gate = 0;
    this.frac = 0;
    this.onOut0 = null;          // called on each rising edge of OUT0
    this.onChange = null;        // called when channel 2 tone changes
  }
  write(port, v) {
    if (port === 3) {
      const sc = v >> 6;
      if (sc === 3) return;                  // read-back is 8254 only
      const c = this.ch[sc], rw = (v >> 4) & 3;
      if (rw === 0) { c.latched = true; c.latch = c.count & 0xFFFF; return; }
      c.rw = rw; c.mode = (v >> 1) & 7; if (c.mode > 5) c.mode &= 3;
      c.bcd = v & 1; c.writeHi = false; c.readHi = false; c.armed = false;
      c.out = c.mode === 0 ? 0 : 1;
      if (sc === 2 && this.onChange) this.onChange();
      return;
    }
    const c = this.ch[port];
    let val;
    if (c.rw === 1) val = v;
    else if (c.rw === 2) val = v << 8;
    else if (!c.writeHi) { c.pendingLo = v; c.writeHi = true; return; }
    else { val = c.pendingLo | (v << 8); c.writeHi = false; }
    c.reload = val === 0 ? 0x10000 : val;
    c.count = c.reload; c.armed = true;
    c.loadCycle = this.cycleNow ? this.cycleNow() : 0;
    if (c.mode === 0) c.out = 0;
    if (port === 2 && this.onChange) this.onChange();
  }
  read(port) {
    if (port === 3) return 0xFF;
    const c = this.ch[port];
    const v = c.latched ? c.latch : c.count & 0xFFFF;
    if (c.rw === 1) { c.latched = false; return v & 0xFF; }
    if (c.rw === 2) { c.latched = false; return v >> 8; }
    if (!c.readHi) { c.readHi = true; return v & 0xFF; }
    c.readHi = false; c.latched = false; return v >> 8;
  }
  // Advance by CPU clocks (PIT input = CPU clock / 4).
  // Advance by CPU clocks. The PIT input is 1.193182 MHz: CPU clock / 4 on the 8086
  // machine; `ratio` is set by machines with another CPU clock.
  tick(cpuClocks) {
    this.frac += cpuClocks * (this.ratio || 0.25);
    const n = Math.floor(this.frac);
    if (!n) return;
    this.frac -= n;
    for (let i = 0; i < 3; i++) {
      const c = this.ch[i];
      if (!c.armed || !c.gate) continue;
      const step = c.mode === 3 ? 2 * n : n;
      if (c.mode === 0 || c.mode === 1 || c.mode === 4 || c.mode === 5) {
        const before = c.count;
        c.count -= n;
        if (before > 0 && c.count <= 0) {
          if (c.mode === 0 || c.mode === 1) { if (!c.out) { c.out = 1; if (i === 0 && this.onOut0) this.onOut0(); } }
          else if (i === 0 && this.onOut0) this.onOut0();
        }
        if (c.count < 0) c.count = (c.count % 0x10000 + 0x10000) % 0x10000;
      } else if (c.mode === 2) {            // rate generator: one OUT pulse for each period
        c.count -= n;
        if (c.count <= 0) {
          c.count += (Math.floor(-c.count / c.reload) + 1) * c.reload;
          if (c.count <= 0) c.count = c.reload;
          if (i === 0 && this.onOut0) this.onOut0();
          c.out = 1;
        }
      } else {                              // mode 3, square wave: the count goes down by 2,
        c.count -= step;                    // and each time it gets to 0 OUT changes (a half period)
        if (c.count <= 0) {
          const halves = Math.floor(-c.count / c.reload) + 1;
          c.count += halves * c.reload;
          if (c.count <= 0) c.count = c.reload;
          // the interrupt comes on the rising edge of OUT: once for each full period
          const rises = c.out ? Math.floor(halves / 2) : Math.ceil(halves / 2);
          if (halves & 1) c.out ^= 1;
          if (rises && i === 0 && this.onOut0) this.onOut0();
        }
      }
    }
  }
  // Tone frequency in Hz of channel 2 in square-wave mode, else 0.
  toneHz() {
    const c = this.ch[2];
    if (!c.armed || !c.gate || (c.mode !== 3 && c.mode !== 2)) return 0;
    return 1193182 / c.reload;
  }
}

class PPI8255 {
  constructor(kbd) { this.kbd = kbd; this.reset(); }
  reset() { this.portB = 0; this.ctrl = 0x99; this.onPortB = null; }
  read(port) {
    switch (port) {
      case 0: return this.kbd.data;
      case 1: return this.portB;
      case 2: return 0x00;                  // switches: no special settings
      default: return this.ctrl;
    }
  }
  write(port, v) {
    if (port === 1) {
      const old = this.portB;
      this.portB = v;
      if ((old & 0x80) && !(v & 0x80)) this.kbd.acknowledge();
      if (((old ^ v) & 3) && this.onPortB) this.onPortB();
    } else if (port === 3) this.ctrl = v;
  }
}

// PC/XT keyboard (scan code set 1). Host key events enter a small FIFO; one byte at a
// time is presented on port 60h with IRQ1.
class Keyboard {
  constructor() { this.reset(); }
  reset() { this.fifo = []; this.data = 0; this.full = false; this.raise = null; this.delay = 0; }
  press(code) { if (this.fifo.length < 16) this.fifo.push(code & 0xFF); }
  acknowledge() { this.full = false; this.delay = 200; }
  tick(cycles) {
    if (this.delay > 0) { this.delay -= cycles; return; }
    if (!this.full && this.fifo.length) {
      this.data = this.fifo.shift(); this.full = true;
      if (this.raise) this.raise();
    }
  }
}

// 8237A DMA controller: 4 channels with base and current address and count registers,
// mode, mask, status (TC bits 0-3) and the byte flip-flop. A device asks for one
// transfer with transfer() (single transfer mode, DRQ -> DACK); the page register of
// the channel (set by the machine, ports 80h-8Fh) gives the address bits 16-23.
class DMA8237 {
  constructor() { this.reset(); }
  reset() {
    this.addr = new Uint16Array(4); this.count = new Uint16Array(4);
    this.baseAddr = new Uint16Array(4); this.baseCount = new Uint16Array(4);
    this.mode = new Uint8Array(4); this.page = this.page || new Uint8Array(4);
    this.flip = false; this.mask = 0xF; this.status = 0; this.cmd = 0;
  }
  read(port) {
    if (port < 8) {
      const ch = port >> 1, reg = port & 1 ? this.count : this.addr;
      const v = this.flip ? reg[ch] >> 8 : reg[ch] & 0xFF;
      this.flip = !this.flip;
      return v;
    }
    if (port === 8) { const s = this.status; this.status &= 0xF0; return s; }
    return 0xFF;
  }
  write(port, v) {
    if (port < 8) {
      // a write sets the base and the current register
      const ch = port >> 1, reg = port & 1 ? this.count : this.addr, base = port & 1 ? this.baseCount : this.baseAddr;
      reg[ch] = this.flip ? (reg[ch] & 0xFF) | (v << 8) : (reg[ch] & 0xFF00) | v;
      base[ch] = reg[ch];
      this.flip = !this.flip;
      return;
    }
    switch (port) {
      case 8: this.cmd = v; break;
      case 0xA: if (v & 4) this.mask |= 1 << (v & 3); else this.mask &= ~(1 << (v & 3)); break;
      case 0xB: this.mode[v & 3] = v; break;
      case 0xC: this.flip = false; break;
      case 0xD: this.reset(); break;
      case 0xE: this.mask = 0; break;
      case 0xF: this.mask = v & 0xF; break;
    }
  }
  // One transfer on channel ch. mem: { read(a), write(a, v) } physical memory.
  // data: the byte from the device (for a write to memory). Returns null when the
  // channel is masked or the controller is off, else { addr, data, read, tc }:
  // read = memory to device. Mode bits 3-2: 00 verify (no memory cycle),
  // 01 write (device -> memory), 10 read (memory -> device); bit 4 auto-init;
  // bit 5 address decrement. At TC (the count goes past 0) the channel masks
  // itself, or reloads the base registers in auto-init mode.
  transfer(ch, mem, data) {
    if ((this.mask >> ch) & 1 || (this.cmd & 4)) return null;
    const mode = this.mode[ch], type = (mode >> 2) & 3, a = this.addr[ch];
    const addr = (this.page[ch] << 16) | a;
    if (type === 1) mem.write(addr, data & 0xFF);
    else if (type === 2) data = mem.read(addr);
    this.addr[ch] = mode & 0x20 ? (a - 1) & 0xFFFF : (a + 1) & 0xFFFF;   // no carry into the page
    const tc = this.count[ch] === 0;
    this.count[ch] = (this.count[ch] - 1) & 0xFFFF;
    if (tc) {
      this.status |= 1 << ch;
      if (mode & 0x10) { this.addr[ch] = this.baseAddr[ch]; this.count[ch] = this.baseCount[ch]; }
      else this.mask |= 1 << ch;
    }
    return { addr, data: data & 0xFF, read: type === 2, tc };
  }
}

class CRTC6845 {
  constructor() { this.reset(); }
  reset() {
    this.index = 0;
    this.r = new Uint8Array(18);
    // 80x25 text defaults
    [0x71, 0x50, 0x5A, 0x0A, 0x1F, 0x06, 0x19, 0x1C, 0x02, 0x07, 0x06, 0x07, 0, 0, 0, 0, 0, 0]
      .forEach((v, i) => { this.r[i] = v; });
    this.mode = 0x29; this.color = 0; this.frameClk = 0;
  }
  get cursor() { return (this.r[14] << 8) | this.r[15]; }
  get start() { return (this.r[12] << 8) | this.r[13]; }
  get cursorOn() { return (this.r[10] & 0x60) !== 0x20; }
  // Frame timing in 4.77 MHz clocks (one 60 Hz frame = 79545); `scale` converts other CPU clocks.
  tick(cycles) { this.frameClk = (this.frameClk + cycles * (this.scale || 1)) % 79545; }
  read(port) {
    if (port === 0x3D5) return this.index >= 12 && this.index <= 17 ? this.r[this.index] : 0;
    if (port === 0x3DA) {
      const t = this.frameClk;
      const vr = t > 74000 ? 8 : 0;          // vertical retrace near the end of the frame
      const de = (t % 304) > 228 ? 1 : 0;     // horizontal blank
      return vr | de | vr >> 3;
    }
    return 0xFF;
  }
  write(port, v) {
    if (port === 0x3D4) this.index = v & 0x1F;
    else if (port === 0x3D5) { if (this.index < 18) this.r[this.index] = v; }
    else if (port === 0x3D8) this.mode = v;
    else if (port === 0x3D9) this.color = v;
  }
}

// The IDE hard disk controller (an AT attachment drive: the controller is on the drive). The
// task file is at ports 1F0h-1F7h, the device control and alternate status register at 3F6h.
// One drive (the master; the disk is m.hdisk, a HardDisk from disk.js), programmed I/O: the CPU
// moves each sector of 512 bytes through the 16-bit data port 1F0h (256 IN or OUT of a word).
// A command: the BIOS writes the sector count (1F2h), the sector (1F3h), the cylinder (1F4h,
// 1F5h) and the drive and head (1F6h), then the command (1F7h). The status (1F7h): BSY 80h,
// DRDY 40h, DSC 10h, DRQ 08h (a sector waits in the buffer), ERR 01h (the error is at 1F1h).
// The AT models: IRQ 14 (input 6 of the second 8259A) when a sector is ready and at the end of
// a command, unless nIEN (3F6h bit 1); a read of the status clears it. The 8086 machine has the
// same controller on an ISA card without an IRQ. The commands: READ SECTORS (20h), WRITE SECTORS
// (30h), READ VERIFY (40h), IDENTIFY DEVICE (ECh), INITIALIZE DEVICE PARAMETERS (91h), RECALIBRATE
// (1xh), SEEK (7xh), EXECUTE DIAGNOSTIC (90h), SET FEATURES (EFh), the power commands (E0h-E5h);
// others end with ABRT. CHS or LBA addresses (1F6h bit 6).
const IDE_BSY = 0x80, IDE_DRDY = 0x40, IDE_DSC = 0x10, IDE_DRQ = 0x08, IDE_ERR = 0x01;
const IDE_ABRT = 0x04, IDE_IDNF = 0x10;
class IDEController {
  constructor(m, opts = {}) {
    this.m = m;
    this.at = !!opts.at;
    this.buf = new Uint8Array(512);
    this.err = 1; this.feat = 0; this.count = 1; this.sector = 1; this.cylLo = 0; this.cylHi = 0; this.drvHead = 0xA0;
    this.status = IDE_DRDY | IDE_DSC; this.ctrl = 0; this.cmd = 0;
    this.pos = 0; this.left = 0; this.lba = 0; this.dir = 0;
    this.xHeads = 0; this.xSpt = 0;
    this.irqOn = false;
    this.cmds = 0; this.lastCmd = 0;
    this.reset();
  }
  reset() {
    this.err = 1; this.feat = 0; this.count = 1; this.sector = 1; this.cylLo = 0; this.cylHi = 0; this.drvHead = 0xA0;
    this.status = IDE_DRDY | IDE_DSC; this.ctrl = 0; this.cmd = 0;
    this.pos = 0; this.left = 0; this.lba = 0; this.dir = 0;       // dir: 1 = to the CPU, 2 = from the CPU
    this.xHeads = 0; this.xSpt = 0;                                 // the CHS translation (0: the geometry of the disk)
    if (this.irqOn) this.irq(false);
    this.cmds = 0; this.lastCmd = 0;
  }
  get disk() { return this.m.hdisk; }
  slave() { return (this.drvHead & 0x10) !== 0; }
  irq(on) {
    if (!this.at || !this.m.pic2) return;
    if (on && (this.ctrl & 2)) on = false;
    if (on === this.irqOn) return;
    this.irqOn = on;
    if (on) this.m.pic2.raise(6); else this.m.pic2.lower(6);
    if (this.m.cascade) this.m.cascade();
  }
  read(p) {
    if (!this.disk) return 0xFF;                                    // no drive: the bus floats
    if (p === 0x3F6) return this.slave() ? 0 : this.status;
    const r = p & 7;
    if (r === 0) return this.read16() & 0xFF;                       // (an 8-bit read: the low byte)
    if (this.slave()) return 0;
    switch (r) {
      case 1: return this.err;
      case 2: return this.count;
      case 3: return this.sector;
      case 4: return this.cylLo;
      case 5: return this.cylHi;
      case 6: return this.drvHead;
      default: this.irq(false); return this.status;
    }
  }
  write(p, v) {
    if (!this.disk) return;
    if (p === 0x3F6) {
      if ((v & 4) && !(this.ctrl & 4)) this.reset();                // SRST
      this.ctrl = v;
      if (v & 2) this.irq(false);
      return;
    }
    switch (p & 7) {
      case 0: this.write16(v | (v << 8)); break;
      case 1: this.feat = v; break;
      case 2: this.count = v; break;
      case 3: this.sector = v; break;
      case 4: this.cylLo = v; break;
      case 5: this.cylHi = v; break;
      case 6: this.drvHead = v | 0xA0; break;
      case 7: this.command(v); break;
    }
  }
  heads() { return this.xHeads || this.disk.heads; }
  spt() { return this.xSpt || this.disk.spt; }
  // The sector of the task file (LBA or CHS), or -1 when it is not on the disk.
  address() {
    const d = this.disk;
    let a;
    if (this.drvHead & 0x40) a = ((this.drvHead & 15) << 24) | (this.cylHi << 16) | (this.cylLo << 8) | this.sector;
    else {
      const c = (this.cylHi << 8) | this.cylLo, h = this.drvHead & 15, s = this.sector;
      if (s < 1 || s > this.spt() || h >= this.heads()) return -1;
      a = (c * this.heads() + h) * this.spt() + s - 1;
    }
    return a < d.sectors ? a : -1;
  }
  // The task file moves to the next sector (as the drive does it).
  step() {
    this.count = (this.count - 1) & 0xFF;
    if (this.drvHead & 0x40) {
      const a = this.lba + 1;
      this.sector = a & 0xFF; this.cylLo = (a >> 8) & 0xFF; this.cylHi = (a >> 16) & 0xFF; this.drvHead = (this.drvHead & 0xF0) | ((a >> 24) & 15);
      return;
    }
    if (++this.sector > this.spt()) {
      this.sector = 1;
      let h = (this.drvHead & 15) + 1;
      if (h >= this.heads()) { h = 0; const c = ((this.cylHi << 8) | this.cylLo) + 1; this.cylLo = c & 0xFF; this.cylHi = (c >> 8) & 0xFF; }
      this.drvHead = (this.drvHead & 0xF0) | h;
    }
  }
  done(errBits) {
    this.dir = 0;
    this.status = IDE_DRDY | IDE_DSC | (errBits ? IDE_ERR : 0);
    this.err = errBits || 0;
    this.irq(true);
  }
  command(v) {
    const d = this.disk;
    this.cmd = v; this.cmds++; this.lastCmd = v;
    this.irq(false);
    if (this.slave()) return;                                       // no slave drive
    this.err = 0;
    const n = this.count || 256;
    if (v === 0x20 || v === 0x21 || v === 0x30 || v === 0x31 || v === 0x40 || v === 0x41) {
      const a = this.address();
      if (a < 0 || a + n > d.sectors) { this.done(IDE_IDNF); return; }
      this.lba = a; this.left = n;
      d.busy = 1; d.lastSector = a;
      if (v >= 0x40) { for (let k = 0; k < n; k++) { this.step(); this.lba++; } this.done(0); return; }
      if (v >= 0x30) { this.dir = 2; this.pos = 0; this.status = IDE_DRDY | IDE_DSC | IDE_DRQ; return; }   // the CPU sends the first sector
      this.load();
      return;
    }
    if (v === 0xEC) { this.identify(); return; }
    if (v === 0x91) { this.xSpt = this.count || 256; this.xHeads = (this.drvHead & 15) + 1; this.done(0); return; }
    if ((v & 0xF0) === 0x10) { this.cylLo = 0; this.cylHi = 0; this.done(0); return; }   // RECALIBRATE
    if ((v & 0xF0) === 0x70) { this.done(this.address() < 0 ? IDE_IDNF : 0); return; }   // SEEK
    if (v === 0x90) { this.done(0); this.err = 0x01; return; }                           // diagnostic: code 01h (no error)
    if (v === 0xEF || (v >= 0xE0 && v <= 0xE5)) { this.done(0); return; }
    this.done(IDE_ABRT);
  }
  // A read: the next sector to the buffer, DRQ, IRQ 14.
  load() {
    const d = this.disk;
    this.buf.set(d.data.subarray(this.lba * 512, this.lba * 512 + 512));
    d.reads++;
    this.dir = 1; this.pos = 0;
    this.status = IDE_DRDY | IDE_DSC | IDE_DRQ;
    this.irq(true);
  }
  // IDENTIFY DEVICE: 256 words about the drive.
  identify() {
    const d = this.disk, w = new Uint16Array(256);
    const str = (i, n, s) => { s = s.padEnd(n * 2, ' '); for (let k = 0; k < n; k++) w[i + k] = (s.charCodeAt(2 * k) << 8) | s.charCodeAt(2 * k + 1); };
    w[0] = 0x0040;                                                  // a fixed drive
    w[1] = d.cyls; w[3] = d.heads; w[4] = 512 * d.spt; w[5] = 512; w[6] = d.spt;
    str(10, 10, 'ANATOMY0001'); str(23, 4, '1.0'); str(27, 20, 'ANATOMY IDE HARD DISK');
    w[49] = 0x0200;                                                 // LBA
    w[53] = 1; w[54] = d.cyls; w[55] = this.heads(); w[56] = this.spt();
    const cap = d.cyls * this.heads() * this.spt();
    w[57] = cap & 0xFFFF; w[58] = cap >>> 16; w[60] = d.sectors & 0xFFFF; w[61] = d.sectors >>> 16;
    for (let k = 0; k < 256; k++) { this.buf[2 * k] = w[k] & 0xFF; this.buf[2 * k + 1] = w[k] >> 8; }
    this.left = 1; this.lba = -1; this.dir = 1; this.pos = 0;
    this.status = IDE_DRDY | IDE_DSC | IDE_DRQ;
    this.irq(true);
  }
  // The data port 1F0h (16 bits).
  read16() {
    if (this.dir !== 1 || this.slave()) return 0xFFFF;
    const v = this.buf[this.pos] | (this.buf[this.pos + 1] << 8);
    this.pos += 2;
    if (this.pos >= 512) {
      this.left--;
      if (this.lba < 0) { this.done(0); return v; }                // (IDENTIFY)
      this.step();
      if (this.left > 0) { this.lba++; this.load(); } else this.done(0);
    }
    return v;
  }
  write16(v) {
    if (this.dir !== 2 || this.slave()) return;
    this.buf[this.pos] = v & 0xFF; this.buf[this.pos + 1] = (v >> 8) & 0xFF;
    this.pos += 2;
    if (this.pos >= 512) {
      const d = this.disk;
      if (!d.readOnly) { d.data.set(this.buf, this.lba * 512); d.dirty = true; }
      d.writes++; d.busy = 1; d.lastSector = this.lba;
      this.left--; this.step();
      if (this.left > 0) { this.lba++; this.pos = 0; this.irq(true); }
      else this.done(0);
    }
  }
}
