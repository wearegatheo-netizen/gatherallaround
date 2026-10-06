// 기본 와펜 세트 — 전부 이 파일에서 코드로 그린 원본(저작권 문제 없음, CC0).
// 1000×1000 viewBox. 자수 패치 느낌: 진한 외곽선(ink) + 외곽선 위 흰 점선(스티치) + 평면 파스텔 색.
// 빌드: node tools/wappen-seed/build.mjs  → wappen/seed/*.png + manifest.js

export const C = {
    ink: '#2D2A32', white: '#FFFFFF', cream: '#FFF4DC', yellow: '#FFD93D', orange: '#FF9F43', red: '#FF5C6C',
    pink: '#FF8FB1', blush: '#FFB3C1', green: '#7ED957', dgreen: '#3DAA5C', mint: '#5EE2C3', sky: '#79C3FF',
    blue: '#4F8DFF', purple: '#B48CFF', brown: '#9C6B3F', tan: '#E0B080', gray: '#C9CCD6', dark: '#3C3A47',
    skin: '#FFD5B8', lilac: '#D9C2FF', navy: '#2E3A59',
};
const ink = C.ink;
export const SW = 26;

// ── 기본 조각 ────────────────────────────────────────────────────
export const P = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;
export const stitch = (d, op = 0.62) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width="5" stroke-dasharray="15 12" stroke-linecap="round"/>`;
export const patch = (d, fill) => P(d, fill) + stitch(d);
// 여러 조각의 합집합: 외곽선 그린 뒤 채움만 다시 덮어 내부 선을 지운다. 스티치는 지정한 조각에만.
export const union = (parts, fill, stitchIdx = []) =>
    parts.map(d => P(d, fill)).join('') + parts.map(d => `<path d="${d}" fill="${fill}"/>`).join('') + stitchIdx.map(i => stitch(parts[i])).join('');
export const circle = (cx, cy, r) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
export const ellipse = (cx, cy, rx, ry) => `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;
export const rrect = (x, y, w, h, r) => `M ${x + r} ${y} h ${w - 2 * r} a ${r} ${r} 0 0 1 ${r} ${r} v ${h - 2 * r} a ${r} ${r} 0 0 1 ${-r} ${r} h ${-(w - 2 * r)} a ${r} ${r} 0 0 1 ${-r} ${-r} v ${-(h - 2 * r)} a ${r} ${r} 0 0 1 ${r} ${-r} Z`;
export const poly = (pts) => 'M ' + pts.map(p => p.join(' ')).join(' L ') + ' Z';
export const star = (cx, cy, R, r, n = 5, rot = -90) => {
    const pts = [];
    for (let i = 0; i < n * 2; i++) { const a = (rot + i * 180 / n) * Math.PI / 180, rr = i % 2 ? r : R; pts.push([+(cx + rr * Math.cos(a)).toFixed(1), +(cy + rr * Math.sin(a)).toFixed(1)]); }
    return poly(pts);
};
export const heart = (cx, cy, s) => `M ${cx} ${cy + 0.44 * s} C ${cx - 0.2 * s} ${cy + 0.24 * s} ${cx - 0.5 * s} ${cy + 0.05 * s} ${cx - 0.5 * s} ${cy - 0.16 * s} A ${0.25 * s} ${0.25 * s} 0 0 1 ${cx} ${cy - 0.2 * s} A ${0.25 * s} ${0.25 * s} 0 0 1 ${cx + 0.5 * s} ${cy - 0.16 * s} C ${cx + 0.5 * s} ${cy + 0.05 * s} ${cx + 0.2 * s} ${cy + 0.24 * s} ${cx} ${cy + 0.44 * s} Z`;
export const dot = (cx, cy, r, fill = ink) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
export const line = (x1, y1, x2, y2, w = SW, color = ink) => `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
export const stroke = (d, w = SW, color = ink, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
export const shine = (cx, cy, rx, ry, rot = -30) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" fill-opacity=".55" transform="rotate(${rot} ${cx} ${cy})"/>`;
export const g = (inner, transform) => `<g transform="${transform}">${inner}</g>`;

