// Shared palette, number formats and a vector stroke font ("silkscreen" lettering).

const THEME = {
  void: '#120b1a',
  panel: '#1a1224',
  panel2: '#221830',
  line: '#33254a',
  ceramic: '#3b2350',
  ceramicHi: '#56346f',
  gold: '#d8a94a',
  goldHi: '#f6d27a',
  copper: '#c46b3c',
  copperDim: '#6b3a24',
  cyan: '#5fd4ff',       // address bus
  magenta: '#ff5fa2',    // control signals
  phosphor: '#7dff9a',   // current instruction, CRT
  lavender: '#b48cff',   // 8087
  text: '#ece4f5',
  muted: '#9d8fb3',
  faint: '#5d4f73',
  mask: '#1c1328',       // PCB solder mask
  silk: '#efe6d8',       // PCB silkscreen
};

// The 80286 machine has its own palette: slate-teal ground, amber accent, a green
// solder mask like the PC/AT boards, grey-blue ceramic like the 80286 PGA package.
const THEME_286 = {
  void: '#071419',
  panel: '#0c1d24',
  panel2: '#11282f',
  line: '#1e404b',
  ceramic: '#2c4b58',
  ceramicHi: '#436e7e',
  gold: '#f0913a',
  goldHi: '#ffc27d',
  copper: '#d4703f',
  copperDim: '#6a3a22',
  cyan: '#62e3ff',
  magenta: '#ff6aa0',
  phosphor: '#86ffb4',
  lavender: '#9bb8ff',
  text: '#e3f1f4',
  muted: '#8db0ba',
  faint: '#4b6a74',
  mask: '#0b2620',
  silk: '#f1eee0',
};
// The 80386 machine: graphite ground, coral accent, a blue solder mask, and the grey
// ceramic of the 386 PGA package.
const THEME_386 = {
  void: '#0c0f15',
  panel: '#131821',
  panel2: '#1a202b',
  line: '#2a3242',
  ceramic: '#3b414c',
  ceramicHi: '#5c6473',
  gold: '#f06a5a',
  goldHi: '#ff9d8f',
  copper: '#d98a52',
  copperDim: '#6e3f24',
  cyan: '#6fd3ff',
  magenta: '#ff72b8',
  phosphor: '#a3ff7c',
  lavender: '#c3a6ff',
  text: '#e9edf4',
  muted: '#99a3b6',
  faint: '#566074',
  mask: '#11223b',
  silk: '#eef1f6',
};
// The 80486 machine: deep indigo ground, lime accent, a black solder mask.
const THEME_486 = {
  void: '#0b0b17',
  panel: '#12122a',
  panel2: '#191a36',
  line: '#2a2b52',
  ceramic: '#3a3d55',
  ceramicHi: '#5b5f80',
  gold: '#b8e04a',
  goldHi: '#d9f58a',
  copper: '#c9a04a',
  copperDim: '#5e4a22',
  cyan: '#66d8ff',
  magenta: '#ff6fc8',
  phosphor: '#7dffcf',
  lavender: '#b5a8ff',
  text: '#eceef8',
  muted: '#9ea2c4',
  faint: '#555a80',
  mask: '#0e1020',
  silk: '#f0f2fa',
};
// The Pentium machine: warm charcoal ground, the gold of the ceramic package lids.
const THEME_586 = {
  void: '#0d0b08',
  panel: '#17140f',
  panel2: '#201b14',
  line: '#3a3226',
  ceramic: '#4a4338',
  ceramicHi: '#6e6454',
  gold: '#ffc93c',
  goldHi: '#ffe08a',
  copper: '#c98a4a',
  copperDim: '#5e3f22',
  cyan: '#5fd8ff',
  magenta: '#ff66b3',
  phosphor: '#7dffb0',
  lavender: '#c0a8ff',
  text: '#f4efe6',
  muted: '#b3a894',
  faint: '#6b6150',
  mask: '#12100c',
  silk: '#f6f1e8',
};
// The Pentium Pro machine: deep night blue, an aqua accent.
const THEME_686 = {
  void: '#070d14',
  panel: '#0e1620',
  panel2: '#15202c',
  line: '#243446',
  ceramic: '#3c4a58',
  ceramicHi: '#5f7285',
  gold: '#5ce6c8',
  goldHi: '#a8f5e4',
  copper: '#c9954a',
  copperDim: '#5e4622',
  cyan: '#6fb8ff',
  magenta: '#ff6fae',
  phosphor: '#9dff8a',
  lavender: '#b9a8ff',
  text: '#e8f1f6',
  muted: '#9fb2c2',
  faint: '#56687a',
  mask: '#0a1119',
  silk: '#eef5fa',
};
// The CPU model of this page ('8086' | '80286' | '80386' | '80486' | '80586' | '80686'); the page reloads to switch.
// The 80286 and the 80386 run on the AT-class board (AT_MODEL).
const CPU_MODEL = (() => {
  try { const v = JSON.parse(localStorage.getItem('a86:cpu')); return v === '80286' || v === '80386' || v === '80486' || v === '80586' || v === '80686' ? v : '8086'; } catch (e) { return '8086'; }
})();
const AT_MODEL = CPU_MODEL !== '8086';
if (CPU_MODEL === '80286') {
  Object.assign(THEME, THEME_286);
  document.documentElement.classList.add('m286');
} else if (CPU_MODEL === '80386') {
  Object.assign(THEME, THEME_386);
  document.documentElement.classList.add('m286', 'm386');
} else if (CPU_MODEL === '80486') {
  Object.assign(THEME, THEME_486);
  document.documentElement.classList.add('m286', 'm386', 'm486');
} else if (CPU_MODEL === '80586') {
  // the Pentium: m386 (the 32-bit views), not m486 (its caches are different)
  Object.assign(THEME, THEME_586);
  document.documentElement.classList.add('m286', 'm386', 'm586');
} else if (CPU_MODEL === '80686') {
  // the Pentium Pro: m386 (the 32-bit views), m686 (its own views; not m486 or m586)
  Object.assign(THEME, THEME_686);
  document.documentElement.classList.add('m286', 'm386', 'm686');
}
// The graphics card of this page ('cga' | 'vga'), storage 'video'; the page reloads to switch.
const VIDEO_CARD = (() => {
  try { return JSON.parse(localStorage.getItem('a86:video')) === 'vga' ? 'vga' : 'cga'; } catch (e) { return 'cga'; }
})();

