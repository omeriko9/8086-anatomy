// The state dock: registers, flags, 8087 stack, CPU stack and the I/O port log.

const DOCK_REGS = [['AX', 0], ['SI', 6], ['BX', 3], ['DI', 7], ['CX', 1], ['BP', 5], ['DX', 2], ['SP', 4],
  ['CS', 's1'], ['DS', 's3'], ['SS', 's2'], ['ES', 's0'], ['IP', 'ip'], ['FLAGS', 'f']];
// 80386: the 32-bit registers (index in cpu.regs32), the six segment registers, EIP and EFLAGS.
const DOCK_REGS_386 = [['EAX', 0], ['ESI', 6], ['EBX', 3], ['EDI', 7], ['ECX', 1], ['EBP', 5], ['EDX', 2], ['ESP', 4],
  ['CS', 's1'], ['DS', 's3'], ['SS', 's2'], ['ES', 's0'], ['FS', 's4'], ['GS', 's5'], ['EIP', 'ip'], ['EFLAGS', 'f']];
const DOCK_16 = { EAX: 'AX', EBX: 'BX', ECX: 'CX', EDX: 'DX', ESI: 'SI', EDI: 'DI', EBP: 'BP', ESP: 'SP', EIP: 'IP', EFLAGS: 'FLAGS' };
const DOCK_FLAGS = [['OF', 11, 'Overflow'], ['DF', 10, 'Direction'], ['IF', 9, 'Interrupt enable'], ['TF', 8, 'Trap'],
  ['SF', 7, 'Sign'], ['ZF', 6, 'Zero'], ['AF', 4, 'Auxiliary carry'], ['PF', 2, 'Parity'], ['CF', 0, 'Carry']];
const DOCK_FLAGS_386 = [['VM', 17, 'Virtual-8086 mode'], ['RF', 16, 'Resume'], ['NT', 14, 'Nested task'], ['IOPL', 12, 'I/O privilege level (2 bits)'], ...DOCK_FLAGS];
const DOCK_CR0 = [['PE', 0, 'Protection enable'], ['MP', 1, 'Monitor coprocessor'], ['EM', 2, 'Emulate coprocessor'], ['TS', 3, 'Task switched'],
  ['ET', 4, 'Extension type (80387)'], ['PG', 31, 'Paging']];
const DOCK_SREGS = ['ES', 'CS', 'SS', 'DS', 'FS', 'GS'];
// 80486: EFLAGS adds AC and ID; CR0 adds NE, WP, AM, NW and CD (ET is always 1).
const DOCK_FLAGS_486 = [['ID', 21, 'CPUID available'], ['AC', 18, 'Alignment check'], ...DOCK_FLAGS_386];
// Pentium: CR4 (the bits of the P5 core) and the names of the MESI states.
const DOCK_CR4_586 = [['TSD', 2, 'Time stamp disable: RDTSC only at CPL 0'], ['DE', 3, 'Debug extensions: I/O breakpoints, DR4 and DR5 give #UD'],
  ['PSE', 4, 'Page size extension: a PDE with PS = 1 maps a 4 MB page'], ['MCE', 6, 'Machine check enable']];
const DOCK_MESI = ['I', 'S', 'E', 'M'];
// Pentium Pro: CR4 adds PGE (global pages) and PCE (RDPMC at any CPL).
const DOCK_CR4_686 = DOCK_CR4_586.concat([['PGE', 7, 'Page global enable: a TLB entry with G = 1 stays at MOV CR3'],
  ['PCE', 8, 'Performance counter enable: RDPMC works at each CPL']]);
// Pentium Pro: the stall and event counters of cpu.oooStats (the OOO pane).
const DOCK_OOO_STALLS = [['robFull', 'ROB full', 'The RAT waited for a free ROB entry (40 entries)'],
  ['rsFull', 'RS full', 'The RAT waited for a free reservation station entry (20 entries)'],
  ['sbFull', 'store buffer full', 'The RAT waited for a free store buffer entry (12 entries)'],
  ['partial', 'partial register', 'A read of more bytes than the last write (AL, then EAX) waited for the retire of that write'],
  ['ldBlocks', 'load blocked', 'A load waited until an older store was in the cache (the store has fewer bytes than the load)'],
  ['forwards', 'store forward', 'A load got its bytes from an older store in the store buffer (no stall)'],
  ['serial', 'serializing', 'An instruction that waits until all older µops retire (CPUID, MOV CRn, IN, OUT ...)'],
  ['mispredicts', 'wrong prediction', 'A branch with a wrong prediction: the fetch starts again after the branch µop is done'],
  ['baclears', 'decoder redirect', 'The decoder found a taken branch that the BTB did not know and sent the fetch to the target'],
  ['floor', '1-clock floor', 'Steps that the emulator made 1 clock long (the P6 retired more than one instruction in that clock)']];
const DOCK_PORTS = ['0 · ALU shift mul div FPU', '1 · ALU branch', '2 · load', '3 · store address', '4 · store data'];
const DOCK_HOW = { btb: 'BTB', static: 'decoder (static)', rsb: 'return stack' };
const DOCK_BTB_STATE = ['strongly not taken', 'weakly not taken', 'weakly taken', 'strongly taken'];
const DOCK_CR0_486 = [['PE', 0, 'Protection enable'], ['MP', 1, 'Monitor coprocessor'], ['EM', 2, 'Emulate the FPU'], ['TS', 3, 'Task switched'],
  ['ET', 4, 'Extension type (always 1)'], ['NE', 5, 'Numeric error: FPU errors give #MF'], ['WP', 16, 'Write protect: supervisor writes obey read-only pages'],
  ['AM', 18, 'Alignment mask: with EFLAGS.AC, #AC at CPL 3'], ['NW', 29, 'Not write-through'], ['CD', 30, 'Cache disable: no line fills'], ['PG', 31, 'Paging']];

