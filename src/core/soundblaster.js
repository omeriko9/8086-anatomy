// Sound Blaster 2.0 (Creative, DSP version 2.01) with its Yamaha YM3812 (OPL2) FM chip.
//
// Ports (base 220h): 226h DSP reset, 22Ah DSP read data, 22Ch DSP write command / data
// (read: bit 7 = busy), 22Eh DSP read-buffer status (bit 7 = data available; a read
// acknowledges the 8-bit DMA interrupt), 228h-229h OPL2 (the copy on the card).
// The OPL2 is also at 388h-389h (the AdLib ports). IRQ 7, 8-bit DMA channel 1.
//
// The machine calls tick(clocks) after each instruction. The DSP pulls one byte through
// DMA channel 1 for each sample (real time from the CPU clock) and raises IRQ 7 at the
// end of each block. takeSound() gives the mixed card audio (the DSP and the OPL2) for
// the time since the last call. The OPL2 makes its samples only when somebody takes
// them: with m.audioOn = true each register write first brings the chip up to the time
// of the write; with m.audioOn = false takeSound() makes all samples of the time since
// the last call with the registers of now.

const OPL_RATE = 49716;                  // the OPL2 sample rate: 14.31818 MHz / 288
const SB_LOG = 1 << 15;                  // DAC changes that the card keeps for takeSound()
const SB_MAX_SPAN = 4;                   // seconds: takeSound() gives at most this much sound
const SB_DSP_GAIN = 0.5;                 // full scale 8-bit DAC -> 0.5
const SB_OPL_GAIN = 2 / 32768;           // one OPL2 channel at full level -> about 0.25

