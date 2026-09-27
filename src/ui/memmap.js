// Memory view: the 1 MB address space of the machine, its bus traffic and a live
// hex window. The map bar uses one linear scale per region (small regions such as the
// IVT get more room than their size); heat comes from machine.heat (256-byte pages).

const MV_REGIONS = [
  { a0: 0x00000, a1: 0x00400, name: 'IVT', short: 'IVT', w: 5, kind: 'ivt' },
  { a0: 0x00400, a1: 0x00500, name: 'BIOS data', short: 'BDA', w: 3, kind: 'bda' },
  { a0: 0x00500, a1: 0x10000, name: 'RAM', short: 'RAM', w: 6, kind: 'ram' },
  { a0: 0x10000, a1: 0x20000, name: 'Program', short: 'PROG', w: 17, kind: 'prog' },
  { a0: 0x20000, a1: 0xA0000, name: 'RAM', short: 'RAM', w: 10, kind: 'ram' },
  { a0: 0xA0000, a1: 0xB8000, name: 'unmapped', short: '', w: 3.5, kind: 'none' },
  { a0: 0xB8000, a1: 0xBC000, name: 'CGA text', short: 'CGA', w: 8, kind: 'cga' },
  { a0: 0xBC000, a1: 0xF0000, name: 'unmapped', short: '', w: 3.5, kind: 'none' },
  { a0: 0xF0000, a1: 0x100000, name: 'ROM BIOS', short: 'ROM', w: 12, kind: 'rom' },
];
// 80286 (AT) map: 16 MB, 24-bit addresses. The HMA (100000-10FFEF) is reachable from
// real mode only when the A20 gate is on.
const MV_REGIONS_286 = [
  { a0: 0x000000, a1: 0x000400, name: 'IVT', short: 'IVT', w: 4, kind: 'ivt' },
  { a0: 0x000400, a1: 0x000500, name: 'BIOS data', short: 'BDA', w: 2.5, kind: 'bda' },
  { a0: 0x000500, a1: 0x010000, name: 'RAM', short: 'RAM', w: 4.5, kind: 'ram' },
  { a0: 0x010000, a1: 0x020000, name: 'Program', short: 'PROG', w: 12, kind: 'prog' },
  { a0: 0x020000, a1: 0x0A0000, name: 'RAM', short: 'RAM', w: 7, kind: 'ram' },
  { a0: 0x0A0000, a1: 0x0B8000, name: 'unmapped', short: '', w: 2.5, kind: 'none' },
  { a0: 0x0B8000, a1: 0x0BC000, name: 'CGA text', short: 'CGA', w: 6, kind: 'cga' },
  { a0: 0x0BC000, a1: 0x0F0000, name: 'unmapped', short: '', w: 2.5, kind: 'none' },
  { a0: 0x0F0000, a1: 0x100000, name: 'ROM BIOS', short: 'ROM', w: 8, kind: 'rom' },
  { a0: 0x100000, a1: 0x10FFF0, name: 'HMA', short: 'HMA', w: 8, kind: 'hma' },
  { a0: 0x10FFF0, a1: 0x200000, name: 'Extended RAM', short: 'XRAM', w: 7, kind: 'xram' },
  { a0: 0x200000, a1: 0xFF0000, name: 'unmapped (14 MB)', short: '', w: 4, kind: 'none' },
  { a0: 0xFF0000, a1: 0x1000000, name: 'ROM mirror', short: 'ROM', w: 5, kind: 'rom' },
];
// 80386 (AT board with 16 MB): the extended RAM goes to the top of the 16 MB. With paging on,
// linear addresses go through the page tables; the Pages list shows the pages in use.
const MV_REGIONS_386 = [
  { a0: 0x000000, a1: 0x000400, name: 'IVT', short: 'IVT', w: 4, kind: 'ivt' },
  { a0: 0x000400, a1: 0x000500, name: 'BIOS data', short: 'BDA', w: 2.5, kind: 'bda' },
  { a0: 0x000500, a1: 0x010000, name: 'RAM', short: 'RAM', w: 4.5, kind: 'ram' },
  { a0: 0x010000, a1: 0x020000, name: 'Program', short: 'PROG', w: 12, kind: 'prog' },
  { a0: 0x020000, a1: 0x0A0000, name: 'RAM', short: 'RAM', w: 7, kind: 'ram' },
  { a0: 0x0A0000, a1: 0x0B8000, name: 'unmapped', short: '', w: 2.5, kind: 'none' },
  { a0: 0x0B8000, a1: 0x0BC000, name: 'CGA text', short: 'CGA', w: 6, kind: 'cga' },
  { a0: 0x0BC000, a1: 0x0F0000, name: 'unmapped', short: '', w: 2.5, kind: 'none' },
  { a0: 0x0F0000, a1: 0x100000, name: 'ROM BIOS', short: 'ROM', w: 8, kind: 'rom' },
  { a0: 0x100000, a1: 0x10FFF0, name: 'HMA', short: 'HMA', w: 8, kind: 'hma' },
  { a0: 0x10FFF0, a1: 0x1000000, name: 'Extended RAM', short: 'XRAM', w: 12, kind: 'xram' },
];
const MV_VECTORS = [
  [0x00, 'divide error'], [0x02, typeof CPU_MODEL !== 'undefined' && CPU_MODEL !== '8086' && CPU_MODEL !== '80286' ? 'NMI' : 'NMI · 8087'], [0x08, 'timer IRQ0'], [0x09, 'keyboard IRQ1'], [0x10, 'video'],
  [0x16, 'keyboard'], [0x1A, 'time of day'], [0x1C, 'user timer'], [0x20, 'end program'], [0x21, 'DOS subset'],
];
const MV_MODES = [
  { id: 'code', label: 'Code', sub: 'CS:IP' },
  { id: 'stack', label: 'Stack', sub: 'SS:SP' },
  { id: 'data', label: 'Data', sub: 'DS:SI' },
  { id: 'video', label: 'Video', sub: 'B800:0000' },
  { id: 'last', label: 'Last access', sub: '' },
  { id: 'gdt', label: 'GDT', sub: '', pm: true },
  { id: 'idt', label: 'IDT', sub: '', pm: true },
];
const MV_SREG = ['ES', 'CS', 'SS', 'DS', 'FS', 'GS'];
const MV_REFRESH_MS = 100;

class MemoryView {
  constructor(host, app) {
    this.host = host;
    this.app = app;
    this.shown = false;
    this.reduced = !!app.reducedMotion;
    // the 80386 uses the 80286 code paths (16 MB, the A20 gate, protected mode) and adds paging;
    // the 80486 uses the 80386 paths and adds the cache (the cached lines and the KEN# range)
    const r32 = !!(app.machine && app.machine.cpu && app.machine.cpu.regs32);
    // the Pentium uses the 80386 paths and adds its two caches (code and data, MESI) and the
    // 4 MB pages. It needs the Pentium core (cpu.dcache); a Pentium page with an 80486 core
    // uses the 80486 paths.
    // The Pentium Pro uses the Pentium paths and adds the L2 (a third mark on each hex row, a third
    // cache in the card) and the global pages. It needs the P6 core (cpu.l2); a Pentium Pro page with
    // a Pentium core uses the Pentium paths.
    const c0 = app.machine && app.machine.cpu;
    const p6 = app.model === '80686' && r32 && !!(c0.l2 && c0.dcache && c0.icache);
    const p5 = (app.model === '80586' || (app.model === '80686' && !p6)) && r32 && !!c0.dcache;
    this.m686 = p6;
    this.m586 = p5 || p6;
    const hi = app.model === '80586' || app.model === '80686';
    this.m486 = (app.model === '80486' || (hi && !this.m586)) && r32;
    this.m386 = (app.model === '80386' || app.model === '80486' || hi) && r32;
    this.m286 = app.model === '80286' || app.model === '80386' || app.model === '80486' || hi;
    this.regions = this.m386 ? MV_REGIONS_386 : this.m286 ? MV_REGIONS_286 : MV_REGIONS;
    this.dtTab = 'seg';
    this.dtHot = new Map();
    this.exc = null;
    this.mode = storage.get('memMode', 'code');
    if (!MV_MODES.some(m => m.id === this.mode)) this.mode = 'code';
    this.pinAddr = null;
    this.base = -1;
    this.cache = new Int16Array(256).fill(-1);
    this.pending = new Map();
    this.cur = null;
    this.last = null;
    const np = app.machine && app.machine.heat ? app.machine.heat.read.length : 4096;
    this.heatR = new Float32Array(np);
    this.heatW = new Float32Array(np);
    this.prevR = new Float32Array(np);
    this.prevW = new Float32Array(np);
    this.lastRefresh = 0;
    this.hoverS = null;
    this.occ = null;
    this.occT = 0;
    this.ivtHot = new Map();
    this.clKeys = null;          // Pentium: the last state of the cache marks of the 16 hex rows
    MemoryView.injectStyle();
    if (this.m586) MemoryView.injectStyle586();
    if (app.model === '80686') MemoryView.injectStyle686();
    this.lastL2 = null;          // Pentium Pro: the last 'cache' event of the L2
    this.ncRanges = null;        // Pentium Pro: the physical ranges with no KEN# (not cacheable)
    this.ncT = 0;
    this.build();
  }

