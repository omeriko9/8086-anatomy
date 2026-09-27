// Runs the SingleStepTests 80386 real-mode suite (tools/sst386/*.MOO.gz, v1_ex_real_mode of
// https://github.com/SingleStepTests/80386, made on a 386EX) against src/core/cpu80386.js.
// Usage: node tests/cpu386.test.mjs [file-prefix ...] [--max N] [--verbose] [--table] [--all]
//                                   [--cpu 486|586|686 [--nocache]]
//   --cpu 486: run the suite on CPU80486 (src/core/cpu80486.js) with the on-chip cache on
//   (CR0.CD = NW = 0; --nocache keeps the CD and NW bits of the test). The test EFLAGS load
//   without bits 18-21 (a 386 keeps 0 there). The compare covers EFLAGS bits 0-17 only, so
//   the one known 486 difference does not fail a test; the run counts it for each file:
//   AC (bit 18) or ID (bit 21) is 1 after the instruction (POPFD / IRETD load them on a 486).
//   --cpu 586: the same on CPU80586 (src/core/cpu80586.js): the two caches of the Pentium, the
//   pairing rules and the BTB (they change only the clocks, and the suite does not compare them).
//   The run sets cpu.queueSnoop = false: the 386EX runs the old bytes of its prefetch queue after
//   a write to them, a P5 gets the new bytes (4 tests: REP MOVS / STOS write over their HLT).
//   --p5queue keeps the P5 behaviour (then these 4 tests fail).
//   --cpu 686: the same on CPU80686 (src/core/cpu80686.js): the P6 caches (L1 and L2), the µop
//   model and the BTB (they change only the clocks). The run sets cpu.queueSnoop = false, as with 586.
//
// Each test is the instruction under test followed by HLT (or an exception handler whose
// first byte is HLT). The CPU runs until it halts; then the registers and the memory must
// match (not the cycles: the 386EX has a 16-bit bus and SMM clocks). Undefined flags are
// masked with the RM32 chunk of the file / test, else with f_umask of 80386.csv. Tests in
// revocation_list.txt are skipped, and so are the groups in SKIP (see the reasons there).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMoo } from './moo.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const cpuArg = argv.includes('--cpu') ? argv[argv.indexOf('--cpu') + 1] : '';
const is686 = cpuArg === '686';
const is586 = cpuArg === '586' || is686;
const is486 = cpuArg === '486' || is586;
const cacheOn = is486 && !argv.includes('--nocache');
for (const f of ['src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', ...(is486 ? ['src/core/cpu80486.js'] : []), ...(is586 ? ['src/core/cpu80586.js'] : []), ...(is686 ? ['src/core/cpu80686.js'] : [])]) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CPU = vm.runInThisContext(is686 ? 'CPU80686' : is586 ? 'CPU80586' : is486 ? 'CPU80486' : 'CPU80386');

const dir = path.join(root, 'tools/sst386');
if (!fs.existsSync(path.join(dir, '80386.csv'))) {
  console.log('tools/sst386 is missing: download v1_ex_real_mode of https://github.com/SingleStepTests/80386 there.');
  process.exit(1);
}
// Groups that this core does not check, with the reason (file name prefix -> reason).
const SKIP = {};

