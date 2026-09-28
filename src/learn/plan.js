// LearnPlan: the pure part of the lesson player (section 7.5 of the design). It reads a lesson
// (section 3.2), matches selectors against Story steps (3.3), compiles beats, fills the templates
// of a caption (3.4) and holds the pacing constants (5.1). No DOM, no machine of its own: Node
// loads it for the checker; the ctx objects carry the machine and the play state.

// The pacing constants (section 5.1). Every number a beat's time depends on is here.
const LN_PACE = {
  readBase: 600, readPerChar: 45,      // headline read time: 600 + 45 per character
  detailPerChar: 25,                   // the details, only while they are open
  settle: 400,                         // after the animation ends, before Auto may advance
  minBeat: 1500, maxBeat: 6000,        // Auto: a beat is never shorter or longer
  animTarget: 4000, animCap: 6000,     // a step's plan over animCap fails the checker
  moveMs: 1100, flyMs: 1300, cutMs: 360,
  quickMs: 650, stepMs: 1700,          // the two ms values passed to traceDur
  dieAnimMs: 1700,                     // die mode: a step beat's anim = min(ms, dieAnimMs)
  xpTime: { travel: 1.3, work: 0.33, read: 0.2, pass: 0.25, cut: 0.5 },
  doubleNext: 250, autoKeyMs: 8000, foldWallMs: 1500, backBudgetMs: 300,
  sliceMs: 12, sliceInstrs: 200000,
  dryPassClocks: 4000000,              // the budget of one fold of the dry pass and of runTo
  speeds: { normal: 1, slower: 1.4 },
};

