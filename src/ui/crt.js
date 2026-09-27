// CGA 80x25 text screen drawn from video RAM on a canvas, with phosphor glow,
// scanlines and a blinking cursor. It also turns host keys into scan codes.
// "Fit" mode zooms to the part of the screen in use, so small screens stay legible.

const CGA_RGB = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'];

// Code page 437 -> Unicode
const CP437 = (() => {
  const lo = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼';
  const hi = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
  const t = [];
  for (let i = 0; i < 256; i++) {
    if (i < 32) t.push(lo[i]);
    else if (i < 127) t.push(String.fromCharCode(i));
    else if (i === 127) t.push('⌂');
    else t.push(hi[i - 128]);
  }
  t[0] = ' ';
  return t;
})();

const SCAN_CODES = (() => {
  const m = { Escape: 1, Backspace: 0x0E, Tab: 0x0F, Enter: 0x1C, ControlLeft: 0x1D, ControlRight: 0x1D,
    ShiftLeft: 0x2A, ShiftRight: 0x36, AltLeft: 0x38, AltRight: 0x38, Space: 0x39, CapsLock: 0x3A,
    Minus: 0x0C, Equal: 0x0D, BracketLeft: 0x1A, BracketRight: 0x1B, Semicolon: 0x27, Quote: 0x28,
    Backquote: 0x29, Backslash: 0x2B, Comma: 0x33, Period: 0x34, Slash: 0x35, NumpadMultiply: 0x37 };
  '1234567890'.split('').forEach((d, i) => { m['Digit' + d] = 2 + i; });
  'QWERTYUIOP'.split('').forEach((c, i) => { m['Key' + c] = 0x10 + i; });
  'ASDFGHJKL'.split('').forEach((c, i) => { m['Key' + c] = 0x1E + i; });
  'ZXCVBNM'.split('').forEach((c, i) => { m['Key' + c] = 0x2C + i; });
  for (let i = 1; i <= 10; i++) m['F' + i] = 0x3A + i;
  Object.assign(m, { ArrowUp: 0x48, ArrowDown: 0x50, ArrowLeft: 0x4B, ArrowRight: 0x4D, Home: 0x47, End: 0x4F,
    PageUp: 0x49, PageDown: 0x51, Insert: 0x52, Delete: 0x53, NumLock: 0x45, ScrollLock: 0x46,
    Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4A, Numpad4: 0x4B, Numpad5: 0x4C,
    Numpad6: 0x4D, NumpadAdd: 0x4E, Numpad1: 0x4F, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52,
    NumpadDecimal: 0x53, NumpadEnter: 0x1C, NumpadDivide: 0x35, Pause: 0x46 });
  return m;
})();

// Printable character -> [scan code, shift] on a US keyboard.
const CHAR_SCAN = (() => {
  const m = {};
  const rows = [
    [0x02, '1234567890-=', '!@#$%^&*()_+'], [0x10, 'qwertyuiop[]', 'QWERTYUIOP{}'],
    [0x1E, "asdfghjkl;'`", 'ASDFGHJKL:"~'], [0x2B, '\\zxcvbnm,./', '|ZXCVBNM<>?'],
  ];
  for (const [base, lo, hi] of rows) {
    for (let i = 0; i < lo.length; i++) { m[lo[i]] = [base + i, false]; m[hi[i]] = [base + i, true]; }
  }
  m[' '] = [0x39, false];
  return m;
})();

// VGA picture from the card's state (not from mode numbers): the CRTC address counter
// (byte / word / doubleword mode, CGA row-scan substitution, start address, offset,
// max scan line, double scan, preset row scan, line compare), the sequencer / graphics
// controller shift modes (text with the 9-dot font from plane 2, planar, CGA 2-bit
// interleave, 256 colours) and the attribute controller + DAC colour path.
// Output: `buf` (Uint32 RGBA, w x h) = the active display at its native pixel grid;
// w = pixels a line (320, 360, 640, 720...), h = scan lines (350, 400, 480...).
// No DOM here: the tests use it in Node.
const VGA_SPREAD = (() => {            // byte -> 8 nibbles, pixel i (left first) in nibble i
  const t = new Uint32Array(256);
  for (let b = 0; b < 256; b++) { let v = 0; for (let i = 0; i < 8; i++) if (b & (0x80 >> i)) v |= 1 << (4 * i); t[b] = v >>> 0; }
  return t;
})();

