// IBM VGA: 256 KB of video memory in 4 planes, the sequencer, the graphics controller
// with its 4 latches, the attribute controller, the CRTC, the DAC, the miscellaneous
// output register and the input status registers (retrace timing from CPU clocks).
//
// Memory layout: `vram[offset * 4 + plane]` (offset 0..FFFFh in each plane), so one
// 32-bit word of `vram32` holds the same offset of all 4 planes (the latch width).
// The mode of the card comes only from the registers; nothing here knows BIOS mode
// numbers. The display is drawn by VgaRenderer (src/ui/crt.js) from this state.

// EXPAND[b]: 4-bit plane mask b -> a 32-bit mask with FFh in each selected plane byte.
const VGA_EXPAND = (() => {
  const t = new Uint32Array(16);
  for (let b = 0; b < 16; b++) t[b] = (b & 1 ? 0xFF : 0) | (b & 2 ? 0xFF00 : 0) | (b & 4 ? 0xFF0000 : 0) | (b & 8 ? 0xFF000000 : 0);
  return t;
})();

class VGA {
  // opts: { clockHz } = the CPU clock that tick(cycles) counts
  constructor(opts = {}) {
    this.vrIrq = false; this.modeCache = null;   // all the fields start here (see CPU8086)
    this.clockHz = opts.clockHz || 4772727;
    this.vram = new Uint8Array(0x40000);
    this.vram32 = new Uint32Array(this.vram.buffer);
    this.reset();
  }

  reset() {
    this.vram.fill(0);
    this.seq = new Uint8Array(8);
    this.gc = new Uint8Array(16);
    this.crtc = new Uint8Array(32);
    this.attr = new Uint8Array(32);
    this.dac = new Uint8Array(768);
    this.seqIndex = 0; this.gcIndex = 0; this.crtcIndex = 0;
    this.attrIndex = 0; this.attrFlip = false; this.pas = false;
    this.dacMask = 0xFF; this.dacRead = 0; this.dacWrite = 0; this.dacComp = 0; this.dacState = 0;
    this.misc = 0; this.feature = 0; this.enable = 1;
    this.latch = 0;
    // power-on values that make a sane (blank) timing before the BIOS runs
    this.crtc[0] = 0x5F; this.crtc[1] = 0x4F; this.crtc[6] = 0xBF; this.crtc[7] = 0x1F;
    this.crtc[0x10] = 0x9C; this.crtc[0x11] = 0x0E; this.crtc[0x12] = 0x8F;
    this.seq[1] = 0x20;                        // screen off
    this.gc[8] = 0xFF;
    this.clk = 0; this.frames = 0;
    this.dispStart = 0; this.dispPan = 0;      // start address and panning latched at vertical retrace
    this.inRetrace = false;
    this.dirty = true;                         // the picture may have changed since the last draw
    this.regVersion = 0;                       // changes with every register write that changes the picture
    this.dacVersion = 0;
    this.writes = 0;                           // count of CPU writes to video memory
    this.decode();
  }

  // ---------- decoded register state (recomputed on each register write) ----------
  decode() {
    const g = this.gc, s = this.seq;
    const map = (g[6] >> 2) & 3;
    this.memBase = map === 0 ? 0xA0000 : map === 1 ? 0xA0000 : map === 2 ? 0xB0000 : 0xB8000;
    this.memSize = map === 0 ? 0x20000 : map === 1 ? 0x10000 : 0x8000;
    this.chain4 = !!(s[4] & 8);
    this.oddEvenW = !(s[4] & 4) && !this.chain4;
    this.oddEvenR = !!(g[5] & 0x10) && !this.chain4;
    this.chainOE = !!(g[6] & 2) && !this.chain4;
    this.writeMode = g[5] & 3;
    this.readMode = (g[5] >> 3) & 1;
    this.rotate = g[3] & 7;
    this.func = (g[3] >> 3) & 3;
    this.sr32 = VGA_EXPAND[g[0] & 15];
    this.esr32 = VGA_EXPAND[g[1] & 15];
    this.cc32 = VGA_EXPAND[g[2] & 15];
    this.cdc32 = VGA_EXPAND[g[7] & 15];
    this.bitMask = g[8];
    this.bm32 = (g[8] * 0x01010101) >>> 0;
    this.mapMask = s[2] & 15;
    this.readMap = g[4] & 3;
    this.colorIO = !!(this.misc & 1);
    this.timing();
  }

