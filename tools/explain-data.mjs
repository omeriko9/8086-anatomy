// The data of the Explain player (src/explain): runs a small program on the 8086 machine of the
// emulator, one instruction at a time with the full micro-event trace, and writes everything
// that the player shows: the program bytes, the registers before and after, the code fetches,
// the queue, the effective address, the bus cycles and the clock of each event.
// The player only arranges these values in time; it does not make any value up.
// Usage: node tools/explain-data.mjs   (writes src/explain/data.js)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadCore } = await import('./vgapng.mjs');
const G = loadCore();

// The program: it writes the letter A to the top-left corner of the screen.
const SRC = [
  ['mov ax, 0xB800', 'Put the number B800h in register AX.'],
  ['mov es, ax', 'Copy AX to the segment register ES.'],
  ["mov al, 'A'", "Put the code of the letter A (41h) in AL."],
  ['mov [es:0], al', 'Write AL to memory address ES:0000.'],
];
const ORG = 0x100, SEG = 0x1000;
const src = `org 0x${ORG.toString(16)}\n` + SRC.map(l => ' ' + l[0]).join('\n') + '\n hlt\n';
const asm = G('Asm86').assemble(src, { origin: ORG });
if (asm.errors && asm.errors.length) throw new Error(JSON.stringify(asm.errors));

const bios = G('Asm86').assemble(G('biosSource')('8086'), { origin: 0 });
const m = new (G('Machine'))({ video: 'cga' });
const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
m.setRom(rom, bios.symbols);
m.reset();
m.loadProgram(asm.bytes, ORG);
m.pokeMem(0x4F0, [ORG & 0xFF, ORG >> 8, SEG & 0xFF, SEG >> 8, 0x86]);
// run the BIOS until the program starts (the loader jumps to SEG:ORG)
let guard = 0;
while (!(m.cpu.sregs[1] === SEG && m.cpu.ip === ORG) && guard++ < 5e6) m.step();
// the program's world starts with a clear screen (as after CLS): spaces, grey on black
for (let i = 0; i < 4000; i += 2) { m.mem[0xB8000 + i] = 0x20; m.mem[0xB8000 + i + 1] = 0x07; }

const R16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'], SR = ['ES', 'CS', 'SS', 'DS'];
const regs = () => {
  const c = m.cpu, o = {};
  R16.forEach((n, i) => { o[n] = c.regs[i]; });
  SR.forEach((n, i) => { o[n] = c.sregs[i]; });
  o.IP = c.ip; o.FLAGS = c.f;
  return o;
};
const lin = (seg, off) => ((seg << 4) + off) & 0xFFFFF;
const start = { regs: regs(), clock: m.cpu.cycles, vram: [...m.mem.subarray(0xB8000, 0xB8000 + 8)] };
const codeLin = lin(SEG, ORG);
const steps = [];
for (let k = 0; k < SRC.length; k++) {
  const before = regs(), ip = m.cpu.ip;
  const { cycles, events } = m.step();
  steps.push({
    ip, lin: lin(SEG, ip), text: SRC[k][0], what: SRC[k][1], cycles, before, after: regs(),
    events: events.map(e => {
      const o = { k: e.k, t: e.t };
      for (const f of ['addr', 'data', 'width', 'seg', 'dev', 'type', 'r', 'v', 'op', 'n', 'segv', 'off', 'phys', 'len', 'bytes', 'text']) if (e[f] !== undefined) o[f] = e[f];
      return o;
    }),
  });
}
const prog = asm.bytes;
const out = {
  note: 'Made by tools/explain-data.mjs from the 8086 machine of the emulator. Do not change it here.',
  cpu: '8086', clockHz: m.clockHz, seg: SEG, org: ORG, codeLin,
  program: steps.map(s => ({ ip: s.ip, lin: s.lin, text: s.text, what: s.what, bytes: [...m.mem.subarray(s.lin, s.lin + s.events.find(e => e.k === 'decode').len)] })),
  after: [...prog.subarray(steps.reduce((n, s) => n + s.events.find(e => e.k === 'decode').len, 0))],   // the bytes after the program (HLT)
  memory: [...m.mem.subarray(codeLin, codeLin + 16)],
  vramAfter: [...m.mem.subarray(0xB8000, 0xB8000 + 8)],
  start, steps,
  totalCycles: steps.reduce((n, s) => n + s.cycles, 0),
};
fs.mkdirSync(path.join(root, 'src/explain'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/explain/data.js'), `// ${out.note}\nconst EXPLAIN_DATA = ${JSON.stringify(out)};\n`);
console.log(`src/explain/data.js: ${steps.length} instructions, ${out.totalCycles} clocks, ${steps.reduce((n, s) => n + s.events.length, 0)} events`);
