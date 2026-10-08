// 와펜 꾸미기 — 캔버스 에디터.
// 배치 모델(레이아웃 v1): { id, x, y, w, r, fx } — x,y 중심(캔버스 폭·높이 대비 0~1), w 폭(캔버스 폭 대비), r 각도(deg), fx 좌우반전.
// 배열 순서 = z. 화면 캔버스는 컨테이너에 맞춰 축소되지만 모든 계산은 캔버스 단위(W×H)로 하고 저장은 비율로 한다.
import { drawScene, itemGeom, hitTest, loadImage } from './render.js';
import { LAYOUT } from './presets.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (items) => items.map(it => ({ ...it }));
const norm = (it) => ({
    id: String(it.id), x: clamp(Number(it.x) || 0, LAYOUT.pos[0], LAYOUT.pos[1]), y: clamp(Number(it.y) || 0, LAYOUT.pos[0], LAYOUT.pos[1]),
    w: clamp(Number(it.w) || 0.2, LAYOUT.width[0], LAYOUT.width[1]), r: clamp(Number(it.r) || 0, LAYOUT.rot[0], LAYOUT.rot[1]), fx: !!it.fx,
});
const HANDLE_R = 14;   // CSS px
const HIT_PAD = 8;     // CSS px

export class WappenEditor {
    constructor(canvas, { W, H, base, layout, itemsById, onChange, onSelect }) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.W = W; this.H = H;
        this.base = base || null;
        this.itemsById = itemsById;            // id → { id, name, image_url, ... }
        this.imgs = new Map();                  // id → HTMLImageElement
        this.items = ((layout && layout.items) || []).map(norm);
        this.sel = -1;
        this.history = []; this.future = [];
        this.onChange = onChange || (() => {});
        this.onSelect = onSelect || (() => {});
        this.scale = 1; this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.pointers = new Map(); this.mode = null; this.g = null; this._before = null; this._batch = null;
        this.raf = 0; this.destroyed = false;

