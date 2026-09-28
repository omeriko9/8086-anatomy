// The Node checker of the learner page (section 7.7 of the design, the part that needs no board):
// for each model a fresh vm context loads the cores, story.js and the learn files, then for every
// lesson: the program assembles, the boot reaches the hand-off state, runTo(from) reaches its
// target within the budget, every `at` selector matches a step (an unmatched `hide` warns), every
// stop and units key exists in LEARN_UNITS, every headline fills and is <= 80 characters with <= 2
// bold values, the details <= 220, no leftover template. The visit half of check 4 (a stop that no
// step visits) needs board3d.js and runs in Chrome (tools/learn-smoke.mjs).
// Usage: node tools/learn-check.mjs [--model M] [--lesson id] [--json out.json] [--steps]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MODELS = opt('--model', null) ? [opt('--model')] : ['8086', '80286', '80386', '80486', '80586', '80686'];
const ONLY = opt('--lesson', null), JSON_OUT = opt('--json', null), SHOW_STEPS = args.includes('--steps');

const CORE = ['src/asm/disasm.js', 'src/asm/assembler.js', 'src/core/fpu8087.js', 'src/core/cpu8086.js', 'src/core/cpu80286.js', 'src/core/cpu80386.js', 'src/core/cpu80486.js', 'src/core/cpu80586.js', 'src/core/cpu80686.js',
  'src/core/devices.js', 'src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js', 'src/core/vga.js', 'src/core/machine.js', 'src/core/devices286.js', 'src/core/machine286.js', 'src/core/machine386.js', 'src/core/machine486.js', 'src/core/machine586.js', 'src/core/machine686.js',
  'src/core/bios.js', 'src/core/vgabios.js'];
const UI = ['src/ui/theme.js', 'src/ui/story.js'];
const LEARN = ['src/learn/content.js', 'src/learn/terms.js', 'src/learn/plan.js', 'src/learn/lessons/programs-8086.js', 'src/learn/lessons/programs-later.js',
  'src/learn/lessons/l8086.js', 'src/learn/lessons/l8086-letter.js', 'src/learn/lessons/l80286.js', 'src/learn/lessons/l80386.js', 'src/learn/lessons/l80486.js', 'src/learn/lessons/l80586.js', 'src/learn/lessons/l80686.js',
  'src/learn/lessons/compare.js', 'src/learn/lessons/index.js', 'src/learn/playback.js'];

