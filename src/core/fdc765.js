// NEC uPD765A floppy disk controller, with the drive mechanics (motor, head, disk
// rotation) and the 8237 DMA channel 2 transfers, like the IBM PC/XT and AT.
//
// Ports: 3F2h digital output register (DOR), 3F4h main status register (MSR),
// 3F5h data register (FIFO). The AT adds 3F7h: write = data rate (DCR),
// read = digital input register (bit 7 = disk change).
// The machine calls tick(clocks) after each instruction. The controller moves one
// byte by DMA for each byte time of the execution phase and raises IRQ 6 (through the
// DOR bit 3 gate) at the end of an operation.
// m.diskTiming: 'fast' (default) or 'real'. Both modes use the same phases, DMA cycles
// and interrupts. 'real' waits for the motor, the steps, the head settle time and
// the rotation; 'fast' makes these waits very short and moves the bytes 8 times faster.

// DCR values 0-3 and their data rates (bits per second)
const FDC_RATES = [500000, 300000, 250000, 1000000];
const FDC_CMD_NAMES = {
  0x03: 'SPECIFY', 0x04: 'SENSE DRIVE STATUS', 0x05: 'WRITE DATA', 0x06: 'READ DATA', 0x07: 'RECALIBRATE',
  0x08: 'SENSE INTERRUPT STATUS', 0x0A: 'READ ID', 0x0D: 'FORMAT TRACK', 0x0F: 'SEEK',
};
// Bytes in the command phase (with the first byte)
const FDC_CMD_LEN = { 0x03: 3, 0x04: 2, 0x05: 9, 0x06: 9, 0x07: 2, 0x08: 1, 0x0A: 2, 0x0D: 6, 0x0F: 3 };

// The natural data rate of a disk: 250 kbit/s for 360 KB and 720 KB, 500 kbit/s for
// 1.2 MB and 1.44 MB, 1 Mbit/s for 2.88 MB.
function fdcMediaRate(disk) { return disk.spt >= 36 ? 1000000 : disk.spt >= 15 ? 500000 : 250000; }

class FDC765 {
  // m: the machine (clockHz, disks, pic, dma, diskTiming). opts.at: the AT controller (3F7h).
  constructor(m, opts = {}) {
    this.m = m;
    this.inTick = false; this.lastDrive = 0;     // all the fields start here (see CPU8086)
    this.at = !!opts.at;
    // The state that the views read (see ARCHITECTURE.md "Floppy controller")
    // (present: a disk is in the drive; dirty: the disk has changes to save)
    this.drives = [0, 1].map(i => ({
      get present() { return !!m.disks[i]; }, motor: false, spin: 0, cyl: 0, targetCyl: 0, head: 0, angle: i * 0.37, sector: 0,
      stepping: false, reading: false, writing: false, lastCmd: '', index: false, get dirty() { return !!(m.disks[i] && m.disks[i].dirty); },
    }));
    // Mechanics that the views do not need: step timers, the disk change latch
    this.mech = [0, 1].map(() => ({ disk: null, changed: true, stepWait: 0, settle: 0, steps: 0, dir: 0, recal: false, hd: 0 }));
    this.powerOn();
  }

  powerOn() {
    this.sleep = false;           // true: nothing moves; tick() does nothing until a port access
    this.coast = false;           // true: only the disks turn; tick() only counts the clocks
    this.lazy = 0;                // clocks that the disks still have to turn (see tick)
    this.dor = 0;                 // the PC powers on with the controller in reset
    this.dcr = 0;
    this.srt = 0x0D; this.hut = 0x0F; this.hlt = 0x01; this.nd = 0;
    this.pcn = [0, 0, 0, 0];
    for (const d of this.drives) { d.motor = false; d.stepping = false; d.reading = false; d.writing = false; }
    for (const x of this.mech) { x.stepWait = 0; x.settle = 0; x.steps = 0; }
    this.chipReset();
  }

