// Trace stories: the micro-events of one instruction become an ordered list of steps
// that a person can follow one at a time. Each step moves one value from one part of
// the machine to the next part (or tells what happens inside the CPU).
// No DOM here: tests run it in Node. The views turn each step into a picture.

const Story = (() => {
  const M486 = typeof CPU_MODEL !== 'undefined' && CPU_MODEL === '80486';
  const M586 = typeof CPU_MODEL !== 'undefined' && CPU_MODEL === '80586';
  const M686 = typeof CPU_MODEL !== 'undefined' && CPU_MODEL === '80686';
  const M386 = typeof CPU_MODEL !== 'undefined' && (CPU_MODEL === '80386' || M486 || M586 || M686);
  const QSIZE = M486 || M586 || M686 ? 32 : M386 ? 16 : 6;   // the bytes of the prefetch queue
  const M286 = typeof CPU_MODEL !== 'undefined' && (CPU_MODEL === '80286' || M386);   // the AT board
  const VGA_ON = typeof VIDEO_CARD !== 'undefined' && VIDEO_CARD === 'vga';
  const N = M686
    ? { cpu: 'Pentium Pro', fpu: 'FPU of the Pentium Pro', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A3–A35 and BE0–BE7', status: 'REQ0–REQ4', dec: 'PAL16L8 decoder', aw: 6 }
    : M586
    ? { cpu: 'Pentium', fpu: 'FPU of the Pentium', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A3–A31 and BE0–BE7', status: 'W/R, D/C and M/IO', dec: 'PAL16L8 decoder', aw: 6 }
    : M486
    ? { cpu: '80486', fpu: 'FPU of the 80486', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A2–A31 and BE0–BE3', status: 'W/R, D/C and M/IO', dec: 'PAL16L8 decoder', aw: 6 }
    : M386
    ? { cpu: '80386', fpu: '80387', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A1–A23, BHE and BLE', status: 'W/R, D/C and M/IO', dec: 'PAL16L8 decoder', aw: 6 }
    : M286
    ? { cpu: '80286', fpu: '80287', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A0–A23', status: 'S1, S0 and M/IO', dec: 'PAL16L8 decoder', aw: 6 }
    : { cpu: '8086', fpu: '8087', lat: '8282', xcv: '8286', bus: '8288', abus: 'AD0–AD15 and A16–A19', status: 'S2–S0', dec: '74LS138', aw: 5 };
  const ALIAS = M286 ? { a20: 'kbc', nmi: 'rtc' } : {};
  const STATUS = { inta: 0, ior: 1, iow: 2, halt: 3, fetch: 4, memr: 5, memw: 6 };
  const STATUS_NAME = ['interrupt acknowledge', 'I/O read', 'I/O write', 'halt', 'code fetch', 'memory read', 'memory write'];
  const CMD = { fetch: 'MRDC', memr: 'MRDC', memw: 'MWTC', ior: 'IORC', iow: 'IOWC', inta: 'INTA' };
  const DEV = {
    pic: '8259A interrupt controller', pic2: 'slave 8259A', pit: M286 ? '8254 timer' : '8253 timer', ppi: M286 ? 'port 61h logic' : '8255 PPI',
    dma: '8237 DMA controller', dma2: 'second 8237 DMA controller', nmi: 'NMI mask latch', kbc: '8042 keyboard controller', rtc: 'MC146818 clock and CMOS',
    fpu: M286 ? '80287' : '8087', vram: VGA_ON ? 'VGA video memory' : 'CGA video RAM', crtc: '6845 CRT controller', cga: 'CGA mode register',
    vga: 'VGA controller', vrom: 'VGA BIOS ROM', fdc: 'floppy controller', xram: 'extended memory card', none: 'nothing (no device answers)',
    sb: 'Sound Blaster DSP', opl: 'YM3812 FM synthesizer', hdc: 'IDE hard disk controller',
  };
  const SLOT = { vram: 1, crtc: 1, cga: 1, fdc: 1, hdc: 1, xram: 1, vga: 1, vrom: 1, sb: 1, opl: 1 };
  const clean = t => String(t || '').split(';')[0].trim();   // no disassembler comments
  // Status bits: S2-S0 on the 8086; M/IO, S1, S0 on the 80286 (a code read also sets COD/INTA).
  const statusBits = k => (M286 ? { inta: '000', ior: '001', iow: '010', halt: '100', fetch: '101', memr: '101', memw: '110' }[k]
    : STATUS[k].toString(2).padStart(3, '0'));
  const h = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
  const hA = v => h(v & (M286 ? 0xFFFFFF : 0xFFFFF), N.aw) + 'h';

  // The facts of one bus cycle.
  function busInfo(e) {
    const kind = e.k === 'fetch' ? 'fetch' : e.type;
    const fpu = e.owner === 'fpu';
    const read = kind === 'fetch' || kind === 'memr' || kind === 'ior' || kind === 'inta';
    let dev = kind === 'inta' ? 'pic' : (e.dev || 'none');
    dev = ALIAS[dev] || dev;
    const addr = e.addr >>> 0, width = e.width || 1, odd = addr & 1;
    const mem = dev === 'ram' || dev === 'rom' || dev === 'vram' || dev === 'xram' || dev === 'vrom';
    const lo = !mem || width >= 2 || !odd, hi = mem && (width >= 2 || !!odd);
    // 4 bytes: data is the dword; 8 bytes (a transfer of the 64-bit bus): data is the low dword, dhi the high dword
    const data = width >= 4 ? e.data >>> 0 : e.data & (width === 2 ? 0xFFFF : 0xFF);
    const dhi = width === 8 ? (e.hi >>> 0) || 0 : 0;
    return { kind, fpu, read, dev, addr, width, mem, lo, hi, data, dhi, io: kind === 'ior' || kind === 'iow', slot: !!SLOT[dev] };
  }
  function devName(I) {
    if (I.dev === 'ram' || I.dev === 'rom') {
      const what = I.dev === 'ram' ? 'RAM' : 'BIOS ROM';
      return I.lo && I.hi ? `${what} (both banks)` : `${what} (${I.lo ? 'even' : 'odd'} bank)`;
    }
    if (I.dev === 'vga' && I.io) return (I.addr & 0xFFFF) >= 0x3C6 && (I.addr & 0xFFFF) <= 0x3C9 ? 'RAMDAC palette' : 'VGA controller';
    return DEV[I.dev] || I.dev;
  }
  const valText = I => (I.width === 8 ? h(I.dhi, 8) + h(I.data, 8) : h(I.data, 2 * Math.min(4, I.width))) + 'h';
  // code bytes in memory order: the low byte comes first
  const bytesOf = I => Array.from({ length: Math.min(8, I.width) }, (_, k) => (k < 4 ? I.data >>> (8 * k) : I.dhi >>> (8 * (k - 4))) & 0xFF);
  const codeText = I => bytesOf(I).map(b => h(b, 2)).join(' ');
  const where = I => (I.io ? `port ${h(I.addr & 0xFFFF, I.addr > 0xFF ? 3 : 2)}h` : hA(I.addr));

  // Three steps for one bus cycle: address out, command, data.
  function busSteps(e, opt, qLen) {
    const I = busInfo(e);
    const code = I.kind === 'fetch';
    const who = I.fpu ? N.fpu : N.cpu;
    const name = devName(I);
    const t = e.t || 0, len = e.len || 4;
    const lane = I.kind === 'fetch' ? 'BIU' : I.fpu ? N.fpu : 'EU';
    const base = { kind: 'bus', e, I, lane, dev: I.dev };
    const out = [];
    if (I.kind === 'halt') {
      out.push({ ...base, phase: 'cmd', t, title: 'Halt', token: { tag: 'HALT', val: '', col: 'ctrl' }, fromName: who, toName: N.bus,
        text: `The ${who} shows the status "halt" on ${N.status}. The ${N.bus} gives no command. The CPU waits for an interrupt.`,
        sum: 'status: halt' });
      return out;
    }
    const cs = !I.slot && I.dev !== 'none' && I.dev !== 'fpu';
    const cmdText = I.kind === 'inta'
      ? `The ${N.bus} sends INTA to the 8259A. The 8259A gets ready to give its vector.`
      : `The ${N.bus} reads ${N.status} = ${statusBits(I.kind)} (${STATUS_NAME[STATUS[I.kind]]}${M286 && I.kind === 'fetch' ? ', COD/INTA high' : ''}) and sends ${CMD[I.kind]} to the ${name}.` +
        (cs ? ` The ${N.dec} decodes the address and selects the ${name}.` : I.slot ? ' The card in the slot decodes the address itself.' : '');
    if (I.kind === 'fetch' && opt.prefetch === 'short') {
      const n = I.width;
      out.push({ ...base, phase: 'all', t, title: 'Prefetch', token: { tag: 'CODE', val: codeText(I), col: 'data' }, fromName: name, toName: `${who} queue`,
        text: `The BIU fetches ${n} code byte${n > 1 ? 's' : ''} at ${hA(I.addr)} from the ${name}. The bytes go into the queue (${qLen} of ${QSIZE}). ${M686 ? 'The fetch unit does this before the decoders need the bytes.' : 'The BIU does this in parallel with the EU.'}`,
        sum: `prefetch ${hA(I.addr)} → queue` });
      return out;
    }
    if (I.kind !== 'inta') {
      const latch = M286 ? `ALE makes the ${N.lat} latches hold it` : `ALE makes the ${N.lat} latches hold it, because the AD lines carry data next`;
      out.push({ ...base, phase: 'addr', t, title: `${M286 ? 'Ts' : 'T1'} · Address`, token: { tag: I.io ? 'PORT' : 'ADDR', val: where(I), col: I.fpu ? 'fpu' : 'addr' }, fromName: who, toName: name,
        text: `The ${who} puts the ${I.io ? 'port number' : 'address'} ${where(I)} on ${N.abus}. ${latch}. The address goes on the system bus to the ${name}.`,
        sum: `${I.io ? 'port' : 'address'} ${where(I)} → ${name}` });
    }
    out.push({ ...base, phase: 'cmd', t: t + 1, title: `${M286 ? 'Tc' : 'T2'} · Command`, token: { tag: CMD[I.kind], val: '', col: 'ctrl' }, fromName: N.bus, toName: I.kind === 'inta' ? '8259A' : name,
      text: cmdText, sum: `${CMD[I.kind]} → ${name}` });
    const v = code ? codeText(I) : valText(I);
    let text, sum;
    if (I.kind === 'inta') {
      text = `The 8259A puts the interrupt vector ${h(I.data, 2)}h on the data bus. The ${N.xcv} transceivers pass it to the ${who}.`;
      sum = `vector ${h(I.data, 2)}h → ${who}`;
    } else if (I.read) {
      text = `The ${name} puts ${v} on the data bus. The ${N.xcv} transceivers pass it to the ${who}.` +
        (e.burst ? ` It is transfer ${e.beat + 1} of ${Math.round((M486 ? 16 : 32) / I.width)} of the burst.` : '') +
        (I.kind === 'fetch' ? ` The BIU puts the bytes in the queue (${qLen} of ${QSIZE}).` : I.fpu ? '' : ' The EU gets the value.');
      sum = `data ${v} → ${who}${I.kind === 'fetch' ? ' queue' : ''}`;
    } else {
      text = `The ${who} puts ${v} on the data bus. The ${N.xcv} transceivers send it to the ${name}, which keeps it.`;
      sum = `data ${v} → ${name}`;
    }
    out.push({ ...base, phase: 'data', t: t + Math.max(2, len - 2), title: `${M286 ? 'Tc' : 'T3'} · Data`, token: { tag: code ? 'CODE' : I.kind === 'inta' ? 'VECTOR' : 'DATA', val: v, col: I.fpu ? 'fpu' : 'data' }, text, sum,
      fromName: I.read ? (I.kind === 'inta' ? '8259A' : name) : who, toName: I.read ? (code ? `${who} queue` : who) : name });
    return out;
  }

  const FLAG_BITS = [['CF', 0], ['PF', 2], ['AF', 4], ['ZF', 6], ['SF', 7], ['TF', 8], ['IF', 9], ['DF', 10], ['OF', 11]];
  function flagText(e) {
    if (e.old === undefined) return `the flags change to ${h(e.v, 4)}h`;
    const ch = [];
    for (const [n, b] of FLAG_BITS) if (((e.v ^ e.old) >> b) & 1) ch.push(`${n}=${(e.v >> b) & 1}`);
    return ch.length ? 'flags ' + ch.join(', ') : '';
  }
  // One step for a group of events inside the CPU (no bus cycle).
  function insideStep(evs, dec, flushed) {
    const lines = [];
    let tag = 'EU', val = '', t = 0, unit = 'cpu', title = 'Inside the CPU';
    for (const e of evs) {
      t = Math.max(t, e.t || 0);
      switch (e.k) {
        case 'decode':
          if (!e.len) break;
          title = 'Decode';
          tag = 'DECODE';
          val = clean(e.text).split(' ')[0].toUpperCase();
          lines.push(`The EU takes ${e.len} byte${e.len > 1 ? 's' : ''} from the queue and decodes "${clean(e.text)}".`);
          break;
        case 'queue':
          if (e.op === 'flush') lines.push('The jump empties the queue. The BIU starts to fetch at the new address.');
          break;
        case 'ea':
          title = 'Address calculation';
          lines.push(M286 ? `The address unit adds the ${e.seg} base and the offset ${h(e.off, 4)}h: ${hA(e.phys)}.`
            : `The BIU adder calculates ${e.seg} × 16 + ${h(e.off, 4)}h = ${hA(e.phys)}.`);
          if (tag === 'EU') { tag = 'EA'; val = hA(e.phys); }
          break;
        case 'alu': {
          const n = e.w === 16 ? 4 : 2;
          lines.push(`The ALU does ${e.op} ${h(e.a, n)}h, ${h(e.b, n)}h and gets ${h(e.r, n)}h.`);
          if (tag === 'EU' || tag === 'EA') { tag = e.op; val = h(e.r, n) + 'h'; title = 'Execute'; }
          break;
        }
        case 'reg':
          if ((e.r === 'IP' || e.r === 'EIP') && !flushed) break;
          lines.push(`${e.r} gets ${h(e.v, 4)}h.`);
          if (tag === 'EU') { tag = e.r; val = h(e.v, 4) + 'h'; title = 'Execute'; }
          break;
        case 'flags': {
          const f = flagText(e);
          if (f) lines.push(`The ${f}.`.replace('The the', 'The'));
          break;
        }
        case 'int':
          title = 'Interrupt';
          tag = 'INT'; val = h(e.vec, 2) + 'h';
          lines.push(`INT ${h(e.vec, 2)}h: the CPU pushes FLAGS, CS and IP, and reads the new CS:IP from the vector table.`);
          break;
        case 'fpu':
          unit = 'fpu'; title = N.fpu; tag = N.fpu; val = (e.text || '').split(' ')[0].toUpperCase();
          lines.push(`The ${N.fpu} does "${e.text}" (${e.cycles || '?'} clocks).`);
          break;
        case 'cache':
          lines.push(e.cache ? `The ${e.cache} cache has the line of ${h(e.phys >>> 0, 8)}h (set ${e.set}, way ${e.way}, state ${e.state}): a hit, with no bus cycle.`
            : `The cache has the line of ${h(e.phys >>> 0, 8)}h (set ${e.set}, way ${e.way}): a hit, with no bus cycle.`);
          break;
        case 'pipe':
          // (the 486 pipeline has one pipe: its card on the die shows the five stages)
          if (!e.pipe) break;
          lines.push(e.paired ? `${e.pipe} pipe: it pairs with "${e.partner}"; the two instructions go through the pipes in the same clocks.`
            : `U pipe alone${e.reason ? ': ' + e.reason : ''}.`);
          break;
        case 'btb':
          lines.push(`The ${e.how === 'static' ? 'decoder (static rule)' : e.how === 'rsb' ? 'return stack buffer' : 'branch target buffer'} predicted ${e.predicted ? 'taken' : 'not taken'}: right, no lost clocks.`);
          break;
        case 'rat':
          if ((e.writes || []).length) lines.push(`The RAT renames ${(e.writes || []).map(x => `${x.r} to ROB ${x.rob}`).join(', ')}.`);
          break;
        case 'uop':
          if (e.passed && e.passed.length) lines.push(`µop ${e.id} (${e.kind}) passes ${e.passed.length} older µop${e.passed.length > 1 ? 's' : ''} (${e.passed.join(', ')}) that still wait: it runs out of order on port ${e.port}.`);
          else if (e.wait) lines.push(`µop ${e.id} (${e.kind}) waits in the reservation station: ${e.wait === 'operand' ? 'its operand is not ready' : 'the ' + e.wait + ' is busy'} (clock ${e.issue} to ${e.dispatch}).`);
          else lines.push(`µop ${e.id} (${e.kind}) goes to port ${e.port} at clock ${e.dispatch}; its result is ready at ${e.done}.`);
          break;
        case 'rob':
          lines.push(`The reorder buffer retires the ${e.uops} µop${e.uops === 1 ? '' : 's'} in program order at clock ${e.retire}.`);
          break;
        case 'desc':
          lines.push(`The ${e.sreg} descriptor cache loads: base ${h(e.base, 6)}h, limit ${h(e.limit, 4)}h (${e.table}).`);
          if (tag === 'EU') { tag = e.sreg; val = h(e.base, 6) + 'h'; title = 'Descriptor'; }
          break;
        case 'sys': lines.push(e.text + '.'); title = 'Protection'; break;
        case 'task': lines.push(`Task switch to selector ${h(e.to, 4)}h.`); title = 'Task switch'; break;
        default:
      }
    }
    if (!lines.length) return null;
    if (dec && title === 'Execute' && !evs.includes(dec)) title = 'Execute';
    const inName = unit === 'fpu' ? N.fpu : N.cpu;
    return { kind: 'inside', lane: unit === 'fpu' ? N.fpu : 'EU', unit, t, title, token: { tag, val, col: unit === 'fpu' ? 'fpu' : 'eu' }, evs, fromName: `inside the ${inName}`, toName: '',
      text: lines.join(' '), sum: lines[0].replace(/\.$/, '') };
  }

  // The floppy controller (uPD765) and its drives: one step for each main moment.
  const DRV = d => (d ? 'B:' : 'A:');
  function fdcStep(e) {
    const where = `${DRV(e.drive)} track ${e.cyl ?? '?'}, side ${e.head ?? 0}${e.sec ? `, sector ${e.sec}` : ''}`;
    const T = {
      command: ['FDC command', 'CMD', `The uPD765 takes the bytes of the command "${e.text || ''}" from the CPU through its data register (3F5h).`],
      seek: ['Seek', 'SEEK', `The uPD765 moves the head of drive ${DRV(e.drive)} to track ${e.cyl}. It sends one step pulse for each track.`],
      step: ['Head step', 'STEP', `A step pulse moves the head of drive ${DRV(e.drive)} one track. The head is now on track ${e.cyl}.`],
      read: ['Read sector', 'READ', `The head reads ${where}. The data separator turns the MFM bits into bytes, and the uPD765 asks for DMA (DRQ 2) for each byte.`],
      write: ['Write sector', 'WRITE', `The uPD765 gets each byte by DMA and the head writes it to ${where}.`],
      result: ['FDC result', 'RESULT', `The uPD765 has the result bytes (ST0, ST1, ST2, C, H, R, N) ready. The CPU reads them from 3F5h.`],
      irq: ['IRQ 6', 'IRQ6', 'The uPD765 ends the operation and raises IRQ 6. The 8259A sends it to the CPU as INT 0Eh.'],
      reset: ['FDC reset', 'RESET', 'The DOR bit 2 resets the uPD765. It raises IRQ 6 when it is ready again.'],
    }[e.op] || ['Floppy controller', 'FDC', e.text || 'The uPD765 works.'];
    return { kind: 'fdc', lane: 'FDC', t: e.t || 0, e, title: T[0], token: { tag: T[1], val: e.op === 'read' || e.op === 'write' || e.op === 'seek' || e.op === 'step' ? `T${e.cyl}${e.sec ? ' S' + e.sec : ''}` : '', col: e.op === 'irq' ? 'ctrl' : e.op === 'read' || e.op === 'write' ? 'data' : 'addr' },
      fromName: e.op === 'read' ? `drive ${DRV(e.drive)}` : e.op === 'irq' ? 'uPD765' : 'uPD765', toName: e.op === 'read' ? 'uPD765' : e.op === 'irq' ? '8259A' : `drive ${DRV(e.drive)}`,
      text: T[2] + (e.text && e.op !== 'command' ? ` (${e.text})` : ''), sum: `${T[0]}${e.op === 'read' || e.op === 'write' || e.op === 'seek' ? ' · ' + where : ''}` };
  }
  function dmaStep(e) {
    const n = e.n || 1;
    return { kind: 'dma', lane: 'DMA', t: e.t || 0, e, title: 'DMA transfer', token: { tag: 'DMA', val: `${n} B`, col: 'data' },
      fromName: e.read ? 'memory' : 'uPD765', toName: e.read ? 'uPD765' : 'memory',
      text: `The 8237 channel 2 takes the bus from the CPU (HOLD, HLDA) and moves ${n} byte${n > 1 ? 's' : ''} ${e.read ? 'from the memory to the floppy controller' : 'from the floppy controller to the memory'}, at ${hA(e.addr)}. ${e.count !== undefined ? `${e.count} bytes are left.` : ''}`,
      sum: `DMA ${n} B ${e.read ? 'memory → FDC' : 'FDC → memory'} at ${hA(e.addr)}` };
  }
  // The Sound Blaster: the DSP (commands, DMA, IRQ 7) and the OPL2 FM chip (register writes).
  function soundStep(e) {
    if (e.k === 'opl') {
      const key = e.op === 'key-on' ? `Channel ${e.ch} starts a note: its operators begin the attack of their envelopes.` : e.op === 'key-off' ? `Channel ${e.ch} ends its note: the envelopes go to the release.` : '';
      return { kind: 'sound', lane: 'OPL2', t: e.t || 0, e, title: e.op === 'key-on' ? 'FM note on' : e.op === 'key-off' ? 'FM note off' : 'FM register', token: { tag: 'OPL', val: `${h(e.reg || 0, 2)}h=${h(e.val || 0, 2)}h`, col: 'ctrl' },
        fromName: N.cpu, toName: 'YM3812', text: `The CPU writes ${h(e.val || 0, 2)}h to register ${h(e.reg || 0, 2)}h of the YM3812. ${key}${e.text ? ' (' + e.text + ')' : ''}`,
        sum: `OPL2 reg ${h(e.reg || 0, 2)}h ← ${h(e.val || 0, 2)}h${e.op === 'key-on' ? ' · note on' : e.op === 'key-off' ? ' · note off' : ''}` };
    }
    const T = {
      command: ['DSP command', `The DSP gets the command ${h(e.cmd || 0, 2)}h at port 22Ch. ${e.text || ''}`],
      dma: ['DSP DMA', `The DSP asks for DMA channel 1 at ${e.rate || '?'} samples per second. The 8237 moves each sample byte from the memory to the DSP, and the DSP sends it to its DAC. ${e.left !== undefined ? e.left + ' bytes are left in the block.' : ''}`],
      irq: ['IRQ 7', 'The DSP ends the block and raises IRQ 7. The program reads 22Eh to acknowledge it.'],
      dac: ['Direct DAC', `The CPU sends one sample to the DAC with command 10h. ${e.text || ''}`],
      reset: ['DSP reset', 'The program writes 1 then 0 to 226h. The DSP starts again and puts AAh in its read port.'],
    }[e.op] || ['Sound Blaster', e.text || ''];
    return { kind: 'sound', lane: 'SB DSP', t: e.t || 0, e, title: T[0], token: { tag: 'DSP', val: e.cmd !== undefined ? h(e.cmd, 2) + 'h' : '', col: e.op === 'irq' ? 'ctrl' : 'data' },
      fromName: e.op === 'irq' ? 'DSP' : N.cpu, toName: e.op === 'irq' ? '8259A' : 'DSP', text: T[1], sum: `${T[0]}${e.cmd !== undefined ? ' ' + h(e.cmd, 2) + 'h' : ''}` };
  }
  // The 80486 cache: a read miss fills a 16-byte line with a burst; a write goes through.
  // The Pentium branch target buffer: a wrong prediction flushes the pipes.
  function btbStep(e) {
    return { kind: 'btb', lane: 'BTB', t: e.t || 0, e, unit: 'cpu', title: 'Branch: wrong prediction',
      token: { tag: 'BTB', val: e.taken ? 'TAKEN' : 'NOT TAKEN', col: 'ctrl' }, fromName: 'branch target buffer', toName: e.pipe === 'V' ? 'V pipe' : 'U pipe',
      text: `The branch target buffer predicted ${e.predicted ? 'taken' : 'not taken'} (${e.hit ? 'its entry' : 'no entry'}), but the branch is ${e.taken ? 'taken to ' + h(e.target >>> 0, 8) + 'h' : 'not taken'}. ${M686 ? `The CPU removes the µops of the wrong path from the ROB and the RS: ${e.penalty || 12} clocks are lost. The branch history (${e.history >= 0 ? (e.history >>> 0).toString(2).padStart(4, '0') : 'none'}) selects a counter, and the counter learns the new direction.` : `The pipes flush the wrong instructions: ${e.penalty || 3} clocks are lost. The 2-bit counter learns the new direction.`}`,
      sum: `wrong prediction: ${e.penalty || 3} clocks lost` };
  }
  function cacheStep(e) {
    if (M686) return cacheStepP6(e);
    if (M586) return cacheStepP5(e);
    const phys = e.phys >>> 0;
    return { kind: 'cache', lane: 'CACHE', t: e.t || 0, e, unit: 'cpu', title: e.fill ? 'Cache miss: line fill' : e.write ? 'Cache: write through' : 'Cache miss',
      token: { tag: 'LINE', val: h(phys & ~15, 8) + 'h', col: 'data' }, fromName: 'memory', toName: '80486 cache',
      text: e.fill ? `The address ${h(phys, 8)}h is not in the cache (set ${e.set}). The bus interface reads the 16-byte line at ${h(phys & ~15, 8)}h in a burst of 8 cycles of 2 bytes (the board has a 16-bit data bus), and the cache keeps it in way ${e.way}. The next bytes of the line come from the cache.`
        : `The write to ${h(phys, 8)}h goes to the memory (write-through). The cache ${e.hit ? 'also changes its copy' : 'has no line for it, and it does not fill one'}.`,
      sum: e.fill ? `cache miss → fill ${h(phys & ~15, 8)}h` : `write through ${h(phys, 8)}h` };
  }
  // The Pentium Pro: an L1 miss asks the L2 (back-side bus, same package); an L2 miss uses the
  // front-side bus.
  function cacheStepP6(e) {
    const phys = e.phys >>> 0, line = phys & ~31, l2 = e.level === 'L2';
    return { kind: 'cache', lane: 'CACHE', t: e.t || 0, e, unit: 'cpu',
      title: l2 ? (e.hit ? 'L2 hit (back-side bus)' : 'L2 miss: front-side bus') : `L1 ${e.cache === 'code' ? 'code' : 'data'} miss`,
      token: { tag: l2 ? 'L2' : 'L1', val: h(line, 8) + 'h', col: 'data' }, fromName: l2 ? (e.hit ? 'L2 cache' : 'memory') : 'L2 cache', toName: 'Pentium Pro ' + (l2 ? 'L1' : e.cache + ' cache'),
      text: l2 ? (e.hit ? `The L2 die in the same package has the line ${h(line, 8)}h. The back-side bus brings it at the core clock.` : `The L2 does not have the line ${h(line, 8)}h. The 66 MHz front-side bus reads it from the memory in a burst of 4 × 8 bytes; the L2 and the L1 keep it.`)
        : `The address ${h(phys, 8)}h is not in the L1 ${e.cache === 'code' ? 'code' : 'data'} cache (set ${e.set}). The L1 asks the L2 for the 32-byte line.`,
      sum: l2 ? (e.hit ? `L2 hit ${h(line, 8)}h` : `L2 miss → memory ${h(line, 8)}h`) : `L1 miss ${h(phys, 8)}h` };
  }
  function cacheStepP5(e) {
    const phys = e.phys >>> 0, line = phys & ~31, nm = e.cache === 'code' ? 'code cache' : 'data cache';
    const wb = e.wb ? ` First a burst writes back the old line ${h((e.wbLine || 0) >>> 0, 8)}h (state M: only the cache had its new bytes).` : '';
    return { kind: 'cache', lane: 'CACHE', t: e.t || 0, e, unit: 'cpu', title: e.fill ? `${e.cache === 'code' ? 'Code' : 'Data'} cache miss: line fill` : e.write ? 'Data cache: write miss' : 'Cache miss',
      token: { tag: 'LINE', val: h(line, 8) + 'h', col: 'data' }, fromName: 'memory', toName: 'Pentium ' + nm,
      text: e.fill ? `The address ${h(phys, 8)}h is not in the ${nm} (set ${e.set}).${wb} The 64-bit bus reads the 32-byte line at ${h(line, 8)}h in a burst of 4 × 8 bytes (2-1-1-1), and the cache keeps it in way ${e.way}${e.state ? ', state ' + e.state : ''}.`
        : `The write to ${h(phys, 8)}h is not in the data cache: it goes to the memory, and the Pentium does not fill a line for a write.`,
      sum: e.fill ? `${e.cache || ''} cache miss → fill ${h(line, 8)}h` : `write miss ${h(phys, 8)}h` };
  }
  // The 80386 paging unit: a linear address that is not in the TLB goes through the page
  // directory and a page table (two memory reads, the bus steps that follow).
  function pageStep(e) {
    const lin = e.lin >>> 0, off = lin & 0xFFF;
    return { kind: 'page', lane: 'PAGING', t: e.t || 0, e, unit: 'cpu', title: e.fault ? 'Page fault' : 'Page walk', token: { tag: 'LINEAR', val: h(lin, 8) + 'h', col: 'addr' },
      fromName: 'segmentation unit', toName: 'paging unit',
      text: `The linear address ${h(lin, 8)}h is not in the TLB. The paging unit splits it: directory entry ${h(e.dir, 3)}h, table entry ${h(e.tbl, 3)}h, offset ${h(off, 3)}h. ` +
        (e.fault ? `The entry is not present or not allowed: a page fault (#PF, error code ${h(e.err || 0, 1)}). CR2 gets the linear address.`
          : `It reads the page directory entry (${h(e.pde >>> 0, 8)}h) and the page table entry (${h(e.pte >>> 0, 8)}h), puts the result in the TLB, and gives the physical address ${h(e.phys >>> 0, 8)}h.`),
      sum: e.fault ? `page fault at ${h(lin, 8)}h` : `page walk ${h(lin, 8)}h → ${h(e.phys >>> 0, 8)}h` };
  }
  // opt: { prefetch: 'parallel' | 'full' | 'short' | 'hide' }. 'parallel': a prefetch is not a
  // step of its own; it plays at the same time as an EU step (s.bg), as on the real CPU.
  function build(events, opt = {}) {
    opt = { prefetch: 'parallel', ...opt };
    const parallel = opt.prefetch === 'parallel';
    if (parallel) opt = { ...opt, prefetch: 'short' };
    const evs = events.map((e, i) => ({ e, i })).sort((a, b) => ((a.e.t || 0) - (b.e.t || 0)) || a.i - b.i).map(x => x.e);
    const dec = evs.find(e => e.k === 'decode');
    const flushed = evs.some(e => e.k === 'queue' && e.op === 'flush') || evs.some(e => e.k === 'int');
    const steps = [];
    let group = [];
    const close = () => { if (group.length) { const s = insideStep(group, dec, flushed); if (s) steps.push(s); group = []; } };
    for (const e of evs) {
      if (e.k === 'fetch' || e.k === 'bus') {
        if (e.k === 'fetch' && opt.prefetch === 'hide') continue;
        close();
        const bs = busSteps(e, opt, e.q ? e.q.length : 0);
        if (parallel && e.k === 'fetch') for (const x of bs) x.bgStep = true;
        steps.push(...bs);
      } else if (e.k === 'int' && e.src === 'irq') {
        close();
        steps.push({ kind: 'irq', lane: 'IRQ', t: e.t || 0, e, title: 'Interrupt request', token: { tag: 'INTR', val: h(e.vec, 2) + 'h', col: 'ctrl' }, fromName: '8259A', toName: N.cpu,
          text: `A device asks for an interrupt. The 8259A sends INTR to the ${N.cpu}. The ${N.cpu} ends the current instruction and answers with INTA cycles.`,
          sum: `INTR → ${N.cpu}` });
        group.push(e);
      } else if (e.k === 'fdc') {
        close();
        steps.push(fdcStep(e));
      } else if (e.k === 'dma') {
        close();
        steps.push(dmaStep(e));
      } else if (e.k === 'page') {
        close();
        steps.push(pageStep(e));
      } else if (e.k === 'cache' && (!e.hit || e.level === 'L2')) {   // (a P6 L2 hit follows an L1 miss)
        close();
        steps.push(cacheStep(e));
      } else if (e.k === 'btb' && !e.right) {
        close();
        steps.push(btbStep(e));
      } else if (e.k === 'sb' || e.k === 'opl') {
        close();
        steps.push(soundStep(e));
      } else if (e.k !== 'end' && e.k !== 'iq') group.push(e);
    }
    close();
    // The decode step comes first, also when the first bus cycle starts at the same clock.
    const d = steps.findIndex(s => s.kind === 'inside' && s.title === 'Decode');
    if (d > 0 && steps[d].t === 0) steps.unshift(steps.splice(d, 1)[0]);
    steps.forEach((s, i) => { s.i = i; });
    const end = evs.find(e => e.k === 'end');
    // the prefetches in parallel: each goes with the EU step before it (the BIU fetches while
    // the EU works), else with the next step
    if (steps.some(s => s.bgStep) && steps.some(s => !s.bgStep)) {
      const main = [];
      steps.forEach((s, i) => {
        if (!s.bgStep) { main.push(s); return; }
        let host = null;
        for (let k = i - 1; k >= 0; k--) if (!steps[k].bgStep) { if (steps[k].kind === 'inside') host = steps[k]; break; }
        if (!host) for (let k = i + 1; k < steps.length; k++) if (!steps[k].bgStep) { host = steps[k]; break; }
        if (!host) host = main[main.length - 1];
        (host.bg || (host.bg = [])).push(s);
      });
      steps.length = 0; steps.push(...main);
    }
    return { text: dec ? clean(dec.text) : '', cs: dec ? dec.cs : 0, ip: dec ? dec.ip : 0, cycles: end ? end.t : 0, steps };
  }
  return { build, busInfo, devName };
})();
