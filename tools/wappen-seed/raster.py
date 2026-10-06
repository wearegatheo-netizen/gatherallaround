# 래스터 시트(한 장에 여러 패치가 격자로 놓인 이미지)를 잘라 투명 PNG 와펜으로 만든다 — raster.json 에 시트·격자·항목 메타.
# finish.py 가 import 해 manifest.js 에 합치며, 단독 실행도 가능: python3 -I tools/wappen-seed/raster.py [outDir] [sheetPng]
# 알고리즘(의존: numpy·PIL): 배경은 부드러운 그라데이션, 패치는 자수 질감 → 국소 그라데이션 평균이 임계보다 큰 곳 = 전경
#   → 닫힘(7px)·구멍 메움 → 연결 성분 → 중심 좌표를 행·열 묶음으로 격자 배정(너무 길쭉하면 가장 잘록한 줄에서 둘로 분리)
#   → 셀마다 성분 합집합을 알파로(1px 팽창 + 0.8px 블러), 256색 팔레트(디더)로 저장.
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))

def _boxmean(x, r):
    c = np.cumsum(np.cumsum(np.pad(x, ((r + 1, r), (r + 1, r)), mode='edge'), 0), 1)
    return (c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]) / ((2 * r + 1) ** 2)

def _components(mk):
    """bool 마스크의 연결 성분 — [(area, bbox, cx, cy, sel)] (PIL floodfill 반복)"""
    L = Image.fromarray(mk.astype(np.int32) * 255, 'I')
    arr = np.asarray(L); comps = []; cur = 1000
    while True:
        ys, xs = np.nonzero(arr == 255)
        if not len(ys): break
        cur += 1
        ImageDraw.floodfill(L, (int(xs[0]), int(ys[0])), cur)
        arr = np.asarray(L)
        sel = arr == cur; yy, xx = np.nonzero(sel)
        comps.append(dict(area=int(sel.sum()), bbox=(int(xx.min()), int(yy.min()), int(xx.max()), int(yy.max())), cx=float(xx.mean()), cy=float(yy.mean()), sel=sel))
    return comps

def _bands(values, n):
    """1차원 값들을 가장 큰 (n-1)개 간격에서 나눠 n 묶음 → 각 값의 묶음 번호"""
    order = np.argsort(values); v = np.asarray(values)[order]
    gaps = np.diff(v); cuts = sorted(np.argsort(gaps)[-(n - 1):]) if n > 1 else []
    band = np.zeros(len(v), int); b = 0
    for i in range(len(v)):
        if i - 1 in cuts: b += 1
        band[order[i]] = b
    return band

def _split_waist(c):
    """세로로 두 패치가 이어진 성분을 가장 잘록한 줄(가운데 60% 구간)에서 둘로"""
    x0, y0, x1, y1 = c['bbox']; sub = c['sel'][y0:y1 + 1]
    rows = sub.sum(1); lo, hi = int(len(rows) * 0.2), int(len(rows) * 0.8)
    cut = y0 + lo + int(np.argmin(rows[lo:hi]))
    out = []
    for sel in (c['sel'] & (np.arange(c['sel'].shape[0])[:, None] < cut), c['sel'] & (np.arange(c['sel'].shape[0])[:, None] >= cut)):
        yy, xx = np.nonzero(sel)
        if len(yy): out.append(dict(area=int(sel.sum()), bbox=(int(xx.min()), int(yy.min()), int(xx.max()), int(yy.max())), cx=float(xx.mean()), cy=float(yy.mean()), sel=sel))
    return out

