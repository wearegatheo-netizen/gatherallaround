// 와펜 꾸미기 — 앱 본체 (ESM). 라우터·뷰·API 클라이언트·인증·공유·다운로드.
// 읽기는 anon supabase-js(공개 테이블·RPC), 쓰기는 전부 /wappen-api (세션 토큰).
// 사용자 입력은 esc() 를 거쳐 innerHTML 에 넣고, 이벤트는 data-act 위임으로 처리한다(인라인 onclick 금지).
import { PRESETS, GROUPS, presetOf, presetDims, presetLabel, exportSizes, isValidSize, REACTIONS, REPORT_REASONS, LIMITS, LAYOUT } from './presets.js';
import { loadImage, loadItemImages, exportWithFallback, renderPreview, decodeFile, fitImage, drawCropPreview } from './render.js';
import { WappenEditor } from './editor.js';

// ── 설정 (본 사이트 index.html 과 동일 값) ──────────────────────────
const SUPABASE_URL = 'https://xdcygyvsybsirmaknmpq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkY3lneXZzeWJzaXJtYWtubXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNTMxNTIsImV4cCI6MjA5MzcyOTE1Mn0.KknBzg2OfcsVawxp0BTBJuwXMWX6tNZo-6nCm64nGeI';
const KAKAO_KEY = '9627dd6537f30f1c42b30de51ceea2cf';
const API_URL = '/wappen-api';
const SITE_URL = 'https://gatherallaround.com/wappen/';
const SESSION_KEY = 'wappen_session';
const RETURN_KEY = 'wappen_return';
const PAGE = 24;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 공용 유틸 ──────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
// 16px 단색 선 아이콘(24 viewBox, currentColor). 버튼·시트·탭에서 이모지 대신 쓴다 — 기기마다 모양이 같고 글자색을 따른다.
const ICONS = {
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    remix: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    more: '<circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/><circle cx="5" cy="12" r="1.6" fill="currentColor"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
    'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    redo: '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
    flip: '<line x1="12" y1="3" x2="12" y2="21"/><path d="M9 7H5v10h4"/><path d="M15 7h4v10h-4" stroke-dasharray="2.5 2"/>',
    'rotate-ccw': '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    'rotate-cw': '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    'layer-up': '<polyline points="7 10 12 5 17 10"/><line x1="12" y1="5" x2="12" y2="16"/><line x1="5" y1="20" x2="19" y2="20"/>',
    'layer-down': '<polyline points="7 14 12 19 17 14"/><line x1="12" y1="19" x2="12" y2="8"/><line x1="5" y1="4" x2="19" y2="4"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    brush: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
    trophy: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
};
const icon = (name, cls = '') => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
function timeAgo(iso) {
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return '방금'; if (d < 3600) return `${Math.floor(d / 60)}분 전`; if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
    if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`; return fmtDate(iso);
}
let toastTimer = 0;
function showToast(msg, ms = 3200) {
    const t = $('#auto-toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
const AV_COLORS = ['#3366FF', '#7B5CFF', '#E0529C', '#F2994A', '#27AE60', '#00A3BF', '#8E6E53'];
function avatarHTML(name, url, cls = '') {
    if (url) return `<img class="avatar ${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    const s = String(name || '?'); let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `<span class="avatar ${cls}" style="background:${AV_COLORS[h % AV_COLORS.length]}">${esc(s.slice(0, 1))}</span>`;
}
const loadingHTML = (msg = '불러오는 중…') => `<div class="wp-loading">${esc(msg)}</div>`;
const emptyHTML = (icon, msg, sub = '') => `<div class="empty"><div class="big">${icon}</div><div>${esc(msg)}</div>${sub ? `<div class="muted" style="margin-top:6px">${sub}</div>` : ''}</div>`;
const errorHTML = (msg = '불러오지 못했습니다. 잠시 후 다시 시도해주세요.') => emptyHTML('😵', msg);
const sizeBadge = (p) => `<span class="size-badge">${esc(presetOf(p.size_key)?.label || p.size_key)}${p.size_group === 'print' ? (p.orientation === 'landscape' ? ' 가로' : ' 세로') : ''}</span>`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const hashQuery = (path, obj) => { const sp = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v != null && v !== '' && v !== 0 && v !== false) sp.set(k, v); const q = sp.toString(); return `#${path}${q ? '?' + q : ''}`; };

