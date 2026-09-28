// Speed of the real app loop in fast mode (the views draw too), for each tab.
// Usage: node tools/p6bench.mjs [--file page.html] [--model 80686] [--secs 4] [--tabs die,board] [--prog p6|p5|none] [--prof]
// It starts the page, lets the BIOS start, loads the program, presses Run at the top speed
// and measures the CPU clocks and the instructions each second of real time.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const file = opt('--file', path.join(root, 'dist', '8086-anatomy.html'));
const secs = +opt('--secs', 4), model = opt('--model', '80686');
const pg = opt('--prog', 'p6');
const src = pg === 'p6' || pg === 'p5'
  ? fs.readFileSync(path.join(root, 'tools', pg + 'shot.mjs'), 'utf8').match(pg === 'p6' ? /const P6_PROG = String\.raw`([\s\S]*?)\n`;/ : /const P5_PROG = String\.raw`([\s\S]*?)\n`;/)[1] + '\n'
  : null;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: args.includes('--gpu') ? ['--allow-file-access-from-files', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const tab of opt('--tabs', 'die,board').split(',')) {
  const page = await browser.newPage();
  let errors = 0;
  page.on('pageerror', e => { errors++; console.log('[pageerror]', e.message); });
  await page.setViewport({ width: 1440, height: 900 });
  const set = { cpu: model, tab, trace: false, speedPos: 90, speedSet: true };
  if (src) { set.src = src; set.sample = 'custom'; }
  await page.evaluateOnNewDocument(s => { localStorage.clear(); for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, set);
  await page.goto(pathToFileURL(file).href);
  await sleep(2500);
  await page.click('#btn-run');
  await sleep(1500);
  const prof = args.includes('--prof') ? await page.target().createCDPSession() : null;
  if (prof) { await prof.send('Profiler.enable'); await prof.send('Profiler.setSamplingInterval', { interval: 500 }); await prof.send('Profiler.start'); }
  const r = await page.evaluate(async secs => {
    const c = window.__app.machine.cpu, c0 = c.cycles, i0 = c.instructions, t0 = performance.now();
    await new Promise(r => setTimeout(r, secs * 1000));
    const dt = (performance.now() - t0) / 1000;
    return { mhz: (c.cycles - c0) / dt / 1e6, mips: (c.instructions - i0) / dt / 1e6 };
  }, secs);
  if (prof) {
    const { profile } = await prof.send('Profiler.stop');
    // the self time of each function (the samples of its nodes), the top 25
    const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
    const dt = new Map();
    profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[i] || 0)));
    for (const [id, t] of dt) { const n = byId.get(id), f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.lineNumber}`; self.set(k, (self.get(k) || 0) + t); }
    const tot = [...self.values()].reduce((a, b) => a + b, 0);
    console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, t]) => `  ${(t / tot * 100).toFixed(1).padStart(5)} %  ${k}`).join('\n'));
  }
  await page.click('#btn-run');
  console.log(`${model} ${tab.padEnd(7)} ${r.mhz.toFixed(2)} MHz of CPU clocks, ${r.mips.toFixed(2)} M instr/s${errors ? ` (${errors} errors)` : ''}`);
  await page.close();
}
await browser.close();
