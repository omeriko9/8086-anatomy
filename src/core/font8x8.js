// The 8x8 BIOS font (a copy of makeFont8x8 of src/ui/disks.js for the learner page, which does
// not load disks.js). Browser only: it reads CP437 (crt.js) and document; stubbed in Node.
// An 8x8 font for the BIOS graphics text (INT 10h in modes 4-6), drawn from the
// page's monospace font at start-up: 256 characters of code page 437.
function makeFont8x8() {
  const out = new Uint8Array(2048);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  const mono = (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace').trim();
  g.font = `bold 14px ${mono}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  for (let ch = 1; ch < 256; ch++) {
    const s = CP437[ch];
    if (!s || s === ' ' || s === ' ') continue;
    g.clearRect(0, 0, 16, 16);
    g.fillStyle = '#fff';
    g.fillText(s, 8, 12);
    const px = g.getImageData(0, 0, 16, 16).data;
    for (let y = 0; y < 8; y++) {
      let row = 0;
      for (let x = 0; x < 8; x++) {
        let a = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) a += px[((y * 2 + dy) * 16 + x * 2 + dx) * 4 + 3];
        if (a / 4 > 90) row |= 0x80 >> x;
      }
      out[ch * 8 + y] = row;
    }
  }
  return out;
}