// Bus colour for each kind of bus cycle / signal group.
const BUS_COLOR = {
  addr: THEME.cyan, data: THEME.gold, ctrl: THEME.magenta,
  fetch: THEME.gold, memr: THEME.gold, memw: THEME.goldHi, ior: THEME.magenta, iow: THEME.magenta,
  inta: THEME.magenta, fpu: THEME.lavender,
};

const hex = (v, n = 4) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const hex2 = v => hex(v & 0xFF, 2);
const hex4 = v => hex(v & 0xFFFF, 4);
const hex5 = v => hex(v & 0xFFFFF, 5);
const bin = (v, n = 16) => (v >>> 0).toString(2).padStart(n, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Stroke font on a 4 x 6 grid (y down). Each glyph is a list of polylines.
const STROKE_GLYPHS = (() => {
  const O = [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0]];
  const P = [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]];
  return {
    A: [[0, 6, 0, 2, 2, 0, 4, 2, 4, 6], [0, 4, 4, 4]],
    B: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [3, 3, 4, 4, 4, 5, 3, 6, 0, 6]],
    C: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
    D: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 1, 3, 0, 0, 0]],
    E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
    F: [[4, 0, 0, 0, 0, 6], [0, 3, 3, 3]],
    G: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3, 2, 3]],
    H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
    I: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
    J: [[4, 0, 4, 5, 3, 6, 1, 6, 0, 5]],
    K: [[0, 0, 0, 6], [4, 0, 0, 4], [1, 3, 4, 6]],
    L: [[0, 0, 0, 6, 4, 6]],
    M: [[0, 6, 0, 0, 2, 3, 4, 0, 4, 6]],
    N: [[0, 6, 0, 0, 4, 6, 4, 0]],
    O,
    P,
    Q: O.concat([[2, 4, 4, 6]]),
    R: P.concat([[2, 3, 4, 6]]),
    S: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
    T: [[0, 0, 4, 0], [2, 0, 2, 6]],
    U: [[0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]],
    V: [[0, 0, 2, 6, 4, 0]],
    W: [[0, 0, 1, 6, 2, 3, 3, 6, 4, 0]],
    X: [[0, 0, 4, 6], [4, 0, 0, 6]],
    Y: [[0, 0, 2, 3, 4, 0], [2, 3, 2, 6]],
    Z: [[0, 0, 4, 0, 0, 6, 4, 6]],
    0: O.concat([[3, 1, 1, 5]]),
    1: [[1, 1, 2, 0, 2, 6], [1, 6, 3, 6]],
    2: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 0, 6, 4, 6]],
    3: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5], [1, 3, 3, 3]],
    4: [[3, 6, 3, 0, 0, 4, 4, 4]],
    5: [[4, 0, 0, 0, 0, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
    6: [[3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
    7: [[0, 0, 4, 0, 1, 6]],
    8: [[1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0], [1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
    9: [[4, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6]],
    '-': [[1, 3, 3, 3]],
    '+': [[0, 3, 4, 3], [2, 1, 2, 5]],
    '.': [[1.8, 6, 2.2, 6]],
    ',': [[2, 5, 1.4, 7]],
    ':': [[2, 1.6, 2, 2.2], [2, 4.8, 2, 5.4]],
    '/': [[0, 6, 4, 0]],
    '(': [[3, 0, 2, 1, 2, 5, 3, 6]],
    ')': [[1, 0, 2, 1, 2, 5, 1, 6]],
    '#': [[1, 0, 1, 6], [3, 0, 3, 6], [0, 2, 4, 2], [0, 4, 4, 4]],
    '*': [[0, 1, 4, 5], [4, 1, 0, 5], [2, 0, 2, 6]],
    '=': [[0, 2, 4, 2], [0, 4, 4, 4]],
    '>': [[0, 0, 4, 3, 0, 6]],
    '<': [[4, 0, 0, 3, 4, 6]],
    ' ': [],
  };
})();

// SVG path data for text. size = glyph height in px; advance = 6 grid units.
function strokeTextPath(text, x, y, size, spacing = 1.5) {
  const s = size / 6, adv = (4 + spacing) * s;
  let d = '';
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    const g = STROKE_GLYPHS[ch];
    if (g) for (const pl of g) {
      for (let i = 0; i < pl.length; i += 2) {
        d += (i ? 'L' : 'M') + (cx + pl[i] * s).toFixed(2) + ' ' + (y + pl[i + 1] * s).toFixed(2);
      }
    }
    cx += adv;
  }
  return d;
}
function strokeTextWidth(text, size, spacing = 1.5) {
  const n = String(text).length;
  return n ? (n * (4 + spacing) - spacing) * size / 6 : 0;
}
// Draw stroke text on a 2D canvas context with the current strokeStyle / lineWidth.
function strokeTextCanvas(ctx, text, x, y, size, spacing = 1.5, align = 'left') {
  if (align !== 'left') x -= strokeTextWidth(text, size, spacing) * (align === 'center' ? 0.5 : 1);
  const s = size / 6, adv = (4 + spacing) * s;
  ctx.beginPath();
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    const g = STROKE_GLYPHS[ch];
    if (g) for (const pl of g) {
      ctx.moveTo(cx + pl[0] * s, y + pl[1] * s);
      for (let i = 2; i < pl.length; i += 2) ctx.lineTo(cx + pl[i] * s, y + pl[i + 1] * s);
    }
    cx += adv;
  }
  ctx.stroke();
}

// Small DOM/SVG helpers used by several views.
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
// The stages of a pipe event [PF, D1, D2, EX, WB] (the younger ones first), without the comments.
// After a HLT in an older stage, the younger stages hold the bytes after the HLT (the prefetcher took
// them, and the decoder sees them as instructions, often "add [bx+si], al" for zero bytes); they
// never execute, so they show as empty. The result has hlt: true when a stage was cut.
function pipeAfterHalt(stage) {
  const st = (stage || []).slice(0, 5).map(x => String(x || '').replace(/\s*;.*$/, ''));
  let h = -1;
  st.forEach((x, i) => { if (/^hlt\b/i.test(x.trim())) h = Math.max(h, i); });
  if (h > 0) for (let i = 0; i < h; i++) st[i] = '';
  st.hlt = h > 0;
  return st;
}
function htmlEl(tag, attrs, parent, text) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') el.className = attrs[k];
    else el.setAttribute(k, attrs[k]);
  }
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
const storage = {
  get(k, d) { try { const v = localStorage.getItem('a86:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('a86:' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
};

// The animation clock. Views and the instruction playback use animNow() in place of
// performance.now(), so that the slow-motion control slows every animation together.
// The emulator itself keeps real time.
const AnimClock = {
  scale: 1, base: 0, realBase: 0,
  now() { return this.base + (performance.now() - this.realBase) * this.scale; },
  setScale(s) { this.base = this.now(); this.realBase = performance.now(); this.scale = s; },
};
function animNow() { return AnimClock.now(); }
