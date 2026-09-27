// Intel 8087 numeric data processor emulator.
//
// Plain browser script (no modules). Defines two top-level names:
//   F80      soft-float helpers for the 80-bit temporary real format (BigInt based)
//   FPU8087  the coprocessor: register stack, CW/SW/TW, exceptions, ESC D8..DF decoder
//
// F80 value: { sign: 0|1, exp: 0..0x7FFF (bias 16383), mant: BigInt 64 bits with an
// explicit integer bit }. Values are treated as immutable.
//
// Cycle counts: the typical execution clocks from the Intel 8087 data sheet
// (the "typical" column of the execution time table). EA calculation and the
// CPU's own bus cycles are not included.
//
// 80287 model: new FPU8087(mem, { model: '80287' }) adds FSTSW AX (DF E0; exec returns
// { ax } and the CPU writes AX) and FSETPM (DB E4: protected-mode pointer format in
// FSTENV/FSAVE/FLDENV/FRSTOR), and ignores FENI/FDISI. Like the 8087, it obeys the
// infinity control bit (projective or affine); the 80387 is affine only.
// Operand addresses: ea = { seg, off } -> (seg << 4) + off (20 bits), or, when ea has
// a `base` (a segment cache base, 24 bits), base + off masked to 24 bits.

const F80 = (() => {
  const JBIT = 1n << 63n;
  const LOW63 = JBIT - 1n;
  const make = (sign, exp, mant) => ({ sign, exp, mant });
  const zero = (sign = 0) => make(sign, 0, 0n);
  const inf = (sign = 0) => make(sign, 0x7FFF, JBIT);
  const INDEF = make(1, 0x7FFF, 0xC000000000000000n);
  const ONE = make(0, 0x3FFF, JBIT);

  // 8087 constant ROM, correctly rounded to 64 bits (round to nearest).
  const CONST = {
    one: ONE,
    l2t: make(0, 0x4000, 0xD49A784BCD1B8AFEn),
    l2e: make(0, 0x3FFF, 0xB8AA3B295C17F0BCn),
    pi: make(0, 0x4000, 0xC90FDAA22168C235n),
    lg2: make(0, 0x3FFD, 0x9A209A84FBCFF799n),
    ln2: make(0, 0x3FFE, 0xB17217F7D1CF79ACn),
    zero: zero(0),
  };

  function bitLen(n) {
    if (n < 0n) n = -n;
    if (n === 0n) return 0;
    const h = n.toString(16);
    return (h.length - 1) * 4 + 32 - Math.clz32(parseInt(h[0], 16));
  }

  // 'zero' | 'denormal' | 'normal' | 'unnormal' | 'inf' | 'nan'
  function cls(v) {
    if (v.exp === 0x7FFF) return (v.mant & LOW63) === 0n ? 'inf' : 'nan';
    if (v.mant === 0n) return 'zero';
    if (v.exp === 0) return 'denormal';
    return (v.mant & JBIT) ? 'normal' : 'unnormal';
  }

  // Exact finite value = (-1)^sign * m * 2^e.
  const unpack = (v) => ({ sign: v.sign, m: v.mant, e: (v.exp || 1) - 16446 });
  const topOf = (m, e) => bitLen(m) - 1 + e;   // exponent of the most significant bit

  // Round m * 2^-sh to an integer with rounding control rc (0 near, 1 down, 2 up, 3 chop).
  function shiftRound(m, sh, sign, rc) {
    if (sh <= 0) return { q: m << BigInt(-sh), inexact: false };
    const S = BigInt(sh);
    const q = m >> S, rem = m - (q << S);
    if (rem === 0n) return { q, inexact: false };
    let up;
    if (rc === 0) {
      const half = 1n << (S - 1n);
      up = rem > half || (rem === half && (q & 1n) === 1n);
    } else up = rc === 1 ? sign === 1 : rc === 2 ? sign === 0 : false;
    return { q: up ? q + 1n : q, inexact: true };
  }

  // Round |x| = m*2^e to prec bits; the lsb exponent is never below minLsb.
  function roundBits(sign, m, e, prec, minLsb, rc) {
    const top = topOf(m, e);
    let lsb = Math.max(top - prec + 1, minLsb);
    let { q, inexact } = shiftRound(m, lsb - e, sign, rc);
    if (bitLen(q) > prec) { q >>= 1n; lsb++; }
    return { q, lsb, inexact, top };
  }

  function overflowValue(sign, prec, rc) {
    const toInf = rc === 0 || (rc === 1 && sign === 1) || (rc === 2 && sign === 0);
    if (toInf) return inf(sign);
    return make(sign, 0x7FFE, ((1n << BigInt(prec)) - 1n) << BigInt(64 - prec));
  }

  // Round an exact value to the extended format with prec significant bits.
  // unbounded: no denormalization (used for the 8087 unmasked OE/UE bias adjust).
  function round(sign, m, e, prec = 64, rc = 0, unbounded = false) {
    const res = { v: zero(sign), inexact: false, overflow: false, tiny: false };
    if (m === 0n) return res;
    const r = roundBits(sign, m, e, prec, unbounded ? -Infinity : -16445, rc);
    res.inexact = r.inexact;
    res.tiny = r.top < -16382;
    if (r.q === 0n) return res;
    const b = bitLen(r.q), unb = r.lsb + b - 1;
    if (unb > 16383) {
      res.overflow = res.inexact = true;
      res.v = overflowValue(sign, prec, rc);
    } else if (unb < -16382) {
      const sh = r.lsb + 16445;
      res.v = make(sign, 0, sh >= 0 ? r.q << BigInt(sh) : r.q >> BigInt(-sh));
    } else res.v = make(sign, unb + 16383, r.q << BigInt(64 - b));
    return res;
  }

  // ---- IEEE single / double memory formats ----
  function toIEEE(v, fb, eb, rc = 0) {
    const bias = (1 << (eb - 1)) - 1, emax = (1 << eb) - 1;
    const FB = BigInt(fb), fmask = (1n << FB) - 1n;
    const S = BigInt(v.sign) << BigInt(fb + eb), EXPINF = BigInt(emax) << FB;
    const res = { bits: S, inexact: false, overflow: false, tiny: false };
    const c = cls(v);
    if (c === 'zero') return res;
    if (c === 'inf') { res.bits = S | EXPINF; return res; }
    if (c === 'nan') {
      let f = (v.mant >> BigInt(63 - fb)) & fmask;
      if (f === 0n) f = 1n << (FB - 1n);
      res.bits = S | EXPINF | f;
      return res;
    }
    const { m, e } = unpack(v);
    const r = roundBits(v.sign, m, e, fb + 1, 1 - bias - fb, rc);
    res.inexact = r.inexact;
    res.tiny = r.top < 1 - bias;
    if (r.q === 0n) return res;
    const b = bitLen(r.q), unb = r.lsb + b - 1;
    if (unb > bias) {
      res.overflow = res.inexact = true;
      const toInf = rc === 0 || (rc === 1 && v.sign === 1) || (rc === 2 && v.sign === 0);
      res.bits = S | (toInf ? EXPINF : (BigInt(emax - 1) << FB) | fmask);
    } else if (unb < 1 - bias) res.bits = S | r.q;
    else res.bits = S | (BigInt(unb + bias) << FB) | ((r.q << BigInt(fb + 1 - b)) & fmask);
    return res;
  }

  function fromIEEE(bits, fb, eb) {
    const bias = (1 << (eb - 1)) - 1, emax = (1 << eb) - 1;
    const FB = BigInt(fb), fmask = (1n << FB) - 1n;
    const sign = Number((bits >> BigInt(fb + eb)) & 1n);
    const ex = Number((bits >> FB) & BigInt(emax));
    const f = bits & fmask;
    if (ex === emax) return f === 0n ? inf(sign) : make(sign, 0x7FFF, JBIT | (f << BigInt(63 - fb)));
    if (ex === 0) return f === 0n ? zero(sign) : round(sign, f, 1 - bias - fb).v;
    return make(sign, ex - bias + 16383, JBIT | (f << BigInt(63 - fb)));
  }

  const dv = new DataView(new ArrayBuffer(8));
  function fromNumber(x) { dv.setFloat64(0, x); return fromIEEE(dv.getBigUint64(0), 52, 11); }
  function toNumber(v) { dv.setBigUint64(0, toIEEE(v, 52, 11).bits); return dv.getFloat64(0); }

  // Exact for |n| < 2^64.
  function fromBigInt(n) { const s = n < 0n ? 1 : 0; return round(s, s ? -n : n, 0).v; }

  // Round a finite value to an integer: { n: signed BigInt, inexact }.
  function toInt(v, rc = 0) {
    const { m, e } = unpack(v);
    const r = shiftRound(m, -e, v.sign, rc);
    return { n: v.sign ? -r.q : r.q, inexact: r.inexact };
  }
  // FRNDINT: round a finite value to an integral F80, keep the sign of zero.
  function roundInt(v, rc = 0) {
    const { m, e } = unpack(v);
    if (e >= 0 || m === 0n) return { v, inexact: false };
    const r = shiftRound(m, -e, v.sign, rc);
    return { v: round(v.sign, r.q, 0).v, inexact: r.inexact };
  }

  function toBytes(v) {
    const b = [];
    for (let i = 0; i < 8; i++) b.push(Number((v.mant >> BigInt(8 * i)) & 0xFFn));
    const se = (v.sign << 15) | v.exp;
    b.push(se & 0xFF, se >> 8);
    return b;
  }
  function fromBytes(b) {
    let mant = 0n;
    for (let i = 7; i >= 0; i--) mant = (mant << 8n) | BigInt(b[i] & 0xFF);
    const se = (b[8] & 0xFF) | ((b[9] & 0xFF) << 8);
    return make(se >> 15, se & 0x7FFF, mant);
  }

  // Compare magnitudes of unpacked finite values.
  function magCmpU(A, B) {
    if (A.m === 0n || B.m === 0n) return A.m === B.m ? 0 : A.m === 0n ? -1 : 1;
    const ta = topOf(A.m, A.e), tb = topOf(B.m, B.e);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const e = Math.min(A.e, B.e);
    const a = A.m << BigInt(A.e - e), b = B.m << BigInt(B.e - e);
    return a === b ? 0 : a < b ? -1 : 1;
  }
  // Ordered compare of two non-NaN values (affine infinities): -1, 0, 1.
  function cmp(a, b) {
    const sv = (v) => cls(v) === 'zero' ? 0 : v.sign ? -1 : 1;
    const sa = sv(a), sb = sv(b);
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (sa === 0) return 0;
    const ia = cls(a) === 'inf', ib = cls(b) === 'inf';
    const mag = ia || ib ? (ia === ib ? 0 : ia ? 1 : -1) : magCmpU(unpack(a), unpack(b));
    return sa * mag;
  }

  // Masked NaN propagation: the NaN operand, or the one with the larger significand.
  function pickNaN(a, b) {
    const na = a && cls(a) === 'nan', nb = b && cls(b) === 'nan';
    if (na && nb) return (a.mant & LOW63) >= (b.mant & LOW63) ? a : b;
    return na ? a : b;
  }

  // Exact decimal conversion with `digits` significant digits (round half up).
  function toString(v, digits = 18) {
    const c = cls(v), s = v.sign ? '-' : '';
    if (c === 'inf') return (v.sign ? '-' : '+') + 'inf';
    if (c === 'nan') return s + 'NaN';
    if (c === 'zero') return s + '0';
    const { m, e } = unpack(v);
    const P10 = (k) => 10n ** BigInt(k);
    let d = Math.floor(topOf(m, e) * Math.log10(2)), q;
    for (;;) {
      const p = digits - 1 - d;
      let num = m, den = 1n;
      if (p >= 0) num *= P10(p); else den *= P10(-p);
      if (e >= 0) num <<= BigInt(e); else den <<= BigInt(-e);
      q = (2n * num + den) / (2n * den);
      if (q >= P10(digits)) d++;
      else if (q < P10(digits - 1)) d--;
      else break;
    }
    const str = q.toString().replace(/0+$/, '');
    if (d >= 0 && d < digits) {
      const ip = str.slice(0, d + 1).padEnd(d + 1, '0'), fp = str.slice(d + 1);
      return s + ip + (fp ? '.' + fp : '');
    }
    if (d < 0 && d >= -5) return s + '0.' + '0'.repeat(-d - 1) + str;
    return s + str[0] + (str.length > 1 ? '.' + str.slice(1) : '') + 'e' + (d < 0 ? '-' : '+') + Math.abs(d);
  }

  // ---- high precision fixed point for the transcendental functions ----
  // A fixed point number X with scale S (BigInt) means X / 2^S.
  const G = 140;                       // working bits: 76 guard bits above 64
  const cache = new Map();
  const mulS = (a, b, S) => { const p = a * b; return p < 0n ? -((-p) >> S) : p >> S; };
  function isqrt(n) {
    if (n < 2n) return n;
    let x = 1n << BigInt((bitLen(n) >> 1) + 1);
    for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
  }
  function atanhInv(k, S) {            // atanh(1/k)
    const K = BigInt(k), K2 = K * K;
    let p = (1n << S) / K, sum = 0n;
    for (let n = 1n; p !== 0n; n += 2n, p /= K2) sum += p / n;
    return sum;
  }
  function atanInv(k, S) {             // atan(1/k)
    const K = BigInt(k), K2 = K * K;
    let p = (1n << S) / K, sum = 0n, neg = false;
    for (let n = 1n; p !== 0n; n += 2n, p /= K2, neg = !neg) sum += neg ? -(p / n) : p / n;
    return sum;
  }
  function cst(name, S) {              // 'ln2' or 'pi' at scale S
    const key = name + S;
    let v = cache.get(key);
    if (v === undefined) {
      const W = S + 16n;
      v = (name === 'ln2' ? 2n * atanhInv(3, W) : 16n * atanInv(5, W) - 4n * atanInv(239, W)) >> 16n;
      if (cache.size > 64) cache.clear();
      cache.set(key, v);
    }
    return v;
  }
  function toFx(v, S) {
    const { m, e } = unpack(v);
    const sh = e + Number(S);
    const mag = sh >= 0 ? m << BigInt(sh) : m >> BigInt(-sh);
    return v.sign ? -mag : mag;
  }
  const fromFx = (R, S) => ({ sign: R < 0n ? 1 : 0, m: R < 0n ? -R : R, e: -Number(S) });
  const expOf = (v) => { const { m, e } = unpack(v); return topOf(m, e); };
  function expm1Fx(t, S) {
    let sum = 0n, term = t;
    for (let k = 2n; term !== 0n; k++) { sum += term; term = mulS(term, t, S) / k; }
    return sum;
  }
  function atanhFx(t, S) {
    const t2 = mulS(t, t, S);
    let p = t, sum = 0n;
    for (let n = 1n; p !== 0n; n += 2n) { sum += p / n; p = mulS(p, t2, S); }
    return sum;
  }
  function atanFx(t, S) {              // 0 <= t <= 1
    const one = 1n << S;
    let k = 0n;
    while (t > one >> 4n) { t = (t << S) / (one + isqrt((one << S) + t * t)); k++; }
    const t2 = mulS(t, t, S);
    let p = t, sum = 0n;
    for (let n = 1n, neg = false; p !== 0n; n += 2n, neg = !neg) { sum += neg ? -(p / n) : p / n; p = mulS(p, t2, S); }
    return sum << k;
  }

  // 2^x - 1 for finite nonzero x. Returns an unrounded { sign, m, e }.
  function exp2m1(v) {
    const ex = expOf(v);
    if (ex > 15) return v.sign ? { sign: 1, m: (1n << 200n) - 1n, e: -200 } : { sign: 0, m: 1n, e: 1 << 20 };
    if (ex < 0) {
      const S = BigInt(G - ex);
      return fromFx(expm1Fx(mulS(toFx(v, S), cst('ln2', S), S), S), S);
    }
    const S = BigInt(G), one = 1n << S, xf = toFx(v, S);
    const k = xf >> S, f = xf - (k << S);
    const E = one + expm1Fx(mulS(f, cst('ln2', S), S), S);
    const kn = Number(k);
    return fromFx((kn >= 0 ? E << BigInt(kn) : E >> BigInt(-kn)) - one, S);
  }
  // log2 of the positive exact value m*2^e.
  function log2Of(m, e) {
    if (e > 0) { m <<= BigInt(e); e = 0; }
    const top = topOf(m, e);
    if (top === 0 || top === -1) {     // near 1: keep relative precision of the result
      const one = 1n << BigInt(-e), u = m - one;
      if (u === 0n) return { sign: 0, m: 0n, e: 0 };
      const S = BigInt(G + Math.max(0, -topOf(u, e)));
      const t = (u << S) / (m + one);
      return fromFx(((2n * atanhFx(t, S)) << S) / cst('ln2', S), S);
    }
    const S = BigInt(G), sh = G + e - top, one = 1n << S;
    const f = sh >= 0 ? m << BigInt(sh) : m >> BigInt(-sh);
    const t = ((f - one) << S) / (f + one);
    return fromFx((BigInt(top) << S) + ((2n * atanhFx(t, S)) << S) / cst('ln2', S), S);
  }
  const log2 = (v) => { const { m, e } = unpack(v); return log2Of(m, e); };
  // log2(1 + x): 'ninf' when x = -1, null when x < -1.
  function log2p1(v) {
    const { m, e } = unpack(v);
    const E = Math.min(e, 0), one = 1n << BigInt(-E), xm = m << BigInt(e - E);
    const z = v.sign ? one - xm : one + xm;
    if (z === 0n) return 'ninf';
    if (z < 0n) return null;
    return log2Of(z, E);
  }
  // tan(x) for finite nonzero x, null when cos(x) is exactly 0 at working precision.
  function tan(v) {
    const S = BigInt(G + Math.abs(expOf(v)));
    const x = toFx(v, S), P = cst('pi', S), half = P >> 1n, one = 1n << S;
    let r = x - (x / P) * P;
    if (r > half) r -= P; else if (r < -half) r += P;
    const r2 = mulS(r, r, S);
    let sn = 0n, cs = 0n, term = r;
    for (let n = 2n; term !== 0n; n += 2n) { sn += term; term = -mulS(term, r2, S) / (n * (n + 1n)); }
    term = one;
    for (let n = 1n; term !== 0n; n += 2n) { cs += term; term = -mulS(term, r2, S) / (n * (n + 1n)); }
    return cs === 0n ? null : fromFx((sn << S) / cs, S);
  }
  // atan2(y, x) for finite nonzero y and x.
  function atan2(y, x) {
    const Y = unpack(y), X = unpack(x);
    const swap = magCmpU(Y, X) > 0, N = swap ? X : Y, D = swap ? Y : X;
    const d = topOf(N.m, N.e) - topOf(D.m, D.e);
    const Sn = G + Math.max(0, -d), S = BigInt(Sn), sh = Sn + N.e - D.e;
    const t = sh >= 0 ? (N.m << BigInt(sh)) / D.m : N.m / (D.m << BigInt(-sh));
    let a = atanFx(t, S);
    if (swap || x.sign) {
      const P = cst('pi', S);
      if (swap) a = (P >> 1n) - a;
      if (x.sign) a = P - a;
    }
    return { sign: y.sign, m: a, e: -Sn };
  }
  // q * pi/4 as an unrounded { m, e }.
  const piQuarter = (q) => ({ m: BigInt(q) * cst('pi', BigInt(G)), e: -G - 2 });

  return {
    make, zero, inf, INDEF, ONE, CONST, JBIT, cls, unpack, bitLen, round, toIEEE, fromIEEE,
    fromNumber, toNumber, fromBigInt, toInt, roundInt, toBytes, fromBytes, cmp, pickNaN,
    toString, isqrt, exp2m1, log2, log2p1, tan, atan2, piQuarter,
  };
})();

