# 와펜 꾸미기 (/wappen/) 운영 런북

누구나 카카오 로그인 후 기본 이미지(프로젝트) 위에 와펜(PNG)을 붙여 작품을 만들고, 다운로드·공유·반응·랭킹을 이용하는 공개 서비스.
코드: `wappen/`(페이지) · `functions/wappen-api.js`(쓰기 API) · `functions/_middleware.js`(공유 OG) · `supabase/migrations/20261006_wappen.sql`(DB).

## 1. 최초 배포 순서 (SQL 먼저, 그다음 master 머지)

1. **Supabase SQL Editor** 에서 `supabase/migrations/20261006_wappen.sql` 전체를 1회 실행.
   - 테이블 8개(`wappen_users/sessions/projects/items/works/reactions/item_requests/reports`), 집계 트리거 2개, RPC `wappen_ranking`, RLS, 스토리지 버킷 `wappen`.
   - 운영 관리자(카카오 ID `4883868250`)가 `wappen_users` 에 `is_admin=true` 로 미리 등록됨.
   - `insert into storage.buckets …` 가 권한 오류로 거부되면 **Storage → New bucket** 으로 직접 생성:
     이름 `wappen`, Public ✅, File size limit `8 MB`, Allowed MIME `image/png, image/jpeg, image/webp`.
     그리고 SQL 의 `wappen_public_read` 정책 부분만 다시 실행.
2. **Cloudflare 환경변수**: 기존 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 를 그대로 쓴다(추가 설정 없음).
3. **카카오 개발자 콘솔** (기존 앱 `9627dd65…`):
   - 플랫폼 Web 사이트 도메인에 `https://gatherallaround.com` 이 이미 있으면 `/wappen/` 도 자동 포함.
   - 카카오 로그인 → 동의항목에서 **닉네임(profile_nickname)** 과 **프로필 사진(profile_image)** 이 "이용 중"인지 확인
     (사진이 꺼져 있으면 아바타 없이 이니셜로 표시됨 — 동작에는 지장 없음).
   - `*.pages.dev` 미리보기 도메인은 등록되어 있지 않으므로 **로그인은 운영 도메인에서만** 테스트 가능.
4. master 머지 → Cloudflare Pages 자동 배포.
5. 배포 후 확인:
   - `https://gatherallaround.com/wappen-api` (GET) → 모든 `*_테이블: true`, `wappen_ranking_rpc: true`, `wappen_버킷: true`, `버킷_공개: true`.
     Actions 의 `functions-diagnostics` 워크플로를 실행해도 같은 결과를 볼 수 있다.
   - `https://gatherallaround.com/wappen/` 접속 → 카카오 로그인 → `#/admin` 에서 와펜 PNG 등록 → 프로젝트 생성 → 꾸미기 → 저장 → 다운로드.
   - 작품 페이지 [공유 → 카카오톡] 카드를 탭해 작품 화면으로 들어가는지, [링크 복사]로 얻은 `https://gatherallaround.com/?ww=<id>` 를 카톡에 붙여
     미리보기(제목·이미지)가 뜨는지 확인. 공유 링크는 **루트+쿼리**(`?wp=`/`?ww=`)만 쓴다 — `/wappen/?p=` 같은 하위 경로 링크는 카톡에서 포털로 떨어졌다.

## 2. 구조 요약