  // ---------- DOM ----------
  static injectStyle() {
    if (document.getElementById('mv-style')) return;
    const s = document.createElement('style');
    s.id = 'mv-style';
    s.textContent = `
.mv-root { position: absolute; inset: 0; overflow: hidden; }
.mv-root.mv-tall { overflow-y: auto; padding: 10px 12px 64px; display: flex; flex-direction: column; gap: 12px; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.mv-box { position: absolute; min-width: 0; min-height: 0; }
.mv-tall .mv-box { position: static; flex: none; }
.mv-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.mv-kicker { margin: 0; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); font-weight: 600; white-space: nowrap; }
.mv-kicker b { color: var(--gold-hi); font-weight: 600; }
.mv-seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: 999px; background: var(--panel); border: 1px solid var(--line-soft); }
.mv-seg button { border: 0; background: none; color: var(--muted); padding: 3px 10px; border-radius: 999px; font: 600 11.5px var(--sans); white-space: nowrap;
  transition: color .15s, background .15s; }
.mv-seg button small { font: 10.5px var(--mono); color: var(--faint); margin-left: 5px; font-weight: 400; }
.mv-seg button:hover { color: var(--text); }
.mv-seg button[aria-pressed="true"] { background: linear-gradient(180deg, color-mix(in srgb, var(--ceramic) 75%, var(--panel2)), var(--panel2)); color: var(--gold-hi); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold) 45%, transparent); }
.mv-seg button[aria-pressed="true"] small { color: var(--gold); }
.mv-map canvas { display: block; width: 100%; height: 100%; cursor: pointer; border-radius: 8px; outline: none; }
.mv-map canvas:focus-visible { box-shadow: 0 0 0 2px var(--gold-hi); }
.mv-hexp { display: flex; flex-direction: column; gap: 8px; }
.mv-card { background: color-mix(in srgb, var(--panel) 70%, transparent); border: 1px solid var(--line-soft); border-radius: var(--r); padding: 8px 10px; }
.mv-calc { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; font: 12px var(--mono); color: var(--muted); }
.mv-calc .mv-what { font: 600 10px var(--sans); letter-spacing: .14em; text-transform: uppercase; color: var(--faint); }
.mv-calc .mv-sa { color: var(--text); font-size: 13px; }
.mv-sum { display: grid; grid-template-columns: auto auto; gap: 0 10px; line-height: 1.3; font-variant-numeric: tabular-nums; }
.mv-sum span:nth-child(odd) { color: var(--faint); text-align: right; font-size: 10.5px; align-self: center; }
.mv-sum b { font-weight: 600; text-align: right; letter-spacing: .12em; }
.mv-sum .mv-rule { border-top: 1px solid var(--line); }
.mv-c { color: var(--cyan); } .mv-g { color: var(--gold-hi); } .mv-p { color: var(--phosphor); } .mv-f { color: var(--faint); }
.mv-m { color: var(--magenta); } .mv-l { color: var(--lavender); }
.mv-hex { font: var(--mv-fs, 12px)/1.5 var(--mono); font-variant-numeric: tabular-nums; flex: 1; min-height: 0; overflow: hidden; user-select: text; }
.mv-calc1 { flex-wrap: nowrap; gap: 12px; white-space: nowrap; overflow: hidden; padding: 6px 10px; }
.mv-note { font-size: 11px; max-width: 30ch; }
.mv-compact .mv-seg button small { display: none; }
.mv-compact .mv-seg button { padding: 3px 8px; }
.mv-hrow { display: grid; grid-template-columns: 6.2ch repeat(8, 2.55ch) .8ch repeat(8, 2.55ch) 1.2ch auto; align-items: center; }
.mv-hhead { color: var(--faint); font-size: .86em; }
.mv-hhead span { text-align: center; }
.mv-a { color: var(--faint); }
.mv-a.mv-afoc { color: var(--cyan); }
.mv-b { text-align: center; border-radius: 3px; color: var(--text); }
.mv-b.z { color: color-mix(in srgb, var(--muted) 55%, var(--faint)); }
.mv-b.na { color: var(--line); }
.mv-b.foc { background: color-mix(in srgb, var(--cyan) 16%, transparent); color: var(--text); }
.mv-asc i.cur { color: var(--phosphor); background: color-mix(in srgb, var(--phosphor) 14%, transparent); }
.mv-b.cur { color: var(--phosphor); background: color-mix(in srgb, var(--phosphor) 8%, transparent); box-shadow: inset 0 1px 0 var(--phosphor), inset 0 -1px 0 var(--phosphor); border-radius: 0; }
.mv-b.cur.cs { box-shadow: inset 1px 0 0 var(--phosphor), inset 0 1px 0 var(--phosphor), inset 0 -1px 0 var(--phosphor); border-radius: 3px 0 0 3px; }
.mv-b.cur.ce { box-shadow: inset -1px 0 0 var(--phosphor), inset 0 1px 0 var(--phosphor), inset 0 -1px 0 var(--phosphor); border-radius: 0 3px 3px 0; }
.mv-b.cur.cs.ce { box-shadow: inset 0 0 0 1px var(--phosphor); border-radius: 3px; }
.mv-asc { display: flex; padding-left: .8ch; color: var(--muted); }
.mv-asc i { font-style: normal; width: 1ch; text-align: center; border-radius: 2px; }
.mv-asc i.z { color: var(--line); }
.mv-noasc .mv-asc { display: none; }
.mv-hex-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 0 4px; }
.mv-h4 { margin: 0; font: 600 10px var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
.mv-compact .mv-regname { display: none; }
.mv-legend { display: flex; gap: 8px; font: 10px var(--mono); color: var(--faint); flex-wrap: wrap; }
.mv-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.mv-ivt ol { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 2px; }
.mv-ivt li button { width: 100%; display: grid; grid-template-columns: 4.2ch minmax(0, 1fr) auto; gap: 8px; align-items: baseline;
  padding: 2px 6px; border: 0; border-radius: 5px; background: none; text-align: left; font: 11.5px/1.45 var(--mono); color: var(--muted); }
.mv-ivt li button:hover { background: color-mix(in srgb, var(--text) 4%, transparent); color: var(--text); }
.mv-ivt li b { color: var(--magenta); font-weight: 600; }
.mv-ivt li em { font-style: normal; font-family: var(--sans); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-ivt li span { color: var(--text); font-variant-numeric: tabular-nums; }
.mv-ivt li.mv-hot button { background: color-mix(in srgb, var(--phosphor) 12%, transparent); color: var(--text); }
.mv-ivt li.mv-hot span { color: var(--phosphor); }
.mv-ivt li.mv-rd button { background: color-mix(in srgb, var(--cyan) 12%, transparent); }
.mv-ivt-cols ol { grid-template-columns: 1fr 1fr; column-gap: 8px; }
.mv-ivt2 ol { grid-template-columns: 1fr 1fr; column-gap: 6px; gap: 1px 6px; }
.mv-ivt2 li button { grid-template-columns: 3ch minmax(0, 1fr); gap: 0 6px; font-size: 11px; line-height: 1.18; padding: 1px 5px; }
.mv-ivt2 li em { grid-column: 2; grid-row: 2; font-size: 10px; color: var(--faint); }
.mv-ivt2 { padding-top: 6px; padding-bottom: 4px; }
.mv-ivt2 ol { margin-top: 3px; }
.mv-ivt2 li span { grid-column: 2; grid-row: 1; }
.mv-ivt2 li b { grid-row: 1 / 3; align-self: center; }
.mv-a24 .mv-hrow { grid-template-columns: 7.2ch repeat(8, 2.55ch) .8ch repeat(8, 2.55ch) 1.2ch auto; }
.mv-pills { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.mv-pill { font: 600 10.5px var(--mono); padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.mv-pill.on { color: var(--phosphor); border-color: color-mix(in srgb, var(--phosphor) 50%, transparent); }
.mv-pill.off { color: var(--magenta); border-color: color-mix(in srgb, var(--magenta) 50%, transparent); }
.mv-pill.pm { color: var(--lavender); border-color: color-mix(in srgb, var(--lavender) 55%, transparent); }
.mv-seg button[hidden] { display: none; }
.mv-exc { display: none; margin: 4px 0 2px; padding: 3px 8px; border-radius: 6px; font: 600 11.5px var(--mono); color: var(--text);
  background: color-mix(in srgb, var(--magenta) 22%, transparent); border: 1px solid color-mix(in srgb, var(--magenta) 60%, transparent); }
.mv-exc.on { display: block; }
.mv-dt-tabs { display: flex; gap: 2px; margin: 6px 0 4px; }
.mv-dt-tabs button { border: 1px solid var(--line); background: none; color: var(--muted); border-radius: 999px; padding: 1px 9px; font: 600 10.5px var(--mono); }
.mv-dt-tabs button[aria-pressed="true"] { color: var(--gold-hi); border-color: color-mix(in srgb, var(--gold) 55%, transparent); }
.mv-dt ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
.mv-dt li button { width: 100%; display: grid; grid-template-columns: 8ch 6.8ch 5ch minmax(0, 1fr); gap: 6px; align-items: baseline; padding: 1px 6px;
  border: 0; border-radius: 5px; background: none; text-align: left; font: 11px/1.4 var(--mono); color: var(--muted); }
.mv-dt li button:hover { background: color-mix(in srgb, var(--text) 4%, transparent); color: var(--text); }
.mv-dt li b { color: var(--lavender); font-weight: 600; }
.mv-dt li span { color: var(--cyan); }
.mv-dt li i { font-style: normal; color: var(--text); }
.mv-dt li em { font-style: normal; font-family: var(--sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-dt li.np em { color: var(--faint); }
.mv-dt li.hot button { background: color-mix(in srgb, var(--phosphor) 14%, transparent); }
.mv-dt li.hot b { color: var(--phosphor); }
.mv-ivt .mv-dt ol { grid-template-columns: minmax(0, 1fr); margin: 0; }
.mv-ivt .mv-dt li button { grid-template-columns: 8ch 6.8ch 5ch minmax(0, 1fr); gap: 6px; font-size: 11px; line-height: 1.4; }
.mv-ivt .mv-dt li b, .mv-ivt .mv-dt li span, .mv-ivt .mv-dt li i, .mv-ivt .mv-dt li em { grid-column: auto; grid-row: auto; }
.mv-ivt .mv-dt li em { font-size: 10.5px; color: var(--muted); }
.mv-dt .mv-dt-note { font: 10.5px var(--mono); color: var(--faint); margin-top: 4px; }
.mv-386 .mv-dt li button { grid-template-columns: 7.2ch 8.6ch 8.6ch minmax(0, 1fr); gap: 5px; }
.mv-386 .mv-ivt .mv-dt li button { grid-template-columns: 7.2ch 8.6ch 8.6ch minmax(0, 1fr); gap: 5px; }
.mv-pg { margin-top: 8px; }
.mv-pg[hidden] { display: none; }
.mv-pg ol { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 1px; }
.mv-pg li button { width: 100%; display: grid; grid-template-columns: 5.4ch 1.6ch 5.4ch minmax(0, 1fr); gap: 5px; align-items: baseline; padding: 1px 6px;
  border: 0; border-radius: 5px; background: none; text-align: left; font: 11px/1.45 var(--mono); color: var(--muted); }
.mv-pg li button:hover { background: color-mix(in srgb, var(--text) 4%, transparent); color: var(--text); }
.mv-pg li b { color: var(--lavender); font-weight: 600; }
.mv-pg li i { font-style: normal; color: var(--faint); text-align: center; }
.mv-pg li span { color: var(--cyan); }
.mv-pg li em { font-style: normal; font-family: var(--sans); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-pg li.np span { color: var(--magenta); }
.mv-pg li.hot button { background: color-mix(in srgb, var(--phosphor) 14%, transparent); }
.mv-pg li.hot b { color: var(--phosphor); }
.mv-pg .mv-dt-note { font: 10.5px var(--mono); color: var(--faint); margin-top: 4px; }
.mv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mv-clm { align-self: stretch; display: flex; align-items: center; justify-content: center; }
.mv-clm.on::before, .mv-clm.nc::before { content: ''; width: 3px; height: 70%; border-radius: 2px; background: var(--phosphor); }
.mv-clm.nc::before { background: var(--magenta); opacity: .45; }
.mv-clm.last::before { box-shadow: 0 0 6px var(--phosphor); width: 4px; }
.mv-hrow.mv-cached .mv-b { background-image: linear-gradient(color-mix(in srgb, var(--phosphor) 6%, transparent), color-mix(in srgb, var(--phosphor) 6%, transparent)); }
.mv-cache { margin: 0 0 8px; }
.mv-cache .mv-cst { font: 10.5px/1.45 var(--mono); color: var(--muted); margin: 3px 0 4px; }
.mv-cache .mv-cst b { font-weight: 600; color: var(--phosphor); }
.mv-cache .mv-cst b.off { color: var(--magenta); }
.mv-cache canvas { display: block; width: 100%; height: 22px; border-radius: 3px; }
.mv-cache .mv-dt-note { font: 10px/1.4 var(--mono); color: var(--faint); margin-top: 4px; }
@media (max-width: 700px) { .mv-seg button small { display: none; } }
`;
    document.head.appendChild(s);
  }
  // Pentium: two marks at the right of each hex row (code line, data line with its MESI
  // state), the row tints and the card of the two caches. All rules are for :root.m586 only.
  static injectStyle586() {
    if (document.getElementById('mv-style-586')) return;
    const s = document.createElement('style');
    s.id = 'mv-style-586';
    s.textContent = `
:root.m586 .mv-a24 .mv-hrow { grid-template-columns: 7.2ch repeat(8, 2.55ch) .8ch repeat(8, 2.55ch) 2ch auto; }
:root.m586 .mv-clm { gap: 2px; justify-content: flex-end; }
:root.m586 .mv-legend { gap: 6px; }
:root.m586 .mv-pg li.big b, :root.m586 .mv-pg li.big span { color: var(--gold-hi); }
:root.m586 .mv-pg li.big em { color: var(--text); }
:root.m586 .mv-pg li.big.hot b { color: var(--phosphor); }
:root.m586 .mv-legend .mv-mes { display: inline-flex; gap: 5px; }
:root.m586 .mv-legend .mv-mes i { margin-right: 2px; }
:root.m586 .mv-clm i { display: block; width: 3px; height: 70%; border-radius: 2px; background: transparent; }
:root.m586 .mv-clm i.c { background: var(--lavender); }
:root.m586 .mv-clm i.M { background: var(--magenta); }
:root.m586 .mv-clm i.E { background: var(--phosphor); }
:root.m586 .mv-clm i.S { background: var(--cyan); }
:root.m586 .mv-clm i.nc { background: repeating-linear-gradient(180deg, var(--faint) 0 2px, transparent 2px 4px); }
:root.m586 .mv-clm.last i.c, :root.m586 .mv-clm.last i.M, :root.m586 .mv-clm.last i.E, :root.m586 .mv-clm.last i.S { box-shadow: 0 0 6px currentColor; width: 4px; }
:root.m586 .mv-clm.last i.c { color: var(--lavender); } :root.m586 .mv-clm.last i.M { color: var(--magenta); }
:root.m586 .mv-clm.last i.E { color: var(--phosphor); } :root.m586 .mv-clm.last i.S { color: var(--cyan); }
:root.m586 .mv-hrow.mv-lM .mv-b { background-image: linear-gradient(color-mix(in srgb, var(--magenta) 8%, transparent), color-mix(in srgb, var(--magenta) 8%, transparent)); }
:root.m586 .mv-hrow.mv-lE .mv-b { background-image: linear-gradient(color-mix(in srgb, var(--phosphor) 6%, transparent), color-mix(in srgb, var(--phosphor) 6%, transparent)); }
:root.m586 .mv-hrow.mv-lS .mv-b { background-image: linear-gradient(color-mix(in srgb, var(--cyan) 7%, transparent), color-mix(in srgb, var(--cyan) 7%, transparent)); }
:root.m586 .mv-hrow.mv-lC .mv-b { background-image: linear-gradient(color-mix(in srgb, var(--lavender) 6%, transparent), color-mix(in srgb, var(--lavender) 6%, transparent)); }
:root.m586 .mv-c5 { margin: 0 0 8px; }
:root.m586 .mv-c5 .mv-cst { font: 10.5px/1.45 var(--mono); color: var(--muted); margin: 3px 0 4px; }
:root.m586 .mv-c5 .mv-cst b { font-weight: 600; color: var(--phosphor); }
:root.m586 .mv-c5 .mv-cst b.off { color: var(--magenta); }
:root.m586 .mv-c5t { width: 100%; border-collapse: collapse; font: 10.5px/1.4 var(--mono); font-variant-numeric: tabular-nums; color: var(--text); }
:root.m586 .mv-c5t th { font: 600 9.5px var(--sans); color: var(--faint); text-align: right; padding: 0 0 0 6px; letter-spacing: .04em; }
:root.m586 .mv-c5t th:first-child, :root.m586 .mv-c5t td:first-child { text-align: left; padding-left: 0; }
:root.m586 .mv-c5t td { text-align: right; padding: 0 0 0 6px; white-space: nowrap; }
:root.m586 .mv-c5t td:first-child { color: var(--muted); }
:root.m586 .mv-mesi { display: flex; flex-wrap: wrap; gap: 3px 8px; font: 10.5px/1.5 var(--mono); color: var(--muted); margin: 3px 0 2px; }
:root.m586 .mv-mesi b { font-weight: 700; margin-right: 3px; }
:root.m586 .mv-mesi span { white-space: nowrap; }
:root.m586 .mv-c5 canvas { display: block; width: 100%; height: 30px; border-radius: 3px; margin-top: 3px; }
:root.m586 .mv-c5 .mv-dt-note { font: 10px/1.4 var(--mono); color: var(--faint); margin-top: 4px; }
`;
    document.head.appendChild(s);
  }

  // Pentium Pro: the Pentium rules for :root.m686, then three marks on each hex row (the L1 code
  // line, the L1 data line, the L2 line) and the card of the three caches.
  static injectStyle686() {
    if (document.getElementById('mv-style-686')) return;
    MemoryView.injectStyle586();
    const s = document.createElement('style');
    s.id = 'mv-style-686';
    s.textContent = document.getElementById('mv-style-586').textContent.replace(/:root\.m586/g, ':root.m686') + `
:root.m686 .mv-a24 .mv-hrow { grid-template-columns: 7.2ch repeat(8, 2.55ch) .8ch repeat(8, 2.55ch) 2.7ch auto; }
:root.m686 .mv-clm i.l2.M { background: repeating-linear-gradient(180deg, var(--magenta) 0 3px, transparent 3px 4.5px); }
:root.m686 .mv-clm i.l2.E { background: repeating-linear-gradient(180deg, var(--phosphor) 0 3px, transparent 3px 4.5px); }
:root.m686 .mv-clm i.l2.S { background: repeating-linear-gradient(180deg, var(--cyan) 0 3px, transparent 3px 4.5px); }
:root.m686 .mv-hrow.mv-lL .mv-b { background-image: linear-gradient(color-mix(in srgb, var(--gold) 5%, transparent), color-mix(in srgb, var(--gold) 5%, transparent)); }
:root.m686 .mv-legend .mv-l2i { display: inline-block; width: 3px; height: 9px; margin-right: 3px; vertical-align: -1px; border-radius: 1px;
  background: repeating-linear-gradient(180deg, var(--phosphor) 0 3px, transparent 3px 4.5px); }
:root.m686 .mv-c5 canvas { height: 44px; }
:root.m686 .mv-mesi { gap: 3px 14px; }
:root.m686 .mv-mesi1 { display: inline-flex; gap: 6px; white-space: nowrap; }
:root.m686 .mv-mesi .mv-ml { color: var(--faint); font-weight: 600; margin-right: 2px; }
:root.m686 .mv-pg li.glob b { text-decoration: underline; text-decoration-color: var(--lavender); text-underline-offset: 2px; }
`;
    document.head.appendChild(s);
  }

