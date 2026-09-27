// 8086 / 8087 (and 80286 / 80287, 80386 / 80387, 80486, Pentium, Pentium Pro) disassembler. NASM-style, lower-case output.
// Disasm86.decode(read, off, { cpu = '8086', bits = 16 }) => { len, text, mnem }
//   read(i) gives byte i of the instruction (the caller wraps the address, for
//   example (off + i) & 0xFFFF in 16-bit code). off is only used to compute the
//   absolute targets of relative jumps.
//   cpu '286' (or '80286'): 60-6F, C0/C1/C8/C9, 0F xx and the 80287 additions
//   decode as 80186/80286 instructions; opcodes with no function on the 286
//   (64-67, D6, F1, 8C/8E with sreg field > 3, mov cs) show as "db".
//   cpu '386' (or '80386'): also the 80386 / 80387 instructions, the prefixes
//   64h (fs), 65h (gs), 66h (operand size) and 67h (address size), 32-bit
//   addresses (ModR/M + SIB) and the 0F xx opcodes of the 80386. bits (16 or 32,
//   only with cpu '386' or '486') is the default operand and address size of the code.
//   cpu '486' (or '80486'): also bswap, xadd, cmpxchg (0F B0 / B1), invd, wbinvd, invlpg,
//   cpuid and the test registers tr3-tr5. bswap with a 16-bit operand size shows as "db".
//   cpu '586' (or '80586', 'pentium'): also rdtsc, rdmsr, wrmsr, rsm, cmpxchg8b and cr4; the
//   Pentium has no test registers (mov tr3-tr7 shows as "db").
//   cpu '686' (or '80686', 'p6', 'ppro', 'pentiumpro'): also cmovcc, fcmovcc, fcomi, fcomip, fucomi,
//   fucomip, rdpmc and ud2.
//   A 66h or 67h prefix that has no effect on the instruction shows as
//   "o16" / "o32" / "a16" / "a32" (as in ndisasm), so that the text assembles
//   to the same bytes.
// Undocumented 8086 aliases decode to the instruction that the CPU executes
// (60-6F = Jcc, C0/C1/C8/C9 = ret/retf, D6 = salc, F1 = lock, 0F = pop cs,
// 82 = 80, F6/F7 /1 = test, 8C/8E sreg field mod 4, 8087 register aliases).
// Encodings with no function show as "db" with all the bytes they use.

