# 래스터 시트(한 장에 여러 패치가 격자로 놓인 이미지)를 잘라 투명 PNG 와펜으로 만든다 — raster.json 에 시트·격자·항목 메타.
# finish.py 가 import 해 manifest.js 에 합치며, 단독 실행도 가능: python3 -I tools/wappen-seed/raster.py [outDir] [sheetPng]
# 알고리즘(의존: numpy·PIL): 배경은 부드러운 그라데이션, 패치는 자수 질감 → 국소 그라데이션 평균이 임계보다 큰 곳 = 전경
#   → 닫힘(7px)·구멍 메움 → 연결 성분 → 중심 좌표를 행·열 묶음으로 격자 배정(너무 길쭉하면 가장 잘록한 줄에서 둘로 분리)
#   → 셀마다 성분 합집합을 알파로(1px 팽창 + 0.8px 블러), 256색 팔레트(디더)로 저장.
#   시트가 이미 투명 배경(RGBA, 투명 비율 20% 이상)이면 질감 대신 알파 채널(>128)을 마스크로 쓰고, 컷아웃 알파도 원본 알파를 그대로 쓴다(부드러운 테두리 유지).
#   체커보드가 그림으로 박힌 시트("bg":"checker", 투명 없음·비네팅 있어도 됨)는 그라데이션 "평균" 대신 9×9 창 안 에지 픽셀 "비율"(density)로 판정 —
#   체커 경계는 얇은 계단 에지라 비율이 낮고(≤ 0.3) 자수 질감은 거의 모든 픽셀이 에지(≥ 0.8)라서 체커 눈금이 전경으로 잡히지 않는다.
#   "배경 같은" 픽셀 = 무채색이고 밝기가 주변 체커 두 단계 범위 안(그림자 포함; 흰 테두리는 체커 밝은 칸보다 밝고 검정 테두리는 그림자보다 어두워 제외).
#   주변 체커 밝기는 반지름 80px 창 안 배경 픽셀의 평균±표준편차(밝은 칸/어두운 칸)로 추정 — 비네팅이 있어도 된다. (_checker_refine)
#   구멍은 작고(hole_max px² 미만, 기본 2500) 배경 같지 않은 것(질감 없는 흰 하이라이트·구름 속)만 메우고, 큰 구멍(도넛 구멍·음표 사이)과
#   캔과 반짝이 사이 같은 체커 주머니는 비워 둔다. 그 다음 가장자리 10px 띠의 배경 같은 픽셀 중 바깥에서 이어진 것만 벗겨 낸다.
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

def _outside(mk):
    """마스크 밖에서 네 모서리와 이어진 영역(bool)"""
    inv = Image.fromarray(((~mk) * 255).astype(np.uint8)).copy()     # fromarray 는 numpy 버퍼를 읽기 전용으로 감싸 floodfill 이 조용히 무시됨 → 복사
    for pt in ((0, 0), (inv.width - 1, 0), (0, inv.height - 1), (inv.width - 1, inv.height - 1)):
        if inv.getpixel(pt) == 255: ImageDraw.floodfill(inv, pt, 128)
    return np.asarray(inv) == 128

def _checker_refine(a, mk, hole_max=2500, band=10, r=80):
    """체커 시트: 작은·배경 같지 않은 구멍만 메우고, 가장자리 띠의 배경(체커·그림자) 같은 픽셀 중 바깥과 이어진 것을 벗겨 낸 마스크"""
    gray = a.mean(2); sat = a.max(2) - a.min(2)
    bg = (~mk) & (sat < 18)
    w = np.maximum(_boxmean(bg.astype(np.float32), r), 1e-6)
    m1 = _boxmean(np.where(bg, gray, 0).astype(np.float32), r) / w
    m2 = _boxmean(np.where(bg, gray * gray, 0).astype(np.float32), r) / w
    sd = np.sqrt(np.maximum(m2 - m1 * m1, 0)); light, dark = m1 + sd, m1 - sd
    bglike = (sat < 18) & (gray >= dark * 0.55) & (gray <= light + 10)
    holes = (~mk) & ~_outside(mk)
    for c in _components(holes):
        if c['area'] < hole_max and bglike[c['sel']].mean() < 0.5: mk = mk | c['sel']
    inner = np.asarray(Image.fromarray((mk * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(2 * band + 1))) > 0
    peel = _outside(mk & ~(bglike & ~inner)) & mk      # 띠의 배경 같은 픽셀 중 바깥에서 이어진 것만(안쪽 흰 명암은 남김)
    out = Image.fromarray(((mk & ~peel) * 255).astype(np.uint8))
    return np.asarray(out.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))) > 0     # 1px 열림으로 티끌 제거

