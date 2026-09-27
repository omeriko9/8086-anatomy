// VGA card tests: registers and memory paths (src/core/vga.js), the picture
// (VgaRenderer in src/ui/crt.js), the video BIOS option ROM (src/core/vgabios.js),
// 2.88 MB floppies, and the real test: Wolfenstein 3D under DOS 6.22 on the
// 80286 + VGA machine (the user's files; that part is skipped when they are missing), with
// the Sound Blaster: the game finds the DSP and the OPL2, plays its music on the OPL2 and
// its digitized sounds by DMA with IRQ 7. The mixed sound goes to tools/wolf3d-sb-<model>.wav.
// Usage: node tests/vga.test.mjs [--no-wolf] [--png dir] [--emu87] [--model 80286|80386|80486|80586|80686]
//   --model: the machine for Wolfenstein 3D (default 80286). On the 80386, 80486, 80586 and 80686 the
//   DOS 6.22 disk stays unchanged (its CD-ROM driver needs a 386); on the 80286 the copy has
//   that line as REM.
//   --wolf-only: only the Wolfenstein 3D part (the test runs that part in a new process).
//   --emu87: run Wolf3D with Borland's software emulator (SET 87=N) instead of the 80287.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { png } from '../tools/vgapng.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js',
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js',
  'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js', 'src/core/vgabios.js', 'src/ui/crt.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const G = n => vm.runInThisContext(n);
const [VGA, VgaRenderer, Asm86, makeVgaRom, fat12Blank, fat12AddFiles, Fat12, FloppyDisk] =
  ['VGA', 'VgaRenderer', 'Asm86', 'makeVgaRom', 'fat12Blank', 'fat12AddFiles', 'Fat12', 'FloppyDisk'].map(G);
const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const PNG_DIR = arg('--png');
const WOLF_MODEL = arg('--model') || '80286';
const MODELS = ['8086', '80286', '80386', '80486', '80586', '80686'];
const machineName = model => (model === '80686' ? 'Machine686' : model === '80586' ? 'Machine586' : model === '80486' ? 'Machine486' : model === '80386' ? 'Machine386' : model === '80286' ? 'Machine286' : 'Machine');
if (PNG_DIR) fs.mkdirSync(PNG_DIR, { recursive: true });

let pass = 0, fail = 0, section = '';
const check = (ok, name) => { if (ok) pass++; else { fail++; console.log(`FAIL [${section}] ${name}`); } };
const eq = (a, b, name) => check(a === b, `${name}: got ${a}, want ${b}`);
const near = (a, b, tol, name) => check(Math.abs(a - b) <= tol, `${name}: got ${a}, want ${b} +- ${tol}`);
const begin = s => { section = s; console.log(`- ${s}`); };
// --wolf-only: only the Wolfenstein 3D part. Without it the Wolfenstein part runs in a new
// Node process: after the other parts (four machine models) the code of the CPU cores and
// the machines is slower in this process (V8 has seen many types at the same places).
const WOLF_ONLY = process.argv.includes('--wolf-only');
const part = s => { if (WOLF_ONLY) return false; begin(s); return true; };
const hex = v => (v >>> 0).toString(16);

