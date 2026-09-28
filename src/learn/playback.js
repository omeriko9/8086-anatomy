// Playback: the engine of the old page (src/ui/app.js) without its DOM. It assembles a program,
// boots the machine through the BIOS, runs one instruction at a time into micro-events, builds the
// story of each instruction (Story.build) and plays the steps; fast paths fold loops, calls and the
// end of a program. Every sink of the old page is an event here (section 7.3 of the design):
//   reset · instr(events, info) · event(e, clockMs) · caption(text) · step(story, i, info) ·
//   instrEnd(x) · ff(state) · ffEnd(x) · fast(stats) · audio(spk, snd) · speed · mode ·
//   traceClear · status(text, cls) · announce(text)
// Globals it needs: Asm86 Disasm86 biosSource Machine* Story PROG_SEG AnimClock animNow splitLead
// clamp hex2 hex4 hex5 CPU_HZ. No document, no window: Node loads it for the checker.

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
// Slow motion for the animations: 1x down to 1/64x (the emulator keeps its own speed).
const MOTION = [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];
// Trace mode: the explain speeds set the time of one step, not of one instruction.
const TRACE_MS = [4000, 2600, 1700, 1100, 650, 330, 150];
const TRACE_LABEL = ['very slow', 'slower', 'slow', 'normal', 'fast', 'faster', 'fastest'];

class Playback {
  // opts: { model, cpuAsm, video, tracePre, traceBurst, traceRep, reducedMotion, durOf, sliceMs, sliceInstrs }
  constructor(machine, opts = {}) {
    this.machine = machine;
    this.model = opts.model || (typeof CPU_MODEL !== 'undefined' ? CPU_MODEL : '8086');
    this.is686 = this.model === '80686';
    this.is586 = this.model === '80586';
    this.is486 = this.model === '80486';
    this.is386 = this.model === '80386' || this.is486 || this.is586 || this.is686;
    this.is286 = this.model === '80286' || this.is386;
    this.cpuAsm = opts.cpuAsm || (this.is686 ? '686' : this.is586 ? '586' : this.is486 ? '486' : this.is386 ? '386' : this.is286 ? '286' : '8086');
    this.disOpts = this.is286 ? { cpu: this.cpuAsm } : undefined;
    this.video = opts.video || machine.video || 'cga';
    this.handlers = {};
    this.reducedMotion = !!opts.reducedMotion;
    this.running = false;
    this.play = null;
    SPEEDS[SPEEDS.length - 1] = { label: `${+(machine.clockHz / 1e6).toFixed(2)} MHz`, mode: 'fast', cps: machine.clockHz };
    this.speedPos = opts.speedPos === undefined ? 20 : opts.speedPos;   // stop 2: 1 instr/s, 1700 ms a step
    this.traceOn = true;
    this.spd = this.speedAt(this.speedPos);
    this.speedIdx = this.spd.idx;
    this.mode = this.spd.mode;
    this.motionIdx = MOTION.length - 1;
    this.program = null;
    this.tracePre = ['parallel', 'short', 'full', 'hide'].includes(opts.tracePre) ? opts.tracePre : 'parallel';
    this.traceBurst = opts.traceBurst === 'all' ? 'all' : 'fold';
    // 'once': code the trace showed a short time ago runs fast (the old page); 'all': never (Lesson)
    this.traceRep = opts.traceRep === 'all' ? 'all' : 'once';
    this.seen = new Map(); this.traceCount = 0;
    this.ff = null; this.ffNote = ''; this.ffBypass = false;
    this.bootMode = 'program';
    this.bootDrive = 'A';
    this.addrLine = new Map();
    this.fastMeter = { t: 0, cycles: 0, instr: 0, cps: 0 };
    this.lastDock = 0; this.lastFast = 0;
    // the time of a step: the Stage's durOf(s, ms) (limitStops, then the board's traceDur)
    this.durOf = opts.durOf || ((s, ms) => ms);
    this.sliceMs = opts.sliceMs || 12;
    this.sliceInstrs = opts.sliceInstrs || 200000;
    this.silent = false;            // the dry pass: no events reach the views
    this.breakLines = new Set();
    this.runToJob = null;
  }

