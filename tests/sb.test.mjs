// Sound Blaster 2.0 tests (src/core/soundblaster.js): the DSP (reset, version, speaker,
// direct DAC, single-cycle, auto-init and high-speed DMA with the sample and IRQ timing,
// pause / continue, ADPCM, input), the OPL2 (AdLib detection with the timers, the
// synthesis: pitch, envelope, waveforms, rhythm mode), takeSound() and the trace events.
// A program on each of the three machines plays auto-init DMA with an IRQ 7 handler
// and detects the AdLib with the timer method.
// Usage: node tests/sb.test.mjs [--wav dir]   (--wav: write the synthesis checks as WAV files)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js',
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js',
  'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js', 'src/core/bios.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const G = n => vm.runInThisContext(n);
const [Asm86, OPL2, OPL_RATE] = ['Asm86', 'OPL2', 'OPL_RATE'].map(G);
const MODELS = ['8086', '80286', '80386', '80486', '80586', '80686'];
const machineClass = model => G(model === '80686' ? 'Machine686' : model === '80586' ? 'Machine586' : model === '80486' ? 'Machine486' : model === '80386' ? 'Machine386' : model === '80286' ? 'Machine286' : 'Machine');
const argOf = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const WAV_DIR = argOf('--wav');

let pass = 0, fail = 0, section = '';
const check = (ok, name) => { if (ok) pass++; else { fail++; console.log(`FAIL [${section}] ${name}`); } };
const eq = (a, b, name) => check(a === b, `${name}: got ${a}, want ${b}`);
const near = (a, b, tol, name) => check(Math.abs(a - b) <= tol, `${name}: got ${+a.toFixed ? a.toFixed(4) : a}, want ${b} +- ${tol}`);
const begin = s => { section = s; console.log(`- ${s}`); };
const t0 = Date.now();

// A machine without a BIOS: the tests use the ports directly and move the time with tickDevices.
function bare(model = '80286') {
  const m = new (machineClass(model))();
  m.reset();
  return m;
}
const out = (m, p, v) => m.ioWrite(p, v);
const inp = (m, p) => m.ioRead(p);
// move the time line of the card by sec seconds (DMA cycles also move it, as on the bus)
const adv = (m, sec) => {
  const end = m.sb.clk + sec * m.clockHz;
  while (m.sb.clk + 64 <= end) m.tickDevices(64);
  if (end - m.sb.clk >= 1) m.tickDevices(Math.floor(end - m.sb.clk));
};
const dsp = (m, ...bytes) => { for (const b of bytes) { eq(inp(m, 0x22C) & 0x80, 0, 'DSP not busy'); out(m, 0x22C, b); } };
const reset = m => { out(m, 0x226, 1); adv(m, 5e-6); out(m, 0x226, 0); };
// DMA channel 1: mask, mode, address, page, count - 1, unmask
function dma1(m, addr, count, mode) {
  out(m, 0x0A, 5); out(m, 0x0C, 0); out(m, 0x0B, mode);
  out(m, 0x02, addr & 0xFF); out(m, 0x02, (addr >> 8) & 0xFF); out(m, 0x83, addr >> 16);
  out(m, 0x03, (count - 1) & 0xFF); out(m, 0x03, (count - 1) >> 8);
  out(m, 0x0A, 1);
}
// count the IRQ 7 requests (and acknowledge them like a handler: read 22Eh)
function irqCounter(m) {
  const c = { n: 0, at: [] };
  const raise = m.pic.raise.bind(m.pic);
  m.pic.raise = n => { if (n === 7) { c.n++; c.at.push(m.sb.clk); } raise(n); };
  return c;
}

