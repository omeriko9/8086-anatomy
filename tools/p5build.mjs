// Builds a test page for the Pentium views.
// Usage: node tools/p5build.mjs [--out file.html]
// It runs build.mjs. When the page has no Machine586 (src/core/machine586.js is not there, or
// build.mjs does not list it), it puts one into the page: the file src/core/machine586.js when
// it is there, else a small test shim (the Machine486 board with the CPU80586 core and the
// 80486 BIOS). The shim is only for tests of the views; the real page does not get it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt('--out', path.join(root, 'dist', '8086-anatomy.p5test.html')));
execFileSync(process.execPath, [path.join(root, 'build.mjs'), '--out', out], { cwd: root, stdio: 'inherit' });
let html = fs.readFileSync(out, 'utf8');
if (/class Machine586\b/.test(html)) { console.log('p5build: the page has Machine586'); process.exit(0); }
const real = path.join(root, 'src', 'core', 'machine586.js');
const SHIM = `// ---- test shim (tools/p5build.mjs): Machine586 = the 486 board with the CPU80586 core ----
class Machine586 extends Machine486 {
  constructor(opts = {}) {
    super(opts);
    this.model = '80586';
    this.cpu = new CPU80586(this.bus);
    const m = this, mem = this.mem;
    // a store that stays in the cache: memory gets it with no bus cycle and no counters
    this.bus.poke8 = (a, v) => { if (a < 0xA0000 || (a >= 0x100000 && a < m.memSize)) mem[a] = v; else m.bus.write8(a, v); };
  }
}
{ const bs0 = biosSource; biosSource = mdl => bs0(mdl === '80586' ? '80486' : mdl); }
`;
const code = fs.existsSync(real) ? `// ---- src/core/machine586.js (tools/p5build.mjs) ----\n${fs.readFileSync(real, 'utf8')}\n` : SHIM;
const mark = '// ---- src/core/vgabios.js ----';
if (!html.includes(mark)) throw new Error('p5build: marker not found');
html = html.replace(mark, () => code + mark);
fs.writeFileSync(out, html);
console.log(`p5build: ${out} (${fs.existsSync(real) ? 'machine586.js' : 'test shim'})`);
