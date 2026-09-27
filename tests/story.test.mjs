// Trace stories: runs each sample program and builds the step list of every instruction.
// Checks that each bus cycle has its steps, and that no step text is empty or broken.
// The last part traces a floppy boot (the BIOS, the uPD765 and the DMA: 'fdc' and 'dma' events).
// Usage: node tests/story.test.mjs [--model 80286|80386|80486|80586|80686] [--video vga]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const MODEL = arg('--model', '8086'), VIDEO = arg('--video', 'cga');
vm.runInThisContext(`var CPU_MODEL = ${JSON.stringify(MODEL)}; var VIDEO_CARD = ${JSON.stringify(VIDEO)};`);
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js',
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js', 'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js',
  'src/core/bios.js', 'src/core/vgabios.js', 'src/ui/story.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const [Asm86, SAMPLES, Story, fat12Blank] = ['Asm86', 'SAMPLES', 'Story', 'fat12Blank'].map(n => vm.runInThisContext(n));
const M = vm.runInThisContext(MODEL === '80686' ? 'Machine686' : MODEL === '80586' ? 'Machine586' : MODEL === '80486' ? 'Machine486' : MODEL === '80386' ? 'Machine386' : MODEL === '80286' ? 'Machine286' : 'Machine');
const bios = Asm86.assemble(vm.runInThisContext('biosSource')(MODEL), { origin: 0 });
const vgaRom = VIDEO === 'vga' ? vm.runInThisContext('makeVgaRom')(null) : null;

let fail = 0, instrs = 0, steps = 0, buses = 0, idle = 0;
const kinds = {};
const bad = (msg) => { if (fail++ < 15) console.log('FAIL', msg); };
// a newer machine also runs the samples of the older AT models (as the page shows them)
const OLDER = { '80286': ['80286'], '80386': ['80286', '80386'], '80486': ['80286', '80386', '80486'], '80586': ['80286', '80386', '80486', '80586'],
  '80686': ['80286', '80386', '80486', '80586', '80686'] }[MODEL] || [];
for (const s of SAMPLES.filter(x => (!x.model || OLDER.includes(x.model)) && (!x.video || x.video === VIDEO))) {
  const m = new M({ video: VIDEO });
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes.subarray(0, 0x10000));
  m.setRom(rom, bios.symbols);
  if (vgaRom) m.setVgaRom(vgaRom.bytes);
  m.reset();
  const p = Asm86.assemble(s.src, { origin: 0x100, cpu: MODEL === '80686' ? '686' : MODEL === '80586' ? '586' : MODEL === '80486' ? '486' : MODEL === '80386' ? '386' : MODEL === '80286' ? '286' : '8086' });
  if (!p.ok) { bad(`${s.id}: assembly`); continue; }
  // like the page: the BIOS starts, then jumps to the program entry at 0040:00F0
  m.loadProgram(p.bytes, p.origin);
  m.mem[0x4F0] = 0x00; m.mem[0x4F1] = 0x01; m.mem[0x4F2] = 0x00; m.mem[0x4F3] = 0x10; m.mem[0x4F4] = 0x86;
  m.reset();
  for (let i = 0; i < 6000 && !(m.cpu.halted && !(m.cpu.f & 0x200)); i++) {
    if (m.cpu.halted) { const c = m.cpu.step(); m.tickDevices(c); i--; if (++idle > 2e6) break; continue; }
    checkInstr(s, m);
  }
}
// One traced instruction: the step list with each prefetch option.
function checkInstr(s, m) {
    for (const pre of ['short', 'full', 'hide']) {
      const { events } = pre === 'short' ? m.step() : { events: m.lastEvents };
      if (pre === 'short') m.lastEvents = events;
      const st = Story.build(events, { prefetch: pre });
      const nBus = events.filter(e => e.k === 'bus').length, nFetch = events.filter(e => e.k === 'fetch').length;
      const bSteps = st.steps.filter(x => x.kind === 'bus');
      const halts = events.filter(e => e.k === 'bus' && e.type === 'halt').length;
      const intas = events.filter(e => e.k === 'bus' && e.type === 'inta').length;
      const want = (nBus - halts - intas) * 3 + intas * 2 + halts + (pre === 'full' ? nFetch * 3 : pre === 'short' ? nFetch : 0);
      if (bSteps.length !== want) bad(`${s.id} ${st.text} (${pre}): ${bSteps.length} bus steps, want ${want}`);
      st.steps.forEach((x, k) => {
        if (x.i !== k) bad(`${s.id}: index`);
        for (const f of ['title', 'text', 'sum', 'lane']) if (!x[f] || /undefined|NaN|\[object/.test(x[f])) bad(`${s.id} ${st.text}: step ${k} ${f} = ${x[f]}`);
        if (!x.token || !x.token.tag || /undefined|NaN/.test(x.token.tag + x.token.val)) bad(`${s.id}: token ${JSON.stringify(x.token)}`);
        if (!(x.t >= 0)) bad(`${s.id}: t ${x.t}`);
        if (pre === 'short') kinds[x.kind + (x.phase ? ':' + x.phase : '')] = (kinds[x.kind + (x.phase ? ':' + x.phase : '')] || 0) + 1;
      });
      if (/;/.test(st.text)) bad(`${s.id}: comment in ${st.text}`);
      if (pre === 'short') { instrs++; steps += st.steps.length; buses += nBus; }
    }
}
// A floppy boot: the POST runs without the trace up to its first INT 13h, then every
// instruction is traced until the boot sector prints its message.
{
  const s = { id: 'floppy' };
  const m = new M({ video: VIDEO });
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes.subarray(0, 0x10000));
  m.setRom(rom, bios.symbols);
  if (vgaRom) m.setVgaRom(vgaRom.bytes);
  m.reset();
  m.insertDisk(0, 'boot', fat12Blank('BOOT'));
  const i13 = 0xF0000 + bios.symbols.int13;
  while (m.physIP !== i13 && m.cpu.cycles < 1e7) m.tickDevices(m.cpu.step());
  const text = () => { const v = m.vram(); let t = ''; for (let i = 0; i < 4000; i += 2) t += String.fromCharCode(v[i] || 32); return t; };
  let n = 0;
  for (; n < 400000 && !/not a system disk/.test(text()); n++) checkInstr(s, m);
  if (!/not a system disk/.test(text())) bad('floppy: the boot sector did not run');
  if (!kinds.fdc || !kinds.dma) bad(`floppy: no fdc or dma steps (${kinds.fdc || 0}, ${kinds.dma || 0})`);
}
console.log(`model ${MODEL}, video ${VIDEO}: ${instrs} instructions, ${steps} steps (1-step prefetch), ${buses} bus cycles`);
console.log('step kinds:', JSON.stringify(kinds));
console.log(fail ? `${fail} failures` : 'all pass');
process.exitCode = fail ? 1 : 0;