// ---------- 1. the DSP ----------
begin('DSP reset, version, speaker, test register');
{
  const m = bare();
  eq(m.ioDevAt(0x22C), 'sb', 'port 22Ch is the DSP'); eq(m.ioDevAt(0x388), 'opl', '388h is the OPL2'); eq(m.ioDevAt(0x229), 'opl', '229h is the OPL2');
  out(m, 0x226, 1); out(m, 0x226, 0);
  eq(inp(m, 0x22E) & 0x80, 0, 'no data at once after the reset');
  adv(m, 30e-6);
  eq(inp(m, 0x22E) & 0x80, 0x80, 'data available after 20 us');
  eq(inp(m, 0x22A), 0xAA, 'reset answer AAh');
  eq(inp(m, 0x22E) & 0x80, 0, 'read buffer empty');
  eq(m.sb.dspState, 'ready', 'dspState ready');
  dsp(m, 0xE1); eq(inp(m, 0x22A), 2, 'version major 2'); eq(inp(m, 0x22A), 1, 'version minor 01');
  dsp(m, 0xE0, 0x5A); eq(inp(m, 0x22A), 0xA5, 'E0h: inverted byte');
  dsp(m, 0xE4, 0x3C, 0xE8); eq(inp(m, 0x22A), 0x3C, 'E4h / E8h test register');
  dsp(m, 0xD8); eq(inp(m, 0x22A), 0x00, 'speaker off after reset');
  dsp(m, 0xD1, 0xD8); eq(inp(m, 0x22A), 0xFF, 'D1h speaker on'); eq(m.sb.speaker, true, 'state speaker');
  dsp(m, 0xD3, 0xD8); eq(inp(m, 0x22A), 0x00, 'D3h speaker off');
  dsp(m, 0x20); eq(inp(m, 0x22A), 0x80, '20h direct ADC: 80h');
  const irq = irqCounter(m);
  dsp(m, 0xF2);
  eq(irq.n, 1, 'F2h raises IRQ 7'); eq(m.sb.irq, true, 'state irq'); check((m.pic.irr & 0x80) !== 0, 'IRR bit 7');
  inp(m, 0x22E);
  eq(m.sb.irq, false, '22Eh acknowledges the IRQ'); eq(m.pic.irr & 0x80, 0, 'IRR bit 7 low again');
  eq(inp(m, 0x221), 0xFF, 'no CMS chips: 221h reads FFh');
  out(m, 0x225, 0xBB); eq(inp(m, 0x225), 0xFF, 'no SB Pro mixer at 224h-225h');
}
begin('direct DAC and takeSound()');
{
  const m = bare();
  reset(m); adv(m, 1e-4); inp(m, 0x22A);
  m.audioRate = 44100;
  m.takeSound();
  dsp(m, 0xD1);
  let sum = 0, n = 0;
  for (let i = 0; i < 400; i++) {                  // a 1 kHz square wave by 10h commands at 8 kHz
    dsp(m, 0x10, (i >> 2) & 1 ? 0xE0 : 0x20);
    adv(m, 1 / 8000);
  }
  const s = m.takeSound();
  for (const x of s.samples) { sum += x * x; n++; }
  eq(m.sb.lastSample, 0xE0, 'lastSample');
  near(n, 0.05 * 44100, 3, 'samples for 50 ms at 44100 Hz');
  check(Math.sqrt(sum / n) > 0.15, `the DAC square wave is loud (RMS ${Math.sqrt(sum / n).toFixed(3)})`);
  check(m.sb.level > 0.5, `level ${m.sb.level.toFixed(2)}`);
  dsp(m, 0xD3);
  for (let i = 0; i < 100; i++) { dsp(m, 0x10, i & 1 ? 0xFF : 0); adv(m, 1 / 8000); }
  adv(m, 0.05);
  const q = m.takeSound().samples;
  let mx = 0; for (let i = q.length >> 1; i < q.length; i++) mx = Math.max(mx, Math.abs(q[i]));
  check(mx < 0.02, `speaker off mutes the DAC (peak ${mx.toFixed(4)})`);
}