        this._onDown = (e) => this.pointerDown(e);
        this._onMove = (e) => this.pointerMove(e);
        this._onUp = (e) => this.pointerUp(e);
        this._onKey = (e) => this.keyDown(e);
        canvas.addEventListener('pointerdown', this._onDown);
        canvas.addEventListener('pointermove', this._onMove);
        canvas.addEventListener('pointerup', this._onUp);
        canvas.addEventListener('pointercancel', this._onUp);
        canvas.addEventListener('lostpointercapture', this._onUp);
        this._onGesture = (e) => e.preventDefault();   // iOS Safari: 캔버스 위 핀치가 페이지 확대로 새지 않게
        canvas.addEventListener('gesturestart', this._onGesture);
        canvas.addEventListener('gesturechange', this._onGesture);
        window.addEventListener('keydown', this._onKey);
        this.ro = new ResizeObserver(() => this.fit());
        this.ro.observe(canvas.parentElement);
        this.fit();
        this.preload();
    }

    async preload() {
        await Promise.all([...new Set(this.items.map(i => i.id))].map(id => this.ensureImg(id)));
        this.requestRender();
    }
    async ensureImg(id) {
        if (this.imgs.has(id)) return this.imgs.get(id);
        const meta = this.itemsById.get(id);
        const img = meta ? await loadImage(meta.image_url) : null;
        if (img) this.imgs.set(id, img);
        return img;
    }

    // 컨테이너에 맞춰 화면 배율 결정
    fit() {
        if (this.destroyed) return;
        const box = this.canvas.parentElement.getBoundingClientRect();
        const pad = 24;
        const s = Math.min((box.width - pad) / this.W, (box.height - pad) / this.H);
        this.scale = Math.max(0.02, s || 0.02);
        const cssW = Math.round(this.W * this.scale), cssH = Math.round(this.H * this.scale);
        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';
        this.canvas.width = Math.round(cssW * this.dpr);
        this.canvas.height = Math.round(cssH * this.dpr);
        this.requestRender();
    }

    toCanvas(e) {
        const r = this.canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width * this.W, y: (e.clientY - r.top) / r.height * this.H };
    }
    // 선택 항목의 크기·회전 핸들 위치 (로컬 우하단 모서리 → 월드)
    handlePos(i) {
        const it = this.items[i];
        const g = itemGeom(it, this.imgs.get(it.id), this.W, this.H);
        const c = Math.cos(g.rad), s = Math.sin(g.rad);
        const lx = g.w / 2, ly = g.h / 2;
        return { x: g.cx + lx * c - ly * s, y: g.cy + lx * s + ly * c, g };
    }

    requestRender() {
        if (this.raf || this.destroyed) return;
        this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
    }
    render() {
        const ctx = this.ctx, k = this.scale * this.dpr;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawScene(ctx, this.W, this.H, this.base, { items: this.items }, this.imgs);
        if (this.sel >= 0 && this.sel < this.items.length) {
            const it = this.items[this.sel];
            const g = itemGeom(it, this.imgs.get(it.id), this.W, this.H);
            const px = 1 / this.scale; // 화면 1px 에 해당하는 캔버스 단위
            ctx.save();
            ctx.translate(g.cx, g.cy); ctx.rotate(g.rad);
            ctx.lineWidth = 2 * px; ctx.strokeStyle = '#3366FF'; ctx.setLineDash([6 * px, 4 * px]);
            ctx.strokeRect(-g.w / 2, -g.h / 2, g.w, g.h);
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(g.w / 2, g.h / 2, HANDLE_R * px, 0, Math.PI * 2);
            ctx.fillStyle = '#3366FF'; ctx.fill(); ctx.lineWidth = 2 * px; ctx.strokeStyle = '#fff'; ctx.stroke();
            // 핸들 아이콘(↻)
            ctx.fillStyle = '#fff'; ctx.font = `${16 * px}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('⤡', g.w / 2, g.h / 2 + px);
            ctx.restore();
        }
    }

    // ── 제스처 ────────────────────────────────────────────
    pointerDown(e) {
        if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
        const p = this.toCanvas(e);
        this.pointers.set(e.pointerId, p);
        if (this.pointers.size === 1) {
            this._before = clone(this.items);
            const px = 1 / this.scale;
            if (this.sel >= 0) {
                const hp = this.handlePos(this.sel);
                if (Math.hypot(p.x - hp.x, p.y - hp.y) <= (HANDLE_R + 8) * px) {
                    const it = this.items[this.sel];
                    this.mode = 'handle';
                    this.g = { w0: it.w, r0: it.r, d0: Math.hypot(p.x - hp.g.cx, p.y - hp.g.cy) || 1, a0: Math.atan2(p.y - hp.g.cy, p.x - hp.g.cx), cx: hp.g.cx, cy: hp.g.cy };
                    return;
                }
            }
            const hit = hitTest(this.items, this.imgs, this.W, this.H, p.x, p.y, HIT_PAD * px);
            if (hit >= 0) {
                this.select(hit);
                const it = this.items[hit];
                this.mode = 'move';
                this.g = { offx: p.x - it.x * this.W, offy: p.y - it.y * this.H };
            } else {
                this.select(-1);
                this.mode = null;
            }
        } else if (this.pointers.size === 2 && this.sel >= 0) {
            const [a, b] = [...this.pointers.values()];
            const it = this.items[this.sel];
            this.mode = 'pinch';
            this.g = { w0: it.w, r0: it.r, x0: it.x, y0: it.y, d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x), mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2 };
        }
    }
    pointerMove(e) {
        if (!this.pointers.has(e.pointerId)) return;
        e.preventDefault();
        const p = this.toCanvas(e);
        this.pointers.set(e.pointerId, p);
        if (this.sel < 0 || !this.mode) return;
        const it = this.items[this.sel];
        if (this.mode === 'move' && this.pointers.size === 1) {
            it.x = clamp((p.x - this.g.offx) / this.W, LAYOUT.pos[0], LAYOUT.pos[1]);
            it.y = clamp((p.y - this.g.offy) / this.H, LAYOUT.pos[0], LAYOUT.pos[1]);
        } else if (this.mode === 'handle' && this.pointers.size === 1) {
            const d = Math.hypot(p.x - this.g.cx, p.y - this.g.cy);
            const a = Math.atan2(p.y - this.g.cy, p.x - this.g.cx);
            it.w = clamp(this.g.w0 * d / this.g.d0, LAYOUT.width[0], LAYOUT.width[1]);
            it.r = this.snapAngle(this.g.r0 + (a - this.g.a0) * 180 / Math.PI, e.shiftKey);
        } else if (this.mode === 'pinch' && this.pointers.size === 2) {
            const [a, b] = [...this.pointers.values()];
            const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
            it.w = clamp(this.g.w0 * d / this.g.d0, LAYOUT.width[0], LAYOUT.width[1]);
            it.r = this.snapAngle(this.g.r0 + (ang - this.g.a0) * 180 / Math.PI, false);
            it.x = clamp(this.g.x0 + ((a.x + b.x) / 2 - this.g.mx0) / this.W, LAYOUT.pos[0], LAYOUT.pos[1]);
            it.y = clamp(this.g.y0 + ((a.y + b.y) / 2 - this.g.my0) / this.H, LAYOUT.pos[0], LAYOUT.pos[1]);
        }
        this.requestRender();
    }
    pointerUp(e) {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.delete(e.pointerId);
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        if (this.pointers.size === 0) {
            this.mode = null; this.g = null;
            if (this._before && JSON.stringify(this._before) !== JSON.stringify(this.items)) this.pushHistory(this._before);
            this._before = null;
        } else if (this.pointers.size === 1 && this.sel >= 0) {
            // 두 손가락 → 한 손가락: 이동 모드로 이어가기
            const p = [...this.pointers.values()][0];
            const it = this.items[this.sel];
            this.mode = 'move'; this.g = { offx: p.x - it.x * this.W, offy: p.y - it.y * this.H };
        }
    }
    snapAngle(deg, precise) {
        let r = ((deg + 180) % 360 + 360) % 360 - 180;          // -180~180
        if (!precise) { const near = Math.round(r / 90) * 90; if (Math.abs(r - near) < 3) r = near === 180 ? -180 : near; }
        return Math.round(r * 100) / 100;
    }
    keyDown(e) {
        if (this.destroyed) return;
        const tag = (e.target && e.target.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
        if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); this.redo(); return; }
        if (this.sel < 0) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(); return; }
        const step = (e.shiftKey ? 10 : 1) / this.scale / this.W;   // 화면 1px(Shift: 10px) 단위 — 프로젝트 px 1 은 큰 캔버스에선 보이지 않는다
        const it = this.items[this.sel];
        const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step * this.W / this.H], ArrowDown: [0, step * this.W / this.H] }[e.key];
        if (!nudge) return;
        e.preventDefault();
        this.mutate(() => { it.x = clamp(it.x + nudge[0], LAYOUT.pos[0], LAYOUT.pos[1]); it.y = clamp(it.y + nudge[1], LAYOUT.pos[0], LAYOUT.pos[1]); });
    }

    // ── 편집 API ──────────────────────────────────────────
    select(i) {
        const prev = this.sel;
        this.sel = i >= 0 && i < this.items.length ? i : -1;
        if (prev !== this.sel) this.onSelect(this.sel >= 0 ? this.items[this.sel] : null);
        this.requestRender();
    }
    mutate(fn) {
        const before = clone(this.items);
        fn();
        if (JSON.stringify(before) !== JSON.stringify(this.items)) this.pushHistory(before);
        this.requestRender();
    }
    pushHistory(before) {
        this.history.push(before);
        if (this.history.length > 50) this.history.shift();
        this.future = [];
        this.onChange();
    }
    undo() { if (!this.history.length) return; this.future.push(clone(this.items)); this.items = this.history.pop(); this.sel = Math.min(this.sel, this.items.length - 1); this.onSelect(this.sel >= 0 ? this.items[this.sel] : null); this.onChange(); this.preload(); }
    redo() { if (!this.future.length) return; this.history.push(clone(this.items)); this.items = this.future.pop(); this.sel = Math.min(this.sel, this.items.length - 1); this.onSelect(this.sel >= 0 ? this.items[this.sel] : null); this.onChange(); this.preload(); }
    get canUndo() { return this.history.length > 0; }
    get canRedo() { return this.future.length > 0; }

    async add(meta) {
        if (this.items.length >= LAYOUT.maxItems) return false;
        const img = await this.ensureImg(meta.id);
        if (!img) return false;
        // 기본 크기: 캔버스 폭의 28%, 높이가 캔버스 45% 를 넘지 않게
        let w = 0.28;
        const ratio = img.naturalHeight / img.naturalWidth;
        if (w * this.W * ratio > this.H * 0.45) w = (this.H * 0.45) / ratio / this.W;
        const jitter = (this.items.length % 5) * 0.02;
        this.mutate(() => { this.items.push({ id: meta.id, x: 0.5 + jitter, y: 0.5 + jitter, w, r: 0, fx: false }); });
        this.select(this.items.length - 1);
        return true;
    }
    remove() { if (this.sel < 0) return; this.mutate(() => { this.items.splice(this.sel, 1); }); this.select(-1); }
    duplicate() {
        if (this.sel < 0 || this.items.length >= LAYOUT.maxItems) return;
        const src = this.items[this.sel];
        this.mutate(() => { this.items.splice(this.sel + 1, 0, { ...src, x: clamp(src.x + 0.03, LAYOUT.pos[0], LAYOUT.pos[1]), y: clamp(src.y + 0.03, LAYOUT.pos[0], LAYOUT.pos[1]) }); });
        this.select(this.sel + 1);
    }
    flip() { if (this.sel < 0) return; const it = this.items[this.sel]; this.mutate(() => { it.fx = !it.fx; }); }
    rotateBy(deg) { if (this.sel < 0) return; const it = this.items[this.sel]; this.mutate(() => { it.r = this.snapAngle(it.r + deg, true); }); }
    // ── 레이어 패널용 다중 편집 API (indices = 항목 인덱스 배열) ──────────
    // 순서 변경: 선택 항목들의 상대 순서를 유지한 채 맨 앞(front)/한 칸 앞(forward)/한 칸 뒤(backward)/맨 뒤(back). 움직인 항목들의 새 인덱스를 돌려준다.
    reorder(indices, where) {
        const set = new Set(indices.filter(i => i >= 0 && i < this.items.length));
        if (!set.size) return [];
        const selObj = this.sel >= 0 ? this.items[this.sel] : null;
        const picked = this.items.filter((_, i) => set.has(i));
        this.mutate(() => {
            if (where === 'front' || where === 'back') {
                const rest = this.items.filter((_, i) => !set.has(i));
                this.items = where === 'front' ? rest.concat(picked) : picked.concat(rest);
            } else if (where === 'forward') {
                for (let i = this.items.length - 2; i >= 0; i--) if (set.has(i) && !set.has(i + 1)) { [this.items[i], this.items[i + 1]] = [this.items[i + 1], this.items[i]]; set.delete(i); set.add(i + 1); }
            } else if (where === 'backward') {
                for (let i = 1; i < this.items.length; i++) if (set.has(i) && !set.has(i - 1)) { [this.items[i], this.items[i - 1]] = [this.items[i - 1], this.items[i]]; set.delete(i); set.add(i - 1); }
            }
        });
        this.sel = selObj ? this.items.indexOf(selObj) : -1;
        this.requestRender();
        return picked.map(o => this.items.indexOf(o));
    }
    // 세부 이동 — dx·dy 는 비율 단위(캔버스 폭·높이 대비). beginBatch() 중이면 이력을 쌓지 않고 endBatch() 때 한 번만 쌓는다(누르고 있는 동안 반복 이동용).
    moveBy(indices, dx, dy) {
        const list = [...new Set(indices)].map(i => this.items[i]).filter(Boolean);
        if (!list.length) return;
        const apply = () => { for (const it of list) { it.x = clamp(it.x + dx, LAYOUT.pos[0], LAYOUT.pos[1]); it.y = clamp(it.y + dy, LAYOUT.pos[0], LAYOUT.pos[1]); } };
        if (this._batch) { apply(); this.requestRender(); } else this.mutate(apply);
    }
    beginBatch() { if (!this._batch) this._batch = clone(this.items); }
    endBatch() { const b = this._batch; this._batch = null; if (b && JSON.stringify(b) !== JSON.stringify(this.items)) this.pushHistory(b); this.requestRender(); }
    setPos(i, x, y) {   // 비율 단위. null 이면 그 축은 그대로
        const it = this.items[i]; if (!it) return;
        this.mutate(() => { if (x != null && Number.isFinite(x)) it.x = clamp(x, LAYOUT.pos[0], LAYOUT.pos[1]); if (y != null && Number.isFinite(y)) it.y = clamp(y, LAYOUT.pos[0], LAYOUT.pos[1]); });
    }
    removeMany(indices) {
        const set = new Set(indices.filter(i => i >= 0 && i < this.items.length)); if (!set.size) return;
        const selObj = this.sel >= 0 && !set.has(this.sel) ? this.items[this.sel] : null;
        this.mutate(() => { this.items = this.items.filter((_, i) => !set.has(i)); });
        const prev = this.sel; this.sel = selObj ? this.items.indexOf(selObj) : -1;
        if (prev !== this.sel) this.onSelect(this.selected);
        this.requestRender();
    }

    forward() { if (this.sel < 0 || this.sel >= this.items.length - 1) return; this.mutate(() => { const [it] = this.items.splice(this.sel, 1); this.items.splice(this.sel + 1, 0, it); }); this.select(this.sel + 1); }
    backward() { if (this.sel <= 0) return; this.mutate(() => { const [it] = this.items.splice(this.sel, 1); this.items.splice(this.sel - 1, 0, it); }); this.select(this.sel - 1); }
    clear() { if (!this.items.length) return; this.mutate(() => { this.items.length = 0; }); this.select(-1); }
    setBase(img) { this.base = img; this.requestRender(); }

    toLayout() { return { v: LAYOUT.version, items: this.items.map(it => ({ id: it.id, x: +it.x.toFixed(5), y: +it.y.toFixed(5), w: +it.w.toFixed(5), r: +it.r.toFixed(2), fx: !!it.fx })) }; }
    get selected() { return this.sel >= 0 ? this.items[this.sel] : null; }

    destroy() {
        this.destroyed = true;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.ro.disconnect();
        const c = this.canvas;
        c.removeEventListener('pointerdown', this._onDown);
        c.removeEventListener('pointermove', this._onMove);
        c.removeEventListener('pointerup', this._onUp);
        c.removeEventListener('pointercancel', this._onUp);
        c.removeEventListener('lostpointercapture', this._onUp);
        c.removeEventListener('gesturestart', this._onGesture);
        c.removeEventListener('gesturechange', this._onGesture);
        window.removeEventListener('keydown', this._onKey);
    }
}