class VgaRenderer {
  constructor(vga) {
    this.vga = vga;
    this.w = 0; this.h = 0; this.buf = null;
    this.pal32 = new Uint32Array(256);       // DAC index -> RGBA
    this.pal16 = new Uint32Array(16);        // 4-bit pixel -> RGBA (attribute controller)
    this.map256 = new Uint32Array(256);      // 8-bit pixel -> RGBA
    this.line = new Uint32Array(1200);
    this.border = 0xFF000000;
  }
  colours() {
    const v = this.vga, d = v.dac, a = v.attr, mask = v.dacMask;
    const full = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const k = (i & mask) * 3, r = d[k], g = d[k + 1], b = d[k + 2];
      full[i] = (0xFF000000 | (((b << 2) | (b >> 4)) << 16) | (((g << 2) | (g >> 4)) << 8) | ((r << 2) | (r >> 4))) >>> 0;
    }
    this.pal32 = full;
    const cpe = a[0x12] & 15, p54 = a[0x10] & 0x80, cs = a[0x14];
    for (let i = 0; i < 16; i++) {
      let p = a[i & cpe] & 0x3F;
      if (p54) p = (p & 0x0F) | ((cs & 3) << 4);
      p |= (cs & 0x0C) << 4;
      this.pal16[i] = full[p];
    }
    for (let i = 0; i < 256; i++) this.map256[i] = full[((a[(i >> 4) & cpe] & 15) << 4) | (a[i & 15 & cpe] & 15)];
    this.border = full[a[0x11]];
  }
  // blinkOn: blinking characters visible; cursorOn: cursor visible (the two blink phases)
  render(blinkOn = true, cursorOn = true) {
    const v = this.vga, c = v.crtc, s = v.seq, g = v.gc, a = v.attr, vram = v.vram, v32 = v.vram32;
    this.colours();
    const graphics = a[0x10] & 1;
    const hchars = Math.min(c[1] + 1, 128);
    const s256 = graphics && (g[5] & 0x40), inter = graphics && !s256 && (g[5] & 0x20);
    const nine = !graphics && !(s[1] & 1);
    const ppc = graphics ? (s256 ? 4 : 8) : nine ? 9 : 8;
    const W = hchars * ppc, H = Math.max(1, Math.min(v.vdisp, 1024));
    if (W !== this.w || H !== this.h || !this.buf) { this.w = W; this.h = H; this.buf = new Uint32Array(W * H); }
    const buf = this.buf;
    if (!v.pas || (s[1] & 0x20)) { buf.fill(0xFF000000); return true; }   // display off
    const msl = c[9] & 0x1F, dbl = c[9] & 0x80;
    const lc = c[0x18] | ((c[7] & 0x10) << 4) | ((c[9] & 0x40) << 3);
    const offs = c[0x13] * 2;
    const shift = c[0x14] & 0x40 ? 2 : c[0x17] & 0x40 ? 0 : 1;
    const wrap = c[0x17] & 0x20 ? 15 : 13;
    const cms = !(c[0x17] & 1), srs = !(c[0x17] & 2);
    const bytePan = (c[8] >> 5) & 3;
    const pan = v.dispPan & 15;
    let sh = nine ? (pan >= 8 ? 0 : pan + 1) : s256 ? (pan & 7) >> 1 : pan & 7;
    const panReset = a[0x10] & 0x20;
    // text state
    const blinkEn = a[0x10] & 8, lineGfx = a[0x10] & 4;
    const sq3 = s[3];
    const mapA = (((sq3 >> 5) & 1) << 2) | ((sq3 >> 2) & 3), mapB = (((sq3 >> 4) & 1) << 2) | (sq3 & 3);
    const fontA = ((mapA & 3) << 14) | ((mapA & 4) << 11), fontB = ((mapB & 3) << 14) | ((mapB & 4) << 11);
    const curMA = (c[0x0E] << 8) | c[0x0F], curS = c[0x0A] & 0x1F, curE = c[0x0B] & 0x1F;
    const curOn = cursorOn && !(c[0x0A] & 0x20) && curS <= curE;
    const ul = c[0x14] & 0x1F;
    const pal16 = this.pal16, map256 = this.map256, line = this.line;
    const n = hchars + (sh ? 1 : 0);
    let ma = v.dispStart, row = c[8] & 0x1F, half = 0, prevKey = -1e9;
    for (let y = 0; y < H; y++) {
      const o = y * W;
      // graphics rows that repeat (double scan, max scan line) are copies of the line above
      const key = graphics ? ma * 64 + ((cms || srs) ? row : 0) + sh * 4096 * 64 : -1 - y;
      if (key === prevKey) buf.copyWithin(o, o - W, o);
      else {
        const dst = sh ? line : buf, d0 = sh ? 0 : o;
        let x = d0;
        for (let k = 0; k < n; k++) {
          const m = (ma + bytePan + k) & 0xFFFF;
          let ad = shift === 1 ? ((m << 1) | ((m >> wrap) & 1)) & 0xFFFF : shift === 2 ? ((m << 2) | ((m >> 12) & 3)) & 0xFFFF : m;
          if (cms) ad = (ad & 0xDFFF) | ((row & 1) << 13);
          if (srs) ad = (ad & 0xBFFF) | ((row & 2) << 13);
          if (!graphics) {
            const ch = vram[ad << 2], at = vram[(ad << 2) | 1];
            let bits = vram[((((at & 8) ? fontA : fontB) + ch * 32 + row) & 0xFFFF) << 2 | 2];
            let fg = pal16[at & 15];
            const bg = pal16[(at >> 4) & (blinkEn ? 7 : 15)];
            let ninth = nine && lineGfx && ch >= 0xC0 && ch <= 0xDF ? bits & 1 : 0;
            if (blinkEn && (at & 0x80) && !blinkOn) fg = bg;
            if (((at & 0x77) === 1 && row === ul) || (curOn && m === curMA && row >= curS && row <= curE)) { bits = 0xFF; ninth = 1; }
            for (let b = 0x80; b; b >>= 1) dst[x++] = bits & b ? fg : bg;
            if (nine) dst[x++] = ninth ? fg : bg;
          } else {
            const w = v32[ad];
            if (s256) {
              dst[x] = map256[w & 0xFF]; dst[x + 1] = map256[(w >> 8) & 0xFF];
              dst[x + 2] = map256[(w >> 16) & 0xFF]; dst[x + 3] = map256[w >>> 24];
              x += 4;
            } else if (inter) {
              const p0 = w & 0xFF, p1 = (w >> 8) & 0xFF, p2 = (w >> 16) & 0xFF, p3 = w >>> 24;
              for (let i = 6; i >= 0; i -= 2) dst[x++] = pal16[((p0 >> i) & 3) | (((p2 >> i) & 3) << 2)];
              for (let i = 6; i >= 0; i -= 2) dst[x++] = pal16[((p1 >> i) & 3) | (((p3 >> i) & 3) << 2)];
            } else {
              const q = VGA_SPREAD[w & 0xFF] | (VGA_SPREAD[(w >> 8) & 0xFF] << 1) | (VGA_SPREAD[(w >> 16) & 0xFF] << 2) | (VGA_SPREAD[w >>> 24] << 3);
              for (let i = 0; i < 32; i += 4) dst[x++] = pal16[(q >>> i) & 15];
            }
          }
        }
        if (sh) buf.set(line.subarray(sh, sh + W), o);
      }
      prevKey = key;
      // the CRTC counters: row scan (every 2nd line with double scan), then the next row
      if (dbl && !half) half = 1;
      else {
        half = 0;
        if (row === msl) { row = 0; ma = (ma + offs) & 0xFFFF; } else row = (row + 1) & 0x1F;
      }
      if (y === lc) { ma = 0; row = 0; half = 0; if (panReset) sh = 0; prevKey = -1e9; }
    }
    return true;
  }
}

