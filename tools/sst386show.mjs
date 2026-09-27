// Shows one SingleStepTests 80386 test: node tools/sst386show.mjs FILE IDX
import { loadMoo } from '../tests/moo.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [file, idx] = process.argv.slice(2);
const m = loadMoo(path.join(root, 'tools/sst386', file + '.MOO.gz'));
const t = m.tests[+idx];
const h = v => (v >>> 0).toString(16);
const hx = o => o && Object.entries(o).map(([k, v]) => `${k}=${h(v)}`).join(' ');
console.log(t.name, '|', t.bytes.map(h).join(' '), t.exception ? `exc ${t.exception.number} fa=${h(t.exception.flag_address)}` : '');
console.log('init', hx(t.initial.regs32));
console.log('fina', hx(t.final.regs32), t.final.mask32 ? 'mask ' + hx(t.final.mask32) : '', m.mask32 ? 'fmask ' + hx(m.mask32) : '');
if (t.initial.ea) console.log('ea', hx(t.initial.ea));
console.log('ram0', t.initial.ram.map(([a, v]) => `${h(a)}:${h(v)}`).join(' '));
console.log('ram1', t.final.ram.map(([a, v]) => `${h(a)}:${h(v)}`).join(' '));
