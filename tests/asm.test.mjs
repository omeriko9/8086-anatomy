// Tests for src/asm/disasm.js and src/asm/assembler.js.
// Run: node tests/asm.test.mjs
// NASM 2.16.03 (tools/nasm/) is the reference for encodings and for ndisasm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/asm/disasm.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/asm/assembler.js'), 'utf8'));
const Asm86 = vm.runInThisContext('Asm86');
const Disasm86 = vm.runInThisContext('Disasm86');

const NASM_DIR = fs.readdirSync(path.join(ROOT, 'tools/nasm')).map((d) => path.join(ROOT, 'tools/nasm', d))
  .find((d) => fs.existsSync(path.join(d, process.platform === 'win32' ? 'nasm.exe' : 'nasm')));
const EXE = process.platform === 'win32' ? '.exe' : '';
const NASM = NASM_DIR && path.join(NASM_DIR, 'nasm' + EXE);
const NDISASM = NASM_DIR && path.join(NASM_DIR, 'ndisasm' + EXE);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asm86-'));

// ------------------------------------------------------------------ harness
const results = [];
let failures = 0;
function section(name, fn) {
  const r = { name, pass: 0, fail: 0, skip: 0, notes: [] };
  results.push(r);
  const t0 = Date.now();
  try {
    fn(r);
  } catch (e) {
    r.fail++;
    console.log(`  [${name}] exception: ${e.stack}`);
  }
  failures += r.fail;
  console.log(`${r.fail ? 'FAIL' : 'ok  '} ${name}: ${r.pass} passed, ${r.fail} failed, ${r.skip} skipped (${Date.now() - t0} ms)`);
  for (const n of r.notes) console.log('       ' + n);
}
function check(r, cond, msg) {
  if (cond) r.pass++;
  else { r.fail++; if (r.fail <= 25) console.log(`  [${r.name}] ${msg}`); }
}
const hex = (b) => Buffer.from(b).toString('hex').toUpperCase();