class CrtScreen {
  constructor(host, machine, onKey) {
    this.host = host; this.m = machine; this.onKey = onKey;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.text = document.createElement('canvas');   // crisp text layer
    // A fixed 4:3 full-screen copy for the 3D monitor, drawn only when someone asks for it.
    this.full = document.createElement('canvas');
    this.full.width = 1024; this.full.height = 768;
    this.fullText = document.createElement('canvas');
    this.fullText.width = 1024; this.fullText.height = 768;
    this.fullWanted = false;
    this.prev = new Uint8Array(0x4000);
    this.prevMode = -1; this.prevPal = -1; this.prevStart = -1;
    this.gfx = document.createElement('canvas');     // 320/640 x 200 graphics frame
    this.gfxCtx = this.gfx.getContext('2d');
    this.prevCursor = -1;
    this.blink = true;
    this.version = 0;
    this.dirty = true;
    this.fit = true;
    this.fitCols = 40; this.fitRows = 10;
    this.font = (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace').trim();
    this.vga = machine.vga ? new VgaRenderer(machine.vga) : null;
    this.resize();
    host.addEventListener('keydown', e => this.key(e, true));
    host.addEventListener('keyup', e => this.key(e, false));
    host.addEventListener('pointerdown', () => host.focus());
  }
  get fullCanvas() { this.fullWanted = true; return this.full; }
  setFit(on) { if (this.fit !== on) { this.fit = on; this.dirty = true; } }
  key(e, down) {
    if (e.metaKey) return;
    // Text keys follow the character (any layout), other keys follow the position.
    const ch = e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey ? CHAR_SCAN[e.key] : null;
    let code = ch ? ch[0] : SCAN_CODES[e.code];
    if (!ch && e.key && e.key.length === 1 && (e.ctrlKey || e.altKey) && CHAR_SCAN[e.key.toLowerCase()]) code = CHAR_SCAN[e.key.toLowerCase()][0];
    if (code === undefined) return;
    e.preventDefault();
    if (down && e.repeat && (code === 0x1D || code === 0x2A || code === 0x36 || code === 0x38)) return;
    if (ch && down) {
      const fake = ch[1] && !e.shiftKey;       // shift needed but not held (virtual keyboards, tests)
      if (fake) this.m.keyDown(0x2A);
      this.m.keyDown(code);
      this.m.keyUp(code);
      if (fake) this.m.keyUp(0x2A);
    } else if (!ch) {
      if (down) this.m.keyDown(code); else this.m.keyUp(code);
    }
    if (this.onKey) this.onKey(code, down);
  }
  // Text from a virtual keyboard (phones): one character at a time.
  typeText(text) {
    for (const c of text) {
      if (c === '\n' || c === '\r') { this.m.keyDown(0x1C); this.m.keyUp(0x1C); continue; }
      const k = CHAR_SCAN[c];
      if (!k) continue;
      if (k[1]) this.m.keyDown(0x2A);
      this.m.keyDown(k[0]); this.m.keyUp(k[0]);
      if (k[1]) this.m.keyUp(0x2A);
    }
    if (this.onKey) this.onKey(0, true);
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(160, Math.round(r.width * dpr)), h = Math.max(60, Math.round(r.height * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w; this.canvas.height = h;
    this.text.width = w; this.text.height = h;
    this.scan = null;
    this.dirty = true;
  }
  // The used part of the screen: it only grows until the screen is cleared.
  measure(vr, cur) {
    let maxR = -1, maxC = -1;
    for (let r = 0; r < 25; r++) {
      for (let c = 0; c < 80; c++) {
        const i = (r * 80 + c) * 2, ch = vr[i], a = vr[i + 1];
        if ((ch !== 0 && ch !== 32) || (a & 0x70)) { if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
      }
    }
    if (cur >= 0 && cur < 2000) { maxR = Math.max(maxR, Math.floor(cur / 80)); maxC = Math.max(maxC, cur % 80); }
    if (maxR < 0) { this.fitCols = 40; this.fitRows = 10; }
    const cols = clamp(maxC + 3, 40, 80), rows = clamp(maxR + 3, 10, 25);
    if (cols > this.fitCols) this.fitCols = cols;
    if (rows > this.fitRows) this.fitRows = rows;
  }
  // Draw when video RAM, the cursor or the blink phase changes.
  frame(now) {
    if (this.vga) return this.frameVga(now);
    const blink = Math.floor(now / 267) % 2 === 0;
    const all = this.m.vram(), crtc = this.m.crtc, mode = crtc.mode;
    const graphics = !!(mode & 2), wide = !!(mode & 1);
    const start = graphics ? 0 : (crtc.start * 2) & 0x3FFF;
    const cur = graphics || !crtc.cursorOn ? -1 : crtc.cursor - crtc.start;
    const len = graphics ? 0x4000 : 4000;
    let changed = this.dirty || blink !== this.blink || cur !== this.prevCursor || mode !== this.prevMode ||
      crtc.color !== this.prevPal || start !== this.prevStart;
    if (!changed) {
      const p = this.prev;
      for (let i = 0; i < len; i++) if (p[i] !== all[(start + i) & 0x3FFF]) { changed = true; break; }
    }
    if (!changed) return false;
    for (let i = 0; i < len; i++) this.prev[i] = all[(start + i) & 0x3FFF];
    this.prevCursor = cur; this.blink = blink; this.dirty = false;
    this.prevMode = mode; this.prevPal = crtc.color; this.prevStart = start;
    const vr = this.prev;
    if (!(mode & 8)) {                       // video disabled: a dark screen
      this.blank(this.ctx, this.canvas);
      if (this.fullWanted) this.blank(this.full.getContext('2d'), this.full);
    } else if (graphics) {
      this.drawGraphics(vr, mode, crtc.color);
      this.compose(this.ctx, this.text, true);
      if (this.fullWanted) this.compose(this.full.getContext('2d'), this.fullText, true);
    } else {
      const cols = wide ? 80 : 40;
      const fit = this.fit && wide;
      if (fit) this.measure(vr, cur);
      this.draw(this.ctx, this.text, vr, cur, blink, fit ? this.fitCols : cols, fit ? this.fitRows : 25, cols);
      if (this.fullWanted) this.draw(this.full.getContext('2d'), this.fullText, vr, cur, blink, cols, 25, cols);
    }
    this.version++;
    return true;
  }
  blank(g, c) {
    g.fillStyle = '#060a08';
    g.fillRect(0, 0, c.width, c.height);
  }

  // ---------- VGA ----------
  // Draw when the card reports a change (video memory, registers, DAC), or in a text
  // mode when the cursor or blink phase changes (16 and 32 frames at 70 Hz).
  frameVga(now) {
    const v = this.m.vga, md = v.mode, r = this.vga;
    const cursorOn = Math.floor(now / 229) % 2 === 0, blinkOn = Math.floor(now / 457) % 2 === 0;
    let changed = this.dirty || v.dirty;
    if (md.text && (cursorOn !== this.curPhase || blinkOn !== this.blinkPhase)) changed = true;
    if (!changed) return false;
    this.dirty = false; v.dirty = false;
    this.curPhase = cursorOn; this.blinkPhase = blinkOn;
    r.render(blinkOn, cursorOn);
    const W = r.w, H = r.h;
    if (this.gfx.width !== W || this.gfx.height !== H || !this.img32) {
      this.gfx.width = W; this.gfx.height = H;
      this.img = this.gfxCtx.createImageData(W, H);
      this.img32 = new Uint32Array(this.img.data.buffer);
    }
    this.img32.set(r.buf);
    this.gfxCtx.putImageData(this.img, 0, 0);
    // "fit": in an 80-column text mode, zoom to the characters in use
    let src = null;
    if (this.fit && md.text && md.cols >= 80 && md.rows > 0) {
      const tv = v.textView();
      if (tv) {
        this.measureCells(tv.cells, tv.cols, tv.rows, tv.cursor);
        src = { x: 0, y: 0, w: Math.min(W, this.fitCols * W / md.cols), h: Math.min(H, this.fitRows * H / md.rows) };
      }
    }
    this.composeVga(this.ctx, this.canvas, src);
    if (this.fullWanted) this.composeVga(this.full.getContext('2d'), this.full, null);
    this.version++;
    return true;
  }
  // The used part of a text screen of any size (it only grows until the screen is cleared).
  measureCells(cells, cols, rows, cur) {
    let maxR = -1, maxC = -1;
    for (let rr = 0; rr < rows; rr++) {
      for (let c = 0; c < cols; c++) {
        const i = (rr * cols + c) * 2, ch = cells[i], a = cells[i + 1];
        if ((ch !== 0 && ch !== 32 && ch !== 255) || (a & 0x70)) { if (rr > maxR) maxR = rr; if (c > maxC) maxC = c; }
      }
    }
    if (cur >= 0) { maxR = Math.max(maxR, Math.floor(cur / cols)); maxC = Math.max(maxC, cur % cols); }
    if (maxR < 0) { this.fitCols = 40; this.fitRows = 10; }
    const fc = clamp(maxC + 3, 40, cols), fr = clamp(maxR + 3, 10, rows);
    if (fc > this.fitCols) this.fitCols = fc;
    if (fr > this.fitRows) this.fitRows = fr;
    this.fitCols = Math.min(this.fitCols, cols); this.fitRows = Math.min(this.fitRows, rows);
  }
  // The VGA picture on a 4:3 tube: the active area fills the 4:3 face (as a VGA monitor
  // shows 320x200, 640x480 or 720x400), with the overscan colour around it, a soft
  // phosphor glow and fine scanlines.
  composeVga(g, c, src) {
    const r = this.vga, CW = c.width, CH = c.height, W = r.w, H = r.h;
    const s = src || { x: 0, y: 0, w: W, h: H };
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = '#050706';
    g.fillRect(0, 0, CW, CH);
    const padX = CW * 0.035, padY = CH * 0.05;
    const aspect = (s.w / W * 4) / (s.h / H * 3);
    let w = CW - 2 * padX, h = CH - 2 * padY;
    if (w / h > aspect) w = h * aspect; else h = w / aspect;
    const x = (CW - w) / 2, y = (CH - h) / 2;
    const b = r.border;
    if (b & 0xFFFFFF) {                                   // overscan (border) colour
      g.fillStyle = `rgba(${b & 255},${(b >> 8) & 255},${(b >> 16) & 255},0.85)`;
      g.fillRect(x - padX * 0.55, y - padY * 0.55, w + padX * 1.1, h + padY * 1.1);
    }
    // sharp pixels when each covers 2.5+ device pixels, else a smooth scale
    g.imageSmoothingEnabled = w / s.w < 2.5 || h / s.h < 2.5;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.gfx, s.x, s.y, s.w, s.h, x, y, w, h);
    // glow: a small smooth copy added on top
    const bl = this.bloom || (this.bloom = document.createElement('canvas'));
    const bw = Math.max(32, Math.round(w / 7)), bh = Math.max(24, Math.round(h / 7));
    if (bl.width !== bw || bl.height !== bh) { bl.width = bw; bl.height = bh; }
    const bg = bl.getContext('2d');
    bg.imageSmoothingEnabled = true;
    bg.drawImage(this.gfx, s.x, s.y, s.w, s.h, 0, 0, bw, bh);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.2;
    g.imageSmoothingEnabled = true;
    g.drawImage(bl, x, y, w, h);
    g.restore();
    // scanlines, vignette and reflection: one overlay, made again only when the geometry changes
    g.drawImage(this.vgaOverlay(c, x, y, w, h, h / s.h), 0, 0);
  }
  vgaOverlay(c, x, y, w, h, pitch) {
    const key = [c.width, c.height, x, y, w, h, pitch].map(n => n.toFixed(1)).join();
    const cache = this.overlays || (this.overlays = new Map());
    let o = cache.get(c);
    if (o && o.key === key) return o.canvas;
    const cv = o ? o.canvas : document.createElement('canvas');
    cv.width = c.width; cv.height = c.height;
    const g = cv.getContext('2d'), CW = cv.width, CH = cv.height;
    // one scanline for each displayed line when they are big enough, else a fine raster
    if (pitch >= 2.2) {
      g.fillStyle = 'rgba(0,0,0,0.24)';
      for (let yy = y + pitch * 0.62; yy < y + h; yy += pitch) g.fillRect(x, yy, w, pitch * 0.38);
    } else {
      g.fillStyle = 'rgba(0,0,0,0.11)';
      for (let yy = Math.ceil(y) + 1; yy < y + h; yy += 2) g.fillRect(x, yy, w, 1);
    }
    const vg = g.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.32, CW / 2, CH / 2, Math.max(CW, CH) * 0.74);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = vg; g.fillRect(0, 0, CW, CH);
    const rf = g.createLinearGradient(0, 0, CW * 0.4, CH);
    rf.addColorStop(0, 'rgba(200,230,255,0.05)');
    rf.addColorStop(0.5, 'rgba(200,230,255,0)');
    g.fillStyle = rf; g.fillRect(0, 0, CW, CH);
    cache.set(c, { key, canvas: cv });
    return cv;
  }
  // CGA graphics: 320x200 in 4 colours (modes 4/5) or 640x200 in 2 colours (mode 6).
  // Even scan lines are at offset 0, odd scan lines at offset 2000h.
  drawGraphics(vr, mode, color) {
    const hi = !!(mode & 0x10), W = hi ? 640 : 320;
    if (this.gfx.width !== W || this.gfx.height !== 200) { this.gfx.width = W; this.gfx.height = 200; this.img = null; }
    if (!this.img) this.img = this.gfxCtx.createImageData(W, 200);
    const rgb = CGA_RGB.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    const d = this.img.data;
    let pal;
    if (hi) pal = [rgb[0], rgb[color & 15]];
    else {
      const bright = color & 0x10 ? 8 : 0;
      const set = mode & 4 ? [3, 4, 7] : color & 0x20 ? [3, 5, 7] : [2, 4, 6];
      pal = [rgb[color & 15], rgb[set[0] + bright], rgb[set[1] + bright], rgb[set[2] + bright]];
    }
    let o = 0;
    for (let y = 0; y < 200; y++) {
      const base = ((y & 1) << 13) + (y >> 1) * 80;
      for (let x = 0; x < 80; x++) {
        const b = vr[base + x];
        if (hi) {
          for (let k = 7; k >= 0; k--) { const c = pal[(b >> k) & 1]; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; o += 4; }
        } else {
          for (let k = 6; k >= 0; k -= 2) { const c = pal[(b >> k) & 3]; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; o += 4; }
        }
      }
    }
    this.gfxCtx.putImageData(this.img, 0, 0);
  }
  // Scale the graphics frame into a text layer, then add glow and scanlines.
  compose(g, textCanvas) {
    const W = textCanvas.width, H = textCanvas.height;
    const t = textCanvas.getContext('2d');
    t.clearRect(0, 0, W, H);
    const padX = W * 0.035, padY = H * 0.05;
    let w = W - 2 * padX, h = H - 2 * padY;
    if (w / h > 4 / 3) w = h * 4 / 3; else h = w * 3 / 4;
    t.imageSmoothingEnabled = false;
    t.drawImage(this.gfx, (W - w) / 2, (H - h) / 2, w, h);
    this.finish(g, textCanvas, Math.max(2, h / 200 * 8));
  }
  draw(g, textCanvas, vr, cur, blink, cols, rows, stride = 80) {
    const W = textCanvas.width, H = textCanvas.height;
    const padX = W * 0.035, padY = H * 0.05;
    let cw = (W - 2 * padX) / cols, ch = (H - 2 * padY) / rows;
    if (ch > cw * 2.3) ch = cw * 2.3;
    if (ch < cw * 1.55) cw = ch / 1.55;
    const t = textCanvas.getContext('2d');
    t.clearRect(0, 0, W, H);
    const size = Math.min(ch * 0.98, cw / 0.56);
    t.font = `${size.toFixed(1)}px ${this.font}`;
    t.textBaseline = 'middle'; t.textAlign = 'center';
    const blinkOn = this.m.crtc.mode & 0x20;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = (row * stride + col) * 2, c = vr[i], a = vr[i + 1];
        const bg = (a >> 4) & (blinkOn ? 7 : 15), fg = a & 15;
        const x = padX + col * cw, y = padY + row * ch;
        if (bg) { t.fillStyle = CGA_RGB[bg]; t.fillRect(x, y, cw + 0.6, ch + 0.6); }
        if (blinkOn && (a & 0x80) && !blink) continue;
        if (c === 0 || c === 32 || c === 255) continue;
        t.fillStyle = CGA_RGB[fg];
        if (c === 0xDB) { t.fillRect(x, y, cw + 0.6, ch + 0.6); continue; }
        if (c === 0xDC) { t.fillRect(x, y + ch / 2, cw + 0.6, ch / 2 + 0.6); continue; }
        if (c === 0xDF) { t.fillRect(x, y, cw + 0.6, ch / 2); continue; }
        t.fillText(CP437[c], x + cw / 2, y + ch / 2 + size * 0.04);
      }
    }
    if (cur >= 0 && cur < stride * 25 && blink && (cur % stride) < cols && Math.floor(cur / stride) < rows) {
      const x = padX + (cur % stride) * cw, y = padY + Math.floor(cur / stride) * ch;
      const a = vr[cur * 2 + 1];
      t.fillStyle = (a & 15) ? CGA_RGB[a & 15] : '#aaaaaa';
      t.fillRect(x, y + ch * 0.8, cw, Math.max(1, ch * 0.13));
    }
    this.finish(g, textCanvas, ch, size);
  }
  finish(g, textCanvas, ch, size) {
    const W = textCanvas.width, H = textCanvas.height;
    size = size || ch;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#060a08';
    g.fillRect(0, 0, W, H);
    // glow, then crisp text
    g.save();
    g.globalAlpha = 0.55;
    g.filter = `blur(${Math.max(1, size * 0.22).toFixed(1)}px)`;
    g.drawImage(textCanvas, 0, 0);
    g.restore();
    g.drawImage(textCanvas, 0, 0);
    // scanlines, one dark line per quarter cell
    const step = Math.max(2, Math.round(ch / 4));
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < H; y += step) g.fillRect(0, y, W, Math.max(1, step / 2));
    // vignette and a soft reflection
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    const r = g.createLinearGradient(0, 0, W * 0.4, H);
    r.addColorStop(0, 'rgba(180,255,210,0.06)');
    r.addColorStop(0.5, 'rgba(180,255,210,0)');
    g.fillStyle = r; g.fillRect(0, 0, W, H);
  }
}