  // The state after a reset through DOR bit 2 (the drives keep their head positions).
  chipReset() {
    this.phase = 'idle';
    this.cmd = '';
    this.fifo = [];
    this.st = [0, 0, 0, 0];
    this.cmdBytes = [];
    this.need = 0;
    this.res = [];
    this.pend = [-1, -1, -1, -1];  // seek / reset status of each drive for SENSE INTERRUPT STATUS
    this.ex = null;                // the operation in the execution phase
    this.resetWait = 0;            // clocks until the reset interrupt
    this.resInt = false;           // the interrupt of the result phase
    this.irq = false;
    this.lastData = 0;
    this.tOff = 0;
    for (let i = 0; i < 2; i++) {
      const d = this.drives[i], x = this.mech[i];
      if (d.stepping) { d.stepping = false; x.steps = 0; x.stepWait = 0; x.settle = 0; }
      d.reading = false; d.writing = false;
    }
    this.updMsr();
  }

  // ---------- timing ----------
  get real() { return this.m.diskTiming === 'real'; }
  ms(x) { return x * this.m.clockHz / 1000; }
  get rot() { return 0.2 * this.m.clockHz; }            // 300 rpm: one turn in 0.2 s
  // The data rate that the controller uses now (the XT has no DCR: the disk sets it)
  rateFor(disk) { return this.at ? FDC_RATES[this.dcr & 3] : (disk ? fdcMediaRate(disk) : 250000); }
  byteClocks(rate) {
    const c = this.m.clockHz * 8 / rate;
    return this.real ? c : Math.max(8, c / 8);
  }
  // Step time from SPECIFY: 16 - SRT ms at 500 kbit/s (2 ms units at 250/300 kbit/s)
  stepClocks() {
    if (!this.real) return this.ms(0.2);
    const r = this.at ? FDC_RATES[this.dcr & 3] : 250000;
    return this.ms((16 - this.srt) * 500000 / r);
  }
  settleClocks() { return this.real ? this.ms(15) : this.ms(0.2); }

  // ---------- geometry of a track ----------
  // 300 rpm: a track holds rate / 8 * 0.2 bytes. The index hole is at angle 0, then a
  // gap, then spt sector slots. A slot has the ID field, a gap and the 512 data bytes.
  trackBytes(rate) { return rate / 8 * 0.2; }
  slotStart(disk, rate, r) {
    const g = 80 / this.trackBytes(rate);
    return g + (r - 1) * (1 - g) / disk.spt;
  }
  dataStart(disk, rate, r) { return this.slotStart(disk, rate, r) + 60 / this.trackBytes(rate); }
  // The sector under the head (1..spt), or 0 in a gap
  sectorAt(disk, angle) {
    const rate = fdcMediaRate(disk), tb = this.trackBytes(rate), g = 80 / tb;
    if (angle < g) return 0;
    const slot = (1 - g) / disk.spt, k = Math.floor((angle - g) / slot);
    const inSlot = (angle - g - k * slot) * tb;
    return inSlot < 60 + 514 && k < disk.spt ? k + 1 : 0;
  }
  // Clocks until the disk turns from the angle now to angle a
  clocksTo(d, a) {
    let da = a - d.angle;
    da -= Math.floor(da);
    return da * this.rot;
  }

  // ---------- trace ----------
  ev(op, drive, text, sec) {
    const m = this.m;
    if (!m.devTrace) return;
    const d = this.drives[drive & 1];
    m.traceDev({ k: 'fdc', t: this.inTick ? Math.round(this.tOff) : undefined, op, drive: drive & 3, cyl: d.cyl, head: d.head, sec: sec || 0, text: text || '' });
  }

  // ---------- the interrupt line ----------
  intLine() {
    let on = this.resInt;
    for (const p of this.pend) if (p >= 0) on = true;
    if (on && !this.irq) {
      this.irq = true;
      if (this.dor & 8) this.m.pic.raise(6);
      this.ev('irq', this.lastDrive || 0, 'IRQ 6');
    } else if (!on && this.irq) {
      this.irq = false;
      this.m.pic.lower(6);
    }
  }