  // Frame timing from the CRTC and the dot clock: line rate and lines per frame.
  timing() {
    const c = this.crtc;
    const dotHz = (this.misc & 0x0C) === 4 ? 28322000 : 25175000;
    const charW = this.seq[1] & 1 ? 8 : 9;
    const htotal = Math.max(20, c[0] + 5) * charW * (this.seq[1] & 8 ? 2 : 1);
    let lineHz = dotHz / htotal;
    if (!(lineHz > 15000 && lineHz < 40000)) lineHz = 31469;
    this.lineClk = this.clockHz / lineHz;
    this.vtotal = Math.max(100, (c[6] | ((c[7] & 1) << 8) | ((c[7] & 0x20) << 4)) + 2);
    this.vdisp = (c[0x12] | ((c[7] & 2) << 7) | ((c[7] & 0x40) << 3)) + 1;
    if (this.vdisp >= this.vtotal) this.vdisp = this.vtotal - 20;
    this.vrStart = c[0x10] | ((c[7] & 4) << 6) | ((c[7] & 0x80) << 2);
    if (this.vrStart >= this.vtotal) this.vrStart = this.vdisp + 10;
    const len = ((c[0x11] & 15) - (this.vrStart & 15)) & 15;
    this.vrEnd = this.vrStart + (len || 16);
    this.hActive = Math.min(0.95, (c[1] + 1) / Math.max(c[0] + 5, c[1] + 2)) * this.lineClk;
    this.frameClk = this.vtotal * this.lineClk;
    this.hz = lineHz / this.vtotal;
  }