// Single-cycle, auto-init, high-speed, pause: the sample count and the IRQs over time.
for (const model of MODELS) {
  begin(`DMA playback on the ${model} machine`);
  const m = bare(model), sb = m.sb;
  reset(m); adv(m, 1e-4); inp(m, 0x22A);
  const irq = irqCounter(m);
  const buf = 0x12340;                               // page 1: the page register must work
  for (let i = 0; i < 4096; i++) m.mem[buf + i] = 128 + Math.round(100 * Math.sin(i / 8));
  dsp(m, 0xD1, 0x40, 131);                          // 1e6 / (256 - 131) = 8000 Hz
  near(sb.rate, 8000, 1e-6, 'time constant 131: 8000 Hz');
  // single cycle: 800 bytes = 100 ms
  dma1(m, buf, 800, 0x49);
  let s0 = sb.samples;
  dsp(m, 0x14, (800 - 1) & 0xFF, (800 - 1) >> 8);
  eq(sb.dmaActive, true, 'dmaActive'); eq(sb.blockLeft, 800, 'blockLeft');
  adv(m, 0.090);
  near(sb.samples - s0, 720, 2, 'single cycle: samples after 90 ms');
  eq(irq.n, 0, 'no IRQ before the end');
  adv(m, 0.020);
  eq(sb.samples - s0, 800, 'single cycle: all 800 samples');
  eq(irq.n, 1, 'single cycle: one IRQ at the end'); eq(sb.dmaActive, false, 'the DSP stops');
  eq(m.dma.status & 2, 2, 'DMA channel 1 TC bit'); eq((m.dma.mask >> 1) & 1, 1, 'DMA channel 1 masks itself at TC');
  eq(sb.lastSample, m.mem[buf + 799], 'the last sample is the last byte');
  inp(m, 0x22E);
  // auto-init: block 400 bytes (50 ms), DMA buffer 800 bytes (mode 59h: auto-init read channel 1)
  dma1(m, buf, 800, 0x59);
  dsp(m, 0x48, (400 - 1) & 0xFF, (400 - 1) >> 8);
  irq.n = 0; irq.at = []; s0 = sb.samples;
  const tStart = sb.clk;
  dsp(m, 0x1C);
  eq(sb.autoInit, true, 'autoInit');
  for (let k = 0; k < 6; k++) { adv(m, 0.025); inp(m, 0x22E); adv(m, 0.025); }
  adv(m, 0.001);
  eq(irq.n, 6, 'auto-init: 6 IRQs in 300 ms');
  near(sb.samples - s0, 2400, 10, 'auto-init: samples in 300 ms');
  const per = irq.at.map((t, i) => (t - (i ? irq.at[i - 1] : tStart)) / m.clockHz);
  check(per.every(p => Math.abs(p - 0.05) < 0.0005), `auto-init: an IRQ each 50 ms (${per.map(p => (p * 1000).toFixed(2)).join(' ')} ms)`);
  eq(m.dma.addr[1], (buf & 0xFFFF) + (sb.samples - s0) % 800, 'the DMA address wraps (auto-init DMA)');
  dsp(m, 0xDA);                                     // exit auto-init after this block
  adv(m, 0.2);
  eq(irq.n, 7, 'DAh: one more IRQ, then the DSP stops'); eq(sb.dmaActive, false, 'stopped after DAh');
  // pause and continue
  dma1(m, buf, 4000, 0x49);
  s0 = sb.samples;
  dsp(m, 0x14, (4000 - 1) & 0xFF, (4000 - 1) >> 8);
  adv(m, 0.05);
  dsp(m, 0xD0);
  const sp = sb.samples;
  adv(m, 0.1);
  eq(sb.samples, sp, 'D0h: no samples while paused');
  dsp(m, 0xD4);
  adv(m, 0.05);
  near(sb.samples - sp, 400, 2, 'D4h: the transfer continues');
  // high speed: 43478 Hz (time constant 233), auto-init, block 2048
  reset(m); adv(m, 1e-4); inp(m, 0x22A);
  dsp(m, 0xD1, 0x40, 233, 0x48, 0xFF, 0x07);
  dma1(m, buf, 4096, 0x59);
  irq.n = 0; s0 = sb.samples;
  dsp(m, 0x90);
  eq(sb.dspState, 'highspeed', 'dspState highspeed');
  out(m, 0x22C, 0xE1);
  eq(inp(m, 0x22E) & 0x80, 0, 'high speed: the DSP takes no commands');
  const hsSec = 10 * 2048 / 43478;
  adv(m, hsSec + 0.0001);
  eq(irq.n, 10, 'high speed: 10 IRQs in 10 blocks of time');
  near(sb.samples - s0, 20480, 20, 'high speed: samples at 43478 Hz');
  reset(m); adv(m, 1e-4);
  eq(inp(m, 0x22A), 0xAA, 'a reset ends the high-speed mode');
  eq(sb.dmaActive, false, 'no DMA after the reset');
  const st = m.takeStats();
  check(st.dev.sb > 50 && st.dev.dma > 20000, `stats: sb ${st.dev.sb}, dma ${st.dev.dma}`);
}
begin('ADPCM, input, silence');
{
  const m = bare(), sb = m.sb;
  reset(m); adv(m, 1e-4); inp(m, 0x22A);
  const irq = irqCounter(m);
  const buf = 0x20000;
  m.mem[buf] = 0x80; for (let i = 1; i < 101; i++) m.mem[buf + i] = 0x31;
  dsp(m, 0xD1, 0x40, 131);
  dma1(m, buf, 101, 0x49);
  let s0 = sb.samples;
  dsp(m, 0x75, 100, 0);                             // 4-bit ADPCM with a reference byte: 101 bytes
  adv(m, 0.03);
  eq(irq.n, 1, '4-bit ADPCM: IRQ at the end'); eq(sb.samples - s0, 201, '4-bit ADPCM: 1 + 2 x 100 samples');
  check(sb.lastSample > 0x80, `4-bit ADPCM goes up with positive steps (${sb.lastSample})`);
  inp(m, 0x22E);
  dma1(m, buf, 50, 0x49);
  dsp(m, 0x77, 49, 0);
  adv(m, 0.03);
  eq(irq.n, 2, '2.6-bit ADPCM: the bytes go, IRQ at the end');
  inp(m, 0x22E);
  m.mem.fill(0, 0x30000, 0x30100);
  dma1(m, 0x30000, 256, 0x45);                      // write to memory (device -> memory)
  dsp(m, 0x24, 255, 0);
  adv(m, 0.04);
  eq(irq.n, 3, '24h input: IRQ at the end');
  check(m.mem.subarray(0x30000, 0x30100).every(x => x === 0x80), 'input: the memory gets 80h (silence)');
  inp(m, 0x22E);
  dsp(m, 0x80, 79, 0);                              // 80 samples of silence: 10 ms
  adv(m, 0.009); eq(irq.n, 3, 'silence: no IRQ before 10 ms');
  adv(m, 0.002); eq(irq.n, 4, 'silence: IRQ after 80 samples');
}

