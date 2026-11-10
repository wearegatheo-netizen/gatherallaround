// 공용 규칙(shared/rules.js) — 사본이 다시 생기지 않았는지, 따로 배포되는 Edge Function 사본이 같은 결과를 내는지.  node tests/shared-rules-unit.mjs
import { readFileSync, readdirSync } from 'node:fs';
import '../shared/rules.js';
const R = globalThis.GAA_RULES;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('✗', name, extra === undefined ? '' : JSON.stringify(extra)); } };

ok('GAA_RULES 로드', R && R.TIMES.length === 15 && R.TIMES[0] === '08:00' && R.TIMES[14] === '22:00');
ok('회차 기본', R.bandCycleStart('2026-01-05', 2) === '2026-03-02' && R.bandCycleDue('2026-01-05', 1) === '2026-01-19' && R.bandCycleEnd('2026-01-05', 0) === '2026-01-26' && R.bandCycleDue('2026-01-05', 0) === '2026-01-05');
ok('연장 1주', R.bandCycleStart('2026-01-05', 1, ['2026-01-12']) === '2026-02-09' && R.bandCycleStart('2026-01-05', 1, ['2026-02-03']) === '2026-02-02');
ok('수정 불가(freeze)', Object.isFrozen(R));

// 1. 계좌·슬롯 사본 금지 — 문자열이 shared/rules.js 밖에 다시 생기면 실패
const files = ['index.html', ...readdirSync('js').filter(f => f.endsWith('.js')).map(f => 'js/' + f), ...readdirSync('functions').filter(f => f.endsWith('.js')).map(f => 'functions/' + f)];
for (const f of files) {
    const s = readFileSync(f, 'utf8');
    ok(`${f}: 계좌번호 사본 없음`, !s.includes(R.BANK_ACCOUNT));
    ok(`${f}: TIMES 배열 사본 없음`, !/TIMES\s*=\s*\[\s*'(08|10):00'/.test(s));
    ok(`${f}: 회차 일수 사본 없음`, !/BAND_CYCLE_DAYS\s*=\s*28/.test(s));
}
ok('index.html 이 rules.js 를 본 스크립트보다 먼저 읽음', (() => { const s = readFileSync('index.html', 'utf8'); const a = s.indexOf('/shared/rules.js'), b = s.indexOf('/js/app-1-'); return a > 0 && a < b; })());
for (const f of ['functions/send-reminders.js', 'functions/send-sms.js', 'functions/gatheo-api.js', 'functions/community-admin.js'])
    ok(`${f}: rules.js import`, readFileSync(f, 'utf8').includes("import '../shared/rules.js'"));

// 2. Edge Function(Deno, 따로 배포) 사본 = 같은 결과
{
    const ts = readFileSync('supabase/functions/check-band-payments/index.ts', 'utf8');
    const a = ts.indexOf('const CYCLE_DAYS'), b = ts.indexOf('type Team');
    const js = ts.slice(a, b)
        .replace(/^type [^\n]*\n/gm, '')
        .replace(/:\s*(string\[\]|Skip\[\]|string|number|Skip)(?=\s*[,)=])/g, '');
    const E = new Function(js + '; return { cycleStart, cycleDue, nextCycle, inferCycle, skipResolution, extDates, CYCLE_DAYS, DUE_OFFSET, SKIP_DEADLINE_DAYS };')();
    ok('Edge 상수', E.CYCLE_DAYS === R.BAND_CYCLE_DAYS && E.DUE_OFFSET === R.BAND_DUE_OFFSET && E.SKIP_DEADLINE_DAYS === R.BAND_SKIP_DEADLINE_DAYS);
    let diff = 0, n = 0;
    const exts = [[], ['2026-01-19'], ['2026-01-19', '2026-02-16', '2026-04-06'], ['2025-12-01'], ['2026-02-02']];
    for (const start of ['2026-01-05', '2026-02-27', '2025-11-30']) for (const ext of exts) {
        for (let k = 0; k <= 14; k++) {
            n += 2;
            if (E.cycleStart(start, k, ext) !== R.bandCycleStart(start, k, ext)) diff++;
            if (E.cycleDue(start, k, ext) !== R.bandCycleDue(start, k, ext)) diff++;
        }
        for (let d = -10; d < 420; d += 3) {
            const day = R.addDays(start, d); n += 2;
            if (E.nextCycle(start, day, ext) !== R.bandNextCycle(start, day, ext)) diff++;
            if (E.inferCycle(start, day, ext) !== R.bandInferCycle(start, day, ext)) diff++;
        }
    }
    ok(`Edge 회차 수식 일치 (${n}건 비교)`, diff === 0, diff);
    const skips = [{ profile_id: 't', skip_date: '2026-03-10', resolution: null }, { profile_id: 't', skip_date: '2026-03-20', resolution: 'substitute' }, { profile_id: 't', skip_date: '2026-02-01', resolution: 'extend' }, { profile_id: 'x', skip_date: '2026-01-01', resolution: 'extend' }];
    for (const today of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-30'])
        ok(`Edge 연장 날짜 일치 ${today}`, JSON.stringify(E.extDates(skips, 't', today)) === JSON.stringify(R.bandExtDates(skips.filter(s => s.profile_id === 't'), today)));
}
console.log(`${pass + fail}개 중 ${pass} 통과`);
process.exit(fail ? 1 : 0);
