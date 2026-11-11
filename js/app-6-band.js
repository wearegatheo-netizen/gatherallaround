// 게더 올 어라운드 본 스크립트 6/8 (band) — index.html 이 번호 순서대로 읽는 클래식 스크립트. 전역(함수·let/const)을 서로 공유한다.
// 고친 뒤에는 node tools/stamp-assets.mjs 로 index.html 의 ?v= 를 갱신할 것(tests/assets-unit.mjs 가 검사).

        function darkenColor(hex, amount) {
            const h = hex.replace('#','');
            const num = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
            const r = Math.max(0, (num>>16) - Math.round(255*amount));
            const g = Math.max(0, ((num>>8)&0xff) - Math.round(255*amount));
            const b = Math.max(0, (num&0xff) - Math.round(255*amount));
            return `rgb(${r},${g},${b})`;
        }

        // ─────────────────────────────────────────────────────────────────────

        // Band section form helpers
        // 합주팀 랜딩 4화면: 메뉴(#band-menu: 시간표 보기·가입 신청·로그인) / 로그인 / 고정 가능 시간(#band-schedule-view, 설명 포함) / 가입 폼 — 2026-11-05
        function _bandLandingShow(which) {
            ['band-menu', 'band-login-form', 'band-schedule-view', 'band-signup-form'].forEach(id => document.getElementById(id)?.classList.toggle('hidden', id !== which));
            const r1 = document.getElementById('bandLoginResult'); if (r1) r1.textContent = '';
            const r2 = document.getElementById('bandSignupResult'); if (r2) r2.textContent = '';
            try { if (which !== 'band-menu') document.getElementById('landing-page-band')?.scrollIntoView({ block: 'start' }); } catch (_) {}
        }
        function showBandMenu() {
            _bandLandingShow('band-menu');
            bandLandingFacts();
            bandLandingPreview().catch(e => console.error('band landing preview:', e));
        }
        // 랜딩 사실 타일·바닥 연락처 — 숫자는 상수에서(TIMES·BAND_CABINET_FREE_MONTHS·PORTAL_PHONE·PORTAL_INSTAGRAM_URL)
        function bandLandingFacts() {
            const h = document.getElementById('bandHeroHours'); if (h) h.textContent = `${BAND_OPEN_TIME}~${String(parseInt(TIMES[TIMES.length - 1], 10) + 1).padStart(2, '0')}:00`;
            const c = document.getElementById('bandHeroCabinet'); if (c && typeof BAND_CABINET_FREE_MONTHS !== 'undefined') c.textContent = `${BAND_CABINET_FREE_MONTHS}개월 이상 무료`;
            const f = document.getElementById('bandHeroFoot');
            if (f) f.innerHTML = `<span>문의 <a href="tel:${escAttr(PORTAL_PHONE.replace(/-/g, ''))}">${escHtml(PORTAL_PHONE)}</a></span>${PORTAL_INSTAGRAM_URL ? `<a href="${escAttr(PORTAL_INSTAGRAM_URL)}" target="_blank" rel="noopener">@${escHtml(PORTAL_INSTAGRAM_URL.replace(/\/+$/, '').split('/').pop())}</a>` : ''}`;
        }
        // 랜딩 「지금 신청할 수 있는 타임」: 시간표 화면과 같은 엔진(bandAvailLoad + bandDefStatus)으로 가능 → 건너뛰기 조건 → 날짜 지정 순 3개 — 표가 없거나 실패하면 숨김
        let _bandLandingPreviewSeq = 0;
        async function bandLandingPreview() {
            const box = document.getElementById('bandLandingPreview');
            if (!box) return;
            if (!supabaseClient) { box.hidden = true; return; }
            const seq = ++_bandLandingPreviewSeq;
            try {
                const start = bandWishStart();
                const ctx = await bandAvailLoad(start, bandAvailDaysFor(start, bandWishMonths()));
                if (seq !== _bandLandingPreviewSeq) return;
                if (_bandSlotsUnavailable || !ctx || !ctx.defs || !ctx.defs.length) { box.hidden = true; return; }
                const rows = ctx.defs.map(def => ({ def, st: bandDefStatus(def, ctx) }));
                const rank = { ok: 0, skip: 1, later: 2 };
                const top = rows.filter(r => r.st.kind in rank)
                    .sort((a, b) => rank[a.st.kind] - rank[b.st.kind] || a.def.day_of_week - b.def.day_of_week || String(a.def.start_time).localeCompare(String(b.def.start_time)))
                    .slice(0, 3);
                const cnt = (k) => rows.filter(r => r.st.kind === k).length;
                const sub = document.getElementById('bandLandingPreviewSub');
                if (sub) sub.textContent = `${_bandMDW(ctx.startDate)} 시작 · ${bandWishMonths()}개월 기준 · 바로 가능 ${cnt('ok')}개`;
                const list = document.getElementById('bandLandingPreviewList');
                const chip = { ok: ['status-approved', '가능'], skip: ['status-pending', '조건부'], later: ['status-info', '개방 예정'] };
                const line = (r) => r.st.kind === 'ok' ? ''
                    : r.st.kind === 'skip' ? `${r.st.skips.length}주 건너뛰기 조건 · ${bandMD(r.st.skips[0].date)}${r.st.skips.length > 1 ? ' 외' : ''}`
                    : `${bandMD(r.st.from)}부터 개방`;
                if (list) list.innerHTML = top.length ? top.map(r => `<button type="button" class="band-hero-row" onclick="showBandScheduleView()">
                        <span class="dow${r.def.day_of_week === 6 ? ' sat' : r.def.day_of_week === 0 ? ' sun' : ''}">${BAND_DOW[r.def.day_of_week]}</span>
                        <span class="tx"><b>${_bandRangeText(r.def.start_time, r.def.end_time)} <em>${escHtml(r.def.label || _bandLabelOf(r.def.start_time))}</em></b>${line(r) ? `<small>${escHtml(line(r))}</small>` : ''}</span>
                        <span class="status-badge sm ${chip[r.st.kind][0]}">${chip[r.st.kind][1]}</span></button>`).join('')
                    : _bandEmptyHTML('지금은 바로 신청할 수 있는 타임이 없어요. 전체 표에서 대기 중인 타임을 확인해보세요.');
                box.hidden = false;
            } catch (e) { console.error('band landing preview:', e); if (seq === _bandLandingPreviewSeq) box.hidden = true; }
        }
        // ── 운영 안내(2026-11-07): 가입한 팀 대상 — 팀 화면 [운영 안내] 탭 + 딥링크 #band/guide(/band/guide, 비로그인은 로그인 폼 → 로그인 뒤 안내 탭). 숫자·계좌·연락처는 코드 상수(문자·화면과 동일)
        function bandGuideHTML() {
            const sec = (icon, title, body, open) => `<details class="band-guide-sec"${open ? ' open' : ''}><summary><span class="ic">${icon}</span><span>${title}</span><span class="ar">›</span></summary><div class="band-guide-body">${body}</div></details>`;
            const ul = (...items) => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
            const ol = (...items) => `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`;
            const note = (t) => `<div class="band-guide-note">${t}</div>`;
            const first = BAND_OPEN_TIME, last = TIMES[TIMES.length - 1];
            const closeH = parseInt(last, 10) + 1;
            return `
                <div class="band-guide-head"><div class="band-guide-eyebrow">고정 합주팀</div><h2>운영 안내</h2><p>가입부터 회차·이용료, 캐비넷, 건너뛰기권까지 고정팀이 알아야 할 규칙을 모았어요. 문자와 화면 안내도 모두 이 규칙을 따릅니다.</p></div>
                ${sec('⏰', '이용 시간과 고정 타임', ul(
                    `합주실은 <strong>매일 ${first} ~ ${String(closeH).padStart(2, '0')}:00</strong> 운영하고, 고정팀은 <strong>매주 같은 요일·같은 시간</strong>을 4주 단위로 씁니다.`,
                    '요일마다 <strong>오전 · 주간 · 야간</strong> 띠가 있어요. 지금 신청할 수 있는 띠는 [고정 가능 시간 보기]에서 실시간으로 확인합니다(고정팀 사용 중 · 대관만 · 개방 예정 · 겹치는 주 표시).',
                    '고정 시간 변경·추가는 로그인 후 <strong>요청사항</strong>으로 남겨주시면 운영팀이 달력에 반영합니다.'), true)}
                ${sec('✍️', '등록 절차와 첫 회차', ol(
                    '[고정 가능 시간 보기]에서 희망 시작일·예상 사용 기간을 넣고 타임을 고른 뒤 <strong>가입 신청</strong>(팀 리더 이름·연락처, 밴드명, 비밀번호, 캐비넷 사용 여부)을 보냅니다.',
                    '접수되면 팀 리더 번호로 <strong>접수 확인 문자</strong>가 가고, 그 문자에 <strong>보증금(1개월분 = 4주 이용료)</strong> 입금 계좌가 있어요.',
                    '보증금 입금이 확인되면 운영팀이 일정을 확인해 승인하고 <strong>승인 안내 문자</strong>(고정 시간·시작일·이용료 안내)를 보내드립니다.',
                    '등록 회차 <strong>이용료는 시작일 전날까지</strong> 입금해주세요.') + note(`로그인 <strong>아이디는 밴드 영문명</strong>(영문·숫자만 소문자)으로 자동 지정되고, 비밀번호는 <strong>pw + 숫자 4자리</strong>예요. 이 숫자 4자리는 6개월 이상 사용·캐비넷 이용 시 등록 비밀번호가 됩니다.`))}
                ${sec('💰', '회차와 이용료', ul(
                    '한 회차는 <strong>시작일부터 4주(28일)</strong>입니다. 회차가 끝나기 전에 다음 회차 이용료를 입금하면 자동으로 연장돼요.',
                    `다음 회차 <strong>입금일은 사용 3주차</strong>(다음 시작 2주 전)이고, 그날 입금 안내 문자를 보내드립니다. 아직 입금 전이면 <strong>시작 1주 전</strong>과 <strong>시작 전날</strong>에 한 번씩 더 안내해요(회차당 최대 3회).`,
                    `입금 계좌: <strong>${BAND_BANK_LINE_UI}</strong>`,
                    '연장하지 않으실 때는 입금일 전에 요청사항이나 문자로 미리 알려주세요. 보증금은 사용 종료 시 반환됩니다.') + note('이용료·보증금 금액과 납부 내역은 로그인 후 「회차·입금 안내」 카드에서 확인할 수 있어요. 내역이 다르면 요청사항으로 알려주세요.'))}
                ${sec('🗄️', '캐비넷', ul(
                    `예상 사용 기간 <strong>${BAND_CABINET_FREE_MONTHS}개월 이상</strong> 팀은 <strong>무료</strong>, 그 미만은 <strong>회차당 ${(BAND_CABINET_FEE / 10000)}만원</strong>(이용료와 함께 입금)입니다.`,
                    '가입 때 정한 <strong>숫자 4자리</strong>가 캐비넷 비밀번호로 등록됩니다.',
                    '가입 때 「사용함/사용 안 함」을 고르고, 이후 신청·해지는 요청사항으로 알려주세요.'))}
                ${sec('🔁', '건너뛰기권과 대체 합주', ul(
                    '공연·공간 대관 등으로 고정 시간을 쓸 수 없는 주가 생기면 <strong>건너뛰기권</strong>을 드립니다(가입 때 겹치는 주는 자동 발급, 이후 생기는 주는 운영팀이 미리 안내).',
                    `건너뛰기권마다 <strong>대체 합주</strong>(건너뛰는 날 앞뒤 1주일 안, 원래 고정 사용 시간과 같은 시간, 비어 있는 시간) 또는 <strong>1주 무료 연장</strong>(회차 종료일과 다음 입금일이 1주 뒤로) 중 하나를 고릅니다.`,
                    `선택 마감은 <strong>건너뛰는 날 ${BAND_SKIP_DEADLINE_DAYS}일 전</strong>이고, 그때까지 고르지 않으면 1주 연장으로 처리돼요. 한 번 정하면 바꿀 수 없습니다.`,
                    `<strong>팀 사정</strong>으로 일정이 어려운 날이 생기면 <strong>이용 기간 중 1회</strong>, 건너뛸 날 ${BAND_TEAM_SUB_MIN_DAYS}일 전까지 같은 조건(앞뒤 1주일 안 빈 시간, 같은 사용 시간)의 대체 합주를 직접 요청할 수 있어요. 이 요청은 1주 연장으로 바꿀 수 없어요.`,
                    '로그인 후 「합주 시간·건너뛰기권」 카드에서 권 목록·요청 버튼을 볼 수 있어요.'))}
                ${sec('📱', '안내 문자와 연락', ul(
                    '문자 안내: 가입 접수 확인 → 승인(또는 거절) 안내 → 회차마다 입금 안내(입금일 정오 무렵).',
                    `장비·시설·일정 요청은 로그인 후 <strong>요청사항</strong>에 남겨주세요. 급한 연락은 <strong>${PORTAL_PHONE}</strong>(전화·문자)로.`,
                    '공지사항 카드에 운영 공지가 올라오니 가끔 확인해주세요.'))}
                ${sec('👋', '종료와 복귀', ul(
                    '사용을 마치려면 종료 예정일을 미리 알려주세요. 그날까지 사용한 뒤 보증금을 돌려드립니다.',
                    '쉬었다가 다시 시작할 때는 운영팀에 알려주세요. 이전 기록을 확인해 이어드립니다.'))}`;
        }
        const BAND_BANK_LINE_UI = GAA_RULES.BANK_LINE; // /shared/rules.js — 문자(send-sms·send-reminders)와 같은 값
        // 비로그인으로 #band/guide 에 오면 로그인 폼으로 — 로그인(loginBandUI)이 끝나면 안내 탭을 연다
        function showBandGuideView() {
            if (state.bandProfile) { loginBandUI(state.bandProfile); setTimeout(() => bandPageTab('guide'), 0); return; }
            state._bandAfterLogin = 'guide';
            showBandLoginForm();
            const r = document.getElementById('bandLoginResult'); if (r) { r.textContent = '운영 안내는 가입한 팀만 볼 수 있어요. 로그인해주세요.'; r.style.color = ''; }
        }
        // 팀 화면 탭: 'home' = 기존 카드 전부 / 'guide' = 운영 안내 카드만
        // 팀 화면 뷰(2026-11-08): home(요약 타일·밴드 정보·회차·합주 시간·목록) | guide(운영 안내) | notice·teams·members·comments(하위 화면 — [‹ 내 팀] 머리)
        // 카드는 data-view(없으면 home)로 구분해 hidden 속성만 토글한다 — .hidden 클래스(관리자 팀·내용 없음)는 그대로.
        const BAND_PAGE_VIEWS = { home: '내 팀', guide: '운영 안내', notice: '공지사항', teams: '고정팀 목록', members: '팀원', comments: '요청사항' };
        function bandPageTab(tab) {
            if (!(tab in BAND_PAGE_VIEWS)) tab = 'home';
            const guide = tab === 'guide';
            const sec = document.getElementById('bandGuideSection');
            if (sec && guide && !sec.innerHTML) sec.innerHTML = bandGuideHTML();
            document.querySelectorAll('.band-page > .band-section-card').forEach(el => { el.hidden = (el.dataset.view || 'home') !== tab; });
            const sub = !guide && tab !== 'home';
            const seg = document.getElementById('bandPageTabs'); if (seg) seg.hidden = sub;
            const top = document.getElementById('bandSubTop'); if (top) top.hidden = !sub;
            const title = document.getElementById('bandSubTitle'); if (title) title.textContent = sub ? BAND_PAGE_VIEWS[tab] : '';
            document.querySelectorAll('#bandPageTabs button').forEach((b, i) => b.classList.toggle('on', (i === 1) === guide));
            state.bandPageView = tab;
            if (tab !== 'home') { try { const el = document.querySelector('.band-page'); if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 60), behavior: 'smooth' }); } catch (_) {} }
        }
        // 하위 화면 목록 줄의 작은 글씨(건수)
        function _bandNavCount(id, text) { const el = document.getElementById(id); if (el) el.textContent = text || ''; }
        function showBandLoginForm() { _bandLandingShow('band-login-form'); }
        function showBandScheduleView() {
            _bandLandingShow('band-schedule-view');
            bandSignupAvailInit().catch(e => console.error('band schedule view:', e));
        }
        function showBandSignupForm() {
            _bandLandingShow('band-signup-form');
            bandSignupAvailInit().then(() => { bandSignupCabinetNote(); bandSignupDepositNote(); }).catch(e => console.error('band signup avail:', e)); // 표가 없으면(마이그레이션 전·띠 0개) 종전 체크박스 폴백
        }

        const BAND_ID_DOMAIN = '@band.gatheo.kr';
        function bandIdToEmail(id) { return id.toLowerCase() + BAND_ID_DOMAIN; }
        // 로그인 아이디 = 밴드 영문명(2026-11-05): 영문·숫자만 소문자로 남기고 20자까지. 로그인 입력도 같은 정리를 거쳐 「New Team」 처럼 적어도 통한다.
        const bandIdFromName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
        function bandSignupIdPreview() {
            const el = document.getElementById('bandSignupIdPreview'); if (!el) return;
            const id = bandIdFromName((document.getElementById('bandSignupNameEn') || {}).value);
            el.textContent = id || '—';
        }
        // 합주팀 비밀번호 규칙(2026-11-05): 항상 'pw' + 숫자 4자리. 숫자 4자리는 6개월 이상 사용·캐비넷 이용 시 등록 비밀번호가 된다.
        const BAND_PW_RE = /^pw\d{4}$/;
        const _bandNormalizePw = (p) => (/^\d{4}$/.test(p) ? 'pw' + p : /^pw\d{4}$/i.test(p) ? 'pw' + p.slice(2) : p);

        let _bandLoginBusy = false;
        async function handleBandEmailLogin() {
            if (_bandLoginBusy) return;
            const rawId = bandIdFromName(document.getElementById('bandLoginId').value); // 밴드 영문명 그대로 적어도 되게 같은 정리(영문·숫자 소문자)
            const password = document.getElementById('bandLoginPassword').value;
            const res = document.getElementById('bandLoginResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (!rawId || !password) { showErr('아이디(밴드 영문명)와 비밀번호를 입력해주세요.'); return; }
            if (!supabaseClient) { showErr('서비스 연결 오류입니다.'); return; }
            _bandLoginBusy = true;
            const btn = document.querySelector('#band-login-form .email-primary-btn');
            const orig = btn ? btn.textContent : '';
            if (btn) { btn.disabled = true; btn.textContent = '로그인 중...'; }
            try {
                const email = bandIdToEmail(rawId);
                let { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) { // 비밀번호 규칙(pw+숫자 4자리)대로 정규화해 한 번 더 — 숫자만 쳤거나 PW 를 대문자로 친 경우
                    const alt = _bandNormalizePw(password);
                    if (alt !== password) ({ data, error } = await supabaseClient.auth.signInWithPassword({ email, password: alt }));
                }
                if (error) { showErr('로그인 실패: 아이디 또는 비밀번호를 확인해주세요.'); return; }
                if (data?.user) { await checkEmailUserApproval(data.user); }
            } finally {
                _bandLoginBusy = false;
                if (btn) { btn.disabled = false; btn.textContent = orig; }
            }
        }

        let _bandSignupBusy = false;
        async function handleBandEmailSignup() {
            if (_bandSignupBusy) return;
            const leaderName = document.getElementById('bandSignupLeaderName').value.trim();
            const leaderPhone = document.getElementById('bandSignupLeaderPhone').value.trim();
            const bandNameKr = document.getElementById('bandSignupNameKr').value.trim();
            const bandNameEn = document.getElementById('bandSignupNameEn').value.trim();
            const rawId = bandIdFromName(bandNameEn); // 아이디 = 밴드 영문명(영문·숫자만 소문자)
            const pwDigits = (document.getElementById('bandSignupPwDigits').value || '').trim();
            const pwDigits2 = (document.getElementById('bandSignupPwDigitsConfirm').value || '').trim();
            const password = 'pw' + pwDigits; // 규칙: pw + 숫자 4자리
            const consent = document.getElementById('bandPrivacyConsent').checked;
            const cabinetEl = document.querySelector('input[name="bandSignupCabinet"]:checked');
            const cabinet = cabinetEl ? cabinetEl.value === '1' : null; // 캐비넷 사용 여부(필수)
            // 실시간 타임표(새)에서 고른 띠 → timeslots(종전 표기 월_야간)·band_slot_claims. 표가 없으면 종전 체크박스 값.
            const picked = bandSignupSelection();
            const timeslots = picked ? picked.defs.map(bandSlotLegacyKey) : Array.from(document.querySelectorAll('.band-timeslot-checkbox:checked')).map(cb => cb.value);
            const res = document.getElementById('bandSignupResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';

            if (!leaderName || !leaderPhone || !bandNameKr || !bandNameEn || !pwDigits) { showErr('모든 항목을 입력해주세요.'); return; }
            if (rawId.length < 4) { showErr(`밴드 영문명에 영문·숫자가 4자 이상 있어야 해요. (아이디 「${rawId || '—'}」가 너무 짧아요)`); return; }
            if (picked) {
                if (!picked.defs.length) { showErr('합주 타임을 1개 이상 선택해주세요. (표에서 「가능」·「N주 건너뛰기」 칩을 누르면 선택돼요)'); return; }
                if (!/^\d{4}-\d{2}-\d{2}$/.test(picked.start) || picked.start < bandTodayStr()) { showErr('희망 시작일을 오늘 이후로 선택해주세요.'); return; }
            }
            if (!/^010-\d{4}-\d{4}$/.test(leaderPhone) && !/^01[0-9]{8,9}$/.test(leaderPhone.replace(/-/g,''))) { showErr('올바른 전화번호를 입력해주세요.'); return; }
            if (!/^\d{4}$/.test(pwDigits) || !BAND_PW_RE.test(password)) { showErr('비밀번호는 pw 뒤에 숫자 4자리로 정해주세요. (예: pw1234)'); return; }
            if (pwDigits !== pwDigits2) { showErr('비밀번호 확인의 숫자 4자리가 일치하지 않습니다.'); return; }
            if (cabinet === null) { showErr('캐비넷 사용 여부를 선택해주세요.'); return; }
            if (!consent) { showErr('개인정보 수집·이용에 동의해주세요.'); return; }
            if (!supabaseClient) { showErr('서비스 연결 오류입니다.'); return; }

            _bandSignupBusy = true;
            const submitBtn = document.querySelector('button[onclick="handleBandEmailSignup()"]');
            const origLabel = submitBtn ? submitBtn.textContent : '';
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '처리 중...'; }
            try {
                // 같은 아이디(영문명)가 이미 있으면 숫자를 붙여 그대로 접수한다(vandor → vandor2…). 신청 팀에게 기존 가입 여부를 알리거나 판단하게 하지 않고,
                // 운영자가 가입 신청 카드의 「복귀 팀 가능성」(리더 연락처·이름 일치)을 보고 이전 기록을 이어 적용한다(bandAdoptPrevious).
                let loginId = rawId, res = await supabaseClient.auth.signUp({ email: bandIdToEmail(loginId), password });
                for (let n = 2; res.error && /already|exist|registered/i.test(res.error.message || '') && n <= 9; n++) {
                    loginId = rawId.slice(0, 19) + n;
                    res = await supabaseClient.auth.signUp({ email: bandIdToEmail(loginId), password });
                }
                const { data, error } = res;
                if (error) { showErr('가입 신청 실패: ' + error.message); return; }
                if (data?.user) {
                    const meta = {
                        id: data.user.id,
                        name: leaderName,
                        phone: leaderPhone,
                        leader_name: leaderName,
                        leader_phone: leaderPhone,
                        band_name_kr: bandNameKr,
                        band_name_en: bandNameEn,
                        timeslots: timeslots,
                        member_type: 'band',
                        instruments: loginId,
                        status: 'pending',
                        role: '일반',
                        band_cabinet: cabinet,
                    };
                    if (picked) { meta.band_start_date = picked.start; meta.band_expected_months = `${picked.months}개월`; } // 희망 시작일·예상 사용 기간(현황표 「등록 예정일·사용 개월수」, 승인 때 확정·겹침 계산 범위)
                    const signupFee = picked ? bandSignupFeeOf(picked.defs) : null; // 띠별 4주 이용료 합 → 이용료·보증금(1개월분) 미리 채움(접수 문자 금액·계약 정보 기본값, 운영자가 수정 가능)
                    if (signupFee) { meta.band_fee = signupFee; meta.band_deposit = signupFee; }
                    let { error: pErr } = await supabaseClient.from('profiles').upsert(meta, { onConflict: 'id' });
                    if (pErr && /band_cabinet/.test(pErr.message || '')) { // 마이그레이션(20261107_band_cabinet) 전 — 캐비넷 없이 저장(가입은 진행)
                        console.warn('profiles.band_cabinet 컬럼 없음 — 20261107_band_cabinet.sql 실행 필요');
                        delete meta.band_cabinet;
                        ({ error: pErr } = await supabaseClient.from('profiles').upsert(meta, { onConflict: 'id' }));
                    }
                    if (pErr) console.error('Band profile upsert error:', pErr);
                    // 비밀번호 숫자 4자리 → 운영자 전용 표(band_pins, 마이그레이션 20261105_band_pins.sql) — 캐비넷·6개월 이상 등록용. 표가 없어도 가입은 진행.
                    try { const { error: pinErr } = await supabaseClient.from('band_pins').upsert({ profile_id: data.user.id, pin: pwDigits }, { onConflict: 'profile_id' }); if (pinErr) console.error('band_pins upsert error:', pinErr); } catch (e) { console.error('band_pins:', e); }
                    if (picked && picked.defs.length) { // 타임 신청 행 — 승인 때 달력(time_blocks)에 반영된다
                        const { error: cErr } = await supabaseClient.from('band_slot_claims').insert(picked.defs.map(d => ({
                            profile_id: data.user.id, def_id: d.id, day_of_week: d.day_of_week, start_time: d.start_time, end_time: d.end_time, start_date: picked.start, status: 'pending' })));
                        if (cErr) console.error('band_slot_claims insert error:', cErr);
                    }
                    // 접수 확인 문자(팀 리더 번호) — /send-sms 가 서비스 롤로 대조·15분 안·band_sms_log 1회 선점. 실패해도 가입은 완료.
                    fetch('/send-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ band_signup_id: data.user.id }) }).catch(() => {});
                    // 관리자 푸시 — 일반 회원 가입·대관 신청과 같은 릴레이(/notify-admins) 경로. 실패해도 가입은 완료.
                    setTimeout(() => sendAdminPush('🎸 고정팀 가입 신청', `${bandNameKr} · ${leaderName} · ${bandSlotSheetText(timeslots)}${picked ? ' · ' + bandMD(picked.start) + ' 시작 희망 · ' + picked.months + '개월' : ''} · 캐비넷 ${cabinet ? '사용' : '미사용'}`).catch(() => {}), 400);
                }
                showToast(`가입 신청이 완료되었습니다! 로그인 아이디는 ${loginId} 입니다. 관리자 승인 후 이용 가능합니다.`, 5000);
                showBandLoginForm();
            } finally {
                _bandSignupBusy = false;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
            }
        }

        // --- 고정 합주팀 메인 ---
        // 게더링(관리자) 계정의 로그인 아이디. 밴드 계정은 로그인 id(rawId)가 auth 이메일 접두사이자
        // 프로필 instruments 에 저장되며 편집 불가 → 표시명(band_name_kr) 대신 이 값으로 관리자 판정.
        const GATHEO_ADMIN_BAND_ID = 'wearegatheo';
        function isBandAdmin() {
            const p = state.bandProfile;
            if (!p) return false;
            // 편집 불가한 로그인 아이디(instruments=rawId) 또는 이메일 접두사(<id>@band.gatheo.kr)로 판정.
            const loginId = String(p.instruments || '').trim().toLowerCase();
            const emailId = String(p.email || '').trim().toLowerCase().split('@')[0];
            return loginId === GATHEO_ADMIN_BAND_ID || emailId === GATHEO_ADMIN_BAND_ID;
        }

        function loginBandUI(profile) {
            if (state._bandAfterLogin === 'guide') { state._bandAfterLogin = null; bandPageTab('home'); setTimeout(() => bandPageTab('guide'), 0); } // #band/guide 로 와서 로그인한 경우
            else bandPageTab('home'); // 안내 탭·하위 화면에서 다시 들어오면 내 팀으로
            try { localStorage.removeItem('gaa_portal_required'); } catch(e) {} // 게더링 로그아웃 표식이 남아 있으면 합주팀 세션도 다음 부팅에서 지워진다
            // fullwidth-view: 본문 좌우 패딩 없이 페이지 배경을 화면 끝까지 (공연 예매·대관과 동일)
            document.body.classList.add('portal-view', 'fullwidth-view');
            _hideAllScreens();
            document.getElementById('band-main-content').classList.remove('hidden');
            state.bandProfile = profile;
            renderBandPage();
            _authResolved = true;
            applyPendingRoute();
        }

        async function handleBandLogout() {
            if (supabaseClient) { try { await supabaseClient.auth.signOut(); } catch(e) {} }
            state.bandProfile = null;
            state.bandNotices = [];
            state.bandMembers = [];
            state.bandComments = [];
            document.getElementById('band-main-content').classList.add('hidden');
            showPortal();
        }

        function renderBandPage() {
            const profile = state.bandProfile;
            if (!profile) return;
            const headerName = document.getElementById('bandHeaderName');
            if (headerName) headerName.innerHTML = _bandHeaderNameHTML(profile);
            ['bandNavNotice', 'bandNavTeams', 'bandNavMembers', 'bandNavComments'].forEach(id => _bandNavCount(id, ''));
            // 공지 추가 버튼: 게더링 팀(관리자)만 표시
            const noticeAddBtn = document.getElementById('bandNoticeAddBtn');
            if (noticeAddBtn) noticeAddBtn.style.display = isBandAdmin() ? '' : 'none';
            // 관리자 섹션: 게더링 팀만 표시
            const adminSec = document.getElementById('bandAdminSection');
            if (adminSec) adminSec.classList.toggle('hidden', !isBandAdmin());
            if (isBandAdmin()) {
                state.bandAdminTab = state.bandAdminTab || 'pending';
                renderBandAdminTab();
            }
            renderBandInfo(profile);
            renderBandCycleNotice(profile);
            renderBandSlotSection(profile).catch(e => console.error('band slot section:', e));
            fetchAndRenderBandNotices();
            fetchAndRenderBandTeamList();
            fetchAndRenderBandMembers();
            fetchAndRenderBandComments();
        }

        function setBandAdminTab(tab) {
            state.bandAdminTab = tab;
            document.querySelectorAll('#bandAdminSection .admin-subtab').forEach(el => {
                const on = el.dataset.tab === tab;
                el.classList.toggle('active', on);
                if (on && el.scrollIntoView) { try { el.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (_) {} }
            });
            renderBandAdminTab();
        }

        // 공용 빈 상태/로딩 문구 (합주팀 화면 전용 — 색·크기·여백 단일화)
        const _bandEmptyHTML = (msg) => `<div class="band-empty">${escHtml(msg)}</div>`;
        const _bandLoadingHTML = () => '<div class="band-empty">불러오는 중…</div>';
        // 관리자(게더링) 팀 여부 — 로그인 ID 또는 이메일 접두사 (isBandAdmin 과 같은 판정, 임의 프로필용)
        function _isAdminBandProfile(p) {
            if (!p) return false;
            const loginId = String(p.instruments || '').trim().toLowerCase();
            const emailId = String(p.email || '').trim().toLowerCase().split('@')[0];
            return loginId === GATHEO_ADMIN_BAND_ID || emailId === GATHEO_ADMIN_BAND_ID;
        }
        // 버튼 busy 상태 — 이중 제출 차단 (handleBandEmailSignup 과 같은 패턴)
        function _bandBusy(btn, on, label) {
            if (!btn) return;
            if (on) { btn.dataset.orig = btn.textContent; btn.disabled = true; btn.textContent = label || '처리 중…'; }
            else { btn.disabled = false; if (btn.dataset.orig) btn.textContent = btn.dataset.orig; }
        }
        // 합주 타임 표기 — 시트 스타일 "화,수 야간 · 일 주간"
        function bandSlotSheetText(slots) {
            const days = ['월','화','수','목','금','토','일'];
            const s = slots || [];
            return ['오전','주간','야간'].map(time => {
                const active = days.filter(d => s.includes(d + '_' + time));
                return active.length ? `${active.join(',')} ${time}` : null;
            }).filter(Boolean).join(' · ') || '미정';
        }

        async function renderBandAdminTab() {
            if (!isBandAdmin()) return;
            const view = document.getElementById('bandAdminView');
            if (!view) return;
            view.innerHTML = _bandLoadingHTML();
            const teams = await fetchBandProfiles();
            const tab = state.bandAdminTab || 'pending';
            const pendingCount = teams.filter(t => t.status === 'pending').length;
            const pendingTab = document.querySelector('#bandAdminSection .admin-subtab[data-tab="pending"]');
            if (pendingTab) pendingTab.textContent = pendingCount ? `가입 신청 (${pendingCount})` : '가입 신청';
            if (tab === 'test') { view.innerHTML = bandTestTabHTML(); return; }
            if (tab === 'slots') { await renderBandSlotsTab(view); return; }
            // 타임 신청(가입 신청·승인 팀)·시간 띠 — 가입 승인 폼과 팀 카드가 쓴다
            const allIds = teams.map(t => t.id);
            const [claimsAll, defs] = await Promise.all([fetchBandSlotClaims(allIds), fetchBandSlotDefs()]);
            // 주인 없는 대기 신청 정리(2026-11-11): 거절·탈퇴한 팀의 pending 타임 신청이 남아 있으면 rejected 로 닫는다
            // — 예전에 거절한 팀의 신청이 남아 가입 화면에 「다른 팀 신청 중」으로 보이던 것. 운영 계정이 이 탭을 열 때 한 번에 정리된다.
            const statusOf = {}; teams.forEach(t => { statusOf[t.id] = t.status; });
            const stale = claimsAll.filter(c => c.status === 'pending' && statusOf[c.profile_id] === 'rejected');
            if (stale.length && isBandAdmin()) {
                try {
                    const { error: stErr } = await supabaseClient.from('band_slot_claims').update({ status: 'rejected' }).in('id', stale.map(c => c.id));
                    if (!stErr) { stale.forEach(c => { c.status = 'rejected'; }); showToast(`거절·탈퇴한 팀의 남은 타임 신청 ${stale.length}건을 정리했습니다.`, 4500); }
                } catch (e) { console.error('band stale claims:', e); }
            }
            const claimsMap = {}; claimsAll.filter(c => c.status !== 'rejected').forEach(c => { (claimsMap[c.profile_id] = claimsMap[c.profile_id] || []).push(c); });
            state.bandAdminCache = { ...(state.bandAdminCache || {}), teams, claimsMap, defs, pinsMap: await fetchBandPins(allIds) };
            if (tab === 'pending') {
                const pending = teams.filter(t => t.status === 'pending');
                if (!pending.length) { view.innerHTML = _bandEmptyHTML('대기 중인 가입 신청이 없습니다.'); return; }
                view.innerHTML = pending.map(t => bandAdminTeamCard(t, 'pending', {}, {})).join('');
                return;
            }
            const approved = teams.filter(t => t.status === 'approved');
            const ids = teams.filter(t => t.status === 'approved' || bandEndedDate(t)).map(t => t.id);
            const [paymentsMap, remindersMap, skipsMap, pinsMap] = await Promise.all([fetchBandPayments(ids), fetchBandReminders(ids), fetchBandSkips(ids), fetchBandPins(allIds)]);
            teams.forEach(t => { t._ext = bandExtDates(skipsMap[t.id] || []); }); // 1주 연장 → 회차 경계(bandCycleInfo)에 반영
            state.bandAdminCache = { teams, paymentsMap, remindersMap, claimsMap, skipsMap, defs, pinsMap };
            if (tab === 'roster') { renderBandRosterTab(view, teams, paymentsMap, remindersMap); return; }
            // 관리 팀(게더링 운영 계정)은 계약·회차·문자 대상이 아니므로 계약 팀 목록과 분리해 보여준다
            const adminTeams = approved.filter(t => _isAdminBandProfile(t));
            const contractTeams = approved.filter(t => !_isAdminBandProfile(t));
            const group = (title, note, body) => `<div class="band-team-group">
                    <div class="band-group-title"><span>${title}</span>${note ? `<span class="band-muted">${note}</span>` : ''}</div>${body}</div>`;
            const cards = (list) => list.map(t => bandAdminTeamCard(t, 'approved', paymentsMap, remindersMap)).join('');
            view.innerHTML = group(`🎸 계약 팀 <span class="band-muted">${contractTeams.length}팀</span>`, '',
                    contractTeams.length ? cards(contractTeams) : _bandEmptyHTML('승인된 계약 팀이 없습니다.'))
                + (adminTeams.length ? group('🛠️ 관리 팀', '게더링 운영 계정 · 계약·회차·입금 안내 문자 대상이 아닙니다', cards(adminTeams)) : '');
        }

        // ── 고정 합주팀 회차 모델 (functions/send-reminders.js · 내부운영 시트 "진행중인 고정팀"과 동일하게 유지) ──
        // 시작일_n = band_start_date + 28n, 종료일_n = 시작일_n + 21(마지막 주 첫 합주일),
        // 입금일_n = 시작일_n − 14 (n≥1, 3주차 사용일 = 다음 시작일 2주 전), 등록(n=0)은 시작일 당일. 문자는 입금일 당일 + 미납 시 시작 전날.
        // 수식 본체는 /shared/rules.js 한 곳(서버 함수 send-reminders.js 도 같은 파일을 읽는다, 2026-11-10)
        const { BAND_CYCLE_DAYS, BAND_DUE_OFFSET, addDays: _bandAddDays, bandExtOffset, bandCycleStart, bandCycleEnd, bandCycleDue, bandNextCycle, bandInferCycle } = GAA_RULES;
        const bandDiffDays = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400e3);
        const _bandExtOf = (team) => (team && Array.isArray(team._ext) ? team._ext : []);
        const bandTodayStr = () => new Date().toLocaleDateString('en-CA'); // 로컬(KST) 기준 YYYY-MM-DD
        const bandCycleLabel = (n) => (n === 0 ? '등록' : `${n}차`);
        const bandMD = (ymd) => { if (!ymd) return '-'; const [, m, d] = ymd.split('-').map(Number); return `${m}/${d}`; };
        const bandWD = (ymd) => ['일','월','화','수','목','금','토'][new Date(ymd + 'T00:00:00').getDay()];
        const bandYMDShort = (ymd) => (ymd ? String(ymd).slice(2).replace(/-/g, '/') : ''); // 26/09/15 (시트 표기)
        const bandWon = (n) => (Number(n) > 0 ? Number(n).toLocaleString('ko-KR') + '원' : '');

        // 납부 행의 회차: cycle_no 우선, 구형 행(없음)은 납부 창([시작일−21, 시작일+7))으로 귀속
        function bandPaymentCycle(team, p) {
            if (Number.isInteger(p.cycle_no)) return p.cycle_no;
            return team.band_start_date && p.paid_at ? bandInferCycle(team.band_start_date, p.paid_at, _bandExtOf(team)) : null;
        }
        function bandPaidMap(team, payments) {
            const m = {};
            (payments || []).forEach(p => { const n = bandPaymentCycle(team, p); if (n !== null && (!m[n] || p.paid_at < m[n].paid_at)) m[n] = p; });
            return m;
        }
        // 팀의 회차 현황. mode: cycle(시작일 있음) / legacy(시작일 없음, 마지막 납부일+28일) / none
        // status: paid / normal / imminent(입금일 7일 이내) / due_today / overdue / unknown
        function bandCycleInfo(team, payments, today = bandTodayStr()) {
            const start = team.band_start_date;
            if (start) {
                const ext = _bandExtOf(team); // 1주 연장(건너뛰기권) 날짜 — 회차 경계를 미룬다
                const n = bandNextCycle(start, today, ext);
                const paidMap = bandPaidMap(team, payments);
                const cur = Math.max(0, n - 1);
                // 다음 "미납" 회차: 다음 회차(n)가 이미 납부됐으면 그 뒤 첫 미납 회차 — 표·카드·요약의 "입금일" 표시는 이걸 따른다
                let nextDueN = n; while (paidMap[nextDueN]) nextDueN++;
                const info = { mode: 'cycle', n, cur, paidMap, start, ext,
                    startN: bandCycleStart(start, n, ext), endN: bandCycleEnd(start, n, ext), due: bandCycleDue(start, n, ext),
                    nextDueN, nextDue: bandCycleDue(start, nextDueN, ext),
                    curStart: bandCycleStart(start, cur, ext), curEnd: bandCycleEnd(start, cur, ext) };
                if (n === 0) { info.status = 'normal'; info.paid = !!paidMap[0]; info.label = `${bandMD(start)} 시작 예정`; return info; }
                info.paid = !!paidMap[n];
                // 고정 사용 종료 예정일(band_end_date): 다음 회차 시작이 종료일 뒤면 회차를 더 만들지 않는다(입금 안내 없음) — send-reminders·check-band-payments 와 동일
                if (team.band_end_date) {
                    info.endDate = team.band_end_date;
                    if (team.band_end_date < today) { info.status = 'ended'; info.label = `${bandMD(team.band_end_date)} 사용 종료`; info.ended = true; return info; }
                    if (info.startN > team.band_end_date) { info.status = 'ending'; info.label = `${bandMD(team.band_end_date)} 종료 예정`; info.ending = true; return info; }
                }
                const diff = bandDiffDays(info.due, today); info.diff = diff;
                if (info.paid) { info.status = 'paid'; info.label = `${n}차 납부 완료`; }
                else if (diff > 7) { info.status = 'normal'; info.label = `입금일 ${diff}일 후`; }
                else if (diff > 0) { info.status = 'imminent'; info.label = `입금일 ${diff}일 후`; }
                else if (diff === 0) { info.status = 'due_today'; info.label = '입금일 오늘'; }
                else { info.status = 'overdue'; info.label = `입금일 ${-diff}일 지남`; }
                return info;
            }
            const last = (payments || []).map(p => p.paid_at).filter(Boolean).sort().pop();
            if (!last) return { mode: 'none', status: 'unknown', label: '시작일 미설정' };
            const next = _bandAddDays(last, BAND_CYCLE_DAYS); const diff = bandDiffDays(next, today);
            return { mode: 'legacy', next, diff, lastPaid: last,
                status: diff < 0 ? 'overdue' : diff <= 7 ? 'imminent' : 'normal',
                label: diff >= 0 ? `납부 예정 ${diff}일 후` : `납부 예정일 ${-diff}일 지남` };
        }
        const BAND_STATUS_CHIP = { paid: 'status-approved', normal: 'status-neutral', imminent: 'status-pending', due_today: 'status-pending', overdue: 'status-rejected', unknown: 'status-neutral', ending: 'status-info', ended: 'status-neutral' };
        // 사용 종료: 탈퇴 처리일(band_ended_at) 또는 지나간 종료 예정일(band_end_date < 오늘) — 현황표·팀 목록·문자 대상이 같은 판정을 쓴다
        const bandEndedDate = (t, today = bandTodayStr()) => t.band_ended_at || (t.band_end_date && t.band_end_date < today ? t.band_end_date : null);
        const bandStatusChip = (info, extra = '') => `<span class="status-badge sm ${BAND_STATUS_CHIP[info.status] || 'status-neutral'}"${extra}>${escHtml(info.label)}</span>`;

        // 팀별 납부 행 (최신순) — {teamId: [row]}
        async function fetchBandPayments(teamIds) {
            if (!supabaseClient || !teamIds.length) return {};
            const { data } = await supabaseClient
                .from('band_payments')
                .select('id, team_id, paid_at, cycle_no, amount, note')
                .in('team_id', teamIds)
                .order('paid_at', { ascending: false });
            const map = {};
            (data || []).forEach(r => { (map[r.team_id] = map[r.team_id] || []).push(r); });
            return map;
        }
        // 팀별 등록 비밀번호 숫자 4자리 — {teamId: '1234'} (운영자만 읽을 수 있는 band_pins, 표가 없거나 권한 없으면 빈 객체)
        async function fetchBandPins(teamIds) {
            if (!supabaseClient || !teamIds.length || !isBandAdmin()) return {};
            const { data, error } = await supabaseClient.from('band_pins').select('profile_id, pin').in('profile_id', teamIds);
            if (error) { console.error('band_pins:', error); return {}; }
            const map = {}; (data || []).forEach(r => { map[r.profile_id] = r.pin; });
            return map;
        }
        // 계약 정보 폼의 등록 비밀번호 칸 저장: 4자리면 upsert, 비우면 삭제(운영자) — 표가 없으면 안내
        async function saveBandPin(teamId, pin) {
            if (!supabaseClient || !isBandAdmin()) return;
            const q = pin ? supabaseClient.from('band_pins').upsert({ profile_id: teamId, pin, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })
                          : supabaseClient.from('band_pins').delete().eq('profile_id', teamId);
            const { error } = await q;
            if (error) { console.error('band_pins save:', error); showToast('등록 비밀번호를 저장하지 못했습니다. 20261105_band_pins.sql 마이그레이션을 확인해주세요.', 6000); }
        }
        // 팀별 문자 발송 이력 — {teamId: [{cycle_no, kind, sent_at}]} (마이그레이션 전이면 빈 객체)
        async function fetchBandReminders(teamIds) {
            if (!supabaseClient || !teamIds.length) return {};
            try {
                const { data, error } = await supabaseClient.from('band_rent_reminders')
                    .select('team_id, cycle_no, kind, sent_at').in('team_id', teamIds);
                if (error) return {};
                const map = {};
                (data || []).forEach(r => { (map[r.team_id] = map[r.team_id] || []).push(r); });
                return map;
            } catch (_) { return {}; }
        }

        // ── 계약 정보(시작일·개월수·보증금·이용료) 인라인 폼 ──
        function bandContractFormHTML(t) {
            const id = t.id;
            return `
                <div class="band-form-grid">
                    <label>첫 회차 시작일<input type="date" id="bc-start-${id}" class="band-input" value="${escAttr(t.band_start_date || '')}"></label>
                    <label>예상 사용 개월수<input type="text" id="bc-months-${id}" class="band-input" placeholder="예: 6개월 이상" value="${escAttr(t.band_expected_months || '')}"></label>
                    <label>캐비넷(6개월 이상 무료 · 미만 회차당 2만원)<select id="bc-cabinet-${id}" class="band-input"><option value=""${t.band_cabinet == null ? ' selected' : ''}>미응답</option><option value="1"${t.band_cabinet === true ? ' selected' : ''}>사용함</option><option value="0"${t.band_cabinet === false ? ' selected' : ''}>사용 안 함</option></select></label>
                    <label>보증금(원)<input type="number" id="bc-deposit-${id}" class="band-input" inputmode="numeric" placeholder="200000" value="${escAttr(t.band_deposit ?? '')}"></label>
                    <label>보증금 입금일<input type="date" id="bc-deposit-at-${id}" class="band-input" value="${escAttr(t.band_deposit_paid_at || '')}"></label>
                    <label>고정 사용 종료 예정일<input type="date" id="bc-end-${id}" class="band-input" value="${escAttr(t.band_end_date || '')}" title="마지막 사용일 — 비우면 기한 없음"></label>
                    <label>회차(4주) 이용료(원)<input type="number" id="bc-fee-${id}" class="band-input" inputmode="numeric" placeholder="300000" value="${escAttr(t.band_fee ?? '')}"></label>
                    <label>메모<input type="text" id="bc-memo-${id}" class="band-input" placeholder="캐비넷 등" value="${escAttr(t.band_memo || '')}"></label>
                    <label>등록 비밀번호(숫자 4자리)<input type="text" id="bc-pin-${id}" class="band-input" inputmode="numeric" maxlength="4" placeholder="캐비넷·도어락 등록용" value="${escAttr(((state.bandAdminCache || {}).pinsMap || {})[id] || '')}" oninput="this.value=this.value.replace(/\D/g,'').slice(0,4)"></label>
                </div>
                <div id="bc-result-${id}" class="band-form-result"></div>
                <div class="gaa-btn-row">
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="saveBandContract('${id}', this)">저장</button>
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="toggleBandBox('bc-form-${id}')">취소</button>
                </div>`;
        }
        function toggleBandBox(id, show) {
            const el = document.getElementById(id);
            if (!el) return;
            const next = typeof show === 'boolean' ? show : el.hidden;
            el.hidden = !next;
        }
        async function saveBandContract(teamId, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const v = (k) => { const el = document.getElementById(`${k}-${teamId}`); return el ? el.value.trim() : ''; };
            const res = document.getElementById(`bc-result-${teamId}`);
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const start = v('bc-start'), months = v('bc-months'), deposit = v('bc-deposit'), depositAt = v('bc-deposit-at'), fee = v('bc-fee'), memo = v('bc-memo'), pin = v('bc-pin'), endDate = v('bc-end'), cabinet = v('bc-cabinet');
            if (pin && !/^\d{4}$/.test(pin)) { showErr('등록 비밀번호는 숫자 4자리여야 합니다.'); return; }
            if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) { showErr('시작일 형식이 올바르지 않습니다.'); return; }
            if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { showErr('종료 예정일 형식이 올바르지 않습니다.'); return; }
            if (endDate && start && endDate < start) { showErr('종료 예정일은 시작일 뒤여야 합니다.'); return; }
            if (depositAt && !/^\d{4}-\d{2}-\d{2}$/.test(depositAt)) { showErr('보증금 입금일 형식이 올바르지 않습니다.'); return; }
            const toInt = (s) => (s === '' ? null : parseInt(s, 10));
            if ((deposit && !Number.isInteger(toInt(deposit))) || (fee && !Number.isInteger(toInt(fee)))) { showErr('금액은 숫자만 입력해주세요.'); return; }
            _bandBusy(btn, true, '저장 중…');
            try {
                const prevEnd = (((state.bandAdminCache || {}).teams || []).find(x => x.id === teamId) || {}).band_end_date || null; // update 전에 읽는다(캐시 행이 같은 객체일 수 있음)
                const payload = {
                    band_start_date: start || null, band_expected_months: months || null,
                    band_deposit: toInt(deposit), band_deposit_paid_at: depositAt || null,
                    band_fee: toInt(fee), band_memo: memo || null, band_end_date: endDate || null,
                    band_cabinet: cabinet === '' ? null : cabinet === '1',
                };
                let { error } = await supabaseClient.from('profiles').update(payload).eq('id', teamId);
                // 새 컬럼 마이그레이션 전이면 그 값만 빼고 다시 저장 + 안내(2026-11-05 종료 예정일 / 2026-11-07 캐비넷)
                for (const [col, mig] of [['band_end_date', '20261105_band_end_date'], ['band_cabinet', '20261107_band_cabinet']]) {
                    if (!error || !new RegExp(col).test(error.message || '')) continue;
                    delete payload[col];
                    ({ error } = await supabaseClient.from('profiles').update(payload).eq('id', teamId));
                    if (!error) showToast(`${col} 컬럼이 없어 그 값은 저장하지 못했습니다. ${mig}.sql 을 실행해주세요.`, 6000);
                }
                if (error) { console.error('band contract save error:', error); showErr('저장하지 못했습니다. 잠시 후 다시 시도해주세요. (컬럼이 없다면 20260915 마이그레이션을 먼저 실행하세요)'); return; }
                if ((endDate || null) !== prevEnd) await _bandApplyEndDate(teamId, endDate || null); // 고정 시간 차단·타임 신청의 end_date 도 같이
                const prevPin = ((state.bandAdminCache || {}).pinsMap || {})[teamId] || '';
                if (pin !== prevPin) await saveBandPin(teamId, pin); // 바뀐 때만(비우면 삭제)
                showToast('계약 정보를 저장했습니다.');
                renderBandAdminTab();
            } finally { _bandBusy(btn, false); }
        }

        // ── 입금 기록 인라인 폼 (등록/수정 겸용) ──
        function bandPaymentFormHTML(t, info, editRow) {
            const id = t.id;
            const today = bandTodayStr();
            let cycleField = '';
            if (info.mode === 'cycle') {
                const paidMap = info.paidMap || {};
                const maxN = Math.max(info.n + 1, ...Object.keys(paidMap).map(Number), 1);
                const defN = editRow ? bandPaymentCycle(t, editRow) : (paidMap[info.n] ? info.n + 1 : info.n);
                const opts = [];
                for (let n = 0; n <= maxN; n++) {
                    const paid = paidMap[n] && (!editRow || paidMap[n].id !== editRow.id);
                    opts.push(`<option value="${n}"${n === defN ? ' selected' : ''}>${bandCycleLabel(n)} · 시작 ${bandMD(bandCycleStart(info.start, n, info.ext))}${n > 0 ? ' · 입금일 ' + bandMD(bandCycleDue(info.start, n, info.ext)) : ''}${paid ? ' (납부됨)' : ''}</option>`);
                }
                cycleField = `<label>회차<select id="bp-cycle-${id}" class="band-input">${opts.join('')}</select></label>`;
            }
            return `
                <input type="hidden" id="bp-edit-${id}" value="${editRow ? escAttr(editRow.id) : ''}">
                <div class="band-form-grid">
                    ${cycleField}
                    <label>납부일<input type="date" id="bp-date-${id}" class="band-input" value="${escAttr(editRow ? editRow.paid_at : today)}"></label>
                    <label>금액(원)<input type="number" id="bp-amount-${id}" class="band-input" inputmode="numeric" value="${escAttr(editRow ? (editRow.amount ?? '') : (t.band_fee ?? ''))}"></label>
                    <label>메모<input type="text" id="bp-note-${id}" class="band-input" value="${escAttr(editRow ? (editRow.note || '') : '')}" placeholder="선택"></label>
                </div>
                <div id="bp-result-${id}" class="band-form-result"></div>
                <div class="gaa-btn-row">
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="saveBandPayment('${id}', this)">${editRow ? '수정 저장' : '기록 저장'}</button>
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="toggleBandBox('bp-form-${id}', false)">취소</button>
                </div>`;
        }
        function openBandPaymentForm(teamId, paymentId) {
            const cache = state.bandAdminCache || {};
            const t = (cache.teams || []).find(x => x.id === teamId);
            const box = document.getElementById(`bp-form-${teamId}`);
            if (!t || !box) return;
            const rows = (cache.paymentsMap || {})[teamId] || [];
            const editRow = paymentId ? rows.find(r => r.id === paymentId) : null;
            box.innerHTML = bandPaymentFormHTML(t, bandCycleInfo(t, rows), editRow);
            box.hidden = false;
            const first = box.querySelector('input[type="date"]');
            if (first) first.focus();
        }
        async function saveBandPayment(teamId, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const v = (k) => { const el = document.getElementById(`${k}-${teamId}`); return el ? el.value.trim() : null; };
            const res = document.getElementById(`bp-result-${teamId}`);
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const editId = v('bp-edit'), dateStr = v('bp-date') || '', amountStr = v('bp-amount'), note = v('bp-note') || '', cycleStr = v('bp-cycle');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { showErr('납부일을 선택해주세요.'); return; }
            const amount = amountStr ? parseInt(amountStr, 10) : null;
            if (amountStr && !Number.isInteger(amount)) { showErr('금액은 숫자만 입력해주세요.'); return; }
            const row = { paid_at: dateStr, note, amount, cycle_no: cycleStr === null ? null : parseInt(cycleStr, 10) };
            _bandBusy(btn, true, '저장 중…');
            try {
                const q = editId
                    ? supabaseClient.from('band_payments').update(row).eq('id', editId)
                    : supabaseClient.from('band_payments').insert({ team_id: teamId, ...row });
                const { error } = await q;
                if (error) { console.error('band payment save error:', error); showErr('저장하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                showToast(editId ? '납부 기록을 수정했습니다.' : '납부 기록을 저장했습니다.');
                renderBandAdminTab();
            } finally { _bandBusy(btn, false); }
        }
        async function deleteBandPayment(paymentId, teamId) {
            if (!supabaseClient || !isBandAdmin()) return;
            if (!confirm('이 납부 기록을 삭제하시겠습니까?')) return;
            const { error } = await supabaseClient.from('band_payments').delete().eq('id', paymentId);
            if (error) { console.error('band payment delete error:', error); showToast('삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            showToast('납부 기록을 삭제했습니다.');
            renderBandAdminTab();
        }
        function toggleBandPaymentHistory(teamId, btnEl) {
            const wrap = document.getElementById('pay-hist-' + teamId);
            if (!wrap) return;
            const show = wrap.hidden;
            wrap.hidden = !show;
            if (btnEl) btnEl.textContent = show ? '납부 내역 ▲' : '납부 내역 ▼';
        }
        // 시트 이관 시드가 남긴 "시트 이관" 표식은 화면에서 숨긴다 (DB 값은 유지 — 뒤에 다른 메모가 붙어 있으면 그 부분만 표시)
        const _bandDisplayNote = (s) => String(s || '').replace(/^\s*시트\s*이관\s*([·,;/-]\s*)?/, '').trim();
        function bandPaymentHistoryHTML(t, rows, opts = {}) {
            if (!rows.length) return _bandEmptyHTML('납부 내역이 없습니다.');
            return rows.map(r => {
                const n = bandPaymentCycle(t, r);
                const note = _bandDisplayNote(r.note);
                if (opts.readOnly) return `<div class="band-pay-row"><span>${n !== null ? `<strong>${bandCycleLabel(n)}</strong> · ` : ''}${escHtml(r.paid_at)}${r.amount ? ' · ' + bandWon(r.amount) : ''}${note ? ` <span class="band-muted">· ${escHtml(note)}</span>` : ''}</span></div>`;
                return `<div class="band-pay-row">
                    <span>${n !== null ? `<strong>${bandCycleLabel(n)}</strong> · ` : ''}${escHtml(r.paid_at)}${r.amount ? ' · ' + bandWon(r.amount) : ''}${note ? ` <span class="band-muted">· ${escHtml(note)}</span>` : ''}</span>
                    <span class="gaa-btn-row">
                        <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="openBandPaymentForm('${t.id}','${r.id}')">수정</button>
                        <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-danger" onclick="deleteBandPayment('${r.id}','${t.id}')">삭제</button>
                    </span>
                </div>`;
            }).join('');
        }

        // 관리자 문자 테스트 — 게더링 계정의 Supabase 세션 토큰으로 서버가 본인 확인 후, 관리자 본인 번호로만 샘플 문자를 보낸다
        // ── 알림 테스트 탭: 입금 안내 문자·관리자 푸시를 실제 발송과 같은 경로로 시험 (본인 번호·운영 총괄에게만) ──
        // ══════════ 고정 합주팀: 실시간 시간 띠·타임 신청·건너뛰기권 (2026-11-05, 마이그레이션 20261105_band_slots.sql) ══════════
        // 시간 표기: band_slot_defs/claims/skips 의 end_time 은 끝나는 시각(exclusive, '18:00'=18시까지),
        //            time_blocks.end_time 은 종전처럼 마지막 슬롯 시작('17:00') — _bandBlockEnd/_bandBlockEndExcl 로 변환한다.
        const BAND_DOW = ['일','월','화','수','목','금','토'];
        const BAND_DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
        const BAND_AVAIL_DAYS = 182;          // 가용성·건너뛰기 계산 범위(시작일부터 26주)
        const BAND_HARD_BLOCK_DAYS = 56;      // 이보다 오래 남은 반복 차단은 "사용 중"(건너뛰기 아님)
        const BAND_SKIP_DEADLINE_DAYS = GAA_RULES.BAND_SKIP_DEADLINE_DAYS; // 보상 선택 마감 = 건너뛰는 날 − 7일
        const BAND_OPEN_TIME = '09:00';       // 고정 합주팀 안내용 운영 시작 시각(2026-11-11) — 예약 그리드 TIMES(08:00~)와 별개, 랜딩 사실 띠·운영 안내 문구만
        const BAND_SUB_RANGE_DAYS = 7;        // 대체 합주 범위 = 건너뛰는 날 앞뒤 1주일 [−7, +7] (2026-11-05, 종전 −7~전날)
        const BAND_TEAM_SUB_MIN_DAYS = 3;     // 팀이 직접 요청하는 대체 합주(이용 기간 중 1회, 2026-11-07): 건너뛸 날 3일 전까지 요청
        const _bandH = (t) => parseInt(String(t || '0'), 10);
        const _bandRangeText = (s, e) => `${_bandH(s)}~${_bandH(e)}시`;
        const _bandBlockEnd = (endExcl) => (endExcl >= '23:00' ? TIMES[TIMES.length - 1] : TIMES[TIMES.indexOf(endExcl) - 1]);
        const _bandBlockEndExcl = (blockEnd) => TIMES[TIMES.indexOf(blockEnd) + 1] || '23:00';
        const _bandSlotIdx = (startT, endExcl) => ({ s: TIMES.indexOf(startT), e: TIMES.indexOf(_bandBlockEnd(endExcl)) }); // inclusive 슬롯 인덱스
        const _bandOverlapIdx = (aS, aE, bS, bE) => aS <= bE && aE >= bS;
        const _bandLabelOf = (startT) => (_bandH(startT) < 12 ? '오전' : _bandH(startT) < 18 ? '주간' : '야간');
        const bandDefText = (d) => `${BAND_DOW[d.day_of_week]} ${d.label || _bandLabelOf(d.start_time)} ${_bandRangeText(d.start_time, d.end_time)}`;
        const bandSlotLegacyKey = (d) => `${BAND_DOW[d.day_of_week]}_${d.label || _bandLabelOf(d.start_time)}`;
        const bandClaimText = (c) => `${BAND_DOW[c.day_of_week]} ${_bandRangeText(c.start_time, c.end_time)}`;
        const bandClaimsText = (claims) => (claims || []).map(bandClaimText).join(' · ');
        const _bandMDW = (ymd) => `${bandMD(ymd)}(${bandWD(ymd)})`;
        // 건너뛰기권 보상의 실효 판정: 선택했으면 그 값, 마감(건너뛰는 날 − 7일)이 지났으면 1주 연장으로 간주 — send-reminders.js · check-band-payments 와 동일
        const bandSkipDeadline = (s) => _bandAddDays(s.skip_date, -BAND_SKIP_DEADLINE_DAYS);
        const bandSkipResolution = (s, today = bandTodayStr()) => GAA_RULES.bandSkipResolution(s, today);
        const bandExtDates = (skips, today = bandTodayStr()) => GAA_RULES.bandExtDates(skips, today);
        const BAND_KIND_CHIP = { ok: 'status-approved', skip: 'status-pending', later: 'status-info', wait: 'status-neutral', taken: 'status-rejected', off: 'status-neutral' };

        let _bandSlotsUnavailable = false; // band_slot_defs 표가 없으면(마이그레이션 전) 가입 화면은 종전 체크박스 타임표로 폴백
        async function fetchBandSlotDefs() {
            if (!supabaseClient) return [];
            const { data, error } = await supabaseClient.from('band_slot_defs').select('*');
            if (error) {
                if (error.code === '42P01' || /band_slot_defs|schema cache|does not exist/i.test(error.message || '')) _bandSlotsUnavailable = true;
                console.error('band_slot_defs:', error); return [];
            }
            _bandSlotsUnavailable = false;
            return (data || []).slice().sort((a, b) => BAND_DOW_ORDER.indexOf(a.day_of_week) - BAND_DOW_ORDER.indexOf(b.day_of_week) || String(a.start_time).localeCompare(String(b.start_time)));
        }
        async function fetchBandSlotClaims(profileIds) {
            if (!supabaseClient) return [];
            let q = supabaseClient.from('band_slot_claims').select('*').in('status', ['pending', 'approved']);
            if (profileIds) q = q.in('profile_id', profileIds);
            const { data, error } = await q;
            if (error) { console.error('band_slot_claims:', error); return []; }
            return (data || []).slice().sort((a, b) => BAND_DOW_ORDER.indexOf(a.day_of_week) - BAND_DOW_ORDER.indexOf(b.day_of_week) || String(a.start_time).localeCompare(String(b.start_time)));
        }
        // {profileId: [skip]} (날짜순)
        async function fetchBandSkips(profileIds) {
            if (!supabaseClient || !profileIds || !profileIds.length) return {};
            const { data, error } = await supabaseClient.from('band_skips').select('*').in('profile_id', profileIds);
            if (error) { console.error('band_skips:', error); return {}; }
            const map = {};
            (data || []).slice().sort((a, b) => String(a.skip_date).localeCompare(String(b.skip_date))).forEach(r => { (map[r.profile_id] = map[r.profile_id] || []).push(r); });
            return map;
        }
        // 가용성 계산 자료 한 번에: 시간 띠·신청·차단 전체 + 기간 안 멤버 예약·공간 대관(확정+살아 있는 대기)
        async function bandAvailLoad(startDate, days = BAND_AVAIL_DAYS) {
            const endDate = _bandAddDays(startDate, days);
            const sb = supabaseClient;
            const [defs, claims, blocksR, resR, pbR] = await Promise.all([
                fetchBandSlotDefs(), fetchBandSlotClaims(),
                sb.from('time_blocks').select('*'),
                sb.from('reservations').select('res_date,start_time,end_time,status').gte('res_date', startDate).lte('res_date', endDate),
                sb.from('performance_bookings').select('id,date,start_time,end_time,status,created_at').gte('date', startDate).lte('date', endDate).in('status', ['approved', 'pending']),
            ]);
            return { startDate, endDate, defs, claims,
                blocks: blocksR.data || [],
                reservations: (resR.data || []).filter(r => r.status !== 'rejected' && r.status !== 'cancelled'),
                bookings: (pbR.data || []).filter(b => !_pbExpired(b)) };
        }
        // 요일 띠의 합주 날짜들(시작일 이후 첫 해당 요일부터 범위 끝까지, 주 단위)
        function bandDefDates(dow, startDate, endDate) {
            const out = []; const d0 = new Date(startDate + 'T00:00:00');
            const off = (dow - d0.getDay() + 7) % 7;
            for (let d = new Date(d0.getTime() + off * 86400e3); ; d = new Date(d.getTime() + 7 * 86400e3)) {
                const ymd = d.toLocaleDateString('en-CA'); if (ymd > endDate) break; out.push(ymd);
            }
            return out;
        }
        const _bandConflictReason = (b) => { const r = String(b.reason || ''); return r.startsWith('[고정팀 대체]') ? '다른 팀 대체 합주' : r.startsWith('[고정팀]') ? '다른 고정팀' : r.startsWith('[커뮤니티]') ? '커뮤니티 모임' : '게더링 차단'; };
        // 특정 날짜·시간대(inclusive 슬롯 인덱스)와 겹치는 사유 — 예약·대관·1회 차단·기간 짧은 반복 차단(weeklyToo 면 반복 차단 전부)
        function bandDateConflicts(ctx, dateStr, sIdx, eIdx, opts = {}) {
            const out = [];
            const dow = new Date(dateStr + 'T00:00:00').getDay();
            for (const r of ctx.reservations) {
                if (r.res_date !== dateStr) continue;
                if (_bandOverlapIdx(sIdx, eIdx, TIMES.indexOf(r.start_time), TIMES.indexOf(r.end_time))) out.push('게더링 예약');
            }
            for (const b of ctx.bookings) {
                if (b.date !== dateStr) continue;
                if (_bandOverlapIdx(sIdx, eIdx, TIMES.indexOf(b.start_time), TIMES.indexOf(b.end_time))) out.push(b.status === 'pending' ? '공간 대관(입금 대기)' : '공간 대관');
            }
            for (const b of ctx.blocks) {
                if (b.day_of_week !== dow) continue;
                if (opts.skipBlockIds && opts.skipBlockIds.includes(b.id)) continue;
                if (b.start_date && dateStr < b.start_date) continue;
                if (b.end_date && dateStr > b.end_date) continue;
                if (_blockSkipped(b, dateStr)) continue;
                if (!_bandOverlapIdx(sIdx, eIdx, TIMES.indexOf(b.start_time), TIMES.indexOf(b.end_time))) continue;
                const once = b.start_date && b.start_date === b.end_date;
                if (opts.weeklyToo || once || (b.end_date && bandDiffDays(b.end_date, ctx.startDate) <= BAND_HARD_BLOCK_DAYS)) out.push(_bandConflictReason(b));
            }
            return [...new Set(out)];
        }
        // 시간 띠 하나의 상태. kind: off(신청 불가) / later(개방일 전) / wait(다른 팀 신청 대기) / taken(다른 고정팀·장기 차단) / skip(가능, N주 건너뛰기) / ok
        function bandDefStatus(def, ctx, opts = {}) {
            const { s: sIdx, e: eIdx } = _bandSlotIdx(def.start_time, def.end_time);
            if (def.band_ok === false) {
                if (def.off_reason === 'team') return { kind: 'taken', label: '고정팀 사용 중', who: '고정팀 사용 중', skips: [] }; // 기존 고정팀이 쓰는 띠(달력 반영 전) — "대관만"으로 잘못 보이지 않게
                return { kind: 'off', label: def.rental_ok === false ? '불가' : '대관만', skips: [] };
            }
            const other = (ctx.claims || []).filter(c => c.day_of_week === def.day_of_week && c.profile_id !== opts.excludeProfile && (!c.end_date || c.end_date >= ctx.startDate)
                && _bandOverlapIdx(sIdx, eIdx, _bandSlotIdx(c.start_time, c.end_time).s, _bandSlotIdx(c.start_time, c.end_time).e));
            if (other.some(c => c.status === 'pending')) return { kind: 'wait', label: '다른 팀 신청 중', skips: [] };
            for (const b of ctx.blocks) { // 장기 반복 차단(다른 고정팀·운영 차단) → 사용 중(끝나는 날이 있으면 그다음 날부터 가능)
                if (b.day_of_week !== def.day_of_week) continue;
                if (b.start_date && b.start_date === b.end_date) continue;
                if (opts.skipBlockIds && opts.skipBlockIds.includes(b.id)) continue;
                if (b.end_date && b.end_date < ctx.startDate) continue;
                if (b.start_date && b.start_date > ctx.endDate) continue;
                if (!_bandOverlapIdx(sIdx, eIdx, TIMES.indexOf(b.start_time), TIMES.indexOf(b.end_time))) continue;
                if (!b.end_date || bandDiffDays(b.end_date, ctx.startDate) > BAND_HARD_BLOCK_DAYS) {
                    const from = b.end_date ? _bandAddDays(b.end_date, 1) : null;
                    const who = String(b.reason || '').startsWith('[고정팀]') ? '고정팀 사용 중' : '차단 중';
                    return { kind: 'taken', label: from ? `${bandMD(from)}부터` : who, who, from, skips: [] };
                }
            }
            if (other.some(c => c.status === 'approved' && !c.block_id)) return { kind: 'taken', label: '고정팀 사용 중', who: '고정팀 사용 중', skips: [] }; // 승인됐지만 달력 미반영
            if (def.open_from && def.open_from > ctx.startDate) return { kind: 'later', label: `${bandMD(def.open_from)}부터`, from: def.open_from, skips: [] }; // 개방일 전(사용 중·대기보다 뒤에 판정)
            const skips = [];
            for (const d of bandDefDates(def.day_of_week, ctx.startDate, ctx.endDate)) {
                const reasons = bandDateConflicts(ctx, d, sIdx, eIdx, { skipBlockIds: opts.skipBlockIds });
                if (reasons.length) skips.push({ date: d, reasons });
            }
            return skips.length ? { kind: 'skip', label: `${skips.length}주 건너뛰기`, skips } : { kind: 'ok', label: '가능', skips };
        }
        // 요일별 띠 표 — rows: [{def, st}] · opts.selectable/selected(Set)/onToggle(함수명)/publicView
        function bandAvailTableHTML(rows, opts = {}) {
            const byDow = {}; rows.forEach(r => (byDow[r.def.day_of_week] = byDow[r.def.day_of_week] || []).push(r));
            const sel = opts.selected || new Set();
            return `<div class="band-avail">${BAND_DOW_ORDER.map(dow => {
                const list = byDow[dow] || [];
                return `<div class="band-avail-row"><div class="band-avail-day${dow === 6 ? ' sat' : dow === 0 ? ' sun' : ''}">${BAND_DOW[dow]}</div><div class="band-avail-chips">${list.length ? list.map(({ def, st }) => {
                    const can = opts.selectable && (st.kind === 'ok' || st.kind === 'skip');
                    const info = opts.selectable && !can && opts.onInfo; // 선택 불가 칩도 눌러 이유·개방일 이동
                    const on = sel.has(def.id);
                    const title = !opts.publicView && def.note ? ` title="${escAttr(def.note)}"` : '';
                    return `<button type="button" class="band-slot-chip ${st.kind}${on ? ' sel' : ''}${info ? ' na' : ''}" data-def="${def.id}"${can ? ` onclick="${opts.onToggle}('${def.id}')"` : info ? ` onclick="${opts.onInfo}('${def.id}')"` : ' disabled'}${title}>
                        <span class="t">${_bandRangeText(def.start_time, def.end_time)}<em>${escHtml(def.label || _bandLabelOf(def.start_time))}</em></span><span class="s">${on ? '✓ 선택' : escHtml(st.label)}</span></button>`;
                }).join('') : '<span class="band-avail-none">—</span>'}</div></div>`;
            }).join('')}</div>`;
        }
        const _bandAvailLegend = () => `<div class="band-avail-legend"><span class="status-badge sm status-approved">가능</span><span class="status-badge sm status-pending">N주 건너뛰기</span><span class="status-badge sm status-info">개방일</span><span class="status-badge sm status-rejected">사용 중</span><span class="status-badge sm status-neutral">불가·대기</span></div>`;

        // ── 고정 가능 시간 보기·가입 신청: 희망 시작일 기준 실시간 가능 타임 — 시간표 화면(#bandScheduleBody)과 가입 폼(#bandSignupAvailBody)이 같은 자료·선택을 쓴다 ──
        let _bandSignupAvail = null; // {ctx, rows}
        const _bandSignupSel = new Set();
        const _bandSignupDefaultStart = () => _bandAddDays(bandTodayStr(), 7);
        const _bandAvailBodies = () => ['bandScheduleBody', 'bandSignupAvailBody'].map(id => document.getElementById(id)).filter(Boolean);
        const _bandStartInputs = () => ['bandScheduleStart', 'bandSignupStart'].map(id => document.getElementById(id)).filter(Boolean);
        const _bandMonthsInputs = () => ['bandScheduleMonths', 'bandSignupMonths'].map(id => document.getElementById(id)).filter(Boolean);
        const bandWishStart = () => (/^\d{4}-\d{2}-\d{2}$/.test(state.bandWishStart || '') ? state.bandWishStart : _bandSignupDefaultStart());
        // 예상 사용 기간(개월) — 겹치는 예약·대관은 이 기간 안에서만 찾는다(가입 때 profiles.band_expected_months 로 저장)
        const BAND_MONTHS_OPTS = [1, 2, 3, 4, 5, 6, 9, 12];
        const BAND_MONTHS_DEFAULT = 6;
        const bandWishMonths = () => { const m = parseInt(state.bandWishMonths, 10); return BAND_MONTHS_OPTS.includes(m) ? m : BAND_MONTHS_DEFAULT; };
        const _bandAddMonths = (ymd, m) => { const d = new Date(ymd + 'T00:00:00'); d.setMonth(d.getMonth() + m); return d.toLocaleDateString('en-CA'); };
        const bandMonthsFromText = (t) => { const m = parseInt((String(t || '').match(/(\d+)\s*개월/) || [])[1], 10); return m > 0 && m <= 36 ? m : BAND_MONTHS_DEFAULT; }; // '6개월 이상' → 6
        const bandAvailDaysFor = (start, months) => Math.max(7, bandDiffDays(_bandAddMonths(start, months), start));
        // ── 캐비넷(2026-11-07): 6개월 이상 사용 팀 무료 · 미만 회차당 2만원. 기준은 예상 사용 기간(band_expected_months, 계약 정보에서 수정 가능).
        //    profiles.band_cabinet(마이그레이션 20261107_band_cabinet.sql) true/false/null(미응답). 문자 문구는 functions/send-sms.js·send-reminders.js 와 같은 규칙.
        const BAND_CABINET_FEE = 20000, BAND_CABINET_FREE_MONTHS = 6;
        const bandMonthsStrict = (txt) => { const m = parseInt((String(txt || '').match(/(\d+)\s*개월/) || [])[1], 10); return m > 0 ? m : null; }; // 없으면 null(기본값 대입 안 함)
        const bandCabinetFree = (months) => months != null && months >= BAND_CABINET_FREE_MONTHS;
        function bandCabinetLabel(t) {
            if (t.band_cabinet === true) { const m = bandMonthsStrict(t.band_expected_months); return m == null ? '사용함 · 기간 미정(6개월 이상 무료)' : bandCabinetFree(m) ? '사용함 · 무료(6개월 이상)' : '사용함 · 회차당 2만원'; }
            if (t.band_cabinet === false) return '사용 안 함';
            return '미응답';
        }
        function bandSignupCabinetNote() {
            const el = document.getElementById('bandSignupCabinetNote'); if (!el) return;
            const m = bandWishMonths();
            const now = _bandSignupUsesTable() ? `예상 사용 기간 <strong>${m}개월</strong> → 캐비넷 <strong>${bandCabinetFree(m) ? '무료' : '회차당 2만원(이용료와 함께 입금)'}</strong>. ` : '';
            el.innerHTML = `${now}캐비넷은 <strong>6개월 이상</strong> 사용 팀은 무료, 그 미만은 <strong>회차당 2만원</strong>이에요. 가입 때 정한 숫자 4자리가 캐비넷 비밀번호로 등록돼요.`;
        }
        // 복귀 팀 체크: 리더 연락처(숫자만)가 같거나, 리더 이름 + 밴드명(국문/영문)이 같은 다른 밴드 프로필 — 사용 중단했다가 다시 신청한 팀을 운영자가 알아보게
        function bandReturningMatches(t, teams) {
            const list = teams || ((state.bandAdminCache || {}).teams || []);
            const digits = (v) => String(v || '').replace(/\D/g, '');
            const norm = (v) => String(v || '').trim().toLowerCase();
            const ph = digits(t.leader_phone || t.phone), nm = norm(t.leader_name || t.name), kr = norm(t.band_name_kr), en = norm(t.band_name_en);
            return list.filter(o => o && o.id !== t.id && o.member_type === 'band' && !_isAdminBandProfile(o) && (
                (ph.length >= 10 && digits(o.leader_phone || o.phone) === ph) ||
                (nm && norm(o.leader_name || o.name) === nm && ((kr && norm(o.band_name_kr) === kr) || (en && norm(o.band_name_en) === en)))));
        }
        function bandReturningHTML(t) {
            const hits = bandReturningMatches(t);
            if (!hits.length) return '';
            const desc = hits.slice(0, 3).map(o => {
                const ended = bandEndedDate(o);
                const st = ended ? `${bandYMDShort(ended)} 종료` : o.status === 'approved' ? '이용 중' : o.status === 'rejected' ? '거절/탈퇴' : '대기';
                const why = String(o.leader_phone || o.phone || '').replace(/\D/g, '') === String(t.leader_phone || t.phone || '').replace(/\D/g, '') ? '연락처 일치' : '리더 이름·밴드명 일치';
                return `「${escHtml(o.band_name_kr || o.name || '-')}」(${o.band_start_date ? bandYMDShort(o.band_start_date) + ' 시작 · ' : ''}${st} · ${why})`;
            }).join(', ');
            return `<div class="band-muted" style="margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px"><span>🔁 <strong>복귀 팀 가능성</strong> — 이전 기록 ${desc}. 신청 팀에게는 알리지 않습니다.</span>
                <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="bandAdoptPrevious('${t.id}', '${hits[0].id}', this)">이전 팀 정보 가져오기</button></div>`;
        }
        // 이전 팀의 계약 정보(이용료·보증금 금액·캐비넷·메모)를 새 신청에 복사 — 보증금 입금일은 종료 때 반환되므로 복사하지 않는다. 회차·납부 내역은 이전 팀 기록에 그대로.
        async function bandAdoptPrevious(id, prevId, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const teams = (state.bandAdminCache || {}).teams || [];
            const t = teams.find(x => x.id === id), prev = teams.find(x => x.id === prevId);
            if (!t || !prev) { showToast('이전 팀 정보를 찾지 못했습니다.'); return; }
            const prevName = prev.band_name_kr || prev.name || '-';
            const period = `${prev.band_start_date ? bandYMDShort(prev.band_start_date) : '?'}~${bandEndedDate(prev) ? bandYMDShort(bandEndedDate(prev)) : '진행 중'}`;
            if (!confirm(`「${prevName}」(${period})의 이용료·보증금 금액·캐비넷·메모를 이 신청에 가져올까요?\n보증금 입금일은 복사하지 않아요(종료 시 반환되므로 다시 입금 확인). 회차·납부 내역은 이전 팀 기록에 남습니다.`)) return;
            const upd = { band_memo: [`복귀 · 이전 팀 ${prevName}(${period})`, t.band_memo, prev.band_memo].filter(Boolean).join(' / ') };
            if (prev.band_fee != null) upd.band_fee = prev.band_fee;
            if (prev.band_deposit != null) upd.band_deposit = prev.band_deposit;
            if (!t.band_expected_months && prev.band_expected_months) upd.band_expected_months = prev.band_expected_months;
            if (t.band_cabinet == null && prev.band_cabinet != null) upd.band_cabinet = prev.band_cabinet;
            _bandBusy(btn, true, '적용 중…');
            try {
                let { error } = await supabaseClient.from('profiles').update(upd).eq('id', id);
                if (error && /band_cabinet/.test(error.message || '')) { delete upd.band_cabinet; ({ error } = await supabaseClient.from('profiles').update(upd).eq('id', id)); }
                if (error) { console.error('band adopt previous:', error); showToast('적용하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                showToast(`「${prevName}」 정보를 가져왔습니다. 계약 정보에서 확인·수정하세요.`);
                renderBandAdminTab();
            } finally { _bandBusy(btn, false); }
        }
        function bandWishMonthsChange(v) {
            state.bandWishMonths = v;
            _bandMonthsInputs().forEach(i => { i.value = String(bandWishMonths()); });
            bandSignupCabinetNote();
            bandSignupAvailRefresh();
        }
        // 희망 시작일 변경(두 화면 입력칸 동기화) → 다시 계산
        function bandWishStartChange(v) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return;
            state.bandWishStart = v;
            _bandStartInputs().forEach(i => { i.value = v; });
            bandSignupAvailRefresh();
        }
        // 폴백(표 없음·띠 0개) 여부 — 2단계 폼·제출이 종전 체크박스와 구분하는 기준
        const _bandSignupUsesTable = () => !!_bandSignupAvail && !state.bandSignupFallback;
        async function bandSignupAvailInit() {
            if (!_bandAvailBodies().length) return;
            const start = bandWishStart();
            _bandStartInputs().forEach(i => { i.min = bandTodayStr(); i.value = start; });
            _bandMonthsInputs().forEach(i => { i.value = String(bandWishMonths()); });
            await bandSignupAvailRefresh();
            // 폴백: 표가 없거나(마이그레이션 전) 띠가 하나도 없으면 가입 폼은 종전 체크박스, 시간표 화면은 안내문
            state.bandSignupFallback = !supabaseClient || _bandSlotsUnavailable || !_bandSignupAvail || !_bandSignupAvail.rows.length;
            const fb = state.bandSignupFallback;
            document.getElementById('bandSignupSlots')?.classList.toggle('hidden', fb);
            document.getElementById('bandSignupLegacySlots')?.classList.toggle('hidden', !fb);
            if (fb) { const sb = document.getElementById('bandScheduleBody'); if (sb) sb.innerHTML = _bandEmptyHTML('아직 시간표가 준비되지 않았어요. 가입 신청에서 주간/야간 타임을 골라 보내주시면 운영자가 연락드릴게요.'); const nb = document.getElementById('bandScheduleNextBtn'); if (nb) { nb.disabled = false; nb.textContent = '가입 신청으로'; } }
        }
        async function bandSignupAvailRefresh() {
            if (!supabaseClient || !_bandAvailBodies().length) return;
            const start = bandWishStart();
            _bandAvailBodies().forEach(b => { b.innerHTML = _bandLoadingHTML(); });
            try {
                const ctx = await bandAvailLoad(start, bandAvailDaysFor(start, bandWishMonths()));
                if (_bandSlotsUnavailable) { _bandSignupAvail = null; return; }
                const rows = ctx.defs.map(def => ({ def, st: bandDefStatus(def, ctx) }));
                _bandSignupAvail = { ctx, rows };
                [..._bandSignupSel].forEach(id => { const r = rows.find(x => x.def.id === id); if (!r || (r.st.kind !== 'ok' && r.st.kind !== 'skip')) _bandSignupSel.delete(id); });
                bandSignupAvailRender();
            } catch (e) { console.error('band avail:', e); _bandAvailBodies().forEach(b => { b.innerHTML = _bandEmptyHTML('가능 시간을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'); }); }
        }
        // 선택 불가 칩을 눌렀을 때: 개방일·종료 예정이면 희망 시작일을 그날로 옮기고, 아니면 이유를 알려준다
        function bandScheduleChipInfo(id) {
            const r = _bandSignupAvail && _bandSignupAvail.rows.find(x => x.def.id === id);
            if (!r) return;
            const st = r.st;
            if ((st.kind === 'later' || st.kind === 'taken') && st.from) { bandWishStartChange(st.from); showToast(`희망 시작일을 ${_bandMDW(st.from)}로 바꿨어요. 이 타임은 그날부터 신청할 수 있어요.`); return; }
            const msg = { wait: '다른 팀이 먼저 신청해 운영자 확인을 기다리는 타임이에요.', taken: '다른 고정팀이 쓰고 있는 시간이라 지금은 신청할 수 없어요.', off: '고정팀은 받지 않는 시간이에요(공간 대관은 가능).' }[st.kind];
            if (msg) showToast(msg);
        }
        function bandSignupAvailRender() {
            if (!_bandSignupAvail) return;
            const { rows, ctx } = _bandSignupAvail;
            const picked = rows.filter(r => _bandSignupSel.has(r.def.id));
            let detail;
            if (picked.length) {
                const skipItems = picked.flatMap(r => r.st.skips.map(s => ({ ...s, def: r.def }))).sort((a, b) => a.date.localeCompare(b.date));
                detail = `<div class="band-sv-detail"><div class="band-sv-detail-head"><span>선택한 타임</span><span>${picked.length}개</span></div>
                    <div class="band-sv-picked">${picked.map(r => escHtml(bandDefText(r.def))).join(' · ')}</div>`
                    + (skipItems.length
                        ? `<div class="band-sv-skips">겹치는 주 <strong>${skipItems.length}주</strong> → 건너뛰기권 ${skipItems.length}장
                           <ul>${skipItems.map(s => `<li><span class="d">${_bandMDW(s.date)}</span> <span>${_bandRangeText(s.def.start_time, s.def.end_time)} · ${escHtml(s.reasons.join(', '))}</span></li>`).join('')}</ul>
                           <div class="band-sv-note">주마다 같은 고정 사용 시간의 대체 합주(건너뛰는 날 앞뒤 1주일 안) 또는 1주 무료 연장 중 하나를 고를 수 있어요. 건너뛰는 날 일주일 전까지 고르지 않으면 자동으로 1주 연장돼요. 팀 사정으로 일정이 어려운 날은 이용 기간 중 1회 대체 합주를 직접 요청할 수 있어요(건너뛸 날 3일 전까지).</div></div>`
                        : `<div class="band-sv-skips">예상 사용 기간(${bandMD(ctx.startDate)}~${bandMD(ctx.endDate)}) 안에 겹치는 일정이 없어요.</div>`)
                    + '</div>';
            } else detail = '<div class="band-sv-hint">타임을 누르면 선택돼요 · 여러 개 가능 · 「N주 건너뛰기」는 그 주만 건너뛰는 조건으로 신청할 수 있어요.</div>';
            // 요약(처음 보는 사람용): 시작일·기간 기준 바로 가능 / 건너뛰기 조건 / 날짜 지정 수 — 시간표 화면은 타일, 가입 폼은 한 줄
            const cnt = (k) => rows.filter(r => r.st.kind === k).length;
            const nLater = rows.filter(r => r.st.from).length, nNo = cnt('taken') + cnt('wait') + cnt('off');
            const period = `${_bandMDW(ctx.startDate)}부터 ${bandWishMonths()}개월 · ~${bandMD(ctx.endDate)}`;
            const tiles = `<div class="band-sv-period">${period} 기준</div><div class="band-sv-stats">
                <div class="band-sv-stat ok"><b>${cnt('ok')}</b><span>바로 가능</span></div>
                <div class="band-sv-stat skip"><b>${cnt('skip')}</b><span>건너뛰기 조건</span></div>
                <div class="band-sv-stat later"><b>${nLater}</b><span>날짜 지정</span></div></div>`;
            const summary = `<div class="band-avail-summary"><strong>${period} 기준</strong> · 바로 가능 <b>${cnt('ok')}</b>개 · 건너뛰기 조건 <b>${cnt('skip')}</b>개 · 날짜 지정 <b>${nLater}</b>개${nNo ? ` · 불가 ${nNo}개` : ''}</div>`;
            const table = bandAvailTableHTML(rows, { selectable: true, selected: _bandSignupSel, onToggle: 'bandSignupToggleSlot', onInfo: 'bandScheduleChipInfo', publicView: true });
            _bandAvailBodies().forEach(body => { body.innerHTML = (body.id === 'bandScheduleBody' ? tiles : summary + _bandAvailLegend()) + table + detail; });
            const next = document.getElementById('bandScheduleNextBtn');
            if (next) { next.disabled = false; next.textContent = picked.length ? `이 타임으로 가입 신청하기 (${picked.length}개)` : '가입 신청으로'; }
        }
        function bandSignupToggleSlot(id) { if (_bandSignupSel.has(id)) _bandSignupSel.delete(id); else _bandSignupSel.add(id); bandSignupAvailRender(); bandSignupDepositNote(); }
        // 선택한 띠의 4주 이용료 합(모든 띠에 fee 가 있을 때만) — 보증금(1개월분)과 같은 금액. 없으면 null(접수 문자가 금액 없이 안내)
        function bandSignupFeeOf(defs) {
            if (!defs || !defs.length || !defs.every(d => Number(d.fee) > 0)) return null;
            return defs.reduce((n, d) => n + Number(d.fee), 0);
        }
        function bandSignupDepositNote() {
            const el = document.getElementById('bandSignupDepositNote'); if (!el) return;
            const picked = bandSignupSelection();
            const fee = picked ? bandSignupFeeOf(picked.defs) : null;
            el.innerHTML = fee
                ? `선택한 타임 기준 4주 이용료 <strong>${bandWon(fee)}</strong> → 접수 문자로 <strong>보증금(1개월분) ${bandWon(fee)}</strong> 입금 계좌를 안내해드려요. 입금이 확인되면 운영팀이 가입을 승인하고, 등록 회차 이용료는 시작일 전날까지 입금해요.`
                : `신청이 접수되면 문자로 <strong>보증금(1개월분 = 4주 이용료)</strong> 입금 계좌를 안내해드려요. 입금이 확인되면 운영팀이 가입을 승인합니다.`;
        }
        // 가입 신청 제출용: 새 표가 살아 있으면 {defs, start} / 폴백(종전 체크박스)이면 null
        function bandSignupSelection() {
            if (!_bandSignupUsesTable()) return null;
            return { start: bandWishStart(), months: bandWishMonths(), defs: _bandSignupAvail.rows.filter(r => _bandSignupSel.has(r.def.id)).map(r => r.def) };
        }

        // ── 관리자: 승인(달력 반영)·고정 시간 등록·건너뛰기권 부여·해제 ──
        const _bandBlockReason = (t) => `[고정팀] ${(t.band_name_kr || t.name || '').trim()}`;
        const _bandSubReason = (t) => `[고정팀 대체] ${(t.band_name_kr || t.name || '').trim()}`;
        const _bandCache = () => state.bandAdminCache || {};
        // 반복 차단 생성(마이그레이션 전이면 새 컬럼 없이 재시도) → block id | null
        async function _bandInsertBlock(row) {
            let { data, error } = await supabaseClient.from('time_blocks').insert(row).select('id').single();
            if (error && /band_claim_id|skip_dates/.test(error.message || '')) {
                const { band_claim_id, skip_dates, ...plain } = row;
                ({ data, error } = await supabaseClient.from('time_blocks').insert(plain).select('id').single());
                if (!error) showToast('time_blocks 에 band_claim_id/skip_dates 컬럼이 없어 건너뛰기 없이 차단했습니다. 20261105 마이그레이션을 실행해주세요.', 6000);
            }
            if (error) throw error;
            return data && data.id ? data.id : null;
        }
        function _bandClaimKeys(claims, defs) {
            return [...new Set((claims || []).map(c => { const d = (defs || []).find(x => x.id === c.def_id); return bandSlotLegacyKey(d || c); }))];
        }
        // 승인 폼(가입 신청 카드 안): 시작일 + 신청 타임별 겹침 계산 결과
        const _bandApprovalCtx = {};
        async function openBandApproval(id) {
            const box = document.getElementById(`ba-form-${id}`); if (!box) return;
            if (!box.hidden) { box.hidden = true; return; }
            const t = (_bandCache().teams || []).find(x => x.id === id) || {};
            const claims = ((_bandCache().claimsMap || {})[id] || []).filter(c => c.status === 'pending');
            const today = bandTodayStr();
            const start = claims.map(c => c.start_date).filter(Boolean).sort()[0] || t.band_start_date || today;
            box.innerHTML = `
                <div class="band-form-grid">
                    <label>시작일<input type="date" id="ba-start-${id}" class="band-input" value="${escAttr(start < today ? today : start)}" min="${today}" onchange="bandApprovalRecalc('${id}')"></label>
                    <label>달력 반영<select id="ba-mode-${id}" class="band-input"><option value="1">차단 생성 + 건너뛰기권 발급</option><option value="0">승인만(달력 미반영)</option></select></label>
                </div>
                <div id="ba-claims-${id}">${_bandLoadingHTML()}</div>
                <div id="ba-result-${id}" class="band-form-result"></div>
                <div class="gaa-btn-row">
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="bandApproveWithSlots('${id}', this)">승인</button>
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="openBandApproval('${id}')">취소</button>
                </div>`;
            box.hidden = false;
            await bandApprovalRecalc(id);
        }
        async function bandApprovalRecalc(id) {
            const list = document.getElementById(`ba-claims-${id}`); if (!list) return;
            const start = document.getElementById(`ba-start-${id}`)?.value;
            if (!start) { list.innerHTML = _bandEmptyHTML('시작일을 선택해주세요.'); return; }
            const claims = ((_bandCache().claimsMap || {})[id] || []).filter(c => c.status === 'pending');
            list.innerHTML = _bandLoadingHTML();
            const team = (_bandCache().teams || []).find(x => x.id === id) || {};
            const months = bandMonthsFromText(team.band_expected_months); // 가입 때 적은 예상 사용 기간 안에서만 겹침을 찾는다
            const ctx = await bandAvailLoad(start, bandAvailDaysFor(start, months));
            const items = claims.map(c => {
                const def = ctx.defs.find(d => d.id === c.def_id);
                const st = bandDefStatus({ ...(def || {}), ...c, band_ok: true, open_from: def ? def.open_from : null }, ctx, { excludeProfile: id });
                return { claim: c, def, st };
            });
            _bandApprovalCtx[id] = { ctx, items, start };
            list.innerHTML = `<div class="band-muted" style="margin-bottom:4px">예상 사용 기간 ${months}개월(${bandMD(ctx.startDate)}~${bandMD(ctx.endDate)}) 안의 겹침만 건너뛰기권으로 발급합니다.</div>` + (items.length ? items.map(({ claim, def, st }) => `
                <div class="band-ba-claim">
                    <label><input type="checkbox" id="ba-c-${claim.id}" checked> <strong>${escHtml(def ? bandDefText(def) : bandClaimText(claim))}</strong></label>
                    <span class="status-badge sm ${BAND_KIND_CHIP[st.kind] || 'status-neutral'}">${escHtml(st.kind === 'ok' ? '겹침 없음' : st.label)}</span>
                    ${st.skips.length ? `<ul class="band-avail-skips">${st.skips.map(s => `<li>${_bandMDW(s.date)} · ${escHtml(s.reasons.join(', '))} → 건너뛰기권</li>`).join('')}</ul>` : ''}
                </div>`).join('') : _bandEmptyHTML('신청한 타임이 없습니다.'));
        }
        async function bandApproveWithSlots(id, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const res = document.getElementById(`ba-result-${id}`);
            const showErr = (m) => { if (res) { res.textContent = m; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const prep = _bandApprovalCtx[id];
            const start = document.getElementById(`ba-start-${id}`)?.value;
            if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) { showErr('시작일을 선택해주세요.'); return; }
            if (!prep || prep.start !== start) { await bandApprovalRecalc(id); }
            const { ctx, items } = _bandApprovalCtx[id] || { ctx: null, items: [] };
            const makeBlocks = (document.getElementById(`ba-mode-${id}`)?.value || '1') === '1';
            const t = (_bandCache().teams || []).find(x => x.id === id) || { id };
            _bandBusy(btn, true, '승인 중…');
            try {
                const approved = [];
                for (const { claim, st } of items) {
                    const on = document.getElementById(`ba-c-${claim.id}`)?.checked !== false;
                    if (!on) { await supabaseClient.from('band_slot_claims').update({ status: 'rejected' }).eq('id', claim.id); continue; }
                    let blockId = null;
                    if (makeBlocks) {
                        blockId = await _bandInsertBlock({ day_of_week: claim.day_of_week, start_time: claim.start_time, end_time: _bandBlockEnd(claim.end_time),
                            reason: _bandBlockReason(t), start_date: start, end_date: null, band_claim_id: claim.id, skip_dates: st.skips.map(s => s.date) });
                    }
                    const { error } = await supabaseClient.from('band_slot_claims').update({ status: 'approved', start_date: start, block_id: blockId, approved_at: new Date().toISOString() }).eq('id', claim.id);
                    if (error) throw error;
                    if (makeBlocks && st.skips.length) {
                        const { error: sErr } = await supabaseClient.from('band_skips').insert(st.skips.map(s => ({ profile_id: id, claim_id: claim.id, skip_date: s.date, skip_start: claim.start_time, skip_end: claim.end_time, reason: s.reasons.join(', '), granted_by: 'signup' })));
                        if (sErr) throw sErr;
                    }
                    approved.push(claim);
                }
                const upd = { status: 'approved' };
                if (!t.band_start_date) upd.band_start_date = start;
                if (approved.length) upd.timeslots = _bandClaimKeys(approved, ctx ? ctx.defs : []);
                const { error: pErr } = await supabaseClient.from('profiles').update(upd).eq('id', id);
                if (pErr) throw pErr;
                showToast(approved.length ? `가입을 승인하고 고정 시간 ${approved.length}개를 달력에 반영했습니다.` : '가입을 승인했습니다.');
                _bandSendSms(id, 'approve', { delay: 1500 }).catch(() => {});
                renderBandAdminTab();
                fetchAndRenderBandTeamList();
                if (typeof fetchBlocks === 'function') fetchBlocks().catch(() => {});
            } catch (e) { console.error('band approve(slots):', e); showErr('승인 처리 중 오류가 났습니다. 다시 시도해주세요. (' + (e.message || e) + ')'); }
            finally { _bandBusy(btn, false); }
        }
        // 승인된 팀 카드: 고정 시간·건너뛰기권 섹션
        function bandSlotSectionHTML(t, claims, skips, defs) {
            const today = bandTodayStr();
            const approved = (claims || []).filter(c => c.status === 'approved');
            const claimRows = approved.length ? approved.map(c => `
                <div class="band-slot-row">
                    <span><strong>${escHtml(bandClaimText(c))}</strong> <span class="band-muted">· ${bandMD(c.start_date)}부터</span> ${c.block_id ? '' : '<span class="status-badge sm status-pending">달력 미반영</span>'}</span>
                    <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="bandEndClaim('${c.id}', this)">해제</button>
                </div>`).join('')
                : `<div class="band-muted">달력에 반영된 고정 시간이 없습니다${t.timeslots && t.timeslots.length ? ` (가입 때 타임: ${escHtml(bandSlotSheetText(t.timeslots))})` : ''}. [+ 고정 시간]으로 등록하면 멤버 예약·대관 달력에서 그 시간이 막힙니다.</div>`;
            const upcoming = (skips || []).filter(s => s.skip_date >= today), past = (skips || []).filter(s => s.skip_date < today);
            const skipRow = (s) => `<div class="band-slot-row"><span>${_bandMDW(s.skip_date)} ${_bandRangeText(s.skip_start, s.skip_end)}${s.reason ? ` <span class="band-muted">· ${escHtml(s.reason)}</span>` : ''} ${bandSkipStatusChip(s, today)}</span>
                <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="bandSkipDelete('${s.id}', this)">삭제</button></div>`;
            const defOpts = (defs || []).map(d => `<option value="${d.id}">${escHtml(bandDefText(d))}${d.band_ok === false ? ' (신청 불가)' : ''}</option>`).join('');
            const grantOpts = _bandUpcomingSessions(approved, today, 10).map(o => `<option value="${o.date}|${o.claim.id}">${_bandMDW(o.date)} ${_bandRangeText(o.claim.start_time, o.claim.end_time)}</option>`).join('');
            return `
                <div class="band-card-section">
                    <div class="band-card-head"><span>📅 고정 시간·건너뛰기권</span>
                        <div class="gaa-btn-row">
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="toggleBandBox('bs-reg-${t.id}')">+ 고정 시간</button>
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="toggleBandBox('bs-skip-${t.id}')"${approved.length ? '' : ' disabled'}>+ 건너뛰기권</button>
                        </div></div>
                    ${claimRows}
                    ${upcoming.length ? `<div class="band-muted" style="margin-top:8px;font-weight:600">건너뛰기권 ${upcoming.length}장</div>${upcoming.map(skipRow).join('')}` : ''}
                    ${past.length ? `<details class="band-skip-past"><summary class="band-muted">지난 건너뛰기 ${past.length}건</summary>${past.map(skipRow).join('')}</details>` : ''}
                    <div id="bs-reg-${t.id}" class="band-inline-form" hidden>
                        <div class="band-form-grid">
                            <label>시간 띠<select id="bs-def-${t.id}" class="band-input">${defOpts || '<option value="">시간 띠가 없습니다</option>'}</select></label>
                            <label>시작일<input type="date" id="bs-start-${t.id}" class="band-input" value="${escAttr(t.band_start_date && t.band_start_date > today ? t.band_start_date : today)}"></label>
                        </div>
                        <div class="band-muted" style="margin-bottom:6px">시작일부터 매주 그 시간이 달력에서 막히고, 이미 잡힌 예약·대관과 겹치는 주는 건너뛰기권으로 발급됩니다.</div>
                        <div id="bs-reg-result-${t.id}" class="band-form-result"></div>
                        <div class="gaa-btn-row">
                            <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="bandRegisterSlot('${t.id}', this)">등록</button>
                            <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="toggleBandBox('bs-reg-${t.id}')">취소</button>
                        </div>
                    </div>
                    <div id="bs-skip-${t.id}" class="band-inline-form" hidden>
                        <div class="band-form-grid">
                            <label>건너뛸 합주일<select id="bg-date-${t.id}" class="band-input">${grantOpts || '<option value="">예정된 합주일이 없습니다</option>'}</select></label>
                            <label>사유<input type="text" id="bg-reason-${t.id}" class="band-input" placeholder="예: 공연 대관 · 통화로 협의"></label>
                        </div>
                        <div class="band-muted" style="margin-bottom:6px">그날은 달력에서 열리고, 팀이 대체 합주(앞뒤 1주일 안, 같은 고정 사용 시간) 또는 1주 무료 연장 중 하나를 고릅니다(일주일 전까지 미선택이면 자동 연장).</div>
                        <div id="bg-result-${t.id}" class="band-form-result"></div>
                        <div class="gaa-btn-row">
                            <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="bandGrantSkip('${t.id}', this)">부여</button>
                            <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="toggleBandBox('bs-skip-${t.id}')">취소</button>
                        </div>
                    </div>
                </div>`;
        }
        function bandSkipStatusChip(s, today = bandTodayStr()) {
            const r = bandSkipResolution(s, today);
            if (r === 'substitute') return `<span class="status-badge sm status-approved">대체 ${_bandMDW(s.substitute_date)} ${_bandRangeText(s.substitute_start, s.substitute_end)}</span>`;
            if (r === 'extend') return `<span class="status-badge sm status-info">${s.resolution ? '1주 연장' : '1주 자동 연장'}</span>`;
            return `<span class="status-badge sm status-pending">미선택 · ${bandMD(bandSkipDeadline(s))}까지</span>`;
        }
        // 승인된 타임들의 앞으로 올 합주일(날짜순) — 건너뛰기권 부여 후보
        function _bandUpcomingSessions(claims, today, n) {
            const out = [];
            for (const c of claims) {
                if (!c.block_id && c.status !== 'approved') continue;
                const from = c.start_date > today ? c.start_date : today;
                for (const d of bandDefDates(c.day_of_week, from, _bandAddDays(from, 7 * n))) { if (!c.end_date || d <= c.end_date) out.push({ date: d, claim: c }); }
            }
            return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, n);
        }
        async function bandRegisterSlot(teamId, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const res = document.getElementById(`bs-reg-result-${teamId}`);
            const showErr = (m) => { if (res) { res.textContent = m; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const defId = document.getElementById(`bs-def-${teamId}`)?.value, start = document.getElementById(`bs-start-${teamId}`)?.value;
            if (!defId) { showErr('시간 띠를 선택해주세요.'); return; }
            if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) { showErr('시작일을 선택해주세요.'); return; }
            const t = (_bandCache().teams || []).find(x => x.id === teamId) || { id: teamId };
            _bandBusy(btn, true, '등록 중…');
            try {
                const ctx = await bandAvailLoad(start, bandAvailDaysFor(start, bandMonthsFromText(t.band_expected_months)));
                const def = ctx.defs.find(d => d.id === defId);
                if (!def) { showErr('시간 띠를 찾을 수 없습니다.'); return; }
                const st = bandDefStatus({ ...def, band_ok: true, open_from: null }, ctx, { excludeProfile: teamId });
                if (st.kind === 'taken' || st.kind === 'wait') { showErr(`이 시간은 ${st.kind === 'wait' ? '다른 팀이 신청 대기 중' : (st.who || '사용 중')}입니다${st.from ? ` (${bandMD(st.from)}부터 가능)` : ''}.`); return; }
                const { data: claim, error } = await supabaseClient.from('band_slot_claims')
                    .insert({ profile_id: teamId, def_id: def.id, day_of_week: def.day_of_week, start_time: def.start_time, end_time: def.end_time, start_date: start, status: 'approved', approved_at: new Date().toISOString() })
                    .select().single();
                if (error) throw error;
                const blockId = await _bandInsertBlock({ day_of_week: def.day_of_week, start_time: def.start_time, end_time: _bandBlockEnd(def.end_time),
                    reason: _bandBlockReason(t), start_date: start, end_date: null, band_claim_id: claim.id, skip_dates: st.skips.map(s => s.date) });
                await supabaseClient.from('band_slot_claims').update({ block_id: blockId }).eq('id', claim.id);
                if (st.skips.length) {
                    const { error: sErr } = await supabaseClient.from('band_skips').insert(st.skips.map(s => ({ profile_id: teamId, claim_id: claim.id, skip_date: s.date, skip_start: def.start_time, skip_end: def.end_time, reason: s.reasons.join(', '), granted_by: 'signup' })));
                    if (sErr) throw sErr;
                }
                const upd = { timeslots: [...new Set([...(t.timeslots || []), bandSlotLegacyKey(def)])] };
                if (!t.band_start_date) upd.band_start_date = start;
                await supabaseClient.from('profiles').update(upd).eq('id', teamId);
                showToast(`고정 시간을 달력에 반영했습니다${st.skips.length ? ` · 건너뛰기권 ${st.skips.length}장 발급` : ''}.`);
                renderBandAdminTab();
                fetchAndRenderBandTeamList();
            } catch (e) { console.error('band register slot:', e); showErr('등록하지 못했습니다. (' + (e.message || e) + ')'); }
            finally { _bandBusy(btn, false); }
        }
        async function bandGrantSkip(teamId, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const res = document.getElementById(`bg-result-${teamId}`);
            const showErr = (m) => { if (res) { res.textContent = m; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const v = document.getElementById(`bg-date-${teamId}`)?.value || '';
            const [date, claimId] = v.split('|');
            if (!date || !claimId) { showErr('건너뛸 합주일을 선택해주세요.'); return; }
            const claim = ((_bandCache().claimsMap || {})[teamId] || []).find(c => c.id === claimId);
            if (!claim) { showErr('고정 시간을 찾을 수 없습니다.'); return; }
            const reason = (document.getElementById(`bg-reason-${teamId}`)?.value || '').trim();
            _bandBusy(btn, true, '부여 중…');
            try {
                const { error } = await supabaseClient.from('band_skips').insert({ profile_id: teamId, claim_id: claim.id, skip_date: date, skip_start: claim.start_time, skip_end: claim.end_time, reason: reason || '운영자 부여', granted_by: 'admin' });
                if (error) { showErr(error.code === '23505' ? '그날은 이미 건너뛰기권이 있습니다.' : '부여하지 못했습니다. (' + error.message + ')'); return; }
                await _bandBlockSkipDates(claim.block_id, date, true);
                showToast(`${_bandMDW(date)} 건너뛰기권을 부여했습니다.`);
                renderBandAdminTab();
            } finally { _bandBusy(btn, false); }
        }
        // 반복 차단의 skip_dates 에 날짜 추가/제거
        async function _bandBlockSkipDates(blockId, date, add) {
            if (!blockId || !supabaseClient) return;
            const { data } = await supabaseClient.from('time_blocks').select('id,skip_dates').eq('id', blockId).maybeSingle();
            if (!data) return;
            const cur = Array.isArray(data.skip_dates) ? data.skip_dates : [];
            const next = add ? [...new Set([...cur, date])].sort() : cur.filter(d => d !== date);
            const { error } = await supabaseClient.from('time_blocks').update({ skip_dates: next }).eq('id', blockId);
            if (error) console.error('skip_dates update:', error);
            if (typeof fetchBlocks === 'function') fetchBlocks().catch(() => {});
        }
        async function bandSkipDelete(skipId, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const all = Object.values(_bandCache().skipsMap || {}).flat();
            const s = all.find(x => x.id === skipId);
            if (!s) return;
            if (!confirm(`${_bandMDW(s.skip_date)} 건너뛰기권을 삭제할까요? 그날은 다시 고정 시간으로 막히고, 대체 합주가 있었다면 함께 취소됩니다.`)) return;
            _bandBusy(btn, true);
            try {
                const { error } = await supabaseClient.from('band_skips').delete().eq('id', skipId);
                if (error) { showToast('삭제하지 못했습니다.'); return; }
                if (s.substitute_block_id) await supabaseClient.from('time_blocks').delete().eq('id', s.substitute_block_id);
                const claim = ((_bandCache().claimsMap || {})[s.profile_id] || []).find(c => c.id === s.claim_id);
                if (claim && claim.block_id) await _bandBlockSkipDates(claim.block_id, s.skip_date, false);
                showToast('건너뛰기권을 삭제했습니다.');
                renderBandAdminTab();
            } finally { _bandBusy(btn, false); }
        }
        async function bandEndClaim(claimId, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const all = Object.values(_bandCache().claimsMap || {}).flat();
            const c = all.find(x => x.id === claimId);
            if (!c) return;
            if (!confirm(`${bandClaimText(c)} 고정 시간을 해제할까요? 오늘 이후 달력에서 열립니다.`)) return;
            _bandBusy(btn, true);
            try { await _bandEndClaims([c], bandTodayStr()); showToast('고정 시간을 해제했습니다.'); renderBandAdminTab(); fetchAndRenderBandTeamList(); }
            finally { _bandBusy(btn, false); }
        }
        // 종료 예정일을 팀의 승인된 타임 신청·반복 차단 end_date 에 반영(null 이면 기한 없음으로 되돌림) — 달력이 그다음 날부터 열린다
        async function _bandApplyEndDate(teamId, endDate) {
            if (!supabaseClient) return;
            const claims = (((state.bandAdminCache || {}).claimsMap || {})[teamId] || []).filter(c => c.status === 'approved');
            for (const c of claims) {
                await supabaseClient.from('band_slot_claims').update({ end_date: endDate }).eq('id', c.id);
                if (c.block_id) await supabaseClient.from('time_blocks').update({ end_date: endDate }).eq('id', c.block_id);
            }
            if (typeof fetchBlocks === 'function') fetchBlocks().catch(() => {});
        }
        // 타임 종료: 신청 ended + 반복 차단 end_date — 탈퇴 처리와 공유
        async function _bandEndClaims(claims, endDate) {
            for (const c of claims) {
                await supabaseClient.from('band_slot_claims').update({ status: 'ended', end_date: endDate }).eq('id', c.id);
                if (c.block_id) await supabaseClient.from('time_blocks').update({ end_date: endDate }).eq('id', c.block_id);
            }
            if (typeof fetchBlocks === 'function') fetchBlocks().catch(() => {});
        }

        // ── 관리자 탭 「⏱️ 시간 띠」: 정의 편집 + 기준 시작일로 본 실시간 상태 ──
        async function renderBandSlotsTab(view) {
            const today = bandTodayStr();
            const start = state.bandSlotsStart && state.bandSlotsStart >= today ? state.bandSlotsStart : today;
            state.bandSlotsStart = start;
            const ctx = await bandAvailLoad(start);
            if (_bandSlotsUnavailable) { view.innerHTML = _bandEmptyHTML('band_slot_defs 표가 없습니다. supabase/migrations/20261105_band_slots.sql 을 SQL Editor 에서 실행해주세요.'); return; }
            const rows = ctx.defs.map(def => ({ def, st: bandDefStatus(def, ctx) }));
            const timeOpt = (sel) => TIMES.map(t => `<option value="${t}"${t === sel ? ' selected' : ''}>${t}</option>`).join('');
            const endOpt = (sel) => TIMES.map((t, i) => { const e = TIMES[i + 1] || '23:00'; return `<option value="${e}"${e === sel ? ' selected' : ''}>${e}</option>`; }).join('');
            const defRow = (d) => `
                <div class="band-def-row" id="def-row-${d.id}">
                    <div class="band-def-main"><strong>${BAND_DOW[d.day_of_week]} ${_bandRangeText(d.start_time, d.end_time)}</strong> <span class="band-muted">${escHtml(d.label || '')}${d.fee ? ` · 4주 ${bandWon(d.fee)}` : ''}</span>
                        <span class="status-badge sm ${BAND_KIND_CHIP[rows.find(r => r.def.id === d.id)?.st.kind] || 'status-neutral'}">${escHtml(rows.find(r => r.def.id === d.id)?.st.label || '')}</span></div>
                    <div class="band-def-ctl">
                        <label class="band-def-chk"><input type="checkbox" id="def-ok-${d.id}"${d.band_ok !== false ? ' checked' : ''}> 고정팀</label>
                        <label class="band-def-chk"><input type="checkbox" id="def-rent-${d.id}"${d.rental_ok !== false ? ' checked' : ''}> 대관</label>
                        <select id="def-off-${d.id}" class="band-input" title="고정팀을 끄면 표에 보일 사유"><option value="rental"${d.off_reason !== 'team' ? ' selected' : ''}>불가 사유: 대관만</option><option value="team"${d.off_reason === 'team' ? ' selected' : ''}>불가 사유: 고정팀 사용 중</option></select>
                        <input type="date" id="def-from-${d.id}" class="band-input" value="${escAttr(d.open_from || '')}" title="이 날짜부터 신청 가능">
                        <input type="number" id="def-fee-${d.id}" class="band-input" value="${d.fee ?? ''}" min="0" step="1000" placeholder="4주 이용료(원)" title="4주 이용료 — 보증금(1개월분)도 같은 금액으로 가입 접수 문자에 안내">
                        <input type="text" id="def-note-${d.id}" class="band-input" value="${escAttr(d.note || '')}" placeholder="메모(운영자용)">
                        <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" onclick="bandDefSave('${d.id}', this)">저장</button>
                        <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="bandDefDelete('${d.id}', this)">삭제</button>
                    </div>
                </div>`;
            view.innerHTML = `
                <div class="band-roster-toolbar">
                    <label class="band-muted" style="display:flex;align-items:center;gap:6px">기준 시작일 <input type="date" class="band-input" style="width:auto;height:36px" value="${start}" min="${today}" onchange="state.bandSlotsStart=this.value;renderBandAdminTab()"></label>
                    <span class="band-muted">가입 화면이 이 표를 실시간으로 보여줍니다</span>
                </div>
                ${_bandAvailLegend()}
                ${bandAvailTableHTML(rows, { selectable: false })}
                <div class="band-roster-title">시간 띠 정의 <span class="band-muted">${ctx.defs.length}개</span></div>
                <div class="band-muted" style="margin:-4px 0 8px">고정팀 체크를 끄면 불가 사유(「대관만」 또는 「고정팀 사용 중」)로 보이고, 개방일을 넣으면 그 날짜부터 신청 가능. 팀 관리 [+ 고정 시간]으로 달력에 반영된 띠는 자동으로 「고정팀 사용 중」이 되니 그때 고정팀 체크를 다시 켜세요.</div>
                ${ctx.defs.map(defRow).join('') || _bandEmptyHTML('정의된 시간 띠가 없습니다.')}
                <div class="band-inline-form">
                    <div class="band-card-head"><span>+ 시간 띠 추가</span></div>
                    <div class="band-def-ctl">
                        <select id="def-new-dow" class="band-input">${BAND_DOW_ORDER.map(d => `<option value="${d}">${BAND_DOW[d]}</option>`).join('')}</select>
                        <select id="def-new-start" class="band-input">${timeOpt('12:00')}</select>
                        <span>~</span>
                        <select id="def-new-end" class="band-input">${endOpt('18:00')}</select>
                        <select id="def-new-label" class="band-input"><option value="오전">오전</option><option value="주간" selected>주간</option><option value="야간">야간</option></select>
                        <input type="number" id="def-new-fee" class="band-input" min="0" step="1000" placeholder="4주 이용료(원)">
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="bandDefAdd(this)">추가</button>
                    </div>
                    <div id="def-new-result" class="band-form-result"></div>
                </div>`;
        }
        async function bandDefSave(id, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const feeRaw = (document.getElementById(`def-fee-${id}`)?.value || '').trim();
            const fee = feeRaw === '' ? null : parseInt(feeRaw, 10);
            if (feeRaw !== '' && !(Number.isInteger(fee) && fee >= 0)) { showToast('4주 이용료는 숫자(원)로 적어주세요.'); return; }
            const upd = { band_ok: !!document.getElementById(`def-ok-${id}`)?.checked, rental_ok: !!document.getElementById(`def-rent-${id}`)?.checked,
                open_from: document.getElementById(`def-from-${id}`)?.value || null, note: (document.getElementById(`def-note-${id}`)?.value || '').trim() || null,
                off_reason: document.getElementById(`def-off-${id}`)?.value === 'team' ? 'team' : 'rental', fee };
            _bandBusy(btn, true);
            let { error } = await supabaseClient.from('band_slot_defs').update(upd).eq('id', id);
            // 새 컬럼 마이그레이션 전이면 그 값만 빼고 다시 저장(off_reason 2026-11-05 / fee 2026-11-07)
            for (const [col, mig] of [['off_reason', '20261105_band_slot_off_reason'], ['fee', '20261107_band_slot_def_fee']]) {
                if (!error || !new RegExp(col).test(error.message || '')) continue;
                delete upd[col];
                ({ error } = await supabaseClient.from('band_slot_defs').update(upd).eq('id', id));
                if (!error) showToast(`${col} 컬럼이 없어 그 값 없이 저장했습니다. ${mig}.sql 을 실행해주세요.`, 6000);
            }
            _bandBusy(btn, false);
            if (error) { console.error(error); showToast('저장하지 못했습니다.'); return; }
            showToast('시간 띠를 저장했습니다.'); renderBandAdminTab();
        }
        async function bandDefDelete(id, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            if (!confirm('이 시간 띠를 삭제할까요? 이미 승인된 팀의 차단은 그대로 남습니다.')) return;
            _bandBusy(btn, true);
            const { error } = await supabaseClient.from('band_slot_defs').delete().eq('id', id);
            _bandBusy(btn, false);
            if (error) { console.error(error); showToast('삭제하지 못했습니다.'); return; }
            showToast('시간 띠를 삭제했습니다.'); renderBandAdminTab();
        }
        async function bandDefAdd(btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const res = document.getElementById('def-new-result');
            const showErr = (m) => { if (res) { res.textContent = m; res.style.color = '#e74c3c'; } };
            const dow = parseInt(document.getElementById('def-new-dow').value, 10), s = document.getElementById('def-new-start').value, e = document.getElementById('def-new-end').value, label = document.getElementById('def-new-label').value;
            if (!(TIMES.indexOf(s) < TIMES.indexOf(_bandBlockEnd(e)) + 1)) { showErr('끝 시각이 시작보다 늦어야 합니다.'); return; }
            const feeRaw = (document.getElementById('def-new-fee')?.value || '').trim();
            const row = { day_of_week: dow, start_time: s, end_time: e, label, band_ok: true, rental_ok: true };
            if (feeRaw !== '') { const f = parseInt(feeRaw, 10); if (!(Number.isInteger(f) && f >= 0)) { showErr('4주 이용료는 숫자(원)로 적어주세요.'); return; } row.fee = f; }
            _bandBusy(btn, true);
            let { error } = await supabaseClient.from('band_slot_defs').insert(row);
            if (error && 'fee' in row && /fee/.test(error.message || '')) { delete row.fee; ({ error } = await supabaseClient.from('band_slot_defs').insert(row)); if (!error) showToast('fee 컬럼이 없어 이용료 없이 추가했습니다. 20261107_band_slot_def_fee.sql 을 실행해주세요.', 6000); }
            _bandBusy(btn, false);
            if (error) { showErr(error.code === '23505' ? '같은 요일·시작 시각의 띠가 이미 있습니다.' : '추가하지 못했습니다. (' + error.message + ')'); return; }
            showToast('시간 띠를 추가했습니다.'); renderBandAdminTab();
        }

        // ── 팀 본인 화면: 내 고정 시간·건너뛰기권(보상 선택) ──
        async function renderBandSlotSection(profile) {
            const sec = document.getElementById('bandSlotSection');
            if (!sec) return;
            if (!profile || !supabaseClient || _isAdminBandProfile(profile)) { sec.classList.add('hidden'); return; }
            const [claims, skipsMap] = await Promise.all([fetchBandSlotClaims([profile.id]), fetchBandSkips([profile.id])]);
            const skips = skipsMap[profile.id] || [];
            state.bandMyClaims = claims; state.bandSkips = skips;
            profile._ext = bandExtDates(skips);
            renderBandHomeTiles(); // 요약 타일 「고정 시간」은 승인된 타임으로
            const approved = claims.filter(c => c.status === 'approved'), pending = claims.filter(c => c.status === 'pending');
            if (!claims.length && !skips.length) { sec.classList.add('hidden'); return; }
            const today = bandTodayStr();
            const upcoming = skips.filter(s => s.skip_date >= today), past = skips.filter(s => s.skip_date < today);
            const skipRow = (s) => {
                const r = bandSkipResolution(s, today);
                let right;
                if (r === 'substitute') right = `<span class="status-badge sm status-approved">대체 합주 ${_bandMDW(s.substitute_date)} ${_bandRangeText(s.substitute_start, s.substitute_end)}</span>`;
                else if (r === 'extend') right = `<span class="status-badge sm status-info">${s.resolution ? '1주 무료 연장' : '1주 자동 연장'}</span>`;
                else right = `<div class="gaa-btn-row"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" onclick="bandSubstituteSheet('${s.id}')">대체 합주 고르기</button><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="bandSkipExtend('${s.id}', this)">1주 연장</button></div>`;
                return `<div class="band-skip-row${s.skip_date < today ? ' past' : ''}">
                    <div><strong>${_bandMDW(s.skip_date)}</strong> ${_bandRangeText(s.skip_start, s.skip_end)} 건너뛰기${s.reason ? ` <span class="band-muted">· ${escHtml(s.reason)}</span>` : ''}
                        ${!r ? `<div class="band-muted">${bandMD(bandSkipDeadline(s))}까지 고르지 않으면 1주 무료 연장으로 자동 처리돼요.</div>` : ''}</div>
                    <div class="band-skip-right">${right}</div></div>`;
            };
            sec.classList.remove('hidden');
            sec.innerHTML = `
                <div class="band-section-head"><span class="band-section-title">📅 합주 시간·건너뛰기권</span>${upcoming.length ? `<span class="status-badge sm status-info">권 ${upcoming.length}장</span>` : ''}</div>
                ${approved.length ? `<div class="band-kv-grid">${approved.map(c => `<div class="band-kv"><span>매주 ${BAND_DOW[c.day_of_week]}요일</span><strong>${_bandRangeText(c.start_time, c.end_time)}<span class="band-muted" style="font-weight:400"> · ${bandMD(c.start_date)}부터</span></strong></div>`).join('')}</div>` : ''}
                ${pending.length ? `<div class="band-muted" style="margin-top:6px">승인 대기 중인 타임: ${escHtml(bandClaimsText(pending))}</div>` : ''}
                ${approved.some(c => c.block_id) ? (() => { const used = bandTeamSubUsed(skips); return `<div class="band-skip-row" id="bandTeamSubRow" style="margin-top:8px"><div><strong>대체 합주 요청권</strong> <span class="band-muted">· 이용 기간 중 1회 · 팀 사정으로 일정이 어려운 날, 건너뛸 날 ${BAND_TEAM_SUB_MIN_DAYS}일 전까지</span>${used ? `<div class="band-muted">${_bandMDW(used.skip_date)} 대신 ${_bandMDW(used.substitute_date)} ${_bandRangeText(used.substitute_start, used.substitute_end)} 로 사용했어요.</div>` : ''}</div>
                    <div class="band-skip-right">${used ? '<span class="status-badge sm status-neutral">사용함</span>' : '<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" onclick="bandTeamSubSheet()">대체 합주 요청</button>'}</div></div>`; })() : ''}
                ${upcoming.length ? `<div class="band-card-section"><div class="band-card-head"><span>건너뛰기권 ${upcoming.length}장</span></div>
                    <div class="band-muted" style="margin:-2px 0 8px">예약·대관과 겹쳐 건너뛰는 주마다 1장. <strong>같은 고정 사용 시간의 대체 합주</strong>(건너뛰는 날 앞뒤 1주일 안) 또는 <strong>1주 무료 연장</strong> 중 하나를 고르면 끝이에요.</div>
                    ${upcoming.map(skipRow).join('')}</div>` : (approved.length ? '<div class="band-muted" style="margin-top:8px">예정된 건너뛰기가 없어요.</div>' : '')}
                ${past.length ? `<details class="band-skip-past"><summary class="band-muted">지난 건너뛰기 ${past.length}건</summary>${past.map(skipRow).join('')}</details>` : ''}`;
        }
        async function bandSkipExtend(skipId, btn) {
            const s = (state.bandSkips || []).find(x => x.id === skipId);
            if (!s || !supabaseClient || !state.bandProfile) return;
            if (bandSkipResolution(s)) { showToast('이미 보상이 정해진 건너뛰기권입니다.'); return; }
            if (!confirm(`${_bandMDW(s.skip_date)} 건너뛰기를 1주 무료 연장으로 받을까요? 선택 후에는 바꿀 수 없어요.`)) return;
            _bandBusy(btn, true);
            const { error } = await supabaseClient.from('band_skips').update({ resolution: 'extend', resolved_at: new Date().toISOString() }).eq('id', skipId);
            _bandBusy(btn, false);
            if (error) { console.error(error); showToast('저장하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            showToast('1주 무료 연장으로 처리했습니다. 다음 회차 시작·입금일이 일주일 뒤로 밀립니다.');
            await renderBandSlotSection(state.bandProfile); renderBandCycleNotice(state.bandProfile);
        }
        // 대체 합주 고르기: 건너뛰는 날 앞뒤 1주일(−7~+7) 중 같은 고정 사용 시간(슬롯 수)으로 비어 있는 시간대 (선택 마감은 그대로 건너뛰는 날 −7)
        async function bandSubstituteSheet(skipId) {
            const s = (state.bandSkips || []).find(x => x.id === skipId);
            if (!s || !supabaseClient) return;
            if (bandSkipResolution(s)) { showToast('이미 보상이 정해진 건너뛰기권입니다.'); return; }
            const dur = _bandSlotIdx(s.skip_start, s.skip_end).e - _bandSlotIdx(s.skip_start, s.skip_end).s + 1; // 슬롯 수
            gtSheetOpen(`대체 합주 고르기 · ${_bandMDW(s.skip_date)} 대신`, _bandLoadingHTML());
            const days = await _bandSubDays(s.skip_date, dur);
            const body = document.querySelector('#gtSheet .cm-sheet-body');
            if (!body) return;
            body.innerHTML = `<div class="band-muted" style="margin-bottom:10px">건너뛰는 날 앞뒤 1주일 안에서, 원래 고정 사용 시간과 같은 ${dur}시간으로 비어 있는 시간만 보여줘요. 고르면 그 시간이 바로 팀 합주로 잡히고 바꿀 수 없어요.</div>`
                + _bandSubDaysHTML(days, dur, (d, t) => `bandSubstitutePick('${s.id}','${d}','${t}')`);
        }
        // 대체 합주 후보: 건너뛰는 날 앞뒤 1주일(오늘 이후), 같은 슬롯 수(dur)로 비어 있는 시작 시각 목록 — 건너뛰기권·팀 요청 공용
        async function _bandSubDays(skipDate, dur) {
            const today = bandTodayStr();
            const from = _bandAddDays(skipDate, -BAND_SUB_RANGE_DAYS), to = _bandAddDays(skipDate, BAND_SUB_RANGE_DAYS);
            const ctx = await bandAvailLoad(from, BAND_SUB_RANGE_DAYS * 2);
            const now = new Date();
            const days = [];
            for (let d = from; d <= to; d = _bandAddDays(d, 1)) {
                if (d < today) continue;
                const opts = [];
                for (let i = 0; i + dur - 1 < TIMES.length; i++) {
                    if (d === today && _bandH(TIMES[i]) <= now.getHours()) continue;
                    if (!bandDateConflicts(ctx, d, i, i + dur - 1, { weeklyToo: true }).length) opts.push(i);
                }
                days.push({ d, opts });
            }
            return days;
        }
        function _bandSubDaysHTML(days, dur, onclickFor) {
            return days.length ? days.map(({ d, opts }) => `<div class="band-sub-day"><div class="d"><strong>${_bandMDW(d)}</strong></div><div class="chips">${opts.length
                ? opts.map(i => `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="${onclickFor(d, TIMES[i])}">${_bandRangeText(TIMES[i], _bandBlockEndExcl(TIMES[i + dur - 1]))}</button>`).join('')
                : '<span class="band-muted">가능한 시간 없음</span>'}</div></div>`).join('')
                : _bandEmptyHTML('대체 합주를 고를 수 있는 날짜가 지났어요.');
        }
        // ── 팀이 직접 요청하는 대체 합주(2026-11-07, 마이그레이션 20261107_band_team_skip.sql): 이용 기간 중 1회, 건너뛸 날 BAND_TEAM_SUB_MIN_DAYS 일 전까지,
        //    앞뒤 1주일 안 빈 시간으로 같은 고정 사용 시간 1회 차단. band_skips 에 granted_by='team'·resolution='substitute' 로 바로 확정(연장 없음) + 반복 차단 skip_dates. DB 부분 유니크로 1회 보장.
        const bandTeamSubUsed = (skips) => (skips || []).find(s => s.granted_by === 'team') || null;
        function _bandTeamSubDates(claims, skips) {
            const today = bandTodayStr(), minDate = _bandAddDays(today, BAND_TEAM_SUB_MIN_DAYS);
            const skipped = new Set((skips || []).map(s => s.skip_date));
            const out = [];
            for (const c of claims.filter(c => c.status === 'approved' && c.block_id)) {
                let d = c.start_date > minDate ? c.start_date : minDate;
                const want = c.day_of_week, cur = new Date(d + 'T00:00:00').getDay();
                d = _bandAddDays(d, (want - cur + 7) % 7);
                for (let n = 0; n < 8; n++, d = _bandAddDays(d, 7)) {
                    if (c.end_date && d > c.end_date) break;
                    if (!skipped.has(d)) out.push({ claim: c, date: d });
                }
            }
            return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
        }
        async function bandTeamSubSheet() {
            if (!state.bandProfile || !supabaseClient) return;
            if (bandTeamSubUsed(state.bandSkips)) { showToast('대체 합주 요청권은 이용 기간 중 1회예요. 추가 요청은 요청사항으로 남겨주세요.'); return; }
            const dates = _bandTeamSubDates(state.bandMyClaims || [], state.bandSkips || []);
            gtSheetOpen('대체 합주 요청 · 건너뛸 날 고르기', `<div class="band-muted" style="margin-bottom:10px">팀 사정으로 고정 시간을 쓰기 어려운 날을 고르세요. <strong>이용 기간 중 1회</strong>, 건너뛸 날 <strong>${BAND_TEAM_SUB_MIN_DAYS}일 전까지</strong> 요청할 수 있고, 다음 단계에서 앞뒤 1주일 안 빈 시간으로 같은 고정 사용 시간의 대체 합주를 바로 잡아요(1주 연장은 없어요).</div>`
                + (dates.length ? `<div class="gaa-btn-row" style="flex-wrap:wrap">${dates.map(x => `<button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="bandTeamSubPickDate('${x.claim.id}','${x.date}')">${_bandMDW(x.date)} ${_bandRangeText(x.claim.start_time, x.claim.end_time)}</button>`).join('')}</div>` : _bandEmptyHTML('요청할 수 있는 합주일이 없어요.')));
        }
        async function bandTeamSubPickDate(claimId, skipDate) {
            const c = (state.bandMyClaims || []).find(x => x.id === claimId);
            if (!c) return;
            const dur = _bandSlotIdx(c.start_time, c.end_time).e - _bandSlotIdx(c.start_time, c.end_time).s + 1;
            gtSheetOpen(`대체 합주 요청 · ${_bandMDW(skipDate)} 대신`, _bandLoadingHTML());
            const days = await _bandSubDays(skipDate, dur);
            const body = document.querySelector('#gtSheet .cm-sheet-body');
            if (!body) return;
            body.innerHTML = `<div class="band-muted" style="margin-bottom:10px">${_bandMDW(skipDate)} ${_bandRangeText(c.start_time, c.end_time)} 대신 쓸 시간이에요. 앞뒤 1주일 안, 같은 ${dur}시간으로 비어 있는 시간만 보여줘요. 고르면 바로 잡히고 바꿀 수 없어요. <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="bandTeamSubSheet()">‹ 날짜 다시 고르기</button></div>`
                + _bandSubDaysHTML(days, dur, (d, t) => `bandTeamSubPick('${c.id}','${skipDate}','${d}','${t}')`);
        }
        async function bandTeamSubPick(claimId, skipDate, date, startT) {
            const c = (state.bandMyClaims || []).find(x => x.id === claimId), p = state.bandProfile;
            if (!c || !p || !supabaseClient) return;
            if (bandTeamSubUsed(state.bandSkips)) { showToast('대체 합주 요청권은 이용 기간 중 1회예요.'); return; }
            const dur = _bandSlotIdx(c.start_time, c.end_time).e - _bandSlotIdx(c.start_time, c.end_time).s + 1;
            const endBlock = TIMES[TIMES.indexOf(startT) + dur - 1], endExcl = _bandBlockEndExcl(endBlock);
            if (!confirm(`${_bandMDW(skipDate)} ${_bandRangeText(c.start_time, c.end_time)} 를 건너뛰고 ${_bandMDW(date)} ${_bandRangeText(startT, endExcl)} 에 대체 합주를 잡을까요?\n이용 기간 중 1회 요청권을 사용하며, 선택 후에는 바꿀 수 없어요.`)) return;
            let skipId = null;
            try {
                const fresh = await bandAvailLoad(date, 0); // 고르는 사이 잡힌 예약·대관이 없는지 다시 확인
                if (bandDateConflicts(fresh, date, TIMES.indexOf(startT), TIMES.indexOf(startT) + dur - 1, { weeklyToo: true }).length) { showToast('그 시간은 방금 다른 일정이 잡혔어요. 다른 시간을 골라주세요.'); return; }
                // 1) 요청권 행(팀당 1회 — DB 부분 유니크) → 2) 1회 차단 → 3) 반복 차단에서 그 날짜 제외
                const { data: ins, error: sErr } = await supabaseClient.from('band_skips').insert({ profile_id: p.id, claim_id: c.id, skip_date: skipDate, skip_start: c.start_time, skip_end: c.end_time, reason: '팀 요청',
                    resolution: 'substitute', substitute_date: date, substitute_start: startT, substitute_end: endExcl, resolved_at: new Date().toISOString(), granted_by: 'team' }).select().single();
                if (sErr) {
                    if (sErr.code === '23505') { showToast('대체 합주 요청권은 이용 기간 중 1회예요.'); return; }
                    if (sErr.code === '23514' || sErr.code === '42501') { showToast('대체 합주 요청 기능이 아직 준비되지 않았어요. 운영팀에 요청사항으로 남겨주세요. (마이그레이션 20261107_band_team_skip.sql)', 6000); return; }
                    throw sErr;
                }
                skipId = ins && ins.id;
                const blockId = await _bandInsertBlock({ day_of_week: new Date(date + 'T00:00:00').getDay(), start_time: startT, end_time: endBlock,
                    reason: _bandSubReason(p), start_date: date, end_date: date, band_claim_id: c.id, skip_dates: [] });
                if (skipId) await supabaseClient.from('band_skips').update({ substitute_block_id: blockId }).eq('id', skipId);
                await _bandBlockSkipDates(c.block_id, skipDate, true);
                sendAdminPush('🔁 고정팀 대체 합주 요청', `${p.band_name_kr || p.name || ''} · ${_bandMDW(skipDate)} ${_bandRangeText(c.start_time, c.end_time)} 건너뜀 → ${_bandMDW(date)} ${_bandRangeText(startT, endExcl)}`).catch(() => {});
                gtSheetClose();
                showToast(`${_bandMDW(skipDate)} 대신 ${_bandMDW(date)} ${_bandRangeText(startT, endExcl)} 로 대체 합주를 잡았습니다.`);
                await renderBandSlotSection(p); renderBandCycleNotice(p);
            } catch (e) {
                console.error('team substitute:', e);
                if (skipId) await supabaseClient.from('band_skips').delete().eq('id', skipId).then(() => {}, () => {}); // 차단을 못 만들었으면 요청권 행도 되돌린다
                showToast('저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
            }
        }
        async function bandSubstitutePick(skipId, date, startT) {
            const s = (state.bandSkips || []).find(x => x.id === skipId);
            if (!s || !supabaseClient || !state.bandProfile) return;
            const dur = _bandSlotIdx(s.skip_start, s.skip_end).e - _bandSlotIdx(s.skip_start, s.skip_end).s + 1;
            const endBlock = TIMES[TIMES.indexOf(startT) + dur - 1], endExcl = _bandBlockEndExcl(endBlock);
            if (!confirm(`${_bandMDW(date)} ${_bandRangeText(startT, endExcl)} 로 대체 합주를 잡을까요? 선택 후에는 바꿀 수 없어요.`)) return;
            try {
                const fresh = await bandAvailLoad(date, 0); // 고르는 사이 잡힌 예약·대관이 없는지 다시 확인
                if (bandDateConflicts(fresh, date, TIMES.indexOf(startT), TIMES.indexOf(startT) + dur - 1, { weeklyToo: true }).length) { showToast('그 시간은 방금 다른 일정이 잡혔어요. 다른 시간을 골라주세요.'); return; }
                const blockId = await _bandInsertBlock({ day_of_week: new Date(date + 'T00:00:00').getDay(), start_time: startT, end_time: endBlock,
                    reason: _bandSubReason(state.bandProfile), start_date: date, end_date: date, band_claim_id: s.claim_id || null, skip_dates: [] });
                const { error } = await supabaseClient.from('band_skips').update({ resolution: 'substitute', substitute_date: date, substitute_start: startT, substitute_end: endExcl, substitute_block_id: blockId, resolved_at: new Date().toISOString() }).eq('id', skipId);
                if (error) throw error;
                gtSheetClose();
                showToast(`${_bandMDW(date)} ${_bandRangeText(startT, endExcl)} 대체 합주로 잡았습니다.`);
                await renderBandSlotSection(state.bandProfile); renderBandCycleNotice(state.bandProfile);
            } catch (e) { console.error('substitute:', e); showToast('저장하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
        }

        function bandTestTabHTML() {
            return `
                <div class="band-card-section" style="margin-top:0;padding-top:0;border-top:0">
                    <div class="band-card-head"><span>📱 입금 안내 문자 테스트</span></div>
                    <div class="band-muted">실제 문자는 매일 12:00에 자동 발송(GitHub 예약 06:37·08:07·11:07·13:37 중 먼저 도착한 실행이 정오까지 기다렸다 발송, 정오 이후 도착이면 즉시) — 미납 시 회차당 최대 3회: 입금일(3주차, 시작 2주 전) · 4주차(시작 1주 전) · 시작 전날.<br>
                        아래 버튼은 <strong>내 번호로만</strong> [테스트] 표시가 붙은 같은 문구를 보냅니다. 발송 이력·회차 기록에는 남지 않습니다.</div>
                    <div class="gaa-btn-row" style="margin-top:10px">
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="sendBandSmsTest(this, 'due')">입금일 안내</button>
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="sendBandSmsTest(this, 'week4')">4주차 리마인드</button>
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="sendBandSmsTest(this, 'last')">시작 전날 리마인드</button>
                    </div>
                </div>
                <div class="band-card-section">
                    <div class="band-card-head"><span>📨 가입 안내 문자 테스트</span></div>
                    <div class="band-muted">가입 신청 직후(접수)·[승인]·[거절] 때 팀 리더 번호로 자동 발송되는 문구입니다(팀·종류별 1회, 승인 문자는 팀 카드 [승인 문자]로 다시 보낼 수 있어요).<br>
                        아래 버튼은 <strong>내 번호로만</strong> 예시 팀(게더링·금요일 18~23시·보증금/이용료 25만원) 내용에 [테스트] 표시를 붙여 보냅니다.</div>
                    <div class="gaa-btn-row" style="margin-top:10px">
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="sendBandSmsTest(this, 'signup')">접수 확인</button>
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="sendBandSmsTest(this, 'approve')">승인 안내</button>
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="sendBandSmsTest(this, 'reject')">거절 안내</button>
                    </div>
                </div>
                <div class="band-card-section">
                    <div class="band-card-head"><span>🔔 관리자 푸시 테스트</span></div>
                    <div class="band-muted">실제 문자가 나가면 운영 총괄에게 「💰 월세 입금 안내 문자 발송」 푸시가 1건 갑니다.<br>
                        아래 버튼은 문자 없이 그 푸시만 [테스트] 표시로 보냅니다 — 운영 총괄로 푸시를 켠 모든 기기에 도착합니다.</div>
                    <div class="gaa-btn-row" style="margin-top:10px">
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="sendBandSmsTest(this, 'due', 'push')">발송 알림 푸시</button>
                    </div>
                </div>`;
        }
        // mode 'push' → 문자 없이 실제 발송 때와 같은 관리자 푸시([테스트] 표시)만 보낸다
        async function sendBandSmsTest(btn, kind, mode) {
            if (!supabaseClient || !isBandAdmin()) return;
            const bandKind = ['signup', 'approve', 'reject'].includes(kind) ? kind : null; // 가입 안내 문자는 /send-sms 가 담당
            if (!bandKind && !['due', 'week4', 'last'].includes(kind)) kind = 'due';
            const pushOnly = mode === 'push';
            _bandBusy(btn, true, '발송 중…');
            try {
                const { data } = await supabaseClient.auth.getSession();
                const token = data && data.session && data.session.access_token;
                if (!token) { showToast('로그인 세션이 없습니다. 다시 로그인해주세요.'); return; }
                const res = bandKind
                    ? await fetch('/send-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ band_test: bandKind, sb_token: token }) })
                    : await fetch('/send-reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'test_band_sms', sb_token: token, kind, ...(pushOnly ? { push: 'only' } : {}) }) });
                const out = await res.json().catch(() => ({}));
                if (!res.ok || !out.ok) { console.error('band sms test:', res.status, out); showToast(out.message || (pushOnly ? '푸시 테스트에 실패했습니다.' : '문자 테스트에 실패했습니다.')); return; }
                if (pushOnly) {
                    const n = out.push && out.push.sent;
                    showToast(n ? `운영 총괄 ${n}명에게 테스트 푸시를 보냈습니다.` : '푸시 구독이 없어 전달된 기기가 없습니다. 관리자 화면에서 푸시 알림을 켜주세요.');
                    return;
                }
                showToast(`${out.to}로 테스트 문자를 보냈습니다.`);
            } catch (e) { console.error('band sms test error:', e); showToast('서버와 통신하지 못했습니다.'); }
            finally { _bandBusy(btn, false); }
        }

        // 회차 안내 문장 (관리자 카드·팀 본인 화면 공용)
        function bandCycleSummaryHTML(t, info) {
            if (info.mode === 'none') return '<div class="band-muted">시작일이 없어 회차·입금 안내를 계산할 수 없습니다. [계약 정보]에서 첫 회차 시작일을 입력해주세요.</div>';
            if (info.mode === 'legacy') return `<div class="band-muted">시작일 미설정 — 마지막 납부일(${escHtml(info.lastPaid)}) 기준 다음 납부 예정 ${escHtml(info.next)}. 계약 정보를 입력하면 회차·문자 안내가 시작됩니다.</div>`;
            if (info.n === 0) return `<div>등록 회차 <strong>${bandMD(info.start)}(${bandWD(info.start)})</strong> 시작 예정 · 보증금(1개월분) 입금 확인 후 승인 · 등록 회차 이용료는 <strong>시작일 전날(${bandMD(_bandAddDays(info.start, -1))})까지</strong> 입금 · 다음 회차부터는 사용 3주차에 입금 안내</div>`;
            if (info.ended) return `<div>고정 사용이 <strong>${bandMD(info.endDate)}(${bandWD(info.endDate)})</strong>에 종료되었습니다.</div>`;
            if (info.ending) return `<div>이번 회차 <strong>${bandCycleLabel(info.cur)}</strong> ${bandMD(info.curStart)} ~ ${bandMD(info.curEnd)} · 고정 사용 <strong>${bandMD(info.endDate)}(${bandWD(info.endDate)})</strong> 종료 예정 · 다음 회차 없음</div>`;
            const endNote = info.endDate ? ` · 종료 예정 ${bandMD(info.endDate)}` : '';
            const dueText = info.paid
                ? `납부 완료 · ${bandCycleLabel(info.nextDueN)} 입금일 <strong>${bandMD(info.nextDue)}</strong>`
                : `입금일 <strong>${bandMD(info.due)}</strong>`;
            return `<div>이번 회차 <strong>${bandCycleLabel(info.cur)}</strong> ${bandMD(info.curStart)} ~ ${bandMD(info.curEnd)} · 다음 회차 <strong>${bandCycleLabel(info.n)}</strong> ${bandMD(info.startN)}(${bandWD(info.startN)}) 시작 · ${dueText}${t.band_fee ? ` · 이용료 ${bandWon(t.band_fee)}` : ''}${endNote}</div>`;
        }
        function bandReminderLogHTML(reminders, n) {
            const all = (reminders || []).slice().sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
            const label = { due: '입금일 안내', week4: '4주차 리마인드', last: '시작 전날 리마인드' };
            const fmt = (r) => `${label[r.kind] || r.kind} ${bandMD(new Date(r.sent_at).toLocaleDateString('en-CA'))} 발송`;
            const rows = all.filter(r => r.cycle_no === n);
            if (rows.length) return `<div class="band-muted">문자: ${rows.map(fmt).join(' · ')}</div>`;
            const last = all[all.length - 1];
            return last ? `<div class="band-muted">최근 문자: ${bandCycleLabel(last.cycle_no)} ${fmt(last)}</div>` : '';
        }

        function bandAdminTeamCard(t, kind, paymentsMap, remindersMap) {
            const isSelf = t.id === state.bandProfile.id;
            const isAdminTeam = _isAdminBandProfile(t);
            const btns = kind === 'pending'
                ? `<button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="approveBandProfile('${t.id}', this)">승인</button>
                   <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-danger" onclick="rejectBandProfile('${t.id}', this)">거절</button>`
                : (isAdminTeam ? '<span class="status-badge sm status-info">관리 팀</span>'
                   : isSelf ? '<span class="status-badge sm status-info">본인 팀</span>'
                   : `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="removeBandProfile('${t.id}', this)">탈퇴 처리</button>`);

            let contractSection = '', paymentSection = '', slotSection = '';
            const cache = state.bandAdminCache || {};
            const myClaims = (cache.claimsMap || {})[t.id] || [];
            if (kind === 'pending') {
                const pendingClaims = myClaims.filter(c => c.status === 'pending');
                slotSection = pendingClaims.length
                    ? `<div class="band-muted" style="margin-top:8px">신청 타임 <strong>${escHtml(bandClaimsText(pendingClaims))}</strong> · 희망 시작일 ${escHtml(_bandMDW(pendingClaims[0].start_date))} — [승인]을 누르면 겹치는 주를 계산해 달력에 반영합니다.</div>`
                    : '';
                const depositLine = `<div class="band-muted" style="margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px"><span>보증금(1개월분) <strong>${t.band_deposit ? bandWon(t.band_deposit) : '금액 미정'}</strong> · ${t.band_deposit_paid_at ? `<span class="status-badge sm status-approved">${bandMD(t.band_deposit_paid_at)} 입금 확인</span>` : '<span class="status-badge sm status-pending">입금 확인 전</span>'}</span>${t.band_deposit_paid_at ? '' : `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" onclick="bandMarkDepositPaid('${t.id}', this)">입금 확인</button>`}</div>`;
                slotSection = depositLine + `<div class="band-muted" style="margin-top:6px">캐비넷 <strong>${escHtml(bandCabinetLabel(t))}</strong>${t.band_expected_months ? ` · 예상 ${escHtml(t.band_expected_months)}` : ''}</div>` + bandReturningHTML(t) + slotSection;
                const pin = (cache.pinsMap || {})[t.id];
                if (pin) slotSection = `<div class="band-muted" style="margin-top:6px">등록 비밀번호(숫자 4자리) <span class="band-pin">${escHtml(pin)}</span> · 6개월 이상·캐비넷 이용 시 등록</div>` + slotSection;
                slotSection += `<div id="ba-form-${t.id}" class="band-inline-form" hidden></div>`;
            }
            if (kind === 'approved' && !isAdminTeam) {
                slotSection = bandSlotSectionHTML(t, myClaims, (cache.skipsMap || {})[t.id] || [], cache.defs || []);
                const rows = (paymentsMap || {})[t.id] || [];
                const info = bandCycleInfo(t, rows);
                const kv = (label, val) => `<div class="band-kv"><span>${label}</span><strong>${val || '-'}</strong></div>`;
                contractSection = `
                    <div class="band-card-section">
                        <div class="band-card-head"><span>📄 계약 정보</span>
                            <span style="display:flex;gap:6px"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="bandResendApproveSms('${t.id}', this)" title="보증금·이용료 금액을 넣어 승인 안내 문자를 다시 보냅니다">승인 문자</button>
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="toggleBandBox('bc-form-${t.id}')">수정</button></span></div>
                        <div class="band-kv-grid">
                            ${kv('시작일', t.band_start_date ? `${escHtml(t.band_start_date)}(${bandWD(t.band_start_date)})` : '')}
                            ${kv('예상 사용', escHtml(t.band_expected_months || ''))}
                            ${kv('보증금', t.band_deposit ? `${bandWon(t.band_deposit)}${t.band_deposit_paid_at ? ' · ' + bandMD(t.band_deposit_paid_at) + ' 입금' : ' · 미입금'}` : '')}
                            ${kv('이용료(4주)', bandWon(t.band_fee))}
                            ${kv('종료 예정일', t.band_end_date ? `${escHtml(t.band_end_date)}(${bandWD(t.band_end_date)})${t.band_end_date < bandTodayStr() ? ' · 종료됨' : ''}` : '')}
                            ${kv('캐비넷', escHtml(bandCabinetLabel(t)))}
                            ${kv('등록 비밀번호(4자리)', (cache.pinsMap || {})[t.id] ? `<span class="band-pin">${escHtml(cache.pinsMap[t.id])}</span>` : '')}
                        </div>
                        ${_bandDisplayNote(t.band_memo) ? `<div class="band-muted">메모: ${escHtml(_bandDisplayNote(t.band_memo))}</div>` : ''}
                        <div id="bc-form-${t.id}" class="band-inline-form" hidden>${bandContractFormHTML(t)}</div>
                    </div>`;
                paymentSection = `
                    <div class="band-card-section">
                        <div class="band-card-head"><span>💰 회차·입금</span>${bandStatusChip(info)}</div>
                        ${bandCycleSummaryHTML(t, info)}
                        ${info.mode === 'cycle' ? bandReminderLogHTML((remindersMap || {})[t.id], info.n) : ''}
                        <div class="gaa-btn-row" style="margin-top:8px">
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" onclick="openBandPaymentForm('${t.id}')">+ 입금 기록</button>
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="toggleBandPaymentHistory('${t.id}', this)">납부 내역 ▼</button>
                        </div>
                        <div id="bp-form-${t.id}" class="band-inline-form" hidden></div>
                        <div id="pay-hist-${t.id}" class="band-pay-hist" hidden>${bandPaymentHistoryHTML(t, rows)}</div>
                    </div>`;
            }
            return `
                <div class="band-team-card${kind === 'approved' ? (isAdminTeam ? ' block admin' : ' block') : ''}">
                    <div class="band-card-top">
                        <div style="flex:1;min-width:0">
                            <div class="band-card-title">${escHtml(t.band_name_kr||'-')} <span class="band-muted">${escHtml(t.band_name_en||'')}</span></div>
                            <div class="band-card-sub">리더 ${escHtml(t.leader_name||'-')} · ${escHtml(t.leader_phone||'-')}</div>
                            <div class="band-card-slot">${escHtml(bandSlotSheetText(t.timeslots))}</div>
                        </div>
                        <div class="gaa-btn-row" style="flex-shrink:0">${btns}</div>
                    </div>
                    ${kind === 'pending' ? slotSection : ''}${contractSection}${paymentSection}${kind === 'approved' ? slotSection : ''}
                </div>`;
        }

        // ── 현황표 탭: 내부운영 시트 "진행중인 고정팀 / 대기팀 / 히스토리" 이식 ──
        function renderBandRosterTab(view, teams, paymentsMap, remindersMap) {
            const others = teams.filter(t => !_isAdminBandProfile(t));
            const active = others.filter(t => t.status === 'approved' && !bandEndedDate(t));
            const pending = others.filter(t => t.status === 'pending');
            const history = others.filter(t => !!bandEndedDate(t)).sort((a, b) => String(bandEndedDate(b)).localeCompare(String(bandEndedDate(a))));
            state.bandRosterView = state.bandRosterView || 'cards';
            const isTable = state.bandRosterView === 'table';
            const seg = (key, label) => `<button type="button" class="gaa-btn gaa-btn-xs ${state.bandRosterView === key ? 'gaa-btn-primary' : 'gaa-btn-secondary'}" onclick="setBandRosterView('${key}')">${label}</button>`;
            let html = `
                <div class="band-roster-toolbar">
                    <div class="gaa-btn-row">${seg('cards', '카드')}${seg('table', '표')}</div>
                    <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="downloadBandRosterCsv()">CSV 내보내기</button>
                </div>
                <div class="band-roster-title">▶ 진행중인 고정팀 <span class="band-muted">${active.length}팀</span></div>`;
            html += active.length
                ? (isTable ? bandRosterTableHTML(active, paymentsMap) : active.map(t => bandRosterCardHTML(t, paymentsMap)).join(''))
                : _bandEmptyHTML('진행 중인 고정팀이 없습니다.');
            html += `<div class="band-roster-title">▶ 대기팀 <span class="band-muted">${pending.length}팀</span></div>`;
            html += pending.length ? `<div class="band-roster-wrap"><table class="band-roster-table"><thead><tr><th>#</th><th>요일</th><th>팀명</th><th>대표자</th><th>연락처</th><th>등록 예정일</th><th>사용 개월수</th></tr></thead><tbody>${
                pending.map((t, i) => `<tr><td>${i + 1}</td><td>${escHtml(bandSlotSheetText(t.timeslots))}</td><td>${escHtml(t.band_name_kr || '-')}</td><td>${escHtml(t.leader_name || '-')}</td><td>${escHtml(t.leader_phone || '-')}</td><td>${bandYMDShort(t.band_start_date) || '-'}</td><td>${escHtml(t.band_expected_months || '-')}</td></tr>`).join('')
            }</tbody></table></div>` : _bandEmptyHTML('대기 중인 팀이 없습니다.');
            html += `<div class="band-roster-title">▶ 히스토리 <span class="band-muted">${history.length}팀</span></div>`;
            html += history.length ? `<div class="band-roster-wrap"><table class="band-roster-table"><thead><tr><th>요일</th><th>팀명</th><th>대표자</th><th>연락처</th><th>등록일</th><th>예상 사용 개월수</th><th>실사용</th></tr></thead><tbody>${
                history.map(t => `<tr><td>${escHtml(bandSlotSheetText(t.timeslots))}</td><td>${escHtml(t.band_name_kr || '-')}</td><td>${escHtml(t.leader_name || '-')}</td><td>${escHtml(t.leader_phone || '-')}</td><td>${bandYMDShort(t.band_start_date) || '-'}</td><td>${escHtml(t.band_expected_months || '-')}</td><td>${escHtml(bandUsageText(t, (paymentsMap || {})[t.id] || []))}</td></tr>`).join('')
            }</tbody></table></div>` : _bandEmptyHTML('종료된 팀이 없습니다.');
            view.innerHTML = html;
        }
        function setBandRosterView(v) { state.bandRosterView = v; renderBandAdminTab(); }
        // 실사용 회차: 납부 기록 수가 있으면 그 값, 없으면 시작일~종료일 기간을 28일로 나눠 반올림(시트 이관 팀 등)
        function bandUsageText(t, rows) {
            let count = Object.keys(bandPaidMap(t, rows)).length;
            const endedAt = bandEndedDate(t);
            if (!count && t.band_start_date && endedAt) count = Math.max(1, Math.round(bandDiffDays(endedAt, t.band_start_date) / BAND_CYCLE_DAYS));
            const range = t.band_start_date ? `${bandYMDShort(t.band_start_date)} ~ ${bandYMDShort(endedAt)}` : bandYMDShort(endedAt);
            return `${count}회 (${range})`;
        }
        // 카드 보기: 팀 요약 + 회차 스트립 (등록 ✓ 5/17 · 1차 ✓ 6/8 · … · 5차 입금일 9/27)
        function bandRosterCardHTML(t, paymentsMap) {
            const rows = (paymentsMap || {})[t.id] || [];
            const info = bandCycleInfo(t, rows);
            let strip = '';
            if (info.mode === 'cycle') {
                const maxN = Math.max(info.n, info.nextDueN, ...Object.keys(info.paidMap).map(Number));
                const chips = [];
                for (let n = 0; n <= maxN; n++) {
                    const p = info.paidMap[n];
                    let cls = 'status-neutral', text;
                    if (p) { cls = 'status-approved'; text = `${bandCycleLabel(n)} ✓ ${bandMD(p.paid_at)}`; }
                    else if (n === info.n) { cls = info.status === 'overdue' ? 'status-rejected' : 'status-pending'; text = `${bandCycleLabel(n)} 입금일 ${bandMD(info.due)}`; }
                    else if (n === info.nextDueN) { text = `${bandCycleLabel(n)} 입금일 ${bandMD(info.nextDue)}`; } // 선납 뒤 첫 미납 회차
                    else if (n < info.n) { cls = 'status-rejected'; text = `${bandCycleLabel(n)} 미납`; }
                    else text = `${bandCycleLabel(n)} ${bandMD(bandCycleStart(info.start, n, info.ext))}`;
                    chips.push(`<span class="status-badge sm ${cls}">${escHtml(text)}</span>`);
                }
                strip = `<div class="band-cycle-strip">${chips.join('')}</div>`;
            } else {
                strip = `<div class="band-muted">시작일 미설정 — 팀 관리에서 계약 정보를 입력하세요.</div>`;
            }
            const deposit = t.band_deposit ? `보증금 ${bandWon(t.band_deposit)} ${t.band_deposit_paid_at ? '완' : '미입금'}` : '';
            return `
                <div class="band-team-card block">
                    <div class="band-card-top">
                        <div style="flex:1;min-width:0">
                            <div class="band-card-title">${escHtml(t.band_name_kr || '-')} <span class="band-muted">${escHtml(t.band_name_en || '')}</span></div>
                            <div class="band-card-sub">${escHtml(bandSlotSheetText(t.timeslots))} · ${escHtml(t.leader_name || '-')} · ${escHtml(t.leader_phone || '-')}</div>
                            <div class="band-card-sub">시작 ${bandYMDShort(t.band_start_date) || '-'}${t.band_expected_months ? ' · ' + escHtml(t.band_expected_months) : ''}${deposit ? ' · ' + deposit : ''}</div>
                        </div>
                        ${bandStatusChip(info)}
                    </div>
                    ${strip}
                </div>`;
        }
        // 표 보기: 시트와 같은 3행(입금/시작일/종료일) × 회차 열
        function bandRosterColumns(teams, paymentsMap) {
            let maxN = 0;
            teams.forEach(t => { const info = bandCycleInfo(t, (paymentsMap || {})[t.id] || []); if (info.mode === 'cycle') maxN = Math.max(maxN, info.n, ...Object.keys(info.paidMap).map(Number)); });
            return Math.max(12, maxN + 2);
        }
        function bandRosterRows(t, rows, K) {
            // → [{label, cells:[{text, cls}]}] 입금/시작일/종료일 3행. 시작일 없으면 빈 셀.
            const info = bandCycleInfo(t, rows);
            const mk = (label) => ({ label, cells: Array.from({ length: K + 1 }, () => ({ text: '', cls: '' })) });
            const pay = mk('입금'), st = mk('시작일'), en = mk('종료일');
            if (info.mode === 'cycle') {
                for (let n = 0; n <= K; n++) {
                    const cur = n === info.cur ? ' cur' : '';
                    st.cells[n] = { text: bandYMDShort(bandCycleStart(info.start, n, info.ext)), cls: cur };
                    en.cells[n] = { text: bandYMDShort(bandCycleEnd(info.start, n, info.ext)), cls: cur };
                    const p = info.paidMap[n];
                    if (n === 0) pay.cells[0] = { text: `${bandYMDShort(p ? p.paid_at : info.start)}${t.band_deposit_paid_at ? ' (' + bandYMDShort(t.band_deposit_paid_at) + ')' : ''}`, cls: cur + (p ? ' paid' : '') };
                    else if (p) pay.cells[n] = { text: bandYMDShort(p.paid_at), cls: cur + ' paid' };
                    else if (n <= info.n) pay.cells[n] = { text: n === info.n ? `입금일 ${bandYMDShort(info.due)}` : '미납', cls: cur + (n < info.n || info.status === 'overdue' ? ' late' : ' due') };
                    else if (n === info.nextDueN) pay.cells[n] = { text: `입금일 ${bandYMDShort(info.nextDue)}`, cls: ' due' }; // 다음 회차를 선납한 팀 — 그 다음 입금일
                }
            }
            return [pay, st, en];
        }
        function bandRosterTableHTML(teams, paymentsMap) {
            const K = bandRosterColumns(teams, paymentsMap);
            const head = ['#', '요일', '팀명', '대표자', '연락처', '시작일', '예상 사용 개월수', '구분', '등록', ...Array.from({ length: K }, (_, i) => `${i + 1}차 추가`)];
            const body = teams.map((t, i) => {
                const rows = (paymentsMap || {})[t.id] || [];
                const lines = bandRosterRows(t, rows, K);
                const months = `${escHtml(t.band_expected_months || '-')}${t.band_deposit ? ` (보증금 ${Math.round(t.band_deposit / 10000)}만 ${t.band_deposit_paid_at ? '완' : '미입금'})` : ''}`;
                const lead = `<td rowspan="3">${i + 1}</td><td rowspan="3">${escHtml(bandSlotSheetText(t.timeslots))}</td><td rowspan="3" class="name">${escHtml(t.band_name_kr || '-')}</td><td rowspan="3">${escHtml(t.leader_name || '-')}</td><td rowspan="3">${escHtml(t.leader_phone || '-')}</td><td rowspan="3">${bandYMDShort(t.band_start_date) || '-'}</td><td rowspan="3">${months}</td>`;
                return lines.map((ln, j) => `<tr>${j === 0 ? lead : ''}<th class="rowlabel">${ln.label}</th>${ln.cells.map(c => `<td class="${c.cls.trim()}">${escHtml(c.text)}</td>`).join('')}</tr>`).join('');
            }).join('');
            return `<div class="band-roster-hint">← 옆으로 밀어 회차별 입금·시작일·종료일을 확인하세요 →</div><div class="band-roster-wrap"><table class="band-roster-table sheet"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
        }
        function downloadBandRosterCsv() {
            const cache = state.bandAdminCache;
            if (!cache) return;
            const { teams, paymentsMap } = cache;
            const others = teams.filter(t => !_isAdminBandProfile(t));
            const active = others.filter(t => t.status === 'approved' && !bandEndedDate(t));
            const K = bandRosterColumns(active, paymentsMap);
            const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
            const lines = [];
            lines.push(['▶ 진행중인 고정팀'].join(','));
            lines.push(['구분', '요일', '팀명', '대표자', '연락처', '시작일', '예상 사용 개월수', '구분', '등록', ...Array.from({ length: K }, (_, i) => `${i + 1}차 추가`)].map(esc).join(','));
            active.forEach((t, i) => {
                const rows = (paymentsMap || {})[t.id] || [];
                bandRosterRows(t, rows, K).forEach(ln => {
                    lines.push([i + 1, bandSlotSheetText(t.timeslots), t.band_name_kr || '', t.leader_name || '', t.leader_phone || '', bandYMDShort(t.band_start_date),
                        `${t.band_expected_months || ''}${t.band_deposit ? ` (보증금 ${Math.round(t.band_deposit / 10000)}만 ${t.band_deposit_paid_at ? '완' : '미입금'})` : ''}`,
                        ln.label, ...ln.cells.map(c => c.text)].map(esc).join(','));
                });
            });
            lines.push('');
            lines.push('▶ 대기팀');
            lines.push(['구분', '요일', '팀명', '대표자', '연락처', '등록 예정일', '사용 개월수'].join(','));
            others.filter(t => t.status === 'pending').forEach((t, i) => lines.push([i + 1, bandSlotSheetText(t.timeslots), t.band_name_kr || '', t.leader_name || '', t.leader_phone || '', bandYMDShort(t.band_start_date), t.band_expected_months || ''].map(esc).join(',')));
            lines.push('');
            lines.push('▶ 히스토리');
            lines.push(['요일', '팀명', '대표자', '연락처', '등록일', '예상 사용 개월수', '실사용 개월수'].join(','));
            others.filter(t => !!bandEndedDate(t)).forEach(t => lines.push([bandSlotSheetText(t.timeslots), t.band_name_kr || '', t.leader_name || '', t.leader_phone || '', bandYMDShort(t.band_start_date), t.band_expected_months || '', bandUsageText(t, (paymentsMap || {})[t.id] || [])].map(esc).join(',')));
            const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `고정팀_현황_${bandTodayStr()}.csv`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
            showToast('고정팀 현황표를 다운로드했습니다.');
        }

        // 고정팀 안내 문자(승인/거절, 2026-11-07) — /send-sms 가 운영자 세션(sb_token)을 검증하고 band_sms_log(profile_id, kind) 로 1회 보장.
        // 자동 호출(승인·거절 직후)은 성공·실패를 토스트로만 알리고(delay 로 앞 토스트가 먼저 보이게), manual(팀 카드 [승인 문자])은 resend 로 다시 보낸다.
        const BAND_SMS_LABEL = { approve: '승인 안내', reject: '거절 안내' };
        async function _bandSendSms(id, kind, opts = {}) {
            if (!supabaseClient) return null;
            let token = null;
            try { const { data } = await supabaseClient.auth.getSession(); token = data && data.session && data.session.access_token; } catch (_) {}
            if (!token) { if (opts.manual) showToast('로그인 세션이 없습니다. 다시 로그인해주세요.'); return null; }
            const label = BAND_SMS_LABEL[kind] || '';
            const toast = (msg, ms) => { if (opts.delay) setTimeout(() => showToast(msg, ms), opts.delay); else showToast(msg, ms); };
            try {
                const res = await fetch('/send-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ band_profile_id: id, kind, sb_token: token, ...(opts.resend ? { resend: true } : {}) }) });
                const out = await res.json().catch(() => ({}));
                if (out.ok) { toast(`${out.to ? out.to + '로 ' : ''}${label} 문자를 보냈습니다.`); return out; }
                if (out.skipped === 'already-sent' || out.error === 'sms-disabled') { if (opts.manual) toast(out.message || '문자를 보내지 않았습니다.'); return out; }
                console.error('band sms:', res.status, out);
                toast(out.message || `${label} 문자를 보내지 못했습니다.`, 5000);
                return out;
            } catch (e) { console.error('band sms error:', e); if (opts.manual) toast('서버와 통신하지 못했습니다.'); return null; }
        }
        async function bandResendApproveSms(id, btn) {
            if (!isBandAdmin()) return;
            if (!confirm('이 팀 리더 번호로 승인 안내 문자를 보낼까요?\n계약 정보의 보증금·이용료 금액과 고정 시간·시작일이 들어갑니다.')) return;
            _bandBusy(btn, true, '발송 중…');
            try { await _bandSendSms(id, 'approve', { resend: true, manual: true }); } finally { _bandBusy(btn, false); }
        }

        // 가입 신청 카드 [입금 확인]: 보증금(1개월분) 입금일을 오늘로 기록(금액이 비어 있으면 묻는다) — 승인은 입금 확인 뒤가 원칙(2026-11-07)
        async function bandMarkDepositPaid(id, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const t = ((state.bandAdminCache || {}).teams || []).find(x => x.id === id) || {};
            const upd = { band_deposit_paid_at: bandTodayStr() };
            if (!t.band_deposit) {
                const raw = prompt('보증금(1개월분) 금액을 원 단위로 적어주세요.', t.band_fee ? String(t.band_fee) : '');
                if (raw === null) return;
                const n = parseInt(String(raw).replace(/\D/g, ''), 10);
                if (!(n > 0)) { showToast('금액을 숫자로 적어주세요.'); return; }
                upd.band_deposit = n;
                if (!t.band_fee) upd.band_fee = n;
            }
            _bandBusy(btn, true, '저장 중…');
            try {
                const { error } = await supabaseClient.from('profiles').update(upd).eq('id', id);
                if (error) { console.error('band deposit paid:', error); showToast('저장하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                showToast('보증금 입금을 확인으로 기록했습니다. 이제 [승인]을 눌러주세요.');
                renderBandAdminTab();
            } finally { _bandBusy(btn, false); }
        }
        async function approveBandProfile(id, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            const tq = ((state.bandAdminCache || {}).teams || []).find(x => x.id === id);
            if (tq && !tq.band_deposit_paid_at && !confirm('보증금(1개월분) 입금 확인 전입니다. 그래도 승인할까요?\n(원칙: 접수 문자로 안내한 보증금이 입금되면 [입금 확인] → [승인])')) return;
            // 타임 신청이 있으면 승인 폼(시작일·겹치는 주 → 달력 반영)으로, 없으면 종전처럼 상태만 승인
            const pendingClaims = (((state.bandAdminCache || {}).claimsMap || {})[id] || []).filter(c => c.status === 'pending');
            if (pendingClaims.length && !_bandSlotsUnavailable) { openBandApproval(id); return; }
            if (!confirm('이 팀의 가입을 승인하시겠습니까?')) return;
            _bandBusy(btn, true);
            const { error } = await supabaseClient.from('profiles').update({ status: 'approved' }).eq('id', id);
            _bandBusy(btn, false);
            if (error) { console.error('band approve error:', error); showToast('승인하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            showToast('가입을 승인했습니다. 팀 관리에서 계약 정보를 입력해주세요.');
            _bandSendSms(id, 'approve', { delay: 1500 }).catch(() => {});
            renderBandAdminTab();
            fetchAndRenderBandTeamList();
        }

        async function rejectBandProfile(id, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            if (!confirm('이 팀의 가입을 거절하시겠습니까?')) return;
            _bandBusy(btn, true);
            const { error } = await supabaseClient.from('profiles').update({ status: 'rejected' }).eq('id', id);
            _bandBusy(btn, false);
            if (error) { console.error('band reject error:', error); showToast('처리하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            // 거절한 팀의 타임 신청도 닫는다 — 대기(pending)로 남으면 가입 화면 시간표에 계속 「다른 팀 신청 중」으로 보인다(2026-11-11)
            try { await supabaseClient.from('band_slot_claims').update({ status: 'rejected' }).eq('profile_id', id).eq('status', 'pending'); } catch (e) { console.error('band reject claims:', e); }
            showToast('가입 신청을 거절했습니다.');
            _bandSendSms(id, 'reject', { delay: 1500 }).catch(() => {});
            renderBandAdminTab();
        }

        // 탈퇴 처리: 거절 상태 + 사용 종료일 기록 → 현황표 히스토리에 남는다
        async function removeBandProfile(id, btn) {
            if (!supabaseClient || !isBandAdmin()) return;
            if (id === state.bandProfile.id) { showToast('본인 팀은 처리할 수 없습니다.'); return; }
            if (!confirm('이 팀을 탈퇴(사용 종료)로 처리하시겠습니까? 현황표 히스토리에 남습니다.')) return;
            _bandBusy(btn, true);
            let { error } = await supabaseClient.from('profiles').update({ status: 'rejected', band_ended_at: bandTodayStr() }).eq('id', id);
            if (error && String(error.message || '').includes('band_ended_at')) {
                ({ error } = await supabaseClient.from('profiles').update({ status: 'rejected' }).eq('id', id)); // 마이그레이션 전 폴백
            }
            _bandBusy(btn, false);
            if (error) { console.error('band remove error:', error); showToast('처리하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            // 고정 시간(타임 신청·반복 차단)도 오늘로 닫아 달력에서 열린다
            try { await _bandEndClaims(((state.bandAdminCache || {}).claimsMap || {})[id] || [], bandTodayStr()); } catch (e) { console.error('band end claims:', e); }
            showToast('탈퇴 처리했습니다.');
            renderBandAdminTab();
            fetchAndRenderBandTeamList();
        }

        // 팀 본인 화면: 이번 회차·다음 입금일 안내 (관리자 팀 제외)
        // 4주차 진행 띠(시안 C): 이번 회차 28일 창을 7일 묶음(주차)으로 나누고 묶음마다 **합주일**(승인 타임 요일 — 시작일이 합주 요일이 아닌 옛 팀도 맞게; 타임 없으면 시작일+7k)을 적는다.
        // 사용/다음 합주/예정 · 다음 회차 입금일이 드는 주차(보통 3주차, 선납이면 「납부 완료」) · 건너뛰는 날(skip_dates = 합주일) · 연장이면 5칸
        function bandWeekStripHTML(info, skips, claims, today = bandTodayStr()) {
            if (!info || info.mode !== 'cycle' || info.n === 0 || info.ended) return '';
            const live = (claims || []).filter(c => c.status === 'approved' && (!c.end_date || c.end_date >= today))
                .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || ''))); // 타임이 여럿이면 먼저 시작한 타임(주 합주일) 기준
            const dow = live.length ? Number(live[0].day_of_week) : null;
            const dowOf = (ymd) => new Date(ymd + 'T00:00:00').getDay();
            const nWeeks = Math.min(6, Math.max(1, Math.floor(bandDiffDays(info.curEnd, info.curStart) / 7) + 1));
            const weeks = [];
            for (let i = 0; i < nWeeks; i++) {
                const b0 = _bandAddDays(info.curStart, 7 * i);
                weeks.push(dow == null ? b0 : _bandAddDays(b0, (dow - dowOf(b0) + 7) % 7));
            }
            const nextIdx = weeks.findIndex(d => d >= today);
            const dueIdx = Math.floor(bandDiffDays(info.due, info.curStart) / 7);
            const bySkip = {}; (skips || []).forEach(x => { bySkip[x.skip_date] = x; });
            return `<div class="band-week-strip">${weeks.map((d, i) => {
                const sk = bySkip[d];
                const isDueWeek = i === dueIdx; // 다음 회차 입금일이 드는 주(보통 3주차) — 선납했으면 「납부 완료」
                let cls = sk ? 'skip' : d < today ? 'past' : i === nextIdx ? 'now' : 'next';
                if (isDueWeek) cls += info.paid ? ' paid' : ' due';
                let sub = sk ? (bandSkipResolution(sk, today) === 'substitute' && sk.substitute_date ? `대체 ${bandMD(sk.substitute_date)}` : '건너뜀')
                    : d < today ? '사용' : i === nextIdx ? (d === today ? '오늘' : '다음 합주') : '예정';
                return `<div class="band-week ${cls}" title="${bandMD(d)} ${sub}${isDueWeek ? ` · ${info.paid ? '납부 완료' : '입금일 ' + bandMD(info.due)}` : ''}"><i></i><b>${i + 1}주차${isDueWeek ? (info.paid ? ' · 납부 완료' : ' · 입금일') : ''}</b><span>${bandMD(d)} ${sub}</span></div>`;
            }).join('')}</div>`;
        }
        // 요약 타일(시안 B): 고정 시간 · 이번 회차 · 다음 입금 — renderBandCycleNotice(회차)·renderBandSlotSection(타임)이 끝날 때마다 다시 그린다
        function renderBandHomeTiles() {
            const card = document.getElementById('bandHomeTiles');
            const p = state.bandProfile, info = state._bandCycleInfo;
            if (!card) return;
            if (!p || _isAdminBandProfile(p) || !info || info.mode !== 'cycle') { card.classList.add('hidden'); card.innerHTML = ''; return; }
            const claims = (state.bandMyClaims || []).filter(c => c.status === 'approved');
            const slot = claims.length ? claims.map(c => `${BAND_DOW[c.day_of_week]} ${_bandRangeText(c.start_time, c.end_time)}`).join(' · ') : (bandSlotSheetText(p.timeslots) || '-');
            const today = bandTodayStr();
            let cycle;
            if (info.n === 0) cycle = `${bandMD(info.start)} 시작 예정`;
            else if (info.ended) cycle = '사용 종료';
            else cycle = `${bandCycleLabel(info.cur)} · ${Math.min(Math.max(1, Math.floor(bandDiffDays(today, info.curStart) / 7) + 1), 6)}주차`;
            let due, dueCls = '';
            if (info.n === 0) due = `${bandMD(_bandAddDays(info.start, -1))}까지`;
            else if (info.ended) due = '-';
            else if (info.ending) due = '없음';
            else if (info.paid) { due = '납부 완료'; dueCls = 'ok'; }
            else { due = bandMD(info.due); dueCls = info.status === 'overdue' ? 'late' : (info.status === 'imminent' || info.status === 'due_today') ? 'warn' : ''; }
            card.classList.remove('hidden');
            card.innerHTML = `<div><small>고정 시간</small><b>${escHtml(slot)}</b></div><div><small>이번 회차</small><b>${escHtml(cycle)}</b></div><div><small>다음 입금</small><b class="${dueCls}">${escHtml(due)}</b></div>`;
        }
        async function renderBandCycleNotice(profile) {
            const box = document.getElementById('bandCycleNotice');
            if (!box) return;
            if (!profile || _isAdminBandProfile(profile) || !profile.band_start_date) { box.classList.add('hidden'); state._bandCycleInfo = null; renderBandHomeTiles(); return; }
            let rows = [], skips = [], claims = [];
            try { rows = (await fetchBandPayments([profile.id]))[profile.id] || []; } catch (_) {}
            try { skips = (await fetchBandSkips([profile.id]))[profile.id] || []; profile._ext = bandExtDates(skips); } catch (_) {} // 1주 연장(건너뛰기권) 반영
            try { claims = await fetchBandSlotClaims([profile.id]); } catch (_) {} // 주차 띠의 합주일 요일 (renderBandSlotSection 과 경쟁하지 않게 따로 받는다)
            const info = bandCycleInfo(profile, rows);
            state._bandCycleInfo = info;
            box.classList.remove('hidden');
            const extNote = (profile._ext || []).length ? `<div class="band-muted" style="margin-top:4px">건너뛰기 1주 연장 ${profile._ext.length}회가 반영되어 회차 시작·입금일이 그만큼 뒤로 밀려 있어요.</div>` : '';
            box.innerHTML = `
                <div class="band-section-head"><span class="band-section-title">💰 회차 · 입금</span>${bandStatusChip(info)}</div>
                ${bandWeekStripHTML(info, skips, claims)}
                ${bandCycleSummaryHTML(profile, info)}${extNote}
                <div class="band-kv-grid" style="margin-top:10px">
                    <div class="band-kv"><span>이용료(4주)</span><strong>${bandWon(profile.band_fee) || '-'}</strong></div>
                    <div class="band-kv"><span>입금 계좌</span><strong>${escHtml(BAND_BANK_LINE_UI)}</strong></div>
                </div>
                <details class="band-skip-past" id="bandMyPayHist"><summary class="band-muted">납부 내역 ${rows.length}건 보기</summary><div class="band-pay-hist">${bandPaymentHistoryHTML(profile, rows, { readOnly: true })}</div></details>
                <div class="band-muted" style="margin-top:4px">입금일에 안내 문자를 보내드립니다. 내역이 다르면 요청사항으로 알려주세요.</div>`;
            renderBandHomeTiles();
        }

        // 앱 바 팀 이름: 국문 + 작은 영문 (시안 B 「벤더 Vandor」)
        function _bandHeaderNameHTML(profile) {
            const kr = (profile && (profile.band_name_kr || '').trim()) || '', en = (profile && (profile.band_name_en || '').trim()) || '';
            if (kr && en) return `${escHtml(kr)} <small>${escHtml(en)}</small>`;
            return escHtml(bandTeamDisplayName(profile));
        }
        // 팀 본인 화면의 보증금 표기(운영자가 적은 값, 읽기 전용) — 밴드 정보 카드·시안 B
        function _bandDepositText(profile) {
            if (!profile.band_deposit) return '미등록';
            return `${bandWon(profile.band_deposit)}<span class="band-muted" style="font-weight:400"> · ${profile.band_deposit_paid_at ? `${bandMD(profile.band_deposit_paid_at)} 입금` : '입금 전'}</span>`;
        }
        function renderBandInfo(profile) {
            const card = document.getElementById('bandInfoCard');
            if (!card) return;
            const kv = (label, val, big) => `<div class="band-kv"><span>${label}</span><strong${big ? ' class="lg"' : ''}>${val || '-'}</strong></div>`;
            const admin = _isAdminBandProfile(profile);
            const kr = escHtml(profile.band_name_kr || ''), en = escHtml(profile.band_name_en || '');
            card.innerHTML = `
                <div class="band-section-head"><span class="band-section-title">🎵 밴드 정보</span>
                    <button type="button" id="bandInfoEditBtn" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="toggleBandInfoEdit()">✏️ 정보 수정</button></div>
                <div id="bandInfoView">
                    <div class="band-kv-grid">
                        ${kv('밴드명', kr ? `${kr}${en ? ` <span class="band-muted" style="font-weight:400">${en}</span>` : ''}` : en)}
                        ${kv('팀 리더', escHtml(profile.leader_name || profile.name || ''))}
                        ${kv('연락처', escHtml(profile.leader_phone || profile.phone || ''))}
                        <div class="band-kv"><span>합주 타임</span><strong class="band-card-slot" style="margin:0">${escHtml(bandSlotSheetText(profile.timeslots))}</strong></div>
                        ${admin ? '' : kv('보증금', _bandDepositText(profile)) + kv('캐비넷', escHtml(bandCabinetLabel(profile)))}
                    </div>
                </div>
                <div id="bandInfoEditForm" class="band-inline-form" style="margin-top:0;padding-top:0;border-top:0" hidden>
                    ${buildBandInfoEditForm(profile)}
                </div>
            `;
        }

        function buildBandInfoEditForm(profile) {
            return `
                <div class="band-form-grid">
                    <label>밴드명 (국문)<input type="text" id="bandEditNameKr" class="band-input" placeholder="밴드명 (국문)" value="${escAttr(profile.band_name_kr||'')}"></label>
                    <label>밴드명 (영문)<input type="text" id="bandEditNameEn" class="band-input" placeholder="Band Name (English)" value="${escAttr(profile.band_name_en||'')}"></label>
                    <label>팀 리더 이름<input type="text" id="bandEditLeaderName" class="band-input" placeholder="팀 리더 이름" value="${escAttr(profile.leader_name||profile.name||'')}"></label>
                    <label>연락처<input type="tel" id="bandEditLeaderPhone" class="band-input" placeholder="010-0000-0000" value="${escAttr(profile.leader_phone||profile.phone||'')}"></label>
                </div>
                <div class="band-muted" style="margin-bottom:6px">합주 타임(${escHtml(bandSlotSheetText(profile.timeslots))})은 가입 시 선택한 값으로, 변경은 게더링 팀에 문의해주세요.</div>
                <div id="bandInfoResult" class="band-form-result"></div>
                <div class="gaa-btn-row">
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="saveBandInfo(this)">저장</button>
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="toggleBandInfoEdit()">취소</button>
                </div>
            `;
        }

        // 보기 영역 ↔ 수정 폼 교체 (폼이 아래에 덧붙지 않도록)
        function toggleBandInfoEdit() {
            const form = document.getElementById('bandInfoEditForm');
            const view = document.getElementById('bandInfoView');
            const btn = document.getElementById('bandInfoEditBtn');
            if (!form || !view) return;
            form.hidden = !form.hidden;
            view.hidden = !form.hidden;
            if (btn) btn.hidden = !form.hidden;
            const res = document.getElementById('bandInfoResult');
            if (res) res.textContent = '';
            if (!form.hidden) document.getElementById('bandEditNameKr')?.focus();
        }

        async function saveBandInfo(btn) {
            if (!supabaseClient || !state.bandProfile) return;
            const nameKr = document.getElementById('bandEditNameKr').value.trim();
            const nameEn = document.getElementById('bandEditNameEn').value.trim();
            const leaderName = document.getElementById('bandEditLeaderName').value.trim();
            const leaderPhone = document.getElementById('bandEditLeaderPhone').value.trim();
            const res = document.getElementById('bandInfoResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (!nameKr) { showErr('밴드명(국문)을 입력해주세요.'); return; }
            if (leaderPhone && !/^010-\d{4}-\d{4}$/.test(leaderPhone) && !/^01[0-9]{8,9}$/.test(leaderPhone.replace(/-/g, ''))) { showErr('올바른 전화번호를 입력해주세요.'); return; }
            // 예약어(관리자 팀명)로의 변경 차단 — 표시명 혼동/사칭 방지(관리자 판정은 로그인 아이디로 하지만
            // 다른 팀이 표시명을 '게더링'으로 바꾸는 것은 막는다). 관리자 계정이 자기 이름 유지 시는 허용.
            const RESERVED_BAND_NAMES = ['게더링'];
            if (RESERVED_BAND_NAMES.includes(nameKr) && !isBandAdmin() && state.bandProfile.band_name_kr !== nameKr) {
                showErr('사용할 수 없는 밴드명입니다.'); return;
            }
            _bandBusy(btn, true, '저장 중…');
            try {
                const { error } = await supabaseClient.from('profiles').update({
                    band_name_kr: nameKr, band_name_en: nameEn,
                    leader_name: leaderName, leader_phone: leaderPhone,
                    name: leaderName, phone: leaderPhone
                }).eq('id', state.bandProfile.id);
                if (error) { console.error('band info save error:', error); showErr('저장하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                state.bandProfile = { ...state.bandProfile, band_name_kr: nameKr, band_name_en: nameEn, leader_name: leaderName, leader_phone: leaderPhone };
                renderBandInfo(state.bandProfile);
                renderBandCycleNotice(state.bandProfile);
                const headerName = document.getElementById('bandHeaderName');
                if (headerName) headerName.innerHTML = _bandHeaderNameHTML(state.bandProfile);
                showToast('밴드 정보를 저장했습니다.');
            } finally { _bandBusy(btn, false); }
        }

        async function fetchAndRenderBandNotices() {
            if (!supabaseClient || !state.bandProfile) return;
            const list = document.getElementById('bandNoticeList');
            if (list && !state.bandNotices.length) list.innerHTML = _bandLoadingHTML();
            const { data } = await supabaseClient.from('band_notices').select('*').order('created_at', { ascending: false }).limit(20);
            state.bandNotices = data || [];
            renderBandNotices();
        }

        function renderBandNotices() {
            _bandNavCount('bandNavNotice', state.bandNotices.length ? `${state.bandNotices.length}건` : '없음');
            const list = document.getElementById('bandNoticeList');
            if (!list) return;
            if (!state.bandNotices.length) { list.innerHTML = _bandEmptyHTML('등록된 공지사항이 없습니다.'); return; }
            const admin = isBandAdmin();
            list.innerHTML = state.bandNotices.map(n => `
                <div class="band-notice-item" id="band-notice-${n.id}">
                    <div id="band-notice-view-${n.id}">
                        <div style="font-weight:700;font-size:0.92rem;margin-bottom:4px">${escHtml(n.title)}</div>
                        <div style="font-size:0.85rem;color:var(--wds-gray-700);white-space:pre-wrap;margin-bottom:6px">${escHtml(n.content||'')}</div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                            <span class="band-muted">${escHtml(n.created_by||'')} · ${new Date(n.created_at).toLocaleDateString('ko-KR')}</span>
                            ${admin ? `<div class="gaa-btn-row" style="gap:2px">
                                <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="editBandNotice('${n.id}')">수정</button>
                                <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="deleteBandNotice('${n.id}')">삭제</button>
                            </div>` : ''}
                        </div>
                    </div>
                    <div id="band-notice-edit-${n.id}" hidden>
                        <div class="band-form-grid">
                            <label class="full">제목<input type="text" id="band-notice-edit-title-${n.id}" class="band-input" value="${escAttr(n.title)}"></label>
                            <label class="full">내용<textarea id="band-notice-edit-content-${n.id}" class="band-input" rows="3">${escHtml(n.content||'')}</textarea></label>
                        </div>
                        <div id="band-notice-edit-result-${n.id}" class="band-form-result"></div>
                        <div class="gaa-btn-row">
                            <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="saveBandNotice('${n.id}', this)">저장</button>
                            <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="cancelBandNoticeEdit('${n.id}')">취소</button>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function editBandNotice(id) {
            document.getElementById(`band-notice-view-${id}`).hidden = true;
            document.getElementById(`band-notice-edit-${id}`).hidden = false;
            document.getElementById(`band-notice-edit-title-${id}`)?.focus();
        }

        function cancelBandNoticeEdit(id) {
            document.getElementById(`band-notice-edit-${id}`).hidden = true;
            document.getElementById(`band-notice-view-${id}`).hidden = false;
        }

        async function saveBandNotice(id, btn) {
            if (!supabaseClient) return;
            const title = document.getElementById(`band-notice-edit-title-${id}`)?.value.trim();
            const content = document.getElementById(`band-notice-edit-content-${id}`)?.value.trim();
            const res = document.getElementById(`band-notice-edit-result-${id}`);
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (!title) { showErr('제목을 입력해주세요.'); return; }
            _bandBusy(btn, true, '저장 중…');
            try {
                const { error } = await supabaseClient.from('band_notices').update({ title, content }).eq('id', id);
                if (error) { console.error('band notice save error:', error); showErr('저장하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                showToast('공지사항을 수정했습니다.');
                fetchAndRenderBandNotices();
            } finally { _bandBusy(btn, false); }
        }

        function showAddBandNotice() {
            const form = document.getElementById('bandNoticeForm');
            if (!form) return;
            form.classList.toggle('hidden');
            const res = document.getElementById('bandNoticeResult');
            if (res) res.textContent = '';
            if (!form.classList.contains('hidden')) document.getElementById('bandNoticeTitle')?.focus();
        }

        async function postBandNotice(btn) {
            if (!supabaseClient || !state.bandProfile) return;
            const res = document.getElementById('bandNoticeResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (!isBandAdmin()) { showErr('공지사항 작성 권한이 없습니다.'); return; }
            const titleEl = document.getElementById('bandNoticeTitle');
            const contentEl = document.getElementById('bandNoticeContent');
            const title = titleEl.value.trim();
            const content = contentEl.value.trim();
            if (!title) { showErr('제목을 입력해주세요.'); return; }
            _bandBusy(btn, true, '등록 중…');
            try {
                const { error } = await supabaseClient.from('band_notices').insert({
                    title, content, created_by: state.bandProfile.band_name_kr || state.bandProfile.name || ''
                });
                if (error) { console.error('band notice post error:', error); showErr('등록하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                titleEl.value = ''; contentEl.value = '';
                document.getElementById('bandNoticeForm').classList.add('hidden');
                showToast('공지사항을 등록했습니다.');
                fetchAndRenderBandNotices();
            } finally { _bandBusy(btn, false); }
        }

        async function deleteBandNotice(id) {
            if (!supabaseClient) return;
            if (!isBandAdmin()) { showToast('공지사항 삭제 권한이 없습니다.'); return; }
            if (!confirm('공지사항을 삭제하시겠습니까?')) return;
            const { error } = await supabaseClient.from('band_notices').delete().eq('id', id);
            if (error) { console.error('band notice delete error:', error); showToast('삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            showToast('공지사항을 삭제했습니다.');
            fetchAndRenderBandNotices();
        }

        async function fetchAndRenderBandTeamList() {
            if (!supabaseClient) return;
            const list = document.getElementById('bandTeamList');
            if (!list) return;
            const { data: teams } = await supabaseClient.from('profiles')
                .select('id, band_name_kr, band_name_en, leader_name, leader_phone, timeslots, band_ended_at, band_end_date')
                .eq('member_type', 'band').eq('status', 'approved').order('created_at', { ascending: true });
            const live = (teams || []).filter(t => !bandEndedDate(t)); // 종료 예정일이 지난 팀은 목록에서 제외
            _bandNavCount('bandNavTeams', live.length ? `${live.length}팀` : '없음');
            if (!live.length) { list.innerHTML = _bandEmptyHTML('등록된 팀이 없습니다.'); return; }
            const { data: allMembers } = await supabaseClient.from('band_members').select('*').order('created_at', { ascending: true });
            const memberMap = {};
            (allMembers || []).forEach(m => {
                if (!memberMap[m.band_profile_id]) memberMap[m.band_profile_id] = [];
                memberMap[m.band_profile_id].push(m);
            });
            list.innerHTML = live.map(t => {
                const members = memberMap[t.id] || [];
                const membersHtml = members.length
                    ? members.map(m => `<span class="band-member-chip">${escHtml(m.name)}${m.part ? `<span style="opacity:0.7;font-weight:400">&nbsp;${escHtml(m.part)}</span>` : ''}</span>`).join('')
                    : '<span class="band-muted">팀원 미등록</span>';
                const isMine = state.bandProfile && t.id === state.bandProfile.id;
                return `
                    <div class="band-team-card${isMine ? ' mine' : ''}">
                        <div class="band-card-top">
                            <div style="flex:1;min-width:0">
                                <div class="band-card-title">${escHtml(t.band_name_kr||'-')} <span class="band-muted">${escHtml(t.band_name_en||'')}</span></div>
                                <div class="band-card-sub">리더 ${escHtml(t.leader_name||'-')}</div>
                                <div class="band-card-slot">${escHtml(bandSlotSheetText(t.timeslots))}</div>
                            </div>
                            ${isMine ? '<span class="status-badge sm status-info">내 팀</span>' : ''}
                        </div>
                        <div class="band-cycle-strip" style="margin-top:6px">${membersHtml}</div>
                    </div>
                `;
            }).join('');
        }

        async function fetchAndRenderBandMembers() {
            if (!supabaseClient || !state.bandProfile) return;
            const { data } = await supabaseClient.from('band_members').select('*').eq('band_profile_id', state.bandProfile.id).order('created_at', { ascending: true });
            state.bandMembers = data || [];
            renderBandMembers();
        }

        function renderBandMembers() {
            _bandNavCount('bandNavMembers', state.bandMembers.length ? `${state.bandMembers.length}명` : '미등록');
            const list = document.getElementById('bandMemberList');
            if (!list) return;
            if (!state.bandMembers.length) { list.innerHTML = _bandEmptyHTML('등록된 팀원이 없습니다. 위에서 이름과 파트를 추가해보세요.'); return; }
            list.innerHTML = state.bandMembers.map(m => `
                <div class="band-member-row">
                    <div style="display:flex;align-items:center;gap:8px">
                        <div class="band-avatar">${escHtml((m.name||'?')[0])}</div>
                        <div>
                            <div style="font-weight:600;font-size:0.9rem">${escHtml(m.name)}</div>
                            <div class="band-muted">${escHtml(m.part||'')}</div>
                        </div>
                    </div>
                    <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="deleteBandMember('${m.id}')" aria-label="팀원 삭제">삭제</button>
                </div>
            `).join('');
        }

        async function addBandMember(btn) {
            if (!supabaseClient || !state.bandProfile) return;
            const nameEl = document.getElementById('bandMemberName');
            const partEl = document.getElementById('bandMemberPart');
            const res = document.getElementById('bandMemberResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const name = nameEl.value.trim();
            const part = partEl.value.trim();
            if (!name) { showErr('이름을 입력해주세요.'); nameEl.focus(); return; }
            _bandBusy(btn, true, '추가 중…');
            try {
                const { error } = await supabaseClient.from('band_members').insert({ band_profile_id: state.bandProfile.id, name, part });
                if (error) { console.error('band member add error:', error); showErr('추가하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                nameEl.value = ''; partEl.value = '';
                showToast('팀원을 추가했습니다.');
                fetchAndRenderBandMembers();
                fetchAndRenderBandTeamList();
            } finally { _bandBusy(btn, false); }
        }

        async function deleteBandMember(id) {
            if (!supabaseClient) return;
            if (!confirm('팀원을 삭제하시겠습니까?')) return;
            const { error } = await supabaseClient.from('band_members').delete().eq('id', id);
            if (error) { console.error('band member delete error:', error); showToast('삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            fetchAndRenderBandMembers();
            fetchAndRenderBandTeamList();
        }

        async function fetchAndRenderBandComments() {
            if (!supabaseClient || !state.bandProfile) return;
            const list = document.getElementById('bandCommentList');
            if (list && !state.bandComments.length) list.innerHTML = _bandLoadingHTML();
            const { data } = await supabaseClient.from('band_comments').select('*').order('created_at', { ascending: true }).limit(200);
            state.bandComments = data || [];
            renderBandComments();
        }

        function renderBandComments() {
            const list = document.getElementById('bandCommentList');
            if (!list) return;
            const topLevel = state.bandComments.filter(c => !c.parent_id);
            const repliesByParent = {};
            state.bandComments.filter(c => c.parent_id).forEach(r => {
                if (!repliesByParent[r.parent_id]) repliesByParent[r.parent_id] = [];
                repliesByParent[r.parent_id].push(r);
            });
            const nReplies = state.bandComments.length - topLevel.length;
            _bandNavCount('bandNavComments', topLevel.length ? `${topLevel.length}건${nReplies ? ` · 답글 ${nReplies}` : ''}` : '없음');
            if (!topLevel.length) { list.innerHTML = _bandEmptyHTML('아직 요청사항이 없습니다. 첫 요청을 남겨보세요!'); return; }
            const myId = state.bandProfile ? state.bandProfile.id : null;
            const admin = isBandAdmin();
            list.innerHTML = topLevel.map(c => {
                const canDel = admin || (myId && c.band_profile_id === myId);
                const replies = repliesByParent[c.id] || [];
                return `
                <div class="band-comment-item" style="margin-bottom:10px">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                        <div>
                            <span style="font-weight:700;font-size:0.85rem">${escHtml(c.author_name||'익명')}</span>
                            <span class="band-muted" style="margin-left:6px">${new Date(c.created_at).toLocaleDateString('ko-KR')}</span>
                        </div>
                        <div class="gaa-btn-row" style="gap:2px">
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="toggleBandReplyForm('${c.id}')">답글</button>
                            ${canDel ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="deleteBandComment('${c.id}')">삭제</button>` : ''}
                        </div>
                    </div>
                    <div style="font-size:0.88rem;color:var(--wds-gray-900);margin-top:4px;white-space:pre-wrap">${escHtml(c.content)}</div>
                    ${replies.map(r => {
                        const canDelR = admin || (myId && r.band_profile_id === myId);
                        return `<div class="band-reply-item">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                                <div>
                                    <span style="font-weight:700;font-size:0.82rem">${escHtml(r.author_name||'익명')}</span>
                                    <span class="band-muted" style="margin-left:6px">${new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                                </div>
                                ${canDelR ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="deleteBandComment('${r.id}')">삭제</button>` : ''}
                            </div>
                            <div style="font-size:0.85rem;color:var(--wds-gray-900);margin-top:3px;white-space:pre-wrap">${escHtml(r.content)}</div>
                        </div>`;
                    }).join('')}
                    <div id="reply-form-${c.id}" class="band-inline-form" style="margin-left:14px" hidden>
                        <textarea id="reply-content-${c.id}" class="band-input" placeholder="답글을 입력하세요" rows="2"></textarea>
                        <div id="reply-result-${c.id}" class="band-form-result"></div>
                        <div class="gaa-btn-row">
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" onclick="postBandReply('${c.id}', this)">등록</button>
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="toggleBandReplyForm('${c.id}')">취소</button>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        function toggleBandReplyForm(commentId) {
            const form = document.getElementById(`reply-form-${commentId}`);
            if (!form) return;
            form.hidden = !form.hidden;
            if (!form.hidden) document.getElementById(`reply-content-${commentId}`)?.focus();
        }

        async function postBandReply(parentId, btn) {
            if (!supabaseClient || !state.bandProfile) return;
            const textarea = document.getElementById(`reply-content-${parentId}`);
            const res = document.getElementById(`reply-result-${parentId}`);
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const content = (textarea?.value || '').trim();
            if (!content) { showErr('답글을 입력해주세요.'); return; }
            _bandBusy(btn, true, '등록 중…');
            try {
                const { error } = await supabaseClient.from('band_comments').insert({
                    band_profile_id: state.bandProfile.id,
                    author_name: bandTeamDisplayName(state.bandProfile),
                    content,
                    parent_id: parentId
                });
                if (error) { console.error('band reply post error:', error); showErr('등록하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                textarea.value = '';
                fetchAndRenderBandComments();
            } finally { _bandBusy(btn, false); }
        }

        function bandTeamDisplayName(profile) {
            if (!profile) return '익명';
            const kr = (profile.band_name_kr || '').trim();
            const en = (profile.band_name_en || '').trim();
            if (kr && en) return `${kr}(${en})`;
            return kr || en || profile.name || '익명';
        }

        async function postBandComment(btn) {
            if (!supabaseClient || !state.bandProfile) return;
            const contentEl = document.getElementById('bandCommentContent');
            const res = document.getElementById('bandCommentResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const content = contentEl.value.trim();
            if (!content) { showErr('요청사항을 입력해주세요.'); contentEl.focus(); return; }
            _bandBusy(btn, true, '등록 중…');
            try {
                const { error } = await supabaseClient.from('band_comments').insert({
                    band_profile_id: state.bandProfile.id,
                    author_name: bandTeamDisplayName(state.bandProfile),
                    content,
                    parent_id: null
                });
                if (error) { console.error('band comment post error:', error); showErr('등록하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                contentEl.value = '';
                showToast('요청사항을 등록했습니다. 게더링 팀이 확인 후 답글로 회신드립니다.');
                fetchAndRenderBandComments();
            } finally { _bandBusy(btn, false); }
        }

        async function deleteBandComment(id) {
            if (!supabaseClient) return;
            if (!confirm('요청사항을 삭제하시겠습니까?')) return;
            const { error } = await supabaseClient.from('band_comments').delete().eq('id', id);
            if (error) { console.error('band comment delete error:', error); showToast('삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            fetchAndRenderBandComments();
        }

        function showSignupForm() {
            hideFindForms();
            document.getElementById('email-login-form').classList.add('hidden');
            document.getElementById('email-signup-form').classList.remove('hidden');
            const r1 = document.getElementById('loginResult'); if (r1) r1.textContent = '';
            const r2 = document.getElementById('signupResult'); if (r2) r2.textContent = '';
            resetSignupPreform();
            setTimeout(() => renderMtEditUI('mtEdit_signup', null), 0);
        }

        // 사전 가입 신청서(구글폼) 작성 여부. null=미선택, true=예, false=아니오
        let _signupPreformOk = null;

        // 질문 아래의 가입 폼 전체를 잠그거나 푼다(질문 버튼 자신은 항상 살려둔다).
        function _setSignupFormLocked(locked) {
            const form = document.getElementById('email-signup-form');
            if (!form) return;
            form.querySelectorAll('input, button, select, textarea').forEach(el => {
                if (el.closest('#signupPreformSection')) return;
                el.disabled = locked;
            });
            // 질문 영역은 흐리지 않는다 — 답을 다시 고를 수 있어야 한다.
            form.querySelectorAll('.instrument-section, .privacy-box, .privacy-label, input, button')
                .forEach(el => {
                    if (el.closest('#signupPreformSection')) return;
                    el.style.opacity = locked ? '0.45' : '';
                });
        }

        function resetSignupPreform() {
            _signupPreformOk = null;
            document.querySelectorAll('#signupPreformBtns .inst-btn').forEach(b => b.classList.remove('selected'));
            _setSignupFormLocked(false);
        }

        function selectSignupPreform(answer) {
            const yes = answer === 'yes';
            _signupPreformOk = yes;
            document.querySelectorAll('#signupPreformBtns .inst-btn').forEach(b =>
                b.classList.toggle('selected', b.dataset.preform === answer));
            const res = document.getElementById('signupResult');
            if (res) res.textContent = '';
            _setSignupFormLocked(!yes);
            if (!yes) showSignupPreformNotice();
        }

        // 가입 불가 안내 — 확인을 누르면 로그인 화면으로 돌아간다.
        // 색은 팔레트 변수로만 지정할 것: cssText 대입은 style 속성을 재직렬화해
        // body.dark의 [style*="background:#fff"] 일괄 보정이 걸리지 않는다.
        function showSignupPreformNotice() {
            document.getElementById('signupPreformNotice')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'signupPreformNotice';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
            const inner = document.createElement('div');
            inner.style.cssText = 'background:var(--wds-white);border-radius:14px;max-width:360px;width:100%;padding:24px 22px 18px;box-shadow:0 8px 32px rgba(0,0,0,0.25);font-family:inherit;text-align:center';
            inner.innerHTML = `
                <div style="font-size:1.02rem;font-weight:700;margin-bottom:10px;color:var(--wds-black)">📝 가입 신청서 확인</div>
                <div style="font-size:0.9rem;line-height:1.6;color:var(--wds-gray-900);margin-bottom:18px">운영진에게 문의하여 가입신청서를 먼저 작성해주세요.</div>
                <button class="gaa-btn gaa-btn-sm gaa-btn-block gaa-btn-primary preform-ok" type="button">확인</button>`;
            overlay.appendChild(inner);
            document.body.appendChild(overlay);
            inner.querySelector('.preform-ok').onclick = () => {
                overlay.remove();
                showLoginForm();
            };
        }

        function showLoginForm() {
            hideFindForms();
            document.getElementById('email-signup-form').classList.add('hidden');
            document.getElementById('email-login-form').classList.remove('hidden');
            const r1 = document.getElementById('loginResult'); if (r1) r1.textContent = '';
            const r2 = document.getElementById('signupResult'); if (r2) r2.textContent = '';
            resetSignupPreform();
        }

        function showFindId() {
            document.getElementById('email-login-form').classList.add('hidden');
            document.getElementById('find-id-form').classList.remove('hidden');
            document.getElementById('findIdName').value = '';
            document.getElementById('findIdPhone').value = '';
            document.getElementById('findIdResult').textContent = '';
        }

        function showFindPw() {
            document.getElementById('email-login-form').classList.add('hidden');
            document.getElementById('find-pw-form').classList.remove('hidden');
            document.getElementById('findPwEmail').value = '';
            document.getElementById('findPwResult').textContent = '';
        }

        function hideFindForms() {
            document.getElementById('find-id-form').classList.add('hidden');
            document.getElementById('find-pw-form').classList.add('hidden');
            document.getElementById('email-login-form').classList.remove('hidden');
            const r = document.getElementById('loginResult'); if (r) r.textContent = '';
        }

        function formatPhoneNumber(value) {
            const digits = value.replace(/\D/g, '').slice(0, 11);
            if (digits.length < 4) return digits;
            if (digits.length < 8) return digits.slice(0, 3) + '-' + digits.slice(3);
            if (digits.length <= 10) return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
            return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
        }
        document.addEventListener('input', (e) => {
            if (e.target && e.target.matches && e.target.matches('input[type="tel"]')) {
                const formatted = formatPhoneNumber(e.target.value);
                if (formatted !== e.target.value) e.target.value = formatted;
            }
        });

        async function handleFindId() {
            const name = document.getElementById('findIdName').value.trim();
            const phone = document.getElementById('findIdPhone').value.trim();
            const result = document.getElementById('findIdResult');
            if (!name || !phone) { result.textContent = '이름과 전화번호를 입력해주세요.'; result.style.color = '#e74c3c'; return; }
            result.textContent = '검색 중...'; result.style.color = 'var(--wds-gray-500)';
            const srv = await _gwAction('find_id', { name, phone }, { anon: true });
            if (!srv.down) { // 서버가 가린 이메일만 돌려준다
                if (!srv.ok || !srv.masked) { result.textContent = '일치하는 계정을 찾을 수 없습니다.'; result.style.color = '#e74c3c'; return; }
                const [m1, m2] = String(srv.masked).split('@');
                result.innerHTML = `등록된 이메일: <strong>${escapeHtml(m1)}@${escapeHtml(m2 || '')}</strong>`;
                result.style.color = 'var(--wds-primary)';
                return;
            }
            const { data, error } = await supabaseClient.from('profiles').select('email').eq('name', name).eq('phone', phone).single();
            if (error || !data || !data.email) {
                result.textContent = '일치하는 계정을 찾을 수 없습니다.'; result.style.color = '#e74c3c'; return;
            }
            const [local, domain] = data.email.split('@');
            const masked = local.length <= 2 ? local[0] + '**' : local.slice(0, 2) + '*'.repeat(Math.min(local.length - 2, 4));
            result.innerHTML = `등록된 이메일: <strong>${masked}@${escapeHtml(domain)}</strong>`;
            result.style.color = 'var(--wds-primary)';
        }
