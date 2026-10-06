# 기본 와펜 세트 마무리: 투명 여백 자르기 → PNG 최적화 → (raster.json 의 래스터 시트 잘라 합치기) → manifest.js → (선택) 미리보기 시트
# 실행은 build.mjs 가 한다: python3 -I finish.py <rawDir> <outDir> [sheetPng]
# 벡터를 다시 렌더하지 않고(Playwright 없이) 래스터만 다시 자르고 manifest 를 재생성하려면: python3 -I finish.py --reuse <outDir> [sheetPng]
#   (--reuse: 기존 manifest.js 의 벡터 항목·PNG 를 그대로 둔다)
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # -I 모드는 스크립트 폴더를 sys.path 에 안 넣는다
from raster import cut_sheets

raw_dir, out_dir = sys.argv[1], sys.argv[2]
sheet = sys.argv[3] if len(sys.argv) > 3 else ''
HERE = os.path.dirname(os.path.abspath(__file__))
PAD = 8
items = []
if raw_dir == '--reuse':
    # 생성 파일(manifest.js)의 벡터 항목을 그대로 읽는다 — 한 줄에 JSON 하나인 고정 형식
    for line in open(os.path.join(out_dir, 'manifest.js'), encoding='utf-8'):
        line = line.strip()
        if line.startswith('{') and line.endswith(','):
            it = json.loads(line[:-1])
            if it.get('kind') != 'raster': items.append(it)
    meta = []
else:
    meta = json.load(open(os.path.join(raw_dir, 'meta.json'), encoding='utf-8'))
for m in meta:
    im = Image.open(os.path.join(raw_dir, m['key'] + '.png')).convert('RGBA')
    bbox = im.getchannel('A').getbbox()
    if not bbox:
        raise SystemExit(f"{m['key']}: 아무것도 그려지지 않음")
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD); x1, y1 = min(im.width, x1 + PAD), min(im.height, y1 + PAD)
    im = im.crop((x0, y0, x1, y1))
    fn = f"{m['key']}.png"
    # 평면 색이라 256색 팔레트(알파 유지)로 줄여도 화질 손실이 없다 — 용량 약 1/3
    pal = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    pal.save(os.path.join(out_dir, fn), 'PNG', optimize=True)
    items.append({**m, 'file': fn, 'w': im.width, 'h': im.height})

# 래스터 시트(자수 패치 등, raster.json) — 잘라서 같은 폴더에 저장하고 kind:'raster' 로 표시
raster_cfg = os.path.join(HERE, 'raster.json')
if os.path.exists(raster_cfg):
    items += cut_sheets(raster_cfg, out_dir)

lines = ["// 기본 와펜 세트 목록 — tools/wappen-seed/build.mjs(또는 finish.py --reuse) 가 생성한다. 직접 수정하지 말 것.",
         "// 벡터 항목은 tools/wappen-seed/designs.mjs 에서 코드로 그린 원본(CC0), kind:'raster' 항목은 tools/wappen-seed/raster.json 의 시트(제공자 소유)에서 잘라낸 것.",
         "// 서버(functions/wappen-api.js admin_seed_items)와 관리자 화면이 같은 파일을 import.",
         "export const SEED_VERSION = 2;",
         "export const SEED_ITEMS = ["]
for it in items:
    keys = ('key', 'name', 'category', 'tags', 'file', 'w', 'h') + (('kind',) if it.get('kind') else ())
    lines.append("    " + json.dumps({k: it[k] for k in keys}, ensure_ascii=False) + ",")
lines.append("];")
open(os.path.join(out_dir, 'manifest.js'), 'w', encoding='utf-8').write("\n".join(lines) + "\n")
total = sum(os.path.getsize(os.path.join(out_dir, it['file'])) for it in items)
print(f"seed: {len(items)} items, {total/1024:.0f} KB total → {out_dir}")

if sheet:
    cols, cell, labh = 8, 150, 34
    rows = (len(items) + cols - 1) // cols
    W, H = cols * cell, rows * (cell + labh)
    sh = Image.new('RGBA', (W, H), (244, 245, 248, 255))
    d = ImageDraw.Draw(sh)
    try: font = ImageFont.truetype(os.path.join(os.path.dirname(raw_dir), 'BMKkubulimTTF.ttf'), 18)
    except Exception:
        try: font = ImageFont.truetype('/home/user/gatherallaround/BMKkubulimTTF.ttf', 18)
        except Exception: font = ImageFont.load_default()
    for i, it in enumerate(items):
        im = Image.open(os.path.join(out_dir, it['file'])).convert('RGBA')
        s = min((cell - 16) / im.width, (cell - 16) / im.height)
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
        cx, cy = (i % cols) * cell, (i // cols) * (cell + labh)
        # 체크무늬 배경(투명 확인)
        for yy in range(0, cell, 10):
            for xx in range(0, cell, 10):
                if (xx // 10 + yy // 10) % 2 == 0: d.rectangle([cx + xx, cy + yy, cx + xx + 9, cy + yy + 9], fill=(232, 232, 236, 255))
        sh.alpha_composite(im, (cx + (cell - im.width) // 2, cy + (cell - im.height) // 2))
        d.text((cx + 6, cy + cell + 6), f"{it['name']} ({it['w']}×{it['h']})", fill=(40, 40, 50, 255), font=font)
    sh.convert('RGB').save(sheet, 'PNG')
    print('sheet →', sheet)
