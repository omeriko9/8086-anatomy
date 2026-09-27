// MOO test file parser (SingleStepTests binary format v1.1, https://github.com/dbalsom/moo).
import zlib from 'node:zlib';
import fs from 'node:fs';

const REG_ORDER = ['ax', 'bx', 'cx', 'dx', 'cs', 'ss', 'ds', 'es', 'sp', 'bp', 'si', 'di', 'ip', 'flags'];
// RG32 / RM32 (MOO 1.1, 80386 tests): 32-bit registers.
const REG32_ORDER = ['cr0', 'cr3', 'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp', 'cs', 'ds', 'es', 'fs', 'gs', 'ss',
  'eip', 'eflags', 'dr6', 'dr7'];

function regs(b, o) {
  const mask = b.readUInt16LE(o); o += 2;
  const r = {};
  REG_ORDER.forEach((n, i) => { if (mask & (1 << i)) { r[n] = b.readUInt16LE(o); o += 2; } });
  return r;
}
function regs32(b, o) {
  const mask = b.readUInt32LE(o); o += 4;
  const r = {};
  REG32_ORDER.forEach((n, i) => { if (mask & (1 << i)) { r[n] = b.readUInt32LE(o); o += 4; } });
  return r;
}
function state(b, o, end) {
  const s = { regs: {}, ram: [], queue: [] };
  while (o < end) {
    const tag = b.toString('latin1', o, o + 4), len = b.readUInt32LE(o + 4), p = o + 8;
    if (tag === 'REGS') s.regs = regs(b, p);
    else if (tag === 'RMSK') s.mask = regs(b, p);
    else if (tag === 'RG32') s.regs32 = regs32(b, p);
    else if (tag === 'RM32') s.mask32 = regs32(b, p);
    else if (tag === 'EA32') {
      s.ea = { seg: b[p], sel: b.readUInt16LE(p + 1), base: b.readUInt32LE(p + 3), limit: b.readUInt32LE(p + 7),
        offset: b.readUInt32LE(p + 11), lin: b.readUInt32LE(p + 15), phys: b.readUInt32LE(p + 19) };
    } else if (tag === 'RAM ') {
      const n = b.readUInt32LE(p);
      for (let i = 0; i < n; i++) s.ram.push([b.readUInt32LE(p + 4 + i * 5), b[p + 8 + i * 5]]);
    } else if (tag === 'QUEU') {
      const n = b.readUInt32LE(p);
      s.queue = Array.from(b.subarray(p + 4, p + 4 + n));
    }
    o = p + len;
  }
  return s;
}

// Returns { cpu, meta, mask, mask32, tests: [{ idx, name, bytes, initial, final, exception, hash, ncycles }] }
// initial / final: { regs, regs32 (80386), mask, mask32, ea (80386 EA32), ram, queue }
export function parseMoo(buf, { cycles = false } = {}) {
  const b = buf[0] === 0x1F && buf[1] === 0x8B ? zlib.gunzipSync(buf) : buf;
  if (b.toString('latin1', 0, 4) !== 'MOO ') throw new Error('not a MOO file');
  let o = 8 + b.readUInt32LE(4);
  const out = { cpu: b.toString('latin1', 16, 20).trim(), tests: [], mask: null, meta: null };
  while (o < b.length) {
    const tag = b.toString('latin1', o, o + 4), len = b.readUInt32LE(o + 4), p = o + 8;
    if (tag === 'TEST') {
      const t = { idx: b.readUInt32LE(p) };
      let q = p + 4;
      while (q < p + len) {
        const st = b.toString('latin1', q, q + 4), sl = b.readUInt32LE(q + 4), d = q + 8;
        if (st === 'NAME') t.name = b.toString('latin1', d + 4, d + 4 + b.readUInt32LE(d));
        else if (st === 'BYTS') t.bytes = Array.from(b.subarray(d + 4, d + 4 + b.readUInt32LE(d)));
        else if (st === 'INIT') t.initial = state(b, d, d + sl);
        else if (st === 'FINA') t.final = state(b, d, d + sl);
        else if (st === 'EXCP') t.exception = { number: b[d], flag_address: b.readUInt32LE(d + 1) };
        else if (st === 'HASH') t.hash = b.toString('hex', d, d + sl);
        else if (st === 'CYCL') {
          t.ncycles = b.readUInt32LE(d);
          if (cycles) {
            t.cycles = [];
            for (let i = 0; i < t.ncycles; i++) {
              const c = d + 4 + i * 15;
              t.cycles.push({ pins: b[c], addr: b.readUInt32LE(c + 1), mem: b[c + 6], io: b[c + 7],
                data: b.readUInt16LE(c + 9), status: b[c + 11] & 15, t: b[c + 12] });
            }
          }
        }
        q = d + sl;
      }
      out.tests.push(t);
    } else if (tag === 'META') {
      out.meta = { opcode: b.readUInt32LE(p + 3), mnemonic: b.toString('latin1', p + 7, p + 15).trim(), mode: b[p + 27] };
    } else if (tag === 'RMSK') out.mask = regs(b, p);
    else if (tag === 'RM32') out.mask32 = regs32(b, p);
    o = p + len;
  }
  return out;
}

export function loadMoo(file, opts) { return parseMoo(fs.readFileSync(file), opts); }
