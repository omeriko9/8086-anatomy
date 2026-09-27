// PNG files of the VGA picture in Node (for tests and debugging).
// Usage: import { loadCore, vgaPng } from './vgapng.mjs'
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load the core files (and the VGA renderer from crt.js) into this Node context.
export function loadCore() {
  for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js',
    'src/core/cpu80586.js', 'src/core/p6ooo.wasm.js', 'src/core/cpu80686.js', 'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js',
    'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js', 'src/core/vgabios.js', 'src/ui/crt.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
  }
  return name => vm.runInThisContext(name);
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// RGBA pixels (Uint32Array, little-endian R G B A) -> PNG. sy repeats each row (aspect).
export function png(pixels, w, h, sx = 1, sy = 1) {
  const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, w * h * 4);
  const W = w * sx, H = h * sy, raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    const src = Math.floor(y / sy) * w * 4, o = y * (W * 4 + 1);
    raw[o] = 0;
    for (let x = 0; x < W; x++) {
      const s = src + Math.floor(x / sx) * 4, d = o + 1 + x * 4;
      raw[d] = bytes[s]; raw[d + 1] = bytes[s + 1]; raw[d + 2] = bytes[s + 2]; raw[d + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Render the VGA of a machine and write a PNG with a 4:3-ish integer scale.
export function vgaPng(renderer, file) {
  renderer.render(true, true);
  const { w, h } = renderer;
  const sx = w <= 360 ? 2 : 1, sy = h <= 240 ? 2 : 1;
  fs.writeFileSync(file, png(renderer.buf, w, h, sx, sy));
}