// ---------- 1. registers and memory ----------
if (part('graphics controller write modes, latches, read modes')) {
  const v = new VGA();
  const out = (p, i, d) => { v.ioWrite(p, i); v.ioWrite(p + 1, d); };
  out(0x3C4, 2, 0x0F); out(0x3C4, 4, 0x06);          // all planes, sequential, no chain 4
  out(0x3CE, 6, 0x05);                                // A0000 64 KB, graphics
  out(0x3CE, 5, 0x00); out(0x3CE, 8, 0xFF);
  v.write8(0xA0000, 0x5A);                            // write mode 0: the byte in all planes
  eq(hex(v.vram32[0]), '5a5a5a5a', 'mode 0 all planes');
  out(0x3C4, 2, 0x05); v.write8(0xA0001, 0xC3);       // map mask 0101: planes 0 and 2
  eq(hex(v.vram32[1]), 'c300c3', 'map mask');
  out(0x3C4, 2, 0x0F);
  out(0x3CE, 0, 0x0A); out(0x3CE, 1, 0x0F);           // set/reset 1010 on all planes
  v.write8(0xA0002, 0x00);
  eq(hex(v.vram32[2]), 'ff00ff00', 'set/reset');
  out(0x3CE, 1, 0x00);
  out(0x3CE, 3, 0x02); v.write8(0xA0003, 0x81);       // rotate right by 2
  eq(v.vram[12], 0x60, 'data rotate');
  out(0x3CE, 3, 0x00);
  v.vram32[10] = 0x0F0F0F0F; v.read8(0xA000A);        // load the latches
  eq(hex(v.latch), 'f0f0f0f', 'latches');
  out(0x3CE, 3, 0x18); v.write8(0xA000A, 0xFF);       // XOR with the latches
  eq(hex(v.vram32[10]), 'f0f0f0f0', 'function XOR');
  out(0x3CE, 3, 0x08); v.read8(0xA000A); v.write8(0xA000A, 0x3C);   // AND
  eq(hex(v.vram32[10]), '30303030', 'function AND');
  out(0x3CE, 3, 0x10); v.read8(0xA000A); v.write8(0xA000A, 0x03);   // OR
  eq(hex(v.vram32[10]), '33333333', 'function OR');
  out(0x3CE, 3, 0x00);
  v.vram32[20] = 0x11223344; v.read8(0xA0014);
  out(0x3CE, 5, 0x01); v.write8(0xA0015, 0x00);       // write mode 1: the latches
  eq(hex(v.vram32[21]), '11223344', 'write mode 1');
  out(0x3CE, 5, 0x02); out(0x3CE, 8, 0x81);           // write mode 2 with bit mask 10000001
  v.vram32[30] = 0; v.read8(0xA001E); v.write8(0xA001E, 0x09);
  eq(hex(v.vram32[30]), '81000081', 'write mode 2 + bit mask');
  out(0x3CE, 5, 0x03); out(0x3CE, 0, 0x06); out(0x3CE, 8, 0xF0);    // write mode 3: data AND bit mask
  v.vram32[31] = 0; v.read8(0xA001F); v.write8(0xA001F, 0x3C);
  eq(hex(v.vram32[31]), '303000', 'write mode 3');
  out(0x3CE, 5, 0x00); out(0x3CE, 8, 0xFF); out(0x3CE, 0, 0);
  v.vram32[40] = 0x44332211;
  out(0x3CE, 4, 2); eq(v.read8(0xA0028), 0x33, 'read mode 0, read map 2');
  out(0x3CE, 5, 0x08); out(0x3CE, 2, 0x05); out(0x3CE, 7, 0x0F);    // read mode 1: colour 0101
  v.vram32[41] = 0x00FF00FF; eq(v.read8(0xA0029), 0xFF, 'colour compare all match');
  v.vram32[41] = 0x00FF00F0; eq(v.read8(0xA0029), 0xF0, 'colour compare partial');
  out(0x3CE, 7, 0x0E); eq(v.read8(0xA0029), 0xFF, 'colour don\'t care');
}
if (part('chain 4, odd/even, memory maps')) {
  const v = new VGA();
  const out = (p, i, d) => { v.ioWrite(p, i); v.ioWrite(p + 1, d); };
  out(0x3C4, 2, 0x0F); out(0x3C4, 4, 0x0E); out(0x3CE, 5, 0x40); out(0x3CE, 6, 0x05); out(0x3CE, 8, 0xFF);
  v.write8(0xA0000 + 5, 0x77);                        // plane 1, offset 4
  eq(v.vram[(4 << 2) | 1], 0x77, 'chain 4 plane = A AND 3');
  v.write8(0xA0000 + 0x4001, 0x55);                   // offset 4000h | (A >> 14)
  eq(v.vram[(0x4001 << 2) | 1], 0x55, 'chain 4 offset bits 0-1 = A bits 14-15');
  eq(v.read8(0xA0005), 0x77, 'chain 4 read');
  out(0x3C4, 4, 0x02); out(0x3CE, 5, 0x10); out(0x3CE, 6, 0x0E);   // text: odd/even at B8000
  v.write8(0xB8000, 0x41); v.write8(0xB8001, 0x1F);
  eq(v.vram[0], 0x41, 'odd/even: even byte in plane 0'); eq(v.vram[5 - 4], 0x1F, 'odd/even: odd byte in plane 1 (same offset)');
  eq(v.read8(0xB8001), 0x1F, 'odd/even read');
  eq(v.read8(0xA0000), 0xFF, 'A0000 not mapped with the B8000 map');
  out(0x3CE, 6, 0x0A); v.write8(0xB0002, 0x42); eq(v.vram[8], 0x42, 'B0000 map');
  out(0x3CE, 6, 0x02); v.write8(0xB0004, 0x43); eq(v.vram[16], 0x43, 'A0000 128 KB map');
  eq(v.textBuffer(4)[1], 0x1F, 'textBuffer');
}
if (part('DAC, attribute controller, CRTC, status timing')) {
  const v = new VGA({ clockHz: 8000000 });
  v.ioWrite(0x3C8, 5); [10, 20, 30, 40, 50, 60].forEach(x => v.ioWrite(0x3C9, x));
  v.ioWrite(0x3C7, 5); eq([0, 1, 2, 3, 4, 5].map(() => v.ioRead(0x3C9)).join(), '10,20,30,40,50,60', 'DAC write / read auto-increment');
  eq(v.ioRead(0x3C7), 3, 'DAC state after 3C7');
  v.ioWrite(0x3C2, 0x67);
  v.ioRead(0x3DA); v.ioWrite(0x3C0, 0x02); v.ioWrite(0x3C0, 0x2A);
  eq(v.attr[2], 0x2A, 'attribute index/data flip-flop');
  eq(v.pas, false, 'PAS = 0 blanks');
  v.ioWrite(0x3C0, 0x23); v.ioWrite(0x3C0, 0x15);
  eq(v.attr[3], 0, 'palette registers locked while PAS = 1');
  v.ioRead(0x3DA); eq(v.ioRead(0x3C0), 0x23, 'read index with PAS');
  v.ioWrite(0x3D4, 0x11); v.ioWrite(0x3D5, 0x80);
  v.ioWrite(0x3D4, 0x01); v.ioWrite(0x3D5, 0x27); eq(v.crtc[1], 0x4F, 'CRTC 0-7 write protected');
  v.ioWrite(0x3D4, 0x07); v.ioWrite(0x3D5, 0x00); eq(v.crtc[7], 0x0F, 'protect keeps line compare bit 8 writable');
  eq(v.ioRead(0x3B4), 0xFF, 'mono ports off in colour mode');
  const rate = (regs, misc) => {
    const w = new VGA({ clockHz: 8000000 });
    w.ioWrite(0x3C2, misc);
    w.ioWrite(0x3C4, 1); w.ioWrite(0x3C5, regs.seq1);
    regs.crtc.forEach((x, i) => { w.ioWrite(0x3D4, i); w.ioWrite(0x3D5, x); });
    let edges = 0, prev = 0, hb = 0;
    for (let t = 0; t < 8000000; t += 20) { w.tick(20); const s = w.status1(); if ((s & 8) && !prev) edges++; prev = s & 8; if (s & 1) hb++; }
    return { edges, blankShare: hb / 400000 };
  };
  const m3 = rate({ seq1: 0x00, crtc: [0x5F, 0x4F, 0x50, 0x82, 0x55, 0x81, 0xBF, 0x1F, 0, 0x4F, 0, 0, 0, 0, 0, 0, 0x9C, 0x8E, 0x8F] }, 0x67);
  check(Math.abs(m3.edges - 70) <= 1, `400 lines: ${m3.edges} retraces a second (70)`);
  check(m3.blankShare > 0.15 && m3.blankShare < 0.4, `display disabled part ${m3.blankShare.toFixed(2)}`);
  const m12 = rate({ seq1: 0x01, crtc: [0x5F, 0x4F, 0x50, 0x82, 0x54, 0x80, 0x0B, 0x3E, 0, 0x40, 0, 0, 0, 0, 0, 0, 0xEA, 0x8C, 0xDF] }, 0xE3);
  check(Math.abs(m12.edges - 60) <= 1, `480 lines: ${m12.edges} retraces a second (60)`);
}