// 귀여운 얼굴: 점 눈(+하이라이트), 볼터치, 입
export const face = (cx, cy, s = 1, o = {}) => {
    const { eyes = 'dot', mouth = 'smile', blush = true, gap = 42, eyeY = 0 } = o;
    let out = '';
    const ey = cy + eyeY * s;
    if (eyes === 'dot') {
        out += dot(cx - gap * s, ey, 17 * s) + dot(cx + gap * s, ey, 17 * s) + dot(cx - gap * s + 6 * s, ey - 6 * s, 6 * s, '#fff') + dot(cx + gap * s + 6 * s, ey - 6 * s, 6 * s, '#fff');
    } else if (eyes === 'happy') {
        out += stroke(`M ${cx - gap * s - 16 * s} ${ey + 6 * s} q ${16 * s} ${-22 * s} ${32 * s} 0`, 11 * s) + stroke(`M ${cx + gap * s - 16 * s} ${ey + 6 * s} q ${16 * s} ${-22 * s} ${32 * s} 0`, 11 * s);
    } else if (eyes === 'sleepy') {
        out += stroke(`M ${cx - gap * s - 16 * s} ${ey - 4 * s} q ${16 * s} ${22 * s} ${32 * s} 0`, 11 * s) + stroke(`M ${cx + gap * s - 16 * s} ${ey - 4 * s} q ${16 * s} ${22 * s} ${32 * s} 0`, 11 * s);
    }
    if (blush) out += dot(cx - (gap + 34) * s, cy + 22 * s, 15 * s, C.blush) + dot(cx + (gap + 34) * s, cy + 22 * s, 15 * s, C.blush);
    if (mouth === 'smile') out += stroke(`M ${cx - 20 * s} ${cy + 26 * s} q ${20 * s} ${22 * s} ${40 * s} 0`, 10 * s);
    else if (mouth === 'open') out += `<path d="M ${cx - 24 * s} ${cy + 22 * s} q ${24 * s} ${42 * s} ${48 * s} 0 Z" fill="${ink}"/>` + `<path d="M ${cx - 12 * s} ${cy + 36 * s} q ${12 * s} ${14 * s} ${24 * s} 0 Z" fill="${C.pink}"/>`;
    else if (mouth === 'w') out += stroke(`M ${cx - 26 * s} ${cy + 24 * s} q ${13 * s} ${18 * s} ${26 * s} 0 q ${13 * s} ${18 * s} ${26 * s} 0`, 9 * s);
    else if (mouth === 'o') out += dot(cx, cy + 34 * s, 10 * s);
    return out;
};

// 글자 배지: 배경 조각 + 흰 글자(진한 외곽선)
export const label = (t, { x = 500, y = 505, size = 190, font = 'Inter', weight = 900, fill = '#fff', sw = 20, ls = 0, rot = 0 } = {}) =>
    `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke" letter-spacing="${ls}" transform="rotate(${rot} ${x} ${y})">${t}</text>`;
const KO = { font: 'KkuBulLim', weight: 400, size: 230, sw: 18 };

// ── 디자인 목록 ───────────────────────────────────────────────────
const D = [];
const add = (key, name, category, tags, svg) => D.push({ key, name, category, tags, svg });

// 1) 도형·기호
add('star', '별', '도형·기호', ['반짝', '노랑', '밤'],
    patch(star(500, 520, 420, 190), C.yellow) + shine(380, 400, 40, 22) + face(500, 560, 1.2));
add('heart', '하트', '도형·기호', ['사랑', '핑크', '러브'],
    patch(heart(500, 500, 760), C.red) + shine(330, 360, 48, 26) + face(500, 520, 1.2));
add('bolt', '번개', '도형·기호', ['번쩍', '에너지', '노랑'],
    patch(poly([[560, 70], [230, 540], [460, 540], [400, 930], [770, 420], [540, 420]]), C.yellow) + shine(430, 330, 24, 60, -20));
add('rainbow', '무지개', '도형·기호', ['하늘', '행운', '컬러'],
    patch(`M 100 700 A 400 400 0 0 1 900 700 L 750 700 A 250 250 0 0 0 250 700 Z`, C.white)
    + [C.red, C.orange, C.yellow, C.green, C.sky].map((c, i) => stroke(`M ${500 - (386 - i * 30)} 700 A ${386 - i * 30} ${386 - i * 30} 0 0 1 ${500 + (386 - i * 30)} 700`, 28, c)).join('')
    + patch(`M 70 720 a 70 70 0 0 1 60 -110 a 90 90 0 0 1 150 -20 a 60 60 0 0 1 40 130 Z`, C.white)
    + patch(`M 680 720 a 60 60 0 0 1 40 -130 a 90 90 0 0 1 150 20 a 70 70 0 0 1 60 110 Z`, C.white));
add('cloud', '구름', '도형·기호', ['하늘', '구름', '몽글'],
    patch(`M 180 680 A 120 120 0 0 1 300 470 A 170 170 0 0 1 560 390 A 150 150 0 0 1 800 510 A 110 110 0 0 1 820 680 Z`, C.white) + face(500, 560, 1.3));
add('sun', '해', '도형·기호', ['햇빛', '여름', '따뜻'],
    patch(star(500, 500, 460, 330, 12), C.orange) + patch(circle(500, 500, 270), C.yellow) + shine(400, 400, 44, 24) + face(500, 520, 1.3));
add('moon', '달', '도형·기호', ['밤', '졸려', '노랑'],
    patch(`M 640 110 A 390 390 0 1 0 640 890 A 310 310 0 1 1 640 110 Z`, C.yellow) + shine(380, 330, 40, 22) + face(420, 520, 1.2, { eyes: 'sleepy', mouth: 'o' }));
add('sparkle', '반짝이', '도형·기호', ['반짝', '별', '마법'],
    patch(star(470, 540, 400, 120, 4, -90), C.yellow) + patch(star(790, 220, 130, 40, 4, -90), C.white) + patch(star(230, 180, 90, 28, 4, -90), C.pink) + shine(400, 420, 30, 16));
add('flame', '불꽃', '도형·기호', ['불타요', '뜨거워', '열정'],
    patch(`M 500 80 C 580 280 800 360 800 610 A 300 300 0 0 1 200 610 C 200 430 400 330 500 80 Z`, C.orange)
    + P(`M 500 360 C 540 470 660 500 660 640 A 160 160 0 0 1 340 640 C 340 540 460 480 500 360 Z`, C.yellow) + face(500, 650, 1, { eyes: 'happy' }));
