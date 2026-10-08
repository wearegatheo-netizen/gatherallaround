# 자수 시뮬레이션 렌더러 — 부품 마스크(preview.mjs --masks: 흰 실루엣 2048px PNG + parts.json)를 받아
# 실 한 올씩(새틴 스티치 기둥 하이라이트·실별 밝기 편차·바늘땀 끊김) + 도톰한 퍼프 음영 + 부품 외곽 러닝 스티치 + 메로우(오버로크) 테두리 + 그림자를
# 그려 사진 같은 자수 와펜 PNG 를 만든다. 의존: numpy·PIL 만.  실행: python3 -I embroider.py <masksDir> <outDir> [sheet.png]
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCALE = 2048            # 마스크 해상도 (1000 viewBox × 2.048)
OUT = 512               # 출력 한 변(여백 자르기 전)
LIGHT = (0.707, 0.707)  # 퍼프 조명: 왼쪽 위에서

def hex2rgb(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255
def hnoise(i, k=1.0):   # 정수 배열 → 0..1 결정적 잡음
    x = np.sin(i.astype(np.float64) * 12.9898 * k + 78.233) * 43758.5453
    return (x - np.floor(x)).astype(np.float32)
def blur(a, r):
    return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255
def erode(a, px):
    k = max(3, int(px) * 2 + 1)
    return np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(k))).astype(np.float32) / 255
def dilate(a, px):
    k = max(3, int(px) * 2 + 1)
    return np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(k))).astype(np.float32) / 255

YY, XX = np.mgrid[0:SCALE, 0:SCALE].astype(np.float32)

def thread_shade(angle_deg, pitch, seed):
    """실 결 밝기 맵: 각도 방향 평행 실(기둥 단면), 실별 밝기 편차, 바늘땀 끊김(어두운 틈), 땀마다 미세 편차"""
    a = math.radians(angle_deg)
    u = XX * math.cos(a) + YY * math.sin(a)       # 실을 가로지르는 좌표
    v = -XX * math.sin(a) + YY * math.cos(a)      # 실을 따라가는 좌표
    idx = np.floor(u / pitch); t = u / pitch - idx
    prof = 0.64 + 0.58 * np.sqrt(np.clip(1 - (2 * t - 1) ** 2, 0, 1))      # 가운데 밝고 양 끝 어두운 기둥
    jit = 1 + (hnoise(idx + seed * 977) - 0.5) * 0.14
    seg = 260 + 220 * hnoise(idx * 7 + 3 + seed)                            # 긴 새틴 땀 260~480px
    s = v / seg + hnoise(idx * 13 + 1 + seed); si = np.floor(s); sf = s - si
    seam = np.where((sf < 0.02) | (sf > 0.98), 0.84, 1.0)                   # 바늘 구멍 쪽 옅은 틈
    segvar = 1 + (hnoise(idx * 31 + si * 17 + seed) - 0.5) * 0.06
    wave = 1 + 0.05 * np.sin(v / 41 + idx * 0.9)                            # 실의 미세 물결
    satin = 1 + 0.11 * np.cos(2 * np.pi * v / 900 + idx * 0.004)            # 넓은 광택 띠
    return prof * jit * seam * segvar * wave * satin

def contours(mask_bool):
    """이진 마스크의 모든 경계(바깥 + 구멍)를 점 목록으로 — 성분별 Moore 이웃 추적"""
    H, W = mask_bool.shape
    pad = np.zeros((H + 2, W + 2), bool); pad[1:-1, 1:-1] = mask_bool
    out = []
    def trace(m):
        ys, xs = np.nonzero(m)
        if not len(ys): return []
        k = np.argmin(ys * (W + 2) + xs); sy, sx = int(ys[k]), int(xs[k])
        dirs = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]   # (dy,dx) 시계 방향, 북부터
        pts = [(sx, sy)]; cy, cx = sy, sx; d = 2   # 서쪽(배경)에서 동쪽으로 들어온 것으로 시작 → backtrack = 서쪽, 탐색은 북서부터 시계 방향
        for _ in range(4 * (H + W) * 4):
            found = False
            for j in range(8):
                dd = (d + 5 + j) % 8             # backtrack 다음 칸부터 시계 방향
                ny, nx = cy + dirs[dd][0], cx + dirs[dd][1]
                if m[ny, nx]: cy, cx, d = ny, nx, dd; found = True; break
            if not found: break
            if (cx, cy) == (sx, sy) and len(pts) > 2: break
            pts.append((cx, cy))
        return pts
    # 바깥 경계: 전경 성분마다 / 구멍 경계: 배경 성분 중 테두리에 안 닿는 것
    def components(m):
        L = Image.fromarray(m.astype(np.int32) * 255, 'I'); arr = np.asarray(L); cur = 1000; comps = []
        while True:
            ys, xs = np.nonzero(arr == 255)
            if not len(ys): break
            cur += 1; ImageDraw.floodfill(L, (int(xs[0]), int(ys[0])), cur); arr = np.asarray(L)
            comps.append(arr == cur)
        return comps
    for c in components(pad):
        if c.sum() > 400: out.append(trace(c))
    bg = ~pad; bg[0, :] = bg[-1, :] = bg[:, 0] = bg[:, -1] = True
    for c in components(bg):
        if c[0, 0] or c.sum() < 1500: continue        # 바깥 배경·아주 작은 구멍 제외
        out.append(trace(c))
    return [[(x - 1, y - 1) for x, y in pts] for pts in out if len(pts) > 20]

