// Tests for src/core/fpu8087.js. Run: node tests/fpu.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
vm.runInThisContext(fs.readFileSync(path.join(root, 'src/core/fpu8087.js'), 'utf8'));
const FPU8087 = vm.runInThisContext('FPU8087');
const F80 = vm.runInThisContext('F80');

// ---- harness ----
let pass = 0, fail = 0;
const sections = [];
let cur = null;
function section(name) { cur = { name, pass: 0, fail: 0 }; sections.push(cur); }
function check(cond, msg) {
  if (cond) { pass++; cur.pass++; return true; }
  fail++; cur.fail++;
  if (cur.fail <= 5) console.log(`  FAIL [${cur.name}] ${typeof msg === 'function' ? msg() : msg}`);
  return false;
}
const eq = (a, b, msg) => check(a === b, () => `${msg}: got ${fmt(a)}, expected ${fmt(b)}`);
const fmt = (x) => typeof x === 'bigint' ? '0x' + x.toString(16) : JSON.stringify(x);

// ---- deterministic PRNG ----
let seed = 0x9E3779B97F4A7C15n;
function rnd64() {
  seed ^= seed << 13n; seed &= (1n << 64n) - 1n;
  seed ^= seed >> 7n;
  seed ^= seed << 17n; seed &= (1n << 64n) - 1n;
  return seed;
}
const rndInt = (n) => Number(rnd64() % BigInt(n));
const rndBits = (bits) => rnd64() & ((1n << BigInt(bits)) - 1n);

// ---- machine: 1 MB memory and an FPU ----
const mem = new Uint8Array(1 << 20);
const bus = { read8: (a) => mem[a], write8: (a, v) => { mem[a] = v & 0xFF; } };
const fpu = new FPU8087(bus);
const dv = new DataView(mem.buffer);
const EA = { seg: 0x0010, off: 0x0000 };        // physical 0x100
const EA2 = { seg: 0x0020, off: 0x0000 };       // physical 0x200
const PH = 0x100, PH2 = 0x200;
const M = (reg) => (reg << 3) | 6;              // memory ModRM (mod 00, rm 110)
const R = (reg, i) => 0xC0 | (reg << 3) | i;    // register ModRM
const X = (op, modrm, ea = null) => fpu.exec(op, modrm, ea);

const f64bits = (x) => { dv.setFloat64(0x10, x, true); return dv.getBigUint64(0x10, true); };
const bitsF64 = (b) => { dv.setBigUint64(0x10, b, true); return dv.getFloat64(0x10, true); };
const f32bits = (x) => { dv.setFloat32(0x10, x, true); return dv.getUint32(0x10, true); };
function fld64(x, ea = EA) { dv.setFloat64(ea === EA ? PH : PH2, x, true); X(0xDD, M(0), ea); }
function fld64b(b) { dv.setBigUint64(PH, b, true); X(0xDD, M(0), EA); }
function fstp64b() { X(0xDD, M(3), EA); return dv.getBigUint64(PH, true); }
function fstp64() { X(0xDD, M(3), EA); return dv.getFloat64(PH, true); }
function fld80(v) { F80.toBytes(v).forEach((b, i) => { mem[PH + i] = b; }); X(0xDB, M(5), EA); }
function fstp80() { X(0xDB, M(7), EA); return F80.fromBytes(Array.from(mem.slice(PH, PH + 10))); }
const hex80 = (v) => `${((v.sign << 15) | v.exp).toString(16).toUpperCase().padStart(4, '0')} ${v.mant.toString(16).toUpperCase().padStart(16, '0')}`;
const same80 = (a, b) => a.sign === b.sign && a.exp === b.exp && a.mant === b.mant;
const cc = () => { const s = fpu.sw; return { c0: (s >> 8) & 1, c1: (s >> 9) & 1, c2: (s >> 10) & 1, c3: (s >> 14) & 1 }; };
const ccs = () => { const c = cc(); return `${c.c3}${c.c2}${c.c1}${c.c0}`; };
function init(cw = 0x03FF) { X(0xDB, 0xE3); if (cw !== 0x03FF) { dv.setUint16(0x300, cw, true); X(0xD9, M(5), { seg: 0x30, off: 0 }); } }
const CW_ALL_MASKED = (pc, rc) => 0x103F | (pc << 8) | (rc << 10);  // affine, all masked

// random finite double with a limited exponent range
function rndDouble(emin = -200, emax = 200) {
  const e = emin + rndInt(emax - emin + 1);
  const b = (BigInt(rndInt(2)) << 63n) | (BigInt(e + 1023) << 52n) | rndBits(52);
  return bitsF64(b);
}
function rndFloat32(emin = -30, emax = 30) {
  const e = emin + rndInt(emax - emin + 1);
  dv.setUint32(0x10, (rndInt(2) << 31) | ((e + 127) << 23) | Number(rndBits(23)), true);
  return dv.getFloat32(0x10, true);
}

// ================================================================
section('double load/store round trip');
init(CW_ALL_MASKED(3, 0));
for (let n = 0; n < 5000; n++) {
  let b = rnd64();
  if (n % 10 === 1) b &= ~(0x7FFn << 52n);                 // denormals and zeros
  if (n % 10 === 2) b |= 0x7FFn << 52n;                    // inf / NaN
  if (n % 50 === 3) b &= 1n << 63n;                         // signed zeros
  fld64b(b);
  const got = fstp64b();
  if (!check(got === b, () => `bits ${fmt(b)} -> ${fmt(got)}`)) break;
  const x = bitsF64(b);
  if (!Number.isNaN(x)) check(Object.is(F80.toNumber(F80.fromNumber(x)), x), `F80 number round trip ${x}`);
}
eq(fpu.top, 0, 'stack balanced');

section('float32 load/store round trip');
for (let n = 0; n < 5000; n++) {
  let b = Number(rndBits(32));
  if (n % 10 === 1) b &= ~(0xFF << 23);
  if (n % 10 === 2) b |= 0xFF << 23;
  b >>>= 0;
  dv.setUint32(PH, b, true);
  X(0xD9, M(0), EA);
  X(0xD9, M(3), EA);
  if (!check(dv.getUint32(PH, true) === b, () => `bits ${b.toString(16)} -> ${dv.getUint32(PH, true).toString(16)}`)) break;
}

section('double -> float32 rounding (vs Math.fround)');
for (let n = 0; n < 4000; n++) {
  const x = n % 4 === 0 ? rndDouble(-160, -120) : rndDouble(-140, 140);   // includes float denormals, overflow
  fld64(x);
  X(0xD9, M(3), EA);
  if (!check(dv.getUint32(PH, true) === f32bits(Math.fround(x)), () => `${x}: ${dv.getUint32(PH, true).toString(16)} vs ${f32bits(Math.fround(x)).toString(16)}`)) break;
}

