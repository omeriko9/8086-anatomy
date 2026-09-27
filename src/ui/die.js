// Die view: stylized floor plans of the 8086 and 8087 dies, animated by the CPU
// micro-events. The block positions follow die photographs of the 8086: the
// datapath (ALU, registers, segment registers, address adder, queue) runs across
// the top, the microcode ROM sits at the lower right and the decode and control
// logic at the lower left. Pure inline SVG; one small canvas makes the metal texture.

const DIE_PINS = ['GND', 'AD14', 'AD13', 'AD12', 'AD11', 'AD10', 'AD9', 'AD8', 'AD7', 'AD6',
  'AD5', 'AD4', 'AD3', 'AD2', 'AD1', 'AD0', 'NMI', 'INTR', 'CLK', 'GND',
  'RESET', 'READY', 'TEST', 'QS1', 'QS0', 'S0', 'S1', 'S2', 'LOCK', 'RQ/GT1',
  'RQ/GT0', 'RD', 'MN/MX', 'BHE/S7', 'A19/S6', 'A18/S5', 'A17/S4', 'A16/S3', 'AD15', 'VCC'];
const DIE_W = 960, DIE_H = 760, FPU_W = 740, FPU_H = 300;
const DIE_REGS = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI'];
const DIE_SEGS = ['CS', 'DS', 'SS', 'ES', 'IP'];
const DIE_FLAGS = [['OF', 11], ['DF', 10], ['IF', 9], ['TF', 8], ['SF', 7], ['ZF', 6], ['AF', 4], ['PF', 2], ['CF', 0]];
const DIE_STATUS = { inta: 0, ior: 1, iow: 2, halt: 3, code: 4, memr: 5, memw: 6, passive: 7 };
const DIE_CYCLE = { code: 'CODE FETCH', memr: 'MEMORY READ', memw: 'MEMORY WRITE', ior: 'I/O READ', iow: 'I/O WRITE', inta: 'INT ACK', halt: 'HALT', passive: 'PASSIVE' };
const DIE_SEGCODE = { ES: 0, SS: 1, CS: 2, DS: 3 };   // S4 S3
const DIE_OPSYM = { ADD: '+', ADC: '+', SUB: '−', SBB: '−', CMP: '−', AND: '&', TEST: '&', OR: '|', XOR: '^',
  MUL: '×', IMUL: '×', DIV: '÷', IDIV: '÷', ROL: '⟲', ROR: '⟳', RCL: '⟲', RCR: '⟳', SHL: '«', SHR: '»', SAR: '»', SETMO: '',
  INC: '+', DEC: '−', NEG: '−', NOT: '~' };
const DIE_INFO = {
  alu: ['ALU', 'The 16-bit arithmetic/logic unit. The operands load into the temporary registers TMP A and TMP B from the ALU bus. The result goes back over the bus, and the ALU sets the flags.'],
  flags: ['Flags register', 'Six status flags (OF SF ZF AF PF CF) that the ALU sets, and three control flags (DF IF TF). A pulse shows the bits that changed.'],
  regs: ['General registers', 'AX BX CX DX (each also two 8-bit halves, such as AH and AL) and the pointer and index registers SP BP SI DI. They sit in the EU datapath next to the ALU.'],
  sigma: ['Address adder Σ', 'The BIU has its own adder. It makes the 20-bit physical address as segment × 16 + offset for each bus cycle, and it increments the prefetch pointer.'],
  segs: ['Segment registers and IP', 'CS DS SS ES and the instruction pointer are in the BIU, next to the address adder. The real chip keeps the prefetch address here; this view shows the IP of the next instruction.'],
  busctl: ['Bus control', 'Runs the 4-clock bus cycles (T1 to T4). In maximum mode it sends the cycle type on S2 S1 S0 to the 8288 bus controller and the queue status on QS1 QS0 to the 8087.'],
  queue: ['Instruction queue', 'The BIU prefetches up to 6 bytes while the EU executes. It fetches a word from an even address. A jump flushes the queue and the prefetched bytes are lost.'],
  dec: ['Decoder and EU control', 'The loader takes the opcode from the queue, the group decode ROM classifies it, and the translation ROM selects the microcode routine for the instruction.'],
  rom: ['Microcode ROM', '512 micro-instructions of 21 bits control most instructions step by step. The moving row shows activity only; it is not the real micro-address.'],
  intr: ['Interrupt and timing logic', 'Samples INTR and NMI between instructions, runs the two INTA bus cycles for a hardware interrupt, and makes the clock phases.'],
  pads: ['Bond pads', 'The 40 pins. MN/MX is tied to ground, so the chip is in maximum mode: pins 24 to 31 carry QS0 QS1, S0 to S2, LOCK and RQ/GT0 RQ/GT1. AD0 to AD15 carry the address in T1 and the data in T3.'],
  f87q: ['8087 queue tracker', 'The 8087 copies each code fetch from the bus and follows QS1 QS0, so it keeps the same queue as the 8086 and sees each ESC instruction when the 8086 executes it.'],
  f87sw: ['8087 status word', 'Condition codes C3 to C0, TOP (the stack pointer), the six exception flags and BUSY.'],
  f87cw: ['8087 control word', 'Precision control, rounding control and the six exception masks.'],
  f87neu: ['8087 register stack', 'Eight 80-bit registers used as a circular stack. TOP selects the physical register that is ST(0). A load decrements TOP and the barrel turns; a pop increments it.'],
  link: ['8086 to 8087 local bus', 'The 8087 shares AD0 to AD15 and S0 to S2 with the 8086. It takes the bus with RQ/GT0, drives BUSY into TEST (for WAIT) and signals errors on INT, which the PC sends to NMI.'],
};
// Double-click on a block: the chip (decap key of the Board tab) and the block label on the
// 3D die floor plan (board3d.js DIE_PLANS). A null label shows the whole die.
const DIE_3D = {
  alu: ['cpu', 'ALU'], flags: ['cpu', 'FLAGS'], regs: ['cpu', 'REGISTERS'], sigma: ['cpu', 'ADDRESS ADDER'],
  segs: ['cpu', 'SEGMENT REGS'], busctl: ['cpu', 'BUS CONTROL'], queue: ['cpu', 'QUEUE'], dec: ['cpu', 'DECODER'],
  rom: ['cpu', 'MICROCODE ROM'], intr: ['cpu', 'INTERRUPTS TIMING'], pads: ['cpu', null],
  f87q: ['fpu', 'QUEUE TRACKER'], f87sw: ['fpu', 'STATUS'], f87cw: ['fpu', 'CONTROL'], f87neu: ['fpu', 'REGISTER STACK'],
  link: ['fpu', 'BUS INTERFACE'],
};
const DIE286_3D = {
  desc: ['cpu', 'SEGMENT CACHES'], adder: ['cpu', 'PHYSICAL ADDER'], prot: ['cpu', 'PROTECTION CHECK'], sysr: ['cpu', 'PROTECTION CHECK'],
  latch: ['cpu', 'ADDRESS DRIVERS'], xcvr: ['cpu', 'BUS CONTROL'], busctl: ['cpu', 'BUS CONTROL'], pfq: ['cpu', 'PREFETCH QUEUE'],
  pei: ['cpu', 'PROC EXT INTERFACE'], dec: ['cpu', 'INSTRUCTION DECODER'], iq: ['cpu', 'DECODED QUEUE'], alu: ['cpu', 'ALU'],
  flags: ['cpu', 'ALU'], ctl: ['cpu', 'CONTROL ROM'], regs: ['cpu', 'REGISTERS'], pads: ['cpu', null],
  f87bi: ['fpu', 'BUS INTERFACE'], f87sw: ['fpu', 'STATUS'], f87cw: ['fpu', 'CONTROL'], f87neu: ['fpu', 'REGISTER STACK'],
  link: ['fpu', 'BUS INTERFACE'], npdec: ['bus', 'STATUS DECODER'],
};
const DV_ZMAX = 8;
// Colour helpers: every colour of the view comes from THEME (the 8086 or the 80286 palette).
const dvRgb = h => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const dvMix = (a, b, t) => { const A = dvRgb(a), B = dvRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const dvA = (h, al) => { const [r, g, b] = dvRgb(h); return `rgba(${r},${g},${b},${al})`; };
let dvPalCache = null;
function dieP() {
  if (dvPalCache) return dvPalCache;
  const T = THEME, W = '#ffffff', K = '#000000';
  dvPalCache = {
    frameFill: dvA(T.void, 0.62), frameStroke: dvMix(T.ceramicHi, T.void, 0.15),
    padHi: dvMix(T.goldHi, W, 0.2), padLo: dvMix(T.gold, T.void, 0.3), padStroke: dvMix(T.gold, T.void, 0.4), padText: dvMix(T.gold, T.void, 0.88),
    tieFill: dvMix(T.ceramic, T.void, 0.3), a1s: dvMix(T.cyan, W, 0.6), a0f: dvMix(T.cyan, T.void, 0.8),
    d1s: dvMix(T.goldHi, W, 0.6), d0f: dvMix(T.gold, T.void, 0.78), c1s: dvMix(T.magenta, W, 0.6), c0f: dvMix(T.magenta, T.void, 0.78),
    f1s: dvMix(T.lavender, W, 0.6), f0f: dvMix(T.lavender, T.void, 0.75), g1s: dvMix(T.phosphor, W, 0.6),
    cellStroke: dvMix(T.ceramicHi, T.panel, 0.35), cellOn: dvMix(T.gold, T.panel, 0.8), cellOnL: dvMix(T.lavender, T.panel, 0.78),
    tOn: dvMix(T.magenta, T.panel, 0.8), tOnText: dvMix(T.magenta, W, 0.75),
    chipFill: dvMix(T.panel2, T.void, 0.1), chipNew: dvMix(T.gold, T.panel, 0.72), chipOut: dvMix(T.phosphor, T.panel, 0.82), chipDis: dvMix(T.magenta, T.panel, 0.8),
    tabFill: dvMix(T.void, T.panel, 0.4), tipBg: dvA(dvMix(T.void, T.panel, 0.5), 0.96),
    siA: dvMix(T.ceramic, T.void, 0.35), siB: dvMix(T.ceramic, T.void, 0.62), siC: dvMix(T.ceramic, T.void, 0.45),
    si87A: dvMix(T.lavender, T.void, 0.85), si87B: dvMix(T.lavender, T.void, 0.91),
    romCell: dvMix(T.ceramicHi, T.panel, 0.45), romLine: dvMix(T.ceramic, T.panel, 0.5), romLine2: dvMix(T.ceramic, T.panel, 0.6),
    dieShadow: dvMix(T.void, K, 0.35), scribe: dvMix(T.gold, T.void, 0.62),
    busMain: dvMix(T.gold, T.void, 0.18), busQ: dvMix(T.gold, T.void, 0.32), busA: dvMix(T.cyan, T.void, 0.35), busC: dvMix(T.magenta, T.void, 0.3),
    regEU: dvMix(T.phosphor, T.void, 0.6), regBIU: dvMix(T.cyan, T.void, 0.6), regAU: dvMix(T.lavender, T.void, 0.55), regBU: dvMix(T.gold, T.void, 0.55),
    aluFill: dvMix(T.ceramic, T.void, 0.45), row0: T.panel, row1: dvMix(T.panel, T.panel2, 0.6), dot: dvMix(T.faint, T.panel, 0.45),
    segFill: dvMix(T.lavender, T.void, 0.86), segStroke: dvMix(T.lavender, T.void, 0.5), segTop: dvMix(T.lavender, T.text, 0.5),
    bond: dvMix(T.gold, T.goldHi, 0.3),
  };
  return dvPalCache;
}
function dieCss() {
  const P = dieP();
  return `
.dv-root{position:absolute;inset:0;overflow:hidden}
.dv-svg{position:absolute;inset:0;width:100%;height:100%;display:block;user-select:none;-webkit-user-select:none;touch-action:none;outline:none}
.dv-svg:focus-visible{box-shadow:inset 0 0 0 2px var(--gold-hi);border-radius:var(--r,8px)}
.dv-svg.dv-zoomed{cursor:grab}
.dv-svg.dv-pan,.dv-svg.dv-pan .dv-blk{cursor:grabbing}
.dv-tools{position:absolute;left:6px;top:6px;z-index:6;display:flex;align-items:center;gap:1px;padding:2px;border-radius:999px;
  background:color-mix(in srgb,var(--void) 70%,transparent);border:1px solid var(--line-soft);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.dv-zb{border:0;background:transparent;color:var(--muted);font:600 12px/1 var(--sans);letter-spacing:.02em;min-width:28px;padding:5px 9px;border-radius:999px;
  transition:color .2s,background .2s}
.dv-zb.dv-pm{font:700 16px/12px var(--sans);padding:5px 8px}
.dv-zb:hover:not(:disabled){color:var(--text);background:color-mix(in srgb,var(--ceramic-hi) 40%,transparent)}
.dv-zb:focus-visible{outline:2px solid var(--gold-hi);outline-offset:1px}
.dv-zb:disabled{opacity:.38;cursor:default}
.dv-zl{min-width:4.4ch;text-align:center;font:600 11px/1 var(--mono);color:var(--faint);font-variant-numeric:tabular-nums}
.dv-tip i{display:block;margin-top:8px;font:italic 13px/1.4 var(--sans);color:var(--muted)}
@media (max-width:700px){.dv-zb{padding:6px 9px}}
.dv-svg text{font-family:var(--mono);font-variant-numeric:tabular-nums}
.dv-silk{fill:none;stroke:${THEME.silk};stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;opacity:.78}
.dv-silk-g{fill:none;stroke:var(--gold);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.dv-silk-l{fill:none;stroke:var(--lavender);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.dv-silk-m{fill:none;stroke:var(--magenta);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.dv-blk{cursor:pointer;outline:none}
.dv-frame{fill:${P.frameFill};stroke:${P.frameStroke};stroke-width:1.4;transition:stroke .2s}
.dv-blk:hover .dv-frame{stroke:var(--gold)}
.dv-blk:focus-visible .dv-frame,.dv-blk.dv-sel .dv-frame{stroke:var(--gold-hi);stroke-width:2.6}
.dv-heat{fill:var(--gold);fill-opacity:.16;stroke:var(--gold-hi);stroke-width:2.4;opacity:0;pointer-events:none;filter:drop-shadow(0 0 6px var(--gold))}
.dv-heat.dv-h8087{fill:var(--lavender);stroke:var(--lavender);filter:drop-shadow(0 0 6px var(--lavender))}
.dv-v{fill:var(--text)}
.dv-m{fill:var(--muted)}
.dv-f{fill:var(--faint)}
.dv-cy{fill:var(--cyan)}
.dv-go{fill:var(--gold-hi)}
.dv-mg{fill:var(--magenta)}
.dv-ph{fill:var(--phosphor)}
.dv-lv{fill:var(--lavender)}
.dv-bus{fill:none;stroke-linecap:round;stroke-linejoin:round}
.dv-pad rect{fill:url(#dv-padg);stroke:${P.padStroke};stroke-width:1}
.dv-pad text{fill:${P.padText};font-weight:700}
.dv-pad.dv-tie rect{fill:${P.tieFill};stroke:var(--ceramic-hi)}.dv-pad.dv-tie text{fill:var(--magenta)}
.dv-pad.dv-nc rect{fill:${P.tieFill};stroke:${P.cellStroke}}.dv-pad.dv-nc text{fill:var(--faint)}
.dv-pad.dv-a1 rect{fill:var(--cyan);stroke:${P.a1s};filter:drop-shadow(0 0 5px var(--cyan))}
.dv-pad.dv-a0 rect{fill:${P.a0f};stroke:var(--cyan)}.dv-pad.dv-a0 text{fill:var(--cyan)}
.dv-pad.dv-d1 rect{fill:var(--gold-hi);stroke:${P.d1s};filter:drop-shadow(0 0 5px var(--gold))}
.dv-pad.dv-d0 rect{fill:${P.d0f};stroke:var(--gold)}.dv-pad.dv-d0 text{fill:var(--gold-hi)}
.dv-pad.dv-c1 rect{fill:var(--magenta);stroke:${P.c1s};filter:drop-shadow(0 0 5px var(--magenta))}
.dv-pad.dv-c0 rect{fill:${P.c0f};stroke:var(--magenta)}.dv-pad.dv-c0 text{fill:var(--magenta)}
.dv-pad.dv-f1 rect{fill:var(--lavender);stroke:${P.f1s};filter:drop-shadow(0 0 5px var(--lavender))}
.dv-pad.dv-f0 rect{fill:${P.f0f};stroke:var(--lavender)}.dv-pad.dv-f0 text{fill:var(--lavender)}
.dv-pad.dv-g1 rect{fill:var(--phosphor);stroke:${P.g1s};filter:drop-shadow(0 0 5px var(--phosphor))}
.dv-wire{fill:none;stroke-width:2.2;stroke-linejoin:round;opacity:.5;transition:opacity .25s}
.dv-wire.dv-on{opacity:1;stroke-width:3;filter:drop-shadow(0 0 4px currentColor)}
.dv-chip rect{fill:${P.chipFill};stroke:var(--gold);stroke-width:1.4}
.dv-chip text{fill:var(--gold-hi);font-weight:600}
.dv-chip.dv-head rect{stroke:var(--phosphor)}
.dv-chip.dv-new rect{fill:${P.chipNew}}
.dv-chip.dv-out rect{stroke:var(--phosphor);fill:${P.chipOut}}
.dv-chip.dv-out text{fill:var(--phosphor)}
.dv-chip.dv-dis rect{stroke:var(--magenta);fill:${P.chipDis}}
.dv-chip.dv-dis text{fill:var(--magenta);text-decoration:line-through}
.dv-tok rect{fill:${P.tabFill};stroke-width:1.6}
.dv-tok text{font-weight:700}
.dv-cell rect{fill:var(--panel);stroke:${P.cellStroke};stroke-width:1.2}
.dv-cell.dv-on rect{fill:${P.cellOn};stroke:var(--gold)}
.dv-cell.dv-on text.dv-b{fill:var(--gold-hi)}
.dv-cell.dv-l.dv-on rect{fill:${P.cellOnL};stroke:var(--lavender)}
.dv-cell.dv-l.dv-on text.dv-b{fill:var(--lavender)}
.dv-tstate rect{fill:var(--panel);stroke:${P.cellStroke}}
.dv-tstate.dv-on rect{fill:${P.tOn};stroke:var(--magenta);filter:drop-shadow(0 0 4px var(--magenta))}
.dv-tstate.dv-on text{fill:${P.tOnText}}
.dv-legend text{font-family:var(--sans)}
.dv-tip{position:absolute;max-width:min(480px,90%);padding:14px 18px;border-radius:10px;background:${P.tipBg};
  border:1px solid var(--line);box-shadow:0 16px 40px rgba(0,0,0,.6);font:16px/1.55 var(--sans);color:var(--text);
  z-index:9;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .18s,transform .18s}
.dv-tip.dv-on{opacity:1;transform:none}
.dv-tip b{display:block;color:var(--gold-hi);font:600 14px var(--mono);letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
`;
}

class DieView {
  constructor(host, app) {
    // The 80286 machine has its own die (see Die286View at the end of this file).
    if (app.model === '80286' && new.target === DieView) return new Die286View(host, app);
    // The 80386 die needs the 80386 core (cpu.regs32); without it the view shows the 80286 die.
    if (app.model === '80386' && new.target === DieView) {
      const c = app.machine && app.machine.cpu;
      return c && c.regs32 ? new Die386View(host, app) : new Die286View(host, app);
    }
    // The 80486 die (see Die486View at the end of this file) needs a 32-bit core too.
    if (app.model === '80486' && new.target === DieView) {
      const c = app.machine && app.machine.cpu;
      return c && c.regs32 ? new Die486View(host, app) : new Die286View(host, app);
    }
    // The Pentium die (see Die586View at the end of this file) needs the Pentium core (the two
    // caches and the BTB). With another core (a Machine486 on this page) the view is the 486 die.
    if (app.model === '80586' && new.target === DieView) {
      const c = app.machine && app.machine.cpu;
      return c && c.dcache && c.icache && c.btb ? new Die586View(host, app) : c && c.regs32 ? new Die486View(host, app) : new Die286View(host, app);
    }
    // The Pentium Pro die (see Die686View at the end of this file) needs the P6 core (the ROB, the
    // RS and the L2). With a Pentium core on this page the view is the Pentium die.
    if (app.model === '80686' && new.target === DieView) {
      const c = app.machine && app.machine.cpu;
      return c && c.rob && c.rs && c.l2 ? new Die686View(host, app) : c && c.dcache && c.icache && c.btb ? new Die586View(host, app) : c && c.regs32 ? new Die486View(host, app) : new Die286View(host, app);
    }
    this.host = host;
    this.app = app;
    this.m = app.machine;
    this.reduced = !!app.reducedMotion;
    this.visible = false;
    this.kind = null;
    this.serial = 0;
    this.cms = 50;
    this.manual = false;
    this.vclock = 0;
    this.lastT = 0;
    this.t0 = 0;
    this.cycles = 1;
    this.tokensOn = false;
    this.events = [];
    this.anims = { bus: null, qs: null, intr: null, rq: null, dec: null, alu: null, sig: null, fpu: null };
    this.flashes = new Map();
    this.tokens = [];
    this.qOps = [];
    this.chips = [];
    this.gone = [];
    this.heat = {};
    this.heatT = {};
    this.lastFast = 0;
    this.lastSync = 0;
    this.resetAt = 0;
    this.sel = null;
    this.mdl = { regs: {}, flags: 0xF002, q: [], alu: null, sig: null, dec: null, intr: null, fpuText: '', bus: null };
    this.fpuM = null;
    this.barrel = 0;
    if (!document.getElementById('dv-style')) htmlEl('style', { id: 'dv-style' }, document.head, dieCss());
    this.root = htmlEl('div', { class: 'dv-root' }, host);
    this.svg = svgEl('svg', { class: 'dv-svg', role: 'group', tabindex: 0, 'aria-label': 'Die floor plans of the 8086 CPU and the 8087 coprocessor. The plus and minus keys zoom, the 0 key fits the dies.', preserveAspectRatio: 'xMidYMid meet' }, this.root);
    this.tip = htmlEl('div', { class: 'dv-tip', role: 'tooltip', id: 'dv-tip' }, this.root);
    this.svg.addEventListener('click', e => { if (!e.target.closest('.dv-blk')) this.select(null); });
    this.zv = { z: 1, cx: null, cy: null };
    this.buildZoom();
    this.readMachine();
    const fb = this.layoutFor();
    this.build(fb.kind);
    this.fit(fb);
  }

  // ---------- View contract ----------
  show() { this.visible = true; this.resize(); this.renderAll(); }
  hide() { this.visible = false; this.select(null); this.ptrs.clear(); this.drag = null; this.pinch = null; this.svg.classList.remove('dv-pan'); }
  resize() {
    const b = this.layoutFor();
    if (b.kind !== this.kind) { this.build(b.kind); this.renderAll(); }
    this.fit(b);
  }
  setReducedMotion(on) {
    this.reduced = !!on;
    if (on) this.clearTokens();
  }
  reset() {
    this.clearTokens();
    this.qOps.length = 0;
    for (const k in this.anims) this.anims[k] = null;
    this.flashes.clear();
    this.serial++;
    this.vclock = 0; this.lastT = 0; this.manual = false;
    this.mdl.alu = null; this.mdl.sig = null; this.mdl.intr = null; this.mdl.fpuText = ''; this.mdl.bus = null;
    this.mdl.dec = null;
    this.flushAt = null;
    this.readMachine();
    const c = this.m.cpu;
    this.mdl.sig = { seg: 'CS', segv: c.sregs[1], off: c.ip, phys: ((c.sregs[1] << 4) + c.ip) & 0xFFFFF };
    this.resetAt = animNow();
    for (const k in this.heat) this.heat[k] = 0;
    this.renderAll();
  }
  instr(events, info) {
    this.applyQOps(true);
    const now = animNow();
    const wasManual = this.manual;
    this.serial++;
    this.events = events;
    this.t0 = now;
    this.cms = info.clockMs;
    this.manual = info.clockMs >= 300;
    this.cycles = Math.max(1, info.cycles);
    this.vclock = 0;
    this.lastT = 0;
    this.lastFast = 0;
    if (this.manual || wasManual) this.clearTokens();
    this.tokensOn = this.visible && !this.reduced && info.cycles * info.clockMs >= 45;
    this.dec = events.find(e => e.k === 'decode') || null;
    // The trace puts a queue flush at the end of the instruction, but the fetches from
    // the jump target come before it in time. The first fetch at the final CS:IP starts
    // the new stream, so the view applies the flush just before that fetch.
    this.flushAt = null;
    this.flushDone = false;
    if (events.some(e => e.k === 'queue' && e.op === 'flush')) {
      const fin = r => { const x = events.filter(e => e.k === 'reg' && e.r === r).pop(); return x ? x.v : this.mdl.regs[r]; };
      const target = ((fin('CS') << 4) + fin('IP')) & 0xFFFFF;
      const pop = events.find(e => e.k === 'queue' && e.op === 'pop');
      this.flushAt = events.find(e => e.k === 'fetch' && e.addr === target && (!pop || e.t >= pop.t)) || null;
    }
    this.ops = this.dec ? DieView.operands(this.dec.text) : [];
  }
  event(e, clockMs) {
    if (clockMs >= 300 && !this.manual) this.manual = true;
    this.cms = clockMs;
    if (e.t > this.lastT) this.lastT = e.t;
    const a = this.anim(e.t);
    switch (e.k) {
      case 'decode': this.onDecode(e, a); break;
      case 'fetch': this.onBus(e, a, 'code'); break;
      case 'bus': this.onBus(e, a, e.type); break;
      case 'queue': this.onQueue(e, a); break;
      case 'ea': this.onEA(e, a); break;
      case 'alu': this.onAlu(e, a); break;
      case 'reg': this.onReg(e, a); break;
      case 'flags': this.onFlags(e, a); break;
      case 'int': this.mdl.intr = e; this.anims.intr = Object.assign(a, { n: 8, minMs: 900, e }); this.flash('intr', a, 8, 900); this.renderIntr(); break;
      case 'fpu': this.onFpu(e, a); break;
      default: break;
    }
    // a soft tick when a unit lights up (slow playback only)
    if (e.k === 'decode') this.sfxTick(1);
    else if (e.k === 'alu') this.sfxTick(1.25);
    else if (e.k === 'reg' && e.r !== 'IP') this.sfxTick(1.5);
    else if (e.k === 'fpu') this.sfxTick(0.9);
    if (!this.visible) this.applyQOps(true);
  }
  // Sounds only while the view is visible and one clock lasts 120 ms or more of real time.
  sfxOn() {
    if (typeof Sfx === 'undefined' || !this.visible) return false;
    return this.cms / Math.max(1e-3, this.app.motion || 1) >= 120;
  }
  sfxTick(k) { if (this.sfxOn()) Sfx.tick(k, 0.016); }
  fast(stats) {
    const now = animNow();
    this.lastFast = now;
    this.clearTokens();
    this.applyQOps(true);
    const b = stats.bus || {};
    const lg = v => clamp(Math.log10(1 + (v || 0)) / 4.2, 0, 1);
    const ips = lg(stats.ips / 40);
    const all = (b.fetch || 0) + (b.memr || 0) + (b.memw || 0) + (b.ior || 0) + (b.iow || 0) + (b.inta || 0);
    Object.assign(this.heatT, {
      queue: lg(b.fetch), sigma: lg(all), segs: lg(b.fetch) * 0.7, busctl: lg(all), pads: lg(all),
      alu: ips, regs: ips, flags: ips * 0.8, dec: ips, rom: ips, intr: lg((b.inta || 0) * 40),
      f87q: lg(b.fetch) * 0.6, f87neu: lg((b.fpu || 0) * 20), f87sw: lg((b.fpu || 0) * 10), f87cw: 0,
    });
    if (now - this.lastSync > 100) {
      this.lastSync = now;
      this.readMachine();
      const s = stats.sample;
      if (s) {
        const d = s.find(e => e.k === 'decode');
        if (d) this.mdl.dec = d;
        const al = s.filter(e => e.k === 'alu').pop();
        if (al) this.mdl.alu = al;
        const bu = s.filter(e => e.k === 'bus' || e.k === 'fetch').pop();
        if (bu) {
          this.mdl.bus = { e: bu, type: bu.k === 'fetch' ? 'code' : bu.type };
          // replay the sampled bus cycle on the pads (4 T-states in 100 ms)
          this.anims.bus = { serial: -1, tc: 0, start: now, cms: 25, d: 0, n: 4, minMs: 0, e: bu, type: this.mdl.bus.type };
        }
        const ea = s.filter(e => e.k === 'ea').pop();
        if (ea) this.mdl.sig = ea;
        const f = s.find(e => e.k === 'fpu');
        if (f) this.mdl.fpuText = f.text;
      }
      if (this.visible) this.renderAll();
    }
  }
  frame(now, dt) {
    if (!this.els) return;
    // Visual clock: follows the manual clock steps smoothly and holds between clicks.
    if (this.manual) {
      const target = Math.max(this.app.clock, this.lastT) + 0.85;
      if (target - this.vclock > 1.5) this.vclock = target - 1;   // several clocks at once: catch up
      this.vclock += (target - this.vclock) * (this.reduced ? 1 : 1 - Math.exp(-dt / 90));
    } else this.vclock = (now - this.t0) / Math.max(this.cms, 0.001);
    if (this.lastFast && now - this.lastFast > 160) {
      // FAST mode stopped: show the final machine state once.
      this.lastFast = 0;
      this.readMachine();
      this.renderAll();
    }
    this.applyQOps(false);
    this.stepHeat(dt);
    this.stepFlashes(now);
    this.stepTokens(now);
    this.stepChips(dt);
    this.stepPads(now);
    this.stepBusCtl(now);
    this.stepBarrel(dt);
    this.stepMisc(now);
  }

  // ---------- timing helpers ----------
  anim(t) { return { serial: this.serial, tc: t, start: animNow(), cms: this.cms, d: 0, n: 1, minMs: 0 }; }
  // Progress 0..1 of an animation: clock based in manual stepping, wall time otherwise.
  prog(a, now) {
    if (!a) return 2;
    if (a.serial === this.serial && this.manual) return (this.vclock - a.tc - a.d) / a.n;
    const c = Math.max(a.cms, 0.001), dur = Math.max(a.n * c, a.minMs || 0), sc = dur / (a.n * c);
    return ((now || animNow()) - a.start - a.d * c * sc) / dur;
  }

  // ---------- machine state ----------
  readMachine() {
    const c = this.m.cpu, R = this.mdl.regs;
    const enc = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
    enc.forEach((n, i) => { R[n] = c.regs[i]; });
    ['ES', 'CS', 'SS', 'DS'].forEach((n, i) => { R[n] = c.sregs[i]; });
    R.IP = c.ip;
    this.mdl.flags = c.flags;
    const q = c.q.slice(0, this.QN);
    if (q.join() !== this.mdl.q.join()) { this.mdl.q = q; this.rebuildChips(); }
    this.readFpu();
  }
  readFpu() {
    const f = this.m.fpu;
    if (!f) { this.fpuM = null; return; }
    const vals = [], tags = [];
    for (let p = 0; p < 8; p++) {
      const i = (p - f.top) & 7;
      tags[p] = f.tag(i);
      vals[p] = DieView.shortF(f, i);
    }
    const old = this.fpuM;
    this.fpuM = { top: f.top, sw: f.sw, cw: f.cw, vals, tags, busy: f.busyCycles > 0, ir: f.intRequest };
    return old;
  }
  static shortF(f, i) {
    if (f.tag(i) === 3) return 'empty';
    let x;
    try { x = F80.toNumber(f.st(i)); } catch (e) { return f.describe(i).slice(0, 8); }
    if (!isFinite(x)) return f.describe(i).slice(0, 8);
    if (x === 0) return '0';
    const ax = Math.abs(x);
    if (ax >= 1e-3 && ax < 1e7) {
      const trim = t => (t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t);
      const s = trim(x.toPrecision(6));
      return s.length > 8 ? trim(x.toPrecision(4)) : s;
    }
    return x.toExponential(2).replace(/\.?0+e/, 'e').replace('e+', 'e');
  }
  // Operand names of a disassembled instruction ("add ax, [bx+2]" -> ['ax', '[bx+2]']).
  static operands(text) {
    const s = String(text || '').toLowerCase().replace(/^(rep\w*|lock)\s+/, '');
    const sp = s.indexOf(' ');
    if (sp < 0) return [s];
    return [s.slice(0, sp)].concat(s.slice(sp + 1).split(',').map(x => x.trim().replace(/^(byte|word|dword|qword|tword|short|near|far)\s+/, '')));
  }

  // ---------- layout ----------
  // The floating CRT monitor of the stage (host px), or null when it is docked or hidden.
  monitorRect() {
    const st = this.host.parentElement, mon = st && st.querySelector('.monitor');
    if (!mon || mon.classList.contains('docked') || mon.offsetParent === null) return null;
    const hr = this.host.getBoundingClientRect(), r = mon.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left - hr.left - 8, y: r.top - hr.top - 8, w: r.width + 16, h: r.height + 16 };
  }
  // Pick the layout and scale that show the dies largest without the monitor on top of them.
  layoutFor() {
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 500;
    const hh = Math.max(h - 56, h * 0.75);
    const LS = this.layoutSet();
    // boxes on top of the view: the floating monitor, and the zoom tools (these can cover
    // the pads and the ring bus, so the keep boxes get 40 units smaller on each side for them)
    const obs = [[this.monitorRect(), 0], [this.toolsRect(), 40]].filter(o => o[0]);
    const hits = (L, sc, ox, oy) => obs.some(([M, n]) => L.keep.some(([x, y, bw, bh]) => {
      const X = ox + (x + n) * sc, Y = oy + (y + n) * sc, W = (bw - 2 * n) * sc, H = (bh - 2 * n) * sc;
      return X < M.x + M.w && X + W > M.x && Y < M.y + M.h && Y + H > M.y;
    }));
    let best = null;
    for (const kind of ['wide', 'row', 'tall']) {
      const L = LS[kind], s0 = Math.min(w / L.W, hh / L.H);
      let cand = null;
      for (let sc = s0; sc >= s0 * 0.5 && !cand; sc *= 0.97) {
        const cw = L.W * sc, ch = L.H * sc;
        for (const ox of [(w - cw) / 2, 0]) {
          for (const oy of [(hh - ch) / 2, 0, hh - ch]) {
            if (!cand && !hits(L, sc, ox, oy)) cand = { kind, s: sc, ox, oy };
          }
        }
      }
      if (cand && (!best || cand.s > best.s * (kind === this.kind ? 1 : 1.04))) best = cand;
    }
    if (!best) {
      const L = LS.wide, sc = Math.min(w / L.W, hh / L.H);
      best = { kind: 'wide', s: sc, ox: (w - L.W * sc) / 2, oy: Math.max(0, (hh - L.H * sc) / 2) };
    }
    return best;
  }
  fit(b) {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h || !b) return;
    // the view box at zoom 1; applyView() cuts the zoomed part out of it
    this.vb0 = { x: -b.ox / b.s, y: -b.oy / b.s, w: w / b.s, h: h / b.s };
    this.baseS = b.s;
    this.applyView();
    // hide the legend when the monitor covers it
    if (!this.legend || !this.L.legend) return;
    const M = this.monitorRect(), [lx, ly] = this.L.legend, lw = this.kind === 'tall' ? 230 : 580, lh = this.kind === 'tall' ? 255 : 192;
    const X = b.ox + lx * b.s, Y = b.oy + (ly - 20) * b.s;
    const hid = !!M && X < M.x + M.w && X + lw * b.s > M.x && Y < M.y + M.h && Y + lh * b.s > M.y;
    if (this.legend) this.legend.style.display = hid ? 'none' : '';
  }
  static get layouts() {
    // keep: boxes that must not sit under the monitor (die interiors, without the pad rows)
    return {
      wide: { W: 1820, H: 818, p86: [20, 20], p87: [1060, 498], side: 'left', up: false, legend: [1080, 300],
        keep: [[40, 40, 920, 720], [1084, 522, 700, 260]] },
      row: { W: 1820, H: 818, p86: [20, 20], p87: [1060, 20], side: 'left', up: true, legend: [1070, 380],
        keep: [[40, 40, 920, 720], [1070, 30, 720, 290]] },
      tall: { W: 1060, H: 1195, p86: [20, 20], p87: [260, 876], side: 'top', up: false, legend: [20, 900],
        keep: [[40, 40, 920, 720], [280, 900, 700, 260]] },
    };
  }

  layoutSet() { return DieView.layouts; }
  build(kind) {
    this.kind = kind;
    // a new layout moves the blocks, so the zoom starts again at 1
    this.zv = { z: 1, cx: null, cy: null };
    this.zAnim = null;
    this.L = this.layoutSet()[kind];
    const svg = this.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    this.els = { blocks: {}, heat: {}, pads: [], regs: {}, flags: [], f87: {} };
    this.chips = [];
    this.tokens = [];
    this.buildDefs(svg);
    svgEl('rect', { x: -4000, y: -4000, width: 9000, height: 9000, fill: 'transparent' }, svg);
    this.gLinks = svgEl('g', { class: 'dv-links' }, svg);
    const g86 = svgEl('g', { transform: `translate(${this.L.p86[0]} ${this.L.p86[1]})` }, svg);
    const g87 = svgEl('g', { transform: `translate(${this.L.p87[0]} ${this.L.p87[1]})` }, svg);
    this.build86(g86);
    this.build87(g87);
    this.buildLinks();
    this.buildLegend(svg);
    this.rebuildChips();
    this.barrelDrawn = null;
  }

  buildDefs(svg) {
    const defs = svgEl('defs', null, svg);
    const lg = (id, stops, x2 = 0, y2 = 1) => {
      const g = svgEl('linearGradient', { id, x1: 0, y1: 0, x2, y2 }, defs);
      stops.forEach(([o, c, op]) => svgEl('stop', { offset: o, 'stop-color': c, 'stop-opacity': op === undefined ? 1 : op }, g));
    };
    lg('dv-si', [[0, dieP().siA], [0.45, dieP().siB], [1, dieP().siC]], 1, 1);
    lg('dv-si87', [[0, dieP().si87A], [1, dieP().si87B]], 1, 1);
    lg('dv-sheen', [[0, THEME.text, 0.07], [0.35, THEME.text, 0], [0.7, THEME.lavender, 0.04], [1, THEME.text, 0]], 1, 1);
    lg('dv-padg', [[0, dieP().padHi], [0.5, THEME.gold], [1, dieP().padLo]]);
    const rom = svgEl('pattern', { id: 'dv-rom', width: 8, height: 8, patternUnits: 'userSpaceOnUse' }, defs);
    svgEl('rect', { x: 0, y: 0, width: 8, height: 8, fill: THEME.panel }, rom);
    svgEl('rect', { x: 1, y: 2, width: 5, height: 2, fill: dieP().romCell }, rom);
    svgEl('rect', { x: 0, y: 6, width: 8, height: 0.8, fill: dieP().romLine }, rom);
    const f = svgEl('filter', { id: 'dv-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    svgEl('feGaussianBlur', { stdDeviation: 3, result: 'b' }, f);
    const mg = svgEl('feMerge', null, f);
    svgEl('feMergeNode', { in: 'b' }, mg);
    svgEl('feMergeNode', { in: 'SourceGraphic' }, mg);
  }

  // Faint metal-layer texture drawn once on a canvas (seeded, so it is stable).
  static texture(w, h, seed) {
    const key = w + 'x' + h + ':' + seed + ':' + THEME.void;
    DieView.texCache = DieView.texCache || {};
    if (DieView.texCache[key]) return DieView.texCache[key];
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let band = 0; band < h; band += 6 + rnd() * 10) {
      let x = rnd() * 40;
      while (x < w) {
        const len = 20 + rnd() * 180;
        ctx.strokeStyle = rnd() < 0.5 ? dvA(THEME.muted, 0.07) : dvA(THEME.gold, 0.045);
        ctx.lineWidth = 1 + rnd() * 2.2;
        ctx.beginPath(); ctx.moveTo(x, band); ctx.lineTo(Math.min(w, x + len), band); ctx.stroke();
        x += len + 4 + rnd() * 30;
      }
    }
    for (let x = 0; x < w; x += 5 + rnd() * 14) {
      let y = rnd() * 60;
      while (y < h) {
        const len = 12 + rnd() * 90;
        ctx.strokeStyle = dvA(THEME.ceramicHi, 0.07);
        ctx.lineWidth = 0.8 + rnd();
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, Math.min(h, y + len)); ctx.stroke();
        y += len + 10 + rnd() * 50;
      }
    }
    for (let i = 0; i < w * h / 900; i++) {
      ctx.fillStyle = dvA(THEME.text, 0.06);
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    let url = '';
    try { url = cv.toDataURL('image/png'); } catch (e) { url = ''; }
    DieView.texCache[key] = url;
    return url;
  }

  // ---------- small SVG helpers ----------
  txt(p, s, x, y, size, cls, anchor, extra) {
    const t = svgEl('text', Object.assign({ x, y, 'font-size': size, class: cls || 'dv-v', 'text-anchor': anchor || 'start' }, extra || {}), p);
    t.textContent = s;
    return t;
  }
  silk(p, s, x, y, size, cls, anchor) {
    const w = strokeTextWidth(s, size, 1.4);
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    return svgEl('path', { d: strokeTextPath(s, x0, y, size, 1.4), class: cls || 'dv-silk' }, p);
  }
  info(id) { return DIE_INFO[id]; }
  get fpuName() { return '8087'; }
  // geometry of the prefetch queue chips (die units)
  get QX0() { return 727; }
  get QDX() { return 32; }
  get QY() { return 262; }
  get QH() { return 56; }
  get QN() { return 6; }       // bytes in the prefetch queue
  get QW() { return 28; }      // width of one byte chip
  get QF() { return 15; }      // font size of one byte chip
  qx(slot) { return this.QX0 + slot * this.QDX; }
  qy(slot) { return this.QY; }
  block(p, id, x, y, w, h, title, cls) {
    const info = this.info(id);
    const k3 = this.target3D(id) ? ' Double-click or Shift+Enter shows it on the 3D board.' : '';
    const g = svgEl('g', { class: 'dv-blk', tabindex: 0, role: 'button', 'aria-label': (info ? `${info[0]}: ${info[1]}` : id) + k3, 'data-id': id }, p);
    svgEl('rect', { class: 'dv-frame', x, y, width: w, height: h, rx: 6 }, g);
    this.els.heat[id] = svgEl('rect', { class: 'dv-heat' + (cls === 'l' ? ' dv-h8087' : ''), x, y, width: w, height: h, rx: 6 }, g);
    if (title) this.silk(g, title, x + 9, y + 8, 13, cls === 'l' ? 'dv-silk-l' : 'dv-silk');
    g.addEventListener('click', e => { e.stopPropagation(); this.select(id, g, true); });
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(id, g); } else if (e.key === 'Escape') this.select(null); });
    this.els.blocks[id] = g;
    return g;
  }
  flashRect(p, x, y, w, h, color, key) {
    const r = svgEl('rect', { x, y, width: w, height: h, rx: 4, fill: color, opacity: 0, 'pointer-events': 'none' }, p);
    if (key) this.els['fl_' + key] = r;
    return r;
  }
  setT(el, s) { if (el && el._t !== s) { el._t = s; el.textContent = s; } }
  setA(el, k, v) { if (!el) return; el._a = el._a || {}; if (el._a[k] !== v) { el._a[k] = v; el.setAttribute(k, v); } }
  setC(el, c) { if (el && el._c !== c) { el._c = c; el.setAttribute('class', c); } }

  // ---------- 8086 die ----------
  build86(g) {
    const E = this.els;
    this.g86 = g;
    // silicon, texture, sheen, scribe line
    svgEl('rect', { x: -6, y: -6, width: DIE_W + 12, height: DIE_H + 12, rx: 10, fill: dieP().dieShadow, stroke: THEME.line }, g);
    svgEl('rect', { x: 0, y: 0, width: DIE_W, height: DIE_H, rx: 4, fill: 'url(#dv-si)' }, g);
    const tex = DieView.texture(DIE_W, DIE_H, 8086);
    if (tex) svgEl('image', { href: tex, x: 0, y: 0, width: DIE_W, height: DIE_H, 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 0, y: 0, width: DIE_W, height: DIE_H, rx: 4, fill: 'url(#dv-sheen)', 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 3.5, y: 3.5, width: DIE_W - 7, height: DIE_H - 7, rx: 3, fill: 'none', stroke: dieP().scribe, 'stroke-width': 1, opacity: 0.6 }, g);
    // pad ring bus (address / data to the pads)
    E.ring = svgEl('rect', { x: 40, y: 40, width: DIE_W - 80, height: DIE_H - 80, rx: 8, fill: 'none', stroke: dieP().scribe, 'stroke-width': 3, opacity: 0.55 }, g);
    // unit regions: EU is an L shape (left datapath + control), BIU the top right
    svgEl('path', { d: 'M50 50H484V392H910V710H50Z', fill: dvA(THEME.phosphor, 0.025), stroke: dieP().regEU, 'stroke-width': 1.2, 'stroke-dasharray': '6 5', opacity: 0.8 }, g);
    svgEl('rect', { x: 494, y: 50, width: 416, height: 332, rx: 2, fill: dvA(THEME.cyan, 0.03), stroke: dieP().regBIU, 'stroke-width': 1.2, 'stroke-dasharray': '6 5', opacity: 0.8 }, g);
    const tab = (x, y, s, col) => {
      const w = strokeTextWidth(s, 9, 1.4) + 14;
      svgEl('rect', { x, y: y - 8, width: w, height: 16, rx: 3, fill: dieP().tabFill, stroke: col, 'stroke-width': 1.2 }, g);
      this.silk(g, s, x + 7, y - 4.5, 9, 'dv-silk');
    };
    // buses (drawn under the blocks)
    const bus = (d, col, w, op) => svgEl('path', { d, class: 'dv-bus', stroke: col, 'stroke-width': w, opacity: op }, g);
    E.euBus = bus('M256 56V398', dieP().busMain, 5, 0.55);
    E.linkBus = bus('M256 386H700', dieP().busMain, 5, 0.55);
    E.cBus = bus('M700 40V386', dieP().busMain, 5, 0.55);
    E.qBus = bus('M727 318V398H256', dieP().busQ, 3, 0.5);
    bus('M420 398V408', dieP().busQ, 3, 0.5);
    bus('M153 196V206H256', dieP().busMain, 3, 0.55);
    bus('M102 66V56H256M204 66V56', dieP().busMain, 3, 0.55);
    bus('M598 60V40', dieP().busA, 3, 0.7);
    bus('M902 110H918M902 150H918', dieP().busC, 2.4, 0.7);
    this.txt(g, 'ALU BUS 16', 264, 380, 12, 'dv-m');
    this.txt(g, 'Q BUS', 486, 394, 12, 'dv-m', 'end');
    this.txt(g, 'C BUS', 694, 380, 12, 'dv-m', 'end');

    this.buildAlu(g); this.buildFlags(g); this.buildRegs(g);
    this.buildSigma(g); this.buildSegs(g); this.buildBusCtl(g); this.buildQueue(g);
    this.buildDecoder(g); this.buildIntr(g); this.buildRom(g);
    tab(250, 46, 'EXECUTION UNIT  EU', dieP().regEU);
    tab(590, 46, 'BUS INTERFACE UNIT  BIU', dieP().regBIU);
    this.buildPads86(g);
    this.tokLayer = svgEl('g', { class: 'dv-toks', 'pointer-events': 'none' }, g);
  }

  buildAlu(g) {
    const b = this.block(g, 'alu', 60, 60, 186, 154, '');
    svgEl('path', { d: 'M64 68H138L153 88L168 68H242L206 198H100Z', fill: dieP().aluFill, stroke: THEME.gold, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, b);
    this.silk(b, 'ALU', 66, 176, 14, 'dv-silk-g');
    this.txt(b, 'TMP A', 101, 86, 12, 'dv-m', 'middle');
    this.txt(b, 'TMP B', 205, 86, 12, 'dv-m', 'middle');
    const E = this.els;
    E.aluA = this.txt(b, '----', 101, 112, 22, 'dv-v', 'middle', { 'font-weight': 600 });
    E.aluB = this.txt(b, '----', 205, 112, 22, 'dv-v', 'middle', { 'font-weight': 600 });
    E.aluSym = this.txt(b, '', 153, 113, 20, 'dv-go', 'middle', { 'font-weight': 700 });
    E.aluOp = this.txt(b, '', 153, 146, 20, 'dv-go', 'middle', { 'font-weight': 700 });
    E.aluR = this.txt(b, '', 153, 186, 22, 'dv-ph', 'middle', { 'font-weight': 700 });
    E.aluFl = this.flashRect(b, 100, 164, 106, 30, dvA(THEME.phosphor, 0.22));
  }
  buildFlags(g) {
    const b = this.block(g, 'flags', 60, 226, 186, 126, 'FLAGS');
    const pos = [[64, 254], [101, 254], [138, 254], [175, 254], [212, 254], [82, 304], [119, 304], [156, 304], [193, 304]];
    DIE_FLAGS.forEach(([n, bit], i) => {
      const [x, y] = pos[i];
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y, width: 34, height: 44, rx: 4 }, c);
      this.txt(c, n, x + 17, y + 15, 12, 'dv-m', 'middle', { 'font-weight': 600 });
      const v = this.txt(c, '0', x + 17, y + 38, 20, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      const fl = this.flashRect(c, x, y, 34, 44, dvA(THEME.phosphor, 0.45));
      this.els.flags.push({ n, bit, c, v, fl });
    });
  }
  buildRegs(g) {
    const b = this.block(g, 'regs', 266, 60, 208, 292, 'REGISTERS');
    DIE_REGS.forEach((r, i) => {
      const y = 88 + i * 32;
      svgEl('rect', { x: 272, y: y + 2, width: 196, height: 29, rx: 4, fill: i % 2 ? dieP().row0 : dieP().row1, opacity: 0.9 }, b);
      const fl = this.flashRect(b, 272, y + 2, 196, 29, dvA(THEME.phosphor, 0.3));
      this.txt(b, r, 280, y + 24, 18, 'dv-m', 'start', { 'font-weight': 700 });
      let hi = null, lo;
      if (i < 4) {
        this.txt(b, r[0] + 'H', 336, y + 23, 11, 'dv-f', 'end');
        this.txt(b, r[0] + 'L', 410, y + 23, 11, 'dv-f', 'end');
        hi = this.txt(b, '00', 372, y + 25, 23, 'dv-v', 'end', { 'font-weight': 600 });
        lo = this.txt(b, '00', 460, y + 25, 23, 'dv-v', 'end', { 'font-weight': 600 });
      } else lo = this.txt(b, '0000', 460, y + 25, 23, 'dv-v', 'end', { 'font-weight': 600 });
      this.els.regs[r] = { hi, lo, fl, y: y + 16, x: 272 };
    });
  }
  buildSigma(g) {
    const b = this.block(g, 'sigma', 506, 60, 184, 136, 'ADDRESS ADDER');
    const E = this.els;
    E.sgL1 = this.txt(b, 'CS×16', 514, 110, 14, 'dv-m');
    E.sgV1 = this.txt(b, '00000', 682, 110, 21, 'dv-cy', 'end', { 'font-weight': 600 });
    this.txt(b, '+ off', 514, 138, 14, 'dv-m');
    E.sgV2 = this.txt(b, '0000', 682, 138, 21, 'dv-cy', 'end', { 'font-weight': 600 });
    svgEl('line', { x1: 514, y1: 149, x2: 682, y2: 149, stroke: dieP().busA, 'stroke-width': 1.2 }, b);
    this.txt(b, 'Σ', 514, 181, 18, 'dv-cy', 'start', { 'font-weight': 700 });
    E.sgV3 = this.txt(b, '00000', 682, 181, 25, 'dv-cy', 'end', { 'font-weight': 700 });
    E.sgFl = this.flashRect(b, 510, 155, 176, 34, dvA(THEME.cyan, 0.25));
  }
  buildSegs(g) {
    const b = this.block(g, 'segs', 506, 200, 184, 176, 'SEGMENT REGS');
    DIE_SEGS.forEach((r, i) => {
      const y = 228 + i * 28;
      svgEl('rect', { x: 512, y: y + 1, width: 172, height: 26, rx: 4, fill: i % 2 ? dieP().row0 : dieP().row1, opacity: 0.9 }, b);
      const fl = this.flashRect(b, 512, y + 1, 172, 26, r === 'IP' ? dvA(THEME.phosphor, 0.18) : dvA(THEME.phosphor, 0.3));
      this.txt(b, r, 520, y + 21, 17, r === 'IP' ? 'dv-ph' : 'dv-cy', 'start', { 'font-weight': 700 });
      const lo = this.txt(b, '0000', 676, y + 22, 22, 'dv-v', 'end', { 'font-weight': 600 });
      this.els.regs[r] = { lo, fl, y: y + 14, x: 690 };
    });
  }
  buildBusCtl(g) {
    const b = this.block(g, 'busctl', 710, 60, 192, 136, 'BUS CONTROL');
    const E = this.els;
    E.bcType = this.txt(b, 'PASSIVE', 718, 106, 17, 'dv-m', 'start', { 'font-weight': 700 });
    this.txt(b, 'S2S1S0', 718, 132, 13, 'dv-m');
    E.bcS = this.txt(b, '111', 776, 133, 20, 'dv-mg', 'start', { 'font-weight': 700 });
    E.bcQS = this.txt(b, '', 896, 133, 15, 'dv-mg', 'end', { 'font-weight': 700 });
    E.bcT = [];
    for (let i = 0; i < 4; i++) {
      const c = svgEl('g', { class: 'dv-tstate' }, b);
      svgEl('rect', { x: 718 + i * 45, y: 142, width: 41, height: 22, rx: 4 }, c);
      this.txt(c, 'T' + (i + 1), 738.5 + i * 45, 158, 14, 'dv-m', 'middle', { 'font-weight': 700 });
      E.bcT.push(c);
    }
    E.bcAddr = this.txt(b, '', 718, 188, 15, 'dv-cy', 'start', { 'font-weight': 600 });
    E.bcData = this.txt(b, '', 896, 188, 15, 'dv-go', 'end', { 'font-weight': 600 });
  }
  buildQueue(g) {
    const b = this.block(g, 'queue', 710, 200, 192, 176, 'QUEUE');
    this.txt(b, '6 BYTES', 896, 222, 12, 'dv-f', 'end');
    for (let i = 0; i < 6; i++) {
      svgEl('rect', { x: 712 + i * 32 + 1, y: 262, width: 28, height: 56, rx: 4, fill: 'none', stroke: dieP().cellStroke, 'stroke-dasharray': '3 3' }, b);
      this.txt(b, String(i), 727 + i * 32, 334, 11, 'dv-f', 'middle');
    }
    this.txt(b, '◀ EU', 714, 364, 14, 'dv-ph', 'start', { 'font-weight': 700 });
    this.txt(b, 'from bus', 898, 252, 11, 'dv-f', 'end');
    this.els.qCount = this.txt(b, '0/6', 898, 364, 15, 'dv-m', 'end', { 'font-weight': 700 });
    this.chipLayer = svgEl('g', { 'pointer-events': 'none' }, b);
  }
  buildDecoder(g) {
    const b = this.block(g, 'dec', 60, 408, 414, 152, 'DECODER · GROUP DECODE ROM');
    const E = this.els;
    E.decText = this.txt(b, '', 72, 474, 26, 'dv-ph', 'start', { 'font-weight': 700 });
    E.decBytes = this.txt(b, '', 72, 508, 18, 'dv-go', 'start', { 'font-weight': 600 });
    E.decAddr = this.txt(b, '', 464, 508, 15, 'dv-m', 'end');
    this.txt(b, 'LOADER · TRANSLATION ROM', 72, 546, 12, 'dv-f');
    E.decClk = this.txt(b, '', 464, 546, 16, 'dv-m', 'end', { 'font-weight': 700 });
    E.decFl = this.flashRect(b, 66, 444, 402, 40, dvA(THEME.phosphor, 0.14));
  }
  buildIntr(g) {
    const b = this.block(g, 'intr', 60, 572, 414, 132, 'INTERRUPTS · TIMING');
    const E = this.els;
    E.intText = this.txt(b, 'no interrupt', 72, 628, 21, 'dv-f', 'start', { 'font-weight': 700 });
    E.intSub = this.txt(b, '', 72, 654, 14, 'dv-m');
    this.txt(b, 'CLK', 72, 690, 14, 'dv-m', 'start', { 'font-weight': 700 });
    E.clkDot = svgEl('circle', { cx: 116, cy: 685, r: 7, fill: dieP().dot }, b);
    E.clkText = this.txt(b, this.mhz(), 132, 690, 14, 'dv-f');
    E.intFl = this.flashRect(b, 66, 606, 402, 30, dvA(THEME.magenta, 0.2));
  }
  buildRom(g) {
    const b = this.block(g, 'rom', 494, 408, 408, 296, 'MICROCODE ROM');
    this.txt(b, '512 × 21 bits', 894, 424, 13, 'dv-m', 'end');
    svgEl('rect', { x: 506, y: 438, width: 384, height: 220, fill: 'url(#dv-rom)', stroke: dieP().cellStroke }, b);
    svgEl('rect', { x: 506, y: 662, width: 384, height: 12, fill: dieP().romLine2, stroke: dieP().cellStroke }, b);
    this.txt(b, 'µ-SEQUENCER · µ-ADDRESS', 506, 696, 12, 'dv-f');
    this.silk(b, '8086', 890, 684, 14, 'dv-silk-g', 'end');
    this.els.romRow = svgEl('rect', { x: 506, y: 438, width: 384, height: 8, fill: dvA(THEME.phosphor, 0.55), opacity: 0 }, b);
    this.els.romCol = svgEl('rect', { x: 506, y: 662, width: 20, height: 12, fill: dvA(THEME.phosphor, 0.7), opacity: 0 }, b);
  }
  static padPos86(pin) {
    const i = (pin - 1) % 10, side = Math.floor((pin - 1) / 10);
    const sp = 62, spH = 82;
    if (side === 0) return { x: 21, y: 70 + (i + 0.5) * sp, v: true, side: 'l' };
    if (side === 1) return { x: 70 + (i + 0.5) * spH, y: DIE_H - 21, v: false, side: 'b' };
    if (side === 2) return { x: DIE_W - 21, y: DIE_H - 70 - (i + 0.5) * sp, v: true, side: 'r' };
    return { x: DIE_W - 70 - (i + 0.5) * spH, y: 21, v: false, side: 't' };
  }
  buildPads86(g) {
    const pg = this.block(g, 'pads', 0, 0, 0, 0, '');
    pg.querySelector('.dv-frame').setAttribute('display', 'none');
    for (let pin = 1; pin <= 40; pin++) {
      const p = DieView.padPos86(pin), name = DIE_PINS[pin - 1];
      const out = 16;
      const [bx, by] = p.side === 'l' ? [-out, p.y] : p.side === 'r' ? [DIE_W + out, p.y] : p.side === 't' ? [p.x, -out] : [p.x, DIE_H + out];
      svgEl('line', { x1: p.x, y1: p.y, x2: bx, y2: by, stroke: dieP().bond, 'stroke-width': 1.3, opacity: 0.55 }, pg);
      const c = svgEl('g', { class: 'dv-pad' + (name === 'MN/MX' ? ' dv-tie' : '') }, pg);
      const w = p.v ? 28 : 72, h = p.v ? 58 : 28;
      svgEl('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 3 }, c);
      const t = this.txt(c, name, p.x, p.y + 5, 14, '', 'middle', p.v ? { transform: `rotate(-90 ${p.x} ${p.y})` } : null);
      t.removeAttribute('class');
      svgEl('title', null, c).textContent = `Pin ${pin}: ${name}` + (name === 'MN/MX' ? ' (tied low: maximum mode)' : '');
      this.els.pads.push({ c, pin, name, p });
    }
  }

  // ---------- 8087 die ----------
  static padPos87(side, i) {
    // 14 pads on the top and bottom, 7 on the left, 5 on the right (40 in all)
    if (side === 't') return { x: 50 + (i + 0.5) * 45.7, y: 16, v: false };
    if (side === 'b') return { x: 50 + (i + 0.5) * 45.7, y: FPU_H - 16, v: false };
    if (side === 'l') return { x: 16, y: 40 + (i + 0.5) * 34.3, v: true };
    return { x: FPU_W - 16, y: 40 + (i + 0.5) * 48, v: true };
  }
  link87() {
    // Which 8087 pad slot each link pin uses in this layout (the side that faces the 8086).
    if (this.L.side === 'left') {
      return { 'RQ/GT0': ['l', 0], S2: ['l', 1], S1: ['l', 2], S0: ['l', 3], QS0: ['l', 4], QS1: ['l', 5], BUSY: ['l', 6], INT: ['b', 0] };
    }
    return { 'RQ/GT0': ['t', 7], S2: ['t', 8], S1: ['t', 9], S0: ['t', 10], QS0: ['t', 11], QS1: ['t', 12], BUSY: ['t', 13], INT: ['t', 3] };
  }
  build87(g) {
    const E = this.els, F = E.f87;
    this.g87 = g;
    svgEl('rect', { x: -6, y: -6, width: FPU_W + 12, height: FPU_H + 12, rx: 10, fill: dieP().dieShadow, stroke: THEME.line }, g);
    svgEl('rect', { x: 0, y: 0, width: FPU_W, height: FPU_H, rx: 4, fill: 'url(#dv-si87)' }, g);
    const tex = DieView.texture(FPU_W, FPU_H, 8087);
    if (tex) svgEl('image', { href: tex, x: 0, y: 0, width: FPU_W, height: FPU_H, 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 0, y: 0, width: FPU_W, height: FPU_H, rx: 4, fill: 'url(#dv-sheen)', 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 3.5, y: 3.5, width: FPU_W - 7, height: FPU_H - 7, rx: 3, fill: 'none', stroke: dieP().scribe, opacity: 0.6 }, g);
    const map = this.link87(), bySlot = {};
    for (const k in map) bySlot[map[k].join()] = k;
    F.pads = {};
    const lab = svgEl('g', null, null);
    for (const [side, n] of [['t', 14], ['b', 14], ['l', 7], ['r', 5]]) {
      for (let i = 0; i < n; i++) {
        const p = DieView.padPos87(side, i), name = bySlot[side + ',' + i];
        const c = svgEl('g', { class: 'dv-pad' }, g);
        const w = p.v ? 22 : 34, h = p.v ? 26 : 22;
        svgEl('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 3 }, c);
        if (!name) continue;
        F.pads[name] = { c, p, side };
        if (side === 'l') this.txt(lab, name, 32, p.y + 5, 13, 'dv-lv', 'start', { 'font-weight': 700 });
        else if (side === 't') this.txt(lab, name, p.x, 44, 12, 'dv-lv', 'middle', { 'font-weight': 700 });
        else this.txt(lab, name, p.x + 19, p.y - 14, 11, 'dv-lv', 'start', { 'font-weight': 700 });
        svgEl('title', null, c).textContent = this.fpuName + ' ' + name;
      }
    }
    g.appendChild(lab);
    const left = this.L.side === 'left';
    const x0 = left ? 100 : 40, top = left ? 34 : 52, bot = FPU_H - 32;
    // control unit: queue tracker (8087) or bus interface (80287), status word, control word
    const qw = 348;
    this.buildFpuTop(g, x0, top, qw);
    const sy = top + 78, bh = bot - sy, cw = (qw - 8) / 2;
    const sw = this.block(g, 'f87sw', x0, sy, cw, bh, 'STATUS', 'l');
    F.swHex = this.txt(sw, '0000', x0 + cw - 8, sy + 21, 13, 'dv-lv', 'end', { 'font-weight': 600 });
    const cells = (p, names, x, y, w) => names.map((n, i) => {
      const c = svgEl('g', { class: 'dv-cell dv-l' }, p);
      svgEl('rect', { x: x + i * (w + 2), y, width: w, height: 38, rx: 4 }, c);
      this.txt(c, n, x + i * (w + 2) + w / 2, y + 13, 11, 'dv-m', 'middle');
      const t = this.txt(c, '0', x + i * (w + 2) + w / 2, y + 33, 17, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, t };
    });
    const ry = sy + 29, ry2 = Math.min(sy + 73, bot - 42);
    F.bsy = cells(sw, ['B'], x0 + 6, ry, 22)[0];
    F.cc = cells(sw, ['C3', 'C2', 'C1', 'C0'], x0 + 30, ry, 22);
    const tx = x0 + 126, tw = cw - 132;
    svgEl('rect', { x: tx, y: ry, width: tw, height: 38, rx: 4, fill: dieP().cellOnL, stroke: THEME.lavender }, sw);
    this.txt(sw, 'TOP', tx + tw / 2, ry + 13, 11, 'dv-m', 'middle');
    F.swTop = this.txt(sw, '0', tx + tw / 2, ry + 33, 17, 'dv-lv', 'middle', { 'font-weight': 700 });
    F.ex = cells(sw, ['IE', 'DE', 'ZE', 'OE', 'UE', 'PE'], x0 + 6, ry2, (cw - 22) / 6);
    const cx0 = x0 + cw + 8;
    const cwb = this.block(g, 'f87cw', cx0, sy, cw, bh, 'CONTROL', 'l');
    F.cwHex = this.txt(cwb, '0000', cx0 + cw - 8, sy + 21, 13, 'dv-lv', 'end', { 'font-weight': 600 });
    F.cwPC = this.txt(cwb, '', cx0 + 8, ry + 15, 14, 'dv-v');
    F.cwRC = this.txt(cwb, '', cx0 + 8, ry + 34, 14, 'dv-v');
    F.masks = cells(cwb, ['IM', 'DM', 'ZM', 'OM', 'UM', 'PM'], cx0 + 6, ry2, (cw - 22) / 6);
    // numeric execution unit: the register barrel
    const nx = x0 + qw + 10, nw = FPU_W - 30 - nx, nh = bot - top;
    const neu = this.block(g, 'f87neu', nx, top, nw, nh, 'REGISTER STACK', 'l');
    this.silk(neu, this.fpuName, nx + nw - 9, top + 8, 13, 'dv-silk-l', 'end');
    F.op = this.txt(neu, 'idle', nx + 10, top + 42, 14, 'dv-lv', 'start', { 'font-weight': 600 });
    this.opMax = Math.floor((nw - 18) / 8.45);
    F.opFl = this.flashRect(neu, nx + 4, top + 27, nw - 8, 22, dvA(THEME.lavender, 0.22));
    const cyb = top + 50 + (nh - 50) / 2, cxb = nx + nw / 2;
    const rOut = Math.min(nw / 2 - 42, (nh - 50) / 2 - 17), rIn = rOut * 0.42;
    this.bar = { cx: cxb, cy: cyb, rOut, rIn };
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, r = rOut + 15;
      this.txt(neu, 'ST' + i, cxb + r * Math.sin(a) * 1.18, cyb - r * Math.cos(a) + 5, i ? 12 : 14, i ? 'dv-m' : 'dv-lv', 'middle', { 'font-weight': 700 });
    }
    F.ring = svgEl('g', null, neu);
    F.seg = [];
    for (let p = 0; p < 8; p++) {
      const a0 = (p - 0.5) * Math.PI / 4 + 0.012, a1 = (p + 0.5) * Math.PI / 4 - 0.012;
      const P = (r, a) => `${(cxb + r * Math.sin(a)).toFixed(2)} ${(cyb - r * Math.cos(a)).toFixed(2)}`;
      const d = `M${P(rOut, a0)}A${rOut} ${rOut} 0 0 1 ${P(rOut, a1)}L${P(rIn, a1)}A${rIn} ${rIn} 0 0 0 ${P(rIn, a0)}Z`;
      const s = svgEl('path', { d, fill: dieP().segFill, stroke: dieP().segStroke, 'stroke-width': 1.2 }, F.ring);
      const tagArc = svgEl('path', { d: `M${P(rOut - 3, a0 + 0.03)}A${rOut - 3} ${rOut - 3} 0 0 1 ${P(rOut - 3, a1 - 0.03)}`, fill: 'none', stroke: THEME.faint, 'stroke-width': 3.5 }, F.ring);
      svgEl('title', null, s).textContent = 'Physical register R' + p;
      F.seg.push({ s, tagArc });
    }
    F.segText = [];
    for (let p = 0; p < 8; p++) {
      const v = this.txt(neu, '', cxb, cyb, 12, 'dv-v', 'middle', { 'font-weight': 600 });
      F.segText.push({ v });
    }
    svgEl('path', { d: `M${cxb - 7} ${cyb - rOut - 5}L${cxb + 7} ${cyb - rOut - 5}L${cxb} ${cyb - rOut + 5}Z`, fill: THEME.lavender, filter: 'url(#dv-glow)' }, neu);
    svgEl('circle', { cx: cxb, cy: cyb, r: rIn - 3, fill: dieP().tabFill, stroke: dieP().segStroke }, neu);
    this.silk(neu, 'TOP', cxb, cyb - 14, 7, 'dv-silk-l', 'middle');
    F.hubTop = this.txt(neu, '0', cxb, cyb + 14, 20, 'dv-lv', 'middle', { 'font-weight': 700 });
  }

  buildFpuTop(g, x0, top, qw) {
    const F = this.els.f87;
    const q = this.block(g, 'f87q', x0, top, qw, 72, 'QUEUE TRACKER', 'l');
    F.q = [];
    for (let i = 0; i < 6; i++) {
      const c = svgEl('g', { class: 'dv-cell dv-l' }, q);
      svgEl('rect', { x: x0 + 8 + i * 34, y: top + 30, width: 31, height: 34, rx: 4 }, c);
      const t = this.txt(c, '', x0 + 23.5 + i * 34, top + 53, 16, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      F.q.push({ c, t });
    }
    this.txt(q, 'QS1 QS0', x0 + qw - 8, top + 21, 12, 'dv-m', 'end');
    F.qs = this.txt(q, '00 idle', x0 + qw - 8, top + 53, 15, 'dv-lv', 'end', { 'font-weight': 700 });
  }

  // ---------- local-bus link wires ----------
  buildLinks() {
    const g = this.gLinks, L = this.L, E = this.els;
    const [ax, ay] = L.p86, [bx, by] = L.p87, map = this.link87();
    const pad86 = n => { const pin = DIE_PINS.indexOf(n) + 1; const p = DieView.padPos86(pin); return { x: ax + p.x, y: ay + p.y, side: p.side }; };
    const pad87 = n => { const [s, i] = map[n]; const p = DieView.padPos87(s, i); return { x: bx + p.x, y: by + p.y, side: s }; };
    E.wires = {};
    const wire = (id, pts, color, label) => {
      const d = 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L');
      const w = svgEl('path', { d, class: 'dv-wire', stroke: color, color }, g);
      E.wires[id] = w;
      if (label) this.txt(g, label[0], label[1], label[2], 11, 'dv-m', label[3] || 'start');
      return w;
    };
    const pins = [['RQ/GT0', 'RQ/GT0'], ['S2', 'S2'], ['S1', 'S1'], ['S0', 'S0'], ['QS0', 'QS0'], ['QS1', 'QS1'], ['TEST', 'BUSY']];
    const col = { 'RQ/GT0': THEME.lavender, TEST: THEME.magenta };
    const dieR = ax + DIE_W, dieB = ay + DIE_H;
    pins.forEach(([a, b], j) => {
      const s = pad86(a), t = pad87(b);
      const pts = [];
      if (L.side === 'left') {
        const lane = L.up ? dieR + 10 + j * 11 : bx - 10 - j * 11;
        if (s.side === 't') pts.push([s.x, s.y], [s.x, ay - 12], [lane, ay - 12]);
        else pts.push([dieR, s.y], [lane, s.y]);
        pts.push([lane, t.y], [bx, t.y]);
      } else {
        const lane = L.W - 10 - j * 10, ly = dieB + 86 - j * 9;
        if (s.side === 't') pts.push([s.x, s.y], [s.x, ay - 12], [lane, ay - 12]);
        else pts.push([dieR, s.y], [lane, s.y]);
        pts.push([lane, ly], [t.x, ly], [t.x, by]);
      }
      wire(a, pts, col[a] || THEME.magenta);
    });
    // INT (8087) -> NMI (8086)
    const n = pad86('NMI'), it = pad87('INT');
    if (L.side === 'left') wire('INT', [[it.x, by + FPU_H], [it.x, dieB + 26], [n.x, dieB + 26], [n.x, dieB]], THEME.lavender);
    else wire('INT', [[it.x, by], [it.x, dieB + 30], [n.x, dieB + 30], [n.x, dieB]], THEME.lavender);
    this.txt(g, 'INT → NMI', Math.min(it.x, n.x) - 8, dieB + (L.side === 'left' ? 30 : 34), 12, 'dv-lv', 'end', { 'font-weight': 700 });
    const hit = svgEl('g', { class: 'dv-blk', tabindex: 0, role: 'button', 'aria-label': DIE_INFO.link[0] + ': ' + DIE_INFO.link[1] }, g);
    const bb = L.side === 'left' ? [dieR + 2, ay + (L.up ? 60 : 180), bx - dieR - 4, L.up ? 520 : 560] : [dieR + 2, dieB + 30, L.W - dieR, 70];
    svgEl('rect', { x: bb[0], y: bb[1], width: bb[2], height: bb[3], fill: 'transparent' }, hit);
    hit.addEventListener('click', e => { e.stopPropagation(); this.select('link', hit); });
    hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select('link', hit); } });
    this.els.blocks.link = hit;
  }

  buildLegend(svg) {
    const [x, y] = this.L.legend, tall = this.kind === 'tall';
    const g = this.legend = svgEl('g', { class: 'dv-legend', transform: `translate(${x} ${y})`, 'aria-hidden': 'true' }, svg);
    this.silk(g, tall ? 'SIGNALS' : 'DIE FLOOR PLAN', 0, 0, tall ? 14 : 16, 'dv-silk-g');
    if (!tall) this.txt(g, this.legendSub(), 0, 42, 15, 'dv-m');
    const items = [[THEME.cyan, 'address'], [THEME.gold, 'data'], [THEME.magenta, 'control, status'], [THEME.lavender, this.fpuName], [THEME.phosphor, 'changed value']];
    items.forEach(([c, s], i) => {
      const lx = tall ? 0 : (i % 3) * 190, ly = tall ? 44 + i * 30 : 76 + Math.floor(i / 3) * 30;
      svgEl('rect', { x: lx, y: ly - 11, width: 22, height: 6, rx: 3, fill: c }, g);
      this.txt(g, s, lx + 30, ly - 3, 16, 'dv-v');
    });
    this.txt(g, tall ? 'Tap a block.' : 'Click a block for a description.', 0, tall ? 206 : 162, 15, 'dv-f');
    if (tall) {
      this.txt(g, 'Double-tap a block', 0, 228, 15, 'dv-f');
      this.txt(g, 'to see it in 3D.', 0, 248, 15, 'dv-f');
    } else this.txt(g, 'Double-click a part to see it on the 3D board.', 0, 184, 15, 'dv-f');
  }

  legendSub() { return 'Intel 8086 CPU and 8087 coprocessor, maximum mode'; }
  mhz() { return ((this.m.clockHz || 4772727) / 1e6).toFixed(2).replace(/0$/, '') + ' MHz'; }

  // ---------- selection / tooltip ----------
  // zoom: a click on a unit also zooms the view to the unit (its small text is then easy to read)
  select(id, g, zoom) {
    if (this.sel) this.sel.classList.remove('dv-sel');
    this.sel = null;
    if (!id) { this.tip.classList.remove('dv-on'); return; }
    const info = this.info(id);
    this.sel = g;
    g.classList.add('dv-sel');
    this.app.select('block', id);
    if (typeof Sfx !== 'undefined') Sfx.select();
    this.tip.innerHTML = '';
    htmlEl('b', null, this.tip, info[0]);
    this.tip.appendChild(document.createTextNode(info[1]));
    if (this.target3D(id)) htmlEl('i', null, this.tip, this.coarse() ? 'Double-tap to see this part on the 3D board.' : 'Double-click to see this part on the 3D board.');
    if (zoom && this.zoomToBlock(g)) { this.tip.classList.remove('dv-on'); setTimeout(() => { if (this.sel === g) this.placeTip(g); }, this.reduced ? 0 : 420); return; }
    this.placeTip(g);
  }
  // Zoom the view so that the unit g fills most of it (false: it is already about that size).
  zoomToBlock(g) {
    const V = this.vb, B = this.vb0, r = this.svg.getBoundingClientRect(), br = g.getBoundingClientRect();
    if (!V || !B || !r.width || !r.height || !br.width || !br.height) return false;
    const sx = V.w / r.width, sy = V.h / r.height;
    const bw = br.width * sx, bh = br.height * sy, cx = V.x + (br.left + br.width / 2 - r.left) * sx, cy = V.y + (br.top + br.height / 2 - r.top) * sy;
    // (room above or under the unit for its description)
    const z = clamp(Math.min(B.w / (bw * 1.35), B.h / (bh * 1.9)), 1, DV_ZMAX);
    if (Math.abs(Math.log(z / this.zv.z)) < 0.15 && br.left >= r.left && br.right <= r.right && br.top >= r.top && br.bottom <= r.bottom) return false;
    this.viewTo({ z, cx, cy }, true);
    return true;
  }
  placeTip(g) {
    const hr = this.host.getBoundingClientRect(), br = g.getBoundingClientRect();
    const tw = Math.min(480, hr.width * 0.9);
    this.tip.style.width = tw + 'px';
    const th = this.tip.offsetHeight || 150;
    let left = br.left - hr.left + br.width / 2 - tw / 2;
    left = clamp(left, 8, Math.max(8, hr.width - tw - 8));
    let top = br.bottom - hr.top + 10;
    if (top + th > hr.height - 56) top = Math.max(8, br.top - hr.top - th - 10);
    this.tip.style.left = left + 'px';
    this.tip.style.top = top + 'px';
    this.tip.classList.add('dv-on');
  }

  // ---------- zoom and pan (the SVG view box, so the text stays sharp) ----------
  coarse() { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
  buildZoom() {
    const t = this.tools = htmlEl('div', { class: 'dv-tools', role: 'group', 'aria-label': 'Zoom' }, this.root);
    const btn = (text, label, cls, fn) => {
      const b = htmlEl('button', { type: 'button', class: 'dv-zb' + cls, 'aria-label': label, title: label }, t, text);
      b.addEventListener('click', fn);
      return b;
    };
    this.zOut = btn('−', 'Zoom out (key minus)', ' dv-pm', () => this.zoomStep(1 / 1.6));
    this.zLbl = htmlEl('span', { class: 'dv-zl', 'aria-hidden': 'true' }, t, '1.0×');
    this.zIn = btn('+', 'Zoom in (key plus)', ' dv-pm', () => this.zoomStep(1.6));
    this.zFit = btn('Fit', 'Fit the dies in the view (key 0)', '', () => this.viewTo({ z: 1, cx: null, cy: null }, true));
    this.ptrs = new Map();
    this.drag = null;
    this.pinch = null;
    this.dragged = false;
    const s = this.svg;
    s.addEventListener('wheel', e => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const k = e.ctrlKey ? 0.01 : 0.0022;   // ctrlKey: a pinch on a touchpad
      this.select(null);
      this.zoomAt(this.zv.z * Math.exp(-e.deltaY * px * k), e.clientX, e.clientY, false);
    }, { passive: false });
    s.addEventListener('dragstart', e => e.preventDefault());
    s.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // (no native text selection or drag: it would cancel the pointer events)
      if (e.button === 0) { e.preventDefault(); const sel = window.getSelection && window.getSelection(); if (sel && sel.rangeCount) sel.removeAllRanges(); }
      this.ptrType = e.pointerType;
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (this.ptrs.size === 1) { this.dragged = false; this.drag = { id: e.pointerId, moved: false, x: e.clientX, y: e.clientY }; }
      else if (this.ptrs.size === 2) this.startPinch();
    });
    s.addEventListener('pointermove', e => {
      const p = this.ptrs.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pinch) { this.movePinch(); return; }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      if (!d.moved) {
        // a small move is still a click; a pan starts only when the view is zoomed in
        if (this.zv.z <= 1.001 || Math.hypot(p.x - p.x0, p.y - p.y0) < (e.pointerType === 'touch' ? 10 : 5)) return;
        d.moved = true;
        this.dragged = true;
        try { s.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ }
        s.classList.add('dv-pan');
        this.select(null);
        d.x = p.x0; d.y = p.y0;
      }
      this.panBy(p.x - d.x, p.y - d.y);
      d.x = p.x; d.y = p.y;
    });
    const up = e => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.delete(e.pointerId);
      if (this.pinch) {
        if (this.ptrs.size < 2) {
          // one finger stays down: it pans from here
          this.pinch = null;
          const rest = [...this.ptrs.entries()][0];
          this.drag = rest ? { id: rest[0], moved: true, x: rest[1].x, y: rest[1].y } : null;
        }
        return;
      }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      s.classList.remove('dv-pan');
      if (!d.moved && e.type === 'pointerup' && e.pointerType === 'touch') this.tapCheck(e);
    };
    s.addEventListener('pointerup', up);
    s.addEventListener('pointercancel', up);
    // after a pan or a pinch, the click that follows must not select a block
    s.addEventListener('click', e => { if (this.dragged) { this.dragged = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    s.addEventListener('dblclick', e => {
      if (this.ptrType === 'touch') return;   // touch uses tapCheck()
      const g = e.target.closest && e.target.closest('.dv-blk');
      if (!g) return;
      e.preventDefault();
      this.go3D(this.blockId(g));
    });
    this.root.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const g = e.target.closest && e.target.closest('.dv-blk');
      if (e.key === '+' || e.key === '=') this.zoomStep(1.6);
      else if (e.key === '-' || e.key === '_') this.zoomStep(1 / 1.6);
      else if (e.key === '0') this.viewTo({ z: 1, cx: null, cy: null }, true);
      else if (e.key === 'Enter' && e.shiftKey && g) this.go3D(this.blockId(g));
      else return;
      e.preventDefault();
    });
  }
  toolsRect() {
    const t = this.tools;
    if (!t || !t.offsetWidth) return null;
    return { x: t.offsetLeft - 4, y: t.offsetTop - 4, w: t.offsetWidth + 8, h: t.offsetHeight + 8 };
  }
  // Put the zoomed view box on the SVG. zv = { z, cx, cy }: the zoom and the centre (SVG units).
  applyView() {
    const B = this.vb0;
    if (!B) return;
    const Z = this.zv, z = Z.z = clamp(Z.z, 1, DV_ZMAX);
    const w = B.w / z, h = B.h / z;
    Z.cx = clamp(Z.cx === null ? B.x + B.w / 2 : Z.cx, B.x + w / 2, B.x + B.w - w / 2);
    Z.cy = clamp(Z.cy === null ? B.y + B.h / 2 : Z.cy, B.y + h / 2, B.y + B.h - h / 2);
    this.vb = { x: Z.cx - w / 2, y: Z.cy - h / 2, w, h };
    this.svg.setAttribute('viewBox', `${this.vb.x.toFixed(2)} ${this.vb.y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
    this.scale = this.baseS * z;
    const one = z <= 1.001;
    this.svg.classList.toggle('dv-zoomed', !one);
    if (this.zOut) {
      this.zOut.disabled = one;
      this.zIn.disabled = z >= DV_ZMAX - 0.001;
      this.zFit.disabled = one;
      this.zLbl.textContent = z.toFixed(1) + '×';
      // a disabled button loses the focus: give it to the SVG, so the keys keep working
      const f = this.root.ownerDocument.activeElement;
      if (f && f.disabled && this.tools.contains(f)) this.svg.focus({ preventScroll: true });
    }
  }
  // Zoom to z2 and keep the SVG point under the client point (px, py) in place (null: the centre).
  zoomAt(z2, px, py, anim) {
    const B = this.vb0, V = this.vb, r = this.svg.getBoundingClientRect();
    if (!B || !V || !r.width || !r.height) return;
    z2 = clamp(z2, 1, DV_ZMAX);
    const fx = px === null ? 0.5 : clamp((px - r.left) / r.width, 0, 1), fy = py === null ? 0.5 : clamp((py - r.top) / r.height, 0, 1);
    const w2 = B.w / z2, h2 = B.h / z2;
    this.viewTo({ z: z2, cx: V.x + fx * V.w + (0.5 - fx) * w2, cy: V.y + fy * V.h + (0.5 - fy) * h2 }, anim);
  }
  zoomStep(k) { this.select(null); this.zoomAt((this.zAnim ? this.zAnim.to.z : this.zv.z) * k, null, null, true); }
  panBy(dx, dy) {
    const V = this.vb, r = this.svg.getBoundingClientRect();
    if (!V || !r.width) return;
    this.zAnim = null;
    this.zv.cx -= dx / r.width * V.w;
    this.zv.cy -= dy / r.height * V.h;
    this.applyView();
  }
  // Go to a view; the buttons and keys ease into it (not with reduced motion).
  viewTo(t, anim) {
    const B = this.vb0;
    if (!B) return;
    if (!anim || this.reduced || !this.visible) {
      this.zAnim = null;
      this.zv = { z: t.z, cx: t.cx, cy: t.cy };
      this.applyView();
      return;
    }
    const cx = t.cx === null ? B.x + B.w / 2 : t.cx, cy = t.cy === null ? B.y + B.h / 2 : t.cy;
    this.zAnim = { from: { z: this.zv.z, cx: this.zv.cx, cy: this.zv.cy }, to: { z: t.z, cx, cy }, t0: performance.now(), dur: 240 };
    const win = this.host.ownerDocument.defaultView || window;
    const step = () => {
      const a = this.zAnim;
      if (!a) return;
      const u = clamp((performance.now() - a.t0) / a.dur, 0, 1), q = easeInOut(u);
      this.zv = {
        z: Math.exp(lerp(Math.log(a.from.z), Math.log(a.to.z), q)),
        cx: lerp(a.from.cx, a.to.cx, q), cy: lerp(a.from.cy, a.to.cy, q),
      };
      this.applyView();
      if (u < 1) win.requestAnimationFrame(step); else this.zAnim = null;
    };
    win.requestAnimationFrame(step);
  }
  startPinch() {
    const [a, b] = [...this.ptrs.values()], V = this.vb, r = this.svg.getBoundingClientRect();
    if (!V || !r.width) return;
    this.drag = null;
    this.dragged = true;
    this.zAnim = null;
    this.select(null);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: this.zv.z,
      px: V.x + (mx - r.left) / r.width * V.w, py: V.y + (my - r.top) / r.height * V.h };
  }
  // Two fingers: the SVG point under the first midpoint follows the midpoint (pinch zoom and pan).
  movePinch() {
    const [a, b] = [...this.ptrs.values()], P = this.pinch, B = this.vb0, r = this.svg.getBoundingClientRect();
    if (!a || !b || !B || !r.width) return;
    const z2 = clamp(P.z0 * Math.hypot(a.x - b.x, a.y - b.y) / P.d0, 1, DV_ZMAX);
    const fx = ((a.x + b.x) / 2 - r.left) / r.width, fy = ((a.y + b.y) / 2 - r.top) / r.height;
    const w2 = B.w / z2, h2 = B.h / z2;
    this.zv = { z: z2, cx: P.px + (0.5 - fx) * w2, cy: P.py + (0.5 - fy) * h2 };
    this.applyView();
  }
  // Touch: two taps on the same block in a short time act as a double-click.
  tapCheck(e) {
    const g = e.target && e.target.closest && e.target.closest('.dv-blk'), id = g ? this.blockId(g) : null;
    const now = e.timeStamp || performance.now(), L = this.lastTap;
    if (id && L && L.id === id && now - L.t < 450 && Math.hypot(e.clientX - L.x, e.clientY - L.y) < 36) {
      this.lastTap = null;
      // wait for the click events of this tap: they must not reach the board under the finger
      setTimeout(() => this.go3D(id), 180);
    } else this.lastTap = { id, t: now, x: e.clientX, y: e.clientY };
  }

  // ---------- double-click: show the part on the 3D board ----------
  blockId(g) {
    for (const k in this.els.blocks) if (this.els.blocks[k] === g) return k;
    return g.getAttribute('data-id');
  }
  target3D(id) { return (id && this.map3D()[id]) || null; }
  map3D() { return DIE_3D; }
  go3D(id) {
    const t = this.target3D(id), app = window.__app;
    if (!t || !app || typeof app.selectTab !== 'function') return;
    const now = performance.now();
    if (now - (this.go3DT || 0) < 600) return;
    this.go3DT = now;
    app.selectTab('board');
    const b = app.views && app.views.board;
    if (b && typeof b.focusChip === 'function') b.focusChip(t[0], t[1]);
  }

  // ---------- event handlers ----------
  onDecode(e, a) {
    this.mdl.dec = e;
    this.anims.dec = Object.assign(a, { n: this.cycles, minMs: 300 });
    this.flash('dec', a, 3, 500);
    this.renderDec();
  }
  onBus(e, a, type) {
    Object.assign(a, { n: 4, minMs: 220, e, type });
    this.anims.bus = a;
    this.mdl.bus = { e, type };
    if (e.owner === 'fpu') {
      this.anims.rq = Object.assign(this.anim(e.t), { n: 6, minMs: 500 });
      if (this.visible) this.renderBusText();
      return;
    }
    const segName = type === 'code' ? 'CS' : e.seg;
    if (segName && (type === 'code' || type === 'memr' || type === 'memw')) {
      const segv = this.mdl.regs[segName];
      this.mdl.sig = { seg: segName, segv, off: (e.addr - (segv << 4)) & 0xFFFF, phys: e.addr };
      this.flash('sig', a, 3, 350);
      this.renderSigma();
    }
    if (this.visible) this.renderBusText();
    const hexd = e.width === 2 ? hex4(e.data) : hex2(e.data);
    if (type === 'code' && e === this.flushAt && !this.flushDone) this.doFlush(e.t);
    if (type === 'code') {
      const byt = e.width === 2 ? hex2(e.data) + ' ' + hex2(e.data >> 8) : hex2(e.data);
      const tailX = this.qx(clamp(e.q.length - e.width, 0, 5));
      const tk = this.token(e.t, ['ring', { tail: tailX }], byt, THEME.gold, 1.4, 2.4, 260);
      this.qOps.push({ kind: 'fetch', q: e.q.slice(), a: tk || Object.assign(this.anim(e.t), { d: 1.4, n: 2.4, minMs: 260 }) });
    } else if (type === 'memr' || type === 'ior') {
      const dest = this.readDest(e);
      this.token(e.t, ['ring', dest], hexd, THEME.gold, 2, 2.2, 260);
    } else if (type === 'memw' || type === 'iow') {
      const src = this.writeSrc(e);
      this.token(e.t, [src, 'ring'], hexd, THEME.gold, 0, 2.6, 260);
    }
  }
  onQueue(e, a) {
    if (e.op === 'pop') {
      const codes = ['F'];
      for (let i = 1; i < Math.min(e.n, 6); i++) codes.push('S');
      this.anims.qs = Object.assign(a, { n: codes.length, minMs: 160 * codes.length, codes });
      this.qOps.push({ kind: 'pop', n: e.n, q: e.q.slice(), a: null });
      if (this.dec && this.tokensOn) {
        const b = this.dec.bytes.slice(0, 3).map(hex2).join(' ') + (this.dec.bytes.length > 3 ? '…' : '');
        this.token(e.t, ['qhead', 'dec'], b, THEME.phosphor, 0, 1.6, 240);
      }
    } else if (e.op === 'flush' && !this.flushDone) this.doFlush(e.t);
  }
  doFlush(t) {
    this.flushDone = true;
    this.anims.qs = Object.assign(this.anim(t), { n: 1, minMs: 300, codes: ['E'] });
    this.qOps.push({ kind: 'flush', a: null });
  }
  onEA(e, a) {
    this.mdl.sig = { seg: e.seg, segv: e.segv, off: e.off, phys: e.phys };
    this.flash('sig', a, 3, 400);
    this.renderSigma();
    this.token(e.t, [{ bus: 'eu', y: 330 }, 'sigma'], hex4(e.off), THEME.cyan, 0, 1.8, 240);
  }
  onAlu(e, a) {
    this.mdl.alu = e;
    this.anims.alu = Object.assign(a, { n: 3, minMs: 450 });
    this.renderAlu();
    const w = e.w === 16 ? hex4 : hex2;
    const ops = this.ops || [], mn = ops[0] || '';
    const one = /^(mul|imul|div|idiv)$/.test(mn);
    const srcA = one ? (e.op.endsWith('DIV') ? null : 'AX') : this.opSource(ops[1], e.a, e.w);
    const srcB = one ? this.opSource(ops[1], e.b, e.w) : this.opSource(ops[2], e.b, e.w);
    if (srcA) this.token(e.t, [srcA, 'aluA'], w(e.a), THEME.gold, 0, 1.6, 260);
    if (srcB) this.token(e.t, [srcB, 'aluB'], w(e.b), THEME.gold, 0.2, 1.6, 260);
  }
  // Where an operand comes from: a register, memory (via the BIU) or the queue (immediate).
  opSource(op, v, w) {
    if (!op) return null;
    const R = this.mdl.regs;
    const r16 = { ax: 'AX', bx: 'BX', cx: 'CX', dx: 'DX', sp: 'SP', bp: 'BP', si: 'SI', di: 'DI', cs: 'CS', ds: 'DS', ss: 'SS', es: 'ES' };
    const r8 = { al: 'AX', ah: 'AX', bl: 'BX', bh: 'BX', cl: 'CX', ch: 'CX', dl: 'DX', dh: 'DX' };
    if (r16[op]) return r16[op];
    if (r8[op]) return r8[op];
    if (op.includes('[')) return 'ring';
    if (/^(0x[0-9a-f]+|-?\d+)$/.test(op)) return 'qhead';
    for (const n of DIE_REGS) if ((w === 16 ? R[n] : R[n] & 0xFF) === v && v) return n;
    return null;
  }
  readDest(e) {
    const ops = this.ops || [];
    const r = this.opSource(ops[1], -1, 16);
    if (r && r !== 'ring' && r !== 'qhead') return r;
    return { bus: 'eu', y: 330 };
  }
  writeSrc(e) {
    const ops = this.ops || [], mn = ops[0] || '';
    if (mn === 'push' && ops[1]) { const r = this.opSource(ops[1], -1, 16); if (r && r !== 'ring' && r !== 'qhead') return r; }
    const r = this.opSource(ops[2], -1, 16);
    if (r && r !== 'ring' && r !== 'qhead') return r;
    const alu = this.mdl.alu;
    if (alu && this.anims.alu && this.anims.alu.serial === this.serial && (alu.r & 0xFFFF) === e.data) return 'aluOut';
    if (e.data === this.mdl.regs.IP || /^(call|int)/.test(mn)) return 'IP';
    return { bus: 'eu', y: 330 };
  }
  onReg(e, a) {
    const R = this.mdl.regs, old = R[e.r];
    R[e.r] = e.v;
    const ip = e.r === 'IP';
    const half = (old !== undefined && DIE_REGS.indexOf(e.r) >= 0 && DIE_REGS.indexOf(e.r) < 4) ? ((old ^ e.v) & 0xFF00 ? 2 : 0) | ((old ^ e.v) & 0xFF ? 1 : 0) : 3;
    this.renderReg(e.r, half);
    this.flash('reg:' + e.r, a, ip ? 3 : 6, ip ? 400 : 900);
    if (ip) return;
    // the value arrives from the ALU, from memory, or from another register
    let src = null;
    const evs = this.events || [];
    const alu = evs.filter(x => x.k === 'alu' && x.t <= e.t).pop();
    const w = e.v;
    if (alu && ((alu.r & 0xFFFF) === w || (alu.r & 0xFF) === (w & 0xFF) || (alu.r >>> 16) === w)) src = 'aluOut';
    else if (evs.some(x => x.k === 'bus' && x.owner === 'cpu' && (x.type === 'memr' || x.type === 'ior') && (x.data === w || x.data === (w & 0xFF) || x.data === (w >> 8)))) src = null;
    else {
      const ops = this.ops || [];
      const s = this.opSource(ops[2], -1, 16);
      if (s && s !== 'ring' && s !== e.r) src = s;
    }
    if (src) this.token(e.t, [src, e.r], hex4(e.v), THEME.phosphor, -1.2, 1.2, 240);
  }
  onFlags(e, a) {
    const ch = (e.old === undefined ? this.mdl.flags : e.old) ^ e.v;
    this.mdl.flags = e.v;
    for (const f of this.els.flags) if (ch & (1 << f.bit)) this.flash('flag:' + f.n, a, 6, 900);
    this.renderFlags();
  }
  onFpu(e, a) {
    this.mdl.fpuText = e.text;
    this.anims.fpu = Object.assign(a, { n: 8, minMs: 800 });
    const old = this.readFpu();
    this.flash('fpuop', a, 6, 900);
    if (old && this.fpuM) {
      for (let p = 0; p < 8; p++) if (old.vals[p] !== this.fpuM.vals[p] || old.tags[p] !== this.fpuM.tags[p]) this.flash('fseg:' + p, a, 8, 1200);
      if (old.sw !== this.fpuM.sw) this.flash('fsw', a, 6, 900);
    }
    this.renderFpu();
  }

  // ---------- flashes (highlights that fade over clocks) ----------
  flash(key, a, n, minMs) {
    if (!this.visible) return;
    this.flashes.set(key, { serial: a.serial, tc: a.tc, start: a.start, cms: a.cms, d: 0, n, minMs: this.reduced ? Math.max(minMs, 900) : minMs });
  }
  flashEl(key) {
    const E = this.els;
    if (key.startsWith('reg:')) { const r = E.regs[key.slice(4)]; return r && r.fl; }
    if (key.startsWith('flag:')) { const f = E.flags.find(x => x.n === key.slice(5)); return f && f.fl; }
    if (key.startsWith('fseg:')) return E.f87.seg[+key.slice(5)].s;
    return { sig: E.sgFl, dec: E.decFl, intr: E.intFl, fpuop: E.f87.opFl, fsw: null, alu: E.aluFl }[key] || null;
  }
  stepFlashes(now) {
    for (const [k, a] of this.flashes) {
      const p = this.prog(a, now);
      const el = this.flashEl(k);
      const v = p < 0 ? 0 : p >= 1 ? 0 : 1 - easeOut(p) * (this.reduced ? 0.6 : 1);
      if (k.startsWith('fseg:')) {
        if (el) this.setA(el, 'fill', v > 0.02 ? dvA(THEME.lavender, (0.15 + 0.5 * v).toFixed(2)) : dieP().segFill);
      } else if (el) this.setA(el, 'opacity', v.toFixed(2));
      if (p >= 1) {
        if (el && !k.startsWith('fseg:')) this.setA(el, 'opacity', '0');
        this.flashes.delete(k);
        if (k.startsWith('reg:')) this.renderReg(k.slice(4), 0);
      }
    }
    if (this.anims.alu) {
      const p = this.prog(this.anims.alu, now);
      this.setA(this.els.aluFl, 'opacity', p >= 0 && p < 1 ? (1 - p).toFixed(2) : '0');
    }
  }

  // ---------- tokens (values that travel along the buses) ----------
  point(spec) {
    // Each end point: the path from the end point to its bus, and the bus ('eu' x=256, 'c' x=700).
    const R = this.els.regs;
    if (typeof spec === 'object') {
      if (spec.tail) return { pts: [[spec.tail, 262], [spec.tail, 250], [700, 250]], bus: 'c' };
      if (spec.bus) return { pts: [[spec.bus === 'eu' ? 256 : 700, spec.y]], bus: spec.bus };
    }
    if (DIE_REGS.includes(spec)) return { pts: [[272, R[spec].y], [256, R[spec].y]], bus: 'eu' };
    if (DIE_SEGS.includes(spec)) return { pts: [[690, R[spec].y], [700, R[spec].y]], bus: 'c' };
    switch (spec) {
      case 'aluA': return { pts: [[101, 72], [101, 56], [256, 56]], bus: 'eu' };
      case 'aluB': return { pts: [[205, 72], [205, 56], [256, 56]], bus: 'eu' };
      case 'aluOut': return { pts: [[153, 196], [153, 206], [256, 206]], bus: 'eu' };
      case 'qhead': return { pts: [[727, 300], [727, 398], [256, 398]], bus: 'eu' };
      case 'dec': return { pts: [[420, 430], [420, 398], [256, 398]], bus: 'eu' };
      case 'sigma': return { pts: [[690, 124], [700, 124]], bus: 'c' };
      case 'ring': return { pts: [[700, 40]], bus: 'c' };
      default: return null;
    }
  }
  route(a, b) {
    const A = this.point(a), B = this.point(b);
    if (!A || !B) return null;
    let pts = A.pts.slice();
    const la = pts[pts.length - 1], Bp = B.pts.slice().reverse(), fb = Bp[0];
    if (a === 'qhead' && b === 'dec') pts = [[727, 300], [727, 398], [420, 398], [420, 430]];
    else {
      if (A.bus !== B.bus) {
        const [x1, x2] = A.bus === 'eu' ? [256, 700] : [700, 256];
        pts.push([x1, la[1]], [x1, 386], [x2, 386], [x2, fb[1]]);
      }
      pts = pts.concat(Bp);
    }
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
    return out;
  }
  token(t, ends, label, color, d, n, minMs) {
    if (!this.tokensOn || this.reduced || !this.visible || !this.tokLayer) return null;
    const pts = this.route(ends[0], ends[1]);
    if (!pts || pts.length < 2) return null;
    if (this.tokens.length > 14) this.killToken(this.tokens[0]);
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = lens[lens.length - 1];
    const g = svgEl('g', { class: 'dv-tok', opacity: 0 }, this.tokLayer);
    const trail = svgEl('path', { d: 'M' + pts.map(p => p.join(' ')).join('L'), fill: 'none', stroke: color, 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.85, 'stroke-dasharray': `0 ${total + 1}`, filter: 'url(#dv-glow)' }, g);
    const chip = svgEl('g', null, g);
    const tw = label.length * 9.6 + 12;
    svgEl('rect', { x: -tw / 2, y: -11, width: tw, height: 22, rx: 11, stroke: color }, chip);
    const tx = this.txt(chip, label, 0, 5.5, 15, '', 'middle', { fill: color });
    tx.removeAttribute('class');
    const a = Object.assign(this.anim(t), { d: d || 0, n, minMs, g, trail, chip, pts, lens, total });
    this.tokens.push(a);
    return a;
  }
  killToken(tk) {
    const i = this.tokens.indexOf(tk);
    if (i >= 0) this.tokens.splice(i, 1);
    if (tk.g && tk.g.parentNode) tk.g.parentNode.removeChild(tk.g);
  }
  clearTokens() { for (const t of this.tokens.slice()) this.killToken(t); }
  stepTokens(now) {
    for (const tk of this.tokens.slice()) {
      const p = this.prog(tk, now);
      if (p < 0) { this.setA(tk.g, 'opacity', '0'); continue; }
      if (p > 1.35) { this.killToken(tk); continue; }
      const q = easeInOut(clamp(p, 0, 1)), L = q * tk.total;
      let i = 1;
      while (i < tk.lens.length - 1 && tk.lens[i] < L) i++;
      const s = (L - tk.lens[i - 1]) / Math.max(1e-6, tk.lens[i] - tk.lens[i - 1]);
      const x = lerp(tk.pts[i - 1][0], tk.pts[i][0], clamp(s, 0, 1)), y = lerp(tk.pts[i - 1][1], tk.pts[i][1], clamp(s, 0, 1));
      tk.chip.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      tk.trail.setAttribute('stroke-dasharray', `${L.toFixed(1)} ${(tk.total + 1).toFixed(1)}`);
      const op = p < 0.08 ? p / 0.08 : p > 1 ? 1 - (p - 1) / 0.35 : 1;
      tk.g.setAttribute('opacity', clamp(op, 0, 1).toFixed(2));
    }
  }

  // ---------- queue ----------
  applyQOps(all) {
    const now = animNow();
    while (this.qOps.length) {
      const o = this.qOps[0];
      if (!all && o.a && this.prog(o.a, now) < 1) break;
      this.qOps.shift();
      if (o.kind === 'fetch') {
        const old = this.mdl.q;
        this.mdl.q = o.q.slice(0, this.QN);
        if (o.q.slice(0, old.length).join() === old.join()) {
          for (let i = old.length; i < this.mdl.q.length; i++) this.addChip(this.mdl.q[i], i, 'new');
        } else this.rebuildChips();
        if (!all) this.sfxTick(0.8);   // the fetched bytes get into the queue
      } else if (o.kind === 'pop') {
        const out = this.chips.splice(0, Math.min(o.n, this.chips.length));
        for (const c of out) { c.state = 'out'; c.born = now; c.ty = this.QY + 68; this.gone.push(c); }
        this.chips.forEach((c, i) => { c.slot = i; });
        this.mdl.q = o.q.slice(0, this.QN);
        if (this.chips.map(c => c.byte).join() !== this.mdl.q.join()) this.rebuildChips();
        this.mirror();
      } else if (o.kind === 'flush') {
        for (const c of this.chips) { c.state = 'dis'; c.born = now; c.ty = this.QY + 78; this.gone.push(c); }
        this.chips = [];
        this.mdl.q = [];
        this.mirror();
      }
      if (o.kind === 'fetch') this.mirror();
    }
    if (this.els && this.els.qCount) this.setT(this.els.qCount, this.mdl.q.length + '/' + this.QN);
  }
  addChip(byte, slot, state) {
    if (!this.chipLayer) return;
    const g = svgEl('g', { class: 'dv-chip' }, this.chipLayer);
    svgEl('rect', { x: -this.QW / 2, y: 0, width: this.QW, height: this.QH, rx: 4 }, g);
    const t = this.txt(g, hex2(byte), 0, this.QH / 2 + this.QF * 0.4, this.QF, '', 'middle');
    t.removeAttribute('class');
    const x = this.qx(slot), Y = this.qy(slot);
    const c = { g, byte, slot, x, y: state === 'new' && !this.reduced ? Y - 26 : Y, ty: Y, op: state === 'new' && !this.reduced ? 0 : 1, state, born: animNow() };
    this.chips.push(c);
    this.placeChip(c);
    return c;
  }
  rebuildChips() {
    this.gone = this.gone || [];
    for (const c of this.chips) c.g.remove();
    for (const c of this.gone) c.g.remove();
    this.chips = []; this.gone = [];
    this.mdl.q.forEach((b, i) => this.addChip(b, i, 'idle'));
    this.mirror();
  }
  placeChip(c) {
    c.g.setAttribute('transform', `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`);
    c.g.setAttribute('opacity', clamp(c.op, 0, 1).toFixed(2));
    const cls = 'dv-chip' + (c.state === 'new' ? ' dv-new' : c.state === 'out' ? ' dv-out' : c.state === 'dis' ? ' dv-dis' : c.slot === 0 ? ' dv-head' : '');
    this.setC(c.g, cls);
  }
  stepChips(dt) {
    this.gone = this.gone || [];
    const now = animNow();
    const tau = this.reduced ? 1 : clamp((this.manual ? 120 : this.cms * 1.2), 40, 180);
    const k = this.reduced ? 1 : 1 - Math.exp(-dt / tau);
    for (const c of this.chips) {
      const tx = this.qx(c.slot), ty = this.qy(c.slot);
      c.x += (tx - c.x) * k; c.y += (ty - c.y) * k; c.op += (1 - c.op) * k;
      if (c.state === 'new' && now - c.born > Math.max(350, this.cms * 4)) c.state = 'idle';
      this.placeChip(c);
    }
    for (const c of this.gone.slice()) {
      const age = (now - c.born) / (this.reduced ? 500 : clamp(this.cms * 4, 260, 700));
      this.qGone(c, age);
      if (age >= 1) { c.g.remove(); this.gone.splice(this.gone.indexOf(c), 1); } else this.placeChip(c);
    }
  }
  // A byte that leaves the queue (to the decoder) or that a flush removes: it falls and fades.
  qGone(c, age) {
    c.y = this.QY + easeOut(clamp(age, 0, 1)) * (c.state === 'dis' ? 60 : 50);
    c.op = 1 - age;
  }
  // The 8087 queue tracker holds the same bytes as the 8086 queue.
  mirror() {
    const F = this.els && this.els.f87;
    if (!F || !F.q) return;
    for (let i = 0; i < 6; i++) {
      const b = this.mdl.q[i];
      this.setT(F.q[i].t, b === undefined ? '' : hex2(b));
      this.setC(F.q[i].c, 'dv-cell dv-l' + (b === undefined ? '' : ' dv-on'));
    }
  }

  // ---------- pads, bus control, misc per frame ----------
  curBus(now) {
    const a = this.anims.bus;
    if (!a) return null;
    const p = this.prog(a, now);
    if (p < 0 || p >= 1) return null;
    return { a, e: a.e, type: a.type, T: Math.min(3, Math.floor(p * 4)) };
  }
  stepPads(now) {
    const st = {};
    const cur = this.curBus(now);
    const set = (name, cls) => { st[name] = cls; };
    if (cur) {
      const e = cur.e, T = cur.T, fpu = e.owner === 'fpu', type = cur.type;
      const A = fpu ? 'f' : 'a', D = fpu ? 'f' : 'd';
      const io = type === 'ior' || type === 'iow';
      const write = type === 'memw' || type === 'iow';
      const addr = type === 'inta' || type === 'halt' ? null : e.addr;
      for (let b = 0; b < 16; b++) {
        const n = 'AD' + b;
        if (T === 0) { if (addr !== null) set(n, A + ((addr >> b) & 1)); }
        else if (write || T >= 2) {
          const wd = e.width === 2 ? e.data : ((e.addr & 1) && !io ? e.data << 8 : e.data);
          if (type === 'inta' && b >= 8) continue;
          if (type !== 'halt') set(n, D + ((wd >> b) & 1));
        }
      }
      const hi = ['A16/S3', 'A17/S4', 'A18/S5', 'A19/S6'];
      if (T === 0) { if (addr !== null && !io) hi.forEach((n, i) => set(n, A + ((addr >> (16 + i)) & 1))); }
      else {
        const sc = DIE_SEGCODE[type === 'code' ? 'CS' : (e.seg || 'CS')];
        const bits = [sc & 1, sc >> 1, (this.mdl.flags >> 9) & 1, 0];
        hi.forEach((n, i) => set(n, 'c' + bits[i]));
      }
      if (T === 0) { const bhe = e.width === 2 || (e.addr & 1); if (bhe) set('BHE/S7', 'c1'); }
      if (T <= 1 && !fpu) {
        const s = DIE_STATUS[type] !== undefined ? DIE_STATUS[type] : 7;
        set('S0', 'c' + (s & 1)); set('S1', 'c' + ((s >> 1) & 1)); set('S2', 'c' + ((s >> 2) & 1));
      }
      if ((T === 1 || T === 2) && !fpu && (type === 'code' || type === 'memr' || type === 'ior')) set('RD', 'c1');
      if (type === 'inta') { set('LOCK', 'c1'); set('INTR', 'c1'); }
    }
    const qs = this.qsNow(now);
    if (qs) { const c = { F: 1, E: 2, S: 3 }[qs]; set('QS0', 'c' + (c & 1)); set('QS1', 'c' + (c >> 1)); }
    const it = this.anims.intr;
    if (it) {
      const p = this.prog(it, now);
      if (p >= 0 && p < 1) { if (it.e.src === 'irq') set('INTR', 'c1'); if (it.e.src === 'nmi') set('NMI', 'c1'); }
    }
    if (this.dec && /^lock/.test(this.dec.text) && this.anims.dec && this.prog(this.anims.dec, now) < 1) set('LOCK', 'c1');
    const busy = this.m.fpu && this.m.fpu.busyCycles > 0;
    if (busy) set('TEST', 'f1');
    const rq = this.anims.rq, rqp = rq ? this.prog(rq, now) : 2;
    if (rqp >= 0 && rqp < 1) set('RQ/GT0', 'f1');
    if (this.resetAt && now - this.resetAt < 900) set('RESET', 'c1');
    const playing = this.anims.dec && this.prog(this.anims.dec, now) < 1;
    if (playing && this.cms >= 12 && (this.vclock % 1) < 0.5) set('CLK', 'g1');
    set('READY', st.READY || '');
    for (const pd of this.els.pads) {
      const cls = st[pd.name];
      this.setC(pd.c, 'dv-pad' + (pd.name === 'MN/MX' ? ' dv-tie' : '') + (cls ? ' dv-' + cls : ''));
    }
    // AD ring colour
    const noAddr = cur && (cur.type === 'inta' || cur.type === 'halt');
    const ringCol = !cur ? dieP().scribe : cur.e.owner === 'fpu' ? THEME.lavender : cur.T === 0 ? (noAddr ? dieP().scribe : THEME.cyan) : (cur.T >= 2 || /w/.test(cur.type)) && cur.type !== 'halt' ? THEME.gold : dieP().scribe;
    this.setA(this.els.ring, 'stroke', ringCol);
    this.setA(this.els.ring, 'opacity', cur ? '0.9' : '0.55');
    // 8087 pads and wires
    const F = this.els.f87, W = this.els.wires;
    const on = (id, v) => { if (W[id]) this.setC(W[id], 'dv-wire' + (v ? ' dv-on' : '')); };
    on('S0', st.S0); on('S1', st.S1); on('S2', st.S2);
    on('QS0', st.QS0 === 'c1'); on('QS1', st.QS1 === 'c1');
    on('TEST', busy); on('RQ/GT0', rqp >= 0 && rqp < 1);
    const fint = this.m.fpu && this.m.fpu.intRequest;
    on('INT', fint || (it && it.e.src === 'nmi' && this.prog(it, now) < 1));
    const fp = (n, cls) => { if (F.pads[n]) this.setC(F.pads[n].c, 'dv-pad' + (cls ? ' dv-' + cls : '')); };
    fp('S0', st.S0); fp('S1', st.S1); fp('S2', st.S2); fp('QS0', st.QS0); fp('QS1', st.QS1);
    fp('BUSY', busy ? 'f1' : ''); fp('RQ/GT0', st['RQ/GT0']); fp('INT', fint ? 'f1' : '');
    this.setT(F.bsy.t, busy ? '1' : '0');
    this.setC(F.bsy.c, 'dv-cell dv-l' + (busy ? ' dv-on' : ''));
    const qsTxt = qs ? { F: '01  first byte', S: '11  next byte', E: '10  flushed' }[qs] : '00  idle';
    this.setT(F.qs, qsTxt);
    this.setT(this.els.bcQS, qs ? 'QS ' + qs : '');
  }
  qsNow(now) {
    const a = this.anims.qs;
    if (!a) return null;
    const p = this.prog(a, now);
    if (p < 0 || p >= 1) return null;
    return a.codes[Math.min(a.codes.length - 1, Math.floor(p * a.codes.length))];
  }
  stepBusCtl(now) {
    const E = this.els, cur = this.curBus(now);
    for (let i = 0; i < 4; i++) this.setC(E.bcT[i], 'dv-tstate' + (cur && cur.T === i ? ' dv-on' : ''));
    const type = cur ? cur.type : 'passive';
    const fpu = cur && cur.e.owner === 'fpu';
    this.setT(E.bcType, fpu ? '8087 ' + (DIE_CYCLE[type] || type) : DIE_CYCLE[type] || type);
    this.setA(E.bcType, 'class', !cur ? 'dv-m' : fpu ? 'dv-lv' : type === 'code' ? 'dv-go' : /io|inta/.test(type) ? 'dv-mg' : 'dv-go');
    const s = fpu ? 7 : DIE_STATUS[type];
    this.setT(E.bcS, cur && cur.T <= 1 ? bin(s === undefined ? 7 : s, 3) : '111');
  }
  renderBusText() {
    const b = this.mdl.bus, E = this.els;
    if (!b) { this.setT(E.bcAddr, ''); this.setT(E.bcData, ''); return; }
    const e = b.e, io = b.type === 'ior' || b.type === 'iow';
    this.setT(E.bcAddr, b.type === 'inta' ? 'vector' : io ? 'port ' + hex4(e.addr) : 'A ' + hex5(e.addr));
    this.setT(E.bcData, 'D ' + (e.width === 2 ? hex4(e.data) : hex2(e.data)));
  }
  stepBarrel(dt) {
    const F = this.els.f87, m = this.fpuM;
    if (!F || !F.ring || !m) return;
    let target = m.top, cur = this.barrel;
    let diff = ((target - cur) % 8 + 12) % 8 - 4;
    if (Math.abs(diff) < 0.001) { this.barrel = target; if (this.barrelDrawn === target) return; }
    else this.barrel = this.reduced ? target : cur + diff * (1 - Math.exp(-dt / 140));
    const rot = -this.barrel * 45;
    F.ring.setAttribute('transform', `rotate(${rot.toFixed(2)} ${this.bar.cx} ${this.bar.cy})`);
    const { cx, cy, rOut, rIn } = this.bar;
    for (let p = 0; p < 8; p++) {
      const a = (p - this.barrel) * Math.PI / 4;
      const rv = (rOut + rIn) / 2 + 1;
      this.setA(F.segText[p].v, 'x', (cx + rv * Math.sin(a)).toFixed(1));
      this.setA(F.segText[p].v, 'y', (cy - rv * Math.cos(a) + 4).toFixed(1));
    }
    this.barrelDrawn = Math.abs(diff) < 0.001 ? target : null;
  }
  stepHeat(dt) {
    const k = 1 - Math.exp(-dt / 300);
    const fastOn = this.lastFast && animNow() - this.lastFast < 160;
    for (const id in this.els.heat) {
      const t = fastOn ? (this.heatT[id] || 0) : 0;
      const h = this.heat[id] = (this.heat[id] || 0) + (t - (this.heat[id] || 0)) * k;
      this.setA(this.els.heat[id], 'opacity', (h * 0.9).toFixed(2));
    }
  }
  stepMisc(now) {
    const E = this.els;
    // microcode ROM activity row
    const dec = this.anims.dec;
    const fastOn = this.lastFast && now - this.lastFast < 160;
    let row = -1;
    if (dec && this.dec && dec.serial === this.serial) {
      const p = this.prog(dec, now);
      if (p >= 0 && p < 1) {
        const step = Math.floor(p * this.cycles / 2);
        const seed = (this.dec.bytes[0] || 0) * 13 + step * 7;
        row = (seed * 2654435761 >>> 0) % 27;
      }
    }
    if (fastOn) row = Math.floor(now / 70) % 27;
    if (row >= 0) {
      this.setA(E.romRow, 'y', String(438 + row * 8));
      this.setA(E.romRow, 'opacity', fastOn ? '0.35' : '0.9');
      this.setA(E.romCol, 'x', String(506 + (row * 37 % 18) * 20));
      this.setA(E.romCol, 'opacity', '0.9');
    } else { this.setA(E.romRow, 'opacity', '0'); this.setA(E.romCol, 'opacity', '0'); }
    // clock readout
    const playing = dec && this.prog(dec, now) < 1 && !fastOn;
    const c = playing ? Math.min(this.cycles, Math.max(0, Math.floor(this.vclock))) : 0;
    this.setT(E.decClk, playing ? `clock ${c} / ${this.cycles}` : '');
    this.setA(E.clkDot, 'fill', playing && (this.vclock % 1) < 0.5 ? THEME.phosphor : fastOn ? THEME.gold : dieP().dot);
    this.setT(E.clkText, fastOn ? 'free running' : playing ? `${this.cms >= 1 ? Math.round(this.cms) : this.cms.toFixed(1)} ms per clock` : this.mhz());
  }

  // ---------- static renders from the model ----------
  renderAll() {
    if (!this.els) return;
    for (const r of DIE_REGS.concat(DIE_SEGS)) this.renderReg(r, 0);
    this.renderFlags(); this.renderAlu(); this.renderSigma(); this.renderDec(); this.renderIntr(); this.renderFpu(); this.renderBusText();
    if (this.chips.map(c => c.byte).join() !== this.mdl.q.join()) this.rebuildChips();
    this.mirror();
    this.setT(this.els.qCount, this.mdl.q.length + '/' + this.QN);
  }
  renderReg(r, half) {
    const el = this.els.regs[r], v = this.mdl.regs[r] || 0;
    if (!el) return;
    if (el.hi) {
      this.setT(el.hi, hex2(v >> 8)); this.setT(el.lo, hex2(v));
      this.setA(el.hi, 'class', half & 2 ? 'dv-ph' : 'dv-v');
      this.setA(el.lo, 'class', half & 1 ? 'dv-ph' : 'dv-v');
    } else {
      this.setT(el.lo, hex4(v));
      this.setA(el.lo, 'class', half && r !== 'IP' ? 'dv-ph' : 'dv-v');
    }
  }
  renderFlags() {
    const f = this.mdl.flags;
    for (const x of this.els.flags) {
      const on = (f >> x.bit) & 1;
      this.setT(x.v, String(on));
      this.setC(x.c, 'dv-cell' + (on ? ' dv-on' : ''));
    }
  }
  renderAlu() {
    const E = this.els, a = this.mdl.alu;
    if (!a) { this.setT(E.aluA, '----'); this.setT(E.aluB, '----'); this.setT(E.aluOp, ''); this.setT(E.aluSym, ''); this.setT(E.aluR, ''); return; }
    const f = a.w === 16 ? hex4 : hex2;
    this.setT(E.aluA, f(a.a)); this.setT(E.aluB, f(a.b));
    const sym = DIE_OPSYM[a.op];
    this.setT(E.aluOp, a.op);
    this.setT(E.aluSym, sym || '');
    this.setT(E.aluR, '= ' + (a.r > 0xFFFF ? hex(a.r >>> 16, 4) + hex4(a.r) : f(a.r)));
    const b = this.els.blocks.alu;
    if (b) b.setAttribute('aria-label', `ALU: ${a.op} ${f(a.a)}, ${f(a.b)} = ${f(a.r)}. ` + DIE_INFO.alu[1]);
  }
  renderSigma() {
    const E = this.els, s = this.mdl.sig;
    if (!s) return;
    this.setT(E.sgL1, s.seg + '×16');
    this.setT(E.sgV1, hex5(s.segv << 4));
    this.setT(E.sgV2, hex4(s.off));
    this.setT(E.sgV3, hex5(s.phys));
  }
  renderDec() {
    const E = this.els, d = this.mdl.dec;
    if (!d) { this.setT(E.decText, ''); this.setT(E.decBytes, ''); this.setT(E.decAddr, ''); return; }
    const t = d.text.length > 30 ? d.text.slice(0, 29) + '…' : d.text;
    this.setT(E.decText, t);
    const by = (d.bytes || []).slice(0, 8).map(hex2).join(' ') + ((d.bytes || []).length > 8 ? ' …' : '');
    this.setT(E.decBytes, by);
    this.setT(E.decAddr, hex4(d.cs) + ':' + hex4(d.ip));
  }
  renderIntr() {
    const E = this.els, e = this.mdl.intr;
    if (!e) { this.setT(E.intText, 'no interrupt'); this.setA(E.intText, 'class', 'dv-f'); this.setT(E.intSub, 'INTR and NMI sampled between instructions'); return; }
    const src = { sw: 'software INT', irq: 'hardware IRQ on INTR', nmi: 'NMI', exc: 'exception' }[e.src] || e.src;
    this.setT(E.intText, `INT ${hex2(e.vec)}h · ${src}`);
    this.setA(E.intText, 'class', 'dv-mg');
    this.setT(E.intSub, `vector at 0000:${hex4(e.vec * 4)}` + (e.src === 'irq' ? ' · two INTA cycles, LOCK' : ''));
  }
  renderFpu() {
    const F = this.els.f87, m = this.fpuM;
    if (!F || !F.seg) return;
    const t = this.mdl.fpuText || 'idle';
    const mx = this.opMax || 28;
    this.setT(F.op, t.length > mx ? t.slice(0, mx - 1) + '…' : t);
    if (!m) return;
    this.setT(F.hubTop, String(m.top));
    this.setT(F.swTop, String(m.top));
    this.setT(F.swHex, hex4(m.sw) + 'h');
    this.setT(F.cwHex, hex4(m.cw) + 'h');
    const bit = (w, b) => (w >> b) & 1;
    [14, 10, 9, 8].forEach((b, i) => { this.setT(F.cc[i].t, String(bit(m.sw, b))); this.setC(F.cc[i].c, 'dv-cell dv-l' + (bit(m.sw, b) ? ' dv-on' : '')); });
    for (let i = 0; i < 6; i++) {
      this.setT(F.ex[i].t, String(bit(m.sw, i))); this.setC(F.ex[i].c, 'dv-cell dv-l' + (bit(m.sw, i) ? ' dv-on' : ''));
      this.setT(F.masks[i].t, String(bit(m.cw, i))); this.setC(F.masks[i].c, 'dv-cell dv-l' + (bit(m.cw, i) ? ' dv-on' : ''));
    }
    const pc = ['24-bit', 'resvd', '53-bit', '64-bit'][(m.cw >> 8) & 3], rc = ['nearest', 'down', 'up', 'chop'][(m.cw >> 10) & 3];
    this.setT(F.cwPC, 'PC ' + pc);
    this.setT(F.cwRC, 'RC ' + rc);
    const tagCol = [THEME.lavender, THEME.cyan, THEME.magenta, THEME.faint];
    for (let p = 0; p < 8; p++) {
      this.setT(F.segText[p].v, m.tags[p] === 3 ? '·' : m.vals[p]);
      this.setA(F.segText[p].v, 'class', m.tags[p] === 3 ? 'dv-f' : 'dv-v');
      this.setA(F.seg[p].tagArc, 'stroke', tagCol[m.tags[p]]);
      this.setA(F.seg[p].s, 'stroke', p === m.top ? dieP().segTop : dieP().segStroke);
    }
    this.barrelDrawn = null;
    const b = this.els.blocks.f87neu;
    if (b) b.setAttribute('aria-label', `8087 register stack, TOP ${m.top}: ` + [0, 1, 2, 3, 4, 5, 6, 7].map(i => `ST${i} ${m.vals[(m.top + i) & 7]}`).join(', '));
  }
}

// ======================================================================================
// 80286 die (app.model '80286'): Intel's four units. Address Unit (AU, top left),
// Bus Unit (BU, top right), Execution Unit (EU, bottom left) and Instruction Unit
// (IU, bottom right), 68 pads, and the 80287 with the processor extension interface.
// ======================================================================================

const D286_PINS = ['BHE', 'NC', 'NC', 'S1', 'S0', 'PEACK', 'A23', 'A22', 'VSS', 'A21',
  'A20', 'A19', 'A18', 'A17', 'A16', 'A15', 'A14', 'A13', 'A12', 'A11',
  'A10', 'A9', 'A8', 'A7', 'A6', 'A5', 'A4', 'A3', 'RESET', 'VCC',
  'CLK', 'A2', 'A1', 'A0', 'VSS', 'D0', 'D8', 'D1', 'D9', 'D2',
  'D10', 'D3', 'D11', 'D4', 'D12', 'D5', 'D13', 'D6', 'D14', 'D7',
  'D15', 'CAP', 'ERROR', 'BUSY', 'NC', 'NC', 'INTR', 'NC', 'NMI', 'VSS',
  'PEREQ', 'VCC', 'READY', 'HOLD', 'HLDA', 'COD/INTA', 'M/IO', 'LOCK'];
// COD/INTA, M/IO, S1, S0 for each bus cycle type (80286 data sheet)
const D286_STATUS = { inta: [0, 0, 0, 0], halt: [0, 1, 0, 0], memr: [0, 1, 0, 1], memw: [0, 1, 1, 0], ior: [1, 0, 0, 1], iow: [1, 0, 1, 0], code: [1, 1, 0, 1] };
const D286_EXC = { 0: ['#DE', 'DIVIDE ERROR'], 1: ['#DB', 'DEBUG'], 3: ['#BP', 'BREAKPOINT'], 4: ['#OF', 'OVERFLOW'],
  5: ['#BR', 'BOUND RANGE'], 6: ['#UD', 'INVALID OPCODE'], 7: ['#NM', 'NO MATH UNIT'], 8: ['#DF', 'DOUBLE FAULT'],
  9: ['#09', '287 OPERAND OVERRUN'], 10: ['#TS', 'INVALID TSS'], 11: ['#NP', 'SEGMENT NOT PRESENT'], 12: ['#SS', 'STACK FAULT'],
  13: ['#GP', 'GENERAL PROTECTION'], 16: ['#MF', 'MATH FAULT'] };
const D286_FLAGS = [['NT', 14], ['IOPL', 12], ['OF', 11], ['DF', 10], ['IF', 9], ['TF', 8], ['SF', 7], ['ZF', 6], ['AF', 4], ['PF', 2], ['CF', 0]];
const D286_SREGS = ['ES', 'CS', 'SS', 'DS'];
const dvHex6 = v => hex(v & 0xFFFFFF, 6);
const DIE286_INFO = {
  desc: ['Segment descriptor caches', 'The Address Unit keeps a hidden copy of each segment descriptor: selector, 24-bit base, 16-bit limit and access rights. A segment load reads the descriptor from the GDT or LDT once; later accesses use the cache.'],
  adder: ['Address adders', 'The offset adder makes the effective address; the physical address adder adds the segment base from the cache and makes a 24-bit address (16 MB).'],
  prot: ['Protection checker', 'Every access is checked in parallel with the address calculation: offset against the segment limit, access rights, and privilege (CPL, DPL, RPL). A violation raises #GP, #SS or #NP with an error code.'],
  sysr: ['System registers', 'MSW (PE protection enable, MP, EM, TS), GDTR and IDTR (base and limit of the descriptor tables), LDTR and TR (selector plus a hidden descriptor), and the current privilege level CPL.'],
  latch: ['Address latches and drivers', 'A23 to A0 are not multiplexed. The 80286 pipelines its bus: the address of the next cycle can go out during Tc of the current cycle.'],
  xcvr: ['Data transceivers', 'D15 to D0: 16-bit data in and out of the chip, word or byte (BHE and A0 select the halves).'],
  busctl: ['Bus control', 'Two-clock bus cycles: Ts (status out on S1 S0, M/IO and COD/INTA) and Tc (command); each wait state repeats Tc. The 82288 bus controller decodes the status.'],
  pfq: ['Prefetcher and prefetch queue', 'The prefetcher fetches code words into the 6-byte queue when the bus is free; a jump flushes it.'],
  pei: ['Processor extension interface', 'The 80287 asks for an operand transfer on PEREQ. The 80286 moves the operand between memory and the 80287 I/O ports (F8h to FFh) and answers on PEACK.'],
  dec: ['Instruction decoder', 'The Instruction Unit takes bytes from the prefetch queue and decodes them in advance.'],
  iq: ['Decoded instruction queue', 'Up to 3 fully decoded instructions wait here for the Execution Unit, so the EU seldom waits for decoding.'],
  alu: ['ALU', 'The 16-bit arithmetic/logic unit of the Execution Unit.'],
  flags: ['Flags register', 'The 8086 flags plus IOPL (bits 12 and 13, the I/O privilege level) and NT (bit 14, nested task).'],
  ctl: ['Control and microcode ROM', 'Microcode sequences each instruction. The line at the right shows the last interrupt or exception.'],
  regs: ['General registers', 'AX BX CX DX (with 8-bit halves), SP BP SI DI in the Execution Unit.'],
  pads: ['Pads (68 pins)', 'Non-multiplexed A23-A0 and D15-D0, status S1 S0 M/IO COD/INTA, BHE, LOCK, READY, HOLD/HLDA, INTR, NMI, the processor extension pins PEREQ PEACK BUSY ERROR, RESET, CLK and CAP (substrate filter capacitor).'],
  f87bi: ['80287 bus interface', 'The 80287 does not watch the CPU queue. The CPU writes opcodes and operands to I/O ports F8h to FFh; NPRD/NPWR select read or write, CMD0 (A1) and CMD1 (A2) select opcode, data or status.'],
  f87sw: ['80287 status word', 'Condition codes C3 to C0, TOP, the exception flags and BUSY. FSTSW AX copies it to AX.'],
  f87cw: ['80287 control word', 'Precision control, rounding control and the six exception masks.'],
  f87neu: ['80287 register stack', 'Eight 80-bit registers used as a circular stack. TOP selects the physical register that is ST(0).'],
  link: ['80286 to 80287', 'PEREQ/PEACK run operand transfers, BUSY makes the 80286 wait (WAIT, ESC), ERROR reports an unmasked 287 exception (#MF, vector 16; the PC/AT also raises IRQ13).'],
  npdec: ['82288 and port decode', 'The 82288 decodes S1 S0 M/IO into I/O read and write commands; with an address decode of F8h to FFh they become NPRD and NPWR. A1 and A2 become CMD0 and CMD1.'],
};
const DIE286_LAYOUTS = {
  wide: { W: 1820, H: 852, p86: [20, 50], p87: [1060, 528], side: 'left', up: false, legend: [1080, 330],
    keep: [[40, 70, 920, 720], [1084, 552, 700, 260]] },
  row: { W: 1820, H: 852, p86: [20, 50], p87: [1060, 50], side: 'left', up: true, legend: [1070, 440],
    keep: [[40, 70, 920, 720], [1070, 60, 720, 290]] },
  tall: { W: 1060, H: 1262, p86: [20, 50], p87: [260, 944], side: 'top', up: false, legend: null,
    keep: [[40, 70, 920, 720], [280, 968, 700, 260]] },
};

class Die286View extends DieView {
  constructor(host, app) {
    super(host, app);
    this.svg.setAttribute('aria-label', 'Die floor plans of the 80286 CPU and the 80287 coprocessor. The plus and minus keys zoom, the 0 key fits the dies.');
  }
  info(id) { return DIE286_INFO[id] || DIE_INFO[id]; }
  map3D() { return DIE286_3D; }
  get fpuName() { return '80287'; }
  get QX0() { return 548; }
  get QDX() { return 36; }
  get QY() { return 262; }
  get QH() { return 44; }
  layoutSet() { return DIE286_LAYOUTS; }
  legendSub() { return 'Intel 80286 CPU and 80287 coprocessor, 8 MHz'; }
  buildLegend(svg) {
    if (!this.L.legend) { this.legend = null; return; }
    super.buildLegend(svg);
  }

  // ---------- machine state ----------
  readMachine() {
    super.readMachine();
    const c = this.m.cpu, D = this.mdl.desc = this.mdl.desc || {};
    D286_SREGS.forEach((n, i) => {
      const d = c.cache && c.cache[i];
      D[n] = d ? { sel: d.sel, base: d.base, limit: d.limit, access: d.access, table: (c.msw & 1) ? '' : 'real' }
        : { sel: c.sregs[i], base: c.sregs[i] << 4, limit: 0xFFFF, access: 0x93, table: 'real' };
    });
    const cp = r => (r ? Object.assign({}, r) : null);
    this.mdl.sys = { msw: c.msw || 0, gdtr: cp(c.gdtr), idtr: cp(c.idtr), ldtr: cp(c.ldtr), tr: cp(c.tr), cpl: c.cpl || 0, known: !!c.cache };
  }
  // The next instructions after this one, for the decoded instruction queue.
  peekNext(n) {
    const m = this.m, out = [];
    if (typeof Disasm86 === 'undefined') return out;
    const base = m.csBase !== undefined ? m.csBase : m.cpu.sregs[1] << 4;
    let ip = m.cpu.ip;
    const rd = a => (m.peek8 ? m.peek8(a) : m.mem[a & (m.mem.length - 1)]);
    for (let k = 0; k < n; k++) {
      try {
        const d = Disasm86.decode(i => rd(base + ((ip + i) & 0xFFFF)), ip);
        out.push(d.text);
        ip = (ip + Math.max(1, d.len)) & 0xFFFF;
      } catch (e) { break; }
    }
    return out;
  }

  // ---------- 80286 die ----------
  static padPos286(pin) {
    const M = 50, sx = (DIE_W - 2 * M) / 17, sy = (DIE_H - 2 * M) / 17;
    if (pin >= 52) return { x: M + (pin - 52 + 0.5) * sx, y: 19, v: false, side: 't' };
    if (pin <= 17) return { x: DIE_W - 19, y: M + (pin - 1 + 0.5) * sy, v: true, side: 'r' };
    if (pin <= 34) return { x: DIE_W - M - (pin - 18 + 0.5) * sx, y: DIE_H - 19, v: false, side: 'b' };
    return { x: 19, y: DIE_H - M - (pin - 35 + 0.5) * sy, v: true, side: 'l' };
  }
  build86(g) {
    const E = this.els, P = dieP();
    this.g86 = g;
    E.desc = {};
    svgEl('rect', { x: -6, y: -6, width: DIE_W + 12, height: DIE_H + 12, rx: 10, fill: P.dieShadow, stroke: THEME.line }, g);
    svgEl('rect', { x: 0, y: 0, width: DIE_W, height: DIE_H, rx: 4, fill: 'url(#dv-si)' }, g);
    const tex = DieView.texture(DIE_W, DIE_H, 80286);
    if (tex) svgEl('image', { href: tex, x: 0, y: 0, width: DIE_W, height: DIE_H, 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 0, y: 0, width: DIE_W, height: DIE_H, rx: 4, fill: 'url(#dv-sheen)', 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 3.5, y: 3.5, width: DIE_W - 7, height: DIE_H - 7, rx: 3, fill: 'none', stroke: P.scribe, 'stroke-width': 1, opacity: 0.6 }, g);
    E.ring = svgEl('rect', { x: 38, y: 38, width: DIE_W - 76, height: DIE_H - 76, rx: 8, fill: 'none', stroke: P.scribe, 'stroke-width': 3, opacity: 0.55 }, g);
    // the four units
    const region = (x, y, w, h, col, fill) => svgEl('rect', { x, y, width: w, height: h, rx: 2, fill, stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': '6 5', opacity: 0.85 }, g);
    region(46, 46, 454, 354, P.regAU, dvA(THEME.lavender, 0.03));
    region(510, 46, 404, 354, P.regBU, dvA(THEME.gold, 0.025));
    region(46, 410, 454, 304, P.regEU, dvA(THEME.phosphor, 0.02));
    region(510, 410, 404, 304, P.regBIU, dvA(THEME.cyan, 0.025));
    // internal buses: the vertical bus between the units, the EU bus, the address path AU -> BU
    const bus = (d, col, w, op) => svgEl('path', { d, class: 'dv-bus', stroke: col, 'stroke-width': w, opacity: op }, g);
    E.gBus = bus('M505 44V706', P.busMain, 5, 0.55);
    bus('M292 444V706M292 408H505', P.busMain, 4, 0.5);
    bus('M810 56V44H505M505 252H518M505 440H518M505 640H518M492 354H505', P.busMain, 3, 0.5);
    bus('M534 284H505', P.busQ, 3, 0.5);
    E.addrBus = bus('M173 306V310H505M505 100H518', P.busA, 3, 0.7);
    bus('M902 180H918', P.busC, 2.4, 0.7);
    this.txt(g, 'INTERNAL BUS', 500, 724, 11, 'dv-m', 'end');
    // blocks
    this.buildDesc(g); this.buildAdder(g); this.buildProt(g); this.buildSys(g);
    this.buildLatch(g); this.buildBusCtl286(g); this.buildPfq(g); this.buildPei(g);
    this.buildDec286(g); this.buildIq(g);
    this.buildAlu286(g); this.buildFlags286(g); this.buildCtl(g); this.buildRegs286(g);
    const tab = (x, y, s, col) => {
      const w = strokeTextWidth(s, 9, 1.4) + 14;
      svgEl('rect', { x, y: y - 8, width: w, height: 16, rx: 3, fill: P.tabFill, stroke: col, 'stroke-width': 1.2 }, g);
      this.silk(g, s, x + 7, y - 4.5, 9, 'dv-silk');
    };
    tab(62, 46, 'ADDRESS UNIT  AU', P.regAU);
    tab(526, 46, 'BUS UNIT  BU', P.regBU);
    tab(62, 410, 'EXECUTION UNIT  EU', P.regEU);
    tab(526, 410, 'INSTRUCTION UNIT  IU', P.regBIU);
    this.buildPads286(g);
    this.buildOverlay(g);
    this.tokLayer = svgEl('g', { class: 'dv-toks', 'pointer-events': 'none' }, g);
  }
  buildDesc(g) {
    const b = this.block(g, 'desc', 54, 56, 438, 152, 'DESCRIPTOR CACHES');
    const P = dieP(), E = this.els;
    const hy = 92;
    this.txt(b, 'SEG', 62, hy, 11, 'dv-f');
    this.txt(b, 'SELECTOR', 184, hy, 11, 'dv-f', 'end');
    this.txt(b, 'BASE', 290, hy, 11, 'dv-f', 'end');
    this.txt(b, 'LIMIT', 360, hy, 11, 'dv-f', 'end');
    this.txt(b, 'AR', 400, hy, 11, 'dv-f', 'end');
    this.txt(b, 'TYPE', 410, hy, 11, 'dv-f');
    D286_SREGS.forEach((n, i) => {
      const y0 = 98 + i * 27;
      svgEl('rect', { x: 58, y: y0, width: 430, height: 25, rx: 4, fill: i % 2 ? P.row0 : P.row1, opacity: 0.9 }, b);
      const fl = this.flashRect(b, 58, y0, 430, 25, dvA(THEME.phosphor, 0.28));
      this.txt(b, n, 64, y0 + 19, 17, 'dv-cy', 'start', { 'font-weight': 700 });
      const sel = this.txt(b, '0000', 184, y0 + 19, 18, 'dv-v', 'end', { 'font-weight': 600 });
      const base = this.txt(b, '000000', 290, y0 + 19, 18, 'dv-cy', 'end', { 'font-weight': 600 });
      const limit = this.txt(b, 'FFFF', 360, y0 + 19, 18, 'dv-v', 'end');
      const ar = this.txt(b, '93', 400, y0 + 19, 16, 'dv-lv', 'end');
      const type = this.txt(b, 'real', 410, y0 + 18, 12, 'dv-m');
      E.desc[n] = { sel, base, limit, ar, type, fl };
      this.els.regs[n] = { lo: sel, fl, y: y0 + 12, x: 492 };
    });
  }
  buildAdder(g) {
    const b = this.block(g, 'adder', 54, 214, 238, 92, 'ADDRESS ADDERS');
    const E = this.els;
    this.txt(b, 'offset', 62, 250, 13, 'dv-m');
    E.adOff = this.txt(b, '0000', 284, 250, 18, 'dv-cy', 'end', { 'font-weight': 600 });
    E.adSeg = this.txt(b, 'CS base', 62, 274, 13, 'dv-m');
    E.adBase = this.txt(b, '000000', 284, 274, 18, 'dv-cy', 'end', { 'font-weight': 600 });
    svgEl('line', { x1: 62, y1: 281, x2: 284, y2: 281, stroke: dieP().busA, 'stroke-width': 1.2 }, b);
    this.txt(b, 'Σ 24-bit', 62, 300, 13, 'dv-cy', 'start', { 'font-weight': 700 });
    E.adPhys = this.txt(b, '000000', 284, 301, 21, 'dv-cy', 'end', { 'font-weight': 700 });
    E.sgFl = this.flashRect(b, 58, 283, 230, 22, dvA(THEME.cyan, 0.25));
  }
  buildProt(g) {
    const b = this.block(g, 'prot', 300, 214, 192, 92, 'PROTECTION');
    const E = this.els;
    E.prLim = this.txt(b, 'limit FFFF', 308, 250, 14, 'dv-m');
    E.prChk = this.txt(b, '', 308, 274, 15, 'dv-ph', 'start', { 'font-weight': 700 });
    E.prCpl = this.txt(b, 'CPL 0', 308, 298, 14, 'dv-v', 'start', { 'font-weight': 600 });
    E.prSt = this.txt(b, 'OK', 484, 298, 16, 'dv-ph', 'end', { 'font-weight': 700 });
    E.prFl = this.flashRect(b, 302, 216, 188, 88, dvA(THEME.magenta, 0.3));
  }
  buildSys(g) {
    const b = this.block(g, 'sysr', 54, 314, 438, 80, 'SYSTEM REGISTERS');
    const E = this.els;
    E.msw = ['PE', 'MP', 'EM', 'TS'].map((n, i) => {
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x: 62 + i * 34, y: 338, width: 31, height: 24, rx: 4 }, c);
      const t = this.txt(c, n, 77.5 + i * 34, 355, 12, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, t };
    });
    E.gdtr = this.txt(b, '', 204, 355, 13, 'dv-v');
    E.idtr = this.txt(b, '', 350, 355, 13, 'dv-v');
    E.ldtr = this.txt(b, '', 62, 385, 13, 'dv-v');
    E.trr = this.txt(b, '', 240, 385, 13, 'dv-v');
    E.cpl = this.txt(b, 'CPL 0', 484, 385, 15, 'dv-lv', 'end', { 'font-weight': 700 });
    E.sysFl = this.flashRect(b, 56, 316, 434, 76, dvA(THEME.lavender, 0.25));
  }
  buildLatch(g) {
    const E = this.els;
    const b = this.block(g, 'latch', 518, 56, 190, 76, 'ADDRESS LATCHES');
    E.laA = this.txt(b, 'A 000000', 526, 104, 20, 'dv-cy', 'start', { 'font-weight': 700 });
    E.laNext = this.txt(b, '', 526, 124, 12, 'dv-m');
    const c = this.block(g, 'xcvr', 716, 56, 190, 76, 'DATA TRANSCEIVERS');
    E.xcD = this.txt(c, 'D ----', 724, 104, 20, 'dv-go', 'start', { 'font-weight': 700 });
    E.xcDir = this.txt(c, '', 724, 124, 12, 'dv-m');
  }
  buildBusCtl286(g) {
    const b = this.block(g, 'busctl', 518, 140, 388, 84, 'BUS CONTROL');
    const E = this.els;
    E.bcType = this.txt(b, 'IDLE', 526, 184, 17, 'dv-m', 'start', { 'font-weight': 700 });
    E.bcBits = ['COD', 'M/IO', 'S1', 'S0'].map((n, i) => {
      const x = 770 + i * 38;
      this.txt(b, n, x, 166, 10, 'dv-m', 'middle');
      return this.txt(b, '1', x, 186, 17, 'dv-mg', 'middle', { 'font-weight': 700 });
    });
    E.bcT = ['Ts', 'Tc', 'Tw'].map((n, i) => {
      const c = svgEl('g', { class: 'dv-tstate' }, b);
      svgEl('rect', { x: 526 + i * 48, y: 196, width: 44, height: 22, rx: 4 }, c);
      this.txt(c, n, 548 + i * 48, 212, 14, 'dv-m', 'middle', { 'font-weight': 700 });
      return c;
    });
    E.bcPipe = this.txt(b, '', 898, 212, 11, 'dv-f', 'end');
  }
  buildPfq(g) {
    const b = this.block(g, 'pfq', 518, 232, 388, 96, 'PREFETCHER / 6-BYTE QUEUE');
    for (let i = 0; i < 6; i++) {
      svgEl('rect', { x: this.qx(i) - 14, y: this.QY, width: 28, height: this.QH, rx: 4, fill: 'none', stroke: dieP().cellStroke, 'stroke-dasharray': '3 3' }, b);
      this.txt(b, String(i), this.qx(i), this.QY + this.QH + 13, 10, 'dv-f', 'middle');
    }
    this.els.pfAddr = this.txt(b, '', 898, 284, 13, 'dv-cy', 'end', { 'font-weight': 600 });
    this.els.qCount = this.txt(b, '0/6', 898, 306, 15, 'dv-m', 'end', { 'font-weight': 700 });
    this.chipLayer = svgEl('g', { 'pointer-events': 'none' }, b);
  }
  buildPei(g) {
    const b = this.block(g, 'pei', 518, 336, 388, 58, 'PROCESSOR EXTENSION INTERFACE');
    const E = this.els;
    E.peReq = svgEl('circle', { cx: 534, cy: 376, r: 6, fill: dieP().dot }, b);
    this.txt(b, 'PEREQ', 546, 381, 13, 'dv-m', 'start', { 'font-weight': 700 });
    E.peAck = svgEl('circle', { cx: 620, cy: 376, r: 6, fill: dieP().dot }, b);
    this.txt(b, 'PEACK', 632, 381, 13, 'dv-m', 'start', { 'font-weight': 700 });
    E.peiText = this.txt(b, 'ports F8h-FFh', 898, 381, 13, 'dv-lv', 'end', { 'font-weight': 600 });
  }
  buildDec286(g) {
    const b = this.block(g, 'dec', 518, 420, 388, 128, 'INSTRUCTION DECODER');
    const E = this.els;
    E.decText = this.txt(b, '', 530, 478, 24, 'dv-ph', 'start', { 'font-weight': 700 });
    E.decBytes = this.txt(b, '', 530, 508, 16, 'dv-go', 'start', { 'font-weight': 600 });
    E.decAddr = this.txt(b, '', 898, 508, 13, 'dv-m', 'end');
    this.txt(b, 'CLK', 530, 538, 12, 'dv-m', 'start', { 'font-weight': 700 });
    E.clkDot = svgEl('circle', { cx: 566, cy: 534, r: 6, fill: dieP().dot }, b);
    E.clkText = this.txt(b, this.mhz(), 578, 538, 12, 'dv-f');
    this.txt(b, 'IP', 716, 538, 12, 'dv-m', 'start', { 'font-weight': 700 });
    const ip = this.txt(b, '0000', 738, 538, 14, 'dv-ph', 'start', { 'font-weight': 700 });
    const ipFl = this.flashRect(b, 712, 524, 72, 20, dvA(THEME.phosphor, 0.2));
    this.els.regs.IP = { lo: ip, fl: ipFl, y: 530, x: 518 };
    E.decClk = this.txt(b, '', 898, 538, 14, 'dv-m', 'end', { 'font-weight': 700 });
    E.decFl = this.flashRect(b, 522, 452, 380, 34, dvA(THEME.phosphor, 0.14));
  }
  buildIq(g) {
    const b = this.block(g, 'iq', 518, 556, 388, 150, 'DECODED QUEUE');
    this.txt(b, '3 INSTRUCTIONS  ▶ EU', 898, 572, 11, 'dv-f', 'end');
    this.els.iq = [0, 1, 2].map(i => {
      const r = svgEl('rect', { x: 526, y: 586 + i * 38, width: 372, height: 32, rx: 5, fill: THEME.panel, stroke: dieP().cellStroke, 'stroke-dasharray': '3 3' }, b);
      const t = this.txt(b, '', 538, 608 + i * 38, 15, 'dv-f', 'start', { 'font-weight': 600 });
      return { r, t };
    });
  }
  buildAlu286(g) {
    const b = this.block(g, 'alu', 54, 420, 234, 120, '');
    svgEl('path', { d: 'M62 452H150L171 472L192 452H280L246 534H96Z', fill: dieP().aluFill, stroke: THEME.gold, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, b);
    this.silk(b, 'ALU', 60, 516, 11, 'dv-silk-g');
    this.txt(b, 'TMP A', 110, 466, 11, 'dv-m', 'middle');
    this.txt(b, 'TMP B', 232, 466, 11, 'dv-m', 'middle');
    const E = this.els;
    E.aluA = this.txt(b, '----', 110, 490, 20, 'dv-v', 'middle', { 'font-weight': 600 });
    E.aluB = this.txt(b, '----', 232, 490, 20, 'dv-v', 'middle', { 'font-weight': 600 });
    E.aluSym = this.txt(b, '', 171, 491, 18, 'dv-go', 'middle', { 'font-weight': 700 });
    E.aluOp = this.txt(b, '', 171, 511, 16, 'dv-go', 'middle', { 'font-weight': 700 });
    E.aluR = this.txt(b, '', 171, 530, 17, 'dv-ph', 'middle', { 'font-weight': 700 });
    E.aluFl = this.flashRect(b, 104, 515, 134, 20, dvA(THEME.phosphor, 0.22));
  }
  buildFlags286(g) {
    const b = this.block(g, 'flags', 54, 548, 234, 92, 'FLAGS');
    D286_FLAGS.forEach(([n, bit], i) => {
      const row = i < 6 ? 0 : 1, col = row ? i - 6 : i;
      const x = (row ? 77 : 58) + col * 38.2, y = row ? 606 : 572, w = 35;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y, width: w, height: 30, rx: 4 }, c);
      this.txt(c, n, x + w / 2, y + 11, n.length > 2 ? 8.5 : 10, 'dv-m', 'middle', { 'font-weight': 600 });
      const v = this.txt(c, '0', x + w / 2, y + 27, 15, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      const fl = this.flashRect(c, x, y, w, 30, dvA(THEME.phosphor, 0.45));
      this.els.flags.push({ n, bit, c, v, fl });
    });
  }
  buildCtl(g) {
    const b = this.block(g, 'ctl', 54, 648, 234, 58, 'CONTROL / MICROCODE');
    const E = this.els;
    svgEl('rect', { x: 62, y: 682, width: 106, height: 16, fill: 'url(#dv-rom)', stroke: dieP().cellStroke }, b);
    E.romRow = svgEl('rect', { x: 62, y: 682, width: 14, height: 16, fill: dvA(THEME.phosphor, 0.7), opacity: 0 }, b);
    E.intText = this.txt(b, '', 282, 695, 12, 'dv-f', 'end', { 'font-weight': 700 });
    E.intFl = this.flashRect(b, 56, 650, 230, 54, dvA(THEME.magenta, 0.2));
  }
  buildRegs286(g) {
    const b = this.block(g, 'regs', 296, 420, 196, 286, 'REGISTERS');
    const P = dieP();
    DIE_REGS.forEach((r, i) => {
      const y0 = 448 + i * 31;
      svgEl('rect', { x: 300, y: y0, width: 188, height: 29, rx: 4, fill: i % 2 ? P.row0 : P.row1, opacity: 0.9 }, b);
      const fl = this.flashRect(b, 300, y0, 188, 29, dvA(THEME.phosphor, 0.3));
      this.txt(b, r, 306, y0 + 22, 17, 'dv-m', 'start', { 'font-weight': 700 });
      let hi = null, lo;
      if (i < 4) {
        hi = this.txt(b, '00', 420, y0 + 23, 21, 'dv-v', 'end', { 'font-weight': 600 });
        lo = this.txt(b, '00', 482, y0 + 23, 21, 'dv-v', 'end', { 'font-weight': 600 });
      } else lo = this.txt(b, '0000', 482, y0 + 23, 21, 'dv-v', 'end', { 'font-weight': 600 });
      this.els.regs[r] = { hi, lo, fl, y: y0 + 14, x: 296 };
    });
  }
  buildPads286(g) {
    const pg = this.block(g, 'pads', 0, 0, 0, 0, '');
    pg.querySelector('.dv-frame').setAttribute('display', 'none');
    for (let pin = 1; pin <= 68; pin++) {
      const p = Die286View.padPos286(pin), name = D286_PINS[pin - 1];
      const out = 9;
      const [bx, by] = p.side === 'l' ? [-out, p.y] : p.side === 'r' ? [DIE_W + out, p.y] : p.side === 't' ? [p.x, -out] : [p.x, DIE_H + out];
      svgEl('line', { x1: p.x, y1: p.y, x2: bx, y2: by, stroke: dieP().bond, 'stroke-width': 1.2, opacity: 0.55 }, pg);
      const cls = 'dv-pad' + (name === 'NC' ? ' dv-nc' : name === 'CAP' ? ' dv-tie' : '');
      const c = svgEl('g', { class: cls }, pg);
      const w = p.v ? 25 : 47, h = p.v ? 35 : 25;
      svgEl('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 3 }, c);
      const size = name.length > 6 ? 8.6 : p.v ? 9.6 : 10.5;
      const t = this.txt(c, name, p.x, p.y + size * 0.36, size, '', 'middle', p.v ? { transform: `rotate(-90 ${p.x} ${p.y})` } : null);
      t.removeAttribute('class');
      svgEl('title', null, c).textContent = `Pin ${pin}: ${name}` + (name === 'CAP' ? ' (substrate filter capacitor)' : name === 'NC' ? ' (not connected)' : '');
      this.els.pads.push({ c, pin, name, p, base: cls });
    }
  }
  buildOverlay(g) {
    const E = this.els;
    const o = E.ovl = svgEl('g', { 'pointer-events': 'none', display: 'none' }, g);
    E.ovlBox = svgEl('rect', { x: 90, y: 292, width: 780, height: 176, rx: 14, fill: dvA(THEME.void, 0.9), stroke: THEME.magenta, 'stroke-width': 3 }, o);
    E.ovlSilk = svgEl('path', { d: '', class: 'dv-silk-m' }, o);
    E.ovlText = this.txt(o, '', 480, 420, 22, 'dv-v', 'middle', { 'font-weight': 700 });
    E.ovlSub = this.txt(o, '', 480, 450, 15, 'dv-m', 'middle');
  }

  // ---------- 80287 ----------
  buildFpuTop(g, x0, top, qw) {
    const F = this.els.f87;
    const b = this.block(g, 'f87bi', x0, top, qw, 72, 'BUS INTERFACE', 'l');
    F.bi = ['PEREQ', 'PEACK', 'NPRD', 'NPWR', 'CMD0', 'CMD1'].map((n, i) => {
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x: x0 + 8 + i * 56, y: top + 30, width: 52, height: 34, rx: 4 }, c);
      this.txt(c, n, x0 + 34 + i * 56, top + 43, 10, 'dv-m', 'middle', { 'font-weight': 600 });
      const t = this.txt(c, '0', x0 + 34 + i * 56, top + 60, 14, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { n, c, t };
    });
    F.biText = this.txt(b, 'ports F8h-FFh', x0 + qw - 8, top + 21, 12, 'dv-lv', 'end', { 'font-weight': 600 });
  }
  link87() {
    if (this.L.side === 'left') return { ERROR: ['l', 0], BUSY: ['l', 1], PEREQ: ['l', 2], PEACK: ['l', 3], NPRD: ['l', 4], NPWR: ['l', 5], CMD0: ['l', 6], CMD1: ['b', 0] };
    return { PEACK: ['t', 10], PEREQ: ['t', 11], BUSY: ['t', 12], ERROR: ['t', 13], NPRD: ['l', 0], NPWR: ['l', 1], CMD0: ['l', 2], CMD1: ['l', 3] };
  }
  buildLinks() {
    const g = this.gLinks, L = this.L, E = this.els;
    const [ax, ay] = L.p86, [bx, by] = L.p87, map = this.link87();
    const pad86 = n => { const p = Die286View.padPos286(D286_PINS.indexOf(n) + 1); return { x: ax + p.x, y: ay + p.y, side: p.side }; };
    const pad87 = n => { const [s, i] = map[n]; const p = DieView.padPos87(s, i); return { x: bx + p.x, y: by + p.y, side: s }; };
    E.wires = {};
    const wire = (id, pts, color) => {
      E.wires[id] = svgEl('path', { d: 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'), class: 'dv-wire', stroke: color, color }, g);
    };
    const dieR = ax + DIE_W, dieB = ay + DIE_H;
    // CPU pins, from the inner lane to the outer lane (no crossings)
    const topLane = { PEREQ: ay - 13, BUSY: ay - 20, ERROR: ay - 27 };
    ['PEACK', 'PEREQ', 'BUSY', 'ERROR'].forEach((n, j) => {
      const s = pad86(n), t = pad87(n), pts = [];
      const lane = dieR + 8 + j * 10;
      if (s.side === 't') pts.push([s.x, ay], [s.x, topLane[n]], [lane, topLane[n]]);
      else pts.push([dieR, s.y], [lane, s.y]);
      if (L.side === 'left') pts.push([lane, t.y], [bx, t.y]);
      else { const ly = dieB + 36 + j * 11; pts.push([lane, ly], [t.x, ly], [t.x, by]); }
      wire(n, pts, n === 'PEREQ' || n === 'PEACK' ? THEME.lavender : THEME.magenta);
    });
    // 82288 + port decode -> NPRD NPWR CMD0 CMD1
    let box;
    if (L.side === 'left') { const a = pad87('NPRD'), c = pad87('CMD0'); box = [bx - 64, a.y - 22, 56, c.y - a.y + 44]; }
    else { const a = pad87('NPRD'), c = pad87('CMD1'); box = [bx - 150, a.y - 26, 128, c.y - a.y + 52]; }
    const blk = this.block(g, 'npdec', box[0], box[1], box[2], box[3], '');
    const cx = box[0] + box[2] / 2;
    this.txt(blk, '82288', cx, box[1] + 20, 11, 'dv-v', 'middle', { 'font-weight': 700 });
    this.txt(blk, '+ DEC', cx, box[1] + 36, 10, 'dv-m', 'middle');
    this.txt(blk, 'F8-FF', cx, box[1] + 52, 10, 'dv-mg', 'middle', { 'font-weight': 700 });
    ['NPRD', 'NPWR', 'CMD0', 'CMD1'].forEach(n => {
      const t = pad87(n);
      if (t.side === 'l') wire(n, [[box[0] + box[2], t.y], [bx, t.y]], THEME.magenta);
      else {
        const ly = by + FPU_H + 14;
        wire(n, [[cx, box[1] + box[3]], [cx, ly], [t.x, ly], [t.x, by + FPU_H]], THEME.magenta);
      }
    });
    this.txt(g, 'D15-D0 shared, I/O ports F8h-FFh', bx + 8, by - 12, 11, 'dv-f');
    const hit = svgEl('g', { class: 'dv-blk', tabindex: 0, role: 'button', 'aria-label': DIE286_INFO.link[0] + ': ' + DIE286_INFO.link[1] }, g);
    const bb = L.side === 'left' ? [dieR + 2, ay + 100, 40, 460] : [dieR + 2, ay + 100, L.W - dieR - 4, 600];
    svgEl('rect', { x: bb[0], y: bb[1], width: bb[2], height: bb[3], fill: 'transparent' }, hit);
    hit.addEventListener('click', e => { e.stopPropagation(); this.select('link', hit); });
    hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select('link', hit); } });
    E.blocks.link = hit;
  }

  // ---------- tokens: the internal bus between the units is at x = 505, the EU bus at x = 292 ----------
  point(spec) {
    const R = this.els.regs;
    if (spec && typeof spec === 'object') {
      if (spec.tail) return { pts: [[spec.tail, this.QY], [spec.tail, 252], [505, 252]], bus: 'g' };
      if (spec.bus) return spec.bus === 'eu' ? { pts: [[292, clamp(spec.y, 450, 700)]], bus: 'eu' } : { pts: [[505, spec.y]], bus: 'g' };
    }
    if (DIE_REGS.includes(spec)) return { pts: [[300, R[spec].y], [292, R[spec].y]], bus: 'eu' };
    if (D286_SREGS.includes(spec)) return { pts: [[488, R[spec].y], [505, R[spec].y]], bus: 'g' };
    switch (spec) {
      case 'IP': return { pts: [[518, 530], [505, 530]], bus: 'g' };
      case 'aluA': return { pts: [[110, 452], [110, 444], [292, 444]], bus: 'eu' };
      case 'aluB': return { pts: [[232, 452], [232, 444], [292, 444]], bus: 'eu' };
      case 'aluOut': return { pts: [[171, 534], [171, 542], [292, 542]], bus: 'eu' };
      case 'qhead': return { pts: [[534, 284], [505, 284]], bus: 'g' };
      case 'dec': return { pts: [[518, 440], [505, 440]], bus: 'g' };
      case 'sigma': case 'adder': return { pts: [[173, 306], [173, 310], [505, 310]], bus: 'g' };
      case 'ring': case 'xcvr': return { pts: [[810, 56], [810, 44], [505, 44]], bus: 'g' };
      case 'latch': return { pts: [[612, 56], [612, 44], [505, 44]], bus: 'g' };
      case 'iq': return { pts: [[518, 640], [505, 640]], bus: 'g' };
      case 'sys': return { pts: [[488, 354], [505, 354]], bus: 'g' };
      case 'pei': return { pts: [[518, 365], [505, 365]], bus: 'g' };
      default: return null;
    }
  }
  route(a, b) {
    const A = this.point(a), B = this.point(b);
    if (!A || !B) return null;
    let pts = A.pts.slice();
    if (A.bus !== B.bus) pts = pts.concat(A.bus === 'eu' ? [[292, 408], [505, 408]] : [[505, 408], [292, 408]]);
    pts = pts.concat(B.pts.slice().reverse());
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
    return out;
  }

  // ---------- events ----------
  instr(events, info) {
    super.instr(events, info);
    this.hasFpuIo = events.some(x => x.k === 'bus' && x.dev === 'fpu');
    this.iqTexts = this.peekNext(3);
    if (this.flushAt !== undefined && events.some(e => e.k === 'queue' && e.op === 'flush')) {
      // protected mode: the target of a jump is the CS cache base + IP
      const regEv = r => events.filter(e => e.k === 'reg' && e.r === r).pop();
      const dcs = events.filter(e => e.k === 'desc' && e.sreg === 'CS').pop();
      const ipE = regEv('IP'), csE = regEv('CS');
      const ip = ipE ? ipE.v : this.mdl.regs.IP;
      const pe = this.mdl.sys && (this.mdl.sys.msw & 1);
      const base = dcs ? dcs.base : pe ? this.mdl.desc.CS.base : ((csE ? csE.v : this.mdl.regs.CS) << 4);
      const target = (base + ip) & 0xFFFFFF;
      const pop = events.find(e => e.k === 'queue' && e.op === 'pop');
      this.flushAt = events.find(e => e.k === 'fetch' && (e.addr & 0xFFFFFF) === target && (!pop || e.t >= pop.t)) || null;
    }
  }
  event(e, clockMs) {
    switch (e.k) {
      case 'desc': this.cmsSet(e, clockMs); this.onDesc(e, this.anim(e.t)); this.sfxTick(1.5); return;
      case 'sys': this.cmsSet(e, clockMs); this.onSys(e, this.anim(e.t)); return;
      case 'task': this.cmsSet(e, clockMs); this.onTask(e, this.anim(e.t)); return;
      case 'iq': this.cmsSet(e, clockMs); this.iqN = e.n; this.renderIq(); return;
      default: break;
    }
    super.event(e, clockMs);
    if (e.k === 'int' && e.src === 'exc') this.onExc(e);
  }
  cmsSet(e, clockMs) {
    if (clockMs >= 300 && !this.manual) this.manual = true;
    this.cms = clockMs;
    if (e.t > this.lastT) this.lastT = e.t;
  }
  onBus(e, a, type) {
    const len = e.len || 4;
    Object.assign(a, { n: len, minMs: 55 * len + 60, e, type });
    this.anims.bus = a;
    this.mdl.bus = { e, type };
    const evs = this.events || [], i = evs.indexOf(e);
    this.nextBus = i >= 0 ? evs.slice(i + 1).find(x => x.k === 'fetch' || x.k === 'bus') || null : null;
    const fpuIo = e.dev === 'fpu' || e.owner === 'fpu';
    if (fpuIo) { this.anims.pe = Object.assign(this.anim(e.t), { n: len, minMs: 300, e, type }); this.mdl.pei = { e, type }; }
    const segName = type === 'code' ? 'CS' : e.seg;
    if (segName && (type === 'code' || type === 'memr' || type === 'memw')) {
      const d = this.mdl.desc && this.mdl.desc[segName];
      const base = d ? d.base : (this.mdl.regs[segName] << 4);
      this.mdl.sig = { seg: segName, base, off: (e.addr - base) & 0xFFFF, phys: e.addr };
      this.flash('sig', a, 3, 350);
      this.renderSigma();
    }
    if (this.visible) { this.renderBusText(); this.renderPei(); }
    const hexd = e.width === 2 ? hex4(e.data) : hex2(e.data);
    if (type === 'code' && e === this.flushAt && !this.flushDone) this.doFlush(e.t);
    if (type === 'code') {
      const byt = e.width === 2 ? hex2(e.data) + ' ' + hex2(e.data >> 8) : hex2(e.data);
      const tailX = this.qx(clamp(e.q.length - e.width, 0, 5));
      const tk = this.token(e.t, ['xcvr', { tail: tailX }], byt, THEME.gold, 0.6, len * 0.7, 260);
      this.qOps.push({ kind: 'fetch', q: e.q.slice(), a: tk || Object.assign(this.anim(e.t), { d: 0.6, n: len * 0.7, minMs: 260 }) });
      this.setT(this.els.pfAddr, 'next ' + dvHex6(e.addr + e.width));
    } else if (fpuIo) {
      this.token(e.t, type === 'iow' ? ['xcvr', 'pei'] : ['pei', 'xcvr'], hexd, THEME.lavender, 0.3, len * 0.8, 260);
    } else if (type === 'memr' || type === 'ior') {
      this.token(e.t, ['xcvr', this.readDest(e)], hexd, THEME.gold, 0.8, len, 260);
    } else if (type === 'memw' || type === 'iow') {
      this.token(e.t, [this.writeSrc(e), 'xcvr'], hexd, THEME.gold, 0, len, 260);
    }
  }
  onReg(e, a) {
    super.onReg(e, a);
    const loaded = (this.events || []).some(x => x.k === 'desc' && x.sreg === e.r);
    if (D286_SREGS.includes(e.r) && !loaded && !(this.mdl.sys && (this.mdl.sys.msw & 1))) {
      // real mode: the base is selector x 16 (the cache is loaded without a descriptor)
      const d = this.mdl.desc[e.r];
      if (!d || d.sel !== e.v || d.table === 'real') this.mdl.desc[e.r] = { sel: e.v, base: e.v << 4, limit: d ? d.limit : 0xFFFF, access: d ? d.access : 0x93, table: 'real' };
      this.renderDesc(e.r);
    }
  }
  onDesc(e, a) {
    this.mdl.desc[e.sreg] = { sel: e.sel, base: e.base, limit: e.limit, access: e.access, table: e.table };
    this.mdl.regs[e.sreg] = e.sel;
    this.renderDesc(e.sreg);
    this.renderReg(e.sreg, 1);
    this.flash('desc:' + e.sreg, a, 8, 1200);
    if (e.table !== 'real') this.token(e.t, ['xcvr', e.sreg], dvHex6(e.base), THEME.lavender, 0, 3, 520);
  }
  onSys(e, a) {
    this.mdl.sysText = e.text || e.op;
    const old = this.mdl.sys;
    this.readMachine();
    if (old) this.mdl.sys.prevMsw = old.msw;
    this.flash('sys', a, 8, 1200);
    this.renderSys();
    if (/^(LGDT|LIDT)/.test(e.op)) this.token(e.t, ['xcvr', 'sys'], e.op, THEME.lavender, 0, 3, 520);
    else this.token(e.t, [{ bus: 'eu', y: 600 }, 'sys'], e.op, THEME.lavender, 0, 2.4, 420);
  }
  onTask(e, a) {
    this.readMachine();
    this.renderSys();
    this.flash('sys', a, 10, 1600);
    this.showOverlay(a, 'TASK SWITCH', `TSS ${hex4(e.from)}  →  TSS ${hex4(e.to)}`, 'the processor saves every register in the old TSS and loads the new one', THEME.lavender);
  }
  onExc(e) {
    const a = this.anim(e.t);
    const [nm, long] = D286_EXC[e.vec] || [e.name || '#' + hex2(e.vec), 'EXCEPTION'];
    const name = e.name || nm;
    const err = e.err !== undefined && e.err !== null ? `error code ${hex4(e.err)}` : 'no error code';
    this.mdl.exc = { name, vec: e.vec, err: e.err };
    this.flash('prot', a, 10, 1600);
    this.showOverlay(a, `${name}  ${long}`, `vector ${hex2(e.vec)}h  ·  ${err}`, this.dec ? `at ${hex4(this.dec.cs)}:${hex4(this.dec.ip)}  ${this.dec.text}` : '', THEME.magenta);
    this.renderSigma();
  }
  showOverlay(a, title, text, sub, color) {
    const E = this.els;
    if (!E.ovl) return;
    const size = 26, w = strokeTextWidth(title, size, 1.4);
    E.ovlSilk.setAttribute('d', strokeTextPath(title, 480 - w / 2, 330, size, 1.4));
    E.ovlSilk.setAttribute('style', `stroke:${color}`);
    E.ovlBox.setAttribute('stroke', color);
    this.setT(E.ovlText, text);
    this.setT(E.ovlSub, sub.length > 76 ? sub.slice(0, 75) + '…' : sub);
    this.ovl = Object.assign(a, { n: 12, minMs: this.reduced ? 2600 : 2200 });
  }
  flashEl(key) {
    const E = this.els;
    if (key.startsWith('desc:')) { const d = E.desc[key.slice(5)]; return d && d.fl; }
    if (key === 'sys') return E.sysFl;
    if (key === 'prot') return E.prFl;
    return super.flashEl(key);
  }
  fast(stats) {
    super.fast(stats);
    const h = this.heatT, b = stats.bus || {};
    const lg = v => clamp(Math.log10(1 + (v || 0)) / 4.2, 0, 1);
    Object.assign(h, { pfq: h.queue, latch: h.busctl, xcvr: h.busctl, adder: h.sigma, desc: (h.sigma || 0) * 0.5, prot: (h.sigma || 0) * 0.4,
      iq: h.dec, ctl: h.rom, pei: lg((b.fpu || 0) * 10), f87bi: lg((b.fpu || 0) * 10), sysr: 0 });
    if (this.anims.bus && this.anims.bus.e && this.anims.bus.serial === -1) this.anims.bus.n = this.anims.bus.e.len || 4;
    this.iqTexts = this.peekNext(3);
  }
  frame(now, dt) {
    super.frame(now, dt);
    if (this.els) this.stepOverlay(now);
  }

  // ---------- per frame ----------
  curBus(now) {
    const a = this.anims.bus;
    if (!a) return null;
    const p = this.prog(a, now);
    if (p < 0 || p >= 1) return null;
    const len = a.n || 4;
    return { a, e: a.e, type: a.type, len, T: Math.min(len - 1, Math.floor(p * len)) };
  }
  stepPads(now) {
    const st = {}, set = (n, c) => { st[n] = c; };
    const cur = this.curBus(now);
    const m = this.m, f = m.fpu;
    let fpuIo = false;
    if (cur) {
      const e = cur.e, k = cur.T, type = cur.type;
      fpuIo = e.dev === 'fpu' || e.owner === 'fpu';
      const io = type === 'ior' || type === 'iow';
      const write = type === 'memw' || type === 'iow';
      let addr = type === 'inta' || type === 'halt' ? null : e.addr;
      const nx = this.nextBus;
      if (k >= 1 && nx && nx !== e && (nx.k === 'fetch' || (nx.type !== 'inta' && nx.type !== 'halt'))) addr = nx.addr;   // pipelined
      const A = e.owner === 'fpu' ? 'f' : 'a';
      if (addr !== null) for (let b = 0; b < 24; b++) set('A' + b, A + ((addr >> b) & 1));
      if (k >= 1 && type !== 'halt') {
        const wd = e.width === 2 ? e.data : ((e.addr & 1) && !io ? e.data << 8 : e.data);
        for (let b = 0; b < 16; b++) {
          if (type === 'inta' && b >= 8) continue;
          if (write || k >= 1) set('D' + b, (fpuIo ? 'f' : 'd') + ((wd >> b) & 1));
        }
      }
      if (k === 0 && (e.width === 2 || (e.addr & 1))) set('BHE', 'c1');
      const s = D286_STATUS[type] || [1, 1, 1, 1];
      if (k === 0) { set('S1', 'c' + s[2]); set('S0', 'c' + s[3]); }
      set('M/IO', 'c' + s[1]); set('COD/INTA', 'c' + s[0]);
      if (k === cur.len - 1) set('READY', 'g1');
      if (type === 'inta') { set('LOCK', 'c1'); set('INTR', 'c1'); }
      if (fpuIo) set('PEACK', 'f1');
      else if (this.hasFpuIo && (type === 'memr' || type === 'memw')) set('PEREQ', 'f1');
    }
    const it = this.anims.intr;
    if (it) {
      const p = this.prog(it, now);
      if (p >= 0 && p < 1) { if (it.e.src === 'irq') set('INTR', 'c1'); if (it.e.src === 'nmi') set('NMI', 'c1'); }
    }
    if (this.dec && /^lock/.test(this.dec.text) && this.anims.dec && this.prog(this.anims.dec, now) < 1) set('LOCK', 'c1');
    const busy = !!(f && f.busyCycles > 0), ferr = !!(f && f.intRequest);
    if (busy) set('BUSY', 'f1');
    if (ferr) set('ERROR', 'c1');
    const pe = this.anims.pe, pep = pe ? this.prog(pe, now) : 2;
    if (pep >= 0 && pep < 1) set('PEREQ', 'f1');
    if (this.resetAt && now - this.resetAt < 900) set('RESET', 'c1');
    const playing = this.anims.dec && this.prog(this.anims.dec, now) < 1;
    if (playing && this.cms >= 12 && (this.vclock % 1) < 0.5) set('CLK', 'g1');
    for (const pd of this.els.pads) {
      const cls = st[pd.name];
      this.setC(pd.c, pd.base + (cls ? ' dv-' + cls : ''));
    }
    const noAddr = cur && (cur.type === 'inta' || cur.type === 'halt');
    const ringCol = !cur ? dieP().scribe : fpuIo ? THEME.lavender : cur.T === 0 ? (noAddr ? dieP().scribe : THEME.cyan) : THEME.gold;
    this.setA(this.els.ring, 'stroke', ringCol);
    this.setA(this.els.ring, 'opacity', cur ? '0.9' : '0.55');
    this.setA(this.els.addrBus, 'opacity', cur && cur.T === 0 && !noAddr ? '1' : '0.7');
    // processor extension interface, link wires and the 80287 pads
    const E = this.els, F = E.f87, W = E.wires || {};
    const peio = pep >= 0 && pep < 1 ? pe : null;
    const port = peio ? peio.e.addr : 0;
    const sig = {
      PEREQ: st.PEREQ === 'f1', PEACK: st.PEACK === 'f1', BUSY: busy, ERROR: ferr,
      NPRD: !!(peio && peio.type === 'ior'), NPWR: !!(peio && peio.type === 'iow'),
      CMD0: !!(peio && (port & 2)), CMD1: !!(peio && (port & 4)),
    };
    for (const n in sig) {
      if (W[n]) this.setC(W[n], 'dv-wire' + (sig[n] ? ' dv-on' : ''));
      if (F.pads && F.pads[n]) this.setC(F.pads[n].c, 'dv-pad' + (sig[n] ? (n === 'ERROR' ? ' dv-c1' : ' dv-f1') : ''));
    }
    if (F.bi) for (const x of F.bi) { this.setT(x.t, sig[x.n] ? '1' : '0'); this.setC(x.c, 'dv-cell dv-l' + (sig[x.n] ? ' dv-on' : '')); }
    this.setA(E.peReq, 'fill', sig.PEREQ ? THEME.lavender : dieP().dot);
    this.setA(E.peAck, 'fill', sig.PEACK ? THEME.lavender : dieP().dot);
    this.setT(F.bsy.t, busy ? '1' : '0');
    this.setC(F.bsy.c, 'dv-cell dv-l' + (busy ? ' dv-on' : ''));
  }
  stepBusCtl(now) {
    const E = this.els, cur = this.curBus(now);
    for (let i = 0; i < 3; i++) this.setC(E.bcT[i], 'dv-tstate' + (cur && Math.min(2, cur.T) === i ? ' dv-on' : ''));
    const type = cur ? cur.type : null;
    const fpuIo = cur && (cur.e.dev === 'fpu' || cur.e.owner === 'fpu');
    const name = !cur ? 'IDLE  Ti' : (fpuIo ? '287 ' : '') + (type === 'halt' ? 'HALT/SHUTDOWN' : DIE_CYCLE[type] || type);
    this.setT(E.bcType, name);
    this.setA(E.bcType, 'class', !cur ? 'dv-m' : fpuIo ? 'dv-lv' : /io|inta|halt/.test(type) ? 'dv-mg' : 'dv-go');
    const s = cur ? D286_STATUS[type] || [1, 1, 1, 1] : null;
    E.bcBits.forEach((t, j) => this.setT(t, !s ? (j >= 2 ? '1' : '·') : (j >= 2 && cur.T > 0 ? '1' : String(s[j]))));
    const nx = this.nextBus;
    this.setT(E.bcPipe, cur && cur.T >= 1 && nx && nx !== cur.e ? 'next address out in Tc' : cur && cur.len > 2 ? `${cur.len - 2} wait state${cur.len > 3 ? 's' : ''}` : '');
  }
  stepMisc(now) {
    const E = this.els;
    const dec = this.anims.dec;
    const fastOn = this.lastFast && now - this.lastFast < 160;
    let pos = -1;
    if (dec && this.dec && dec.serial === this.serial) {
      const p = this.prog(dec, now);
      if (p >= 0 && p < 1) pos = (((this.dec.bytes[0] || 0) * 13 + Math.floor(p * this.cycles / 2) * 7) * 2654435761 >>> 0) % 15;
    }
    if (fastOn) pos = Math.floor(now / 70) % 15;
    this.setA(E.romRow, 'x', String(62 + Math.max(0, pos) * 6.6));
    this.setA(E.romRow, 'opacity', pos < 0 ? '0' : fastOn ? '0.4' : '0.9');
    const playing = dec && this.prog(dec, now) < 1 && !fastOn;
    const c = playing ? Math.min(this.cycles, Math.max(0, Math.floor(this.vclock))) : 0;
    this.setT(E.decClk, playing ? `clock ${c} / ${this.cycles}` : '');
    this.setA(E.clkDot, 'fill', playing && (this.vclock % 1) < 0.5 ? THEME.phosphor : fastOn ? THEME.gold : dieP().dot);
    this.setT(E.clkText, fastOn ? 'free running' : playing ? `${this.cms >= 1 ? Math.round(this.cms) : this.cms.toFixed(1)} ms/clock` : this.mhz());
  }
  stepOverlay(now) {
    this.lastNow = now;
    const E = this.els, a = this.ovl;
    if (!E.ovl) return;
    const p = a ? this.prog(a, now) : 2;
    if (p < 0 || p >= 1) { if (E.ovl.getAttribute('display') !== 'none') E.ovl.setAttribute('display', 'none'); if (p >= 1) this.ovl = null; return; }
    E.ovl.removeAttribute('display');
    const op = Math.min(clamp((now - a.start) / 160, 0, 1), p > 0.8 ? (1 - p) / 0.2 : 1);
    E.ovl.setAttribute('opacity', clamp(op, 0, 1).toFixed(2));
    const pulse = this.reduced ? 3 : 3 + 2.5 * (0.5 + 0.5 * Math.sin(now / 90));
    E.ovlBox.setAttribute('stroke-width', pulse.toFixed(1));
  }

  // ---------- renders ----------
  renderAll() {
    super.renderAll();
    if (!this.els || !this.els.desc) return;
    for (const n of D286_SREGS) this.renderDesc(n);
    this.renderSys(); this.renderIq(); this.renderPei();
  }
  renderDesc(n) {
    const el = this.els.desc && this.els.desc[n], d = this.mdl.desc && this.mdl.desc[n];
    if (!el || !d) return;
    this.setT(el.sel, hex4(d.sel));
    this.setT(el.base, dvHex6(d.base));
    this.setT(el.limit, hex4(d.limit));
    this.setT(el.ar, hex2(d.access));
    const acc = d.access, code = (acc & 0x18) === 0x18, dpl = (acc >> 5) & 3;
    let type;
    if (d.table === 'real') type = 'real';
    else if (!(acc & 0x80)) type = 'absent';
    else if (!(acc & 0x10)) type = 'system';
    else type = (code ? 'code' + (acc & 2 ? 'R' : '') : 'data' + (acc & 2 ? 'W' : '')) + ' ' + dpl;
    this.setT(el.type, type);
  }
  renderSys() {
    const E = this.els, s = this.mdl.sys;
    if (!E.msw || !s) return;
    E.msw.forEach((x, i) => this.setC(x.c, 'dv-cell dv-l' + ((s.msw >> i) & 1 ? ' dv-on' : '')));
    const tb = r => (r ? `${dvHex6(r.base)} ${hex4(r.limit)}` : '------ ----');
    const sb = r => (r ? `${hex4(r.sel)} ${dvHex6(r.base)} ${hex4(r.limit)}` : '---- ------ ----');
    this.setT(E.gdtr, 'GDTR ' + tb(s.gdtr));
    this.setT(E.idtr, 'IDTR ' + tb(s.idtr));
    this.setT(E.ldtr, 'LDTR ' + sb(s.ldtr));
    this.setT(E.trr, 'TR ' + sb(s.tr));
    this.setT(E.cpl, 'CPL ' + s.cpl);
    this.setT(E.prCpl, 'CPL ' + s.cpl + (s.msw & 1 ? '' : ' (real mode)'));
    this.setA(E.cpl, 'class', s.msw & 1 ? 'dv-lv' : 'dv-m');
  }
  renderSigma() {
    const E = this.els, s = this.mdl.sig;
    if (!E.adOff || !s) return;
    const d = this.mdl.desc && this.mdl.desc[s.seg];
    const base = s.base !== undefined ? s.base : d ? d.base : (s.segv << 4);
    const lim = d ? d.limit : 0xFFFF;
    this.setT(E.adOff, hex4(s.off));
    this.setT(E.adSeg, (s.seg || 'CS') + ' base');
    this.setT(E.adBase, dvHex6(base));
    this.setT(E.adPhys, dvHex6(s.phys));
    this.setT(E.prLim, `${s.seg || 'CS'} limit ${hex4(lim)}`);
    const ex = this.mdl.exc && this.ovl ? this.mdl.exc : null;
    if (ex) {
      this.setT(E.prChk, `${ex.name} ${ex.err !== undefined && ex.err !== null ? hex4(ex.err) : ''}`);
      this.setA(E.prChk, 'class', 'dv-mg');
      this.setT(E.prSt, 'FAULT');
      this.setA(E.prSt, 'class', 'dv-mg');
    } else {
      const ok = s.off <= lim;
      this.setT(E.prChk, `${hex4(s.off)} ≤ ${hex4(lim)} ${ok ? '✓' : '✗'}`);
      this.setA(E.prChk, 'class', ok ? 'dv-ph' : 'dv-mg');
      this.setT(E.prSt, ok ? 'OK' : 'LIMIT');
      this.setA(E.prSt, 'class', ok ? 'dv-ph' : 'dv-mg');
    }
  }
  renderIq() {
    const E = this.els;
    if (!E.iq) return;
    const n = this.iqN || 0, tx = this.iqTexts || [];
    E.iq.forEach((x, i) => {
      const on = i < n;
      const t = on ? (tx[i] || 'decoded') : '';
      this.setT(x.t, t.length > 34 ? t.slice(0, 33) + '…' : t);
      this.setA(x.t, 'class', on ? (i === 0 ? 'dv-ph' : 'dv-v') : 'dv-f');
      this.setA(x.r, 'stroke', on ? THEME.phosphor : dieP().cellStroke);
      this.setA(x.r, 'stroke-dasharray', on ? 'none' : '3 3');
    });
  }
  renderPei() {
    const E = this.els, F = E.f87, x = this.mdl.pei;
    if (!E.peiText || !x) return;
    const e = x.e, d = e.width === 2 ? hex4(e.data) : hex2(e.data);
    const io = x.type === 'ior' || x.type === 'iow';
    const t = io ? `${x.type === 'iow' ? 'NPWR' : 'NPRD'} ${hex2(e.addr)}h ${x.type === 'iow' ? '←' : '→'} ${d}` : `${x.type} ${dvHex6(e.addr)}`;
    this.setT(E.peiText, t);
    if (F && F.biText) this.setT(F.biText, t);
  }
  renderBusText() {
    const b = this.mdl.bus, E = this.els;
    if (!E.laA || !b) return;
    const e = b.e, io = b.type === 'ior' || b.type === 'iow';
    this.setT(E.laA, b.type === 'inta' ? 'A vector' : io ? 'port ' + hex4(e.addr) : 'A ' + dvHex6(e.addr));
    const nx = this.nextBus;
    this.setT(E.laNext, nx && nx !== e ? 'pins next ' + dvHex6(nx.addr) : '');
    this.setT(E.xcD, 'D ' + (e.width === 2 ? hex4(e.data) : hex2(e.data)));
    this.setT(E.xcDir, (/w/.test(b.type) ? 'write' : 'read') + (e.dev ? ' · ' + e.dev : '') + (e.width === 2 ? ' · word' : ' · byte'));
  }
  renderFlags() {
    const f = this.mdl.flags;
    for (const x of this.els.flags) {
      const v = x.n === 'IOPL' ? (f >> 12) & 3 : (f >> x.bit) & 1;
      this.setT(x.v, String(v));
      this.setC(x.c, 'dv-cell' + (v ? ' dv-on' : ''));
    }
  }
  onFlags(e, a) {
    const ch = (e.old === undefined ? this.mdl.flags : e.old) ^ e.v;
    this.mdl.flags = e.v;
    for (const f of this.els.flags) if (ch & (f.n === 'IOPL' ? 0x3000 : 1 << f.bit)) this.flash('flag:' + f.n, a, 6, 900);
    this.renderFlags();
  }
  renderIntr() {
    const E = this.els, e = this.mdl.intr;
    if (!E.intText) return;
    if (!e) { this.setT(E.intText, ''); return; }
    const exc = e.src === 'exc' ? (e.name || (D286_EXC[e.vec] || [])[0] || 'exception') : null;
    const src = { sw: 'INT', irq: 'IRQ', nmi: 'NMI' }[e.src] || '';
    this.setT(E.intText, exc ? `${exc} · vector ${hex2(e.vec)}h` : `${src} ${hex2(e.vec)}h`);
    this.setA(E.intText, 'class', 'dv-mg');
  }
}

// ======================================================================================
// 80386 die (app.model '80386'): Intel's six units, as in the block diagram of the 386
// data sheet. Top: segmentation unit, paging unit, bus interface unit. Bottom: execution
// unit (data unit, control unit, protection test unit), instruction decode unit, code
// prefetch unit. The machine has a 16-bit data bus like the 386SX, so the pad ring has
// A23-A1, BHE, BLE and D15-D0. The 80387 sits next to it (the 80287 floor plan).
// ======================================================================================

const dvHex8 = v => hex(v >>> 0, 8);
const D386_REGS = ['EAX', 'EBX', 'ECX', 'EDX', 'ESI', 'EDI', 'EBP', 'ESP'];
const D386_ENC = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI'];   // cpu.regs32 order
const D386_SREGS = ['ES', 'CS', 'SS', 'DS', 'FS', 'GS'];                        // cpu.sregs order
const D386_FLAGS = [['VM', 17], ['RF', 16], ['NT', 14], ['IOPL', 12], ['OF', 11], ['DF', 10], ['IF', 9],
  ['TF', 8], ['SF', 7], ['ZF', 6], ['AF', 4], ['PF', 2], ['CF', 0]];
const D386_CR0 = [['PE', 0], ['MP', 1], ['EM', 2], ['TS', 3], ['ET', 4], ['PG', 31]];
// M/IO, D/C, W/R for each bus cycle type (Intel 386 data sheet)
const D386_STATUS = { inta: [0, 0, 0], ior: [0, 1, 0], iow: [0, 1, 1], code: [1, 0, 0], halt: [1, 0, 1], memr: [1, 1, 0], memw: [1, 1, 1] };
const D386_EXC = Object.assign({}, D286_EXC, { 9: ['#09', '387 OPERAND OVERRUN'], 7: ['#NM', 'NO MATH UNIT'], 14: ['#PF', 'PAGE FAULT'], 16: ['#MF', 'MATH FAULT'] });
// 100 pads, 25 on each side, clockwise from the top left (the signals of the 386SX).
const D386_PADS = [
  'VCC', 'CLK2', 'RESET', 'VSS', 'ADS', 'NA', 'READY', 'VCC', 'VSS', 'HOLD', 'HLDA', 'INTR', 'NMI',
  'VSS', 'VCC', 'LOCK', 'M/IO', 'D/C', 'W/R', 'VSS', 'BHE', 'BLE', 'VCC', 'FLT', 'VSS',
  'PEREQ', 'BUSY', 'ERROR', 'VCC', 'VSS', 'A1', 'A2', 'A3', 'A4', 'A5', 'VCC', 'A6', 'A7', 'A8',
  'VSS', 'A9', 'A10', 'A11', 'A12', 'VCC', 'A13', 'A14', 'A15', 'VSS', 'A16',
  'A17', 'A18', 'A19', 'VCC', 'A20', 'A21', 'A22', 'A23', 'VSS', 'VCC', 'D15', 'D14', 'D13',
  'VSS', 'D12', 'D11', 'D10', 'VCC', 'D9', 'D8', 'D7', 'VSS', 'D6', 'D5', 'D4',
  'D3', 'D2', 'VCC', 'D1', 'D0', 'VSS', 'VCC', 'VSS', 'NC', 'NC', 'VCC', 'VSS', 'NC',
  'NC', 'VSS', 'VCC', 'NC', 'VSS', 'VCC', 'NC', 'NC', 'VSS', 'VCC', 'NC', 'VSS',
];
// Active-low pins (the data sheet writes them with #).
const D386_LOW = new Set(['ADS', 'NA', 'READY', 'LOCK', 'BHE', 'BLE', 'BUSY', 'ERROR', 'FLT']);
const DIE386_INFO = {
  desc: ['Segment descriptor caches', 'The segmentation unit keeps a hidden copy of the descriptor of each of the six segment registers ES CS SS DS FS GS: selector, 32-bit base, limit (the G bit makes it count in 4 KB units) and the access byte. G and D are the granularity bit and the default size bit (32-bit code or stack).'],
  linadd: ['Linear address adder', 'The effective address from the execution unit (up to 32 bits) and the segment base from the descriptor cache make the 32-bit linear address: base + offset. When paging is off, the linear address is the physical address.'],
  limchk: ['Limit and attribute checker', 'At the same time as the addition, this unit compares the offset with the segment limit and checks the access type (read, write, execute). A violation gives #GP, or #SS for the stack segment.'],
  sysr: ['Descriptor table registers', 'GDTR and IDTR hold the base and the limit of the global descriptor table and the interrupt descriptor table. LDTR and TR hold a selector and a hidden descriptor of the local descriptor table and of the task state segment.'],
  tlb: ['Translation lookaside buffer', 'The TLB keeps 32 page translations in 8 sets of 4 ways. Bits 12 to 14 of the linear address select the set, and the 4 ways are compared at the same time. A hit gives the page frame without a memory access. Each cell shows the linear page number (the top 20 bits); a gold number is a dirty page.'],
  walker: ['Page table walker', 'On a TLB miss, the paging unit reads two tables in memory: the page directory entry (CR3 + DIR × 4) and then the page table entry (PDE frame + TABLE × 4). It sets the accessed bit (and the dirty bit for a write) and puts the translation in the TLB. A missing page gives #PF with the linear address in CR2.'],
  pgadd: ['Page adder', 'The physical address is the page frame from the TLB (the top 20 bits) with the 12-bit offset of the linear address.'],
  prio: ['Request prioritizer', 'Three units ask for the bus: the code prefetch unit, the execution unit (data), and the paging unit (page table reads). The prioritizer gives the bus to one of them for each bus cycle; data comes before code.'],
  addrdrv: ['Address driver', 'Drives A23 to A1 and the byte enables BHE and BLE. The 16-bit bus of this model (like the 386SX) has no A0: BLE selects the low byte, BHE the high byte.'],
  busctl: ['Pipeline and bus control', 'A bus cycle takes two clocks: T1 (ADS goes low, the address and the status M/IO D/C W/R are valid) and T2 (the data moves; READY ends the cycle). Each wait state adds one T2. With NA the next address can come in T2 (address pipelining); this board does not use it.'],
  xcvr: ['Multiplexer and transceivers', 'D15 to D0 move 16 bits in each bus cycle. A 32-bit operand needs two bus cycles; an odd address gives a byte, a word and a byte. The multiplexer puts each word in the correct half of the 32-bit internal bus.'],
  pfq: ['Code prefetch unit: 16-byte queue', 'When the bus is free, the prefetch unit fetches the next code words into the 16-byte prefetch queue. A jump flushes it. The prefetcher does not walk the page tables: it stops at a page that is not in the TLB.'],
  pfa: ['Prefetch address', 'The CS base and limit that the prefetch unit uses, and the physical address of the last code fetch.'],
  dec: ['Instruction decode unit', 'The decoder takes bytes from the prefetch queue and decodes one instruction in advance. USE16 or USE32 shows the default operand and address size from the D bit of the CS descriptor; the 66h and 67h prefixes change it for one instruction.'],
  iq: ['Decoded instruction queue', 'Up to 3 decoded instructions wait here for the execution unit, so the execution unit seldom waits for the decoder.'],
  regs: ['Register file', 'The eight 32-bit general registers of the data unit. The low 16 bits are AX to DI of the 8086; the dim digits are bits 31 to 16.'],
  alu: ['ALU and barrel shifter', 'The 32-bit arithmetic and logic unit. The barrel shifter moves a value by any count in one clock (shifts, rotates, SHLD, SHRD, bit tests).'],
  muldiv: ['Multiply and divide', 'The multiply/divide logic does MUL, IMUL, DIV and IDIV one bit per clock, up to 32 steps plus overhead.'],
  prot: ['Protection test unit', 'Checks the privilege rules in microcode: CPL (the current privilege level), DPL of the descriptor and RPL of the selector. It shows the mode: real, protected or virtual-8086 (V86).'],
  ctl: ['Control unit and microcode ROM', 'The microcode ROM controls each instruction step by step. CR0 holds PE (protection on), MP, EM, TS (task switched), ET (80387) and PG (paging on). The line at the right shows the last interrupt or exception.'],
  flags: ['EFLAGS', 'The flags of the 80286 plus RF (resume, bit 16) and VM (virtual-8086 mode, bit 17). IOPL is the I/O privilege level (bits 12 and 13).'],
  pads: ['Pads (100)', 'Signals like the 80386SX: A23-A1, D15-D0, BHE and BLE, the bus cycle status M/IO D/C W/R, ADS, NA, READY, LOCK, HOLD/HLDA, INTR, NMI, RESET, CLK2 (twice the processor clock), the 80387 lines PEREQ BUSY ERROR, and many VCC and VSS pads.'],
  f87bi: ['80387 bus interface', 'The 80386 moves opcodes and operands in I/O cycles to the 80387 ports (A23 high selects the 80387 through NPS1). W/R selects read or write, CMD0 (A2) tells an opcode from data.'],
  f87sw: ['80387 status word', 'Condition codes C3 to C0, TOP, the exception flags and BUSY. FSTSW AX copies it to AX.'],
  f87cw: ['80387 control word', 'Precision control, rounding control and the six exception masks.'],
  f87neu: ['80387 register stack', 'Eight 80-bit registers used as a circular stack. TOP selects the physical register that is ST(0).'],
  link: ['80386 to 80387', 'PEREQ asks for an operand transfer, BUSY makes the 80386 wait (WAIT, ESC), ERROR reports an unmasked 80387 exception (#MF, vector 16).'],
  npdec: ['80387 select', 'A23 and M/IO of an I/O cycle select the 80387 (NPS1). ADS, W/R and A2 (CMD0) go to it directly.'],
};
// Double-click: the chip and the block label on the 3D die floor plan of the 386.
const DIE386_3D = {
  desc: ['cpu', 'SEGMENT CACHES'], sysr: ['cpu', 'SEGMENT CACHES'], linadd: ['cpu', 'LINEAR ADDER'], limchk: ['cpu', 'LIMIT CHECK'],
  tlb: ['cpu', 'TLB'], walker: ['cpu', 'PAGE WALKER'], pgadd: ['cpu', 'PAGE ADDER'],
  prio: ['cpu', 'BUS INTERFACE'], addrdrv: ['cpu', 'BUS INTERFACE'], busctl: ['cpu', 'BUS INTERFACE'], xcvr: ['cpu', 'BUS INTERFACE'],
  pfq: ['cpu', 'PREFETCH QUEUE'], pfa: ['cpu', 'PREFETCH QUEUE'], dec: ['cpu', 'INSTRUCTION DECODER'], iq: ['cpu', 'DECODED QUEUE'],
  regs: ['cpu', 'REGISTERS'], alu: ['cpu', 'ALU'], flags: ['cpu', 'ALU'], muldiv: ['cpu', 'MULTIPLY DIVIDE'],
  prot: ['cpu', 'PROTECTION TEST'], ctl: ['cpu', 'CONTROL ROM'], pads: ['cpu', null],
  f87bi: ['fpu', 'QUEUE TRACKER'], f87sw: ['fpu', 'STATUS'], f87cw: ['fpu', 'CONTROL'], f87neu: ['fpu', 'REGISTER STACK'],
  link: ['fpu', 'QUEUE TRACKER'], npdec: ['fpu', 'QUEUE TRACKER'],
};
// Buses of the 386 die: the internal bus between the two rows (y = D386_GY) and the
// data unit bus of the execution unit (x = D386_EX).
const D386_GY = 366, D386_EX = 254;

class Die386View extends Die286View {
  constructor(host, app) {
    super(host, app);
    this.svg.setAttribute('aria-label', 'Die floor plans of the 80386 CPU and the 80387 coprocessor. The plus and minus keys zoom, the 0 key fits the dies.');
  }
  info(id) { return DIE386_INFO[id] || DIE286_INFO[id] || DIE_INFO[id]; }
  map3D() { return DIE386_3D; }
  get fpuName() { return '80387'; }
  // the 16-byte queue: two rows of 8 chips
  get QN() { return 16; }
  get QX0() { return 734; }
  get QDX() { return 22.7; }
  get QY() { return 418; }
  get QH() { return 36; }
  get QW() { return 20; }
  get QF() { return 11.5; }
  qx(slot) { return this.QX0 + (slot % 8) * this.QDX; }
  qy(slot) { return this.QY + (slot >= 8 ? 56 : 0); }
  qGone(c, age) {
    const u = easeOut(clamp(age, 0, 1));
    if (c.state === 'dis') c.y = this.qy(0) + u * 40;
    else c.x = this.QX0 - u * 26;
    c.op = 1 - age;
  }
  legendSub() { return `Intel 80386 CPU and 80387 coprocessor, ${this.mhz()}, 16-bit bus`; }
  // A block whose title gets smaller when it does not fit (res = room kept at the right).
  block(p, id, x, y, w, h, title, cls) {
    const g = super.block(p, id, x, y, w, h, '', cls);
    if (title) {
      const res = { tlb: 96, walker: 84, pfq: 48, iq: 44 }[id] || 0;
      const w13 = strokeTextWidth(title, 13, 1.4);
      const size = clamp(13 * (w - 18 - res) / w13, 8, 13);
      this.silk(g, title, x + 9, y + 8 + (13 - size) * 0.3, size, cls === 'l' ? 'dv-silk-l' : 'dv-silk');
    }
    return g;
  }

  // ---------- machine state ----------
  readMachine() {
    const c = this.m.cpu, R = this.mdl.regs;
    if (!c.regs32) return;
    D386_ENC.forEach((n, i) => { R[n] = c.regs32[i] >>> 0; });
    D386_SREGS.forEach((n, i) => { R[n] = c.sregs[i]; });
    R.EIP = c.ip >>> 0;
    this.mdl.flags = c.eflags;
    const q = c.q.slice(0, this.QN);
    if (q.join() !== this.mdl.q.join()) { this.mdl.q = q; this.rebuildChips(); }
    this.readFpu();
    const D = this.mdl.desc = this.mdl.desc || {};
    const pe = !!(c.cr[0] & 1);
    D386_SREGS.forEach((n, i) => {
      const d = c.cache[i];
      D[n] = { sel: c.sregs[i], base: d.base >>> 0, limit: d.limit >>> 0, access: d.access, flags: d.flags || 0, table: pe && !c.vm ? '' : 'real' };
    });
    const cp = r => (r ? Object.assign({}, r) : null);
    this.mdl.sys = { msw: c.cr[0] & 0xFFFF, cr0: c.cr[0] >>> 0, cr2: c.cr[2] >>> 0, cr3: c.cr[3] >>> 0, gdtr: cp(c.gdtr), idtr: cp(c.idtr),
      ldtr: cp(c.ldtr), tr: cp(c.tr), cpl: c.cpl || 0, vm: !!c.vm, pe, pg: !!c.paging, known: true };
  }
  // Linear -> physical for the view: the TLB, else the tables through peek8 (no bus cycles).
  peekLin(lin) {
    const c = this.m.cpu, m = this.m;
    lin >>>= 0;
    if (!c.paging) return lin;
    const e = c.tlbFind ? c.tlbFind(lin) : null;
    if (e) return (e.phys | (lin & 0xFFF)) >>> 0;
    const rd = a => { let v = 0; for (let i = 3; i >= 0; i--) v = (v << 8) | (m.peek8 ? m.peek8((a + i) >>> 0) : m.mem[(a + i) & (m.mem.length - 1)]); return v >>> 0; };
    const pde = rd(((c.cr[3] & 0xFFFFF000) + (lin >>> 22) * 4) >>> 0);
    if (!(pde & 1)) return -1;
    const pte = rd(((pde & 0xFFFFF000) + ((lin >>> 12) & 0x3FF) * 4) >>> 0);
    if (!(pte & 1)) return -1;
    return ((pte & 0xFFFFF000) | (lin & 0xFFF)) >>> 0;
  }
  peekNext(n) {
    const m = this.m, c = m.cpu, out = [];
    if (typeof Disasm86 === 'undefined' || !c.cache) return out;
    const big = !!c.cache[1].big, base = c.cache[1].base >>> 0;
    let ip = c.ip >>> 0;
    const rd = lin => { const p = this.peekLin(lin); return p < 0 ? 0 : (m.peek8 ? m.peek8(p) : m.mem[p & (m.mem.length - 1)]); };
    for (let k = 0; k < n; k++) {
      try {
        const d = Disasm86.decode(i => rd(base + ((big ? ip + i : (ip + i) & 0xFFFF) >>> 0)), ip, { cpu: '386', bits: big ? 32 : 16 });
        out.push(d.text);
        ip = big ? (ip + Math.max(1, d.len)) >>> 0 : (ip + Math.max(1, d.len)) & 0xFFFF;
      } catch (e) { break; }
    }
    return out;
  }

  // ---------- the 80386 die ----------
  static padPos386(i) {
    const M = 50, sx = (DIE_W - 2 * M) / 25, sy = (DIE_H - 2 * M) / 25;
    if (i < 25) return { x: M + (i + 0.5) * sx, y: 19, v: false, side: 't' };
    if (i < 50) return { x: DIE_W - 19, y: M + (i - 25 + 0.5) * sy, v: true, side: 'r' };
    if (i < 75) return { x: DIE_W - M - (i - 50 + 0.5) * sx, y: DIE_H - 19, v: false, side: 'b' };
    return { x: 19, y: DIE_H - M - (i - 75 + 0.5) * sy, v: true, side: 'l' };
  }
  build86(g) {
    const E = this.els, P = dieP();
    this.g86 = g;
    E.desc = {};
    svgEl('rect', { x: -6, y: -6, width: DIE_W + 12, height: DIE_H + 12, rx: 10, fill: P.dieShadow, stroke: THEME.line }, g);
    svgEl('rect', { x: 0, y: 0, width: DIE_W, height: DIE_H, rx: 4, fill: 'url(#dv-si)' }, g);
    const tex = DieView.texture(DIE_W, DIE_H, 80386);
    if (tex) svgEl('image', { href: tex, x: 0, y: 0, width: DIE_W, height: DIE_H, 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 0, y: 0, width: DIE_W, height: DIE_H, rx: 4, fill: 'url(#dv-sheen)', 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 3.5, y: 3.5, width: DIE_W - 7, height: DIE_H - 7, rx: 3, fill: 'none', stroke: P.scribe, 'stroke-width': 1, opacity: 0.6 }, g);
    E.ring = svgEl('rect', { x: 38, y: 38, width: DIE_W - 76, height: DIE_H - 76, rx: 8, fill: 'none', stroke: P.scribe, 'stroke-width': 3, opacity: 0.55 }, g);
    // the six units
    const regPG = dvMix(THEME.magenta, THEME.void, 0.55);
    const region = (x, y, w, h, col, fill) => svgEl('rect', { x, y, width: w, height: h, rx: 2, fill, stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': '6 5', opacity: 0.85 }, g);
    region(46, 46, 338, 306, P.regAU, dvA(THEME.lavender, 0.03));
    region(392, 46, 260, 306, regPG, dvA(THEME.magenta, 0.025));
    region(660, 46, 254, 306, P.regBU, dvA(THEME.gold, 0.025));
    region(46, 380, 424, 334, P.regEU, dvA(THEME.phosphor, 0.02));
    region(478, 380, 222, 334, P.regBIU, dvA(THEME.cyan, 0.025));
    region(708, 380, 206, 334, P.regBIU, dvA(THEME.cyan, 0.03));
    // internal buses (under the blocks)
    const bus = (d, col, w, op) => svgEl('path', { d, class: 'dv-bus', stroke: col, 'stroke-width': w, opacity: op }, g);
    E.gBus = bus(`M50 ${D386_GY}H910`, P.busMain, 5, 0.55);
    bus(`M${D386_EX} ${D386_GY}V706`, P.busMain, 4, 0.5);
    bus(`M388 ${D386_GY}V133H400M388 170H376M388 327H376M656 ${D386_GY}V87H668M656 157H668M656 257H644M656 324H644M474 ${D386_GY}V600H486M474 474H486M704 ${D386_GY}V443H716`, P.busMain, 2.4, 0.45);
    bus(`M787 346V${D386_GY}M560 390V${D386_GY}M134 300V${D386_GY}`, P.busMain, 2.4, 0.45);
    E.addrBus = bus('M214 210H388M644 324H656V157H668', P.busA, 2.6, 0.7);
    this.txt(g, 'INTERNAL BUS 32', 54, D386_GY - 5, 10, 'dv-m');
    // blocks
    this.buildDesc(g); this.buildLinAdd(g); this.buildLimChk(g); this.buildSys(g);
    this.buildTlb(g); this.buildWalker(g); this.buildPgAdd(g);
    this.buildPrio(g); this.buildAddrDrv(g); this.buildBusCtl386(g); this.buildXcvr(g);
    this.buildRegs386(g); this.buildAlu386(g); this.buildMulDiv(g); this.buildProt(g); this.buildCtl(g); this.buildFlags386(g);
    this.buildDec386(g); this.buildIq(g); this.buildPfq(g); this.buildPfa(g);
    const tab = (x, y, s, col) => {
      const w = strokeTextWidth(s, 9, 1.4) + 14;
      svgEl('rect', { x, y: y - 8, width: w, height: 16, rx: 3, fill: P.tabFill, stroke: col, 'stroke-width': 1.2 }, g);
      this.silk(g, s, x + 7, y - 4.5, 9, 'dv-silk');
    };
    tab(60, 46, 'SEGMENTATION UNIT', P.regAU);
    tab(404, 46, 'PAGING UNIT', regPG);
    tab(672, 46, 'BUS INTERFACE UNIT', P.regBU);
    tab(60, 380, 'EXECUTION UNIT', P.regEU);
    tab(488, 380, 'DECODE UNIT', P.regBIU);
    tab(716, 380, 'PREFETCH UNIT', P.regBIU);
    this.buildPads386(g);
    this.buildOverlay(g);
    this.tokLayer = svgEl('g', { class: 'dv-toks', 'pointer-events': 'none' }, g);
  }
  // ---- segmentation unit ----
  buildDesc(g) {
    const b = this.block(g, 'desc', 54, 56, 322, 150, 'DESCRIPTOR CACHES');
    const P = dieP(), E = this.els, hy = 88;
    this.txt(b, 'SEG', 60, hy, 9, 'dv-f');
    this.txt(b, 'SEL', 124, hy, 9, 'dv-f', 'end');
    this.txt(b, 'BASE', 204, hy, 9, 'dv-f', 'end');
    this.txt(b, 'LIMIT', 284, hy, 9, 'dv-f', 'end');
    this.txt(b, 'AR', 314, hy, 9, 'dv-f', 'end');
    this.txt(b, 'G', 334, hy, 9, 'dv-f', 'middle');
    this.txt(b, 'D', 356, hy, 9, 'dv-f', 'middle');
    D386_SREGS.forEach((n, i) => {
      const y0 = 93 + i * 18.6;
      svgEl('rect', { x: 58, y: y0, width: 314, height: 17.4, rx: 3, fill: i % 2 ? P.row0 : P.row1, opacity: 0.9 }, b);
      const fl = this.flashRect(b, 58, y0, 314, 17.4, dvA(THEME.phosphor, 0.28));
      this.txt(b, n, 62, y0 + 13.5, 12.5, 'dv-cy', 'start', { 'font-weight': 700 });
      const sel = this.txt(b, '0000', 124, y0 + 13.5, 12.5, 'dv-v', 'end', { 'font-weight': 600 });
      const base = this.txt(b, '00000000', 204, y0 + 13.5, 12.5, 'dv-cy', 'end', { 'font-weight': 600 });
      const limit = this.txt(b, '0000FFFF', 284, y0 + 13.5, 12.5, 'dv-v', 'end');
      const ar = this.txt(b, '93', 314, y0 + 13.5, 12, 'dv-lv', 'end');
      const gb = this.txt(b, '0', 334, y0 + 13.5, 12, 'dv-f', 'middle', { 'font-weight': 700 });
      const db = this.txt(b, '0', 356, y0 + 13.5, 12, 'dv-f', 'middle', { 'font-weight': 700 });
      E.desc[n] = { sel, base, limit, ar, gb, db, fl };
      this.els.regs[n] = { lo: sel, fl, y: y0 + 9, x: 376 };
    });
  }
  buildLinAdd(g) {
    const b = this.block(g, 'linadd', 54, 214, 164, 86, 'LINEAR ADDER');
    const E = this.els;
    E.laSeg = this.txt(b, 'CS base', 62, 246, 10.5, 'dv-m');
    E.laBase = this.txt(b, '00000000', 210, 246, 13, 'dv-cy', 'end', { 'font-weight': 600 });
    this.txt(b, '+ offset', 62, 266, 10.5, 'dv-m');
    E.laOff = this.txt(b, '00000000', 210, 266, 13, 'dv-go', 'end', { 'font-weight': 600 });
    svgEl('line', { x1: 62, y1: 272, x2: 210, y2: 272, stroke: dieP().busA, 'stroke-width': 1.2 }, b);
    this.txt(b, 'Σ linear', 62, 291, 10.5, 'dv-cy', 'start', { 'font-weight': 700 });
    E.laLin = this.txt(b, '00000000', 210, 292, 15, 'dv-cy', 'end', { 'font-weight': 700 });
    E.sgFl = this.flashRect(b, 58, 275, 156, 22, dvA(THEME.cyan, 0.25));
  }
  buildLimChk(g) {
    const b = this.block(g, 'limchk', 226, 214, 150, 86, 'LIMIT CHECK');
    const E = this.els;
    E.lcLim = this.txt(b, 'limit 0000FFFF', 234, 246, 10.5, 'dv-m');
    E.lcChk = this.txt(b, '', 234, 266, 11, 'dv-ph', 'start', { 'font-weight': 700 });
    E.lcAttr = this.txt(b, '', 234, 291, 10, 'dv-v');
    E.lcSt = this.txt(b, 'OK', 368, 292, 13, 'dv-ph', 'end', { 'font-weight': 700 });
    E.lcFl = this.flashRect(b, 228, 216, 146, 82, dvA(THEME.cyan, 0.2));
  }
  buildSys(g) {
    const b = this.block(g, 'sysr', 54, 308, 322, 40, '');
    const E = this.els;
    E.gdtr = this.txt(b, '', 62, 324, 10.5, 'dv-v');
    E.idtr = this.txt(b, '', 216, 324, 10.5, 'dv-v');
    E.ldtr = this.txt(b, '', 62, 342, 10.5, 'dv-v');
    E.trr = this.txt(b, '', 216, 342, 10.5, 'dv-v');
    E.sysFl = this.flashRect(b, 56, 310, 318, 36, dvA(THEME.lavender, 0.25));
  }
  // ---- paging unit ----
  buildTlb(g) {
    const b = this.block(g, 'tlb', 400, 56, 244, 154, 'TLB');
    const P = dieP(), E = this.els;
    E.tlbStat = this.txt(b, '', 636, 70, 9.5, 'dv-m', 'end');
    this.txt(b, 'SET', 411, 86, 7.5, 'dv-f', 'middle');
    for (let w = 0; w < 4; w++) this.txt(b, 'WAY ' + w, 447 + w * 56, 86, 8, 'dv-f', 'middle');
    E.tlb = [];
    for (let s = 0; s < 8; s++) {
      const y0 = 90 + s * 14.6;
      this.txt(b, String(s), 411, y0 + 10.5, 9, 'dv-f', 'middle', { 'font-weight': 700 });
      for (let w = 0; w < 4; w++) {
        const x0 = 420 + w * 56;
        const r = svgEl('rect', { x: x0, y: y0, width: 54, height: 13.4, rx: 2.5, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
        const t = this.txt(b, '·', x0 + 27, y0 + 10.4, 10.5, 'dv-f', 'middle', { 'font-weight': 600 });
        E.tlb.push({ r, t, key: '' });
      }
    }
    E.tlbSetFl = this.flashRect(b, 404, 90, 238, 13.4, dvA(THEME.magenta, 0.3));
    E.tlbWayFl = svgEl('rect', { x: 420, y: 90, width: 54, height: 13.4, rx: 2.5, fill: dvA(THEME.phosphor, 0.35), stroke: THEME.phosphor, 'stroke-width': 1.6, opacity: 0, 'pointer-events': 'none' }, b);
  }
  buildWalker(g) {
    const b = this.block(g, 'walker', 400, 218, 244, 80, 'PAGE WALKER');
    const E = this.els, P = dieP();
    E.cr3 = this.txt(b, 'CR3 00000000', 636, 231, 9.5, 'dv-lv', 'end', { 'font-weight': 600 });
    const box = (x, w, lab, col) => {
      svgEl('rect', { x, y: 240, width: w, height: 27, rx: 3, fill: P.row1, stroke: col, 'stroke-width': 1 }, b);
      this.txt(b, lab, x + w / 2, 249, 7, 'dv-f', 'middle');
      return this.txt(b, '---', x + w / 2, 263, 12, 'dv-v', 'middle', { 'font-weight': 700 });
    };
    E.wDir = box(406, 70, 'DIR  31–22', THEME.lavender);
    E.wTbl = box(480, 70, 'TABLE  21–12', THEME.magenta);
    E.wOfs = box(554, 84, 'OFFSET  11–0', THEME.cyan);
    E.wPde = this.txt(b, 'PDE --------', 406, 288, 10, 'dv-m');
    E.wPte = this.txt(b, 'PTE --------', 490, 288, 10, 'dv-m');
    E.wSt = this.txt(b, 'OFF', 638, 289, 11, 'dv-f', 'end', { 'font-weight': 700 });
    E.walkFl = this.flashRect(b, 402, 220, 240, 76, dvA(THEME.lavender, 0.22));
  }
  buildPgAdd(g) {
    const b = this.block(g, 'pgadd', 400, 306, 244, 42, '');
    const E = this.els;
    this.silk(b, 'PAGE ADDER', 409, 312, 10, 'dv-silk');
    E.pgFrame = this.txt(b, 'paging off', 408, 341, 10, 'dv-m');
    E.pgPhys = this.txt(b, '00000000', 636, 342, 14, 'dv-cy', 'end', { 'font-weight': 700 });
    E.pgFl = this.flashRect(b, 402, 308, 240, 38, dvA(THEME.cyan, 0.25));
  }
  // ---- bus interface unit ----
  buildPrio(g) {
    const b = this.block(g, 'prio', 668, 56, 238, 58, 'REQUEST PRIORITIZER');
    const E = this.els;
    E.prioL = [['code', 'CODE', 678], ['data', 'DATA', 752], ['page', 'PAGE', 826]].map(([k, n, x]) => {
      const c = svgEl('circle', { cx: x + 4, cy: 97, r: 5.5, fill: dieP().dot }, b);
      this.txt(b, n, x + 15, 101, 11, 'dv-m', 'start', { 'font-weight': 700 });
      return { k, c };
    });
  }
  buildAddrDrv(g) {
    const b = this.block(g, 'addrdrv', 668, 122, 238, 66, 'ADDRESS DRIVER');
    const E = this.els;
    E.laA = this.txt(b, 'A ------', 676, 164, 17, 'dv-cy', 'start', { 'font-weight': 700 });
    E.laNext = this.txt(b, 'A23–A1', 676, 181, 9.5, 'dv-f');
    E.beL = ['BHE', 'BLE'].map((n, i) => {
      const x = 842 + i * 38;
      const c = svgEl('circle', { cx: x, cy: 158, r: 5.5, fill: dieP().dot }, b);
      this.txt(b, n, x, 178, 9, 'dv-m', 'middle', { 'font-weight': 700 });
      return c;
    });
  }
  buildBusCtl386(g) {
    const b = this.block(g, 'busctl', 668, 196, 238, 82, 'PIPELINE / BUS CONTROL');
    const E = this.els;
    E.bcType = this.txt(b, 'IDLE', 676, 232, 12.5, 'dv-m', 'start', { 'font-weight': 700 });
    E.bcBits = ['M/IO', 'D/C', 'W/R'].map((n, i) => {
      const x = 812 + i * 34;
      this.txt(b, n, x, 224, 8, 'dv-m', 'middle');
      return this.txt(b, '·', x, 239, 13, 'dv-mg', 'middle', { 'font-weight': 700 });
    });
    E.bcT = ['T1', 'T2'].map((n, i) => {
      const c = svgEl('g', { class: 'dv-tstate' }, b);
      svgEl('rect', { x: 676 + i * 44, y: 248, width: 40, height: 20, rx: 4 }, c);
      this.txt(c, n, 696 + i * 44, 262, 12, 'dv-m', 'middle', { 'font-weight': 700 });
      return c;
    });
    E.adsL = svgEl('circle', { cx: 776, cy: 258, r: 5, fill: dieP().dot }, b);
    this.txt(b, 'ADS', 786, 262, 9.5, 'dv-m', 'start', { 'font-weight': 700 });
    E.bcPipe = this.txt(b, 'NA off', 898, 262, 9, 'dv-f', 'end');
  }
  buildXcvr(g) {
    const b = this.block(g, 'xcvr', 668, 286, 238, 62, 'MUX / TRANSCEIVERS');
    const E = this.els;
    E.xcD = this.txt(b, 'D ----', 676, 327, 17, 'dv-go', 'start', { 'font-weight': 700 });
    E.xcDir = this.txt(b, '', 898, 323, 9.5, 'dv-m', 'end');
    this.txt(b, 'D15–D0 · a dword = 2 cycles', 676, 343, 8.5, 'dv-f');
  }
  // ---- execution unit ----
  buildRegs386(g) {
    const b = this.block(g, 'regs', 54, 390, 196, 232, 'REGISTER FILE');
    const P = dieP();
    D386_REGS.forEach((r, i) => {
      const y0 = 414 + i * 25.6;
      svgEl('rect', { x: 58, y: y0, width: 188, height: 24, rx: 4, fill: i % 2 ? P.row0 : P.row1, opacity: 0.9 }, b);
      const fl = this.flashRect(b, 58, y0, 188, 24, dvA(THEME.phosphor, 0.3));
      this.txt(b, r, 64, y0 + 17.5, 13.5, 'dv-m', 'start', { 'font-weight': 700 });
      const hi = this.txt(b, '0000', 198, y0 + 18, 15, 'dv-f', 'end', { 'font-weight': 600 });
      const lo = this.txt(b, '0000', 240, y0 + 18, 15, 'dv-v', 'end', { 'font-weight': 600 });
      this.els.regs[r] = { hi, lo, fl, y: y0 + 12, x: 250, w32: true };
    });
  }
  buildAlu386(g) {
    const b = this.block(g, 'alu', 258, 390, 204, 120, '');
    this.silk(b, 'ALU / BARREL SHIFTER', 266, 398, 10, 'dv-silk');
    svgEl('path', { d: 'M264 420H350L360 434L370 420H456L426 502H294Z', fill: dieP().aluFill, stroke: THEME.gold, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, b);
    this.txt(b, 'TMP A', 307, 431, 8.5, 'dv-m', 'middle');
    this.txt(b, 'TMP B', 413, 431, 8.5, 'dv-m', 'middle');
    const E = this.els;
    E.aluA = this.txt(b, '--------', 307, 450, 13, 'dv-v', 'middle', { 'font-weight': 600 });
    E.aluB = this.txt(b, '--------', 413, 450, 13, 'dv-v', 'middle', { 'font-weight': 600 });
    E.aluSym = this.txt(b, '', 360, 452, 15, 'dv-go', 'middle', { 'font-weight': 700 });
    E.aluOp = this.txt(b, '', 360, 472, 12, 'dv-go', 'middle', { 'font-weight': 700 });
    E.aluR = this.txt(b, '', 360, 493, 13.5, 'dv-ph', 'middle', { 'font-weight': 700 });
    E.aluFl = this.flashRect(b, 300, 479, 120, 20, dvA(THEME.phosphor, 0.22));
  }
  buildMulDiv(g) {
    const b = this.block(g, 'muldiv', 258, 518, 98, 58, '');
    this.silk(b, 'MUL / DIV', 266, 526, 10, 'dv-silk');
    this.els.mdText = this.txt(b, 'idle', 266, 559, 11, 'dv-f', 'start', { 'font-weight': 700 });
    this.els.mdSub = this.txt(b, '', 266, 571, 8.5, 'dv-f');
    this.els.mdFl = this.flashRect(b, 260, 520, 94, 54, dvA(THEME.gold, 0.25));
  }
  buildProt(g) {
    const b = this.block(g, 'prot', 362, 518, 100, 58, '');
    this.silk(b, 'PROTECTION', 370, 526, 10, 'dv-silk');
    const E = this.els;
    E.prCpl = this.txt(b, 'CPL 0', 370, 553, 11, 'dv-v', 'start', { 'font-weight': 600 });
    E.prMode = this.txt(b, 'REAL', 454, 553, 10, 'dv-lv', 'end', { 'font-weight': 700 });
    E.prSt = this.txt(b, 'OK', 370, 570, 11.5, 'dv-ph', 'start', { 'font-weight': 700 });
    E.prFl = this.flashRect(b, 364, 520, 96, 54, dvA(THEME.magenta, 0.3));
  }
  buildCtl(g) {
    const b = this.block(g, 'ctl', 258, 584, 204, 122, 'CONTROL / MICROCODE ROM');
    const E = this.els;
    svgEl('rect', { x: 266, y: 606, width: 188, height: 32, fill: 'url(#dv-rom)', stroke: dieP().cellStroke }, b);
    E.romRow = svgEl('rect', { x: 266, y: 606, width: 12, height: 32, fill: dvA(THEME.phosphor, 0.6), opacity: 0 }, b);
    E.crBits = D386_CR0.map(([n, bit], i) => {
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x: 266 + i * 31.6, y: 645, width: 29, height: 22, rx: 4 }, c);
      this.txt(c, n, 280.5 + i * 31.6, 660, 10.5, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, bit };
    });
    E.cr0Hex = this.txt(b, 'CR0 00000000', 266, 688, 10.5, 'dv-lv', 'start', { 'font-weight': 600 });
    E.cr2 = this.txt(b, 'CR2 00000000', 266, 701, 9, 'dv-f');
    E.intText = this.txt(b, '', 454, 700, 10, 'dv-f', 'end', { 'font-weight': 700 });
    E.crFl = this.flashRect(b, 262, 642, 196, 50, dvA(THEME.lavender, 0.25));
    E.intFl = this.flashRect(b, 330, 690, 128, 14, dvA(THEME.magenta, 0.25));
  }
  buildFlags386(g) {
    const b = this.block(g, 'flags', 54, 630, 196, 76, 'EFLAGS');
    D386_FLAGS.forEach(([n, bit], i) => {
      const row = i < 7 ? 0 : 1, col = row ? i - 7 : i;
      const x = (row ? 72 : 59) + col * 27, y = row ? 679 : 651, w = 25;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y, width: w, height: 25, rx: 3.5 }, c);
      this.txt(c, n, x + w / 2, y + 9, n.length > 2 ? 6.5 : 7.5, 'dv-m', 'middle', { 'font-weight': 600 });
      const v = this.txt(c, '0', x + w / 2, y + 22, 11.5, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      const fl = this.flashRect(c, x, y, w, 25, dvA(THEME.phosphor, 0.45));
      this.els.flags.push({ n, bit, c, v, fl });
    });
  }
  // ---- decode unit ----
  buildDec386(g) {
    const b = this.block(g, 'dec', 486, 390, 206, 132, 'INSTRUCTION DECODER');
    const E = this.els;
    E.decText = this.txt(b, '', 494, 428, 14, 'dv-ph', 'start', { 'font-weight': 700 });
    E.decBytes = this.txt(b, '', 494, 450, 11, 'dv-go', 'start', { 'font-weight': 600 });
    this.txt(b, 'EIP', 494, 472, 10.5, 'dv-m', 'start', { 'font-weight': 700 });
    const ip = this.txt(b, '00000000', 520, 472, 12, 'dv-ph', 'start', { 'font-weight': 700 });
    const ipFl = this.flashRect(b, 490, 459, 110, 18, dvA(THEME.phosphor, 0.2));
    this.els.regs.EIP = { lo: ip, fl: ipFl, y: 468, x: 486 };
    E.decBits = this.txt(b, '', 684, 472, 10, 'dv-lv', 'end', { 'font-weight': 700 });
    this.txt(b, 'CLK', 494, 495, 10, 'dv-m', 'start', { 'font-weight': 700 });
    E.clkDot = svgEl('circle', { cx: 525, cy: 491.5, r: 5, fill: dieP().dot }, b);
    E.clkText = this.txt(b, this.mhz(), 536, 495, 10, 'dv-f');
    E.decClk = this.txt(b, '', 684, 514, 11, 'dv-m', 'end', { 'font-weight': 700 });
    E.decAddr = this.txt(b, '', 494, 514, 9.5, 'dv-f');
    E.decFl = this.flashRect(b, 490, 412, 198, 22, dvA(THEME.phosphor, 0.14));
  }
  buildIq(g) {
    const b = this.block(g, 'iq', 486, 530, 206, 176, 'DECODED QUEUE');
    this.txt(b, '3 ▶ EU', 684, 544, 9, 'dv-f', 'end');
    this.els.iq = [0, 1, 2].map(i => {
      const r = svgEl('rect', { x: 494, y: 556 + i * 48, width: 190, height: 40, rx: 5, fill: THEME.panel, stroke: dieP().cellStroke, 'stroke-dasharray': '3 3' }, b);
      const t = this.txt(b, '', 502, 581 + i * 48, 11.5, 'dv-f', 'start', { 'font-weight': 600 });
      return { r, t };
    });
  }
  // ---- prefetch unit ----
  buildPfq(g) {
    const b = this.block(g, 'pfq', 716, 390, 190, 172, 'PREFETCH QUEUE');
    this.txt(b, '16 BYTES', 898, 403, 8.5, 'dv-f', 'end');
    for (let i = 0; i < 16; i++) {
      svgEl('rect', { x: this.qx(i) - this.QW / 2, y: this.qy(i), width: this.QW, height: this.QH, rx: 3, fill: 'none', stroke: dieP().cellStroke, 'stroke-dasharray': '3 3' }, b);
      this.txt(b, String(i), this.qx(i), this.qy(i) + this.QH + 9, 7.5, 'dv-f', 'middle');
    }
    this.txt(b, '◀ DEC', 724, 552, 10, 'dv-ph', 'start', { 'font-weight': 700 });
    this.els.qCount = this.txt(b, '0/16', 898, 552, 11, 'dv-m', 'end', { 'font-weight': 700 });
    this.chipLayer = svgEl('g', { 'pointer-events': 'none' }, b);
  }
  buildPfa(g) {
    const b = this.block(g, 'pfa', 716, 570, 190, 136, 'CODE ADDRESS');
    const E = this.els;
    const row = (y, lab, cls) => { this.txt(b, lab, 724, y, 10, 'dv-m'); return this.txt(b, '--------', 898, y, 12, cls, 'end', { 'font-weight': 600 }); };
    E.pfBase = row(602, 'CS base', 'dv-cy');
    E.pfLim = row(622, 'CS limit', 'dv-v');
    E.pfAddr = row(642, 'fetch', 'dv-go');
    E.pfLin = row(662, 'EIP linear', 'dv-ph');
    this.txt(b, 'stops at a page', 724, 684, 8.5, 'dv-f');
    this.txt(b, 'that is not in the TLB', 724, 697, 8.5, 'dv-f');
  }
  buildPads386(g) {
    const pg = this.block(g, 'pads', 0, 0, 0, 0, '');
    pg.querySelector('.dv-frame').setAttribute('display', 'none');
    D386_PADS.forEach((name, i) => {
      const p = Die386View.padPos386(i);
      const out = 9;
      const [bx, by] = p.side === 'l' ? [-out, p.y] : p.side === 'r' ? [DIE_W + out, p.y] : p.side === 't' ? [p.x, -out] : [p.x, DIE_H + out];
      svgEl('line', { x1: p.x, y1: p.y, x2: bx, y2: by, stroke: dieP().bond, 'stroke-width': 1.1, opacity: 0.55 }, pg);
      const cls = 'dv-pad' + (name === 'NC' ? ' dv-nc' : '');
      const c = svgEl('g', { class: cls }, pg);
      const w = p.v ? 22 : 31, h = p.v ? 24 : 22;
      svgEl('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 3 }, c);
      const size = name.length > 4 ? 6.8 : 7.8;
      const t = this.txt(c, name, p.x, p.y + size * 0.36, size, '', 'middle', p.v ? { transform: `rotate(-90 ${p.x} ${p.y})` } : null);
      t.removeAttribute('class');
      svgEl('title', null, c).textContent = name === 'NC' ? 'NC (not connected)' : name + (D386_LOW.has(name) ? '# (active low)' : '');
      this.els.pads.push({ c, name, p, base: cls });
    });
  }

  // ---------- 80387 ----------
  buildFpuTop(g, x0, top, qw) {
    const F = this.els.f87;
    const b = this.block(g, 'f87bi', x0, top, qw, 72, 'BUS INTERFACE', 'l');
    F.bi = ['PEREQ', 'BUSY', 'ERROR', 'NPS1', 'W/R', 'CMD0'].map((n, i) => {
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x: x0 + 8 + i * 56, y: top + 30, width: 52, height: 34, rx: 4 }, c);
      this.txt(c, n, x0 + 34 + i * 56, top + 43, 10, 'dv-m', 'middle', { 'font-weight': 600 });
      const t = this.txt(c, '0', x0 + 34 + i * 56, top + 60, 14, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { n, c, t };
    });
    F.biText = this.txt(b, 'I/O ports 8000F8h–FFh', x0 + qw - 8, top + 21, 11, 'dv-lv', 'end', { 'font-weight': 600 });
  }
  link87() {
    if (this.L.side === 'left') return { ERROR: ['l', 0], BUSY: ['l', 1], PEREQ: ['l', 2], NPS1: ['l', 3], 'W/R': ['l', 4], ADS: ['l', 5], CMD0: ['l', 6] };
    return { PEREQ: ['t', 10], BUSY: ['t', 11], ERROR: ['t', 12], NPS1: ['l', 0], 'W/R': ['l', 1], ADS: ['l', 2], CMD0: ['l', 3] };
  }
  buildLinks() {
    const g = this.gLinks, L = this.L, E = this.els;
    const [ax, ay] = L.p86, [bx, by] = L.p87, map = this.link87();
    const pad86 = n => { const p = Die386View.padPos386(D386_PADS.indexOf(n)); return { x: ax + p.x, y: ay + p.y, side: p.side }; };
    const pad87 = n => { const [s, i] = map[n]; const p = DieView.padPos87(s, i); return { x: bx + p.x, y: by + p.y, side: s }; };
    E.wires = {};
    const wire = (id, pts, color) => {
      E.wires[id] = svgEl('path', { d: 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'), class: 'dv-wire', stroke: color, color }, g);
    };
    const dieR = ax + DIE_W, dieB = ay + DIE_H;
    ['PEREQ', 'BUSY', 'ERROR'].forEach((n, j) => {
      const s = pad86(n), t = pad87(n), pts = [];
      const lane = dieR + 10 + j * 10;
      pts.push([dieR, s.y], [lane, s.y]);
      if (L.side === 'left') pts.push([lane, t.y], [bx, t.y]);
      else { const ly = dieB + 36 + j * 11; pts.push([lane, ly], [t.x, ly], [t.x, by]); }
      wire(n, pts, n === 'PEREQ' ? THEME.lavender : THEME.magenta);
    });
    // A23 + M/IO select -> NPS1; ADS, W/R and A2 (CMD0) go to the 80387 directly
    let box;
    if (L.side === 'left') { const a = pad87('NPS1'), c = pad87('CMD0'); box = [bx - 64, a.y - 22, 56, c.y - a.y + 44]; }
    else { const a = pad87('NPS1'), c = pad87('CMD0'); box = [bx - 150, a.y - 26, 128, c.y - a.y + 52]; }
    const blk = this.block(g, 'npdec', box[0], box[1], box[2], box[3], '');
    const cx = box[0] + box[2] / 2;
    this.txt(blk, 'A23', cx, box[1] + 20, 11, 'dv-v', 'middle', { 'font-weight': 700 });
    this.txt(blk, '+ M/IO', cx, box[1] + 36, 10, 'dv-m', 'middle');
    this.txt(blk, 'SELECT', cx, box[1] + 52, 9, 'dv-mg', 'middle', { 'font-weight': 700 });
    ['NPS1', 'W/R', 'ADS', 'CMD0'].forEach(n => {
      const t = pad87(n);
      wire(n, [[box[0] + box[2], t.y], [bx, t.y]], THEME.magenta);
    });
    this.txt(g, 'D15-D0 shared, I/O ports 8000F8h-FFh', bx + 8, by - 12, 11, 'dv-f');
    const hit = svgEl('g', { class: 'dv-blk', tabindex: 0, role: 'button', 'aria-label': DIE386_INFO.link[0] + ': ' + DIE386_INFO.link[1] }, g);
    const bb = L.side === 'left' ? [dieR + 2, ay + 40, 36, 140] : [dieR + 2, ay + 40, L.W - dieR - 4, 120];
    svgEl('rect', { x: bb[0], y: bb[1], width: bb[2], height: bb[3], fill: 'transparent' }, hit);
    hit.addEventListener('click', e => { e.stopPropagation(); this.select('link', hit); });
    hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select('link', hit); } });
    E.blocks.link = hit;
  }

  // ---------- tokens: the internal bus (y = 366) and the data unit bus (x = 254) ----------
  point(spec) {
    const R = this.els.regs;
    if (spec && typeof spec === 'object') {
      if (spec.tail !== undefined) { const s = clamp(spec.tail, 0, 15); return { pts: [[this.qx(s), this.qy(s)], [this.qx(s), 400], [704, 400], [704, D386_GY]], bus: 'g' }; }
      if (spec.bus) return spec.bus === 'eu' ? { pts: [[D386_EX, clamp(spec.y, 390, 700)]], bus: 'eu' } : { pts: [[clamp(spec.x || 505, 60, 900), D386_GY]], bus: 'g' };
    }
    if (D386_REGS.includes(spec)) return { pts: [[250, R[spec].y], [D386_EX, R[spec].y]], bus: 'eu' };
    if (D386_SREGS.includes(spec)) return { pts: [[376, R[spec].y], [388, R[spec].y], [388, D386_GY]], bus: 'g' };
    switch (spec) {
      case 'EIP': return { pts: [[486, 468], [474, 468], [474, D386_GY]], bus: 'g' };
      case 'aluA': return { pts: [[307, 420], [307, 414], [D386_EX, 414]], bus: 'eu' };
      case 'aluB': return { pts: [[413, 420], [413, 414], [D386_EX, 414]], bus: 'eu' };
      case 'aluOut': return { pts: [[360, 502], [360, 514], [D386_EX, 514]], bus: 'eu' };
      case 'muldiv': return { pts: [[258, 547], [D386_EX, 547]], bus: 'eu' };
      case 'prot': return { pts: [[412, 518], [412, 514], [D386_EX, 514]], bus: 'eu' };
      case 'cr': return { pts: [[258, 656], [D386_EX, 656]], bus: 'eu' };
      case 'qhead': return { pts: [[716, 436], [704, 436], [704, D386_GY]], bus: 'g' };
      case 'dec': return { pts: [[560, 390], [560, D386_GY]], bus: 'g' };
      case 'iq': return { pts: [[486, 600], [474, 600], [474, D386_GY]], bus: 'g' };
      case 'linadd': case 'sigma': return { pts: [[134, 300], [134, D386_GY]], bus: 'g' };
      case 'sys': return { pts: [[376, 327], [388, 327], [388, D386_GY]], bus: 'g' };
      case 'tlb': return { pts: [[400, 133], [388, 133], [388, D386_GY]], bus: 'g' };
      case 'walker': return { pts: [[644, 257], [656, 257], [656, D386_GY]], bus: 'g' };
      case 'pgadd': return { pts: [[644, 324], [656, 324], [656, D386_GY]], bus: 'g' };
      case 'addrdrv': case 'latch': return { pts: [[668, 157], [656, 157], [656, D386_GY]], bus: 'g' };
      case 'ring': case 'xcvr': return { pts: [[787, 346], [787, D386_GY]], bus: 'g' };
      default: return null;
    }
  }
  route(a, b) {
    // the address pipeline has its own short paths
    const fixed = {
      'linadd>tlb': [[134, 214], [134, 210], [388, 210], [388, 133], [400, 133]],
      'linadd>addrdrv': [[134, 214], [134, 210], [388, 210], [388, 40], [656, 40], [656, 157], [668, 157]],
      'tlb>walker': [[522, 210], [522, 218]],
      'walker>pgadd': [[522, 298], [522, 306]],
      'tlb>pgadd': [[640, 180], [648, 180], [648, 327], [644, 327]],
      'pgadd>addrdrv': [[644, 324], [656, 324], [656, 157], [668, 157]],
      'xcvr>walker': [[668, 316], [656, 316], [656, 257], [644, 257]],
      'walker>xcvr': [[644, 257], [656, 257], [656, 316], [668, 316]],
      'qhead>dec': [[716, 436], [692, 436]],
    };
    const key = (typeof a === 'string' ? a : '') + '>' + (typeof b === 'string' ? b : '');
    if (fixed[key]) return fixed[key].map(p => p.slice());
    const A = this.point(a), B = this.point(b);
    if (!A || !B) return null;
    let pts = A.pts.slice();
    if (A.bus !== B.bus) pts.push([D386_EX, D386_GY]);
    pts = pts.concat(B.pts.slice().reverse());
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
    return out;
  }

  // ---------- events ----------
  instr(events, info) {
    super.instr(events, info);
    const c = this.m.cpu;
    // bus cycles of the page walks: the directory and table entries (two word cycles each)
    this.walkSet = new Set();
    this.walks = events.filter(e => e.k === 'page');
    this.walkShown = new Set();
    for (const e of events) {
      if (e.k !== 'page') continue;
      const pdeA = ((c.cr[3] & 0xFFFFF000) + e.dir * 4) >>> 0;
      this.walkSet.add(pdeA & 0xFFFFFF); this.walkSet.add((pdeA + 2) & 0xFFFFFF);
      if (e.pde & 1) {
        const pteA = ((e.pde & 0xFFFFF000) + e.tbl * 4) >>> 0;
        this.walkSet.add(pteA & 0xFFFFFF); this.walkSet.add((pteA + 2) & 0xFFFFFF);
      }
    }
    // a jump: the first fetch at the new CS:EIP (physical, word aligned) starts the new stream
    this.flushAt = null;
    if (events.some(e => e.k === 'queue' && e.op === 'flush')) {
      const tgt = this.peekLin(c.linearIP);
      const pop = events.find(e => e.k === 'queue' && e.op === 'pop');
      this.flushAt = tgt < 0 ? null : events.find(e => e.k === 'fetch' && ((e.addr ^ tgt) & 0xFFFFFE) === 0 && (!pop || e.t >= pop.t)) || null;
    }
  }
  event(e, clockMs) {
    switch (e.k) {
      case 'page': this.cmsSet(e, clockMs); this.onPage(e, this.anim(e.t)); this.sfxTick(1.7); return;
      case 'tlb': this.cmsSet(e, clockMs); this.onTlb(e, this.anim(e.t)); return;
      case 'reg':
        if (e.r === 'EIP' || /^CR/.test(e.r)) { this.cmsSet(e, clockMs); this.onSysReg(e, this.anim(e.t)); return; }
        break;
      default: break;
    }
    super.event(e, clockMs);
  }
  onSysReg(e, a) {
    this.mdl.regs[e.r] = e.v >>> 0;
    if (e.r === 'EIP') { this.renderReg('EIP', 1); this.flash('reg:EIP', a, 3, 400); return; }
    const s = this.mdl.sys;
    if (s) {
      if (e.r === 'CR0') { s.cr0 = e.v >>> 0; s.msw = e.v & 0xFFFF; s.pe = !!(e.v & 1); s.pg = !!(e.v & 0x80000000) && s.pe; }
      else if (e.r === 'CR2') s.cr2 = e.v >>> 0;
      else if (e.r === 'CR3') s.cr3 = e.v >>> 0;
    }
    this.renderSys();
    if (e.r === 'CR3') {
      this.flash('walk', a, 8, 1200);
      this.renderPage();
      this.renderTlb();
      this.token(e.t, [{ bus: 'eu', y: 656 }, 'walker'], 'CR3 ' + dvHex8(e.v), THEME.lavender, 0, 2.6, 460);
    } else {
      this.flash('cr', a, 8, 1200);
      if (e.r === 'CR0') { this.renderPage(); this.renderTlb(); }
      this.token(e.t, [{ bus: 'eu', y: 470 }, 'cr'], e.r + ' ' + dvHex8(e.v), THEME.lavender, 0, 2.2, 420);
    }
    this.sfxTick(1.5);
  }
  // A page walk: the linear address splits into DIR, TABLE, OFFSET; the TLB misses; the walker
  // reads the PDE and the PTE; the page adder makes the physical address.
  // The walk starts (the first table read, or the page event): the TLB misses in its set and
  // the walker splits the linear address. pde / pte show when their bus cycles come.
  showWalk(e, a, upto) {
    const set = (e.lin >>> 12) & 7;
    const first = !this.walkShown || !this.walkShown.has(e);
    if (this.walkShown) this.walkShown.add(e);
    this.mdl.pg = { lin: e.lin >>> 0, phys: e.phys >>> 0, dir: e.dir, tbl: e.tbl, pde: upto >= 1 ? e.pde >>> 0 : null, pte: upto >= 2 ? e.pte >>> 0 : null,
      fault: upto >= 3 && !!e.fault, err: e.err, hit: false, set, way: -1, done: upto >= 3 };
    this.renderPage();
    if (!first) return;
    const E = this.els;
    this.setA(E.tlbSetFl, 'y', String(90 + set * 14.6));
    this.setA(E.tlbSetFl, 'fill', dvA(THEME.magenta, 0.3));
    this.flash('tlbset', a, 3, 500);
    this.flash('walk', a, 8, 1200);
    this.token(e.t, ['tlb', 'walker'], 'MISS', THEME.magenta, 0, 1.6, 260);
    this.sfxTick(1.7);
  }
  onPage(e, a) {
    const c = this.m.cpu, page = (e.lin & 0xFFFFF000) >>> 0, set = (e.lin >>> 12) & 7;
    this.showWalk(e, a, 3);
    const i = c.tlb ? c.tlb.findIndex(x => x.valid && x.lin === page) : -1;
    this.mdl.pg.way = i >= 0 ? i & 3 : -1;
    if (i >= 0 && !e.fault) this.flashAt('tlbway', a, 0, 6, 900, i & 3, set);
    if (!e.fault) this.flashAt('pgadd', a, 1, 4, 600);
    this.renderTlb();
    if (!e.fault) {
      this.token(e.t, ['walker', 'pgadd'], hex(e.phys >>> 12, 5), THEME.lavender, 0, 1.2, 240);
      this.token(e.t, ['pgadd', 'addrdrv'], dvHex8(e.phys), THEME.cyan, 1.2, 1.6, 260);
    }
  }
  // The page walk that a table read (physical address pa) belongs to, and which read it is.
  walkOf(pa) {
    const c = this.m.cpu;
    for (const w of this.walks || []) {
      const pdeA = ((c.cr[3] & 0xFFFFF000) + w.dir * 4) & 0xFFFFFF, pteA = ((w.pde & 0xFFFFF000) + w.tbl * 4) & 0xFFFFFF;
      if (pa === pdeA || pa === pdeA + 2) return { w, n: 1 };
      if ((w.pde & 1) && (pa === pteA || pa === pteA + 2)) return { w, n: 2 };
    }
    return null;
  }
  onTlb(e, a) {
    const c = this.m.cpu, set = (e.lin >>> 12) & 7, page = (e.lin & 0xFFFFF000) >>> 0;
    const i = c.tlb ? c.tlb.findIndex(x => x.valid && x.lin === page) : -1;
    const old = this.mdl.pg;
    this.mdl.pg = { lin: e.lin >>> 0, phys: e.phys >>> 0, dir: e.lin >>> 22, tbl: (e.lin >>> 12) & 0x3FF, pde: old && old.dir === e.lin >>> 22 ? old.pde : null, pte: null, fault: false, hit: true, set, way: i >= 0 ? i & 3 : -1 };
    const E = this.els;
    this.setA(E.tlbSetFl, 'y', String(90 + set * 14.6));
    this.setA(E.tlbSetFl, 'fill', dvA(THEME.phosphor, 0.2));
    this.flash('tlbset', a, 2, 380);
    if (i >= 0) this.flashAt('tlbway', a, 0, 3, 600, i & 3, set);
    this.flashAt('pgadd', a, 0.6, 3, 500);
    this.renderPage();
    this.token(e.t, ['tlb', 'pgadd'], hex(e.phys >>> 12, 5), THEME.phosphor, 0, 1.4, 240);
    this.sfxTick(1.9);
  }
  // A flash that starts d clocks after the event; tlbway moves to the cell first.
  flashAt(key, a, d, n, minMs, way, set) {
    if (!this.visible) return;
    if (key === 'tlbway') {
      this.setA(this.els.tlbWayFl, 'x', String(420 + way * 56));
      this.setA(this.els.tlbWayFl, 'y', String(90 + set * 14.6));
    }
    this.flashes.set(key, { serial: a.serial, tc: a.tc, start: a.start, cms: a.cms, d, n, minMs: this.reduced ? Math.max(minMs, 900) : minMs });
  }
  onEA(e, a) {
    const lin = e.lin !== undefined ? e.lin >>> 0 : null;
    const d = this.mdl.desc && this.mdl.desc[e.seg];
    const base = lin !== null ? (lin - (e.off >>> 0)) >>> 0 : d ? d.base : 0;
    this.mdl.sig = { seg: e.seg, base, off: e.off >>> 0, lin: lin !== null ? lin : (base + e.off) >>> 0, phys: e.phys >>> 0 };
    this.flash('sig', a, 3, 400);
    this.flash('lim', a, 3, 400);
    this.renderSigma();
    if (!(this.mdl.sys && this.mdl.sys.pg)) this.renderPage();
    const off = e.off > 0xFFFF ? dvHex8(e.off) : hex4(e.off);
    this.token(e.t, [{ bus: 'eu', y: 400 }, 'linadd'], off, THEME.gold, 0, 1.6, 240);
    const pg = this.mdl.sys && this.mdl.sys.pg;
    this.token(e.t, pg ? ['linadd', 'tlb'] : ['linadd', 'addrdrv'], dvHex8(this.mdl.sig.lin), THEME.cyan, 1.6, 1.6, 240);
  }
  onAlu(e, a) {
    this.mdl.alu = e;
    this.anims.alu = Object.assign(a, { n: 3, minMs: 450 });
    this.renderAlu();
    const f = this.aluFmt(e.w);
    const ops = this.ops || [], mn = ops[0] || '';
    const md = /^(mul|imul|div|idiv)$/.test(mn) && ops.length <= 2;
    if (md || /^(I?MUL|I?DIV)$/.test(e.op)) {
      this.mdl.md = e;
      this.flash('md', a, 6, 900);
      this.renderMulDiv();
    }
    const srcA = md ? (e.op.endsWith('DIV') ? null : 'EAX') : this.opSource(ops[1], e.a, e.w);
    const srcB = md ? this.opSource(ops[1], e.b, e.w) : this.opSource(ops[2], e.b, e.w);
    const to = md ? 'muldiv' : null;
    if (srcA) this.token(e.t, [srcA, to || 'aluA'], f(e.a), THEME.gold, 0, 1.6, 260);
    if (srcB) this.token(e.t, [srcB, to || 'aluB'], f(e.b), THEME.gold, 0.2, 1.6, 260);
  }
  aluFmt(w) { return w === 32 ? dvHex8 : w === 16 ? hex4 : hex2; }
  // Where an operand comes from: a register, memory (through the transceivers) or the queue.
  opSource(op, v, w) {
    if (!op) return null;
    const R = this.mdl.regs;
    const r = { eax: 'EAX', ax: 'EAX', al: 'EAX', ah: 'EAX', ebx: 'EBX', bx: 'EBX', bl: 'EBX', bh: 'EBX', ecx: 'ECX', cx: 'ECX', cl: 'ECX', ch: 'ECX',
      edx: 'EDX', dx: 'EDX', dl: 'EDX', dh: 'EDX', esi: 'ESI', si: 'ESI', edi: 'EDI', di: 'EDI', ebp: 'EBP', bp: 'EBP', esp: 'ESP', sp: 'ESP',
      es: 'ES', cs: 'CS', ss: 'SS', ds: 'DS', fs: 'FS', gs: 'GS' }[op];
    if (r) return r;
    if (op.includes('[')) return 'xcvr';
    if (/^(0x[0-9a-f]+|-?\d+)$/.test(op)) return 'qhead';
    const m = w === 32 ? 0xFFFFFFFF : w === 16 ? 0xFFFF : 0xFF;
    for (const n of D386_REGS) if (((R[n] & m) >>> 0) === (v >>> 0) && v) return n;
    return null;
  }
  readDest(e) {
    const r = this.opSource((this.ops || [])[1], -1, 32);
    if (r && r !== 'xcvr' && r !== 'qhead') return r;
    return { bus: 'eu', y: 470 };
  }
  writeSrc(e) {
    const ops = this.ops || [], mn = ops[0] || '';
    if (/^push/.test(mn) && ops[1]) { const r = this.opSource(ops[1], -1, 32); if (r && r !== 'xcvr' && r !== 'qhead') return r; }
    const r = this.opSource(ops[2], -1, 32);
    if (r && r !== 'xcvr' && r !== 'qhead') return r;
    const alu = this.mdl.alu;
    if (alu && this.anims.alu && this.anims.alu.serial === this.serial && ((alu.r & 0xFFFF) === e.data || (alu.r >>> 16 & 0xFFFF) === e.data)) return 'aluOut';
    if (/^(call|int)/.test(mn)) return 'EIP';
    return { bus: 'eu', y: 470 };
  }
  onReg(e, a) {
    const R = this.mdl.regs, old = R[e.r], v = e.v >>> 0;
    R[e.r] = v;
    if (D386_SREGS.includes(e.r)) {
      const loaded = (this.events || []).some(x => x.k === 'desc' && x.sreg === e.r);
      const s = this.mdl.sys;
      if (!loaded && !(s && s.pe && !s.vm)) {
        // real or V86 mode: the base is selector x 16 (the limit and the access byte stay)
        const d = this.mdl.desc[e.r] || { limit: 0xFFFF, access: 0x93, flags: 0 };
        this.mdl.desc[e.r] = Object.assign({}, d, { sel: v, base: v << 4, table: 'real' });
      } else if (this.mdl.desc[e.r]) this.mdl.desc[e.r].sel = v;
      this.renderDesc(e.r);
      this.renderReg(e.r, 1);
      this.flash('reg:' + e.r, a, 6, 900);
      return;
    }
    const diff = old === undefined ? 0xFFFFFFFF : (old ^ v) >>> 0;
    const half = (diff & 0xFFFF0000 ? 2 : 0) | (diff & 0xFFFF ? 1 : 0);
    this.renderReg(e.r, half);
    this.flash('reg:' + e.r, a, 6, 900);
    // the value comes from the ALU, from memory, or from another register
    let src = null;
    const evs = this.events || [];
    const alu = evs.filter(x => x.k === 'alu' && x.t <= e.t).pop();
    if (alu && ((alu.r >>> 0) === v || ((alu.r & 0xFFFF) === (v & 0xFFFF) && alu.w <= 16) || ((alu.r & 0xFF) === (v & 0xFF) && alu.w === 8))) src = alu.op && /^(I?MUL|I?DIV)$/.test(alu.op) ? 'muldiv' : 'aluOut';
    else if (evs.some(x => x.k === 'bus' && x.owner === 'cpu' && (x.type === 'memr' || x.type === 'ior') && (x.data === (v & 0xFFFF) || x.data === (v >>> 16) || x.data === (v & 0xFF)))) src = null;
    else {
      const s = this.opSource((this.ops || [])[2], -1, 32);
      if (s && s !== 'xcvr' && s !== e.r) src = s;
    }
    if (src) this.token(e.t, [src, e.r], dvHex8(v), THEME.phosphor, -1.2, 1.2, 240);
  }
  onDesc(e, a) {
    const c = this.m.cpu, i = D386_SREGS.indexOf(e.sreg), cache = c.cache && c.cache[i];
    this.mdl.desc[e.sreg] = { sel: e.sel, base: e.base >>> 0, limit: e.limit >>> 0, access: e.access, flags: cache && cache.sel === e.sel ? cache.flags || 0 : 0, table: e.table === 'v86' ? 'real' : e.table };
    this.mdl.regs[e.sreg] = e.sel;
    this.renderDesc(e.sreg);
    this.renderReg(e.sreg, 1);
    this.flash('desc:' + e.sreg, a, 8, 1200);
    if (e.table === 'GDT' || e.table === 'LDT') this.token(e.t, ['xcvr', e.sreg], dvHex8(e.base), THEME.lavender, 0, 3, 520);
  }
  onTask(e, a) {
    this.readMachine();
    this.renderSys();
    this.renderAll();
    this.flash('sys', a, 10, 1600);
    this.showOverlay(a, 'TASK SWITCH', `${e.tss || ''} TSS ${hex4(e.from)}  →  TSS ${hex4(e.to)}`.trim(), 'the processor saves the registers in the old TSS and loads the new one (and CR3)', THEME.lavender);
  }
  onExc(e) {
    const a = this.anim(e.t);
    const [nm, long] = D386_EXC[e.vec] || [e.name || '#' + hex2(e.vec), 'EXCEPTION'];
    const name = e.name || nm;
    const err = e.err !== undefined && e.err !== null ? `error code ${hex4(e.err)}` : 'no error code';
    this.mdl.exc = { name, vec: e.vec, err: e.err };
    this.flash('prot', a, 10, 1600);
    const cr2 = e.vec === 14 ? `  ·  CR2 ${dvHex8(this.m.cpu.cr[2])}` : '';
    this.showOverlay(a, `${name}  ${long}`, `vector ${hex2(e.vec)}h  ·  ${err}${cr2}`, this.dec ? `at ${hex4(this.dec.cs)}:${this.dec.ip > 0xFFFF ? dvHex8(this.dec.ip) : hex4(this.dec.ip)}  ${this.dec.text}` : '', THEME.magenta);
    this.renderSigma();
    this.renderProt();
  }
  onBus(e, a, type) {
    const len = e.len || 2;
    Object.assign(a, { n: len, minMs: 55 * len + 60, e, type });
    const evs = this.events || [], i = evs.indexOf(e);
    this.nextBus = i >= 0 ? evs.slice(i + 1).find(x => x.k === 'fetch' || x.k === 'bus') || null : null;
    const io = type === 'ior' || type === 'iow';
    const fpuIo = e.dev === 'fpu' || e.owner === 'fpu' || (io && (e.addr & 0xF8) === 0xF8 && (e.addr & 0xFF00) === 0);
    const walk = !!(this.walkSet && (type === 'memr' || type === 'memw') && this.walkSet.has(e.addr & 0xFFFFFF));
    a.req = type === 'code' ? 'code' : walk ? 'page' : 'data';
    this.anims.bus = a;
    this.mdl.bus = { e, type, req: a.req };
    if (fpuIo) { this.anims.pe = Object.assign(this.anim(e.t), { n: len, minMs: 300, e, type }); this.mdl.pei = { e, type }; }
    if (this.visible) { this.renderBusText(); this.renderPei(); }
    const hexd = e.width === 2 ? hex4(e.data) : hex2(e.data);
    if (type === 'code' && e === this.flushAt && !this.flushDone) this.doFlush(e.t);
    if (type === 'code') {
      const byt = e.width === 2 ? hex2(e.data) + ' ' + hex2(e.data >> 8) : hex2(e.data);
      const tk = this.token(e.t, ['xcvr', { tail: e.q.length - e.width }], byt, THEME.gold, 0.4, len * 0.8, 260);
      this.qOps.push({ kind: 'fetch', q: e.q.slice(), a: tk || Object.assign(this.anim(e.t), { d: 0.4, n: len * 0.8, minMs: 260 }) });
      this.setT(this.els.pfAddr, dvHex8(e.addr));
    } else if (walk) {
      const wk = this.walkOf(e.addr & 0xFFFFFF);
      if (wk) this.showWalk(wk.w, a, type === 'memr' ? wk.n : 2);
      this.flash('walk', a, 4, 500);
      this.token(e.t, type === 'memw' ? ['walker', 'xcvr'] : ['xcvr', 'walker'], hexd, THEME.lavender, 0.3, len, 260);
    } else if (fpuIo) {
      this.token(e.t, type === 'iow' ? [{ bus: 'eu', y: 470 }, 'xcvr'] : ['xcvr', { bus: 'eu', y: 470 }], hexd, THEME.lavender, 0.3, len, 260);
    } else if (type === 'memr' || type === 'ior') {
      this.token(e.t, ['xcvr', this.readDest(e)], hexd, THEME.gold, 0.6, len, 260);
    } else if (type === 'memw' || type === 'iow') {
      this.token(e.t, [this.writeSrc(e), 'xcvr'], hexd, THEME.gold, 0, len, 260);
    }
  }
  flashEl(key) {
    const E = this.els;
    const m = { tlbset: E.tlbSetFl, tlbway: E.tlbWayFl, walk: E.walkFl, pgadd: E.pgFl, lim: E.lcFl, cr: E.crFl, md: E.mdFl };
    if (key in m) return m[key] || null;
    return super.flashEl(key);
  }
  fast(stats) {
    DieView.prototype.fast.call(this, stats);
    const h = this.heatT, b = stats.bus || {}, c = this.m.cpu;
    const lg = v => clamp(Math.log10(1 + (v || 0)) / 4.2, 0, 1);
    const pg = c.paging ? (h.sigma || 0) * 0.8 : 0;
    Object.assign(h, { pfq: h.queue, pfa: (h.queue || 0) * 0.6, prio: h.busctl, addrdrv: h.busctl, xcvr: h.busctl, linadd: h.sigma, limchk: (h.sigma || 0) * 0.6,
      desc: (h.sigma || 0) * 0.5, sysr: 0, tlb: pg, walker: c.paging ? lg((c.tlbStats.misses - (this.lastMiss || 0)) * 30) : 0, pgadd: pg,
      iq: h.dec, ctl: h.rom, muldiv: (h.alu || 0) * 0.3, prot: (h.rom || 0) * 0.4, f87bi: lg((b.fpu || 0) * 10) });
    this.lastMiss = c.tlbStats ? c.tlbStats.misses : 0;
    if (this.anims.bus && this.anims.bus.e && this.anims.bus.serial === -1) this.anims.bus.n = this.anims.bus.e.len || 2;
    this.iqTexts = this.peekNext(3);
    if (this.visible && animNow() - (this.lastTlbDraw || 0) > 120) { this.lastTlbDraw = animNow(); this.renderTlb(); }
  }

  // ---------- per frame ----------
  stepPads(now) {
    const st = {}, set = (n, c) => { st[n] = c; };
    const cur = this.curBus(now);
    const f = this.m.fpu;
    let fpuIo = false, T = -1;
    if (cur) {
      const e = cur.e, type = cur.type;
      T = cur.T;
      fpuIo = !!(this.anims.pe && this.anims.pe.e === e);
      const io = type === 'ior' || type === 'iow', write = type === 'memw' || type === 'iow';
      const addr = type === 'inta' ? 4 : type === 'halt' ? 2 : e.addr;
      const A = 'a';
      for (let b = 1; b < 24; b++) set('A' + b, A + ((addr >> b) & 1));
      if (write || T === cur.len - 1) {
        const wd = e.width === 2 ? e.data : ((e.addr & 1) ? e.data << 8 : e.data);
        for (let b = 0; b < 16; b++) {
          if (type === 'halt' || (type === 'inta' && b >= 8)) continue;
          set('D' + b, (fpuIo ? 'f' : 'd') + ((wd >> b) & 1));
        }
      }
      if (e.width === 2 || (e.addr & 1)) set('BHE', 'c1');
      if (e.width === 2 || !(e.addr & 1)) set('BLE', 'c1');
      const s = D386_STATUS[type] || [1, 1, 1];
      set('M/IO', 'c' + s[0]); set('D/C', 'c' + s[1]); set('W/R', 'c' + s[2]);
      if (T === 0) set('ADS', 'c1');
      if (T === cur.len - 1) set('READY', 'g1');
      if (type === 'inta') { set('LOCK', 'c1'); set('INTR', 'c1'); }
    }
    const it = this.anims.intr;
    if (it) {
      const p = this.prog(it, now);
      if (p >= 0 && p < 1) { if (it.e.src === 'irq') set('INTR', 'c1'); if (it.e.src === 'nmi') set('NMI', 'c1'); }
    }
    if (this.dec && /^lock/.test(this.dec.text) && this.anims.dec && this.prog(this.anims.dec, now) < 1) set('LOCK', 'c1');
    const busy = !!(f && f.busyCycles > 0), ferr = !!(f && f.intRequest);
    if (busy) set('BUSY', 'f1');
    if (ferr) set('ERROR', 'c1');
    const pe = this.anims.pe, pep = pe ? this.prog(pe, now) : 2;
    if (pep >= 0 && pep < 1) set('PEREQ', 'f1');
    if (this.resetAt && now - this.resetAt < 900) set('RESET', 'c1');
    const playing = this.anims.dec && this.prog(this.anims.dec, now) < 1;
    if (playing && this.cms >= 12 && (this.vclock % 1) < 0.5) set('CLK2', 'g1');
    for (const pd of this.els.pads) {
      const cls = st[pd.name];
      this.setC(pd.c, pd.base + (cls ? ' dv-' + cls : ''));
    }
    const ringCol = !cur ? dieP().scribe : fpuIo ? THEME.lavender : T === 0 ? THEME.cyan : THEME.gold;
    this.setA(this.els.ring, 'stroke', ringCol);
    this.setA(this.els.ring, 'opacity', cur ? '0.9' : '0.55');
    this.setA(this.els.addrBus, 'opacity', cur && T === 0 ? '1' : '0.7');
    // BIU lamps
    const E = this.els, P = dieP();
    const req = cur ? cur.a.req : null;
    for (const l of E.prioL) this.setA(l.c, 'fill', req === l.k ? (l.k === 'code' ? THEME.gold : l.k === 'page' ? THEME.lavender : THEME.cyan) : P.dot);
    this.setA(E.beL[0], 'fill', st.BHE ? THEME.magenta : P.dot);
    this.setA(E.beL[1], 'fill', st.BLE ? THEME.magenta : P.dot);
    this.setA(E.adsL, 'fill', st.ADS ? THEME.magenta : P.dot);
    // the 80387 link
    const F = E.f87, W = E.wires || {};
    const peio = pep >= 0 && pep < 1 ? pe : null;
    const port = peio ? peio.e.addr : 0;
    const sig = {
      PEREQ: st.PEREQ === 'f1', BUSY: busy, ERROR: ferr, NPS1: !!peio, 'W/R': !!(peio && peio.type === 'iow'),
      ADS: !!(peio && cur && cur.e === peio.e && T === 0), CMD0: !!(peio && (port & 4)),
    };
    for (const n in sig) {
      if (W[n]) this.setC(W[n], 'dv-wire' + (sig[n] ? ' dv-on' : ''));
      if (F.pads && F.pads[n]) this.setC(F.pads[n].c, 'dv-pad' + (sig[n] ? (n === 'ERROR' ? ' dv-c1' : ' dv-f1') : ''));
    }
    if (F.bi) for (const x of F.bi) { this.setT(x.t, sig[x.n] ? '1' : '0'); this.setC(x.c, 'dv-cell dv-l' + (sig[x.n] ? ' dv-on' : '')); }
    this.setT(F.bsy.t, busy ? '1' : '0');
    this.setC(F.bsy.c, 'dv-cell dv-l' + (busy ? ' dv-on' : ''));
  }
  stepBusCtl(now) {
    const E = this.els, cur = this.curBus(now);
    for (let i = 0; i < 2; i++) this.setC(E.bcT[i], 'dv-tstate' + (cur && Math.min(1, cur.T) === i ? ' dv-on' : ''));
    const type = cur ? cur.type : null;
    const fpuIo = !!(cur && this.anims.pe && this.anims.pe.e === cur.e);
    const name = !cur ? 'IDLE  Ti' : (fpuIo ? '387 ' : '') + (type === 'halt' ? 'HALT/SHUTDOWN' : DIE_CYCLE[type] || type);
    this.setT(E.bcType, name);
    this.setA(E.bcType, 'class', !cur ? 'dv-m' : fpuIo ? 'dv-lv' : /io|inta|halt/.test(type) ? 'dv-mg' : 'dv-go');
    const s = cur ? D386_STATUS[type] || [1, 1, 1] : null;
    E.bcBits.forEach((t, j) => this.setT(t, s ? String(s[j]) : '·'));
    this.setT(E.bcPipe, cur && cur.len > 2 ? `${cur.len - 2} wait state${cur.len > 3 ? 's' : ''}` : 'NA off');
  }
  stepMisc(now) {
    const E = this.els, dec = this.anims.dec;
    const fastOn = this.lastFast && now - this.lastFast < 160;
    let pos = -1;
    if (dec && this.dec && dec.serial === this.serial) {
      const p = this.prog(dec, now);
      if (p >= 0 && p < 1) pos = (((this.dec.bytes[0] || 0) * 13 + Math.floor(p * this.cycles / 2) * 7) * 2654435761 >>> 0) % 15;
    }
    if (fastOn) pos = Math.floor(now / 70) % 15;
    this.setA(E.romRow, 'x', String(266 + Math.max(0, pos) * (176 / 14)));
    this.setA(E.romRow, 'opacity', pos < 0 ? '0' : fastOn ? '0.4' : '0.9');
    const playing = dec && this.prog(dec, now) < 1 && !fastOn;
    const c = playing ? Math.min(this.cycles, Math.max(0, Math.floor(this.vclock))) : 0;
    this.setT(E.decClk, playing ? `clock ${c} / ${this.cycles}` : '');
    this.setA(E.clkDot, 'fill', playing && (this.vclock % 1) < 0.5 ? THEME.phosphor : fastOn ? THEME.gold : dieP().dot);
    this.setT(E.clkText, fastOn ? 'free running' : playing ? `${this.cms >= 1 ? Math.round(this.cms) : this.cms.toFixed(1)} ms/clock` : this.mhz());
  }

  // ---------- renders ----------
  renderAll() {
    if (!this.els || !this.els.desc) return;
    for (const r of D386_REGS) this.renderReg(r, 0);
    for (const n of D386_SREGS) { this.renderReg(n, 0); this.renderDesc(n); }
    this.renderReg('EIP', 0);
    this.renderFlags(); this.renderAlu(); this.renderSigma(); this.renderDec(); this.renderIntr(); this.renderFpu(); this.renderBusText();
    this.renderSys(); this.renderIq(); this.renderPei(); this.renderPage(); this.renderTlb(); this.renderMulDiv(); this.renderPfa();
    if (this.chips.map(c => c.byte).join() !== this.mdl.q.join()) this.rebuildChips();
    this.setT(this.els.qCount, this.mdl.q.length + '/' + this.QN);
  }
  renderReg(r, half) {
    const el = this.els.regs[r], v = this.mdl.regs[r] || 0;
    if (!el) return;
    if (el.w32) {
      this.setT(el.hi, hex4(v >>> 16)); this.setT(el.lo, hex4(v));
      this.setA(el.hi, 'class', half & 2 ? 'dv-ph' : v >>> 16 ? 'dv-m' : 'dv-f');
      this.setA(el.lo, 'class', half & 1 ? 'dv-ph' : 'dv-v');
    } else if (r === 'EIP') {
      this.setT(el.lo, dvHex8(v));
    } else {
      this.setT(el.lo, hex4(v));
      this.setA(el.lo, 'class', half ? 'dv-ph' : 'dv-v');
    }
  }
  renderDesc(n) {
    const el = this.els.desc && this.els.desc[n], d = this.mdl.desc && this.mdl.desc[n];
    if (!el || !d) return;
    this.setT(el.sel, hex4(d.sel));
    this.setT(el.base, dvHex8(d.base));
    this.setT(el.limit, dvHex8(d.limit));
    this.setT(el.ar, hex2(d.access));
    const G = (d.flags >> 3) & 1, D = (d.flags >> 2) & 1;
    this.setT(el.gb, String(G)); this.setA(el.gb, 'class', G ? 'dv-go' : 'dv-f');
    this.setT(el.db, String(D)); this.setA(el.db, 'class', D ? 'dv-go' : 'dv-f');
    const acc = d.access, code = (acc & 0x18) === 0x18, dpl = (acc >> 5) & 3;
    let type;
    if (d.table === 'real') type = this.mdl.sys && this.mdl.sys.vm ? 'v86' : 'real';
    else if (!(acc & 0x80)) type = d.sel & 0xFFFC ? 'absent' : 'null';
    else if (!(acc & 0x10)) type = 'system';
    else type = (code ? 'code' + (acc & 2 ? 'R' : '') : 'data' + (acc & 2 ? 'W' : '')) + ' ' + dpl;
    this.setT(el.type, type);
  }
  renderSys() {
    const E = this.els, s = this.mdl.sys;
    if (!E.crBits || !s) return;
    const cr0 = s.cr0 >>> 0;
    E.crBits.forEach(x => this.setC(x.c, 'dv-cell dv-l' + ((cr0 >>> x.bit) & 1 ? ' dv-on' : '')));
    this.setT(E.cr0Hex, 'CR0 ' + dvHex8(cr0));
    this.setT(E.cr2, 'CR2 ' + dvHex8(s.cr2));
    this.setT(E.cr3, 'CR3 ' + dvHex8(s.cr3));
    const tb = r => (r ? `${dvHex8(r.base)} ${hex4(r.limit)}` : '-------- ----');
    this.setT(E.gdtr, 'GDTR ' + tb(s.gdtr));
    this.setT(E.idtr, 'IDTR ' + tb(s.idtr));
    this.setT(E.ldtr, 'LDTR ' + (s.ldtr ? `${hex4(s.ldtr.sel)} ${dvHex8(s.ldtr.base)}` : '----'));
    this.setT(E.trr, 'TR ' + (s.tr ? `${hex4(s.tr.sel)} ${dvHex8(s.tr.base)}` : '----'));
    this.renderProt();
  }
  renderProt() {
    const E = this.els, s = this.mdl.sys;
    if (!E.prCpl || !s) return;
    this.setT(E.prCpl, 'CPL ' + s.cpl);
    this.setT(E.prMode, s.vm ? 'V86' : s.pe ? 'PROT' : 'REAL');
    this.setA(E.prMode, 'class', s.vm ? 'dv-mg' : s.pe ? 'dv-lv' : 'dv-m');
    const ex = this.mdl.exc && this.ovl ? this.mdl.exc : null;
    this.setT(E.prSt, ex ? `${ex.name} ${ex.err !== undefined && ex.err !== null ? hex4(ex.err) : ''}` : 'OK');
    this.setA(E.prSt, 'class', ex ? 'dv-mg' : 'dv-ph');
  }
  renderSigma() {
    const E = this.els, s = this.mdl.sig;
    if (!E.laLin || !s) return;
    const d = this.mdl.desc && this.mdl.desc[s.seg];
    const base = s.base !== undefined ? s.base >>> 0 : d ? d.base : 0;
    const lin = s.lin !== undefined ? s.lin >>> 0 : (base + (s.off >>> 0)) >>> 0;
    const lim = d ? d.limit >>> 0 : 0xFFFF;
    this.setT(E.laSeg, (s.seg || 'CS') + ' base');
    this.setT(E.laBase, dvHex8(base));
    this.setT(E.laOff, dvHex8(s.off));
    this.setT(E.laLin, dvHex8(lin));
    this.setT(E.lcLim, `${s.seg || 'CS'} limit ${dvHex8(lim)}`);
    const acc = d ? d.access : 0x93, code = (acc & 0x18) === 0x18;
    this.setT(E.lcAttr, d && d.table === 'real' ? 'real mode' : `${code ? 'code' + (acc & 2 ? ' R' : '') : 'data' + (acc & 2 ? ' W' : ' R')} · DPL ${(acc >> 5) & 3}`);
    const ex = this.mdl.exc && this.ovl ? this.mdl.exc : null;
    if (ex && ex.vec !== 14) {
      this.setT(E.lcChk, `${ex.name} ${ex.err !== undefined && ex.err !== null ? hex4(ex.err) : ''}`);
      this.setA(E.lcChk, 'class', 'dv-mg');
      this.setT(E.lcSt, 'FAULT');
      this.setA(E.lcSt, 'class', 'dv-mg');
    } else {
      const ok = (s.off >>> 0) <= lim;
      this.setT(E.lcChk, `offset ≤ limit ${ok ? '✓' : '✗'}`);
      this.setA(E.lcChk, 'class', ok ? 'dv-ph' : 'dv-mg');
      this.setT(E.lcSt, ok ? 'OK' : 'LIMIT');
      this.setA(E.lcSt, 'class', ok ? 'dv-ph' : 'dv-mg');
    }
  }
  // The page walker and the page adder: the last page event, else the last linear address.
  renderPage() {
    const E = this.els;
    if (!E.wDir) return;
    const s = this.mdl.sys || {}, g = this.mdl.pg;
    if (!s.pg) {
      const sg = this.mdl.sig;
      this.setT(E.wDir, '---'); this.setT(E.wTbl, '---'); this.setT(E.wOfs, '---');
      this.setT(E.wPde, 'PDE --------'); this.setT(E.wPte, 'PTE --------');
      this.setT(E.wSt, 'OFF'); this.setA(E.wSt, 'class', 'dv-f');
      this.setT(E.pgFrame, 'paging off: no change');
      this.setT(E.pgPhys, sg ? dvHex8(sg.lin !== undefined ? sg.lin : sg.phys) : '--------');
      return;
    }
    if (!g) {
      this.setT(E.wSt, 'ON'); this.setA(E.wSt, 'class', 'dv-lv');
      this.setT(E.pgFrame, 'paging on');
      this.setT(E.pgPhys, '--------');
      return;
    }
    this.setT(E.wDir, hex(g.dir, 3));
    this.setT(E.wTbl, hex(g.tbl, 3));
    this.setT(E.wOfs, hex(g.lin & 0xFFF, 3));
    this.setT(E.wPde, 'PDE ' + (g.pde === null || g.pde === undefined ? '--------' : dvHex8(g.pde)));
    this.setT(E.wPte, 'PTE ' + (g.hit || g.pte === null || g.pte === undefined || (g.fault && !(g.pde & 1)) ? '--------' : dvHex8(g.pte)));
    this.setT(E.wSt, g.fault ? '#PF' : g.hit ? 'HIT' : g.done ? 'NEW' : 'WALK');
    this.setA(E.wSt, 'class', g.fault ? 'dv-mg' : g.hit ? 'dv-ph' : 'dv-lv');
    if (!g.hit && !g.done) {
      this.setT(E.pgFrame, 'wait for the PTE');
      this.setT(E.pgPhys, '--------');
    } else if (g.fault) {
      this.setT(E.pgFrame, `not present · error ${hex2(g.err || 0)}`);
      this.setT(E.pgPhys, '--------');
    } else {
      this.setT(E.pgFrame, `frame ${hex(g.phys >>> 12, 5)} + ${hex(g.lin & 0xFFF, 3)}`);
      this.setT(E.pgPhys, dvHex8(g.phys));
    }
  }
  renderTlb() {
    const E = this.els, c = this.m.cpu;
    if (!E.tlb || !c.tlb) return;
    const P = dieP(), on = !!c.paging;
    for (let i = 0; i < 32; i++) {
      const x = c.tlb[i], el = E.tlb[i];
      const key = on && x.valid ? `${x.lin}|${x.phys}|${x.flags}` : '';
      if (key === el.key) continue;
      el.key = key;
      if (!key) {
        this.setT(el.t, '·'); this.setA(el.t, 'class', 'dv-f');
        this.setA(el.r, 'fill', P.row0); this.setA(el.r, 'stroke', P.cellStroke);
      } else {
        this.setT(el.t, hex(x.lin >>> 12, 5));
        this.setA(el.t, 'class', x.flags & 0x40 ? 'dv-go' : 'dv-v');
        this.setA(el.r, 'fill', P.cellOnL); this.setA(el.r, 'stroke', THEME.lavender);
      }
    }
    const st = c.tlbStats || { hits: 0, misses: 0 };
    this.setT(E.tlbStat, on ? `hit ${st.hits.toLocaleString('en-US')} · miss ${st.misses.toLocaleString('en-US')}` : 'paging off');
  }
  renderMulDiv() {
    const E = this.els, x = this.mdl.md;
    if (!E.mdText) return;
    this.setT(E.mdText, x ? `${x.op} ${x.w}` : 'idle');
    this.setA(E.mdText, 'class', x ? 'dv-go' : 'dv-f');
    this.setT(E.mdSub, x ? `${x.w} steps` : '');
  }
  renderPfa() {
    const E = this.els, c = this.m.cpu;
    if (!E.pfBase || !c.cache) return;
    const cs = c.cache[1];
    this.setT(E.pfBase, dvHex8(cs.base));
    this.setT(E.pfLim, dvHex8(cs.limit));
    this.setT(E.pfLin, dvHex8(c.linearIP));
  }
  renderAlu() {
    const E = this.els, a = this.mdl.alu;
    if (!E.aluA) return;
    if (!a) { this.setT(E.aluA, '--------'); this.setT(E.aluB, '--------'); this.setT(E.aluOp, ''); this.setT(E.aluSym, ''); this.setT(E.aluR, ''); return; }
    const f = this.aluFmt(a.w);
    this.setT(E.aluA, f(a.a)); this.setT(E.aluB, f(a.b));
    this.setT(E.aluOp, a.op + ' ' + (a.w || 16));
    this.setT(E.aluSym, DIE_OPSYM[a.op] || '');
    this.setT(E.aluR, '= ' + (a.r > 0xFFFFFFFF ? hex(Math.floor(a.r / 0x100000000), 8) + dvHex8(a.r) : f(a.r)));
    const b = this.els.blocks.alu;
    if (b) b.setAttribute('aria-label', `ALU: ${a.op} ${f(a.a)}, ${f(a.b)} = ${f(a.r)}. ` + DIE386_INFO.alu[1]);
  }
  renderDec() {
    const E = this.els, d = this.mdl.dec;
    if (!d) { this.setT(E.decText, ''); this.setT(E.decBytes, ''); this.setT(E.decAddr, ''); this.setT(E.decBits, ''); return; }
    const t = d.text.length > 22 ? d.text.slice(0, 21) + '…' : d.text;
    this.setT(E.decText, t);
    const by = (d.bytes || []).slice(0, 8).map(hex2).join(' ') + ((d.bytes || []).length > 8 ? ' …' : '');
    this.setT(E.decBytes, by);
    this.setT(E.decAddr, hex4(d.cs) + ':' + (d.ip > 0xFFFF ? dvHex8(d.ip) : hex4(d.ip)));
    this.setT(E.decBits, d.bits === 32 ? 'USE32' : 'USE16');
    this.renderPfa();
  }
  renderBusText() {
    const b = this.mdl.bus, E = this.els;
    if (!E.laA || !b) return;
    const e = b.e, io = b.type === 'ior' || b.type === 'iow';
    this.setT(E.laA, b.type === 'inta' ? 'A vector' : io ? 'port ' + hex4(e.addr) : 'A ' + dvHex6(e.addr));
    this.setT(E.laNext, b.req === 'page' ? 'A23–A1 · page table read' : b.req === 'code' ? 'A23–A1 · code fetch' : 'A23–A1');
    this.setT(E.xcD, 'D ' + (e.width === 2 ? hex4(e.data) : hex2(e.data)));
    this.setT(E.xcDir, (/w/.test(b.type) ? 'write' : 'read') + (e.dev ? ' · ' + e.dev : '') + (e.width === 2 ? ' · word' : ' · byte'));
  }
  renderPei() {
    const F = this.els.f87, x = this.mdl.pei;
    if (!F || !F.biText || !x) return;
    const e = x.e, d = e.width === 2 ? hex4(e.data) : hex2(e.data);
    this.setT(F.biText, `${x.type === 'iow' ? 'write' : 'read'} port ${hex2(e.addr)}h ${x.type === 'iow' ? '←' : '→'} ${d}`);
  }
}

// ======================================================================================
// 80486 die (app.model '80486'): one chip with the 386 units, the 8 KB cache and the
// floating-point unit. Top row: cache unit, bus interface unit (burst control and write
// buffers), paging unit, segmentation unit. Bottom row: prefetcher (32-byte queue),
// decoder (D1, D2), control unit, integer unit (registers, ALU, barrel shifter), FPU.
// A band at the bottom shows the 5-stage pipeline (PF D1 D2 EX WB) from the 'pipe'
// events. The machine has a 16-bit data bus (the board gives BS16#), so a line fill is
// 8 word cycles in the burst order of the 486. A tall view gets a portrait floor plan:
// the same units in 3 rows (see D486_ARR).
// ======================================================================================

// Two floor plans. 'L' (landscape): the units in two rows and the pipeline band. 'P'
// (portrait, for tall views): three rows, the pipeline at the lower right. The blocks keep
// the coordinates of 'L'; in 'P' each unit moves by its offset. gaps: the y of the internal
// buses between the rows; spine: the x of the bus that joins the gaps.
const D486_ARR = {
  L: { W: 1464, H: 838, pads: [40, 22, 40, 22], gaps: [366], spine: null, alt: {},
    off: { cacheU: [0, 0], biuU: [0, 0], pgU: [0, 0], sgU: [0, 0], pfU: [0, 0], decU: [0, 0], ctlU: [0, 0], intU: [0, 0], fpuU: [0, 0] },
    row: { cacheU: 0, biuU: 0, pgU: 0, sgU: 0, pfU: 1, decU: 1, ctlU: 1, intU: 1, fpuU: 1 },
    pipe: { x: 46, y: 730, w: 1368, h: 62, vertical: false } },
  P: { W: 1150, H: 1138, pads: [31, 31, 31, 31], gaps: [366, 736], spine: 1094, alt: { sgU: true },
    off: { cacheU: [0, 0], biuU: [0, 0], pgU: [0, 0], sgU: [-1028, 334], pfU: [350, 0], decU: [350, 0], ctlU: [350, 0], intU: [-692, 370], fpuU: [-692, 370] },
    row: { cacheU: 0, biuU: 0, pgU: 0, sgU: 1, pfU: 1, decU: 1, ctlU: 1, intU: 2, fpuU: 2 },
    pipe: { x: 734, y: 750, w: 370, h: 342, vertical: true } },
};
// the 386 blocks that this die uses again (drawn in groups moved by these offsets)
const D486_PGX = 410, D486_SGX = 1028, D486_RGX = 688;
const D486_FLAGS = [['ID', 21], ['AC', 18], ['VM', 17], ['RF', 16], ['NT', 14], ['IOPL', 12], ['OF', 11], ['DF', 10],
  ['IF', 9], ['TF', 8], ['SF', 7], ['ZF', 6], ['AF', 4], ['PF', 2], ['CF', 0]];
const D486_CR0 = [['PE', 0], ['MP', 1], ['EM', 2], ['TS', 3], ['ET', 4], ['NE', 5], ['WP', 16], ['AM', 18], ['NW', 29], ['CD', 30], ['PG', 31]];
const D486_EXC = Object.assign({}, D386_EXC, { 9: ['#09', 'RESERVED'], 16: ['#MF', 'FPU ERROR'], 17: ['#AC', 'ALIGNMENT CHECK'] });
// 124 pads clockwise from the top left: 40 on the top and the bottom, 22 on each side.
const D486_PADS = [
  'VCC', 'CLK', 'RESET', 'VSS', 'ADS', 'BLAST', 'BRDY', 'RDY', 'KEN', 'BS16', 'BS8', 'VCC', 'VSS', 'M/IO', 'D/C', 'W/R',
  'LOCK', 'PLOCK', 'VSS', 'PCD', 'PWT', 'HOLD', 'HLDA', 'BOFF', 'AHOLD', 'EADS', 'FLUSH', 'VCC', 'VSS', 'A20M', 'INTR', 'NMI',
  'FERR', 'IGNNE', 'VSS', 'VCC', 'BE0', 'BE1', 'BE2', 'BE3',
  'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A23',
  'A24', 'A25', 'A26', 'A27', 'A28', 'A29', 'A30', 'A31', 'VCC', 'VSS', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11',
  'D12', 'D13', 'D14', 'D15', 'VCC', 'VSS', 'D16', 'D17', 'D18', 'D19', 'D20', 'D21', 'D22', 'D23', 'DP0', 'DP1', 'PCHK', 'VSS',
  'D24', 'D25', 'D26', 'D27', 'D28', 'D29', 'D30', 'D31', 'DP2', 'DP3', 'VCC', 'VSS', 'NC', 'NC', 'VCC', 'VSS', 'NC', 'NC', 'VCC', 'VSS', 'NC', 'VSS',
];
const D486_LOW = new Set(['ADS', 'BLAST', 'BRDY', 'RDY', 'KEN', 'BS16', 'BS8', 'LOCK', 'PLOCK', 'BOFF', 'AHOLD', 'EADS', 'FLUSH', 'A20M', 'FERR', 'IGNNE',
  'BE0', 'BE1', 'BE2', 'BE3', 'PCHK']);
// the pads that this board does not use: the upper half of the data bus and its parity
const D486_UNUSED = new Set(['D16', 'D17', 'D18', 'D19', 'D20', 'D21', 'D22', 'D23', 'D24', 'D25', 'D26', 'D27', 'D28', 'D29', 'D30', 'D31', 'DP0', 'DP1', 'DP2', 'DP3', 'PCHK', 'BS8']);
const DIE486_INFO = {
  cache: ['On-chip cache, 8 KB', 'One cache for code and data: 128 sets of 4 ways, 16 bytes in each line. Bits 4 to 10 of the physical address select the set. Each small square is one line; a bright square holds a valid line. The outline shows the set of the last access. A read hit gives the data with no bus cycle.'],
  ctag: ['Tag compare and LRU', 'The address splits into the tag (bits 31 to 11), the set (bits 10 to 4) and the offset (bits 3 to 0). The four tags of the set are compared at the same time: a match with a valid line is a hit. Three LRU bits (B0 B1 B2) of each set select the way that the next fill replaces.'],
  lfill: ['Line fill', 'A read miss fills a line: 16 bytes in a burst. The 486 moves the dword that the CPU needs first, then the other three (the 2-1-1-1 timing: 2 clocks for the first transfer, then 1 clock each). This board has a 16-bit bus, so each dword takes two word transfers.'],
  cstat: ['Cache counters', 'Read hits, misses and line fills since the reset, and the hit rate. CR0.CD = 1 stops the fills; CR0.NW = 1 stops the write-through. After reset both bits are 1, so the BIOS must turn the cache on.'],
  addr4: ['Address driver', 'Drives A31 to A2 and the byte enables BE3# to BE0#. BE3# to BE0# select the bytes of the dword. The board gives BS16#, so the 486 makes 16-bit cycles on D15 to D0.'],
  burst: ['Burst control', 'ADS# starts a bus cycle. For a cacheable read the board answers KEN#, and the 486 fills a line in a burst: BRDY# ends each transfer and BLAST# marks the last one. A cycle that is not a burst ends with RDY#.'],
  wbuf: ['Write buffers', 'The cache is write-through: each write goes to memory. Four write buffers keep the writes, so the execution unit does not wait for the bus.'],
  xcvr: ['Data transceivers', 'D15 to D0 move 16 bits in each bus cycle on this board. A dword needs two cycles. The upper data pads D31 to D16 are not used.'],
  pfq: ['Prefetcher: 32-byte queue', 'The prefetcher reads 16 bytes at a time from the cache into the 32-byte queue. A cache hit needs no bus cycle. A miss fills the cache line first. A jump flushes the queue.'],
  pfa: ['Prefetch address', 'The CS base and limit that the prefetcher uses, the last code line that came from the bus, and the linear address of EIP.'],
  dec: ['Instruction decoder: D1 and D2', 'Two decode stages. D1 finds the prefixes, the opcode and the length of the instruction. D2 finds the operands and calculates the effective address. With the pipeline, a simple instruction needs 1 clock.'],
  ctl: ['Control unit and microcode ROM', 'Most simple instructions do not need microcode steps: hard-wired logic controls them. CR0 holds PE, MP, EM, TS, ET (always 1), NE (FPU errors as #MF), WP (write protect for the supervisor), AM (alignment mask), NW (no write-through), CD (cache disable) and PG (paging).'],
  prot: ['Protection and alignment', 'Checks the privilege rules: CPL, DPL and RPL. With CR0.AM = 1 and EFLAGS.AC = 1 at CPL 3, an access that is not aligned to its size gives #AC (vector 17).'],
  regs: ['Register file', 'The eight 32-bit general registers. The low 16 bits are AX to DI of the 8086; the dim digits are bits 31 to 16.'],
  flags: ['EFLAGS', 'The flags of the 80386 plus AC (bit 18, alignment check) and ID (bit 21). A program can change ID only on a CPU that has the CPUID instruction.'],
  alu: ['ALU', 'The 32-bit arithmetic and logic unit. Most register operations take 1 clock.'],
  barrel: ['Barrel shifter', 'Moves a value by any count in one clock: shifts, rotates, SHLD, SHRD and the bit instructions. The cells show the bits of the operand.'],
  muldiv: ['Multiply and divide', 'MUL and IMUL take 13 to 42 clocks, DIV and IDIV 16 to 43 clocks on the 486.'],
  fstk: ['FPU register stack', 'The floating-point unit is on the chip: no coprocessor and no I/O cycles. Eight 80-bit registers make a stack. TOP selects the register that is ST(0). The colour bar shows the tag: valid, zero, special or empty.'],
  fexp: ['FPU exponent datapath', 'The exponent of ST(0): 15 bits with a bias of 16383, and the sign bit.'],
  fman: ['FPU mantissa datapath', 'The 64-bit significand of ST(0), with the explicit integer bit. The FPU adds, multiplies and divides the significands here.'],
  pipe: ['5-stage pipeline', 'PF prefetch, D1 decode 1, D2 decode 2, EX execute, WB write back. Each stage holds one instruction, so up to five instructions are in the chip at the same time. The texts move one stage to the right for each instruction.'],
  pads: ['Pads (168 pins in the package)', 'A31-A2, BE3#-BE0#, D31-D0 with parity, ADS#, BRDY#, RDY#, BLAST#, KEN#, BS16#, BS8#, M/IO#, D/C#, W/R#, LOCK#, the cache control pins (FLUSH#, EADS#, AHOLD, PCD, PWT), FERR# and IGNNE# of the FPU, INTR, NMI, RESET and CLK. This board uses D15-D0 and BS16#; the dim pads are not used.'],
};
const DIE486_3D = {
  cache: ['cpu', 'CACHE 8 KB'], ctag: ['cpu', 'CACHE 8 KB'], lfill: ['cpu', 'CACHE 8 KB'], cstat: ['cpu', 'CACHE 8 KB'],
  addr4: ['cpu', 'BUS INTERFACE'], burst: ['cpu', 'BUS INTERFACE'], wbuf: ['cpu', 'BUS INTERFACE'], xcvr: ['cpu', 'BUS INTERFACE'],
  pfq: ['cpu', 'PREFETCHER'], pfa: ['cpu', 'PREFETCHER'], dec: ['cpu', 'INSTRUCTION DECODER'], pipe: ['cpu', 'INSTRUCTION DECODER'],
  ctl: ['cpu', 'CONTROL ROM'], prot: ['cpu', 'LIMIT CHECK'], regs: ['cpu', 'REGISTERS'], flags: ['cpu', 'ALU'], alu: ['cpu', 'ALU'],
  muldiv: ['cpu', 'ALU'], barrel: ['cpu', 'BARREL SHIFTER'], fstk: ['cpu', 'REGISTER STACK'], fexp: ['cpu', 'EXPONENT'], fman: ['cpu', 'MANTISSA'],
  desc: ['cpu', 'SEGMENT CACHES'], sysr: ['cpu', 'SEGMENT CACHES'], linadd: ['cpu', 'LINEAR ADDER'], limchk: ['cpu', 'LIMIT CHECK'],
  tlb: ['cpu', 'TLB'], walker: ['cpu', 'PAGE WALKER'], pgadd: ['cpu', 'PAGE ADDER'], pads: ['cpu', null],
};
// One die, no coprocessor. 'wide' has room for the legend at the right; 'row' has no legend;
// 'tall' uses the portrait floor plan.
const DIE486_LAYOUTS = {
  wide: { W: 2040, H: 878, p86: [20, 20], p87: [0, 0], side: 'left', up: false, legend: [1540, 330], keep: [[60, 60, 1384, 758]] },
  row: { W: 1504, H: 878, p86: [20, 20], p87: [0, 0], side: 'left', up: false, legend: null, keep: [[60, 60, 1384, 758]] },
  tall: { W: 1190, H: 1178, p86: [20, 20], p87: [0, 0], side: 'top', up: false, legend: null, keep: [[60, 60, 1070, 1058]] },
};
// Token end points: the unit, [x, y] on the block edge (the 'L' coordinates) and the x of the
// gutter bus next to it; then the same on the other side of the block, for a unit with alt.
const D486_PTS = {
  cache: ['cacheU', 508, 100, 522], ctag: ['cacheU', 508, 170, 522], lfill: ['cacheU', 508, 318, 522], cstat: ['cacheU', 508, 318, 522],
  addr4: ['biuU', 536, 90, 522], addrdrv: ['biuU', 536, 90, 522], latch: ['biuU', 536, 90, 522], burst: ['biuU', 536, 182, 522],
  wbuf: ['biuU', 782, 270, 796], xcvr: ['biuU', 536, 330, 522], ring: ['biuU', 536, 330, 522],
  tlb: ['pgU', 810, 133, 796], walker: ['pgU', 810, 257, 796], pgadd: ['pgU', 810, 327, 796],
  linadd: ['sgU', 1082, 257, 1068, 1404, 1418], sigma: ['sgU', 1082, 257, 1068, 1404, 1418], limchk: ['sgU', 1082, 257, 1068, 1404, 1418],
  sys: ['sgU', 1082, 328, 1068, 1404, 1418],
  pfq: ['pfU', 242, 430, 256], qhead: ['pfU', 242, 430, 256], pfa: ['pfU', 242, 650, 256], dec: ['decU', 270, 430, 256], iq: ['decU', 270, 430, 256],
  EIP: ['decU', 490, 608, 504], ctl: ['ctlU', 718, 500, 732], cr: ['ctlU', 718, 530, 732], prot: ['ctlU', 718, 670, 732], flags: ['intU', 938, 670, 944],
  aluA: ['intU', 958, 430, 944], aluB: ['intU', 958, 470, 944], aluOut: ['intU', 958, 520, 944], barrel: ['intU', 958, 596, 944], muldiv: ['intU', 958, 684, 944],
  fstk: ['fpuU', 1170, 440, 1156], fexp: ['fpuU', 1170, 618, 1156], fman: ['fpuU', 1170, 686, 1156],
};

class Die486View extends Die386View {
  constructor(host, app) {
    super(host, app);
    this.svg.setAttribute('aria-label', 'Die floor plan of the 80486 CPU: the integer unit, the cache and the FPU on one chip. The plus and minus keys zoom, the 0 key fits the die.');
  }
  info(id) { return DIE486_INFO[id] || DIE386_INFO[id] || DIE286_INFO[id] || DIE_INFO[id]; }
  map3D() { return DIE486_3D; }
  layoutSet() { return DIE486_LAYOUTS; }
  get fpuName() { return 'FPU'; }
  // the 32-byte queue: four rows of 8 chips
  get QN() { return 32; }
  get QX0() { return 72; }
  get QDX() { return 22.5; }
  get QY() { return 420; }
  get QH() { return 28; }
  get QW() { return 19; }
  get QF() { return 10; }
  qx(slot) { return this.QX0 + (slot % 8) * this.QDX; }
  qy(slot) { return this.QY + Math.floor(slot / 8) * 40; }
  qGone(c, age) {
    const u = easeOut(clamp(age, 0, 1)), y0 = this.qy(Math.min(31, c.slot || 0));
    c.y = c.state === 'dis' ? y0 + u * 16 : y0 - u * 16;
    c.op = 1 - age;
  }
  // A new byte comes into its slot from a short distance above (the rows are close).
  addChip(byte, slot, state) {
    const c = super.addChip(byte, slot, state);
    if (c && state === 'new' && !this.reduced) { c.y = this.qy(slot) - 10; this.placeChip(c); }
    return c;
  }
  legendSub() { return `Intel 80486DX: CPU, FPU and 8 KB cache, ${this.mhz()}, 16-bit bus`; }
  cacheObj() { const c = this.m.cpu; return c && c.cache486 ? c.cache486 : null; }

  // ---------- the 80486 die ----------
  static padPos486(i, A) {
    const M = 50, [nT, nR, nB, nL] = A.pads, W = A.W, H = A.H;
    if (i < nT) return { x: M + (i + 0.5) * (W - 2 * M) / nT, y: 19, v: false, side: 't' };
    i -= nT;
    if (i < nR) return { x: W - 19, y: M + (i + 0.5) * (H - 2 * M) / nR, v: true, side: 'r' };
    i -= nR;
    if (i < nB) return { x: W - M - (i + 0.5) * (W - 2 * M) / nB, y: H - 19, v: false, side: 'b' };
    i -= nB;
    return { x: 19, y: H - M - (i + 0.5) * (H - 2 * M) / nL, v: true, side: 'l' };
  }
  // A point of a unit in the die coordinates of this floor plan.
  upt(u, x, y) { const o = this.arr.off[u]; return [x + o[0], y + o[1]]; }
  build86(g) {
    const E = this.els, P = dieP();
    const A = this.arr = D486_ARR[this.kind === 'tall' ? 'P' : 'L'], W = A.W, H = A.H;
    this.g86 = g;
    E.desc = {};
    svgEl('rect', { x: -6, y: -6, width: W + 12, height: H + 12, rx: 10, fill: P.dieShadow, stroke: THEME.line }, g);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 4, fill: 'url(#dv-si)' }, g);
    const tex = DieView.texture(W, H, 80486);
    if (tex) svgEl('image', { href: tex, x: 0, y: 0, width: W, height: H, 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 4, fill: 'url(#dv-sheen)', 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 3.5, y: 3.5, width: W - 7, height: H - 7, rx: 3, fill: 'none', stroke: P.scribe, 'stroke-width': 1, opacity: 0.6 }, g);
    E.ring = svgEl('rect', { x: 38, y: 38, width: W - 76, height: H - 76, rx: 8, fill: 'none', stroke: P.scribe, 'stroke-width': 3, opacity: 0.55 }, g);
    // buses under the blocks: the internal buses between the rows, the spine that joins them,
    // the gutter buses between the units and a short stub for each end point
    const bus = (d, col, w, op) => svgEl('path', { d, class: 'dv-bus', stroke: col, 'stroke-width': w, opacity: op }, g);
    const xEnd = A.spine || W - 50;
    E.gBus = bus(A.gaps.map(y => `M50 ${y}H${xEnd}`).join('') + (A.spine ? `M${A.spine} ${A.gaps[0]}V${A.gaps[A.gaps.length - 1]}` : ''), P.busMain, 5, 0.55);
    const span = r => [r === 0 ? 50 : A.gaps[r - 1], r < A.gaps.length ? A.gaps[r] : A.pipe.vertical ? H - 50 : A.pipe.y - 12];
    const gut = new Map(), stubs = [];
    const specs = Object.keys(D486_PTS).concat(D386_REGS, D386_SREGS);
    for (const k of specs) {
      const p = this.point(k);
      if (!p) continue;
      gut.set(p.gx + '|' + p.row, [p.gx, p.row]);
      if (!/^(addrdrv|latch|ring|sigma|limchk|qhead|iq|cstat)$/.test(k)) stubs.push(`M${p.pts[0][0]} ${p.y}H${p.gx}`);
    }
    bus([...gut.values()].map(([x, r]) => { const [a, b] = span(r); return `M${x} ${a}V${b}`; }).join(''), P.busMain, 3, 0.5);
    bus(stubs.join(''), P.busMain, 1.8, 0.4);
    E.addrBus = bus(['addr4', 'pgadd', 'linadd'].map(k => { const p = this.point(k); return `M${p.gx} ${p.y}H${p.pts[0][0]}`; }).join(''), P.busA, 2.4, 0.7);
    this.txt(g, 'INTERNAL BUS 32', xEnd - 6, A.gaps[0] - 5, 10, 'dv-m', 'end');
    if (!A.spine) this.txt(g, 'CACHE BUS 128', 270, A.gaps[0] - 5, 10, 'dv-m', 'end');
    // the units: each one is a group that the floor plan moves
    const regPG = dvMix(THEME.magenta, THEME.void, 0.55), regC = dvMix(THEME.cyan, THEME.void, 0.45);
    const unit = u => svgEl('g', { transform: `translate(${A.off[u][0]} ${A.off[u][1]})` }, g);
    const region = (p, x, y, w, h, col, fill) => svgEl('rect', { x, y, width: w, height: h, rx: 2, fill, stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': '6 5', opacity: 0.85 }, p);
    const tab = (p, x, y, t, col) => {
      const w = strokeTextWidth(t, 9, 1.4) + 14;
      svgEl('rect', { x, y: y - 8, width: w, height: 16, rx: 3, fill: P.tabFill, stroke: col, 'stroke-width': 1.2 }, p);
      this.silk(p, t, x + 7, y - 4.5, 9, 'dv-silk');
    };
    const U = {};
    const UNITS = [
      ['cacheU', [46, 46, 470, 306], regC, dvA(THEME.cyan, 0.03), 'CACHE UNIT', 60, 46],
      ['biuU', [528, 46, 262, 306], P.regBU, dvA(THEME.gold, 0.025), 'BUS INTERFACE UNIT', 540, 46],
      ['pgU', [802, 46, 260, 306], regPG, dvA(THEME.magenta, 0.025), 'PAGING UNIT', 814, 46],
      ['sgU', [1074, 46, 338, 306], P.regAU, dvA(THEME.lavender, 0.03), 'SEGMENTATION UNIT', 1086, 46],
      ['pfU', [46, 380, 204, 342], P.regBIU, dvA(THEME.cyan, 0.025), 'PREFETCH', 58, 380],
      ['decU', [262, 380, 236, 342], P.regBIU, dvA(THEME.cyan, 0.03), 'DECODE UNIT', 274, 380],
      ['ctlU', [510, 380, 216, 342], P.regEU, dvA(THEME.phosphor, 0.02), 'CONTROL UNIT', 522, 380],
      ['intU', [738, 380, 412, 342], P.regEU, dvA(THEME.phosphor, 0.025), 'INTEGER UNIT', 750, 380],
      ['fpuU', [1162, 380, 252, 342], P.regAU, dvA(THEME.lavender, 0.035), 'FLOATING-POINT UNIT', 1174, 380],
    ];
    for (const [u, r, col, fill] of UNITS) { U[u] = unit(u); region(U[u], r[0], r[1], r[2], r[3], col, fill); }
    const pp = A.pipe;
    region(g, pp.x, pp.y, pp.w, pp.h, P.regBU, dvA(THEME.gold, 0.02));
    // blocks
    this.buildCache486(U.cacheU); this.buildTag486(U.cacheU); this.buildFill486(U.cacheU); this.buildCstat486(U.cacheU);
    this.buildAddr486(U.biuU); this.buildBurst486(U.biuU); this.buildWbuf486(U.biuU); this.buildXcvr486(U.biuU);
    const pgG = svgEl('g', { transform: `translate(${D486_PGX} 0)` }, U.pgU);
    this.buildTlb(pgG); this.buildWalker(pgG); this.buildPgAdd(pgG);
    const sgG = svgEl('g', { transform: `translate(${D486_SGX} 0)` }, U.sgU);
    this.buildDesc(sgG); this.buildLinAdd(sgG); this.buildLimChk(sgG); this.buildSys(sgG);
    this.buildPfq486(U.pfU); this.buildPfa486(U.pfU); this.buildDec486(U.decU); this.buildCtl486(U.ctlU); this.buildProt486(U.ctlU);
    const rgG = svgEl('g', { transform: `translate(${D486_RGX} 0)` }, U.intU);
    this.buildRegs386(rgG);
    this.buildFlags486(U.intU); this.buildAlu486(U.intU); this.buildBarrel486(U.intU); this.buildMulDiv486(U.intU);
    this.buildFpu486(U.fpuU); this.buildPipe486(g, pp);
    for (const [u, , col, , t, tx, ty] of UNITS) tab(U[u], tx, ty, t, col);
    this.buildPads486(g);
    this.buildOverlay486(g);
    this.tokLayer = svgEl('g', { class: 'dv-toks', 'pointer-events': 'none' }, g);
  }
  build87() { this.g87 = null; }
  buildLinks() { this.els.wires = {}; }
  buildPads486(g) {
    const pg = this.block(g, 'pads', 0, 0, 0, 0, '');
    pg.querySelector('.dv-frame').setAttribute('display', 'none');
    const A = this.arr;
    D486_PADS.forEach((name, i) => {
      const p = Die486View.padPos486(i, A);
      const out = 9;
      const [bx, by] = p.side === 'l' ? [-out, p.y] : p.side === 'r' ? [A.W + out, p.y] : p.side === 't' ? [p.x, -out] : [p.x, A.H + out];
      svgEl('line', { x1: p.x, y1: p.y, x2: bx, y2: by, stroke: dieP().bond, 'stroke-width': 1.1, opacity: 0.55 }, pg);
      const cls = 'dv-pad' + (name === 'NC' || D486_UNUSED.has(name) ? ' dv-nc' : '');
      const c = svgEl('g', { class: cls }, pg);
      const w = p.v ? 22 : 31, h = p.v ? 30 : 22;
      svgEl('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 3 }, c);
      const size = name.length > 4 ? 6.4 : name.length > 3 ? 7.2 : 7.8;
      const t = this.txt(c, name, p.x, p.y + size * 0.36, size, '', 'middle', p.v ? { transform: `rotate(-90 ${p.x} ${p.y})` } : null);
      t.removeAttribute('class');
      svgEl('title', null, c).textContent = name === 'NC' ? 'NC (not connected)' : name + (D486_LOW.has(name) ? '# (active low)' : '') + (D486_UNUSED.has(name) ? ': not used on this 16-bit board' : '');
      this.els.pads.push({ c, name, p, base: cls });
    });
  }
  buildOverlay486(g) {
    const E = this.els;
    this.ovlCx = this.arr.W / 2;
    const y0 = this.ovlY = Math.round(this.arr.H / 2) - 120;
    const o = E.ovl = svgEl('g', { 'pointer-events': 'none', display: 'none' }, g);
    E.ovlBox = svgEl('rect', { x: this.ovlCx - 390, y: y0, width: 780, height: 176, rx: 14, fill: dvA(THEME.void, 0.9), stroke: THEME.magenta, 'stroke-width': 3 }, o);
    E.ovlSilk = svgEl('path', { d: '', class: 'dv-silk-m' }, o);
    E.ovlText = this.txt(o, '', this.ovlCx, y0 + 128, 22, 'dv-v', 'middle', { 'font-weight': 700 });
    E.ovlSub = this.txt(o, '', this.ovlCx, y0 + 158, 15, 'dv-m', 'middle');
  }
  showOverlay(a, title, text, sub, color) {
    const E = this.els;
    if (!E.ovl) return;
    const size = 26, w = strokeTextWidth(title, size, 1.4);
    E.ovlSilk.setAttribute('d', strokeTextPath(title, this.ovlCx - w / 2, this.ovlY + 38, size, 1.4));
    E.ovlSilk.setAttribute('style', `stroke:${color}`);
    E.ovlBox.setAttribute('stroke', color);
    this.setT(E.ovlText, text);
    this.setT(E.ovlSub, sub.length > 76 ? sub.slice(0, 75) + '…' : sub);
    this.ovl = Object.assign(a, { n: 12, minMs: this.reduced ? 2600 : 2200 });
  }

  // ---- cache unit ----
  buildCache486(g) {
    const b = this.block(g, 'cache', 54, 56, 300, 224, 'CACHE 8 KB');
    const P = dieP(), E = this.els;
    this.txt(b, '128 SETS × 4 WAYS', 346, 70, 8, 'dv-f', 'end');
    const gx0 = 78, gy0 = 92, cw = 34.2, ch = 11.6;
    this.cGeo = { gx0, gy0, cw, ch };
    for (let col = 0; col < 8; col++) this.txt(b, '+' + col, gx0 + col * cw + 15.5, 88, 7, 'dv-f', 'middle');
    for (let row = 0; row < 16; row++) this.txt(b, hex2(row * 8), 74, gy0 + row * ch + 8.2, 7, 'dv-f', 'end');
    E.cl = [];
    const cells = svgEl('g', null, b);
    for (let s = 0; s < 128; s++) {
      const x0 = gx0 + (s & 7) * cw, y0 = gy0 + (s >> 3) * ch;
      for (let w = 0; w < 4; w++) {
        const r = svgEl('rect', { x: x0 + w * 7.9, y: y0, width: 7, height: 9.6, rx: 1.2, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.5 }, cells);
        E.cl.push({ r, key: '' });
      }
    }
    E.cSetMark = svgEl('rect', { x: gx0 - 2, y: gy0 - 1.5, width: 34.6, height: 12.6, rx: 2.5, fill: 'none', stroke: THEME.cyan, 'stroke-width': 1.2, opacity: 0, 'pointer-events': 'none' }, b);
    E.cSetFl = svgEl('rect', { x: gx0 - 2, y: gy0 - 1.5, width: 34.6, height: 12.6, rx: 2.5, fill: dvA(THEME.cyan, 0.25), stroke: THEME.cyan, 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }, b);
    E.cWayFl = svgEl('rect', { x: gx0 - 1, y: gy0 - 1, width: 9, height: 11.6, rx: 1.5, fill: dvA(THEME.phosphor, 0.5), stroke: THEME.phosphor, 'stroke-width': 1.6, opacity: 0, 'pointer-events': 'none' }, b);
  }
  // Move the set outline, the way cell and their flashes to a set and a way.
  placeCacheMarks(set, way) {
    const G = this.cGeo, E = this.els;
    if (!G || !E.cSetFl) return;
    const x0 = G.gx0 + (set & 7) * G.cw, y0 = G.gy0 + (set >> 3) * G.ch;
    for (const el of [E.cSetFl, E.cSetMark]) { this.setA(el, 'x', (x0 - 2).toFixed(1)); this.setA(el, 'y', (y0 - 1.5).toFixed(1)); }
    this.setA(E.cSetMark, 'opacity', '0.9');
    if (way >= 0) { this.setA(E.cWayFl, 'x', (x0 + way * 7.9 - 1).toFixed(1)); this.setA(E.cWayFl, 'y', (y0 - 1).toFixed(1)); }
  }
  buildTag486(g) {
    const b = this.block(g, 'ctag', 362, 56, 146, 224, 'TAG COMPARE');
    const E = this.els, P = dieP();
    E.ctAddr = this.txt(b, '--------', 370, 94, 13, 'dv-cy', 'start', { 'font-weight': 700 });
    const box = (x, w, lab, col) => {
      svgEl('rect', { x, y: 101, width: w, height: 26, rx: 3, fill: P.row1, stroke: col, 'stroke-width': 1 }, b);
      this.txt(b, lab, x + w / 2, 109, 6.5, 'dv-f', 'middle');
      return this.txt(b, '--', x + w / 2, 123, 10.5, 'dv-v', 'middle', { 'font-weight': 700 });
    };
    E.ctTag = box(368, 64, 'TAG 31–11', THEME.cyan);
    E.ctSet = box(435, 36, 'SET', THEME.magenta);
    E.ctOfs = box(474, 28, 'OFS', THEME.gold);
    E.ctWay = [0, 1, 2, 3].map(w => {
      const y0 = 134 + w * 18;
      const bg = svgEl('rect', { x: 366, y: y0, width: 138, height: 16, rx: 3, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      this.txt(b, 'W' + w, 371, y0 + 11.8, 9, 'dv-m', 'start', { 'font-weight': 700 });
      const t = this.txt(b, '------', 392, y0 + 12, 10.5, 'dv-f', 'start', { 'font-weight': 600 });
      const v = svgEl('circle', { cx: 458, cy: y0 + 8, r: 3.6, fill: P.dot }, b);
      const m = this.txt(b, '', 498, y0 + 12, 11, 'dv-f', 'end', { 'font-weight': 700 });
      return { bg, t, v, m };
    });
    this.txt(b, 'V', 458, 131, 6.5, 'dv-f', 'middle');
    E.ctRes = this.txt(b, 'no access yet', 370, 223, 11.5, 'dv-f', 'start', { 'font-weight': 700 });
    E.ctLru = this.txt(b, 'LRU  B0 ·  B1 ·  B2 ·', 370, 242, 9.5, 'dv-lv', 'start', { 'font-weight': 600 });
    E.ctVic = this.txt(b, '', 370, 257, 8.5, 'dv-f');
    E.ctNote = this.txt(b, '', 370, 271, 8.5, 'dv-f');
    E.ctFl = this.flashRect(b, 364, 80, 142, 198, dvA(THEME.cyan, 0.16));
  }
  buildFill486(g) {
    const b = this.block(g, 'lfill', 54, 288, 300, 60, '');
    const E = this.els, P = dieP();
    this.silk(b, 'LINE FILL', 63, 294, 10, 'dv-silk');
    E.lfNote = this.txt(b, 'burst 2-1-1-1', 346, 303, 8.5, 'dv-f', 'end');
    E.lfCells = [];
    for (let i = 0; i < 16; i++) {
      const x = 62 + i * 17.6 + (i >> 2) * 1.6;
      const r = svgEl('rect', { x, y: 310, width: 15.6, height: 20, rx: 2.5, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      const t = this.txt(b, '', x + 7.8, 324, 8.5, 'dv-f', 'middle', { 'font-weight': 600 });
      E.lfCells.push({ r, t });
    }
    E.lfOrd = [0, 1, 2, 3].map(d => this.txt(b, '', 62 + d * 72 + 34, 342, 7.5, 'dv-f', 'middle', { 'font-weight': 700 }));
    E.lfFl = this.flashRect(b, 56, 290, 296, 56, dvA(THEME.gold, 0.14));
  }
  buildCstat486(g) {
    const b = this.block(g, 'cstat', 362, 288, 146, 60, '');
    const E = this.els;
    E.csHit = this.txt(b, 'hits 0', 370, 304, 9.5, 'dv-m');
    E.csMiss = this.txt(b, 'misses 0', 370, 318, 9.5, 'dv-m');
    E.csFill = this.txt(b, 'fills 0', 370, 332, 9.5, 'dv-m');
    E.csRate = this.txt(b, '— %', 500, 312, 13, 'dv-ph', 'end', { 'font-weight': 700 });
    E.csMode = this.txt(b, '', 500, 343, 8.5, 'dv-f', 'end', { 'font-weight': 600 });
    E.csFl = this.flashRect(b, 364, 290, 142, 56, dvA(THEME.phosphor, 0.14));
  }
  // ---- bus interface unit ----
  buildAddr486(g) {
    const b = this.block(g, 'addr4', 536, 56, 246, 70, 'ADDRESS DRIVER');
    const E = this.els, P = dieP();
    E.laA = this.txt(b, 'A --------', 544, 101, 15, 'dv-cy', 'start', { 'font-weight': 700 });
    E.laNext = this.txt(b, 'A31–A2 · BE3–BE0', 544, 118, 8.5, 'dv-f');
    E.beL = [3, 2, 1, 0].map((n, i) => {
      const x = 684 + i * 19;
      const c = svgEl('circle', { cx: x, cy: 94, r: 4.8, fill: P.dot }, b);
      this.txt(b, 'BE' + n, x, 110, 6.5, 'dv-m', 'middle', { 'font-weight': 700 });
      return c;
    });
    E.bs16L = svgEl('circle', { cx: 766, cy: 94, r: 4.8, fill: P.dot }, b);
    this.txt(b, 'BS16', 766, 110, 6.5, 'dv-m', 'middle', { 'font-weight': 700 });
  }
  buildBurst486(g) {
    const b = this.block(g, 'burst', 536, 134, 246, 96, 'BURST CONTROL');
    const E = this.els, P = dieP();
    E.bcType = this.txt(b, 'IDLE', 544, 168, 11, 'dv-m', 'start', { 'font-weight': 700 });
    E.bcBits = ['M/IO', 'D/C', 'W/R'].map((n, i) => {
      const x = 710 + i * 26;
      this.txt(b, n, x, 158, 6.5, 'dv-m', 'middle');
      return this.txt(b, '·', x, 170, 11, 'dv-mg', 'middle', { 'font-weight': 700 });
    });
    E.bl = {};
    ['ADS', 'BLAST', 'BRDY', 'RDY', 'KEN'].forEach((n, i) => {
      const x = 548 + i * 47;
      E.bl[n] = svgEl('circle', { cx: x, cy: 184, r: 4.3, fill: P.dot }, b);
      this.txt(b, n, x + 8, 187.5, 8, 'dv-m', 'start', { 'font-weight': 700 });
    });
    E.beat = [];
    for (let i = 0; i < 8; i++) {
      const x = 544 + i * 23 + (i >> 1) * 0;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y: 196, width: 21, height: 15, rx: 3 }, c);
      this.txt(c, String(i + 1), x + 10.5, 207, 8.5, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      E.beat.push(c);
    }
    ['2', '1', '1', '1'].forEach((s, d) => this.txt(b, s + (d ? '' : ' clk'), 544 + d * 46 + 22, 222, 7, 'dv-f', 'middle'));
    E.bcT = ['T1', 'T2'].map((n, i) => {
      const c = svgEl('g', { class: 'dv-tstate' }, b);
      svgEl('rect', { x: 733 + i * 24, y: 196, width: 22, height: 15, rx: 3 }, c);
      this.txt(c, n, 744 + i * 24, 207, 8.5, 'dv-m', 'middle', { 'font-weight': 700 });
      return c;
    });
    E.buFl = this.flashRect(b, 538, 136, 242, 92, dvA(THEME.magenta, 0.12));
  }
  buildWbuf486(g) {
    const b = this.block(g, 'wbuf', 536, 238, 246, 64, 'WRITE BUFFERS');
    const E = this.els, P = dieP();
    this.txt(b, 'write-through', 774, 251, 8, 'dv-f', 'end');
    E.wb = [0, 1, 2, 3].map(i => {
      const x = 544 + i * 59;
      const r = svgEl('rect', { x, y: 262, width: 56, height: 33, rx: 3.5, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      const a = this.txt(b, '', x + 28, 275, 7.5, 'dv-cy', 'middle');
      const d = this.txt(b, '', x + 28, 289, 9.5, 'dv-go', 'middle', { 'font-weight': 700 });
      return { r, a, d };
    });
    E.wbFl = this.flashRect(b, 538, 240, 242, 60, dvA(THEME.goldHi, 0.12));
  }
  buildXcvr486(g) {
    const b = this.block(g, 'xcvr', 536, 310, 246, 40, '');
    const E = this.els;
    this.silk(b, 'TRANSCEIVERS', 545, 316, 10, 'dv-silk');
    E.xcD = this.txt(b, 'D ----', 544, 344, 13, 'dv-go', 'start', { 'font-weight': 700 });
    E.xcDir = this.txt(b, '', 774, 344, 8.5, 'dv-m', 'end');
    this.txt(b, 'D15–D0 · BS16', 774, 324, 7.5, 'dv-f', 'end');
  }
  // ---- prefetch and decode ----
  buildPfq486(g) {
    const b = this.block(g, 'pfq', 54, 390, 188, 210, 'PREFETCHER');
    const P = dieP();
    this.txt(b, '32 BYTES', 234, 403, 8, 'dv-f', 'end');
    for (let i = 0; i < 32; i++) {
      svgEl('rect', { x: this.qx(i) - this.QW / 2, y: this.qy(i), width: this.QW, height: this.QH, rx: 3, fill: 'none', stroke: P.cellStroke, 'stroke-dasharray': '3 3' }, b);
    }
    for (let r = 0; r < 4; r++) this.txt(b, String(r * 8), 60, this.qy(r * 8) + 18, 7, 'dv-f', 'start');
    this.txt(b, 'D1 ◀ head', 62, 590, 9, 'dv-ph', 'start', { 'font-weight': 700 });
    this.els.qCount = this.txt(b, '0/32', 234, 590, 10.5, 'dv-m', 'end', { 'font-weight': 700 });
    this.chipLayer = svgEl('g', { 'pointer-events': 'none' }, b);
  }
  buildPfa486(g) {
    const b = this.block(g, 'pfa', 54, 608, 188, 108, 'CODE ADDRESS');
    const E = this.els;
    const row = (y, lab, cls) => { this.txt(b, lab, 62, y, 9.5, 'dv-m'); return this.txt(b, '--------', 234, y, 11, cls, 'end', { 'font-weight': 600 }); };
    E.pfBase = row(640, 'CS base', 'dv-cy');
    E.pfLim = row(656, 'CS limit', 'dv-v');
    E.pfAddr = row(672, 'bus line', 'dv-go');
    E.pfLin = row(688, 'EIP linear', 'dv-ph');
    this.txt(b, '16 bytes from the cache', 62, 707, 8, 'dv-f');
  }
  buildDec486(g) {
    const b = this.block(g, 'dec', 270, 390, 220, 326, 'INSTRUCTION DECODER');
    const E = this.els, P = dieP();
    const stage = (y, name, sub) => {
      svgEl('rect', { x: 278, y, width: 204, height: 84, rx: 5, fill: P.row1, stroke: P.cellStroke, 'stroke-width': 0.9 }, b);
      this.txt(b, name, 286, y + 15, 11, 'dv-ph', 'start', { 'font-weight': 700 });
      this.txt(b, sub, 306, y + 15, 8.5, 'dv-f');
    };
    stage(414, 'D1', 'prefixes, opcode, length');
    E.d1Bytes = this.txt(b, '', 286, 452, 11.5, 'dv-go', 'start', { 'font-weight': 600 });
    E.decBytes = E.d1Bytes;
    E.d1Cls = this.txt(b, '', 286, 472, 9, 'dv-m');
    E.d1Len = this.txt(b, '', 474, 429, 8.5, 'dv-f', 'end');
    E.d1Fl = this.flashRect(b, 280, 416, 200, 80, dvA(THEME.phosphor, 0.14));
    stage(506, 'D2', 'operands, address');
    E.decText = this.txt(b, '', 286, 544, 12.5, 'dv-ph', 'start', { 'font-weight': 700 });
    E.d2Ea = this.txt(b, '', 286, 564, 9, 'dv-cy');
    E.d2Imm = this.txt(b, '', 286, 580, 9, 'dv-go');
    E.decFl = this.flashRect(b, 280, 508, 200, 80, dvA(THEME.phosphor, 0.14));
    this.txt(b, 'EIP', 286, 614, 10, 'dv-m', 'start', { 'font-weight': 700 });
    const ip = this.txt(b, '00000000', 312, 614, 11.5, 'dv-ph', 'start', { 'font-weight': 700 });
    const ipFl = this.flashRect(b, 282, 601, 110, 18, dvA(THEME.phosphor, 0.2));
    this.els.regs.EIP = { lo: ip, fl: ipFl, y: 610, x: 490 };
    E.decBits = this.txt(b, '', 482, 614, 9.5, 'dv-lv', 'end', { 'font-weight': 700 });
    this.txt(b, 'CLK', 286, 638, 10, 'dv-m', 'start', { 'font-weight': 700 });
    E.clkDot = svgEl('circle', { cx: 317, cy: 634.5, r: 4.6, fill: P.dot }, b);
    E.clkText = this.txt(b, this.mhz(), 328, 638, 9.5, 'dv-f');
    E.decAddr = this.txt(b, '', 286, 658, 9, 'dv-f');
    E.decClk = this.txt(b, '', 482, 658, 10.5, 'dv-m', 'end', { 'font-weight': 700 });
    this.txt(b, 'a simple instruction leaves', 286, 686, 8, 'dv-f');
    this.txt(b, 'the decoder in 1 clock (cache hit)', 286, 698, 8, 'dv-f');
  }
  // ---- control unit ----
  buildCtl486(g) {
    const b = this.block(g, 'ctl', 518, 390, 200, 232, 'CONTROL / MICROCODE ROM');
    const E = this.els;
    svgEl('rect', { x: 526, y: 414, width: 184, height: 56, fill: 'url(#dv-rom)', stroke: dieP().cellStroke }, b);
    E.romRow = svgEl('rect', { x: 526, y: 414, width: 12, height: 56, fill: dvA(THEME.phosphor, 0.6), opacity: 0 }, b);
    E.crBits = D486_CR0.map(([n, bit], i) => {
      const r = i < 6 ? 0 : 1, k = r ? i - 6 : i;
      const x = 526 + k * 30.8, y = 480 + r * 25;
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x, y, width: 28.5, height: 21, rx: 3.5 }, c);
      this.txt(c, n, x + 14.25, y + 14.5, 10, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, bit };
    });
    E.cr0Hex = this.txt(b, 'CR0 00000000', 526, 546, 10.5, 'dv-lv', 'start', { 'font-weight': 600 });
    E.cr2 = this.txt(b, 'CR2 00000000', 526, 562, 9, 'dv-f');
    E.ccMode = this.txt(b, '', 526, 580, 9, 'dv-m', 'start', { 'font-weight': 600 });
    E.intText = this.txt(b, '', 710, 612, 9.5, 'dv-f', 'end', { 'font-weight': 700 });
    E.crFl = this.flashRect(b, 522, 476, 192, 76, dvA(THEME.lavender, 0.25));
    E.intFl = this.flashRect(b, 590, 600, 124, 16, dvA(THEME.magenta, 0.25));
  }
  buildProt486(g) {
    const b = this.block(g, 'prot', 518, 630, 200, 86, 'PROTECTION');
    const E = this.els;
    E.prCpl = this.txt(b, 'CPL 0', 526, 664, 11, 'dv-v', 'start', { 'font-weight': 600 });
    E.prMode = this.txt(b, 'REAL', 710, 664, 10, 'dv-lv', 'end', { 'font-weight': 700 });
    E.prSt = this.txt(b, 'OK', 526, 684, 11.5, 'dv-ph', 'start', { 'font-weight': 700 });
    E.prAc = this.txt(b, '', 526, 704, 8.5, 'dv-f');
    E.prFl = this.flashRect(b, 520, 632, 196, 82, dvA(THEME.magenta, 0.3));
  }
  // ---- integer unit ----
  buildFlags486(g) {
    const b = this.block(g, 'flags', 742, 630, 196, 86, 'EFLAGS');
    D486_FLAGS.forEach(([n, bit], i) => {
      const row = i < 8 ? 0 : 1, col = row ? i - 8 : i;
      const x = (row ? 758 : 746) + col * 23.6, y = row ? 684 : 654, w = 22;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y, width: w, height: 25, rx: 3.5 }, c);
      this.txt(c, n, x + w / 2, y + 9, n.length > 2 ? 6 : 7.5, 'dv-m', 'middle', { 'font-weight': 600 });
      const v = this.txt(c, '0', x + w / 2, y + 22, 11, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      const fl = this.flashRect(c, x, y, w, 25, dvA(THEME.phosphor, 0.45));
      this.els.flags.push({ n, bit, c, v, fl });
    });
  }
  buildAlu486(g) {
    const b = this.block(g, 'alu', 958, 390, 184, 150, '');
    this.silk(b, 'ALU', 967, 398, 10, 'dv-silk');
    svgEl('path', { d: 'M964 420H1040L1050 434L1060 420H1136L1110 504H990Z', fill: dieP().aluFill, stroke: THEME.gold, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, b);
    this.txt(b, 'TMP A', 1002, 431, 8, 'dv-m', 'middle');
    this.txt(b, 'TMP B', 1098, 431, 8, 'dv-m', 'middle');
    const E = this.els;
    E.aluA = this.txt(b, '--------', 1002, 450, 11.5, 'dv-v', 'middle', { 'font-weight': 600 });
    E.aluB = this.txt(b, '--------', 1098, 450, 11.5, 'dv-v', 'middle', { 'font-weight': 600 });
    E.aluSym = this.txt(b, '', 1050, 453, 14, 'dv-go', 'middle', { 'font-weight': 700 });
    E.aluOp = this.txt(b, '', 1050, 472, 11, 'dv-go', 'middle', { 'font-weight': 700 });
    E.aluR = this.txt(b, '', 1050, 494, 12, 'dv-ph', 'middle', { 'font-weight': 700 });
    E.aluFl = this.flashRect(b, 994, 481, 112, 20, dvA(THEME.phosphor, 0.22));
    this.txt(b, '1 clock for most register', 966, 522, 8, 'dv-f');
    this.txt(b, 'operations', 966, 533, 8, 'dv-f');
  }
  buildBarrel486(g) {
    const b = this.block(g, 'barrel', 958, 548, 184, 96, '');
    const E = this.els, P = dieP();
    this.silk(b, 'BARREL SHIFTER', 967, 556, 10, 'dv-silk');
    E.brOp = this.txt(b, 'idle', 966, 584, 10.5, 'dv-f', 'start', { 'font-weight': 700 });
    E.brCnt = this.txt(b, '', 1134, 584, 10.5, 'dv-mg', 'end', { 'font-weight': 700 });
    E.brBits = [];
    for (let i = 0; i < 32; i++) E.brBits.push(svgEl('rect', { x: 966 + i * 5.3, y: 594, width: 4.5, height: 13, rx: 1, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.5 }, b));
    this.txt(b, '31', 966, 617, 6.5, 'dv-f');
    this.txt(b, '0', 1134, 617, 6.5, 'dv-f', 'end');
    E.brRes = this.txt(b, '', 1134, 634, 10.5, 'dv-ph', 'end', { 'font-weight': 700 });
    E.brIn = this.txt(b, '', 966, 634, 9, 'dv-v');
    E.brFl = this.flashRect(b, 960, 550, 180, 92, dvA(THEME.gold, 0.2));
  }
  buildMulDiv486(g) {
    const b = this.block(g, 'muldiv', 958, 652, 184, 64, '');
    this.silk(b, 'MULTIPLY / DIVIDE', 967, 660, 10, 'dv-silk');
    this.els.mdText = this.txt(b, 'idle', 966, 692, 11, 'dv-f', 'start', { 'font-weight': 700 });
    this.els.mdSub = this.txt(b, '', 966, 707, 8.5, 'dv-f');
    this.els.mdFl = this.flashRect(b, 960, 654, 180, 60, dvA(THEME.gold, 0.25));
  }
  // ---- floating-point unit ----
  buildFpu486(g) {
    const E = this.els, P = dieP();
    const b = this.block(g, 'fstk', 1170, 390, 240, 190, 'REGISTER STACK', 'l');
    E.fSw = this.txt(b, 'SW 0000 CW 0000', 1402, 403, 8, 'dv-f', 'end');
    E.fOp = this.txt(b, 'idle', 1178, 424, 10.5, 'dv-f', 'start', { 'font-weight': 700 });
    E.fTop = this.txt(b, 'TOP 0', 1402, 424, 9, 'dv-lv', 'end', { 'font-weight': 600 });
    E.fOpFl = this.flashRect(b, 1174, 410, 232, 19, dvA(THEME.lavender, 0.25));
    E.fRow = [];
    for (let i = 0; i < 8; i++) {
      const y0 = 432 + i * 18;
      const bg = svgEl('rect', { x: 1174, y: y0, width: 232, height: 16.4, rx: 3, fill: i % 2 ? P.row0 : P.row1 }, b);
      const st = this.txt(b, 'ST' + i, 1180, y0 + 12.3, 9.5, i ? 'dv-m' : 'dv-lv', 'start', { 'font-weight': 700 });
      const ph = this.txt(b, 'R' + i, 1206, y0 + 12.3, 8, 'dv-f');
      const tag = svgEl('rect', { x: 1226, y: y0 + 3, width: 3.5, height: 10.4, rx: 1, fill: THEME.faint }, b);
      const v = this.txt(b, 'empty', 1402, y0 + 12.5, 10.5, 'dv-f', 'end', { 'font-weight': 600 });
      const fl = this.flashRect(b, 1174, y0, 232, 16.4, dvA(THEME.lavender, 0.4));
      E.fRow.push({ bg, st, ph, tag, v, fl });
    }
    const e = this.block(g, 'fexp', 1170, 588, 240, 60, '', 'l');
    this.silk(e, 'EXPONENT', 1179, 596, 10, 'dv-silk-l');
    E.feSign = this.txt(e, 'sign ·', 1178, 632, 10.5, 'dv-m', 'start', { 'font-weight': 600 });
    E.feVal = this.txt(e, '----', 1402, 628, 14, 'dv-cy', 'end', { 'font-weight': 700 });
    E.feSub = this.txt(e, '15 bits, bias 16383', 1402, 642, 8, 'dv-f', 'end');
    E.feFl = this.flashRect(e, 1172, 590, 236, 56, dvA(THEME.lavender, 0.2));
    const m = this.block(g, 'fman', 1170, 656, 240, 60, '', 'l');
    this.silk(m, 'MANTISSA', 1179, 664, 10, 'dv-silk-l');
    E.fmVal = this.txt(m, '---- ---- ---- ----', 1178, 694, 12, 'dv-go', 'start', { 'font-weight': 700 });
    E.fmSub = this.txt(m, '64 bits', 1402, 710, 8, 'dv-f', 'end');
    E.fmFl = this.flashRect(m, 1172, 658, 236, 56, dvA(THEME.lavender, 0.2));
  }
  // ---- the 5-stage pipeline ----
  buildPipe486(g, pp) {
    const E = this.els, P = dieP();
    const names = [['PF', 'prefetch'], ['D1', 'decode 1'], ['D2', 'decode 2'], ['EX', 'execute'], ['WB', 'write back']];
    const b = this.block(g, 'pipe', pp.x + 8, pp.y + 6, pp.w - 16, pp.h - 10, '');
    const cid = 'dv-pclip' + Math.random().toString(36).slice(2, 8);
    const cp = svgEl('clipPath', { id: cid }, b);
    if (!pp.vertical) {
      this.silk(b, 'PIPELINE', pp.x + 17, pp.y + 14, 10, 'dv-silk');
      this.txt(b, '5 stages', pp.x + 17, pp.y + 40, 8.5, 'dv-m');
      this.txt(b, '1 step per clock', pp.x + 17, pp.y + 51, 7.5, 'dv-f');
      const x0 = pp.x + 130, step = (pp.w - 140) / 5;
      const X = names.map((n, k) => x0 + k * step);
      E.pipeBox = names.map(([n, t], k) => {
        const x = X[k];
        const r = svgEl('rect', { x, y: pp.y + 11, width: step - 6.8, height: 42, rx: 5, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 1 }, b);
        this.txt(b, n, x + 7, pp.y + 25, 10, 'dv-ph', 'start', { 'font-weight': 700 });
        this.txt(b, t, x + 26, pp.y + 25, 8, 'dv-f');
        if (k < 4) this.txt(b, '▶', x + step - 3.4, pp.y + 36, 8, 'dv-f', 'middle');
        return r;
      });
      svgEl('rect', { x: x0, y: pp.y + 11, width: pp.x + pp.w - 10 - x0, height: 42 }, cp);
      this.pipeGeo = { vertical: false, pos: X.map(x => x + 8), step, fixed: pp.y + 46, max: Math.floor((step - 20) / 7.1) };
    } else {
      this.silk(b, 'PIPELINE', pp.x + 17, pp.y + 14, 10, 'dv-silk');
      this.txt(b, '5 stages · 1 step per clock', pp.x + pp.w - 16, pp.y + 22, 8.5, 'dv-f', 'end');
      const y0 = pp.y + 36, step = (pp.h - 50) / 5, x = pp.x + 16, w = pp.w - 32;
      const Y = names.map((n, k) => y0 + k * step);
      E.pipeBox = names.map(([n, t], k) => {
        const y = Y[k];
        const r = svgEl('rect', { x, y, width: w, height: step - 7, rx: 5, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 1 }, b);
        this.txt(b, n, x + 8, y + 15, 10, 'dv-ph', 'start', { 'font-weight': 700 });
        this.txt(b, t, x + 28, y + 15, 8, 'dv-f');
        if (k < 4) this.txt(b, '▼', x + w / 2, y + step - 0.5, 7, 'dv-f', 'middle');
        return r;
      });
      svgEl('rect', { x, y: y0, width: w, height: 5 * step - 7 }, cp);
      this.pipeGeo = { vertical: true, pos: Y.map(y => y + step - 17), step, fixed: x + 10, max: Math.floor((w - 20) / 7.1) };
    }
    const lay = svgEl('g', { 'clip-path': `url(#${cid})` }, b);
    E.pipeT = [0, 1, 2, 3, 4, 5].map(() => this.txt(lay, '', 0, 0, 11.5, 'dv-v', 'start', { 'font-weight': 600 }));
    E.pipeFl = this.flashRect(b, pp.x + 10, pp.y + 8, pp.w - 20, pp.h - 14, dvA(THEME.phosphor, 0.08));
  }

  // ---------- tokens: the internal bus (y = 366) and the gutter buses ----------
  point(spec) {
    const A = this.arr;
    if (!A) return null;
    const mk = (u, x, y, gx) => { const [X, Y] = this.upt(u, x, y), GX = gx + A.off[u][0]; return { pts: [[X, Y], [GX, Y]], gx: GX, y: Y, row: A.row[u] }; };
    if (spec && typeof spec === 'object') {
      if (spec.tail !== undefined) {
        const s = clamp(spec.tail, 0, 31), y = this.qy(s) + this.QH / 2, r = mk('pfU', this.qx(s), y, 256);
        r.pts.splice(1, 0, this.upt('pfU', 244, y));
        return r;
      }
      if (spec.bus === 'eu') return mk('intU', 944, clamp(spec.y, 392, 716), 944);
      if (spec.bus) { const y = A.gaps[0], x = clamp(spec.x || 700, 60, (A.spine || A.W - 50)); return { pts: [[x, y]], gx: x, y, row: 0 }; }
      return null;
    }
    if (D386_REGS.includes(spec)) return mk('intU', 938, 414 + D386_REGS.indexOf(spec) * 25.6 + 12, 944);
    if (D386_SREGS.includes(spec)) {
      const y = 93 + D386_SREGS.indexOf(spec) * 18.6 + 9;
      return A.alt.sgU ? mk('sgU', 1404, y, 1418) : mk('sgU', 1082, y, 1068);
    }
    const p = D486_PTS[spec];
    if (!p) return null;
    const [u, x, y, gx, ax, agx] = p;
    return A.alt[u] && ax !== undefined ? mk(u, ax, y, agx) : mk(u, x, y, gx);
  }
  // A path along the buses: to the gutter of the unit, along the gap between the rows (and
  // along the spine when the rows are not next to each other), to the other end point.
  route(a, b) {
    const A = this.point(a), B = this.point(b);
    if (!A || !B) return null;
    const G = this.arr.gaps, sp = this.arr.spine;
    let pts = A.pts.slice();
    if (A.row === B.row) {
      if (A.gx !== B.gx) { const g = G[Math.min(A.row, G.length - 1)]; pts.push([A.gx, g], [B.gx, g]); }
    } else {
      const down = A.row < B.row;
      const gA = down ? G[A.row] : G[A.row - 1], gB = down ? G[B.row - 1] : G[B.row];
      pts.push([A.gx, gA]);
      if (gA !== gB && sp) pts.push([sp, gA], [sp, gB]);
      pts.push([B.gx, gB]);
    }
    pts = pts.concat(B.pts.slice().reverse());
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
    return out;
  }

  // ---------- events ----------
  instr(events, info) {
    super.instr(events, info);
    this.hasFlush = events.some(e => e.k === 'queue' && e.op === 'flush');
    this.qFinal = null;
    this.mdl.d2 = null;
    this.fillShown = false;
  }
  event(e, clockMs) {
    switch (e.k) {
      case 'pipe': this.cmsSet(e, clockMs); this.onPipe(e, this.anim(e.t)); return;
      case 'cache': this.cmsSet(e, clockMs); this.onCache(e, this.anim(e.t)); return;
      default: break;
    }
    super.event(e, clockMs);
  }
  onPipe(e, a) {
    this.pipeOld = this.mdl.pipe ? this.mdl.pipe.slice() : ['', '', '', '', ''];
    this.mdl.pipe = (e.stage || []).slice(0, 5);
    while (this.mdl.pipe.length < 5) this.mdl.pipe.push('');
    this.anims.pipe = Object.assign(a, { n: 1, minMs: 420 });
    this.pipeKey = '';
    this.flash('pipe', a, 2, 400);
  }
  onCache(e, a) {
    const C = this.cacheObj();
    this.mdl.cacheAcc = { phys: e.phys >>> 0, set: e.set, way: e.way, hit: !!e.hit, fill: !!e.fill, write: !!e.write, code: !!e.code, nc: !!e.nc };
    this.placeCacheMarks(e.set, e.way);
    this.flash('cset', a, 6, 900);
    if (e.way >= 0) this.flash('cway', a, 6, 900);
    this.flash('ctag', a, 4, 600);
    this.renderTag();
    this.renderCstat();
    if (!C) return;
    const from = e.code ? 'pfa' : this.mdl.sys && this.mdl.sys.pg ? 'pgadd' : 'linadd';
    this.token(e.t, [from, 'ctag'], dvHex8(e.phys), THEME.cyan, 0, 1.2, 240);
    if (e.write) this.token(e.t, [this.writeSrc({ data: -1 }), 'cache'], e.hit ? 'WRITE HIT' : 'WRITE MISS', THEME.goldHi, 0.4, 1.4, 260);
    else if (e.hit) this.token(e.t, ['cache', e.code ? 'pfq' : this.readDest(e)], 'HIT', THEME.phosphor, 1.2, 1.6, 260);
    else if (e.fill) this.token(e.t, ['ctag', 'burst'], 'MISS', THEME.magenta, 1, 1.2, 240);
    else if (e.nc) this.token(e.t, ['ctag', 'burst'], 'NO CACHE', THEME.magenta, 1, 1.2, 240);
    this.sfxTick(e.hit ? 1.9 : 1.6);
  }
  onQueue(e, a) {
    if (e.op === 'pop') {
      const n = Math.min(e.n, this.mdl.q.length);
      const after = this.mdl.q.slice(n);
      this.qOps.push({ kind: 'pop', n, q: after, a: null });
      if (this.dec && this.tokensOn) {
        const b = this.dec.bytes.slice(0, 3).map(hex2).join(' ') + (this.dec.bytes.length > 3 ? '…' : '');
        this.token(e.t, ['qhead', 'dec'], b, THEME.phosphor, 0, 1.4, 240);
      }
      const fin = (e.q || []).slice(0, this.QN);
      this.qFinal = fin;
      if (!this.hasFlush) this.qRefill(e.t + 1, after, fin);
    } else if (e.op === 'flush' && !this.flushDone) {
      this.doFlush(e.t);
      if (this.qFinal) this.qRefill(e.t, [], this.qFinal);
    }
  }
  // The prefetcher reads code lines from the cache: the new bytes come into the queue.
  qRefill(t, before, fin) {
    if (fin.join() === before.join()) return;
    const more = fin.length > before.length && fin.slice(0, before.length).join() === before.join();
    const n = more ? fin.length - before.length : fin.length;
    const tk = this.token(t, ['cache', { tail: more ? before.length : 0 }], `${n} bytes`, THEME.gold, 0.2, 1.4, 300);
    this.qOps.push({ kind: 'fetch', q: fin, a: tk || Object.assign(this.anim(t), { d: 0.2, n: 1.4, minMs: 300 }) });
  }
  onEA(e, a) {
    const lin = e.lin !== undefined ? e.lin >>> 0 : null;
    const d = this.mdl.desc && this.mdl.desc[e.seg];
    const base = lin !== null ? (lin - (e.off >>> 0)) >>> 0 : d ? d.base : 0;
    this.mdl.sig = { seg: e.seg, base, off: e.off >>> 0, lin: lin !== null ? lin : (base + e.off) >>> 0, phys: e.phys >>> 0 };
    this.mdl.d2 = { seg: e.seg, off: e.off >>> 0 };
    this.flash('sig', a, 3, 400);
    this.flash('lim', a, 3, 400);
    this.flash('d2', a, 3, 400);
    this.renderSigma();
    this.renderD12();
    if (!(this.mdl.sys && this.mdl.sys.pg)) this.renderPage();
    const off = e.off > 0xFFFF ? dvHex8(e.off) : hex4(e.off);
    this.token(e.t, ['dec', 'linadd'], off, THEME.gold, 0, 1.6, 240);
    const pg = this.mdl.sys && this.mdl.sys.pg;
    if (pg) this.token(e.t, ['linadd', 'tlb'], dvHex8(this.mdl.sig.lin), THEME.cyan, 1.6, 1.4, 240);
  }
  onAlu(e, a) {
    super.onAlu(e, a);
    if (/^(SHL|SHR|SAR|SAL|ROL|ROR|RCL|RCR|SHLD|SHRD|BT|BTS|BTR|BTC|BSF|BSR)$/.test(e.op)) {
      this.mdl.barrel = e;
      this.flash('barrel', a, 5, 800);
      this.renderBarrel();
    }
  }
  onFpu(e, a) {
    this.mdl.fpuText = e.text;
    this.mdl.fpuCyc = e.cycles || 0;
    const old = this.readFpu();
    this.flash('fop', a, 6, 900);
    const m = this.fpuM;
    if (old && m) {
      for (let i = 0; i < 8; i++) {
        const p = (m.top + i) & 7, q = (old.top + i) & 7;
        if (old.vals[q] !== m.vals[p] || old.tags[q] !== m.tags[p]) this.flash('frow:' + i, a, 8, 1200);
      }
    }
    this.flash('fexp', a, 6, 900);
    this.flash('fman', a, 6, 900);
    const t = (this.dec && this.dec.text) || e.text || '';
    if (/\[/.test(t)) {
      const store = /^f(i|b)?st|^fn?s(ave|tenv|tcw|tsw)/i.test(t.trim());
      this.token(e.t, store ? ['fstk', 'cache'] : ['cache', 'fstk'], store ? 'store' : 'load', THEME.lavender, 0, 1.6, 300);
    }
    this.token(e.t, ['fstk', 'fman'], (e.text || 'FPU').split(/\s+/)[0], THEME.lavender, 1, 1.6, 300);
    this.renderFpu486();
    this.sfxTick(0.9);
  }
  onBus(e, a, type) {
    const len = e.len || 2;
    Object.assign(a, { n: len, minMs: 55 * len + 60, e, type });
    const evs = this.events || [], i = evs.indexOf(e);
    this.nextBus = i >= 0 ? evs.slice(i + 1).find(x => x.k === 'fetch' || x.k === 'bus') || null : null;
    const walk = !!(this.walkSet && (type === 'memr' || type === 'memw') && this.walkSet.has(e.addr & 0xFFFFFF));
    a.req = type === 'code' ? 'code' : walk ? 'page' : 'data';
    this.anims.bus = a;
    this.mdl.bus = { e, type, req: a.req };
    if (this.visible) this.renderBusText();
    const hexd = e.width === 2 ? hex4(e.data) : hex2(e.data);
    if (type === 'code' && e === this.flushAt && !this.flushDone) this.doFlush(e.t);
    if (e.burst) {
      this.onBurst(e, a, type);
      this.token(e.t, ['xcvr', 'lfill'], hexd, THEME.gold, 0.2, Math.max(1, len * 0.8), 200);
      if (type === 'code') this.setT(this.els.pfAddr, dvHex8(e.line >>> 0));
      return;
    }
    if (type === 'code') {
      this.token(e.t, ['xcvr', 'pfq'], hexd, THEME.gold, 0.3, len * 0.8, 240);
      this.setT(this.els.pfAddr, dvHex8(e.addr));
    } else if (walk) {
      const wk = this.walkOf(e.addr & 0xFFFFFF);
      if (wk) this.showWalk(wk.w, a, type === 'memr' ? wk.n : 2);
      this.flash('walk', a, 4, 500);
      this.token(e.t, type === 'memw' ? ['walker', 'xcvr'] : ['xcvr', 'walker'], hexd, THEME.lavender, 0.3, len, 260);
    } else if (type === 'memr' || type === 'ior') {
      this.token(e.t, ['xcvr', this.readDest(e)], hexd, THEME.gold, 0.6, len, 260);
    } else if (type === 'memw' || type === 'iow') {
      if (type === 'memw') {
        const W = this.mdl.wbuf = (this.mdl.wbuf || []).concat([{ addr: e.addr >>> 0, data: e.data, width: e.width }]).slice(-4);
        this.wbNew = W.length - 1;
        this.flash('wbuf', a, 3, 500);
        this.renderWbuf();
        this.token(e.t, ['wbuf', 'xcvr'], hexd, THEME.goldHi, 0.4, len, 260);
      } else this.token(e.t, [this.writeSrc(e), 'xcvr'], hexd, THEME.gold, 0, len, 260);
    }
  }
  // One transfer of a line fill: its word goes into the line buffer.
  onBurst(e, a, type) {
    const line = e.line >>> 0;
    let F = this.mdl.fill;
    if (!F || F.line !== line || e.beat === 0 || F.done) {
      F = this.mdl.fill = { line, bytes: new Array(16).fill(null), beats: 0, first: (e.addr >>> 2) & 3, code: type === 'code', done: false, last: -1 };
    }
    const o = (e.addr - line) & 15;
    F.bytes[o] = e.data & 0xFF;
    if (e.width === 2) F.bytes[(o + 1) & 15] = (e.data >> 8) & 0xFF;
    F.beats = Math.max(F.beats, (e.beat | 0) + 1);
    F.last = o;
    if (e.beat === 7) {
      F.done = true;
      const c = this.m.cpu;
      const idx = c.cacheFind ? c.cacheFind(line) : -1;
      if (idx >= 0) { this.placeCacheMarks(idx >> 2, idx & 3); this.flash('cway', Object.assign({}, a, { tc: a.tc + 1 }), 6, 900); }
      this.renderCache();
    }
    this.flash('lfill', a, 2, 300);
    if (!e.beat) this.flash('burst', a, 3, 400);
    this.renderFill();
  }
  flashEl(key) {
    const E = this.els;
    if (key.startsWith('frow:')) { const r = E.fRow && E.fRow[+key.slice(5)]; return r ? r.fl : null; }
    const m = { cset: E.cSetFl, cway: E.cWayFl, ctag: E.ctFl, lfill: E.lfFl, cstat: E.csFl, burst: E.buFl, wbuf: E.wbFl, barrel: E.brFl,
      d2: E.decFl, dec: E.d1Fl, pipe: E.pipeFl, fop: E.fOpFl, fexp: E.feFl, fman: E.fmFl };
    if (key in m) return m[key] || null;
    return super.flashEl(key);
  }
  onExc(e) {
    const a = this.anim(e.t);
    const [nm, long] = D486_EXC[e.vec] || [e.name || '#' + hex2(e.vec), 'EXCEPTION'];
    const name = e.name || nm;
    const err = e.err !== undefined && e.err !== null ? `error code ${hex4(e.err)}` : 'no error code';
    this.mdl.exc = { name, vec: e.vec, err: e.err };
    this.flash('prot', a, 10, 1600);
    const cr2 = e.vec === 14 ? `  ·  CR2 ${dvHex8(this.m.cpu.cr[2])}` : '';
    this.showOverlay(a, `${name}  ${long}`, `vector ${hex2(e.vec)}h  ·  ${err}${cr2}`, this.dec ? `at ${hex4(this.dec.cs)}:${this.dec.ip > 0xFFFF ? dvHex8(this.dec.ip) : hex4(this.dec.ip)}  ${this.dec.text}` : '', THEME.magenta);
    this.renderSigma();
    this.renderProt();
  }
  fast(stats) {
    super.fast(stats);
    const h = this.heatT, b = stats.bus || {}, C = this.cacheObj();
    const lg = v => clamp(Math.log10(1 + (v || 0)) / 4.2, 0, 1);
    const st = C ? C.stats : null, prev = this.lastCst || null;
    const d = k => (st && prev ? st[k] - prev[k] : 0);
    const all = (b.fetch || 0) + (b.memr || 0) + (b.memw || 0) + (b.ior || 0) + (b.iow || 0);
    const s = stats.sample || [];
    const fpuOn = s.some(x => x.k === 'fpu');
    Object.assign(h, {
      cache: lg((d('hits') + d('misses')) * 0.4), ctag: lg((d('hits') + d('misses')) * 0.3), lfill: lg(d('fills') * 8), cstat: lg(d('fills') * 3),
      addr4: lg(all), burst: lg(d('fills') * 8), wbuf: lg(b.memw), xcvr: lg(all), pfq: h.dec, pfa: (h.dec || 0) * 0.5,
      dec: h.dec, ctl: h.rom, prot: (h.rom || 0) * 0.3, flags: h.flags, alu: h.alu, barrel: (h.alu || 0) * 0.4, muldiv: (h.alu || 0) * 0.3,
      fstk: fpuOn ? 0.8 : (h.fstk || 0) * 0.7, fexp: fpuOn ? 0.6 : (h.fexp || 0) * 0.7, fman: fpuOn ? 0.6 : (h.fman || 0) * 0.7, pipe: h.dec,
    });
    this.lastCst = st ? Object.assign({}, st) : null;
    const pe = s.find(x => x.k === 'pipe');
    if (pe) { this.mdl.pipe = pipeAfterHalt(pe.stage); this.anims.pipe = null; }   // (no stages after a HLT)
    const ce = s.find(x => x.k === 'cache');
    if (ce) this.mdl.cacheAcc = { phys: ce.phys >>> 0, set: ce.set, way: ce.way, hit: !!ce.hit, fill: !!ce.fill, write: !!ce.write, code: !!ce.code, nc: !!ce.nc };
    const fe = s.find(x => x.k === 'fpu');
    if (fe) this.mdl.fpuText = fe.text;
  }

  // ---------- per frame ----------
  frame(now, dt) {
    super.frame(now, dt);
    if (this.els && this.els.pipeT) this.stepPipe(now);
  }
  stepPads(now) {
    const st = {}, set = (n, c) => { st[n] = c; };
    const cur = this.curBus(now);
    const f = this.m.fpu;
    let T = -1;
    if (cur) {
      const e = cur.e, type = cur.type;
      T = cur.T;
      const write = type === 'memw' || type === 'iow';
      const addr = type === 'inta' ? 4 : type === 'halt' ? 2 : e.addr >>> 0;
      for (let b = 2; b < 32; b++) set('A' + b, 'a' + ((addr >>> b) & 1));
      if (write || T === cur.len - 1) {
        const wd = e.width === 2 ? e.data : ((e.addr & 1) ? e.data << 8 : e.data);
        for (let b = 0; b < 16; b++) {
          if (type === 'halt' || (type === 'inta' && b >= 8)) continue;
          set('D' + b, 'd' + ((wd >> b) & 1));
        }
      }
      if (type !== 'halt' && type !== 'inta') {
        const be = e.width === 2 ? ((addr & 2) ? 12 : 3) : 1 << (addr & 3);
        for (let k = 0; k < 4; k++) if (be & (1 << k)) set('BE' + k, 'c1');
      }
      set('BS16', 'c1');
      const s = D386_STATUS[type] || [1, 1, 1];
      set('M/IO', 'c' + s[0]); set('D/C', 'c' + s[1]); set('W/R', 'c' + s[2]);
      const burst = !!e.burst, beat = e.beat | 0;
      if (T === 0 && (!burst || beat === 0)) set('ADS', 'c1');
      if (burst) set('KEN', 'c1');
      if (T === cur.len - 1) {
        if (burst) set('BRDY', 'g1'); else set('RDY', 'g1');
        if (!burst || beat === 7) set('BLAST', 'c1');
      }
      if (type === 'inta') { set('LOCK', 'c1'); set('INTR', 'c1'); }
    }
    const it = this.anims.intr;
    if (it) {
      const p = this.prog(it, now);
      if (p >= 0 && p < 1) { if (it.e.src === 'irq') set('INTR', 'c1'); if (it.e.src === 'nmi') set('NMI', 'c1'); }
    }
    if (this.dec && /^lock/.test(this.dec.text) && this.anims.dec && this.prog(this.anims.dec, now) < 1) set('LOCK', 'c1');
    if (f && f.intRequest) set('FERR', 'c1');
    if (this.resetAt && now - this.resetAt < 900) set('RESET', 'c1');
    const playing = this.anims.dec && this.prog(this.anims.dec, now) < 1;
    if (playing && this.cms >= 12 && (this.vclock % 1) < 0.5) set('CLK', 'g1');
    for (const pd of this.els.pads) {
      const cls = st[pd.name];
      this.setC(pd.c, pd.base + (cls ? ' dv-' + cls : ''));
    }
    const ringCol = !cur ? dieP().scribe : T === 0 ? THEME.cyan : THEME.gold;
    this.setA(this.els.ring, 'stroke', ringCol);
    this.setA(this.els.ring, 'opacity', cur ? '0.9' : '0.55');
    this.setA(this.els.addrBus, 'opacity', cur && T === 0 ? '1' : '0.7');
    const E = this.els, P = dieP();
    const lamp = (el, on, col) => this.setA(el, 'fill', on ? col : P.dot);
    if (E.beL) [3, 2, 1, 0].forEach((k, i) => lamp(E.beL[i], st['BE' + k], THEME.magenta));
    lamp(E.bs16L, st.BS16, THEME.magenta);
    if (E.bl) {
      lamp(E.bl.ADS, st.ADS, THEME.magenta); lamp(E.bl.BLAST, st.BLAST, THEME.magenta); lamp(E.bl.KEN, st.KEN, THEME.cyan);
      lamp(E.bl.BRDY, st.BRDY, THEME.phosphor); lamp(E.bl.RDY, st.RDY, THEME.phosphor);
    }
  }
  stepBusCtl(now) {
    const E = this.els, cur = this.curBus(now);
    const e = cur ? cur.e : null, burst = !!(e && e.burst), beat = e ? e.beat | 0 : 0;
    const t1 = cur && cur.T === 0 && (!burst || beat === 0);
    this.setC(E.bcT[0], 'dv-tstate' + (t1 ? ' dv-on' : ''));
    this.setC(E.bcT[1], 'dv-tstate' + (cur && !t1 ? ' dv-on' : ''));
    const type = cur ? cur.type : null;
    const name = !cur ? 'IDLE  Ti' : burst ? `LINE FILL · ${type === 'code' ? 'CODE' : 'DATA'}` : type === 'halt' ? 'HALT/SHUTDOWN' : DIE_CYCLE[type] || type;
    this.setT(E.bcType, name);
    this.setA(E.bcType, 'class', !cur ? 'dv-m' : burst ? 'dv-cy' : /io|inta|halt/.test(type) ? 'dv-mg' : 'dv-go');
    const s = cur ? D386_STATUS[type] || [1, 1, 1] : null;
    E.bcBits.forEach((t, j) => this.setT(t, s ? String(s[j]) : '·'));
    const F = this.mdl.fill;
    E.beat.forEach((c, i) => {
      const done = burst ? i < beat : !!(F && !cur && F.done && i < 8);
      const on = burst && i === beat;
      this.setC(c, 'dv-cell' + (on ? ' dv-l dv-on' : done ? ' dv-on' : ''));
    });
  }
  stepMisc(now) {
    const E = this.els, dec = this.anims.dec;
    const fastOn = this.lastFast && now - this.lastFast < 160;
    let pos = -1;
    if (dec && this.dec && dec.serial === this.serial) {
      const p = this.prog(dec, now);
      if (p >= 0 && p < 1) pos = (((this.dec.bytes[0] || 0) * 13 + Math.floor(p * this.cycles) * 7) * 2654435761 >>> 0) % 15;
    }
    if (fastOn) pos = Math.floor(now / 70) % 15;
    this.setA(E.romRow, 'x', String(526 + Math.max(0, pos) * (172 / 14)));
    this.setA(E.romRow, 'opacity', pos < 0 ? '0' : fastOn ? '0.4' : '0.9');
    const playing = dec && this.prog(dec, now) < 1 && !fastOn;
    const c = playing ? Math.min(this.cycles, Math.max(0, Math.floor(this.vclock))) : 0;
    this.setT(E.decClk, playing ? `clock ${c} / ${this.cycles}` : '');
    this.setA(E.clkDot, 'fill', playing && (this.vclock % 1) < 0.5 ? THEME.phosphor : fastOn ? THEME.gold : dieP().dot);
    this.setT(E.clkText, fastOn ? 'free running' : playing ? `${this.cms >= 1 ? Math.round(this.cms) : this.cms.toFixed(1)} ms/clock` : this.mhz());
  }
  // The pipeline texts move one stage on (to the right, or down in the portrait plan) when a
  // new instruction starts.
  stepPipe(now) {
    const E = this.els, G = this.pipeGeo, P = this.mdl.pipe || ['', '', '', '', ''], O = this.pipeOld || ['', '', '', '', ''];
    if (!G) return;
    const a = this.anims.pipe;
    let u = a ? this.prog(a, now) : 1;
    u = this.reduced ? (u >= 0 ? 1 : 0) : clamp(u, 0, 1);
    const q = easeInOut(u);
    const key = P.join('|') + ':' + q.toFixed(3);
    if (key === this.pipeKey) return;
    this.pipeKey = key;
    const X = G.pos, mx = G.max, cut = s => (s && s.length > mx ? s.slice(0, mx - 1) + '…' : s || '');
    const put = (t, p) => {
      this.setA(t, 'x', (G.vertical ? G.fixed : p).toFixed(1));
      this.setA(t, 'y', (G.vertical ? p : G.fixed).toFixed(1));
    };
    for (let k = 0; k < 5; k++) {
      const t = E.pipeT[k];
      put(t, lerp(k ? X[k - 1] : X[0] - G.step, X[k], q));
      this.setT(t, cut(P[k]) || (k === 0 ? '' : '·'));
      this.setA(t, 'opacity', (k === 0 ? q : 1).toFixed(2));
      this.setA(t, 'class', k === 3 ? 'dv-ph' : k === 4 ? 'dv-m' : 'dv-v');
    }
    const g = E.pipeT[5];
    this.setT(g, cut(O[4]));
    put(g, X[4] + q * G.step);
    this.setA(g, 'opacity', (1 - q).toFixed(2));
    this.setA(g, 'class', 'dv-m');
    const busy = !!(this.anims.dec && this.prog(this.anims.dec, now) < 1);
    E.pipeBox.forEach((r, k) => this.setA(r, 'stroke', k === 3 && busy ? THEME.phosphor : dieP().cellStroke));
  }

  // ---------- renders ----------
  renderAll() {
    super.renderAll();
    if (!this.els || !this.els.cl) return;
    this.renderCache(); this.renderTag(); this.renderFill(); this.renderCstat(); this.renderWbuf();
    this.renderFpu486(); this.renderBarrel(); this.renderD12();
    this.pipeKey = '';
  }
  renderSys() {
    super.renderSys();
    const E = this.els, s = this.mdl.sys;
    if (!E.ccMode || !s) return;
    const cd = (s.cr0 >>> 30) & 1, nw = (s.cr0 >>> 29) & 1;
    this.setT(E.ccMode, `cache ${cd ? 'off' : 'on'} · CD ${cd} NW ${nw}`);
    this.setA(E.ccMode, 'class', cd ? 'dv-mg' : 'dv-ph');
    const am = (s.cr0 >>> 18) & 1, ac = (this.mdl.flags >>> 18) & 1;
    this.setT(E.prAc, `#AC check ${am && ac && s.cpl === 3 ? 'on' : 'off'} · AM ${am} AC ${ac}`);
    this.renderCstat();
  }
  // The 512 lines of the cache: a bright cell is a valid line.
  renderCache() {
    const E = this.els, C = this.cacheObj();
    if (!E.cl) return;
    const P = dieP(), F = this.mdl.fill;
    for (let i = 0; i < 512; i++) {
      const l = C ? C.lines[i] : null, el = E.cl[i];
      const nw = !!(F && F.done && l && l.valid && l.addr === F.line);
      const key = l && l.valid ? (l.addr >= 0xA0000 && l.addr < 0x100000 ? 'r' : 'v') + (nw ? 'n' : '') : '';
      if (key === el.key) continue;
      el.key = key;
      if (!key) { this.setA(el.r, 'fill', P.row0); this.setA(el.r, 'stroke', P.cellStroke); }
      else if (nw) { this.setA(el.r, 'fill', THEME.phosphor); this.setA(el.r, 'stroke', THEME.phosphor); }
      else { this.setA(el.r, 'fill', dvMix(THEME.cyan, THEME.panel, key[0] === 'r' ? 0.7 : 0.45)); this.setA(el.r, 'stroke', dvMix(THEME.cyan, THEME.panel, 0.2)); }
    }
  }
  renderTag() {
    const E = this.els, x = this.mdl.cacheAcc, C = this.cacheObj();
    if (!E.ctAddr) return;
    if (!C) { this.setT(E.ctRes, 'no cache in this core'); return; }
    if (!x) {
      this.setT(E.ctAddr, '--------'); this.setT(E.ctTag, '--'); this.setT(E.ctSet, '--'); this.setT(E.ctOfs, '-');
      this.setT(E.ctRes, C.stats.hits + C.stats.misses ? '' : 'no access yet'); this.setA(E.ctRes, 'class', 'dv-f');
      return;
    }
    const set = x.set, tag = x.phys >>> 11, P = dieP();
    this.setT(E.ctAddr, dvHex8(x.phys));
    this.setT(E.ctTag, hex(tag, 6)); this.setT(E.ctSet, hex2(set)); this.setT(E.ctOfs, hex(x.phys & 15, 1));
    for (let w = 0; w < 4; w++) {
      const l = C.lines[set * 4 + w], R = E.ctWay[w];
      const match = x.way === w && (x.hit || x.fill);
      this.setT(R.t, l.valid ? hex(l.tag, 6) : '------');
      this.setA(R.t, 'class', match ? 'dv-ph' : l.valid ? 'dv-v' : 'dv-f');
      this.setA(R.v, 'fill', l.valid ? THEME.cyan : P.dot);
      this.setT(R.m, match ? (x.hit ? '=' : 'NEW') : l.valid ? '≠' : '');
      this.setA(R.m, 'class', match ? 'dv-ph' : 'dv-f');
      this.setA(R.bg, 'stroke', match ? (x.hit ? THEME.phosphor : THEME.gold) : P.cellStroke);
    }
    let res, cls;
    if (x.write) { res = x.hit ? 'WRITE HIT · to the bus' : 'WRITE MISS · no fill'; cls = 'dv-go'; }
    else if (x.hit) { res = `HIT · way ${x.way}`; cls = 'dv-ph'; }
    else if (x.fill) { res = `MISS · fill way ${x.way}`; cls = 'dv-mg'; }
    else { res = 'MISS · not cached'; cls = 'dv-mg'; }
    this.setT(E.ctRes, res + (x.code ? ' (code)' : ''));
    this.setA(E.ctRes, 'class', cls);
    const b = C.lru[set];
    this.setT(E.ctLru, `LRU  B0 ${b & 1}  B1 ${(b >> 1) & 1}  B2 ${(b >> 2) & 1}`);
    let v = -1;
    for (let w = 0; w < 4 && v < 0; w++) if (!C.lines[set * 4 + w].valid) v = w;
    if (v < 0) v = !(b & 1) ? (b & 2 ? 1 : 0) : (b & 4 ? 3 : 2);
    this.setT(E.ctVic, `next fill of this set: way ${v}`);
    this.setT(E.ctNote, x.nc ? 'CD = 1, PCD = 1 or no KEN#' : `line ${dvHex8(x.phys & ~15)}`);
  }
  renderFill() {
    const E = this.els, F = this.mdl.fill, P = dieP();
    if (!E.lfCells) return;
    for (let i = 0; i < 16; i++) {
      const v = F ? F.bytes[i] : null, c = E.lfCells[i];
      const newest = F && !F.done && (i === F.last || i === ((F.last + 1) & 15));
      this.setT(c.t, v === null || v === undefined ? '' : hex2(v));
      this.setA(c.t, 'class', newest ? 'dv-ph' : F && F.done ? 'dv-v' : 'dv-go');
      this.setA(c.r, 'fill', v === null || v === undefined ? P.row0 : newest ? dvMix(THEME.phosphor, THEME.panel, 0.7) : F.done ? dvMix(THEME.cyan, THEME.panel, 0.72) : dvMix(THEME.gold, THEME.panel, 0.78));
      this.setA(c.r, 'stroke', newest ? THEME.phosphor : P.cellStroke);
    }
    const ords = ['1st', '2nd', '3rd', '4th'];
    for (let d = 0; d < 4; d++) this.setT(E.lfOrd[d], F ? ords[(d ^ F.first) & 3] + (d === F.first ? ' (needed)' : '') : '');
    this.setT(E.lfNote, F ? `line ${dvHex8(F.line)} · ${F.done ? 'done' : `${F.beats}/8`}` : 'burst 2-1-1-1');
  }
  renderCstat() {
    const E = this.els, C = this.cacheObj();
    if (!E.csHit) return;
    const s = this.mdl.sys;
    if (!C) { this.setT(E.csRate, '—'); this.setT(E.csMode, 'no cache'); return; }
    const st = C.stats, n = st.hits + st.misses;
    const f = v => v.toLocaleString('en-US');
    this.setT(E.csHit, 'hits ' + f(st.hits));
    this.setT(E.csMiss, 'misses ' + f(st.misses));
    this.setT(E.csFill, 'fills ' + f(st.fills));
    this.setT(E.csRate, n ? (st.hits / n * 100).toFixed(1) + ' %' : '— %');
    const cd = s ? (s.cr0 >>> 30) & 1 : 1, nw = s ? (s.cr0 >>> 29) & 1 : 1;
    this.setT(E.csMode, `CD ${cd} NW ${nw} · ${cd ? 'no fills' : 'on'}`);
    this.setA(E.csMode, 'class', cd ? 'dv-mg' : 'dv-ph');
  }
  renderWbuf() {
    const E = this.els, W = this.mdl.wbuf || [], P = dieP();
    if (!E.wb) return;
    for (let i = 0; i < 4; i++) {
      const x = W[i], el = E.wb[i];
      this.setT(el.a, x ? dvHex6(x.addr) : '');
      this.setT(el.d, x ? (x.width === 2 ? hex4(x.data) : hex2(x.data)) : '');
      this.setA(el.r, 'stroke', x && i === this.wbNew ? THEME.goldHi : P.cellStroke);
    }
  }
  renderBusText() {
    const b = this.mdl.bus, E = this.els;
    if (!E.laA || !b) return;
    const e = b.e, io = b.type === 'ior' || b.type === 'iow';
    this.setT(E.laA, b.type === 'inta' ? 'A vector' : io ? 'port ' + hex4(e.addr) : 'A ' + dvHex8(e.addr));
    const be = e.width === 2 ? ((e.addr & 2) ? 12 : 3) : 1 << (e.addr & 3);
    this.setT(E.laNext, `A31–A2 · BE3–BE0 ${bin(~be & 15, 4)}` + (b.req === 'page' ? ' · page table' : e.burst ? ` · beat ${(e.beat | 0) + 1}/8` : ''));
    this.setT(E.xcD, 'D ' + (e.width === 2 ? hex4(e.data) : hex2(e.data)));
    this.setT(E.xcDir, (/w/.test(b.type) ? 'write' : 'read') + (e.dev ? ' · ' + e.dev : '') + (e.width === 2 ? ' · word' : ' · byte'));
  }
  renderPei() { }
  renderIq() { }
  renderFpu() { this.renderFpu486(); }
  renderFpu486() {
    const E = this.els;
    if (!E.fRow) return;
    const m = this.fpuM, f = this.m.fpu;
    const t = this.mdl.fpuText || 'idle';
    this.setT(E.fOp, t.length > 23 ? t.slice(0, 22) + '…' : t);
    this.setA(E.fOp, 'class', this.mdl.fpuText ? 'dv-lv' : 'dv-f');
    if (!m || !f) { this.setT(E.fTop, 'no FPU'); return; }
    this.setT(E.fTop, `TOP ${m.top}` + (this.mdl.fpuCyc ? ` · ${this.mdl.fpuCyc} clk` : ''));
    this.setT(E.fSw, `SW ${hex4(m.sw)} CW ${hex4(m.cw)}`);
    const tagCol = [THEME.lavender, THEME.cyan, THEME.magenta, THEME.faint];
    for (let i = 0; i < 8; i++) {
      const p = (m.top + i) & 7, R = E.fRow[i];
      this.setT(R.ph, 'R' + p);
      this.setT(R.v, m.tags[p] === 3 ? 'empty' : m.vals[p]);
      this.setA(R.v, 'class', m.tags[p] === 3 ? 'dv-f' : 'dv-v');
      this.setA(R.tag, 'fill', tagCol[m.tags[p]]);
    }
    const b = this.els.blocks.fstk;
    if (b) b.setAttribute('aria-label', `FPU register stack, TOP ${m.top}: ` + [0, 1, 2, 3, 4, 5, 6, 7].map(i => `ST${i} ${m.vals[(m.top + i) & 7]}`).join(', '));
    // ST(0): the exponent and the mantissa datapaths
    let v = null;
    try { v = f.tag(0) === 3 ? null : f.st(0); } catch (err) { v = null; }
    if (!v) {
      this.setT(E.feSign, 'sign ·'); this.setT(E.feVal, '----'); this.setT(E.feSub, 'ST(0) is empty');
      this.setT(E.fmVal, '---- ---- ---- ----'); this.setT(E.fmSub, '64 bits');
      return;
    }
    const ex = v.exp & 0x7FFF;
    this.setT(E.feSign, `sign ${v.sign ? '1 (−)' : '0 (+)'}`);
    this.setT(E.feVal, hex4(ex));
    this.setT(E.feSub, ex === 0 ? 'zero or denormal' : ex === 0x7FFF ? 'infinity or NaN' : `2^${ex - 16383} · bias 16383`);
    const mh = (BigInt.asUintN(64, BigInt(v.mant || 0))).toString(16).toUpperCase().padStart(16, '0');
    this.setT(E.fmVal, mh.replace(/(.{4})(?=.)/g, '$1 '));
    this.setT(E.fmSub, (BigInt(v.mant || 0) >> 63n) & 1n ? '1.xxx · 64 bits' : '0.xxx · 64 bits');
  }
  renderBarrel() {
    const E = this.els, x = this.mdl.barrel, P = dieP();
    if (!E.brBits) return;
    if (!x) { this.setT(E.brOp, 'idle'); this.setA(E.brOp, 'class', 'dv-f'); return; }
    const w = x.w || 32, a = x.a >>> 0;
    this.setT(E.brOp, `${x.op} ${w}`);
    this.setA(E.brOp, 'class', 'dv-go');
    const left = /^(SHL|SAL|ROL|RCL|SHLD)$/.test(x.op), right = /^(SHR|SAR|ROR|RCR|SHRD)$/.test(x.op);
    const n = (x.b >>> 0) & 31;
    this.setT(E.brCnt, left ? `« ${n}` : right ? `» ${n}` : `bit ${n}`);
    for (let i = 0; i < 32; i++) {
      const bit = 31 - i, inW = bit < w, on = inW && ((a >>> bit) & 1);
      this.setA(E.brBits[i], 'fill', !inW ? THEME.void : on ? THEME.goldHi : P.row0);
      this.setA(E.brBits[i], 'stroke', !left && !right && bit === n && inW ? THEME.magenta : P.cellStroke);
    }
    const f = this.aluFmt(w);
    this.setT(E.brIn, 'in ' + f(a));
    this.setT(E.brRes, '= ' + f(x.r));
  }
  renderDec() {
    super.renderDec();
    this.renderD12();
  }
  // D1: the prefixes, the opcode and the length; D2: the address and the immediate data.
  renderD12() {
    const E = this.els, d = this.mdl.dec;
    if (!E.d1Cls) return;
    if (!d) { this.setT(E.d1Cls, ''); this.setT(E.d1Len, ''); this.setT(E.d2Ea, ''); this.setT(E.d2Imm, ''); return; }
    const by = d.bytes || [];
    let i = 0;
    const pfx = [];
    while (i < by.length && [0x66, 0x67, 0xF0, 0xF2, 0xF3, 0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65].includes(by[i])) pfx.push(hex2(by[i++]));
    const op = [];
    if (by[i] === 0x0F) op.push(hex2(by[i++]));
    if (i < by.length) op.push(hex2(by[i++]));
    const rest = by.length - i;
    this.setT(E.d1Cls, `${pfx.length ? 'prefix ' + pfx.join(' ') + ' · ' : ''}opcode ${op.join(' ') || '--'}${rest > 0 ? ` · +${rest}` : ''}`);
    this.setT(E.d1Len, `${by.length} byte${by.length === 1 ? '' : 's'}`);
    const x = this.mdl.d2;
    this.setT(E.d2Ea, x ? `EA ${x.seg}:${x.off > 0xFFFF ? dvHex8(x.off) : hex4(x.off)}` : /\[/.test(d.text || '') ? 'memory operand' : 'register operands');
    const imm = /,\s*(0x[0-9a-f]+|-?\d+)\s*$/i.exec(d.text || '');
    this.setT(E.d2Imm, imm ? `immediate ${imm[1]}` : '');
  }
}

// ======================================================================================
// Pentium die (app.model '80586', the CPU80586 core). The floor plan follows the P5 die (and
// the Pentium plan of the 3D board): the code cache and the data cache at the left, the TLBs,
// the BTB and the page unit next to them, the bus interface, the prefetch buffers and the
// decoder at the top, the U pipe and the V pipe side by side in the middle, the control ROM,
// the registers and the segment unit at the right, the ALUs, the barrel shifter and the FPU
// along the bottom. A tall view gets a portrait plan: the right column moves under the others.
// ======================================================================================

// Two floor plans. 'L' (landscape) and 'P' (portrait). The blocks keep the 'L' coordinates; in
// 'P' each unit moves by its offset. gaps: the y of the internal buses between the rows; spines:
// the x of the vertical buses that join the gaps; pads: the pads on each side (top, right,
// bottom, left).
const D586_ARR = {
  L: { W: 1500, H: 1000, pads: [50, 36, 52, 30], gaps: [370, 698], spines: [382, 604, 1096],
    off: { cc: [0, 0], ct: [0, 0], fe: [0, 0], rom: [0, 0], dc: [0, 0], dt: [0, 0], pp: [0, 0], rg: [0, 0], ex: [0, 0], fx: [0, 0] } },
  P: { W: 1146, H: 1342, pads: [38, 46, 38, 46], gaps: [370, 698, 965], spines: [382, 604, 1096],
    off: { cc: [0, 0], ct: [0, 0], fe: [0, 0], rom: [-1046, 930], dc: [0, 0], dt: [0, 0], pp: [0, 0], rg: [-696, 602], ex: [0, 0], fx: [-346, 274] } },
};
// 168 pads clockwise from the top left (the signals of the P5 in its 273-pin package).
const D586_PADS = [
  'VCC', 'CLK', 'RESET', 'INIT', 'VSS', 'ADS', 'ADSC', 'NA', 'BRDY', 'BRDYC', 'KEN', 'CACHE', 'WB/WT', 'EWBE', 'VCC', 'VSS', 'M/IO', 'D/C', 'W/R',
  'LOCK', 'SCYC', 'PCD', 'PWT', 'VCC', 'VSS', 'HOLD', 'HLDA', 'BOFF', 'AHOLD', 'BREQ', 'EADS', 'HIT', 'HITM', 'INV', 'FLUSH', 'A20M', 'VCC', 'VSS',
  'INTR', 'NMI', 'SMI', 'SMIACT', 'FERR', 'IGNNE', 'BUSCHK', 'IERR', 'PRDY', 'R/S', 'VCC', 'VSS',
  'BE0', 'BE1', 'BE2', 'BE3', 'BE4', 'BE5', 'BE6', 'BE7', 'VCC', 'VSS',
  'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A23', 'A24', 'A25', 'A26', 'A27', 'A28',
  'A29', 'A30', 'A31', 'VCC', 'VSS'].concat(
  Array.from({ length: 32 }, (_, i) => 'D' + i), ['DP0', 'DP1', 'DP2', 'DP3', 'VCC', 'VSS'], Array.from({ length: 8 }, (_, i) => 'D' + (32 + i)), ['VSS'],
  Array.from({ length: 24 }, (_, i) => 'D' + (40 + i)), ['DP4', 'DP5', 'DP6', 'DP7', 'PCHK', 'PEN']);
const D586_LOW = new Set(['ADS', 'ADSC', 'NA', 'BRDY', 'BRDYC', 'KEN', 'CACHE', 'EWBE', 'LOCK', 'BOFF', 'EADS', 'HIT', 'HITM', 'FLUSH', 'A20M', 'SMI', 'SMIACT',
  'FERR', 'IGNNE', 'BUSCHK', 'IERR', 'R/S', 'BE0', 'BE1', 'BE2', 'BE3', 'BE4', 'BE5', 'BE6', 'BE7', 'PCHK', 'PEN']);
// the pads that this board does not use (parity, snoop, SMM, the second bus ready and the test pins)
const D586_UNUSED = new Set(['INIT', 'ADSC', 'BRDYC', 'WB/WT', 'EWBE', 'SCYC', 'HOLD', 'HLDA', 'BOFF', 'AHOLD', 'BREQ', 'EADS', 'HIT', 'HITM', 'INV', 'FLUSH',
  'SMI', 'SMIACT', 'BUSCHK', 'IERR', 'PRDY', 'R/S', 'DP0', 'DP1', 'DP2', 'DP3', 'DP4', 'DP5', 'DP6', 'DP7', 'PCHK', 'PEN']);
const D586_CR4 = [['TSD', 2], ['DE', 3], ['PSE', 4], ['MCE', 6]];
const D586_FAST_MS = 100;              // fast mode: the time between two drawn frames of the die
const D586_MESI = ['I', 'S', 'E', 'M'];
const D586_STAGES = [['PF', 'prefetch'], ['D1', 'decode 1'], ['D2', 'decode 2'], ['EX', 'execute'], ['WB', 'write back']];
const D586_BTBSTATE = ['strongly not taken', 'weakly not taken', 'weakly taken', 'strongly taken'];
// The pair rules of the D1 stage (the chips in the decoder) and the words of the reasons.
const D586_RULES = [['SIMPLE', /simple/], ['PREFIX', /prefix/], ['DISP+IMM', /displacement/], ['QUEUE', /queue/], ['REGS', /reads|both write/], ['PIPE', /jump|only into|FPU/]];
const DIE586_INFO = {
  icache: ['Code cache, 8 KB', 'The code cache holds the instructions: 128 sets of 2 ways, 32 bytes in each line. Bits 5 to 11 of the physical address select the set, and the cache compares the two tags of the set at the same time. The prefetcher reads up to 16 bytes from a line in one clock. A miss fills the line from memory in a burst of 4 transfers of 8 bytes. Code lines are only S (valid) or I (invalid).'],
  itlb: ['Code TLB', 'The TLB of the prefetcher: 32 entries in 8 sets of 4 ways (bits 12 to 14 of the linear address select the set). The code TLB keeps a 4 MB page as a 4 KB entry. Each cell is one entry; a bright cell is valid.'],
  btb: ['Branch target buffer', 'The BTB keeps 256 branches: 64 sets of 4 ways (bits 2 to 7 of the address of the branch select the set). Each entry has the target and a 2-bit counter: 0 strongly not taken, 1 weakly not taken, 2 weakly taken, 3 strongly taken. In D1 the prefetcher finds each branch in the BTB. A hit with a counter of 2 or 3 predicts "taken", and the second prefetch buffer starts to read from the target. A wrong prediction flushes the pipes: 3 clocks in the U pipe, 4 clocks in the V pipe. The colour of a cell is the counter.'],
  biu: ['Bus interface, 64 bits', 'The P5 moves 8 bytes in each transfer on D63 to D0. A31 to A3 give the address of the 8 bytes, BE7# to BE0# select the bytes. A line fill is a burst of 4 transfers (the 8 bytes that the CPU needs come first) with the 2-1-1-1 timing: ADS# starts it, BRDY# ends each transfer. CACHE# and KEN# make a read a line fill. A write-back of an M line is the same burst in the other direction. This board does not use NA# (the next address).'],
  pfb: ['Prefetch buffers', 'Two prefetch buffers of 32 bytes: one reads the code in sequence, the other reads from the target that the BTB predicts. The chips show the bytes of the active buffer (the queue of the core). A code-cache hit gives up to 16 bytes in one clock and needs no bus cycle.'],
  dec: ['Instruction decode (D1 and D2)', 'D1 has two decoders. They look at two instructions at the same time and check the pair rules: both instructions are simple, no prefix, not both a displacement and an immediate, the second one is all in the buffer, and no register dependency (V does not read or write a register that U writes). When all rules are true, the first instruction goes into the U pipe and the second into the V pipe in the same clock. D2 calculates the addresses of the memory operands.'],
  upipe: ['U pipe', 'The U pipe runs all instructions: the simple ones in 1 clock, the others from the microcode. The five stages: PF prefetch, D1 decode 1, D2 decode 2 (address), EX execute (the ALU and the data cache), WB write back. The text of each instruction moves one stage down for each clock group.'],
  vpipe: ['V pipe', 'The V pipe runs only the simple instructions, and only when the instruction pairs with the instruction in the U pipe. Then the two instructions go through the stages together. When an instruction does not pair, the V pipe is empty for that clock and the reason shows here.'],
  rom: ['Control ROM', 'The microcode ROM controls the complex instructions step by step in the U pipe (and in the V pipe for some steps). The simple instructions have hard-wired control. CR0 and CR4 are the control registers: CR4 has TSD (RDTSC only at CPL 0), DE (debug extensions), PSE (4 MB pages) and MCE (machine check). The TSC counts each clock of the CPU. TR12 turns off the branch prediction (NBP), the V pipe (SE) or the line fills (CI).'],
  dcache: ['Data cache, 8 KB', 'The data cache: 128 sets of 2 ways, 32 bytes in each line, write-back. Each line has a MESI state: M modified (the line has newer data than memory), E exclusive (the same as memory, only in this cache), S shared, I invalid. A write hit to an E line makes it M with no bus cycle. A fill that replaces an M line writes that line back to memory in a burst. The U pipe and the V pipe can use the cache in the same clock.'],
  dtlb: ['Data TLBs', 'Two TLBs for the data: 64 entries for 4 KB pages (16 sets of 4 ways) and 8 entries for 4 MB pages (2 sets of 4 ways). With CR4.PSE = 1 a page directory entry with PS = 1 maps a 4 MB page, and one TLB entry covers all of it. A gold cell is a dirty page.'],
  walker: ['Page unit', 'On a TLB miss the page unit reads the page directory entry (CR3 + DIR × 4) and then the page table entry, through the data cache. A PDE with PS = 1 (CR4.PSE = 1) is a 4 MB page: the frame comes from the PDE, and the offset has 22 bits. The page unit sets the accessed bit and the dirty bit. A page that is not there gives #PF.'],
  regs: ['Integer register file', 'The eight 32-bit registers. The U pipe and the V pipe read and write them in the same clock (the file has more ports than the 486 file). The dim digits are bits 31 to 16. EFLAGS is at the bottom.'],
  seg: ['Segment unit', 'The segment registers and the address adders of D2: the linear address = the segment base + the offset. The P5 has one address adder for each pipe.'],
  alu: ['ALUs of the U and V pipes', 'Each pipe has its own ALU. The two ALUs work in the same clock on the two instructions of a pair. The ALU of the pipe that runs the instruction shows its operands and its result.'],
  barrel: ['Barrel shifter', 'The barrel shifter is in the U pipe only: a shift or a rotate by 1 or by an immediate count pairs only in the U pipe. It moves a value by any count in one clock. A shift by CL is not simple and does not pair.'],
  fstk: ['FPU registers', 'The floating-point unit is on the chip. Eight 80-bit registers make a stack; TOP selects the register that is ST(0). The colour bar shows the tag: valid, zero, special or empty. The exponent and the mantissa of ST(0) show at the right.'],
  fpx: ['FPU pipeline and units', 'The FPU uses the first four stages of the U pipe (PF D1 D2 EX) and has three more: X1 and X2 (execute), WF (write the result) and ER (error report). The adder, the multiplier and the divider are separate units. FADD and FMUL take 3 clocks, FDIV 39 clocks (a radix-4 SRT divider). FXCH pairs in the V pipe with a simple FPU instruction in the U pipe, so it takes no more time.'],
  flags: ['EFLAGS', 'The flags of the 80486 (with AC and ID). CPUID works because a program can change ID. The P5 adds VIP and VIF for the virtual-8086 extensions, which this core does not have.'],
  pads: ['Pads (273 pins in the package)', 'A31-A3, BE7#-BE0#, D63-D0 with parity, ADS#, BRDY#, NA#, KEN#, CACHE#, M/IO#, D/C#, W/R#, LOCK#, the snoop pins (HIT#, HITM#, EADS#, INV), the SMM pins, FERR# and IGNNE#, INTR, NMI, RESET and CLK. This board does not use the dim pads.'],
};
// Double-click: the block label on the Pentium floor plan of the 3D board.
const DIE586_3D = {
  icache: ['cpu', 'CODE CACHE 8 KB'], itlb: ['cpu', 'CODE TLB'], btb: ['cpu', 'BRANCH TARGET BUFFER'], biu: ['cpu', 'BUS INTERFACE'],
  pfb: ['cpu', 'PREFETCH BUFFERS'], dec: ['cpu', 'INSTRUCTION DECODE'], rom: ['cpu', 'CONTROL ROM'], dcache: ['cpu', 'DATA CACHE 8 KB'],
  dtlb: ['cpu', 'DATA TLB'], walker: ['cpu', 'PAGE UNIT'], upipe: ['cpu', 'U PIPE'], vpipe: ['cpu', 'V PIPE'], regs: ['cpu', 'REGISTERS'],
  flags: ['cpu', 'REGISTERS'], seg: ['cpu', 'SEGMENT UNIT'], alu: ['cpu', 'ALU'], barrel: ['cpu', 'BARREL SHIFTER'], fstk: ['cpu', 'FPU REGISTERS'],
  fpx: ['cpu', 'FPU ADDER'], pads: ['cpu', null],
};
// 'wide' has room for the legend at the right; 'row' has no legend; 'tall' uses the portrait plan.
const DIE586_LAYOUTS = {
  wide: { W: 2080, H: 1040, p86: [20, 20], p87: [0, 0], side: 'left', up: false, legend: [1560, 330], keep: [[60, 60, 1420, 920]] },
  row: { W: 1540, H: 1040, p86: [20, 20], p87: [0, 0], side: 'left', up: false, legend: null, keep: [[60, 60, 1420, 920]] },
  tall: { W: 1186, H: 1382, p86: [20, 20], p87: [0, 0], side: 'top', up: false, legend: null, keep: [[60, 60, 1066, 1262]] },
};
// Token end points: the unit, a point on the edge of the block ('L' coordinates) and how the
// point goes to the internal buses: 'dn' down to the bus below, 'up' up to the bus above, 'gl' /
// 'gr' to the gutter at the left / right of the block (x) and then to the nearest bus.
const D586_PTS = {
  icache: ['cc', 376, 200, 'gr', 382], itlb: ['ct', 388, 98, 'gl', 382], btb: ['ct', 493, 356, 'dn'],
  biu: ['fe', 610, 124, 'gl', 604], pfb: ['fe', 725, 356, 'dn'], dec: ['fe', 970, 356, 'dn'], rom: ['rom', 1102, 250, 'gl', 1096],
  dcache: ['dc', 376, 470, 'gr', 382], dtlb: ['dt', 388, 460, 'gl', 382], walker: ['dt', 493, 684, 'dn'],
  upipe: ['pp', 727, 384, 'up'], vpipe: ['pp', 973, 384, 'up'], regs: ['rg', 1102, 470, 'gl', 1096], flags: ['rg', 1102, 572, 'gl', 1096],
  seg: ['rg', 1102, 640, 'gl', 1096], aluU: ['ex', 134, 712, 'up'], aluV: ['ex', 294, 712, 'up'], barrel: ['ex', 493, 712, 'up'],
  fstk: ['ex', 700, 712, 'up'], fpx: ['fx', 1102, 800, 'gl', 1096],
};
// the names of the older views (486, 386 code) for the same end points
const D586_ALIAS = {
  cache: 'icache', xcvr: 'biu', ring: 'biu', addrdrv: 'biu', addr4: 'biu', latch: 'biu', burst: 'biu', wbuf: 'biu', lfill: 'biu',
  pfq: 'pfb', qhead: 'pfb', pfa: 'pfb', iq: 'dec', EIP: 'dec', ctl: 'rom', cr: 'rom', sys: 'rom', prot: 'rom', ctag: 'dcache',
  tlb: 'dtlb', pgadd: 'walker', linadd: 'seg', sigma: 'seg', limchk: 'seg', desc: 'seg', fman: 'fpx', fexp: 'fpx',
  ES: 'seg', CS: 'seg', SS: 'seg', DS: 'seg', FS: 'seg', GS: 'seg',
};

class Die586View extends Die486View {
  constructor(host, app) {
    super(host, app);
    if (!document.getElementById('dv-style-586')) {
      htmlEl('style', { id: 'dv-style-586' }, document.head, `:root.m586 .dv-cell.dv-bad rect{fill:${dvMix(THEME.magenta, THEME.panel, 0.7)};stroke:var(--magenta)}
:root.m586 .dv-cell.dv-bad text.dv-b{fill:var(--text)}`);
    }
    this.svg.setAttribute('aria-label', 'Die floor plan of the Pentium CPU: two caches, two pipes, the branch target buffer and the FPU on one chip. The plus and minus keys zoom, the 0 key fits the die.');
  }
  info(id) { return DIE586_INFO[id] || DIE486_INFO[id] || DIE386_INFO[id] || DIE286_INFO[id] || DIE_INFO[id]; }
  map3D() { return DIE586_3D; }
  layoutSet() { return DIE586_LAYOUTS; }
  get fpuName() { return 'FPU'; }
  // the active prefetch buffer: 32 bytes in four rows of 8 chips
  get QN() { return 32; }
  get QX0() { return 632; }
  get QDX() { return 25; }
  get QY() { return 232; }
  get QH() { return 20; }
  get QW() { return 22; }
  get QF() { return 10; }
  qx(slot) { return this.QX0 + (slot % 8) * this.QDX; }
  qy(slot) { return this.QY + Math.floor(slot / 8) * 27; }
  legendSub() { return `Intel Pentium (P5): two pipes, BTB, two 8 KB caches, FPU, ${this.mhz()}, 64-bit bus`; }
  cacheObj() { return null; }
  // The view state of the Pentium parts (only the view writes it).
  p5State() {
    return {
      pipe: 'U',
      pp: { cur: { u: '', v: '', paired: false, why: '', vOn: false, uClk: 0, vClk: 0, uAlu: null, vAlu: null }, prev: { u: '', v: '' }, oldWb: { u: '', v: '' }, next: ['', '', ''], anim: null, grp: false },
      acc: { i: null, d: null }, fill: { i: null, d: null }, btbE: null, btbBefore: -1, tlbLast: null, alu: { U: null, V: null }, fpuP: null,
      btbShadow: new Uint8Array(256), btbTag: new Int32Array(256).fill(-1),
    };
  }

  // ---------- machine state ----------
  readMachine() {
    super.readMachine();
    const c = this.m.cpu;
    if (this.mdl.sys) { this.mdl.sys.cr4 = c.cr[4] >>> 0; this.mdl.sys.tr12 = c.tr12 | 0; }
  }

  // ---------- the Pentium die ----------
  upt(u, x, y) { const o = this.arr.off[u]; return [x + o[0], y + o[1]]; }
  build86(g) {
    const E = this.els, P = dieP();
    if (!this.p5) this.p5 = this.p5State();
    this.walkBig = null;
    const A = this.arr = D586_ARR[this.kind === 'tall' ? 'P' : 'L'], W = A.W, H = A.H;
    this.g86 = g;
    E.desc = {};
    svgEl('rect', { x: -6, y: -6, width: W + 12, height: H + 12, rx: 10, fill: P.dieShadow, stroke: THEME.line }, g);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 4, fill: 'url(#dv-si)' }, g);
    const tex = DieView.texture(W, H, 80586);
    if (tex) svgEl('image', { href: tex, x: 0, y: 0, width: W, height: H, 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 4, fill: 'url(#dv-sheen)', 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 3.5, y: 3.5, width: W - 7, height: H - 7, rx: 3, fill: 'none', stroke: P.scribe, 'stroke-width': 1, opacity: 0.6 }, g);
    E.ring = svgEl('rect', { x: 38, y: 38, width: W - 76, height: H - 76, rx: 8, fill: 'none', stroke: P.scribe, 'stroke-width': 3, opacity: 0.55 }, g);
    // buses under the blocks: the gaps between the rows, the spines between the gaps and a stub for each end point
    const bus = (d, col, w, op) => svgEl('path', { d, class: 'dv-bus', stroke: col, 'stroke-width': w, opacity: op }, g);
    const G = A.gaps;
    E.gBus = bus(G.map(y => `M50 ${y}H${W - 50}`).join('') + A.spines.map(x => `M${x} ${G[0]}V${G[G.length - 1]}`).join(''), P.busMain, 5, 0.55);
    const stubs = [];
    for (const k in D586_PTS) {
      const p = this.point(k);
      if (p) stubs.push('M' + p.pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L'));
    }
    bus(stubs.join(''), P.busMain, 2.2, 0.45);
    this.txt(g, 'INTERNAL BUS 64', W - 56, G[0] - 5, 10, 'dv-m', 'end');
    this.txt(g, 'DATA BUS 64 · CACHE BUS 256', 60, G[1] - 5, 10, 'dv-m');
    // the units: each one is a group that the floor plan moves
    const regPG = dvMix(THEME.magenta, THEME.void, 0.55), regC = dvMix(THEME.cyan, THEME.void, 0.45);
    const unit = u => svgEl('g', { transform: `translate(${A.off[u][0]} ${A.off[u][1]})` }, g);
    const region = (p, x, y, w, h, col, fill) => svgEl('rect', { x, y, width: w, height: h, rx: 2, fill, stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': '6 5', opacity: 0.85 }, p);
    const tab = (p, x, y, t, col) => {
      const w = strokeTextWidth(t, 9, 1.4) + 14;
      svgEl('rect', { x, y: y - 8, width: w, height: 16, rx: 3, fill: P.tabFill, stroke: col, 'stroke-width': 1.2 }, p);
      this.silk(p, t, x + 7, y - 4.5, 9, 'dv-silk');
    };
    const UNITS = [
      ['cc', [48, 48, 336, 316], regC, dvA(THEME.gold, 0.03), 'CODE CACHE', 62, 48],
      ['ct', [384, 48, 222, 316], regPG, dvA(THEME.magenta, 0.025), 'BRANCH PREDICTION', 396, 48],
      ['fe', [606, 48, 490, 316], P.regBU, dvA(THEME.gold, 0.025), 'BUS AND FRONT END', 618, 48],
      ['rom', [1098, 48, 352, 316], P.regEU, dvA(THEME.phosphor, 0.02), 'CONTROL', 1110, 48],
      ['dc', [48, 376, 336, 316], regC, dvA(THEME.cyan, 0.03), 'DATA CACHE', 62, 376],
      ['dt', [384, 376, 222, 316], regPG, dvA(THEME.magenta, 0.025), 'PAGING', 396, 376],
      ['pp', [606, 376, 490, 316], P.regBIU, dvA(THEME.cyan, 0.025), 'INTEGER PIPES', 618, 376],
      ['rg', [1098, 376, 352, 316], P.regEU, dvA(THEME.phosphor, 0.025), 'REGISTERS', 1110, 376],
      ['ex', [48, 704, 1048, 248], P.regEU, dvA(THEME.phosphor, 0.02), 'EXECUTION UNITS', 62, 704],
      ['fx', [1098, 704, 352, 248], P.regAU, dvA(THEME.lavender, 0.035), 'FLOATING-POINT UNIT', 1110, 704],
    ];
    const U = {};
    for (const [u, r, col, fill] of UNITS) { U[u] = unit(u); region(U[u], r[0], r[1], r[2], r[3], col, fill); }
    this.buildCache586(U.cc, 'i', 56); this.buildTlbI586(U.ct); this.buildBtb586(U.ct);
    this.buildBiu586(U.fe); this.buildPfb586(U.fe); this.buildDec586(U.fe); this.buildRom586(U.rom);
    this.buildCache586(U.dc, 'd', 384); this.buildTlbD586(U.dt); this.buildWalker586(U.dt);
    this.buildPipes586(U.pp); this.buildRegs586(U.rg); this.buildSeg586(U.rg);
    this.buildAlu586(U.ex); this.buildBarrel586(U.ex); this.buildFstk586(U.ex); this.buildFpx586(U.fx);
    for (const [u, , col, , t, tx, ty] of UNITS) tab(U[u], tx, ty, t, col);
    this.buildPads586(g);
    this.buildOverlay486(g);
    this.tokLayer = svgEl('g', { class: 'dv-toks', 'pointer-events': 'none' }, g);
  }
  buildPads586(g) {
    const pg = this.block(g, 'pads', 0, 0, 0, 0, '');
    pg.querySelector('.dv-frame').setAttribute('display', 'none');
    const A = this.arr, [nT, nR] = A.pads;
    const sH = (A.W - 100) / nT, sV = (A.H - 100) / nR, bonds = [];
    const bondEl = svgEl('path', { d: '', stroke: dieP().bond, 'stroke-width': 1.1, opacity: 0.55, fill: 'none' }, pg);
    D586_PADS.forEach((name, i) => {
      const p = Die486View.padPos486(i, A);
      const out = 9;
      const [bx, by] = p.side === 'l' ? [-out, p.y] : p.side === 'r' ? [A.W + out, p.y] : p.side === 't' ? [p.x, -out] : [p.x, A.H + out];
      bonds.push(`M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`);
      const cls = 'dv-pad' + (name === 'NC' || D586_UNUSED.has(name) ? ' dv-nc' : '');
      const c = svgEl('g', { class: cls }, pg);
      const w = p.v ? 22 : Math.min(31, sH - 3), h = p.v ? Math.min(30, sV - 3) : 22;
      svgEl('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 3 }, c);
      const size = name.length > 5 ? 5.4 : name.length > 4 ? 6.2 : name.length > 3 ? 7 : 7.8;
      const t = this.txt(c, name, p.x, p.y + size * 0.36, size, '', 'middle', p.v ? { transform: `rotate(-90 ${p.x} ${p.y})` } : null);
      t.removeAttribute('class');
      svgEl('title', null, c).textContent = name + (D586_LOW.has(name) ? '# (active low)' : '') + (D586_UNUSED.has(name) ? ': this board does not use it' : '');
      this.els.pads.push({ c, name, p, base: cls });
    });
    bondEl.setAttribute('d', bonds.join(''));
  }
  // ---- the two caches (k = 'i' code, 'd' data; y0 = the top of the block) ----
  buildCache586(g, k, y0) {
    const code = k === 'i', id = code ? 'icache' : 'dcache', P = dieP(), E = this.els;
    const b = this.block(g, id, 56, y0, 320, 300, code ? 'CODE CACHE 8 KB' : 'DATA CACHE 8 KB');
    this.txt(b, '128 SETS × 2 WAYS · 32 B', 368, y0 + 16, 7.5, 'dv-f', 'end');
    const gx0 = 82, gy0 = y0 + 32, cw = 34, ch = 9.2;
    const C = E[k + 'C'] = { gx0, gy0, cw, ch, grid: null };
    for (let col = 0; col < 8; col++) this.txt(b, '+' + col, gx0 + col * cw + 16, gy0 - 3, 6.5, 'dv-f', 'middle');
    for (let row = 0; row < 16; row++) this.txt(b, hex2(row * 8), gx0 - 4, gy0 + row * ch + 7, 6.5, 'dv-f', 'end');
    // the 256 lines: one path for each state (a few draw calls, not 256 elements)
    const geo = [];
    for (let s = 0; s < 128; s++) {
      const x0 = gx0 + (s & 7) * cw, yy = gy0 + (s >> 3) * ch;
      for (let w = 0; w < 2; w++) geo.push([x0 + w * 16, yy, 15, 7.8]);
    }
    const mx = (col, t) => [dvMix(col, THEME.panel, t), dvMix(col, THEME.panel, 0.1)];
    C.grid = this.mkGrid(b, geo, code ? [[P.row0, P.cellStroke], mx(THEME.gold, 0.25), [THEME.goldHi, THEME.goldHi]]
      : [[P.row0, P.cellStroke], mx(THEME.cyan, 0.4), mx(THEME.phosphor, 0.4), mx(THEME.magenta, 0.25), [THEME.goldHi, THEME.goldHi]]);
    C.setMark = svgEl('rect', { x: gx0 - 1.5, y: gy0 - 1.2, width: 33, height: 10.2, rx: 2, fill: 'none', stroke: THEME.cyan, 'stroke-width': 1.2, opacity: 0, 'pointer-events': 'none' }, b);
    C.setFl = svgEl('rect', { x: gx0 - 1.5, y: gy0 - 1.2, width: 33, height: 10.2, rx: 2, fill: dvA(THEME.cyan, 0.3), stroke: THEME.cyan, 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }, b);
    C.wayFl = svgEl('rect', { x: gx0 - 1, y: gy0 - 1, width: 17, height: 9.8, rx: 1.5, fill: dvA(THEME.phosphor, 0.5), stroke: THEME.phosphor, 'stroke-width': 1.6, opacity: 0, 'pointer-events': 'none' }, b);
    // tag compare: the address in three parts, the two ways of the set, the result
    const ty = y0 + 186;
    C.addr = this.txt(b, '--------', 64, ty + 14, 11, 'dv-cy', 'start', { 'font-weight': 700 });
    const box = (x, w, lab, col) => {
      svgEl('rect', { x, y: ty, width: w, height: 20, rx: 3, fill: P.row1, stroke: col, 'stroke-width': 1 }, b);
      this.txt(b, lab, x + w / 2, ty + 6.5, 5.5, 'dv-f', 'middle');
      return this.txt(b, '--', x + w / 2, ty + 17, 9, 'dv-v', 'middle', { 'font-weight': 700 });
    };
    C.tag = box(176, 66, 'TAG 31–12', THEME.cyan);
    C.set = box(246, 44, 'SET 11–5', THEME.magenta);
    C.ofs = box(294, 44, 'OFFSET 4–0', THEME.gold);
    C.ways = [0, 1].map(w => {
      const yy = ty + 24 + w * 15;
      const bg = svgEl('rect', { x: 62, y: yy, width: 306, height: 13.4, rx: 3, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      this.txt(b, 'WAY ' + w, 67, yy + 10, 8, 'dv-m', 'start', { 'font-weight': 700 });
      const t = this.txt(b, '-----', 108, yy + 10.2, 9, 'dv-f', 'start', { 'font-weight': 600 });
      const st = this.txt(b, '', 166, yy + 10.2, 9, 'dv-f', 'start', { 'font-weight': 700 });
      const a = this.txt(b, '', 184, yy + 10, 7.5, 'dv-f');
      const m = this.txt(b, '', 362, yy + 10.2, 8.5, 'dv-f', 'end', { 'font-weight': 700 });
      return { bg, t, st, a, m };
    });
    C.res = this.txt(b, 'no access yet', 64, ty + 66, 10, 'dv-f', 'start', { 'font-weight': 700 });
    C.note = this.txt(b, '', 368, ty + 66, 7.5, 'dv-f', 'end');
    // the line fill (or the write-back): 4 transfers of 8 bytes in address order
    const fy = ty + 72;
    C.fill = [0, 1, 2, 3].map(d => {
      const x = 62 + d * 77;
      const r = svgEl('rect', { x, y: fy, width: 74, height: 34, rx: 3, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      const o = this.txt(b, '+' + hex2(d * 8), x + 4, fy + 9, 6.5, 'dv-f');
      const n = this.txt(b, '', x + 70, fy + 9, 6.5, 'dv-f', 'end', { 'font-weight': 700 });
      const l1 = this.txt(b, '', x + 37, fy + 20, 7.8, 'dv-f', 'middle', { 'font-weight': 600 });
      const l2 = this.txt(b, '', x + 37, fy + 30, 7.8, 'dv-f', 'middle', { 'font-weight': 600 });
      return { r, o, n, l1, l2 };
    });
    C.fillFl = this.flashRect(b, 60, fy - 2, 312, 38, dvA(THEME.gold, 0.16));
    C.tagFl = this.flashRect(b, 60, ty - 2, 312, 60, dvA(THEME.cyan, 0.14));
  }
  // ---- branch prediction: the code TLB and the BTB ----
  buildTlbI586(g) {
    const b = this.block(g, 'itlb', 388, 56, 210, 84, 'CODE TLB');
    const P = dieP(), E = this.els;
    this.txt(b, '8 SETS × 4 WAYS', 590, 72, 6.5, 'dv-f', 'end');
    const geo = [];
    for (let s = 0; s < 8; s++) {
      this.txt(b, String(s), 404 + s * 23.5 + 10, 84, 6, 'dv-f', 'middle');
      for (let w = 0; w < 4; w++) geo.push([404 + s * 23.5, 88 + w * 9.4, 21, 8]);
    }
    E.itlb = this.mkGrid(b, geo, this.tlbStyles());
    // the cells are set-major: entry set * 4 + way is E.itlb[set * 4 + way]
    E.itlbNote = this.txt(b, 'paging off', 396, 135, 7.5, 'dv-f');
  }
  buildBtb586(g) {
    const b = this.block(g, 'btb', 388, 150, 210, 206, 'BRANCH TARGET BUFFER');
    const P = dieP(), E = this.els;
    const gx0 = 404, gy0 = 180, sw = 47, cw = 11, ch = 7.6;
    E.btbG = { gx0, gy0, sw, cw, ch };
    for (let r = 0; r < 16; r++) this.txt(b, hex2(r * 4), gx0 - 3, gy0 + r * ch + 6, 5.5, 'dv-f', 'end');
    const geo = [];
    for (let s = 0; s < 64; s++) {
      const x0 = gx0 + (s & 3) * sw, y0 = gy0 + (s >> 2) * ch;
      for (let w = 0; w < 4; w++) geo.push([x0 + w * cw, y0, cw - 1.5, ch - 1.4]);
    }
    const bs = dvMix(THEME.gold, THEME.panel, 0.4);
    E.btb = this.mkGrid(b, geo, [[P.row0, P.cellStroke], [this.btbCol(0), bs], [this.btbCol(1), bs], [this.btbCol(2), bs], [this.btbCol(3), bs]]);
    E.btbSet = svgEl('rect', { x: gx0 - 1.5, y: gy0 - 1, width: sw - 1, height: ch + 0.6, rx: 1.5, fill: 'none', stroke: THEME.gold, 'stroke-width': 1.2, opacity: 0, 'pointer-events': 'none' }, b);
    E.btbWayFl = svgEl('rect', { x: gx0 - 1, y: gy0 - 1, width: cw + 0.5, height: ch + 0.6, rx: 1.5, fill: dvA(THEME.phosphor, 0.5), stroke: THEME.phosphor, 'stroke-width': 1.4, opacity: 0, 'pointer-events': 'none' }, b);
    E.btbL1 = this.txt(b, 'no branch yet', 396, 313, 8.5, 'dv-f', 'start', { 'font-weight': 700 });
    E.btbL2 = this.txt(b, '', 396, 326, 8, 'dv-m');
    E.btbL3 = this.txt(b, '', 396, 339, 8.5, 'dv-f', 'start', { 'font-weight': 700 });
    E.btbSt = this.txt(b, '', 396, 351, 7, 'dv-f');
    E.btbFl = this.flashRect(b, 390, 302, 206, 52, dvA(THEME.gold, 0.14));
  }
  // ---- the front end: the bus interface, the prefetch buffers, the decoder ----
  buildBiu586(g) {
    const b = this.block(g, 'biu', 610, 56, 480, 134, 'BUS INTERFACE · 64-BIT DATA BUS');
    const E = this.els, P = dieP();
    E.bcType = this.txt(b, 'IDLE', 618, 94, 12, 'dv-m', 'start', { 'font-weight': 700 });
    E.bcBits = ['M/IO', 'D/C', 'W/R'].map((n, i) => {
      const x = 1000 + i * 30;
      this.txt(b, n, x, 72, 6.5, 'dv-m', 'middle');
      return this.txt(b, '·', x, 84, 10.5, 'dv-mg', 'middle', { 'font-weight': 700 });
    });
    E.bcT = ['T1', 'T2'].map((n, i) => {
      const c = svgEl('g', { class: 'dv-tstate' }, b);
      svgEl('rect', { x: 924 + i * 30, y: 83, width: 27, height: 14, rx: 3 }, c);
      this.txt(c, n, 937.5 + i * 30, 93.5, 8, 'dv-m', 'middle', { 'font-weight': 700 });
      return c;
    });
    E.laA = this.txt(b, 'A --------', 618, 118, 13, 'dv-cy', 'start', { 'font-weight': 700 });
    this.txt(b, 'A31–A3', 618, 128, 6.5, 'dv-f');
    this.txt(b, 'BE7#–BE0#', 780, 107, 6.5, 'dv-f');
    E.beL = [7, 6, 5, 4, 3, 2, 1, 0].map((n, i) => {
      const x = 784 + i * 17;
      const c = svgEl('circle', { cx: x, cy: 116, r: 4.3, fill: P.dot }, b);
      this.txt(b, String(n), x, 128, 6, 'dv-m', 'middle', { 'font-weight': 700 });
      return c;
    });
    E.bl = {};
    ['ADS', 'NA', 'BRDY', 'CACHE', 'KEN'].forEach((n, i) => {
      const x = 934 + (i % 3) * 52, y = 110 + Math.floor(i / 3) * 14;
      E.bl[n] = svgEl('circle', { cx: x, cy: y, r: 4, fill: P.dot }, b);
      this.txt(b, n, x + 7, y + 3.2, 7.5, 'dv-m', 'start', { 'font-weight': 700 });
    });
    // D63-D0: the 8 byte lanes (lane 7 at the left)
    this.txt(b, 'D63', 618, 144, 6.5, 'dv-f');
    this.txt(b, 'D0', 918, 144, 6.5, 'dv-f', 'end');
    E.lane = [7, 6, 5, 4, 3, 2, 1, 0].map((n, i) => {
      const x = 618 + i * 37.5;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y: 148, width: 35, height: 18, rx: 3 }, c);
      const t = this.txt(c, '··', x + 17.5, 161, 10, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, t, n };
    });
    E.xcDir = this.txt(b, '', 618, 182, 8, 'dv-m');
    E.beat = [0, 1, 2, 3].map(i => {
      const x = 934 + i * 38;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y: 148, width: 35, height: 18, rx: 3 }, c);
      this.txt(c, String(i + 1), x + 17.5, 161, 9, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return c;
    });
    ['2', '1', '1', '1'].forEach((s, d) => this.txt(b, s + (d ? '' : ' clk'), 934 + d * 38 + 17.5, 177, 6.5, 'dv-f', 'middle'));
    E.bcPipe = this.txt(b, '', 1082, 186, 7, 'dv-f', 'end');
    E.buFl = this.flashRect(b, 612, 58, 476, 130, dvA(THEME.magenta, 0.1));
  }
  buildPfb586(g) {
    const b = this.block(g, 'pfb', 610, 202, 230, 154, 'PREFETCH BUFFERS');
    const P = dieP();
    for (let i = 0; i < 32; i++) {
      svgEl('rect', { x: this.qx(i) - this.QW / 2, y: this.qy(i), width: this.QW, height: this.QH, rx: 3, fill: 'none', stroke: P.cellStroke, 'stroke-dasharray': '3 3' }, b);
    }
    for (let r = 0; r < 4; r++) this.txt(b, String(r * 8), 616, this.qy(r * 8) + 13, 6.5, 'dv-f');
    this.txt(b, 'D1 ◀ head', 618, 348, 8, 'dv-ph', 'start', { 'font-weight': 700 });
    this.els.qCount = this.txt(b, '0/32', 718, 348, 8.5, 'dv-m', 'start', { 'font-weight': 700 });
    this.els.pfB = this.txt(b, 'B: idle', 834, 348, 7.5, 'dv-f', 'end');
    this.els.pfBFl = this.flashRect(b, 758, 338, 80, 14, dvA(THEME.gold, 0.3));
    this.chipLayer = svgEl('g', { 'pointer-events': 'none' }, b);
  }
  buildDec586(g) {
    const b = this.block(g, 'dec', 852, 202, 238, 154, 'INSTRUCTION DECODE');
    const E = this.els, P = dieP();
    this.txt(b, 'D1: two decoders and the pair check', 860, 232, 7, 'dv-f');
    const row = (y, n, col) => {
      svgEl('rect', { x: 860, y, width: 222, height: 17, rx: 3, fill: P.row1, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      svgEl('rect', { x: 862, y: y + 2, width: 14, height: 13, rx: 2.5, fill: dvA(col, 0.25), stroke: col, 'stroke-width': 1 }, b);
      this.txt(b, n, 869, y + 12, 9, 'dv-v', 'middle', { 'font-weight': 700 });
      return this.txt(b, '', 882, y + 12.5, 10, 'dv-f', 'start', { 'font-weight': 700 });
    };
    E.dU = row(238, 'U', THEME.phosphor);
    E.dV = row(258, 'V', THEME.cyan);
    E.decFl = this.flashRect(b, 858, 236, 226, 40, dvA(THEME.phosphor, 0.14));
    E.dVerdict = this.txt(b, '', 860, 292, 11, 'dv-f', 'start', { 'font-weight': 700 });
    E.dClk = this.txt(b, '', 1082, 292, 8, 'dv-m', 'end', { 'font-weight': 600 });
    E.dWhy = this.txt(b, '', 860, 304, 7.8, 'dv-m');
    E.dWhy2 = this.txt(b, '', 860, 314, 7.8, 'dv-m');
    E.dRules = D586_RULES.map(([n], i) => {
      const x = 860 + i * 37.3;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      const r = svgEl('rect', { x, y: 320, width: 35, height: 13, rx: 2.5 }, c);
      const t = this.txt(c, n, x + 17.5, 329.5, n.length > 6 ? 5.2 : 6.2, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, r, t };
    });
    this.txt(b, 'EIP', 860, 348, 8, 'dv-m', 'start', { 'font-weight': 700 });
    const ip = this.txt(b, '00000000', 878, 348, 9, 'dv-ph', 'start', { 'font-weight': 700 });
    const ipFl = this.flashRect(b, 856, 338, 80, 14, dvA(THEME.phosphor, 0.2));
    E.regs.EIP = { lo: ip, fl: ipFl, y: 344, x: 852 };
    E.decBytes = this.txt(b, '', 1082, 348, 7.5, 'dv-go', 'end', { 'font-weight': 600 });
  }
  // ---- the control ROM, CR0, CR4, the TSC ----
  buildRom586(g) {
    const b = this.block(g, 'rom', 1102, 56, 340, 300, 'CONTROL ROM');
    const E = this.els, P = dieP();
    svgEl('rect', { x: 1110, y: 80, width: 324, height: 58, fill: 'url(#dv-rom)', stroke: P.cellStroke }, b);
    E.romRow = svgEl('rect', { x: 1110, y: 80, width: 14, height: 58, fill: dvA(THEME.phosphor, 0.6), opacity: 0 }, b);
    this.txt(b, 'complex instructions: microcode · simple ones: hard-wired', 1110, 150, 7, 'dv-f');
    E.crBits = D486_CR0.map(([n, bit], i) => {
      const x = 1110 + i * 29.6;
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x, y: 158, width: 27.5, height: 18, rx: 3 }, c);
      this.txt(c, n, x + 13.75, 170.5, 8.5, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, bit };
    });
    E.cr4Bits = D586_CR4.map(([n, bit], i) => {
      const x = 1110 + i * 38;
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x, y: 182, width: 35, height: 18, rx: 3 }, c);
      this.txt(c, n, x + 17.5, 194.5, 8.5, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, bit };
    });
    E.cr4Hex = this.txt(b, 'CR4 00000000', 1434, 195, 9.5, 'dv-lv', 'end', { 'font-weight': 600 });
    E.cr0Hex = this.txt(b, 'CR0 00000000', 1110, 216, 9.5, 'dv-lv', 'start', { 'font-weight': 600 });
    E.cr3 = this.txt(b, 'CR3 00000000', 1434, 216, 9, 'dv-f', 'end');
    E.cr2 = this.txt(b, 'CR2 00000000', 1110, 230, 8.5, 'dv-f');
    E.prMode = this.txt(b, 'REAL · CPL 0', 1434, 230, 9, 'dv-lv', 'end', { 'font-weight': 700 });
    this.txt(b, 'TSC', 1110, 252, 9, 'dv-m', 'start', { 'font-weight': 700 });
    E.tsc = this.txt(b, '0', 1434, 253, 12, 'dv-go', 'end', { 'font-weight': 700 });
    E.tr12 = this.txt(b, '', 1110, 268, 8, 'dv-m');
    E.ccMode = this.txt(b, '', 1434, 268, 8, 'dv-m', 'end', { 'font-weight': 600 });
    this.txt(b, 'CLK', 1110, 288, 8.5, 'dv-m', 'start', { 'font-weight': 700 });
    E.clkDot = svgEl('circle', { cx: 1138, cy: 285, r: 4.4, fill: P.dot }, b);
    E.clkText = this.txt(b, this.mhz(), 1148, 288, 8.5, 'dv-f');
    E.decClk = this.txt(b, '', 1434, 288, 9, 'dv-m', 'end', { 'font-weight': 700 });
    E.intText = this.txt(b, '', 1434, 310, 9, 'dv-f', 'end', { 'font-weight': 700 });
    this.txt(b, 'last interrupt', 1110, 310, 7.5, 'dv-f');
    E.crFl = this.flashRect(b, 1106, 155, 332, 80, dvA(THEME.lavender, 0.22));
    E.intFl = this.flashRect(b, 1106, 299, 332, 16, dvA(THEME.magenta, 0.25));
    E.pairSt = this.txt(b, '', 1110, 332, 8, 'dv-m');
    E.pairSt2 = this.txt(b, '', 1110, 346, 8, 'dv-f');
  }
  // ---- paging: the data TLBs and the page unit ----
  buildTlbD586(g) {
    const b = this.block(g, 'dtlb', 388, 384, 210, 156, 'DATA TLB');
    const P = dieP(), E = this.els;
    this.txt(b, '4 KB PAGES · 16 SETS × 4 WAYS', 396, 414, 6.5, 'dv-f');
    const geo = [];
    for (let s = 0; s < 16; s++) {
      if (!(s & 3)) this.txt(b, String(s), 398 + s * 12.1 + 5, 424, 5.5, 'dv-f', 'middle');
      for (let w = 0; w < 4; w++) geo.push([398 + s * 12.1, 428 + w * 10, 10.6, 8.6]);
    }
    E.dtlb = this.mkGrid(b, geo, this.tlbStyles());
    this.txt(b, '4 MB PAGES · 2 SETS × 4 WAYS', 396, 482, 6.5, 'dv-f');
    const geo4 = [];
    for (let s = 0; s < 2; s++) for (let w = 0; w < 4; w++) geo4.push([398 + s * 98 + w * 23.5, 486, 21.5, 10]);
    E.dtlb4 = this.mkGrid(b, geo4, this.tlbStyles());
    E.tlbMark = svgEl('rect', { x: 0, y: 0, width: 12, height: 10, rx: 1.5, fill: dvA(THEME.phosphor, 0.45), stroke: THEME.phosphor, 'stroke-width': 1.4, opacity: 0, 'pointer-events': 'none' }, b);
    E.tlbLast = this.txt(b, '', 396, 514, 8, 'dv-m', 'start', { 'font-weight': 600 });
    E.tlbStat = this.txt(b, 'paging off', 396, 530, 7.5, 'dv-f');
  }
  buildWalker586(g) {
    const b = this.block(g, 'walker', 388, 552, 210, 132, 'PAGE UNIT');
    const E = this.els, P = dieP();
    E.wCr3 = this.txt(b, 'CR3 00000000', 590, 566, 7.5, 'dv-lv', 'end', { 'font-weight': 600 });
    const box = (lab, col) => {
      const r = svgEl('rect', { x: 0, y: 578, width: 10, height: 26, rx: 3, fill: P.row1, stroke: col, 'stroke-width': 1 }, b);
      const l = this.txt(b, lab, 0, 586, 5.8, 'dv-f', 'middle');
      const v = this.txt(b, '---', 0, 600, 10, 'dv-v', 'middle', { 'font-weight': 700 });
      return { r, l, v };
    };
    E.wBox = [box('DIR 31–22', THEME.lavender), box('TABLE 21–12', THEME.magenta), box('OFFSET 11–0', THEME.cyan)];
    E.wPde = this.txt(b, 'PDE --------', 396, 620, 8.5, 'dv-m');
    E.wPte = this.txt(b, 'PTE --------', 492, 620, 8.5, 'dv-m');
    E.wSt = this.txt(b, 'OFF', 590, 620, 9, 'dv-f', 'end', { 'font-weight': 700 });
    E.pgFrame = this.txt(b, 'paging off', 396, 638, 8, 'dv-m');
    this.txt(b, 'physical', 396, 656, 7.5, 'dv-f');
    E.pgPhys = this.txt(b, '--------', 590, 658, 12, 'dv-cy', 'end', { 'font-weight': 700 });
    E.wNote = this.txt(b, 'the walk reads through the data cache', 396, 676, 6.8, 'dv-f');
    E.walkFl = this.flashRect(b, 390, 554, 206, 128, dvA(THEME.lavender, 0.2));
  }
  // Place the three boxes of the walker: DIR / TABLE / OFFSET (4 KB) or DIR / OFFSET 21-0 (4 MB).
  placeWalkBoxes(big) {
    const E = this.els, B = E.wBox;
    if (!B || this.walkBig === big) return;
    this.walkBig = big;
    const spec = big ? [[396, 62], null, [462, 128]] : [[396, 62], [462, 62], [528, 62]];
    B.forEach((x, i) => {
      const s = spec[i];
      const disp = s ? '' : 'none';
      x.r.setAttribute('display', disp); x.l.setAttribute('display', disp); x.v.setAttribute('display', disp);
      if (!s) return;
      x.r.setAttribute('x', s[0]); x.r.setAttribute('width', s[1]);
      x.l.setAttribute('x', s[0] + s[1] / 2); x.v.setAttribute('x', s[0] + s[1] / 2);
    });
    this.setT(B[2].l, big ? 'OFFSET 21–0 (4 MB)' : 'OFFSET 11–0');
  }
  // ---- the two pipes ----
  buildPipes586(g) {
    const E = this.els, P = dieP();
    const X = { U: 610, V: 856 }, w = 234;
    E.pBox = {}; E.pT = {}; E.pL2 = {}; E.pStat = {}; E.pFl = {};
    const sy = k => 414 + k * 53;
    this.pipeGeo586 = { sy, x: { U: 620, V: 866 }, step: 53 };
    for (const p of ['U', 'V']) {
      const x0 = X[p], id = p === 'U' ? 'upipe' : 'vpipe';
      const b = this.block(g, id, x0, 384, w, 300, p + ' PIPE');
      E.pStat[p] = this.txt(b, '', x0 + w - 8, 398, 7.5, 'dv-f', 'end', { 'font-weight': 600 });
      E.pBox[p] = D586_STAGES.map(([n, t], k) => {
        const y = sy(k);
        const r = svgEl('rect', { x: x0 + 6, y, width: w - 12, height: 47, rx: 4, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 1 }, b);
        this.txt(b, n, x0 + 12, y + 11, 8.5, k === 3 ? 'dv-go' : 'dv-ph', 'start', { 'font-weight': 700 });
        this.txt(b, t, x0 + w - 12, y + 11, 6.5, 'dv-f', 'end');
        if (k < 4) this.txt(b, '▼', x0 + w / 2, y + 51.5, 5.5, 'dv-f', 'middle');
        return r;
      });
      E.pL2[p] = this.txt(b, '', x0 + 12, sy(3) + 40, 8, 'dv-m');
      E.pFl[p] = this.flashRect(b, x0 + 6, sy(3), w - 12, 47, dvA(p === 'U' ? THEME.phosphor : THEME.cyan, 0.16));
    }
    // the texts that move: one layer with a clip for both pipes (a partner moves from U to V)
    const cid = 'dv-p5clip' + Math.random().toString(36).slice(2, 8);
    const cp = svgEl('clipPath', { id: cid }, g);
    svgEl('rect', { x: 614, y: sy(0), width: 472, height: 5 * 53 - 6 }, cp);
    const lay = svgEl('g', { 'clip-path': `url(#${cid})`, 'pointer-events': 'none' }, g);
    for (const p of ['U', 'V']) E.pT[p] = [0, 1, 2, 3, 4].map(() => this.txt(lay, '', 0, 0, 10.5, 'dv-v', 'start', { 'font-weight': 600 }));
    E.pGhost = { U: this.txt(lay, '', 0, 0, 10.5, 'dv-m', 'start', { 'font-weight': 600 }), V: this.txt(lay, '', 0, 0, 10.5, 'dv-m', 'start', { 'font-weight': 600 }) };
  }
  // ---- registers and the segment unit ----
  buildRegs586(g) {
    const b = this.block(g, 'regs', 1102, 384, 340, 206, 'INTEGER REGISTER FILE');
    const P = dieP();
    D386_REGS.forEach((r, i) => {
      const y0 = 406 + i * 17.4;
      svgEl('rect', { x: 1108, y: y0, width: 328, height: 16, rx: 3, fill: i % 2 ? P.row0 : P.row1, opacity: 0.9 }, b);
      const fl = this.flashRect(b, 1108, y0, 328, 16, dvA(THEME.phosphor, 0.3));
      this.txt(b, r, 1114, y0 + 12, 10.5, 'dv-m', 'start', { 'font-weight': 700 });
      const hi = this.txt(b, '0000', 1380, y0 + 12.5, 11.5, 'dv-f', 'end', { 'font-weight': 600 });
      const lo = this.txt(b, '0000', 1428, y0 + 12.5, 11.5, 'dv-v', 'end', { 'font-weight': 600 });
      this.els.regs[r] = { hi, lo, fl, y: y0 + 8, x: 1102, w32: true };
    });
    const f = this.block(g, 'flags', 1108, 548, 328, 38, '');
    D486_FLAGS.forEach(([n, bit], i) => {
      const x = 1110 + i * 21.7, y = 552, w = 20.2;
      const c = svgEl('g', { class: 'dv-cell' }, f);
      svgEl('rect', { x, y, width: w, height: 30, rx: 3 }, c);
      this.txt(c, n, x + w / 2, y + 10, n.length > 2 ? 5.4 : 6.8, 'dv-m', 'middle', { 'font-weight': 600 });
      const v = this.txt(c, '0', x + w / 2, y + 25, 10.5, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      const fl = this.flashRect(c, x, y, w, 30, dvA(THEME.phosphor, 0.45));
      this.els.flags.push({ n, bit, c, v, fl });
    });
  }
  buildSeg586(g) {
    const b = this.block(g, 'seg', 1102, 598, 340, 86, 'SEGMENT UNIT');
    const E = this.els;
    D386_SREGS.forEach((n, i) => {
      const x = 1110 + (i % 3) * 110, y = 628 + Math.floor(i / 3) * 16;
      this.txt(b, n, x, y, 9, 'dv-cy', 'start', { 'font-weight': 700 });
      const lo = this.txt(b, '0000', x + 22, y, 9.5, 'dv-v', 'start', { 'font-weight': 600 });
      const fl = this.flashRect(b, x - 3, y - 11, 100, 14, dvA(THEME.phosphor, 0.3));
      E.regs[n] = { lo, fl, y: y - 4, x: 1102 };
    });
    E.sgLin = this.txt(b, '', 1110, 672, 9.5, 'dv-cy', 'start', { 'font-weight': 700 });
    E.sgFl = this.flashRect(b, 1106, 660, 332, 18, dvA(THEME.cyan, 0.25));
  }
  // ---- the execution units: the two ALUs, the barrel shifter, the FPU registers ----
  buildAlu586(g) {
    const b = this.block(g, 'alu', 56, 712, 320, 232, 'ALU · U PIPE AND V PIPE');
    const E = this.els;
    E.alu = {};
    for (const [p, x0] of [['U', 64], ['V', 222]]) {
      const cx = x0 + 73;
      svgEl('rect', { x: x0, y: 736, width: 146, height: 200, rx: 5, fill: dvA(THEME.void, 0.25), stroke: dieP().cellStroke, 'stroke-width': 0.8 }, b);
      this.txt(b, 'ALU ' + p, x0 + 6, 750, 9, p === 'U' ? 'dv-ph' : 'dv-cy', 'start', { 'font-weight': 700 });
      const frame = svgEl('path', { d: `M${x0 + 8} 770H${cx - 8}L${cx} 782L${cx + 8} 770H${x0 + 138}L${x0 + 116} 842H${x0 + 30}Z`, fill: dieP().aluFill, stroke: THEME.gold, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, b);
      this.txt(b, 'A', x0 + 36, 768, 6.5, 'dv-m', 'middle');
      this.txt(b, 'B', x0 + 110, 768, 6.5, 'dv-m', 'middle');
      const a = this.txt(b, '--------', cx, 796, 10, 'dv-v', 'middle', { 'font-weight': 600 });
      const bb = this.txt(b, '--------', cx, 810, 10, 'dv-v', 'middle', { 'font-weight': 600 });
      const op = this.txt(b, '', cx, 826, 9.5, 'dv-go', 'middle', { 'font-weight': 700 });
      const r = this.txt(b, '', cx, 862, 11.5, 'dv-ph', 'middle', { 'font-weight': 700 });
      const tx = this.txt(b, '', x0 + 6, 884, 7.5, 'dv-m');
      this.txt(b, p === 'U' ? 'all instructions' : 'simple instructions', x0 + 6, 912, 7, 'dv-f');
      this.txt(b, p === 'U' ? '(microcode, shifts)' : '(only in a pair)', x0 + 6, 924, 7, 'dv-f');
      const fl = this.flashRect(b, x0 + 2, 738, 142, 196, dvA(p === 'U' ? THEME.phosphor : THEME.cyan, 0.14));
      E.alu[p] = { frame, a, b: bb, op, r, tx, fl };
    }
  }
  buildBarrel586(g) {
    const b = this.block(g, 'barrel', 388, 712, 210, 232, 'BARREL SHIFTER');
    const E = this.els, P = dieP();
    this.txt(b, 'U pipe only', 590, 726, 7, 'dv-f', 'end');
    E.brOp = this.txt(b, 'idle', 396, 760, 11, 'dv-f', 'start', { 'font-weight': 700 });
    E.brCnt = this.txt(b, '', 590, 760, 11, 'dv-mg', 'end', { 'font-weight': 700 });
    E.brBits = [];
    for (let i = 0; i < 32; i++) E.brBits.push(svgEl('rect', { x: 396 + i * 6, y: 772, width: 5.2, height: 16, rx: 1, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.5 }, b));
    this.txt(b, '31', 396, 798, 6.5, 'dv-f');
    this.txt(b, '0', 588, 798, 6.5, 'dv-f', 'end');
    E.brIn = this.txt(b, '', 396, 820, 9.5, 'dv-v');
    E.brRes = this.txt(b, '', 590, 842, 11, 'dv-ph', 'end', { 'font-weight': 700 });
    this.txt(b, 'SHL SHR SAR ROL ROR by 1 or by an', 396, 880, 7, 'dv-f');
    this.txt(b, 'immediate: simple, U pipe only.', 396, 891, 7, 'dv-f');
    this.txt(b, 'By CL: not simple (no pair).', 396, 902, 7, 'dv-f');
    E.brFl = this.flashRect(b, 390, 714, 206, 228, dvA(THEME.gold, 0.16));
  }
  buildFstk586(g) {
    const E = this.els, P = dieP();
    const b = this.block(g, 'fstk', 610, 712, 480, 232, 'FPU REGISTERS', 'l');
    E.fSw = this.txt(b, 'SW 0000 CW 0000', 874, 726, 7.5, 'dv-f', 'end');
    E.fOp = this.txt(b, 'idle', 618, 746, 10, 'dv-f', 'start', { 'font-weight': 700 });
    E.fTop = this.txt(b, 'TOP 0', 874, 746, 8.5, 'dv-lv', 'end', { 'font-weight': 600 });
    E.fOpFl = this.flashRect(b, 614, 734, 264, 17, dvA(THEME.lavender, 0.25));
    E.fRow = [];
    for (let i = 0; i < 8; i++) {
      const y0 = 754 + i * 22.6;
      const bg = svgEl('rect', { x: 614, y: y0, width: 264, height: 20, rx: 3, fill: i % 2 ? P.row0 : P.row1 }, b);
      const st = this.txt(b, 'ST' + i, 620, y0 + 14, 9.5, i ? 'dv-m' : 'dv-lv', 'start', { 'font-weight': 700 });
      const ph = this.txt(b, 'R' + i, 648, y0 + 14, 8, 'dv-f');
      const tag = svgEl('rect', { x: 668, y: y0 + 4, width: 3.5, height: 12, rx: 1, fill: THEME.faint }, b);
      const v = this.txt(b, 'empty', 872, y0 + 14, 10.5, 'dv-f', 'end', { 'font-weight': 600 });
      const fl = this.flashRect(b, 614, y0, 264, 20, dvA(THEME.lavender, 0.4));
      E.fRow.push({ bg, st, ph, tag, v, fl });
    }
    this.silk(b, 'EXPONENT', 892, 760, 9, 'dv-silk-l');
    E.feSign = this.txt(b, 'sign ·', 892, 792, 9.5, 'dv-m', 'start', { 'font-weight': 600 });
    E.feVal = this.txt(b, '----', 1082, 792, 13, 'dv-cy', 'end', { 'font-weight': 700 });
    E.feSub = this.txt(b, '15 bits, bias 16383', 1082, 808, 7.5, 'dv-f', 'end');
    E.feFl = this.flashRect(b, 886, 752, 198, 62, dvA(THEME.lavender, 0.2));
    this.silk(b, 'MANTISSA', 892, 832, 9, 'dv-silk-l');
    E.fmVal = this.txt(b, '---- ---- ---- ----', 892, 864, 10.5, 'dv-go', 'start', { 'font-weight': 700 });
    E.fmSub = this.txt(b, '64 bits', 1082, 880, 7.5, 'dv-f', 'end');
    E.fmFl = this.flashRect(b, 886, 824, 198, 62, dvA(THEME.lavender, 0.2));
    E.fBug = this.txt(b, '', 892, 920, 7.5, 'dv-f');
  }
  buildFpx586(g) {
    const b = this.block(g, 'fpx', 1102, 712, 340, 232, 'FPU PIPELINE', 'l');
    const E = this.els, P = dieP();
    const names = ['PF', 'D1', 'D2', 'EX', 'X1', 'X2', 'WF', 'ER'];
    E.fpSt = names.map((n, i) => {
      const x = 1110 + i * 41;
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x, y: 752, width: 38, height: 22, rx: 3 }, c);
      this.txt(c, n, x + 19, 767, 10, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return c;
    });
    svgEl('path', { d: 'M1112 780V786H1270V780', fill: 'none', stroke: THEME.phosphor, 'stroke-width': 1, opacity: 0.7 }, b);
    this.txt(b, 'the stages of the U pipe', 1191, 796, 6.8, 'dv-f', 'middle');
    svgEl('path', { d: 'M1276 780V786H1434V780', fill: 'none', stroke: THEME.lavender, 'stroke-width': 1, opacity: 0.8 }, b);
    this.txt(b, 'FPU only', 1355, 796, 6.8, 'dv-f', 'middle');
    E.fpOp = this.txt(b, 'idle', 1110, 818, 10.5, 'dv-f', 'start', { 'font-weight': 700 });
    E.fpClk = this.txt(b, '', 1434, 818, 8.5, 'dv-m', 'end', { 'font-weight': 600 });
    E.fpUnit = [['ADDER', 'FADD FSUB FCOM · 3 clocks'], ['MULTIPLIER', 'FMUL · 3 clocks'], ['DIVIDER', 'FDIV FSQRT · SRT radix 4']].map(([n, t], i) => {
      const y = 834 + i * 22;
      const r = svgEl('rect', { x: 1108, y, width: 328, height: 19, rx: 3, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      const d = svgEl('circle', { cx: 1118, cy: y + 9.5, r: 4.2, fill: P.dot }, b);
      this.txt(b, n, 1128, y + 13.5, 9, 'dv-v', 'start', { 'font-weight': 700 });
      this.txt(b, t, 1430, y + 13.5, 7.5, 'dv-f', 'end');
      return { r, d };
    });
    this.txt(b, 'FXCH in the V pipe: no more clocks', 1110, 918, 7.2, 'dv-f');
    E.fpNote = this.txt(b, '', 1110, 932, 7.2, 'dv-f');
    E.fpFl = this.flashRect(b, 1106, 748, 332, 30, dvA(THEME.lavender, 0.2));
  }

  // ---------- the legend (wide layout) ----------
  buildLegend(svg) {
    if (!this.L.legend) { this.legend = null; return; }
    const [x, y] = this.L.legend;
    const g = this.legend = svgEl('g', { class: 'dv-legend', transform: `translate(${x} ${y})`, 'aria-hidden': 'true' }, svg);
    this.silk(g, 'DIE FLOOR PLAN', 0, 0, 16, 'dv-silk-g');
    this.txt(g, 'Intel Pentium (P5), ' + this.mhz(), 0, 42, 15, 'dv-m');
    this.txt(g, 'two pipes, BTB, two 8 KB caches, 64-bit bus', 0, 62, 13, 'dv-f');
    const items = [[THEME.cyan, 'address'], [THEME.gold, 'data, code'], [THEME.magenta, 'control'], [THEME.lavender, 'FPU, paging'], [THEME.phosphor, 'changed value']];
    items.forEach(([c, s], i) => {
      const lx = (i % 3) * 170, ly = 94 + Math.floor(i / 3) * 26;
      svgEl('rect', { x: lx, y: ly - 11, width: 22, height: 6, rx: 3, fill: c }, g);
      this.txt(g, s, lx + 30, ly - 3, 14, 'dv-v');
    });
    this.txt(g, 'data lines (MESI):', 0, 162, 13, 'dv-m');
    [['M', THEME.magenta], ['E', THEME.phosphor], ['S', THEME.cyan], ['I', dieP().row0]].forEach(([n, c], i) => {
      svgEl('rect', { x: 150 + i * 70, y: 150, width: 16, height: 14, rx: 2, fill: c, stroke: dieP().cellStroke }, g);
      this.txt(g, n, 172 + i * 70, 162, 13, 'dv-v');
    });
    this.txt(g, 'BTB counter:', 0, 190, 13, 'dv-m');
    for (let k = 0; k < 4; k++) {
      svgEl('rect', { x: 110 + k * 50, y: 178, width: 16, height: 14, rx: 2, fill: this.btbCol(k), stroke: dieP().cellStroke }, g);
      this.txt(g, String(k), 132 + k * 50, 190, 13, 'dv-v');
    }
    this.txt(g, '(0-1 not taken, 2-3 taken)', 312, 190, 12, 'dv-f');
    this.txt(g, 'Click a block for a description.', 0, 222, 14, 'dv-f');
    this.txt(g, 'Double-click a part to see it on the 3D board.', 0, 242, 14, 'dv-f');
  }
  // A grid of cells drawn as one path for each class: cells = [[x, y, w, h], ...], styles =
  // [[fill, stroke], ...] (class 0 first). paintGrid(G, cls) sets the class of each cell.
  mkGrid(parent, cells, styles) {
    const g = svgEl('g', null, parent);
    const paths = styles.map(([fill, stroke]) => svgEl('path', { d: '', fill, stroke, 'stroke-width': 0.5 }, g));
    return { cells, paths, cls: new Int8Array(cells.length).fill(-1) };
  }
  paintGrid(G, cls) {
    if (!G) return;
    let same = true;
    for (let i = 0; i < cls.length; i++) if (G.cls[i] !== cls[i]) { same = false; break; }
    if (same) return;
    G.cls.set(cls);
    const ds = G.paths.map(() => []);
    for (let i = 0; i < cls.length; i++) {
      const [x, y, w, h] = G.cells[i];
      ds[cls[i]].push(`M${x.toFixed(1)} ${y.toFixed(1)}h${w}v${h}h${-w}z`);
    }
    G.paths.forEach((p, j) => p.setAttribute('d', ds[j].join('')));
  }
  // the classes of a TLB cell: 0 invalid, 1 valid, 2 dirty, 3 the last hit, 4 the last miss
  tlbStyles() {
    const P = dieP(), ls = dvMix(THEME.lavender, THEME.panel, 0.2);
    return [[P.row0, P.cellStroke], [dvMix(THEME.lavender, THEME.panel, 0.45), ls], [dvMix(THEME.gold, THEME.panel, 0.4), ls], [THEME.phosphor, THEME.text], [THEME.magenta, THEME.text]];
  }
  btbCol(k) { return [dvMix(THEME.magenta, THEME.panel, 0.45), dvMix(THEME.magenta, THEME.panel, 0.75), dvMix(THEME.gold, THEME.panel, 0.6), THEME.gold][k]; }

  // ---------- tokens: the internal buses (the gaps between the rows) and the spines ----------
  point(spec) {
    const A = this.arr;
    if (!A) return null;
    const P = this.p5 || {};
    if (spec && typeof spec === 'object') {
      if (spec.tail !== undefined) {
        const s = clamp(spec.tail, 0, 31), x = this.qx(s), y = this.qy(s) + this.QH / 2;
        return this.pt586('fe', x, y, 'dn');
      }
      if (spec.bus) return this.point(P.pipe === 'V' ? 'aluV' : 'aluU');
      return null;
    }
    if (D386_REGS.includes(spec)) return this.pt586('rg', 1102, 414 + D386_REGS.indexOf(spec) * 17.4, 'gl', 1096);
    let k = D586_ALIAS[spec] || spec;
    if (k === 'aluA' || k === 'aluB' || k === 'aluOut' || k === 'muldiv') k = P.pipe === 'V' ? 'aluV' : 'aluU';
    const p = D586_PTS[k];
    if (!p) return null;
    return this.pt586(p[0], p[1], p[2], p[3], p[4]);
  }
  // An end point: the edge point of unit u and its way to a gap bus. Returns { pts, gx, gy }.
  pt586(u, x, y, att, gutter) {
    const A = this.arr, [X, Y] = this.upt(u, x, y), G = A.gaps;
    let pts, gx, gy;
    if (att === 'dn' || att === 'up') {
      gy = att === 'dn' ? G.find(v => v > Y) : [...G].reverse().find(v => v < Y);
      if (gy === undefined) gy = G.reduce((a, v) => (Math.abs(v - Y) < Math.abs(a - Y) ? v : a), G[0]);
      gx = X; pts = [[X, Y], [X, gy]];
    } else {
      gx = gutter + A.off[u][0];
      if (A.off[u][0] || A.off[u][1]) gx = X + (att === 'gl' ? -6 : 6);
      gy = G.reduce((a, v) => (Math.abs(v - Y) < Math.abs(a - Y) ? v : a), G[0]);
      pts = [[X, Y], [gx, Y], [gx, gy]];
    }
    return { pts, gx, gy };
  }
  route(a, b) {
    const A = this.point(a), B = this.point(b);
    if (!A || !B) return null;
    let pts = A.pts.slice();
    if (A.gy !== B.gy) {
      const mid = (A.gx + B.gx) / 2, S = this.arr.spines.reduce((s, v) => (Math.abs(v - mid) < Math.abs(s - mid) ? v : s), this.arr.spines[0]);
      pts.push([S, A.gy], [S, B.gy]);
    }
    pts = pts.concat(B.pts.slice().reverse());
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
    return out;
  }
  // A memory operand comes from the data cache (not from the bus, as on the 386).
  opSource(op, v, w) {
    const r = super.opSource(op, v, w);
    return r === 'xcvr' ? 'dcache' : r;
  }

  // ---------- events ----------
  reset() {
    this.p5 = this.p5State();
    super.reset();
    this.pipeKey = '';
    this.renderAll();
  }
  instr(events, info) {
    super.instr(events, info);
    this.p5.fpuStart = false;
  }
  event(e, clockMs) {
    if (e.k === 'btb') { this.cmsSet(e, clockMs); this.onBtb(e, this.anim(e.t)); return; }
    super.event(e, clockMs);
  }
  onPipe(e, a) {
    const P = this.p5, pp = P.pp, s = e.stage || ['', '', '', '', ''];
    P.pipe = e.pipe === 'V' ? 'V' : 'U';
    if (P.pipe === 'V') {
      pp.cur.v = s[3] || pp.cur.v; pp.cur.vOn = true; pp.cur.vClk = e.clocks | 0; pp.cur.paired = true;
      pp.next = [s[2] || '', s[1] || '', s[0] || ''];
      pp.grp = false;
      pp.anim = Object.assign(a, { n: 1, minMs: 300 });
      this.flash('vex', a, 4, 700);
    } else {
      pp.oldWb = { u: pp.prev.u, v: pp.prev.v };
      pp.prev = { u: pp.cur.u, v: pp.cur.v };
      pp.cur = { u: s[3] || '', v: e.paired ? e.partner || '' : '', paired: !!e.paired, why: e.reason || '', vOn: false, uClk: e.clocks | 0, vClk: 0, uAlu: null, vAlu: null };
      pp.next = e.paired ? [s[1] || '', s[0] || '', ''] : [s[2] || '', s[1] || '', s[0] || ''];
      pp.grp = true;
      pp.anim = Object.assign(a, { n: 1, minMs: 420 });
      this.flash('uex', a, 4, 700);
    }
    this.pipeKey = '';
    this.renderPair();
    this.renderPipeStats();
    const mn = (s[3] || '').split(/\s+/)[0] || '?';
    this.token(e.t, ['dec', P.pipe === 'V' ? 'vpipe' : 'upipe'], mn, P.pipe === 'V' ? THEME.cyan : THEME.phosphor, 0, 1.2, 240);
  }
  onBtb(e, a) {
    const P = this.p5, B = this.m.cpu.btb, i = e.way >= 0 ? e.set * 4 + e.way : -1;
    let before = -1;
    if (i >= 0 && !e.alloc && P.btbTag[i] === (e.lin | 0)) before = P.btbShadow[i];
    if (i >= 0) { P.btbShadow[i] = e.counter & 3; P.btbTag[i] = e.lin | 0; }
    P.btbE = e; P.btbBefore = before;
    const E = this.els, G = E.btbG;
    if (G) {
      const x0 = G.gx0 + (e.set & 3) * G.sw, y0 = G.gy0 + (e.set >> 2) * G.ch;
      this.setA(E.btbSet, 'x', (x0 - 1.5).toFixed(1)); this.setA(E.btbSet, 'y', (y0 - 1).toFixed(1)); this.setA(E.btbSet, 'opacity', '0.95');
      if (e.way >= 0) { this.setA(E.btbWayFl, 'x', (x0 + e.way * G.cw - 1).toFixed(1)); this.setA(E.btbWayFl, 'y', (y0 - 1).toFixed(1)); this.flash('btbway', a, 6, 900); }
    }
    this.flash('btbx', a, 6, 900);
    this.renderBtb();
    this.renderBtbText();
    if (e.predicted && e.hit) {
      this.setT(E.pfB, 'B: ' + dvHex8(e.target >>> 0));
      this.flash('pfb2', a, 6, 900);
      this.token(e.t, ['btb', 'pfb'], 'TAKEN ' + hex(e.target >>> 0, 8), THEME.gold, 0, 1.4, 260);
    } else this.token(e.t, [P.pipe === 'V' ? 'vpipe' : 'upipe', 'btb'], e.alloc ? 'NEW' : e.hit ? 'UPDATE' : 'MISS', THEME.gold, 0, 1.4, 260);
    if (!e.right) this.token(e.t, ['btb', 'pfb'], `FLUSH +${e.penalty}`, THEME.magenta, 1, 1.4, 260);
    if (this.sfxOn() && typeof Sfx !== 'undefined') Sfx.tick(e.right ? 2.1 : 0.7, 0.02);
  }
  onCache(e, a) {
    const code = e.cache === 'code' || !!e.code, k = code ? 'i' : 'd', P = this.p5;
    P.acc[k] = { phys: e.phys >>> 0, set: e.set, way: e.way, hit: !!e.hit, fill: !!e.fill, write: !!e.write, state: e.state || 'I', nc: !!e.nc, wb: !!e.wb, wbLine: e.wbLine >>> 0, code };
    this.placeCache586(k, e.set, e.way);
    this.flash(k + 'cset', a, 6, 900);
    if (e.way >= 0) this.flash(k + 'cway', a, 6, 900);
    this.flash(k + 'ctag', a, 4, 600);
    this.renderTag586(k);
    this.renderCache586(k);
    const blk = code ? 'icache' : 'dcache', ex = P.pipe === 'V' ? 'aluV' : 'aluU';
    this.token(e.t, [code ? 'itlb' : 'dtlb', blk], dvHex8(e.phys), THEME.cyan, 0, 1.2, 240);
    if (e.write) this.token(e.t, [ex, blk], e.hit ? 'WRITE HIT' : 'WRITE MISS', THEME.goldHi, 0.4, 1.4, 260);
    else if (e.hit) this.token(e.t, [blk, code ? 'pfb' : ex], 'HIT', THEME.phosphor, 1.2, 1.6, 260);
    else if (e.fill) this.token(e.t, [blk, 'biu'], 'MISS', THEME.magenta, 1, 1.2, 240);
    else if (e.nc) this.token(e.t, [blk, 'biu'], 'NO CACHE', THEME.magenta, 1, 1.2, 240);
    this.sfxTick(e.hit ? 1.9 : 1.6);
  }
  onEA(e, a) {
    super.onEA(e, a);
    this.renderSigma();
  }
  onAlu(e, a) {
    const P = this.p5, p = P.pipe === 'V' ? 'V' : 'U';
    P.alu[p] = e;
    if (p === 'U') P.pp.cur.uAlu = e; else P.pp.cur.vAlu = e;
    this.flash('alu' + p, a, 5, 800);
    this.renderAlu586(p);
    this.pipeKey = '';
    super.onAlu(e, a);
  }
  onFpu(e, a) {
    this.mdl.fpuText = e.text;
    this.mdl.fpuCyc = e.cycles || 0;
    const old = this.readFpu();
    this.flash('fop', a, 6, 900);
    const m = this.fpuM;
    if (old && m) {
      for (let i = 0; i < 8; i++) {
        const p = (m.top + i) & 7, q = (old.top + i) & 7;
        if (old.vals[q] !== m.vals[p] || old.tags[q] !== m.tags[p]) this.flash('frow:' + i, a, 8, 1200);
      }
    }
    this.flash('fexp', a, 6, 900);
    this.flash('fman', a, 6, 900);
    this.p5.fpuP = { text: e.text || '', cyc: e.cycles || 0, a: Object.assign(this.anim(e.t), { n: Math.max(4, e.cycles || 4), minMs: 1400 }) };
    const t = (this.dec && this.dec.text) || e.text || '';
    if (/\[/.test(t)) {
      const store = /^f(i|b)?st|^fn?s(ave|tenv|tcw|tsw)/i.test(t.trim());
      this.token(e.t, store ? ['fstk', 'dcache'] : ['dcache', 'fstk'], store ? 'store' : 'load', THEME.lavender, 0, 1.6, 300);
    }
    this.token(e.t, ['fstk', 'fpx'], (e.text || 'FPU').split(/\s+/)[0], THEME.lavender, 1, 1.6, 300);
    this.renderFpu486();
    this.renderFpx();
    this.sfxTick(0.9);
  }
  onBus(e, a, type) {
    const len = e.len || 2;
    Object.assign(a, { n: len, minMs: 55 * len + 60, e, type });
    const evs = this.events || [], i = evs.indexOf(e);
    this.nextBus = i >= 0 ? evs.slice(i + 1).find(x => x.k === 'fetch' || x.k === 'bus') || null : null;
    const walk = !!(this.walkSet && (type === 'memr' || type === 'memw') && this.walkSet.has(e.addr & 0xFFFFFF));
    a.req = type === 'code' ? 'code' : walk ? 'page' : 'data';
    this.anims.bus = a;
    this.mdl.bus = { e, type, req: a.req };
    if (this.visible) this.renderBusText();
    if (type === 'code' && e === this.flushAt && !this.flushDone) this.doFlush(e.t);
    const lab = this.busLabel(e);
    if (e.burst) {
      this.onBurst(e, a, type);
      if (e.wb) this.token(e.t, ['dcache', 'biu'], lab, THEME.magenta, 0, Math.max(1, len * 0.8), 200);
      else this.token(e.t, ['biu', type === 'code' ? 'icache' : 'dcache'], lab, THEME.gold, 0.2, Math.max(1, len * 0.8), 200);
      return;
    }
    if (type === 'code') this.token(e.t, ['biu', 'pfb'], lab, THEME.gold, 0.3, len * 0.8, 240);
    else if (walk) {
      this.flash('walk', a, 4, 500);
      this.token(e.t, type === 'memw' ? ['walker', 'biu'] : ['biu', 'walker'], lab, THEME.lavender, 0.3, len, 260);
    } else if (type === 'memr' || type === 'ior') this.token(e.t, ['biu', this.readDest(e)], lab, THEME.gold, 0.6, len, 260);
    else if (type === 'memw' || type === 'iow') this.token(e.t, [this.writeSrc(e), 'biu'], lab, THEME.gold, 0, len, 260);
  }
  // The bytes of a transfer, as the token shows them (the low bytes first in memory order).
  busLabel(e) {
    const w = e.width || 1;
    if (w <= 2) return w === 2 ? hex4(e.data) : hex2(e.data);
    if (w <= 4) return hex(e.data >>> 0, w * 2);
    return hex((e.hi || 0) >>> 0, 8) + hex(e.data >>> 0, 8);
  }
  // One transfer of a line fill or of a write-back: its 8 bytes go into the line buffer.
  onBurst(e, a, type) {
    const code = type === 'code', k = code ? 'i' : 'd', P = this.p5, line = e.line >>> 0, wb = !!e.wb;
    let F = P.fill[k];
    if (!F || F.line !== line || F.wb !== wb || e.beat === 0 || F.done) {
      F = P.fill[k] = { line, wb, bytes: new Array(32).fill(null), order: [-1, -1, -1, -1], beats: 0, done: false, last: -1, first: ((e.addr - line) >>> 3) & 3 };
    }
    const o = (e.addr - line) & 24, d = o >> 3;
    for (let j = 0; j < 4; j++) F.bytes[o + j] = (e.data >>> (8 * j)) & 255;
    for (let j = 0; j < 4; j++) F.bytes[o + 4 + j] = ((e.hi || 0) >>> (8 * j)) & 255;
    F.order[d] = e.beat | 0;
    F.beats = Math.max(F.beats, (e.beat | 0) + 1);
    F.last = d;
    if ((e.beat | 0) === 3) {
      F.done = true;
      this.renderCache586(k);
    }
    this.flash(k + 'cfill', a, 2, 300);
    if (!e.beat) this.flash('burst', a, 3, 400);
    this.renderFill586(k);
  }
  onPage(e, a) {
    const big = !!e.big, code = !!e.code;
    this.mdl.pg = { lin: e.lin >>> 0, phys: e.phys >>> 0, dir: e.dir, tbl: e.tbl, pde: e.pde >>> 0, pte: e.pte >>> 0, fault: !!e.fault, err: e.err, big, code, hit: false, done: true };
    this.p5.tlbLast = { lin: e.lin >>> 0, big, code, hit: false, fault: !!e.fault };
    this.flash('walk', a, 8, 1200);
    this.renderPage();
    this.renderTlb();
    const tl = code ? 'itlb' : 'dtlb';
    this.token(e.t, [tl, 'walker'], 'TLB MISS', THEME.magenta, 0, 1.4, 260);
    this.token(e.t, ['walker', 'dcache'], big ? 'PDE (4 MB)' : 'PDE + PTE', THEME.lavender, 1.2, 1.6, 260);
    if (!e.fault) this.token(e.t, ['walker', tl], hex(e.phys >>> 12, 5), THEME.lavender, 2.6, 1.4, 260);
    this.sfxTick(1.7);
  }
  onTlb(e, a) {
    this.mdl.pg = { lin: e.lin >>> 0, phys: e.phys >>> 0, dir: e.lin >>> 22, tbl: (e.lin >>> 12) & 0x3FF, pde: null, pte: null, fault: false, hit: true, big: !!e.big, done: true };
    this.p5.tlbLast = { lin: e.lin >>> 0, big: !!e.big, code: false, hit: true };
    this.renderPage();
    this.renderTlb();
    this.flash('tlbc', a, 4, 600);
    this.token(e.t, ['dtlb', 'dcache'], hex(e.phys >>> 0, 8), THEME.phosphor, 0, 1.4, 240);
    this.sfxTick(1.9);
  }
  onSysReg(e, a) {
    if (e.r === 'CR4' && this.mdl.sys) this.mdl.sys.cr4 = e.v >>> 0;
    super.onSysReg(e, a);
  }
  flashEl(key) {
    const E = this.els;
    const c = k => E[k + 'C'] || {};
    const m = {
      icset: c('i').setFl, icway: c('i').wayFl, ictag: c('i').tagFl, icfill: c('i').fillFl,
      dcset: c('d').setFl, dcway: c('d').wayFl, dctag: c('d').tagFl, dcfill: c('d').fillFl,
      btbway: E.btbWayFl, btbx: E.btbFl, pfb2: E.pfBFl, uex: E.pFl && E.pFl.U, vex: E.pFl && E.pFl.V,
      aluU: E.alu && E.alu.U.fl, aluV: E.alu && E.alu.V.fl, tlbc: E.tlbMark, fpipe: E.fpFl, cr: E.crFl, walk: E.walkFl,
      tlbset: null, tlbway: null, pgadd: null, lim: null, md: null, wbuf: null, cset: null, cway: null, ctag: null, lfill: null, cstat: null,
      d2: E.decFl, dec: E.decFl, pipe: null,
    };
    if (key in m) return m[key] || null;
    return super.flashEl(key);
  }
  fast(stats) {
    // The machine state goes into the die 10 times a second (each drawn frame costs time that the
    // emulator needs): DieView.fast reads it when lastSync is old.
    const now = animNow(), due = now - (this.syncT || 0) >= D586_FAST_MS;
    if (!due) this.lastSync = now; else this.syncT = now;
    const P = this.p5, s = stats.sample || [];
    // the sampled instruction (at the same time as the picture): the pipes, the last branch, the caches
    if (due) for (const x of s) {
      if (x.k === 'pipe') {
        const st = pipeAfterHalt(x.stage);   // (no stages after a HLT)
        P.pipe = x.pipe === 'V' ? 'V' : 'U';
        if (P.pipe === 'V') P.pp.cur = { u: x.partner || '', v: st[3] || '', paired: true, why: '', vOn: true, uClk: 0, vClk: x.clocks | 0, uAlu: null, vAlu: null };
        else P.pp.cur = { u: st[3] || '', v: x.paired ? x.partner || '' : '', paired: !!x.paired, why: x.reason || '', vOn: false, uClk: x.clocks | 0, vClk: 0, uAlu: null, vAlu: null };
        P.pp.prev = { u: P.pipe === 'V' ? '' : st[4] || '', v: '' };
        P.pp.next = P.pipe === 'U' && x.paired ? [st[1] || '', st[0] || '', ''] : [st[2] || '', st[1] || '', st[0] || ''];
        P.pp.anim = null;
        this.pipeKey = '';
      } else if (x.k === 'btb') { P.btbE = x; P.btbBefore = -1; }
      else if (x.k === 'cache') {
        const k = x.cache === 'code' || x.code ? 'i' : 'd';
        P.acc[k] = { phys: x.phys >>> 0, set: x.set, way: x.way, hit: !!x.hit, fill: !!x.fill, write: !!x.write, state: x.state || 'I', nc: !!x.nc, wb: !!x.wb, wbLine: x.wbLine >>> 0, code: k === 'i' };
      } else if (x.k === 'alu') { P.alu[P.pipe] = x; }
      else if (x.k === 'fpu') this.mdl.fpuText = x.text;
    }
    DieView.prototype.fast.call(this, stats);
    const h = this.heatT, b = stats.bus || {}, c = this.m.cpu;
    const lg = v => clamp(Math.log10(1 + (v || 0)) / 4.2, 0, 1);
    const pv = this.fastPrev || (this.fastPrev = { ic: 0, dc: 0, fills: 0, bt: 0, u: 0, v: 0, tlb: 0, wm: 0 });
    const ic = c.icache.stats, dc = c.dcache.stats, bs = c.btb.stats, ps = c.pipeStats, ts = c.tlbStats;
    const icN = ic.hits + ic.misses, dcN = dc.hits + dc.misses, fills = ic.fills + dc.fills + dc.writeBacks;
    const all = (b.fetch || 0) + (b.memr || 0) + (b.memw || 0) + (b.ior || 0) + (b.iow || 0);
    const fpuOn = s.some(x => x.k === 'fpu');
    Object.assign(h, {
      icache: lg((icN - pv.ic) * 0.4), dcache: lg((dcN - pv.dc) * 0.4), biu: lg(all + (fills - pv.fills) * 4), btb: lg((bs.lookups - pv.bt) * 0.5),
      itlb: c.paging ? (h.dec || 0) * 0.6 : 0, dtlb: c.paging ? lg((ts.hits - pv.tlb) * 0.4) : 0, walker: c.paging ? lg((ts.misses - (pv.wm || 0)) * 30) : 0,
      pfb: h.dec, dec: h.dec, rom: h.rom, upipe: lg((ps.u - pv.u) * 0.2), vpipe: lg((ps.v - pv.v) * 0.2), regs: h.regs, flags: h.flags,
      seg: (h.sigma || 0) * 0.5, alu: h.alu, barrel: (h.alu || 0) * 0.3, fstk: fpuOn ? 0.8 : (h.fstk || 0) * 0.7, fpx: fpuOn ? 0.7 : (h.fpx || 0) * 0.7,
    });
    pv.ic = icN; pv.dc = dcN; pv.fills = fills; pv.bt = bs.lookups; pv.u = ps.u; pv.v = ps.v; pv.tlb = ts.hits; pv.wm = ts.misses;
    // copy the counters of the BTB for the "before" value of the next branch in the trace
    if (animNow() - (this.lastShadow || 0) > 250) {
      this.lastShadow = animNow();
      P.btbShadow.set(c.btb.counter);
      P.btbTag.set(c.btb.tag);
    }
  }

  // ---------- per frame ----------
  frame(now, dt) {
    // fast mode: draw only 10 frames a second; the frames between them change nothing
    const fastOn = this.lastFast && now - this.lastFast < 160;
    if (fastOn && now - (this.drawT || 0) < D586_FAST_MS) return;
    if (fastOn) dt = Math.min(1000, now - (this.drawT || now));
    this.drawT = now;
    DieView.prototype.frame.call(this, now, dt);
    if (!this.els || !this.els.pT) return;
    this.stepOverlay(now);
    this.stepPipe(now);
    this.stepFpx(now);
    if (!this.visible) return;
    this.renderTsc();
    // the grids follow the machine (a fill of the prefetcher or a new TLB entry makes no event)
    if (now - (this.gridT || 0) > 200) {
      this.gridT = now;
      this.renderCache586('i'); this.renderCache586('d'); this.renderBtb(); this.renderTlb();
      if (!this.p5.acc.i) this.renderTag586('i');
      if (!this.p5.acc.d) this.renderTag586('d');
    }
  }
  stepPads(now) {
    const st = {}, set = (n, c) => { st[n] = c; };
    const cur = this.curBus(now);
    const f = this.m.fpu;
    let T = -1;
    if (cur) {
      const e = cur.e, type = cur.type;
      T = cur.T;
      const write = type === 'memw' || type === 'iow';
      const addr = type === 'inta' ? 4 : type === 'halt' ? 2 : e.addr >>> 0;
      for (let b = 3; b < 32; b++) set('A' + b, 'a' + ((addr >>> b) & 1));
      const lane0 = e.burst ? 0 : addr & 7, n = e.burst ? 8 : clamp(e.width || 1, 1, 8);
      if (type !== 'halt') for (let k = 0; k < n && lane0 + k < 8; k++) set('BE' + (lane0 + k), 'c1');
      if (write || T === cur.len - 1) {
        for (let k = 0; k < n && lane0 + k < 8; k++) {
          if (type === 'halt' || (type === 'inta' && k > 0)) continue;
          const v = k < 4 ? (e.data >>> (8 * k)) & 255 : ((e.hi || 0) >>> (8 * (k - 4))) & 255, L = lane0 + k;
          for (let bb = 0; bb < 8; bb++) set('D' + (L * 8 + bb), 'd' + ((v >> bb) & 1));
        }
      }
      const s = D386_STATUS[type] || [1, 1, 1];
      set('M/IO', 'c' + s[0]); set('D/C', 'c' + s[1]); set('W/R', 'c' + s[2]);
      const burst = !!e.burst, beat = e.beat | 0;
      if (T === 0 && (!burst || beat === 0)) set('ADS', 'c1');
      if (burst) set('CACHE', 'c1');
      if (burst && !e.wb) set('KEN', 'c1');
      if (T === cur.len - 1) set('BRDY', 'g1');
      if (type === 'inta') { set('LOCK', 'c1'); set('INTR', 'c1'); }
    }
    const it = this.anims.intr;
    if (it) {
      const p = this.prog(it, now);
      if (p >= 0 && p < 1) { if (it.e.src === 'irq') set('INTR', 'c1'); if (it.e.src === 'nmi') set('NMI', 'c1'); }
    }
    if (this.dec && /^lock/.test(this.dec.text) && this.anims.dec && this.prog(this.anims.dec, now) < 1) set('LOCK', 'c1');
    if (f && f.intRequest) set('FERR', 'c1');
    if (this.resetAt && now - this.resetAt < 900) set('RESET', 'c1');
    if (!this.m.a20) set('A20M', 'c1');
    const playing = this.anims.dec && this.prog(this.anims.dec, now) < 1;
    if (playing && this.cms >= 12 && (this.vclock % 1) < 0.5) set('CLK', 'g1');
    for (const pd of this.els.pads) {
      const cls = st[pd.name];
      this.setC(pd.c, pd.base + (cls ? ' dv-' + cls : ''));
    }
    const ringCol = !cur ? dieP().scribe : T === 0 ? THEME.cyan : cur.e.wb ? THEME.magenta : THEME.gold;
    this.setA(this.els.ring, 'stroke', ringCol);
    this.setA(this.els.ring, 'opacity', cur ? '0.9' : '0.55');
    const E = this.els, P = dieP();
    const lamp = (el, on, col) => this.setA(el, 'fill', on ? col : P.dot);
    if (E.beL) [7, 6, 5, 4, 3, 2, 1, 0].forEach((k, i) => lamp(E.beL[i], st['BE' + k], THEME.magenta));
    if (E.bl) {
      lamp(E.bl.ADS, st.ADS, THEME.magenta); lamp(E.bl.NA, false, THEME.magenta); lamp(E.bl.CACHE, st.CACHE, THEME.magenta);
      lamp(E.bl.KEN, st.KEN, THEME.cyan); lamp(E.bl.BRDY, st.BRDY, THEME.phosphor);
    }
  }
  stepBusCtl(now) {
    const E = this.els, cur = this.curBus(now);
    if (!E.bcT) return;
    const e = cur ? cur.e : null, burst = !!(e && e.burst), beat = e ? e.beat | 0 : 0;
    const t1 = cur && cur.T === 0 && (!burst || beat === 0);
    this.setC(E.bcT[0], 'dv-tstate' + (t1 ? ' dv-on' : ''));
    this.setC(E.bcT[1], 'dv-tstate' + (cur && !t1 ? ' dv-on' : ''));
    const type = cur ? cur.type : null;
    const name = !cur ? 'IDLE  Ti' : burst ? (e.wb ? 'WRITE-BACK · M LINE' : `LINE FILL · ${type === 'code' ? 'CODE' : 'DATA'}`) : type === 'halt' ? 'HALT/SHUTDOWN' : DIE_CYCLE[type] || type;
    this.setT(E.bcType, name);
    this.setA(E.bcType, 'class', !cur ? 'dv-m' : burst ? (e.wb ? 'dv-mg' : 'dv-cy') : /io|inta|halt/.test(type) ? 'dv-mg' : 'dv-go');
    const s = cur ? D386_STATUS[type] || [1, 1, 1] : null;
    E.bcBits.forEach((t, j) => this.setT(t, s ? String(s[j]) : '·'));
    E.beat.forEach((c, i) => {
      const on = burst && i === beat, done = burst && i < beat;
      this.setC(c, 'dv-cell' + (on ? ' dv-l dv-on' : done ? ' dv-on' : ''));
    });
    // the byte lanes: the bytes of this transfer
    const lane0 = e ? (burst ? 0 : e.addr & 7) : 0, n = e ? (burst ? 8 : clamp(e.width || 1, 1, 8)) : 0;
    const key = e ? `${e.addr}|${e.data}|${e.hi}|${n}` : '';
    if (key !== this.laneKey) {
      this.laneKey = key;
      for (const L of E.lane) {
        const k = L.n - lane0, on = !!e && k >= 0 && k < n && type !== 'halt';
        const v = !on ? -1 : k < 4 ? (e.data >>> (8 * k)) & 255 : ((e.hi || 0) >>> (8 * (k - 4))) & 255;
        this.setT(L.t, on ? hex2(v) : '··');
        this.setC(L.c, 'dv-cell' + (on ? ' dv-on' : ''));
      }
    }
    this.setT(E.bcPipe, cur && cur.len > 2 && !burst ? `${cur.len - 2} wait state${cur.len > 3 ? 's' : ''}` : burst ? `transfer ${beat + 1} of 4` : '');
  }
  stepMisc(now) {
    const E = this.els, dec = this.anims.dec;
    const fastOn = this.lastFast && now - this.lastFast < 160;
    let pos = -1;
    if (dec && this.dec && dec.serial === this.serial) {
      const p = this.prog(dec, now);
      if (p >= 0 && p < 1) pos = (((this.dec.bytes[0] || 0) * 13 + Math.floor(p * this.cycles) * 7) * 2654435761 >>> 0) % 22;
    }
    if (fastOn) pos = Math.floor(now / 70) % 22;
    this.setA(E.romRow, 'x', String(1110 + Math.max(0, pos) * (310 / 21)));
    this.setA(E.romRow, 'opacity', pos < 0 ? '0' : fastOn ? '0.4' : '0.9');
    const playing = dec && this.prog(dec, now) < 1 && !fastOn;
    const c = playing ? Math.min(this.cycles, Math.max(0, Math.floor(this.vclock))) : 0;
    this.setT(E.decClk, playing ? `clock ${c} / ${this.cycles}` : '');
    this.setA(E.clkDot, 'fill', playing && (this.vclock % 1) < 0.5 ? THEME.phosphor : fastOn ? THEME.gold : dieP().dot);
    this.setT(E.clkText, fastOn ? 'free running' : playing ? `${this.cms >= 1 ? Math.round(this.cms) : this.cms.toFixed(1)} ms/clock` : this.mhz());
  }
  // The pipes: the texts move one stage down when a new U instruction starts; the partner of a
  // pair moves from the D1 stage of the U pipe into the EX stage of the V pipe.
  stepPipe(now) {
    const E = this.els, G = this.pipeGeo586, pp = this.p5.pp;
    if (!G || !E.pT) return;
    const a = pp.anim;
    let u = a ? this.prog(a, now) : 1;
    u = this.reduced ? (u >= 0 ? 1 : 0) : clamp(u, 0, 1);
    const q = easeInOut(u), grp = pp.grp && a;
    const key = pp.cur.u + '|' + pp.cur.v + '|' + pp.next.join('|') + '|' + pp.prev.u + '|' + pp.prev.v + '|' + pp.cur.vOn + ':' + (grp ? q.toFixed(3) : '1');
    if (key === this.pipeKey) return;
    this.pipeKey = key;
    const cut = (s, mx) => (s && s.length > mx ? s.slice(0, mx - 1) + '…' : s || '');
    const put = (t, x, y) => { this.setA(t, 'x', x.toFixed(1)); this.setA(t, 'y', y.toFixed(1)); };
    const ty = k => G.sy(k) + 27, XU = G.x.U, XV = G.x.V;
    const U = [pp.next[2], pp.next[1], pp.next[0], pp.cur.u, pp.prev.u];
    const V = ['', '', '', pp.cur.v, pp.prev.v];
    for (let k = 0; k < 5; k++) {
      const tu = E.pT.U[k], tv = E.pT.V[k];
      this.setT(tu, cut(U[k], 30) || (k === 0 ? '' : '·'));
      this.setA(tu, 'class', k === 3 ? 'dv-ph' : k === 4 ? 'dv-m' : 'dv-v');
      const yU = grp ? lerp(k ? ty(k - 1) : ty(0) - G.step, ty(k), q) : ty(k);
      put(tu, XU, yU);
      this.setA(tu, 'opacity', (grp && k === 0 ? q : 1).toFixed(2));
      let vt = V[k], cls = 'dv-f';
      if (k === 3) {
        if (pp.cur.v) cls = pp.cur.vOn ? 'dv-cy' : 'dv-v';
        else vt = pp.cur.u ? '— no pair' : '';
      } else if (k === 4) cls = 'dv-m';
      this.setT(tv, cut(vt, 30) || (k < 3 ? '·' : ''));
      this.setA(tv, 'class', k === 3 && !pp.cur.v ? 'dv-mg' : cls);
      let xV = XV, yV = ty(k);
      // the partner was the second instruction in D1 (the U instruction was in D2)
      if (grp && k === 3 && pp.cur.v) { xV = lerp(XU, XV, q); yV = lerp(ty(1), ty(3), q); }
      else if (grp && k === 4) yV = lerp(ty(3), ty(4), q);
      put(tv, xV, yV);
    }
    // the old write-back texts leave the pipes
    for (const p of ['U', 'V']) {
      const gh = E.pGhost[p];
      if (grp && q < 1) {
        this.setT(gh, cut(p === 'U' ? pp.oldWb.u : pp.oldWb.v, 30));
        put(gh, p === 'U' ? XU : XV, ty(4) + q * G.step);
        this.setA(gh, 'opacity', (1 - q).toFixed(2));
      } else this.setA(gh, 'opacity', '0');
    }
    // the second line of the EX stages: the ALU work, or why V is empty
    const alu = x => (x ? `${x.op} ${this.aluFmt(x.w)(x.a)}, ${this.aluFmt(x.w)(x.b)} → ${this.aluFmt(x.w)(x.r)}` : '');
    this.setT(E.pL2.U, cut(alu(pp.cur.uAlu) || (pp.cur.u ? `${pp.cur.uClk} clock${pp.cur.uClk === 1 ? '' : 's'} alone` : ''), 40));
    this.setT(E.pL2.V, cut(pp.cur.v ? alu(pp.cur.vAlu) || (pp.cur.vOn ? `${pp.cur.vClk} clock${pp.cur.vClk === 1 ? '' : 's'} alone` : 'the pair goes in together') : pp.cur.why, 40));
    this.setA(E.pL2.V, 'class', pp.cur.v ? 'dv-m' : 'dv-mg');
    const P = dieP(), busy = !!(this.anims.dec && this.prog(this.anims.dec, now) < 1);
    E.pBox.U.forEach((r, k) => this.setA(r, 'stroke', k === 3 && busy && this.p5.pipe === 'U' ? THEME.phosphor : P.cellStroke));
    E.pBox.V.forEach((r, k) => {
      this.setA(r, 'stroke', k === 3 ? (busy && this.p5.pipe === 'V' ? THEME.cyan : !pp.cur.v && pp.cur.u ? THEME.magenta : P.cellStroke) : P.cellStroke);
      this.setA(r, 'stroke-dasharray', k === 3 && !pp.cur.v && pp.cur.u ? '4 3' : 'none');
    });
  }
  // The FPU pipeline: the last FPU instruction moves through X1, X2, WF and ER.
  stepFpx(now) {
    const E = this.els, F = this.p5.fpuP;
    if (!E.fpSt) return;
    let k = -1;
    if (F && F.a) {
      const p = this.prog(F.a, now);
      if (p >= 0 && p < 1) k = 3 + Math.min(4, Math.floor(p * 5));
      else if (p >= 1) F.a = null;
    }
    if (k === this.fpxK) return;
    this.fpxK = k;
    E.fpSt.forEach((c, i) => this.setC(c, 'dv-cell dv-l' + (i === k || (k >= 0 && i < 3) ? ' dv-on' : '')));
  }

  // ---------- renders ----------
  renderAll() {
    if (!this.els || !this.els.pT) return;
    for (const r of D386_REGS) this.renderReg(r, 0);
    for (const n of D386_SREGS) this.renderReg(n, 0);
    this.renderReg('EIP', 0);
    this.renderFlags(); this.renderDec(); this.renderIntr(); this.renderFpu486(); this.renderBusText(); this.renderSys(); this.renderSigma();
    this.renderPage(); this.renderTlb(); this.renderBarrel(); this.renderFpx();
    this.renderCache586('i'); this.renderCache586('d'); this.renderTag586('i'); this.renderTag586('d'); this.renderFill586('i'); this.renderFill586('d');
    this.renderBtb(); this.renderBtbText(); this.renderPair(); this.renderPipeStats(); this.renderAlu586('U'); this.renderAlu586('V'); this.renderTsc();
    if (this.chips.map(c => c.byte).join() !== this.mdl.q.join()) this.rebuildChips();
    this.setT(this.els.qCount, this.mdl.q.length + '/' + this.QN);
    this.pipeKey = ''; this.laneKey = null; this.fpxK = null;
  }
  renderSys() {
    const E = this.els, s = this.mdl.sys;
    if (!E.crBits || !s) return;
    const cr0 = s.cr0 >>> 0, cr4 = (s.cr4 === undefined ? this.m.cpu.cr[4] : s.cr4) >>> 0;
    E.crBits.forEach(x => this.setC(x.c, 'dv-cell dv-l' + ((cr0 >>> x.bit) & 1 ? ' dv-on' : '')));
    E.cr4Bits.forEach(x => this.setC(x.c, 'dv-cell dv-l' + ((cr4 >>> x.bit) & 1 ? ' dv-on' : '')));
    this.setT(E.cr0Hex, 'CR0 ' + dvHex8(cr0));
    this.setT(E.cr4Hex, 'CR4 ' + dvHex8(cr4));
    this.setT(E.cr2, 'CR2 ' + dvHex8(s.cr2));
    this.setT(E.cr3, 'CR3 ' + dvHex8(s.cr3));
    this.setT(E.wCr3, 'CR3 ' + dvHex8(s.cr3));
    this.setT(E.prMode, `${s.vm ? 'V86' : s.pe ? 'PROTECTED' : 'REAL'} · CPL ${s.cpl}` + (s.pg ? ' · PAGING' : ''));
    this.setA(E.prMode, 'class', s.vm ? 'dv-mg' : s.pe ? 'dv-lv' : 'dv-m');
    const cd = (cr0 >>> 30) & 1, nw = (cr0 >>> 29) & 1;
    this.setT(E.ccMode, `caches ${cd ? 'off' : 'on'} · CD ${cd} NW ${nw}`);
    this.setA(E.ccMode, 'class', cd ? 'dv-mg' : 'dv-ph');
    const t12 = this.m.cpu.tr12 | 0;
    this.setT(E.tr12, `TR12 · NBP ${t12 & 1} · SE ${(t12 >> 1) & 1} · CI ${(t12 >> 9) & 1}`);
    this.setA(E.tr12, 'class', t12 & 0x203 ? 'dv-mg' : 'dv-m');
  }
  renderTsc() {
    const E = this.els, c = this.m.cpu;
    if (!E.tsc) return;
    let v;
    try { v = BigInt.asUintN(64, BigInt(Math.floor(c.cycles)) + (typeof c.tscOff === 'bigint' ? c.tscOff : 0n)); } catch (err) { v = 0n; }
    const h = v.toString(16).toUpperCase().padStart(16, '0');
    this.setT(E.tsc, h.slice(0, 8) + ' ' + h.slice(8));
  }
  renderSigma() {
    const E = this.els, s = this.mdl.sig;
    if (!E.sgLin || !s) return;
    const d = this.mdl.desc && this.mdl.desc[s.seg];
    const base = s.base !== undefined ? s.base >>> 0 : d ? d.base >>> 0 : 0;
    const lin = s.lin !== undefined ? s.lin >>> 0 : (base + (s.off >>> 0)) >>> 0;
    this.setT(E.sgLin, `${s.seg || 'CS'} ${dvHex8(base)} + ${s.off > 0xFFFF ? dvHex8(s.off) : hex4(s.off)} = ${dvHex8(lin)}`);
  }
  renderDec() {
    const E = this.els, d = this.mdl.dec;
    if (!E.decBytes) return;
    if (!d) { this.setT(E.decBytes, ''); return; }
    const by = d.bytes || [];
    this.setT(E.decBytes, by.slice(0, 7).map(hex2).join(' ') + (by.length > 7 ? ' …' : ''));
    this.renderPair();
  }
  // The decoder: the instructions of U and V, the verdict of the pair check, the rules.
  renderPair() {
    const E = this.els, pp = this.p5.pp, cur = pp.cur, P = dieP();
    if (!E.dU) return;
    const cut = (s, mx) => (s && s.length > mx ? s.slice(0, mx - 1) + '…' : s || '');
    this.setT(E.dU, cut(cur.u, 28) || '—');
    this.setA(E.dU, 'class', cur.u ? 'dv-ph' : 'dv-f');
    this.setT(E.dV, cut(cur.v, 28) || (cur.u ? 'no second instruction' : '—'));
    this.setA(E.dV, 'class', cur.v ? 'dv-cy' : 'dv-f');
    if (!cur.u) { this.setT(E.dVerdict, ''); this.setT(E.dWhy, ''); this.setT(E.dWhy2, ''); this.setT(E.dClk, ''); }
    else if (cur.v) {
      this.setT(E.dVerdict, 'PAIR');
      this.setA(E.dVerdict, 'class', 'dv-ph');
      this.setT(E.dWhy, 'all pair rules are true: U and V start together');
      this.setT(E.dWhy2, '');
    } else {
      this.setT(E.dVerdict, 'NO PAIR');
      this.setA(E.dVerdict, 'class', 'dv-mg');
      const w = cur.why || '', cutAt = w.length > 44 ? w.lastIndexOf(' ', 44) : -1;
      this.setT(E.dWhy, cutAt > 0 ? w.slice(0, cutAt) : w);
      this.setT(E.dWhy2, cutAt > 0 ? w.slice(cutAt + 1) : '');
    }
    this.setT(E.dClk, cur.u ? `U ${cur.uClk} clk` + (cur.vOn ? ` · V ${cur.vClk} clk` : '') : '');
    const why = cur.why || '';
    E.dRules.forEach(({ c }, i) => {
      const bad = !cur.v && !!why && D586_RULES[i][1].test(why);
      this.setC(c, 'dv-cell' + (cur.v ? ' dv-on' : bad ? ' dv-bad' : ''));
    });
  }
  renderPipeStats() {
    const E = this.els, c = this.m.cpu, ps = c.pipeStats;
    if (!E.pStat || !ps) return;
    const f = v => v.toLocaleString('en-US');
    this.setT(E.pStat.U, `${f(ps.u)} instr`);
    this.setT(E.pStat.V, `${f(ps.v)} instr · ${ps.u ? (ps.v / ps.u * 100).toFixed(1) : '0'} % paired`);
    // the most frequent reason for no pair
    let best = 0, bi = -1, tot = 0;
    for (let i = 1; i < ps.why.length; i++) { tot += ps.why[i]; if (ps.why[i] > best) { best = ps.why[i]; bi = i; } }
    this.setT(E.pairSt, `pairs ${f(ps.v)} of ${f(ps.u)} U instructions`);
    this.setT(E.pairSt2, bi > 0 ? `most frequent: ${ps.reasons[bi].replace('$', 'a register')} (${(best / Math.max(1, tot) * 100).toFixed(0)} %)` : '');
  }
  renderAlu586(p) {
    const E = this.els, x = this.p5.alu[p], A = E.alu && E.alu[p];
    if (!A) return;
    if (!x) { this.setT(A.a, '--------'); this.setT(A.b, '--------'); this.setT(A.op, ''); this.setT(A.r, ''); this.setT(A.tx, ''); return; }
    const f = this.aluFmt(x.w);
    this.setT(A.a, f(x.a)); this.setT(A.b, f(x.b));
    this.setT(A.op, `${DIE_OPSYM[x.op] || ''} ${x.op} ${x.w || 32}`.trim());
    this.setT(A.r, '= ' + (x.r > 0xFFFFFFFF ? hex(Math.floor(x.r / 0x100000000), 8) + dvHex8(x.r) : f(x.r)));
    const t = p === 'U' ? this.p5.pp.cur.u : this.p5.pp.cur.v;
    this.setT(A.tx, t && t.length > 24 ? t.slice(0, 23) + '…' : t || '');
  }
  // The code cache or the data cache: 256 lines; the colour of a data line is its MESI state.
  renderCache586(k) {
    const E = this.els, C = E[k + 'C'], c = this.m.cpu;
    if (!C) return;
    const K = k === 'i' ? c.icache : c.dcache, T = K.tag, S = k === 'd' ? K.state : null, F = this.p5.fill[k];
    const cls = this.gridCls || (this.gridCls = new Int8Array(256));
    for (let i = 0; i < 256; i++) {
      const valid = T[i] >= 0;
      const nw = !!(F && F.done && !F.wb && valid && c.lineAddr(T[i], i) === F.line);
      cls[i] = !valid ? 0 : nw ? (S ? 4 : 2) : S ? S[i] : 1;
    }
    this.paintGrid(C.grid, cls);
  }
  placeCache586(k, set, way) {
    const C = this.els[k + 'C'];
    if (!C) return;
    const x0 = C.gx0 + (set & 7) * C.cw, y0 = C.gy0 + (set >> 3) * C.ch;
    for (const el of [C.setFl, C.setMark]) { this.setA(el, 'x', (x0 - 1.5).toFixed(1)); this.setA(el, 'y', (y0 - 1.2).toFixed(1)); }
    this.setA(C.setMark, 'opacity', '0.9');
    if (way >= 0) { this.setA(C.wayFl, 'x', (x0 + way * 16 - 1).toFixed(1)); this.setA(C.wayFl, 'y', (y0 - 1).toFixed(1)); }
  }
  renderTag586(k) {
    const E = this.els, C = E[k + 'C'], x = this.p5.acc[k], c = this.m.cpu;
    if (!C) return;
    const K = k === 'i' ? c.icache : c.dcache, P = dieP();
    if (!x) {
      this.setT(C.addr, '--------'); this.setT(C.tag, '--'); this.setT(C.set, '--'); this.setT(C.ofs, '--');
      const n = K.stats.hits + K.stats.misses;
      this.setT(C.res, n ? `hits ${K.stats.hits.toLocaleString('en-US')} · misses ${K.stats.misses.toLocaleString('en-US')}` : 'no access yet');
      this.setA(C.res, 'class', 'dv-f');
      this.setT(C.note, '');
      for (const R of C.ways) { this.setT(R.t, '-----'); this.setT(R.st, ''); this.setT(R.a, ''); this.setT(R.m, ''); }
      return;
    }
    const set = x.set;
    this.setT(C.addr, dvHex8(x.phys));
    this.setT(C.tag, hex(x.phys >>> 12, 5)); this.setT(C.set, hex2(set)); this.setT(C.ofs, hex2(x.phys & 31));
    const nextW = K.lru[set];
    for (let w = 0; w < 2; w++) {
      const i = set * 2 + w, R = C.ways[w], tag = K.tag[i], valid = tag >= 0;
      const st = valid ? (k === 'd' ? D586_MESI[K.state[i]] : 'S') : 'I';
      const match = x.way === w && (x.hit || x.fill);
      this.setT(R.t, valid ? hex(tag, 5) : '-----');
      this.setA(R.t, 'class', match ? 'dv-ph' : valid ? 'dv-v' : 'dv-f');
      this.setT(R.st, valid || k === 'd' ? st : '');
      this.setA(R.st, 'class', st === 'M' ? 'dv-mg' : st === 'E' ? 'dv-ph' : st === 'S' ? 'dv-cy' : 'dv-f');
      this.setT(R.a, valid ? 'line ' + dvHex8(c.lineAddr(tag, i)) : 'empty');
      this.setT(R.m, (match ? (x.hit ? '= HIT' : 'NEW') : valid ? '≠' : '') + (w === nextW ? ' ◂ next fill' : ''));
      this.setA(R.m, 'class', match ? 'dv-ph' : 'dv-f');
      this.setA(R.bg, 'stroke', match ? (x.hit ? THEME.phosphor : THEME.gold) : P.cellStroke);
    }
    let res, cls;
    if (x.write) {
      cls = 'dv-go';
      res = !x.hit ? 'WRITE MISS · to the bus, no fill' : x.state === 'M' ? 'WRITE HIT · the line is M (no bus cycle)' : x.state === 'E' ? 'WRITE HIT · S line: write-through, now E' : `WRITE HIT · ${x.state} · to the bus`;
    } else if (x.hit) { res = `HIT · way ${x.way} · ${k === 'd' ? x.state : 'code'}`; cls = 'dv-ph'; }
    else if (x.fill) { res = `MISS · fill way ${x.way}` + (k === 'd' ? ` · now ${x.state}` : '') + (x.wb ? ' · the old M line goes back' : ''); cls = 'dv-mg'; }
    else { res = 'MISS · not cached'; cls = 'dv-mg'; }
    this.setT(C.res, res);
    this.setA(C.res, 'class', cls);
    this.setT(C.note, x.wb ? `then write-back of ${dvHex8(x.wbLine)}` : x.nc ? 'CD = 1, PCD = 1, CI or no KEN#' : '');
    this.setA(C.note, 'class', x.wb ? 'dv-mg' : 'dv-f');
  }
  renderFill586(k) {
    const E = this.els, C = E[k + 'C'], F = this.p5.fill[k], P = dieP();
    if (!C) return;
    const ords = ['1st', '2nd', '3rd', '4th'];
    for (let d = 0; d < 4; d++) {
      const X = C.fill[d], ord = F ? F.order[d] : -1;
      const bytes = F ? F.bytes.slice(d * 8, d * 8 + 8) : [];
      const has = F && bytes[0] !== null && bytes[0] !== undefined;
      this.setT(X.l1, has ? bytes.slice(0, 4).map(hex2).join(' ') : '');
      this.setT(X.l2, has ? bytes.slice(4).map(hex2).join(' ') : '');
      const newest = F && !F.done && F.last === d;
      const col = F && F.wb ? THEME.magenta : THEME.gold;
      this.setA(X.l1, 'class', newest ? 'dv-ph' : has ? 'dv-v' : 'dv-f');
      this.setA(X.l2, 'class', newest ? 'dv-ph' : has ? 'dv-v' : 'dv-f');
      this.setT(X.n, F ? (ord >= 0 ? ords[ord] : F.wb ? '' : ords[(d ^ F.first) & 3]) + (F && !F.wb && d === F.first ? ' ★' : '') : '');
      this.setA(X.r, 'fill', !has ? P.row0 : newest ? dvMix(THEME.phosphor, THEME.panel, 0.7) : dvMix(col, THEME.panel, 0.8));
      this.setA(X.r, 'stroke', newest ? THEME.phosphor : has ? dvMix(col, THEME.panel, 0.3) : P.cellStroke);
    }
    if (!F) return;
    this.setT(C.note, `${F.wb ? 'write-back' : 'fill'} ${dvHex8(F.line)} · ${F.done ? 'done' : F.beats + '/4'}`);
    this.setA(C.note, 'class', F.wb ? 'dv-mg' : 'dv-go');
  }
  renderBtb() {
    const E = this.els, B = this.m.cpu.btb, P = dieP();
    if (!E.btb || !B) return;
    const cls = this.btbCls || (this.btbCls = new Int8Array(256));
    for (let i = 0; i < 256; i++) cls[i] = B.tag[i] !== -1 ? 1 + (B.counter[i] & 3) : 0;
    this.paintGrid(E.btb, cls);
    const s = B.stats;
    this.setT(E.btbSt, `lookups ${s.lookups.toLocaleString('en-US')} · hits ${s.hits.toLocaleString('en-US')} · right ${s.lookups ? (s.right / s.lookups * 100).toFixed(1) : '—'} %`);
  }
  renderBtbText() {
    const E = this.els, x = this.p5.btbE;
    if (!E.btbL1) return;
    if (!x) { this.setT(E.btbL1, 'no branch yet'); this.setA(E.btbL1, 'class', 'dv-f'); this.setT(E.btbL2, ''); this.setT(E.btbL3, ''); return; }
    this.setT(E.btbL1, `branch ${dvHex8(x.lin >>> 0)} · set ${hex2(x.set)}` + (x.way >= 0 ? ` way ${x.way}` : ''));
    this.setA(E.btbL1, 'class', 'dv-v');
    const b = this.p5.btbBefore;
    const cnt = x.counter < 0 ? 'no entry (not taken)' : x.alloc ? `new entry: ${x.counter} ${D586_BTBSTATE[x.counter]}`
      : (b >= 0 && b !== x.counter ? `${b} → ` : '') + `${x.counter} ${D586_BTBSTATE[x.counter & 3]}`;
    this.setT(E.btbL2, (x.hit ? 'HIT · ' : 'MISS · ') + cnt);
    this.setT(E.btbL3, `predict ${x.predicted ? 'TAKEN' : 'NOT TAKEN'} · ${x.taken ? 'taken' : 'not taken'} · ${x.right ? 'RIGHT' : `WRONG +${x.penalty} clk (${x.pipe})`}`);
    this.setA(E.btbL3, 'class', x.right ? 'dv-ph' : 'dv-mg');
  }
  // The TLBs: the code TLB, the data TLB (4 KB) and the data TLB (4 MB).
  renderTlb() {
    const E = this.els, c = this.m.cpu, P = dieP();
    if (!E.dtlb) return;
    const on = !!c.paging, L = this.p5.tlbLast;
    const paint = (G, T, kind) => {
      if (!G) return;
      const n = G.cells.length, cls = new Int8Array(n);
      for (let i = 0; i < T.length && i < n; i++) {
        const x = T[i], valid = on && x.valid;
        const last = !!(L && valid && ((kind === '4m' && L.big && !L.code && ((L.lin & 0xFFC00000) >>> 0) === x.lin) || (kind === '4k' && !L.big && !L.code && ((L.lin & 0xFFFFF000) >>> 0) === x.lin) || (kind === 'i' && L.code && ((L.lin & 0xFFFFF000) >>> 0) === x.lin)));
        cls[i] = !valid ? 0 : last ? (L.hit ? 3 : 4) : x.flags & 0x40 ? 2 : 1;
      }
      this.paintGrid(G, cls);
    };
    // the data TLB cells: column = set, row = way (the entry set * 4 + way)
    paint(E.dtlb, c.tlb, '4k');
    paint(E.dtlb4, c.tlb4m || [], '4m');
    paint(E.itlb, c.itlb || [], 'i');
    const st = c.tlbStats || { hits: 0, misses: 0, bigHits: 0, codeHits: 0, codeMisses: 0 };
    const f = v => (v || 0).toLocaleString('en-US');
    this.setT(E.tlbStat, on ? `hits ${f(st.hits)} (4 MB ${f(st.bigHits)}) · misses ${f(st.misses)}` : 'paging off: no TLB');
    this.setT(E.itlbNote, on ? `hits ${f(st.codeHits)} · misses ${f(st.codeMisses)}` : 'paging off');
    this.setT(E.tlbLast, L ? `${L.code ? 'code' : 'data'} ${dvHex8(L.lin)} ${L.hit ? 'HIT' : L.fault ? 'MISS · #PF' : 'MISS · walk'}${L.big ? ' · 4 MB' : ''}` : '');
    this.setA(E.tlbLast, 'class', L ? (L.hit ? 'dv-ph' : 'dv-mg') : 'dv-f');
  }
  renderPage() {
    const E = this.els;
    if (!E.wBox) return;
    const s = this.mdl.sys || {}, g = this.mdl.pg, B = E.wBox;
    if (!s.pg || !g) {
      this.placeWalkBoxes(false);
      B.forEach(x => this.setT(x.v, '---'));
      this.setT(E.wPde, 'PDE --------'); this.setT(E.wPte, 'PTE --------');
      this.setT(E.wSt, s.pg ? 'ON' : 'OFF'); this.setA(E.wSt, 'class', s.pg ? 'dv-lv' : 'dv-f');
      const sg = this.mdl.sig;
      this.setT(E.pgFrame, s.pg ? 'paging on' : 'paging off: linear = physical');
      this.setT(E.pgPhys, !s.pg && sg ? dvHex8(sg.lin !== undefined ? sg.lin : sg.phys) : '--------');
      return;
    }
    const big = !!g.big;
    this.placeWalkBoxes(big);
    this.setT(B[0].v, hex(g.lin >>> 22, 3));
    this.setT(B[1].v, hex((g.lin >>> 12) & 0x3FF, 3));
    this.setT(B[2].v, big ? hex(g.lin & 0x3FFFFF, 6) : hex(g.lin & 0xFFF, 3));
    this.setT(E.wPde, 'PDE ' + (g.pde === null || g.pde === undefined ? '--------' : dvHex8(g.pde)));
    this.setT(E.wPte, big ? 'PS = 1: no PTE' : 'PTE ' + (g.hit || g.pte === null || g.pte === undefined || (g.fault && !(g.pde & 1)) ? '--------' : dvHex8(g.pte)));
    this.setT(E.wSt, g.fault ? '#PF' : g.hit ? 'HIT' : 'WALK');
    this.setA(E.wSt, 'class', g.fault ? 'dv-mg' : g.hit ? 'dv-ph' : 'dv-lv');
    if (g.fault) { this.setT(E.pgFrame, `not present · error ${hex2(g.err || 0)}`); this.setT(E.pgPhys, '--------'); }
    else {
      this.setT(E.pgFrame, big ? `4 MB frame ${hex(g.phys >>> 22, 3)} + ${hex(g.lin & 0x3FFFFF, 6)}` : `frame ${hex(g.phys >>> 12, 5)} + ${hex(g.lin & 0xFFF, 3)}`);
      this.setT(E.pgPhys, dvHex8(g.phys));
    }
  }
  renderFpx() {
    const E = this.els, F = this.p5.fpuP, c = this.m.cpu;
    if (!E.fpUnit) return;
    const t = F ? F.text : '';
    this.setT(E.fpOp, t ? (t.length > 30 ? t.slice(0, 29) + '…' : t) : 'idle');
    this.setA(E.fpOp, 'class', t ? 'dv-lv' : 'dv-f');
    this.setT(E.fpClk, F && F.cyc ? `${F.cyc} clocks` : '');
    const u = /^F(I?ADD|I?SUB|I?COM|UCOM|TST|ABS|CHS|RND)/i.test(t) ? 0 : /^FI?MUL/i.test(t) ? 1 : /^F(I?DIV|SQRT|PREM)/i.test(t) ? 2 : -1;
    E.fpUnit.forEach((x, i) => {
      this.setA(x.d, 'fill', i === u ? THEME.lavender : dieP().dot);
      this.setA(x.r, 'stroke', i === u ? THEME.lavender : dieP().cellStroke);
    });
    this.setT(E.fpNote, c.fdivBug ? 'the FDIV bug model is ON (cpu.fdivBug)' : 'FDIV: the correct divider (no FDIV bug)');
    this.setA(E.fpNote, 'class', c.fdivBug ? 'dv-mg' : 'dv-f');
  }
  renderBusText() {
    const b = this.mdl.bus, E = this.els;
    if (!E.laA || !b) return;
    const e = b.e, io = b.type === 'ior' || b.type === 'iow';
    this.setT(E.laA, b.type === 'inta' ? 'A vector' : io ? 'port ' + hex4(e.addr) : 'A ' + dvHex8(e.addr & ~7) + (e.addr & 7 ? ` + ${e.addr & 7}` : ''));
    this.setT(E.xcDir, (/w/.test(b.type) ? 'write' : 'read') + (e.dev ? ' · ' + e.dev : '') + ` · ${e.burst ? 8 : e.width || 1} byte${(e.burst ? 8 : e.width || 1) > 1 ? 's' : ''}` +
      (b.req === 'page' ? ' · page table' : e.burst ? (e.wb ? ' · write-back burst' : ' · burst') : ''));
  }
  renderPei() { }
  renderIq() { }
  renderD12() { }
  renderFpu() { this.renderFpu486(); }
  renderFpu486() {
    super.renderFpu486();
    const E = this.els;
    if (E.fBug) this.setT(E.fBug, '');
  }
}

// ======================================================================================
// Pentium Pro die (app.model '80686', the CPU80686 core). Two dies in one package: the CPU
// die and the 256 KB L2 die, joined by the back-side bus. The CPU die follows the real floor
// plan in spirit: the in-order front end at the top (the L1 code cache, the BTB, the fetch
// unit, the three decoders and the MSROM), the out-of-order core in the middle (the RAT, the
// ROB, the reservation station and the retirement registers) and the execution units, the
// memory order buffer, the L1 data cache, the TLBs and the bus unit at the bottom.
// The view replays the model clocks of each instruction: its µops go from the decoders
// through the RAT into the ROB and the RS, wait for their operands, go to the ports, and
// retire in program order. The view keeps its own history of the µops (the ROB of the core
// keeps only the newest 40).
// ======================================================================================

const D686_PADS_T = ['VCC', 'BCLK', 'RESET', 'INIT', 'PWRGOOD', 'VSS', 'ADS', 'REQ0', 'REQ1', 'REQ2', 'REQ3', 'REQ4', 'BNR', 'BPRI', 'BR0', 'VCC', 'VSS',
  'DRDY', 'DBSY', 'TRDY', 'RS0', 'RS1', 'RS2', 'RSP', 'HIT', 'HITM', 'DEFER', 'LOCK', 'AERR', 'BERR', 'BINIT', 'IERR', 'VCC', 'VSS', 'A20M', 'FLUSH',
  'SMI', 'STPCLK', 'LINT0', 'LINT1', 'FERR', 'IGNNE', 'PICCLK', 'PICD0', 'PICD1', 'THERMTRIP', 'VCC', 'VSS', 'TCK', 'TDI'];
const D686_PADS_R = ['TDO', 'TMS', 'TRST', 'VSS'].concat(Array.from({ length: 30 }, () => 'BSB'), ['VCC', 'VSS']);
const D686_PADS_B = [].concat(Array.from({ length: 16 }, (_, i) => 'D' + i), ['VCC'], Array.from({ length: 16 }, (_, i) => 'D' + (16 + i)), ['VSS'],
  Array.from({ length: 16 }, (_, i) => 'D' + (32 + i)), ['VCC'], Array.from({ length: 16 }, (_, i) => 'D' + (48 + i)), ['VSS', 'DEP0', 'DEP1', 'DEP2', 'DEP3']);
const D686_PADS_L = ['DEP4', 'DEP5', 'DEP6', 'DEP7', 'AP0', 'AP1', 'VCC'].concat(Array.from({ length: 33 }, (_, i) => 'A' + (3 + i)), ['VSS', 'VID0', 'VID1', 'VID2', 'VID3']);
const D686_PADS = D686_PADS_T.concat(D686_PADS_R, D686_PADS_B, D686_PADS_L);
// the bus signals of the P6 are GTL+ signals: all of them are active low
const D686_HIGH = new Set(['VCC', 'VSS', 'BCLK', 'PWRGOOD', 'LINT0', 'LINT1', 'PICCLK', 'PICD0', 'PICD1', 'TCK', 'TDI', 'TDO', 'TMS', 'BSB', 'VID0', 'VID1', 'VID2', 'VID3']);
const D686_UNUSED = new Set(['INIT', 'AP0', 'AP1', 'DEP0', 'DEP1', 'DEP2', 'DEP3', 'DEP4', 'DEP5', 'DEP6', 'DEP7', 'RSP', 'AERR', 'BERR', 'BINIT', 'IERR',
  'DEFER', 'FLUSH', 'SMI', 'STPCLK', 'PICCLK', 'PICD0', 'PICD1', 'THERMTRIP', 'TCK', 'TDI', 'TDO', 'TMS', 'TRST', 'VID0', 'VID1', 'VID2', 'VID3',
  'A32', 'A33', 'A34', 'A35']);
// Unit rectangles of the landscape plan: [x, y, w, h]. The portrait plan moves them by 'off'.
const D686_UNITS = {
  fr: [48, 48, 558, 316], dc: [606, 48, 490, 316], ms: [1098, 48, 352, 316],
  ra: [48, 376, 252, 316], ro: [300, 376, 620, 316], rs: [920, 376, 260, 316], rr: [1180, 376, 270, 316],
  ex: [48, 704, 512, 248], mo: [560, 704, 240, 248], dm: [800, 704, 336, 248], dt: [1136, 704, 134, 248], bi: [1270, 704, 182, 248],
};
const D686_Z = { fr: [0, 0], dc: [0, 0], ms: [0, 0], ra: [0, 0], ro: [0, 0], rs: [0, 0], rr: [0, 0], ex: [0, 0], mo: [0, 0], dm: [0, 0], dt: [0, 0], bi: [0, 0] };
const D686_ARR = {
  L: { W: 1500, H: 1000, pads: [50, 36, 72, 45], gaps: [370, 698], spines: [300, 920, 1180], off: D686_Z,
    bsb: [[1448, 760], [1500, 760], [1530, 760], [1530, 380], [1560, 380], [1576, 380]] },
  P: { W: 1210, H: 1328, pads: [46, 55, 46, 56], gaps: [370, 698, 1026], spines: [664, 1023],
    off: { fr: [0, 0], dc: [0, 0], ms: [-430, 328], ra: [0, 328], ro: [-252, 0], rs: [-620, 328], rr: [-620, 328], ex: [0, 328], mo: [270, 0],
      dm: [-240, 328], dt: [-110, -328], bi: [-374, 328] },
    bsb: [[986, 1272], [986, 1328], [986, 1352], [986, 1386]] },
};
// the L2 die (relative to its own corner) and the layouts of the two dies
const D686_L2 = { L: { w: 480, h: 640 }, P: { w: 1210, h: 320 } };
const DIE686_LAYOUTS = {
  wide: { W: 2100, H: 1040, p86: [20, 20], p87: [1580, 20], side: 'left', up: false, legend: [1590, 720], keep: [[60, 60, 1420, 920], [1600, 40, 440, 600]] },
  row: { W: 2100, H: 1040, p86: [20, 20], p87: [1580, 20], side: 'left', up: false, legend: null, keep: [[60, 60, 1420, 920], [1600, 40, 440, 600]] },
  tall: { W: 1250, H: 1730, p86: [20, 20], p87: [20, 1390], side: 'top', up: false, legend: null, keep: [[60, 60, 1130, 1250], [40, 1400, 1170, 300]] },
};
const D686_CR4 = [['TSD', 2], ['DE', 3], ['PSE', 4], ['MCE', 6], ['PGE', 7], ['PCE', 8]];
const D686_KSHORT = { alu: 'ALU', shift: 'SHF', lea: 'LEA', mul: 'MUL', div: 'DIV', branch: 'BR', load: 'LD', sta: 'STA', std: 'STD', esp: 'ESP',
  fadd: 'FAD', fmul: 'FML', fdiv: 'FDV', fmov: 'FMV', fxch: 'FXC', fcmp: 'FCM', cmov: 'CMV', msrom: 'MS', nop: 'NOP' };
const D686_WAITS = ['', 'operand', 'store data', 'store buffer', 'divider', 'fmul', 'port'];
const D686_DECS = ['D0', 'D1', 'D2', 'MS'];
const D686_OREGS = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI', 'EFLAGS', 'FSW'];
// the units of each port (the lamp of a unit lights when a µop of its kinds runs)
const D686_PORTS = [
  { id: 'p0', x: 56, w: 150, title: 'PORT 0', units: [['IEU', /^(alu|esp|cmov|msrom|nop)$/], ['SHIFT LEA', /^(shift|lea)$/], ['MUL', /^mul$/], ['DIV', /^div$/], ['FEU', /^f/]] },
  { id: 'p1', x: 210, w: 96, title: 'PORT 1', units: [['IEU', /^(alu|esp|cmov|msrom|nop)$/], ['JEU', /^branch$/]] },
  { id: 'p2', x: 310, w: 80, title: 'PORT 2', units: [['LOAD', /^load$/]] },
  { id: 'p3', x: 394, w: 78, title: 'PORT 3', units: [['STA', /^sta$/]] },
  { id: 'p4', x: 476, w: 76, title: 'PORT 4', units: [['STD', /^std$/]] },
];
const DIE686_INFO = {
  icache: ['L1 code cache, 8 KB', 'The code cache: 64 sets of 4 ways, 32 bytes in each line. Bits 5 to 10 of the physical address select the set, bits 11 to 31 are the tag. The fetch unit reads 16 bytes from it each clock. A miss asks the L2 on the back-side bus; an L2 miss fills the line from memory on the front-side bus. Code lines are only S (valid) or I (invalid).'],
  itlb: ['Code TLB', 'The TLB of the fetch unit: 32 entries in 8 sets of 4 ways. A bright cell is a valid entry. With CR4.PGE = 1, an entry of a global page stays after a write to CR3.'],
  btb: ['Branch target buffer (two-level prediction)', 'The BTB keeps 512 branches: 128 sets of 4 ways. Each entry has the target, the history of the last 4 outcomes of the branch (1 = taken) and a table of 16 two-bit counters. The history selects one counter: 2 or 3 predicts "taken". So the BTB can predict a pattern such as taken, taken, not taken. A branch that is not in the BTB gets a static prediction from the decoder: backward taken, forward not taken. RET uses the return stack buffer (16 return addresses). A wrong prediction removes all µops after the branch, and the fetch starts again at the correct address.'],
  ifu: ['Instruction fetch unit', 'The fetch unit reads 16 bytes of code each clock from the L1 code cache, at the address that the BTB predicts. The instruction length decoder marks where each instruction starts, and the bytes go to the three decoders. The chips show the bytes in the fetch queue.'],
  dec: ['Three decoders (the 4-1-1 rule)', 'Up to three x86 instructions become µops in one clock. D0 decodes all instructions of 1 to 4 µops. D1 and D2 decode only instructions of 1 µop. So an instruction of 2 to 4 µops must go to D0, and it starts a new decode group. An instruction of more than 4 µops goes to the MSROM. The decoders send up to 6 µops each clock to the RAT.'],
  msrom: ['MSROM and control registers', 'The microcode sequencer ROM makes the µops of the complex instructions (more than 4 µops, REP strings, far transfers, CPUID, interrupts): 4 µops each clock. CR0 and CR4 are the control registers. CR4 has TSD (RDTSC only at CPL 0), DE (debug extensions), PSE (4 MB pages), MCE (machine check), PGE (global pages) and PCE (RDPMC at all CPL). The TSC counts each clock of the CPU.'],
  rat: ['Register alias table (RAT)', 'The RAT renames the registers. For each architectural register it keeps the ROB entry of the newest µop that writes it. A µop that reads EAX gets the ROB entry of the producer, not EAX itself. So µops that write the same register do not wait for each other. "RRF" means that the value is in the retirement registers (the producer retired). The RAT renames 3 µops each clock, in program order.'],
  rob: ['Reorder buffer (ROB), 40 entries', 'The ROB is a ring of 40 entries. Each µop gets the next entry at the allocate pointer, in program order. The entry keeps the result of the µop (it is the physical register). A µop can execute before older µops (out of order), but it retires only in program order: up to 3 µops each clock at the retire pointer, and only when all older µops retired. The colour of an entry is its state: waiting for an operand, ready, executing, done, retire. The chart at the right shows the model clocks of each µop of this instruction. After a wrong prediction the view shows the µops of the wrong path as dashed entries: the CPU removes them when the jump unit finds the wrong prediction.'],
  rs: ['Reservation station (RS), 20 entries', 'A µop waits here from its issue until its dispatch. The two dots are its sources: a bright dot is a ready operand. When all sources are ready and its port is free, the RS sends the µop to the port: up to 5 µops each clock, one to each port. An older µop that waits does not stop a younger ready µop.'],
  rrf: ['Retirement registers (RRF)', 'The architectural state: the registers that a program sees. A value comes here only when its µop retires, in program order. The FPU registers are here too (the stack at the bottom). An exception or a wrong prediction does not change this state: the µops after it do not retire.'],
  p0: ['Port 0: IEU, FEU, multiplier, divider', 'Port 0 takes one µop each clock: the integer unit (ALU, shifts, LEA), the multiplier (4 clocks, a new µop each clock), the divider (19 to 39 clocks for DIV; one divide at a time) and the floating-point unit (FADD 3, FMUL 5, FDIV 17 to 37 clocks). A long µop keeps its unit busy, but the port can take other µops.'],
  p1: ['Port 1: IEU and JEU', 'Port 1 has a second integer unit and the jump unit (JEU). The JEU checks each branch: when the prediction was wrong, it tells the fetch unit to start again at the correct address, and all younger µops go away.'],
  p2: ['Port 2: load unit', 'The load unit calculates the address of a load (the address generation unit) and reads the L1 data cache: 3 clocks for a hit, 7 for an L2 hit, more for a miss. A load waits for the addresses of all older stores. When an older store has the same bytes, the store buffer gives them (store forwarding).'],
  p3: ['Port 3: store address', 'The STA µop of a store calculates its address and writes it into the store buffer. Younger loads compare their addresses with it.'],
  p4: ['Port 4: store data', 'The STD µop of a store puts the data into the store buffer. The store goes to the L1 data cache only after it retires, in program order.'],
  mob: ['Memory order buffer (MOB)', 'The load buffer and the store buffer (12 entries) keep the memory order. A store stays in the store buffer until it retires; then it goes into the cache (one each clock). A load that finds its bytes in an older store gets them from the store buffer. A load of more bytes than the store has must wait until the store is in the cache.'],
  dcache: ['L1 data cache, 8 KB', 'The data cache: 128 sets of 2 ways, 32 bytes in each line, write-back and write-allocate. Each line has a MESI state: M modified, E exclusive, S shared, I invalid. A write miss first reads the line (RFO), then the line is M. An M line that a fill replaces goes into the L2. A miss asks the L2 on the back-side bus.'],
  dtlb: ['Data TLB and page miss handler', 'Two TLBs for the data: 64 entries for 4 KB pages and 8 entries for 4 MB pages. On a TLB miss the page miss handler reads the page directory entry and the page table entry. With CR4.PGE = 1, a page with G = 1 is global: its entry stays after a write to CR3.'],
  biu: ['Bus unit: front-side bus and back-side bus', 'The front-side bus runs at 66 MHz (the core runs 3 times faster) with 64 data bits. It is a pipelined bus: each transaction has a request phase (ADS#, REQ4-REQ0#, the address), an error phase, a snoop phase (HIT#, HITM#), a response phase (RS2-RS0#) and a data phase (DRDY#, DBSY#, TRDY# for a write). A line fill is a burst of 4 transfers of 8 bytes. The back-side bus goes to the L2 die at the core clock.'],
  l2: ['L2 cache, 256 KB (the second die)', 'The L2 cache is a separate SRAM die in the same package. It has 2048 sets of 4 ways, 32 bytes in each line: bits 5 to 15 of the physical address select the set, bits 16 to 31 are the tag. The CPU reads it on the back-side bus at the full core clock: an L2 hit costs 4 clocks more than an L1 hit and needs no front-side bus cycle. Each pixel is one line; its colour is the MESI state.'],
  bsb: ['Back-side bus', 'The private bus between the CPU die and the L2 die: 64 data bits at the core clock (200 MHz). The front-side bus does not see these accesses.'],
  pads: ['Pads (387 pins in the package)', 'A35-A3#, D63-D0#, the request signals (ADS#, REQ4-REQ0#), the arbitration (BR0#, BPRI#, BNR#), the snoop (HIT#, HITM#), the response (RS2-RS0#, TRDY#) and the data phase (DRDY#, DBSY#). All bus signals are GTL+ and active low. The pads at the right go to the L2 die (the back-side bus). This board does not use the dim pads.'],
};
// Double-click: the block label on the Pentium Pro floor plan of the 3D board.
const DIE686_3D = {
  icache: ['cpu', 'L1 CODE CACHE'], itlb: ['cpu', 'CODE TLB'], btb: ['cpu', 'BTB'], ifu: ['cpu', 'L1 CODE CACHE'], dec: ['cpu', 'DECODERS'],
  msrom: ['cpu', 'MSROM'], rat: ['cpu', 'RAT'], rob: ['cpu', 'ROB'], rs: ['cpu', 'RESERVATION STATION'], rrf: ['cpu', 'RETIREMENT REGISTERS'],
  p0: ['cpu', 'PORT 0 IEU FEU'], p1: ['cpu', 'PORT 1 IEU JEU'], p2: ['cpu', 'LOAD UNIT'], p3: ['cpu', 'STORE UNIT'], p4: ['cpu', 'STORE UNIT'],
  mob: ['cpu', 'MEMORY ORDER BUFFER'], dcache: ['cpu', 'L1 DATA CACHE'], dtlb: ['cpu', 'DATA TLB'], biu: ['cpu', 'BUS INTERFACE'],
  l2: ['cpu', null], bsb: ['cpu', 'BUS INTERFACE'], pads: ['cpu', null], flags: ['cpu', 'RETIREMENT REGISTERS'], fstk: ['cpu', 'FPU'],
};
// Token end points: the unit, a point on the edge of the block (landscape coordinates) and how the
// point goes to the internal buses ('dn' / 'up' to the bus below / above; 'gl' / 'gr': to the
// gutter at the left / right (x), then to the nearest bus).
const D686_PTS = {
  icache: ['fr', 216, 356, 'dn'], itlb: ['fr', 493, 132, 'gr', 603], btb: ['fr', 493, 356, 'dn'],
  ifu: ['dc', 725, 356, 'dn'], dec: ['dc', 969, 356, 'dn'], msrom: ['ms', 1272, 356, 'dn'],
  rat: ['ra', 174, 384, 'up'], rob: ['ro', 610, 384, 'up'], rs: ['rs', 1050, 684, 'dn'], rrf: ['rr', 1315, 384, 'up'],
  p0: ['ex', 131, 712, 'up'], p1: ['ex', 258, 712, 'up'], p2: ['ex', 350, 712, 'up'], p3: ['ex', 433, 712, 'up'], p4: ['ex', 514, 712, 'up'],
  mob: ['mo', 680, 712, 'up'], dcache: ['dm', 968, 712, 'up'], dtlb: ['dt', 1203, 712, 'up'], biu: ['bi', 1361, 712, 'up'],
};
// the names of the older views (the 386, 486 and Pentium code) for the same end points
const D686_ALIAS = {
  cache: 'icache', xcvr: 'biu', ring: 'biu', addrdrv: 'biu', addr4: 'biu', latch: 'biu', burst: 'biu', wbuf: 'mob', lfill: 'biu',
  pfq: 'ifu', qhead: 'ifu', pfa: 'ifu', pfb: 'ifu', iq: 'dec', EIP: 'rrf', ctl: 'msrom', cr: 'msrom', sys: 'msrom', rom: 'msrom', prot: 'msrom',
  ctag: 'dcache', tlb: 'dtlb', walker: 'dtlb', pgadd: 'dtlb', linadd: 'p2', sigma: 'p2', limchk: 'p2', desc: 'rrf', seg: 'rrf', regs: 'rrf', flags: 'rrf',
  fman: 'p0', fexp: 'p0', fpx: 'p0', fstk: 'rrf', aluU: 'p0', aluV: 'p1', aluA: 'p0', aluB: 'p0', aluOut: 'p0', muldiv: 'p0', barrel: 'p0',
  upipe: 'p0', vpipe: 'p1', pei: 'p0',
  ES: 'rrf', CS: 'rrf', SS: 'rrf', DS: 'rrf', FS: 'rrf', GS: 'rrf',
};

class Die686View extends Die586View {
  constructor(host, app) {
    super(host, app);
    if (!document.getElementById('dv-style-686')) {
      htmlEl('style', { id: 'dv-style-686' }, document.head, `:root.m686 .dv-l2img{image-rendering:pixelated;image-rendering:crisp-edges}
:root.m686 .dv-cell.dv-bad rect{fill:${dvMix(THEME.magenta, THEME.panel, 0.7)};stroke:var(--magenta)}
:root.m686 .dv-cell.dv-bad text.dv-b{fill:var(--text)}
:root.m686 .dv-svg text.dv-rb{fill:var(--void)}`);
    }
    this.svg.setAttribute('aria-label', 'Die floor plan of the Pentium Pro: the CPU die (the decoders, the RAT, the reorder buffer, the reservation station, the five ports, two 8 KB caches) and the 256 KB L2 die in the same package. The plus and minus keys zoom, the 0 key fits the dies.');
  }
  info(id) { return DIE686_INFO[id] || DIE586_INFO[id] || DIE486_INFO[id] || DIE386_INFO[id] || DIE286_INFO[id] || DIE_INFO[id]; }
  map3D() { return DIE686_3D; }
  layoutSet() { return DIE686_LAYOUTS; }
  // the fetch queue: 32 bytes in four rows of 8 chips
  get QN() { return 32; }
  get QX0() { return 642; }
  get QDX() { return 25; }
  get QY() { return 106; }
  get QH() { return 20; }
  get QW() { return 22; }
  get QF() { return 10; }
  qx(slot) { return this.QX0 + (slot % 8) * this.QDX; }
  qy(slot) { return this.QY + Math.floor(slot / 8) * 26; }
  mhz() { return ((this.m.clockHz || 200000000) / 1e6).toFixed(0) + ' MHz'; }
  busRatio() { const b = this.m.bus; return (b && b.busRatio) || this.m.cpu.busRatio || 3; }
  legendSub() { return `Intel Pentium Pro (P6), ${this.mhz()}: out of order, 256 KB L2 in the package`; }
  // The view state of the out-of-order parts (only the view writes it). H = the µop history.
  ooState() {
    const H = 512;
    return {
      id: new Float64Array(H).fill(-1), n: new Float64Array(H), rob: new Int8Array(H), rs: new Int8Array(H).fill(-1), kind: new Uint8Array(H),
      port: new Int8Array(H), dst: new Int8Array(H), s1: new Int8Array(H), s2: new Int8Array(H), iss: new Float64Array(H), dis: new Float64Array(H),
      done: new Float64Array(H), ret: new Float64Array(H), r1: new Float64Array(H), r2: new Float64Array(H), wait: new Uint8Array(H), src: new Array(H).fill(''),
      // the steps (instructions): the number, the text, the decode clock, the decoder, the µops
      sN: new Float64Array(64).fill(-1), sText: new Array(64).fill(''), sDclk: new Float64Array(64), sDec: new Int8Array(64), sUops: new Uint16Array(64),
      cur: null, t0: 0, t1: 1, vt: 0, play: null, tr: null, ver: 0, drawn: '', lastTc: -1,
      robCur: new Int16Array(40), robRet: new Int16Array(40), rsCur: new Int16Array(20), ratJ: new Int16Array(10),
      l2T: 0, l2Key: -1, fastPrev: new Float64Array(16),
    };
  }

  // ---------- the Pentium Pro die ----------
  upt(u, x, y) { const o = this.arr.off[u]; return [x + o[0], y + o[1]]; }
  build86(g) {
    const E = this.els, P = dieP();
    if (!this.p5) this.p5 = this.p5State();
    if (!this.oo) this.oo = this.ooState();
    this.walkBig = null;
    const A = this.arr = D686_ARR[this.kind === 'tall' ? 'P' : 'L'], W = A.W, H = A.H;
    this.g86 = g;
    E.desc = {};
    svgEl('rect', { x: -6, y: -6, width: W + 12, height: H + 12, rx: 10, fill: P.dieShadow, stroke: THEME.line }, g);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 4, fill: 'url(#dv-si)' }, g);
    const tex = DieView.texture(W, H, 80686);
    if (tex) svgEl('image', { href: tex, x: 0, y: 0, width: W, height: H, 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 4, fill: 'url(#dv-sheen)', 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 3.5, y: 3.5, width: W - 7, height: H - 7, rx: 3, fill: 'none', stroke: P.scribe, 'stroke-width': 1, opacity: 0.6 }, g);
    E.ring = svgEl('rect', { x: 38, y: 38, width: W - 76, height: H - 76, rx: 8, fill: 'none', stroke: P.scribe, 'stroke-width': 3, opacity: 0.55 }, g);
    // the internal buses: the gaps between the rows, the spines, a stub for each end point
    const bus = (d, col, w, op) => svgEl('path', { d, class: 'dv-bus', stroke: col, 'stroke-width': w, opacity: op }, g);
    const G = A.gaps;
    E.gBus = bus(G.map(y => `M50 ${y}H${W - 50}`).join('') + A.spines.map(x => `M${x} ${G[0]}V${G[G.length - 1]}`).join(''), P.busMain, 5, 0.55);
    const stubs = [];
    for (const k in D686_PTS) {
      const p = this.point(k);
      if (p && p.pts) stubs.push('M' + p.pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L'));
    }
    bus(stubs.join(''), P.busMain, 2.2, 0.45);
    const bp = A.bsb;
    E.bsbIn = bus('M' + bp.slice(0, 2).map(q => q.join(' ')).join('L'), P.busA, 3, 0.7);
    this.txt(g, 'µOP BUS · RESULT BUS', W - 56, G[0] - 5, 10, 'dv-m', 'end');
    this.txt(g, 'LOAD BUS · STORE BUS · 64 BITS', 60, G[1] - 5, 10, 'dv-m');
    // the units: each one is a group that the floor plan moves
    const regPG = dvMix(THEME.magenta, THEME.void, 0.55), regC = dvMix(THEME.cyan, THEME.void, 0.45);
    const unit = u => svgEl('g', { transform: `translate(${A.off[u][0]} ${A.off[u][1]})` }, g);
    const region = (p, r, col, fill) => svgEl('rect', { x: r[0], y: r[1], width: r[2], height: r[3], rx: 2, fill, stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': '6 5', opacity: 0.85 }, p);
    const tab = (p, x, y, t, col) => {
      const w = strokeTextWidth(t, 9, 1.4) + 14;
      svgEl('rect', { x, y: y - 8, width: w, height: 16, rx: 3, fill: P.tabFill, stroke: col, 'stroke-width': 1.2 }, p);
      this.silk(p, t, x + 7, y - 4.5, 9, 'dv-silk');
    };
    const UNITS = [
      ['fr', regC, dvA(THEME.gold, 0.03), 'FETCH AND BRANCH'], ['dc', P.regBU, dvA(THEME.gold, 0.025), 'IN-ORDER FRONT END'],
      ['ms', P.regEU, dvA(THEME.phosphor, 0.02), 'MICROCODE AND CONTROL'], ['ra', regPG, dvA(THEME.magenta, 0.025), 'RENAME'],
      ['ro', P.regBIU, dvA(THEME.cyan, 0.03), 'OUT-OF-ORDER CORE'], ['rs', P.regBIU, dvA(THEME.cyan, 0.025), 'SCHEDULE'],
      ['rr', P.regEU, dvA(THEME.phosphor, 0.025), 'RETIRE'], ['ex', P.regEU, dvA(THEME.phosphor, 0.02), 'EXECUTION UNITS  5 PORTS'],
      ['mo', regPG, dvA(THEME.magenta, 0.025), 'MEMORY ORDER'], ['dm', regC, dvA(THEME.cyan, 0.03), 'L1 DATA'],
      ['dt', P.regAU, dvA(THEME.lavender, 0.03), 'PAGING'], ['bi', P.regBU, dvA(THEME.gold, 0.025), 'BUS UNIT'],
    ];
    const U = {};
    for (const [u, col, fill] of UNITS) { U[u] = unit(u); region(U[u], D686_UNITS[u], col, fill); }
    this.buildIcache686(U.fr); this.buildItlb686(U.fr); this.buildBtb686(U.fr);
    this.buildIfu686(U.dc); this.buildDec686(U.dc); this.buildMs686(U.ms);
    this.buildRat686(U.ra); this.buildRob686(U.ro); this.buildRs686(U.rs); this.buildRrf686(U.rr);
    this.buildPorts686(U.ex); this.buildMob686(U.mo); this.buildDcache686(U.dm); this.buildDtlb686(U.dt); this.buildBiu686(U.bi);
    for (const [u, col, , t] of UNITS) { const r = D686_UNITS[u]; tab(U[u], r[0] + 14, r[1], t, col); }
    this.buildPads686(g);
    this.buildOverlay486(g);
    this.tokLayer = svgEl('g', { class: 'dv-toks', 'pointer-events': 'none' }, g);
  }
  buildPads686(g) {
    const pg = this.block(g, 'pads', 0, 0, 0, 0, '');
    pg.querySelector('.dv-frame').setAttribute('display', 'none');
    const A = this.arr, [nT, nR] = A.pads;
    const sH = (A.W - 100) / nT, sV = (A.H - 100) / nR, bonds = [];
    const bondEl = svgEl('path', { d: '', stroke: dieP().bond, 'stroke-width': 1.1, opacity: 0.55, fill: 'none' }, pg);
    D686_PADS.forEach((name, i) => {
      const p = Die486View.padPos486(i, A);
      const out = 9;
      const [bx, by] = p.side === 'l' ? [-out, p.y] : p.side === 'r' ? [A.W + out, p.y] : p.side === 't' ? [p.x, -out] : [p.x, A.H + out];
      bonds.push(`M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`);
      const cls = 'dv-pad' + (D686_UNUSED.has(name) ? ' dv-nc' : '');
      const c = svgEl('g', { class: cls }, pg);
      const w = p.v ? 22 : Math.min(31, sH - 3), h = p.v ? Math.min(30, sV - 3) : 22;
      svgEl('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 3 }, c);
      const size = name.length > 5 ? 5.2 : name.length > 4 ? 6 : name.length > 3 ? 6.8 : 7.6;
      const t = this.txt(c, name, p.x, p.y + size * 0.36, size, '', 'middle', p.v ? { transform: `rotate(-90 ${p.x} ${p.y})` } : null);
      t.removeAttribute('class');
      svgEl('title', null, c).textContent = name === 'BSB' ? 'the back-side bus to the L2 die' : name + (D686_HIGH.has(name) ? '' : '# (active low)') + (D686_UNUSED.has(name) ? ': this board does not use it' : '');
      this.els.pads.push({ c, name, p, base: cls });
    });
    bondEl.setAttribute('d', bonds.join(''));
  }
  // ---- the L1 caches: k = 'i' (code, 64 sets x 4 ways) or 'd' (data, 128 sets x 2 ways) ----
  buildCacheL1(b, k, o) {
    const E = this.els, P = dieP(), code = k === 'i';
    const C = E[k + 'C'] = { gx0: o.gx0, gy0: o.gy0, cw: o.cw, ch: o.ch, ww: o.ww, cols: o.cols, nw: o.ways, grid: null };
    const nsets = code ? 64 : 128, rows = nsets / o.cols;
    for (let col = 0; col < o.cols; col += o.lstep) this.txt(b, '+' + col, o.gx0 + col * o.cw + o.cw / 2 - 1, o.gy0 - 3, 6, 'dv-f', 'middle');
    for (let row = 0; row < rows; row++) this.txt(b, hex2(row * o.cols), o.gx0 - 4, o.gy0 + row * o.ch + o.ch * 0.7, 6, 'dv-f', 'end');
    const geo = [];
    for (let s = 0; s < nsets; s++) {
      const x0 = o.gx0 + (s % o.cols) * o.cw, yy = o.gy0 + Math.floor(s / o.cols) * o.ch;
      for (let w = 0; w < o.ways; w++) geo.push([x0 + w * o.ww, yy, o.ww - 1, o.ch - 1.6]);
    }
    const mx = col => [dvMix(col, THEME.panel, 0.4), dvMix(col, THEME.panel, 0.1)];
    C.grid = this.mkGrid(b, geo, code ? [[P.row0, P.cellStroke], mx(THEME.gold), [THEME.goldHi, THEME.goldHi]]
      : [[P.row0, P.cellStroke], mx(THEME.cyan), mx(THEME.phosphor), [dvMix(THEME.magenta, THEME.panel, 0.25), dvMix(THEME.magenta, THEME.panel, 0.1)], [THEME.goldHi, THEME.goldHi]]);
    const sw = o.ways * o.ww;
    C.setMark = svgEl('rect', { x: 0, y: 0, width: sw + 2, height: o.ch + 0.6, rx: 2, fill: 'none', stroke: THEME.cyan, 'stroke-width': 1.2, opacity: 0, 'pointer-events': 'none' }, b);
    C.setFl = svgEl('rect', { x: 0, y: 0, width: sw + 2, height: o.ch + 0.6, rx: 2, fill: dvA(THEME.cyan, 0.3), stroke: THEME.cyan, 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }, b);
    C.wayFl = svgEl('rect', { x: 0, y: 0, width: o.ww + 1, height: o.ch, rx: 1.5, fill: dvA(THEME.phosphor, 0.5), stroke: THEME.phosphor, 'stroke-width': 1.6, opacity: 0, 'pointer-events': 'none' }, b);
    // tag compare: the address in three parts, the ways of the set, the result
    const ty = o.ty, x0 = o.x0, x1 = o.x1;
    C.addr = this.txt(b, '--------', x0, ty + 14, 10.5, 'dv-cy', 'start', { 'font-weight': 700 });
    const box = (x, w, lab, col) => {
      svgEl('rect', { x, y: ty, width: w, height: 20, rx: 3, fill: P.row1, stroke: col, 'stroke-width': 1 }, b);
      this.txt(b, lab, x + w / 2, ty + 6.5, 5.5, 'dv-f', 'middle');
      return this.txt(b, '--', x + w / 2, ty + 17, 9, 'dv-v', 'middle', { 'font-weight': 700 });
    };
    const bx = x1 - 158;
    C.tag = box(bx, 66, code ? 'TAG 31–11' : 'TAG 31–12', THEME.cyan);
    C.set = box(bx + 70, 44, code ? 'SET 10–5' : 'SET 11–5', THEME.magenta);
    C.ofs = box(bx + 118, 40, 'OFFSET 4–0', THEME.gold);
    C.ways = [];
    for (let w = 0; w < o.ways; w++) {
      const yy = ty + 24 + w * 13.6;
      const bg = svgEl('rect', { x: x0 - 2, y: yy, width: x1 - x0 + 4, height: 12.4, rx: 3, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      this.txt(b, 'WAY ' + w, x0 + 3, yy + 9.2, 7.5, 'dv-m', 'start', { 'font-weight': 700 });
      const t = this.txt(b, '-----', x0 + 40, yy + 9.4, 8.5, 'dv-f', 'start', { 'font-weight': 600 });
      const st = this.txt(b, '', x0 + 90, yy + 9.4, 8.5, 'dv-f', 'start', { 'font-weight': 700 });
      const a = this.txt(b, '', x0 + 104, yy + 9.2, 7, 'dv-f');
      const m = this.txt(b, '', x1, yy + 9.4, 8, 'dv-f', 'end', { 'font-weight': 700 });
      C.ways.push({ bg, t, st, a, m });
    }
    const ry = ty + 24 + o.ways * 13.6 + 12;
    C.res = this.txt(b, 'no access yet', x0, ry, 9.5, 'dv-f', 'start', { 'font-weight': 700 });
    C.note = this.txt(b, '', x1, ry, 7, 'dv-f', 'end');
    // the line fill (or the write-back): 4 transfers of 8 bytes in address order
    const fy = ry + 6, fw = (x1 - x0 + 4 - 9) / 4;
    C.fill = [0, 1, 2, 3].map(d => {
      const x = x0 - 2 + d * (fw + 3);
      const r = svgEl('rect', { x, y: fy, width: fw, height: 30, rx: 3, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      const oo = this.txt(b, '+' + hex2(d * 8), x + 4, fy + 8.5, 6, 'dv-f');
      const n = this.txt(b, '', x + fw - 4, fy + 8.5, 6, 'dv-f', 'end', { 'font-weight': 700 });
      const l1 = this.txt(b, '', x + fw / 2, fy + 18.5, 7.2, 'dv-f', 'middle', { 'font-weight': 600 });
      const l2 = this.txt(b, '', x + fw / 2, fy + 27, 7.2, 'dv-f', 'middle', { 'font-weight': 600 });
      return { r, o: oo, n, l1, l2 };
    });
    C.stat = this.txt(b, '', x0, fy + 44, 7, 'dv-f');
    C.fillFl = this.flashRect(b, x0 - 4, fy - 2, x1 - x0 + 8, 34, dvA(THEME.gold, 0.16));
    C.tagFl = this.flashRect(b, x0 - 4, ty - 2, x1 - x0 + 8, 26 + o.ways * 13.6, dvA(THEME.cyan, 0.14));
  }
  buildIcache686(g) {
    const b = this.block(g, 'icache', 56, 56, 320, 300, 'L1 CODE CACHE 8 KB');
    this.txt(b, '64 SETS × 4 WAYS · 32 B', 368, 72, 7, 'dv-f', 'end');
    this.buildCacheL1(b, 'i', { gx0: 84, gy0: 88, cw: 36, ch: 10.6, ww: 8.6, cols: 8, lstep: 1, ways: 4, ty: 178, x0: 66, x1: 366 });
  }
  buildItlb686(g) {
    const b = this.block(g, 'itlb', 388, 56, 210, 70, 'CODE TLB');
    const E = this.els;
    const geo = [];
    for (let s = 0; s < 8; s++) for (let w = 0; w < 4; w++) geo.push([398 + s * 24.6, 84 + w * 8.6, 22, 7.2]);
    E.itlb = this.mkGrid(b, geo, this.tlbStyles());
    E.itlbNote = this.txt(b, 'paging off', 590, 72, 6.5, 'dv-f', 'end');
  }
  buildBtb686(g) {
    const b = this.block(g, 'btb', 388, 134, 210, 222, 'BTB  TWO-LEVEL');
    const P = dieP(), E = this.els;
    const gx0 = 398, gy0 = 158, sw = 24.6, cw = 5.8, ch = 5.2;
    E.btbG = { gx0, gy0, sw, cw, ch };
    const geo = [];
    for (let s = 0; s < 128; s++) {
      const x0 = gx0 + (s & 7) * sw, y0 = gy0 + (s >> 3) * ch;
      for (let w = 0; w < 4; w++) geo.push([x0 + w * cw, y0, cw - 1, ch - 1]);
    }
    const bs = dvMix(THEME.gold, THEME.panel, 0.4);
    E.btb = this.mkGrid(b, geo, [[P.row0, P.cellStroke], [this.btbCol(0), bs], [this.btbCol(1), bs], [this.btbCol(2), bs], [this.btbCol(3), bs]]);
    E.btbSet = svgEl('rect', { x: gx0 - 1.5, y: gy0 - 1, width: sw, height: ch + 1, rx: 1.5, fill: 'none', stroke: THEME.gold, 'stroke-width': 1.2, opacity: 0, 'pointer-events': 'none' }, b);
    E.btbWayFl = svgEl('rect', { x: gx0 - 1, y: gy0 - 1, width: cw + 1, height: ch + 1, rx: 1, fill: dvA(THEME.phosphor, 0.6), stroke: THEME.phosphor, 'stroke-width': 1.2, opacity: 0, 'pointer-events': 'none' }, b);
    E.btbL1 = this.txt(b, 'no branch yet', 396, 256, 7.5, 'dv-f', 'start', { 'font-weight': 700 });
    this.txt(b, 'HISTORY', 396, 267, 5.8, 'dv-f');
    this.txt(b, '16 COUNTERS OF THE ENTRY', 452, 267, 5.8, 'dv-f');
    E.btbH = [0, 1, 2, 3].map(i => {
      const x = 396 + i * 12.5;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y: 270, width: 11, height: 13, rx: 2 }, c);
      const t = this.txt(c, '·', x + 5.5, 280, 8, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, t };
    });
    E.btbPht = [];
    for (let i = 0; i < 16; i++) {
      const r = svgEl('rect', { x: 452 + i * 8.6, y: 270, width: 7.6, height: 13, rx: 1.5, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.6 }, b);
      E.btbPht.push(r);
    }
    E.btbPhtSel = svgEl('rect', { x: 452, y: 268.5, width: 10.6, height: 16, rx: 2, fill: 'none', stroke: THEME.text, 'stroke-width': 1.4, opacity: 0, 'pointer-events': 'none' }, b);
    E.btbL2 = this.txt(b, '', 396, 297, 7.5, 'dv-m');
    E.btbL3 = this.txt(b, '', 396, 311, 8, 'dv-f', 'start', { 'font-weight': 700 });
    E.btbRsb = this.txt(b, '', 396, 325, 7, 'dv-f');
    E.btbSt = this.txt(b, '', 396, 339, 6.8, 'dv-f');
    E.btbSt2 = this.txt(b, '', 396, 351, 6.8, 'dv-f');
    E.btbFl = this.flashRect(b, 390, 246, 206, 108, dvA(THEME.gold, 0.12));
  }
  // ---- the in-order front end: the fetch unit and the decoders ----
  buildIfu686(g) {
    const b = this.block(g, 'ifu', 610, 56, 230, 300, 'INSTRUCTION FETCH');
    const P = dieP(), E = this.els;
    E.ifLine = this.txt(b, 'fetch --------', 618, 92, 8.5, 'dv-go', 'start', { 'font-weight': 700 });
    for (let i = 0; i < 32; i++) {
      svgEl('rect', { x: this.qx(i) - this.QW / 2, y: this.qy(i), width: this.QW, height: this.QH, rx: 3, fill: 'none', stroke: P.cellStroke, 'stroke-dasharray': '3 3' }, b);
    }
    for (let r = 0; r < 4; r++) this.txt(b, String(r * 8), 616, this.qy(r * 8) + 13, 6.5, 'dv-f');
    this.txt(b, 'head ▶ decoders', 618, 222, 7.5, 'dv-ph', 'start', { 'font-weight': 700 });
    E.qCount = this.txt(b, '0/32', 832, 222, 8, 'dv-m', 'end', { 'font-weight': 700 });
    E.ifIld = this.txt(b, '', 618, 240, 7, 'dv-m');
    E.ifNext = this.txt(b, '', 618, 256, 7.5, 'dv-f', 'start', { 'font-weight': 600 });
    E.ifFlush = this.txt(b, '', 618, 280, 8.5, 'dv-mg', 'start', { 'font-weight': 700 });
    E.ifFlush2 = this.txt(b, '', 618, 294, 7, 'dv-mg');
    E.ifPred = this.txt(b, '', 618, 316, 7.5, 'dv-go', 'start', { 'font-weight': 700 });
    E.ifPred2 = this.txt(b, '', 618, 330, 7, 'dv-f');
    E.ifFl = this.flashRect(b, 612, 268, 226, 32, dvA(THEME.magenta, 0.25));
    E.ifPFl = this.flashRect(b, 612, 306, 226, 28, dvA(THEME.gold, 0.2));
    this.chipLayer = svgEl('g', { 'pointer-events': 'none' }, b);
  }
  buildDec686(g) {
    const b = this.block(g, 'dec', 848, 56, 242, 300, 'DECODERS  4-1-1');
    const E = this.els, P = dieP();
    const rows = [['D0', 'complex: 1-4 µops'], ['D1', 'simple: 1 µop'], ['D2', 'simple: 1 µop'], ['MS', 'MSROM: 4 µops / clock']];
    E.dRow = rows.map(([n, sub], i) => {
      const y = 80 + i * 46;
      const bg = svgEl('rect', { x: 856, y, width: 226, height: 42, rx: 4, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 1 }, b);
      const badge = svgEl('rect', { x: 860, y: y + 4, width: 22, height: 15, rx: 3, fill: dvA(THEME.phosphor, 0.15), stroke: THEME.phosphor, 'stroke-width': 1 }, b);
      this.txt(b, n, 871, y + 15, 8.5, 'dv-v', 'middle', { 'font-weight': 700 });
      this.txt(b, sub, 1076, y + 10, 6, 'dv-f', 'end');
      const t = this.txt(b, '', 888, y + 16, 9, 'dv-f', 'start', { 'font-weight': 700 });
      const chips = [];
      for (let k = 0; k < 16; k++) chips.push(svgEl('rect', { x: 862 + k * 11.5, y: y + 25, width: 9.5, height: 11, rx: 2, fill: dvA(THEME.gold, 0.7), opacity: 0 }, b));
      const u = this.txt(b, '', 1076, y + 34, 7.5, 'dv-m', 'end', { 'font-weight': 700 });
      const fl = this.flashRect(b, 856, y, 226, 42, dvA(THEME.phosphor, 0.18));
      return { bg, badge, t, chips, u, fl };
    });
    E.dGroup = this.txt(b, '', 856, 272, 8, 'dv-go', 'start', { 'font-weight': 700 });
    E.dWhy = this.txt(b, '', 856, 286, 7.2, 'dv-m');
    E.dWhy2 = this.txt(b, '', 856, 298, 7.2, 'dv-m');
    E.dRule = this.txt(b, 'D0 takes 1-4 µops, D1 and D2 take 1 µop:', 856, 318, 6.8, 'dv-f');
    this.txt(b, 'so "4-1-1". Up to 3 instructions and 6 µops', 856, 329, 6.8, 'dv-f');
    this.txt(b, 'each clock go to the RAT.', 856, 340, 6.8, 'dv-f');
    E.decBytes = this.txt(b, '', 1082, 351, 6.8, 'dv-go', 'end', { 'font-weight': 600 });
    E.decFl = this.flashRect(b, 852, 78, 234, 186, dvA(THEME.phosphor, 0.1));
  }
  // ---- the MSROM, CR0, CR4, the TSC ----
  buildMs686(g) {
    const b = this.block(g, 'msrom', 1102, 56, 340, 300, 'MSROM  MICROCODE');
    const E = this.els, P = dieP();
    svgEl('rect', { x: 1110, y: 80, width: 324, height: 46, fill: 'url(#dv-rom)', stroke: P.cellStroke }, b);
    E.romRow = svgEl('rect', { x: 1110, y: 80, width: 14, height: 46, fill: dvA(THEME.phosphor, 0.6), opacity: 0 }, b);
    E.msText = this.txt(b, 'idle: the decoders make the µops', 1110, 140, 8, 'dv-f', 'start', { 'font-weight': 700 });
    E.crBits = D486_CR0.map(([n, bit], i) => {
      const x = 1110 + i * 29.6;
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x, y: 150, width: 27.5, height: 17, rx: 3 }, c);
      this.txt(c, n, x + 13.75, 162, 8, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, bit };
    });
    E.cr4Bits = D686_CR4.map(([n, bit], i) => {
      const x = 1110 + i * 33;
      const c = svgEl('g', { class: 'dv-cell dv-l' }, b);
      svgEl('rect', { x, y: 172, width: 31, height: 17, rx: 3 }, c);
      this.txt(c, n, x + 15.5, 184, 8, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, bit };
    });
    E.cr4Hex = this.txt(b, 'CR4 00000000', 1434, 185, 9, 'dv-lv', 'end', { 'font-weight': 600 });
    E.cr0Hex = this.txt(b, 'CR0 00000000', 1110, 206, 9, 'dv-lv', 'start', { 'font-weight': 600 });
    E.cr3 = this.txt(b, 'CR3 00000000', 1434, 206, 8.5, 'dv-f', 'end');
    E.cr2 = this.txt(b, 'CR2 00000000', 1110, 220, 8, 'dv-f');
    E.prMode = this.txt(b, 'REAL · CPL 0', 1434, 220, 8.5, 'dv-lv', 'end', { 'font-weight': 700 });
    this.txt(b, 'TSC', 1110, 240, 8.5, 'dv-m', 'start', { 'font-weight': 700 });
    E.tsc = this.txt(b, '0', 1434, 241, 11, 'dv-go', 'end', { 'font-weight': 700 });
    E.ccMode = this.txt(b, '', 1434, 256, 7.5, 'dv-m', 'end', { 'font-weight': 600 });
    E.msSerial = this.txt(b, '', 1110, 256, 7.5, 'dv-mg');
    this.txt(b, 'CLK', 1110, 276, 8, 'dv-m', 'start', { 'font-weight': 700 });
    E.clkDot = svgEl('circle', { cx: 1136, cy: 273, r: 4.2, fill: P.dot }, b);
    E.clkText = this.txt(b, this.mhz(), 1146, 276, 8, 'dv-f');
    E.decClk = this.txt(b, '', 1434, 276, 8, 'dv-m', 'end', { 'font-weight': 700 });
    this.txt(b, 'last interrupt', 1110, 294, 7, 'dv-f');
    E.intText = this.txt(b, '', 1434, 294, 8.5, 'dv-f', 'end', { 'font-weight': 700 });
    E.msSt = this.txt(b, '', 1110, 316, 7, 'dv-m');
    E.msSt2 = this.txt(b, '', 1110, 330, 7, 'dv-f');
    E.msSt3 = this.txt(b, '', 1110, 344, 7, 'dv-f');
    E.crFl = this.flashRect(b, 1106, 147, 332, 78, dvA(THEME.lavender, 0.22));
    E.intFl = this.flashRect(b, 1106, 284, 332, 14, dvA(THEME.magenta, 0.25));
    E.msFl = this.flashRect(b, 1106, 78, 332, 68, dvA(THEME.phosphor, 0.14));
  }
  // ---- the RAT ----
  buildRat686(g) {
    const b = this.block(g, 'rat', 56, 384, 236, 300, 'RAT  REGISTER ALIAS TABLE');
    const E = this.els, P = dieP();
    this.txt(b, 'REGISTER', 66, 406, 6, 'dv-f');
    this.txt(b, 'NEWEST PRODUCER', 152, 406, 6, 'dv-f');
    E.rat = D686_OREGS.map((n, i) => {
      const y = 410 + i * 22.4;
      const bg = svgEl('rect', { x: 62, y, width: 224, height: 20, rx: 3, fill: i % 2 ? P.row0 : P.row1, stroke: P.cellStroke, 'stroke-width': 0.6 }, b);
      this.txt(b, n, 68, y + 14, 9.5, 'dv-m', 'start', { 'font-weight': 700 });
      const ar = this.txt(b, '→', 132, y + 14, 10, 'dv-f', 'start');
      const m = this.txt(b, 'RRF', 150, y + 14, 10, 'dv-f', 'start', { 'font-weight': 700 });
      const s = this.txt(b, '', 282, y + 14, 7.5, 'dv-f', 'end', { 'font-weight': 600 });
      const fl = this.flashRect(b, 62, y, 224, 20, dvA(THEME.gold, 0.3));
      return { bg, ar, m, s, fl };
    });
    E.ratR = this.txt(b, '', 64, 652, 7, 'dv-cy');
    E.ratW = this.txt(b, '', 64, 665, 7, 'dv-go');
    E.ratN = this.txt(b, '', 64, 678, 6.5, 'dv-f');
  }
  // ---- the ROB: a ring of 40 entries, and the chart of the µops of this instruction ----
  buildRob686(g) {
    const b = this.block(g, 'rob', 308, 384, 604, 300, 'ROB  REORDER BUFFER  40');
    const E = this.els, P = dieP();
    const cx = 440, cy = 540, rO = 118, rI = 74;
    E.robGeo = { cx, cy, rO, rI };
    const pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    E.robSec = [];
    for (let k = 0; k < 40; k++) {
      const a0 = (-90 + k * 9 + 0.6) * Math.PI / 180, a1 = (-90 + (k + 1) * 9 - 0.6) * Math.PI / 180, am = (-90 + k * 9 + 4.5) * Math.PI / 180;
      const [x0, y0] = pt(rO, a0), [x1, y1] = pt(rO, a1), [x2, y2] = pt(rI, a1), [x3, y3] = pt(rI, a0);
      const d = `M${x0.toFixed(1)} ${y0.toFixed(1)}A${rO} ${rO} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}A${rI} ${rI} 0 0 0 ${x3.toFixed(1)} ${y3.toFixed(1)}Z`;
      const s = svgEl('path', { d, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      const [tx, ty] = pt((rO + rI) / 2, am), deg = k * 9 + 4.5 - 90 + (k > 20 ? 180 : 0);
      const t = this.txt(b, '', tx, ty + 2.6, 7.2, 'dv-v', 'middle', { 'font-weight': 700, transform: `rotate(${deg.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})` });
      const [nx, ny] = pt(rO + 9, am);
      if (k % 2 === 0) this.txt(b, String(k), nx, ny + 2.2, 6, 'dv-f', 'middle');
      E.robSec.push({ s, t });
    }
    const ptr = (col, lab) => {
      const l = svgEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - rI, stroke: col, 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0 }, b);
      const t = this.txt(b, lab, cx, cy, 6.5, '', 'middle', { fill: col, 'font-weight': 700, opacity: 0 });
      t.removeAttribute('class');
      return { l, t };
    };
    E.ptrRet = ptr(THEME.phosphor, 'RETIRE');
    E.ptrAl = ptr(THEME.gold, 'ALLOCATE');
    this.txt(b, 'MODEL CLOCK', cx, cy - 26, 6, 'dv-f', 'middle');
    E.robClk = this.txt(b, '0', cx, cy - 12, 11, 'dv-v', 'middle', { 'font-weight': 700 });
    E.robUse = this.txt(b, '', cx, cy + 4, 8, 'dv-m', 'middle', { 'font-weight': 600 });
    E.robRetN = this.txt(b, '', cx, cy + 18, 8, 'dv-ph', 'middle', { 'font-weight': 700 });
    E.robMsg = this.txt(b, '', cx, cy + 32, 7.5, 'dv-mg', 'middle', { 'font-weight': 700 });
    E.robInfo = this.txt(b, '', 318, 676, 6.8, 'dv-f');
    // the chart: one row for each µop, the model clocks go to the right
    const gx0 = 668, gw = 234, gy0 = 428, rh = 23;
    E.gGeo = { gx0, gw, gy0, rh, n: 9 };
    E.gHead = this.txt(b, '', 574, 414, 7.5, 'dv-m', 'start', { 'font-weight': 700 });
    E.gAxis = svgEl('path', { d: '', stroke: P.cellStroke, 'stroke-width': 1, fill: 'none' }, b);
    E.gTicks = [0, 1, 2, 3, 4, 5].map(() => this.txt(b, '', 0, 654, 6, 'dv-f', 'middle'));
    E.gRows = [];
    for (let i = 0; i < 9; i++) {
      const y = gy0 + i * rh;
      const bg = svgEl('rect', { x: 572, y: y - 1, width: 334, height: rh - 2, rx: 3, fill: i % 2 ? P.row0 : 'none', opacity: 0.8 }, b);
      const l1 = this.txt(b, '', 576, y + 9, 8, 'dv-v', 'start', { 'font-weight': 700 });
      const l2 = this.txt(b, '', 576, y + 18.5, 7, 'dv-f');
      const seg = [0, 1, 2].map(() => svgEl('rect', { x: gx0, y: y + 2, width: 0, height: 10, rx: 1.5, fill: 'none' }, b));
      const tick = svgEl('rect', { x: gx0, y: y, width: 2.4, height: 14, fill: THEME.phosphor, opacity: 0 }, b);
      const n2 = this.txt(b, '', gx0, y + 20.5, 6, 'dv-f');
      E.gRows.push({ bg, l1, l2, seg, tick, n2 });
    }
    E.gCur = svgEl('line', { x1: gx0, y1: gy0 - 6, x2: gx0, y2: gy0 + 9 * rh - 2, stroke: THEME.text, 'stroke-width': 1.4, opacity: 0, 'stroke-dasharray': '3 2' }, b);
    E.gCurT = this.txt(b, '', gx0, gy0 - 8, 6.5, 'dv-v', 'middle', { 'font-weight': 700 });
    const keys = [[THEME.magenta, 'waits'], [THEME.gold, 'ready'], [THEME.cyan, 'executes'], [THEME.phosphor, 'done'], [THEME.goldHi, 'retire']];
    keys.forEach(([c, s], i) => {
      const x = 576 + i * 66;
      svgEl('rect', { x, y: 670, width: 12, height: 7, rx: 1.5, fill: i === 3 ? dvMix(c, THEME.panel, 0.55) : i === 0 ? dvMix(c, THEME.panel, 0.45) : c }, b);
      this.txt(b, s, x + 16, 677, 6.8, 'dv-m');
    });
    E.robFl = this.flashRect(b, 312, 400, 256, 280, dvA(THEME.magenta, 0.12));
  }
  // ---- the reservation station ----
  buildRs686(g) {
    const b = this.block(g, 'rs', 928, 384, 244, 300, 'RESERVATION STATION  20');
    const E = this.els, P = dieP();
    this.txt(b, 'ENTRY  ROB  µOP   SOURCES  STATE', 936, 404, 5.8, 'dv-f');
    E.rsRow = [];
    for (let s = 0; s < 20; s++) {
      const y = 408 + s * 12.8;
      const bg = svgEl('rect', { x: 934, y, width: 232, height: 11.8, rx: 2, fill: s % 2 ? P.row0 : P.row1, stroke: 'none', 'stroke-width': 1 }, b);
      this.txt(b, String(s), 944, y + 9, 6.5, 'dv-f', 'end');
      const t = this.txt(b, '', 952, y + 9, 7.4, 'dv-f', 'start', { 'font-weight': 700 });
      const d1 = svgEl('circle', { cx: 1024, cy: y + 5.9, r: 3.2, fill: P.dot, opacity: 0 }, b);
      const d2 = svgEl('circle', { cx: 1034, cy: y + 5.9, r: 3.2, fill: P.dot, opacity: 0 }, b);
      const st = this.txt(b, '', 1042, y + 9, 6.8, 'dv-f', 'start', { 'font-weight': 600 });
      E.rsRow.push({ bg, t, d1, d2, st });
    }
    E.rsSum = this.txt(b, '', 936, 679, 6.8, 'dv-m', 'start', { 'font-weight': 600 });
  }
  // ---- the retirement registers (and the FPU stack) ----
  buildRrf686(g) {
    const b = this.block(g, 'rrf', 1188, 384, 254, 300, 'RETIREMENT REGISTERS');
    const P = dieP(), E = this.els;
    D386_REGS.forEach((r, i) => {
      const y0 = 408 + i * 13.8;
      svgEl('rect', { x: 1192, y: y0, width: 246, height: 12.8, rx: 2.5, fill: i % 2 ? P.row0 : P.row1, opacity: 0.9 }, b);
      const fl = this.flashRect(b, 1192, y0, 246, 12.8, dvA(THEME.phosphor, 0.35));
      this.txt(b, r, 1197, y0 + 9.8, 9, 'dv-m', 'start', { 'font-weight': 700 });
      const hi = this.txt(b, '0000', 1392, y0 + 10, 10, 'dv-f', 'end', { 'font-weight': 600 });
      const lo = this.txt(b, '0000', 1434, y0 + 10, 10, 'dv-v', 'end', { 'font-weight': 600 });
      E.regs[r] = { hi, lo, fl, y: y0 + 7, x: 1188, w32: true };
    });
    const f = this.block(g, 'flags', 1192, 519, 246, 30, '');
    D486_FLAGS.forEach(([n, bit], i) => {
      const x = 1193.5 + i * 16.3, y = 521, w = 15.3;
      const c = svgEl('g', { class: 'dv-cell' }, f);
      svgEl('rect', { x, y, width: w, height: 26, rx: 2.5 }, c);
      this.txt(c, n, x + w / 2, y + 9, n.length > 2 ? 4.3 : 5.6, 'dv-m', 'middle', { 'font-weight': 600 });
      const v = this.txt(c, '0', x + w / 2, y + 21.5, 8.5, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      const fl = this.flashRect(c, x, y, w, 26, dvA(THEME.phosphor, 0.45));
      this.els.flags.push({ n, bit, c, v, fl });
    });
    this.txt(b, 'EIP', 1197, 562, 8, 'dv-m', 'start', { 'font-weight': 700 });
    const ip = this.txt(b, '00000000', 1222, 562, 9, 'dv-ph', 'start', { 'font-weight': 700 });
    const ipFl = this.flashRect(b, 1192, 553, 100, 12, dvA(THEME.phosphor, 0.25));
    E.regs.EIP = { lo: ip, fl: ipFl, y: 558, x: 1188 };
    D386_SREGS.forEach((n, i) => {
      const x = 1300 + (i % 3) * 46, y = 562 + Math.floor(i / 3) * 12;
      this.txt(b, n, x, y, 7, 'dv-cy', 'start', { 'font-weight': 700 });
      const lo = this.txt(b, '0000', x + 14, y, 7.5, 'dv-v', 'start', { 'font-weight': 600 });
      const fl = this.flashRect(b, x - 2, y - 8, 44, 10, dvA(THEME.phosphor, 0.3));
      E.regs[n] = { lo, fl, y: y - 3, x: 1188 };
    });
    // the FPU registers: two columns of four
    const fb = this.block(g, 'fstk', 1192, 590, 246, 90, '', 'l');
    E.fOp = this.txt(fb, 'FPU idle', 1197, 602, 7.5, 'dv-f', 'start', { 'font-weight': 700 });
    E.fTop = this.txt(fb, 'TOP 0', 1434, 602, 7, 'dv-lv', 'end', { 'font-weight': 600 });
    E.fOpFl = this.flashRect(fb, 1194, 593, 242, 12, dvA(THEME.lavender, 0.25));
    E.fRow = [];
    for (let i = 0; i < 8; i++) {
      const x0 = 1194 + (i >> 2) * 122, y0 = 607 + (i & 3) * 18;
      const bg = svgEl('rect', { x: x0, y: y0, width: 120, height: 16.5, rx: 2.5, fill: i % 2 ? P.row0 : P.row1 }, fb);
      const st = this.txt(fb, 'ST' + i, x0 + 3, y0 + 11.5, 7.5, i ? 'dv-m' : 'dv-lv', 'start', { 'font-weight': 700 });
      const ph = this.txt(fb, 'R' + i, x0 + 22, y0 + 11.5, 6, 'dv-f');
      const tag = svgEl('rect', { x: x0 + 34, y: y0 + 3, width: 2.6, height: 10.5, rx: 1, fill: THEME.faint }, fb);
      const v = this.txt(fb, 'empty', x0 + 117, y0 + 11.8, 8, 'dv-f', 'end', { 'font-weight': 600 });
      const fl = this.flashRect(fb, x0, y0, 120, 16.5, dvA(THEME.lavender, 0.4));
      E.fRow.push({ bg, st, ph, tag, v, fl });
    }
    E.rrfFl = this.flashRect(b, 1190, 398, 250, 120, dvA(THEME.phosphor, 0.12));
  }
  // ---- the five ports ----
  buildPorts686(g) {
    const E = this.els, P = dieP();
    E.port = D686_PORTS.map((d, p) => {
      const x = d.x, w = d.w;
      const b = this.block(g, d.id, x, 712, w, 232, d.title);
      const lamp = svgEl('circle', { cx: x + w - 10, cy: 858, r: 4.5, fill: P.dot }, b);
      const units = d.units.map(([n, re], i) => {
        const y = 740 + i * 21;
        const bg = svgEl('rect', { x: x + 5, y, width: w - 10, height: 18, rx: 3, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
        const bar = svgEl('rect', { x: x + 5, y: y + 14, width: 0, height: 4, rx: 1, fill: THEME.cyan, opacity: 0.8 }, b);
        this.txt(b, n, x + 10, y + 12, n.length > 6 ? 6.8 : 8, 'dv-m', 'start', { 'font-weight': 700 });
        const s = this.txt(b, '', x + w - 8, y + 12, 7, 'dv-f', 'end', { 'font-weight': 600 });
        return { bg, bar, s, re };
      });
      const y1 = 862;
      const now = this.txt(b, '', x + 6, y1, 9, 'dv-f', 'start', { 'font-weight': 700 });
      const tx = this.txt(b, '', x + 6, y1 + 13, 6.5, 'dv-m');
      const busy = this.txt(b, '', x + 6, y1 + 34, 6.8, 'dv-f', 'start', { 'font-weight': 600 });
      const bbg = svgEl('rect', { x: x + 6, y: y1 + 39, width: w - 12, height: 5, rx: 1.5, fill: P.row0 }, b);
      const bar = svgEl('rect', { x: x + 6, y: y1 + 39, width: 0, height: 5, rx: 1.5, fill: THEME.cyan }, b);
      const cnt = this.txt(b, '', x + 6, y1 + 64, 6.5, 'dv-f');
      const fl = this.flashRect(b, x + 2, 714, w - 4, 20, dvA(THEME.cyan, 0.3));
      return { lamp, units, now, tx, busy, bbg, bar, cnt, fl, w };
    });
  }
  // ---- the memory order buffer ----
  buildMob686(g) {
    const b = this.block(g, 'mob', 568, 712, 224, 232, 'MEMORY ORDER BUFFER');
    const E = this.els, P = dieP();
    this.txt(b, 'LOADS OF THIS INSTRUCTION', 576, 742, 6, 'dv-f');
    E.mobL = [0, 1, 2].map(i => this.txt(b, '', 576, 753 + i * 12, 7.2, 'dv-f', 'start', { 'font-weight': 600 }));
    this.txt(b, 'STORE BUFFER  12 ENTRIES', 576, 795, 6, 'dv-f');
    E.sbRow = [];
    for (let i = 0; i < 12; i++) {
      const y = 799 + i * 11.6;
      const bg = svgEl('rect', { x: 574, y, width: 212, height: 10.6, rx: 2, fill: i % 2 ? P.row0 : P.row1 }, b);
      const t = this.txt(b, '', 578, y + 8, 6.8, 'dv-f', 'start', { 'font-weight': 600 });
      const s = this.txt(b, '', 782, y + 8, 6.4, 'dv-f', 'end', { 'font-weight': 600 });
      E.sbRow.push({ bg, t, s });
    }
    E.mobFl = this.flashRect(b, 572, 742, 216, 38, dvA(THEME.gold, 0.18));
  }
  buildDcache686(g) {
    const b = this.block(g, 'dcache', 808, 712, 320, 232, 'L1 DATA CACHE 8 KB');
    this.txt(b, '128 SETS × 2 WAYS · MESI', 1120, 726, 6.5, 'dv-f', 'end');
    this.buildCacheL1(b, 'd', { gx0: 836, gy0: 742, cw: 17.8, ch: 8.4, ww: 8.4, cols: 16, lstep: 4, ways: 2, ty: 814, x0: 818, x1: 1118 });
  }
  buildDtlb686(g) {
    const b = this.block(g, 'dtlb', 1140, 712, 126, 232, 'DATA TLB');
    const E = this.els;
    this.txt(b, '4 KB · 64', 1146, 736, 6, 'dv-f');
    const geo = [];
    for (let s = 0; s < 16; s++) for (let w = 0; w < 4; w++) geo.push([1146 + s * 7.1, 740 + w * 8, 6.2, 7]);
    E.dtlb = this.mkGrid(b, geo, this.tlbStyles());
    this.txt(b, '4 MB · 8', 1146, 782, 6, 'dv-f');
    const geo4 = [];
    for (let s = 0; s < 2; s++) for (let w = 0; w < 4; w++) geo4.push([1146 + s * 58 + w * 14, 786, 12.5, 9]);
    E.dtlb4 = this.mkGrid(b, geo4, this.tlbStyles());
    E.tlbLast = this.txt(b, '', 1146, 812, 6.6, 'dv-m', 'start', { 'font-weight': 600 });
    E.tlbStat = this.txt(b, 'paging off', 1146, 825, 6, 'dv-f');
    this.silk(b, 'PAGE MISS HANDLER', 1146, 838, 6.5, 'dv-silk');
    E.pmh = [0, 1, 2, 3].map(i => this.txt(b, '', 1146, 858 + i * 13, 6.8, 'dv-m', 'start', { 'font-weight': 600 }));
    E.pgPhys = this.txt(b, '', 1260, 934, 8, 'dv-cy', 'end', { 'font-weight': 700 });
    E.walkFl = this.flashRect(b, 1142, 834, 122, 106, dvA(THEME.lavender, 0.2));
  }
  // ---- the bus unit: the front-side bus and the back-side bus ----
  buildBiu686(g) {
    const b = this.block(g, 'biu', 1274, 712, 174, 232, 'BUS UNIT');
    const E = this.els, P = dieP();
    E.bcType = this.txt(b, 'FSB IDLE', 1280, 742, 8.5, 'dv-m', 'start', { 'font-weight': 700 });
    E.fsbPh = ['REQ', 'ERR', 'SNOOP', 'RESP', 'DATA'].map((n, i) => {
      const x = 1279 + i * 33.2;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y: 748, width: 31.2, height: 14, rx: 2.5 }, c);
      this.txt(c, n, x + 15.6, 758, 6.2, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return c;
    });
    E.bl = {};
    ['ADS', 'REQ', 'BNR', 'HIT', 'HITM', 'RS', 'DRDY', 'DBSY', 'TRDY'].forEach((n, i) => {
      const x = 1284 + (i % 3) * 56, y = 776 + Math.floor(i / 3) * 13;
      E.bl[n] = svgEl('circle', { cx: x, cy: y - 2.5, r: 3.6, fill: P.dot }, b);
      this.txt(b, n + '#', x + 6, y, 6.8, 'dv-m', 'start', { 'font-weight': 700 });
    });
    E.laA = this.txt(b, 'A --------', 1280, 824, 9.5, 'dv-cy', 'start', { 'font-weight': 700 });
    this.txt(b, 'A35–A3#', 1280, 834, 5.8, 'dv-f');
    this.txt(b, 'BE7–BE0#', 1444, 834, 5.8, 'dv-f', 'end');
    E.beL = [7, 6, 5, 4, 3, 2, 1, 0].map((n, i) => svgEl('circle', { cx: 1370 + i * 9.8, cy: 821, r: 3, fill: P.dot }, b));
    E.lane = [7, 6, 5, 4, 3, 2, 1, 0].map((n, i) => {
      const x = 1278 + i * 20.9;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y: 840, width: 19.4, height: 15, rx: 2.5 }, c);
      const t = this.txt(c, '··', x + 9.7, 851, 7.6, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return { c, t, n };
    });
    this.txt(b, 'D63', 1278, 863, 5.6, 'dv-f');
    this.txt(b, 'D0', 1444, 863, 5.6, 'dv-f', 'end');
    E.xcDir = this.txt(b, '', 1280, 874, 6.6, 'dv-m');
    E.beat = [0, 1, 2, 3].map(i => {
      const x = 1278 + i * 42;
      const c = svgEl('g', { class: 'dv-cell' }, b);
      svgEl('rect', { x, y: 879, width: 40, height: 12, rx: 2.5 }, c);
      this.txt(c, String(i + 1), x + 20, 888.5, 7, 'dv-f dv-b', 'middle', { 'font-weight': 700 });
      return c;
    });
    E.bcPipe = this.txt(b, '', 1280, 902, 6.6, 'dv-f');
    E.bsbLamp = svgEl('circle', { cx: 1283, cy: 918, r: 4, fill: P.dot }, b);
    this.txt(b, 'BSB  L2 at the core clock', 1291, 921, 7, 'dv-m', 'start', { 'font-weight': 700 });
    E.bsbTxt = this.txt(b, '', 1280, 935, 6.6, 'dv-f');
    E.buFl = this.flashRect(b, 1276, 714, 170, 150, dvA(THEME.magenta, 0.1));
  }

  // ---- the L2 die (the second die of the package; g is at the p87 corner of the layout) ----
  build87(g) {
    this.g87 = g;
    const E = this.els, P = dieP(), tall = this.kind === 'tall', D = D686_L2[tall ? 'P' : 'L'], W = D.w, H = D.h;
    svgEl('rect', { x: -6, y: -6, width: W + 12, height: H + 12, rx: 10, fill: P.dieShadow, stroke: THEME.line }, g);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 4, fill: 'url(#dv-si)' }, g);
    const tex = DieView.texture(W, H, 256);
    if (tex) svgEl('image', { href: tex, x: 0, y: 0, width: W, height: H, 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 4, fill: 'url(#dv-sheen)', 'pointer-events': 'none' }, g);
    svgEl('rect', { x: 3.5, y: 3.5, width: W - 7, height: H - 7, rx: 3, fill: 'none', stroke: P.scribe, 'stroke-width': 1, opacity: 0.6 }, g);
    // the pads of the back-side bus, on the side that faces the CPU die
    const n = tall ? 40 : 24;
    for (let i = 0; i < n; i++) {
      const c = svgEl('g', { class: 'dv-pad' }, g);
      if (tall) svgEl('rect', { x: 180 + i * 22, y: 3, width: 16, height: 8, rx: 2 }, c);
      else svgEl('rect', { x: 3, y: 80 + i * 20, width: 8, height: 14, rx: 2 }, c);
      this.els.pads.push({ c, name: 'BSB', p: null, base: 'dv-pad' });
    }
    const b = this.block(g, 'l2', 16, 16, W - 32, H - 32, 'L2 CACHE 256 KB  SRAM DIE');
    this.txt(b, '2048 SETS × 4 WAYS · 32 B · MESI', W - 24, 30, 7, 'dv-f', 'end');
    // the map: one pixel for each line (four ways side by side), one canvas for all 8192 lines
    const G = E.l2G = tall ? { x: 40, y: 50, w: 1024, h: 128, cols: 128 } : { x: 44, y: 56, w: 400, h: 400, cols: 32 };
    G.rows = 2048 / G.cols; G.cw = G.w / G.cols; G.ch = G.h / G.rows;
    svgEl('rect', { x: G.x - 1, y: G.y - 1, width: G.w + 2, height: G.h + 2, fill: P.row0, stroke: P.cellStroke }, b);
    E.l2Img = svgEl('image', { class: 'dv-l2img', x: G.x, y: G.y, width: G.w, height: G.h, preserveAspectRatio: 'none', 'pointer-events': 'none' }, b);
    for (let r = 0; r < G.rows; r += tall ? 4 : 8) this.txt(b, hex(r * G.cols, 3), G.x - 3, G.y + (r + 0.8) * G.ch, 6, 'dv-f', 'end');
    E.l2Mark = svgEl('rect', { x: G.x, y: G.y, width: G.cw + 2, height: G.ch + 2, rx: 1.5, fill: dvA(THEME.cyan, 0.25), stroke: THEME.cyan, 'stroke-width': 1.4, opacity: 0, 'pointer-events': 'none' }, b);
    E.l2Fl = svgEl('rect', { x: G.x, y: G.y, width: G.cw + 6, height: G.ch + 6, rx: 2, fill: dvA(THEME.phosphor, 0.4), stroke: THEME.phosphor, 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }, b);
    // the tag compare and the counters
    const L = E.l2T = {};
    const ty = tall ? 196 : 470, x0 = 32;
    L.addr = this.txt(b, '--------', x0, ty + 14, 11, 'dv-cy', 'start', { 'font-weight': 700 });
    const box = (x, w, lab, col) => {
      svgEl('rect', { x, y: ty, width: w, height: 20, rx: 3, fill: P.row1, stroke: col, 'stroke-width': 1 }, b);
      this.txt(b, lab, x + w / 2, ty + 6.5, 5.5, 'dv-f', 'middle');
      return this.txt(b, '--', x + w / 2, ty + 17, 9, 'dv-v', 'middle', { 'font-weight': 700 });
    };
    L.tag = box(x0 + 108, 58, 'TAG 31–16', THEME.cyan);
    L.set = box(x0 + 170, 56, 'SET 15–5', THEME.magenta);
    L.ofs = box(x0 + 230, 44, 'OFFSET 4–0', THEME.gold);
    L.ways = [0, 1, 2, 3].map(w => {
      const xx = tall ? 340 + w * 212 : x0 - 2, yy = tall ? ty : ty + 26 + w * 14;
      const ww = tall ? 206 : W - 2 * x0 + 4;
      const bg = svgEl('rect', { x: xx, y: yy, width: ww, height: tall ? 20 : 12.6, rx: 3, fill: P.row0, stroke: P.cellStroke, 'stroke-width': 0.8 }, b);
      const cy = yy + (tall ? 13.5 : 9.4);
      this.txt(b, 'WAY ' + w, xx + 4, cy, 7.5, 'dv-m', 'start', { 'font-weight': 700 });
      const t = this.txt(b, '----', xx + 40, cy, 8.5, 'dv-f', 'start', { 'font-weight': 600 });
      const st = this.txt(b, '', xx + 72, cy, 8.5, 'dv-f', 'start', { 'font-weight': 700 });
      const a = this.txt(b, '', xx + 86, cy, 7, 'dv-f');
      const m = this.txt(b, '', xx + ww - 4, cy, 7.5, 'dv-f', 'end', { 'font-weight': 700 });
      return { bg, t, st, a, m };
    });
    const ry = tall ? ty + 40 : ty + 94;
    L.res = this.txt(b, 'no access yet', x0, ry, 10, 'dv-f', 'start', { 'font-weight': 700 });
    L.note = this.txt(b, '', W - 26, ry, 7, 'dv-f', 'end');
    L.st1 = this.txt(b, '', x0, ry + 17, 7.5, 'dv-m');
    L.st2 = this.txt(b, '', x0, ry + 31, 7, 'dv-f');
    L.fl = this.flashRect(b, x0 - 4, ty - 2, W - 2 * x0 + 8, tall ? 24 : 84, dvA(THEME.cyan, 0.14));
    if (tall) { this.txt(b, 'the back-side bus: 64 bits at the core clock', 1180, 30, 7, 'dv-f', 'end'); }
    else this.txt(b, 'the back-side bus: 64 bits at the core clock', x0, H - 22, 7, 'dv-f');
    this.l2cv = null;
    this.oo.l2Key = -1;
  }
  // the back-side bus between the two dies (in the package, under the dies)
  buildLinks() {
    const E = this.els, g = this.gLinks, L = this.L, P = dieP();
    E.wires = {};
    const [ox, oy] = L.p86, pts = this.arr.bsb.slice(1).map(([x, y]) => [x + ox, y + oy]);
    const d = [];
    for (let k = -3; k <= 3; k++) {
      const o = k * 3.2, tall = this.kind === 'tall';
      d.push('M' + pts.map(([x, y], i) => tall ? `${(x + o).toFixed(1)} ${y}` : (i === 0 ? `${x} ${(y + o).toFixed(1)}` : i === pts.length - 1 ? `${x} ${(y + o).toFixed(1)}` : `${(x + o).toFixed(1)} ${(y + o).toFixed(1)}`)).join('L'));
    }
    E.bsbWire = svgEl('path', { d: d.join(''), class: 'dv-wire', stroke: THEME.phosphor, color: THEME.phosphor, 'stroke-width': 1.4 }, g);
    const hit = svgEl('g', { class: 'dv-blk', tabindex: 0, role: 'button', 'aria-label': DIE686_INFO.bsb[0] + ': ' + DIE686_INFO.bsb[1] }, g);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const bx = Math.min(...xs) - 12, by = Math.min(...ys) - 12;
    svgEl('rect', { x: bx, y: by, width: Math.max(...xs) - bx + 12, height: Math.max(...ys) - by + 12, fill: 'transparent' }, hit);
    hit.addEventListener('click', e => { e.stopPropagation(); this.select('bsb', hit); });
    hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select('bsb', hit); } });
    E.blocks.bsb = hit;
    if (this.kind !== 'tall') this.txt(g, 'BSB', pts[1][0] + 2, pts[1][1] - 16, 9, 'dv-ph', 'middle', { 'font-weight': 700 });
    else this.txt(g, 'BSB', pts[0][0] + 16, pts[0][1] + 14, 9, 'dv-ph', 'start', { 'font-weight': 700 });
    // the package: the ceramic cavity around the two dies
    const bb = this.kind === 'tall' ? [L.p86[0] - 14, L.p86[1] - 14, 1210 + 28, L.p87[1] + 320 - L.p86[1] + 28] : [L.p86[0] - 14, L.p86[1] - 14, L.p87[0] + 480 - L.p86[0] + 28, 1000 + 28];
    svgEl('rect', { x: bb[0], y: bb[1], width: bb[2], height: bb[3], rx: 16, fill: 'none', stroke: dvMix(THEME.ceramicHi, THEME.void, 0.3), 'stroke-width': 2, 'stroke-dasharray': '10 6', opacity: 0.6 }, g);
    this.txt(g, 'PENTIUM PRO PACKAGE: CPU DIE + L2 DIE', bb[0] + 20, bb[1] + bb[3] + 12, 9, 'dv-f');
  }
  buildLegend(svg) {
    if (!this.L.legend) { this.legend = null; return; }
    const [x, y] = this.L.legend;
    const g = this.legend = svgEl('g', { class: 'dv-legend', transform: `translate(${x} ${y})`, 'aria-hidden': 'true' }, svg);
    this.silk(g, 'DIE FLOOR PLAN', 0, 0, 14, 'dv-silk-g');
    this.txt(g, 'Intel Pentium Pro (P6), ' + this.mhz(), 0, 34, 13, 'dv-m');
    const items = [[THEME.cyan, 'address'], [THEME.gold, 'data, code'], [THEME.magenta, 'control'], [THEME.lavender, 'FPU, paging'], [THEME.phosphor, 'changed']];
    items.forEach(([c, s], i) => {
      const lx = (i % 3) * 150, ly = 60 + Math.floor(i / 3) * 22;
      svgEl('rect', { x: lx, y: ly - 10, width: 20, height: 6, rx: 3, fill: c }, g);
      this.txt(g, s, lx + 26, ly - 3, 12, 'dv-v');
    });
    this.txt(g, 'ROB and RS states:', 0, 124, 12, 'dv-m');
    this.robStyles().slice(1, 6).forEach(([f, s], i) => {
      svgEl('rect', { x: i * 88, y: 132, width: 14, height: 12, rx: 2, fill: f, stroke: s }, g);
      this.txt(g, ['waits', 'ready', 'executes', 'done', 'retires'][i], i * 88 + 18, 142, 11, 'dv-v');
    });
    this.txt(g, 'data lines (MESI):', 0, 172, 12, 'dv-m');
    [['M', THEME.magenta], ['E', THEME.phosphor], ['S', THEME.cyan], ['I', dieP().row0]].forEach(([n, c], i) => {
      svgEl('rect', { x: 130 + i * 56, y: 161, width: 14, height: 12, rx: 2, fill: c, stroke: dieP().cellStroke }, g);
      this.txt(g, n, 150 + i * 56, 172, 12, 'dv-v');
    });
    this.txt(g, 'Click a block for a description.', 0, 200, 12, 'dv-f');
    this.txt(g, 'Double-click a part to see it on the 3D board.', 0, 218, 12, 'dv-f');
  }
  // the states of a ROB entry: 0 empty, 1 waits for an operand, 2 ready (waits for its port or
  // unit), 3 executes, 4 done, 5 retires in this clock, 6 wrong path (flushed): [fill, stroke]
  robStyles() {
    if (this.robSt && this.robSt.theme === THEME.void) return this.robSt.s;
    const P = dieP();
    const s = [[P.row0, P.cellStroke], [dvMix(THEME.magenta, THEME.panel, 0.45), THEME.magenta], [THEME.gold, dvMix(THEME.gold, THEME.text, 0.4)],
      [THEME.cyan, dvMix(THEME.cyan, THEME.text, 0.4)], [dvMix(THEME.phosphor, THEME.panel, 0.55), THEME.phosphor], [THEME.goldHi, THEME.text],
      [dvA(THEME.magenta, 0.16), THEME.magenta]];
    this.robSt = { theme: THEME.void, s };
    return s;
  }

  // ---------- tokens: the internal buses, and the back-side bus to the L2 die ----------
  point(spec) {
    const A = this.arr;
    if (!A) return null;
    if (spec && typeof spec === 'object') {
      if (spec.tail !== undefined) {
        const s = clamp(spec.tail, 0, 31), x = this.qx(s), y = this.qy(s) + this.QH / 2;
        return this.pt586('dc', x, y, 'dn');
      }
      if (spec.bus) return this.point('p0');
      return null;
    }
    if (spec === 'l2') return { l2: true };
    if (D386_REGS.includes(spec)) return this.pt586('rr', 1188, 414 + D386_REGS.indexOf(spec) * 13.8, 'up');
    const k = D686_ALIAS[spec] || spec;
    const p = D686_PTS[k];
    if (!p) return null;
    return this.pt586(p[0], p[1], p[2], p[3], p[4]);
  }
  route(a, b) {
    if (a === 'l2' || b === 'l2') {
      const bsb = this.arr.bsb;
      if (a === 'l2' && b === 'l2') return null;
      if (b === 'l2') { const r = this.route(a, 'biu'); return r ? r.concat(bsb) : bsb.slice(); }
      const r = this.route('biu', b);
      return bsb.slice().reverse().concat(r || []);
    }
    return super.route(a, b);
  }
  opSource(op, v, w) {
    const r = super.opSource(op, v, w);
    return r === 'ring' || r === 'xcvr' ? 'dcache' : r === 'qhead' ? 'dec' : r;
  }
  readDest() { return 'p2'; }
  writeSrc() { return 'p4'; }

  // ---------- the model state of the view (the µop history) ----------
  // Copy the ROB of the core (the newest 40 µops) into the history of the view.
  snapRob() {
    const c = this.m.cpu, R = c.rob, S = c.rs, O = this.oo;
    if (!R || !O) return;
    for (let k = 0; k < 40; k++) {
      const id = R.uop[k];
      if (id < 0) continue;
      const j = id & 511;
      if (O.id[j] !== id) { O.id[j] = id; O.wait[j] = 0; O.src[j] = ''; O.rs[j] = -1; O.r1[j] = -1; O.r2[j] = -1; }
      O.n[j] = R.instr[k]; O.rob[j] = k; O.kind[j] = R.kind[k]; O.port[j] = R.port[k]; O.dst[j] = R.dst[k];
      O.s1[j] = R.src1[k]; O.s2[j] = R.src2[k]; O.iss[j] = R.issue[k]; O.dis[j] = R.dispatch[k]; O.done[j] = R.done[k]; O.ret[j] = R.retire[k];
    }
    for (let s = 0; s < 20; s++) { const id = S.uop[s]; if (id >= 0 && O.id[id & 511] === id) O.rs[id & 511] = s; }
    for (let k = 0; k < 40; k++) {
      const id = R.uop[k];
      if (id < 0) continue;
      const j = id & 511;
      if (O.r1[j] < 0) O.r1[j] = this.srcReady(id, O.s1[j], O.iss[j]);
      if (O.r2[j] < 0) O.r2[j] = this.srcReady(id, O.s2[j], O.iss[j]);
    }
    O.ver++;
  }
  // The clock at which a source is ready: the done clock of its producer (the newest older µop in
  // that ROB entry). A source in the RRF is ready at once.
  srcReady(id, e, iss) {
    if (e < 0) return iss;
    const O = this.oo;
    let best = -1, bj = -1;
    for (let j = 0; j < 512; j++) { const x = O.id[j]; if (x >= 0 && x < id && x > best && O.rob[j] === e) { best = x; bj = j; } }
    return bj >= 0 ? O.done[bj] : iss;
  }
  takeUop(u) {
    const O = this.oo, R = this.m.cpu.rob, j = u.id & 511;
    if (O.id[j] !== u.id) { O.id[j] = u.id; O.r1[j] = -1; O.r2[j] = -1; }
    O.n[j] = u.n; O.rob[j] = u.rob; O.rs[j] = u.rs; O.kind[j] = Math.max(0, R.kinds.indexOf(u.kind)); O.port[j] = u.port;
    O.dst[j] = u.dst ? R.regs.indexOf(u.dst) : -1;
    const src = u.src || [];
    O.s1[j] = src.length > 0 ? src[0] : -1; O.s2[j] = src.length > 1 ? src[1] : -1;
    O.iss[j] = u.issue; O.dis[j] = u.dispatch; O.done[j] = u.done; O.ret[j] = u.retire;
    O.wait[j] = Math.max(0, D686_WAITS.indexOf(u.wait || ''));
    O.src[j] = (u.srcRegs || []).join(' ');
  }
  stepText(n) { const O = this.oo, i = n & 63; return O.sN[i] === n ? O.sText[i] : ''; }
  mnem(n) { const t = this.stepText(n); return t ? t.trim().split(/\s+/)[0].toUpperCase() : ''; }
  kname(j) { const k = this.m.cpu.rob.kinds[this.oo.kind[j]]; return D686_KSHORT[k] || (k || '').toUpperCase(); }
  // The step on show, from its events (a traced instruction, or the sample of the fast mode).
  takeEvents(events) {
    const O = this.oo, c = this.m.cpu;
    if (!O || !c.rob) return;
    let dec = null, rob = null, rat = null, btb = null;
    const ups = [], cache = [];
    for (const e of events) {
      if (e.k === 'uop') ups.push(e);
      else if (e.k === 'decode') dec = e;
      else if (e.k === 'rob') rob = e;
      else if (e.k === 'rat') rat = e;
      else if (e.k === 'btb') btb = e;
      else if (e.k === 'cache') cache.push(e);
    }
    for (const u of ups) this.takeUop(u);
    this.snapRob();
    if (!rob || !ups.length || !dec) { O.cur = { idle: true, text: dec ? dec.text : '', n: -1, halted: !!(dec && dec.decoder === '') }; O.ver++; return; }
    const di = D686_DECS.indexOf(dec.decoder), i = rob.n & 63;
    O.sN[i] = rob.n; O.sText[i] = dec.text || ''; O.sDclk[i] = dec.dclk; O.sDec[i] = di; O.sUops[i] = dec.uops | 0;
    const mine = [];
    for (const u of ups) { const j = u.id & 511; if (O.id[j] === u.id) mine.push(j); }
    const cur = { idle: false, n: rob.n, text: dec.text || '', dclk: dec.dclk, dec: di, uops: dec.uops | 0, M: rob.retire, floor: rob.floor, debt: rob.debt,
      robUsed: rob.rob, rsUsed: rob.rs, mine, rat, btb, cache, rows: [], pass: new Map(), branch: -1 };
    for (const j of mine) if (c.rob.kinds[O.kind[j]] === 'branch') cur.branch = j;
    this.ganttRows(cur);
    let t0 = dec.dclk, t1 = rob.retire;
    for (const j of mine) { if (O.iss[j] < t0) t0 = O.iss[j]; if (O.ret[j] > t1) t1 = O.ret[j]; }
    for (const j of cur.rows) if (O.dis[j] < t0 && O.dis[j] > t0 - 40) t0 = O.dis[j];
    if (btb && btb.resolve > t1) t1 = btb.resolve;
    O.t0 = Math.floor(t0) - 1;
    O.t1 = Math.max(O.t0 + 4, Math.ceil(t1) + 1);
    O.cur = cur;
    O.ver++;
  }
  // The rows of the chart: the older µops that this instruction passes (or waits for), then the
  // µops of this instruction.
  ganttRows(cur) {
    const O = this.oo, older = [];
    const add = k => { if (!older.includes(k)) older.push(k); };
    for (const j of cur.mine) {
      let best = -1, bd = -1;
      for (let k = 0; k < 512; k++) {
        const id = O.id[k];
        if (id < 0 || id >= O.id[j] || O.n[k] === cur.n) continue;
        // an older µop in the machine when this one dispatches, and not done when this one is done
        if (O.iss[k] <= O.dis[j] && O.ret[k] > O.dis[j] && O.done[k] > O.done[j] && O.done[k] > bd) { bd = O.done[k]; best = k; }
      }
      if (best >= 0) { cur.pass.set(j, best); add(best); }
    }
    // the older µop that retires last before this instruction (the retire is in program order)
    const f = cur.mine[0];
    if (f !== undefined && O.ret[f] > O.done[f] + 1) {
      let best = -1;
      for (let k = 0; k < 512; k++) {
        const id = O.id[k];
        if (id < 0 || id >= O.id[f] || O.n[k] === cur.n || O.ret[k] > O.ret[f]) continue;
        if (best < 0 || O.ret[k] > O.ret[best] || (O.ret[k] === O.ret[best] && id > O.id[best])) best = k;
      }
      if (best >= 0 && O.ret[best] > O.done[f]) { cur.retWait = best; add(best); }
    }
    older.sort((a, b) => O.id[a] - O.id[b]);
    const ol = older.slice(0, 3);
    cur.rows = ol.concat(cur.mine.slice(0, 9 - ol.length));
    cur.more = cur.mine.length - (cur.rows.length - ol.length);
  }

  // ---------- events ----------
  reset() {
    this.oo = this.ooState();
    this.l2cv = null;
    super.reset();
  }
  instr(events, info) {
    super.instr(events, info);
    const O = this.oo;
    if (!O) return;
    this.takeEvents(events);
    O.play = { start: animNow(), dur: Math.max(this.cycles * info.clockMs, 300), trace: !!info.trace };
    if (!info.trace) O.tr = null;
    O.lastTc = O.t0;
    this.renderStep686();
  }
  // Trace mode: the model clock of the instruction moves with the steps of the trace.
  traceStep(story, i, info) {
    const O = this.oo;
    if (!O) return;
    if (!story) { O.tr = null; return; }
    if (O.trStory !== story) { O.trStory = story; O.tgt = this.storyTargets(story); }
    const tg = O.tgt;
    O.tr = { i, n: Math.max(1, story.steps.length), start: animNow(), ms: Math.max(150, (info && info.ms) || 1000),
      from: i > 0 && tg[i - 1] !== undefined ? tg[i - 1] : O.t0, to: tg[i] !== undefined ? tg[i] : O.t1 };
  }
  // The model clock that each step of the trace shows at its end: the steps share the time from the
  // decode to the retire, but a branch step ends at the check of the branch, a code miss at the
  // decode, a data miss at the end of the load.
  storyTargets(story) {
    const O = this.oo, cur = O.cur, steps = story.steps, n = steps.length, out = [];
    const kinds = this.m.cpu.rob.kinds;
    const load = cur && !cur.idle ? cur.mine.find(j => kinds[O.kind[j]] === 'load') : undefined;
    for (let i = 0; i < n; i++) {
      const s = steps[i], e = s.e;
      let t = O.t0 + (O.t1 - O.t0) * (i + 1) / n;
      if (cur && !cur.idle && e) {
        if (s.kind === 'btb' && e.resolve !== undefined) t = e.resolve + 1;
        else if (s.kind === 'cache' || s.kind === 'bus') {
          if (e.cache === 'code' || e.code || e.k === 'fetch') t = cur.dclk;
          else if (load !== undefined) t = s.kind === 'cache' ? O.dis[load] + 1 : O.done[load];
        }
      }
      out.push(clamp(i ? Math.max(t, out[i - 1]) : t, O.t0, O.t1));
    }
    if (n) out[n - 1] = O.t1;
    return out;
  }
  event(e, clockMs) {
    switch (e.k) {
      case 'uop': case 'rat': case 'rob': case 'pipe': this.cmsSet(e, clockMs); return;
      case 'btb': this.cmsSet(e, clockMs); this.onBtb686(e, this.anim(e.t)); return;
      case 'cache': this.cmsSet(e, clockMs); this.onCache686(e, this.anim(e.t)); return;
      case 'decode': this.cmsSet(e, clockMs); this.onDecode686(e, this.anim(e.t)); this.sfxTick(1); return;
      case 'fetch': this.cmsSet(e, clockMs); this.onBus686(e, this.anim(e.t), 'code'); return;
      case 'bus': this.cmsSet(e, clockMs); this.onBus686(e, this.anim(e.t), e.type); return;
      case 'alu': this.cmsSet(e, clockMs); this.mdl.alu = e; this.sfxTick(1.25); return;
      case 'ea': this.cmsSet(e, clockMs); this.onEA686(e, this.anim(e.t)); return;
      default: break;
    }
    super.event(e, clockMs);
  }
  onDecode686(e, a) {
    this.mdl.dec = e;
    this.anims.dec = Object.assign(a, { n: this.cycles, minMs: 300 });
    this.renderDec();
  }
  onEA686(e, a) {
    const lin = e.lin !== undefined ? e.lin >>> 0 : null;
    const d = this.mdl.desc && this.mdl.desc[e.seg];
    const base = lin !== null ? (lin - (e.off >>> 0)) >>> 0 : d ? d.base : 0;
    this.mdl.sig = { seg: e.seg, base, off: e.off >>> 0, lin: lin !== null ? lin : (base + e.off) >>> 0, phys: e.phys >>> 0 };
    if (!(this.mdl.sys && this.mdl.sys.pg)) this.renderPmh();
  }
  onBtb686(e, a) {
    const P = this.p5, E = this.els, G = E.btbG;
    P.btbE = e;
    if (G && e.set >= 0) {
      const x0 = G.gx0 + (e.set & 7) * G.sw, y0 = G.gy0 + (e.set >> 3) * G.ch;
      this.setA(E.btbSet, 'x', (x0 - 1.5).toFixed(1)); this.setA(E.btbSet, 'y', (y0 - 1).toFixed(1)); this.setA(E.btbSet, 'opacity', '0.95');
      if (e.way >= 0) { this.setA(E.btbWayFl, 'x', (x0 + e.way * G.cw - 0.5).toFixed(1)); this.setA(E.btbWayFl, 'y', (y0 - 0.5).toFixed(1)); this.flash('btbway', a, 6, 900); }
    }
    this.flash('btbx', a, 6, 900);
    this.renderBtb();
    this.renderBtbText();
    if (e.predicted) { this.flash('ifpred', a, 6, 900); this.token(e.t, ['btb', 'ifu'], 'TARGET ' + dvHex8(e.target >>> 0), THEME.gold, 0, 1.4, 300); }
    if (this.sfxOn() && typeof Sfx !== 'undefined') Sfx.tick(e.right ? 2.1 : 0.7, 0.02);
  }
  onCache686(e, a) {
    const code = e.cache === 'code' || !!e.code, P = this.p5, O = this.oo;
    const x = { phys: e.phys >>> 0, set: e.set, way: e.way, hit: !!e.hit, fill: !!e.fill, write: !!e.write, state: e.state || 'I', nc: !!e.nc, wb: !!e.wb, wbLine: e.wbLine >>> 0, code };
    if (e.level === 'L2') {
      O.l2acc = x;
      this.placeL2(e.set);
      this.flash('l2set', a, 6, 900);
      this.flash('l2tag', a, 4, 700);
      this.renderL2Tag();
      this.anims.bsb = Object.assign(this.anim(e.t), { n: 4, minMs: 600 });
      if (e.hit) this.token(e.t, ['l2', code ? 'icache' : 'dcache'], 'L2 HIT', THEME.phosphor, 0.6, 1.6, 320);
      else this.token(e.t, ['l2', 'biu'], 'L2 MISS: FSB', THEME.magenta, 0.6, 1.6, 320);
      this.sfxTick(e.hit ? 1.8 : 1.4);
      return;
    }
    const k = code ? 'i' : 'd';
    P.acc[k] = x;
    this.placeCacheL1(k, e.set, e.way);
    this.flash(k + 'cset', a, 6, 900);
    if (e.way >= 0) this.flash(k + 'cway', a, 6, 900);
    this.flash(k + 'ctag', a, 4, 600);
    this.renderTagL1(k);
    this.renderCacheL1(k);
    const blk = code ? 'icache' : 'dcache';
    if (e.hit) this.token(e.t, [blk, code ? 'ifu' : e.write ? 'mob' : 'p2'], code ? 'CODE HIT' : e.write ? 'WRITE HIT' : 'HIT', THEME.phosphor, 0.4, 1.4, 280);
    else if (!e.nc) this.token(e.t, [blk, 'l2'], 'L1 MISS', THEME.magenta, 0.2, 1.6, 300);
    else this.token(e.t, [blk, 'biu'], 'NO CACHE', THEME.magenta, 0.2, 1.4, 280);
    this.sfxTick(e.hit ? 1.9 : 1.6);
  }
  onBus686(e, a, type) {
    const len = e.len || 3, tr = this.oo && this.oo.tr;
    Object.assign(a, { n: len, minMs: tr ? Math.max(55 * len + 60, tr.ms * 0.85) : 55 * len + 60, e, type });
    const walk = !!(this.walkSet && (type === 'memr' || type === 'memw') && this.walkSet.has(e.addr & 0xFFFFFF));
    a.req = type === 'code' ? 'code' : walk ? 'page' : 'data';
    this.anims.bus = a;
    this.mdl.bus = { e, type, req: a.req };
    if (this.visible) this.renderBusText();
    const lab = this.busLabel(e);
    if (e.burst) {
      this.onBurst(e, a, type);
      if (e.wb) this.token(e.t, ['l2', 'biu'], lab, THEME.magenta, 0, Math.max(1, len * 0.6), 220);
      else this.token(e.t, ['biu', 'l2'], lab, THEME.gold, 0.2, Math.max(1, len * 0.6), 220);
      return;
    }
    if (type === 'code') this.token(e.t, ['biu', 'ifu'], lab, THEME.gold, 0.3, len * 0.6, 240);
    else if (walk) { this.flash('walk', a, 4, 500); this.token(e.t, ['biu', 'dtlb'], lab, THEME.lavender, 0.3, len * 0.6, 260); }
    else if (type === 'memr' || type === 'ior') this.token(e.t, ['biu', 'p2'], lab, THEME.gold, 0.4, len * 0.6, 260);
    else if (type === 'memw' || type === 'iow') this.token(e.t, ['mob', 'biu'], lab, THEME.gold, 0, len * 0.6, 260);
  }
  flashEl(key) {
    const E = this.els;
    if (key.startsWith('rat:')) { const r = E.rat && E.rat[+key.slice(4)]; return r ? r.fl : null; }
    if (key.startsWith('drow:')) { const r = E.dRow && E.dRow[+key.slice(5)]; return r ? r.fl : null; }
    if (key.startsWith('port:')) { const r = E.port && E.port[+key.slice(5)]; return r ? r.fl : null; }
    const m = { l2set: E.l2Fl, l2tag: E.l2T && E.l2T.fl, ifflush: E.ifFl, ifpred: E.ifPFl, robfl: E.robFl, mob: E.mobFl, ms: E.msFl, rrf: E.rrfFl,
      dec: E.decFl, d2: null, burst: E.buFl };
    if (key in m) return m[key] || null;
    return super.flashEl(key);
  }
  fast(stats) {
    // The machine state goes into the die 10 times a second (each drawn frame costs time that the
    // emulator needs): DieView.fast reads it when lastSync is old.
    const now = animNow(), due = now - (this.syncT || 0) >= D586_FAST_MS;
    if (!due) this.lastSync = now; else this.syncT = now;
    const O = this.oo, c = this.m.cpu, s = stats.sample || [];
    if (due && O && c.rob) {
      this.takeEvents(s);
      let mx = -1;
      for (let k = 0; k < 40; k++) if (c.rob.uop[k] >= 0 && c.rob.issue[k] > mx) mx = c.rob.issue[k];
      if (mx >= 0) O.vt = mx;
      O.play = null;
      for (const x of s) {
        if (x.k === 'btb') this.p5.btbE = x;
        else if (x.k === 'cache') {
          const k = x.cache === 'code' || x.code ? 'i' : 'd';
          const acc = { phys: x.phys >>> 0, set: x.set, way: x.way, hit: !!x.hit, fill: !!x.fill, write: !!x.write, state: x.state || 'I', nc: !!x.nc, wb: !!x.wb, wbLine: x.wbLine >>> 0, code: k === 'i' };
          if (x.level === 'L2') O.l2acc = acc; else this.p5.acc[k] = acc;
        } else if (x.k === 'fpu') this.mdl.fpuText = x.text;
      }
    }
    DieView.prototype.fast.call(this, stats);
    if (!O || !c.rob) return;
    const h = this.heatT, b = stats.bus || {}, pv = O.fastPrev;
    const lg = v => clamp(Math.log10(1 + (v || 0)) / 4.2, 0, 1);
    const ic = c.icache.stats, dc = c.dcache.stats, l2 = c.l2.stats, bs = c.btb.stats, os = c.oooStats, pu = c.ports.uops, ts = c.tlbStats;
    const icN = ic.hits + ic.misses, dcN = dc.hits + dc.misses, all = (b.fetch || 0) + (b.memr || 0) + (b.memw || 0) + (b.ior || 0) + (b.iow || 0);
    const d = (i, v) => { const x = v - pv[i]; pv[i] = v; return x > 0 ? x : 0; };
    const fpuOn = s.some(x => x.k === 'fpu');
    h.icache = lg(d(0, icN) * 0.4); h.dcache = lg(d(1, dcN) * 0.4); h.l2 = lg(d(2, l2.requests) * 4); h.btb = lg(d(3, bs.lookups) * 0.5);
    h.rob = lg(d(4, os.uops) * 0.25); h.rat = h.rob; h.rs = h.rob;
    h.rrf = lg(d(5, os.instructions) * 0.3); h.ifu = h.rrf; h.dec = h.rrf; h.flags = h.rrf * 0.6; h.msrom = lg(d(6, os.decoders[3]) * 6);
    for (let p = 0; p < 5; p++) h['p' + p] = lg(d(7 + p, pu[p]) * 0.4);
    h.mob = Math.max(h.p3 || 0, h.p2 || 0); h.biu = lg(all); h.pads = h.biu;
    h.dtlb = c.paging && ts ? lg(d(12, ts.hits + ts.misses) * 0.4) : 0; h.itlb = c.paging ? h.ifu * 0.6 : 0;
    h.fstk = fpuOn ? 0.8 : (h.fstk || 0) * 0.7;
  }

  // ---------- per frame ----------
  // The heat of the fast mode in steps of 0.1: each change of a glow costs a new picture of it.
  stepHeat(dt) {
    const k = 1 - Math.exp(-dt / 300);
    const fastOn = this.lastFast && animNow() - this.lastFast < 160;
    for (const id in this.els.heat) {
      const t = fastOn ? (this.heatT[id] || 0) : 0;
      const h = this.heat[id] = (this.heat[id] || 0) + (t - (this.heat[id] || 0)) * k;
      this.setA(this.els.heat[id], 'opacity', (Math.round(h * 9) / 10).toFixed(1));
    }
  }
  frame(now, dt) {
    // fast mode: draw only 10 frames a second; the frames between them change nothing
    const fastOn = this.lastFast && now - this.lastFast < 160;
    if (fastOn && now - (this.drawT || 0) < D586_FAST_MS) return;
    if (fastOn) dt = Math.min(1000, now - (this.drawT || now));
    this.drawT = now;
    DieView.prototype.frame.call(this, now, dt);
    if (!this.els || !this.els.robSec) return;
    this.stepOverlay(now);
    if (!this.visible) return;
    this.renderTsc();
    const O = this.oo;
    if (!fastOn) {
      O.vt = this.ooClock(now);
      this.ooMilestones(O.vt);
    }
    this.renderOoo(O.vt);
    if (now - (this.gridT || 0) > 200) {
      this.gridT = now;
      this.renderCacheL1('i'); this.renderCacheL1('d'); this.renderBtb(); this.renderTlb(); this.renderL2Map(now, false);
      if (!this.p5.acc.i) this.renderTagL1('i');
      if (!this.p5.acc.d) this.renderTagL1('d');
      if (!O.l2acc) this.renderL2Tag();
    }
  }
  // The model clock that the view shows now (it moves from t0 to t1 while the instruction plays).
  ooClock(now) {
    const O = this.oo, pl = O.play;
    if (!pl || !O.cur || O.cur.idle) return O.vt;
    let u;
    if (this.manual) u = clamp(this.vclock / Math.max(1, this.cycles), 0, 1);
    else if (pl.trace && O.tr) {
      const T = O.tr, k = easeInOut(clamp((now - T.start) / (T.ms * 0.85), 0, 1)), vt = T.from + (T.to - T.from) * k;
      return this.reduced ? Math.floor(vt) : vt;
    } else u = clamp((now - pl.start) / pl.dur, 0, 1);
    u = clamp(u / 0.92, 0, 1);
    const vt = O.t0 + u * (O.t1 - O.t0);
    return this.reduced ? Math.floor(vt) : vt;
  }
  // Tokens and sounds when the model clock of the view passes the clocks of the µops.
  ooMilestones(vt) {
    const O = this.oo, cur = O.cur, tc = Math.floor(vt);
    if (!cur || cur.idle || tc === O.lastTc) return;
    const from = O.lastTc;
    O.lastTc = tc;
    if (tc < from || tc - from > 8) return;
    const hit = t => t > from && t <= tc, a = this.anim(this.vclock);
    const slow = this.cms >= 20;
    if (hit(cur.dclk)) {
      this.flash('drow:' + clamp(cur.dec, 0, 3), a, 3, 700);
      if (slow) this.token(this.vclock, ['ifu', 'dec'], this.mnem(cur.n) || 'x86', THEME.gold, 0, 1, 360);
      if (cur.dec === 3) this.flash('ms', a, 4, 900);
    }
    let first = true, disp = 0, ret = 0;
    for (const j of cur.mine) {
      const port = this.oo.port[j], pk = port >= 0 ? 'p' + port : 'rob', lab = this.kname(j);
      if (hit(O.iss[j]) && first) {
        first = false;
        if (slow) this.token(this.vclock, ['dec', 'rat'], `${cur.uops} µop${cur.uops === 1 ? '' : 's'}`, THEME.phosphor, 0, 1, 360);
        if (slow) this.token(this.vclock, ['rat', 'rob'], 'ROB ' + O.rob[j], THEME.phosphor, 0.6, 1, 360);
      }
      if (hit(O.dis[j])) { disp++; if (slow && disp <= 3) this.token(this.vclock, ['rs', pk], lab + ' ' + O.rob[j], THEME.cyan, 0, 1, 380); this.flash('port:' + clamp(port, 0, 4), a, 3, 600); }
      if (hit(O.done[j]) && slow && O.done[j] - O.dis[j] > 1) this.token(this.vclock, [pk, 'rob'], 'done', THEME.phosphor, 0, 1, 360);
      if (hit(O.ret[j])) { ret++; if (slow && ret === 1) this.token(this.vclock, ['rob', 'rrf'], 'RETIRE', THEME.goldHi, 0, 1, 380); }
    }
    if (disp) this.sfxTick(1.3);
    if (ret) { this.sfxTick(2.0); this.flash('rrf', a, 3, 700); }
    const bt = cur.btb;
    if (bt && !bt.right && hit(bt.resolve)) {
      this.flash('ifflush', a, 8, 1400);
      this.flash('robfl', a, 6, 1200);
      if (slow) this.token(this.vclock, ['p1', 'ifu'], 'FLUSH', THEME.magenta, 0, 1.2, 420);
      if (this.sfxOn() && typeof Sfx !== 'undefined') Sfx.tick(0.6, 0.03);
    }
  }

  // The pads of the front-side bus: the phases of the pipelined P6 bus (simplified: one
  // transaction at a time). Bus clock 0: the request phase (ADS#, REQ#, the address); bus clock
  // 1: the snoop phase (HIT#, HITM#; TRDY# for a write); the last bus clock of the first
  // transfer: the response (RS#) and the data (DRDY#). The other transfers: the data phase.
  busPhase(cur) {
    const r = this.busRatio(), e = cur.e, bc = Math.floor(cur.T / r), nb = Math.max(1, Math.round(cur.len / r));
    const first = !e.burst || (e.beat | 0) === 0;
    if (!first) return { ph: 4, bc, nb, data: bc === nb - 1 };
    if (bc === 0) return { ph: 0, bc, nb, data: false };
    if (bc < nb - 1) return { ph: 2, bc, nb, data: false };
    return { ph: 3, bc, nb, data: true };
  }
  stepPads(now) {
    const st = this.padSt || (this.padSt = new Map());
    st.clear();
    const set = (n, c) => st.set(n, c);
    const cur = this.curBus(now), E = this.els, P = dieP();
    let ph = null;
    if (cur) {
      const e = cur.e, type = cur.type, write = type === 'memw' || type === 'iow';
      ph = this.busPhase(cur);
      const addr = type === 'inta' ? 4 : type === 'halt' ? 2 : e.addr >>> 0;
      if (ph.ph === 0) {
        set('ADS', 'c1');
        for (let k = 0; k < 5; k++) set('REQ' + k, 'c1');
        for (let b = 3; b < 32; b++) set('A' + b, 'a' + ((addr >>> b) & 1));
      }
      if (ph.ph === 2 && write) set('TRDY', 'c1');
      if (ph.ph >= 3) { set('DBSY', 'c1'); if (ph.data) set('DRDY', 'g1'); }
      if (ph.ph === 3) { set('RS0', 'c1'); set('RS1', 'c1'); set('RS2', 'c1'); }
      if (ph.data || (write && ph.ph >= 2)) {
        const lane0 = e.burst ? 0 : addr & 7, n = e.burst ? 8 : clamp(e.width || 1, 1, 8);
        for (let k = 0; k < n && lane0 + k < 8; k++) {
          if (type === 'halt' || (type === 'inta' && k > 0)) continue;
          const v = k < 4 ? (e.data >>> (8 * k)) & 255 : ((e.hi || 0) >>> (8 * (k - 4))) & 255, L = lane0 + k;
          for (let bb = 0; bb < 8; bb++) set('D' + (L * 8 + bb), 'd' + ((v >> bb) & 1));
        }
      }
      if (type === 'inta') { set('LOCK', 'c1'); set('LINT0', 'c1'); }
      set('BR0', 'c1');
    }
    const it = this.anims.intr;
    if (it) {
      const p = this.prog(it, now);
      if (p >= 0 && p < 1) { if (it.e.src === 'irq') set('LINT0', 'c1'); if (it.e.src === 'nmi') set('LINT1', 'c1'); }
    }
    const f = this.m.fpu;
    if (f && f.intRequest) set('FERR', 'c1');
    if (this.resetAt && now - this.resetAt < 900) set('RESET', 'c1');
    if (!this.m.a20) set('A20M', 'c1');
    const bsb = this.anims.bsb, bp = bsb ? this.prog(bsb, now) : 2, bsbOn = bp >= 0 && bp < 1;
    if (bsbOn) set('BSB', 'g1');
    const playing = this.anims.dec && this.prog(this.anims.dec, now) < 1;
    if (playing && this.cms >= 12 && (this.vclock % 1) < 0.5) set('BCLK', 'g1');
    for (const pd of E.pads) {
      const cls = st.get(pd.name);
      this.setC(pd.c, pd.base + (cls ? ' dv-' + cls : ''));
    }
    const ringCol = !cur ? P.scribe : ph.ph === 0 ? THEME.cyan : cur.e.wb ? THEME.magenta : THEME.gold;
    this.setA(E.ring, 'stroke', ringCol);
    this.setA(E.ring, 'opacity', cur ? '0.9' : '0.55');
    const lamp = (el, on, col) => this.setA(el, 'fill', on ? col : P.dot);
    if (E.bl) {
      lamp(E.bl.ADS, st.has('ADS'), THEME.magenta); lamp(E.bl.REQ, st.has('REQ0'), THEME.magenta); lamp(E.bl.BNR, false, THEME.magenta);
      lamp(E.bl.HIT, false, THEME.magenta); lamp(E.bl.HITM, false, THEME.magenta); lamp(E.bl.RS, st.has('RS0'), THEME.magenta);
      lamp(E.bl.DRDY, st.has('DRDY'), THEME.phosphor); lamp(E.bl.DBSY, st.has('DBSY'), THEME.gold); lamp(E.bl.TRDY, st.has('TRDY'), THEME.magenta);
    }
    if (E.beL) {
      const e = cur && cur.e, on = cur && ph.ph === 0 && cur.type !== 'halt';
      const lane0 = e ? (e.burst ? 0 : e.addr & 7) : 0, n = e ? (e.burst ? 8 : clamp(e.width || 1, 1, 8)) : 0;
      [7, 6, 5, 4, 3, 2, 1, 0].forEach((k, i) => lamp(E.beL[i], on && k >= lane0 && k < lane0 + n, THEME.magenta));
    }
    if (E.fsbPh) E.fsbPh.forEach((c, i) => this.setC(c, 'dv-cell' + (ph && i === ph.ph ? ' dv-l dv-on' : ph && i < ph.ph ? ' dv-on' : '')));
    if (E.bsbLamp) this.setA(E.bsbLamp, 'fill', bsbOn ? THEME.phosphor : P.dot);
    if (E.bsbWire) this.setC(E.bsbWire, 'dv-wire' + (bsbOn ? ' dv-on' : ''));
    if (E.bsbIn) this.setA(E.bsbIn, 'opacity', bsbOn ? '1' : '0.7');
  }
  stepBusCtl(now) {
    const E = this.els, cur = this.curBus(now);
    if (!E.beat) return;
    const e = cur ? cur.e : null, burst = !!(e && e.burst), beat = e ? e.beat | 0 : 0, type = cur ? cur.type : null;
    const ph = cur ? this.busPhase(cur) : null;
    const PH = ['REQUEST', 'ERROR', 'SNOOP', 'RESPONSE', 'DATA'];
    const name = !cur ? 'FSB IDLE' : (burst ? (e.wb ? 'WRITE-BACK' : type === 'code' ? 'CODE LINE' : 'LINE READ') : DIE_CYCLE[type] || type) + ' · ' + PH[ph.ph];
    this.setT(E.bcType, name);
    this.setA(E.bcType, 'class', !cur ? 'dv-m' : ph.ph === 0 ? 'dv-cy' : burst && e.wb ? 'dv-mg' : 'dv-go');
    E.beat.forEach((c, i) => this.setC(c, 'dv-cell' + (burst && i === beat ? ' dv-l dv-on' : burst && i < beat ? ' dv-on' : '')));
    const lane0 = e ? (burst ? 0 : e.addr & 7) : 0, n = e ? (burst ? 8 : clamp(e.width || 1, 1, 8)) : 0;
    const show = !!e && (ph.data || type === 'memw' || type === 'iow');
    const key = show ? `${e.addr}|${e.data}|${e.hi}|${n}` : '';
    if (key !== this.laneKey) {
      this.laneKey = key;
      for (const L of E.lane) {
        const k = L.n - lane0, on = show && k >= 0 && k < n && type !== 'halt';
        const v = !on ? -1 : k < 4 ? (e.data >>> (8 * k)) & 255 : ((e.hi || 0) >>> (8 * (k - 4))) & 255;
        this.setT(L.t, on ? hex2(v) : '··');
        this.setC(L.c, 'dv-cell' + (on ? ' dv-on' : ''));
      }
    }
    const r = this.busRatio();
    this.setT(E.bcPipe, cur ? `bus clock ${ph.bc + 1} of ${ph.nb} · ${burst ? `transfer ${beat + 1} of 4` : 'one transfer'} · core ×${r}` : `FSB ${(this.m.clockHz / r / 1e6).toFixed(1)} MHz · 64 bits · core ×${r}`);
  }
  stepMisc(now) {
    const E = this.els, O = this.oo, cur = O && O.cur;
    const fastOn = this.lastFast && now - this.lastFast < 160;
    let pos = -1;
    if (fastOn) { if ((this.heatT.msrom || 0) > 0.05) pos = Math.floor(now / 70) % 22; }
    else if (cur && !cur.idle && cur.dec === 3) {
      const tc = O.vt, n = Math.ceil(cur.uops / 4);
      if (tc >= cur.dclk && tc < cur.dclk + n + 1) pos = ((cur.n * 7 + Math.floor(tc - cur.dclk) * 5) >>> 0) % 22;
    }
    this.setA(E.romRow, 'x', String(1110 + Math.max(0, pos) * (310 / 21)));
    this.setA(E.romRow, 'opacity', pos < 0 ? '0' : fastOn ? '0.4' : '0.9');
    const dec = this.anims.dec, playing = dec && this.prog(dec, now) < 1 && !fastOn;
    this.setT(E.decClk, playing && cur && !cur.idle ? `model clock ${Math.floor(O.vt)}` : '');
    this.setA(E.clkDot, 'fill', playing && (this.vclock % 1) < 0.5 ? THEME.phosphor : fastOn ? THEME.gold : dieP().dot);
    this.setT(E.clkText, fastOn ? 'free running' : playing ? `${this.cms >= 1 ? Math.round(this.cms) : this.cms.toFixed(1)} ms / clock` : this.mhz());
  }

  // ---------- renders ----------
  renderAll() {
    if (!this.els || !this.els.robSec) return;
    for (const r of D386_REGS) this.renderReg(r, 0);
    for (const n of D386_SREGS) this.renderReg(n, 0);
    this.renderReg('EIP', 0);
    this.renderFlags(); this.renderIntr(); this.renderFpu486(); this.renderBusText(); this.renderSys(); this.renderTsc();
    this.renderTlb(); this.renderPmh(); this.renderMsStats();
    this.renderCacheL1('i'); this.renderCacheL1('d'); this.renderTagL1('i'); this.renderTagL1('d'); this.renderFill586('i'); this.renderFill586('d');
    this.renderBtb(); this.renderBtbText(); this.renderL2Tag(); this.renderL2Map(animNow(), false);
    this.renderStep686();
    if (this.chips.map(c => c.byte).join() !== this.mdl.q.join()) this.rebuildChips();
    this.setT(this.els.qCount, this.mdl.q.length + '/' + this.QN);
    this.laneKey = null;
    if (this.oo) { this.oo.drawn = ''; this.renderOoo(this.oo.vt); }
  }
  renderDec() {
    const E = this.els, d = this.mdl.dec;
    if (!E.decBytes) return;
    const by = d ? d.bytes || [] : [];
    this.setT(E.decBytes, by.slice(0, 8).map(hex2).join(' ') + (by.length > 8 ? ' …' : ''));
  }
  renderFpu486() {
    Die486View.prototype.renderFpu486.call(this);
    const E = this.els;
    if (E.fOp) this.setT(E.fOp, this.mdl.fpuText ? 'FPU ' + (this.mdl.fpuText.length > 26 ? this.mdl.fpuText.slice(0, 25) + '…' : this.mdl.fpuText) : 'FPU idle');
  }
  renderMsStats() {
    const E = this.els, c = this.m.cpu, s = c.oooStats;
    if (!E.msSt || !s) return;
    const f = v => Math.round(v).toLocaleString('en-US');
    const D = s.decoders, all = D[0] + D[1] + D[2] + D[3];
    const pc = v => (all ? (v / all * 100).toFixed(0) : '0') + ' %';
    this.setT(E.msSt, `decoders: D0 ${pc(D[0])} · D1 ${pc(D[1])} · D2 ${pc(D[2])} · MSROM ${pc(D[3])}`);
    this.setT(E.msSt2, `µops ${f(s.uops)} · ${s.instructions ? (s.uops / s.instructions).toFixed(2) : '0'} µops for each instruction`);
    this.setT(E.msSt3, `stalls: ROB full ${f(s.robFull)} · RS full ${f(s.rsFull)} · partial register ${f(s.partial)}`);
  }
  // The L1 caches: 256 lines; the colour of a data line is its MESI state, a new fill is bright.
  renderCacheL1(k) {
    const E = this.els, C = E[k + 'C'], c = this.m.cpu;
    if (!C) return;
    const code = k === 'i', K = code ? c.icache : c.dcache, T = K.tag, S = code ? null : K.state, F = this.p5.fill[k];
    const cls = this['gridCls' + k] || (this['gridCls' + k] = new Int8Array(256));
    for (let i = 0; i < 256; i++) {
      const valid = T[i] >= 0;
      const la = valid ? (code ? c.iLineAddr(T[i], i) : c.lineAddr(T[i], i)) : -1;
      const nw = !!(F && F.done && !F.wb && valid && la === F.line);
      cls[i] = !valid ? 0 : nw ? (S ? 4 : 2) : S ? S[i] : 1;
    }
    this.paintGrid(C.grid, cls);
    const st = K.stats, f = v => v.toLocaleString('en-US');
    this.setT(C.stat, code ? `hits ${f(st.hits)} · misses ${f(st.misses)} · fills ${f(st.fills)}`
      : `hits ${f(st.hits)} · misses ${f(st.misses)} · RFO ${f(st.rfo || 0)} · M lines to the L2 ${f(st.writeBacks)}`);
  }
  placeCacheL1(k, set, way) {
    const C = this.els[k + 'C'];
    if (!C) return;
    const x0 = C.gx0 + (set % C.cols) * C.cw, y0 = C.gy0 + Math.floor(set / C.cols) * C.ch;
    for (const el of [C.setFl, C.setMark]) { this.setA(el, 'x', (x0 - 1).toFixed(1)); this.setA(el, 'y', (y0 - 0.8).toFixed(1)); }
    this.setA(C.setMark, 'opacity', '0.9');
    if (way >= 0) { this.setA(C.wayFl, 'x', (x0 + way * C.ww - 0.5).toFixed(1)); this.setA(C.wayFl, 'y', (y0 - 0.5).toFixed(1)); }
  }
  // the way that the next fill of a set of the code cache replaces (the pseudo-LRU tree)
  iVictim(set) {
    const c = this.m.cpu, T = c.icache.tag, k = set * 4;
    for (let w = 0; w < 4; w++) if (T[k + w] < 0) return w;
    const b = c.icache.lru[set];
    return !(b & 1) ? (b & 2 ? 1 : 0) : (b & 4 ? 3 : 2);
  }
  renderTagL1(k) {
    const E = this.els, C = E[k + 'C'], x = this.p5.acc[k], c = this.m.cpu;
    if (!C) return;
    const code = k === 'i', K = code ? c.icache : c.dcache, P = dieP(), nw = C.nw;
    if (!x) {
      this.setT(C.addr, '--------'); this.setT(C.tag, '--'); this.setT(C.set, '--'); this.setT(C.ofs, '--');
      this.setT(C.res, K.stats.hits + K.stats.misses ? 'no access in this trace yet' : 'no access yet');
      this.setA(C.res, 'class', 'dv-f');
      this.setT(C.note, '');
      for (const R of C.ways) { this.setT(R.t, '-----'); this.setT(R.st, ''); this.setT(R.a, ''); this.setT(R.m, ''); this.setA(R.bg, 'stroke', P.cellStroke); }
      return;
    }
    const set = x.set;
    this.setT(C.addr, dvHex8(x.phys));
    this.setT(C.tag, code ? hex(x.phys >>> 11, 6) : hex(x.phys >>> 12, 5)); this.setT(C.set, hex2(set)); this.setT(C.ofs, hex2(x.phys & 31));
    const nextW = code ? this.iVictim(set) : K.lru[set];
    for (let w = 0; w < nw; w++) {
      const i = set * nw + w, R = C.ways[w], tag = K.tag[i], valid = tag >= 0;
      const st = valid ? (code ? 'S' : D586_MESI[K.state[i]]) : 'I';
      const match = x.way === w && (x.hit || x.fill);
      this.setT(R.t, valid ? hex(tag, code ? 6 : 5) : '-----');
      this.setA(R.t, 'class', match ? 'dv-ph' : valid ? 'dv-v' : 'dv-f');
      this.setT(R.st, st);
      this.setA(R.st, 'class', st === 'M' ? 'dv-mg' : st === 'E' ? 'dv-ph' : st === 'S' ? 'dv-cy' : 'dv-f');
      this.setT(R.a, valid ? 'line ' + dvHex8(code ? c.iLineAddr(tag, i) : c.lineAddr(tag, i)) : 'empty');
      this.setT(R.m, (match ? (x.hit ? '= HIT' : 'NEW') : valid ? '≠' : '') + (w === nextW ? ' ◂ next' : ''));
      this.setA(R.m, 'class', match ? 'dv-ph' : 'dv-f');
      this.setA(R.bg, 'stroke', match ? (x.hit ? THEME.phosphor : THEME.gold) : P.cellStroke);
    }
    let res, cls;
    if (x.write) {
      cls = 'dv-go';
      res = x.hit ? (x.state === 'M' ? 'WRITE HIT · the line is M' : `WRITE HIT · ${x.state}`) : x.fill ? 'WRITE MISS · RFO: read the line, then M' : 'WRITE MISS · to the bus';
    } else if (x.hit) { res = `HIT · way ${x.way}` + (code ? '' : ` · ${x.state}`); cls = 'dv-ph'; }
    else if (x.fill) { res = `MISS · the L2 gives the line · way ${x.way}`; cls = 'dv-mg'; }
    else { res = 'MISS · not cached (no KEN# or PCD)'; cls = 'dv-mg'; }
    this.setT(C.res, res);
    this.setA(C.res, 'class', cls);
    this.setT(C.note, x.wb ? `M line ${dvHex8(x.wbLine)} → L2` : '');
    this.setA(C.note, 'class', x.wb ? 'dv-mg' : 'dv-f');
  }
  renderBtb() {
    const E = this.els, B = this.m.cpu.btb;
    if (!E.btb || !B) return;
    const cls = this.btbCls686 || (this.btbCls686 = new Int8Array(512));
    for (let i = 0; i < 512; i++) cls[i] = B.tag[i] !== -1 ? 1 + (B.counter[i] & 3) : 0;
    this.paintGrid(E.btb, cls);
    const s = B.stats, f = v => v.toLocaleString('en-US');
    this.setT(E.btbSt, `branches ${f(s.branches)} · right ${s.branches ? (s.right / s.branches * 100).toFixed(1) : '—'} % · wrong ${f(s.wrong)}`);
    this.setT(E.btbSt2, `static ${f(s.staticRight)} right, ${f(s.staticWrong)} wrong · RSB ${f(s.rsbRight)} right`);
    this.setT(E.btbRsb, `return stack ${B.rsbTop & 15}/16` + (B.rsbTop ? ` · top ${dvHex8(B.rsb[(B.rsbTop - 1) & 15])}` : ''));
  }
  renderBtbText() {
    const E = this.els, x = this.p5.btbE, B = this.m.cpu.btb, P = dieP();
    if (!E.btbL1) return;
    if (!x) {
      this.setT(E.btbL1, 'no branch yet'); this.setA(E.btbL1, 'class', 'dv-f'); this.setT(E.btbL2, ''); this.setT(E.btbL3, '');
      E.btbH.forEach(h => { this.setT(h.t, '·'); this.setC(h.c, 'dv-cell'); });
      this.setA(E.btbPhtSel, 'opacity', '0');
      return;
    }
    const kind = (x.kind || 'jcc').toUpperCase();
    this.setT(E.btbL1, `${kind} ${dvHex8(x.lin >>> 0)}` + (x.set >= 0 ? ` · set ${hex2(x.set)}` + (x.way >= 0 ? ` way ${x.way}` : '') : ''));
    this.setA(E.btbL1, 'class', 'dv-v');
    const h = x.history;
    E.btbH.forEach((c, i) => {
      const bit = h >= 0 ? (h >> (3 - i)) & 1 : -1;
      this.setT(c.t, bit < 0 ? '·' : bit ? 'T' : 'N');
      this.setC(c.c, 'dv-cell' + (bit > 0 ? ' dv-on' : ''));
    });
    const ent = x.set >= 0 && x.way >= 0 ? x.set * 4 + x.way : -1;
    for (let i = 0; i < 16; i++) this.setA(E.btbPht[i], 'fill', ent >= 0 ? this.btbCol(B.pht[ent * 16 + i] & 3) : P.row0);
    if (ent >= 0 && h >= 0 && x.how === 'btb') { this.setA(E.btbPhtSel, 'x', (452 + h * 8.6 - 1.5).toFixed(1)); this.setA(E.btbPhtSel, 'opacity', '1'); }
    else this.setA(E.btbPhtSel, 'opacity', '0');
    const pred = x.predicted ? 'TAKEN' : 'NOT TAKEN';
    this.setT(E.btbL2, x.how === 'btb' ? `history ${h >= 0 ? bin(h, 4) : '----'} selects counter ${x.counter} → ${pred}`
      : x.how === 'rsb' ? `RET: the return stack predicts ${dvHex8(x.target >>> 0)}` : `not in the BTB: the decoder predicts ${pred}`);
    this.setT(E.btbL3, `${x.taken ? 'taken' : 'not taken'} · ` + (x.right ? 'RIGHT' + (x.penalty ? ` · +${x.penalty} clk` : '') : `WRONG · FLUSH · +${x.penalty} clocks`));
    this.setA(E.btbL3, 'class', x.right ? 'dv-ph' : 'dv-mg');
  }
  // The page miss handler: the last walk (or the last TLB hit).
  renderPmh() {
    const E = this.els;
    if (!E.pmh) return;
    const s = this.mdl.sys || {}, g = this.mdl.pg;
    if (!s.pg || !g) {
      this.setT(E.pmh[0], s.pg ? 'paging on' : 'paging off:');
      this.setT(E.pmh[1], s.pg ? '' : 'linear = physical');
      this.setT(E.pmh[2], ''); this.setT(E.pmh[3], '');
      const sg = this.mdl.sig;
      this.setT(E.pgPhys, !s.pg && sg ? dvHex8(sg.lin !== undefined ? sg.lin : sg.phys) : '');
      return;
    }
    this.setT(E.pmh[0], `lin ${dvHex8(g.lin)}`);
    this.setT(E.pmh[1], g.hit ? 'TLB HIT' : 'PDE ' + (g.pde === null || g.pde === undefined ? '--------' : dvHex8(g.pde)));
    this.setT(E.pmh[2], g.hit ? '' : g.big ? 'PS = 1 · 4 MB page' : 'PTE ' + (g.pte === null || g.pte === undefined ? '--------' : dvHex8(g.pte)));
    this.setT(E.pmh[3], g.fault ? '#PF' : g.global ? 'G = 1 · global' : g.hit ? '' : 'walk done');
    this.setA(E.pmh[3], 'class', g.fault ? 'dv-mg' : 'dv-lv');
    this.setT(E.pgPhys, g.fault ? '' : dvHex8(g.phys));
  }
  renderPage() { this.renderPmh(); }
  onPage(e, a) {
    super.onPage(e, a);
    if (this.mdl.pg) this.mdl.pg.global = !!e.global;
    this.renderPmh();
  }
  // ---- the L2 die ----
  placeL2(set) {
    const E = this.els, G = E.l2G;
    if (!G) return;
    const x = G.x + (set % G.cols) * G.cw, y = G.y + Math.floor(set / G.cols) * G.ch;
    this.setA(E.l2Mark, 'x', (x - 1).toFixed(1)); this.setA(E.l2Mark, 'y', (y - 1).toFixed(1)); this.setA(E.l2Mark, 'opacity', '1');
    this.setA(E.l2Fl, 'x', (x - 3).toFixed(1)); this.setA(E.l2Fl, 'y', (y - 3).toFixed(1));
  }
  renderL2Tag() {
    const E = this.els, L = E.l2T, c = this.m.cpu, K = c.l2, x = this.oo && this.oo.l2acc, P = dieP();
    if (!L || !K) return;
    const s = K.stats, f = v => v.toLocaleString('en-US');
    this.setT(L.st1, `requests ${f(s.requests)} · hits ${f(s.hits)} · misses ${f(s.misses)} · hit rate ${s.requests ? (s.hits / s.requests * 100).toFixed(1) : '—'} %`);
    this.setT(L.st2, `fills ${f(s.fills)} · write-backs to memory ${f(s.writeBacks)} · code requests ${f(s.codeRequests)}`);
    if (!x) {
      this.setT(L.addr, '--------'); this.setT(L.tag, '--'); this.setT(L.set, '--'); this.setT(L.ofs, '--');
      this.setT(L.res, s.requests ? 'no L2 access in this trace yet' : 'no access yet'); this.setA(L.res, 'class', 'dv-f'); this.setT(L.note, '');
      for (const R of L.ways) { this.setT(R.t, '----'); this.setT(R.st, ''); this.setT(R.a, ''); this.setT(R.m, ''); this.setA(R.bg, 'stroke', P.cellStroke); }
      return;
    }
    const set = (x.phys >>> 5) & 2047;
    this.setT(L.addr, dvHex8(x.phys)); this.setT(L.tag, hex(x.phys >>> 16, 4)); this.setT(L.set, hex(set, 3)); this.setT(L.ofs, hex2(x.phys & 31));
    for (let w = 0; w < 4; w++) {
      const i = set * 4 + w, R = L.ways[w], tag = K.tag[i], valid = tag >= 0;
      const st = valid ? D586_MESI[K.state[i]] : 'I', match = x.way === w && (x.hit || x.fill);
      this.setT(R.t, valid ? hex(tag, 4) : '----');
      this.setA(R.t, 'class', match ? 'dv-ph' : valid ? 'dv-v' : 'dv-f');
      this.setT(R.st, st);
      this.setA(R.st, 'class', st === 'M' ? 'dv-mg' : st === 'E' ? 'dv-ph' : st === 'S' ? 'dv-cy' : 'dv-f');
      this.setT(R.a, valid ? 'line ' + dvHex8(c.l2LineAddr(tag, i)) : 'empty');
      this.setT(R.m, match ? (x.hit ? '= HIT' : 'NEW') : valid ? '≠' : '');
      this.setA(R.m, 'class', match ? 'dv-ph' : 'dv-f');
      this.setA(R.bg, 'stroke', match ? (x.hit ? THEME.phosphor : THEME.gold) : P.cellStroke);
    }
    this.setT(L.res, x.hit ? `${x.code ? 'CODE' : 'DATA'} HIT · way ${x.way} · 4 clocks more than L1 · no FSB cycle` : x.fill ? `MISS · a burst of 4 × 8 bytes on the FSB · way ${x.way}` : 'MISS · not cached');
    this.setA(L.res, 'class', x.hit ? 'dv-ph' : 'dv-mg');
    this.setT(L.note, x.wb ? `M line ${dvHex8(x.wbLine)} goes to memory first` : '');
    this.setA(L.note, 'class', x.wb ? 'dv-mg' : 'dv-f');
  }
  // The map of the 8192 lines: a small canvas, one pixel for each line, as the href of an image.
  renderL2Map(now, force) {
    const E = this.els, G = E.l2G, c = this.m.cpu, K = c.l2, O = this.oo;
    if (!G || !K || !E.l2Img) return;
    // the picture changes only with a fill, a write-back, an invalidation, a flush or an M line from the L1
    const s = K.stats, key = s.fills * 7 + s.writeBacks * 13 + s.invalidations * 17 + s.flushes * 31 + c.dcache.stats.writeBacks * 3;
    if (key === O.l2Key && !force) return;
    if (now - O.l2T < (this.lastFast ? 500 : 150)) return;
    O.l2Key = key; O.l2T = now;
    const w = G.cols * 4, h = G.rows;
    let cv = this.l2cv;
    if (!cv) {
      cv = this.l2cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      this.l2ctx = cv.getContext('2d', { willReadFrequently: true });
      const col = x => dvRgb(x);
      this.l2rgb = [col(dieP().row0), col(dvMix(THEME.cyan, THEME.panel, 0.25)), col(dvMix(THEME.phosphor, THEME.panel, 0.3)), col(dvMix(THEME.magenta, THEME.panel, 0.15))];
      this.l2img = this.l2ctx.createImageData(w, h);
    }
    const D = this.l2img.data, T = K.tag, S = K.state, C = this.l2rgb;
    for (let i = 0; i < 8192; i++) {
      const set = i >> 2, x = (set % G.cols) * 4 + (i & 3), y = (set / G.cols) | 0, o = (y * w + x) * 4;
      const rgb = T[i] < 0 ? C[0] : C[S[i] & 3] || C[1];
      D[o] = rgb[0]; D[o + 1] = rgb[1]; D[o + 2] = rgb[2]; D[o + 3] = 255;
    }
    this.l2ctx.putImageData(this.l2img, 0, 0);
    let url = '';
    try { url = cv.toDataURL('image/png'); } catch (err) { url = ''; }
    if (url) E.l2Img.setAttribute('href', url);
  }

  // ---- the out-of-order core at the model clock of the view ----
  // The parts that change only with the instruction: the decoders, the chart, the notes.
  renderStep686() {
    const E = this.els, O = this.oo, c = this.m.cpu;
    if (!E.robSec || !O || !c.rob) return;
    const cur = O.cur, P = dieP();
    const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
    // the decoders: the instructions of the decode group of this instruction
    const grp = [-1, -1, -1, -1];
    if (cur && !cur.idle) {
      for (let i = 0; i < 64; i++) {
        const n = O.sN[i];
        if (n < 0 || n > cur.n || cur.n - n > 8 || O.sDclk[i] !== cur.dclk || O.sDec[i] < 0) continue;
        const d = O.sDec[i];
        if (grp[d] < 0 || O.sN[grp[d]] < n) grp[d] = i;
      }
    }
    E.dRow.forEach((R, d) => {
      const i = grp[d], on = i >= 0, me = on && cur && O.sN[i] === cur.n;
      const nu = on ? O.sUops[i] : 0;
      this.setT(R.t, on ? cut(O.sText[i], 26) : '');
      this.setA(R.t, 'class', me ? 'dv-ph' : on ? 'dv-v' : 'dv-f');
      R.chips.forEach((ch, k) => this.setA(ch, 'opacity', k < nu ? (me ? '0.95' : '0.45') : '0'));
      this.setT(R.u, on ? `${nu} µop${nu === 1 ? '' : 's'}` : '');
      this.setA(R.bg, 'stroke', me ? THEME.phosphor : P.cellStroke);
      this.setA(R.bg, 'stroke-width', me ? '1.8' : '1');
    });
    if (cur && !cur.idle) {
      const n = grp.filter(x => x >= 0).length, mn = this.mnem(cur.n);
      this.setT(E.dGroup, `decode clock ${cur.dclk} · ${n} instruction${n === 1 ? '' : 's'} in this group`);
      const why = cur.dec === 3 ? `${mn}: ${cur.uops} µops, more than 4: the MSROM makes them`
        : cur.dec === 0 ? (cur.uops > 1 ? `${mn}: ${cur.uops} µops, so only D0 can take it` : `${mn}: 1 µop, D0 is the first free decoder`)
          : cur.dec > 0 ? `${mn}: 1 µop, the simple decoder D${cur.dec} takes it` : '';
      this.setT(E.dWhy, cut(why, 48));
      this.setT(E.dWhy2, cur.dec === 0 && grp[1] < 0 && grp[2] < 0 ? 'the next instruction can go to D1 or D2' : '');
      this.setT(E.msText, cur.dec === 3 ? cut(`${mn}: ${cur.uops} µops, 4 each clock (${Math.ceil(cur.uops / 4)} clocks)`, 50) : 'idle: the decoders make the µops');
      this.setA(E.msText, 'class', cur.dec === 3 ? 'dv-ph' : 'dv-f');
    } else {
      this.setT(E.dGroup, cur && cur.halted ? 'HLT: the CPU waits for an interrupt' : '');
      this.setT(E.dWhy, ''); this.setT(E.dWhy2, '');
    }
    // the RAT notes of this instruction
    const rat = cur && !cur.idle ? cur.rat : null;
    const nm = x => (x.rob < 0 ? 'RRF' : 'ROB ' + x.rob);
    this.setT(E.ratR, rat && rat.reads.length ? cut('reads ' + rat.reads.map(x => `${x.r}←${nm(x)}`).join(' '), 44) : '');
    this.setT(E.ratW, rat && rat.writes.length ? cut('renames ' + rat.writes.map(x => `${x.r}→ROB ${x.rob}`).join(' '), 44) : '');
    this.setT(E.ratN, cur && !cur.idle ? cut(cur.text, 40) : '');
    // the fetch unit: the prediction of this instruction and the next fetch
    const bt = cur && !cur.idle ? cur.btb : null;
    if (bt) {
      this.setT(E.ifPred, bt.how === 'rsb' ? `RET: return stack → ${dvHex8(bt.target >>> 0)}` : `${bt.how === 'btb' ? 'BTB' : 'static'}: predict ${bt.predicted ? 'TAKEN' : 'NOT TAKEN'}`);
      this.setT(E.ifPred2, bt.predicted && bt.target ? `fetch goes on at ${dvHex8(bt.target >>> 0)}` : 'fetch goes on after the branch');
      this.setT(E.ifFlush, bt.right ? '' : 'WRONG PREDICTION: FLUSH');
      this.setT(E.ifFlush2, bt.right ? '' : `the fetch starts again ${bt.penalty} clocks after the decode`);
    } else { this.setT(E.ifPred, ''); this.setT(E.ifPred2, ''); this.setT(E.ifFlush, ''); this.setT(E.ifFlush2, ''); }
    const pa = this.m.cpu.peekPhys ? this.m.cpu.peekPhys(c.linearIP >>> 0) : c.linearIP;
    this.setT(E.ifLine, 'fetch ' + dvHex8(((pa < 0 ? c.linearIP : pa) & ~15) >>> 0) + ' · 16 bytes each clock');
    this.setT(E.ifNext, cur && !cur.idle && this.dec ? cut(`this instruction: ${this.dec.len || 0} bytes`, 40) : '');
    this.setT(E.ifIld, 'the length decoder marks the instruction starts');
    // the loads of this instruction (the memory order buffer)
    const loads = [];
    if (cur && !cur.idle) {
      const acc = (cur.cache || []).filter(x => x.cache === 'data');
      const l1 = acc.find(x => x.level === 'L1'), l2 = acc.find(x => x.level === 'L2');
      for (const j of cur.mine) {
        if (c.rob.kinds[O.kind[j]] !== 'load') continue;
        const lat = O.done[j] - O.dis[j];
        let where = lat <= 3 ? 'L1 hit' : lat <= 8 ? 'L2 hit' : 'L2 miss: FSB';
        if (!loads.length && l1 && !l1.write) where = l1.hit ? 'L1 hit' : l2 ? (l2.hit ? 'L2 hit' : 'L2 miss: FSB') : where;
        const w = D686_WAITS[O.wait[j]];
        if (w === 'store data') where = 'data from a store';
        if (w === 'store buffer') where = 'waits for a store';
        loads.push(`ROB ${O.rob[j]} · ${where} · ${lat} clk`);
      }
    }
    E.mobL.forEach((t, i) => this.setT(t, loads[i] || (i === 0 && cur && !cur.idle ? 'no load' : '')));
    // the chart
    this.renderGantt();
    this.setT(E.robInfo, cur && !cur.idle ? cut(`${this.mnem(cur.n)}: ${cur.uops} µop${cur.uops === 1 ? '' : 's'} from ${D686_DECS[cur.dec] || '?'} · retire at clock ${cur.M}` +
      (cur.floor ? ' · step of 1 clock' : ''), 52) : '');
    O.drawn = '';
  }
  gx(t) { const G = this.els.gGeo, O = this.oo; return G.gx0 + clamp((t - O.t0) / Math.max(1, O.t1 - O.t0), 0, 1) * G.gw; }
  renderGantt() {
    const E = this.els, O = this.oo, G = E.gGeo, cur = O.cur, P = dieP();
    const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
    const rows = cur && !cur.idle ? cur.rows : [];
    this.setT(E.gHead, cur && !cur.idle ? cut(`${this.mnem(cur.n)}: model clocks ${O.t0} to ${O.t1}  (0 = decode)`, 60) : 'no instruction yet');
    // the axis: about 5 ticks, relative to the decode clock
    const span = Math.max(1, O.t1 - O.t0), step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => span / s <= 5) || 1000;
    const base = cur && !cur.idle ? cur.dclk : O.t0;
    let t = Math.ceil((O.t0 - base) / step) * step + base, d = `M${G.gx0} ${G.gy0 + 9 * G.rh}H${G.gx0 + G.gw}`;
    E.gTicks.forEach(tx => {
      if (t <= O.t1 && cur && !cur.idle) {
        const x = this.gx(t);
        d += `M${x.toFixed(1)} ${G.gy0 + 9 * G.rh - 3}v6`;
        this.setT(tx, (t - base >= 0 ? '+' : '') + (t - base));
        this.setA(tx, 'x', x.toFixed(1)); this.setA(tx, 'y', String(G.gy0 + 9 * G.rh + 12));
      } else this.setT(tx, '');
      t += step;
    });
    this.setA(E.gAxis, 'd', d);
    const waitCol = w => (w === 1 ? dvMix(THEME.magenta, THEME.panel, 0.3) : w === 4 || w === 5 ? THEME.lavender : w === 6 ? THEME.gold : w === 2 || w === 3 ? dvMix(THEME.cyan, THEME.panel, 0.4) : dvMix(THEME.gold, THEME.panel, 0.5));
    E.gRows.forEach((R, i) => {
      const j = rows[i];
      if (j === undefined) {
        this.setT(R.l1, i === rows.length && cur && cur.more > 0 ? `… ${cur.more} more µops` : ''); this.setT(R.l2, ''); this.setT(R.n2, '');
        R.seg.forEach(s => this.setA(s, 'width', '0'));
        this.setA(R.tick, 'opacity', '0');
        return;
      }
      const mine = O.n[j] === cur.n, port = O.port[j];
      this.setT(R.l1, `${O.rob[j]} ${this.kname(j)}` + (port >= 0 ? ` P${port}` : '') + (mine ? '' : ' · older'));
      this.setA(R.l1, 'class', mine ? 'dv-v' : 'dv-m');
      let note = '', ncls = 'dv-f';
      if (!mine) { note = cut(this.stepText(O.n[j]) || 'an older instruction', 21); ncls = 'dv-m'; }
      else {
        const pk = cur.pass.get(j), w = O.wait[j];
        if (pk !== undefined) { const mn = this.mnem(O.n[pk]); note = mn ? `passes the ${mn}` : `passes an older ${this.kname(pk)}`; ncls = 'dv-mg'; }
        else if (w === 1) note = cut('waits for ' + (O.src[j] || 'an operand'), 21);
        else if (w === 4) note = 'waits for the divider';
        else if (w === 5) note = 'waits for the multiplier';
        else if (w === 6) note = `waits for port ${port}`;
        else if (w === 2) note = 'data from the store';
        else if (w === 3) note = 'waits for a store';
        else if (O.ret[j] - O.done[j] > 1) note = 'retires in order';
      }
      this.setT(R.l2, note);
      this.setA(R.l2, 'class', ncls);
      const xi = this.gx(O.iss[j]), xd = this.gx(O.dis[j]), xe = this.gx(O.done[j]), xr = this.gx(O.ret[j]);
      const y = G.gy0 + i * G.rh + 2, op = mine ? '1' : '0.6';
      const put = (s, a, b, col) => { this.setA(s, 'x', a.toFixed(1)); this.setA(s, 'width', Math.max(0, b - a).toFixed(1)); this.setA(s, 'y', String(y)); this.setA(s, 'fill', col); this.setA(s, 'opacity', op); };
      put(R.seg[0], xi, xd, waitCol(O.wait[j]));
      put(R.seg[1], xd, Math.max(xe, xd + 1.5), THEME.cyan);
      put(R.seg[2], xe, xr, dvMix(THEME.phosphor, THEME.panel, 0.55));
      this.setA(R.tick, 'x', (xr - 1.2).toFixed(1)); this.setA(R.tick, 'y', String(y - 2)); this.setA(R.tick, 'opacity', op);
      this.setA(R.tick, 'fill', THEME.goldHi);
      this.setT(R.n2, `${O.done[j] - O.dis[j]} clk`);
      this.setA(R.n2, 'x', (xd + 1).toFixed(1)); this.setA(R.n2, 'y', String(y + 18));
    });
  }
  // The chart cursor, the ROB ring, the RS, the RAT and the ports at the model clock vt.
  renderOoo(vt) {
    const E = this.els, O = this.oo, c = this.m.cpu;
    if (!E.robSec || !O || !c.rob) return;
    const cur = O.cur, live = cur && !cur.idle;
    // the cursor of the chart moves each frame
    const cx = this.gx(vt);
    this.setA(E.gCur, 'x1', cx.toFixed(1)); this.setA(E.gCur, 'x2', cx.toFixed(1)); this.setA(E.gCur, 'opacity', live ? '0.9' : '0');
    this.setA(E.gCurT, 'x', cx.toFixed(1));
    this.setT(E.gCurT, live ? (vt - cur.dclk >= 0 ? '+' : '') + Math.floor(vt - cur.dclk) : '');
    const tc = Math.floor(vt), key = tc + '|' + O.ver;
    if (key === O.drawn) return;
    O.drawn = key;
    const RC = O.robCur, RR = O.robRet, SC = O.rsCur, RJ = O.ratJ, kinds = c.rob.kinds, S = this.robStyles(), P = dieP();
    RC.fill(-1); RR.fill(-1); SC.fill(-1); RJ.fill(-1);
    let oldest = -1, newest = -1, inflight = 0, retN = 0;
    for (let j = 0; j < 512; j++) {
      const id = O.id[j];
      if (id < 0 || O.iss[j] > tc) continue;
      if (newest < 0 || id > O.id[newest]) newest = j;
      const d = O.dst[j];
      if (d >= 0 && d < 10 && (RJ[d] < 0 || id > O.id[RJ[d]])) RJ[d] = j;
      if (tc > O.ret[j]) continue;
      const e = O.rob[j];
      if (tc === O.ret[j]) { retN++; if (RR[e] < 0 || id > O.id[RR[e]]) RR[e] = j; continue; }
      if (RC[e] < 0 || id > O.id[RC[e]]) RC[e] = j;
      inflight++;
      if (oldest < 0 || id < O.id[oldest]) oldest = j;
      const s = O.rs[j];
      if (s >= 0 && tc <= O.dis[j] && (SC[s] < 0 || id > O.id[SC[s]])) SC[s] = j;
    }
    // the µops of the wrong path after a wrong prediction (the model makes none; the view shows them)
    const bt = live ? cur.btb : null, bj = live ? cur.branch : -1;
    let ghost = 0, flush = false;
    if (bt && !bt.right && bj >= 0 && tc >= O.iss[bj] && tc <= O.done[bj] + 1) {
      ghost = clamp((tc - O.iss[bj] + 1) * 3, 1, 12);
      flush = tc >= O.done[bj];
    }
    const alloc = newest >= 0 ? (O.rob[newest] + 1) % 40 : 0;
    const me = live ? cur.n : -2;
    let gh = ghost;
    for (let q = 0; q < 40; q++) {
      const k = (alloc + q) % 40, x = E.robSec[k];
      let j = RC[k], st = 0;
      if (j >= 0) st = tc >= O.done[j] ? 4 : tc >= O.dis[j] ? 3 : (Math.max(O.r1[j], O.r2[j]) <= tc && tc > O.iss[j]) ? 2 : 1;
      else if (RR[k] >= 0) { j = RR[k]; st = 5; }
      else if (gh > 0) { gh--; st = 6; }
      const [f, s] = S[st], mine = j >= 0 && O.n[j] === me;
      this.setA(x.s, 'fill', st === 6 && flush ? dvA(THEME.magenta, 0.55) : f);
      this.setA(x.s, 'stroke', mine ? THEME.text : s);
      this.setA(x.s, 'stroke-width', mine ? '2.2' : st === 6 ? '1.2' : '0.8');
      this.setA(x.s, 'stroke-dasharray', st === 6 ? '3 2' : 'none');
      this.setT(x.t, j >= 0 ? this.kname(j) : st === 6 ? '×' : '');
      this.setA(x.t, 'class', st === 2 || st === 3 || st === 5 ? 'dv-rb' : st === 6 ? 'dv-mg' : mine ? 'dv-v' : 'dv-m');
    }
    // the two pointers
    const G = E.robGeo;
    const ptr = (p, k, on, r2, dy) => {
      const a = (-90 + k * 9) * Math.PI / 180, x = G.cx + (G.rI - 2) * Math.cos(a), y = G.cy + (G.rI - 2) * Math.sin(a);
      const xo = G.cx + (G.rO + 12) * Math.cos(a), yo = G.cy + (G.rO + 12) * Math.sin(a);
      this.setA(p.l, 'x1', x.toFixed(1)); this.setA(p.l, 'y1', y.toFixed(1));
      this.setA(p.l, 'x2', xo.toFixed(1)); this.setA(p.l, 'y2', yo.toFixed(1)); this.setA(p.l, 'opacity', on ? '0.95' : '0');
      this.setA(p.t, 'x', (G.cx + r2 * Math.cos(a)).toFixed(1)); this.setA(p.t, 'y', (G.cy + r2 * Math.sin(a) + 2 + dy).toFixed(1)); this.setA(p.t, 'opacity', on ? '1' : '0');
    };
    const rk = oldest >= 0 ? O.rob[oldest] : alloc, near = ((alloc - rk + 40) % 40) < 3;
    ptr(E.ptrAl, alloc, newest >= 0, G.rO + 20, near ? -6 : 0);
    ptr(E.ptrRet, rk, newest >= 0, G.rO + 20, near ? 8 : 0);
    this.setT(E.robClk, live || newest >= 0 ? String(tc) : '—');
    this.setT(E.robUse, `in flight ${inflight}/40`);
    this.setT(E.robRetN, retN ? `retire ${retN} µop${retN === 1 ? '' : 's'}` : '');
    this.setT(E.robMsg, flush ? 'WRONG PATH: FLUSH' : ghost ? 'µops of the wrong path' : '');
    // the reservation station
    let nWait = 0, nReady = 0, nGo = 0;
    E.rsRow.forEach((R, s) => {
      const j = SC[s];
      if (j < 0) {
        this.setT(R.t, ''); this.setT(R.st, ''); this.setA(R.d1, 'opacity', '0'); this.setA(R.d2, 'opacity', '0');
        this.setA(R.bg, 'stroke', 'none');
        return;
      }
      const go = tc === O.dis[j], ready = Math.max(O.r1[j], O.r2[j]) <= tc && tc > O.iss[j];
      const mine = O.n[j] === me;
      this.setT(R.t, `${O.rob[j]} ${this.kname(j)}`);
      this.setA(R.t, 'class', mine ? 'dv-v' : 'dv-m');
      const dot = (d, src, r) => { this.setA(d, 'opacity', src >= 0 ? '1' : '0'); this.setA(d, 'fill', r <= tc ? THEME.phosphor : dvMix(THEME.magenta, THEME.panel, 0.3)); };
      dot(R.d1, O.s1[j], O.r1[j]); dot(R.d2, O.s2[j], O.r2[j]);
      const port = O.port[j], w = O.wait[j];
      let st, cls;
      if (go) { st = `dispatch → P${port}`; cls = 'dv-cy'; nGo++; }
      else if (ready) { st = w === 4 ? 'ready · divider busy' : w === 5 ? 'ready · unit busy' : `ready · P${port} busy`; cls = 'dv-go'; nReady++; }
      else { st = 'waits ' + (O.src[j] ? O.src[j].split(' ')[0] : 'operand'); cls = 'dv-mg'; nWait++; }
      this.setT(R.st, st.length > 22 ? st.slice(0, 21) + '…' : st);
      this.setA(R.st, 'class', cls);
      this.setA(R.bg, 'stroke', go ? THEME.cyan : mine ? dvMix(THEME.text, THEME.panel, 0.4) : 'none');
    });
    this.setT(E.rsSum, `waits ${nWait} · ready ${nReady} · dispatch now ${nGo}`);
    // the RAT: the newest producer of each register at this clock
    const prev = this.ratPrev || (this.ratPrev = new Float64Array(10).fill(-2));
    E.rat.forEach((R, r) => {
      const j = RJ[r], inRob = j >= 0 && tc < O.ret[j];
      this.setT(R.m, inRob ? 'ROB ' + O.rob[j] : 'RRF');
      this.setA(R.m, 'class', inRob ? (O.n[j] === me ? 'dv-go' : 'dv-v') : 'dv-f');
      this.setT(R.s, inRob ? (tc >= O.done[j] ? 'value ready' : 'not ready') : '');
      this.setA(R.s, 'class', inRob && tc >= O.done[j] ? 'dv-ph' : 'dv-mg');
      this.setA(R.bg, 'stroke', inRob && O.n[j] === me ? THEME.gold : P.cellStroke);
      const id = j >= 0 ? O.id[j] : -1;
      if (prev[r] !== -2 && prev[r] !== id && inRob && O.n[j] === me) this.flash('rat:' + r, this.anim(this.vclock), 3, 700);
      prev[r] = id;
    });
    // the ports: the µop that each port takes in this clock, and the long µops in its units
    E.port.forEach((X, p) => {
      let now = -1, busy = -1;
      for (let j = 0; j < 512; j++) {
        if (O.id[j] < 0 || O.port[j] !== p || O.iss[j] > tc) continue;
        if (O.dis[j] === tc && (now < 0 || O.id[j] > O.id[now])) now = j;
        if (O.dis[j] <= tc && tc < O.done[j] && (busy < 0 || O.done[j] - O.dis[j] > O.done[busy] - O.dis[busy])) busy = j;
      }
      this.setA(X.lamp, 'fill', now >= 0 ? THEME.cyan : P.dot);
      this.setT(X.now, now >= 0 ? `${this.kname(now)} ${O.rob[now]}` : '');
      this.setA(X.now, 'class', now >= 0 && O.n[now] === me ? 'dv-cy' : 'dv-v');
      const tx = now >= 0 ? this.stepText(O.n[now]) : '';
      this.setT(X.tx, tx.length > (X.w > 120 ? 26 : 15) ? tx.slice(0, X.w > 120 ? 25 : 14) + '…' : tx);
      const long = busy >= 0 && O.done[busy] - O.dis[busy] > 1;
      this.setT(X.busy, long ? `${this.kname(busy)} ${tc - O.dis[busy] + 1}/${O.done[busy] - O.dis[busy]} clk` : '');
      this.setA(X.bar, 'width', long ? ((X.w - 12) * clamp((tc - O.dis[busy] + 1) / (O.done[busy] - O.dis[busy]), 0, 1)).toFixed(1) : '0');
      this.setT(X.cnt, `µops ${Math.round(c.ports.uops[p]).toLocaleString('en-US')}`);
      X.units.forEach(U => {
        const act = j => j >= 0 && U.re.test(kinds[O.kind[j]]) && O.dis[j] <= tc && tc < Math.max(O.done[j], O.dis[j] + 1);
        const on = act(busy) ? busy : act(now) ? now : -1;
        this.setA(U.bg, 'fill', on >= 0 ? dvMix(THEME.cyan, THEME.panel, 0.7) : P.row0);
        this.setA(U.bg, 'stroke', on >= 0 ? THEME.cyan : P.cellStroke);
        this.setT(U.s, on >= 0 ? 'ROB ' + O.rob[on] : '');
        const lg = on >= 0 && O.done[on] - O.dis[on] > 1;
        this.setA(U.bar, 'width', lg ? ((X.w - 10) * clamp((tc - O.dis[on] + 1) / (O.done[on] - O.dis[on]), 0, 1)).toFixed(1) : '0');
      });
    });
    // the chart rows: a frame on the row of a µop that dispatches or retires in this clock
    if (live) E.gRows.forEach((R, i) => {
      const j = cur.rows[i];
      const on = j !== undefined && (O.dis[j] === tc || O.ret[j] === tc);
      this.setA(R.bg, 'stroke', on ? (O.ret[j] === tc ? THEME.goldHi : THEME.cyan) : 'none');
    });
    // the store buffer at this clock
    const SB = c.sb;
    E.sbRow.forEach((R, i) => {
      const cm = SB.commit[i];
      if (cm < 0 || !SB.bytes[i] || tc >= cm + 3) { this.setT(R.t, ''); this.setT(R.s, ''); return; }
      this.setT(R.t, `${i} ${dvHex8(SB.addr[i])} ${SB.bytes[i]} B`);
      const st = tc >= cm ? 'in the cache' : tc >= SB.std[i] ? 'data · waits' : 'no data yet';
      this.setT(R.s, st);
      this.setA(R.s, 'class', tc >= cm ? 'dv-f' : tc >= SB.std[i] ? 'dv-go' : 'dv-mg');
      this.setA(R.t, 'class', tc >= cm ? 'dv-f' : 'dv-v');
    });
  }
}
