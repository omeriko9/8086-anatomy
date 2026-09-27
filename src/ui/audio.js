// PC speaker through Web Audio: a square wave at the 8253 channel 2 frequency.
// The context starts only after a user gesture; the mute toggle is in the top bar.
// The Sound Blaster (m.takeSound()) plays only at the real-time speed, like the sampled
// speaker: at other speeds the app takes the samples and does not play them.

class SpeakerAudio {
  constructor() {
    this.ctx = null; this.osc = null; this.gain = null;
    this.enabled = storage.get('sound', false);
    this.hz = 0;
  }
  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();   // soften the square wave like a small cone
      filter.type = 'lowpass'; filter.frequency.value = 3200;
      this.gain.connect(filter); filter.connect(this.ctx.destination);
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'square';
      this.osc.frequency.value = 440;
      this.osc.connect(this.gain);
      this.osc.start();
    } catch (e) { this.ctx = null; return false; }
    return true;
  }
  setEnabled(on) {
    this.enabled = on;
    storage.set('sound', on);
    if (on && this.ensure() && this.ctx.state === 'suspended') this.ctx.resume();
    this.apply();
  }
  setTone(hz) { this.hz = hz; this.apply(); }
  // The sample rate that the machine must use for m.takeSound()
  get rate() { return this.ctx ? this.ctx.sampleRate : 44100; }
  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.enabled && this.hz > 20 && this.hz < 20000;
    if (on) this.osc.frequency.setTargetAtTime(this.hz, t, 0.002);
    this.gain.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.008);
    // mute: also the sampled speaker and the sound card chunks that wait to play
    if (this.pcmGain) this.pcmGain.gain.setTargetAtTime(this.enabled ? 0.22 : 0, t, 0.008);
    if (this.cardGain) this.cardGain.gain.setTargetAtTime(this.enabled ? 0.7 : 0, t, 0.008);
  }
  // Sound Blaster audio for real-time speed: snd = { rate, samples } from m.takeSound().
  // Each chunk plays right after the last one, about 60 ms after the audio clock. When
  // the chunks come late, the next chunk starts again 50 ms ahead with a short fade-in;
  // when they are more than 300 ms ahead, the chunk is dropped (no long delay).
  card(snd) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running' || !snd) return;
    const s = snd.samples, n = s.length;
    if (!n) return;
    if (!this.cardGain) {
      this.cardGain = this.ctx.createGain();
      this.cardGain.gain.value = 0.7;
      this.cardGain.connect(this.ctx.destination);
      this.cardAt = 0;
    }
    const now = this.ctx.currentTime, dur = n / snd.rate;
    let quiet = true;
    for (let i = 0; i < n; i += 7) if (s[i] > 1e-4 || s[i] < -1e-4) { quiet = false; break; }
    if (quiet) { if (this.cardAt >= now + 0.01) this.cardAt += dur; return; }
    let fade = false;
    if (this.cardAt < now + 0.01) { this.cardAt = now + 0.05; fade = true; }
    else if (this.cardAt > now + 0.3) return;
    const buf = this.ctx.createBuffer(1, n, snd.rate), out = buf.getChannelData(0);
    out.set(s);
    if (fade) for (let i = 0, k = Math.min(n, 96); i < k; i++) out[i] *= i / k;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.cardGain);
    src.start(this.cardAt);
    this.cardAt += dur;
  }
  // Sampled speaker for real-time speed: the speaker input is (port 61h bit 1) AND
  // (8253 OUT2, or high when gate 2 is off). c0..c1 are CPU clocks of this frame.
  pcm(sp, c0, c1, hz = CPU_HZ) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running' || c1 <= c0) return;
    const rate = this.ctx.sampleRate;
    const n = Math.min(Math.round((c1 - c0) / hz * rate), rate);
    const pitClk = hz / 1193182;              // CPU clocks per 8253/8254 input clock
    if (n <= 0) return;
    if (!this.pcmGain) {
      this.pcmGain = this.ctx.createGain();
      this.pcmGain.gain.value = 0.22;
      this.pcmGain.connect(this.ctx.destination);
      this.px = 0; this.py = 0; this.cursor = 0;
    }
    const log = sp.log;
    let st = sp.prev, li = 0;
    const level = (s, c) => {
      if (!s.bit1) return 0;
      if (s.gate && s.armed && s.mode === 3) {
        const P = s.reload * pitClk, ph = ((c - s.phase0) % P + P) % P;
        return ph < P / 2 ? 1 : 0;
      }
      return 1;
    };
    const buf = this.ctx.createBuffer(1, n, rate), out = buf.getChannelData(0);
    const cps = (c1 - c0) / n, OS = 8;
    let loud = false;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = 0; k < OS; k++) {
        const c = c0 + (i + (k + 0.5) / OS) * cps;
        while (li < log.length && log[li].c <= c) st = log[li++];
        acc += level(st, c);
      }
      const x = acc / OS;
      const y = x - this.px + 0.995 * this.py;       // DC blocker: the cone only moves on changes
      this.px = x; this.py = y;
      out[i] = y;
      if (y > 0.01 || y < -0.01) loud = true;
    }
    if (!loud) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.pcmGain);
    const now = this.ctx.currentTime;
    if (this.cursor < now + 0.02 || this.cursor > now + 0.35) this.cursor = now + 0.06;
    src.start(this.cursor);
    this.cursor += buf.duration;
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.enabled) this.ctx.resume(); }
}