add('gem', '보석', '도형·기호', ['다이아', '반짝', '파랑'],
    patch(poly([[200, 400], [330, 240], [670, 240], [800, 400], [500, 830]]), C.sky)
    + stroke(`M 200 400 L 800 400 M 330 240 L 400 400 L 500 830 M 670 240 L 600 400 L 500 830`, 10, '#fff', 'stroke-opacity=".7"') + face(500, 520, 1.1));

// 2) 동물
add('cat', '고양이', '동물', ['야옹', '귀여워', '동물'],
    patch(poly([[230, 420], [200, 150], [430, 330]]), C.orange) + patch(poly([[770, 420], [800, 150], [570, 330]]), C.orange)
    + `<path d="${poly([[260, 380], [245, 230], [380, 340]])}" fill="${C.pink}"/><path d="${poly([[740, 380], [755, 230], [620, 340]])}" fill="${C.pink}"/>`
    + patch(ellipse(500, 560, 310, 260), C.orange) + shine(360, 420, 50, 26)
    + face(500, 540, 1.2, { mouth: 'w', gap: 70 }) + `<path d="M 480 590 L 520 590 L 500 612 Z" fill="${C.pink}"/>`
    + line(150, 560, 290, 575, 9) + line(150, 630, 290, 610, 9) + line(850, 560, 710, 575, 9) + line(850, 630, 710, 610, 9));
add('dog', '강아지', '동물', ['멍멍', '귀여워', '동물'],
    patch(ellipse(250, 560, 110, 230), C.brown) + patch(ellipse(750, 560, 110, 230), C.brown)
    + patch(ellipse(500, 540, 300, 270), C.tan) + shine(370, 400, 50, 26)
    + face(500, 500, 1.2, { mouth: 'none', gap: 70 }) + patch(ellipse(500, 620, 120, 90), C.cream)
    + `<path d="${ellipse(500, 590, 36, 26)}" fill="${ink}"/>` + stroke(`M 470 640 q 30 40 60 0`, 10)
    + `<path d="M 470 668 q 30 50 60 0 Z" fill="${C.pink}" stroke="${ink}" stroke-width="8"/>`);
add('bear', '곰', '동물', ['곰돌이', '귀여워', '동물'],
    patch(circle(260, 300, 110), C.brown) + patch(circle(740, 300, 110), C.brown) + dot(260, 300, 55, C.tan) + dot(740, 300, 55, C.tan)
    + patch(circle(500, 540, 320), C.brown) + shine(370, 400, 50, 26)
    + patch(ellipse(500, 640, 130, 95), C.tan) + face(500, 500, 1.2, { mouth: 'none', gap: 75 })
    + `<path d="${ellipse(500, 610, 40, 28)}" fill="${ink}"/>` + stroke(`M 470 660 q 30 36 60 0`, 10));
add('bunny', '토끼', '동물', ['깡총', '귀여워', '동물'],
    patch(ellipse(390, 230, 85, 220), C.white) + patch(ellipse(610, 230, 85, 220), C.white)
    + `<path d="${ellipse(390, 240, 40, 160)}" fill="${C.pink}"/><path d="${ellipse(610, 240, 40, 160)}" fill="${C.pink}"/>`
    + patch(ellipse(500, 600, 310, 270), C.white) + face(500, 580, 1.2, { mouth: 'w', gap: 68 })
    + `<path d="M 482 628 L 518 628 L 500 650 Z" fill="${C.pink}"/>`
    + `<rect x="470" y="690" width="26" height="40" rx="6" fill="#fff" stroke="${ink}" stroke-width="8"/><rect x="504" y="690" width="26" height="40" rx="6" fill="#fff" stroke="${ink}" stroke-width="8"/>`);
add('frog', '개구리', '동물', ['개굴', '초록', '동물'],
    patch(circle(330, 300, 120), C.green) + patch(circle(670, 300, 120), C.green)
    + patch(ellipse(500, 580, 360, 270), C.green) + shine(330, 480, 60, 30)
    + dot(330, 300, 50) + dot(670, 300, 50) + dot(348, 285, 18, '#fff') + dot(688, 285, 18, '#fff')
    + stroke(`M 330 620 q 170 120 340 0`, 12) + dot(260, 600, 24, C.blush) + dot(740, 600, 24, C.blush));
add('penguin', '펭귄', '동물', ['뒤뚱', '겨울', '동물'],
    patch(ellipse(500, 540, 300, 360), C.navy) + `<path d="${ellipse(500, 620, 210, 250)}" fill="${C.white}"/>`
    + `<path d="${ellipse(500, 380, 200, 150)}" fill="${C.white}"/>`
    + face(500, 380, 1.1, { mouth: 'none', gap: 60 }) + `<path d="${poly([[440, 430], [560, 430], [500, 500]])}" fill="${C.orange}" stroke="${ink}" stroke-width="10" stroke-linejoin="round"/>`
    + patch(ellipse(420, 900, 90, 36), C.orange) + patch(ellipse(580, 900, 90, 36), C.orange));
add('chick', '병아리', '동물', ['삐약', '노랑', '아기'],
    stroke(`M 480 180 q 10 -60 40 -30 q 20 -60 50 -10`, 14)
    + patch(circle(500, 540, 320), C.yellow) + shine(370, 400, 50, 26)
    + patch(ellipse(260, 600, 70, 130), C.yellow)
    + face(500, 500, 1.2, { mouth: 'none', gap: 70 }) + `<path d="${poly([[460, 560], [540, 560], [500, 620]])}" fill="${C.orange}" stroke="${ink}" stroke-width="10" stroke-linejoin="round"/>`);