// ================================================================
section('53-bit precision arithmetic vs JS doubles');
init(CW_ALL_MASKED(2, 0));
const ops53 = [
  // [name, expected(a,b), sequence after "fld a; fld b" (ST0 = b, ST1 = a)]
  ['fadd st0,st1', (a, b) => b + a, () => { X(0xD8, R(0, 1)); X(0xDD, R(3, 1)); }],
  ['faddp', (a, b) => a + b, () => X(0xDE, R(0, 1))],
  ['fmulp', (a, b) => a * b, () => X(0xDE, R(1, 1))],
  ['fsub st0,st1 (D8 E1)', (a, b) => b - a, () => { X(0xD8, R(4, 1)); X(0xDD, R(3, 1)); }],
  ['fsubr st0,st1 (D8 E9)', (a, b) => a - b, () => { X(0xD8, R(5, 1)); X(0xDD, R(3, 1)); }],
  ['fsub st1,st0 (DC E9)', (a, b) => a - b, () => { X(0xDC, R(5, 1)); X(0xDD, R(3, 0)); }],
  ['fsubr st1,st0 (DC E1)', (a, b) => b - a, () => { X(0xDC, R(4, 1)); X(0xDD, R(3, 0)); }],
  ['fsubp (DE E9)', (a, b) => a - b, () => X(0xDE, R(5, 1))],
  ['fsubrp (DE E1)', (a, b) => b - a, () => X(0xDE, R(4, 1))],
  ['fdiv st0,st1 (D8 F1)', (a, b) => b / a, () => { X(0xD8, R(6, 1)); X(0xDD, R(3, 1)); }],
  ['fdivr st0,st1 (D8 F9)', (a, b) => a / b, () => { X(0xD8, R(7, 1)); X(0xDD, R(3, 1)); }],
  ['fdiv st1,st0 (DC F9)', (a, b) => a / b, () => { X(0xDC, R(7, 1)); X(0xDD, R(3, 0)); }],
  ['fdivr st1,st0 (DC F1)', (a, b) => b / a, () => { X(0xDC, R(6, 1)); X(0xDD, R(3, 0)); }],
  ['fdivp (DE F9)', (a, b) => a / b, () => X(0xDE, R(7, 1))],
  ['fdivrp (DE F1)', (a, b) => b / a, () => X(0xDE, R(6, 1))],
];
for (const [name, ref, seq] of ops53) {
  for (let n = 0; n < 400; n++) {
    const a = rndDouble();
    const b = n % 2 ? rndDouble() : a * (1 + (rndInt(2000) - 1000) / 1e6) * (rndInt(2) ? 1 : -1);  // cancellation
    fld64(a); fld64(b); seq();
    const got = fstp64b(), exp = f64bits(ref(a, b));
    if (!check(got === exp && fpu.top === 0, () => `${name} a=${a} b=${b}: ${bitsF64(got)} vs ${ref(a, b)} top=${fpu.top}`)) break;
  }
}
const memOps = [[0, (a, b) => a + b], [1, (a, b) => a * b], [4, (a, b) => a - b], [5, (a, b) => b - a], [6, (a, b) => a / b], [7, (a, b) => b / a]];
for (const [reg, ref] of memOps) {
  for (let n = 0; n < 400; n++) {
    const a = rndDouble(), b = rndDouble();
    fld64(a);
    dv.setFloat64(PH2, b, true);
    X(0xDC, M(reg), EA2);
    const got = fstp64b();
    if (!check(got === f64bits(ref(a, b)), () => `DC /${reg} m64 a=${a} b=${b}`)) break;
  }
}
for (let n = 0; n < 1000; n++) {
  const a = Math.abs(rndDouble(-300, 300));
  fld64(a); X(0xD9, 0xFA);
  if (!check(fstp64b() === f64bits(Math.sqrt(a)), `fsqrt ${a}`)) break;
}
section('24-bit precision arithmetic vs Math.fround');
init(CW_ALL_MASKED(0, 0));
for (let n = 0; n < 2000; n++) {
  const a = rndFloat32(), b = rndFloat32(), k = n % 5;
  if (k === 4) { fld64(Math.abs(a)); X(0xD9, 0xFA); } else { fld64(a); fld64(b); X(0xDE, R([0, 1, 5, 7][k], 1)); }
  const exp = [a + b, a * b, a - b, a / b, Math.sqrt(Math.abs(a))][k];
  if (!check(fstp64b() === f64bits(Math.fround(exp)), `pc24 op${k} ${a} ${b}`)) break;
}

// ================================================================
section('64-bit precision vs BigInt reference, 4 rounding modes');
function bl(n) { return n === 0n ? 0 : n.toString(2).length; }
// Reference: round sign*m*2^e (normal range) to 64 bits.
function ref64(sign, m, e, rc) {
  const sh = bl(m) - 64;
  let q = m, E = e;
  if (sh > 0) {
    q = m >> BigInt(sh);
    const rem = m - (q << BigInt(sh)), half = 1n << BigInt(sh - 1);
    E += sh;
    const up = rem === 0n ? false : rc === 0 ? rem > half || (rem === half && (q & 1n) === 1n) : rc === 1 ? sign === 1 : rc === 2 ? sign === 0 : false;
    if (up) q++;
    if (q === 1n << 64n) { q >>= 1n; E++; }
  } else { q = m << BigInt(-sh); E += sh; }
  return F80.make(sign, E + 63 + 16383, q);
}
const rnd80 = (spread = 60) => F80.make(rndInt(2), 0x3FFF - spread + rndInt(2 * spread), (1n << 63n) | rndBits(63));
const val = (v) => ({ s: v.sign, m: v.mant, e: v.exp - 16383 - 63 });
for (let rc = 0; rc < 4; rc++) {
  init(CW_ALL_MASKED(3, rc));
  for (let n = 0; n < 300; n++) {
    const a = rnd80(), b = n % 3 ? rnd80() : F80.make(rndInt(2), a.exp - rndInt(3), a.mant ^ rndBits(20));
    const A = val(a), B = val(b);
    // add / sub
    for (const [op, sb] of [['add', B.s], ['sub', B.s ^ 1]]) {
      const e = Math.min(A.e, B.e);
      const s = (A.s ? -1n : 1n) * (A.m << BigInt(A.e - e)) + (sb ? -1n : 1n) * (B.m << BigInt(B.e - e));
      fld80(a); fld80(b); X(0xDE, op === 'add' ? R(0, 1) : R(5, 1));   // a + b, a - b
      const got = fstp80();
      const exp = s === 0n ? F80.zero(rc === 1 ? 1 : 0) : ref64(s < 0n ? 1 : 0, s < 0n ? -s : s, e, rc);
      check(same80(got, exp), () => `${op} rc${rc}: ${hex80(got)} vs ${hex80(exp)}`);
    }
    // mul
    fld80(a); fld80(b); X(0xDE, R(1, 1));
    let got = fstp80();
    check(same80(got, ref64(A.s ^ B.s, A.m * B.m, A.e + B.e, rc)), () => `mul rc${rc}`);
    // div (reference: 200 extra bits + sticky)
    fld80(a); fld80(b); X(0xDE, R(7, 1));
    got = fstp80();
    const N = A.m << 200n, q = N / B.m, st = N % B.m ? 1n : 0n;
    check(same80(got, ref64(A.s ^ B.s, (q << 1n) | st, A.e - B.e - 201, rc)), () => `div rc${rc} ${hex80(got)}`);
    // sqrt of |a|
    const aa = F80.make(0, a.exp, a.mant);
    fld80(aa); X(0xD9, 0xFA);
    got = fstp80();
    let m = A.m, e = A.e;
    if (e & 1) { m <<= 1n; e--; }
    const n2 = m << 256n, r = F80.isqrt(n2);
    check(r * r <= n2 && (r + 1n) * (r + 1n) > n2, 'isqrt');
    check(same80(got, ref64(0, (r << 1n) | (r * r === n2 ? 0n : 1n), e / 2 - 129, rc)), () => `sqrt rc${rc} ${hex80(got)}`);
  }
}

