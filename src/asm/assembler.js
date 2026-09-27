// 8086 / 8087 (and 80186 / 80286 / 80287, 80386 / 80387, 80486, Pentium, Pentium Pro) assembler with NASM
// syntax and NASM encodings (flat binary).
// Asm86.assemble(source, { origin = 0x100, cpu = '8086', bits = 16 }) =>
//   { ok, bytes, origin, errors: [{ line, col, msg }], lineMap: [{ line, addr, len }], symbols }
//
// The source is parsed one time. Then the assembler does passes until all label
// values are stable. A size choice (short/near jump, disp8/disp16/disp32,
// imm8/imm16/imm32) can only grow from one pass to the next, so the passes
// always come to an end.
// CPU level: the cpu option ('8086' | '186' | '286' | '386' | '486' | '586' | '686'), then each
// `cpu` line in the source, sets the level for the lines that follow (NASM semantics). The level 586
// (also 'pentium') adds rdtsc, rdmsr, wrmsr, rsm, cmpxchg8b and the register cr4. The level 686
// (also 'p6', 'ppro', 'pentiumpro') adds cmovcc, fcmovcc, fcomi, fcomip, fucomi, fucomip, rdpmc
// and ud2 (NASM has ud2 at its 186 level).
// Code size: the bits option, then each `bits 16` / `bits 32` (`use16` / `use32`)
// line, sets the default operand and address size. The assembler adds the 66h
// (operand size) and 67h (address size) prefixes when the operands need them.