  // ---------- CPU memory access (A0000-BFFFF) ----------
  // Chain 4: address bits 0-1 select the plane; the plane offset is the address with
  // bits 0-1 replaced by bits 14-15 (the CRTC doubleword mode reads the same way).
  // Odd/even: address bit 0 selects plane 0/2 or 1/3; the offset has bit 0 cleared.
  write8(a, v) {
    let off = a - this.memBase;
    if (off < 0 || off >= this.memSize) return;
    off &= 0xFFFF;
    let planes = this.mapMask;
    if (this.chain4) { planes &= 1 << (off & 3); off = (off & 0xFFFC) | (off >> 14); }
    else {
      if (this.oddEvenW) planes &= off & 1 ? 0xA : 0x5;
      if (this.chainOE) off &= 0xFFFE;
    }
    if (!planes) return;
    const latch = this.latch;
    let d;
    switch (this.writeMode) {
      case 0: {
        if (this.rotate) v = ((v >> this.rotate) | (v << (8 - this.rotate))) & 0xFF;
        d = v * 0x01010101;
        if (this.esr32) d = (d & ~this.esr32) | (this.sr32 & this.esr32);
        d = this.alu(d, latch);
        d = (d & this.bm32) | (latch & ~this.bm32);
        break;
      }
      case 1: d = latch; break;
      case 2: {
        d = this.alu(VGA_EXPAND[v & 15], latch);
        d = (d & this.bm32) | (latch & ~this.bm32);
        break;
      }
      default: {
        if (this.rotate) v = ((v >> this.rotate) | (v << (8 - this.rotate))) & 0xFF;
        const m = (v & this.bitMask) * 0x01010101;
        d = this.alu(this.sr32, latch);
        d = (d & m) | (latch & ~m);
      }
    }
    const pm = VGA_EXPAND[planes], old = this.vram32[off];
    this.vram32[off] = (old & ~pm) | (d & pm);
    this.writes++;
    this.dirty = true;
  }
  alu(d, latch) {
    switch (this.func) {
      case 1: return d & latch;
      case 2: return d | latch;
      case 3: return d ^ latch;
      default: return d;
    }
  }
  read8(a) {
    let off = a - this.memBase;
    if (off < 0 || off >= this.memSize) return 0xFF;
    off &= 0xFFFF;
    let plane;
    if (this.chain4) { plane = off & 3; off = (off & 0xFFFC) | (off >> 14); }
    else {
      plane = this.oddEvenR ? (this.readMap & 2) | (off & 1) : this.readMap;
      if (this.chainOE) off &= 0xFFFE;
    }
    const l = this.vram32[off];
    this.latch = l;
    if (!this.readMode || this.chain4) return this.vram[(off << 2) | plane];
    // read mode 1: colour compare of the 4 latched bytes
    const x = (l ^ this.cc32) & this.cdc32;
    return ~(x | (x >>> 8) | (x >>> 16) | (x >>> 24)) & 0xFF;
  }
  // The byte a read would return, without loading the latches (for views).
  peek8(a) {
    let off = a - this.memBase;
    if (off < 0 || off >= this.memSize) return 0xFF;
    off &= 0xFFFF;
    let plane;
    if (this.chain4) { plane = off & 3; off = (off & 0xFFFC) | (off >> 14); }
    else {
      plane = this.oddEvenR || this.oddEvenW ? (this.readMap & 2) | (off & 1) : this.readMap;
      if (this.chainOE) off &= 0xFFFE;
    }
    return this.vram[(off << 2) | plane];
  }
  // Planes 0 and 1 seen as CGA-style odd/even memory (text: character, attribute).
  // This is what a program sees at B8000 in the colour text and CGA graphics modes.
  textBuffer(size = 0x8000) {
    const out = new Uint8Array(size), v = this.vram;
    for (let i = 0; i < size; i++) out[i] = v[((i & 0xFFFE) << 2) | (i & 1)];
    return out;
  }