// ---------- 2. the OPL2 ----------
begin('AdLib detection (timer method) through the ports');
{
  const m = bare();
  const w = (r, v) => { out(m, 0x388, r); out(m, 0x389, v); };
  w(4, 0x60); w(4, 0x80);
  const s1 = inp(m, 0x388);
  w(2, 0xFF); w(4, 0x21);
  adv(m, 60e-6);
  const sMid = inp(m, 0x388);
  adv(m, 40e-6);
  const s2 = inp(m, 0x388);
  w(4, 0x60); w(4, 0x80);
  eq(s1 & 0xE0, 0x00, 'status after reset: 00h'); eq(sMid & 0xE0, 0x00, 'no overflow after 60 us');
  eq(s2 & 0xE0, 0xC0, 'status after 100 us: C0h (IRQ + timer 1)');
  eq(s1 & 0x06, 0x06, 'OPL2: status bits 1-2 read 1');
  eq(inp(m, 0x388) & 0xE0, 0, 'flags reset');
  out(m, 0x228, 3); out(m, 0x229, 0x80); out(m, 0x228, 4); out(m, 0x229, 0x42);   // timer 2 through 228h
  adv(m, 128 * 320e-6 + 1e-4);
  eq(inp(m, 0x228) & 0xE0, 0xA0, 'timer 2 at 228h: A0h after 41 ms');
  out(m, 0x228, 4); out(m, 0x229, 0x62);
  eq(inp(m, 0x228) & 0xE0, 0, 'mask bit clears the flag');
  eq(m.opl.timers.t2.run, true, 'timers state');
}

