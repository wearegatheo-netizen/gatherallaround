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
   - 작품 페이지 [공유 → 카카오톡] 카드를 탭해 작품 화면으로 들어가는지, [링크 복사]로 얻은 `https://gatherallaround.com/ww/<id>` 를 카톡에 붙여
     미리보기(제목·이미지)가 뜨는지 확인. 공유 링크는 **경로형**(`/wp/<id>`·`/ww/<id>`, Pages Function 이 사람은 302·크롤러는 OG HTML) — 예전 쿼리형도 미들웨어가 같은 규칙으로 받는다.
     외부에서 응답을 보려면 Actions 의 `wappen-share-diagnostics` 를 실제 id 로 수동 실행(카톡 인앱 UA 는 `/wp|ww/` 에서 `200` + `<base href="/wappen/">` + 그 작품 제목, 스크랩 UA 는 og:url·og:image 가 그 작품으로 나와야 정상).
     그래도 카톡 카드가 포털로만 가면 카카오 디벨로퍼스 [플랫폼 → Web 사이트 도메인]에 `https://gatherallaround.com` 이 정확히 등록돼 있는지 확인.

6. (선택) **라이브 갱신**: `supabase/migrations/20261007_wappen_realtime.sql` 을 SQL Editor 에서 실행하면 다른 사람이 올린 프로젝트·작품·반응이
   열려 있는 화면에 몇 초 안에 반영된다(Realtime 구독). 실행하지 않아도 탭으로 돌아오거나 25초마다 목록을 조용히 다시 읽어 갱신된다.

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
| 이름 중복 | 프로젝트 제목 전체 유일·작품 제목 프로젝트 안 유일(공백·대소문자 무시). 서버 409 `dup_title`; 선택 마이그레이션 `20261007_wappen_unique_titles.sql` 로 DB 유일 인덱스(기존 중복은 " (2)" 자동 정리) |
| 관리자 와펜 | 검색·분류 칩·체크박스 선택 → [선택 삭제], 분류 머리줄 [분류 전체 삭제] (`admin_items_delete`). 작품에 쓰인 와펜은 삭제 대신 숨김 |
| 공유 | 경로형 `/wp/<프로젝트>` / `/ww/<작품>`(`functions/wp|ww/[id].js` → `wappen/share-page.js`): 사람 UA 는 그 URL 에서 와펜 셸 200(`<base href="/wappen/">`, 앱이 해시로 치환), 크롤러 UA 는 OG HTML. 예전 쿼리형(`/?wp=`·`/wappen/?p=`)은 미들웨어가 사람 302 → `/wp|ww/`, 루트 index.html 맨 앞 스크립트는 정적 폴백 |
| 한도 | 프로젝트 20/일, 작품 100/일, 신고 20/일, 요청 10/일, 업로드 서명 200/일, 반응 600/일, 로그인 30/시간(IP). 버킷 8MB·PNG/JPEG/WebP |

## 3. 운영 작업

- **기본 와펜 세트(84개, 과일 18개 포함) 설치**: `#/admin` → 🧩 와펜 탭 맨 위 「기본 와펜 세트」 카드 → [N개 불러오기]. 세트가 늘어나면 카드에 미설치 개수만 다시 표시된다. 저장소 `wappen/seed/*.png`(직접 그린 원본, CC0)를
  가리키는 행만 DB 에 넣으므로 몇 초면 끝나고, 여러 번 눌러도 이미 있는 것은 건너뛴다. 새 그림은 `tools/wappen-seed/designs.mjs` 에 추가해 빌드(README 참고).

- **와펜 등록**: `#/admin` → 🧩 와펜 → [＋ 와펜 등록] (투명 배경 PNG, 긴 변 2000px 로 자동 축소). 카테고리·태그는 서랍 검색에 쓰인다.
- **와펜 요청 처리**: 📮 요청 탭 → [승인·등록] 은 "요청 승인 · 와펜 등록" 폼을 연다 — 이름이 채워지고 **요청자의 참고 이미지가 기본 선택**(PNG 로 변환·투명 유지)되므로
  그대로 [승인하고 등록] 하면 와펜이 등록되고 요청이 "추가됨"으로 바뀐다(요청자 화면에 표시). 다른 이미지(PNG·JPG·WebP)를 골라 바꿀 수도 있다. [보류] 는 사유를 요청자에게 표시.
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
