// Boots the mini BIOS and runs each sample program; checks the text on the screen.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js',
  ...(fs.existsSync(path.join(root, 'src/core/cpu80286.js')) ? ['src/core/cpu80286.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/cpu80386.js')) ? ['src/core/cpu80386.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/cpu80486.js')) ? ['src/core/cpu80486.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/cpu80586.js')) ? ['src/core/cpu80586.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/cpu80686.js')) ? ['src/core/cpu80686.js'] : []),
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js', 'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', ...(fs.existsSync(path.join(root, 'src/core/machine586.js')) ? ['src/core/machine586.js'] : []),
  ...(fs.existsSync(path.join(root, 'src/core/machine686.js')) ? ['src/core/machine686.js'] : []), 'src/core/bios.js', 'src/core/vgabios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const [Asm86, Machine, BIOS_SOURCE, SAMPLES] = ['Asm86', 'Machine', 'BIOS_SOURCE', 'SAMPLES'].map(n => vm.runInThisContext(n));

const MODEL = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : '8086';
const MachineClass = MODEL === '80686' ? vm.runInThisContext('Machine686') : MODEL === '80586' ? vm.runInThisContext('Machine586') : MODEL === '80486' ? vm.runInThisContext('Machine486') : MODEL === '80386' ? vm.runInThisContext('Machine386') : MODEL === '80286' ? vm.runInThisContext('Machine286') : Machine;
const CPU_ASM = MODEL === '80686' ? '686' : MODEL === '80586' ? '586' : MODEL === '80486' ? '486' : MODEL === '80386' ? '386' : MODEL === '80286' ? '286' : '8086';
const AT32 = MODEL === '80386' || MODEL === '80486' || MODEL === '80586' || MODEL === '80686';   // the 32-bit machines (16 MB)
const VIDEO = process.argv.includes('--video') ? process.argv[process.argv.indexOf('--video') + 1] : 'cga';
const vgaRom = VIDEO === 'vga' ? vm.runInThisContext('makeVgaRom')(null) : null;
const bios = Asm86.assemble(vm.runInThisContext('biosSource')(MODEL), { origin: 0 });
console.log(`model ${MODEL}, video ${VIDEO}` + (MODEL !== '8086' ? ` (CPU core: ${new MachineClass().cpu.constructor.name})` : ''));
if (!bios.ok) { console.log(bios.errors); process.exit(1); }

function screen(m) {
  const v = m.vram(); let s = '';
  for (let r = 0; r < 25; r++) {
    let line = '';
    for (let c = 0; c < 80; c++) line += String.fromCharCode(v[(r * 80 + c) * 2] || 32);
    s += line.replace(/\s+$/, '') + '\n';
  }
  return s.replace(/\n+$/, '');
}
function boot(src, keys, vgaCheck, mopts = {}) {
  const m = new MachineClass({ video: VIDEO, ...mopts });
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
  m.setRom(rom);
  if (vgaRom) m.setVgaRom(vgaRom.bytes);
  m.reset();
  const p = Asm86.assemble(src, { origin: 0x100, cpu: CPU_ASM });
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  m.loadProgram(p.bytes, p.origin);
  m.mem.set([0x00, 0x01, 0x00, 0x10, 0x86], 0x4F0);
  let total = 0, reason, k = 0;
  const tones = [];
  m.onSpeaker(hz => tones.push(Math.round(hz)));
  const snaps = [];
  // the same emulated time on each machine: a slice is 250000 clocks at 8 MHz or less
  const clk = Math.max(1, m.clockHz / 8e6);
  for (let i = 0; i < 400; i++) {
    const slice = Math.round((vgaCheck ? 250000 + (i % 7) * 13331 : 250000) * clk);   // uneven looks at the VGA
    reason = m.run(slice); total += slice;
    if (keys && k < keys.length && i > 5) { m.keyDown(keys[k]); m.keyUp(keys[k]); k++; }
    // VGA samples: look at the card while the program runs, then press a key to end it
    if (vgaCheck && !vgaCheck.done && (vgaCheck.started || (vgaCheck.started = vgaCheck.ready(m)))) {
      snaps.push(vgaCheck.snap(m));
      if (snaps.length >= 6) { vgaCheck.done = true; m.keyDown(0x39); m.keyUp(0x39); }
    }
    if (reason === 'halt') break;
  }
  return { m, reason, total, text: screen(m), tones, snaps };
}