// ── 모달 ───────────────────────────────────────────────────────────
function openModal(html, { sheet = false, onClose } = {}) {
    const root = $('#modal-root');
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop' + (sheet ? ' sheet' : '');
    bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { if (!bd.isConnected) return; bd.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
    bd.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    root.appendChild(bd);
    return { el: bd, modal: $('.modal', bd), close };
}
function confirmModal({ title, body = '', okLabel = '확인', danger = false, cancelLabel = '취소' }) {
    return new Promise((resolve) => {
        const m = openModal(`<h3>${esc(title)}</h3>${body ? `<p class="muted">${body}</p>` : ''}
            <div class="modal-actions"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-close>${esc(cancelLabel)}</button>
            <button type="button" class="gaa-btn gaa-btn-sm ${danger ? 'gaa-btn-danger' : 'gaa-btn-primary'}" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => resolve(false) });
        $('[data-ok]', m.el).addEventListener('click', () => { resolve(true); m.close(); });
    });
}
function promptModal({ title, label = '', value = '', max = 60, placeholder = '', okLabel = '확인', multiline = false }) {
    return new Promise((resolve) => {
        let result = null;
        const m = openModal(`<h3>${esc(title)}</h3>${label ? `<label class="wp-label">${esc(label)}</label>` : ''}
            ${multiline ? `<textarea class="wp-textarea" maxlength="${max}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="wp-input" maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}
            <div class="modal-actions"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-close>취소</button>
            <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => resolve(result) });
        const input = $(multiline ? 'textarea' : 'input', m.el);
        input.focus(); if (!multiline) input.select();
        const ok = () => { result = input.value.trim(); m.close(); };
        $('[data-ok]', m.el).addEventListener('click', ok);
        if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    });
}

// ── 테마 (본 사이트와 같은 키) ──────────────────────────────────────
function applyTheme(t) {
    document.body.classList.toggle('dark', t === 'dark');
    const b = $('#themeBtn'); if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
}
function initTheme() {
    let t = 'light'; try { t = localStorage.getItem('gaa_theme') || 'light'; } catch (_) {}
    applyTheme(t);
    $('#themeBtn').addEventListener('click', () => {
        const n = document.body.classList.contains('dark') ? 'light' : 'dark';
        try { localStorage.setItem('gaa_theme', n); } catch (_) {}
        applyTheme(n);
    });
}

// ── 상태·API ───────────────────────────────────────────────────────
const state = { session: null, me: null, items: null, itemsById: new Map(), categories: [] };
try { state.session = localStorage.getItem(SESSION_KEY) || null; } catch (_) {}

async function api(action, payload = {}) {
    let out = null;
    try {
        const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...(state.session ? { session: state.session } : {}), ...payload }) });
        out = await res.json().catch(() => null);
    } catch (_) {}
    if (!out) return { ok: false, error: 'network', message: '서버와 통신하지 못했습니다. 잠시 후 다시 시도해주세요.' };
    if (!out.ok && out.error === 'auth' && action !== 'login' && state.session) { clearSession(); renderAuthSlot(); }
    if (!out.ok && out.detail) console.error('[wappen-api]', action, out.error, out.detail);
    return out;
}
function clearSession() { state.session = null; state.me = null; try { localStorage.removeItem(SESSION_KEY); } catch (_) {} }
function initKakao() { try { if (window.Kakao && !Kakao.isInitialized()) Kakao.init(KAKAO_KEY); } catch (e) { console.error('Kakao init', e); } }
async function loginWithToken(token) {
    const out = await api('login', { kakao_token: token });
    if (!out.ok) { showToast(out.message || '로그인에 실패했습니다.'); return false; }
    state.session = out.session; state.me = out.user;
    try { localStorage.setItem(SESSION_KEY, out.session); } catch (_) {}
    renderAuthSlot();
    showToast(`${out.user.nickname}님, 환영합니다!`);
    return true;
}
function kakaoLogin() {
    return new Promise((resolve) => {
        initKakao();
        if (!window.Kakao || !Kakao.Auth) { showToast('카카오 SDK를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.'); return resolve(false); }
        // 일부 인앱 브라우저는 팝업 대신 리다이렉트로 돌아온다 → 복귀 마커를 남겨 부트에서 자동 로그인
        try { sessionStorage.setItem(RETURN_KEY, location.hash || '#/'); } catch (_) {}
        Kakao.Auth.login({
            success: async (auth) => { try { sessionStorage.removeItem(RETURN_KEY); } catch (_) {} resolve(await loginWithToken(auth.access_token)); },
            fail: (err) => { try { sessionStorage.removeItem(RETURN_KEY); } catch (_) {} console.error('kakao login', err); showToast('카카오 로그인에 실패했습니다. 다시 시도해주세요.'); resolve(false); },
        });
    });
}
async function logout() {
    if (state.session) api('logout');
    clearSession();
    try { if (window.Kakao && Kakao.Auth) { if (Kakao.Auth.getAccessToken()) Kakao.Auth.logout(() => {}); Kakao.Auth.setAccessToken(null); } } catch (_) {}
    renderAuthSlot(); showToast('로그아웃 되었습니다.');
    navigate('#/');
}
async function bootAuth() {
    if (state.session) {
        const out = await api('me');
        if (out.ok) state.me = out.user; else if (out.error === 'auth') clearSession();
    }
    if (!state.me) {
        let ret = null; try { ret = sessionStorage.getItem(RETURN_KEY); } catch (_) {}
        if (ret !== null) {
            try { sessionStorage.removeItem(RETURN_KEY); } catch (_) {}
            initKakao();
            let t = null; try { t = window.Kakao && Kakao.Auth && Kakao.Auth.getAccessToken(); } catch (_) {}
            if (t && await loginWithToken(t) && ret && ret !== location.hash) location.hash = ret;
        }
    }
    renderAuthSlot();
}
// 로그인 필요 동작 — 모달로 안내 후 로그인되면 true
function requireLogin(msg = '이 기능은 카카오 로그인 후 이용할 수 있어요.') {
    if (state.me) return Promise.resolve(true);
    return new Promise((resolve) => {
        let done = false;
        const m = openModal(`<h3>로그인이 필요해요</h3><p class="muted" style="margin:0 0 14px">${esc(msg)}<br>가입 절차 없이 카카오 로그인만 하면 바로 시작할 수 있어요.</p>
            <div class="stack" style="align-items:center"><button type="button" class="kakao-btn lg" data-kakao>${icon('chat')} 카카오로 시작하기</button>
            <button type="button" class="gaa-btn gaa-btn-ghost gaa-btn-sm" data-close>나중에</button></div>`, { onClose: () => { if (!done) resolve(false); } });
        $('[data-kakao]', m.el).addEventListener('click', async () => { const ok = await kakaoLogin(); done = true; m.close(); resolve(ok); });
    });
}
function renderAuthSlot() {
    const slot = $('#authSlot'); if (!slot) return;
    if (state.me) {
        slot.innerHTML = `<a class="wp-avatar-btn" href="#/me" title="내 페이지">${avatarHTML(state.me.nickname, state.me.avatar_url)}<span>${esc(state.me.nickname)}</span></a>`;
    } else {
        slot.innerHTML = `<button type="button" class="kakao-btn" data-login>${icon('chat')} 로그인</button>`;
        $('[data-login]', slot).addEventListener('click', () => kakaoLogin());
    }
    const adminLink = $('#mainNav a[data-nav="admin"]');
    if (state.me && state.me.is_admin && !adminLink) $('#mainNav').insertAdjacentHTML('beforeend', '<a href="#/admin" data-nav="admin">관리</a>');
    if (!(state.me && state.me.is_admin) && adminLink) adminLink.remove();
}

// ── 읽기 (anon supabase-js) ────────────────────────────────────────
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
async function q(builder) {
    const { data, error } = await builder;
    if (error) { console.error('[supabase]', error); throw new Error(error.message || 'db'); }
    return data;
}
function fetchProjects({ group, size, text, sort = 'new', page = 0 } = {}) {
    let b = sb.from('wappen_projects').select('*').eq('status', 'active');
    if (size) b = b.eq('size_key', size); else if (group) b = b.eq('size_group', group);
    if (text) b = b.ilike('title', `%${text.replace(/[%_,()]/g, ' ').trim()}%`);
    b = sort === 'popular' ? b.order('works_count', { ascending: false }).order('created_at', { ascending: false }) : b.order('created_at', { ascending: false });
    return q(b.range(page * PAGE, page * PAGE + PAGE));   // PAGE+1 개 받아 다음 페이지 유무 판단
}
const fetchProject = (id) => q(sb.from('wappen_projects').select('*').eq('id', id).maybeSingle());
function fetchWorks({ project_id, sort = 'popular', page = 0, limit = PAGE } = {}) {
    let b = sb.from('wappen_works').select('*, wappen_projects(id,title,size_key,size_group,orientation)').eq('status', 'active');
    if (project_id) b = b.eq('project_id', project_id);
    b = sort === 'popular' ? b.order('reaction_count', { ascending: false }).order('created_at', { ascending: false }) : b.order('created_at', { ascending: false });
    return q(b.range(page * limit, page * limit + limit));
}
const fetchWork = (id) => q(sb.from('wappen_works').select('*, wappen_projects(*)').eq('id', id).maybeSingle());
async function fetchItems(force = false) {
    if (state.items && !force) return state.items;
    const items = await q(sb.from('wappen_items').select('*').eq('status', 'active').order('category').order('sort_order').order('created_at'));
    state.items = items; state.itemsById = new Map(items.map(i => [i.id, i]));
    state.categories = [...new Set(items.map(i => i.category))];
    return items;
}
const fetchRanking = (period, size, limit = 50) => q(sb.rpc('wappen_ranking', { p_period: period, p_size_key: size || null, p_limit: limit }));

// 서명 업로드: 서버가 경로·권한을 정해 토큰 발급 → 브라우저가 Storage 로 직접 PUT (Content-Type 필수)
async function uploadBlob(kind, blob, ext) {
    const sign = await api('upload_sign', { kind, ext });
    if (!sign.ok) throw new Error(sign.message || '업로드 준비에 실패했습니다.');
    const put = await fetch(sign.upload_url, { method: 'PUT', body: blob,
        headers: { 'Content-Type': sign.content_type, apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'x-upsert': 'false' } });
    if (!put.ok) throw new Error(`이미지 업로드에 실패했습니다 (${put.status})`);
    return sign.public_url;
}
const extOf = (mime) => mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

// ── 라우터 ─────────────────────────────────────────────────────────
function parseHash() {
    let h = location.hash || '#/';
    if (!h.startsWith('#/')) h = '#/' + h.replace(/^#\/?/, '');
    const [pathPart, queryPart = ''] = h.slice(2).split('?');
    const segs = pathPart.split('/').filter(Boolean);
    return { segs, params: new URLSearchParams(queryPart), hash: h };
}
const navigate = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
const replaceHash = (hash) => { history.replaceState(null, '', location.pathname + location.search + hash); };
let cleanup = null;
const setCleanup = (fn) => { cleanup = fn; };
// 뷰 안에서 #app 에 거는 위임 리스너는 반드시 이걸로 — 다음 render() 때 자동 해제(누적 방지)
let viewAbort = null;
const onAppClick = (fn) => app.addEventListener('click', fn, { signal: viewAbort.signal });
function setActiveNav(key) { $$('#mainNav a, #bottomNav a').forEach(a => a.classList.toggle('active', a.dataset.nav === key)); }

async function render() {
    if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
    if (viewAbort) viewAbort.abort();
    viewAbort = new AbortController();
    document.body.classList.remove('editing');
    const r = parseHash();
    const top = r.segs[0] || 'home';
    setActiveNav({ home: 'home', ranking: 'ranking', items: 'items', request: 'items', new: 'new', admin: 'admin', me: 'me' }[top] || '');
    app.className = 'wp-container';
    app.innerHTML = loadingHTML();
    window.scrollTo(0, 0);
    try {
        switch (top) {
            case 'home': return await viewHome(r);
            case 'project': return UUID_RE.test(r.segs[1] || '') ? await viewProject(r) : viewNotFound();
            case 'new': return await viewNew(r);
            case 'edit': return UUID_RE.test(r.segs[1] || '') ? await viewEdit(r) : viewNotFound();
            case 'work': return UUID_RE.test(r.segs[1] || '') ? await viewWork(r) : viewNotFound();
            case 'ranking': return await viewRanking(r);
            case 'items': return await viewItems(r);
            case 'request': return await viewRequest(r);
            case 'me': return await viewMe(r);
            case 'admin': return await viewAdmin(r);
            default: return viewNotFound();
        }
    } catch (e) {
        console.error(e);
        app.innerHTML = errorHTML();
    }
}
function viewNotFound() {
    app.innerHTML = emptyHTML('🧩', '페이지를 찾을 수 없습니다.', '<a href="#/" class="gaa-btn gaa-btn-sm gaa-btn-secondary">홈으로</a>');
}

// ── 공용 카드·조각 ──────────────────────────────────────────────────
function projectCardHTML(p) {
    return `<a class="card" href="#/project/${p.id}">
        <div class="card-thumb"><img src="${esc(p.thumb_url || p.base_image_url)}" alt="" loading="lazy">
            <div class="badge-tl">${sizeBadge(p)}</div><div class="badge-br"><span class="count-badge">🧩 ${num(p.works_count)}</span></div></div>
        <div class="card-body"><div class="card-title">${esc(p.title)}</div>
            <div class="card-meta">${avatarHTML(p.author_name, p.author_avatar)}<span>${esc(p.author_name)}</span><span>·</span><span>${timeAgo(p.created_at)}</span></div></div></a>`;
}
function workCardHTML(w, { showProject = true } = {}) {
    const p = w.wappen_projects;
    return `<a class="card" href="#/work/${w.id}">
        <div class="card-thumb"><img src="${esc(w.preview_url)}" alt="" loading="lazy">
            ${p ? `<div class="badge-tl">${sizeBadge(p)}</div>` : ''}<div class="badge-br"><span class="count-badge">❤️ ${num(w.reaction_count)}</span></div></div>
        <div class="card-body"><div class="card-title">${esc(w.title)}</div>
            <div class="card-meta">${avatarHTML(w.author_name, w.author_avatar)}<span>${esc(w.author_name)}</span>${showProject && p ? `<span>·</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</span>` : ''}</div></div></a>`;
}
function pagerHTML(page, hasMore, makeHash) {
    if (page === 0 && !hasMore) return '';
    return `<div class="pager">${page > 0 ? `<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="${makeHash(page - 1)}">${icon('back')} 이전</a>` : ''}
        <span class="muted">${page + 1}페이지</span>
        ${hasMore ? `<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="${makeHash(page + 1)}">다음 ${icon('chevron')}</a>` : ''}</div>`;
}
function sizeChipsHTML(group, size, makeHash) {
    const groups = ['', 'print', 'sns'].map(g => `<a class="chip ${(group || '') === g && !size ? 'active' : ''}" href="${makeHash({ group: g, size: '' })}">${g ? GROUPS[g] : '전체'}</a>`).join('');
    const sizes = group ? PRESETS.filter(p => p.group === group).map(p => `<a class="chip sm ${size === p.key ? 'active' : ''}" href="${makeHash({ group, size: p.key })}">${esc(p.label)}</a>`).join('') : '';
    return `<div class="chips">${groups}</div>${sizes ? `<div class="chips scroll" style="margin-top:8px">${sizes}</div>` : ''}`;
}
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); showToast('링크를 복사했습니다.'); return true; }
    catch (_) { window.prompt('아래 링크를 복사하세요', text); return false; }
}
function shareSheet({ title, text, url, imageUrl }) {
    const m = openModal(`<h3>공유하기</h3><div class="stack">
        <button type="button" class="kakao-btn lg" style="max-width:none" data-s="kakao">${icon('chat')} 카카오톡으로 공유</button>
        ${navigator.share ? `<button type="button" class="gaa-btn gaa-btn-secondary gaa-btn-block" data-s="native">${icon('upload')} 다른 앱으로 공유</button>` : ''}
        <button type="button" class="gaa-btn gaa-btn-secondary gaa-btn-block" data-s="copy">${icon('link')} 링크 복사</button>
        <div class="url">${esc(url)}</div></div>`, { sheet: true });
    m.el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        const s = b.dataset.s;
        if (s === 'copy') { await copyText(url); m.close(); }
        if (s === 'native') { try { await navigator.share({ title, text, url }); m.close(); } catch (err) { if (err && err.name !== 'AbortError') copyText(url); } }
        if (s === 'kakao') {
            initKakao();
            const shareApi = window.Kakao && (Kakao.Share || Kakao.Link);
            if (!shareApi) { await copyText(url); return m.close(); }
            try {
                shareApi.sendDefault({ objectType: 'feed', content: { title, description: text, imageUrl: imageUrl || 'https://gatherallaround.com/icon.jpg', link: { mobileWebUrl: url, webUrl: url } },
                    buttons: [{ title: '보러 가기', link: { mobileWebUrl: url, webUrl: url } }] });
                m.close();
            } catch (err) { console.error(err); await copyText(url); m.close(); }
        }
    });
}
// '⋯ 더보기' 하단 시트 — items: [{ key, label, icon, danger }]. 선택한 key 또는 null 을 돌려준다.
function moreSheet(items, title = '') {
    return new Promise((resolve) => {
        let picked = null;
        const m = openModal(`${title ? `<h3>${esc(title)}</h3>` : ''}<div class="sheet-list">${items.map(it =>
            `<button type="button" class="sheet-item ${it.danger ? 'danger' : ''}" data-more="${esc(it.key)}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('')}</div>
            <div class="modal-actions"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-close>닫기</button></div>`, { sheet: true, onClose: () => resolve(picked) });
        m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-more]'); if (!b) return; picked = b.dataset.more; m.close(); });
    });
}
async function reportModal(target_type, target_id) {
    if (!await requireLogin('신고는 로그인 후 가능합니다.')) return;
    const m = openModal(`<h3>신고하기</h3><label class="wp-label">사유</label>
        <select class="wp-select">${REPORT_REASONS.map(r => `<option value="${r.key}">${esc(r.label)}</option>`).join('')}</select>
        <label class="wp-label">상세 (선택)</label><textarea class="wp-textarea" maxlength="${LIMITS.reportDetail}" placeholder="어떤 점이 문제인지 알려주세요"></textarea>
        <div class="form-result" data-res></div>
        <div class="modal-actions"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-close>취소</button><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-danger" data-ok>신고 접수</button></div>`);
    $('[data-ok]', m.el).addEventListener('click', async (ev) => {
        const btn = ev.currentTarget; btn.disabled = true;
        const out = await api('report', { target_type, target_id, reason: $('select', m.el).value, detail: $('textarea', m.el).value });
        if (out.ok) { showToast('신고가 접수되었습니다. 검토 후 조치하겠습니다.'); m.close(); }
        else { const r = $('[data-res]', m.el); r.textContent = out.message || '접수에 실패했습니다.'; r.className = 'form-result err'; btn.disabled = false; }
    });
}
const loginGateHTML = (title, msg) => `<div class="card-box empty" style="padding:36px 20px"><div class="big">🧩</div>
    <div class="gate-title">${esc(title)}</div><p class="muted" style="margin:0 0 18px">${esc(msg)}</p>
    <button type="button" class="kakao-btn lg" data-act="login">${icon('chat')} 카카오로 시작하기</button></div>`;

// ══════════════════════════════════════════════════════════════════
// 홈 — 인기 작품 스트립 + 사이즈 필터·검색·정렬 + 프로젝트 그리드
// ══════════════════════════════════════════════════════════════════
async function viewHome(r) {
    const f = { group: r.params.get('group') || '', size: r.params.get('size') || '', text: r.params.get('q') || '', sort: r.params.get('sort') || 'new', page: parseInt(r.params.get('page') || '0', 10) || 0 };
    if (f.size && !presetOf(f.size)) f.size = '';
    if (f.size) f.group = presetOf(f.size).group;
    const mk = (o) => hashQuery('/', { group: f.group, size: f.size, q: f.text, sort: f.sort === 'new' ? '' : f.sort, page: 0, ...o });
    app.innerHTML = `
        <section class="hero"><div><h1>와펜 붙여 나만의 작품 만들기</h1><p>기본 이미지를 올리고, 와펜을 붙이고, 인쇄·SNS 사이즈로 저장하세요. 카카오 로그인만 하면 바로 시작!</p></div>
            <div class="hero-actions"><a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/new">${icon('plus')} 프로젝트 만들기</a><a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/ranking">${icon('trophy')} 랭킹</a></div></section>
        <div class="section-title"><h2 id="popTitle">🔥 이번 주 인기 작품</h2><a class="more" href="#/ranking">더 보기 ${icon('chevron')}</a></div>
        <div class="strip" id="popStrip">${loadingHTML()}</div>
        <div class="section-title"><h2>프로젝트</h2><a class="more" href="#/new">${icon('plus')} 새 프로젝트</a></div>
        ${sizeChipsHTML(f.group, f.size, (o) => mk({ ...o, q: f.text }))}
        <div class="filter-bar"><div class="search-box">${icon('search')}<input id="homeSearch" placeholder="프로젝트 검색 (제목)" value="${esc(f.text)}" maxlength="40"></div>
            <div class="seg"><button type="button" class="${f.sort === 'new' ? 'active' : ''}" data-sort="new">최신</button><button type="button" class="${f.sort === 'popular' ? 'active' : ''}" data-sort="popular">인기</button></div></div>
        <div id="projGrid">${loadingHTML()}</div>`;

    // 인기 작품 — 이번 주 → 없으면 누적
    (async () => {
        const strip = $('#popStrip'); if (!strip) return;
        try {
            let rows = await fetchRanking('week', null, 10);
            if (!rows.length) { rows = await fetchRanking('all', null, 10); const t = $('#popTitle'); if (t && rows.length) t.textContent = '🏆 인기 작품'; }
            if (!strip.isConnected) return;
            strip.innerHTML = rows.length ? rows.map(x => workCardHTML(rankRowToWork(x), { showProject: false })).join('')
                : `<div class="empty" style="width:100%;padding:24px">아직 반응을 받은 작품이 없어요. 첫 작품을 만들어보세요!</div>`;
        } catch (_) { strip.innerHTML = `<div class="empty" style="width:100%">인기 작품을 불러오지 못했습니다.</div>`; }
    })();

    const grid = $('#projGrid');
    async function loadProjects() {
        grid.innerHTML = loadingHTML();
        try {
            const rows = await fetchProjects(f);
            if (!grid.isConnected) return;
            const hasMore = rows.length > PAGE; const list = rows.slice(0, PAGE);
            grid.innerHTML = (list.length ? `<div class="card-grid">${list.map(projectCardHTML).join('')}</div>` : emptyHTML('🗂️', f.text || f.size || f.group ? '조건에 맞는 프로젝트가 없어요.' : '아직 프로젝트가 없어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-primary" href="#/new">첫 프로젝트 만들기</a>'))
                + pagerHTML(f.page, hasMore, (pg) => mk({ page: pg, q: f.text }));
        } catch (_) { grid.innerHTML = errorHTML(); }
    }
    loadProjects();
    // 검색은 포커스 유지를 위해 해시만 교체하고 그리드만 다시 그린다
    $('#homeSearch').addEventListener('input', debounce((e) => { f.text = e.target.value.trim(); f.page = 0; replaceHash(mk({ q: f.text })); loadProjects(); }, 350));
    $$('.seg [data-sort]').forEach(b => b.addEventListener('click', () => navigate(mk({ sort: b.dataset.sort === 'new' ? '' : b.dataset.sort, q: f.text }))));
}
// 랭킹 RPC 행 → 작품 카드 입력 모양
function rankRowToWork(x) {
    const pr = presetOf(x.size_key);
    return { id: x.id, title: x.title, preview_url: x.preview_url, author_name: x.author_name, author_avatar: x.author_avatar, reaction_count: x.total,
        wappen_projects: { id: x.project_id, title: x.project_title, size_key: x.size_key, size_group: pr ? pr.group : 'print', orientation: x.orientation } };
}

// ══════════════════════════════════════════════════════════════════
// 프로젝트 상세 — 기본 이미지·사이즈·작품 그리드
// ══════════════════════════════════════════════════════════════════
async function viewProject(r) {
    const id = r.segs[1];
    const sort = r.params.get('sort') === 'new' ? 'new' : 'popular';
    const page = parseInt(r.params.get('page') || '0', 10) || 0;
    const p = await fetchProject(id);
    if (!p) { app.innerHTML = emptyHTML('🙈', '프로젝트를 찾을 수 없거나 숨겨졌어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/">홈으로</a>' + (state.me ? ' <a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/me?tab=projects">내 프로젝트</a>' : '')); return; }
    const pr = presetOf(p.size_key); const dims = presetDims(p.size_key, p.orientation);
    const mine = state.me && state.me.id === p.owner_id; const admin = state.me && state.me.is_admin;
    const mk = (o) => hashQuery(`/project/${id}`, { sort: sort === 'popular' ? '' : sort, page: 0, ...o });
    // 사이즈 메타: 배지(A4 세로)에 이미 이름·방향이 있으므로 치수만 덧붙인다
    const mmText = pr && pr.group === 'print' ? (p.orientation === 'landscape' ? `${pr.mm[1]}×${pr.mm[0]}` : `${pr.mm[0]}×${pr.mm[1]}`) + 'mm · 300dpi ' : '';
    app.innerHTML = `
        <div class="detail-head">
            <div class="detail-img"><img src="${esc(p.base_image_url)}" alt="${esc(p.title)}"></div>
            <div class="detail-info">
                <div class="meta-line">${sizeBadge(p)}<span>${mmText}${dims.w}×${dims.h}px</span></div>
                <h1>${esc(p.title)}</h1>
                <div class="author-line">${avatarHTML(p.author_name, p.author_avatar, 'xs')}<b>${esc(p.author_name)}</b><span class="sep">·</span><span>${fmtDate(p.created_at)}</span><span class="sep">·</span><span>작품 ${num(p.works_count)}개</span></div>
                ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
                <div class="action-row">
                    <a class="gaa-btn gaa-btn-sm gaa-btn-primary" href="#/edit/${id}">${icon('brush')} 꾸미기 시작</a>
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-act="share">${icon('share')} 공유</button>
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary icon-only" data-act="more" aria-label="더보기" title="더보기">${icon('more')}</button>
                </div>
            </div>
        </div>
        <div class="section-title"><h2>작품 ${num(p.works_count)}</h2>
            <div class="seg"><a class="${sort === 'popular' ? 'active' : ''}" href="${mk({ sort: '' })}">인기</a><a class="${sort === 'new' ? 'active' : ''}" href="${mk({ sort: 'new' })}">최신</a></div></div>
        <div id="worksGrid">${loadingHTML()}</div>`;

    (async () => {
        const grid = $('#worksGrid');
        try {
            const rows = await fetchWorks({ project_id: id, sort, page });
            if (!grid.isConnected) return;
            const hasMore = rows.length > PAGE, list = rows.slice(0, PAGE);
            grid.innerHTML = (list.length ? `<div class="card-grid">${list.map(w => workCardHTML(w, { showProject: false })).join('')}</div>`
                : emptyHTML('🎨', '아직 작품이 없어요. 첫 작품을 만들어보세요!', `<a class="gaa-btn gaa-btn-sm gaa-btn-primary" href="#/edit/${id}">꾸미기 시작</a>`))
                + pagerHTML(page, hasMore, (pg) => mk({ page: pg, sort: sort === 'popular' ? '' : sort }));
        } catch (_) { grid.innerHTML = errorHTML(); }
    })();

    onAppClick(async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        let act = b.dataset.act;
        if (act === 'more') {
            // 부가 동작은 한 시트에 — 소유자/관리자: 정보 수정·숨기기·삭제, 모두: 링크 복사·신고
            act = await moreSheet([
                ...(mine || admin ? [{ key: 'edit', label: '정보 수정', icon: 'edit' }, { key: 'hide', label: '숨기기', icon: 'eye-off' }] : []),
                { key: 'copy', label: '링크 복사', icon: 'link' },
                ...(!mine ? [{ key: 'report', label: '신고', icon: 'flag' }] : []),
                ...(mine || admin ? [{ key: 'delete', label: '프로젝트 삭제', icon: 'trash', danger: true }] : []),
            ]);
            if (!act) return;
        }
        if (act === 'share') shareSheet({ title: `${p.title} · 와펜 꾸미기`, text: `${presetLabel(p.size_key, p.orientation)} 프로젝트 — 와펜을 붙여 꾸며보세요`, url: `${SITE_URL}?p=${id}`, imageUrl: p.thumb_url || p.base_image_url });
        if (act === 'copy') copyText(`${SITE_URL}?p=${id}`);
        if (act === 'report') reportModal('project', id);
        if (act === 'edit') {
            const title = await promptModal({ title: '제목 수정', value: p.title, max: LIMITS.title }); if (title == null) return;
            const description = await promptModal({ title: '설명 수정', value: p.description || '', max: LIMITS.description, multiline: true, placeholder: '프로젝트 설명 (선택)' }); if (description == null) return;
            const out = await api('project_update', { project_id: id, title, description });
            if (out.ok) { showToast('저장했습니다.'); render(); } else showToast(out.message || '저장하지 못했습니다.');
        }
        if (act === 'hide') {
            if (!await confirmModal({ title: '프로젝트를 숨길까요?', body: '목록에서 사라지고 링크로도 볼 수 없어요. 내 페이지에서 다시 공개할 수 있습니다.', okLabel: '숨기기' })) return;
            const out = await api('project_update', { project_id: id, status: 'hidden' });
            if (out.ok) { showToast('프로젝트를 숨겼습니다.'); navigate('#/me?tab=projects'); } else showToast(out.message || '처리하지 못했습니다.');
        }
        if (act === 'delete') {
            if (!await confirmModal({ title: '프로젝트를 삭제할까요?', body: '내 작품도 함께 삭제됩니다. 다른 사람의 작품이 있으면 삭제할 수 없어요.', okLabel: '삭제', danger: true })) return;
            const out = await api('project_delete', { project_id: id });
            if (out.ok) { showToast('삭제했습니다.'); navigate('#/'); } else showToast(out.message || '삭제하지 못했습니다.');
        }
    });
}

// ══════════════════════════════════════════════════════════════════
// 프로젝트 만들기 — 사이즈 → 기본 이미지(크롭) → 정보
// ══════════════════════════════════════════════════════════════════
async function viewNew() {
    app.className = 'wp-container narrow';
    if (!state.me) { app.innerHTML = loginGateHTML('프로젝트 만들기', '기본 이미지를 올리고 사이즈를 정하면 누구나 와펜을 붙여 꾸밀 수 있어요.'); return; }
    const s = { group: 'print', size: 'a4', orientation: 'portrait', file: null, bitmap: null, offset: 0.5 };
    app.innerHTML = `
        <div class="page-head"><h1>새 프로젝트</h1></div>
        <div class="card-box"><div class="wp-label head">1. 사이즈</div>
            <div class="seg" id="grpSeg">${Object.entries(GROUPS).map(([k, v]) => `<button type="button" class="${s.group === k ? 'active' : ''}" data-g="${k}">${v}</button>`).join('')}</div>
            <div class="size-pick" id="sizePick"></div>
            <div id="orientRow" style="margin-top:10px"></div>
            <div class="help" id="sizeHelp"></div></div>
        <div class="card-box"><div class="wp-label head">2. 기본 이미지</div>
            <label class="dropzone" id="drop"><input type="file" accept="image/png,image/jpeg,image/webp"><div>${icon('image')} 이미지를 선택하거나 끌어다 놓으세요</div><div class="help">PNG · JPG · WebP, 긴 변 4096px 로 자동 축소 · 선택한 사이즈 비율로 잘립니다</div></label>
            <div class="crop-preview hidden" id="cropWrap"><canvas></canvas></div>
            <div id="offsetRow" class="hidden" style="margin-top:8px"><label class="wp-label">잘릴 위치</label><input type="range" id="offset" min="0" max="100" value="50" style="width:100%"></div>
            <div class="help" id="imgHelp"></div></div>
        <div class="card-box"><div class="wp-label head">3. 정보</div>
            <label class="wp-label" for="pTitle">제목</label><input class="wp-input" id="pTitle" maxlength="${LIMITS.title}" placeholder="예: 여름 페스티벌 포스터">
            <label class="wp-label" for="pDesc">설명 (선택)</label><textarea class="wp-textarea" id="pDesc" maxlength="${LIMITS.description}" placeholder="어떤 프로젝트인지, 어떻게 꾸미면 좋을지 알려주세요"></textarea></div>
        <div class="progress hidden" id="prog" style="margin-top:14px"><div></div></div>
        <div class="form-result" id="newResult"></div>
        <button type="button" class="gaa-btn gaa-btn-primary gaa-btn-block" id="createBtn" style="margin-top:4px">프로젝트 만들기</button>`;

    const sizePick = $('#sizePick'), orientRow = $('#orientRow'), sizeHelp = $('#sizeHelp'), imgHelp = $('#imgHelp');
    const cropWrap = $('#cropWrap'), cropCanvas = $('canvas', cropWrap), offsetRow = $('#offsetRow'), res = $('#newResult');
    const dims = () => presetDims(s.size, s.orientation);
    function renderSizes() {
        $$('#grpSeg button').forEach(b => b.classList.toggle('active', b.dataset.g === s.group));
        sizePick.innerHTML = PRESETS.filter(p => p.group === s.group).map(p => `<button type="button" class="size-opt ${p.key === s.size ? 'active' : ''}" data-k="${p.key}"><b>${esc(p.label)}</b><small>${p.mm ? `${p.mm[0]}×${p.mm[1]}mm${p.note ? ' · ' + p.note : ''}` : `${p.px[0]}×${p.px[1]}px${p.note ? ' · ' + p.note : ''}`}</small></button>`).join('');
        orientRow.innerHTML = s.group === 'print' ? `<div class="seg"><button type="button" class="${s.orientation === 'portrait' ? 'active' : ''}" data-o="portrait">세로</button><button type="button" class="${s.orientation === 'landscape' ? 'active' : ''}" data-o="landscape">가로</button></div>` : '';
        const d = dims(); sizeHelp.textContent = `${presetLabel(s.size, s.orientation)}${s.group === 'print' ? ` · 300dpi 기준 ${d.w}×${d.h}px` : ''}`;
        updatePreview();
    }
    function updatePreview() {
        if (!s.bitmap) return;
        const d = dims();
        const { needsOffset } = drawCropPreview(cropCanvas, s.bitmap, { aspect: d.w / d.h, offset: s.offset });
        cropWrap.classList.remove('hidden'); offsetRow.classList.toggle('hidden', !needsOffset);
        const sw = s.bitmap.naturalWidth || s.bitmap.width, sh = s.bitmap.naturalHeight || s.bitmap.height;
        const small = Math.max(sw, sh) < Math.max(d.w, d.h) * 0.5;
        imgHelp.textContent = `원본 ${sw}×${sh}px` + (small && s.group === 'print' ? ' · 인쇄 사이즈보다 작아 출력 시 흐릴 수 있어요' : '');
    }
    $('#grpSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; s.group = b.dataset.g; s.size = PRESETS.find(p => p.group === s.group).key; if (s.group === 'sns') s.orientation = 'portrait'; renderSizes(); });
    sizePick.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; s.size = b.dataset.k; renderSizes(); });
    orientRow.addEventListener('click', (e) => { const b = e.target.closest('[data-o]'); if (!b) return; s.orientation = b.dataset.o; renderSizes(); });
    $('#offset').addEventListener('input', (e) => { s.offset = e.target.value / 100; updatePreview(); });
    const drop = $('#drop'), fileInput = $('input', drop);
    async function takeFile(file) {
        if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) { res.textContent = 'PNG·JPG·WebP 이미지만 올릴 수 있어요.'; res.className = 'form-result err'; return; }
        res.textContent = '';
        try { s.bitmap = await decodeFile(file); s.file = file; updatePreview(); }
        catch (_) { res.textContent = '이미지를 읽지 못했어요. 다른 파일을 선택해주세요.'; res.className = 'form-result err'; }
    }
    fileInput.addEventListener('change', () => takeFile(fileInput.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
    renderSizes();

    $('#createBtn').addEventListener('click', async (e) => {
        const btn = e.currentTarget; res.textContent = ''; res.className = 'form-result';
        const showErr = (m) => { res.textContent = m; res.className = 'form-result err'; };
        const title = $('#pTitle').value.trim(), description = $('#pDesc').value.trim();
        if (!title) return showErr('제목을 입력해주세요.');
        if (!s.bitmap) return showErr('기본 이미지를 선택해주세요.');
        if (!isValidSize(s.size, s.orientation)) return showErr('사이즈를 선택해주세요.');
        btn.disabled = true; const prog = $('#prog'), bar = $('div', prog); prog.classList.remove('hidden');
        const step = (pct, msg) => { bar.style.width = pct + '%'; res.textContent = msg; };
        try {
            const d = dims(), aspect = d.w / d.h;
            step(10, '이미지 준비 중…');
            const base = await fitImage(s.bitmap, { maxEdge: 4096, mime: 'image/jpeg', quality: 0.9, aspect, offset: s.offset });
            const thumb = await fitImage(s.bitmap, { maxEdge: 600, mime: 'image/jpeg', quality: 0.82, aspect, offset: s.offset });
            step(35, '기본 이미지 업로드 중…');
            const base_image_url = await uploadBlob('base', base.blob, 'jpg');
            step(70, '썸네일 업로드 중…');
            const thumb_url = await uploadBlob('thumb', thumb.blob, 'jpg');
            step(90, '프로젝트 저장 중…');
            const out = await api('project_create', { title, description, size_key: s.size, orientation: s.orientation, width_px: base.w, height_px: base.h, base_image_url, thumb_url });
            if (!out.ok) throw new Error(out.message || '저장하지 못했습니다.');
            step(100, '완료!'); showToast('프로젝트를 만들었어요. 이제 꾸며보세요!');
            navigate(`#/project/${out.project.id}`);
        } catch (err) {
            console.error(err); showErr(err.message || '프로젝트를 만들지 못했어요. 잠시 후 다시 시도해주세요.'); btn.disabled = false; prog.classList.add('hidden');
        }
    });
}

// ══════════════════════════════════════════════════════════════════
// 에디터 — 캔버스 + 와펜 서랍 + 저장(미리보기 업로드 → work_save)
// ══════════════════════════════════════════════════════════════════
async function viewEdit(r) {
    const pid = r.segs[1];
    const remixId = r.params.get('remix'), workParam = r.params.get('work');
    const [project, items] = await Promise.all([fetchProject(pid), fetchItems()]);
    if (!project) { app.innerHTML = emptyHTML('🙈', '프로젝트를 찾을 수 없거나 숨겨졌어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/">홈으로</a>'); return; }
    let work = null, editing = false;
    const srcId = workParam || remixId;
    if (srcId && UUID_RE.test(srcId)) {
        work = await fetchWork(srcId);
        if (work && work.project_id !== pid) work = null;
        editing = !!(work && workParam && state.me && (work.author_id === state.me.id || state.me.is_admin));
    }
    const dims = presetDims(project.size_key, project.orientation);
    const base = await loadImage(project.base_image_url);

    document.body.classList.add('editing');
    app.className = 'wp-container full';
    app.innerHTML = `<div class="ed-wrap">
        <div class="ed-topbar">
            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" data-act="back">${icon('back')} 나가기</button>
            <div class="title">${editing ? '수정 · ' : (work ? '리믹스 · ' : '')}${esc(project.title)} <span class="muted">· ${esc(presetLabel(project.size_key, project.orientation))}</span></div>
            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary icon-only" data-act="undo" title="되돌리기 (Ctrl+Z)" aria-label="되돌리기" disabled>${icon('undo')}</button>
            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary icon-only" data-act="redo" title="다시 실행 (Ctrl+Y)" aria-label="다시 실행" disabled>${icon('redo')}</button>
            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" data-act="save">${icon('save')} ${editing ? '수정 저장' : '저장'}</button>
        </div>
        <div class="ed-stage" id="edStage"><canvas class="ed-canvas" id="edCanvas"></canvas>
            <div class="ed-hint" id="edHint">${work ? '원작을 바탕으로 이어서 꾸며보세요' : '아래에서 와펜을 눌러 추가하세요'}</div>
            <div class="ed-tools hidden" id="edTools">
                <button type="button" data-act="flip" title="좌우 반전" aria-label="좌우 반전">${icon('flip')}</button><button type="button" data-act="rotl" title="-15°" aria-label="왼쪽으로 15° 회전">${icon('rotate-ccw')}</button><button type="button" data-act="rotr" title="+15°" aria-label="오른쪽으로 15° 회전">${icon('rotate-cw')}</button>
                <span class="sep"></span><button type="button" data-act="back1" title="뒤로 보내기" aria-label="뒤로 보내기">${icon('layer-down')}</button><button type="button" data-act="fwd1" title="앞으로 가져오기" aria-label="앞으로 가져오기">${icon('layer-up')}</button>
                <span class="sep"></span><button type="button" data-act="dup" title="복제" aria-label="복제">${icon('copy')}</button><button type="button" data-act="del" title="삭제" aria-label="삭제">${icon('trash')}</button></div>
        </div>
        <div class="ed-drawer" id="edDrawer">
            <div class="ed-drawer-head"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" data-act="toggle-drawer" id="drawerToggle">${icon('chevron-down')} 와펜 ${items.length}</button>
                <div class="search-box">${icon('search')}<input id="edSearch" placeholder="이름·태그 검색" maxlength="30"></div>
                <a class="gaa-btn gaa-btn-xs gaa-btn-ghost" href="#/request" target="_blank" rel="noopener">요청</a></div>
            <div class="ed-drawer-chips chips scroll" id="edChips"></div>
            <div class="ed-items" id="edItems"></div>
        </div></div>`;

    const canvas = $('#edCanvas'), tools = $('#edTools'), hint = $('#edHint');
    const undoBtn = $('[data-act="undo"]', app), redoBtn = $('[data-act="redo"]', app);
    let dirty = false;
    const editor = new WappenEditor(canvas, {
        W: dims.w, H: dims.h, base, layout: work ? work.layout : null, itemsById: state.itemsById,
        onChange: () => { dirty = true; undoBtn.disabled = !editor.canUndo; redoBtn.disabled = !editor.canRedo; hint.classList.toggle('hidden', editor.items.length > 0); },
        onSelect: (it) => tools.classList.toggle('hidden', !it),
    });
    hint.classList.toggle('hidden', editor.items.length > 0);
    window.wappen && (window.wappen.editor = editor);

    // 서랍 — 카테고리 칩 + 검색
    let cat = '', text = '';
    const chips = $('#edChips'), grid = $('#edItems');
    function renderChips() {
        chips.innerHTML = ['', ...state.categories].map(c => `<button type="button" class="chip sm ${cat === c ? 'active' : ''}" data-cat="${esc(c)}">${c ? esc(c) : '전체'}</button>`).join('');
    }
    function renderItems() {
        const t = text.toLowerCase();
        const list = items.filter(i => (!cat || i.category === cat) && (!t || i.name.toLowerCase().includes(t) || (i.tags || []).some(x => x.toLowerCase().includes(t)) || i.category.toLowerCase().includes(t)));
        grid.innerHTML = list.length ? list.map(i => `<button type="button" class="ed-item" data-item="${i.id}" title="${esc(i.name)}"><img src="${esc(i.image_url)}" alt="" loading="lazy" crossorigin="anonymous"><span>${esc(i.name)}</span></button>`).join('')
            : `<div class="empty" style="grid-column:1/-1;padding:20px">${items.length ? '검색 결과가 없어요.' : '아직 등록된 와펜이 없어요. <a href="#/request" target="_blank">와펜을 요청</a>해보세요.'}</div>`;
    }
    renderChips(); renderItems();
    chips.addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; renderChips(); renderItems(); });
    $('#edSearch').addEventListener('input', debounce((e) => { text = e.target.value.trim(); renderItems(); }, 200));
    grid.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-item]'); if (!b) return;
        const meta = state.itemsById.get(b.dataset.item); if (!meta) return;
        const ok = await editor.add(meta);
        if (!ok) showToast(editor.items.length >= LAYOUT.maxItems ? `와펜은 최대 ${LAYOUT.maxItems}개까지 붙일 수 있어요.` : '와펜 이미지를 불러오지 못했어요.');
    });

    async function save() {
        if (!await requireLogin('작품을 저장하려면 로그인이 필요해요.')) return;
        if (!editor.items.length && !await confirmModal({ title: '와펜이 하나도 없어요', body: '그래도 저장할까요?', okLabel: '저장' })) return;
        const title = await promptModal({ title: editing ? '작품 제목' : '작품 제목을 정해주세요', value: (work && work.title) || project.title, max: LIMITS.title, okLabel: editing ? '수정 저장' : '저장' });
        if (title == null) return;
        const saveBtn = $('[data-act="save"]', app); saveBtn.disabled = true; saveBtn.textContent = '저장 중…';
        try {
            const layout = editor.toLayout();
            const pv = await renderPreview({ W: dims.w, H: dims.h, base, layout, imgsById: editor.imgs });
            if (!pv) throw new Error('미리보기를 만들지 못했어요.');
            const preview_url = await uploadBlob('preview', pv.blob, 'jpg');
            const payload = { project_id: pid, title: title || project.title, layout, preview_url, preview_w: pv.w, preview_h: pv.h };
            if (editing) payload.work_id = work.id; else if (work) payload.remix_of = work.id;
            const out = await api('work_save', payload);
            if (!out.ok) throw new Error(out.message || '저장하지 못했어요.');
            dirty = false; showToast(editing ? '작품을 수정했어요.' : '작품을 저장했어요! 친구에게 공유해보세요.');
            navigate(`#/work/${out.work.id}`);
        } catch (err) { console.error(err); showToast(err.message || '저장하지 못했어요.'); saveBtn.disabled = false; saveBtn.textContent = editing ? '수정 저장' : '저장'; }
    }
    onAppClick(async (e) => {
        const b = e.target.closest('.ed-topbar [data-act], .ed-tools [data-act], #drawerToggle'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'back') { if (dirty && !await confirmModal({ title: '저장하지 않은 변경이 있어요', body: '나가면 작업 내용이 사라집니다.', okLabel: '나가기', danger: true })) return; dirty = false; navigate(`#/project/${pid}`); }
        else if (act === 'save') save();
        else if (act === 'undo') editor.undo(); else if (act === 'redo') editor.redo();
        else if (act === 'flip') editor.flip(); else if (act === 'rotl') editor.rotateBy(-15); else if (act === 'rotr') editor.rotateBy(15);
        else if (act === 'back1') editor.backward(); else if (act === 'fwd1') editor.forward();
        else if (act === 'dup') editor.duplicate(); else if (act === 'del') editor.remove();
        else if (act === 'toggle-drawer') { const d = $('#edDrawer'); d.classList.toggle('collapsed'); b.innerHTML = icon(d.classList.contains('collapsed') ? 'chevron-up' : 'chevron-down') + ` 와펜 ${items.length}`; requestAnimationFrame(() => editor.fit()); }
    });
    const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    setCleanup(() => { editor.destroy(); window.removeEventListener('beforeunload', onUnload); document.body.classList.remove('editing'); if (window.wappen) window.wappen.editor = null; });
}