// ================================================================
section('integer stores, all rounding modes');
const intCases = [
  // value, [near, down, up, chop]
  [2.5, [2, 2, 3, 2]], [3.5, [4, 3, 4, 3]], [-2.5, [-2, -3, -2, -2]], [-3.5, [-4, -4, -3, -3]],
  [0.5, [0, 0, 1, 0]], [-0.5, [0, -1, 0, 0]], [1.25, [1, 1, 2, 1]], [-1.75, [-2, -2, -1, -1]],
  [7, [7, 7, 7, 7]], [-32768.4, [-32768, -32769, -32768, -32768]], [123456.5, [123456, 123456, 123457, 123456]],
];
for (let rc = 0; rc < 4; rc++) {
  init(CW_ALL_MASKED(3, rc));
  for (const [x, exp] of intCases) {
    fld64(x); X(0xDB, M(3), EA);                    // FISTP m32
    eq(dv.getInt32(PH, true), exp[rc], `fistp m32 ${x} rc${rc}`);
    fld64(x); X(0xDF, M(7), EA);                    // FISTP m64
    eq(dv.getBigInt64(PH, true), BigInt(exp[rc]), `fistp m64 ${x} rc${rc}`);
    if (exp[rc] >= -32768 && exp[rc] <= 32767) {
      fld64(x); X(0xDF, M(2), EA); X(0xDD, R(3, 0));  // FIST m16 then drop
      eq(dv.getInt16(PH, true), exp[rc], `fist m16 ${x} rc${rc}`);
    }
  }
}
init();
fld64(40000); X(0xDF, M(3), EA);
eq(dv.getUint16(PH, true), 0x8000, 'm16 overflow -> integer indefinite');
check(fpu.sw & 1, 'IE set on integer overflow');
fld64(1e19); X(0xDF, M(7), EA);
eq(dv.getBigUint64(PH, true), 0x8000000000000000n, 'm64 overflow -> indefinite');
fld64(-(2 ** 63)); X(0xDF, M(7), EA);
eq(dv.getBigInt64(PH, true), -(2n ** 63n), 'm64 minimum');
init();
fld64(1.5); X(0xDB, M(3), EA);
check(fpu.sw & 32, 'PE on inexact integer store');
for (const [v, bytes] of [[-5n, 2], [123456789n, 4], [-9007199254740993n, 8]]) {
  const bits = bytes * 8;
  for (let i = 0; i < bytes; i++) mem[PH + i] = Number((BigInt.asUintN(bits, v) >> BigInt(8 * i)) & 0xFFn);
  X(bytes === 2 ? 0xDF : bytes === 4 ? 0xDB : 0xDF, M(bytes === 8 ? 5 : 0), EA);   // FILD
  const g = fstp80();
  eq(F80.toInt(g, 0).n, v, `FILD m${bits}`);
}

// ================================================================
section('packed BCD');
init();
for (let n = 0; n < 1000; n++) {
  const digits = 1 + rndInt(18);
  let s = '';
  for (let i = 0; i < digits; i++) s += rndInt(10);
  const v = BigInt(s), neg = rndInt(2);
  const bytes = [];
  let t = v;
  for (let i = 0; i < 9; i++) { bytes.push(Number(t % 10n) | Number((t / 10n) % 10n) << 4); t /= 100n; }
  bytes.push(neg ? 0x80 : 0);
  bytes.forEach((b, i) => { mem[PH + i] = b; });
  X(0xDF, M(4), EA);                                // FBLD
  const g = F80.toInt(fpu.st(0), 0).n;
  check(g === (neg ? -v : v), () => `FBLD ${s}`);
  mem.fill(0x55, PH, PH + 10);
  X(0xDF, M(6), EA);                                // FBSTP
  if (!check(Array.from(mem.slice(PH, PH + 10)).every((b, i) => b === bytes[i]), () => `FBSTP ${s}`)) break;
}
fld64(-1234.5); X(0xDF, M(6), EA);
eq(Array.from(mem.slice(PH, PH + 10)).map((b) => b.toString(16)).join(' '), '34 12 0 0 0 0 0 0 0 80', 'FBSTP -1234.5 (nearest even)');
fld64(1e18); X(0xDF, M(6), EA);
eq(Array.from(mem.slice(PH, PH + 10)).map((b) => b.toString(16)).join(' '), '0 0 0 0 0 0 0 c0 ff ff', 'BCD indefinite');
eq(fpu.top, 0, 'FBSTP pops');