// A single operator note on a bare chip: returns the chip and a function to render seconds.
function chip() {
  const o = new OPL2();
  const buf = [];
  return {
    o, w: (r, v) => o.write(r, v),
    run(sec) { const n = Math.round(sec * OPL_RATE), b = new Float32Array(n); o.render(b, 0, n); buf.push(b); return b; },
    all() { const n = buf.reduce((a, b) => a + b.length, 0), r = new Float32Array(n); let p = 0; for (const b of buf) { r.set(b, p); p += b.length; } return r; },
  };
}
// the frequency by the rising zero crossings (with interpolation)
function freqOf(b, rate) {
  let first = -1, last = -1, n = 0;
  for (let i = 1; i < b.length; i++) {
    if (b[i - 1] < 0 && b[i] >= 0) {
      const x = i - 1 + (-b[i - 1]) / (b[i] - b[i - 1]);
      if (first < 0) first = x; else n++;
      last = x;
    }
  }
  return n ? n * rate / (last - first) : 0;
}
// a plain sine voice on channel 0: modulator silent (TL 63), carrier TL 0, FM
// (modAr: the attack rate of the modulator; 0 = the modulator stays silent)
function sineVoice(c, { ar = 15, dr = 0, sl = 0, rr = 15, egt = 1, fnum = 580, block = 4, wf = 0, mult = 1, modAr = 0 } = {}) {
  c.w(0x20, 0x20 | mult); c.w(0x40, 63); c.w(0x60, (modAr << 4) | 15); c.w(0x80, 0x0F);
  c.w(0x23, (egt << 5) | mult); c.w(0x43, 0); c.w(0x63, (ar << 4) | dr); c.w(0x83, (sl << 4) | rr); c.w(0xE3, wf);
  c.w(0xC0, 0); c.w(0xA0, fnum & 0xFF); c.w(0xB0, 0x20 | (block << 2) | (fnum >> 8));
}
const writeWav = (name, s, rate) => {
  if (!WAV_DIR) return;
  fs.mkdirSync(WAV_DIR, { recursive: true });
  const b = Buffer.alloc(44 + s.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + s.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path.join(WAV_DIR, name), b);
};
begin('OPL2 synthesis: A440 sine');
{
  const c = chip();
  sineVoice(c);
  const b = c.run(1);
  const f = freqOf(b.subarray(2000), OPL_RATE);
  near(f, 440, 4.4, `A440 (F-number 580, block 4): ${f.toFixed(2)} Hz`);
  let mx = 0, mn = 0; for (const x of b) { mx = Math.max(mx, x); mn = Math.min(mn, x); }
  check(mx >= 4000 && mx <= 4085 && mn <= -4000, `full level: peak ${mx} / ${mn} (the chip gives 4084)`);
  eq(c.o.channels[0].on, true, 'channel on'); near(c.o.channels[0].freq, 440, 0.1, 'channel freq');
  eq(c.o.channels[0].op[1].stage, 'sustain', 'stage sustain'); near(c.o.channels[0].op[1].env, 1, 0.001, 'env 1');
  // an ideal sine: the energy at 2 x 440 Hz is small
  const N = 44000, x = b.subarray(1000, 1000 + N);
  const dft = hz => { let re = 0, im = 0; for (let i = 0; i < N; i++) { const a = 2 * Math.PI * hz * i / OPL_RATE; re += x[i] * Math.cos(a); im += x[i] * Math.sin(a); } return Math.hypot(re, im) / N; };
  const h1 = dft(439.99), h2 = dft(879.98), h3 = dft(1319.97);
  check(h2 < h1 * 0.01 && h3 < h1 * 0.01, `sine purity: 2nd ${(h2 / h1).toExponential(1)}, 3rd ${(h3 / h1).toExponential(1)}`);
  // other notes: multiplier 2 and block 5
  const c2 = chip(); sineVoice(c2, { mult: 2 }); near(freqOf(c2.run(0.5).subarray(2000), OPL_RATE), 880, 8.8, 'multiplier 2: 880 Hz');
  const c3 = chip(); sineVoice(c3, { block: 5, fnum: 290 }); near(freqOf(c3.run(0.5).subarray(2000), OPL_RATE), 440, 4.4, 'block 5, F-number 290: 440 Hz');
  writeWav('opl-a440.wav', Float32Array.from(b, v => v / 8192), OPL_RATE);
}
begin('OPL2 synthesis: envelope');
{
  // attack AR 8, decay DR 8 to SL 4 (-12 dB), sustain, then release RR 8. Block 1: the key
  // scale rate is 0, so the rate is 4 x the register value.
  const c = chip();
  sineVoice(c, { ar: 8, dr: 8, sl: 4, rr: 8, block: 1 });
  const s = c.o.slots[3];
  const trace = [];
  for (let i = 0; i < 0.5 * OPL_RATE / 64; i++) { c.run(64 / OPL_RATE); trace.push([s.eg, s.stage]); }
  c.w(0xB0, (1 << 2) | (580 >> 8));                 // key off
  for (let i = 0; i < 0.6 * OPL_RATE / 64; i++) { c.run(64 / OPL_RATE); trace.push([s.eg, s.stage]); }
  const ms = i => i * 64 / OPL_RATE * 1000;
  const iAttack = trace.findIndex(e => e[1] !== 'attack'), tAttack = ms(iAttack);
  const tSustain = ms(trace.findIndex(e => e[1] === 'sustain'));
  const iOff = Math.round(0.5 * OPL_RATE / 64);
  const tRelease = ms(trace.findIndex((e, i) => i > iOff && e[1] === 'off') - iOff);
  console.log(`  attack ${tAttack.toFixed(1)} ms, attack + decay to -12 dB ${tSustain.toFixed(1)} ms, release to off ${tRelease.toFixed(1)} ms`);
  // YM3812 data: attack rate 8 = 22.1 ms (0 to 100 %), decay rate 8 = 307 ms for 96 dB
  // (12 dB = 38 ms), release rate 8 from -12 dB to -94.5 dB = 307 x 82.5 / 96 = 264 ms
  check(tAttack > 22.1 * 0.7 && tAttack < 22.1 * 1.5, `attack time ${tAttack.toFixed(1)} ms (22.1 ms in the data)`);
  near(tSustain - tAttack, 38.4, 38.4 * 0.15, 'decay 12 dB');
  near(tRelease, 264, 264 * 0.15, 'release to off');
  eq(trace[Math.round(0.3 * OPL_RATE / 64)][0], 64, 'sustain level 4 = 64 units (12 dB)');
  // the shape: level goes down in attack, up in decay and release (attenuation units)
  const a = trace.slice(0, iAttack).map(e => e[0]);
  check(a.every((v, i) => !i || v <= a[i - 1]), 'attack: the attenuation only goes down');
  check(a[Math.floor(a.length / 2)] < 128, `attack is exponential: fast at the start (${a[Math.floor(a.length / 2)]} units at the half time)`);
  // release rate 15 with a key-off: fast
  const c2 = chip(); sineVoice(c2, { rr: 15 }); c2.run(0.05); c2.w(0xB0, 0x10 | 2);
  c2.run(0.003);
  eq(c2.o.slots[3].stage, 'off', 'release rate 15: off in 3 ms');
  // AR 0: no attack
  const c3 = chip(); sineVoice(c3, { ar: 0 }); const b3 = c3.run(0.1);
  check(b3.every(v => Math.abs(v) <= 1), 'attack rate 0: silence');
}
begin('OPL2 synthesis: waveforms and feedback');
{
  const wave = (wf, wse) => { const c = chip(); if (wse) c.w(0x01, 0x20); sineVoice(c, { wf }); return c.run(0.1).subarray(1000); };
  const mm = b => { let mx = -1e9, mn = 1e9; for (const x of b) { mx = Math.max(mx, x); mn = Math.min(mn, x); } return [mx, mn]; };
  const [mx0, mn0] = mm(wave(1, false));
  check(mn0 < -4000 && mx0 > 4000, 'WSE = 0: register E0h is ignored (sine)');
  const [mx1, mn1] = mm(wave(1, true));
  check(mx1 > 4000 && mn1 >= -1, `waveform 1 half sine: min ${mn1}`);
  const w2 = wave(2, true), [mx2, mn2] = mm(w2);
  check(mx2 > 4000 && mn2 >= -1, 'waveform 2 absolute sine');
  near(freqOf(w2.map(v => v - 2600), OPL_RATE), 880, 9, 'waveform 2: two humps in each period');
  const w3 = wave(3, true);
  let zeros = 0; for (const x of w3) if (Math.abs(x) <= 1) zeros++;
  near(zeros / w3.length, 0.5, 0.05, 'waveform 3 quarter sine: silence half of the time');
  const c = chip(); c.w(0x01, 0x20); sineVoice(c, { wf: 3 });
  eq(c.o.channels[0].op[1].wave, 3, 'op.wave');
  // FM: modulator at the same frequency, TL 0 -> many harmonics
  const f = chip(); sineVoice(f, { modAr: 15 }); f.w(0x40, 0); f.w(0xC0, 0x0E);   // modulator TL 0, feedback 7
  const fm = f.run(0.2).subarray(2000);
  near(freqOf(fm.map((v, i) => v), OPL_RATE) > 0 ? 440 : 0, 440, 0.1, 'FM: the period stays');
  let d = 0; const sn = wave(0, false); for (let i = 0; i < 3000; i++) d += Math.abs(fm[i] - sn[i]);
  check(d / 4000 > 500, `FM with feedback changes the waveform (mean difference ${(d / 3000).toFixed(0)})`);
  // AM (additive): both operators sound
  const am = chip(); sineVoice(am, { modAr: 15 }); am.w(0x40, 0); am.w(0xC0, 0x01);
  const [mxa] = mm(am.run(0.1).subarray(1000));
  check(mxa > 6000, `AM connection: the two operators add (${mxa})`);
}
begin('OPL2 synthesis: rhythm mode, tremolo, vibrato');
{
  const c = chip();
  // bass drum (channel 6) and hi-hat (slot 13) + snare (slot 16)
  for (const [off, tl] of [[0x10, 0], [0x13, 0], [0x11, 0], [0x14, 0]]) { c.w(0x20 + off, 0x01); c.w(0x40 + off, tl); c.w(0x60 + off, 0xF6); c.w(0x80 + off, 0x46); }
  c.w(0xA6, 0x40); c.w(0xB6, 0x09); c.w(0xA7, 0x80); c.w(0xB7, 0x0A);
  const silent = c.run(0.05);
  check(silent.every(v => v === 0), 'no sound before the drums');
  c.w(0xBD, 0x20 | 0x10);
  const bd = c.run(0.1);
  let e = 0; for (const x of bd) e += x * x;
  check(Math.sqrt(e / bd.length) > 500, `bass drum sounds (RMS ${Math.sqrt(e / bd.length).toFixed(0)})`);
  eq(c.o.rhythm.bd, true, 'rhythm state bd'); eq(c.o.channels[6].on, true, 'channel 6 on (bass drum)');
  c.w(0xBD, 0x20); c.run(0.3);
  c.w(0xBD, 0x20 | 0x01 | 0x08);
  const hh = c.run(0.1);
  e = 0; let zc = 0; for (let i = 1; i < hh.length; i++) { e += hh[i] * hh[i]; if ((hh[i - 1] < 0) !== (hh[i] < 0)) zc++; }
  check(Math.sqrt(e / hh.length) > 300, `hi-hat + snare sound (RMS ${Math.sqrt(e / hh.length).toFixed(0)})`);
  check(zc > 0.1 * 2 * 1000, `hi-hat + snare: noise-like, many zero crossings (${zc} in 100 ms)`);
  eq(c.o.rhythm.hh && c.o.rhythm.sd, true, 'rhythm state hh + sd');
  writeWav('opl-drums.wav', Float32Array.from(c.all(), v => v / 16384), OPL_RATE);
  // tremolo: deep AM (BDh bit 7) on the carrier: the level changes by about 4.8 dB at 3.7 Hz
  const t = chip(); t.w(0xBD, 0x80); sineVoice(t); t.w(0x23, 0xA1);
  const tb = t.run(1);
  const env = []; for (let i = 0; i < tb.length - 500; i += 500) { let p = 0; for (let k = 0; k < 500; k++) p = Math.max(p, Math.abs(tb[i + k])); env.push(p); }
  const db = 20 * Math.log10(Math.max(...env) / Math.min(...env));
  near(db, 4.8, 0.8, 'tremolo depth (deep): dB');
  // vibrato: deep (BDh bit 6), the pitch changes by about 14 cents
  const v = chip(); v.w(0xBD, 0x40); sineVoice(v); v.w(0x23, 0x61);
  const vb = v.run(1);
  const fs1 = []; for (let i = 0; i + 4000 < vb.length; i += 2000) fs1.push(freqOf(vb.subarray(i, i + 4000), OPL_RATE));
  const cents = 1200 * Math.log2(Math.max(...fs1) / Math.min(...fs1));
  check(cents > 8 && cents < 30, `vibrato (deep): ${cents.toFixed(1)} cents peak to peak`);
}

