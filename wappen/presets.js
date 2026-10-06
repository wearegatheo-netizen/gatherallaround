// 와펜 꾸미기 — 사이즈 프리셋·공용 상수 (ESM)
// 브라우저(wappen/app.js, editor.js)와 Cloudflare 함수(functions/wappen-api.js)가 같은 파일을 import 한다.
// → 사이즈 목록·검증 규칙·반응 종류가 한 곳에만 존재. DOM/전역 의존 금지(순수 모듈).

export const PRINT_DPI = 300;                 // 인쇄 기준 해상도
export const PRINT_DPI_FALLBACK = [300, 200, 150, 100]; // 기기 캔버스 한계 시 순서대로 하향
export const mmToPx = (mm, dpi = PRINT_DPI) => Math.round(mm * dpi / 25.4);

export const GROUPS = { print: '인쇄', sns: 'SNS' };

// 인쇄: mm(세로 기준) — 방향(portrait/landscape) 선택 가능. B 계열은 국내 인쇄소 관행인 JIS 규격.
// SNS: px 고정(방향 선택 없음).
export const PRESETS = [
  { key: 'a5', group: 'print', label: 'A5', mm: [148, 210] },
  { key: 'a4', group: 'print', label: 'A4', mm: [210, 297] },
  { key: 'a3', group: 'print', label: 'A3', mm: [297, 420] },
  { key: 'a2', group: 'print', label: 'A2', mm: [420, 594] },
  { key: 'a1', group: 'print', label: 'A1', mm: [594, 841] },
  { key: 'b5', group: 'print', label: 'B5', mm: [182, 257], note: 'JIS' },
  { key: 'b4', group: 'print', label: 'B4', mm: [257, 364], note: 'JIS' },
  { key: 'ig_square',   group: 'sns', label: '인스타그램 정방형',   px: [1080, 1080], note: '피드 1:1' },
  { key: 'ig_portrait', group: 'sns', label: '인스타그램 세로',     px: [1080, 1350], note: '피드 4:5' },
  { key: 'ig_story',    group: 'sns', label: '인스타 스토리·릴스',  px: [1080, 1920], note: '9:16' },
  { key: 'fb_post',     group: 'sns', label: '페이스북 게시물',     px: [1200, 630] },
  { key: 'yt_thumb',    group: 'sns', label: '유튜브 썸네일',       px: [1280, 720] },
  { key: 'x_post',      group: 'sns', label: 'X(트위터) 게시물',    px: [1600, 900] },
];

const BY_KEY = new Map(PRESETS.map(p => [p.key, p]));
export const presetOf = (key) => BY_KEY.get(String(key || '')) || null;
export const ORIENTATIONS = ['portrait', 'landscape'];

// 유효한 (size_key, orientation) 조합인지 — SNS 는 portrait 고정
export function isValidSize(key, orientation) {
  const p = presetOf(key);
  if (!p) return false;
  if (p.group === 'sns') return orientation === 'portrait';
  return ORIENTATIONS.includes(orientation);
}

// 내보내기 픽셀 크기. 인쇄는 dpi 로 환산, SNS 는 고정 px (dpi 무시)
export function presetDims(key, orientation = 'portrait', dpi = PRINT_DPI) {
  const p = presetOf(key);
  if (!p) return null;
  let w, h;
  if (p.group === 'print') { w = mmToPx(p.mm[0], dpi); h = mmToPx(p.mm[1], dpi); }
  else { [w, h] = p.px; }
  if (p.group === 'print' && orientation === 'landscape') [w, h] = [h, w];
  return { w, h };
}

// 표시용 — "A4 세로 · 210×297mm" / "인스타그램 정방형 · 1080×1080px"
export function presetLabel(key, orientation = 'portrait', { withGroup = false } = {}) {
  const p = presetOf(key);
  if (!p) return String(key || '');
  let s;
  if (p.group === 'print') {
    const [a, b] = orientation === 'landscape' ? [p.mm[1], p.mm[0]] : p.mm;
    s = `${p.label} ${orientation === 'landscape' ? '가로' : '세로'} · ${a}×${b}mm`;
  } else {
    s = `${p.label} · ${p.px[0]}×${p.px[1]}px`;
  }
  return withGroup ? `${GROUPS[p.group]} · ${s}` : s;
}

// 인쇄 프리셋의 dpi 후보 목록(큰 것부터) — 내보내기 폴백 순서
export function exportSizes(key, orientation = 'portrait') {
  const p = presetOf(key);
  if (!p) return [];
  if (p.group === 'sns') return [{ dpi: null, ...presetDims(key, orientation) }];
  return PRINT_DPI_FALLBACK.map(dpi => ({ dpi, ...presetDims(key, orientation, dpi) }));
}

// 감정표현 — 작품당 1인 1개
export const REACTIONS = [
  { key: 'love', emoji: '❤️', label: '좋아요' },
  { key: 'cool', emoji: '👍', label: '멋져요' },
  { key: 'lol',  emoji: '😂', label: '웃겨요' },
  { key: 'wow',  emoji: '😮', label: '놀라워요' },
  { key: 'fire', emoji: '🔥', label: '불타요' },
];
export const REACTION_KEYS = REACTIONS.map(r => r.key);

export const REPORT_REASONS = [
  { key: 'sexual',    label: '음란·선정성' },
  { key: 'violence',  label: '폭력·혐오' },
  { key: 'copyright', label: '저작권 침해' },
  { key: 'spam',      label: '스팸·광고' },
  { key: 'other',     label: '기타' },
];

// 레이아웃(작품 배치) 스키마 한계 — 서버 검증과 에디터가 공유
// { v:1, items:[{ id, x, y, w, r, fx }] } : x,y 중심(캔버스 폭·높이 대비), w 폭(캔버스 폭 대비), r 각도(deg), fx 좌우반전. 배열 순서 = z.
export const LAYOUT = {
  version: 1,
  maxItems: 200,
  pos: [-0.5, 1.5],
  width: [0.01, 3],
  rot: [-360, 360],
};

export const LIMITS = {
  title: 60, description: 500, nickname: 20, itemName: 40, category: 30, tags: 10, tagLen: 20,
  requestDesc: 500, reportDetail: 300,
  perDay: { projects: 20, works: 100, reports: 20, requests: 10 },
};
