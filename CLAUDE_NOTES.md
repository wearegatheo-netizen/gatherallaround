# Claude 작업 노트 (다음 세션 시작 전 먼저 확인)

## 1. Git push 관련 (가장 많이 토큰 낭비한 부분)

- **로컬 프록시(`http://localhost:35561/...`)는 read-only**. `git push`, MCP `push_files`, `create_or_update_file` 모두 실패함 (`403`, "Resource not accessible by integration").
- **푸시할 때는 항상 PAT를 remote URL에 끼워서 쓴다.** PAT는 사용자에게 매번 물어봐서 받기 (보안상 파일/저장소에 저장 금지).
  ```bash
  git remote set-url origin "https://${PAT}@github.com/wearegatheo-netizen/gatherallaround.git"
  git push -u origin <branch>
  # 끝나면 프록시로 복원
  git remote set-url origin "http://localhost:35561/wearegatheo-netizen/gatherallaround.git"
  ```
- **master 푸시 시 항상 `git pull origin master --rebase` 먼저** — 외부에서 master에 새 커밋이 들어와 있어 fast-forward 거부되는 경우 반복적으로 발생함.
- MCP `create_or_update_file`로 우회 시도했었는데 SHA가 필요하고 여러 단계 더 걸림. **그냥 PAT로 git push가 가장 빠름.**

## 2. 배포 절차 (반복 작업)

`claude/complete-index-modification-siszr` 브랜치 → master 배포 표준 절차:
```bash
git add ... && git commit -m "..."
PAT="github_pat_..."
git remote set-url origin "https://${PAT}@github.com/wearegatheo-netizen/gatherallaround.git"
git push -u origin claude/complete-index-modification-siszr
git checkout master && git pull origin master && git merge claude/complete-index-modification-siszr && git push origin master
git remote set-url origin "http://localhost:35561/wearegatheo-netizen/gatherallaround.git"
git checkout claude/complete-index-modification-siszr
```

## 3. 자주 놓쳤던 버그 패턴

- **타임존 버그**: `Date.toISOString().slice(0, 10)`은 UTC 기준이라 KST 토요일이 UTC 금요일로 바뀜.
  - **반드시 `Date.toLocaleDateString('en-CA')` 사용** (로컬 시간대 YYYY-MM-DD).
  - `getBlock()`은 `toLocaleDateString('en-CA')` 쓰는데 `renderMonth()`에서 `toISOString()` 쓰고 있어 월간 뷰에서 토요일 차단이 안 보였음. → 같은 로직을 다른 곳에서 쓸 때 날짜 포맷 일치 여부 먼저 확인.
- **CSS `position` 충돌**: `position: sticky`를 적용한 셀에 다시 `position: relative`를 덮어씀. sticky 자체가 positioned이라 `::after { position: absolute }`의 컨테이닝 블록이 됨. 중복 선언 금지.

## 4. 파일 구조 핵심

- `index.html` (~3500줄, 단일 파일에 CSS/JS 모두 embedded)
- `state.blocks`, `state.reservations`, `state.teams`, `state.bgmTracks`
- 시간 슬롯: `TIMES = ['10:00','11:00',...,'22:00']` (10시 시작)
- 관리자 서브탭: approval / members / notice / blocks / bgm
- 일간 탭은 제거됨 — 주간 뷰만 사용

## 5. Edit 실수 패턴 (중요)

- **`old_string`에 함수 선언 포함 시 반드시 `new_string`에도 포함할 것.**
  - 예: `old_string`이 `"...\n\n        function renderSongList() {"`로 끝나면, `new_string`에도 `function renderSongList() {`를 반드시 유지해야 함.
  - 이번에 `escapeHtml` 아래 새 함수를 삽입하면서 `function renderSongList() {` 선언부를 삭제 → 함수 본문이 스크립트 최상단에 노출 → `return` 문 SyntaxError → **JS 전체 실행 불가, 로그인 포함 모든 기능 먹통**.
- **Edit 후 함수 경계가 깨지지 않았는지 확인**: 삽입 지점 전후 `grep -n "^        function "` 으로 함수 목록 검증.
- **단일 파일에 3500줄+** — Edit `old_string`이 유일한지 항상 확인. `replace_all: false` 기본값이므로 중복 문자열이 있으면 첫 번째만 바뀜.

