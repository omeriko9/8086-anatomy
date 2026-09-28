// The CPU core alone in an empty Chrome page (as tests/bench.mjs does in Node).
// Usage: node tools/corebench-chrome.mjs [seconds]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const secs = +(process.argv[2] || 2);
const src = ['src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const prog = [...fs.readFileSync(path.join(root, 'tests/asm286/bench.bin'))];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const files = ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js',
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js',
  'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/bios.js', 'src/core/vgabios.js'];
if (process.argv.includes('--machine')) {
  for (const model of ['80386', '80486']) {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({ content: files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') });
    const r = await page.evaluate((model, prog, secs, bios, traced) => {
      const m = new ({ 80386: Machine386, 80486: Machine486 })[model]({ video: 'cga' });
      const b = Asm86.assemble(biosSource(model), { origin: 0 });
      const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(b.bytes); m.setRom(rom); m.reset();
      m.loadProgram(new Uint8Array(prog), 0x100); m.pokeMem(0x4F0, [0, 1, 0, 0x10, 0x86]);
      const slice = Math.round(m.clockHz / 100);
      if (!bios) { const c = m.cpu; for (let i = 0; i < 6; i++) c.loadSeg(i, 0x1000); if (model === '80486') c.cr[0] &= ~0x60000000; c.ip = 0x100; c.flush(); }
      for (let i = 0; i < 200; i++) m.run(slice);
      for (let i = 0; i < traced; i++) m.step();
      for (let i = 0; i < 50; i++) m.run(slice);
      const c = m.cpu, i0 = c.instructions, t0 = performance.now();
      while (performance.now() - t0 < secs * 1000) m.run(slice);
      return (c.instructions - i0) / ((performance.now() - t0) / 1000);
    }, model, prog, secs, !process.argv.includes('--nobios'), +(process.env.TRACED || 0));
    console.log(`Chrome Machine ${model}${process.argv.includes('--nobios') ? ' (no BIOS)' : ''}: ${(r / 1e6).toFixed(2)} M instr/s`);
    await page.close();
  }
  await browser.close();
  process.exit(0);
}
for (const which of ['386', '486']) {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: src });
  const r = await page.evaluate((which, prog, secs) => {
    const Cls = which === '486' ? CPU80486 : CPU80386;
    const mem = new Uint8Array(1 << 24);
    const bus = { read8: a => mem[a], write8: (a, v) => { mem[a] = v; }, in8: () => 0xFF, out8: () => {}, fpu: null, waitStates: 1 };
    mem.set(prog, 0x10100);
    const cpu = new Cls(bus); cpu.reset();
    for (let i = 0; i < 6; i++) cpu.loadSeg(i, 0x1000);
    if (which === '486') cpu.cr[0] &= ~0x60000000;
    cpu.ip = 0x100; cpu.flush(); cpu.syncIn(); cpu.batch = true;
    for (let i = 0; i < 2e6; i++) cpu.step();
    const i0 = cpu.instructions, t0 = performance.now();
    while (performance.now() - t0 < secs * 1000) for (let i = 0; i < 1e5; i++) cpu.step();
    return (cpu.instructions - i0) / ((performance.now() - t0) / 1000);
  }, which, prog, secs);
  console.log(`Chrome CPU80${which}: ${(r / 1e6).toFixed(2)} M instr/s`);
  await page.close();
}
await browser.close();
