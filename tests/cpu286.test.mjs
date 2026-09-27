// Runs the SingleStepTests 80286 real-mode suite (tools/sst286/*.MOO.gz, v1_real_mode of
// https://github.com/SingleStepTests/80286) against src/core/cpu80286.js.
// Usage: node tests/cpu286.test.mjs [file-prefix ...] [--max N] [--verbose] [--table]
//
// Each test is the instruction under test followed by HLT (or an exception handler whose
// first byte is HLT). The CPU runs until it halts; then registers and memory must match.
// Undefined flags are masked with the RMSK chunk of the file / test, else with the
// "flags-mask" of metadata.json. Tests in revocation_list.txt are skipped.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMoo } from './moo.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/core/cpu8086.js', 'src/core/cpu80286.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU = vm.runInThisContext('CPU80286');

const dir = path.join(root, 'tools/sst286');
if (!fs.existsSync(path.join(dir, 'metadata.json'))) {
  console.log('tools/sst286 is missing: download v1_real_mode of https://github.com/SingleStepTests/80286 there.');
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')).opcodes;
const revoked = new Set(fs.existsSync(path.join(dir, 'revocation_list.txt'))
  ? fs.readFileSync(path.join(dir, 'revocation_list.txt'), 'utf8').split(/\r?\n/).filter(l => /^[0-9a-f]{40}$/i.test(l.trim())).map(l => l.trim().toLowerCase()) : []);
const args = process.argv.slice(2);
const verbose = args.includes('--verbose'), table = args.includes('--table');
const maxIdx = args.indexOf('--max');
const maxTests = maxIdx >= 0 ? +args[maxIdx + 1] : Infinity;
const only = args.filter((a, i) => /^[0-9A-Fa-f]{2,4}(\.[0-7])?$/.test(a) && args[i - 1] !== '--max').map(a => a.toUpperCase());

const mem = new Uint8Array(1 << 24);
const bus = {
  read8: a => mem[a & 0xFFFFFF], write8: (a, v) => { mem[a & 0xFFFFFF] = v; },
  in8: () => 0xFF, out8: () => {}, in16: () => 0xFFFF, out16: () => {}, fpu: null, waitStates: 0,
};
const cpu = new CPU(bus);
const RN = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'], SN = ['es', 'cs', 'ss', 'ds'];
const PREFIX = [0x26, 0x2E, 0x36, 0x3E, 0xF0, 0xF1, 0xF2, 0xF3];

// metadata entry for a file ("C0.4" -> opcode C0, reg 4)
function info(file) {
  const [op, reg] = file.replace('.MOO.gz', '').split('.');
  const m = meta[op] || {};
  return reg !== undefined && m.reg ? m.reg[reg] || m : m;
}

let files = fs.readdirSync(dir).filter(f => f.endsWith('.MOO.gz')).sort();
if (only.length) files = files.filter(f => only.some(o => f.toUpperCase().startsWith(o + '.') || f.toUpperCase() === o + '.MOO.GZ'));
let totalPass = 0, totalFail = 0, totalSkip = 0;
const failedFiles = [], rows = [];
const t0 = Date.now();
for (const file of files) {
  const moo = parseMoo(fs.readFileSync(path.join(dir, file)));
  const inf = info(file);
  let pass = 0, fail = 0, firstFail = null, skipped = 0;
  for (const t of moo.tests.slice(0, maxTests)) {
    if (revoked.has(t.hash)) { skipped++; continue; }
    const ini = t.initial;
    for (const [a, v] of ini.ram) mem[a] = v;
    cpu.reset();
    RN.forEach((n, i) => { cpu.regs[i] = ini.regs[n]; });
    SN.forEach((n, i) => { cpu.loadSeg(i, ini.regs[n]); });
    cpu.ip = ini.regs.ip; cpu.flags = ini.regs.flags;
    cpu.flush();
    let guard = 0, err = null;
    try {
      while (!cpu.halted && guard++ < 5000) cpu.step();
    } catch (e) { err = e.stack; }
    const fin = t.final, errs = [];
    if (err) errs.push(err);
    else if (!cpu.halted) errs.push('did not halt');
    const exp = Object.assign({}, ini.regs, fin.regs);
    const mask = Object.assign({}, moo.mask || {}, fin.mask || {});
    const fmask = mask.flags !== undefined ? mask.flags : inf['flags-mask'] !== undefined ? inf['flags-mask'] : 0xFFFF;
    const rm = n => (mask[n] !== undefined ? mask[n] : 0xFFFF);
    RN.forEach((n, i) => { if ((cpu.regs[i] ^ exp[n]) & rm(n)) errs.push(`${n}=${cpu.regs[i].toString(16)} want ${exp[n].toString(16)}`); });
    SN.forEach((n, i) => { if ((cpu.sregs[i] ^ exp[n]) & rm(n)) errs.push(`${n}=${cpu.sregs[i].toString(16)} want ${exp[n].toString(16)}`); });
    if (cpu.ip !== exp.ip) errs.push(`ip=${cpu.ip.toString(16)} want ${exp.ip.toString(16)}`);
    if ((cpu.flags & fmask) !== (exp.flags & fmask)) errs.push(`flags=${cpu.flags.toString(2).padStart(16, '0')} want ${exp.flags.toString(2).padStart(16, '0')} mask ${fmask.toString(2).padStart(16, '0')}`);
    // The flags word that an exception pushes can hold undefined flags: mask it.
    const fa = t.exception ? t.exception.flag_address : -1;
    for (const [a, v] of fin.ram) {
      let m = 0xFF;
      if (a === fa) m = fmask & 0xFF; else if (fa >= 0 && a === fa + 1) m = (fmask >> 8) & 0xFF;
      if ((mem[a] ^ v) & m) errs.push(`[${a.toString(16)}]=${mem[a].toString(16)} want ${v.toString(16)}`);
    }
    for (const [a] of ini.ram) mem[a] = 0;
    for (const [a] of fin.ram) mem[a] = 0;
    if (errs.length) { fail++; if (!firstFail) firstFail = { t, errs }; } else pass++;
  }
  totalPass += pass; totalFail += fail; totalSkip += skipped;
  rows.push(`${file.replace('.MOO.gz', '').padEnd(5)} ${String(pass).padStart(5)}/${String(pass + fail).padEnd(5)}${skipped ? ` (${skipped} revoked)` : ''}`);
  if (fail) {
    failedFiles.push(file);
    const ft = firstFail.t;
    console.log(`FAIL ${file}: ${fail} fail, ${pass} pass${skipped ? `, ${skipped} skipped` : ''} — #${ft.idx} ${ft.name} [${ft.bytes.map(b => b.toString(16)).join(' ')}]${ft.exception ? ' exc ' + ft.exception.number : ''} :: ${firstFail.errs.join('; ')}`);
  } else if (verbose) console.log(`ok   ${file}: ${pass}${skipped ? ` (${skipped} revoked)` : ''}`);
}
if (table) {
  console.log('\nPass counts per file (opcode[.reg]  pass/total):');
  for (let i = 0; i < rows.length; i += 4) console.log('  ' + rows.slice(i, i + 4).map(r => r.padEnd(30)).join(''));
}
console.log(`\nTOTAL pass ${totalPass}, fail ${totalFail}, revoked (skipped) ${totalSkip}; files failing: ${failedFiles.length}/${files.length}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = totalFail ? 1 : 0;