const Disasm86 = (() => {
  const R8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
  const R16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
  const R32 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
  const SREG = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];
  const EA = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', 'bp', 'bx'];
  const ALU = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
  const SHIFT = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', null, 'sar'];
  const GRP3 = ['test', 'test', 'not', 'neg', 'mul', 'imul', 'div', 'idiv'];
  const JCC = ['jo', 'jno', 'jc', 'jnc', 'jz', 'jnz', 'jna', 'ja',
    'js', 'jns', 'jpe', 'jpo', 'jl', 'jnl', 'jng', 'jg'];
  const SETCC = JCC.map((j) => 'set' + j.slice(1));
  const CMOVCC = JCC.map((j) => 'cmov' + j.slice(1));
  // Pentium Pro: fcmovcc st0, st(i) (DA C0-DF, DB C0-DF) by (opcode & 1) * 4 + reg field
  const FCMOV = ['fcmovb', 'fcmove', 'fcmovbe', 'fcmovu', 'fcmovnb', 'fcmovne', 'fcmovnbe', 'fcmovnu'];
  const LOOPS = ['loopne', 'loope', 'loop', 'jcxz'];
  // string instructions; the word forms end in 'w' or 'd' by the operand size
  const STRS = { 0xA4: 'movsb', 0xA5: 'movs', 0xA6: 'cmpsb', 0xA7: 'cmps', 0xAA: 'stosb',
    0xAB: 'stos', 0xAC: 'lodsb', 0xAD: 'lods', 0xAE: 'scasb', 0xAF: 'scas' };
  const SIMPLE = { 0x27: 'daa', 0x2F: 'das', 0x37: 'aaa', 0x3F: 'aas', 0x90: 'nop',
    0x9B: 'wait', 0x9E: 'sahf', 0x9F: 'lahf',
    0xC1: 'ret', 0xC3: 'ret', 0xC9: 'retf', 0xCB: 'retf', 0xCC: 'int3', 0xCE: 'into',
    0xD6: 'salc', 0xD7: 'xlatb', 0xF4: 'hlt', 0xF5: 'cmc', 0xF8: 'clc',
    0xF9: 'stc', 0xFA: 'cli', 0xFB: 'sti', 0xFC: 'cld', 0xFD: 'std' };
  const BT = ['bt', 'bts', 'btr', 'btc'];

  // 8087 memory forms: [opcode & 7][reg] = [mnemonic, size keyword]
  const FARITH = ['fadd', 'fmul', 'fcom', 'fcomp', 'fsub', 'fsubr', 'fdiv', 'fdivr'];
  const FIARITH = FARITH.map((m) => 'fi' + m.slice(1));
  const all = (names, size) => names.map((m) => [m, size]);
  const FMEM = [
    all(FARITH, 'dword'),
    [['fld', 'dword'], null, ['fst', 'dword'], ['fstp', 'dword'], ['fldenv', ''],
      ['fldcw', 'word'], ['fnstenv', ''], ['fnstcw', 'word']],
    all(FIARITH, 'dword'),
    [['fild', 'dword'], null, ['fist', 'dword'], ['fistp', 'dword'], null,
      ['fld', 'tword'], null, ['fstp', 'tword']],
    all(FARITH, 'qword'),
    [['fld', 'qword'], null, ['fst', 'qword'], ['fstp', 'qword'], ['frstor', ''], null,
      ['fnsave', ''], ['fnstsw', 'word']],
    all(FIARITH, 'word'),
    [['fild', 'word'], null, ['fist', 'word'], ['fistp', 'word'], ['fbld', 'tword'],
      ['fild', 'qword'], ['fbstp', 'tword'], ['fistp', 'qword']],
  ];
  // 8087 register-only instructions, by second byte
  const FD9 = { 0xD0: 'fnop', 0xE0: 'fchs', 0xE1: 'fabs', 0xE4: 'ftst', 0xE5: 'fxam',
    0xE8: 'fld1', 0xE9: 'fldl2t', 0xEA: 'fldl2e', 0xEB: 'fldpi', 0xEC: 'fldlg2',
    0xED: 'fldln2', 0xEE: 'fldz', 0xF0: 'f2xm1', 0xF1: 'fyl2x', 0xF2: 'fptan',
    0xF3: 'fpatan', 0xF4: 'fxtract', 0xF6: 'fdecstp', 0xF7: 'fincstp', 0xF8: 'fprem',
    0xF9: 'fyl2xp1', 0xFA: 'fsqrt', 0xFC: 'frndint', 0xFD: 'fscale' };
  // 80387 additions to D9
  const FD9_387 = { 0xF5: 'fprem1', 0xFB: 'fsincos', 0xFE: 'fsin', 0xFF: 'fcos' };
  const FDB = { 0xE0: 'fneni', 0xE1: 'fndisi', 0xE2: 'fnclex', 0xE3: 'fninit' };
  // DC and DE: "st(i), st0" forms. The sub/div pairs have reversed reg fields.
  const FREV = ['fadd', 'fmul', 'fcom', 'fcomp', 'fsubr', 'fsub', 'fdivr', 'fdiv'];

  const SYS0 = ['sldt', 'str', 'lldt', 'ltr', 'verr', 'verw'];
  const SYS1 = ['sgdt', 'sidt', 'lgdt', 'lidt', 'smsw', null, 'lmsw'];

  const hex = (v, digits = 1) => '0x' + v.toString(16).toUpperCase().padStart(digits, '0');
  const sdisp = (v) => (v & 0x8000 ? '-' + hex(0x10000 - v) : '+' + hex(v));
  const sdisp32 = (v) => (v < 0 ? '-' + hex(-v) : '+' + hex(v)); // v: signed 32-bit

  function decode(read, off, opts) {
    const cpu = opts ? String(opts.cpu) : '';
    const c686 = cpu === '686' || cpu === '80686' || cpu === 'p6' || cpu === 'ppro' || cpu === 'pentiumpro';
    const c586 = c686 || cpu === '586' || cpu === '80586' || cpu === 'pentium';
    const c486 = c586 || cpu === '486' || cpu === '80486';
    const c386 = c486 || cpu === '386' || cpu === '80386';
    const c286 = c386 || cpu === '286' || cpu === '80286';
    const bits = c386 && Number(opts.bits) === 32 ? 32 : 16;
    let i = 0;
    let seg = null;
    let rep = 0;
    let lock = false;
    let pOp = false; // 66h
    let pAd = false; // 67h
    for (;;) {
      const b = read(i);
      if ((b & 0xE7) === 0x26) seg = SREG[(b >> 3) & 3];
      else if (c386 && (b === 0x64 || b === 0x65)) seg = SREG[b - 0x60];
      else if (c386 && b === 0x66) pOp = true;
      else if (c386 && b === 0x67) pAd = true;
      else if (b === 0xF0 || (b === 0xF1 && !c286)) lock = true;
      else if (b === 0xF2 || b === 0xF3) rep = b;
      else break;
      if (++i === 15) return { len: 1, text: 'db ' + hex(read(0), 2), mnem: 'db' };
    }
    // operand and address size of this instruction; the "used" flags say if
    // the instruction depends on them (else the prefix shows as o16/o32/a16/a32)
    const osz = pOp ? 48 - bits : bits;
    const asz = pAd ? 48 - bits : bits;
    let oUsed = false;
    let aUsed = false;
    const op = read(i++);
    let segUsed = false;
    let mod = 0;
    let reg = 0;
    let rm = 0;
    let mem = '';
    const u8 = () => read(i++);
    const u16 = () => { const v = read(i) | (read(i + 1) << 8); i += 2; return v; };
    const u32 = () => {
      const v = (read(i) | (read(i + 1) << 8) | (read(i + 2) << 16) | (read(i + 3) << 24)) >>> 0;
      i += 4;
      return v;
    };
    const segText = () => { segUsed = !!seg; return seg ? seg + ':' : ''; };
    const o32 = () => { oUsed = true; return osz === 32; };
    const RW = () => (o32() ? R32 : R16);
    const immw = () => (o32() ? u32() : u16());
    // a sign-extended imm8, shown as an unsigned value of the operand size
    const sx8 = () => { const v = u8() << 24 >> 24; return o32() ? v >>> 0 : v & 0xFFFF; };
    // "word " / "dword " when the operand size is not the default of the code
    const ssz = () => { oUsed = true; return osz === bits ? '' : osz === 32 ? 'dword ' : 'word '; };
    // the size keyword of a memory address that has no register (the address size)
    const asize = () => (asz === bits ? '' : asz === 32 ? 'dword ' : 'word ');
    // 16-bit address
    const ea16 = () => {
      if (mod === 0 && rm === 6) return '[' + asize() + segText() + hex(u16()) + ']';
      const d = mod === 1 ? (u8() << 24 >> 24) & 0xFFFF : mod === 2 ? u16() : 0;
      return '[' + segText() + EA[rm] + (d ? sdisp(d) : '') + ']';
    };
    // 32-bit address: [base + index*scale + disp]. With no base, NASM needs
    // "nosplit" to keep [r*1+d] and [r*2+d] as written.
    const ea32 = () => {
      let base = rm;
      let index = -1;
      let scale = 0;
      if (rm === 4) {
        const sib = u8();
        scale = sib >> 6;
        index = (sib >> 3) & 7;
        base = sib & 7;
        if (index === 4) index = -1;
      }
      let d = 0;
      if (base === 5 && mod === 0) { base = -1; d = u32() | 0; }
      else if (mod === 1) d = u8() << 24 >> 24;
      else if (mod === 2) d = u32() | 0;
      if (base < 0 && index < 0) return '[' + asize() + segText() + hex(d >>> 0) + ']';
      const parts = [];
      if (base >= 0) parts.push(R32[base]);
      if (index >= 0) parts.push(R32[index] + (scale || base < 0 ? '*' + (1 << scale) : ''));
      const nosplit = base < 0 && scale < 2 ? 'nosplit ' : '';
      return '[' + nosplit + segText() + parts.join('+') + (d ? sdisp32(d) : '') + ']';
    };
    const modrm = () => {
      const m = u8();
      mod = m >> 6; reg = (m >> 3) & 7; rm = m & 7;
      if (mod === 3) return;
      aUsed = true;
      mem = asz === 32 ? ea32() : ea16();
    };
    // mov acc, [x] / mov [x], acc
    const moffs = () => {
      aUsed = true;
      const size = asize();
      return '[' + size + segText() + hex(asz === 32 ? u32() : u16()) + ']';
    };
    // r/m operand; size keyword only for memory operands that need it
    const E = (w, size) => (mod === 3 ? (w ? RW() : R8)[rm] : (size ? size + ' ' : '') + mem);
    // r/m16 operand (the operand size has no effect)
    const E16 = () => (mod === 3 ? R16[rm] : mem);
    const sz = (w) => (w ? (o32() ? 'dword' : 'word') : 'byte');
    // near indirect jump or call target
    const near = () => (mod === 3 ? RW()[rm] : ssz() + mem);
    // pushf, popf, iret, pusha, popa: 'd' or 'w' when the operand size is not the default
    const nameW = (base) => { oUsed = true; return osz === bits ? base : base + (osz === 32 ? 'd' : 'w'); };
    const target = (d) => (osz === 32 ? hex((off + i + d) >>> 0, 8) : hex((off + i + d) & 0xFFFF, 4));
    const rel8 = () => { const d = u8() << 24 >> 24; return target(d); };
    const relw = () => { oUsed = true; const d = osz === 32 ? u32() | 0 : u16(); return target(d); };
    const bad = () => null;

    // 80186 / 80286 opcodes; undefined = not a 286 special case
    function body286() {
      switch (op) {
        case 0x0F: return sys();
        case 0x60: return [nameW('pusha')];
        case 0x61: return [nameW('popa')];
        case 0x62: modrm(); return mod === 3 ? bad() : ['bound', RW()[reg], mem];
        case 0x63: modrm(); return ['arpl', E16(), R16[reg]];
        case 0x68: { const s = ssz(); return ['push', s + hex(immw())]; }
        case 0x6A: { const s = ssz(); return ['push', s + hex(sx8())]; }
        case 0x69: case 0x6B: {
          modrm();
          const src = E(1);
          return ['imul', RW()[reg], src, hex(op === 0x69 ? immw() : sx8())];
        }
        case 0x6C: return ['insb'];
        case 0x6D: return [o32() ? 'insd' : 'insw'];
        case 0x6E: return ['outsb'];
        case 0x6F: return [o32() ? 'outsd' : 'outsw'];
        case 0xC0: case 0xC1: {
          modrm();
          if (!SHIFT[reg]) return bad();
          const a = E(op & 1, sz(op & 1));
          const n = u8();
          // count 1 shows as "1" (NASM encodes "shl ax, 1" as D1 E0)
          return [SHIFT[reg], a, n === 1 ? '1' : hex(n)];
        }
        case 0xC8: { const a = u16(); return ['enter', hex(a), hex(u8())]; }
        case 0xC9: return ['leave'];
        case 0xD6: case 0xF1: case 0x64: case 0x65: case 0x66: case 0x67: return bad();
        case 0x8C: case 0x8E:
          modrm();
          if (reg > (c386 ? 5 : 3) || (op === 0x8E && reg === 1)) return bad();
          // mov sreg, r/m: the operand size has no effect (NASM shows r32 in 32-bit code)
          return op === 0x8C ? ['mov', E(1), SREG[reg]] : ['mov', SREG[reg], mod === 3 ? (osz === 32 ? R32 : R16)[rm] : mem];
        default: return undefined;
      }
    }
    // 0F xx: 80286 system instructions (and the 80386 two-byte opcodes)
    function sys() {
      const b = u8();
      if (b === 0x00) {
        modrm();
        if (!SYS0[reg]) return bad();
        return [SYS0[reg], reg < 2 && mod === 3 ? RW()[rm] : E16()];
      }
      if (b === 0x01) {
        modrm();
        if (reg === 7 && c486) return mod === 3 ? bad() : ['invlpg', mem];
        if (!SYS1[reg]) return bad();
        if (reg < 4) return mod === 3 ? bad() : [SYS1[reg], mem];
        return [SYS1[reg], reg === 4 && mod === 3 ? RW()[rm] : E16()];
      }
      if (b === 0x02 || b === 0x03) { modrm(); return [b === 2 ? 'lar' : 'lsl', RW()[reg], E16()]; }
      if (b === 0x05 && !c386) return ['loadall'];
      if (b === 0x06) return ['clts'];
      return c386 ? sys386(b) : bad();
    }
    function sys386(b) {
      if (b >= 0x20 && b <= 0x26 && b !== 0x25) {
        // mov to / from control, debug and test registers (the mod field has no function)
        const m = u8();
        const n = (m >> 3) & 7;
        const kind = b === 0x20 || b === 0x22 ? 'cr' : b === 0x21 || b === 0x23 ? 'dr' : 'tr';
        // the 80386 has cr0, cr2, cr3, dr0-dr7, tr6, tr7; the 80486 also tr3-tr5; the Pentium
        // has cr4 and no test registers
        if ((kind === 'cr' && (n === 1 || n > (c586 ? 4 : 3))) || (kind === 'tr' && (c586 || n < (c486 ? 3 : 6)))) return bad();
        return b & 2 ? ['mov', kind + n, R32[m & 7]] : ['mov', R32[m & 7], kind + n];
      }
      if (b >= 0x80 && b <= 0x8F) return [(JCC[b & 15] + ' near ' + ssz()).trim(), relw()];
      if (b >= 0x90 && b <= 0x9F) { modrm(); return [SETCC[b & 15], E(0)]; }
      if (c686) {
        // Pentium Pro: cmovcc r, r/m (0F 40-4F), rdpmc, ud2
        if (b >= 0x40 && b <= 0x4F) { modrm(); return [CMOVCC[b & 15], RW()[reg], E(1)]; }
        if (b === 0x33) return ['rdpmc'];
        if (b === 0x0B) return ['ud2'];
      }
      if (c586) {
        // Pentium: wrmsr, rdtsc, rdmsr, rsm, cmpxchg8b m64 (0F C7 /1)
        if (b === 0x30) return ['wrmsr'];
        if (b === 0x31) return ['rdtsc'];
        if (b === 0x32) return ['rdmsr'];
        if (b === 0xAA) return ['rsm'];
        if (b === 0xC7) { modrm(); return reg === 1 && mod !== 3 ? ['cmpxchg8b', mem] : bad(); }
      }
      if (c486) {
        // 80486: bswap r32 (a 16-bit operand size has no defined function), xadd, cmpxchg
        if (b >= 0xC8 && b <= 0xCF) return o32() ? ['bswap', R32[b & 7]] : bad();
        if (b === 0x08) return ['invd'];
        if (b === 0x09) return ['wbinvd'];
        if (b === 0xA2) return ['cpuid'];
        if (b === 0xB0 || b === 0xB1 || b === 0xC0 || b === 0xC1) {
          modrm();
          return [b >= 0xC0 ? 'xadd' : 'cmpxchg', E(b & 1), (b & 1 ? RW() : R8)[reg]];
        }
      }
      switch (b) {
        case 0xA0: return ['push', 'fs'];
        case 0xA1: return ['pop', 'fs'];
        case 0xA8: return ['push', 'gs'];
        case 0xA9: return ['pop', 'gs'];
        case 0xA3: case 0xAB: case 0xB3: case 0xBB: modrm(); return [BT[(b >> 3) & 3], E(1), RW()[reg]];
        case 0xA4: case 0xAC: {
          modrm();
          const a = E(1);
          return [b === 0xA4 ? 'shld' : 'shrd', a, RW()[reg], hex(u8())];
        }
        case 0xA5: case 0xAD: modrm(); return [b === 0xA5 ? 'shld' : 'shrd', E(1), RW()[reg], 'cl'];
        case 0xAF: modrm(); return ['imul', RW()[reg], E(1)];
        case 0xB2: case 0xB4: case 0xB5:
          modrm();
          return mod === 3 ? bad() : [{ 0xB2: 'lss', 0xB4: 'lfs', 0xB5: 'lgs' }[b], RW()[reg], mem];
        case 0xB6: case 0xBE:
          modrm();
          return [b === 0xB6 ? 'movzx' : 'movsx', RW()[reg], mod === 3 ? R8[rm] : 'byte ' + mem];
        case 0xB7: case 0xBF:
          // r32, r/m16 only (NASM and Intel have no 16-bit destination form)
          modrm();
          if (!o32()) return bad();
          return [b === 0xB7 ? 'movzx' : 'movsx', R32[reg], mod === 3 ? R16[rm] : 'word ' + mem];
        case 0xBA: {
          modrm();
          if (reg < 4) return bad();
          const a = E(1, sz(1));
          return [BT[reg - 4], a, hex(u8())];
        }
        case 0xBC: case 0xBD: modrm(); return [b === 0xBC ? 'bsf' : 'bsr', RW()[reg], E(1)];
        default: return bad();
      }
    }

    function body() {
      if (c286) {
        const r = body286();
        if (r !== undefined) return r;
      }
      if (op < 0x40) {
        const k = op & 7;
        const w = op & 1;
        if (k < 6) {
          const name = ALU[op >> 3];
          if (k === 4) return [name, 'al', hex(u8())];
          if (k === 5) return [name, RW()[0], hex(immw())];
          modrm();
          const r = (w ? RW() : R8)[reg];
          return k < 2 ? [name, E(w), r] : [name, r, E(w)];
        }
        if (op < 0x20) return [k === 6 ? 'push' : 'pop', SREG[op >> 3]];
        return [SIMPLE[op]];
      }
      if (op < 0x60) return [['inc', 'dec', 'push', 'pop'][(op >> 3) & 3], RW()[op & 7]];
      if (op < 0x80) return [JCC[op & 15], rel8()];
      if (op === 0x90 && pOp) return ['xchg', RW()[0], RW()[0]];
      if (op === 0x98) return [o32() ? 'cwde' : 'cbw'];
      if (op === 0x99) return [o32() ? 'cdq' : 'cwd'];
      if (op === 0x9C) return [nameW('pushf')];
      if (op === 0x9D) return [nameW('popf')];
      if (op === 0xCF) return [nameW('iret')];
      if (op in SIMPLE) return [SIMPLE[op]];
      if (op in STRS) return [op & 1 ? STRS[op] + (o32() ? 'd' : 'w') : STRS[op]];
      const w = op & 1;
      switch (op) {
        case 0x80: case 0x81: case 0x82: case 0x83: {
          modrm();
          const a = E(w, sz(w));
          const imm = op === 0x81 ? immw() : op === 0x83 ? sx8() : u8();
          return [ALU[reg], a, hex(imm)];
        }
        case 0x84: case 0x85: modrm(); return ['test', E(w), (w ? RW() : R8)[reg]];
        case 0x86: case 0x87: {
          modrm();
          // "xchg ax, r16" with ax first, as for 90+r (NASM encodes both orders as 90+r)
          if (w && mod === 3 && reg === 0 && rm !== 0) return ['xchg', RW()[0], RW()[rm]];
          return ['xchg', E(w), (w ? RW() : R8)[reg]];
        }
        case 0x88: case 0x89: modrm(); return ['mov', E(w), (w ? RW() : R8)[reg]];
        case 0x8A: case 0x8B: modrm(); return ['mov', (w ? RW() : R8)[reg], E(w)];
        case 0x8C: modrm(); return ['mov', E(1), SREG[reg & 3]];
        case 0x8E: modrm(); return ['mov', SREG[reg & 3], E(1)];
        case 0x8D: modrm(); return mod === 3 ? bad() : ['lea', RW()[reg], mem];
        case 0xC4: modrm(); return mod === 3 ? bad() : ['les', RW()[reg], mem];
        case 0xC5: modrm(); return mod === 3 ? bad() : ['lds', RW()[reg], mem];
        case 0x8F: modrm(); return reg ? bad() : ['pop', E(1, sz(1))];
        case 0x9A: case 0xEA: {
          const s = ssz();
          const o = osz === 32 ? u32() : u16();
          return [op === 0x9A ? 'call' : 'jmp', s + hex(u16(), 4) + ':' + hex(o, osz === 32 ? 8 : 4)];
        }
        case 0xA0: case 0xA1: return ['mov', w ? RW()[0] : 'al', moffs()];
        case 0xA2: case 0xA3: { const m = moffs(); return ['mov', m, w ? RW()[0] : 'al']; }
        case 0xA8: return ['test', 'al', hex(u8())];
        case 0xA9: return ['test', RW()[0], hex(immw())];
        case 0xC0: case 0xC2: return ['ret', hex(u16())];
        case 0xC8: case 0xCA: return ['retf', hex(u16())];
        case 0xC6: case 0xC7: {
          modrm();
          if (reg) return bad();
          const a = E(w, sz(w));
          return ['mov', a, hex(w ? immw() : u8())];
        }
        case 0xCD: return ['int', hex(u8())];
        case 0xD0: case 0xD1: case 0xD2: case 0xD3:
          modrm();
          return SHIFT[reg] ? [SHIFT[reg], E(w, sz(w)), op & 2 ? 'cl' : '1'] : bad();
        case 0xD4: case 0xD5: {
          const b = u8();
          return b === 10 ? [op === 0xD4 ? 'aam' : 'aad'] : [op === 0xD4 ? 'aam' : 'aad', hex(b)];
        }
        case 0xE0: case 0xE1: case 0xE2: case 0xE3: {
          // the address size selects cx or ecx as the count
          const t = rel8();
          if (op === 0xE3) { aUsed = true; return [asz === 32 ? 'jecxz' : 'jcxz', t]; }
          if (asz !== bits) { aUsed = true; return [LOOPS[op & 3], t, asz === 32 ? 'ecx' : 'cx']; }
          return [LOOPS[op & 3], t];
        }
        case 0xE4: case 0xE5: return ['in', w ? RW()[0] : 'al', hex(u8())];
        case 0xE6: case 0xE7: { const p = hex(u8()); return ['out', p, w ? RW()[0] : 'al']; }
        case 0xEC: case 0xED: return ['in', w ? RW()[0] : 'al', 'dx'];
        case 0xEE: case 0xEF: return ['out', 'dx', w ? RW()[0] : 'al'];
        case 0xE8: return [('call ' + ssz()).trim(), relw()];
        case 0xE9: return [('jmp near ' + ssz()).trim(), relw()];
        case 0xEB: return ['jmp short', rel8()];
        case 0xF6: case 0xF7: {
          modrm();
          const a = E(w, sz(w));
          if (reg > 1) return [GRP3[reg], a];
          return ['test', a, hex(w ? immw() : u8())];
        }
        case 0xFE: modrm(); return reg < 2 ? [reg ? 'dec' : 'inc', E(0, 'byte')] : bad();
        case 0xFF:
          modrm();
          switch (reg) {
            case 0: return ['inc', E(1, sz(1))];
            case 1: return ['dec', E(1, sz(1))];
            case 2: return ['call', near()];
            case 3: return mod === 3 ? bad() : ['call ' + ssz() + 'far', mem];
            case 4: return ['jmp', near()];
            case 5: return mod === 3 ? bad() : ['jmp ' + ssz() + 'far', mem];
            case 6: return ['push', E(1, sz(1))];
            default: return bad();
          }
        default: break;
      }
      if ((op & 0xF8) === 0x90) return ['xchg', RW()[0], RW()[op & 7]];
      if ((op & 0xF0) === 0xB0) {
        return op & 8 ? ['mov', RW()[op & 7], hex(immw())] : ['mov', R8[op & 7], hex(u8())];
      }
      return esc();
    }

    // 8087 escape opcodes D8-DF
    function esc() {
      const x = op & 7;
      modrm();
      if (mod !== 3) {
        const e = FMEM[x][reg];
        return e ? [e[0], (e[1] ? e[1] + ' ' : '') + mem] : bad();
      }
      const st = 'st' + rm;
      const b2 = 0xC0 | (reg << 3) | rm;
      switch (x) {
        case 0: return reg === 2 || reg === 3 ? [FARITH[reg], st] : [FARITH[reg], 'st0', st];
        case 1:
          if (reg === 0) return ['fld', st];
          if (reg === 1) return ['fxch', st];
          if (reg === 3) return ['fstp', st];
          if (c386 && FD9_387[b2]) return [FD9_387[b2]];
          return FD9[b2] ? [FD9[b2]] : bad();
        case 2:
          if (c686 && reg < 4) return [FCMOV[reg], 'st0', st];
          return c386 && b2 === 0xE9 ? ['fucompp'] : bad();
        case 3:
          if (c686 && reg < 4) return [FCMOV[4 + reg], 'st0', st];
          if (c686 && (reg === 5 || reg === 6)) return [reg === 5 ? 'fucomi' : 'fcomi', st];
          if (c286 && b2 === 0xE4) return ['fnsetpm'];
          return FDB[b2] ? [FDB[b2]] : bad();
        case 4: return reg === 2 || reg === 3 ? [FREV[reg], st] : [FREV[reg], st, 'st0'];
        case 5:
          if (c386 && (reg === 4 || reg === 5)) return [reg === 4 ? 'fucom' : 'fucomp', st];
          return reg < 4 ? [['ffree', 'fxch', 'fst', 'fstp'][reg], st] : bad();
        case 6:
          if (reg === 2) return ['fcomp', st];
          if (reg === 3) return b2 === 0xD9 ? ['fcompp'] : bad();
          return [FREV[reg] + 'p', st, 'st0'];
        case 7:
          if (c286 && b2 === 0xE0) return ['fnstsw', 'ax'];
          if (c686 && (reg === 5 || reg === 6)) return [reg === 5 ? 'fucomip' : 'fcomip', st];
          return reg < 4 ? [['ffreep', 'fxch', 'fstp', 'fstp'][reg], st] : bad();
        default: return bad();
      }
    }

    const r = body();
    if (!r) {
      const bytes = [];
      for (let k = 0; k < i; k++) bytes.push(hex(read(k), 2));
      return { len: i, text: 'db ' + bytes.join(', '), mnem: 'db' };
    }
    const pre = [];
    if (rep) pre.push(rep === 0xF2 ? 'repne' : op === 0xA6 || op === 0xA7 || op === 0xAE || op === 0xAF ? 'repe' : 'rep');
    if (lock) pre.push('lock');
    if (seg && !segUsed) pre.push(seg);
    if (pOp && !oUsed) pre.push('o' + osz);
    if (pAd && !aUsed) pre.push('a' + asz);
    const mnem = r[0].split(' ')[0];
    const ops = r.slice(1).join(', ');
    return { len: i, text: pre.concat(r[0]).join(' ') + (ops ? ' ' + ops : ''), mnem };
  }

  return { decode };
})();
