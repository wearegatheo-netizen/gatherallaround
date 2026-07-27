#!/usr/bin/env python3
"""꾸불림체(BMKkubulimTTF.ttf)를 unicode-range 청크로 분할해 fonts/ 에 굽는다.

왜 나누나:
  원본 woff2는 약 1.2MB라 콜드 캐시에서 첫 화면이 폴백 글꼴로 그려졌다가
  뒤늦게 바뀐다(FOUT). 브라우저는 unicode-range에 속한 글자가 실제로
  그려질 때만 해당 청크를 받으므로, 첫 화면에 필요한 글자만 따로 떼면
  수십 KB로 즉시 렌더된다.

청크 구성:
  latin    — ASCII/기호. 로딩 화면 "Gather all around" 전부가 여기 해당.
  critical — 로딩 직후 보이는 꾸불림체 한글 라벨(포털 버튼 등).
  ui       — index.html에 정적으로 박힌 나머지 한글.
  rest     — 그 외 완성형 전체. 사용자 이름·게시글 제목 등 동적 텍스트용.

latin/critical만 <head>에서 preload한다. 청크를 다시 구우면 index.html의
@font-face unicode-range도 이 스크립트가 출력한 값으로 갱신할 것.

사용법:  python3 tools/build-fonts.py        (fonttools, brotli 필요)
"""
import os
import sys

from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'BMKkubulimTTF.ttf')
OUT_DIR = os.path.join(ROOT, 'fonts')
HTML = os.path.join(ROOT, 'index.html')
# unicode-range 덤프는 빌드 산출물이므로 공개 서빙되는 fonts/ 밖에 둔다.
RANGE_DIR = os.path.dirname(os.path.abspath(__file__))

# 로딩 화면이 걷힌 직후 화면에 뜨는 꾸불림체 라벨.
# 여기 빠진 글자는 ui/rest 청크로 밀려 잠깐 폴백으로 보이므로,
# 첫 화면 문구를 바꾸면 이 목록도 같이 갱신할 것.
CRITICAL_TEXT = (
    '게·어·드 커뮤니티'          # portal-btn-title
    '게더링'                     # portal-btn-title
    '고정 합주팀'                # portal-btn-title / bandHeaderName
    '공연 대관'                  # portal-btn-title
    '게더올어라운드 이용 시스템'   # portal-sub
    '게더링 멤버 전용 공간'       # landing-page
    '돌아가기'                   # portal-back-btn
)

LATIN_RANGES = [
    (0x0000, 0x00FF), (0x0131, 0x0131), (0x0152, 0x0153), (0x02B0, 0x02FF),
    (0x2000, 0x206F), (0x20A0, 0x20BF), (0x2100, 0x214F), (0x2190, 0x21FF),
    (0x2200, 0x22FF),
]


def to_ranges(codepoints):
    """정렬된 코드포인트 집합을 CSS unicode-range 문자열로 압축."""
    cps = sorted(codepoints)
    spans, start = [], cps[0]
    prev = start
    for c in cps[1:]:
        if c == prev + 1:
            prev = c
            continue
        spans.append((start, prev))
        start = prev = c
    spans.append((start, prev))
    return ','.join(
        f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in spans
    )


def main():
    if not os.path.exists(SRC):
        sys.exit(f'원본 폰트를 찾을 수 없음: {SRC}')

    cmap = set(TTFont(SRC, lazy=True).getBestCmap().keys())
    html = open(HTML, encoding='utf-8').read()

    latin = {c for c in cmap if any(a <= c <= b for a, b in LATIN_RANGES)}
    nonlatin = cmap - latin

    critical = {ord(c) for c in CRITICAL_TEXT} & nonlatin
    # 한글이 아닌 기호·자모(「」·ㄱ~ㅣ 등)는 수가 적으니 ui 청크에 묶는다.
    symbols = {c for c in nonlatin if not (0xAC00 <= c <= 0xD7A3)}
    ui = (({ord(c) for c in html} & nonlatin) | symbols) - critical
    rest = nonlatin - critical - ui

    os.makedirs(OUT_DIR, exist_ok=True)
    print(f'{"청크":<10}{"글자수":>8}{"woff2":>12}   unicode-range')
    print('-' * 78)
    for name, cps in (('latin', latin), ('critical', critical),
                      ('ui', ui), ('rest', rest)):
        out = os.path.join(OUT_DIR, f'BMKkubulim-{name}.woff2')
        subset.main([
            SRC,
            '--unicodes=' + ','.join(f'U+{c:04X}' for c in sorted(cps)),
            '--flavor=woff2', '--layout-features=*', '--no-hinting',
            '--desubroutinize',
            # 파생 폰트에도 저작권·라이선스 고지를 남긴다(name ID 0/7/13/14).
            '--name-IDs=*', '--name-legacy',
            f'--output-file={out}',
        ])
        rng = to_ranges(cps)
        size = os.path.getsize(out) / 1024
        print(f'{name:<10}{len(cps):>8}{size:>10.1f} KB   {rng[:40]}...')
        with open(os.path.join(RANGE_DIR, f'{name}.range.txt'), 'w') as f:
            f.write(rng)
    print(f'\nunicode-range 전문은 {RANGE_DIR}/<청크>.range.txt 참고 '
          '— index.html의 @font-face에 그대로 옮길 것')


if __name__ == '__main__':
    main()