## 6. 토큰 절약 팁

- **파일 전체 Read 금지** (4800줄+). `grep -n` 으로 라인 찾고 해당 부분만 Read.
- 큰 변경은 한 번의 Edit으로. 여러 작은 Edit 분리 X.
- 푸시 실패하면 원인부터 진단 (proxy vs PAT). 무작정 재시도 X.

---

## 7. master 배포 절차 수정 (2026-05-12 확인)

로컬 브랜치가 origin/master보다 뒤처진 경우 `git merge` 방식은 non-fast-forward 에러 남.
**표준 절차: cherry-pick으로 새 커밋만 master에 얹기**

```bash
PAT="github_pat_..."
git fetch "https://x-access-token:${PAT}@github.com/wearegatheo-netizen/gatherallaround.git" master:refs/remotes/origin/master
git checkout -b temp-deploy origin/master
git cherry-pick <commit-hash>
git push "https://x-access-token:${PAT}@github.com/wearegatheo-netizen/gatherallaround.git" temp-deploy:master
git push "https://x-access-token:${PAT}@github.com/wearegatheo-netizen/gatherallaround.git" <feature-branch>:<feature-branch>  # 브랜치도 동기화
git checkout <feature-branch>
git branch -D temp-deploy
git fetch "https://x-access-token:${PAT}@github.com/wearegatheo-netizen/gatherallaround.git" <feature-branch>:refs/remotes/origin/<feature-branch>
```

## 8. Web Push 알림 구현 교훈 (2026-05-12)

### 설정 순서가 중요
1. Supabase SQL: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_subscription jsonb;`
2. Cloudflare 환경변수 설정 (VAPID 3개)
3. 재배포
4. **그 다음에** 관리자가 "알림 켜기" 클릭 — 순서 틀리면 VAPID 불일치 403 에러

### HKDF 버그 (핵심)
- `hkdfExtractExpand`에서 manual extract 후 WebCrypto HKDF를 다시 호출하면 **이중 추출** 발생
- WebCrypto HKDF는 항상 extract+expand 한 번에 수행함
- 수정: `crypto.subtle.importKey('raw', ikm, 'HKDF', ...)` + `deriveBits({name:'HKDF', salt, info, hash})` 한 번만 호출

### 403 "VAPID credentials do not match" 원인
- 구독 생성 시 사용한 VAPID public key ≠ 현재 서버의 VAPID key
- 해결: 알림 끄기 → 다시 알림 켜기 (새 구독 생성)

### 502 HTML 응답 원인
- Cloudflare Pages Function에서 예외가 try/catch 밖으로 빠져나가면 502 HTML 반환
- 해결: onRequest 최상단에 try/catch 전체 감싸기, 에러도 status 200 JSON으로 반환

### Supabase RLS 문제
- 일반 유저는 다른 유저의 `push_subscription` 컬럼 못 읽음
- 해결: `CREATE POLICY "allow_read_admin_push_subscription" ON profiles FOR SELECT USING (role IN ('총괄', '세션장'));`

### 알림이 안 보이는 경우
- `status 201` = 푸시 서비스 수락 (전달 완료 아님)
- SW `showNotification ok` 로그 = OS에 전달됨
- 배너가 안 뜨면 → OS 알림 설정, Do Not Disturb, 브라우저 알림 권한 확인
- iOS: Safari 탭에선 불가, **홈 화면 PWA로 추가 후 아이콘으로 열어야** 알림 수신 가능

### Realtime 채널 중복 구독
- `subscribeToPolls()` 여러 번 호출 시 "cannot add postgres_changes callbacks after subscribe()" 에러
- 해결: 전역 변수로 채널 참조 보관, 재구독 전 `supabaseClient.removeChannel()` 호출

### 디버그 순서 (알림 안 올 때)
1. GET `/push?key` → JSON 응답 확인 (함수 배포 여부)
2. 테스트 알림 → HTTP status, content-type, 응답 본문 확인
3. SW DevTools "Push" 버튼 → 배너 뜨는지 확인 (SW 동작 여부)
4. SW inspect 콘솔 → `[sw] push event received`, `showNotification ok` 로그 확인
5. OS 알림 설정 확인
