// Builds a test page for the Pentium Pro views.
// Usage: node tools/p6build.mjs [--out file.html]
// It runs build.mjs. When the page has no Machine686 (src/core/machine686.js is not there, or
// build.mjs does not list it), it puts one into the page: the file src/core/machine686.js when
// it is there, else a small test shim (the Machine586 board with the CPU80686 core, a bus ratio
// of 3 and the Pentium BIOS). The shim is only for tests of the views; the real page does not get it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt('--out', path.join(root, 'dist', '8086-anatomy.p6test.html')));
execFileSync(process.execPath, [path.join(root, 'build.mjs'), '--out', out], { cwd: root, stdio: 'inherit' });
let html = fs.readFileSync(out, 'utf8');
if (/class Machine686\b/.test(html)) { console.log('p6build: the page has Machine686'); process.exit(0); }
const real = path.join(root, 'src', 'core', 'machine686.js');
const SHIM = `// ---- test shim (tools/p6build.mjs): Machine686 = the Pentium board with the CPU80686 core ----
class Machine686 extends Machine586 {
  constructor(opts = {}) {
    super(opts);
    this.model = '80686';
    this.cpu = new CPU80686(this.bus);
    this.bus.busRatio = 3;
  }
}
{ const bs0 = biosSource; biosSource = mdl => bs0(mdl === '80686' ? '80586' : mdl); }
`;
const code = fs.existsSync(real) ? `// ---- src/core/machine686.js (tools/p6build.mjs) ----\n${fs.readFileSync(real, 'utf8')}\n` : SHIM;
const mark = '// ---- src/core/bios.js ----';
if (!html.includes(mark)) throw new Error('p6build: marker not found');
html = html.replace(mark, () => code + mark);
fs.writeFileSync(out, html);
console.log(`p6build: ${out} (${fs.existsSync(real) ? 'machine686.js' : 'test shim'})`);
