// Sound hooks: count the Sfx calls of the Die and Memory views at slow and fast playback.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const model = process.argv[2] || '8086';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage();
let errors = 0;
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } });
page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(m => {
  localStorage.setItem('a86:cpu', JSON.stringify(m)); localStorage.setItem('a86:trace', 'false'); localStorage.setItem('a86:sfx', 'true');
  // a fake audio context that records the frequency of each oscillator (the kind of sound)
  window.__osc = [];
  const P = () => ({ value: 0, setValueAtTime(v) { this.value = v; return this; }, exponentialRampToValueAtTime() { return this; } });
  const node = () => ({ connect() {}, start() {}, stop() {}, gain: P(), frequency: P(), threshold: P(), ratio: P() });
  class FakeAC {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createDynamicsCompressor() { return node(); }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; }
    createOscillator() { const o = node(); o.frequency.setValueAtTime = function (v) { window.__osc.push(Math.round(v)); return this; }; return o; }
  }
  window.AudioContext = FakeAC; window.webkitAudioContext = FakeAC;
}, model);
await page.goto(pathToFileURL(path.join(here, '..', '..', 'dist', '8086-anatomy.html')).href);
await sleep(2500);
const r = await page.evaluate(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));   // the user gesture starts the audio
  const n = {};
  const count = () => { const c = { tick: 0, write: 0, select: 0, other: 0 }; for (const f of window.__osc) { if (f >= 700 && f <= 3000 && f !== 1320) c.tick++; else if (f === 560) c.write++; else if (f === 1320) c.select++; else c.other++; } return c; };
  const res = {};
  const run = async (tab, clockMs) => {
    window.__osc.length = 0;
    __app.selectTab(tab);
    await new Promise(r => setTimeout(r, 200));
    const m = __app.machine, v = __app.views[tab];
    for (let i = 0; i < 12; i++) {
      const { cycles, events } = m.step();
      v.instr(events, { cycles, clockMs, text: '', cs: m.cpu.sregs[1], ip: m.cpu.ip });
      for (const e of events) v.event(e, clockMs);
      await new Promise(r => setTimeout(r, 30));
    }
    return count();
  };
  res.dieSlow = await run('die', 200);
  res.dieFast = await run('die', 20);
  res.memSlow = await run('memory', 200);
  res.memFast = await run('memory', 20);
  // a write and a read in the visible hex window, then one outside it
  __app.selectTab('memory');
  await new Promise(r => setTimeout(r, 200));
  const mv = __app.views.memory;
  window.__osc.length = 0;
  mv.event({ k: 'bus', t: 0, type: 'memw', addr: mv.base + 5, data: 0x12, width: 1, seg: 'DS', dev: 'ram', owner: 'cpu' }, 200);
  await new Promise(r => setTimeout(r, 80));
  mv.event({ k: 'bus', t: 0, type: 'memr', addr: mv.base + 6, data: 0x12, width: 1, seg: 'DS', dev: 'ram', owner: 'cpu' }, 200);
  await new Promise(r => setTimeout(r, 80));
  mv.event({ k: 'bus', t: 0, type: 'memw', addr: (mv.base + 0x4000) & 0xFFFFF, data: 0x12, width: 1, seg: 'DS', dev: 'ram', owner: 'cpu' }, 200);
  res.memWin = count();
  // hidden view: no sound
  __app.selectTab('board');
  window.__osc.length = 0;
  const m = __app.machine, v = __app.views.die;
  const { cycles, events } = m.step();
  v.instr(events, { cycles, clockMs: 400, text: '', cs: 0, ip: 0 });
  for (const e of events) v.event(e, 400);
  res.dieHidden = count();
  __app.selectTab('die');
  await new Promise(r => setTimeout(r, 200));
  window.__osc.length = 0;
  v.select('alu', v.els.blocks.alu);
  res.click = count();
  return res;
});
console.log(model, JSON.stringify(r));
console.log('errors', errors);
await browser.close();