let fail = 0;
const expect = {
  hello: /Hello, 8086!\nEvery byte you see went over the data bus\./,
  fib: /0 1 1 2 3 5 8 13 21 34 55 89 144 233 377 610 987 1597 2584 4181 6765 10946 17711 28657 46368/,
  sort: /42 07 93 18 64 03 77 51 29 86\n03 07 18 29 42 51 64 77 86 93/,
  vram: /B800:0000 - the screen is just memory/,
  movsb: /Copied by REP MOVSB, byte by byte\./,
  fact: /1 2 6 24 120 720 5040 40320/,
  bcd: /0100000007/,
  clock: /\[program ended\]/,
  keys: /Type something \(Esc ends\): hi\n?/,
  tune: /\[program ended\]/,
  sb: /YM3812 \(OPL2\) found[^\n]*\nDSP version 2\.01\nFM: C4, E4, G4, then the chord\.\nDMA: 4000 samples at 10989 Hz\. IRQ 7 came at the end\./,
  pi: /3\.14159265358979324/,
  quad: /x1 = 5\nx2 = -2/,
  ins186: /1234 42 1024 120/,
  a20: AT32 ? /A20 off: FFFF:0010 is the byte at 0000:0000[^\n]*\nA20 on: {2}FFFF:0010 reaches 100000h[^\n]*\n15360 KB of extended memory/
    : /A20 off: FFFF:0010 is the byte at 0000:0000[^\n]*\nA20 on: {2}FFFF:0010 reaches 100000h[^\n]*\n1024 KB of extended memory/,
  fib32: /00000000 00000001 00000001 00000002 00000003 00000005 00000008 0000000D\n[\s\S]*\n06197ECB 09DE8D6D 0FF80C38 19D699A5 29CEA5DD 43A53F82 6D73E55F B11924E1\nF\(47\) = 2971215073, the last one below 2\^32/,
  paging: /\n This line went to linear 00200000h\. The page table sent it to B8000h\.\nPTE before: 000B8003 \(present, writable\)\nPTE after: {2}000B8063 \(the CPU set bit 5 A = accessed, bit 6 D = dirty\)/,
  bits: /Number: +00F0A5C4\nBSF lowest 1: +bit 2 +BSR highest 1: bit 23\nBT and SETC: +11 bits are 1\nMOVZX byte 9Ch: +0000009C +MOVSX byte 9Ch: FFFFFF9C\nSHLD EDX:EAX, 8: 12345678 9ABCDEF0\n +-> 3456789A BCDEF000/,
  cpuid: MODEL === '80686'
    ? /FLAGS bits 12-15 can change: not an 8086 or an 80186\.\nFLAGS bits 12-14 can be 1: not an 80286\.\nEFLAGS\.AC \(bit 18\) can change: not an 80386\.\nEFLAGS\.ID \(bit 21\) can change: the CPU has CPUID\.\n\nCPUID 0: highest leaf 2, vendor GenuineIntel\nCPUID 1: EAX = 00000619h: family 6, model 1, stepping 9\n {9}EDX = 0000E1BDh: bit 0 = 1, the FPU is on the chip\n\nThis CPU is newer than the 80486\./
    : MODEL === '80586'
    ? /FLAGS bits 12-15 can change: not an 8086 or an 80186\.\nFLAGS bits 12-14 can be 1: not an 80286\.\nEFLAGS\.AC \(bit 18\) can change: not an 80386\.\nEFLAGS\.ID \(bit 21\) can change: the CPU has CPUID\.\n\nCPUID 0: highest leaf 1, vendor GenuineIntel\nCPUID 1: EAX = 00000517h: family 5, model 1, stepping 7\n {9}EDX = 000001BDh: bit 0 = 1, the FPU is on the chip\n\nThis CPU is newer than the 80486\./
    : /FLAGS bits 12-15 can change: not an 8086 or an 80186\.\nFLAGS bits 12-14 can be 1: not an 80286\.\nEFLAGS\.AC \(bit 18\) can change: not an 80386\.\nEFLAGS\.ID \(bit 21\) can change: the CPU has CPUID\.\n\nCPUID 0: highest leaf 1, vendor GenuineIntel\nCPUID 1: EAX = 00000415h: family 4, model 1, stepping 5\n {9}EDX = 00000001h: bit 0 = 1, the FPU is on the chip\n\nThis CPU is an 80486DX\./,
  p5pairs: /Loop 1 \(pairs\): +\d+ clocks, \d+\.\d clocks for each pass\nLoop 2 \(no pairs\): *\d+ clocks, \d+\.\d clocks for each pass\n\nLoop 2 takes \d+\.\d times the clocks of loop 1\./,
  rdtsc: /8254 counts: +\d+ = \d+ us\nRDTSC clocks: \d+\nCPU clock: +\d+\.\d\d MHz/,
  btb: MODEL === '80686'
    ? /JZ always jumps: +\d+ clocks \(\d+\.\d for each pass\), wrong guesses: \d+\nJZ never jumps: +\d+ clocks \(\d+\.\d for each pass\), wrong guesses: \d+\nJZ jumps in turn: +\d+ clocks \(\d+\.\d for each pass\), wrong guesses: \d+\n\nThe CPU learned the pattern: no more wrong guesses than for\nthe jump that always goes the same way\./
    : /JZ always jumps: +\d+ clocks \(\d+\.\d for each pass\), wrong guesses: \d+\nJZ never jumps: +\d+ clocks \(\d+\.\d for each pass\), wrong guesses: \d+\nJZ jumps in turn: +\d+ clocks \(\d+\.\d for each pass\), wrong guesses: \d+\n\nOne wrong guess costs about \d+\.\d clocks\./,
  fdiv: /The FDIV test of 1994: x = 4195835, y = 3145727\nx \/ y {11}= 1\.3338204491362410\d\nx - \(x \/ y\) \* y = 0\nResult: FDIV is correct\./,
  '4mbpage': /\n This line went to linear 004B8000h\. One 4 MB page sent it to B8000h\.\nPDE 1 before: 00000083 \(present, writable, PS = 1: a 4 MB page\)\nPDE 1 after: {2}000000E3 \(the CPU set bit 5 A = accessed, bit 6 D = dirty\)/,
  cache: /Cache on: +small +\d+ us +big +\d+ us +big \/ small = \d+\.\d\nCache off: +small +\d+ us +big +\d+ us +big \/ small = \d+\.\d\n\nWith the cache, the small array is \d+\.\d times faster\./,
  atomic: /BSWAP: +12345678 -> 78563412\n +the big-endian bytes 00 00 01 BB = 443\n\nXADD: +counter 100, add 5: EAX = 100 \(the old value\)\n +add 5 again: +EAX = 105, counter = 110\n\nCMPXCHG: the lock is free \(0\), program 1 takes it: ZF = 1\n +program 2 tries too: ZF = 0, AL = 1 \(program 1 has it\), lock = 1/,
  ooo: /Loop 1 \(independent ADD\): +\d+ clocks, \d+\.\d clocks for each pass\nLoop 2 \(dependent ADD\): +\d+ clocks, \d+\.\d clocks for each pass\n\nLoop 2 takes \d+\.\d times the clocks of loop 1\./,
  cmov: /Clocks for each pair: +random data +ordered data\nCMP, JGE, MOV \(branch\): +\d+\.\d +\d+\.\d\nCMP, CMOVL \(no branch\): +\d+\.\d +\d+\.\d\n\nBoth ways give the same sum\.\nOn random data CMOVL is \d+\.\d times faster\./,
  rename: /Loop 1 \(renamed EAX\): +\d+ clocks, \d+\.\d clocks for each pass\nLoop 2 \(dependent EAX\): +\d+ clocks, \d+\.\d clocks for each pass\n\nLoop 2 takes \d+\.\d times the clocks of loop 1\./,
  l2: /4 KB array  \(L1 hits\): +\d+\.\d\d clocks for each read, \d+\.\d\d for each byte\n64 KB array \(L2 hits\): +\d+\.\d\d clocks for each read, \d+\.\d\d for each byte\n1 MB array  \(L2 misses\): *\d+\.\d\d clocks for each read, \d+\.\d\d for each byte/,
  pmc: /Instructions retired \(event C0h\): 401\nMicro-ops retired \(event C2h\): +\d+\nMicro-ops for each instruction: +\d+\.\d\d\n\n100 passes with a JZ \(events C4h and C5h\):\nJZ in turn \(taken, not taken\): branches 200, wrong predictions \d+\nJZ at random: +branches 200, wrong predictions \d+/,
  pm286: /Protected mode: CS, DS, SS and ES now hold GDT selectors[\s\S]*#GP caught[\s\S]*Back in real mode: the BIOS resumed at 0040:0067\./,
};
const KEYS = { keys: [0x23, 0x17, 0x01] };  // h i Esc

