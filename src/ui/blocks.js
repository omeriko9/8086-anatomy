// Block cards: small animated SVG drawings. A card shows how one block inside a chip
// die works, with the real values of the current trace step. The trace mode of the
// board shows a card while the signal token waits in a block.
//
//   const p = new BlockPanel(host);   // host: position: relative
//   p.place(x, y); p.show(spec); p.update(u /* 0..1 */); p.hide(); p.setReducedMotion(on);
//
// spec = { kind, title, chip, sub, col?: 'addr'|'data'|'ctrl'|'eu'|'fpu', ...params }
// kinds (params):
//   adder    { width, a, b, cin, sub, borrow, aLabel, bLabel, rLabel }  (r is computed)
//   logic    { op: AND|OR|XOR|NOT|TEST (ADD SUB CMP ADC SBB INC DEC NEG -> adder), width, a, b }
//   alu      { op, width, a, b, r, aLabel, bLabel, rLabel }   (any other ALU operation)
//   shift    { op: SHL|SAL|SHR|SAR|ROL|ROR|RCL|RCR, width, a, count, cf, r }
//   bytes    { cells: [{ v, label }], cap, take: [i], put: [i], note, inLabel, outLabel }
//   regfile  { regs: [{ name, v }], write: name|null, v, read: [names] }
//   decoder  { bits, value, inLabel, outLabel }
//   cells    { rows, cols, row, col, rowLabel, colLabel, bit, write, mem: 'dram'|'rom' }
//            (kind 'dram' / 'rom' are short names for cells with mem set)
//   mux      { n, sel, value, label }
//   latch    { bits, value, strobe, label }
//   buffer   { bits, value, dir: 'in'|'out'|'A→B', enable, label }
//   flags    { old, v, names }
//   status   { code, rows: [{ code, name, cmd }], label }
//   opcode   { bytes, text, fields: [{ name, from, to, byte? }] }
//   counter  { v, reload, label, mode, out }
//   text     { lines }