// ================================================================
section('FPREM vs BigInt reference');
init(CW_ALL_MASKED(3, 0));
let multiStep = 0;
for (let n = 0; n < 600; n++) {
  const a = F80.make(rndInt(2), 0x3FFF + rndInt(n % 3 ? 40 : 400), (1n << 63n) | rndBits(63));
  const b = F80.make(rndInt(2), 0x3FFF - 20 + rndInt(40), (1n << 63n) | rndBits(63));
  fld80(b); fld80(a);
  let steps = 0;
  do { X(0xD9, 0xF8); steps++; } while (cc().c2 && steps < 100);
  if (steps > 1) multiStep++;
  const A = val(a), B = val(b), e = Math.min(A.e, B.e);
  const MA = A.m << BigInt(A.e - e), MB = B.m << BigInt(B.e - e), q = MA / MB, r = MA - q * MB;
  const exp = r === 0n ? F80.zero(a.sign) : F80.round(a.sign, r, e).v;
  const got = fstp80();
  X(0xDD, R(3, 0));
  const c = cc();
  check(same80(got, exp), () => `FPREM ${hex80(got)} vs ${hex80(exp)}`);
  check(c.c0 === Number((q >> 2n) & 1n) && c.c3 === Number((q >> 1n) & 1n) && c.c1 === Number(q & 1n), () => `quotient bits q=${q & 7n} cc=${ccs()}`);
}
check(multiStep > 50, `multi step partial remainders happened (${multiStep})`);
fld64(3); fld64(-10); X(0xD9, 0xF8);
eq(F80.toNumber(fpu.st(0)), -1, 'FPREM -10 rem 3 = -1');
check(cc().c1 === 1 && cc().c3 === 1 && cc().c0 === 0, 'q=3 -> C3=1 C1=1 C0=0');

// ================================================================
section('FXAM classes');
init();
const fxam = () => { X(0xD9, 0xE5); return ccs(); };
eq(fxam(), '1001', 'empty');
const fxamCases = [
  [F80.fromNumber(1.5), '0100'], [F80.fromNumber(-1.5), '0110'], [F80.zero(0), '1000'], [F80.zero(1), '1010'],
  [F80.inf(0), '0101'], [F80.inf(1), '0111'], [F80.INDEF, '0011'], [F80.make(0, 0x7FFF, 0xC000000000000001n), '0001'],
  [F80.make(0, 0, 123n), '1100'], [F80.make(1, 0, 123n), '1110'], [F80.make(0, 0x4000, 0x4000000000000000n), '0000'],
  [F80.make(1, 0x4000, 0x4000000000000000n), '0010'],
];
for (const [v, exp] of fxamCases) { fld80(v); eq(fxam(), exp, `FXAM ${hex80(v)}`); X(0xDD, R(3, 0)); }
init();
fld80(F80.make(0, 0, 123n));
eq(fpu.tag(0), 2, 'tag special for denormal');
X(0xDD, R(3, 0));
fld64(0); eq(fpu.tag(0), 1, 'tag zero');
fld64(2); eq(fpu.tag(0), 0, 'tag valid');
eq(fpu.tag(2), 3, 'tag empty');
eq(fpu.tw, 0x4FFF, 'tag word (phys 7 zero, phys 6 valid)');
eq(fpu.describe(0), '2', 'describe 2');
eq(fpu.describe(3), 'empty', 'describe empty');

// ================================================================
section('compare flags');
init();
const cmpCase = (a, b, exp, name) => { fld64(b); fld64(a); X(0xD8, R(2, 1)); eq(`${cc().c3}${cc().c2}${cc().c0}`, exp, name); X(0xDD, R(3, 0)); X(0xDD, R(3, 0)); };
cmpCase(2, 1, '000', 'FCOM >');
cmpCase(1, 2, '001', 'FCOM <');
cmpCase(1, 1, '100', 'FCOM =');
cmpCase(0, -0, '100', 'FCOM +0 = -0');
cmpCase(NaN, 1, '111', 'FCOM NaN unordered');
check(fpu.sw & 1, 'IE on NaN compare');
init();
fld64(5); fld64(3);
X(0xD8, R(3, 1)); eq(`${cc().c3}${cc().c0}`, '01', 'FCOMP <'); eq(fpu.top, 7, 'FCOMP pops');
fld64(5); X(0xDE, 0xD9); eq(`${cc().c3}${cc().c0}`, '10', 'FCOMPP ='); eq(fpu.top, 0, 'FCOMPP pops 2');
fld64(-3); X(0xD9, 0xE4); eq(`${cc().c3}${cc().c2}${cc().c0}`, '001', 'FTST <0');
X(0xD9, 0xE0); X(0xD9, 0xE4); eq(`${cc().c3}${cc().c2}${cc().c0}`, '000', 'FCHS, FTST >0');
dv.setInt16(PH, 3, true); X(0xDE, M(2), EA); eq(`${cc().c3}${cc().c0}`, '10', 'FICOM m16 =');
dv.setFloat32(PH, 4, true); X(0xD8, M(3), EA); eq(`${cc().c3}${cc().c0}`, '01', 'FCOMP m32 <'); eq(fpu.top, 0, 'FCOMP m32 pops');
init(0x03FF);  // projective (IC=0)
fld64(Infinity); fld64(1); X(0xD8, R(2, 1)); eq(`${cc().c3}${cc().c2}${cc().c0}`, '111', 'projective: finite vs inf unordered');
init(CW_ALL_MASKED(3, 0));
fld64(Infinity); fld64(1); X(0xD8, R(2, 1)); eq(`${cc().c3}${cc().c2}${cc().c0}`, '001', 'affine: 1 < +inf');

// ================================================================
section('stack overflow / underflow');
init();
for (let i = 0; i < 8; i++) fld64(i);
eq(fpu.sw & 1, 0, 'no IE after 8 pushes');
fld64(99);
check(fpu.sw & 1, 'IE on 9th push');
eq(fpu.sw & 0x40, 0, 'no SF bit (8087)');
check(same80(fpu.st(0), F80.INDEF), 'masked overflow pushes indefinite');
eq(fpu.describe(0), '-NaN', 'describe indefinite');
init();
X(0xD8, R(0, 1));
check(fpu.sw & 1, 'IE on underflow (FADD empty)');
check(same80(fpu.st(0), F80.INDEF), 'underflow result indefinite');
init();
X(0xDD, M(3), EA);
eq(dv.getBigUint64(PH, true), 0xFFF8000000000000n, 'FSTP m64 of empty stores double indefinite');
X(0xD9, M(3), EA);
eq(dv.getUint32(PH, true), 0xFFC00000, 'FSTP m32 of empty stores single indefinite');

