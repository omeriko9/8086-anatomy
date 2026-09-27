// The unit visits of the trace flow (Top view) for each step of one instruction, with the kind
// of their card, and a mark for a unit that has no block on its die (then the flow uses the
// middle of the die: a unit name of a trace model must map to the die plan of the part).
// Usage: node tools/flowunits.mjs [--model 80486] [--asm "mov bx, dat; mov ax, [bx]; hlt; dat: dw 0x1234"] [--instr 2]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const model = opt('--model', '8086'), instrN = +opt('--instr', 2);
const asm = opt('--asm', 'mov bx, dat; mov ax, [bx]; hlt; dat: dw 0x1234');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.evaluateOnNewDocument(s => { for (const k in s) localStorage.setItem('a86:' + k, JSON.stringify(s[k])); }, { cpu: model, tab: 'top', trace: true, codeHidden: true, dockHidden: true });
await page.goto(pathToFileURL(path.join(root, 'dist', '8086-anatomy.html')).href);
await new Promise(r => setTimeout(r, 3000));
const src = `org 0x100\n${asm.split(';').map(s => '        ' + s.trim()).join('\n')}\n        hlt\n`;
console.log(await page.evaluate((src, n) => {
  __app.editor.value = src; __app.assembleAndLoad();
  for (let k = 1; k < n; k++) { __app.traceNext(); const p = __app.play; if (p && p.story) while (p.si < p.story.steps.length - 1) __app.enterStep(p.si + 1); __app.finishInstr(); }
  __app.traceNext();
  const st = __app.play.story, v = __app.views.top, rows = [`${st.text}`];
  const list = (s, pre) => { for (const sg of v.flowPlan(s, 1700).segs) if (sg.unit) rows.push(`${pre}${sg.p.part} ${sg.block}${v.blockRect(sg.p, sg.block) ? '' : '   <-- NO BLOCK'} | ${sg.card ? sg.card.kind : '-'}`); };
  st.steps.forEach((s, i) => {
    rows.push(`STEP ${i + 1} ${s.kind}/${s.phase || ''} ${s.title}`);
    list(s, '   ');
    for (const b of s.bg || []) { rows.push(`   (in parallel: ${b.title})`); list(b, '      '); }
  });
  return rows.join('\n');
}, src, instrN));
await browser.close();