  // ---------- main status register ----------
  updMsr() {
    let v = 0;
    if (this.dor & 4 && this.resetWait <= 0) {
      if (this.phase === 'idle') v = 0x80;
      else if (this.phase === 'command') v = 0x90;
      else if (this.phase === 'execution') v = 0x10;
      else v = 0xD0;
    }
    for (let i = 0; i < 2; i++) if (this.drives[i].stepping || this.mech[i].settle > 0) v |= 1 << i;
    this.msr = v;
  }
  pushFifo(b) { const f = this.fifo; f.push(b); if (f.length > 9) f.shift(); }

  // ---------- ports ----------
  // A port access wakes the controller. A disk can change while it sleeps: check that first.
  wake() {
    this.sleep = false; this.coast = false;
    const m = this.m;
    for (let i = 0; i < 2; i++) { const x = this.mech[i], k = m.disks[i] || null; if (k !== x.disk) { x.disk = k; x.changed = true; } }
  }
  read(p) {
    if (this.sleep || this.coast) this.wake();
    this.sync();
    if (p === 0x3F4) return this.msr;
    if (p === 0x3F5) {
      if (this.phase !== 'result') return this.lastData;
      const b = this.res.shift();
      this.lastData = b;
      if (this.resInt) { this.resInt = false; this.intLine(); }
      if (!this.res.length) { this.phase = 'idle'; this.fifo = []; }
      this.updMsr();
      return b;
    }
    if (p === 0x3F7 && this.at) {
      const i = this.dor & 3;
      return i < 2 && this.mech[i].changed ? 0x80 : 0x00;
    }
    return 0xFF;
  }
  write(p, v) {
    if (this.sleep || this.coast) this.wake();
    this.sync();
    if (p === 0x3F2) return this.writeDor(v);
    if (p === 0x3F7 && this.at) { this.dcr = v & 3; return; }
    if (p !== 0x3F5 || !(this.dor & 4) || this.resetWait > 0) return;
    if (this.phase === 'idle') {
      const op = v & 0x1F;
      this.cmdBytes = [v];
      this.fifo = [v];
      this.cmd = FDC_CMD_NAMES[op] || 'INVALID';
      if (!FDC_CMD_LEN[op]) {                        // invalid command: ST0 = 80h
        this.st[0] = 0x80;
        this.startResult([0x80], false);
        this.ev('command', 0, `INVALID ${hexb(v)}h`);
        return;
      }
      this.need = FDC_CMD_LEN[op] - 1;
      this.phase = 'command';
      if (!this.need) this.runCommand();
      this.updMsr();
      return;
    }
    if (this.phase === 'command') {
      this.cmdBytes.push(v);
      this.pushFifo(v);
      if (--this.need <= 0) this.runCommand();
      this.updMsr();
    }
  }
  writeDor(v) {
    const old = this.dor;
    this.dor = v;
    if (!(v & 4)) {                                  // bit 2 = 0: the controller is in reset
      if (old & 4) { this.chipReset(); this.intLine(); this.ev('reset', v & 3, 'DOR bit 2 = 0'); }
    } else if (!(old & 4)) {
      this.chipReset();
      this.resetWait = this.ms(0.1);                 // it polls the drives, then interrupts
    }
    for (let i = 0; i < 2; i++) {
      const on = !!(v & (0x10 << i));
      this.drives[i].motor = on;
      if (on && !this.real) this.drives[i].spin = 1;  // fast: no spin-up time
    }
    // bit 3 gates IRQ 6 and DRQ 2 on the PC
    if ((v ^ old) & 8) { if (this.irq && (v & 8)) this.m.pic.raise(6); else if (!(v & 8)) this.m.pic.lower(6); }
    this.updMsr();
  }

