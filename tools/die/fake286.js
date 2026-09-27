(() => {
  __app.selectTab('die');
  const v = __app.views.die;
  const ev = [
    { k: 'decode', t: 0, cs: 0x1000, ip: 0x120, len: 3, text: 'mov ds, ax', bytes: [0x8E, 0xD8] },
    { k: 'iq', t: 0, n: 2 },
    { k: 'fetch', t: 0, addr: 0x10124, data: 0x9090, width: 2, len: 3, dev: 'ram', q: [0x90, 0x90] },
    { k: 'desc', t: 1, sreg: 'DS', sel: 0x0010, base: 0x123400, limit: 0x7FFF, access: 0x93, table: 'GDT' },
    { k: 'bus', t: 3, type: 'memr', addr: 0x001010, data: 0x3400, width: 2, len: 3, seg: null, dev: 'ram', owner: 'cpu' },
    { k: 'sys', t: 5, op: 'LGDT', text: 'LGDT [0x200]' },
    { k: 'reg', t: 7, r: 'DS', v: 0x10 },
    { k: 'int', t: 8, vec: 13, src: 'exc', err: 0x0008, name: '#GP' },
    { k: 'end', t: 12 },
  ];
  v.instr(ev, { cycles: 12, clockMs: 60, text: 'mov ds, ax', cs: 0x1000, ip: 0x120 });
  let i = 0;
  const t0 = performance.now();
  const tick = () => { const t = (performance.now() - t0) / 60; while (i < ev.length && ev[i].t <= t) v.event(ev[i++], 60); if (i < ev.length) requestAnimationFrame(tick); };
  tick();
  return 'fake events';
})()