add('pig', '돼지', '동물', ['꿀꿀', '핑크', '동물'],
    patch(poly([[240, 400], [220, 200], [420, 300]]), C.pink) + patch(poly([[760, 400], [780, 200], [580, 300]]), C.pink)
    + patch(circle(500, 540, 320), C.pink) + shine(370, 400, 50, 26)
    + face(500, 490, 1.2, { mouth: 'none', gap: 80 }) + patch(ellipse(500, 620, 110, 72), C.blush)
    + dot(465, 620, 16) + dot(535, 620, 16));
add('panda', '판다', '동물', ['대나무', '흑백', '동물'],
    patch(circle(270, 300, 100), C.dark) + patch(circle(730, 300, 100), C.dark)
    + patch(circle(500, 540, 320), C.white)
    + `<ellipse cx="400" cy="500" rx="80" ry="100" fill="${C.dark}" transform="rotate(-20 400 500)"/><ellipse cx="600" cy="500" rx="80" ry="100" fill="${C.dark}" transform="rotate(20 600 500)"/>`
    + dot(410, 505, 22, '#fff') + dot(590, 505, 22, '#fff') + dot(414, 505, 11) + dot(594, 505, 11)
    + `<path d="${ellipse(500, 620, 34, 24)}" fill="${ink}"/>` + stroke(`M 470 660 q 30 36 60 0`, 10) + dot(300, 600, 22, C.blush) + dot(700, 600, 22, C.blush));
add('fox', '여우', '동물', ['주황', '숲', '동물'],
    patch(poly([[210, 430], [190, 140], [420, 330]]), C.orange) + patch(poly([[790, 430], [810, 140], [580, 330]]), C.orange)
    + patch(`M 180 420 C 180 300 820 300 820 420 C 820 600 640 760 500 880 C 360 760 180 600 180 420 Z`, C.orange)
    + `<path d="M 330 560 C 330 480 670 480 670 560 C 670 680 580 780 500 850 C 420 780 330 680 330 560 Z" fill="${C.cream}"/>`
    + face(500, 520, 1.2, { mouth: 'none', gap: 95 }) + `<path d="${ellipse(500, 720, 34, 26)}" fill="${ink}"/>`);
add('dino', '공룡', '동물', ['초록', '귀여워', '쥬라기'],
    [[300, 330], [400, 260], [510, 240], [620, 270]].map(([x, y]) => patch(poly([[x - 50, y + 60], [x, y - 70], [x + 50, y + 60]]), C.dgreen)).join('')
    + union([ellipse(480, 560, 320, 230), circle(700, 400, 160), poly([[180, 560], [40, 640], [220, 700]]), rrect(300, 680, 120, 180, 50), rrect(540, 680, 120, 180, 50)], C.green, [0, 1])
    + shine(400, 440, 60, 30) + face(720, 400, 1.1, { gap: 40, eyes: 'dot', mouth: 'smile' })
    + dot(560, 560, 14, C.dgreen) + dot(640, 620, 14, C.dgreen) + dot(470, 640, 14, C.dgreen));

// 3) 음악
add('note', '음표', '음악', ['멜로디', '노래', '보라'],
    union([`M 560 180 C 700 220 760 330 680 480 C 740 360 660 300 560 290 Z`, rrect(520, 180, 44, 540, 22), `M 300 760 a 130 95 0 1 0 260 0 a 130 95 0 1 0 -260 0 Z`], C.purple, [0, 2]) + shine(400, 730, 44, 20));
add('guitar', '기타', '음악', ['통기타', '밴드', '연주'],
    patch(rrect(455, 60, 90, 150, 30), C.brown) + patch(rrect(470, 180, 60, 420, 20), C.tan)
    + union([circle(500, 560, 150), circle(500, 740, 200)], C.orange, [0, 1]) + shine(400, 680, 50, 28)
    + patch(circle(500, 660, 62), C.dark)
    + [-30, -15, 0, 15, 30].map(dx => line(500 + dx, 200, 500 + dx * 0.6, 820, 6, '#fff')).join('')
    + patch(rrect(430, 810, 140, 36, 14), C.dark));
add('drum', '드럼', '음악', ['밴드', '둥둥', '리듬'],
    patch(`M 200 400 V 700 A 300 110 0 0 0 800 700 V 400 Z`, C.red) + patch(ellipse(500, 400, 300, 110), C.cream)
    + [250, 330, 410, 490, 570, 650, 730].map(x => line(x, 440, x + 40, 700, 8, '#fff')).join('')
    + line(380, 230, 520, 420, 22, C.tan) + line(620, 230, 480, 420, 22, C.tan) + dot(380, 230, 26, C.tan) + dot(620, 230, 26, C.tan));
add('headphones', '헤드폰', '음악', ['음악감상', '파랑', '힙'],
    stroke(`M 180 600 V 500 A 320 320 0 0 1 820 500 V 600`, 70) + stroke(`M 180 600 V 500 A 320 320 0 0 1 820 500 V 600`, 36, C.blue)
    + patch(rrect(110, 540, 170, 260, 60), C.blue) + patch(rrect(720, 540, 170, 260, 60), C.blue)
    + `<path d="${rrect(150, 580, 90, 180, 40)}" fill="${C.sky}"/><path d="${rrect(760, 580, 90, 180, 40)}" fill="${C.sky}"/>`);