// ══════════════════════════════════════════════════════════════════
// 작품 상세 — 반응·다운로드·공유·리믹스·신고
// ══════════════════════════════════════════════════════════════════
async function viewWork(r) {
    const id = r.segs[1];
    const w = await fetchWork(id);
    if (!w) { app.innerHTML = emptyHTML('🙈', '작품을 찾을 수 없거나 숨겨졌어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/">홈으로</a>'); return; }
    const p = w.wappen_projects || null;
    const mine = state.me && state.me.id === w.author_id, admin = state.me && state.me.is_admin;
    let mineKind = null;
    if (state.me) { const mr = await api('my_reactions', { work_ids: [id] }); if (mr.ok) mineKind = mr.reactions[id] || null; }
    const counts = w.reaction_counts || {};
    app.innerHTML = `
        <div class="detail-head">
            <div class="detail-img"><img src="${esc(w.preview_url)}" alt="${esc(w.title)}"></div>
            <div class="detail-info">
                ${p ? `<div class="meta-line">${sizeBadge(p)}<a href="#/project/${p.id}">${esc(p.title)} ${icon('chevron')}</a></div>` : ''}
                <h1>${esc(w.title)}</h1>
                <div class="author-line">${avatarHTML(w.author_name, w.author_avatar, 'xs')}<b>${esc(w.author_name)}</b><span class="sep">·</span><span>${timeAgo(w.created_at)}</span>
                    <span class="sep">·</span><span>와펜 ${num((w.layout && w.layout.items || []).length)}개</span><span class="sep">·</span><span>반응 <span id="reactTotal">${num(w.reaction_count)}</span></span>
                    ${w.remix_of ? `<span class="sep">·</span><a href="#/work/${w.remix_of}">원작 보기 ${icon('chevron')}</a>` : ''}</div>
                <div class="reaction-bar" id="reactBar"></div>
                <div class="action-row">
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" data-act="download">${icon('download')} 다운로드</button>
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-act="share">${icon('share')} 공유</button>
                    ${p ? `<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/edit/${p.id}?remix=${id}">${icon('remix')} 이어 꾸미기</a>` : ''}
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary icon-only" data-act="more" aria-label="더보기" title="더보기">${icon('more')}</button>
                </div>
            </div>
        </div>
        ${p ? `<div class="section-title"><h2>같은 프로젝트의 다른 작품</h2><a class="more" href="#/project/${p.id}">모두 보기 ${icon('chevron')}</a></div><div class="strip" id="moreStrip">${loadingHTML()}</div>` : ''}`;

    function renderReactions() {
        $('#reactBar').innerHTML = REACTIONS.map(x => `<button type="button" class="reaction-btn ${mineKind === x.key ? 'active' : ''}" data-react="${x.key}" title="${esc(x.label)}" aria-label="${esc(x.label)}">${x.emoji} <span class="lbl">${esc(x.label)}</span> <span class="n">${num(counts[x.key] || 0)}</span></button>`).join('');
    }
    renderReactions();
    let busy = false;
    $('#reactBar').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-react]'); if (!b || busy) return;
        if (!await requireLogin('반응을 남기려면 로그인이 필요해요.')) return;
        busy = true;
        const kind = b.dataset.react; const next = mineKind === kind ? null : kind;
        // 낙관적 갱신
        if (mineKind) counts[mineKind] = Math.max(0, (counts[mineKind] || 0) - 1);
        if (next) counts[next] = (counts[next] || 0) + 1;
        const prev = mineKind; mineKind = next; renderReactions();
        const out = await api('react', { work_id: id, kind: next });
        if (out.ok) { Object.keys(counts).forEach(k => delete counts[k]); Object.assign(counts, out.reaction_counts || {}); mineKind = out.mine; $('#reactTotal').textContent = num(out.reaction_count); }
        else { showToast(out.message || '반응을 저장하지 못했어요.'); mineKind = prev; }
        renderReactions(); busy = false;
    });
    if (p) (async () => {
        const strip = $('#moreStrip');
        try { const rows = (await fetchWorks({ project_id: p.id, sort: 'popular', limit: 11 })).filter(x => x.id !== id).slice(0, 10);
            if (strip.isConnected) strip.innerHTML = rows.length ? rows.map(x => workCardHTML(x, { showProject: false })).join('') : `<div class="empty" style="width:100%;padding:20px">아직 다른 작품이 없어요. <a href="#/edit/${p.id}">첫 번째로 꾸며보기</a></div>`; }
        catch (_) { strip.innerHTML = ''; }
    })();
    onAppClick(async (e) => {
        const b = e.target.closest('.detail-info [data-act]'); if (!b) return;
        let act = b.dataset.act;
        if (act === 'more') {
            act = await moreSheet([
                ...(p && (mine || admin) ? [{ key: 'edit', label: '작품 수정', icon: 'edit' }] : []),
                { key: 'copy', label: '링크 복사', icon: 'link' },
                ...(!mine ? [{ key: 'report', label: '신고', icon: 'flag' }] : []),
                ...(mine || admin ? [{ key: 'delete', label: '작품 삭제', icon: 'trash', danger: true }] : []),
            ]);
            if (!act) return;
        }
        if (act === 'share') shareSheet({ title: `${w.title} · 와펜 꾸미기`, text: `${w.author_name}님이 꾸민 작품을 구경해보세요`, url: `${SITE_URL}?w=${id}`, imageUrl: w.preview_url });
        if (act === 'copy') copyText(`${SITE_URL}?w=${id}`);
        if (act === 'edit' && p) navigate(`#/edit/${p.id}?work=${id}`);
        if (act === 'report') reportModal('work', id);
        if (act === 'download') downloadSheet(w, p);
        if (act === 'delete') {
            if (!await confirmModal({ title: '작품을 삭제할까요?', body: '받은 반응도 함께 사라집니다.', okLabel: '삭제', danger: true })) return;
            const out = await api('work_delete', { work_id: id });
            if (out.ok) { showToast('삭제했습니다.'); navigate(p ? `#/project/${p.id}` : '#/'); } else showToast(out.message || '삭제하지 못했습니다.');
        }
    });
}