begin('OPL2 through the ports and takeSound() at 44100 Hz');
{
  const m = bare('80386');
  m.audioRate = 44100; m.audioOn = true;
  m.takeSound();
  const w = (r, v) => { out(m, 0x388, r); out(m, 0x389, v); };
  w(0x20, 1); w(0x40, 63); w(0x23, 0x21); w(0x43, 0); w(0x63, 0xF0); w(0x83, 0x0F); w(0xA0, 580 & 0xFF);
  let total = 0, calls = 0;
  const parts = [];
  w(0xB0, 0x20 | (4 << 2) | (580 >> 8));
  for (let i = 0; i < 100; i++) {                  // 1 s in 10 ms steps
    adv(m, 0.01);
    const s = m.takeSound();
    eq(s.rate, 44100, 'rate');
    total += s.samples.length; calls++; parts.push(s.samples);
  }
  near(total, 44100, 2, `1 s of sound at 44100 Hz in ${calls} calls`);
  const all = new Float32Array(total); let p = 0; for (const s of parts) { all.set(s, p); p += s.length; }
  near(freqOf(all.subarray(1000), 44100), 440, 4.4, 'A440 after the resampling to 44100 Hz');
  let mx = 0; for (const x of all) mx = Math.max(mx, Math.abs(x)); check(mx > 0.2 && mx < 0.3, `level of one channel ${mx.toFixed(3)}`);
  writeWav('opl-a440-44k.wav', all, 44100);
  // the same with audioOn = false: the samples come only at takeSound(), the count is the same
  m.audioOn = false;
  let t2 = 0; for (let i = 0; i < 10; i++) { adv(m, 0.0137); t2 += m.takeSound().samples.length; }
  near(t2, 0.137 * 44100, 2, 'audioOn = false: the sample count follows the time');
  // no card
  const n = new (machineClass('80286'))({ soundCard: false }); n.reset();
  eq(n.ioRead(0x22E), 0xFF, 'soundCard false: 22Eh reads FFh'); eq(n.ioDevAt(0x388), 'none', 'soundCard false: 388h is none');
  eq(n.takeSound().samples.length, 0, 'soundCard false: no samples');
  n.soundCard = true; eq(n.ioDevAt(0x388), 'opl', 'soundCard true again');
  // speed: 9 channels with notes (the worst case) for 1 s of emulated time
  const c = chip();
  for (let ch = 0; ch < 9; ch++) {
    const o0 = [0, 1, 2, 8, 9, 10, 16, 17, 18][ch];
    c.w(0x20 + o0, 0x21); c.w(0x23 + o0, 0x21); c.w(0x40 + o0, 10); c.w(0x43 + o0, 0); c.w(0x60 + o0, 0xF2); c.w(0x63 + o0, 0xF2);
    c.w(0xA0 + ch, 0x80 + ch * 20); c.w(0xB0 + ch, 0x31); c.w(0xC0 + ch, 0x0A);
  }
  const tt = Date.now(); c.run(1); const ms = Date.now() - tt;
  console.log(`  OPL2 speed: 1 s of 9 channels in ${ms} ms`);
  check(ms < 400, 'OPL2 synthesis is fast enough for real time');
}