// ================================================================
section('exceptions, masking, intRequest');
init(0x037F & ~1);                                     // IE unmasked, IEM = 0 (FNINIT sets IEM = 1)
fld64(1);
const before = fpu.top;
X(0xD8, R(0, 3));                                      // FADD ST0, ST3 (empty)
check(fpu.intRequest, 'intRequest on unmasked IE');
check(fpu.sw & 0x80, 'IR bit set');
eq(fpu.top, before, 'stack unchanged');
eq(F80.toNumber(fpu.st(0)), 1, 'ST0 unchanged');
X(0xDB, 0xE2);                                         // FNCLEX
check(!fpu.intRequest && !(fpu.sw & 0xBF), 'FNCLEX clears');
X(0xDB, 0xE1);                                         // FDISI
X(0xD8, R(0, 3));
check(!fpu.intRequest && (fpu.sw & 0x80), 'FDISI: IR set but no request');
X(0xDB, 0xE0);                                         // FENI
check(fpu.intRequest, 'FENI: request now pending');
init(0x037F & ~4);                                     // ZE unmasked
fld64(5); fld64(0);
X(0xDE, R(7, 1));                                      // 5 / 0
check(fpu.intRequest && (fpu.sw & 4), 'unmasked ZE');
eq(fpu.top, 6, 'no pop on unmasked ZE');
init();
fld64(-5); fld64(0); X(0xDE, R(7, 1));
eq(F80.toNumber(fpu.st(0)), -Infinity, 'masked ZE -> -inf');
check((fpu.sw & 4) && !fpu.intRequest, 'ZE flag, no request');
init(CW_ALL_MASKED(3, 0));
fld80(F80.make(0, 0x7FF0, 1n << 63n)); fld80(F80.make(0, 0x7FF0, 1n << 63n)); X(0xDE, R(1, 1));
check(F80.cls(fpu.st(0)) === 'inf' && (fpu.sw & 8) && (fpu.sw & 32), 'masked OE -> inf, OE+PE');
init(CW_ALL_MASKED(3, 3));
fld80(F80.make(0, 0x7FF0, 1n << 63n)); fld80(F80.make(0, 0x7FF0, 1n << 63n)); X(0xDE, R(1, 1));
eq(hex80(fpu.st(0)), '7FFE FFFFFFFFFFFFFFFF', 'masked OE chop -> max');
init(0x1300 | (0x3F & ~8));                            // OE unmasked
fld80(F80.make(0, 0x7FF0, 1n << 63n)); fld80(F80.make(0, 0x7FF0, 1n << 63n)); X(0xDE, R(1, 1));
eq(hex80(fpu.st(0)), (0x7FF0 * 2 - 16383 - 24576).toString(16).toUpperCase().padStart(4, '0') + ' 8000000000000000', 'unmasked OE -> bias adjusted');
check(fpu.intRequest, 'OE request');
init(CW_ALL_MASKED(3, 0));
fld80(F80.make(0, 0x0010, 1n << 63n)); fld80(F80.make(0, 0x3FF0, 3n << 62n)); X(0xDE, R(1, 1));
eq(hex80(fpu.st(0)), '0001 C000000000000000', 'smallest normal exponent result');
init(CW_ALL_MASKED(3, 0));
fld80(F80.make(0, 1, 3n << 62n)); fld64(0.25); X(0xDE, R(1, 1));   // (1.5*2^-16382)/4 -> denormal
eq(hex80(fpu.st(0)), '0000 3000000000000000', 'masked UE -> denormal');
eq(fpu.sw & 16, 0, 'exact denormal: no UE when masked');
fld80(F80.make(0, 0x3FFE, 0xAAAAAAAAAAAAAAABn)); X(0xDE, R(1, 1));
check((fpu.sw & 16) && (fpu.sw & 32), 'inexact denormal: UE + PE');
init();
dv.setBigUint64(PH, 1n, true); X(0xDD, M(0), EA);
check(fpu.sw & 2, 'DE on denormal double load');
init(0x037F & ~2);
dv.setBigUint64(PH, 1n, true); X(0xDD, M(0), EA);
check(fpu.intRequest && fpu.tag(0) === 3, 'unmasked DE: no load');
init(0x037F & ~32);
fld64(1); fld64(3); X(0xDE, R(7, 1));
check(fpu.intRequest && Math.abs(F80.toNumber(fpu.st(0)) - 1 / 3) < 1e-16, 'unmasked PE still stores the result');
init();
fld64(-1); X(0xD9, 0xFA);
check((fpu.sw & 1) && same80(fpu.st(0), F80.INDEF), 'sqrt(-1) -> IE, indefinite');
init();
fld64(Infinity); fld64(-Infinity); X(0xDE, R(0, 1));
check(fpu.sw & 1, 'projective inf + inf -> IE');
init(CW_ALL_MASKED(3, 0));
fld64(Infinity); fld64(Infinity); X(0xDE, R(0, 1));
check(!(fpu.sw & 1) && F80.toNumber(fpu.st(0)) === Infinity, 'affine inf + inf = inf');
fld64(-Infinity); X(0xDE, R(0, 1));
check(fpu.sw & 1, 'affine inf - inf -> IE');

// ================================================================
section('FSAVE / FRSTOR / FSTENV / FLDCW / FSTSW');
init(0x0B3E);
for (const x of [1, -2.5, 3e100, 0]) fld64(x);
X(0xDD, R(0, 2));                                        // FFREE ST2
X(0xD8, R(6, 3));                                        // make some flags: 0 / 1
fpu.instrPtr = 0x12345;
X(0xD9, 0xE1);                                           // FABS updates opcode pointer
const snap = { cw: fpu.cw, sw: fpu.sw, tw: fpu.tw, top: fpu.top, regs: fpu.regs.map((r) => ({ ...r })), op: fpu.opcode11 };
const SAVE = { seg: 0x0400, off: 0x0010 };
X(0xDD, M(6), SAVE);                                     // FSAVE
eq(fpu.lastMem.length, 94, 'FSAVE writes 94 bytes');
check(fpu.lastMem.every((m) => m.write), 'FSAVE: all writes');
eq(fpu.cw, 0x03FF, 'FSAVE initializes'); eq(fpu.tw, 0xFFFF, 'TW after FSAVE');
const base = 0x4010;
eq(dv.getUint16(base, true), snap.cw, 'saved CW');
eq(dv.getUint16(base + 2, true), snap.sw & 0x7FFF, 'saved SW (no busy bit)');
eq(dv.getUint16(base + 4, true), snap.tw, 'saved TW');
eq(dv.getUint16(base + 6, true), 0x2345, 'saved IP low');
eq(dv.getUint16(base + 8, true), 0x1000 | 0x1E1, 'saved IP high + opcode');
for (const r of fpu.regs) Object.assign(r, { sign: 0, exp: 0, mant: 0n });
X(0xDD, M(4), SAVE);                                     // FRSTOR
eq(fpu.cw, snap.cw, 'restored CW'); eq(fpu.sw, snap.sw, 'restored SW'); eq(fpu.tw, snap.tw, 'restored TW');
check(fpu.regs.every((r, i) => same80(r, snap.regs[i])), 'restored registers');
eq(fpu.opcode11, snap.op, 'restored opcode');
X(0xD9, M(6), EA);                                       // FSTENV
eq(fpu.lastMem.length, 14, 'FSTENV 14 bytes');
eq(dv.getUint16(PH + 4, true), snap.tw, 'FSTENV TW');
eq(dv.getUint16(PH + 10, true), dv.getUint16(base + 10, true), 'FSTENV data pointer = restored one');
init();
dv.setUint16(PH, 0x0C7F, true); X(0xD9, M(5), EA);       // FLDCW
eq(fpu.cw, 0x0C7F, 'FLDCW');
X(0xD9, M(7), EA2); eq(dv.getUint16(PH2, true), 0x0C7F, 'FSTCW');
fld64(1); fld64(2);
X(0xDD, M(7), EA2); eq(dv.getUint16(PH2, true), 6 << 11, 'FSTSW top=6');
X(0xD9, M(4), EA); // FLDENV from a 14-byte block
check(true, 'FLDENV runs');

