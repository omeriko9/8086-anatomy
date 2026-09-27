// Chips of the 80286 (AT-class) board that the 8086 board does not have:
// the MC146818 real-time clock with its CMOS memory, and the 8042 keyboard controller.

const bcd = v => ((Math.floor(v / 10) % 10) << 4) | (v % 10);

// MC146818: time and date from the host clock (BCD, 24-hour), 64 bytes of CMOS memory.
// Port 70h selects a register (bit 7 = 1 masks NMI on the AT), port 71h reads or writes it.
class RTC146818 {
  constructor() { this.reset(); }
  reset() {
    this.index = 0x0D;
    this.nmiOff = true;                  // the AT powers on with NMI masked
    this.cmos = new Uint8Array(64);
    this.offset = 0;                     // ms added to the host clock after a "set time"
    this.periodicAcc = 0;
    this.irq = null;                     // IRQ8 callback
    const c = this.cmos;
    c[0x0A] = 0x26;                      // 32.768 kHz time base, 1024 Hz periodic rate
    c[0x0B] = 0x02;                      // 24-hour, BCD, no interrupts
    c[0x0D] = 0x80;                      // battery good
    c[0x10] = 0x44;                      // drive A: and B: are 1.44 MB
    c[0x12] = 0x00;                      // no hard disk
    c[0x14] = 0x41 | 0x02 | 0x20;        // 2 floppies, coprocessor, 80x25 colour
    c[0x15] = 640 & 0xFF; c[0x16] = 640 >> 8;          // base memory in KB
    c[0x17] = 1024 & 0xFF; c[0x18] = 1024 >> 8;        // extended memory in KB
    c[0x30] = c[0x17]; c[0x31] = c[0x18];
    c[0x32] = 0x20;                      // century
    this.checksum();
  }
  checksum() {
    let s = 0;
    for (let i = 0x10; i <= 0x2D; i++) s += this.cmos[i];
    this.cmos[0x2E] = (s >> 8) & 0xFF; this.cmos[0x2F] = s & 0xFF;
  }
  now() { return new Date(Date.now() + this.offset); }
  read(port) {
    if (port === 0x70) return 0xFF;
    const i = this.index, d = this.now();
    switch (i) {
      case 0x00: return bcd(d.getSeconds());
      case 0x02: return bcd(d.getMinutes());
      case 0x04: return bcd(d.getHours());
      case 0x06: return d.getDay() + 1;
      case 0x07: return bcd(d.getDate());
      case 0x08: return bcd(d.getMonth() + 1);
      case 0x09: return bcd(d.getFullYear() % 100);
      case 0x32: return bcd(Math.floor(d.getFullYear() / 100));
      case 0x0A: return this.cmos[0x0A] & 0x7F;          // no update in progress
      case 0x0C: { const v = this.cmos[0x0C]; this.cmos[0x0C] = 0; return v; }
      default: return this.cmos[i & 0x3F];
    }
  }
  write(port, v) {
    if (port === 0x70) { this.index = v & 0x3F; this.nmiOff = !!(v & 0x80); return; }
    const i = this.index;
    if (i <= 0x09) {
      // "set the clock": keep the host clock and remember the difference
      const d = this.now(), un = x => (x >> 4) * 10 + (x & 15);
      if (i === 0x00) d.setSeconds(un(v)); else if (i === 0x02) d.setMinutes(un(v)); else if (i === 0x04) d.setHours(un(v));
      else if (i === 0x07) d.setDate(un(v)); else if (i === 0x08) d.setMonth(un(v) - 1);
      else if (i === 0x09) d.setFullYear(Math.floor(d.getFullYear() / 100) * 100 + un(v));
      this.offset += d.getTime() - Date.now() - this.offset;
      return;
    }
    if (i === 0x0C || i === 0x0D) return;                 // read-only
    this.cmos[i] = v;
  }
  // Periodic interrupt (IRQ8) when register B bit 6 is set; t = elapsed seconds.
  tick(seconds) {
    if (!(this.cmos[0x0B] & 0x40)) return;
    const rs = this.cmos[0x0A] & 15;
    const hz = rs ? 32768 >> (rs - 1) : 0;
    if (!hz) return;
    this.periodicAcc += seconds * hz;
    if (this.periodicAcc >= 1) {
      this.periodicAcc -= Math.floor(this.periodicAcc);
      this.cmos[0x0C] |= 0xC0;
      if (this.irq) this.irq();
    }
  }
}

// 8042 keyboard controller. Port 60h: data (scan codes, command data), port 64h:
// status (read) and commands (write). The output port holds the A20 gate (bit 1) and
// the CPU reset line (bit 0, active low). Scan codes arrive already translated to set 1.
class KBC8042 {
  constructor(kbd) { this.kbd = kbd; this.reset(); }
  reset() {
    this.cmdByte = 0x45;                 // IRQ1 on, system flag, translate
    this.outPort = 0xDF;                 // power-on: A20 on, no reset (the BIOS turns A20 off)
    this.pending = 0;                    // command that waits for a data byte on port 60h
    this.own = [];                       // replies of the controller itself (before key codes)
    this.onA20 = null;                   // callback(on)
    this.onReset = null;                 // callback()
  }
  get obf() { return this.own.length > 0 || this.kbd.full; }
  status() {
    return (this.obf ? 1 : 0) | 0x04 | 0x10 | (this.own.length ? 0 : 0) | (this.pending ? 0x08 : 0);
  }
  readData() {
    if (this.own.length) return this.own.shift();
    const v = this.kbd.data;
    if (this.kbd.full) this.kbd.acknowledge();          // on the AT, reading port 60h frees the buffer
    return v;
  }
  writeCommand(v) {
    switch (v) {
      case 0x20: this.own.push(this.cmdByte); break;
      case 0x60: case 0xD1: this.pending = v; break;
      case 0xAA: this.own.push(0x55); break;              // self test passed
      case 0xAB: this.own.push(0x00); break;              // interface test passed
      case 0xAD: this.cmdByte |= 0x10; break;             // keyboard off
      case 0xAE: this.cmdByte &= ~0x10; break;            // keyboard on
      case 0xC0: this.own.push(0xBF); break;              // input port
      case 0xD0: this.own.push(this.outPort); break;
      case 0xDD: this.setOut(this.outPort & ~2); break;   // A20 off
      case 0xDF: this.setOut(this.outPort | 2); break;    // A20 on
      default:
        if ((v & 0xF0) === 0xF0 && !(v & 1)) { if (this.onReset) this.onReset(); }   // pulse reset
    }
  }
  writeData(v) {
    if (this.pending === 0x60) { this.cmdByte = v; this.pending = 0; return; }
    if (this.pending === 0xD1) { this.pending = 0; this.setOut(v); return; }
    // bytes to the keyboard itself: acknowledge them (LEDs, rates, enable, reset)
    this.own.push(0xFA);
    if (v === 0xFF) this.own.push(0xAA);
  }
  setOut(v) {
    const a20 = !!(v & 2);
    const was = !!(this.outPort & 2);
    this.outPort = v | 1;
    if (a20 !== was && this.onA20) this.onA20(a20);
    if (!(v & 1) && this.onReset) this.onReset();
  }
}