// ---------- 2. the video BIOS on both machines ----------
const vgaRom = makeVgaRom(null);
function vgaMachine(model) {
  const M = G(machineName(model));
  const m = new M({ video: 'vga' });
  const bios = Asm86.assemble(G('biosSource')(model), { origin: 0 });
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
  m.setRom(rom, bios.symbols); m.setVgaRom(vgaRom.bytes);
  m.reset();
  return m;
}
// run a small program (org 100h) to its end; return the machine and its symbols
function runProg(model, src) {
  const m = vgaMachine(model);
  const p = Asm86.assemble('        org 0x100\n' + src + '\n        int 0x20\n', { origin: 0x100 });
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  m.loadProgram(p.bytes, 0x100); m.mem.set([0x00, 0x01, 0x00, 0x10, 0x86], 0x4F0);
  let r;
  for (let i = 0; i < 200 && r !== 'halt'; i++) r = m.run(200000);
  const at = (name, n = 1) => { const a = 0x10000 + p.symbols[name]; return n === 1 ? m.mem[a] : m.mem[a] | (m.mem[a + 1] << 8); };
  return { m, at, halted: r === 'halt' };
}
if (part('option ROM')) {
  let s = 0; for (const b of vgaRom.bytes) s += b;
  eq(s & 0xFF, 0, 'checksum'); eq(vgaRom.bytes[0] | (vgaRom.bytes[1] << 8), 0xAA55, 'signature'); eq(vgaRom.bytes[2], 64, 'size 32 KB');
  for (const model of MODELS) {
    const { m } = runProg(model, 'nop');
    const w = a => m.mem[a] | (m.mem[a + 1] << 8);
    eq(hex(w(0x42)), 'c000', `${model}: INT 10h in the option ROM`);
    eq(hex(w(0x42 * 4 + 2)), 'f000', `${model}: old INT 10h moved to INT 42h`);
    eq(m.mem[0x449], 3, `${model}: mode 3 after POST`);
    eq(m.mem[0x485], 16, `${model}: 16-line font`);
    eq(m.mem[0x484], 24, `${model}: 25 rows`);
    eq(`${m.vga.mode.width}x${m.vga.mode.height}`, '720x400', `${model}: 720x400 text`);
    check(/VGA/.test(String.fromCharCode(...m.vram().filter((_, i) => !(i & 1)).slice(240, 480))), `${model}: banner says VGA`);
  }
}
if (part('INT 10h modes, pixels, information')) {
  // [mode, width, height, colours, BDA columns]
  const modes = [[0x00, 360, 400, 16, 40], [0x01, 360, 400, 16, 40], [0x02, 720, 400, 16, 80], [0x03, 720, 400, 16, 80],
    [0x04, 320, 200, 4, 40], [0x05, 320, 200, 4, 40], [0x06, 640, 200, 2, 80], [0x07, 720, 400, 16, 80],
    [0x0D, 320, 200, 16, 40], [0x0E, 640, 200, 16, 80], [0x10, 640, 350, 16, 80], [0x11, 640, 480, 2, 80],
    [0x12, 640, 480, 16, 80], [0x13, 320, 200, 256, 40]];
  for (const model of MODELS) {
    for (const [mode, w, h, colours, cols] of modes) {
      const gfx = mode >= 4 && mode !== 7;
      const colour = colours === 2 ? 1 : colours === 4 ? 2 : colours === 16 ? 9 : 0xA7;
      const { m, at } = runProg(model, `
        mov ax, 0x00${hex(mode).padStart(2, '0')}
        int 0x10
        mov ah, 0x0F
        int 0x10
        mov [gm], al
        mov [gc], ah
        ${gfx ? `mov ax, 0x0C${hex(colour).padStart(2, '0')}
        xor bx, bx
        mov cx, 123
        mov dx, 45
        int 0x10
        mov ah, 0x0D
        int 0x10
        mov [px], al
        mov ah, 0x0D
        mov cx, 124
        int 0x10
        mov [px2], al` : ''}
        jmp done
gm: db 0
gc: db 0
px: db 0
px2: db 0xEE
done:`);
      const md = m.vga.mode;
      eq(`${md.width}x${md.height}/${md.colors}`, `${w}x${h}/${colours}`, `${model} mode ${hex(mode)}h picture`);
      eq(at('gm'), mode, `${model} mode ${hex(mode)}h AH=0Fh`); eq(at('gc'), cols, `${model} mode ${hex(mode)}h columns`);
      if (gfx) { eq(at('px'), colour, `${model} mode ${hex(mode)}h pixel write/read`); eq(at('px2'), 0, `${model} mode ${hex(mode)}h next pixel 0`); }
      if (mode === 7) eq(m.vga.colorIO, false, 'mode 7 uses the mono ports');
    }
  }
  const { m, at } = runProg('80286', `
        mov ax, 0x1A00
        int 0x10
        mov [dcc], al
        mov [dcc+1], bl
        mov ah, 0x12
        mov bl, 0x10
        int 0x10
        mov [ega], bx
        mov ax, 0x1010          ; DAC 40h = 1, 2, 3
        mov bx, 0x40
        mov dh, 1
        mov ch, 2
        mov cl, 3
        int 0x10
        mov ax, 0x1015
        mov bx, 0x40
        int 0x10
        mov [rgb], dh
        mov [rgb+1], ch
        mov [rgb+2], cl
        mov ax, 0x1112          ; 8x8 font: 50 rows
        mov bl, 0
        int 0x10
        push es
        mov ax, 0x1130
        mov bh, 6
        int 0x10
        mov [rows], dl
        mov [cheight], cx
        mov [fseg], es
        pop es
        mov ax, 0x1B00
        xor bx, bx
        mov di, state
        push ds
        pop es
        int 0x10
        mov [st], al
        mov ax, 0x1300 + 1      ; write string, move the cursor
        mov bx, 0x001E
        mov cx, 5
        mov dx, 0x0102
        mov bp, text
        int 0x10
        jmp done
dcc: dw 0
ega: dw 0
rgb: db 0, 0, 0
rows: db 0
cheight: dw 0
fseg: dw 0
st: db 0
text: db "HELLO"
state: times 64 db 0
done:`);
  eq(at('dcc'), 0x1A, 'AH=1Ah supported'); eq(at('dcc', 2) >> 8, 8, 'display code 08h (VGA colour)');
  eq(at('ega', 2), 0x0003, 'AH=12h BL=10h: colour, 256 KB');
  eq([0, 1, 2].map(i => m.vga.dac[0x40 * 3 + i]).join(), '1,2,3', 'AH=10h AL=10h DAC');
  eq(at('rows'), 49, 'AH=11h AL=12h: 50 rows'); eq(at('cheight', 2), 8, 'AH=11h AL=30h height');
  eq(hex(at('fseg', 2)), 'c000', 'AH=11h AL=30h font pointer');
  eq(at('st'), 0x1B, 'AH=1Bh state');
  const tb = m.vram();
  eq(String.fromCharCode(tb[(1 * 80 + 2) * 2], tb[(1 * 80 + 3) * 2], tb[(1 * 80 + 6) * 2]), 'HEO', 'AH=13h write string');
  eq(tb[(1 * 80 + 2) * 2 + 1], 0x1E, 'AH=13h attribute');
  eq(m.vga.mode.rows, 50, 'the CRTC shows 50 rows');
}