def cut_sheet(sheet, out_dir, src_dir=None):
    """시트 하나를 잘라 out_dir 에 저장, manifest 항목 목록을 돌려준다"""
    src = os.path.join(src_dir or os.path.join(HERE, 'raster'), sheet['src'])
    im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(np.float32)
    g = np.abs(np.diff(a, axis=1, prepend=a[:, :1])).sum(2) + np.abs(np.diff(a, axis=0, prepend=a[:1])).sum(2)
    mask = Image.fromarray(((_boxmean(g, 4) > sheet.get('threshold', 18)) * 255).astype(np.uint8))
    mask = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    inv = Image.eval(mask, lambda v: 255 - v); ImageDraw.floodfill(inv, (0, 0), 128)
    mk = (np.asarray(mask) > 0) | (np.asarray(inv) == 255)          # 바깥과 안 이어진 배경 = 구멍 → 전경
    comps = [c for c in _components(mk) if c['area'] >= sheet.get('min_area', 600)]
    rows, cols = sheet['rows'], sheet['cols']
    med_h = float(np.median([c['bbox'][3] - c['bbox'][1] for c in comps]))
    split = []
    for c in comps: split += _split_waist(c) if c['bbox'][3] - c['bbox'][1] > 1.5 * med_h else [c]
    comps = [c for c in split if c['area'] >= sheet.get('min_area', 600)]
    rb, cb = _bands([c['cy'] for c in comps], rows), _bands([c['cx'] for c in comps], cols)
    cells = {}
    for c, r, k in zip(comps, rb, cb): cells.setdefault((int(r), int(k)), []).append(c)
    items = sheet['items']
    if len(items) != rows * cols: raise SystemExit(f"{sheet['src']}: 항목 {len(items)}개 ≠ 격자 {rows}×{cols}")
    out = []
    for idx, meta in enumerate(items):
        key = (idx // cols, idx % cols)
        if key not in cells: raise SystemExit(f"{sheet['src']}: {key} 칸에서 패치를 찾지 못함 (threshold 조정 필요)")
        group = cells[key]; big = max(c['area'] for c in group)
        group = [c for c in group if c['area'] >= big * 0.03]       # 셀 안 잔부스러기 제거(별 세 개처럼 작은 조각은 유지)
        sel = np.zeros(mk.shape, bool)
        for c in group: sel |= c['sel']
        yy, xx = np.nonzero(sel); pad = 3
        x0, y0, x1, y1 = max(0, xx.min() - pad), max(0, yy.min() - pad), min(im.width, xx.max() + pad + 1), min(im.height, yy.max() + pad + 1)
        alpha = Image.fromarray((sel[y0:y1, x0:x1] * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
        rgba = im.crop((x0, y0, x1, y1)).convert('RGBA'); rgba.putalpha(alpha)
        fn = meta['key'] + '.png'
        pal = rgba.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        pal.save(os.path.join(out_dir, fn), 'PNG', optimize=True)
        out.append({**meta, 'kind': 'raster', 'file': fn, 'w': rgba.width, 'h': rgba.height})
    return out

def cut_sheets(cfg_path, out_dir, src_dir=None):
    cfg = json.load(open(cfg_path, encoding='utf-8')); items = []
    for sheet in cfg['sheets']: items += cut_sheet(sheet, out_dir, src_dir)
    return items

if __name__ == '__main__':
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'wappen', 'seed')
    os.makedirs(out_dir, exist_ok=True)
    res = cut_sheets(os.path.join(HERE, 'raster.json'), out_dir)
    total = sum(os.path.getsize(os.path.join(out_dir, it['file'])) for it in res)
    print(f"raster: {len(res)} items, {total / 1024:.0f} KB → {out_dir}")
    for it in res: print(f"  {it['key']:20s} {it['w']}×{it['h']} {os.path.getsize(os.path.join(out_dir, it['file'])) // 1024}KB")
    if len(sys.argv) > 2:   # 미리보기 시트(체크무늬 배경)
        cols, cell = 6, 220; rows_n = (len(res) + cols - 1) // cols
        sh = Image.new('RGBA', (cols * cell, rows_n * cell), (244, 245, 248, 255)); d = ImageDraw.Draw(sh)
        for i, it in enumerate(res):
            p = Image.open(os.path.join(out_dir, it['file'])).convert('RGBA'); s = min((cell - 20) / p.width, (cell - 20) / p.height)
            p = p.resize((max(1, int(p.width * s)), max(1, int(p.height * s))), Image.LANCZOS)
            cx, cy = (i % cols) * cell, (i // cols) * cell
            for yy in range(0, cell, 10):
                for xx in range(0, cell, 10):
                    if (xx // 10 + yy // 10) % 2 == 0: d.rectangle([cx + xx, cy + yy, cx + xx + 9, cy + yy + 9], fill=(226, 226, 232, 255))
            sh.alpha_composite(p, (cx + (cell - p.width) // 2, cy + (cell - p.height) // 2))
        sh.convert('RGB').save(sys.argv[2], 'PNG'); print('sheet →', sys.argv[2])