// 다운로드 시트 — 형식·해상도 선택 후 클라이언트에서 레이아웃을 다시 그려 저장. 큰 캔버스 실패 시 dpi 자동 하향.
function downloadSheet(w, p) {
    if (!p) { showToast('프로젝트 정보가 없어 다운로드할 수 없어요.'); return; }
    const pr = presetOf(p.size_key); const isPrint = pr && pr.group === 'print';
    const sizes = exportSizes(p.size_key, p.orientation);
    const m = openModal(`<h3>다운로드</h3>
        <div class="muted" style="margin-bottom:10px">${esc(presetLabel(p.size_key, p.orientation, { withGroup: true }))}</div>
        <label class="wp-label">형식</label><div class="seg" id="dlFmt"><button type="button" class="active" data-f="png">PNG</button><button type="button" data-f="jpg">JPG (용량 작음)</button></div>
        ${isPrint ? `<label class="wp-label">해상도</label><select class="wp-select" id="dlDpi">${sizes.map((s, i) => `<option value="${s.dpi}" ${i === 0 ? 'selected' : ''}>${s.dpi}dpi · ${s.w}×${s.h}px${i === 0 ? ' (인쇄 권장)' : ''}</option>`).join('')}</select>
        <div class="help">기기 성능상 큰 캔버스를 만들 수 없으면 한 단계 낮은 해상도로 자동 저장돼요. 300dpi 는 PC 에서 가장 안정적이에요.</div>`
        : `<div class="help" style="margin-top:10px">${sizes[0].w}×${sizes[0].h}px 원본 크기로 저장돼요.</div>`}
        <div class="form-result" id="dlStatus"></div>
        <div class="modal-actions"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-close>닫기</button><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" id="dlGo">${icon('download')} 저장</button></div>`, { sheet: true });
    let fmt = 'png';
    $('#dlFmt', m.el).addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; fmt = b.dataset.f; $$('#dlFmt button', m.el).forEach(x => x.classList.toggle('active', x === b)); });
    const status = $('#dlStatus', m.el), go = $('#dlGo', m.el);
    go.addEventListener('click', async () => {
        go.disabled = true; status.className = 'form-result';
        try {
            status.textContent = '이미지 불러오는 중…';
            await fetchItems();
            const ids = (w.layout && w.layout.items || []).map(i => i.id);
            const [base, imgsById] = await Promise.all([loadImage(p.base_image_url), loadItemImages(state.itemsById, ids)]);
            const maxDpi = isPrint ? parseInt($('#dlDpi', m.el).value, 10) : null;
            const chosen = isPrint ? sizes.filter(s => s.dpi <= maxDpi) : sizes;
            const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
            const out = await exportWithFallback({ sizes: chosen, base, layout: w.layout, imgsById, mime, quality: 0.92, onTry: (s) => { status.textContent = `${s.w}×${s.h}px 그리는 중…`; } });
            if (!out) throw new Error('이 기기에서는 이미지를 만들 수 없어요. PC 브라우저에서 시도해주세요.');
            const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
            const name = `${safe(p.title)}_${safe(w.title)}_${pr.label}${out.dpi ? `_${out.dpi}dpi` : ''}.${fmt}`;
            const file = new File([out.blob], name, { type: mime });
            const url = URL.createObjectURL(out.blob);
            const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            status.textContent = `${out.w}×${out.h}px${out.dpi ? ` · ${out.dpi}dpi` : ''} 저장 완료`;
            if (isPrint && out.dpi < maxDpi) showToast(`이 기기 한계로 ${out.dpi}dpi 로 저장했어요. PC 에서는 더 높은 해상도로 저장할 수 있어요.`, 5000);
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                status.insertAdjacentHTML('afterend', `<button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary gaa-btn-block" id="dlShare" style="margin-top:8px">${icon('phone')} 사진 앱에 저장 / 공유</button>`);
                $('#dlShare', m.el).addEventListener('click', async () => { try { await navigator.share({ files: [file], title: w.title }); } catch (_) {} });
            }
        } catch (err) { console.error(err); status.textContent = err.message || '저장하지 못했어요.'; status.className = 'form-result err'; }
        go.disabled = false;
    });
}