  // ---------- commands ----------
  runCommand() {
    const b = this.cmdBytes, op = b[0] & 0x1F, us = (b[1] || 0) & 3, hd = ((b[1] || 0) >> 2) & 1;
    const name = this.cmd;
    if (op !== 0x03 && op !== 0x08) {
      this.lastDrive = us;
      if (us < 2) { this.drives[us].lastCmd = name; this.drives[us].head = hd; this.mech[us].hd = hd; }
    }
    const txt = name + (op === 0x05 || op === 0x06 ? ` C=${b[2]} H=${b[3]} R=${b[4]} N=${b[5]} EOT=${b[6]}` : op === 0x0F ? ` cylinder ${b[2]}` : '');
    this.ev('command', us, txt, op === 0x05 || op === 0x06 ? b[4] : 0);
    switch (op) {
      case 0x03:                                     // SPECIFY: no result phase
        this.srt = b[1] >> 4; this.hut = b[1] & 15; this.hlt = b[2] >> 1; this.nd = b[2] & 1;
        this.phase = 'idle';
        break;
      case 0x04: {                                   // SENSE DRIVE STATUS -> ST3
        const disk = us < 2 ? this.m.disks[us] : null, d = this.drives[us & 1];
        let st3 = us | (hd << 2) | 0x08;             // TS: the drives have two sides
        if (!disk || disk.readOnly) st3 |= 0x40;      // WP (an empty drive reads as protected)
        if (us < 2 && this.ready(us)) st3 |= 0x20;   // RY: a disk is in and the motor is at speed
        if (us < 2 && d.cyl === 0) st3 |= 0x10;      // T0
        this.st[3] = st3;
        this.startResult([st3], false);
        break;
      }
      case 0x07:                                     // RECALIBRATE
        this.startSeek(us, hd, 0, true);
        this.phase = 'idle';
        break;
      case 0x0F:                                     // SEEK
        this.startSeek(us, hd, b[2], false);
        this.phase = 'idle';
        break;
      case 0x08: {                                   // SENSE INTERRUPT STATUS
        const i = this.pend.findIndex(x => x >= 0);
        if (i < 0) { this.st[0] = 0x80; this.startResult([0x80], false); break; }
        const st0 = this.pend[i];
        this.pend[i] = -1;
        this.st[0] = st0;
        this.startResult([st0, this.pcn[i]], false);
        this.intLine();
        break;
      }
      case 0x05: case 0x06:                          // WRITE DATA, READ DATA
        this.startRw(op === 0x05, b);
        break;
      case 0x0A:                                     // READ ID
        this.startEx({ kind: 'id', us, hd });
        break;
      case 0x0D:                                     // FORMAT TRACK
        this.startEx({ kind: 'fmt', us, hd, n: b[2], sc: b[3], gpl: b[4], fill: b[5], k: 0, id: [] });
        break;
    }
    this.updMsr();
  }

  // ready: a disk is in the drive and the motor turns at full speed
  ready(i) {
    const d = this.drives[i];
    return !!this.m.disks[i] && d.motor && d.spin >= 1;
  }

  startResult(bytes, withInt) {
    this.res = bytes.slice();
    this.fifo = bytes.slice(-9);
    this.phase = 'result';
    this.ex = null;
    if (withInt) { this.resInt = true; this.intLine(); }
    this.updMsr();
  }

