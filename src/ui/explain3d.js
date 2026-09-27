// Explain: a guided story on the 3D board. A short program runs one instruction at a time with
// the trace (the story steps of story.js, with each code fetch as its own T1-T3 steps); for each
// step the director gives the time to read it, one caption, a fixed camera shot and the
// spotlight (board3d.js: xpSet, xpFocus, xpShot, drawSpot), and the card of the unit stays open.
// A tour of the parts comes first. Pause and the speed use the animation clock (AnimClock).
const Explain3D = (() => {
  const SRC = [
    ['mov ax, 0xB800', 'Put the number B800h in register AX.'],
    ['mov es, ax', 'Copy AX to the segment register ES.'],
    ["mov al, 'A'", 'Put the code of the letter A (41h) in AL.'],
    ['mov [es:0], al', 'Write AL to the first cell of the video memory.'],
  ];
  const ICOL = ['#6fe3cf', '#b69cff', '#ffb27a', '#e9e56a'];
  // The parts of each model for the tour (the chip ids of the 3D board are the same on all boards).
  const MODEL = typeof CPU_MODEL !== 'undefined' ? CPU_MODEL : '8086';
  const CPUS = {
    8086: { name: '8086', lat: '8282', xcv: '8286', bus: '8288',
      inside: 'Inside it, the <b>execution unit</b> decodes and executes, and the <b>bus interface unit</b> fetches the code into a 6-byte queue and talks to the bus.' },
    80286: { name: '80286', lat: '74LS573', xcv: '74LS245', bus: '82288',
      inside: 'Inside it, four units work at the same time: the <b>bus unit</b> fetches the code, the <b>instruction unit</b> decodes it, the <b>execution unit</b> executes, and the <b>address unit</b> calculates the addresses.' },
    80386: { name: '80386', lat: '74LS573', xcv: '74LS245', bus: '82288',
      inside: 'Inside it, six units work at the same time: the bus, prefetch, decode, execution, segment and paging units. A 16-byte queue keeps the code. Here it has a 16-bit data bus (as the 386SX).' },
    80486: { name: '80486', lat: '74LS573', xcv: '74LS245', bus: '82288', cache: true,
      inside: 'It has an <b>8 KB cache</b> on the chip: the code comes from the memory once, then from the cache. A five-stage pipeline does most simple instructions in one clock.' },
    80586: { name: 'Pentium', lat: '74LS573', xcv: '74LS245', bus: '82288', cache: true,
      inside: 'It has two pipelines, <b>U</b> and <b>V</b>: two simple instructions can execute in the same clock. It has an 8 KB code cache and an 8 KB data cache on the chip.' },
    80686: { name: 'Pentium Pro', lat: '74LS573', xcv: '74LS245', bus: '82288', cache: true,
      inside: 'Its decoders change each instruction into <b>µops</b>. The µops execute out of order, when their data is ready, and the reorder buffer puts the results back in order. A 256 KB L2 cache is in the same package.' },
  };
  const CPU = CPUS[MODEL] || CPUS[8086];
  const VIDEO = typeof VIDEO_CARD !== 'undefined' && VIDEO_CARD === 'vga' ? 'VGA' : 'CGA';
  const hx = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
  const CSS = `
  .xp3-on .bv-top, .xp3-on .bv-hint { display: none !important; }
  /* Explain has the whole window: no view tabs, no counters, no run bar (its own bar has the controls) */
  body.xp-full { --transport-h: 0px; }
  body.xp-full .transport, body.xp-full .stage-head, body.xp-full .stats, body.xp-full .mobile-nav { display: none !important; }
  /* the card of the unit: larger in Explain (the drawing scales with the width) */
  .xp3-on .bk-panel:not(.bk-inplace) { width: 450px; padding: 12px 14px 10px 16px; }
  .xp3-on .bk-title { font-size: 17px; }
  .xp3-on .bk-chip { font-size: 12.5px; }
  .xp3-on .bk-sub { font-size: 15px; line-height: 1.4; }
  /* the label at the token and the labels of the parts */
  .xp3-on .bv-tok { max-width: 400px; padding: 7px 12px 8px; }
  .xp3-on .bv-tok i { font-size: 12px; }
  .xp3-on .bv-tok b { font-size: 18px; }
  .xp3-on .bv-tok-route { font-size: 14.5px; }
  .xp3-on .bv-tok-now { font-size: 14px; }
  .xp3-on .bv-lab { font-size: 14px; }
  /* the program strip: one button for each chapter (the machine, each instruction, the end) */
  .xp3-prog { position: absolute; left: 12px; right: 12px; top: 10px; z-index: 8; display: flex; gap: 6px; pointer-events: none; }
  .xp3-card { flex: 1 1 0; min-width: 0; height: 42px; display: flex; align-items: center; gap: 9px; padding: 0 12px; border-radius: 10px; pointer-events: auto; cursor: pointer;
    background: color-mix(in srgb, var(--panel) 90%, transparent); border: 1px solid var(--line); color: var(--text); font: inherit; text-align: left;
    opacity: .6; transition: opacity .3s, border-color .3s, box-shadow .3s; backdrop-filter: blur(6px); }
  .xp3-card.xp3-end { flex: 0 0 auto; font: 600 14px var(--sans); color: var(--muted); }
  .xp3-card:hover { opacity: .9; border-color: var(--muted); }
  .xp3-card.cur { opacity: 1; border-color: var(--phosphor); }
  .xp3-card.cur.xp3-end { color: var(--text); }
  .xp3-card.on { box-shadow: 0 0 18px -4px var(--phosphor); }
  .xp3-card.done:not(.cur) { opacity: .75; }
  .xp3-card:focus-visible { outline: 2px solid var(--phosphor); outline-offset: 2px; }
  .xp3-card .n { flex: none; font: 700 13px var(--mono); color: var(--muted); }
  .xp3-card.cur .n { color: var(--phosphor); }
  .xp3-card code { flex: 1 1 auto; min-width: 0; font: 600 16px var(--mono); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp3-card .xb { flex: none; display: flex; gap: 3px; }
  .xp3-card .xb i { font: 700 12.5px var(--mono); font-style: normal; color: #120b1a; border-radius: 4px; padding: 2px 4px; }
  @media (max-width: 1180px) { .xp3-card .xb { display: none; } }
  .xp3-bar { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 8; display: grid; gap: 8px; padding: 12px 14px; border-radius: 12px;
    background: color-mix(in srgb, var(--panel) 92%, transparent); border: 1px solid var(--line); backdrop-filter: blur(8px); box-shadow: 0 18px 40px -18px #000; }
  .xp3-chap { font: 650 14.5px var(--sans); color: var(--phosphor); }
  .xp3-chap code { font: 600 14.5px var(--mono); color: var(--text); }
  .xp3-cap { margin: 0; font: 500 clamp(17px, 1.75vw, 23px)/1.45 var(--sans); color: var(--text); min-height: 2.9em; max-width: 100ch; }
  .xp3-cap b { color: #fff; font-weight: 650; }
  /* the step (while the caption shows the unit that works): a short line above the caption */
  .xp3-ctx { margin: 0; font: 500 14.5px/1.4 var(--sans); color: var(--muted); max-width: 120ch; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .xp3-ctx b { color: var(--text); font-weight: 600; }
  .xp3-unit { font: 700 .82em var(--mono); letter-spacing: .04em; color: var(--phosphor); margin-right: .4em; }
  .xp3-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .xp3-btn { font: 600 14px var(--mono); color: var(--text); background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  .xp3-btn:hover { border-color: var(--muted); }
  .xp3-btn.main { background: var(--phosphor); color: #120b1a; border-color: var(--phosphor); min-width: 78px; }
  .xp3-chip { font: 500 13.5px var(--mono); color: var(--muted); background: transparent; border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; cursor: pointer; }
  .xp3-chip.on { color: #120b1a; background: var(--phosphor); border-color: var(--phosphor); }
  /* the milestones of the chapter: one part for each sub-step; the current one fills as it plays */
  .xp3-ms { flex: 1 1 200px; display: flex; gap: 4px; align-items: center; min-width: 0; }
  .xp3-ms button { position: relative; flex: 1 1 0; min-width: 8px; height: 26px; padding: 0; border: 0; background: none; cursor: pointer; }
  .xp3-ms button::before { content: ""; position: absolute; left: 0; right: 0; top: 10px; height: 7px; border-radius: 4px; background: var(--line); transition: background .2s; }
  .xp3-ms button:hover::before { background: var(--muted); }
  .xp3-ms button i { position: absolute; left: 0; top: 10px; height: 7px; width: 0; border-radius: 4px; background: linear-gradient(90deg, var(--cyan), var(--phosphor)); }
  .xp3-ms button.done i { width: 100%; opacity: .55; }
  .xp3-ms button.on::before { box-shadow: 0 0 0 1.5px var(--phosphor); }
  .xp3-ms button.wait::before { background: repeating-linear-gradient(90deg, var(--line) 0 4px, transparent 4px 7px); }
  .xp3-ms button:focus-visible { outline: 2px solid var(--phosphor); outline-offset: 1px; border-radius: 4px; }
  .xp3-chap small { margin-left: .8em; font: 500 14px var(--sans); color: var(--muted); }
  .xp3-btn:focus-visible, .xp3-chip:focus-visible { outline: 2px solid var(--phosphor); outline-offset: 2px; }
  .xp3-btn.on { border-color: var(--phosphor); color: var(--phosphor); }
  /* the timing panel opens over the view, above the bar (the bar keeps its size, so the shots stay) */
  .xp3-set { position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px 18px;
    padding: 12px 14px; border-radius: 12px; background: color-mix(in srgb, var(--panel) 96%, transparent); border: 1px solid var(--line); box-shadow: 0 18px 40px -18px #000; }
  .xp3-sl { display: grid; gap: 4px; font: 500 13px var(--sans); color: var(--text); }
  .xp3-sl-top { display: flex; justify-content: space-between; gap: 8px; }
  .xp3-sl-top b { font: 700 13px var(--mono); color: var(--phosphor); font-variant-numeric: tabular-nums; }
  .xp3-sl input { width: 100%; accent-color: var(--phosphor); }
  .xp3-sl small, .xp3-keys { font: 12px var(--sans); color: var(--muted); }
  .xp3-ck { display: flex; align-items: center; gap: 8px; font: 500 13px var(--sans); color: var(--text); align-self: center; }
  .xp3-ck input { accent-color: var(--phosphor); width: 16px; height: 16px; }
  .xp3-keys { grid-column: 1 / -1; }
  .xp3-go { font: 700 12.5px var(--mono); letter-spacing: .04em; color: #120b1a; background: var(--phosphor); border: 0; border-radius: 999px; padding: 6px 14px; cursor: pointer; box-shadow: 0 0 16px -4px var(--phosphor); }
  `;

  class Explain {
    constructor(app) {
      this.app = app;
      this.on = false;
      this.beats = []; this.cur = null; this.bT0 = 0; this.bDur = 0; this.chapter = 0;
      this.paused = false; this.speed = 1; this.saved = null; this.ui = null; this.raf = 0;
      this.vHide = null; this.vShow = null; this.cyc0 = 0; this.firstFetch = true; this.firstWrite = true;
      // the timing that the viewer sets (kept in the browser)
      this.set = { travel: 1, work: 1, read: 1, wait: false, speed: 1 };
      try { Object.assign(this.set, JSON.parse(localStorage.getItem('a86:xpSet') || '{}')); } catch (e) { /* no storage */ }
      this.waiting = false; this.last = null;
      document.addEventListener('keydown', e => this.key(e), true);
      const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      const b = document.getElementById('btn-explain');
      if (b) b.addEventListener('click', () => (this.on ? this.stop() : this.start()));
    }
    get board() { return this.app.views.board; }
    // The first n bytes of the text screen at B8000h (a VGA keeps the characters in plane 0 and
    // the attributes in plane 1).
    vget(n) {
      const m = this.app.machine;
      if (!m.vga) return m.mem.slice(0xB8000, 0xB8000 + n);
      const v = m.vga.vram, o = new Uint8Array(n);
      for (let i = 0; i < n; i++) o[i] = v[((i & ~1) << 2) | (i & 1)];
      return o;
    }
    vset(bytes) {
      const a = this.app, m = a.machine;
      if (!m.vga) m.mem.set(bytes, 0xB8000);
      else { const v = m.vga.vram; for (let i = 0; i < bytes.length; i++) v[((i & ~1) << 2) | (i & 1)] = bytes[i]; m.vga.dirty = true; }
      if (a.crt) a.crt.dirty = true;
    }
    // ---------- start and stop ----------
    start() {
      const a = this.app, bd = this.board;
      if (!bd || !bd.ok) return;
      const fo = document.getElementById('opt-follow');
      this.saved = { tab: a.activeTab, trace: a.traceOn, pre: a.tracePre, speedPos: a.speedPos, follow: fo ? fo.checked : true, scale: AnimClock.scale,
        sfx: typeof Sfx !== 'undefined' ? Sfx.on : false, cardMin: bd.bcard ? bd.bcard.min : null, src: a.editor.value };
      this.on = true;
      // the whole stage for the board: the program pane and the dock close (Exit opens them again)
      document.body.classList.add('xp-full');
      this.saved.code = document.body.classList.contains('code-hidden');
      this.saved.dock = document.body.classList.contains('dock-hidden');
      if (a.toggleCode && !this.saved.code) a.toggleCode(true);
      if (a.toggleDock && !this.saved.dock) a.toggleDock(true);
      a.selectTab('board');
      if (!a.traceOn) a.setTrace(true);
      a.setSpeedPos(20, true);
      a.tracePre = 'full';
      if (fo && !fo.checked) { fo.checked = true; fo.dispatchEvent(new Event('change')); }
      if (typeof Sfx !== 'undefined' && !Sfx.on) Sfx.set(true);
      bd.xpSet({ shots: true, spot: true });
      bd.xpTime = { travel: this.set.travel, work: this.set.work, read: this.set.read };
      bd.root.classList.add('xp3-on');
      const tr = document.getElementById('trace'); if (tr) tr.hidden = true;
      // the floating screen: hidden (the monitor on the board shows the same picture)
      const mon = document.getElementById('monitor');
      this.saved.mon = mon ? mon.hidden : null;
      if (mon) mon.hidden = true;
      this.buildUi();
      this.speed = this.set.speed || 1; this.paused = false; AnimClock.setScale(this.speed);
      if (this.ui) this.ui.sp.textContent = this.speed + '×';
      this.go(0);
      this.loop();
    }
    stop() {
      if (!this.on) return;
      const a = this.app, bd = this.board, s = this.saved;
      this.on = false;
      cancelAnimationFrame(this.raf);
      this.unhide();
      if (a.play) a.finishInstr();
      bd.traceClear();
      bd.xpSet(null);
      bd.root.classList.remove('xp3-on');
      if (this.ui) { this.ui.prog.remove(); this.ui.bar.remove(); this.ui = null; }
      document.body.classList.remove('xp-full');
      AnimClock.setScale(s.scale);
      a.tracePre = s.pre;
      a.setSpeedPos(s.speedPos, true);
      if (!s.trace) a.setTrace(false);
      const fo = document.getElementById('opt-follow');
      if (fo && fo.checked !== s.follow) { fo.checked = s.follow; fo.dispatchEvent(new Event('change')); }
      if (typeof Sfx !== 'undefined' && Sfx.on !== s.sfx) Sfx.set(s.sfx);
      if (bd.bcard && s.cardMin !== null && bd.bcard.min !== s.cardMin) bd.bcard.setMin(s.cardMin);
      a.editor.value = s.src;
      const mon = document.getElementById('monitor');
      if (mon && s.mon !== null) mon.hidden = s.mon;
      a.syncTracePanel();
      if (a.toggleCode && !s.code) a.toggleCode(false);
      if (a.toggleDock && !s.dock) a.toggleDock(false);
      if (s.tab !== 'board') a.selectTab(s.tab);
      const b = document.getElementById('btn-explain'); if (b) b.textContent = '▶ Explain';
    }
    // ---------- the program and the chapters ----------
    program() {
      if (this.prog) return this.prog;
      const src = 'org 0x100\n' + SRC.map(l => ' ' + l[0]).join('\n') + '\n hlt\n';
      const r = Asm86.assemble(src, { origin: 0x100 });
      const out = [];
      let off = 0;
      for (let k = 0; k < SRC.length; k++) {
        const d = Disasm86.decode(i => r.bytes[off + i] || 0, 0x100 + off);
        out.push({ text: SRC[k][0], what: SRC[k][1], ip: 0x100 + off, bytes: [...r.bytes.slice(off, off + d.len)], col: ICOL[k] });
        off += d.len;
      }
      return (this.prog = { src, list: out });
    }
    // Load the program again (the machine starts it at 1000:0100 with a clear screen) and run
    // the instructions before chapter c without a story.
    go(c) {
      const a = this.app, bd = this.board, P = this.program();
      this.unhide();
      if (a.play) a.finishInstr();
      bd.traceClear();
      a.editor.value = P.src;
      a.assembleAndLoad();
      const m = a.machine;
      const clear = new Uint8Array(4000);
      for (let i = 0; i < 4000; i += 2) { clear[i] = 0x20; clear[i + 1] = 0x07; }
      this.vset(clear);
      this.cyc = this.cyc || [];
      for (let k = 1; k < c && k <= P.list.length; k++) { a.traceNext(); if (a.play) this.cyc[k - 1] = a.play.cycles; a.finishInstr(); }
      bd.traceClear();
      this.cyc0 = m.cpu.cycles;
      this.firstFetch = c <= 1; this.firstWrite = true;
      this.chapter = c;
      this.beats = this.chapterBeats(c);
      this.ms = this.beats.slice(); this.mi = -1; this.vRec = null;
      this.cur = null;
      this.buildMs();
      this.syncUi();
    }
    chapterBeats(c) {
      const P = this.program(), bd = this.board, list = P.list;
      if (c === 0) {
        return [
          { label: 'The program', cap: `This program has <b>four instructions</b> (at the top). The assembler changed each line into bytes: the colored tiles. The CPU sees only these bytes.`, ms: 6000, run: () => { bd.applyPreset('overview', false); bd.xpFocus([], { fly: false }); this.card(-1); } },
          { label: 'The CPU', cap: `The <b>${CPU.name} CPU</b> runs them, at ${this.mhz()} MHz. ${CPU.inside}`, ms: 7500, run: () => bd.xpFocus(['cpu', 'clk']) },
          { label: 'The clock', cap: this.clockText(), ms: 9000, run: () => { bd.dieEntry('clk'); bd.xpFocus(['die:clk']); bd.xpCard = { spec: Object.assign(this.clockCard(), { sub: '' }), t0: animNow(), dur: 7000 }; } },
          { label: 'The bus', cap: `The CPU talks to everything through the <b>bus</b>: the <b>${CPU.lat} latches</b> hold the address, the <b>${CPU.xcv} transceivers</b> pass the data, the <b>${CPU.bus} bus controller</b> makes the commands, and the <b>decoder</b> selects the chip that answers.`, ms: 7500, run: () => bd.xpFocus(['cpu', 'lat0', 'lat1', 'lat2', 'xcv0', 'xcv1', 'bus', 'dec']) },
          { label: 'The RAM', cap: `The program bytes are in the <b>RAM</b> (two banks: even and odd addresses), from address <b>10100h</b>.`, ms: 5000, run: () => bd.xpFocus(['ramE', 'ramO']) },
          { label: `The ${VIDEO} card`, cap: `The <b>${VIDEO} card</b> has its own video memory at <b>B8000h</b>. It draws the screen from it 60 times a second. Now the screen is empty.`, ms: 6000, run: () => bd.xpFocus(['cga', 'monitor']) },
        ];
      }
      if (c > list.length) {
        return [{ label: 'The summary', cap: '', ms: 9000, run: () => {
          const cyc = (this.cyc || []).reduce((n, x) => n + (x || 0), 0);
          const mhz = this.mhz(), us = cyc / mhz;
          this.capHtml = `Four instructions, <b>${cyc} clocks</b>: ${us < 1 ? (us * 1000).toFixed(0) + ' ns' : us.toFixed(1) + ' µs'} at ${mhz} MHz. The CPU had to fetch each code byte${CPU.cache ? ' (from the memory, through the cache)' : ' over the bus'} before it could use it, and one byte to the video memory made a letter. <b>That is all a program does: move bytes and calculate.</b>`;
          this.card(99); bd.traceClear(); bd.xpFocus(['screenTL'], { theta: 0.08, phi: 1.42, keepY: true });
          if (typeof Sfx !== 'undefined') Sfx.arrive('data');
        } }];
      }
      const k = c - 1, ins = list[k];
      return [
        { label: 'The instruction', cap: `Instruction ${c}: <b><code>${ins.text}</code></b> · ${ins.what} Its bytes: <b>${ins.bytes.map(b => hx(b, 2)).join(' ')}</b>.`, ms: 4200, run: () => { this.card(k); bd.xpFocus(['cpu'], { fly: false }); if (typeof Sfx !== 'undefined') Sfx.select(); } },
        { step: 0, label: '…', pending: true, run: () => this.startInstr(k) },
      ];
    }
    // The first step: the machine runs the instruction; its story gives the next beats.
    startInstr(k) {
      const a = this.app, m = a.machine;
      const before = this.vget(16);
      if (a.play) a.finishInstr();      // (the instruction before stays open for its milestones)
      a.traceNext();
      const p = a.play;
      if (!p || !p.story) return 1000;
      // the video memory shows the new bytes only at the write step (the machine ran the whole instruction)
      if (before) {
        const w = p.story.steps.findIndex(s => s.kind === 'bus' && s.phase === 'data' && s.I && s.I.dev === 'vram' && !s.I.read);
        if (w >= 0) { this.vHide = { old: before, now: this.vget(16), step: w }; this.vRec = Object.assign({}, this.vHide); this.vset(before); }
      }
      const steps = p.story.steps, extra = [], order = this.plan(k, steps);
      this.noFetch = !order.pre;
      const label = (i, o) => (o.quick ? 'More transfers of the line' : steps[i].title || steps[i].kind || 'A step');
      for (const o of order) {
        const i = o.i;
        if (o !== order[0]) extra.push({ step: i, label: label(i, o), run: () => this.enter(i, o) });
        if (this.vHide && i === this.vHide.step) extra.push({ label: 'The letter on the screen', ms: 6500, cap: `The <b>${VIDEO} card</b> reads its video memory 60 times a second to draw the screen. At its next frame, the first cell holds <b>41h</b> = the letter <b>A</b> (with the color byte 07h: grey on black). <b>The letter appears.</b>`, run: () => this.screen() });
      }
      extra.push({ label: 'Done', ms: 3600, run: () => {
        const cyc = p.cycles !== undefined ? p.cycles : 0;
        this.cyc = this.cyc || []; this.cyc[k] = cyc;
        this.capHtml = `Done: <b>IP</b> moves to <b>${hx(m.cpu.ip, 4)}h</b>, the next instruction${cyc ? `. This one took <b>${cyc} clock${cyc === 1 ? '' : 's'}</b>` : ''}.`;
        // (the instruction stays open, so the viewer can go back to its milestones; the next
        // instruction ends it)
        if (a.play) a.dispatchUntil(Infinity);
        this.card(k, true);
      } });
      this.beats.unshift(...extra);
      // the milestones: the first step (it is the step now; a jump back enters it again), then the rest
      const o0 = order[0], first = { step: o0.i, label: label(o0.i, o0), run: () => this.enter(o0.i, o0) };
      const at = this.ms.indexOf(this.cur);
      if (at >= 0) { this.ms.splice(at, 1, first, ...extra); this.cur = first; this.mi = at; }
      this.buildMs();
      return o0.i !== 0 ? this.enter(o0.i, o0) : this.stepMs(0, true);
    }
    // The order of the story steps for Explain, as [{ i, quick, cap }] (order.pre: the instruction
    // waits for code fetches). The fetches that bring the bytes of this instruction come before the
    // decode (with the cache miss that starts them first); the other steps keep their order. On a
    // model with a cache, the first bus cycle of a line fill plays in full and the other cycles of
    // the line are one short beat.
    plan(k, steps) {
      const ins = this.program().list[k], a0 = 0x10000 + ins.ip, a1 = a0 + ins.bytes.length;
      const L = CPU.cache ? (MODEL === '80486' ? 16 : 32) : 0;
      const lineOf = a => (L ? (a >>> 0) & ~(L - 1) : -1);
      const units = [];
      steps.forEach((s, i) => {
        const last = units[units.length - 1];
        if (s.kind === 'bus' && last && last.e === s.e) { last.idx.push(i); return; }
        units.push({ idx: [i], s, e: s.kind === 'bus' ? s.e : null, fetch: s.kind === 'bus' && !!s.I && s.I.kind === 'fetch' });
      });
      const groups = [];
      for (const u of units) {
        // the open line fill (a cache step can come between its cycles)
        let g = null;
        for (let j = groups.length - 1; j >= 0; j--) { if (groups[j].cycles) { g = groups[j]; break; } if (groups[j].one.s.kind !== 'cache') break; }
        if (u.fetch && L && g && g.line === lineOf(u.e.addr)) g.cycles.push(u);
        else if (u.fetch) groups.push({ line: lineOf(u.e.addr), cycles: [u], cache: [] });
        else groups.push({ one: u });
      }
      // a cache step of a filled line goes with the fill (the L1 miss before the L2 miss)
      for (const g of groups) {
        if (!g.one || g.one.s.kind !== 'cache') continue;
        const f = groups.find(x => x.cycles && x.line === lineOf(g.one.s.e.phys >>> 0));
        if (f) { f.cache.push(g.one.idx[0]); g.used = true; }
      }
      for (const g of groups) if (g.cycles) g.cache.sort((x, y) => (steps[x].e.level === 'L2') - (steps[y].e.level === 'L2'));
      const need = g => g.cycles && g.cycles.some(u => u.e.addr < a1 && u.e.addr + (u.e.width || 1) > a0);
      const rest = groups.filter(g => !g.used), pre = rest.filter(need);
      const di = rest.findIndex(g => g.one && g.one.s.kind === 'inside' && g.one.s.title === 'Decode');
      let seq = di < 0 ? rest : [...rest.slice(0, di).filter(g => !pre.includes(g)), ...pre, ...rest.slice(di).filter(g => !pre.includes(g))];
      // a data bus cycle comes after the steps inside the CPU that prepare it (the address, the
      // cache, the µops), as the later models log them after the cycle
      const bi = seq.findIndex(g => g.one && g.one.e);
      if (bi >= 0) {
        const late = seq.slice(bi + 1).filter(g => g.one && !g.one.e && (g.one.s.kind === 'inside' || g.one.s.kind === 'cache'));
        if (late.length) {
          late.sort((x, y) => (y.one.s.title === 'Address calculation') - (x.one.s.title === 'Address calculation'));
          seq = [...seq.slice(0, bi), ...late, ...seq.slice(bi).filter(g => !late.includes(g))];
        }
      }
      const out = [];
      for (const g of seq) {
        if (g.one) { for (const i of g.one.idx) out.push({ i }); continue; }
        for (const i of g.cache) out.push({ i });
        for (const i of g.cycles[0].idx) out.push({ i });
        const more = g.cycles.slice(1);
        if (more.length) {
          const n = more.length, w = more[0].e.width || 1, last = more[n - 1];
          out.push({ i: last.idx[last.idx.length - 1], quick: true,
            cap: `${n} more ${more[0].e.burst ? `transfer${n > 1 ? 's' : ''} of the burst` : `bus cycle${n > 1 ? 's' : ''}`} (${w} bytes each) bring the rest of the ${L}-byte line, <b>${hx(more[0].e.addr, 5)}h</b> to <b>${hx(last.e.addr + w - 1, 5)}h</b>. The cache keeps the whole line.` });
        }
      }
      out.pre = pre.length > 0;
      return out;
    }
    enter(i, o = {}) {
      const a = this.app, p = a.play, s = p && p.story && p.story.steps[i];
      if (!s) return 500;
      const quick = !!o.quick || (s.kind === 'bus' && s.I && s.I.kind === 'fetch' && !this.firstFetch);
      this.quickStep = quick;
      const save = a.spd.stepMs;
      if (quick) a.spd.stepMs = 650;
      a.enterStep(i);
      a.spd.stepMs = save;
      if (this.vHide && i === this.vHide.step) {
        // the byte reaches the video memory near the end of the step (on the animation clock)
        this.vShow = { now: this.vHide.now, at: animNow() + Math.max(200, p.stepDur * 0.8) };
        this.vHide = null;
      }
      return this.stepMs(i, false, quick, o.cap);
    }
    // The caption and the time of a story step (the time to read it, at least).
    stepMs(i, first, quick, over) {
      const a = this.app, p = a.play, s = p.story.steps[i];
      let cap = s.text || '';
      // the P6 model: the numbers of the µops and the clocks since the start are not useful here
      cap = cap.replace(/µop \d+ /g, 'a µop ').replace(/(^|\. )a µop/g, '$1A µop')
        .replace(/ at clock (\d+); its result is ready at (\d+)/g, (m, c0, c1) => `; its result is ready ${c1 - c0} clock${c1 - c0 === 1 ? '' : 's'} later`)
        .replace(/ \(clock (\d+) to (\d+)\)/g, (m, c0, c1) => ` (${c1 - c0} clocks)`).replace(/ at clock \d+/g, '');
      if (s.kind === 'inside' && s.title === 'Decode' && this.noFetch) {
        const why = CPU.cache ? ' The bytes are already in the queue (they came from the cache), so the decoder does not wait.' : ' The BIU fetched these bytes before, so the EU does not wait.';
        const e1 = cap.indexOf('". ');
        cap = e1 < 0 ? cap + why : cap.slice(0, e1 + 2) + why + cap.slice(e1 + 2);
      }
      if (s.kind === 'bus' && s.I && s.I.kind === 'fetch') {
        const I = s.I;
        if (!this.firstFetch || quick) {
          cap = s.phase === 'addr' ? `A code fetch: the BIU sends the address <b>${s.token.val}</b> to the ${s.toName}, to keep the queue full.`
            : s.phase === 'cmd' ? `The ${s.fromName} sends <b>${s.token.tag}</b>: the ${s.toName} reads.`
              : `The code ${/ /.test(s.token.val) ? 'bytes' : 'byte'} <b>${s.token.val}</b> ${/ /.test(s.token.val) ? 'come' : 'comes'} back and ${/ /.test(s.token.val) ? 'go' : 'goes'} into the queue.`;
        }
        if (s.phase === 'data') this.firstFetch = false;
      }
      if (over) cap = over.replace(/<[^>]+>/g, '');
      if (!over && cap.length > 230) {
        const ends = [...cap.matchAll(/\. (?=[A-Z])/g)].map(m => m.index + 1);
        if (ends.length) {
          const cut = ends.reduce((b, x) => (Math.abs(x - cap.length / 2) < Math.abs(b - cap.length / 2) ? x : b));
          const tail = cap.slice(cut + 1);
          cap = cap.slice(0, cut);
          this.beats.unshift({ ms: (1400 + tail.length * 58) * this.set.read + 500, cap: tail.replace(/(\b[0-9A-F]{2,5}h\b)/g, '<b>$1</b>') });
        }
      }
      this.capHtml = over || cap.replace(/(\b[0-9A-F]{2,5}h\b)/g, '<b>$1</b>');
      const read = (1400 + String(cap).replace(/<[^>]+>/g, '').length * (quick ? 28 : 58)) * this.set.read;
      return Math.max(p.stepDur || 0, read) + (quick ? 150 : 500);
    }
    // The clock chip: its signals for this model (a timing diagram card).
    clockCard() {
      const e = this.board.decaps.get('clk'), part = e ? e.part : '8284A', f = this.mhz();
      const ns = v => Math.round(1000 / v);
      if (MODEL === '8086') return { kind: 'wave', title: 'CLOCK GENERATOR', chip: part, sub: `The crystal gives 14.318 MHz. The ${part} divides it by 3: CLK = ${f} MHz. One T state is one CLK period: ${ns(f)} ns.`,
        cols: ['CLK 1', 'CLK 2', 'CLK 3'], rows: [{ name: 'OSC', clk: true, per: 1 / 3, duty: 0.5 }, { name: 'CLK', clk: true, per: 1, duty: 1 / 3 }, { name: 'PCLK', clk: true, per: 2, duty: 0.5 }],
        caps: [[0, 'OSC: 3 periods of the crystal for each CLK period.'], [1, 'CLK: high 1/3 of the period, low 2/3.'], [2, 'PCLK = CLK ÷ 2, for the timer and the keyboard.']] };
      if (MODEL === '80286' || MODEL === '80386') return { kind: 'wave', title: 'CLOCK GENERATOR', chip: part, sub: `The ${part} gives CLK at ${2 * f} MHz. The ${CPU.name} divides it by 2 inside: one T state = two CLK periods = ${ns(f)} ns.`,
        cols: ['T', 'T', 'T'], rows: [{ name: 'CLK', clk: true, per: 0.5, duty: 0.5 }, { name: 'PHASE', clk: true, per: 1, duty: 0.5 }],
        caps: [[0, `CLK: ${2 * f} MHz.`], [1, `The CPU phase: ${f} MHz, one T state for each period.`]] };
      if (MODEL === '80686') return { kind: 'wave', title: 'CLOCK', chip: part, sub: `The bus clock is 66 MHz. The Pentium Pro multiplies it by 3 inside: the core runs at ${f} MHz (${ns(f)} ns for each clock).`,
        cols: ['BUS 1', 'BUS 2', 'BUS 3'], rows: [{ name: 'BCLK', clk: true, per: 1, duty: 0.5 }, { name: 'CORE', clk: true, per: 1 / 3, duty: 0.5 }],
        caps: [[0, 'BCLK: 66 MHz, the front-side bus.'], [1, `The core: 3 clocks for each bus clock (${f} MHz).`]] };
      return { kind: 'wave', title: 'CLOCK', chip: part, sub: `The clock chip gives CLK at ${f} MHz. The ${CPU.name} runs on this clock: one clock = ${ns(f)} ns.`,
        cols: ['CLK 1', 'CLK 2', 'CLK 3'], rows: [{ name: 'CLK', clk: true, per: 1, duty: 0.5 }],
        caps: [[0, `CLK: ${f} MHz. Each instruction takes a number of these clocks.`]] };
    }
    clockText() {
      const f = this.mhz(), e = this.board.decaps.get('clk'), part = e ? e.part : '8284A';
      const fact = MODEL === '8086' ? ` The crystal gives 14.318 MHz, and the <b>${part}</b> divides it by 3.`
        : MODEL === '80286' || MODEL === '80386' ? ` The <b>${part}</b> gives ${2 * f} MHz, and the ${CPU.name} divides it by 2 inside.`
          : MODEL === '80686' ? ' The bus clock is 66 MHz, and the Pentium Pro multiplies it by 3 inside.' : '';
      return `The <b>clock</b> keeps the time. Each part of a bus cycle (a <b>T state</b>) and each step of the CPU takes one or more clock periods. Here one clock is <b>${Math.round(1000 / f)} ns</b> (${f} MHz).${fact}`;
    }
    mhz() { const hz = this.app.machine.clockHz || 4772727; return +(hz / 1e6).toFixed(2); }
    // The letter on the screen: the camera goes to the monitor and the CGA card.
    screen() {
      this.board.xpFocus(['screenTL'], { theta: 0.08, phi: 1.42, keepY: true });
      setTimeout(() => this.chime(), 1400);
    }
    chime() {
      if (typeof Sfx === 'undefined' || !Sfx.on) return;
      Sfx.arrive('data'); setTimeout(() => Sfx.arrive('addr'), 160); setTimeout(() => Sfx.arrive('ctrl'), 320);
    }
    // ---------- the loop ----------
    loop() {
      if (!this.on) return;
      const now = animNow();
      if (this.vShow && now >= this.vShow.at) { this.vset(this.vShow.now); this.vShow = null; }
      this.unitCap();
      const over = !this.cur || now - this.bT0 >= this.bDur;
      if (!this.paused && over) {
        // with "wait for Next", a step stays on the screen until the viewer goes on
        if (this.set.wait && this.cur && this.cur.step !== undefined && !this.skip) { if (!this.waiting) { this.waiting = true; this.syncUi(); } }
        else { this.skip = false; this.waiting = false; this.next(now); }
      }
      this.syncProgress(now);
      this.raf = requestAnimationFrame(() => this.loop());
    }
    next(now) {
      if (!this.beats.length) {
        const P = this.program();
        if (this.chapter > P.list.length) { this.cur = { done: true }; this.bT0 = now; this.bDur = 1e12; this.syncUi(); return; }
        this.chapter++;
        this.beats = this.chapterBeats(this.chapter);
        this.ms = this.beats.slice(); this.mi = -1; this.vRec = null;
        this.buildMs();
      }
      const b = this.beats.shift();
      this.cur = b;
      const at = this.ms ? this.ms.indexOf(b) : -1;
      if (at >= 0) this.mi = at;           // (the second half of a long caption keeps its milestone)
      this.uSeg = null; this.quickStep = false;
      if (this.board && this.board.xpCard) { this.board.xpCard = null; this.board.showCard(null); }
      this.capHtml = b.cap || '';
      const d = b.run ? b.run() : 0;
      // the board draws the details of the dies of the next step ahead (no blur when it zooms in)
      const nb = this.beats.find(x => x.step !== undefined && !x.pending), p = this.app.play;
      if (nb && p && p.story && p.story.steps[nb.step] && this.board.xpPrefetch) this.board.xpPrefetch(p.story.steps[nb.step], this.app.stepMs, false);
      // the story step that is on the screen now (for Replay)
      if (this.app.play && this.app.play.si !== undefined && b.step !== undefined) this.last = { i: this.app.play.si, cap: this.capHtml };
      this.bT0 = animNow();
      this.bDur = b.ms || (typeof d === 'number' ? d : 3000);
      this.syncUi();
    }
    unhide() {
      if (this.vShow) { this.vset(this.vShow.now); this.vShow = null; }
      if (!this.vHide) return;
      const a = this.app;
      this.vset(this.vHide.now);
      this.vHide = null;
    }
    // ---------- the controls ----------
    buildUi() {
      const bd = this.board, P = this.program(), el = (tag, cls, parent, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; if (parent) parent.appendChild(e); return e; };
      const prog = el('div', 'xp3-prog', bd.root);
      prog.setAttribute('aria-label', 'The program');
      // the program strip: the chapters (the machine, each instruction with its bytes, the end)
      const chip = (cls, c, tip) => {
        const b = el('button', cls, prog);
        b.type = 'button'; b.title = tip; b.setAttribute('aria-label', tip);
        b.addEventListener('click', () => { this.go(c); if (this.paused) this.togglePause(); });
        return b;
      };
      const first = chip('xp3-card xp3-end', 0, 'The machine: a tour of the parts');
      first.textContent = 'The machine';
      const cards = P.list.map((ins, k) => {
        const c = chip('xp3-card', k + 1, `Instruction ${k + 1} at 1000:${hx(ins.ip, 4)}: ${ins.text}`);
        el('span', 'n', c, String(k + 1));
        el('code', null, c, ins.text);
        const xb = el('span', 'xb', c);
        for (const b of ins.bytes) { const i = el('i', null, xb, hx(b, 2)); i.style.background = ins.col; }
        return c;
      });
      const last = chip('xp3-card xp3-end', P.list.length + 1, 'The end: the summary');
      last.textContent = 'The end';
      const chips = [first, ...cards, last];
      const bar = el('section', 'xp3-bar', bd.root);
      bar.setAttribute('aria-label', 'Explain');
      const chap = el('span', 'xp3-chap', bar);
      const cap = el('p', 'xp3-cap', bar);
      cap.setAttribute('aria-live', 'polite');
      // the timing panel (opens above the controls)
      const setp = el('div', 'xp3-set', bar);
      setp.hidden = true;
      const slider = (label, key, min, max, step, hint) => {
        const w = el('label', 'xp3-sl', setp);
        const top = el('span', 'xp3-sl-top', w);
        el('span', null, top, label);
        const out = el('b', null, top);
        const r = el('input', null, w);
        r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = this.set[key];
        el('small', null, w, hint);
        const show = () => { out.textContent = `${(+r.value).toFixed(2).replace(/0$/, '')}×`; };
        r.addEventListener('input', () => { this.set[key] = +r.value; show(); this.saveSet(); });
        show();
        return r;
      };
      slider('Signal speed', 'travel', 0.25, 3, 0.25, 'How fast a value moves on the board and in a chip.');
      slider('Work time', 'work', 0.25, 3, 0.25, 'How long a unit works on a value (a card).');
      slider('Reading time', 'read', 0.5, 2.5, 0.25, 'How long each caption stays.');
      const wl = el('label', 'xp3-ck', setp), wc = el('input', null, wl);
      wc.type = 'checkbox'; wc.checked = !!this.set.wait;
      el('span', null, wl, 'Wait for Next after each step');
      wc.addEventListener('change', () => { this.set.wait = wc.checked; this.saveSet(); if (!wc.checked && this.waiting) this.goNext(); });
      el('small', 'xp3-keys', setp, 'Keys: Space = pause, → = next milestone, ← = the milestone before, R = replay the step, Esc = exit. Click a milestone to go to it.');
      const row = el('div', 'xp3-row', bar);
      const rp = el('button', 'xp3-btn', row, '⟲');
      rp.type = 'button'; rp.title = 'Replay the step (R)'; rp.setAttribute('aria-label', 'Replay the step');
      rp.addEventListener('click', () => this.replay());
      const back = el('button', 'xp3-btn', row, '◂ Back');
      back.type = 'button'; back.title = 'Back to the milestone before (←)';
      back.addEventListener('click', () => this.goBack());
      const play = el('button', 'xp3-btn main', row, 'Pause');
      play.type = 'button';
      play.addEventListener('click', () => this.togglePause());
      const nx = el('button', 'xp3-btn', row, 'Next ▸');
      nx.type = 'button'; nx.title = 'Go on to the next milestone (→)';
      nx.addEventListener('click', () => this.goNext());
      const msBox = el('div', 'xp3-ms', row);
      msBox.setAttribute('role', 'group'); msBox.setAttribute('aria-label', 'The milestones of this part');
      const sp = el('button', 'xp3-btn', row, '1×');
      sp.type = 'button'; sp.setAttribute('aria-label', 'Speed of all'); sp.title = 'Speed of all (the clock)';
      sp.addEventListener('click', () => { const S = [0.25, 0.5, 0.75, 1, 1.5, 2, 3]; this.setSpeed(S[(S.indexOf(this.speed) + 1) % S.length]); });
      const gear = el('button', 'xp3-btn', row, 'Timing');
      gear.type = 'button'; gear.setAttribute('aria-expanded', 'false');
      gear.addEventListener('click', () => { setp.hidden = !setp.hidden; gear.setAttribute('aria-expanded', String(!setp.hidden)); gear.classList.toggle('on', !setp.hidden); });
      const ex = el('button', 'xp3-btn', row, 'Exit');
      ex.type = 'button';
      ex.addEventListener('click', () => this.stop());
      this.ui = { prog, cards, bar, chap, cap, play, msBox, msEls: [], chips, sp, nx, back };
      const b = document.getElementById('btn-explain'); if (b) b.textContent = '✕ Explain';
      this.syncUi();
    }
    // Go on now (the rest of this beat is skipped).
    goNext() {
      if (!this.on) return;
      if (this.paused) this.togglePause();
      this.skip = true; this.waiting = false;
      this.bDur = 0;
    }
    // Play the story step on the screen again (the board puts the steps before it back).
    replay() {
      if (!this.on || !this.last || !this.app.play) return;
      if (this.paused) this.togglePause();
      const a = this.app, L = this.last;
      a.enterStep(L.i);
      this.capHtml = L.cap;
      this.bT0 = animNow();
      this.bDur = Math.max(a.play.stepDur || 0, 2000);
      this.waiting = false;
      this.syncUi();
    }
    key(e) {
      if (!this.on || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing && t.type !== 'range' && t.type !== 'checkbox') return;
      if (e.key === ' ' && !typing) { e.preventDefault(); e.stopPropagation(); this.togglePause(); }
      else if (e.key === 'ArrowRight' && !typing) { e.preventDefault(); e.stopPropagation(); this.goNext(); }
      else if (e.key === 'ArrowLeft' && !typing) { e.preventDefault(); e.stopPropagation(); this.goBack(); }
      else if ((e.key === 'r' || e.key === 'R') && !typing) { e.preventDefault(); e.stopPropagation(); this.replay(); }
      else if (e.key === 'Escape') this.stop();
    }
    saveSet() {
      try { localStorage.setItem('a86:xpSet', JSON.stringify(this.set)); } catch (e) { /* no storage */ }
      const bd = this.board;
      if (bd) bd.xpTime = { travel: this.set.travel, work: this.set.work, read: this.set.read };
    }
    setSpeed(v) {
      this.speed = v;
      this.set.speed = v; this.saveSet();
      if (!this.paused) AnimClock.setScale(v);
      if (this.ui) this.ui.sp.textContent = v + '×';
    }
    togglePause() {
      this.paused = !this.paused;
      AnimClock.setScale(this.paused ? 0 : this.speed);
      if (this.ui) this.ui.play.textContent = this.paused ? 'Play' : 'Pause';
    }
    card(k, done) {
      if (!this.ui) return;
      this.ui.cards.forEach((c, i) => { c.classList.toggle('on', i === k); if (done && i === k) c.classList.add('done'); if (k === -1) c.classList.remove('done'); });
    }
    syncUi() {
      const u = this.ui;
      if (!u) return;
      const P = this.program(), c = this.chapter;
      u.chap.textContent = c === 0 ? 'The machine' : c > P.list.length ? 'The end' : `Instruction ${c} of ${P.list.length}: `;
      if (c > 0 && c <= P.list.length) { const cd = document.createElement('code'); cd.textContent = P.list[c - 1].text; u.chap.appendChild(cd); }
      const M = this.ms || [], mb = M[this.mi];
      // (the number of the milestones is known when the instruction starts)
      if (mb && M.length > 1) { const sm = document.createElement('small'); sm.textContent = M.some(x => x.pending) ? mb.label || '' : `${mb.label || ''} · ${this.mi + 1} of ${M.length}`; u.chap.appendChild(sm); }
      this.syncMs();
      this.showCap();
      u.nx.classList.toggle('main', !!this.waiting);
      u.nx.textContent = this.waiting ? 'Next ▸ (waiting)' : 'Next ▸';
      u.chips.forEach((b, i) => { b.classList.toggle('cur', i === c); b.setAttribute('aria-current', i === c ? 'step' : 'false'); });
    }
    // One text for each unit: while a unit of a chip works, the caption tells what this unit does
    // (its chip, its name, its work now); the step goes to the short line above. The unit text stays
    // while the token is in the same chip; outside a chip the caption is the step again.
    unitCap() {
      const bd = this.board;
      if (!this.ui || !bd || !bd.xpNowUnit || !this.cur || this.cur.step === undefined || this.quickStep) { if (this.uSeg) { this.uSeg = null; this.showCap(); } return; }
      const g = bd.xpNowUnit();
      const want = g || (bd.trInDie && this.uSeg && bd.trChipKey && bd.trChipKey() === this.uSeg.dive.e.key ? this.uSeg : null);
      if (want !== this.uSeg) { this.uSeg = want; this.showCap(); }
    }
    showCap() {
      const u = this.ui;
      if (!u) return;
      const t = this.uSeg && this.board.xpUnitText ? this.board.xpUnitText(this.uSeg) : null;
      if (t && t.text) {
        const hexB = x => x.replace(/(\b[0-9A-F]{2,8}h\b)/g, '<b>$1</b>');
        u.cap.innerHTML = `<span class="xp3-unit">${t.chip} · ${t.unit}</span>${hexB(t.text)}`;
      } else u.cap.innerHTML = this.capHtml || '';
    }
    syncProgress(now) {
      if (!this.ui || !this.cur) return;
      const el = this.ui.msEls[this.mi];
      if (el) el.firstChild.style.width = (this.waiting ? 100 : 100 * Math.min(1, (now - this.bT0) / (this.bDur || 1))) + '%';
    }
    // ---------- the milestones: the sub-steps of the chapter (the viewer can go to each one) ----------
    buildMs() {
      const u = this.ui;
      if (!u) return;
      u.msBox.textContent = '';
      u.msEls = (this.ms || []).map((b, k) => {
        const e = document.createElement('button');
        e.type = 'button';
        e.appendChild(document.createElement('i'));
        const name = b.pending ? 'The steps of the instruction (they come after its start)' : b.label || `Part ${k + 1}`;
        e.title = `${k + 1}. ${name}`;
        e.setAttribute('aria-label', `Milestone ${k + 1} of ${this.ms.length}: ${name}`);
        if (b.pending) e.classList.add('wait');
        e.addEventListener('click', () => this.jump(k));
        u.msBox.appendChild(e);
        return e;
      });
      this.syncMs();
    }
    syncMs() {
      const u = this.ui;
      if (!u || !u.msEls) return;
      u.msEls.forEach((e, k) => {
        e.classList.toggle('done', k < this.mi);
        e.classList.toggle('on', k === this.mi);
        e.setAttribute('aria-current', k === this.mi ? 'step' : 'false');
        if (k !== this.mi) e.firstChild.style.width = '';
      });
    }
    // Go to milestone k of the chapter: its beat plays now, and the beats after it follow. The
    // screen shows the letter only after the write to the video memory.
    jump(k) {
      const M = this.ms || [], b = M[k];
      if (!this.on || !b) return;
      if (b.pending && k !== this.mi + 1) return;        // (the steps are not known yet)
      const a = this.app, steps = a.play && a.play.story ? a.play.story.steps : null;
      if (this.vRec) {
        const wk = M.findIndex(x => x.step === this.vRec.step);
        this.vShow = null;
        if (wk >= 0 && k > wk) { this.vset(this.vRec.now); this.vHide = null; }
        else { this.vset(this.vRec.old); this.vHide = Object.assign({}, this.vRec); }
      }
      // the captions of the later code fetches are short after the first one
      if (steps) this.firstFetch = this.chapter <= 1 && !M.slice(0, k).some(x => x.step !== undefined && !x.pending && steps[x.step] && steps[x.step].kind === 'bus' && steps[x.step].I && steps[x.step].I.kind === 'fetch' && steps[x.step].phase === 'data');
      this.beats = M.slice(k);
      this.waiting = false; this.skip = false;
      this.next(animNow());
    }
    goBack() {
      if (!this.on) return;
      if (this.mi > 0) { this.jump(this.mi - 1); return; }
      // at the first milestone: the chapter before, at its start
      if (this.chapter > 0) this.go(this.chapter - 1);
    }
  }
  return { Explain };
})();
