// Top view: a flat 2D view of the whole computer from above. Every chip shows its open die,
// the expansion cards lie flat above the board, the buses are clean labelled lines, and the
// work of each unit plays on the die (trace mode and normal run). The layout, the dies and
// the trace models come from the 3D board (BoardKit in src/ui/board3d.js).

const TopView = (() => {
  const TAU = Math.PI * 2;
  const COL = () => ({ addr: THEME.cyan, data: THEME.gold, ctrl: THEME.magenta, fpu: THEME.lavender, eu: THEME.phosphor, clk: THEME.goldHi });
  const ease = f => (f <= 0 ? 0 : f >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * f));
  // Names of the bus bundles, for the labels on the lines.
  const BUS_NAME = id => {
    const K = BoardKit, M = K.M286;
    if (id === 'LB_cpu') return M ? 'A0–A23 (local)' : 'AD0–AD15, A16–A19 (local bus)';
    if (id === 'LB_x') return M ? 'D0–D15 (local)' : 'AD0–AD15 (local data)';
    if (id === 'LB_fpu') return M ? 'D0–D15 to the 80287' : 'local bus to the 8087';
    if (id.startsWith('SA_')) return M ? 'system address A0–A23' : 'system address A0–A19';
    if (id.startsWith('SD_')) return 'system data D0–D15';
    if (id === 'S02') return M ? 'S1 S0 M/IO' : 'S0–S2';
    if (id === 'CMD_MEM') return 'MRDC MWTC';
    if (id === 'CMD_IO') return 'IORC IOWC INTA';
    if (id === 'CMD_SLOT') return 'commands to the slots';
    if (id.startsWith('CS_')) return 'CS ' + (K.DEV_SEL[id.slice(3)] || id.slice(3));
    if (id.startsWith('CLK')) return 'CLK';
    if (id === 'ERR') return 'ERROR → IRQ13';
    if (id.startsWith('NMI')) return 'NMI';
    return id;
  };
  const BUS_KIND = id => (id.startsWith('SA') || id === 'LB_cpu' ? 'addr' : id.startsWith('SD') || id === 'LB_x' ? 'data'
    : id === 'LB_fpu' || id === 'RQ' || id === 'QS' ? 'fpu' : id.startsWith('CLK') ? 'clk' : 'ctrl');

  const CSS = `
  .tp-root { position: absolute; inset: 0; overflow: hidden; background: var(--well, #0b0f14); }
  .tp-root canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .tp-root canvas.tp-fx { pointer-events: none; }
  .tp-wrap { position: absolute; inset: 0; outline: none; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }
  .tp-wrap.tp-drag { cursor: grabbing; }
  .tp-wrap:focus-visible { box-shadow: inset 0 0 0 2px var(--gold-hi); }
  .tp-top { position: absolute; left: 12px; top: 12px; z-index: 6; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-width: calc(100% - 24px); pointer-events: none; }
  .tp-top > * { pointer-events: auto; }
  .tp-top > .tp-hint { pointer-events: none; }
  .tp-btn { height: 30px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--line); background: rgba(14, 9, 20, .8); color: var(--text); font: 600 12.5px var(--sans); }
  .tp-btn[aria-pressed="true"] { background: linear-gradient(180deg, var(--gold-hi), var(--gold)); color: var(--void); border-color: var(--gold); }
  .tp-hint { margin: 0; font-size: 11.5px; color: var(--muted); background: rgba(14, 9, 20, .6); padding: 3px 8px; border-radius: 6px; }
  .tp-tip { position: absolute; z-index: 7; pointer-events: none; max-width: 300px; padding: 7px 10px; border-radius: 8px; background: rgba(10, 7, 16, .92);
    border: 1px solid var(--line); color: var(--text); font-size: 12.5px; line-height: 1.4; opacity: 0; transition: opacity .15s; }
  .tp-tip b { color: var(--gold-hi); font-family: var(--mono); }
  .tp-tip.tp-on { opacity: 1; }
  .tp-tok { position: absolute; left: 0; top: 0; z-index: 6; pointer-events: none; display: grid; grid-template-columns: auto 1fr; column-gap: 7px; row-gap: 2px;
    max-width: 300px; padding: 5px 10px 6px; border-radius: 9px; background: rgba(10, 7, 16, .9); border: 1px solid var(--line); border-top: 3px solid var(--cyan);
    opacity: 0; transition: opacity .3s; }
  .tp-tok i { font: 700 10px var(--sans); font-style: normal; letter-spacing: .08em; color: var(--cyan); }
  .tp-tok b { font: 600 14px var(--mono); color: var(--text); white-space: nowrap; }
  .tp-tok span { grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
  .tp-tok span.tp-route { color: var(--text); font-weight: 600; }
  `;
  function injectStyle() {
    if (document.getElementById('tp-style')) return;
    const st = document.createElement('style');
    st.id = 'tp-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const canvasEl = (cls, parent) => { const c = document.createElement('canvas'); if (cls) c.className = cls; parent.appendChild(c); return c; };

  // The flow of the trace: the screen speed of the token (px/s at the normal speed), the time
  // to cross a unit (s), and the time of the camera move to a new value (ms).
  // FLOW_UNIT_S: a unit with a drawing of its work; FLOW_PASS_S: a unit with only a text.
  // In a unit the token comes in (FLOW_IN of the time), waits at the working part while the
  // unit works, and goes out (the last FLOW_IN of the time).
  const FLOW_PX_S = 420, FLOW_UNIT_S = 3.0, FLOW_PASS_S = 1.0, FLOW_IN = 0.28;
  // The camera frames a working unit with FLOW_UNIT_M times its size (some of the die stays in
  // view), so its own drawing is large while it works.
  const FLOW_UNIT_M = 1.6;
  // The limits of the camera for each 1/60 s: the zoom (log) and the pan (screen px).
  const CAM_DLZ = 0.03, CAM_DPX = 18;
  // A smooth move of the camera between two views: zoom out, move, zoom in (van Wijk and
  // Nuij, "Smooth and efficient zooming and panning", 2003; as d3.interpolateZoom). Views as
  // [centre x, centre z, width of the view in world units]. Returns { S, at(u) }.
  const zoomPath = (a, b) => BoardKit.zoomPath(a, b);   // (van Wijk and Nuij, in board3d.js)
  class TopView {
    constructor(host, app) {
      this.host = host;
      this.app = app;
      this.reduced = !!app.reducedMotion;
      this.visible = false;
      this.ok = typeof BoardKit !== 'undefined';
      injectStyle();
      this.root = htmlEl('div', { class: 'tp-root' }, host);
      if (!this.ok) { htmlEl('p', { class: 'view-missing' }, this.root, 'The top view needs the board data.'); return; }
      this.base = canvasEl('tp-base', this.root);
      this.fx = canvasEl('tp-fx', this.root);
      this.wrap = htmlEl('div', {
        class: 'tp-wrap', tabindex: '0', role: 'application', 'aria-roledescription': 'top view',
        'aria-label': 'A flat top view of the computer. Drag to move, scroll or plus and minus to zoom, double-click a chip to fill the view with it, Esc to see all.',
      }, this.root);
      const top = this.modeSlot = htmlEl('div', { class: 'tp-top' }, this.root);   // (the switch of the board views goes first)
      this.btnAll = htmlEl('button', { type: 'button', class: 'tp-btn', 'aria-label': 'See all the chips (Esc)' }, top, 'See all');
      this.btnFollow = htmlEl('button', { type: 'button', class: 'tp-btn', 'aria-pressed': 'true', 'aria-label': 'Follow: the view moves to the chips that work' }, top, 'Follow');
      htmlEl('p', { class: 'tp-hint' }, top, 'Drag to move · scroll to zoom · double-click a chip to fill the view · Esc: see all');
      this.btnAll.addEventListener('click', () => { this.follow = false; this.syncFollow(); this.fitAll(); });
      this.btnFollow.addEventListener('click', () => { this.follow = !this.follow; this.syncFollow(); });
      this.tip = htmlEl('div', { class: 'tp-tip', role: 'tooltip' }, this.root);
      this.tok = htmlEl('div', { class: 'tp-tok', 'aria-hidden': 'true' }, this.root);
      this.tokTag = htmlEl('i', null, this.tok); this.tokVal = htmlEl('b', null, this.tok);
      this.tokRoute = htmlEl('span', { class: 'tp-route' }, this.tok); this.tokNow = htmlEl('span', null, this.tok);
      this.follow = storage.get('topFollow', true) !== false;
      this.syncFollow();
      this.view = { cx: 0, cz: 0, z: 20 };      // centre (world units) and zoom (screen px per unit)
      this.goal = null;
      this.sigs = []; this.jobs = []; this.act = new Map(); this.chipCache = new Map(); this.detail = null;
      this.clk = null; this.flash = 0;
      this.tr = null;
      // the flow: flowLast = the end of the last step (world), parked = the values that stay
      // (held) at the end of their steps in this instruction, flowInstr = the story of them
      this.flowLast = null; this.parked = []; this.flowStory = null; this.tokPos = null;
      this.buildLayout();
      this.bindInput();
      this.w = 0; this.h = 0; this.dirty = true;
    }
    syncFollow() {
      this.btnFollow.setAttribute('aria-pressed', this.follow ? 'true' : 'false');
      storage.set('topFollow', this.follow);
    }

    // ---------- layout ----------
    // All the chips in world units (1 unit = 1 cm), the board at the origin like the 3D
    // board, and the expansion cards in a row above the board (lying flat, fingers down).
    buildLayout() {
      const K = BoardKit;
      this.parts = []; this.byKey = new Map(); this.byGlow = new Map();
      const add = (spec, x, z, rot, where, key) => {
        const d0 = K.chipDims(spec), d = Object.assign({}, d0, { pins: spec.pins });
        const part = K.DIE_OF(spec.part);
        const ppu = Math.min(400, 2048 / (d.L * 0.97));
        const cw = Math.max(64, Math.round(d.L * 0.97 * ppu)), ch = Math.max(32, Math.round(d.W * 0.94 * ppu));
        const lay = K.dieLayout(cw, ch, d, part);
        const p = { key: key || spec.id, glow: spec.glowAs || spec.id, spec, d, part, x, z, rot: !!rot, cw, ch, lay, where,
          name: K.INFO[spec.glowAs || spec.id] ? K.INFO[spec.glowAs || spec.id][0] : spec.part, ref: spec.ref || '' };
        this.parts.push(p);
        this.byKey.set(p.key, p);
        if (!this.byGlow.has(p.glow)) this.byGlow.set(p.glow, []);
        this.byGlow.get(p.glow).push(p);
      };
      for (const c of K.CHIPS) add(c, c.x, c.z, c.rot, 'board');
      for (const b of K.BANKS) for (let i = 0; i < 8; i++) add(Object.assign({}, K.BANK_SPEC, { id: b.id + i, glowAs: b.id, ref: '' }), K.RAM_X(i), b.z, true, 'board', b.id + i);
      // the cards: video, disk, (80286: extended memory), in a row above the board
      const cards = [{ c: K.VGA ? K.VCARD : K.CARD, chips: K.VGA ? K.VGA_CHIPS : K.CARD_CHIPS, title: K.VGA ? 'VGA ADAPTER' : 'CGA COLOR ADAPTER' },
        { c: K.DCARD, chips: K.DISK_CHIPS, title: 'FLOPPY CONTROLLER' }];
      if (K.M286) cards.push({ c: K.XCARD, chips: K.XCARD_CHIPS, title: '1 MB EXTENDED MEMORY' });
      cards.push({ c: K.SBCARD, chips: K.SB_CHIPS, title: 'SOUND BLASTER 2.0' });
      const gap = 1.2, total = cards.reduce((s, x) => s + x.c.len, 0) + gap * (cards.length - 1);
      let x0 = -total / 2;
      this.cards = [];
      const zc = -K.BD / 2 - 1.4 - K.CARD.h / 2;
      for (const cd of cards) {
        const cx = x0 + cd.c.len / 2;
        this.cards.push({ x: cx, z: zc, len: cd.c.len, h: cd.c.h, title: cd.title, finger: zc + cd.c.h / 2, video: cd === cards[0] });
        for (const cs of cd.chips) add(cs, cx + cs.x, zc + cs.z, cs.rot, 'card');
        x0 += cd.c.len + gap;
      }
      // the ISA bus rail under the cards, and where the slot buses of the board end
      this.rail = { z: -K.BD / 2 - 0.7, x0: this.cards[0].x - this.cards[0].len / 2, x1: this.cards[this.cards.length - 1].x + this.cards[this.cards.length - 1].len / 2 };
      // the bundles of traces (2D polylines on the board)
      this.routes = new Map();
      for (const r of K.ROUTES) {
        const ch = r.n > 1 ? Math.max(0.35, (r.n - 1) * r.sp * 0.6) : 0.3;
        const path = K.chamfer(r.pts, ch);
        this.routes.set(r.id, { id: r.id, n: r.n, sp: r.sp, path, kind: BUS_KIND(r.id), name: BUS_NAME(r.id) });
      }
      // the world box of everything
      const bx = [-K.BW / 2, this.rail.x0 - 1.2, this.rail.x1, K.BW / 2];
      // the two 3.5-inch drives at the left of the board (cover off), top view
      const DW = 6.2, DH = 7.4, dx = -K.BW / 2 - 1.2 - DW / 2;
      this.drives = [0, 1].map(i => ({ i, x: dx, z: -DH / 2 - 0.6 + i * (DH + 1.2), w: DW, h: DH, name: i ? 'B:' : 'A:' }));
      const dcard = this.cards.find(c => c.title === 'FLOPPY CONTROLLER'), fdc = this.byKey.get('fdc');
      if (dcard && fdc) {
        const top = dcard.z - dcard.h / 2 + 0.3, xL = dx + DW / 2 + 0.5;
        this.ribbon = this.drives.map(d => [[fdc.x - 2.5, top], [fdc.x - 2.5, top - 0.6], [xL, top - 0.6], [xL, d.z - d.h / 2 + 1.2], [d.x + d.w / 2, d.z - d.h / 2 + 1.2]]);
      }
      bx.push(dx - DW / 2);
      this.world = { x0: Math.min(...bx) - 0.8, x1: Math.max(...bx) + 0.8, z0: zc - K.CARD.h / 2 - (dcard ? 1.8 : 1.2), z1: Math.max(K.BD / 2, this.drives[1].z + DH / 2) + 0.8 };
    }
    // The size of a chip package on the view (world units), and its rectangle.
    pkgRect(p) {
      const L = p.d.L, W = p.d.W;
      return p.rot ? { x0: p.x - W / 2, x1: p.x + W / 2, z0: p.z - L / 2, z1: p.z + L / 2 } : { x0: p.x - L / 2, x1: p.x + L / 2, z0: p.z - W / 2, z1: p.z + W / 2 };
    }
    // The top view has no package covers, so each die is drawn MAGNIFIED to fill its
    // package: the die with its bond pads (a crop of the die picture, base px) fits the
    // package body. s = world units per base px; (cx, cy) = the middle of the crop.
    frameOf(p) {
      if (p.fr) return p.fr;
      const L = p.lay, pad = L.pm * 1.7;
      const x0 = L.dx - pad, y0 = L.dy - pad, w = L.dw + 2 * pad, h = L.dh + 2 * pad;
      // a DIP package is long and narrow: the die may grow past the width, over the pins
      const s = Math.min(p.d.L * 0.94 / w, p.d.W * (p.d.quad ? 0.9 : 1.25) / h);
      return (p.fr = { x0, y0, w, h, s, cx: x0 + w / 2, cy: y0 + h / 2 });
    }
    // Put the canvas in the frame of a die: then draw in base px of the die picture.
    dieFrame(g, p) {
      const f = this.frameOf(p);
      g.translate(p.x, p.z);
      if (p.rot) g.rotate(-Math.PI / 2);
      g.scale(f.s, f.s);
      g.translate(-f.cx, -f.cy);
    }
    // A point of the die picture (base px) in world units. A rotated chip turns so that its
    // die text reads upward.
    dieToWorld(p, bx, by) {
      const f = this.frameOf(p), u = (bx - f.cx) * f.s, v = (by - f.cy) * f.s;
      return p.rot ? [p.x + v, p.z - u] : [p.x + u, p.z + v];
    }
    // A pin at the edge of the package in world units.
    pinToWorld(p, pin) {
      let u, v;
      if (p.d.quad) { u = pin.lx; v = pin.lz; }
      else { u = pin.lx; v = (pin.bottom ? 1 : -1) * p.d.W / 2; }
      return p.rot ? [p.x + v, p.z - u] : [p.x + u, p.z + v];
    }
    dieRect(p) {
      const f = this.frameOf(p);
      const a = this.dieToWorld(p, f.x0, f.y0), b = this.dieToWorld(p, f.x0 + f.w, f.y0 + f.h);
      return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
    }
    blockIdx(p, label) {
      const lbl = (p.part === '80286' && BLK_MAP[label]) || (p.part === '80386' && BoardKit.BLK_386[label]) || (p.part === '80486' && BoardKit.BLK_486[label]) || (p.part === '80586' && BoardKit.BLK_586[label]) || (p.part === '80686' && BoardKit.BLK_686[label]) || label;
      return p.lay.blocks.findIndex(b => b.label === lbl);
    }
    blocksOf(p, label) {
      const lbl = (p.part === '80286' && BLK_MAP[label]) || (p.part === '80386' && BoardKit.BLK_386[label]) || (p.part === '80486' && BoardKit.BLK_486[label]) || (p.part === '80586' && BoardKit.BLK_586[label]) || (p.part === '80686' && BoardKit.BLK_686[label]) || label;
      return p.lay.blocks.filter(b => b.label === lbl);
    }
    blockCenter(p, label) {
      const i = this.blockIdx(p, label), b = p.lay.blocks[i];
      return b ? this.dieToWorld(p, b.x + b.w / 2, b.y + b.h / 2) : [p.x, p.z];
    }
    nearestPin(p, bx, by) {
      let best = null, bd = Infinity;
      for (const pin of p.lay.pins) { const d = Math.hypot(pin.p[0] - bx, pin.p[1] - by); if (d < bd) { bd = d; best = pin; } }
      return best;
    }
    // A chain of bundles as one polyline (like the 3D board chains).
    chainPts(id, trim, rev) {
      const K = BoardKit, ids = K.CHAINS[id];
      if (!ids) return [];
      let pts = [];
      ids.forEach((rid, k) => {
        const r = this.routes.get(rid);
        if (!r) return;
        let pp = r.path.map(a => a.slice());
        if (k > 0 && pts.length > 1) {
          const S = K.cumLen(pts), rS = K.cumLen(r.path), a = K.project(pts, S, pp[0]), b = K.project(r.path, rS, pts[pts.length - 1]);
          if (a.d <= b.d) pts = K.cutAt(pts, S, a.s); else pp = K.cutFrom(r.path, rS, b.s);
        }
        pts = pts.concat(pp);
      });
      if (trim && pts.length > 1) { const S = K.cumLen(pts), a = K.project(pts, S, trim); pts = K.cutAt(pts, S, a.s); }
      if (rev) pts.reverse();
      return pts;
    }
    // From the end of the slot buses of the board up the ISA rail to a chip on a card.
    cardLink(from, p) {
      const card = this.cards.find(c => Math.abs(p.x - c.x) <= c.len / 2 + 0.01 && Math.abs(p.z - c.z) <= c.h / 2 + 0.01);
      if (!card) return [from, [p.x, p.z]];
      return [from, [from[0], this.rail.z], [p.x, this.rail.z], [p.x, card.finger], [p.x, p.z]];
    }

    // ---------- the chip that answers a bus cycle ----------
    target(I) {
      const K = BoardKit, m = this.app.machine;
      let key = null, k = 0, phys = 0, g = null, dev = I.dev;
      const port = I.addr & 0xFFFF;
      if (I.dev === 'ram') {
        phys = I.lo ? (I.width === 2 ? I.addr & ~1 : I.addr) : I.addr | 1;
        const by = m.mem[phys & 0xFFFFF];
        while (k < 7 && !((by >> k) & 1)) k++;
        if (!((by >> k) & 1)) k = 0;
        key = (I.lo ? 'ramE' : 'ramO') + k;
      } else if (I.dev === 'rom') { key = I.lo ? 'romE' : 'romO'; phys = I.lo ? I.addr & ~1 : I.addr | 1; }
      else if (K.IO_DEV[I.dev] || I.kind === 'inta') key = I.dev;
      if (I.dev === 'vram') { const gs = K.vramChips(m, I.addr, I.read); g = gs.find(x => x.bit) || gs[0]; if (g) key = g.key; }
      else if (I.dev === 'xram') { g = K.xramChip(m, I.addr, I.width === 2 ? (I.lo ? 0 : 1) : I.addr & 1); key = g.key; }
      else if (I.dev === 'crtc' || I.dev === 'cga') { key = 'crtc'; dev = 'crtc'; }
      else if (I.dev === 'vga') { key = dev = K.DAC_PORT(port) ? 'dac' : 'vgac'; }
      else if (I.dev === 'fdc') key = 'fdc';
      else if (I.dev === 'sb') { key = dev = 'sbdsp'; }
      else if (I.dev === 'opl') { key = dev = 'opl'; }
      else if (I.dev === 'vrom') { key = 'vbios'; phys = I.addr; }
      const p = key ? this.byKey.get(key) : null;
      if (!p) return null;
      const byte = m.mem[phys & 0xFFFFF];
      const ctx = { I, m, part: p.part, dev, port, phys, byte, key };
      if (g) Object.assign(ctx, { row: g.row, col: g.col, bit: g.bit, rb: g.rb || K.RB, cb: g.cb || K.RB });
      else if (I.dev === 'ram') { const c0 = (phys >> 1) & ((1 << (2 * K.RB)) - 1); Object.assign(ctx, { row: c0 & ((1 << K.RB) - 1), col: c0 >> K.RB, bit: (byte >> k) & 1, rb: K.RB, cb: K.RB }); }
      else if (I.dev === 'rom' || I.dev === 'vrom') { const ca = (phys >> 1) & ((1 << (8 + K.CB)) - 1); Object.assign(ctx, { row: (ca >> K.CB) & 0xFF, col: ca & ((1 << K.CB) - 1) }); }
      else ctx.target = I.kind === 'inta' ? 'ISR' : K.ioBlock(dev, port, I.read, m.crtc ? m.crtc.index : 0);
      return { p, ctx, model: K.traceModel(p.part) };
    }
    // The board paths of one bus cycle: address out, command, data (2D polylines).
    busPaths(I, tg) {
      const K = BoardKit;
      const tp = tg ? tg.p : null;
      const onCard = tp && tp.where === 'card';
      const aId = I.dev === 'ram' ? 'A_ram' : I.dev === 'rom' ? 'A_rom' : onCard ? 'A_slot' : (I.io || I.kind === 'inta') ? 'A_io' : 'A_ram';
      const trim = tp && !onCard ? [tp.x, tp.z] : null;
      const withCard = pts => (onCard && pts.length ? pts.concat(this.cardLink(pts[pts.length - 1], tp).slice(1)) : pts);
      const addr = withCard(this.chainPts(I.fpu ? 'L_addr_fpu' : 'L_addr_cpu').concat(this.chainPts(aId, trim)));
      const cmdR = onCard ? 'CMD_SLOT' : (I.io || I.kind === 'inta') ? 'CMD_IO' : 'CMD_MEM';
      const cmd = withCard((this.routes.get('S02') ? this.routes.get('S02').path : []).concat(this.routes.get(cmdR) ? this.routes.get(cmdR).path : []));
      const csId = tp && !onCard ? 'CS_' + (I.dev === 'ram' || I.dev === 'rom' ? I.dev : tp.glow) : null;
      const cs = csId && this.routes.get(csId) ? this.routes.get(csId).path : null;
      const dId = I.dev === 'ram' ? (I.lo ? 'D_ramE' : 'D_ramO') : I.dev === 'rom' ? (I.lo ? 'D_romE' : 'D_romO') : onCard ? 'D_slot' : I.dev !== 'none' ? 'D_io' : null;
      const lData = I.dev === 'fpu' ? 'L_fpu' : I.fpu ? 'L_data_fpu' : 'L_data_cpu';
      let data = (dId ? this.chainPts(dId, trim) : []).concat(this.chainPts(lData, null, true).slice().reverse());
      data = withCard(data);
      if (I.read) data = data.slice().reverse();
      return { addr, cmd, cs, data, cmdName: K.CMD_NAME[K.CMD_BIT[I.kind]] };
    }

    // ---------- view contract ----------
    show() { this.visible = true; this.dirty = true; this.resize(); if (!this.fitted) { this.fitAll(true); this.fitted = true; } }
    hide() { this.visible = false; this.tip.classList.remove('tp-on'); if (this.card) this.card.hide(); }
    resize() {
      if (!this.ok) return;
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === this.w && h === this.h && dpr === this.dpr) return;
      this.w = w; this.h = h; this.dpr = dpr;
      for (const c of [this.base, this.fx]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      if (!this.userMoved) this.fitAll(true);
      this.dirty = true;
    }
    reset() {
      this.sigs.length = 0; this.jobs.length = 0; this.act.clear(); this.clk = null;
      this.traceClear();
      this.dirty = true;
    }
    setReducedMotion(on) { this.reduced = !!on; if (this.card) this.card.setReducedMotion(this.reduced); }
    instr(events, info) {
      this.curEvents = events;
      if (!this.app.tracing) this.clk = { t0: animNow(), ms: info.clockMs, n: info.cycles, last: -1 };
    }
    event(e, clockMs) {
      if (!this.ok || this.app.tracing) return;
      this.live(e, animNow(), clockMs);
    }
    fast(stats) {
      if (!this.ok || !this.visible) return;
      const now = animNow();
      this.fastT = now;
      if (stats.sample && !this.reduced && now - (this.lastSample || 0) > 450) {
        this.lastSample = now;
        for (const e of stats.sample) this.live(e, now + (e.t || 0) * 40, 40);
      }
    }

    // ---------- live activity (normal run) ----------
    // Each bus cycle lights its paths one after the other (address, command, data) with the
    // value on the front, and each micro-event plays the drawing of its unit on the die.
    live(ev, now, clockMs) {
      const K = BoardKit, m = this.app.machine, dur = clamp(clockMs * 4, 260, 3000);
      const cpu = this.byKey.get('cpu'), fpu = this.byKey.get('fpu');
      const unitJobs = (p, visits, t0) => {
        if (!p || !visits) return;
        visits.forEach(([label, card], k) => { if (card) this.addJob(p, label, card, t0 + k * dur * 0.55, dur); });
      };
      if (ev.k === 'fetch' || ev.k === 'bus') {
        const I = Object.assign(Story.busInfo(ev), {});
        if (I.kind === 'halt') { this.touch('bus', now, dur, 'ctrl'); return; }
        const tg = this.target(I), P = this.busPaths(I, tg), col = COL();
        if (tg) { this.recent = (this.recent || []).filter(x => x.key !== tg.p.key); this.recent.push({ key: tg.p.key, t: now }); if (this.recent.length > 6) this.recent.shift(); }
        const who = I.fpu ? 'fpu' : 'cpu';
        const hx = I.io ? `port ${hex(I.addr & 0xFFFF, 3)}h` : K.hexA(I.addr) + 'h';
        const val = (I.width === 2 ? hex(I.data, 4) : hex(I.data, 2)) + 'h';
        this.addSig(P.addr, now, dur * 0.4, col.addr, (I.io ? 'PORT ' : 'ADDR ') + hx);
        this.addSig(P.cmd, now + dur * 0.25, dur * 0.35, col.ctrl, P.cmdName || '');
        if (P.cs) this.addSig(P.cs, now + dur * 0.3, dur * 0.25, col.ctrl, '');
        this.addSig(P.data, now + dur * 0.55, dur * 0.45, I.fpu ? col.fpu : col.data, (I.kind === 'fetch' ? 'CODE ' : 'DATA ') + val);
        this.touch(who, now, dur, I.fpu ? 'fpu' : 'addr');
        this.touch('bus', now + dur * 0.25, dur * 0.5, 'ctrl');
        for (const k2 of ['lat0', 'lat1', 'lat2']) this.touch(k2, now + dur * 0.15, dur * 0.4, 'addr');
        this.touch('xcv0', now + dur * 0.55, dur * 0.45, 'data'); this.touch('xcv1', now + dur * 0.55, dur * 0.45, 'data');
        if (tg) {
          this.touch(tg.p.key, now + dur * 0.3, dur * 0.8, I.read ? 'data' : 'addr');
          const md = tg.model, tc = Object.assign(tg.ctx, { s: { token: { tag: P.cmdName || '' } }, ev });
          const list = [].concat(md.addr ? md.addr(tc) : [], md.cmd ? md.cmd(tc) : [], I.read ? (md.read ? md.read(tc) : []) : (md.write ? md.write(tc) : []));
          unitJobs(tg.p, list, now + dur * 0.35);
        }
        const ctx = { I, s: { token: { tag: '' } }, ev, m };
        unitJobs(I.fpu ? fpu : cpu, I.read ? K.CPU_TRACE.out(ctx).concat(K.CPU_TRACE.in(ctx)) : K.CPU_TRACE.out(ctx).concat(K.CPU_TRACE.write(ctx)), now);
      } else if (ev.k === 'fdc' || ev.k === 'dma') {
        this.fdcLive(ev, now, dur);
      } else if (ev.k === 'sb' || ev.k === 'opl') {
        const p = this.byKey.get(ev.k === 'opl' ? 'opl' : 'sbdsp');
        if (p) { K.SOUND_CARD({ e: ev }).forEach(([label, c], k) => this.addJob(p, label, c, now + k * dur * 0.5, dur * 1.5)); this.touch(p.key, now, dur * 1.5, ev.k === 'opl' ? 'ctrl' : 'data'); }
        if (ev.k === 'sb' && ev.op === 'dma') { const P = this.fdcPaths(); if (P.memory) this.addSig(P.memory.slice().reverse(), now, dur, COL().data, `DMA 1 → DSP ${ev.rate || ''} Hz`); }
      } else if (ev.k === 'uop' || ev.k === 'rat' || ev.k === 'rob') {
        const p = this.byKey.get('cpu');
        if (p) K.P6_CARDS([ev]).forEach(([label, c], k) => this.addJob(p, label, c, now + k * dur * 0.5, dur * 1.5));
      } else if (ev.k === 'btb' || ev.k === 'pipe') {
        const p = this.byKey.get('cpu');
        if (p) K.P5_CARDS(ev).forEach(([label, c], k) => this.addJob(p, label, c, now + k * dur * 0.5, dur * 1.5));
      } else if (ev.k === 'cache' && !ev.hit) {
        const p = this.byKey.get('cpu');
        if (p) K.CACHE_CARD({ e: ev }).forEach(([label, c], k) => this.addJob(p, label, c, now + k * dur * 0.5, dur * 1.5));
      } else if (ev.k === 'page') {
        const p = this.byKey.get('cpu');
        if (p) K.PAGE_CARD({ e: ev }).forEach(([label, c], k) => this.addJob(p, label, c, now + k * dur * 0.5, dur * 1.5));
      } else if (['decode', 'alu', 'reg', 'ea', 'flags', 'int', 'desc', 'fpu'].includes(ev.k) || (ev.k === 'queue' && ev.op === 'flush')) {
        const unit = ev.k === 'fpu' ? 'fpu' : 'cpu';
        const evs = ev.k === 'decode' ? [ev].concat((this.curEvents || []).filter(x => x.k === 'queue' && x.op === 'pop').slice(0, 1)) : [ev];
        const p = unit === 'fpu' && !K.FPU_ON ? fpu : cpu;   // the 486 / Pentium FPU is on the CPU die
        unitJobs(p, K.CPU_TRACE.inside({ s: { evs, unit }, m }), now);
        this.touch(p ? p.key : unit, now, dur, unit === 'fpu' ? 'fpu' : 'eu');
        if (ev.k === 'int' && ev.src === 'irq') {
          const r = this.routes.get('INTR');
          if (r) this.addSig(r.path, now, dur * 0.6, COL().ctrl, `INTR ${hex(ev.vec, 2)}h`);
          this.touch('pic', now, dur, 'ctrl');
        }
      }
    }
    // Play a list of micro-events now, one bus cycle after the other (for the tests). It
    // returns the chip that answers each bus cycle.
    demo(events, clockMs = 400) {
      const now = animNow(), out = [];
      this.curEvents = events;
      events.forEach(e => {
        if (e.k === 'fetch' || e.k === 'bus') { const tg = this.target(Story.busInfo(e)); out.push(tg ? `${tg.p.key} (${tg.p.part}, ${tg.p.where})` : 'no target'); }
        this.live(e, now + (e.t || 0) * clockMs, clockMs);
      });
      return out;
    }
    // The monitor connector at the bracket end of the video card.
    connector(c) { return { x: c.x - c.len / 2 - 0.55, z: c.z - 0.2 }; }   // on the bracket, past the card end
    // The work of the video card that does not need the CPU: the CRTC counts the refresh
    // address, the video RAM gives the bytes of that address, and the picture goes out to
    // the monitor (on the VGA, through the palette DAC). A quiet repeat about once a second.
    videoScan(now) {
      if (this.tr || this.reduced || !this.visible) return;
      if (now - (this.scanT || -1e9) < 1400) return;
      this.scanT = now;
      const K = BoardKit, m = this.app.machine, card = this.cards.find(c => c.video);
      if (!card) return;
      const ctl = this.byKey.get(K.VGA ? 'vgac' : 'crtc');
      const rams = K.VGA ? ['vdram0', 'vdram2', 'vdram4', 'vdram6'].map(k => this.byKey.get(k)).filter(Boolean) : ['vram0', 'vram1'].map(k => this.byKey.get(k)).filter(Boolean);
      if (!ctl || !rams.length) return;
      // the refresh address moves one text row (or one line of pixels) at each repeat
      this.scanA = ((this.scanA || 0) + (K.VGA ? 320 : 80)) % (K.VGA ? 0x10000 : 2000);
      const a = this.scanA, byte = K.VGA ? (m.vga && m.vga.planes ? m.vga.planes[0][a] : 0) : m.mem[0xB8000 + a * 2];
      const col = COL(), dur = 1100;
      const at = (p, label) => this.blockCenter(p, label);
      const cc = at(ctl, K.VGA ? 'CRTC' : 'REFRESH ADDR');
      for (const r of rams) {
        const rc = at(r, 'CELL ARRAY');
        this.addSig([cc, [cc[0], rc[1]], rc], now, dur * 0.35, col.addr, r === rams[0] ? `refresh ${hex(a, 4)}h` : '', 0.55);
        this.addSig([rc, [rc[0], cc[1] + 0.25], [cc[0] - 0.3, cc[1] + 0.25]], now + dur * 0.35, dur * 0.3, col.data, r === rams[0] ? `${hex(byte, 2)}h` : '', 0.55);
        this.addJob(r, 'CELL ARRAY', { kind: 'cells', title: 'CELL ARRAY', chip: r.part, sub: 'The refresh reads a row of the video RAM.', rows: 8, cols: 8, row: a & 7, col: (a >> 3) & 7, bit: byte & 1, write: false, mem: 'dram', col: 'data' }, now, dur);
      }
      this.addJob(ctl, K.VGA ? 'CRTC' : 'REFRESH ADDR', { kind: 'counter', title: K.VGA ? 'CRTC' : 'REFRESH ADDRESS', chip: ctl.part, sub: 'The refresh address counts through the video RAM.', v: a, reload: K.VGA ? 0xFFFF : 1999, label: 'refresh address', mode: 'count up', col: 'addr' }, now, dur);
      let out = cc;
      const dac = K.VGA ? this.byKey.get('dac') : null;
      if (dac) {
        const dc = at(dac, 'PALETTE RAM 256X18');
        this.addSig([cc, [dc[0], cc[1]], dc], now + dur * 0.6, dur * 0.25, col.data, `pixel ${hex(byte, 2)}h`, 0.55);
        this.addJob(dac, 'PALETTE RAM 256X18', { kind: 'decoder', title: 'PALETTE RAM', chip: 'RAMDAC', sub: `The pixel ${hex(byte, 2)}h selects a palette entry: 18 bits of red, green and blue.`, bits: 8, value: byte, inLabel: 'pixel', outLabel: 'palette entries', col: 'data' }, now + dur * 0.6, dur);
        out = dc;
      } else this.addJob(ctl, 'CURSOR CTRL', { kind: 'text', title: 'VIDEO OUT', chip: '6845', sub: 'Sync pulses and the character dots go to the monitor.', lines: ['HSYNC · VSYNC', 'dots → DE-9'], col: 'ctrl' }, now + dur * 0.6, dur);
      const k = this.connector(card);
      this.addSig([out, [out[0], card.z + card.h / 2 - 0.9], [k.x, card.z + card.h / 2 - 0.9], [k.x, k.z]], now + dur * 0.75, dur * 0.3, col.ctrl, 'video → monitor', 0.55);
      this.touch(ctl.key, now, dur, 'addr');
    }
    // ---------- floppy: controller, DMA and drives ----------
    // Paths: drive -> ribbon -> controller card; controller -> ISA rail -> board -> DMA or PIC.
    fdcPaths() {
      const K = BoardKit, fdc = this.byKey.get('fdc');
      if (!fdc) return {};
      const up = this.cardLink([0, 0], fdc).slice(1).reverse();   // from the chip down to the rail
      const slot = this.chainPts('A_slot');
      const slotEnd = slot.length ? slot[slot.length - 1] : [0, 0];
      const toBoard = up.concat([[slotEnd[0], this.rail.z], slotEnd]);
      const chip = k => { const p = this.byKey.get(k); return p ? [p.x, p.z] : null; };
      const dma = chip('dma'), pic = chip('pic');
      return { fdc, toDma: dma ? toBoard.concat([[slotEnd[0], dma[1]], dma]) : null, toPic: pic ? toBoard.concat([[slotEnd[0], pic[1] + 0.8], [pic[0], pic[1] + 0.8], pic]) : null,
        ribbon: this.ribbon || [], memory: this.byKey.get('ramE0') ? [slotEnd, [slotEnd[0], this.byKey.get('ramE0').z - 1.2], [this.byKey.get('ramE0').x, this.byKey.get('ramE0').z - 1.2], [this.byKey.get('ramE0').x, this.byKey.get('ramE0').z]] : null };
    }
    fdcLive(ev, now, dur) {
      const K = BoardKit, P = this.fdcPaths(), col = COL();
      if (!P.fdc) return;
      const card = K.FDC_CARD(ev.k === 'dma' ? { kind: 'dma', e: ev } : { kind: 'fdc', e: ev });
      const chip = ev.k === 'dma' ? this.byKey.get('dma') : P.fdc;
      card.forEach(([label, c], k) => { if (c) this.addJob(chip, label, c, now + k * dur * 0.5, dur * 1.5); });
      this.touch(chip.key, now, dur * 1.5, ev.k === 'dma' ? 'data' : 'ctrl');
      const rib = P.ribbon[ev.drive || 0];
      if (ev.k === 'dma') {
        if (P.toDma) this.addSig(P.toDma, now, dur, col.ctrl, 'DRQ 2 → 8237');
        if (P.memory) this.addSig(ev.read ? P.memory.slice().reverse() : P.memory, now + dur * 0.5, dur, col.data, `DMA ${ev.n || 1} B ${ev.read ? '→ FDC' : '→ RAM'}`);
      } else if (ev.op === 'irq' || ev.op === 'reset') {
        if (P.toPic) this.addSig(P.toPic, now, dur, col.ctrl, 'IRQ 6');
      } else if (rib && (ev.op === 'seek' || ev.op === 'step')) {
        this.addSig(rib.slice().reverse(), now, dur, col.addr, `STEP → track ${ev.cyl}`);
      } else if (rib && ev.op === 'read') {
        this.addSig(rib, now, dur, col.data, `READ DATA T${ev.cyl} S${ev.sec || '?'}`);
      } else if (rib && ev.op === 'write') {
        this.addSig(rib.slice().reverse(), now, dur, col.data, `WRITE DATA T${ev.cyl} S${ev.sec || '?'}`);
      }
      if (ev.drive !== undefined && this.drives[ev.drive]) this.drives[ev.drive].flash = { t: now, op: ev.op || 'dma' };
    }
    // The drive state from the controller (m.fdc.drives), or a simple model from m.disks.
    driveState(i) {
      const m = this.app.machine, f = m.fdc && m.fdc.drives && m.fdc.drives[i];
      const disk = m.disks && m.disks[i];
      if (f) return Object.assign({ spt: disk ? disk.spt : 18, cyls: disk ? disk.cyls : 80, present: !!disk }, f);
      const busy = disk ? disk.busy || 0 : 0, spt = disk ? disk.spt : 18;
      const lba = disk ? disk.lastSector || 0 : 0;
      return { present: !!disk, motor: busy > 0.05, spin: busy > 0.05 ? 1 : 0, cyl: disk ? Math.floor(lba / (spt * disk.heads)) : 0, head: disk ? Math.floor(lba / spt) % disk.heads : 0,
        angle: (performance.now() / 200) % 1, sector: disk ? (lba % spt) + 1 : 0, reading: busy > 0.5, writing: false, spt, cyls: disk ? disk.cyls : 80, simple: true };
    }
    drawDrivesBase(g, px) {
      const K = BoardKit;
      for (const r of this.ribbon || []) {
        g.save(); g.strokeStyle = '#8e97a3'; g.globalAlpha = 0.55; g.lineWidth = 0.34; g.lineJoin = 'round'; this.poly(g, r); g.stroke();
        g.globalAlpha = 0.9; g.strokeStyle = '#c0453b'; g.lineWidth = Math.max(0.04, px); this.poly(g, offsetPath(r, 0.14)); g.stroke(); g.restore();
      }
      for (const d of this.drives) {
        g.fillStyle = '#2a2f37'; this.rrect(g, d.x - d.w / 2, d.z - d.h / 2, d.w, d.h, 0.25); g.fill();
        g.strokeStyle = '#4a525d'; g.lineWidth = Math.max(0.04, 1.5 * px); g.stroke();
        // the electronics board of the drive at the back
        g.fillStyle = K.PAL.cardTop; g.fillRect(d.x - d.w / 2 + 0.2, d.z - d.h / 2 + 0.2, d.w - 0.4, 1.35);
        const blocks = [['MOTOR', 'motor'], ['STEPPER', 'step'], ['READ AMP', 'read'], ['WRITE', 'write']];
        blocks.forEach(([t], k) => {
          const bx = d.x - d.w / 2 + 0.35 + k * (d.w - 0.7) / 4;
          g.fillStyle = '#16191e'; g.fillRect(bx, d.z - d.h / 2 + 0.35, (d.w - 0.7) / 4 - 0.12, 0.7);
          if (this.view.z > 18) this.text(g, t, bx + ((d.w - 0.7) / 4 - 0.12) / 2, d.z - d.h / 2 + 0.7, 0.16, THEME.muted, 'center', 0.9);
        });
        this.text(g, `DRIVE ${d.name}`, d.x - d.w / 2 + 0.3, d.z + d.h / 2 - 0.35, 0.3, THEME.text, 'left', 0.85);
        this.text(g, '3.5 in', d.x + d.w / 2 - 0.3, d.z + d.h / 2 - 0.35, 0.22, THEME.muted, 'right', 0.8);
        // the head rail (lead screw) from the outer edge to the hub
        const c = this.diskGeom(d);
        g.strokeStyle = '#6d7682'; g.lineWidth = 0.1;
        g.beginPath(); g.moveTo(c.cx + c.R + 0.35, c.cz); g.lineTo(c.cx + c.R * 0.25, c.cz); g.stroke();
        g.fillStyle = '#39414c'; g.fillRect(c.cx + c.R + 0.25, c.cz - 0.35, 0.45, 0.7);
        if (this.view.z > 22) this.text(g, 'stepper', c.cx + c.R + 0.47, c.cz + 0.55, 0.14, THEME.muted, 'center', 0.8);
      }
    }
    diskGeom(d) { const R = Math.min(d.w, d.h - 1.9) * 0.42; return { cx: d.x - 0.35, cz: d.z + 0.55, R }; }
    drawDrivesFx(g, now, px) {
      const col = COL();
      for (const d of this.drives) {
        const st = this.driveState(d.i), c = this.diskGeom(d);
        const { cx, cz, R } = c;
        if (!st.present) {
          this.text(g, 'no disk', cx, cz, 0.35, THEME.muted, 'center', 0.8);
          continue;
        }
        // the disk: magnetic surface, the metal hub, and the tracks
        g.save();
        g.fillStyle = '#3a2b22'; g.beginPath(); g.arc(cx, cz, R, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(255,220,180,0.07)'; g.lineWidth = Math.max(0.005, 0.6 * px);
        const rOut = R * 0.93, rIn = R * 0.42, cyls = st.cyls || 80;
        if (this.view.z > 25) for (let t = 0; t < cyls; t += (this.view.z > 60 ? 1 : 4)) { g.beginPath(); g.arc(cx, cz, rOut - (rOut - rIn) * t / cyls, 0, TAU); g.stroke(); }
        const ang = (st.angle || 0) * TAU;
        // the sectors of the track under the head, turning with the disk
        const tr = rOut - (rOut - rIn) * (st.cyl || 0) / cyls, bw = (rOut - rIn) / cyls * 2.2 + 2 * px;
        const spt = st.spt || 18;
        for (let k = 0; k < spt; k++) {
          const a0 = ang + k / spt * TAU, a1 = a0 + TAU / spt * 0.86, under = st.sector === k + 1;
          g.strokeStyle = under ? (st.writing ? col.addr : col.data) : 'rgba(255,255,255,0.14)';
          g.globalAlpha = under ? 1 : 0.8;
          g.lineWidth = Math.max(bw, (under ? 3 : 1.5) * px);
          g.beginPath(); g.arc(cx, cz, tr, a0, a1); g.stroke();
          if (this.view.z > 45) { const am = (a0 + a1) / 2; this.text(g, String(k + 1), cx + Math.cos(am) * (tr - bw * 1.2), cz + Math.sin(am) * (tr - bw * 1.2), Math.min(0.2, bw * 0.9), under ? THEME.goldHi : THEME.muted, 'center', 0.9); }
        }
        g.globalAlpha = 1;
        // hub and drive pin (it shows the rotation) and the index hole
        g.fillStyle = '#b9c0c8'; g.beginPath(); g.arc(cx, cz, R * 0.2, 0, TAU); g.fill();
        g.fillStyle = '#2a2f37'; g.fillRect(cx + Math.cos(ang) * R * 0.1 - 0.06, cz + Math.sin(ang) * R * 0.1 - 0.06, 0.12, 0.12);
        const ix = [cx + Math.cos(ang - 0.3) * R * 0.3, cz + Math.sin(ang - 0.3) * R * 0.3];
        g.fillStyle = st.index ? THEME.goldHi : '#0c0d10'; g.beginPath(); g.arc(ix[0], ix[1], R * 0.035 + (st.index ? 2 * px : 0), 0, TAU); g.fill();
        // the motor: a ring around the hub while it turns
        if (st.motor || st.spin > 0.02) {
          g.strokeStyle = col.ctrl; g.globalAlpha = 0.35 + 0.5 * (st.spin || 0); g.lineWidth = Math.max(0.03, 2 * px);
          g.beginPath(); g.arc(cx, cz, R * 0.24, 0, TAU); g.stroke(); g.globalAlpha = 1;
        }
        // the head on the rail at its track (the head of side 1 is under the disk)
        const hx = cx + tr, hz = cz;
        g.fillStyle = st.stepping ? col.addr : st.reading ? col.data : st.writing ? col.addr : '#c8ccd2';
        g.shadowColor = g.fillStyle; g.shadowBlur = st.stepping || st.reading || st.writing ? 12 * this.dpr : 0;
        g.fillRect(hx - 0.22, hz - 0.3, 0.44, 0.6);
        g.shadowBlur = 0;
        if (this.view.z > 14) this.text(g, `track ${st.cyl}${st.head ? ' · side 1' : ''}`, hx + 0.5, hz - 0.5, 0.2, THEME.text, 'left', 0.9);
        // the parts of the drive board that work now
        const fl = d.flash && now - d.flash.t < 1500 ? d.flash.op : null;
        const on = [st.motor || st.spin > 0.02, st.stepping || fl === 'seek' || fl === 'step', st.reading || fl === 'read', st.writing || fl === 'write'];
        on.forEach((v, k) => {
          if (!v) return;
          const bx = d.x - d.w / 2 + 0.35 + k * (d.w - 0.7) / 4;
          g.strokeStyle = [col.ctrl, col.addr, col.data, col.addr][k]; g.lineWidth = Math.max(0.03, 2 * px);
          g.shadowColor = g.strokeStyle; g.shadowBlur = 10 * this.dpr;
          g.strokeRect(bx, d.z - d.h / 2 + 0.35, (d.w - 0.7) / 4 - 0.12, 0.7);
          g.shadowBlur = 0;
        });
        // the LED
        g.fillStyle = st.motor ? '#4dff88' : '#123018';
        g.beginPath(); g.arc(d.x + d.w / 2 - 0.45, d.z - d.h / 2 + 1.85, 0.14, 0, TAU); g.fill();
        g.restore();
      }
    }
    addSig(pts, t0, dur, col, label, alpha = 1) {
      if (!pts || pts.length < 2) return;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      this.sigs.push({ pts, cum, len: cum[cum.length - 1], t0, dur, col, label, alpha });
      if (this.sigs.length > 40) this.sigs.splice(0, this.sigs.length - 40);
    }
    // A chip (or all the chips of a glow group) is busy for a while.
    touch(key, t0, dur, kind) {
      const list = this.byKey.has(key) ? [this.byKey.get(key)] : this.byGlow.get(key) || [];
      for (const p of list) this.act.set(p.key, { t0, t1: t0 + dur, kind });
    }
    addJob(p, label, card, t0, dur) {
      this.jobs = this.jobs.filter(j => !(j.p === p && j.label === label));
      this.jobs.push({ p, label, card, t0, dur });
      if (this.jobs.length > 40) this.jobs.splice(0, this.jobs.length - 40);
    }

    // ---------- trace ----------
    // The same story steps as the 3D board: a token visits the blocks of the chips (a
    // pause in each block while its work plays) and travels fast over the board.
    traceStep(story, i, info) {
      if (!this.ok) return;
      if (!story) { this.traceClear(); return; }
      const s = story.steps[i];
      const now = animNow();
      if (story !== this.flowStory || (info && info.back)) { this.flowStory = story; this.parked = []; if (info && info.back) this.flowLast = null; }
      // the value of the last step stays where it ended (a held value), when the new step
      // starts at another place
      const f = this.flowFull(s, this.app.stepMs, now);   // (the speed setting; info.ms is the time of the step)
      const prev = this.tr;
      if (prev && prev.story === story && prev.i !== i && f.jump && this.flowLast && prev.s.kind === 'bus') {
        const ps = prev.s;
        this.parked.push({ pos: this.flowLast.slice(), tag: ps.token.tag, val: ps.token.val || '', col: ps.token.col });
        if (this.parked.length > 6) this.parked.shift();
      }
      this.tr = { story, i, s, segs: f.segs, t0: now, dur: Math.max(200, (info && info.ms) || f.T), T: f.T, pan: f.pan, lastSeg: -1, mainT: f.mainT || f.T,
        bg: (f.bg || []).map(q => ({ s: q.s, segs: q.segs, t0: now + f.pan, dur: q.T, pan: 0 })) };
      this.tr.cam = f.cam && Math.abs(this.tr.dur - f.T) < 1 ? f.cam : this.flowCamera(this.tr);
      const last = f.segs[f.segs.length - 1];
      this.flowLast = last ? (last.kind === 'dwell' ? last.at.slice() : last.pts[last.pts.length - 1].slice()) : this.flowLast;
      this.act.clear();
      this.dirty = true;
    }
    // The time of a step at this speed (the app asks the view before it starts the step).
    traceDur(s, ms) { return this.flowFull(s, ms, animNow()).T; }
    // The plan of a step with its camera track, in two passes: the times of the token parts
    // come from the zoom that the camera track really has at that time (so the token keeps
    // its screen speed also while the camera zooms). The result stays for traceStep.
    flowFull(s, ms, now) {
      const key = [s.kind, s.phase, s.t, s.title, ms, this.view.cx, this.view.cz, this.view.z, this.w, this.h].join('|');
      if (this.flowCache && this.flowCache.key === key && this.flowCache.s === s) return this.flowCache.f;
      const f = this.flowPlan(s, ms), k = this.flowK(ms);
      let cam = null;
      for (let pass = 0; pass < 2; pass++) {
        const tt = { segs: f.segs, t0: now, dur: f.T, pan: f.pan };
        cam = this.flowCamera(tt);
        // the most zoomed-in moment of each part gives its time
        let T = f.pan;
        for (const sg of f.segs) {
          if (!sg.unit) {
            const a = Math.floor(sg.t0 * f.T / cam.dtS), b = Math.min(cam.n - 1, Math.ceil(sg.t1 * f.T / cam.dtS));
            let lz = -Infinity;
            for (let i = Math.max(0, a); i <= b; i++) lz = Math.max(lz, cam.lz[i]);
            const z = isFinite(lz) ? Math.max(sg.zc, Math.exp(lz)) : sg.zc;
            sg.dt = Math.max(0.2, sg.len * z / FLOW_PX_S) * 1000 * k;
          }
          T += sg.dt;
        }
        let t = f.pan;
        for (const sg of f.segs) { sg.t0 = t / T; t += sg.dt; sg.t1 = t / T; }
        f.T = Math.max(200, T);
      }
      // the work in parallel (s.bg, for example a prefetch): a second token at twice the speed;
      // the step ends when both are done, and the camera follows it after the main token
      // (the normal speed: the camera can follow it; its units only pass it)
      f.bg = (s.bg || []).map(b => { const q = this.flowPlan(b, ms, { bg: true }); q.s = b; return q; });
      const mainT = f.T;
      for (const q of f.bg) f.T = Math.max(f.T, f.pan + q.T);
      f.mainT = mainT;
      f.cam = this.flowCamera({ segs: f.segs, t0: now, dur: f.T, pan: f.pan, mainT, bg: f.bg });
      // the token in parallel: its times from the real zoom too, but only where the camera
      // follows it (fol), and at most 12 times the zoom of its context
      f.bg.forEach((q, qi) => {
        const c = f.cam;
        let T = q.pan;
        for (const sg of q.segs) {
          if (!sg.unit) {
            const a = Math.floor((f.pan + sg.t0 * q.T) / c.dtS), b = Math.min(c.n - 1, Math.ceil((f.pan + sg.t1 * q.T) / c.dtS));
            let lz = -Infinity;
            for (let i = Math.max(0, a); i <= b; i++) if (c.fol[i] && qi === 0) lz = Math.max(lz, c.lz[i]);   // (the camera follows only the first)
            const z = isFinite(lz) ? clamp(Math.exp(lz), sg.zc, sg.zc * 12) : sg.zc;
            sg.dt = Math.max(0.2, sg.len * z / FLOW_PX_S) * 1000 * k;
          }
          T += sg.dt;
        }
        let tt = q.pan;
        for (const sg of q.segs) { sg.t0 = tt / T; tt += sg.dt; sg.t1 = tt / T; }
        q.T = Math.max(200, T);
        f.T = Math.max(f.T, f.pan + q.T);
      });
      if (f.bg.length) f.cam = this.flowCamera({ segs: f.segs, t0: now, dur: f.T, pan: f.pan, mainT, bg: f.bg });
      this.flowCache = { key, s, f };
      return f;
    }

    // ---------- the flow: one continuous line for each step ----------
    // The token moves at a constant speed on the screen (FLOW_PX_S at the normal trace speed),
    // crosses each unit in FLOW_UNIT_S, and the camera follows it on a smooth track.
    flowK(ms) { return clamp((ms || 1700) / 1700, 0.08, 3); }
    // The zoom that shows a whole die (in the part of the view that nothing covers).
    fitZoom(b, margin) {
      const w = this.w || 800, h = this.h || 500, { left, right } = this.cover(true);
      const fw = Math.max(w * 0.4, w - left - right), fh = h - 48 - this.barH();
      return clamp(Math.min(fw / ((b.x1 - b.x0) * margin), fh / ((b.z1 - b.z0) * margin)), 2, 4000);
    }
    boxOf(pts, min) {
      const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
      for (const q of pts) { b.x0 = Math.min(b.x0, q[0]); b.x1 = Math.max(b.x1, q[0]); b.z0 = Math.min(b.z0, q[1]); b.z1 = Math.max(b.z1, q[1]); }
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, hw = Math.max(min, b.x1 - b.x0) / 2, hh = Math.max(min, b.z1 - b.z0) / 2;
      return { x0: cx - hw, x1: cx + hw, z0: cz - hh, z1: cz + hh };
    }
    // The rectangle of a unit (its first block) in world units.
    blockRect(p, label) {
      const b = this.blocksOf(p, label)[0];
      if (!b) return null;
      const a = this.dieToWorld(p, b.x, b.y), c = this.dieToWorld(p, b.x + b.w, b.y + b.h);
      return { x0: Math.min(a[0], c[0]), x1: Math.max(a[0], c[0]), z0: Math.min(a[1], c[1]), z1: Math.max(a[1], c[1]) };
    }
    // The point where the line from c (inside r) to q leaves the rectangle r.
    edgeTo(c, q, r) {
      const dx = q[0] - c[0], dz = q[1] - c[1];
      const tx = dx > 1e-9 ? (r.x1 - c[0]) / dx : dx < -1e-9 ? (r.x0 - c[0]) / dx : Infinity;
      const tz = dz > 1e-9 ? (r.z1 - c[1]) / dz : dz < -1e-9 ? (r.z0 - c[1]) / dz : Infinity;
      const t = Math.min(1, tx, tz);
      return [c[0] + dx * t, c[1] + dz * t];
    }
    // The segments of a step as one line: each unit visit enters at the edge of the unit that
    // faces the source, crosses the unit (a slow 'unit' part) and leaves at the edge that
    // faces the destination. Then the times: constant screen speed.
    // opt.bg: the plan of a token in parallel (its units only pass it: no wait, no zoom).
    flowPlan(s, ms, opt = {}) {
      const raw = this.journey(s, true).map(sg => Object.assign({}, sg, sg.pts ? { pts: sg.pts.map(q => q.slice()) } : {})), k = this.flowK(ms);
      // the pins: the pin of the chip nearest to the board trace of the value (before an 'in'
      // bond wire, after an 'out' one)
      const boardEnd = (i, dir) => { for (let j = i + dir; j >= 0 && j < raw.length; j += dir) { const q = raw[j]; if (!q.p && q.pts) return dir < 0 ? q.pts[q.pts.length - 1] : q.pts[0]; if (q.p !== raw[i].p) return null; } return null; };
      raw.forEach((sg, i) => {
        if (!sg.bond) return;
        const E = boardEnd(i, sg.bond === 'in' ? -1 : 1);
        if (!E) return;
        let best = sg.pin, bd = Infinity;
        for (const pin of sg.p.lay.pins) { const w = this.pinToWorld(sg.p, pin), d = Math.hypot(w[0] - E[0], w[1] - E[1]); if (d < bd) { bd = d; best = pin; } }
        sg.pin = best;
        const pw = this.pinToWorld(sg.p, best), pad = this.dieToWorld(sg.p, best.p[0], best.p[1]);
        sg.pts = sg.bond === 'in' ? [pw, pad] : [pad, pw];
        const leg = sg.bond === 'in' ? raw[i + 1] : raw[i - 1];
        if (leg && leg.leg) { if (sg.bond === 'in') leg.leg.from = { pin: best }; else leg.leg.to = { pin: best }; }
      });
      // the legs in a die: the routes through its channels
      for (const sg of raw) if (sg.leg && sg.p) sg.pts = this.dieRoute(sg.p, sg.leg.from, sg.leg.to).map(q => this.dieToWorld(sg.p, q[0], q[1]));
      // the units: in at the port where the leg in ends, out at the port where the leg out starts
      const segs = [];
      for (let i = 0; i < raw.length; i++) {
        const sg = raw[i];
        if (sg.kind !== 'dwell') { segs.push(sg); continue; }
        const c = sg.at, prev = segs[segs.length - 1], next = raw[i + 1];
        const pin = prev && prev.kind === 'move' && prev.p === sg.p ? prev.pts[prev.pts.length - 1] : c;
        const pout = next && next.kind === 'move' && next.p === sg.p ? next.pts[0] : c;
        const pts = [pin, c, pout].map(v => v.slice()).filter((v, j, a) => j === 0 || Math.hypot(v[0] - a[j - 1][0], v[1] - a[j - 1][1]) > 1e-6);
        segs.push({ kind: 'move', unit: true, pts: pts.length > 1 ? pts : [c, c.slice()], p: sg.p, block: sg.block, card: sg.card, label: sg.label });
      }
      // join the parts where they do not touch (on the board: an L)
      for (let i = 1; i < segs.length; i++) {
        const a = segs[i - 1].pts[segs[i - 1].pts.length - 1], b = segs[i].pts[0];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) continue;
        const onBoard = !segs[i].p || !segs[i - 1].p;
        const pts = onBoard && Math.abs(b[0] - a[0]) > 0.02 && Math.abs(b[1] - a[1]) > 0.02 ? [a.slice(), [a[0], b[1]], b.slice()] : [a.slice(), b.slice()];
        segs.splice(i, 0, { kind: 'move', pts, p: onBoard ? null : segs[i].p, label: segs[i].label });
        i++;
      }
      // board traces run in horizontal and vertical lines: a long diagonal leg (where two
      // route pieces meet) becomes an L that keeps the direction of the leg before it
      for (const sg of segs) {
        if (sg.p || sg.unit) continue;
        const out = [sg.pts[0]];
        for (let j = 1; j < sg.pts.length; j++) {
          const a = out[out.length - 1], b = sg.pts[j], dx = b[0] - a[0], dz = b[1] - a[1];
          if (Math.abs(dx) > 0.02 && Math.abs(dz) > 0.02 && Math.hypot(dx, dz) > 0.3) {
            const pa = out.length > 1 ? out[out.length - 2] : null;
            const horiz = pa ? Math.abs(a[0] - pa[0]) > Math.abs(a[1] - pa[1]) : false;
            out.push(horiz ? [b[0], a[1]] : [a[0], b[1]]);
          }
          out.push(b);
        }
        sg.pts = out;
      }
      // lengths and times
      const world = this.world ? this.fitZoom({ x0: this.world.x0, x1: this.world.x1, z0: this.world.z0, z1: this.world.z1 }, 1.02) : 4;
      let T = 0;
      for (const sg of segs) {
        sg.cum = [0];
        for (let j = 1; j < sg.pts.length; j++) sg.cum.push(sg.cum[j - 1] + Math.hypot(sg.pts[j][0] - sg.pts[j - 1][0], sg.pts[j][1] - sg.pts[j - 1][1]));
        sg.len = sg.cum[sg.cum.length - 1];
        // the zoom of its context: the whole die for a part in a chip, else the part itself
        // (a part of a chip visit: the die and the points of the part, for example its pin)
        if (sg.p) { const r = this.dieRect(sg.p), bp = this.boxOf(sg.pts, 0); sg.box = { x0: Math.min(r.x0, bp.x0), x1: Math.max(r.x1, bp.x1), z0: Math.min(r.z0, bp.z0), z1: Math.max(r.z1, bp.z1) }; }
        // (a board leg of a token in parallel: the zoom of the whole board, because the camera
        // does not follow that token on the board)
        sg.zc = sg.p ? this.fitZoom(sg.box, 1.18) : opt.bg ? world : Math.max(world, this.fitZoom(this.boxOf([sg.pts[0], sg.pts[sg.pts.length - 1]], 4), 1.35));
        if (sg.unit && sg.card && sg.card.kind !== 'text' && !opt.bg) {
          const u = this.blockRect(sg.p, sg.block);
          if (u) {
            const cx = (u.x0 + u.x1) / 2, cz = (u.z0 + u.z1) / 2, hw = (u.x1 - u.x0) * FLOW_UNIT_M / 2, hh = (u.z1 - u.z0) * FLOW_UNIT_M / 2;
            sg.box = { x0: cx - hw, x1: cx + hw, z0: cz - hh, z1: cz + hh };
            sg.zc = Math.min(this.fitZoom(sg.box, 1.0), sg.zc * 10);
          }
        }
        const sec = sg.unit ? (sg.card && sg.card.kind !== 'text' && !opt.bg ? FLOW_UNIT_S : FLOW_PASS_S) : Math.max(0.2, sg.len * sg.zc / FLOW_PX_S);
        sg.dt = sec * 1000 * k;
        T += sg.dt;
      }
      // a jump: the step starts far from the end of the last step (a new value)
      const p0 = segs.length ? segs[0].pts[0] : null;
      const jump = !!(p0 && this.flowLast && Math.hypot(p0[0] - this.flowLast[0], p0[1] - this.flowLast[1]) > 1e-3);
      // the camera moves to the start first: for a new value, and also when the start is far
      // from the view now (for example the first step, from the view of the whole board)
      let pan = 0;
      if (p0) {
        const W = this.w || 800, z1 = segs[0].zc, a = [this.view.cx, this.view.cz, W / this.view.z], b = [p0[0], p0[1], W / z1];
        const S = zoomPath(a, b).S;
        if (jump || S > 0.35) pan = clamp(S * 1350, 700, 3800) * Math.sqrt(k);
      }
      T += pan;
      let t = pan;
      for (const sg of segs) { sg.t0 = t / (T || 1); t += sg.dt; sg.t1 = t / (T || 1); }
      return { segs, T: Math.max(200, T), pan, jump: jump || pan > 0 };
    }
    // After the main token: the token of the work in parallel, but only when it is in the die
    // where the main token ended (then the camera does not jump to a far place; the arrow at the
    // edge of the view shows the token while it is away). Keeps it once it is followed.
    bgFollow(t, now, at) {
      const b = t.bg[0], ab = this.trAt(now, { segs: b.segs, t0: t.t0 + t.pan, dur: b.T || b.dur, pan: 0 });
      if (!ab || ab.E >= 1 || !at) return null;
      if (t.bgSince === undefined || now < t.bgSince) t.bgSince = ab.sg.p && ab.sg.p === at.sg.p ? now : Infinity;
      else if (t.bgSince === Infinity && ab.sg.p && ab.sg.p === at.sg.p) t.bgSince = now;
      return now >= t.bgSince ? ab : null;
    }
    // The camera track of a step: the token position and the zoom of its context, sampled at
    // 60 Hz, with a look-ahead (the view zooms out before the token leaves a die), smoothed in
    // both directions, and moved so that the token stays in the free middle of the view.
    flowCamera(t) {
      const dtS = 1000 / 60, n = Math.max(2, Math.ceil(t.dur / dtS) + 1);
      const X = new Float64Array(n), Z = new Float64Array(n), L = new Float64Array(n), FOL = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const now = t.t0 + i * dtS;
        let at = this.trAt(now, t), wide = false;
        // after the main token: the token in parallel when it is in the same die; until then the
        // whole die (so the camera does not wait close on the last unit)
        if (t.bg && t.bg.length && t.mainT && now - t.t0 > t.mainT) { const ab = this.bgFollow(t, now, at); if (ab) { at = ab; FOL[i] = 1; } else wide = !!(at && at.sg.p && t.bg.some(b => this.trAt(now, { segs: b.segs, t0: t.t0 + t.pan, dur: b.T || b.dur, pan: 0 }))); }
        const sg = at ? at.sg : t.segs[0];
        const pos = at ? at.pos : (sg ? sg.pts[0] : [this.view.cx, this.view.cz]);
        const dr = wide ? this.dieRect(sg.p) : null;
        if (dr) { X[i] = (dr.x0 + dr.x1) / 2; Z[i] = (dr.z0 + dr.z1) / 2; }
        else if (sg && sg.p && sg.box) { const r = sg.box; X[i] = (r.x0 + r.x1) / 2; Z[i] = (r.z0 + r.z1) / 2; }   // a still die
        else { X[i] = pos[0]; Z[i] = pos[1]; }
        L[i] = Math.log(dr ? this.fitZoom(dr, 1.18) : sg ? sg.zc : this.view.z);
      }
      const ahead = Math.round(250 / dtS), L2 = new Float64Array(n);
      for (let i = 0; i < n; i++) { let m = L[i]; for (let j = i + 1; j <= Math.min(n - 1, i + ahead); j++) m = Math.min(m, L[j]); L2[i] = m; }
      const smooth = (a, tau) => {
        const al = 1 - Math.exp(-dtS / tau);
        for (let i = 1; i < a.length; i++) a[i] = a[i - 1] + (a[i] - a[i - 1]) * al;
        for (let i = a.length - 2; i >= 0; i--) a[i] = a[i + 1] + (a[i] - a[i + 1]) * al;
      };
      smooth(L2, 260); smooth(X, 180); smooth(Z, 180);
      // the zoom limit, forward and backward (so a zoom out starts early enough)
      for (let i = 1; i < n; i++) L2[i] = clamp(L2[i], L2[i - 1] - CAM_DLZ, L2[i - 1] + CAM_DLZ);
      for (let i = n - 2; i >= 0; i--) L2[i] = clamp(L2[i], L2[i + 1] - CAM_DLZ, L2[i + 1] + CAM_DLZ);
      // the free middle of the view (the parts that the card, the screen and the bar cover)
      const w = this.w || 800, h = this.h || 500, { left, right } = this.cover(true), top = 48, bottom = this.barH();
      const fx = (left + w - right) / 2 - w / 2, fz = (top + h - bottom) / 2 - h / 2;
      const hwx = (w - left - right) * 0.36, hwz = (h - top - bottom) * 0.34;
      const cx = new Float64Array(n), cz = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const now = t.t0 + i * dtS, z = Math.exp(L2[i]);
        let at = this.trAt(now, t);
        if (t.bg && t.bg.length && t.mainT && now - t.t0 > t.mainT) at = this.bgFollow(t, now, at) || at;
        let x = X[i], y = Z[i];
        if (at) {                                      // keep the token in the free middle
          const ex = (at.pos[0] - x) * z, ez = (at.pos[1] - y) * z;
          if (ex > hwx) x += (ex - hwx) / z; else if (ex < -hwx) x += (ex + hwx) / z;
          if (ez > hwz) y += (ez - hwz) / z; else if (ez < -hwz) y += (ez + hwz) / z;
        }
        cx[i] = x - fx / z; cz[i] = y - fz / z;
      }
      // the pan limit (screen px of the zoom of that moment), forward and backward
      const lim = (i, j) => { const z = Math.exp(L2[i]), dx = (cx[i] - cx[j]) * z, dz = (cz[i] - cz[j]) * z, d = Math.hypot(dx, dz); if (d > CAM_DPX) { const f = CAM_DPX / d; cx[i] = cx[j] + (cx[i] - cx[j]) * f; cz[i] = cz[j] + (cz[i] - cz[j]) * f; } };
      for (let i = 1; i < n; i++) lim(i, i - 1);
      for (let i = n - 2; i >= 0; i--) lim(i, i + 1);
      // the start: a zoom path from the view now to the track (a new value), or a short blend
      const v0 = Object.assign({}, this.view), W = this.w || 800;
      if (t.pan) {
        const np = Math.min(n - 1, Math.round(t.pan / dtS)), end = [cx[np], cz[np], W / Math.exp(L2[np])];
        const zp = zoomPath([v0.cx, v0.cz, W / v0.z], end);
        for (let i = 0; i < np; i++) {
          const u = i / np, s = u * u * (3 - 2 * u), q = zp.at(s);
          cx[i] = q[0]; cz[i] = q[1]; L2[i] = Math.log(W / q[2]);
        }
      }
      return { n, dtS, cx, cz, lz: L2, v0, blend: t.pan ? 0 : 350, fol: FOL };
    }
    traceClear() {
      this.tr = null;
      this.tok.style.opacity = 0;
      this.unitWindow(null, 0);
      if (this.card) { this.card.hide(); this.cardShown = null; }
    }
    // Segments for a visit of one chip: a bond wire from a pin to its pad, legs between the
    // pad and the units (the flow plan routes them through the channels of the die), a dwell
    // in each unit, and a bond wire out. The flow plan also picks the pins (the pin nearest to
    // the board trace of the value).
    visit(p, visits, o = {}) {
      if (!p || !visits || !visits.length) return [];
      const segs = [];
      const ctr = visits.map(v => { const i = this.blockIdx(p, v[0]), b = p.lay.blocks[i]; return b ? [b.x + b.w / 2, b.y + b.h / 2] : [p.cw / 2, p.ch / 2]; });
      const W = pt => this.dieToWorld(p, pt[0], pt[1]);
      if (o.in) {
        const pin = this.nearestPin(p, ctr[0][0], ctr[0][1]);
        if (pin) {
          segs.push({ kind: 'move', bond: 'in', pin, pts: [this.pinToWorld(p, pin), W(pin.p)], p, w: 0.1, label: 'In through a pin and its bond wire' });
          segs.push({ kind: 'move', leg: { from: { pin }, to: { unit: visits[0][0] } }, pts: [W(pin.p), W(ctr[0])], p, w: 0.2, label: `To the ${visits[0][0].toLowerCase()}` });
        }
      }
      visits.forEach((v, k) => {
        if (k > 0) segs.push({ kind: 'move', leg: { from: { unit: visits[k - 1][0] }, to: { unit: v[0] } }, pts: [W(ctr[k - 1]), W(ctr[k])], p, w: 0.2, label: `To the ${v[0].toLowerCase()}` });
        segs.push({ kind: 'dwell', at: W(ctr[k]), p, block: v[0], card: v[1] || null, w: v[1] ? 1 : 0.35, label: v[1] && v[1].sub ? v[1].sub : v[0].toLowerCase() });
      });
      if (o.out) {
        const last = ctr[ctr.length - 1], pin = this.nearestPin(p, last[0], last[1]);
        if (pin) {
          segs.push({ kind: 'move', leg: { from: { unit: visits[visits.length - 1][0] }, to: { pin } }, pts: [W(last), W(pin.p)], p, w: 0.2, label: 'To a pad at the edge of the die' });
          segs.push({ kind: 'move', bond: 'out', pin, pts: [W(pin.p), this.pinToWorld(p, pin)], p, w: 0.1, label: 'Out through the bond wire and a pin' });
        }
      }
      return segs;
    }
    // ---------- routes inside a die ----------
    // A leg in a die: the shared router of the board code (BoardKit.layRoute: through the
    // channels between the units; the ports on the edges of the units). An end is
    // { unit: label } or { pin } (its bond pad) or { pt }.
    dieRoute(p, from, to) {
      const end = e => (e.unit ? { blocks: this.blocksOf(p, e.unit).map(b => p.lay.blocks.indexOf(b)) } : { pt: (e.pin ? e.pin.p : e.pt).slice() });
      return BoardKit.layRoute(p.lay, end(from), end(to));
    }

    boardSeg(pts, label) { return pts && pts.length > 1 ? [{ kind: 'move', pts, p: null, w: 0.35, label }] : []; }
    journey(s, raw) {
      const K = BoardKit, m = this.app.machine, segs = [];
      const add = l => { for (const x of l) if (x) segs.push(x); };
      const who = ((s.I && s.I.fpu) || s.unit === 'fpu') && !K.FPU_ON ? 'fpu' : 'cpu', ce = this.byKey.get(who);
      if (s.kind === 'inside') add(this.visit(ce, K.CPU_TRACE.inside({ s, m })));
      else if (s.kind === 'page') add(this.visit(ce, K.PAGE_CARD(s)));
      else if (s.kind === 'cache') add(this.visit(ce, K.CACHE_CARD(s)));
      else if (s.kind === 'btb') add(this.visit(ce, K.P5_CARDS(s.e || {})));
      else if (s.kind === 'sound') add(this.visit(this.byKey.get(s.e && s.e.k === 'opl' ? 'opl' : 'sbdsp'), K.SOUND_CARD(s), { in: true }));
      else if (s.kind === 'fdc' || s.kind === 'dma') {
        const P = this.fdcPaths(), e = s.e || {}, rib = (P.ribbon || [])[e.drive || 0];
        const chip = s.kind === 'dma' ? this.byKey.get('dma') : P.fdc;
        if (s.kind === 'fdc' && rib && e.op === 'read') add(this.boardSeg(rib, `From drive ${e.drive ? 'B:' : 'A:'} over the ribbon cable`));
        add(this.visit(chip, K.FDC_CARD(s), { in: true }));
        if (s.kind === 'fdc' && rib && (e.op === 'seek' || e.op === 'step' || e.op === 'write')) add(this.boardSeg(rib.slice().reverse(), `To drive ${e.drive ? 'B:' : 'A:'} over the ribbon cable`));
        if (s.kind === 'fdc' && e.op === 'irq' && P.toPic) add(this.boardSeg(P.toPic, 'IRQ 6 to the 8259A'));
        if (s.kind === 'dma' && P.memory) add(this.boardSeg(e.read ? P.memory.slice().reverse() : P.memory, e.read ? 'From the memory' : 'Into the memory'));
      }
      else if (s.kind === 'irq') {
        const pe = this.byKey.get(K.M286 && s.e && s.e.vec >= 0x70 ? 'pic2' : 'pic');
        add(this.visit(pe, K.PIC_IRQ_TRACE, { out: true }));
        add(this.boardSeg(this.routes.get('INTR') ? this.routes.get('INTR').path : [], `INTR goes to the ${K.NM.cpu}`));
        add(this.visit(ce, [['INTERRUPTS TIMING', null]], { in: true }));
      } else if (s.kind === 'bus') {
        const I = s.I, ev = s.e, ctxC = { I, s, ev, m };
        const tg = I.kind === 'halt' ? null : this.target(I), P = this.busPaths(I, tg);
        const tm = tg ? tg.model : null, tc = tg ? Object.assign(tg.ctx, { s, ev }) : null;
        const dv = (list, o) => (tg && list && list.length ? this.visit(tg.p, list, o) : []);
        const be = this.byKey.get('bus'), bm = be ? K.traceModel(be.part) : null, bctx = { I, s, ev, m, part: be ? be.part : K.NM.bus };
        const name = Story.devName(I);
        if (s.phase === 'addr') {
          add(this.visit(ce, K.CPU_TRACE.out(ctxC), { out: true }));
          add(this.boardSeg(P.addr, `On the address bus to the ${name}`));
          if (tm && tm.addr) add(dv(tm.addr(tc), { in: true }));
        } else if (s.phase === 'cmd') {
          if (I.kind === 'halt') add(this.visit(be, bm ? bm.visit(bctx).slice(0, 1) : [], { in: true }));
          else {
            add(this.visit(ce, K.CPU_TRACE.status(ctxC), { out: true }));
            const s02 = this.routes.get('S02');
            add(this.boardSeg(s02 ? s02.path : [], `The status lines go to the ${K.NM.bus}`));
            add(this.visit(be, bm ? bm.visit(bctx) : [], { in: true, out: true }));
            add(this.boardSeg(P.cmd.slice(s02 ? s02.path.length : 0), `${s.token.tag} goes to the ${name}`));
            if (tm && tm.cmd) add(dv(tm.cmd(tc), { in: true }));
          }
        } else if (s.phase === 'data') {
          if (I.read) {
            if (tm && tm.read) add(dv(tm.read(tc), { out: true }));
            add(this.boardSeg(P.data, `On the data bus to the ${I.fpu ? K.NM.fpu : K.NM.cpu}`));
            add(this.visit(ce, K.CPU_TRACE.in(ctxC), { in: true }));
          } else {
            add(this.visit(ce, K.CPU_TRACE.write(ctxC), { out: true }));
            add(this.boardSeg(P.data, `On the data bus to the ${name}`));
            if (tm && tm.write) add(dv(tm.write(tc), { in: true }));
          }
        } else {
          add(this.visit(ce, K.CPU_TRACE.out(Object.assign({ short: true }, ctxC)), { out: true }));
          add(this.boardSeg(P.addr, `On the address bus to the ${name}`));
          if (tm && tm.read) { const a = tm.addr ? tm.addr(tc) : [], r = tm.read(tc); add(dv(a.slice(0, 1).concat(r.slice(-1)), { in: true, out: true })); }
          add(this.boardSeg(P.data, 'The code bytes go back on the data bus'));
          add(this.visit(ce, K.CPU_TRACE.in(ctxC), { in: true }));
        }
      }
      if (raw) return segs;
      // join the segments where they do not touch
      const out = [];
      let last = null;
      for (const sg of segs) {
        const p0 = sg.kind === 'dwell' ? sg.at : sg.pts[0];
        if (last && Math.hypot(p0[0] - last[0], p0[1] - last[1]) > 0.004) out.push({ kind: 'move', pts: [last, p0], p: sg.p, w: 0.05, label: sg.label });
        out.push(sg);
        last = sg.kind === 'dwell' ? sg.at : sg.pts[sg.pts.length - 1];
      }
      for (const sg of out) if (sg.kind === 'move') { sg.cum = [0]; for (let i = 1; i < sg.pts.length; i++) sg.cum.push(sg.cum[i - 1] + Math.hypot(sg.pts[i][0] - sg.pts[i - 1][0], sg.pts[i][1] - sg.pts[i - 1][1])); sg.len = sg.cum[sg.cum.length - 1]; }
      return out;
    }
    // Where the trace token is now (without an argument: at the animation time now).
    trAt(now = animNow(), tt) {
      const t = tt || this.tr;
      if (!t || !t.segs.length) return null;
      const span = t.mainT || t.dur;
      const E = this.reduced ? 1 : clamp((now - t.t0) / span, 0, 1);
      if (t.pan && E * span < t.pan) return null;          // the camera moves to a new value
      let i = 0;
      while (i < t.segs.length - 1 && t.segs[i].t1 <= E) i++;
      const sg = t.segs[i], local = clamp((E - sg.t0) / Math.max(1e-6, sg.t1 - sg.t0), 0, 1);
      if (sg.kind === 'dwell') return { pos: sg.at, sg, i, local, E };
      let d = local * sg.len;                               // a constant speed
      if (sg.unit && sg.pts.length === 3) {                 // in, wait at the working part, out
        const dc = sg.cum[1];
        d = local < FLOW_IN ? dc * (local / FLOW_IN) : local > 1 - FLOW_IN ? dc + (sg.len - dc) * ((local - 1 + FLOW_IN) / FLOW_IN) : dc;
      }
      let j = 0;
      while (j < sg.pts.length - 2 && sg.cum[j + 1] < d) j++;
      const a = sg.pts[j], b = sg.pts[Math.min(j + 1, sg.pts.length - 1)], f = clamp((d - sg.cum[j]) / ((sg.cum[j + 1] - sg.cum[j]) || 1), 0, 1);
      return { pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], sg, i, local, E };
    }

    // ---------- camera ----------
    fitBox(b, instant, margin = 1.08) {
      const w = this.w || 800, h = this.h || 500;
      const top = 48, bottom = this.barH(), { left, right } = this.cover();
      const fw = Math.max(w * 0.4, w - left - right);
      const z = Math.min(fw / ((b.x1 - b.x0) * margin), (h - top - bottom) / ((b.z1 - b.z0) * margin));
      const goal = { cx: (b.x0 + b.x1) / 2 - ((left - right) / 2) / z, cz: (b.z0 + b.z1) / 2 - ((top - bottom) / 2) / z, z: clamp(z, 2, 4000) };
      if (instant || this.reduced) { this.view = Object.assign({}, goal); this.goal = null; this.dirty = true; } else this.goal = goal;
    }
    // The parts of the view that other things cover: the block card at the left, and the
    // floating screen at the right when it is tall.
    cover(trace) {
      const open = this.card && !this.card.min;       // (a minimized card is one short line: no space for it)
      const left = !open ? 0 : (trace || this.tr) ? (this.card.el.offsetWidth || 300) + 24 : this.cardShown ? this.card.el.offsetWidth + 24 : 0;
      let right = 0;
      const mon = document.getElementById('monitor'), hr = this.host.getBoundingClientRect();
      if (mon && !mon.hidden && mon.offsetParent && hr.width) {
        const r = mon.getBoundingClientRect();
        if (r.left > hr.left + hr.width * 0.45 && r.bottom - hr.top > hr.height * 0.3 && r.top < hr.bottom) right = Math.max(0, hr.right - r.left + 12);
      }
      return { left, right: Math.min(right, hr.width * 0.5) };
    }
    fitAll(instant) { this.fitBox({ x0: this.world.x0, x1: this.world.x1, z0: this.world.z0, z1: this.world.z1 }, instant, 1.02); }
    // The bottom buttons (and the trace bar, if it covers the view) cover the bottom of the view.
    barH() {
      const bar = document.getElementById('trace');
      if (bar && !bar.hidden && bar.offsetParent) {
        const a = bar.getBoundingClientRect(), b = this.host.getBoundingClientRect();
        if (a.top < b.bottom && a.bottom > b.top) return Math.max(44, b.bottom - a.top + 16);
      }
      return 44;
    }
    fitChip(p, instant) { this.fitBox(this.dieRect(p), instant, 1.04); }
    toScreen(x, z) { const v = this.view; return [(x - v.cx) * v.z + this.w / 2, (z - v.cz) * v.z + this.h / 2]; }
    toWorld(sx, sy) { const v = this.view; return [(sx - this.w / 2) / v.z + v.cx, (sy - this.h / 2) / v.z + v.cz]; }
    stepCamera(dt, now) {
      const t = this.tr;
      if (t && t.cam && this.follow && !this.dragging && !this.reduced) {
        const c = t.cam, e = now - t.t0, i = clamp(e / c.dtS, 0, c.n - 1), a = Math.floor(i), f = i - a, b = Math.min(c.n - 1, a + 1);
        let cx = c.cx[a] + (c.cx[b] - c.cx[a]) * f, cz = c.cz[a] + (c.cz[b] - c.cz[a]) * f, lz = c.lz[a] + (c.lz[b] - c.lz[a]) * f;
        if (e < c.blend) {                                // from the view at the start of the step
          const u = clamp(e / c.blend, 0, 1), s = u * u * (3 - 2 * u), l0 = Math.log(c.v0.z);
          lz = l0 + (lz - l0) * s;
          cx = c.v0.cx + (cx - c.v0.cx) * s; cz = c.v0.cz + (cz - c.v0.cz) * s;
        }
        this.view.cx = cx; this.view.cz = cz; this.view.z = Math.exp(lz); this.goal = null;
        return true;
      }
      if (this.follow && !this.dragging) this.followGoal(now);
      const g = this.goal;
      if (!g) return false;
      const k = 1 - Math.exp(-dt / 220), v = this.view;
      v.cx += (g.cx - v.cx) * k; v.cz += (g.cz - v.cz) * k;
      v.z = Math.exp(Math.log(v.z) + (Math.log(g.z) - Math.log(v.z)) * k);
      if (Math.abs(g.cx - v.cx) * v.z < 0.3 && Math.abs(g.cz - v.cz) * v.z < 0.3 && Math.abs(Math.log(g.z / v.z)) < 0.002) { Object.assign(v, g); this.goal = null; }
      return true;
    }
    // Follow: the view goes to the chip where the trace token is, or to the busy chips.
    followGoal(now) {
      let box = null;
      if (this.tr) {
        const at = this.trAt(now);
        if (!at) return;
        if (at.sg.p) box = this.dieRect(at.sg.p);
        else { box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }; for (const q of at.sg.pts) { box.x0 = Math.min(box.x0, q[0]); box.x1 = Math.max(box.x1, q[0]); box.z0 = Math.min(box.z0, q[1]); box.z1 = Math.max(box.z1, q[1]); } }
      } else {
        // the CPU and the chips that the recent bus cycles went to
        const keys = new Set((this.recent || []).filter(x => now - x.t < 1800 && x.t < now + 50).map(x => x.key));
        const busy = [...keys].map(k => this.byKey.get(k)).filter(Boolean);
        if (!busy.length) return;
        if (this.byKey.get('cpu')) busy.push(this.byKey.get('cpu'));
        box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
        for (const p of busy) { const r = this.dieRect(p); box.x0 = Math.min(box.x0, r.x0); box.x1 = Math.max(box.x1, r.x1); box.z0 = Math.min(box.z0, r.z0); box.z1 = Math.max(box.z1, r.z1); }
      }
      if (!box || !isFinite(box.x0)) return;
      const key = [box.x0, box.x1, box.z0, box.z1].map(v => Math.round(v * 4)).join();
      if (key === this.followKey) return;
      this.followKey = key;
      this.fitBox(box, false, 1.12);
    }

    // ---------- input ----------
    bindInput() {
      const el = this.wrap;
      this.ptrs = new Map();
      el.addEventListener('dragstart', e => e.preventDefault());
      el.addEventListener('pointerdown', e => {
      // A left-button drag can start a native drag of selected text; then the browser cancels the
      // pointer events and the drag stops (a right-button drag has no native drag). So the view
      // stops the native selection and drag here.
        if (e.button === 0) { e.preventDefault(); const sel = window.getSelection && window.getSelection(); if (sel && sel.rangeCount) sel.removeAllRanges(); }
        el.focus({ preventScroll: true });
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.down = { x: e.clientX, y: e.clientY, moved: false };
        if (this.ptrs.size === 2) this.pinch = this.pinchState();
        el.classList.add('tp-drag');
      });
      el.addEventListener('pointermove', e => {
        const p = this.ptrs.get(e.pointerId);
        if (!p) { this.hoverAt = { x: e.clientX, y: e.clientY }; return; }
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (!this.down.moved && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4) this.down.moved = true;
        if (!this.down.moved) return;
        this.userMove();
        if (this.ptrs.size >= 2) {
          const s = this.pinchState(), o = this.pinch;
          if (o && s.d > 0) { this.zoomAt(s.mx, s.my, s.d / o.d); this.view.cx -= (s.mx - o.mx) / this.view.z; this.view.cz -= (s.my - o.my) / this.view.z; }
          this.pinch = s;
        } else { this.view.cx -= dx / this.view.z; this.view.cz -= dy / this.view.z; }
        this.dirty = true;
      });
      const up = e => {
        this.ptrs.delete(e.pointerId);
        if (this.ptrs.size < 2) this.pinch = null;
        if (!this.ptrs.size) { el.classList.remove('tp-drag'); this.dragging = false; }
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', () => { this.hoverAt = null; this.tip.classList.remove('tp-on'); });
      el.addEventListener('wheel', e => {
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        this.userMove();
        const r = this.root.getBoundingClientRect();
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-clamp(dy, -200, 200) * 0.0015));
      }, { passive: false });
      el.addEventListener('dblclick', e => {
        const r = this.root.getBoundingClientRect(), [x, z] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        const p = this.pick(x, z);
        if (!p) return;
        this.follow = false; this.syncFollow(); this.userMoved = true;
        this.fitChip(p);
      });
      el.addEventListener('keydown', e => {
        const v = this.view;
        let used = true;
        if (e.key === '+' || e.key === '=') this.zoomAt(this.w / 2, this.h / 2, 1.25);
        else if (e.key === '-' || e.key === '_') this.zoomAt(this.w / 2, this.h / 2, 0.8);
        else if (e.key === 'ArrowLeft') v.cx -= 40 / v.z;
        else if (e.key === 'ArrowRight') v.cx += 40 / v.z;
        else if (e.key === 'ArrowUp') v.cz -= 40 / v.z;
        else if (e.key === 'ArrowDown') v.cz += 40 / v.z;
        else if (e.key === '0') this.fitAll();
        else used = false;
        if (used) { e.preventDefault(); this.userMove(); this.dirty = true; }
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && this.visible && !document.querySelector('dialog[open]')) { this.follow = false; this.syncFollow(); this.fitAll(); }
      });
    }
    pinchState() {
      const [a, b] = [...this.ptrs.values()], r = this.root.getBoundingClientRect();
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
    }
    // The user moves the view: Follow turns off (the view stays where the user puts it).
    userMove() {
      this.goal = null; this.userMoved = true; this.dragging = true;
      if (this.follow) { this.follow = false; this.syncFollow(); }
      this.tip.classList.remove('tp-on');
    }
    zoomAt(sx, sy, k) {
      const [wx, wz] = this.toWorld(sx, sy), v = this.view;
      v.z = clamp(v.z * k, 2, 4000);
      v.cx = wx - (sx - this.w / 2) / v.z; v.cz = wz - (sy - this.h / 2) / v.z;
      this.dirty = true;
    }
    pick(x, z) {
      for (const p of this.parts) { const r = this.pkgRect(p); if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return p; }
      return null;
    }

    // ---------- drawing ----------
    frame(now, dt) {
      if (!this.ok || !this.visible) return;
      if (!this.w) this.resize();
      if (!this.w) return;
      const moved = this.stepCamera(clamp(dt || 16, 1, 100), now);
      const vk = [this.view.cx, this.view.cz, this.view.z, this.w, this.h].map(v => v.toFixed(4)).join();
      if (vk !== this.viewKey || this.dirty) { this.viewKey = vk; this.drawBase(); this.dirty = false; this.viewT = performance.now(); this.detailT = 0; }
      else if (this.needDetail && performance.now() - this.viewT > 90) {
        // the sharp picture fades in over 220 ms
        if (!this.detailT) this.detailT = performance.now();
        const a = clamp((performance.now() - this.detailT) / 220, 0, 1);
        this.drawBase(a);
        if (a >= 1) { this.needDetail = false; this.detailT = 0; }
      }
      this.drawFx(now);
      this.hover();
      void moved;
    }
    // The still layer: board, cards, traces with labels, chips with their open dies.
    drawBase(detail) {
      const K = BoardKit, g = this.base.getContext('2d'), dpr = this.dpr, v = this.view;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.base.width, this.base.height);
      g.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * (this.w / 2 - v.cx * v.z), dpr * (this.h / 2 - v.cz * v.z));
      const px = 1 / v.z;   // one screen px in world units
      // board
      const bw = K.BW, bd = K.BD;
      g.fillStyle = K.PAL.mask1; this.rrect(g, -bw / 2, -bd / 2, bw, bd, 0.4); g.fill();
      const gr = g.createRadialGradient(-bw * 0.05, -bd * 0.05, 1, 0, 0, bw * 0.7);
      gr.addColorStop(0, K.PAL.mask0); gr.addColorStop(1, K.PAL.mask1);
      g.fillStyle = gr; this.rrect(g, -bw / 2, -bd / 2, bw, bd, 0.4); g.fill();
      // cards and the ISA rail
      for (const c of this.cards) {
        g.fillStyle = K.PAL.cardTop; this.rrect(g, c.x - c.len / 2, c.z - c.h / 2, c.len, c.h, 0.2); g.fill();
        g.strokeStyle = K.PAL.edge; g.lineWidth = 2 * px; g.stroke();
        g.fillStyle = K.PAL.finger;
        for (let x = c.x - c.len / 2 + 0.8; x < c.x + c.len / 2 - 0.6; x += 0.3) g.fillRect(x - 0.09, c.finger - 0.45, 0.18, 0.42);
        this.text(g, c.title, c.x - c.len / 2 + 0.35, c.z - c.h / 2 + 0.45, 0.32, THEME.text, 'left', 0.8);
        if (c.video) {
          const k = this.connector(c);
          g.fillStyle = '#9aa4b0'; this.rrect(g, k.x - 0.35, k.z - 0.75, 0.7, 1.5, 0.12); g.fill();
          g.fillStyle = '#1b1f26'; this.rrect(g, k.x - 0.22, k.z - 0.6, 0.44, 1.2, 0.1); g.fill();
          this.text(g, K.VGA ? 'DB-15' : 'DE-9', k.x, k.z + 1.0, 0.2, THEME.muted, 'center', 0.9);
          this.text(g, 'to the monitor', k.x, k.z + 1.28, 0.16, THEME.muted, 'center', 0.8);
        }
      }
      const rl = this.rail;
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(rl.x0, rl.z - 0.22, rl.x1 - rl.x0, 0.44);
      g.strokeStyle = K.PAL.copper; g.lineWidth = 0.12; g.beginPath(); g.moveTo(rl.x0, rl.z); g.lineTo(rl.x1, rl.z); g.stroke();
      for (const c of this.cards) { g.beginPath(); g.moveTo(c.x - c.len / 2 + 1, rl.z); g.lineTo(c.x - c.len / 2 + 1, c.finger - 0.45); g.stroke(); }
      const slot = this.chainPts('A_slot');
      if (slot.length) { const e = slot[slot.length - 1]; g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(e[0], rl.z); g.stroke(); }
      if (v.z > 10) this.text(g, 'ISA SLOT BUS (address, data, commands)', rl.x0 + 0.3, rl.z - 0.35, 0.26, THEME.muted, 'left', 0.8);
      // traces
      for (const r of this.routes.values()) this.drawRoute(g, r, px);
      // chips
      for (const p of this.parts) this.drawChip(g, p, px, detail);
      this.drawDrivesBase(g, px);
      // bus labels over everything else
      if (v.z > 14) for (const r of this.routes.values()) this.routeLabel(g, r, px);
    }
    rrect(g, x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    text(g, s, x, y, size, color, align, alpha = 1) {
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = color; g.textAlign = align || 'center'; g.textBaseline = 'middle';
      g.font = `600 ${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
      g.fillText(s, x, y);
      g.restore();
    }
    drawRoute(g, r, px) {
      const cols = COL(), col = cols[r.kind] || THEME.magenta;
      const width = Math.max(r.n > 1 ? (r.n - 1) * r.sp + 0.05 : 0.07, 2 * px);
      g.save();
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.globalAlpha = 0.28; g.strokeStyle = col; g.lineWidth = width;
      this.poly(g, r.path); g.stroke();
      // the single lines, when there is room for them
      if (r.n > 1 && r.sp / px > 3) {
        g.globalAlpha = 0.5; g.lineWidth = Math.max(0.012, px);
        for (let li = 0; li < r.n; li++) { this.poly(g, offsetPath(r.path, (li - (r.n - 1) / 2) * r.sp)); g.stroke(); }
      } else { g.globalAlpha = 0.55; g.lineWidth = Math.max(0.03, 1.2 * px); this.poly(g, r.path); g.stroke(); }
      g.restore();
    }
    routeLabel(g, r, px) {
      // the label sits on the middle of the longest straight part
      let best = 0, bi = 0;
      for (let i = 1; i < r.path.length; i++) { const d = Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]); if (d > best) { best = d; bi = i; } }
      if (best * this.view.z < 120) return;
      const a = r.path[bi - 1], b = r.path[bi], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const size = clamp(11 * px, 0.08, 0.5);
      g.save();
      g.font = `600 ${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
      const tw = g.measureText(r.name).width + size;
      g.translate(mx, mz);
      if (Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0])) g.rotate(-Math.PI / 2);
      g.fillStyle = 'rgba(8,10,18,0.78)'; this.rrect(g, -tw / 2, -size * 0.75, tw, size * 1.5, size * 0.4); g.fill();
      g.fillStyle = COL()[r.kind] || THEME.text; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(r.name, 0, 0);
      g.restore();
    }
    poly(g, pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); }
    // One chip: package, pins, and the open die (from a cached picture at the right scale;
    // at a close zoom, a sharp picture of the part in view).
    drawChip(g, p, px, detail) {
      const K = BoardKit, r = this.pkgRect(p), v = this.view;
      if (r.x1 < v.cx - this.w / 2 / v.z - 1 || r.x0 > v.cx + this.w / 2 / v.z + 1 || r.z1 < v.cz - this.h / 2 / v.z - 1 || r.z0 > v.cz + this.h / 2 / v.z + 1) return;
      const ceramic = p.spec.kind === 'ceramic' || p.spec.kind === 'plcc';
      // pins
      g.fillStyle = ceramic ? '#d9b35c' : K.PAL.pinTin;
      const pinW = K.PITCH * 0.45, pinL = 0.16;
      if (p.d.quad) {
        const n = p.spec.pins / 4, lp = p.d.lp;
        for (let i = 0; i < n; i++) {
          const o = (i - (n - 1) / 2) * lp;
          g.fillRect(p.x + o - lp * 0.25, r.z0 - pinL, lp * 0.5, pinL); g.fillRect(p.x + o - lp * 0.25, r.z1, lp * 0.5, pinL);
          g.fillRect(r.x0 - pinL, p.z + o - lp * 0.25, pinL, lp * 0.5); g.fillRect(r.x1, p.z + o - lp * 0.25, pinL, lp * 0.5);
        }
      } else {
        const half = p.spec.pins / 2;
        for (let i = 0; i < half; i++) {
          const o = (i - (half - 1) / 2) * K.PITCH;
          if (p.rot) { g.fillRect(r.x0 - pinL, p.z + o - pinW / 2, pinL, pinW); g.fillRect(r.x1, p.z + o - pinW / 2, pinL, pinW); }
          else { g.fillRect(p.x + o - pinW / 2, r.z0 - pinL, pinW, pinL); g.fillRect(p.x + o - pinW / 2, r.z1, pinW, pinL); }
        }
      }
      // body
      g.fillStyle = ceramic ? THEME.ceramic : p.spec.kind === 'eprom' ? K.PAL.eprom : K.PAL.plastic;
      this.rrect(g, r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0, 0.06); g.fill();
      const f = this.frameOf(p);
      const need = v.z * f.s;     // screen px per base px (CSS px)
      const S = need * this.dpr;
      g.save();
      this.dieFrame(g, p);
      // small on the screen: a clean die, its units as coloured rectangles (no bond wires);
      // larger: the open die, a cached picture near the screen scale. Between 110 and 190 px
      // the two cross-fade (no pop when the camera zooms).
      const dpx = p.lay.dw * need, mix = clamp((dpx - 110) / 80, 0, 1);
      if (mix < 1) this.simpleDie(g, p, need);
      if (mix > 0) {
        const img = this.dieImage(p, S);
        if (img) {
          g.save(); g.globalAlpha *= mix;
          g.beginPath(); g.rect(f.x0, f.y0, f.w, f.h); g.clip();
          g.drawImage(img, 0, 0, p.cw, p.ch);
          g.restore();
        }
      }
      // a close zoom: the sharp picture of the die (made once; also while the camera moves)
      const hi = mix > 0 && S > 1.05 ? this.dieHi(p) : null;
      if (hi) g.drawImage(hi.c, f.x0, f.y0, f.w, f.h);
      g.restore();
      // closer than that picture: the part in view is drawn again at screen resolution when the
      // view rests; it fades in (detail = its alpha)
      if (S > (hi ? hi.k : 1) * 1.05) { if (detail) { g.save(); g.globalAlpha *= typeof detail === 'number' ? detail : 1; this.detailChip(g, p); g.restore(); } else this.needDetail = true; }
      // name
      if (v.z > 9 && v.z < 420) {
        const lab = p.ref ? `${p.ref} ${p.name}` : p.name;
        this.text(g, lab, p.x, (p.rot ? r.z1 : r.z1) + 0.28, 0.2, THEME.muted, 'center', 0.85);
      }
    }
    // The die with its pads at up to 1800 px wide (k = screen px per base px), made once.
    dieHi(p) {
      if (p.hi !== undefined) return p.hi;
      const f = this.frameOf(p), k = clamp(1800 / f.w, 1, 8), w = Math.round(f.w * k), h = Math.round(f.h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.setTransform(k, 0, 0, k, -f.x0 * k, -f.y0 * k);
      try { BoardKit.drawInterior(g, p.cw, p.ch, p.d, p.part, k, [f.x0, f.y0, f.x0 + f.w, f.y0 + f.h], p.rot); } catch (e) { p.hi = null; return null; }   // (p.rot: no upside-down labels)
      return (p.hi = { c, k });
    }
    // In the die frame (base px).
    simpleDie(g, p, need) {
      const L = p.lay, f = this.frameOf(p), pad = L.pm * 0.9;
      g.fillStyle = '#1a2230';
      g.fillRect(f.x0, f.y0, f.w, f.h);
      g.fillStyle = '#d8b25a';
      g.globalAlpha = 0.8;
      for (const pin of L.pins) g.fillRect(pin.p[0] - pad * 0.25, pin.p[1] - pad * 0.25, pad * 0.5, pad * 0.5);
      g.globalAlpha = 1;
      for (const b of L.blocks) {
        g.fillStyle = DIE_TINT[b.kind] || '#445';
        g.fillRect(b.x, b.y, b.w, b.h);
        if (b.w * need > 34 && b.h * need > 10) {
          const size = Math.min(b.h * 0.32, b.w / Math.max(4, b.label.length) * 1.7);
          if (size * need >= 7) this.text(g, b.label, b.x + b.w / 2, b.y + b.h / 2, size, '#e8e2f0', 'center', 0.9);
        }
      }
    }
    dieImage(p, S) {
      // pictures at 1/2, 1/4, 1/8 ... of the base size (at most 2048 px wide)
      let k = 1;
      while (k > 1 / 64 && k / 2 >= S) k /= 2;
      const key = p.part + '|' + p.spec.pins + '|' + p.cw + '|' + k + '|' + (p.rot ? 1 : 0);
      let c = this.chipCache.get(key);
      if (c) { this.chipCache.delete(key); this.chipCache.set(key, c); return c; }
      const w = Math.max(8, Math.round(p.cw * k)), h = Math.max(4, Math.round(p.ch * k));
      c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.setTransform(w / p.cw, 0, 0, h / p.ch, 0, 0);
      try { BoardKit.drawInterior(g, p.cw, p.ch, p.d, p.part, Math.max(k, 0.05), null, p.rot); } catch (e) { /* keep an empty picture */ }
      this.chipCache.set(key, c);
      while (this.chipCache.size > 60) this.chipCache.delete(this.chipCache.keys().next().value);
      return c;
    }
    // The sharp picture of the part of a die in view (like the 3D detail tile).
    detailChip(g, p) {
      const v = this.view, f = this.frameOf(p);
      // the visible world rectangle, in base px of the die picture (inside the crop)
      const [wx0, wz0] = this.toWorld(0, 0), [wx1, wz1] = this.toWorld(this.w, this.h);
      const toBase = (wx, wz) => (p.rot ? [-(wz - p.z) / f.s + f.cx, (wx - p.x) / f.s + f.cy] : [(wx - p.x) / f.s + f.cx, (wz - p.z) / f.s + f.cy]);
      const a = toBase(wx0, wz0), b = toBase(wx1, wz1);
      let x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      x0 = clamp(x0, f.x0, f.x0 + f.w); x1 = clamp(x1, f.x0, f.x0 + f.w); y0 = clamp(y0, f.y0, f.y0 + f.h); y1 = clamp(y1, f.y0, f.y0 + f.h);
      if (x1 - x0 < 2 || y1 - y0 < 2) return;
      const S = v.z * f.s * this.dpr;
      const tw = Math.min(2600, Math.round((x1 - x0) * S)), th = Math.min(2600, Math.round((y1 - y0) * S));
      const key = [p.key, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), tw, th].join('|');
      if (!this.details) this.details = new Map();
      let c = this.details.get(p.key);
      c = c && c.key === key ? c.c : null;
      if (!c) {
        c = document.createElement('canvas'); c.width = Math.max(2, tw); c.height = Math.max(2, th);
        const cg = c.getContext('2d');
        cg.setTransform(c.width / (x1 - x0), 0, 0, c.height / (y1 - y0), -x0 * c.width / (x1 - x0), -y0 * c.height / (y1 - y0));
        try { BoardKit.drawInterior(cg, p.cw, p.ch, p.d, p.part, c.width / (x1 - x0), [x0, y0, x1, y1], p.rot); } catch (e) { return; }
        this.details.set(p.key, { key, c });
        while (this.details.size > 8) this.details.delete(this.details.keys().next().value);
      }
      g.save();
      this.dieFrame(g, p);
      g.drawImage(c, x0, y0, x1 - x0, y1 - y0);
      g.restore();
    }
    // The live layer: clock, busy chips, signals with values, unit work, trace token.
    drawFx(now) {
      const g = this.fx.getContext('2d'), dpr = this.dpr, v = this.view, col = COL();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.fx.width, this.fx.height);
      g.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * (this.w / 2 - v.cx * v.z), dpr * (this.h / 2 - v.cz * v.z));
      const px = 1 / v.z;
      // the clock: a flash on each clock of the instruction (a soft shimmer in fast mode)
      let fl = 0;
      const running = this.app.running;
      if (this.clk && this.clk.ms > 0) {
        const k = Math.floor((now - this.clk.t0) / this.clk.ms);
        if (k >= 0 && k <= this.clk.n) fl = Math.exp(-((now - this.clk.t0) - k * this.clk.ms) / (0.3 * this.clk.ms));
        if (k !== this.clk.last && k >= 0 && k <= this.clk.n) { this.clk.last = k; if (typeof Sfx !== 'undefined' && this.clk.ms / (this.app.motion || 1) >= 120) Sfx.edge(k % 4 === 0); }
      }
      if (this.tr) { const t = (now - this.tr.t0) / this.tr.dur; fl = Math.max(fl, Math.exp(-Math.max(0, t) * 6)); }
      if (this.app.mode === 'fast' && running) fl = 0.35 + 0.25 * Math.sin(now * 0.05);
      if (fl > 0.01) {
        g.save(); g.globalAlpha = fl; g.strokeStyle = col.clk; g.lineWidth = Math.max(0.1, 3 * px); g.shadowColor = col.clk; g.shadowBlur = 14 * dpr * fl;
        for (const [id, r] of this.routes) if (id.startsWith('CLK')) { this.poly(g, r.path); g.stroke(); }
        const cp = this.byKey.get('clk');
        if (cp) { const rr = this.pkgRect(cp); g.strokeRect(rr.x0 - 0.08, rr.z0 - 0.08, rr.x1 - rr.x0 + 0.16, rr.z1 - rr.z0 + 0.16); this.text(g, 'CLK', cp.x, rr.z0 - 0.4, 0.34, col.clk, 'center', fl); }
        g.restore();
      }
      // busy chips: a glow around the package
      for (const [key, a] of this.act) {
        if (now > a.t1 + 700) { this.act.delete(key); continue; }
        if (now < a.t0) continue;
        const p = this.byKey.get(key);
        if (!p) continue;
        const f = now <= a.t1 ? 1 : 1 - (now - a.t1) / 700;
        const r = this.pkgRect(p);
        g.save(); g.globalAlpha = 0.85 * f; g.strokeStyle = col[a.kind] || col.data; g.lineWidth = Math.max(0.04, 2 * px);
        g.shadowColor = g.strokeStyle; g.shadowBlur = 10 * dpr;
        g.strokeRect(r.x0 - 0.06, r.z0 - 0.06, r.x1 - r.x0 + 0.12, r.z1 - r.z0 + 0.12);
        g.restore();
      }
      // signals: the lit path behind the front, the value on the front
      for (let i = this.sigs.length - 1; i >= 0; i--) {
        const s = this.sigs[i], u = (now - s.t0) / s.dur;
        if (u > 2.4) { this.sigs.splice(i, 1); continue; }
        if (u < 0) continue;
        const f = this.reduced ? 1 : ease(Math.min(1, u)), a = u <= 1 ? 1 : Math.max(0, 1 - (u - 1) / 1.4);
        const d = f * s.len, pts = cutPath(s.pts, s.cum, d);
        g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
        g.globalAlpha = 0.9 * a * (s.alpha || 1); g.strokeStyle = s.col; g.lineWidth = Math.max(0.06, 3 * px); g.shadowColor = s.col; g.shadowBlur = 12 * dpr;
        this.poly(g, pts); g.stroke();
        const head = pts[pts.length - 1];
        if (u <= 1.05) {
          g.shadowBlur = 18 * dpr; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(head[0], head[1], Math.max(0.07, 4 * px), 0, TAU); g.fill();
          if (s.label && v.z > 6) this.pill(g, s.label, head[0], head[1] - 10 * px, px, s.col);
        }
        g.restore();
      }
      // the floppy drives: disk, head, sectors, motor
      this.drawDrivesFx(g, now, px);
      // the video card refreshes the screen all the time
      this.videoScan(now);
      // the work of the units on the dies
      this.drawJobs(g, now, px);
      // trace: the path, the token, the block card
      if (this.tr) this.drawTrace(g, now, px);
      else { this.tok.style.opacity = 0; if (this.card && this.cardShown) { this.card.hide(); this.cardShown = null; } }
    }
    pill(g, s, x, y, px, col) {
      const size = 12 * px;
      g.save();
      g.shadowBlur = 0;
      g.font = `600 ${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
      const tw = g.measureText(s).width + size;
      g.fillStyle = 'rgba(8,10,18,0.88)'; this.rrect(g, x - tw / 2, y - size * 0.8, tw, size * 1.6, size * 0.4); g.fill();
      g.strokeStyle = col; g.lineWidth = px; g.stroke();
      g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y);
      g.restore();
    }
    paintUnit(g, p, label, card, u, now, glowA) {
      const blocks = this.blocksOf(p, label);
      if (!blocks.length) return;
      const k1 = this.view.z * this.frameOf(p).s;   // screen px per base px
      g.save();
      this.dieFrame(g, p);
      blocks.forEach((b, k) => {
        const r = { x: b.x, y: b.y, w: b.w, h: b.h };
        // the glow of the whole unit (all its parts)
        g.save(); g.globalAlpha *= glowA; g.strokeStyle = THEME.goldHi; g.lineWidth = Math.max(2 / k1, Math.min(r.w, r.h) * 0.02); g.shadowColor = THEME.goldHi; g.shadowBlur = 12 * this.dpr;
        g.strokeRect(r.x, r.y, r.w, r.h); g.restore();
        // the drawing of its work (in the first part; the other parts only glow)
        if (k === 0 && card && typeof UnitFx !== 'undefined') {
          const sw = r.w * k1, sh = r.h * k1;
          if (sw < 90 || sh < 50) return;              // a small unit: only its glow (the card shows its work)
          g.save();
          g.translate(r.x, r.y);
          g.scale(r.w / sw, r.h / sh);
          g.beginPath(); g.rect(0, 0, sw, sh); g.clip();
          g.fillStyle = 'rgba(6, 8, 16, 0.55)'; g.fillRect(0, 0, sw, sh);
          try { UnitFx.draw(g, sw, sh, card, u, now, this.reduced); } catch (e) { /* keep the die */ }
          g.restore();
        }
      });
      g.restore();
    }
    drawJobs(g, now, px) {
      if (this.tr) { this.jobs.length = 0; return; }
      for (let i = this.jobs.length - 1; i >= 0; i--) {
        const j = this.jobs[i], u = (now - j.t0) / j.dur;
        if (u > 3) { this.jobs.splice(i, 1); continue; }
        if (u < 0) continue;
        const a = u < 2 ? 1 : 3 - u;
        g.save(); g.globalAlpha = a;
        this.paintUnit(g, j.p, j.label, j.card, this.reduced ? 1 : clamp(u, 0, 1), now, u < 1.2 ? 0.9 : 0.4);
        g.restore();
        if (u < 1 && typeof Sfx !== 'undefined' && !j.ticked && j.dur / (this.app.motion || 1) >= 400) { j.ticked = true; Sfx.tick(1.2); }
      }
      void px;
    }
    drawTrace(g, now, px) {
      const t = this.tr, at = this.trAt(now), s = t.s, col = COL()[s.token.col] || THEME.gold;
      // the held values of this instruction (they wait where their steps ended)
      for (const q of this.parked) {
        const pc = COL()[q.col] || THEME.gold;
        g.save(); g.globalAlpha = 0.7; g.fillStyle = pc; g.shadowColor = pc; g.shadowBlur = 6 * this.dpr;
        g.beginPath(); g.arc(q.pos[0], q.pos[1], Math.max(0.02, 3 * px), 0, TAU); g.fill();
        // (the name only outside the die that the token is in: there it would cover the units)
        const cur = this.trAt(now), inDie = cur && cur.sg.p && (() => { const r = this.dieRect(cur.sg.p); return q.pos[0] > r.x0 && q.pos[0] < r.x1 && q.pos[1] > r.z0 && q.pos[1] < r.z1; })();
        if (!inDie) { g.font = `${10 * px}px ui-monospace, monospace`; g.textAlign = 'center'; g.fillStyle = pc; g.globalAlpha = 0.8; g.fillText(`${q.tag} ${q.val}`, q.pos[0], q.pos[1] - 7 * px); }
        g.restore();
      }
      for (const b of t.bg || []) this.drawBg(g, b, now, px);
      // the path ahead of the token: a faint dashed line
      g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = col; g.globalAlpha = 0.35; g.setLineDash([6 * px, 6 * px]); g.lineWidth = Math.max(0.01, 1.4 * px);
      for (let k = at ? at.i : 0; k < t.segs.length; k++) {
        const sg = t.segs[k];
        if (sg.kind !== 'move') continue;
        const pts = at && k === at.i ? cutPath(sg.pts.slice().reverse(), sg.cum.map(v => sg.len - v).reverse(), (1 - at.local) * sg.len).reverse() : sg.pts;
        this.poly(g, pts); g.stroke();
      }
      g.restore();
      if (!at) { this.tok.style.opacity = 0; return; }
      // the unit where the token is (or was last in this chip): its glow and its work; the
      // work plays while the token waits at the working part
      const sg = at.sg;
      let lastUnit = null;
      for (let k = at.i; k >= 0; k--) { if ((t.segs[k].unit || t.segs[k].kind === 'dwell') && t.segs[k].p === sg.p) { lastUnit = t.segs[k]; break; } if (!t.segs[k].p) break; }
      const opU = lastUnit === sg ? clamp((at.local - FLOW_IN) / (1 - 2 * FLOW_IN), 0, 1) : 1;
      const win = this.unitWindow(lastUnit === sg ? sg : null, opU);
      if (lastUnit) this.paintUnit(g, lastUnit.p, lastUnit.block, win > 0.5 ? null : lastUnit.card, opU, now, lastUnit === sg ? 1 : 0.4);
      this.showCard(lastUnit && lastUnit.card ? lastUnit.card : null, opU);
      if (sg.unit && sg.card) this.drawFeeders(g, sg, at.local, now, px);
      if (lastUnit && lastUnit.card) this.drawLens(g, t, lastUnit, lastUnit === sg ? 1 : 0.45);
      // the lit path of the step up to the token
      g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 10 * this.dpr;
      for (let k = 0; k <= at.i; k++) {
        const sg = t.segs[k];
        if (sg.kind !== 'move') continue;
        g.globalAlpha = 0.85;
        g.lineWidth = Math.max(0.01, 2.4 * px);               // the same width in a chip and on the board
        const q = t.segs[k];
        const pts = k < at.i ? q.pts : cutPath(q.pts, q.cum, Math.hypot(at.pos[0] - q.pts[0][0], at.pos[1] - q.pts[0][1]) > 0 ? this.distOn(q, at.pos) : 0);
        this.poly(g, pts); g.stroke();
      }
      g.restore();
      // the value at the token in a unit: the input before the work, the result after it
      if (sg.unit && sg.card) { const io = this.unitIO(sg.card); if (io) this.pill(g, opU < 0.5 ? io.in : io.out, at.pos[0], at.pos[1] + 12 * px, px, col); }
      // a new value: a ring at its source for 0.4 s
      const born = t.pan ? (now - t.t0 - t.pan) / 400 : 1;
      if (born < 1) { g.save(); g.globalAlpha = 1 - born; g.strokeStyle = col; g.lineWidth = 2 * px; g.beginPath(); g.arc(at.pos[0], at.pos[1], (6 + 22 * born) * px, 0, TAU); g.stroke(); g.restore(); }
      // the token
      g.save(); g.fillStyle = '#ffffff'; g.shadowColor = col; g.shadowBlur = 16 * this.dpr;
      g.beginPath(); g.arc(at.pos[0], at.pos[1], Math.max(0.01, 4.5 * px), 0, TAU); g.fill(); g.restore();
      // the label: what, from where, to where, what happens now
      const [sx, sy] = this.toScreen(at.pos[0], at.pos[1]);
      const inChip = !!sg.p;
      this.tokTag.textContent = s.token.tag; this.tokVal.textContent = s.token.val || '';
      this.tokRoute.textContent = s.toName ? `${s.fromName} → ${s.toName}` : s.fromName || '';
      this.tokNow.textContent = String(sg.label || '').replace(/<[^>]+>/g, '');
      this.tok.style.borderTopColor = col;
      this.tok.style.opacity = 1;
      // the label: in a chip it waits above the die (below it when there is no space), so it
      // never covers the units; on the board it follows the token. It glides to its place.
      const lh = this.tok.offsetHeight || 60;
      let x = sx, y = sy - 18;
      if (inChip) {
        const r = this.dieRect(sg.p), a = this.toScreen(r.x0, r.z0), b = this.toScreen(r.x1, r.z1);
        x = (a[0] + b[0]) / 2;
        y = Math.min(a[1], b[1]) - 10;
        if (y - lh < 96) y = Math.max(a[1], b[1]) + 10 + lh;
      }
      x = clamp(x, 150, this.w - 150); y = clamp(y, 96 + lh, this.h - this.barH() + 8);
      const tp = this.tokPos || (this.tokPos = { x, y, t: now });
      const f = 1 - Math.exp(-clamp(now - tp.t, 0, 100) / 140);
      tp.x += (x - tp.x) * f; tp.y += (y - tp.y) * f; tp.t = now;
      this.tok.style.transform = `translate(${tp.x}px, ${tp.y}px) translate(-50%, -100%)`;
      // sounds
      if (at.i !== t.lastSeg && typeof Sfx !== 'undefined') {
        const was = t.lastSeg >= 0 ? t.segs[t.lastSeg] : null;
        if (sg.p && (!was || was.p !== sg.p)) Sfx.enter(); else if (!sg.p && was && was.p) Sfx.leave(); else if (sg.kind === 'dwell') Sfx.tick(1.3);
        t.lastSeg = at.i;
      }
    }
    // A token of the work in parallel (for example a prefetch): a thin dim path, a small dot
    // with its name, the glow of its unit, and an arrow at the edge of the view when it is
    // outside the view.
    drawBg(g, b, now, px) {
      const at = this.trAt(now, b);
      if (!at || at.E >= 1) return;
      const col = COL()[b.s.token.col] || THEME.gold;
      g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = col; g.globalAlpha = 0.45; g.lineWidth = Math.max(0.01, 1.2 * px);
      for (let k = 0; k <= at.i; k++) { const q = b.segs[k]; this.poly(g, k < at.i ? q.pts : cutPath(q.pts, q.cum, this.distOn(q, at.pos))); g.stroke(); }
      g.restore();
      if (at.sg.unit) this.paintUnit(g, at.sg.p, at.sg.block, null, 1, now, 0.35);
      g.save(); g.globalAlpha = 0.8; g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8 * this.dpr;
      g.beginPath(); g.arc(at.pos[0], at.pos[1], Math.max(0.02, 3 * px), 0, TAU); g.fill(); g.restore();
      const [sx, sy] = this.toScreen(at.pos[0], at.pos[1]), name = `${b.s.token.tag} ${b.s.token.val || ''} · prefetch`;
      if (sx > 20 && sx < this.w - 20 && sy > 60 && sy < this.h - 40) { this.pill(g, name, at.pos[0], at.pos[1] + 12 * px, px, col); return; }
      // outside the view: an arrow at the edge
      const cx = this.w / 2, cy = this.h / 2, dx = sx - cx, dy = sy - cy, k = Math.min((this.w / 2 - 30) / Math.abs(dx || 1e-9), (this.h / 2 - 60) / Math.abs(dy || 1e-9));
      const ex = cx + dx * k, ey = cy + dy * k, an = Math.atan2(dy, dx);
      g.save(); g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.translate(ex, ey); g.rotate(an);
      g.fillStyle = col; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -7); g.lineTo(-6, 7); g.closePath(); g.fill();
      g.rotate(-an); g.font = '11px ui-monospace, Consolas, monospace'; g.textAlign = ex > cx ? 'right' : 'left'; g.fillText(name, ex > cx ? -12 : 12, ey > cy ? -10 : 18);
      g.restore();
    }
    // The distance along a part to a point on it (the token).
    distOn(sg, pos) {
      let best = 0, bd = Infinity;
      for (let j = 1; j < sg.pts.length; j++) {
        const a = sg.pts[j - 1], b = sg.pts[j], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-12;
        const f = clamp(((pos[0] - a[0]) * dx + (pos[1] - a[1]) * dz) / L2, 0, 1), x = a[0] + dx * f, z = a[1] + dz * f, d = Math.hypot(pos[0] - x, pos[1] - z);
        if (d < bd) { bd = d; best = sg.cum[j - 1] + f * (sg.cum[j] - sg.cum[j - 1]); }
      }
      return best;
    }
    // The value that goes into a unit and the value that comes out (from its card).
    unitIO(c) {
      const h = (v, n) => hex(v >>> 0, n) + 'h';
      switch (c.kind) {
        case 'adder': return { in: `${h(c.a, Math.ceil(c.width / 4))} + ${h(c.b, 4)}`, out: `= ${h(c.r, Math.ceil(c.width / 4))}` };
        case 'decoder': return { in: `${c.inLabel || 'in'} ${h(c.value, Math.ceil(c.bits / 4))}`, out: `line ${c.value}` };
        case 'mux': return { in: `column ${c.sel}`, out: `bit ${c.value}` };
        case 'cells': return { in: `row ${c.rowLabel}`, out: `bit ${c.bit}` };
        case 'bytes': { const cells = c.cells || [], take = c.take || [], put = c.put || []; const pick = (take.length ? take : put).map(i => cells[i] ? hex(cells[i].v, 2) : '??'); return { in: take.length ? `queue ${cells.map(x => hex(x.v, 2)).join(' ')}` : `in ${pick.join(' ')}`, out: take.length ? `out ${pick.join(' ')}` : `queue ${pick.join(' ')}` }; }
        case 'opcode': return { in: (c.bytes || []).map(b => hex(b, 2)).join(' '), out: c.text || '' };
        case 'status': { const r = (c.rows || []).find(x => x.code === c.code); return { in: `S2–S0 ${c.code}`, out: r ? r.cmd : '' }; }
        case 'buffer': return { in: h(c.value, Math.ceil((c.bits || 16) / 4)), out: h(c.value, Math.ceil((c.bits || 16) / 4)) };
        case 'regfile': return null;
        default: return null;
      }
    }
    // The operands that come into a unit from other units on their own wires (for example
    // the two inputs of the address adder). They move while the token comes in.
    feedersOf(sg) {
      const c = sg.card, p = sg.p;
      if (c.kind === 'adder' && /^(80[0-9]86|8086|80286)$/.test(p.part) && sg.block === 'ADDRESS ADDER') {
        const code = /^CS/.test(c.aLabel || '');
        return [{ from: 'SEGMENT REGS', text: `${c.aLabel} ${hex(c.a >>> 0, 5)}h` }, { from: code ? 'SEGMENT REGS' : 'REGISTERS', text: `${code ? 'IP' : 'offset'} ${hex(c.b >>> 0, 4)}h` }];
      }
      return [];
    }
    drawFeeders(g, sg, local, now, px) {
      const fs = sg.feeders || (sg.feeders = this.feedersOf(sg).map(f => {
        if (!this.blocksOf(sg.p, f.from).length || f.from === sg.block) return null;
        const pts = this.dieRoute(sg.p, { unit: f.from }, { unit: sg.block }).map(q => this.dieToWorld(sg.p, q[0], q[1]));
        const cum = [0];
        for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
        return { pts, cum, len: cum[cum.length - 1], text: f.text };
      }).filter(Boolean));
      const u = clamp(local / FLOW_IN, 0, 1), col = COL().addr;
      fs.forEach((f, k) => {
        const uu = clamp(u * 1.15 - k * 0.15, 0, 1), d = uu * f.len;
        g.save(); g.strokeStyle = col; g.globalAlpha = 0.85; g.lineWidth = Math.max(0.01, 1.4 * px); g.shadowColor = col; g.shadowBlur = 6 * this.dpr;
        this.poly(g, cutPath(f.pts, f.cum, d)); g.stroke(); g.restore();
        if (uu < 1) {
          const q = cutPath(f.pts, f.cum, d), e = q[q.length - 1];
          g.save(); g.fillStyle = col; g.beginPath(); g.arc(e[0], e[1], Math.max(0.01, 2.6 * px), 0, TAU); g.fill(); g.restore();
          this.pill(g, f.text, e[0], e[1] - 10 * px, px, col);
        }
      });
    }
    // The window into a unit: the exact drawing of the card (the bits, the lines, the cells
    // with the real values), on the unit itself, between the die and the token layer. It is at
    // least 300 px wide, centred on the unit, and it fades in as the unit grows on the screen.
    // Returns its opacity.
    unitWindow(sg, u) {
      const spec = sg && sg.card && sg.card.kind !== 'text' ? sg.card : null;
      let a = 0, r = null;
      if (spec) {
        const b = this.blockRect(sg.p, sg.block);
        if (b) {
          const A = this.toScreen(b.x0, b.z0), B = this.toScreen(b.x1, b.z1);
          r = { x: Math.min(A[0], B[0]), y: Math.min(A[1], B[1]), w: Math.abs(B[0] - A[0]), h: Math.abs(B[1] - A[1]) };
          a = clamp((Math.max(r.w, r.h) - 140) / 80, 0, 1);    // (the long side: a tall, narrow unit also gets its window)
        }
      }
      if (!this.win) {
        if (!a || typeof BlockPanel === 'undefined') return 0;
        this.win = new BlockPanel(this.root);
        this.win.setReducedMotion(this.reduced);
        this.win.el.classList.add('bk-inplace');
        this.base.after(this.win.el);                        // under the token layer (fx)
      }
      const W = this.win;
      if (!a) { W.el.style.opacity = 0; W.el.style.visibility = 'hidden'; return 0; }
      if (this.winSpec !== spec) { W.show(spec); this.winSpec = spec; W.el.classList.add('bk-inplace'); }
      W.update(this.reduced ? 1 : u);
      const w0 = W.el.offsetWidth || 340, h0 = W.el.offsetHeight || 200;
      const tw = Math.max(r.w * 1.08, 300), sc = Math.min(tw / w0, Math.max(r.h * 1.08, 200) / h0 * 1.6);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      W.el.style.visibility = 'visible';
      W.el.style.opacity = a;
      W.el.style.transform = `translate(${cx - w0 * sc / 2}px, ${cy - h0 * sc / 2}px) scale(${sc})`;
      return a;
    }
    // The card is a magnifier of the unit: a light cone from the unit on the die to the card,
    // and at the card the names of where the input comes from and where the output goes.
    drawLens(g, t, sg, alpha) {
      if (!this.card || !this.cardShown || this.card.min) return;
      const rr = this.root.getBoundingClientRect(), cr = this.card.el.getBoundingClientRect();
      if (!cr.width) return;
      const b = this.blockRect(sg.p, sg.block);
      if (!b) return;
      const A = this.toScreen(b.x0, b.z0), B = this.toScreen(b.x1, b.z1);
      const ux0 = Math.min(A[0], B[0]), ux1 = Math.max(A[0], B[0]), uy0 = Math.min(A[1], B[1]), uy1 = Math.max(A[1], B[1]);
      const cx0 = cr.left - rr.left, cx1 = cr.right - rr.left, cy0 = cr.top - rr.top, cy1 = cr.bottom - rr.top;
      const left = cx1 < ux0, col = THEME.goldHi;
      g.save();
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.globalAlpha = alpha;
      const cone = left ? [[cx1, cy0], [ux0, uy0], [ux0, uy1], [cx1, cy1]] : [[cx0, cy0], [ux1, uy0], [ux1, uy1], [cx0, cy1]];
      g.beginPath(); cone.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath();
      g.fillStyle = 'rgba(255, 230, 150, 0.07)'; g.fill();
      g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([4, 4]); g.globalAlpha = alpha * 0.6;
      g.beginPath(); g.moveTo(cone[0][0], cone[0][1]); g.lineTo(cone[1][0], cone[1][1]); g.moveTo(cone[3][0], cone[3][1]); g.lineTo(cone[2][0], cone[2][1]); g.stroke();
      g.setLineDash([]); g.globalAlpha = alpha; g.strokeRect(ux0 - 1.5, uy0 - 1.5, ux1 - ux0 + 3, uy1 - uy0 + 3);
      // where the input comes from and where the output goes
      const io = this.unitEnds(t, sg);
      g.font = '11px ui-monospace, Consolas, monospace'; g.textBaseline = 'alphabetic';
      g.fillStyle = COL().addr; g.fillText('in  ← ' + io.from, cx0 + 4, Math.max(14, cy0 - 6));
      g.fillStyle = COL().data; g.fillText('out → ' + io.to, cx0 + 4, cy1 + 15);
      g.restore();
    }
    // The names of the ends of a unit visit: the unit or the pin before it, and after it.
    unitEnds(t, sg) {
      const i = t.segs.indexOf(sg), name = q => q.unit ? `the ${q.block.toLowerCase()}` : q.p ? `a pin of the ${q.p.part}` : 'the bus';
      let from = '', to = '';
      for (let k = i - 1; k >= 0; k--) { const q = t.segs[k]; if (q.unit) { from = name(q); break; } if (q.p !== sg.p) { from = `a pin (${String(q.label || 'the bus').replace(/^On the /, 'the ').toLowerCase()})`; break; } }
      for (let k = i + 1; k < t.segs.length; k++) { const q = t.segs[k]; if (q.unit) { to = name(q); break; } if (q.p !== sg.p) { to = `a pin (${String(q.label || 'the bus').replace(/^On the /, 'the ').toLowerCase()})`; break; } }
      const fs = (sg.feeders || []).map(f => f.text).join(', ');
      if (!from) from = i === 0 && t.pan ? 'here (a new value)' : 'the last step';
      if (!to) to = 'the next step';
      return { from: fs ? `${from}; ${fs}` : from, to };
    }
    showCard(spec, u) {
      if (!spec || typeof BlockPanel === 'undefined') { if (this.card && this.cardShown) { this.card.hide(); this.cardShown = null; } return; }
      if (!this.card) { this.card = new BlockPanel(this.root, { minKey: 'topCardMin', minDefault: true }); this.card.setReducedMotion(this.reduced); this.card.el.style.zIndex = 5; }
      if (this.cardShown !== spec) { this.card.show(spec); this.cardShown = spec; this.card.place(12, 74); }
      this.card.update(this.reduced ? 1 : u);
    }
    // A short tooltip for the chip under the pointer (only when the chip is small on screen,
    // so it never covers a die that the user looks at).
    hover() {
      const h = this.hoverAt;
      if (!h || this.ptrs.size) return;
      this.hoverAt = null;
      const r = this.root.getBoundingClientRect(), [x, z] = this.toWorld(h.x - r.left, h.y - r.top), p = this.pick(x, z);
      if (!p || p.d.L * this.view.z > 260) { this.tip.classList.remove('tp-on'); return; }
      const info = BoardKit.INFO[p.glow];
      this.tip.innerHTML = '';
      htmlEl('b', null, this.tip, `${p.ref ? p.ref + ' ' : ''}${p.name}`);
      this.tip.appendChild(document.createTextNode(` ${info ? info[1] : ''}`));
      if (info) htmlEl('div', null, this.tip, info[2]);
      htmlEl('div', { style: 'color: var(--muted); margin-top: 3px' }, this.tip, 'Double-click to fill the view with this chip.');
      this.tip.style.left = clamp(h.x - r.left + 14, 8, this.w - 310) + 'px';
      this.tip.style.top = clamp(h.y - r.top + 14, 8, this.h - 120) + 'px';
      this.tip.classList.add('tp-on');
    }
  }

  // The colours of the kinds of die units (memory, ROM, datapath, logic, I/O, analog).
  const DIE_TINT = { m: '#35487f', r: '#563b74', d: '#2b6664', l: '#695632', i: '#6c4149', a: '#386a47' };
  // The 80286 floor plan names of the 8086 unit names that the models use.
  const BLK_MAP = { 'ADDRESS ADDER': 'PHYSICAL ADDER', 'SEGMENT REGS': 'SEGMENT CACHES', QUEUE: 'PREFETCH QUEUE', DECODER: 'INSTRUCTION DECODER',
    'MICROCODE ROM': 'CONTROL ROM', FLAGS: 'ALU', 'INTERRUPTS TIMING': 'BUS CONTROL' };
  // Offset a polyline to its left side (for the single lines of a bundle).
  function offsetPath(pts, off) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      out.push([pts[i][0] - (b[1] - a[1]) / l * off, pts[i][1] + (b[0] - a[0]) / l * off]);
    }
    return out;
  }
  // The part of a path up to the distance d.
  function cutPath(pts, cum, d) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= d) { out.push(pts[i]); continue; }
      const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
      break;
    }
    return out;
  }
  return TopView;
})();
