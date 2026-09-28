// App shell: assembles programs, boots the machine, and plays each instruction's
// micro-events on the views at the selected speed.

const SPEEDS = [
  { label: '¼ instr/s', mode: 'explain', ips: 0.25 },
  { label: '½ instr/s', mode: 'explain', ips: 0.5 },
  { label: '1 instr/s', mode: 'explain', ips: 1 },
  { label: '2 instr/s', mode: 'explain', ips: 2 },
  { label: '5 instr/s', mode: 'explain', ips: 5 },
  { label: '15 instr/s', mode: 'explain', ips: 15 },
  { label: '60 instr/s', mode: 'explain', ips: 60 },
  { label: '30 kHz', mode: 'fast', cps: 30000 },
  { label: '1 MHz', mode: 'fast', cps: 1000000 },
  { label: '4.77 MHz', mode: 'fast', cps: CPU_HZ },
];
const PROG_BASE = PROG_SEG << 4;
const VIEW_TABS = ['board', 'top', 'runner', 'die', 'timing', 'memory'];
// The tab bar has four tabs; the Board tab shows one of three views of the board (its modes).
const BOARD_MODES = ['board', 'top', 'runner'];
const MAIN_TABS = ['board', 'die', 'timing', 'memory'];
// Slow motion for the animations: 1x down to 1/64x (the emulator keeps its own speed). It is the
// left part of the speed slider: the slider value v < SLOW (10 for each stop) is slow motion at the
// slowest speed; v >= SLOW is the speed position v - SLOW (0..90) at 1x.
const MOTION = [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];
const MOTION_LABEL = ['1/64×', '1/32×', '1/16×', '⅛×', '¼×', '½×', '1×'];
const SLOW = (MOTION.length - 1) * 10;
// Trace mode: the explain speeds set the time of one step, not of one instruction.
const TRACE_MS = [4000, 2600, 1700, 1100, 650, 330, 150];
// (a step takes longer when its path is long: the signal moves at a steady speed)
const TRACE_LABEL = ['very slow', 'slower', 'slow', 'normal', 'fast', 'faster', 'fastest'];

class App {
  constructor() {
    this.model = CPU_MODEL;
    // is286: an AT-class machine (the 80286 or the 80386); is386: the 80386 model
    // is386 also on the 80486 and the Pentium (32-bit features); is486 only on the 80486 (its
    // cache views); is586 only on the Pentium
    this.is686 = CPU_MODEL === '80686';
    this.is586 = CPU_MODEL === '80586';
    this.is486 = CPU_MODEL === '80486';
    this.is386 = CPU_MODEL === '80386' || this.is486 || this.is586 || this.is686;
    this.is286 = CPU_MODEL === '80286' || this.is386;
    this.cpuAsm = this.is686 ? '686' : this.is586 ? '586' : this.is486 ? '486' : this.is386 ? '386' : this.is286 ? '286' : '8086';
    this.disOpts = this.is286 ? { cpu: this.cpuAsm } : undefined;
    this.video = typeof VIDEO_CARD !== 'undefined' && VIDEO_CARD === 'vga' && typeof VGA !== 'undefined' ? 'vga' : 'cga';
    this.machine = this.is686 && typeof Machine686 !== 'undefined' ? new Machine686({ video: this.video })
      : (this.is586 || this.is686) && typeof Machine586 !== 'undefined' ? new Machine586({ video: this.video })
      : (this.is486 || this.is586 || this.is686) && typeof Machine486 !== 'undefined' ? new Machine486({ video: this.video })
      : this.is386 && typeof Machine386 !== 'undefined' ? new Machine386({ video: this.video })
      : this.is286 && typeof Machine286 !== 'undefined' ? new Machine286({ video: this.video }) : new Machine({ video: this.video });
    this.handlers = {};
    this.mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = !!(this.mq && this.mq.matches);
    this.running = false;
    this.play = null;
    // the top speed is the real clock of this machine
    SPEEDS[SPEEDS.length - 1] = { label: `${+(this.machine.clockHz / 1e6).toFixed(2)} MHz`, mode: 'fast', cps: this.machine.clockHz };
    // the slider has 10 fine steps between two known speeds (the stops); see speedAt()
    this.speedPos = clamp(+storage.get('speedPos', clamp(storage.get('speed', 3), 0, SPEEDS.length - 1) * 10) || 0, 0, (SPEEDS.length - 1) * 10);
    if (this.reducedMotion && !storage.get('speedSet', false)) this.speedPos = 20;
    this.traceOn = storage.get('trace', true) !== false;
    this.spd = this.speedAt(this.speedPos);
    this.speedIdx = this.spd.idx;
    this.mode = this.spd.mode;
    this.program = null;
    this.tracePre = ['parallel', 'short', 'full', 'hide'].includes(storage.get('tracePre', 'parallel')) ? storage.get('tracePre', 'parallel') : 'parallel';
    // Repeats: 'once' = code that the trace showed a short time ago runs fast (loops, REP)
    this.traceRep = storage.get('traceRep', 'once') === 'all' ? 'all' : 'once';
    this.seen = new Map(); this.traceCount = 0;
    this.ff = null; this.ffNote = ''; this.ffBypass = false;
    this.bootMode = 'program';
    this.bootDrive = 'A';
    this.addrLine = new Map();
    this.lastStats = 0;
    this.fastMeter = { t: 0, cycles: 0, instr: 0, cps: 0 };
    this.audio = new SpeakerAudio();
    this.visible = !document.hidden;
    this.pip = null;
    this.views = {};   // monitorUi can resize before makeViews runs (a stored detached screen)
    this.buildRom();
    Tips.init(document);
    this.api = this.makeApi();
    this.ui();
    this.dock = new StateDock(this);
    this.crt = new CrtScreen(this.el('crt'), this.machine, () => { if (!this.running) this.pokeKeyboard(); });
    if (this.video === 'vga' && this.el('crt-title')) this.el('crt-title').innerHTML = 'VGA screen <small>A000 · B800</small>';
    this.monitorUi();
    this.machine.onSpeaker(hz => this.audio.setTone(this.toneOn() ? hz : 0));
    this.makeViews();
    this.decapUi();
    this.layoutUi();
    this.disks = new DiskPanel(this);
    this.explain = typeof Explain3D !== 'undefined' ? new Explain3D.Explain(this) : null;
    this.loadInitialProgram();
    this.syncUrl();
    // (&explain in the address: the guided story starts at once)
    if (typeof URL_PARAMS !== 'undefined' && URL_PARAMS.explain && this.explain) setTimeout(() => { if (!this.explain.on) this.explain.start(); }, 400);
    else this.startCard();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf(this.loop);
  }

  // Frames come from the pop-out window when the stage lives there (the main
  // window may be hidden then, and a hidden window gets no frames).
  raf(cb) { return (this.pip || window).requestAnimationFrame(cb); }
  // Find an element in this page or in the pop-out window.
  el(id) { return document.getElementById(id) || (this.pip ? this.pip.document.getElementById(id) : null); }

  makeApi() {
    const app = this;
    return {
      machine: this.machine,
      get model() { return app.model; },
      get video() { return app.video; },
      get reducedMotion() { return app.reducedMotion; },
      get mode() { return app.mode; },
      get running() { return app.running; },
      get clock() { return app.play ? app.play.clock : 0; },
      get crtCanvas() { return app.crt ? app.crt.fullCanvas : null; },
      get crtVersion() { return app.crt ? app.crt.version : 0; },
      select: (kind, id) => this.emit('select', { kind, id }),
      view: name => app.views[name],
      get motion() { return AnimClock.scale; },
      get tracing() { return app.traceActive(); },
      on: (name, cb) => { (this.handlers[name] = this.handlers[name] || []).push(cb); },
    };
  }
  emit(name, arg) { for (const cb of this.handlers[name] || []) cb(arg); }

  buildRom() {
    const r = Asm86.assemble(biosSource(this.model), { origin: 0 });
    if (!r.ok) {
      console.warn('BIOS assembly failed', r.errors);
      throw new Error('BIOS assembly failed: ' + r.errors.map(e => `line ${e.line}: ${e.msg}`).join('; '));
    }
    const rom = new Uint8Array(0x10000).fill(0xFF);
    rom.set(r.bytes.subarray(0, 0x10000));
    if (r.symbols.font8x8 !== undefined) rom.set(makeFont8x8(), r.symbols.font8x8);
    this.machine.setRom(rom, r.symbols);
    if (this.video === 'vga') {
      // the VGA video BIOS (option ROM at C000:0000) with fonts drawn from the page's font
      const v = makeVgaRom({ f8: makeVgaFont(8), f14: makeVgaFont(14), f16: makeVgaFont(16) });
      this.machine.setVgaRom(v.bytes);
      this.vgaSym = v.symbols;
    }
    this.biosLines = new Map(r.lineMap.map(e => [e.addr, e.line]));
    this.biosSrc = biosSource(this.model).split('\n');
  }

  // ---------- views ----------
  makeViews() {
    const defs = [['board', typeof BoardView !== 'undefined' ? BoardView : null],
      ['top', typeof TopView !== 'undefined' ? TopView : null],
      ['runner', typeof RunnerView !== 'undefined' ? RunnerView : null],
      ['die', typeof DieView !== 'undefined' ? DieView : null],
      ['timing', typeof TimingView !== 'undefined' ? TimingView : null],
      ['memory', typeof MemoryView !== 'undefined' ? MemoryView : null]];
    this.views = {};
    for (const [id, Cls] of defs) {
      const host = this.el('view-' + id);
      if (Cls) this.views[id] = new Cls(host, this.api);
      else htmlEl('p', { class: 'view-missing' }, host, 'This view is not available.');
    }
    this.activeTab = (typeof URL_PARAMS !== 'undefined' && URL_PARAMS.view) || storage.get('tab', 'board');
    if (!this.views[this.activeTab]) this.activeTab = 'board';
    this.selectTab(this.activeTab, false);
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(this.el('stage'));
    ro.observe(this.el('crt'));
  }
  eachView(fn) { for (const k in this.views) fn(this.views[k], k); }
  get activeView() { return this.views[this.activeTab]; }
  onResize() {
    this.crt.resize();
    this.crt.dirty = true;
    const v = this.activeView;
    if (v) v.resize();
    this.moveInk();
  }