// One context per model: theme.js freezes CPU_MODEL at parse. The context gets the host globals the
// files need (performance for AnimClock, console, the text codecs) and stubs for the DOM and storage.
function makeContext(model) {
  const ctx = vm.createContext({
    performance, console, TextEncoder, TextDecoder, setTimeout, clearTimeout, Math, Date, JSON,
    localStorage: { getItem: k => (k === 'a86:cpu' ? JSON.stringify(model) : k === 'a86:video' ? '"cga"' : null), setItem() {}, removeItem() {} },
    document: { documentElement: { classList: { add() {} } }, createElement: () => ({ getContext: () => null, style: {} }), head: { appendChild() {} } },
    location: { search: '', protocol: 'file:' },
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  for (const f of [...CORE, ...UI, ...LEARN]) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) { if (!/lessons\/l\d/.test(f)) console.warn(`  (missing: ${f})`); continue; }
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  // (a top-level const of a script is not a property of the context: read it by name)
  return new Proxy({}, { get: (_, name) => { try { return vm.runInContext(String(name), ctx); } catch (e) { return undefined; } } });
}

let fails = 0, warns = 0;
const out = { models: {} };
const fail = (id, rule, msg) => { fails++; console.log(`FAIL ${id} [${rule}] ${msg}`); };
const warn = (id, rule, msg) => { warns++; console.log(`warn ${id} [${rule}] ${msg}`); };

for (const model of MODELS) {
  const t0 = performance.now();
  const G = makeContext(model);
  const lessons = (G.LEARN_LESSONS[model] || []).filter(l => !ONLY || l.id === ONLY);
  console.log(`\n== ${model}: ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} (loaded in ${(performance.now() - t0).toFixed(0)} ms)`);
  out.models[model] = { lessons: {} };
  if (!lessons.length) continue;
  const Cls = G[model === '80686' ? 'Machine686' : model === '80586' ? 'Machine586' : model === '80486' ? 'Machine486' : model === '80386' ? 'Machine386' : model === '80286' ? 'Machine286' : 'Machine'];
  for (const L of lessons) {
    const id = L.id, rec = out.models[model].lessons[id] = { beats: [], stories: [], from: null };
    // (1) the schema and the keys
    for (const f of G.LearnPlan.validate(L, G.LEARN_PROGRAMS, G.LEARN_UNITS)) fail(id, f.rule, f.msg);
    // (2) the program
    const machine = new Cls({ video: 'cga', soundCard: false, wasm: false, ...(L.options || {}) });
    const play = new G.Playback(machine, { model, traceRep: 'all', tracePre: (L.story || {}).prefetch, traceBurst: (L.story || {}).burst });
    play.buildRom({});
    const P = L.program || {};
    const src = P.program ? (G.LEARN_PROGRAMS[P.program] || {}).src : (G.SAMPLES.find(s => s.id === P.sample) || {}).src;
    if (!src) { fail(id, 'program', 'no program source'); continue; }
    const asm = play.assemble(src);
    if (!asm.ok) { fail(id, 'program', 'the program does not assemble: ' + asm.errors.map(e => `line ${e.line}: ${e.msg}`).join('; ')); continue; }
    play.load(asm);
    // (3) the boot and the run to the start
    const tb = performance.now();
    play.boot();
    const c = machine.cpu;
    if (c.sregs[1] !== 0x1000 || c.ip !== 0x100) fail(id, 'boot', `hand-off state CS:IP = ${c.sregs[1].toString(16)}:${c.ip.toString(16)}, want 1000:0100`);
    let from;
    try { from = play.runToSync(L.from || { instr: 0 }); } catch (e) { fail(id, 'boot', `runTo(from): ${e.message}`); continue; }
    rec.from = { instrs: from.instrs, clocks: from.clocks, ms: +(performance.now() - tb).toFixed(1) };
    console.log(`-- ${id}: boot + from = ${from.instrs} instructions, ${from.clocks} clocks (${rec.from.ms} ms in Node)`);
    if (from.clocks > 4000000) fail(id, 'boot', `from needs ${from.clocks} clocks (max 4 M)`);
    // (4) the beats: a dry pass
    let k = 0, clocks = 0, nBeats = 0;
    const seenTerms = new Set();
    const ctxOf = (step, cycles) => ({ machine, model, program: asm, step, clocks, cycles, n: k, compare: (G.LEARN_COMPARE || {})[id] });
    const checkCap = (beat, cap, step, cycles, where) => {
      if (!cap || typeof cap !== 'object') return;
      let h, d;
      try { h = G.LearnPlan.fill(cap.h || '', ctxOf(step, cycles)); d = G.LearnPlan.fill(cap.d || '', ctxOf(step, cycles)); } catch (e) { fail(id, '3.4', `${where}: ${e.message}`); return; }
      for (const f of G.LearnPlan.checkHeadline(h)) fail(id, '3.5.1', `${where}: ${f}: "${G.LearnPlan.plain(h)}"`);
      if (G.LearnPlan.plain(d).length > 220) fail(id, '3.5.2', `${where}: details ${G.LearnPlan.plain(d).length} characters (max 220)`);
      if (/0x/.test(h + d)) fail(id, '3.5.5', `${where}: 0x in a caption`);
      rec.beats.push({ kind: beat.kind, k, h: G.LearnPlan.plain(h), d: G.LearnPlan.plain(d), steps: beat.steps || [], keep: [...(beat.keep || [])] });
      nBeats++;
    };
    L.beats.forEach((b, bi) => {
      const where = `beat ${bi + 1}`;
      const kind = G.LearnPlan.kindOf(b);
      if (!kind) return;
      if (kind === 'step') {
        const count = typeof b.step === 'object' ? b.step.count || 1 : 1;
        for (let nth = 1; nth <= count; nth++) {
          if (!play.beginInstr(0, { enter: false })) { fail(id, 'beats', `${where}: beginInstr returned false (the CPU is halted or the engine folded)`); return; }
          const p = play.play, story = p.story;
          if (/^INTR\b/i.test(story.text)) warn(id, 'beats', `${where}: a hardware interrupt (${story.text}) arrived here; the player inserts an aside beat`);
          const compiled = G.LearnPlan.compileStep(b, k, story, nth);
          rec.stories.push({ k, text: story.text, cycles: p.cycles, steps: story.steps.map((s, i) => ({ i, kind: s.kind, title: s.title, phase: s.phase, I: s.I ? { kind: s.I.kind, dev: s.I.dev } : undefined, evs: (s.evs || []).map(e => e.k), sel: G.LearnPlan.select(s), sum: s.sum })) });
          if (SHOW_STEPS) { console.log(`   instr ${k}: ${story.text} (${p.cycles} clocks)`); story.steps.forEach((s, i) => console.log(`     ${i}: ${G.LearnPlan.select(s).slice(-1)[0]}  "${s.sum}"`)); }
          for (const cb of compiled) {
            if (cb.unmatched) { fail(id, '3.3', `${where}: the selector "${cb.unmatched}" matches no step of "${story.text}" (steps: ${story.steps.map(s => G.LearnPlan.select(s).slice(-1)[0]).join(', ')})`); continue; }
            const s = story.steps[cb.steps[cb.steps.length - 1]];
            play.dispatchUntil(s.t);
            const cap = cb.cap === 'story' ? G.LearnPlan.caption(s, 'story') : cb.cap === 'unit' ? null : cb.cap;
            checkCap(cb, cap, s, p.cycles, `${where} (${G.LearnPlan.select(s).slice(-1)[0]})`);
          }
          for (const h of b.hide || []) if (!story.steps.some(s => G.LearnPlan.match(h, s))) warn(id, '3.3', `${where}: hide "${h}" matches nothing`);
          // the show order against the story order
          const firsts = compiled.filter(x => !x.fold && x.steps.length).map(x => x.steps[0]);
          if (firsts.some((v, i) => i && v < firsts[i - 1])) warn(id, '3.2', `${where}: the show entries are not in story-step order`);
          play.finishInstr();
          clocks += p.cycles; k++;
        }
        if (b.repeat) { const t = b.repeat.times || 1; for (let r = 0; r < t; r++) { const text = play.lastTraced.text; play.runToSync((ip, m) => play.textAt(m) !== text || ip !== play.lastTraced.phys, 4000000); } }
      } else if (kind === 'run') {
        try { const r = play.runToSync(b.run.until, G.LN_PACE.dryPassClocks); rec.beats.push({ kind: 'run', k, instrs: r.instrs, clocks: r.clocks }); nBeats++; checkCap(G.LearnPlan.compileOther(b, k), b.cap, null, 0, where); } catch (e) { fail(id, 'run', `${where}: ${e.message}`); }
      } else if (kind === 'check') {
        const q = b.check;
        if (q.options && (q.answer < 0 || q.answer >= q.options.length)) fail(id, 'check', `${where}: the answer is out of range`);
        if (q.ask && q.ask.length > 80) fail(id, '6.4', `${where}: the question is over 80 characters`);
        for (const o of q.options || []) if (o.length > 40) fail(id, '6.4', `${where}: an answer is over 40 characters`);
        rec.beats.push({ kind: 'check', k }); nBeats++;
      } else {
        const cb = G.LearnPlan.compileOther(b, k);
        checkCap(cb, b.cap, null, 0, where);
      }
      for (const t of (b.terms || []).concat(...(b.show || []).map(x => x.terms || []))) { if (!G.LEARN_TERMS[t]) fail(id, '3.5.3', `${where}: term "${t}" is not in LEARN_TERMS`); seenTerms.add(t); }
    });
    for (const t of L.terms || []) if (!seenTerms.has(t)) warn(id, '3.5.3', `the lesson lists the term "${t}" but no beat introduces it`);
    // (5) the screen after a fast run to the end
    const P2 = P.program ? G.LEARN_PROGRAMS[P.program] : null;
    try { play.runToSync('halt', 8000000); } catch (e) { /* a program that never halts */ }
    const v = machine.vram(); let text = '';
    for (let r = 0; r < 25; r++) { let line = ''; for (let col = 0; col < 80; col++) line += String.fromCharCode(v[(r * 80 + col) * 2] || 32); text += line.replace(/\s+$/, '') + '\n'; }
    if (P2 && P2.expect && !P2.expect.test(text)) fail(id, 'screen', `the screen does not match ${P2.expect}`);
    rec.n = nBeats; rec.clocks = clocks;
    console.log(`   ${nBeats} compiled beats, ${k} instructions traced, ${clocks} clocks`);
  }
}
if (JSON_OUT) { fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true }); fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1)); console.log(`wrote ${JSON_OUT}`); }
console.log(`\n${fails} failure${fails === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`);
process.exit(fails ? 1 : 0);
