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

- **파일 전체 Read 금지** (3500줄). `grep -n` 으로 라인 찾고 해당 부분만 Read.
- 큰 변경은 한 번의 Edit으로. 여러 작은 Edit 분리 X.
- 푸시 실패하면 원인부터 진단 (proxy vs PAT). 무작정 재시도 X.