// ══════════════════════════════════════════════════════════════════
// 랭킹 — 이번 주 / 전체, 사이즈 필터
// ══════════════════════════════════════════════════════════════════
async function viewRanking(r) {
    const period = r.params.get('period') === 'all' ? 'all' : 'week';
    let size = r.params.get('size') || '', group = r.params.get('group') || '';
    if (size && !presetOf(size)) size = '';
    if (size) group = presetOf(size).group;
    const mk = (o) => hashQuery('/ranking', { period: period === 'week' ? '' : period, group, size, ...o });
    app.className = 'wp-container narrow';
    app.innerHTML = `<div class="page-head"><h1>랭킹</h1>
        <div class="seg"><a class="${period === 'week' ? 'active' : ''}" href="${mk({ period: '' })}">이번 주</a><a class="${period === 'all' ? 'active' : ''}" href="${mk({ period: 'all' })}">전체</a></div></div>
        ${sizeChipsHTML(group, size, mk)}
        <div id="rankList" style="margin-top:14px">${loadingHTML()}</div>`;
    try {
        const rows = await fetchRanking(period, size || group || null, 50);
        const medal = ['🥇', '🥈', '🥉'];
        $('#rankList').innerHTML = rows.length ? `<div class="rank-list">${rows.map(x => `<a class="rank-row" href="#/work/${x.id}">
                <div class="rank-no ${x.rank <= 3 ? 'top' : ''}">${x.rank <= 3 ? medal[x.rank - 1] : x.rank}</div>
                <img class="rank-thumb" src="${esc(x.preview_url)}" alt="" loading="lazy">
                <div class="rank-info"><b>${esc(x.title)}</b><div class="card-meta">${avatarHTML(x.author_name, x.author_avatar)}<span>${esc(x.author_name)}</span><span>·</span><span>${esc(presetOf(x.size_key)?.label || x.size_key)}</span></div></div>
                <div class="rank-score">❤️ ${num(x.score)}</div></a>`).join('')}</div>`
            : emptyHTML('🏆', period === 'week' ? '이번 주에 반응을 받은 작품이 아직 없어요.' : '아직 반응을 받은 작품이 없어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/">작품 둘러보기</a>');
    } catch (_) { $('#rankList').innerHTML = errorHTML(); }
}