| 구분 | 내용 |
|---|---|
| 읽기 | 브라우저 anon supabase-js → `wappen_projects/works/items`(RLS: `status='active'` 만) + RPC `wappen_ranking` |
| 쓰기 | 전부 `POST /wappen-api {action, session, …}` (service role). 우리 출처(Origin/Referer/Sec-Fetch-Site)가 아니면 403 |
| 인증 | `login {kakao_token}` 1회 kapi 검증 → `wappen_users` upsert → 세션 토큰(30일, DB 엔 sha256) → `localStorage.wappen_session` |
| 관리자 | 카카오 ID `4883868250` 백스톱 + `wappen_users.is_admin`. `#/admin` 에서 추가 관리자 지정 가능 |
| 업로드 | `upload_sign {kind, ext}` → 서명 URL(경로·권한은 서버가 결정: `base/<uid>/`, `thumbs/<uid>/`, `previews/<uid>/`, `requests/<uid>/`, `items/`(관리자)) → 브라우저가 Storage 로 PUT. 저장 액션에서 URL 접두 재검증 |
| 레이아웃 | `{v:1, items:[{id,x,y,w,r,fx}]}` — 비율 좌표(캔버스 폭·높이 대비), 배열 순서 = z. 서버가 범위·개수(≤200)·와펜 존재 검증 |
| 집계 | 트리거: `wappen_reactions` → `works.reaction_count/reaction_counts`, `wappen_works` → `projects.works_count` |
| 공유 | 루트 `/?wp=<프로젝트>` / `/?ww=<작품>`(카톡 검증 형태; 해시·하위 경로는 카톡에서 유실) → 루트 index.html 맨 앞 스크립트가 `/wappen/#/…` 로 넘김, 미들웨어가 루트·`/wappen/` 쿼리에 OG 주입 |
| 한도 | 프로젝트 20/일, 작품 100/일, 신고 20/일, 요청 10/일, 업로드 서명 200/일, 반응 600/일, 로그인 30/시간(IP). 버킷 8MB·PNG/JPEG/WebP |

## 3. 운영 작업

- **와펜 등록**: `#/admin` → 🧩 와펜 → [＋ 와펜 등록] (투명 배경 PNG, 긴 변 2000px 로 자동 축소). 카테고리·태그는 서랍 검색에 쓰인다.
- **와펜 요청 처리**: 📮 요청 탭 → [승인·등록] 은 등록 폼을 이름으로 프리필하고, 등록되면 요청에 자동 연결(요청자 화면에 "추가됨"). [보류] 는 사유를 요청자에게 표시.
- **신고 처리**: 🚩 신고 탭 → 대상 [숨기기] / [작성자 차단] / [처리 완료·기각]. 차단하면 세션이 끊기고 그 사용자의 작품·프로젝트가 숨김 처리된다(해제해도 자동 복구 안 됨 — 개별 공개 필요).
- **와펜 삭제**: 작품이 참조 중이면 자동으로 숨김 처리(작품 렌더링에서는 사라짐). 미사용이면 실제 삭제. 스토리지 객체는 남는다(용량 문제 시 Storage 에서 수동 정리).
- **프로젝트 삭제**: 타인 작품이 있으면 소유자는 삭제 불가(숨김만). 관리자는 삭제 가능(cascade).
- **인쇄 해상도**: 인쇄 프리셋은 300dpi 목표. 기기(특히 iOS)가 큰 캔버스를 못 만들면 200→150→100dpi 로 자동 하향하고 안내한다. A1·A2 300dpi 는 PC 권장.

## 4. 테스트

```bash
node tests/wappen-api-unit.mjs      # 서버 액션·권한·검증 (fetch 목)
node tests/middleware-unit.mjs      # OG 주입 (?news= 회귀 포함)
python3 -m http.server 8765 &       # 정적 서빙
NODE_PATH=<scratchpad>/node_modules node tests/ui-wappen.js          # Playwright: 홈→에디터→저장→작품→다운로드
VIEWPORT=390x844 DARK=1 SHOT_DIR=ui-shots NODE_PATH=… node tests/ui-wappen.js   # 모바일·다크 스크린샷
```

## 5. 알려진 제약·주의

- 카카오 JS SDK v1 팝업 로그인. 일부 인앱 브라우저는 리다이렉트로 돌아오므로 `sessionStorage.wappen_return` 마커로 복귀 후 자동 로그인한다.
- `wappen/presets.js` 는 브라우저와 Pages Function 이 **같은 파일**을 import 한다(esbuild 번들). Pages 빌드가 `../wappen/presets.js` 해석에 실패하면
  `functions/` 안에 사본을 두고 동일성 테스트를 추가할 것.
- 사용자 닉네임 변경 시 서버가 `wappen_projects.author_name`·`wappen_works.author_name` 복제 컬럼을 함께 갱신한다(뷰 join 없음).
- 반응 테이블은 anon 조회 불가(누가 무엇에 반응했는지 비공개). 화면은 `works.reaction_counts` + `my_reactions` 액션을 쓴다.
