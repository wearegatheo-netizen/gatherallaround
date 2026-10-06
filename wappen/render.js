// 와펜 꾸미기 — 합성 렌더러. 에디터 화면·저장용 미리보기·고해상도 내보내기가 모두 같은 drawScene 을 쓴다.
// 좌표계: 레이아웃은 캔버스 폭·높이 대비 비율(0~1)로 저장되므로 어떤 해상도(W×H)로도 동일하게 그려진다.
// 이미지는 전부 crossOrigin='anonymous' 로 불러온다 (Supabase 공개 스토리지는 CORS * → 캔버스 오염 없음).

const imgCache = new Map();

export function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (imgCache.has(url)) return imgCache.get(url);
    const p = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => { imgCache.delete(url); resolve(null); };
        img.src = url;
    });
    imgCache.set(url, p);
    return p;
}

// id → image_url 맵을 받아 id → HTMLImageElement 맵으로
export async function loadItemImages(itemsById, ids) {
    const out = new Map();
    await Promise.all([...new Set(ids)].map(async (id) => {
        const meta = itemsById.get(id);
        const img = meta ? await loadImage(meta.image_url) : null;
        if (img) out.set(id, img);
    }));
    return out;
}

export function itemGeom(it, img, W, H) {
    const w = it.w * W;
    const ratio = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
    return { cx: it.x * W, cy: it.y * H, w, h: w * ratio, rad: (it.r || 0) * Math.PI / 180 };
}

// 기본 이미지: cover-fit (짧은 쪽을 꽉 채우고 넘치는 쪽은 중앙 크롭)
export function drawBase(ctx, W, H, base, bg = '#ffffff') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!base || !base.naturalWidth) return;
    const k = Math.max(W / base.naturalWidth, H / base.naturalHeight);
    const w = base.naturalWidth * k, h = base.naturalHeight * k;
    ctx.drawImage(base, (W - w) / 2, (H - h) / 2, w, h);
}

export function drawScene(ctx, W, H, base, layout, imgsById) {
    drawBase(ctx, W, H, base);
    const items = (layout && layout.items) || [];
    for (const it of items) {
        const img = imgsById.get(it.id);
        if (!img) continue;
        const g = itemGeom(it, img, W, H);
        ctx.save();
        ctx.translate(g.cx, g.cy);
        ctx.rotate(g.rad);
        if (it.fx) ctx.scale(-1, 1);
        ctx.drawImage(img, -g.w / 2, -g.h / 2, g.w, g.h);
        ctx.restore();
    }
}

// 회전 사각형 히트테스트 — 점을 아이템 로컬 좌표로 역회전해 AABB 판정. 위(z 큰)부터 검사.
export function hitTest(items, imgsById, W, H, px, py, pad = 0) {
    for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const g = itemGeom(it, imgsById.get(it.id), W, H);
        const dx = px - g.cx, dy = py - g.cy;
        const c = Math.cos(g.rad), s = Math.sin(g.rad);
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        if (Math.abs(lx) <= g.w / 2 + pad && Math.abs(ly) <= g.h / 2 + pad) return i;
    }
    return -1;
}

// 큰 캔버스는 iOS/Chrome 에서 조용히 실패한다(그려도 투명). 1px 써보고 읽어서 확인.
export function probeCanvas(w, h) {
    try {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(w - 1, h - 1, 1, 1);
        const d = ctx.getImageData(w - 1, h - 1, 1, 1).data;
        if (d[3] !== 255) { c.width = c.height = 0; return null; }
        return c;
    } catch (_) { return null; }
}

export function canvasToBlob(canvas, mime = 'image/png', quality = 0.92) {
    return new Promise((resolve) => {
        try { canvas.toBlob((b) => resolve(b || null), mime, quality); }
        catch (_) { resolve(null); }
    });
}

export async function renderToBlob({ W, H, base, layout, imgsById, mime = 'image/png', quality = 0.92 }) {
    const c = probeCanvas(W, H);
    if (!c) return null;
    try {
        drawScene(c.getContext('2d'), W, H, base, layout, imgsById);
        return await canvasToBlob(c, mime, quality);
    } finally { c.width = c.height = 0; }
}

// 해상도 후보를 큰 것부터 시도 — 기기 한계로 실패하면 다음 후보로. 성공한 크기를 함께 돌려준다.
export async function exportWithFallback({ sizes, base, layout, imgsById, mime, quality, onTry }) {
    for (const s of sizes) {
        if (onTry) onTry(s);
        const blob = await renderToBlob({ W: s.w, H: s.h, base, layout, imgsById, mime, quality });
        if (blob) return { blob, w: s.w, h: s.h, dpi: s.dpi };
    }
    return null;
}

// 갤러리·공유용 미리보기(긴 변 maxEdge, JPEG)
export async function renderPreview({ W, H, base, layout, imgsById, maxEdge = 1080, mime = 'image/jpeg', quality = 0.85 }) {
    const k = Math.min(1, maxEdge / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const blob = await renderToBlob({ W: w, H: h, base, layout, imgsById, mime, quality });
    return blob ? { blob, w, h } : null;
}

// ── 업로드 전 이미지 처리 ───────────────────────────────────────
export async function decodeFile(file) {
    if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) {}
        try { return await createImageBitmap(file); } catch (_) {}
    }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
    });
}
const srcW = (s) => s.naturalWidth || s.width, srcH = (s) => s.naturalHeight || s.height;

// aspect(w/h) 가 있으면 그 비율로 cover 크롭(offset 0~1: 넘치는 축에서 어느 쪽을 남길지), 긴 변 ≤ maxEdge 로 축소.
export async function fitImage(src, { maxEdge = 4096, mime = 'image/jpeg', quality = 0.9, aspect = null, offset = 0.5 } = {}) {
    const sw = srcW(src), sh = srcH(src);
    let cx = 0, cy = 0, cw = sw, ch = sh;
    if (aspect) {
        if (sw / sh > aspect) { cw = Math.round(sh * aspect); cx = Math.round((sw - cw) * offset); }
        else { ch = Math.round(sw / aspect); cy = Math.round((sh - ch) * offset); }
    }
    const k = Math.min(1, maxEdge / Math.max(cw, ch));
    const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    const c = probeCanvas(w, h);
    if (!c) throw new Error('canvas');
    try {
        const ctx = c.getContext('2d');
        if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(src, cx, cy, cw, ch, 0, 0, w, h);
        const blob = await canvasToBlob(c, mime, quality);
        if (!blob) throw new Error('encode');
        return { blob, w, h };
    } finally { c.width = c.height = 0; }
}

// 크롭 미리보기 — 작은 캔버스에 같은 크롭을 그려 보여준다
export function drawCropPreview(canvas, src, { aspect, offset = 0.5, maxW = 480 }) {
    const sw = srcW(src), sh = srcH(src);
    let cx = 0, cy = 0, cw = sw, ch = sh;
    if (aspect) {
        if (sw / sh > aspect) { cw = Math.round(sh * aspect); cx = Math.round((sw - cw) * offset); }
        else { ch = Math.round(sw / aspect); cy = Math.round((sh - ch) * offset); }
    }
    const k = Math.min(1, maxW / cw, 360 / ch);
    canvas.width = Math.max(1, Math.round(cw * k)); canvas.height = Math.max(1, Math.round(ch * k));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
    return { needsOffset: aspect ? Math.abs(sw / sh - aspect) > 0.01 : false };
}