const LearnPlan = (() => {
  const H = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
  const plain = html => String(html || '').replace(/<[^>]+>/g, '');
  const NUM_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  // ---------- selectors (3.3) ----------
  // The parts of a step that a selector names: [kind, sub, tail1, tail2]; tails may be several.
  function parts(s) {
    const k = s.kind;
    if (k === 'inside') return { kind: k, sub: s.title || '', tails: [(s.evs || []).map(e => e.k)] };
    if (k === 'bus') return { kind: k, sub: s.I ? s.I.kind : '', tails: [[s.I ? s.I.dev : ''], [s.phase || '']] };
    if (k === 'cache') {
      const e = s.e || {}, sub = e.level === 'L2' ? 'l2' : (e.cache || 'unified');
      const t = String(s.title || '').toLowerCase();
      const tail = /line fill/.test(t) ? 'fill' : /write/.test(t) ? 'write' : /hit/.test(t) ? 'hit' : 'miss';
      return { kind: k, sub, tails: [[tail]] };
    }
    if (k === 'page') return { kind: k, sub: /fault/i.test(s.title || '') ? 'fault' : 'walk', tails: [] };
    if (k === 'btb') return { kind: k, sub: '', tails: [] };
    return { kind: k, sub: String(s.title || '').split(/\s/)[0].toLowerCase(), tails: [] };
  }
  const eq = (want, have) => want === undefined || want === '' || want === '*' || String(want).toLowerCase() === String(have).toLowerCase();
  // Does the selector name this step? '*' and a missing tail match all.
  function match(sel, s) {
    const p = String(sel).split(':'), P = parts(s);
    if (!eq(p[0], P.kind)) return false;
    if (!eq(p[1], P.sub)) return false;
    for (let i = 0; i < P.tails.length; i++) {
      const want = p[2 + i];
      if (want === undefined || want === '' || want === '*') continue;
      if (!P.tails[i].some(x => eq(want, x))) return false;
    }
    if (p.length > 2 + P.tails.length) return false;
    return true;
  }
  // Every full selector the step matches (for the checker's --json dump), most specific last.
  function select(s) {
    const P = parts(s), out = [P.kind];
    if (P.sub) out.push(`${P.kind}:${P.sub}`);
    if (P.kind === 'inside') for (const t of P.tails[0]) out.push(`${P.kind}:${P.sub}:${t}`);
    else if (P.kind === 'bus') { out.push(`${P.kind}:${P.sub}:${P.tails[0][0]}`); out.push(`${P.kind}:${P.sub}:${P.tails[0][0]}:${P.tails[1][0]}`); }
    else if (P.tails.length) out.push(`${P.kind}:${P.sub}:${P.tails[0][0]}`);
    return [...new Set(out)];
  }

  // ---------- captions (3.4) ----------
  // The rewrite filters of a story text: no µop ids, no absolute clocks, an 8-bit register write
  // names the 8-bit register.
  function filterStory(text, s) {
    let cap = String(text || '');
    cap = cap.replace(/µop \d+ /g, 'a µop ').replace(/(^|\. )a µop/g, '$1A µop')
      .replace(/ at clock (\d+); its result is ready at (\d+)/g, (m, c0, c1) => `; its result is ready ${c1 - c0} clock${c1 - c0 === 1 ? '' : 's'} later`)
      .replace(/ \(clock (\d+) to (\d+)\)/g, (m, c0, c1) => ` (${c1 - c0} clocks)`).replace(/ at clock \d+/g, '');
    // an 8-bit register write: the 8086 core says "AX gets 00C8h" for mov al, 200
    const dec = s && s.evs && s.evs.find(e => e.k === 'decode');
    const m8 = dec && /^mov\s+([abcd][lh])\b/i.exec(String(dec.text || '').split(';')[0].trim());
    if (m8) {
      const r8 = m8[1].toUpperCase(), r16 = r8[0] + 'X';
      cap = cap.replace(new RegExp(`\\b${r16} gets ([0-9A-F]{4})h`), (m, v) => `${r8} gets ${r8[1] === 'L' ? v.slice(2) : v.slice(0, 2)}h`);
    }
    return cap;
  }
  // { h, d } of a story step in the story's own words ('story'), or the unit's sentence ('unit').
  function caption(s, mode, unitText) {
    if (mode === 'unit' && unitText) return { h: unitText.text || unitText.unit || '', d: '' };
    const text = filterStory(s.text, s);
    const [lead, rest] = typeof splitLead === 'function' ? splitLead(text) : [text, ''];
    const h = s.sum && !/^(prefetch|data|address|port|MRDC|MWTC|IORC|IOWC|INTA|status)/.test(s.sum) ? s.sum.charAt(0).toUpperCase() + s.sum.slice(1) + '.' : lead;
    return { h, d: h === lead ? rest : text };
  }

  // ---------- templates (3.4) ----------
  // ctx: { machine, model, program (the assembled program), step, story, clocks (the sum so far),
  //        cycles (this instruction), n (instructions traced), compare (LEARN_COMPARE row) }
  function regVal(m, name) {
    const c = m.cpu, R = name.toUpperCase();
    const i16 = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 }, segs = { ES: 0, CS: 1, SS: 2, DS: 3, FS: 4, GS: 5 };
    if (R in i16) return { v: c.regs[i16[R]] & 0xFFFF, n: 4 };
    if (R.startsWith('E') && R.slice(1) in i16) { const r32 = c.regs32 ? c.regs32[i16[R.slice(1)]] >>> 0 : c.regs[i16[R.slice(1)]] & 0xFFFF; return { v: r32, n: 8 }; }
    if (R in segs) return { v: c.sregs[segs[R]] & 0xFFFF, n: 4 };
    const h8 = { AL: [0, 0], AH: [0, 8], CL: [1, 0], CH: [1, 8], DL: [2, 0], DH: [2, 8], BL: [3, 0], BH: [3, 8] };
    if (R in h8) return { v: (c.regs[h8[R][0]] >> h8[R][1]) & 0xFF, n: 2 };
    if (R === 'IP') return { v: c.ip & 0xFFFF, n: 4 };
    if (R === 'FLAGS') return { v: c.f & 0xFFFF, n: 4 };
    return null;
  }
  const FLAG_BIT = { CF: 0, PF: 2, AF: 4, ZF: 6, SF: 7, TF: 8, IF: 9, DF: 10, OF: 11 };
  function fmtUs(clocks, hz) {
    const us = clocks / (hz / 1e6);
    return us < 1 ? `${(us * 1000).toFixed(0)} ns` : `${us.toFixed(1)} µs`;
  }
  function mhzOf(m) { return +((m.clockHz || 4772727) / 1e6).toFixed(2); }
  function fill(text, ctx) {
    return String(text || '').replace(/\{([^{}]+)\}/g, (all, key) => {
      const v = template(key.trim(), ctx);
      if (v === undefined || v === null) throw new Error(`unfilled template {${key}}`);
      return String(v);
    });
  }
  function template(key, ctx) {
    const m = ctx.machine, s = ctx.step, [k, a, b, c] = key.split(':');
    switch (k) {
      case 'reg': { const r = m && regVal(m, a); return r ? H(r.v, r.n) + 'h' : undefined; }
      case 'flag': { const bit = FLAG_BIT[String(a).toUpperCase()]; return m && bit !== undefined ? (m.cpu.f >> bit) & 1 : undefined; }
      case 'mem': {
        if (!m) return undefined;
        const phys = ((parseInt(a, 16) << 4) + parseInt(b, 16)) & 0xFFFFF;
        return c === 'w' ? H(m.peek8(phys) | (m.peek8(phys + 1) << 8), 4) + 'h' : H(m.peek8(phys), 2) + 'h';
      }
      case 'ip': return m ? H(m.cpu.ip, 4) + 'h' : undefined;
      case 'addr': {
        // a bus step: the address of the cycle; an inside step: the address its ea event computed
        if (s && s.I) return H(s.I.addr, ctx.model === '8086' ? 5 : 6) + 'h';
        const ea = s && s.evs && s.evs.find(e => e.k === 'ea');
        return ea ? H(ea.phys, ctx.model === '8086' ? 5 : 6) + 'h' : undefined;
      }
      case 'data': {
        if (s && s.I) return H(s.I.data, 2 * Math.min(4, s.I.width || 1)) + 'h';
        const rg = s && s.evs && [...s.evs].reverse().find(e => e.k === 'reg' && e.r !== 'IP' && e.r !== 'EIP');
        return rg ? H(rg.v, 4) + 'h' : undefined;
      }
      case 'token': return s && s.token ? s.token.val : undefined;
      case 'cycles': return ctx.cycles;
      case 'clocks': return ctx.clocks;
      case 'us': return m ? fmtUs(ctx.clocks || 0, m.clockHz) : undefined;
      case 'mhz': return m ? mhzOf(m) : undefined;
      case 'n': return ctx.n;
      case 'nwords': return NUM_WORD[ctx.n] || String(ctx.n);
      case 'bytes': return ctx.program ? ctx.program.bytes.length : undefined;
      case 'origin': return ctx.program ? H(0x10000 + ctx.program.origin, 5) + 'h' : undefined;
      case 'screen': { if (!m) return undefined; const v = m.vram(); return H(v[(+a || 0) * 2], 2) + 'h'; }
      case 'dev': return s && s.I && typeof Story !== 'undefined' ? Story.devName(s.I) : undefined;
      case 'part': return ctx.names && ctx.names[a] !== undefined ? ctx.names[a] : undefined;
      case 'cmp': { const row = ctx.compare && ctx.compare[a]; return row ? row[b] : undefined; }
      default: return undefined;
    }
  }

  // ---------- the order of the steps (the port of explain3d's plan) ----------
  // Story order, with one change: this instruction's own code fetches (prefetch 'full'/'short')
  // come before the Decode. Under 'parallel' there are no fetch steps, so the order is the story's.
  function order(steps, o = {}) {
    const a0 = o.a0, a1 = o.a1, out = [];
    const own = [], rest = [];
    steps.forEach((s, i) => {
      const f = s.kind === 'bus' && s.I && s.I.kind === 'fetch' && a0 !== undefined && s.I.addr < a1 && s.I.addr + (s.I.width || 1) > a0;
      (f ? own : rest).push({ i, quick: false });
    });
    const di = rest.findIndex(x => steps[x.i].kind === 'inside' && steps[x.i].title === 'Decode');
    if (di < 0) return rest.concat(own);
    out.push(...rest.slice(0, di), ...own, ...rest.slice(di));
    return out;
  }

  // ---------- compile (7.5) ----------
  // A step beat of a lesson and the story of one instruction -> the compiled beats of that
  // instruction, in story-step order. Each: { kind: 'step', src, k, steps: [i...], quick, keep,
  // cap, terms, hidden: [i...] }.  nth: the position of this instruction in a `count` (1-based).
  function compileStep(beat, k, story, nth = 1) {
    const steps = story.steps, out = [];
    const show = (beat.show || []).filter(x => !x.nth || x.nth === nth);
    const hide = beat.hide || [];
    const used = new Set(), byShow = show.map(() => []);
    steps.forEach((s, i) => {
      show.forEach((x, j) => { if (!used.has(i) && match(x.at, s)) { byShow[j].push(i); used.add(i); } });
    });
    const hidden = [];
    steps.forEach((s, i) => { if (!used.has(i) && hide.some(h => match(h, s))) { hidden.push(i); used.add(i); } });
    const keepOf = x => new Set([].concat(x.stop || []));
    show.forEach((x, j) => {
      const idx = byShow[j];
      if (!idx.length) { out.push({ kind: 'step', src: x, k, steps: [], unmatched: x.at }); return; }
      // the steps of one bus cycle under one caption chain; other matches are one beat each
      const groups = [];
      for (const i of idx) {
        const s = steps[i], g = groups[groups.length - 1];
        if (g && s.kind === 'bus' && steps[g[0]].kind === 'bus' && steps[g[0]].e === s.e) g.push(i); else groups.push([i]);
      }
      for (const g of groups) out.push({ kind: 'step', src: x, k, steps: g, quick: !!x.quick || g.length > 1, keep: keepOf(x), cap: x.cap, terms: x.terms || [] });
    });
    const rest = [];
    steps.forEach((s, i) => { if (!used.has(i)) rest.push(i); });
    const mode = beat.rest || 'fold';
    if (rest.length && mode === 'fold') out.push({ kind: 'step', src: beat, k, steps: rest, quick: true, keep: new Set(), cap: beat.cap || 'story', terms: [], fold: true });
    else if (rest.length && mode === 'show') for (const i of rest) out.push({ kind: 'step', src: beat, k, steps: [i], quick: false, keep: new Set(), cap: 'story', terms: [] });
    else if (rest.length) hidden.push(...rest);
    out.sort((a, b) => (a.steps[0] === undefined ? 1e9 : a.steps[0]) - (b.steps[0] === undefined ? 1e9 : b.steps[0]));
    for (const o of out) { o.hidden = hidden; o.plain = beat.plain || []; }
    return out;
  }
  // A non-step beat -> one compiled beat. k: the instructions executed before it.
  function compileOther(beat, k) {
    const kind = beat.look !== undefined ? 'look' : beat.say ? 'say' : beat.run ? 'run' : beat.wait ? 'wait' : beat.screen ? 'screen' : beat.check ? 'check' : null;
    if (!kind) return null;
    const b = { kind, src: beat, k, steps: [], quick: false, keep: new Set(), cap: beat.cap || null, terms: beat.terms || [], plain: beat.plain || [] };
    if (kind === 'look') { b.focus = typeof beat.look === 'string' ? [beat.look] : beat.look.slice(); b.labels = beat.labels || b.focus.slice(0, 3); b.cam = beat.cam || null; b.hold = !!beat.hold; }
    if (kind === 'say') { b.focus = beat.focus || null; b.cam = beat.cam || null; b.hold = !!beat.hold; }
    if (kind === 'run') { b.until = beat.run.until; b.into = !!beat.into; }
    if (kind === 'wait') { b.keys = beat.keys || ['k']; }
    if (kind === 'check') { b.check = beat.check; }
    return b;
  }
  // Which kind a beat is; two kinds is a schema error.
  function kindOf(beat) {
    const ks = ['look', 'say', 'step', 'run', 'wait', 'screen', 'check'].filter(k => beat[k] !== undefined && beat[k] !== false);
    return ks.length === 1 ? ks[0] : null;
  }

  // ---------- validate (interface 3) ----------
  function validate(lesson, programs, units) {
    const F = [], bad = (rule, msg) => F.push({ rule, msg, lesson: lesson && lesson.id });
    if (!lesson) return [{ rule: 'schema', msg: 'no lesson' }];
    if (!/^\d{4,5}-\d\d-[a-z0-9]+$/.test(lesson.id || '')) bad('schema', `id "${lesson.id}" does not match /^\\d{4,5}-\\d\\d-[a-z0-9]+$/`);
    if (!lesson.title || lesson.title.length > 40) bad('schema', 'title missing or over 40 characters');
    if (!lesson.idea || lesson.idea.length > 160) bad('schema', 'idea missing or over 160 characters');
    const maxTerms = lesson.n === 1 && lesson.machine === '8086' ? 6 : 3;
    if ((lesson.terms || []).length > maxTerms) bad('3.5.3', `${lesson.terms.length} terms, at most ${maxTerms}`);
    if (typeof LEARN_TERMS !== 'undefined') for (const t of lesson.terms || []) if (!LEARN_TERMS[t]) bad('3.5.3', `term "${t}" is not in LEARN_TERMS`);
    const p = lesson.program || {};
    if (p.program && programs && !programs[p.program]) bad('program', `program key "${p.program}" is not in LEARN_PROGRAMS`);
    if (p.sample && typeof SAMPLES !== 'undefined' && !SAMPLES.some(s => s.id === p.sample)) bad('program', `sample "${p.sample}" does not exist`);
    if (!p.program && !p.sample) bad('program', 'program: { program } or { sample } is required');
    for (const u of lesson.units || []) if (units && !units[u]) bad('units', `unit key "${u}" is not in LEARN_UNITS`);
    (lesson.beats || []).forEach((b, i) => {
      if (!kindOf(b)) bad('schema', `beat ${i + 1}: exactly one of look/say/step/run/wait/screen/check`);
      for (const x of b.show || []) {
        for (const st of [].concat(x.stop || [])) {
          if (units && !units[st]) bad('units', `beat ${i + 1}: stop "${st}" is not in LEARN_UNITS`);
          if (lesson.units && !lesson.units.includes(st)) bad('units', `beat ${i + 1}: stop "${st}" is not in the lesson's units`);
        }
        if (!x.at) bad('schema', `beat ${i + 1}: a show entry needs an at selector`);
      }
      const cap = b.cap;
      if (cap && typeof cap === 'object') {
        if (cap.h && plain(cap.h).length > 80 && !/\{/.test(cap.h)) bad('3.5.1', `beat ${i + 1}: headline over 80 characters`);
        if (cap.d && plain(cap.d).length > 220) bad('3.5.2', `beat ${i + 1}: details over 220 characters`);
        if (/0x/.test(String(cap.h) + String(cap.d))) bad('3.5.5', `beat ${i + 1}: 0x in a caption`);
      }
      if (b.check && b.check.options && (b.check.answer < 0 || b.check.answer >= b.check.options.length)) bad('check', `beat ${i + 1}: answer out of range`);
    });
    return F;
  }
  // The checks on a filled headline (3.5.1, 3.5.5): length, bold count, leftover templates.
  function checkHeadline(h) {
    const t = plain(h), F = [];
    if (t.length > 80) F.push(`headline ${t.length} characters (max 80)`);
    if ((h.match(/<b>/g) || []).length > 2) F.push('more than two bold values');
    if (/\{/.test(h)) F.push('unfilled template');
    if (/^(Now|Then)\b/.test(t)) F.push('starts with Now or Then');
    if (/:$/.test(t.trim())) F.push('ends with a colon');
    return F;
  }

  // ---------- reading time (5.1) ----------
  function readMs(cap, opened) {
    const h = plain(cap && cap.h), d = plain(cap && cap.d);
    let ms = LN_PACE.readBase + LN_PACE.readPerChar * h.length;
    if (opened && d) ms += LN_PACE.detailPerChar * d.length;
    return ms;
  }
  // Auto: a beat's time from its animation and its reading time.
  function beatMs(anim, cap, opened) {
    const v = Math.max(anim || 0, readMs(cap, opened)) + LN_PACE.settle;
    return Math.min(LN_PACE.maxBeat, Math.max(LN_PACE.minBeat, v));
  }

  return { parts, match, select, caption, filterStory, fill, template, order, compileStep, compileOther, kindOf, validate, checkHeadline, readMs, beatMs, plain, regVal, fmtUs, mhzOf };
})();