// VGA ROM fonts (8x8, 8x14, 8x16, code page 437), drawn at start-up from the page's
// monospace font at twice the size and reduced. The line-drawing, block and shade
// characters (B0h-DFh) are drawn by rule, so that they join from cell to cell (and
// into the 9th dot column of the text modes).
function makeVgaFont(h) {
  const out = new Uint8Array(256 * h);
  if (typeof document === 'undefined') return out;
  const S = 2, c = document.createElement('canvas');
  c.width = 8 * S; c.height = h * S;
  const g = c.getContext('2d', { willReadFrequently: true });
  const mono = (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace').trim();
  const weight = h === 8 ? 'bold' : '600';
  g.font = `${weight} 100px ${mono}`;
  const adv = g.measureText('M').width / 100, cap = (g.measureText('H').actualBoundingBoxAscent || 70) / 100;
  // capital letters: 10 lines in 8x16, 9 in 8x14, 6 in 8x8; no wider than the cell
  const capPx = { 8: 6, 14: 9, 16: 10 }[h] * S, base = { 8: 7, 14: 11, 16: 12 }[h] * S;
  const size = Math.min(capPx / cap, (8 * S * 0.98) / adv);
  g.font = `${weight} ${size.toFixed(1)}px ${mono}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  for (let ch = 1; ch < 256; ch++) {
    if (ch >= 0xB0 && ch <= 0xDF) continue;
    const t = CP437[ch];
    if (!t || t === ' ' || t === '\u00a0') continue;
    g.clearRect(0, 0, c.width, c.height);
    g.fillText(t, 4 * S, base);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < 8; x++) {
        let a = 0;
        for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) a += px[((y * S + dy) * c.width + x * S + dx) * 4 + 3];
        if (a / (S * S) > 80) row |= 0x80 >> x;
      }
      out[ch * h + y] = row;
    }
  }
  vgaRuleGlyphs(out, h);
  return out;
}

// Shades, box lines and blocks of code page 437 in an 8 x h cell.
function vgaRuleGlyphs(out, h) {
  const set = (c, x, y) => { if (x >= 0 && x < 8 && y >= 0 && y < h) out[c * h + y] |= 0x80 >> x; };
  const hl = (c, y, x0, x1) => { for (let x = x0; x <= x1; x++) set(c, x, y); };
  const vl = (c, x, y0, y1) => { for (let y = y0; y <= y1; y++) set(c, x, y); };
  const cy = (h >> 1) - 1, B = h - 1;
  // up, down, left, right: 0 none, 1 single, 2 double
  const T = {
    0xB3: '1100', 0xB4: '1110', 0xB5: '1120', 0xB6: '2210', 0xB7: '0210', 0xB8: '0120', 0xB9: '2220', 0xBA: '2200',
    0xBB: '0220', 0xBC: '2020', 0xBD: '2010', 0xBE: '1020', 0xBF: '0110', 0xC0: '1001', 0xC1: '1011', 0xC2: '0111',
    0xC3: '1101', 0xC4: '0011', 0xC5: '1111', 0xC6: '1102', 0xC7: '2201', 0xC8: '2002', 0xC9: '0202', 0xCA: '2022',
    0xCB: '0222', 0xCC: '2202', 0xCD: '0022', 0xCE: '2222', 0xCF: '1022', 0xD0: '2011', 0xD1: '0122', 0xD2: '0211',
    0xD3: '2001', 0xD4: '1002', 0xD5: '0102', 0xD6: '0201', 0xD7: '2211', 0xD8: '1122', 0xD9: '1010', 0xDA: '0101',
  };
  for (const k in T) {
    const c = +k, [U, D, L, R] = T[k].split('').map(Number);
    out.fill(0, c * h, c * h + h);
    const vd = U === 2 || D === 2, hd = L === 2 || R === 2;
    // single lines: vertical in columns 3-4, horizontal in line cy
    if (U === 1) { const e = hd && !D ? cy - 1 : cy; vl(c, 3, 0, e); vl(c, 4, 0, e); }
    if (D === 1) { const s = hd && !U ? cy + 1 : cy; vl(c, 3, s, B); vl(c, 4, s, B); }
    if (L === 1) hl(c, cy, 0, vd && !R ? 2 : 4);
    if (R === 1) hl(c, cy, vd && !L ? 5 : 3, 7);
    // double lines: columns 2 and 5, lines cy-1 and cy+1; the tracks meet at the corners
    if (U === 2) { vl(c, 2, 0, L ? (L === 2 ? cy - 1 : cy) : cy + 1); vl(c, 5, 0, R ? (R === 2 ? cy - 1 : cy) : cy + 1); }
    if (D === 2) { vl(c, 2, L ? (L === 2 ? cy + 1 : cy) : cy - 1, B); vl(c, 5, R ? (R === 2 ? cy + 1 : cy) : cy - 1, B); }
    if (L === 2) { hl(c, cy - 1, 0, U ? (U === 2 ? 2 : 3) : 5); hl(c, cy + 1, 0, D ? (D === 2 ? 2 : 3) : 5); }
    if (R === 2) { hl(c, cy - 1, U ? (U === 2 ? 5 : 4) : 2, 7); hl(c, cy + 1, D ? (D === 2 ? 5 : 4) : 2, 7); }
  }
  for (let y = 0; y < h; y++) {
    out[0xB0 * h + y] = y & 1 ? 0x88 : 0x22;          // light shade
    out[0xB1 * h + y] = y & 1 ? 0xAA : 0x55;          // medium shade
    out[0xB2 * h + y] = y & 1 ? 0x77 : 0xDD;          // dark shade
    out[0xDB * h + y] = 0xFF;                          // full block
    out[0xDC * h + y] = y >= h >> 1 ? 0xFF : 0;       // lower half
    out[0xDD * h + y] = 0xF0;                          // left half
    out[0xDE * h + y] = 0x0F;                          // right half
    out[0xDF * h + y] = y < h >> 1 ? 0xFF : 0;        // upper half
  }
}