  // ---------- I/O ports ----------
  isPort(p) {
    return (p >= 0x3C0 && p <= 0x3CF) || p === 0x3B4 || p === 0x3B5 || p === 0x3BA || p === 0x3D4 || p === 0x3D5 || p === 0x3DA;
  }
  // The CRTC and status ports answer at 3Dx (colour) or 3Bx (mono), by misc bit 0.
  wrongBank(p) { return (p & 0xFFF0) === 0x3D0 ? !this.colorIO : (p & 0xFFF0) === 0x3B0 ? this.colorIO : false; }
  ioRead(p) {
    if (this.wrongBank(p)) return 0xFF;
    switch (p) {
      case 0x3C0: return this.attrIndex | (this.pas ? 0x20 : 0);
      case 0x3C1: return this.attr[this.attrIndex];
      case 0x3C2: return 0x10 | (this.vrIrq ? 0x80 : 0);     // switch sense: a colour monitor
      case 0x3C3: return this.enable;
      case 0x3C4: return this.seqIndex;
      case 0x3C5: return this.seq[this.seqIndex];
      case 0x3C6: return this.dacMask;
      case 0x3C7: return this.dacState;
      case 0x3C8: return this.dacWrite;
      case 0x3C9: {
        const v = this.dac[this.dacRead * 3 + this.dacComp];
        if (++this.dacComp === 3) { this.dacComp = 0; this.dacRead = (this.dacRead + 1) & 0xFF; }
        return v;
      }
      case 0x3CA: return this.feature;
      case 0x3CC: return this.misc;
      case 0x3CE: return this.gcIndex;
      case 0x3CF: return this.gc[this.gcIndex];
      case 0x3B4: case 0x3D4: return this.crtcIndex;
      case 0x3B5: case 0x3D5: return this.crtcIndex < 25 ? this.crtc[this.crtcIndex] : 0xFF;
      case 0x3BA: case 0x3DA: this.attrFlip = false; return this.status1();
    }
    return 0xFF;
  }
  ioWrite(p, v) {
    if (this.wrongBank(p)) return;
    switch (p) {
      case 0x3C0:
        if (!this.attrFlip) {
          const pas = !!(v & 0x20);
          if (pas !== this.pas) { this.pas = pas; this.changed(); }
          this.attrIndex = v & 0x1F;
        } else if (this.attrIndex < 0x15 && !(this.attrIndex < 0x10 && this.pas)) {
          // the 16 palette registers cannot change while the display reads them (PAS = 1)
          if (this.attr[this.attrIndex] !== v) { this.attr[this.attrIndex] = v; this.changed(); }
        }
        this.attrFlip = !this.attrFlip;
        return;
      case 0x3C2: this.misc = v; this.decode(); this.changed(); return;
      case 0x3C3: this.enable = v & 1; return;
      case 0x3C4: this.seqIndex = v & 7; return;
      case 0x3C5:
        if (this.seqIndex > 4) return;
        this.seq[this.seqIndex] = v; this.decode();
        if (this.seqIndex !== 2) this.changed();
        return;
      case 0x3C6: if (this.dacMask !== v) { this.dacMask = v; this.dacVersion++; this.changed(); } return;
      case 0x3C7: this.dacRead = v; this.dacComp = 0; this.dacState = 3; return;
      case 0x3C8: this.dacWrite = v; this.dacComp = 0; this.dacState = 0; return;
      case 0x3C9: {
        const i = this.dacWrite * 3 + this.dacComp;
        if (this.dac[i] !== (v & 0x3F)) { this.dac[i] = v & 0x3F; this.dacVersion++; this.dirty = true; }
        if (++this.dacComp === 3) { this.dacComp = 0; this.dacWrite = (this.dacWrite + 1) & 0xFF; }
        return;
      }
      case 0x3CE: this.gcIndex = v & 15; return;
      case 0x3CF:
        if (this.gcIndex > 8) return;
        this.gc[this.gcIndex] = v; this.decode();
        if (this.gcIndex >= 5) this.changed();
        return;
      case 0x3B4: case 0x3D4: this.crtcIndex = v & 0x1F; return;
      case 0x3B5: case 0x3D5: {
        const i = this.crtcIndex;
        if (i > 24) return;
        if ((this.crtc[0x11] & 0x80) && i <= 7) {        // registers 0-7 are write protected
          if (i === 7) this.crtc[7] = (this.crtc[7] & ~0x10) | (v & 0x10);   // except line compare bit 8
          else return;
        } else this.crtc[i] = v;
        this.timing(); this.changed();
        return;
      }
      case 0x3BA: case 0x3DA: this.feature = v; return;
    }
  }
  changed() { this.regVersion++; this.dirty = true; this.modeCache = null; }

  // ---------- retrace timing ----------
  tick(cycles) {
    this.clk += cycles;
    if (this.clk >= this.frameClk) {
      if (!this.inRetrace) this.retrace();          // a long step went over the retrace
      this.clk %= this.frameClk;
      this.frames++;
      this.inRetrace = false;
    }
    if (!this.inRetrace && this.clk >= this.vrStart * this.lineClk) this.retrace();
    if (this.vrIrq && !(this.crtc[0x11] & 0x10)) this.vrIrq = false;
  }
  // The start of vertical retrace: the CRTC loads the start address and the panning.
  retrace() {
    this.inRetrace = true;
    const s = (this.crtc[0x0C] << 8) | this.crtc[0x0D];
    if (s !== this.dispStart || this.attr[0x13] !== this.dispPan) { this.dispStart = s; this.dispPan = this.attr[0x13]; this.dirty = true; }
    if (!(this.crtc[0x11] & 0x20)) this.vrIrq = true;         // vertical interrupt (not wired to an IRQ)
  }
  // Input status 1: bit 0 = display disabled (horizontal or vertical blanking), bit 3 = vertical retrace.
  status1() {
    const line = Math.floor(this.clk / this.lineClk), pos = this.clk - line * this.lineClk;
    const vr = line >= this.vrStart && line < this.vrEnd ? 8 : 0;
    const de = line >= this.vdisp || pos >= this.hActive ? 1 : 0;
    return vr | de;
  }