const FPU8087 = (() => {
  const IE = 1, DE = 2, ZE = 4, OE = 8, UE = 16, PE = 32, IR = 0x80;
  const C0 = 0x100, C1 = 0x200, C2 = 0x400, C3 = 0x4000;
  const IEM = 0x80, IC = 0x1000;
  const EXC = ['IE', 'DE', 'ZE', 'OE', 'UE', 'PE'];
  const ABORT = { abort: true };       // thrown when an unmasked exception stops the instruction
  const K = F80.CONST;
  const str = (v) => F80.toString(v, 18);
  const reserved = () => ({ cycles: 0, text: 'reserved' });

  const FMT_BYTES = { f32: 4, f64: 8, f80: 10, i16: 2, i32: 4, i64: 8, bcd: 10 };
  const ARITH_FMT = { 0xD8: 'f32', 0xDA: 'i32', 0xDC: 'f64', 0xDE: 'i16' };
  // [add, mul, com, comp, sub, subr, div, divr] typical clocks with a memory operand
  const ARITH_CYC = {
    f32: [105, 118, 65, 68, 105, 105, 220, 220],
    i32: [120, 136, 85, 87, 120, 120, 236, 236],
    f64: [110, 161, 70, 72, 110, 110, 225, 225],
    i16: [125, 130, 80, 82, 125, 125, 230, 230],
  };
  const ARITH_MN = ['ADD', 'MUL', 'COM', 'COMP', 'SUB', 'SUBR', 'DIV', 'DIVR'];
  const OPSYM = { 0: '+', 1: '*', 4: '-', 5: '-', 6: '/', 7: '/' };
  // Memory forms of D9, DB, DD, DF: [kind, format] per reg field.
  const LDST = {
    0xD9: ['fld f32', null, 'fst f32', 'fstp f32', 'fldenv', 'fldcw', 'fstenv', 'fstcw'],
    0xDB: ['fld i32', null, 'fst i32', 'fstp i32', null, 'fld f80', null, 'fstp f80'],
    0xDD: ['fld f64', null, 'fst f64', 'fstp f64', 'frstor', null, 'fsave', 'fstsw'],
    0xDF: ['fld i16', null, 'fst i16', 'fstp i16', 'fld bcd', 'fld i64', 'fstp bcd', 'fstp i64'],
  };
  const LDST_CYC = {
    'fld f32': 43, 'fld f64': 46, 'fld f80': 57, 'fld i16': 50, 'fld i32': 56, 'fld i64': 64,
    'fld bcd': 300, 'fst f32': 87, 'fst f64': 100, 'fst i16': 85, 'fst i32': 87,
    'fstp f32': 89, 'fstp f64': 102, 'fstp f80': 55, 'fstp i16': 87, 'fstp i32': 89,
    'fstp i64': 100, 'fstp bcd': 530,
    fldenv: 40, fldcw: 10, fstenv: 45, fstcw: 15, frstor: 202, fsave: 202, fstsw: 15,
  };
  const FMT_NAME = { f32: 'm32real', f64: 'm64real', f80: 'm80real', i16: 'm16int', i32: 'm32int', i64: 'm64int', bcd: 'm80bcd' };
  const CONSTS = [['FLD1', K.one, 18], ['FLDL2T', K.l2t, 19], ['FLDL2E', K.l2e, 18],
    ['FLDPI', K.pi, 19], ['FLDLG2', K.lg2, 21], ['FLDLN2', K.ln2, 20], ['FLDZ', K.zero, 14]];
  const le = (big, n) => Array.from({ length: n }, (_, i) => Number((big >> BigInt(8 * i)) & 0xFFn));
  const words = (ws) => ws.flatMap((w) => [w & 0xFF, (w >> 8) & 0xFF]);

  class FPU8087 {
    constructor(mem, opts) {
      this.mem = mem;
      this._mn = ''; this._cyc = 0;         // all the fields start here (see CPU8086)
      // '80387' (the 80386 machine): the same interface as the 80287 (FSTSW AX, FSETPM, no
      // FENI / FDISI). The new 80387 instructions (FSIN, FCOS, FPREM1, FUCOM ...) are not in
      // this core, and it keeps the infinity control of the 80287.
      const mo = opts && opts.model;
      this.model = mo === '80287' || mo === '287' ? '80287' : mo === '80387' || mo === '387' ? '80387' : '8087';
      this.is287 = this.model !== '8087';
      this.pm = false;     // 80287: FSETPM was executed (protected-mode pointer format)
      // 80287 pointers for the protected-mode environment format. The CPU sets nextIpOff /
      // nextIpSel (CS:IP of the ESC instruction) before exec.
      this.ipOff = 0; this.ipSel = 0; this.dpOff = 0; this.dpSel = 0;
      this.nextIpOff = undefined; this.nextIpSel = 0;
      this.regs = Array.from({ length: 8 }, () => F80.zero());
      this.empty = new Array(8).fill(true);   // physical register is empty (tag 3)
      this.busyCycles = 0;
      this.lastMem = [];
      this.instrPtr = 0;   // 20-bit address of the last ESC instruction (the CPU may set it)
      this.dataPtr = 0;    // 20-bit address of the last memory operand
      this.opcode11 = 0;   // 11-bit opcode of the last non-control instruction
      this.reset();
    }

    // FNINIT state. (Called by the machine at power-on too, so it also clears the FSETPM
    // state; FNINIT and FSAVE keep that state.)
    reset() {
      this.pm = false;
      this.cw = 0x03FF;
      this._sw = 0;
      this.top = 0;
      this.empty.fill(true);
      this.intRequest = false;
      this.instrPtr = this.dataPtr = this.opcode11 = 0;
    }
    // The 8087 and the original 80287 obey the infinity control bit (projective after
    // FNINIT); only the 80387 and the 80287XL are affine only. Software such as the
    // Borland C runtime uses this difference to tell an 80287 from an 80387.
    get affine() { return (this.cw & IC) !== 0; }

    // Memory operand of an ESC instruction: { bytes, write } or null (register form or
    // reserved encoding). The 80286 uses it to move the operand and check the limit.
    memOperand(opcode, modrm) {
      if ((modrm >> 6) === 3) return null;
      const reg = (modrm >> 3) & 7;
      if (ARITH_FMT[opcode]) return { bytes: FMT_BYTES[ARITH_FMT[opcode]], write: false };
      const kind = LDST[opcode] && LDST[opcode][reg];
      if (!kind) return null;
      const [k, fmt] = kind.split(' ');
      if (fmt) return { bytes: FMT_BYTES[fmt], write: k !== 'fld' };
      const n = { fldcw: 2, fstcw: 2, fstsw: 2, fldenv: 14, fstenv: 14, frstor: 94, fsave: 94 }[k];
      return { bytes: n, write: k === 'fstcw' || k === 'fstsw' || k === 'fstenv' || k === 'fsave' };
    }

    get sw() { return (this._sw & 0x47FF) | (this.top << 11) | (this.busyCycles > 0 ? 0x8000 : 0); }
    set sw(v) { this._sw = v & 0x47FF; this.top = (v >> 11) & 7; }
    get tw() { let w = 0; for (let p = 0; p < 8; p++) w |= this._tagPhys(p) << (2 * p); return w; }
    set tw(w) { for (let p = 0; p < 8; p++) this.empty[p] = ((w >> (2 * p)) & 3) === 3; }
    get prec() { return [24, 64, 53, 64][(this.cw >> 8) & 3]; }   // PC=01 is reserved
    get rc() { return (this.cw >> 10) & 3; }

    _tagPhys(p) {
      if (this.empty[p]) return 3;
      const c = F80.cls(this.regs[p]);
      return c === 'zero' ? 1 : c === 'normal' || c === 'unnormal' ? 0 : 2;
    }
    st(i) { return this.regs[(this.top + i) & 7]; }
    tag(i) { return this._tagPhys((this.top + i) & 7); }
    describe(i) { return this.tag(i) === 3 ? 'empty' : str(this.st(i)); }

    // ---- execution entry ----
    exec(opcode, modrm, ea) {
      this.lastMem = [];
      this._mn = 'reserved';
      this._cyc = 0;
      const mod = modrm >> 6, reg = (modrm >> 3) & 7, rm = modrm & 7;
      const control = mod === 3 ? (opcode === 0xDB && modrm >= 0xE0 && modrm <= 0xE4) || (opcode === 0xDF && modrm === 0xE0)
        : (opcode === 0xD9 || opcode === 0xDD) && reg >= 4;
      let res;
      try {
        res = mod === 3 ? this._execReg(opcode, reg, rm, modrm) : this._execMem(opcode, reg, ea);
      } catch (e) {
        if (e !== ABORT) throw e;
        const ex = EXC.filter((_, b) => this._sw & ~this.cw & (1 << b)).join(' ');
        res = { cycles: this._cyc, text: `${this._mn}: unmasked ${ex} exception, no result` };
      }
      if (!control && res.text !== 'reserved') {
        this.opcode11 = ((opcode & 7) << 8) | modrm;
        if (ea) { this.dataPtr = this._addr(ea, 0); this.dpOff = ea.off & 0xFFFF; this.dpSel = ea.seg & 0xFFFF; }
        // 80287 pointers: the CPU gives them before exec; only non-control instructions keep them
        if (this.nextIpOff !== undefined) { this.ipOff = this.nextIpOff; this.ipSel = this.nextIpSel; }
      }
      this._updateIR();
      this.busyCycles = res.cycles;
      return res;
    }

    _op(mn, cycles) { this._mn = mn; this._cyc = cycles; }
    _res(text) { return { cycles: this._cyc, text: `${this._mn}: ${text}` }; }

    // ---- exceptions ----
    _ex(bit) { this._sw |= bit; return (this.cw & bit) === 0; }   // true when unmasked
    _fault(bit) { if (this._ex(bit)) throw ABORT; }
    _ie() { this._fault(IE); return F80.INDEF; }                     // masked response
    _den(...vs) { for (const v of vs) if (F80.cls(v) === 'denormal') this._fault(DE); }
    _updateIR() {
      if (this._sw & ~this.cw & 0x3F) this._sw |= IR; else this._sw &= ~IR;
      this.intRequest = (this._sw & IR) !== 0 && (this.cw & IEM) === 0;
    }
    _cc(c3, c2, c1, c0) {
      let w = this._sw & ~(C0 | C2 | C3 | (c1 === null ? 0 : C1));
      if (c0) w |= C0;
      if (c2) w |= C2;
      if (c3) w |= C3;
      if (c1) w |= C1;
      this._sw = w;
    }

    // Round an exact result into a register, with the 8087 OE/UE responses.
    _toReg(sign, m, e, prec = this.prec) {
      const rc = this.rc;
      let r = F80.round(sign, m, e, prec, rc);
      if (r.overflow) {
        if (this._ex(OE)) r = F80.round(sign, m, e - 24576, prec, rc, true);
      } else if (r.tiny) {
        if (this.cw & UE) { if (r.inexact) this._ex(UE); }
        else { this._ex(UE); r = F80.round(sign, m, e + 24576, prec, rc, true); }
      }
      if (r.inexact) this._ex(PE);
      return r.v;
    }

    // ---- stack ----
    _phys(i) { return (this.top + i) & 7; }
    _get(i) { const p = this._phys(i); return this.empty[p] ? this._ie() : this.regs[p]; }
    _set(i, v) { const p = this._phys(i); this.regs[p] = v; this.empty[p] = false; }
    _pushRaw(v) { this.top = (this.top - 1) & 7; this.regs[this.top] = v; this.empty[this.top] = false; }
    _push(v) { if (!this.empty[(this.top - 1) & 7]) v = this._ie(); this._pushRaw(v); }
    _pop() { this.empty[this.top] = true; this.top = (this.top + 1) & 7; }

    // ---- memory ----
    _addr(ea, i) {
      if (ea.base !== undefined) return (ea.base + ((ea.off + i) & 0xFFFF)) & 0xFFFFFF;
      return ((ea.seg << 4) + ((ea.off + i) & 0xFFFF)) & 0xFFFFF;
    }
    _rdBytes(ea, n) {
      const b = [];
      for (let i = 0; i < n; i++) {
        const a = this._addr(ea, i), v = this.mem.read8(a) & 0xFF;
        b.push(v);
        this.lastMem.push({ addr: a, value: v, write: false });
      }
      return b;
    }
    _wrBytes(ea, bytes) {
      bytes.forEach((v, i) => {
        const a = this._addr(ea, i);
        this.mem.write8(a, v);
        this.lastMem.push({ addr: a, value: v, write: true });
      });
    }
    _rdInt(ea, n) { return this._rdBytes(ea, n).reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n); }

    _load(fmt, ea) {
      if (fmt === 'f80') return F80.fromBytes(this._rdBytes(ea, 10));
      if (fmt === 'bcd') {
        const b = this._rdBytes(ea, 10);
        let n = 0n;
        for (let i = 8; i >= 0; i--) n = n * 100n + BigInt((b[i] >> 4) * 10 + (b[i] & 15));
        const v = F80.fromBigInt(n);
        return F80.make(b[9] >> 7, v.exp, v.mant);
      }
      const x = this._rdInt(ea, FMT_BYTES[fmt]);
      if (fmt[0] === 'i') return F80.fromBigInt(BigInt.asIntN(FMT_BYTES[fmt] * 8, x));
      const [fb, eb] = fmt === 'f32' ? [23, 8] : [52, 11];
      const v = F80.fromIEEE(x, fb, eb);
      if (F80.cls(v) === 'nan') this._fault(IE);
      else if (((x >> BigInt(fb)) & BigInt((1 << eb) - 1)) === 0n && (x & ((1n << BigInt(fb)) - 1n))) this._fault(DE);
      return v;
    }

    // Convert and write; unmasked IE/DE/OE/UE abort before anything is written.
    _store(fmt, ea, v) {
      const c = F80.cls(v), finite = c !== 'nan' && c !== 'inf';
      let bytes = null;
      if (fmt === 'f32' || fmt === 'f64') {
        const [fb, eb] = fmt === 'f32' ? [23, 8] : [52, 11];
        this._den(v);
        const r = F80.toIEEE(v, fb, eb, this.rc);
        if (r.overflow && this._ex(OE)) throw ABORT;
        if (r.tiny && (r.inexact || !(this.cw & UE)) && this._ex(UE)) throw ABORT;
        if (r.inexact) this._ex(PE);
        bytes = le(r.bits, FMT_BYTES[fmt]);
      } else if (fmt === 'f80') bytes = F80.toBytes(v);
      else if (fmt === 'bcd') {
        const r = finite ? F80.toInt(v, this.rc) : null;
        const mag = r && (r.n < 0n ? -r.n : r.n);
        if (r && mag < 10n ** 18n) {
          bytes = [];
          let t = mag;
          for (let i = 0; i < 9; i++) { const lo = Number(t % 10n); t /= 10n; bytes.push(lo | Number(t % 10n) << 4); t /= 10n; }
          bytes.push(v.sign ? 0x80 : 0);
          if (r.inexact) this._ex(PE);
        } else {
          this._fault(IE);
          bytes = [0, 0, 0, 0, 0, 0, 0, 0xC0, 0xFF, 0xFF];
        }
      } else {
        const bits = FMT_BYTES[fmt] * 8, lim = 1n << BigInt(bits - 1);
        const r = finite ? F80.toInt(v, this.rc) : null;
        let n;
        if (r && r.n >= -lim && r.n < lim) { n = r.n; if (r.inexact) this._ex(PE); }
        else { this._fault(IE); n = -lim; }
        bytes = le(BigInt.asUintN(bits, n), bits / 8);
      }
      this._wrBytes(ea, bytes);
    }

    // ---- arithmetic core: a op b, op in add | sub | mul | div ----
    _arith(op, a, b) {
      const ca = F80.cls(a), cb = F80.cls(b);
      if (ca === 'nan' || cb === 'nan') { this._fault(IE); return F80.pickNaN(a, b); }
      const ia = ca === 'inf', ib = cb === 'inf', za = ca === 'zero', zb = cb === 'zero';
      if (op === 'add' || op === 'sub') {
        const sb = op === 'sub' ? b.sign ^ 1 : b.sign;
        if (ia || ib) {
          if (ia && ib && (!this.affine || a.sign !== sb)) return this._ie();
          return F80.inf(ia ? a.sign : sb);
        }
        this._den(a, b);
        if (za && zb) return F80.zero(a.sign === sb ? a.sign : this.rc === 1 ? 1 : 0);
        let { m: ma, e: ea } = F80.unpack(a), { m: mb, e: eb } = F80.unpack(b);
        if (!za && !zb) {  // a far smaller operand only acts as a sticky bit
          if (ea - eb > 140) { mb = 1n; eb = ea - 140; } else if (eb - ea > 140) { ma = 1n; ea = eb - 140; }
        }
        const e = Math.min(ea, eb);
        const va = ma << BigInt(ea - e), vb = mb << BigInt(eb - e);
        const sum = (a.sign ? -va : va) + (sb ? -vb : vb);
        if (sum === 0n) return F80.zero(this.rc === 1 ? 1 : 0);
        return this._toReg(sum < 0n ? 1 : 0, sum < 0n ? -sum : sum, e);
      }
      const sign = a.sign ^ b.sign;
      if (op === 'mul') {
        if ((ia && zb) || (za && ib)) return this._ie();
        if (ia || ib) return F80.inf(sign);
        this._den(a, b);
        if (za || zb) return F80.zero(sign);
        const A = F80.unpack(a), B = F80.unpack(b);
        return this._toReg(sign, A.m * B.m, A.e + B.e);
      }
      if ((ia && ib) || (za && zb)) return this._ie();
      if (ia) return F80.inf(sign);
      if (ib) return F80.zero(sign);
      this._den(a, b);
      if (zb) { this._fault(ZE); return F80.inf(sign); }
      if (za) return F80.zero(sign);
      const A = F80.unpack(a), B = F80.unpack(b);
      const k = Math.max(0, F80.bitLen(B.m) - F80.bitLen(A.m) + 67);
      const num = A.m << BigInt(k), q = num / B.m;
      return this._toReg(sign, (q << 1n) | (num === q * B.m ? 0n : 1n), A.e - B.e - k - 1);
    }

    _sqrt(a) {
      const c = F80.cls(a);
      if (c === 'nan') { this._fault(IE); return a; }
      if (c === 'zero') return a;
      if (a.sign) return this._ie();
      if (c === 'inf') return this.affine ? a : this._ie();
      this._den(a);
      let { m, e } = F80.unpack(a);
      if (e & 1) { m <<= 1n; e -= 1; }
      const k = Math.max(0, Math.ceil((140 - F80.bitLen(m)) / 2));
      const n = m << BigInt(2 * k), r = F80.isqrt(n);
      return this._toReg(0, (r << 1n) | (n === r * r ? 0n : 1n), e / 2 - k - 1);
    }

    // Compare a with b; sets C3 C2 C0. Returns '>', '<', '=' or 'unordered'.
    _compare(a, b) {
      const ca = F80.cls(a), cb = F80.cls(b);
      let rel;
      if (ca === 'nan' || cb === 'nan') { this._fault(IE); rel = 2; }
      else if (!this.affine && (ca === 'inf' || cb === 'inf')) rel = ca === cb ? 0 : 2;  // projective
      else { this._den(a, b); rel = F80.cmp(a, b); }
      this._cc(rel === 0 || rel === 2, rel === 2, null, rel === -1 || rel === 2);
      return ['<', '=', '>', 'unordered'][rel + 1];
    }

    // ---- register forms ----
    _execReg(op, reg, i, modrm) {
      switch (op) {
        case 0xD8: return this._arithReg(op, reg, i);
        case 0xDC: return reg === 2 || reg === 3 ? reserved() : this._arithReg(op, reg, i);
        case 0xDF:
          if (modrm === 0xE0 && this.is287) {
            this._op('FSTSW AX', 10);
            const s = this.sw;
            return { cycles: this._cyc, text: `FSTSW AX: AX = SW = ${s.toString(16).toUpperCase().padStart(4, '0')}`, ax: s };
          }
          return reserved();
        case 0xDE:
          if (reg === 3) return modrm === 0xD9 ? this._fcom(1, 2, 'FCOMPP', 50) : reserved();
          return reg === 2 ? reserved() : this._arithReg(op, reg, i);
        case 0xD9: return this._d9reg(reg, i, modrm);
        case 0xDB: return this._control(modrm);
        case 0xDD:
          if (reg === 0) {
            this._op('FFREE', 11);
            this.empty[this._phys(i)] = true;
            return this._res(`ST${i} = empty`);
          }
          if (reg === 2 || reg === 3) {
            this._op(reg === 2 ? 'FST' : 'FSTP', reg === 2 ? 18 : 20);
            const v = this._get(0);
            this._set(i, v);
            if (reg === 3) this._pop();
            return this._res(`ST${i} = ST0 = ${str(v)}${reg === 3 ? ', pop' : ''}`);
          }
          return reserved();
        default: return reserved();
      }
    }

    // D8: ST0 = ST0 op ST(i). DC: ST(i) = ST(i) op ST0. DE: as DC, then pop.
    // In all three, reg 4 computes ST0 - ST(i), reg 5 ST(i) - ST0, reg 6 ST0 / ST(i),
    // reg 7 ST(i) / ST0 (Intel encoding: DC E8+i is FSUB ST(i),ST0 = ST(i) - ST0).
    _arithReg(op, reg, i) {
      const toSti = op !== 0xD8, pop = op === 0xDE;
      if (reg === 2 || reg === 3) return this._fcom(i, reg === 3 ? 1 : 0, reg === 3 ? 'FCOMP' : 'FCOM', reg === 3 ? 47 : 45);
      const base = toSti && reg >= 4 ? ARITH_MN[reg ^ 1] : ARITH_MN[reg];
      const a0 = this.st(0), ai = this.st(i);
      const short = (v) => (v.mant & 0xFFFFFFFFFFn) === 0n;
      // typical clocks: [reg form, popping form]; FMUL has a faster "short" case (<= 24-bit significand)
      const [c, cp] = reg === 1 ? (short(a0) || short(ai) ? [97, 100] : [138, 142]) : reg < 6 ? [85, 90] : [198, 202];
      this._op('F' + base + (pop ? 'P' : ''), pop ? cp : c);
      const s0 = this._get(0), si = this._get(i);
      const [x, y, xn, yn] = reg === 5 || reg === 7 ? [si, s0, `ST${i}`, 'ST0'] : [s0, si, 'ST0', `ST${i}`];
      const r = this._arith(['add', 'mul', '', '', 'sub', 'sub', 'div', 'div'][reg], x, y);
      const d = toSti ? i : 0;
      this._set(d, r);
      if (pop) this._pop();
      return this._res(`ST${d} = ${xn} ${OPSYM[reg]} ${yn} = ${str(r)}${pop ? ', pop' : ''}`);
    }

    _fcom(i, pops, mn, cyc) {
      this._op(mn, cyc);
      const a = this._get(0), b = this._get(i);
      const rel = this._compare(a, b);
      for (let k = 0; k < pops; k++) this._pop();
      return this._res(`ST0 (${str(a)}) ${rel} ST${i} (${str(b)})${pops ? pops === 2 ? ', pop 2' : ', pop' : ''}`);
    }

    _control(modrm) {
      switch (modrm) {
        case 0xE0:
          if (this.is287) { this._op('FENI', 2); return this._res('ignored by the ' + this.model); }
          this._op('FENI', 5); this.cw &= ~IEM; return this._res('interrupts enabled (IEM=0)');
        case 0xE1:
          if (this.is287) { this._op('FDISI', 2); return this._res('ignored by the ' + this.model); }
          this._op('FDISI', 5); this.cw |= IEM; return this._res('interrupts disabled (IEM=1)');
        case 0xE4:
          if (!this.is287) return reserved();
          this._op('FSETPM', 2); this.pm = true;
          return this._res('protected-mode addressing (environment holds selectors and offsets)');
        case 0xE2:
          this._op('FNCLEX', 5);
          this._sw &= ~(0x3F | IR);
          return this._res('exception flags cleared');
        case 0xE3: { this._op('FNINIT', 5); const pm = this.pm; this.reset(); this.pm = pm; } return this._res('CW = 03FF, SW = 0000, TW = FFFF');
        default: return reserved();
      }
    }

    _d9reg(reg, i, modrm) {
      switch (reg) {
        case 0: {
          this._op('FLD', 20);
          const v = this._get(i);
          this._push(v);
          return this._res(`push ST${i} = ${str(v)}`);
        }
        case 1: {
          this._op('FXCH', 12);
          const a = this._get(0), b = this._get(i);
          this._set(0, b);
          this._set(i, a);
          return this._res(`ST0 <-> ST${i}: ST0 = ${str(b)}, ST${i} = ${str(a)}`);
        }
        case 2: if (modrm !== 0xD0) return reserved(); this._op('FNOP', 13); return this._res('no operation');
        case 4:
          if (modrm === 0xE0 || modrm === 0xE1) {
            this._op(modrm === 0xE0 ? 'FCHS' : 'FABS', modrm === 0xE0 ? 15 : 14);
            const v = this._get(0);
            const r = F80.make(modrm === 0xE0 ? v.sign ^ 1 : 0, v.exp, v.mant);
            this._set(0, r);
            return this._res(`ST0 = ${modrm === 0xE0 ? '-ST0' : '|ST0|'} = ${str(r)}`);
          }
          if (modrm === 0xE4) {
            this._op('FTST', 42);
            const a = this._get(0);
            return this._res(`ST0 (${str(a)}) ${this._compare(a, F80.zero())} 0`);
          }
          if (modrm === 0xE5) return this._fxam();
          return reserved();
        case 5: {
          if (modrm === 0xEF) return reserved();
          const [mn, v, cyc] = CONSTS[modrm - 0xE8];
          this._op(mn, cyc);
          this._push(v);
          return this._res(`push ${str(v)}`);
        }
        case 6: case 7: {
          const fn = [this._f2xm1, () => this._fyl2x(false), this._fptan, this._fpatan, this._fxtract, null, () => this._stepTop(-1), () => this._stepTop(1),
            this._fprem, () => this._fyl2x(true), this._fsqrt, null, this._frndint, this._fscale, null, null][modrm - 0xF0];
          return fn ? fn.call(this) : reserved();
        }
        default: return reserved();
      }
    }

    _stepTop(d) {
      this._op(d < 0 ? 'FDECSTP' : 'FINCSTP', 9);
      this.top = (this.top + d) & 7;
      return this._res(`TOP = ${this.top}`);
    }

    _fxam() {
      this._op('FXAM', 17);
      const p = this._phys(0), v = this.regs[p];
      const c = this.empty[p] ? 'empty' : F80.cls(v);
      const [c3, c2, c0] = { unnormal: [0, 0, 0], nan: [0, 0, 1], normal: [0, 1, 0], inf: [0, 1, 1],
        zero: [1, 0, 0], empty: [1, 0, 1], denormal: [1, 1, 0] }[c];
      this._cc(c3, c2, v.sign, c0);
      return this._res(`ST0 is ${c === 'empty' ? '' : v.sign ? '-' : '+'}${c}: C3=${c3} C2=${c2} C1=${v.sign} C0=${c0}`);
    }

    _fsqrt() {
      this._op('FSQRT', 183);
      const r = this._sqrt(this._get(0));
      this._set(0, r);
      return this._res(`ST0 = sqrt(ST0) = ${str(r)}`);
    }

    _frndint() {
      this._op('FRNDINT', 45);
      const v = this._get(0), c = F80.cls(v);
      let r = v;
      if (c === 'nan') this._fault(IE);
      else if (c !== 'inf' && c !== 'zero') {
        this._den(v);
        const x = F80.roundInt(v, this.rc);
        if (x.inexact) this._ex(PE);
        r = x.v;
      }
      this._set(0, r);
      return this._res(`ST0 = round(ST0) = ${str(r)}`);
    }

    _fscale() {
      this._op('FSCALE', 35);
      const a = this._get(0), b = this._get(1), ca = F80.cls(a), cb = F80.cls(b);
      let r;
      if (ca === 'nan' || cb === 'nan') { this._fault(IE); r = F80.pickNaN(a, b); }
      else if (cb === 'inf') {
        if (b.sign) r = ca === 'inf' ? this._ie() : F80.zero(a.sign);
        else r = ca === 'zero' ? this._ie() : F80.inf(a.sign);
      } else if (ca === 'inf' || ca === 'zero') r = a;
      else {
        this._den(a, b);
        let n = F80.toInt(b, 3).n;
        if (n > 100000n) n = 100000n;
        if (n < -100000n) n = -100000n;
        const A = F80.unpack(a);
        r = this._toReg(a.sign, A.m, A.e + Number(n), 64);
      }
      this._set(0, r);
      return this._res(`ST0 = ST0 * 2^trunc(ST1) = ${str(r)}`);
    }

    _fxtract() {
      this._op('FXTRACT', 50);
      const v = this._get(0);
      let ex, sig;
      if (!this.empty[(this.top - 1) & 7]) ex = sig = this._ie();
      else {
        const c = F80.cls(v);
        if (c === 'nan') { this._fault(IE); ex = sig = v; }
        else if (c === 'zero') { ex = F80.zero(v.sign); sig = v; }   // 8087: both results zero
        else if (c === 'inf') { ex = F80.inf(0); sig = v; }
        else {
          this._den(v);
          const { m, e } = F80.unpack(v), top = F80.bitLen(m) - 1 + e;
          ex = F80.fromBigInt(BigInt(top));
          sig = F80.round(v.sign, m, e - top).v;
        }
      }
      this._set(0, ex);
      this._pushRaw(sig);
      return this._res(`ST1 = exponent = ${str(ex)}, ST0 = significand = ${str(sig)}`);
    }

    // 8087 partial remainder: ST0 = ST0 - q*ST1, q truncated.
    _fprem() {
      this._op('FPREM', 125);
      const a = this._get(0), b = this._get(1), ca = F80.cls(a), cb = F80.cls(b);
      let r = a, q = 0n, partial = false;
      if (ca === 'nan' || cb === 'nan') { this._fault(IE); r = F80.pickNaN(a, b); }
      else if (ca === 'inf' || cb === 'zero') r = this._ie();
      else if (cb !== 'inf' && ca !== 'zero') {
        this._den(a, b);
        const A = F80.unpack(a), B = F80.unpack(b);
        const d = (F80.bitLen(A.m) - 1 + A.e) - (F80.bitLen(B.m) - 1 + B.e);
        // Exponent difference >= 64: reduce by 2^32..2^63 (shift is a multiple of 32).
        const sh = d < 64 ? 0 : d - (32 + ((d - 64) % 32));
        partial = d >= 64;
        const e = Math.min(A.e, B.e + sh);
        const MA = A.m << BigInt(A.e - e), MB = B.m << BigInt(B.e + sh - e);
        q = MA / MB;
        r = this._toReg(a.sign, MA - q * MB, e, 64);
      }
      this._set(0, r);
      if (partial) this._cc(0, 1, 0, 0);
      else this._cc(Number((q >> 1n) & 1n), 0, Number(q & 1n), Number((q >> 2n) & 1n));
      return this._res(`ST0 = ST0 rem ST1 = ${str(r)}${partial ? ' (partial, C2=1)' : `, q mod 8 = ${Number(q & 7n)}`}`);
    }

    _f2xm1() {
      this._op('F2XM1', 500);
      const v = this._get(0), c = F80.cls(v);
      let r = v;
      if (c === 'nan') this._fault(IE);
      else if (c === 'inf') r = v.sign ? F80.make(1, 0x3FFF, F80.JBIT) : v;
      else if (c !== 'zero') {
        this._den(v);
        const x = F80.exp2m1(v);
        r = this._toReg(x.sign, x.m, x.e, 64);
      }
      this._set(0, r);
      return this._res(`ST0 = 2^ST0 - 1 = ${str(r)}`);
    }

    // FYL2X: ST1 = ST1 * log2(ST0), pop. FYL2XP1: ST1 = ST1 * log2(ST0 + 1), pop.
    _fyl2x(p1) {
      this._op(p1 ? 'FYL2XP1' : 'FYL2X', p1 ? 850 : 950);
      const x = this._get(0), y = this._get(1);
      const r = this._ylog(x, y, p1);
      this._set(1, r);
      this._pop();
      return this._res(`ST1 = ST1 * log2(ST0${p1 ? ' + 1' : ''}) = ${str(r)}, pop`);
    }

    _ylog(x, y, p1) {
      const cx = F80.cls(x), cy = F80.cls(y);
      if (cx === 'nan' || cy === 'nan') { this._fault(IE); return F80.pickNaN(x, y); }
      let L, logZero = false;
      if (cx === 'inf') { if (x.sign) return this._ie(); L = { k: 'inf', sign: 0 }; }
      else if (cx === 'zero') {
        if (p1) L = { k: 'zero', sign: x.sign };
        else { L = { k: 'inf', sign: 1 }; logZero = true; }
      } else if (!p1 && x.sign) return this._ie();
      else {
        this._den(x);
        const r = p1 ? F80.log2p1(x) : F80.log2(x);
        if (r === null) return this._ie();
        if (r === 'ninf') { L = { k: 'inf', sign: 1 }; logZero = true; }
        else L = r.m === 0n ? { k: 'zero', sign: 0 } : { k: 'fin', ...r };
      }
      this._den(y);
      const sign = L.sign ^ y.sign;
      if ((L.k === 'inf' && cy === 'zero') || (L.k === 'zero' && cy === 'inf')) return this._ie();
      if (L.k === 'inf') { if (logZero) this._fault(ZE); return F80.inf(sign); }
      if (cy === 'inf') return F80.inf(sign);
      if (L.k === 'zero' || cy === 'zero') return F80.zero(sign);
      const Y = F80.unpack(y);
      return this._toReg(sign, L.m * Y.m, L.e + Y.e, 64);
    }

    // FPTAN: ST0 = y, then push x = 1.0, so ST1/ST0 = tan(old ST0).
    _fptan() {
      this._op('FPTAN', 450);
      const v = this._get(0), c = F80.cls(v);
      let y, x = F80.ONE;
      if (!this.empty[(this.top - 1) & 7]) y = x = this._ie();
      else if (c === 'nan') { this._fault(IE); y = x = v; }
      else if (c === 'inf') y = x = this._ie();
      else if (c === 'zero') y = v;
      else {
        this._den(v);
        const t = F80.tan(v);
        y = t ? this._toReg(t.sign, t.m, t.e, 64) : F80.inf(v.sign);
      }
      this._set(0, y);
      this._pushRaw(x);
      return this._res(`ST1 = y = ${str(y)}, push x = ${str(x)} (y/x = tan)`);
    }

    // FPATAN: ST1 = atan(ST1 / ST0) (quadrant from the signs), pop.
    _fpatan() {
      this._op('FPATAN', 650);
      const x = this._get(0), y = this._get(1), cx = F80.cls(x), cy = F80.cls(y);
      let r;
      if (cx === 'nan' || cy === 'nan') { this._fault(IE); r = F80.pickNaN(x, y); }
      else if (cx === 'inf' || cy === 'inf' || cx === 'zero' || cy === 'zero') {
        let q;   // result = q * pi/4
        if (cy === 'inf') q = cx === 'inf' ? (x.sign ? 3 : 1) : 2;
        else if (cx === 'inf' || cy === 'zero') q = x.sign ? 4 : 0;
        else q = 2;
        if (q === 0) r = F80.zero(y.sign);
        else { const p = F80.piQuarter(q); r = this._toReg(y.sign, p.m, p.e, 64); }
      } else {
        this._den(x, y);
        const a = F80.atan2(y, x);
        r = this._toReg(a.sign, a.m, a.e, 64);
      }
      this._set(1, r);
      this._pop();
      return this._res(`ST1 = atan(ST1 / ST0) = ${str(r)}, pop`);
    }

    // ---- memory forms ----
    _execMem(op, reg, ea) {
      if (ARITH_FMT[op]) return this._arithMem(op, reg, ea);
      const kind = LDST[op] && LDST[op][reg];
      if (!kind) return reserved();
      const cyc = LDST_CYC[kind];
      const [k, fmt] = kind.split(' ');
      if (!fmt) return this._envOp(k, ea, cyc);
      const mn = (fmt === 'bcd' ? 'FB' : fmt[0] === 'i' ? 'FI' : 'F') + k.slice(1).toUpperCase();
      this._op(mn, cyc);
      if (k === 'fld') {
        const v = this._load(fmt, ea);
        this._push(v);
        return this._res(`push ${FMT_NAME[fmt]} = ${str(v)}`);
      }
      const v = this._get(0);
      this._store(fmt, ea, v);
      if (k === 'fstp') this._pop();
      return this._res(`${FMT_NAME[fmt]} = ST0 = ${str(v)}${k === 'fstp' ? ', pop' : ''}`);
    }

    _arithMem(op, reg, ea) {
      const fmt = ARITH_FMT[op];
      this._op((fmt[0] === 'i' ? 'FI' : 'F') + ARITH_MN[reg], ARITH_CYC[fmt][reg]);
      const m = this._load(fmt, ea), a = this._get(0);
      const mt = `${FMT_NAME[fmt]}(${str(m)})`;
      if (reg === 2 || reg === 3) {
        const rel = this._compare(a, m);
        if (reg === 3) this._pop();
        return this._res(`ST0 (${str(a)}) ${rel} ${mt}${reg === 3 ? ', pop' : ''}`);
      }
      const rev = reg === 5 || reg === 7;
      const r = this._arith(['add', 'mul', '', '', 'sub', 'sub', 'div', 'div'][reg], rev ? m : a, rev ? a : m);
      this._set(0, r);
      return this._res(`ST0 = ${rev ? mt : 'ST0'} ${OPSYM[reg]} ${rev ? 'ST0' : mt} = ${str(r)}`);
    }

    // Real-mode 8087 environment: CW SW TW IP15..0 (IP19..16<<12 | opcode) DP15..0 (DP19..16<<12)
    // 80287 after FSETPM: CW SW TW IP-offset CS-selector operand-offset operand-selector
    _env() {
      if (this.pm) return [this.cw, this.sw & 0x7FFF, this.tw, this.ipOff & 0xFFFF, this.ipSel & 0xFFFF, this.dpOff & 0xFFFF, this.dpSel & 0xFFFF];
      const ip = this.instrPtr, dp = this.dataPtr;
      return [this.cw, this.sw & 0x7FFF, this.tw, ip & 0xFFFF, (((ip >>> 16) & 15) << 12) | (this.opcode11 & 0x7FF),
        dp & 0xFFFF, ((dp >>> 16) & 15) << 12];
    }
    _setEnv(b) {
      const w = (i) => b[2 * i] | (b[2 * i + 1] << 8);
      this.cw = w(0);
      this.sw = w(1);
      this.tw = w(2);
      if (this.pm) { this.ipOff = w(3); this.ipSel = w(4); this.dpOff = w(5); this.dpSel = w(6); return; }
      this.instrPtr = w(3) | ((w(4) >> 12) << 16);
      this.opcode11 = w(4) & 0x7FF;
      this.dataPtr = w(5) | ((w(6) >> 12) << 16);
    }

    _envOp(k, ea, cyc) {
      this._op({ fldcw: 'FLDCW', fstcw: 'FNSTCW', fstsw: 'FNSTSW', fstenv: 'FNSTENV', fldenv: 'FLDENV', fsave: 'FNSAVE', frstor: 'FRSTOR' }[k], cyc);
      const hex = (v) => v.toString(16).toUpperCase().padStart(4, '0');
      switch (k) {
        case 'fldcw': this.cw = Number(this._rdInt(ea, 2)); return this._res(`CW = ${hex(this.cw)}`);
        case 'fstcw': this._wrBytes(ea, words([this.cw])); return this._res(`m16 = CW = ${hex(this.cw)}`);
        case 'fstsw': { const s = this.sw & 0x7FFF; this._wrBytes(ea, words([s])); return this._res(`m16 = SW = ${hex(s)}`); }
        case 'fstenv': this._wrBytes(ea, words(this._env())); return this._res('14-byte environment stored');
        case 'fldenv': this._setEnv(this._rdBytes(ea, 14)); return this._res(`CW = ${hex(this.cw)}, SW = ${hex(this.sw)}, TW = ${hex(this.tw)}`);
        case 'fsave': {
          const bytes = words(this._env());
          for (let i = 0; i < 8; i++) bytes.push(...F80.toBytes(this.st(i)));
          this._wrBytes(ea, bytes);
          const pm = this.pm; this.reset(); this.pm = pm;
          return this._res('94-byte state stored, FPU initialized');
        }
        case 'frstor': {
          const b = this._rdBytes(ea, 94);
          this._setEnv(b);
          for (let i = 0; i < 8; i++) this.regs[this._phys(i)] = F80.fromBytes(b.slice(14 + 10 * i, 24 + 10 * i));
          return this._res('94-byte state loaded');
        }
      }
      return reserved();
    }
  }

  FPU8087.F80 = F80;
  return FPU8087;
})();