  // ---------- events ----------
  on(name, cb) {
    (this.handlers[name] = this.handlers[name] || []).push(cb);
    return () => { const l = this.handlers[name] || []; const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); };
  }
  emit(name, ...args) {
    if (this.silent && name !== 'status') return;
    const l = this.handlers[name];
    if (!l) return;
    for (const cb of l.slice()) cb(...args);
  }
  status(text, cls) { this.emit('status', text, cls || ''); }
  announce(text) { this.emit('announce', text); }

  // ---------- program ----------
  // The BIOS ROM (assembled from bios.js) with its symbols, so machine.biosSym is filled.
  buildRom(o = {}) {
    const r = Asm86.assemble(biosSource(this.model), { origin: 0 });
    if (!r.ok) throw new Error('BIOS assembly failed: ' + r.errors.map(e => `line ${e.line}: ${e.msg}`).join('; '));
    const rom = new Uint8Array(0x10000).fill(0xFF);
    rom.set(r.bytes.subarray(0, 0x10000));
    if (r.symbols.font8x8 !== undefined && o.makeFont8x8) rom.set(o.makeFont8x8(), r.symbols.font8x8);
    this.machine.setRom(rom, r.symbols);
    let vgaRom = null;
    if (this.video === 'vga' && typeof makeVgaRom === 'function') {
      const mf = o.makeVgaFont || (() => null);
      vgaRom = makeVgaRom(o.makeVgaFont ? { f8: mf(8), f14: mf(14), f16: mf(16) } : null);
      this.machine.setVgaRom(vgaRom.bytes);
    }
    this.biosLines = new Map(r.lineMap.map(e => [e.addr, e.line]));
    return { rom, symbols: r.symbols, vgaRom };
  }
  assemble(src) {
    const r = Asm86.assemble(src, { origin: 0x100, cpu: this.cpuAsm });
    if (!r.ok) this.status(`${r.errors.length} error${r.errors.length > 1 ? 's' : ''}. The old program stays loaded.`, 'bad');
    return r;
  }
  load(program) {
    this.program = program;
    this.bootMode = 'program';
    this.addrLine = new Map(program.lineMap.map(e => [PROG_BASE + e.addr, e.line]));
    this.status(`${program.bytes.length} bytes at 1000:${hex4(program.origin)} · ${Object.keys(program.symbols || {}).length} symbols`, 'ok');
  }
  setBreakpoints(lines) {
    this.breakLines = new Set(lines || []);
    this.syncBreakpoints();
  }
  syncBreakpoints() {
    const bp = this.machine.breakpoints;
    bp.clear();
    if (!this.program) return;
    for (const line of this.breakLines) {
      const e = this.program.lineMap.find(x => x.line >= line && x.len > 0);
      if (e) bp.add(PROG_BASE + e.addr);
    }
  }
  lineOf(phys) { return this.addrLine.get(phys) || 0; }

  // Power on: reset every chip, load the program, run the BIOS to the program's first instruction.
  boot(o = {}) {
    this.pause();
    this.play = null;
    this.ff = null; this.ffNote = '';
    this.seen.clear();
    this.runToJob = null;
    const m = this.machine;
    m.reset();
    const disk = o.disk ? true : false;
    this.bootMode = disk ? 'disk' : 'program';
    this.bootDrive = o.drive || 'A';
    if (disk) m.pokeMem(0x4F6, [this.bootDrive === 'C' ? 0x80 : 0]);
    if (this.program && !disk) {
      m.loadProgram(this.program.bytes, this.program.origin);
      const ip = this.program.origin;
      m.pokeMem(0x4F0, [ip & 0xFF, ip >> 8, PROG_SEG & 0xFF, PROG_SEG >> 8, 0x86]);
    }
    this.syncBreakpoints();
    if (!o.watchBios) {
      let guard = 0;
      const arrived = () => (disk ? m.physIP === 0x7C00 : m.cpu.sregs[1] === PROG_SEG);
      while (!arrived() && guard < 4000000) {
        const c = m.cpu.step();
        m.tickDevices(c);
        guard += c;
        if (m.cpu.halted && !(m.cpu.f & 0x200)) break;
      }
    }
    m.takeStats();
    this.emit('reset');
    this.announce(o.watchBios ? 'Reset. The CPU waits at FFFF:0000.' : disk ? 'The boot sector is loaded at 0000:7C00.' : 'Program loaded. The CPU waits at its first instruction.');
  }

  // ---------- fast runs to a place (runTo) ----------
  // where: { instr: n } (the n-th instruction of the program, 0 = the first) | { label } |
  // { text } (the next instruction whose disassembly starts so) | { bios: name } | { ip } |
  // 'halt' | a function (physIP, machine) => boolean.
  whereFn(where) {
    const m = this.machine;
    if (typeof where === 'function') return where;
    if (where === 'halt') return (ip, mm) => mm.cpu.halted && !(mm.cpu.f & 0x200);
    if (where === 'program') return (ip, mm) => mm.cpu.sregs[1] === PROG_SEG && !mm.cpu.halted;
    if (where === 'wake') return (ip, mm) => !mm.cpu.halted;
    if (where === 'iret') return (ip, mm) => this.textAt(mm).toLowerCase().startsWith('iret');
    if (!where || typeof where !== 'object') return () => true;
    if (where.instr !== undefined) {
      const n = where.instr, st = { count: 0 };
      // counts the instructions executed in the program segment
      return (ip, mm, before) => { if (before) { if (mm.cpu.sregs[1] === PROG_SEG && !mm.cpu.halted) return st.count >= n; return false; } st.count++; return false; };
    }
    if (where.label !== undefined) {
      const sym = this.program && this.program.symbols ? this.program.symbols[where.label] : undefined;
      if (sym === undefined) throw new Error(`no label "${where.label}" in the program`);
      const phys = PROG_BASE + (typeof sym === 'number' ? sym : sym.addr || 0);
      return ip => ip === phys;
    }
    if (where.ip !== undefined) { const phys = PROG_BASE + where.ip; return ip => ip === phys; }
    if (where.bios !== undefined) {
      const sym = m.biosSym ? m.biosSym[where.bios] : undefined;
      if (sym === undefined) throw new Error(`no BIOS symbol "${where.bios}"`);
      const phys = 0xF0000 + (typeof sym === 'number' ? sym : sym.addr || 0);
      return ip => ip === phys;
    }
    if (where.text !== undefined) { const t = String(where.text).toLowerCase(); return (ip, mm) => this.textAt(mm).toLowerCase().startsWith(t); }
    if (where.instrs !== undefined) { const st = { n: 0 }; return () => ++st.n >= where.instrs; }
    return () => true;
  }
  textAt(m) {
    const c = m.cpu;
    try { return Disasm86.decode(i => this.codeByte(c.ip, i), c.ip, this.codeOpts()).text || ''; } catch (e) { return ''; }
  }
  // One slice of a raw run: cpu.step() + tickDevices until the predicate holds, the slice budget
  // ends (ms of wall time or raw steps), the CPU halts with interrupts off, or the clock budget
  // is spent. Returns 'done' | 'more' | 'halt' | 'limit'.
  runSlice(job) {
    const m = this.machine, cpu = m.cpu, t0 = performance.now();
    let steps = 0;
    for (;;) {
      // the predicate sees the state before the step ({ instr } counts program instructions)
      if (job.until(m.physIP, m, true)) return 'done';
      if (cpu.halted && !(cpu.f & 0x200) && !m.nmiLatch) return job.until(m.physIP, m) ? 'done' : 'halt';
      const c = cpu.step();
      m.tickDevices(c);
      job.instrs++; job.clocks += c;
      if (cpu.repState) { if (++steps >= this.sliceInstrs || performance.now() - t0 >= this.sliceMs) return 'more'; continue; }
      if (job.until(m.physIP, m)) return 'done';
      if (job.clocks > job.budget) return 'limit';
      if (++steps >= this.sliceInstrs || performance.now() - t0 >= this.sliceMs) return 'more';
    }
  }
  newJob(where, budget) { return { until: this.whereFn(where), instrs: 0, clocks: 0, budget: budget || 4000000, t0: performance.now(), lastFast: 0 }; }
  // Node and the checker: the same run in one call.
  runToSync(where, budget) {
    const job = this.newJob(where, budget);
    let r;
    do { r = this.runSlice(job); } while (r === 'more');
    if (r === 'limit') throw new Error(`runTo: more than ${job.budget} clocks (${job.instrs} instructions)`);
    return { instrs: job.instrs, clocks: job.clocks, reason: r };
  }
  // The browser: sliced over frames (tick() runs the slices); resolves { instrs, clocks }.
  runTo(where, budget) {
    if (this.play) this.finishInstr();
    const job = this.newJob(where, budget);
    return new Promise((resolve, reject) => {
      job.resolve = resolve; job.reject = reject;
      this.runToJob = job;
      this.runToFrame();
    });
  }
  runToFrame() {
    const job = this.runToJob;
    if (!job) return false;
    const r = this.runSlice(job);
    const now = performance.now();
    if (now - job.lastFast > 120) { job.lastFast = now; this.emit('fast', this.fastStats(null)); }
    this.emit('ff', { why: 'runTo', n: job.instrs, clocks: job.clocks });
    if (r === 'more') return true;
    this.runToJob = null;
    this.machine.takeStats();
    if (r === 'limit') job.reject(new Error(`runTo: more than ${job.budget} clocks`));
    else job.resolve({ instrs: job.instrs, clocks: job.clocks, reason: r });
    return false;
  }
  // The wait beat: the raw loop of the halted CPU, bounded per call; true when IRQ1 is entered
  // (physIP at the BIOS int09 handler) or the BDA keyboard head differs from its tail.
  waitKey() {
    const m = this.machine, cpu = m.cpu, t0 = performance.now();
    const int09 = m.biosSym && m.biosSym.int09 !== undefined ? 0xF0000 + (typeof m.biosSym.int09 === 'number' ? m.biosSym.int09 : m.biosSym.int09.addr) : -1;
    const head = () => m.peek8(0x41A) | (m.peek8(0x41B) << 8), tail = () => m.peek8(0x41C) | (m.peek8(0x41D) << 8);
    let n = 0;
    while (performance.now() - t0 < this.sliceMs && n < this.sliceInstrs) {
      if (m.physIP === int09 || head() !== tail()) return true;
      if (cpu.halted && !(cpu.f & 0x200) && !m.nmiLatch) return false;
      const c = cpu.step();
      m.tickDevices(c);
      n++;
    }
    return m.physIP === int09 || head() !== tail();
  }

  // ---------- one instruction ----------
  // Code addresses: 16-bit IP, or 32-bit EIP in a 32-bit code segment of the 386.
  codeMask() { const c = this.machine.cpu; return c.cache && c.cache[1] && c.cache[1].big ? 0xFFFFFFFF : 0xFFFF; }
  codeOpts() { return this.is386 ? { cpu: this.cpuAsm, bits: this.codeMask() === 0xFFFF ? 16 : 32 } : this.disOpts; }
  linPhys(lin) { const m = this.machine; return m.physOf ? m.physOf(lin >>> 0) : lin & (m.memSize - 1); }
  codePhys(ip, base = this.machine.csBase) { return this.linPhys(base + ((ip >>> 0) & this.codeMask())); }
  codeByte(ip, i) { const a = this.codePhys(ip + i); return a < 0 ? 0xFF : this.machine.peek8(a); }
  isSeen(phys) { const k = this.seen.get(phys); return k !== undefined && k > this.traceCount - 2000; }
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
  // Execute one instruction now and start its playback. enter: false leaves step 0 to the caller.
  beginInstr(now, o = {}) {
    const { clockMs = null, manual = false, single = false, enter = true } = o;
    const m = this.machine;
    if (m.cpu.halted) {
      if (!this.skipHalt()) {
        this.pause();
        this.announce('The CPU is halted.');
        this.status(m.cpu.f & 0x200 ? 'waiting for an interrupt' : 'halted (interrupts off)', '');
        return false;
      }
    }
    const trace = this.tracing && !manual;
    const here = m.cpu.repState ? this.codePhys(m.cpu.repState.start) : m.physIP;
    if (trace && this.traceRep === 'once' && !this.ffBypass && this.isSeen(here)) {
      this.startFF('loop', ip => !this.isSeen(ip));
      return false;
    }
    this.ffBypass = false;
    const ip0 = m.cpu.ip, base0 = m.csBase, phys0 = here;
    const { cycles, events } = m.step();
    if (trace) this.seen.set(phys0, ++this.traceCount);
    const dec = events.find(e => e.k === 'decode');
    this.lastTraced = { phys: phys0, text: dec ? dec.text : '' };
    let cms = clockMs;
    if (cms === null) {
      if (trace) cms = clamp(this.stepMs / 4, 20, 250);
      else cms = single ? clamp(1300 / cycles, 6, 140) : clamp((1000 / this.spd.ips) / cycles, 0.6, 250);
      if (this.reducedMotion) cms = Math.max(cms, 8);
    }
    this.play = { events, idx: 0, cycles, clockMs: cms, start: now, manual, clock: 0, text: dec ? dec.text : '', cs: dec ? dec.cs : 0, ip: dec ? dec.ip : 0, lastCaption: '',
      story: trace ? this.buildStory(events) : null, si: -1, stepT: now, auto: !!single, phys: phys0 };
    if (dec) this.play.nextPhys = this.codePhys(ip0 + (dec.len || 0), base0);
    const info = { cycles, clockMs: cms, text: this.play.text, cs: this.play.cs, ip: this.play.ip, trace, phys: phys0 };
    this.emit('instr', events, info);
    if (trace && enter) {
      if (this.play.story.steps.length) this.enterStep(0);
    }
    return true;
  }
  dispatchUntil(t) {
    const p = this.play;
    if (!p) return;
    const ev = p.events;
    while (p.idx < ev.length && ev[p.idx].t <= t) {
      const e = ev[p.idx++];
      this.emit('event', e, p.clockMs);
      const cap = caption(e);
      if (cap) { p.lastCaption = cap; this.emit('caption', cap); }
    }
  }
  finishInstr() {
    const p = this.play;
    if (!p) return;
    this.dispatchUntil(Infinity);
    this.play = null;
    const m = this.machine;
    const regs = p.events.filter(e => e.k === 'reg' && e.r !== 'IP').map(e => `${e.r} = ${hex4(e.v)}`).join(', ');
    let reason = null;
    if (this.running && m.breakpoints.has(m.physIP) && !m.cpu.repState) { this.pause(); reason = 'break'; this.announce('Breakpoint.'); }
    if (m.cpu.halted && !(m.cpu.f & 0x200) && !m.nmiLatch) { this.pause(); reason = reason || 'halt'; }
    else if (this.running && this.stuck()) reason = 'stuck';
    this.emit('instrEnd', { play: p, text: p.text, regs, reason, nextPhys: p.nextPhys, cycles: p.cycles });
  }
  stepInstr() {
    if (this.running) this.pause();
    if (this.play) {
      this.finishInstr();
      if (!this.tracing) return;
    }
    this.beginInstr(animNow(), { single: true });
  }
  stepClock() {
    if (this.running) this.pause();
    const now = animNow();
    if (!this.play) {
      if (!this.beginInstr(now, { clockMs: 400, manual: true })) return;
      this.dispatchUntil(0);
      return;
    }
    if (this.play.story) { this.play.story = null; this.emit('traceClear'); }
    if (!this.play.manual) { this.play.manual = true; this.play.clockMs = 400; }
    this.play.clock = Math.floor(this.play.clock) + 1;
    this.dispatchUntil(this.play.clock);
    if (this.play.clock >= this.play.cycles) this.finishInstr();
  }
  // A jump to itself with interrupts off: nothing can wake the CPU.
  stuck() {
    const m = this.machine, c = m.cpu, a = m.physIP;
    if ((c.f & 0x200) || m.nmiLatch || c.repState || m.peek8(a) !== 0xEB || m.peek8(a + 1) !== 0xFE) return false;
    this.pause();
    const where = `${hex4(c.sregs[1])}:${hex4(c.ip)}`;
    this.announce(`The CPU is stuck at ${where}: a jump to itself with interrupts off, so no interrupt can end it.`);
    this.status(`Stopped: the CPU is in an endless loop at ${where} (JMP $, interrupts off).`, 'bad');
    return true;
  }
  pokeKeyboard() {
    const m = this.machine;
    if (m.cpu.halted && (m.cpu.f & 0x200)) {
      let n = 0;
      while (n < 400000) { const c = m.cpu.step(); m.tickDevices(c); n += c; if (!m.cpu.halted && m.cpu.sregs[1] === PROG_SEG) break; }
    }
  }

  // ---------- story ----------
  buildStory(events, opt) { return Story.build(events, opt || { prefetch: this.tracePre, burst: this.traceBurst }); }
  readMs(s) {
    const [lead, rest] = typeof splitLead === 'function' ? splitLead(s.text) : [String(s.text || ''), ''];
    return (900 + lead.length * 50 + rest.length * 22) * clamp(this.stepMs / TRACE_MS[3], 0.12, 4);
  }
  get tracing() { return this.traceOn && this.mode === 'explain' && typeof Story !== 'undefined'; }
  get stepMs() { return this.spd.stepMs || TRACE_MS[clamp(this.speedIdx, 0, TRACE_MS.length - 1)]; }
  // Enter step i of the story: dispatch its events (not on back), ask the Stage for its time,
  // tell the views. o: { back, quick, finish }.
  enterStep(i, o = {}) {
    const p = this.play;
    if (!p || !p.story) return;
    const back = !!o.back;
    p.si = i;
    p.stepT = animNow();
    const s = p.story.steps[i];
    if (!s) return;
    if (!back) this.dispatchUntil(s.t);
    const auto = this.running || !!p.auto;
    const ms = o.quick ? 650 : this.stepMs;
    p.animMs = this.durOf(s, ms);
    p.stepDur = auto ? Math.max(p.animMs, this.readMs(s)) : p.animMs;
    const info = { ms: p.animMs, back, auto, quick: !!o.quick, finish: !!o.finish };
    this.emit('step', p.story, i, info);
  }
  traceNext() {
    if (!this.tracing) { this.stepInstr(); return; }
    if (this.running) this.pause();
    if (this.ff) {
      this.ffStop('Stopped. The trace continues here.');
      this.ffBypass = true;
      if (this.beginInstr(animNow(), { single: true }) && this.play) this.play.auto = false;
      return;
    }
    const p = this.play;
    if (p && p.story) {
      p.auto = false;
      if (p.si < p.story.steps.length - 1) { this.enterStep(p.si + 1); return; }
      this.finishInstr();
    } else if (p) this.finishInstr();
    if (this.beginInstr(animNow(), { single: true }) && this.play) this.play.auto = false;
  }
  tracePrev() {
    const p = this.play;
    if (this.running) this.pause();
    if (!p || !p.story) return;
    p.auto = false;
    if (p.si > 0) this.enterStep(p.si - 1, { back: true });
    else this.announce('This is the first step. The CPU cannot go back to the previous instruction.');
  }
  traceGo(i) {
    const p = this.play;
    if (!p || !p.story || i === p.si || i < 0 || i >= p.story.steps.length) return;
    if (this.running) this.pause();
    p.auto = false;
    this.enterStep(i, { back: i < p.si });
  }
  traceSkip() {
    if (!this.tracing || this.ff) return;
    const m = this.machine, p = this.play;
    let target;
    if (p && p.nextPhys !== undefined) { target = p.nextPhys; this.finishInstr(); }
    else {
      const len = Disasm86.decode(i => this.codeByte(m.cpu.ip, i), m.cpu.ip, this.codeOpts()).len || 1;
      target = this.codePhys(m.cpu.ip + len);
      this.ffBypass = true;
      if (!this.beginInstr(animNow(), { single: !this.running })) return;
      this.finishInstr();
    }
    if (m.physIP === target) {
      this.ffBypass = true;
      if (!this.running && this.beginInstr(animNow(), { single: true }) && this.play) this.play.auto = false;
      return;
    }
    this.startFF('skip', ip => ip === target);
  }

  // ---------- fast paths ----------
  // why: 'loop' | 'skip' | 'run' (a lesson fold); until(physIP, machine) => boolean.
  startFF(why, until, o = {}) {
    const m = this.machine;
    if (this.play) this.finishInstr();
    const here = m.cpu.repState ? this.codePhys(m.cpu.repState.start) : m.physIP;
    const lt = this.lastTraced && this.lastTraced.phys === here ? this.lastTraced.text : '';
    this.ff = { why, until, n: 0, clocks: 0, t0: performance.now(), loops: 0, first: here, text: String(lt).split(';')[0].trim(), cx0: m.cpu.regs[1], resume: o.resume !== false, budget: o.budget || 20000000 };
    this.emit('traceClear');
    this.emit('ff', this.ff);
  }
  // One slice of the fast run: <= sliceMs of wall time or sliceInstrs raw steps.
  ffFrame() {
    const m = this.machine, cpu = m.cpu, f = this.ff;
    if (!f) return;
    const t0 = performance.now();
    let reason = null, n = 0;
    while (!reason && performance.now() - t0 < this.sliceMs && n < this.sliceInstrs) {
      for (let k = 0; k < 2000; k++) {
        if (cpu.halted && !(cpu.f & 0x200) && !m.nmiLatch) { reason = f.until(m.physIP, m) ? 'done' : 'halt'; break; }
        const c = cpu.step();
        m.tickDevices(c);
        f.n++; f.clocks += c; n++;
        if (cpu.repState) continue;
        const ip = m.physIP;
        if (ip === f.first) f.loops++;
        if (f.until(ip, m)) { reason = 'done'; break; }
        if (m.breakpoints.has(ip)) { reason = 'break'; break; }
        if (f.n > f.budget) { reason = 'limit'; break; }
      }
    }
    const now = performance.now();
    if (now - this.lastFast > 120) { this.lastFast = now; this.emit('fast', this.fastStats(null)); }
    if (!reason) { this.emit('ff', f); return; }
    const nStr = f.n.toLocaleString('en-US');
    const rep = /^rep/i.test(f.text);
    const reps = (f.cx0 - cpu.regs[1]) & 0xFFFF;
    const passes = f.why !== 'loop' ? '' : rep ? ` "${f.text}" repeated ${reps} more time${reps === 1 ? '' : 's'} without trace.` : ` The loop ran ${f.loops + 1} more time${f.loops ? 's' : ''}.`;
    this.ff = null;
    m.takeStats();
    if (reason === 'done') {
      this.ffNote = f.why === 'loop' ? (rep ? `Fast:${passes}` : `Fast: this code repeats, so ${nStr} instructions ran without trace.${passes}`) : f.why === 'skip' ? `Skip: ${nStr} instructions ran without trace.` : '';
      this.ffBypass = f.why === 'skip';
      this.emit('ffEnd', { reason, n: f.n, clocks: f.clocks, loops: f.loops, why: f.why });
      if (f.resume && !this.running && this.beginInstr(animNow(), { single: true }) && this.play) this.play.auto = false;
      return;
    }
    this.pause();
    const msg = reason === 'break' ? `Breakpoint. ${nStr} instructions ran fast.` : reason === 'halt' ? `The CPU is halted. ${nStr} instructions ran fast.` : `Stopped after ${nStr} instructions. The code did not leave the loop.`;
    this.ffNote = '';
    this.announce(msg);
    this.status(msg, '');
    this.emit('ffEnd', { reason, n: f.n, clocks: f.clocks, loops: f.loops, why: f.why });
  }
  ffStop(msg) {
    if (!this.ff) return;
    const f = this.ff, n = f.n.toLocaleString('en-US');
    this.ff = null;
    this.ffNote = `${msg} ${n} instructions ran fast.`;
    this.emit('ffEnd', { reason: 'stop', n: f.n, clocks: f.clocks, loops: f.loops, why: f.why });
  }
  // Fast mode (the Workbench): run at the speed of the slider; a sample instruction for the views.
  fastFrame(dt) {
    const m = this.machine, s = this.spd;
    let budget = Math.max(200, Math.round((s.cps || m.clockHz) * dt / 1000));
    const t0 = performance.now();
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
    this.emit('audio', m.takeSpeaker(), m.takeSound());
    this.emit('fast', this.fastStats(sample));
    if (reason === 'budget' && this.stuck()) return;
    if (reason === 'break') { this.pause(); this.announce('Breakpoint.'); }
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

  // ---------- the frame ----------
  // vnow: the animation clock; vdt: its dt; realDt: real ms since the last frame.
  tick(vnow, vdt, realDt) {
    if (this.runToJob) { this.runToFrame(); return; }
    if (this.ff) this.ffFrame();
    else if (this.running && this.mode === 'fast') this.fastFrame(realDt);
    else if (this.running || (this.play && !this.play.manual && this.play.auto)) this.explainFrame(vnow);
    if (!(this.running && this.mode === 'fast')) { this.machine.takeSpeaker(); this.machine.takeSound(); }
  }
  explainFrame(now) {
    if (!this.play) {
      if (!this.running) return;
      if (!this.beginInstr(now)) return;
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
      if (this.running && this.mode === 'explain' && this.spd.ips >= 15 && !this.play) this.beginInstr(now);
    }
  }

  // ---------- speed ----------
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
  setSpeedPos(pos) {
    const s = this.spd = this.speedAt(pos);
    this.speedPos = s.pos;
    this.speedIdx = s.idx;
    const prev = this.mode;
    this.mode = s.mode;
    this.emit('speed', s);
    if (prev !== this.mode) {
      if (this.play) this.finishInstr();
      this.emit('traceClear');
      this.emit('mode', this.mode);
    }
  }
  setMotion(i) {
    if (i === this.motionIdx) return;
    this.motionIdx = i;
    AnimClock.setScale(MOTION[i]);
  }
  start() {
    const m = this.machine;
    if (m.cpu.halted && !(m.cpu.f & 0x200)) { this.announce('The CPU is halted. Reset to run again.'); return; }
    this.running = true;
    this.fastMeter = { t: performance.now(), cycles: m.cpu.cycles, instr: m.cpu.instructions, cps: 0 };
    this.emit('run', true);
  }
  pause() {
    if (!this.running) return;
    this.running = false;
    this.emit('run', false);
  }
  toggleRun() {
    if (this.ff && this.running) { this.ffStop('Stopped.'); this.pause(); return; }
    if (this.running) this.pause(); else this.start();
  }
}

// A one-line description of a micro-event for a caption strip (app.js:1556-1578, pure).
function caption(e) {
  const model = typeof CPU_MODEL !== 'undefined' ? CPU_MODEL : '8086';
  switch (e.k) {
    case 'fetch': return `BIU prefetch ${hex5(e.addr)} → queue (${e.q.length}/${model === '80686' || model === '80586' || model === '80486' ? 32 : model === '80386' ? 16 : 6})`;
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