const BlockPanel = (() => {
  const W = 320;
  let uid = 0;

  const CSS = `
  .bk-panel { position: absolute; left: 0; top: 0; z-index: 7; width: 340px; max-width: 86vw; box-sizing: border-box;
    padding: 9px 10px 8px 12px; border-radius: 10px; pointer-events: none; color: var(--text); font-family: var(--sans);
    background: color-mix(in srgb, var(--panel) 93%, transparent); border: 1px solid var(--line);
    box-shadow: inset 3px 0 0 currentColor, 0 16px 36px -14px var(--void);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    opacity: 0; transform: translateY(6px) scale(.98); transform-origin: 0 0;
    transition: opacity .22s var(--ease, ease), transform .22s var(--ease, ease); }
  .bk-panel.bk-on { opacity: 1; transform: none; }
  .bk-min-btn { pointer-events: auto; margin-left: auto; flex: none; align-self: center; width: 22px; height: 20px; padding: 0; border: 1px solid var(--line); border-radius: 5px;
    background: var(--panel2); color: var(--muted); font: 700 13px/1 var(--mono); cursor: pointer; }
  .bk-min-btn:hover { color: var(--text); border-color: currentColor; }
  .bk-panel.bk-min { width: auto; min-width: 180px; padding-bottom: 7px; }
  .bk-panel.bk-min .bk-sub, .bk-panel.bk-min .bk-svg { display: none; }
  /* the window into a unit (topview.js unitWindow): only the drawing, on the die */
  .bk-panel.bk-inplace { z-index: auto; left: 0; top: 0; transform-origin: 0 0; transition: opacity .15s linear; padding: 4px 6px;
    background: color-mix(in srgb, var(--void) 82%, transparent); box-shadow: 0 0 0 1px currentColor, 0 0 18px -4px currentColor; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .bk-panel.bk-inplace .bk-head, .bk-panel.bk-inplace .bk-sub { display: none; }
  .bk-panel.bk-rm { transition: none; transform: none; }
  .bk-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .bk-title { font: 700 14px/1.2 var(--mono); color: currentColor; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bk-chip { margin-left: auto; flex: none; font: 600 10.5px/1 var(--mono); letter-spacing: .08em; color: var(--muted);
    border: 1px solid var(--line); border-radius: 4px; padding: 3px 5px; }
  .bk-chip:empty { display: none; }
  .bk-sub { margin: 4px 0 6px; font: 12px/1.35 var(--sans); color: var(--text); opacity: .86; }
  .bk-sub:empty { display: none; margin: 0 0 6px; }
  .bk-svg { display: block; width: 100%; height: auto; overflow: hidden; color: inherit; }
  .bk-svg text { font: 11px var(--mono); fill: var(--text); dominant-baseline: central; font-variant-numeric: tabular-nums; }
  .bk-svg .s { font-family: var(--sans); font-size: 10.5px; fill: var(--muted); }
  .bk-svg .st { font-family: var(--sans); font-size: 11px; fill: var(--text); }
  .bk-svg .m { fill: var(--muted); }
  .bk-svg .b0 { fill: var(--muted); }
  .bk-svg .b1 { fill: var(--text); font-weight: 700; }
  .bk-svg .hi { fill: currentColor; }
  .bk-svg .bold { font-weight: 700; }
  .bk-svg .t10 { font-size: 10px; }
  .bk-svg .t12 { font-size: 12px; }
  .bk-svg .t13 { font-size: 13px; font-weight: 700; }
  .bk-svg .t15 { font-size: 15px; font-weight: 700; }
  .bk-svg .bx { fill: var(--panel2); stroke: var(--line); stroke-width: 1; }
  .bk-svg .bx.on { stroke: currentColor; fill: color-mix(in srgb, currentColor 24%, var(--panel2)); }
  .bk-svg .bx.dn { stroke: color-mix(in srgb, currentColor 50%, var(--line)); fill: color-mix(in srgb, currentColor 10%, var(--panel2)); }
  .bk-svg .bx.dash { fill: none; stroke-dasharray: 3 3; }
  .bk-svg .inset { fill: color-mix(in srgb, var(--void) 55%, var(--panel)); stroke: var(--line); stroke-width: 1; }
  .bk-svg .w { fill: none; stroke: var(--line); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .bk-svg .w.thin { stroke-width: 1; }
  .bk-svg .w.on { stroke: currentColor; }
  .bk-svg .w.mu { stroke: var(--faint); }
  .bk-svg .w.ms { stroke: var(--muted); }
  .bk-svg .wl { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: butt; stroke-linejoin: round; }
  .bk-svg .ar { fill: currentColor; }
  .bk-svg .ar.off { fill: var(--line); }
  .bk-svg .gt path { fill: var(--panel2); stroke: var(--muted); stroke-width: 1.2; stroke-linejoin: round; }
  .bk-svg .gt path.gx { fill: none; }
  .bk-svg .gt.on path { stroke: currentColor; }
  .bk-svg .gt.one path:first-child { fill: color-mix(in srgb, currentColor 40%, var(--panel2)); }
  .bk-svg .cg { fill: var(--panel2); stroke: var(--faint); stroke-width: 1; }
  .bk-svg .cg.sel { stroke: currentColor; stroke-width: 1.4; }
  .bk-svg .fill { fill: currentColor; stroke: none; }
  .bk-svg .row { fill: color-mix(in srgb, currentColor 20%, transparent); stroke: currentColor; stroke-width: 1; }
  .bk-svg .cur { fill: none; stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 2; }
  .bk-svg .dot { fill: currentColor; }
  .cA { color: var(--cyan); }
  .cD { color: var(--gold-hi); }
  .cG { color: var(--gold); }
  .cC { color: var(--magenta); }
  .cE { color: var(--phosphor); }
  .cF { color: var(--lavender); }
  .cT { color: var(--text); }
  `;

  function injectStyle() {
    if (document.getElementById('bk-style')) return;
    const st = document.createElement('style');
    st.id = 'bk-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---- small helpers --------------------------------------------------------------
  const num = (v, d = 0) => {
    if (v === null || v === undefined || v === '') return d;
    const x = Math.trunc(Number(v));
    return Number.isFinite(x) ? x : d;
  };
  const maskN = n => (n >= 31 ? 0x7FFFFFFF : (1 << n) - 1);
  const norm = (v, n) => (n >= 32 ? v >>> 0 : (v & maskN(n)) >>> 0);
  const bit = (v, i) => (v >>> i) & 1;
  const seg = (u, a, b) => clamp((u - a) / (b - a), 0, 1);
  const hx = (v, bits = 16) => hex(v, Math.max(1, Math.ceil(bits / 4))) + 'h';
  const f1 = v => Math.round(v * 10) / 10;
  const fit = (s, max) => { s = String(s === undefined || s === null ? '' : s); return s.length > max ? s.slice(0, max - 1) + '…' : s; };
  const upper = s => String(s === undefined || s === null ? '' : s).trim().toUpperCase();

  function T(p, x, y, s, cls, anchor) {
    const e = svgEl('text', { x: f1(x), y: f1(y), 'text-anchor': anchor || 'middle' }, p);
    if (cls) e.setAttribute('class', cls);
    e.textContent = s === undefined || s === null ? '' : String(s);
    return e;
  }
  // text from parts: [[text, cls], ...]
  function T2(p, x, y, parts, anchor, cls) {
    const e = svgEl('text', { x: f1(x), y: f1(y), 'text-anchor': anchor || 'start' }, p);
    if (cls) e.setAttribute('class', cls);
    for (const [s, c] of parts) {
      const t = svgEl('tspan', c ? { class: c } : null, e);
      t.textContent = s;
    }
    return e;
  }
  const R = (p, x, y, w, h, cls, rx = 3) => svgEl('rect', { x: f1(x), y: f1(y), width: f1(Math.max(0, w)), height: f1(Math.max(0, h)), rx, class: cls || 'bx' }, p);
  const L = (p, x1, y1, x2, y2, cls) => svgEl('line', { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), class: cls || 'w' }, p);
  const P = (p, d, cls) => svgEl('path', { d, class: cls || 'w' }, p);
  const G = (p, cls, attrs) => { const g = svgEl('g', attrs || null, p); if (cls) g.setAttribute('class', cls); return g; };
  // A path that lights up from its start: lit(el, 0..1).
  const LP = (p, d, cls) => svgEl('path', { d, class: 'wl ' + (cls || ''), pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1, opacity: 0 }, p);
  // A small arrow head at (x, y) that points in the direction dir ('r'|'l'|'u'|'d').
  function AH(p, x, y, dir, cls, s = 4) {
    const d = dir === 'r' ? `M${x} ${y}l${-s * 1.6} ${-s}v${s * 2}Z` : dir === 'l' ? `M${x} ${y}l${s * 1.6} ${-s}v${s * 2}Z`
      : dir === 'u' ? `M${x} ${y}l${-s} ${s * 1.6}h${s * 2}Z` : `M${x} ${y}l${-s} ${-s * 1.6}h${s * 2}Z`;
    return svgEl('path', { d, class: cls || 'ar' }, p);
  }

  function set(e, k, v) {
    const c = e.__bk || (e.__bk = {});
    v = String(v);
    if (c[k] !== v) { c[k] = v; e.setAttribute(k, v); }
  }
  function txt(e, s) { s = String(s); if (e.__t !== s) { e.__t = s; e.textContent = s; } }
  function cl(e, c, on) {
    on = !!on;
    const k = '__c_' + c;
    if (e[k] !== on) { e[k] = on; e.classList.toggle(c, on); }
  }
  function op(e, v) { set(e, 'opacity', v >= 1 ? 1 : v <= 0 ? 0 : v.toFixed(2)); }
  function lit(e, f) { set(e, 'stroke-dashoffset', (1 - clamp(f, 0, 1)).toFixed(3)); set(e, 'opacity', f > 0 ? 1 : 0); }
  function show(e, on) { set(e, 'display', on ? 'inline' : 'none'); }
  function move(e, x, y) { set(e, 'transform', `translate(${f1(x)} ${f1(y)})`); }

  // A logic gate. rot 90: points down (inputs at y, output at y + len), rot 0: points right.
  function gate(p, type, x, y, len, h2, rot = 90, cls = 'gt') {
    const h = h2 / 2;
    let d, extra = '';
    if (type === 'and') d = `M0 ${-h}H${len - h}A${h} ${h} 0 0 1 ${len - h} ${h}H0Z`;
    else if (type === 'or' || type === 'xor') {
      d = `M0 ${-h}Q${len * 0.55} ${-h} ${len} 0Q${len * 0.55} ${h} 0 ${h}Q${len * 0.3} 0 0 ${-h}Z`;
      if (type === 'xor') extra = `M-3.5 ${-h}Q${len * 0.3 - 3.5} 0 -3.5 ${h}`;
    } else if (type === 'not') d = `M0 ${-h}L${len - 5} 0L0 ${h}Z M${len - 5} 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0`;
    else d = `M0 ${-h}L${len} 0L0 ${h}Z`;
    const g = G(p, cls, { transform: `translate(${f1(x)} ${f1(y)})${rot ? ` rotate(${rot})` : ''}` });
    svgEl('path', { d }, g);
    if (extra) svgEl('path', { d: extra, class: 'gx' }, g);
    return g;
  }

  // Bit columns for a register of n bits: MSB at the left, small gaps between nibbles.
  function columns(n, x0, x1, maxW = 26) {
    const gap = n > 8 ? 3 : 0;
    const groups = Math.floor((n - 1) / 4);
    const cw = Math.min(maxW, (x1 - x0 - gap * groups) / n);
    const total = n * cw + gap * groups;
    const right = (x0 + x1) / 2 + total / 2;
    const cx = i => right - (i + 0.5) * cw - Math.floor(i / 4) * gap;
    return { cw, gap, cx, left: right - total, right };
  }
  function bitIndexRow(p, n, cx, y) {
    for (let i = 0; i < n; i++) if (i % 4 === 0 || i === n - 1) T(p, cx(i), y, i, 'm t10');
  }

  function wrapText(str, max) {
    const out = [];
    let line = '';
    for (const w of String(str).split(/\s+/)) {
      if (!w) continue;
      if (line && (line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
    }
    if (line) out.push(line);
    return out;
  }

  // ---- adder ------------------------------------------------------------------------
  function bAdder(svg, s) {
    const n = clamp(num(s.width, 16), 2, 24);
    // spec.sub is also the subtitle text, so only a boolean true (or subtract / op) means subtract
    const sub = s.sub === true || s.subtract === true || /^(SUB|SBB|CMP|DEC|NEG)$/.test(upper(s.op));
    const a = norm(num(s.a), n), bIn = norm(num(s.b), n);
    const b = sub ? norm(~bIn, n) : bIn;
    const cin = sub ? 1 - (num(s.borrow) & 1) : (num(s.cin) & 1);
    const halfAt0 = !sub && !cin;
    const c = [cin], sm = [];
    for (let i = 0; i < n; i++) {
      const ai = bit(a, i), bi = bit(b, i), ci = c[i];
      sm.push(ai ^ bi ^ ci);
      c.push((ai & bi) | (ai & ci) | (bi & ci));
    }
    let r = 0;
    for (let i = n - 1; i >= 0; i--) r = r * 2 + sm[i];
    const cout = c[n];

    let y = 9;
    T2(svg, 4, y, [['A: ', 'm'], [s.aLabel ? fit(s.aLabel, 16) + ' = ' : '', 's'], [hx(a, n), 'b1']], 'start');
    T2(svg, W - 4, y, [['B: ', 'm'], [s.bLabel ? fit(s.bLabel, 16) + ' = ' : '', 's'], [hx(bIn, n), 'b1']], 'end');
    if (sub) {
      y += 14;
      T(svg, 4, y, s.borrow ? 'Subtract: A + NOT B + (1 − borrow). Two’s complement.' : 'Subtract: A + NOT B + 1. This is two’s complement.', 's', 'start');
    }
    const col = columns(n, 26, W - 6);
    const { cw, cx } = col;
    const LX = col.left - 12;
    if (cw < 15) {
      y += 14;
      T(svg, 4, y, `Each box is a full adder (FA)${halfAt0 ? ', but bit 0 is a half adder (HA)' : ''}.`, 's', 'start');
    }
    const yI = y + 13, yA = yI + 13, yB = yA + 14, cT = yB + 9, cH = 20, yC = cT + cH + 9, yS = yC + 14, yR = yS + 18, iT = yR + 11;
    const edge = k => (k === 0 ? cx(0) + cw / 2 : k >= n ? cx(n - 1) - cw / 2 : cx(k) + cw / 2 + (k % 4 === 0 ? col.gap / 2 : 0));
    bitIndexRow(svg, n, cx, yI);
    T(svg, LX, yA, 'A', 'm');
    T(svg, LX, yB, sub ? '~B' : 'B', 'm');
    T(svg, LX, yC, 'C', 'm t10');
    T(svg, LX, yS, 'S', 'm');
    const ta = [], tb = [], cells = [], ts = [], tc = [];
    for (let i = 0; i < n; i++) {
      ta.push(T(svg, cx(i), yA, bit(a, i), bit(a, i) ? 'b1' : 'b0'));
      tb.push(T(svg, cx(i), yB, bit(b, i), bit(b, i) ? 'b1' : 'b0'));
      cells.push(R(svg, cx(i) - cw / 2 + 1, cT, cw - 2, cH, 'bx', 2));
      if (cw >= 15) T(svg, cx(i), cT + 7, i === 0 && halfAt0 ? 'HA' : 'FA', 'm t10');
      ts.push(T(svg, cx(i), yS, sm[i], (sm[i] ? 'hi bold' : 'b0') + ' t12'));
    }
    const chainD = `M${f1(edge(0))} ${cT + cH - 5}H${f1(edge(n) - 3)}`;
    P(svg, chainD, 'w mu');
    const chain = LP(svg, chainD);
    for (let k = 0; k <= n; k++) {
      if (k === 0 && halfAt0) { tc.push(null); continue; }
      tc.push(T(svg, edge(k), yC, c[k], (c[k] ? 'hi bold' : 'b0') + ' t10'));
    }
    const rl = T2(svg, 4, yR, [[(s.rLabel ? fit(s.rLabel, 22) : 'Sum') + ' = ', 's'], [hx(r, n), 'hi t13']], 'start');
    const rr = T2(svg, W - 4, yR, [['carry out = ', 's'], [String(cout), 'hi bold'], [sub ? `, so CF = ${cout ^ 1}` : '', 's']], 'end');

    // inset: the cell where the carry is now
    R(svg, 2, iT, W - 4, 90, 'inset', 6);
    const ti = T(svg, 10, iT + 9, '', 'st', 'start');
    // full adder = HA + HA + OR
    const gF = G(svg, null, { transform: `translate(0 ${iT})` });
    const yA2 = 30, yB2 = 44, yCi = 60, yO = 65;
    T(gF, 12, yA2, 'a', 'm', 'start'); const fa = T(gF, 30, yA2, '0', 'b1');
    T(gF, 12, yB2, 'b', 'm', 'start'); const fb = T(gF, 30, yB2, '0', 'b1');
    T(gF, 8, yCi, 'cin', 'm t10', 'start'); const fc = T(gF, 30, yCi, '0', 'b1');
    const wA = P(gF, `M37 ${yA2}H48`), wB = P(gF, `M37 ${yB2}H48`), wC = P(gF, `M37 ${yCi}H140`);
    R(gF, 48, 21, 50, 32, 'bx', 4); T(gF, 73, 31, 'HA', 'bold'); T(gF, 73, 44, 'XOR, AND', 's t10');
    R(gF, 140, 21, 50, 46, 'bx', 4); T(gF, 165, 36, 'HA', 'bold'); T(gF, 165, 50, 'XOR, AND', 's t10');
    const wS1 = P(gF, `M98 ${yA2}H140`), wC1 = P(gF, `M98 ${yB2}H116V75H208V${yO + 5}H219`), wC2 = P(gF, `M190 ${yCi}H219`);
    const fs1 = T(gF, 119, yA2 - 6, '0', 't10'), fc1 = T(gF, 124, yB2 + 7, '0', 't10'), fc2 = T(gF, 204, yCi - 6, '0', 't10');
    gate(gF, 'or', 218, yO, 26, 20, 0);
    const wS = P(gF, `M190 ${yA2}H262`), wCo = P(gF, `M244 ${yO}H262`);
    const fS = T2(gF, 266, yA2, [['S = ', 'm'], ['0', 'b1']]), fCo = T2(gF, 266, yO, [['cout = ', 'm t10'], ['0', 'b1']]);
    // half adder = XOR + AND
    const gH = G(svg, null, { transform: `translate(0 ${iT + 6})` });   // below the title line
    T(gH, 12, 32, 'a', 'm', 'start'); const ha = T(gH, 30, 32, '0', 'b1');
    T(gH, 12, 58, 'b', 'm', 'start'); const hb = T(gH, 30, 58, '0', 'b1');
    const hwA = P(gH, 'M37 32H90V27H130M90 32V56H130'), hwB = P(gH, 'M37 58H104V37H130M104 58V66H130');
    svgEl('circle', { cx: 90, cy: 32, r: 2, class: 'dot m' }, gH); svgEl('circle', { cx: 104, cy: 58, r: 2, class: 'dot m' }, gH);
    // the gate names sit over the output wires, clear of the gates and of the title
    gate(gH, 'xor', 130, 32, 26, 20, 0); T(gH, 162, 26, 'XOR', 's t10', 'start');
    gate(gH, 'and', 130, 61, 26, 20, 0); T(gH, 162, 55, 'AND', 's t10', 'start');
    const hwS = P(gH, 'M156 32H262'), hwC = P(gH, 'M156 61H262');
    const hS = T2(gH, 266, 32, [['S = ', 'm'], ['0', 'b1']]), hC = T2(gH, 266, 61, [['cout = ', 'm t10'], ['0', 'b1']]);
    const setBit = (e, v) => { txt(e, v); cl(e, 'hi', v); };
    const setPart = (e, v) => { const t = e.lastChild; txt(t, v); cl(t, 'hi', v); };
    let lastK = -1;
    function inset(k) {
      if (k === lastK) return;
      lastK = k;
      const ai = bit(a, k), bi = bit(b, k), ci = c[k];
      if (k === 0 && halfAt0) {
        show(gF, false); show(gH, true);
        txt(ti, `Bit 0 is a half adder: XOR gives S, AND gives the carry.`);
        setBit(ha, ai); setBit(hb, bi);
        cl(hwA, 'on', ai); cl(hwB, 'on', bi); cl(hwS, 'on', ai ^ bi); cl(hwC, 'on', ai & bi);
        setPart(hS, ai ^ bi); setPart(hC, ai & bi);
        return;
      }
      show(gF, true); show(gH, false);
      txt(ti, `Bit ${k}: a full adder = 2 half adders + 1 OR gate.`);
      const s1 = ai ^ bi, c1 = ai & bi, S = s1 ^ ci, c2 = s1 & ci, co = c1 | c2;
      setBit(fa, ai); setBit(fb, bi); setBit(fc, ci); setBit(fs1, s1); setBit(fc1, c1); setBit(fc2, c2);
      cl(wA, 'on', ai); cl(wB, 'on', bi); cl(wC, 'on', ci); cl(wS1, 'on', s1); cl(wC1, 'on', c1); cl(wC2, 'on', c2);
      cl(wS, 'on', S); cl(wCo, 'on', co);
      setPart(fS, S); setPart(fCo, co);
    }
    return {
      h: iT + 92,
      up(u) {
        const p = u >= 0.84 ? n : seg(u, 0.06, 0.84) * n;
        for (let i = 0; i < n; i++) {
          const act = p >= i && p < i + 1;
          cl(cells[i], 'on', act); cl(cells[i], 'dn', p >= i + 1);
          cl(ta[i], 'hi', act); cl(tb[i], 'hi', act);
          op(ts[i], clamp((p - i - 0.5) * 2, 0, 1));
        }
        for (let k = 1; k <= n; k++) op(tc[k], clamp((p - k + 0.5) * 2, 0, 1));
        lit(chain, p / n);
        const e = seg(u, 0.84, 0.95);
        op(rl, e); op(rr, e);
        inset(clamp(Math.floor(p), 0, n - 1));
      },
    };
  }

  // ---- generic ALU box ----------------------------------------------------------------
  function bAlu(svg, s) {
    const n = clamp(num(s.width, 16), 1, 32);
    const opn = fit(upper(s.op) || 'ALU', 6);
    const a = norm(num(s.a), n), b = norm(num(s.b), n), r = norm(num(s.r), n);
    T(svg, 4, 9, `The ALU does ${opn} on the two inputs.`, 's', 'start');
    const bxA = R(svg, 30, 22, 110, 26, 'bx'), bxB = R(svg, 180, 22, 110, 26, 'bx');
    T2(svg, 85, 35, [[fit(s.aLabel || 'A', 8) + ' ', 's'], [hx(a, n), 'b1 t12']], 'middle');
    T2(svg, 235, 35, [[fit(s.bLabel || 'B', 8) + ' ', 's'], [hx(b, n), 'b1 t12']], 'middle');
    const wa = LP(svg, 'M85 48V60'), wb = LP(svg, 'M235 48V60');
    P(svg, 'M85 48V60M235 48V60', 'w');
    const alu = svgEl('path', { d: 'M40 60H140L160 76L180 60H280L232 102H88Z', class: 'bx' }, svg);
    T(svg, 160, 88, opn, 't13 hi');
    P(svg, 'M160 102V116', 'w');
    const wr = LP(svg, 'M160 102V116');
    const bxR = R(svg, 100, 116, 120, 26, 'bx');
    const tr = T2(svg, 160, 129, [[fit(s.rLabel || 'R', 10) + ' ', 's'], [hx(r, n), 'hi t13']], 'middle');
    return {
      h: 148,
      up(u) {
        const e1 = seg(u, 0, 0.3);
        cl(bxA, 'on', u < 0.35); cl(bxB, 'on', u < 0.35);
        lit(wa, e1); lit(wb, e1);
        cl(alu, 'on', u >= 0.3 && u < 0.7); cl(alu, 'dn', u >= 0.7);
        lit(wr, seg(u, 0.65, 0.8));
        cl(bxR, 'on', u >= 0.8);
        op(tr, seg(u, 0.75, 0.9));
      },
    };
  }

  // ---- logic -------------------------------------------------------------------------
  const ARITH = { ADD: 0, ADC: 0, INC: 0, SUB: 1, SBB: 1, CMP: 1, DEC: 1, NEG: 1 };
  const LOGIC_TXT = {
    AND: 'AND: an output bit is 1 only if both input bits are 1.',
    TEST: 'TEST: an AND that only sets the flags. It keeps no result.',
    OR: 'OR: an output bit is 1 if one or both input bits are 1.',
    XOR: 'XOR: an output bit is 1 if the two input bits are different.',
    NOT: 'NOT: each output bit is the opposite of its input bit.',
  };
  function bLogic(svg, s) {
    const opn = upper(s.op || 'AND');
    if (opn in ARITH) {
      const a = num(s.a), b = num(s.b, 1);
      const t = {
        width: s.width, a: opn === 'NEG' ? 0 : a, b: opn === 'NEG' ? a : (opn === 'INC' || opn === 'DEC') ? 1 : b,
        sub: ARITH[opn] === 1, cin: opn === 'ADC' ? s.cin : 0, borrow: opn === 'SBB' ? num(s.cin, num(s.borrow)) : 0,
        aLabel: s.aLabel, bLabel: s.bLabel, rLabel: s.rLabel || (opn === 'CMP' ? 'A − B (flags only)' : ''),
      };
      return bAdder(svg, t);
    }
    if (!(opn in LOGIC_TXT)) return bAlu(svg, s);
    const type = { AND: 'and', TEST: 'and', OR: 'or', XOR: 'xor', NOT: 'not' }[opn];
    const one = type === 'not';
    const n = clamp(num(s.width, 16), 1, 24);
    const a = norm(num(s.a), n), b = norm(num(s.b), n);
    const r = norm(type === 'and' ? a & b : type === 'or' ? a | b : type === 'xor' ? a ^ b : ~a, n);
    T(svg, 4, 9, LOGIC_TXT[opn], 's', 'start');
    const col = columns(n, 26, W - 6);
    const { cw, cx } = col;
    const LX = col.left - 12;
    const yI = 23, yA = 36, yB = 50, gT = one ? 46 : 60, gL = 16, yR = gT + gL + 12, yRes = yR + 18;
    const H = clamp(cw - 4, 8, 14);
    bitIndexRow(svg, n, cx, yI);
    T(svg, LX, yA, 'A', 'm');
    if (!one) T(svg, LX, yB, 'B', 'm');
    T(svg, LX, yR, 'R', 'm');
    const gs = [], tr = [];
    for (let i = 0; i < n; i++) {
      T(svg, cx(i), yA, bit(a, i), bit(a, i) ? 'b1' : 'b0');
      if (!one) {
        T(svg, cx(i), yB, bit(b, i), bit(b, i) ? 'b1' : 'b0');
        L(svg, cx(i) - H / 4, yB + 7, cx(i) - H / 4, gT, 'w thin');
        L(svg, cx(i) + H / 4, yB + 7, cx(i) + H / 4, gT, 'w thin');
      } else L(svg, cx(i), yA + 7, cx(i), gT, 'w thin');
      gs.push(gate(svg, type, cx(i), gT, gL, H));
      L(svg, cx(i), gT + gL, cx(i), yR - 7, 'w thin');
      tr.push(T(svg, cx(i), yR, bit(r, i), (bit(r, i) ? 'hi bold' : 'b0') + ' t12'));
    }
    const sym = { and: 'AND', or: 'OR', xor: 'XOR' }[type];
    const res = T2(svg, 4, yRes, one
      ? [['NOT ', 's'], [fit(s.aLabel || 'A', 12), 's'], [' = ', 's'], [hx(r, n), 'hi t13']]
      : [[`${fit(s.aLabel || 'A', 10)} ${sym} ${fit(s.bLabel || 'B', 10)} = `, 's'], [hx(r, n), 'hi t13'],
        [opn === 'TEST' ? '  (only the flags change)' : '', 's']], 'start');
    return {
      h: yRes + 10,
      up(u) {
        const p = u >= 0.82 ? n : seg(u, 0.08, 0.82) * n;
        for (let i = 0; i < n; i++) {
          cl(gs[i], 'on', p >= i); cl(gs[i], 'one', p >= i + 1 && bit(r, i));
          op(tr[i], clamp((p - i - 0.4) * 2, 0, 1));
        }
        op(res, seg(u, 0.82, 0.94));
      },
    };
  }

  // ---- shift / rotate ---------------------------------------------------------------
  const SHIFT_TXT = {
    SHL: 'The top bit goes to CF. A 0 comes in at bit 0.',
    SHR: 'Bit 0 goes to CF. A 0 comes in at the top bit.',
    SAR: 'Bit 0 goes to CF. The sign bit stays and copies down.',
    ROL: 'The top bit goes to CF and also to bit 0.',
    ROR: 'Bit 0 goes to CF and also to the top bit.',
    RCL: 'The top bit goes to CF. The old CF goes to bit 0.',
    RCR: 'Bit 0 goes to CF. The old CF goes to the top bit.',
  };
  function bShift(svg, s) {
    let opn = upper(s.op || 'SHL');
    if (opn === 'SAL') opn = 'SHL';
    if (!(opn in SHIFT_TXT)) opn = 'SHL';
    const n = clamp(num(s.width, 16), 2, 24);
    const m = maskN(n);
    const count = clamp(num(s.count, 1), 0, 64);
    const left = opn === 'SHL' || opn === 'ROL' || opn === 'RCL';
    const a = norm(num(s.a), n);
    const run = cf0 => {
      const st = [{ v: a, cf: cf0, out: 0, inb: 0 }];
      let v = a, cf = cf0;
      for (let k = 0; k < count; k++) {
        let out, inb;
        if (left) {
          out = bit(v, n - 1);
          inb = opn === 'SHL' ? 0 : opn === 'ROL' ? out : cf;
          v = (((v << 1) & m) | inb) >>> 0;
        } else {
          out = v & 1;
          inb = opn === 'SHR' ? 0 : opn === 'SAR' ? bit(v, n - 1) : opn === 'ROR' ? out : cf;
          v = ((v >>> 1) | (inb << (n - 1))) >>> 0;
        }
        cf = out;
        st.push({ v, cf, out, inb });
      }
      return st;
    };
    let cf0 = num(s.cf, -1);
    if (cf0 < 0) {
      cf0 = 0;
      if ((opn === 'RCL' || opn === 'RCR') && s.r !== undefined && s.r !== null) {
        if (run(0)[count].v !== norm(num(s.r), n) && run(1)[count].v === norm(num(s.r), n)) cf0 = 1;
      }
    }
    cf0 &= 1;
    const st = run(cf0);
    T(svg, 4, 9, `${opn} by ${count}: the bits move ${count} place${count === 1 ? '' : 's'} to the ${left ? 'left' : 'right'}.`, 'st', 'start');
    T(svg, 4, 23, SHIFT_TXT[opn], 's', 'start');
    const exSide = 36, enSide = 32;
    const col = columns(n, left ? exSide + 6 : enSide + 6, W - (left ? enSide : exSide) - 6, 26);
    const { cw, cx } = col;
    const yI = 37, yOld = 50, rT = 60, rY = 70, rB = 80;
    const cfX = left ? col.left - 12 - 13 : col.right + 12 + 13;
    const srcX = left ? col.right + 10 + 11 : col.left - 10 - 11;
    const exitI = left ? n - 1 : 0, entryI = left ? 0 : n - 1;
    bitIndexRow(svg, n, cx, yI);
    for (let i = 0; i < n; i++) T(svg, cx(i), yOld, bit(a, i), 'm t10');
    T(svg, left ? col.right + 4 : col.left - 4, yOld, 'old', 's t10', left ? 'start' : 'end');
    for (let i = 0; i < n; i++) R(svg, cx(i) - cw / 2 + 0.5, rT, cw - 1, rB - rT, 'bx', 2);
    const cfBox = R(svg, cfX - 13, 52, 26, 32, 'bx', 4);
    T(svg, cfX, 58, 'CF', 'm t10');
    const cfT = T(svg, cfX, rY + 2, cf0, 'b1 t12');
    // the source of the new bit
    if (opn === 'SHL' || opn === 'SHR') {
      R(svg, srcX - 10, rT, 20, rB - rT, 'bx dash', 3);
      T(svg, srcX, rB + 8, 'zero', 's t10');
    } else if (opn === 'SAR') {
      P(svg, `M${f1(cx(n - 1))} ${rT}C${f1(cx(n - 1))} ${rT - 12} ${f1(srcX)} ${rT - 12} ${f1(srcX)} ${rT - 1}`, 'w on');
      AH(svg, srcX, rT - 1, 'd', 'ar', 3);
      T(svg, srcX - 8, rB + 8, 'copy of the sign', 's t10', 'start');
    } else {
      const fromX = opn === 'ROL' || opn === 'ROR' ? cx(exitI) : cfX;
      const fromY = opn === 'ROL' || opn === 'ROR' ? rB : 84;
      P(svg, `M${f1(fromX)} ${fromY}V90H${f1(srcX)}V${rB + 1}`, 'w on');
      AH(svg, srcX, rB + 1, 'u', 'ar', 3);
    }
    const bits = [];
    for (let i = 0; i < n; i++) bits.push(T(svg, cx(i), rY, '0', 'b1 t12'));
    const inT = T(svg, srcX, rY, '0', 'hi t12');
    const res = T(svg, 4, 106, '', 'st', 'start');
    let lastS = -1;
    return {
      h: 114,
      up(u) {
        if (!count) {
          for (let i = 0; i < n; i++) { txt(bits[i], bit(a, i)); cl(bits[i], 'b0', !bit(a, i)); }
          op(inT, 0);
          txt(res, `Count = 0: nothing changes. The value stays ${hx(a, n)}.`);
          return;
        }
        const P0 = seg(u, 0.08, 0.9) * count;
        const sI = Math.min(Math.floor(P0), count - 1);
        const f = easeInOut(clamp(P0 - sI, 0, 1));
        const cur = st[sI], nxt = st[sI + 1];
        if (sI !== lastS) {
          lastS = sI;
          for (let i = 0; i < n; i++) { const v = bit(cur.v, i); txt(bits[i], v); cl(bits[i], 'b0', !v); cl(bits[i], 'hi', i === exitI); }
          txt(cfT, cur.cf);
          txt(inT, nxt.inb);
        }
        for (let i = 0; i < n; i++) {
          const j = left ? i + 1 : i - 1;
          const x = i === exitI ? lerp(cx(i), cfX, f) : lerp(cx(i), cx(j), f);
          set(bits[i], 'x', f1(x));
        }
        set(inT, 'x', f1(lerp(srcX, cx(entryI), f)));
        op(inT, f > 0 || u > 0.08 ? 1 : 0);
        op(cfT, 1 - f);
        cl(cfBox, 'on', f > 0.5);
        txt(res, u >= 0.9 ? `Result: ${hx(st[count].v, n)}   CF = ${st[count].cf}` : `Step ${sI + 1} of ${count}`);
      },
    };
  }

  // ---- bytes (prefetch queue, small buffers) -------------------------------------------
  function bBytes(svg, s) {
    const cells = (Array.isArray(s.cells) ? s.cells : []).slice(0, 32)
      .map(c => (c && typeof c === 'object' ? { v: num(c.v) & 0xFF, label: c.label } : { v: num(c) & 0xFF }));
    const take = new Set((Array.isArray(s.take) ? s.take : []).map(Number));
    const put = new Set((Array.isArray(s.put) ? s.put : []).map(Number));
    const init = [], fin = [];
    cells.forEach((c, i) => { if (!put.has(i)) init.push(i); if (!take.has(i)) fin.push(i); });
    const cap = clamp(Math.max(num(s.cap, 6), init.length, fin.length), 1, 32);
    // more than 8 bytes (a cache line): rows of 8, the first row at the top
    const per = cap > 8 ? 8 : cap, rows = Math.ceil(cap / per), RP = 38, dy = (rows - 1) * RP;
    const sw = Math.min(40, (W - 116) / per);
    const slotX = k => W - 58 - ((k % per) + 0.5) * sw;   // slot 0 (the next byte out) is at the right
    const yT = 26, yH = 34, yC = yT + yH / 2;
    const slotY = k => yC + Math.floor(k / per) * RP;
    T(svg, 4, 9, fit(s.inLabel || 'in: from the bus', 28), 's', 'start');
    T(svg, W - 4, 9, fit(s.outLabel || 'out: to the EU', 28), 's', 'end');
    for (let k = 0; k < cap; k++) R(svg, slotX(k) - sw / 2 + 2, slotY(k) - yH / 2, sw - 4, yH, 'bx dash', 3);
    const inR = slotX(per - 1) - sw / 2 - 2, outL = slotX(0) + sw / 2 + 2;
    P(svg, `M6 ${yC}H${f1(inR - 1)}`, 'w'); const aIn = AH(svg, inR, yC, 'r', 'ar off');
    P(svg, `M${f1(outL)} ${yC}H${W - 8}`, 'w'); const aOut = AH(svg, W - 6, yC, 'r', 'ar off');
    T(svg, slotX(0), yT + yH + 8 + dy, rows > 1 ? '' : 'next', 's t10');
    if (cap > 1) T(svg, slotX(cap - 1), yT + yH + 8 + dy, 'last', 's t10');
    const tiles = cells.map((c, i) => {
      const g = G(svg, take.has(i) ? 'cE' : null);
      const bx = R(g, -sw / 2 + 3, -yH / 2 + 1, sw - 6, yH - 2, 'bx dn', 3);
      T(g, 0, c.label ? -4 : 0, hex2(c.v), 'b1 t13');
      if (c.label) T(g, 0, 9, fit(c.label, Math.max(2, Math.floor((sw - 4) / 5.2))), 's t10');
      const k0 = put.has(i) ? fin.indexOf(i) : init.indexOf(i), k1 = take.has(i) ? init.indexOf(i) : fin.indexOf(i);
      return { g, bx, i, x0: put.has(i) ? -30 : slotX(k0), x1: take.has(i) ? W - 22 : slotX(k1), y0: slotY(Math.max(0, k0)), y1: slotY(Math.max(0, k1)) };
    });
    const nNote = s.note ? T(svg, 4, 86 + dy, fit(s.note, 58), 'st', 'start') : null;
    const cnt = T(svg, 4, (nNote ? 101 : 86) + dy, '', 's', 'start');
    const wT = take.size ? [0.02, 0.45] : null;
    const wS = take.size ? [0.4, 0.65] : [0.05, 0.3];
    const wP = take.size ? [0.55, 0.95] : [0.1, 0.8];
    return {
      h: (nNote ? 110 : 96) + dy,
      up(u) {
        for (const t of tiles) {
          let x, y = lerp(t.y0, t.y1, easeInOut(seg(u, wS[0], wS[1]))), o = 1;
          if (take.has(t.i)) {
            const e = seg(u, wT[0], wT[1]);
            y -= 8 * easeOut(seg(e, 0, 0.3));
            x = lerp(t.x0, t.x1, easeInOut(seg(e, 0.2, 0.85)));
            o = 1 - seg(e, 0.85, 1);
            cl(t.bx, 'on', e > 0 && e < 1);
          } else if (put.has(t.i)) {
            const e = seg(u, wP[0], wP[1]);
            x = lerp(t.x0, t.x1, easeInOut(e));
            o = seg(e, 0, 0.15);
            cl(t.bx, 'on', e > 0 && e < 1);
          } else x = lerp(t.x0, t.x1, easeInOut(seg(u, wS[0], wS[1])));
          move(t.g, x, y);
          op(t.g, o);
        }
        cl(aOut, 'off', !(take.size && u > wT[0] && u < wT[1]));
        cl(aIn, 'off', !(put.size && u > wP[0] && u < wP[1]));
        const n = u >= 0.95 ? fin.length : init.length;
        txt(cnt, `${u >= 0.95 ? 'Now' : 'Before'}: ${n} of ${cap} bytes.` +
          (take.size ? ` ${take.size} out.` : '') + (put.size ? ` ${put.size} in.` : ''));
      },
    };
  }

  // ---- register file --------------------------------------------------------------------
  const REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
  const REG8 = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'];
  const SREG = ['ES', 'CS', 'SS', 'DS'];
  function bRegs(svg, s) {
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
    const reads = (Array.isArray(s.read) ? s.read : s.read ? [s.read] : []).map(find).filter(Boolean);
    const oldV = w ? regs[w.i].v : 0;
    let newV = num(s.v) & 0xFFFF;
    if (w && w.half === 'L') newV = (oldV & 0xFF00) | (num(s.v) & 0xFF);
    if (w && w.half === 'H') newV = (oldV & 0x00FF) | ((num(s.v) & 0xFF) << 8);
    const y0 = 22, rh = 17;
    const bxX = 96, bxW = 58;
    const ry = i => y0 + i * rh + rh / 2;
    T(svg, 4, 9, `${regs.length} registers, 16 bits each.`, 's', 'start');
    if (reads.length) T(svg, W - 4, 9, 'read: out to the ALU', 's', 'end');
    const rows = regs.map((r, i) => {
      const yy = ry(i);
      T(svg, bxX - 8, yy, r.name, 'm', 'end');
      const box = R(svg, bxX, yy - rh / 2 + 1.5, bxW, rh - 3, 'bx', 3);
      return { box, yy, t: w && w.i === i ? null : T(svg, bxX + bxW / 2, yy, hex4(r.v), 'b1 t12') };
    });
    const rdEls = reads.map(rd => {
      const yy = ry(rd.i);
      const v = regs[rd.i].v;
      const vs = rd.half === 'L' ? hex2(v) : rd.half === 'H' ? hex2(v >> 8) : hex4(v);
      P(svg, `M${bxX + bxW + 2} ${yy}H${W - 30}`, 'w thin');
      const ln = LP(svg, `M${bxX + bxW + 2} ${yy}H${W - 30}`);
      const ah = AH(svg, W - 26, yy, 'r', 'ar off', 3.5);
      const tv = T(svg, bxX + bxW + 22, yy - 7, vs, 'hi t10 bold');
      return { rd, ln, ah, tv };
    });
    let wr = null;
    if (w) {
      const i = w.i, yy = ry(i);
      const cid = `bk-clip-${++uid}`;
      const cp = svgEl('clipPath', { id: cid }, svg);
      R(cp, bxX, yy - rh / 2 + 1.5, bxW, rh - 3, 'bx', 3);
      const g = G(svg, null, { 'clip-path': `url(#${cid})` });
      const mk = (v, hiHalf) => T2(g, bxX + bxW / 2, yy, [[hex2(v >> 8), hiHalf === 'H' || !hiHalf ? 'hi bold' : 'b1'], [hex2(v), hiHalf === 'L' || !hiHalf ? 'hi bold' : 'b1']], 'middle', 't12');
      const tOld = T(g, bxX + bxW / 2, yy, hex4(oldV), 'b1 t12');
      const tNew = mk(newV, w.half);
      P(svg, `M8 ${yy}H${bxX - 34}`, 'w thin');
      const ln = LP(svg, `M8 ${yy}H${bxX - 34}`);
      const ah = AH(svg, bxX - 30, yy, 'r', 'ar off', 3.5);
      const tv = T(svg, 26, yy - 8, (w.half ? hex2(num(s.v)) : hex4(newV)), 'hi t10 bold');
      wr = { i, yy, tOld, tNew, ln, ah, tv };
    }
    const cap = [];
    if (w) cap.push(`${upper(s.write)}: ${w.half ? hex2(w.half === 'H' ? oldV >> 8 : oldV) : hex4(oldV)}h → ${w.half ? hex2(num(s.v)) : hex4(newV)}h.`);
    if (reads.length) cap.push(`Read: ${(Array.isArray(s.read) ? s.read : [s.read]).map(upper).join(', ')}.`);
    const yCap = y0 + regs.length * rh + 10;
    const capT = T(svg, 4, yCap, cap.join('  '), 'st', 'start');
    const rw = reads.length ? [0.02, 0.5] : null;
    const ww = reads.length ? [0.45, 0.95] : [0.05, 0.9];
    return {
      h: yCap + 9,
      up(u) {
        for (const r of rdEls) {
          const e = seg(u, rw[0], rw[1]);
          cl(rows[r.rd.i].box, 'on', u > 0);
          lit(r.ln, seg(e, 0, 0.6));
          cl(r.ah, 'off', e < 0.6);
          set(r.tv, 'x', f1(lerp(bxX + bxW + 22, W - 48, easeInOut(seg(e, 0.1, 1)))));
          op(r.tv, e > 0 ? 1 : 0);
        }
        if (wr) {
          const e = seg(u, ww[0], ww[1]);
          lit(wr.ln, seg(e, 0, 0.35));
          cl(wr.ah, 'off', e < 0.35);
          op(wr.tv, seg(e, 0, 0.1) * (1 - seg(e, 0.45, 0.6)));
          const k = easeInOut(seg(e, 0.4, 0.85));
          set(wr.tOld, 'y', f1(wr.yy - k * rh));
          set(wr.tNew, 'y', f1(wr.yy + (1 - k) * rh));
          cl(rows[wr.i].box, 'on', e > 0.3);
        }
        op(capT, seg(u, 0.05, 0.2));
      },
    };
  }

  // ---- windows of numbered lines (decoder outputs, mux inputs) ----------------------------
  function lineWindow(N, sel, x0, x1) {
    const count = Math.min(N, 16);
    const start = clamp(sel - 7, 0, N - count);
    const pre = start > 0, post = start + count < N;
    const slots = count + (pre ? 1 : 0) + (post ? 1 : 0);
    const sp = Math.min(22, (x1 - x0) / slots);
    const left = (x0 + x1) / 2 - (slots * sp) / 2;
    const xs = [];
    for (let k = 0; k < count; k++) xs.push(left + (k + (pre ? 1 : 0) + 0.5) * sp);
    return { count, start, pre, post, sp, xs, preX: left + sp / 2, postX: left + (slots - 0.5) * sp };
  }
  function lineNumbers(p, win, digits, y, up, cls) {
    const rot = digits * 6.4 > win.sp - 2;
    const els = [];
    for (let k = 0; k < win.count; k++) {
      const v = hex(win.start + k, digits);
      const x = win.xs[k];
      const e = T(p, x, y, v, cls || 'm t10', rot ? (up ? 'start' : 'end') : 'middle');
      if (rot) e.setAttribute('transform', `rotate(-90 ${f1(x)} ${f1(y)})`);
      els.push(e);
    }
    return { els, rot };
  }

  // ---- decoder -----------------------------------------------------------------------
  function bDecoder(svg, s) {
    const n = clamp(num(s.bits, 3), 1, 9);
    const N = 1 << n;
    const sel = norm(num(s.value), n);
    const digits = Math.max(1, Math.ceil(n / 4));
    T2(svg, 4, 9, [[fit(s.inLabel || 'input', 22) + ': ', 's'], [bin(sel, n), 'b1'], [' = ' + hx(sel, n), 's']], 'start');
    const tw = Math.min(26, 280 / n);
    const tx = i => W / 2 + ((n - 1) / 2 - i) * tw;   // bit i, MSB at the left
    const ins = [], wires = [];
    for (let i = 0; i < n; i++) {
      const v = bit(sel, i);
      ins.push(R(svg, tx(i) - tw / 2 + 2, 20, tw - 4, 18, 'bx', 3));
      T(svg, tx(i), 29, v, v ? 'b1' : 'b0');
      P(svg, `M${f1(tx(i))} 38V50`, 'w thin');
      wires.push(v ? LP(svg, `M${f1(tx(i))} 38V50`) : null);
    }
    const dec = R(svg, 14, 50, W - 28, 22, 'bx', 4);
    T(svg, W / 2, 61, `${n}-to-${N} decoder: one output line is 1`, 's');
    const win = lineWindow(N, sel, 16, W - 16);
    const selK = sel - win.start;
    for (let k = 0; k < win.count; k++) if (k !== selK) P(svg, `M${f1(win.xs[k])} 72V104`, 'w thin');
    if (win.pre) T(svg, win.preX, 88, '…', 'm');
    if (win.post) T(svg, win.postX, 88, '…', 'm');
    P(svg, `M${f1(win.xs[selK])} 72V104`, 'w');
    const out = LP(svg, `M${f1(win.xs[selK])} 72V104`);
    const dot = svgEl('circle', { cx: f1(win.xs[selK]), cy: 106, r: 3, class: 'dot', opacity: 0 }, svg);
    const nums = lineNumbers(svg, win, digits, 113, false);
    const yEnd = nums.rot ? 113 + digits * 6.4 + 12 : 126;
    const cap = T2(svg, 4, yEnd, [[fit(s.outLabel || 'output', 22) + ': ', 's'], [`line ${hx(sel, n)} = 1`, 'hi bold'], [', all others = 0', 's']], 'start');
    return {
      h: yEnd + 9,
      up(u) {
        const e = seg(u, 0, 0.3);
        ins.forEach((b, i) => cl(b, 'on', bit(sel, i) && e > 0.1 && u < 0.7));
        wires.forEach(wl => wl && lit(wl, e));
        cl(dec, 'on', u >= 0.3 && u < 0.55); cl(dec, 'dn', u >= 0.55);
        lit(out, seg(u, 0.5, 0.82));
        op(dot, u >= 0.82 ? 1 : 0);
        nums.els.forEach((t, k) => cl(t, 'hi', k === selK && u >= 0.82));
        nums.els.forEach((t, k) => cl(t, 'bold', k === selK && u >= 0.82));
        op(cap, seg(u, 0.82, 0.95));
      },
    };
  }

  // ---- memory cell array (DRAM, ROM) ------------------------------------------------------
  function bCells(svg, s) {
    const memS = String(s.mem || s.cell || s.type || s.tech || 'dram').toLowerCase();
    const rom = memS.includes('rom');
    const Rn = clamp(num(s.rows, 8), 2, 12), Cn = clamp(num(s.cols, 8), 2, 12);
    const row = clamp(num(s.row, Rn >> 1), 0, Rn - 1), col = clamp(num(s.col, Cn >> 1), 0, Cn - 1);
    const write = !!s.write && !rom;
    const val = Math.max(0, num(s.bit, 1));
    const b0 = val & 1;
    const valTxt = val > 1 ? hx(val, 8) : String(val);
    const gx = 62, gy = 24;
    const cw = Math.min(23, 184 / Cn), rh = Math.min(14, 112 / Rn);
    const gw = Cn * cw, gh = Rn * rh;
    const xc = c => gx + (c + 0.5) * cw, yr = r => gy + (r + 0.5) * rh;
    const X = xc(col), Y = yr(row);
    T(svg, X, 10, fit(s.colLabel || `column ${col}`, 18), 'hi t10 cD');
    T(svg, gx - 8, Y, fit(s.rowLabel || `row ${row}`, 10), 'hi t10 cA', 'end');
    for (let r = 0; r < Rn; r++) L(svg, gx - 4, yr(r), gx + gw, yr(r), 'w thin');
    const bot = gy + gh + 4;
    for (let c = 0; c < Cn; c++) L(svg, xc(c), gy - 2, xc(c), bot, 'w thin');
    const wl = LP(svg, `M${gx - 4} ${f1(Y)}H${f1(gx + gw)}`, 'cA');
    let selCell = null;
    for (let r = 0; r < Rn; r++) for (let c = 0; c < Cn; c++) {
      const cxp = xc(c) + cw * 0.3, cyp = yr(r) + rh * 0.22;
      const e = rom ? R(svg, cxp - 3.5, cyp - 2.5, 7, 5, 'cg', 1) : svgEl('circle', { cx: f1(cxp), cy: f1(cyp), r: 2.6, class: 'cg' }, svg);
      if (r === row && c === col) { selCell = e; e.setAttribute('class', 'cg sel'); }
    }
    selCell.parentNode.appendChild(selCell);
    // the path below the array
    let saT = bot + 2, muxY, oY, blPath, outPath, sa = [];
    if (!rom) {
      for (let c = 0; c < Cn; c++) sa.push(svgEl('path', { d: `M${f1(xc(c) - 5)} ${saT}H${f1(xc(c) + 5)}L${f1(xc(c))} ${saT + 10}Z`, class: 'bx' }, svg));
      T(svg, gx - 8, saT + 5, 'sense amps', 's t10', 'end');
      muxY = saT + 16;
    } else muxY = bot + 4;
    const mux = R(svg, gx - 3, muxY, gw + 6, 9, 'bx', 2);
    T(svg, gx - 8, muxY + 4.5, 'column mux', 's t10', 'end');
    oY = muxY + 22;
    const outX = gx + gw + 6;
    if (rom) {
      svgEl('path', { d: `M${f1(X)} ${muxY + 9}V${oY}H${f1(outX)}`, class: 'w thin' }, svg);
      sa.push(svgEl('path', { d: `M${f1(outX)} ${oY - 6}V${oY + 6}L${f1(outX + 10)} ${oY}Z`, class: 'bx' }, svg));
      T(svg, outX + 5, oY - 13, 'sense amp', 's t10');
    } else svgEl('path', { d: `M${f1(X)} ${muxY + 9}V${oY}H${f1(outX + 10)}`, class: 'w thin' }, svg);
    const bottomBL = rom ? muxY : saT;
    blPath = write ? `M${f1(X)} ${bottomBL}V${f1(Y)}` : `M${f1(X)} ${f1(Y)}V${bottomBL}`;
    const bl = LP(svg, blPath, 'cD');
    outPath = write ? `M${f1(outX + 10)} ${oY}H${f1(X)}V${rom ? muxY + 9 : saT + 10}` : `M${f1(X)} ${rom ? muxY + 9 : saT + 10}V${oY}H${f1(outX + 10)}`;
    const ol = LP(svg, outPath, 'cD');
    const dT = T2(svg, outX + (rom ? 14 : 14), oY, [[write ? 'D in ' : 'D out ', 's'], [valTxt, 'hi t13 cD']], 'start');
    // zoom of one cell
    const zx = 258, zy = 20, zg = G(svg, null, { transform: `translate(${zx} ${zy})` });
    R(zg, 0, 0, 58, 112, 'inset', 5);
    T(zg, 29, 9, 'word line', 's t10 cA');
    L(zg, 4, 22, 54, 22, 'w');
    const zW = L(zg, 4, 22, 54, 22, 'wl cA');
    L(zg, 10, 16, 10, 92, 'w');
    const zB = L(zg, 10, 16, 10, 92, 'wl cD');
    T(zg, 29, 102, 'bit line', 's t10 cD');
    let zQ = null, zE = [], zV;
    if (!rom) {
      P(zg, 'M34 22V30M26 30H42M26 34H42M26 34V40H10M42 34V50M34 50H50M34 62H50M42 62V68M36 68H48M38.5 71H45.5', 'w thin ms');
      zQ = R(zg, 34, 51.5, 16, 9, 'fill cD', 1);
      zV = T(zg, 42, 82, '', 'hi t12 cD');
    } else {
      P(zg, 'M34 22V29M26 29H42M26 42H42M26 42V50H10M42 42V58M36 58H48M38.5 61H45.5', 'w thin ms');
      R(zg, 26, 32, 16, 6, 'bx', 1);
      if (!b0) for (let k = 0; k < 3; k++) zE.push(svgEl('circle', { cx: 29.5 + k * 4.5, cy: 35, r: 1.3, class: 'dot cF' }, zg));
      zV = T(zg, 29, 74, '', 'hi t12 cD');
      T(zg, 29, 87, b0 ? 'erased' : 'programmed', 's t10');
    }
    const capY = oY + 20;
    const cap = T(svg, 4, capY, '', 'st', 'start');
    const CAP = rom
      ? [[0.25, 'The row address turns on one word line.'], [0.5, 'The cell puts its bit on the bit line.'],
        [0.7, 'The column mux selects this column.'], [1.01, `The sense amp gives the bit: ${valTxt}. Erased = 1, programmed = 0.`]]
      : write
        ? [[0.25, 'The row address turns on one word line.'], [0.45, `The data input brings the bit ${valTxt}.`],
          [0.75, 'The sense amp drives the bit line.'], [1.01, `The capacitor charges to ${valTxt}. The cell keeps it.`]]
        : [[0.25, 'The row address turns on one word line.'], [0.5, 'The cells of the row share their charge with the bit lines.'],
          [0.64, 'The sense amp reads the small charge.'], [0.8, 'The sense amp writes the bit back (refresh).'],
          [1.01, `The column mux sends the bit ${valTxt} to the output.`]];
    return {
      h: capY + 10,
      up(u) {
        lit(wl, seg(u, 0, 0.25)); lit(zW, u >= 0.12 ? 1 : 0);
        cl(selCell, 'on', u >= 0.2);
        let q = b0;
        if (rom) {
          lit(bl, seg(u, 0.25, 0.5)); lit(zB, u >= 0.3 ? 1 : 0);
          cl(mux, 'on', u >= 0.5 && u < 0.75); cl(mux, 'dn', u >= 0.75);
          lit(ol, seg(u, 0.55, 0.9));
          cl(sa[0], 'on', u >= 0.75);
          op(dT, seg(u, 0.85, 0.95));
          txt(zV, u >= 0.3 ? String(b0) : '');
        } else if (!write) {
          lit(bl, seg(u, 0.25, 0.5)); lit(zB, u >= 0.3 ? 1 : 0);
          q = b0 * (1 - 0.45 * seg(u, 0.3, 0.5) + 0.45 * seg(u, 0.64, 0.8));
          sa.forEach((e, c) => { cl(e, 'on', c === col && u >= 0.5); cl(e, 'dn', c !== col && u >= 0.5); });
          cl(mux, 'on', u >= 0.8 && u < 0.95); cl(mux, 'dn', u >= 0.95);
          lit(ol, seg(u, 0.8, 0.95));
          op(dT, seg(u, 0.88, 0.98));
          txt(zV, u >= 0.5 ? `= ${b0}` : '');
        } else {
          lit(ol, seg(u, 0.25, 0.45));
          op(dT, seg(u, 0.2, 0.3));
          cl(mux, 'on', u >= 0.3 && u < 0.5); cl(mux, 'dn', u >= 0.5);
          sa.forEach((e, c) => cl(e, 'on', c === col && u >= 0.45));
          lit(bl, seg(u, 0.5, 0.75)); lit(zB, u >= 0.6 ? 1 : 0);
          q = lerp(1 - b0, b0, seg(u, 0.75, 0.95));
          txt(zV, u >= 0.75 ? `= ${b0}` : '');
        }
        if (zQ) op(zQ, 0.08 + 0.92 * q);
        if (!rom) set(selCell, 'style', q > 0.5 ? 'fill: var(--gold)' : '');
        const ph = CAP.find(c => u < c[0]) || CAP[CAP.length - 1];
        txt(cap, ph[1]);
      },
    };
  }

  // ---- multiplexer ----------------------------------------------------------------------
  function bMux(svg, s) {
    const n = clamp(num(s.n, 16), 2, 4096);
    const sel = clamp(num(s.sel), 0, n - 1);
    const bits = Math.ceil(Math.log2(n));
    const digits = Math.max(1, Math.ceil(bits / 4));
    const val = num(s.value, 1);
    T2(svg, 4, 9, [[fit(s.label || 'multiplexer', 26), 'st'], [`: ${n} inputs, 1 output`, 's']], 'start');
    const win = lineWindow(n, sel, 16, W - 16);
    const selK = sel - win.start;
    const nums = lineNumbers(svg, win, digits, 34, true);
    for (let k = 0; k < win.count; k++) P(svg, `M${f1(win.xs[k])} 38V60`, k === selK ? 'w' : 'w thin');
    if (win.pre) T(svg, win.preX, 48, '…', 'm');
    if (win.post) T(svg, win.postX, 48, '…', 'm');
    const inL = LP(svg, `M${f1(win.xs[selK])} 38V60`, 'cD');
    const body = svgEl('path', { d: 'M12 60H308L200 88H120Z', class: 'bx' }, svg);
    const path = LP(svg, `M${f1(win.xs[selK])} 60L160 88`, 'cD');
    P(svg, 'M160 88V108', 'w');
    const outL = LP(svg, 'M160 88V108', 'cD');
    const outT = T2(svg, 168, 106, [['output = ', 's'], [val > 1 ? hx(val, 8) : String(val), 'hi t13 cD']], 'start');
    P(svg, 'M6 104H64V76', 'w');
    const sL = LP(svg, 'M6 104H64V76', 'cA');
    T2(svg, 6, 96, [['select ', 's'], [hx(sel, bits), 'hi cA bold']], 'start');
    const cap = T(svg, 4, 124, `Input ${hx(sel, bits)} connects to the output. The others stay off.`, 'st', 'start');
    return {
      h: 132,
      up(u) {
        lit(sL, seg(u, 0, 0.3));
        cl(body, 'on', u >= 0.3 && u < 0.7); cl(body, 'dn', u >= 0.7);
        lit(inL, seg(u, 0.3, 0.5)); lit(path, seg(u, 0.45, 0.7)); lit(outL, seg(u, 0.7, 0.85));
        nums.els.forEach((t, k) => { cl(t, 'hi', k === selK && u >= 0.3); cl(t, 'bold', k === selK && u >= 0.3); });
        op(outT, seg(u, 0.8, 0.92)); op(cap, seg(u, 0.85, 0.97));
      },
    };
  }

  // ---- D latches ------------------------------------------------------------------------
  function bLatch(svg, s) {
    const n = clamp(num(s.bits, 8), 1, 16);
    const v = norm(num(s.value), n);
    const stb = fit(s.strobe || 'ALE', 6);
    const LM = 46;
    const cw = Math.min(32, (W - LM - 8) / n);
    const cx = i => LM + (n - 1 - i + 0.5) * cw;
    T2(svg, 4, 9, [[fit(s.label || 'address latch', 26), 'st'], [`: ${n} D latches`, 's']], 'start');
    const yD = 26, bT = 38, bB = 68, yQ = 82;
    T(svg, 6, yD, 'D in', 's', 'start');
    T(svg, 6, yQ, 'Q out', 's', 'start');
    P(svg, `M${LM - 14} 53H${f1(cx(0) + cw / 2)}`, 'w');
    const sLine = LP(svg, `M${LM - 14} 53H${f1(cx(0) + cw / 2)}`, 'cC');
    T(svg, 6, 53, stb, 'hi cC bold t10', 'start');
    const dT = [], qT = [], boxes = [];
    for (let i = 0; i < n; i++) {
      const b = bit(v, i);
      dT.push(T(svg, cx(i), yD, b, 'b1'));
      L(svg, cx(i), yD + 6, cx(i), bT, 'w thin');
      boxes.push(R(svg, cx(i) - cw / 2 + 3, bT, cw - 6, bB - bT, 'bx', 3));
      if (cw >= 22) { T(svg, cx(i) - cw / 2 + 8, bT + 7, 'D', 'm t10'); T(svg, cx(i) - cw / 2 + 8, bB - 7, 'Q', 'm t10'); }
      L(svg, cx(i), bB, cx(i), yQ - 6, 'w thin');
      qT.push(T(svg, cx(i), yQ, '–', 'b0'));
    }
    // the strobe wave: low, high (0.2 .. 0.45), low
    const wx0 = LM, wx1 = W - 8, wy0 = 108, wy1 = 96;
    const tx = t => lerp(wx0, wx1, t);
    const wave = `M${wx0} ${wy0}H${f1(tx(0.2))}V${wy1}H${f1(tx(0.45))}V${wy0}H${wx1}`;
    T(svg, 6, 102, stb, 'hi cC t10', 'start');
    P(svg, wave, 'w thin');
    const wl = LP(svg, wave, 'cC');
    const cur = L(svg, wx0, 91, wx0, 113, 'cur');
    T(svg, tx(0.325), 90, 'high', 's t10');
    T(svg, tx(0.75), 101, 'low: hold', 's t10');
    const cap = T(svg, 4, 128, '', 'st', 'start');
    const val = hx(v, n);
    return {
      h: 136,
      up(u) {
        const hi = u >= 0.2 && u < 0.45;
        lit(sLine, hi ? 1 : 0);
        lit(wl, u);
        set(cur, 'x1', f1(tx(u))); set(cur, 'x2', f1(tx(u)));
        const changed = u >= 0.62;
        for (let i = 0; i < n; i++) {
          const b = bit(v, i);
          op(dT[i], changed ? 1 : seg(u, 0, 0.12));
          txt(dT[i], changed ? '–' : b); cl(dT[i], 'b0', changed || !b); cl(dT[i], 'b1', !changed && b);
          const got = u >= 0.22 + 0.02 * (n - 1 - i) / n * 5 || u >= 0.45;
          txt(qT[i], got ? b : '–'); cl(qT[i], 'b0', !got || !b); cl(qT[i], 'hi', got && b); cl(qT[i], 'bold', got && b);
          cl(boxes[i], 'on', hi); cl(boxes[i], 'dn', u >= 0.45);
        }
        txt(cap, u < 0.2 ? `The D inputs get the bits ${val}.` : u < 0.45 ? `${stb} is high: each Q follows its D.`
          : u < 0.62 ? `${stb} goes low: the latches hold ${val}.` : `The bus now carries other bits. Q keeps ${val}.`);
      },
    };
  }

  // ---- timing diagram (signals over the clock states) --------------------------------------
  // s.cols: the names of the columns (the clock states, for example T1..T4); s.rows: [{ name,
  // clk: true, per, duty } a clock with the period per (in columns) and its high part duty, or
  // { name, on: [[a, b], ...], low: true } a signal that is active in the columns a..b (low: an
  // active-low signal, so it is high except there)]; s.caps: [[column, text], ...] the text while
  // the cursor is at that column or after.
  function bWave(svg, s) {
    const cols = (Array.isArray(s.cols) ? s.cols : ['T1', 'T2', 'T3', 'T4']).slice(0, 8), N = cols.length || 1;
    const rows = (Array.isArray(s.rows) ? s.rows : []).slice(0, 6);
    const LM = 64, RM = W - 8, cx = c => lerp(LM, RM, c / N);
    const RH = 22, y0 = 26;
    cols.forEach((c, i) => {
      if (i) L(svg, cx(i), 16, cx(i), y0 + rows.length * RH - 4, 'w mu');
      T(svg, cx(i + 0.5), 10, fit(String(c), 6), 's t10');
    });
    const wl = [], nm = [];
    rows.forEach((r, k) => {
      const yH = y0 + k * RH + 2, yL = yH + RH - 10;
      nm.push(T(svg, 6, (yH + yL) / 2, fit(String(r.name || ''), 9), 'st', 'start'));
      // the level at column c
      let d = '';
      const pts = [];
      if (r.clk) {
        const per = Math.max(0.05, num(r.per, 1)), duty = clamp(num(r.duty, 0.5), 0.05, 0.95);
        for (let t = 0; t < N - 1e-6; t += per) { pts.push([t, 1], [Math.min(N, t + per * duty), 1], [Math.min(N, t + per * duty), 0], [Math.min(N, t + per), 0]); }
      } else {
        const on = Array.isArray(r.on) ? r.on : [];
        const act = r.low ? 0 : 1, idle = 1 - act;
        let t = 0;
        pts.push([0, idle]);
        for (const [a, b] of on) { pts.push([a, idle], [a, act], [b, act], [b, idle]); t = b; }
        pts.push([N, idle]);
      }
      pts.forEach(([t, v], i) => { d += `${i ? 'L' : 'M'}${f1(cx(t))} ${f1(v ? yH : yL)}`; });
      P(svg, d, 'w thin');
      wl.push(LP(svg, d, ''));
    });
    const yB = y0 + rows.length * RH;
    const cur = L(svg, LM, 16, LM, yB - 4, 'cur');
    const cap = T(svg, 4, yB + 10, '', 'st', 'start');
    const caps = (Array.isArray(s.caps) ? s.caps : []).map(c => [num(c[0]), String(c[1] || '')]);
    return {
      h: yB + 20,
      up(u) {
        const x = lerp(LM, RM, u);
        set(cur, 'x1', f1(x)); set(cur, 'x2', f1(x));
        wl.forEach(e => lit(e, u));
        const c = u * N;
        let t = '';
        for (const [at, tx] of caps) if (c >= at - 1e-6) t = tx;
        txt(cap, fit(t, 64));
      },
    };
  }

  // ---- tri-state buffers / transceivers ----------------------------------------------------
  function bBuffer(svg, s) {
    const n = clamp(num(s.bits, 8), 1, 16);
    const v = norm(num(s.value), n);
    const en = fit(s.enable || 'OE', 6);
    const d = String(s.dir || 'out');
    let top = 'CPU side', botN = 'bus side', down = true;
    const m = d.split(/->|→/);
    if (m.length === 2) { top = fit(m[0].trim() || 'A', 20); botN = fit(m[1].trim() || 'B', 20); } else if (/^in$/i.test(d.trim())) down = false;
    const src = down ? top : botN, dst = down ? botN : top;
    const LM = 46;
    const cw = Math.min(30, (W - LM - 8) / n);
    const cx = i => LM + (n - 1 - i + 0.5) * cw;
    T2(svg, 4, 9, [[fit(s.label || 'buffer', 28), 'st'], [`: ${n} tri-state buffers`, 's']], 'start');
    const yTop = 26, yTB = 40, tT = 50, tB = 72, yBB = 84, yBot = 98;
    T(svg, LM, yTop, top, 's', 'start');
    T(svg, LM, yBot, botN, 's', 'start');
    const eY = 61;
    P(svg, `M${LM - 14} ${eY}H${f1(cx(0) + cw / 2)}`, 'w');
    const eL = LP(svg, `M${LM - 14} ${eY}H${f1(cx(0) + cw / 2)}`, 'cC');
    T(svg, 6, eY, en, 'hi cC bold t10', 'start');
    const srcT = [], dstT = [], tris = [];
    const tw = Math.min(14, cw - 4);
    for (let i = 0; i < n; i++) {
      const b = bit(v, i);
      const yS = down ? yTB : yBB, yDd = down ? yBB : yTB;
      srcT.push(T(svg, cx(i), yS, b, b ? 'b1' : 'b0'));
      dstT.push(T(svg, cx(i), yDd, 'z', 'b0'));
      L(svg, cx(i), yTB + 6, cx(i), tT, 'w thin');
      L(svg, cx(i), tB, cx(i), yBB - 6, 'w thin');
      const dd = down ? `M${f1(cx(i) - tw / 2)} ${tT}H${f1(cx(i) + tw / 2)}L${f1(cx(i))} ${tB}Z` : `M${f1(cx(i) - tw / 2)} ${tB}H${f1(cx(i) + tw / 2)}L${f1(cx(i))} ${tT}Z`;
      tris.push(svgEl('path', { d: dd, class: 'bx' }, svg));
    }
    const cap = T(svg, 4, 116, '', 'st', 'start');
    const val = hx(v, n);
    return {
      h: 124,
      up(u) {
        lit(eL, seg(u, 0.05, 0.35));
        const on = u >= 0.35;
        for (let i = 0; i < n; i++) {
          const col = n - 1 - i;
          const pass = u >= 0.4 + 0.3 * col / n;
          const b = bit(v, i);
          cl(tris[i], 'on', on && !pass); cl(tris[i], 'dn', pass);
          txt(dstT[i], pass ? b : 'z'); cl(dstT[i], 'b0', !pass || !b); cl(dstT[i], 'hi', pass && b); cl(dstT[i], 'bold', pass && b);
          cl(srcT[i], 'hi', on && b);
        }
        txt(cap, u < 0.35 ? `${en} is not active: the outputs are off (z).` : u < 0.75 ? `${en} is active. The bits go from the ${src} to the ${dst}.`
          : `The ${dst} now has ${val}.`);
      },
    };
  }

  // ---- FLAGS ---------------------------------------------------------------------------
  const FLAG_POS = { CF: 0, PF: 2, AF: 4, ZF: 6, SF: 7, TF: 8, IF: 9, DF: 10, OF: 11 };
  const FLAG_TXT = {
    CF: ['no carry or borrow', 'a carry or borrow came out of the top bit'],
    PF: ['the low byte has an odd number of 1 bits', 'the low byte has an even number of 1 bits'],
    AF: ['no carry out of bit 3', 'a carry came out of bit 3'],
    ZF: ['the result is not zero', 'the result is zero'],
    SF: ['the top bit of the result is 0', 'the top bit of the result is 1 (negative)'],
    TF: ['no single-step trap', 'a trap after each instruction'],
    IF: ['the CPU ignores INTR', 'the CPU accepts INTR'],
    DF: ['string operations go up', 'string operations go down'],
    OF: ['the signed result fits', 'the signed result does not fit'],
  };
  function bFlags(svg, s) {
    const v = num(s.v) & 0xFFFF;
    const old = num(s.old, v) & 0xFFFF;
    let names = s.names;
    if (typeof names === 'string') names = names.split(/[\s,]+/);
    const want = new Set((Array.isArray(names) && names.length ? names : Object.keys(FLAG_POS)).map(upper));
    const cw = 19, x0 = (W - 16 * cw) / 2;
    const cx = i => x0 + (15 - i + 0.5) * cw;
    const nameAt = {};
    for (const k in FLAG_POS) nameAt[FLAG_POS[k]] = k;
    const cells = [];
    for (let i = 15; i >= 0; i--) {
      const nm = nameAt[i];
      if (nm) T(svg, cx(i), 10, nm, want.has(nm) ? 'b1 t10' : 'm t10');
      const g = G(svg);
      const bx = R(g, cx(i) - cw / 2 + 1.5, 20, cw - 3, 22, nm ? 'bx' : 'bx dash', 3);
      const t = T(g, cx(i), 31, bit(old, i), nm ? (bit(old, i) ? 'b1 t12' : 'b0 t12') : 'm t10');
      cells[i] = { g, bx, t, nm };
    }
    for (const i of [0, 4, 8, 12, 15]) T(svg, cx(i), 50, i, 'm t10');
    const ch = [];
    for (let i = 0; i < 16; i++) if (bit(old ^ v, i)) ch.push(i);
    const lines = [];
    let y = 64;
    const shown = ch.filter(i => cells[i].nm).slice(0, 6);
    for (const i of shown) {
      const nm = cells[i].nm, nb = bit(v, i);
      lines.push(T2(svg, 4, y, [[`${nm} ${bit(old, i)} → ${nb}: `, 'b1'], [FLAG_TXT[nm][nb] + '.', 'st']], 'start'));
      y += 14;
    }
    if (!ch.length) { lines.push(T(svg, 4, y, `No flag changes. FLAGS = ${hex4(v)}h.`, 'st', 'start')); y += 14; }
    const tail = T(svg, 4, y, `FLAGS: ${hex4(old)}h → ${hex4(v)}h`, 's', 'start');
    const nc = Math.max(1, ch.length);
    const win = k => { const a = 0.08 + (k * 0.6) / nc; return [a, a + Math.min(0.25, 0.6 / nc + 0.1)]; };
    return {
      h: y + 9,
      up(u) {
        ch.forEach((i, k) => {
          const [a, b] = win(k);
          const f = seg(u, a, b);
          const c = cells[i], nb = f >= 0.5 ? bit(v, i) : bit(old, i);
          const sc = Math.max(0.02, Math.abs(Math.cos(Math.PI * f)));
          const yy = 31;
          set(c.g, 'transform', f > 0 && f < 1 ? `translate(0 ${yy}) scale(1 ${sc.toFixed(3)}) translate(0 ${-yy})` : '');
          txt(c.t, nb);
          if (c.nm) { cl(c.t, 'b1', nb); cl(c.t, 'b0', !nb); cl(c.t, 'hi', f >= 0.5); }
          cl(c.bx, 'on', f > 0);
        });
        shown.forEach((i, k) => { const [a, b] = win(k); op(lines[k], 0.25 + 0.75 * seg(u, (a + b) / 2, b)); });
        if (!ch.length) op(lines[0], 1);
        op(tail, seg(u, 0.75, 0.9));
      },
    };
  }

  // ---- status decoder (8288 / 82288) ---------------------------------------------------------
  const S8288 = [
    { code: '000', name: 'interrupt ack', cmd: 'INTA' },
    { code: '001', name: 'I/O read', cmd: 'IORC' },
    { code: '010', name: 'I/O write', cmd: 'IOWC, AIOWC' },
    { code: '011', name: 'halt', cmd: '' },
    { code: '100', name: 'code fetch', cmd: 'MRDC' },
    { code: '101', name: 'memory read', cmd: 'MRDC' },
    { code: '110', name: 'memory write', cmd: 'MWTC, AMWC' },
    { code: '111', name: 'passive', cmd: '' },
  ];
  function bStatus(svg, s) {
    const code = (typeof s.code === 'number' ? bin(s.code & 7, 3) : String(s.code === undefined ? '101' : s.code)).replace(/[^01]/g, '').padStart(3, '0').slice(-3);
    const rows = (Array.isArray(s.rows) && s.rows.length ? s.rows : S8288).slice(0, 10).map(r => ({
      code: String(r.code === undefined ? '' : r.code).replace(/[^01]/g, '').padStart(3, '0').slice(-3), name: fit(r.name || '', 20), cmd: fit(r.cmd || '', 16),
    }));
    const mi = rows.findIndex(r => r.code === code);
    // the names of the three status pins (8086: S2 S1 S0; 80286 and later: M/IO S1 S0)
    const pins = String(s.label || 'S2 S1 S0').split(/\s+/).slice(0, 3);
    while (pins.length < 3) pins.unshift('S' + (3 - pins.length - 1));
    T2(svg, 4, 9, [['status pins ' + pins.join(' ') + ' = ', 's'], [code.split('').join(' '), 'hi cC t13']], 'start');
    const yH = 26, y0 = 36, rh = 15;
    const xs = [22, 44, 64];
    pins.forEach((t, k) => T(svg, xs[k], yH, t, 'm t10'));
    T(svg, 82, yH, 'bus cycle', 's t10', 'start');
    T(svg, 200, yH, 'command', 's t10', 'start');
    L(svg, 4, y0 - 2, W - 4, y0 - 2, 'w thin');
    const ry = i => y0 + i * rh + rh / 2;
    const hl = mi >= 0 ? R(svg, 4, ry(mi) - rh / 2 + 0.5, W - 8, rh - 1, 'row', 3) : null;
    const curR = R(svg, 4, y0, W - 8, rh - 1, 'cur', 3);
    const cmds = [];
    rows.forEach((r, i) => {
      const y = ry(i);
      r.code.split('').forEach((c, k) => T(svg, xs[k], y, c, c === code[k] ? 'b1' : 'b0'));
      T(svg, 82, y, r.name, i === mi ? 'st' : 's', 'start');
      cmds.push(T(svg, 200, y, r.cmd || '—', r.cmd ? 'b1' : 'm', 'start'));
    });
    const yE = y0 + rows.length * rh + 12;
    const m = mi >= 0 ? rows[mi] : null;
    const cmdX = 200 + (m && m.cmd ? m.cmd.length * 6.7 : 10) + 6;
    const outL = m && m.cmd ? LP(svg, `M${f1(cmdX)} ${f1(ry(mi))}H${W - 12}`) : null;
    const outA = m && m.cmd ? AH(svg, W - 8, ry(mi), 'r', 'ar off', 3.5) : null;
    const cap = T(svg, 4, yE, !m ? `No row has the code ${code}.` : m.cmd ? `${code} = ${m.name}. ${m.cmd} goes active (low).`
      : `${code} = ${m.name}. No command goes active.`, 'st', 'start');
    return {
      h: yE + 9,
      up(u) {
        const f = seg(u, 0.05, 0.45);
        const target = mi >= 0 ? mi : rows.length - 1;
        const yy = y0 + f * target * rh;
        set(curR, 'y', f1(yy + 0.5));
        op(curR, u < 0.5 ? 1 : 0);
        if (hl) op(hl, seg(u, 0.42, 0.5));
        cmds.forEach((t, i) => cl(t, 'hi', i === mi && u >= 0.55));
        if (outL) { lit(outL, seg(u, 0.55, 0.8)); cl(outA, 'off', u < 0.8); }
        op(cap, seg(u, 0.55, 0.7));
      },
      col: 'ctrl',
    };
  }

  // ---- instruction decode ---------------------------------------------------------------
  const EA = ['[BX+SI]', '[BX+DI]', '[BP+SI]', '[BP+DI]', '[SI]', '[DI]', '[BP]', '[BX]'];
  const GRP = new Set([0x80, 0x81, 0x82, 0x83, 0x8F, 0xC0, 0xC1, 0xC6, 0xC7, 0xD0, 0xD1, 0xD2, 0xD3, 0xF6, 0xF7, 0xFE, 0xFF]);
  function autoFields(bytes) {
    const o = bytes[0];
    const dw = (o < 0x40 && (o & 7) < 4) || (o >= 0x88 && o <= 0x8B);
    const modrm = dw || (o >= 0x84 && o <= 0x8F) || GRP.has(o) || (o >= 0xD8 && o <= 0xDF) || [0x62, 0x63, 0x69, 0x6B, 0xC4, 0xC5].includes(o);
    const f = [];
    if ((o >= 0x40 && o < 0x60) || (o >= 0x90 && o < 0x98)) return [{ name: 'op', from: 7, to: 3 }, { name: 'reg', from: 2, to: 0 }];
    if (o >= 0xB0 && o < 0xC0) return [{ name: 'op', from: 7, to: 4 }, { name: 'w', from: 3, to: 3 }, { name: 'reg', from: 2, to: 0 }];
    if (!modrm || bytes.length < 2) return [{ name: 'op', from: 7, to: 0 }];
    if (dw) f.push({ name: 'op', from: 7, to: 2 }, { name: 'd', from: 1, to: 1 }, { name: 'w', from: 0, to: 0 });
    else if (o >= 0x80 && o <= 0x83) f.push({ name: 'op', from: 7, to: 2 }, { name: 's', from: 1, to: 1 }, { name: 'w', from: 0, to: 0 });
    else if ((o >= 0x84 && o <= 0x87) || [0xC6, 0xC7, 0xD0, 0xD1, 0xD2, 0xD3, 0xF6, 0xF7, 0xFE, 0xFF].includes(o)) f.push({ name: 'op', from: 7, to: 1 }, { name: 'w', from: 0, to: 0 });
    else f.push({ name: 'op', from: 7, to: 0 });
    f.push({ name: 'mod', from: 7, to: 6, byte: 1 }, { name: 'reg', from: 5, to: 3, byte: 1 }, { name: 'r/m', from: 2, to: 0, byte: 1 });
    return f;
  }
  function bOpcode(svg, s) {
    const bytes = (Array.isArray(s.bytes) ? s.bytes : []).slice(0, 8).map(b => num(b) & 0xFF);
    if (!bytes.length) bytes.push(0x90);
    let fields = Array.isArray(s.fields) && s.fields.length ? s.fields : autoFields(bytes);
    // give each field its byte: a field that starts at a higher bit than the last one ended opens the next byte
    let byte = 0, prevLo = 8;
    fields = fields.slice(0, 8).map(f => {
      const hi = clamp(Math.max(num(f.from, 7), num(f.to, 0)), 0, 7), lo = clamp(Math.min(num(f.from, 7), num(f.to, 0)), 0, 7);
      if (f.byte !== undefined && f.byte !== null) byte = clamp(num(f.byte), 0, 1);
      else if (hi >= prevLo) byte = Math.min(byte + 1, 1);
      prevLo = lo;
      const bv = bytes[byte] === undefined ? 0 : bytes[byte];
      const v = (bv >> lo) & ((1 << (hi - lo + 1)) - 1);
      return { name: String(f.name || '?'), hi, lo, byte, v, text: f.text || f.meaning || f.desc || null };
    });
    const nb = Math.min(2, Math.max(1, ...fields.map(f => f.byte + 1)), bytes.length);
    const text = String(s.text || '');
    let mnem = upper(text.split(/\s+/)[0] || '');
    if (!mnem && typeof Disasm86 !== 'undefined') {
      try { mnem = upper(Disasm86.decode(i => bytes[i] || 0, 0).mnem || ''); } catch (e) { mnem = ''; }
    }
    const get = nm => fields.find(f => f.name.toLowerCase().replace(/[^a-z]/g, '') === nm);
    const fw = get('w');
    const wbit = fw ? fw.v : bytes[0] === 0x8C || bytes[0] === 0x8E ? 1 : bytes[0] & 1;
    const fmod = get('mod');
    const modV = fmod ? fmod.v : -1;
    const frm = get('rm');
    const isGrp = GRP.has(bytes[0]);
    const isSreg = bytes[0] === 0x8C || bytes[0] === 0x8E;
    const meaning = f => {
      if (f.text) return String(f.text);
      const nm = f.name.toLowerCase().replace(/[^a-z]/g, '');
      if (nm === 'op' || nm === 'opcode') return mnem ? `the operation: ${mnem}` : 'the operation';
      if (nm === 'd') return f.v ? 'reg is the destination' : 'reg is the source';
      if (nm === 'w') return f.v ? 'word: 16 bits' : 'byte: 8 bits';
      if (nm === 's') return f.v ? 'extend the sign of the 8-bit data' : 'the data has full size';
      if (nm === 'mod') {
        if (f.v === 0 && frm && frm.v === 6) return 'memory; a 16-bit address follows';
        return ['memory, no displacement', 'memory + 8-bit displacement', 'memory + 16-bit displacement', 'a register, not memory'][f.v & 3];
      }
      if (nm === 'reg') {
        if (isGrp && f.byte === 1) return `/${f.v}: more operation bits`;
        if (isSreg && f.byte === 1) return `segment register ${SREG[f.v & 3]}`;
        return `register ${(wbit ? REG16 : REG8)[f.v & 7]}`;
      }
      if (nm === 'rm') {
        if (modV === 3) return `register ${(wbit ? REG16 : REG8)[f.v & 7]}`;
        if (modV === 0 && f.v === 6) return 'a direct address: [disp16]';
        return `address ${EA[f.v & 7]}${modV === 1 ? ' + disp8' : modV === 2 ? ' + disp16' : ''}`;
      }
      if (nm === 'sreg' || nm === 'seg') return `segment register ${SREG[f.v & 3]}`;
      return `value ${f.v}`;
    };
    // byte tiles
    const tw = Math.min(34, 300 / bytes.length);
    const tx = k => W / 2 + (k - (bytes.length - 1) / 2) * tw;
    const tiles = bytes.map((b, k) => {
      const r = R(svg, tx(k) - tw / 2 + 2, 2, tw - 4, 20, 'bx', 3);
      T(svg, tx(k), 12, hex2(b), 'b1 t12');
      return r;
    });
    // bits of the first bytes
    const bw = 17, bg = 12;
    const total = nb * 8 * bw + (nb - 1) * bg;
    const bx0 = (W - total) / 2;
    const bxp = (byteI, i) => bx0 + byteI * (8 * bw + bg) + (7 - i + 0.5) * bw;
    const bitEls = [];
    for (let k = 0; k < nb; k++) {
      T(svg, bx0 + k * (8 * bw + bg) + 4 * bw, 32, k === 0 ? 'byte 1: opcode' : 'byte 2: ModR/M', 's t10');
      for (let i = 7; i >= 0; i--) {
        R(svg, bxp(k, i) - bw / 2 + 1, 40, bw - 2, 18, 'bx', 2);
        bitEls.push({ k, i, t: T(svg, bxp(k, i), 49, bit(bytes[k], i), bit(bytes[k], i) ? 'b1' : 'b0') });
      }
    }
    // fields
    const fEls = fields.filter(f => f.byte < nb).map(f => {
      const xl = bxp(f.byte, f.hi) - bw / 2 + 2, xr = bxp(f.byte, f.lo) + bw / 2 - 2;
      const g = G(svg);
      P(g, `M${f1(xl)} 62V66H${f1(xr)}V62`, 'w on');
      const wd = xr - xl;
      T(g, (xl + xr) / 2, 74, fit(f.name, Math.max(1, Math.floor((wd + 6) / 6))), 'hi t10 bold');
      return { f, g };
    });
    let y = 90;
    const mEls = fEls.map(({ f }) => {
      const e = T2(svg, 4, y, [[`${f.name} ${bin(f.v, f.hi - f.lo + 1)}`, 'hi bold'], [': ' + fit(meaning(f), 44), 'st']], 'start');
      y += 13.5;
      return e;
    });
    const used = Math.max(nb, ...fields.map(f => f.byte + 1));
    const rest = bytes.slice(used);
    let tailE = null;
    if (rest.length) {
      const a = used + 1, b2 = bytes.length;
      const word = rest.length === 2 ? ` = ${hex4(rest[0] | (rest[1] << 8))}h (low byte first)` : '';
      tailE = T2(svg, 4, y, [[a === b2 ? `byte ${a}: ` : `bytes ${a}–${b2}: `, 'm'], [rest.map(hex2).join(' '), 'b1'], [word, 'st']], 'start');
      y += 13.5;
    }
    const mn = T(svg, W / 2, y + 5, text || mnem || '', 'hi t13');
    const nf = Math.max(1, fEls.length);
    return {
      h: y + 14,
      up(u) {
        tiles.forEach((t, k) => cl(t, 'on', k < nb && u < 0.9));
        for (const b of bitEls) cl(b.t, 'hi', false);
        fEls.forEach((fe, k) => {
          const a = 0.1 + (k * 0.72) / nf, e = seg(u, a, a + 0.72 / nf);
          op(fe.g, e > 0 ? 0.3 + 0.7 * seg(e, 0, 0.5) : 0);
          op(mEls[k], seg(e, 0.3, 0.8));
          if (e > 0 && e < 1) for (const b of bitEls) if (b.k === fe.f.byte && b.i <= fe.f.hi && b.i >= fe.f.lo) cl(b.t, 'hi', true);
        });
        if (tailE) op(tailE, seg(u, 0.8, 0.88));
        op(mn, seg(u, 0.86, 0.96));
      },
    };
  }

  // ---- down counter (8253 / 8254) ----------------------------------------------------------
  const MODE_TXT = ['interrupt on terminal count', 'one-shot', 'rate generator', 'square wave', 'software strobe', 'hardware strobe'];
  function bCounter(svg, s) {
    const reload = num(s.reload, 0) & 0xFFFF;
    const period = reload || 0x10000;
    const mode = clamp(num(s.mode, 2), 0, 5);
    const step = mode === 3 ? 2 : 1;
    const v = num(s.v) & 0xFFFF;
    const seq = [3, 2, 1, 0].map(k => { let x = v + k * step; if (x > period) x -= period; return x & 0xFFFF; });
    const outOf = c => (s.out !== undefined && s.out !== null ? num(s.out) & 1 : mode === 0 ? (c === 0 ? 1 : 0) : mode === 2 ? (c === 1 ? 0 : 1) : mode === 3 ? (c > period / 2 ? 1 : 0) : 1);
    // other counters (DMA count, head position) can give their own words
    T2(svg, 4, 9, [[fit(s.label || 'counter', 20), 'st'], [s.modeText ? `: ${s.modeText}` : `: mode ${mode}, ${MODE_TXT[mode]}`, 's']], 'start');
    R(svg, 6, 22, 80, 36, 'bx', 4);
    T(svg, 46, 31, 'reload', 's t10');
    T(svg, 46, 47, hex4(reload) + 'h', 'b1 t12');
    P(svg, 'M86 40H112', 'w'); AH(svg, 116, 40, 'r', 'ar', 3.5);
    const ce = R(svg, 118, 18, 104, 44, 'bx', 4);
    T(svg, 170, 27, 'count (goes down)', 's t10');
    const cT = T(svg, 170, 42, '', 'hi t15');
    const cD = T(svg, 170, 55, '', 's t10');
    P(svg, 'M222 40H250', 'w');
    const oW = P(svg, 'M250 40H266', 'w');
    const oT = T2(svg, 270, 40, [[(s.outLabel || 'OUT') + ' ', 's'], ['1', 'b1 t12']], 'start');
    // CLK pulses: 3 pulses, falling edges at u = 0.23, 0.5, 0.77
    const cx0 = 46, cx1 = W - 8;
    const tx = t => lerp(cx0, cx1, t);
    let d = `M${cx0} 84`;
    for (let j = 0; j < 3; j++) d += `H${f1(tx(0.1 + 0.27 * j))}V72H${f1(tx(0.23 + 0.27 * j))}V84`;
    d += `H${cx1}`;
    T(svg, 6, 78, s.clkLabel || 'CLK', 'hi cC t10 bold', 'start');
    P(svg, d, 'w thin');
    const clk = LP(svg, d, 'cC');
    // level bar
    T(svg, 6, 100, 'level', 's t10', 'start');
    R(svg, cx0, 95, cx1 - cx0, 10, 'bx', 2);
    const bar = R(svg, cx0, 95, 0, 10, 'fill', 2);
    T(svg, cx0, 112, '0', 'm t10', 'start');
    T(svg, cx1, 112, hex4(reload) + 'h', 'm t10', 'end');
    const capTxt = s.caption ? String(s.caption) : `Each CLK pulse subtracts ${step}. ` + (mode === 2 || mode === 3 ? 'At the end the count loads the reload value again.' : mode === 0 ? 'At 0, OUT goes high.' : 'At 0, OUT changes.');
    const lines = wrapText(capTxt, 56);
    const caps = lines.map((l, k) => T(svg, 4, 126 + k * 13, l, 'st', 'start'));
    return {
      h: 126 + lines.length * 13 - 4,
      up(u) {
        const k = u >= 0.77 ? 3 : u >= 0.5 ? 2 : u >= 0.23 ? 1 : 0;
        const c = seq[k];
        txt(cT, hex4(c) + 'h');
        txt(cD, `= ${c} decimal`);
        cl(ce, 'on', [0.23, 0.5, 0.77].some(e => u >= e && u < e + 0.06));
        lit(clk, u);
        set(bar, 'width', f1((cx1 - cx0) * clamp(c / period, 0, 1)));
        const o = outOf(c);
        txt(oT.lastChild, o); cl(oT.lastChild, 'hi', o);
        cl(oW, 'on', o);
        caps.forEach(e => op(e, 0.4 + 0.6 * seg(u, 0.1, 0.3)));
      },
      col: 'ctrl',
    };
  }

  // ---- text ------------------------------------------------------------------------------
  function bText(svg, s) {
    let src = Array.isArray(s.lines) ? s.lines : s.lines ? [s.lines] : s.text ? [s.text] : [];
    if (!src.length) src = ['No drawing for this block.'];
    const lines = [];
    src.slice(0, 8).forEach(l => wrapText(l, 52).forEach(x => lines.push(x)));
    lines.length = Math.min(lines.length, 10);
    const els = lines.map((l, i) => T(svg, 4, 9 + i * 16, l, 'st t12', 'start'));
    const n = els.length;
    return {
      h: n * 16 + 2,
      up(u) { els.forEach((e, i) => { const a = (0.7 * i) / n; op(e, 0.35 + 0.65 * seg(u, a, a + 0.15)); }); },
    };
  }

  const BUILD = {
    adder: bAdder, logic: bLogic, alu: bAlu, shift: bShift, bytes: bBytes, queue: bBytes,
    regfile: bRegs, regs: bRegs, decoder: bDecoder, cells: bCells,
    dram: (svg, s) => bCells(svg, Object.assign({}, s, { mem: 'dram' })),
    rom: (svg, s) => bCells(svg, Object.assign({}, s, { mem: 'rom' })),
    mux: bMux, latch: bLatch, buffer: bBuffer, flags: bFlags, status: bStatus, opcode: bOpcode,
    counter: bCounter, text: bText, wave: bWave,
  };
  const DEF_COL = {
    adder: 'eu', logic: 'eu', alu: 'eu', shift: 'eu', bytes: 'data', queue: 'data', regfile: 'eu', regs: 'eu',
    decoder: 'addr', cells: 'data', dram: 'data', rom: 'data', mux: 'addr', latch: 'addr', buffer: 'data',
    flags: 'eu', status: 'ctrl', opcode: 'eu', counter: 'ctrl', text: 'eu', wave: 'ctrl',
  };
  const COL = { addr: 'cA', data: 'cD', ctrl: 'cC', eu: 'cE', fpu: 'cF' };

  class BlockPanel {
    // opt.minKey: a storage key for the minimized state (a minimize button in the head);
    // opt.minDefault: the state when the key has no value.
    constructor(host, opt = {}) {
      injectStyle();
      this.host = host;
      this.root = htmlEl('div', { class: 'bk-panel', 'aria-hidden': 'true' }, host);
      const head = htmlEl('div', { class: 'bk-head' }, this.root);
      this.tEl = htmlEl('span', { class: 'bk-title' }, head);
      this.cEl = htmlEl('span', { class: 'bk-chip' }, head);
      this.minKey = opt.minKey || null;
      this.min = false;
      if (this.minKey) {
        try { const v = localStorage.getItem('a86:' + this.minKey); this.min = v === null ? !!opt.minDefault : v === 'true'; } catch (e) { this.min = !!opt.minDefault; }
        this.minBtn = htmlEl('button', { type: 'button', class: 'bk-min-btn' }, head);
        this.minBtn.addEventListener('pointerdown', e => e.stopPropagation());
        this.minBtn.addEventListener('click', e => { e.stopPropagation(); this.setMin(!this.min); });
        this.setMin(this.min);
      }
      this.sEl = htmlEl('div', { class: 'bk-sub' }, this.root);
      this.svg = svgEl('svg', { class: 'bk-svg', viewBox: `0 0 ${W} 100`, width: W, height: 100, role: 'img' }, this.root);
      this.spec = null;
      this.fn = null;
      this.u = 0;
      this.lastU = -1;
      this.reduced = false;
      this.shown = false;
    }
    get el() { return this.root; }
    setMin(on) {
      this.min = !!on;
      this.root.classList.toggle('bk-min', this.min);
      if (this.minBtn) { this.minBtn.textContent = this.min ? '+' : '–'; this.minBtn.setAttribute('aria-label', this.min ? 'Open the card of the unit' : 'Minimize the card of the unit'); this.minBtn.title = this.minBtn.getAttribute('aria-label'); }
      try { if (this.minKey) localStorage.setItem('a86:' + this.minKey, String(this.min)); } catch (e) { /* no storage */ }
    }
    place(x, y) {
      this.root.style.left = `${Math.round(x)}px`;
      this.root.style.top = `${Math.round(y)}px`;
    }
    anchor() { /* the panel draws no pointer line */ }
    size() { return { w: this.root.offsetWidth, h: this.root.offsetHeight }; }
    show(spec) {
      if (!spec) { this.hide(); return; }
      if (spec !== this.spec) this.build(spec);
      if (!this.shown) {
        this.shown = true;
        this.root.classList.add('bk-on');
        this.root.setAttribute('aria-hidden', 'false');
      }
    }
    build(spec) {
      this.spec = spec;
      const svg = this.svg;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      // spec.panel: an other drawing for this card (the die draws the unit itself from spec);
      // a kind with no drawing here shows spec.lines
      const D = spec.panel || spec;
      const kind = String(D.kind || 'text').toLowerCase();
      this.tEl.textContent = fit(spec.title || kind, 40);
      this.cEl.textContent = spec.chip ? fit(spec.chip, 14) : '';
      this.sEl.textContent = typeof spec.sub === 'string' ? spec.sub : '';
      let res = null;
      try {
        res = (BUILD[kind] || bText)(svg, BUILD[kind] ? D : spec);
        res.up(0);
      } catch (e) {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const lines = Array.isArray(spec.lines) ? spec.lines : [typeof spec.sub === 'string' && spec.sub ? spec.sub : `The ${spec.title || 'block'} works on this step.`];
        res = bText(svg, { lines });
      }
      const colName = COL[spec.col] ? spec.col : res.col || DEF_COL[kind] || 'eu';
      this.root.className = `bk-panel ${COL[colName]}${this.shown ? ' bk-on' : ''}${this.reduced ? ' bk-rm' : ''}${this.min ? ' bk-min' : ''}`;
      const h = Math.ceil(res.h || 100);
      svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
      svg.setAttribute('height', h);
      svg.setAttribute('aria-label', `${spec.title || kind}. ${typeof spec.sub === 'string' ? spec.sub : ''}`.trim());
      this.fn = res.up;
      this.lastU = -1;
      this.draw(0);
    }
    draw(u) {
      if (!this.fn) return;
      const v = this.reduced ? 1 : clamp(Number(u) || 0, 0, 1);
      if (v === this.lastU) return;
      this.lastU = v;
      try { this.fn(v); } catch (e) { /* keep the last picture */ }
    }
    update(u) { this.u = u; this.draw(u); }
    hide() {
      if (!this.shown) return;
      this.shown = false;
      this.root.classList.remove('bk-on');
      this.root.setAttribute('aria-hidden', 'true');
    }
    setReducedMotion(on) {
      this.reduced = !!on;
      this.root.classList.toggle('bk-rm', this.reduced);
      this.lastU = -1;
      this.draw(this.u);
    }
  }

  // ---- the meaning of a text of a drawing (the tooltips of the unit work) -----------------
  // BlockPanel.termTip(text, spec) -> { term, text } or null. text: the words of one <text> of
  // the drawing; spec: its card (the kind gives the sense of a plain number or bit).
  const STAT = 'The status pins. At the start of each bus cycle the CPU puts a 3-bit code on them. The code gives the type of the cycle: code fetch, memory read or write, I/O read or write, halt or interrupt acknowledge. The bus controller decodes it and makes the command.';
  const GLOSS = [
    // the words of the unit structures on the die (UnitFx: cache, bus, pipe, rat, rs, rob, port)
    [/^TAG\b/, 'tag', 'The high bits of the address. Each way keeps the tag of the line that it holds. The cache compares the tag of the address with the tags of all the ways of the set at the same time.'],
    [/^SET \d+( OF|$)/, 'set', 'The set: the middle bits of the address select one row of the cache. A line can be only in its own set.'],
    [/^OFFSET$/, 'offset', 'The low bits of the address: the byte in the line.'],
    [/^MISS$/, 'miss', 'No way of the set has the tag of the address: the line is not in the cache. It must come from the memory (or from the L2).'],
    [/^HIT$/, 'hit', 'A way of the set has the tag of the address: the bytes come from the cache at once.'],
    [/^WAY \d/, 'way', 'The way that gets the new line (the LRU bits choose the way that was used least recently), and the new state of the line.'],
    [/^[≠=]$/, 'comparator', 'The comparator of the way: ≠ = its tag is not the tag of the address; = = the same tag (a hit).'],
    [/^⋮$/, 'more sets', 'The other sets of the cache (they are not drawn).'],
    [/^TRANSFER \d+\/\d+/, 'transfer', 'A burst: one address, then the data of the line comes in several transfers, one each clock (2-1-1-1 clocks).'],
    [/^\d+ BYTES$/, 'line buffer', 'The whole line is now in the line buffer; it goes into the cache.'],
    [/^address [0-9A-F]+h/, 'address', 'The address of the write.'],
    [/^data out$/, 'data out', 'The data of the write goes out on the data pins to the memory.'],
    [/^no line fill$/, 'no line fill', 'A write miss does not bring the line into the cache: only the memory gets the new bytes.'],
    [/^L2 set/, 'L2', 'The L2 cache (256 KB, a second die in the same package): the set and the way of this line in it.'],
    [/^back-side bus/, 'back-side bus', 'The bus between the core and the L2 die, at the core clock. The front-side bus goes to the memory at 66 MHz.'],
    [/^(BURST|WRITE|WRITE-BACK|L2 MISS|L2 HIT|DONE)$/, 'bus interface', 'The bus interface: it drives the address and the command on the pins, and moves the data between the pins and the caches.'],
    [/^PIPELINE/, 'pipeline', 'The pipeline: 5 stages work on 5 instructions at the same time. Each clock, each instruction moves one stage on.'],
    [/^\d+ CLOCKS?$/, 'clocks', 'The clocks that this instruction takes.'],
    [/^REGISTER ALIAS TABLE|^\d+ RENAMED$/, 'RAT', 'The register alias table: for each register, the ROB entry that makes its newest value. An instruction that writes a register gets a new entry: so two instructions can use the same register name at the same time.'],
    [/^RRF$/, 'RRF', 'The retirement register file: the value of the register is retired (it is the real value now).'],
    [/^ROB \d+/, 'ROB entry', 'The newest value of this register comes from this entry of the reorder buffer (not retired yet).'],
    [/^RESERVATION STATION/, 'reservation station', 'The 20 slots where the µops wait until their operands are ready and their port is free.'],
    [/^CLOCK \+\d+/, 'clock', 'The clocks since the first µop of this instruction came into the station.'],
    [/^(alu|load|sta|std|br|shift|lea|mul|div|esp|fadd|fmul|fdiv|fmov|fxch|fcmp|cmov|ms|nop)$/, 'µop kind', 'The kind of µop: alu = add or logic, load = a read of memory, sta = a store address, std = the store data, br = a branch, ms = a µop of the microcode ROM.'],
    [/^waits: /, 'waits', 'The µop cannot go yet: its operand is not ready, or its unit or port is busy.'],
    [/^→ port \d/, 'port', 'The µop goes to this port when its operands are ready.'],
    [/^port \d$/, 'execution port', 'An execution port: port 0 and port 1 compute, port 2 loads, port 3 calculates store addresses, port 4 takes the store data.'],
    [/^(REORDER BUFFER|\d+ IN|RETIRED)\b/, 'ROB', 'The reorder buffer (40 entries in a ring). The µops come in in program order, finish in any order, and leave (retire) in program order at the head.'],
    [/^HEAD$/, 'head', 'The oldest µop in the reorder buffer: the next one to retire.'],
    [/^done$/, 'done', 'The µop has its result; it waits in the ROB until all older µops retire.'],
    [/^PORT \d/, 'execution port', 'The port and its units. The µop goes through the stages of its unit, one each clock.'],
    [/^…\d+$/, 'latency', 'The unit takes this many clocks (not all its stages are drawn).'],
    [/^→ [A-Z]{2,6}$/, 'result', 'The result goes to this register (through its ROB entry).'],
    [/^[0-9A-F]+\+[0-9A-F]+$/, 'the sum', 'The two numbers that the adder adds (hex): the start of the segment + the offset.'],
    [/^(PUT|TAKE) \d/, 'queue', 'PUT n: n bytes from the bus come into the queue. TAKE n: the decoder takes n bytes out of the queue.'],
    [/^\d+\/\d+$/, 'queue', 'The bytes in the queue now, of its size.'],
    [/^(IN|OUT) [01]$/, 'the bit', 'The bit that goes into the cell (a write) or comes out of it (a read).'],
    [/^ROW [0-9A-F]+h COL/, 'row and column', 'The row and the column of the selected cell (hex): the DRAM takes the row with RAS, then the column with CAS.'],
    [/^LINE [0-9A-F]+h/, 'selected line', 'The output line of the decoder that is 1 now: it selects one row (or one chip).'],
    [/^ALE [0-9A-F]+h/, 'ALE', 'While ALE is high the latch takes this value; when ALE goes low, it keeps it.'],
    [/^SEL [0-9A-F]+h/, 'select', 'The select bits of the multiplexer: they connect this input to the output.'],
    [/^[0-9A-F]{2}( [0-9A-F]{2})+$/, 'instruction bytes', 'The bytes of the instruction (hex), in memory order.'],
    [/^[A-Z]{2,6}←[0-9A-F]+$/, 'register write', 'The register gets this new value (hex).'],
    [/^RS$/, 'reservation station', 'The 20 slots where the µops wait until their operands are ready and their port is free.'],
    [/^-$/, 'no command', 'This status gives no command.'],
    [/S2 S1 S0|^S[012]$/, 'S2 S1 S0', STAT],
    [/^M\/IO|M\/IO S1 S0/, 'M/IO S1 S0', 'The status pins of the 80286 and later CPUs: M/IO = 1 for memory, 0 for I/O; S1 and S0 give read, write, fetch or halt. The bus controller (82288) decodes them and makes the command.'],
    [/MRDC/, 'MRDC', 'Memory Read Command. The bus controller makes it low: the selected memory puts its data on the data bus. When it goes high again, the cycle ends.'],
    [/MWTC/, 'MWTC', 'Memory Write Command. The bus controller makes it low: the selected memory takes the data from the data bus.'],
    [/IORC/, 'IORC', 'I/O Read Command: the selected I/O port puts its data on the data bus.'],
    [/IOWC/, 'IOWC', 'I/O Write Command: the selected I/O port takes the data from the data bus.'],
    [/INTA|interrupt ack/, 'INTA', 'Interrupt acknowledge: the CPU asks the interrupt controller (8259A) for the number of the interrupt.'],
    [/^ALE$/, 'ALE', 'Address Latch Enable: a short pulse at the start of the bus cycle. When ALE goes low, the latches keep the address for the rest of the cycle.'],
    [/^DEN$/, 'DEN', 'Data Enable: it turns on the data transceivers, so the data can go between the CPU and the bus.'],
    [/^DT\/R/, 'DT/R', 'Data Transmit / Receive: the direction of the data transceivers. High: from the CPU to the bus (a write). Low: from the bus to the CPU (a read).'],
    [/KEN/, 'KEN#', 'Cache Enable: the board tells the CPU that the cache can keep this memory (RAM, not the video memory). Then the CPU reads the whole line.'],
    [/BLAST/, 'BLAST#', 'Burst Last: the CPU sets it at the last transfer of a burst (the line fill ends).'],
    [/CACHE#/, 'CACHE#', 'The Pentium tells the board that this read fills a cache line: a burst of 4 transfers.'],
    [/^CAS$/, 'CAS', 'Column Address Strobe: the DRAM takes the column address and selects one bit of the open row.'],
    [/^RAS$/, 'RAS', 'Row Address Strobe: the DRAM takes the row address and opens that row of cells.'],
    [/word line/, 'word line', 'The row decoder sets one word line to 1. All the cells of that row connect to their bit lines.'],
    [/bit line/, 'bit line', 'The wire of one column of cells. The sense amplifier reads the small charge that the cell puts on it.'],
    [/sense amp/, 'sense amplifiers', 'They change the small voltage of each cell into a full 0 or 1, and write the value back into the cell (a read empties the capacitor).'],
    [/column mux|columns:/, 'column multiplexer', 'It selects one bit line of the open row: that bit goes to the output of the chip.'],
    [/capacitor/, 'capacitor', 'A DRAM cell keeps one bit as a charge in a very small capacitor. The charge leaks, so the refresh reads and writes each row again all the time.'],
    [/row address/, 'row address', 'The part of the address that selects one row of cells.'],
    [/-to-\d+ decoder|one output line is 1|all others = 0/, 'decoder', 'A decoder: n input bits select one of 2^n output lines. The selected line is 1, all the other lines are 0.'],
    [/sets × \d ways|^set \d+, way|fill into way|no fill|no line fill/, 'set and way', 'The address bits select one set of the cache. A set has 2 or 4 lines (ways). The tags of the ways tell which memory line each way keeps. On a miss, the LRU bits choose the way that gets the new line.'],
    [/^A\d+–A\d+: [01]+|^A4–A10|^A5–A11/, 'set bits', 'These address bits select the set of the cache (or the group of the decoder).'],
    [/^line [0-9A-F]+h/, 'line', 'A cache line: 16 bytes (80486) or 32 bytes (Pentium), from an address that is a multiple of the line size.'],
    [/state S|state E|state M|MESI/, 'MESI state', 'The state of a cache line: M = modified (only here, changed), E = exclusive (only here), S = shared (maybe in another cache too), I = invalid.'],
    [/^(HA|FA)$|half adder|full adder/, 'adder', 'HA = half adder: it adds 2 bits. FA = full adder: it adds 2 bits and the carry from the bit before. Each gives a sum bit and a carry out.'],
    [/^cin$|^cout|carry out/, 'carry', 'The carry bit that goes from one bit position to the next one. Carry in (cin) enters the lowest bit; carry out (cout) leaves the highest bit.'],
    [/^A: .*(× 16|base)/, 'input A', 'Input A of the adder: the start of the segment in memory (real mode: the segment value × 16; protected mode: the base from the descriptor).'],
    [/^B: offset/, 'input B', 'Input B of the adder: the offset, the place in the segment.'],
    [/^address = /, 'address', 'The result of the adder: the physical address = the segment start + the offset.'],
    [/^Ts$/, 'Ts', 'T state "send status": the CPU sends the address and the status (the first clock of the bus cycle).'],
    [/^Tc$/, 'Tc', 'T state "command": the bus controller gives the command and the data moves. It repeats while the memory is not ready (wait states).'],
    [/^T[1-4]\b/, 'T states', 'The clocks of a bus cycle. T1: the address goes out. T2: the command starts. T3: the data moves. T4: the command ends.'],
    [/^Now: \d+ of \d+ bytes/, 'queue', 'The prefetch queue now: the code bytes that it holds, of its size. "in": the bytes that came in now; "out": the bytes that the decoder took.'],
    [/^in: |^out: |^from the bus|^from the burst|^to the decoder/, 'the way of the bytes', 'Where the bytes come from, and where they go next.'],
    [/^last$/, 'last', 'The last byte that came in.'],
    [/tri-state/, 'tri-state buffers', 'When they are on, they pass the bits. When they are off, they disconnect from the wires (high impedance), so another chip can drive the bus.'],
    [/CPU side|bus side/, 'the two sides', 'The transceiver connects the local bus of the CPU (the CPU side) to the system bus (the bus side). DT/R gives the direction.'],
    [/D latches|Q keeps|^(D|Q)( in| out)?( [01])?$/, 'latch', 'D: the data input of the latch. Q: its output. While the strobe (ALE) is high, Q follows D. When the strobe goes low, Q keeps the value.'],
    [/^low: hold|^high$/, 'strobe', 'The strobe of the latch: high = the output follows the input; low = the output holds its value.'],
    [/^opcode|operation:/, 'opcode', 'The operation code: the first bits of the instruction give the operation (for example MOV).'],
    [/^w [01]|^w$/, 'w bit', 'w = 0: the operation is on a byte (8 bits). w = 1: on a word (16 bits, or 32 bits with a 32-bit operand size).'],
    [/^d$/, 'd bit', 'd = 1: the register field is the destination; d = 0: it is the source.'],
    [/^mod\b/, 'mod', 'The mod field of the ModR/M byte: 11 = a register; 00, 01, 10 = memory (with no, an 8-bit or a 16-bit displacement).'],
    [/^reg\b/, 'reg', 'The reg field of the ModR/M byte: the register of the operation (or more bits of the opcode).'],
    [/^r\/m/, 'r/m', 'The r/m field of the ModR/M byte: the register, or the registers that make the memory address.'],
    [/^byte \d|^bytes \d/, 'instruction bytes', 'The bytes of the instruction, in memory order. A number of 2 bytes has its low byte first (little endian).'],
    [/^PF\b/, 'PF', 'Prefetch: the first stage of the pipeline. It takes code bytes from the queue.'],
    [/^D1\b/, 'D1', 'Decode 1: the second stage. It decodes the opcode and the length of the instruction.'],
    [/^D2\b/, 'D2', 'Decode 2: the third stage. It calculates the memory addresses.'],
    [/^EX\b/, 'EX', 'Execute: the ALU does the operation, or the cache is read.'],
    [/^WB\b/, 'WB', 'Write back: the result goes into the register file.'],
    [/no pair|alone/, 'pairing', 'The Pentium can do two simple instructions in the same clock (the U and V pipes). "Alone": this instruction did not pair with the next one.'],
    [/ROB/, 'ROB', 'The reorder buffer (40 entries). It keeps the µops in program order. A µop leaves it (retires) only after all older µops, so the results come back in order.'],
    [/RS entries/, 'RS', 'The reservation station (20 entries). A µop waits here until its operands are ready and an execution port is free.'],
    [/µop|issue|dispatch|retire/, 'µop', 'A µop is a small operation that the decoders make from an instruction. Issue: it goes into the ROB and the RS. Go (dispatch): it goes to an execution port. Done: its result is ready. Retire: the result becomes the real register value.'],
    [/^writes |^[A-Z]{2,3} [←→]/, 'register rename', 'The register alias table: the name of the register points to the ROB entry that makes its newest value.'],
    [/Y0|RAM select|select \d|select$/, 'chip select', 'The decoder output that selects the chip (active low). Only the selected chip answers on the bus.'],
    [/^AND$|^OR$|^XOR|AND array|OR gates/, 'gates', 'The logic gates of the PAL: the AND array makes the product terms of the address bits, and the OR gates combine them into the chip-select outputs.'],
    [/^(code fetch|memory read|memory write|I\/O read|I\/O write|halt|passive)/, 'status table', 'One row of the status table: the status code of the cycle and the command that it gives.'],
    [/^A19–A16|address group/i, 'address group', 'The high address bits select the group of addresses (for example the RAM or the video memory).'],
    [/^[ABCD][XLH]$|^E[ABCD]X$|^[SD]I$|^[SB]P$|^E?[SD]I$|^E?[SB]P$/, 'register', 'A general register of the CPU.'],
    [/^EFLAGS$/, 'EFLAGS', 'The flags register (carry, zero, sign ...). The RAT renames it too.'],
    [/^[CDES]S$|^[FG]S$/, 'segment register', 'A segment register: CS = code, DS = data, SS = stack, ES = extra (and FS, GS on the 80386 and later).'],
    [/^[A-Z]{2}: [0-9A-F]+h → /, 'register write', 'The register before → after the instruction.'],
    [/^bus cycle$|^command$/, 'bus cycle', 'A bus cycle: the CPU sends an address and a command, and a byte or a word moves on the bus.'],
    [/^[ab]$/, 'inputs', 'The two numbers that go into the adder, bit by bit.'],
    [/^S( = [01])?$/, 'sum', 'S: the sum bit of this position of the adder (a XOR b XOR carry in).'],
    [/^next$/, 'next', 'The next byte that the decoder takes from the queue.'],
    [/connects to the output/, 'multiplexer', 'A multiplexer: the select bits connect one input to the output. The other inputs stay off.'],
    [/registers, \d+ bits each/, 'register file', 'The register file: the registers of the CPU, in a small fast memory on the chip. The execution unit reads and writes them.'],
    [/^write [0-9A-F]+h/, 'write', 'A write to this address in memory.'],
    [/^CLK$/, 'CLK', 'The clock signal. Each period is one clock of the CPU.'],
    [/^[a-z]{2,6} [^|]*[, ]/, 'the instruction', 'The instruction in assembly language: the text form of its bytes.'],
  ];
  // the sense of a word from the kind of the drawing (before the general words)
  function kindTip(t, kind) {
    if (kind === 'adder' && /^\d{1,2}$/.test(t)) return { term: 'bit ' + t, text: 'The number of the bit position (bit 0 is the lowest).' };
    if (kind === 'cache') {
      if (/^\d+$/.test(t)) return { term: 'set ' + t, text: 'The number of a set (a row of the cache).' };
      if (/^[VISEM]$/.test(t)) return { term: 'state ' + t, text: 'The state of the line in this way: V = valid; with MESI: M = modified, E = exclusive, S = shared, I = invalid (empty).' };
      if (/^[0-9A-F]{4,6}h$/.test(t)) return { term: 'tag ' + t, text: 'The tag of the line in this way: the high bits of its address.' };
      if (t === '—') return { term: 'no tag', text: 'This way has no valid line (or its old line is not known here).' };
    }
    if (kind === 'bus' && /^\d$/.test(t)) return { term: 'transfer ' + t, text: 'The number of the transfer of the burst: this row of the line buffer.' };
    if (kind === 'rob' && /^\d+$/.test(t)) return { term: 'entry ' + t, text: 'The number of the entry of the reorder buffer.' };
    if (kind === 'port' && /^\d+$/.test(t)) return { term: 'stage ' + t, text: 'A stage of the unit: one clock.' };
    if (kind === 'pipe' && /^[UV]$/.test(t)) return { term: t + ' pipe', text: 'The Pentium has two pipes, U and V: two simple instructions can go through them in the same clock.' };
    return null;
  }
  function termTip(text, spec) {
    const t = String(text || '').trim();
    if (!t) return null;
    const kind = spec && spec.kind ? String(spec.kind) : '';
    const k1 = kindTip(t, kind);
    if (k1) return k1;
    for (const [re, term, what] of GLOSS) if (re.test(t)) return { term, text: what };
    if (/^[–—…]$/.test(t)) return { term: t, text: 'No value here.' };
    // a plain number or bit: its sense from the kind of the drawing
    if (/^[01]$/.test(t)) return { term: t, text: 'One bit: 1 = high, 0 = low.' };
    if (/^[0-9A-F]{1,8}h?$/.test(t)) {
      const hx = /[A-F]/.test(t) || t.length >= 2;
      if (kind === 'bytes') return { term: t, text: 'One byte (hexadecimal) in the queue or in the line.' };
      if (kind === 'cells' || kind === 'dram' || kind === 'rom') return { term: t, text: 'The number of a row or a column of the cell array (hexadecimal).' };
      if (kind === 'decoder') return { term: t, text: 'The number of an output line of the decoder (hexadecimal).' };
      if (/^[01]$/.test(t)) return { term: t, text: 'One bit: 1 = high, 0 = low.' };
      return hx ? { term: t, text: 'A value in hexadecimal (base 16).' } : null;
    }
    if (/^[=–—…]|^[01]( [01])+$|^= [01]$|^output = [01]/.test(t)) return { term: t, text: 'The bits (1 = high, 0 = low).' };
    // no rule for this word: the part of the drawing it belongs to
    if (KIND_TIP[kind]) return { term: t.replace(/…$/, ''), text: KIND_TIP[kind] };
    return null;
  }
  // The sense of the words of each drawing (the last help for a word with no rule).
  const KIND_TIP = {
    adder: 'The adder: it adds the two numbers bit by bit; the carry goes from each bit to the next one.',
    bytes: 'The queue (or the line buffer): the code bytes wait here in order.',
    cells: 'The cell array: the row decoder opens one row, the sense amplifiers read it, the column multiplexer takes one bit.',
    decoder: 'The decoder: its input bits select one of its output lines.',
    latch: 'The address latch: it keeps the address for the rest of the bus cycle.',
    mux: 'The multiplexer: the select bits connect one input to the output.',
    opcode: 'The decoder: it splits the bytes of the instruction into its fields.',
    pipe: 'An instruction in this stage of the pipeline.',
    port: 'The path of the µop through the port: from the reservation station, through the stages of the unit, and its result to the ROB.',
    rat: 'The register alias table: for each register, the ROB entry that makes its newest value.',
    regfile: 'The register file: the registers of the CPU.',
    rs: 'The reservation station: the µops wait here for their operands and their port.',
    rob: 'The reorder buffer: the µops wait here until they retire in program order.',
    status: 'The status decoder: the status bits give the type of the bus cycle and its command.',
    wave: 'The command logic: it makes the signals of the bus cycle (ALE, the command) at the right T states.',
    cache: 'The cache: its sets (rows) and ways (columns); each way keeps a tag, a state and a line of bytes.',
    bus: 'The bus interface: the pins, the address, the signals and the line buffer.',
    buffer: 'The transceiver: its buffers pass the data in one direction.',
    text: 'The work of this unit.',
  };
  BlockPanel.termTip = termTip;
  return BlockPanel;
})();
window.BlockPanel = BlockPanel;