// ---------- 3. the picture ----------
if (part('renderer')) {
  const { m } = runProg('8086', `
        mov ax, 0x0003
        int 0x10
        mov ax, 0xB800
        mov es, ax
        mov word [es:0], 0x1F41       ; 'A' white on blue
        mov word [es:2], 0x07C4       ; line graphics character
        mov word [es:4], 0x8F42       ; blinking 'B'`);
  const v = m.vga, r = new VgaRenderer(v);
  // a known glyph in plane 2: character 41h row 5 = 10000001b, character C4h row 7 = 00000001b
  v.vram[((0x41 * 32 + 5) << 2) | 2] = 0x81; v.vram[((0xC4 * 32 + 7) << 2) | 2] = 0x01;
  r.render(true, false);
  eq(`${r.w}x${r.h}`, '720x400', 'text 720x400');
  const px = (x, y) => r.buf[y * r.w + x];
  check(px(0, 5) === px(7, 5) && px(0, 5) !== px(1, 5), 'glyph bits from plane 2');
  eq(hex(px(0, 5) & 0xFFFFFF), 'ffffff', 'foreground bright white');
  eq(hex(px(1, 5) & 0xFFFFFF), 'aa0000', 'background blue (BGR in the buffer)');
  eq(px(8, 5), px(1, 5), '9th column: background for letters');
  eq(px(9 + 8, 7), px(9 + 7, 7), '9th column repeats column 8 for C0h-DFh');
  r.render(false, false);
  eq(px(18, 5), px(19, 5), 'blink off: foreground = background');
  // Mode X: page flip and split screen through the registers
  v.ioWrite(0x3C4, 4); v.ioWrite(0x3C5, 0x06);
  v.ioWrite(0x3CE, 5); v.ioWrite(0x3CF, 0x40); v.ioWrite(0x3CE, 6); v.ioWrite(0x3CF, 0x05);
  v.ioRead(0x3DA); for (let i = 0; i < 16; i++) { v.ioWrite(0x3C0, i); v.ioWrite(0x3C0, i); }
  v.ioWrite(0x3C0, 0x10); v.ioWrite(0x3C0, 0x41); v.ioWrite(0x3C0, 0x20);
  const crt = (i, x) => { v.ioWrite(0x3D4, i); v.ioWrite(0x3D5, x); };
  crt(0x11, 0x0E); crt(0x09, 0x41); crt(0x13, 0x28); crt(0x14, 0x00); crt(0x17, 0xE3); crt(0x01, 0x4F);
  crt(0x12, 0x8F); crt(0x07, 0x1F);
  for (let o = 0; o < 16000; o++) v.vram32[o] = 0x01010101 * 3;
  for (let o = 16000; o < 32000; o++) v.vram32[o] = 0x01010101 * 5;
  crt(0x0C, 16000 >> 8); crt(0x0D, 16000 & 0xFF);
  v.tick(v.frameClk);                                  // the new start is loaded at retrace
  r.render();
  eq(`${r.w}x${r.h}`, '320x400', 'mode X 320 pixels, 400 lines');
  eq(v.mode.unchained, true, 'unchained 256');
  eq(r.buf[0], r.pal32[5], 'start address shows page 1');
  crt(0x18, 199); crt(0x07, 0x0F); crt(0x09, 0x01);    // line compare 199: lines 200+ show offset 0
  r.render();
  check(r.buf[100 * 320] === r.pal32[5] && r.buf[300 * 320] === r.pal32[3], 'line compare split screen');
  v.ioRead(0x3DA); v.ioWrite(0x3C0, 0x33); v.ioWrite(0x3C0, 2); v.tick(v.frameClk);
  v.vram32[16000] = 0x0A090807;
  r.render();
  eq(r.buf[0], r.pal32[8], 'pixel panning 2 = one 256-colour pixel');
}

