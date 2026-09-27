// The WebAssembly model of the Pentium Pro (src/core/p6ooo.c) against the JavaScript model
// (CPU80686.ooo): two machines run the same program in slices; one uses only the JavaScript model
// (cpu.w6Off = true), the other the WebAssembly model. After each slice the clocks, the
// instructions, the model clocks (oS), the ROB, the RAT, the store buffer, the BTB and all the
// counters must be the same. Programs: the benchmark, the five P6 samples, and the start of the
// user's DOS 6.22 floppy (when it is there). A third machine changes between the two models
// (the trace uses the JavaScript model) and must also stay the same.
// Usage: node tests/p6wasm.test.mjs [--secs S (emulated seconds of the benchmark, default 0.05)]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js',
  'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/p6ooo.wasm.js', 'src/core/cpu80686.js', 'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js',
  'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js', 'src/core/machine286.js', 'src/core/machine386.js',
  'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js', 'src/core/vgabios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const G = n => vm.runInThisContext(n);
const args = process.argv.slice(2);
const secs = +(args[args.indexOf('--secs') + 1] || 0) || 0.05;

let pass = 0, fail = 0;
const check = (ok, name, info = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

const bios = G('Asm86').assemble(G('biosSource')('80686'), { origin: 0 });
function machine(js) {
  const m = new (G('Machine686'))({ video: 'cga' });
  if (js) m.cpu.w6Off = true;
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
  m.setRom(rom, bios.symbols);
  m.reset();
  return m;
}
// the state of the model, as one list of numbers
function state(c) {
  const R = c.rob, S = c.rs, T = c.rat, SB = c.sb, B = c.btb, st = c.oooStats;
  const out = [c.cycles, c.instructions, c.robPos, c.rsPos, c.sbPos, B.rsbTop, ...c.oS];
  for (const a of [R.uop, R.instr, R.kind, R.port, R.src1, R.src2, R.dst, R.issue, R.dispatch, R.done, R.retire, S.uop, S.rob, S.issue, S.dispatch,
    T.rob, T.ready, T.retire, T.width, SB.addr, SB.bytes, SB.std, SB.commit, SB.rob, B.tag, B.target, B.hist, B.counter, B.rsb, c.ports.uops, st.decoders]) out.push(...a);
  for (const k of Object.keys(st)) if (typeof st[k] === 'number') out.push(st[k]);
  for (const k of Object.keys(B.stats)) out.push(B.stats[k]);
  return out;
}
const names = ['cycles', 'instructions', 'robPos', 'rsPos', 'sbPos', 'rsbTop'];
function diff(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return `item ${names[i] || i}: ${a[i]} / ${b[i]}`; return a.length === b.length ? '' : 'length'; }

// Run the machines in slices; `mixed`: the third machine uses the JavaScript model in some slices.
function compare(name, setup, slices, sliceClk) {
  const J = machine(true), W = machine(false), X = machine(false);
  for (const m of [J, W, X]) setup(m);
  let bad = '', at = -1;
  for (let k = 0; k < slices && !bad; k++) {
    X.cpu.w6Mix = (k % 7) >= 4;                      // (see below)
    for (const m of [J, W, X]) m.run(sliceClk);
    const a = state(J.cpu), b = state(W.cpu), c = state(X.cpu);
    bad = diff(a, b) || (diff(a, c) ? 'mixed: ' + diff(a, c) : '');
    if (bad) at = k;
  }
  const used = W.cpu.w6 !== null;
  check(used && !bad, `${name}: the WebAssembly model = the JavaScript model`, bad ? `(slice ${at}: ${bad})` : `(${J.cpu.instructions} instructions, ${J.cpu.cycles} clocks)`);
}
// The mixed machine: in some slices the step uses the JavaScript model, as in a trace.
{
  const P = G('CPU80686').prototype, orig = P.w6Ooo;
  P.w6Ooo = function (mode, R) {
    if (this.w6Mix) { const M = this.ooo(mode); this.w6Push(); return M; }
    return orig.call(this, mode, R);
  };
}

const slice = Math.round(200e6 / 1000);             // 1 ms of the 200 MHz clock
// 1. the benchmark program
{
  const bin = fs.readFileSync(path.join(root, 'tests/asm286/bench.bin'));
  compare('the benchmark', m => { m.loadProgram(bin, 0x100); m.pokeMem(0x4F0, [0x00, 0x01, 0x00, 0x10, 0x86]); }, Math.round(secs * 1000) + 100, slice);
}
// 2. the P6 samples
for (const s of G('SAMPLES').filter(x => x.model === '80686')) {
  const a = G('Asm86').assemble(s.src, { origin: 0x100 });
  compare(`sample ${s.id}`, m => { m.loadProgram(a.bytes, 0x100); m.pokeMem(0x4F0, [0x00, 0x01, 0x00, 0x10, 0x86]); }, 120, slice);
}
// 3. the start of DOS 6.22 (HIMEM, protected mode, the disk, interrupts)
{
  const IMG = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files/msdos/dos6.img';
  if (fs.existsSync(IMG)) {
    const img = new Uint8Array(fs.readFileSync(IMG));
    compare('DOS 6.22 start', m => { m.insertDisk(0, 'dos6', img.slice()); }, 400, slice * 5);
  } else console.log('skip: no DOS 6.22 image');
}
console.log(fail ? `${fail} test(s) failed, ${pass} passed` : `all ${pass} tests passed`);
process.exit(fail ? 1 : 0);