  // ---------- seek and recalibrate (in the drive, in parallel with other commands) ----------
  startSeek(us, hd, ncn, recal) {
    if (us >= 2) { this.pend[us] = 0x20 | 0x40 | 0x08 | (hd << 2) | us; this.intLine(); return; }
    const d = this.drives[us], x = this.mech[us];
    x.recal = recal; x.hd = hd;
    const n = recal ? Math.min(77, d.cyl) : ncn - this.pcn[us];
    x.steps = Math.abs(n); x.dir = recal ? -1 : Math.sign(n);
    d.targetCyl = recal ? 0 : Math.max(0, d.cyl + n);
    if (recal) this.pcn[us] = 0; else this.pcn[us] = ncn;
    d.stepping = x.steps > 0;
    x.stepWait = x.steps > 0 ? this.stepClocks() * 0.5 : 0;
    x.settle = x.steps > 0 ? 0 : 1;                  // no step: the seek ends at once
    this.ev('seek', us, recal ? 'RECALIBRATE to track 0' : `SEEK to track ${ncn}`);
    this.updMsr();
  }
  seekTick(i, c, base) {
    const d = this.drives[i], x = this.mech[i];
    let left = c;
    while (d.stepping && x.stepWait <= left) {
      left -= Math.max(0, x.stepWait);
      d.cyl = Math.max(0, Math.min(83, d.cyl + x.dir));
      if (this.m.disks[i]) x.changed = false;       // a step pulse with a disk in clears the change latch
      if (--x.steps <= 0 || (x.recal && d.cyl === 0)) {
        d.stepping = false; x.steps = 0;
        x.settle = this.settleClocks();
      } else x.stepWait = this.stepClocks();
      this.tOff = base + c - left;
      this.ev('step', i, `step to track ${d.cyl}`);
      this.updMsr();
    }
    if (d.stepping) { x.stepWait -= left; return; }
    if (x.settle > 0) {
      x.settle -= left;
      if (x.settle <= 0) {
        x.settle = 0;
        // ST0: SE (seek end), or SE + EC + abnormal when a recalibrate did not reach track 0
        this.pend[i] = (x.recal && d.cyl !== 0 ? 0x70 : 0x20) | (x.hd << 2) | i;
        this.tOff = base + c;
        this.updMsr();
        this.intLine();
      }
    }
  }

  // ---------- read, write, read ID, format ----------
  startEx(ex) {
    ex.wait = 0; ex.stage = 'start';
    this.ex = ex;
    this.phase = 'execution';
    const d = this.drives[ex.us & 1];
    if (ex.us < 2) { d.reading = ex.kind === 'rd' || ex.kind === 'id'; d.writing = ex.kind === 'wr' || ex.kind === 'fmt'; }
    this.updMsr();
  }
  startRw(write, b) {
    const us = b[1] & 3, hd = (b[1] >> 2) & 1;
    this.startEx({ kind: write ? 'wr' : 'rd', us, hd, mt: !!(b[0] & 0x80), C: b[2], H: b[3], R: b[4], N: b[5], eot: b[6], i: 0, tc: false, n: 0 });
  }
  // End of the execution phase: ST0-ST2 and C, H, R, N; IRQ 6.
  finish(st0, st1, st2, C, H, R, N) {
    const ex = this.ex;
    if (ex && ex.us < 2) {
      const d = this.drives[ex.us];
      d.reading = false; d.writing = false;
    }
    this.st[0] = st0; this.st[1] = st1; this.st[2] = st2;
    this.ev('result', ex ? ex.us : 0, `ST0=${hexb(st0)} ST1=${hexb(st1)} ST2=${hexb(st2)} C=${C} H=${H} R=${R} N=${N}`, R);
    this.startResult([st0, st1, st2, C & 0xFF, H & 0xFF, R & 0xFF, N & 0xFF], true);
  }
  // The operation fails after the index hole passes twice (no ID field found).
  searchFail(st1, st2) {
    const ex = this.ex, d = this.drives[ex.us & 1];
    ex.stage = 'fail'; ex.st1 = st1; ex.st2 = st2 || 0;
    ex.wait = this.real ? this.clocksTo(d, 0) + this.rot : this.ms(0.2);
  }
  // First checks of an operation. Returns false when it ended.
  checkStart() {
    const ex = this.ex, us = ex.us, disk = us < 2 ? this.m.disks[us] : null;
    const st0 = 0x40 | (ex.hd << 2) | us;
    if (us >= 2 || !this.ready(us)) {                // NR: no disk or the motor is not at speed
      this.finish(st0 | 0x08, 0, 0, ex.C || 0, ex.H || 0, ex.R || 0, ex.N || 2);
      return false;
    }
    if ((ex.kind === 'wr' || ex.kind === 'fmt') && disk.readOnly) {   // NW: write protected
      this.finish(st0, 0x02, 0, ex.C || 0, ex.H || 0, ex.R || 0, ex.N || 2);
      return false;
    }
    const d = this.drives[us];
    // The controller finds no ID field: wrong data rate, no track, no side
    if (this.rateFor(disk) !== fdcMediaRate(disk) || d.cyl >= disk.cyls || ex.hd >= disk.heads) { this.searchFail(0x01); return false; }
    return true;
  }