// ---------- 4. 2.88 MB floppies ----------
if (part('2.88 MB floppies')) {
  const d = fat12Blank('BIG', 2949120);
  eq(d.length, 2949120, 'size');
  const r16 = o => d[o] | (d[o + 1] << 8);
  eq(`${d[13]} ${r16(17)} ${r16(19)} ${r16(22)} ${r16(24)} ${d[21].toString(16)}`, '2 240 5760 9 36 f0', 'BPB');
  const f = new Fat12(d);
  const big = new Uint8Array(2500000).map((_, i) => i * 7);
  fat12AddFiles(d, [{ name: 'BIG.BIN', bytes: big }]);
  const back = f.read(f.find('', 'BIG.BIN'));
  check(back.length === big.length && back.every((x, i) => x === big[i]), '2.5 MB file round trip');
  const fd = new FloppyDisk('b', d);
  eq(`${fd.cyls}/${fd.heads}/${fd.spt}/${fd.type}`, '80/2/36/5', 'geometry');
  eq(fat12Blank('x').length, 1474560, '1.44 MB default');
  const m = vgaMachine('80286');
  m.insertDisk(1, 'big', d);
  m.cpu.regs[0] = 0x0800; m.cpu.regs[2] = 0x0001;
  m.ioWrite(0xE0, 0);
  eq(m.cpu.regs[3] & 0xFF, 5, 'INT 13h AH=08h: drive type 5');
  eq(m.cpu.regs[1] & 0x3F, 36, 'INT 13h AH=08h: 36 sectors');
  eq(m.cpu.regs[7], m.biosSym.diskette_table_288, 'INT 13h AH=08h: the 2.88 MB parameter table');
  eq(m.mem[0xF0000 + m.biosSym.diskette_table_288 + 4], 36, 'table: 36 sectors a track');
}