add('mic', '마이크', '음악', ['노래', '보컬', '라이브'],
    patch(rrect(420, 480, 160, 440, 70), C.dark) + patch(circle(500, 330, 220), C.gray)
    + stroke(`M 300 260 H 700 M 290 330 H 710 M 300 400 H 700 M 430 120 V 540 M 500 112 V 548 M 570 120 V 540`, 8, ink, 'stroke-opacity=".45"')
    + shine(420, 240, 44, 24) + patch(rrect(400, 470, 200, 60, 24), C.red));
add('vinyl', 'LP판', '음악', ['레코드', '빈티지', '음악'],
    patch(circle(500, 500, 420), C.dark) + [340, 280, 220].map(r => stroke(circle(500, 500, r), 6, '#fff', 'stroke-opacity=".25"')).join('')
    + patch(circle(500, 500, 140), C.pink) + dot(500, 500, 24) + shine(330, 330, 70, 30));
add('cassette', '카세트', '음악', ['테이프', '레트로', '90s'],
    patch(rrect(110, 230, 780, 540, 60), C.purple) + `<path d="${rrect(170, 300, 660, 260, 40)}" fill="${C.cream}"/>`
    + patch(circle(340, 430, 80), C.white) + patch(circle(660, 430, 80), C.white) + dot(340, 430, 30) + dot(660, 430, 30)
    + line(420, 430, 580, 430, 20, ink) + `<path d="${rrect(300, 620, 400, 90, 30)}" fill="${C.lilac}"/>`
    + [160, 840].map(x => dot(x, 720, 14, C.white)).join(''));
add('piano', '피아노', '음악', ['건반', '연주', '흑백'],
    patch(rrect(110, 260, 780, 480, 40), C.white) + [222, 334, 446, 558, 670, 782].map(x => line(x, 272, x, 728, 10)).join('')
    + [190, 300, 520, 630, 740].map(x => `<rect x="${x - 30}" y="272" width="60" height="260" rx="10" fill="${ink}"/>`).join(''));
add('speaker', '스피커', '음악', ['앰프', '소리', '빵빵'],
    patch(rrect(220, 110, 560, 780, 60), C.dark) + patch(circle(500, 620, 180), C.gray) + patch(circle(500, 620, 90), C.dark)
    + patch(circle(500, 300, 100), C.gray) + dot(500, 300, 36, C.dark) + stroke(`M 740 560 q 60 60 0 120 M 790 520 q 110 100 0 200`, 14, C.yellow));
add('rockhand', '락 손', '음악', ['락앤롤', '메탈', '예'],
    union([rrect(300, 520, 400, 330, 90), rrect(300, 170, 120, 420, 60), rrect(580, 200, 120, 400, 60), rrect(430, 430, 250, 180, 70), rrect(190, 560, 150, 200, 70)], C.skin, [0, 1, 2])
    + stroke(`M 470 460 V 600 M 560 460 V 600`, 12, ink, 'stroke-opacity=".35"')
    + patch(rrect(240, 820, 520, 90, 40), C.red));
add('amp', '앰프', '음악', ['기타앰프', '밴드', '볼륨'],
    patch(rrect(130, 230, 740, 560, 50), C.dark) + `<path d="${rrect(190, 300, 620, 320, 30)}" fill="${C.tan}"/>`
    + [340, 400, 460, 520, 580].map(y => line(200, y, 800, y, 6, ink, )).join('').replaceAll('stroke-width="6"', 'stroke-width="6" stroke-opacity=".35"')
    + [300, 400, 500, 600, 700].map(x => patch(circle(x, 700, 32), C.gray)).join('') + patch(rrect(400, 160, 200, 80, 30), C.dark));

// 4) 음식
add('strawberry', '딸기', '음식', ['달콤', '빨강', '과일'],
    patch(`M 500 900 C 250 800 160 600 180 430 C 200 300 350 260 500 300 C 650 260 800 300 820 430 C 840 600 750 800 500 900 Z`, C.red)
    + [[380, 450], [520, 420], [640, 480], [330, 600], [470, 560], [600, 640], [420, 720], [560, 760]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="14" ry="22" fill="${C.cream}"/>`).join('')
    + patch(`M 500 300 L 380 150 L 460 270 L 500 100 L 540 270 L 620 150 Z`, C.dgreen) + face(500, 560, 1.2));
add('cherry', '체리', '음식', ['빨강', '달콤', '과일'],
    stroke(`M 380 600 C 420 360 520 240 540 120 M 640 640 C 620 400 570 260 540 120`, 22) + patch(ellipse(600, 180, 110, 50), C.dgreen)
    + patch(circle(370, 640, 170), C.red) + patch(circle(650, 680, 160), C.red) + shine(300, 560, 40, 22) + shine(590, 600, 36, 20)
    + face(370, 660, 0.9) + face(650, 700, 0.85, { eyes: 'happy' }));
add('watermelon', '수박', '음식', ['여름', '시원', '과일'],
    patch(`M 100 400 A 400 400 0 0 0 900 400 Z`, C.dgreen) + `<path d="M 160 400 A 340 340 0 0 0 840 400 Z" fill="${C.cream}"/><path d="M 210 400 A 290 290 0 0 0 790 400 Z" fill="${C.red}"/>`
    + [[380, 480], [500, 560], [620, 480], [450, 620], [560, 640]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="14" ry="22" fill="${ink}"/>`).join('')
    + face(500, 470, 1.1, { blush: true }));
