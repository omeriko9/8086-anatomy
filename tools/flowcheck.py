# Checks of a film from tools/flowfilm.mjs: the continuity of the token and of the camera,
# frame by frame, and a contact sheet (one frame for each second, with the step title).
# Usage: python tools/flowcheck.py DIR [--sheet-every SECONDS]
import json, math, sys, os
from PIL import Image, ImageDraw

d = sys.argv[1]
every_s = float(sys.argv[sys.argv.index('--sheet-every') + 1]) if '--sheet-every' in sys.argv else 1.0
S = json.load(open(os.path.join(d, 'state.json')))
F, fps = S['frames'], S['fps']
tab = S['tab']
TOK_JUMP, CAM_PAN, CAM_ZOOM = 40, 60, 1.12       # the limits for one frame at 30 fps

def cam_scale(c):
    return c['z'] if tab == 'top' else 1.0

jumps, gaps, cams, zooms = [], [], [], []
prev = None
for i, s in enumerate(F):
    if prev is not None:
        a, b = prev.get('tok'), s.get('tok')
        # (not a jump: the camera changes to the token of the work in parallel, both on the
        # screen; or the instruction ends)
        if a and b and prev.get('bg') == s.get('bg') and s['title']:
            dd = math.hypot(b[0] - a[0], b[1] - a[1])
            if dd > TOK_JUMP: jumps.append((i, round(dd), prev['title'], s['title']))
        elif (a is None) != (b is None) and not s.get('done'):
            gaps.append((i, 'token ' + ('shows' if b else 'goes away'), s['title']))
        ca, cb = prev.get('cam'), s.get('cam')
        if ca and cb and tab == 'top':
            r = cb['z'] / ca['z']
            if r > CAM_ZOOM or r < 1 / CAM_ZOOM: zooms.append((i, round(r, 3), s['title']))
            pan = math.hypot((cb['cx'] - ca['cx']) * cb['z'], (cb['cz'] - ca['cz']) * cb['z'])
            if pan > CAM_PAN: cams.append((i, round(pan), s['title']))
        if ca and cb and tab == 'board':
            # the pan of the target in screen px, the zoom (the distance), the turn of the view
            turn = math.degrees(math.acos(max(-1, min(1, ca['dx'] * cb['dx'] + ca['dy'] * cb['dy'] + ca['dz'] * cb['dz']))))
            if 'r' in cb:
                r = ca['r'] / cb['r']
                if r > CAM_ZOOM or r < 1 / CAM_ZOOM: zooms.append((i, round(r, 3), s['title']))
                pan = math.dist((ca['tx'], ca['ty'], ca['tz']), (cb['tx'], cb['ty'], cb['tz'])) * cb['px']
                if pan > CAM_PAN or turn > 2.5: cams.append((i, f'pan {pan:.0f} turn {turn:.1f}', s['title']))
            elif turn > 2.5: cams.append((i, f'turn {turn:.1f}', s['title']))
    prev = s

steps = []
for i, s in enumerate(F):
    if not steps or steps[-1][1] != s['si']: steps.append([i, s['si'], s['title'], 0])
    steps[-1][3] += 1
print(f"{len(F)} frames, {len(F) / fps:.1f} s; tab {tab}; errors {len(S['errors'])}")
print('steps:')
for i0, si, title, n in steps: print(f"  frame {i0:5d}  step {si + 1:2d}  {n / fps:5.1f} s  {title}")
tok_frames = sum(1 for s in F if s.get('tok'))
print(f"token visible in {tok_frames} of {len(F)} frames")
W, H = S.get('w', 1280), S.get('h', 720)
def inview(s):
    if 'view' not in s: return 40 <= s['tok'][0] <= W - 40 and 100 <= s['tok'][1] <= H - 100
    x, y, w, h = s['view']
    return x + 20 <= s['tok'][0] <= x + w - 20 and y + 20 <= s['tok'][1] <= y + h - 20