// ---------- 5. Wolfenstein 3D ----------
// WOLF3D.EXE uses the Borland C floating-point runtime, which tells an 80287 from an
// 80387 by the infinity control (projective after FNINIT on the 80287). The test runs
// it on the emulated 80287; --emu87 uses Borland's software emulator (SET 87=N).
const DOS = 'C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files';
const DOS6 = path.join(DOS, 'msdos/dos6.img'), WOLF = path.join(DOS, 'WOLF3D');
if (process.argv.includes('--no-wolf')) console.log('- Wolfenstein 3D: skipped (--no-wolf)');
else if (!fs.existsSync(DOS6) || !fs.existsSync(path.join(WOLF, 'WOLF3D.EXE'))) console.log('- Wolfenstein 3D: skipped (no files)');
else if (!WOLF_ONLY) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--wolf-only', ...process.argv.slice(2)], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = r.stdout || '';
  process.stdout.write(out.split('\n').filter(l => !/VGA test/.test(l)).join('\n'));
  const m = out.match(/all (\d+) VGA tests passed|(\d+) VGA test\(s\) failed, (\d+) passed/);
  if (!m || r.status !== 0) fail += m && m[2] ? +m[2] : 1;
  if (m) pass += +(m[1] || m[3]);
} else {
  begin(`Wolfenstein 3D (DOS 6.22, ${WOLF_MODEL} + VGA)`);
  const boot = new Uint8Array(fs.readFileSync(DOS6));
  if (WOLF_MODEL !== '80386' && WOLF_MODEL !== '80486' && WOLF_MODEL !== '80586' && WOLF_MODEL !== '80686') {
    // CONFIG.SYS loads a CD-ROM driver that needs a 386: the copy has that line as REM
    const f = new Fat12(boot), t = Buffer.from(f.read(f.find('', 'CONFIG.SYS'))).toString('latin1');
    f.write('', 'CONFIG.SYS', new Uint8Array(Buffer.from(t.split('\r\n').map(l => /^\s*DEVICE\s*=\s*cd1\.sys/i.test(l) ? 'REM ' + l : l).join('\r\n'), 'latin1')));
    fs.mkdirSync(path.join(root, 'tools/tmp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools/tmp/dos6-vga.img'), boot);
  }
  const disk = fat12Blank('WOLF3D', 2949120);
  fat12AddFiles(disk, fs.readdirSync(WOLF).map(n => ({ name: n, bytes: new Uint8Array(fs.readFileSync(path.join(WOLF, n))) })));
  const m = vgaMachine(WOLF_MODEL);
  m.insertDisk(0, 'dos6', boot); m.insertDisk(1, 'wolf', disk);
  const r = new VgaRenderer(m.vga);
  let shot = 0;
  const save = name => { if (PNG_DIR) { r.render(); fs.writeFileSync(path.join(PNG_DIR, `${String(++shot).padStart(2, '0')}-${name}.png`), png(r.buf, r.w, r.h, r.w <= 360 ? 2 : 1, 1)); } };
  const screen = () => { const v = m.vram(); let s = ''; for (let i = 0; i < 4000; i += 2) s += String.fromCharCode(v[i] || 32) + ((i / 2) % 80 === 79 ? '\n' : ''); return s; };
  const SC = { '\r': 0x1C, ' ': 0x39, ':': 0x27, '=': 0x0D }; 'abcdefghijklmnopqrstuvwxyz'.split('').forEach(ch => {
    const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], base = [0x10, 0x1E, 0x2C];
    rows.forEach((row, i) => { const k = row.indexOf(ch); if (k >= 0) SC[ch] = base[i] + k; });
  });
  '1234567890'.split('').forEach((d, i) => { SC[d] = 2 + i; });
  const keys = [];
  const type = s => { for (const ch of s) keys.push(SC[ch]); };
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(ch => { SC[ch] = SC[ch.toLowerCase()] | 0x100; });   // with Shift
  let rec = null, recLen = 0;                         // the card sound: takeSound() after each slice
  const run = (secs, until) => {
    const end = m.cpu.cycles + secs * m.clockHz;
    while (m.cpu.cycles < end) {
      m.run(40000);
      if (rec) { const s = m.takeSound().samples; rec.push(s); recLen += s.length; }
      if (keys.length && !m.kbd.fifo.length) {
        const k = keys.shift(), sh = k === 0x27 || k & 0x100;
        if (sh) m.keyDown(0x2A); m.keyDown(k & 0xFF); m.keyUp(k & 0xFF); if (sh) m.keyUp(0x2A);
      }
      if (until && until()) return true;
    }
    return false;
  };
  const t0 = Date.now();
  check(run(60, () => /A:\\>\s*$/.test(screen().trimEnd() + ' ') || /A:\\>/.test(screen().split('\n').filter(l => l.trim()).pop() || '')), 'DOS 6.22 prompt');
  console.log(`  DOS 6.22 prompt: ${(m.cpu.cycles / m.clockHz).toFixed(1)} emulated s, ${((Date.now() - t0) / 1000).toFixed(1)} s real`);
  save('dos');
  type('b:\r');
  check(run(10, () => /B:\\>\s*$/.test(screen().split('\n').filter(l => l.trim()).pop() + ' ')), 'B: prompt');
  if (process.argv.includes('--emu87')) { type('set 87=n\r'); run(3); }
  // The Sound Blaster: the BLASTER variable (the game also probes 210h-260h), and hooks
  // that count what the game does with the card.
  type('set BLASTER=A220 I7 D1 T3\r');
  run(3);
  const snd = { reg4: [], c0: 0, aa: 0, keyOn: 0, oplWrites: 0, cmds: new Map(), irq7: 0, inta7: 0, ack22e: 0 };
  {
    const sb = m.sb, opl = m.opl;
    const ow = opl.write.bind(opl);
    opl.write = (r, v) => { const res = ow(r, v); snd.oplWrites++; if (r === 4) snd.reg4.push(v); if (res === 1) snd.keyOn++; return res; };
    const or = sb.oplRead.bind(sb);
    sb.oplRead = p => { const v = or(p); if ((v & 0xE0) === 0xC0) snd.c0++; return v; };
    const rd = sb.read.bind(sb);
    sb.read = p => { const was = sb.irq, v = rd(p); if ((p & 15) === 0xA && v === 0xAA) snd.aa++; if ((p & 15) === 0xE && was) snd.ack22e++; return v; };
    const ex = sb.exec.bind(sb);
    sb.exec = (c, a) => { snd.cmds.set(c, (snd.cmds.get(c) || 0) + 1); return ex(c, a); };
    const raise = m.pic.raise.bind(m.pic);
    m.pic.raise = n => { if (n === 7) snd.irq7++; raise(n); };
    const ack = m.pic.ack.bind(m.pic);
    m.pic.ack = () => { const had = m.pic.irr & 0x80, v = ack(); if (had && !(m.pic.irr & 0x80) && v === m.pic.base + 7) snd.inta7++; return v; };
  }
  m.audioRate = 44100; m.audioOn = true;
  m.takeSound(); rec = [];
  const recStart = m.sb.clk;
  type('wolf3d\r');
  const dacLit = () => { let n = 0; for (let i = 0; i < 768; i++) if (m.vga.dac[i]) n++; return n; };
  const planeSum = () => { let s = 0; for (let o = 0; o < 16000; o++) s = (s + m.vga.vram32[o] * (o + 1)) >>> 0; return s; };
  const tStart = m.cpu.cycles;
  check(run(20, () => m.vga.mode.unchained), 'WOLF3D.EXE switches to unchained 256 colours (Mode X)');
  const until = t => run(t - (m.cpu.cycles - tStart) / m.clockHz);   // seconds after the command
  until(11);
  save('signon');
  const md = m.vga.mode;
  eq(`${md.width}x${md.height}/${md.colors}/${md.chain4}`, '320x200/256/false', 'sign-on screen mode');
  check(dacLit() > 300, `DAC is not black (${dacLit()} components lit)`);
  const s1 = planeSum();
  const stops = () => /Invalid opcode|Floating point error|Abnormal program/.test(screen());
  // the sign-on screen waits for a key, then "Attention", PC-13, the title screen, the menu
  const steps = [['attention', 12, 18], ['pc13', 24, 30], ['title', 38, 43], ['menu', 44, 50]];
  for (const [name, press, look] of steps) {
    until(press);
    m.keyDown(0x1C); run(0.1); m.keyUp(0x1C);
    until(look);
    save(name);
  }
  check(planeSum() !== s1, 'the plane memory changes (new screens)');
  check(m.vga.mode.unchained && dacLit() > 300, 'still in Mode X with colours at the menu');
  check(!stops() && !m.cpu.halted, 'no invalid opcode or FPU stop');
  // the Options menu: a dark red background (DAC index 0x29 area) with the text in grey
  r.render();
  const hist = new Map(); for (const p of r.buf) hist.set(p, (hist.get(p) || 0) + 1);
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const [c0] = top[0], red = c0 & 255, green = (c0 >> 8) & 255, blue = (c0 >> 16) & 255;
  check(top.length > 8 && red > 100 && green < 60 && blue < 60, `the Options menu: dark red background (${red},${green},${blue}), ${top.length} colours`);
  console.log(`  Wolf3D: ${((Date.now() - t0) / 1000).toFixed(1)} s real for ${(m.cpu.cycles / m.clockHz).toFixed(0)} emulated s`);
  check(!stops(), `Wolf3D does not stop with a floating-point error on the ${m.fpu.model}`);
  // ---------- the Sound Blaster in the game ----------
  const i4 = snd.reg4.join(',');
  check(/96,128,33,96,128/.test(i4), `AdLib detection: register 4 = 60h, 80h, 21h, 60h, 80h (${snd.reg4.map(v => v.toString(16)).join(' ')})`);
  check(snd.c0 > 0, 'AdLib detection: the game reads C0h (timer 1) from the status');
  check(snd.aa >= 1, `DSP detection: the game reads AAh after the reset (${snd.aa} times)`);
  check(snd.cmds.get(0xD1) >= 1 && snd.cmds.get(0x40) >= 1, 'the game turns the DSP speaker on and sets the time constant');
  const menuKeys = snd.keyOn;
  check(menuKeys > 30, `OPL2 music at the menu: ${menuKeys} key-on writes, ${snd.oplWrites} register writes`);
  const recMenu = recLen;
  // the Sound menu: "Sound Blaster" for the digitized sounds (the item is active only
  // when the game found the card), then a new game and shots with the pistol (a
  // digitized sound, by DMA)
  const press = (code, after = 0.6, hold = 0.12) => { m.keyDown(code); run(hold); m.keyUp(code); run(after); };
  const DOWN = 0x50, UP = 0x48, ENTER = 0x1C, ESC = 0x01, CTRL = 0x1D;
  press(DOWN); press(ENTER, 1.5); save('sound-menu');
  for (let i = 0; i < 4; i++) press(DOWN, 0.4);
  press(ENTER, 1.5); save('sound-sb');
  press(ESC, 1.5); press(UP); press(ENTER, 1.5); save('episode');
  press(ENTER, 1.5); save('difficulty');
  press(ENTER, 18); save('game');
  const s0 = m.sb.samples, irq0 = snd.irq7;
  for (let i = 0; i < 4; i++) press(CTRL, 1, 0.6);   // the pistol
  save('shots');
  const shots = m.sb.samples - s0;
  console.log(`  DSP: ${m.sb.samples} samples (${shots} after the shots), commands ${[...snd.cmds].map(([c, n]) => `${c.toString(16)}h x${n}`).join(', ')}`);
  console.log(`  IRQ 7: ${snd.irq7} raised, ${snd.inta7} acknowledged by the CPU (INTA), ${snd.ack22e} acknowledged at 22Eh; OPL2: ${snd.keyOn} key-on writes`);
  check(snd.cmds.get(0x14) >= 1, 'digitized sound: DSP command 14h (8-bit single-cycle DMA)');
  check(shots > 2000, `digitized sound: the DSP plays ${shots} samples by DMA after the shots`);
  check(snd.irq7 > irq0 && snd.inta7 >= snd.irq7 - 1 && snd.ack22e >= snd.irq7 - 1, 'IRQ 7 at the end of each block, the game handles it (INTA and 22Eh)');
  check(m.sb.rate > 6900 && m.sb.rate < 7100, `the DSP rate is about 7 kHz (${m.sb.rate.toFixed(0)} Hz)`);
  check(snd.keyOn > menuKeys, 'OPL2 key-on writes also in the game');
  check(!stops() && !m.cpu.halted, 'the game runs after the sound changes');
  // the mixed sound from the menu to the end: a WAV file for a person to listen to
  const all = new Float32Array(recLen); { let p = 0; for (const s of rec) { all.set(s, p); p += s.length; } }
  const part = all.subarray(recMenu);
  let e1 = 0; for (const x of part) e1 += x * x;
  check(Math.sqrt(e1 / part.length) > 0.01, `the mixed card sound is not silent (RMS ${Math.sqrt(e1 / part.length).toFixed(3)}, ${(part.length / 44100).toFixed(1)} s)`);
  near(recLen / 44100, (m.sb.clk - recStart) / m.clockHz, 0.01, 'takeSound(): the sample count follows the emulated time');
  const wav = path.join(root, `tools/wolf3d-sb-${WOLF_MODEL}.wav`);
  const b = Buffer.alloc(44 + part.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + part.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(part.length * 2, 40);
  for (let i = 0; i < part.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(part[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(wav, b);
  console.log(`  WAV: ${wav} (${(part.length / 44100).toFixed(1)} s)`);
}

console.log(fail ? `${fail} VGA test(s) failed, ${pass} passed` : `all ${pass} VGA tests passed`);
process.exitCode = fail ? 1 : 0;
