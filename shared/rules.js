// 공용 규칙(2026-11-10) — 브라우저(index.html 이 <script src="/shared/rules.js"> 로 먼저 읽음)와
// 서버 함수(functions/*.js 가 `import '../shared/rules.js'` 로 읽고 globalThis.GAA_RULES 사용)가 **같은 파일**을 쓴다.
// 종전엔 회차 수식·계좌 문구·시간표 슬롯이 여러 파일에 복사돼 있어 한 곳만 고치면 어긋났다.
// 클래식 스크립트로도, 모듈의 부수효과 import 로도 동작하도록 export 없이 전역에만 단다.
// supabase/functions/check-band-payments(Deno, 따로 배포)는 이 파일을 못 읽어 사본을 둔다 — tests/shared-rules-unit.mjs 가 같은지 검사.
(function (root) {
    const DAY_MS = 86400e3;
    // 예약 그리드 슬롯(시작 시각). 끝 시각 표시는 다음 슬롯 또는 '23:00'
    const TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
    const PERF_EXPIRE_MS = 4 * 60 * 60 * 1000; // 공간 대관 입금 대기 자동취소
    const BANK_NAME = '토스뱅크', BANK_ACCOUNT = '1000-2274-7678', BANK_HOLDER = '최경수';
    const BANK_LINE = `${BANK_NAME} ${BANK_ACCOUNT} ${BANK_HOLDER}`;

    // ── 고정 합주팀 회차: 시작일_n = start + 28n(+연장), 종료일_n = 시작일_{n+1} − 7, 입금일_n = 시작일_n − 14(n≥1) ──
    const BAND_CYCLE_DAYS = 28;
    const BAND_DUE_OFFSET = 14;
    const BAND_SKIP_DEADLINE_DAYS = 7;
    const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * DAY_MS).toISOString().slice(0, 10);
    // 1주 무료 연장: ext = 연장이 적용되는 건너뛴 날짜 목록. 그 날짜 뒤의 회차 경계가 날짜마다 7일씩 밀린다(밀린 뒤 새로 포함되는 날짜는 다시 센다)
    const bandExtOffset = (start, n, ext) => {
        if (!ext || !ext.length) return 0;
        let off = 0;
        for (let i = 0; i < 60; i++) {
            const s = addDays(start, BAND_CYCLE_DAYS * n + off);
            const cnt = ext.filter(d => d >= start && d < s).length * 7;
            if (cnt === off) break;
            off = cnt;
        }
        return off;
    };
    const bandCycleStart = (start, n, ext) => addDays(start, BAND_CYCLE_DAYS * n + bandExtOffset(start, n, ext));
    const bandCycleEnd = (start, n, ext) => addDays(bandCycleStart(start, n + 1, ext), -7);
    const bandCycleDue = (start, n, ext) => (n <= 0 ? start : addDays(bandCycleStart(start, n, ext), -BAND_DUE_OFFSET));
    // 다음 회차 번호: 오늘이 속한 회차 + 1 (시작일 전이면 0 = 등록 회차)
    const bandNextCycle = (start, today, ext) => {
        if (today < start) return 0;
        let n = 0; while (n < 400 && bandCycleStart(start, n + 1, ext) <= today) n++;
        return n + 1;
    };
    // 구형 납부 행(cycle_no 없음) 귀속: 회차 n 의 납부 창 = [시작일_n − 21, 시작일_n + 7)
    const bandInferCycle = (start, paidAt, ext) => {
        let n = 0; while (n < 400 && addDays(bandCycleStart(start, n + 1, ext), -21) <= paidAt) n++;
        return n;
    };
    // 건너뛰기권 보상 실효 판정: 선택값 또는 마감(건너뛰는 날 − 7일) 뒤 자동 1주 연장
    const bandSkipResolution = (s, today) => s.resolution || (today > addDays(s.skip_date, -BAND_SKIP_DEADLINE_DAYS) ? 'extend' : null);
    const bandExtDates = (skips, today) => (skips || []).filter(s => bandSkipResolution(s, today) === 'extend').map(s => s.skip_date).sort();

    root.GAA_RULES = Object.freeze({
        TIMES, PERF_EXPIRE_MS, BANK_NAME, BANK_ACCOUNT, BANK_HOLDER, BANK_LINE,
        BAND_CYCLE_DAYS, BAND_DUE_OFFSET, BAND_SKIP_DEADLINE_DAYS,
        addDays, bandExtOffset, bandCycleStart, bandCycleEnd, bandCycleDue, bandNextCycle, bandInferCycle, bandSkipResolution, bandExtDates,
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);