// ================================================================
section('constants');
init();
const consts = [[0xE8, '3FFF 8000000000000000'], [0xE9, '4000 D49A784BCD1B8AFE'], [0xEA, '3FFF B8AA3B295C17F0BC'],
  [0xEB, '4000 C90FDAA22168C235'], [0xEC, '3FFD 9A209A84FBCFF799'], [0xED, '3FFE B17217F7D1CF79AC'], [0xEE, '0000 0000000000000000']];
for (const [op, exp] of consts) { X(0xD9, op); eq(hex80(fpu.st(0)), exp, `constant D9 ${op.toString(16)}`); }
// independent check: correctly rounded values via BigInt series at 200 bits
{
  const S = 200n, one = 1n << S;
  const atanInv = (k) => { let p = one / BigInt(k), s = 0n, n = 1n, sg = 1n; while (p) { s += sg * p / n; p /= BigInt(k * k); n += 2n; sg = -sg; } return s; };
  const atanhInv = (k) => { let p = one / BigInt(k), s = 0n, n = 1n; while (p) { s += p / n; p /= BigInt(k * k); n += 2n; } return s; };
  const pi = 16n * atanInv(5) - 4n * atanInv(239), ln2 = 2n * atanhInv(3), ln10 = ln2 * 3n + 2n * atanhInv(9);   // ln10 = 3 ln2 + ln(5/4)
  const r64 = (x) => { const b = bl(x); const sh = BigInt(b - 64); let q = x >> sh; if ((x >> (sh - 1n)) & 1n) q++; return q.toString(16).toUpperCase(); };
  eq(r64(pi), 'C90FDAA22168C235', 'pi reference');
  eq(r64(ln2), 'B17217F7D1CF79AC', 'ln2 reference');
  eq(r64((ln10 << S) / ln2), 'D49A784BCD1B8AFE', 'log2(10) reference');
  eq(r64((one << S) / ln2), 'B8AA3B295C17F0BC', 'log2(e) reference');
  eq(r64((ln2 << S) / ln10), '9A209A84FBCFF799', 'log10(2) reference');
}

// ================================================================
section('misc instructions');
init(CW_ALL_MASKED(3, 0));
fld64(3); fld64(-7);
X(0xD9, R(1, 1)); eq(F80.toNumber(fpu.st(0)), 3, 'FXCH'); eq(F80.toNumber(fpu.st(1)), -7, 'FXCH 2');
X(0xD9, 0xE1); eq(F80.toNumber(fpu.st(0)), 3, 'FABS');
X(0xD9, R(0, 1)); eq(F80.toNumber(fpu.st(0)), -7, 'FLD ST1'); eq(fpu.top, 5, 'top');
X(0xD9, 0xF7); eq(fpu.top, 6, 'FINCSTP'); X(0xD9, 0xF6); eq(fpu.top, 5, 'FDECSTP');
X(0xDD, R(2, 2)); eq(F80.toNumber(fpu.st(2)), -7, 'FST ST2');
init(CW_ALL_MASKED(3, 0));
fld64(3); fld64(1.5); X(0xD9, 0xFD); eq(F80.toNumber(fpu.st(0)), 12, 'FSCALE 1.5*2^3');
init(CW_ALL_MASKED(3, 0));
fld64(-2.5); fld64(-12); X(0xD9, 0xFD); eq(F80.toNumber(fpu.st(0)), -3, 'FSCALE by -2 (trunc of -2.5)');
init(CW_ALL_MASKED(3, 0));
fld64(-48); X(0xD9, 0xF4);
eq(F80.toNumber(fpu.st(0)), -1.5, 'FXTRACT significand'); eq(F80.toNumber(fpu.st(1)), 5, 'FXTRACT exponent');
for (let rc = 0; rc < 4; rc++) {
  init(CW_ALL_MASKED(3, rc));
  fld64(-2.5); X(0xD9, 0xFC); eq(F80.toNumber(fpu.st(0)), [-2, -3, -2, -2][rc], `FRNDINT rc${rc}`);
  fld64(-0.25); X(0xD9, 0xFC); check(Object.is(F80.toNumber(fpu.st(0)), [-0, -1, -0, -0][rc]), `FRNDINT -0.25 rc${rc}`);
}
init();
dv.setInt32(PH, -12, true); X(0xDA, M(6), EA);   // FIDIV on empty ST0 -> IE
check(fpu.sw & 1, 'FIDIV empty -> IE');
init();
fld64(10); dv.setInt32(PH, 4, true); X(0xDA, M(7), EA); eq(F80.toNumber(fpu.st(0)), 0.4, 'FIDIVR m32 = 4/10');
dv.setInt16(PH, 3, true); X(0xDE, M(4), EA); eq(F80.toNumber(fpu.st(0)), 0.4 - 3, 'FISUB m16');
dv.setFloat32(PH, 2, true); X(0xD8, M(1), EA); eq(F80.toNumber(fpu.st(0)), (0.4 - 3) * 2, 'FMUL m32');
init();
let r = X(0xD9, 0xD8); eq(r.text, 'reserved', 'D9 D8 reserved'); eq(r.cycles, 0, 'reserved cycles');
eq(X(0xDA, 0xE9).text, 'reserved', 'DA E9 (FUCOMPP, 387) reserved');
eq(X(0xD9, 0xFF).text, 'reserved', 'D9 FF (FCOS, 387) reserved');
eq(X(0xDF, 0xE0).text, 'reserved', 'DF E0 (FSTSW AX, 287) reserved');
eq(X(0xDD, M(5), EA).text, 'reserved', 'DD /5 reserved');
r = X(0xD9, 0xD0); eq(r.cycles, 13, 'FNOP cycles');
fld64(1); fld64(2);
r = X(0xD8, R(0, 1));
eq(r.cycles, 85, 'FADD cycles'); eq(fpu.busyCycles, 85, 'busyCycles');
check(r.text.includes('ST0 = ST0 + ST1 = 3'), `text: ${r.text}`);
X(0xD9, 0xEB); r = X(0xD8, R(0, 1));
eq(r.text, 'FADD: ST0 = ST0 + ST1 = 6.14159265358979324', 'text format');
dv.setFloat64(PH, 1, true);
r = X(0xDC, M(0), { seg: 0x0010, off: 0xFFFC });
check(fpu.lastMem.length === 8 && fpu.lastMem[4].addr === 0x100 && fpu.lastMem.every((m) => !m.write), 'lastMem reads with offset wrap');
X(0xDD, M(2), EA); check(fpu.lastMem.length === 8 && fpu.lastMem.every((m) => m.write), 'lastMem writes');
eq(fpu.dataPtr, 0x100, 'data pointer');
eq(fpu.opcode11, 0x516, 'opcode pointer (DD 16)');