def cut_sheet(sheet, out_dir, src_dir=None):
    """시트 하나를 잘라 out_dir 에 저장, manifest 항목 목록을 돌려준다"""
    src = os.path.join(src_dir or os.path.join(HERE, 'raster'), sheet['src'])
    src_im = Image.open(src)
    src_alpha = None
    if src_im.mode in ('RGBA', 'LA', 'P'):
        al = np.asarray(src_im.convert('RGBA'))[:, :, 3]
        if (al < 10).mean() >= 0.2: src_alpha = al                      # 진짜 투명 배경 시트
    im = src_im.convert('RGB')
    checker = src_alpha is None and sheet.get('bg') == 'checker'
    if src_alpha is not None:
        mk = src_alpha > 128
    else:
        a = np.asarray(im).astype(np.float32)
        g = np.abs(np.diff(a, axis=1, prepend=a[:, :1])).sum(2) + np.abs(np.diff(a, axis=0, prepend=a[:1])).sum(2)
        if checker:
            fg = _boxmean((g > sheet.get('grad', 16)).astype(np.float32), 4) > sheet.get('density', 0.45)
        else:
            fg = _boxmean(g, 4) > sheet.get('threshold', 18)
        mask = Image.fromarray((fg * 255).astype(np.uint8))
        mask = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
        if checker:
            mk = _checker_refine(a, np.asarray(mask) > 0, sheet.get('hole_max', 2500))
        else:
            inv = Image.eval(mask, lambda v: 255 - v); ImageDraw.floodfill(inv, (0, 0), 128)
            mk = (np.asarray(mask) > 0) | (np.asarray(inv) == 255)      # 바깥과 안 이어진 배경 = 구멍 → 전경
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
        group = [c for c in group if c['area'] >= big * (0.01 if checker else 0.03)]   # 셀 안 잔부스러기 제거(별 세 개·로켓 옆 반짝 같은 작은 조각은 유지)
        if checker:   # 점선 궤적처럼 가늘고 긴 조각(bbox 대비 채움 15% 미만)은 버린다 — 별·반짝은 35% 이상
            group = [c for c in group if c['area'] >= 0.15 * (c['bbox'][2] - c['bbox'][0] + 1) * (c['bbox'][3] - c['bbox'][1] + 1)]
        sel = np.zeros(mk.shape, bool)
        for c in group: sel |= c['sel']
        yy, xx = np.nonzero(sel); pad = 3
        x0, y0, x1, y1 = max(0, xx.min() - pad), max(0, yy.min() - pad), min(im.width, xx.max() + pad + 1), min(im.height, yy.max() + pad + 1)
        if src_alpha is not None:   # 원본 알파를 그대로(셀에 속한 성분 밖은 0)
            keep = Image.fromarray((sel[y0:y1, x0:x1] * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
            alpha = Image.fromarray(np.where(np.asarray(keep) > 0, src_alpha[y0:y1, x0:x1], 0).astype(np.uint8))
        elif checker:   # 체커 시트: 띠 정제로 경계가 실제 가장자리와 맞음 → 팽창 없이 1px 깎고 블러(압축 번짐 회색 테두리 제거)
            alpha = Image.fromarray((sel[y0:y1, x0:x1] * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
        else:
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