def resample(pts, step):
    """닫힌 경로를 호 길이 step 간격으로 다시 샘플 → [(x, y, nx, ny)] (법선: 바깥쪽은 호출측이 판단)"""
    P = np.array(pts + [pts[0]], np.float32)
    seg = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1])); cum = np.concatenate([[0], np.cumsum(seg)]); total = cum[-1]
    n = max(8, int(total / step)); out = []
    for k in range(n):
        s = k * total / n; i = int(np.searchsorted(cum, s, side='right') - 1); i = min(i, len(seg) - 1)
        f = (s - cum[i]) / (seg[i] + 1e-6); x, y = P[i] + (P[i + 1] - P[i]) * f
        # 접선: 앞뒤 ±4 샘플
        s0, s1 = (s - step * 2) % total, (s + step * 2) % total
        def at(ss):
            j = min(int(np.searchsorted(cum, ss, side='right') - 1), len(seg) - 1); ff = (ss - cum[j]) / (seg[j] + 1e-6); return P[j] + (P[j + 1] - P[j]) * ff
        tx, ty = at(s1) - at(s0); L = math.hypot(tx, ty) + 1e-6
        out.append((float(x), float(y), -ty / L, tx / L))
    return out

def render(mdir, out_dir):
    meta = json.load(open(os.path.join(mdir, 'parts.json'), encoding='utf-8'))
    rng = np.random.default_rng(7)
    rgb = np.zeros((SCALE, SCALE, 3), np.float32); alpha = np.zeros((SCALE, SCALE), np.float32)
    masks = []
    for pt in meta['parts']:
        m = np.asarray(Image.open(os.path.join(mdir, f"mask-{pt['i']}.png")).convert('RGBA'))[:, :, 3].astype(np.float32) / 255
        masks.append(m)
    sil = np.zeros((SCALE, SCALE), np.float32)
    for m in masks: sil = np.maximum(sil, m)
    sil_b = dilate(sil, 6) > 0.5                                              # 메로우 안쪽 기준 실루엣
    # ── 부품: 실 결 × 퍼프 × 광택
    for pt, m in zip(meta['parts'], masks):
        col = hex2rgb(pt['fill'])
        th = thread_shade(pt['angle'], 11.0, pt['i'] + 1)
        h = blur(m, 30); gy, gx = np.gradient(h); g = np.sqrt(gx * gx + gy * gy); nl = (gx * LIGHT[0] + gy * LIGHT[1]) / (g.max() + 1e-6)
        inner = blur(erode(m, 9), 14)                                          # 가장자리 안쪽 그늘
        puff = (1 + 0.42 * nl) * (0.86 + 0.18 * np.clip(h / (h.max() + 1e-6), 0, 1)) * (0.78 + 0.22 * inner)
        a = math.radians(pt['angle']); sheen = 1 + 0.10 * math.cos(2 * (a + math.radians(45)))
        grad = 1 + 0.08 * (-(XX - SCALE / 2) / SCALE - (YY - SCALE / 2) / SCALE)
        shade = np.clip(th * puff * sheen * grad, 0, 1.6)
        color = np.clip(col[None, None, :] * shade[:, :, None], 0, 1)
        if pt.get('outline', True):   # 부품 외곽 러닝 스티치(어두운 띠)
            band = np.clip(m - erode(m, 5), 0, 1)
            dark = np.array([0.08, 0.08, 0.09], np.float32)[None, None, :] * (0.85 + 0.3 * hnoise(np.floor(XX / 9) + np.floor(YY / 9) * 1000))[:, :, None]
            color = color * (1 - band[:, :, None]) + dark * band[:, :, None]
        a_m = m[:, :, None]
        rgb = rgb * (1 - a_m) + color * a_m; alpha = np.maximum(alpha, m)
    # ── 메로우 테두리: 실루엣 경계를 따라 수직 땀
    border = hex2rgb(meta.get('border') or '#1A1A1A')
    layer = Image.new('RGBA', (SCALE, SCALE), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    PITCH, WID, IN, OUTW = 8.5, 11.5, 14, 36
    cs = contours(sil_b)
    if not cs: raise SystemExit('no contour')
    for pts in cs:
        # 법선 방향이 실루엣 안쪽을 보면 뒤집는다
        samples = resample(pts, PITCH)
        xs, ys = int(samples[0][0]), int(samples[0][1]); nx, ny = samples[0][2], samples[0][3]
        px, py = int(min(SCALE - 1, max(0, xs + nx * 10))), int(min(SCALE - 1, max(0, ys + ny * 10)))
        flip = -1 if sil_b[py, px] else 1
        stitches = []
        for (x, y, nx, ny) in samples:
            nx *= flip; ny *= flip
            jl = 1 + (rng.random() - 0.5) * 0.05; ja = (rng.random() - 0.5) * 0.05
            c, s_ = math.cos(ja), math.sin(ja); nx2, ny2 = nx * c - ny * s_, nx * s_ + ny * c
            bright = (1 - 0.26 * (nx2 * LIGHT[0] + ny2 * LIGHT[1])) * (1 + (rng.random() - 0.5) * 0.10)
            stitches.append((x - nx2 * IN * jl, y - ny2 * IN * jl, x + nx2 * OUTW * jl, y + ny2 * OUTW * jl, bright))
        for (x0, y0, x1, y1, bright) in stitches:      # 1) 바탕: 겹치게 그려 틈 없는 띠
            base = tuple(int(255 * min(1, v)) for v in border * 0.70 * bright) + (255,)
            d.line([(x0, y0), (x1, y1)], fill=base, width=int(WID) + 3)
            d.ellipse([x1 - WID * 0.55, y1 - WID * 0.55, x1 + WID * 0.55, y1 + WID * 0.55], fill=base)
        for (x0, y0, x1, y1, bright) in stitches:      # 2) 올 하이라이트: 땀마다 한 줄, 가운데가 가장 밝게
            mid = tuple(int(255 * min(1, v)) for v in np.minimum(1, border * 1.05 * bright + 0.04)) + (255,)
            hi = tuple(int(255 * min(1, v)) for v in np.minimum(1, border * 1.35 * bright + 0.10)) + (255,)
            d.line([(x0, y0), (x1, y1)], fill=mid, width=max(2, int(WID * 0.55)))
            d.line([(x0 + (x1 - x0) * 0.15, y0 + (y1 - y0) * 0.15), (x0 + (x1 - x0) * 0.85, y0 + (y1 - y0) * 0.85)], fill=hi, width=max(1, int(WID * 0.22)))
    L = np.asarray(layer).astype(np.float32) / 255
    la = L[:, :, 3:4]; rgb = rgb * (1 - la) + L[:, :, :3] * la; alpha = np.maximum(alpha, L[:, :, 3])
    # ── 그림자
    sh = blur(np.roll(np.roll(alpha, 14, 0), 8, 1), 22) * 0.45
    out_a = np.clip(alpha + sh * (1 - alpha), 0, 1)
    out_rgb = (rgb * alpha[:, :, None]) / np.maximum(out_a, 1e-6)[:, :, None]   # 그림자 영역은 검정
    out_rgb = np.where(alpha[:, :, None] > 0.002, out_rgb, 0)
    # 프리멀티플라이로 축소(가장자리 어두운 테 방지)
    pm = np.concatenate([out_rgb * out_a[:, :, None], out_a[:, :, None]], 2)
    im = Image.fromarray((np.clip(pm, 0, 1) * 255).astype(np.uint8), 'RGBA').resize((OUT, OUT), Image.LANCZOS)
    arr = np.asarray(im).astype(np.float32) / 255; a2 = arr[:, :, 3:4]
    un = np.concatenate([np.clip(arr[:, :, :3] / np.maximum(a2, 1e-6), 0, 1), a2], 2)
    im = Image.fromarray((un * 255).astype(np.uint8), 'RGBA')
    bb = im.getchannel('A').getbbox(); im = im.crop((max(0, bb[0] - 4), max(0, bb[1] - 4), min(OUT, bb[2] + 4), min(OUT, bb[3] + 4)))
    os.makedirs(out_dir, exist_ok=True)
    fn = os.path.join(out_dir, meta['key'] + '.png')
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(fn, 'PNG', optimize=True)
    return {'key': meta['key'], 'name': meta['name'], 'category': meta['category'], 'tags': meta['tags'], 'file': os.path.basename(fn), 'w': im.width, 'h': im.height}

if __name__ == '__main__':
    mroot, out_dir = sys.argv[1], sys.argv[2]
    metas = json.load(open(os.path.join(mroot, 'meta.json'), encoding='utf-8'))
    res = []
    for m in metas:
        r = render(os.path.join(mroot, m['key']), out_dir); res.append(r)
        print(f"embroidered {r['key']} {r['w']}×{r['h']} {os.path.getsize(os.path.join(out_dir, r['file'])) // 1024}KB")
    json.dump(res, open(os.path.join(out_dir, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    if len(sys.argv) > 3:
        import subprocess
        subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sheet.py'), out_dir, sys.argv[3]], check=True)