// ================================================================
section('transcendentals');
init(CW_ALL_MASKED(3, 0));
const close = (got, exp, tol, name) => check(Math.abs(got - exp) <= tol * Math.max(Math.abs(exp), 1e-300), () => `${name}: ${got} vs ${exp}`);
for (let n = 0; n < 200; n++) {
  const x = (n + 0.5) / 200 * Math.PI / 4;
  fld64(x); X(0xD9, 0xF2);
  const xv = F80.toNumber(fpu.st(0)), yv = F80.toNumber(fpu.st(1));
  close(yv / xv, Math.tan(x), 3e-16, `FPTAN ${x}`);
  X(0xDD, R(3, 0)); X(0xDD, R(3, 0));
  const y = x / 2;
  fld64(y); fld64(x + 0.1); X(0xD9, 0xF3); close(F80.toNumber(fpu.st(0)), Math.atan2(y, x + 0.1), 3e-16, 'FPATAN'); X(0xDD, R(3, 0));
  const h = n / 400;
  fld64(h); X(0xD9, 0xF0); close(F80.toNumber(fpu.st(0)), Math.expm1(h * Math.LN2), 3e-16, `F2XM1 ${h}`); X(0xDD, R(3, 0));
  fld64(-h); X(0xD9, 0xF0); close(F80.toNumber(fpu.st(0)), Math.expm1(-h * Math.LN2), 3e-16, `F2XM1 -${h}`); X(0xDD, R(3, 0));
  const z = 1e-3 + n * 7.3;
  fld64(1.5); fld64(z); X(0xD9, 0xF1); close(F80.toNumber(fpu.st(0)), 1.5 * Math.log2(z), 3e-16, `FYL2X ${z}`); X(0xDD, R(3, 0));
  const w = (n - 100) / 400;
  fld64(2); fld64(w); X(0xD9, 0xF9); close(F80.toNumber(fpu.st(0)), 2 * Math.log1p(w) / Math.LN2, 3e-16, `FYL2XP1 ${w}`); X(0xDD, R(3, 0));
}
eq(fpu.top, 0, 'transcendentals stack balanced');
fld64(1); fld64(1e-30); X(0xD9, 0xF9); close(F80.toNumber(fpu.st(0)), 1e-30 / Math.LN2, 1e-16, 'FYL2XP1 tiny keeps precision'); X(0xDD, R(3, 0));
fld64(1e-300); X(0xD9, 0xF0); close(F80.toNumber(fpu.st(0)), 1e-300 * Math.LN2, 1e-16, 'F2XM1 tiny'); X(0xDD, R(3, 0));
fld64(2); fld64(1); X(0xD9, 0xF3); close(F80.toNumber(fpu.st(0)), Math.atan2(2, 1), 3e-16, 'FPATAN out of range y > x'); X(0xDD, R(3, 0));
fld64(3); X(0xD9, 0xF2); close(F80.toNumber(fpu.st(1)), Math.tan(3), 1e-15, 'FPTAN out of range'); X(0xDD, R(3, 0)); X(0xDD, R(3, 0));
// FPTAN of 0.5 at 64 bits against a BigInt reference: tan = sin/cos series at 200 bits
{
  const S = 200n, one = 1n << S, x = one / 2n;
  let s = 0n, c = 0n, t = x;
  for (let k = 1n; t; k += 2n) { s += t; t = -t * x * x / one / one / ((k + 1n) * (k + 2n)); }
  t = one;
  for (let k = 0n; t; k += 2n) { c += t; t = -t * x * x / one / one / ((k + 1n) * (k + 2n)); }
  const tanv = (s << S) / c;
  fld64(0.5); X(0xD9, 0xF2); X(0xDE, R(7, 1));
  const g = fpu.st(0), G = val(g);
  const diff = (G.m << BigInt(G.e + 400 + 200)) - (tanv << BigInt(400));
  check((diff < 0n ? -diff : diff) <= (1n << BigInt(G.e + 400 + 200)), () => `FPTAN(0.5) within 1 ulp at 64 bits (${hex80(g)})`);
}
fld64(2); fld64(-1); X(0xD9, 0xF1); check(fpu.sw & 1, 'FYL2X of negative -> IE'); X(0xDD, R(3, 0));
init();
fld64(1); fld64(0); X(0xD9, 0xF1); check((fpu.sw & 4) && F80.toNumber(fpu.st(0)) === -Infinity, 'FYL2X(0) -> ZE, -inf');

// ================================================================
section('F80 helpers');
eq(F80.toString(F80.CONST.pi), '3.14159265358979324', 'toString pi');
eq(F80.toString(F80.fromNumber(-1e-10), 18), '-1.00000000000000004e-10', 'toString small');
eq(F80.toString(F80.fromNumber(1e300), 5), '1e+300', 'toString big');
eq(F80.toString(F80.inf(1)), '-inf', 'toString -inf');
eq(F80.toString(F80.inf(0)), '+inf', 'toString +inf');
eq(F80.toNumber(F80.fromNumber(0.1)), 0.1, 'fromNumber/toNumber');
check(Object.is(F80.toNumber(F80.fromNumber(-0)), -0), '-0');

