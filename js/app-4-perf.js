// 게더 올 어라운드 본 스크립트 4/8 (perf) — index.html 이 번호 순서대로 읽는 클래식 스크립트. 전역(함수·let/const)을 서로 공유한다.
// 고친 뒤에는 node tools/stamp-assets.mjs 로 index.html 의 ?v= 를 갱신할 것(tests/assets-unit.mjs 가 검사).

        // ===== 공간 대관 예약 =====
        // 공간 소개 사진 목록. Git 저장소 루트에 이미지 파일을 올린 뒤 아래 배열에
        // raw URL 을 추가하면 "공간 소개"에 표시됨. 예:
        //   'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/새파일명.jpg',
        const PERF_SPACE_PHOTOS = [
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio1.jpg',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio2.jpg',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio3.jpg',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio4.jpg',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio5.jpg',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio6.jpg',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio7.png',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio8.png',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio9.jpg',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio10.png',
            'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/studio11.jpg',
        ];
        const PERF_SPACE_DESC_DEFAULT = `안녕하세요.\n\n신촌역 5분 거리 프리미엄 밴드스튜디오\n게더 올 어라운드(Gather all around)입니다 :-)\n\n위치  |\n서울 서대문구 연세로5나길 33 지하 1층\n\n구비 장비  |\n마이크: Sennheiser e845s (2EA)\n키보드: Yamaha S90\n드럼: Mapex Mars + Yamaha Recording Custom Aluminum 6.5\n믹서: Behringer XR-18\n스피커: Yamaha DBR 15 (2EA)\n앰프: Blackstar Soloist 60 / Fender Champion 100 / Fender Rumble 500\n\n편의시설  |\n캠핑용 테이블 (2EA) 및 의자 (15EA)\n빔스크린 (110인치)\n싱크대 / 내부 화장실\n다양한 보드게임\n\n리허설·소규모공연·쇼케이스·파티 촬영 등 다양한 용도로 대관 가능합니다 🙌`;
        const PERF_HOW_FOUND_OPTS = ['인스타그램', '유튜브', '지인 추천', '네이버/구글 검색', '직접 방문'];

        let _perfState = {
            calView: 'month',  // 'week' | 'month'
            viewDate: null,    // 현재 보고 있는 날짜 (week pivot)
            selectedDate: null,
            conflicts: [],     // { start_time, end_time }[] for selected date
            rangeConflicts: {},// { 'YYYY-MM-DD': [{start_time,end_time},...] } for visible range
            blocks: [],        // time_blocks raw rows
            startSlot: null,   // index in TIMES
            endSlot: null,     // index in TIMES (inclusive last slot selected)
            headcount: 5,
            step: 1,
            howFound: '',
            howFoundOther: '',
            audienceTbd: false, // 관람객 인원 미정 — 공연진 인원으로만 우선 예약, 당일 정산
            privacyAgree: false, // [필수] 개인정보 수집·이용 동의
        };

        // ── 공용 시간표 달력 컨텍스트 ─────────────────────────────────────────
        // 공간 대관 페이지와 커뮤니티 모임 등록 폼이 같은 달력 렌더러(월간 상태·주간 슬롯)를 쓴다.
        // state: {calView, viewDate, selectedDate, startSlot, endSlot, rangeConflicts, blocks}
        // ids: 컨테이너·라벨·월간/주간 토글 버튼 id, minSlots: 최소 선택 슬롯 수, onChange: 선택 변경 콜백
        let _calCtx = null;
        const _cs = () => (_calCtx ? _calCtx.state : _perfState);
        function _perfCalCtx() {
            return { state: _perfState, minSlots: 3, onChange: _perfCalOnChange,
                ids: { container: 'perfCalContainer', label: 'perfCalLabel', monthBtn: 'perfCalMonthBtn', weekBtn: 'perfCalWeekBtn' } };
        }
        // 대관 페이지: 범위 선택이 완성되면 인원·다음 단계 섹션과 요금 표시
        function _perfCalOnChange() {
            const s = _perfState;
            const done = s.startSlot !== null && s.endSlot !== null;
            const phs = document.getElementById('perfHeadcountSection');
            const wasHidden = !!(phs && phs.style.display === 'none');
            if (phs) phs.style.display = done ? 'block' : 'none';
            if (done && wasHidden && phs && phs.scrollIntoView) setTimeout(() => phs.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); // 범위를 막 완성했을 때 인원 칸이 고정 바 뒤에 숨지 않게
            const ps1 = document.getElementById('perfStep1Next'); if (ps1) ps1.style.display = done ? 'flex' : 'none'; // 고정 바(.cm-sticky)는 flex
            const pad = document.getElementById('perfStep1Pad'); if (pad) pad.style.display = done ? 'block' : 'none';
            if (done) renderPerfFee();
        }
        const _calMin = () => (_calCtx && _calCtx.minSlots) || 3;
        const _calIds = () => (_calCtx ? _calCtx.ids : _perfCalCtx().ids);
        const _calChanged = () => { if (_calCtx && _calCtx.onChange) _calCtx.onChange(); };

        async function loadPerfBlocks() {
            if (!supabaseClient) return;
            const { data } = await supabaseClient.from('time_blocks').select('*');
            _cs().blocks = data || [];
        }

        function perfBlocksForDate(dateStr) {
            const date = new Date(dateStr + 'T00:00:00');
            const dow = date.getDay();
            return (_cs().blocks || []).filter(b => {
                if (b.day_of_week !== dow) return false;
                if (b.start_date && dateStr < b.start_date) return false;
                if (b.end_date && dateStr > b.end_date) return false;
                if (_blockSkipped(b, dateStr)) return false;
                return true;
            });
        }

        async function loadPerfRangeConflicts(startDate, endDate) {
            if (!supabaseClient) return;
            if (!_cs().blocks.length) await loadPerfBlocks();
            const [resResult, pbResult] = await Promise.all([
                supabaseClient.from('reservations').select('res_date,start_time,end_time')
                    .gte('res_date', startDate).lte('res_date', endDate)
                    .not('status','in','("rejected","cancelled")'),
                supabaseClient.from('performance_bookings').select('date,start_time,end_time,status,created_at')
                    .gte('date', startDate).lte('date', endDate)
                    .not('status','in','("rejected","cancelled","expired")')
            ]);
            const map = {};
            (resResult.data || []).forEach(r => {
                if (!map[r.res_date]) map[r.res_date] = [];
                map[r.res_date].push({ start_time: r.start_time, end_time: r.end_time });
            });
            // 4시간 만료된 대기 건은 sweep 전이라도 자리 차지 안 함 (lazy 자동취소)
            (pbResult.data || []).filter(b => !_pbExpired(b)).forEach(b => {
                if (!map[b.date]) map[b.date] = [];
                map[b.date].push({ start_time: b.start_time, end_time: b.end_time });
            });
            _cs().rangeConflicts = map;
        }

        // 커뮤니티 모임 등록 달력(allowBlocked): 예약·대관은 막고, 게더링 차단(time_blocks)은 '요청' 칸으로 고를 수 있다 — 운영진 수락 후 모임 공개
        const _calAllowBlocked = () => !!(_calCtx && _calCtx.allowBlocked);
        function getHardConflicts(dateStr) { return _cs().rangeConflicts[dateStr] || []; } // 예약·대관(확정/대기)만
        function getDateConflicts(dateStr) {
            const base = _cs().rangeConflicts[dateStr] || [];
            const blocks = perfBlocksForDate(dateStr).map(b => ({ start_time: b.start_time, end_time: b.end_time }));
            return [...base, ...blocks];
        }

        function dateHardStatus(dateStr) { return _slotStatus(getHardConflicts(dateStr)); }
        function dateConflictStatus(dateStr) { return _slotStatus(getDateConflicts(dateStr)); }
        function _slotStatus(list) {
            if (!list.length) return 'free';
            const occupied = new Set();
            for (const c of list) {
                const s = TIMES.indexOf(c.start_time);
                const e = TIMES.indexOf(c.end_time);
                for (let i = s; i <= e; i++) occupied.add(i);
            }
            if (occupied.size >= TIMES.length) return 'full';
            return 'partial';
        }

        function showPerformanceBookingSection() {
            _pushNav('perf');
            showSectionLoadingFromPortal(); // 포털(사진·타일)에서 들어올 때만
            document.body.classList.add('portal-view');
            document.body.classList.add('fullwidth-view');
            _hideAllScreens();
            document.getElementById('performance-booking-page').classList.remove('hidden');
            const now = new Date();
            _perfState = { calView: 'month', viewDate: now, selectedDate: null, conflicts: [], rangeConflicts: {}, blocks: [], startSlot: null, endSlot: null, headcount: 5, step: 1, howFound: '', howFoundOther: '', audienceTbd: false, privacyAgree: false };
            _calCtx = _perfCalCtx();
            renderPerfStep1();
        }

        // ── 공간 사진 라이트박스(2026-10-14): PERF_SPACE_PHOTOS 원본을 화면에 꽉 차게, ‹ › 버튼·스와이프·←→·Esc·배경 클릭으로 조작 ──
        let _perfPhotoIdx = 0;
        function perfPhotoOpen(i) {
            const list = PERF_SPACE_PHOTOS || []; if (!list.length) return;
            _perfPhotoIdx = ((i || 0) % list.length + list.length) % list.length;
            let box = document.getElementById('perfPhotoBox');
            if (!box) {
                box = document.createElement('div'); box.id = 'perfPhotoBox'; box.className = 'perf-lb'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '공간 사진 크게 보기');
                box.innerHTML = `<button type="button" class="perf-lb-x" aria-label="닫기" onclick="perfPhotoClose()">✕</button>
                    <button type="button" class="perf-lb-nav prev" aria-label="이전 사진" onclick="event.stopPropagation();perfPhotoStep(-1)">‹</button>
                    <img class="perf-lb-img" alt="" onclick="event.stopPropagation()">
                    <button type="button" class="perf-lb-nav next" aria-label="다음 사진" onclick="event.stopPropagation();perfPhotoStep(1)">›</button>
                    <div class="perf-lb-cnt"></div>`;
                box.addEventListener('click', e => { if (e.target === box) perfPhotoClose(); });
                let sx = null, sy = null;
                box.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
                box.addEventListener('touchend', e => { if (sx === null) return; const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
                    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) perfPhotoStep(dx < 0 ? 1 : -1); else if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.5) perfPhotoClose(); }, { passive: true });
                document.body.appendChild(box);
            }
            document.addEventListener('keydown', _perfPhotoKey);
            document.body.classList.add('perf-lb-open');
            requestAnimationFrame(() => box.classList.add('on'));
            _perfPhotoShow();
            box.querySelector('.perf-lb-x').focus();
        }
        function _perfPhotoShow() {
            const box = document.getElementById('perfPhotoBox'); if (!box) return;
            const list = PERF_SPACE_PHOTOS, img = box.querySelector('.perf-lb-img');
            img.src = list[_perfPhotoIdx]; img.alt = `공간 사진 ${_perfPhotoIdx + 1}`;
            box.querySelector('.perf-lb-cnt').textContent = `${_perfPhotoIdx + 1} / ${list.length}`;
            box.querySelectorAll('.perf-lb-nav').forEach(b => b.style.display = list.length > 1 ? '' : 'none');
            const pre = new Image(); pre.src = list[(_perfPhotoIdx + 1) % list.length]; // 다음 장 미리 받기
        }
        function perfPhotoStep(d) { const n = PERF_SPACE_PHOTOS.length; if (!n) return; _perfPhotoIdx = (_perfPhotoIdx + d + n) % n; _perfPhotoShow(); }
        function perfPhotoClose() {
            const box = document.getElementById('perfPhotoBox'); if (!box) return;
            document.removeEventListener('keydown', _perfPhotoKey);
            document.body.classList.remove('perf-lb-open');
            box.classList.remove('on'); setTimeout(() => box.remove(), 180);
        }
        function _perfPhotoKey(e) {
            if (e.key === 'Escape') perfPhotoClose();
            else if (e.key === 'ArrowLeft') perfPhotoStep(-1);
            else if (e.key === 'ArrowRight') perfPhotoStep(1);
        }

        // 단계 표시(2026-10-16): 1 날짜·시간 → 2 정보 입력 → 3 완료 — 예약 퍼널이라 어디쯤인지 보여준다(조회 화면엔 없음)
        function _perfStepsHTML(cur) {
            const names = ['날짜·시간', '정보 입력', '완료'];
            return `<div class="sx-steps">${names.map((n, i) => { const k = i + 1; const cls = k < cur ? 'done' : (k === cur ? 'on' : ''); return `${i ? '<em></em>' : ''}<span class="${cls}"><i>${k < cur ? '✓' : k}</i>${n}</span>`; }).join('')}</div>`;
        }
        function _perfShortDate(ymd) { // '2026-10-23' → '10/23(금)'
            const d = new Date(String(ymd) + 'T00:00:00'); if (isNaN(d)) return String(ymd || '');
            return `${d.getMonth() + 1}/${d.getDate()}(${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]})`;
        }
        function renderPerfStep1() {
            const container = document.getElementById('perf-step-container');
            // 공간 소개글은 코드에 하드코딩(PERF_SPACE_DESC_DEFAULT). 수정 필요 시 그 상수를 변경.
            const savedDesc = PERF_SPACE_DESC_DEFAULT;
            // 사진을 누르면 전체 화면 라이트박스(perfPhotoOpen) — 좌우 넘김·스와이프·키보드
            const photos = PERF_SPACE_PHOTOS.map((u, i) => `<img src="${u}" alt="공간 사진 ${i + 1}" role="button" tabindex="0" onclick="perfPhotoOpen(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();perfPhotoOpen(${i})}" onerror="this.style.display='none'">`).join('');
            // 2026-10-16: 달력은 카드(.gt-card) + 알약 [월간|주간](게더링 예약 탭과 동일, id 는 _perfCalCtx 그대로) + ‹ › 원형 버튼, 인원은 카드,
            //    공간 소개 카드 → 요금 띠(.cm-stats) → 유의사항·환불 규정 접이식, 범위를 고르면 아래 고정 바(선택 요약 + [예약 신청하기]) 가 뜬다(_perfCalOnChange)
            const picked = _cs().startSlot !== null && _cs().endSlot !== null;
            container.innerHTML = `
                ${_perfStepsHTML(1)}
                <div class="perf-layout">
                    <div class="perf-col-cal">
                        <div class="gt-card">
                            <div class="perf-cal-head">
                                <div class="gt-seg"><button type="button" id="perfCalMonthBtn" class="tab ${_cs().calView==='month'?'active':''}" onclick="setPerfCalView('month')">월간</button><button type="button" id="perfCalWeekBtn" class="tab ${_cs().calView==='week'?'active':''}" onclick="setPerfCalView('week')">주간</button></div>
                                <div class="perf-cal-nav"><button type="button" onclick="perfCalPrev()" aria-label="이전">‹</button><span id="perfCalLabel"></span><button type="button" onclick="perfCalNext()" aria-label="다음">›</button></div>
                            </div>
                            <div id="perfCalContainer"></div>
                        </div>
                        <div class="gt-card" id="perfHeadcountSection" style="display:${picked?'block':'none'}">
                            <div class="perf-section-title">인원수</div>
                            <div style="display:flex;align-items:center;gap:12px">
                                <input type="number" id="perfHeadcount" min="1" max="${PERF_MAX_HEADCOUNT}" value="${_cs().headcount}"
                                    oninput="let v=parseInt(this.value)||1; if(v>PERF_MAX_HEADCOUNT){v=PERF_MAX_HEADCOUNT; this.value=String(PERF_MAX_HEADCOUNT);} _cs().headcount=Math.max(1,Math.min(PERF_MAX_HEADCOUNT,v)); renderPerfFee()"
                                    style="width:80px;height:40px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:8px;font-size:0.92rem;font-family:inherit;outline:none">
                                <span style="font-size:0.85rem;color:var(--wds-gray-600)">명</span>
                            </div>
                            <div style="font-size:0.78rem;color:var(--wds-gray-500);margin-top:6px;line-height:1.5">관람객 수가 아직 미정이면 우선 <strong>공연진 인원만</strong> 입력하세요. 다음 단계에서 체크할 수 있습니다.</div>
                            <div id="perfFeeSummary"></div>
                        </div>
                    </div>
                    <div class="perf-col-info">
                        <div class="gt-card">
                            <div class="perf-section-title">공간 소개</div>
                            <div class="perf-photo-gallery">${photos}</div>
                            <div class="perf-desc-text" id="perfDescText" style="margin-top:12px">${escapeHtml(savedDesc)}</div>
                        </div>
                        <div class="gt-card">
                            <div class="perf-section-title">요금 안내</div>
                            <div class="cm-stats sx-rate">
                                <div><small>평일 (월~금)</small><b>25,000원</b><small>시간당</small></div>
                                <div><small>주말 (토·일)</small><b>40,000원</b><small>시간당</small></div>
                                <div><small>최소 예약</small><b>3시간</b><small>부터</small></div>
                            </div>
                            <div class="sx-note">👥 5인 기준 · 5인 초과 시 1인당 +5,000원 (예약당 1회)</div>
                        </div>
                        <details class="sx-acc"><summary>유의사항<small>엔지니어 비상주 · 장비 안내</small></summary>
                            <div class="perf-price-table">
                                👥 관람객 수가 미정이면 공연진 인원으로만 우선 예약하고, 당일 최종 인원을 산정해 초과 인원만큼 추가 결제하시면 됩니다.<br>
                                🎚️ 별도의 엔지니어가 상주하지 않습니다.<br>
                                📖 예약 완료 시 장비 사용법을 따로 안내해 드립니다.
                            </div>
                        </details>
                        <details class="sx-acc"><summary>환불 규정<small>7일 전 전액 · 3일 전 50%</small></summary>
                            <div class="perf-price-table">
                                💰 이용일 7일 전까지 취소: 전액 환불<br>
                                💰 이용일 3일 전까지 취소: 50% 환불<br>
                                💰 이용일 2일 전 ~ 당일 취소: 환불 불가<br>
                                📞 취소·변경 문의: 010-5109-1042
                            </div>
                        </details>
                    </div>
                </div>
                <div class="cm-sticky-pad" id="perfStep1Pad" style="display:${picked?'block':'none'}"></div>
                <div class="cm-sticky" id="perfStep1Next" style="display:${picked?'flex':'none'}"><div class="pr" id="perfStickyFee"><small>날짜·시간을 선택하세요</small><b>-</b></div><button type="button" class="gaa-btn gaa-btn-primary" onclick="goPerfStep2()">예약 신청하기 →</button></div>`;
            renderPerfCal();
            if (_cs().startSlot !== null && _cs().endSlot !== null) renderPerfFee();
        }

        function setPerfCalView(view) {
            _cs().calView = view;
            const ids = _calIds();
            document.getElementById(ids.monthBtn)?.classList.toggle('active', view === 'month');
            document.getElementById(ids.weekBtn)?.classList.toggle('active', view === 'week');
            renderPerfCal();
        }

        function perfCalPrev() {
            const d = new Date(_cs().viewDate);
            if (_cs().calView === 'month') d.setMonth(d.getMonth() - 1);
            else d.setDate(d.getDate() - 7);
            _cs().viewDate = d; renderPerfCal();
        }
        function perfCalNext() {
            const d = new Date(_cs().viewDate);
            if (_cs().calView === 'month') d.setMonth(d.getMonth() + 1);
            else d.setDate(d.getDate() + 7);
            _cs().viewDate = d; renderPerfCal();
        }

        async function renderPerfCal() {
            const container = document.getElementById(_calIds().container);
            const label = document.getElementById(_calIds().label);
            if (!container) return;
            await loadPerfBlocks();
            if (_cs().calView === 'month') {
                const d = _cs().viewDate;
                if (label) label.textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
                await renderPerfMonth(container);
            } else {
                const base = new Date(_cs().viewDate);
                base.setDate(base.getDate() - base.getDay());
                const end = new Date(base); end.setDate(base.getDate() + 6);
                if (label) label.textContent = `${base.getMonth()+1}/${base.getDate()} ~ ${end.getMonth()+1}/${end.getDate()}`;
                await renderPerfWeek(container);
            }
        }

        async function renderPerfMonth(container) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--wds-gray-500);font-size:0.85rem">불러오는 중…</div>';
            const d = _cs().viewDate;
            const y = d.getFullYear(), m = d.getMonth();
            const firstDay = new Date(y, m, 1).getDay();
            const lastDate = new Date(y, m+1, 0).getDate();
            const monthStart = new Date(y, m, 1).toLocaleDateString('en-CA');
            const monthEnd = new Date(y, m, lastDate).toLocaleDateString('en-CA');
            await loadPerfRangeConflicts(monthStart, monthEnd);
            const today = new Date(); today.setHours(0,0,0,0);
            container.innerHTML = '';
            const grid = document.createElement('div'); grid.className = 'calendar-grid';
            ['일','월','화','수','목','금','토'].forEach(h => {
                const el = document.createElement('div'); el.className = 'calendar-day-header'; el.textContent = h; grid.appendChild(el);
            });
            for (let i = 0; i < firstDay; i++) grid.appendChild(Object.assign(document.createElement('div'), { className: 'calendar-day empty' }));
            for (let i = 1; i <= lastDate; i++) {
                const date = new Date(y, m, i);
                const dateStr = date.toLocaleDateString('en-CA');
                const isPast = date < today;
                const isToday = date.getTime() === today.getTime();
                const isSelected = _cs().selectedDate === dateStr;
                const cs = isPast ? '' : dateConflictStatus(dateStr);
                const day = document.createElement('div'); day.className = 'calendar-day';
                if (isToday) day.classList.add('today');
                if (isSelected) day.classList.add('selected');
                if (isPast) { day.style.opacity = '0.4'; day.style.cursor = 'not-allowed'; }
                const numEl = document.createElement('div'); numEl.className = 'cal-day-num'; numEl.textContent = i;
                day.appendChild(numEl);
                if (!isPast) {
                    const info = document.createElement('div'); info.className = 'cal-day-info';
                    const conflicts = getDateConflicts(dateStr)
                        .slice()
                        .sort((a,b) => TIMES.indexOf(a.start_time) - TIMES.indexOf(b.start_time));
                    if (cs === 'full') {
                        info.innerHTML = `<span style="color:var(--wds-gray-500)">전체 예약</span>`;
                    } else if (cs === 'partial') {
                        const display = conflicts.slice(0, 3);
                        display.forEach(c => {
                            const sh = parseInt(c.start_time.split(':')[0]);
                            const endStr = TIMES[TIMES.indexOf(c.end_time) + 1] || '23:00';
                            const eh = parseInt(endStr.split(':')[0]);
                            info.innerHTML += `<span style="color:#e07b00"><i class="cal-ri">⏱</i>${sh}-${eh}<i class="cal-ru">시</i></span>`;
                        });
                        if (conflicts.length > 3) {
                            info.innerHTML += `<span style="color:var(--wds-gray-500)">+${conflicts.length - 3}<i class="cal-ru">건</i></span>`;
                        }
                    }
                    day.appendChild(info);
                }
                const clickable = !isPast && (cs !== 'full' || (_calAllowBlocked() && dateHardStatus(dateStr) !== 'full'));
                if (clickable) {
                    day.style.cursor = 'pointer';
                    day.onclick = () => selectPerfDate(dateStr);
                } else if (!isPast) {
                    day.style.cursor = 'not-allowed';
                }
                grid.appendChild(day);
            }
            container.appendChild(grid);
            const legend = document.createElement('div');
            legend.style.cssText = 'font-size:0.72rem;color:var(--wds-gray-500);margin-top:8px';
            legend.innerHTML = '· 날짜를 선택하면 시간 슬롯이 표시됩니다' + (_calAllowBlocked() ? '<br>· 게더링이 막아 둔 시간도 고를 수 있어요 — 운영진이 수락하면 모임이 공개됩니다' : '');
            container.appendChild(legend);
            if (_cs().selectedDate) renderPerfWeekTimePicker(container);
        }

        async function renderPerfWeek(container) {
            const prevWc = container.querySelector('.weekly-container');
            const prevScroll = prevWc ? { left: prevWc.scrollLeft, top: prevWc.scrollTop } : null;
            const base = new Date(_cs().viewDate);
            base.setDate(base.getDate() - base.getDay());
            const weekStart = base.toLocaleDateString('en-CA');
            const weekEnd = new Date(base); weekEnd.setDate(base.getDate() + 6);
            if (!prevWc) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--wds-gray-500);font-size:0.85rem">불러오는 중…</div>';
            await loadPerfRangeConflicts(weekStart, weekEnd.toLocaleDateString('en-CA'));
            container.innerHTML = '';
            const wrap = document.createElement('div'); wrap.className = 'weekly-container';
            const grid = document.createElement('div'); grid.className = 'weekly-grid';
            grid.appendChild(Object.assign(document.createElement('div'), { className: 'weekly-cell weekly-header-cell' }));
            const today = new Date(); today.setHours(0,0,0,0);
            const days = ['일','월','화','수','목','금','토'];
            for (let i = 0; i < 7; i++) {
                const d = new Date(base); d.setDate(base.getDate() + i);
                const h = document.createElement('div'); h.className = 'weekly-cell weekly-header-cell';
                if (i === 0) h.classList.add('week-sun');
                if (i === 6) h.classList.add('week-sat');
                if (d.getTime() === today.getTime()) h.classList.add('week-today');
                h.innerHTML = `<div style="font-size:0.7rem;opacity:0.75">${days[d.getDay()]}</div><div>${d.getDate()}</div>`;
                grid.appendChild(h);
            }
            TIMES.forEach((time, idx) => {
                const endTime = TIMES[idx+1] || '23:00';
                const tc = document.createElement('div');
                tc.className = 'weekly-cell weekly-time-cell';
                tc.style.lineHeight = '1.15';
                tc.innerHTML = `<div style="font-weight:600;font-size:0.82rem">${time}</div><div style="font-size:0.64rem;color:var(--wds-gray-500)">~${endTime}</div>`;
                grid.appendChild(tc);
                for (let i = 0; i < 7; i++) {
                    const d = new Date(base); d.setDate(base.getDate() + i);
                    const dateStr = d.toLocaleDateString('en-CA');
                    const s = document.createElement('div'); s.className = 'weekly-cell weekly-slot';
                    if (i === 0) s.classList.add('week-sun');
                    if (i === 6) s.classList.add('week-sat');
                    if (d.getTime() === today.getTime()) s.classList.add('week-today');
                    const isPast = d < today;
                    const inSlot = c => { const cs = TIMES.indexOf(c.start_time), ce = TIMES.indexOf(c.end_time); return idx >= cs && idx <= ce; };
                    const allowBlocked = _calAllowBlocked();
                    const conflicted = (allowBlocked ? getHardConflicts(dateStr) : getDateConflicts(dateStr)).some(inSlot);
                    const softBlock = allowBlocked && !conflicted && perfBlocksForDate(dateStr).some(inSlot); // 게더링 차단 — 고를 수 있지만 운영진 수락 필요
                    if (isPast) {
                        s.style.cursor = 'not-allowed'; s.style.opacity = '0.4';
                    } else if (conflicted) {
                        s.classList.add('slot-occupied');
                        s.style.cursor = 'not-allowed';
                        s.style.fontSize = '0.7rem';
                        s.style.color = 'var(--wds-gray-500)';
                        s.textContent = '예약불가';
                    } else {
                        s.style.cursor = 'pointer';
                        if (softBlock) { s.classList.add('slot-request'); s.textContent = '요청'; s.title = '게더링이 막아 둔 시간 — 선택하면 운영진 수락 후 모임이 공개됩니다'; }
                        if (_cs().selectedDate === dateStr && _cs().startSlot !== null) {
                            const sStart = _cs().startSlot, sEnd = _cs().endSlot;
                            if (sEnd !== null && idx >= sStart && idx <= sEnd) s.classList.add('selected');
                            else if (sEnd === null && idx === sStart) s.classList.add('selected');
                        }
                        s.onclick = () => perfWeekSlotClick(dateStr, idx);
                    }
                    grid.appendChild(s);
                }
            });
            wrap.appendChild(grid);
            container.appendChild(wrap);
            if (prevScroll) { wrap.scrollLeft = prevScroll.left; wrap.scrollTop = prevScroll.top; }
            const help = document.createElement('div');
            help.style.cssText = 'font-size:0.75rem;color:var(--wds-gray-500);margin-top:8px;text-align:center';
            help.textContent = _calMin() > 1 ? `시작 슬롯 → 종료 슬롯 순서로 클릭 (최소 ${_calMin()}시간)` : '시작 슬롯 → 종료 슬롯 순서로 클릭 (1시간이면 같은 슬롯을 두 번)';
            if (_calAllowBlocked()) help.textContent += " · '요청' 칸은 게더링이 막아 둔 시간(운영진 수락 후 공개)";
            container.appendChild(help);
        }

        function perfWeekSlotClick(dateStr, idx) {
            const st = _cs(), min = _calMin();
            const rerender = () => { const sy = window.scrollY; renderPerfCal(); window.scrollTo({ top: sy }); _calChanged(); };
            // 새 시작 선택: 다른 날짜, 시작 미선택, 또는 이미 완성된 범위에서 더 앞 슬롯 클릭
            if (st.selectedDate !== dateStr || st.startSlot === null || idx < st.startSlot) {
                st.selectedDate = dateStr; st.startSlot = idx; st.endSlot = null;
                rerender(); return;
            }
            const startSlot = st.startSlot;
            if (idx === startSlot) {
                // 1시간 허용 컨텍스트에서 같은 슬롯 재클릭 = 1슬롯 범위 확정, 그 외엔 선택 해제
                if (min <= 1 && st.endSlot === null) { st.endSlot = idx; rerender(); return; }
                st.startSlot = null; st.endSlot = null; rerender(); return;
            }
            if (idx - startSlot + 1 < min) { showToast(`최소 ${min}시간 이상 선택해주세요.`); return; }
            const conflicts = _calAllowBlocked() ? getHardConflicts(dateStr) : getDateConflicts(dateStr);
            for (let j = startSlot; j <= idx; j++) {
                const conf = conflicts.some(c => {
                    const cs = TIMES.indexOf(c.start_time), ce = TIMES.indexOf(c.end_time);
                    return j >= cs && j <= ce;
                });
                if (conf) { showToast('선택 범위 내에 예약불가 슬롯이 있습니다.'); return; }
            }
            st.endSlot = idx;
            rerender();
        }

        function selectPerfDate(dateStr) {
            const st = _cs();
            st.selectedDate = dateStr;
            st.startSlot = null;
            st.endSlot = null;
            st.viewDate = new Date(dateStr + 'T00:00:00');
            st.calView = 'week';
            const ids = _calIds();
            document.getElementById(ids.monthBtn)?.classList.remove('active');
            document.getElementById(ids.weekBtn)?.classList.add('active');
            renderPerfCal();
            _calChanged();
        }

        function renderPerfWeekTimePicker(container) {
            renderPerfTimePicker(container);
        }

        function renderPerfTimePicker(container) {
            if (!_cs().selectedDate) {
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:0.8rem;color:var(--wds-gray-500);text-align:center;padding:16px 0';
                hint.textContent = '날짜를 선택하면 시간 슬롯이 표시됩니다';
                container.appendChild(hint);
                return;
            }
            const dateStr = _cs().selectedDate;
            const conflicts = getDateConflicts(dateStr);
            const titleEl = document.createElement('div');
            titleEl.style.cssText = 'font-size:0.82rem;font-weight:700;color:var(--wds-gray-700);margin:12px 0 4px';
            titleEl.textContent = `${dateStr} 시간 선택`;
            container.appendChild(titleEl);
            const hintEl = document.createElement('div');
            hintEl.style.cssText = 'font-size:0.74rem;color:var(--wds-gray-500);margin-bottom:10px';
            hintEl.textContent = _calMin() > 1 ? `시작 → 종료 순서로 클릭 (최소 ${_calMin()}시간)` : '시작 → 종료 순서로 클릭 (1시간이면 같은 슬롯을 두 번)';
            container.appendChild(hintEl);
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px';
            TIMES.forEach((time, idx) => {
                const endTime = TIMES[idx+1] || '23:00';
                const slot = document.createElement('div');
                slot.className = 'perf-time-slot';
                const isConflict = conflicts.some(c => {
                    const cs = TIMES.indexOf(c.start_time), ce = TIMES.indexOf(c.end_time);
                    return idx >= cs && idx <= ce;
                });
                const { startSlot, endSlot } = _cs();
                if (isConflict) {
                    slot.classList.add('unavailable');
                    slot.innerHTML = `<div style="font-size:0.78rem">${time}</div><div style="font-size:0.64rem">예약불가</div>`;
                } else if (startSlot !== null && endSlot === null && idx > startSlot && idx - startSlot + 1 < _calMin()) {
                    slot.classList.add('end-disabled');
                    slot.innerHTML = `<div style="font-size:0.82rem;font-weight:700">${time}</div><div style="font-size:0.64rem;opacity:0.6">~${endTime}</div>`;
                } else {
                    if (startSlot !== null && endSlot !== null && idx >= startSlot && idx <= endSlot) {
                        slot.classList.add('selected');
                    } else if (startSlot !== null && endSlot === null && idx === startSlot) {
                        slot.classList.add('selected');
                    }
                    slot.innerHTML = `<div style="font-size:0.82rem;font-weight:700">${time}</div><div style="font-size:0.64rem;opacity:0.7">~${endTime}</div>`;
                    slot.onclick = () => perfWeekSlotClick(dateStr, idx);
                }
                grid.appendChild(slot);
            });
            container.appendChild(grid);
        }

        function calcPerformanceFee(dateStr, startIdx, endIdx, headcount) {
            if (startIdx === null || endIdx === null) return 0;
            const dow = new Date(dateStr + 'T00:00:00').getDay(); // 로컬 자정 파싱(UTC 밀림 방지)
            const isWeekend = dow === 0 || dow === 6;
            const baseRate = isWeekend ? 40000 : 25000;
            // 5인 초과 추가금은 시간당이 아니라 예약당 1회 부과
            const extra = headcount > 5 ? (headcount - 5) * 5000 : 0;
            const hours = endIdx - startIdx + 1;
            return hours * baseRate + extra;
        }

        function renderPerfFee() {
            const el = document.getElementById('perfFeeSummary');
            if (!el) return;
            const { selectedDate, startSlot, endSlot, headcount } = _perfState;
            if (startSlot === null || endSlot === null) { el.innerHTML = ''; return; }
            const fee = calcPerformanceFee(selectedDate, startSlot, endSlot, headcount);
            const hours = endSlot - startSlot + 1;
            const endDisplay = TIMES[endSlot + 1] || '23:00';
            el.innerHTML = `<div class="perf-fee-summary">
                ${selectedDate} ${TIMES[startSlot]} ~ ${endDisplay} (${hours}시간) · ${headcount}명<br>
                예상 금액: <strong>${fee.toLocaleString()}원</strong>
            </div>`;
            const st = document.getElementById('perfStickyFee'); // 아래 고정 바의 선택 요약
            if (st) st.innerHTML = `<small>${_perfShortDate(selectedDate)} ${TIMES[startSlot]}~${endDisplay}</small><b>${fee.toLocaleString()}원<span class="meta"> · ${hours}시간 · ${headcount}명</span></b>`;
        }

        function goPerfStep2() {
            if (_perfState.startSlot === null || _perfState.endSlot === null) return;
            renderPerfStep2();
        }

        function renderPerfStep2() {
            const container = document.getElementById('perf-step-container');
            const { selectedDate, startSlot, endSlot, headcount } = _perfState;
            const fee = calcPerformanceFee(selectedDate, startSlot, endSlot, headcount);
            const hours = endSlot - startSlot + 1;
            const endDisplay = TIMES[endSlot + 1] || '23:00';
            const chips = [...PERF_HOW_FOUND_OPTS].map(o =>
                `<button type="button" class="perf-hf-chip${_perfState.howFound===o?' selected':''}" onclick="selectPerfHowFound('${o}')">${o}</button>`
            ).join('') + `<button type="button" class="perf-hf-chip${_perfState.howFound==='기타'?' selected':''}" onclick="selectPerfHowFound('기타')">기타</button>`;
            container.innerHTML = `
                ${_perfStepsHTML(2)}
                <div style="max-width:560px;margin:0 auto">
                <div class="cm-top" style="padding-top:0"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="renderPerfStep1()">‹ 날짜·시간 다시 선택</button></div>
                <div class="cm-stats" style="margin-bottom:18px">
                    <div><small>일시</small><b>${_perfShortDate(selectedDate)}<br>${TIMES[startSlot]}~${endDisplay}</b></div>
                    <div><small>인원</small><b><span id="perfSummaryHeadcount">${headcount}명</span></b><small id="perfSummaryTbd" style="margin-top:3px;${_perfState.audienceTbd ? '' : 'display:none'}">공연진 기준 · 관람객 미정</small></div>
                    <div><small>예상 금액</small><b>${fee.toLocaleString()}원</b><small style="margin-top:3px">${hours}시간</small></div>
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">이름 *</label>
                    <input type="text" class="perf-form-input" id="perfName" placeholder="실명 입력">
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">연락처 *</label>
                    <input type="tel" class="perf-form-input" id="perfPhone" placeholder="010-0000-0000">
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">사용 목적 *</label>
                    <input type="text" class="perf-form-input" id="perfPurpose" placeholder="예: 밴드 공연, 행사, 촬영 등">
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">공간을 알게 된 경로 *</label>
                    <div class="perf-how-found-opts" id="perfHowFoundChips">${chips}</div>
                    <input type="text" class="perf-form-input" id="perfHowFoundOther" placeholder="직접 입력"
                        style="margin-top:8px;display:${_perfState.howFound==='기타'?'block':'none'}" value="${_perfState.howFoundOther||''}">
                </div>
                <div class="perf-form-group" style="background:var(--wds-gray-100);border:1px solid var(--wds-gray-300);border-radius:10px;padding:12px 14px">
                    <label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer;font-size:0.86rem;font-weight:600;color:var(--wds-black);line-height:1.5">
                        <input type="checkbox" id="perfAudienceTbd" ${_perfState.audienceTbd ? 'checked' : ''}
                            onchange="toggleAudienceTbd(this.checked)"
                            style="width:18px;height:18px;margin-top:1px;flex:none;cursor:pointer">
                        관람객 인원이 아직 미정입니다 — 공연진 인원으로만 우선 예약할게요.
                    </label>
                    <div style="font-size:0.78rem;color:var(--wds-gray-700);margin-top:6px;padding-left:27px;line-height:1.55">당일 관람객을 포함한 최종 인원을 산정하여, 초과 인원(1인당 +5,000원)은 현장에서 추가 결제됩니다.</div>
                </div>
                <div class="perf-form-group" style="background:var(--wds-gray-100);border:1px solid var(--wds-gray-300);border-radius:10px;padding:12px 14px">
                    <label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer;font-size:0.86rem;font-weight:600;color:var(--wds-black);line-height:1.5">
                        <input type="checkbox" id="perfPrivacyAgree" ${_perfState.privacyAgree ? 'checked' : ''}
                            onchange="_perfState.privacyAgree=this.checked"
                            style="width:18px;height:18px;margin-top:1px;flex:none;cursor:pointer">
                        [필수] 개인정보 수집·이용에 동의합니다.
                    </label>
                    <div style="font-size:0.76rem;color:var(--wds-gray-700);margin-top:6px;padding-left:27px;line-height:1.6">
                        · 수집 항목: 이름, 연락처<br>
                        · 이용 목적: 대관 예약 접수·확인 및 예약 관련 안내(문자·전화)<br>
                        · 보유 기간: 예약 이용 종료 후 1년 보관 후 파기<br>
                        · 동의를 거부할 권리가 있으며, 거부 시 대관 예약 신청이 제한됩니다.
                    </div>
                </div>
                <div id="perfSubmitResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:2px 0;color:#e74c3c"></div>
                <div style="display:flex;gap:8px;margin-top:4px">
                    <button class="gaa-btn gaa-btn-block gaa-btn-primary" id="perfSubmitBtn" onclick="submitPerfBooking()">신청하기</button>
                </div>
                </div>`;
        }

        // 관람객 미정 체크 — DB에 별도 컬럼이 없어 purpose 끝에 마커 문자열로 저장한다.
        // 관리자 카드가 이 마커를 감지해 배지로 표시하고, 표시 시엔 마커를 떼어낸다.
        const PERF_AUDIENCE_TBD_MARK = '[관람객 미정·당일 추가결제]';

        // 예약번호: 6자리, 공연 예매번호와 동일 charset (헷갈리는 I/L/O/0/1 제외)
        const PERF_MAX_HEADCOUNT = 30; // 공간 대관 예약 가능 최대 인원 (2026-09-30: 20 → 30)
        const PERF_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        function genPerfBookingCode() {
            const buf = new Uint32Array(6);
            crypto.getRandomValues(buf);
            let c = '';
            for (let i = 0; i < 6; i++) c += PERF_CODE_CHARS[buf[i] % PERF_CODE_CHARS.length];
            return c;
        }

        // 자동취소 정책: 신청(pending) 후 4시간 내 승인(확정)되지 않으면 취소.
        // 크론이 없으므로 lazy — 조회 화면·가용성 계산은 기한 지난 대기 건을 즉시
        // 취소로 취급하고, DB 상태('expired')는 관리자 탭 진입 시 일괄 반영(sweep)된다.
        const PERF_EXPIRE_MS = GAA_RULES.PERF_EXPIRE_MS;
        function _pbExpired(b) {
            return !!(b && b.status === 'pending' && b.created_at
                && Date.now() - new Date(b.created_at).getTime() > PERF_EXPIRE_MS);
        }
        function toggleAudienceTbd(checked) {
            _perfState.audienceTbd = checked;
            const s = document.getElementById('perfSummaryHeadcount');
            if (s) s.textContent = `${_perfState.headcount}명`;
            const tbd = document.getElementById('perfSummaryTbd'); if (tbd) tbd.style.display = checked ? '' : 'none';
        }

        function selectPerfHowFound(opt) {
            _perfState.howFound = opt;
            document.querySelectorAll('.perf-hf-chip').forEach(b => {
                b.classList.toggle('selected', b.textContent === opt);
            });
            const otherInput = document.getElementById('perfHowFoundOther');
            if (otherInput) otherInput.style.display = opt === '기타' ? 'block' : 'none';
        }

        let _perfSubmitBusy = false;
        async function submitPerfBooking() {
            const res = document.getElementById('perfSubmitResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = ''; // 진입 시 stale 메시지 초기화
            if (_perfSubmitBusy) return;   // 중복 제출 방지
            const name = document.getElementById('perfName')?.value.trim();
            const phone = document.getElementById('perfPhone')?.value.trim();
            const purpose = document.getElementById('perfPurpose')?.value.trim();
            let howFound = _perfState.howFound;
            if (howFound === '기타') howFound = document.getElementById('perfHowFoundOther')?.value.trim() || '기타';
            if (!name) { showErr('이름을 입력해주세요.'); return; }
            if (!phone) { showErr('연락처를 입력해주세요.'); return; }
            if (!purpose) { showErr('사용 목적을 입력해주세요.'); return; }
            if (!howFound) { showErr('공간을 알게 된 경로를 선택해주세요.'); return; }
            if (!_perfState.privacyAgree) { showErr('개인정보 수집·이용에 동의해주세요.'); return; }
            const { selectedDate, startSlot, endSlot, headcount } = _perfState;
            const submitBtn = document.getElementById('perfSubmitBtn');
            _perfSubmitBusy = true;
            if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '0.6'; }
            try {
                // Re-validate conflicts at submit time to prevent TOCTOU race
                const [resCheck, pbCheck] = await Promise.all([
                    supabaseClient.from('reservations').select('start_time,end_time')
                        .eq('res_date', selectedDate).neq('status','rejected').neq('status','cancelled'),
                    supabaseClient.from('performance_bookings').select('start_time,end_time,status,created_at')
                        .eq('date', selectedDate).not('status','in','("rejected","expired","cancelled")')
                ]);
                const allConflicts = [...(resCheck.data||[]), ...(pbCheck.data||[]).filter(b => !_pbExpired(b))];
                const hasConflict = allConflicts.some(c => {
                    const cs = TIMES.indexOf(c.start_time), ce = TIMES.indexOf(c.end_time);
                    return startSlot <= ce && endSlot >= cs;
                });
                if (hasConflict) { showToast('선택하신 시간대에 이미 예약이 있습니다. 다른 시간을 선택해주세요.'); renderPerfStep1(); return; }
                const purposeFinal = _perfState.audienceTbd ? `${purpose} ${PERF_AUDIENCE_TBD_MARK}` : purpose;
                const row = {
                    name, phone, purpose: purposeFinal, how_found: howFound,
                    date: selectedDate,
                    start_time: TIMES[startSlot],
                    end_time: TIMES[endSlot],
                    headcount
                };
                // 예약번호 발급 — unique 충돌(23505)이면 새 코드로 재시도
                let inserted = null, insErr = null;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const r = await supabaseClient.from('performance_bookings')
                        .insert({ ...row, booking_code: genPerfBookingCode() })
                        .select('id,booking_code').single();
                    inserted = r.data; insErr = r.error;
                    if (!insErr || insErr.code !== '23505') break;
                }
                if (insErr && /booking_code/i.test(insErr.message || '')) {
                    // booking_code 컬럼 마이그레이션 전 폴백 — 번호 없이 접수 (SQL 실행 후 자동 정상화)
                    const r = await supabaseClient.from('performance_bookings').insert(row).select('id').single();
                    inserted = r.data; insErr = r.error;
                }
                if (insErr && /SLOT_TAKEN/.test((insErr.code || '') + ' ' + (insErr.message || ''))) { showToast('방금 다른 예약이 먼저 들어왔습니다. 다른 시간을 선택해주세요.'); renderPerfStep1(); return; }
                if (insErr || !inserted) { showErr('신청 중 오류가 발생했습니다: ' + (insErr ? insErr.message : '')); return; }
                _perfState.lastBookingCode = inserted.booking_code || null;
                sendAdminPush('🎭 공간 대관 신청', `${name} · ${selectedDate} ${TIMES[startSlot]}~${TIMES[endSlot+1]||'23:00'}${_perfState.audienceTbd ? ' · 관람객 미정' : ''}`).catch(() => {});
                // 접수 확인 문자 fire-and-forget — 실제 접수 건 대조·1회 발송 보장은 /send-sms가 서비스 롤로 수행
                if (inserted && inserted.id) {
                    fetch('/send-sms', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ booking_id: inserted.id })
                    }).catch(() => {});
                }
                renderPerfStep3();
            } finally {
                _perfSubmitBusy = false;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = ''; }
            }
        }

        function renderPerfStep3() {
            const container = document.getElementById('perf-step-container');
            const code = _perfState.lastBookingCode;
            // 색은 팔레트 변수만 사용(다크모드 자동 대응). 체크 원판의 초록만 고정색 — 양 테마에서 동일하게 보이는 성공 표식.
            const steps = [
                ['문자 확인', '입력하신 연락처로 예약번호·입금 안내 문자가 발송됩니다.'],
                ['입금', '안내된 계좌로 이용요금을 입금해주시면 예약이 확정됩니다.'],
                ['이용 안내', '확정 후 장비 사용법과 이용 안내를 보내드립니다.'],
            ];
            container.innerHTML = `
                ${_perfStepsHTML(3)}
                <div style="max-width:400px;margin:0 auto;padding:24px 8px 28px;text-align:center;word-break:keep-all">
                    <div style="width:60px;height:60px;margin:0 auto 18px;border-radius:50%;background:#34C759;display:flex;align-items:center;justify-content:center">
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <div style="font-size:1.15rem;font-weight:800;color:var(--wds-black);margin-bottom:6px">예약 신청이 완료되었습니다</div>
                    <p style="font-size:0.85rem;color:var(--wds-gray-500);margin:0 0 18px">아래 순서로 예약이 확정됩니다</p>
                    ${code ? `
                    <div style="background:var(--wds-white);border:1.5px solid var(--wds-primary);border-radius:14px;padding:16px 14px;margin-bottom:14px">
                        <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);letter-spacing:0.06em">예약번호</div>
                        <div style="font-size:1.7rem;font-weight:800;letter-spacing:0.28em;color:var(--wds-primary);margin:4px 0 2px;padding-left:0.28em">${code}</div>
                        <div style="font-size:0.76rem;color:var(--wds-gray-500)">예약 상태 조회에 필요하니 보관해주세요</div>
                    </div>` : ''}
                    <div style="background:var(--wds-gray-100);border:1px solid var(--wds-gray-300);border-radius:14px;padding:18px 16px;text-align:left;display:flex;flex-direction:column;gap:14px">
                        ${steps.map(([t, d], i) => `
                        <div style="display:flex;gap:12px;align-items:flex-start">
                            <span style="flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:var(--wds-primary);color:#fff;font-size:0.72rem;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1px">${i + 1}</span>
                            <span style="flex:1">
                                <span style="display:block;font-size:0.85rem;font-weight:700;color:var(--wds-black);margin-bottom:2px">${t}</span>
                                <span style="display:block;font-size:0.8rem;color:var(--wds-gray-700);line-height:1.5">${d}</span>
                            </span>
                        </div>`).join('')}
                    </div>
                    <div style="margin-top:12px;padding:10px 14px;background:#FEF3C7;border-radius:10px;font-size:0.8rem;color:#92400E;font-weight:600;line-height:1.55;text-align:left">⏰ 신청 후 4시간 안에 입금 확인(예약 확정)이 되지 않으면 예약이 자동 취소됩니다.</div>
                    <button class="gaa-btn gaa-btn-block gaa-btn-primary" style="margin-top:16px" onclick="renderPerfLookup(${code ? `'${code}'` : ''})">예약 상태 조회</button>
                    <button class="gaa-btn gaa-btn-block gaa-btn-secondary" style="margin-top:10px" onclick="showPortal()">처음으로</button>
                    <a href="tel:01051091042" style="display:inline-block;margin-top:14px;font-size:0.82rem;color:var(--wds-gray-500);text-decoration:none">문의 · 010-5109-1042 (최경수)</a>
                </div>`;
        }

        // ── 예약 조회: 예약번호 + 연락처로 상태 확인 (비로그인)
        function renderPerfLookup(prefillCode) {
            const container = document.getElementById('perf-step-container');
            window.scrollTo(0, 0); // sticky 헤더의 조회 버튼은 스크롤 중에도 눌리므로 폼이 보이게 복귀
            container.innerHTML = `
                <div style="max-width:480px;margin:0 auto;padding:12px 0 24px;word-break:keep-all">
                    <div class="cm-top" style="padding-top:0"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="renderPerfStep1()">‹ 돌아가기</button></div>
                    <div class="cm-form">
                        <h3>예약 조회</h3>
                        <p>문자로 안내받은 <strong>예약번호</strong>와 신청 시 입력한 <strong>연락처</strong>를 입력해주세요.</p>
                        <div class="perf-form-group">
                            <label class="perf-form-label">예약번호 (6자리)</label>
                            <input type="text" class="perf-form-input" id="perfLookupCode" maxlength="6" placeholder="예: K7PQ2M"
                                value="${prefillCode ? escapeHtml(String(prefillCode)) : ''}"
                                style="text-transform:uppercase;letter-spacing:0.2em;font-weight:700" autocomplete="off">
                        </div>
                        <div class="perf-form-group">
                            <label class="perf-form-label">연락처</label>
                            <input type="tel" class="perf-form-input" id="perfLookupPhone" placeholder="010-0000-0000">
                        </div>
                        <div id="perfLookupResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:2px 0"></div>
                        <button class="gaa-btn gaa-btn-block gaa-btn-primary" id="perfLookupBtn" onclick="lookupPerfBooking()">조회하기</button>
                        <div id="perfLookupCard"></div>
                    </div>
                </div>`;
        }

        async function lookupPerfBooking() {
            const res = document.getElementById('perfLookupResult');
            const card = document.getElementById('perfLookupCard');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (card) card.innerHTML = '';
            const code = (document.getElementById('perfLookupCode')?.value || '').trim().toUpperCase();
            const phoneDigits = (document.getElementById('perfLookupPhone')?.value || '').replace(/\D/g, '');
            if (!/^[A-Z2-9]{6}$/.test(code)) { showErr('예약번호 6자리를 입력해주세요.'); return; }
            if (phoneDigits.length < 10) { showErr('연락처를 정확히 입력해주세요.'); return; }
            const btn = document.getElementById('perfLookupBtn');
            if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
            try {
                // 서버가 예약번호+연락처를 함께 대조해 맞는 건만 돌려준다(2026-11-10 — 남의 예약 정보가 브라우저로 내려오지 않게)
                const srv = await _gwAction('perf_lookup', { code, phone: phoneDigits }, { anon: true });
                let b;
                if (srv.down) {
                    const { data, error } = await supabaseClient.from('performance_bookings')
                        .select('id,name,booking_code,phone,status,date,start_time,end_time,headcount,purpose,created_at')
                        .eq('booking_code', code).limit(1);
                    if (error) { showErr('조회 중 오류가 발생했습니다: ' + error.message); return; }
                    b = (data || [])[0];
                } else {
                    if (!srv.ok) { showErr(srv.message || '조회 중 오류가 발생했습니다.'); return; }
                    b = srv.booking;
                }
                // 연락처까지 일치해야 표시 — 불일치 시 존재 여부도 알리지 않는다
                if (!b || String(b.phone || '').replace(/\D/g, '') !== phoneDigits) {
                    showErr('일치하는 예약을 찾을 수 없습니다. 예약번호와 연락처를 확인해주세요.');
                    return;
                }
                _perfLookupBooking = b; // 취소 버튼(cancelMyPerfBooking)에서 사용
                if (card) card.innerHTML = _perfLookupCardHTML(b);
            } finally {
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            }
        }

        function _perfLookupCardHTML(b) {
            const sIdx = TIMES.indexOf(b.start_time), eIdx = TIMES.indexOf(b.end_time);
            const endDisplay = TIMES[eIdx + 1] || '23:00';
            const hours = eIdx - sIdx + 1;
            const fee = calcPerformanceFee(b.date, sIdx, eIdx, b.headcount);
            const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(b.date + 'T00:00:00').getDay()];
            const audienceTbd = (b.purpose || '').includes(PERF_AUDIENCE_TBD_MARK);
            const expired = b.status === 'expired' || _pbExpired(b);
            let chip, note;
            if (b.status === 'approved') {
                chip = ['✅ 예약 확정', '#DCFCE7', '#166534'];
                note = '입금이 확인되어 예약이 확정되었습니다. 이용 안내 문자를 확인해주세요.';
            } else if (expired) {
                chip = ['⏰ 자동 취소', '#F3F4F6', '#4B5563'];
                note = '신청 후 4시간 안에 입금 확인이 되지 않아 예약이 자동 취소되었습니다. 이용을 원하시면 다시 예약해주시거나 문의(010-5109-1042)해주세요.';
            } else if (b.status === 'cancelled') {
                chip = ['❌ 취소됨', '#FEE2E2', '#991B1B'];
                note = '예약이 취소되었습니다. 이용을 원하시면 다시 예약해주시고, 궁금한 점은 문의(010-5109-1042)로 연락해주세요.';
            } else if (b.status === 'rejected') {
                chip = ['❌ 예약 취소', '#FEE2E2', '#991B1B'];
                note = '예약이 취소되었습니다. 궁금한 점은 문의(010-5109-1042)해주세요.';
            } else {
                chip = ['⏳ 입금 대기', '#FEF3C7', '#92400E'];
                const leftMs = Math.max(0, PERF_EXPIRE_MS - (Date.now() - new Date(b.created_at).getTime()));
                const leftH = Math.floor(leftMs / 3600000), leftM = Math.floor((leftMs % 3600000) / 60000);
                note = `이용요금(<strong>${fee.toLocaleString()}원</strong>${audienceTbd ? ' + 당일 추가분' : ''})을 <strong>${GAA_RULES.BANK_NAME} ${GAA_RULES.BANK_ACCOUNT}(${GAA_RULES.BANK_HOLDER})</strong> 계좌로 입금해주시면 예약이 확정됩니다. `
                    + `남은 확정 기한은 약 <strong>${leftH > 0 ? leftH + '시간 ' : ''}${leftM}분</strong>이며, 기한 내 확정되지 않으면 자동 취소됩니다.`;
            }
            // 본인 취소: 입금 대기·확정 건만 (만료·거절·취소 건은 불가)
            const canCancel = !expired && (b.status === 'pending' || b.status === 'approved');
            return `<div style="margin-top:18px;border:1px solid var(--wds-gray-300);border-radius:14px;padding:16px;background:var(--wds-white)">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="background:${chip[1]};color:${chip[2]};font-size:0.78rem;font-weight:700;padding:4px 11px;border-radius:12px">${chip[0]}</span>
                    <span style="margin-left:auto;font-size:0.8rem;color:var(--wds-gray-500);font-weight:700;letter-spacing:0.12em">${escapeHtml(b.booking_code || '')}</span>
                </div>
                <div style="margin-top:12px;font-size:0.88rem;color:var(--wds-gray-700);line-height:1.7">
                    📅 ${b.date}(${wd}) ${b.start_time} ~ ${endDisplay} · ${hours}시간<br>
                    👥 ${b.headcount ? b.headcount + '명' : '인원 미정'}${audienceTbd ? ' (공연진 기준 · 관람객 미정)' : ''} · <strong style="color:var(--wds-black)">${fee.toLocaleString()}원</strong>${audienceTbd ? ' + 당일 추가분' : ''}
                </div>
                <div style="margin-top:10px;padding:10px 12px;background:var(--wds-gray-100);border-radius:10px;font-size:0.82rem;color:var(--wds-gray-700);line-height:1.6">${note}</div>
                ${canCancel ? `<button class="gaa-btn gaa-btn-sm gaa-btn-block gaa-btn-danger" style="margin-top:12px" onclick="cancelMyPerfBooking('${b.id}')">예약 취소</button>
                <div style="margin-top:8px;font-size:0.74rem;color:var(--wds-gray-500);text-align:center;line-height:1.5">환불 규정: 이용일 7일 전까지 전액 · 3일 전까지 50% · 2일 전~당일 환불 불가</div>` : ''}
            </div>`;
        }

        let _perfLookupBooking = null; // 조회에 성공한(연락처 대조 통과) 예약 — 본인 취소에서 사용
        async function cancelMyPerfBooking(id) {
            const b = _perfLookupBooking;
            if (!b || b.id !== id) return;
            const msg = b.status === 'approved'
                ? '확정된 예약을 취소하시겠습니까?\n\n[환불 규정]\n· 이용일 7일 전까지: 전액 환불\n· 이용일 3일 전까지: 50% 환불\n· 이용일 2일 전 ~ 당일: 환불 불가\n\n입금하신 금액의 환불은 문의(010-5109-1042)를 통해 안내드립니다.'
                : '예약 신청을 취소하시겠습니까?\n취소 후에는 되돌릴 수 없습니다.';
            if (!confirm(msg)) return;
            // 조건부 업데이트 — 그 사이 상태가 바뀐(거절·만료 처리 등) 건은 건드리지 않는다
            let data, error;
            const srv = await _gwAction('perf_cancel', { id, phone: String(b.phone || '').replace(/\D/g, '') }, { anon: true });
            if (srv.down) {
                ({ data, error } = await supabaseClient.from('performance_bookings')
                    .update({ status: 'cancelled' })
                    .eq('id', id).in('status', ['pending', 'approved'])
                    .select('id'));
            } else if (!srv.ok) error = { message: srv.message || '서버 오류' };
            else data = srv.cancelled ? [{ id }] : [];
            if (error) { showToast('취소 중 오류가 발생했습니다: ' + error.message); return; }
            if (!data || !data.length) { showToast('이미 처리된 예약입니다. 다시 조회해주세요.'); lookupPerfBooking(); return; }
            sendAdminPush('🚫 공간 대관 고객 취소', `${b.name || ''} · ${b.date} ${b.start_time}~${TIMES[TIMES.indexOf(b.end_time) + 1] || '23:00'}${b.status === 'approved' ? ' (확정 건)' : ''}`).catch(() => {});
            showToast('예약이 취소되었습니다.');
            lookupPerfBooking(); // 폼에 남아 있는 입력값으로 재조회 → 카드 갱신
        }

        // 승인 안내 메시지 자동 생성 기능은 제거됨(2026-08) — 도어락 등 민감정보가 담긴
        // 템플릿을 클라이언트에서 읽는 구조라 노출 위험이 있어, 승인 안내는 수동 발송으로 운영한다.

        async function renderPerfAdminTab(container) {
            if (!isSuper()) { container.innerHTML = '<p style="text-align:center;padding:24px;color:var(--wds-gray-500);font-size:0.88rem">공간 대관 관리는 운영 총괄만 볼 수 있습니다.</p>'; return; }
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--wds-gray-500)">불러오는 중…</div>';
            // 4시간 자동취소 sweep — 기한 지난 대기 건을 DB에도 반영 (실패해도 화면은 lazy 판정으로 커버)
            try {
                await supabaseClient.from('performance_bookings').update({ status: 'expired' })
                    .eq('status', 'pending')
                    .lt('created_at', new Date(Date.now() - PERF_EXPIRE_MS).toISOString());
            } catch (_) {}
            const { data, error } = await supabaseClient.from('performance_bookings')
                .select('*').order('created_at', { ascending: false });
            if (error) { container.innerHTML = `<div style="color:red;padding:16px">오류: ${error.message}</div>`; return; }
            const items = data || [];
            state.perfAdminItems = items; // 인라인 수정(editPerfBooking)에서 원본 조회용
            const pending = items.filter(b => b.status === 'pending' && !_pbExpired(b));
            const others = items.filter(b => !(b.status === 'pending' && !_pbExpired(b)));
            let html = await _cmReqSectionHTML(); // 커뮤니티 모임의 게더링 차단 시간 사용 요청 — 수락/거절
            html += `<div class="admin-section-title">🎭 공간 대관 신청 (${items.length}건)</div>`;
            if (!items.length) { html += '<p style="text-align:center;padding:20px;color:var(--wds-gray-500)">신청 내역이 없습니다.</p>'; container.innerHTML = html; return; }
            // 카드 내 액션 버튼 공통 스타일 — 크기·모양 통일 (기능별 색만 다르게)
            const _pbtn = _gaaBtn; // 색 인자 → gaa-btn 변형 (아래 _gaaBtn 참고)
            const _n = new Date();
            const todayStr = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}-${String(_n.getDate()).padStart(2, '0')}`;
            const renderCard = (b) => {
                const endDisplay = TIMES[TIMES.indexOf(b.end_time)+1] || '23:00';
                const hours = TIMES.indexOf(b.end_time) - TIMES.indexOf(b.start_time) + 1;
                const fee = calcPerformanceFee(b.date, TIMES.indexOf(b.start_time), TIMES.indexOf(b.end_time), b.headcount);
                const audienceTbd = (b.purpose || '').includes(PERF_AUDIENCE_TBD_MARK);
                const purposeDisplay = (b.purpose || '').replace(PERF_AUDIENCE_TBD_MARK, '').trim();
                const wd = ['일','월','화','수','목','금','토'][new Date(b.date + 'T00:00:00').getDay()];
                const phoneDigits = String(b.phone || '').replace(/\D/g, '');
                const cd = new Date(b.created_at);
                const createdShort = `${cd.getMonth()+1}/${cd.getDate()} ${String(cd.getHours()).padStart(2,'0')}:${String(cd.getMinutes()).padStart(2,'0')} 접수`;
                const eff = _pbExpired(b) ? 'expired' : b.status; // sweep 실패 시에도 기한 지난 대기 건은 자동취소로 표시
                const chip = eff === 'pending' ? ['⏳ 대기', '#FEF3C7', '#92400E']
                    : eff === 'approved' ? ['✅ 승인', '#DCFCE7', '#166534']
                    : eff === 'expired' ? ['⏰ 자동취소', '#F3F4F6', '#4B5563']
                    : eff === 'cancelled' ? ['🚫 고객 취소', '#FEE2E2', '#991B1B'] : ['❌ 거절', '#FEE2E2', '#991B1B'];
                const editBtn = isSuper() ? _pbtn('✏️ 수정', `editPerfBooking('${b.id}')`, 'var(--wds-gray-700)', 'var(--wds-gray-300)') : '';
                const delBtn = _pbtn('삭제', `deletePerfBooking('${b.id}')`, 'var(--wds-gray-500)', 'var(--wds-gray-300)');
                return `<div class="perf-admin-card${eff==='pending'?' pending':''}" id="perf-card-${b.id}">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <span style="background:${chip[1]};color:${chip[2]};font-size:0.72rem;font-weight:700;padding:3px 9px;border-radius:10px;flex:none">${chip[0]}</span>
                        <span style="font-size:0.9rem;font-weight:700">${escapeHtml(b.name)}</span>
                        ${b.booking_code ? `<span style="font-size:0.74rem;font-weight:700;color:var(--wds-gray-500);letter-spacing:0.1em">${escapeHtml(b.booking_code)}</span>` : ''}
                        <span style="margin-left:auto;font-size:0.72rem;color:var(--wds-gray-500)">${createdShort}</span>
                    </div>
                    ${audienceTbd ? `<div style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:12px;margin:8px 0 0">👥 관람객 미정 — 공연진 ${b.headcount}명 기준, 당일 인원 산정 후 추가 결제</div>` : ''}
                    <div class="perf-admin-card-info" style="margin-top:8px">
                        📅 ${b.date}(${wd}) ${b.start_time} ~ ${endDisplay} · ${hours}시간<br>
                        👥 ${b.headcount ? b.headcount + '명' : '인원 미정'}${audienceTbd ? ' (공연진 기준)' : ''} · <strong style="color:var(--wds-black)">${fee.toLocaleString()}원</strong>${audienceTbd ? ' + 당일 추가분' : ''}<br>
                        📞 <a href="tel:${phoneDigits}" style="color:inherit">${escapeHtml(b.phone)}</a> &nbsp;·&nbsp; 🎯 ${escapeHtml(purposeDisplay)} &nbsp;·&nbsp; 🔍 ${escapeHtml(b.how_found)}
                    </div>
                    ${b.date < todayStr ? `
                    <div style="display:flex;margin-top:10px;justify-content:flex-end">${delBtn}</div>` : `
                    ${eff==='pending' ? `
                    <div style="display:flex;gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="approvePerfBooking('${b.id}')">승인</button>
                        <button class="gaa-btn gaa-btn-sm gaa-btn-danger" onclick="rejectPerfBooking('${b.id}')">거절</button>
                        <span style="margin-left:auto;display:flex;gap:6px">${editBtn}${delBtn}</span>
                    </div>` : ''}
                    ${eff==='approved' ? `
                    <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end;flex-wrap:wrap">
                        ${editBtn}${_pbtn('예약 취소', `cancelPerfReservation('${b.id}')`, '#EF4444', '#EF4444')}${delBtn}
                    </div>` : ''}
                    ${eff==='expired' || eff==='rejected' || eff==='cancelled' ? `
                    <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end;flex-wrap:wrap">
                        ${_pbtn('승인(복구)', `approvePerfBooking('${b.id}')`, '#166534', '#166534')}${delBtn}
                    </div>` : ''}`}
                </div>`;
            };
            html += pending.map(renderCard).join('') + others.map(renderCard).join('');
            container.innerHTML = html;
        }

        // ── 커뮤니티 모임 시간 사용 요청(community_meetings.status='pending') — 공간대관 탭 머리 ──
        // 모임장이 게더링이 막아 둔 시간을 골라 만든 모임. 수락 → /community-admin 이 status active + time_blocks, 거절 → rejected (anon UPDATE 회수 상태라 서버만 가능)
        function _cmMeetingSlots(m) { // meeting_time "10:00 ~ 13:00"(끝은 표시용 다음 슬롯) → [시작, 끝] 슬롯
            const mm = String(m.meeting_time || '').match(/(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/); if (!mm) return null;
            const s = TIMES.indexOf(mm[1]); const e = mm[2] === '23:00' ? TIMES.length - 1 : TIMES.indexOf(mm[2]) - 1;
            return s < 0 || e < s ? null : [s, e];
        }
        function _cmReqBlocks(m, blocks) { // 요청 모임과 겹치는 차단 사유 목록
            const r = _cmMeetingSlots(m); if (!r || !m.meeting_date) return [];
            const dow = new Date(m.meeting_date + 'T00:00:00').getDay();
            return (blocks || []).filter(b => b.day_of_week === dow && !(b.start_date && m.meeting_date < b.start_date) && !(b.end_date && m.meeting_date > b.end_date))
                .filter(b => { const bs = TIMES.indexOf(b.start_time), be = TIMES.indexOf(b.end_time); return r[0] <= be && r[1] >= bs; })
                .map(b => `${b.start_time}~${TIMES[TIMES.indexOf(b.end_time) + 1] || '23:00'}${b.reason ? ' · ' + b.reason : ''}`);
        }
        async function _cmReqSectionHTML() {
            let rows = [], err = null;
            try {
                const r = await supabaseClient.from('community_meetings')
                    .select('id,title,meeting_date,meeting_time,organizer_name,organizer_phone,organizer_email,capacity,fee,created_at,status')
                    .eq('status', 'pending').order('created_at', { ascending: false });
                if (r.error) err = r.error; else rows = (r.data || []).filter(m => m.status === 'pending');
            } catch (e) { err = e; }
            state.cmReqItems = rows;
            let html = `<div class="admin-section-title">🙋 커뮤니티 모임 시간 요청 (${rows.length}건)</div>`;
            const note = (t) => `<p style="font-size:0.8rem;color:var(--wds-gray-500);padding:2px 0 14px;line-height:1.6">${t}</p>`;
            if (err) {
                console.error('community pending fetch:', err);
                return html + note('요청 목록을 불러오지 못했습니다. status 컬럼이 없다면 supabase/migrations/20261013_community_meeting_status.sql 을 실행하세요.');
            }
            if (!rows.length) return html + note('대기 중인 요청이 없습니다. 모임장이 게더링이 막아 둔 시간을 고르면 여기에 뜹니다.');
            let blocks = [];
            try { blocks = (await supabaseClient.from('time_blocks').select('*')).data || []; } catch (_) {}
            return html + rows.map(m => {
                const phone = String(m.organizer_phone || '').replace(/\D/g, '');
                const cd = new Date(m.created_at);
                const created = isNaN(cd) ? '' : `${cd.getMonth() + 1}/${cd.getDate()} ${String(cd.getHours()).padStart(2, '0')}:${String(cd.getMinutes()).padStart(2, '0')} 접수`;
                const wd = m.meeting_date ? ['일', '월', '화', '수', '목', '금', '토'][new Date(m.meeting_date + 'T00:00:00').getDay()] : '';
                const blk = _cmReqBlocks(m, blocks);
                return `<div class="perf-admin-card pending" id="cmreq-${m.id}">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <span class="status-badge status-pending sm">⏳ 수락 대기</span>
                        <span style="font-size:0.9rem;font-weight:700">${escapeHtml(m.title || '')}</span>
                        <span style="margin-left:auto;font-size:0.72rem;color:var(--wds-gray-500)">${created}</span>
                    </div>
                    <div class="perf-admin-card-info" style="margin-top:8px">
                        📅 ${escapeHtml(m.meeting_date || '날짜 미정')}${wd ? `(${wd})` : ''} ${escapeHtml(m.meeting_time || '')}<br>
                        🚫 차단: ${blk.length ? blk.map(escapeHtml).join(', ') : '겹치는 차단 정보를 찾지 못함'}<br>
                        👤 ${escapeHtml(m.organizer_name || '')} · 📞 ${phone ? `<a href="tel:${phone}" style="color:inherit">${escapeHtml(m.organizer_phone)}</a>` : '-'}${m.organizer_email ? ` · ✉️ ${escapeHtml(m.organizer_email)}` : ''}<br>
                        👥 정원 ${m.capacity || '-'}명 · 💰 ${escapeHtml(m.fee || '무료')}
                    </div>
                    <div style="display:flex;gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="reviewCommunityMeeting('${m.id}', 'approved')">수락</button>
                        <button class="gaa-btn gaa-btn-sm gaa-btn-danger" onclick="reviewCommunityMeeting('${m.id}', 'rejected')">거절</button>
                        <span style="margin-left:auto;font-size:0.72rem;color:var(--wds-gray-500)">수락하면 목록 공개 + 시간표 반영</span>
                    </div>
                </div>`;
            }).join('');
        }
        // 서버(/community-admin 등)에 보낼 관리자 인증 — 카카오 토큰(메모리) → Supabase 세션 → 카카오 캐시 세션이면 팝업으로 토큰 재발급
        async function _adminApiAuth() {
            try { const kt = typeof Kakao !== 'undefined' && Kakao.Auth && Kakao.Auth.getAccessToken && Kakao.Auth.getAccessToken(); if (kt) return { kakao_token: kt }; } catch (_) {}
            try { const { data } = await supabaseClient.auth.getSession(); if (data && data.session && data.session.access_token) return { sb_token: data.session.access_token }; } catch (_) {}
            if (typeof Kakao === 'undefined' || !Kakao.Auth || !Kakao.Auth.login) return null;
            return new Promise(resolve => {
                try {
                    if (!Kakao.isInitialized()) initKakao();
                    Kakao.Auth.login({ success: a => resolve(a && a.access_token ? { kakao_token: a.access_token } : null), fail: () => resolve(null) });
                } catch (_) { resolve(null); }
            });
        }
        async function reviewCommunityMeeting(id, decision) {
            const m = (state.cmReqItems || []).find(x => x.id === id);
            const approve = decision === 'approved';
            if (!confirm(`"${m ? m.title : '모임'}" 요청을 ${approve ? '수락' : '거절'}할까요?\n${approve ? '수락하면 모임이 커뮤니티 목록에 공개되고 시간표에 잡힙니다.' : '거절하면 모임은 공개되지 않습니다.'}\n결과는 모임장 이메일로 안내됩니다.`)) return;
            const auth = await _adminApiAuth();
            if (!auth) { showToast('관리자 인증 정보를 가져오지 못했습니다. 다시 로그인한 뒤 시도해주세요.'); return; }
            try {
                const r = await fetch('/community-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'review_meeting', meeting_id: id, decision, ...auth }) });
                const j = await r.json().catch(() => ({}));
                if (!r.ok || !j.ok) { console.error('[community-admin]', r.status, j); showToast(j.message || '처리하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                showToast(approve ? `모임을 수락했습니다. 커뮤니티에 공개됩니다.${j.time_block ? '' : ' (시간표 반영은 실패 — 차단 탭에서 직접 추가)'}` : '요청을 거절했습니다.');
            } catch (e) { console.error(e); showToast('처리하지 못했습니다. 네트워크를 확인해주세요.'); return; }
            await fetchReservations();
            state.adminTab = 'perfbooking'; renderGatheOAdmin();
        }

        async function approvePerfBooking(id) {
            const b = (state.perfAdminItems || []).find(x => x.id === id);
            const msg = !b ? '승인하시겠습니까?'
                : b.status === 'rejected' ? '거절했던 예약입니다.\n승인(복구)하면 바로 예약 확정 상태가 됩니다. 진행할까요?'
                : b.status === 'cancelled' ? '예약자가 취소한 예약입니다.\n승인(복구)하면 바로 예약 확정 상태가 됩니다. 진행할까요?'
                : (b.status === 'expired' || _pbExpired(b)) ? '신청 후 4시간이 지나 자동 취소된 예약입니다.\n입금이 확인되었다면 승인(복구)할 수 있습니다. 진행할까요?'
                : '승인하시겠습니까?';
            if (!confirm(msg)) return;
            // 겹침 검사 — 특히 거절·취소·만료 건은 닫혀 있던 동안 같은 시간대가 새로 예약됐을 수 있다
            if (b) try {
                const [resCheck, pbCheck] = await Promise.all([
                    supabaseClient.from('reservations').select('start_time,end_time')
                        .eq('res_date', b.date).neq('status','rejected').neq('status','cancelled'),
                    supabaseClient.from('performance_bookings').select('id,start_time,end_time,status,created_at')
                        .eq('date', b.date).not('status','in','("rejected","expired","cancelled")')
                ]);
                const sIdx = TIMES.indexOf(b.start_time), eIdx = TIMES.indexOf(b.end_time);
                const conflict = [...(resCheck.data||[]), ...(pbCheck.data||[]).filter(x => x.id !== id && !_pbExpired(x))].some(c => {
                    const cs = TIMES.indexOf(c.start_time), ce = TIMES.indexOf(c.end_time);
                    return sIdx <= ce && eIdx >= cs;
                });
                if (conflict && !confirm('해당 시간대에 겹치는 예약/대관이 있습니다.\n그래도 승인할까요?')) return;
            } catch (_) { /* 검사 실패 시에도 총괄 판단으로 승인은 진행 */ }
            const { error } = await supabaseClient.from('performance_bookings').update({ status: 'approved' }).eq('id', id);
            if (error) { showToast('오류: ' + error.message); return; }
            await fetchReservations();
            state.adminTab = 'perfbooking'; renderGatheOAdmin();
        }

        async function rejectPerfBooking(id) {
            if (!confirm('거절하시겠습니까?')) return;
            const { error } = await supabaseClient.from('performance_bookings').update({ status: 'rejected' }).eq('id', id);
            if (error) { showToast('오류: ' + error.message); return; }
            await fetchReservations();
            state.adminTab = 'perfbooking'; renderGatheOAdmin();
        }

        // 공간 대관 시간·인원 인라인 수정 — 운영 총괄 전용
        function editPerfBooking(id) {
            if (!isSuper()) { showToast('운영 총괄만 수정할 수 있습니다.'); return; }
            const b = (state.perfAdminItems || []).find(x => x.id === id);
            const card = document.getElementById(`perf-card-${id}`);
            if (!b || !card) return;
            const selStart = TIMES.map(t => `<option value="${t}"${t===b.start_time?' selected':''}>${t}</option>`).join('');
            const selEnd   = TIMES.map((t, i) => `<option value="${t}"${t===b.end_time?' selected':''}>${TIMES[i+1]||'23:00'}</option>`).join('');
            const hasTbd = (b.purpose || '').includes(PERF_AUDIENCE_TBD_MARK);
            card.innerHTML = `
                <div class="perf-admin-card-title">✏️ ${escapeHtml(b.name)} — 시간·인원 수정</div>
                <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                        <input id="pe-date-${id}" type="date" value="${b.date}" style="height:34px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:6px;font-size:0.84rem;font-family:inherit">
                        <select id="pe-st-${id}" style="height:34px;padding:0 6px;border:1px solid var(--wds-gray-300);border-radius:6px;font-size:0.84rem;font-family:inherit">${selStart}</select>
                        <span style="font-size:0.82rem">~</span>
                        <select id="pe-et-${id}" style="height:34px;padding:0 6px;border:1px solid var(--wds-gray-300);border-radius:6px;font-size:0.84rem;font-family:inherit">${selEnd}</select>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                        <span style="font-size:0.8rem;color:var(--wds-gray-700)">인원</span>
                        <input id="pe-hc-${id}" type="number" min="1" max="50" value="${b.headcount}" style="width:66px;height:34px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:6px;font-size:0.84rem;font-family:inherit">
                        <span style="font-size:0.8rem;color:var(--wds-gray-700)">명</span>
                        <span id="pe-fee-${id}" style="font-size:0.8rem;font-weight:700;color:var(--wds-primary);margin-left:6px"></span>
                    </div>
                    ${hasTbd ? `<label style="display:flex;align-items:center;gap:7px;font-size:0.8rem;color:var(--wds-gray-700);cursor:pointer">
                        <input type="checkbox" id="pe-cleartbd-${id}" style="width:16px;height:16px;cursor:pointer">
                        최종 인원 확정 — '관람객 미정' 표시 제거</label>` : ''}
                    <div style="display:flex;gap:6px">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="savePerfEdit('${id}')">저장</button>
                        <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" type="button" onclick="renderGatheOAdmin()">취소</button>
                    </div>
                </div>`;
            // 입력 변경 시 예상 금액 미리보기
            const updFee = () => {
                const d = document.getElementById(`pe-date-${id}`)?.value;
                const s = TIMES.indexOf(document.getElementById(`pe-st-${id}`)?.value);
                const e = TIMES.indexOf(document.getElementById(`pe-et-${id}`)?.value);
                const h = parseInt(document.getElementById(`pe-hc-${id}`)?.value) || 1;
                const feeEl = document.getElementById(`pe-fee-${id}`);
                if (feeEl && d && s >= 0 && e >= 0 && s <= e) feeEl.textContent = `예상 ${calcPerformanceFee(d, s, e, h).toLocaleString()}원`;
            };
            ['pe-date-', 'pe-st-', 'pe-et-', 'pe-hc-'].forEach(p => document.getElementById(p + id)?.addEventListener('input', updFee));
            updFee();
        }

        async function savePerfEdit(id) {
            if (!isSuper()) { showToast('운영 총괄만 수정할 수 있습니다.'); return; }
            const b = (state.perfAdminItems || []).find(x => x.id === id);
            const date = document.getElementById(`pe-date-${id}`)?.value;
            const startTime = document.getElementById(`pe-st-${id}`)?.value;
            const endTime = document.getElementById(`pe-et-${id}`)?.value;
            const headcount = parseInt(document.getElementById(`pe-hc-${id}`)?.value);
            const clearTbd = document.getElementById(`pe-cleartbd-${id}`)?.checked;
            if (!date || !startTime || !endTime) { showToast('날짜와 시간을 입력해주세요.'); return; }
            if (TIMES.indexOf(startTime) > TIMES.indexOf(endTime)) { showToast('종료 시간은 시작 시간보다 이후여야 합니다.'); return; }
            if (!headcount || headcount < 1) { showToast('인원을 1명 이상 입력해주세요.'); return; }
            // 겹침 검사 (자기 자신 제외) — 총괄 판단으로 강행 가능
            try {
                const [resCheck, pbCheck] = await Promise.all([
                    supabaseClient.from('reservations').select('start_time,end_time')
                        .eq('res_date', date).neq('status','rejected').neq('status','cancelled'),
                    supabaseClient.from('performance_bookings').select('id,start_time,end_time,status,created_at')
                        .eq('date', date).not('status','in','("rejected","expired","cancelled")')
                ]);
                const sIdx = TIMES.indexOf(startTime), eIdx = TIMES.indexOf(endTime);
                const conflict = [...(resCheck.data||[]), ...(pbCheck.data||[]).filter(x => x.id !== id && !_pbExpired(x))].some(c => {
                    const cs = TIMES.indexOf(c.start_time), ce = TIMES.indexOf(c.end_time);
                    return sIdx <= ce && eIdx >= cs;
                });
                if (conflict && !confirm('해당 시간대에 겹치는 예약/대관이 있습니다.\n그래도 저장할까요?')) return;
            } catch (_) { /* 검사 실패 시에도 총괄 수정은 진행 */ }
            const payload = { date, start_time: startTime, end_time: endTime, headcount };
            if (clearTbd && b) payload.purpose = (b.purpose || '').replace(PERF_AUDIENCE_TBD_MARK, '').trim();
            const { error } = await supabaseClient.from('performance_bookings').update(payload).eq('id', id);
            if (error) { showToast('저장 실패: ' + error.message); return; }
            showToast('대관 정보가 수정되었습니다.');
            await fetchReservations();   // GatheO 달력의 가상 행도 갱신
            renderGatheOAdmin();
        }

        async function cancelPerfReservation(id) {
            if (!confirm('예약을 취소하시겠습니까?')) return;
            const { error } = await supabaseClient.from('performance_bookings').update({ status: 'rejected' }).eq('id', id);
            if (error) { showToast('취소 오류: ' + error.message); return; }
            await fetchReservations();
            if (state.adminTab === 'perfbooking') renderGatheOAdmin();
        }

        async function deletePerfBooking(id) {
            if (!confirm('이 신청 내역을 영구적으로 삭제하시겠습니까?')) return;
            const { error } = await supabaseClient.from('performance_bookings').delete().eq('id', id);
            if (error) { showToast('삭제 오류: ' + error.message); return; }
            await fetchReservations();
            state.adminTab = 'perfbooking'; renderGatheOAdmin();
        }
