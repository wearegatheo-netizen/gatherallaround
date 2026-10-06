# 기본 와펜 세트

이 폴더의 PNG 는 전부 `tools/wappen-seed/designs.mjs` 에서 **코드로 그린 원본 그림**입니다 (외부 아이콘·이모지·사진 사용 없음).
저작권: CC0 — 누구나 자유롭게 사용·수정·배포할 수 있습니다. 한글 글자 와펜은 사이트와 같은 꾸불림체(우아한형제들, 상업적 사용 무료)로 렌더링했습니다.

- 재생성: `NODE_PATH=<scratchpad>/node_modules node tools/wappen-seed/build.mjs --raw <임시폴더> --sheet <미리보기.png>`
  (Chromium 으로 SVG → 투명 PNG → `finish.py` 가 여백 자르기·256색 팔레트 최적화·`manifest.js` 생성)
- `manifest.js` 는 생성 파일 — 서버(`functions/wappen-api.js` 의 `admin_seed_items`)와 관리자 화면이 import 합니다. 직접 수정하지 말 것.
- 새 와펜 추가: `designs.mjs` 에 `add(key, 이름, 카테고리, 태그, svg)` 한 줄 → 빌드 → 커밋 → 관리자 [기본 와펜 세트 불러오기] (이미 설치된 것은 건너뜀).
- 입체 표현(과일): `vol(path, 색)` — 방사 그라데이션 채움 + 클립된 아래 그늘 + 하이라이트. 곡선 몸통은 `ribbon(베지어 4점, 폭 함수)`.
