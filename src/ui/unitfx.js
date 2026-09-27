// On-die activity: while the trace token waits in a unit of a chip die, the unit shows its
// real work inside its own rectangle. It is a 2D canvas version of the block card
// (src/ui/blocks.js) with the same facts, drawn like the inside of the silicon: a dark
// translucent fill, thin metal lines, small cells, and bright light where the signal is.
//
//   UnitFx.draw(g, w, h, spec, u, t, reduced)
//     g        CanvasRenderingContext2D of a transparent canvas of w x h px (the unit rectangle)
//     spec     the card spec of BlockPanel.show(): { kind, col?, ...params }
//     u        progress 0..1 while the token waits (u >= 1: the final state). No internal
//              state: each call draws the state for u directly.
//     t        time in ms for the soft idle pulse; reduced: true = no idle motion
// kinds: adder logic alu shift bytes regfile decoder cells (dram rom) mux latch buffer flags
// status opcode counter text. An unknown kind draws as text; an error draws a pulse + label.

const UnitFx = (() => {
  const FONT = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
  const METAL = 'rgba(150,165,205,0.26)';
  const CELL = 'rgba(22,27,46,0.94)';
  const EDGE = 'rgba(140,155,200,0.40)';
  const DEF_COL = {
    adder: 'eu', logic: 'eu', alu: 'eu', shift: 'eu', bytes: 'data', queue: 'data', regfile: 'eu', regs: 'eu',
    decoder: 'addr', cells: 'data', dram: 'data', rom: 'data', mux: 'addr', latch: 'addr', buffer: 'data',
    flags: 'eu', status: 'ctrl', opcode: 'eu', counter: 'ctrl', text: 'eu',
    cache: 'data', bus: 'data', pipe: 'eu', rat: 'eu', rs: 'eu', rob: 'eu', port: 'eu',
  };
  const COLS = { addr: 'cyan', data: 'goldHi', ctrl: 'magenta', eu: 'phosphor', fpu: 'lavender' };

  // ---- small helpers ----------------------------------------------------------------
  const num = (v, d = 0) => {
    if (v === null || v === undefined || v === '') return d;
    const x = Math.trunc(Number(v));
    return Number.isFinite(x) ? x : d;
  };
  const maskN = n => (n >= 31 ? 0x7FFFFFFF : (1 << n) - 1);
  const norm = (v, n) => (n >= 32 ? v >>> 0 : (v & maskN(n)) >>> 0);
  const bit = (v, i) => (v >>> i) & 1;
  const seg = (u, a, b) => clamp((u - a) / (b - a), 0, 1);
  const upper = s => String(s === undefined || s === null ? '' : s).trim().toUpperCase();
  const fitS = (s, max) => {
    s = String(s === undefined || s === null ? '' : s);
    if (max < 1) return '';
    return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
  };
  // A fixed pseudo-random bit for the content of cells that the trace does not know.
  const hbit = (x, y, k) => {
    let h = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h >>> 17) & 1;
  };
  const RGB = {};
  function rgb(c) {
    let v = RGB[c];
    if (!v) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(c));
      const n = m ? parseInt(m[1], 16) : 0xFFFFFF;
      v = RGB[c] = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    }
    return v;
  }
  function ca(c, a) {
    a = a <= 0 ? 0 : a >= 1 ? 1 : Math.round(a * 1000) / 1000;
    return `rgba(${rgb(c)},${a})`;
  }

  // ---- the state of the current draw call -----------------------------------------------
  // Frame coordinates: a runs along a row of bits, c runs across it. V = true swaps them
  // on the canvas (x = c, y = a), so that one drawing fits wide and tall units.
  let G = null, V = false, OX = 0, OY = 0, COL = '#ffffff', PULSE = 0.5, FS = 11, fontNow = '';
  // the boxes of the words of the last drawing (for the tooltips): [{ x, y, w, h, s }] in canvas px
  let REGS = null, ZSC = 1;
  function setFrame(v, x, y) { V = !!v; OX = x; OY = y; }
  const fx = (a, c) => OX + (V ? c : a);
  const fy = (a, c) => OY + (V ? a : c);
  function fRect(a, c, da, dc) { if (V) G.rect(OX + c, OY + a, dc, da); else G.rect(OX + a, OY + c, da, dc); }
  const fBox = (a, c, sa, sc) => fRect(a - sa / 2, c - sc / 2, sa, sc);
  const mv = (a, c) => G.moveTo(fx(a, c), fy(a, c));
  const ln = (a, c) => G.lineTo(fx(a, c), fy(a, c));
  const qc = (a1, c1, a, c) => G.quadraticCurveTo(fx(a1, c1), fy(a1, c1), fx(a, c), fy(a, c));

  function font(px, bold) {
    const f = (bold ? '700 ' : '') + px + 'px ' + FONT;
    if (f !== fontNow) { G.font = f; fontNow = f; }
  }
  const TW = (s, px) => String(s).length * px * 0.6;   // the monospace text width
  function text(s, x, y, px, color, align, bold) {
    font(px, bold);
    G.fillStyle = color;
    G.textAlign = align || 'center';
    G.fillText(s, x, y);
    if (REGS && s) {
      const w = TW(s, px), a = align || 'center';
      REGS.push({ x: (a === 'center' ? x - w / 2 : a === 'right' ? x - w : x) * ZSC, y: (y - px * 0.6) * ZSC, w: w * ZSC, h: px * 1.2 * ZSC, s: String(s) });
    }
  }
  const fText = (s, a, c, px, color, align, bold) => text(s, fx(a, c), fy(a, c), px, color, align, bold);

  // ---- drawing primitives (frame coordinates) ---------------------------------------------
  function halo(a, c, sa, sc, color, k) {
    if (k <= 0.02) return;
    const e = Math.max(1.5, Math.min(sa, sc) * 0.5);
    G.beginPath();
    fBox(a, c, sa + 2 * e, sc + 2 * e);
    G.fillStyle = ca(color, 0.22 * k * (0.8 + 0.4 * PULSE));
    G.fill();
  }
  // One bit: v = 1 is a filled square (pale when it only stores the bit, the tone when the
  // signal is there), v = 0 is a dark square. hot 0..1: how much signal is there.
  function bitSq(a, c, s, v, hot, tone) { bitR(a, c, s, s, v, hot, tone); }
  function bitR(a, c, sa, sc, v, hot, tone) {
    tone = tone || COL;
    const s = Math.min(sa, sc);
    if (v && hot > 0.3) halo(a, c, sa, sc, tone, hot);
    G.beginPath();
    fBox(a, c, sa, sc);
    if (v) {
      G.fillStyle = hot > 0 ? ca(tone, 0.45 + 0.55 * hot) : ca(THEME.text, 0.62);
      G.fill();
    } else {
      G.fillStyle = CELL;
      G.fill();
      G.strokeStyle = hot > 0 ? ca(tone, 0.3 + 0.5 * hot) : EDGE;
      G.lineWidth = s > 8 ? 1.2 : 1;
      G.stroke();
    }
  }
  // A cell body: state 0 = off, 1 = the signal is here, 2 = done.
  function cellBox(a, c, sa, sc, state, tone) {
    tone = tone || COL;
    if (state === 1) halo(a, c, sa, sc, tone, 0.9);
    G.beginPath();
    fBox(a, c, sa, sc);
    G.fillStyle = state === 1 ? ca(tone, 0.55) : state === 2 ? ca(tone, 0.16) : CELL;
    G.fill();
    G.strokeStyle = state === 1 ? tone : state === 2 ? ca(tone, 0.6) : EDGE;
    G.lineWidth = 1;
    G.stroke();
  }
  // The path of the first fraction f of a polyline [[a, c], ...]. Returns the end point.
  function polyPath(pts, f) {
    let tot = 0;
    for (let i = 1; i < pts.length; i++) tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let rem = tot * clamp(f, 0, 1), end = pts[0];
    G.beginPath();
    mv(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (rem >= d) { ln(pts[i][0], pts[i][1]); rem -= d; end = pts[i]; continue; }
      const k = d ? rem / d : 0;
      end = [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)];
      ln(end[0], end[1]);
      break;
    }
    return end;
  }
  // A lit wire: a soft wide stroke under a bright thin stroke, lit from its start to f.
  function glowLine(pts, f, color, lw, k = 1) {
    if (f <= 0 || k <= 0) return null;
    const end = polyPath(pts, f);
    G.lineCap = 'round';
    G.lineJoin = 'round';
    G.strokeStyle = ca(color, 0.2 * k);
    G.lineWidth = lw * 3.2;
    G.stroke();
    G.strokeStyle = ca(color, k);
    G.lineWidth = lw;
    G.stroke();
    return end;
  }
  function spark(a, c, s, color) {
    halo(a, c, s, s, color, 1);
    G.beginPath();
    fBox(a, c, s * 0.7, s * 0.7);
    G.fillStyle = ca('#ffffff', 0.9);
    G.fill();
  }
  // a small triangle that points to +c (a buffer, an inverter)
  function triPath(a, c0, c1, hw) {
    G.beginPath();
    mv(a - hw, c0);
    ln(a + hw, c0);
    ln(a, c1);
    G.closePath();
  }

  // ---- the unit box: fill, texture, border, header ------------------------------------------
  function boxOf(w, h) {
    const pad = Math.max(3, Math.round(Math.min(w, h) * 0.035));
    const fs = clamp(Math.round(Math.min(w, h) * 0.05), 11, 15);
    const head = h >= 90 && w >= 100 ? fs + 7 : 0;
    return { W: w, H: h, pad, fs, head, x: pad, y: pad + head, w: w - 2 * pad, h: h - 2 * pad - head };
  }
  function base(w, h) {
    G.clearRect(0, 0, w, h);
    G.fillStyle = 'rgba(8,10,20,0.94)';   // (the unit works here: the die art under it stays dark)
    G.fillRect(0, 0, w, h);
    // faint power rails of the metal layer
    const st = Math.max(4, Math.round(Math.min(w, h) / 36));
    G.beginPath();
    for (let y = st; y < h; y += st) { G.moveTo(0, y + 0.5); G.lineTo(w, y + 0.5); }
    G.strokeStyle = 'rgba(150,165,205,0.045)';
    G.lineWidth = 1;
    G.stroke();
    G.strokeStyle = ca(COL, 0.3 + 0.25 * PULSE);
    G.lineWidth = 1.5;
    G.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
  }
  // A short label line at the top: the first left text that fits, and a bright right text
  // (the result) with the opacity ra. The right text keeps its space when ra = 0.
  function header(C, lefts, right, ra) {
    if (!C.head) return;
    const px = C.fs, y = C.pad + C.head / 2, maxW = C.W - 2 * C.pad - 2;
    let r = right ? String(right) : '';
    if (TW(r, px) > maxW) r = fitS(r, Math.floor(maxW / (px * 0.6)));
    const rW = r ? TW(r, px) : 0;
    let l = null;
    for (const s of lefts || []) if (s && TW(s, px) + (rW ? rW + px : 0) <= maxW) { l = s; break; }
    if (l) text(l, C.pad + 1, y, px, ca(THEME.text, 0.72), 'left');
    if (r && ra > 0) text(r, C.W - C.pad - 1, y, px, ca(COL, ra), 'right', true);
    G.fillStyle = 'rgba(150,165,205,0.14)';
    G.fillRect(C.pad, C.pad + C.head - 2, C.W - 2 * C.pad, 1);
  }

  // ---- bit lanes ---------------------------------------------------------------------------
  // Places n bit lanes in a box of W x H: rows of K bits (bit n-1 at the left of the top row,
  // bit 0 at the right of the bottom row), horizontal or vertical (V), with gaps between
  // nibbles. Each lane has the pitch p (along the row) and the depth D (across it).
  // o: { depth, maxDepth (in pitches), rows (max), endL, endR (room at the row ends, pitches),
  //      vert: false = never vertical, gap, rowGap, pmax }
  function lanes(n, W, H, o) {
    let best = null;
    const g = o.gap === undefined ? 0.4 : o.gap, rg = o.rowGap === undefined ? 0.6 : o.rowGap;
    for (const v of o.vert === false ? [false] : [false, true]) {
      const FW = v ? H : W, FH = v ? W : H;
      for (let R = 1; R <= (o.rows || 1); R++) {
        let K = Math.ceil(n / R);
        if (n > 8) K = Math.ceil(K / 4) * 4;
        if (Math.ceil(n / K) !== R) continue;
        const gaps = n > 8 ? Math.floor((K - 1) / 4) : 0;
        const pa = FW / (K + gaps * g + o.endL + o.endR);
        const pc = FH / (R * o.depth + (R - 1) * rg);
        const p = Math.min(pa, pc, o.pmax || 64);
        const score = p * Math.pow(0.8, R - 1) * (v ? 0.9 : 1);
        if (!best || score > best.score) best = { v, R, K, p, gaps, g, rg, FW, FH, score };
      }
    }
    const L = best, p = L.p;
    L.D = Math.min((L.FH - (L.R - 1) * L.rg * p) / L.R, p * (o.maxDepth || o.depth));
    const usedA = (L.K + L.gaps * L.g + o.endL + o.endR) * p;
    L.left = (L.FW - usedA) / 2 + o.endL * p;
    L.right = L.left + (L.K + L.gaps * L.g) * p;
    const usedC = L.R * L.D + (L.R - 1) * L.rg * p;
    L.top = (L.FH - usedC) / 2;
    L.a = i => { const j = i % L.K; return L.right - (j + 0.5) * p - (n > 8 ? Math.floor(j / 4) * L.g * p : 0); };
    L.row = i => L.R - 1 - Math.floor(i / L.K);    // 0 = the top row
    L.ct = i => L.top + L.row(i) * (L.D + L.rg * p);
    return L;
  }

  // ---- adder: a ripple-carry chain of full adders ---------------------------------------------
  function kAdder(C, s, u) {
    const n = clamp(num(s.width, 16), 2, 24);
    // spec.sub is also the subtitle text, so only a boolean true (or subtract / op) means subtract
    const sub = s.sub === true || s.subtract === true || /^(SUB|SBB|CMP|DEC|NEG)$/.test(upper(s.op));
    const a = norm(num(s.a), n), bIn = norm(num(s.b), n);
    const b = sub ? norm(~bIn, n) : bIn;
    const cin = sub ? 1 - (num(s.borrow) & 1) : (num(s.cin) & 1);
    const half0 = !sub && !cin;
    const c = [cin], sm = [];
    for (let i = 0; i < n; i++) {
      const ai = bit(a, i), bi = bit(b, i), ci = c[i];
      sm.push(ai ^ bi ^ ci);
      c.push((ai & bi) | (ai & ci) | (bi & ci));
    }
    let r = 0;
    for (let i = n - 1; i >= 0; i--) r = r * 2 + sm[i];
    const dg = Math.ceil(n / 4);
    const P = u >= 0.84 ? n : seg(u, 0.06, 0.84) * n;   // where the carry is now (in bits)
    header(C, [`${hex(a, dg)}${sub ? '-' : '+'}${hex(bIn, dg)}`, sub ? 'A-B' : 'A+B'], `=${hex(r, dg)}`, seg(u, 0.84, 0.95));

    const L = lanes(n, C.w, C.h, { depth: 3.3, maxDepth: 5.5, rows: n > 8 ? 3 : 1, endL: 1.2, endR: 0.95 });
    setFrame(L.v, C.x, C.y);
    const p = L.p, D = L.D, cw = p * 0.76, ds = clamp(p * 0.38, 2, 13);
    const GE = [];
    for (let i = 0; i < n; i++) {
      const t0 = L.ct(i);
      GE.push({ x: L.a(i), cA: t0 + D * 0.08, cB: t0 + D * 0.24, c0: t0 + D * 0.38, c1: t0 + D * 0.7, cc: t0 + D * 0.62, cS: t0 + D * 0.9 });
    }
    const route = k => {   // the carry wire from bit k-1 into bit k (k = n: carry out)
      const g0 = GE[k - 1];
      if (k >= n) return [[g0.x - cw / 2, g0.cc], [g0.x - cw / 2 - p * 0.62, g0.cc]];
      const g1 = GE[k];
      if (L.row(k) === L.row(k - 1)) return [[g0.x - cw / 2, g0.cc], [g1.x + cw / 2, g1.cc]];
      const mid = L.ct(k) + D + L.rg * p * 0.5;
      const aL = g0.x - cw / 2 - p * 0.3, aR = g1.x + cw / 2 + p * 0.3;
      return [[g0.x - cw / 2, g0.cc], [aL, g0.cc], [aL, mid], [aR, mid], [aR, g1.cc], [g1.x + cw / 2, g1.cc]];
    };
    const cinPts = [[GE[0].x + cw / 2 + p * 0.62, GE[0].cc], [GE[0].x + cw / 2, GE[0].cc]];
    // metal: input wires, sum wires, the carry chain
    G.beginPath();
    for (const e of GE) {
      mv(e.x - p * 0.17, e.cA); ln(e.x - p * 0.17, e.c0);
      mv(e.x + p * 0.17, e.cB); ln(e.x + p * 0.17, e.c0);
      mv(e.x, e.c1); ln(e.x, e.cS);
    }
    for (let k = 1; k <= n; k++) { const pts = route(k); mv(pts[0][0], pts[0][1]); for (let j = 1; j < pts.length; j++) ln(pts[j][0], pts[j][1]); }
    if (!half0) { mv(cinPts[0][0], cinPts[0][1]); ln(cinPts[1][0], cinPts[1][1]); }
    G.strokeStyle = METAL;
    G.lineWidth = Math.max(1, p * 0.06);
    G.stroke();
    // subtract: an inverter on each B wire
    if (sub) {
      const tri = Math.min(ds * 0.9, (GE[0].c0 - GE[0].cB) * 0.5);
      if (tri >= 2.5) {
        for (const e of GE) triPath(e.x + p * 0.17, e.cB + ds * 0.6, e.cB + ds * 0.6 + tri, tri * 0.55);
        G.beginPath();
        for (const e of GE) { mv(e.x + p * 0.17 - tri * 0.55, e.cB + ds * 0.6); ln(e.x + p * 0.17 + tri * 0.55, e.cB + ds * 0.6); ln(e.x + p * 0.17, e.cB + ds * 0.6 + tri); G.closePath(); }
        G.strokeStyle = ca(COL, 0.55);
        G.lineWidth = 1;
        G.stroke();
      }
    }
    // cells
    const lab = cw >= 16 && (GE[0].c1 - GE[0].c0) >= 14;
    const lpx = lab ? Math.min(14, Math.floor(Math.min(cw * 0.62, (GE[0].c1 - GE[0].c0) * 0.62))) : 0;
    for (let i = 0; i < n; i++) {
      const e = GE[i], st = P >= i + 1 ? 2 : P >= i && u > 0.06 ? 1 : 0;
      cellBox(e.x, (e.c0 + e.c1) / 2, cw, e.c1 - e.c0, st);
      if (lpx >= 11) fText(i === 0 && half0 ? 'HA' : 'FA', e.x, (e.c0 + e.c1) / 2 - (e.c1 - e.c0) * 0.12, lpx, st === 1 ? '#0b1020' : ca(THEME.text, 0.55), 'center', true);
    }
    // carries
    if (!half0) glowLine(cinPts, u > 0.02 ? 1 : 0, COL, Math.max(1.2, p * 0.08), 0.9);
    for (let k = 1; k <= n; k++) {
      const f = clamp((P - (k - 1) - 0.5) * 2, 0, 1);
      glowLine(route(k), f, COL, Math.max(1.2, p * (c[k] ? 0.1 : 0.06)), c[k] ? 1 : 0.35);
    }
    const eo = GE[n - 1];
    if (P >= n - 0.01) bitSq(eo.x - cw / 2 - p * 0.62, eo.cc, ds, c[n], 1, COL);
    // the inputs and the sum
    for (let i = 0; i < n; i++) {
      const e = GE[i], act = P >= i && P < i + 1 && u > 0.06 ? 1 : 0;
      bitSq(e.x - p * 0.17, e.cA, ds, bit(a, i), act);
      bitSq(e.x + p * 0.17, e.cB, ds, bit(b, i), act);
      const ap = clamp((P - i - 0.5) * 2, 0, 1);
      if (ap > 0) {
        G.globalAlpha = ap;
        bitSq(e.x, e.cS, ds * 1.15, sm[i], act ? 1 : 0.45, COL);
        G.globalAlpha = 1;
      } else {
        G.beginPath();
        fBox(e.x, e.cS, ds * 1.15, ds * 1.15);
        G.strokeStyle = 'rgba(140,155,200,0.18)';
        G.lineWidth = 1;
        G.stroke();
      }
    }
    // the carry signal
    if (u > 0.06 && P < n) {
      const i = Math.floor(P), fr = P - i;
      if (fr < 0.5) spark(GE[i].x, GE[i].cc, ds * 1.1, COL);
      else {
        const pts = route(i + 1);
        const end = polyPath(pts, (fr - 0.5) * 2);
        spark(end[0], end[1], ds * 1.1, COL);
      }
    }
  }

  // ---- logic: one gate for each bit ------------------------------------------------------------
  const ARITH = { ADD: 0, ADC: 0, INC: 0, SUB: 1, SBB: 1, CMP: 1, DEC: 1, NEG: 1 };
  function gatePath(type, a, c0, c1, hw) {
    const Lc = c1 - c0;
    G.beginPath();
    if (type === 'and') {
      mv(a - hw, c0); ln(a + hw, c0); ln(a + hw, c0 + Lc * 0.4);
      qc(a + hw, c1, a, c1); qc(a - hw, c1, a - hw, c0 + Lc * 0.4);
      G.closePath();
    } else if (type === 'or' || type === 'xor') {
      mv(a - hw, c0); qc(a, c0 + Lc * 0.3, a + hw, c0);
      qc(a + hw, c0 + Lc * 0.62, a, c1); qc(a - hw, c0 + Lc * 0.62, a - hw, c0);
      G.closePath();
    } else if (type === 'not') {
      const rr = Lc * 0.12;
      mv(a - hw, c0); ln(a + hw, c0); ln(a, c1 - 2 * rr); G.closePath();
      const x = fx(a, c1 - rr), y = fy(a, c1 - rr);
      G.moveTo(x + rr, y);
      G.arc(x, y, rr, 0, Math.PI * 2);
    } else fRect(a - hw, c0, 2 * hw, Lc);
  }
  function kLogic(C, s, u) {
    const opn = upper(s.op || 'AND');
    if (opn in ARITH) {
      const a = num(s.a), b = num(s.b, 1);
      return kAdder(C, {
        width: s.width, a: opn === 'NEG' ? 0 : a, b: opn === 'NEG' ? a : (opn === 'INC' || opn === 'DEC') ? 1 : b,
        sub: ARITH[opn] === 1, cin: opn === 'ADC' ? s.cin : 0, borrow: opn === 'SBB' ? num(s.cin, num(s.borrow)) : 0,
      }, u);
    }
    const type = { AND: 'and', TEST: 'and', OR: 'or', XOR: 'xor', NOT: 'not' }[opn] || 'box';
    const one = type === 'not';
    const n = clamp(num(s.width, 16), 1, 24);
    const a = norm(num(s.a), n), b = norm(num(s.b), n);
    const r = norm(type === 'and' ? a & b : type === 'or' ? a | b : type === 'xor' ? a ^ b : type === 'not' ? ~a : num(s.r), n);
    const dg = Math.max(1, Math.ceil(n / 4));
    const opS = fitS(opn || 'ALU', 5);
    header(C, [one ? `NOT ${hex(a, dg)}` : `${hex(a, dg)} ${opS} ${hex(b, dg)}`, opS], `=${hex(r, dg)}`, seg(u, 0.8, 0.92));
    const L = lanes(n, C.w, C.h, { depth: 3.2, maxDepth: 5, rows: n > 8 ? 2 : 1, endL: 0.3, endR: 0.3 });
    setFrame(L.v, C.x, C.y);
    const p = L.p, D = L.D, ds = clamp(p * 0.38, 2, 13), hw = p * 0.34;
    const eIn = seg(u, 0, 0.25), inHot = eIn * (1 - seg(u, 0.5, 0.65));
    G.beginPath();
    for (let i = 0; i < n; i++) {
      const x = L.a(i), t0 = L.ct(i);
      if (one) { mv(x, t0 + D * 0.08); ln(x, t0 + D * 0.38); } else {
        mv(x - p * 0.17, t0 + D * 0.08); ln(x - p * 0.17, t0 + D * 0.38);
        mv(x + p * 0.17, t0 + D * 0.24); ln(x + p * 0.17, t0 + D * 0.38);
      }
      mv(x, t0 + D * 0.68); ln(x, t0 + D * 0.88);
    }
    G.strokeStyle = METAL;
    G.lineWidth = Math.max(1, p * 0.06);
    G.stroke();
    for (let i = 0; i < n; i++) {
      const x = L.a(i), t0 = L.ct(i), rb = bit(r, i);
      const w0 = 0.25 + 0.25 * (i / n), ge = seg(u, w0, w0 + 0.2), oe = seg(u, w0 + 0.2, w0 + 0.3);
      if (one) bitSq(x, t0 + D * 0.1, ds, bit(a, i), inHot);
      else { bitSq(x - p * 0.17, t0 + D * 0.08, ds, bit(a, i), inHot); bitSq(x + p * 0.17, t0 + D * 0.24, ds, bit(b, i), inHot); }
      const g0 = t0 + D * 0.38, g1 = t0 + D * 0.68;
      if (type === 'xor') {
        G.beginPath();
        mv(x - hw, g0 - (g1 - g0) * 0.14); qc(x, g0 + (g1 - g0) * 0.14, x + hw, g0 - (g1 - g0) * 0.14);
        G.strokeStyle = ge > 0 ? ca(COL, 0.4 + 0.5 * ge) : EDGE;
        G.lineWidth = 1;
        G.stroke();
      }
      if (ge > 0 && ge < 1) halo(x, (g0 + g1) / 2, hw * 2, g1 - g0, COL, rb ? 0.8 : 0.3);
      gatePath(type, x, g0, g1, hw);
      G.fillStyle = ge > 0 ? (rb ? ca(COL, 0.2 + 0.4 * ge) : ca(COL, 0.08 * ge)) : CELL;
      G.fill();
      G.strokeStyle = ge > 0 ? ca(COL, 0.45 + 0.5 * ge) : EDGE;
      G.lineWidth = 1;
      G.stroke();
      if (oe > 0) {
        glowLine([[x, g1], [x, t0 + D * 0.86]], oe, COL, Math.max(1, p * 0.07), rb ? 1 : 0.3);
        G.globalAlpha = oe;
        bitSq(x, t0 + D * 0.9, ds * 1.15, rb, u < 0.95 ? 1 : 0.5, COL);
        G.globalAlpha = 1;
      }
    }
  }

  // ---- shift / rotate: the bits move in a row of cells -------------------------------------------
  const SHIFT_OPS = new Set(['SHL', 'SHR', 'SAR', 'ROL', 'ROR', 'RCL', 'RCR']);
  function kShift(C, s, u) {
    let opn = upper(s.op || 'SHL');
    if (opn === 'SAL') opn = 'SHL';
    if (!SHIFT_OPS.has(opn)) opn = 'SHL';
    const n = clamp(num(s.width, 16), 2, 24), m = maskN(n);
    const count = clamp(num(s.count, 1), 0, 64);
    const left = opn === 'SHL' || opn === 'ROL' || opn === 'RCL';
    const a = norm(num(s.a), n);
    const run = cf0 => {
      const st = [{ v: a, cf: cf0, inb: 0 }];
      let v = a;
      for (let k = 0; k < count; k++) {
        let out, inb;
        const cf = st[k].cf;
        if (left) {
          out = bit(v, n - 1);
          inb = opn === 'SHL' ? 0 : opn === 'ROL' ? out : cf;
          v = (((v << 1) & m) | inb) >>> 0;
        } else {
          out = v & 1;
          inb = opn === 'SHR' ? 0 : opn === 'SAR' ? bit(v, n - 1) : opn === 'ROR' ? out : cf;
          v = ((v >>> 1) | (inb << (n - 1))) >>> 0;
        }
        st.push({ v, cf: out, inb });
      }
      return st;
    };
    let cf0 = num(s.cf, -1);
    if (cf0 < 0) {
      cf0 = 0;
      if ((opn === 'RCL' || opn === 'RCR') && s.r !== undefined && s.r !== null && count) {
        if (run(0)[count].v !== norm(num(s.r), n) && run(1)[count].v === norm(num(s.r), n)) cf0 = 1;
      }
    }
    cf0 &= 1;
    const st = run(cf0);
    const dg = Math.ceil(n / 4);
    header(C, [`${opn} ${count}`], `=${hex(st[count].v, dg)} CF${st[count].cf}`, seg(u, 0.9, 0.98));
    const L = lanes(n, C.w, C.h, { depth: 2.2, maxDepth: 5, rows: 1, endL: 1.6, endR: 1.6 });
    setFrame(L.v, C.x, C.y);
    const p = L.p, D = L.D, t0 = L.ct(0);
    const cy = t0 + D * 0.42, sh = Math.min(D * 0.46, p * 2.2), sw = p * 0.86, ts = Math.min(p * 0.62, sh * 0.78), th = Math.min(sh * 0.8, ts * 2.4);
    const exitI = left ? n - 1 : 0, entryI = left ? 0 : n - 1;
    const cfA = left ? L.a(n - 1) - 1.3 * p : L.a(0) + 1.3 * p;
    const srcA = left ? L.a(0) + 1.3 * p : L.a(n - 1) - 1.3 * p;
    const loopC = t0 + D * 0.86, topC = t0 + D * 0.06;
    let loop = null;
    if (opn === 'ROL' || opn === 'ROR') loop = [[L.a(exitI), cy + sh / 2], [L.a(exitI), loopC], [srcA, loopC], [srcA, cy + sh / 2]];
    else if (opn === 'RCL' || opn === 'RCR') loop = [[cfA, cy + sh / 2], [cfA, loopC], [srcA, loopC], [srcA, cy + sh / 2]];
    else if (opn === 'SAR') loop = [[L.a(n - 1), cy - sh / 2], [L.a(n - 1), topC], [srcA, topC], [srcA, cy - sh / 2]];
    // slots, the CF cell and the source cell
    G.beginPath();
    for (let i = 0; i < n; i++) fBox(L.a(i), cy, sw, sh);
    G.fillStyle = 'rgba(16,20,34,0.9)';
    G.fill();
    G.strokeStyle = EDGE;
    G.lineWidth = 1;
    G.stroke();
    if (loop) {
      G.beginPath();
      mv(loop[0][0], loop[0][1]);
      for (let j = 1; j < loop.length; j++) ln(loop[j][0], loop[j][1]);
      G.strokeStyle = METAL;
      G.lineWidth = Math.max(1, p * 0.07);
      G.stroke();
    }
    G.beginPath();
    fBox(srcA, cy, sw, sh);
    G.setLineDash([2, 2]);
    G.strokeStyle = EDGE;
    G.stroke();
    G.setLineDash([]);
    const P0 = count ? seg(u, 0.08, 0.9) * count : 0;
    const sI = count ? Math.min(Math.floor(P0), count - 1) : 0;
    const f = count ? easeInOut(clamp(P0 - sI, 0, 1)) : 0;
    const cur = st[sI], nxt = st[Math.min(sI + 1, count)];
    const moving = f > 0 && f < 1;
    cellBox(cfA, cy, sw * 1.1, sh * 1.1, moving ? 1 : u >= 0.9 ? 2 : 0);
    const lpx = Math.min(14, Math.floor(p * 0.5));
    if (lpx >= 11 && sh * 0.35 + D * 0.2 > lpx) fText('CF', cfA, cy - sh / 2 - lpx * 0.7, lpx, ca(THEME.text, 0.6));
    if (loop && moving) glowLine(loop, f, COL, Math.max(1.2, p * 0.08), 0.8);
    // the old CF leaves; the bits move one place; the out bit goes into CF; a new bit comes in
    if (count) {
      G.globalAlpha = 1 - f;
      bitR(cfA, cy, ts, th, cur.cf, 0.3, COL);
      G.globalAlpha = 1;
    } else bitR(cfA, cy, ts, th, cf0, 0.3, COL);
    for (let i = 0; i < n; i++) {
      const v = bit(cur.v, i);
      const j = left ? i + 1 : i - 1;
      const x = !count ? L.a(i) : i === exitI ? lerp(L.a(i), cfA, f) : lerp(L.a(i), L.a(j), f);
      bitR(x, cy, ts, th, v, i === exitI && moving ? 1 : moving ? 0.6 : u >= 0.9 ? 0.35 : 0, COL);
    }
    if (count && (f > 0 || u > 0.08)) bitR(lerp(srcA, L.a(entryI), f), cy, ts, th, nxt.inb, moving ? 1 : 0.35, COL);
  }

  // ---- bytes: the prefetch queue ---------------------------------------------------------------
  function kBytes(C, s, u) {
    const cells = (Array.isArray(s.cells) ? s.cells : []).slice(0, 16)
      .map(x => (x && typeof x === 'object' ? { v: num(x.v) & 0xFF } : { v: num(x) & 0xFF }));
    const take = new Set((Array.isArray(s.take) ? s.take : []).map(Number));
    const put = new Set((Array.isArray(s.put) ? s.put : []).map(Number));
    const init = [], fin = [];
    cells.forEach((c, i) => { if (!put.has(i)) init.push(i); if (!take.has(i)) fin.push(i); });
    const cap = clamp(Math.max(num(s.cap, 6), init.length, fin.length), 1, 16);
    const wT = take.size ? [0.02, 0.45] : null;
    const wS = take.size ? [0.4, 0.65] : [0.05, 0.3];
    const wP = take.size ? [0.55, 0.95] : [0.1, 0.8];
    const nowN = u >= 0.95 ? fin.length : init.length;
    header(C, [take.size ? `TAKE ${take.size}` : put.size ? `PUT ${put.size}` : cells.length ? 'QUEUE' : 'EMPTY'], `${nowN}/${cap}`, 1);
    const vert = C.h > C.w * 1.4;
    setFrame(vert, C.x, C.y);
    const FW = vert ? C.h : C.w, FH = vert ? C.w : C.h;
    const p = Math.min(FW / (cap + 0.9), FH / 1.5);
    const SH = Math.min(FH * 0.94, p * 6), c0 = (FH - SH) / 2, tw = p * 0.84;
    const left = (FW - cap * p) / 2;
    const slotA = k => left + (k + 0.5) * p;
    // the hex label of a byte: under the bits (horizontal) or after them (vertical)
    const lpx = Math.min(15, Math.max(11, Math.floor(p * 0.34)));
    const labOK = vert ? tw >= lpx + 2 && SH >= 8 * 5 + TW('00', lpx) + 8 : tw >= TW('00', lpx) + 3 && SH >= 8 * 5 + lpx + 8;
    const labL = labOK ? (vert ? TW('00', lpx) + 6 : lpx + 5) : 0;
    const bp = Math.min(tw * 0.62, (SH - labL - SH * 0.08) / 8.4);
    const bs = Math.max(2, bp * 0.76), bw = Math.max(2, Math.min(tw * 0.62, bs * 2.2));
    const bitC = k => c0 + SH * 0.05 + (7 - k + 0.5) * bp;   // bit 7 first
    const labC = c0 + SH * 0.05 + 8 * bp + labL / 2;
    // bus stubs: in from the bus side (the far end), out to the decoder side (a = 0)
    const inOn = put.size && u > wP[0] && u < wP[1], outOn = take.size && u > wT[0] && u < wT[1];
    const mid = FH / 2;
    G.beginPath();
    mv(0, mid); ln(slotA(0) - p / 2, mid);
    mv(slotA(cap - 1) + p / 2, mid); ln(FW, mid);
    G.strokeStyle = METAL;
    G.lineWidth = Math.max(1.5, p * 0.08);
    G.stroke();
    if (outOn) glowLine([[slotA(0) - p / 2, mid], [0, mid]], 1, THEME.phosphor, Math.max(1.5, p * 0.08), 0.9);
    if (inOn) glowLine([[FW, mid], [slotA(cap - 1) + p / 2, mid]], 1, COL, Math.max(1.5, p * 0.08), 0.9);
    // empty slots
    G.beginPath();
    for (let k = 0; k < cap; k++) fRect(slotA(k) - tw / 2, c0, tw, SH);
    G.setLineDash([3, 3]);
    G.strokeStyle = 'rgba(140,155,200,0.3)';
    G.lineWidth = 1;
    G.stroke();
    G.setLineDash([]);
    if (!cells.length) {   // a jump: the queue is empty
      const fl = 1 - seg(u, 0, 0.5);
      if (fl > 0) {
        G.beginPath();
        for (let k = 0; k < cap; k++) fRect(slotA(k) - tw / 2, c0, tw, SH);
        G.fillStyle = ca(COL, 0.22 * fl);
        G.fill();
      }
      return;
    }
    const putShift = put.size ? cap + 0.6 - Math.min(...[...put].map(i => fin.indexOf(i)).filter(k => k >= 0)) : 0;
    G.save();
    try {
      G.beginPath();
      G.rect(C.x, C.y, C.w, C.h);
      G.clip();
      cells.forEach((cl, i) => {
        let x, o = 1, hot = 0, tone = COL;
        const x0 = put.has(i) ? slotA(fin.indexOf(i) + putShift) : slotA(init.indexOf(i));
        const x1 = take.has(i) ? slotA(init.indexOf(i) - take.size - 0.6) : slotA(fin.indexOf(i));
        if (take.has(i)) {
          const e = seg(u, wT[0], wT[1]);
          x = lerp(x0, x1, easeInOut(seg(e, 0.15, 0.9)));
          o = 1 - seg(e, 0.85, 1);
          hot = e > 0 && e < 1 ? 1 : 0;
          tone = THEME.phosphor;
        } else if (put.has(i)) {
          const e = seg(u, wP[0], wP[1]);
          x = lerp(x0, x1, easeInOut(e));
          hot = e < 1 ? 1 : 0.4;
        } else x = lerp(x0, x1, easeInOut(seg(u, wS[0], wS[1])));
        if (o <= 0) return;
        G.globalAlpha = o;
        if (hot > 0.5) halo(x, c0 + SH / 2, tw, SH, tone, 0.6);
        G.beginPath();
        fRect(x - tw / 2, c0, tw, SH);
        G.fillStyle = hot ? ca(tone, 0.14) : 'rgba(26,31,52,0.95)';
        G.fill();
        G.strokeStyle = hot ? ca(tone, 0.9) : ca(COL, 0.4);
        G.lineWidth = 1;
        G.stroke();
        for (let k = 7; k >= 0; k--) bitR(x, bitC(k), V ? bs : bw, V ? bw : bs, bit(cl.v, k), hot ? hot : 0, tone);
        if (labOK) fText(hex2(cl.v), x, labC, lpx, hot ? tone : ca(THEME.text, 0.85), 'center', true);
        G.globalAlpha = 1;
      });
    } finally { G.restore(); }
  }

  // ---- register file: word lines (rows), bit lines (columns), a bus at the bottom ------------------
  const REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
  function kRegs(C, s, u) {
    let regs = Array.isArray(s.regs) && s.regs.length ? s.regs : REG16.map(nm => ({ name: nm, v: 0 }));
    regs = regs.slice(0, 12).map(r => (r && typeof r === 'object' ? { name: upper(r.name) || '?', v: num(r.v) & 0xFFFF } : { name: upper(r), v: 0 }));
    const find = nm => {
      nm = upper(nm);
      let i = regs.findIndex(r => r.name === nm);
      if (i >= 0) return { i, half: null };
      if (/^[ABCD][LH]$/.test(nm)) {
        i = regs.findIndex(r => r.name === nm[0] + 'X');
        if (i >= 0) return { i, half: nm[1] };
      }
      return null;
    };
    const w = s.write ? find(s.write) : null;
    const readL = (Array.isArray(s.read) ? s.read : s.read ? [s.read] : []).map(upper);
    const reads = readL.map(find).filter(Boolean);
    const oldV = w ? regs[w.i].v : 0;
    let newV = num(s.v) & 0xFFFF;
    if (w && w.half === 'L') newV = (oldV & 0xFF00) | (num(s.v) & 0xFF);
    if (w && w.half === 'H') newV = (oldV & 0x00FF) | ((num(s.v) & 0xFF) << 8);
    const wMask = !w ? 0 : w.half === 'L' ? 0x00FF : w.half === 'H' ? 0xFF00 : 0xFFFF;
    const wTxt = w ? `${upper(s.write)}←${w.half ? hex2(num(s.v)) : hex4(newV)}` : '';
    const rTxt = readL.length ? `READ ${readL.join(' ')}` : '';
    header(C, w ? [wTxt] : [rTxt], w ? rTxt : '', 0.85);
    const nR = regs.length;
    let best = null;
    for (const CC of nR >= 6 ? [1, 2] : [1]) {
      const RP = Math.ceil(nR / CC);
      const colW = (C.w - (CC - 1) * 8) / CC;
      const rh = C.h / (RP + 0.55);
      const lab = rh >= 12 && colW >= 100;
      const npx = lab ? clamp(Math.floor(Math.min(rh * 0.62, colW / 9)), 11, 15) : 0;
      const nameW = lab ? TW('XX', npx) + 6 : 0;
      const bp = (colW - nameW - 2) / (16 + 3 * 0.4);
      const sz = Math.min(bp * 0.8, rh * 0.64);
      const score = sz * (CC === 2 ? 0.8 : 1);
      if (!best || score > best.score) best = { CC, RP, colW, rh, lab, npx, nameW, bp, sz, score };
    }
    const { CC, RP, colW, rh, lab, npx, nameW, bp, sz } = best;
    const szH = Math.min(rh * 0.6, sz * 1.6);
    const rw = reads.length ? [0.02, 0.5] : null;
    const ww = reads.length ? [0.45, 0.95] : [0.05, 0.9];
    const ew = w ? seg(u, ww[0], ww[1]) : 0;
    setFrame(false, 0, 0);
    for (let cb = 0; cb < CC; cb++) {
      const x0 = C.x + cb * (colW + 8), bx0 = x0 + nameW;
      const bx = i => bx0 + (15 - i + 0.5) * bp + Math.floor((15 - i) / 4) * 0.4 * bp;
      const rows = [];
      for (let k = 0; k < RP; k++) if (cb * RP + k < nR) rows.push(cb * RP + k);
      if (!rows.length) continue;
      const ry = i => C.y + (i - cb * RP + 0.5) * rh;
      const yTop = C.y + rh * 0.15, yBus = C.y + rows.length * rh + rh * 0.3;
      const xL = bx(15) - bp / 2, xR = bx(0) + bp / 2;
      // metal: bit lines, word lines, the bus
      G.beginPath();
      for (let i = 0; i < 16; i++) { G.moveTo(bx(i), yTop); G.lineTo(bx(i), yBus); }
      for (const i of rows) { G.moveTo(xL - 2, ry(i)); G.lineTo(xR + 2, ry(i)); }
      G.strokeStyle = METAL;
      G.lineWidth = 1;
      G.stroke();
      G.fillStyle = 'rgba(150,165,205,0.3)';
      G.fillRect(xL, yBus - 1.5, xR - xL, 3);
      // reads: the word line opens the row, the 1 bits go down the bit lines to the bus
      for (const rd of reads) {
        if (rows.indexOf(rd.i) < 0) continue;
        const er = seg(u, rw[0], rw[1]), v = regs[rd.i].v, fade = 1 - 0.6 * seg(u, 0.5, 0.62);
        glowLine([[xL - 2, ry(rd.i)], [xR + 2, ry(rd.i)]], seg(er, 0, 0.3), COL, 1.5, 0.8 * fade);
        const fb = seg(er, 0.3, 0.8);
        if (fb > 0) {
          const mk = rd.half === 'L' ? 0x00FF : rd.half === 'H' ? 0xFF00 : 0xFFFF;
          for (let i = 0; i < 16; i++) if (bit(v & mk, i)) glowLine([[bx(i), ry(rd.i)], [bx(i), yBus]], fb, COL, 1.3, 0.8 * fade);
          if (fb >= 1) glowLine([[xL, yBus], [xR, yBus]], 1, COL, 2, 0.6 * fade);
        }
      }
      // the write: the new 1 bits come up the bit lines, the word line opens, the cells flip
      if (w && rows.indexOf(w.i) >= 0 && ew > 0) {
        const yy = ry(w.i), fade = 1 - 0.7 * seg(ew, 0.85, 1);
        G.fillStyle = ca(COL, 0.12 * seg(ew, 0.25, 0.45));
        G.fillRect(xL - 3, yy - rh * 0.45, xR - xL + 6, rh * 0.9);
        const fb = seg(ew, 0, 0.3);
        if (fb > 0) {
          glowLine([[xL, yBus], [xR, yBus]], 1, COL, 2, 0.6 * fade);
          for (let i = 0; i < 16; i++) if (bit(newV & wMask, i)) glowLine([[bx(i), yBus], [bx(i), yy]], fb, COL, 1.3, 0.85 * fade);
        }
        glowLine([[xL - 2, yy], [xR + 2, yy]], seg(ew, 0.25, 0.45), COL, 1.8, 0.95);
      }
      // cells
      for (const i of rows) {
        const yy = ry(i), isW = w && w.i === i, rd = reads.find(r => r.i === i);
        const rdHot = rd ? seg(seg(u, rw[0], rw[1]), 0.2, 0.4) * (1 - 0.5 * seg(u, 0.5, 0.62)) : 0;
        for (let k = 0; k < 16; k++) {
          let v = bit(regs[i].v, k), hot = rdHot;
          if (isW) {
            const th = 0.45 + 0.4 * (15 - k) / 15;
            if (ew >= th) {
              v = bit(newV, k);
              hot = bit((oldV ^ newV) & wMask, k) ? 1 - 0.6 * seg(ew, th, th + 0.2) : 0.35;
            } else if (ew > 0.3) hot = Math.max(hot, 0.2);
          }
          bitR(bx(k), yy, sz, szH, v, hot, COL);
        }
        if (lab) {
          const on = isW || rd;
          fText(regs[i].name, x0 + 1, yy, npx, on ? COL : ca(THEME.text, 0.55), 'left', !!on);
        }
      }
    }
  }

  // ---- decoder matrix (decoder, status) -------------------------------------------------------
  // Each input bit drives a true line and a complement line. Each output line has a transistor
  // on the matching line of each input bit. All lines charge; a line with a transistor on a
  // dark line goes dark; the one line that matches stays high (one-hot).
  //   o: { n, inV, N, code(k), sel (index or -1), vert, label(k) | null, labW, ph: phases, tone }
  function matrix(C, o, u) {
    const n = o.n, N = o.N, ph = o.ph;
    setFrame(o.vert, C.x, C.y);
    const FW = o.vert ? C.h : C.w, FH = o.vert ? C.w : C.h;
    const labW = o.labW || 0, avC = FH - labW;
    const lp = clamp(avC * (n <= 4 ? 0.4 : 0.5) / (2 * n), 1.5, n <= 4 ? 16 : 10);
    const bs = clamp(lp * 1.7, 3, 22);
    const inW = bs + clamp(lp * 1.4, 2, 9) + 3;
    const cT = Math.max(1.5, lp * 0.3);
    const avA = FW - inW - 3;
    let M = N, start = 0, pre = 0, post = 0;
    const maxM = clamp(Math.floor(avA / 3.4), 4, 64);
    if (N > maxM) {
      M = Math.max(4, maxM - 4);
      start = clamp((o.sel >= 0 ? o.sel : 0) - Math.floor(M / 2), 0, N - M);
      pre = start > 0 ? 2 : 0;
      post = start + M < N ? 2 : 0;
    }
    const op = avA / (M + pre + post);
    const ak = k => inW + 3 + (k + pre + 0.5) * op;   // k: index in the window (may be < 0 or >= M)
    const dsz = clamp(Math.min(op, lp) * 0.72, 1.5, 7);
    const cOut = avC - dsz - 3;
    const rowC = r => cT + (r + 0.5) * lp;
    const eIn = seg(u, ph.in[0], ph.in[1]), ePre = seg(u, ph.pre[0], ph.pre[1]), eDis = seg(u, ph.dis[0], ph.dis[1]);
    const eSel = seg(u, ph.sel[0], ph.sel[1]), eOut = seg(u, ph.out[0], ph.out[1]);
    const lwO = clamp(op * 0.28, 0.8, 2.5), lwL = clamp(lp * 0.3, 0.8, 2.5);
    const selK = o.sel >= 0 ? o.sel - start : -99;
    // metal: literal lines, output lines, fading lines past the window
    G.beginPath();
    for (let r = 0; r < 2 * n; r++) { mv(inW + 1, rowC(r)); ln(FW, rowC(r)); }
    G.strokeStyle = METAL;
    G.lineWidth = lwL;
    G.stroke();
    G.beginPath();
    for (let k = 0; k < M; k++) { mv(ak(k), cT - 1); ln(ak(k), cOut); }
    G.strokeStyle = METAL;
    G.lineWidth = lwO;
    G.stroke();
    for (let q = 1; q <= 2; q++) {
      G.beginPath();
      if (pre) { mv(ak(-q), cT - 1); ln(ak(-q), cOut); }
      if (post) { mv(ak(M - 1 + q), cT - 1); ln(ak(M - 1 + q), cOut); }
      G.strokeStyle = `rgba(150,165,205,${q === 1 ? 0.16 : 0.07})`;
      G.stroke();
    }
    // inputs: the bit, a wire to its true line, an inverter to its complement line
    for (let j = 0; j < n; j++) {
      const m2 = 2 * (n - 1 - j), v = bit(o.inV, j), cc = cT + (m2 + 1) * lp;
      G.beginPath();
      mv(1 + bs, cc); ln(inW - 1, rowC(m2)); ln(inW + 1, rowC(m2));
      mv(1 + bs, cc); ln(inW - 1, rowC(m2 + 1)); ln(inW + 1, rowC(m2 + 1));
      G.strokeStyle = METAL;
      G.lineWidth = 1;
      G.stroke();
      bitSq(1 + bs / 2, cc, bs, v, eIn * (1 - 0.5 * seg(u, 0.9, 1)), o.tone);
      glowLine([[inW + 1, rowC(v ? m2 : m2 + 1)], [FW, rowC(v ? m2 : m2 + 1)]], eIn, o.tone || COL, lwL, 0.8);
    }
    // output lines: charge, then the lines that do not match go dark
    if (ePre > 0) {
      G.beginPath();
      for (let k = 0; k < M; k++) if (k !== selK) { mv(ak(k), cT - 1); ln(ak(k), cOut); }
      G.strokeStyle = ca(COL, 0.42 * ePre * (1 - eDis));
      G.lineWidth = lwO;
      G.stroke();
      if (selK >= 0 && selK < M) {
        G.beginPath();
        mv(ak(selK), cT - 1); ln(ak(selK), cOut);
        G.strokeStyle = ca(COL, 0.42 * ePre);
        G.stroke();
      }
    }
    // transistors: bright on a lit line, dim on a dark line
    G.beginPath();
    let any = false;
    for (let k = 0; k < M; k++) {
      if (k === selK) continue;
      const code = o.code(start + k);
      for (let j = 0; j < n; j++) if (bit(code, j) !== bit(o.inV, j)) { fBox(ak(k), rowC(2 * (n - 1 - j) + (bit(code, j) ? 0 : 1)), dsz, dsz); any = true; }
    }
    if (any) { G.fillStyle = 'rgba(150,165,205,0.42)'; G.fill(); }
    G.beginPath();
    any = false;
    for (let k = 0; k < M; k++) {
      if (k === selK) continue;
      const code = o.code(start + k);
      for (let j = 0; j < n; j++) if (bit(code, j) === bit(o.inV, j)) { fBox(ak(k), rowC(2 * (n - 1 - j) + (bit(code, j) ? 0 : 1)), dsz, dsz); any = true; }
    }
    if (any) { G.fillStyle = eIn > 0 ? ca(o.tone || COL, 0.3 + 0.4 * eIn) : 'rgba(150,165,205,0.42)'; G.fill(); }
    if (selK >= 0 && selK < M) {
      const x = ak(selK), code = o.code(o.sel);
      glowLine([[x, cT - 1], [x, cOut]], eSel, COL, lwO * 1.5, 1);
      for (let j = 0; j < n; j++) {
        const c = rowC(2 * (n - 1 - j) + (bit(code, j) ? 0 : 1));
        if (eSel > 0) halo(x, c, dsz, dsz, COL, eSel);
        G.beginPath();
        fBox(x, c, dsz, dsz);
        G.fillStyle = eSel > 0 ? ca('#ffffff', 0.5 + 0.5 * eSel) : eIn > 0 ? ca(o.tone || COL, 0.3 + 0.4 * eIn) : 'rgba(150,165,205,0.42)';
        G.fill();
      }
      bitSq(x, cOut + dsz / 2 + 1.5, dsz * 1.3, 1, eOut > 0 ? eOut : 0.15, COL);
      if (eOut > 0 && o.onOut) o.onOut(x, cOut + dsz + 3, eOut);
    }
    // labels at the ends of the output lines (vertical frame only)
    if (o.label && labW > 0) {
      const px = C.fs;
      const all = op >= px * 0.95;
      for (let k = 0; k < M; k++) {
        if (!all && k !== selK) continue;
        const s = o.label(start + k), on = k === selK;
        fText(s, ak(k), avC + 3, px, on ? ca(COL, 0.45 + 0.55 * eOut) : ca(THEME.text, 0.45), 'left', on && eOut > 0);
      }
    }
  }
  function kDecoder(C, s, u) {
    const n = clamp(num(s.bits, 3), 1, 9), N = 1 << n, sel = norm(num(s.value), n);
    const dg = Math.max(1, Math.ceil(n / 4));
    const inL = upper(fitS(s.inLabel || 'IN', 14));
    header(C, [`${inL} ${hex(sel, dg)}h`, `IN ${hex(sel, dg)}h`], `LINE ${hex(sel, dg)}h`, seg(u, 0.82, 0.92));
    const vert = C.h > C.w;
    const labW = vert && C.w >= 90 ? TW('0'.repeat(dg) + 'h', C.fs) + 6 : 0;
    matrix(C, {
      n, inV: sel, N, code: k => k, sel, vert, label: k => hex(k, dg) + 'h', labW,
      ph: { in: [0, 0.3], pre: [0.25, 0.4], dis: [0.4, 0.55], sel: [0.5, 0.82], out: [0.82, 0.9] },
    }, u);
  }
  // 8288 / 82288 status decoder: S2 S1 S0 select one bus cycle; its command goes active
  const S8288 = [
    { code: '000', cmd: 'INTA' }, { code: '001', cmd: 'IORC' }, { code: '010', cmd: 'IOWC' }, { code: '011', cmd: '' },
    { code: '100', cmd: 'MRDC' }, { code: '101', cmd: 'MRDC' }, { code: '110', cmd: 'MWTC' }, { code: '111', cmd: '' },
  ];
  function kStatus(C, s, u) {
    const code = (typeof s.code === 'number' ? bin(s.code & 7, 3) : String(s.code === undefined ? '101' : s.code)).replace(/[^01]/g, '').padStart(3, '0').slice(-3);
    const rows = (Array.isArray(s.rows) && s.rows.length ? s.rows : S8288).slice(0, 10).map(r => ({
      code: String(r.code === undefined ? '' : r.code).replace(/[^01]/g, '').padStart(3, '0').slice(-3),
      cmd: String(r.cmd || '').split(/[,\s]+/)[0].replace(/[—-]+/g, '') || '',
    }));
    const mi = rows.findIndex(r => r.code === code);
    const m = mi >= 0 ? rows[mi] : null;
    header(C, [`${upper(fitS(s.label || 'S2 S1 S0', 10))} ${code}`, code], m ? m.cmd || 'NO CMD' : '', seg(u, 0.55, 0.7));
    const vert = C.w < C.h * 2.6;
    const maxL = Math.max(1, ...rows.map(r => (r.cmd || '-').length));
    let labW = vert && C.w >= 110 ? TW('X'.repeat(maxL), C.fs) + 8 : 0;
    if (labW > C.w * 0.45) labW = 0;
    matrix(C, {
      n: 3, inV: parseInt(code, 2), N: rows.length, code: k => parseInt(rows[k].code, 2), sel: mi, vert,
      label: k => rows[k].cmd || '-', labW, tone: COL,
      ph: { in: [0, 0.25], pre: [0.2, 0.3], dis: [0.3, 0.45], sel: [0.42, 0.6], out: [0.55, 0.8] },
    }, u);
  }

  // ---- memory cell array (DRAM, ROM) -------------------------------------------------------------
  function kCells(C, s, u) {
    const memS = String(s.mem || s.cell || s.type || s.tech || 'dram').toLowerCase();
    const rom = memS.includes('rom');
    let Rn = clamp(num(s.rows, 8), 2, 16), Cn = clamp(num(s.cols, 8), 2, 16);
    Rn = Math.max(Rn, Math.min(16, Math.floor(C.h / 20)));
    Cn = Math.max(Cn, Math.min(16, Math.floor(C.w / 20)));
    // a wide array gets more columns, so that the cells stay square
    Cn = clamp(Math.floor(C.w / (C.h / (Rn + (rom ? 1.4 : 1.8))) - 0.85), Cn, 32);
    const row = clamp(num(s.row, Rn >> 1), 0, Rn - 1), col = clamp(num(s.col, Cn >> 1), 0, Cn - 1);
    const write = !!s.write && !rom;
    const val = Math.max(0, num(s.bit, 1)), b0 = val & 1;
    const vTxt = val > 1 ? hex2(val) + 'h' : String(val);
    const rl = s.rowLabel ? String(s.rowLabel) : String(row), cl = s.colLabel ? String(s.colLabel) : String(col);
    header(C, [`ROW ${rl} COL ${cl}`, `R${rl} C${cl}`, `R${rl}`], write ? `IN ${vTxt}` : `OUT ${vTxt}`, write ? seg(u, 0.2, 0.3) : seg(u, 0.85, 0.95));
    setFrame(false, 0, 0);
    const drvW = 0.75, botH = rom ? 1.4 : 1.8;
    const cp = Math.min(C.w / (Cn + drvW + 0.1), C.h / (Rn + botH));
    const gw = Cn * cp, gh = Rn * cp;
    const gx = C.x + (C.w - gw - drvW * cp) / 2 + drvW * cp, gy = C.y + (C.h - gh - botH * cp) / 2;
    const xc = c => gx + (c + 0.5) * cp, yr = r => gy + (r + 0.5) * cp;
    const wlY = r => yr(r) - cp * 0.26, blX = c => xc(c) - cp * 0.3;
    const lw = Math.max(0.8, cp * 0.07);
    const seed = (num(s.row) * 131 + num(s.col) * 7) | 0;
    const vAt = (r, c) => (r === row && c === col ? b0 : hbit(r, c, seed));
    const GOLD = THEME.gold, CY = THEME.cyan;
    const saY = gy + gh + cp * 0.3, saH = cp * 0.55, botY = gy + gh + botH * cp;
    // metal: word lines, bit lines, word line drivers
    G.beginPath();
    for (let r = 0; r < Rn; r++) { G.moveTo(gx - drvW * cp * 0.45, wlY(r)); G.lineTo(gx + gw, wlY(r)); }
    for (let c = 0; c < Cn; c++) { G.moveTo(blX(c), gy); G.lineTo(blX(c), saY); }
    G.strokeStyle = METAL;
    G.lineWidth = lw;
    G.stroke();
    G.beginPath();
    for (let r = 0; r < Rn; r++) {
      const y = wlY(r), x = gx - drvW * cp * 0.5, hs = Math.min(cp * 0.2, 5);
      G.moveTo(x - hs, y - hs); G.lineTo(x + hs, y); G.lineTo(x - hs, y + hs); G.closePath();
    }
    G.fillStyle = 'rgba(150,165,205,0.3)';
    G.fill();
    // the phases
    const eW = seg(u, 0, 0.25);
    let fBL = 0, eSA = 0, eOut = 0, qRow = 1, eCol = 0, qSel = null;
    if (rom) { fBL = seg(u, 0.25, 0.5); eCol = seg(u, 0.5, 0.75); eOut = seg(u, 0.75, 0.9); } else if (!write) {
      fBL = seg(u, 0.25, 0.5); eSA = seg(u, 0.5, 0.64); eCol = seg(u, 0.8, 0.9); eOut = seg(u, 0.8, 0.95);
      qRow = 1 - 0.55 * seg(u, 0.3, 0.5) + 0.55 * seg(u, 0.64, 0.8);
    } else {
      eOut = seg(u, 0.25, 0.45); eSA = u >= 0.45 ? 1 : 0; fBL = seg(u, 0.5, 0.75);
      qSel = lerp(1 - b0, b0, seg(u, 0.75, 0.95));
    }
    // cells: DRAM = an access transistor + a capacitor (charged = bright), ROM = a floating-gate transistor
    const cs = cp * (rom ? 0.5 : 0.44);
    const cOff = (c, r) => [xc(c) + cp * 0.1, yr(r) + cp * 0.1];
    G.beginPath();
    for (let r = 0; r < Rn; r++) for (let c = 0; c < Cn; c++) { const [x, y] = cOff(c, r); G.rect(x - cs / 2, y - cs * (rom ? 0.35 : 0.5), cs, cs * (rom ? 0.7 : 1)); }
    G.fillStyle = CELL;
    G.fill();
    G.strokeStyle = EDGE;
    G.lineWidth = 1;
    G.stroke();
    if (cp >= 11 && !rom) {   // access transistors
      G.beginPath();
      for (let r = 0; r < Rn; r++) for (let c = 0; c < Cn; c++) G.rect(blX(c) + cp * 0.06, wlY(r) - cp * 0.07, cp * 0.2, cp * 0.14);
      G.fillStyle = 'rgba(150,165,205,0.35)';
      G.fill();
    }
    if (rom) {   // floating gates: programmed (0) = charged gate
      G.beginPath();
      for (let r = 0; r < Rn; r++) for (let c = 0; c < Cn; c++) if (!vAt(r, c)) { const [x, y] = cOff(c, r); G.rect(x - cs * 0.38, y - cs * 0.2, cs * 0.76, cs * 0.18); }
      G.fillStyle = ca(THEME.lavender, 0.75);
      G.fill();
    } else {   // charged capacitors of the other rows
      G.beginPath();
      for (let r = 0; r < Rn; r++) if (r !== row) for (let c = 0; c < Cn; c++) if (vAt(r, c)) { const [x, y] = cOff(c, r); G.rect(x - cs * 0.36, y - cs * 0.36, cs * 0.72, cs * 0.72); }
      G.fillStyle = ca(GOLD, 0.5);
      G.fill();
    }
    // the word line of the row
    glowLine([[gx - drvW * cp * 0.45, wlY(row)], [gx + gw, wlY(row)]], eW, CY, Math.max(1.4, cp * 0.09), 1);
    // the bit lines
    if (fBL > 0) {
      for (let c = 0; c < Cn; c++) {
        const v = vAt(row, c);
        if (write) { if (c === col) glowLine([[blX(c), saY], [blX(c), yr(row)]], fBL, GOLD, Math.max(1.2, cp * 0.08), 1); continue; }
        if (rom && !v) continue;
        glowLine([[blX(c), yr(row)], [blX(c), saY]], fBL, GOLD, Math.max(1, cp * 0.06), v ? (c === col && eCol > 0 ? 1 : 0.65) : 0.2);
      }
    }
    // the cells of the row
    for (let c = 0; c < Cn; c++) {
      const [x, y] = cOff(c, row), v = vAt(row, c);
      if (rom) {
        if (!v) { G.fillStyle = ca(THEME.lavender, 0.75); G.fillRect(x - cs * 0.38, y - cs * 0.2, cs * 0.76, cs * 0.18); }
        if (eW >= 1 && v) { G.strokeStyle = ca(GOLD, 0.8); G.lineWidth = 1; G.strokeRect(x - cs / 2, y - cs * 0.35, cs, cs * 0.7); }
        continue;
      }
      const q = c === col && qSel !== null ? qSel : v * qRow;
      if (q > 0.02) {
        if (q > 0.8 && (eSA > 0 || qSel !== null) && u < 0.97) halo(x, y, cs * 0.72, cs * 0.72, GOLD, 0.7);
        G.fillStyle = ca(GOLD, 0.12 + 0.8 * q);
        G.fillRect(x - cs * 0.36, y - cs * 0.36, cs * 0.72, cs * 0.72);
      }
    }
    // the selected cell
    if (u >= 0.2) {
      const [x, y] = cOff(col, row);
      G.strokeStyle = ca(COL, 0.6 + 0.4 * PULSE);
      G.lineWidth = Math.max(1.2, cp * 0.08);
      G.strokeRect(xc(col) - cp * 0.46, yr(row) - cp * 0.46, cp * 0.92, cp * 0.92);
    }
    // sense amplifiers (DRAM) or the column gates (ROM) under the array
    for (let c = 0; c < Cn; c++) {
      const x = blX(c), v = vAt(row, c);
      const on = rom ? (c === col ? eCol : 0) : write ? (c === col ? eSA : 0) : clamp(eSA * Cn - c, 0, 1);
      const tone = rom ? CY : GOLD;
      if (!rom) {
        G.beginPath();
        G.moveTo(x - cp * 0.3, saY); G.lineTo(x + cp * 0.3, saY); G.lineTo(x, saY + saH); G.closePath();
        G.fillStyle = on > 0 ? ca(tone, (v || write ? 0.75 : 0.18) * on + 0.05) : CELL;
        G.fill();
        G.strokeStyle = on > 0 ? ca(tone, 0.8) : EDGE;
        G.lineWidth = 1;
        G.stroke();
      } else {
        G.fillStyle = on > 0 ? ca(tone, 0.3 + 0.6 * on) : CELL;
        G.fillRect(x - cp * 0.22, saY - cp * 0.05, cp * 0.44, saH * 0.7);
        G.strokeStyle = on > 0 ? ca(tone, 0.9) : EDGE;
        G.lineWidth = 1;
        G.strokeRect(x - cp * 0.22, saY - cp * 0.05, cp * 0.44, saH * 0.7);
      }
    }
    // the output (or the data input of a write)
    const ox = blX(col), oy0 = saY + saH, oy1 = botY - cp * 0.25;
    G.beginPath();
    G.moveTo(ox, oy0); G.lineTo(ox, oy1);
    G.strokeStyle = METAL;
    G.lineWidth = lw;
    G.stroke();
    if (write) glowLine([[ox, oy1], [ox, oy0]], eOut, GOLD, Math.max(1.4, cp * 0.09), 1);
    else glowLine([[ox, oy0], [ox, oy1]], eOut, GOLD, Math.max(1.4, cp * 0.09), 1);
    const os = clamp(cp * 0.4, 3, 12);
    if (write ? u > 0.2 : eOut >= 1) bitSq(ox, oy1, os, b0, write ? (eOut < 1 ? 1 : 0.5) : 0.8 + 0.2 * PULSE, GOLD);
  }

  // ---- mux: column lines, pass transistors, one output ---------------------------------------------
  function kMux(C, s, u) {
    const n = clamp(num(s.n, 16), 2, 4096), sel = clamp(num(s.sel), 0, n - 1);
    const sb = Math.max(1, Math.ceil(Math.log2(n))), dg = Math.max(1, Math.ceil(sb / 4));
    const val = num(s.value, 1);
    header(C, [`SEL ${hex(sel, dg)}h`], `OUT ${val > 1 ? hex2(val) + 'h' : val}`, seg(u, 0.8, 0.92));
    const vert = C.h > C.w * 1.3;
    setFrame(vert, C.x, C.y);
    const FW = vert ? C.h : C.w, FH = vert ? C.w : C.h;
    let M = n, start = 0, pre = 0, post = 0;
    const maxM = clamp(Math.floor(FW / 5), 4, 32);
    if (n > maxM) {
      M = maxM - 4;
      start = clamp(sel - Math.floor(M / 2), 0, n - M);
      pre = start > 0 ? 2 : 0;
      post = start + M < n ? 2 : 0;
    }
    const op = (FW - 4) / (M + pre + post);
    const ak = k => 2 + (k + pre + 0.5) * op;
    const selK = sel - start;
    const tC = FH * 0.46, tH = clamp(Math.min(op * 1.1, FH * 0.16), 3, 18), tW = clamp(op * 0.55, 2, 14);
    const busC = FH * 0.74, outA = FW / 2;
    const GOLD = THEME.goldHi, lw = clamp(op * 0.2, 0.8, 2.2);
    const eG = seg(u, 0, 0.3), eIn = seg(u, 0.3, 0.5), ePass = seg(u, 0.45, 0.7), eOut = seg(u, 0.7, 0.85);
    // column lines: each carries the bit of its column (a dim gold line = 1)
    G.beginPath();
    for (let k = 0; k < M; k++) { mv(ak(k), 0); ln(ak(k), tC - tH / 2); mv(ak(k), tC + tH / 2); ln(ak(k), busC); }
    mv(ak(0), busC); ln(ak(M - 1), busC);
    mv(outA, busC); ln(outA, FH);
    G.strokeStyle = METAL;
    G.lineWidth = lw;
    G.stroke();
    G.beginPath();
    for (let k = 0; k < M; k++) if (k !== selK && hbit(start + k, 3, sel)) { mv(ak(k), 0); ln(ak(k), tC - tH / 2); }
    G.strokeStyle = ca(GOLD, 0.22);
    G.stroke();
    for (let q = 1; q <= 2; q++) {
      G.beginPath();
      if (pre) { mv(ak(-q), 0); ln(ak(-q), tC); }
      if (post) { mv(ak(M - 1 + q), 0); ln(ak(M - 1 + q), tC); }
      G.strokeStyle = `rgba(150,165,205,${q === 1 ? 0.16 : 0.07})`;
      G.stroke();
    }
    // pass transistors and their gates (the select lines from the decoder)
    G.beginPath();
    for (let k = 0; k < M; k++) if (k !== selK) fBox(ak(k), tC, tW, tH);
    G.fillStyle = CELL;
    G.fill();
    G.strokeStyle = EDGE;
    G.lineWidth = 1;
    G.stroke();
    const x = ak(selK);
    halo(x, tC, tW, tH, COL, eG);
    G.beginPath();
    fBox(x, tC, tW, tH);
    G.fillStyle = eG > 0 ? ca(COL, 0.2 + 0.6 * eG) : CELL;
    G.fill();
    G.strokeStyle = eG > 0 ? COL : EDGE;
    G.stroke();
    glowLine([[x, 0], [x, tC - tH / 2]], eIn, GOLD, lw * 1.4, 1);
    glowLine([[x, tC + tH / 2], [x, busC], [outA, busC]], ePass, GOLD, lw * 1.4, 1);
    glowLine([[outA, busC], [outA, FH - 1]], eOut, GOLD, lw * 1.6, 1);
    if (eOut >= 1) bitSq(outA, FH - clamp(op * 0.4, 3, 10) / 2 - 1, clamp(op * 0.8, 4, 12), val ? 1 : 0, 0.9, GOLD);
  }

  // ---- latch: D latches with a strobe line -----------------------------------------------------------
  function kLatch(C, s, u) {
    const n = clamp(num(s.bits, 8), 1, 16), v = norm(num(s.value), n);
    const stb = upper(fitS(s.strobe || 'ALE', 5));
    const dg = Math.max(1, Math.ceil(n / 4));
    header(C, [`${stb} ${hex(v, dg)}h`, stb], `Q=${hex(v, dg)}`, seg(u, 0.45, 0.55));
    const L = lanes(n, C.w, C.h, { depth: 3, maxDepth: 4.6, rows: 2, endL: 1, endR: 0.3 });
    setFrame(L.v, C.x, C.y);
    const p = L.p, D = L.D, ds = clamp(p * 0.38, 2, 13), bw = p * 0.72;
    const hi = u >= 0.2 && u < 0.45, held = u >= 0.45, changed = u >= 0.62;
    const MAG = THEME.magenta;
    G.beginPath();
    for (let i = 0; i < n; i++) { const x = L.a(i), t0 = L.ct(i); mv(x, t0 + D * 0.1); ln(x, t0 + D * 0.3); mv(x, t0 + D * 0.66); ln(x, t0 + D * 0.88); }
    G.strokeStyle = METAL;
    G.lineWidth = Math.max(1, p * 0.06);
    G.stroke();
    for (let rr = 0; rr < L.R; rr++) {   // the strobe line of each row
      const i0 = (L.R - 1 - rr) * L.K, i1 = Math.min(n - 1, i0 + L.K - 1);
      const cS = L.ct(i0) + D * 0.48, a0 = L.a(i1) - p * 0.9, a1 = L.a(i0) + p * 0.3;
      G.beginPath(); mv(a0, cS); ln(a1, cS);
      G.strokeStyle = ca(MAG, 0.3);
      G.lineWidth = Math.max(1.2, p * 0.08);
      G.stroke();
      if (hi) glowLine([[a0, cS], [a1, cS]], 1, MAG, Math.max(1.4, p * 0.1), 0.6 + 0.4 * PULSE);
    }
    for (let i = 0; i < n; i++) {
      const x = L.a(i), t0 = L.ct(i), b = bit(v, i);
      const got = u >= 0.22 + 0.1 * (n - 1 - i) / n || held;
      cellBox(x, t0 + D * 0.48, bw, D * 0.36, hi ? 1 : held ? 2 : 0);
      // D: the bits of the bus (later the bus carries other bits)
      const dv = changed ? hbit(i, 5, v) : b;
      G.globalAlpha = changed ? 0.45 : seg(u, 0, 0.12) * 0.7 + 0.3;
      bitSq(x, t0 + D * 0.1, ds, dv, !changed && u < 0.45 ? 0.5 : 0);
      G.globalAlpha = 1;
      if (got) {
        if (hi) glowLine([[x, t0 + D * 0.1], [x, t0 + D * 0.88]], 1, COL, Math.max(1, p * 0.06), b ? 0.9 : 0.25);
        bitSq(x, t0 + D * 0.9, ds * 1.15, b, hi ? 1 : 0.45, COL);
      } else {
        G.beginPath();
        fBox(x, t0 + D * 0.9, ds * 1.15, ds * 1.15);
        G.strokeStyle = 'rgba(140,155,200,0.2)';
        G.lineWidth = 1;
        G.stroke();
      }
    }
    const lpx = Math.min(14, Math.floor(p * 0.42));
    if (lpx >= 11 && !L.v) {
      const i1 = Math.min(n - 1, (L.R - 1) * L.K + L.K - 1);
      fText(stb, L.a(i1) - p * 0.55, L.ct(i1) + D * 0.48 - lpx, lpx, ca(MAG, 0.9), 'right', true);
    }
  }

  // ---- buffer: tri-state buffers with an enable line -----------------------------------------------------
  function kBuffer(C, s, u) {
    const n = clamp(num(s.bits, 8), 1, 16), v = norm(num(s.value), n);
    const en = upper(s.enable || 'OE');
    const d = String(s.dir || 'out');
    const down = !/^in$/i.test(d.trim());
    const dg = Math.max(1, Math.ceil(n / 4));
    header(C, [fitS(en, 16), fitS(en.split(',').pop().trim(), 8)], `${hex(v, dg)}h`, seg(u, 0.7, 0.8));
    const L = lanes(n, C.w, C.h, { depth: 3, maxDepth: 4.6, rows: 2, endL: 0.7, endR: 0.3 });
    setFrame(L.v, C.x, C.y);
    const p = L.p, D = L.D, ds = clamp(p * 0.38, 2, 13), hw = p * 0.34;
    const cSrc = down ? 0.1 : 0.9, cDst = down ? 0.9 : 0.1;
    const eEn = seg(u, 0.05, 0.35), on = u >= 0.35;
    const MAG = THEME.magenta;
    G.beginPath();
    for (let i = 0; i < n; i++) { const x = L.a(i), t0 = L.ct(i); mv(x, t0 + D * 0.1); ln(x, t0 + D * 0.9); }
    G.strokeStyle = METAL;
    G.lineWidth = Math.max(1, p * 0.06);
    G.stroke();
    for (let rr = 0; rr < L.R; rr++) {
      const i0 = (L.R - 1 - rr) * L.K, i1 = Math.min(n - 1, i0 + L.K - 1);
      const cE = L.ct(i0) + D * 0.5, a0 = L.a(i1) - p * 0.7, a1 = L.a(i0) + hw * 0.6;
      G.beginPath(); mv(a0, cE); ln(a1, cE);
      G.strokeStyle = ca(MAG, 0.3);
      G.lineWidth = Math.max(1.2, p * 0.08);
      G.stroke();
      glowLine([[a0, cE], [a1, cE]], eEn, MAG, Math.max(1.4, p * 0.1), 0.9);
    }
    for (let i = 0; i < n; i++) {
      const x = L.a(i), t0 = L.ct(i), b = bit(v, i);
      const k0 = 0.4 + 0.3 * (n - 1 - i) / n, pass = seg(u, k0 - 0.05, k0 + 0.12);
      const c0 = t0 + D * (down ? 0.36 : 0.64), c1 = t0 + D * (down ? 0.64 : 0.36);
      triPath(x, c0, c1, hw);
      G.fillStyle = on ? (pass > 0 && pass < 1 ? ca(COL, 0.55) : ca(COL, b ? 0.3 : 0.1)) : CELL;
      G.fill();
      G.strokeStyle = on ? ca(COL, 0.9) : EDGE;
      G.lineWidth = 1;
      G.stroke();
      bitSq(x, t0 + D * cSrc, ds, b, on && pass < 1 ? 0.6 : 0, COL);
      if (pass > 0 && pass < 1 && b) spark(x, lerp(t0 + D * cSrc, t0 + D * cDst, pass), ds, COL);
      if (pass >= 1) bitSq(x, t0 + D * cDst, ds * 1.15, b, u < 0.95 ? 1 : 0.5, COL);
      else {   // off: the output floats (z)
        G.beginPath();
        fBox(x, t0 + D * cDst, ds * 1.15, ds * 1.15);
        G.strokeStyle = 'rgba(140,155,200,0.2)';
        G.lineWidth = 1;
        G.stroke();
      }
    }
  }

  // ---- flags: 16 flag bits, the changed ones flip --------------------------------------------------------
  const FLAG_POS = { CF: 0, PF: 2, AF: 4, ZF: 6, SF: 7, TF: 8, IF: 9, DF: 10, OF: 11 };
  function kFlags(C, s, u) {
    const v = num(s.v) & 0xFFFF, old = num(s.old, v) & 0xFFFF;
    let names = s.names;
    if (typeof names === 'string') names = names.split(/[\s,]+/);
    names = (Array.isArray(names) ? names : []).map(upper).filter(Boolean);
    const want = new Set(names.length ? names : Object.keys(FLAG_POS));
    const nameAt = {};
    for (const k in FLAG_POS) nameAt[FLAG_POS[k]] = k;
    const ch = [];
    for (let i = 0; i < 16; i++) if (bit(old ^ v, i)) ch.push(i);
    const chN = ch.filter(i => nameAt[i]).map(i => nameAt[i] + bit(v, i));
    header(C, [chN.length ? chN.join(' ') : `${hex4(v)}h`, `${hex4(old)}→${hex4(v)}`], `${hex4(v)}h`, seg(u, 0.75, 0.9));
    let L = lanes(16, C.w, C.h, { depth: 2.4, maxDepth: 3.2, rows: 4, endL: 0.2, endR: 0.2, gap: 0.3 });
    let lab = L.p >= TW('OF', 11) + 3;
    if (!lab) L = lanes(16, C.w, C.h, { depth: 1.4, maxDepth: 2, rows: 4, endL: 0.2, endR: 0.2, gap: 0.3 });
    setFrame(L.v, C.x, C.y);
    const p = L.p, D = L.D;
    const lpx = lab ? clamp(Math.floor(Math.min(p * 0.5, D * 0.36)), 11, 15) : 0;
    if (lpx < 11) lab = false;
    const nc = Math.max(1, ch.length);
    const win = k => { const a = 0.08 + (k * 0.6) / nc; return [a, a + Math.min(0.25, 0.6 / nc + 0.1)]; };
    for (let i = 15; i >= 0; i--) {
      const x = L.a(i), t0 = L.ct(i), nm = nameAt[i];
      const k = ch.indexOf(i), f = k >= 0 ? seg(u, win(k)[0], win(k)[1]) : 0;
      const cc = lab ? t0 + D * 0.7 : t0 + D * 0.5, chh = lab ? D * 0.5 : D * 0.7;
      const sc = f > 0 && f < 1 ? Math.max(0.08, Math.abs(Math.cos(Math.PI * f))) : 1;
      const bv = f >= 0.5 ? bit(v, i) : bit(old, i);
      const cs = Math.min(p * 0.8, chh);
      if (k >= 0 && f > 0) halo(x, cc, cs, cs * sc, COL, f < 1 ? 1 : 0.35);
      G.beginPath();
      fBox(x, cc, cs, cs * sc);
      if (!nm) {
        G.fillStyle = 'rgba(16,20,34,0.8)';
        G.fill();
        G.setLineDash([2, 2]);
        G.strokeStyle = 'rgba(140,155,200,0.25)';
        G.lineWidth = 1;
        G.stroke();
        G.setLineDash([]);
        continue;
      }
      G.fillStyle = bv ? (k >= 0 && f > 0 ? ca(COL, 0.85) : ca(THEME.text, 0.62)) : CELL;
      G.fill();
      G.strokeStyle = k >= 0 && f > 0 ? COL : EDGE;
      G.lineWidth = k >= 0 && f > 0 ? 1.5 : 1;
      G.stroke();
      if (lab) fText(nm, x, t0 + D * 0.2, lpx, k >= 0 && f > 0 ? COL : want.has(nm) ? ca(THEME.text, 0.8) : ca(THEME.text, 0.4), 'center', k >= 0 && f > 0);
    }
  }

  // ---- opcode: the bits of the instruction and its fields ----------------------------------------------------
  const GRP = new Set([0x80, 0x81, 0x82, 0x83, 0x8F, 0xC0, 0xC1, 0xC6, 0xC7, 0xD0, 0xD1, 0xD2, 0xD3, 0xF6, 0xF7, 0xFE, 0xFF]);
  function autoFields(bytes) {
    const o = bytes[0];
    const dw = (o < 0x40 && (o & 7) < 4) || (o >= 0x88 && o <= 0x8B);
    const modrm = dw || (o >= 0x84 && o <= 0x8F) || GRP.has(o) || (o >= 0xD8 && o <= 0xDF) || [0x62, 0x63, 0x69, 0x6B, 0xC4, 0xC5].includes(o);
    if ((o >= 0x40 && o < 0x60) || (o >= 0x90 && o < 0x98)) return [{ name: 'op', from: 7, to: 3 }, { name: 'reg', from: 2, to: 0 }];
    if (o >= 0xB0 && o < 0xC0) return [{ name: 'op', from: 7, to: 4 }, { name: 'w', from: 3, to: 3 }, { name: 'reg', from: 2, to: 0 }];
    if (!modrm || bytes.length < 2) return [{ name: 'op', from: 7, to: 0 }];
    const f = dw ? [{ name: 'op', from: 7, to: 2 }, { name: 'd', from: 1, to: 1 }, { name: 'w', from: 0, to: 0 }] : [{ name: 'op', from: 7, to: 1 }, { name: 'w', from: 0, to: 0 }];
    return f.concat([{ name: 'mod', from: 15, to: 14 }, { name: 'reg', from: 13, to: 11 }, { name: 'r/m', from: 10, to: 8 }]);
  }
  function kOpcode(C, s, u) {
    const bytes = (Array.isArray(s.bytes) ? s.bytes : []).slice(0, 6).map(b => num(b) & 0xFF);
    if (!bytes.length) bytes.push(0x90);
    let fields = Array.isArray(s.fields) && s.fields.length ? s.fields : autoFields(bytes);
    let byte = 0, prevLo = 8;
    fields = fields.slice(0, 8).map(f => {
      let hi = Math.max(num(f.from, 7), num(f.to, 0)), lo = Math.min(num(f.from, 7), num(f.to, 0));
      if (hi > 7) { byte = clamp(hi >> 3, 0, 1); lo = lo > 7 ? lo & 7 : 0; hi &= 7; }   // bits 15..8 = the second byte
      else if (f.byte !== undefined && f.byte !== null) byte = clamp(num(f.byte), 0, 1);
      else if (hi >= prevLo) byte = Math.min(byte + 1, 1);
      hi = clamp(hi, 0, 7); lo = clamp(lo, 0, hi);
      prevLo = lo;
      return { name: String(f.name || '?'), hi, lo, byte };
    });
    const nb = Math.min(2, Math.max(1, ...fields.map(f => f.byte + 1)), bytes.length);
    fields = fields.filter(f => f.byte < nb);
    const rest = bytes.slice(nb, nb + 4);
    const txt = String(s.text || '').trim();
    header(C, [bytes.map(hex2).join(' '), hex2(bytes[0])], txt, seg(u, 0.86, 0.96));
    setFrame(false, 0, 0);
    // layout A: one row of bits (+ tiles of the other bytes); layout B: one row for each byte
    const lay = lab => {
      const lh = lab ? 11 + 4 : 0;
      const pA = Math.min(C.w / (nb * 8 + (nb - 1) * 0.7 + rest.length * 2.3 + 0.3), (C.h - lh) / 1.6, 44);
      const pB = nb > 1 ? Math.min(C.w / 8.4, (C.h - nb * lh) / (nb * 1.6 + (nb - 1) * 0.5), 44) : 0;
      return pA * 1.3 >= pB ? { B: false, p: pA, lh } : { B: true, p: pB, lh };
    };
    let Lo = lay(true), lab = Lo.p >= 9;
    if (!lab) Lo = lay(false);
    const { B, p, lh } = Lo;
    // the bit cells get taller when there is room
    const rowAv = B ? (C.h - (nb - 1) * 0.5 * p) / nb : C.h;
    const bh = clamp(rowAv - lh - 0.6 * p, p, 2.4 * p), bw = p * 0.78;
    const rowD = bh + 0.6 * p + lh;
    const totW = B ? 8 * p : nb * 8 * p + (nb - 1) * 0.7 * p + (rest.length ? 0.3 * p + rest.length * 2.3 * p : 0);
    const totH = B ? nb * rowD + (nb - 1) * 0.5 * p : rowD;
    const x0 = C.x + (C.w - totW) / 2, y0 = C.y + (C.h - totH) / 2;
    const bxp = (k, i) => (B ? x0 : x0 + k * 8.7 * p) + (7 - i + 0.5) * p;
    const rowY = k => (B ? y0 + k * (rowD + 0.5 * p) : y0);
    const nf = Math.max(1, fields.length);
    const fe = fields.map((f, k) => { const a = 0.1 + (k * 0.72) / nf; return seg(u, a, a + 0.72 / nf); });
    // a field name shows when all names fit in their brackets; else only the name of the active field
    const px = 11;
    const allFit = fields.every(f => TW(f.name, px) <= (f.hi - f.lo + 1) * p - 2);
    for (let k = 0; k < nb; k++) {
      for (let i = 7; i >= 0; i--) {
        const fi = fields.findIndex(f => f.byte === k && i <= f.hi && i >= f.lo);
        const e = fi >= 0 ? fe[fi] : 0;
        const hot = e > 0 && e < 1 ? 1 : e >= 1 ? 0.35 : 0;
        const x = bxp(k, i), y = rowY(k) + bh / 2;
        const v = bit(bytes[k], i);
        if (v && hot > 0.5) halo(x, y, bw, bh, COL, 1);
        G.fillStyle = v ? (hot ? ca(COL, 0.45 + 0.55 * hot) : ca(THEME.text, 0.62)) : CELL;
        G.fillRect(x - bw / 2, y - bh / 2, bw, bh);
        if (!v) { G.strokeStyle = hot ? ca(COL, 0.35 + 0.5 * hot) : EDGE; G.lineWidth = 1; G.strokeRect(x - bw / 2, y - bh / 2, bw, bh); }
      }
    }
    // the field brackets, one after another
    fields.forEach((f, k) => {
      const e = fe[k];
      if (e <= 0) return;
      const xl = bxp(f.byte, f.hi) - bw / 2, xr = bxp(f.byte, f.lo) + bw / 2, yb = rowY(f.byte) + bh + p * 0.35;
      const act = e < 1;
      G.beginPath();
      G.moveTo(xl, yb - p * 0.22); G.lineTo(xl, yb); G.lineTo(xr, yb); G.lineTo(xr, yb - p * 0.22);
      G.strokeStyle = ca(COL, act ? 1 : 0.55);
      G.lineWidth = act ? Math.max(1.5, p * 0.09) : Math.max(1, p * 0.06);
      G.stroke();
      if (lab && (allFit || act)) text(f.name, (xl + xr) / 2, yb + 3 + px / 2, px, act ? COL : ca(COL, 0.6), 'center', act);
    });
    // the other bytes (displacement, data)
    if (!B && rest.length) {
      const e = seg(u, 0.8, 0.88);
      rest.forEach((bv, m) => {
        const x = x0 + nb * 8 * p + (nb - 1) * 0.7 * p + 0.3 * p + m * 2.3 * p, y = rowY(0);
        G.fillStyle = e > 0 ? ca(COL, 0.1 * e) : 'rgba(16,20,34,0.9)';
        G.fillRect(x, y, 2 * p, bh);
        G.strokeStyle = e > 0 ? ca(COL, 0.4 + 0.5 * e) : EDGE;
        G.lineWidth = 1;
        G.strokeRect(x, y, 2 * p, bh);
        const tp = clamp(Math.floor(p * 0.5), 11, 15);
        if (TW('00', tp) <= 1.9 * p && bh >= tp) text(hex2(bv), x + p, y + bh / 2, tp, e > 0 ? ca(COL, 0.6 + 0.4 * e) : ca(THEME.text, 0.55), 'center', true);
      });
    }
  }

  // ---- counter: a down counter with its clock --------------------------------------------------------
  function kCounter(C, s, u) {
    const reload = num(s.reload, 0) & 0xFFFF, period = reload || 0x10000;
    const mode = clamp(num(s.mode, 2), 0, 5), step = mode === 3 ? 2 : 1;
    const v = num(s.v) & 0xFFFF;
    const seq = [3, 2, 1, 0].map(k => { let x = v + k * step; if (x > period) x -= period; return x & 0xFFFF; });
    const outOf = c => (s.out !== undefined && s.out !== null ? num(s.out) & 1 : mode === 0 ? (c === 0 ? 1 : 0) : mode === 2 ? (c === 1 ? 0 : 1) : mode === 3 ? (c > period / 2 ? 1 : 0) : 1);
    const edges = [0.23, 0.5, 0.77];
    const k = u >= 0.77 ? 3 : u >= 0.5 ? 2 : u >= 0.23 ? 1 : 0;
    const cur = seq[k], prev = seq[Math.max(0, k - 1)];
    const flash = k > 0 ? 1 - seg(u, edges[k - 1], edges[k - 1] + 0.14) : 0;
    header(C, [`MODE ${mode}`], `${hex4(cur)}h`, 1);
    const L = lanes(16, C.w, C.h, { depth: 2.2, maxDepth: 4.5, rows: 2, endL: 1.5, endR: 0.3 });
    setFrame(L.v, C.x, C.y);
    const p = L.p, D = L.D, cs = Math.min(p * 0.74, D * 0.42), csH = Math.min(D * 0.5, cs * 2.2);
    const MAG = THEME.magenta, clk = Math.max(0, ...edges.map(e => 1 - Math.abs(u - e) / 0.045));
    for (let rr = 0; rr < L.R; rr++) {   // the clock line of each row
      const i0 = (L.R - 1 - rr) * L.K, i1 = Math.min(15, i0 + L.K - 1), cC = L.ct(i0) + D * 0.82;
      G.beginPath(); mv(L.a(i1) - p * 0.5, cC); ln(L.a(i0) + p * 0.5, cC);
      G.strokeStyle = ca(MAG, 0.3);
      G.lineWidth = Math.max(1.2, p * 0.08);
      G.stroke();
      if (clk > 0) glowLine([[L.a(i0) + p * 0.5, cC], [L.a(i1) - p * 0.5, cC]], 1, MAG, Math.max(1.4, p * 0.1), clk);
    }
    for (let i = 0; i < 16; i++) {
      const tg = bit(cur ^ prev, i);
      bitR(L.a(i), L.ct(i) + D * 0.38, cs, csH, bit(cur, i), tg ? flash : 0, COL);
    }
    // OUT at the left end
    const iT = Math.min(15, (L.R - 1) * L.K + L.K - 1), o = outOf(cur);
    const ax = L.a(iT) - p * 1.05, cO = L.ct(iT) + D * 0.38;
    G.beginPath(); mv(L.a(iT) - p * 0.45, cO); ln(ax + cs * 0.6, cO);
    G.strokeStyle = METAL;
    G.lineWidth = 1;
    G.stroke();
    bitR(ax, cO, cs * 1.1, csH, o, o ? 0.9 : 0.3, COL);
  }

  // ---- text: a few short lines over a field of logic cells ------------------------------------------------
  function kText(C, s, u) {
    let src = Array.isArray(s.lines) ? s.lines : s.lines ? [s.lines] : s.text ? [s.text] : [];
    if (!src.length) src = [typeof s.sub === 'string' && s.sub ? s.sub : s.title || ''];
    src = src.map(x => String(x === undefined || x === null ? '' : x)).filter(Boolean);
    header(C, [upper(fitS(s.title || '', 24))], '', 0);
    setFrame(false, 0, 0);
    // random logic: a grid of small gate cells; a wave of activity goes across over u
    const gp = clamp(Math.min(C.w, C.h) / 9, 6, 18);
    const nx = Math.max(1, Math.floor(C.w / gp)), ny = Math.max(1, Math.floor(C.h / gp));
    const ox = C.x + (C.w - nx * gp) / 2, oy = C.y + (C.h - ny * gp) / 2;
    const wave = u * (nx + 6) - 3;
    G.beginPath();
    for (let j = 0; j < ny; j++) { G.moveTo(ox, oy + (j + 0.5) * gp); G.lineTo(ox + nx * gp, oy + (j + 0.5) * gp); }
    G.strokeStyle = 'rgba(150,165,205,0.1)';
    G.lineWidth = 1;
    G.stroke();
    G.beginPath();
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (hbit(i, j, 11) || hbit(j, i, 3)) G.rect(ox + i * gp + gp * 0.2, oy + j * gp + gp * 0.25, gp * 0.6, gp * 0.5);
    G.fillStyle = 'rgba(40,48,74,0.8)';
    G.fill();
    for (let i = Math.max(0, Math.floor(wave - 3)); i < Math.min(nx, Math.ceil(wave + 1)); i++) {
      const k = clamp(1 - Math.abs(i - wave) / 3, 0, 1);
      if (k <= 0) continue;
      G.beginPath();
      for (let j = 0; j < ny; j++) if (hbit(i, j, 11)) G.rect(ox + i * gp + gp * 0.2, oy + j * gp + gp * 0.25, gp * 0.6, gp * 0.5);
      G.fillStyle = ca(COL, 0.55 * k);
      G.fill();
    }
    // the text lines
    const px = clamp(Math.floor(Math.min(C.h / 4.2, C.w / 12)), 11, C.fs + 1);
    const maxC = Math.floor((C.w - 8) / (px * 0.6));
    const nl = Math.min(src.length, 4, Math.floor((C.h - 4) / (px * 1.5)));
    if (maxC < 3 || nl < 1) return;
    const lines = src.slice(0, nl).map(l => fitS(l, maxC));
    const lh = px * 1.5, y0 = C.y + (C.h - nl * lh) / 2 + lh / 2;
    lines.forEach((l, i) => {
      const a = (0.7 * i) / nl, e = 0.35 + 0.65 * seg(u, a, a + 0.15);
      const tw = TW(l, px) + 8, x = C.x + C.w / 2;
      G.fillStyle = 'rgba(8,10,20,0.82)';
      G.fillRect(x - tw / 2, y0 + i * lh - lh / 2 + 1, tw, lh - 2);
      text(l, x, y0 + i * lh, px, i === 0 ? ca(COL, e) : ca(THEME.text, 0.85 * e), 'center', i === 0);
    });
  }

  // ---- the fallback: a soft pulse and a short label ----------------------------------------------------
  function fallback(w, h, spec) {
    G.clearRect(0, 0, w, h);
    G.fillStyle = 'rgba(8,10,20,0.78)';
    G.fillRect(0, 0, w, h);
    const k = 0.3 + 0.5 * PULSE, m = Math.min(w, h) * (0.12 + 0.04 * PULSE);
    G.strokeStyle = ca(COL, k);
    G.lineWidth = 2;
    G.strokeRect(m, m, w - 2 * m, h - 2 * m);
    G.fillStyle = ca(COL, 0.1 * k);
    G.fillRect(m, m, w - 2 * m, h - 2 * m);
    const px = 11, s = fitS(upper(spec && (spec.title || spec.kind) || ''), Math.floor((w - 2 * m - 6) / (px * 0.6)));
    if (s && h >= px + 2 * m) {
      G.textBaseline = 'middle';
      G.font = `700 ${px}px ${FONT}`;
      G.fillStyle = ca(COL, 0.9);
      G.textAlign = 'center';
      G.fillText(s, w / 2, h / 2);
    }
  }

  // ==== the structures of the units: the unit itself works (a cache shows its sets and ways, a
  // bus interface its pins and line buffer, a pipeline its stages, the P6 its tables) ============
  function box(x, y, w, h, fill, stroke, lw) {
    G.beginPath();
    G.rect(x, y, w, h);
    if (fill) { G.fillStyle = fill; G.fill(); }
    if (stroke) { G.strokeStyle = stroke; G.lineWidth = lw || 1; G.stroke(); }
  }
  function glowBox(x, y, w, h, color, k) {
    if (k <= 0.02) return;
    G.save();
    G.shadowColor = ca(color, 0.85 * k);
    G.shadowBlur = 12 * k;
    box(x, y, w, h, ca(color, 0.1 * k), ca(color, 0.4 + 0.6 * k), 1.6);
    G.restore();
  }
  // text that fits in maxW: smaller (not below 7 px), then cut with '…'
  function tFit(s, x, y, maxW, px, color, align, bold) {
    s = String(s === undefined || s === null ? '' : s);
    if (!s || maxW < 6) return;
    let p = px;
    while (p > 7 && TW(s, p) > maxW) p -= 0.5;
    if (TW(s, p) > maxW) s = fitS(s, Math.floor(maxW / (p * 0.6)));
    text(s, x, y, p, color, align, bold);
  }
  const hot2 = (u, a, b) => (u > a && u < b ? 1 : 0);

  // ---- a cache: the address (tag | set | offset), the set decoder, the array of sets × ways ----
  // s: { sets, ways, lineBytes, set, tag, tags: [hex|null] (the ways of the set before), states,
  //      phase: 'lookup' | 'fill' | 'both', fill, way, state, bytes, hit, tagBits, setBits, offBits }
  function kCache(C, s, u) {
    setFrame(false, 0, 0);
    const ways = clamp(num(s.ways, 4), 1, 8), sets = Math.max(1, num(s.sets, 128)), LB = clamp(num(s.lineBytes, 16), 4, 32);
    const set = clamp(num(s.set), 0, sets - 1), fill = !!s.fill, fw = clamp(num(s.way), 0, ways - 1), hit = !!s.hit;
    const tags = Array.isArray(s.tags) ? s.tags : [], states = Array.isArray(s.states) ? s.states : [];
    const bytes = Array.isArray(s.bytes) ? s.bytes.map(v => num(v) & 255) : [];
    const ph = String(s.phase || 'lookup'), lookup = ph !== 'fill';
    const L = ph === 'fill' ? 1 : ph === 'both' ? seg(u, 0, 0.46) : u;         // the lookup
    const F = ph === 'fill' ? u : ph === 'both' ? seg(u, 0.5, 1) : 0;          // the fill
    // the lookup: the set field, the decoder line to the row, the tag compare, the result
    const aSet = seg(L, 0, 0.2), aDec = seg(L, 0.12, 0.42), aCmp = seg(L, 0.42, 0.78), aRes = seg(L, 0.78, 1);
    // the fill: the LRU picks the way, the new tag, the bytes one by one, the state
    const fPick = seg(F, 0, 0.15), fTag = seg(F, 0.12, 0.25), fDat = [0.22, 0.88], fSt = seg(F, 0.88, 1);
    const right = lookup && (!fill || F <= 0) ? (hit ? 'HIT' : 'MISS') : fill && F > 0 ? `WAY ${fw}${F > 0.88 && s.state ? ' · ' + s.state : ''}` : '';
    header(C, [`SET ${set} OF ${sets} · ${ways} WAYS`, `SET ${set}`], right, lookup && (!fill || F <= 0) ? aRes : fill ? Math.max(fPick, 0.6) : 0);
    // the address register
    const ah = clamp(C.h * 0.1, 16, 40), ax = C.x, ay = C.y, aw = C.w;
    const fpx = clamp(ah * 0.42, 9, 16);
    const fields = [[0, 0.46, 'TAG', s.tag ? s.tag + 'h' : ''], [0.46, 0.32, 'SET', String(set)], [0.78, 0.22, 'OFFSET', '']];
    fields.forEach(([a, w, nm, v], k) => {
      const hot = k === 1 ? aSet * (1 - 0.4 * aCmp) : k === 0 ? aCmp * (1 - 0.5 * aRes) + (fill ? fTag * (1 - fSt) : 0) : 0;
      const tone = k === 1 ? COL : THEME.cyan;
      box(ax + a * aw + 1, ay, w * aw - 2, ah, hot > 0.05 ? ca(tone, 0.12 + 0.3 * hot) : CELL, hot > 0.05 ? ca(tone, 0.5 + 0.5 * hot) : EDGE, 1);
      tFit(nm + (v ? ' ' + v : ''), ax + (a + w / 2) * aw, ay + ah / 2, w * aw - 8, fpx, hot > 0.3 ? '#ffffff' : ca(THEME.text, 0.75), 'center', hot > 0.3);
    });
    // the rows: the sets near the selected one (the selected row is large)
    const gy0 = ay + ah + Math.max(8, C.h * 0.035), gh = C.y + C.h - gy0;
    const lw = clamp(C.w * 0.11, 22, 52), gx = C.x + lw, gw = C.w - lw, dx = C.x + lw * 0.22;
    const rowMin = clamp(C.h * 0.03, 6, 13), bigH = Math.max(gh * (fill ? 0.56 : 0.46), 34), K = clamp(Math.floor((gh - bigH) / rowMin), 2, 12), rh = (gh - bigH) / Math.max(1, K);
    const nAbove = Math.min(set, Math.ceil(K / 2)), nBelow = Math.min(sets - 1 - set, K - nAbove);
    const rows = [];
    let y = gy0;
    for (let r = set - nAbove; r <= set + nBelow; r++) { const h = r === set ? bigH : rh; rows.push({ r, y, h }); y += h; }
    const off = (gh - (y - gy0)) / 2;
    rows.forEach(o => { o.y += off; });
    const wayW = gw / ways, sel = rows.find(o => o.r === set);
    const selW = [];
    {
      const big = fill && ways > 1 ? Math.max(wayW, gw * 0.55) : wayW, rest = ways > 1 ? (gw - big) / (ways - 1) : 0;
      let xx = gx;
      for (let w = 0; w < ways; w++) { const ww = fill && ways > 1 ? (w === fw ? big : rest) : wayW; selW.push([xx, ww]); xx += ww; }
    }
    // the decoder strip: one word line for each set
    G.beginPath();
    G.moveTo(dx, rows[0].y); G.lineTo(dx, rows[rows.length - 1].y + rows[rows.length - 1].h);
    G.strokeStyle = METAL; G.lineWidth = 1.5; G.stroke();
    if (rows[0].r > 0) text('⋮', dx + lw * 0.4, rows[0].y - 2, 11, ca(THEME.text, 0.4), 'center');
    if (rows[rows.length - 1].r < sets - 1) text('⋮', dx + lw * 0.4, rows[rows.length - 1].y + rows[rows.length - 1].h + 6, 11, ca(THEME.text, 0.4), 'center');
    for (const o of rows) {
      const isSel = o.r === set, cy = o.y + o.h / 2;
      tFit(String(o.r), gx - 4, isSel ? o.y + Math.min(o.h * 0.25, 12) : cy, lw * 0.6, clamp(o.h * (isSel ? 0.26 : 0.72), 7, isSel ? 15 : 10),
        isSel && aDec > 0.5 ? COL : ca(THEME.text, isSel ? 0.85 : 0.35), 'right', isSel);
      for (let w = 0; w < ways; w++) {
        // (in the selected set, the way that gets the line is wide: its bytes can be read)
        const [x0w, ww] = isSel ? selW[w] : [gx + w * wayW, wayW];
        const x = x0w + 1, cw = ww - 2, by = o.y + 0.5, bh = o.h - 1;
        if (!isSel) {
          // an other set: its lines, as silicon (the trace does not know their bytes)
          box(x, by, cw, bh, 'rgba(18,22,38,0.9)', EDGE, 0.8);
          const n = Math.max(1, Math.min(LB, Math.floor((cw - 4) / 3)));
          G.fillStyle = 'rgba(150,165,205,0.16)';
          for (let k = 0; k < n; k++) if (hbit(o.r, w, k)) G.fillRect(x + 2 + k * (cw - 4) / n, by + bh * 0.3, Math.max(1, (cw - 4) / n - 1), bh * 0.4);
          continue;
        }
        const isFill = fill && w === fw;
        const hot = Math.max(aDec * (1 - 0.6 * aRes), isFill ? Math.max(fPick * (1 - fSt), F > fDat[0] && F < fDat[1] ? 1 : 0) : 0);
        const tone = isFill && F > 0 ? THEME.goldHi : COL;
        box(x, by, cw, bh, CELL, hot > 0.05 ? ca(tone, 0.4 + 0.6 * hot) : EDGE, hot > 0.05 ? 1.6 : 1);
        if (isFill && fPick > 0 && fPick < 1) glowBox(x, by, cw, bh, COL, 0.5 + 0.5 * PULSE);
        // the state (MESI or valid) and the tag of the way
        const st = isFill ? (fSt > 0.5 ? s.state || 'V' : 'I') : states[w] || (tags[w] ? 'V' : 'I');
        const tg = isFill ? (fTag > 0.5 ? s.tag : tags[w]) : tags[w];
        const sw = clamp(bh * 0.24, 9, 20), sy = by + 4;
        box(x + 4, sy, sw, sw, st !== 'I' ? ca(isFill && fSt > 0 ? THEME.goldHi : COL, 0.55) : CELL, EDGE, 1);
        text(st, x + 4 + sw / 2, sy + sw / 2 + 0.5, sw * 0.72, '#ffffff', 'center', true);
        const tpx = clamp(bh * 0.17, 9, 14), tgS = tg ? tg + 'h' : '—', twoL = TW(tgS, tpx) > cw - sw - 34;
        const tgY = twoL ? sy + sw + tpx * 0.8 : sy + sw / 2;
        tFit(tgS, twoL ? x + 5 : x + 8 + sw, tgY, twoL ? cw - 10 : cw - sw - 30, tpx, isFill && fTag > 0.5 ? THEME.goldHi : ca(THEME.text, tg ? 0.85 : 0.4), 'left', true);
        // the comparator of the way: ≠ (not this line) or = (a hit)
        if (lookup && aCmp > 0.05 && !(isFill && fTag > 0.5)) {
          const eq = hit && w === num(s.hitWay, -1);
          text(eq ? '=' : '≠', x + cw - 6, sy + sw / 2, tpx * 1.3, ca(eq ? THEME.phosphor : THEME.magenta, aCmp), 'right', true);
        }
        // the data: the bytes of the line in rows of 8
        const dy0 = (twoL ? tgY + tpx * 0.8 : sy + sw) + 5, dh = by + bh - 4 - dy0;
        let cols = 2;
        for (const n of [2, 4, 8, 16]) if (n <= LB && Math.min((cw - 8) / n, dh / Math.ceil(LB / n) * 1.4) >= Math.min((cw - 8) / cols, dh / Math.ceil(LB / cols) * 1.4)) cols = n;
        const nr = Math.ceil(LB / cols), cwd = (cw - 8) / cols, chh = dh / nr, bpx = Math.min(chh * 0.55, cwd * 0.42, 13);
        for (let k = 0; k < LB; k++) {
          const cx = x + 4 + (k % cols) * cwd, cy2 = dy0 + Math.floor(k / cols) * chh;
          const on = isFill ? seg(F, fDat[0] + (fDat[1] - fDat[0]) * k / LB, fDat[0] + (fDat[1] - fDat[0]) * (k + 1) / LB) : 0;
          const has = isFill ? on >= 1 : !!tags[w];
          box(cx + 0.5, cy2 + 0.5, cwd - 1, chh - 1, on > 0 && on < 1 ? ca(THEME.goldHi, 0.6) : has ? (isFill ? ca(THEME.goldHi, 0.18) : 'rgba(70,80,120,0.45)') : CELL, null);
          if (isFill && on > 0.4 && bpx >= 5.5) text(hex2(bytes[k] || 0), cx + cwd / 2, cy2 + chh / 2 + 0.5, bpx, on < 1 ? '#ffffff' : ca(THEME.goldHi, 0.95), 'center', true);
        }
      }
    }
    // the decoder line: from the SET field down to the word line of the set
    if (sel && aDec > 0) {
      const sx = ax + 0.62 * aw;
      glowLine([[sx, ay + ah], [sx, gy0 - 4], [dx, gy0 - 4], [dx, sel.y + sel.h / 2], [gx, sel.y + sel.h / 2]], aDec, COL, 2.2, 1 - 0.5 * aRes);
    }
  }

  // ---- a bus interface: the pins, the address latch, the signals, the line buffer ---------------
  // s: { mode: 'burst' | 'write' | 'writeback' | 'l2', lineBytes, beatBytes, addr, bytes,
  //      signals: [[name, 'first' | 'last']], note, hit, l2set, l2way }
  function kBus(C, s, u) {
    setFrame(false, 0, 0);
    const mode = String(s.mode || 'burst'), LB = clamp(num(s.lineBytes, 16), 2, 32), BB = clamp(num(s.beatBytes, 2), 1, 8), beats = Math.max(1, Math.ceil(LB / BB));
    const bytes = Array.isArray(s.bytes) ? s.bytes.map(v => num(v) & 255) : [];
    const write = mode === 'write', out = mode === 'writeback', l2 = mode === 'l2', l2hit = l2 && !!s.hit;
    // the timeline: the address goes out, then the transfers (beats) of the burst
    const aOut = seg(u, 0, 0.16), b0 = l2hit ? 0.3 : 0.2, b1 = l2 && !l2hit ? 0.82 : 0.92, bw = (b1 - b0) / beats;
    const beatOf = t => clamp(Math.floor((t - b0) / bw), -1, beats);
    const kNow = write ? -1 : beatOf(u);
    header(C, [write ? 'WRITE' : out ? 'WRITE-BACK' : l2 ? (l2hit ? 'L2 HIT' : 'L2 MISS') : 'BURST'],
      write ? (u > 0.7 ? 'DONE' : '') : kNow >= 0 && kNow < beats ? `TRANSFER ${kNow + 1}/${beats}` : kNow >= beats ? `${LB} BYTES` : '', 1);
    // the pins at the left edge (the pads of the die)
    const pw = clamp(C.w * 0.08, 8, 22), px = C.x;
    for (let k = 0; k < 12; k++) {
      const yy = C.y + (k + 0.5) * C.h / 12;
      box(px, yy - C.h / 40, pw * 0.7, C.h / 20, 'rgba(216,190,120,0.55)', null);
    }
    // the address latch
    const lx = px + pw + 6, lw2 = C.w - pw - 6, lh = clamp(C.h * 0.13, 16, 34), ly = C.y;
    glowBox(lx, ly, lw2, lh, THEME.cyan, aOut > 0 && aOut < 1 ? 1 : 0.25 * aOut);
    if (aOut <= 0 || aOut >= 1) box(lx, ly, lw2, lh, CELL, ca(THEME.cyan, 0.5), 1);
    tFit(`${write ? 'address' : out ? 'line out' : 'line'} ${s.addr || ''}h`, lx + lw2 / 2, ly + lh / 2, lw2 - 10, clamp(lh * 0.5, 9, 16), aOut > 0 ? '#ffffff' : ca(THEME.text, 0.8), 'center', true);
    if (aOut > 0 && aOut < 1) glowLine([[lx, ly + lh / 2], [px + pw * 0.7, ly + lh / 2]], aOut, THEME.cyan, 2);
    // the signals (KEN#, BLAST#, CACHE#): a lamp each
    const sigs = Array.isArray(s.signals) ? s.signals : [], sy = ly + lh + 6, sh = clamp(C.h * 0.07, 12, 22);
    sigs.slice(0, 3).forEach(([nm, when], k) => {
      const at = when === 'last' ? b0 + (beats - 1) * bw : b0;
      const on = u >= at ? 1 : 0, x = lx + k * (lw2 / 3);
      G.beginPath(); G.arc(x + sh / 2, sy + sh / 2, sh * 0.32, 0, Math.PI * 2);
      G.fillStyle = on ? ca(THEME.magenta, 0.9) : CELL; G.fill();
      G.strokeStyle = on ? THEME.magenta : EDGE; G.lineWidth = 1; G.stroke();
      if (on) halo(x + sh / 2, sy + sh / 2, sh * 0.6, sh * 0.6, THEME.magenta, 0.7);
      tFit(nm, x + sh + 3, sy + sh / 2, lw2 / 3 - sh - 6, clamp(sh * 0.62, 8, 13), on ? '#ffffff' : ca(THEME.text, 0.6), 'left', on);
    });
    const top = sy + (sigs.length ? sh + 8 : 0);
    if (write) {
      // a write: the data goes out to the pins; no line comes in
      const dy = top + (C.y + C.h - top) * 0.3, dh = clamp(C.h * 0.16, 16, 40), e = seg(u, 0.25, 0.7);
      glowBox(lx + lw2 * 0.25, dy, lw2 * 0.5, dh, THEME.goldHi, e > 0 && e < 1 ? 1 : 0.3);
      if (!(e > 0 && e < 1)) box(lx + lw2 * 0.25, dy, lw2 * 0.5, dh, CELL, ca(THEME.goldHi, 0.5), 1);
      tFit('data out', lx + lw2 / 2, dy + dh / 2, lw2 * 0.5 - 8, clamp(dh * 0.45, 9, 15), '#ffffff', 'center', true);
      if (e > 0) glowLine([[lx + lw2 * 0.25, dy + dh / 2], [px + pw * 0.7, dy + dh / 2]], e, THEME.goldHi, 2);
      if (u > 0.72) tFit(s.note || 'no line fill', lx + lw2 / 2, dy + dh + 18, lw2 - 10, 13, ca(THEME.magenta, seg(u, 0.72, 0.85)), 'center', true);
      return;
    }
    // the L2 (Pentium Pro): its box at the right of the address, on the back-side bus
    let bufTop = top;
    if (l2) {
      const bx = lx + lw2 * 0.45, bwd = lw2 * 0.55, bh = clamp(C.h * 0.14, 18, 40), look = seg(u, 0.12, 0.28);
      glowBox(bx, top, bwd, bh, l2hit ? THEME.phosphor : THEME.magenta, look > 0 && look < 1 ? 1 : 0.35 * look);
      if (!(look > 0 && look < 1)) box(bx, top, bwd, bh, CELL, EDGE, 1);
      tFit(`L2 set ${num(s.l2set)} · way ${num(s.l2way)}${look >= 1 ? (l2hit ? ' · hit' : ' · miss') : ''}`, bx + bwd / 2, top + bh / 2, bwd - 8, clamp(bh * 0.42, 8, 14), '#ffffff', 'center', true);
      tFit('back-side bus', bx - 6, top + bh / 2, lw2 * 0.45 - 10, 11, ca(THEME.text, 0.55), 'right');
      bufTop = top + bh + 8;
    }
    // the line buffer: one row for each transfer
    const gx = lx + lw2 * 0.18, gw = lw2 * 0.82, gy = bufTop + 4, gh = C.y + C.h - gy - 4;
    const rh = gh / beats, cwd = gw / BB, bpx = Math.min(rh * 0.6, cwd * 0.5, 14);
    for (let b = 0; b < beats; b++) {
      const yy = gy + b * rh, t0 = b0 + b * bw, e = seg(u, t0, t0 + bw);
      const inFlight = e > 0 && e < 1, done = out ? e < 1 : e >= 1;
      tFit(String(b + 1), gx - 6, yy + rh / 2, lw2 * 0.16, clamp(rh * 0.45, 7, 12), ca(THEME.text, inFlight ? 0.9 : 0.4), 'right', inFlight);
      for (let k = 0; k < BB; k++) {
        const i = b * BB + k, x = gx + k * cwd;
        box(x + 0.5, yy + 0.5, cwd - 1, rh - 1, inFlight ? ca(THEME.goldHi, 0.5) : done ? ca(THEME.goldHi, 0.16) : CELL, done || inFlight ? ca(THEME.goldHi, 0.55) : EDGE, 1);
        if ((done || inFlight) && bpx >= 6.5 && i < bytes.length) text(hex2(bytes[i]), x + cwd / 2, yy + rh / 2 + 0.5, bpx, inFlight ? '#ffffff' : ca(THEME.goldHi, 0.9), 'center', true);
      }
      // the transfer on the wires: from the pins (or from the L2, or out to the pins)
      if (inFlight) {
        const from = l2hit ? [lx + lw2 * 0.72, bufTop - 8] : [px + pw * 0.7, yy + rh / 2], to = [gx, yy + rh / 2];
        glowLine(out ? [to, from] : [from, to], clamp(e * 1.6, 0, 1), THEME.goldHi, 2);
      }
    }
    // an L2 miss: the L2 keeps a copy of the line at the end
    if (l2 && !l2hit && u > b1) glowLine([[gx + gw / 2, gy], [lx + lw2 * 0.72, bufTop - 8]], seg(u, b1, 1), THEME.phosphor, 2);
  }

  // ---- a pipeline: its stages, and the instructions that move one stage on ---------------------
  // s: { stages: ['PF', ...], rows: [{ name, items: [text for each stage] }], cur, curRow, note, clocks }
  function kPipe(C, s, u) {
    setFrame(false, 0, 0);
    const stages = (Array.isArray(s.stages) ? s.stages : ['PF', 'D1', 'D2', 'EX', 'WB']).slice(0, 6), n = stages.length;
    const rows = (Array.isArray(s.rows) && s.rows.length ? s.rows : [{ name: '', items: [] }]).slice(0, 2);
    const cur = num(s.cur, -1), curRow = num(s.curRow, 0), move = easeInOut(seg(u, 0.08, 0.5)), work = seg(u, 0.5, 0.95);
    header(C, ['PIPELINE: EACH CLOCK, EACH INSTRUCTION MOVES ONE STAGE ON', 'PIPELINE'], s.clocks ? `${s.clocks} CLOCK${s.clocks === 1 ? '' : 'S'}` : '', 1);
    const noteH = s.note ? clamp(C.h * 0.1, 14, 26) : 0;
    const wide = C.w >= C.h * 0.9;
    const R = rows.length, nameW = rows.some(r => r.name) ? clamp((wide ? C.w : C.h) * 0.06, 12, 26) : 0;
    // the frame: a = along the stages, c = across the rows
    const A0 = wide ? C.x + nameW : C.y + nameW, AL = (wide ? C.w : C.h - noteH) - nameW, C0 = wide ? C.y : C.x, CL = (wide ? C.h - noteH : C.w);
    const sa = AL / n, sc = CL / R;
    const rect = (a, c, da, dc) => (wide ? [a, c, da, dc] : [c, a, dc, da]);
    rows.forEach((row, r) => {
      const c0 = C0 + r * sc + 3, dc = sc - 6;
      if (row.name) {
        const [x, y] = wide ? [C.x + nameW / 2, c0 + dc / 2] : [c0 + dc / 2, C.y + nameW / 2];
        text(row.name, x, y, clamp(nameW * 0.7, 9, 18), COL, 'center', true);
      }
      // the stage boxes
      for (let k = 0; k < n; k++) {
        const [x, y, w, h] = rect(A0 + k * sa + 2, c0, sa - 4, dc);
        const lit = work > 0 && work < 1 && (row.items[k] || '') ? 0.35 + 0.65 * PULSE : 0;
        box(x, y, w, h, CELL, lit ? ca(COL, 0.5 + 0.5 * lit) : EDGE, lit ? 1.6 : 1);
        tFit(stages[k], x + 5, y + clamp(h * 0.14, 7, 12), w - 10, clamp(Math.min(w, h) * 0.16, 8, 14), ca(COL, 0.8), 'left', true);
      }
      // the instructions: from the stage before to their stage now (in the unit only)
      G.save();
      G.beginPath(); G.rect(C.x, C.y, C.w, C.h); G.clip();
      (row.items || []).forEach((txt, k) => {
        if (!txt || k >= n) return;
        const pos = k - 1 + move;
        const [x, y, w, h] = rect(A0 + pos * sa + 6, c0 + dc * 0.32, sa - 12, dc * 0.56);
        const isCur = k === cur && r === curRow, a = k === 0 ? move : 1;
        G.globalAlpha = a;
        if (isCur) glowBox(x, y, w, h, THEME.phosphor, 0.6 + 0.4 * PULSE);
        box(x, y, w, h, isCur ? ca(THEME.phosphor, 0.18) : 'rgba(40,48,80,0.85)', isCur ? THEME.phosphor : ca(COL, 0.45), 1);
        const fs = clamp(Math.min(h * 0.34, 15), 7, 15), words = String(txt).split(/(?<=,) /);
        if (h > fs * 2.6 && words.length > 1 && TW(txt, fs) > w - 6) {
          tFit(words[0], x + w / 2, y + h / 2 - fs * 0.6, w - 6, fs, '#ffffff', 'center', isCur);
          tFit(words.slice(1).join(' '), x + w / 2, y + h / 2 + fs * 0.6, w - 6, fs, '#ffffff', 'center', isCur);
        } else tFit(txt, x + w / 2, y + h / 2, w - 6, fs, '#ffffff', 'center', isCur);
        G.globalAlpha = 1;
      });
      G.restore();
    });
    if (s.note) tFit(s.note, C.x + C.w / 2, C.y + C.h - noteH / 2, C.w - 10, clamp(noteH * 0.6, 9, 14), ca(THEME.magenta, 0.9), 'center', true);
  }

  // ---- the RAT (P6): a table: register -> the ROB entry of its newest value, or the RRF --------
  // s: { table: [{ r, now }], reads: [{ r, rob, ready }], writes: [{ r, rob }] }
  function kRat(C, s, u) {
    setFrame(false, 0, 0);
    const T = (Array.isArray(s.table) ? s.table : []).slice(0, 9), reads = s.reads || [], writes = s.writes || [];
    const rd = seg(u, 0.05, 0.42), wr = seg(u, 0.48, 0.85);
    header(C, ['REGISTER ALIAS TABLE: REGISTER → ROB ENTRY', 'RAT'], writes.length ? `${writes.length} RENAMED` : '', wr);
    const n = Math.max(1, T.length), rh = C.h / n, nw = C.w * 0.36, px = clamp(rh * 0.5, 8, 16);
    T.forEach((e, i) => {
      const y = C.y + i * rh, R = reads.find(x => x.r === e.r), W = writes.find(x => x.r === e.r);
      const hotR = R && rd > 0 && rd < 1 ? 1 : 0, hotW = W && wr > 0 && wr < 1 ? 1 : 0;
      box(C.x + 1, y + 1, nw - 2, rh - 2, hotR ? ca(THEME.cyan, 0.25) : CELL, hotR ? THEME.cyan : EDGE, 1);
      tFit(e.r, C.x + nw / 2, y + rh / 2, nw - 8, px, hotR ? '#ffffff' : ca(THEME.text, 0.8), 'center', true);
      // the pointer: before the rename (from the read, or the RRF), after it the new ROB entry
      let ptr;
      if (W) ptr = wr >= 0.5 ? `ROB ${W.rob}` : R ? (R.rob < 0 ? 'RRF' : `ROB ${R.rob}`) : 'RRF';
      else if (R) ptr = R.rob < 0 ? 'RRF' : `ROB ${R.rob}${R.ready ? '' : ' (not ready)'}`;
      else ptr = e.now >= 0 ? `ROB ${e.now}` : 'RRF';
      const tone = hotW ? THEME.goldHi : hotR ? THEME.cyan : COL;
      if (hotW) glowBox(C.x + nw + 3, y + 1, C.w - nw - 4, rh - 2, THEME.goldHi, 0.6 + 0.4 * PULSE);
      box(C.x + nw + 3, y + 1, C.w - nw - 4, rh - 2, hotW || hotR ? ca(tone, 0.16) : 'rgba(18,22,38,0.9)', hotW || hotR ? tone : EDGE, 1);
      tFit(ptr, C.x + nw + 3 + (C.w - nw - 4) / 2, y + rh / 2, C.w - nw - 12, px, hotW || hotR ? '#ffffff' : ca(THEME.text, ptr === 'RRF' ? 0.45 : 0.8), 'center', hotW || hotR);
      if (hotR) glowLine([[C.x + C.w - 2, y + rh / 2], [C.x + C.w + 20, y + rh / 2]], rd, THEME.cyan, 2);
    });
  }

  // ---- the reservation station (P6): 20 slots; the µops come in, wait, and go to their ports ---
  // s: { size, used, uops: [{ slot, kind, port, wait, issue, go, done }] (clocks from the first issue) }
  function kRs(C, s, u) {
    setFrame(false, 0, 0);
    const size = clamp(num(s.size, 20), 4, 40), mu = Array.isArray(s.uops) ? s.uops : [];
    const tMax = Math.max(2, ...mu.map(x => num(x.done) + 1)), clk = seg(u, 0.08, 0.85) * tMax;
    header(C, [`RESERVATION STATION · ${size} SLOTS`, 'RS'], `CLOCK +${Math.floor(clk)}`, 1);
    const portH = clamp(C.h * 0.16, 16, 40), gh = C.h - portH - 8;
    const cols = C.w >= gh ? 5 : 4, rowsN = Math.ceil(size / cols), cw = C.w / cols, rh = gh / rowsN;
    const own = new Map(mu.map(x => [num(x.slot, -1), x]));
    // the other µops in the station (older instructions): dim slots
    let others = Math.max(0, num(s.used) - mu.length);
    const px = clamp(Math.min(rh * 0.3, cw * 0.14), 7, 14);
    const pBox = p => [C.x + (p + 0.5) * C.w / 5, C.y + C.h - portH / 2];
    for (let i = 0; i < size; i++) {
      const x = C.x + (i % cols) * cw, y = C.y + Math.floor(i / cols) * rh, m = own.get(i);
      if (m) {
        const inS = clk >= m.issue && clk < m.go, gone = clk >= m.go;
        if (inS) glowBox(x + 2, y + 2, cw - 4, rh - 4, m.wait ? THEME.magenta : THEME.cyan, 0.6 + 0.4 * PULSE);
        box(x + 2, y + 2, cw - 4, rh - 4, inS ? ca(THEME.cyan, 0.16) : CELL, inS ? THEME.cyan : EDGE, 1);
        if (!gone && clk >= m.issue) {
          tFit(m.kind, x + cw / 2, y + rh * 0.38, cw - 8, px, '#ffffff', 'center', true);
          tFit(m.wait ? 'waits: ' + m.wait : `→ port ${m.port}`, x + cw / 2, y + rh * 0.7, cw - 8, px * 0.85, m.wait ? THEME.magenta : ca(THEME.text, 0.75), 'center');
        }
        // the dispatch: from the slot down to its port
        if (clk >= m.go && clk < m.go + 1 && m.port >= 0) { const [qx, qy] = pBox(m.port); glowLine([[x + cw / 2, y + rh / 2], [qx, qy - portH / 2]], clamp((clk - m.go) * 1.5, 0, 1), THEME.cyan, 2); }
      } else if (others > 0) {
        others--;
        box(x + 2, y + 2, cw - 4, rh - 4, 'rgba(60,70,110,0.45)', EDGE, 1);
      } else box(x + 2, y + 2, cw - 4, rh - 4, CELL, 'rgba(140,155,200,0.18)', 1);
    }
    // the five ports under the station
    for (let p = 0; p < 5; p++) {
      const [qx, qy] = pBox(p), busy = mu.some(m => m.port === p && clk >= m.go && clk < m.done + 1);
      box(qx - C.w / 12, qy - portH / 2 + 2, C.w / 6, portH - 4, busy ? ca(COL, 0.3) : CELL, busy ? COL : EDGE, 1);
      tFit('port ' + p, qx, qy, C.w / 6 - 6, clamp(portH * 0.4, 8, 13), busy ? '#ffffff' : ca(THEME.text, 0.6), 'center', busy);
    }
  }

  // ---- the reorder buffer (P6): 40 entries in a ring; the µops of this instruction come in,
  // finish, and retire in order at the head ---------------------------------------------------
  // s: { size, used, first, n }
  function kRob(C, s, u) {
    setFrame(false, 0, 0);
    const size = clamp(num(s.size, 40), 8, 64), first = num(s.first, 0), n = clamp(num(s.n, 1), 1, 12), used = clamp(num(s.used, n), n, size);
    const alloc = seg(u, 0.05, 0.3), done = seg(u, 0.35, 0.6), ret = seg(u, 0.65, 0.95);
    header(C, [`REORDER BUFFER · ${size} ENTRIES`, 'ROB'], ret >= 1 ? 'RETIRED' : done >= 1 ? 'DONE' : alloc > 0 ? `${n} IN` : '', 1);
    const cols = C.w >= C.h ? 8 : 5, rowsN = Math.ceil(size / cols), cw = C.w / cols, rh = C.h / rowsN, px = clamp(Math.min(rh * 0.36, cw * 0.22), 7, 14);
    const mine = i => ((i - first) % size + size) % size < n;
    const older = i => { const d = ((first - i) % size + size) % size; return d > 0 && d <= used - n; };
    const head = ((first - (used - n)) % size + size) % size;
    for (let i = 0; i < size; i++) {
      const x = C.x + (i % cols) * cw, y = C.y + Math.floor(i / cols) * rh, k = ((i - first) % size + size) % size;
      let fill = CELL, stroke = 'rgba(140,155,200,0.18)', label = '';
      if (older(i)) { fill = 'rgba(60,70,110,0.45)'; stroke = EDGE; }
      if (mine(i)) {
        const inA = alloc * n > k, isRet = ret * n > k;
        if (inA && !isRet) {
          const dn = done * n > k;
          fill = dn ? ca(THEME.phosphor, 0.22) : ca(THEME.cyan, 0.22);
          stroke = dn ? THEME.phosphor : THEME.cyan;
          label = dn ? 'done' : 'µop';
          glowBox(x + 2, y + 2, cw - 4, rh - 4, dn ? THEME.phosphor : THEME.cyan, 0.5);
        }
      }
      box(x + 2, y + 2, cw - 4, rh - 4, fill, stroke, 1);
      tFit(String(i), x + 5, y + 2 + px * 0.7, cw - 8, px * 0.8, ca(THEME.text, 0.35), 'left');
      if (label) tFit(label, x + cw / 2, y + rh / 2 + px * 0.2, cw - 8, px, '#ffffff', 'center', true);
      if (i === head && ret < 1) tFit('HEAD', x + cw / 2, y + rh - px * 0.6, cw - 6, px * 0.75, THEME.magenta, 'center', true);
    }
  }

  // ---- an execution port (P6): the input latch (from the station), the stages of the unit (one
  // clock each), and the result bus to the ROB ------------------------------------------------
  // s: { port, uop (the kind of the µop), lat, dst, units }
  function kPort(C, s, u) {
    setFrame(false, 0, 0);
    const lat = clamp(num(s.lat, 1), 1, 40), ns = Math.min(lat, 6), kind = String(s.uop || 'µop');
    header(C, [`PORT ${num(s.port)} · ${upper(s.units || '')}`, `PORT ${num(s.port)}`], `${lat} CLOCK${lat === 1 ? '' : 'S'}`, 1);
    const inE = seg(u, 0.04, 0.2), run = seg(u, 0.22, 0.72), outE = seg(u, 0.74, 0.9);
    const wide = C.w >= C.h, A = wide ? C.w : C.h, Cc = wide ? C.h : C.w, slots = ns + 2;
    const sa = A / slots, bc = Math.min(Cc * 0.42, sa * 1.3), c0 = (Cc - bc) / 2;
    const R = (a, c, da, dc) => (wide ? [C.x + a, C.y + c, da, dc] : [C.x + c, C.y + a, dc, da]);
    const lab = (txt, k, color) => { const [x, y, w, h] = R(k * sa + 4, c0 - Math.min(22, c0 * 0.8), sa - 8, Math.min(18, c0 * 0.7)); tFit(txt, x + w / 2, y + h / 2, w, 12, color || ca(THEME.text, 0.6), 'center'); };
    // the wire along the path
    const [wx0, wy0] = R(sa * 0.5, Cc / 2, 0, 0), [wx1, wy1] = R(sa * (slots - 0.5), Cc / 2, 0, 0);
    G.beginPath(); G.moveTo(wx0, wy0); G.lineTo(wx1, wy1); G.strokeStyle = METAL; G.lineWidth = 2; G.stroke();
    // the slots: the input latch, the stages, the result bus
    const where = run > 0 && run < 1 ? 1 + Math.min(ns - 1, Math.floor(run * ns)) : -1;
    for (let k = 0; k < slots; k++) {
      const [x, y, w, h] = R(k * sa + sa * 0.1, c0, sa * 0.8, bc), stage = k >= 1 && k <= ns, on = k === where;
      if (k === 0) { box(x, y, w, h, CELL, ca(THEME.cyan, 0.5), 1); lab('from RS', k, ca(THEME.cyan, 0.8)); }
      else if (k === slots - 1) { box(x, y, w, h, CELL, ca(THEME.goldHi, 0.5), 1); lab('result → ROB', k, ca(THEME.goldHi, 0.85)); }
      else {
        if (on) glowBox(x, y, w, h, COL, 0.5 + 0.5 * PULSE);
        box(x, y, w, h, on ? ca(COL, 0.22) : CELL, on ? COL : EDGE, on ? 1.6 : 1);
        lab(ns < lat && k === ns ? `stage ${k}…${lat}` : `stage ${k}`, k, on ? COL : null);
      }
      if (stage) { /* (the stage number is in its label) */ }
    }
    // the µop: into the latch, through the stages, its result onto the bus
    const pos = u < 0.2 ? -0.6 + 0.6 * inE : run < 1 ? 1 + run * (ns - 1) * (run > 0 ? 1 : 0) - (run <= 0 ? 1 : 0) : ns + outE;
    const [x, y, w, h] = R(pos * sa + sa * 0.18, c0 + bc * 0.2, sa * 0.64, bc * 0.6);
    G.save();
    G.beginPath(); G.rect(C.x, C.y, C.w, C.h); G.clip();
    const done = outE > 0.3;
    glowBox(x, y, w, h, done ? THEME.goldHi : THEME.cyan, 0.8);
    box(x, y, w, h, ca(done ? THEME.goldHi : THEME.cyan, 0.25), done ? THEME.goldHi : THEME.cyan, 1.2);
    tFit(done ? (s.dst ? '→ ' + s.dst : 'done') : kind, x + w / 2, y + h / 2, w - 6, clamp(Math.min(w, h) * 0.34, 9, 16), '#ffffff', 'center', true);
    G.restore();
  }

  const KINDS = {
    cache: kCache, bus: kBus, pipe: kPipe, rat: kRat, rs: kRs, rob: kRob, port: kPort,
    adder: kAdder, logic: kLogic, alu: kLogic, shift: kShift, bytes: kBytes, queue: kBytes, regfile: kRegs, regs: kRegs,
    decoder: kDecoder, cells: kCells, dram: (C, s, u) => kCells(C, Object.assign({}, s, { mem: 'dram' }), u),
    rom: (C, s, u) => kCells(C, Object.assign({}, s, { mem: 'rom' }), u),
    mux: kMux, latch: kLatch, buffer: kBuffer, flags: kFlags, status: kStatus, opcode: kOpcode, counter: kCounter, text: kText,
  };

  function colorOf(spec, kind) {
    let c = COLS[spec.col] ? spec.col : null;
    if (!c && /8087|80287/.test(String(spec.chip || ''))) c = 'fpu';
    // the 20-bit and 24-bit adders make addresses
    if (!c && kind === 'adder' && (num(spec.width, 16) >= 20 || /ADDR/i.test(String(spec.title || '')))) c = 'addr';
    return THEME[COLS[c || DEF_COL[kind] || 'eu']] || THEME.phosphor;
  }

  const UnitFx = {
    // Draw the activity of one die unit (see the top of this file).
    draw(g, w, h, spec, u, t, reduced) {
      if (!g || !(w > 0) || !(h > 0)) return;
      spec = spec && typeof spec === 'object' ? spec : {};
      const kind = String(spec.kind || 'text').toLowerCase();
      G = g;
      fontNow = '';
      REGS = [];
      setFrame(false, 0, 0);
      PULSE = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((Number(t) || 0) / 420);
      g.save();
      try {
        COL = colorOf(spec, kind);
        // the drawing is made for a unit of about 360 px on the screen: a larger canvas scales
        // it up, so the words and the lines keep their size on the screen
        const ZS = clamp(Math.min(w, h) / 360, 1, 3);
        ZSC = ZS;
        g.scale(ZS, ZS);
        w /= ZS; h /= ZS;
        const C = boxOf(w, h);
        FS = C.fs;
        g.textBaseline = 'middle';
        g.lineCap = 'butt';
        g.lineJoin = 'miter';
        base(w, h);
        (KINDS[kind] || kText)(C, spec, clamp(Number(u) || 0, 0, 1));
      } catch (e) {
        try {
          g.restore();
          g.save();
          fallback(w, h, spec);
        } catch (e2) { /* draw nothing */ }
      } finally {
        g.restore();
        G = null;
        UnitFx.words = REGS || [];
        REGS = null;
      }
    },
  };
  return UnitFx;
})();
window.UnitFx = UnitFx;