class StateDock {
  constructor(app) {
    this.app = app;
    this.m = app.machine;
    // the 80386 parts need the 80386 core (cpu.regs32)
    this.is386 = !!(app.is386 && this.m.cpu && this.m.cpu.regs32);
    // the 80486 parts: the flags and CR0 bits need a 32-bit core; the cache pane needs cpu.cache486
    // the Pentium parts need the Pentium core (the two caches, the BTB and the pipe counters); with
    // an 80486 core on the Pentium page the dock shows the 80486 parts
    const c0 = this.m.cpu;
    this.is586 = !!(app.is586 && this.is386 && c0.dcache && c0.icache && c0.btb && c0.pipeStats);
    // the Pentium Pro parts need the P6 core (the ROB, the L2 and the out-of-order counters)
    this.is686 = !!(app.is686 && this.is386 && c0.rob && c0.l2 && c0.oooStats && c0.dcache && c0.icache && c0.btb);
    this.p5like = this.is586 || this.is686;
    this.is486 = !!((app.is486 || (app.is586 && !this.is586 && c0.cache486)) && this.is386);
    this.regList = this.is386 ? DOCK_REGS_386 : DOCK_REGS;
    this.radix = storage.get('radix', 0);    // 0 hex, 1 dec, 2 bin
    this.vals = {};
    this.regEls = {};
    const regs = document.getElementById('regs');
    regs.classList.toggle('regs386', this.is386);
    for (const [name, src] of this.regList) {
      const d = htmlEl('div', { class: 'reg' + (typeof src === 'string' && src[0] === 's' ? ' seg' : '') + (name === 'IP' || name === 'EIP' ? ' ip' : '') }, regs);
      htmlEl('b', null, d, name);
      const v = htmlEl('span', null, d, '0000');
      d.title = name === 'FLAGS' ? 'Flags register' : name === 'EFLAGS' ? 'EFLAGS: the 32-bit flags register. The low 16 bits are FLAGS.'
        : DOCK_16[name] ? `${name}: 32-bit register. The bright digits are the low 16 bits, ${DOCK_16[name]}.` : name + ' register';
      this.regEls[name] = { d, v, src, w32: this.is386 && typeof src !== 'string' || name === 'EIP' || name === 'EFLAGS' };
      this.vals[name] = 0;
    }
    this.flagEls = [];
    const fl = document.getElementById('flags');
    const flags = this.is486 || this.p5like ? DOCK_FLAGS_486 : this.is386 ? DOCK_FLAGS_386 : app.is286 ? [['NT', 14, 'Nested task (80286)'], ...DOCK_FLAGS] : DOCK_FLAGS;
    for (const [n, bit, desc] of flags) {
      const el = htmlEl('span', { class: 'flag', title: `${n}: ${desc} flag (bit ${bit}${n === 'IOPL' ? '-13' : ''})` }, fl);
      htmlEl('i', { 'aria-hidden': 'true' }, el);
      const t = document.createTextNode(n);
      el.appendChild(t);
      this.flagEls.push({ el, bit, n, t });
    }
    this.radixBtn = document.getElementById('btn-radix');
    this.radixBtn.addEventListener('click', () => { this.radix = (this.radix + 1) % 3; storage.set('radix', this.radix); this.renderRegs(true); });
    if (this.is486 || this.p5like) {
      const nm = this.is686 ? 'Pentium Pro' : this.is586 ? 'Pentium' : '80486';
      const ft = document.getElementById('fpu-title');
      if (ft) ft.innerHTML = 'FPU <small>on chip</small>';
      const fc = ft && ft.closest('.card');
      if (fc) fc.title = `The floating-point unit is on the ${nm} chip: there is no coprocessor.`;
    }
    this.fpuList = document.getElementById('fpu-stack');
    this.fpuSw = document.getElementById('fpu-sw');
    this.fpuRows = [];
    for (let i = 0; i < 8; i++) {
      const li = htmlEl('li', { class: 'empty' }, this.fpuList);
      htmlEl('b', null, li, 'ST' + i);
      this.fpuRows.push({ li, v: htmlEl('span', null, li, 'empty'), text: '' });
    }
    this.stackList = document.getElementById('stack-list');
    if (this.is386) this.buildSys386();
    else if (app.is286) this.buildSys();
    this.ioList = document.getElementById('io-log');
    this.ioSeen = null;
    this.flagsVal = 0;
    this.renderRegs(true);
  }
  fmt(v, name) {
    const r = this.regEls[name];
    if (r && r.w32) {
      v >>>= 0;
      if (this.radix === 1) return String(v);
      if (this.radix === 2) return bin(v, 32).replace(/(\d{8})(?=\d)/g, '$1 ');
      return hex(v >>> 16, 4) + ' ' + hex4(v);
    }
    if (this.radix === 1) return String(v);
    if (this.radix === 2) return bin(v, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
    return hex4(v);
  }
  // A 32-bit value in hex: the high half dim, the low half (the 16-bit register) bright.
  show(r, v, name) {
    if (r.w32 && this.radix === 0) {
      v >>>= 0;
      r.v.innerHTML = `<i${v >>> 16 ? '' : ' class="z"'}>${hex(v >>> 16, 4)}</i>${hex4(v)}`;
    } else r.v.textContent = this.fmt(v, name);
  }
  read(src) {
    const c = this.m.cpu;
    if (typeof src === 'number') return this.is386 ? c.regs32[src] >>> 0 : c.regs[src];
    if (src === 'ip') return this.is386 ? c.ip >>> 0 : c.ip;
    if (src === 'f') return this.is386 ? c.eflags : c.flags;
    return c.sregs[+src[1]];
  }
  renderRegs(all) {
    this.radixBtn.textContent = ['HEX', 'DEC', 'BIN'][this.radix];
    const regs = document.getElementById('regs');
    regs.style.gridTemplateColumns = this.radix === 2 ? 'minmax(0,1fr)' : '';
    regs.classList.toggle('bin', this.radix === 2);
    for (const name in this.regEls) {
      const r = this.regEls[name];
      this.show(r, this.vals[name], name);
    }
    this.renderFlags(this.vals[this.is386 ? 'EFLAGS' : 'FLAGS'], null);
  }
  setReg(name, v, flash) {
    const r = this.regEls[name];
    if (!r) return;
    const old = this.vals[name];
    this.vals[name] = v;
    this.show(r, v, name);
    if (flash && old !== v && name !== 'IP' && name !== 'EIP') {
      r.d.classList.remove('hot');
      void r.d.offsetWidth;
      r.d.classList.add('hot');
      clearTimeout(r.timer);
      r.timer = setTimeout(() => r.d.classList.remove('hot'), 60);
    }
    if (name === 'FLAGS' || name === 'EFLAGS') this.renderFlags(v, flash ? old : null);
  }
  renderFlags(v, old) {
    for (const f of this.flagEls) {
      if (f.n === 'IOPL') {
        const n = (v >> 12) & 3, o = old === null || old === undefined ? n : (old >> 12) & 3;
        f.t.textContent = 'IOPL ' + n;
        f.el.classList.toggle('on', n > 0);
        f.el.classList.toggle('changed', n !== o);
        f.el.setAttribute('aria-label', `IOPL ${n}`);
        continue;
      }
      const on = !!(v & (1 << f.bit));
      f.el.classList.toggle('on', on);
      f.el.classList.toggle('changed', old !== null && old !== undefined && !!(old & (1 << f.bit)) !== on);
      f.el.setAttribute('aria-label', `${f.n} ${on ? 'set' : 'clear'}`);
    }
  }
  // ---------- 80286 system registers and segment caches ----------
  buildSys() {
    const dl = document.getElementById('sys-regs');
    this.sysEls = {};
    const rows = [['MSW', 'Machine status word: PE MP EM TS'], ['CPL', 'Current privilege level (0 = most privileged)'],
      ['GDTR', 'Global descriptor table: base and limit'], ['IDTR', 'Interrupt descriptor table: base and limit'],
      ['LDTR', 'Local descriptor table: selector, base'], ['TR', 'Task register: selector, base'], ['IOPL', 'I/O privilege level (flags bits 12-13)'], ['A20', 'Address line 20 gate (8042 or port 92h)']];
    for (const [k, tip] of rows) {
      const dt = htmlEl('dt', { title: tip }, dl, k);
      this.sysEls[k] = htmlEl('dd', null, dl, '—');
      dt.dataset.tip = tip;
    }
    this.segRows = [];
    const tb = document.querySelector('#seg-cache tbody');
    for (const n of ['CS', 'DS', 'SS', 'ES']) {
      const tr = htmlEl('tr', null, tb);
      const cells = [n, '—', '—', '—', '—'].map(t => htmlEl('td', null, tr, t));
      this.segRows.push({ n, tr, cells, idx: { ES: 0, CS: 1, SS: 2, DS: 3 }[n], key: '' });
    }
    this.sysMode = document.getElementById('sys-mode');
  }
  syncSys(flash) {
    if (this.is386) { this.syncSys386(flash); return; }
    if (!this.sysEls) return;
    const c = this.m.cpu, has = c.cache && c.gdtr;
    const set = (k, v) => {
      const el = this.sysEls[k];
      if (el.textContent !== v) {
        el.textContent = v;
        if (flash) { el.classList.add('hot'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('hot'), 900); }
      }
    };
    if (!has) {
      for (const k in this.sysEls) set(k, '—');
      this.sysMode.textContent = 'core loading';
      return;
    }
    const msw = c.msw & 0xFFFF, pm = !!(msw & 1);
    set('MSW', `${hex4(msw)} ${['PE', 'MP', 'EM', 'TS'].filter((_, i) => msw & (1 << i)).join(' ') || '·'}`);
    set('CPL', String(c.cpl || 0));
    set('GDTR', `${hex(c.gdtr.base, 6)} / ${hex4(c.gdtr.limit)}`);
    set('IDTR', `${hex(c.idtr.base, 6)} / ${hex4(c.idtr.limit)}`);
    set('LDTR', c.ldtr ? `${hex4(c.ldtr.sel)} ${hex(c.ldtr.base, 6)}` : '—');
    set('TR', c.tr ? `${hex4(c.tr.sel)} ${hex(c.tr.base, 6)}` : '—');
    set('IOPL', String((c.flags >> 12) & 3));
    set('A20', this.m.a20 ? 'on (wrap off)' : 'off (wrap at 1 MB)');
    this.sysMode.textContent = pm ? `protected mode · CPL ${c.cpl || 0}` : 'real mode';
    for (const r of this.segRows) {
      const s = c.cache[r.idx];
      const key = `${s.sel}|${s.base}|${s.limit}|${s.access}`;
      if (key === r.key) continue;
      r.key = key;
      r.cells[1].textContent = hex4(c.sregs[r.idx]);
      r.cells[2].textContent = hex(s.base, 6);
      r.cells[3].textContent = hex4(s.limit);
      r.cells[4].textContent = hex2(s.access || 0);
      if (flash) { r.tr.classList.add('hot'); clearTimeout(r.timer); r.timer = setTimeout(() => r.tr.classList.remove('hot'), 900); }
    }
  }

  // ---------- 80386 system card: control registers, descriptor caches, TLB ----------
  // Three panes. A narrow card shows one pane at a time (the buttons in the head select it);
  // a wide card and the phone layout show all three.
  buildSys386() {
    const card = document.getElementById('card-sys');
    card.classList.add('sys386-card');
    const title = document.getElementById('sys-title');
    const nm = this.is686 ? 'Pentium Pro' : this.is586 ? 'Pentium' : this.is486 ? '80486' : '80386';
    if (title) title.textContent = nm + ' system';
    if (this.is486) card.classList.add('sys486-card');
    if (this.is586) card.classList.add('sys586-card');
    if (this.is686) card.classList.add('sys686-card');
    document.getElementById('sys-regs').hidden = true;
    document.getElementById('seg-cache').hidden = true;
    this.sysMode = document.getElementById('sys-mode');
    this.sysMode.hidden = true;
    const head = card.querySelector('.card-head');
    const tabs = this.sysTabs = htmlEl('div', { class: 'sys-tabs', role: 'tablist', 'aria-label': nm + ' system panes' }, head);
    const body = htmlEl('div', { class: 'sys386' }, card);
    this.sysPane = storage.get('sysPane', 'cpu');
    this.sysPanes = {};
    this.sysTabBtns = {};
    const panes = [['cpu', 'CR', 'Control registers, descriptor table registers and the mode'],
      ['seg', 'SEG', 'The six segment descriptor caches'], ['tlb', 'TLB', 'The translation lookaside buffer: 8 sets of 4 ways']];
    if (this.is486) panes.push(['cache', 'CACHE', 'The 8 KB cache on the chip: 128 sets of 4 ways']);
    if (this.is586) {
      panes[2][2] = 'The three TLBs: data 4 KB pages, data 4 MB pages and code';
      panes.push(['cache', 'CACHE', 'The code cache and the data cache: 8 KB each, 128 sets of 2 ways, the MESI states of the data lines'],
        ['btb', 'BTB', 'The branch target buffer: 256 branches, 64 sets of 4 ways, 2-bit counters'],
        ['pipe', 'PIPES', 'The U pipe and the V pipe: the pairs and the reasons for no pair']);
    }
    if (this.is686) {
      panes[2][2] = 'The three TLBs: data 4 KB pages, data 4 MB pages and code';
      panes.push(['cache', 'CACHE', 'The L1 code cache (64 sets of 4 ways), the L1 data cache (128 sets of 2 ways, MESI) and the 256 KB L2 (2048 sets of 4 ways)'],
        ['btb', 'BTB', 'The branch target buffer: 512 branches, 128 sets of 4 ways, a 4-bit history and 16 counters for each branch'],
        ['ooo', 'OOO', 'The out-of-order core: the ROB, the reservation station, the ports and the stalls']);
    }
    for (const [id, label, tip] of panes) {
      const b = htmlEl('button', { type: 'button', class: 'chip-btn', role: 'tab', id: 'sys-tab-' + id, 'aria-controls': 'sys-pane-' + id, title: tip }, tabs, label);
      b.addEventListener('click', () => this.setSysPane(id));
      this.sysTabBtns[id] = b;
      this.sysPanes[id] = htmlEl('div', { class: 'sys-pane sys-pane-' + id, id: 'sys-pane-' + id, role: 'tabpanel', 'aria-labelledby': 'sys-tab-' + id }, body);
    }
    // pane 1: control registers
    const P1 = this.sysPanes.cpu;
    this.sysMode386 = htmlEl('div', { class: 'sys-mode386' }, P1, 'real mode');
    const dl = htmlEl('dl', { class: 'sys-regs' }, P1);
    this.sysEls = {};
    const rows = [['CR0', 'Control register 0 (bits below)'], ['CPL', 'Current privilege level (0 = most privileged, 3 in V86 mode)'],
      ['CR2', 'Page fault linear address'], ['CR3', 'Page directory base (physical)'],
      ['GDTR', 'Global descriptor table: base / limit'], ['IDTR', 'Interrupt descriptor table: base / limit'],
      ['LDTR', 'Local descriptor table: selector, base'], ['TR', 'Task register: selector, base'],
      ['IOPL', 'I/O privilege level (EFLAGS bits 12-13)'], ['A20', 'Address line 20 gate (8042 or port 92h)']];
    if (this.is586) rows.splice(2, 0, ['CR4', 'Control register 4 (bits below): TSD DE PSE MCE'], ['TSC', 'Time stamp counter: the clocks since the reset (RDTSC)']);
    if (this.is686) rows.splice(2, 0, ['CR4', 'Control register 4 (bits below): TSD DE PSE MCE PGE PCE'], ['TSC', 'Time stamp counter: the core clocks since the reset (RDTSC)']);
    for (const [k, tip] of rows) {
      htmlEl('dt', { title: tip }, dl, k);
      this.sysEls[k] = htmlEl('dd', null, dl, '—');
    }
    const bits = htmlEl('div', { class: 'cr0-bits', role: 'group', 'aria-label': 'CR0 bits' }, P1);
    this.cr0Els = (this.is486 || this.p5like ? DOCK_CR0_486 : DOCK_CR0).map(([n, bit, desc]) => {
      const el = htmlEl('span', { class: 'flag', title: `CR0.${n}: ${desc} (bit ${bit})` }, bits);
      htmlEl('i', { 'aria-hidden': 'true' }, el);
      el.appendChild(document.createTextNode(n));
      return { el, bit, n };
    });
    if (this.p5like) {
      const b4 = htmlEl('div', { class: 'cr0-bits cr4-bits', role: 'group', 'aria-label': 'CR4 bits' }, P1);
      this.cr4Els = (this.is686 ? DOCK_CR4_686 : DOCK_CR4_586).map(([n, bit, desc]) => {
        const el = htmlEl('span', { class: 'flag', title: `CR4.${n}: ${desc} (bit ${bit})` }, b4);
        htmlEl('i', { 'aria-hidden': 'true' }, el);
        el.appendChild(document.createTextNode(n));
        return { el, bit, n };
      });
    }
    // pane 2: descriptor caches
    const t2 = htmlEl('table', { class: 'seg-cache seg386', 'aria-label': 'Segment descriptor caches' }, this.sysPanes.seg);
    t2.innerHTML = '<thead><tr><th scope="col">seg</th><th scope="col">sel</th><th scope="col">base</th><th scope="col">limit</th>' +
      '<th scope="col">acc</th><th scope="col" title="Granularity: the limit counts 4 KB pages">G</th><th scope="col" title="Default size: 32-bit code or stack">D</th></tr></thead>';
    const tb = htmlEl('tbody', null, t2);
    this.segRows = DOCK_SREGS.map((n, idx) => {
      const tr = htmlEl('tr', null, tb);
      const cells = [n, '—', '—', '—', '—', '·', '·'].map(t => htmlEl('td', null, tr, t));
      return { n, tr, cells, idx, key: '' };
    });
    // pane 3: TLB, 8 sets x 4 ways (the Pentium: three TLBs)
    const P3 = this.sysPanes.tlb;
    if (this.p5like) this.buildTlb586(P3);
    else this.buildTlb386(P3);
    if (this.is486) this.buildCache486(this.sysPanes.cache);
    if (this.is586) { this.buildCache586(this.sysPanes.cache); this.buildBtb586(this.sysPanes.btb); this.buildPipes586(this.sysPanes.pipe); }
    if (this.is686) { this.buildCache686(this.sysPanes.cache); this.buildBtb686(this.sysPanes.btb); this.buildOoo686(this.sysPanes.ooo); }
    this.setSysPane(this.sysPane);
  }
  buildTlb386(P3) {
    const g = this.tlbGrid = htmlEl('div', { class: 'tlb-grid', role: 'table', 'aria-label': 'TLB: linear page to physical page, 8 sets of 4 ways' }, P3);
    htmlEl('span', { class: 'th' }, g, 'set');
    for (let w = 0; w < 4; w++) htmlEl('span', { class: 'th' }, g, 'way ' + w);
    this.tlbCells = [];
    for (let s = 0; s < 8; s++) {
      htmlEl('span', { class: 'th' }, g, String(s));
      for (let w = 0; w < 4; w++) {
        const el = htmlEl('span', { class: 'tc' }, g, '·');
        this.tlbCells.push({ el, key: '' });
      }
    }
    this.tlbNote = htmlEl('div', { class: 'tlb-note' }, P3, 'paging off');
    this.tlbLast = null;
  }
  setSysPane(id) {
    if (!this.sysPanes || !this.sysPanes[id]) id = 'cpu';
    this.sysPane = id;
    storage.set('sysPane', id);
    for (const k in this.sysPanes) {
      this.sysPanes[k].classList.toggle('on', k === id);
      this.sysTabBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
      this.sysTabBtns[k].classList.remove('ping');
    }
  }
  syncSys386(flash) {
    if (!this.sysEls) return;
    const c = this.m.cpu;
    const set = (k, v) => {
      const el = this.sysEls[k];
      if (el.textContent !== v) {
        el.textContent = v;
        if (flash) { el.classList.add('hot'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('hot'), 900); }
      }
    };
    const cr0 = c.cr[0] >>> 0, pe = !!(cr0 & 1), vm = !!c.vm, pg = !!c.paging;
    set('CR0', hex(cr0, 8));
    set('CPL', String(c.cpl || 0));
    set('CR2', hex(c.cr[2], 8));
    set('CR3', hex(c.cr[3], 8));
    set('GDTR', `${hex(c.gdtr.base, 8)}/${hex4(c.gdtr.limit)}`);
    set('IDTR', `${hex(c.idtr.base, 8)}/${hex4(c.idtr.limit)}`);
    set('LDTR', c.ldtr ? `${hex4(c.ldtr.sel)} ${hex(c.ldtr.base, 8)}` : '—');
    set('TR', c.tr ? `${hex4(c.tr.sel)} ${hex(c.tr.base, 8)}` : '—');
    set('IOPL', String((c.eflags >> 12) & 3));
    set('A20', this.m.a20 ? 'on' : 'off (wrap)');
    for (const b of this.cr0Els) b.el.classList.toggle('on', !!((cr0 >>> b.bit) & 1));
    if (this.p5like) {
      const cr4 = c.cr[4] >>> 0;
      set('CR4', hex(cr4, 8));
      set('TSC', this.tscText());
      for (const b of this.cr4Els) b.el.classList.toggle('on', !!((cr4 >>> b.bit) & 1));
    }
    const mode = (vm ? 'virtual-8086' : pe ? 'protected' : 'real') + ' mode · paging ' + (pg ? 'on' : 'off');
    if (this.sysMode386.textContent !== mode) this.sysMode386.textContent = mode;
    this.sysMode386.className = 'sys-mode386' + (vm ? ' vm' : pe ? ' pm' : '') + (pg ? ' pg' : '');
    for (const r of this.segRows) {
      const s = c.cache[r.idx];
      const key = `${c.sregs[r.idx]}|${s.base}|${s.limit}|${s.access}|${s.flags}`;
      if (key === r.key) continue;
      r.key = key;
      r.cells[1].textContent = hex4(c.sregs[r.idx]);
      r.cells[2].textContent = hex(s.base, 8);
      r.cells[3].textContent = hex(s.limit, 8);
      r.cells[4].textContent = hex2(s.access || 0);
      r.cells[5].textContent = (s.flags >> 3) & 1 ? '1' : '0';
      r.cells[6].textContent = (s.flags >> 2) & 1 ? '1' : '0';
      r.cells[5].className = (s.flags >> 3) & 1 ? 'on' : '';
      r.cells[6].className = (s.flags >> 2) & 1 ? 'on' : '';
      if (flash) { r.tr.classList.add('hot'); clearTimeout(r.timer); r.timer = setTimeout(() => r.tr.classList.remove('hot'), 900); }
    }
    if (this.is586) { this.syncTlb586(); this.syncCache586(flash); this.syncBtb586(flash); this.syncPipes586(flash); }
    else if (this.is686) { this.syncTlb586(); this.syncCache686(flash); this.syncBtb686(flash); this.syncOoo686(flash); }
    else this.syncTlb();
    if (this.is486) this.syncCache(flash);
  }
  // The TLB grid: each valid entry shows linear page -> physical page (the top 20 bits).
  syncTlb() {
    const c = this.m.cpu, T = c.tlb;
    if (!this.tlbCells || !T) return;
    const on = !!c.paging, L = this.tlbLast;
    let n = 0;
    for (let i = 0; i < 32; i++) {
      const e = T[i], cell = this.tlbCells[i];
      const valid = on && e.valid;
      if (valid) n++;
      const last = L && valid && L.i === i;
      const key = valid ? `${e.lin}|${e.phys}|${e.flags}|${last ? L.kind + L.seq : ''}` : '';
      if (key === cell.key) continue;
      cell.key = key;
      if (!valid) { cell.el.textContent = '·'; cell.el.className = 'tc'; cell.el.removeAttribute('title'); continue; }
      const f = e.flags;
      cell.el.innerHTML = `${hex(e.lin >>> 12, 5)}<b>→${hex(e.phys >>> 12, 5)}</b>`;
      cell.el.className = 'tc v' + (f & 0x40 ? ' d' : '') + (last ? ' last ' + L.kind : '');
      cell.el.title = `set ${i >> 2} way ${i & 3}: linear ${hex(e.lin, 8)} → physical ${hex(e.phys, 8)}` +
        ` · ${f & 2 ? 'R/W' : 'read only'} · ${f & 4 ? 'user' : 'supervisor'}${f & 0x40 ? ' · dirty' : ''}`;
    }
    const st = c.tlbStats || { hits: 0, misses: 0, flushes: 0 };
    const t = on ? `${n}/32 valid · hits ${st.hits.toLocaleString('en-US')} · misses ${st.misses.toLocaleString('en-US')} · flushes ${st.flushes}`
      : 'paging off: the TLB is not used';
    if (this.tlbNote.textContent !== t) this.tlbNote.textContent = t;
  }
  // A 'page' (walk) or 'tlb' (hit) event: mark the entry of that linear page.
  tlbEvent(e) {
    const c = this.m.cpu;
    if (!c.tlb) return;
    const page = (e.lin & 0xFFFFF000) >>> 0;
    const i = c.tlb.findIndex(x => x.valid && x.lin === page);
    this.tlbLast = { i, kind: e.k === 'tlb' ? 'hit' : e.fault ? 'fault' : 'miss', seq: (this.tlbLast ? this.tlbLast.seq : 0) + 1 };
    this.syncTlb();
    if (this.sysPane !== 'tlb' && this.sysTabBtns && e.k === 'page') {
      const b = this.sysTabBtns.tlb;
      b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping');
    }
  }

  // ---------- 80486 cache pane ----------
  // The counters, the last access and a map of the 128 sets (a brighter cell has more valid ways).
  buildCache486(P) {
    this.cacheMode = htmlEl('div', { class: 'sys-mode386 cache-mode' }, P, 'cache off');
    const dl = htmlEl('dl', { class: 'sys-regs cache-stats' }, P);
    this.cacheEls = {};
    for (const [k, tip] of [['hits', 'Reads that the cache gave with no bus cycle'], ['misses', 'Reads that were not in the cache'],
      ['fills', 'Lines that came from memory in a burst (16 bytes)'], ['rate', 'Hits as a part of all reads'], ['valid', 'Valid lines of the 512']]) {
      htmlEl('dt', { title: tip }, dl, k === 'rate' ? 'hit rate' : k);
      this.cacheEls[k] = htmlEl('dd', null, dl, '—');
    }
    this.cacheLast = htmlEl('div', { class: 'cache-last' }, P, 'no access yet');
    const g = this.cacheGrid = htmlEl('div', { class: 'cache-map', role: 'img', 'aria-label': 'The 128 sets of the cache, 32 in each row. A brighter cell has more valid ways.' }, P);
    this.cacheCells = [];
    for (let s = 0; s < 128; s++) this.cacheCells.push({ el: htmlEl('i', { title: 'set ' + hex2(s) }, g), key: '' });
    this.cacheAcc = null;
  }
  syncCache(flash) {
    const c = this.m.cpu, C = c.cache486;
    if (!this.cacheEls) return;
    if (!C) { this.cacheMode.textContent = 'no cache in this CPU core'; return; }
    const cr0 = c.cr[0] >>> 0, cd = (cr0 >>> 30) & 1, nw = (cr0 >>> 29) & 1;
    const mode = `${cd ? 'cache off (no fills)' : 'cache on'} · CD ${cd} NW ${nw}` + (nw ? '' : ' · write-through');
    if (this.cacheMode.textContent !== mode) this.cacheMode.textContent = mode;
    this.cacheMode.className = 'sys-mode386 cache-mode' + (cd ? ' off' : ' pm');
    const st = C.stats, n = st.hits + st.misses, f = v => v.toLocaleString('en-US');
    let valid = 0;
    for (const l of C.lines) if (l.valid) valid++;
    const vals = { hits: f(st.hits), misses: f(st.misses), fills: f(st.fills), rate: n ? (st.hits / n * 100).toFixed(1) + ' %' : '—', valid: `${valid} / 512` };
    for (const k in vals) {
      const el = this.cacheEls[k];
      if (el.textContent !== vals[k]) {
        el.textContent = vals[k];
        if (flash && (k === 'hits' || k === 'misses' || k === 'fills')) { el.classList.add('hot'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('hot'), 900); }
      }
    }
    const a = this.cacheAcc;
    for (let s = 0; s < 128; s++) {
      let v = 0;
      for (let w = 0; w < 4; w++) if (C.lines[s * 4 + w].valid) v++;
      const hot = a && a.set === s ? (a.hit ? ' hit' : ' miss') : '';
      const key = v + hot;
      const cell = this.cacheCells[s];
      if (cell.key === key) continue;
      cell.key = key;
      cell.el.className = 'v' + v + hot;
      cell.el.title = `set ${hex2(s)}: ${v} valid way${v === 1 ? '' : 's'}`;
    }
  }
  // A 'cache' event: the last access (read or write, hit or miss, the set and the way).
  cacheEvent(e) {
    this.cacheAcc = e;
    if (this.cacheLast) {
      const kind = e.write ? 'write' : e.code ? 'code' : 'read';
      const res = e.hit ? 'HIT' : e.fill ? 'MISS, line fill' : 'MISS, no fill';
      this.cacheLast.innerHTML = `last: ${kind} <b class="${e.hit ? 'hit' : 'miss'}">${res}</b> ${hex(e.phys, 8)} · set ${hex2(e.set)}` + (e.way >= 0 ? ` way ${e.way}` : '');
    }
    this.syncCache(true);
    if (this.sysPane !== 'cache' && this.sysTabBtns && this.sysTabBtns.cache && !e.hit) {
      const b = this.sysTabBtns.cache;
      b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping');
    }
  }

  // ---------- Pentium: the TSC, the three TLBs, the two caches, the BTB, the pipes ----------
  tscText() {
    const c = this.m.cpu;
    let v;
    try { v = BigInt.asUintN(64, BigInt(Math.floor(c.cycles)) + (typeof c.tscOff === 'bigint' ? c.tscOff : 0n)); } catch (err) { v = 0n; }
    return v.toLocaleString('en-US');
  }
  // A map of small cells (an <i> for each cell): cols columns; index(i) = the cell of item i.
  cellMap(parent, n, cols, label) {
    const g = htmlEl('div', { class: 'p5-map', role: 'img', 'aria-label': label, style: `grid-template-columns: repeat(${cols}, minmax(0, 1fr))` }, parent);
    const cells = [];
    for (let i = 0; i < n; i++) cells.push({ el: htmlEl('i', null, g), key: '' });
    return cells;
  }
  paintCell(cell, cls, title) {
    if (cell.key === cls + title) return;
    cell.key = cls + title;
    cell.el.className = cls;
    if (title) cell.el.title = title; else cell.el.removeAttribute('title');
  }
  buildTlb586(P) {
    this.tlb5 = {};
    const mk = (key, head, sets, ways, label) => {
      const box = htmlEl('div', { class: 'p5-tlb' }, P);
      htmlEl('div', { class: 'p5-h' }, box, head);
      // the cells: a column for each set, a row for each way (entry set * ways + way)
      const g = htmlEl('div', { class: 'p5-map p5-tlbmap', role: 'img', 'aria-label': label, style: `grid-template-columns: repeat(${sets}, minmax(0, 1fr))` }, box);
      const cells = new Array(sets * ways);
      for (let w = 0; w < ways; w++) for (let s = 0; s < sets; s++) cells[s * ways + w] = { el: htmlEl('i', null, g), key: '' };
      this.tlb5[key] = { cells, ways };
    };
    mk('d4k', 'data · 4 KB pages · 16 sets × 4 ways', 16, 4, 'Data TLB for 4 KB pages: a column for each set, a row for each way');
    mk('d4m', 'data · 4 MB pages · 2 sets × 4 ways', 2, 4, 'Data TLB for 4 MB pages');
    mk('code', 'code · 8 sets × 4 ways', 8, 4, 'Code TLB');
    this.tlbNote = htmlEl('div', { class: 'tlb-note' }, P, 'paging off');
    this.tlbLastEl = htmlEl('div', { class: 'cache-last' }, P, '');
    this.tlbLast = null;
  }
  syncTlb586() {
    const c = this.m.cpu;
    if (!this.tlb5) return;
    const on = !!c.paging, L = this.tlbLast;
    const paint = (key, T, kind) => {
      const X = this.tlb5[key];
      if (!X || !T) return;
      for (let i = 0; i < X.cells.length && i < T.length; i++) {
        const e = T[i], valid = on && e.valid;
        const mask = kind === '4m' ? 0xFFC00000 : 0xFFFFF000;
        const last = !!(L && valid && ((kind === 'i') === !!L.code) && (kind === '4m') === (!!L.big && !L.code) && ((L.lin & mask) >>> 0) === e.lin);
        const g = this.is686 && valid && !!(e.flags & 0x100);
        const cls = !valid ? '' : 'v' + (e.flags & 0x40 ? ' d' : '') + (e.flags & 0x80 ? ' big' : '') + (g ? ' g' : '') + (last ? (L.hit ? ' hit' : ' miss') : '');
        const title = valid ? `set ${Math.floor(i / X.ways)} way ${i % X.ways}: linear ${hex(e.lin, 8)} → physical ${hex(e.phys, 8)} · ${e.flags & 2 ? 'R/W' : 'read only'} · ${e.flags & 4 ? 'user' : 'supervisor'}${e.flags & 0x40 ? ' · dirty' : ''}${e.flags & 0x80 ? ' · from a 4 MB page' : ''}${g ? ' · global (G = 1): it stays at MOV CR3' : ''}` : '';
        this.paintCell(X.cells[i], cls, title);
      }
    };
    paint('d4k', c.tlb, '4k');
    paint('d4m', c.tlb4m, '4m');
    paint('code', c.itlb, 'i');
    const st = c.tlbStats || {}, f = v => (v || 0).toLocaleString('en-US');
    const t = on ? `data: hits ${f(st.hits)} (4 MB ${f(st.bigHits)}) · misses ${f(st.misses)} · code: hits ${f(st.codeHits)} · misses ${f(st.codeMisses)} · flushes ${f(st.flushes)}`
      : 'paging off: the CPU does not use the TLBs';
    if (this.tlbNote.textContent !== t) this.tlbNote.textContent = t;
  }
  tlbEvent586(e) {
    this.tlbLast = { lin: e.lin >>> 0, big: !!e.big, code: !!e.code, hit: e.k === 'tlb' };
    if (this.tlbLastEl) this.tlbLastEl.innerHTML = `last: ${e.code ? 'code' : 'data'} ${hex(e.lin >>> 0, 8)} <b class="${e.k === 'tlb' ? 'hit' : 'miss'}">${e.k === 'tlb' ? 'HIT' : e.fault ? 'MISS, #PF' : 'MISS, page walk'}</b>${e.big ? ' · 4 MB page' : ''}${e.fault ? '' : ' → ' + hex(e.phys >>> 0, 8)}`;
    this.syncTlb586();
    if (this.sysPane !== 'tlb' && this.sysTabBtns && e.k === 'page') { const b = this.sysTabBtns.tlb; b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); }
  }
  buildCache586(P) {
    this.cacheMode = htmlEl('div', { class: 'sys-mode386 cache-mode' }, P, 'caches off');
    const t = htmlEl('table', { class: 'p5-table', 'aria-label': 'Counters of the code cache and the data cache' }, P);
    t.innerHTML = '<thead><tr><th scope="col"></th><th scope="col" title="Valid lines of the 256">valid</th><th scope="col" title="Accesses that the cache gave with no bus cycle">hits</th>' +
      '<th scope="col" title="Accesses that were not in the cache">misses</th><th scope="col" title="Lines that came from memory in a burst of 4 × 8 bytes">fills</th>' +
      '<th scope="col" title="M lines that went back to memory in a burst">w-back</th><th scope="col" title="Hits as a part of all accesses">rate</th></tr></thead>';
    const tb = htmlEl('tbody', null, t);
    this.c5Rows = ['code', 'data'].map(n => {
      const tr = htmlEl('tr', null, tb);
      htmlEl('th', { scope: 'row' }, tr, n);
      return [0, 1, 2, 3, 4, 5].map(() => htmlEl('td', null, tr, '—'));
    });
    const m = htmlEl('div', { class: 'p5-mesi', title: 'The MESI states of the 256 data lines: M modified (newer than memory), E exclusive, S shared, I invalid' }, P);
    this.mesiEls = [3, 2, 1, 0].map(s => { const el = htmlEl('span', { class: 'p5-st s' + s }, m); return { s, el }; });
    this.cacheLast = htmlEl('div', { class: 'cache-last' }, P, 'no access yet');
    this.cacheLastI = htmlEl('div', { class: 'cache-last' }, P, '');
    const maps = htmlEl('div', { class: 'p5-maps' }, P);
    const ci = htmlEl('div', null, maps), cd = htmlEl('div', null, maps);
    htmlEl('div', { class: 'p5-h' }, ci, 'code lines');
    htmlEl('div', { class: 'p5-h' }, cd, 'data lines (MESI)');
    // line i = set * 2 + way: the column is the set mod 32, two rows (the ways) for each 32 sets
    const order = [];
    for (let r = 0; r < 4; r++) for (let w = 0; w < 2; w++) for (let s = 0; s < 32; s++) order.push((r * 32 + s) * 2 + w);
    const mkMap = (parent, label) => { const cells = this.cellMap(parent, 256, 32, label), by = new Array(256); order.forEach((line, k) => { by[line] = cells[k]; }); return by; };
    this.c5MapI = mkMap(ci, 'The 256 lines of the code cache');
    this.c5MapD = mkMap(cd, 'The 256 lines of the data cache in their MESI colours');
    this.c5Acc = { i: null, d: null };
  }
  syncCache586(flash) {
    const c = this.m.cpu;
    if (!this.c5Rows) return;
    const cr0 = c.cr[0] >>> 0, cd = (cr0 >>> 30) & 1, nw = (cr0 >>> 29) & 1, ci = (c.tr12 >>> 9) & 1;
    const mode = `${cd ? 'caches off (no fills)' : 'caches on'} · CD ${cd} NW ${nw}${ci ? ' · TR12.CI = 1' : ''} · data: write-back`;
    if (this.cacheMode.textContent !== mode) this.cacheMode.textContent = mode;
    this.cacheMode.className = 'sys-mode386 cache-mode' + (cd || ci ? ' off' : ' pm');
    const IC = c.icache, DC = c.dcache, f = v => v.toLocaleString('en-US'), n = [0, 0, 0, 0];
    let vi = 0;
    const A = this.c5Acc;
    for (let i = 0; i < 256; i++) {
      const ok = IC.tag[i] >= 0, st = DC.tag[i] >= 0 ? DC.state[i] : 0;
      if (ok) vi++;
      n[st]++;
      const set = i >> 1, way = i & 1;
      const li = A.i && A.i.set === set && A.i.way === way, ld = A.d && A.d.set === set && A.d.way === way;
      this.paintCell(this.c5MapI[i], (ok ? 'v' : '') + (li ? ' last' : ''), ok ? `set ${hex2(set)} way ${way}: line ${hex(c.lineAddr(IC.tag[i], i), 8)}` : '');
      this.paintCell(this.c5MapD[i], 's' + st + (ld ? ' last' : ''), st ? `set ${hex2(set)} way ${way}: line ${hex(c.lineAddr(DC.tag[i], i), 8)} · ${DOCK_MESI[st]}` : '');
    }
    const row = (cells, s, valid, wb) => {
      const t = s.hits + s.misses;
      const v = [`${valid}`, f(s.hits), f(s.misses), f(s.fills), wb === null ? '—' : f(wb), t ? (s.hits / t * 100).toFixed(1) + ' %' : '—'];
      cells.forEach((el, k) => {
        if (el.textContent === v[k]) return;
        el.textContent = v[k];
        if (flash && k > 0 && k < 5) { el.classList.add('hot'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('hot'), 900); }
      });
    };
    row(this.c5Rows[0], IC.stats, vi, null);
    row(this.c5Rows[1], DC.stats, 256 - n[0], DC.stats.writeBacks);
    for (const x of this.mesiEls) { const t = `${DOCK_MESI[x.s]} ${n[x.s]}`; if (x.el.textContent !== t) x.el.textContent = t; }
  }
  cacheEvent586(e) {
    const code = e.cache === 'code' || !!e.code;
    this.c5Acc[code ? 'i' : 'd'] = e;
    const el = code ? this.cacheLastI : this.cacheLast;
    if (el) {
      const kind = e.write ? 'write' : code ? 'code' : 'read';
      const res = e.hit ? 'HIT' : e.fill ? 'MISS, line fill' : 'MISS, no fill';
      el.innerHTML = `${code ? 'code' : 'data'}: ${kind} <b class="${e.hit ? 'hit' : 'miss'}">${res}</b> ${hex(e.phys >>> 0, 8)} · set ${hex2(e.set)}` + (e.way >= 0 ? ` way ${e.way}` : '') +
        (code ? '' : ` · <b class="p5-st s${Math.max(0, DOCK_MESI.indexOf(e.state || 'I'))}">${e.state || 'I'}</b>`) + (e.wb ? ` · write-back ${hex(e.wbLine >>> 0, 8)}` : '');
    }
    this.syncCache586(true);
    if (this.sysPane !== 'cache' && this.sysTabBtns && !e.hit) { const b = this.sysTabBtns.cache; b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); }
  }
  buildBtb586(P) {
    const dl = htmlEl('dl', { class: 'sys-regs cache-stats p5-stats' }, P);
    this.btbEls = {};
    for (const [k, lab, tip] of [['lookups', 'branches', 'The branches that the BTB looked up (Jcc, JMP, CALL near)'], ['hits', 'hits', 'Branches that were in the BTB'],
      ['right', 'right', 'Right predictions'], ['wrong', 'wrong', 'Wrong predictions: 3 clocks (U pipe) or 4 clocks (V pipe) more'],
      ['allocs', 'new', 'New entries (a taken branch that was not in the BTB)'], ['rate', 'rate', 'Right predictions as a part of all branches']]) {
      htmlEl('dt', { title: tip }, dl, lab);
      this.btbEls[k] = htmlEl('dd', null, dl, '—');
    }
    this.btbLast = htmlEl('div', { class: 'cache-last' }, P, 'no branch yet');
    this.btbLast2 = htmlEl('div', { class: 'cache-last' }, P, '');
    htmlEl('div', { class: 'p5-h' }, P, '256 entries · the colour is the 2-bit counter');
    this.btbCells = this.cellMap(P, 256, 32, 'The 256 entries of the BTB: 64 sets of 4 ways; the colour is the counter');
    const lg = htmlEl('div', { class: 'p5-legend' }, P);
    for (let k = 0; k < 4; k++) htmlEl('span', { class: 'c' + k }, lg, `${k} ${DOCK_BTB_STATE[k]}`);
    this.btbLastE = null;
  }
  syncBtb586(flash) {
    const B = this.m.cpu.btb;
    if (!this.btbEls || !B) return;
    const s = B.stats, f = v => v.toLocaleString('en-US');
    const vals = { lookups: f(s.lookups), hits: f(s.hits), right: f(s.right), wrong: f(s.wrong), allocs: f(s.allocs), rate: s.lookups ? (s.right / s.lookups * 100).toFixed(1) + ' %' : '—' };
    for (const k in vals) {
      const el = this.btbEls[k];
      if (el.textContent === vals[k]) continue;
      el.textContent = vals[k];
      if (flash && k !== 'rate') { el.classList.add('hot'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('hot'), 900); }
    }
    const L = this.btbLastE, li = L && L.way >= 0 ? L.set * 4 + L.way : -1;
    for (let i = 0; i < 256; i++) {
      const v = B.tag[i] !== -1;
      this.paintCell(this.btbCells[i], v ? 'c' + (B.counter[i] & 3) + (i === li ? ' last' : '') : '', v ? `set ${i >> 2} way ${i & 3}: branch ${hex(B.tag[i] >>> 0, 8)} → ${hex(B.target[i] >>> 0, 8)} · ${B.counter[i]} ${DOCK_BTB_STATE[B.counter[i] & 3]}` : '');
    }
  }
  btbEvent586(e) {
    this.btbLastE = e;
    if (this.btbLast) {
      this.btbLast.innerHTML = `last: ${hex(e.lin >>> 0, 8)} ${e.hit ? 'HIT' : 'MISS'} · predict ${e.predicted ? 'taken' : 'not taken'} · <b class="${e.right ? 'hit' : 'miss'}">${e.taken ? 'TAKEN' : 'NOT TAKEN'}, ${e.right ? 'RIGHT' : 'WRONG'}</b>`;
      this.btbLast2.textContent = `${e.way >= 0 ? `set ${e.set} way ${e.way} · counter ${e.counter} (${DOCK_BTB_STATE[e.counter & 3]})` : 'no entry'}${e.alloc ? ' · new entry' : ''} · ${e.pipe} pipe · +${e.penalty} clocks`;
    }
    this.syncBtb586(true);
    if (this.sysPane !== 'btb' && this.sysTabBtns && !e.right) { const b = this.sysTabBtns.btb; b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); }
  }
  buildPipes586(P) {
    const dl = htmlEl('dl', { class: 'sys-regs cache-stats p5-stats' }, P);
    this.pipeEls = {};
    for (const [k, lab, tip] of [['u', 'U pipe', 'Instructions in the U pipe'], ['v', 'V pipe', 'Instructions in the V pipe (each one is a pair with a U instruction)'],
      ['rate', 'pair rate', 'The part of the U instructions that got a partner in the V pipe'], ['floor', 'floor', 'Clocks that the 1-clock step floor of the emulator adds (a real P5 does two 1-clock instructions in one clock)']]) {
      htmlEl('dt', { title: tip }, dl, lab);
      this.pipeEls[k] = htmlEl('dd', null, dl, '—');
    }
    this.pipeLast = htmlEl('div', { class: 'cache-last p5-pair' }, P, 'no instruction yet');
    this.pipeWhy = htmlEl('div', { class: 'cache-last' }, P, '');
    htmlEl('div', { class: 'p5-h' }, P, 'the most frequent reasons for no pair');
    this.pipeList = htmlEl('ol', { class: 'p5-why' }, P);
    this.pipeRows = [0, 1, 2, 3, 4].map(() => {
      const li = htmlEl('li', null, this.pipeList);
      const bar = htmlEl('i', null, li), t = htmlEl('span', null, li), n = htmlEl('b', null, li);
      return { li, bar, t, n, key: '' };
    });
  }
  syncPipes586(flash) {
    const ps = this.m.cpu.pipeStats;
    if (!this.pipeEls || !ps) return;
    const f = v => v.toLocaleString('en-US');
    const vals = { u: f(ps.u), v: f(ps.v), rate: ps.u ? (ps.v / ps.u * 100).toFixed(1) + ' %' : '—', floor: f(ps.floor) + ' clk' };
    for (const k in vals) {
      const el = this.pipeEls[k];
      if (el.textContent === vals[k]) continue;
      el.textContent = vals[k];
      if (flash && (k === 'u' || k === 'v')) { el.classList.add('hot'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('hot'), 900); }
    }
    // the five largest counters of the reasons (index 0 is a pair)
    const top = [];
    let tot = 0;
    for (let i = 1; i < ps.why.length; i++) { tot += ps.why[i]; if (ps.why[i]) top.push(i); }
    top.sort((a, b) => ps.why[b] - ps.why[a]);
    this.pipeRows.forEach((r, k) => {
      const i = top[k], on = i !== undefined;
      const pc = on ? ps.why[i] / Math.max(1, tot) * 100 : 0;
      const key = on ? `${i}|${ps.why[i]}` : '';
      if (key === r.key) return;
      r.key = key;
      r.li.hidden = !on;
      if (!on) return;
      r.t.textContent = ps.reasons[i].replace('$', 'a register');
      r.n.textContent = `${pc.toFixed(0)} % · ${f(ps.why[i])}`;
      r.bar.style.width = pc.toFixed(1) + '%';
    });
  }
  pipeEvent586(e) {
    if (this.pipeLast) {
      const cut = s => (s && s.length > 30 ? s.slice(0, 29) + '…' : s || '');
      const s3 = (e.stage && e.stage[3]) || '';
      const u = e.pipe === 'V' ? e.partner : s3, v = e.pipe === 'V' ? s3 : e.paired ? e.partner : '';
      this.pipeLast.innerHTML = '';
      htmlEl('b', { class: 'u' }, this.pipeLast, 'U');
      this.pipeLast.appendChild(document.createTextNode(' ' + cut(u) + '  '));
      htmlEl('b', { class: 'v' }, this.pipeLast, 'V');
      this.pipeLast.appendChild(document.createTextNode(' ' + (v ? cut(v) : '—')));
      this.pipeWhy.textContent = e.paired ? `a pair: ${e.pipe} step, ${e.clocks} clock${e.clocks === 1 ? '' : 's'} alone` : `no pair: ${e.reason}`;
      this.pipeWhy.className = 'cache-last ' + (e.paired ? 'ok' : 'no');
    }
    this.syncPipes586(false);
  }

  // ---------- Pentium Pro: the three caches, the BTB with its history, the out-of-order core ----------
  hot(el) { el.classList.add('hot'); clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('hot'), 900); }
  setText(el, t, flash) { if (el.textContent === t) return; el.textContent = t; if (flash) this.hot(el); }
  buildCache686(P) {
    this.cacheMode = htmlEl('div', { class: 'sys-mode386 cache-mode' }, P, 'caches off');
    const t = htmlEl('table', { class: 'p5-table', 'aria-label': 'Counters of the L1 code cache, the L1 data cache and the L2 cache' }, P);
    t.innerHTML = '<thead><tr><th scope="col"></th><th scope="col" title="Valid lines">valid</th><th scope="col" title="Accesses that the cache gave (L1: no L2 access; L2: no FSB cycle)">hits</th>' +
      '<th scope="col" title="Accesses that were not in the cache">misses</th><th scope="col" title="Lines that came into the cache (32 bytes)">fills</th>' +
      '<th scope="col" title="M lines that went out: from the L1 data cache into the L2, from the L2 to memory on the FSB">w-back</th><th scope="col" title="Hits as a part of all accesses">rate</th></tr></thead>';
    const tb = htmlEl('tbody', null, t);
    this.c6Rows = [['L1 code', 'The L1 code cache: 8 KB, 64 sets of 4 ways. The prefetcher reads it.'], ['L1 data', 'The L1 data cache: 8 KB, 128 sets of 2 ways, write-back, MESI'],
      ['L2', 'The L2 cache: 256 KB, 2048 sets of 4 ways, on the back-side bus in the same package. It holds code and data.']].map(([n, tip]) => {
      const tr = htmlEl('tr', null, tb);
      htmlEl('th', { scope: 'row', title: tip }, tr, n);
      return [0, 1, 2, 3, 4, 5].map(() => htmlEl('td', null, tr, '—'));
    });
    const mk = (lab, tip) => {
      const m = htmlEl('div', { class: 'p5-mesi', title: tip }, P);
      htmlEl('span', { class: 'p6-lab' }, m, lab);
      return [3, 2, 1, 0].map(s => ({ s, el: htmlEl('span', { class: 'p5-st s' + s }, m) }));
    };
    this.mesiEls = mk('L1 data', 'The MESI states of the 256 L1 data lines: M modified (newer than memory), E exclusive, S shared, I invalid');
    this.mesiL2 = mk('L2', 'The MESI states of the 8192 L2 lines. The L2 keeps the tags and the states only (memory has the bytes in this emulator).');
    this.l2Req = htmlEl('div', { class: 'cache-last' }, P, '');
    this.cacheLastI = htmlEl('div', { class: 'cache-last' }, P, 'no access yet');
    this.cacheLast = htmlEl('div', { class: 'cache-last' }, P, '');
    this.cacheLastL2 = htmlEl('div', { class: 'cache-last' }, P, '');
    const maps = htmlEl('div', { class: 'p5-maps p6-maps' }, P);
    const ci = htmlEl('div', null, maps), cd = htmlEl('div', null, maps), c2 = htmlEl('div', { class: 'p6-l2box' }, maps);
    htmlEl('div', { class: 'p5-h' }, ci, 'L1 code lines');
    htmlEl('div', { class: 'p5-h' }, cd, 'L1 data lines (MESI)');
    htmlEl('div', { class: 'p5-h' }, c2, 'L2 · a cell = 8 sets (32 lines) · the colour shows the valid lines; a pink edge: an M line');
    // L1 code: line i = set * 4 + way; 32 columns: the rows are the 4 ways of sets 0-31, then of sets 32-63
    const oI = [], oD = [];
    for (let r = 0; r < 2; r++) for (let w = 0; w < 4; w++) for (let s = 0; s < 32; s++) oI.push((r * 32 + s) * 4 + w);
    for (let r = 0; r < 4; r++) for (let w = 0; w < 2; w++) for (let s = 0; s < 32; s++) oD.push((r * 32 + s) * 2 + w);
    const mkMap = (parent, order, label) => { const cells = this.cellMap(parent, 256, 32, label), by = new Array(256); order.forEach((line, k) => { by[line] = cells[k]; }); return by; };
    this.c6MapI = mkMap(ci, oI, 'The 256 lines of the L1 code cache');
    this.c6MapD = mkMap(cd, oD, 'The 256 lines of the L1 data cache in their MESI colours');
    this.c6MapL2 = this.cellMap(c2, 256, 32, 'The L2 cache: each cell is 8 sets (32 lines); a brighter cell has more valid lines');
    this.c6Acc = { i: null, d: null, l2: null };
    this.c6L2T = 0;
  }
  syncCache686(flash) {
    const c = this.m.cpu;
    if (!this.c6Rows) return;
    const cr0 = c.cr[0] >>> 0, cd = (cr0 >>> 30) & 1, nw = (cr0 >>> 29) & 1;
    const mode = `${cd ? 'caches off (no fills)' : 'caches on'} · CD ${cd} NW ${nw} · L1 data and L2: write-back`;
    if (this.cacheMode.textContent !== mode) this.cacheMode.textContent = mode;
    this.cacheMode.className = 'sys-mode386 cache-mode' + (cd ? ' off' : ' pm');
    const IC = c.icache, DC = c.dcache, L2 = c.l2, f = v => v.toLocaleString('en-US'), n = [0, 0, 0, 0];
    let vi = 0;
    const A = this.c6Acc;
    for (let i = 0; i < 256; i++) {
      const ok = IC.tag[i] >= 0, st = DC.tag[i] >= 0 ? DC.state[i] : 0;
      if (ok) vi++;
      n[st]++;
      const li = A.i && A.i.set === (i >> 2) && A.i.way === (i & 3), ld = A.d && A.d.set === (i >> 1) && A.d.way === (i & 1);
      this.paintCell(this.c6MapI[i], (ok ? 'v' : '') + (li ? ' last' : ''), ok ? `set ${hex2(i >> 2)} way ${i & 3}: line ${hex(c.iLineAddr(IC.tag[i], i), 8)}` : '');
      this.paintCell(this.c6MapD[i], 's' + st + (ld ? ' last' : ''), st ? `set ${hex2(i >> 1)} way ${i & 1}: line ${hex(c.lineAddr(DC.tag[i], i), 8)} · ${DOCK_MESI[st]}` : '');
    }
    // the L2: 8192 lines, one cell for each 8 sets (32 lines)
    const n2 = [0, 0, 0, 0], T2 = L2.tag, S2 = L2.state, al2 = A.l2 ? A.l2.set >> 3 : -1;
    for (let k = 0; k < 256; k++) {
      let v = 0, m = 0;
      for (let i = k * 32, e = i + 32; i < e; i++) if (T2[i] >= 0) { v++; n2[S2[i]]++; if (S2[i] === 3) m++; }
      const lv = v === 0 ? 0 : v <= 8 ? 1 : v <= 16 ? 2 : v <= 24 ? 3 : 4;
      this.paintCell(this.c6MapL2[k], 'l' + lv + (m ? ' m' : '') + (k === al2 ? ' last' : ''), `sets ${hex(k * 8, 3)}–${hex(k * 8 + 7, 3)}: ${v} valid line${v === 1 ? '' : 's'} of 32` + (m ? `, ${m} M` : ''));
    }
    const vL2 = n2[1] + n2[2] + n2[3];
    n2[0] = 8192 - vL2;
    const row = (cells, s, valid, wb) => {
      const t = s.hits + s.misses;
      const v = [f(valid), f(s.hits), f(s.misses), f(s.fills), wb === null ? '—' : f(wb), t ? (s.hits / t * 100).toFixed(1) + ' %' : '—'];
      cells.forEach((el, k) => this.setText(el, v[k], flash && k > 0 && k < 5));
    };
    row(this.c6Rows[0], IC.stats, vi, null);
    row(this.c6Rows[1], DC.stats, 256 - n[0], DC.stats.writeBacks);
    row(this.c6Rows[2], L2.stats, vL2, L2.stats.writeBacks);
    for (const x of this.mesiEls) this.setText(x.el, `${DOCK_MESI[x.s]} ${n[x.s]}`);
    for (const x of this.mesiL2) this.setText(x.el, `${DOCK_MESI[x.s]} ${f(n2[x.s])}`);
    const s2 = L2.stats;
    this.setText(this.l2Req, `L2 requests ${f(s2.requests)} (code ${f(s2.codeRequests)}, code misses ${f(s2.codeMisses)}) · L1 data RFO ${f(DC.stats.rfo || 0)}`);
  }
  cacheEvent686(e) {
    const code = e.cache === 'code' || !!e.code, l2 = e.level === 'L2';
    this.c6Acc[l2 ? 'l2' : code ? 'i' : 'd'] = e;
    const el = l2 ? this.cacheLastL2 : code ? this.cacheLastI : this.cacheLast;
    if (el) {
      const kind = e.write ? 'write' : code ? 'code' : 'read';
      const res = e.hit ? 'HIT' : e.fill ? (l2 ? 'MISS, burst from memory (FSB)' : 'MISS, fill from the L2') : 'MISS, no fill';
      el.innerHTML = `${l2 ? 'L2' : code ? 'L1 code' : 'L1 data'}: ${kind} <b class="${e.hit ? 'hit' : 'miss'}">${res}</b> ${hex(e.phys >>> 0, 8)} · set ${l2 ? hex(e.set, 3) : hex2(e.set)}` + (e.way >= 0 ? ` way ${e.way}` : '') +
        (code && !l2 ? '' : ` · <b class="p5-st s${Math.max(0, DOCK_MESI.indexOf(e.state || 'I'))}">${e.state || 'I'}</b>`) + (e.wb ? ` · write-back ${hex(e.wbLine >>> 0, 8)}` : '');
    }
    this.syncCache686(true);
    if (this.sysPane !== 'cache' && this.sysTabBtns && !e.hit) { const b = this.sysTabBtns.cache; b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); }
  }
  buildBtb686(P) {
    const dl = htmlEl('dl', { class: 'sys-regs cache-stats p5-stats' }, P);
    this.btbEls = {};
    for (const [k, lab, tip] of [['branches', 'branches', 'All branches: Jcc, JMP, CALL, RET, LOOP, JCXZ'], ['hits', 'BTB hits', 'Branches that were in the BTB'],
      ['right', 'right', 'Right predictions (the BTB, the decoder and the return stack)'], ['wrong', 'wrong', 'Wrong predictions: the fetch starts again about 10 to 17 clocks later'],
      ['stat', 'decoder', 'Static predictions of the decoder (a branch that is not in the BTB): right / wrong'], ['rsb', 'RET stack', 'Predictions of the return stack buffer for RET: right / wrong'],
      ['allocs', 'new', 'New entries (a taken branch that was not in the BTB)'], ['rate', 'rate', 'Right predictions as a part of all branches']]) {
      htmlEl('dt', { title: tip }, dl, lab);
      this.btbEls[k] = htmlEl('dd', null, dl, '—');
    }
    this.btbLast = htmlEl('div', { class: 'cache-last' }, P, 'no branch yet');
    const h = this.btbHist = htmlEl('div', { class: 'p6-hist', title: 'The two-level prediction: the last 4 outcomes of this branch (T taken, N not taken; the newest at the right) select one of its 16 2-bit counters' }, P);
    htmlEl('span', { class: 'p6-lab' }, h, 'history');
    this.btbHistBits = [3, 2, 1, 0].map(b => htmlEl('b', { title: 'bit ' + b + (b === 0 ? ' (the newest outcome)' : '') }, h, '·'));
    this.btbCtr = htmlEl('span', { class: 'p6-ctr' }, h, '');
    this.btbLast2 = htmlEl('div', { class: 'cache-last' }, P, '');
    htmlEl('div', { class: 'p5-h' }, P, '512 entries · 128 sets × 4 ways · the colour is the counter of the next prediction');
    this.btbCells = this.cellMap(P, 512, 32, 'The 512 entries of the BTB: 128 sets of 4 ways; the colour is the counter');
    const lg = htmlEl('div', { class: 'p5-legend' }, P);
    for (let k = 0; k < 4; k++) htmlEl('span', { class: 'c' + k }, lg, `${k} ${DOCK_BTB_STATE[k]}`);
    this.btbLastE = null;
  }
  syncBtb686(flash) {
    const B = this.m.cpu.btb;
    if (!this.btbEls || !B) return;
    const s = B.stats, f = v => v.toLocaleString('en-US');
    const vals = { branches: f(s.branches), hits: f(s.hits), right: f(s.right), wrong: f(s.wrong), stat: `${f(s.staticRight)} / ${f(s.staticWrong)}`,
      rsb: `${f(s.rsbRight)} / ${f(s.rsbWrong)}`, allocs: f(s.allocs), rate: s.branches ? (s.right / s.branches * 100).toFixed(1) + ' %' : '—' };
    for (const k in vals) this.setText(this.btbEls[k], vals[k], flash && k !== 'rate');
    const L = this.btbLastE, li = L && L.way >= 0 && L.set >= 0 ? L.set * 4 + L.way : -1;
    const n = Math.min(512, B.tag.length);
    for (let i = 0; i < n; i++) {
      const v = B.tag[i] !== -1;
      this.paintCell(this.btbCells[i], v ? 'c' + (B.counter[i] & 3) + (i === li ? ' last' : '') : '', v ? `set ${hex2(i >> 2)} way ${i & 3}: branch ${hex(B.tag[i] >>> 0, 8)} → ${hex(B.target[i] >>> 0, 8)} · history ${bin(B.hist[i] & 15, 4)} · counter ${B.counter[i]} (${DOCK_BTB_STATE[B.counter[i] & 3]})` : '');
    }
  }
  btbEvent686(e) {
    this.btbLastE = e;
    if (this.btbLast) {
      this.btbLast.innerHTML = `last: ${e.kind || 'branch'} ${hex(e.lin >>> 0, 8)} · ${DOCK_HOW[e.how] || e.how}${e.how === 'btb' ? (e.hit ? ' HIT' : ' MISS') : ''} · predict ${e.predicted ? 'taken' : 'not taken'} · ` +
        `<b class="${e.right ? 'hit' : 'miss'}">${e.taken ? 'TAKEN' : 'NOT TAKEN'}, ${e.right ? 'RIGHT' : 'WRONG'}</b>`;
      const hs = e.history;
      this.btbHistBits.forEach((b, k) => {
        const bit = 3 - k, on = hs >= 0 && ((hs >> bit) & 1);
        b.textContent = hs < 0 ? '·' : on ? 'T' : 'N';
        b.className = hs < 0 ? '' : on ? 't' : 'n';
      });
      this.btbCtr.textContent = e.counter >= 0 ? `→ counter ${e.counter}: ${DOCK_BTB_STATE[e.counter & 3]}` : hs < 0 ? 'no history (not in the BTB)' : '';
      this.btbLast2.textContent = `${e.way >= 0 ? `set ${hex2(e.set)} way ${e.way}` : 'no BTB entry'}${e.alloc ? ' · new entry' : ''} · ` +
        (e.right ? (e.penalty ? `+${e.penalty} clock${e.penalty === 1 ? '' : 's'} (a new fetch)` : 'no lost clocks') : `the fetch starts again: +${e.penalty} clocks`);
      this.btbLast2.className = 'cache-last ' + (e.right ? '' : 'no');
    }
    this.syncBtb686(true);
    if (this.sysPane !== 'btb' && this.sysTabBtns && !e.right) { const b = this.sysTabBtns.btb; b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); }
  }
  buildOoo686(P) {
    const bar = (lab, tip, max) => {
      const r = htmlEl('div', { class: 'p6-occ', title: tip }, P);
      htmlEl('span', { class: 'p6-lab' }, r, lab);
      const t = htmlEl('span', { class: 'p6-track' }, r), b = htmlEl('i', null, t);
      const n = htmlEl('b', null, r, `0 / ${max}`);
      return { b, n, max };
    };
    this.oooRob = bar('ROB', 'Reorder buffer: the µops in the machine at the issue of the newest µop (40 entries). They retire in program order.', 40);
    this.oooRs = bar('RS', 'Reservation station: the µops that wait for their operands or for a port (20 entries)', 20);
    const dl = htmlEl('dl', { class: 'sys-regs cache-stats p5-stats' }, P);
    this.oooEls = {};
    for (const [k, lab, tip] of [['upi', 'µops/instr', 'The µops for each x86 instruction (all since the reset)'], ['ipc', 'instr/clock', 'Retired instructions for each core clock, in the last part of the run'],
      ['upc', 'µops/clock', 'Retired µops for each core clock, in the last part of the run (the P6 retires up to 3 µops in a clock)'], ['instr', 'instructions', 'x86 instructions since the reset']]) {
      htmlEl('dt', { title: tip }, dl, lab);
      this.oooEls[k] = htmlEl('dd', null, dl, '—');
    }
    this.oooLast = htmlEl('div', { class: 'cache-last' }, P, 'the trace shows the last instruction here');
    this.oooLast2 = htmlEl('div', { class: 'cache-last' }, P, '');
    htmlEl('div', { class: 'p5-h' }, P, 'decoders (4-1-1): the instructions of D0, D1, D2 and the MSROM');
    const dm = htmlEl('div', { class: 'p6-dec', role: 'img', 'aria-label': 'The part of the instructions that each decoder took' }, P);
    this.oooDec = ['D0', 'D1', 'D2', 'MS'].map((n, i) => {
      const seg = htmlEl('i', { class: 'd' + i }, dm);
      return { seg, n };
    });
    this.oooDecT = htmlEl('div', { class: 'p5-legend p6-declg' }, P);
    this.oooDecL = ['D0 (up to 4 µops)', 'D1', 'D2', 'MSROM'].map((n, i) => htmlEl('span', { class: 'd' + i }, this.oooDecT, n));
    htmlEl('div', { class: 'p5-h' }, P, 'µops of each port');
    this.oooPortList = htmlEl('ol', { class: 'p5-why p6-ports' }, P);
    this.oooPorts = DOCK_PORTS.map(n => {
      const li = htmlEl('li', null, this.oooPortList);
      const b = htmlEl('i', null, li), t = htmlEl('span', null, li, 'port ' + n), v = htmlEl('b', null, li, '0');
      return { b, v };
    });
    htmlEl('div', { class: 'p5-h' }, P, 'stalls and events (the count, and each 1000 instructions)');
    this.oooList = htmlEl('ol', { class: 'p5-why' }, P);
    this.oooStall = DOCK_OOO_STALLS.map(([k, lab, tip]) => {
      const li = htmlEl('li', { title: tip }, this.oooList);
      const b = htmlEl('i', null, li), t = htmlEl('span', null, li, lab), v = htmlEl('b', null, li, '0');
      if (k === 'forwards') li.classList.add('ok');
      return { k, b, v, key: '' };
    });
    this.oooWin = { t: -1, i: 0, u: 0, c: 0, ipc: '—', upc: '—' };
  }
  syncOoo686(flash) {
    const c = this.m.cpu, st = c.oooStats, R = c.rob, S = c.rs;
    if (!this.oooEls || !st) return;
    const f = v => v.toLocaleString('en-US');
    // the occupancy at the issue clock of the newest µop
    let t = -1;
    for (let k = 0; k < 40; k++) if (R.issue[k] > t) t = R.issue[k];
    let nr = 0, ns = 0;
    if (t >= 0) {
      for (let k = 0; k < 40; k++) if (R.issue[k] >= 0 && R.issue[k] <= t && R.retire[k] > t) nr++;
      for (let k = 0; k < 20; k++) if (S.issue[k] >= 0 && S.issue[k] <= t && S.dispatch[k] > t) ns++;
    }
    for (const [o, v] of [[this.oooRob, nr], [this.oooRs, ns]]) {
      o.b.style.width = (v / o.max * 100).toFixed(1) + '%';
      this.setText(o.n, `${v} / ${o.max}`);
    }
    // the retire rate: a window of 20000 clocks or more
    const W = this.oooWin, cy = c.cycles;
    if (W.t < 0 || cy < W.c) {
      // the first look (or a reset): the rates since the reset
      W.t = 0; W.i = st.instructions; W.u = st.uops; W.c = cy;
      W.ipc = cy > 0 ? (st.instructions / cy).toFixed(2) : '—'; W.upc = cy > 0 ? (st.uops / cy).toFixed(2) : '—';
    }
    else if (cy - W.c >= 20000) {
      const dc = cy - W.c;
      W.ipc = ((st.instructions - W.i) / dc).toFixed(2);
      W.upc = ((st.uops - W.u) / dc).toFixed(2);
      W.i = st.instructions; W.u = st.uops; W.c = cy;
    }
    const vals = { upi: st.instructions ? (st.uops / st.instructions).toFixed(2) : '—', ipc: W.ipc, upc: W.upc, instr: f(st.instructions) };
    for (const k in vals) this.setText(this.oooEls[k], vals[k], flash && k === 'instr');
    // the decoders
    const D = st.decoders, dt = D[0] + D[1] + D[2] + D[3];
    this.oooDec.forEach((x, i) => { x.seg.style.flexGrow = dt ? (D[i] / dt).toFixed(4) : (i === 0 ? '1' : '0'); });
    const names = ['D0', 'D1', 'D2', 'MSROM'];
    this.oooDecL.forEach((el, i) => this.setText(el, `${names[i]} ${dt ? (D[i] / dt * 100).toFixed(0) : 0} %`));
    // the ports
    const PU = c.ports.uops;
    let pm = 1;
    for (let p = 0; p < 5; p++) if (PU[p] > pm) pm = PU[p];
    this.oooPorts.forEach((x, p) => { x.b.style.width = (PU[p] / pm * 100).toFixed(1) + '%'; this.setText(x.v, f(PU[p])); });
    // the stalls
    let mx = 1;
    for (const x of this.oooStall) if (st[x.k] > mx) mx = st[x.k];
    const ki = st.instructions / 1000;
    for (const x of this.oooStall) {
      const v = st[x.k] || 0, key = v + '|' + Math.round(ki);
      if (key === x.key) continue;
      x.key = key;
      x.b.style.width = (v / mx * 100).toFixed(1) + '%';
      x.v.textContent = `${f(v)}${ki >= 1 ? ` · ${(v / ki).toFixed(1)}` : ''}`;
    }
  }
  oooEvent686(e) {
    if (!this.oooLast) return;
    if (e.k === 'decode') {
      const dec = e.decoder === 'MS' ? 'the MSROM' : e.decoder || 'no decoder';
      const why = e.decoder === 'MS' ? 'more than 4 µops' : e.decoder === 'D0' ? (e.uops > 1 ? 'up to 4 µops: only D0 takes it' : 'the first of the group') : e.decoder ? '1 µop: a simple decoder' : '';
      const cut = s => { s = String(s || '').split(';')[0].trim(); return s.length > 26 ? s.slice(0, 25) + '…' : s; };
      this.oooLast.innerHTML = `last: ${cut(e.text)} · <b class="hit">${e.uops} µop${e.uops === 1 ? '' : 's'}</b> · ${dec}${why ? ' (' + why + ')' : ''}`;
      return;
    }
    // 'rob': the retire of the step
    this.oooLast2.textContent = `at the issue: ROB ${e.rob} / 40 · RS ${e.rs} / 20 · retire at clock ${f0(e.retire)}` + (e.floor ? ' · 1-clock floor' : '') + (e.debt > 0 ? ` · the step clock is ${e.debt} ahead` : '');
    this.syncOoo686(true);
    function f0(v) { return Math.round(v).toLocaleString('en-US'); }
  }

  // Micro-event from the playback.
  event(e) {
    if (e.k === 'desc' || e.k === 'sys' || e.k === 'task') this.syncSys(true);
    if (e.k === 'page' || e.k === 'tlb') { if (this.p5like) this.tlbEvent586(e); else if (this.is386) this.tlbEvent(e); return; }
    if (e.k === 'cache') { if (this.is486) this.cacheEvent(e); else if (this.is586) this.cacheEvent586(e); else if (this.is686) this.cacheEvent686(e); return; }
    if (e.k === 'btb') { if (this.is586) this.btbEvent586(e); else if (this.is686) this.btbEvent686(e); return; }
    if (e.k === 'rob') { if (this.is686) this.oooEvent686(e); return; }
    if (e.k === 'decode' && this.is686) this.oooEvent686(e);
    if (e.k === 'pipe') { if (this.is586) this.pipeEvent586(e); return; }
    if (e.k === 'reg') {
      if (this.is386 && /^CR/.test(e.r)) { this.syncSys(true); return; }
      this.setReg(e.r, e.v, true);
    } else if (e.k === 'flags') this.setReg(this.is386 ? 'EFLAGS' : 'FLAGS', e.v, true);
    else if (e.k === 'fpu') this.syncFpu(true);
  }
  // Full refresh from the machine (after an instruction, a fast frame or a reset).
  sync(flash) {
    for (const [name, src] of this.regList) this.setReg(name, this.read(src), flash);
    this.syncSys(flash);
    this.syncFpu(flash);
    this.syncStack();
    this.syncIO();
  }
  syncFpu(flash) {
    const f = this.m.fpu;
    if (!f) return;
    this.fpuSw.textContent = `SW ${hex4(f.sw)} CW ${hex4(f.cw)}`;
    for (let i = 0; i < 8; i++) {
      const row = this.fpuRows[i];
      const t = f.describe(i);
      if (t !== row.text) {
        row.text = t;
        row.v.textContent = t;
        row.li.classList.toggle('empty', f.tag(i) === 3);
        if (flash) {
          row.li.classList.add('hot');
          clearTimeout(row.timer);
          row.timer = setTimeout(() => row.li.classList.remove('hot'), 700);
        }
      }
    }
  }
  syncStack() {
    if (this.is386) { this.syncStack386(); return; }
    const c = this.m.cpu, ss = c.sregs[2], sp = c.regs[4];
    let html = '';
    for (let i = 0; i < 10; i++) {
      const off = (sp + i * 2) & 0xFFFF;
      const a = ((ss << 4) + off) & 0xFFFFF;
      const v = this.m.mem[a] | (this.m.mem[(a + 1) & 0xFFFFF] << 8);
      html += `<li class="${i === 0 ? 'top' : ''}"><span>${hex4(off)}</span><span>${hex4(v)}</span></li>`;
    }
    this.stackList.innerHTML = html;
  }
  // 80386: SS base + ESP (SP in a 16-bit stack), through the page tables; dwords in a 32-bit stack.
  syncStack386() {
    const m = this.m, c = m.cpu, s = c.cache[2], big = !!s.big;
    const sp = big ? c.regs32[4] >>> 0 : c.regs32[4] & 0xFFFF, w = big ? 4 : 2;
    const rd = lin => {
      const p = this.physOf(lin);
      if (p < 0) return -1;
      let v = 0;
      for (let k = w - 1; k >= 0; k--) v = v * 256 + (m.peek8 ? m.peek8(p + k) : m.mem[(p + k) & (m.mem.length - 1)]);
      return v;
    };
    let html = '';
    for (let i = 0; i < 10; i++) {
      const off = big ? (sp + i * 4) >>> 0 : (sp + i * 2) & 0xFFFF;
      const v = rd((s.base + off) >>> 0);
      const vt = v < 0 ? (w === 4 ? '--------' : '----') : hex(v, w * 2);
      html += `<li class="${i === 0 ? 'top' : ''}"><span>${off > 0xFFFF ? hex(off, 8) : hex4(off)}</span><span>${vt}</span></li>`;
    }
    this.stackList.innerHTML = html;
  }
  // Linear -> physical without bus cycles: the TLB, else the page tables (-1 = not present).
  physOf(lin) {
    const m = this.m, c = m.cpu;
    lin >>>= 0;
    if (!c.paging) return lin;
    if (this.p5like && c.peekPhys) return c.peekPhys(lin);   // the Pentium and the Pentium Pro know their 4 MB pages
    const e = c.tlbFind ? c.tlbFind(lin) : null;
    if (e) return (e.phys | (lin & 0xFFF)) >>> 0;
    const rd = a => { let v = 0; for (let k = 3; k >= 0; k--) v = v * 256 + (m.peek8 ? m.peek8((a + k) >>> 0) : m.mem[(a + k) & (m.mem.length - 1)]); return v >>> 0; };
    const pde = rd(((c.cr[3] & 0xFFFFF000) + (lin >>> 22) * 4) >>> 0);
    if (!(pde & 1)) return -1;
    const pte = rd(((pde & 0xFFFFF000) + ((lin >>> 12) & 0x3FF) * 4) >>> 0);
    if (!(pte & 1)) return -1;
    return ((pte & 0xFFFFF000) | (lin & 0xFFF)) >>> 0;
  }
  syncIO() {
    // ioCount changes with each port access (the log objects are a ring that the machine reuses)
    if (this.m.ioCount === this.ioSeen) return;
    this.ioSeen = this.m.ioCount;
    const log = this.m.ioLog;
    let html = '';
    for (const e of log.slice(-14)) {
      html += `<li><span class="dir-${e.dir}">${e.dir === 'out' ? 'OUT' : 'IN '}</span><span>${hex(e.port, e.port > 0xFF ? 4 : 2)}</span><span>${hex2(e.v)}</span></li>`;
    }
    this.ioList.innerHTML = html;
    this.ioList.scrollTop = this.ioList.scrollHeight;
  }
}
