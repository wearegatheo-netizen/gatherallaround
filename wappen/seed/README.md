# 기본 와펜 세트

기본 세트는 **래스터 세트(자수 패치 30개)만** 입니다 (2026-10-07 운영자 요청으로 코드로 그린 벡터 84개는 목록·배포에서 제외).
- 벡터 세트(옵트인): `tools/wappen-seed/designs.mjs` 에서 **코드로 그린 원본 그림** (외부 아이콘·이모지·사진 사용 없음, CC0). 다시 쓰려면 `build.mjs` 를 돌리면 렌더·목록 포함까지 된다.
  DB 에 남은 이전 세트 행은 관리자 와펜 탭 [이전 세트 N개 삭제](`admin_seed_prune`: seed 경로지만 현재 목록에 없는 행, 작품에 쓰인 것은 숨김)로 정리.
- 래스터 세트(`manifest.js` 의 `kind: "raster"`, 키 `p-…`): `tools/wappen-seed/raster/` 의 시트 이미지(2026-10-07 운영자가 제공한 자수 패치 30개)를
  `raster.py` 가 자동으로 잘라낸 것(질감 기반 배경 제거, 원본 해상도 유지 ≈ 150~290px). 권리는 제공자에게 있으며 메타는 `raster.json`.
  래스터만 다시 자르려면(Playwright 불필요): `python3 -I tools/wappen-seed/finish.py --reuse wappen/seed [미리보기.png] --no-vector`. 새 시트는 `raster.json` 에 시트·격자·항목을 추가.

- 재생성: `NODE_PATH=<scratchpad>/node_modules node tools/wappen-seed/build.mjs --raw <임시폴더> --sheet <미리보기.png>`
  (Chromium 으로 SVG → 투명 PNG → `finish.py` 가 여백 자르기·256색 팔레트 최적화·`manifest.js` 생성)
- `manifest.js` 는 생성 파일 — 서버(`functions/wappen-api.js` 의 `admin_seed_items`)와 관리자 화면이 import 합니다. 직접 수정하지 말 것.
- 새 와펜 추가: `designs.mjs` 에 `add(key, 이름, 카테고리, 태그, svg)` 한 줄 → 빌드 → 커밋 → 관리자 [기본 와펜 세트 불러오기] (이미 설치된 것은 건너뜀).
- 입체 표현(과일): `vol(path, 색)` — 방사 그라데이션 채움 + 클립된 아래 그늘 + 하이라이트. 곡선 몸통은 `ribbon(베지어 4점, 폭 함수)`.