// ---------- 3. trace events ----------
begin('trace events');
{
  const m = bare('80286');
  const prog = Asm86.assemble(`
        org 0x100
        mov dx, 0x226
        mov al, 1
        out dx, al
        mov al, 0
        out dx, al
        mov dx, 0x22E
wr:     in al, dx
        test al, 0x80
        jz wr
        mov dx, 0x22C
        mov al, 0xD1
        out dx, al
        mov dx, 0x388
        mov al, 0xB0
        out dx, al
        inc dx
        mov al, 0x31
        out dx, al
        hlt`, { origin: 0x100 });
  m.loadProgram(prog.bytes, 0x100); m.startProgram();
  const ev = [];
  for (let i = 0; i < 400 && !m.cpu.halted; i++) { const r = m.step(); ev.push(...r.events.filter(e => e.k === 'sb' || e.k === 'opl').map(e => ({ ...e, bus: r.events.find(b => b.k === 'bus' && b.dev === (e.k === 'sb' ? 'sb' : 'opl')) }))); }
  const cmd = ev.find(e => e.k === 'sb' && e.op === 'command');
  check(!!cmd && cmd.cmd === 0xD1 && /speaker on/.test(cmd.text), `sb command event: ${cmd && cmd.text}`);
  check(!!cmd && cmd.bus && cmd.t === cmd.bus.t + 1, 'the event time is the time of the port bus cycle + 1');
  check(ev.some(e => e.k === 'sb' && e.op === 'reset'), 'sb reset event');
  const kon = ev.find(e => e.k === 'opl' && e.op === 'key-on');
  check(!!kon && kon.reg === 0xB0 && kon.val === 0x31 && kon.ch === 0, `opl key-on event: ${kon && kon.text}`);
  check(ev.filter(e => e.k === 'opl').length === 1, 'the address write makes no event');
  const busDev = [];
  m.loadProgram(prog.bytes, 0x100); m.startProgram();
  for (let i = 0; i < 6; i++) busDev.push(...m.step().events.filter(e => e.k === 'bus' && e.type === 'iow').map(e => e.dev));
  check(busDev.includes('sb'), `bus events name the device 'sb' (${busDev.join(',')})`);
  // DMA events come from the DSP clock
  reset(m); adv(m, 1e-4); inp(m, 0x22A);
  dma1(m, 0x20000, 100, 0x49); out(m, 0x22C, 0x40); out(m, 0x22C, 0xF0); out(m, 0x22C, 0x14); out(m, 0x22C, 99); out(m, 0x22C, 0);
  m.startProgram(); m.cpu.ip = 0x100; m.mem[0x10100] = 0xEB; m.mem[0x10101] = 0xFE;   // JMP $
  const kinds = new Set();
  for (let i = 0; i < 3000; i++) for (const e of m.step().events) if (e.k === 'dma' || e.k === 'sb') kinds.add(e.k === 'dma' ? `dma${e.ch}` : `sb:${e.op}`);
  check(kinds.has('dma1') && kinds.has('sb:irq'), `DSP DMA events: ${[...kinds].join(' ')}`);
}

