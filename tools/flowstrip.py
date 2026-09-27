# Consecutive frames of a film (tools/flowfilm.mjs) around the moments where the token goes
# from one kind of part to another (board -> bond wire -> die -> unit ...), as strips.
# Usage: python tools/flowstrip.py DIR [--every N (frames between tiles, default 3)] [--n 8]
import json, sys, os
from PIL import Image, ImageDraw
d = sys.argv[1]
ev = int(sys.argv[sys.argv.index('--every') + 1]) if '--every' in sys.argv else 3
n = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 8
S = json.load(open(os.path.join(d, 'state.json'))); F = S['frames']
kind = lambda s: (s.get('seg') or '').split(':')[1][:30] if s.get('seg') else ''
marks = []
for i in range(1, len(F)):
    a, b = kind(F[i - 1]), kind(F[i])
    if a != b and b and ('pin' in b.lower() or 'bus' in b.lower() or 'pad' in b.lower()): marks.append((i, a, b))
rows = []
for i, a, b in marks[:12]:
    tiles = []
    for k in range(n):
        fi = i + (k - n // 2) * ev
        if fi < 0 or fi >= len(F): continue
        p = os.path.join(d, f'f{fi + 1:04d}.jpg')
        if not os.path.exists(p): continue
        im = Image.open(p)
        tok = F[fi].get('tok') or [im.width / 2, im.height / 2]
        c = (int(tok[0] - 150), int(tok[1] - 100), int(tok[0] + 150), int(tok[1] + 100))
        tiles.append(im.crop(c))
    if not tiles: continue
    row = Image.new('RGB', (sum(t.width for t in tiles) + 3 * len(tiles), 218), (10, 10, 10))
    dr = ImageDraw.Draw(row)
    dr.text((4, 2), f'frame {i}: "{a}" -> "{b}" (every {ev} frames, the token in the middle)', fill=(240, 220, 120))
    x = 0
    for t in tiles: row.paste(t, (x, 16)); x += t.width + 3
    rows.append(row)
out = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows)), (0, 0, 0))
y = 0
for r in rows: out.paste(r, (0, y)); y += r.height
out.save(os.path.join(d, 'strips.jpg'), quality=85)
print(os.path.join(d, 'strips.jpg'), len(rows))