// ---------------------------------------------------------------- NASM glue
// Assembles lines with NASM -f bin. Returns { bytes, errLines:Set, perLine:Map(line -> hex) }
function nasm(lines) {
  const src = path.join(TMP, 'n.asm');
  const bin = path.join(TMP, 'n.bin');
  const lst = path.join(TMP, 'n.lst');
  fs.writeFileSync(src, lines.join('\n') + '\n');
  try { fs.unlinkSync(bin); } catch { /* none */ }
  const p = spawnSync(NASM, ['-f', 'bin', '-w-all', src, '-o', bin, '-l', lst], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const errLines = new Set();
  for (const m of (p.stderr || '').matchAll(/:(\d+): error:/g)) errLines.add(+m[1]);
  const perLine = new Map();
  if (fs.existsSync(lst)) {
    for (const l of fs.readFileSync(lst, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(\d+) [0-9A-F]{8} ([0-9A-F]+)-?(?:\s|$)/.exec(l);
      if (m) perLine.set(+m[1], (perLine.get(+m[1]) || '') + m[2]);
    }
  }
  const bytes = fs.existsSync(bin) ? fs.readFileSync(bin) : null;
  return { bytes, errLines, perLine };
}

// Assembles with both and requires identical output. Lines NASM rejects are
// removed (and reported as skips) when dropRejected is true. nasmCpu: NASM gets
// "cpu <nasmCpu>" in place of "cpu 486" (NASM 2.16 has cpuid and cmpxchg 0F B0/B1 only
// from its Pentium level; the 486 has them).
function compareWithNasm(r, lines, { dropRejected = false, label = '', cpu = '8086', nasmCpu = '' } = {}) {
  let src = lines;
  const forNasm = (l) => (nasmCpu ? l.map((x) => (x === 'cpu 486' ? 'cpu ' + nasmCpu : x)) : l);
  let n = nasm(forNasm(src));
  if (n.errLines.size) {
    if (!dropRejected) {
      check(r, false, `${label}NASM rejected lines: ` + [...n.errLines].slice(0, 5).map((k) => `${k}: ${src[k - 1]}`).join(' | '));
      return null;
    }
    const bad = n.errLines;
    r.skip += bad.size;
    r.nasmRejected = (r.nasmRejected || []).concat([...bad].map((k) => src[k - 1]));
    src = src.filter((_, k) => !bad.has(k + 1));
    n = nasm(forNasm(src));
  }
  const a = Asm86.assemble(src.join('\n'), { origin: 0, cpu });
  if (!a.ok) {
    check(r, false, `${label}Asm86 errors: ` + a.errors.slice(0, 5).map((e) => `${e.line}:${e.col} ${e.msg} [${src[e.line - 1]}]`).join(' | '));
    return null;
  }
  if (n.bytes && Buffer.compare(Buffer.from(a.bytes), n.bytes) === 0) {
    r.pass += src.length;
    return { src, asm: a };
  }
  // find the first line that differs
  const mine = new Map(a.lineMap.map((e) => [e.line, hex(a.bytes.slice(e.addr - a.origin, e.addr - a.origin + e.len))]));
  let shown = 0;
  for (let k = 1; k <= src.length; k++) {
    const x = mine.get(k) || '';
    const y = n.perLine.get(k) || '';
    if (x !== y) {
      check(r, false, `${label}line ${k} '${src[k - 1]}': Asm86 ${x || '-'} NASM ${y || '-'}`);
      if (++shown > 20) break;
    } else r.pass++;
  }
  if (!shown) check(r, false, `${label}outputs differ, but no line differs`);
  return null;
}

// ---------------------------------------------------------- operand pools
const R8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
const R16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const SR = ['es', 'cs', 'ss', 'ds'];
const EAS = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', 'bp', 'bx'];
const DISPS = ['', '+5', '-5', '+0x7F', '-0x80', '+0x80', '-0x81', '+0x1234', '-0x1234', '+0xFFFF'];
const MEMS = [];
for (const ea of EAS) for (const d of DISPS) MEMS.push(`[${ea}${d}]`);
MEMS.push('[0x1234]', '[0]', '[0xFFFF]', '[es:bx]', '[cs:bp+si+3]', 'ss:[di-2]', '[ds:0x55]', '[bp+0]',
  '[bx+0]', '[si+bx]', '[di+bp+2*3]', '[word bx+1]', '[byte bp+1]', '[bx+si+(10-3)*4]', '[ss:0x10]', '[es:bp]');
const FEWMEMS = ['[bx+si]', '[bp]', '[di+0x10]', '[bp+di-0x100]', '[0x2345]', '[es:si]', '[cs:bx+5]', '[ss:bp+di+0x1234]'];
const IMM8 = ['0', '5', '-5', '0x7F', '0x80', '0xFF', '-0x80', "'a'", '(3+4)*2', '1<<4', '~0', '0b1010', '17o', '0FFh'];
const IMM16 = [...IMM8, '-0x81', '0x1234', '0xFF80', '0xFF7F', '0xFFFF', '1000', '-32768', "'ab'", '0x1234 & 0xFF0'];
const pick = (a, k) => a[k % a.length];

function instructionForms() {
  const L = [];
  const ALU = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
  for (const op of [...ALU, 'mov', 'test', 'xchg']) {
    for (const a of R8) for (const b of R8) L.push(`${op} ${a}, ${b}`);
    for (const a of R16) for (const b of R16) L.push(`${op} ${a}, ${b}`);
    MEMS.forEach((m, k) => {
      L.push(`${op} ${m}, ${pick(R8, k)}`, `${op} ${pick(R8, k + 3)}, ${m}`);
      L.push(`${op} ${m}, ${pick(R16, k)}`, `${op} ${pick(R16, k + 5)}, ${m}`);
      L.push(`${op} byte ${m}, ${pick(R8, k)}`, `${op} ${pick(R16, k)}, word ${m}`);
    });
    if (op === 'xchg') continue;
    for (const v of IMM8) {
      for (const r of R8) L.push(`${op} ${r}, ${v}`);
      FEWMEMS.forEach((m) => L.push(`${op} byte ${m}, ${v}`));
    }
    for (const v of IMM16) {
      for (const r of R16) L.push(`${op} ${r}, ${v}`);
      FEWMEMS.forEach((m) => L.push(`${op} word ${m}, ${v}`));
      if (op !== 'mov' && op !== 'test') {
        L.push(`${op} ax, strict word ${v}`, `${op} bx, strict word ${v}`, `${op} word [bx], strict word ${v}`);
      }
    }
    if (op !== 'mov' && op !== 'test') L.push(`${op} bx, byte 5`, `${op} word [si], byte -3`, `${op} cx, byte 0xFF80`);
  }
  // mov with segment registers and direct addresses
  for (const s of SR) {
    for (const r of R16) L.push(`mov ${r}, ${s}`, `mov ${s}, ${r}`);
    MEMS.forEach((m) => L.push(`mov ${m}, ${s}`, `mov ${s}, ${m}`, `mov word ${m}, ${s}`));
  }
  for (const m of ['[0x1234]', '[es:0x10]', '[cs:0]', '[ss:0xFFFF]', 'ds:[0x80]', '[label1]', '[label1+2]']) {
    L.push(`mov al, ${m}`, `mov ax, ${m}`, `mov ${m}, al`, `mov ${m}, ax`, `mov bl, ${m}`, `mov ${m}, bx`);
  }
  // one-operand groups
  for (const op of ['inc', 'dec', 'not', 'neg', 'mul', 'imul', 'div', 'idiv']) {
    for (const r of [...R8, ...R16]) L.push(`${op} ${r}`);
    MEMS.forEach((m) => L.push(`${op} byte ${m}`, `${op} word ${m}`));
  }
  for (const op of ['rol', 'ror', 'rcl', 'rcr', 'shl', 'sal', 'shr', 'sar']) {
    for (const r of [...R8, ...R16]) L.push(`${op} ${r}, 1`, `${op} ${r}, cl`);
    FEWMEMS.forEach((m) => L.push(`${op} byte ${m}, 1`, `${op} word ${m}, cl`, `${op} word ${m}, 1`, `${op} byte ${m}, cl`));
  }
  for (const r of R16) L.push(`push ${r}`, `pop ${r}`);
  for (const s of SR) L.push(`push ${s}`);
  for (const s of ['es', 'ss', 'ds']) L.push(`pop ${s}`);
  L.push('pop cs');
  MEMS.forEach((m) => L.push(`push word ${m}`, `pop word ${m}`));
  for (const op of ['lea', 'les', 'lds']) MEMS.forEach((m, k) => L.push(`${op} ${pick(R16, k)}, ${m}`));
  for (const p of ['0', '0x43', '0x60', '255']) L.push(`in al, ${p}`, `in ax, ${p}`, `out ${p}, al`, `out ${p}, ax`);
  L.push('in al, dx', 'in ax, dx', 'out dx, al', 'out dx, ax');
  for (const v of ['0', '3', '0x10', '0x21', '255']) L.push(`int ${v}`);
  L.push('int3', 'into', 'iret', 'aam', 'aad', 'aam 16', 'aad 7', 'ret', 'retn', 'retf', 'ret 4', 'retf 0x10', 'ret 0');
  L.push(...'daa das aaa aas nop cbw cwd wait fwait pushf popf sahf lahf movsb movsw cmpsb cmpsw stosb stosw lodsb lodsw scasb scasw xlat xlatb hlt cmc clc stc cli sti cld std salc'.split(' '));
  for (const s of ['movsb', 'movsw', 'cmpsb', 'cmpsw', 'stosb', 'stosw', 'lodsb', 'lodsw', 'scasb', 'scasw']) {
    for (const p of ['rep', 'repe', 'repz', 'repne', 'repnz', 'es', 'cs', 'ss', 'ds', 'rep es', 'es rep', 'lock']) L.push(`${p} ${s}`);
  }
  L.push('es xlatb', 'lock inc word [bx]', 'lock xchg [bx], ax', 'lock add [es:bx], al', 'rep lock movsb', 'lock rep movsb', 'es nop', 'rep', 'lock', 'es', 'cs');
  // far and indirect control transfer
  L.push('jmp 0x1234:0x5678', 'call 0x1234:0x5678', 'jmp 0:0', 'call 0xFFFF:0xFFFF');
  for (const m of FEWMEMS) L.push(`jmp ${m}`, `call ${m}`, `jmp word ${m}`, `call word ${m}`, `jmp far ${m}`, `call far ${m}`);
  for (const r of R16) L.push(`jmp ${r}`, `call ${r}`);
  L.push('label1: dw 0');
  return L;
}

function fpuForms() {
  const L = [];
  const FM = ['[bx]', '[bp+si+0x10]', '[0x1234]', '[es:di-4]', '[bp]'];
  const A = ['fadd', 'fmul', 'fcom', 'fcomp', 'fsub', 'fsubr', 'fdiv', 'fdivr'];
  for (const m of A) {
    L.push(m);
    FM.forEach((x) => L.push(`${m} dword ${x}`, `${m} qword ${x}`));
    for (let i = 0; i < 8; i++) {
      L.push(`${m} st${i}`, `${m} st0, st${i}`);
      if (m !== 'fcom' && m !== 'fcomp') L.push(`${m} st${i}, st0`, `${m} to st${i}`);
    }
  }
  for (const m of ['faddp', 'fmulp', 'fsubp', 'fsubrp', 'fdivp', 'fdivrp']) {
    L.push(m);
    for (let i = 0; i < 8; i++) L.push(`${m} st${i}`, `${m} st${i}, st0`);
  }
  for (const m of ['fiadd', 'fimul', 'ficom', 'ficomp', 'fisub', 'fisubr', 'fidiv', 'fidivr']) {
    FM.forEach((x) => L.push(`${m} word ${x}`, `${m} dword ${x}`));
  }
  const sized = { fld: ['dword', 'qword', 'tword'], fst: ['dword', 'qword'], fstp: ['dword', 'qword', 'tword'],
    fild: ['word', 'dword', 'qword'], fist: ['word', 'dword'], fistp: ['word', 'dword', 'qword'],
    fbld: ['', 'tword'], fbstp: ['', 'tword'], fldcw: ['', 'word'], fnstcw: ['', 'word'], fstcw: ['', 'word'],
    fnstsw: ['', 'word'], fstsw: ['', 'word'], fldenv: [''], fnstenv: [''], fstenv: [''], frstor: [''],
    fnsave: [''], fsave: [''] };
  for (const [m, sizes] of Object.entries(sized)) for (const s of sizes) FM.forEach((x) => L.push(`${m} ${s} ${x}`.replace('  ', ' ')));
  for (let i = 0; i < 8; i++) L.push(`fld st${i}`, `fst st${i}`, `fstp st${i}`, `fxch st${i}`, `fxch st0, st${i}`, `fxch st${i}, st0`, `ffree st${i}`);
  L.push(...('fxch fcompp ftst fxam fldz fld1 fldpi fldl2t fldl2e fldlg2 fldln2 fsqrt fscale fprem frndint fxtract ' +
    'fabs fchs fptan fpatan f2xm1 fyl2x fyl2xp1 fninit finit fnclex fclex fneni feni fndisi fdisi fincstp fdecstp fnop').split(' '));
  return L;
}

function jumpForms() {
  const L = [];
  let n = 0;
  const dists = [0, 1, 2, 50, 120, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 200, 1000];
  for (const j of ['jmp', 'jz', 'jnc', 'jg', 'call', 'loop', 'jcxz', 'loopne', 'jmp short', 'jmp near', 'jz short']) {
    for (const d of dists) {
      const short = /loop|jcxz|short/.test(j);
      if (short && d > 120) continue;
      const a = `L${n++}`;
      L.push(`${j} ${a}`, `times ${d} nop`, `${a}:`);
      const b = `L${n++}`;
      L.push(`${b}:`, `times ${d} nop`, `${j} ${b}`);
    }
  }
  // sizes that depend on each other
  L.push('chain0: jmp chain3', 'jz chain2', 'times 60 nop', 'chain1: jmp chain0', 'times 60 nop', 'chain2: jnz chain1', 'chain3: nop');
  for (const x of ['jz', 'jmp', 'jc']) L.push(`${x} far_away`, `${x} $`, `${x} $+2`, `${x} $-0x7E`);
  L.push('times 300 nop', 'far_away: jz far_away-300', 'jmp far_away-400');
  // forward references in immediates and displacements
  L.push('mov ax, fwd_small', 'add bx, fwd_small', 'add bx, fwd_big', 'mov ax, [bx+fwd_small]', 'mov ax, [bx+fwd_big]',
    'mov ax, [bp+fwd_zero]', 'mov ax, [bx+fwd_zero]', 'cmp word [si], fwd_small', 'and cx, fwd_label', 'mov ax, [fwd_label]',
    'fwd_small equ 5', 'fwd_big equ 0x1234', 'fwd_zero equ 0', 'fwd_label: dw fwd_label');
  return L;
}

function dataForms(rand) {
  const L = [];
  L.push("db 1, 2, 3, 'abc', 0", 'db -1, 255, -128', 'dw 1, -1, 0xFFFF, 0x1234', "dw 'a', 'abc', 'ab'", "dd 'abcde'",
    'dd 0x12345678, -1', 'dq 0x123456789ABCDEF0, -2, 12345678901234567890', 'db `a\\n\\t\\x41\\101\\0`', "db \"it's\"",
    'db 7Fh, 0x7F, 0b0111_1111, 1111111b, 177o, 177q, 0o177, 127d, 0d127, $7F, 0h7F',
    'dw $, $$, $-$$', 'times 5 db 0xAA', 'times 3 dw $', 'align 4', 'db 1', 'align 8, db 0', 'align 16', 'resb 3', 'resw 2',
    'dd 1.5, -1.5, 0.0, 3.14159, 1e10, 1.0e-10, 1e-45, 1.17549435e-38, 3.4028234e38',
    'dq 1.5, -0.1, 3.141592653589793, 1e300, 4.9e-324, 2.2250738585072014e-308, 1.7976931348623157e308',
    'dt 1.0, -2.5, 3.14159, 1e4000, 1e-4940, 0.1, 123456789.123456789',
    'dw 3*4+2, (1<<8)|3, 100/7, 100 % 7, -100 % 7, -100/7, -100//7, -100 %% 7, ~5 & 0xFF, 6^3, 0x10 >> 2, -(-5)', 'db !0, !5',
    'glob: db 0', '.loc: db 1', 'dw .loc, glob.loc, glob', 'other: dw .loc', '.loc: dw .loc');
  for (let k = 0; k < 400; k++) {
    const digits = (n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');
    const mant = `${digits(1 + Math.floor(rand() * 6))}.${digits(1 + Math.floor(rand() * 18))}`;
    const e = (lo, hi) => lo + Math.floor(rand() * (hi - lo));
    L.push(`dd ${mant}e${e(-44, 37)}`, `dq ${mant}e${e(-320, 307)}`, `dt ${mant}e${e(-4940, 4930)}`, `dt -${mant}`);
  }
  return L;
}

// 80186 / 80286 / 80287 forms (NASM "cpu 286")
function forms286() {
  const L = [];
  for (const v of [...IMM16, 'byte 5', 'byte -3', 'strict word 5', 'word 0x80', 'word 5']) L.push(`push ${v}`);
  L.push(...'pusha popa pushaw popaw leave insb insw outsb outsw clts loadall286 fsetpm'.split(' '));
  L.push('rep insb', 'rep insw', 'rep outsb', 'rep outsw', 'es outsb', 'rep es outsw', 'cs outsw', 'fstsw ax', 'fnstsw ax');
  for (const v of [...IMM16, 'byte 5', 'strict word 5']) {
    for (const r of R16) L.push(`imul ${r}, ${v}`, `imul ${r}, ${pick(R16, r.length + v.length)}, ${v}`);
    FEWMEMS.forEach((m, k) => L.push(`imul ${pick(R16, k)}, ${m}, ${v}`, `imul ${pick(R16, k + 1)}, word ${m}, ${v}`));
  }
  for (const op of ['rol', 'ror', 'rcl', 'rcr', 'shl', 'sal', 'shr', 'sar']) {
    for (const c of ['0', '1', '2', '3', '7', '8', '16', '31', '255', '4-3']) {
      for (const r of [...R8, ...R16]) L.push(`${op} ${r}, ${c}`);
      FEWMEMS.forEach((m) => L.push(`${op} byte ${m}, ${c}`, `${op} word ${m}, ${c}`));
    }
  }
  for (const [a, b] of [[0, 0], [8, 0], [0x1234, 1], [0xFFFF, 31], [2, 255]]) L.push(`enter ${a}, ${b}`);
  MEMS.forEach((m, k) => L.push(`bound ${pick(R16, k)}, ${m}`));
  for (const op of ['sldt', 'str', 'lldt', 'ltr', 'verr', 'verw', 'smsw', 'lmsw']) {
    for (const r of R16) L.push(`${op} ${r}`);
    FEWMEMS.forEach((m) => L.push(`${op} ${m}`, `${op} word ${m}`));
  }
  for (const op of ['sgdt', 'sidt', 'lgdt', 'lidt']) MEMS.forEach((m) => L.push(`${op} ${m}`));
  for (const op of ['lar', 'lsl']) {
    for (const a of R16) for (const b of R16) L.push(`${op} ${a}, ${b}`);
    MEMS.forEach((m, k) => L.push(`${op} ${pick(R16, k)}, ${m}`, `${op} ${pick(R16, k + 3)}, word ${m}`));
  }
  for (const a of R16) for (const b of R16) L.push(`arpl ${a}, ${b}`);
  MEMS.forEach((m, k) => L.push(`arpl ${m}, ${pick(R16, k)}`, `arpl word ${m}, ${pick(R16, k + 2)}`));
  // forward references in the new immediate forms
  L.push('push fwd286', 'imul ax, bx, fwd286', 'shl ax, fwd286', 'push fwd286b', 'imul cx, fwd286b', 'fwd286 equ 3', 'fwd286b equ 300');
  return L;
}

// ------------------------------------------------------------ 80386 forms
const R32 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const CC = 'o no b c nae nb ae nc e z ne nz be na a nbe s ns p pe np po l nge ge nl le ng g nle'.split(' ');
const SHIFTS = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'sal', 'shr', 'sar'];
const ALUS = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
// all 32-bit address forms: base x index x scale x displacement, and special cases
function mems32(bits) {
  const L = [];
  const disps = ['', '+1', '-0x80', '+0x80', '-0x12345678'];
  for (const b of ['', ...R32]) {
    for (const x of ['', 'eax', 'ecx', 'edx', 'ebx', 'ebp', 'esi', 'edi']) {
      for (const s of x ? ['', '*1', '*2', '*4', '*8'] : ['']) {
        for (const d of disps) {
          if (!b && !x) continue;
          if (!b && s === '*1') continue; // [ecx*1] is [ecx]
          L.push(`[${[b, x && x + s].filter(Boolean).join('+')}${d}]`);
        }
      }
    }
  }
  L.push('[esp]', '[ebp]', '[eax*1]', '[eax*3+4]', '[eax*5]', '[eax*9-1]', '[ecx*1+edx]', '[edx+ecx*1]',
    '[ecx*1+ebp]', '[nosplit eax*2]', '[nosplit eax*1+8]', '[nosplit eax*2+0x10]', '[nosplit ebx]', '[eax+esp]',
    '[esp*1+eax]', '[ebp+esp]', '[esp+ebp*1]', '[eax+eax]', '[ebx+ebx*2]', '[esi*2+edi*1]', '[dword eax]',
    '[dword eax+1]', '[byte eax+1]', '[byte ebp-2]', '[eax+0]', '[ebp+0]', '[0x12345678]', '[dword 0x10]',
    '[fs:eax]', 'fs:[ebx+ecx*2]', '[gs:esp+8]', '[es:ebp-4]', '[ss:esi*4+0x100]', '[ds:edi*8]', '[cs:ecx+edx*4+6]',
    '[eax+label386]', '[label386+ebx*4]', '[esi+(3*4)]', '[4*ecx+edx]', '[eax+0xFFFFFFFF]', '[eax+0x80000000]',
    '[dword fs:0x1234]', '[word 0x10]', '[word es:0x10]');
  if (bits === 32) L.push('[bx+si]', '[bp]', '[di+0x10]');
  return L;
}
const FEW32 = ['[eax]', '[esp+4]', '[ebp-8]', '[ebx+esi*4+0x100]', '[ecx*8+0x12345678]', '[fs:edx+edi]', '[0x2345]', '[bx+si]', '[es:bp+di-0x100]'];
const IMM32 = [...IMM16, '0x12345678', '-0x80000000', '0xFFFFFFFF', '0x7FFFFFFF', '0xFFFFFF80', '0xFFFFFF7F',
  '-129', "'abcd'", '0x10000', '0x8000', '-0x8000', 'label386'];

function forms386(bits) {
  const L = [];
  const M32 = mems32(bits);
  // every address form with a few operand sizes
  M32.forEach((m, k) => L.push(`mov eax, ${m}`, `mov ${m}, ${pick(R8, k)}`, `lea ${pick(R32, k)}, ${m}`,
    `add ${pick(R16, k)}, ${m}`, `inc dword ${m}`, `fld qword ${m}`));
  // two-operand instructions with 32-bit operands
  for (const op of [...ALUS, 'mov', 'test', 'xchg']) {
    for (const a of R32) for (const b of R32) L.push(`${op} ${a}, ${b}`);
    FEW32.forEach((m, k) => L.push(`${op} ${m}, ${pick(R32, k)}`, `${op} ${pick(R32, k + 3)}, ${m}`,
      `${op} dword ${m}, ${pick(R32, k + 1)}`, `${op} ${m}, ${pick(R16, k)}`, `${op} ${pick(R8, k)}, ${m}`));
    MEMS.slice(0, 40).forEach((m, k) => L.push(`${op} ${m}, ${pick(R32, k)}`, `${op} ${pick(R32, k + 5)}, ${m}`));
    if (op === 'xchg') continue;
    for (const v of IMM32) {
      for (const r of R32) L.push(`${op} ${r}, ${v}`);
      FEW32.forEach((m) => L.push(`${op} dword ${m}, ${v}`));
    }
    FEW32.forEach((m) => L.push(`${op} byte ${m}, 5`, `${op} word ${m}, 0x1234`));
    if (op !== 'mov' && op !== 'test') {
      L.push(`${op} eax, strict dword 5`, `${op} ebx, strict dword 5`, `${op} dword [ebx], strict dword -1`,
        `${op} ecx, byte -3`, `${op} dword [eax], byte 0x7F`, `${op} ax, byte 5`, `${op} ax, strict word 5`);
    }
  }
  // segment registers (also fs and gs)
  for (const s of ['es', 'cs', 'ss', 'ds', 'fs', 'gs']) {
    for (const r of [...R16, ...R32]) {
      L.push(`mov ${r}, ${s}`);
      if (s !== 'cs') L.push(`mov ${s}, ${r}`);
    }
    FEW32.forEach((m) => {
      L.push(`mov ${m}, ${s}`, `mov word ${m}, ${s}`);
      if (s !== 'cs') L.push(`mov ${s}, ${m}`, `mov ${s}, word ${m}`);
    });
    L.push(`push ${s}`, `o16 push ${s}`, `o32 push ${s}`, `push dword ${s}`);
    if (s !== 'cs') L.push(`pop ${s}`, `o16 pop ${s}`, `o32 pop ${s}`);
  }
  // direct addresses (moffs forms)
  for (const m of ['[0x12345678]', '[fs:0x10]', '[gs:0]', '[dword 0x10]', '[word 0x10]', '[dword es:0x1234]', '[label386]', '[0x1234]']) {
    if (bits === 16 && m === '[0x12345678]') continue;
    L.push(`mov al, ${m}`, `mov ax, ${m}`, `mov eax, ${m}`, `mov ${m}, al`, `mov ${m}, ax`, `mov ${m}, eax`, `mov ebx, ${m}`, `mov ${m}, cl`);
  }
  L.push('a32 mov al, [0x10]', 'a16 mov eax, [0x10]');
  // one-operand groups and shifts
  for (const op of ['inc', 'dec', 'not', 'neg', 'mul', 'imul', 'div', 'idiv']) {
    for (const r of [...R32, ...R16, 'al']) L.push(`${op} ${r}`);
    FEW32.forEach((m) => L.push(`${op} dword ${m}`, `${op} word ${m}`, `${op} byte ${m}`));
  }
  for (const op of SHIFTS) {
    for (const r of R32) L.push(`${op} ${r}, 1`, `${op} ${r}, cl`, `${op} ${r}, 5`);
    FEW32.forEach((m) => L.push(`${op} dword ${m}, 1`, `${op} dword ${m}, cl`, `${op} dword ${m}, 31`, `${op} word ${m}, 3`, `${op} byte ${m}, 1`));
  }
  // push and pop
  for (const r of [...R32, ...R16]) L.push(`push ${r}`, `pop ${r}`);
  FEW32.forEach((m) => L.push(`push dword ${m}`, `pop dword ${m}`, `push word ${m}`, `pop word ${m}`));
  for (const v of IMM16) L.push(`push ${v}`, `push word ${v}`);
  for (const v of IMM32) L.push(`push dword ${v}`);
  L.push('push byte 5', 'push byte -3', 'push strict word 5', 'push strict dword 5', 'push word 0x80', 'push dword 0x80');
  if (bits === 32) for (const v of IMM32) L.push(`push ${v}`);
  // lea, far pointer loads, bound
  for (const op of ['lea', 'les', 'lds', 'lss', 'lfs', 'lgs', 'bound']) {
    FEW32.forEach((m, k) => L.push(`${op} ${pick(R32, k)}, ${m}`, `${op} ${pick(R16, k + 1)}, ${m}`));
  }
  // in, out
  L.push('in eax, dx', 'in eax, 0x60', 'out dx, eax', 'out 0x60, eax', 'in ax, dx', 'out 0x43, ax');
  // string instructions, with prefixes
  for (const s of ['movs', 'cmps', 'stos', 'lods', 'scas', 'ins', 'outs']) {
    for (const z of ['b', 'w', 'd']) {
      for (const p of ['', 'rep ', 'a16 ', 'a32 ', 'es ', 'fs ', 'rep gs a32 ', 'o16 ', 'o32 ']) L.push(p + s + z);
    }
  }
  L.push(...('cwde cdq cbw cwd pushad popad pushfd popfd iretd pushaw popaw pushfw popfw iretw pusha popa ' +
    'pushf popf iret retnd retfd retnw retfw retn retf ret xlatb').split(' '));
  L.push('ret 4', 'retf 8', 'retnd 4', 'retfw 2', 'o16 ret', 'o32 ret', 'o32 retf', 'o16 iret', 'o32 iret',
    'enter 8, 1', 'leave', 'o32 leave', 'o16 enter 4, 0', 'a32 xlatb', 'a16 xlatb', 'o32 nop', 'o16 nop', 'a32 nop',
    'a16 nop', 'o32 int 0x21', 'o32 cli', 'o32 clts', 'a32 aam', 'o32 lgdt [bx]', 'o32 lidt [eax]', 'o16 sgdt [bx]',
    'lock add dword [ebx], 1', 'lock xchg [eax], ecx', 'lock bts dword [esi], 3', 'lock inc dword [es:bx]',
    'lock btc [eax], ebx', 'lock not byte [ecx*2+5]');
  // movzx, movsx
  for (const op of ['movzx', 'movsx']) {
    for (const [a, b] of [['ax', 'bl'], ['eax', 'bl'], ['eax', 'bx'], ['ecx', 'ah'], ['edi', 'di'], ['sp', 'dh'], ['esp', 'sp'], ['eax', 'al']]) {
      L.push(`${op} ${a}, ${b}`);
    }
    FEW32.forEach((m, k) => L.push(`${op} ${pick(R16, k)}, byte ${m}`, `${op} ${pick(R32, k)}, byte ${m}`, `${op} ${pick(R32, k + 1)}, word ${m}`));
  }
  // bt, bts, btr, btc
  for (const op of ['bt', 'bts', 'btr', 'btc']) {
    for (const [a, b] of [['ax', 'bx'], ['sp', 'di'], ['eax', 'ebx'], ['edi', 'esp'], ['ecx', 'ecx']]) L.push(`${op} ${a}, ${b}`);
    FEW32.forEach((m, k) => L.push(`${op} ${m}, ${pick(R16, k)}`, `${op} ${m}, ${pick(R32, k)}`));
    for (const v of ['0', '5', '31', '255', '4*4']) {
      L.push(`${op} ax, ${v}`, `${op} esi, ${v}`);
      FEW32.forEach((m) => L.push(`${op} word ${m}, ${v}`, `${op} dword ${m}, ${v}`));
    }
  }
  // bsf, bsr
  for (const op of ['bsf', 'bsr']) {
    for (const a of R16) L.push(`${op} ${a}, ${pick(R16, a.charCodeAt(0))}`);
    for (const a of R32) for (const b of R32) L.push(`${op} ${a}, ${b}`);
    FEW32.forEach((m, k) => L.push(`${op} ${pick(R16, k)}, ${m}`, `${op} ${pick(R32, k)}, ${m}`, `${op} ${pick(R32, k)}, dword ${m}`));
  }
  // setcc
  for (const cc of CC) {
    for (const r of R8) L.push(`set${cc} ${r}`);
    FEW32.forEach((m) => L.push(`set${cc} ${m}`, `set${cc} byte ${m}`));
  }
  // shld, shrd
  for (const op of ['shld', 'shrd']) {
    for (const [a, b] of [['ax', 'bx'], ['eax', 'ebx'], ['sp', 'bp'], ['edi', 'esi'], ['ecx', 'ecx']]) {
      L.push(`${op} ${a}, ${b}, 5`, `${op} ${a}, ${b}, cl`, `${op} ${a}, ${b}, 0`, `${op} ${a}, ${b}, 255`);
    }
    FEW32.forEach((m, k) => L.push(`${op} ${m}, ${pick(R16, k)}, 3`, `${op} ${m}, ${pick(R32, k)}, cl`, `${op} dword ${m}, ${pick(R32, k + 1)}, 31`));
  }
  // imul
  for (const a of R32) for (const b of R32) L.push(`imul ${a}, ${b}`);
  for (const a of R16) for (const b of R16) L.push(`imul ${a}, ${b}`);
  FEW32.forEach((m, k) => L.push(`imul ${pick(R32, k)}, ${m}`, `imul ${pick(R16, k)}, ${m}`, `imul ${pick(R32, k)}, dword ${m}, 5`,
    `imul ${pick(R32, k + 2)}, ${m}, 0x12345`, `imul ${pick(R16, k)}, ${m}, -3`));
  for (const v of IMM32) for (const r of R32) L.push(`imul ${r}, ${v}`, `imul ${r}, ${pick(R32, r.charCodeAt(1))}, ${v}`);
  // control, debug and test registers
  for (const r of R32) {
    for (const n of [0, 2, 3]) L.push(`mov ${r}, cr${n}`, `mov cr${n}, ${r}`);
    for (let n = 0; n < 8; n++) L.push(`mov ${r}, dr${n}`, `mov dr${n}, ${r}`);
    for (const n of [6, 7]) L.push(`mov ${r}, tr${n}`, `mov tr${n}, ${r}`);
  }
  // system instructions
  for (const op of ['sldt', 'str', 'smsw']) for (const r of [...R16, ...R32]) L.push(`${op} ${r}`);
  for (const op of ['sldt', 'str', 'lldt', 'ltr', 'verr', 'verw', 'smsw', 'lmsw']) {
    for (const r of R16) L.push(`${op} ${r}`);
    FEW32.forEach((m) => L.push(`${op} ${m}`, `${op} word ${m}`));
  }
  for (const op of ['sgdt', 'sidt', 'lgdt', 'lidt']) FEW32.forEach((m) => L.push(`${op} ${m}`, `o32 ${op} ${m}`, `o16 ${op} ${m}`));
  for (const op of ['lar', 'lsl']) {
    for (const a of [...R16, ...R32]) L.push(`${op} ${a}, ${pick(R16, a.length)}`);
    for (const a of R32) L.push(`${op} ${a}, ${pick(R32, a.charCodeAt(1))}`);
    FEW32.forEach((m, k) => L.push(`${op} ${pick(R32, k)}, ${m}`, `${op} ${pick(R16, k)}, ${m}`, `${op} ${pick(R32, k + 1)}, word ${m}`));
  }
  FEW32.forEach((m, k) => L.push(`arpl ${m}, ${pick(R16, k)}`));
  L.push('clts', 'arpl ax, bx');
  // indirect and far jumps and calls
  for (const r of [...R32, ...R16]) L.push(`jmp ${r}`, `call ${r}`);
  FEW32.forEach((m) => L.push(`jmp ${m}`, `call ${m}`, `jmp dword ${m}`, `call dword ${m}`, `jmp word ${m}`, `call word ${m}`,
    `jmp far ${m}`, `call far ${m}`, `jmp dword far ${m}`, `call far dword ${m}`, `jmp word far ${m}`, `call far word ${m}`));
  L.push('jmp 0x1234:0x5678', 'jmp dword 0x1234:0x12345678', 'jmp word 0x1234:0x5678', 'call 0x8:0x1000',
    'call dword 0x8:0x12345678', 'call word 0xFFFF:0xFFFF');
  if (bits === 32) L.push('jmp 0x1234:0x12345678', 'call 0x10:0xFFFFFFFF');
  // 80387 and 8087 forms with 32-bit addresses
  L.push('fsin', 'fcos', 'fsincos', 'fprem1', 'fucompp', 'fucom', 'fucomp', 'fucom st0, st3', 'fucomp st0, st7');
  for (let n = 0; n < 8; n++) L.push(`fucom st${n}`, `fucomp st${n}`);
  FEW32.forEach((m) => L.push(`fld dword ${m}`, `fstp qword ${m}`, `fild word ${m}`, `fistp qword ${m}`, `fbstp tword ${m}`,
    `fnstenv ${m}`, `o16 fnstenv ${m}`, `o32 fnsave ${m}`, `fldcw ${m}`, `fstsw ${m}`, `fadd dword ${m}`, `fidivr word ${m}`));
  L.push('fnstsw ax', 'fstsw ax', 'fsetpm');
  // forward references in the new forms
  L.push('mov eax, fwd386', 'add ebx, fwd386', 'add ebx, fwd386b', 'mov eax, [ebx+fwd386]', 'mov eax, [ebx*4+fwd386b]',
    'mov eax, [ebp+fwd386z]', 'push dword fwd386b', 'imul eax, ebx, fwd386b', 'bt eax, fwd386',
    'fwd386 equ 3', 'fwd386b equ 0x12345', 'fwd386z equ 0');
  L.push('label386: dd 0');
  return L;
}

// ------------------------------------------------------------ 80486 forms
function forms486(bits) {
  const L = [];
  for (const r of R32) L.push('bswap ' + r, 'o32 bswap ' + r);
  const M32 = mems32(bits).filter((_, k) => k % 7 === 0);
  for (const op of ['xadd', 'cmpxchg']) {
    R8.forEach((a, k) => L.push(op + ' ' + a + ', ' + pick(R8, k + 3)));
    R16.forEach((a, k) => L.push(op + ' ' + a + ', ' + pick(R16, k + 1), op + ' ' + a + ', ' + a));
    R32.forEach((a, k) => L.push(op + ' ' + a + ', ' + pick(R32, k + 5), op + ' ' + a + ', ' + a));
    FEW32.forEach((m, k) => L.push(op + ' ' + m + ', ' + pick(R8, k), op + ' ' + m + ', ' + pick(R16, k), op + ' ' + m + ', ' + pick(R32, k),
      op + ' dword ' + m + ', ' + pick(R32, k + 1), op + ' byte ' + m + ', ' + pick(R8, k + 2), 'lock ' + op + ' ' + m + ', ' + pick(R32, k + 2),
      'lock ' + op + ' ' + m + ', ' + pick(R8, k + 5)));
    MEMS.slice(0, 40).forEach((m, k) => L.push(op + ' ' + m + ', ' + pick(R16, k), op + ' ' + m + ', ' + pick(R32, k + 2)));
    M32.forEach((m, k) => L.push(op + ' ' + m + ', ' + pick(R32, k), 'lock ' + op + ' ' + m + ', ' + pick(R8, k)));
  }
  for (const m of [...FEW32, ...MEMS.slice(0, 20), ...M32]) L.push('invlpg ' + m);
  L.push('invlpg [label486]', 'a32 invlpg [eax]', 'invd', 'wbinvd', 'cpuid', 'o32 cpuid', 'a32 invd', 'lock xadd [ebx], eax');
  for (const r of R32) for (let n = 3; n < 8; n++) L.push('mov ' + r + ', tr' + n, 'mov tr' + n + ', ' + r);
  L.push('label486: dd 0');
  return L;
}

// ------------------------------------------------------------ Pentium forms
function forms586(bits) {
  const L = ['rdtsc', 'rdmsr', 'wrmsr', 'rsm', 'o32 rdtsc', 'a32 wrmsr'];
  const M32 = mems32(bits).filter((_, k) => k % 9 === 0);
  for (const m of [...FEW32, ...MEMS.slice(0, 30), ...M32]) L.push('cmpxchg8b ' + m, 'lock cmpxchg8b ' + m);
  L.push('cmpxchg8b qword [label586]', 'cmpxchg8b [label586+8]', 'o16 cmpxchg8b [eax]');
  for (const r of R32) L.push('mov ' + r + ', cr4', 'mov cr4, ' + r);
  L.push('label586: dd 0');
  return L;
}

// ------------------------------------------------------------ Pentium Pro forms
function forms686(bits) {
  const L = ['rdpmc', 'ud2', 'o32 rdpmc', 'a32 ud2'];
  const CC = ['o', 'no', 'b', 'c', 'nae', 'nb', 'ae', 'nc', 'e', 'z', 'ne', 'nz', 'be', 'na', 'a', 'nbe', 's', 'ns', 'p', 'pe', 'np', 'po',
    'l', 'nge', 'ge', 'nl', 'le', 'ng', 'g', 'nle'];
  const M32 = mems32(bits).filter((_, k) => k % 11 === 0);
  CC.forEach((c, k) => {
    L.push(`cmov${c} ${pick(R16, k)}, ${pick(R16, k + 3)}`, `cmov${c} ${pick(R32, k)}, ${pick(R32, k + 5)}`,
      `cmov${c} ${pick(R16, k + 1)}, ${pick(MEMS, k * 3)}`, `cmov${c} ${pick(R32, k + 2)}, ${pick(FEW32, k)}`, `cmov${c} ${pick(R32, k)}, dword ${pick(M32, k)}`,
      `cmov${c} ${pick(R16, k)}, word ${pick(FEW32, k + 1)}`);
  });
  for (const m of ['fcmovb', 'fcmove', 'fcmovbe', 'fcmovu', 'fcmovnb', 'fcmovne', 'fcmovnbe', 'fcmovnu']) {
    for (let n = 0; n < 8; n++) L.push(`${m} st0, st${n}`, `${m} st${n}`);
  }
  for (const m of ['fcomi', 'fcomip', 'fucomi', 'fucomip']) {
    L.push(m);
    for (let n = 0; n < 8; n++) L.push(`${m} st${n}`, `${m} st0, st${n}`);
  }
  return L;
}

// jumps with the 80386 near Jcc (0F 8x), rel32, and the count register of loop / jcxz
function jumpForms386(bits) {
  const L = [];
  let n = 0;
  const dists = [0, 1, 50, 120, 125, 126, 127, 128, 129, 130, 200, 1000, 40000];
  for (const j of ['jz', 'jnc', 'jg', 'jmp', 'call', 'jz near', 'jmp near', 'jz near dword', 'jmp near dword',
    'jmp dword', 'call dword', 'jz near word', 'jmp word', 'call word', 'loop', 'loope', 'loopne', 'jcxz', 'jecxz',
    'o32 jz short', 'a32 loop', 'a16 loop', 'o16 jmp short']) {
    for (const d of dists) {
      const short = /loop|jcxz|jecxz|short/.test(j);
      if (short && d > 120) continue;
      // long distances: only a few kinds (they make the source large)
      if (d > 20000 && !(bits === 32 ? ['jz', 'call', 'jz near dword', 'jmp dword'] : ['jz near dword', 'jmp dword']).includes(j)) continue;
      const a = `M${n++}`;
      L.push(`${j} ${a}`, `times ${d} nop`, `${a}:`);
      const b = `M${n++}`;
      L.push(`${b}:`, `times ${d} nop`, `${j} ${b}`);
    }
  }
  for (const c of ['cx', 'ecx']) L.push(`MC${c}: loop MC${c}, ${c}`, `loope MC${c}, ${c}`, `loopnz MC${c}, ${c}`);
  return L;
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================== the tests
const rand = mulberry(8086);
if (!NASM) console.log('NOTE: NASM is not in tools/nasm; NASM comparisons do not run.');

section('Asm86 unit checks', (r) => {
  const a = Asm86.assemble('org 0x200\nstart: mov ax, 1\n  .x: jmp .x\nval equ 3\n\ndw val, start.x\n');
  check(r, a.ok, 'unit source assembles: ' + JSON.stringify(a.errors));
  check(r, a.origin === 0x200, 'origin from org');
  check(r, hex(a.bytes) === 'B80100EBFE03000302', 'bytes ' + hex(a.bytes));
  check(r, JSON.stringify(a.lineMap) === JSON.stringify([{ line: 2, addr: 0x200, len: 3 }, { line: 3, addr: 0x203, len: 2 }, { line: 6, addr: 0x205, len: 4 }]), 'lineMap ' + JSON.stringify(a.lineMap));
  check(r, a.symbols.start === 0x200 && a.symbols['start.x'] === 0x203 && a.symbols.val === 3, 'symbols ' + JSON.stringify(a.symbols));
  const b = Asm86.assemble('nop');
  check(r, b.origin === 0x100 && b.ok && b.bytes.length === 1, 'default origin 0x100');
  const c = Asm86.assemble('nop', { origin: 0 });
  check(r, c.origin === 0, 'origin option');
  check(r, hex(Asm86.assemble('[bits 16]\n[org 0x100]\nMOV AX, BX\nMov Al, 0X7f\nJMP $').bytes) === '89D8B07FEBFE', 'case-insensitive, [directive]');
  check(r, hex(Asm86.assemble('mov ax, word ptr es:[bx]\nmov byte ptr [si], 1').bytes) === '268B07C60401', 'MASM ptr and es:[bx]');
  check(r, hex(Asm86.assemble('fld st(1)\nfadd st, st(2)').bytes) === 'D9C1D8C2', 'st(i) syntax');
  check(r, hex(Asm86.assemble('dt 5, -3').bytes) === '00000000000000A00140' + '00000000000000C000C0', 'dt with integers');
});

section('Asm86 error reports', (r) => {
  const cases = [
    ['push 5', 1, 6, 'not an 8086 instruction'],
    ['nop\n  shl ax, 2', 2, 11, 'shift count'],
    ['section .text', 1, 1, 'unknown instruction'],
    ['%define x 1', 1, 1, 'preprocessor'],
    ['mov ax, nothere', 1, 9, "undefined symbol 'nothere'"],
    ['a: jcxz b\ntimes 200 nop\nb:', 1, 9, 'out of range'],
    ['mov [bx], 5', 1, 1, 'size not specified'],
    ['pusha', 1, 1, 'not an 8086'],
    ['mov ax, bl', 1, 9, 'mismatch'],
    ['mov ax, [bx+cx]', 1, 9, 'effective address'],
    ['mov ax, [bx+bp]', 1, 9, 'two base'],
    ['x: nop\nx: nop', 2, 1, 'more than one time'],
    ['mov es, 5', 1, 1, 'invalid combination'],
    ['fld [bx]', 1, 5, 'size not specified'],
    ['fstsw ax', 1, 7, 'not an 8086 instruction (use cpu 286)'],
    ['imul ax, bx, 3', 1, 1, 'not an 8086 instruction (use cpu 286)'],
    ['pusha', 1, 1, "'pusha' is not an 8086 instruction (use cpu 286)"],
    ['cpu 186\nlgdt [bx]', 2, 1, "'lgdt' is not an 80186 instruction (use cpu 286)"],
    ['cpu 186\nfnstsw ax', 2, 8, 'not an 80186 instruction'],
    ['cpu 286\nimul ax, bx', 2, 1, 'not an 80286 instruction (use cpu 386)'],
    ['cpu 286\npop cs', 2, 5, "'pop cs' is not an 80286"],
    ['cpu 286\nmovzx ax, bl', 2, 1, "'movzx' is not an 80286 instruction (use cpu 386)"],
    ['cpu 786', 1, 1, 'unsupported cpu level'],
    ['cpu 286\nlgdt ax', 2, 1, 'invalid combination'],
    ['cpu 286\nbound ax, bx', 2, 1, 'invalid combination'],
    ['cpu 286\ncpu 8086\nshl ax, 3', 3, 9, 'shift count other than 1 or cl is not an 8086 instruction'],
    ['db 1.5', 1, 4, 'floating-point'],
    ['foo', 1, 1, "add ':'"],
    ['mov al, 300', 1, 9, 'fit in a byte'],
    ['in al, 0x300', 1, 8, 'port'],
    ["db 'abc", 1, 4, 'unterminated'],
    ['mov ax, 1/0', 1, 10, 'division by zero'],
    ['bits 32', 1, 1, 'BITS 32 needs cpu 386'],
    ['jz short far_\ntimes 300 nop\nfar_:', 1, 4, 'out of range'],
    ['mov ax, 0x12G', 1, 9, 'invalid number'],
    ['call far 0x1234', 1, 6, 'segment:offset'],
    ['x: jz near x', 1, 7, '386'],
    // 80386
    ['cpu 286\nmov eax, 1', 2, 5, "'eax' is not an 80286 register (use cpu 386)"],
    ['cpu 286\npush fs', 2, 6, "'fs' is not an 80286 register"],
    ['cpu 286\nmov eax, cr0', 2, 5, "'eax' is not an 80286 register"],
    ['cpu 286\nsetz al', 2, 1, "'setz' is not an 80286 instruction (use cpu 386)"],
    ['cpu 286\nmovsd', 2, 1, "'movsd' is not an 80286 instruction"],
    ['mov ax, [ebx]', 1, 1, '32-bit addressing is not an 8086 instruction (use cpu 386)'],
    ['cpu 286\nmov ax, [fs:bx]', 2, 1, "'fs' segment override is not an 80286 instruction"],
    ['cpu 286\no32 nop', 2, 5, "'nop' with a 32-bit operand size is not an 80286 instruction"],
    ['cpu 286\nbits 32', 2, 1, 'BITS 32 needs cpu 386'],
    ['cpu 386\nbits 64', 2, 1, 'BITS 16 and BITS 32'],
    ['cpu 386\nmov eax, [esp*2]', 2, 10, 'esp cannot be an index'],
    ['cpu 386\nmov eax, [bx+eax]', 2, 10, '16-bit and 32-bit registers'],
    ['cpu 386\nmov eax, [eax*3+ebx]', 2, 10, 'eax*3'],
    ['cpu 386\nmov eax, [eax*2+ebx*2]', 2, 10, 'two index registers'],
    ['cpu 386\nmov eax, [eax+ebx+ecx]', 2, 10, 'too many registers'],
    ['cpu 386\nmov eax, [word eax]', 2, 10, 'word displacement'],
    ['cpu 386\nmov eax, [dword bx]', 2, 10, 'dword displacement'],
    ['cpu 386\nmovzx eax, [bx]', 2, 12, 'size not specified'],
    ['cpu 386\nmovzx ax, word [bx]', 2, 11, 'mismatch'],
    ['cpu 386\nmovzx ax, bx', 2, 1, 'invalid combination'],
    ['cpu 386\nmov cr0, ax', 2, 1, 'invalid combination'],
    ['cpu 386\nloop $, dx', 2, 1, 'invalid combination'],
    ['cpu 386\njz dword $', 2, 4, "needs 'near'"],
    ['cpu 386\na16 mov ax, [eax]', 2, 13, 'a16 prefix'],
    ['cpu 386\no16 o32 nop', 2, 5, 'conflicting prefixes'],
    ['cpu 386\nbt al, 1', 2, 1, 'invalid combination'],
    ['cpu 386\nsetz ax', 2, 1, 'invalid combination'],
    ['cpu 386\nshld ax, ebx, 1', 2, 10, 'mismatch'],
    ['cpu 386\nbits 32\nmov eax, 0x123456789', 3, 10, 'fit in a dword'],
    ['cpu 386\ninvlpg [eax]', 2, 1, "'invlpg' is not an 80386 instruction (use cpu 486)"],
    // 80486
    ['cpu 386\ncpuid', 2, 1, "'cpuid' is not an 80386 instruction (use cpu 486)"],
    ['cpu 386\nbswap eax', 2, 1, "'bswap' is not an 80386 instruction (use cpu 486)"],
    ['cpu 486\nbswap ax', 2, 1, 'invalid combination'],
    ['cpu 486\nbswap [bx]', 2, 1, 'invalid combination'],
    ['cpu 486\nxadd ax, [bx]', 2, 1, 'invalid combination'],
    ['cpu 486\ncmpxchg [bx], 5', 2, 1, 'invalid combination'],
    ['cpu 486\ncmpxchg ax, ebx', 2, 13, 'mismatch'],
    ['cpu 486\ninvlpg eax', 2, 1, 'invalid combination'],
    ['cpu 486\nrdtsc', 2, 1, 'Pentium'],
    ['cpu 486\ncmpxchg8b [bx]', 2, 1, 'Pentium'],
    // Pentium
    ['cpu 486\nmov eax, cr4', 2, 10, "'cr4' is a Pentium register (use cpu 586)"],
    ['cpu 386\nrdmsr', 2, 1, "'rdmsr' is a Pentium instruction, not an 80386 instruction (use cpu 586)"],
    ['cpu 586\ncmpxchg8b eax', 2, 1, 'invalid combination'],
    ['cpu 586\ncmpxchg8b dword [bx]', 2, 1, 'invalid combination'],
    ['cpu 586\nrdtsc eax', 2, 1, 'needs 0 operands'],
    // Pentium Pro
    ['cpu 586\ncmovz ax, bx', 2, 1, "'cmovz' is a Pentium Pro instruction, not a Pentium instruction (use cpu 686)"],
    ['cpu 486\nfcomi st1', 2, 1, "'fcomi' is a Pentium Pro instruction, not an 80486 instruction (use cpu 686)"],
    ['cpu 586\nud2', 2, 1, 'Pentium Pro'],
    ['cpu 586\nrdpmc', 2, 1, 'Pentium Pro'],
    ['cpu 686\ncmovz al, bl', 2, 1, 'invalid combination'],
    ['cpu 686\ncmovz ax, 5', 2, 1, 'invalid combination'],
    ['cpu 686\ncmovz ax, ebx', 2, 11, 'mismatch'],
    ['cpu 686\nfcmovb st1, st2', 2, 1, 'invalid combination'],
    ['cpu 686\nfcmove', 2, 1, 'invalid combination'],
    ['cpu 686\nfcomi ax', 2, 1, 'invalid combination'],
    ['cpu 386\nx: loop x, ecx\ntimes 200 nop\njecxz x', 4, 7, 'out of range'],
  ];
  for (const [src, line, col, msg] of cases) {
    const a = Asm86.assemble(src);
    const e = a.errors[0];
    check(r, !a.ok && e && e.line === line && e.col === col && e.msg.includes(msg),
      `'${src.replace(/\n/g, '\\n')}' -> ${JSON.stringify(a.errors)} (expected ${line}:${col} ~ ${msg})`);
  }
});

if (NASM) {
  section('NASM parity: 8086 instruction forms', (r) => { compareWithNasm(r, ['cpu 8086', ...instructionForms()]); });
  section('NASM parity: 8087 instruction forms', (r) => { compareWithNasm(r, ['cpu 8086', ...fpuForms()]); });
  section('NASM parity: jumps and label sizes', (r) => { compareWithNasm(r, ['cpu 8086', 'org 0x100', ...jumpForms()]); });
  section('NASM parity: data, floats and directives', (r) => { compareWithNasm(r, ['cpu 8086', ...dataForms(rand)]); });
  section('NASM parity: 80186/80286/80287 forms (cpu 286)', (r) => { compareWithNasm(r, ['cpu 286', ...forms286()]); });
  section('NASM parity: 8086/8087 forms with cpu 286', (r) => {
    compareWithNasm(r, ['cpu 286', ...instructionForms().filter((l) => l !== 'pop cs'), ...fpuForms()]);
  });
  section('NASM parity: cpu option 286 (no directive)', (r) => {
    const src = forms286();
    const n = nasm(['cpu 286', ...src]);
    const a = Asm86.assemble(src.join('\n'), { origin: 0, cpu: '286' });
    check(r, a.ok && Buffer.compare(Buffer.from(a.bytes), n.bytes) === 0, 'cpu option 286 gives the same bytes as "cpu 286"');
    const b = Asm86.assemble('cpu 8086\n' + src.join('\n'), { origin: 0, cpu: '286' });
    check(r, !b.ok && b.errors.every((e) => /not an 8086 instruction \(use cpu 286\)/.test(e.msg)), 'a cpu 8086 line overrides the option: ' + JSON.stringify(b.errors[0]));
  });
  // 80386: the new instructions, the 32-bit forms and 32-bit addresses, in 16-bit and in 32-bit code
  for (const bits of [16, 32]) {
    section(`NASM parity: 80386/80387 forms (cpu 386, bits ${bits})`, (r) => {
      compareWithNasm(r, ['cpu 386', `bits ${bits}`, ...forms386(bits)]);
    });
    section(`NASM parity: 8086/8087/80286 forms (cpu 386, bits ${bits})`, (r) => {
      const old = [...instructionForms(), ...fpuForms(), ...forms286()].filter((l) => l !== 'pop cs');
      compareWithNasm(r, ['cpu 386', `bits ${bits}`, ...old]);
    });
    section(`NASM parity: jumps and label sizes (cpu 386, bits ${bits})`, (r) => {
      compareWithNasm(r, ['cpu 386', `bits ${bits}`, 'org 0x100', ...jumpForms(), ...jumpForms386(bits)]);
    });
  }
  // 80486: the new instructions in 16-bit and 32-bit code, and the 386 forms with cpu 486
  for (const bits of [16, 32]) {
    section('NASM parity: 80486 forms (cpu 486, bits ' + bits + ')', (r) => {
      compareWithNasm(r, ['cpu 486', 'bits ' + bits, ...forms486(bits)], { nasmCpu: '586', cpu: '486' });
    });
  }
  // Pentium: the new instructions, and the 486 forms with cpu 586 (NASM has the same level)
  for (const bits of [16, 32]) {
    section('NASM parity: Pentium forms (cpu 586, bits ' + bits + ')', (r) => {
      compareWithNasm(r, ['cpu 586', 'bits ' + bits, ...forms586(bits), ...forms486(bits).filter((l) => !/\btr[3-7]\b/.test(l))], { cpu: '586' });
    });
  }
  section('NASM parity: cpu option 586 (no directive)', (r) => {
    const src = forms586(32);
    const n = nasm(['cpu 586', 'bits 32', ...src]);
    const a = Asm86.assemble(src.join('\n'), { origin: 0, cpu: '586', bits: 32 });
    check(r, a.ok && Buffer.compare(Buffer.from(a.bytes), n.bytes) === 0, 'options cpu 586, bits 32 give the same bytes as the directives');
    const b = Asm86.assemble(src.join('\n'), { origin: 0, cpu: '486', bits: 32 });
    check(r, !b.ok && b.errors.every((e) => /Pentium/.test(e.msg)), 'the cpu option 486 rejects each Pentium line: ' + JSON.stringify(b.errors[0]));
    const c = Asm86.assemble('rdtsc\ncmpxchg8b [bx]\nmov cr4, eax', { origin: 0, cpu: 'pentium' });
    check(r, c.ok && hex(c.bytes) === '0F31' + '0FC70F' + '0F22E0', 'cpu pentium: ' + hex(c.bytes));
  });
  // Pentium Pro: the new instructions, and the Pentium forms with cpu 686
  for (const bits of [16, 32]) {
    section('NASM parity: Pentium Pro forms (cpu 686, bits ' + bits + ')', (r) => {
      compareWithNasm(r, ['cpu 686', 'bits ' + bits, ...forms686(bits), ...forms586(bits)], { cpu: '686' });
    });
  }
  section('NASM parity: cpu option 686 (no directive)', (r) => {
    const src = forms686(32);
    const n = nasm(['cpu 686', 'bits 32', ...src]);
    const a = Asm86.assemble(src.join('\n'), { origin: 0, cpu: '686', bits: 32 });
    check(r, a.ok && Buffer.compare(Buffer.from(a.bytes), n.bytes) === 0, 'options cpu 686, bits 32 give the same bytes as the directives');
    const b = Asm86.assemble(src.join('\n'), { origin: 0, cpu: '586', bits: 32 });
    check(r, !b.ok && b.errors.length === src.length && b.errors.every((e) => /Pentium Pro instruction, not a Pentium instruction \(use cpu 686\)/.test(e.msg)),
      'the cpu option 586 rejects each Pentium Pro line: ' + JSON.stringify(b.errors[0]));
    const c = Asm86.assemble('cmovz ax, bx\nfcomip st1\nrdpmc\nud2', { origin: 0, cpu: 'ppro' });
    check(r, c.ok && hex(c.bytes) === '0F44C3' + 'DFF1' + '0F33' + '0F0B', 'cpu ppro: ' + hex(c.bytes));
  });
  section('NASM parity: 80386/80387 forms with cpu 486 (bits 32)', (r) => {
    compareWithNasm(r, ['cpu 486', 'bits 32', ...forms386(32)], { cpu: '486' });
  });
  section('NASM parity: cpu option 486 (no directive)', (r) => {
    const src = forms486(32);
    const n = nasm(['cpu 586', 'bits 32', ...src]);
    const a = Asm86.assemble(src.join('\n'), { origin: 0, cpu: '486', bits: 32 });
    check(r, a.ok && Buffer.compare(Buffer.from(a.bytes), n.bytes) === 0, 'options cpu 486, bits 32 give the same bytes as the directives');
    const b = Asm86.assemble('cpu 386\nbswap eax', { origin: 0, cpu: '486' });
    check(r, !b.ok && /use cpu 486/.test(b.errors[0].msg), 'a cpu 386 line overrides the option 486: ' + JSON.stringify(b.errors[0]));
    const c = Asm86.assemble('bits 32\nbswap eax\nxadd [eax], ecx\ncpuid', { origin: 0, cpu: '80486' });
    check(r, c.ok && hex(c.bytes) === '0FC8' + '0FC108' + '0FA2', 'cpu 80486: ' + hex(c.bytes));
  });
  section('NASM parity: cpu and bits options 386 / 32 (no directive)', (r) => {
    const src = forms386(32);
    const n = nasm(['cpu 386', 'bits 32', ...src]);
    const a = Asm86.assemble(src.join('\n'), { origin: 0, cpu: '386', bits: 32 });
    check(r, a.ok && Buffer.compare(Buffer.from(a.bytes), n.bytes) === 0, 'options cpu 386, bits 32 give the same bytes as the directives');
    const b = Asm86.assemble('use32\nmov eax, 1\nuse16\nmov eax, 1\n[bits 32]\nmov ax, 1', { origin: 0, cpu: '386' });
    check(r, b.ok && hex(b.bytes) === 'B801000000' + '66B801000000' + '66B80100', 'use32 / use16 / [bits 32]: ' + hex(b.bytes));
    let threw = false;
    try { Asm86.assemble('nop', { bits: 32 }); } catch { threw = true; }
    check(r, threw, 'the bits option 32 needs the cpu option 386');
  });
}

// Round trip: decode every opcode byte with many ModR/M bytes and operand
// bytes, reassemble the text and compare.
//   exact:      reassembled bytes = original bytes
//   equivalent: other bytes, but they decode to the same text (the original is
//               an alias or a non-minimal encoding; NASM picks the canonical one)
function roundTrip(r, cpu) {
  const OFF = 0x1000;
  const dopt = { cpu };
  const cases = new Map();
  const rnd = () => Math.floor(rand() * 256);
  const add = (bytes) => {
    const d = Disasm86.decode((i) => bytes[i & 0xFFFF] ?? 0, OFF, dopt);
    if (d.mnem === 'db') { r.skip++; r.invalid = (r.invalid || 0) + 1; return; }
    if (!cases.has(d.text)) cases.set(d.text, bytes.slice(0, d.len));
  };
  const PFX = [[], [0x26], [0x2E], [0x36], [0x3E], [0xF0], [0xF3], [0xF2], [0xF1], [0x26, 0x2E], [0xF0, 0xF3], [0x3E, 0xF2]];
  for (let op = 0; op < 256; op++) {
    for (let b = 0; b < 256; b++) {
      const tail = [b, rnd(), rnd(), rnd(), rnd()];
      add([op, ...tail]);
      if (b % 17 === 0) for (const p of PFX) add([...p, op, ...tail]);
    }
    for (const t of [[0, 0, 0, 0, 0], [0xFF, 0xFF, 0xFF, 0xFF, 0xFF], [0x80, 0, 0x80, 0, 0], [0x7F, 0xFF, 0x7F, 0, 0], [1, 1, 1, 1, 1]]) {
      for (const b of [0x06, 0x46, 0x86, 0x3E, 0x7E, 0xBE, 0x00, 0x40, 0x80, 0xC0]) add([op, b, ...t]);
      add([op, ...t]);
    }
  }
  if (cpu === '286') for (let b2 = 0; b2 < 8; b2++) for (let m = 0; m < 256; m++) add([0x0F, b2, m, rnd(), rnd(), rnd()]);
  let exact = 0;
  let equiv = 0;
  const texts = [...cases.keys()];
  for (const text of texts) {
    const orig = cases.get(text);
    const a = Asm86.assemble(text, { origin: OFF, cpu });
    if (!a.ok) { check(r, false, `Asm86 rejects '${text}' (${hex(orig)}): ${a.errors[0].msg}`); continue; }
    const got = Array.from(a.bytes);
    if (hex(got) === hex(orig)) { exact++; r.pass++; continue; }
    const back = Disasm86.decode((i) => got[i] ?? 0, OFF, dopt);
    if (back.text === text && back.len === got.length) { equiv++; r.pass++; continue; }
    // 87 C0 "xchg ax, ax": NASM (and Asm86) encode it as 90, which is "nop"
    if (text === 'xchg ax, ax' && back.text === 'nop') { equiv++; r.pass++; continue; }
    // a prefix before 9B: NASM (and Asm86) treat "wait" as a prefix and put it first
    if (/ wait$/.test(text) && got[0] === 0x9B) { equiv++; r.pass++; continue; }
    check(r, false, `'${text}' ${hex(orig)} -> ${hex(got)} -> '${back.text}'`);
  }
  r.notes.push(`${texts.length} distinct instructions: ${exact} exact, ${equiv} equivalent (alias or non-minimal encoding), ${r.invalid} invalid byte sequences skipped`);
  if (!NASM) return;
  // NASM must produce the same bytes. Relative targets become "$+d" so that
  // all lines can be in one source file. NASM spells loadall/fnsetpm as loadall286/fsetpm.
  const JMP = /\b((?:j\w+|loop\w*|call)(?: short| near)?) 0x([0-9A-F]{4})$/;
  const lines = texts.map((t) => t.replace(JMP, (_, j, target) => {
    let d = (parseInt(target, 16) - OFF) & 0xFFFF;
    if (d >= 0x8000) d -= 0x10000;
    return `${j} $${d < 0 ? '-' : '+'}${Math.abs(d)}`;
  }).replace(/\bloadall$/, 'loadall286').replace(/\bfnsetpm$/, 'fsetpm'));
  const sub = { name: r.name, pass: 0, fail: 0, skip: 0 };
  compareWithNasm(sub, [`cpu ${cpu}`, ...lines], { dropRejected: true, label: 'NASM: ', cpu });
  r.pass += sub.pass; r.fail += sub.fail; r.skip += sub.skip;
  const rej = sub.nasmRejected || [];
  const kinds = [...new Set(rej.map((t) => t.split(' ')[0]))];
  r.notes.push(`NASM agrees on ${sub.pass - 1} lines; NASM rejects ${rej.length} (cpu ${cpu}): ${kinds.join(', ')}`);
  // expected: ffreep (not in NASM's 8086/286 set) and repne before jmp/call/ret ("repne prefix is not allowed")
  for (const t of rej) check(r, /^ffreep|^repne .*\b(j\w+|call|ret\w*|loop\w*)\b/.test(t), `NASM rejected an unexpected instruction: ${t}`);
}
section('round trip 8086: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip(r, '8086'));
section('round trip 286: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip(r, '286'));

// Round trip for the 80386 (bits 16 and bits 32): all one-byte opcodes with many
// ModR/M bytes (also with 66h / 67h / 64h / 65h and other prefixes), all 0F xx
// opcodes, and every SIB byte with each mod. Relative targets become "$+d" for NASM.
const PREFIX_BYTES = new Set([0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65, 0x66, 0x67, 0xF0, 0xF2, 0xF3]);
function roundTrip386(r, bits, cpu = '386') {
  const OFF = 0x1000;
  const dopt = { cpu, bits };
  const cases = new Map();
  const rnd = () => Math.floor(rand() * 256);
  let invalid = 0;
  const add = (bytes) => {
    const d = Disasm86.decode((i) => bytes[i] ?? 0, OFF, dopt);
    if (d.mnem === 'db') { r.skip++; invalid++; return; }
    if (!cases.has(d.text)) cases.set(d.text, bytes.slice(0, d.len));
  };
  const tail = (b) => [b, ...Array.from({ length: 10 }, rnd)];
  const PFX = [[0x66], [0x67], [0x66, 0x67], [0x64], [0x65, 0x66], [0xF3], [0xF3, 0x67], [0xF0, 0x66],
    [0x26, 0x67], [0x2E, 0x66, 0x67], [0xF2], [0x66, 0x66], [0x3E, 0x64]];
  for (let op = 0; op < 256; op++) {
    for (let b = 0; b < 256; b++) {
      const t = tail(b);
      add([op, ...t]);
      if (b % 7 === 0) for (const p of PFX) add([...p, op, ...t]);
    }
  }
  for (let b2 = 0; b2 < 256; b2++) {
    for (let m = 0; m < 256; m++) {
      const t = tail(m);
      add([0x0F, b2, ...t]);
      if (m % 11 === 0) for (const p of PFX) add([...p, 0x0F, b2, ...t]);
    }
  }
  const a32 = bits === 32 ? [] : [0x67];
  for (const mod of [0, 1, 2]) {
    for (let sib = 0; sib < 256; sib++) {
      add([...a32, 0x8B, (mod << 6) | (sib & 0x38) | 4, sib, rnd(), rnd(), rnd(), rnd()]);
      add([...a32, 0xC7, (mod << 6) | 4, sib, rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()]);
    }
  }
  let exact = 0;
  let equiv = 0;
  const texts = [...cases.keys()];
  for (const text of texts) {
    const orig = cases.get(text);
    const a = Asm86.assemble(text, { origin: OFF, cpu, bits });
    if (!a.ok) { check(r, false, `Asm86 rejects '${text}' (${hex(orig)}): ${a.errors[0].msg}`); continue; }
    const got = Array.from(a.bytes);
    if (hex(got) === hex(orig)) { exact++; r.pass++; continue; }
    const back = Disasm86.decode((i) => got[i] ?? 0, OFF, dopt);
    if (back.text === text && back.len === got.length) { equiv++; r.pass++; continue; }
    // 87 C0 "xchg (e)ax, (e)ax": NASM (and Asm86) encode it as 90, which is "nop"
    if (/^xchg (e?ax), \1$/.test(text) && back.text === 'nop') { equiv++; r.pass++; continue; }
    // a prefix before 9B: NASM (and Asm86) treat "wait" as a prefix and put it first
    if (/ wait$/.test(text) && got[0] === 0x9B) { equiv++; r.pass++; continue; }
    // a relative jump with repeated prefixes: fewer prefix bytes move the end of the
    // instruction, so a short jump can become near. The target must not change.
    const npfx = (b) => { let k = 0; while (PREFIX_BYTES.has(b[k])) k++; return k; };
    const tgt = (s) => { const m = /0x([0-9A-F]+)(, e?cx)?$/.exec(s); return m ? parseInt(m[1], 16) : NaN; };
    const mnem = Disasm86.decode((i) => orig[i] ?? 0, OFF, dopt).mnem;
    if (npfx(orig) > npfx(got) && back.mnem === mnem && tgt(back.text) === tgt(text)) { equiv++; r.pass++; continue; }
    check(r, false, `'${text}' ${hex(orig)} -> ${hex(got)} -> '${back.text}'`);
  }
  r.notes.push(`${texts.length} distinct instructions: ${exact} exact, ${equiv} equivalent (alias, non-minimal encoding or repeated prefix), ${invalid} invalid byte sequences skipped`);
  if (!NASM) return;
  const JMP = /\b((?:j\w+|loop\w*|call)(?: short| near)?(?: dword| word)?) 0x([0-9A-F]{4}|[0-9A-F]{8})(, e?cx)?$/;
  const lines = texts.map((t) => t.replace(JMP, (_, j, target, cnt) => {
    let d = parseInt(target, 16) - OFF;
    d = target.length === 8 ? d | 0 : ((d & 0xFFFF) << 16) >> 16;
    return `${j} $${d < 0 ? '-' : '+'}${Math.abs(d)}${cnt || ''}`;
  }).replace(/\bfnsetpm$/, 'fsetpm'));
  const sub = { name: r.name, pass: 0, fail: 0, skip: 0 };
  compareWithNasm(sub, ['cpu ' + cpu, 'bits ' + bits, ...lines], { dropRejected: true, label: 'NASM: ', cpu, nasmCpu: cpu === '486' ? '586' : '' });
  r.pass += sub.pass; r.fail += sub.fail; r.skip += sub.skip;
  const rej = sub.nasmRejected || [];
  const kinds = [...new Set(rej.map((t) => t.split(' ')[0]))];
  r.notes.push(`NASM agrees on ${sub.pass - 2} lines; NASM rejects ${rej.length} (cpu ${cpu}, bits ${bits}): ${kinds.join(', ')}`);
  for (const t of rej) check(r, /^ffreep|^repne .*\b(j\w+|call|ret\w*|loop\w*)\b/.test(t), `NASM rejected an unexpected instruction: ${t}`);
}
section('round trip 386, bits 16: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip386(r, 16));
section('round trip 386, bits 32: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip386(r, 32));

// ndisasm on a random byte stream: same length and same mnemonic.
// ndisasm -b16 knows 186/286 (and newer) opcodes; with cpu '8086' those are skipped.
function ndisasmCheck(r, cpu) {
  const is286 = cpu === '286';
  const N = 1 << 17;
  const buf = Buffer.alloc(N);
  for (let i = 0; i < N; i++) {
    // bias toward FPU (and for the 286 toward 0F) opcodes
    const x = rand();
    buf[i] = x < 0.15 ? 0xD8 + Math.floor(rand() * 8) : is286 && x < 0.2 ? 0x0F : Math.floor(rand() * 256);
  }
  const f = path.join(TMP, 'r.bin');
  fs.writeFileSync(f, buf);
  const out = execFileSync(NDISASM, ['-b16', f], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = [];
  for (const l of out.split(/\r?\n/)) {
    const m = /^([0-9A-F]{8})\s+([0-9A-F]+)\s+(.*)$/.exec(l);
    if (m) lines.push({ off: parseInt(m[1], 16), hex: m[2], text: m[3] });
    else if (/^\s+-([0-9A-F]+)$/.test(l)) lines[lines.length - 1].hex += l.trim().slice(1);
  }
  // opcodes where ndisasm decodes newer instructions (or prefixes) than the cpu
  const NEWER = new Set([0x64, 0x65, 0x66, 0x67]);
  if (!is286) {
    for (const k of [0x0F, 0xC0, 0xC1, 0xC8, 0xC9, 0xD6, 0xF1]) NEWER.add(k);
    for (let k = 0x60; k < 0x70; k++) NEWER.add(k);
  }
  const PREF = new Set([0x26, 0x2E, 0x36, 0x3E, 0xF0, 0xF2, 0xF3]);
  const PREFW = new Set(['bnd', 'xacquire', 'xrelease', 'rep', 'repe', 'repne', 'lock', 'es', 'cs', 'ss', 'ds', 'o16', 'o32', 'a16', 'a32']);
  const ALIAS = { syscall: 'loadall', sal: 'shl', pause: 'nop', loadall286: 'loadall', fsetpm: 'fnsetpm', pushaw: 'pusha', popaw: 'popa' };
  const skipWhy = {};
  const skip = (why) => { r.skip++; skipWhy[why] = (skipWhy[why] || 0) + 1; };
  const dopt = { cpu };
  for (const L of lines) {
    const bytes = Buffer.from(L.hex, 'hex');
    let p = 0;
    while (p < bytes.length - 1 && PREF.has(bytes[p])) p++;
    const op = bytes[p];
    const b1 = buf[(L.off + p + 1) % N];
    const mine = Disasm86.decode((i) => buf[(L.off + i) % N], L.off, dopt);
    const theirs = L.text.split(/[ ,]+/).filter((w) => !PREFW.has(w));
    const tm = theirs[0] || '';
    if (!tm) { skip('ndisasm shows a prefix alone'); continue; }
    if (bytes.slice(0, p + 1).some((b) => NEWER.has(b)) || !is286 && (op === 0x8C || op === 0x8E) && ((b1 >> 3) & 7) > 3 ||
      (op === 0xC4 || op === 0xC5) && b1 >= 0xC0) { skip('newer opcode (or VEX) in ndisasm'); continue; }
    if (op === 0x9B) { skip('ndisasm joins wait with the next instruction'); continue; }
    if (mine.mnem === 'db' || tm === 'db') {
      const fpu = op >= 0xD8 && op <= 0xDF;
      // Disasm86 says db, ndisasm decodes: only newer (287+/386+) encodings are expected
      if (mine.mnem === 'db' && tm !== 'db') {
        const newer = fpu || is286 && (op === 0x0F || op === 0xD6 || op === 0xF1 || op === 0x8C || op === 0x8E || op === 0x62);
        check(r, newer, `${L.hex} ndisasm '${L.text}' Disasm86 '${mine.text}'`);
      }
      // ndisasm says db, Disasm86 decodes: only undocumented aliases (or the cut last line)
      if (tm === 'db' && mine.mnem !== 'db') {
        const alias = fpu || op === 0x82 || ((op & 0xFE) === 0xF6 && ((b1 >> 3) & 7) === 1);
        check(r, alias || L.off + mine.len > N, `${L.hex} ndisasm '${L.text}' Disasm86 '${mine.text}'`);
      }
      skip(mine.mnem === 'db' ? 'invalid on this cpu (newer in ndisasm)' : 'undocumented alias (db in ndisasm)');
      continue;
    }
    const their = ALIAS[tm] || tm;
    // undocumented 8087 aliases: ndisasm names them (fcom2 ...) or decodes them as 287+ forms
    if (op >= 0xD8 && op <= 0xDF && b1 >= 0xC0 && ['fcom', 'fcomp', 'fxch', 'fstp', 'ffreep'].includes(mine.mnem) && their !== mine.mnem) {
      skip('undocumented 8087 alias'); continue;
    }
    check(r, mine.len === bytes.length && mine.mnem === their,
      `${L.off.toString(16)}: ${L.hex} ndisasm '${L.text}' (${bytes.length}) Disasm86 '${mine.text}' (${mine.len})`);
  }
  r.notes.push(`${lines.length} ndisasm lines; skips: ` + Object.entries(skipWhy).map(([k, v]) => `${k} ${v}`).join('; '));
}
if (NASM) {
  section('ndisasm agreement on random bytes (8086)', (r) => ndisasmCheck(r, '8086'));
  section('ndisasm agreement on random bytes (286)', (r) => ndisasmCheck(r, '286'));
}

// ndisasm -b16 / -b32 on random 80386 code: same length, same mnemonic, and the
// same text after cosmetic differences are removed (spaces, size keywords, short /
// near, number format, a zero displacement, "*1", nosplit, prefixes that have no effect).
function ndisasm386(r, bits, cpu = '386') {
  const N = 1 << 17;
  const buf = Buffer.alloc(N);
  const PF = [0x66, 0x67, 0x64, 0x65];
  for (let i = 0; i < N; i++) {
    // bias toward FPU opcodes, 0F xx and the 80386 prefixes
    const x = rand();
    buf[i] = x < 0.1 ? 0xD8 + Math.floor(rand() * 8) : x < 0.25 ? 0x0F : x < 0.33 ? PF[Math.floor(rand() * 4)] : Math.floor(rand() * 256);
  }
  const f = path.join(TMP, 'r.bin');
  fs.writeFileSync(f, buf);
  const out = execFileSync(NDISASM, [`-b${bits}`, f], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = [];
  for (const l of out.split(/\r?\n/)) {
    const m = /^([0-9A-F]{8})\s+([0-9A-F]+)\s+(.*)$/.exec(l);
    if (m) lines.push({ off: parseInt(m[1], 16), hex: m[2], text: m[3] });
    else if (/^\s+-([0-9A-F]+)$/.test(l)) lines[lines.length - 1].hex += l.trim().slice(1);
  }
  const dopt = { cpu, bits };
  const PREFW = new Set(['rep', 'repe', 'repne', 'lock', 'es', 'cs', 'ss', 'ds', 'fs', 'gs', 'o16', 'o32', 'a16', 'a32',
    'bnd', 'xacquire', 'xrelease']);
  const ALIAS = { sal: 'shl', retd: 'ret', retw: 'ret', retnd: 'ret', retnw: 'ret', retfd: 'retf', retfw: 'retf', fsetpm: 'fnsetpm' };
  // the words of an instruction without the prefixes in front
  const words = (t) => { const w = t.split(/[ ,]+/); while (w.length > 1 && PREFW.has(w[0])) w.shift(); return w; };
  const norm = (t) => {
    const w = words(t.toLowerCase());
    w[0] = ALIAS[w[0]] || w[0];
    let s = w.join(' ')
      .replace(/\b(byte|word|dword|qword|tword|short|near|nosplit|to)\b ?/g, '')
      .replace(/\*1\b/g, '')
      .replace(/[+-]0x0+\]/g, ']')
      .replace(/[+-]?\b(0x[0-9a-f]+|\d+)\b/g, '#')
      .replace(/([a-z])#\]/g, '$1]')
      .replace(/ +/g, ' ').trim();
    // FPU: "fadd st0, st1" = "fadd st1"; xchg: the order of the operands has no effect
    s = s.replace(/^(f\w+) st0 (st\d)$/, '$1 $2').replace(/^(f\w+) (st\d) st0$/, '$1 $2');
    const x = /^xchg (\S+) (\S+)$/.exec(s);
    return x ? 'xchg ' + [x[1], x[2]].sort().join(' ') : s;
  };
  const all = lines.map((L) => ({ L, bytes: Buffer.from(L.hex, 'hex'), mine: Disasm86.decode((i) => buf[(L.off + i) % N], L.off, dopt) }));
  // the mnemonics that Disasm86 knows for this cpu; other ndisasm mnemonics are newer instructions
  const known = new Set(all.map((x) => x.mine.mnem));
  const skipWhy = {};
  const skip = (why) => { r.skip++; skipWhy[why] = (skipWhy[why] || 0) + 1; };
  let textSame = 0;
  for (const { L, bytes, mine } of all) {
    let p = 0;
    while (p < bytes.length - 1 && PREFIX_BYTES.has(bytes[p])) p++;
    const op = bytes[p];
    const b1 = buf[(L.off + p + 1) % N];
    const b2 = buf[(L.off + p + 2) % N];
    const tw = words(L.text);
    const tm = PREFW.has(tw[0]) ? '' : ALIAS[tw[0]] || tw[0] || '';
    if (!tm) { skip('ndisasm shows a prefix alone'); continue; }
    if (L.off + mine.len > N) { skip('the last line'); continue; }
    if (op === 0x9B) { skip('ndisasm joins wait with the next instruction'); continue; }
    if ((op === 0xC4 || op === 0xC5 || op === 0x62) && b1 >= 0xC0) { skip('VEX / EVEX in ndisasm'); continue; }
    if (tm !== 'db' && !known.has(tm)) { skip('newer instruction in ndisasm'); continue; }
    const fpu = op >= 0xD8 && op <= 0xDF;
    if (mine.mnem === 'db' || tm === 'db') {
      if (mine.mnem === 'db' && tm !== 'db') {
        // Disasm86 says db, ndisasm decodes: registers that the 80386 does not have (cr1, cr4-7,
        // sreg 6-7), 287+ FPU forms, 8F /1-7 (XOP in ndisasm), 0F 18-1F (hint nop, P6)
        // (486: also 0F A6 / A7, the cmpxchg of the first 486 steps, and bswap with a 16-bit operand size)
        // 0F 10-17 (SSE)
        const ok = fpu || op === 0x8C || op === 0x8E || op === 0x8F || (op === 0x0F && b1 >= 0x10 && b1 <= 0x26) ||
          (cpu === '486' && op === 0x0F && (b1 === 0xA6 || b1 === 0xA7 || (b1 >= 0xC8 && b1 <= 0xCF)));
        check(r, ok, `${L.hex} ndisasm '${L.text}' Disasm86 '${mine.text}'`);
        skip('not an 80386 instruction (ndisasm decodes it)');
      } else if (tm === 'db' && mine.mnem !== 'db') {
        // ndisasm says db, Disasm86 decodes: undocumented aliases, mov crN/drN with mod < 3,
        // mov trN (ndisasm does not know the test registers)
        const ok = fpu || op === 0x82 || ((op & 0xFE) === 0xF6 && ((b1 >> 3) & 7) === 1) ||
          (op === 0x0F && b1 >= 0x20 && b1 <= 0x23 && b2 < 0xC0) || (op === 0x0F && (b1 === 0x24 || b1 === 0x26)) ||
          (op === 0x0F && b1 >= 0x90 && b1 <= 0x9F);
        check(r, ok, `${L.hex} ndisasm '${L.text}' Disasm86 '${mine.text}'`);
        skip('undocumented alias (db in ndisasm)');
      } else skip('db in both');
      continue;
    }
    if (fpu && b1 >= 0xC0 && ['fcom', 'fcomp', 'fxch', 'fstp', 'ffreep'].includes(mine.mnem) && tm !== mine.mnem) {
      skip('undocumented 8087 alias'); continue;
    }
    // lock mov crN: ndisasm shows the AMD alias cr(N+8); the 386 and 486 give #UD
    if (op === 0x0F && b1 >= 0x20 && b1 <= 0x23 && bytes.slice(0, p).includes(0xF0)) { skip('lock mov crN (crN+8 in ndisasm)'); continue; }
    // ndisasm shows 67 90 as "xchg ax, ax" (the address size has no effect on nop)
    if (op === 0x90 && mine.mnem === 'nop' && tm === 'xchg' && tw[1] === tw[2]) { skip('67 90 is xchg in ndisasm'); continue; }
    check(r, mine.len === bytes.length && mine.mnem === tm,
      `${bits}:${L.off.toString(16)}: ${L.hex} ndisasm '${L.text}' (${bytes.length}) Disasm86 '${mine.text}' (${mine.len})`);
    const a = norm(L.text);
    const b = norm(mine.text);
    if (a === b) textSame++;
    else check(r, false, `text ${bits}: ${L.hex} ndisasm '${L.text}' [${a}] Disasm86 '${mine.text}' [${b}]`);
  }
  r.notes.push(`${lines.length} ndisasm lines, ${textSame} with the same text; skips: ` + Object.entries(skipWhy).map(([k, v]) => `${k} ${v}`).join('; '));
}
if (NASM) {
  section('ndisasm agreement on random bytes (386, bits 16)', (r) => ndisasm386(r, 16));
  section('ndisasm agreement on random bytes (386, bits 32)', (r) => ndisasm386(r, 32));
}
// 80486 (after the other sections: they keep their random bytes)
section('round trip 486, bits 16: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip386(r, 16, '486'));
section('round trip 486, bits 32: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip386(r, 32, '486'));
if (NASM) {
  section('ndisasm agreement on random bytes (486, bits 16)', (r) => ndisasm386(r, 16, '486'));
  section('ndisasm agreement on random bytes (486, bits 32)', (r) => ndisasm386(r, 32, '486'));
}
// Pentium
section('round trip 586, bits 16: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip386(r, 16, '586'));
section('round trip 586, bits 32: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip386(r, 32, '586'));
if (NASM) {
  section('ndisasm agreement on random bytes (586, bits 16)', (r) => ndisasm386(r, 16, '586'));
  section('ndisasm agreement on random bytes (586, bits 32)', (r) => ndisasm386(r, 32, '586'));
}

// Pentium Pro
section('round trip 686, bits 16: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip386(r, 16, '686'));
section('round trip 686, bits 32: Disasm86 -> Asm86 (-> NASM)', (r) => roundTrip386(r, 32, '686'));
if (NASM) {
  section('ndisasm agreement on random bytes (686, bits 16)', (r) => ndisasm386(r, 16, '686'));
  section('ndisasm agreement on random bytes (686, bits 32)', (r) => ndisasm386(r, 32, '686'));
}

// specific Disasm86 output text
section('Disasm86 text', (r) => {
  const cases = [
    ['8B4710', 'mov ax, [bx+0x10]'], ['268B4702', 'mov ax, [es:bx+0x2]'], ['8B47F0', 'mov ax, [bx-0x10]'],
    ['8B4600', 'mov ax, [bp]'], ['A13412', 'mov ax, [0x1234]'], ['2EA21000', 'mov [cs:0x10], al'],
    ['83C3FB', 'add bx, 0xFFFB'], ['80C380', 'add bl, 0x80'], ['C7070500', 'mov word [bx], 0x5'],
    ['EBFE', 'jmp short 0x0100'], ['E9FDFF', 'jmp near 0x0100'], ['74FE', 'jz 0x0100'], ['64FE', 'jz 0x0100'],
    ['E80000', 'call 0x0103'], ['EA78563412', 'jmp 0x1234:0x5678'], ['FF1F', 'call far [bx]'], ['FF27', 'jmp [bx]'],
    ['F3A4', 'rep movsb'], ['F3A6', 'repe cmpsb'], ['F2AE', 'repne scasb'], ['26A4', 'es movsb'], ['F0F3A4', 'rep lock movsb'],
    ['F1FF07', 'lock inc word [bx]'], ['0F', 'pop cs'], ['D6', 'salc'], ['C00400', 'ret 0x4'], ['C1', 'ret'],
    ['C80800', 'retf 0x8'], ['C9', 'retf'], ['8EE0', 'mov es, ax'], ['8CF8', 'mov ax, ds'], ['FE38', 'db 0xFE, 0x38'],
    ['FFFF', 'db 0xFF, 0xFF'], ['FF1F', 'call far [bx]'], ['FF18', 'call far [bx+si]'], ['9B', 'wait'], ['D40A', 'aam'], ['D410', 'aam 0x10'],
    ['CC', 'int3'], ['CD03', 'int 0x3'], ['D0E0', 'shl al, 1'], ['D3F8', 'sar ax, cl'], ['F6C105', 'test cl, 0x5'],
    ['F6C905', 'test cl, 0x5'], ['91', 'xchg ax, cx'], ['90', 'nop'], ['D7', 'xlatb'], ['E443', 'in al, 0x43'],
    ['EE', 'out dx, al'], ['DD07', 'fld qword [bx]'], ['DB2F', 'fld tword [bx]'], ['DF27', 'fbld tword [bx]'],
    ['DE07', 'fiadd word [bx]'], ['D8C1', 'fadd st0, st1'], ['DCC1', 'fadd st1, st0'], ['DEE9', 'fsubp st1, st0'],
    ['DCE9', 'fsub st1, st0'], ['DED9', 'fcompp'], ['D9C9', 'fxch st1'], ['DDC9', 'fxch st1'], ['D9D9', 'fstp st1'],
    ['DBE3', 'fninit'], ['D93F', 'fnstcw word [bx]'], ['DD3F', 'fnstsw word [bx]'], ['D927', 'fldenv [bx]'],
    ['D9EE', 'fldz'], ['D9FA', 'fsqrt'], ['DFC1', 'ffreep st1'], ['DBE4', 'db 0xDB, 0xE4'], ['DA0F', 'fimul dword [bx]'],
    ['D90F', 'db 0xD9, 0x0F'], ['26268B07', 'mov ax, [es:bx]'], ['262E8B07', 'mov ax, [cs:bx]'], ['2690', 'es nop'],
    ['8D07', 'lea ax, [bx]'], ['8DC0', 'db 0x8D, 0xC0'], ['C41C', 'les bx, [si]'], ['8F06FFFF', 'pop word [0xFFFF]'],
    ['8F4000', 'pop word [bx+si]'], ['8FC8', 'db 0x8F, 0xC8'], ['C6C8', 'db 0xC6, 0xC8'], ['D0F0', 'db 0xD0, 0xF0'],
    ['82C305', 'add bl, 0x5'], ['FF360000', 'push word [0x0]'],
  ];
  for (const [h, want] of cases) {
    const b = Buffer.from(h, 'hex');
    const d = Disasm86.decode((i) => b[i] ?? 0, 0x100);
    check(r, d.text === want && d.len === b.length, `${h}: '${d.text}' (${d.len}) expected '${want}' (${b.length})`);
  }
  // prefix bytes only: stops after 15 prefixes
  const d = Disasm86.decode(() => 0x26, 0);
  check(r, d.len === 1 && d.text === 'db 0x26', 'prefix run limit ' + JSON.stringify(d));
  // offset wrap for relative jumps
  const w = Disasm86.decode((i) => [0xEB, 0x10][i], 0xFFF0);
  check(r, w.text === 'jmp short 0x0002', 'jump target wraps: ' + w.text);
  // cpu '286'
  const c286 = [
    ['60', 'pusha'], ['61', 'popa'], ['6205', 'bound ax, [di]'], ['62C0', 'db 0x62, 0xC0'], ['63D8', 'arpl ax, bx'],
    ['6A05', 'push 0x5'], ['6AFB', 'push 0xFFFB'], ['683412', 'push 0x1234'], ['6BC305', 'imul ax, bx, 0x5'],
    ['690F3412', 'imul cx, [bx], 0x1234'], ['F36C', 'rep insb'], ['6D', 'insw'], ['266E', 'es outsb'], ['6F', 'outsw'],
    ['C1E003', 'shl ax, 0x3'], ['C02701', 'shl byte [bx], 1'], ['C0F0', 'db 0xC0, 0xF0'], ['C8080001', 'enter 0x8, 0x1'],
    ['C9', 'leave'], ['0F00C0', 'sldt ax'], ['0F0007', 'sldt [bx]'],
    ['0F00C8', 'str ax'], ['0F0017', 'lldt [bx]'], ['0F00D8', 'ltr ax'], ['0F00E0', 'verr ax'], ['0F002F', 'verw [bx]'],
    ['0F00F0', 'db 0x0F, 0x00, 0xF0'], ['0F0107', 'sgdt [bx]'], ['0F010F', 'sidt [bx]'], ['0F0117', 'lgdt [bx]'],
    ['0F011F', 'lidt [bx]'], ['0F01D0', 'db 0x0F, 0x01, 0xD0'], ['0F01E0', 'smsw ax'], ['0F0127', 'smsw [bx]'],
    ['0F01F0', 'lmsw ax'], ['0F01E8', 'db 0x0F, 0x01, 0xE8'], ['0F02C3', 'lar ax, bx'], ['0F0307', 'lsl ax, [bx]'],
    ['0F05', 'loadall'], ['0F06', 'clts'], ['0F07', 'db 0x0F, 0x07'], ['0F84', 'db 0x0F, 0x84'], ['DFE0', 'fnstsw ax'],
    ['DBE4', 'fnsetpm'], ['D6', 'db 0xD6'], ['F1', 'db 0xF1'], ['64', 'db 0x64'], ['66', 'db 0x66'], ['8EE0', 'db 0x8E, 0xE0'],
    ['8EC8', 'db 0x8E, 0xC8'], ['8CC8', 'mov ax, cs'], ['8ED8', 'mov ds, ax'],
  ];
  for (const [h, want] of c286) {
    const b = Buffer.from(h, 'hex');
    const d = Disasm86.decode((i) => b[i] ?? 0, 0x100, { cpu: '286' });
    check(r, d.text === want && d.len === b.length, `286 ${h}: '${d.text}' (${d.len}) expected '${want}' (${b.length})`);
  }
  // cpu '386', bits 16 (the default) and bits 32
  const c386 = {
    16: [
      ['66B878563412', 'mov eax, 0x12345678'], ['6689D8', 'mov eax, ebx'], ['678B0424', 'mov ax, [esp]'],
      ['66678B448D10', 'mov eax, [ebp+ecx*4+0x10]'], ['678B04C500000000', 'mov ax, [eax*8]'],
      ['678B044500000000', 'mov ax, [nosplit eax*2]'], ['678B040500010000', 'mov ax, [nosplit eax*1+0x100]'],
      ['678B0510000000', 'mov ax, [dword 0x10]'], ['67A010000000', 'mov al, [dword 0x10]'], ['64A01000', 'mov al, [fs:0x10]'],
      ['65678A44CBFC', 'mov al, [gs:ebx+ecx*8-0x4]'], ['670FB607', 'movzx ax, byte [edi]'], ['0FB6C3', 'movzx ax, bl'],
      ['660FB707', 'movzx eax, word [bx]'], ['0FB7C3', 'db 0x0F, 0xB7, 0xC3'], ['0FBE07', 'movsx ax, byte [bx]'],
      ['0FA307', 'bt [bx], ax'], ['0FBA2705', 'bt word [bx], 0x5'], ['660FBAE01F', 'bt eax, 0x1F'], ['0FBA07', 'db 0x0F, 0xBA, 0x07'],
      ['0FA40705', 'shld [bx], ax, 0x5'], ['0FADD8', 'shrd ax, bx, cl'], ['0F9407', 'setz [bx]'], ['0F94C0', 'setz al'],
      ['0F92C3', 'setc bl'], ['0F20C0', 'mov eax, cr0'], ['0F22D8', 'mov cr3, eax'], ['0F21F8', 'mov eax, dr7'],
      ['0F26F0', 'mov tr6, eax'], ['0F20C8', 'db 0x0F, 0x20, 0xC8'], ['0F2420', 'db 0x0F, 0x24, 0x20'],
      ['0F8400F0', 'jz near 0xF104'], ['660F8400000000', 'jz near dword 0x00000107'], ['66E800000000', 'call dword 0x00000106'],
      ['66E9FAFFFFFF', 'jmp near dword 0x00000100'], ['66EA785634120800', 'jmp dword 0x0008:0x12345678'],
      ['66FF1F', 'call dword far [bx]'], ['66FF27', 'jmp dword [bx]'], ['66FFE0', 'jmp eax'], ['6660', 'pushad'],
      ['669C', 'pushfd'], ['66CF', 'iretd'], ['6698', 'cwde'], ['6699', 'cdq'], ['66A5', 'movsd'], ['F366AB', 'rep stosd'],
      ['67A4', 'a32 movsb'], ['66C3', 'o32 ret'], ['6606', 'o32 push es'], ['0FA0', 'push fs'], ['0FA9', 'pop gs'],
      ['666878563412', 'push dword 0x12345678'], ['666AFB', 'push dword 0xFFFFFFFB'], ['6683C0FB', 'add eax, 0xFFFFFFFB'],
      ['6690', 'xchg eax, eax'], ['67E2FE', 'loop 0x0101, ecx'], ['67E3FE', 'jecxz 0x0101'], ['668CD8', 'mov eax, ds'],
      ['668ED8', 'o32 mov ds, eax'], ['8EE0', 'mov fs, ax'], ['8EF0', 'db 0x8E, 0xF0'], ['660F00C0', 'sldt eax'],
      ['660F0117', 'o32 lgdt [bx]'], ['660F02C3', 'lar eax, bx'], ['0FB207', 'lss ax, [bx]'], ['660FB407', 'lfs eax, [bx]'],
      ['0FAFC3', 'imul ax, bx'], ['666BC005', 'imul eax, eax, 0x5'], ['D9FE', 'fsin'], ['DAE9', 'fucompp'], ['DDE1', 'fucom st1'],
      ['DDE9', 'fucomp st1'], ['66D933', 'o32 fnstenv [bp+di]'], ['0F05', 'db 0x0F, 0x05'], ['F1', 'db 0xF1'], ['D6', 'db 0xD6'],
      ['0FB0', 'db 0x0F, 0xB0'], ['6667F3A5', 'rep a32 movsd'], ['67F3A5', 'rep a32 movsw'], ['2667F0FF00', 'lock inc word [es:eax]'],
    ],
    32: [
      ['B878563412', 'mov eax, 0x12345678'], ['66B83412', 'mov ax, 0x1234'], ['8B0424', 'mov eax, [esp]'], ['8B4500', 'mov eax, [ebp]'],
      ['678B07', 'mov eax, [bx]'], ['67A11000', 'mov eax, [word 0x10]'], ['A110000000', 'mov eax, [0x10]'],
      ['E800000000', 'call 0x00000105'], ['0F8400000000', 'jz near 0x00000106'], ['660F840000', 'jz near word 0x0105'],
      ['EBFE', 'jmp short 0x00000100'], ['EA785634120800', 'jmp 0x0008:0x12345678'], ['66EA78560800', 'jmp word 0x0008:0x5678'],
      ['FF1F', 'call far [edi]'], ['66FF1F', 'call word far [edi]'], ['FF20', 'jmp [eax]'], ['66FF20', 'jmp word [eax]'],
      ['60', 'pusha'], ['6660', 'pushaw'], ['9C', 'pushf'], ['CF', 'iret'], ['66CF', 'iretw'], ['98', 'cwde'], ['6698', 'cbw'],
      ['A5', 'movsd'], ['66A5', 'movsw'], ['E2FE', 'loop 0x00000100'], ['67E2FE', 'loop 0x00000101, cx'],
      ['E3FE', 'jecxz 0x00000100'], ['67E3FE', 'jcxz 0x00000101'], ['8ED8', 'mov ds, eax'], ['8CD8', 'mov eax, ds'],
      ['668CD8', 'mov ax, ds'], ['6A05', 'push 0x5'], ['666A05', 'push word 0x5'], ['6805000000', 'push 0x5'],
      ['0FB7C3', 'movzx eax, bx'], ['660FB7C3', 'db 0x66, 0x0F, 0xB7, 0xC3'], ['C3', 'ret'], ['66C3', 'o16 ret'],
      ['0F00C0', 'sldt eax'], ['660F00C0', 'sldt ax'], ['DD03', 'fld qword [ebx]'], ['8B04D500000000', 'mov eax, [edx*8]'],
      ['8B048510000000', 'mov eax, [eax*4+0x10]'], ['8B4485F0', 'mov eax, [ebp+eax*4-0x10]'], ['8B0420', 'mov eax, [eax]'],
      ['8B04E0', 'mov eax, [eax]'], ['8B8000000080', 'mov eax, [eax-0x80000000]'], ['8B0418', 'mov eax, [eax+ebx]'],
      ['8B0403', 'mov eax, [ebx+eax]'], ['8B04AD00000000', 'mov eax, [ebp*4]'], ['8B442D00', 'mov eax, [ebp+ebp]'],
    ],
  };
  for (const bits of [16, 32]) {
    for (const [h, want] of c386[bits]) {
      const b = Buffer.from(h, 'hex');
      const d = Disasm86.decode((i) => b[i] ?? 0, 0x100, bits === 16 ? { cpu: '386' } : { cpu: '386', bits });
      check(r, d.text === want && d.len === b.length, `386 bits ${bits} ${h}: '${d.text}' (${d.len}) expected '${want}' (${b.length})`);
    }
  }
  // cpu '486'
  const c486 = {
    16: [
      ['660FC8', 'bswap eax'], ['660FCF', 'bswap edi'], ['0FC8', 'db 0x0F, 0xC8'], ['0FC007', 'xadd [bx], al'],
      ['0FC1D8', 'xadd ax, bx'], ['660FC1D8', 'xadd eax, ebx'], ['F00FC107', 'lock xadd [bx], ax'], ['0FB00F', 'cmpxchg [bx], cl'],
      ['67660FB10C24', 'cmpxchg [esp], ecx'], ['0FB1C8', 'cmpxchg ax, cx'],
      ['0F08', 'invd'], ['0F09', 'wbinvd'], ['0FA2', 'cpuid'], ['0F013F', 'invlpg [bx]'], ['0F01F8', 'db 0x0F, 0x01, 0xF8'],
      ['670F0138', 'invlpg [eax]'], ['0F24D8', 'mov eax, tr3'], ['0F26EB', 'mov tr5, ebx'], ['0F24C0', 'db 0x0F, 0x24, 0xC0'],
      ['0FA6', 'db 0x0F, 0xA6'], ['0FC7', 'db 0x0F, 0xC7'], ['0F30', 'db 0x0F, 0x30'],
    ],
    32: [
      ['0FC8', 'bswap eax'], ['660FC8', 'db 0x66, 0x0F, 0xC8'], ['0FC10B', 'xadd [ebx], ecx'], ['660FC10B', 'xadd [ebx], cx'],
      ['0FB00B', 'cmpxchg [ebx], cl'], ['F00FB14DFC', 'lock cmpxchg [ebp-0x4], ecx'], ['0F0138', 'invlpg [eax]'], ['660FA2', 'o16 cpuid'],
    ],
  };
  for (const bits of [16, 32]) {
    for (const [h, want] of c486[bits]) {
      const b = Buffer.from(h, 'hex');
      const d = Disasm86.decode((i) => b[i] ?? 0, 0x100, { cpu: '486', bits });
      check(r, d.text === want && d.len === b.length, '486 bits ' + bits + ' ' + h + ": '" + d.text + "' (" + d.len + ") expected '" + want + "' (" + b.length + ')');
    }
  }
  // cpu '686'
  const c686 = {
    16: [
      ['0F44C3', 'cmovz ax, bx'], ['660F4507', 'cmovnz eax, [bx]'], ['670F404304', 'cmovo ax, [ebx+0x4]'], ['0F4FC8', 'cmovg cx, ax'],
      ['DAC1', 'fcmovb st0, st1'], ['DACA', 'fcmove st0, st2'], ['DAD3', 'fcmovbe st0, st3'], ['DADC', 'fcmovu st0, st4'],
      ['DBC5', 'fcmovnb st0, st5'], ['DBCE', 'fcmovne st0, st6'], ['DBD7', 'fcmovnbe st0, st7'], ['DBD8', 'fcmovnu st0, st0'],
      ['DBF1', 'fcomi st1'], ['DBEB', 'fucomi st3'], ['DFF4', 'fcomip st4'], ['DFED', 'fucomip st5'], ['0F33', 'rdpmc'], ['0F0B', 'ud2'],
      ['DAE9', 'fucompp'], ['DFE0', 'fnstsw ax'], ['DBE3', 'fninit'], ['DFE8', 'fucomip st0'],
    ],
    32: [['0F44C3', 'cmovz eax, ebx'], ['660F44C3', 'cmovz ax, bx'], ['0F4C0C24', 'cmovl ecx, [esp]'], ['DBF7', 'fcomi st7']],
  };
  for (const bits of [16, 32]) {
    for (const [h, want] of c686[bits]) {
      const b = Buffer.from(h, 'hex');
      const d = Disasm86.decode((i) => b[i] ?? 0, 0x100, { cpu: '686', bits });
      check(r, d.text === want && d.len === b.length, '686 bits ' + bits + ' ' + h + ": '" + d.text + "' (" + d.len + ") expected '" + want + "' (" + b.length + ')');
    }
  }
  // the Pentium Pro opcodes stay db with cpu '586'
  for (const h of ['0F44C3', 'DAC1', 'DBC5', 'DBF1', 'DFF4', '0F33', '0F0B']) {
    const b = Buffer.from(h, 'hex');
    const d = Disasm86.decode((i) => b[i] ?? 0, 0x100, { cpu: '586' });
    check(r, d.mnem === 'db', '586 ' + h + ": '" + d.text + "' expected db");
  }
  // the 486 opcodes stay db with cpu '386'
  for (const h of ['660FC8', '0FC007', '0FB00F', '0F08', '0FA2', '0F013F', '0F24D8']) {
    const b = Buffer.from(h, 'hex');
    const d = Disasm86.decode((i) => b[i] ?? 0, 0x100, { cpu: '386' });
    check(r, d.mnem === 'db', '386 ' + h + ": '" + d.text + "' expected db");
  }
  // without the option the 8086 aliases stay
  for (const [h, want] of [['6A05', 'jpe 0x0107'], ['C1', 'ret'], ['0F', 'pop cs'], ['D6', 'salc'], ['DFE0', 'db 0xDF, 0xE0'], ['F1F4', 'lock hlt']]) {
    const b = Buffer.from(h, 'hex');
    const d = Disasm86.decode((i) => b[i] ?? 0, 0x100);
    check(r, d.text === want, `8086 ${h}: '${d.text}' expected '${want}'`);
  }
});

fs.rmSync(TMP, { recursive: true, force: true });
const tot = results.reduce((a, s) => ({ pass: a.pass + s.pass, fail: a.fail + s.fail, skip: a.skip + s.skip }), { pass: 0, fail: 0, skip: 0 });
console.log(`\nTOTAL: ${tot.pass} passed, ${tot.fail} failed, ${tot.skip} skipped`);
process.exit(failures ? 1 : 0);