  build() {
    const root = this.root = htmlEl('div', { class: 'mv-root' }, this.host);
    // header + focus toggle
    const head = this.headEl = htmlEl('div', { class: 'mv-box mv-head' }, root);
    const k = htmlEl('h3', { class: 'mv-kicker' }, head);
    k.innerHTML = this.m386 ? 'Memory <b>· 16 MB physical</b>' : this.m286 ? 'Memory <b>· 16 MB address space</b>' : 'Memory <b>· 1 MB address space</b>';
    if (this.m286) {
      this.root.classList.add('mv-a24');
      const pills = htmlEl('span', { class: 'mv-pills' }, head);
      this.a20El = htmlEl('span', { class: 'mv-pill', title: 'The A20 gate (8042 output port / port 92h). Off: address bit 20 is forced to 0, so addresses wrap at 1 MB like an 8086.' }, pills, 'A20');
      this.pmEl = htmlEl('span', { class: 'mv-pill' }, pills, 'real mode');
      if (this.m386) {
        this.root.classList.add('mv-386');
        this.pgPill = htmlEl('span', { class: 'mv-pill', title: this.m686
          ? 'CR0.PG: paging translates each linear address through the page directory and a page table (4 KB pages). With CR4.PSE = 1, a directory entry with PS = 1 maps one 4 MB page. With CR4.PGE = 1, a page with G = 1 is global: its TLB entry stays when CR3 changes.'
          : this.m586
          ? 'CR0.PG: paging translates each linear address through the page directory and a page table (4 KB pages). With CR4.PSE = 1, a directory entry with PS = 1 maps one 4 MB page (no page table).'
          : 'CR0.PG: paging translates each linear address through the page directory and a page table (4 KB pages).' }, pills, 'paging off');
      }
    }
    const seg = htmlEl('div', { class: 'mv-seg', role: 'group', 'aria-label': 'The hex window follows' }, head);
    this.modeBtns = {};
    for (const m of MV_MODES) {
      if (m.pm && !this.m286) continue;
      const b = htmlEl('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': `Follow ${m.label}${m.sub ? ' ' + m.sub : ''}` }, seg);
      const sub = this.m386 && /^[CSD]S:/.test(m.sub) ? m.sub.replace(':', ':E') : m.sub;
      b.innerHTML = `${m.label}${sub ? `<small>${sub}</small>` : ''}`;
      b.addEventListener('click', () => this.setMode(m.id));
      if (m.pm) b.hidden = true;
      this.modeBtns[m.id] = b;
    }
    // map
    const map = this.mapEl = htmlEl('div', { class: 'mv-box mv-map' }, root);
    const cv = this.canvas = htmlEl('canvas', {
      tabindex: '0', role: 'slider', 'aria-label': 'Memory map. Click a region, or use the arrow keys, to show it in the hex window.',
      'aria-valuemin': '0', 'aria-valuemax': String(this.memTop() - 1), 'aria-valuenow': '0',
    }, map);
    this.ctx = cv.getContext('2d');
    // hex panel
    const hexp = this.hexEl = htmlEl('div', { class: 'mv-box mv-hexp' }, root);
    const calc = this.calcEl = htmlEl('div', { class: 'mv-card mv-calc', 'aria-live': 'off' }, hexp);
    calc.textContent = '';
    const hc = htmlEl('div', { class: 'mv-card', style: 'flex:1;min-height:0;display:flex;flex-direction:column' }, hexp);
    const top = htmlEl('div', { class: 'mv-hex-top' }, hc);
    this.hexTitle = htmlEl('h4', { class: 'mv-h4' }, top, '256 bytes');
    const lg = htmlEl('div', { class: 'mv-legend', 'aria-hidden': 'true' }, top);
    lg.innerHTML = `<span><i style="background:${THEME.cyan}"></i>read</span><span><i style="background:${THEME.goldHi}"></i>write</span>` +
      `<span><i style="background:${THEME.gold};opacity:.55"></i>fetch</span><span><i style="box-shadow:inset 0 0 0 1px ${THEME.phosphor}"></i>instr.</span>` +
      (this.m486 ? `<span title="A 16-byte line in the 8 KB cache (the bar at the right of the row)"><i style="background:${THEME.phosphor};width:3px"></i>cached</span>` : '') +
      (this.m586 ? `<span title="A 32-byte line in the ${this.m686 ? 'L1 ' : ''}code cache (the left bar at the right of the row)"><i style="background:${THEME.lavender};width:3px"></i>code</span>` +
        [['M', THEME.magenta, 'modified: the line has changes that memory does not have (a write-back copies them)'], ['E', THEME.phosphor, 'exclusive: the line is the same as memory'],
          ['S', THEME.cyan, 'shared: the line is the same as memory, and a write goes through to the bus']].map(([k, col, t]) =>
          `<span title="A 32-byte line in the ${this.m686 ? 'L1 data cache (the middle bar)' : 'data cache (the right bar)'}, state ${k}: ${t}"><i style="background:${col};width:3px"></i>${k}</span>`).join('').replace(/^/, '<span class="mv-mes">') + '</span>' : '') +
      (this.m686 ? '<span title="A 32-byte line in the 256 KB L2 cache (the right bar, striped). Its colour is the MESI state of the L2 line."><i class="mv-l2i"></i>L2</span>' : '');
    const hex = this.hexGrid = htmlEl('div', { class: 'mv-hex', role: 'table', 'aria-label': 'Hex window: 16 rows of 16 bytes' }, hc);
    const hh = htmlEl('div', { class: 'mv-hrow mv-hhead', role: 'row', 'aria-hidden': 'true' }, hex);
    htmlEl('span', null, hh, '');
    for (let i = 0; i < 16; i++) { if (i === 8) htmlEl('span', null, hh); htmlEl('span', null, hh, i.toString(16).toUpperCase()); }
    htmlEl('span', null, hh, '');
    htmlEl('span', { class: 'mv-asc' }, hh, 'ASCII');
    this.cells = [];
    this.ascs = [];
    this.addrEls = [];
    this.clEls = [];
    this.rowEls = [];
    for (let r = 0; r < 16; r++) {
      const row = htmlEl('div', { class: 'mv-hrow', role: 'row' }, hex);
      this.rowEls.push(row);
      this.addrEls.push(htmlEl('span', { class: 'mv-a', role: 'rowheader' }, row, ''));
      for (let c = 0; c < 16; c++) {
        if (c === 8) htmlEl('span', { 'aria-hidden': 'true' }, row);
        this.cells.push(htmlEl('span', { class: 'mv-b', role: 'cell' }, row, '··'));
      }
      this.clEls.push(htmlEl('span', { class: 'mv-clm' }, row));
      const asc = htmlEl('span', { class: 'mv-asc', 'aria-hidden': 'true' }, row);
      for (let c = 0; c < 16; c++) this.ascs.push(htmlEl('i', null, asc, '.'));
    }
    // IVT inspector
    const ivt = this.ivtEl = htmlEl('div', { class: 'mv-box mv-card mv-ivt' }, root);
    this.excEl = htmlEl('div', { class: 'mv-exc', role: 'status' }, ivt);
    if (this.m486) {
      // The cache on the chip: its state, the 512 lines (128 sets across, 4 ways down) and KEN#.
      const cc = htmlEl('div', { class: 'mv-cache' }, ivt);
      htmlEl('h4', { class: 'mv-h4' }, cc, 'Cache · 8 KB on the 80486');
      this.cstEl = htmlEl('div', { class: 'mv-cst' }, cc, 'cache off');
      this.cacheCv = htmlEl('canvas', { role: 'img', 'aria-label': 'The 512 cache lines: 128 sets across, 4 ways down. Green: a line in the hex window.' }, cc);
      this.cacheCtx = this.cacheCv.getContext('2d');
      htmlEl('div', { class: 'mv-dt-note', title: 'A green bar at the right of a hex row: that 16-byte line is in the cache.' }, cc, 'A0000h–FFFFFh: KEN# high, not cached.');
      this.lastCache = null;
    }
    if (this.m686) this.buildCache686(ivt);
    else if (this.m586) {
      // The two caches of the Pentium: the state, the counters, the MESI counts of the data
      // lines and a map of the lines (128 sets across; code 2 ways, data 2 ways).
      const cc = htmlEl('div', { class: 'mv-c5' }, ivt);
      htmlEl('h4', { class: 'mv-h4' }, cc, 'Caches · 8 KB code + 8 KB data');
      this.cstEl = htmlEl('div', { class: 'mv-cst' }, cc, 'cache off');
      const tb = htmlEl('table', { class: 'mv-c5t', 'aria-label': 'The counters of the code cache and of the data cache' }, cc);
      tb.innerHTML = '<thead><tr><th scope="col"></th><th scope="col" title="Reads that the cache gave with no bus cycle">hits</th>' +
        '<th scope="col" title="Reads that were not in the cache">miss</th><th scope="col" title="Lines that came from memory in a burst of 4 × 8 bytes">fills</th>' +
        '<th scope="col" title="M lines that went back to memory in a burst of 4 × 8 bytes">wb</th></tr></thead>';
      const body = htmlEl('tbody', null, tb);
      this.c5Rows = ['code', 'data'].map(n => {
        const tr = htmlEl('tr', null, body);
        htmlEl('td', { title: n === 'code' ? 'The code cache: the prefetcher reads it' : 'The data cache: write-back, with the MESI states' }, tr, n);
        return [0, 1, 2, 3].map(() => htmlEl('td', null, tr, '—'));
      });
      const ms = htmlEl('div', { class: 'mv-mesi', 'aria-label': 'MESI states of the 256 data lines' }, cc);
      this.mesiEls = [['M', THEME.magenta, 'modified: the line has changes that memory does not have (a write-back copies them)'],
        ['E', THEME.phosphor, 'exclusive: the line is the same as memory, and only this cache has it'],
        ['S', THEME.cyan, 'shared: the line is the same as memory (a write goes through to the bus)'],
        ['I', THEME.faint, 'invalid: the line is empty']].map(([k, col, tip]) => {
        const sp = htmlEl('span', { title: `${k}: ${tip}` }, ms);
        htmlEl('b', { style: `color:${col}` }, sp, k);
        return htmlEl('span', null, sp, '0');
      });
      this.cacheCv = htmlEl('canvas', { role: 'img', 'aria-label': 'The lines of the two caches: 128 sets across. Top: the code cache (2 ways). Bottom: the data cache (2 ways, colour = MESI state).' }, cc);
      this.cacheCtx = this.cacheCv.getContext('2d');
      htmlEl('div', { class: 'mv-dt-note', title: 'The bars at the right of a hex row: left the code cache, right the data cache. A dashed bar: KEN# is high, the line cannot go into a cache.' }, cc, 'A0000h–FFFFFh: KEN# high, not cached. 32-byte lines.');
      this.lastCache = null;
      for (const el of this.clEls) { htmlEl('i', null, el); htmlEl('i', null, el); }
    }
    const ivtWrap = this.ivtWrap = htmlEl('div', null, ivt);
    this.ivtTitle = htmlEl('h4', { class: 'mv-h4' }, ivtWrap, 'Interrupt vectors · 0000:0000');
    const ol = htmlEl('ol', null, ivtWrap);
    this.ivtItems = new Map();
    for (const [v, name] of MV_VECTORS) {
      const li = htmlEl('li', null, ol);
      const b = htmlEl('button', { type: 'button', 'aria-label': `INT ${hex2(v)}h ${name}: show the handler in the hex window` }, li);
      b.innerHTML = `<b>${hex2(v)}</b><em>${name}</em><span>----:----</span>`;
      b.addEventListener('click', () => {
        const m = this.app.machine.mem, a = this.ivtBase() + v * 4;
        const off = m[a] | (m[a + 1] << 8), sg = m[a + 2] | (m[a + 3] << 8);
        this.pinAt(this.a20mask((sg << 4) + off), sg, off, `INT ${hex2(v)}h handler`);
      });
      this.ivtItems.set(v, { li, val: b.querySelector('span'), text: '' });
    }
    if (this.m286) {
      // Protected mode: descriptor tables and the four segment caches.
      const dt = this.dtEl = htmlEl('div', { class: 'mv-dt', hidden: '' }, ivt);
      htmlEl('h4', { class: 'mv-h4' }, dt, 'Descriptor tables · protected mode');
      const tabs = htmlEl('div', { class: 'mv-dt-tabs', role: 'group', 'aria-label': 'Descriptor table' }, dt);
      this.dtBtns = {};
      const dtTabs = [['seg', 'Caches'], ['GDT', 'GDT'], ['LDT', 'LDT'], ['IDT', 'IDT']];
      if (this.m386) dtTabs.push(['pages', 'Pages']);
      for (const [id, label] of dtTabs) {
        const lab = label === 'Caches' ? 'the segment descriptor caches' : label === 'Pages' ? 'the pages in use (linear to physical)' : 'the ' + label;
        const b = htmlEl('button', { type: 'button', 'aria-pressed': id === this.dtTab ? 'true' : 'false', 'aria-label': `Show ${lab}` }, tabs, label);
        b.addEventListener('click', () => this.selectDt(id));
        this.dtBtns[id] = b;
      }
      if (this.m386) this.dtBtns.pages.hidden = true;
      this.dtList = htmlEl('ol', null, dt);
      this.dtNote = htmlEl('div', { class: 'mv-dt-note' }, dt);
      this.dtList.addEventListener('click', e => {
        const b = e.target.closest('button[data-a]');
        if (b) this.pinAt(+b.dataset.a, 0, 0, b.dataset.why);
      });
    }
    if (this.m386) {
      // Paging (a tab of the descriptor panel): the linear pages in use and their page frames.
      const pg = this.pgEl = htmlEl('div', { class: 'mv-pg', hidden: '' }, this.dtEl);
      htmlEl('div', { class: 'mv-dt-note' }, pg, this.m686 ? 'linear page → physical page (the top 20 bits). A gold row is one 4 MB page (1024 pages). G: a global page (CR4.PGE = 1).'
        : this.m586 ? 'linear page → physical page (the top 20 bits). A gold row is one 4 MB page (1024 pages).' : 'linear page → physical page (the top 20 bits)');
      this.pgList = htmlEl('ol', null, pg);
      this.pgNote = htmlEl('div', { class: 'mv-dt-note' }, pg);
      this.pgHot = new Map();
      this.pgList.addEventListener('click', e => {
        const b = e.target.closest('button[data-a]');
        if (b) this.pinAt(+b.dataset.a, 0, 0, b.dataset.why);
      });
    }
    this.sr = htmlEl('div', { class: 'mv-sr', 'aria-live': 'polite' }, root);
    this.wireMap();
    this.syncMode();
  }

  wireMap() {
    const cv = this.canvas;
    const sAt = e => {
      const r = cv.getBoundingClientRect();
      return this.vertical ? e.clientY - r.top : e.clientX - r.left;
    };
    cv.addEventListener('pointermove', e => { this.hoverS = sAt(e); this.mapDirty = true; });
    cv.addEventListener('pointerleave', () => { this.hoverS = null; this.mapDirty = true; });
    cv.addEventListener('click', e => {
      const a = this.addrAtS(sAt(e));
      if (a === null) return;
      this.pinAt(a & ~0xFF, (a & ~0xFF) >> 4, 0, 'Map');
    });
    cv.addEventListener('keydown', e => {
      const cur = this.pinAddr !== null ? this.pinAddr : this.focus().phys;
      let a = null;
      const step = e.shiftKey ? 0x1000 : 0x100;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') a = cur + step;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') a = cur - step;
      else if (e.key === 'PageDown') a = cur + 0x10000;
      else if (e.key === 'PageUp') a = cur - 0x10000;
      else if (e.key === 'Home') a = 0;
      else if (e.key === 'End') a = this.memTop() - 256;
      if (a === null) return;
      e.preventDefault();
      a = clamp(a & ~0xFF, 0, this.memTop() - 256);
      this.pinAt(a, a >> 4, 0, 'Map');
      this.sr.textContent = `Address ${this.hexA(a)}, ${this.regionOf(a).name}`;
    });
  }

  // ---------- view contract ----------
  show() {
    this.shown = true;
    this.resize();
    this.refresh(true);
  }
  hide() { this.shown = false; }
  setReducedMotion(on) { this.reduced = !!on; }
  resize() {
    if (!this.shown) return;
    this.measureOcc();
    this.layout();
    this.mapDirty = true;
    this.drawMap();
  }
  reset() {
    this.pending.clear();
    this.cur = null;
    this.last = null;
    this.heatR.fill(0); this.heatW.fill(0);
    const m = this.app.machine;
    this.sizeHeat();
    this.prevR.set(m.heat.read); this.prevW.set(m.heat.write);
    this.exc = null;
    this.dtHot.clear();
    this.base = -1;
    this.cache.fill(-1);
    for (const it of this.ivtItems.values()) it.li.classList.remove('mv-hot', 'mv-rd');
    this.ivtHot.clear();
    this.lastCache = null;
    this.cacheKey = '';
    if (this.clKeys) this.clKeys.fill('');
    if (this.shown) this.refresh(true);
  }

  instr(events, info) {
    // Memory already holds the results of this instruction: keep the old bytes on
    // screen until each write event arrives.
    this.pending.clear();
    for (const e of events) {
      if (e.k === 'bus' && e.type === 'memw') for (let i = 0; i < (e.width || 1); i++) this.pending.set(this.a20mask(e.addr + i), 1);
    }
    this.cur = { cs: info.cs, ip: info.ip, len: 0, phys: this.physCS(info.cs, info.ip) };
    this.instrText = info.text;
  }

  event(e, clockMs) {
    switch (e.k) {
      case 'decode':
        this.cur = { cs: e.cs, ip: e.ip, len: e.len || (e.bytes ? e.bytes.length : 1), phys: this.physCS(e.cs, e.ip) };
        if (this.shown) { this.follow(); this.markCur(); }
        break;
      case 'fetch':
        if (this.shown) this.flash(e.addr, e.width, 'fetch', clockMs);
        break;
      case 'ea':
        this.lastEA = e;
        break;
      case 'cache':
        // Pentium Pro: the L2 part of an access has its own mark (the L1 part stays the last access)
        if (e.level === 'L2') { this.lastL2 = e; this.cacheKey = ''; if (this.shown) this.markCache(); break; }
        this.lastCache = e;
        this.cacheKey = '';
        if (this.shown) {
          this.markCache();
          // Pentium: a read hit makes no bus cycle; the byte in the hex window flashes green
          if (this.m586 && e.hit && !e.write) this.flash(e.phys >>> 0, 1, 'hit', clockMs);
        }
        break;
      case 'page': case 'tlb':
        if (this.pgHot) this.pgHot.set((e.big ? (e.lin & 0xFFC00000) >>> 12 : e.lin >>> 12) >>> 0, { until: animNow() + 1600, kind: e.k === 'tlb' ? 'hit' : 'walk' });
        this.pgKey = '';
        break;
      case 'bus': {
        if (e.type !== 'memr' && e.type !== 'memw') break;
        const m = this.app.machine;
        const sname = e.seg || null;
        const segv = sname ? m.cpu.sregs[MV_SREG.indexOf(sname)] : null;
        this.last = { phys: e.addr, seg: sname, segv, type: e.type, width: e.width, owner: e.owner };
        if (this.m386 && this.lastEA && this.lastEA.seg === sname) this.last.off = this.lastEA.off >>> 0;
        if (e.type === 'memw') {
          for (let i = 0; i < (e.width || 1); i++) this.pending.delete(this.a20mask(e.addr + i));
          if (this.shown) this.writeCells(e.addr, e.width, e.data, e.hi);
        }
        if (e.type === 'memr' && e.addr >= this.ivtBase() && e.addr < this.ivtBase() + 0x400) this.hotIvt((e.addr - this.ivtBase()) >> 2, 'mv-rd');
        if (this.shown) {
          if (this.mode === 'last') this.follow();
          this.flash(e.addr, e.width, e.type, clockMs);
          // a sound when the access lands in the visible hex window (slow playback only)
          const k = e.addr - this.base;
          if (k >= 0 && k < 256 && this.sfxOn(clockMs)) { if (e.type === 'memw') Sfx.write(); else Sfx.tick(1.4); }
        }
        break;
      }
      case 'int':
        this.hotIvt(e.vec, 'mv-hot');
        this.intNote = `INT ${hex2(e.vec)}h`;
        if (this.m286) {
          this.dtHot.set('IDT:' + e.vec, animNow() + 1600);
          if (e.src === 'exc') this.showExc(e);
        }
        break;
      case 'desc':
        if (this.m286) {
          const t = animNow() + 1600;
          this.dtHot.set('seg:' + e.sreg, t);
          if (e.table === 'GDT' || e.table === 'LDT') this.dtHot.set(e.table + ':' + (e.sel >> 3), t);
          this.dtKey = '';
        }
        break;
      case 'end':
        this.pending.clear();
        if (this.shown) this.refresh(false);
        break;
    }
  }

  // Sounds only while the view is shown and one clock lasts 120 ms or more of real time.
  sfxOn(clockMs) {
    if (typeof Sfx === 'undefined' || !this.shown) return false;
    return (clockMs || 0) / Math.max(1e-3, this.app.motion || 1) >= 120;
  }

  frame(now) {
    if (!this.shown) return;
    if (now - this.occT > 500 && this.measureOcc()) this.resize();
    if (now - this.lastRefresh >= MV_REFRESH_MS) this.refresh(false);
    else if (this.mapDirty) this.drawMap();
    const t = animNow();
    for (const [v, h] of this.ivtHot) if (t > h.until) { h.li.classList.remove(h.cls); this.ivtHot.delete(v); }
  }

  fast(stats) {
    const s = stats.sample;
    if (!s) return;
    for (const e of s) {
      if (e.k === 'decode') this.cur = { cs: e.cs, ip: e.ip, len: e.len, phys: this.physCS(e.cs, e.ip) };
      else if (e.k === 'bus' && (e.type === 'memr' || e.type === 'memw')) {
        const sname = e.seg || null;
        this.last = { phys: e.addr, seg: sname, segv: sname ? this.app.machine.cpu.sregs[MV_SREG.indexOf(sname)] : null, type: e.type, width: e.width };
      } else if (e.k === 'int') { this.hotIvt(e.vec, 'mv-hot'); if (this.m286 && e.src === 'exc') this.showExc(e); }
      else if (e.k === 'cache') { if (e.level === 'L2') this.lastL2 = e; else this.lastCache = e; }
    }
    this.pending.clear();
  }

  // ---------- focus ----------
  setMode(id) {
    this.mode = id;
    this.pinAddr = null;
    storage.set('memMode', id);
    this.syncMode();
    this.base = -1;
    if (this.shown) this.refresh(true);
  }
  syncMode() {
    for (const id in this.modeBtns) this.modeBtns[id].setAttribute('aria-pressed', this.pinAddr === null && this.mode === id ? 'true' : 'false');
  }
  pinAt(phys, seg, off, why) {
    this.pinAddr = phys;
    this.pinInfo = { seg: seg & 0xFFFF, off: off & 0xFFFF, why };
    this.syncMode();
    this.base = -1;
    this.refresh(true);
  }
  // The address the hex window follows, as segment:offset and physical.
  focus() {
    const c = this.app.machine.cpu;
    const S = c.sregs, R = c.regs;
    const so = (name, sg, off) => ({ name, seg: sg, off, phys: this.a20mask((sg << 4) + off) });
    const sr = (name, i, off) => ({ name, seg: S[i], off, phys: this.physOf(i, off), sreg: i });
    if (this.m386) return this.focus386(c, so, sr);
    if (this.pinAddr !== null) return { ...so(this.pinInfo.why, this.pinInfo.seg, this.pinInfo.off), phys: this.pinAddr, pinned: true };
    const pm = this.pm();
    if (pm && (this.mode === 'gdt' || this.mode === 'idt')) {
      const t = this.mode === 'gdt' ? c.gdtr : c.idtr;
      return { name: this.mode.toUpperCase(), seg: 0, off: 0, phys: t ? t.base & (this.memTop() - 1) : 0, table: t, tname: this.mode.toUpperCase() };
    }
    switch (this.mode) {
      case 'stack': return sr('SS:SP', 2, R[4]);
      case 'data': return sr('DS:SI', 3, R[6]);
      case 'video': return so('B800:0000', 0xB800, 0);
      case 'last': {
        const l = this.last;
        if (!l) return so('CS:IP', S[1], c.ip);
        if (l.segv !== null && l.segv !== undefined) {
          const i = MV_SREG.indexOf(l.seg);
          return { name: `last ${l.type === 'memw' ? 'write' : 'read'} ${l.seg}`, seg: l.segv, off: (l.phys - this.segBase(i)) & 0xFFFF, phys: l.phys, sreg: pm ? i : undefined };
        }
        return { name: `last ${l.type === 'memw' ? 'write' : 'read'}`, seg: (l.phys >> 4) & 0xF000, off: l.phys & 0xFFFF, phys: l.phys };
      }
      default: {
        const cur = this.cur;
        if (cur && this.app.mode !== 'fast') return { name: 'CS:IP', seg: cur.cs, off: cur.ip, phys: cur.phys, sreg: 1 };
        return sr('CS:IP', 1, c.ip);
      }
    }
  }
  // 80386: 32-bit offsets (ESP, ESI, EIP) and linear -> physical through the page tables.
  focus386(c, so, sr) {
    const S = c.sregs, pm = this.pm();
    if (this.pinAddr !== null) return { ...so(this.pinInfo.why, this.pinInfo.seg, this.pinInfo.off), phys: this.pinAddr, pinned: true };
    if (pm && (this.mode === 'gdt' || this.mode === 'idt')) {
      const t = this.mode === 'gdt' ? c.gdtr : c.idtr;
      const lin = t ? t.base >>> 0 : 0, p = this.linPhys(lin);
      return { name: this.mode.toUpperCase(), seg: 0, off: 0, phys: p < 0 ? 0 : p, table: t, tname: this.mode.toUpperCase() };
    }
    switch (this.mode) {
      case 'stack': return sr('SS:ESP', 2, this.rOff(4, 2));
      case 'data': return sr('DS:ESI', 3, this.rOff(6, 3));
      case 'video': return so('B800:0000', 0xB800, 0);
      case 'last': {
        const l = this.last;
        if (!l) return sr('CS:EIP', 1, c.ip >>> 0);
        const i = l.seg ? MV_SREG.indexOf(l.seg) : -1;
        const nm = `last ${l.type === 'memw' ? 'write' : 'read'}${l.seg ? ' ' + l.seg : ''}`;
        if (i >= 0 && l.off !== undefined) return { name: nm, seg: l.segv, off: l.off, phys: l.phys, sreg: pm ? i : undefined };
        return { name: nm, seg: (l.phys >> 4) & 0xF000, off: l.phys & 0xFFFF, phys: l.phys };
      }
      default: {
        const cur = this.cur;
        if (cur && this.app.mode !== 'fast') return { name: 'CS:EIP', seg: cur.cs, off: cur.ip, phys: cur.phys, sreg: 1 };
        return sr('CS:EIP', 1, c.ip >>> 0);
      }
    }
  }
  // The offset in register r for segment s: 32 bits when the segment is a 32-bit (big) one.
  rOff(r, s) {
    const c = this.app.machine.cpu;
    if (this.m386 && c.cache && c.cache[s] && c.cache[s].big) return c.regs32[r] >>> 0;
    return c.regs[r];
  }
  // Linear -> physical without bus cycles: the TLB, else the page tables (-1 = not present).
  linPhys(lin) {
    const m = this.app.machine, c = m.cpu;
    lin >>>= 0;
    if (!c.paging) return lin;
    if (this.m586 && c.peekPhys) return c.peekPhys(lin);   // the Pentium core knows the 4 MB pages
    const e = c.tlbFind ? c.tlbFind(lin) : null;
    if (e) return (e.phys | (lin & 0xFFF)) >>> 0;
    const w = this.pte(lin);
    return w.pte & 1 ? ((w.pte & 0xFFFFF000) | (lin & 0xFFF)) >>> 0 : -1;
  }
  // Pentium: CR4.PSE = 1 and a present PDE with PS = 1 (bit 7): one 4 MB page, no page table.
  bigPde(pde) { return this.m586 && (pde & 0x81) === 0x81 && !!(this.app.machine.cpu.cr[4] & 0x10); }
  // The page directory entry and the page table entry of a linear address (peek8: no bus cycles).
  pte(lin) {
    const m = this.app.machine, c = m.cpu;
    const rd = a => { let v = 0; for (let k = 3; k >= 0; k--) v = v * 256 + (m.peek8 ? m.peek8((a + k) >>> 0) : m.mem[(a + k) & (m.mem.length - 1)]); return v >>> 0; };
    const pde = rd(((c.cr[3] & 0xFFFFF000) + (lin >>> 22) * 4) >>> 0);
    if (this.bigPde(pde)) return { pde, pte: 0, big: true };
    const pte = pde & 1 ? rd(((pde & 0xFFFFF000) + ((lin >>> 12) & 0x3FF) * 4) >>> 0) : 0;
    return { pde, pte };
  }
  // Choose the 256-byte window: keep it still while the focus stays in its middle rows.
  follow() {
    const f = this.focus();
    let b = this.base;
    if (this.pinAddr !== null || this.mode === 'video') b = f.phys & ~0xF;
    else if (b < 0 || f.phys < b + 0x20 || f.phys >= b + 0xE0) b = (f.phys & ~0xF) - 0x70;
    b = clamp(b, 0, this.memTop() - 256);
    if (b !== this.base) {
      this.base = b;
      this.cache.fill(-1);
      this.fillCells(true);
      this.markCur();
    }
    return f;
  }

  // ---------- hex window ----------
  refresh(initial) {
    this.lastRefresh = animNow();
    if (!this.shown) return;
    const f = this.follow();
    this.fillCells(initial);
    this.markCur();
    this.markFocus(f);
    this.showCalc(f);
    this.updateIvt();
    if (this.m286) this.updateModel();
    if (this.m486) { this.markCache(); this.updateCache(); }
    if (this.m686) { this.markCache(); this.updateCache686(); }
    else if (this.m586) { this.markCache(); this.updateCache586(); }
    this.decayHeat();
    this.drawMap();
  }
  fillCells(initial) {
    const m = this.app.machine, mem = m.mem, b = this.base;
    const peek = this.m286 && m.peek8 ? a => m.peek8(a) : a => mem[a];
    for (let r = 0; r < 16; r++) {
      const t = this.hexA(b + r * 16);
      if (this.addrEls[r].textContent !== t) this.addrEls[r].textContent = t;
    }
    for (let k = 0; k < 256; k++) {
      const a = b + k;
      if (this.pending.has(a)) continue;
      const na = m.devAt(a) === 'none';
      const v = na ? -2 : peek(a);
      if (v === this.cache[k]) continue;
      const first = this.cache[k] === -1;
      this.cache[k] = v;
      this.setCell(k, v);
      if (!first && !initial && v >= 0 && this.app.mode === 'fast') this.animate(k, THEME.goldHi, 0.35, 700);
    }
  }
  setCell(k, v) {
    const el = this.cells[k], as = this.ascs[k];
    if (v === -2) { el.textContent = '--'; el.className = 'mv-b na'; as.textContent = ' '; as.className = 'z'; return; }
    el.textContent = hex2(v);
    el.classList.toggle('na', false);
    el.classList.toggle('z', v === 0);
    const ch = v >= 32 && v < 127 ? String.fromCharCode(v) : '.';
    as.textContent = ch;
    as.className = ch === '.' ? 'z' : '';
  }
  writeCells(addr, width, data, hi) {
    for (let i = 0; i < (width || 1); i++) {
      const k = addr + i - this.base;
      if (k < 0 || k >= 256) continue;
      // the 64-bit bus of the Pentium: bytes 4-7 of an 8-byte transfer are in hi
      const v = i < 4 ? (data >> (8 * i)) & 0xFF : ((hi || 0) >> (8 * (i - 4))) & 0xFF;
      this.cache[k] = v;
      this.setCell(k, v);
    }
    this.markCur();
  }
  flash(addr, width, type, clockMs) {
    const dur = clamp((clockMs || 20) * 12, 350, 1400);
    for (let i = 0; i < (width || 1); i++) {
      const k = addr + i - this.base;
      if (k < 0 || k >= 256) continue;
      if (type === 'memr') this.animate(k, THEME.cyan, 0.6, dur);
      else if (type === 'hit') this.animate(k, THEME.phosphor, 0.45, dur);
      else if (type === 'memw') this.animate(k, THEME.goldHi, 0.75, dur * 1.3);
      else this.animate(k, THEME.gold, 0.28, dur);
    }
  }
  animate(k, col, alpha, dur) {
    const el = this.cells[k];
    if (!el.animate) return;
    const rgb = MemoryView.rgba(col, alpha);
    const kf = [{ backgroundColor: rgb, color: THEME.text }, { backgroundColor: 'transparent' }];
    el.animate(kf, { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)' });
    const as = this.ascs[k];
    if (as.animate) as.animate(kf, { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }
  // Mix two #rrggbb colours (t = 0..1 of b) into an rgb() string.
  static mix(a, b, t) {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const ch = sh => Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }
  static rgba(hexc, a) {
    const n = parseInt(hexc.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  markCur() {
    const cur = this.cur, b = this.base;
    const lo = cur ? cur.phys : -1, hi = cur ? cur.phys + Math.max(1, cur.len || 1) : -1;
    for (let k = 0; k < 256; k++) {
      const a = b + k, on = a >= lo && a < hi;
      const el = this.cells[k];
      const col = k & 15;
      const was = el.classList.contains('cur');
      if (!on && !was) continue;
      el.classList.toggle('cur', on);
      el.classList.toggle('cs', on && (a === lo || col === 0));
      el.classList.toggle('ce', on && (a === hi - 1 || col === 15));
      this.ascs[k].classList.toggle('cur', on);
    }
  }
  markFocus(f) {
    const k0 = f.phys - this.base;
    const w = this.mode === 'stack' || (this.mode === 'last' && this.last && this.last.width === 2) ? 2 : 1;
    for (let k = 0; k < 256; k++) {
      const on = (this.pinAddr !== null || this.mode !== 'code') && k >= k0 && k < k0 + w;
      if (on !== this.cells[k].classList.contains('foc')) this.cells[k].classList.toggle('foc', on);
    }
    for (let r = 0; r < 16; r++) this.addrEls[r].classList.toggle('mv-afoc', k0 >= r * 16 && k0 < r * 16 + 16);
    const reg = this.regionOf(this.base);
    const t = `${this.hexA(this.base)}–${this.hexA(this.base + 255)}<span class="mv-regname"> · ${reg.name}</span>`;
    if (this.hexTitleKey !== t) { this.hexTitleKey = t; this.hexTitle.innerHTML = t; }
  }
  showCalc(f) {
    const key = `${f.name}|${f.seg}|${f.off}|${f.phys}`;
    if (key === this.calcKey) return;
    this.calcKey = key;
    if (this.m386 && this.pm() && f.sreg !== undefined && f.table === undefined) { this.showCalc386(f); return; }
    if (this.m286 && (f.table !== undefined || (this.pm() && f.sreg !== undefined))) { this.showCalcPM(f); return; }
    const shifted = ((f.seg << 4) >>> 0);
    const sum = shifted + f.off;
    const wrap = sum > 0xFFFFF;
    if (this.m286) { this.showCalc286(f, sum, wrap); return; }
    const col = { 'SS:SP': 'mv-g', 'DS:SI': 'mv-c', 'CS:IP': 'mv-p' }[f.name] || 'mv-c';
    const sa = `<span class="mv-c">${hex4(f.seg)}</span>:<span class="mv-g">${hex4(f.off)}</span>`;
    if (this.compactCalc) {
      this.calcEl.innerHTML =
        `<span class="mv-what">${MemoryView.esc(f.name)}</span><span class="mv-sa">${sa}</span>` +
        `<span><span class="mv-c">${hex4(f.seg)}</span><span class="mv-f">h</span> × 16 + <span class="mv-g">${hex4(f.off)}</span><span class="mv-f">h</span> = <b class="mv-p">${hex5(sum)}</b><span class="mv-f">h${wrap ? ' (wraps)' : ''}</span></span>`;
      return;
    }
    this.calcEl.innerHTML =
      `<div><div class="mv-what">focus · ${MemoryView.esc(f.name)}</div>` +
      `<div class="mv-sa">${sa}</div></div>` +
      '<div class="mv-sum">' +
      `<span>seg × 16</span><b><span class="mv-c">${hex4(f.seg)}</span><span class="mv-f">0</span></b>` +
      `<span>+ offset</span><b><span class="mv-f">0</span><span class="mv-g">${hex4(f.off)}</span></b>` +
      `<span>= physical</span><b class="mv-rule mv-p">${hex5(sum)}</b></div>` +
      `<div class="mv-f mv-note">${wrap ? 'The sum passes FFFFF: the 20-bit bus wraps to ' + hex5(sum) + '.' : '20-bit address = segment × 16 + offset.'}</div>`;
  }

  // Real mode on the 80286: the sum can pass FFFFF; the A20 gate decides where it goes.
  showCalc286(f, sum, wrap) {
    const m = this.app.machine, a20 = m.a20 !== false;
    const phys = this.hexA(f.phys);
    const sa = `<span class="mv-c">${hex4(f.seg)}</span>:<span class="mv-g">${hex4(f.off)}</span>`;
    const note = !wrap ? '21-bit sum = segment × 16 + offset; A20 decides bit 20.'
      : a20 ? `A20 on: ${hex(sum, 6)} is in the HMA, above 1 MB, from real mode.`
        : `A20 off: bit 20 is forced to 0, so ${hex(sum, 6)} wraps to ${phys} like an 8086.`;
    if (this.compactCalc) {
      this.calcEl.innerHTML =
        `<span class="mv-what">${MemoryView.esc(f.name)}</span><span class="mv-sa">${sa}</span>` +
        `<span><span class="mv-c">${hex4(f.seg)}</span><span class="mv-f">h</span> × 16 + <span class="mv-g">${hex4(f.off)}</span><span class="mv-f">h</span> = <b class="mv-p">${phys}</b><span class="mv-f">h${wrap ? (a20 ? ' (HMA)' : ' (A20 wrap)') : ''}</span></span>`;
      return;
    }
    this.calcEl.innerHTML =
      `<div><div class="mv-what">focus · ${MemoryView.esc(f.name)} · real mode</div>` +
      `<div class="mv-sa">${sa}</div></div>` +
      '<div class="mv-sum">' +
      `<span>seg × 16</span><b><span class="mv-f">0</span><span class="mv-c">${hex4(f.seg)}</span><span class="mv-f">0</span></b>` +
      `<span>+ offset</span><b><span class="mv-f">00</span><span class="mv-g">${hex4(f.off)}</span></b>` +
      `<span>= physical</span><b class="mv-rule mv-p">${phys}</b></div>` +
      `<div class="mv-f mv-note">${note}</div>`;
  }
  // 80386 protected mode: descriptor base + offset = linear; paging: linear -> page frame -> physical.
  showCalc386(f) {
    const c = this.app.machine.cpu, cache = c.cache[f.sreg], pg = !!c.paging, vm = !!c.vm;
    const sel = f.seg & 0xFFFF, off = f.off >>> 0, base = cache.base >>> 0, lin = (base + off) >>> 0;
    const phys = this.linPhys(lin);
    const hx = v => hex(v >>> 0, 8);
    const offT = off > 0xFFFF ? hx(off) : hex4(off);
    const sa = `<span class="mv-l">${hex4(sel)}</span>:<span class="mv-g">${offT}</span>`;
    const ph = phys < 0 ? '<b class="mv-m">not present</b>' : `<b class="mv-p">${hx(phys)}</b>`;
    if (this.compactCalc) {
      this.calcEl.innerHTML = `<span class="mv-what">${MemoryView.esc(f.name)}</span><span class="mv-sa">${sa}</span>` +
        `<span><span class="mv-c">${hx(base)}</span> + <span class="mv-g">${offT}</span> = <span class="mv-c">${hx(lin)}</span>${pg ? ' → ' + ph : ''}</span>`;
      return;
    }
    const tbl = sel & 4 ? 'LDT' : 'GDT';
    let note;
    if (pg) {
      const w = this.pte(lin);
      note = phys < 0 ? `<span class="mv-m">page ${hex(lin >>> 12, 5)} is not present: #PF</span>`
        : w.big ? `DIR ${hex(lin >>> 22, 3)} · 4 MB page (PS = 1) → frame ${hex(phys >>> 22, 3)} + offset ${hex(lin & 0x3FFFFF, 6)}${(w.pde & 0x40) ? ' · dirty' : ''}`
          : `DIR ${hex(lin >>> 22, 3)} · TABLE ${hex((lin >>> 12) & 0x3FF, 3)} → frame ${hex(phys >>> 12, 5)}${(w.pte & 0x40) ? ' · dirty' : ''}`;
    } else note = 'paging off: the linear address is the physical address';
    this.calcEl.innerHTML =
      `<div><div class="mv-what">focus · ${MemoryView.esc(f.name)} · ${vm ? 'V86' : 'protected'}</div>` +
      `<div class="mv-sa">${sa}</div>` +
      `<div class="mv-f" style="font-size:11px">${vm ? 'V86: base = selector × 16' : `selector → ${tbl}[${sel >> 3}] · RPL ${sel & 3}`}</div></div>` +
      '<div class="mv-sum">' +
      `<span>base</span><b class="mv-c">${hx(base)}</b>` +
      `<span>+ offset</span><b class="mv-g">${hx(off)}</b>` +
      `<span>= linear</span><b class="mv-rule mv-c">${hx(lin)}</b>` +
      (pg ? `<span>→ physical</span>${ph}` : '') + '</div>' +
      `<div class="mv-f mv-note">${note}</div>`;
  }
  // Protected mode: selector -> descriptor (segment cache) base + offset.
  showCalcPM(f) {
    const c = this.app.machine.cpu;
    if (f.table !== undefined) {
      const t = f.table || { base: 0, limit: 0 };
      this.calcEl.innerHTML = `<div><div class="mv-what">focus · ${f.tname} register</div>` +
        `<div class="mv-sa">base <span class="mv-c">${hex(t.base, this.m386 ? 8 : 6)}</span> · limit <span class="mv-g">${hex4(t.limit)}</span></div></div>` +
        `<div class="mv-f mv-note">${Math.floor((t.limit + 1) / 8)} descriptors × 8 bytes</div>`;
      return;
    }
    const sel = f.seg, cache = c.cache && c.cache[f.sreg] ? c.cache[f.sreg] : { base: 0, limit: 0xFFFF, access: 0 };
    const tbl = sel & 4 ? 'LDT' : 'GDT', idx = sel >> 3, rpl = sel & 3;
    const sa = `<span class="mv-l">${hex4(sel)}</span>:<span class="mv-g">${hex4(f.off)}</span>`;
    if (this.compactCalc) {
      this.calcEl.innerHTML = `<span class="mv-what">${MemoryView.esc(f.name)}</span><span class="mv-sa">${sa}</span>` +
        `<span>${tbl}[${idx}] base <span class="mv-c">${hex(cache.base, 6)}</span> + <span class="mv-g">${hex4(f.off)}</span> = <b class="mv-p">${this.hexA(f.phys)}</b></span>`;
      return;
    }
    const over = f.off > cache.limit;
    this.calcEl.innerHTML =
      `<div><div class="mv-what">focus · ${MemoryView.esc(f.name)} · protected</div>` +
      `<div class="mv-sa">${sa}</div>` +
      `<div class="mv-f" style="font-size:11px">selector → ${tbl}[${idx}] · RPL ${rpl}</div></div>` +
      '<div class="mv-sum">' +
      `<span>desc. base</span><b class="mv-c">${hex(cache.base, 6)}</b>` +
      `<span>+ offset</span><b><span class="mv-f">00</span><span class="mv-g">${hex4(f.off)}</span></b>` +
      `<span>= physical</span><b class="mv-rule mv-p">${this.hexA(f.phys)}</b></div>` +
      `<div class="mv-f mv-note">${over ? '<span class="mv-m">offset above the limit ' + hex4(cache.limit) + ': #GP</span>' : 'limit ' + hex4(cache.limit) + ' · ' + MemoryView.descType(cache.access).t + ' · DPL ' + ((cache.access >> 5) & 3)}</div>`;
  }

  // ---------- address helpers (8086: 20 bits; 80286: 24 bits and the A20 gate) ----------
  memTop() { const m = this.app.machine; return this.m286 ? (m.memSize || m.mem.length) : 0x100000; }
  hexA(a) { return this.m286 ? hex(a & 0xFFFFFF, 6) : hex5(a); }
  pm() { return this.m286 && !!(this.app.machine.cpu.msw & 1); }
  a20mask(a) {
    if (!this.m286) return a & 0xFFFFF;
    if (this.app.machine.a20 === false) a &= ~0x100000;
    return a & (this.memTop() - 1);
  }
  segBase(i) {
    const c = this.app.machine.cpu;
    if (this.m286 && c.cache && c.cache[i]) return c.cache[i].base;
    return c.sregs[i] << 4;
  }
  physOf(i, off) {
    if (this.m386) {
      const c = this.app.machine.cpu, d = c.cache[i];
      const lin = (d.base + (d.big ? off >>> 0 : off & 0xFFFF)) >>> 0, p = this.linPhys(lin);
      return p < 0 ? lin & (this.memTop() - 1) : this.a20mask(p);
    }
    return this.a20mask(this.segBase(i) + (off & 0xFFFF));
  }
  physCS(cs, ip) {
    const c = this.app.machine.cpu;
    if (this.m386 && c.cache && c.cache[1] && cs === c.sregs[1]) { const lin = (c.cache[1].base + ip) >>> 0, p = this.linPhys(lin); return p < 0 ? lin & (this.memTop() - 1) : this.a20mask(p); }
    if (this.m286 && c.cache && c.cache[1] && cs === c.sregs[1]) return this.a20mask(c.cache[1].base + ip);
    return this.a20mask((cs << 4) + ip);
  }
  ivtBase() { const c = this.app.machine.cpu; return this.m286 && c.idtr && !this.pm() ? c.idtr.base : 0; }
  sizeHeat() {
    const n = this.app.machine.heat.read.length;
    if (this.heatR.length === n) return;
    for (const k of ['heatR', 'heatW', 'prevR', 'prevW']) this[k] = new Float32Array(n);
  }

  // ---------- 80486: the cache ----------
  cacheObj() { const c = this.app.machine.cpu; return this.m486 && c && c.cache486 ? c.cache486 : null; }
  // The line index (set * 4 + way) of a physical address in the cache, or -1.
  cacheLine(a) {
    const C = this.cacheObj();
    if (!C) return -1;
    const set = (a >>> 4) & 127, tag = a >>> 11;
    for (let w = 0; w < 4; w++) { const l = C.lines[set * 4 + w]; if (l.valid && l.tag === tag) return set * 4 + w; }
    return -1;
  }
  noCache(a) { return a >= 0xA0000 && a < 0x100000; }
  // The 16 rows of the hex window are 16 lines (the window starts on a 16-byte boundary).
  markCache() {
    if (this.m686) { this.markCache686(); return; }
    if (this.m586) { this.markCache586(); return; }
    if (!this.m486 || !this.clEls.length) return;
    const b = this.base, L = this.lastCache, last = L ? (L.phys >>> 0) & ~15 : -1;
    for (let r = 0; r < 16; r++) {
      const a = b + r * 16, i = this.cacheLine(a), nc = this.noCache(a);
      const cls = 'mv-clm' + (i >= 0 ? ' on' : nc ? ' nc' : '') + (i >= 0 && a === last ? ' last' : '');
      const el = this.clEls[r];
      if (el.className !== cls) {
        el.className = cls;
        el.title = i >= 0 ? `line ${hex(a, 8)}: in the cache, set ${hex2(i >> 2)} way ${i & 3}` : nc ? 'not cacheable: KEN# is high for A0000h-FFFFFh' : `line ${hex(a, 8)}: not in the cache`;
        this.rowEls[r].classList.toggle('mv-cached', i >= 0);
      }
    }
  }
  updateCache() {
    const C = this.cacheObj(), c = this.app.machine.cpu;
    if (!this.cstEl) return;
    if (!C) { this.cstEl.textContent = 'no cache in this CPU core'; return; }
    const cr0 = c.cr[0] >>> 0, cd = (cr0 >>> 30) & 1, nw = (cr0 >>> 29) & 1;
    let valid = 0, win = 0;
    for (const l of C.lines) if (l.valid) { valid++; if (l.addr >= this.base && l.addr < this.base + 256) win++; }
    const st = C.stats, n = st.hits + st.misses;
    const html = `<b class="${cd ? 'off' : ''}">${cd ? 'off' : 'on'}</b> · CD ${cd} NW ${nw} · ${valid}/512 lines · ${win} in the window` +
      (n ? ` · hit rate ${(st.hits / n * 100).toFixed(1)} %` : '');
    if (html !== this.cstHtml) { this.cstHtml = html; this.cstEl.innerHTML = html; }
    // the line map: 128 sets across, 4 ways down
    const cv = this.cacheCv, w = cv.clientWidth, h = 22;
    if (!w) return;
    const L = this.lastCache;
    const key = `${w}|${this.base}|${L ? L.phys + ':' + L.set : ''}|` + C.lines.map(l => (l.valid ? l.addr : -1)).join(',');
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = this.cacheCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = MemoryView.mix(THEME.void, THEME.panel2, 0.8);
    ctx.fillRect(0, 0, w, h);
    const cw = w / 128, ch = h / 4;
    for (let s = 0; s < 128; s++) {
      for (let k = 0; k < 4; k++) {
        const l = C.lines[s * 4 + k];
        if (!l.valid) continue;
        const inWin = l.addr >= this.base && l.addr < this.base + 256;
        ctx.fillStyle = inWin ? THEME.phosphor : MemoryView.rgba(THEME.cyan, this.noCache(l.addr) ? 0.3 : 0.6);
        ctx.fillRect(s * cw + 0.2, k * ch + 0.6, Math.max(0.8, cw - 0.4), ch - 1.2);
      }
    }
    if (L && L.set >= 0) {
      ctx.strokeStyle = L.hit ? THEME.phosphor : THEME.magenta;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(L.set * cw - 1, 0.6, cw + 2, h - 1.2);
    }
  }

  // ---------- Pentium: the code cache and the data cache ----------
  // KEN#: the bus of the machine tells if an address can go into a cache.
  noCache586(a) {
    const b = this.app.machine.bus;
    return b && b.cacheable ? !b.cacheable(a >>> 0) : this.noCache(a);
  }
  // Two hex rows make one 32-byte line. The left bar: the line is in the code cache; the right
  // bar: the line is in the data cache (its colour is the MESI state). A dashed bar: KEN# is high.
  markCache586() {
    const c = this.app.machine.cpu, D = c.dcache;
    if (!D || !this.clEls.length) return;
    if (!this.clKeys) this.clKeys = new Array(16).fill('');
    const b = this.base, L = this.lastCache, last = L ? (L.phys >>> 0) & ~31 : -1;
    const MESI = ['I', 'S', 'E', 'M'], NAME = { M: 'M (modified)', E: 'E (exclusive)', S: 'S (shared)' };
    for (let r = 0; r < 16; r++) {
      const a = (b + r * 16) >>> 0, line = a & ~31;
      const ic = c.iFind(a), dc = c.dFind(a), st = dc >= 0 ? MESI[D.state[dc]] : '';
      const nc = ic < 0 && dc < 0 && this.noCache586(a);
      const isLast = line === last && (ic >= 0 || dc >= 0);
      const key = `${line}|${ic}|${dc}|${st}|${nc ? 1 : 0}|${isLast ? 1 : 0}`;
      if (this.clKeys[r] === key) continue;
      this.clKeys[r] = key;
      const el = this.clEls[r], ch = el.children;
      if (ch.length < 2) continue;
      el.className = 'mv-clm' + (isLast ? ' last' : '');
      ch[0].className = ic >= 0 ? 'c' : nc ? 'nc' : '';
      ch[1].className = st && st !== 'I' ? st : '';
      const lt = `line ${hex(line, 8)}`;
      el.title = nc ? `${lt}: not cacheable (KEN# is high)`
        : ic < 0 && dc < 0 ? `${lt}: not in a cache`
          : `${lt}: ` + [ic >= 0 ? `code cache set ${hex2(ic >> 1)} way ${ic & 1}` : '', dc >= 0 ? `data cache set ${hex2(dc >> 1)} way ${dc & 1}, state ${NAME[st] || st}` : ''].filter(Boolean).join(' · ');
      const row = this.rowEls[r].classList, tint = st && st !== 'I' ? st : ic >= 0 ? 'C' : '';
      for (const k of ['M', 'E', 'S', 'C']) row.toggle('mv-l' + k, k === tint);
    }
  }
  updateCache586() {
    const c = this.app.machine.cpu, D = c.dcache, I = c.icache;
    if (!this.cstEl || !D || !I) return;
    const cr0 = c.cr[0] >>> 0, cd = (cr0 >>> 30) & 1, nw = (cr0 >>> 29) & 1, ci = c.tr12 & 0x200 ? 1 : 0;
    const n = [0, 0, 0, 0];
    let iv = 0, sum = 0;
    for (let i = 0; i < 256; i++) {
      const dt = D.tag[i], it = I.tag[i], s = dt >= 0 ? D.state[i] : 0;
      n[s]++;
      if (it >= 0) iv++;
      sum = (Math.imul(sum, 31) + (dt ^ (s << 29))) | 0;
      sum = (Math.imul(sum, 31) + it) | 0;
    }
    const html = `<b class="${cd || ci ? 'off' : ''}">${cd ? 'off' : ci ? 'no fills' : 'on'}</b> · CD ${cd} NW ${nw}${ci ? ' · TR12.CI 1' : ''} · code ${iv}/256 · data ${256 - n[0]}/256 lines`;
    if (html !== this.cstHtml) { this.cstHtml = html; this.cstEl.innerHTML = html; }
    const f = v => v.toLocaleString('en-US');
    const vals = [[I.stats.hits, I.stats.misses, I.stats.fills, -1], [D.stats.hits, D.stats.misses, D.stats.fills, D.stats.writeBacks]];
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < 4; k++) {
        const t = vals[r][k] < 0 ? '—' : f(vals[r][k]), el = this.c5Rows[r][k];
        if (el.textContent !== t) el.textContent = t;
      }
    }
    const mc = [n[3], n[2], n[1], n[0]];
    for (let k = 0; k < 4; k++) { const t = String(mc[k]); if (this.mesiEls[k].textContent !== t) this.mesiEls[k].textContent = t; }
    // the line map: 128 sets across; the code cache (2 ways) above the data cache (2 ways)
    const cv = this.cacheCv, w = cv.clientWidth, h = 30;
    if (!w) return;
    const L = this.lastCache;
    const key = `${w}|${this.base}|${L ? L.phys + ':' + L.set + ':' + L.cache + ':' + L.hit : ''}|${sum}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = this.cacheCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const x0 = 11, cw = (w - x0) / 128, strips = [[I, 1], [D, 16]], rh = 6.2;
    ctx.font = `600 8.5px ${(getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace').trim()}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.lavender; ctx.fillText('C', 1, 7.5);
    ctx.fillStyle = THEME.cyan; ctx.fillText('D', 1, 22.5);
    const stCol = [THEME.faint, THEME.cyan, THEME.phosphor, THEME.magenta];
    for (const [C, y0] of strips) {
      ctx.fillStyle = MemoryView.mix(THEME.void, THEME.panel2, 0.8);
      ctx.fillRect(x0, y0, w - x0, 2 * rh + 1);
      for (let i = 0; i < 256; i++) {
        if (C.tag[i] < 0) continue;
        const a = c.lineAddr(C.tag[i], i), inWin = a + 32 > this.base && a < this.base + 256;
        const col = C === I ? THEME.lavender : stCol[D.state[i]];
        ctx.fillStyle = MemoryView.rgba(col, inWin ? 1 : 0.55);
        ctx.fillRect(x0 + (i >> 1) * cw + 0.2, y0 + (i & 1) * (rh + 0.5) + 0.3, Math.max(0.8, cw - 0.4), rh - 0.6);
      }
    }
    if (L && L.set >= 0) {
      const y0 = L.cache === 'code' || L.code ? 1 : 16;
      ctx.strokeStyle = L.hit ? THEME.phosphor : THEME.goldHi;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x0 + L.set * cw - 1, y0 - 0.5, cw + 2, 2 * rh + 2);
    }
  }

  // ---------- Pentium Pro: the L1 code cache, the L1 data cache and the L2 ----------
  buildCache686(ivt) {
    // the three caches: the state, the counters, the MESI counts, a map of the lines and the
    // physical ranges with no KEN#
    const cc = htmlEl('div', { class: 'mv-c5' }, ivt);
    htmlEl('h4', { class: 'mv-h4' }, cc, 'Caches · L1 8 KB code + 8 KB data · L2 256 KB');
    this.cstEl = htmlEl('div', { class: 'mv-cst' }, cc, 'cache off');
    const tb = htmlEl('table', { class: 'mv-c5t', 'aria-label': 'The counters of the L1 code cache, the L1 data cache and the L2 cache' }, cc);
    tb.innerHTML = '<thead><tr><th scope="col"></th><th scope="col" title="Accesses that the cache gave (the L1: no L2 access; the L2: no bus cycle)">hits</th>' +
      '<th scope="col" title="Accesses that were not in the cache">miss</th><th scope="col" title="Lines that came into the cache (32 bytes)">fills</th>' +
      '<th scope="col" title="M lines that went out: the L1 data cache writes them into the L2, the L2 writes them to memory in a burst of 4 × 8 bytes">wb</th></tr></thead>';
    const body = htmlEl('tbody', null, tb);
    this.c5Rows = [['L1 code', 'The L1 code cache: 64 sets of 4 ways. The prefetcher reads it.'], ['L1 data', 'The L1 data cache: 128 sets of 2 ways, write-back, with the MESI states'],
      ['L2', 'The L2 cache: 2048 sets of 4 ways, 256 KB, on the back-side bus in the same package. It holds code and data. A miss goes to memory on the front-side bus.']].map(([n, tip]) => {
      const tr = htmlEl('tr', null, body);
      htmlEl('td', { title: tip }, tr, n);
      return [0, 1, 2, 3].map(() => htmlEl('td', null, tr, '—'));
    });
    const msRow = htmlEl('div', { class: 'mv-mesi' }, cc);
    const mk = (lab, what) => {
      const ms = htmlEl('span', { class: 'mv-mesi1', 'aria-label': 'MESI states of the ' + what }, msRow);
      htmlEl('span', { class: 'mv-ml' }, ms, lab);
      return [['M', THEME.magenta, 'modified: the line has changes that memory does not have (a write-back copies them)'],
        ['E', THEME.phosphor, 'exclusive: the line is the same as memory, and only this cache has it'],
        ['S', THEME.cyan, 'shared: the line is the same as memory'],
        ['I', THEME.faint, 'invalid: the line is empty']].map(([k, col, tip]) => {
        const sp = htmlEl('span', { title: `${k}: ${tip}` }, ms);
        htmlEl('b', { style: `color:${col}` }, sp, k);
        return htmlEl('span', null, sp, '0');
      });
    };
    this.mesiEls = mk('L1', 'the 256 L1 data lines');
    this.mesiL2 = mk('L2', 'the 8192 L2 lines');
    this.cacheCv = htmlEl('canvas', { role: 'img', 'aria-label': 'The lines of the three caches. Top: the L1 code cache (64 sets across, 4 ways). Middle: the L1 data cache (128 sets across, 2 ways, the colour is the MESI state). Bottom: the L2 (2048 sets across, 4 ways).' }, cc);
    this.cacheCtx = this.cacheCv.getContext('2d');
    this.ncEl = htmlEl('div', { class: 'mv-dt-note', title: 'The bars at the right of a hex row: left the L1 code cache, middle the L1 data cache, right (striped) the L2. A dashed bar: KEN# is high, the line cannot go into a cache.' }, cc, '');
    this.lastCache = null;
    for (const el of this.clEls) { htmlEl('i', null, el); htmlEl('i', null, el); htmlEl('i', null, el); }
  }
  // The physical ranges with no KEN# (bus.cacheable is false), in 4 KB steps up to the top of memory.
  ncText() {
    const b = this.app.machine.bus, top = this.memTop();
    if (!b || !b.cacheable) return 'A0000h–FFFFFh: KEN# high, not cached.';
    const out = [];
    let s = -1;
    for (let a = 0; a <= top; a += 0x1000) {
      const nc = a < top && !b.cacheable(a);
      if (nc && s < 0) s = a;
      else if (!nc && s >= 0) { out.push(`${hex(s, s > 0xFFFFF ? 6 : 5)}h–${hex(a - 1, a - 1 > 0xFFFFF ? 6 : 5)}h`); s = -1; }
    }
    const a20 = this.app.machine.a20 === false ? ' (A20 is off: the odd megabytes too)' : '';
    return out.length ? `no KEN# (not cached): ${out.slice(0, 4).join(', ')}${out.length > 4 ? ' …' : ''}${a20}. 32-byte lines.` : 'all memory is cacheable (KEN# low). 32-byte lines.';
  }
  // Two hex rows make one 32-byte line. The left bar: the line is in the L1 code cache; the middle
  // bar: in the L1 data cache (its MESI state); the right bar (striped): in the L2 (its MESI state).
  markCache686() {
    const c = this.app.machine.cpu, D = c.dcache, L2 = c.l2;
    if (!D || !L2 || !this.clEls.length) return;
    if (!this.clKeys) this.clKeys = new Array(16).fill('');
    const b = this.base, L = this.lastCache, last = L ? (L.phys >>> 0) & ~31 : -1, L2e = this.lastL2, last2 = L2e ? (L2e.phys >>> 0) & ~31 : -1;
    const MESI = ['I', 'S', 'E', 'M'], NAME = { M: 'M (modified)', E: 'E (exclusive)', S: 'S (shared)' };
    for (let r = 0; r < 16; r++) {
      const a = (b + r * 16) >>> 0, line = a & ~31;
      const ic = c.iFind(a), dc = c.dFind(a), l2 = c.l2Find(a);
      const st = dc >= 0 ? MESI[D.state[dc]] : '', s2 = l2 >= 0 ? MESI[L2.state[l2]] : '';
      const any = ic >= 0 || dc >= 0 || l2 >= 0;
      const nc = !any && this.noCache586(a);
      const isLast = any && (line === last || line === last2);
      const key = `${line}|${ic}|${dc}|${st}|${l2}|${s2}|${nc ? 1 : 0}|${isLast ? 1 : 0}`;
      if (this.clKeys[r] === key) continue;
      this.clKeys[r] = key;
      const el = this.clEls[r], ch = el.children;
      if (ch.length < 3) continue;
      el.className = 'mv-clm' + (isLast ? ' last' : '');
      ch[0].className = ic >= 0 ? 'c' : nc ? 'nc' : '';
      ch[1].className = st && st !== 'I' ? st : nc ? 'nc' : '';
      ch[2].className = s2 && s2 !== 'I' ? 'l2 ' + s2 : nc ? 'nc' : '';
      const lt = `line ${hex(line, 8)}`;
      el.title = nc ? `${lt}: not cacheable (KEN# is high)`
        : !any ? `${lt}: not in a cache`
          : `${lt}: ` + [ic >= 0 ? `L1 code set ${hex2(ic >> 2)} way ${ic & 3}` : '', dc >= 0 ? `L1 data set ${hex2(dc >> 1)} way ${dc & 1}, state ${NAME[st] || st}` : '',
            l2 >= 0 ? `L2 set ${hex(l2 >> 2, 3)} way ${l2 & 3}, state ${NAME[s2] || s2}` : ''].filter(Boolean).join(' · ');
      const row = this.rowEls[r].classList, tint = st && st !== 'I' ? st : ic >= 0 ? 'C' : s2 && s2 !== 'I' ? 'L' : '';
      for (const k of ['M', 'E', 'S', 'C', 'L']) row.toggle('mv-l' + k, k === tint);
    }
  }
  updateCache686() {
    const c = this.app.machine.cpu, D = c.dcache, I = c.icache, L2 = c.l2;
    if (!this.cstEl || !D || !I || !L2) return;
    const cr0 = c.cr[0] >>> 0, cd = (cr0 >>> 30) & 1, nw = (cr0 >>> 29) & 1;
    const n = [0, 0, 0, 0], n2 = [0, 0, 0, 0];
    let iv = 0, sum = 0;
    for (let i = 0; i < 256; i++) {
      const dt = D.tag[i], it = I.tag[i], st = dt >= 0 ? D.state[i] : 0;
      n[st]++;
      if (it >= 0) iv++;
      sum = (Math.imul(sum, 31) + (dt ^ (st << 29))) | 0;
      sum = (Math.imul(sum, 31) + it) | 0;
    }
    const T2 = L2.tag, S2 = L2.state;
    for (let i = 0; i < 8192; i++) {
      const st = T2[i] >= 0 ? S2[i] : 0;
      n2[st]++;
      if (st) sum = (Math.imul(sum, 31) + (T2[i] ^ (st << 29) ^ i)) | 0;
    }
    const f = v => v.toLocaleString('en-US');
    const html = `<b class="${cd ? 'off' : ''}">${cd ? 'off' : 'on'}</b> · CD ${cd} NW ${nw} · lines: code ${iv} · data ${256 - n[0]} · L2 ${f(8192 - n2[0])}`;
    if (html !== this.cstHtml) { this.cstHtml = html; this.cstEl.innerHTML = html; }
    const vals = [[I.stats.hits, I.stats.misses, I.stats.fills, -1], [D.stats.hits, D.stats.misses, D.stats.fills, D.stats.writeBacks],
      [L2.stats.hits, L2.stats.misses, L2.stats.fills, L2.stats.writeBacks]];
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 4; k++) {
        const t = vals[r][k] < 0 ? '—' : f(vals[r][k]), el = this.c5Rows[r][k];
        if (el.textContent !== t) el.textContent = t;
      }
    }
    for (const [els, cnt] of [[this.mesiEls, n], [this.mesiL2, n2]]) {
      const mc = [cnt[3], cnt[2], cnt[1], cnt[0]];
      for (let k = 0; k < 4; k++) { const t = f(mc[k]); if (els[k].textContent !== t) els[k].textContent = t; }
    }
    const now = animNow();
    if (!this.ncRanges || now - this.ncT > 2000) {
      this.ncT = now;
      const t = this.ncText();
      if (t !== this.ncRanges) { this.ncRanges = t; this.ncEl.textContent = t; }
    }
    // the line map: the L1 code cache (64 sets, 4 ways), the L1 data cache (128 sets, 2 ways), the L2 (2048 sets, 4 ways)
    const cv = this.cacheCv, w = cv.clientWidth, h = 44;
    if (!w) return;
    const L = this.lastCache, L2e = this.lastL2;
    const key = `${w}|${this.base}|${L ? L.phys + ':' + L.set + ':' + L.cache + ':' + L.hit : ''}|${L2e ? L2e.phys + ':' + L2e.hit : ''}|${sum}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = this.cacheCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const x0 = 14, W = w - x0;
    ctx.font = `600 8.5px ${(getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace').trim()}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const stCol = [THEME.faint, THEME.cyan, THEME.phosphor, THEME.magenta];
    // [label, colour of the label, sets, ways, y0, row height, tag array, state array or null, line address]
    const strips = [['C', THEME.lavender, 64, 4, 1, 2.6, I.tag, null, i => c.iLineAddr(I.tag[i], i)],
      ['D', THEME.cyan, 128, 2, 13.5, 4.5, D.tag, D.state, i => c.lineAddr(D.tag[i], i)],
      ['L2', THEME.gold, 2048, 4, 25.5, 4.4, T2, S2, i => c.l2LineAddr(T2[i], i)]];
    for (const [lab, lc, sets, ways, y0, rh, T, S, la] of strips) {
      ctx.fillStyle = lc; ctx.fillText(lab, 0, y0 + ways * rh / 2);
      ctx.fillStyle = MemoryView.mix(THEME.void, THEME.panel2, 0.8);
      ctx.fillRect(x0, y0, W, ways * rh + 0.5);
      const cw = W / sets;
      for (let i = 0; i < sets * ways; i++) {
        if (T[i] < 0) continue;
        const a = la(i), inWin = a + 32 > this.base && a < this.base + 256;
        const col = S ? stCol[S[i]] : THEME.lavender;
        ctx.fillStyle = MemoryView.rgba(col, inWin ? 1 : 0.55);
        const set = Math.floor(i / ways), way = i % ways;
        ctx.fillRect(x0 + set * cw + (cw > 2 ? 0.2 : 0), y0 + way * rh + 0.3, Math.max(0.8, cw - (cw > 2 ? 0.4 : 0)), rh - 0.6);
      }
    }
    const mark = (e, sets, ways, y0, rh) => {
      if (!e || e.set < 0) return;
      const cw = W / sets;
      ctx.strokeStyle = e.hit ? THEME.phosphor : THEME.goldHi;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x0 + e.set * cw - 1, y0 - 0.5, Math.max(3, cw + 2), ways * rh + 1.5);
    };
    if (L) { if (L.cache === 'code' || L.code) mark(L, 64, 4, 1, 2.6); else mark(L, 128, 2, 13.5, 4.5); }
    mark(L2e, 2048, 4, 25.5, 4.4);
  }

  // ---------- 80286: A20, mode, descriptor tables ----------
  updateModel() {
    const m = this.app.machine, c = m.cpu, pm = this.pm();
    const a20 = m.a20 !== false;
    const t = m.a20 === undefined ? 'A20 ?' : a20 ? 'A20 on · HMA open' : 'A20 off · wraps at 1 MB';
    if (this.a20El.textContent !== t) { this.a20El.textContent = t; this.a20El.className = 'mv-pill ' + (a20 ? 'on' : 'off'); }
    const pt = this.m386 && c.vm ? 'virtual-8086 · CPL 3' : pm ? `protected · CPL ${c.cpl || 0}` : 'real mode';
    if (this.pmEl.textContent !== pt) { this.pmEl.textContent = pt; this.pmEl.className = 'mv-pill' + (pm ? ' pm' : ''); }
    if (pm !== this.wasPM) {
      this.wasPM = pm;
      for (const id of ['gdt', 'idt']) this.modeBtns[id].hidden = !pm;
      if (!pm && (this.mode === 'gdt' || this.mode === 'idt')) this.setMode('code');
      this.ivtWrap.hidden = pm;
      this.dtEl.hidden = !pm;
      this.dtKey = '';
    }
    const it = this.ivtBase();
    const it2 = `Interrupt vectors · ${hex(it, 6)}`;
    if (this.ivtTitle.textContent !== it2 && this.m286) this.ivtTitle.textContent = it2;
    if (pm && this.dtTab !== 'pages') this.updateDt();
    if (this.m386) {
      const pg = !!c.paging;
      const t = (pg ? 'paging on' : 'paging off') + (this.m586 && (c.cr[4] & 0x10) ? ' · PSE 4 MB' : '') + (this.m686 && (c.cr[4] & 0x80) ? ' · PGE' : '');
      if (this.pgPill.textContent !== t) { this.pgPill.textContent = t; this.pgPill.className = 'mv-pill' + (pg ? ' pm' : ''); }
      if (pg !== this.wasPG) {
        // paging goes on: show the pages; paging goes off: back to the caches
        this.wasPG = pg;
        this.dtBtns.pages.hidden = !pg;
        if (pg) this.selectDt('pages');
        else if (this.dtTab === 'pages') this.selectDt('seg');
      }
      if (pg && this.dtTab === 'pages') { if (this.m586) this.updatePages586(); else this.updatePages(); }
    }
    if (this.exc && animNow() > this.exc.until) { this.exc = null; this.excEl.classList.remove('on'); }
  }
  // The pages in use: CS:EIP, SS:ESP, DS:ESI, ES:EDI and the other TLB entries, sorted by linear page.
  updatePages() {
    const c = this.app.machine.cpu, now = animNow(), esc = MemoryView.esc;
    for (const [k, h] of this.pgHot) if (now > h.until) this.pgHot.delete(k);
    const pages = new Map();
    const use = (lin, why) => {
      const p = (lin >>> 12) >>> 0;
      const x = pages.get(p) || { p, why: [] };
      if (why && !x.why.includes(why)) x.why.push(why);
      pages.set(p, x);
    };
    const lin = (s, off) => (c.cache[s].base + (c.cache[s].big ? off >>> 0 : off & 0xFFFF)) >>> 0;
    use(lin(1, c.ip), 'code');
    use(lin(2, c.regs32[4]), 'stack');
    use(lin(3, c.regs32[6]), 'DS:ESI');
    use(lin(0, c.regs32[7]), 'ES:EDI');
    if (this.lastEA && this.lastEA.lin !== undefined) use(this.lastEA.lin, 'last data');
    for (const e of c.tlb || []) if (e.valid) use(e.lin, '');
    const list = [...pages.values()].sort((a, b) => a.p - b.p).slice(0, 24);
    let html = '';
    for (const x of list) {
      const la = x.p * 4096, e = c.tlbFind ? c.tlbFind(la) : null;
      let frame = -1, flags = 0;
      if (e) { frame = e.phys >>> 12; flags = e.flags; }
      else { const w = this.pte(la); if (w.pte & 1) { frame = w.pte >>> 12; flags = w.pte & w.pde & 6 | (w.pte & 0x60); } }
      const f = frame < 0 ? 'not present' : `${flags & 2 ? 'RW' : 'RO'} ${flags & 4 ? 'U' : 'S'}${flags & 0x40 ? ' D' : ''}${e ? ' · TLB' : ''}`;
      const hot = this.pgHot.get(x.p);
      const why = x.why.join(', ');
      html += `<li class="${hot ? 'hot' : ''}${frame < 0 ? ' np' : ''}"><button type="button" data-a="${frame < 0 ? 0 : frame * 4096}" data-why="page ${hex(x.p, 5)}" ` +
        `title="linear ${hex(la, 8)} → ${frame < 0 ? 'not present' : 'physical ' + hex(frame * 4096, 8)}"><b>${hex(x.p, 5)}</b><i>→</i><span>${frame < 0 ? '-----' : hex(frame, 5)}</span><em>${esc(why ? why + ' · ' + f : f)}</em></button></li>`;
    }
    const st = c.tlbStats || { hits: 0, misses: 0 };
    const note = `CR3 ${hex(c.cr[3], 8)} · 4 KB pages · TLB hits ${st.hits.toLocaleString('en-US')}, misses ${st.misses.toLocaleString('en-US')}`;
    const key = html + note;
    if (key === this.pgKey) return;
    this.pgKey = key;
    this.pgList.innerHTML = html;
    this.pgNote.textContent = note;
  }
  // Pentium: the same list with 4 MB pages. A linear address in a 4 MB page (a PDE with PS = 1
  // and CR4.PSE = 1) gives one row for the whole 4 MB page: the linear page and the frame are
  // the top 10 bits (shown as page numbers, the low 10 bits are 0). The 4 MB TLB and the code
  // TLB entries go into the list too.
  updatePages586() {
    const c = this.app.machine.cpu, now = animNow(), esc = MemoryView.esc, pge = !!(c.cr[4] & 0x80);
    for (const [k, h] of this.pgHot) if (now > h.until) this.pgHot.delete(k);
    const pdes = new Map(), pages = new Map();
    const pdeOf = lin => {
      const d = lin >>> 22;
      if (!pdes.has(d)) pdes.set(d, this.pte((d << 22) >>> 0).pde);
      return pdes.get(d);
    };
    const use = (lin, why) => {
      lin >>>= 0;
      const big = this.bigPde(pdeOf(lin)), p = big ? (lin & 0xFFC00000) >>> 12 : lin >>> 12;
      const x = pages.get(p) || { p, big, why: [] };
      if (why && !x.why.includes(why)) x.why.push(why);
      pages.set(p, x);
    };
    const lin = (s, off) => (c.cache[s].base + (c.cache[s].big ? off >>> 0 : off & 0xFFFF)) >>> 0;
    use(lin(1, c.ip), 'code');
    use(lin(2, c.regs32[4]), 'stack');
    use(lin(3, c.regs32[6]), 'DS:ESI');
    use(lin(0, c.regs32[7]), 'ES:EDI');
    if (this.lastEA && this.lastEA.lin !== undefined) use(this.lastEA.lin, 'last data');
    for (const e of c.tlb4m || []) if (e.valid) use(e.lin, '');
    // the named pages first, then the TLB entries, at most 24 rows
    const named = [...pages.values()];
    for (const T of [c.tlb || [], c.itlb || []]) for (const e of T) if (e.valid && pages.size < 40) use(e.lin, '');
    const list = named.concat([...pages.values()].filter(x => !named.includes(x))).slice(0, 24).sort((a, b) => a.p - b.p);
    let html = '';
    for (const x of list) {
      const la = x.p * 4096;
      let frame = -1, flags = 0, inTlb = false;
      if (x.big) {
        const pde = pdeOf(la);
        frame = (pde & 0xFFC00000) >>> 12; flags = pde & 0x166;
        inTlb = !!(c.tlb4mFind && c.tlb4mFind(la));
      } else {
        const e = (c.tlbFind && c.tlbFind(la)) || (c.itlbFind && c.itlbFind(la));
        if (e) { frame = e.phys >>> 12; flags = e.flags; inTlb = true; }
        else { const w = this.pte(la); if (w.pte & 1) { frame = w.pte >>> 12; flags = w.pte & w.pde & 6 | (w.pte & 0x160); } }
      }
      const glob = this.m686 && pge && frame >= 0 && !!(flags & 0x100);
      const f = frame < 0 ? 'not present' : `${x.big ? '4 MB · ' : ''}${flags & 2 ? 'RW' : 'RO'} ${flags & 4 ? 'U' : 'S'}${flags & 0x40 ? ' D' : ''}${glob ? ' G' : ''}${inTlb ? ' · TLB' : ''}`;
      const hot = this.pgHot.get(x.p);
      const why = x.why.join(', ');
      const size = x.big ? 0x400000 : 0x1000;
      html += `<li class="${hot ? 'hot' : ''}${frame < 0 ? ' np' : ''}${x.big ? ' big' : ''}${glob ? ' glob' : ''}"><button type="button" data-a="${frame < 0 ? 0 : frame * 4096}" data-why="${x.big ? '4 MB page' : 'page'} ${hex(x.p, 5)}" ` +
        `title="linear ${hex(la, 8)}–${hex(la + size - 1, 8)} → ${frame < 0 ? 'not present' : 'physical ' + hex(frame * 4096, 8) + (x.big ? ' (a 4 MB page: frame = PDE bits 31–22, offset = linear bits 21–0)' : '') + (glob ? ' · global page (G = 1): its TLB entry stays when CR3 changes' : '')}"><b>${hex(x.p, 5)}</b><i>→</i><span>${frame < 0 ? '-----' : hex(frame, 5)}</span><em>${esc(why ? why + ' · ' + f : f)}</em></button></li>`;
    }
    const st = c.tlbStats || { hits: 0, misses: 0, bigHits: 0 }, cnt = T => (T || []).reduce((n, e) => n + (e.valid ? 1 : 0), 0);
    const pse = !!(c.cr[4] & 0x10);
    const gcnt = T => (T || []).reduce((n, e) => n + (e.valid && (e.flags & 0x100) ? 1 : 0), 0);
    const note = `CR3 ${hex(c.cr[3], 8)} · CR4.PSE ${pse ? '1: 4 KB and 4 MB pages' : '0: 4 KB pages'}` +
      (this.m686 ? ` · CR4.PGE ${pge ? '1: G pages stay in the TLB at MOV CR3 (' + (gcnt(c.tlb) + gcnt(c.tlb4m) + gcnt(c.itlb)) + ' global entries)' : '0: no global pages'}` : '') +
      ` · TLB hits ${st.hits.toLocaleString('en-US')}` +
      ` (4 MB ${(st.bigHits || 0).toLocaleString('en-US')}), misses ${st.misses.toLocaleString('en-US')} · data TLB ${cnt(c.tlb)}/64, 4 MB TLB ${cnt(c.tlb4m)}/8, code TLB ${cnt(c.itlb)}/32`;
    const key = html + note;
    if (key === this.pgKey) return;
    this.pgKey = key;
    this.pgList.innerHTML = html;
    this.pgNote.textContent = note;
  }
  showExc(e) {
    const fp = this.m486 || this.m586 ? 'FPU' : this.m386 ? '80387' : '80287';
    const names = { 0: '#DE divide error', 1: '#DB debug', 3: '#BP breakpoint', 4: '#OF overflow', 5: '#BR bound', 6: '#UD invalid opcode', 7: '#NM no ' + fp,
      8: '#DF double fault', 10: '#TS invalid TSS', 11: '#NP not present', 12: '#SS stack fault', 13: '#GP general protection', 14: '#PF page fault', 16: '#MF ' + fp + ' error' };
    const n = e.name ? `${e.name}${names[e.vec] ? names[e.vec].slice(names[e.vec].indexOf(' ')) : ''}` : (names[e.vec] || `INT ${hex2(e.vec)}h`);
    this.exc = { until: animNow() + 5000 };
    this.excEl.textContent = `exception ${n} · vector ${hex2(e.vec)}h${e.err !== undefined && e.err !== null ? ' · error code ' + hex4(e.err) : ''}` +
      (this.m386 && e.vec === 14 ? ` · CR2 ${hex(this.app.machine.cpu.cr[2], 8)}` : '');
    this.excEl.classList.add('on');
  }
  static descType(acc) {
    acc = acc || 0;
    const S = (acc >> 4) & 1, ty = acc & 15;
    let t;
    if (S) t = ty & 8 ? `code${ty & 2 ? ' R' : ''}${ty & 4 ? ' C' : ''}` : `data${ty & 2 ? ' RW' : ' R'}${ty & 4 ? ' ED' : ''}`;
    else t = ['invalid', 'TSS', 'LDT', 'TSS busy', 'call gate', 'task gate', 'int gate', 'trap gate'][ty & 7];
    return { P: (acc >> 7) & 1, dpl: (acc >> 5) & 3, S, t, gate: !S && (ty & 7) >= 4 };
  }
  readDesc(a) {
    const m = this.app.machine, top = this.memTop();
    const b = m.peek8 ? i => m.peek8((a + i) % top) : i => m.mem[(a + i) % top];
    return { w0: b(0) | (b(1) << 8), w1: b(2) | (b(3) << 8), base: b(2) | (b(3) << 8) | (b(4) << 16), wc: b(4), acc: b(5),
      fl: b(6), base32: (b(2) | (b(3) << 8) | (b(4) << 16) | (b(7) << 24)) >>> 0 };
  }
  updateDt() {
    const c = this.app.machine.cpu, now = animNow();
    for (const [k, t] of this.dtHot) if (now > t) this.dtHot.delete(k);
    const tab = this.dtTab, rows = [];
    const esc = MemoryView.esc;
    const row = (key, a, why, b, span, i, em, np) =>
      `<li class="${this.dtHot.has(key) ? 'hot' : ''}${np ? ' np' : ''}"><button type="button" data-a="${a}" data-why="${esc(why)}"><b>${b}</b><span>${span}</span><i>${i}</i><em>${esc(em)}</em></button></li>`;
    let note = '';
    if (tab === 'seg' && this.m386) {
      for (let i = 0; i < 6; i++) {
        const d = c.cache[i], ty = MemoryView.descType(d.access), p = this.linPhys(d.base);
        rows.push(row('seg:' + MV_SREG[i], p < 0 ? 0 : p, `${MV_SREG[i]} base`, `${MV_SREG[i]} ${hex4(c.sregs[i])}`, hex(d.base, 8), hex(d.limit, 8),
          `${ty.t}${d.big ? ' 32' : ''} · DPL ${ty.dpl}${ty.P ? '' : ' · not present'}`, !ty.P));
      }
      if (c.ldtr) rows.push(row('ldtr', this.linPhys(c.ldtr.base || 0), 'LDT', `LDTR ${hex4(c.ldtr.sel || 0)}`, hex(c.ldtr.base || 0, 8), hex(c.ldtr.limit || 0, 8), 'local descriptor table'));
      if (c.tr) rows.push(row('tr', this.linPhys(c.tr.base || 0), 'TSS', `TR ${hex4(c.tr.sel || 0)}`, hex(c.tr.base || 0, 8), hex(c.tr.limit || 0, 8), 'task state segment'));
      note = 'sel · base · limit · type. The six caches hold the descriptors (32-bit base, limit with G).';
    } else if (tab === 'seg') {
      for (let i = 0; i < 4; i++) {
        const d = c.cache && c.cache[i] ? c.cache[i] : { sel: c.sregs[i], base: c.sregs[i] << 4, limit: 0xFFFF, access: 0 };
        const ty = MemoryView.descType(d.access);
        rows.push(row('seg:' + MV_SREG[i], d.base & 0xFFFFFF, `${MV_SREG[i]} base`, `${MV_SREG[i]} ${hex4(c.sregs[i])}`, hex(d.base, 6), hex4(d.limit), `${ty.t} · DPL ${ty.dpl}${ty.P ? '' : ' · not present'}`, !ty.P));
      }
      if (c.ldtr) rows.push(row('ldtr', c.ldtr.base & 0xFFFFFF, 'LDT', `LDTR ${hex4(c.ldtr.sel || 0)}`, hex(c.ldtr.base || 0, 6), hex4(c.ldtr.limit || 0), 'local descriptor table'));
      if (c.tr) rows.push(row('tr', c.tr.base & 0xFFFFFF, 'TSS', `TR ${hex4(c.tr.sel || 0)}`, hex(c.tr.base || 0, 6), hex4(c.tr.limit || 0), 'task state segment'));
      note = 'sel · base · limit · type. The caches hold the descriptor, so a segment register read needs no table access.';
    } else {
      const t = tab === 'GDT' ? c.gdtr : tab === 'IDT' ? c.idtr : c.ldtr;
      if (!t || !(t.limit >= 7)) note = `${tab} is empty.`;
      else {
        const n = Math.min(Math.floor((t.limit + 1) / 8), 64);
        for (let k = 0; k < n; k++) {
          let a = (t.base + k * 8) & (this.memTop() - 1);
          if (this.m386) { const p = this.linPhys((t.base + k * 8) >>> 0); a = p < 0 ? a : p; }
          const d = this.readDesc(a), ty = MemoryView.descType(d.acc);
          const key = tab + ':' + k;
          if (tab === 'IDT' || ty.gate) {
            rows.push(row(key, a, `${tab}[${k}]`, tab === 'IDT' ? hex2(k) + 'h' : hex4(k * 8), `${hex4(d.w1)}:`, hex4(d.w0), `${ty.t} · DPL ${ty.dpl}${ty.P ? '' : ' · NP'}`, !ty.P));
          } else {
            if (this.m386) {
              const lim = ((d.w0 | ((d.fl & 15) << 16)) * (d.fl & 0x80 ? 4096 : 1) + (d.fl & 0x80 ? 4095 : 0)) >>> 0;
              rows.push(row(key, a, `${tab}[${k}]`, hex4(k * 8 | (tab === 'LDT' ? 4 : 0)), hex(d.base32, 8), hex(lim, 8), k === 0 && tab === 'GDT' ? 'null descriptor' : `${ty.t}${d.fl & 0x40 ? ' 32' : ''} · DPL ${ty.dpl}${ty.P ? '' : ' · NP'}`, !ty.P || (k === 0 && tab === 'GDT')));
            } else rows.push(row(key, a, `${tab}[${k}]`, hex4(k * 8 | (tab === 'LDT' ? 4 : 0)), hex(d.base, 6), hex4(d.w0), k === 0 && tab === 'GDT' ? 'null descriptor' : `${ty.t} · DPL ${ty.dpl}${ty.P ? '' : ' · NP'}`, !ty.P || (k === 0 && tab === 'GDT')));
          }
        }
        note = `${tab} base ${hex(t.base, this.m386 ? 8 : 6)} · limit ${hex4(t.limit)}${Math.floor((t.limit + 1) / 8) > 64 ? ' · first 64 shown' : ''}`;
      }
    }
    const html = rows.join('');
    const key = tab + html + note;
    if (key === this.dtKey) return;
    this.dtKey = key;
    this.dtList.innerHTML = html;
    this.dtNote.textContent = note;
  }

  selectDt(id) {
    this.dtTab = id;
    for (const k in this.dtBtns) this.dtBtns[k].setAttribute('aria-pressed', k === id ? 'true' : 'false');
    const pages = id === 'pages';
    this.dtList.hidden = pages;
    this.dtNote.hidden = pages;
    if (this.pgEl) this.pgEl.hidden = !pages;
    this.dtKey = '';
    this.pgKey = '';
    if (pages) { if (this.m586) this.updatePages586(); else this.updatePages(); } else this.updateDt();
  }
  // ---------- IVT ----------
  updateIvt() {
    const mem = this.app.machine.mem, ib = this.ivtBase();
    for (const [v, it] of this.ivtItems) {
      const a = ib + v * 4;
      const t = `${hex4(mem[a + 2] | (mem[a + 3] << 8))}:${hex4(mem[a] | (mem[a + 1] << 8))}`;
      if (t !== it.text) { it.text = t; it.val.textContent = t; }
    }
  }
  hotIvt(v, cls) {
    const it = this.ivtItems.get(v);
    if (!it) return;
    const old = this.ivtHot.get(v);
    if (old && old.cls !== cls) old.li.classList.remove(old.cls);
    it.li.classList.add(cls);
    this.ivtHot.set(v, { li: it.li, cls, until: animNow() + (cls === 'mv-hot' ? 1600 : 900) });
  }

  // ---------- layout ----------
  measureOcc() {
    this.occT = animNow();
    const doc = this.host.ownerDocument, crt = doc.getElementById('crt');
    let occ = null;
    if (crt) {
      let el = crt, best = null;
      while (el && el !== doc.body) {
        if (el.contains(this.host)) break;
        const pos = getComputedStyle(el).position;
        if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') best = el;
        el = el.parentElement;
      }
      if (best) {
        const a = best.getBoundingClientRect(), b = this.host.getBoundingClientRect();
        const x0 = Math.max(a.left, b.left), x1 = Math.min(a.right, b.right), y0 = Math.max(a.top, b.top), y1 = Math.min(a.bottom, b.bottom);
        if (x1 - x0 > 40 && y1 - y0 > 30 && x1 >= b.right - 40) occ = { x: x0 - b.left, y: y0 - b.top, w: x1 - x0, h: y1 - y0 };
      }
    }
    const key = occ ? [occ.x, occ.y, occ.w, occ.h].map(Math.round).join() : '';
    const changed = key !== this.occKey;
    this.occKey = key;
    this.occ = occ;
    return changed;
  }

  layout() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const tall = w < 640 || h > w * 1.05;
    this.root.classList.toggle('mv-tall', tall);
    this.vertical = !tall;
    const boxes = [this.headEl, this.mapEl, this.hexEl, this.ivtEl];
    const put = (el, x, y, bw, bh) => Object.assign(el.style, { left: x + 'px', top: y + 'px', width: Math.max(0, bw) + 'px', height: bh === null ? '' : Math.max(0, bh) + 'px' });
    if (tall) {
      for (const el of boxes) Object.assign(el.style, { left: '', top: '', width: '', height: '' });
      const cw = w - 24;
      this.mapEl.style.height = '92px';
      this.ivtEl.classList.toggle('mv-ivt-cols', cw >= 500);
      this.ivtEl.classList.remove('mv-ivt2');
      this.root.classList.toggle('mv-compact', cw < 560);
      this.setCompactCalc(false);
      this.sizeHex(cw - 22, 1e4);
      this.sizeCanvas(cw, 92);
      return;
    }
    const pad = 12, bottom = 56;
    const mapW = Math.round(clamp(w * 0.19, 170, 230));
    const x1 = pad + mapW + pad;
    const o = this.occ;
    const occ = o && o.x > x1 + 300 && o.y < 60 ? o : null;
    put(this.mapEl, pad, pad, mapW, h - pad - bottom);
    this.sizeCanvas(mapW, h - pad - bottom);
    let hexX, hexW, ivtBox;
    if (occ) {
      // Column left of the monitor: header + hex window. Under the monitor: vectors.
      hexX = x1; hexW = occ.x - 12 - x1;
      const x3 = occ.x, y3 = occ.y + occ.h + 10;
      if (h - bottom - y3 >= 96) ivtBox = { x: x3, y: y3, w: w - pad - x3, h: h - bottom - y3, cols: w - pad - x3 > 470, two: h - bottom - y3 < 236 };
    } else {
      const ivtW = Math.round(clamp(w * 0.22, 200, 250));
      hexX = x1; hexW = w - pad - x1 - ivtW - pad;
      ivtBox = { x: x1 + hexW + pad, y: 0, w: ivtW, h: 0, cols: false };
    }
    this.root.classList.toggle('mv-compact', (occ ? hexW : w - x1) < 620);
    put(this.headEl, x1, pad, occ ? hexW : w - pad - x1, null);
    const hy = pad + this.headEl.offsetHeight + 10;
    if (!ivtBox) {
      // no room anywhere else: vectors under the hex window
      ivtBox = { x: hexX, y: 0, w: hexW, h: 0, cols: true, below: true };
    }
    this.ivtEl.classList.toggle('mv-ivt-cols', !!ivtBox.cols && !ivtBox.two);
    this.ivtEl.classList.toggle('mv-ivt2', !!ivtBox.two && !ivtBox.cols);
    let hexH = h - bottom - hy;
    if (ivtBox.below) {
      put(this.ivtEl, hexX, 0, hexW, null);
      const ih = this.ivtEl.offsetHeight;
      hexH -= ih + 10;
      this.ivtEl.style.top = (hy + hexH + 10) + 'px';
    } else if (occ) put(this.ivtEl, ivtBox.x, ivtBox.y, ivtBox.w, ivtBox.h);
    else put(this.ivtEl, ivtBox.x, hy, ivtBox.w, null);
    this.ivtEl.style.overflow = 'auto';
    put(this.hexEl, hexX, hy, hexW, hexH);
    // The stacked sum needs about 64 px; use the one-line form when the bytes would get small.
    const fsStack = (hexH - 64 - 8 - 44) / (17 * 1.5);
    this.setCompactCalc(fsStack < 11.5);
    const calcH = this.compactCalc ? 34 : 64;
    this.sizeHex(hexW - 22, hexH - calcH - 8 - 44);
  }
  setCompactCalc(on) {
    if (on === this.compactCalc) return;
    this.compactCalc = on;
    this.calcKey = '';
    this.calcEl.classList.toggle('mv-calc1', on);
  }
  sizeHex(wAvail, hAvail) {
    const fsH = hAvail / (17 * 1.5), xc = this.m586 ? 0.8 : 0;   // Pentium: a wider column for the two cache bars
    let fs = Math.min(wAvail / ((69 + xc) * 0.6), fsH);
    let noAsc = false;
    if (fs < 11 && Math.min(wAvail / ((51.5 + xc) * 0.6), fsH) > fs + 0.8) { noAsc = true; fs = Math.min(wAvail / ((51.5 + xc) * 0.6), fsH); }
    this.root.classList.toggle('mv-noasc', noAsc);
    this.hexGrid.style.setProperty('--mv-fs', clamp(fs, 8.5, 15).toFixed(1) + 'px');
  }
  sizeCanvas(cw, ch) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = cw; this.ch = ch;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.canvas.style.height = ch + 'px';
    this.dpr = dpr;
    // scale positions along the bar
    let L = this.vertical ? ch - 30 : cw - 16;
    const s0 = this.vertical ? 18 : 14;
    if (!this.vertical) L -= 6;
    const gap = 2;
    const tw = this.regions.reduce((t, r) => t + r.w, 0);
    const avail = L - gap * (this.regions.length - 1);
    let s = s0;
    this.segs = this.regions.map(r => {
      const len = avail * r.w / tw;
      const seg = { ...r, s0: s, s1: s + len };
      s += len + gap;
      return seg;
    });
    this.mapDirty = true;
  }
  regionOf(a) { return this.regions.find(r => a >= r.a0 && a < r.a1) || this.regions[0]; }
  sOf(a) {
    for (const g of this.segs) if (a >= g.a0 && a < g.a1) return g.s0 + (a - g.a0) / (g.a1 - g.a0) * (g.s1 - g.s0);
    return this.segs[this.segs.length - 1].s1;
  }
  addrAtS(s) {
    for (const g of this.segs) {
      if (s >= g.s0 - 1 && s <= g.s1 + 1) return clamp(Math.floor(g.a0 + (s - g.s0) / (g.s1 - g.s0) * (g.a1 - g.a0)), g.a0, g.a1 - 1);
    }
    return null;
  }

  // ---------- heat and map ----------
  decayHeat() {
    const m = this.app.machine, R = m.heat.read, W = m.heat.write;
    this.sizeHeat();
    const k = 0.93;
    for (let i = 0, n = Math.min(R.length, this.heatR.length); i < n; i++) {
      let d = R[i] - this.prevR[i];
      this.prevR[i] = R[i];
      let v = d > 0 ? Math.min(1, 0.25 + Math.log2(1 + d) / 9) : 0;
      this.heatR[i] = Math.max(this.heatR[i] * k, v);
      d = W[i] - this.prevW[i];
      this.prevW[i] = W[i];
      v = d > 0 ? Math.min(1, 0.3 + Math.log2(1 + d) / 8) : 0;
      this.heatW[i] = Math.max(this.heatW[i] * k, v);
    }
    this.mapDirty = true;
  }

  drawMap() {
    if (!this.segs || !this.shown) return;
    this.mapDirty = false;
    const ctx = this.ctx, dpr = this.dpr, V = this.vertical;
    const W = this.cw, H = this.ch;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const mono = (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace').trim();
    const sans = (getComputedStyle(document.documentElement).getPropertyValue('--sans') || 'sans-serif').trim();
    // geometry: the bar across the other axis
    const barA = V ? 48 : 20, barB = V ? 84 : 50;   // cross-axis extent of the bar
    const mid = (barA + barB) / 2;
    const rect = (s0, s1, c0, c1) => V ? ctx.fillRect(c0, s0, c1 - c0, s1 - s0) : ctx.fillRect(s0, c0, s1 - s0, c1 - c0);
    const mix = MemoryView.mix, V0 = THEME.void;
    const base = { ivt: mix(V0, THEME.magenta, 0.16), bda: mix(V0, THEME.muted, 0.12), ram: mix(V0, THEME.lavender, 0.08), prog: mix(V0, THEME.phosphor, 0.09),
      cga: mix(V0, THEME.phosphor, 0.07), rom: mix(V0, THEME.gold, 0.13), none: mix(V0, THEME.text, 0.03), hma: mix(V0, THEME.lavender, 0.16), xram: mix(V0, THEME.cyan, 0.08) };
    const edge = { ivt: THEME.magenta, bda: THEME.muted, ram: THEME.faint, prog: THEME.phosphor, cga: THEME.phosphor, rom: THEME.gold, none: THEME.line, hma: THEME.lavender, xram: THEME.cyan };
    // title lanes
    ctx.font = `600 9px ${sans}`;
    ctx.fillStyle = THEME.faint;
    ctx.textBaseline = 'middle';
    if (V) {
      ctx.textAlign = 'center';
      ctx.fillStyle = THEME.cyan; ctx.fillText('R', barA + (mid - barA) / 2, 9);
      ctx.fillStyle = THEME.goldHi; ctx.fillText('W', mid + (barB - mid) / 2, 9);
    } else {
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.cyan; ctx.fillText('R', 10, barA + 7);
      ctx.fillStyle = THEME.goldHi; ctx.fillText('W', 10, barB - 7);
    }
    for (const g of this.segs) {
      ctx.fillStyle = base[g.kind];
      rect(g.s0, g.s1, barA, barB);
      if (g.kind === 'none') {
        ctx.strokeStyle = MemoryView.rgba(THEME.faint, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const len = g.s1 - g.s0;
        for (let t = -40; t < len + 40; t += 6) {
          if (V) { ctx.moveTo(barA, g.s0 + t); ctx.lineTo(barB, g.s0 + t + (barB - barA)); }
          else { ctx.moveTo(g.s0 + t, barA); ctx.lineTo(g.s0 + t + (barB - barA), barB); }
        }
        ctx.save();
        ctx.beginPath();
        if (V) ctx.rect(barA, g.s0, barB - barA, len); else ctx.rect(g.s0, barA, len, barB - barA);
        ctx.clip();
        ctx.beginPath();
        for (let t = -40; t < len + 40; t += 6) {
          if (V) { ctx.moveTo(barA, g.s0 + t); ctx.lineTo(barB, g.s0 + t + (barB - barA)); }
          else { ctx.moveTo(g.s0 + t, barA); ctx.lineTo(g.s0 + t + (barB - barA), barB); }
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    // heat: sample the pages under each pixel
    const heatLane = (arr, c0, c1, col) => {
      for (const g of this.segs) {
        if (g.kind === 'none') continue;
        const n = Math.max(1, Math.round(g.s1 - g.s0));
        const p0 = g.a0 >> 8, np = (g.a1 - g.a0) >> 8;
        const vals = new Float32Array(n);
        for (let j = 0; j < n; j++) {
          const pa = p0 + Math.floor(j * np / n), pb = Math.max(pa + 1, p0 + Math.floor((j + 1) * np / n));
          let v = 0;
          for (let p = pa; p < pb; p++) if (arr[p] > v) v = arr[p];
          vals[j] = v;
        }
        // a hot page is at least 3 px long, so single pages stay visible
        for (let j = 0; j < n; j++) {
          const v = Math.max(vals[j], j ? vals[j - 1] * 0.8 : 0, j < n - 1 ? vals[j + 1] * 0.8 : 0);
          if (v < 0.02) continue;
          ctx.fillStyle = MemoryView.rgba(col, Math.min(1, 0.18 + v * 0.82));
          rect(g.s0 + j * (g.s1 - g.s0) / n, g.s0 + (j + 1) * (g.s1 - g.s0) / n + 0.3, c0, c1);
        }
      }
    };
    heatLane(this.heatR, barA + 1, mid - 0.5, THEME.cyan);
    heatLane(this.heatW, mid + 0.5, barB - 1, THEME.goldHi);
    ctx.fillStyle = MemoryView.rgba(THEME.void, 0.9);
    rect(this.segs[0].s0, this.segs[this.segs.length - 1].s1, mid - 0.5, mid + 0.5);
    const C = this.cacheObj();
    if (C) {
      // 80486: the lines in the cache (bright marks on the middle line) and the range with no KEN#
      ctx.fillStyle = MemoryView.rgba(THEME.magenta, 0.55);
      rect(this.sOf(0xA0000), this.sOf(0xFFFFF) + 1, barB - 2.5, barB);
      ctx.fillStyle = THEME.phosphor;
      for (const l of C.lines) {
        if (!l.valid) continue;
        const sp = this.sOf(l.addr);
        rect(sp - 0.8, sp + 0.8, mid - 2, mid + 2);
      }
    }
    const P5 = this.m586 ? this.app.machine.cpu : null;
    if (P5 && P5.dcache) {
      // Pentium: the range with no KEN# (a dim bar), the code lines (lavender, on the read side of
      // the middle line) and the data lines (the MESI colour, on the write side)
      ctx.fillStyle = MemoryView.rgba(THEME.muted, 0.5);
      rect(this.sOf(0xA0000), this.sOf(0xFFFFF) + 1, barB - 2.5, barB);
      const D = P5.dcache, I = P5.icache, stCol = [THEME.faint, THEME.cyan, THEME.phosphor, THEME.magenta];
      for (let i = 0; i < 256; i++) {
        if (I.tag[i] >= 0) {
          const sp = this.sOf(P5.lineAddr(I.tag[i], i));
          ctx.fillStyle = THEME.lavender;
          rect(sp - 0.8, sp + 0.8, mid - 3, mid);
        }
        if (D.tag[i] >= 0) {
          const sp = this.sOf(P5.lineAddr(D.tag[i], i));
          ctx.fillStyle = stCol[D.state[i]];
          rect(sp - 0.8, sp + 0.8, mid, mid + 3);
        }
      }
    }
    // region edges
    for (const g of this.segs) {
      ctx.fillStyle = MemoryView.rgba(edge[g.kind], g.kind === 'prog' ? 0.9 : 0.55);
      if (V) { ctx.fillRect(barA - 3, g.s0, 2, g.s1 - g.s0); } else ctx.fillRect(g.s0, barA - 3, g.s1 - g.s0, 2);
    }
    // A20 gate off: the HMA is not reachable, real-mode addresses wrap to 000000
    if (this.m286 && this.app.machine.a20 === false) {
      const h = this.segs.find(g => g.kind === 'hma');
      if (h) {
        ctx.fillStyle = MemoryView.rgba(THEME.void, 0.55);
        rect(h.s0, h.s1, barA, barB);
        ctx.strokeStyle = MemoryView.rgba(THEME.magenta, 0.8);
        ctx.lineWidth = 1.3;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        const z = this.segs[0].s0 + 2, hm = (h.s0 + h.s1) / 2;
        if (V) { ctx.moveTo(barA - 2, hm); ctx.bezierCurveTo(4, hm, 4, z, barA - 2, z); }
        else { ctx.moveTo(hm, barA - 2); ctx.bezierCurveTo(hm, 4, z, 4, z, barA - 2); }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // hex window extent
    if (this.base >= 0) {
      const a = this.sOf(this.base), b = Math.max(a + 2, this.sOf(Math.min(this.memTop() - 1, this.base + 255)) + 1);
      // bracket beside the bar: the part of memory the hex window shows
      ctx.strokeStyle = THEME.text;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (V) { ctx.moveTo(barA - 1, a - 1); ctx.lineTo(barA - 6, a - 1); ctx.lineTo(barA - 6, b + 1); ctx.lineTo(barA - 1, b + 1); }
      else { ctx.moveTo(a - 1, barB + 1); ctx.lineTo(a - 1, barB + 5); ctx.lineTo(b + 1, barB + 5); ctx.lineTo(b + 1, barB + 1); }
      ctx.stroke();
    }
    // address labels and region names
    ctx.font = `10px ${mono}`;
    ctx.fillStyle = THEME.muted;
    if (V) {
      ctx.textAlign = 'right';
      let lastY = -99;
      for (const g of this.segs) {
        if (g.s0 - lastY < 11) continue;
        ctx.fillStyle = THEME.faint;
        ctx.fillText(this.hexA(g.a0), barA - 7, g.s0 + 4);
        lastY = g.s0;
      }
      ctx.fillText(this.hexA(this.memTop() - 1), barA - 7, this.segs[this.segs.length - 1].s1 - 4);
      ctx.textAlign = 'left';
      ctx.font = `600 9px ${sans}`;
      for (const g of this.segs) {
        if (g.kind === 'none' || g.s1 - g.s0 < 12) continue;
        ctx.fillStyle = MemoryView.rgba(edge[g.kind], g.kind === 'ram' ? 0.9 : 0.85);
        let label = (g.kind === 'ram' ? 'RAM' : g.name).toUpperCase();
        if (g.kind === 'hma' && this.app.machine.a20 === false) label = 'HMA · A20 OFF';
        ctx.fillText(label, barB + 8, g.kind === 'prog' ? g.s0 + (g.s1 - g.s0) * 0.62 : (g.s0 + g.s1) / 2);
      }
      // reset vector tick
      const rv = this.sOf(0xFFFF0);
      ctx.fillStyle = THEME.gold;
      ctx.fillRect(barB, rv - 0.5, 5, 1);
    } else {
      ctx.textAlign = 'center';
      ctx.font = `600 9px ${sans}`;
      for (const g of this.segs) {
        if (!g.short || g.s1 - g.s0 < 22) continue;
        ctx.fillStyle = MemoryView.rgba(THEME.text, 0.75);
        ctx.fillText(g.short, (g.s0 + g.s1) / 2, barB + 12);
      }
      ctx.font = `9.5px ${mono}`;
      ctx.fillStyle = THEME.faint;
      let lastX = -99;
      for (const g of this.segs) {
        const lbl = this.hexA(g.a0);
        if (g.s0 - lastX < 50) continue;
        ctx.textAlign = g === this.segs[0] ? 'left' : 'center';
        ctx.fillText(lbl, g.s0, barB + 26);
        lastX = g.s0;
      }
    }
    // register markers
    const c = this.app.machine.cpu, S = c.sregs, R = c.regs;
    const cur = this.cur && this.app.mode !== 'fast' ? this.cur : null;
    const e3 = this.m386 ? 'E' : '';
    const marks = [
      { k: `CS:${e3}IP`, a: cur ? cur.phys : this.physOf(1, c.ip), col: THEME.phosphor },
      { k: `SS:${e3}SP`, a: this.physOf(2, this.rOff(4, 2)), col: THEME.goldHi },
      { k: `DS:${e3}SI`, a: this.physOf(3, this.rOff(6, 3)), col: THEME.cyan },
      { k: `ES:${e3}DI`, a: this.physOf(0, this.rOff(7, 0)), col: THEME.lavender },
    ];
    for (const mk of marks) mk.s = this.sOf(mk.a);
    marks.sort((a, b) => a.s - b.s);
    ctx.font = `600 10px ${mono}`;
    if (V) {
      const ph = 15, x0 = barB + 8;
      // place pills without overlap
      let prev = -99;
      for (const mk of marks) { mk.py = Math.max(mk.s, prev + ph + 2); prev = mk.py; }
      const over = prev + ph / 2 - (H - 4);
      if (over > 0) for (let i = marks.length - 1; i >= 0; i--) { marks[i].py -= over; if (i && marks[i - 1].py > marks[i].py - ph - 2) marks[i - 1].py = marks[i].py - ph - 2; }
      for (const mk of marks) {
        ctx.strokeStyle = mk.col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(barB + 1, mk.s); ctx.lineTo(barB + 4, mk.s);
        ctx.lineTo(x0 - 2, mk.py);
        ctx.stroke();
        ctx.fillStyle = mk.col;
        ctx.beginPath(); ctx.moveTo(barB - 1, mk.s); ctx.lineTo(barB + 5, mk.s - 3.5); ctx.lineTo(barB + 5, mk.s + 3.5); ctx.closePath(); ctx.fill();
        ctx.fillRect(barA - 5, mk.s - 0.75, 4, 1.5);
        const label = `${mk.k} ${this.hexA(mk.a)}`;
        const tw = ctx.measureText(label).width + 10;
        const pw = Math.min(tw, W - x0 - 2);
        ctx.fillStyle = MemoryView.rgba(THEME.void, 0.92);
        MemoryView.pill(ctx, x0, mk.py - ph / 2, pw, ph);
        ctx.fill();
        ctx.strokeStyle = MemoryView.rgba(mk.col, 0.7);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = mk.col;
        ctx.textAlign = 'left';
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, mk.py - ph / 2, pw, ph); ctx.clip();
        ctx.fillText(label, x0 + 5, mk.py + 0.5);
        ctx.restore();
      }
    } else {
      const ph = 14;
      ctx.font = `600 9.5px ${mono}`;
      let prev = -99;
      for (const mk of marks) {
        const label = mk.k.split(':')[1];
        mk.tw = ctx.measureText(label).width + 8;
        mk.px = Math.max(mk.s - mk.tw / 2, prev + 2);
        prev = mk.px + mk.tw;
        mk.label = label;
      }
      const over = prev - (W - 2);
      if (over > 0) for (const mk of marks) mk.px -= over * (mk.px / Math.max(1, prev));
      for (const mk of marks) {
        ctx.strokeStyle = mk.col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mk.s, barA - 4); ctx.lineTo(mk.px + mk.tw / 2, ph + 1);
        ctx.stroke();
        ctx.fillStyle = mk.col;
        ctx.beginPath(); ctx.moveTo(mk.s, barA + 1); ctx.lineTo(mk.s - 3.5, barA - 5); ctx.lineTo(mk.s + 3.5, barA - 5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = MemoryView.rgba(THEME.void, 0.92);
        MemoryView.pill(ctx, mk.px, 1, mk.tw, ph);
        ctx.fill();
        ctx.strokeStyle = MemoryView.rgba(mk.col, 0.7); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = mk.col; ctx.textAlign = 'center';
        ctx.fillText(mk.label, mk.px + mk.tw / 2, 1 + ph / 2 + 0.5);
      }
    }
    // hover read-out
    if (this.hoverS !== null) {
      const a = this.addrAtS(this.hoverS);
      if (a !== null) {
        const s = this.hoverS;
        ctx.fillStyle = THEME.text;
        if (V) ctx.fillRect(barA - 6, s - 0.5, barB - barA + 12, 1); else ctx.fillRect(s - 0.5, barA - 6, 1, barB - barA + 12);
        const lbl = `${this.hexA(a & ~0xFF)} ${this.regionOf(a).name}`;
        ctx.font = `10px ${mono}`;
        const tw = ctx.measureText(lbl).width + 10;
        let x = V ? barA - 4 : clamp(s - tw / 2, 0, W - tw), y = V ? s - 22 : barB + 26;
        if (V) { x = clamp(x, 0, W - tw); y = clamp(y, 0, H - 16); }
        ctx.fillStyle = MemoryView.rgba(THEME.panel2, 0.96);
        MemoryView.pill(ctx, x, y, tw, 16);
        ctx.fill();
        ctx.strokeStyle = THEME.line; ctx.stroke();
        ctx.fillStyle = THEME.text; ctx.textAlign = 'left';
        ctx.fillText(lbl, x + 5, y + 8.5);
      }
    }
    const f = this.base >= 0 ? this.base : 0;
    this.canvas.setAttribute('aria-valuenow', String(f));
    this.canvas.setAttribute('aria-valuetext', `${this.hexA(f)} ${this.regionOf(f).name}`);
  }
  static pill(ctx, x, y, w, h) {
    const r = Math.min(h / 2, 7);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  static esc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }
}