const Asm86 = (() => {
  // ------------------------------------------------------------------ tables
  const REG8 = { al: 0, cl: 1, dl: 2, bl: 3, ah: 4, ch: 5, dh: 6, bh: 7 };
  const REG16 = { ax: 0, cx: 1, dx: 2, bx: 3, sp: 4, bp: 5, si: 6, di: 7 };
  const REG32 = { eax: 0, ecx: 1, edx: 2, ebx: 3, esp: 4, ebp: 5, esi: 6, edi: 7 };
  const SREG = { es: 0, cs: 1, ss: 2, ds: 3, fs: 4, gs: 5 };
  const SEGPFX = [0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65];
  // control, debug and test registers (80386): cr0-cr7, dr0-dr7, tr0-tr7
  const SPECIAL_RE = /^(cr|dr|tr)([0-7])$/;
  const SPECIAL = { cr: 'creg', dr: 'dreg', tr: 'treg' };
  const isRegName = (l) => l in REG8 || l in REG16 || l in REG32 || l in SREG || SPECIAL_RE.test(l);
  const SCALE = { 1: 0, 2: 1, 4: 2, 8: 3 };
  const SIZES = { byte: 1, word: 2, dword: 4, qword: 8, tword: 10 };
  const RM = { 'bx+si': 0, 'bx+di': 1, 'bp+si': 2, 'bp+di': 3, '+si': 4, '+di': 5, 'bp+': 6, 'bx+': 7 };
  const ALU = { add: 0, or: 1, adc: 2, sbb: 3, and: 4, sub: 5, xor: 6, cmp: 7 };
  const SHIFT = { rol: 0, ror: 1, rcl: 2, rcr: 3, shl: 4, sal: 4, shr: 5, sar: 7 };
  const GRP3 = { not: 2, neg: 3, mul: 4, imul: 5, div: 6, idiv: 7 };
  const JCC = {
    jo: 0, jno: 1, jb: 2, jc: 2, jnae: 2, jnb: 3, jae: 3, jnc: 3, je: 4, jz: 4, jne: 5, jnz: 5,
    jbe: 6, jna: 6, ja: 7, jnbe: 7, js: 8, jns: 9, jp: 10, jpe: 10, jnp: 11, jpo: 11,
    jl: 12, jnge: 12, jge: 13, jnl: 13, jle: 14, jng: 14, jg: 15, jnle: 15,
  };
  const SETCC = {};
  for (const [k, v] of Object.entries(JCC)) SETCC['set' + k.slice(1)] = v;
  const LOOPS = { loopne: 0xE0, loopnz: 0xE0, loope: 0xE1, loopz: 0xE1, loop: 0xE2, jcxz: 0xE3, jecxz: 0xE3 };
  const SIMPLE = {
    daa: [0x27], das: [0x2F], aaa: [0x37], aas: [0x3F], nop: [0x90],
    wait: [0x9B], fwait: [0x9B], sahf: [0x9E], lahf: [0x9F],
    movsb: [0xA4], cmpsb: [0xA6], stosb: [0xAA],
    lodsb: [0xAC], scasb: [0xAE], int3: [0xCC], into: [0xCE],
    salc: [0xD6], xlat: [0xD7], xlatb: [0xD7], hlt: [0xF4], cmc: [0xF5],
    clc: [0xF8], stc: [0xF9], cli: [0xFA], sti: [0xFB], cld: [0xFC], std: [0xFD],
    // 8087 instructions with no operand
    fnop: [0xD9, 0xD0], fchs: [0xD9, 0xE0], fabs: [0xD9, 0xE1], ftst: [0xD9, 0xE4],
    fxam: [0xD9, 0xE5], fld1: [0xD9, 0xE8], fldl2t: [0xD9, 0xE9], fldl2e: [0xD9, 0xEA],
    fldpi: [0xD9, 0xEB], fldlg2: [0xD9, 0xEC], fldln2: [0xD9, 0xED], fldz: [0xD9, 0xEE],
    f2xm1: [0xD9, 0xF0], fyl2x: [0xD9, 0xF1], fptan: [0xD9, 0xF2], fpatan: [0xD9, 0xF3],
    fxtract: [0xD9, 0xF4], fdecstp: [0xD9, 0xF6], fincstp: [0xD9, 0xF7], fprem: [0xD9, 0xF8],
    fyl2xp1: [0xD9, 0xF9], fsqrt: [0xD9, 0xFA], frndint: [0xD9, 0xFC], fscale: [0xD9, 0xFD],
    fneni: [0xDB, 0xE0], fndisi: [0xDB, 0xE1], fnclex: [0xDB, 0xE2], fninit: [0xDB, 0xE3],
    feni: [0x9B, 0xDB, 0xE0], fdisi: [0x9B, 0xDB, 0xE1], fclex: [0x9B, 0xDB, 0xE2],
    finit: [0x9B, 0xDB, 0xE3], fcompp: [0xDE, 0xD9],
    // 80186 / 80286 / 80287
    leave: [0xC9], insb: [0x6C], outsb: [0x6E],
    clts: [0x0F, 0x06], loadall: [0x0F, 0x05], loadall286: [0x0F, 0x05],
    fsetpm: [0xDB, 0xE4], fnsetpm: [0xDB, 0xE4],
    // 80387
    fprem1: [0xD9, 0xF5], fsincos: [0xD9, 0xFB], fsin: [0xD9, 0xFE], fcos: [0xD9, 0xFF],
    fucompp: [0xDA, 0xE9],
    // 80486
    invd: [0x0F, 0x08], wbinvd: [0x0F, 0x09], cpuid: [0x0F, 0xA2],
    // Pentium
    wrmsr: [0x0F, 0x30], rdtsc: [0x0F, 0x31], rdmsr: [0x0F, 0x32], rsm: [0x0F, 0xAA],
    // Pentium Pro
    rdpmc: [0x0F, 0x33], ud2: [0x0F, 0x0B],
  };
  // Instructions with no operand and a fixed operand size: [opcode, size]
  // size 16 or 32 (the assembler adds 66h when it is not the code size), 0 = the code size
  const SIZED = {
    cbw: [0x98, 16], cwde: [0x98, 32], cwd: [0x99, 16], cdq: [0x99, 32],
    pushf: [0x9C, 0], pushfw: [0x9C, 16], pushfd: [0x9C, 32],
    popf: [0x9D, 0], popfw: [0x9D, 16], popfd: [0x9D, 32],
    pusha: [0x60, 0], pushaw: [0x60, 16], pushad: [0x60, 32],
    popa: [0x61, 0], popaw: [0x61, 16], popad: [0x61, 32],
    iret: [0xCF, 0], iretw: [0xCF, 16], iretd: [0xCF, 32],
    movsw: [0xA5, 16], movsd: [0xA5, 32], cmpsw: [0xA7, 16], cmpsd: [0xA7, 32],
    stosw: [0xAB, 16], stosd: [0xAB, 32], lodsw: [0xAD, 16], lodsd: [0xAD, 32],
    scasw: [0xAF, 16], scasd: [0xAF, 32], insw: [0x6D, 16], insd: [0x6D, 32],
    outsw: [0x6F, 16], outsd: [0x6F, 32],
  };
  // CPU levels: 0 = 8086/8087, 1 = 80186, 2 = 80286/80287, 3 = 80386/80387, 4 = 80486, 5 = Pentium,
  // 6 = Pentium Pro
  const CPU_LEVELS = { 8086: 0, 8087: 0, 186: 1, 80186: 1, 286: 2, 80286: 2, 287: 2, 80287: 2,
    386: 3, 80386: 3, 387: 3, 80387: 3, 486: 4, 80486: 4, 586: 5, 80586: 5, pentium: 5,
    686: 6, 80686: 6, p6: 6, ppro: 6, pentiumpro: 6 };
  const LEVEL_NAME = ['8086', '80186', '80286', '80386', '80486', 'Pentium', 'Pentium Pro'];
  const MIN_LEVEL = {
    pusha: 1, popa: 1, pushaw: 1, popaw: 1, enter: 1, leave: 1, bound: 1,
    insb: 1, insw: 1, outsb: 1, outsw: 1,
    sldt: 2, str: 2, lldt: 2, ltr: 2, verr: 2, verw: 2, sgdt: 2, sidt: 2, lgdt: 2, lidt: 2,
    smsw: 2, lmsw: 2, lar: 2, lsl: 2, clts: 2, arpl: 2, loadall: 2, loadall286: 2,
    fsetpm: 2, fnsetpm: 2,
  };
  for (const m of ['movzx', 'movsx', 'bt', 'bts', 'btr', 'btc', 'bsf', 'bsr', 'shld', 'shrd',
    'cwde', 'cdq', 'pushad', 'popad', 'pushfd', 'popfd', 'iretd', 'movsd', 'cmpsd', 'stosd',
    'lodsd', 'scasd', 'insd', 'outsd', 'lss', 'lfs', 'lgs', 'jecxz', 'retnd', 'retfd',
    'fprem1', 'fsincos', 'fsin', 'fcos', 'fucom', 'fucomp', 'fucompp', ...Object.keys(SETCC)]) {
    MIN_LEVEL[m] = 3;
  }
  for (const m of ['bswap', 'xadd', 'cmpxchg', 'invd', 'wbinvd', 'invlpg', 'cpuid']) MIN_LEVEL[m] = 4;
  for (const m of ['rdtsc', 'rdmsr', 'wrmsr', 'rsm', 'cmpxchg8b']) MIN_LEVEL[m] = 5;
  // Pentium Pro: cmovcc r, r/m (0F 40+cc), fcmovcc st0, st(i) (DA / DB C0+8n+i), fcomi / fucomi
  // (DB F0 / E8 + i), fcomip / fucomip (DF F0 / E8 + i)
  const CMOVCC = {};
  for (const [k, v] of Object.entries(JCC)) CMOVCC['cmov' + k.slice(1)] = v;
  const FCMOV = { fcmovb: [0xDA, 0xC0], fcmove: [0xDA, 0xC8], fcmovbe: [0xDA, 0xD0], fcmovu: [0xDA, 0xD8],
    fcmovnb: [0xDB, 0xC0], fcmovne: [0xDB, 0xC8], fcmovnbe: [0xDB, 0xD0], fcmovnu: [0xDB, 0xD8],
    fcomi: [0xDB, 0xF0], fucomi: [0xDB, 0xE8], fcomip: [0xDF, 0xF0], fucomip: [0xDF, 0xE8] };
  for (const m of ['rdpmc', 'ud2', ...Object.keys(CMOVCC), ...Object.keys(FCMOV)]) MIN_LEVEL[m] = 6;
  // 0F 00 /n and 0F 01 /n system instructions: [second byte, reg, memory only, r32 form]
  const SYS = {
    sldt: [0, 0, 0, 1], str: [0, 1, 0, 1], lldt: [0, 2], ltr: [0, 3], verr: [0, 4], verw: [0, 5],
    sgdt: [1, 0, 1], sidt: [1, 1, 1], lgdt: [1, 2, 1], lidt: [1, 3, 1], smsw: [1, 4, 0, 1], lmsw: [1, 6],
    invlpg: [1, 7, 1],
  };
  // 80386 bit instructions: [0F xx opcode of the register form, reg field of the 0F BA form]
  const BITOP = { bt: [0xA3, 4], bts: [0xAB, 5], btr: [0xB3, 6], btc: [0xBB, 7] };
  // 8087 arithmetic: reg field; the DC/DE "st(i), st0" forms swap sub/subr and div/divr
  const FARITH = { fadd: 0, fmul: 1, fcom: 2, fcomp: 3, fsub: 4, fsubr: 5, fdiv: 6, fdivr: 7 };
  const FARITHP = { faddp: 0, fmulp: 1, fsubp: 4, fsubrp: 5, fdivp: 6, fdivrp: 7 };
  const FIARITH = { fiadd: 0, fimul: 1, ficom: 2, ficomp: 3, fisub: 4, fisubr: 5, fidiv: 6, fidivr: 7 };
  const frev = (n) => (n >= 4 ? n ^ 1 : n);
  // 8087 memory-only instructions: [opcode, reg, fwait prefix, permitted sizes]
  const FCTRL = {
    fldenv: [0xD9, 4, 0, [0]], fnstenv: [0xD9, 6, 0, [0]], fstenv: [0xD9, 6, 1, [0]],
    fldcw: [0xD9, 5, 0, [0, 2]], fnstcw: [0xD9, 7, 0, [0, 2]], fstcw: [0xD9, 7, 1, [0, 2]],
    frstor: [0xDD, 4, 0, [0]], fnsave: [0xDD, 6, 0, [0]], fsave: [0xDD, 6, 1, [0]],
    fnstsw: [0xDD, 7, 0, [0, 2]], fstsw: [0xDD, 7, 1, [0, 2]],
    fbld: [0xDF, 4, 0, [0, 10]], fbstp: [0xDF, 6, 0, [0, 10]],
  };
  // 8087 load/store by memory size: { size: [opcode, reg] }, reg form: [opcode, base]
  const FLDST = {
    fld: { 4: [0xD9, 0], 8: [0xDD, 0], 10: [0xDB, 5], st: [0xD9, 0xC0] },
    fst: { 4: [0xD9, 2], 8: [0xDD, 2], st: [0xDD, 0xD0] },
    fstp: { 4: [0xD9, 3], 8: [0xDD, 3], 10: [0xDB, 7], st: [0xDD, 0xD8] },
    fild: { 2: [0xDF, 0], 4: [0xDB, 0], 8: [0xDF, 5] },
    fist: { 2: [0xDF, 2], 4: [0xDB, 2] },
    fistp: { 2: [0xDF, 3], 4: [0xDB, 3], 8: [0xDF, 7] },
    ffree: { st: [0xDD, 0xC0] },
    ffreep: { st: [0xDF, 0xC0] },
  };
  const DATA = { db: 1, dw: 2, dd: 4, dq: 8, dt: 10 };
  const RES = { resb: 1, resw: 2, resd: 4, resq: 8, rest: 10 };
  const DIRECTIVES = new Set(['org', 'bits', 'use16', 'use32', 'cpu', 'times', 'equ', 'align', 'alignb',
    ...Object.keys(DATA), ...Object.keys(RES)]);
  const PREFIXES = { rep: 0xF3, repe: 0xF3, repz: 0xF3, repne: 0xF2, repnz: 0xF2, lock: 0xF0,
    es: 0x26, cs: 0x2E, ss: 0x36, ds: 0x3E, fs: 0x64, gs: 0x65, o16: 0x66, o32: 0x66, a16: 0x67, a32: 0x67 };
  // operand-size and address-size prefixes: [kind, size]
  const OAPFX = { o16: ['o', 16], o32: ['o', 32], a16: ['a', 16], a32: ['a', 32] };

  class AsmError extends Error {
    constructor(msg, col) { super(msg); this.col = col || 1; }
  }
  const fail = (msg, col) => { throw new AsmError(msg, col); };

  // --------------------------------------------------------------- tokenizer
  const ID0 = /[A-Za-z_.?@]/;
  const IDC = /[A-Za-z0-9_.?@$#~]/;
  const FLOAT_RE = /^[0-9][0-9_]*(?:\.[0-9_]*(?:[eE][+-]?[0-9]+)?|[eE][+-]?[0-9]+)/;

  function parseInteger(text, col) {
    let d = text.replace(/_/g, '').toLowerCase();
    let base = 10;
    if (/^0x/.test(d)) { base = 16; d = d.slice(2); }
    else if (/h$/.test(d)) { base = 16; d = d.slice(0, -1); }
    else if (/^0h/.test(d)) { base = 16; d = d.slice(2); }
    else if (/^0[by]/.test(d)) { base = 2; d = d.slice(2); }
    else if (/^0[oq]/.test(d)) { base = 8; d = d.slice(2); }
    else if (/^0[dt]/.test(d)) d = d.slice(2);
    else if (/[by]$/.test(d)) { base = 2; d = d.slice(0, -1); }
    else if (/[oq]$/.test(d)) { base = 8; d = d.slice(0, -1); }
    else if (/[dt]$/.test(d)) d = d.slice(0, -1);
    const ok = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9a-f]+$/ }[base];
    if (!ok.test(d)) fail(`invalid number '${text}'`, col);
    return BigInt((base === 16 ? '0x' : base === 8 ? '0o' : base === 2 ? '0b' : '') + d);
  }

  function readString(s, i, col) {
    const q = s[i];
    const bytes = [];
    const utf8 = (cp) => {
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    };
    let j = i + 1;
    for (;;) {
      if (j >= s.length) fail('unterminated string', col);
      const c = s[j];
      if (c === q) return { bytes, end: j + 1 };
      if (q === '`' && c === '\\') {
        const e = s[j + 1];
        const simple = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, e: 27, z: 0, '\\': 92, "'": 39, '"': 34, '`': 96, '?': 63 };
        if (e in simple) { bytes.push(simple[e]); j += 2; continue; }
        let m = /^x([0-9a-fA-F]{1,2})/.exec(s.slice(j + 1));
        if (m) { bytes.push(parseInt(m[1], 16)); j += 1 + m[0].length; continue; }
        m = /^[0-7]{1,3}/.exec(s.slice(j + 1));
        if (m) { bytes.push(parseInt(m[0], 8) & 255); j += 1 + m[0].length; continue; }
        m = /^(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8}))/.exec(s.slice(j + 1));
        if (m) { utf8(parseInt(m[1] || m[2], 16)); j += 1 + m[0].length; continue; }
        fail('invalid escape in string', j + 1);
      }
      const cp = s.codePointAt(j);
      utf8(cp);
      j += cp > 0xFFFF ? 2 : 1;
    }
  }

  function tokenize(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      const col = i + 1;
      if (c === ';') break;
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c)) {
        const rest = s.slice(i);
        let m = FLOAT_RE.exec(rest);
        if (m && !/[0-9A-Za-z_.]/.test(rest[m[0].length] || '')) {
          out.push({ t: 'float', v: m[0], col });
        } else {
          m = /^[0-9][0-9A-Za-z_]*/.exec(rest);
          out.push({ t: 'num', v: parseInteger(m[0], col), col });
        }
        i += m[0].length;
      } else if (c === "'" || c === '"' || c === '`') {
        const r = readString(s, i, col);
        out.push({ t: 'str', v: r.bytes, col });
        i = r.end;
      } else if (c === '$' && s[i + 1] === '$') {
        out.push({ t: 'id', v: '$$', col }); i += 2;
      } else if (c === '$' && /[0-9]/.test(s[i + 1] || '')) {
        const m = /^\$[0-9A-Za-z_]+/.exec(s.slice(i));
        out.push({ t: 'num', v: parseInteger('0x' + m[0].slice(1), col), col });
        i += m[0].length;
      } else if (ID0.test(c) || c === '$') {
        let j = i + 1;
        while (j < s.length && IDC.test(s[j])) j++;
        let v = s.slice(i, j);
        if (v.length > 1 && v[0] === '$') v = '\u0001' + v.slice(1); // "$name" escapes a keyword
        out.push({ t: 'id', v, col });
        i = j;
      } else {
        const two = s.substr(i, 2);
        if (['<<', '>>', '//', '%%'].includes(two)) { out.push({ t: 'op', v: two, col }); i += 2; }
        else if ('+-*/%&|^~!()[],:'.includes(c)) { out.push({ t: 'op', v: c, col }); i++; }
        else fail(`unexpected character '${c}'`, col);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ expressions
  const LEVELS = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '%', '//', '%%']];
  const isOp = (t, v) => t && t.t === 'op' && t.v === v;
  const lc = (t) => (t && t.t === 'id' ? t.v.toLowerCase() : null);

  class Cursor {
    constructor(toks, ctx) { this.toks = toks; this.i = 0; this.ctx = ctx; }
    peek(k = 0) { return this.toks[this.i + k]; }
    next() { return this.toks[this.i++]; }
    end() { return this.i >= this.toks.length; }
    col() { const t = this.peek() || this.toks[this.toks.length - 1]; return t ? t.col : 1; }
  }

  // AST: {t:'n', big} {t:'s', name, col} {t:'r', r} {t:'$'} {t:'$$'} {t:'u', op, a} {t:'b', op, a, b}
  function parseExpr(cur, lvl = 0) {
    if (lvl === LEVELS.length) return parseUnary(cur);
    let a = parseExpr(cur, lvl + 1);
    for (;;) {
      const t = cur.peek();
      if (!t || t.t !== 'op' || !LEVELS[lvl].includes(t.v)) return a;
      cur.next();
      a = { t: 'b', op: t.v, a, b: parseExpr(cur, lvl + 1), col: t.col };
    }
  }

  function parseUnary(cur) {
    const t = cur.next();
    if (!t) fail('expression expected', cur.col());
    if (t.t === 'op' && '-+~!'.includes(t.v)) return { t: 'u', op: t.v, a: parseUnary(cur), col: t.col };
    if (isOp(t, '(')) {
      const e = parseExpr(cur);
      if (!isOp(cur.next(), ')')) fail("')' expected", t.col);
      return e;
    }
    if (t.t === 'num') return { t: 'n', big: W(t.v) };
    if (t.t === 'str') {
      if (t.v.length > 8) fail('character constant is too long', t.col);
      let v = 0n;
      t.v.forEach((b, k) => { v |= BigInt(b) << BigInt(8 * k); });
      return { t: 'n', big: v };
    }
    if (t.t === 'float') fail('floating-point constant is permitted only in dd, dq and dt', t.col);
    if (t.t === 'id') {
      const l = t.v.toLowerCase();
      if (t.v === '$') return { t: '$' };
      if (t.v === '$$') return { t: '$$' };
      if (isRegName(l)) return { t: 'r', r: l, col: t.col };
      if (l in SIZES || ['ptr', 'short', 'near', 'far', 'strict', 'seg', 'wrt'].includes(l)) {
        fail(`'${l}' is not permitted here`, t.col);
      }
      return { t: 's', name: cur.ctx.symName(t.v, t.col), col: t.col };
    }
    fail(`unexpected '${t.t === 'op' ? t.v : t.v}'`, t.col);
    return null;
  }

  // Expression values are exact 64-bit integers (BigInt), as in NASM.
  const W = (x) => BigInt.asIntN(64, x);
  const U = (x) => BigInt.asUintN(64, x);
  const BINOPS = {
    '*': (a, b) => W(a * b),
    '/': (a, b) => W(U(a) / U(b)),
    '//': (a, b) => W(a / b),
    '%': (a, b) => W(U(a) % U(b)),
    '%%': (a, b) => W(a % b),
    '<<': (a, b) => W(a << U(b)),
    '>>': (a, b) => W(U(a) >> U(b)),
    '&': (a, b) => a & b,
    '|': (a, b) => a | b,
    '^': (a, b) => a ^ b,
  };

  // Evaluates to a linear form { c, r } where r maps register names to factors.
  function evalLin(n, S) {
    switch (n.t) {
      case 'n': return { c: n.big, r: {} };
      case '$': return { c: BigInt(S.here), r: {} };
      case '$$': return { c: BigInt(S.origin), r: {} };
      case 'r': return { c: 0n, r: { [n.r]: 1n } };
      case 's': return { c: S.lookup(n.name, n.col), r: {} };
      case 'u': {
        const a = evalLin(n.a, S);
        if (n.op === '+') return a;
        if (n.op === '-') return scale(a, -1n);
        pure(a, n);
        return { c: n.op === '~' ? ~a.c : a.c ? 0n : 1n, r: {} };
      }
      default: {
        const a = evalLin(n.a, S);
        const b = evalLin(n.b, S);
        if (n.op === '+') return add(a, b);
        if (n.op === '-') return add(a, scale(b, -1n));
        if (n.op === '*') {
          if (isPure(a)) return hint(scale(b, a.c));
          pure(b, n);
          return hint(scale(a, b.c));
        }
        pure(a, n); pure(b, n);
        if ('/%'.includes(n.op[0]) && b.c === 0n) {
          if (S.unknown) return { c: 0n, r: {} };
          fail('division by zero', n.col);
        }
        return { c: BINOPS[n.op](a.c, b.c), r: {} };
      }
    }
  }
  const isPure = (a) => Object.keys(a.r).length === 0;
  const pure = (a, n) => { if (!isPure(a)) fail('registers are not permitted in this expression', n.col); };
  // h: the registers that had a multiplication (NASM uses them as the index, not the base)
  const scale = (a, k) => {
    const r = {};
    for (const x in a.r) if (a.r[x] * k) r[x] = a.r[x] * k;
    return { c: W(a.c * k), r, h: a.h };
  };
  const add = (a, b) => {
    const r = { ...a.r };
    for (const x in b.r) { r[x] = (r[x] || 0n) + b.r[x]; if (!r[x]) delete r[x]; }
    return { c: W(a.c + b.c), r, h: { ...a.h, ...b.h } };
  };
  const hint = (a) => {
    const h = { ...a.h };
    for (const x in a.r) h[x] = true;
    return { ...a, h };
  };

  // ---------------------------------------------------------------- operands
  // reg:  { k:'reg', cls:'r8'|'r16'|'r32'|'sreg'|'st'|'creg'|'dreg'|'treg', n, name }
  // imm:  { k:'imm', e, size, strict, jmp }
  // mem:  { k:'mem', e, size, seg, dsize, nosplit, jmp }
  // far:  { k:'far', seg, off, size, jmp }
  function parseOperand(toks, ctx) {
    const cur = new Cursor(toks, ctx);
    const col = toks[0].col;
    let size = 0;
    let strict = false;
    let jmp = null;
    let to = false;
    while (cur.i < toks.length - 1) {
      const l = lc(cur.peek());
      if (!l) break;
      if (l in SIZES) size = SIZES[l];
      else if (l === 'ptr') { /* MASM style, no effect */ }
      else if (l === 'strict') strict = true;
      else if (l === 'short' || l === 'near' || l === 'far') jmp = l;
      else if (l === 'to') to = true;
      else break;
      cur.next();
    }
    if (cur.end()) fail('operand expected', col);
    const rest = toks.slice(cur.i);
    const first = rest[0];
    const l0 = lc(first);
    // registers
    if (rest.length === 1 && l0) {
      if (l0 in REG8) return { k: 'reg', cls: 'r8', n: REG8[l0], name: l0, size: 1, to, col };
      if (l0 in REG16) return { k: 'reg', cls: 'r16', n: REG16[l0], name: l0, size: 2, to, col };
      if (l0 in REG32) return { k: 'reg', cls: 'r32', n: REG32[l0], name: l0, size: 4, to, col };
      if (l0 in SREG) return { k: 'reg', cls: 'sreg', n: SREG[l0], name: l0, size: 2, to, col };
      const sp = SPECIAL_RE.exec(l0);
      if (sp) return { k: 'reg', cls: SPECIAL[sp[1]], n: +sp[2], name: l0, size: 4, to, col };
      const m = /^st([0-7])?$/.exec(l0);
      if (m) return { k: 'reg', cls: 'st', n: +(m[1] || 0), name: 'st' + (m[1] || 0), to, col };
    }
    if (l0 === 'st' && rest.length === 4 && isOp(rest[1], '(') && rest[2].t === 'num' && isOp(rest[3], ')')) {
      const n = Number(rest[2].v);
      if (n > 7) fail('invalid FPU register', rest[2].col);
      return { k: 'reg', cls: 'st', n, name: 'st' + n, to, col };
    }
    // memory: [..], sreg:[..]
    let seg = null;
    let r = rest;
    if (l0 in SREG && isOp(rest[1], ':') && isOp(rest[2], '[')) { seg = SREG[l0]; r = rest.slice(2); }
    if (isOp(r[0], '[')) {
      if (!isOp(r[r.length - 1], ']')) fail("']' expected at end of memory operand", r[0].col);
      let inner = r.slice(1, -1);
      let dsize = 0;
      let nosplit = false;
      for (;;) {
        const l = lc(inner[0]);
        if (l === 'byte' || l === 'word' || l === 'dword') { dsize = SIZES[l]; inner = inner.slice(1); continue; }
        if (l === 'nosplit') { nosplit = true; inner = inner.slice(1); continue; }
        if (l in SREG && isOp(inner[1], ':')) {
          if (seg !== null) fail('two segment overrides', inner[0].col);
          seg = SREG[l]; inner = inner.slice(2); continue;
        }
        break;
      }
      if (!inner.length) fail('empty memory operand', r[0].col);
      const ic = new Cursor(inner, ctx);
      const e = parseExpr(ic);
      if (!ic.end()) fail(`unexpected '${ic.peek().v}' in memory operand`, ic.peek().col);
      return { k: 'mem', e, size, seg, dsize, nosplit, jmp, col };
    }
    // far pointer seg:off
    const colon = rest.findIndex((t) => isOp(t, ':'));
    if (colon > 0) {
      const a = new Cursor(rest.slice(0, colon), ctx);
      const b = new Cursor(rest.slice(colon + 1), ctx);
      const se = parseExpr(a);
      const oe = parseExpr(b);
      if (!a.end() || !b.end()) fail('invalid far address', col);
      return { k: 'far', seg: se, off: oe, size, jmp, col };
    }
    const c2 = new Cursor(rest, ctx);
    const e = parseExpr(c2);
    if (!c2.end()) fail(`unexpected '${c2.peek().v}'`, c2.peek().col);
    return { k: 'imm', e, size, strict, jmp, col };
  }

  function splitCommas(toks) {
    const parts = [];
    let depth = 0;
    let cur = [];
    for (const t of toks) {
      if (t.t === 'op' && (t.v === '(' || t.v === '[')) depth++;
      if (t.t === 'op' && (t.v === ')' || t.v === ']')) depth--;
      if (depth === 0 && isOp(t, ',')) { parts.push(cur); cur = []; } else cur.push(t);
    }
    parts.push(cur);
    return parts;
  }

  // ------------------------------------------------------------------ parser
  const isMnemonic = (l) => l in SIMPLE || l in SIZED || l in ALU || l in SHIFT || l in GRP3 || l in JCC ||
    l in SETCC || l in LOOPS || l in FARITH || l in FARITHP || l in FIARITH || l in FCTRL || l in FLDST ||
    l in SYS || l in BITOP || l in CMOVCC || l in FCMOV || l in HANDLERS || l in PREFIXES || DIRECTIVES.has(l);

  // Parses one source line into a statement: { line, label, labelCol, body }
  // body: { kind:'insn', mnem, col, prefixes, ops } | { kind:'data', unit, items }
  //       | { kind:'times', count, body } | { kind: 'equ'|'org'|'align'|'res'|'none', ... }
  function parseLine(text, line, ctx) {
    let toks = tokenize(text);
    if (!toks.length) return null;
    if (isOp(toks[0], '%')) fail('preprocessor directives (%...) are not supported', toks[0].col);
    // [bits 16] style directive
    if (isOp(toks[0], '[') && isOp(toks[toks.length - 1], ']') && DIRECTIVES.has(lc(toks[1]))) {
      toks = toks.slice(1, -1);
    }
    const st = { line, label: null, labelCol: 0, body: null };
    let i = 0;
    const t0 = toks[0];
    const l0 = lc(t0);
    if (t0.t === 'id' && isOp(toks[1], ':')) {
      i = 2;
    } else if (t0.t === 'id' && !isMnemonic(l0) && toks.length > 1 && isMnemonic(lc(toks[1]))) {
      i = 1;
    } else if (t0.t === 'id' && !isMnemonic(l0)) {
      fail(`unknown instruction '${t0.v}'` + (toks.length === 1 ? " (add ':' to make it a label)" : ''), t0.col);
    }
    if (i) {
      if (t0.v === '$$' || t0.v === '$' || isRegName(l0)) {
        fail(`'${t0.v}' cannot be a label`, t0.col);
      }
      const isEqu = lc(toks[i]) === 'equ';
      st.label = ctx.defName(t0.v, t0.col, !isEqu);
      st.labelCol = t0.col;
      if (isEqu) {
        const cur = new Cursor(toks.slice(i + 1), ctx);
        if (cur.end()) fail('expression expected after equ', toks[i].col);
        st.body = { kind: 'equ', e: parseExpr(cur), col: toks[i].col };
        if (!cur.end()) fail(`unexpected '${cur.peek().v}'`, cur.peek().col);
        return st;
      }
    }
    st.body = i < toks.length ? parseBody(toks.slice(i), ctx) : { kind: 'none' };
    return st;
  }

  function parseBody(toks, ctx) {
    const t = toks[0];
    const l = lc(t);
    if (!l) fail('instruction expected', t.col);
    const rest = toks.slice(1);
    const exprOf = (tk, what) => {
      const cur = new Cursor(tk, ctx);
      if (cur.end()) fail(`${what} expected`, t.col);
      const e = parseExpr(cur);
      if (!cur.end()) fail(`unexpected '${cur.peek().v}'`, cur.peek().col);
      return e;
    };
    if (l === 'equ') fail('equ needs a label', t.col);
    if (l === 'times') {
      const cur = new Cursor(rest, ctx);
      const count = parseExpr(cur);
      if (cur.end()) fail('instruction expected after times count', t.col);
      return { kind: 'times', count, body: parseBody(rest.slice(cur.i), ctx), col: t.col };
    }
    if (l in DATA) {
      if (!rest.length) fail(`${l} needs at least one value`, t.col);
      const items = splitCommas(rest).map((p) => {
        if (!p.length) fail('value expected', t.col);
        if (p.length === 1 && p[0].t === 'str') return { k: 'str', bytes: p[0].v };
        if (p[p.length - 1].t === 'float' && (p.length === 1 || (p.length === 2 && p[0].t === 'op' && '+-'.includes(p[0].v)))) {
          if (DATA[l] < 4) fail(`floating-point constant is not permitted in ${l}`, p[0].col);
          return { k: 'float', text: p[p.length - 1].v, neg: p.length === 2 && p[0].v === '-' };
        }
        return { k: 'expr', e: exprOf(p, 'value'), col: p[0].col };
      });
      return { kind: 'data', unit: DATA[l], items, col: t.col };
    }
    if (l in RES) return { kind: 'res', unit: RES[l], e: exprOf(rest, 'count'), col: t.col };
    if (l === 'org') return { kind: 'org', e: exprOf(rest, 'address'), col: t.col };
    if (l === 'bits') {
      if (rest.length !== 1 || rest[0].t !== 'num' || (rest[0].v !== 16n && rest[0].v !== 32n)) {
        fail('only BITS 16 and BITS 32 are supported', t.col);
      }
      return { kind: 'bits', bits: Number(rest[0].v), col: t.col };
    }
    if (l === 'use16' || l === 'use32') {
      if (rest.length) fail(`unexpected '${rest[0].v}'`, rest[0].col);
      return { kind: 'bits', bits: l === 'use32' ? 32 : 16, col: t.col };
    }
    if (l === 'cpu') {
      const v = rest.length === 1 ? String(rest[0].v).toLowerCase() : '';
      if (!(v in CPU_LEVELS)) fail('unsupported cpu level (use 8086, 186, 286, 386, 486, 586, 686, 287, 387 or 8087)', t.col);
      return { kind: 'cpu', level: CPU_LEVELS[v] };
    }
    if (l === 'align' || l === 'alignb') {
      const parts = splitCommas(rest);
      let fill = l === 'align' ? 0x90 : 0;
      if (parts.length > 2) fail('too many operands for align', t.col);
      if (parts.length === 2) {
        const p = parts[1];
        if (lc(p[0]) === 'nop' && p.length === 1) fill = 0x90;
        else if (lc(p[0]) === 'db' && p.length === 2 && p[1].t === 'num') fill = Number(p[1].v & 255n);
        else fail("align fill must be 'nop' or 'db <number>'", p[0] ? p[0].col : t.col);
      }
      return { kind: 'align', e: exprOf(parts[0], 'alignment'), fill, col: t.col };
    }
    // instruction with prefixes
    const prefixes = [];
    let k = 0;
    while (k < toks.length - 1 && lc(toks[k]) in PREFIXES && toks[k + 1].t === 'id' && isMnemonic(lc(toks[k + 1]))) {
      prefixes.push({ p: lc(toks[k]), col: toks[k].col });
      k++;
    }
    const mt = toks[k];
    const m = lc(mt);
    if (!m) fail('instruction expected', mt.col);
    if (!isMnemonic(m) || DIRECTIVES.has(m)) {
      if (DIRECTIVES.has(m) && k > 0) fail(`prefix before '${m}'`, mt.col);
      fail(`unknown instruction '${mt.v}'`, mt.col);
    }
    const opt = toks.slice(k + 1);
    const ops = opt.length ? splitCommas(opt).map((p) => {
      if (!p.length) fail('operand expected', mt.col);
      return parseOperand(p, ctx);
    }) : [];
    if (m in PREFIXES) {
      if (ops.length) fail(`instruction expected after prefix '${m}'`, mt.col);
      // a prefix alone on a line: emit the prefix byte
      return { kind: 'insn', mnem: m, col: mt.col, prefixes, ops, lonePrefix: true };
    }
    return { kind: 'insn', mnem: m, col: mt.col, prefixes, ops };
  }

  // --------------------------------------------------------------- encoders
  const lo = (v) => v & 0xFF;
  const hi = (v) => (v >> 8) & 0xFF;
  const w16 = (v) => [lo(v), hi(v)];
  const w32 = (v) => [lo(v), hi(v), (v >> 16) & 0xFF, (v >>> 24) & 0xFF];
  const fitsS8 = (v) => { const x = v & 0xFFFF; return x <= 0x7F || x >= 0xFF80; };
  const fitsS8d = (v) => { const x = v | 0; return x >= -128 && x <= 127; };
  // true when v fits in a sign-extended byte for an operand of s bytes (2 or 4)
  const fitsSx = (v, s) => (s === 4 ? fitsS8d(v) : fitsS8(v));

  // E: the encoding context for one instruction.
  //   E.grow(key, need) -> size level (sticky over passes)
  //   E.err(msg, col), E.seg (segment override)
  //   E.osz(bytes) sets the operand size, E.setAsz(bits) the address size
  //   E.pc(len) -> the address after the prefixes and len more bytes
  function modrm(E, reg, o) {
    if (o.k === 'reg') return [0xC0 | (reg << 3) | o.n];
    if (o.seg !== null) E.setSeg(o.seg, o.col);
    E.setAsz(o.asz, o.col);
    return o.asz === 32 ? modrm32(E, reg, o) : modrm16(E, reg, o);
  }
  function modrm16(E, reg, o) {
    if (o.direct) return [(reg << 3) | 6, ...w16(o.disp)];
    const rm = RM[(o.base || '') + '+' + (o.index || '')];
    const d = o.disp & 0xFFFF;
    let need = o.unk ? 0 : d === 0 && rm !== 6 ? 0 : fitsS8(d) ? 1 : 2;
    if (o.dsize === 2) need = 2;
    if (o.dsize === 1) {
      if (!o.unk && !fitsS8(d)) E.err('displacement does not fit in a byte', o.col);
      need = 1;
    }
    let mod = E.grow('disp', need);
    if (mod === 0 && rm === 6) mod = 1;
    const b = [(mod << 6) | (reg << 3) | rm];
    if (mod === 1) b.push(lo(d));
    if (mod === 2) b.push(lo(d), hi(d));
    return b;
  }
  // 32-bit addressing: o.base and o.index are register numbers (-1 = none).
  // A SIB byte follows when there is an index or the base is esp.
  function modrm32(E, reg, o) {
    const d = o.disp | 0;
    if (o.direct) return [(reg << 3) | 5, ...w32(d)];
    if (o.base < 0) return [(reg << 3) | 4, (SCALE[o.scale] << 6) | (o.index << 3) | 5, ...w32(d)];
    let need = o.unk ? 0 : d === 0 && o.base !== 5 ? 0 : fitsS8d(d) ? 1 : 2;
    if (o.dsize === 4) need = 2;
    if (o.dsize === 1) {
      if (!o.unk && !fitsS8d(d)) E.err('displacement does not fit in a byte', o.col);
      need = 1;
    }
    let mod = E.grow('disp', need);
    if (mod === 0 && o.base === 5) mod = 1;
    const b = o.index < 0 && o.base !== 4
      ? [(mod << 6) | (reg << 3) | o.base]
      : [(mod << 6) | (reg << 3) | 4, (SCALE[o.scale] << 6) | ((o.index < 0 ? 4 : o.index) << 3) | o.base];
    if (mod === 1) b.push(lo(d));
    if (mod === 2) b.push(...w32(d));
    return b;
  }
  // the address of a direct memory operand (mov acc, [x] and mov [x], acc)
  function moffs(E, o) {
    if (o.seg !== null) E.setSeg(o.seg, o.col);
    E.setAsz(o.asz, o.col);
    return o.asz === 32 ? w32(o.disp) : w16(o.disp);
  }

  const isR = (o, cls) => o && o.k === 'reg' && o.cls === cls;
  const isGP = (o) => o && o.k === 'reg' && (o.cls === 'r8' || o.cls === 'r16' || o.cls === 'r32');
  const isRW = (o) => isR(o, 'r16') || isR(o, 'r32');
  const isRM = (o) => o && (o.k === 'mem' || isGP(o));
  const isAcc = (o) => isGP(o) && o.n === 0;
  const isDirect = (o) => o.k === 'mem' && o.direct;
  const isSpecial = (o) => o && o.k === 'reg' && (o.cls === 'creg' || o.cls === 'dreg' || o.cls === 'treg');
  // operands that only an 80386 has
  const is386Op = (o) => o.k === 'reg' && (o.cls === 'r32' || isSpecial(o) || (o.cls === 'sreg' && o.n > 3));

  function invalid(E) { E.err(`invalid combination of operands for '${E.mnem}'`, E.col); }
  function nops(E, ops, ...counts) {
    if (!counts.includes(ops.length)) {
      E.err(`'${E.mnem}' needs ${counts.join(' or ')} operand${counts[0] === 1 && counts.length === 1 ? '' : 's'}`, E.col);
    }
  }

  // operand size of a two-operand instruction: 1, 2 or 4 (also sets E.osz)
  function opSize(E, a, b) {
    const sa = a.k === 'reg' || a.k === 'mem' ? a.size || 0 : 0;
    const sb = b.k === 'reg' || b.k === 'mem' ? b.size || 0 : 0;
    if (sa && sb && sa !== sb) E.err('mismatch in operand sizes', b.col || E.col);
    const s = sa || sb;
    if (!s) E.err('operation size not specified', E.col);
    if (s !== 1 && s !== 2 && s !== 4) E.err('invalid operand size', E.col);
    E.osz(s);
    return s;
  }
  function rmSize(E, a) {
    const s = a.size;
    if (!s) E.err('operation size not specified', a.col || E.col);
    if (s !== 1 && s !== 2 && s !== 4) E.err('invalid operand size', a.col || E.col);
    E.osz(s);
    return s;
  }
  function imm8(E, o) {
    if (!o.unk && (o.v < -128 || o.v > 255)) E.err('value does not fit in a byte', o.col);
    return lo(o.v);
  }
  function imm16(E, o) {
    if (!o.unk && (o.v < -32768 || o.v > 65535)) E.err('value does not fit in a word', o.col);
    return w16(o.v);
  }
  function imm32(E, o) {
    if (!o.unk && (o.v < -0x80000000 || o.v > 0xFFFFFFFF)) E.err('value does not fit in a dword', o.col);
    return w32(o.v);
  }
  const immS = (E, o, s) => (s === 1 ? [imm8(E, o)] : s === 2 ? imm16(E, o) : imm32(E, o));
  // true when a word or dword immediate (s = 2 or 4) can use the sign-extended byte form
  function useS8(E, o, s = 2) {
    if (o.size === 1) {
      if (!o.unk && !fitsSx(o.v, s)) E.err('value does not fit in a signed byte', o.col);
      return true;
    }
    if (o.strict && o.size >= 2) return false;
    return E.grow('imm', o.unk || fitsSx(o.v, s) ? 0 : 1) === 0;
  }

  // the operand size in bytes without a size keyword: an o16 / o32 prefix, else the code size
  const codeSize = (E) => (E.oForce || E.bits) / 8;

  function short(E, op, o, len) {
    if (o.k !== 'imm') return invalid(E);
    const d = o.v - E.pc(len);
    if (!o.unk && (d < -128 || d > 127)) E.err(`short jump out of range (${d} bytes)`, o.col);
    return [op, lo(d)];
  }
  // the relative displacement (s = 2 or 4 bytes) that ends an instruction of len + s bytes
  function rel(E, o, len, s) {
    const d = o.v - E.pc(len + s);
    return s === 4 ? w32(d) : w16(d);
  }

  const HANDLERS = {
    mov(E, ops) {
      nops(E, ops, 2);
      const [a, b] = ops;
      if (isSpecial(a) || isSpecial(b)) {
        // mov r32, crN / drN / trN (0F 20 / 21 / 24) and the other direction (0F 22 / 23 / 26)
        const to = isSpecial(a);
        const [sp, r] = to ? [a, b] : [b, a];
        if (!isR(r, 'r32')) return invalid(E);
        if (sp.cls === 'creg' && sp.n === 4 && E.cpu < 5) E.err("'cr4' is a Pentium register (use cpu 586)", sp.col);
        return [0x0F, { creg: 0x20, dreg: 0x21, treg: 0x24 }[sp.cls] + (to ? 2 : 0), 0xC0 | (sp.n << 3) | r.n];
      }
      if (isR(a, 'sreg')) {
        if (!isRM(b) || b.size === 1) return invalid(E);
        return [0x8E, ...modrm(E, a.n, b)];
      }
      if (isR(b, 'sreg')) {
        if (!isRM(a) || a.size === 1 || (a.k === 'mem' && a.size === 4)) return invalid(E);
        if (a.k === 'reg') E.osz(a.size);
        return [0x8C, ...modrm(E, b.n, a)];
      }
      if (!isRM(a)) return invalid(E);
      const s = opSize(E, a, b);
      const w = s > 1 ? 1 : 0;
      if (b.k === 'imm') {
        if (a.k === 'reg') return [0xB0 | (w << 3) | a.n, ...immS(E, b, s)];
        return [0xC6 | w, ...modrm(E, 0, a), ...immS(E, b, s)];
      }
      if (isAcc(a) && isDirect(b)) return [0xA0 | w, ...moffs(E, b)];
      if (isAcc(b) && isDirect(a)) return [0xA2 | w, ...moffs(E, a)];
      if (!isRM(b)) return invalid(E);
      if (b.k === 'reg') return [0x88 | w, ...modrm(E, b.n, a)];
      if (a.k === 'reg') return [0x8A | w, ...modrm(E, a.n, b)];
      return invalid(E);
    },
    test(E, ops) {
      nops(E, ops, 2);
      const [a, b] = ops;
      if (!isRM(a)) return invalid(E);
      const s = opSize(E, a, b);
      const w = s > 1 ? 1 : 0;
      if (b.k === 'imm') {
        if (isAcc(a)) return [0xA8 | w, ...immS(E, b, s)];
        return [0xF6 | w, ...modrm(E, 0, a), ...immS(E, b, s)];
      }
      if (isGP(b)) return [0x84 | w, ...modrm(E, b.n, a)];
      if (a.k === 'reg' && b.k === 'mem') return [0x84 | w, ...modrm(E, a.n, b)];
      return invalid(E);
    },
    xchg(E, ops) {
      nops(E, ops, 2);
      const [a, b] = ops;
      if (!isRM(a) || !isRM(b)) return invalid(E);
      const w = opSize(E, a, b) > 1 ? 1 : 0;
      if (w && a.k === 'reg' && b.k === 'reg' && (a.n === 0 || b.n === 0)) return [0x90 | (a.n || b.n)];
      if (a.k === 'mem') return [0x86 | w, ...modrm(E, b.n, a)];
      return [0x86 | w, ...(b.k === 'mem' ? modrm(E, a.n, b) : modrm(E, b.n, a))];
    },
    inc: (E, ops) => incdec(E, ops, 0),
    dec: (E, ops) => incdec(E, ops, 1),
    push(E, ops) {
      nops(E, ops, 1);
      const [a] = ops;
      if (a.k === 'imm') {
        E.needCpu(1, "'push imm'", a.col);
        // "push word x" / "push dword x" set the size; else the code size
        const s = a.size === 2 || a.size === 4 ? a.size : codeSize(E);
        E.osz(s);
        return useS8(E, a, s) ? [0x6A, lo(a.v)] : [0x68, ...immS(E, a, s)];
      }
      if (isRW(a)) { E.osz(a.size); return [0x50 | a.n]; }
      if (isR(a, 'sreg')) return a.n > 3 ? [0x0F, 0x80 | (a.n << 3)] : [0x06 | (a.n << 3)];
      if (a.k === 'mem') { if (rmSize(E, a) === 1) return invalid(E); return [0xFF, ...modrm(E, 6, a)]; }
      return invalid(E);
    },
    pop(E, ops) {
      nops(E, ops, 1);
      const [a] = ops;
      if (isRW(a)) { E.osz(a.size); return [0x58 | a.n]; }
      if (isR(a, 'sreg')) {
        if (a.n === 1 && E.cpu > 0) return E.err(`'pop cs' is not an ${LEVEL_NAME[E.cpu]} instruction`, a.col);
        return a.n > 3 ? [0x0F, 0x81 | (a.n << 3)] : [0x07 | (a.n << 3)];
      }
      if (a.k === 'mem') { if (rmSize(E, a) === 1) return invalid(E); return [0x8F, ...modrm(E, 0, a)]; }
      return invalid(E);
    },
    lea: (E, ops) => lealds(E, ops, [0x8D]),
    les: (E, ops) => lealds(E, ops, [0xC4]),
    lds: (E, ops) => lealds(E, ops, [0xC5]),
    lss: (E, ops) => lealds(E, ops, [0x0F, 0xB2]),
    lfs: (E, ops) => lealds(E, ops, [0x0F, 0xB4]),
    lgs: (E, ops) => lealds(E, ops, [0x0F, 0xB5]),
    in(E, ops) {
      nops(E, ops, 2);
      const [a, b] = ops;
      if (!isAcc(a)) return invalid(E);
      const w = a.cls === 'r8' ? 0 : 1;
      E.osz(a.size);
      if (isR(b, 'r16') && b.n === 2) return [0xEC | w];
      if (b.k === 'imm') return [0xE4 | w, port(E, b)];
      return invalid(E);
    },
    out(E, ops) {
      nops(E, ops, 2);
      const [a, b] = ops;
      if (!isAcc(b)) return invalid(E);
      const w = b.cls === 'r8' ? 0 : 1;
      E.osz(b.size);
      if (isR(a, 'r16') && a.n === 2) return [0xEE | w];
      if (a.k === 'imm') return [0xE6 | w, port(E, a)];
      return invalid(E);
    },
    int(E, ops) {
      nops(E, ops, 1);
      if (ops[0].k !== 'imm') return invalid(E);
      return [0xCD, imm8(E, ops[0])];
    },
    aam: (E, ops) => aamd(E, ops, 0xD4),
    aad: (E, ops) => aamd(E, ops, 0xD5),
    ret: (E, ops) => retx(E, ops, 0xC3),
    retn: (E, ops) => retx(E, ops, 0xC3),
    retf: (E, ops) => retx(E, ops, 0xCB),
    retnw: (E, ops) => retx(E, ops, 0xC3, 16),
    retnd: (E, ops) => retx(E, ops, 0xC3, 32),
    retfw: (E, ops) => retx(E, ops, 0xCB, 16),
    retfd: (E, ops) => retx(E, ops, 0xCB, 32),
    jmp: (E, ops) => jmpcall(E, ops, true),
    call: (E, ops) => jmpcall(E, ops, false),
    // 80186 / 80286
    enter(E, ops) {
      nops(E, ops, 2);
      if (ops[0].k !== 'imm' || ops[1].k !== 'imm') return invalid(E);
      return [0xC8, ...imm16(E, ops[0]), imm8(E, ops[1])];
    },
    bound(E, ops) {
      nops(E, ops, 2);
      if (!isRW(ops[0]) || ops[1].k !== 'mem') return invalid(E);
      E.osz(ops[0].size);
      return [0x62, ...modrm(E, ops[0].n, ops[1])];
    },
    arpl(E, ops) {
      nops(E, ops, 2);
      const [a, b] = ops;
      if (!isRM16(a) || !isR(b, 'r16')) return invalid(E);
      return [0x63, ...modrm(E, b.n, a)];
    },
    lar: (E, ops) => larlsl(E, ops, 0x02),
    lsl: (E, ops) => larlsl(E, ops, 0x03),
    // 80386
    movzx: (E, ops) => movx(E, ops, 0xB6),
    movsx: (E, ops) => movx(E, ops, 0xBE),
    bsf: (E, ops) => bitscan(E, ops, 0xBC),
    bsr: (E, ops) => bitscan(E, ops, 0xBD),
    shld: (E, ops) => dshift(E, ops, 0xA4),
    shrd: (E, ops) => dshift(E, ops, 0xAC),
    // 8087 / 80387
    fxch(E, ops) {
      nops(E, ops, 0, 1, 2);
      if (!ops.length) return [0xD9, 0xC9];
      if (!ops.every((o) => isR(o, 'st'))) return invalid(E);
      if (ops.length === 2 && ops[0].n !== 0 && ops[1].n !== 0) return invalid(E);
      const i = ops.length === 2 ? ops[0].n || ops[1].n : ops[0].n;
      return [0xD9, 0xC8 + i];
    },
    fucom: (E, ops) => fucom(E, ops, 0xE0),
    fucomp: (E, ops) => fucom(E, ops, 0xE8),
    // 80486
    bswap(E, ops) {
      nops(E, ops, 1);
      if (!isR(ops[0], 'r32')) return invalid(E);
      E.osz(4);
      return [0x0F, 0xC8 | ops[0].n];
    },
    xadd: (E, ops) => xchgop(E, ops, 0xC0),
    cmpxchg: (E, ops) => xchgop(E, ops, 0xB0),
    // Pentium: cmpxchg8b m64 (0F C7 /1; no operand size prefix)
    cmpxchg8b(E, ops) {
      nops(E, ops, 1);
      const [a] = ops;
      if (a.k !== 'mem' || (a.size && a.size !== 8)) return invalid(E);
      return [0x0F, 0xC7, ...modrm(E, 1, a)];
    },
  };
  // xadd / cmpxchg r/m, r (0F C0 / C1, 0F B0 / B1)
  function xchgop(E, ops, op) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRM(a) || !isGP(b)) return invalid(E);
    const w = opSize(E, a, b) > 1 ? 1 : 0;
    return [0x0F, op | w, ...modrm(E, b.n, a)];
  }

  const isRM16 = (o) => isR(o, 'r16') || (o && o.k === 'mem' && (!o.size || o.size === 2));
  function larlsl(E, ops, op) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRW(a) || !(isRW(b) || (b.k === 'mem' && (!b.size || b.size === 2)))) return invalid(E);
    E.osz(a.size);
    return [0x0F, op, ...modrm(E, a.n, b)];
  }
  function sys(E, ops, [b2, reg, memOnly, r32]) {
    nops(E, ops, 1);
    const [a] = ops;
    if (memOnly) {
      if (a.k !== 'mem') return invalid(E);
    } else if (r32 && isR(a, 'r32')) {
      E.osz(4); // sldt / str / smsw r32
    } else {
      if (!isRM16(a)) return invalid(E);
      if (r32 && a.k === 'reg') E.osz(2);
    }
    return [0x0F, b2, ...modrm(E, reg, a)];
  }
  function incdec(E, ops, n) {
    nops(E, ops, 1);
    const [a] = ops;
    if (isRW(a)) { E.osz(a.size); return [0x40 | (n << 3) | a.n]; }
    if (!isRM(a)) return invalid(E);
    const w = rmSize(E, a) > 1 ? 1 : 0;
    return [0xFE | w, ...modrm(E, n, a)];
  }
  function lealds(E, ops, op) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRW(a) || b.k !== 'mem') return invalid(E);
    E.osz(a.size);
    return [...op, ...modrm(E, a.n, b)];
  }
  function port(E, o) {
    if (!o.unk && (o.v < 0 || o.v > 255)) E.err('port number must be 0..255 (use dx for other ports)', o.col);
    return lo(o.v);
  }
  function aamd(E, ops, op) {
    nops(E, ops, 0, 1);
    if (ops.length && ops[0].k !== 'imm') return invalid(E);
    return [op, ops.length ? imm8(E, ops[0]) : 10];
  }
  function retx(E, ops, op, size) {
    nops(E, ops, 0, 1);
    if (size) E.o = size;
    if (!ops.length) return [op];
    if (ops[0].k !== 'imm') return invalid(E);
    return [op - 1, ...imm16(E, ops[0])];
  }
  function alu(E, ops, n) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRM(a)) return invalid(E);
    const s = opSize(E, a, b);
    const w = s > 1 ? 1 : 0;
    if (b.k === 'imm') {
      if (w && useS8(E, b, s)) return [0x83, ...modrm(E, n, a), lo(b.v)];
      if (isAcc(a)) return [0x04 | (n << 3) | w, ...immS(E, b, s)];
      return [0x80 | w, ...modrm(E, n, a), ...immS(E, b, s)];
    }
    if (isGP(b)) return [(n << 3) | w, ...modrm(E, b.n, a)];
    if (a.k === 'reg' && b.k === 'mem') return [(n << 3) | 2 | w, ...modrm(E, a.n, b)];
    return invalid(E);
  }
  function shift(E, ops, n) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRM(a)) return invalid(E);
    const w = rmSize(E, a) > 1 ? 1 : 0;
    if (isR(b, 'r8') && b.n === 1) return [0xD2 | w, ...modrm(E, n, a)];
    if (b.k !== 'imm') return invalid(E);
    if (!E.grow('shift', b.unk || b.v === 1 ? 0 : 1)) return [0xD0 | w, ...modrm(E, n, a)];
    E.needCpu(1, 'shift count other than 1 or cl', b.col);
    return [0xC0 | w, ...modrm(E, n, a), imm8(E, b)];
  }
  function grp3(E, ops, n) {
    if (E.mnem === 'imul' && ops.length > 1) {
      nops(E, ops, 2, 3);
      const imm = ops[ops.length - 1];
      const r = ops[0];
      if (imm.k !== 'imm') {
        // imul r16/r32, r/m16/r/m32 (0F AF, 80386)
        if (ops.length === 3) return invalid(E);
        E.needCpu(3, "'imul reg, r/m'", E.col);
        if (!isRW(r) || !isRM(imm)) return invalid(E);
        opSize(E, r, imm);
        return [0x0F, 0xAF, ...modrm(E, r.n, imm)];
      }
      // imul r, r/m, imm  and  imul r, imm  (= imul r, r, imm)
      E.needCpu(1, "'imul' with an immediate", E.col);
      const src = ops.length === 3 ? ops[1] : r;
      if (!isRW(r) || !isRM(src) || isR(src, 'r8')) return invalid(E);
      const s = opSize(E, r, src);
      const rm = modrm(E, r.n, src);
      return useS8(E, imm, s) ? [0x6B, ...rm, lo(imm.v)] : [0x69, ...rm, ...immS(E, imm, s)];
    }
    nops(E, ops, 1);
    const [a] = ops;
    if (!isRM(a)) return invalid(E);
    const w = rmSize(E, a) > 1 ? 1 : 0;
    return [0xF6 | w, ...modrm(E, n, a)];
  }
  function jcc(E, ops, cc) {
    nops(E, ops, 1);
    const [o] = ops;
    if (o.k !== 'imm') return invalid(E);
    if (o.jmp === 'far') return E.err('conditional jumps cannot be far', o.col);
    if (E.cpu < 3) {
      if (o.jmp === 'near') return E.err("'near' conditional jumps are 386+ (without 'near', a far target gets a jump-over)", o.col);
      if (o.jmp === 'short') return short(E, 0x70 | cc, o, 2);
      const d = o.v - E.pc(2);
      if (!E.grow('jmp', o.unk || (d >= -128 && d <= 127) ? 0 : 1)) return [0x70 | cc, lo(d)];
      // 8086 has no near Jcc: NASM emits the inverse Jcc over a near jmp
      return [0x70 | (cc ^ 1), 3, 0xE9, ...w16(o.v - E.pc(5))];
    }
    // 80386: 0F 80+cc with a rel16 or rel32 displacement (the operand size)
    if (o.size) {
      if (o.jmp !== 'near') return E.err("a size keyword on a conditional jump needs 'near'", o.col);
      if (o.size !== 2 && o.size !== 4) return invalid(E);
      E.osz(o.size);
    }
    if (o.jmp === 'short') return short(E, 0x70 | cc, o, 2);
    const d = o.v - E.pc(2);
    if (o.jmp !== 'near' && !E.grow('jmp', o.unk || (d >= -128 && d <= 127) ? 0 : 1)) return [0x70 | cc, lo(d)];
    return [0x0F, 0x80 | cc, ...rel(E, o, 2, o.size || codeSize(E))];
  }
  function jmpcall(E, ops, isJmp) {
    nops(E, ops, 1);
    const [o] = ops;
    if (o.k === 'far') {
      // ptr16:16, or ptr16:32 with a dword size (or in bits 32)
      const s = o.size || codeSize(E);
      if (s !== 2 && s !== 4) return invalid(E);
      E.osz(s);
      return [isJmp ? 0xEA : 0x9A, ...(s === 4 ? w32(o.off) : w16(o.off)), ...w16(o.segv)];
    }
    if (o.k === 'mem' || isRW(o)) {
      // indirect: the size is the operand size (the offset size for a far pointer)
      const far = o.jmp === 'far';
      if (far && o.k !== 'mem') return invalid(E);
      if (o.size) {
        if (o.size !== 2 && o.size !== 4) return E.err('use "far" for a far indirect jump or call', o.col);
        E.osz(o.size);
      }
      return [0xFF, ...modrm(E, (isJmp ? 4 : 2) + (far ? 1 : 0), o)];
    }
    if (o.k !== 'imm') return invalid(E);
    if (o.jmp === 'far') return E.err('a far jump or call needs segment:offset', o.col);
    if (o.size && o.size !== 2 && o.size !== 4) return invalid(E);
    if (o.size) E.osz(o.size);
    const s = o.size || codeSize(E);
    if (!isJmp) {
      if (o.jmp === 'short') return E.err('call cannot be short', o.col);
      return [0xE8, ...rel(E, o, 1, s)];
    }
    if (o.jmp === 'short') return short(E, 0xEB, o, 2);
    const d = o.v - E.pc(2);
    const big = o.jmp === 'near' || o.size ? 1 : E.grow('jmp', o.unk || (d >= -128 && d <= 127) ? 0 : 1);
    return big ? [0xE9, ...rel(E, o, 1, s)] : [0xEB, lo(d)];
  }

  // 80386
  // movzx / movsx: r16/r32, r/m8 (0F B6 / BE) and r32, r/m16 (0F B7 / BF)
  function movx(E, ops, op) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRW(a) || !isRM(b)) return invalid(E);
    if (!b.size) return E.err('operation size not specified', b.col);
    if (b.size >= a.size) return b.k === 'mem' ? E.err('mismatch in operand sizes', b.col) : invalid(E);
    E.osz(a.size);
    return [0x0F, op + (b.size === 2 ? 1 : 0), ...modrm(E, a.n, b)];
  }
  // bsf / bsr r, r/m
  function bitscan(E, ops, op) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRW(a) || !isRM(b)) return invalid(E);
    opSize(E, a, b);
    return [0x0F, op, ...modrm(E, a.n, b)];
  }
  // bt / bts / btr / btc r/m, r (0F A3 ...) and r/m, imm8 (0F BA /4-7)
  function bitop(E, ops, [op, n]) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRM(a) || isR(a, 'r8')) return invalid(E);
    if (b.k === 'imm') {
      if (rmSize(E, a) === 1) return invalid(E);
      return [0x0F, 0xBA, ...modrm(E, n, a), imm8(E, b)];
    }
    if (!isRW(b)) return invalid(E);
    opSize(E, a, b);
    return [0x0F, op, ...modrm(E, b.n, a)];
  }
  // setcc r/m8 (0F 90+cc /0)
  function setcc(E, ops, cc) {
    nops(E, ops, 1);
    const [a] = ops;
    if (!(isR(a, 'r8') || (a.k === 'mem' && (!a.size || a.size === 1)))) return invalid(E);
    return [0x0F, 0x90 | cc, ...modrm(E, 0, a)];
  }
  // shld / shrd r/m, r, imm8 (0F A4 / AC) or cl (0F A5 / AD)
  function dshift(E, ops, op) {
    nops(E, ops, 3);
    const [a, b, c] = ops;
    if (!isRM(a) || !isRW(b)) return invalid(E);
    opSize(E, a, b);
    if (isR(c, 'r8') && c.n === 1) return [0x0F, op + 1, ...modrm(E, b.n, a)];
    if (c.k !== 'imm') return invalid(E);
    return [0x0F, op, ...modrm(E, b.n, a), imm8(E, c)];
  }

  // 8087
  function fpuMem(E, o, table) {
    const e = table[o.size];
    if (!o.size) return E.err('operation size not specified', o.col);
    if (!e) return E.err(`invalid operand size for '${E.mnem}'`, o.col);
    return [e[0], ...modrm(E, e[1], o)];
  }
  function fldst(E, ops, t) {
    nops(E, ops, 1);
    const [o] = ops;
    if (isR(o, 'st') && t.st) return [t.st[0], t.st[1] + o.n];
    if (o.k === 'mem' && Object.keys(t).some((k) => k !== 'st')) return fpuMem(E, o, t);
    return invalid(E);
  }
  function farith(E, ops, n) {
    nops(E, ops, 0, 1, 2);
    const cmp = n === 2 || n === 3;
    if (!ops.length) return cmp ? [0xD8, 0xD1 + 8 * (n - 2)] : [0xDE, 0xC1 + 8 * frev(n)];
    if (ops.length === 1) {
      const [o] = ops;
      if (o.k === 'mem') return fpuMem(E, o, { 4: [0xD8, n], 8: [0xDC, n] });
      if (!isR(o, 'st')) return invalid(E);
      if (o.to) return cmp ? invalid(E) : [0xDC, 0xC0 + 8 * frev(n) + o.n];
      return [0xD8, 0xC0 + 8 * n + o.n];
    }
    const [a, b] = ops;
    if (!isR(a, 'st') || !isR(b, 'st')) return invalid(E);
    if (b.n === 0 && !cmp) return [0xDC, 0xC0 + 8 * frev(n) + a.n]; // NASM: "st0, st0" uses DC
    if (a.n === 0) return [0xD8, 0xC0 + 8 * n + b.n];
    return invalid(E);
  }
  function farithp(E, ops, n) {
    nops(E, ops, 0, 1, 2);
    if (!ops.every((o) => isR(o, 'st'))) return invalid(E);
    if (ops.length === 2 && ops[1].n !== 0) return invalid(E);
    const i = ops.length ? ops[0].n : 1;
    return [0xDE, 0xC0 + 8 * frev(n) + i];
  }
  function fiarith(E, ops, n) {
    nops(E, ops, 1);
    if (ops[0].k !== 'mem') return invalid(E);
    return fpuMem(E, ops[0], { 2: [0xDE, n], 4: [0xDA, n] });
  }
  function fctrl(E, ops, [op, reg, wait, sizes]) {
    nops(E, ops, 1);
    const [o] = ops;
    if (isR(o, 'r16') && o.n === 0 && op === 0xDD) {
      E.needCpu(2, `'${E.mnem} ax'`, o.col);
      if (wait) E.wait = true;
      return [0xDF, 0xE0];
    }
    if (o.k !== 'mem') return invalid(E);
    if (!sizes.includes(o.size)) return E.err(`invalid operand size for '${E.mnem}'`, o.col);
    if (wait) E.wait = true;
    return [op, ...modrm(E, reg, o)];
  }
  // Pentium Pro fcmovcc / fcomi / fucomi / fcomip / fucomip: st(i), or st0, st(i); fcomi and the
  // others with no operand = st1
  function fcmov(E, ops, [op, base]) {
    nops(E, ops, 0, 1, 2);
    if (!ops.every((o) => isR(o, 'st'))) return invalid(E);
    if (ops.length === 2 && ops[0].n !== 0) return invalid(E);
    if (!ops.length && base < 0xE0 && op !== 0xDF) return invalid(E);
    return [op, base + (ops.length ? ops[ops.length - 1].n : 1)];
  }
  // Pentium Pro cmovcc r16 / r32, r/m16 / r/m32 (0F 40+cc)
  function cmovcc(E, ops, cc) {
    nops(E, ops, 2);
    const [a, b] = ops;
    if (!isRW(a) || !isRM(b)) return invalid(E);
    opSize(E, a, b);
    return [0x0F, 0x40 | cc, ...modrm(E, a.n, b)];
  }
  // 80387 fucom / fucomp st(i) (DD E0+i / DD E8+i); no operand = st1
  function fucom(E, ops, base) {
    nops(E, ops, 0, 1, 2);
    if (!ops.every((o) => isR(o, 'st'))) return invalid(E);
    if (ops.length === 2 && ops[0].n !== 0) return invalid(E);
    return [0xDD, base + (ops.length ? ops[ops.length - 1].n : 1)];
  }

  function encodeInsn(E, m, ops) {
    if (m in MIN_LEVEL) E.needCpu(MIN_LEVEL[m], `'${m}'`, E.col);
    if (m in SYS) return sys(E, ops, SYS[m]);
    if (m in SIMPLE) { nops(E, ops, 0); return SIMPLE[m]; }
    if (m in SIZED) {
      nops(E, ops, 0);
      const [op, size] = SIZED[m];
      if (size) E.o = size;
      return [op];
    }
    if (m in ALU) return alu(E, ops, ALU[m]);
    if (m in SHIFT) return shift(E, ops, SHIFT[m]);
    if (m in GRP3) return grp3(E, ops, GRP3[m]);
    if (m in JCC) return jcc(E, ops, JCC[m]);
    if (m in SETCC) return setcc(E, ops, SETCC[m]);
    if (m in CMOVCC) return cmovcc(E, ops, CMOVCC[m]);
    if (m in FCMOV) return fcmov(E, ops, FCMOV[m]);
    if (m in BITOP) return bitop(E, ops, BITOP[m]);
    if (m in LOOPS) {
      // loop x, cx / loop x, ecx select the count register (address size); jecxz uses ecx
      const jcx = LOOPS[m] === 0xE3;
      if (jcx) nops(E, ops, 1); else nops(E, ops, 1, 2);
      if (ops[0].jmp === 'near' || ops[0].jmp === 'far') return E.err(`'${m}' has only a short form`, ops[0].col);
      if (jcx) E.setAsz(m === 'jecxz' ? 32 : 16, E.col);
      if (ops.length === 2) {
        const c = ops[1];
        if (!isRW(c) || c.n !== 1) return invalid(E);
        E.setAsz(c.size * 8, c.col);
      }
      return short(E, LOOPS[m], ops[0], 2);
    }
    if (m in FARITH) return farith(E, ops, FARITH[m]);
    if (m in FARITHP) return farithp(E, ops, FARITHP[m]);
    if (m in FIARITH) return fiarith(E, ops, FIARITH[m]);
    if (m in FCTRL) return fctrl(E, ops, FCTRL[m]);
    if (m in FLDST) return fldst(E, ops, FLDST[m]);
    if (m === 'pop' && isR(ops[0], 'sreg') && ops[0].n === 1 && !E.cpu) return [0x0F];
    return HANDLERS[m](E, ops);
  }

  // ------------------------------------------------------------ float data
  // Converts a decimal literal to IEEE bytes (4, 8) or 80-bit extended (10),
  // with exact round-to-nearest-even.
  function floatBytes(text, neg, size) {
    const m = /^([0-9_]*)(?:\.([0-9_]*))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);
    const ip = (m[1] || '').replace(/_/g, '');
    const fp = (m[2] || '').replace(/_/g, '');
    let mant = BigInt((ip + fp) || '0');
    let e10 = Number(m[3] || 0) - fp.length;
    const [P, EB] = { 4: [24, 8], 8: [53, 11], 10: [64, 15] }[size];
    const bias = (1 << (EB - 1)) - 1;
    const emin = 1 - bias;
    let q = 0n;
    let bexp = 0;
    if (mant !== 0n) {
      let num = mant;
      let den = 1n;
      if (e10 >= 0) num *= 10n ** BigInt(e10); else den = 10n ** BigInt(-e10);
      const bl = (x) => x.toString(2).length;
      let e = bl(num) - bl(den) - P; // candidate exponent of the last mantissa bit
      const quot = (ex) => {
        const n2 = ex < 0 ? num << BigInt(-ex) : num;
        const d2 = ex > 0 ? den << BigInt(ex) : den;
        const qq = n2 / d2;
        const r2 = (n2 - qq * d2) * 2n;
        return { qq, r2, d2 };
      };
      let t = quot(e);
      while (t.qq >= 1n << BigInt(P)) t = quot(++e);
      while (t.qq < 1n << BigInt(P - 1)) t = quot(--e);
      if (e + P - 1 < emin) { e = emin - (P - 1); t = quot(e); }
      q = t.qq;
      if (t.r2 > t.d2) q++; // NASM rounds to nearest; an exact tie goes toward zero
      if (q === 1n << BigInt(P)) { q >>= 1n; e++; }
      bexp = q >= 1n << BigInt(P - 1) ? e + P - 1 + bias : 0;
      if (bexp >= 2 ** EB - 1) { bexp = 2 ** EB - 1; q = size === 10 ? 1n << 63n : 0n; }
    }
    const out = [];
    let bits;
    if (size === 10) {
      for (let k = 0; k < 8; k++) out.push(Number((q >> BigInt(8 * k)) & 255n));
      const se = (neg ? 0x8000 : 0) | bexp;
      out.push(se & 255, se >> 8);
      return out;
    }
    const frac = q & ((1n << BigInt(P - 1)) - 1n);
    bits = (BigInt(neg ? 1 : 0) << BigInt(size * 8 - 1)) | (BigInt(bexp) << BigInt(P - 1)) | frac;
    for (let k = 0; k < size; k++) out.push(Number((bits >> BigInt(8 * k)) & 255n));
    return out;
  }

  function intBytes(v, size) {
    const b = [];
    let x = BigInt.asUintN(size * 8, v);
    for (let k = 0; k < size; k++) { b.push(Number(x & 255n)); x >>= 8n; }
    return b;
  }

  // ------------------------------------------------------------------ passes
  function assemble(source, opts = {}) {
    const optOrigin = opts.origin === undefined ? 0x100 : opts.origin;
    const cpu = CPU_LEVELS[String(opts.cpu === undefined ? '8086' : opts.cpu).toLowerCase()];
    if (cpu === undefined) throw new Error(`Asm86: unsupported cpu option '${opts.cpu}'`);
    const bits = opts.bits === undefined ? 16 : Number(opts.bits);
    if (bits !== 16 && bits !== 32) throw new Error(`Asm86: unsupported bits option '${opts.bits}'`);
    if (bits === 32 && cpu < 3) throw new Error("Asm86: the bits option 32 needs the cpu option '386'");
    const lines = String(source).split(/\r\n|\r|\n/);
    const parseErrors = [];
    const stmts = [];
    let parent = '';
    const ctx = {
      symName: (name, col) => {
        if (name[0] === '\u0001') name = name.slice(1);
        if (name[0] === '.' && name[1] !== '.') {
          if (!parent) fail(`local label '${name}' has no parent label`, col);
          return parent + name;
        }
        return name;
      },
      defName(name, col, isLabel) {
        const full = this.symName(name, col);
        if (isLabel && name[0] !== '.') parent = full;
        return full;
      },
    };
    lines.forEach((text, k) => {
      try {
        const s = parseLine(text, k + 1, ctx);
        if (s) stmts.push(s);
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        parseErrors.push({ line: k + 1, col: e.col, msg: e.message });
      }
    });

    const sticky = new Map();
    let prev = new Map();
    let origin = optOrigin;
    let S = null;
    for (let pass = 1; pass <= 60; pass++) {
      S = runPass(stmts, prev, origin, sticky, cpu, bits);
      const stable = S.syms.size === prev.size && [...S.syms].every(([k, v]) => prev.get(k) === v);
      const newOrigin = S.org === null ? optOrigin : S.org;
      if (pass > 1 && stable && !S.changed && newOrigin === origin) break;
      if (pass === 60) S.errors.push({ line: 1, col: 1, msg: 'label values do not become stable' });
      prev = S.syms;
      origin = newOrigin;
    }
    const errors = parseErrors.concat(S.errors).sort((a, b) => a.line - b.line || a.col - b.col);
    const symbols = {};
    for (const [k, v] of S.syms) symbols[k] = Number(v);
    return {
      ok: errors.length === 0,
      bytes: Uint8Array.from(S.bytes),
      origin,
      errors,
      lineMap: S.lineMap,
      symbols,
    };
  }

  function runPass(stmts, prev, origin, sticky, cpu, bits) {
    const S = {
      syms: new Map(), bytes: [], lineMap: [], errors: [], changed: false, org: null,
      origin, here: origin, unknown: false, line: 0, cpu, bits,
      lookup(name, col) {
        if (S.syms.has(name)) return S.syms.get(name);
        if (prev.has(name)) return prev.get(name);
        S.unknown = true;
        S.err(`undefined symbol '${name}'`, col);
        return 0n;
      },
      err(msg, col) {
        if (!S.errors.some((e) => e.line === S.line && e.msg === msg)) S.errors.push({ line: S.line, col: col || 1, msg });
      },
    };
    stmts.forEach((st, idx) => {
      S.line = st.line;
      S.here = S.origin + S.bytes.length;
      try {
        if (st.label !== null && st.body.kind !== 'equ') define(S, st.label, BigInt(S.here), st.labelCol);
        const out = [];
        runBody(S, st, st.body, out, idx, sticky);
        if (out.length) {
          S.lineMap.push({ line: st.line, addr: S.here, len: out.length });
          for (const b of out) S.bytes.push(b);
        }
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        S.err(e.message, e.col);
      }
    });
    return S;
  }

  function define(S, name, v, col) {
    if (S.syms.has(name)) S.err(`symbol '${name}' is defined more than one time`, col);
    else S.syms.set(name, v);
  }

  // evaluates a pure expression: returns { v, unk }
  function value(S, e, col) {
    const was = S.unknown;
    S.unknown = false;
    const r = evalLin(e, S);
    if (!isPure(r)) fail('registers are not permitted in this expression', col);
    const unk = S.unknown;
    S.unknown = was || unk;
    return { v: Number(r.c), big: r.c, unk };
  }

  // Memory operands get: disp, unk, asz (16 | 32), direct (no register), and
  //   asz 16: base ('bx' | 'bp' | null), index ('si' | 'di' | null)
  //   asz 32: base, index (register numbers, -1 = none), scale (1, 2, 4, 8)
  // aForce: the address size of an a16 / a32 prefix (0 = none).
  function resolveOp(S, o, aForce) {
    if (o.k === 'imm') { const r = value(S, o.e, o.col); return { ...o, v: r.v, unk: r.unk }; }
    if (o.k === 'far') {
      const s = value(S, o.seg, o.col);
      const f = value(S, o.off, o.col);
      return { ...o, segv: s.v, off: f.v, unk: s.unk || f.unk };
    }
    if (o.k !== 'mem') return o;
    const was = S.unknown;
    S.unknown = false;
    const r = evalLin(o.e, S);
    const unk = S.unknown;
    S.unknown = was || unk;
    const out = { ...o, disp: Number(BigInt.asIntN(32, r.c)), unk, direct: false, base: null, index: null, scale: 1 };
    const regs = Object.entries(r.r);
    const bad = (why) => fail(`invalid effective address (${why})`, o.col);
    if (!regs.length) {
      // [dword x] and [word x] select the address size of a direct address
      out.direct = true;
      out.asz = o.dsize === 4 ? 32 : o.dsize === 2 ? 16 : aForce || S.bits;
      return out;
    }
    if (!regs.every(([reg]) => reg in REG32)) {
      out.asz = 16;
      for (const [reg, f] of regs) {
        if (reg in REG32) bad('16-bit and 32-bit registers');
        if (f !== 1n) bad(`${reg}*${f}`);
        if (reg === 'bx' || reg === 'bp') { if (out.base) bad('two base registers'); out.base = reg; }
        else if (reg === 'si' || reg === 'di') { if (out.index) bad('two index registers'); out.index = reg; }
        else fail(`invalid effective address ('${reg}' cannot be used in an address)`, o.col);
      }
      if (o.dsize === 4) bad('dword displacement with 16-bit registers');
      return out;
    }
    // 32-bit address. NASM rules: a register with a factor other than 1 is the index;
    // [r*2], [r*3], [r*5], [r*9] become [r+r*n] (not with nosplit); of two registers
    // with factor 1, the first is the base, but a register written with '*' is the index;
    // esp cannot be an index, so [x+esp] becomes [esp+x].
    out.asz = 32;
    if (o.dsize === 2) bad('word displacement with 32-bit registers');
    const h = r.h || {};
    const list = regs.map(([reg, f]) => ({ reg, n: REG32[reg], f: Number(f), h: !!h[reg] }));
    let base = -1;
    let index = -1;
    let sc = 1;
    if (list.length > 2) bad('too many registers');
    if (list.length === 1) {
      const { reg, n, f } = list[0];
      if (f === 1 && !(o.nosplit && list[0].h)) base = n;
      else if (!o.nosplit && (f === 2 || f === 3 || f === 5 || f === 9)) { base = n; index = n; sc = f - 1; }
      else if (f in SCALE) { index = n; sc = f; }
      else bad(`${reg}*${f}`);
    } else {
      let [x, y] = list;
      if (x.f !== 1 && y.f !== 1) bad('two index registers');
      if (x.f !== 1 || (y.f === 1 && x.h && !y.h)) [x, y] = [y, x];
      if (!(y.f in SCALE)) bad(`${y.reg}*${y.f}`);
      base = x.n; index = y.n; sc = y.f;
    }
    if (index === 4) {
      if (sc !== 1 || base === 4) bad('esp cannot be an index');
      [base, index] = [index, base];
    }
    out.base = base; out.index = index; out.scale = sc;
    return out;
  }

  function runBody(S, st, body, out, idx, sticky) {
    switch (body.kind) {
      case 'none': return;
      case 'cpu': S.cpu = body.level; return;
      case 'bits':
        if (body.bits === 32 && S.cpu < 3) fail('BITS 32 needs cpu 386 or later', body.col);
        S.bits = body.bits;
        return;
      case 'equ': {
        const r = value(S, body.e, body.col);
        if (!r.unk) define(S, st.label, r.big, st.labelCol);
        return;
      }
      case 'org': {
        const r = value(S, body.e, body.col);
        if (S.org !== null && S.org !== r.v) fail('only one ORG value is supported', body.col);
        S.org = r.v;
        if (!S.bytes.length) S.origin = r.v;
        return;
      }
      case 'times': {
        const r = value(S, body.count, body.col);
        if (r.unk) return;
        if (r.v < 0) fail('TIMES count is negative', body.col);
        if (r.v > 0x100000) fail('TIMES count is too large', body.col);
        for (let k = 0; k < r.v; k++) runBody(S, st, body.body, out, idx, sticky);
        return;
      }
      case 'res': {
        const r = value(S, body.e, body.col);
        if (r.unk) return;
        if (r.v < 0 || r.v * body.unit > 0x100000) fail('invalid reserve count', body.col);
        for (let k = 0; k < r.v * body.unit; k++) out.push(0);
        return;
      }
      case 'align': {
        const r = value(S, body.e, body.col);
        if (r.unk) return;
        if (r.v <= 0 || (r.v & (r.v - 1))) fail('alignment must be a power of two', body.col);
        const pos = S.bytes.length + out.length;
        for (let k = 0; k < (r.v - (pos % r.v)) % r.v; k++) out.push(body.fill);
        return;
      }
      case 'data': {
        const u = body.unit;
        for (const it of body.items) {
          if (it.k === 'str') {
            const b = it.bytes.slice();
            if (u > 1) while (b.length % u) b.push(0);
            if (!b.length && u > 1) for (let k = 0; k < u; k++) b.push(0);
            out.push(...b);
          } else if (it.k === 'float') {
            out.push(...floatBytes(it.text, it.neg, u));
          } else if (u === 10) {
            const r = value(S, it.e, it.col);
            out.push(...floatBytes(String(r.big < 0n ? -r.big : r.big), r.big < 0n, 10));
          } else {
            out.push(...intBytes(value(S, it.e, it.col).big, u));
          }
        }
        return;
      }
      default: break;
    }
    // instruction
    const E = {
      mnem: body.mnem, col: body.col, seg: null, wait: false, cpu: S.cpu, bits: S.bits,
      // o / a: the operand / address size that the operands need (16 | 32, 0 = any);
      // oForce / aForce: the size of an o16 / o32 / a16 / a32 prefix
      o: 0, a: 0, oForce: 0, aForce: 0,
      start: S.here + out.length, plen: 0,
      needCpu(level, what, col) {
        if (S.cpu >= level) return;
        if (level > 5) E.err(`${what} is a Pentium Pro instruction, not ${/^[8]/.test(LEVEL_NAME[S.cpu]) ? 'an' : 'a'} ${LEVEL_NAME[S.cpu]} instruction (use cpu 686)`, col);
        if (level > 4) E.err(`${what} is a Pentium instruction, not an ${LEVEL_NAME[S.cpu]} instruction (use cpu 586)`, col);
        E.err(`${what} is not an ${LEVEL_NAME[S.cpu]} instruction (use cpu ${level > 3 ? 486 : level > 2 ? 386 : 286})`, col);
      },
      grow(key, need) {
        const k = idx + ':' + key;
        const cur = sticky.get(k) || 0;
        if (need > cur) { sticky.set(k, need); S.changed = true; return need; }
        return cur;
      },
      err(msg, col) { throw new AsmError(msg, col || body.col); },
      setSeg(s, col) {
        if (E.seg !== null && E.seg !== s) E.err('conflicting segment overrides', col);
        E.seg = s;
      },
      osz(s) {
        if (s === 2) E.o = 16;
        else if (s === 4) E.o = 32;
      },
      setAsz(a, col) {
        if (E.aForce && E.aForce !== a) E.err(`the address size does not agree with the a${E.aForce} prefix`, col);
        E.a = a;
      },
      need66() { const s = E.oForce || E.o; return s !== 0 && s !== E.bits; },
      need67() { const s = E.aForce || E.a; return s !== 0 && s !== E.bits; },
      // the address after the prefixes and len more bytes (for relative jumps)
      pc(len) {
        return E.start + E.plen + (E.seg !== null ? 1 : 0) + (E.need66() ? 1 : 0) + (E.need67() ? 1 : 0) + len;
      },
    };
    const pfx = { rep: null, lock: false };
    for (const p of body.prefixes) {
      if (p.p in OAPFX) {
        const [kind, size] = OAPFX[p.p];
        const was = kind === 'o' ? E.oForce : E.aForce;
        if (was && was !== size) E.err('conflicting prefixes', p.col);
        if (kind === 'o') E.oForce = size; else E.aForce = size;
        continue;
      }
      const b = PREFIXES[p.p];
      if (b === 0xF0) pfx.lock = true;
      else if (b === 0xF2 || b === 0xF3) {
        if (pfx.rep !== null && pfx.rep !== b) E.err('conflicting prefixes', p.col);
        pfx.rep = b;
      } else E.setSeg(SREG[p.p], p.col);
    }
    E.plen = (pfx.rep !== null ? 1 : 0) + (pfx.lock ? 1 : 0);
    let code;
    if (body.lonePrefix) {
      code = [PREFIXES[body.mnem]];
    } else {
      const ops = body.ops.map((o) => resolveOp(S, o, E.aForce));
      if (S.cpu < 3) {
        for (const o of ops) {
          if (is386Op(o)) E.err(`'${o.name}' is not an ${LEVEL_NAME[S.cpu]} register (use cpu 386)`, o.col);
        }
      }
      code = encodeInsn(E, body.mnem, ops);
      if (E.need67()) E.needCpu(3, `${E.aForce || E.a}-bit addressing`, body.col);
      if (E.need66()) E.needCpu(3, `'${body.mnem}' with a ${E.oForce || E.o}-bit operand size`, body.col);
      if (E.seg !== null && E.seg > 3) E.needCpu(3, `'${['fs', 'gs'][E.seg - 4]}' segment override`, body.col);
    }
    // NASM order: wait (also the "wait" instruction itself), rep, lock, segment, 66h, 67h
    if (E.wait || body.mnem === 'wait' || body.mnem === 'fwait') { out.push(0x9B); if (!E.wait) code = []; }
    if (pfx.rep !== null) out.push(pfx.rep);
    if (pfx.lock) out.push(0xF0);
    if (E.seg !== null) out.push(SEGPFX[E.seg]);
    if (E.need66()) out.push(0x66);
    if (E.need67()) out.push(0x67);
    out.push(...code);
  }

  return { assemble };
})();
