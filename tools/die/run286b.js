(async () => {
  __app.selectTab('die');
  const sel = document.getElementById('sample-select');
  sel.value = P.sample || 'pm286'; sel.dispatchEvent(new Event('change'));
  const m = __app.machine, STOP = e => e.k === P.stop;
  const lines = __app.editor.value.split('\n');
  const ln = lines.findIndex(l => l.includes(P.src)) + 1;
  const ent = __app.program.lineMap.find(x => x.line === ln);
  let n = 0;
  while (n++ < 300000 && !(m.cpu.ip === ent.addr && (m.csBase & 0xFFFF0) === 0x10000 && m.cpu.ip === ent.addr)) m.step();
  __app.views.die.reset();
  let found = '';
  for (let c = 0; c < P.clocks; c++) {
    __app.stepClock();
    const p = __app.play;
    if (p && p.events.slice(0, p.idx).some(STOP)) { found = 'stop at clock ' + p.clock; break; }
  }
  const p = __app.play;
  return ln + ' ' + n + ' ' + (p ? p.text + ' clock ' + p.clock + ' | ' + p.events.map(e => e.k + (e.type || e.op || e.sreg || '') + '@' + e.t).join(' ') : 'no play') + ' ' + found;
})()