add('icecream', '아이스크림', '음식', ['달콤', '여름', '디저트'],
    patch(poly([[320, 520], [500, 930], [680, 520]]), C.tan) + stroke(`M 360 560 L 560 760 M 440 560 L 620 740 M 640 560 L 440 760 M 560 560 L 400 720`, 8, ink, 'stroke-opacity=".3"')
    + union([circle(500, 440, 190), circle(500, 290, 130)], C.pink, [0, 1]) + shine(400, 380, 44, 24) + patch(circle(500, 150, 40), C.red) + face(500, 470, 1.1));
add('donut', '도넛', '음식', ['달콤', '핑크', '디저트'],
    P(`${circle(500, 500, 400)} ${circle(500, 500, 130)}`, C.tan, 'fill-rule="evenodd"') + stitch(circle(500, 500, 400))
    + `<path d="${circle(500, 500, 330)} ${circle(500, 500, 165)}" fill="${C.pink}" fill-rule="evenodd" stroke="${ink}" stroke-width="14"/>`
    + [[380, 300, C.yellow, 30], [600, 280, C.sky, -20], [700, 460, C.green, 70], [660, 640, C.yellow, -40], [340, 660, C.sky, 20], [280, 480, C.green, 80], [500, 230, C.red, 0], [520, 760, C.red, 10]]
        .map(([x, y, c, a]) => `<rect x="${x - 22}" y="${y - 7}" width="44" height="14" rx="7" fill="${c}" transform="rotate(${a} ${x} ${y})"/>`).join(''));
add('pizza', '피자', '음식', ['치즈', '야식', '맛있다'],
    patch(`M 500 100 L 130 780 A 420 420 0 0 0 870 780 Z`, C.yellow) + stroke(`M 150 745 A 420 420 0 0 0 850 745`, 60, C.tan) + stroke(`M 150 745 A 420 420 0 0 0 850 745`, 60, ink, 'stroke-opacity=".15"')
    + [[500, 380], [400, 560], [600, 580], [500, 720]].map(([x, y]) => patch(circle(x, y, 52), C.red)).join(''));