// ---------- OPL2 tables (the ROMs of the chip, as published) ----------
// Log-sin ROM: a quarter of a sine wave as -log2(sin) in 1/256 units.
const OPL_LOGSIN = new Uint16Array(256);
// Exponent ROM: 2^(-x/256) as 10 bits and the hidden bit (1024 + table).
const OPL_EXP = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  OPL_LOGSIN[i] = Math.round(-Math.log2(Math.sin((i + 0.5) * Math.PI / 512)) * 256);
  OPL_EXP[i] = Math.round((Math.pow(2, (255 - i) / 256) - 1) * 1024) | 0x400;
}
// The 4 waveforms of the OPL2 as log values and sign masks for each 10-bit phase:
// 0 sine, 1 half sine, 2 absolute sine, 3 quarter sine pulses. 1000h = silence.
const OPL_WLOG = new Uint16Array(4096), OPL_WNEG = new Int32Array(4096);
for (let p = 0; p < 1024; p++) {
  const q = p & 0x100 ? OPL_LOGSIN[(p & 0xFF) ^ 0xFF] : OPL_LOGSIN[p & 0xFF];
  const neg = p & 0x200;
  OPL_WLOG[p] = q; OPL_WNEG[p] = neg ? -1 : 0;
  OPL_WLOG[1024 + p] = neg ? 0x1000 : q;
  OPL_WLOG[2048 + p] = q;
  OPL_WLOG[3072 + p] = p & 0x100 ? 0x1000 : OPL_LOGSIN[p & 0xFF];
}
// Frequency multiplier x2 (0 = 1/2)
const OPL_MT = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
// Key scale level ROM (by F-number bits 6-9) and the shift for the KSL register value
// (the chip has the order 0, 3, 1.5, 6 dB per octave)
const OPL_KSL = [0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64];
const OPL_KSL_SHIFT = [8, 1, 2, 0];
// Envelope increment steps of the rates 48-63 (by rate bits 0-1 and the timer bits 0-1)
const OPL_EG_STEP = [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0];
// Operator (slot) number of the register offsets 00h-15h (-1: no operator)
const OPL_SLOT_OF = [0, 1, 2, 3, 4, 5, -1, -1, 6, 7, 8, 9, 10, 11, -1, -1, 12, 13, 14, 15, 16, 17, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
const OPL_STAGES = ['attack', 'decay', 'sustain', 'release'];
const OPL_DRUMS = [[0x10, 'bass drum', [12, 15]], [0x08, 'snare drum', [16]], [0x04, 'tom-tom', [14]], [0x02, 'cymbal', [17]], [0x01, 'hi-hat', [13]]];

// One operator. The views read env, stage and wave.
class OplSlot {
  constructor(chip, num) {
    this.chip = chip; this.num = num;
    this.ch = null;                              // the channel (set by OPL2)
    this.reset();
  }
  reset() {
    this.am = 0; this.vib = 0; this.egt = 0; this.ksr = 0; this.mult = 0; this.kslv = 0; this.tl = 0;
    this.ar = 0; this.dr = 0; this.sl = 0; this.rr = 0; this.wf = 0;
    this.key = 0;                                // bit 0 key-on, bit 1 drum, bit 2 CSM
    this.eg = 0x1FF; this.egOut = 0x1FF; this.gen = 3; this.egKsl = 0; this.pgReset = 0;
    this.phase = 0; this.phaseOut = 0; this.out = 0; this.prout = 0; this.fbmod = 0;
  }
  // The envelope level: 1 = full level, 0 = silence (linear in dB, 0.1875 dB steps)
  get env() { return 1 - this.eg / 511; }
  get stage() {
    if (this.key && this.gen === 3) return 'attack';      // the key-on comes at the next sample
    if (!this.key && this.gen !== 3) return 'release';
    if (this.gen !== 0 && (this.eg & 0x1F8) === 0x1F8) return 'off';
    return OPL_STAGES[this.gen];
  }
  get wave() { return this.chip.wse ? this.wf : 0; }
}

// One of the 9 channels. The views read on, freq, block, fnum and op.
class OplChannel {
  constructor(chip, n, a, b) {
    this.chip = chip; this.n = n;
    this.op = [a, b];
    this.reset();
  }
  reset() { this.fnum = 0; this.block = 0; this.fb = 0; this.con = 0; this.ksv = 0; }
  get on() { return !!(this.op[0].key | this.op[1].key); }
  get freq() { return this.fnum * OPL_RATE / Math.pow(2, 20 - this.block); }
}

// Yamaha YM3812 (OPL2): 9 channels of 2 operators, the rhythm mode, 2 timers.
// The synthesis follows the published behaviour of the chip (log-sin and exponent ROMs,
// the envelope generator with its rate counter, the LFOs for tremolo and vibrato, the
// noise generator of the rhythm mode). render() makes samples at 49716 Hz.
class OPL2 {
  constructor() {
    this.regs = new Uint8Array(256);
    this.slots = [];
    for (let i = 0; i < 18; i++) this.slots.push(new OplSlot(this, i));
    this.channels = [];
    for (let c = 0; c < 9; c++) {
      const s0 = (c % 3) + 6 * Math.floor(c / 3);
      const ch = new OplChannel(this, c, this.slots[s0], this.slots[s0 + 3]);
      this.slots[s0].ch = ch; this.slots[s0 + 3].ch = ch;
      this.channels.push(ch);
    }
    this.timers = {
      t1: { preset: 0, run: false, flag: false, mask: false, left: 0 },
      t2: { preset: 0, run: false, flag: false, mask: false, left: 0 },
      get irq() { return this.t1.flag || this.t2.flag; },
    };
    this.rhythm = { on: false, bd: false, sd: false, tom: false, cym: false, hh: false };
    this.reset();
  }
  reset() {
    this.regs.fill(0);
    for (const s of this.slots) s.reset();
    for (const c of this.channels) c.reset();
    this.wse = 0; this.csm = 0; this.nts = 0; this.rhy = 0; this.csmOff = false;
    this.timer = 0; this.egTimer = 0; this.egState = 0; this.egAdd = 0; this.egTimerLo = 0;
    this.tremPos = 0; this.trem = 0; this.tremShift = 4; this.vibPos = 0; this.vibShift = 1;
    this.noise = 1;
    this.hh2 = 0; this.hh3 = 0; this.hh7 = 0; this.hh8 = 0; this.tc3 = 0; this.tc5 = 0;
    for (const t of [this.timers.t1, this.timers.t2]) { t.preset = 0; t.run = false; t.flag = false; t.mask = false; t.left = 0; }
    this.tRun = false;
    Object.assign(this.rhythm, { on: false, bd: false, sd: false, tom: false, cym: false, hh: false });
  }

  // The status register (388h): bit 7 IRQ, bit 6 timer 1, bit 5 timer 2; bits 1-2 read 1 on the OPL2.
  status() {
    const t = this.timers;
    return 0x06 | (t.t1.flag ? 0x40 : 0) | (t.t2.flag ? 0x20 : 0) | (t.t1.flag || t.t2.flag ? 0x80 : 0);
  }
  // Advance the timers by sec seconds. Timer 1 counts in 80 us steps, timer 2 in 320 us steps.
  tickTimers(sec) {
    const T = this.timers;
    for (let i = 0; i < 2; i++) {
      const t = i ? T.t2 : T.t1;
      if (!t.run) continue;
      t.left -= sec;
      if (t.left > 0) continue;
      const per = (256 - t.preset) * (i ? 320e-6 : 80e-6);
      t.left += per * (Math.floor(-t.left / per) + 1);
      if (!t.mask) t.flag = true;
      if (!i && this.csm) {                      // CSM: timer 1 keys all channels on and off
        for (const s of this.slots) s.key |= 4;
        this.csmOff = true;
      }
    }
  }
  updKsl(s) {
    const ch = s.ch;
    const k = (OPL_KSL[ch.fnum >> 6] << 2) - ((8 - ch.block) << 5);
    s.egKsl = k < 0 ? 0 : k;
  }
  updCh(ch) {
    ch.ksv = (ch.block << 1) | ((ch.fnum >> (9 - this.nts)) & 1);
    this.updKsl(ch.op[0]); this.updKsl(ch.op[1]);
  }
  // Write a register. Returns 1 for a key-on, 2 for a key-off, 0 for other writes
  // (this.lastCh = the channel, -1 when the register is not of one channel).
  write(r, v) {
    r &= 0xFF; v &= 0xFF;
    this.regs[r] = v;
    this.lastCh = -1;
    const g = r & 0xE0;
    if (g === 0x20 || g === 0x40 || g === 0x60 || g === 0x80 || g === 0xE0) {
      if (g === 0xE0 && r > 0xF5) return 0;
      const n = OPL_SLOT_OF[r & 0x1F];
      if (n < 0) return 0;
      const s = this.slots[n];
      this.lastCh = s.ch.n;
      switch (g) {
        case 0x20: s.am = v >> 7; s.vib = (v >> 6) & 1; s.egt = (v >> 5) & 1; s.ksr = (v >> 4) & 1; s.mult = v & 15; break;
        case 0x40: s.kslv = v >> 6; s.tl = v & 63; this.updKsl(s); break;
        case 0x60: s.ar = v >> 4; s.dr = v & 15; break;
        case 0x80: s.sl = v >> 4 === 15 ? 31 : v >> 4; s.rr = v & 15; break;
        case 0xE0: s.wf = v & 3; break;
      }
      return 0;
    }
    if (r >= 0xA0 && r <= 0xA8) {
      const ch = this.channels[r - 0xA0];
      ch.fnum = (ch.fnum & 0x300) | v; this.updCh(ch);
      this.lastCh = ch.n;
      return 0;
    }
    if (r >= 0xB0 && r <= 0xB8) {
      const ch = this.channels[r - 0xB0], a = ch.op[0], b = ch.op[1];
      ch.fnum = (ch.fnum & 0xFF) | ((v & 3) << 8); ch.block = (v >> 2) & 7; this.updCh(ch);
      this.lastCh = ch.n;
      const was = a.key & 1;
      if (v & 0x20) { a.key |= 1; b.key |= 1; } else { a.key &= ~1; b.key &= ~1; }
      return (v & 0x20) && !was ? 1 : !(v & 0x20) && was ? 2 : 0;
    }
    if (r >= 0xC0 && r <= 0xC8) {
      const ch = this.channels[r - 0xC0];
      ch.fb = (v >> 1) & 7; ch.con = v & 1;
      this.lastCh = ch.n;
      return 0;
    }
    switch (r) {
      case 0x01: this.wse = v & 0x20; break;
      case 0x02: this.timers.t1.preset = v; break;
      case 0x03: this.timers.t2.preset = v; break;
      case 0x04: {
        const T = this.timers;
        if (v & 0x80) { T.t1.flag = false; T.t2.flag = false; break; }   // IRQ reset: the flags go to 0
        T.t1.mask = !!(v & 0x40); if (T.t1.mask) T.t1.flag = false;
        T.t2.mask = !!(v & 0x20); if (T.t2.mask) T.t2.flag = false;
        if ((v & 1) && !T.t1.run) T.t1.left = (256 - T.t1.preset) * 80e-6;
        if ((v & 2) && !T.t2.run) T.t2.left = (256 - T.t2.preset) * 320e-6;
        T.t1.run = !!(v & 1); T.t2.run = !!(v & 2);
        this.tRun = T.t1.run || T.t2.run;
        break;
      }
      case 0x08:
        this.csm = v >> 7; this.nts = (v >> 6) & 1;
        for (const ch of this.channels) this.updCh(ch);
        break;
      case 0xBD: {
        this.tremShift = v & 0x80 ? 2 : 4;
        this.vibShift = v & 0x40 ? 0 : 1;
        const old = this.rhy, on = v & 0x20;
        this.rhy = v & 0x3F;
        let res = 0;
        for (const [bit, , sl] of OPL_DRUMS) {
          const k = on && (v & bit);
          for (const n of sl) { if (k) this.slots[n].key |= 2; else this.slots[n].key &= ~2; }
          const was = (old & 0x20) && (old & bit);
          if (k && !was) res = 1; else if (!k && was && !res) res = 2;
        }
        const R = this.rhythm;
        R.on = !!on; R.bd = !!(on && v & 0x10); R.sd = !!(on && v & 8); R.tom = !!(on && v & 4); R.cym = !!(on && v & 2); R.hh = !!(on && v & 1);
        return res;
      }
    }
    return 0;
  }

  // Make n samples (signed, about 16-bit range) into out[off .. off + n - 1].
  render(out, off, n) {
    const S = this.slots, C = this.channels;
    const WLOG = OPL_WLOG, WNEG = OPL_WNEG, EXP = OPL_EXP;
    for (let i = 0; i < n; i++) {
      if (this.csmOff) { for (const s of S) s.key &= ~4; this.csmOff = false; }
      const rhy = this.rhy & 0x20, egState = this.egState, egAdd = this.egAdd, egLo = this.egTimerLo;
      const trem = this.trem, vibPos = this.vibPos, vibShift = this.vibShift, wse = this.wse;
      for (let si = 0; si < 18; si++) {
        const s = S[si];
        const drum78 = rhy && (si === 13 || si === 14 || si === 16 || si === 17);
        // an operator that is silent and not keyed does no work (the hi-hat and the
        // cymbal still turn their phase in the rhythm mode: the other drums use it)
        if (s.key === 0 && s.gen === 3 && s.eg === 0x1FF && !(rhy && (si === 13 || si === 17))) {
          s.prout = 0; s.out = 0; s.fbmod = 0;
          continue;
        }
        const ch = s.ch;
        // feedback
        s.fbmod = ch.fb ? (s.prout + s.out) >> (9 - ch.fb) : 0;
        s.prout = s.out;
        // envelope generator
        let egOut = s.eg + (s.tl << 2) + (s.egKsl >> OPL_KSL_SHIFT[s.kslv]) + (s.am ? trem : 0);
        if (egOut > 0x1FF) egOut = 0x1FF;
        s.egOut = egOut;
        const gen = s.gen;
        let reset = 0, regRate = 0;
        if (s.key && gen === 3) { reset = 1; regRate = s.ar; }
        else if (gen === 0) regRate = s.ar;
        else if (gen === 1) regRate = s.dr;
        else if (gen === 2) { if (!s.egt) regRate = s.rr; }
        else regRate = s.rr;
        s.pgReset = reset;
        const rate = (ch.ksv >> ((s.ksr ^ 1) << 1)) + (regRate << 2);
        let rateHi = rate >> 2;
        const rateLo = rate & 3;
        if (rateHi & 0x10) rateHi = 0x0F;
        let shift = 0;
        if (regRate !== 0) {
          if (rateHi < 12) {
            if (egState) {
              const es = rateHi + egAdd;
              if (es === 12) shift = 1;
              else if (es === 13) shift = (rateLo >> 1) & 1;
              else if (es === 14) shift = rateLo & 1;
            }
          } else {
            shift = (rateHi & 3) + OPL_EG_STEP[rateLo * 4 + egLo];
            if (shift & 4) shift = 3;
            if (!shift) shift = egState;
          }
        }
        const old = s.eg;
        let eg = old, inc = 0;
        if (reset && rateHi === 0x0F) eg = 0;
        const off = (old & 0x1F8) === 0x1F8;
        if (gen !== 0 && !reset && off) eg = 0x1FF;
        if (gen === 0) {
          if (old === 0) s.gen = 1;
          else if (s.key && shift > 0 && rateHi !== 0x0F) inc = ~old >> (4 - shift);
        } else if (gen === 1) {
          if ((old >> 4) === s.sl) s.gen = 2;
          else if (!off && !reset && shift > 0) inc = 1 << (shift - 1);
        } else if (!off && !reset && shift > 0) inc = 1 << (shift - 1);
        s.eg = (eg + inc) & 0x1FF;
        if (reset) s.gen = 0;
        if (!s.key) s.gen = 3;
        // phase generator (with vibrato)
        let fnum = ch.fnum;
        if (s.vib) {
          let range = (fnum >> 7) & 7;
          if (!(vibPos & 3)) range = 0; else if (vibPos & 1) range >>= 1;
          range >>= vibShift;
          if (vibPos & 4) range = -range;
          fnum += range;
        }
        const phase = (s.phase >> 9) & 0x3FF;
        if (s.pgReset) s.phase = 0;
        s.phase = (s.phase + ((((fnum << ch.block) >> 1) * OPL_MT[s.mult]) >> 1)) & 0x7FFFF;
        let pOut = phase;
        if (si === 13) { this.hh2 = (phase >> 2) & 1; this.hh3 = (phase >> 3) & 1; this.hh7 = (phase >> 7) & 1; this.hh8 = (phase >> 8) & 1; }
        if (rhy) {
          if (si === 17) { this.tc3 = (phase >> 3) & 1; this.tc5 = (phase >> 5) & 1; }
          if (si === 13 || si === 16 || si === 17) {
            const x = (this.hh2 ^ this.hh7) | (this.hh3 ^ this.tc5) | (this.tc3 ^ this.tc5);
            const nz = this.noise & 1;
            if (si === 13) pOut = (x << 9) | ((x ^ nz) ? 0xD0 : 0x34);
            else if (si === 16) pOut = (this.hh8 << 9) | ((this.hh8 ^ nz) << 8);
            else pOut = (x << 9) | 0x80;
          }
        }
        s.phaseOut = pOut;
        // the operator output: the modulation, the waveform, the exponent
        let mod;
        if (drum78) mod = 0;
        else if (s === ch.op[0]) mod = s.fbmod;
        else mod = ch.con ? 0 : ch.op[0].out;
        const w = (wse ? s.wf << 10 : 0) + ((pOut + mod) & 0x3FF);
        let lv = WLOG[w] + (egOut << 3);
        if (lv > 0x1FFF) lv = 0x1FFF;
        s.out = ((EXP[lv & 0xFF] << 1) >> (lv >> 8)) ^ WNEG[w];
      }
      // the noise generator (23 bits)
      const nz = this.noise;
      this.noise = (nz >> 1) | ((((nz >> 14) ^ nz) & 1) << 22);
      // mix: a drum counts two times, like on the chip
      let mix = 0;
      const top = rhy ? 6 : 9;
      for (let c = 0; c < top; c++) {
        const ch = C[c];
        mix += ch.con ? ch.op[0].out + ch.op[1].out : ch.op[1].out;
      }
      if (rhy) mix += 2 * (S[15].out + S[13].out + S[16].out + S[14].out + S[17].out);
      out[off + i] = mix > 32767 ? 32767 : mix < -32768 ? -32768 : mix;
      // the LFOs and the envelope rate counter
      const t = this.timer;
      if ((t & 0x3F) === 0x3F) this.tremPos = (this.tremPos + 1) % 210;
      this.trem = (this.tremPos < 105 ? this.tremPos : 210 - this.tremPos) >> this.tremShift;
      if ((t & 0x3FF) === 0x3FF) this.vibPos = (this.vibPos + 1) & 7;
      this.timer = (t + 1) & 0xFFFF;
      if (egState) {
        const x = this.egTimer & 0x1FFF;
        this.egAdd = x ? 32 - Math.clz32(x & -x) : 0;
        this.egTimerLo = this.egTimer & 3;
        this.egTimer = (this.egTimer + 1) >>> 0;
      }
      this.egState = egState ^ 1;
    }
  }
}

// Creative ADPCM, 4 bits (DSP commands 74h, 75h, 7Dh): the step table and the scale changes.
const SB_ADPCM4_STEP = [
  0, 1, 2, 3, 4, 5, 6, 7, 0, -1, -2, -3, -4, -5, -6, -7,
  1, 3, 5, 7, 9, 11, 13, 15, -1, -3, -5, -7, -9, -11, -13, -15,
  2, 6, 10, 14, 18, 22, 26, 30, -2, -6, -10, -14, -18, -22, -26, -30,
  4, 12, 20, 28, 36, 44, 52, 60, -4, -12, -20, -28, -36, -44, -52, -60];
const SB_ADPCM4_ADJ = [
  0, 0, 0, 0, 0, 16, 16, 16, 0, 0, 0, 0, 0, 16, 16, 16,
  -16, 0, 0, 0, 0, 16, 16, 16, -16, 0, 0, 0, 0, 16, 16, 16,
  -16, 0, 0, 0, 0, 16, 16, 16, -16, 0, 0, 0, 0, 16, 16, 16,
  -16, 0, 0, 0, 0, 0, 0, 0, -16, 0, 0, 0, 0, 0, 0, 0];
// Parameter bytes of the DSP commands
const SB_PARAMS = { 0x10: 1, 0x14: 2, 0x16: 2, 0x17: 2, 0x24: 2, 0x40: 1, 0x48: 2, 0x74: 2, 0x75: 2, 0x76: 2, 0x77: 2, 0x80: 2, 0xE0: 1, 0xE4: 1 };
const SB_NAMES = {
  0x10: 'direct DAC', 0x14: '8-bit DMA output', 0x16: '2-bit ADPCM DMA output', 0x17: '2-bit ADPCM DMA output + reference',
  0x1C: 'auto-init 8-bit DMA output', 0x1F: 'auto-init 2-bit ADPCM output', 0x20: 'direct ADC', 0x24: '8-bit DMA input',
  0x2C: 'auto-init 8-bit DMA input', 0x40: 'time constant', 0x48: 'block size', 0x74: '4-bit ADPCM DMA output',
  0x75: '4-bit ADPCM DMA output + reference', 0x76: '2.6-bit ADPCM DMA output', 0x77: '2.6-bit ADPCM DMA output + reference',
  0x7D: 'auto-init 4-bit ADPCM output', 0x7F: 'auto-init 2.6-bit ADPCM output', 0x80: 'silence', 0x90: 'high-speed auto-init DMA output',
  0x91: 'high-speed DMA output', 0x98: 'high-speed auto-init DMA input', 0x99: 'high-speed DMA input', 0xD0: 'pause DMA',
  0xD1: 'speaker on', 0xD3: 'speaker off', 0xD4: 'continue DMA', 0xD8: 'speaker status', 0xDA: 'exit auto-init DMA',
  0xE0: 'DSP identification', 0xE1: 'DSP version', 0xE4: 'write test register', 0xE8: 'read test register', 0xF2: 'force IRQ',
};

// The Sound Blaster card: the DSP, the OPL2 and the mixed output. m: the machine.
// The views read the DSP state from this object (m.sb) and the FM state from m.opl.
class SoundBlaster {
  constructor(m) {
    this.m = m;
    // the fields of the sound output (see origin); all the fields start here (see CPU8086)
    this.T0 = 0; this.outN = 0; this.natN = 0; this.natBase = 0; this.natLen = 0; this.dcX = 0; this.dcY = 0;
    this.opl = new OPL2();
    this.clk = 0;                          // clocks since power-on (the time line of the card)
    this.irqLine = 7; this.dmaCh = 1;
    this.logT = new Float64Array(SB_LOG); this.logV = new Float32Array(SB_LOG);
    this.nat = new Float32Array(OPL_RATE); // OPL2 samples that takeSound() did not use yet
    this.evArr = null; this.evN = 0; this.oplEvN = 0;
    this.powerOn();
  }

  powerOn() {
    this.opl.reset();
    this.oplAddr = 0; this.oplT = this.clk;
    this.resetHigh = false; this.resetAt = 0; this.resetWait = false;
    this.tc = 211; this.rate = 1e6 / (256 - this.tc);
    this.blockSize = 0x800;
    this.test = 0;
    this.dspReset();
    this.dspState = 'ready';
    this.outq = [];
    // the sound output
    this.logW = 0; this.logR = 0; this.dacV = 0;
    this.outRate = 0;
    this.lvl = 0; this.lvlT = this.clk;
    this.samples = 0; this.irqs = 0;
    this.upd();
  }
  // The state after a DSP reset: no transfer, speaker off, no interrupt.
  dspReset() {
    this.cmd = -1; this.params = []; this.need = 0;
    this.outq = []; this.lastRead = 0xAA;
    this.dmaActive = false; this.paused = false; this.autoInit = false; this.hs = false;
    this.kind = 'out'; this.blockLen = 0; this.blockLeft = 0;
    this.adpcm = 0; this.refPending = false; this.adRef = 128; this.adScale = 0; this.spb = 1;
    this.speaker = false;
    this.lastSample = 128;
    this.setDac(128);
    if (this.irq) this.m.pic.lower(this.irqLine);
    this.irq = false;
  }
  // Recent loudness 0..1 (it falls to half in 50 ms)
  get level() { return this.lvl * Math.pow(2, -(this.clk - this.lvlT) / (0.05 * this.m.clockHz)); }
  // true when tick() has work: a reset in progress, a DMA transfer, a running OPL2 timer
  upd() { this.active = this.resetWait || (this.dmaActive && !this.paused) || this.opl.tRun; }

  // ---------- trace ----------
  canTrace(max) {
    const m = this.m;
    if (!m.devTrace) return false;
    if (this.evArr !== m.devTrace) { this.evArr = m.devTrace; this.evN = 0; this.oplEvN = 0; }
    return max ? this.oplEvN++ < max : this.evN++ < 8;
  }
  ev(op, text, t) {
    if (!this.canTrace()) return;
    this.m.traceDev({ k: 'sb', t, op, cmd: this.cmd, text, rate: Math.round(this.rate), left: this.blockLeft }, 'sb');
  }

  // ---------- DSP ports (220h-22Fh without 228h-229h) ----------
  read(p) {
    switch (p & 0xF) {
      case 0xA: {                                    // read data
        if (this.outq.length) this.lastRead = this.outq.shift();
        return this.lastRead;
      }
      case 0xC: return this.dspState === 'reset' || this.resetWait ? 0xFF : 0x7F;   // write status: bit 7 = busy
      case 0xE:                                      // read-buffer status; acknowledges the 8-bit IRQ
        if (this.irq) { this.irq = false; this.m.pic.lower(this.irqLine); }
        return this.outq.length ? 0xFF : 0x7F;
    }
    return 0xFF;
  }
  write(p, v) {
    const r = p & 0xF;
    if (r === 0x6) {                                 // reset: 1, then 0; the DSP answers AAh
      if (v & 1) {
        if (this.dspState !== 'reset') { this.dspReset(); this.dspState = 'reset'; this.resetWait = false; this.ev('reset', 'DSP reset (the reset line is high)'); }
        this.resetHigh = true;
      } else if (this.resetHigh) {
        this.resetHigh = false;
        this.resetWait = true;
        this.resetAt = this.clk + 20e-6 * this.m.clockHz;   // the DSP is ready after about 20 us
      }
      this.upd();
      return;
    }
    if (r !== 0xC || this.dspState === 'reset' || this.dspState === 'highspeed') return;
    if (this.dspState === 'params') {
      this.params.push(v);
      if (--this.need <= 0) { this.dspState = 'ready'; this.exec(this.cmd, this.params); }
      return;
    }
    this.cmd = v;
    this.params = [];
    this.need = SB_PARAMS[v] || 0;
    if (this.need) this.dspState = 'params';
    else this.exec(v, this.params);
  }
  // Do a DSP command with its parameter bytes.
  exec(c, a) {
    const len = () => (a[0] | (a[1] << 8)) + 1;
    const name = SB_NAMES[c] || `command ${hexb(c)}h`;
    let text = `${hexb(c)}h ${name}`;
    switch (c) {
      case 0x10: this.dac(a[0], this.clk); if (this.canTrace()) this.m.traceDev({ k: 'sb', op: 'dac', cmd: c, text: `direct DAC ${hexb(a[0])}h`, rate: Math.round(this.rate), left: this.blockLeft }, 'sb'); return;
      case 0x14: this.startDma('out', len(), false, false, 0, false); break;
      case 0x1C: this.startDma('out', this.blockSize, true, false, 0, false); break;
      case 0x90: this.startDma('out', this.blockSize, true, true, 0, false); break;
      case 0x91: this.startDma('out', this.blockSize, false, true, 0, false); break;
      case 0x24: this.startDma('in', len(), false, false, 0, false); break;
      case 0x2C: this.startDma('in', this.blockSize, true, false, 0, false); break;
      case 0x98: this.startDma('in', this.blockSize, true, true, 0, false); break;
      case 0x99: this.startDma('in', this.blockSize, false, true, 0, false); break;
      case 0x74: case 0x75: this.startDma('out', len(), false, false, 4, c === 0x75); break;
      case 0x76: case 0x77: this.startDma('out', len(), false, false, 3, c === 0x77); break;
      case 0x16: case 0x17: this.startDma('out', len(), false, false, 2, c === 0x17); break;
      case 0x7D: this.startDma('out', this.blockSize, true, false, 4, true); break;
      case 0x7F: this.startDma('out', this.blockSize, true, false, 3, true); break;
      case 0x1F: this.startDma('out', this.blockSize, true, false, 2, true); break;
      case 0x80: this.startDma('silence', len(), false, false, 0, false); break;
      case 0x40:
        this.tc = a[0]; this.rate = 1e6 / (256 - a[0]); this.setPer();
        text += ` ${hexb(a[0])}h: ${Math.round(this.rate)} Hz`;
        break;
      case 0x48: this.blockSize = len(); text += `: ${this.blockSize} bytes`; break;
      case 0xD0: this.paused = true; break;
      case 0xD4: if (this.paused) { this.paused = false; this.nextAt = this.clk + this.bytePer; } break;
      case 0xD1: this.speaker = true; this.setDac(this.lastSample); break;
      case 0xD3: this.speaker = false; this.setDac(this.lastSample); break;
      case 0xD8: this.outq.push(this.speaker ? 0xFF : 0x00); break;
      case 0xDA: this.autoInit = false; break;
      case 0xE0: this.outq.push(~a[0] & 0xFF); break;
      case 0xE1: this.outq.push(2, 1); break;       // DSP version 2.01
      case 0xE4: this.test = a[0]; break;
      case 0xE8: this.outq.push(this.test); break;
      case 0xF2: this.raiseIrq(undefined, 'IRQ 7 (command F2h)'); break;
      case 0x20: this.outq.push(0x80); break;       // no microphone: the ADC reads the middle value
      case 0xF8: this.outq.push(0); break;
    }
    if ([0x14, 0x24, 0x74, 0x75, 0x76, 0x77, 0x16, 0x17, 0x80].includes(c)) text += `: ${len()} bytes`;
    this.upd();
    this.ev('command', text);
    if (this.dmaText) { this.ev('dma', this.dmaText); this.dmaText = null; }   // after the command event
  }
  setPer() {
    const hz = this.m.clockHz;
    this.samplePer = hz / this.rate;
    this.bytePer = this.samplePer * this.spb;
  }
  startDma(kind, len, auto, hs, adpcm, ref) {
    this.kind = kind; this.dmaActive = true; this.paused = false;
    this.autoInit = auto; this.hs = hs;
    this.blockLen = len; this.blockLeft = len;
    this.adpcm = adpcm; this.refPending = ref;
    if (ref) this.adScale = 0;
    this.spb = adpcm === 4 ? 2 : adpcm === 3 ? 3 : adpcm === 2 ? 4 : 1;
    this.setPer();
    this.nextAt = this.clk + this.bytePer;
    if (hs) this.dspState = 'highspeed';
    this.upd();
    this.dmaText = `DMA ${kind === 'in' ? 'input' : kind === 'silence' ? 'silence' : 'output'} starts: ${len} bytes at ${Math.round(this.rate)} Hz${auto ? ', auto-init' : ''}${hs ? ', high speed' : ''}`;
  }
  raiseIrq(t, text) {
    this.irq = true;
    this.irqs++;
    this.m.pic.raise(this.irqLine);
    this.ev('irq', text || 'IRQ 7: the end of the block', t);
  }

  // ---------- time ----------
  tick(c) {
    const t0 = this.clk;
    this.clk = t0 + c;
    if (this.active) this.work(t0);
  }
  work(t0) {
    const now = this.clk;
    if (this.resetWait && now >= this.resetAt) {
      this.resetWait = false;
      this.outq = [0xAA];
      this.dspState = 'ready';
      this.ev('reset', 'DSP ready: AAh in the read buffer', Math.round(this.resetAt - t0));
    }
    let guard = 0;
    while (this.dmaActive && !this.paused && this.nextAt <= now && guard++ < 4096) {
      const at = this.nextAt;
      this.nextAt += this.bytePer;
      this.dmaByte(at, Math.round(at - t0));
    }
    if (this.opl.tRun) this.syncTimers();
    this.upd();
  }
  syncTimers() {
    const now = this.clk;
    if (this.opl.tRun && now > this.oplT) this.opl.tickTimers((now - this.oplT) / this.m.clockHz);
    this.oplT = now;
  }
  // One DRQ of the DSP: one byte from memory (output), to memory (input), or no DMA (silence).
  dmaByte(at, t) {
    const m = this.m;
    if (this.kind === 'out') {
      const r = m.dmaRequest(this.dmaCh, false, 0, t);
      if (!r) return;                                // no DACK: the DSP waits
      const b = r.data;
      if (!this.adpcm) this.dac(b, at);
      else if (this.refPending) { this.refPending = false; this.adRef = b; this.adScale = 0; this.dac(b, at); }
      else if (this.adpcm === 4) {
        this.dac(this.adpcm4(b >> 4), at);
        this.dac(this.adpcm4(b & 15), at + this.samplePer);
      } else this.dac(this.adRef, at);             // 2-bit and 2.6-bit ADPCM: the bytes go, the level stays
    } else if (this.kind === 'in') {
      if (!m.dmaRequest(this.dmaCh, true, 0x80, t)) return;
    }
    if (--this.blockLeft > 0) return;
    this.raiseIrq(t);
    if (this.autoInit) {
      this.blockLeft = this.blockLen;
      this.ev('dma', `the next block: ${this.blockLen} bytes (auto-init)`, t);
    } else {
      this.dmaActive = false;
      if (this.hs) { this.hs = false; this.dspState = 'ready'; }
    }
  }
  adpcm4(n) {
    let i = n + this.adScale;
    i = i < 0 ? 0 : i > 63 ? 63 : i;
    let r = this.adRef + SB_ADPCM4_STEP[i];
    this.adRef = r < 0 ? 0 : r > 255 ? 255 : r;
    this.adScale = (this.adScale + SB_ADPCM4_ADJ[i]) & 0xFF;
    if (this.adScale > 48) this.adScale = 48;
    return this.adRef;
  }
  // A new DAC value (0..255) at clock `at`.
  dac(v, at) {
    this.lastSample = v;
    this.samples++;
    const a = Math.abs(v - 128) / 128, cur = this.level;
    if (a >= cur) { this.lvl = a; this.lvlT = this.clk; }
    this.setDac(v, at);
  }
  // The DAC output (the speaker switch mutes it) into the log for takeSound().
  setDac(v, at = this.clk) {
    if (!this.logT) return;
    const x = this.speaker ? (v - 128) / 128 : 0;
    if (this.logW - this.logR >= SB_LOG) { this.dacV = this.logV[this.logR & (SB_LOG - 1)]; this.logR++; }
    const i = this.logW & (SB_LOG - 1);
    this.logT[i] = at; this.logV[i] = x;
    this.logW++;
  }

  // ---------- OPL2 ports (388h-389h, 228h-229h) ----------
  oplRead(p) {
    if (p & 1) return 0xFF;
    if (this.opl.tRun) this.syncTimers();
    return this.opl.status();
  }
  oplWrite(p, v) {
    if (!(p & 1)) { this.oplAddr = v; return; }
    const r = this.oplAddr;
    if (this.m.audioOn) this.syncOpl();
    if (r === 4) { this.syncTimers(); }
    const res = this.opl.write(r, v);
    if (r === 4) { this.oplT = this.clk; this.upd(); }
    if (this.canTrace(4)) {
      const ch = this.opl.lastCh, op = res === 1 ? 'key-on' : res === 2 ? 'key-off' : 'write';
      let text = `OPL2 register ${hexb(r)}h = ${hexb(v)}h`;
      if (r === 0xBD && res) text += ` (${op}: rhythm ${OPL_DRUMS.filter(d => v & d[0] && v & 0x20).map(d => d[1]).join(', ') || 'none'})`;
      else if (res) { const c = this.opl.channels[ch]; text += ` (${op} channel ${ch}: ${c.freq.toFixed(1)} Hz)`; }
      this.m.traceDev({ k: 'opl', reg: r, val: v, ch: r === 0xBD ? (res ? 6 : -1) : ch, op, text }, 'opl');
    }
  }

  // ---------- sound output ----------
  // Start a new time line for the output at clock t0.
  origin(t0, rate) {
    this.T0 = t0; this.outRate = rate; this.outN = 0;
    this.natN = 0; this.natBase = 0; this.natLen = 0;
    this.dcX = 0; this.dcY = 0;
  }
  // Make the OPL2 samples up to now (native rate).
  syncOpl() {
    if (!this.outRate) return;
    const target = Math.floor((this.clk - this.T0) * OPL_RATE / this.m.clockHz);
    let n = target - this.natN;
    if (n <= 0) return;
    const cap = SB_MAX_SPAN * OPL_RATE + 4096;
    if (this.natLen + n > cap) {                     // nobody takes the sound: keep only the end
      const drop = Math.min(this.natLen, this.natLen + n - cap);
      this.nat.copyWithin(0, drop, this.natLen);
      this.natLen -= drop; this.natBase += drop;
    }
    if (this.natLen + n > this.nat.length) {
      const b = new Float32Array(Math.max(this.nat.length * 2, this.natLen + n + 1024));
      b.set(this.nat.subarray(0, this.natLen));
      this.nat = b;
    }
    this.opl.render(this.nat, this.natLen, n);
    this.natLen += n; this.natN = target;
  }
  // The mixed card audio since the last call: { rate, samples } (mono, about -1..1).
  takeSound(rate) {
    const hz = this.m.clockHz, now = this.clk;
    if (rate !== this.outRate) this.origin(now, rate);
    let n = Math.floor((now - this.T0) * rate / hz) - this.outN;
    const max = Math.round(SB_MAX_SPAN * rate);
    if (n > max) { this.origin(now - max * hz / rate, rate); n = max; }
    const out = new Float32Array(Math.max(0, n));
    if (n <= 0) return { rate, samples: out };
    // the OPL2: native samples, linear interpolation (3 native samples late)
    this.syncOpl();
    const R = OPL_RATE / rate, nat = this.nat, base = this.natBase, k0 = this.outN;
    let quiet = true;
    for (let i = 0; i < this.natLen; i++) if (nat[i] !== 0) { quiet = false; break; }
    if (!quiet) {
      for (let i = 0; i < n; i++) {
        const x = (k0 + i) * R - 3;
        let j = Math.floor(x);
        const f = x - j;
        j -= base;
        const a = j >= 0 && j < this.natLen ? nat[j] : 0, b = j + 1 >= 0 && j + 1 < this.natLen ? nat[j + 1] : 0;
        out[i] = (a + (b - a) * f) * SB_OPL_GAIN;
      }
    }
    const keep = Math.floor((k0 + n) * R - 3) - base;
    if (keep > 0) {
      const d = Math.min(keep, this.natLen);
      nat.copyWithin(0, d, this.natLen);
      this.natLen -= d; this.natBase += d;
    }
    // the DSP: the DAC steps, averaged over each output sample, then the DC block
    // of the output capacitor
    if (this.logR !== this.logW || this.dacV !== 0 || this.dcY !== 0) {
      const cps = hz / rate, T = this.logT, V = this.logV, mask = SB_LOG - 1;
      let v = this.dacV, r = this.logR, x0 = this.dcX, y0 = this.dcY;
      const w = this.logW, pole = Math.exp(-2 * Math.PI * 10 / rate);
      for (let i = 0; i < n; i++) {
        let t = this.T0 + (k0 + i) * cps;
        const tB = t + cps;
        let acc = 0;
        while (r < w) {
          const te = T[r & mask];
          if (te >= tB) break;
          if (te > t) { acc += v * (te - t); t = te; }
          v = V[r & mask]; r++;
        }
        acc += v * (tB - t);
        const x = acc / cps, y = x - x0 + pole * y0;
        x0 = x; y0 = Math.abs(y) < 1e-9 ? 0 : y;
        out[i] += y0 * SB_DSP_GAIN;
      }
      this.dacV = v; this.logR = r; this.dcX = x0; this.dcY = y0;
    }
    this.outN = k0 + n;
    return { rate, samples: out };
  }
}