  // DRQ 2: one byte through the DMA channel 2 (DOR bit 3 gates DRQ on the PC). null: no DACK.
  dmaReq(toMem, data) { return this.dor & 8 ? this.m.dmaRequest(2, toMem, data) : null; }

  // One step of the execution phase (the wait of the last step ended).
  exStep() {
    const ex = this.ex, us = ex.us, disk = us < 2 ? this.m.disks[us] : null, d = this.drives[us & 1];
    const st0 = 0x40 | (ex.hd << 2) | us;
    if (ex.stage === 'fail') {
      this.finish(st0, ex.st1, ex.st2, ex.C ?? d.cyl, ex.H ?? ex.hd, ex.R ?? 1, ex.N ?? 2);
      return;
    }
    if (ex.stage === 'start') {
      if (!this.checkStart()) return;
      ex.stage = ex.kind === 'fmt' ? 'index' : 'find';
      ex.wait = 0;
      if (ex.kind === 'fmt') { ex.wait = this.real ? this.clocksTo(d, 0) : this.ms(0.05); if (!this.real) d.angle = 0; }
      return;
    }
    const rate = this.rateFor(disk);
    if (ex.kind === 'id') {
      if (ex.stage === 'find') {                    // wait for the next ID field
        let r = 1;
        if (this.real) {
          let best = Infinity;
          for (let k = 1; k <= disk.spt; k++) { const w = this.clocksTo(d, this.slotStart(disk, rate, k)); if (w < best) { best = w; r = k; } }
          ex.wait = best + 10 * this.byteClocks(rate);
        } else {
          r = Math.max(1, d.sector || 1);
          d.angle = this.slotStart(disk, rate, r);
          ex.wait = 10 * this.byteClocks(rate);
        }
        ex.R = r; ex.stage = 'idDone';
        this.ev('read', us, `READ ID: sector ${r}`, r);
        return;
      }
      this.finish(ex.hd << 2 | us, 0, 0, d.cyl, ex.hd, ex.R, 2);
      return;
    }
    if (ex.kind === 'fmt') return this.fmtStep(disk, d, rate);
    // READ DATA / WRITE DATA
    if (ex.stage === 'find') {
      // the ID field must match C, H, R, N; the IDs on the track have C = the head position
      if (ex.C !== d.cyl) { this.searchFail(0x04, ex.C === 0xFF ? 0x02 : 0x10); return; }   // ND + BC / WC
      if (ex.H !== ex.hd || ex.R < 1 || ex.R > disk.spt || ex.N !== 2) { this.searchFail(0x04); return; }   // ND
      const a = this.dataStart(disk, rate, ex.R);
      if (this.real) ex.wait = this.clocksTo(d, a);
      else { d.angle = a; ex.wait = this.byteClocks(rate); }
      ex.stage = 'data'; ex.i = 0; ex.first = true;
      ex.base = disk.lba(d.cyl, ex.hd, ex.R) * 512;
      if (ex.kind === 'wr') ex.buf = new Uint8Array(512);
      return;
    }
    if (ex.stage === 'data') {
      if (ex.first) {
        ex.first = false;
        this.ev(ex.kind === 'wr' ? 'write' : 'read', us, `${ex.kind === 'wr' ? 'write' : 'read'} C=${d.cyl} H=${ex.hd} R=${ex.R}`, ex.R);
        disk.busy = 1; disk.lastSector = ex.base / 512;
      }
      // one byte through DMA channel 2
      const toMem = ex.kind === 'rd';
      const r = this.dmaReq(toMem, toMem ? disk.data[ex.base + ex.i] : 0);
      if (!r) { this.finish(st0, 0x10, 0, ex.C, ex.H, ex.R, ex.N); return; }   // OR: the DMA did not answer
      if (!toMem) ex.buf[ex.i] = r.data;
      this.pushFifo(toMem ? disk.data[ex.base + ex.i] : r.data);
      if (r.tc) ex.tc = true;
      ex.i++;
      if (!this.real) d.angle = this.dataStart(disk, rate, ex.R) + ex.i / this.trackBytes(rate);
      if (ex.i < 512 && !ex.tc) { ex.wait = this.byteClocks(rate); return; }
      // the end of the sector (after TC the controller still reads to the end of the sector)
      if (ex.kind === 'wr') {
        const n = ex.tc ? ex.i : 512;
        disk.data.set(ex.buf.subarray(0, n), ex.base);
        if (n < 512) disk.data.fill(0, ex.base + n, ex.base + 512);
        disk.writes++; disk.dirty = true;
      } else disk.reads++;
      ex.n++;
      // the next sector: R + 1, or the next side (MT), or the end of the cylinder
      let { C, H, R } = ex, end = false;
      if (R !== ex.eot) R++;
      else if (ex.mt && !(ex.hd & 1)) { R = 1; H = ex.H ^ 1; }
      else { R = 1; C++; H = ex.mt ? ex.H ^ 1 : ex.H; end = true; }
      if (ex.tc) { this.finish(ex.hd << 2 | us, 0, 0, C, H, R, ex.N); return; }
      if (end) { this.finish(st0, 0x80, 0, C, H, R, ex.N); return; }      // EN: end of cylinder
      if (H !== ex.H) { ex.hd = H & 1; d.head = ex.hd; if (ex.hd >= disk.heads) { ex.C = C; ex.H = H; ex.R = R; this.searchFail(0x01); return; } }
      ex.C = C; ex.H = H; ex.R = R;
      ex.stage = 'find';
      ex.wait = this.real ? 0 : this.byteClocks(rate) * 8;
    }
  }
  // FORMAT TRACK: after the index hole, 4 DMA bytes (C, H, R, N) for each sector,
  // then the controller writes the ID field and the data field (filler bytes).
  fmtStep(disk, d, rate) {
    const ex = this.ex, us = ex.us;
    if (ex.stage === 'index') { ex.stage = 'id'; ex.wait = 0; this.ev('write', us, `FORMAT track ${d.cyl} side ${ex.hd}`, 1); return; }
    if (ex.stage === 'id') {
      const r = this.dmaReq(false, 0);
      if (!r) { this.finish(0x40 | (ex.hd << 2) | us, 0x10, 0, d.cyl, ex.hd, 1, ex.n); return; }
      ex.id.push(r.data);
      this.pushFifo(r.data);
      if (r.tc) ex.tc = true;
      if (ex.id.length < 4 && !ex.tc) { ex.wait = this.byteClocks(rate); return; }
      const [C, H, R] = ex.id;
      ex.id = [];
      ex.lastId = [C, H, R];
      if (R >= 1 && R <= disk.spt && ex.hd < disk.heads && d.cyl < disk.cyls) {
        const base = disk.lba(d.cyl, ex.hd, R) * 512;
        disk.data.fill(ex.fill, base, base + 512);
        disk.dirty = true; disk.busy = 1; disk.lastSector = base / 512;
      }
      ex.k++;
      const slot = this.trackBytes(rate) / disk.spt;
      if (ex.k >= ex.sc || ex.tc) {
        disk.writes++;
        ex.stage = 'done';
        ex.wait = (slot - 4) * this.byteClocks(rate);
        return;
      }
      ex.wait = (slot - 4) * this.byteClocks(rate);
      if (!this.real) d.angle = this.slotStart(disk, rate, Math.min(ex.k + 1, disk.spt));
      return;
    }
    const L = ex.lastId || [d.cyl, ex.hd, 1];
    this.finish(ex.hd << 2 | us, 0, 0, L[0], L[1], L[2], ex.n);
  }