add('burger', '햄버거', '음식', ['야식', '맛있다', '패스트푸드'],
    patch(`M 150 440 A 350 310 0 0 1 850 440 Z`, C.tan) + [[330, 300], [500, 250], [670, 300], [420, 380], [580, 380]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="18" ry="11" fill="${C.cream}"/>`).join('')
    + patch(rrect(150, 440, 700, 70, 20), C.yellow) + patch(rrect(140, 510, 720, 100, 40), C.brown)
    + patch(`M 130 650 q 40 -50 80 0 q 40 -50 80 0 q 40 -50 80 0 q 40 -50 80 0 q 40 -50 80 0 q 40 -50 80 0 q 40 -50 80 0 q 40 -50 80 0 V 700 H 130 Z`, C.green)
    + patch(rrect(160, 690, 680, 150, 70), C.tan) + face(500, 760, 0.9, { blush: false }));
add('coffee', '커피', '음식', ['카페', '따뜻', '아침'],
    stroke(`M 240 230 q 20 -80 0 -140 M 420 240 q 20 -80 0 -140 M 600 230 q 20 -80 0 -140`, 16, C.gray)
    + stroke(`M 720 420 a 110 110 0 0 1 0 220`, 60) + stroke(`M 720 420 a 110 110 0 0 1 0 220`, 30, C.pink)
    + patch(`M 180 320 V 720 A 270 100 0 0 0 720 720 V 320 Z`, C.pink) + patch(ellipse(450, 320, 270, 100), C.white)
    + `<path d="${ellipse(450, 320, 200, 60)}" fill="${C.brown}"/>` + face(450, 540, 1.1));
add('lemon', '레몬', '음식', ['상큼', '노랑', '과일'],
    patch(`M 120 520 C 120 300 330 250 500 250 C 670 250 880 300 880 520 C 880 740 670 790 500 790 C 330 790 120 740 120 520 Z`, C.yellow)
    + patch(ellipse(520, 230, 130, 50), C.dgreen) + shine(300, 420, 60, 30) + face(500, 540, 1.2, { eyes: 'happy' }));
add('egg', '계란 후라이', '음식', ['아침', '노른자', '귀여워'],
    patch(`M 300 200 C 420 120 620 140 720 240 C 860 300 880 480 820 600 C 780 760 580 880 420 840 C 220 800 100 640 140 460 C 170 340 220 250 300 200 Z`, C.white)
    + patch(circle(480, 500, 170), C.yellow) + shine(400, 430, 40, 22) + face(480, 520, 1));

// 5) 글자
const badge = (bg, shape, text, opt = {}) => patch(shape, bg) + label(text, opt);
add('txt-love', 'LOVE', '글자', ['사랑', '영문', '배지'], badge(C.pink, rrect(80, 330, 840, 340, 170), 'LOVE', { size: 210, ls: 6 }));
add('txt-rock', 'ROCK', '글자', ['락', '밴드', '영문'], badge(C.dark, rrect(100, 300, 800, 400, 60), 'ROCK', { size: 220, fill: C.yellow, ls: 4 }));
add('txt-wow', 'WOW!', '글자', ['놀라워', '영문', '배지'], badge(C.yellow, star(500, 500, 470, 360, 14, -90), 'WOW!', { size: 200, fill: ink, sw: 0 }));
add('txt-ok', 'OK!', '글자', ['좋아', '영문', '배지'], badge(C.green, circle(500, 500, 400), 'OK!', { size: 250 }));
add('txt-live', 'LIVE', '글자', ['공연', '라이브', '영문'], badge(C.red, rrect(100, 320, 800, 360, 50), 'LIVE', { size: 220, ls: 8 }));
add('txt-band', 'BAND', '글자', ['밴드', '음악', '영문'], badge(C.blue, rrect(80, 330, 840, 340, 170), 'BAND', { size: 200, ls: 6 }));
add('txt-yeah', 'YEAH!', '글자', ['신나', '영문', '배지'], badge(C.purple, rrect(80, 300, 840, 400, 80), 'YEAH!', { size: 190, rot: -6 }));
add('txt-best', '최고', '글자', ['최고', '한글', '칭찬'], badge(C.yellow, rrect(100, 280, 800, 440, 70), '최고', { ...KO, size: 300, fill: ink, sw: 0 }));
add('txt-good', '굿', '글자', ['굿', '한글', '칭찬'], badge(C.mint, circle(500, 500, 400), '굿', { ...KO, size: 380, fill: '#fff', sw: 20 }));
add('txt-fighting', '화이팅', '글자', ['응원', '한글', '힘내'], badge(C.red, rrect(60, 320, 880, 360, 180), '화이팅', { ...KO, size: 230, fill: '#fff', sw: 18 }));
add('txt-cute', '귀여워', '글자', ['귀여워', '한글', '하트'], badge(C.pink, heart(500, 480, 900), '귀여워', { ...KO, size: 200, fill: '#fff', sw: 18, y: 470 }));
add('txt-daebak', '대박', '글자', ['대박', '한글', '놀라워'], badge(C.orange, star(500, 500, 480, 370, 16, -90), '대박', { ...KO, size: 280, fill: '#fff', sw: 18 }));

// 6) 캐릭터·자연
add('ghost', '유령', '캐릭터·자연', ['귀신', '할로윈', '귀여워'],
    patch(`M 250 900 V 420 A 250 250 0 0 1 750 420 V 900 L 665 820 L 582 900 L 500 820 L 418 900 L 335 820 Z`, C.white) + shine(380, 360, 44, 24) + face(500, 480, 1.3, { mouth: 'o' }));
add('alien', '외계인', '캐릭터·자연', ['우주', '초록', 'UFO'],
    line(380, 180, 300, 60, 16) + dot(300, 60, 24, C.mint) + line(620, 180, 700, 60, 16) + dot(700, 60, 24, C.mint)
    + patch(ellipse(500, 470, 270, 300), C.green) + shine(360, 320, 50, 26)
    + `<ellipse cx="400" cy="470" rx="70" ry="110" fill="${ink}" transform="rotate(20 400 470)"/><ellipse cx="600" cy="470" rx="70" ry="110" fill="${ink}" transform="rotate(-20 600 470)"/>`
    + dot(420, 430, 20, '#fff') + dot(620, 430, 20, '#fff') + stroke(`M 470 640 q 30 26 60 0`, 10));
add('robot', '로봇', '캐릭터·자연', ['기계', '삐빅', '귀여워'],
    line(500, 240, 500, 120, 16) + patch(circle(500, 100, 40), C.red)
    + patch(rrect(150, 440, 70, 160, 30), C.gray) + patch(rrect(780, 440, 70, 160, 30), C.gray)
    + patch(rrect(220, 240, 560, 560, 70), C.sky) + shine(320, 330, 50, 26)
    + `<rect x="330" y="400" width="90" height="90" rx="20" fill="${ink}"/><rect x="580" y="400" width="90" height="90" rx="20" fill="${ink}"/>` + dot(360, 425, 16, '#fff') + dot(610, 425, 16, '#fff')
    + `<rect x="360" y="580" width="280" height="80" rx="20" fill="${ink}"/>` + stroke(`M 420 580 V 660 M 500 580 V 660 M 580 580 V 660`, 10, C.sky));
add('planet', '행성', '캐릭터·자연', ['우주', '토성', '보라'],
    g(stroke(ellipse(500, 500, 440, 120), 60) + stroke(ellipse(500, 500, 440, 120), 30, C.yellow), 'rotate(-18 500 500)')
    + patch(circle(500, 500, 250), C.purple) + shine(400, 400, 50, 26)
    + g(stroke(`M 60 500 A 440 120 0 0 0 940 500`, 60) + stroke(`M 60 500 A 440 120 0 0 0 940 500`, 30, C.yellow), 'rotate(-18 500 500)') + face(500, 520, 1.1));
add('rocket', '로켓', '캐릭터·자연', ['우주', '발사', '모험'],
    patch(poly([[380, 700], [240, 860], [330, 860]]), C.red) + patch(poly([[620, 700], [760, 860], [670, 860]]), C.red)
    + patch(`M 500 90 C 660 230 700 520 650 760 H 350 C 300 520 340 230 500 90 Z`, C.white) + `<path d="M 500 90 C 580 160 630 260 650 360 H 350 C 370 260 420 160 500 90 Z" fill="${C.red}"/>`
    + patch(circle(500, 470, 80), C.sky) + shine(470, 440, 24, 14)
    + patch(`M 400 760 Q 500 980 600 760 Z`, C.orange) + `<path d="M 450 760 Q 500 880 550 760 Z" fill="${C.yellow}"/>`);
add('flower', '꽃', '캐릭터·자연', ['데이지', '봄', '핑크'],
    [0, 45, 90, 135, 180, 225, 270, 315].map(a => g(patch(ellipse(500, 240, 95, 200), C.pink), `rotate(${a} 500 500)`)).join('')
    + patch(circle(500, 500, 170), C.yellow) + shine(430, 440, 36, 20) + face(500, 520, 1));
add('cactus', '선인장', '캐릭터·자연', ['식물', '초록', '사막'],
    patch(`M 300 700 H 700 L 660 920 H 340 Z`, C.orange) + patch(rrect(280, 660, 440, 80, 30), C.orange)
    + union([rrect(400, 180, 200, 560, 100), rrect(220, 330, 100, 220, 50), rrect(680, 260, 100, 220, 50), rrect(220, 480, 240, 90, 45), rrect(540, 400, 240, 90, 45)], C.green, [0, 1, 2])
    + stroke(`M 440 300 l -20 -20 M 560 300 l 20 -20 M 450 520 l -22 -14 M 550 520 l 22 -14 M 460 640 l -20 -16 M 540 640 l 20 -16`, 8, ink, 'stroke-opacity=".5"') + face(500, 430, 1));
add('mushroom', '버섯', '캐릭터·자연', ['숲', '빨강', '귀여워'],
    patch(rrect(370, 480, 260, 380, 110), C.cream) + face(500, 660, 1)
    + patch(`M 130 540 A 370 330 0 0 1 870 540 Z`, C.red) + [[300, 400, 42], [500, 300, 50], [690, 420, 38], [420, 480, 26], [620, 500, 24]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.cream}"/>`).join(''));
