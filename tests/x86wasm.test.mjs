// The WebAssembly core (src/core/x86core.c) against the JavaScript core: the lockstep test of
// tools/x86lockstep.mjs on the 80386, 80486, Pentium and Pentium Pro machines (DOS 6.22 from drive C:, one
// instruction at a time for the start, then slices of clocks). It needs the user's DOS 6.22 image
// (else it skips).
// Usage: node tests/x86wasm.test.mjs [--long] (--long: DOOM too, 60 emulated seconds)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'tools/x86lockstep.mjs');
const long = process.argv.includes('--long');
const runs = [];
for (const model of ['80386', '80486', '80586', '80686']) {
  runs.push(['--model', model, '--step', '--slices', model === '80686' ? '100000' : '300000']);
  runs.push(['--model', model, '--slices', long ? '60000' : '4000', '--slice', '33000', '--every', '500', '--quiet'].concat(long ? ['--doom'] : []));
}
let fail = 0;
for (const a of runs) {
  try {
    const out = execFileSync('node', [tool, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const last = out.trim().split('\n').pop();
    console.log(`ok   ${a.join(' ')}: ${last}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${a.join(' ')}:\n${(e.stdout || '') + (e.stderr || '')}`);
  }
}
console.log(fail ? `${fail} WebAssembly core test(s) failed` : 'all WebAssembly core tests passed');
process.exitCode = fail ? 1 : 0;