  selectTab(id, focus) {
    const board = BOARD_MODES.includes(id), main = board ? 'board' : id;
    for (const t of VIEW_TABS) {
      const host = this.el('view-' + t), on = t === id;
      host.hidden = !on;
      if (this.views[t]) { if (on) { this.views[t].show(); this.views[t].resize(); } else this.views[t].hide(); }
    }
    for (const t of MAIN_TABS) {
      const tab = this.el('tab-' + t), on = t === main;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    }
    if (board) {
      this.boardMode = id;
      storage.set('boardMode', id);
      this.el('tab-board').setAttribute('aria-controls', 'view-' + id);
    }
    this.syncBoardModes();
    this.activeTab = id;
    storage.set('tab', id);
    this.syncUrl();
    const stage = this.el('stage');
    if (stage) stage.dataset.tab = id;
    if (focus) this.el('tab-' + main).focus();
    this.moveInk();
  }
  // The address of the page shows the machine, the card and the view, so the user can copy it as
  // a link (?cpu=80486&video=vga&view=die). No new history entry.
  syncUrl(cpu, video) {
    try {
      if (location.protocol === 'about:' || location.protocol === 'blob:') return;
      const q = new URLSearchParams(location.search);
      q.set('cpu', cpu || this.model);
      const v = video || this.video;
      if (v === 'vga') q.set('video', 'vga'); else q.delete('video');
      q.set('view', this.activeTab || 'board');
      q.delete('explain');
      history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
    } catch (e) { /* the browser does not allow it (a file, a sandbox) */ }
  }
  // The switch of the board views (3D, Top, Runner) goes to the left of the tool bar of the board
  // view that is open (each view gives its place: modeSlot).
  syncBoardModes() {
    const m = this.el('board-modes'), mode = this.boardMode || 'board', v = this.views[mode];
    if (!m) return;
    if (v && v.modeSlot && m.parentNode !== v.modeSlot) v.modeSlot.prepend(m);
    for (const b of m.querySelectorAll('button')) {
      const on = b.dataset.mode === mode;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
  }
  moveInk() {
    const tab = this.el('tab-' + (BOARD_MODES.includes(this.activeTab) ? 'board' : this.activeTab)), ink = this.el('tab-ink');
    if (!tab || !ink) return;
    ink.style.width = tab.offsetWidth - 16 + 'px';
    ink.style.transform = `translateX(${tab.offsetLeft + 8}px)`;
  }

  // ---------- UI wiring ----------
  ui() {
    this.drawBrand();
    this.modelUi();
    this.editor = new CodeEditor(this.el('code-input'), this.el('code-hl'), this.el('gutter'));
    this.editor.onChange = () => { storage.set('src', this.editor.value); this.setStatus('Edited. Press Assemble & load (Ctrl+Enter).', ''); };
    this.editor.onBreakpoint = () => this.syncBreakpoints();
    const sel = this.el('sample-select');
    // the samples of an older model also run on a newer one
    const older = { '80286': ['80286'], '80386': ['80286', '80386'], '80486': ['80286', '80386', '80486'], '80586': ['80286', '80386', '80486', '80586'], '80686': ['80286', '80386', '80486', '80586', '80686'] }[this.model] || [];
    this.samples = SAMPLES.filter(s => (!s.model || older.includes(s.model)) && (!s.video || s.video === this.video));
    for (const s of this.samples) htmlEl('option', { value: s.id }, sel, s.name);
    htmlEl('option', { value: 'custom' }, sel, 'Your program');
    sel.addEventListener('change', () => {
      const s = this.samples.find(x => x.id === sel.value);
      if (s) { this.editor.value = s.src; storage.set('src', s.src); storage.set('sample', s.id); this.assembleAndLoad(); }
      this.showDesc();
    });
    const $ = id => this.el(id);
    $('btn-assemble').addEventListener('click', () => this.assembleAndLoad());
    $('btn-run').addEventListener('click', () => this.toggleRun());
    $('btn-step').addEventListener('click', () => this.stepInstr());
    $('btn-clock').addEventListener('click', () => this.stepClock());
    $('btn-reset').addEventListener('click', () => this.boot());
    $('btn-import').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', e => this.importFile(e.target.files[0]));
    $('btn-export').addEventListener('click', () => this.exportFile());
    // (the help opens at its top: the title gets the focus, not the Close button at the bottom)
    $('btn-help').addEventListener('click', () => { const d = $('help'); if (d.showModal) { d.showModal(); d.scrollTop = 0; $('help-title').focus(); } });
    // the small menus of the top bar: the sound, and more run options
    const menus = [['btn-sound', 'sound-menu'], ['btn-opts', 'opts-menu']].map(([b, m]) => ({ b: $(b), m: $(m) }));
    const setMenu = (M, on) => { M.m.hidden = !on; M.b.setAttribute('aria-expanded', on ? 'true' : 'false'); };
    for (const M of menus) {
      M.b.addEventListener('click', () => { const on = M.m.hidden; for (const N of menus) setMenu(N, false); setMenu(M, on); });
      M.m.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(M, false); M.b.focus(); } });
    }
    document.addEventListener('pointerdown', e => { for (const M of menus) if (!M.m.hidden && !M.m.contains(e.target) && !M.b.contains(e.target)) setMenu(M, false); });
    // the machine sound (the speaker, the sound card); the icon shows it
    const snd = $('btn-sound'), osnd = $('opt-snd');
    const setSnd = on => {
      snd.classList.toggle('on', on);
      snd.setAttribute('aria-label', on ? 'Sound: the machine sound is on' : 'Sound: the machine sound is off');
      osnd.checked = on;
    };
    setSnd(this.audio.enabled);
    osnd.addEventListener('change', () => { this.audio.setEnabled(osnd.checked); setSnd(osnd.checked); });
    // the speed slider: slow motion at its left end, then the speeds
    const speed = $('speed');
    speed.max = SLOW + (SPEEDS.length - 1) * 10;
    this.motionIdx = clamp(storage.get('motion', MOTION.length - 1), 0, MOTION.length - 1);
    if (this.motionIdx < MOTION.length - 1) this.speedPos = 0;
    AnimClock.setScale(MOTION[this.motionIdx]);
    const slide = v => {
      if (v < SLOW) {
        // slow motion: the stops of MOTION, at the slowest speed
        this.setMotion(clamp(Math.round(v / 10), 0, MOTION.length - 1));
        this.setSpeedPos(0);
      } else { this.setMotion(MOTION.length - 1); this.setSpeedPos(v - SLOW); }
    };
    speed.addEventListener('input', () => slide(+speed.value));
    // Page Up / Page Down jump to the next known stop; the arrow keys move one fine step
    speed.addEventListener('keydown', e => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
      e.preventDefault();
      const v = this.motionIdx < MOTION.length - 1 ? this.motionIdx * 10 : SLOW + this.speedPos;
      slide(clamp((Math.round(v / 10) + (e.key === 'PageUp' ? 1 : -1)) * 10, 0, +speed.max));
    });
    this.setSpeedPos(this.speedPos, true);
    $('opt-boot').checked = storage.get('watchBoot', false);
    $('opt-boot').nextElementSibling.textContent = 'Watch BIOS boot';
    $('opt-boot').addEventListener('change', e => { storage.set('watchBoot', e.target.checked); this.boot(); });
    $('opt-follow').checked = storage.get('follow', true);
    $('opt-follow').addEventListener('change', e => { storage.set('follow', e.target.checked); this.emit('follow', e.target.checked); });
    this.traceUi();
    $('asm-errors').addEventListener('click', e => {
      const li = e.target.closest('li');
      if (li) this.editor.focusLine(+li.dataset.line);
    });
    // tabs (the Board tab opens the board view of the last choice)
    this.boardMode = BOARD_MODES.includes(storage.get('boardMode', 'board')) ? storage.get('boardMode', 'board') : 'board';
    const tabs = MAIN_TABS, nt = tabs.length, go = t => (t === 'board' ? this.boardMode || 'board' : t);
    tabs.forEach((t, i) => {
      const el = $('tab-' + t);
      el.addEventListener('click', () => this.selectTab(go(t)));
      el.addEventListener('keydown', e => {
        let j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % nt;
        else if (e.key === 'ArrowLeft') j = (i + nt - 1) % nt;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = nt - 1;
        if (j >= 0) { e.preventDefault(); this.selectTab(go(tabs[j]), true); }
      });
    });
    // the board views: a radio group (arrow keys move the choice)
    const modes = [...document.querySelectorAll('#board-modes button')];
    modes.forEach((b, i) => {
      b.addEventListener('click', () => this.selectTab(b.dataset.mode));
      b.addEventListener('keydown', e => {
        const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % modes.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + modes.length - 1) % modes.length : -1;
        if (j < 0) return;
        e.preventDefault();
        this.selectTab(modes[j].dataset.mode);
        modes[j].focus();
      });
    });
    // mobile sections
    document.querySelectorAll('.mobile-nav button').forEach(b => b.addEventListener('click', () => {
      document.body.dataset.mobileTab = b.dataset.tab;
      document.querySelectorAll('.mobile-nav button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      requestAnimationFrame(() => this.onResize());
    }));
    const ptabs = ['code', 'disks'];
    const selectPane = (id, focus) => {
      for (const t of ptabs) {
        const tab = $('ptab-' + t), on = t === id;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        $('panel-' + t).hidden = !on;
        if (on && focus) tab.focus();
      }
      storage.set('pane', id);
    };
    ptabs.forEach((t, i) => {
      $('ptab-' + t).addEventListener('click', () => selectPane(t));
      $('ptab-' + t).addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); selectPane(ptabs[1 - i], true); }
      });
    });
    selectPane(storage.get('pane', 'code'));
    document.addEventListener('keydown', e => this.shortcut(e));
    document.addEventListener('visibilitychange', () => {
      const was = this.visible;
      this.visible = !document.hidden || !!this.pip;
      if (this.visible && !was) { this.last = performance.now(); this.audio.resume(); this.raf(this.loop); }
      else if (!this.visible) this.audio.suspend();
    });
    if (this.mq && this.mq.addEventListener) this.mq.addEventListener('change', () => {
      this.reducedMotion = this.mq.matches;
      this.eachView(v => v.setReducedMotion(this.reducedMotion));
    });
    window.addEventListener('resize', () => this.moveInk());
  }

  // ---------- trace mode ----------
  // Each instruction plays as a list of steps (Story.build). One step moves one value
  // from one part of the machine to the next part. Next and Back move by one step.
  buildStory(events, opt) { return Story.build(events, opt || { prefetch: this.tracePre }); }
  traceActive() { return this.traceOn && this.mode === 'explain' && typeof Story !== 'undefined'; }
  get stepMs() { return this.spd.stepMs || TRACE_MS[clamp(this.speedIdx, 0, TRACE_MS.length - 1)]; }
  traceUi() {
    const $ = id => this.el(id);
    const opt = $('opt-trace');
    opt.checked = this.traceOn;
    opt.addEventListener('change', () => this.setTrace(opt.checked));
    $('trace-next').addEventListener('click', () => this.traceNext());
    $('trace-skip').addEventListener('click', () => this.traceSkip());
    const rp = $('trace-rep');
    rp.value = this.traceRep;
    rp.addEventListener('change', () => { this.traceRep = rp.value === 'all' ? 'all' : 'once'; storage.set('traceRep', this.traceRep); });
    $('trace-prev').addEventListener('click', () => this.tracePrev());
    const pre = $('trace-pre');
    pre.value = this.tracePre;
    pre.addEventListener('change', () => {
      this.tracePre = pre.value;
      storage.set('tracePre', pre.value);
      // the new setting starts with the next instruction
      this.announce('The prefetch setting changes from the next instruction.');
    });
    const ob = $('trace-opt'), op = $('trace-opts');
    const setOpt = on => { op.hidden = !on; ob.setAttribute('aria-expanded', on ? 'true' : 'false'); };
    ob.addEventListener('click', () => setOpt(op.hidden));
    document.addEventListener('pointerdown', e => { if (!op.hidden && !op.contains(e.target) && !ob.contains(e.target)) setOpt(false); });
    op.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setOpt(false); ob.focus(); } });
    const min = $('trace-min');
    const setMin = on => {
      $('trace').classList.toggle('trace-folded', on);
      min.setAttribute('aria-expanded', on ? 'false' : 'true');
      min.setAttribute('aria-label', on ? 'Show the step list' : 'Hide the step list');
    };
    // the step list is closed at first: the caption bar keeps the board free
    setMin(!storage.get('traceList', false));
    min.addEventListener('click', () => { const on = !$('trace').classList.contains('trace-folded'); setMin(on); storage.set('traceList', !on); });
    $('trace-list').addEventListener('click', e => {
      const li = e.target.closest('li[data-i]');
      if (li) this.traceGo(+li.dataset.i);
    });
    // tooltips for every part of the trace bar
    const tip = (id, text, label) => { const el = $(id); if (el && typeof setTip === 'function') setTip(el, text, label); };
    tip('trace-title', 'Trace mode: the instruction plays as steps. Each step moves one value from one part of the machine to the next part.', 'Trace');
    tip('trace-instr', 'The instruction that the CPU does now, as the disassembler shows it.', 'Instruction');
    tip('trace-lane', 'The unit that does this step. BIU: the bus interface unit fetches code and moves data on the bus. EU: the execution unit decodes and calculates. IRQ: an interrupt request. 8087 / 80287: the coprocessor.', 'Unit');
    tip('trace-stitle', 'The name of this step. T1, T2 and T3 are the clock states of a bus cycle: address, command, data.', 'Step');
    tip('trace-count', 'This step and the number of steps in the instruction.', 'Step count');
    tip('trace-text', 'What happens in this step, in full sentences.', 'Explanation');
    tip('trace-min', 'Show or hide the list of all the steps of this instruction. Click a step in the list to go to it.', 'Step list');
    tip('trace-opt', 'Trace options: how the trace shows the repeats of a loop, and the code fetches of the prefetch.', 'Trace options');
    tip('trace-prev', 'Back one step. Keys: B or comma. The picture goes back; the machine cannot run backward.', 'Back');
    tip('trace-next', 'Next step. Keys: N, period or Space. At the last step, the next instruction starts.', 'Next');
    tip('trace-skip', 'Skip: step over this instruction. A CALL, an INT or a loop runs fast, and the trace continues at the next instruction. Key: S.', 'Skip');
    tip('trace-rep-l', 'Repeats. Once: code that the trace showed a short time ago runs fast (the next pass of a loop, the next REP iteration). All: the trace shows every pass.', 'Repeats');
    tip('trace-pre-l', 'How to show the code fetches of the BIU: as 1 step, as 3 steps (address, command, data), or not at all.', 'Prefetch');
    tip('tg-trace', 'Trace: play each instruction as steps that you can follow one at a time. The speed slider sets the time of a step.', 'Trace');
    tip('btn-opts', 'More run options: follow the action, and watch the BIOS boot.', 'More options');
    tip('tg-sfx', 'Effects: small ticks and clicks when a signal arrives or a step starts. They start after your first click on the page.', 'Sound effects');
    const sfx = $('opt-sfx');
    if (sfx && typeof Sfx !== 'undefined') {
      sfx.checked = Sfx.on;
      sfx.addEventListener('change', () => { Sfx.set(sfx.checked); if (sfx.checked) Sfx.select(); });
    }
    this.syncTracePanel();
  }
  // Decap: open (or close) the packages of all chips on the 3D board.
  decapUi() {
    const opt = this.el('opt-decap'), b = this.views.board;
    if (!opt) return;
    opt.checked = !!storage.get('decap', false);
    // (the switch is the "Open chips" button of the 3D board)
    const sync = () => { if (b && b.decapBtn) b.decapBtn.setAttribute('aria-pressed', opt.checked ? 'true' : 'false'); };
    const apply = () => { if (b && b.ok) { if (opt.checked) b.decapAll(); else b.restoreAll(); } sync(); };
    opt.addEventListener('change', () => { storage.set('decap', opt.checked); apply(); });
    if (opt.checked) apply(); else sync();
  }
  setTrace(on) {
    this.traceOn = !!on;
    storage.set('trace', this.traceOn);
    if (this.play) this.finishInstr();
    this.eachView(v => { if (v.traceStep) v.traceStep(null); });
    this.setSpeedPos(this.speedPos, true);
    this.syncTracePanel();
  }
  syncTracePanel() {
    const t = this.el('trace');
    if (t) t.hidden = !this.traceActive();
    // (with the trace, Next and Skip step; the Instr button comes back without the trace. F8 stays.)
    const si = this.el('btn-step');
    if (si) si.hidden = this.traceActive();
    if (!this.play || !this.play.story) this.renderTrace(null);
  }
  // Next step. When the instruction has no more steps, the next instruction starts.
  traceNext() {
    if (!this.traceActive()) { this.stepInstr(); return; }
    if (this.running) this.pause();
    if (this.ff) {
      // Next during a fast run: stop it and trace the instruction where the CPU is now
      this.ffStop('Stopped. The trace continues here.');
      this.ffBypass = true;
      if (this.beginInstr(animNow(), null, false, true) && this.play) this.play.auto = false;
      return;
    }
    const p = this.play;
    if (p && p.story) {
      p.auto = false;
      if (p.si < p.story.steps.length - 1) { this.enterStep(p.si + 1); return; }
      this.finishInstr();
    } else if (p) this.finishInstr();
    if (this.beginInstr(animNow(), null, false, true) && this.play) this.play.auto = false;
  }
  // Code addresses: 16-bit IP, or 32-bit EIP in a 32-bit code segment of the 386; the linear
  // address goes through the paging unit (Machine386.physOf).
  codeMask() { const c = this.machine.cpu; return c.cache && c.cache[1] && c.cache[1].big ? 0xFFFFFFFF : 0xFFFF; }
  codeOpts() { return this.is386 ? { cpu: this.cpuAsm, bits: this.codeMask() === 0xFFFF ? 16 : 32 } : this.disOpts; }
  linPhys(lin) { const m = this.machine; return m.physOf ? m.physOf(lin >>> 0) : lin & (m.memSize - 1); }
  codePhys(ip, base = this.machine.csBase) { return this.linPhys(base + ((ip >>> 0) & this.codeMask())); }
  codeByte(ip, i) { const a = this.codePhys(ip + i); return a < 0 ? 0xFF : this.machine.peek8(a); }
  isSeen(phys) { const k = this.seen.get(phys); return k !== undefined && k > this.traceCount - 2000; }
  // Skip: step over the instruction of the trace (a CALL, an INT, the jump at the end of a
  // loop): run fast until the CPU gets to the instruction after it.
  traceSkip() {
    if (!this.traceActive() || this.ff) return;
    const m = this.machine, p = this.play;
    let target;
    if (p && p.nextPhys !== undefined) { target = p.nextPhys; this.finishInstr(); }
    else {
      const len = Disasm86.decode(i => this.codeByte(m.cpu.ip, i), m.cpu.ip, this.codeOpts()).len || 1;
      target = this.codePhys(m.cpu.ip + len);
      this.ffBypass = true;
      if (!this.beginInstr(animNow(), null, false, !this.running)) return;
      this.finishInstr();
    }
    if (m.physIP === target) {
      this.ffBypass = true;
      if (!this.running && this.beginInstr(animNow(), null, false, true) && this.play) this.play.auto = false;
      return;
    }
    this.startFF('skip', ip => ip === target);
  }
  startFF(why, until) {
    const m = this.machine;
    if (this.play) this.finishInstr();
    const here = m.cpu.repState ? this.codePhys(m.cpu.repState.start) : m.physIP;
    const lt = this.lastTraced && this.lastTraced.phys === here ? this.lastTraced.text : '';
    this.ff = { why, until, n: 0, t0: performance.now(), loops: 0, first: here, text: String(lt).split(';')[0].trim(), cx0: m.cpu.regs[1] };
    this.eachView(v => { if (v.traceStep) v.traceStep(null); });
    this.renderFF();
  }
  // One slice (about 12 ms) of the fast run. It stops at the condition, a breakpoint, a
  // halt with interrupts off, or after 20 million instructions.
  ffFrame() {
    const m = this.machine, cpu = m.cpu, f = this.ff;
    const t0 = performance.now();
    let reason = null;
    while (!reason && performance.now() - t0 < 12) {
      for (let k = 0; k < 2000; k++) {
        if (cpu.halted && !(cpu.f & 0x200) && !m.nmiLatch) { reason = 'halt'; break; }
        const c = cpu.step();
        m.tickDevices(c);
        f.n++;
        if (cpu.repState) continue;
        const ip = m.physIP;
        if (ip === f.first) f.loops++;
        if (f.until(ip)) { reason = 'done'; break; }
        if (m.breakpoints.has(ip)) { reason = 'break'; break; }
        if (f.n > 20000000) { reason = 'limit'; break; }
      }
    }
    if (!reason) { this.renderFF(); return; }
    const n = f.n.toLocaleString('en-US');
    const rep = /^rep/i.test(f.text);
    const reps = (f.cx0 - cpu.regs[1]) & 0xFFFF;
    const passes = f.why !== 'loop' ? '' : rep ? ` "${f.text}" repeated ${reps} more time${reps === 1 ? '' : 's'} without trace.` : ` The loop ran ${f.loops + 1} more time${f.loops ? 's' : ''}.`;
    this.ff = null;
    this.dock.sync(false);
    this.updateLine(true);
    if (reason === 'done') {
      this.ffNote = f.why === 'loop' ? (rep ? `Fast:${passes}` : `Fast: this code repeats, so ${n} instructions ran without trace.${passes}`) : `Skip: ${n} instructions ran without trace.`;
      this.ffBypass = f.why === 'skip';
      if (!this.running && this.beginInstr(animNow(), null, false, true) && this.play) this.play.auto = false;
      return;
    }
    this.pause();
    this.updateNow(null);
    const msg = reason === 'break' ? `Breakpoint. ${n} instructions ran fast.` : reason === 'halt' ? `The CPU is halted. ${n} instructions ran fast.` : `Stopped after ${n} instructions. The code did not leave the loop.`;
    this.ffNote = '';
    this.announce(msg);
    this.renderTrace(null);
    this.el('trace-text').textContent = msg;
  }
  ffStop(msg) {
    if (!this.ff) return;
    const n = this.ff.n.toLocaleString('en-US');
    this.ff = null;
    this.dock.sync(false);
    this.updateLine(true);
    this.ffNote = `${msg} ${n} instructions ran fast.`;
  }
  renderFF() {
    const f = this.ff, $ = id => this.el(id);
    if (!f || !$('trace-text')) return;
    $('trace-stitle').textContent = f.why === 'loop' ? 'Fast: repeated code' : 'Skip';
    $('trace-lane').textContent = 'FAST';
    $('trace-lane').className = 'trace-lane tl-ctrl';
    $('trace-count').textContent = '';
    $('trace-text').textContent = (f.why === 'loop' ? 'The trace showed this code a short time ago. It runs without trace until the CPU gets to new code: ' : 'The CPU runs without trace to the next instruction: ') +
      `${f.n.toLocaleString('en-US')} instructions. Push Next to stop and trace here.`;
    this.el('now-micro').textContent = `fast: ${f.n.toLocaleString('en-US')} instructions`;
  }
  tracePrev() {
    const p = this.play;
    if (this.running) this.pause();
    if (!p || !p.story) return;
    p.auto = false;
    if (p.si > 0) this.enterStep(p.si - 1, true);
    else this.announce('This is the first step. The CPU cannot go back to the previous instruction.');
  }
  traceGo(i) {
    const p = this.play;
    if (!p || !p.story || i === p.si || i < 0 || i >= p.story.steps.length) return;
    if (this.running) this.pause();
    p.auto = false;
    this.enterStep(i, i < p.si);
  }
  enterStep(i, back) {
    const p = this.play;
    p.si = i;
    p.stepT = animNow();
    const s = p.story.steps[i];
    if (!back) this.dispatchUntil(s.t);
    // the board sets the time of a step from the length of its path (a steady speed)
    const av = this.activeView, b = av && av.traceDur ? av : this.views.board;
    p.stepDur = b && b.traceDur ? b.traceDur(s, this.stepMs) : this.stepMs;
    const info = { ms: p.stepDur, back: !!back, auto: this.running || p.auto };
    this.eachView(v => { if (v.traceStep) v.traceStep(p.story, i, info); });
    if (typeof Sfx !== 'undefined') Sfx.step();
    this.renderTrace(p);
    this.el('now-micro').textContent = `step ${i + 1}/${p.story.steps.length} · ${s.lane} · ${s.title}`;
  }
  renderTrace(p) {
    const $ = id => this.el(id);
    const list = $('trace-list');
    if (!list) return;
    if (!p || !p.story) {
      $('trace-count').textContent = '';
      if (!p) { $('trace-instr').textContent = '—'; list.textContent = ''; this.traceList = null; }
      $('trace-lane').textContent = 'EU';
      $('trace-stitle').textContent = this.running ? 'Running' : 'Press Next or Run';
      $('trace-text').textContent = 'Each step moves one value from one part of the machine to the next part.';
      $('trace-prev').disabled = true;
      return;
    }
    const st = p.story, s = st.steps[p.si];
    $('trace-instr').textContent = st.text;
    $('trace-count').textContent = s ? `${p.si + 1} / ${st.steps.length}` : '';
    $('trace-prev').disabled = !s || p.si <= 0;
    if (this.traceList !== st) {
      this.traceList = st;
      list.textContent = '';
      st.steps.forEach((x, k) => {
        const li = htmlEl('li', { 'data-i': k, class: 'tl-' + x.token.col }, list);
        htmlEl('span', { class: 'tl-lane' }, li, x.lane);
        htmlEl('span', { class: 'tl-sum' }, li, x.sum);
      });
    }
    [...list.children].forEach((li, k) => {
      li.classList.toggle('tl-done', k < p.si);
      li.classList.toggle('tl-now', k === p.si);
      if (k === p.si) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    const cur = list.children[p.si];
    if (cur && !this.el('trace').classList.contains('trace-folded')) {
      const top = cur.offsetTop - list.offsetTop, bottom = top + cur.offsetHeight;
      if (top < list.scrollTop + 4 || bottom > list.scrollTop + list.clientHeight - 4) list.scrollTop = Math.max(0, top - list.clientHeight / 3);
    }
    if (!s) return;
    $('trace-lane').textContent = s.lane;
    $('trace-lane').className = 'trace-lane tl-' + s.token.col;
    $('trace-stitle').textContent = s.title;
    // after a fast run, the first step tells what ran fast
    if (this.ffNote && this.ffNoteFor !== st) { this.ffNoteFor = st; this.ffNoteText = this.ffNote; this.ffNote = ''; }
    $('trace-text').textContent = (this.ffNoteFor === st && p.si === 0 && this.ffNoteText ? this.ffNoteText + ' ' : '') + s.text;
  }

  // The CGA monitor floats on the stage; on narrow screens it moves into the dock.
  // Layout controls: hide the side panes, expand the stage, or pop it out.
  layoutUi() {
    const $ = id => this.el(id);
    const set = (cls, btn, on, labels) => {
      document.body.classList.toggle(cls, on);
      const b = $(btn);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? labels[1] : labels[0]);
    };
    const LBL = {
      code: ['Hide the program pane', 'Show the program pane'],
      dock: ['Hide the machine state dock', 'Show the machine state dock'],
      max: ['Expand the machine view to the whole window', 'Return the machine view to the page'],
    };
    this.toggleCode = on => {
      on = on === undefined ? !document.body.classList.contains('code-hidden') : on;
      set('code-hidden', 'btn-hide-code', on, LBL.code); storage.set('codeHidden', on);
      if (this.placeMonitor) this.placeMonitor();
      this.relayout();
    };
    this.toggleDock = on => {
      on = on === undefined ? !document.body.classList.contains('dock-hidden') : on;
      set('dock-hidden', 'btn-hide-dock', on, LBL.dock); storage.set('dockHidden', on); this.relayout();
    };
    this.toggleMax = on => {
      on = on === undefined ? !document.body.classList.contains('stage-max') : on;
      if (this.pip) on = false;
      set('stage-max', 'btn-max', on, LBL.max); this.relayout();
    };
    $('btn-hide-code').addEventListener('click', () => this.toggleCode());
    $('btn-hide-dock').addEventListener('click', () => this.toggleDock());
    $('btn-max').addEventListener('click', () => this.toggleMax());
    this.toggleCode(storage.get('codeHidden', false));
    this.toggleDock(storage.get('dockHidden', false));
    const pop = $('btn-popout');
    if (window.documentPictureInPicture) {
      pop.hidden = false;
      pop.addEventListener('click', () => { if (this.pip) this.pip.close(); else this.popOut(); });
    }
  }
  relayout() {
    this.onResize();
    setTimeout(() => this.onResize(), 60);
    setTimeout(() => { this.onResize(); this.crt.dirty = true; }, 380);
  }

  // Move the stage (views, tabs and screen) or only the screen into its own window,
  // for a second monitor. The browser allows one such window at a time.
  async popOut(kind = 'stage') {
    if (this.pip) return;
    const node = kind === 'stage' ? this.el('pane-stage') : this.el('monitor');
    const r = node.getBoundingClientRect();
    let win;
    try {
      win = await window.documentPictureInPicture.requestWindow(kind === 'stage'
        ? { width: Math.round(Math.max(640, r.width)), height: Math.round(Math.max(420, r.height)) }
        : { width: Math.round(Math.max(480, r.width)), height: Math.round(Math.max(360, r.width * 0.8)) });
    } catch (e) { this.announce('The browser did not open a new window.'); return; }
    this.toggleMax(false);
    for (const s of document.querySelectorAll('style')) win.document.head.appendChild(s.cloneNode(true));
    win.document.title = `${document.title} · ${kind === 'stage' ? 'machine' : 'screen'}`;
    win.document.documentElement.lang = 'en';
    win.document.body.className = kind === 'stage' ? 'pip' : 'pip-mon';
    let ph = null;
    if (kind === 'stage') {
      ph = document.createElement('div');
      ph.className = 'pip-placeholder';
      ph.innerHTML = '<p>The machine view is in its own window.</p><button type="button" class="btn btn-gold">Bring it back</button>';
      ph.querySelector('button').addEventListener('click', () => win.close());
      node.after(ph);
    } else {
      node.classList.remove('detached', 'min');
      node.style.left = node.style.top = node.style.width = '';
      node.classList.add('in-window');
    }
    win.document.body.appendChild(node);
    Tips.init(win.document);
    this.pip = win;
    const btn = this.el(kind === 'stage' ? 'btn-popout' : 'btn-mon-window');
    btn.setAttribute('aria-pressed', 'true');
    setTip(btn, kind === 'stage' ? 'Bring the machine view back to this page' : 'Bring the screen back to this page');
    win.addEventListener('keydown', e => this.shortcut(e));
    win.addEventListener('resize', () => this.onResize());
    win.addEventListener('pagehide', () => {
      if (ph) ph.replaceWith(node);
      else { document.body.appendChild(node); node.classList.remove('in-window'); this.setMonDetached(false); }
      this.pip = null;
      btn.setAttribute('aria-pressed', 'false');
      setTip(btn, kind === 'stage' ? 'Open the machine view in its own window' : 'Open the screen in its own window (for a second monitor)');
      this.visible = !document.hidden;
      if (this.visible) this.raf(this.loop);
      this.relayout();
    });
    this.relayout();
  }


  // The screen is at the bottom of the program pane (the program and its output together); when
  // that pane is hidden, it floats on the stage. It can be detached (a free window over the page,
  // moved by its title bar and resized at the corner), opened in its own window, or, on narrow
  // screens, placed in the dock.
  monitorUi() {
    const mon = this.el('monitor'), size = this.el('btn-mon-size'), min = this.el('btn-mon-min');
    const det = this.el('btn-mon-detach'), own = this.el('btn-mon-window'), grip = this.el('mon-grip');
    const head = mon.querySelector('.monitor-head');
    const setLarge = on => {
      mon.classList.toggle('large', on);
      this.crt.setFit(!on);
      size.setAttribute('aria-pressed', on ? 'true' : 'false');
      setTip(size, on ? 'Small screen: zoom to the text in use' : 'Large screen: all 80 × 25 characters',
        on ? 'Show a small screen' : 'Show a large screen');
      storage.set('monLarge', on);
    };
    const setMin = on => {
      mon.classList.toggle('min', on);
      min.setAttribute('aria-expanded', on ? 'false' : 'true');
      setTip(min, on ? 'Show the screen' : 'Hide the screen');
      min.innerHTML = on ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9"/></svg>'
        : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
      storage.set('monMin', on);
      requestAnimationFrame(() => this.onResize());
    };
    const vk = this.el('vkbd');
    this.el('btn-kbd').addEventListener('click', () => vk.focus());
    vk.addEventListener('input', () => { this.crt.typeText(vk.value); vk.value = ''; });
    vk.addEventListener('keydown', e => {
      const code = { Enter: 0x1C, Backspace: 0x0E, Escape: 0x01, Tab: 0x0F, ArrowUp: 0x48, ArrowDown: 0x50, ArrowLeft: 0x4B, ArrowRight: 0x4D }[e.key];
      if (code) { e.preventDefault(); this.machine.keyDown(code); this.machine.keyUp(code); if (!this.running) this.pokeKeyboard(); }
    });
    size.addEventListener('click', () => { setLarge(!mon.classList.contains('large')); setTimeout(() => this.onResize(), 480); });
    min.addEventListener('click', () => setMin(!mon.classList.contains('min')));

    // --- detach: position and width in px, kept inside the window
    const fit = () => {
      if (!mon.classList.contains('detached')) return;
      const w = Math.min(Math.max(280, mon.offsetWidth), window.innerWidth - 16);
      const x = clamp(parseFloat(mon.style.left) || 0, 8, window.innerWidth - w - 8);
      const y = clamp(parseFloat(mon.style.top) || 0, 8, Math.max(8, window.innerHeight - 60));
      mon.style.left = x + 'px'; mon.style.top = y + 'px';
    };
    const setDetached = on => {
      mon.classList.toggle('detached', on);
      det.setAttribute('aria-pressed', on ? 'true' : 'false');
      setTip(det, on ? 'Attach the screen to the machine view' : 'Detach: move and resize the screen anywhere',
        on ? 'Attach the screen' : 'Detach the screen');
      if (on) {
        document.body.appendChild(mon);
        const p = storage.get('monPos', null);
        const w = p ? p.w : Math.min(560, Math.round(window.innerWidth * 0.36));
        mon.style.width = w + 'px';
        mon.style.left = (p ? p.x : window.innerWidth - w - 24) + 'px';
        mon.style.top = (p ? p.y : 140) + 'px';
        fit();
      } else {
        mon.style.left = mon.style.top = mon.style.width = '';
        place();
      }
      storage.set('monDetached', on);
      this.relayout();
    };
    this.setMonDetached = setDetached;
    const save = () => storage.set('monPos', { x: parseFloat(mon.style.left), y: parseFloat(mon.style.top), w: mon.offsetWidth });
    const drag = (el, move) => el.addEventListener('pointerdown', e => {
      if (!mon.classList.contains('detached') || e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, x0 = parseFloat(mon.style.left), y0 = parseFloat(mon.style.top), w0 = mon.offsetWidth;
      mon.classList.add('dragging');
      el.setPointerCapture(e.pointerId);
      const mv = ev => { move(ev.clientX - sx, ev.clientY - sy, x0, y0, w0); };
      const up = () => {
        mon.classList.remove('dragging');
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        fit(); save(); this.onResize();
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    drag(head, (dx, dy, x0, y0) => {
      mon.style.left = clamp(x0 + dx, 8 - mon.offsetWidth + 80, window.innerWidth - 80) + 'px';
      mon.style.top = clamp(y0 + dy, 8, window.innerHeight - 40) + 'px';
    });
    drag(grip, (dx, dy, x0, y0, w0) => {
      mon.style.width = clamp(w0 + dx, 280, window.innerWidth - x0 - 8) + 'px';
      this.crt.resize();
    });
    det.addEventListener('click', () => setDetached(!mon.classList.contains('detached')));
    window.addEventListener('resize', fit);
    if (window.documentPictureInPicture) {
      own.hidden = false;
      own.addEventListener('click', () => { if (this.pip) this.pip.close(); else this.popOut('monitor'); });
    }

    const mq = window.matchMedia('(max-width: 900px)');
    const place = () => {
      const docked = mq.matches;
      if (docked && mon.classList.contains('detached')) { mon.classList.remove('detached'); mon.style.left = mon.style.top = mon.style.width = ''; }
      if (mon.classList.contains('detached') || mon.classList.contains('in-window')) return;
      mon.classList.toggle('docked', docked);
      const side = !docked && !document.body.classList.contains('code-hidden');
      mon.classList.toggle('side', side);
      if (docked) { mon.classList.remove('min', 'large'); this.el('dock').prepend(mon); }
      else if (side) { mon.classList.remove('large'); this.el('pane-code').appendChild(mon); }
      else { mon.classList.toggle('large', !!storage.get('monLarge', false)); this.el('stage').insertBefore(mon, this.el('now')); }
      this.crt.setFit(!mon.classList.contains('large'));
      requestAnimationFrame(() => this.onResize());
    };
    this.placeMonitor = place;
    if (mq.addEventListener) mq.addEventListener('change', place);
    setLarge(storage.get('monLarge', false));
    setMin(storage.get('monMin', false));
    place();
    if (!mq.matches && storage.get('monDetached', false)) setDetached(true);
  }

  // The start card: on the first visit, two clear ways in (the guided story, or an own program).
  // It covers only the view; a choice, Esc or a click outside closes it, and it does not come back.
  startCard() {
    // (not in the test tools: a browser under automation; #start in the address shows it again)
    if (location.hash !== '#start' && (storage.get('startSeen', false) || navigator.webdriver || window.matchMedia('(max-width: 900px)').matches)) return;
    const stage = this.el('stage');
    const card = htmlEl('section', { class: 'start-card', role: 'dialog', 'aria-labelledby': 'start-title' }, stage);
    htmlEl('h2', { id: 'start-title' }, card, 'See how a PC runs a program');
    htmlEl('p', null, card, `This page emulates a real PC (now the ${this.model === '80586' ? 'Pentium' : this.model === '80686' ? 'Pentium Pro' : this.model} machine) and shows each signal on the board and inside the chips.`);
    const row = htmlEl('div', { class: 'start-row' }, card);
    const go = htmlEl('button', { type: 'button', class: 'start-btn start-main' }, row);
    htmlEl('b', null, go, '▶ Watch the guided story');
    htmlEl('span', null, go, 'A short program, one step at a time, with a caption for each step.');
    const own = htmlEl('button', { type: 'button', class: 'start-btn' }, row);
    htmlEl('b', null, own, 'Write and run a program');
    htmlEl('span', null, own, 'Use the editor at the left, then press Run, or Next for one step.');
    htmlEl('p', { class: 'start-fine' }, card, 'Click the title to choose another machine. The ? button opens the help.');
    const close = () => {
      if (!card.isConnected) return;
      card.remove(); storage.set('startSeen', true);
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onOut, true);
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const onOut = e => { if (!card.contains(e.target)) close(); };
    go.addEventListener('click', () => { close(); const b = this.el('btn-explain'); if (b) b.click(); });
    this.el('btn-explain').addEventListener('click', close);
    own.addEventListener('click', () => { close(); this.el('code-input').focus(); });
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => document.addEventListener('pointerdown', onOut, true), 0);
    setTimeout(() => go.focus({ preventScroll: true }), 50);
  }

  // The model selector at the title: the page reloads with the other machine.
  modelUi() {
    const btn = this.el('brand-btn'), menu = this.el('model-menu');
    const items = [...menu.querySelectorAll('.model-item')];
    const video = typeof VIDEO_CARD !== 'undefined' ? VIDEO_CARD : 'cga';
    const name = this.is686 ? 'Pentium Pro' : this.is586 ? 'Pentium' : this.is486 ? '80486' : this.is386 ? '80386' : this.is286 ? '80286' : '8086', fpu = this.is486 || this.is586 || this.is686 ? 'FPU' : this.is386 ? '80387' : this.is286 ? '80287' : '8087';
    this.el('brand-sub').textContent = this.is686 ? 'a live Pentium Pro computer (out-of-order µops, register renaming, L2 in the package)' : this.is586 ? 'a live Pentium computer (two pipes, branch prediction, two caches)' : this.is486 ? 'a live 80486DX computer (FPU and cache on the chip)' : `a live ${name} + ${fpu} computer`;
    this.el('brand-title').textContent = `${name} Anatomy`;
    document.title = `${name} Anatomy`;
    this.el('help-title').textContent = `How to use ${name} Anatomy`;
    document.querySelectorAll('.cpu-name').forEach(e => { e.textContent = name; });
    document.querySelectorAll('.fpu-name').forEach(e => { e.textContent = fpu; });
    document.querySelectorAll('.die-sub').forEach(e => { e.textContent = `${name} + ${fpu}`; });
    this.el('card-sys').hidden = !this.is286;
    items.forEach(it => it.setAttribute('aria-checked',
      (it.dataset.model ? it.dataset.model === this.model : it.dataset.video === video) ? 'true' : 'false'));
    this.el('brand-sub').textContent += video === 'vga' ? ' with VGA' : '';
    const open = on => {
      menu.hidden = !on;
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) (items.find(i => i.getAttribute('aria-checked') === 'true') || items[0]).focus();
    };
    btn.addEventListener('click', () => open(menu.hidden));
    document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) open(false); });
    menu.addEventListener('keydown', e => {
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { open(false); btn.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    });
    items.forEach(it => it.addEventListener('click', () => {
      open(false);
      if (it.dataset.video) {
        if (it.dataset.video === video) return;
        storage.set('video', it.dataset.video);
        this.syncUrl(null, it.dataset.video);   // (the address wins at the load: it must say the new card)
      } else {
        if (it.dataset.model === this.model) return;
        storage.set('cpu', it.dataset.model);
        this.syncUrl(it.dataset.model, null);
      }
      this.pause();
      document.body.classList.add('switching');
      setTimeout(() => location.reload(), this.reducedMotion ? 0 : 320);
    }));
  }

  drawBrand() {
    const svg = this.el('brand-mark');
    // a tiny 40-pin DIP package with a gold lid, then the stroke lettering
    const g = svgEl('g', { transform: 'translate(2 3)' }, svg);
    for (let i = 0; i < 6; i++) {
      svgEl('rect', { class: 'pin', x: 3 + i * 4.2, y: 0, width: 2, height: 3, rx: .5 }, g);
      svgEl('rect', { class: 'pin', x: 3 + i * 4.2, y: 27, width: 2, height: 3, rx: .5 }, g);
    }
    svgEl('rect', { x: 0, y: 3, width: 30, height: 24, rx: 2.5, fill: THEME.ceramic, stroke: THEME.ceramicHi }, g);
    svgEl('rect', { x: 8, y: 9, width: 14, height: 12, rx: 1.5, fill: 'none', stroke: THEME.gold, 'stroke-width': 1.4 }, g);
    svgEl('path', { d: 'M0 13a2 2 0 0 1 0 4', fill: 'none', stroke: THEME.void, 'stroke-width': 1.2 }, g);
    const word = (this.is686 ? 'PENTIUM PRO' : this.is586 ? 'PENTIUM' : this.is486 ? '80486' : this.is386 ? '80386' : this.is286 ? '80286' : '8086') + ' ANATOMY';
    const d = strokeTextPath(word, 44, 8, 20, 1.6);
    svgEl('path', { class: 'glow', d, fill: 'none', 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    const ink = svgEl('path', { class: 'ink', d, fill: 'none', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    const w = 44 + strokeTextWidth(word, 20, 1.6) + 4;
    svg.setAttribute('viewBox', `0 0 ${w.toFixed(0)} 36`);
    if (!this.reducedMotion && ink.getTotalLength) {
      const L = ink.getTotalLength();
      ink.style.strokeDasharray = L;
      ink.style.strokeDashoffset = L;
      ink.getBoundingClientRect();
      ink.style.transition = 'stroke-dashoffset 2.2s cubic-bezier(.4,.1,.2,1)';
      requestAnimationFrame(() => { ink.style.strokeDashoffset = 0; });
    }
  }

  showDesc() {
    const sel = this.el('sample-select');
    const s = this.samples.find(x => x.id === sel.value);
    this.el('sample-desc').textContent = s ? s.desc : 'Your own program. It loads at 1000:0100 like a .COM file.';
  }

  shortcut(e) {
    if (e.target && e.target.id === 'crt') return;   // keys go to the emulated keyboard
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || (e.target && e.target.id === 'crt');
    if (e.key === 'F5') { e.preventDefault(); this.toggleRun(); }
    else if (e.key === 'F8' && e.shiftKey) { e.preventDefault(); this.stepClock(); }
    else if (e.key === 'F8') { e.preventDefault(); this.stepInstr(); }
    else if (e.key === 'F9') { e.preventDefault(); this.editor.toggleBreakpoint(this.editor.cursorLine()); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.assembleAndLoad(); }
    else if ((e.key === 'r' || e.key === 'R') && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); this.boot(); }
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-6]$/.test(e.key)) {
      this.selectTab(VIEW_TABS[+e.key - 1]);
    }
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && this.traceActive() && (e.key === '.' || e.key === 'n' || e.key === 'N' || (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A' && tag !== 'SUMMARY'))) { e.preventDefault(); this.traceNext(); }
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && this.traceActive() && (e.key === ',' || e.key === 'b' || e.key === 'B')) { e.preventDefault(); this.tracePrev(); }
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && this.traceActive() && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.traceSkip(); }
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '[') this.toggleCode();
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === ']') this.toggleDock();
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F')) this.toggleMax();
    else if (e.key === 'Escape' && document.body.classList.contains('stage-max') && !document.querySelector('dialog[open]')) this.toggleMax(false);
  }

  setStatus(text, cls) {
    const s = this.el('asm-status');
    s.textContent = text;
    s.className = 'asm-status' + (cls ? ' ' + cls : '');
  }
  announce(text) { this.el('live').textContent = text; }

  // ---------- program loading ----------
  loadInitialProgram() {
    const sel = this.el('sample-select');
    const saved = storage.get('src', null), sid = storage.get('sample', 'hello');
    const sample = this.samples.find(s => s.id === sid);
    if (saved && (!sample || saved !== sample.src)) { this.editor.value = saved; sel.value = 'custom'; }
    else { this.editor.value = (sample || this.samples[0]).src; sel.value = (sample || this.samples[0]).id; }
    this.showDesc();
    this.assembleAndLoad();
  }
  assembleAndLoad() {
    const src = this.editor.value;
    const r = Asm86.assemble(src, { origin: 0x100, cpu: this.cpuAsm });
    const list = this.el('asm-errors');
    list.innerHTML = '';
    this.editor.setErrors(r.errors || []);
    if (!r.ok) {
      for (const e of r.errors.slice(0, 20)) {
        const li = htmlEl('li', { 'data-line': e.line }, list);
        htmlEl('b', null, li, `line ${e.line}: `);
        li.appendChild(document.createTextNode(e.msg));
      }
      this.setStatus(`${r.errors.length} error${r.errors.length > 1 ? 's' : ''}. The old program stays loaded.`, 'bad');
      return false;
    }
    this.program = r;
    this.bootMode = 'program';
    this.addrLine = new Map(r.lineMap.map(e => [PROG_BASE + e.addr, e.line]));
    this.setStatus(`${r.bytes.length} bytes at 1000:${hex4(r.origin)} · ${Object.keys(r.symbols).length} symbols`, 'ok');
    this.boot();
    return true;
  }
  syncBreakpoints() {
    const bp = this.machine.breakpoints;
    bp.clear();
    if (!this.program) return;
    const map = this.program.lineMap;
    for (const line of this.editor.breakpoints) {
      const e = map.find(x => x.line >= line && x.len > 0);
      if (e) bp.add(PROG_BASE + e.addr);
    }
  }

  // Power on: reset every chip, load the program, run the BIOS.
  boot() {
    this.pause();
    this.play = null;
    this.ff = null; this.ffNote = '';
    this.seen.clear();
    this.renderTrace(null);
    const m = this.machine;
    m.reset();
    const disk = this.bootMode === 'disk';
    if (disk) this.editor.setCurrent(0);
    // the boot drive for INT 19h (40:F6h = 80h: drive C: first; the POST keeps this byte)
    if (disk) m.pokeMem(0x4F6, [this.bootDrive === 'C' ? 0x80 : 0]);
    if (this.program && !disk) {
      m.loadProgram(this.program.bytes, this.program.origin);
      const ip = this.program.origin;
      // pokeMem: the 80486 cache also gets the new bytes
      m.pokeMem(0x4F0, [ip & 0xFF, ip >> 8, PROG_SEG & 0xFF, PROG_SEG >> 8, 0x86]);
    }
    this.syncBreakpoints();
    const watch = this.el('opt-boot').checked;
    if (!watch) {
      // Run the BIOS at full speed until the program's first instruction.
      let guard = 0;
      const arrived = () => disk ? m.physIP === 0x7C00 : m.cpu.sregs[1] === PROG_SEG;
      while (!arrived() && guard < 4000000) {
        const c = m.cpu.step();
        m.tickDevices(c);
        guard += c;
        if (m.cpu.halted && !(m.cpu.f & 0x200)) break;
      }
    }
    m.takeStats();
    this.eachView(v => v.reset());
    this.dock.sync(false);
    this.crt.dirty = true;
    this.crt.fitCols = 40; this.crt.fitRows = 10;
    this.updateLine(true);
    this.updateNow(null);
    this.emit('reset');
    this.announce(watch ? 'Reset. The CPU waits at FFFF:0000.' : disk ? 'The boot sector is loaded at 0000:7C00.' : 'Program loaded. The CPU waits at its first instruction.');
  }

  // Boot the disk in drive A: (or the hard disk C:: drive = 'C') and run it at the real speed
  // of the machine.
  bootDisk(drive = 'A') {
    if (drive === 'C' ? !this.machine.hdisk : !this.machine.disks[0]) return;
    this.bootMode = 'disk';
    this.bootDrive = drive;
    this.addrLine = new Map();
    this.boot();
    if (this.spd.mode !== 'fast') this.setSpeed(SPEEDS.length - 1);
    this.start();
    document.body.dataset.mobileTab = 'machine';
    document.querySelectorAll('.mobile-nav button').forEach(x => x.setAttribute('aria-pressed', x.dataset.tab === 'machine' ? 'true' : 'false'));
    requestAnimationFrame(() => { this.onResize(); this.el('crt').focus(); });
    this.announce(`Booting from drive ${drive}:. The screen has the keyboard focus.`);
  }

  importFile(file) {
    if (!file) return;
    file.text().then(t => {
      this.editor.value = t;
      storage.set('src', t);
      this.el('sample-select').value = 'custom';
      this.showDesc();
      this.assembleAndLoad();
    });
  }
  exportFile() {
    const blob = new Blob([this.editor.value], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'program.asm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- run control ----------
  // The speed at a slider position: the known speeds (stops) at 0, 10, 20 ...; between two
  // stops of the same kind the speed changes on a log scale. Near a stop the slider snaps
  // to it; between two kinds (instructions per second and clock rate) it takes the nearer stop.
  speedAt(pos) {
    const n = SPEEDS.length - 1;
    pos = clamp(Math.round(pos), 0, n * 10);
    const near = Math.round(pos / 10);
    if (Math.abs(pos - near * 10) <= 1) pos = near * 10;
    let i0 = Math.min(Math.floor(pos / 10), n), f = (pos - i0 * 10) / 10;
    const A = SPEEDS[i0], B = SPEEDS[Math.min(i0 + 1, n)];
    if (f && A.mode !== B.mode) { if (f >= 0.5) i0++; f = 0; pos = i0 * 10; }
    const S = SPEEDS[i0], geo = (a, b) => a * Math.pow(b / a, f);
    const tm = i => TRACE_MS[clamp(i, 0, TRACE_MS.length - 1)];
    const fmtIps = v => `${v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v)} instr/s`;
    const fmtHz = v => (v >= 1e6 ? (v / 1e6).toFixed(2) + ' MHz' : Math.round(v / 1e3) + ' kHz');
    if (!f) return { pos, idx: i0, mode: S.mode, ips: S.ips, cps: S.cps, stepMs: tm(i0), label: this.traceOn && S.mode === 'explain' ? TRACE_LABEL[i0] : S.label };
    if (A.mode === 'explain') {
      const ips = geo(A.ips, B.ips);
      return { pos, idx: Math.round(pos / 10), mode: 'explain', ips, stepMs: geo(tm(i0), tm(i0 + 1)), label: this.traceOn ? `${TRACE_LABEL[i0]} +${Math.round(f * 10)}` : fmtIps(ips) };
    }
    const cps = geo(A.cps, B.cps);
    return { pos, idx: Math.round(pos / 10), mode: 'fast', cps, label: fmtHz(cps) };
  }
  setSpeed(i, silent) { this.setSpeedPos(i * 10, silent); }
  // Slow motion (the left part of the speed slider): the index in MOTION.
  setMotion(i) {
    if (i === this.motionIdx) return;
    this.motionIdx = i;
    AnimClock.setScale(MOTION[i]);
    storage.set('motion', i);
  }
  setSpeedPos(pos, silent) {
    const s = this.spd = this.speedAt(pos);
    this.speedPos = s.pos;
    this.speedIdx = s.idx;
    const i = s.idx;
    const prev = this.mode;
    this.mode = s.mode;
    const out = this.el('speed-out'), rng = this.el('speed');
    const slow = this.motionIdx !== undefined && this.motionIdx < MOTION.length - 1;
    const label = slow ? `slow motion ${MOTION_LABEL[this.motionIdx]}` : s.label;
    out.textContent = label;
    out.classList.toggle('slowmo', slow);
    const rv = slow ? this.motionIdx * 10 : SLOW + s.pos;
    if (+rng.value !== rv) rng.value = rv;
    rng.setAttribute('aria-valuetext', label);
    if (!silent) { storage.set('speedPos', s.pos); storage.set('speed', i); storage.set('speedSet', true); }
    this.audio.setTone(this.toneOn() ? this.machine.lastTone : 0);
    if (prev !== this.mode) {
      if (this.play) this.finishInstr();
      this.eachView(v => { if (v.traceStep) v.traceStep(null); });
      this.emit('mode', this.mode);
      if (this.mode !== 'fast' && this.dock) this.dock.sync(false);
    }
    this.syncTracePanel();
  }
  speedLabel() { return this.spd.label; }
  toggleRun() {
    if (this.ff && this.running) { this.ffStop('Stopped.'); this.pause(); return; }
    if (this.running) this.pause(); else this.start();
  }
  get realTime() { return this.spd.cps === this.machine.clockHz; }
  // The simple tone follows the 8253 at fast speeds below real time; real time uses samples.
  toneOn() { return this.mode === 'fast' && this.running && !this.realTime; }
  start() {
    const m = this.machine;
    if (m.cpu.halted && !(m.cpu.f & 0x200)) { this.announce('The CPU is halted. Reset to run again.'); return; }
    this.running = true;
    document.body.classList.add('running');
    this.el('run-label').textContent = 'Pause';
    this.el('btn-run').setAttribute('aria-label', 'Pause');
    this.fastMeter = { t: performance.now(), cycles: m.cpu.cycles, instr: m.cpu.instructions, cps: 0 };
    this.audio.setTone(this.toneOn() ? m.lastTone : 0);
    this.startCycle = m.cpu.cycles;
  }
  pause() {
    if (!this.running) return;
    this.running = false;
    document.body.classList.remove('running');
    this.el('run-label').textContent = 'Run';
    this.el('btn-run').setAttribute('aria-label', 'Run');
    this.audio.setTone(0);
    if (this.mode === 'fast') { this.dock.sync(false); this.updateLine(true); this.updateNow(null); }
  }
  stepInstr() {
    if (this.running) this.pause();
    if (this.play) {
      this.finishInstr();
      // In trace mode, Instr plays all the steps of the next instruction, then stops.
      if (!this.traceActive()) return;
    }
    this.beginInstr(animNow(), null, false, true);
  }
  stepClock() {
    if (this.running) this.pause();
    const now = animNow();
    if (!this.play) {
      if (!this.beginInstr(now, 400, true)) return;
      this.dispatchUntil(0);
      this.updateClockCaption();
      return;
    }
    if (this.play.story) {
      // clock steps leave the trace for the rest of this instruction
      this.play.story = null;
      this.eachView(v => { if (v.traceStep) v.traceStep(null); });
      this.renderTrace(this.play);
    }
    if (!this.play.manual) { this.play.manual = true; this.play.clockMs = 400; }
    this.play.clock = Math.floor(this.play.clock) + 1;
    this.dispatchUntil(this.play.clock);
    this.updateClockCaption();
    if (this.play.clock >= this.play.cycles) this.finishInstr();
  }
  updateClockCaption() {
    const p = this.play;
    if (!p) return;
    const c = Math.min(p.clock, p.cycles);
    this.el('now-micro').textContent = `clock ${Math.floor(c)} / ${p.cycles}` + (p.lastCaption ? ' · ' + p.lastCaption : '');
  }

  // Skip idle HLT time (waiting for an interrupt) without animation.
  skipHalt() {
    const m = this.machine;
    let n = 0;
    while (m.cpu.halted && n < 3000000) {
      if (!(m.cpu.f & 0x200) && !m.nmiLatch) return false;
      const c = m.cpu.step();
      m.tickDevices(c);
      n += c;
    }
    return !m.cpu.halted;
  }

  // Execute one instruction now and start its playback.
  beginInstr(now, clockMs, manual, single) {
    const m = this.machine;
    if (m.cpu.halted) {
      if (!this.skipHalt()) {
        this.pause();
        this.updateNow(null);
        this.announce('The CPU is halted.');
        this.el('now-micro').textContent = m.cpu.f & 0x200 ? 'waiting for an interrupt' : 'halted (interrupts off)';
        return false;
      }
    }
    const trace = this.traceActive() && !manual;
    // code that the trace showed a short time ago (a loop, the next REP pass) runs fast
    // during a REP, IP already points to the next instruction: the REP starts at repState.start
    const here = m.cpu.repState ? this.codePhys(m.cpu.repState.start) : m.physIP;
    if (trace && this.traceRep === 'once' && !this.ffBypass && this.isSeen(here)) {
      this.startFF('loop', ip => !this.isSeen(ip));
      return false;
    }
    this.ffBypass = false;
    const ip0 = m.cpu.ip, base0 = m.csBase, phys0 = here;
    const { cycles, events } = m.step();
    if (trace) this.seen.set(phys0, ++this.traceCount);
    const dec0 = events.find(e => e.k === 'decode');
    this.lastTraced = { phys: phys0, text: dec0 ? dec0.text : '' };
    if (clockMs === null) {
      // in trace mode the events arrive at the start of each step; this pace is for the other views
      if (trace) clockMs = clamp(this.stepMs / 4, 20, 250);
      else clockMs = single ? clamp(1300 / cycles, 6, 140) : clamp((1000 / this.spd.ips) / cycles, 0.6, 250);
      if (this.reducedMotion) clockMs = Math.max(clockMs, 8);
    }
    const dec = events.find(e => e.k === 'decode');
    this.play = { events, idx: 0, cycles, clockMs, start: now, manual, clock: 0, text: dec ? dec.text : '', cs: dec ? dec.cs : 0, ip: dec ? dec.ip : 0, lastCaption: '',
      story: trace ? this.buildStory(events) : null, si: -1, stepT: now, auto: !!single };
    if (dec) this.play.nextPhys = this.codePhys(ip0 + (dec.len || 0), base0);
    const info = { cycles, clockMs, text: this.play.text, cs: this.play.cs, ip: this.play.ip, trace };
    this.eachView(v => v.instr(events, info));
    this.updateNow(this.play);
    const phys = ((this.play.cs << 4) + this.play.ip) & 0xFFFFF;
    this.markLine(phys, true);
    if (trace) {
      if (this.play.story.steps.length) this.enterStep(0);
      else this.renderTrace(this.play);
    }
    return true;
  }
  dispatchUntil(t) {
    const p = this.play;
    if (!p) return;
    const ev = p.events;
    while (p.idx < ev.length && ev[p.idx].t <= t) {
      const e = ev[p.idx++];
      this.dock.event(e);
      for (const k in this.views) this.views[k].event(e, p.clockMs);
      const cap = caption(e);
      if (cap) { p.lastCaption = cap; if (!p.manual) this.el('now-micro').textContent = cap; }
    }
  }
  finishInstr() {
    const p = this.play;
    if (!p) return;
    this.dispatchUntil(Infinity);
    this.play = null;
    this.dock.sync(false);
    this.updateLine(!this.running || this.mode !== 'fast');
    if (!this.running) {
      const regs = p.events.filter(e => e.k === 'reg' && e.r !== 'IP').map(e => `${e.r} = ${hex4(e.v)}`).join(', ');
      this.announce(`${p.text}${regs ? '. ' + regs : ''}`);
    }
    const m = this.machine;
    if (this.running && m.breakpoints.has(m.physIP) && !m.cpu.repState) { this.pause(); this.announce('Breakpoint.'); }
    if (m.cpu.halted && !(m.cpu.f & 0x200) && !m.nmiLatch) this.pause();
    else if (this.running) this.stuck();
  }

  // A jump to itself with interrupts off: nothing can wake the CPU. Stop and say so.
  stuck() {
    const m = this.machine, c = m.cpu, a = m.physIP;
    if ((c.f & 0x200) || m.nmiLatch || c.repState || m.peek8(a) !== 0xEB || m.peek8(a + 1) !== 0xFE) return false;
    this.pause();
    this.dock.sync(false);
    this.updateNow(null);
    const where = `${hex4(c.sregs[1])}:${hex4(c.ip)}`;
    this.el('now-micro').textContent = `stuck: JMP $ with interrupts off at ${where}`;
    this.announce(`The CPU is stuck at ${where}: a jump to itself with interrupts off, so no interrupt can end it. ` +
      'Reset the machine. If a program on a disk does this at boot, edit CONFIG.SYS or AUTOEXEC.BAT in the Disks tab.');
    this.setStatus(`Stopped: the CPU is in an endless loop at ${where} (JMP $, interrupts off).`, 'bad');
    return true;
  }

  // ---------- main loop ----------
  loop(now) {
    if (!this.visible) return;
    const dt = Math.min(this.running && this.mode === 'fast' ? 250 : 100, now - this.last);
    this.last = now;
    // Views and the instruction playback run on the animation clock (slow motion).
    const vnow = animNow(), vdt = dt * AnimClock.scale;
    if (this.ff) this.ffFrame();
    else if (this.running && this.mode === 'fast') this.fastFrame(dt, now);
    else if (this.running || (this.play && !this.play.manual)) this.explainFrame(vnow);
    this.crt.frame(now);
    this.disks.frame();
    if (!(this.running && this.mode === 'fast')) { this.machine.takeSpeaker(); this.machine.takeSound(); }
    const v = this.activeView;
    if (v) v.frame(vnow, vdt);
    if (now - this.lastStats > 90) { this.lastStats = now; this.updateStats(now); }
    this.raf(this.loop);
  }
  explainFrame(now) {
    if (!this.play) {
      if (!this.running) return;
      if (!this.beginInstr(now, null, false)) return;
    }
    const p = this.play;
    if (p.manual) return;
    if (p.story) {
      if (!this.running && !p.auto) return;
      const n = p.story.steps.length;
      if (now - p.stepT < (n ? p.stepDur || this.stepMs : this.stepMs * 0.4)) return;
      if (p.si < n - 1) { this.enterStep(p.si + 1); return; }
      this.finishInstr();
      return;
    }
    const t = (now - p.start) / p.clockMs;
    this.dispatchUntil(t);
    if (t >= p.cycles) {
      this.finishInstr();
      // Keep a fast pace smooth: start the next instruction in the same frame.
      if (this.running && this.mode === 'explain' && this.spd.ips >= 15 && !this.play) this.beginInstr(now, null, false);
    }
  }
  fastFrame(dt, now) {
    const m = this.machine, s = this.spd;
    // The sound card makes its OPL2 samples at each register write only while they play.
    m.audioOn = this.realTime && this.audio.enabled;
    m.audioRate = this.audio.rate;
    let budget = Math.max(200, Math.round(s.cps * dt / 1000));
    const t0 = performance.now(), c0 = m.cpu.cycles;
    let reason = 'budget';
    while (budget > 0) {
      const chunk = Math.min(budget, 20000);
      reason = m.run(chunk);
      budget -= chunk;
      if (reason !== 'budget' || performance.now() - t0 > 40) break;
    }
    let sample = null;
    if (reason === 'budget' && !m.cpu.halted) {
      const st = m.step();
      sample = st.events;
      if (m.breakpoints.has(m.physIP) && !m.cpu.repState) reason = 'break';
    }
    const sp = m.takeSpeaker();
    if (this.realTime) this.audio.pcm(sp, c0, m.cpu.cycles, m.clockHz);
    const snd = m.takeSound();
    if (this.realTime) this.audio.card(snd);
    const stats = this.fastStats(sample);
    this.eachView(v => v.fast(stats));
    if (now - (this.lastDock || 0) > 120) { this.lastDock = now; this.dock.sync(false); this.updateLine(false); this.updateNow(null, sample); }
    if (reason === 'budget' && this.stuck()) return;
    if (reason === 'break') { this.pause(); this.updateLine(true); this.announce('Breakpoint.'); }
    else if (reason === 'halt') { this.pause(); this.announce('The program ended. The CPU is halted.'); }
  }
  fastStats(sample) {
    const m = this.machine, now = performance.now(), fm = this.fastMeter;
    if (now - fm.t > 400) {
      fm.cps = (m.cpu.cycles - fm.cycles) * 1000 / (now - fm.t);
      fm.ips = (m.cpu.instructions - fm.instr) * 1000 / (now - fm.t);
      fm.t = now; fm.cycles = m.cpu.cycles; fm.instr = m.cpu.instructions;
    }
    return { cps: fm.cps || 0, ips: fm.ips || 0, bus: m.takeStats(), sample };
  }

  // ---------- read-outs ----------
  markLine(phys, reveal) {
    const line = this.addrLine.get(phys);
    this.editor.setCurrent(line || 0, reveal && this.el('opt-follow').checked);
  }
  updateLine(reveal) { this.markLine(this.machine.physIP, reveal); }
  updateNow(p, sample) {
    const m = this.machine, c = m.cpu;
    const addr = this.el('now-addr'), text = this.el('now-text'), micro = this.el('now-micro');
    if (p) {
      addr.textContent = `${hex4(p.cs)}:${hex4(p.ip)}`;
      text.textContent = p.text;
      return;
    }
    const dec = sample && sample.find(e => e.k === 'decode');
    if (dec && this.running) {
      addr.textContent = `${hex4(dec.cs)}:${hex4(dec.ip)}`;
      text.textContent = dec.text;
      micro.textContent = `${(this.fastMeter.cps / 1e6).toFixed(2)} MHz effective`;
      return;
    }
    addr.textContent = `${hex4(c.sregs[1])}:${hex4(c.ip)}`;
    if (typeof Disasm86 !== 'undefined') {
      const cs = c.sregs[1], ip = c.ip;
      const base = m.csBase;
      text.textContent = 'next: ' + Disasm86.decode(i => this.codeByte(ip, i), ip, this.codeOpts()).text;
    }
    micro.textContent = c.halted ? (c.f & 0x200 ? 'HLT: waiting for an interrupt' : 'halted') : (c.sregs[1] === 0xF000 || c.sregs[1] === 0xFFFF ? 'in the BIOS ROM' : '');
  }
  updateStats() {
    const c = this.machine.cpu;
    this.el('st-csip').textContent = `${hex4(c.sregs[1])}:${hex4(c.ip)}`;
    this.el('st-cycles').textContent = c.cycles.toLocaleString('en-US');
    this.el('st-instr').textContent = c.instructions.toLocaleString('en-US');
    let sp = '—';
    if (this.running) {
      if (this.mode === 'fast') sp = this.fastMeter.cps >= 1e6 ? (this.fastMeter.cps / 1e6).toFixed(2) + ' MHz' : Math.round(this.fastMeter.cps / 1000) + ' kHz';
      else sp = this.speedLabel();
    }
    this.el('st-speed').textContent = sp;
  }
  pokeKeyboard() {
    // A key while paused: let the machine take the IRQ at once so that the result shows.
    const m = this.machine;
    if (m.cpu.halted && (m.cpu.f & 0x200)) {
      let n = 0;
      while (n < 400000) { const c = m.cpu.step(); m.tickDevices(c); n += c; if (!m.cpu.halted && m.cpu.sregs[1] === PROG_SEG) break; }
      this.dock.sync(false);
      this.updateLine(true);
      this.updateNow(null);
    }
  }
}

// A one-line description of a micro-event for the caption strip.
function caption(e) {
  switch (e.k) {
    case 'fetch': return `BIU prefetch ${hex5(e.addr)} → queue (${e.q.length}/${CPU_MODEL === '80686' || CPU_MODEL === '80586' || CPU_MODEL === '80486' ? 32 : CPU_MODEL === '80386' ? 16 : 6})`;
    case 'bus': {
      const who = e.owner === 'fpu' ? '8087 ' : '';
      if (e.type === 'memr') return `${who}memory read [${hex5(e.addr)}] = ${e.width === 2 ? hex4(e.data) : hex2(e.data)}`;
      if (e.type === 'memw') return `${who}memory write [${hex5(e.addr)}] ← ${e.width === 2 ? hex4(e.data) : hex2(e.data)}`;
      if (e.type === 'ior') return `I/O read port ${hex(e.addr, 2)}h = ${hex2(e.data)}`;
      if (e.type === 'iow') return `I/O write port ${hex(e.addr, 2)}h ← ${hex2(e.data)}`;
      if (e.type === 'inta') return 'interrupt acknowledge (INTA) bus cycle';
      return e.type;
    }
    case 'ea': return `EA ${e.seg}:${hex4(e.off)} = ${hex4(e.segv)}0h + ${hex4(e.off)}h = ${hex5(e.phys)}`;
    case 'alu': {
      const f = e.w === 16 ? hex4 : hex2;
      return `ALU ${e.op} ${f(e.a)}, ${f(e.b)} → ${f(e.r)}`;
    }
    case 'int': return `INT ${hex2(e.vec)}h (${{ sw: 'software', irq: 'hardware IRQ', nmi: 'NMI', exc: 'exception' }[e.src] || e.src})`;
    case 'fpu': return `8087 ${e.text}`;
    case 'queue': return e.op === 'flush' ? 'queue flushed: the jump discards prefetched bytes' : null;
    default: return null;
  }
}

function startApp() {
  if (!document.body.dataset.mobileTab) document.body.dataset.mobileTab = 'machine';
  try {
    window.__app = new App();
  } catch (err) {
    console.error(err);
    const s = document.getElementById('asm-status');
    if (s) { s.textContent = 'Start-up failed: ' + err.message; s.className = 'asm-status bad'; }
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
else startApp();