// ================================================================
section('80287 model');
{
  const m24 = new Uint8Array(1 << 24);
  const bus24 = { read8: (a) => m24[a], write8: (a, v) => { m24[a] = v & 0xFF; } };
  const p = new FPU8087(bus24, { model: '80287' });
  const q = new FPU8087(bus24);                        // 8087 for comparison
  const dv24 = new DataView(m24.buffer);
  const EB = { seg: 0x28, off: 0x100, base: 0x200000 };   // protected-mode operand: base + offset
  eq(p.model, '80287', 'model option');
  eq(q.model, '8087', 'default model');
  // operand address with a 24-bit segment base
  dv24.setFloat64(0x200100, 2.5, true);
  p.exec(0xDB, 0xE3, null);                            // FNINIT
  p.exec(0xDD, M(0), EB);                              // FLD m64 from 200100h
  eq(F80.toNumber(p.st(0)), 2.5, 'ea.base: operand at base + offset (200100h)');
  p.busyCycles = 0;                                    // the 80286 waits for BUSY before the next ESC
  const r = p.exec(0xDF, 0xE0, null);                  // FSTSW AX
  eq(r.ax, 0x3800, 'FSTSW AX returns SW in the exec result (TOP = 7)');
  check(/FSTSW AX/.test(r.text), 'FSTSW AX text');
  eq(q.exec(0xDF, 0xE0, null).text, 'reserved', '8087: DF E0 is reserved');
  check(q.exec(0xDF, 0xE0, null).ax === undefined, '8087: no AX result');
  // FENI / FDISI are ignored by the 80287
  const cw = p.cw;
  p.exec(0xDB, 0xE1, null); eq(p.cw, cw, '80287: FDISI does not change CW');
  p.exec(0xDB, 0xE0, null); eq(p.cw, cw, '80287: FENI does not change CW');
  q.exec(0xDB, 0xE3, null); q.exec(0xDB, 0xE1, null); eq(q.cw & 0x80, 0x80, '8087: FDISI sets IEM');
  // FSETPM and the protected-mode environment (CW SW TW IP CS operand-offset operand-selector)
  eq(q.exec(0xDB, 0xE4, null).text, 'reserved', '8087: DB E4 is reserved');
  p.exec(0xDB, 0xE4, null);
  check(p.pm, 'FSETPM sets protected-mode pointer format');
  p.nextIpOff = 0x1234; p.nextIpSel = 0x0008;
  p.exec(0xDD, M(0), EB);                              // FLD (non-control: keeps the pointers)
  p.nextIpOff = 0x5555; p.nextIpSel = 0x0010;
  p.exec(0xD9, M(6), { seg: 0x30, off: 0x40, base: 0x300000 });   // FNSTENV (control: keeps the old pointers)
  const env = (i) => dv24.getUint16(0x300040 + 2 * i, true);
  eq(env(3), 0x1234, 'PM FSTENV word 3: IP offset of the last non-control instruction');
  eq(env(4), 0x0008, 'PM FSTENV word 4: CS selector');
  eq(env(5), 0x0100, 'PM FSTENV word 5: operand offset');
  eq(env(6), 0x0028, 'PM FSTENV word 6: operand selector');
  dv24.setUint16(0x300040 + 6, 0x7777, true); dv24.setUint16(0x300040 + 8, 0x0040, true);
  p.exec(0xD9, M(4), { seg: 0x30, off: 0x40, base: 0x300000 });   // FLDENV
  eq(p.ipOff, 0x7777, 'PM FLDENV loads the IP offset');
  eq(p.ipSel, 0x0040, 'PM FLDENV loads the CS selector');
  p.exec(0xDB, 0xE3, null);
  check(p.pm, 'FNINIT keeps the FSETPM state');
  p.reset();
  check(!p.pm, 'reset() (power-on) clears the FSETPM state');
  // infinity control: the 8087 and the original 80287 obey IC (projective when IC = 0);
  // only the 80387 / 80287XL are affine only (Borland's 287-vs-387 test relies on this)
  for (const [f, name] of [[p, '80287'], [q, '8087']]) {
    f.exec(0xDB, 0xE3, null);
    dv24.setUint16(0x100, 0x033F, true);                 // IC = 0 (projective), all exceptions masked
    f.exec(0xD9, M(5), { seg: 0x10, off: 0 });           // FLDCW
    dv24.setFloat64(0x200, Infinity, true);
    f.exec(0xDD, M(0), { seg: 0x20, off: 0 });           // +inf
    f.exec(0xDD, M(0), { seg: 0x20, off: 0 });           // +inf
    f.exec(0xD8, R(0, 1), null);                         // FADD ST0, ST1
    const v = F80.toNumber(f.st(0)), ie = f.sw & 1;
    check(ie === 1, `${name}: +inf + +inf with IC = 0 (projective) is invalid (v = ${v})`);
    f.exec(0xDB, 0xE3, null);
    dv24.setUint16(0x100, 0x133F, true);                 // IC = 1 (affine)
    f.exec(0xD9, M(5), { seg: 0x10, off: 0 });
    f.exec(0xDD, M(0), { seg: 0x20, off: 0 });
    f.exec(0xDD, M(0), { seg: 0x20, off: 0 });
    f.exec(0xD8, R(0, 1), null);
    check(F80.toNumber(f.st(0)) === Infinity && !(f.sw & 1), `${name}: +inf + +inf with IC = 1 (affine) = +inf`);
    f.exec(0xD9, 0xFA, null);                            // FSQRT(+inf)
    check(F80.toNumber(f.st(0)) === Infinity, `${name}: FSQRT(+inf) = +inf (affine)`);
  }
  // operand sizes for the 80286 operand transfer
  const mo = (op, m) => JSON.stringify(p.memOperand(op, m));
  eq(mo(0xDD, M(0)), '{"bytes":8,"write":false}', 'memOperand FLD m64');
  eq(mo(0xDD, M(3)), '{"bytes":8,"write":true}', 'memOperand FSTP m64');
  eq(mo(0xDB, M(7)), '{"bytes":10,"write":true}', 'memOperand FSTP m80');
  eq(mo(0xDE, M(0)), '{"bytes":2,"write":false}', 'memOperand FIADD m16');
  eq(mo(0xD9, M(6)), '{"bytes":14,"write":true}', 'memOperand FSTENV');
  eq(mo(0xDD, M(6)), '{"bytes":94,"write":true}', 'memOperand FSAVE');
  eq(mo(0xDD, M(4)), '{"bytes":94,"write":false}', 'memOperand FRSTOR');
  eq(mo(0xD9, M(5)), '{"bytes":2,"write":false}', 'memOperand FLDCW');
  eq(p.memOperand(0xD8, R(0, 1)), null, 'memOperand: register form -> null');
  eq(p.memOperand(0xDB, M(4)), null, 'memOperand: reserved encoding -> null');
}

// ================================================================
console.log('');
for (const s of sections) console.log(`${s.fail ? 'FAIL' : 'ok  '} ${s.name}: ${s.pass} passed${s.fail ? `, ${s.fail} failed` : ''}`);
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