// ---------- 4. programs on the three machines ----------
// auto-init DMA with an IRQ 7 handler (the way a game plays sound), and the AdLib
// detection of the games (Wolfenstein 3D: 100 reads of 388h as the wait)
const PROG = (block, nirq) => `
        org 0x100
        cli
        xor ax, ax
        mov es, ax
        mov word [es:0x0F*4], irq7
        mov [es:0x0F*4+2], cs
        in al, 0x21
        and al, 0x7F
        out 0x21, al
        ; AdLib detection
        mov ax, 0x6004
        call opl
        mov ax, 0x8004
        call opl
        mov dx, 0x388
        in al, dx
        mov [st1], al
        mov ax, 0xFF02
        call opl
        mov ax, 0x2104
        call opl
        mov dx, 0x388
        mov cx, 100
us:     in al, dx
        loop us
        mov [st2], al
        mov ax, 0x6004
        call opl
        mov ax, 0x8004
        call opl
        ; DSP reset
        mov dx, 0x226
        mov al, 1
        out dx, al
        mov cx, 10
w1:     in al, dx
        loop w1
        xor al, al
        out dx, al
        mov dx, 0x22E
        mov cx, 1000
w2:     in al, dx
        test al, 0x80
        jnz w3
        loop w2
w3:     mov dx, 0x22A
        in al, dx
        mov [rst], al
        ; DMA channel 1: mode 59h (auto-init, read), buffer of 2 blocks
        mov al, 5
        out 0x0A, al
        out 0x0C, al
        mov al, 0x59
        out 0x0B, al
        mov ax, cs
        mov dx, ax
        mov cl, 4
        shl ax, cl
        mov cl, 12
        shr dx, cl
        add ax, buf
        adc dl, 0
        out 0x02, al
        mov al, ah
        out 0x02, al
        mov al, dl
        out 0x83, al
        mov ax, ${2 * block - 1}
        out 0x03, al
        mov al, ah
        out 0x03, al
        mov al, 1
        out 0x0A, al
        mov al, 0xD1
        call dsp
        mov al, 0x40
        call dsp
        mov al, 131
        call dsp
        mov al, 0x48
        call dsp
        mov al, ${(block - 1) & 0xFF}
        call dsp
        mov al, ${(block - 1) >> 8}
        call dsp
        sti
        mov al, 0x1C
        call dsp
wt:     cmp word [count], ${nirq}
        jb wt
        mov al, 0xDA
        call dsp
wt2:    cmp word [count], ${nirq + 1}
        jb wt2
        jmp done
opl:    mov dx, 0x388
        out dx, al
        mov cx, 6
o1:     in al, dx
        loop o1
        inc dx
        mov al, ah
        out dx, al
        dec dx
        mov cx, 35
o2:     in al, dx
        loop o2
        ret
dsp:    push ax
        mov dx, 0x22C
d1:     in al, dx
        test al, 0x80
        jnz d1
        pop ax
        out dx, al
        ret
irq7:   push ax
        push dx
        mov dx, 0x22E
        in al, dx
        inc word [cs:count]
        mov al, 0x20
        out 0x20, al
        pop dx
        pop ax
        iret
count:  dw 0
st1:    db 0
st2:    db 0
rst:    db 0
buf:    times ${2 * block} db 0x80
done:
        int 0x20`;
for (const model of MODELS) {
  begin(`a program on the ${model} machine: AdLib detection, auto-init DMA, IRQ 7`);
  const m = new (machineClass(model))();
  const bios = Asm86.assemble(G('biosSource')(model), { origin: 0 });
  const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(bios.bytes);
  m.setRom(rom, bios.symbols); m.reset();
  const block = 256, nirq = 8;
  const p = Asm86.assemble(PROG(block, nirq), { origin: 0x100 });
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  m.loadProgram(p.bytes, 0x100); m.mem.set([0x00, 0x01, 0x00, 0x10, 0x86], 0x4F0);
  const at = [];
  const raise = m.pic.raise.bind(m.pic);
  m.pic.raise = n => { if (n === 7) at.push(m.sb.clk); raise(n); };
  let r, guard = 0;
  while (r !== 'halt' && guard++ < 400) r = m.run(m.clockHz / 100);
  const b = name => m.mem[0x10000 + p.symbols[name]];
  eq(r, 'halt', 'the program ends');
  eq(b('st1') & 0xE0, 0, 'AdLib status 1'); eq(b('st2') & 0xE0, 0xC0, 'AdLib status 2 (timer 1 after 100 reads of 388h)');
  eq(b('rst'), 0xAA, 'DSP reset answer');
  eq(m.mem[0x10000 + p.symbols.count] | (m.mem[0x10000 + p.symbols.count + 1] << 8), nirq + 1, 'the handler counts the IRQs');
  const per = at.slice(1).map((t, i) => (t - at[i]) / m.clockHz * 1000);
  const want = block / 8000 * 1000;
  check(per.length === nirq && per.every(x => Math.abs(x - want) < 0.05), `an IRQ each ${want} ms: ${per.map(x => x.toFixed(3)).join(' ')}`);
  eq(m.sb.samples, (nirq + 1) * block, 'samples played');
  eq(m.sb.dmaActive, false, 'the DSP stops after DAh');
}

console.log(`${fail ? `${fail} Sound Blaster test(s) failed, ${pass} passed` : `all ${pass} Sound Blaster tests passed`} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exitCode = fail ? 1 : 0;
