// The Explain player: how a PC runs a few lines of assembly, one thing at a time.
// All values come from EXPLAIN_DATA (tools/explain-data.mjs runs the program on the emulator).
// The picture is a function of the time t: build() makes a list of beats (each with its caption,
// the parts it lights, its animations and the state changes at its times); frame(t) draws the
// state after all changes up to t, and the animations of the beats that run at t.
(() => {
  const D = EXPLAIN_DATA;
  const W = 1600, H = 724;
  const C = {
    void: '#120b1a', panel: '#1a1224', panel2: '#221830', line: '#33254a', ceramic: '#2a1d3a',
    text: '#ece4f5', muted: '#9d8fb3', faint: '#5d4f73',
    addr: '#5fd4ff', data: '#d8a94a', dataHi: '#f6d27a', ctrl: '#ff5fa2', phos: '#7dff9a', lav: '#b48cff',
  };
  const ICOL = ['#6fe3cf', '#b69cff', '#ffb27a', '#e9e56a'], XCOL = '#8f8aa0';
  const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace', SANS = '"IBM Plex Sans", system-ui, sans-serif', CRT = '"VT323", "IBM Plex Mono", monospace';
  const hx = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const ease = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const lerp = (a, b, p) => a + (b - a) * p;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- the layout (logical px) ----------
  const L = {
    prog: { x: 24, y: 14, w: 1552, h: 116 },
    cpu: { x: 24, y: 150, w: 676, h: 556 },
    eu: { x: 40, y: 192, w: 296, h: 500 },
    dec: { x: 54, y: 224, w: 268, h: 190 },
    regs: { x: 54, y: 428, w: 268, h: 176 },
    alu: { x: 54, y: 616, w: 268, h: 64 },
    biu: { x: 350, y: 192, w: 334, h: 500 },
    seg: { x: 364, y: 224, w: 150, h: 190 },
    adder: { x: 526, y: 224, w: 144, h: 190 },
    pins: { x: 364, y: 428, w: 306, h: 104 },
    queue: { x: 364, y: 560, w: 306, h: 120 },
    latch: { x: 740, y: 272, w: 70, h: 56 },
    xcv: { x: 740, y: 392, w: 70, h: 56 },
    bctl: { x: 740, y: 542, w: 70, h: 56 },
    ram: { x: 1044, y: 150, w: 532, h: 320 },
    cga: { x: 1044, y: 490, w: 286, h: 216 },
    screen: { x: 1344, y: 490, w: 232, h: 216 },
  };
  const PIPE = { addr: { y: 300, n: 20, th: 30 }, data: { y: 420, n: 16, th: 26 }, ctrl: { y: 570, n: 3, th: 12 } };
  // the paths of the bus: to the RAM and to the CGA card (the video memory)
  const PATH = {
    addr: { ram: [[700, 300], [1044, 300]], cga: [[700, 300], [1024, 300], [1024, 530], [1044, 530]] },
    data: { ram: [[700, 420], [1044, 420]], cga: [[700, 420], [1032, 420], [1032, 606], [1044, 606]] },
    ctrl: { ram: [[700, 570], [1016, 570], [1016, 456], [1044, 456]], cga: [[700, 570], [1044, 570]] },
  };
  // RAM cells: 16 bytes from the start of the program
  const ramCell = i => ({ x: 1066 + (i % 8) * 62, y: 234 + Math.floor(i / 8) * 104, w: 54, h: 46 });
  const vramCell = i => ({ x: 1064 + i * 62, y: 560, w: 54, h: 46 });
  const qSlot = i => ({ x: 374 + i * 49, y: 604, w: 42, h: 42 });
  const tileAtCard = (k, j) => ({ x: L.prog.x + k * 392 + 18 + j * 40, y: L.prog.y + 36 });
  const REGROW = { AX: 0, BX: 1, CX: 2, DX: 3 };
  const regBox = r => (r === 'AX' || r === 'AL' || r === 'AH' ? { x: 70, y: 472, w: 236, h: 54 } : { x: 70, y: 534 + (REGROW[r] - 1) * 23, w: 236, h: 20 });
  const SEGROW = { CS: 0, IP: 1, ES: 2, DS: 3, SS: 4 };
  const segBox = r => ({ x: 372, y: 248 + SEGROW[r] * 32, w: 134, h: 28 });

  // ---------- the bytes of the program ----------
  const prog = D.program.map((p, k) => ({ ...p, col: ICOL[k % ICOL.length] }));
  const colAt = a => { for (const p of prog) if (a >= p.lin && a < p.lin + p.bytes.length) return p.col; return XCOL; };
  const memAt = a => (a >= D.codeLin && a < D.codeLin + D.memory.length ? D.memory[a - D.codeLin] : 0);
  // what each byte of an instruction means (these four instructions and their relatives)
  const REG8 = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'], REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'], SREG = ['ES', 'CS', 'SS', 'DS'];
  function meaning(bytes) {
    const out = [];
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      if (b === 0x26 || b === 0x2E || b === 0x36 || b === 0x3E) { out.push({ n: 1, role: 'prefix', say: `take ${SREG[(b >> 3) & 3]} as the segment` }); i++; continue; }
      if (b >= 0xB8 && b <= 0xBF) { out.push({ n: 1, role: 'opcode', say: `MOV ${REG16[b & 7]}, a 16-bit number` }, { n: 2, role: 'number', say: `${hx(bytes[i + 1] | (bytes[i + 2] << 8), 4)}h (low byte first)` }); i += 3; continue; }
      if (b >= 0xB0 && b <= 0xB7) { const v = bytes[i + 1]; out.push({ n: 1, role: 'opcode', say: `MOV ${REG8[b & 7]}, an 8-bit number` }, { n: 1, role: 'number', say: `${hx(v, 2)}h${v >= 32 && v < 127 ? ` = '${String.fromCharCode(v)}'` : ''}` }); i += 2; continue; }
      if (b === 0x8E) { const m = bytes[i + 1]; out.push({ n: 1, role: 'opcode', say: 'MOV to a segment register' }, { n: 1, role: 'modrm', say: `from ${REG16[m & 7]} to ${SREG[(m >> 3) & 3]}` }); i += 2; continue; }
      if (b === 0xA2 || b === 0xA3) { out.push({ n: 1, role: 'opcode', say: `MOV [address], ${b === 0xA2 ? 'AL' : 'AX'}` }, { n: 2, role: 'address', say: `address ${hx(bytes[i + 1] | (bytes[i + 2] << 8), 4)}h` }); i += 3; continue; }
      out.push({ n: 1, role: 'byte', say: hx(b, 2) + 'h' }); i++;
    }
    return out;
  }

  // ---------- the script ----------
  const S = [];
  let T = 0;
  const beat = (d, o) => { const b = Object.assign({ t0: T, t1: T + d, d, focus: [], an: [], ch: [], snd: [] }, o); S.push(b); T += d; return b; };
  const at = (b, p, fn) => b.ch.push({ t: b.t0 + b.d * p, fn });
  const snd = (b, p, s) => b.snd.push({ t: b.t0 + b.d * p, s });
  const init = {
    regs: Object.assign({}, D.start.regs), queue: [], clock: 0, cur: -1, done: -1,
    vram: D.start.vram.slice(), screenA: 0, dec: null, flip: {}, adder: null, pipes: {}, cells: {}, vcells: {}, tState: '', note: '',
  };
  // the queue before the first instruction: the code bytes up to the first fetch address
  {
    const s0 = D.steps[0], f0 = s0.events.find(e => e.k === 'fetch');
    const upTo = f0 ? f0.addr : s0.lin + s0.events.find(e => e.k === 'decode').len;
    for (let a = s0.lin; a < upTo; a++) init.queue.push({ b: memAt(a), col: colAt(a), a });
  }
  let fetchedTo = null;
  let firstFetch = true, firstWrite = true;

  // A code fetch: the BIU adder, T1 the address (the latch keeps it), T2 the 8288 command,
  // T3 the data word, T4 the two bytes go into the queue.
  function fetchBeats(ev, st, detail, meanwhile) {
    const csv = st.before.CS, off = (ev.addr - csv * 16) & 0xFFFF, lo = memAt(ev.addr), hi = memAt(ev.addr + 1);
    const cellI = ev.addr - D.codeLin;
    const k = D.steps.indexOf(st);
    if (detail) {
      const b1 = beat(4.6, { focus: ['adder', 'seg'], cap: `The bus interface unit (BIU) keeps its own pointer to the next code bytes: <b>${hx(off, 4)}h</b>, ahead of IP. It makes the memory address: <b>CS × 16 + ${hx(off, 4)}h</b>.` });
      b1.an.push({ k: 'adder', seg: 'CS', segv: csv, off, phys: ev.addr, p0: 0.05, p1: 0.9 });
      at(b1, 0.92, s => { s.adder = { seg: 'CS', segv: csv, off, phys: ev.addr }; });
      snd(b1, 0.3, 'tick'); snd(b1, 0.6, 'tick'); snd(b1, 0.85, 'ding');
    }
    const dA = detail ? 3.8 : 1.2, dC = detail ? 2.4 : 0.7, dD = detail ? 4.2 : 1.4;
    const quick = meanwhile
      ? `Meanwhile the BIU fetches the next code word (address <b class="a">${hx(ev.addr, 5)}h</b>): the queue stays a little ahead of the EU.`
      : `A code fetch: address <b class="a">${hx(ev.addr, 5)}h</b>, <b class="c">MEMR</b>, and the word <b class="d">${hx(hi, 2)}${hx(lo, 2)}h</b> comes back. Its two bytes go into the queue.`;
    const bA = beat(dA, { focus: ['pins', 'latch', 'pAddr', 'ram'], tState: 'T1', cap: detail
      ? `<b>T1</b> · The address <b class="a">${hx(ev.addr, 5)}h</b> goes out on the 20 address wires. Each wire is one bit: bright = 1, dark = 0. The 8282 latch keeps it for the whole bus cycle.`
      : quick });
    bA.an.push({ k: 'pipe', pipe: 'addr', to: 'ram', v: ev.addr, label: hx(ev.addr, 5) + 'h', p0: 0, p1: 0.75 });
    at(bA, 0.78, s => { s.pipes.addr = { to: 'ram', v: ev.addr }; s.cells[cellI] = 1; s.cells[cellI + 1] = 1; });
    at(bA, 0.05, s => { s.clock++; });
    snd(bA, 0.02, 'addr');
    const bC = beat(dC, { focus: ['bctl', 'pCtrl', 'ram'], tState: 'T2', cap: detail
      ? `<b>T2</b> · The 8288 bus controller sends the command <b class="c">MEMR</b> (memory read) to the memory.`
      : quick });
    bC.an.push({ k: 'pipe', pipe: 'ctrl', to: 'ram', v: 0b010, label: 'MEMR', p0: 0, p1: 0.8 });
    at(bC, 0.05, s => { s.clock++; });
    at(bC, 0.8, s => { s.pipes.ctrl = { to: 'ram', v: 0b010, label: 'MEMR' }; });
    snd(bC, 0.02, 'ctrl');
    const bD = beat(dD, { focus: ['ram', 'xcv', 'pData', 'queue'], tState: 'T3', cap: detail
      ? `<b>T3–T4</b> · The RAM puts the word at ${hx(ev.addr, 5)}h on the 16 data wires: <b class="d">${hx(lo, 2)}</b> from the even address on the low 8 wires, <b class="d">${hx(hi, 2)}</b> on the high 8. Both bytes go into the queue.`
      : quick });
    bD.an.push({ k: 'pipe', pipe: 'data', to: 'ram', v: lo | (hi << 8), label: hx(hi, 2) + ' ' + hx(lo, 2), rev: true, p0: 0, p1: 0.55 });
    bD.an.push({ k: 'fetchTiles', cellI, lo, hi, a: ev.addr, p0: 0.05, p1: 0.95 });
    at(bD, 0.05, s => { s.clock++; });
    at(bD, 0.5, s => { s.clock++; });
    at(bD, 0.96, s => {
      s.queue.push({ b: lo, col: colAt(ev.addr), a: ev.addr }, { b: hi, col: colAt(ev.addr + 1), a: ev.addr + 1 });
      s.pipes = {}; s.cells = {}; s.adder = null;
    });
    snd(bD, 0.02, 'data'); snd(bD, 0.9, 'tick'); snd(bD, 0.97, 'tick');
    fetchedTo = ev.addr + 2;
  }

  // ---- the intro ----
  {
    const b0 = beat(4.2, { chapter: 'The program', focus: ['prog'], cap: 'This program has <b>four instructions</b>. The assembler changed each line into bytes: the colored tiles. The CPU sees only these bytes.' });
    snd(b0, 0.05, 'whoosh');
    const b1 = beat(4.4, { focus: ['cpu', 'eu', 'biu'], cap: 'The <b>8086 CPU</b> runs them. It has two parts: the <b>execution unit (EU)</b>, which decodes and executes, and the <b>bus interface unit (BIU)</b>, which talks to the bus.' });
    snd(b1, 0.05, 'whoosh');
    const b2 = beat(3.8, { focus: ['pAddr', 'pData', 'pCtrl', 'latch', 'xcv', 'bctl'], cap: 'The <b>bus</b> connects the CPU to the memory and to the cards: <b class="a">20 address wires</b>, <b class="d">16 data wires</b> and <b class="c">control wires</b>.' });
    snd(b2, 0.05, 'whoosh');
    const b3 = beat(3.0, { focus: ['ram'], cap: `The program bytes are in the <b>RAM</b>, from address <b>${hx(D.codeLin, 5)}h</b> (segment ${hx(D.seg, 4)}h, offset ${hx(D.org, 4)}h).` });
    snd(b3, 0.05, 'whoosh');
    const b4 = beat(3.8, { focus: ['cga', 'screen'], cap: 'The <b>CGA video card</b> has its own memory at B8000h. The screen shows what is in it. Now the screen is empty: each cell holds a space (20h).' });
    snd(b4, 0.05, 'whoosh');
    const b5 = beat(3.2, { focus: ['queue'], cap: `The BIU fetched the first code bytes before the program started. They wait in the <b>prefetch queue</b> (6 bytes).` });
    snd(b5, 0.3, 'tick');
  }

  // ---- the instructions ----
  D.steps.forEach((st, k) => {
    const dec = st.events.find(e => e.k === 'decode'), pop = st.events.find(e => e.k === 'queue' && e.op === 'pop');
    const need = dec.len, bytes = prog[k].bytes;
    const evs = st.events.filter(e => e.k === 'fetch' || e.k === 'bus' || e.k === 'ea' || (e.k === 'reg' && e.r !== 'IP'));
    const popT = pop ? pop.t : 0;
    const bi = beat(2.4, { chapter: `${k + 1} · ${st.text}`, focus: ['prog'], cap: `Instruction ${k + 1}: <code>${st.text}</code> · ${st.what}` });
    at(bi, 0.2, s => { s.cur = k; });
    snd(bi, 0.1, 'step');
    // the fetches before the decoder has all its bytes
    const early = evs.filter(e => e.k === 'fetch' && e.t < popT);
    if (early.length) {
      const have = Math.max(0, need - 2 * early.length);
      const bw = beat(3.2, { focus: ['queue', 'dec'], cap: `The decoder needs <b>${need} bytes</b>. The queue has only <b>${have}</b> of them, so the decoder waits for the BIU.` });
      bw.an.push({ k: 'needBar', need, p0: 0, p1: 1 });
    }
    for (const e of early) { fetchBeats(e, st, firstFetch); firstFetch = false; }
    // decode: the bytes leave the queue
    const mean = meaning(bytes);
    const bd = beat(1.4 + mean.length * 1.3, { focus: ['queue', 'dec'], cap: `The decoder takes <b>${need} bytes</b> from the queue: ${mean.map(m => `<b>${m.say}</b>`).join(' · ')}.` });
    bd.an.push({ k: 'toDec', n: need, col: prog[k].col, p0: 0, p1: 0.35 });
    bd.an.push({ k: 'decode', mean, bytes, col: prog[k].col, p0: 0.3, p1: 1 });
    at(bd, 0.02, s => { s.dq = s.queue.splice(0, need); });
    at(bd, 0.35, s => { s.dec = { bytes, col: prog[k].col, mean }; });
    snd(bd, 0.05, 'tick'); mean.forEach((m, i) => snd(bd, 0.35 + i * 0.6 / mean.length, 'type'));
    // the rest in the order of their clocks
    for (const e of evs.filter(x => !(x.k === 'fetch' && x.t < popT))) {
      if (e.k === 'fetch') {
        fetchBeats(e, st, false, true);
      } else if (e.k === 'ea') {
        const b = beat(4.6, { focus: ['adder', 'seg'], cap: `The BIU makes the address: <b>${e.seg} × 16 + ${hx(e.off, 4)}h</b>. ${e.seg} is ${hx(e.segv, 4)}h, so the address is <b class="a">${hx(e.phys, 5)}h</b>: the first cell of the video memory.` });
        b.an.push({ k: 'adder', seg: e.seg, segv: e.segv, off: e.off, phys: e.phys, p0: 0.05, p1: 0.85 });
        at(b, 0.9, s => { s.adder = { seg: e.seg, segv: e.segv, off: e.off, phys: e.phys }; });
        snd(b, 0.3, 'tick'); snd(b, 0.6, 'tick'); snd(b, 0.85, 'ding');
      } else if (e.k === 'bus') {
        const to = e.dev === 'vram' ? 'cga' : 'ram', vi = e.addr - 0xB8000, w = e.type === 'memw';
        const bA = beat(firstWrite ? 3.4 : 1.4, { focus: ['pins', 'latch', 'pAddr', to], tState: 'T1', cap: `<b>T1</b> · The address <b class="a">${hx(e.addr, 5)}h</b> goes out. It is on the CGA card: the card answers, not the RAM.` });
        bA.an.push({ k: 'pipe', pipe: 'addr', to, v: e.addr, label: hx(e.addr, 5) + 'h', p0: 0, p1: 0.75 });
        at(bA, 0.05, s => { s.clock++; });
        at(bA, 0.78, s => { s.pipes.addr = { to, v: e.addr }; s.vcells[vi] = 1; });
        snd(bA, 0.02, 'addr');
        const bC = beat(firstWrite ? 2.4 : 1, { focus: ['bctl', 'pCtrl', to], tState: 'T2', cap: `<b>T2</b> · The 8288 sends <b class="c">${w ? 'MEMW' : 'MEMR'}</b> (memory ${w ? 'write' : 'read'}).` });
        bC.an.push({ k: 'pipe', pipe: 'ctrl', to, v: w ? 0b100 : 0b010, label: w ? 'MEMW' : 'MEMR', p0: 0, p1: 0.8 });
        at(bC, 0.05, s => { s.clock++; });
        at(bC, 0.8, s => { s.pipes.ctrl = { to, v: w ? 0b100 : 0b010, label: w ? 'MEMW' : 'MEMR' }; });
        snd(bC, 0.02, 'ctrl');
        const bD = beat(firstWrite ? 4.4 : 1.6, { focus: ['regs', 'pins', 'xcv', 'pData', to], tState: 'T3', cap: `<b>T3–T4</b> · AL (<b class="d">${hx(e.data, 2)}h</b>) goes on the data wires. The address is even, so the byte uses the low 8 wires. The video memory stores it.` });
        bD.an.push({ k: 'regToBus', v: e.data, col: ICOL[2], p0: 0, p1: 0.3 });
        bD.an.push({ k: 'pipe', pipe: 'data', to, v: e.data, label: hx(e.data, 2) + 'h', p0: 0.25, p1: 0.85 });
        at(bD, 0.05, s => { s.clock++; });
        at(bD, 0.5, s => { s.clock++; });
        at(bD, 0.88, s => { s.vram[vi] = e.data; s.vflash = vi; });
        snd(bD, 0.25, 'data'); snd(bD, 0.88, 'land');
        at(bD, 0.99, s => { s.pipes = {}; s.vcells = {}; s.adder = null; });
        if (to === 'cga') {
          const bS = beat(5.0, { focus: ['cga', 'screen'], cap: `The CGA card reads its memory 60 times a second to draw the screen. At the next frame, cell 0 holds <b class="d">41h</b> = <b>'A'</b>, with the colour byte <b>07h</b> (grey on black). The letter appears.` });
          bS.an.push({ k: 'scan', p0: 0.05, p1: 0.7 });
          at(bS, 0.55, s => { s.screenA = 1; });
          snd(bS, 0.55, 'chime');
        }
        firstWrite = false;
      } else if (e.k === 'reg') {
        const r = e.r, v = e.v, old = st.before[r];
        const fromReg = st.text.match(/mov (\w+), (\w+)$/);
        const src = fromReg && REG16.includes(fromReg[2].toUpperCase()) ? fromReg[2].toUpperCase() : null;
        const part = /^mov al/.test(st.text) ? 'AL' : r;
        const toSeg = r === 'ES' || r === 'CS' || r === 'DS' || r === 'SS';
        const b = beat(3.0, { focus: src ? ['regs', 'seg'] : ['dec', toSeg ? 'seg' : 'regs'], cap: src
          ? `The value <b>${hx(v, 4)}h</b> goes from ${src} (in the EU) to <b>${r}</b> (in the BIU). Nothing goes on the bus: this happens inside the CPU.`
          : `The EU puts the number into <b>${part}</b>: ${r} was ${hx(old, 4)}h and is now <b>${hx(v, 4)}h</b>.` });
        b.an.push({ k: 'regFly', from: src ? 'reg:' + src : 'dec', to: r, part, v, col: prog[k].col, p0: 0.05, p1: 0.6 });
        at(b, 0.6, s => { s.regs[r] = v; s.flip[r] = { t: b.t0 + b.d * 0.6, old }; });
        snd(b, 0.6, 'flip');
      }
    }
    // the end of the instruction: IP and the clocks
    const ipNew = st.after.IP;
    const be = beat(2.8, { focus: ['seg', 'cpu'], cap: `Done. <b>IP</b> moves to <b>${hx(ipNew, 4)}h</b>, the next instruction. This instruction took <b>${st.cycles} clocks</b>${st.events.some(e => e.k === 'bus') ? '' : ' and no bus cycle for its own work'}.` });
    at(be, 0.3, s => { s.flip.IP = { t: be.t0 + be.d * 0.3, old: s.regs.IP }; s.regs.IP = ipNew; s.dec = null; s.done = k; s.clockTo = s.clockTo || 0; });
    at(be, 0.3, s => { s.clockBase = (s.clockBase || 0) + st.cycles; s.clock = 0; });
    snd(be, 0.3, 'flip');
  });
  // ---- the end ----
  {
    const fetches = D.steps.reduce((n, s) => n + s.events.filter(e => e.k === 'fetch').length, 0), writes = D.steps.reduce((n, s) => n + s.events.filter(e => e.k === 'bus').length, 0);
    const us = D.totalCycles / D.clockHz * 1e6;
    const b = beat(7, { chapter: 'The end', focus: ['screen', 'prog'], cap: `Four instructions, <b>${D.totalCycles} clocks</b>: ${us.toFixed(1)} µs at 4.77 MHz. The bus worked ${fetches + writes} times: <b>${fetches} code fetches</b> and <b>${writes} write</b> to the video memory. And a letter is on the screen.` });
    snd(b, 0.1, 'chime');
  }
  const TOTAL = T;
  const CHAPTERS = S.filter(b => b.chapter).map(b => ({ t: b.t0, name: b.chapter }));
  const CHANGES = S.flatMap(b => b.ch).sort((a, b) => a.t - b.t);
  const SOUNDS = S.flatMap(b => b.snd).sort((a, b) => a.t - b.t);

  // the parts and their parents (a lit part lights its parent a little)
  const PARENT = { eu: 'cpu', biu: 'cpu', dec: 'eu', regs: 'eu', alu: 'eu', seg: 'biu', adder: 'biu', pins: 'biu', queue: 'biu' };
  function levels(t) {
    const lv = {};
    for (const b of S) {
      if (t < b.t0 - 0.4 || t > b.t1 + 0.45) continue;
      const e = Math.min(clamp((t - (b.t0 - 0.3)) / 0.35, 0, 1), clamp(((b.t1 + 0.4) - t) / 0.4, 0, 1));
      for (const id of b.focus) lv[id] = Math.max(lv[id] || 0, e);
    }
    for (const id of Object.keys(lv)) { let p = PARENT[id]; while (p) { lv[p] = Math.max(lv[p] || 0, lv[id] * 0.55); p = PARENT[p]; } }
    return lv;
  }
  function stateAt(t) {
    const s = JSON.parse(JSON.stringify(init));
    for (const c of CHANGES) { if (c.t > t) break; c.fn(s); }
    return s;
  }
  const beatAt = t => { let cur = S[0]; for (const b of S) if (b.t0 <= t) cur = b; return cur; };

  // ---------- drawing ----------
  const cv = document.getElementById('xp-stage'), g = cv.getContext('2d');
  let dpr = 1;
  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.width * H / W * dpr);
  }
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const txt = (s, x, y, size, col, align = 'left', font = MONO, weight = 500) => { g.font = `${weight} ${Math.round(size * (size < 20 ? 1.18 : 1))}px ${font}`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
  const DIM = 0.32;
  const vis = l => DIM + (1 - DIM) * (l || 0);
  function box(r, l, col, title, sub) {
    const a = vis(l);
    g.save();
    g.globalAlpha = a;
    rr(r.x, r.y, r.w, r.h, 10);
    g.fillStyle = C.panel; g.fill();
    if (l > 0.5) { g.shadowColor = col; g.shadowBlur = 22 * l; }
    g.strokeStyle = l > 0.3 ? col : C.line; g.lineWidth = 1.5 + l; g.stroke();
    g.shadowBlur = 0;
    if (title) txt(title, r.x + 14, r.y + 18, 13, l > 0.3 ? col : C.muted, 'left', MONO, 600);
    if (sub) txt(sub, r.x + r.w - 12, r.y + 18, 12, C.faint, 'right');
    g.restore();
  }
  function tile(x, y, b, col, s = 1, a = 1, big = false) {
    const w = (big ? 46 : 36) * s;
    g.save(); g.globalAlpha = a;
    rr(x - w / 2, y - w / 2, w, w, 6 * s);
    g.fillStyle = col; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.stroke();
    txt(hx(b, 2), x, y + 1, (big ? 20 : 16) * s, '#120b1a', 'center', MONO, 700);
    g.restore();
  }
  const polyAt = (pts, p) => {
    let len = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); len += d; }
    let d = clamp(p, 0, 1) * len;
    for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const f = seg[i] ? d / seg[i] : 0; return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)]; } d -= seg[i]; }
    return pts[pts.length - 1].slice();
  };
  // a bundle of wires along a path, lit up to `front` (0..1) with the bits of v
  function wires(pipe, pts, front, v, col, lit, rev) {
    const P = PIPE[pipe], n = P.n, sp = P.th / n;
    g.save();
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * sp;
      const on = lit ? (pipe === 'ctrl' ? (v >> (n - 1 - i)) & 1 : (v >> (n - 1 - i)) & 1) : 0;
      g.beginPath();
      const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
      pts.forEach(([x, y], j) => {
        const n1 = j ? nrm(pts[j - 1], pts[j]) : null, n2 = j < pts.length - 1 ? nrm(pts[j], pts[j + 1]) : null;
        const nx = (n1 ? n1[0] : 0) + (n2 ? n2[0] : 0), ny = (n1 ? n1[1] : 0) + (n2 ? n2[1] : 0);
        const px = x + nx * off, py = y + ny * off;
        if (j === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.strokeStyle = C.line; g.globalAlpha = 0.9; g.lineWidth = Math.max(1, sp * 0.55); g.stroke();
      if (lit && front > 0) {
        g.save();
        const dash = polyLen(pts);
        g.setLineDash(rev ? [0, dash * (1 - front), dash * front, 0] : [dash * front, dash * 2]);
        g.strokeStyle = on ? col : col; g.globalAlpha = on ? 1 : 0.16;
        if (on) { g.shadowColor = col; g.shadowBlur = 8; }
        g.lineWidth = Math.max(1.2, sp * 0.7); g.stroke();
        g.restore();
      }
    }
    g.restore();
  }
  const polyLen = pts => { let n = 0; for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return n; };
  function label(s, x, y, col, a = 1) {
    g.save(); g.globalAlpha = a;
    g.font = `700 15px ${MONO}`;
    const w = g.measureText(s).width + 16;
    rr(x - w / 2, y - 13, w, 26, 6); g.fillStyle = C.void; g.fill(); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke();
    txt(s, x, y + 1, 15, col, 'center', MONO, 700);
    g.restore();
  }
  const FONT8 = { A: ['..##..', '.#..#.', '#....#', '#....#', '######', '#....#', '#....#', '......'] };

  function frame(t) {
    const s = stateAt(t), lv = levels(t), cur = beatAt(t);
    g.setTransform(cv.width / W, 0, 0, cv.width / W, 0, 0);
    g.fillStyle = C.void; g.fillRect(0, 0, W, H);
    // a faint grid (the drawing board)
    g.save(); g.globalAlpha = 0.07; g.strokeStyle = C.muted; g.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 140); g.lineTo(x, H); g.stroke(); }
    for (let y = 140; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.restore();

    // --- the program ---
    {
      const r = L.prog, l = lv.prog || 0;
      g.save(); g.globalAlpha = vis(Math.max(l, 0.35));
      txt('THE PROGRAM', r.x, r.y + 2, 12, C.muted, 'left', MONO, 600);
      g.restore();
      prog.forEach((p, k) => {
        const x = r.x + k * 392, y = r.y + 14, w = 380, h = 100, on = s.cur === k, done = s.done >= k;
        g.save(); g.globalAlpha = on ? 1 : vis(l * 0.8);
        rr(x, y, w, h, 10); g.fillStyle = on ? C.panel2 : C.panel; g.fill();
        if (on) { g.shadowColor = C.phos; g.shadowBlur = 18; }
        g.strokeStyle = on ? C.phos : C.line; g.lineWidth = on ? 2 : 1; g.stroke(); g.shadowBlur = 0;
        txt(`${hx(D.seg, 4)}:${hx(p.ip, 4)}`, x + w - 12, y + 16, 12, C.muted, 'right');
        txt(`${k + 1}`, x + 14, y + 16, 12, on ? C.phos : C.faint, 'left', MONO, 700);
        p.bytes.forEach((b, j) => tile(x + 36 + j * 40, y + 44, b, p.col, 0.92, done && !on ? 0.55 : 1));
        txt(p.text, x + 14, y + 80, 21, on ? C.text : C.muted, 'left', MONO, 600);
        if (done && !on) txt('✓', x + w - 18, y + 80, 18, C.phos, 'right');
        g.restore();
      });
    }

    // --- the CPU ---
    const stc = s.cur >= 0 && s.cur < D.steps.length ? D.steps[s.cur].cycles : 0;
    box(L.cpu, lv.cpu, C.lav, '8086 CPU', `4.77 MHz · clock ${(s.clockBase || 0) + Math.min(s.clock, stc)}`);
    box(L.eu, lv.eu, C.phos, 'EXECUTION UNIT (EU)');
    box(L.biu, lv.biu, C.addr, 'BUS INTERFACE UNIT (BIU)');
    // decoder
    box(L.dec, lv.dec, C.phos, 'DECODER');
    if (s.dec) {
      const dcy = L.dec.y + 62;
      s.dec.bytes.forEach((b, j) => tile(L.dec.x + 34 + j * 42, dcy, b, s.dec.col, 1));
    }
    // registers of the EU
    box(L.regs, lv.regs, C.phos, 'REGISTERS');
    {
      const r = regBox('AX'), a = vis(lv.regs), v = s.regs.AX;
      g.save(); g.globalAlpha = a;
      txt('AX', r.x, r.y + r.h / 2, 16, C.muted, 'left', MONO, 600);
      for (const [part, x0, val] of [['AH', r.x + 44, v >> 8], ['AL', r.x + 140, v & 0xFF]]) {
        rr(x0, r.y + 4, 90, r.h - 8, 6); g.fillStyle = C.void; g.fill(); g.strokeStyle = C.line; g.stroke();
        txt(part, x0 + 45, r.y - 6, 11, C.faint, 'center');
        drawFlip(t, s, 'AX', x0 + 45, r.y + r.h / 2 + 1, part === 'AH' ? 8 : 0, val);
      }
      for (const n of ['BX', 'CX', 'DX']) { const q = regBox(n); txt(n, q.x, q.y + 11, 13, C.faint, 'left', MONO, 600); txt(hx(s.regs[n], 4) + 'h', q.x + 236, q.y + 11, 13, C.faint, 'right'); }
      g.restore();
    }
    box(L.alu, lv.alu, C.phos, 'ALU', 'idle: a MOV only copies');
    // segment registers and IP
    box(L.seg, lv.seg, C.addr, 'SEGMENTS · IP');
    {
      const a = vis(lv.seg);
      g.save(); g.globalAlpha = a;
      for (const n of ['CS', 'IP', 'ES', 'DS', 'SS']) {
        const q = segBox(n);
        txt(n, q.x, q.y + q.h / 2, 14, n === 'IP' ? C.phos : C.muted, 'left', MONO, 600);
        rr(q.x + 34, q.y + 2, 96, q.h - 4, 5); g.fillStyle = C.void; g.fill(); g.strokeStyle = C.line; g.stroke();
        drawFlip(t, s, n, q.x + 82, q.y + q.h / 2 + 1, 0, s.regs[n], 4);
      }
      g.restore();
    }
    // the address adder
    box(L.adder, lv.adder, C.addr, 'ADDER  Σ');
    if (s.adder) drawAdder(s.adder, 1, 1);
    // pins and the queue
    box(L.pins, lv.pins, C.addr, 'PINS', 'AD0–15 · A16–19');
    {
      const a = vis(lv.pins);
      g.save(); g.globalAlpha = a;
      txt('address and data share the same pins:', L.pins.x + 14, L.pins.y + 52, 12, C.muted, 'left', SANS, 400);
      txt('first the address (T1), then the data (T3)', L.pins.x + 14, L.pins.y + 72, 12, C.muted, 'left', SANS, 400);
      g.restore();
    }
    box(L.queue, lv.queue, C.addr, 'PREFETCH QUEUE', '6 bytes');
    for (let i = 0; i < 6; i++) { const q = qSlot(i); g.save(); g.globalAlpha = vis(lv.queue) * 0.8; rr(q.x, q.y, q.w, q.h, 6); g.strokeStyle = C.line; g.setLineDash([4, 4]); g.stroke(); g.restore(); }
    s.queue.forEach((q, i) => { const sl = qSlot(i); tile(sl.x + sl.w / 2, sl.y + sl.h / 2, q.b, q.col, 1, vis(Math.max(lv.queue || 0, 0.4))); });

    // --- the bus ---
    for (const [p, id, col, name] of [['addr', 'pAddr', C.addr, 'ADDRESS · 20 wires'], ['data', 'pData', C.data, 'DATA · 16 wires'], ['ctrl', 'pCtrl', C.ctrl, 'CONTROL · MEMR MEMW']]) {
      g.save(); g.globalAlpha = vis(lv[id]);
      for (const to of ['ram', 'cga']) wires(p, PATH[p][to], 0, 0, col, false);
      txt(name, 848, PIPE[p].y - PIPE[p].th / 2 - 14, 12, lv[id] > 0.3 ? col : C.muted, 'left', MONO, 600);
      g.restore();
      const held = s.pipes[p];
      if (held) wires(p, PATH[p][held.to], 1, held.v, col, true, false);
    }
    box(L.latch, lv.latch, C.addr, '8282'); txtIn(L.latch, 'latch', lv.latch);
    box(L.xcv, lv.xcv, C.data, '8286'); txtIn(L.xcv, 'buffer', lv.xcv);
    box(L.bctl, lv.bctl, C.ctrl, '8288'); txtIn(L.bctl, 'bus ctrl', lv.bctl);
    if (cur.tState) { const a = clamp((t - cur.t0) / 0.3, 0, 1) * clamp((cur.t1 + 0.2 - t) / 0.3, 0, 1); label(`bus cycle · ${cur.tState}`, 856, 652, C.text, a); }

    // --- the RAM ---
    box(L.ram, lv.ram, C.data, 'RAM · 640 KB', `the program at ${hx(D.codeLin, 5)}h`);
    for (let i = 0; i < 16; i++) {
      const c = ramCell(i), a = D.codeLin + i, on = s.cells[i];
      g.save(); g.globalAlpha = vis(Math.max(lv.ram || 0, on ? 1 : 0) * 0.9 + 0.1);
      if (on) { rr(c.x - 4, c.y - 4, c.w + 8, c.h + 8, 8); g.strokeStyle = C.addr; g.lineWidth = 2; g.shadowColor = C.addr; g.shadowBlur = 14; g.stroke(); g.shadowBlur = 0; }
      tile(c.x + c.w / 2, c.y + c.h / 2, memAt(a), colAt(a), 1.2, 1);
      txt(hx(a, 5), c.x + c.w / 2, c.y + c.h + 14, 11, C.faint, 'center');
      g.restore();
    }
    // --- the CGA card and the screen ---
    box(L.cga, lv.cga, C.phos, 'CGA CARD', 'video memory B8000h');
    for (let i = 0; i < 4; i++) {
      const c = vramCell(i), a = 0xB8000 + i, on = s.vcells[i], v = s.vram[i];
      g.save(); g.globalAlpha = vis(Math.max(lv.cga || 0, on ? 1 : 0) * 0.9 + 0.1);
      rr(c.x, c.y, c.w, c.h, 6); g.fillStyle = s.vflash === i ? '#2f3a26' : C.void; g.fill();
      g.strokeStyle = on ? C.addr : C.line; g.lineWidth = on ? 2 : 1; if (on) { g.shadowColor = C.addr; g.shadowBlur = 12; } g.stroke(); g.shadowBlur = 0;
      txt(hx(v, 2), c.x + c.w / 2, c.y + c.h / 2 + 1, 20, i % 2 ? C.muted : (v === 0x41 ? C.phos : C.text), 'center', MONO, 700);
      txt(hx(a, 5), c.x + c.w / 2, c.y - 12, 11, C.faint, 'center');
      txt(i % 2 ? 'colour' : 'char', c.x + c.w / 2, c.y + c.h + 14, 11, C.faint, 'center');
      g.restore();
    }
    g.save(); g.globalAlpha = vis(lv.cga); txt('6845 CRT controller reads it', L.cga.x + 14, L.cga.y + 196, 12, C.muted, 'left', SANS, 400); g.restore();
    drawScreen(t, s, lv.screen || 0);

    // --- the animations of the beats that run now ---
    for (const b of S) {
      if (t < b.t0 || t > b.t1) continue;
      for (const an of b.an) {
        const p = clamp((t - (b.t0 + b.d * an.p0)) / (b.d * (an.p1 - an.p0)), 0, 1);
        if (t < b.t0 + b.d * an.p0) continue;
        drawAnim(an, reduced ? (p < 1 ? 0 : 1) : p, t, s);
      }
    }
    return s;
  }
  function txtIn(r, s, l) { g.save(); g.globalAlpha = vis(l); txt(s, r.x + r.w / 2, r.y + 38, 11, C.muted, 'center'); g.restore(); }

  // a register value with a flip (the digits roll when it changes)
  function drawFlip(t, s, reg, x, y, shift, val, digits) {
    const f = s.flip[reg], n = digits || 2;
    const cur = (val >>> 0) & (n === 4 ? 0xFFFF : 0xFF);
    if (!f || t - f.t > 0.7) { txt(hx(cur, n), x, y, n === 4 ? 17 : 24, C.text, 'center', MONO, 700); return; }
    const old = ((f.old >>> shift) & (n === 4 ? 0xFFFF : 0xFF));
    if (old === cur) { txt(hx(cur, n), x, y, n === 4 ? 17 : 24, C.text, 'center', MONO, 700); return; }
    const p = ease(clamp((t - f.t) / 0.6, 0, 1));
    g.save();
    g.beginPath(); g.rect(x - 60, y - 16, 120, 32); g.clip();
    txt(hx(old, n), x, y - p * 26, n === 4 ? 17 : 24, C.muted, 'center', MONO, 700);
    txt(hx(cur, n), x, y + (1 - p) * 26, n === 4 ? 17 : 24, C.phos, 'center', MONO, 700);
    g.restore();
  }
  // the adder: seg x 16 (the digits move one place left) + offset = the address
  function drawAdder(a, p, alpha) {
    const r = L.adder, x = r.x + r.w - 14;
    g.save(); g.globalAlpha = alpha;
    const rows = [
      [`${a.seg} ${hx(a.segv, 4)}`, C.muted, 0],
      [`×16 ${hx(a.segv * 16, 5)}`, C.addr, 0.25],
      [`+ ${hx(a.off, 4)}`, C.muted, 0.5],
      [`= ${hx(a.phys, 5)}`, C.addr, 0.75],
    ];
    rows.forEach(([s, col, p0], i) => {
      const q = clamp((p - p0) / 0.22, 0, 1);
      if (q <= 0) return;
      g.globalAlpha = alpha * q;
      txt(s, x + (1 - q) * 20, r.y + 54 + i * 34, i === 3 ? 19 : 16, col, 'right', MONO, i === 3 ? 700 : 600);
    });
    g.globalAlpha = alpha * clamp((p - 0.7) / 0.1, 0, 1);
    g.strokeStyle = C.addr; g.beginPath(); g.moveTo(r.x + 16, r.y + 138); g.lineTo(x, r.y + 138); g.stroke();
    g.restore();
  }
  function drawScreen(t, s, l) {
    const r = L.screen;
    g.save(); g.globalAlpha = vis(l);
    rr(r.x, r.y, r.w, r.h, 14); g.fillStyle = '#231b2e'; g.fill(); g.strokeStyle = l > 0.3 ? C.phos : C.line; g.lineWidth = 1.5; g.stroke();
    const sx = r.x + 14, sy = r.y + 16, sw = r.w - 28, sh = r.h - 60;
    rr(sx, sy, sw, sh, 8); g.fillStyle = '#050805'; g.fill();
    // 80 x 25 cells, very small; the top-left cell magnified
    g.globalAlpha = vis(l) * 0.25; g.fillStyle = C.phos;
    for (let yy = 0; yy < 25; yy++) g.fillRect(sx + 4, sy + 4 + yy * (sh - 8) / 25, 0.5, 0.5);
    g.globalAlpha = vis(l);
    if (s.screenA) {
      const px = 7, ox = sx + 16, oy = sy + 18;
      g.shadowColor = C.phos; g.shadowBlur = 14;
      g.fillStyle = C.phos;
      FONT8.A.forEach((row, yy) => [...row].forEach((c, xx) => { if (c === '#') g.fillRect(ox + xx * px, oy + yy * px, px - 1, px - 1); }));
      g.shadowBlur = 0;
    }
    // the cursor
    if (Math.floor(t * 2) % 2 === 0) { g.fillStyle = C.phos; g.fillRect(sx + 16 + (s.screenA ? 48 : 0), sy + 18 + 56, 36, 5); }
    txt('SCREEN · cell 0 (top left)', r.x + r.w / 2, r.y + r.h - 22, 12, C.muted, 'center', MONO, 500);
    g.restore();
  }
  function drawAnim(an, p, t, s) {
    const e = ease(p);
    switch (an.k) {
      case 'pipe': {
        const col = an.pipe === 'addr' ? C.addr : an.pipe === 'data' ? C.data : C.ctrl;
        const pts = PATH[an.pipe][an.to];
        wires(an.pipe, pts, e, an.v, col, true, !!an.rev);
        const q = polyAt(an.rev ? pts.slice().reverse() : pts, e);
        label(an.label, q[0], q[1] - PIPE[an.pipe].th / 2 - 18, col);
        break;
      }
      case 'fetchTiles': {
        // the two bytes: from the RAM cells, back along the data wires, into the queue
        const c0 = ramCell(an.cellI), c1 = ramCell(an.cellI + 1), n = s.queue.length;
        const s0 = qSlot(n), s1 = qSlot(n + 1);
        const path = (c, sl) => [[c.x + c.w / 2, c.y + c.h / 2], [c.x + c.w / 2, 420], [700, 420], [660, 420], [sl.x + sl.w / 2, 470], [sl.x + sl.w / 2, sl.y + sl.h / 2]];
        [[c0, s0, an.lo, an.a], [c1, s1, an.hi, an.a + 1]].forEach(([c, sl, b, a], i) => {
          const q = polyAt(path(c, sl), ease(clamp(p * 1.1 - i * 0.1, 0, 1)));
          tile(q[0], q[1], b, colAt(a), 1.1, 1);
        });
        break;
      }
      case 'toDec': {
        for (let i = 0; i < an.n; i++) {
          const sl = qSlot(i), q = [lerp(sl.x + sl.w / 2, L.dec.x + 34 + i * 42, e), lerp(sl.y + sl.h / 2, L.dec.y + 62, e) - Math.sin(Math.PI * e) * 60];
          const b = s.dq ? s.dq[i] : null;
          if (b) tile(q[0], q[1], b.b, b.col, 1, 1);
        }
        break;
      }
      case 'decode': {
        // each part of the instruction: its bytes are marked, and a line says what they mean
        let j = 0;
        an.mean.forEach((m, i) => {
          const q = clamp(p * an.mean.length - i, 0, 1);
          if (q > 0) {
            const x0 = L.dec.x + 34 + j * 42 - 18, w = m.n * 42 - 6;
            g.save(); g.globalAlpha = q;
            g.strokeStyle = C.phos; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, L.dec.y + 88); g.lineTo(x0 + w, L.dec.y + 88); g.stroke();
            const say = m.say.slice(0, Math.ceil(m.say.length * clamp(q * 1.6, 0, 1)));
            txt(m.role.toUpperCase(), L.dec.x + 14, L.dec.y + 110 + i * 26, 9, C.muted, 'left', MONO, 700);
            txt(say, L.dec.x + 80, L.dec.y + 110 + i * 26, 12, C.text, 'left', SANS, 500);
            g.restore();
          }
          j += m.n;
        });
        break;
      }
      case 'adder': drawAdder(an, p, 1); break;
      case 'regFly': {
        const from = an.from === 'dec' ? [L.dec.x + 110, L.dec.y + 62] : (() => { const r = regBox(an.from.slice(4)); return [r.x + 140, r.y + r.h / 2]; })();
        const dst = an.to === 'ES' || an.to === 'CS' || an.to === 'DS' || an.to === 'SS' ? (() => { const q = segBox(an.to); return [q.x + 82, q.y + q.h / 2]; })()
          : (() => { const r = regBox('AX'); return [an.part === 'AL' ? r.x + 185 : r.x + 140, r.y + r.h / 2]; })();
        const q = [lerp(from[0], dst[0], e), lerp(from[1], dst[1], e) - Math.sin(Math.PI * e) * 50];
        const v = an.part === 'AL' ? an.v & 0xFF : an.v;
        label(hx(v, an.part === 'AL' ? 2 : 4) + 'h', q[0], q[1], C.phos, p < 1 ? 1 : 0);
        break;
      }
      case 'regToBus': {
        const r = regBox('AX'), q = [lerp(r.x + 185, 700, e), lerp(r.y + r.h / 2, 420, e) - Math.sin(Math.PI * e) * 40];
        tile(q[0], q[1], an.v, an.col, 1.1, 1);
        break;
      }
      case 'needBar': {
        const n = an.need, have = s.queue.length;
        for (let i = 0; i < n; i++) {
          const sl = qSlot(i);
          g.save(); g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6);
          if (i >= have) { rr(sl.x, sl.y, sl.w, sl.h, 6); g.strokeStyle = C.ctrl; g.lineWidth = 2; g.setLineDash([5, 4]); g.stroke(); txt('?', sl.x + sl.w / 2, sl.y + sl.h / 2, 18, C.ctrl, 'center', MONO, 700); }
          g.restore();
        }
        break;
      }
      case 'scan': {
        const r = L.screen, sy = r.y + 16, sh = r.h - 60, y = sy + sh * p;
        g.save(); g.globalAlpha = 0.6 * (1 - p * 0.5); g.fillStyle = C.phos;
        g.fillRect(r.x + 14, y - 2, r.w - 28, 3); g.shadowColor = C.phos; g.shadowBlur = 16; g.fillRect(r.x + 14, y - 1, r.w - 28, 1);
        g.restore();
        break;
      }
    }
  }

  // ---------- sound (Web Audio, made here; it starts with the Start button) ----------
  let ac = null, soundOn = true;
  try { const v = localStorage.getItem('xp:sound'); if (v !== null) soundOn = v === '1'; } catch (e) { /* the default */ }
  function tone(f, dur, type = 'sine', vol = 0.05, f2) {
    if (!ac || !soundOn) return;
    const o = ac.createOscillator(), a = ac.createGain(), n = ac.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, n);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, n + dur);
    a.gain.setValueAtTime(0.0001, n); a.gain.exponentialRampToValueAtTime(vol, n + 0.01); a.gain.exponentialRampToValueAtTime(0.0001, n + dur);
    o.connect(a).connect(ac.destination); o.start(n); o.stop(n + dur + 0.02);
  }
  const SFX = {
    tick: () => tone(1800, 0.05, 'square', 0.02),
    land: () => { tone(520, 0.12, 'triangle', 0.06); tone(1040, 0.08, 'sine', 0.03); },
    type: () => tone(2400 + Math.random() * 400, 0.03, 'square', 0.012),
    addr: () => tone(900, 0.35, 'sine', 0.04, 1500),
    ctrl: () => tone(420, 0.2, 'sawtooth', 0.02, 640),
    data: () => tone(700, 0.4, 'sine', 0.04, 440),
    flip: () => { tone(1500, 0.04, 'square', 0.02); setTimeout(() => tone(1900, 0.04, 'square', 0.02), 60); },
    ding: () => tone(1320, 0.3, 'sine', 0.04),
    step: () => tone(330, 0.25, 'triangle', 0.05, 495),
    whoosh: () => tone(200, 0.4, 'sine', 0.03, 520),
    chime: () => { tone(1046, 1.2, 'sine', 0.06); tone(1568, 1.4, 'sine', 0.035); tone(2093, 0.9, 'sine', 0.02); },
  };

  // ---------- the player ----------
  const $ = id => document.getElementById(id);
  const capEl = $('xp-cap'), chapEl = $('xp-chap'), bar = $('xp-bar'), fill = $('xp-fill'), timeEl = $('xp-time'), playBtn = $('xp-play'), chapsEl = $('xp-chaps');
  let t = 0, playing = false, last = 0, speed = 1, lastCap = null, started = false;
  CHAPTERS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'xp-chip'; b.textContent = c.name; b.dataset.i = i;
    b.addEventListener('click', () => { seek(c.t + 0.01); if (!playing) play(); });
    chapsEl.appendChild(b);
    const tick = document.createElement('i'); tick.style.left = (100 * c.t / TOTAL) + '%'; bar.appendChild(tick);
  });
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function ui() {
    const b = beatAt(t);
    if (b !== lastCap) {
      lastCap = b;
      capEl.innerHTML = b.cap || '';
      const ch = CHAPTERS.filter(c => c.t <= t + 1e-6).pop();
      chapEl.textContent = ch ? ch.name : '';
      chapsEl.querySelectorAll('.xp-chip').forEach((el, i) => el.classList.toggle('on', CHAPTERS[i] === ch));
    }
    fill.style.width = (100 * t / TOTAL) + '%';
    timeEl.textContent = `${fmt(t)} / ${fmt(TOTAL)}`;
    playBtn.textContent = playing ? 'Pause' : t >= TOTAL ? 'Replay' : 'Play';
    playBtn.setAttribute('aria-label', playBtn.textContent);
  }
  function seek(x) { t = clamp(x, 0, TOTAL); frame(t); ui(); }
  function play() {
    if (!started) { started = true; $('xp-start').hidden = true; try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    if (t >= TOTAL) t = 0;
    playing = true; last = performance.now(); requestAnimationFrame(loop); ui();
  }
  function pause() { playing = false; ui(); }
  function loop(now) {
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000) * speed, t0 = t;
    last = now;
    t = Math.min(TOTAL, t + dt);
    for (const s of SOUNDS) if (s.t > t0 && s.t <= t && SFX[s.s]) SFX[s.s]();
    frame(t); ui();
    if (t >= TOTAL) { playing = false; ui(); return; }
    requestAnimationFrame(loop);
  }
  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  $('xp-start-btn').addEventListener('click', play);
  $('xp-restart').addEventListener('click', () => { seek(0); play(); });
  const speeds = [0.5, 0.75, 1, 1.5, 2];
  const spBtn = $('xp-speed');
  spBtn.addEventListener('click', () => { speed = speeds[(speeds.indexOf(speed) + 1) % speeds.length]; spBtn.textContent = speed + '×'; });
  const sBtn = $('xp-sound');
  const syncSound = () => { sBtn.textContent = soundOn ? 'Sound on' : 'Sound off'; sBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false'); };
  sBtn.addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('xp:sound', soundOn ? '1' : '0'); } catch (e) { /* only for this visit */ } syncSound(); });
  syncSound();
  // the bar: click or drag to a time
  const barTo = e => { const r = bar.getBoundingClientRect(); seek(TOTAL * clamp((e.clientX - r.left) / r.width, 0, 1)); };
  bar.addEventListener('pointerdown', e => { bar.setPointerCapture(e.pointerId); barTo(e); const mv = ev => barTo(ev); bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', mv), { once: true }); });
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === 'ArrowRight') { const c = CHAPTERS.find(c => c.t > t + 0.05); if (c) seek(c.t + 0.01); }
    else if (e.key === 'ArrowLeft') { const cs = CHAPTERS.filter(c => c.t < t - 1); seek(cs.length ? cs[cs.length - 1].t + 0.01 : 0); }
  });
  window.addEventListener('resize', () => { resize(); frame(t); });
  resize();
  // the first picture: the whole machine, softly lit, before Start
  seek(0);
  window.__xp = { seek, frame, get t() { return t; }, TOTAL, S, CHAPTERS };
})();