// ══════════════════════════════════════════════════════════════════
// 와펜 카탈로그
// ══════════════════════════════════════════════════════════════════
async function viewItems(r) {
    const cat = r.params.get('cat') || '', text = (r.params.get('q') || '').trim();
    const items = await fetchItems();
    const mk = (o) => hashQuery('/items', { cat, q: text, ...o });
    const t = text.toLowerCase();
    const list = items.filter(i => (!cat || i.category === cat) && (!t || i.name.toLowerCase().includes(t) || (i.tags || []).some(x => x.toLowerCase().includes(t))));
    app.innerHTML = `<div class="page-head"><h1>와펜 <span class="count">${num(items.length)}</span></h1><a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/request">${icon('plus')} 와펜 요청</a></div>
        <div class="chips scroll">${['', ...state.categories].map(c => `<a class="chip ${cat === c ? 'active' : ''}" href="${mk({ cat: c })}">${c ? esc(c) : '전체'}</a>`).join('')}</div>
        <div class="filter-bar"><div class="search-box">${icon('search')}<input id="itemSearch" placeholder="이름·태그 검색" value="${esc(text)}" maxlength="30"></div></div>
        ${list.length ? `<div class="item-grid">${list.map(i => `<div class="item-card"><div class="img"><img src="${esc(i.image_url)}" alt="${esc(i.name)}" loading="lazy"></div><b>${esc(i.name)}</b><small>${esc(i.category)}</small><div>${(i.tags || []).slice(0, 3).map(x => `<span class="tag">#${esc(x)}</span>`).join('')}</div></div>`).join('')}</div>`
            : emptyHTML('🧩', items.length ? '검색 결과가 없어요.' : '아직 등록된 와펜이 없어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-primary" href="#/request">원하는 와펜 요청하기</a>')}
        <div class="card-box" style="margin-top:22px;text-align:center"><b>원하는 와펜이 없나요?</b><p class="muted" style="margin:6px 0 12px">이름과 설명(참고 이미지)을 보내주시면 검토 후 추가해드려요.</p><a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/request">${icon('send')} 와펜 요청하기</a></div>`;
    $('#itemSearch').addEventListener('input', debounce((e) => navigate(mk({ q: e.target.value.trim() })), 350));
    const inp = $('#itemSearch'); if (text) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

// ══════════════════════════════════════════════════════════════════
// 와펜 추가 요청
// ══════════════════════════════════════════════════════════════════
const REQ_STATUS = { pending: ['status-pending', '검토 중'], approved: ['status-approved', '추가됨'], rejected: ['status-rejected', '보류'] };
function requestRowHTML(x) {
    const [cls, label] = REQ_STATUS[x.status] || ['status-neutral', x.status];
    return `<div class="list-row">${x.ref_image_url ? `<a href="${esc(x.ref_image_url)}" target="_blank" rel="noopener"><img class="thumb contain" src="${esc(x.ref_image_url)}" alt=""></a>` : (x.wappen_items ? `<img class="thumb contain" src="${esc(x.wappen_items.image_url)}" alt="">` : '<div class="thumb" style="display:flex;align-items:center;justify-content:center">🧩</div>')}
        <div class="info"><b>${esc(x.name)} <span class="status-badge sm ${cls}">${label}</span></b>${x.description ? `<small>${esc(x.description)}</small>` : ''}${x.admin_note ? `<small>💬 ${esc(x.admin_note)}</small>` : ''}<small>${timeAgo(x.created_at)}${x.wappen_items ? ` · 등록된 와펜: ${esc(x.wappen_items.name)}` : ''}</small></div></div>`;
}
async function viewRequest() {
    app.className = 'wp-container narrow';
    if (!state.me) { app.innerHTML = loginGateHTML('와펜 요청', '원하는 와펜을 알려주시면 관리자가 검토 후 추가해드려요.'); return; }
    app.innerHTML = `<div class="page-head"><h1>와펜 추가 요청</h1></div>
        <div class="card-box"><label class="wp-label" for="rqName">와펜 이름</label><input class="wp-input" id="rqName" maxlength="${LIMITS.itemName}" placeholder="예: 검은 고양이, 번개 모양">
            <label class="wp-label" for="rqDesc">설명 (선택)</label><textarea class="wp-textarea" id="rqDesc" maxlength="${LIMITS.requestDesc}" placeholder="어떤 느낌·색·스타일인지 알려주세요"></textarea>
            <label class="wp-label">참고 이미지 (선택)</label>
            <label class="dropzone" id="rqDrop"><input type="file" accept="image/png,image/jpeg,image/webp"><div id="rqDropText">${icon('image')} 참고 이미지 선택</div></label>
            <div class="form-result" id="rqResult"></div>
            <button type="button" class="gaa-btn gaa-btn-primary gaa-btn-block" id="rqBtn">${icon('send')} 요청 보내기</button></div>
        <div class="section-title"><h2>내 요청</h2></div><div class="card-box" id="rqList">${loadingHTML()}</div>`;
    let file = null;
    $('#rqDrop input').addEventListener('change', (e) => { file = e.target.files[0] || null; $('#rqDropText').innerHTML = file ? `${icon('check')} ${esc(file.name)}` : `${icon('image')} 참고 이미지 선택`; });
    async function loadMine() {
        const out = await api('my_requests');
        $('#rqList').innerHTML = out.ok ? (out.requests.length ? `<div class="list">${out.requests.map(requestRowHTML).join('')}</div>` : '<div class="empty" style="padding:20px">아직 보낸 요청이 없어요.</div>') : errorHTML(out.message);
    }
    loadMine();
    $('#rqBtn').addEventListener('click', async (e) => {
        const btn = e.currentTarget, res = $('#rqResult'); res.className = 'form-result'; res.textContent = '';
        const name = $('#rqName').value.trim(), description = $('#rqDesc').value.trim();
        if (!name) { res.textContent = '와펜 이름을 입력해주세요.'; res.className = 'form-result err'; return; }
        btn.disabled = true;
        try {
            let ref_image_url = null;
            if (file) { res.textContent = '참고 이미지 업로드 중…'; const bm = await decodeFile(file); const fit = await fitImage(bm, { maxEdge: 1600, mime: 'image/jpeg', quality: 0.85 }); ref_image_url = await uploadBlob('request_ref', fit.blob, 'jpg'); }
            const out = await api('request_create', { name, description, ref_image_url });
            if (!out.ok) throw new Error(out.message);
            showToast('요청을 보냈어요. 검토 후 추가해드릴게요!'); $('#rqName').value = ''; $('#rqDesc').value = ''; file = null; $('#rqDropText').innerHTML = `${icon('image')} 참고 이미지 선택`; res.textContent = '';
            loadMine();
        } catch (err) { res.textContent = err.message || '요청을 보내지 못했어요.'; res.className = 'form-result err'; }
        btn.disabled = false;
    });
}

// ══════════════════════════════════════════════════════════════════
// 내 페이지 — 프로필·내 작품·내 프로젝트·내 요청
// ══════════════════════════════════════════════════════════════════
async function viewMe(r) {
    app.className = 'wp-container narrow';
    if (!state.me) { app.innerHTML = loginGateHTML('내 페이지', '내 작품과 프로젝트, 요청 내역을 한곳에서 관리해요.'); return; }
    const tab = ['works', 'projects', 'requests'].includes(r.params.get('tab')) ? r.params.get('tab') : 'works';
    const me = state.me;
    app.innerHTML = `<div class="page-head"><h1>내 페이지</h1><div class="gaa-btn-row">${me.is_admin ? `<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/admin">${icon('sliders')} 관리자</a>` : ''}<button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-act="logout">${icon('logout')} 로그아웃</button></div></div>
        <div class="card-box"><div class="row">${avatarHTML(me.nickname, me.avatar_url, 'lg')}<div style="min-width:0"><div class="profile-name">${esc(me.nickname)}<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost icon-only" data-act="nick" title="닉네임 변경" aria-label="닉네임 변경">${icon('edit')}</button>${me.is_admin ? '<span class="status-badge sm status-info">관리자</span>' : ''}</div><div class="muted">가입 ${fmtDate(me.created_at)}</div></div></div></div>
        <div class="tabs" style="margin-top:16px">${[['works', '내 작품'], ['projects', '내 프로젝트'], ['requests', '내 요청']].map(([k, v]) => `<button type="button" class="${tab === k ? 'active' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
        <div id="meBody">${loadingHTML()}</div>`;
    $$('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => navigate(hashQuery('/me', { tab: b.dataset.tab === 'works' ? '' : b.dataset.tab }))));
    const out = await api('my_content');
    const body = $('#meBody'); if (!body) return;
    if (!out.ok) { body.innerHTML = errorHTML(out.message); return; }
    out.works = out.works || []; out.projects = out.projects || []; out.requests = out.requests || [];
    const hiddenBadge = (st) => st === 'hidden' ? ' <span class="status-badge sm status-neutral">숨김</span>' : '';
    if (tab === 'works') {
        body.innerHTML = out.works.length ? `<div class="card-box"><div class="list">${out.works.map(w => `<div class="list-row">
            <a href="#/work/${w.id}"><img class="thumb" src="${esc(w.preview_url)}" alt=""></a>
            <div class="info"><b>${esc(w.title)}${hiddenBadge(w.status)}</b><small>${w.wappen_projects ? esc(w.wappen_projects.title) + ' · ' : ''}❤️ ${num(w.reaction_count)} · ${timeAgo(w.created_at)}</small></div>
            <div class="gaa-btn-row">${w.wappen_projects ? `<a class="gaa-btn gaa-btn-xs gaa-btn-secondary" href="#/edit/${w.project_id}?work=${w.id}">수정</a>` : ''}<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" data-del-work="${w.id}">삭제</button></div></div>`).join('')}</div></div>`
            : emptyHTML('🎨', '아직 만든 작품이 없어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-primary" href="#/">프로젝트 둘러보기</a>');
    } else if (tab === 'projects') {
        body.innerHTML = out.projects.length ? `<div class="card-box"><div class="list">${out.projects.map(p => `<div class="list-row">
            <a href="#/project/${p.id}"><img class="thumb" src="${esc(p.thumb_url || p.base_image_url)}" alt=""></a>
            <div class="info"><b>${esc(p.title)}${hiddenBadge(p.status)}</b><small>${esc(presetLabel(p.size_key, p.orientation))} · 작품 ${num(p.works_count)} · ${timeAgo(p.created_at)}</small></div>
            <div class="gaa-btn-row"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" data-toggle-proj="${p.id}" data-status="${p.status}">${p.status === 'hidden' ? '공개' : '숨김'}</button><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" data-del-proj="${p.id}">삭제</button></div></div>`).join('')}</div></div>`
            : emptyHTML('🗂️', '아직 만든 프로젝트가 없어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-primary" href="#/new">프로젝트 만들기</a>');
    } else {
        body.innerHTML = out.requests.length ? `<div class="card-box"><div class="list">${out.requests.map(requestRowHTML).join('')}</div></div>` : emptyHTML('🧩', '보낸 와펜 요청이 없어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-primary" href="#/request">와펜 요청하기</a>');
    }
    onAppClick(async (e) => {
        const b = e.target.closest('[data-act],[data-del-work],[data-del-proj],[data-toggle-proj]'); if (!b) return;
        if (b.dataset.act === 'logout') { if (await confirmModal({ title: '로그아웃 할까요?', okLabel: '로그아웃' })) logout(); }
        else if (b.dataset.act === 'nick') {
            const nickname = await promptModal({ title: '닉네임 변경', value: me.nickname, max: LIMITS.nickname }); if (nickname == null) return;
            const o = await api('me_update', { nickname }); if (o.ok) { state.me = o.user; renderAuthSlot(); showToast('닉네임을 바꿨어요.'); render(); } else showToast(o.message || '저장하지 못했습니다.');
        } else if (b.dataset.delWork) {
            if (!await confirmModal({ title: '작품을 삭제할까요?', okLabel: '삭제', danger: true })) return;
            const o = await api('work_delete', { work_id: b.dataset.delWork }); if (o.ok) { showToast('삭제했습니다.'); render(); } else showToast(o.message);
        } else if (b.dataset.delProj) {
            if (!await confirmModal({ title: '프로젝트를 삭제할까요?', body: '내 작품도 함께 삭제됩니다. 다른 사람의 작품이 있으면 삭제할 수 없어요.', okLabel: '삭제', danger: true })) return;
            const o = await api('project_delete', { project_id: b.dataset.delProj }); if (o.ok) { showToast('삭제했습니다.'); render(); } else showToast(o.message);
        } else if (b.dataset.toggleProj) {
            const o = await api('project_update', { project_id: b.dataset.toggleProj, status: b.dataset.status === 'hidden' ? 'active' : 'hidden' });
            if (o.ok) { showToast(o.project.status === 'hidden' ? '숨겼습니다.' : '공개했습니다.'); render(); } else showToast(o.message);
        }
    });
}

// ══════════════════════════════════════════════════════════════════
// 관리자 — 와펜 / 요청 / 신고 / 사용자
// ══════════════════════════════════════════════════════════════════
async function viewAdmin(r) {
    if (!state.me) { app.className = 'wp-container narrow'; app.innerHTML = loginGateHTML('관리자', '관리자 계정으로 로그인해주세요.'); return; }
    if (!state.me.is_admin) { app.innerHTML = emptyHTML('🔒', '관리자만 접근할 수 있어요.', '<a class="gaa-btn gaa-btn-sm gaa-btn-secondary" href="#/">홈으로</a>'); return; }
    const tab = ['items', 'requests', 'reports', 'users'].includes(r.params.get('tab')) ? r.params.get('tab') : 'items';
    const ov = await api('admin_overview');
    app.innerHTML = `<div class="page-head"><h1>관리자</h1></div><div class="stat-grid">${ov.ok ? `<div class="stat"><b>${num(ov.pending_requests)}</b><small>대기 중 요청</small></div><div class="stat"><b>${num(ov.open_reports)}</b><small>미처리 신고</small></div><div class="stat"><b>${num(ov.items)}</b><small>공개 와펜</small></div><div class="stat"><b>${num(ov.users)}</b><small>사용자</small></div>` : ''}</div>
        <div class="tabs" style="margin-top:16px">${[['items', '와펜'], ['requests', `요청${ov.ok && ov.pending_requests ? ` (${ov.pending_requests})` : ''}`], ['reports', `신고${ov.ok && ov.open_reports ? ` (${ov.open_reports})` : ''}`], ['users', '사용자']].map(([k, v]) => `<button type="button" class="${tab === k ? 'active' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
        <div id="adminBody">${loadingHTML()}</div>`;
    $$('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => navigate(hashQuery('/admin', { tab: b.dataset.tab === 'items' ? '' : b.dataset.tab }))));
    const body = $('#adminBody');
    if (tab === 'items') adminItems(body); else if (tab === 'requests') adminRequests(body); else if (tab === 'reports') adminReports(body); else adminUsers(body);
}

// 와펜 등록/수정 폼 (모달). onDone(item) 콜백.
function itemFormModal({ item = null, prefill = {} } = {}, onDone) {
    const v = { name: item?.name ?? prefill.name ?? '', category: item?.category ?? prefill.category ?? '', tags: (item?.tags ?? prefill.tags ?? []).join(', '), sort_order: item?.sort_order ?? 0 };
    const m = openModal(`<h3>${item ? '와펜 수정' : '와펜 등록'}</h3>
        ${item ? `<div class="row" style="margin-bottom:10px"><img src="${esc(item.image_url)}" alt="" style="width:64px;height:64px;object-fit:contain;background:var(--wp-check);border-radius:8px"><span class="muted">${item.width_px}×${item.height_px}px</span></div>`
            : `<label class="dropzone" id="itDrop"><input type="file" accept="image/png"><div id="itDropText">${icon('image')} PNG(투명 배경) 선택</div><div class="help">긴 변 2000px 로 자동 축소 · 알파 유지</div></label><div class="row" id="itPreview" style="margin-top:8px"></div>`}
        <label class="wp-label">이름</label><input class="wp-input" id="itName" maxlength="${LIMITS.itemName}" value="${esc(v.name)}">
        <label class="wp-label">카테고리</label><input class="wp-input" id="itCat" maxlength="${LIMITS.category}" list="catList" value="${esc(v.category)}" placeholder="예: 동물, 문자, 음악"><datalist id="catList">${state.categories.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <label class="wp-label">태그 (쉼표 구분, 최대 ${LIMITS.tags}개)</label><input class="wp-input" id="itTags" value="${esc(v.tags)}" placeholder="고양이, 검정, 귀여움">
        <label class="wp-label">정렬 순서 (작을수록 앞)</label><input class="wp-input" id="itSort" type="number" value="${v.sort_order}">
        <div class="form-result" id="itRes"></div>
        <div class="modal-actions"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" data-close>취소</button><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" id="itOk">${item ? '저장' : '등록'}</button></div>`);
    let bitmap = null, dims = null;
    if (!item) $('#itDrop input', m.el).addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (f.type !== 'image/png') { $('#itRes', m.el).textContent = 'PNG 파일만 등록할 수 있어요.'; $('#itRes', m.el).className = 'form-result err'; return; }
        bitmap = await decodeFile(f); dims = { w: bitmap.naturalWidth || bitmap.width, h: bitmap.naturalHeight || bitmap.height };
        $('#itDropText', m.el).innerHTML = `${icon('check')} ${esc(f.name)}`;
        $('#itPreview', m.el).innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" style="width:64px;height:64px;object-fit:contain;background:var(--wp-check);border-radius:8px"><span class="muted">${dims.w}×${dims.h}px</span>`;
        if (!$('#itName', m.el).value) $('#itName', m.el).value = f.name.replace(/\.png$/i, '').slice(0, LIMITS.itemName);
    });
    $('#itOk', m.el).addEventListener('click', async (e) => {
        const btn = e.currentTarget, res = $('#itRes', m.el); res.className = 'form-result'; res.textContent = '';
        const fields = { name: $('#itName', m.el).value.trim(), category: $('#itCat', m.el).value.trim() || '기본', tags: $('#itTags', m.el).value, sort_order: parseInt($('#itSort', m.el).value, 10) || 0 };
        if (!fields.name) { res.textContent = '이름을 입력해주세요.'; res.className = 'form-result err'; return; }
        if (!item && !bitmap) { res.textContent = 'PNG 파일을 선택해주세요.'; res.className = 'form-result err'; return; }
        btn.disabled = true;
        try {
            let out;
            if (item) out = await api('admin_item_update', { item_id: item.id, ...fields });
            else {
                res.textContent = '이미지 업로드 중…';
                const fit = await fitImage(bitmap, { maxEdge: 2000, mime: 'image/png' });
                const image_url = await uploadBlob('item', fit.blob, 'png');
                out = await api('admin_item_create', { ...fields, image_url, width_px: fit.w, height_px: fit.h });
            }
            if (!out.ok) throw new Error(out.message);
            await fetchItems(true); m.close(); showToast(item ? '수정했습니다.' : '와펜을 등록했습니다.'); onDone && onDone(out.item);
        } catch (err) { res.textContent = err.message || '저장하지 못했습니다.'; res.className = 'form-result err'; btn.disabled = false; }
    });
}
async function adminItems(body) {
    const out = await api('admin_items');
    if (!out.ok) { body.innerHTML = errorHTML(out.message); return; }
    const byCat = {}; for (const it of out.items) (byCat[it.category] = byCat[it.category] || []).push(it);
    body.innerHTML = `<div class="row between" style="margin-bottom:10px"><span class="muted">총 ${num(out.items.length)}개 (숨김 ${num(out.items.filter(i => i.status === 'hidden').length)})</span><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" data-act="new-item">${icon('plus')} 와펜 등록</button></div>
        ${out.items.length ? Object.entries(byCat).map(([c, list]) => `<div class="card-box"><b>${esc(c)} <span class="muted">${list.length}</span></b><div class="list">${list.map(i => `<div class="list-row">
            <img class="thumb contain" src="${esc(i.image_url)}" alt=""><div class="info"><b>${esc(i.name)} ${i.status === 'hidden' ? '<span class="status-badge sm status-neutral">숨김</span>' : ''}</b><small>${i.width_px}×${i.height_px}px · 순서 ${i.sort_order} · ${(i.tags || []).map(t => '#' + esc(t)).join(' ')}</small></div>
            <div class="gaa-btn-row"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" data-edit="${i.id}">수정</button><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" data-hide="${i.id}" data-status="${i.status}">${i.status === 'hidden' ? '공개' : '숨김'}</button><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" data-del="${i.id}">삭제</button></div></div>`).join('')}</div></div>`).join('')
            : emptyHTML('🧩', '등록된 와펜이 없어요. 첫 와펜을 등록해주세요.')}`;
    const refresh = () => adminItems(body);
    body.onclick = async (e) => {
        const b = e.target.closest('[data-act="new-item"],[data-edit],[data-hide],[data-del]'); if (!b) return;
        const item = out.items.find(i => i.id === (b.dataset.edit || b.dataset.hide || b.dataset.del));
        if (b.dataset.act === 'new-item') itemFormModal({}, refresh);
        else if (b.dataset.edit) itemFormModal({ item }, refresh);
        else if (b.dataset.hide) { const o = await api('admin_item_update', { item_id: item.id, status: b.dataset.status === 'hidden' ? 'active' : 'hidden' }); if (o.ok) { await fetchItems(true); refresh(); } else showToast(o.message); }
        else if (b.dataset.del) {
            if (!await confirmModal({ title: `'${item.name}' 와펜을 삭제할까요?`, body: '작품에 사용 중이면 삭제 대신 숨김 처리됩니다.', okLabel: '삭제', danger: true })) return;
            const o = await api('admin_item_delete', { item_id: item.id }); if (o.ok) { showToast(o.hidden ? `작품 ${o.used}개에 사용 중이라 숨김 처리했습니다.` : '삭제했습니다.'); await fetchItems(true); refresh(); } else showToast(o.message);
        }
    };
}
async function adminRequests(body, status = 'pending') {
    const out = await api('admin_requests', { status: status || undefined });
    if (!out.ok) { body.innerHTML = errorHTML(out.message); return; }
    body.innerHTML = `<div class="chips" style="margin-bottom:10px">${[['pending', '검토 중'], ['approved', '추가됨'], ['rejected', '보류'], ['', '전체']].map(([k, v]) => `<button type="button" class="chip sm ${status === k ? 'active' : ''}" data-st="${k}">${v}</button>`).join('')}</div>
        ${out.requests.length ? `<div class="card-box"><div class="list">${out.requests.map(x => { const [cls, label] = REQ_STATUS[x.status] || ['status-neutral', x.status]; return `<div class="list-row">
            ${x.ref_image_url ? `<a href="${esc(x.ref_image_url)}" target="_blank" rel="noopener"><img class="thumb contain" src="${esc(x.ref_image_url)}" alt=""></a>` : '<div class="thumb" style="display:flex;align-items:center;justify-content:center">🧩</div>'}
            <div class="info"><b>${esc(x.name)} <span class="status-badge sm ${cls}">${label}</span></b><small>${esc(x.requester?.nickname || '')} · ${timeAgo(x.created_at)}</small>${x.description ? `<small>${esc(x.description)}</small>` : ''}${x.admin_note ? `<small>💬 ${esc(x.admin_note)}</small>` : ''}${x.wappen_items ? `<small>→ ${esc(x.wappen_items.name)}</small>` : ''}</div>
            <div class="gaa-btn-row">${x.status === 'pending' ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" data-approve="${x.id}">승인·등록</button><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" data-reject="${x.id}">보류</button>` : `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" data-reopen="${x.id}">다시 검토</button>`}</div></div>`; }).join('')}</div></div>` : emptyHTML('📮', '해당 상태의 요청이 없어요.')}`;
    body.onclick = async (e) => {
        const b = e.target.closest('[data-st],[data-approve],[data-reject],[data-reopen]'); if (!b) return;
        if (b.dataset.st != null) return adminRequests(body, b.dataset.st);
        const req = out.requests.find(x => x.id === (b.dataset.approve || b.dataset.reject || b.dataset.reopen));
        if (b.dataset.approve) itemFormModal({ prefill: { name: req.name } }, async (item) => { const o = await api('admin_request_resolve', { request_id: req.id, status: 'approved', item_id: item.id }); if (!o.ok) showToast(o.message); adminRequests(body, status); });
        else if (b.dataset.reject) { const note = await promptModal({ title: '보류 사유 (요청자에게 표시)', max: 300, placeholder: '예: 저작권 문제로 추가할 수 없어요' }); if (note == null) return; const o = await api('admin_request_resolve', { request_id: req.id, status: 'rejected', admin_note: note }); if (o.ok) adminRequests(body, status); else showToast(o.message); }
        else if (b.dataset.reopen) { const o = await api('admin_request_resolve', { request_id: req.id, status: 'pending' }); if (o.ok) adminRequests(body, status); else showToast(o.message); }
    };
}
async function adminReports(body, status = 'open') {
    const out = await api('admin_reports', { status: status || undefined });
    if (!out.ok) { body.innerHTML = errorHTML(out.message); return; }
    const reasonLabel = (k) => (REPORT_REASONS.find(x => x.key === k) || {}).label || k;
    const STATUS = { open: ['status-pending', '미처리'], resolved: ['status-approved', '처리됨'], dismissed: ['status-neutral', '기각'] };
    body.innerHTML = `<div class="chips" style="margin-bottom:10px">${[['open', '미처리'], ['resolved', '처리됨'], ['dismissed', '기각'], ['', '전체']].map(([k, v]) => `<button type="button" class="chip sm ${status === k ? 'active' : ''}" data-st="${k}">${v}</button>`).join('')}</div>
        ${out.reports.length ? `<div class="card-box"><div class="list">${out.reports.map(x => { const [cls, label] = STATUS[x.status]; const t = x.target; return `<div class="list-row">
            ${t ? `<a href="#/${x.target_type}/${x.target_id}"><img class="thumb" src="${esc(t.image || '')}" alt=""></a>` : '<div class="thumb"></div>'}
            <div class="info"><b>${esc(reasonLabel(x.reason))} <span class="status-badge sm ${cls}">${label}</span> <span class="muted">${x.target_type === 'work' ? '작품' : '프로젝트'}</span></b>
                <small>${t ? `${esc(t.title)} · ${esc(t.author_name)} · ${t.status === 'hidden' ? '<span class="danger-text">숨김 상태</span>' : '공개 상태'}` : '<span class="danger-text">대상이 삭제됨</span>'}</small>
                ${x.detail ? `<small>“${esc(x.detail)}”</small>` : ''}<small>신고자 ${esc(x.reporter?.nickname || '')} · ${timeAgo(x.created_at)}</small></div>
            <div class="gaa-btn-row">${t ? `<button type="button" class="gaa-btn gaa-btn-xs ${t.status === 'hidden' ? 'gaa-btn-secondary' : 'gaa-btn-danger'}" data-hide="${x.id}">${t.status === 'hidden' ? '다시 공개' : '숨기기'}</button>` : ''}
                ${t && t.author_id ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" data-ban="${x.id}">작성자 차단</button>` : ''}
                ${x.status === 'open' ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" data-resolve="${x.id}" data-to="resolved">처리 완료</button><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" data-resolve="${x.id}" data-to="dismissed">기각</button>` : `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" data-resolve="${x.id}" data-to="open">다시 열기</button>`}</div></div>`; }).join('')}</div></div>` : emptyHTML('🚩', '해당 상태의 신고가 없어요.')}`;
    body.onclick = async (e) => {
        const b = e.target.closest('[data-st],[data-hide],[data-ban],[data-resolve]'); if (!b) return;
        if (b.dataset.st != null) return adminReports(body, b.dataset.st);
        const rep = out.reports.find(x => x.id === (b.dataset.hide || b.dataset.ban || b.dataset.resolve));
        if (b.dataset.hide) { const o = await api('admin_set_hidden', { target_type: rep.target_type, target_id: rep.target_id, hidden: rep.target.status !== 'hidden' }); if (o.ok) adminReports(body, status); else showToast(o.message); }
        else if (b.dataset.ban) { const reason = await promptModal({ title: `'${rep.target.author_name}' 사용자를 차단할까요?`, label: '차단 사유', max: 200 }); if (reason == null) return; const o = await api('admin_ban_user', { user_id: rep.target.author_id, banned: true, reason }); if (o.ok) { showToast('차단했습니다. 해당 사용자의 콘텐츠는 숨김 처리됐어요.'); adminReports(body, status); } else showToast(o.message); }
        else if (b.dataset.resolve) { const o = await api('admin_report_resolve', { report_id: rep.id, status: b.dataset.to }); if (o.ok) adminReports(body, status); else showToast(o.message); }
    };
}
async function adminUsers(body, qtext = '') {
    body.innerHTML = `<div class="filter-bar" style="margin-top:0"><div class="search-box">${icon('search')}<input id="uq" placeholder="닉네임 또는 카카오 ID" value="${esc(qtext)}" maxlength="40"></div><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" id="uGo">검색</button></div><div id="uList">${loadingHTML()}</div>`;
    const go = () => adminUsers(body, $('#uq', body).value.trim());
    $('#uGo', body).addEventListener('click', go); $('#uq', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const out = await api('admin_users', { q: qtext });
    const list = $('#uList', body); if (!list) return;
    if (!out.ok) { list.innerHTML = errorHTML(out.message); return; }
    list.innerHTML = out.users.length ? `<div class="card-box"><div class="list">${out.users.map(u => `<div class="list-row">${avatarHTML(u.nickname, u.avatar_url, 'lg')}
        <div class="info"><b>${esc(u.nickname)} ${u.is_admin ? '<span class="status-badge sm status-info">관리자</span>' : ''}${u.is_banned ? '<span class="status-badge sm status-rejected">차단</span>' : ''}</b><small>가입 ${fmtDate(u.created_at)} · 최근 ${u.last_login_at ? timeAgo(u.last_login_at) : '-'}${u.banned_reason ? ` · 사유: ${esc(u.banned_reason)}` : ''}</small></div>
        <div class="gaa-btn-row">${u.id === state.me.id ? '<span class="muted">나</span>' : `<button type="button" class="gaa-btn gaa-btn-xs ${u.is_banned ? 'gaa-btn-secondary' : 'gaa-btn-danger'}" data-ban="${u.id}" data-on="${u.is_banned ? 0 : 1}">${u.is_banned ? '차단 해제' : '차단'}</button>
            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" data-admin="${u.id}" data-on="${u.is_admin ? 0 : 1}">${u.is_admin ? '관리자 해제' : '관리자 지정'}</button>`}</div></div>`).join('')}</div></div>` : emptyHTML('👤', '사용자를 찾을 수 없어요.');
    list.onclick = async (e) => {
        const b = e.target.closest('[data-ban],[data-admin]'); if (!b) return;
        const on = b.dataset.on === '1';
        if (b.dataset.ban) { let reason = ''; if (on) { reason = await promptModal({ title: '차단 사유', max: 200 }); if (reason == null) return; } else if (!await confirmModal({ title: '차단을 해제할까요?', body: '숨겨진 콘텐츠는 자동으로 공개되지 않아요.', okLabel: '해제' })) return;
            const o = await api('admin_ban_user', { user_id: b.dataset.ban, banned: on, reason }); if (o.ok) adminUsers(body, qtext); else showToast(o.message); }
        else if (b.dataset.admin) { if (!await confirmModal({ title: on ? '관리자로 지정할까요?' : '관리자 권한을 해제할까요?', body: on ? '와펜 등록·신고 처리·사용자 차단 권한을 갖게 됩니다.' : '', okLabel: '확인' })) return;
            const o = await api('admin_set_admin', { user_id: b.dataset.admin, is_admin: on }); if (o.ok) adminUsers(body, qtext); else showToast(o.message); }
    };
}

// ══════════════════════════════════════════════════════════════════
// 부트
// ══════════════════════════════════════════════════════════════════
function boot() {
    initTheme();
    initKakao();
    // 카카오톡 등 메신저는 #hash 를 버리므로 공유 링크는 ?w= / ?p= 쿼리로 들어온다 → 해시 라우트로 치환
    const sp = new URLSearchParams(location.search);
    const w = sp.get('w'), p = sp.get('p');
    if (UUID_RE.test(w || '')) history.replaceState(null, '', location.pathname + '#/work/' + w.toLowerCase());
    else if (UUID_RE.test(p || '')) history.replaceState(null, '', location.pathname + '#/project/' + p.toLowerCase());
    else if (location.search) history.replaceState(null, '', location.pathname + (location.hash || ''));
    // 전역 위임: 로그인 게이트 버튼
    app.addEventListener('click', async (e) => { const b = e.target.closest('[data-act="login"]'); if (!b) return; if (await kakaoLogin()) render(); });
    window.addEventListener('hashchange', render);
    window.wappen = { state, api, render, navigate, editor: null };
    if (!sb) { app.innerHTML = errorHTML('필수 스크립트를 불러오지 못했습니다. 새로고침 해주세요.'); return; }
    // 인증 복원은 최대 2초만 기다리고 화면을 그린다 (공개 페이지는 로그인 없이도 보여야 함)
    Promise.race([bootAuth(), new Promise(r => setTimeout(r, 2000))]).catch(() => {}).then(render);
}
boot();
