// Runs the SingleStepTests 8086 v1 suite (tools/sst8086) against src/core/cpu8086.js.
// Usage: node tests/cpu.test.mjs [opcode-hex ...] [--max N] [--verbose]
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
vm.runInThisContext(fs.readFileSync(path.join(root, 'src/core/cpu8086.js'), 'utf8'), { filename: 'cpu8086.js' });
const CPU = vm.runInThisContext('CPU8086');

const dir = path.join(root, 'tools/sst8086');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')).opcodes;
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const maxIdx = args.indexOf('--max');
const maxTests = maxIdx >= 0 ? +args[maxIdx + 1] : Infinity;
const only = args.filter((a, i) => /^[0-9A-Fa-f]{2}(\.[0-7])?$/.test(a) && args[i - 1] !== '--max').map(a => a.toUpperCase());

const mem = new Uint8Array(1 << 20);
const bus = {
  read8: a => mem[a & 0xFFFFF], write8: (a, v) => { mem[a & 0xFFFFF] = v; },
  in8: () => 0xFF, out8: () => {}, fpu: null,
};
const cpu = new CPU(bus);
const RN = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'], SN = ['es', 'cs', 'ss', 'ds'];

function info(file, t) {
  const op = file.slice(0, 2).toUpperCase();
  const m = meta[op] || {};
  if (file.includes('.')) {
    const reg = file.split('.')[1];
    const r = file.length > 7 ? (m.reg || {})[reg] : null;
    if (r) return r;
  }
  if (m.reg && t) {
    // opcode with reg field: find modrm after prefixes
    let i = 0; while ([0x26, 0x2E, 0x36, 0x3E, 0xF0, 0xF1, 0xF2, 0xF3].includes(t.bytes[i])) i++;
    const reg = (t.bytes[i + 1] >> 3) & 7;
    return m.reg[String(reg)] || m;
  }
  return m;
}

function op0(t) { let i = 0; while ([0x26, 0x2E, 0x36, 0x3E, 0xF0, 0xF1, 0xF2, 0xF3].includes(t.bytes[i])) i++; return t.bytes[i]; }
let files = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort();
if (only.length) files = files.filter(f => only.some(o => f.toUpperCase().startsWith(o)));
let totalPass = 0, totalFail = 0;
const failedFiles = [];
for (const file of files) {
  const tests = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString());
  let pass = 0, fail = 0, firstFail = null, skipped = 0;
  for (const t of tests.slice(0, maxTests)) {
    const inf = info(file, t);
    if (inf.status === 'undefined' || inf.status === 'prefix') { skipped++; continue; }
    const ini = t.initial;
    for (const [a, v] of ini.ram) mem[a] = v;
    cpu.reset();
    RN.forEach((n, i) => { cpu.regs[i] = ini.regs[n]; });
    SN.forEach((n, i) => { cpu.sregs[i] = ini.regs[n]; });
    cpu.ip = ini.regs.ip; cpu.flags = ini.regs.flags;
    cpu.q = ini.queue.slice(); cpu.qip = (cpu.ip + cpu.q.length) & 0xFFFF;
    let guard = 0;
    try {
      cpu.step();
      while (cpu.repState && guard++ < 200000) cpu.step();
    } catch (e) { fail++; if (!firstFail) firstFail = { t, err: e.stack }; continue; }
    const fin = t.final, errs = [];
    const exp = Object.assign({}, ini.regs, fin.regs);
    RN.forEach((n, i) => { if (cpu.regs[i] !== exp[n]) errs.push(`${n}=${cpu.regs[i].toString(16)} want ${exp[n].toString(16)}`); });
    SN.forEach((n, i) => { if (cpu.sregs[i] !== exp[n]) errs.push(`${n}=${cpu.sregs[i].toString(16)} want ${exp[n].toString(16)}`); });
    if (cpu.ip !== exp.ip) errs.push(`ip=${cpu.ip.toString(16)} want ${exp.ip.toString(16)}`);
    const mask = inf['flags-mask'] !== undefined ? inf['flags-mask'] : 0xFFFF;
    if ((cpu.flags & mask) !== (exp.flags & mask)) errs.push(`flags=${cpu.flags.toString(2).padStart(16, '0')} want ${exp.flags.toString(2).padStart(16, '0')} mask ${mask.toString(2).padStart(16, '0')}`);
    // On a divide exception the pushed flags word holds the undefined flags too.
    let fa = -1;
    if (fin.regs.cs !== undefined && (op0(t) & 0xFE) === 0xF6 || op0(t) === 0xD4) {
      fa = ((exp.ss << 4) + ((exp.sp + 4) & 0xFFFF)) & 0xFFFFF;
    }
    for (const [a, v] of fin.ram) if (mem[a] !== v && !((a === fa && ((mem[a] ^ v) & mask & 0xFF) === 0) || (a === ((fa + 1) & 0xFFFFF) && fa >= 0 && ((mem[a] ^ v) & (mask >> 8) & 0xFF) === 0))) errs.push(`[${a.toString(16)}]=${mem[a].toString(16)} want ${v.toString(16)}`);
    // restore memory touched
    for (const [a] of ini.ram) mem[a] = 0;
    for (const [a] of fin.ram) mem[a] = 0;
    if (errs.length) { fail++; if (!firstFail) firstFail = { t, errs }; } else pass++;
  }
  totalPass += pass; totalFail += fail;
  if (fail) {
    failedFiles.push(file);
    console.log(`FAIL ${file}: ${fail} fail, ${pass} pass${skipped ? `, ${skipped} skipped` : ''} — ${firstFail.t.name} [${firstFail.t.bytes.map(b => b.toString(16)).join(' ')}] :: ${firstFail.err || firstFail.errs.join('; ')}`);
  } else if (verbose) console.log(`ok   ${file}: ${pass}${skipped ? ` (${skipped} skipped)` : ''}`);
}
console.log(`\nTOTAL pass ${totalPass}, fail ${totalFail}; files failing: ${failedFiles.length}/${files.length}`);
process.exitCode = totalFail ? 1 : 0;