// VGA samples: when the picture is ready, 6 snapshots of the card (one each 250000
// clocks), then a key. check() says what is wrong, or '' when all is well.
const dacColours = v => { const s = new Set(); for (let i = 0; i < 256; i++) s.add((v.dac[i * 3] << 12) | (v.dac[i * 3 + 1] << 6) | v.dac[i * 3 + 2]); return s.size; };
// distinct pixel values of mode 13h (chain 4: pixel i is in plane i AND 3)
const pixelValues = v => { const s = new Set(); for (let i = 0; i < 64000; i++) s.add(v.vram[(((i & 0xFFFC) | (i >> 14)) << 2) | (i & 3)]); return s.size; };
const VGA_SAMPLES = {
  plasma: {
    ready: m => m.vga.mode.colors === 256 && m.vga.dacVersion > 3000,
    snap: m => ({ mode: m.vga.mode, dac: m.vga.dac.join(','), colours: dacColours(m.vga), px: pixelValues(m.vga) }),
    check: s => !s[0].mode.chain4 ? 'not chain 4' : s[0].px < 200 ? `only ${s[0].px} pixel values` : s[0].colours < 64 ? 'DAC has few colours'
      : new Set(s.map(x => x.dac)).size < 3 ? 'the DAC does not change' : '',
  },
  wheel: {
    ready: m => m.vga.mode.width === 640 && m.vga.mode.height === 480 && m.vga.gc[5] === 0 && m.vga.writes > 300000,
    snap: m => {
      const v = m.vga, hist = new Array(16).fill(0);
      for (let o = 0; o < 38400; o++) {
        const w = v.vram32[o];
        for (let b = 0; b < 8; b++) hist[((w >> b) & 1) | ((w >> (7 + b)) & 2) | ((w >> (14 + b)) & 4) | ((w >> (21 + b)) & 8)]++;
      }
      return { mode: v.mode, hist, pal: Array.from(v.attr.subarray(0, 16)).join(',') };
    },
    check: s => s[0].mode.colors !== 16 ? 'not 16 colours' : s[0].hist.filter(n => n > 1000).length < 15 ? `colours drawn: ${s[0].hist.filter(n => n > 1000).length}`
      : new Set(s.map(x => x.pal)).size < 2 ? 'the palette does not turn' : '',
  },
  modex: {
    ready: m => m.vga.mode.unchained && m.vga.dispStart === 16000,   // after the first flip
    snap: m => {
      const v = m.vga; let ball = 0, sky = 0;
      for (let o = 0; o < 32000; o++) for (let p = 0; p < 4; p++) { const c = v.vram[o * 4 + p]; if (c >= 128 && c < 192) ball++; else if (c >= 16 && c < 112) sky++; }
      return { mode: v.mode, start: v.dispStart, ball, sky };
    },
    check: s => !s[0].mode.unchained ? 'not unchained' : !s.some(x => x.start === 0) || !s.some(x => x.start === 16000) ? 'no page flipping: ' + s.map(x => x.start).join(',')
      : s[0].ball < 150 || s[0].sky < 20000 ? `ball ${s[0].ball} sky ${s[0].sky}` : '',
  },
};
const has286 = vm.runInThisContext("typeof CPU80286 !== 'undefined'");
for (const s of SAMPLES) {
  // a newer machine also runs the samples of the older AT models (the page shows them there too)
  const older = { '80286': ['80286'], '80386': ['80286', '80386'], '80486': ['80286', '80386', '80486'], '80586': ['80286', '80386', '80486', '80586'],
    '80686': ['80286', '80386', '80486', '80586', '80686'] }[MODEL] || [];
  if (s.model && !older.includes(s.model)) continue;
  if (s.video && s.video !== VIDEO) continue;
  if (s.model === '80286' && !has286) { console.log(`skip ${s.id} (needs the CPU80286 core)`); continue; }
  const vc = s.video === 'vga' ? { ...VGA_SAMPLES[s.id], done: false } : null;
  const r = boot(s.src, KEYS[s.id], vc);
  let ok = expect[s.id] ? expect[s.id].test(s.id === 'fib' ? r.text.split(String.fromCharCode(10)).join('') : r.text) : true;
  let why = '';
  if (vc) { why = r.snaps.length < 6 ? 'the picture was not ready' : vc.check(r.snaps); ok = ok && !why; }
  const ended = /\[program ended\]/.test(r.text);
  let good = ok && ended && r.reason === 'halt';
  // the cache sample: the four times must show the effect of the cache
  let note = '';
  if (good && s.id === 'cache') {
    const n = r.text.match(/Cache on: +small +(\d+) us +big +(\d+) us[^\n]*\nCache off: +small +(\d+) us +big +(\d+) us/).slice(1).map(Number);
    note = ` on: small ${n[0]} us, big ${n[1]} us; off: small ${n[2]} us, big ${n[3]} us`;
    // the Pentium: the burst fill of the 64-bit bus is fast, and the 66h / 26h prefixes of the loop cost clocks
    // the Pentium Pro: the 64 KB array fits in the 256 KB L2, so "big" is only a little slower
    const ok = MODEL === '80686' ? n[0] > 0 && n[1] > 1.2 * n[0] && n[2] > 5 * n[0] && n[3] > n[1] : MODEL === '80586' ? n[0] > 0 && n[1] > 1.1 * n[0] && n[2] > 1.5 * n[0] && n[3] > n[1] : n[0] > 0 && n[1] > 1.5 * n[0] && n[2] > 2 * n[0] && n[3] > n[1];
    if (!ok) { good = false; note = ' no cache effect:' + note; }
  }
  // the Pentium samples: the numbers must show the effect
  // (on the Pentium Pro these two samples show other numbers: the P6 has no U and V pipes, and its
  // two-level predictor learns the pattern "in turn")
  if (good && s.id === 'p5pairs' && MODEL === '80686') {
    const n = r.text.match(/Loop 1 \(pairs\): +(\d+) clocks, (\d+\.\d)[^\n]*\nLoop 2 \(no pairs\): *(\d+) clocks, (\d+\.\d)[^\n]*\n\nLoop 2 takes (\d+\.\d)/).slice(1).map(Number);
    note = ` loop 1 ${n[1]} clocks/pass, loop 2 ${n[3]} clocks/pass, ratio ${n[4]} (out of order: no gain from pairs)`;
    if (!(n[4] < 1.2)) { good = false; note = ' the P6 must not show a pairing effect:' + note; }
  } else if (good && s.id === 'p5pairs') {
    const n = r.text.match(/Loop 1 \(pairs\): +(\d+) clocks, (\d+\.\d)[^\n]*\nLoop 2 \(no pairs\): *(\d+) clocks, (\d+\.\d)[^\n]*\n\nLoop 2 takes (\d+\.\d)/).slice(1).map(Number);
    note = ` loop 1 ${n[1]} clocks/pass, loop 2 ${n[3]} clocks/pass, ratio ${n[4]}`;
    if (!(n[4] >= 1.4 && n[1] < 12)) { good = false; note = ' no pairing effect:' + note; }
  }
  if (good && s.id === 'rdtsc') {
    const mhz = +r.text.match(/CPU clock: +(\d+\.\d\d) MHz/)[1];
    note = ` ${mhz} MHz`;
    if (Math.abs(mhz - r.m.clockHz / 1e6) > 0.2) { good = false; note = ' wrong clock:' + note; }
  }
  if (good && s.id === 'btb' && MODEL === '80686') {
    const n = [...r.text.matchAll(/(\d+) clocks \((\d+\.\d) for each pass\), wrong guesses: (\d+)/g)].map(x => [+x[2], +x[3]]);
    note = ` clocks/pass ${n.map(x => x[0]).join(' / ')}, wrong ${n.map(x => x[1]).join(' / ')} (the P6 learns "in turn")`;
    if (!(n[2][1] <= 5 && n[2][0] < n[0][0] + 0.5)) { good = false; note = ' the P6 predictor did not learn the pattern:' + note; }
  } else if (good && s.id === 'btb') {
    const n = [...r.text.matchAll(/(\d+) clocks \((\d+\.\d) for each pass\), wrong guesses: (\d+)/g)].map(x => [+x[2], +x[3]]);
    const cost = +r.text.match(/costs about (\d+\.\d)/)[1];
    note = ` clocks/pass ${n.map(x => x[0]).join(' / ')}, wrong ${n.map(x => x[1]).join(' / ')}, cost ${cost}`;
    if (!(n[0][1] <= 2 && n[1][1] <= 2 && n[2][1] >= 450 && n[2][1] <= 550 && n[2][0] > n[0][0] + 1 && cost >= 3 && cost <= 4.5)) { good = false; note = ' no prediction effect:' + note; }
  }
  if (good && s.id === 'fdiv' && MODEL === '80686') {
    // the P6 has no FDIV bug: the switch of the Pentium machine has no effect
    const b = boot(s.src, null, null, { fdivBug: true });
    b.m.fdivBug = true;
    const ok = expect.fdiv.test(b.text) && b.m.fdivBug === false && b.m.cpu.fdivBug === false;
    note = ok ? ' (fdivBug: true has no effect on the P6)' : ' fdivBug: true changed the result on the P6';
    if (!ok) good = false;
  } else if (good && s.id === 'fdiv') {
    // the same program on a Pentium with the FDIV bug (m.fdivBug)
    const b = boot(s.src, null, null, { fdivBug: true });
    const bug = /x \/ y {11}= 1\.3337390689020375\d\nx - \(x \/ y\) \* y = 256\nResult: this Pentium has the FDIV bug\./.test(b.text);
    note = bug ? ' (with m.fdivBug: 1.33373906890203759, r = 256, "has the FDIV bug")' : '';
    if (!bug) { good = false; note = ' m.fdivBug: no bug on the screen'; console.log(b.text.split('\n').map(l => '    | ' + l).join('\n')); }
  }
  // the Pentium Pro samples: the numbers must show the effect
  if (good && (s.id === 'ooo' || s.id === 'rename')) {
    const n = r.text.match(/Loop 1 [^\n]*: +(\d+) clocks, (\d+\.\d)[^\n]*\nLoop 2 [^\n]*: +(\d+) clocks, (\d+\.\d)[^\n]*\n\nLoop 2 takes (\d+\.\d)/).slice(1).map(Number);
    note = ` loop 1 ${n[1]} clocks/pass, loop 2 ${n[3]} clocks/pass, ratio ${n[4]}`;
    if (!(n[1] < n[3] && n[4] >= 1.3)) { good = false; note = ' no effect:' + note; }
  }
  if (good && s.id === 'cmov') {
    const n = r.text.match(/\(branch\): +(\d+\.\d) +(\d+\.\d)\nCMP, CMOVL \(no branch\): +(\d+\.\d) +(\d+\.\d)/).slice(1).map(Number);
    note = ` random: branch ${n[0]}, cmov ${n[2]}; ordered: branch ${n[1]}, cmov ${n[3]} clocks/pair`;
    if (!(n[2] * 1.2 < n[0] && n[1] <= n[3] + 0.5)) { good = false; note = ' no effect:' + note; }
  }
  if (good && s.id === 'l2') {
    const n = [...r.text.matchAll(/(\d+\.\d\d) clocks for each read/g)].map(x => +x[1]);
    note = ` ${n.join(' / ')} clocks for each read (L1 / L2 / memory)`;
    if (!(n[0] > 0 && n[1] > n[0] + 2 && n[2] > n[1] + 10)) { good = false; note = ' the levels are not in order:' + note; }
  }
  if (good && s.id === 'pmc') {
    const u = +r.text.match(/Micro-ops retired \(event C2h\): +(\d+)/)[1];
    const w = [...r.text.matchAll(/wrong predictions (\d+)/g)].map(x => +x[1]);
    note = ` 401 instructions, ${u} µops, wrong predictions ${w.join(' / ')}`;
    if (!(u === 701 && w[0] <= 3 && w[1] >= 20)) { good = false; note = ' wrong counts:' + note; }
  }
  if (!good) fail++;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${s.id.padEnd(6)} reason=${r.reason} cycles=${r.m.cpu.cycles} instr=${r.m.cpu.instructions}${r.tones.length ? ' tones=' + r.tones.join(',') : ''}${why ? ' VGA: ' + why : ''}${note}`);
  if (!good || process.argv.includes('--show')) console.log(r.text.split('\n').map(l => '    | ' + l).join('\n'));
}
// The 80386 and 80486 machines: the memory map with 32-bit addresses, the clocks, the CMOS, physIP
if (AT32) {
  const m = new MachineClass({ video: VIDEO });
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
  m.setRom(rom);
  if (vgaRom) m.setVgaRom(vgaRom.bytes);
  m.reset();
  const bad = [];
  const want = (got, exp, name) => { if (got !== exp) bad.push(`${name}: got ${got}, want ${exp}`); };
  const hz = MODEL === '80686' ? 200e6 : MODEL === '80586' ? 66e6 : MODEL === '80486' ? 33e6 : 25e6;
  want(m.clockHz, hz, 'clock'); want(m.pit.ratio, 1193182 / hz, 'PIT ratio');
  want(m.cpu.constructor.name, MODEL === '80686' ? 'CPU80686' : MODEL === '80586' ? 'CPU80586' : MODEL === '80486' ? 'CPU80486' : 'CPU80386', 'CPU'); want(m.fpu.model, '80387', 'FPU');
  want(m.physIP, 0xFFFF0, 'physIP after reset (FFFFFFF0h shows as the ROM at FFFF0h)');
  want(m.bus.read8(0xFFFFFFF0), m.mem[0xFFFF0], 'the reset vector at FFFFFFF0h is the ROM');
  want(m.peek8(0xFFFFFFF0), m.mem[0xFFFF0], 'peek8 at FFFFFFF0h');
  want(m.devAt(0xFFFFFFF0), 'rom', 'devAt FFFFFFF0h'); want(m.devAt(0xFFFFFF), 'xram', 'devAt FFFFFFh');
  want(m.devAt(0x1000000), 'none', 'devAt 1000000h'); want(m.bus.read8(0x1000000), 0xFF, 'no memory at 16 MB');
  want(m.bus.read8(0xFFFEFFF0), 0xFF, 'no memory below the top ROM');
  m.a20 = true; m.bus.write8(0xFFFFFF, 0x5A); want(m.bus.read8(0xFFFFFF), 0x5A, 'the last byte of the 16 MB');
  m.bus.write8(0x100000, 0x77); m.mem[0] = 0x11;
  want(m.bus.read8(0x100000), 0x77, 'A20 on: 100000h');
  m.a20 = false; want(m.bus.read8(0x100000), 0x11, 'A20 off: 100000h wraps to 0');
  want(m.heat.read.length, 65536, 'heat pages (16 MB)');
  const h = m.heat.read[0xFFF]; m.bus.read8(0xFFFFFFF0); want(m.heat.read[0xFFF], h + 1, 'the top ROM heats the page of FFFxxh');
  want(m.rtc.cmos[0x30] | (m.rtc.cmos[0x31] << 8), 15360, 'CMOS 30h-31h: KB of extended memory');
  // paging: linear 00400000h -> physical 5000h, CS base 00400000h
  const w32 = (a, v) => { for (let i = 0; i < 4; i++) m.mem[a + i] = (v >>> (8 * i)) & 0xFF; };
  m.mem.fill(0, 0x20000, 0x22000);
  w32(0x20000 + 1 * 4, 0x21003); w32(0x21000, 0x5003);
  const c = m.cpu;
  c.cr[3] = 0x20000; c.cr[0] |= 0x80000001; c.paging = true; c.flushTLB();
  c.cache[1].base = 0x400000; c.ip = 0x10;
  want(m.physIP, 0x5010, 'physIP with paging (linear 00400010h -> 5010h)');
  if (bad.length) { fail++; console.log(`FAIL ${MODEL} memory map:\n  ` + bad.join('\n  ')); } else console.log(`ok   ${MODEL} memory map, clocks, CMOS, physIP with paging`);
}
// The 80486 machine: the start-up screen, the setup switch, KEN#, the cache and the writes
// that do not come from the CPU (DMA, pokeMem, loadProgram), A20, IRQ 13 and CR0.NE.
if (MODEL === '80486') {
  const bad = [];
  const want = (got, exp, name) => { if (got !== exp) bad.push(`${name}: got ${got}, want ${exp}`); };
  const power = cache => {
    const m = new MachineClass({ video: VIDEO, cache });
    const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
    m.setRom(rom, bios.symbols);
    if (vgaRom) m.setVgaRom(vgaRom.bytes);
    m.reset();
    m.run(m.clockHz);                                  // the POST, then "No boot disk"
    return m;
  };
  const m = power(true);
  const text = screen(m);
  if (!/CPU   Intel 80486DX @ 33 MHz, 8 KB cache, FPU on chip\n {6}CPUID GenuineIntel, family 4, model 1, stepping 5\n/.test(text)) bad.push('the CPU lines of the start-up screen:\n' + text);
  if (!/\nFPU   on the 80486 chip\nCache: 8 KB on chip, on\n/.test(text)) bad.push('the FPU and cache lines:\n' + text);
  const c = m.cpu, cr0 = c.cr[0] >>> 0;
  want((cr0 & 0x60000000) >>> 0, 0, 'CR0.CD and CR0.NW are 0 after the POST');
  want(cr0 & 0x22, 0x02, 'CR0.MP = 1, CR0.NE = 0 after the POST');
  const off = power(false);
  if (!/Cache: 8 KB on chip, off\n/.test(screen(off))) bad.push('the setup switch "cache off": the start-up screen');
  want((off.cpu.cr[0] & 0x40000000) >>> 0, 0x40000000, 'cache off: CR0.CD stays 1');
  want(off.cpu.cache486.stats.fills, 0, 'cache off: no line fills');
  want(off.rtc.cmos[0x2D] & 1, 1, 'cache off: CMOS 2Dh bit 0');
  // KEN#
  const K = m.bus.cacheable;
  want(K(0x1000), true, 'KEN#: RAM'); want(K(0xA0000), false, 'KEN#: VGA window'); want(K(0xB8000), false, 'KEN#: B8000h');
  want(K(0xC0000), false, 'KEN#: video BIOS'); want(K(0xF0000), false, 'KEN#: BIOS ROM'); want(K(0xFFFFFFF0), false, 'KEN#: the top ROM');
  want(K(0x1000000), false, 'KEN#: no memory at 16 MB');
  m.a20 = true; want(K(0x100000), true, 'KEN#: 100000h with A20 on');
  m.a20 = false; want(K(0x100000), false, 'KEN#: 100000h with A20 off'); want(K(0x200000), true, 'KEN#: 200000h with A20 off');
  m.a20 = true; m.tickDevices(0);
  // a cache hit makes no bus cycle: no stats, no heat
  const rd = a => c.physRd(a, 1, -1, 0), wr = (a, v) => c.physWr(a, 1, v, -1);
  rd(0x5000);
  m.takeStats();
  const h0 = m.heat.read[0x50], hits = c.cache486.stats.hits;
  rd(0x5001); rd(0x5002);
  const st2 = m.takeStats();
  want(c.cache486.stats.hits - hits, 2, 'two cache hits');
  want(st2.memr + st2.dev.ram, 0, 'a cache hit makes no bus cycle (m.stats)');
  want(m.heat.read[0x50], h0, 'a cache hit makes no heat');
  // the writes that do not come from the CPU
  m.dmaWrite(0x5003, 0x42); want(rd(0x5003), 0x42, 'DMA write: the CPU reads the new byte');
  rd(0x6000); m.pokeMem(0x6000, [0x43, 0x44]); want(rd(0x6001), 0x44, 'pokeMem: the CPU reads the new bytes');
  rd(0x7000); m.mem[0x7000] = 0x45; m.memChanged(0x7000, 1); want(rd(0x7000), 0x45, 'memChanged after a write to m.mem');
  rd(0x10100); m.loadProgram(new Uint8Array([0x90, 0xCC]), 0x100); want(rd(0x10101), 0xCC, 'loadProgram: the CPU reads the new program');
  rd(0x46C); const inv = c.cache486.stats.invalidations; m.setClockFromHost(); want(c.cache486.stats.invalidations > inv, true, 'setClockFromHost: the line of 0040:006C becomes invalid');
  // A20: a line of 100000h (A20 on) must not answer for 000000h (A20 off), and a write through
  // 100000h with A20 off must reach the cached line of 000000h
  m.mem[0x100000] = 0x77; m.mem[0] = 0x11; m.memChanged(0, 1); m.memChanged(0x100000, 1);
  want(rd(0x100000), 0x77, 'A20 on: 100000h'); want(rd(0), 0x11, 'A20 on: 000000h');
  m.a20 = false; m.tickDevices(0);
  want(rd(0x100000), 0x11, 'A20 off: 100000h reads 000000h (not the old line)');
  wr(0x100000, 0x99); want(rd(0), 0x99, 'A20 off: a write to 100000h changes the line of 000000h');
  m.a20 = true; m.tickDevices(0); want(rd(0x100000), 0x77, 'A20 on again: 100000h');
  // IRQ 13 only while CR0.NE = 0
  m.fpu.intRequest = true;
  c.cr[0] &= ~0x20; want(m.fpuErr(), true, 'FPU error with CR0.NE = 0: IRQ 13');
  c.cr[0] |= 0x20; want(m.fpuErr(), false, 'FPU error with CR0.NE = 1: no IRQ 13 (#MF)');
  m.fpu.intRequest = false; c.cr[0] &= ~0x20;
  // the switch at run time: off empties the cache and stops the fills
  m.cacheEnabled = false;
  want(c.cache486.lines.some(l => l.valid), false, 'cacheEnabled = false: the cache is empty');
  const f0 = c.cache486.stats.fills; rd(0x8000); want(c.cache486.stats.fills, f0, 'cacheEnabled = false: no fills');
  if (bad.length) { fail++; console.log('FAIL 80486 cache and machine:\n  ' + bad.join('\n  ')); } else console.log('ok   80486 start-up screen, setup switch, KEN#, DMA / pokeMem / A20 invalidation, IRQ 13 and NE');
}
// The Pentium machine: the start-up screen, the setup switch, KEN#, bus.poke8 (the stores that
// stay in the data cache), the writes that do not come from the CPU (both caches), A20, IRQ 13
// and CR0.NE, the FDIV switch.
if (MODEL === '80586') {
  const bad = [];
  const want = (got, exp, name) => { if (got !== exp) bad.push(`${name}: got ${got}, want ${exp}`); };
  const power = opts => {
    const m = new MachineClass({ video: VIDEO, ...opts });
    const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
    m.setRom(rom, bios.symbols);
    if (vgaRom) m.setVgaRom(vgaRom.bytes);
    m.reset();
    m.run(m.clockHz);                                  // the POST, then "No boot disk"
    return m;
  };
  const m = power({});
  const text = screen(m);
  if (!/CPU   Intel Pentium @ 66 MHz, 8 KB code \+ 8 KB data cache, FPU on chip\n {6}CPUID GenuineIntel, family 5, model 1, stepping 7, features 000001BDh\n/.test(text)) bad.push('the CPU lines of the start-up screen:\n' + text);
  if (!/\nFPU   on the Pentium chip\nCache: 8 KB code \+ 8 KB data on chip, on\n/.test(text)) bad.push('the FPU and cache lines:\n' + text);
  const c = m.cpu, cr0 = c.cr[0] >>> 0, D = c.dcache, I = c.icache;
  want((cr0 & 0x60000000) >>> 0, 0, 'CR0.CD and CR0.NW are 0 after the POST');
  want(cr0 & 0x22, 0x02, 'CR0.MP = 1, CR0.NE = 0 after the POST');
  want(m.mem[0x4EE], 5, 'BDA 0040:00EE = 5 (a CPU with CPUID)');
  want(D.stats.fills > 0 && I.stats.fills === 0, true, 'the POST fills data lines (RAM), no code lines (the BIOS ROM: KEN# = 0)');
  want(m.fdivBug, false, 'm.fdivBug is off by default'); want(c.fdivBug, false, 'cpu.fdivBug is off by default');
  want(m.bus.waitStates, 1, 'bus.waitStates');
  const off = power({ cache: false });
  if (!/Cache: 8 KB code \+ 8 KB data on chip, off\n/.test(screen(off))) bad.push('the setup switch "cache off": the start-up screen');
  want((off.cpu.cr[0] & 0x40000000) >>> 0, 0x40000000, 'cache off: CR0.CD stays 1');
  want(off.cpu.dcache.stats.fills + off.cpu.icache.stats.fills, 0, 'cache off: no line fills');
  want(off.rtc.cmos[0x2D] & 1, 1, 'cache off: CMOS 2Dh bit 0');
  // a CPU reset (port 92h) turns the caches off; the BIOS turns them on again
  {
    const r = power({});
    r.ioWrite(0x70, 0x8F); r.ioWrite(0x71, 0x0A);      // CMOS shutdown code 0Ah: jump to 0040:0067
    r.mem.set([0x00, 0x7C, 0x00, 0x00], 0x467);        // 0000:7C00
    r.pokeMem(0x7C00, [0xEB, 0xFE]);                    // JMP $
    r.ioWrite(0x92, 0x01);
    want((r.cpu.cr[0] & 0x60000000) >>> 0, 0x60000000, 'after a CPU reset CR0.CD = NW = 1');
    r.run(r.clockHz / 100);
    want((r.cpu.cr[0] & 0x60000000) >>> 0, 0, 'the resume path of the BIOS clears CD and NW');
    want(r.physIP, 0x7C00, 'the resume path jumps to 0040:0067');
  }
  // KEN#
  const K = m.bus.cacheable;
  want(K(0x1000), true, 'KEN#: RAM'); want(K(0xA0000), false, 'KEN#: VGA window'); want(K(0xB8000), false, 'KEN#: B8000h');
  want(K(0xC0000), false, 'KEN#: video BIOS'); want(K(0xF0000), false, 'KEN#: BIOS ROM'); want(K(0xFFFFFFF0), false, 'KEN#: the top ROM');
  want(K(0x1000000), false, 'KEN#: no memory at 16 MB');
  m.a20 = true; want(K(0x100000), true, 'KEN#: 100000h with A20 on'); want(K(0xFFFFFF), true, 'KEN#: the last byte of the 16 MB');
  m.a20 = false; want(K(0x100000), false, 'KEN#: 100000h with A20 off'); want(K(0x200000), true, 'KEN#: 200000h with A20 off');
  m.a20 = true; m.tickDevices(0);
  // a cache hit makes no bus cycle: no stats, no heat
  const rd = a => c.physRd(a, 1, -1, 0), wr = (a, v) => c.physWr(a, 1, v, -1, 0);
  rd(0x5000);
  m.takeStats();
  const h0 = m.heat.read[0x50], hits = D.stats.hits;
  rd(0x5001); rd(0x5002);
  let st = m.takeStats();
  want(D.stats.hits - hits, 2, 'two cache hits');
  want(st.memr + st.dev.ram, 0, 'a cache hit makes no bus cycle (m.stats)');
  want(m.heat.read[0x50], h0, 'a cache hit makes no heat');
  // bus.poke8: a store to an E line (then M) makes no bus cycle, but memory gets the byte
  want(D.state[c.dFind(0x5000)], 2, 'a line fill with PWT = 0 is E');
  const hw = m.heat.write[0x50];
  wr(0x5004, 0x5A);
  st = m.takeStats();
  want(m.mem[0x5004], 0x5A, 'poke8: memory has the byte of a store to an E line');
  want(D.state[c.dFind(0x5000)], 3, 'the store makes the line M');
  want(st.memw + st.dev.ram, 0, 'poke8: no bus cycle (m.stats)');
  want(m.heat.write[0x50], hw, 'poke8: no heat');
  wr(0x5005, 0x5B); want(m.mem[0x5005], 0x5B, 'poke8: a store to an M line');
  // the writes that do not come from the CPU: the data cache
  m.dmaWrite(0x5003, 0x42); want(rd(0x5003), 0x42, 'DMA write: the CPU reads the new byte (data cache)');
  rd(0x6000); m.pokeMem(0x6000, [0x43, 0x44]); want(rd(0x6001), 0x44, 'pokeMem: the CPU reads the new bytes (data cache)');
  rd(0x7000); m.mem[0x7000] = 0x45; m.memChanged(0x7000, 1); want(rd(0x7000), 0x45, 'memChanged after a write to m.mem');
  rd(0x10100); m.loadProgram(new Uint8Array([0x90, 0xCC]), 0x100); want(rd(0x10101), 0xCC, 'loadProgram: the CPU reads the new program');
  rd(0x46C); const inv = D.stats.invalidations; m.setClockFromHost(); want(D.stats.invalidations > inv, true, 'setClockFromHost: the line of 0040:006C becomes invalid');
  // ... and the code cache: a loop at 0000:7C00 runs from the code cache
  const loop = () => { c.cache[1].base = 0; c.sregs[1] = 0; c.ip = 0x7C00; c.flush(); c.halted = false; m.run(2000); };
  m.pokeMem(0x7C00, [0xEB, 0xFE]); loop();
  want(c.iFind(0x7C00) >= 0, true, 'the loop at 7C00h is in the code cache');
  m.dmaWrite(0x7C1F, 0x90); want(c.iFind(0x7C00), -1, 'DMA write: the code line becomes invalid');
  loop(); want(c.iFind(0x7C00) >= 0, true, 'the loop is in the code cache again');
  m.pokeMem(0x7C10, [0x90]); want(c.iFind(0x7C00), -1, 'pokeMem: the code line becomes invalid');
  loop(); const ic = I.stats.invalidations; m.pokeMem(0x7C00, [0xEB, 0xFE]); want(I.stats.invalidations, ic + 1, 'pokeMem: one code line (icache.stats.invalidations)');
  // A20: a line of 100000h (A20 on) must not answer for 000000h (A20 off), and a write through
  // 100000h with A20 off must reach the cached line of 000000h (write8 and poke8)
  m.mem[0x100000] = 0x77; m.mem[0] = 0x11; m.memChanged(0, 1); m.memChanged(0x100000, 1);
  want(rd(0x100000), 0x77, 'A20 on: 100000h'); want(rd(0), 0x11, 'A20 on: 000000h');
  m.a20 = false; m.tickDevices(0);
  want(c.dFind(0x100000), -1, 'A20 off: the line of 100000h is invalid');
  want(rd(0x100000), 0x11, 'A20 off: 100000h reads 000000h (not the old line)');
  wr(0x100000, 0x99); want(rd(0), 0x99, 'A20 off: a write to 100000h changes the line of 000000h');
  rd(5); m.bus.poke8(0x100005, 0x66); want(m.mem[5], 0x66, 'A20 off: poke8 to 100005h writes 000005h'); want(rd(5), 0x66, 'A20 off: poke8 makes the line of 000005h invalid');
  m.a20 = true; m.tickDevices(0); want(rd(0x100000), 0x77, 'A20 on again: 100000h');
  // IRQ 13 only while CR0.NE = 0
  m.fpu.intRequest = true;
  c.cr[0] &= ~0x20; want(m.fpuErr(), true, 'FPU error with CR0.NE = 0: IRQ 13');
  c.cr[0] |= 0x20; want(m.fpuErr(), false, 'FPU error with CR0.NE = 1: no IRQ 13 (#MF)');
  m.fpu.intRequest = false; c.cr[0] &= ~0x20;
  want(m.ioDevAt(0xF8), 'fpu', 'port F8h is the FPU port range of the board');
  // the FDIV switch
  m.fdivBug = true; want(c.fdivBug, true, 'm.fdivBug = true sets cpu.fdivBug');
  c.reset(); want(c.fdivBug, true, 'a CPU reset keeps the FDIV switch');
  m.fdivBug = false; want(c.fdivBug, false, 'm.fdivBug = false');
  want(new MachineClass({ video: VIDEO, fdivBug: true }).cpu.fdivBug, true, 'new Machine586({ fdivBug: true })');
  // the switch at run time: off empties both caches and stops the fills
  const m2 = power({});
  m2.cacheEnabled = false;
  want(m2.cpu.dcache.tag.every(t => t < 0) && m2.cpu.icache.tag.every(t => t < 0), true, 'cacheEnabled = false: both caches are empty');
  const f0 = m2.cpu.dcache.stats.fills; m2.cpu.physRd(0x8000, 1, -1, 0); want(m2.cpu.dcache.stats.fills, f0, 'cacheEnabled = false: no fills');
  if (bad.length) { fail++; console.log('FAIL Pentium caches and machine:\n  ' + bad.join('\n  ')); } else console.log('ok   Pentium start-up screen, setup switch, CPU reset, KEN#, poke8, DMA / pokeMem / A20 invalidation (both caches), IRQ 13 and NE, FDIV switch');
}
// The Pentium Pro machine: the start-up screen, the clocks of the devices at 200 MHz, the FSB
// ratio, the setup switch, the CPU reset, KEN#, bus.poke8, the writes that do not come from the
// CPU (the three caches: L1 data, L1 code and L2), A20, IRQ 13 and CR0.NE, no FDIV bug.
if (MODEL === '80686') {
  const bad = [];
  const want = (got, exp, name) => { if (got !== exp) bad.push(`${name}: got ${got}, want ${exp}`); };
  const power = opts => {
    const m = new MachineClass({ video: VIDEO, ...opts });
    const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
    m.setRom(rom, bios.symbols);
    if (vgaRom) m.setVgaRom(vgaRom.bytes);
    m.reset();
    m.run(m.clockHz / 2);                              // the POST, then "No boot disk"
    return m;
  };
  const m = power({});
  const text = screen(m);
  if (!/CPU   Intel Pentium Pro @ 200 MHz, 8\+8 KB L1 \+ 256 KB L2 cache, FPU on chip\n {6}CPUID GenuineIntel, family 6, model 1, stepping 9, features 0000E1BDh\n/.test(text)) bad.push('the CPU lines of the start-up screen:\n' + text);
  if (!/\nFPU   on the Pentium Pro chip\nCache: 8 KB code \+ 8 KB data \(L1\), 256 KB L2 in the CPU package, on\n/.test(text)) bad.push('the FPU and cache lines:\n' + text);
  if (text.split('\n').some(l => l.length > 80)) bad.push('a line of the start-up screen is longer than 80 columns');
  const c = m.cpu, cr0 = c.cr[0] >>> 0, D = c.dcache, I = c.icache, L2 = c.l2;
  want((cr0 & 0x60000000) >>> 0, 0, 'CR0.CD and CR0.NW are 0 after the POST');
  want(cr0 & 0x22, 0x02, 'CR0.MP = 1, CR0.NE = 0 after the POST');
  want(m.mem[0x4EE], 5, 'BDA 0040:00EE = 5 (a CPU with CPUID)');
  want(D.stats.fills > 0 && L2.stats.fills > 0 && I.stats.fills === 0, true, 'the POST fills data lines and L2 lines (RAM), no code lines (the BIOS ROM: KEN# = 0)');
  // the clocks: the devices count CPU clocks at 200 MHz
  want(m.bus.busRatio, 3, 'bus.busRatio (200 MHz core / 66 MHz FSB)'); want(c.busRatio, 3, 'cpu.busRatio after a step');
  want(m.bus.waitStates, 1, 'bus.waitStates');
  want(m.refreshClk, 1600, 'port 61h bit 4 changes each 1600 clocks (8 us)');
  want(m.isaIo, 172, 'the ISA I/O time of the Sound Blaster ports (about 0.9 us)');
  if (m.vga) want(m.vga.clockHz, 200e6, 'the VGA timing counts 200 MHz clocks'); else want(m.crtc.scale, 4772727 / 200e6, 'the CGA timing scale');
  want(m.fdc.rot, 0.2 * 200e6, 'the floppy: one turn in 0.2 s');
  // the DOS and BIOS clock tick: IRQ 0 comes 18.2 times each emulated second
  {
    const t = power({}), c0 = t.mem[0x46C] | (t.mem[0x46D] << 8);
    t.cpu.halted = false; t.cpu.f |= 0x200;
    t.pokeMem(0x7C00, [0xEB, 0xFE]);                   // JMP $ with interrupts on
    t.cpu.cache[1].base = 0; t.cpu.sregs[1] = 0; t.cpu.ip = 0x7C00; t.cpu.flush();
    t.run(t.clockHz);
    const ticks = ((t.mem[0x46C] | (t.mem[0x46D] << 8)) - c0) & 0xFFFF;
    if (ticks < 17 || ticks > 19) bad.push(`BIOS clock ticks in one emulated second: ${ticks}, want 18`);
  }
  // no FDIV bug
  want(m.fdivBug, false, 'm.fdivBug is false'); m.fdivBug = true; want(m.fdivBug, false, 'm.fdivBug = true has no effect');
  want(c.fdivBug, false, 'cpu.fdivBug stays false');
  want(new MachineClass({ video: VIDEO, fdivBug: true }).cpu.fdivBug, false, 'new Machine686({ fdivBug: true }): no bug');
  const off = power({ cache: false });
  if (!/Cache: 8 KB code \+ 8 KB data \(L1\), 256 KB L2 in the CPU package, off\n/.test(screen(off))) bad.push('the setup switch "cache off": the start-up screen');
  want((off.cpu.cr[0] & 0x40000000) >>> 0, 0x40000000, 'cache off: CR0.CD stays 1');
  want(off.cpu.dcache.stats.fills + off.cpu.icache.stats.fills + off.cpu.l2.stats.fills, 0, 'cache off: no line fills (L1 and L2)');
  want(off.rtc.cmos[0x2D] & 1, 1, 'cache off: CMOS 2Dh bit 0');
  // a CPU reset (port 92h) turns the caches off; the BIOS turns them on again
  {
    const r = power({});
    r.ioWrite(0x70, 0x8F); r.ioWrite(0x71, 0x0A);      // CMOS shutdown code 0Ah: jump to 0040:0067
    r.mem.set([0x00, 0x7C, 0x00, 0x00], 0x467);        // 0000:7C00
    r.pokeMem(0x7C00, [0xEB, 0xFE]);                    // JMP $
    r.ioWrite(0x92, 0x01);
    want((r.cpu.cr[0] & 0x60000000) >>> 0, 0x60000000, 'after a CPU reset CR0.CD = NW = 1');
    want(r.cpu.l2.tag.every(t => t < 0), true, 'after a CPU reset the L2 is empty');
    r.run(r.clockHz / 100);
    want((r.cpu.cr[0] & 0x60000000) >>> 0, 0, 'the resume path of the BIOS clears CD and NW');
    want(r.physIP, 0x7C00, 'the resume path jumps to 0040:0067');
    want(r.bus.busRatio, 3, 'a CPU reset keeps bus.busRatio');
  }
  // KEN#
  const K = m.bus.cacheable;
  want(K(0x1000), true, 'KEN#: RAM'); want(K(0xA0000), false, 'KEN#: VGA window'); want(K(0xB8000), false, 'KEN#: B8000h');
  want(K(0xC0000), false, 'KEN#: video BIOS'); want(K(0xF0000), false, 'KEN#: BIOS ROM'); want(K(0xFFFFFFF0), false, 'KEN#: the top ROM');
  want(K(0x1000000), false, 'KEN#: no memory at 16 MB');
  m.a20 = true; want(K(0x100000), true, 'KEN#: 100000h with A20 on'); want(K(0xFFFFFF), true, 'KEN#: the last byte of the 16 MB');
  m.a20 = false; want(K(0x100000), false, 'KEN#: 100000h with A20 off'); want(K(0x200000), true, 'KEN#: 200000h with A20 off');
  m.a20 = true; m.tickDevices(0);
  // L1 and L2 hits make no bus cycle: no stats, no heat. A miss of both: 4 FSB transfers.
  const rd = a => c.physRd(a, 1, -1, 0), wr = (a, v) => c.physWr(a, 1, v, -1, 0);
  const inL1 = a => c.dFind(a) >= 0, inL2 = a => c.l2Find(a) >= 0;
  m.takeStats();
  rd(0x5000);
  let st = m.takeStats();
  want(st.dev.ram, 32, 'an L2 miss reads the 32-byte line on the FSB (m.stats)');
  want(inL1(0x5000) && inL2(0x5000), true, 'the line is in the L1 and in the L2');
  const h0 = m.heat.read[0x50], hits = D.stats.hits;
  rd(0x5001); rd(0x5002);
  st = m.takeStats();
  want(D.stats.hits - hits, 2, 'two L1 hits');
  want(st.memr + st.dev.ram, 0, 'an L1 hit makes no bus cycle (m.stats)');
  want(m.heat.read[0x50], h0, 'an L1 hit makes no heat');
  // an L2 hit: fill the 2 ways of the L1 set of 5000h with other lines, then read 5000h again
  rd(0x5000 + 0x1000); rd(0x5000 + 0x2000);
  want(inL1(0x5000), false, 'two other lines of the set push 5000h out of the L1');
  want(inL2(0x5000), true, '5000h stays in the L2');
  m.takeStats();
  const l2h = L2.stats.hits;
  want(rd(0x5003), m.mem[0x5003], 'an L2 hit gives the byte');
  st = m.takeStats();
  want(L2.stats.hits - l2h, 1, 'one L2 hit'); want(st.memr + st.dev.ram, 0, 'an L2 hit makes no FSB cycle (m.stats)');
  // bus.poke8: a store to an E line (then M) makes no bus cycle, but memory gets the byte
  want(D.state[c.dFind(0x5000)], 2, 'a line fill with PWT = 0 is E');
  const hw = m.heat.write[0x50];
  wr(0x5004, 0x5A);
  st = m.takeStats();
  want(m.mem[0x5004], 0x5A, 'poke8: memory has the byte of a store to an E line');
  want(D.state[c.dFind(0x5000)], 3, 'the store makes the line M');
  want(st.memw + st.dev.ram, 0, 'poke8: no bus cycle (m.stats)');
  want(m.heat.write[0x50], hw, 'poke8: no heat');
  // the writes that do not come from the CPU reach it through the three caches
  m.dmaWrite(0x5003, 0x42);
  want(inL1(0x5003) || inL2(0x5003), false, 'DMA write: the line leaves the L1 data cache and the L2');
  want(rd(0x5003), 0x42, 'DMA write: the CPU reads the new byte (L1 data, L2)');
  rd(0x6000); rd(0x6000 + 0x1000); rd(0x6000 + 0x2000);   // 6000h only in the L2
  want(!inL1(0x6000) && inL2(0x6000), true, '6000h only in the L2');
  m.dmaWrite(0x6001, 0x41); want(inL2(0x6000), false, 'DMA write: an L2 line becomes invalid');
  want(rd(0x6001), 0x41, 'DMA write: the CPU reads the new byte (L2 line)');
  rd(0x6000); m.pokeMem(0x6000, [0x43, 0x44]);
  want(inL1(0x6000) || inL2(0x6000), false, 'pokeMem: the line leaves the L1 and the L2');
  want(rd(0x6001), 0x44, 'pokeMem: the CPU reads the new bytes');
  rd(0x7000); m.mem[0x7000] = 0x45; m.memChanged(0x7000, 1); want(rd(0x7000), 0x45, 'memChanged after a write to m.mem');
  rd(0x10100); m.loadProgram(new Uint8Array([0x90, 0xCC]), 0x100); want(rd(0x10101), 0xCC, 'loadProgram: the CPU reads the new program');
  rd(0x46C); const inv = D.stats.invalidations; m.setClockFromHost(); want(D.stats.invalidations > inv, true, 'setClockFromHost: the line of 0040:006C becomes invalid');
  // ... and the code cache: a loop at 0000:7C00 runs from the L1 code cache
  const loop = () => { c.cache[1].base = 0; c.sregs[1] = 0; c.ip = 0x7C00; c.flush(); c.halted = false; m.run(2000); };
  m.pokeMem(0x7C00, [0xEB, 0xFE]); loop();
  want(c.iFind(0x7C00) >= 0 && inL2(0x7C00), true, 'the loop at 7C00h is in the code cache and in the L2');
  m.dmaWrite(0x7C1F, 0x90); want(c.iFind(0x7C00) < 0 && !inL2(0x7C00), true, 'DMA write: the code line leaves the L1 code cache and the L2');
  loop(); want(c.iFind(0x7C00) >= 0, true, 'the loop is in the code cache again');
  m.pokeMem(0x7C10, [0x90]); want(c.iFind(0x7C00), -1, 'pokeMem: the code line becomes invalid');
  loop(); const ic = I.stats.invalidations; m.pokeMem(0x7C00, [0xEB, 0xFE]); want(I.stats.invalidations, ic + 1, 'pokeMem: one code line (icache.stats.invalidations)');
  // A20: a line of 100000h (A20 on) must not answer for 000000h (A20 off), and a write through
  // 100000h with A20 off must reach the cached line of 000000h (write8 and poke8)
  m.mem[0x100000] = 0x77; m.mem[0] = 0x11; m.memChanged(0, 1); m.memChanged(0x100000, 1);
  want(rd(0x100000), 0x77, 'A20 on: 100000h'); want(rd(0), 0x11, 'A20 on: 000000h');
  m.a20 = false; m.tickDevices(0);
  want(c.dFind(0x100000) < 0 && !inL2(0x100000), true, 'A20 off: the line of 100000h is invalid (L1 and L2)');
  want(rd(0x100000), 0x11, 'A20 off: 100000h reads 000000h (not the old line)');
  wr(0x100000, 0x99); want(rd(0), 0x99, 'A20 off: a write to 100000h changes the line of 000000h');
  rd(5); m.bus.poke8(0x100005, 0x66); want(m.mem[5], 0x66, 'A20 off: poke8 to 100005h writes 000005h'); want(rd(5), 0x66, 'A20 off: poke8 makes the line of 000005h invalid');
  m.a20 = true; m.tickDevices(0); want(rd(0x100000), 0x77, 'A20 on again: 100000h');
  // IRQ 13 only while CR0.NE = 0
  m.fpu.intRequest = true;
  c.cr[0] &= ~0x20; want(m.fpuErr(), true, 'FPU error with CR0.NE = 0: IRQ 13');
  c.cr[0] |= 0x20; want(m.fpuErr(), false, 'FPU error with CR0.NE = 1: no IRQ 13 (#MF)');
  m.fpu.intRequest = false; c.cr[0] &= ~0x20;
  // the switch at run time: off empties the three caches and stops the fills
  const m2 = power({});
  m2.cacheEnabled = false;
  want(m2.cpu.dcache.tag.every(t => t < 0) && m2.cpu.icache.tag.every(t => t < 0) && m2.cpu.l2.tag.every(t => t < 0), true, 'cacheEnabled = false: the three caches are empty');
  const f0 = m2.cpu.dcache.stats.fills + m2.cpu.l2.stats.fills; m2.cpu.physRd(0x8000, 1, -1, 0); want(m2.cpu.dcache.stats.fills + m2.cpu.l2.stats.fills, f0, 'cacheEnabled = false: no fills');
  // the trace of the ooo sample: younger µops pass the DIV (the 'uop' events, field passed)
  {
    const s = SAMPLES.find(x => x.id === 'ooo');
    const t = new MachineClass({ video: VIDEO });
    const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
    t.setRom(rom, bios.symbols); if (vgaRom) t.setVgaRom(vgaRom.bytes);
    const p = Asm86.assemble(s.src, { origin: 0x100, cpu: CPU_ASM });
    t.reset();
    t.loadProgram(p.bytes, p.origin); t.pokeMem(0x4F0, [0x00, 0x01, 0x00, 0x10, 0x86]);
    const l1 = 0x10000 + p.symbols['loop1.l'] + 0;
    for (let i = 0; i < 2e6 && t.physIP !== l1; i++) t.tickDevices(t.cpu.step());
    let passDiv = 0, divs = 0;
    for (let i = 0; i < 400; i++) {
      const { events } = t.step();
      const u = events.filter(e => e.k === 'uop');
      if (u.some(e => e.kind === 'div')) divs++;
      passDiv += u.filter(e => e.kind === 'alu' && e.passed > 0 && /add/.test(e.text)).length;
    }
    if (!(divs > 5 && passDiv > 50)) bad.push(`the trace of the ooo sample: ${divs} DIV steps, ${passDiv} ADD µops that pass older µops`);
    else console.log(`ok   the trace of the ooo sample: ${divs} DIV steps, ${passDiv} ADD µops that pass older µops (field passed)`);
  }
  if (bad.length) { fail++; console.log('FAIL Pentium Pro caches and machine:\n  ' + bad.join('\n  ')); } else console.log('ok   Pentium Pro start-up screen, 200 MHz device clocks, FSB ratio, setup switch, CPU reset, KEN#, L1 / L2 hits, poke8, DMA / pokeMem / A20 invalidation (L1 data, L1 code, L2), IRQ 13 and NE, no FDIV bug');
}
console.log(fail ? `${fail} sample(s) failed` : 'all samples passed');
process.exitCode = fail ? 1 : 0;