  // ---------- description of the current mode (for views and tools) ----------
  get mode() {
    if (this.modeCache) return this.modeCache;
    const c = this.crtc, a = this.attr, g = this.gc, s = this.seq;
    const graphics = !!(a[0x10] & 1);
    const shift256 = !!(g[5] & 0x40), interleave = !!(g[5] & 0x20);
    const hchars = c[1] + 1;
    const dbl = c[9] & 0x80 ? 2 : 1, charH = (c[9] & 0x1F) + 1;
    const lines = this.vdisp;
    let width, colors;
    if (!graphics) { width = hchars * (s[1] & 1 ? 8 : 9); colors = 16; }
    else if (shift256) { width = hchars * 4; colors = 256; }
    else {
      // colours: the different palette values that the enabled planes can reach
      width = hchars * 8;
      const pal = new Set(); for (let i = 0; i < 16; i++) pal.add(a[i & a[0x12] & 15] & 0x3F);
      colors = pal.size <= 2 ? 2 : pal.size <= 4 ? 4 : 16;
    }
    // graphics rows repeat for the max scan line, unless the CGA row-scan substitution
    // (CRTC 17h bit 0 = 0) gives each repeat its own memory bank
    const repeat = dbl * (c[0x17] & 1 ? charH : 1);
    this.modeCache = {
      graphics, text: !graphics, colors, width,
      height: graphics ? Math.round(lines / repeat) : lines,
      lines, cols: hchars, rows: graphics ? 0 : Math.floor(lines / (charH * dbl)), charH,
      chain4: this.chain4, planar: graphics && !shift256 && !interleave, unchained: shift256 && !this.chain4,
      offset: c[0x13] * 2 * (c[0x14] & 0x40 ? 4 : c[0x17] & 0x40 ? 1 : 2),
      start: (c[0x0C] << 8) | c[0x0D],
      lineCompare: c[0x18] | ((c[7] & 0x10) << 4) | ((c[9] & 0x40) << 3),
      memBase: this.memBase, hz: this.hz,
    };
    return this.modeCache;
  }
  // Text modes: the visible characters from the display start. null in graphics modes.
  textView() {
    const m = this.mode;
    if (m.graphics) return null;
    const c = this.crtc, cols = m.cols, rows = m.rows, stride = c[0x13] * 2 || cols;
    const start = (c[0x0C] << 8) | c[0x0D];
    const cells = new Uint8Array(cols * rows * 2), v = this.vram;
    const word = !(c[0x17] & 0x40) && !(c[0x14] & 0x40);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const ma = (start + r * stride + k) & 0xFFFF, ad = word ? (ma << 1) & 0xFFFF : ma;
        cells[(r * cols + k) * 2] = v[ad << 2];
        cells[(r * cols + k) * 2 + 1] = v[(ad << 2) | 1];
      }
    }
    const cur = ((c[0x0E] << 8) | c[0x0F]) - start;
    const on = !(c[0x0A] & 0x20) && (c[0x0A] & 0x1F) <= (c[0x0B] & 0x1F);
    const rel = on && cur >= 0 ? cur : -1;
    return { cols, rows, cells, cursor: rel >= 0 && rel < stride * rows && rel % stride < cols ? Math.floor(rel / stride) * cols + rel % stride : -1 };
  }
}