add('clover', '네잎클로버', '캐릭터·자연', ['행운', '초록', '럭키'],
    stroke(`M 520 560 C 540 700 600 820 700 900`, 22, C.dgreen)
    + union([0, 90, 180, 270].map(a => heart(500, 320, 400)).map((d, i) => d), C.green, [])
        .replace(/<path d="([^"]+)" fill="#7ED957" stroke/g, (m, d) => m)  // (회전은 아래 g 로 처리)
    );
// 네잎클로버: 회전을 포함해 다시 정의(위 항목 교체)
D.splice(D.findIndex(x => x.key === 'clover'), 1);
add('clover', '네잎클로버', '캐릭터·자연', ['행운', '초록', '럭키'],
    stroke(`M 520 560 C 540 700 600 820 700 900`, 22, C.dgreen)
    + [0, 90, 180, 270].map(a => g(P(heart(500, 320, 400), C.green), `rotate(${a} 500 500)`)).join('')
    + [0, 90, 180, 270].map(a => g(`<path d="${heart(500, 320, 400)}" fill="${C.green}"/>`, `rotate(${a} 500 500)`)).join('')
    + [0, 90, 180, 270].map(a => g(stitch(`M 500 496 C 420 416 300 350 300 256 A 100 100 0 0 1 500 240 A 100 100 0 0 1 700 256 C 700 350 580 416 500 496`), `rotate(${a} 500 500)`)).join('')
    + face(500, 500, 0.9));
add('crown', '왕관', '캐릭터·자연', ['왕', '노랑', '최고'],
    patch(poly([[150, 760], [150, 330], [330, 520], [500, 220], [670, 520], [850, 330], [850, 760]]), C.yellow)
    + patch(circle(500, 220, 44), C.red) + patch(circle(150, 330, 36), C.sky) + patch(circle(850, 330, 36), C.sky)
    + patch(circle(500, 640, 50), C.red) + patch(circle(330, 650, 34), C.sky) + patch(circle(670, 650, 34), C.sky));
add('bow', '리본', '캐릭터·자연', ['리본', '핑크', '선물'],
    patch(poly([[500, 520], [360, 820], [460, 790]]), C.pink) + patch(poly([[500, 520], [640, 820], [540, 790]]), C.pink)
    + patch(`M 500 500 L 160 320 C 90 420 90 600 160 700 Z`, C.pink) + patch(`M 500 500 L 840 320 C 910 420 910 600 840 700 Z`, C.pink)
    + patch(rrect(420, 420, 160, 160, 60), C.red) + shine(250, 420, 40, 24) + shine(750, 420, 40, 24));
add('smile', '스마일', '캐릭터·자연', ['웃음', '노랑', '해피'],
    patch(circle(500, 500, 400), C.yellow) + shine(360, 340, 60, 32)
    + dot(390, 440, 34) + dot(610, 440, 34) + dot(402, 428, 12, '#fff') + dot(622, 428, 12, '#fff')
    + stroke(`M 330 600 q 170 150 340 0`, 22) + dot(280, 560, 36, C.blush) + dot(720, 560, 36, C.blush));

export const DESIGNS = D;
export const CATEGORIES = ['도형·기호', '동물', '음악', '음식', '글자', '캐릭터·자연'];