// 80386.csv: f_umask (undefined flags) per opcode and ModR/M extension.
const csv = fs.readFileSync(path.join(dir, '80386.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const head = csv[0].split(',');
const col = n => head.indexOf(n);
const umask = {};
for (const line of csv.slice(1)) {
  const c = line.split(',');
  const key = c[col('op')].toUpperCase() + (c[col('ex')] !== '' ? '.' + c[col('ex')] : '');
  const u = c[col('f_umask')];
  if (u) umask[key] = parseInt(u, 16);
}
const revoked = new Set(fs.existsSync(path.join(dir, 'revocation_list.txt'))
  ? fs.readFileSync(path.join(dir, 'revocation_list.txt'), 'utf8').split(/\r?\n/).filter(l => /^[0-9a-f]{40}$/i.test(l.trim())).map(l => l.trim().toLowerCase()) : []);
const args = process.argv.slice(2);
const verbose = args.includes('--verbose'), table = args.includes('--table'), all = args.includes('--all');
const maxIdx = args.indexOf('--max');
const maxTests = maxIdx >= 0 ? +args[maxIdx + 1] : Infinity;
const only = args.filter((a, i) => /^[0-9A-Fa-f]{2,10}(\.[0-7])?$/.test(a) && args[i - 1] !== '--max' && args[i - 1] !== '--cpu').map(a => a.toUpperCase());

const mem = new Uint8Array(1 << 24);
// I/O reads give FFh, but ports 22h-23h are a register of the 386EX (REMAPCFG) that reads
// 427Fh on the test board (tests of IN AX,21h and IN EAX,1Fh / 21h see it).
const EX_PORTS = { 0x22: 0x7F, 0x23: 0x42 };
const in8 = p => (p in EX_PORTS ? EX_PORTS[p] : 0xFF);
const bus = {
  read8: a => mem[a & 0xFFFFFF], write8: (a, v) => { mem[a & 0xFFFFFF] = v; },
  in8, out8: () => {}, in16: p => in8(p) | (in8(p + 1) << 8), out16: () => {}, fpu: null, waitStates: 0,
};
const cpu = new CPU(bus);
if (is586 && !argv.includes('--p5queue')) cpu.queueSnoop = false;
const RN = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'], SN = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];

// f_umask of a file ("67660FBA.4" -> "0FBA.4"; the 66h / 67h prefixes do not change it).
function fileMask(file) {
  let k = file.replace('.MOO.gz', '').toUpperCase();
  while (/^6[67]/.test(k) && k.length > 2) k = k.slice(2);
  return umask[k] !== undefined ? umask[k] : umask[k.split('.')[0]];
}

let files = fs.readdirSync(dir).filter(f => f.endsWith('.MOO.gz')).sort();
if (only.length) files = files.filter(f => only.some(o => f.toUpperCase().startsWith(o + '.') || f.toUpperCase() === o + '.MOO.GZ'));
let totalPass = 0, totalFail = 0, totalSkip = 0, skippedFiles = 0;
const diff486 = {};
const failedFiles = [], rows = [];
const t0 = Date.now();
for (const file of files) {
  const name = file.replace('.MOO.gz', '');
  const skipWhy = Object.keys(SKIP).find(k => name.toUpperCase() === k);
  if (skipWhy && !all) { skippedFiles++; rows.push(`${name.padEnd(10)} skipped`); continue; }
  const moo = parseMoo(fs.readFileSync(path.join(dir, file)));
  const um = fileMask(file);
  let pass = 0, fail = 0, firstFail = null, skipped = 0;
  for (const t of moo.tests.slice(0, maxTests)) {
    if (revoked.has(t.hash)) { skipped++; continue; }
    const ini = t.initial, I = ini.regs32;
    for (const [a, v] of ini.ram) mem[a] = v;
    cpu.reset();
    RN.forEach((n, i) => { cpu.regs32[i] = I[n]; });
    cpu.syncOut();
    SN.forEach((n, i) => { const s = I[n] & 0xFFFF; cpu.setCache(i, s, s << 4, 0xFFFF, 0x93, 'real', 0); });
    cpu.cr[0] = cacheOn ? I.cr0 & ~0x60000000 : I.cr0; cpu.cr[3] = I.cr3; cpu.modeChange(I.cr0);
    cpu.dr[6] = I.dr6; cpu.dr[7] = I.dr7; cpu.updateDebug();
    // The test EFLAGS can hold bits that the 80386 does not keep (AC, ID): a 386 holds 0 there.
    cpu.ip = I.eip; cpu.eflags = is486 ? I.eflags & 0x3FFFF : I.eflags;
    cpu.flush();
    let guard = 0, err = null;
    try {
      while (!cpu.halted && guard++ < 5000) cpu.step();
    } catch (e) { err = e.stack; }
    const fin = t.final, errs = [];
    if (err) errs.push(err);
    else if (!cpu.halted) errs.push('did not halt');
    else if (cpu.shutdownState) errs.push('shutdown');
    const exp = Object.assign({}, I, fin.regs32 || {});
    const mask = Object.assign({}, moo.mask32 || {}, fin.mask32 || {});
    const fmask = ((mask.eflags !== undefined ? mask.eflags : um !== undefined ? um | 0xFFFF0000 : 0xFFFFFFFF) & 0x3FFFF) >>> 0;
    const rm = n => (mask[n] !== undefined ? mask[n] : 0xFFFFFFFF);
    const h = v => (v >>> 0).toString(16);
    RN.forEach((n, i) => { if (((cpu.regs32[i] ^ exp[n]) & rm(n)) >>> 0) errs.push(`${n}=${h(cpu.regs32[i])} want ${h(exp[n])}`); });
    SN.forEach((n, i) => { if ((cpu.sregs[i] ^ exp[n]) & 0xFFFF) errs.push(`${n}=${h(cpu.sregs[i])} want ${h(exp[n] & 0xFFFF)}`); });
    if (cpu.ip !== exp.eip >>> 0) errs.push(`eip=${h(cpu.ip)} want ${h(exp.eip)}`);
    if (((cpu.eflags ^ exp.eflags) & fmask) >>> 0) errs.push(`eflags=${(cpu.eflags & 0x3FFFF).toString(2).padStart(18, '0')} want ${(exp.eflags & 0x3FFFF).toString(2).padStart(18, '0')} mask ${fmask.toString(2).padStart(18, '0')}`);
    if (fin.regs32 && fin.regs32.cr0 !== undefined && cpu.cr[0] !== (cacheOn ? exp.cr0 & ~0x60000000 : exp.cr0) >>> 0) errs.push(`cr0=${h(cpu.cr[0])} want ${h(exp.cr0)}`);
    // The flags word that an exception pushes can hold undefined flags: mask it.
    const fa = t.exception ? t.exception.flag_address : -1;
    for (const [a, v] of fin.ram) {
      let m = 0xFF;
      if (a === fa) m = fmask & 0xFF; else if (fa >= 0 && a === fa + 1) m = (fmask >> 8) & 0xFF;
      if ((mem[a] ^ v) & m) errs.push(`[${a.toString(16)}]=${mem[a].toString(16)} want ${v.toString(16)}`);
    }
    for (const [a] of ini.ram) mem[a] = 0;
    for (const [a] of fin.ram) mem[a] = 0;
    if (is486 && (cpu.eflags & 0x240000)) diff486[name] = (diff486[name] || 0) + 1;
    if (errs.length) { fail++; if (!firstFail) firstFail = { t, errs }; } else pass++;
  }
  totalPass += pass; totalFail += fail; totalSkip += skipped;
  rows.push(`${name.padEnd(10)} ${String(pass).padStart(5)}/${String(pass + fail).padEnd(5)}${skipped ? ` (${skipped} revoked)` : ''}`);
  if (fail) {
    failedFiles.push(name);
    const ft = firstFail.t;
    console.log(`FAIL ${name}: ${fail} fail, ${pass} pass${skipped ? `, ${skipped} skipped` : ''} — #${ft.idx} ${ft.name} [${ft.bytes.map(b => b.toString(16)).join(' ')}]${ft.exception ? ' exc ' + ft.exception.number : ''} :: ${firstFail.errs.slice(0, 6).join('; ')}`);
  } else if (verbose) console.log(`ok   ${name}: ${pass}${skipped ? ` (${skipped} revoked)` : ''}`);
}
if (table) {
  console.log('\nPass counts per file (prefixes+opcode[.reg]  pass/total):');
  for (let i = 0; i < rows.length; i += 4) console.log('  ' + rows.slice(i, i + 4).map(r => r.padEnd(30)).join(''));
}
if (is486) {
  const k = Object.keys(diff486);
  console.log(`
${is686 ? '686' : is586 ? '586' : '486'} difference (not a failure): AC or ID = 1 after the instruction in ${k.reduce((a, n) => a + diff486[n], 0)} tests: ` +
    k.map(n => `${n} ${diff486[n]}`).join(', '));
  console.log(`${is686 ? '686 caches' : is586 ? '586 caches' : '486 cache'}: ${cacheOn ? 'on (CD = NW = 0)' : 'as in the tests'}`);
}
if (skippedFiles) {
  console.log(`\nSkipped groups (${skippedFiles}):`);
  for (const [k, why] of Object.entries(SKIP)) console.log(`  ${k}: ${why}`);
}
console.log(`\nTOTAL pass ${totalPass}, fail ${totalFail}, revoked (skipped) ${totalSkip}; files failing: ${failedFiles.length}/${files.length - skippedFiles}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failedFiles.length) console.log('failing: ' + failedFiles.join(' '));
process.exitCode = totalFail ? 1 : 0;
