// Speed of the machine in Chrome, in the real page: the page starts (BIOS and all), then the
// benchmark program tests/asm286/bench.bin runs under Machine.run for some seconds.
// Usage: node tools/pagebench.mjs [seconds] [model ...] [--prof out]   (out.<model>.cpuprofile)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const secs = +(process.argv[2] || 3);
const pos = process.argv.slice(3).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));
const models = pos.length ? pos : ['8086', '80286', '80386', '80486', '80586', '80686'];
const prog = [...fs.readFileSync(path.join(root, 'tests/asm286/bench.bin'))];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const model of models) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(c => { localStorage.setItem('a86:cpu', JSON.stringify(c)); localStorage.setItem('a86:trace', 'false'); }, model);
  await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
  await sleep(2500);
  await page.evaluate(prog => {
    const app = window.__app, m = app.machine;
    if (app.pause) app.pause(); if (app.stop) app.stop();
    app.running = false;
    const slice = Math.round(m.clockHz / 100);
    for (let i = 0; i < 100; i++) m.run(slice);        // the BIOS start
    m.pokeMem(0x10100, prog);
    const c = m.cpu;
    for (let i = 0; i < c.sregs.length; i++) c.loadSeg ? c.loadSeg(i, 0x1000) : (c.sregs[i] = 0x1000);
    c.ip = 0x100; c.flush(); c.halted = false; c.repState = null; if (c.regs32) { c.regs32[4] = 0xFFFE; } c.regs[4] = 0xFFFE;
    c.f &= ~0x200;                                    // no interrupts: only the program
    for (let i = 0; i < 50; i++) m.run(slice);        // warm-up
    return { bp: m.breakpoints.size, audioOn: m.audioOn, busKeys: Object.keys(m.bus).join(','), trace: !!c.trace, dbg: !!c.dbgOn, wrapped: String(m.bus.read8).slice(0, 80), run: String(m.run).slice(0, 60) };
  }, prog).then(x => { if (process.argv.includes('--info')) console.log(x); });
  const prof = process.argv.indexOf('--prof') > 0 ? await page.target().createCDPSession() : null;
  if (prof) { await prof.send('Profiler.enable'); await prof.send('Profiler.setSamplingInterval', { interval: 200 }); await prof.send('Profiler.start'); }
  const r = await page.evaluate(secs => {
    const m = window.__app.machine, c = m.cpu, slice = Math.round(m.clockHz / 100);
    const i0 = c.instructions, cy0 = c.cycles, t0 = performance.now();
    while (performance.now() - t0 < secs * 1000) m.run(slice);
    const dt = (performance.now() - t0) / 1000;
    return { ips: (c.instructions - i0) / dt, rt: (c.cycles - cy0) / dt / m.clockHz, mhz: m.clockHz / 1e6 };
  }, secs);
  if (prof) { const { profile } = await prof.send('Profiler.stop'); fs.writeFileSync(process.argv[process.argv.indexOf('--prof') + 1] + '.' + model + '.cpuprofile', JSON.stringify(profile)); }
  console.log(`${model.padEnd(6)} ${(r.ips / 1e6).toFixed(2)} M instr/s, ${r.rt.toFixed(2)} x real time (${r.mhz.toFixed(2)} MHz)`);
  await page.close();
}
await browser.close();
