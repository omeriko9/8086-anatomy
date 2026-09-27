// Small sound effects for all views: quiet short tones when a signal arrives, a step
// starts, or a part gets into place. Synthesized with Web Audio (no files, no noise). The audio
// context starts only after a user gesture; the "Effects" switch turns them on or off
// (storage 'sfx', on by default). All calls do nothing when the effects are off.

const Sfx = (() => {
  let ctx = null, master = null;
  let want = storage.get('sfx', true) !== false;
  const last = {};
  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -26; comp.ratio.value = 4;
      master = ctx.createGain(); master.gain.value = 0.6;
      master.connect(comp); comp.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }
  function gesture() {
    if (!want) return;
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  // The first click or key on the page may start the audio.
  if (typeof document !== 'undefined') {
    for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, gesture, { capture: true, passive: true });
  }
  const live = () => want && ctx && ctx.state === 'running' && !document.hidden;
  function limited(key, ms) {
    const n = performance.now();
    if (n - (last[key] || 0) < ms) return true;
    last[key] = n;
    return false;
  }
  function blip(freq, dur = 0.07, type = 'sine', vol = 0.03, delay = 0, drop = 0.92) {
    if (!live()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * drop, t + dur);
    f.type = 'lowpass'; f.frequency.value = 3000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const PITCH = { addr: 880, data: 660, ctrl: 990, fpu: 740, eu: 1175, irq: 523 };
  return {
    get on() { return want; },
    set(on) { want = !!on; storage.set('sfx', want); if (want) gesture(); },
    gesture,
    // a crisp tick: a part gets into place (k from 0.5 to 2 changes the pitch)
    tick(k = 1, vol = 0.02) { if (limited('tick', 35)) return; blip(1500 * k, 0.028, 'sine', vol); },
    // a soft click at the start of a trace step
    step() { if (limited('step', 60)) return; blip(880, 0.035, 'sine', 0.016); },
    // a signal arrives at a chip; the pitch tells the kind (address, data, control, ...)
    arrive(kind) { if (limited('arrive', 70)) return; const f = PITCH[kind] || 700; blip(f, 0.07, 'sine', 0.03); blip(f * 1.5, 0.06, 'sine', 0.018, 0.045); },
    // the camera goes into a chip / comes out of it
    enter() { if (limited('enter', 150)) return; blip(660, 0.07, 'sine', 0.022, 0, 0.8); blip(990, 0.06, 'sine', 0.014, 0.05); },
    leave() { if (limited('leave', 150)) return; blip(990, 0.06, 'sine', 0.016, 0, 0.8); blip(660, 0.07, 'sine', 0.012, 0.05); },
    // one clock edge in the bus timing view
    edge(high) { if (limited('edge', 25)) return; blip(high ? 2100 : 1700, 0.018, 'sine', 0.012); },
    // a small UI selection sound
    select() { if (limited('sel', 60)) return; blip(1320, 0.04, 'sine', 0.018); },
    // a memory cell or a register gets a new value
    write() { if (limited('write', 45)) return; blip(740, 0.045, 'sine', 0.02); },
  };
})();