  // ---------- time ----------
  // Advance the drives and the controller by c CPU clocks. Trace events get
  // t = the clock offset inside this window (the current instruction).
  tick(c) {
    if (this.sleep) return;
    if (this.coast) { this.lazy += c; if (this.lazy >= 400) this.sync(); return; }
    const m = this.m;
    // a new disk in a drive sets its change latch
    const x0 = this.mech[0], x1 = this.mech[1], k0 = m.disks[0] || null, k1 = m.disks[1] || null;
    if (k0 !== x0.disk) { x0.disk = k0; x0.changed = true; }
    if (k1 !== x1.disk) { x1.disk = k1; x1.changed = true; }
    const d0 = this.drives[0], d1 = this.drives[1];
    if (!this.ex && this.resetWait <= 0 && !d0.motor && !d1.motor && d0.spin <= 0 && d1.spin <= 0
      && !d0.stepping && !d1.stepping && x0.settle <= 0 && x1.settle <= 0) { this.sleep = true; return; }
    // Only the disks turn: collect the clocks and move the disks in larger steps.
    // A port access to the controller brings the drives up to date first (sync).
    if (!this.ex && this.resetWait <= 0 && !d0.stepping && !d1.stepping && x0.settle <= 0 && x1.settle <= 0) {
      this.coast = true;
      this.lazy += c;
      if (this.lazy >= 400) this.sync();
      return;
    }
    this.sync();
    this.inTick = true;
    this.tOff = 0;
    if (this.resetWait > 0) {
      if (this.resetWait <= c) {
        this.tOff = this.resetWait;
        this.resetWait = 0;
        // the controller polls the 4 drives: ST0 = C0h + drive for each (ready change)
        for (let i = 0; i < 4; i++) this.pend[i] = 0xC0 | i;
        this.updMsr();
        this.ev('reset', 0, 'the controller leaves the reset state');
        this.intLine();
      } else this.resetWait -= c;
    }
    let pos = 0, guard = 0;
    while (this.ex && this.ex.wait <= c - pos && guard++ < 100000) {
      const w = Math.max(0, this.ex.wait);
      this.mechTick(w, pos);
      pos += w;
      this.tOff = pos;
      this.ex.wait = 0;
      this.exStep();
    }
    if (this.ex) this.ex.wait -= c - pos;
    this.mechTick(c - pos, pos);
    this.inTick = false;
  }
  sync() {
    if (this.lazy > 0) { const l = this.lazy; this.lazy = 0; this.mechTick(l, 0); }
    // the disks stopped: the next tick() looks at the full state (and can sleep)
    if (this.coast) { const d = this.drives; if (!d[0].motor && !d[1].motor && d[0].spin <= 0 && d[1].spin <= 0) this.coast = false; }
  }
  // Motors, rotation and head steps for dt clocks, from offset base of the window.
  mechTick(dt, base) {
    if (dt <= 0) return;
    const real = this.real, rot = this.rot;
    for (let i = 0; i < 2; i++) {
      const d = this.drives[i];
      if (d.motor) d.spin = real ? Math.min(1, d.spin + dt / this.ms(500)) : 1;
      else if (d.spin > 0) d.spin = Math.max(0, d.spin - dt / this.ms(1500));
      if (d.spin > 0) {
        d.angle += d.spin * dt / rot;
        d.angle -= Math.floor(d.angle);
      }
      d.index = d.spin > 0 && d.angle < 0.02;
      const disk = this.m.disks[i];
      d.sector = disk && d.spin > 0 && d.cyl < disk.cyls ? this.sectorAt(disk, d.angle) : 0;
      if (disk && d.motor && disk.busy < 0.3) disk.busy = 0.3;     // the drive LED is on while the motor turns
      if (d.stepping || this.mech[i].settle > 0) this.seekTick(i, dt, base);
    }
  }
}

function hexb(v) { return (v & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }
