# 폴더의 PNG(meta.json 순서)를 여백 자르고 체크무늬 격자 시트로 — 검토용. python3 -I sheet.py <dir> <out.png>
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
cols, cell, labh = 4, 260, 30
rows = (len(meta) + cols - 1) // cols
sh = Image.new('RGBA', (cols * cell, rows * (cell + labh)), (244, 245, 248, 255)); dr = ImageDraw.Draw(sh)
try: font = ImageFont.truetype('/home/user/gatherallaround/BMKkubulimTTF.ttf', 20)
except Exception: font = ImageFont.load_default()
for i, m in enumerate(meta):
    im = Image.open(os.path.join(d, m['key'] + '.png')).convert('RGBA'); bb = im.getchannel('A').getbbox()
    if bb: im = im.crop(bb)
    s = min((cell - 30) / im.width, (cell - 30) / im.height); im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
    cx, cy = (i % cols) * cell, (i // cols) * (cell + labh)
    for yy in range(0, cell, 12):
        for xx in range(0, cell, 12):
            if (xx // 12 + yy // 12) % 2 == 0: dr.rectangle([cx + xx, cy + yy, cx + xx + 11, cy + yy + 11], fill=(226, 226, 232, 255))
    sh.alpha_composite(im, (cx + (cell - im.width) // 2, cy + (cell - im.height) // 2))
    dr.text((cx + 8, cy + cell + 4), f"{m['name']} · {m['category']}", fill=(40, 40, 50, 255), font=font)
sh.convert('RGB').save(out, 'PNG'); print('sheet →', out)