off = [(i, [round(v) for v in s['tok']], s['title']) for i, s in enumerate(F) if s.get('tok') and not inview(s)]
print(f"token out of the view (or under the bars): {len(off)}"); [print('   ', o) for o in off[:10]]
print(f"token jumps > {TOK_JUMP} px/frame: {len(jumps)}"); [print('   ', j) for j in jumps[:15]]
print(f"token shows / goes away: {len(gaps)}"); [print('   ', g) for g in gaps[:15]]
print(f"camera pans > {CAM_PAN} px/frame: {len(cams)}"); [print('   ', c) for c in cams[:15]]
print(f"camera zoom steps > {CAM_ZOOM}x/frame: {len(zooms)}"); [print('   ', z) for z in zooms[:15]]

# the contact sheet
imgs = sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
if imgs:
    step = max(1, round(every_s * fps / S['every']))
    pick = imgs[::step][:48]
    im0 = Image.open(os.path.join(d, pick[0]))
    tw, th = 320, round(320 * im0.height / im0.width)
    cols = 6
    rows = math.ceil(len(pick) / cols)
    sheet = Image.new('RGB', (cols * tw, rows * (th + 16)), (10, 10, 10))
    dr = ImageDraw.Draw(sheet)
    for k, name in enumerate(pick):
        fi = (int(name[1:5]) - 1) * S['every']
        im = Image.open(os.path.join(d, name)).resize((tw, th))
        x, y = (k % cols) * tw, (k // cols) * (th + 16)
        sheet.paste(im, (x, y + 16))
        s = F[min(fi, len(F) - 1)]
        dr.text((x + 3, y + 2), f"{fi / fps:5.1f}s st{s['si'] + 1} {s['title'][:34]}", fill=(230, 230, 230))
    sheet.save(os.path.join(d, 'sheet.jpg'), quality=85)
    print('sheet:', os.path.join(d, 'sheet.jpg'))

# close-ups of the units: for each unit visit, 8 frames from the input to the output (the
# rectangle of the unit with a margin, larger), one row for each visit
if '--units' in sys.argv and imgs:
    visits = []
    for i, s in enumerate(F):
        u = s.get('unit')
        if not u: continue
        if visits and visits[-1]['name'] == u['name'] and visits[-1]['last'] == i - 1: visits[-1]['frames'].append(i); visits[-1]['last'] = i
        else: visits.append({'name': u['name'], 'kind': u['kind'], 'frames': [i], 'last': i, 'si': s['si']})
    rows = []
    for v in visits[:14]:
        fr = v['frames']
        pick = [fr[round(k * (len(fr) - 1) / 7)] for k in range(8)]
        tiles = []
        for fi in pick:
            name = os.path.join(d, f"f{fi // S['every'] + 1:04d}.jpg")
            if not os.path.exists(name): continue
            x, y, w, h = F[fi]['unit']['rect']
            m = max(24, 0.35 * max(w, h))
            box = (max(0, int(x - m)), max(0, int(y - m)), int(x + w + m), int(y + h + m))
            if box[2] <= box[0] + 4 or box[3] <= box[1] + 4: continue
            im = Image.open(name).crop(box)
            sc = 170 / im.height
            tiles.append((im.resize((max(1, round(im.width * sc)), 170)), F[fi]['unit']['u']))
        if not tiles: continue
        rw = sum(t[0].width for t in tiles) + 4 * len(tiles)
        row = Image.new('RGB', (max(rw, 400), 190), (12, 12, 12))
        dr = ImageDraw.Draw(row)
        dr.text((4, 2), f"step {v['si'] + 1}  {v['name']}  ({v['kind']})", fill=(240, 220, 120))
        x = 0
        for im, u in tiles:
            row.paste(im, (x, 18)); dr.text((x + 3, 172), f"u {u:.2f}", fill=(200, 200, 200)); x += im.width + 4
        rows.append(row)
    if rows:
        W2 = max(r.width for r in rows)
        out = Image.new('RGB', (W2, sum(r.height for r in rows)), (0, 0, 0))
        y = 0
        for r in rows: out.paste(r, (0, y)); y += r.height
        out.save(os.path.join(d, 'units.jpg'), quality=85)
        print('units:', os.path.join(d, 'units.jpg'), len(rows), 'visits')
