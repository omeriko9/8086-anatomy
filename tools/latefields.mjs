// Fields that code adds to the machine objects after their constructor. Each late field
// changes the hidden class of the object in V8 and can make the whole emulator slow
// (see "Speed of the run loop" in ARCHITECTURE.md). The constructors must make all fields.
// Usage: node tools/latefields.mjs   (prints the late fields for each model; none = good)
import { loadCore } from './vgapng.mjs';
const G = loadCore();
const models = { 8086: 'Machine', 80286: 'Machine286', 80386: 'Machine386', 80486: 'Machine486' };
if (G('typeof Machine586') !== 'undefined') models[80586] = 'Machine586';
if (G('typeof Machine686') !== 'undefined') models[80686] = 'Machine686';
let bad = 0;
for (const [model, cls] of Object.entries(models)) {
  for (const video of ['cga', 'vga']) {
    const m = new (G(cls))({ video });
    const objs = () => ({ cpu: m.cpu, machine: m, sbc: m.sb, pic: m.pic, pic2: m.pic2, pit: m.pit, kbd: m.kbd, ppi: m.ppi, dma: m.dma, dma2: m.dma2, crtc: m.crtc, vga: m.vga, fdc: m.fdc, sb: m.sb, fpu: m.fpu, cmos: m.cmos, bus: m.bus });
    const before = {};
    for (const [k, o] of Object.entries(objs())) if (o) before[k] = new Set(Object.keys(o));
    const bios = G('Asm86').assemble(G('biosSource')(model), { origin: 0 });
    const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes); m.setRom(rom);
    if (m.vga) m.setVgaRom(G('makeVgaRom')(null).bytes);
    m.reset();
    m.loadProgram(new Uint8Array([0x90, 0xCC]), 0x100);
    if (m.sb && m.sb.origin) m.sb.origin(0, 44100);
    for (let i = 0; i < 60; i++) m.run(Math.round(m.clockHz / 50));
    for (let i = 0; i < 3000; i++) m.step();
    m.keyDown(0x1C); m.keyUp(0x1C);
    for (let i = 0; i < 20; i++) m.run(Math.round(m.clockHz / 50));
    for (let i = 0; i < 500; i++) m.step();
    for (const [k, o] of Object.entries(objs())) {
      if (!o) continue;
      const late = Object.keys(o).filter(f => !(before[k] && before[k].has(f)));
      if (late.length) { bad++; console.log(`${model} ${video} ${k}: ${late.join(', ')}`); }
    }
  }
}
console.log(bad ? `${bad} objects get late fields` : 'no late fields');
