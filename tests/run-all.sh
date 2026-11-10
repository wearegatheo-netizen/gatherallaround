#!/usr/bin/env bash
# 전체 테스트 실행 — 단위(node) + 화면(Playwright). CI(.github/workflows/tests.yml)와 로컬이 같은 스크립트를 쓴다.
#   bash tests/run-all.sh            전부
#   bash tests/run-all.sh unit       단위만
# 화면 테스트는 playwright 가 필요하다: NODE_PATH 로 위치를 주거나(로컬 scratchpad) 저장소에 npm i playwright(CI).
# 브라우저 경로는 PW_CHROMIUM(없으면 playwright 기본) — 이 개발 컨테이너는 /opt/pw-browsers/chromium.
set -u
cd "$(dirname "$0")/.."
[ -z "${PW_CHROMIUM:-}" ] && [ -x /opt/pw-browsers/chromium ] && export PW_CHROMIUM=/opt/pw-browsers/chromium
fail=0; summary=""
run() { # 이름, 명령…
  local name="$1"; shift
  local out; out=$("$@" 2>&1); local rc=$?
  local last; last=$(printf '%s\n' "$out" | grep -v '^$' | tail -1)
  if [ $rc -ne 0 ]; then fail=1; summary+="❌ $name — $last"$'\n'; printf '%s\n' "$out" | grep -E '❌|✗|Error|error' | head -20
  else summary+="✅ $name — $last"$'\n'; fi
}
for t in tests/*-unit.mjs; do run "$(basename "$t")" node "$t"; done
if [ "${1:-all}" != "unit" ]; then
  pids=()
  for port in 8765 8766; do
    if ! curl -s -o /dev/null "http://127.0.0.1:$port/index.html"; then python3 -m http.server "$port" >/dev/null 2>&1 & pids+=($!); fi
  done
  sleep 1.5
  for t in tests/ui-*.js; do run "$(basename "$t")" timeout 600 node "$t"; done
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
fi
printf '\n%s' "$summary"
[ $fail -eq 0 ] && echo "전체 통과" || echo "실패 있음"
exit $fail
