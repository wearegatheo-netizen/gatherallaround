// 게더 올 어라운드 본 스크립트 2/8 (gatheo) — index.html 이 번호 순서대로 읽는 클래식 스크립트. 전역(함수·let/const)을 서로 공유한다.
// 고친 뒤에는 node tools/stamp-assets.mjs 로 index.html 의 ?v= 를 갱신할 것(tests/assets-unit.mjs 가 검사).

        function initApp() {
            console.log("App 초기화 시작...");
            // 부팅 로딩 스크린은 <body> 머리에 정적으로 있다(첫 페인트부터 덮음). 여기서는 걷는 규칙만:
            //  · 인증 판단이 끝나는 곳(loginUI/logoutUI/_finishBoot/showPendingScreen 등)이 hideBootOverlay() 를 부른다 —
            //    단 첫 페인트 후 최소 BOOT_MIN_MS 는 보여준다(너무 빨리 걷히면 번쩍임으로 보인다).
            //  · 어느 경로도 부르지 못하면(인증 지연·오류) BOOT_MAX_MS 에 걷는다.
            setTimeout(hideBootOverlay, BOOT_MAX_MS);
            initServiceWorker();
            initInstallBanner();
            initPortalHero();

            // Supabase 안전한 초기화
            try {
                if (typeof window.supabase !== 'undefined') {
                    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
                    _gwInstall(supabaseClient);
                    console.log("Supabase 초기화 완료");
                } else {
                    console.error("Supabase SDK 로드 실패");
                }
            } catch (e) {
                console.error("Supabase 초기화 중 에러:", e);
            }

            render();

            if (supabaseClient) {
                supabaseClient.auth.onAuthStateChange((event) => {
                    if (event === 'PASSWORD_RECOVERY') {
                        recoveryMode = true;
                        document.getElementById('portal-page').classList.add('hidden');
                        document.getElementById('landing-page').classList.remove('hidden');
                        document.getElementById('landing-page-band').classList.add('hidden');
                        document.getElementById('main-content').classList.add('hidden');
                        document.getElementById('email-login-form').classList.add('hidden');
                        document.getElementById('email-signup-form').classList.add('hidden');
                        document.getElementById('find-id-form').classList.add('hidden');
                        document.getElementById('find-pw-form').classList.add('hidden');
                        document.getElementById('reset-pw-form').classList.remove('hidden');
                    }
                });
            }

            const loginBtn = document.getElementById('kakao-login-btn');
            if (loginBtn) {
                loginBtn.addEventListener('click', handleLogin);
                console.log("로그인 버튼 이벤트 리스너 등록 완료");
            }

            document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', onTabClick));

            document.getElementById('prevBtn').addEventListener('click', () => navigate(-1));
            document.getElementById('nextBtn').addEventListener('click', () => navigate(1));
            const todayBtn = document.getElementById('todayBtn');
            const _today = new Date();
            todayBtn.textContent = `오늘 (${_today.getMonth() + 1}/${_today.getDate()})`;
            todayBtn.addEventListener('click', () => { state.viewDate = new Date(); render(); });
            document.getElementById('reservationForm').addEventListener('submit', onReserve);

            // 공유 링크로 직접 진입 시 — 포털·다른 화면 즉시 숨기고 테스트 목록 페이지로 이동
            const _sp = new URLSearchParams(location.search);
            const _newsId = _sp.get('news');
            if (_newsId) {
                ['portal-page','landing-page','landing-page-band','main-content','band-main-content','pending-screen']
                    .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
                history.replaceState({}, '', location.pathname);
                showBandNewsSection().then(() => {
                    openBandNewsItem(_newsId, '');
                });
                hideBootOverlay();
                return;
            }
            // 공동호스트 초대 링크 (?hostjoin=토큰) — 카카오톡 공유는 URL의 해시(#)를
            // 유지하지 않는 경우가 있어 쿼리 방식으로 받는다. 호스트 존은 GatheO 로그인과
            // 무관하므로 initSession 없이 바로 진입.
            const _hostJoin = _sp.get('hostjoin');
            if (_hostJoin && /^[A-HJ-NP-Z2-9]{6}$/i.test(_hostJoin)) {
                history.replaceState({}, '', location.pathname);
                showHostSection(['join', _hostJoin.toUpperCase()]);
                hideBootOverlay();
                return;
            }
            // 공연 공동 관리팀 초대 링크 (?eventjoin=코드)
            const _eventJoin = _sp.get('eventjoin');
            if (_eventJoin && /^[A-HJ-NP-Z2-9]{6}$/i.test(_eventJoin)) {
                history.replaceState({}, '', location.pathname);
                showHostSection(['eventjoin', _eventJoin.toUpperCase()]);
                hideBootOverlay();
                return;
            }
            const _isShareEntry = _sp.get('ct') && _sp.get('cr');
            if (_isShareEntry) {
                window.__shareEntryMode = true; // loginUI/logoutUI에서 포털 재노출 차단용
                const _ct = _sp.get('ct'), _cr = _sp.get('cr');
                const _m = parseInt(_sp.get('m'), 10); // 공유자의 매칭률 (선택, 구 링크엔 없음)
                ['portal-page','landing-page','landing-page-band','main-content','band-main-content','pending-screen','band-news-page','performance-booking-page','shows-page','host-page']
                    .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
                history.replaceState({}, '', location.pathname);
                showCommunitySection().then(() => {
                    state.communityTab = 'test';
                    const _valid = (_ct === 'inst' && INST_RESULTS[_cr]) || (_ct === 'band' && BAND_RESULTS[_cr]);
                    if (_valid) {
                        // 공유자의 결과 화면을 그대로 보여주고 "나도 테스트하기" CTA 노출
                        state.communityTestType = _ct;
                        state.communityTestResult = _cr;
                        state.communityTestDetail = (_ct === 'band' && _m >= 60 && _m <= 99)
                            ? { userAxes: null, ranking: [{ key: _cr, pct: _m }] } : null;
                        state.communityTestShared = true;
                        renderCommunityTestResult();
                    } else {
                        state.communityTestType = null;
                        state.communityTestResult = null;
                        renderCommunityTestHome();
                    }
                    window.__shareEntryMode = false;
                });
                hideBootOverlay();
                return; // initSession 호출 안 함 — 공유 결과/테스트 목록만 표시
            }

            // ── 새로고침/딥링크 복원: 현재 URL hash가 가리키는 섹션을 기억해 둔다.
            // 인증 상태가 정해진 뒤(loginUI/logoutUI) applyPendingRoute로 이동.
            const _initialPage = _pageFromHash();
            history.replaceState({ page: _initialPage }, '',
                _initialPage === 'portal' ? location.pathname : '#' + _initialPage);
            if (_initialPage !== 'portal') {
                _pendingRoute = _initialPage;
                // 공개 섹션(커뮤니티/밴드소식/공간대관)은 인증과 무관하므로 즉시
                // 표시해 포털 깜빡임을 방지. 로그인 콜백이 main-content로 덮어써도
                // applyPendingRoute가 다시 복원한다.
                if (['community', 'band-news', 'perf', 'shows', 'host'].includes(_initialPage.split('/')[0])) {
                    _routeToPage(_initialPage);
                }
                // 로그인/로그아웃 콜백이 끝내 호출되지 않는 경우(로그아웃 상태 등)
                // 대비한 fallback — 인증 미해결 시에만 복원.
                setTimeout(() => { if (!_authResolved) applyPendingRoute(); }, 1500);
            }

            initSession();
        }

        async function initSession() {
            // 호스트 센터에서 카카오 로그인 중 리다이렉트로 돌아온 경우 — 게더링 자동 로그인 대신 호스트 센터로 복귀
            try {
                if (sessionStorage.getItem('gaa_return_host')) {
                    sessionStorage.removeItem('gaa_return_host');
                    showHostSection();
                    hideBootOverlay();
                    return;
                }
            } catch (e) {}
            // 게더링 카카오 로그인이 리다이렉트로 돌아온 경우(인앱 브라우저) — 토큰이 살아 있으면 로그인을 마저 하고 원래 페이지로(2026-10-29)
            try {
                const back = sessionStorage.getItem(_RETURN_TO_KEY);
                if (back && /^gatheo(\/|$)/.test(back)) {
                    // 리다이렉트로 해시가 지워졌으면 저장된 경로를 딥링크로 복원(세션이 이미 있으면 아래 복구 경로가 그대로 그 화면으로 간다)
                    if (!_pendingRoute) { _pendingRoute = back; history.replaceState({ page: back }, '', '#' + back); }
                    let token = null;
                    try { if (typeof Kakao !== 'undefined' && Kakao.Auth) { if (!Kakao.isInitialized()) initKakao(); token = Kakao.Auth.getAccessToken && Kakao.Auth.getAccessToken(); } } catch (_) {}
                    if (token && supabaseClient && !localStorage.getItem('gaa_kakao_uid')) {
                        _pendingRoute = null; // loginUI 가 gaa_return_to 를 소비해 그 탭·글로 간다
                        const ok = await _completeKakaoLogin();
                        if (ok) return;
                        _pendingRoute = back; // 실패 → 로그인 폼(경로는 _routeToPage 가 다시 저장)
                    }
                }
            } catch (e) { console.warn('로그인 복귀 처리 실패:', e); }
            // 명시적 로그아웃 후에는 자동 로그인 건너뜀
            const portalRequired = localStorage.getItem('gaa_portal_required');
            if (portalRequired) {
                try { localStorage.removeItem('gaa_portal_required'); } catch(e) {}
                try { localStorage.removeItem('gaa_kakao_uid'); } catch(e) {}
                if (supabaseClient) { try { await supabaseClient.auth.signOut(); } catch(e) {} }
                _finishBoot(); // 포털(딥링크가 있으면 그 섹션)
                return;
            }
            // 어느 화면으로 들어왔나 — 루트(포털)면 세션은 복구하되 화면은 포털에 둔다(자동 진입 안 함).
            // 섹션 딥링크·새로고침(#gatheo/…, #band)이면 지금처럼 그 화면으로 바로 들어간다.
            // (2026-10-06: 포털로 들어왔는데 직전 로그인 계정의 게더링/합주팀 화면이 바로 떠 버리던 문제.
            //  포털에서 섹션 버튼을 누르면 showGatheoSection/showBandSection 이 복구된 세션으로 바로 진입한다.)
            const target = String(_pendingRoute || 'portal').split('/')[0];
            // 이메일(Supabase) 세션 — 게더링 이메일 회원·고정 합주팀 공용. 주인의 구역은 profiles.member_type 으로 판별
            try {
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (session && session.user) {
                    if (recoveryMode) { hideBootOverlay(); return; } // 비밀번호 재설정 플로우 — 자동 로그인 건너뜀
                    await checkEmailUserApproval(session.user, { target });
                    return;
                }
            } catch (e) { console.warn('Supabase 세션 체크 실패:', e); }
            // 카카오 세션 캐시로 복구 (token이 메모리에 없어도 재인증)
            const cachedKakaoId = localStorage.getItem('gaa_kakao_uid');
            if (cachedKakaoId && supabaseClient && !(await _gwBootSessionOk(cachedKakaoId))) {
                // 서버 세션이 없고 카카오 토큰도 만료 — 한 번 다시 로그인해야 한다(2026-11-10 보안 개선 뒤 첫 방문)
                try { localStorage.removeItem('gaa_kakao_uid'); } catch(e) {}
                setTimeout(() => showToast('보안 업데이트로 다시 로그인이 필요합니다.', 5000), 1200);
            } else if (cachedKakaoId && supabaseClient) {
                try {
                    const { data } = await supabaseClient.from('profiles').select('*').eq('kakao_id', cachedKakaoId).maybeSingle();
                    if (data && data.status === 'approved') {
                        state.user = { nickname: data.name, kakaoId: cachedKakaoId, role: data.role || '일반', avatarUrl: data.avatar_url || null };
                        if (target === 'gatheo') loginUI(state.user.nickname); else _finishBoot();
                        return;
                    }
                    if (data && data.status === 'pending') { showPendingScreen(data.name || ''); return; }
                } catch (e) { console.warn('카카오 캐시 세션 복구 실패:', e); }
                try { localStorage.removeItem('gaa_kakao_uid'); } catch(e) {}
            }
            // 주의: 살아있는 카카오 토큰만으로 GatheO에 자동 진입하지 않는다.
            // 호스트 센터 로그인도 같은 카카오 SDK 토큰을 쓰므로, 토큰 존재 = 게더링 회원 진입 의사가 아니다.
            // (과거 checkSession()이 이 폴백을 하다가 "호스트 로그인 후 재방문 시 게더링 자동 진입" 버그를 만들었다.)
            // GatheO 자동 로그인은 명시적 게더링 로그인이 남긴 gaa_kakao_uid 캐시로만 판단한다.
            _finishBoot(); // 세션 없음 — 포털(딥링크가 있으면 그 섹션) 표시
        }

        // 부팅 시 인증 판단이 끝났을 때 — 로딩 오버레이를 걷고, 딥링크가 있으면 그 섹션으로, 없으면 포털로.
        // (loginUI/loginBandUI 로 바로 들어가는 경우엔 그쪽이 같은 일을 한다)
        function _finishBoot() {
            hideBootOverlay();
            _authResolved = true;
            if (_pendingRoute) applyPendingRoute();
            else if (!window.__shareEntryMode) showPortal();
        }

        function navigate(dir) {
            const d = state.viewDate;
            if (state.currentView === 'month') state.viewDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
            else if (state.currentView === 'week') state.viewDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (dir * 7));
            else state.viewDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir);
            render();
        }

        function render() {
            const container = document.getElementById('viewContainer');
            const title = document.getElementById('viewTitle');
            const nav = document.querySelector('.nav-btns');
            const prevScrolls = Array.from(container.querySelectorAll('.weekly-container')).map(el => ({ left: el.scrollLeft, top: el.scrollTop }));
            container.innerHTML = '';
            const d = state.viewDate;
            const isSpecial = state.currentView === 'my' || state.currentView === 'admin';
            const hideSubmit = isSpecial || state.currentView === 'month';
            const submitBtn = document.querySelector('#reservationForm .submit-btn');
            const result = document.getElementById('result');
            if (submitBtn) submitBtn.style.display = hideSubmit ? 'none' : '';
            if (result && isSpecial) result.style.display = 'none';

            if (state.currentView === 'my') {
                title.textContent = '내 예약 내역';
                if (nav) nav.style.display = 'none';
                renderMyPage(container);
            } else if (state.currentView === 'admin') {
                title.textContent = '';
                if (nav) nav.style.display = 'none';
                renderAdminPage(container);
            } else {
                if (nav) nav.style.display = 'flex';
                if (state.currentView === 'month') {
                    title.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
                    renderMonth(container);
                } else if (state.currentView === 'week') {
                    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
                    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
                    title.textContent = `${sun.getMonth() + 1}.${sun.getDate()} - ${sat.getMonth() + 1}.${sat.getDate()}`;
                    renderWeek(container);
                } else {
                    title.textContent = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
                    renderDay(container);
                }
            }
            renderParticipantSelector();
            const wcs = container.querySelectorAll('.weekly-container');
            wcs.forEach((el, i) => { if (prevScrolls[i]) { el.scrollLeft = prevScrolls[i].left; el.scrollTop = prevScrolls[i].top; } });
            // 홈·예약 머리 줄·마이 하위 화면은 같은 데이터를 보므로 함께 갱신(2026-10-15)
            gtHomeRefresh(); gtUpdateMyResRow();
            if (state.gatheoTab === 'mypage' && state.mypageSub) renderMypageSubView();
        }

        // 지난 팀 판정 — 활동 종료일이 어제 이전이면 지난 팀 (종료일 없음 = 진행 중).
        // 팀 관리 화면의 '지난 팀' 분리와 예약 폼 팀/멤버 선택 목록 제외에 공용.
        function isPastTeam(t) {
            return !!(t && t.end_date && t.end_date < new Date().toLocaleDateString('en-CA'));
        }

        function renderParticipantSelector() {
            const section = document.getElementById('participantSection');
            const sel = document.getElementById('participantSelect');
            const chips = document.getElementById('participantChips');
            if (!section || !sel || !chips) return;
            const isReservable = state.currentView !== 'my' && state.currentView !== 'admin' && state.currentView !== 'month';
            const show = isReservable && state.startTime;
            section.style.display = show ? '' : 'none';
            if (!show) return;

            const members = (state.cachedMembers || []).filter(m => !isHiddenMember(m));
            const teams = (state.teams || []).filter(t => !isPastTeam(t)); // 지난 팀은 예약 선택 목록에서 제외

            let optionsHtml = '<option value="">선택...</option>';
            if (teams.length > 0) {
                optionsHtml += '<optgroup label="팀">';
                teams.forEach(t => {
                    const teamMembers = (t.members || []).filter(s => s.memberId).length;
                    optionsHtml += `<option value="T:${t.id}">🎵 ${escapeHtml(t.name || '팀')} (${teamMembers}명)</option>`;
                });
                optionsHtml += '</optgroup>';
            }
            if (members.length > 0) {
                optionsHtml += '<optgroup label="멤버">';
                members.forEach(m => {
                    optionsHtml += `<option value="M:${m.id}">${memberDisplayName(m)}</option>`;
                });
                optionsHtml += '</optgroup>';
            }
            sel.innerHTML = optionsHtml;

            if (state.participantIds.length === 0) {
                chips.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.8rem;margin:0">아직 추가된 멤버가 없습니다.</p>';
            } else {
                chips.innerHTML = state.participantIds.map(id => {
                    const m = (state.cachedMembers || []).find(x => x.id === id);
                    const name = m ? memberDisplayName(m) : '(알 수 없음)';
                    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 5px 4px 10px;background:var(--wds-primary);color:#fff;border-radius:16px;font-size:0.82rem;font-weight:600">${name}<button type="button" onclick="removeParticipant('${id}')" aria-label="${name} 빼기" style="background:rgba(255,255,255,0.25);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:0.95rem;line-height:1;display:flex;align-items:center;justify-content:center">×</button></span>`;
                }).join('');
            }
        }

        function addParticipantFromSelect() {
            const sel = document.getElementById('participantSelect');
            if (!sel || !sel.value) return;
            const [type, id] = sel.value.split(':');
            if (type === 'M') {
                if (state.participantIds.includes(id)) {
                    showToast('이미 추가된 멤버예요.');
                    sel.value = ''; return;
                }
                state.participantIds.push(id);
            } else if (type === 'T') {
                const team = (state.teams || []).find(t => t.id === id);
                if (!team) { sel.value = ''; return; }
                const teamMemberIds = (team.members || []).map(s => s.memberId).filter(Boolean);
                if (teamMemberIds.length === 0) {
                    showToast('이 팀에 등록된 멤버가 없어요.');
                    sel.value = ''; return;
                }
                const dups = teamMemberIds.filter(mid => state.participantIds.includes(mid));
                if (dups.length > 0) {
                    const dupNames = dups.map(mid => {
                        const m = state.cachedMembers.find(x => x.id === mid);
                        return m ? (m.name || '?') : '?';
                    }).join(', ');
                    showToast(`이 팀의 멤버 중 ${dupNames}이(가) 이미 추가되어 있어요. 기존 칩을 빼고 팀을 고르거나, 팀 대신 나머지 멤버를 따로 골라주세요.`, 5000);

                    sel.value = ''; return;
                }
                teamMemberIds.forEach(mid => state.participantIds.push(mid));
            }
            sel.value = '';
            renderParticipantSelector();
        }

        function removeParticipant(memberId) {
            const idx = state.participantIds.indexOf(memberId);
            if (idx >= 0) state.participantIds.splice(idx, 1);
            renderParticipantSelector();
        }

        function isReservationEditable(r) {
            if (!r || !r.res_date || !r.start_time || r.status === 'rejected') return false;
            const [y, mo, d] = r.res_date.split('-').map(Number);
            const dateObj = new Date(y, mo - 1, d);
            return !isPastSlot(dateObj, r.start_time);
        }

        function openEditParticipantsModal(resId) {
            if (String(resId).startsWith('perf-')) { showToast('공간 대관 건은 관리자 탭의 🎭 공간대관에서 관리해주세요.'); return; }
            const r = (state.reservations || []).find(x => x.id === resId);
            if (!r) return;
            // 총괄은 지난 예약도 보정할 수 있어야 한다(관리자 목록에 지난 예약이 노출되므로).
            if (!isReservationEditable(r) && !isSuper()) { showToast('이미 지나간 예약은 수정할 수 없습니다.'); return; }
            state.editingResId = resId;
            state.editingResParticipantIds = Array.isArray(r.participant_ids) ? [...r.participant_ids] : [];
            const endIdx = TIMES.indexOf(r.end_time);
            const endTimeDisplay = TIMES[endIdx + 1] || '23:00';
            document.getElementById('editParticipantsResInfo').textContent = `${r.res_date} · ${r.start_time} ~ ${endTimeDisplay}`;
            document.getElementById('editParticipantsModal').classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            renderEditParticipantSelector();
            const etcEl = document.getElementById('editParticipantEtcInput');
            const countEl = document.getElementById('editParticipantCountInput');
            const { text: etcText, count: etcCount } = splitEtc(r.participant_etc);
            if (etcEl) etcEl.value = etcText;
            if (countEl) countEl.value = String(etcCount);
        }

        function closeEditParticipantsModal() {
            document.getElementById('editParticipantsModal').classList.add('hidden');
            document.body.style.overflow = '';
            state.editingResId = null;
            state.editingResParticipantIds = [];
        }

        function renderEditParticipantSelector() {
            const sel = document.getElementById('editParticipantSelect');
            const chips = document.getElementById('editParticipantChips');
            if (!sel || !chips) return;
            const members = (state.cachedMembers || []).filter(m => !isHiddenMember(m));
            const teams = (state.teams || []).filter(t => !isPastTeam(t)); // 지난 팀은 선택 목록에서 제외
            let optionsHtml = '<option value="">선택...</option>';
            if (teams.length > 0) {
                optionsHtml += '<optgroup label="팀">';
                teams.forEach(t => {
                    const tm = (t.members || []).filter(s => s.memberId).length;
                    optionsHtml += `<option value="T:${t.id}">🎵 ${escapeHtml(t.name || '팀')} (${tm}명)</option>`;
                });
                optionsHtml += '</optgroup>';
            }
            if (members.length > 0) {
                optionsHtml += '<optgroup label="멤버">';
                members.forEach(m => {
                    optionsHtml += `<option value="M:${m.id}">${memberDisplayName(m)}</option>`;
                });
                optionsHtml += '</optgroup>';
            }
            sel.innerHTML = optionsHtml;
            const ids = state.editingResParticipantIds || [];
            if (ids.length === 0) {
                chips.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.8rem;margin:0">아직 추가된 멤버가 없습니다.</p>';
            } else {
                chips.innerHTML = ids.map(id => {
                    const m = (state.cachedMembers || []).find(x => x.id === id);
                    const name = m ? memberDisplayName(m) : '(알 수 없음)';
                    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px 5px 10px;background:var(--wds-primary);color:#fff;border-radius:16px;font-size:0.82rem;font-weight:600">${name}<button type="button" onclick="removeEditParticipant('${id}')" style="background:rgba(255,255,255,0.25);border:none;color:#fff;width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:0.8rem;line-height:1;display:flex;align-items:center;justify-content:center">×</button></span>`;
                }).join('');
            }
        }

        function addEditParticipant() {
            const sel = document.getElementById('editParticipantSelect');
            if (!sel || !sel.value) return;
            const [type, id] = sel.value.split(':');
            const cur = state.editingResParticipantIds || [];
            if (type === 'M') {
                if (cur.includes(id)) { showToast('이미 추가된 멤버예요.'); sel.value = ''; return; }
                cur.push(id);
            } else if (type === 'T') {
                const team = (state.teams || []).find(t => t.id === id);
                if (!team) { sel.value = ''; return; }
                const teamMemberIds = (team.members || []).map(s => s.memberId).filter(Boolean);
                if (teamMemberIds.length === 0) { showToast('이 팀에 등록된 멤버가 없어요.'); sel.value = ''; return; }
                const dups = teamMemberIds.filter(mid => cur.includes(mid));
                if (dups.length > 0) {
                    const dupNames = dups.map(mid => {
                        const m = state.cachedMembers.find(x => x.id === mid);
                        return m ? (m.name || '?') : '?';
                    }).join(', ');
                    showToast(`이 팀의 멤버 중 ${dupNames}이(가) 이미 추가되어 있어요. 기존 칩을 빼고 팀을 고르거나, 팀 대신 나머지 멤버를 따로 골라주세요.`, 5000);
                    sel.value = ''; return;
                }
                teamMemberIds.forEach(mid => cur.push(mid));
            }
            state.editingResParticipantIds = cur;
            sel.value = '';
            renderEditParticipantSelector();
        }

        function removeEditParticipant(memberId) {
            const cur = state.editingResParticipantIds || [];
            const idx = cur.indexOf(memberId);
            if (idx >= 0) cur.splice(idx, 1);
            renderEditParticipantSelector();
        }

        async function saveEditParticipants() {
            if (!state.editingResId) return;
            const ids = state.editingResParticipantIds || [];
            if (ids.length === 0) { showToast('참여 멤버를 1명 이상 추가해주세요.'); return; }
            const etcEl = document.getElementById('editParticipantEtcInput');
            const countEl = document.getElementById('editParticipantCountInput');
            const etcVal = joinEtc(etcEl ? etcEl.value : '', countEl ? countEl.value : 0);
            const { error } = await supabaseClient.from('reservations').update({ participant_ids: ids, participant_etc: etcVal || null }).eq('id', state.editingResId);
            if (error) { showToast('수정 실패: ' + error.message); return; }
            closeEditParticipantsModal();
            showToast('참여 멤버가 수정되었습니다.');
            // 목록·달력을 즉시 갱신 (예전엔 fetch만 하고 다시 그리지 않아 화면이 그대로였다)
            await refreshAdminApprovalView();
            if (state.gatheoTab === 'mypage') renderMypagePanel();
        }

        // --- 멤버 패널 ---
        function toggleMemberPanel() { setGatheOTab('member'); }

        function setMemberTab(tab) {
            state.memberPanelTab = tab;
            document.querySelectorAll('#memberSeg [data-tab]').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
            if (state.gatheoTab !== 'member') setGatheOTab('member'); else renderMemberPanel();
            _pushNav('gatheo/member/' + tab); // 하위탭 딥링크 주소 발행
        }

        async function renderMemberPanel() {
            const view = document.getElementById('memberPanelView');
            if (!view) return;
            const mc = document.getElementById('gtMemberCnt'), tc = document.getElementById('gtTeamCnt');
            if (mc) mc.textContent = (state.cachedMembers || []).filter(m => !isHiddenMember(m)).length || '';
            if (tc) tc.textContent = (state.teams || []).filter(t => !isPastTeam(t)).length || '';
            const tab = state.memberPanelTab, key = 'member:' + tab;
            if (_gtViewCache[key]) { view.innerHTML = _gtViewCache[key]; view.dataset.cached = '1'; } else { delete view.dataset.cached; }
            if (tab === 'list') {
                await renderMembersTab(view);
            } else if (tab === 'stats') {
                await renderParticipationStatsTab(view);
            } else if (tab === 'activity') {
                view.innerHTML = '<div id="driveGalleryRoot"></div>';
                window.__driveStack = [];
                renderDriveGallery(DRIVE_ROOT_FOLDER_ID);
            } else if (tab === 'docs') {
                renderDocsPage(view);
            } else if (tab === 'schedule') {
                await renderScheduleView(view);
            } else {
                await renderTeamsTab(view);
            }
            delete view.dataset.cached;
            if (state.memberPanelTab === tab && ['list', 'teams', 'schedule', 'stats'].includes(tab)) _gtViewCache[key] = view.innerHTML;
        }

        async function renderVotesTab(container) {
            container.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.9rem;text-align:center;padding:20px">불러오는 중...</p>';
            await fetchPolls();
            await fetchPollVotes();
            const myId = getCurrentUserProfileId();
            const open = state.polls.filter(p => p.status === 'open');
            const closed = state.polls.filter(p => p.status === 'closed');
            const renderPollCard = (p, isClosed) => {
                const votes = state.pollVotes.filter(v => v.poll_id === p.id);
                const totalVoters = votes.length;
                const myVote = myId ? votes.find(v => v.voter_id === myId) : null;
                const counts = p.options.map((_, i) => votes.filter(v => Array.isArray(v.option_indices) && v.option_indices.includes(i)).length);
                const totalSel = counts.reduce((a, b) => a + b, 0);
                const winnerCount = Math.max(...counts, 0);
                const headerBg = isClosed ? 'var(--wds-gray-100)' : 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)';
                const headerColor = isClosed ? 'var(--wds-gray-700)' : '#fff';
                const statusBadge = isClosed
                    ? '<span style="background:var(--wds-gray-300);color:var(--wds-gray-700);font-size:0.7rem;padding:2px 8px;border-radius:10px;font-weight:600">종료</span>'
                    : '<span style="background:#ff4d4f;color:#fff;font-size:0.7rem;padding:2px 8px;border-radius:10px;font-weight:600;animation:pulse 2s infinite">🔴 LIVE</span>';
                const inputType = p.multi_select ? 'checkbox' : 'radio';
                const canVote = !isClosed && myId;
                return `
                    <div style="border:1px solid var(--wds-gray-200);border-radius:var(--wds-radius-m);overflow:hidden;margin-bottom:14px;background:white">
                        <div style="background:${headerBg};color:${headerColor};padding:12px 14px">
                            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
                                <div style="display:flex;align-items:center;gap:8px">${statusBadge}<span style="font-size:0.75rem;opacity:0.9">${escapeHtml(p.creator_name || '관리자')}</span></div>
                                <button type="button" onclick="sharePollKakao('${p.id}')" style="padding:3px 10px;font-size:0.72rem;background:#FEE500;color:#3C1E1E;border:none;border-radius:10px;cursor:pointer;font-weight:700;flex-shrink:0">카카오 공유</button>
                            </div>
                            <div style="font-size:1rem;font-weight:700">${escapeHtml(p.title)}</div>
                            <div style="font-size:0.75rem;opacity:0.85;margin-top:4px">${totalVoters}명 참여 · ${p.multi_select ? '다중 선택' : '단일 선택'}${p.anonymous ? ' · 익명' : ''}</div>
                        </div>
                        <div style="padding:12px 14px">
                            ${p.options.map((opt, i) => {
                                const c = counts[i];
                                const pct = totalSel > 0 ? Math.round((c / totalSel) * 100) : 0;
                                const isWinner = isClosed && c === winnerCount && c > 0;
                                const isMine = myVote && Array.isArray(myVote.option_indices) && myVote.option_indices.includes(i);
                                const optBg = isWinner ? 'linear-gradient(90deg,#FFD700,#FFA500)' : (isMine ? 'var(--wds-primary)' : 'var(--wds-gray-400)');
                                return `
                                    <label style="display:block;margin-bottom:8px;cursor:${canVote ? 'pointer' : 'default'}">
                                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                                            ${canVote ? `<input type="${inputType}" name="vote-${p.id}" value="${i}" ${isMine ? 'checked' : ''} style="margin:0">` : ''}
                                            <span style="font-size:0.9rem;font-weight:${isMine || isWinner ? '700' : '500'};flex:1">${isWinner ? '👑 ' : ''}${escapeHtml(opt)}${isMine ? ' <span style="color:var(--wds-primary);font-size:0.75rem">(내 선택)</span>' : ''}</span>
                                            <span style="font-size:0.78rem;color:var(--wds-gray-600);font-weight:600">${c}표 · ${pct}%</span>
                                        </div>
                                        <div style="background:var(--wds-gray-100);height:6px;border-radius:3px;overflow:hidden">
                                            <div style="width:${pct}%;height:100%;background:${optBg};border-radius:3px;transition:width 0.4s"></div>
                                        </div>
                                    </label>
                                `;
                            }).join('')}
                            ${!p.anonymous && totalVoters > 0 ? `
                                <details style="margin-top:8px"><summary style="cursor:pointer;font-size:0.78rem;color:var(--wds-gray-500)">투표자 보기</summary>
                                <div style="font-size:0.78rem;color:var(--wds-gray-600);margin-top:6px;line-height:1.6">
                                ${p.options.map((opt, i) => {
                                    const names = votes.filter(v => Array.isArray(v.option_indices) && v.option_indices.includes(i)).map(v => escapeHtml(v.voter_name || '?')).join(', ');
                                    return names ? `<div><strong>${escapeHtml(opt)}</strong>: ${names}</div>` : '';
                                }).join('')}
                                </div></details>
                            ` : ''}
                            ${canVote ? `
                                <div style="display:flex;gap:6px;margin-top:10px">
                                    <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex:1" type="button" onclick="submitVote('${p.id}')">${myVote ? '투표 수정' : '투표하기'}</button>
                                    ${myVote ? `<button class="gaa-btn gaa-btn-sm gaa-btn-secondary" type="button" onclick="cancelMyVote('${p.id}')">취소</button>` : ''}
                                </div>
                            ` : (!isClosed && !myId ? '<p style="font-size:0.8rem;color:var(--wds-gray-500);margin-top:8px;text-align:center">가입 승인된 멤버만 투표할 수 있습니다.</p>' : '')}
                        </div>
                    </div>
                `;
            };
            container.innerHTML = `
                ${open.length === 0 && closed.length === 0 ? '<p style="color:var(--wds-gray-500);font-size:0.9rem;text-align:center;padding:30px">진행 중인 투표가 없습니다.</p>' : ''}
                ${open.length > 0 ? `<div style="font-size:0.85rem;font-weight:700;color:var(--wds-gray-700);margin:4px 0 10px 4px">🔴 진행 중 (${open.length})</div>${open.map(p => renderPollCard(p, false)).join('')}` : ''}
                ${closed.length > 0 ? `<div style="font-size:0.85rem;font-weight:700;color:var(--wds-gray-700);margin:14px 0 10px 4px">📜 투표 이력 (${closed.length})</div>${closed.map(p => renderPollCard(p, true)).join('')}` : ''}
            `;
        }

        function setStatsFilter(f) {
            state.statsFilter = f;
            state.paging['statsRanking'] = 0;
            renderMemberPanel();
        }

        async function renderParticipationStatsTab(container) {
            _gtPlaceholder(container);
            const members = await fetchMembers();
            if (state.memberPanelTab !== 'stats') return;
            const approved = (members || []).filter(m => m.status === 'approved' && !isHiddenMember(m));
            state.cachedMembers = approved;

            const now = new Date();
            const monthStr = now.toLocaleDateString('en-CA').slice(0, 7);
            const yearStr = now.getFullYear().toString();
            const filterLabels = { all: '전체', month: '이번 달', year: '올해' };

            let baseRes = (state.reservations || []).filter(r => !r.__perf && (r.status === 'approved' || r.status === 'pending')); // 공간 대관 가상 행은 멤버 예약 건수가 아니다(2026-11-09 QA)
            let baseSchedules = (state.schedules || []);
            if (state.statsFilter === 'month') {
                baseRes = baseRes.filter(r => r.res_date && r.res_date.startsWith(monthStr));
                baseSchedules = baseSchedules.filter(s => s.date && s.date.startsWith(monthStr));
            } else if (state.statsFilter === 'year') {
                baseRes = baseRes.filter(r => r.res_date && r.res_date.startsWith(yearStr));
                baseSchedules = baseSchedules.filter(s => s.date && s.date.startsWith(yearStr));
            }

            // 일정표 직접 참여 신청(schedule_attendees)을 이 탭에서 직접 로드한다.
            // 이전엔 일정표 화면이 남긴 상태에 의존해서, 일정표(기본: 다가오는 일정)만
            // 봤거나 아예 안 본 경우 과거 신청 기록이 누락 집계되는 버그가 있었다.
            const todayStr = new Date().toLocaleDateString('en-CA');
            const attendeeDates = [...new Set(baseSchedules.map(s => s.date).filter(d => d && d <= todayStr))];
            await fetchScheduleAttendees(attendeeDates);

            const rowsRaw = approved.map(m => {
                const count = countParticipationDates(m.id, baseRes, baseSchedules);
                return { m, count };
            }).sort((a, b) => b.count - a.count);
            // 동점 처리: 같은 count면 같은 등수
            let lastCount = -1, lastRank = 0;
            const rows = rowsRaw.map((r, i) => {
                const rank = r.count === lastCount ? lastRank : (i + 1);
                lastCount = r.count; lastRank = rank;
                return { ...r, rank };
            });
            const maxCount = rows.length ? Math.max(...rows.map(r => r.count), 1) : 1;
            const myMember = state.user ? approved.find(m => m.kakao_id === state.user.kakaoId || m.email === state.user.email) : null;
            const myId = myMember ? myMember.id : null;

            const renderRow = ({ m, count, rank }) => {
                const isSelf = myId && m.id === myId;
                const barPct = Math.round((count / maxCount) * 100);
                const isZero = count === 0;
                const bg = isSelf ? 'var(--wds-primary-light)' : 'white';
                const border = isSelf ? '2px solid var(--wds-primary)' : '1px solid var(--wds-gray-200)';
                const nameColor = isSelf ? 'var(--wds-primary)' : (isZero ? 'var(--wds-gray-400)' : 'var(--wds-gray-800)');
                return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;background:${bg};border:${border};border-radius:10px">
                    <div style="font-size:0.85rem;font-weight:700;color:var(--wds-gray-500);min-width:28px;text-align:center">${rank}위</div>
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
                            <span style="font-size:0.88rem;font-weight:${isSelf?'800':'600'};color:${nameColor}">${memberDisplayName(m)}</span>
                            <span style="font-size:0.75rem;color:var(--wds-gray-500)">참여횟수 <strong style="color:${isSelf?'var(--wds-primary)':'var(--wds-primary)'}">${count}회</strong></span>
                        </div>
                        <div style="background:var(--wds-gray-100);height:5px;border-radius:3px;overflow:hidden">
                            <div style="width:${barPct}%;height:100%;background:linear-gradient(90deg,var(--wds-primary) 0%,#7B9EFF 100%);border-radius:3px"></div>
                        </div>
                    </div>
                </div>`;
            };

            const { items: pagedRows, page: rp, totalPages: rtp, total: rt } = getPaged(rows, 'statsRanking');

            container.innerHTML = `
                <div style="display:flex;gap:6px;margin-bottom:12px">
                    ${['all','month','year'].map(f => `<button type="button" class="gaa-btn gaa-btn-xs ${state.statsFilter===f?'gaa-btn-primary':'gaa-btn-secondary'}" style="flex:1" onclick="setStatsFilter('${f}')">${filterLabels[f]}</button>`).join('')}
                </div>
                <div style="display:flex;justify-content:space-around;align-items:center;margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:var(--wds-radius-m);color:#fff">
                    <div style="text-align:center">
                        <div style="font-size:0.7rem;opacity:0.85">예약 (${filterLabels[state.statsFilter]})</div>
                        <div style="font-size:1.3rem;font-weight:800">${baseRes.length}건</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:0.7rem;opacity:0.85">참여 멤버</div>
                        <div style="font-size:1.3rem;font-weight:800">${rows.filter(r => r.count > 0).length}명</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:0.7rem;opacity:0.85">최고 참여</div>
                        <div style="font-size:1.3rem;font-weight:800">${maxCount}회</div>
                    </div>
                </div>
                ${rows.length === 0
                    ? '<p style="color:var(--wds-gray-500);font-size:0.9rem;text-align:center;padding:30px">멤버가 없습니다.</p>'
                    : pagedRows.map(renderRow).join('')
                }
                ${pagerHTML('statsRanking', rp, rtp, rt)}
            `;
        }

        // --- 팀 ---
        async function fetchTeams() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient.from('teams').select('*').order('created_at', { ascending: false });
            if (!error) state.teams = data || [];
        }

        async function fetchSchedules() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient.from('schedules').select('*').order('date', { ascending: true }).order('start_time', { ascending: true });
            if (!error) { state.schedules = data || []; renderScheduleBanner(); }
        }

        async function fetchScheduleAttendees(dates) {
            // 요청한 날짜 + 이미 불러온 날짜를 합쳐 다시 받는다(2026-10-16) — 홈(다가오는 날짜)·일정표·참여횟수(지난 날짜)가 번갈아 불러도
            // 서로의 결과를 지우지 않는다. 너무 많아지면 요청분만. 상태는 응답을 받은 뒤 한 번에 바꾼다.
            const prev = Array.from(state._attLoaded || []);
            let all = [...new Set([...(dates || []), ...prev])];
            if (all.length > 120) all = [...new Set(dates || [])];
            if (!supabaseClient || all.length === 0) {
                state.scheduleAttendees = {}; state.scheduleGroupAttendees = {}; state.scheduleSlotAttendees = {}; state.scheduleGuests = {}; state._attLoaded = new Set(all);
                return;
            }
            // 외부인 참여(schedule_guests)도 같은 날짜 범위로 함께 — 표가 없으면(마이그레이션 전) 조용히 빈 값
            const [{ data }, gRes] = await Promise.all([
                supabaseClient.from('schedule_attendees').select('schedule_date, profile_id, group_name').in('schedule_date', all),
                state._guestsUnavailable ? Promise.resolve({ data: [] }) : supabaseClient.from('schedule_guests').select('id, schedule_date, slot_key, host_profile_id, guest_count, guest_names').in('schedule_date', all),
            ]);
            if (gRes && gRes.error) { if (gRes.error.code === '42P01') state._guestsUnavailable = true; else console.error('schedule_guests fetch error:', gRes.error); }
            const Gs = {};
            ((gRes && gRes.data) || []).forEach(g => { (Gs[g.schedule_date] = Gs[g.schedule_date] || []).push(g); });
            const A = {}, G = {}, S = {};
            (data || []).forEach(r => {
                const d = r.schedule_date;
                const gn = r.group_name;
                if (gn && gn.startsWith('slot|')) {
                    // 슬롯별 신청 (group_name 컬럼을 슬롯 키로 재사용)
                    if (!S[d]) S[d] = {};
                    if (!S[d][gn]) S[d][gn] = [];
                    if (!S[d][gn].includes(r.profile_id)) S[d][gn].push(r.profile_id);
                    return;
                }
                if (!gn) {
                    if (!A[d]) A[d] = [];
                    if (!A[d].includes(r.profile_id)) A[d].push(r.profile_id);
                } else {
                    if (!G[d]) G[d] = {};
                    if (!G[d][gn]) G[d][gn] = [];
                    if (!G[d][gn].includes(r.profile_id)) G[d][gn].push(r.profile_id);
                }
            });
            state.scheduleAttendees = A; state.scheduleGroupAttendees = G; state.scheduleSlotAttendees = S; state.scheduleGuests = Gs;
            state._attLoaded = new Set(all);
        }

        function checkSignupPeriod(date) {
            const entries = (state.schedules || []).filter(s => s.date === date);
            const first = entries[0];
            if (!first) return { ok: true };
            const now = new Date();
            if (first.signup_open && now < new Date(first.signup_open)) {
                const fmt = new Date(first.signup_open).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
                return { ok: false, msg: `신청 기간이 아직 시작되지 않았습니다.\n시작: ${fmt}` };
            }
            if (first.signup_close && now > new Date(first.signup_close)) {
                const fmt = new Date(first.signup_close).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
                return { ok: false, msg: `신청 기간이 마감되었습니다.\n마감: ${fmt}` };
            }
            return { ok: true };
        }

        window.toggleScheduleAttendance = async function(date) {
            if (!state.user) { showToast('로그인이 필요합니다.'); return; }
            const me = (state.cachedMembers || []).find(m => m.kakao_id === state.user.kakaoId || m.email === state.user.email);
            if (!me) { showToast('승인된 멤버만 참여 신청할 수 있어요.'); return; }
            if (date < new Date().toLocaleDateString('en-CA')) { showToast('지난 일정은 참여 신청·취소할 수 없어요.'); return; }
            const attendees = (state.scheduleAttendees || {})[date] || [];
            const already = attendees.includes(me.id);
            if (!already) { const p = checkSignupPeriod(date); if (!p.ok) { showToast(p.msg, 4000); return; } }
            if (already) {
                const { error } = await supabaseClient.from('schedule_attendees').delete().eq('schedule_date', date).eq('profile_id', me.id);
                if (error) { console.error('attend cancel:', error); showToast('취소하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            } else {
                const { error } = await supabaseClient.from('schedule_attendees').insert({ schedule_date: date, profile_id: me.id });
                if (error) {
                    if (error.code === '42P01' || (error.message||'').includes('does not exist')) {
                        alert('⚠️ schedule_attendees 테이블이 없습니다.\n\nSupabase SQL Editor에서 아래 SQL을 실행해주세요:\n\nCREATE TABLE schedule_attendees (\n  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,\n  schedule_date date NOT NULL,\n  profile_id uuid NOT NULL,\n  created_at timestamptz DEFAULT now(),\n  UNIQUE(schedule_date, profile_id)\n);\nALTER TABLE schedule_attendees ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "allow_all" ON schedule_attendees FOR ALL USING (true) WITH CHECK (true);');
                    } else {
                        console.error('attend apply:', error); showToast('신청하지 못했습니다. 잠시 후 다시 시도해주세요.');
                    }
                    return;
                }
            }
            renderMemberPanel();
        };

        window.toggleGroupAttendance = async function(date, groupName) {
            if (!state.user) { showToast('승인된 멤버만 참여 신청할 수 있어요.'); return; }
            const me = (state.cachedMembers || []).find(m => m.kakao_id === state.user.kakaoId || m.email === state.user.email);
            if (!me) { showToast('승인된 멤버만 참여 신청할 수 있어요.'); return; }
            if (date < new Date().toLocaleDateString('en-CA')) { showToast('지난 일정은 참여 신청·취소할 수 없어요.'); return; }
            const grpAttendees = ((state.scheduleGroupAttendees || {})[date] || {})[groupName] || [];
            const isMeIn = grpAttendees.includes(me.id);
            if (!isMeIn) { const p = checkSignupPeriod(date); if (!p.ok) { showToast(p.msg, 4000); return; } }
            if (isMeIn) {
                const { error } = await supabaseClient.from('schedule_attendees').delete().eq('schedule_date', date).eq('profile_id', me.id).eq('group_name', groupName);
                if (error && error.code === '42703') { alert('group_name 컬럼이 없습니다.\nALTER TABLE schedule_attendees ADD COLUMN group_name text;\n을 Supabase에서 실행해주세요.'); return; }
                if (!error) { if (!state.scheduleGroupAttendees[date]) state.scheduleGroupAttendees[date] = {}; state.scheduleGroupAttendees[date][groupName] = grpAttendees.filter(id => id !== me.id); renderMemberPanel(); }
            } else {
                const { error } = await supabaseClient.from('schedule_attendees').insert({ schedule_date: date, profile_id: me.id, group_name: groupName });
                if (error && error.code === '42703') { alert('group_name 컬럼이 없습니다.\nALTER TABLE schedule_attendees ADD COLUMN group_name text;\n을 Supabase에서 실행해주세요.'); return; }
                if (error && error.code === '23505') { alert('같은 날짜에 여러 그룹을 신청하려면 Supabase SQL Editor에서 아래를 실행해주세요:\n\nALTER TABLE schedule_attendees DROP CONSTRAINT IF EXISTS schedule_attendees_schedule_date_profile_id_key;\nALTER TABLE schedule_attendees ADD CONSTRAINT schedule_attendees_unique UNIQUE(schedule_date, profile_id, group_name);'); return; }
                if (!error) { if (!state.scheduleGroupAttendees[date]) state.scheduleGroupAttendees[date] = {}; if (!state.scheduleGroupAttendees[date][groupName]) state.scheduleGroupAttendees[date][groupName] = []; state.scheduleGroupAttendees[date][groupName].push(me.id); renderMemberPanel(); }
            }
        };

        function slotAttKey(gn, startTime) { return 'slot|' + (gn || '') + '|' + (startTime || ''); }

        window.toggleSlotAttendance = async function(date, gn, startTime) {
            if (!state.user) { showToast('로그인이 필요합니다.'); return; }
            const me = (state.cachedMembers || []).find(m => m.kakao_id === state.user.kakaoId || m.email === state.user.email);
            if (!me) { showToast('승인된 멤버만 참여 신청할 수 있어요.'); return; }
            if (date < new Date().toLocaleDateString('en-CA')) { showToast('지난 일정은 참여 신청·취소할 수 없어요.'); return; }
            const key = slotAttKey(gn, startTime);
            const cur = ((state.scheduleSlotAttendees || {})[date] || {})[key] || [];
            const isMeIn = cur.includes(me.id);
            if (!isMeIn) { const p = checkSignupPeriod(date); if (!p.ok) { showToast(p.msg, 4000); return; } }
            if (isMeIn) {
                const { error } = await supabaseClient.from('schedule_attendees').delete().eq('schedule_date', date).eq('profile_id', me.id).eq('group_name', key);
                if (error && error.code === '42703') { alert('group_name 컬럼이 없습니다.\nALTER TABLE schedule_attendees ADD COLUMN group_name text;\n을 Supabase에서 실행해주세요.'); return; }
                if (error) { console.error('attend cancel:', error); showToast('취소하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                if (!state.scheduleSlotAttendees[date]) state.scheduleSlotAttendees[date] = {};
                state.scheduleSlotAttendees[date][key] = cur.filter(id => id !== me.id);
            } else {
                const { error } = await supabaseClient.from('schedule_attendees').insert({ schedule_date: date, profile_id: me.id, group_name: key });
                if (error && error.code === '42703') { alert('group_name 컬럼이 없습니다.\nALTER TABLE schedule_attendees ADD COLUMN group_name text;\n을 Supabase에서 실행해주세요.'); return; }
                if (error && error.code === '23505') { alert('같은 날짜에 여러 슬롯을 신청하려면 Supabase SQL Editor에서 아래를 실행해주세요:\n\nALTER TABLE schedule_attendees DROP CONSTRAINT IF EXISTS schedule_attendees_schedule_date_profile_id_key;\nALTER TABLE schedule_attendees ADD CONSTRAINT schedule_attendees_unique UNIQUE(schedule_date, profile_id, group_name);'); return; }
                if (error) { console.error('attend apply:', error); showToast('신청하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
                if (!state.scheduleSlotAttendees[date]) state.scheduleSlotAttendees[date] = {};
                if (!state.scheduleSlotAttendees[date][key]) state.scheduleSlotAttendees[date][key] = [];
                state.scheduleSlotAttendees[date][key].push(me.id);
            }
            renderMemberPanel();
        };

        function schedEditorInit(date) {
            state.scheduleEditorDate = date || new Date().toLocaleDateString('en-CA');
            const entries = (state.schedules || []).filter(s => s.date === state.scheduleEditorDate)
                .sort((a,b) => (a.start_time||'').localeCompare(b.start_time||''));
            const groupMap = {}, groupOrder = [];
            entries.forEach(s => {
                const gn = s.group_name || '';
                if (!groupMap[gn]) { groupMap[gn] = []; groupOrder.push(gn); }
                const isCustom = !s.team_id && s.team_name;
                groupMap[gn].push({
                    startTime: s.start_time || '',
                    endTime: s.end_time || '',
                    teamId: isCustom ? '__custom__' : (s.team_id || ''),
                    customName: isCustom ? s.team_name : '',
                    note: s.note || ''
                });
            });
            state.scheduleEditorGroups = groupOrder.length === 0
                ? [{ name: '', entries: [{ startTime: '', endTime: '', teamId: '', customName: '', note: '' }] }]
                : groupOrder.map(gn => ({ name: gn, entries: groupMap[gn] }));
            state.scheduleEditorShowBanner = entries.some(s => s.show_banner);
            state.scheduleEditorAllowGuests = entries.some(s => s.allow_guests === true); // 새 날짜는 끔(2026-11-02)
            const first = entries[0] || {};
            state.scheduleEditorSignupOpen  = isoToLocalInput(first.signup_open);
            state.scheduleEditorSignupClose = isoToLocalInput(first.signup_close);
            renderScheduleEditor();
        }

        function renderScheduleEditor() {
            const el = document.getElementById('schedEditor');
            if (!el) return;
            const memberMap = {};
            (state.cachedMembers || []).forEach(m => memberMap[m.id] = m);
            const today = new Date().toLocaleDateString('en-CA');
            const isToday = state.scheduleEditorDate === today;
            const fmtDate = (d) => {
                const p = d.split('-'), dn = {0:'일',1:'월',2:'화',3:'수',4:'목',5:'금',6:'토'};
                return `${parseInt(p[1])}월 ${parseInt(p[2])}일 (${dn[new Date(d).getDay()]})`;
            };
            const groupsHtml = state.scheduleEditorGroups.map((g, gi) => {
                const entriesHtml = g.entries.map((e, ei) => {
                    const isCustom = e.teamId === '__custom__';
                    const teamPreview = (e.teamId && !isCustom) ? (() => {
                        const t = state.teams.find(t => t.id === e.teamId);
                        if (!t) return '';
                        const mems = (t.members||[]).map(s => (memberMap[s.memberId]?.name||'').replace(/\s*\(.*?\)\s*$/,'')).filter(Boolean);
                        return mems.length ? `<span style="font-size:0.7rem;color:var(--wds-gray-500);flex-shrink:0">${mems.slice(0,3).join('·')}${mems.length>3?'…':''}</span>` : '';
                    })() : '';
                    const customInputRow = isCustom ? `<div style="display:flex;margin:4px 0 6px 0">
                        <input type="text" value="${escapeHtml(e.customName||'')}" placeholder="팀/일정 이름 직접 입력"
                            oninput="schedEditorUpdateEntry(${gi},${ei},'customName',this.value)"
                            style="flex:1;height:30px;padding:0 8px;border:1px solid var(--wds-primary);border-radius:5px;font-size:0.82rem;font-family:inherit;box-sizing:border-box">
                    </div>` : '';
                    return `<div style="margin-bottom:5px">
                        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                            <input type="text" value="${escapeHtml(e.startTime)}" placeholder="10:00" maxlength="5"
                                oninput="schedEditorUpdateEntry(${gi},${ei},'startTime',this.value)"
                                style="width:56px;height:32px;padding:0 4px;border:1px solid var(--wds-gray-300);border-radius:5px;font-size:0.85rem;font-family:inherit;text-align:center;box-sizing:border-box">
                            <span style="color:var(--wds-gray-400);font-size:0.85rem;flex-shrink:0">~</span>
                            <input type="text" value="${escapeHtml(e.endTime)}" placeholder="12:00" maxlength="5"
                                oninput="schedEditorUpdateEntry(${gi},${ei},'endTime',this.value)"
                                style="width:56px;height:32px;padding:0 4px;border:1px solid var(--wds-gray-300);border-radius:5px;font-size:0.85rem;font-family:inherit;text-align:center;box-sizing:border-box">
                            <select onchange="schedEditorUpdateEntry(${gi},${ei},'teamId',this.value)"
                                style="flex:1;min-width:90px;height:32px;padding:0 5px;border:1px solid ${isCustom?'var(--wds-primary)':'var(--wds-gray-300)'};border-radius:5px;font-size:0.82rem;font-family:inherit;background:white;box-sizing:border-box">
                                <option value="">팀 없음</option>
                                ${state.teams.map(t => `<option value="${t.id}" ${e.teamId===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}
                                <option value="__custom__" ${isCustom?'selected':''}>✏️ 직접 입력</option>
                            </select>
                            ${teamPreview}
                            <button class="gaa-btn gaa-btn-sm gaa-btn-ghost" style="width:24px;height:24px;flex-shrink:0" type="button" onclick="schedEditorRemoveEntry(${gi},${ei})"
                               >×</button>
                        </div>
                        ${customInputRow}
                    </div>`;
                }).join('');
                return `<div style="background:white;border:1px solid var(--wds-gray-200);border-radius:8px;padding:10px 12px;margin-bottom:8px">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                        <input type="text" value="${escapeHtml(g.name)}" placeholder="그룹 이름 (예: 1부, 밴드팀, 어쿠스틱)"
                            oninput="schedEditorUpdateGroup(${gi},'name',this.value)"
                            style="flex:1;height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:5px;font-size:0.85rem;font-weight:600;font-family:inherit;box-sizing:border-box">
                        ${state.scheduleEditorGroups.length > 1 ? `<button class="gaa-btn gaa-btn-xs gaa-btn-danger" style="white-space:nowrap;flex-shrink:0" type="button" onclick="schedEditorRemoveGroup(${gi})"
                           >삭제</button>` : ''}
                    </div>
                    ${entriesHtml}
                    <button class="gaa-btn gaa-btn-xs gaa-btn-block gaa-btn-secondary" style="margin-top:2px" type="button" onclick="schedEditorAddEntry(${gi})"
                       >+ 시간 추가</button>
                </div>`;
            }).join('');

            el.innerHTML = `
                <div style="background:var(--wds-gray-100);border-radius:10px;padding:12px 14px;margin-bottom:14px">
                    <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">날짜 선택</div>
                    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:10px">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="height:36px" type="button" onclick="schedEditorShiftDate(-1)">◀</button>
                        <input type="date" id="schedEditorDateInput" value="${state.scheduleEditorDate}"
                            onchange="schedEditorInit(this.value)"
                            style="height:36px;padding:0 8px;border:1.5px solid var(--wds-primary);border-radius:6px;font-size:0.85rem;font-family:inherit;color:var(--wds-primary);font-weight:700;box-sizing:border-box">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="height:36px" type="button" onclick="schedEditorShiftDate(1)">▶</button>
                    </div>
                    <label style="display:flex;align-items:center;gap:7px;margin-bottom:12px;cursor:pointer;user-select:none;font-size:0.83rem;font-weight:600;color:var(--wds-gray-700)">
                        <input type="checkbox" id="schedBannerToggle" ${state.scheduleEditorShowBanner?'checked':''}
                            onchange="state.scheduleEditorShowBanner=this.checked"
                            style="width:15px;height:15px;accent-color:var(--wds-primary);cursor:pointer">
                        공지 위 배너에 표시
                    </label>
                    <label style="display:flex;align-items:center;gap:7px;margin-bottom:12px;cursor:pointer;user-select:none;font-size:0.83rem;font-weight:600;color:var(--wds-gray-700)">
                        <input type="checkbox" id="schedGuestToggle" ${state.scheduleEditorAllowGuests?'checked':''}
                            onchange="state.scheduleEditorAllowGuests=this.checked"
                            style="width:15px;height:15px;accent-color:var(--wds-primary);cursor:pointer">
                        외부인 참여 신청 받기 <span style="font-weight:500;color:var(--wds-gray-500)">— 멤버가 슬롯마다 데려올 인원·이름을 적을 수 있어요</span>
                    </label>
                    <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">참여 신청 기간</div>
                    <div style="background:var(--wds-primary-light);border:1px solid color-mix(in srgb,var(--wds-primary) 25%,transparent);border-radius:8px;padding:10px 12px;margin-bottom:12px;display:flex;flex-direction:column;gap:8px">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                            <span style="font-size:0.78rem;font-weight:700;color:var(--wds-primary);min-width:36px">시작</span>
                            <input type="datetime-local" id="schedSignupOpen" value="${state.scheduleEditorSignupOpen||''}"
                                oninput="state.scheduleEditorSignupOpen=this.value"
                                style="flex:1;min-width:0;height:34px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:6px;font-size:0.82rem;font-family:inherit;box-sizing:border-box">
                            <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="flex-shrink:0" type="button" onclick="document.getElementById('schedSignupOpen').value='';state.scheduleEditorSignupOpen=''"
                               >✕</button>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                            <span style="font-size:0.78rem;font-weight:700;color:#e07000;min-width:36px">마감</span>
                            <input type="datetime-local" id="schedSignupClose" value="${state.scheduleEditorSignupClose||''}"
                                oninput="state.scheduleEditorSignupClose=this.value"
                                style="flex:1;min-width:0;height:34px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:6px;font-size:0.82rem;font-family:inherit;box-sizing:border-box">
                            <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="flex-shrink:0" type="button" onclick="document.getElementById('schedSignupClose').value='';state.scheduleEditorSignupClose=''"
                               >✕</button>
                        </div>
                        <div style="font-size:0.72rem;color:var(--wds-primary);opacity:0.8">비워두면 항상 신청 가능</div>
                    </div>
                    <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">그룹 & 시간표</div>
                    ${groupsHtml}
                    <button class="gaa-btn gaa-btn-sm gaa-btn-block gaa-btn-secondary" style="margin-bottom:8px" type="button" onclick="schedEditorAddGroup()"
                       >+ 그룹 추가</button>
                    <div style="display:flex;gap:6px">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" type="button" onclick="schedEditorClose()"
                           >닫기</button>
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex:2" type="button" onclick="saveScheduleForDate()"
                           >저장</button>
                    </div>
                </div>`;
        }

        function schedEditorClose() {
            const el = document.getElementById('schedEditor');
            if (el) el.innerHTML = '';
        }

        function schedEditorUpdateGroup(gi, key, val) { if (state.scheduleEditorGroups[gi]) state.scheduleEditorGroups[gi][key] = val; }
        function schedEditorUpdateEntry(gi, ei, key, val) {
            if (!state.scheduleEditorGroups[gi]?.entries[ei]) return;
            state.scheduleEditorGroups[gi].entries[ei][key] = val;
            if (key === 'teamId') renderScheduleEditor();
        }
        function schedEditorAddGroup() { state.scheduleEditorGroups.push({ name: '', entries: [{ startTime: '', endTime: '', teamId: '', customName: '', note: '' }] }); renderScheduleEditor(); }
        function schedEditorRemoveGroup(gi) {
            if (state.scheduleEditorGroups.length <= 1) { showToast('최소 1개 그룹이 필요합니다.'); return; }
            state.scheduleEditorGroups.splice(gi, 1); renderScheduleEditor();
        }
        function schedEditorAddEntry(gi) { if (state.scheduleEditorGroups[gi]) { state.scheduleEditorGroups[gi].entries.push({ startTime: '', endTime: '', teamId: '', customName: '', note: '' }); renderScheduleEditor(); } }
        function schedEditorRemoveEntry(gi, ei) {
            const g = state.scheduleEditorGroups[gi]; if (!g) return;
            if (g.entries.length <= 1) { g.entries[0] = { startTime: '', endTime: '', teamId: '', customName: '', note: '' }; renderScheduleEditor(); return; }
            g.entries.splice(ei, 1); renderScheduleEditor();
        }
        function schedEditorShiftDate(dir) {
            if (dir === 0) { schedEditorInit(new Date().toLocaleDateString('en-CA')); return; }
            const d = new Date(state.scheduleEditorDate + 'T00:00:00'); d.setDate(d.getDate() + dir);
            schedEditorInit(d.toLocaleDateString('en-CA'));
            const inp = document.getElementById('schedEditorDateInput'); if (inp) inp.value = state.scheduleEditorDate;
        }

        // datetime-local(로컬 시각) → 저장용 ISO(UTC). timestamptz 컬럼에 올바른 순간 저장
        function localInputToIso(v) {
            if (!v) return null;
            const d = new Date(v); // datetime-local은 브라우저 로컬 시간으로 파싱됨
            return isNaN(d.getTime()) ? null : d.toISOString();
        }
        // 저장된 ISO(timestamptz) → datetime-local 입력값(로컬 시각 "YYYY-MM-DDTHH:mm")
        function isoToLocalInput(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            const off = d.getTimezoneOffset() * 60000;
            return new Date(d.getTime() - off).toISOString().slice(0, 16);
        }

        async function saveScheduleForDate() {
            if (!canApproveRes()) { showToast('세션장 이상 권한이 필요합니다.'); return; }
            const date = state.scheduleEditorDate;
            if (!date) { showToast('날짜를 선택해주세요.'); return; }
            const showBanner = !!(document.getElementById('schedBannerToggle')?.checked ?? state.scheduleEditorShowBanner);
            state.scheduleEditorShowBanner = showBanner;
            const allowGuests = !!(document.getElementById('schedGuestToggle')?.checked ?? state.scheduleEditorAllowGuests);
            state.scheduleEditorAllowGuests = allowGuests;
            const signupOpen  = localInputToIso((document.getElementById('schedSignupOpen')?.value  || state.scheduleEditorSignupOpen  || '').trim());
            const signupClose = localInputToIso((document.getElementById('schedSignupClose')?.value || state.scheduleEditorSignupClose || '').trim());
            const memberMap = {};
            (state.cachedMembers || []).forEach(m => memberMap[m.id] = m);
            const records = [];
            for (const group of state.scheduleEditorGroups) {
                for (const entry of group.entries) {
                    if (!entry.startTime.trim()) continue;
                    const isCustom = entry.teamId === '__custom__';
                    const team = (!isCustom && entry.teamId) ? state.teams.find(t => t.id === entry.teamId) : null;
                    const teamName = isCustom ? (entry.customName || '').trim() : (team ? team.name : null);
                    records.push({
                        date, group_name: group.name || '',
                        start_time: entry.startTime.trim(), end_time: entry.endTime.trim() || null,
                        team_id: team ? team.id : null,
                        team_name: teamName || null,
                        members: team ? (team.members||[]).map(s => ({ session: s.session, memberId: s.memberId, leader: !!s.leader, memberName: memberMap[s.memberId]?.name || (s.memberName||'') })) : [],
                        songs: team ? (team.songs||[]) : [], note: entry.note || null,
                        show_banner: showBanner, allow_guests: allowGuests,
                        signup_open: signupOpen, signup_close: signupClose,
                        created_by: state.user ? (state.user.nickname || state.user.kakaoId) : null
                    });
                }
            }
            // ── 저장 순서: 새 행 insert → 성공하면 옛 행 삭제(id 로). 2026-11-02 일정 유실 사고의 교훈 —
            //    예전엔 날짜로 먼저 지우고 insert 했는데, insert 가 실패하면(모르는 컬럼 등) 그 날짜 일정이 통째로 사라졌다.
            //    insert 를 먼저 하면 실패해도 기존 행은 그대로 남는다. 잠깐 두 벌이 공존하지만 화면은 다시 그리기 전까지 안 읽는다.
            const oldRows = (state.schedules || []).filter(r => r.date === date && r.id);
            const { data: oldFetched } = await supabaseClient.from('schedules').select('id').eq('date', date);
            const oldIds = [...new Set([...(oldFetched || []).map(r => r.id), ...oldRows.map(r => r.id)])];
            const stripGuests = (rs) => rs.map(r => { const { allow_guests, ...rest } = r; return rest; });
            // allow_guests 컬럼이 아직 없으면(마이그레이션 전) 처음부터 빼고 보낸다 — PostgREST 는 모르는 컬럼을 PGRST204 로 거절한다
            const colMissing = (state.schedules || []).length > 0 && (state.schedules || []).every(r => r.allow_guests === undefined);
            if (records.length > 0) {
                let payload = colMissing ? stripGuests(records) : records;
                let { error: insErr } = await supabaseClient.from('schedules').insert(payload);
                if (insErr && payload === records && /allow_guests/.test(insErr.message || '')) {
                    payload = stripGuests(records);
                    ({ error: insErr } = await supabaseClient.from('schedules').insert(payload));
                }
                if (insErr) { showToast('저장 실패: ' + insErr.message + ' (기존 일정은 그대로 남아 있습니다)', 5000); return; }
                if (payload !== records && allowGuests) showToast('외부인 참여 설정은 Supabase 에서 20261102_schedules_allow_guests.sql 을 실행한 뒤 저장돼요.', 5000);
            }
            if (oldIds.length) {
                const { error: delErr } = await supabaseClient.from('schedules').delete().in('id', oldIds);
                if (delErr) { console.error('schedules old rows delete error:', delErr); showToast('새 일정은 저장됐지만 이전 일정을 지우지 못했습니다. 화면에 두 벌이 보이면 [편집]으로 다시 저장해주세요.'); }
            }
            showToast('일정이 저장되었습니다.');
            await fetchSchedules();
            const container = document.getElementById('memberPanelView');
            if (container && state.memberPanelTab === 'schedule') await renderScheduleView(container);
            gtFocus('#schedDay-' + date); // 저장한 날짜 카드로(2026-10-19) — 다시 그리면 편집기는 비워지므로 결과를 바로 보여준다
        }

        async function deleteScheduleDate(date) {
            if (!canApproveRes()) return;
            if (!confirm(`${date} 일정 전체를 삭제할까요?`)) return;
            const { error } = await supabaseClient.from('schedules').delete().eq('date', date);
            if (error) { showToast('삭제 실패: ' + error.message, 5000); return; }
            showToast('삭제되었습니다.');
            await fetchSchedules();
            const container = document.getElementById('memberPanelView');
            if (container && state.memberPanelTab === 'schedule') await renderScheduleView(container);
        }

        async function renderScheduleView(container, opts = {}) {
            if (!container) return false;
            if (!opts.quick) {
                // 첫 진입: 로그인 때 받아 둔 일정·멤버(+홈이 받아 둔 참석자)로 먼저 그린다 — 안 되면 자리표시(2026-10-16)
                if (!container.dataset.cached && (state.schedules || []).length && (state.cachedMembers || []).length) {
                    if (await renderScheduleView(container, { quick: true })) container.dataset.cached = '1';
                }
                _gtPlaceholder(container);
                await fetchSchedules();
                if (state.teams.length === 0) await fetchTeams();
                if (!state.cachedMembers || state.cachedMembers.length === 0) {
                    const members = await fetchMembers();
                    state.cachedMembers = (members || []).filter(m => m.status === 'approved');
                }
            }
            const memberMap = {};
            (state.cachedMembers || []).forEach(m => memberMap[m.id] = m);
            const today = new Date().toLocaleDateString('en-CA');
            const showPast = state.scheduleFilter === 'past';
            const canEdit = canApproveRes();
            const allScheds = state.schedules || [];
            let list = showPast ? allScheds.filter(s => s.date < today) : allScheds.filter(s => s.date >= today);
            const dateMap = {};
            list.forEach(s => { if (!dateMap[s.date]) dateMap[s.date] = []; dateMap[s.date].push(s); });
            const sortedDates = Object.keys(dateMap).sort(showPast ? (a,b)=>b.localeCompare(a) : undefined);
            const fmtDate = (d) => { const p=d.split('-'),dn={0:'일',1:'월',2:'화',3:'수',4:'목',5:'금',6:'토'}; return `${parseInt(p[1])}월 ${parseInt(p[2])}일 (${dn[new Date(d).getDay()]})`; };

            const myMember = state.user ? (state.cachedMembers || []).find(m => m.kakao_id === state.user.kakaoId || m.email === state.user.email) : null;
            const myId = myMember ? myMember.id : null;
            const myTeams = _myActiveTeams(myId); // 팀으로 신청 버튼 노출 여부(2026-11-03)
            if (opts.quick) { if (!sortedDates.every(d => state._attLoaded && state._attLoaded.has(d))) return false; } // 참석자 미수신 날짜가 있으면 빠른 그리기 포기
            else await fetchScheduleAttendees(sortedDates);

            const fmtDT = (iso) => {
                if (!iso) return '';
                const d = new Date(iso);
                return d.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(/ /g,'');
            };
            const timetableDay = (date, entries) => {
                const isToday = date === today;
                const isPastDate = date < today; // 지난 일정 — 신청/취소 버튼 미노출 (열람 전용)
                const first = entries[0] || {};
                const sigOpen  = first.signup_open  || null;
                const sigClose = first.signup_close || null;
                const now = new Date();
                let sigStatus = null; // 'before' | 'open' | 'closed' | null
                if (sigOpen || sigClose) {
                    if (sigOpen && now < new Date(sigOpen)) sigStatus = 'before';
                    else if (sigClose && now > new Date(sigClose)) sigStatus = 'closed';
                    else sigStatus = 'open';
                }
                // 신청 가능 상태에서 마감 임박도(D-day/카운트다운) 계산
                let openBadge = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:10px;background:#e6f9f0;color:#00b894">✅ 신청 가능${sigClose?' · 마감 '+fmtDT(sigClose):''}</span>`;
                if (sigStatus === 'open' && sigClose) {
                    const closeD = new Date(sigClose);
                    const ms = closeD - now;
                    const dDay = Math.ceil((new Date(closeD.getFullYear(),closeD.getMonth(),closeD.getDate()) - new Date(now.getFullYear(),now.getMonth(),now.getDate())) / 86400000);
                    if (ms > 0 && dDay <= 0) {
                        // 오늘 마감 — 남은 시간 카운트다운 + 펄스 강조
                        const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
                        const left = h >= 1 ? `${h}시간 ${m}분 남음` : `${m}분 남음`;
                        openBadge = `<span class="sig-urgent" style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:10px;background:#fdecea;color:#e74c3c;border:1px solid #f5b7b1">⏰ 오늘 마감 · ${left}</span>`;
                    } else if (ms > 0 && dDay <= 3) {
                        // 마감 임박 (D-1~D-3)
                        openBadge = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:10px;background:#fff3e0;color:#e07000;border:1px solid #ffd9a0">🔥 마감 D-${dDay} · ${fmtDT(sigClose)}</span>`;
                    }
                }
                const sigBadge = isPastDate ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:10px;background:var(--wds-gray-100);color:var(--wds-gray-500)">⏳ 지난 일정</span>` :
                    sigStatus === null ? '' :
                    sigStatus === 'open'   ? openBadge :
                    sigStatus === 'before' ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:10px;background:#fff8e6;color:#e07000">🕐 신청 시작 ${fmtDT(sigOpen)}</span>` :
                                            `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:10px;background:#fdf2f2;color:#e74c3c">🔒 신청 마감 ${fmtDT(sigClose)}</span>`;
                const guestsOn = _guestsAllowed(date); // 날짜별 외부인 신청 허용(2026-11-02) — 꺼진 날짜는 이미 적은 줄만 수정·삭제 가능
                const guestChip = guestsOn && !isPastDate && !state._guestsUnavailable ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:10px;background:var(--wds-gray-100);color:var(--wds-gray-700)">👥 외부인 참여 가능</span>` : '';
                const gMap = {}, gOrder = [];
                [...entries].sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||'')).forEach(s => {
                    const gn = s.group_name || '';
                    if (!gMap[gn]) { gMap[gn] = []; gOrder.push(gn); }
                    gMap[gn].push(s);
                });
                const groupsHtml = gOrder.map(gn => {
                    const grpAttendees = gn ? (((state.scheduleGroupAttendees || {})[date] || {})[gn] || []) : [];
                    const grpAttendeeNames = grpAttendees.map(pid => { const p = memberMap[pid]; return p ? p.name.replace(/\s*\(.*?\)\s*$/, '') : null; }).filter(Boolean);
                    const gnId = 'grp-att-' + date + '-' + (gn||'').replace(/[^a-zA-Z0-9가-힣]/g,'_');
                    const countBadge = grpAttendees.length > 0
                        ? `<button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="document.getElementById('${gnId}').classList.toggle('hidden');event.stopPropagation()"
                           >👥 ${grpAttendees.length}명</button>`
                        : '';
                    const attendeeList = grpAttendees.length
                        ? `<div id="${gnId}" class="hidden" style="margin-top:6px">${_attPanelHTML(grpAttendees.filter(pid => memberMap[pid]), { myId, teamId: null })}</div>`
                        : '';
                    const header = gn ? `<div style="margin:10px 0 7px">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 10px;background:rgba(51,102,255,0.07);border-radius:7px;border-left:3px solid var(--wds-primary)">
                            <span style="font-size:0.78rem;font-weight:800;color:var(--wds-primary);text-transform:uppercase;letter-spacing:0.06em">${escapeHtml(gn)}</span>
                            ${countBadge}
                        </div>
                        ${attendeeList}
                    </div>` : '';
                    const rows = gMap[gn].map(s => {
                        const timeStr = s.start_time + (s.end_time ? ` ~ ${s.end_time}` : '');
                        const members = (s.members||[]).map(m => {
                            const prof = memberMap[m.memberId];
                            const name = prof ? prof.name.replace(/\s*\(.*?\)\s*$/,'') : (m.memberName||'?');
                            return `<span style="background:var(--wds-gray-100);border-radius:5px;padding:1px 6px;font-size:0.72rem;letter-spacing:0.02em">${m.leader ? '👑 ' : ''}${escapeHtml(m.session?m.session+' ':'')}${escapeHtml(name)}</span>`;
                        }).join('');
                        const songs = (s.songs||[]).map(sg=>sg.title||sg).filter(Boolean);
                        // 슬롯별 참여 신청
                        const slotKey = slotAttKey(gn, s.start_time);
                        const slotAttendees = ((state.scheduleSlotAttendees || {})[date] || {})[slotKey] || [];
                        const isMeInSlot = !!(myId && slotAttendees.includes(myId));
                        const slotChipData = slotAttendees.map(pid => { const p = memberMap[pid]; return p ? { name: p.name.replace(/\s*\(.*?\)\s*$/, ''), me: pid === myId } : null; }).filter(Boolean);
                        // 본인을 맨 앞으로 정렬 (긴 명단에서 내 신청 여부 즉시 확인)
                        slotChipData.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
                        const slotGuests = _slotGuests(date, slotKey), slotGuestN = _guestTotal(slotGuests);
                        const myGuest = myId ? slotGuests.find(g => g.host_profile_id === myId) : null;
                        const attCount = slotChipData.length + slotGuestN; // 멤버 + 외부인 합산(2026-11-02)
                        const slotListId = 'slatt-' + date + '-' + (gn||'').replace(/[^a-zA-Z0-9가-힣]/g,'_') + '-' + (s.start_time||'').replace(/[^0-9]/g,'');
                        const slotChips = slotChipData.map(c => `<span style="background:${c.me?'var(--wds-primary)':'white'};color:${c.me?'#fff':'var(--wds-primary)'};border:1px solid var(--wds-primary);border-radius:4px;padding:1px 7px;font-size:0.7rem;font-weight:${c.me?'700':'600'};letter-spacing:0.02em">${escapeHtml(c.name)}${c.me?' (나)':''}</span>`).join('');
                        // 참여자수 버튼 — 시간과 같은 라인에 배치
                        const slotCountBtn = attCount ? `<button type="button" class="status-badge sm ${isMeInSlot?'status-info':'status-neutral'}" style="border:none;cursor:pointer;flex-shrink:0;font-family:inherit;min-height:28px;padding:4px 10px" onclick="document.getElementById('${slotListId}').classList.toggle('hidden');event.stopPropagation()">🙋 ${attCount}명${slotGuestN ? `<small style="font-weight:600;opacity:0.75"> · 외부 ${slotGuestN}</small>` : ''}</button>` : '';
                        // 참여자 명단 — 기본 항상 닫힘(외부인 칩은 맨 아래 묶음)
                        const slotChipDiv = attCount ? `<div id="${slotListId}" class="hidden" style="margin-top:6px">${_attPanelHTML(slotAttendees.filter(pid => memberMap[pid]), { myId, teamId: s.team_id || null, guests: slotGuests })}</div>` : '';
                        const slotBlocked = !isMeInSlot && sigStatus !== null && sigStatus !== 'open';
                        const gnArg = (gn||'').replace(/'/g,"\\'");
                        const slotBtn = (state.user && !isPastDate) ? `<button type="button" class="gaa-btn gaa-btn-xs ${isMeInSlot?'gaa-btn-danger':'gaa-btn-primary'}" style="white-space:nowrap;flex-shrink:0;min-height:26px;padding:3px 9px" onclick="toggleSlotAttendance('${date}','${gnArg}','${s.start_time||''}');event.stopPropagation()"
                            ${slotBlocked ? 'disabled' : ''}>${isMeInSlot?'✓ 취소':'+ 신청'}</button>` : '';
                        // 외부인 참여 신청(2026-11-02) — 내 줄이 있으면 「👥 외부 N」(수정), 없으면 「+ 외부」; 신청 기간 밖이면 새 신청만 막힘
                        const guestBlocked = !myGuest && sigStatus !== null && sigStatus !== 'open';
                        // 팀으로 신청(2026-11-03) — 내가 속한 진행 중 팀이 있을 때만 [팀] 버튼
                        const teamBtn = (state.user && myId && !isPastDate && myTeams.length) ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary gt-team-btn" style="white-space:nowrap;flex-shrink:0;min-height:26px;padding:3px 8px" title="팀으로 신청" onclick="gtTeamApplySheet('${date}','${gnArg}','${s.start_time||''}');event.stopPropagation()">👥 팀</button>` : '';
                        const guestBtn = (state.user && myId && !isPastDate && !state._guestsUnavailable && (guestsOn || myGuest)) ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary gt-guest-btn${myGuest ? ' mine' : ''}" style="white-space:nowrap;flex-shrink:0;min-height:26px;padding:3px 8px" title="외부인 참여 신청" onclick="gtGuestSheet('${date}','${gnArg}','${s.start_time||''}');event.stopPropagation()"
                            ${guestBlocked ? 'disabled' : ''}>${myGuest ? `👥 외부 ${myGuest.guest_count}` : '+ 외부'}</button>` : '';
                        return `<div style="background:var(--wds-gray-50);border-radius:8px;padding:9px 11px;margin-bottom:6px">
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                <span style="font-size:0.81rem;font-weight:800;color:var(--wds-primary);white-space:nowrap;background:rgba(51,102,255,0.1);padding:2px 8px;border-radius:6px;letter-spacing:0.03em">${escapeHtml(timeStr)}</span>
                                ${slotCountBtn}
                                <span style="flex:1"></span>
                                ${(teamBtn || guestBtn || slotBtn) ? `<div style="display:flex;gap:6px;margin-left:auto;flex-shrink:0">${teamBtn}${guestBtn}${slotBtn}</div>` : ''}
                            </div>
                            ${(s.team_name||members||songs.length) ? `<div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--wds-gray-200)">
                                ${s.team_name?`<div style="font-size:0.84rem;font-weight:700;color:var(--wds-gray-800);margin-bottom:4px">${escapeHtml(s.team_name)}</div>`:''}
                                ${members?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:${songs.length?'5px':'0'}">${members}</div>`:''}
                                ${songs.length?`<div style="font-size:0.72rem;color:var(--wds-gray-500);line-height:1.5">🎵 ${songs.slice(0,3).map(sg=>escapeHtml(sg)).join(' · ')}${songs.length>3?` 외 ${songs.length-3}곡`:''}</div>`:''}
                            </div>` : ''}
                            ${slotChipDiv}
                        </div>`;
                    }).join('');
                    return `<div>${header}${rows}</div>`;
                }).join('');
                // 전체 참여 멤버: 슬롯별 신청자 + 그룹별 + 날짜 단위 합산 (중복 제거)
                const allAttendeeIds = new Set(state.scheduleAttendees[date] || []);
                const slotMap = (state.scheduleSlotAttendees || {})[date] || {};
                Object.values(slotMap).forEach(arr => (arr || []).forEach(id => allAttendeeIds.add(id)));
                gOrder.forEach(gn => {
                    if (gn) (((state.scheduleGroupAttendees || {})[date] || {})[gn] || []).forEach(id => allAttendeeIds.add(id));
                });
                const allAttendeeNames = [...allAttendeeIds].map(pid => {
                    const p = memberMap[pid];
                    return p ? p.name.replace(/\s*\(.*?\)\s*$/, '') : null;
                }).filter(Boolean);
                const dateAttId = 'date-att-' + date;
                const dayGuests = _dateGuests(date), dayGuestN = _guestTotal(dayGuests);
                const totalN = allAttendeeIds.size + dayGuestN; // 멤버 + 외부인(2026-11-02)
                const attendeeSection = totalN > 0
                    ? `<div style="padding:0 12px 8px">
                        <button class="gaa-btn gaa-btn-xs gaa-btn-block gaa-btn-secondary" style="text-align:left;display:flex;justify-content:space-between;align-items:center" type="button" onclick="const el=document.getElementById('${dateAttId}');el.classList.toggle('hidden');this.querySelector('.att-arrow').textContent=el.classList.contains('hidden')?'▾':'▴'">
                            <span>👥 전체 참여 <strong style="color:var(--wds-primary)">${totalN}명</strong>${dayGuestN ? `<small style="color:var(--wds-gray-500);font-weight:600"> · 멤버 ${allAttendeeIds.size} · 외부 ${dayGuestN}</small>` : ''}</span><span class="att-arrow">▾</span>
                        </button>
                        <div id="${dateAttId}" class="hidden" style="padding:6px 8px 4px;background:var(--wds-primary-light);border-radius:0 0 6px 6px;margin-top:2px;display:flex;flex-wrap:wrap;gap:3px">
                            ${allAttendeeNames.map(n=>`<span style="background:white;border-radius:4px;padding:1px 7px;font-size:0.72rem;color:var(--wds-primary);font-weight:600">${escapeHtml(n)}</span>`).join('')}
                            ${_guestChipsHTML(dayGuests, myId)}
                        </div>
                      </div>`
                    : '';

                return `<div id="schedDay-${date}" data-date="${date}" style="margin-bottom:14px;background:var(--wds-white);border:1.5px solid ${isToday?'var(--wds-primary)':'var(--wds-gray-200)'};border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.07)">
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:${isToday?'var(--wds-primary)':'var(--wds-gray-50)'}">
                        <div style="display:flex;align-items:center;gap:7px">
                            ${isToday?'<span style="font-size:0.65rem;background:rgba(255,255,255,0.3);color:#fff;padding:2px 7px;border-radius:8px;font-weight:700">오늘</span>':''}
                            <span style="font-size:0.93rem;font-weight:800;color:${isToday?'#fff':'var(--wds-gray-800)'}">${fmtDate(date)}</span>
                            <span style="font-size:0.72rem;color:${isToday?'rgba(255,255,255,0.7)':'var(--wds-gray-400)'}">${gOrder.length}그룹 · ${entries.length}슬롯</span>
                        </div>
                        ${canEdit ? `<div style="display:flex;gap:4px">
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="${isToday?'background:rgba(255,255,255,0.15);border-color:rgba(255,255,255,0.5);color:#fff':''}" onclick="schedEditorInit('${date}');gtFocus('#schedEditor')">편집</button>
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-danger" style="${isToday?'background:rgba(255,100,100,0.15);border-color:rgba(255,100,100,0.5);color:#ffb3b3':''}" onclick="deleteScheduleDate('${date}')">삭제</button>
                        </div>` : ''}
                    </div>
                    ${(sigBadge || guestChip) ? `<div style="padding:7px 14px;border-bottom:1px solid var(--wds-gray-100);display:flex;gap:6px;flex-wrap:wrap">${sigBadge}${guestChip}</div>` : ''}
                    <div style="padding:10px 12px">${groupsHtml}</div>
                    ${attendeeSection}
                </div>`;
            };

            if (state.memberPanelTab !== 'schedule' || !container.isConnected) return false; // 기다리는 동안 다른 하위 화면으로 옮김
            container.innerHTML = `
                <div>
                    ${canEdit ? '<div id="schedEditor"></div>' : ''}
                    ${canEdit ? `<button class="gaa-btn gaa-btn-sm gaa-btn-block gaa-btn-secondary" style="margin-bottom:10px" type="button" onclick="schedEditorInit(new Date().toLocaleDateString('en-CA'));gtFocus('#schedEditor')">+ 새 일정 추가</button>` : ''}
                    <div style="display:flex;gap:6px;margin-bottom:12px">
                        <button type="button" class="gaa-btn gaa-btn-xs ${!showPast?'gaa-btn-primary':'gaa-btn-secondary'}" style="flex:1" onclick="state.scheduleFilter='upcoming';renderMemberPanel()">다가오는 일정</button>
                        <button type="button" class="gaa-btn gaa-btn-xs ${showPast?'gaa-btn-primary':'gaa-btn-secondary'}" style="flex:1" onclick="state.scheduleFilter='past';renderMemberPanel()">지난 일정</button>
                    </div>
                    ${sortedDates.length === 0
                        ? `<p style="text-align:center;color:var(--wds-gray-500);font-size:0.9rem;padding:30px 0">${showPast?'지난 일정이 없습니다.':'등록된 일정이 없습니다.'}</p>`
                        : sortedDates.map(d => timetableDay(d, dateMap[d])).join('')}
                </div>`;
            return true;
        }

        async function renderTeamsTab(container) {
            const paint = () => {
                if (container.querySelector('#teamFormContainer:not(.hidden)')) return; // 팀 폼을 열어 둔 상태면 덮어쓰지 않는다
                const memberMap = {};
                (state.cachedMembers || []).forEach(m => memberMap[m.id] = m);
                container.innerHTML = `
                    <button class="team-create-btn" onclick="showTeamForm()">+ 새 팀 만들기</button>
                    <div id="teamFormContainer" class="hidden"></div>
                    <div id="teamList" style="margin-top:16px"></div>
                `;
                renderTeamList(memberMap);
            };
            if (!container.dataset.cached) { if ((state.teams || []).length || (state.cachedMembers || []).length) paint(); else _gtPlaceholder(container); }
            await fetchTeams();
            const members = await fetchMembers();
            if (state.memberPanelTab !== 'teams') return;
            const approvedMembers = (members || []).filter(m => m.status === 'approved');
            if (approvedMembers.length) state.cachedMembers = approvedMembers;
            paint();
        }

        function renderTeamList(memberMap) {
            const list = document.getElementById('teamList');
            if (!list) return;
            if (!state.teams || state.teams.length === 0) {
                list.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.9rem;text-align:center;padding:30px">아직 등록된 팀이 없습니다.</p>';
                return;
            }
            const renderCard = (t, isPast) => {
                const slots = t.members || [];
                let period = '';
                if (t.start_date && t.end_date) period = `${t.start_date} ~ ${t.end_date}`;
                else if (t.start_date) period = `${t.start_date} 부터`;
                else if (t.end_date) period = `${t.end_date} 까지`;
                const songs = t.songs && t.songs.length > 0 ? t.songs
                    : (t.song_title ? [{ title: t.song_title, artist: t.song_artist || '', artwork: '' }] : []);
                const songsHtml = songs.map(s => `
                    <div class="team-song-item">
                        ${s.artwork ? `<img src="${escapeHtml(s.artwork)}" alt="">` : ''}
                        <span class="team-song-text">${escapeHtml(s.title)}${s.artist ? ' — ' + escapeHtml(s.artist) : ''}</span>
                    </div>`).join('');
                const ordered = [...slots].sort((a, b) => (b.leader ? 1 : 0) - (a.leader ? 1 : 0)); // 팀장 먼저
                const slotsHtml = ordered.map(s => {
                    const m = memberMap[s.memberId];
                    const name = m ? m.name.replace(/\s*\(.*?\)\s*$/, '') : '?';
                    return `<span class="team-slot${s.leader ? ' leader' : ''}" title="${s.leader ? '팀장' : ''}">${s.leader ? '👑 ' : ''}<strong>${escapeHtml(s.session || '')}</strong>${escapeHtml(name)}</span>`;
                }).join('');
                const avatars = ordered.slice(0, 5).map(s => _gtAvatarOf(memberMap[s.memberId])).join('');
                return `<div class="team-card" id="team-${t.id}"${isPast ? ' style="opacity:0.78"' : ''}>
                    <div class="team-card-actions"><button type="button" class="team-more" onclick="gtTeamMenu('${t.id}')" aria-label="팀 관리">⋯</button></div>
                    <div class="team-name">${escapeHtml(t.name)}${isPast ? ' <span style="display:inline-block;vertical-align:middle;background:var(--wds-gray-100);border:1px solid var(--wds-gray-300);color:var(--wds-gray-500);font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px">종료</span>' : ''}</div>
                    ${period ? `<div class="team-row"><span class="team-label">기간</span><span class="team-period">${period}</span></div>` : ''}
                    ${songs.length > 0 ? `<div class="team-row"><span class="team-label">곡</span><div class="team-songs">${songsHtml}</div></div>` : ''}
                    <div class="team-row"><span class="team-label">멤버</span><div class="team-slots">${slots.length ? `<div class="gt-stack">${avatars}</div>` : ''}${slotsHtml}</div></div>
                </div>`;
            };
            // 종료일이 지난 팀은 '지난 팀'으로 분리 (종료일 없는 팀 = 진행 중)
            const activeTeams = state.teams.filter(t => !isPastTeam(t));
            const pastTeams = state.teams.filter(isPastTeam);
            let html = activeTeams.length
                ? activeTeams.map(t => renderCard(t, false)).join('')
                : '<p style="color:var(--wds-gray-500);font-size:0.9rem;text-align:center;padding:22px">진행 중인 팀이 없습니다.</p>';
            if (pastTeams.length > 0) {
                html += `
                    <div class="reply-toggle" style="margin:16px 0 0;text-align:center" onclick="togglePastTeams()"><span id="pastTeamsToggleText">▾ 지난 팀 ${pastTeams.length}개 보기</span></div>
                    <div id="pastTeamsList" class="hidden" style="margin-top:10px">${pastTeams.map(t => renderCard(t, true)).join('')}</div>`;
            }
            list.innerHTML = html;
        }

        function togglePastTeams() {
            const el = document.getElementById('pastTeamsList');
            const txt = document.getElementById('pastTeamsToggleText');
            if (!el || !txt) return;
            const willHide = !el.classList.contains('hidden');
            el.classList.toggle('hidden');
            const count = el.querySelectorAll('.team-card').length;
            txt.textContent = willHide ? `▾ 지난 팀 ${count}개 보기` : `▴ 지난 팀 ${count}개 접기`;
        }

        function editTeam(id) {
            const team = state.teams.find(t => t.id === id);
            if (!team) return;
            showTeamForm(team);
        }

        function showTeamForm(team) {
            const c = document.getElementById('teamFormContainer');
            const sessions = ['보컬', '기타', '베이스', '키보드', '드럼'];
            if (team) {
                state.editingTeam = team;
                state.editingSlots = (team.members && team.members.length > 0)
                    ? team.members.map(s => ({ session: s.session || '', memberId: s.memberId || '', leader: !!s.leader }))
                    : sessions.map(s => ({ session: s, memberId: '' }));
                state.editingSongs = team.songs ? [...team.songs]
                    : (team.song_title ? [{ title: team.song_title, artist: team.song_artist || '', artwork: '' }] : []);
            } else {
                state.editingTeam = null;
                state.editingSlots = sessions.map(s => ({ session: s, memberId: '' }));
                state.editingSongs = [];
            }
            const isEdit = !!team;
            c.classList.remove('hidden');
            c.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--wds-primary)">
                    <h4 style="margin:0;font-size:1.02rem;color:var(--wds-primary)">${isEdit ? '팀 수정' : '새 팀 만들기'}</h4>
                    <button type="button" onclick="hideTeamForm()" style="background:none;border:none;cursor:pointer;color:var(--wds-gray-400);font-size:1.2rem;padding:0;line-height:1">×</button>
                </div>

                <div style="margin-bottom:14px">
                    <label style="display:block;font-size:0.8rem;font-weight:700;color:var(--wds-gray-600);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.05em">팀 이름</label>
                    <input type="text" id="teamName" placeholder="팀 이름을 입력하세요" value="${isEdit ? escapeHtml(team.name) : ''}" style="width:100%;height:42px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.92rem;font-family:inherit;box-sizing:border-box;outline:none">
                </div>

                <div style="margin-bottom:14px">
                    <label style="display:block;font-size:0.8rem;font-weight:700;color:var(--wds-gray-600);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.05em">활동 기간</label>
                    <div style="display:flex;align-items:center;gap:8px">
                        <input type="date" id="teamStartDate" value="${isEdit && team.start_date ? team.start_date : ''}" style="flex:1;height:40px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.88rem;font-family:inherit;box-sizing:border-box">
                        <span style="color:var(--wds-gray-500);font-weight:600;flex-shrink:0">~</span>
                        <input type="date" id="teamEndDate" value="${isEdit && team.end_date ? team.end_date : ''}" style="flex:1;height:40px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.88rem;font-family:inherit;box-sizing:border-box">
                    </div>
                </div>

                <div style="margin-bottom:14px">
                    <label style="display:block;font-size:0.8rem;font-weight:700;color:var(--wds-gray-600);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">합주 곡</label>
                    <div style="background:var(--wds-gray-100);border-radius:var(--wds-radius-s);padding:10px 12px">
                        <div class="song-list" id="editingSongList" style="margin-bottom:8px"></div>
                        <div style="display:flex;gap:6px;margin-bottom:8px">
                            <input type="text" id="teamMusicSearch" placeholder="곡 또는 아티스트 검색" onkeydown="if(event.key==='Enter'){event.preventDefault();searchMusic();}" style="flex:1;height:38px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.87rem;font-family:inherit;box-sizing:border-box">
                            <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="height:38px;flex-shrink:0" type="button" onclick="searchMusic()">🔍</button>
                        </div>
                        <div id="musicResults"></div>
                        <div style="padding-top:8px;border-top:1px dashed var(--wds-gray-300)">
                            <div style="font-size:0.75rem;color:var(--wds-gray-500);margin-bottom:6px;font-weight:600">직접 입력</div>
                            <div style="display:flex;gap:6px">
                                <input type="text" id="manualSongTitle" placeholder="곡 제목" onkeydown="if(event.key==='Enter'){event.preventDefault();addManualSong();}" style="flex:2;min-width:0;height:36px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.85rem;font-family:inherit;box-sizing:border-box">
                                <input type="text" id="manualSongArtist" placeholder="아티스트 (선택)" onkeydown="if(event.key==='Enter'){event.preventDefault();addManualSong();}" style="flex:1;min-width:0;height:36px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.85rem;font-family:inherit;box-sizing:border-box">
                                <button class="gaa-btn gaa-btn-xs gaa-btn-primary" style="height:36px;flex-shrink:0;white-space:nowrap" type="button" onclick="addManualSong()">+ 추가</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom:14px">
                    <label style="display:block;font-size:0.8rem;font-weight:700;color:var(--wds-gray-600);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">팀 구성 멤버</label>
                    <div id="teamSlots"></div>
                    <button type="button" class="add-slot-btn" onclick="addTeamSlot()" style="margin-top:6px">+ 세션 추가</button>
                </div>

                <div class="team-form-actions" style="padding-top:12px;border-top:1px solid var(--wds-gray-200)">
                    <button type="button" class="team-cancel-btn" onclick="hideTeamForm()">취소</button>
                    <button type="button" class="team-save-btn" onclick="saveTeam()">${isEdit ? '수정 저장' : '저장'}</button>
                </div>
            `;
            renderTeamSlots();
            renderSongList();
            gtFocus('#teamFormContainer', { focus: '#teamName' }); // 폼은 목록 위에 있어 아래쪽 팀을 수정할 때 안 보이던 문제(2026-10-19)
        }

        function hideTeamForm() {
            const c = document.getElementById('teamFormContainer');
            if (c) { c.classList.add('hidden'); c.innerHTML = ''; }
            state.editingTeam = null;
            state.editingSlots = [];
            state.editingSongs = [];
        }

        function escapeHtml(str) {
            return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        // 인라인 이벤트 핸들러(onclick 등) 안 작은따옴표 JS 문자열에 값을 넣을 때 사용.
        // \, ' 를 이스케이프하고 " 는 &quot; 로 바꿔 큰따옴표 속성 밖으로 새지 않게 한다.
        function jsStr(s) {
            return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        }

        function parseMusicTaste(raw) {
            if (!raw) return null;
            if (typeof raw === 'object') return raw; // jsonb 로 저장됐거나 이미 파싱된 값(2026-11-09 QA: 문자열만 가정해 멤버 목록·마이가 통째로 멈추던 것)
            try { return JSON.parse(raw); } catch { return { genre: '', artists: String(raw), songs: '' }; }
        }

        const BUGS_GENRES = [
            { group: '국내', items: ['발라드', '댄스', '랩/힙합', 'R&B/소울', '인디음악', '포크/블루스', '록/메탈', '트로트', '성인가요', 'CCM'] },
            { group: '해외', items: ['팝', '일렉트로닉', '록', '메탈', '재즈', '클래식'] },
            { group: '기타', items: ['OST', '뉴에이지', 'J-POP', '국악', '어린이/태교', '애니메이션'] }
        ];

        function _getMtState(cid) {
            if (!state.mtEdits[cid]) state.mtEdits[cid] = { genres: [], artists: [], songs: [] };
            return state.mtEdits[cid];
        }

        function initMtEdit(cid, raw) {
            const mt = parseMusicTaste(raw);
            if (!mt) { state.mtEdits[cid] = { genres: [], artists: [], songs: [] }; return; }
            const songs = Array.isArray(mt.songs) ? mt.songs
                : (mt.songs ? [{ title: mt.songs, artist: '', artwork: '' }] : []);
            // 기존 genre(string) → genres(array) 마이그레이션
            const rawGenres = Array.isArray(mt.genres) ? mt.genres
                : (mt.genre ? mt.genre.split(',').map(s => s.trim()).filter(Boolean) : []);
            // BUGS_GENRES 목록에 없는 값은 버림 (오염된 프로필 데이터 방어)
            const validSet = new Set(BUGS_GENRES.flatMap(g => g.items));
            const genres = rawGenres.filter(g => validSet.has(g));
            state.mtEdits[cid] = {
                genres,
                artists: mt.artists ? mt.artists.split(',').map(s => s.trim()).filter(Boolean) : [],
                songs
            };
        }

        function getMtEditValue(cid) {
            const { genres, artists, songs } = _getMtState(cid);
            if (!genres.length && !artists.length && !songs.length) return null;
            return JSON.stringify({ genre: genres.join(', '), genres, artists: artists.join(', '), songs });
        }

        function renderMtEditUI(containerId, raw) {
            initMtEdit(containerId, raw !== undefined ? raw : null);
            _refreshMtEdit(containerId);
            _bindMtGenreDelegation(containerId);
        }

        // 인라인 onclick 대신 컨테이너에 위임 리스너를 바인딩 (모바일 click 미발화 대비)
        // pointerdown/up으로 터치를 직접 처리 — click 합성에 의존하지 않음
        function _bindMtGenreDelegation(cid) {
            const c = document.getElementById(cid);
            if (!c) return;
            // 항상 새로 바인딩 (innerHTML 교체 후 재호출 대비)
            if (c._mtBound) { c.removeEventListener('pointerdown', c._mtBound[0]); c.removeEventListener('pointerup', c._mtBound[1]); }
            let downX = 0, downY = 0, downBtn = null;
            const onDown = (e) => {
                const btn = e.target.closest('.mt-genre-chip');
                downBtn = (btn && c.contains(btn)) ? btn : null;
                downX = e.clientX; downY = e.clientY;
            };
            const onUp = (e) => {
                const btn = e.target.closest('.mt-genre-chip');
                if (!btn || btn !== downBtn || !c.contains(btn)) { downBtn = null; return; }
                // 스크롤/드래그면 무시 (탭만 처리)
                if (Math.abs(e.clientX - downX) > 10 || Math.abs(e.clientY - downY) > 10) { downBtn = null; return; }
                downBtn = null;
                if (btn.classList.contains('disabled') || btn.disabled) return;
                e.preventDefault();
                selectMtGenre(btn, cid);
            };
            c.addEventListener('pointerdown', onDown);
            c.addEventListener('pointerup', onUp);
            c._mtBound = [onDown, onUp];
        }

        function _refreshMtEdit(cid) {
            const c = document.getElementById(cid);
            if (!c) return;
            const { genres, artists, songs } = _getMtState(cid);
            const MAX = 3;

            const genreMaxed = genres.length >= MAX;
            const genreChips = BUGS_GENRES.map(g => `
                <div style="margin-bottom:8px">
                    <div style="font-size:0.7rem;color:var(--wds-gray-500);font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">${g.group}</div>
                    <div style="display:flex;flex-wrap:wrap;gap:5px">
                        ${g.items.map(item => {
                            const sel = genres.includes(item);
                            const disabled = !sel && genreMaxed;
                            return `<button type="button" data-genre="${escapeHtml(item)}" class="mt-genre-chip${sel ? ' selected' : ''}${disabled ? ' disabled' : ''}"${disabled ? ' disabled' : ''}>${escapeHtml(item)}</button>`;
                        }).join('')}
                    </div>
                </div>`).join('');

            const artistChips = artists.map((a, i) => `<span class="mt-sel-chip">${escapeHtml(a)} <button type="button" onclick="removeMtItem('artist',${i},'${cid}')">×</button></span>`).join('');
            const songChips = songs.map((s, i) => `<span class="mt-sel-chip">🎵 ${escapeHtml(s.title)}${s.artist ? ' — ' + escapeHtml(s.artist) : ''} <button type="button" onclick="removeMtItem('song',${i},'${cid}')">×</button></span>`).join('');

            const SONG_MAX = 1;
            const artistMaxed = artists.length >= MAX;
            const songMaxed = songs.length >= SONG_MAX;

            c.innerHTML = `
                <div style="background:var(--wds-gray-100);border-radius:8px;padding:10px 12px;margin-bottom:8px">
                    <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-600);margin-bottom:8px">🎵 장르 선택 <span id="${cid}_gcount" style="font-weight:400;color:var(--wds-gray-400)">(최대 ${MAX}개${genreMaxed ? ' · 최대 선택됨' : ''})</span></div>
                    ${genreChips}
                </div>
                <div style="margin-bottom:8px">
                    <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-600);margin-bottom:5px">🎤 좋아하는 가수 <span style="font-weight:400;color:var(--wds-gray-400)">(최대 ${MAX}명)</span></div>
                    ${artistChips ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${artistChips}</div>` : ''}
                    ${artistMaxed
                        ? `<p style="font-size:0.78rem;color:var(--wds-gray-400);margin:0">최대 ${MAX}명까지 선택할 수 있습니다.</p>`
                        : `<div style="display:flex;gap:6px">
                            <input type="text" id="${cid}_as" placeholder="가수 이름 검색..."
                                onkeydown="if(event.key==='Enter'){event.preventDefault();searchMtArtist('${cid}');}"
                                style="flex:1;height:36px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:6px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;outline:none;background:var(--wds-white);color:var(--wds-black)">
                            <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="height:36px;flex-shrink:0" type="button" onclick="searchMtArtist('${cid}')">🔍</button>
                          </div>
                          <div id="${cid}_ar"></div>`}
                </div>
                <div>
                    <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-600);margin-bottom:5px">🎶 좋아하는 곡 <span style="font-weight:400;color:var(--wds-gray-400)">(1곡)</span></div>
                    ${songChips ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${songChips}</div>` : ''}
                    ${songMaxed
                        ? `<p style="font-size:0.78rem;color:var(--wds-gray-400);margin:0">곡은 1곡만 선택할 수 있습니다.</p>`
                        : `<div style="display:flex;gap:6px">
                            <input type="text" id="${cid}_ss" placeholder="곡 또는 아티스트 검색..."
                                onkeydown="if(event.key==='Enter'){event.preventDefault();searchMtSong('${cid}');}"
                                style="flex:1;height:36px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:6px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;outline:none;background:var(--wds-white);color:var(--wds-black)">
                            <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="height:36px;flex-shrink:0" type="button" onclick="searchMtSong('${cid}')">🔍</button>
                          </div>
                          <div id="${cid}_sr"></div>`}
                </div>`;
        }

        function selectMtGenre(el, cid) {
            const MAX = 3;
            const genre = el.dataset.genre;
            const mt = _getMtState(cid);
            const idx = mt.genres.indexOf(genre);
            if (idx >= 0) mt.genres.splice(idx, 1);
            else if (mt.genres.length < MAX) mt.genres.push(genre);
            else return; // 최대치, 변화 없음
            // DOM을 새로 그리지 않고 현재 버튼들의 상태만 갱신 (모바일 ghost-click 방지)
            const c = document.getElementById(cid);
            if (!c) return;
            const maxed = mt.genres.length >= MAX;
            c.querySelectorAll('.mt-genre-chip').forEach(btn => {
                const sel = mt.genres.includes(btn.dataset.genre);
                btn.classList.toggle('selected', sel);
                const disabled = !sel && maxed;
                btn.classList.toggle('disabled', disabled);
                btn.disabled = disabled;
            });
            const cnt = document.getElementById(cid + '_gcount');
            if (cnt) cnt.textContent = `(최대 ${MAX}개${maxed ? ' · 최대 선택됨' : ''})`;
        }

        // 가수·곡 검색 — 두 축을 브라우저에서 합친다.
        //  1) 애플 iTunes KR 뮤직비디오(한글 표기·표지): 브라우저가 직접 호출(CORS *). 서버(Cloudflare Workers)에서 부르면
        //     공유 IP 라 애플이 429 로 막아(2026-09-28 실측) 클라이언트에 둔다. 뮤직비디오가 있는 곡만 나온다.
        //  2) Deezer(커버리지·앨범아트, 무료·키 없음): CORS 가 없어 서버 함수 /music-search 경유.
        //     (스포티파이는 2025년 이후 앱 소유 계정 프리미엄 구독 필수 정책이라 제외)
        // 배경: 2026-09-28 iTunes KR 곡(entity=song) 검색이 전부 0건으로 바뀌어 기존 직접 호출이 멈춤.
        // 합치기: 애플 먼저(Deezer 가 있으면 60%까지), 제목+가수 정규화 키로 중복 제거, 한쪽 실패는 다른 쪽으로.
        const _musicKey = (v) => String(v || '').toLowerCase().normalize('NFKC').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
        async function _appleMusicSearch(q, type, limit) {
            const u = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=KR&entity=musicVideo&lang=ko_kr&limit=${type === 'artist' ? 25 : Math.min(limit * 2, 25)}`;
            const r = await fetch(u);
            if (!r.ok) throw new Error('apple ' + r.status);
            const d = await r.json().catch(() => ({}));
            const rows = Array.isArray(d.results) ? d.results : [];
            if (type === 'artist') {
                // 뮤직비디오 artistName 은 "Agust D & 아이유"처럼 합작 표기가 섞이므로 쪼개고, 검색어를 포함한 이름을 앞으로
                const names = [];
                for (const x of rows) for (const part of String(x.artistName || '').split(/\s*[&,]\s*|\s+feat\.?\s+/i)) if (part.trim()) names.push(part.trim());
                const ql = q.toLowerCase();
                names.sort((a, b) => Number(b.toLowerCase().includes(ql)) - Number(a.toLowerCase().includes(ql)));
                return names.map(name => ({ name, image: '', source: 'apple' }));
            }
            return rows.filter(x => x.trackName).map(x => ({ title: String(x.trackName), artist: String(x.artistName || ''), artwork: x.artworkUrl100 || x.artworkUrl60 || '', source: 'apple' }));
        }
        async function _deezerMusicSearch(q, type, limit) {
            const r = await fetch(`/music-search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`);
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
            return Array.isArray(d.results) ? d.results : [];
        }
        function _mergeMusicResults(apple, other, type, limit) {
            const keyOf = type === 'artist' ? (x => _musicKey(x.name)) : (x => _musicKey(x.title) + '|' + _musicKey(x.artist));
            const seen = new Set();
            const uniq = (list) => (list || []).filter(x => { const k = keyOf(x); if (!k || seen.has(k)) return false; seen.add(k); return true; });
            const a = uniq(apple), s = uniq(other);
            const appleCap = s.length ? Math.max(1, Math.ceil(limit * 0.6)) : limit;
            const out = a.slice(0, appleCap).concat(s);
            if (out.length < limit) out.push(...a.slice(appleCap));
            return out.slice(0, limit);
        }
        async function musicSearch(q, type, limit = 8) {
            const [a, s] = await Promise.allSettled([_appleMusicSearch(q, type, limit), _deezerMusicSearch(q, type, limit)]);
            if (a.status === 'rejected') console.warn('apple search', a.reason);
            if (s.status === 'rejected') console.warn('deezer search', s.reason);
            if (a.status === 'rejected' && s.status === 'rejected') throw new Error('music search failed');
            return _mergeMusicResults(a.status === 'fulfilled' ? a.value : [], s.status === 'fulfilled' ? s.value : [], type, limit);
        }
        const _musicMsg = (msg, err) => `<p style="font-size:0.8rem;color:${err ? '#e74c3c' : 'var(--wds-gray-500)'};padding:4px">${msg}</p>`;
        // 곡 결과 한 줄. manual=true 면 검색에 없는 곡을 입력한 제목 그대로 등록하는 줄(가수 비움)
        function _musicRow(r, onclick, manual) {
            const t = escapeHtml(r.title || ''), a = escapeHtml(r.artist || ''), aw = escapeHtml(r.artwork || '');
            return `<div class="music-result${manual ? ' music-result-manual' : ''}" data-title="${t}" data-artist="${a}" data-artwork="${aw}" onclick="${onclick}">
                ${aw ? `<img src="${aw}" alt="" loading="lazy">` : ''}
                <div class="music-result-info">
                    <div class="music-result-title">${manual ? '＋ "' + t + '" 제목으로 직접 등록' : t}</div>
                    <div class="music-result-artist">${manual ? '검색에 없는 곡을 입력한 그대로 추가합니다' : a}</div>
                </div>
            </div>`;
        }

        async function searchMtArtist(cid) {
            const inp = document.getElementById(cid + '_as');
            const res = document.getElementById(cid + '_ar');
            if (!inp || !res) return;
            const q = inp.value.trim(); if (!q) return;
            res.innerHTML = _musicMsg('검색 중...');
            let names = [], failed = false;
            try { names = (await musicSearch(q, 'artist', 8)).map(a => a && a.name).filter(Boolean); }
            catch (e) { failed = true; console.error('artist search', e); }
            const chip = (name, manual) => `<button type="button" class="mt-result-chip${manual ? ' mt-result-manual' : ''}" data-name="${escapeHtml(name)}" onclick="addMtArtist(this,'${cid}')">${manual ? '＋ "' + escapeHtml(name) + '" 그대로 추가' : escapeHtml(name)}</button>`;
            const chips = names.map(n => chip(n, false));
            // 검색에 없는 가수는 입력한 이름 그대로 등록 — 결과에 같은 이름이 있으면 생략
            if (!names.some(n => n.toLowerCase() === q.toLowerCase())) chips.push(chip(q, true));
            const note = failed ? _musicMsg('검색에 실패했습니다. 입력한 이름 그대로 추가할 수 있습니다.', true)
                : (names.length ? '' : _musicMsg('검색 결과가 없습니다. 입력한 이름 그대로 추가할 수 있습니다.'));
            res.innerHTML = `${note}<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${chips.join('')}</div>`;
        }

        function addMtArtist(el, cid) {
            const name = el.dataset.name;
            const mt = _getMtState(cid);
            if (name && mt.artists.length < 3 && !mt.artists.includes(name)) {
                mt.artists.push(name); _refreshMtEdit(cid);
            }
        }

        async function searchMtSong(cid) {
            const inp = document.getElementById(cid + '_ss');
            const res = document.getElementById(cid + '_sr');
            if (!inp || !res) return;
            const q = inp.value.trim(); if (!q) return;
            res.innerHTML = _musicMsg('검색 중...');
            let rows = [], failed = false;
            try { rows = await musicSearch(q, 'song', 8); }
            catch (e) { failed = true; console.error('song search', e); }
            const onclick = `addMtSong(this,'${cid}')`;
            const note = failed ? _musicMsg('검색에 실패했습니다. 제목을 그대로 등록할 수 있습니다.', true)
                : (rows.length ? '' : _musicMsg('검색 결과가 없습니다. 제목을 그대로 등록할 수 있습니다.'));
            res.innerHTML = note + rows.map(r => _musicRow(r, onclick, false)).join('') + _musicRow({ title: q }, onclick, true);
        }

        function addMtSong(el, cid) {
            const { title: t, artist: a, artwork: aw } = el.dataset;
            const mt = _getMtState(cid);
            if (t && mt.songs.length < 1 && !mt.songs.find(s => s.title === t && s.artist === a)) {
                mt.songs.push({ title: t, artist: a, artwork: aw || '' });
                _refreshMtEdit(cid);
            }
        }

        function removeMtItem(type, idx, cid) {
            const mt = _getMtState(cid);
            if (type === 'artist') mt.artists.splice(idx, 1);
            else if (type === 'genre') mt.genres.splice(idx, 1);
            else mt.songs.splice(idx, 1);
            _refreshMtEdit(cid);
        }

        function musicTasteHTML(raw) {
            const mt = parseMusicTaste(raw);
            if (!mt || (!mt.genre && !mt.genres && !mt.artists && !mt.songs)) return '';
            const genreLabel = Array.isArray(mt.genres) && mt.genres.length
                ? mt.genres.join(', ')
                : (mt.genre || '');
            const songsArr = Array.isArray(mt.songs) ? mt.songs : (mt.songs ? [{ title: mt.songs, artist: '' }] : []);
            const songLabel = songsArr.map(s => escapeHtml(s.title) + (s.artist ? ' — ' + escapeHtml(s.artist) : '')).join(', ');
            return `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;font-size:0.75rem">
                ${genreLabel ? `<span style="background:#f0f4ff;color:#3366FF;padding:2px 8px;border-radius:10px">🎵 ${escapeHtml(genreLabel)}</span>` : ''}
                ${mt.artists ? `<span style="background:#f0fff4;color:#00b894;padding:2px 8px;border-radius:10px">🎤 ${escapeHtml(mt.artists)}</span>` : ''}
                ${songLabel ? `<span style="background:#fff8f0;color:#e07000;padding:2px 8px;border-radius:10px">🎶 ${songLabel}</span>` : ''}
            </div>`;
        }

        function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
        function escAttr(s) { return String(s||'').replace(/"/g,'&quot;').replace(/'/g,"&#39;"); }

        // 자유게시판 글: "\x1F제목\x1F\n본문" 형태로 저장된 제목/본문을 분리
        function parseBoardPost(raw) {
            const s = String(raw || '');
            const m = s.match(/^\x1F([\s\S]*?)\x1F\n?([\s\S]*)$/);
            if (m) return { title: m[1].trim(), body: m[2] };
            // 구분자가 깨진 글 방어: 남은 \x1F 제거
            return { title: '', body: s.replace(/\x1F/g, '') };
        }

        // 멤버 목록에서 숨길 계정 (중복/구 계정)
        // profiles.hidden(마이그레이션 20261110_profile_hidden.sql, 관리자 › 멤버 정보 수정의 「멤버 목록에서 숨김」) 기준.
        // 컬럼이 아직 없으면(값이 undefined) 종전 이름 목록으로 판정한다.
        const _LEGACY_HIDDEN_NAMES = ['최경수(세션장)', '최경수(일반)'];
        function isHiddenMember(m) {
            if (!m) return false;
            if (typeof m.hidden === 'boolean') return m.hidden;
            return _LEGACY_HIDDEN_NAMES.includes(m.name);
        }

        // 이름 기반 결정적 아바타 (색상 + 이니셜)
        const GA_AVATAR_COLORS = ['#3366FF','#00b894','#e07000','#6c5ce7','#e0407a','#0091a8','#c0392b','#2d7d46'];
        function gaAvatar(name, opts) {
            const n = String(name || '').replace(/\(.*?\)/g, '').trim() || '?';
            let h = 0;
            for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
            const color = GA_AVATAR_COLORS[h % GA_AVATAR_COLORS.length];
            const initial = escapeHtml(n.charAt(0).toUpperCase());
            const cls = (opts && opts.cls) ? ' ' + opts.cls : '';
            if (opts && opts.url) return `<span class="ga-avatar img${cls}" style="background-image:url('${escapeHtml(opts.url)}')" title="${escapeHtml(n)}"></span>`;
            return `<span class="ga-avatar${cls}" style="background:${color}" title="${escapeHtml(n)}">${initial}</span>`;
        }

        // 음악취향을 컴팩트 태그로 (멤버 카드용)
        function musicTasteTags(raw) {
            const mt = parseMusicTaste(raw);
            if (!mt || (!mt.genre && !mt.genres && !mt.artists && !mt.songs)) return '';
            const genreList = Array.isArray(mt.genres) && mt.genres.length
                ? mt.genres
                : (mt.genre ? String(mt.genre).split(',').map(s => s.trim()).filter(Boolean) : []);
            const artistList = Array.isArray(mt.artists) ? mt.artists.map(a => String(a && a.name || a).trim()).filter(Boolean)
                : (mt.artists ? String(mt.artists).split(',').map(s => s.trim()).filter(Boolean) : []);
            const songsArr = Array.isArray(mt.songs) ? mt.songs : (mt.songs ? [{ title: mt.songs, artist: '', artwork: '' }] : []);
            const tag = (bg, fg, ic, label) => `<span class="mt-tag" style="background:${bg};color:${fg}" title="${escapeHtml(label)}">${ic ? `<span class="mt-tag-ic">${ic}</span>` : ''}<span class="mt-tag-label">${escapeHtml(label)}</span></span>`;
            const parts = [];
            // 장르·가수를 각각 개별 칩(버튼식)으로 표시
            genreList.forEach(g => parts.push(tag('#f0f4ff', '#3366ff', '', g)));
            artistList.forEach(a => parts.push(tag('#f0fff4', '#00b894', '', a)));
            const songChips = songsArr.map(s =>
                `<div class="mt-song-chip">
                    ${s.artwork ? `<img src="${escapeHtml(s.artwork)}" alt="" class="mt-song-art">` : '<div class="mt-song-art mt-song-art-placeholder"></div>'}
                    <div class="mt-song-info">
                        <div class="mt-song-title">${escapeHtml(s.title)}</div>
                        ${s.artist ? `<div class="mt-song-artist">${escapeHtml(s.artist)}</div>` : ''}
                    </div>
                </div>`
            );
            if (songChips.length) parts.push(`<div class="mt-song-list">${songChips.join('')}</div>`);
            return parts.length ? `<div class="mt-tags">${parts.join('')}</div>` : '';
        }

        // 본인 외에는 이름 뒤 '(관리자)' 등 괄호 뱃지 숨김
        function memberDisplayName(m) {
            const name = m.name || '';
            const isSelf = state.user && m.kakao_id === state.user.kakaoId;
            return escapeHtml(isSelf ? name : name.replace('(관리자)', '').trim());
        }

        // 예약 r 의 participant_ids(추가된 참여 멤버)를 이름 목록 문자열로 변환.
        // cachedMembers 에 없는 id(미로드/탈퇴)는 건너뜀.
        // 반환값은 이스케이프되지 않은 원문 — innerHTML 에 넣을 땐 escapeHtml() 필수.
        function participantNames(r) {
            const ids = Array.isArray(r && r.participant_ids) ? r.participant_ids : [];
            if (!ids.length) return '';
            return ids.map(id => {
                const m = (state.cachedMembers || []).find(x => x.id === id);
                return m ? (m.name || '').replace('(관리자)', '').trim() : '';
            }).filter(Boolean).join(', ');
        }

        function renderSongList() {
            const c = document.getElementById('editingSongList');
            if (!c) return;
            if (state.editingSongs.length === 0) {
                c.innerHTML = '<p style="font-size:0.82rem;color:var(--wds-gray-500);padding:4px 0;margin:0">아직 추가된 곡이 없습니다.</p>';
                return;
            }
            c.innerHTML = state.editingSongs.map((s, i) => `
                <div class="song-chip">
                    ${s.artwork ? `<img src="${escapeHtml(s.artwork)}" alt="">` : '<div style="width:36px;height:36px;background:var(--wds-gray-300);border-radius:4px;flex-shrink:0"></div>'}
                    <div class="song-chip-info">
                        <div class="song-chip-title">${escapeHtml(s.title)}</div>
                        <div class="song-chip-artist">${escapeHtml(s.artist)}</div>
                    </div>
                    <button type="button" class="song-chip-remove" onclick="removeSong(${i})">×</button>
                </div>
            `).join('');
        }

        function removeSong(idx) {
            state.editingSongs.splice(idx, 1);
            renderSongList();
        }

        function renderTeamSlots() {
            const c = document.getElementById('teamSlots');
            if (!c) return;
            const members = state.cachedMembers || [];
            c.innerHTML = state.editingSlots.map((slot, idx) => `
                <div class="team-slot-row">
                    <input type="text" class="slot-session-input" value="${(slot.session || '').replace(/"/g,'&quot;')}" data-idx="${idx}" placeholder="세션" onchange="updateSlotSession(${idx}, this.value)">
                    <select onchange="updateSlotMember(${idx}, this.value)">
                        <option value="">-- 멤버 선택 --</option>
                        ${members.map(m => `<option value="${m.id}" ${slot.memberId === m.id ? 'selected' : ''}>${m.name}${m.instruments ? ' (' + m.instruments + ')' : ''}</option>`).join('')}
                    </select>
                    <label class="slot-leader" title="팀장으로 지정"><input type="radio" name="teamLeaderPick" ${slot.leader ? 'checked' : ''} onchange="setTeamLeader(${idx})"><span>👑</span></label>
                    <button type="button" class="slot-remove" onclick="removeTeamSlot(${idx})">×</button>
                </div>
            `).join('') + `<div style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:2px">👑 를 눌러 팀장을 정하세요 (한 명)</div>`;
        }
        // 팀장(2026-10-16): 슬롯 객체의 leader=true 한 명 — teams.members JSON 안에 저장(컬럼 추가 없음)
        function setTeamLeader(idx) { state.editingSlots.forEach((sl, i) => { sl.leader = i === idx; }); }
        function teamLeaderId(t) { const sl = ((t && t.members) || []).find(x => x.leader && x.memberId); return sl ? sl.memberId : null; }

        function updateSlotSession(idx, value) {
            if (state.editingSlots[idx]) state.editingSlots[idx].session = value;
        }

        function updateSlotMember(idx, value) {
            if (state.editingSlots[idx]) state.editingSlots[idx].memberId = value;
        }

        function addTeamSlot() {
            state.editingSlots.push({ session: '', memberId: '' });
            renderTeamSlots();
        }

        function removeTeamSlot(idx) {
            state.editingSlots.splice(idx, 1);
            renderTeamSlots();
        }

        async function saveTeam() {
            const name = document.getElementById('teamName').value.trim();
            if (!name) { showToast('팀 이름을 입력해주세요.'); return; }
            const startDate = document.getElementById('teamStartDate').value || null;
            const endDate = document.getElementById('teamEndDate').value || null;

            const slots = state.editingSlots.filter(s => s.session && s.memberId).map(s => ({ session: s.session, memberId: s.memberId, leader: !!s.leader }));
            if (slots.filter(s => s.leader).length > 1) slots.forEach((s, i) => { if (i !== slots.findIndex(x => x.leader)) s.leader = false; }); // 팀장은 한 명
            const songs = state.editingSongs.length > 0 ? state.editingSongs : null;
            const firstSong = songs ? songs[0] : null;

            const team = {
                name, start_date: startDate, end_date: endDate,
                song_title: firstSong ? firstSong.title : null,
                song_artist: firstSong ? firstSong.artist : null,
                songs: songs,
                members: slots
            };
            let error;
            if (state.editingTeam) {
                ({ error } = await supabaseClient.from('teams').update(team).eq('id', state.editingTeam.id));
            } else {
                ({ error } = await supabaseClient.from('teams').insert([team]));
            }
            if (error) {
                console.warn('팀 저장 실패. songs 컬럼 확인: ALTER TABLE teams ADD COLUMN IF NOT EXISTS songs jsonb;');
                showToast('팀 저장 실패: ' + error.message, 5000);
                return;
            }
            const editingId = state.editingTeam ? state.editingTeam.id : null;
            hideTeamForm();
            await fetchTeams();
            renderMemberPanel();
            // 저장한 팀 카드로(2026-10-19) — 새 팀은 같은 이름 중 가장 최근 행
            const saved = editingId ? state.teams.find(t => t.id === editingId)
                : [...state.teams].filter(t => t.name === name).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
            if (saved) gtFocus('#team-' + saved.id, { block: 'center' });
            showToast(editingId ? '팀을 수정했습니다.' : '팀을 만들었습니다.');
        }

        async function deleteTeam(id) {
            if (!confirm('이 팀을 삭제하시겠습니까?')) return;
            const { data, error } = await supabaseClient.from('teams').delete().eq('id', id).select();
            if (error) { showToast('삭제 실패: ' + error.message, 5000); return; }
            if (!data || data.length === 0) { showToast('삭제 권한이 없습니다.'); return; }
            await fetchTeams();
            renderMemberPanel();
        }

        async function searchMusic() {
            const query = document.getElementById('teamMusicSearch').value.trim();
            if (!query) return;
            const results = document.getElementById('musicResults');
            results.innerHTML = '<p style="font-size:0.85rem;color:var(--wds-gray-500);padding:8px">검색 중...</p>';
            try {
                const rows = await musicSearch(query, 'song', 8);
                if (!rows.length) {
                    results.innerHTML = '<p style="font-size:0.85rem;color:var(--wds-gray-500);padding:8px">검색 결과가 없습니다. 아래 「직접 입력」으로 추가할 수 있습니다.</p>';
                    return;
                }
                results.innerHTML = rows.map(r => _musicRow(r, 'selectMusic(this)', false)).join('');
            } catch (e) {
                console.error('team song search', e);
                results.innerHTML = '<p style="font-size:0.85rem;color:#e74c3c;padding:8px">검색에 실패했습니다. 아래 「직접 입력」으로 추가할 수 있습니다.</p>';
            }
        }

        function addManualSong() {
            const title = document.getElementById('manualSongTitle').value.trim();
            const artist = document.getElementById('manualSongArtist').value.trim();
            if (!title) { showToast('곡 제목을 입력해주세요.'); document.getElementById('manualSongTitle')?.focus(); return; }
            if (!state.editingSongs.find(s => s.title === title && s.artist === artist)) {
                state.editingSongs.push({ title, artist, artwork: '' });
                renderSongList();
            }
            document.getElementById('manualSongTitle').value = '';
            document.getElementById('manualSongArtist').value = '';
        }

        function selectMusic(el) {
            const title = el.dataset.title;
            const artist = el.dataset.artist;
            const artwork = el.dataset.artwork || '';
            if (!state.editingSongs.find(s => s.title === title && s.artist === artist)) {
                state.editingSongs.push({ title, artist, artwork });
                renderSongList();
            }
            document.getElementById('musicResults').innerHTML = '';
            document.getElementById('teamMusicSearch').value = '';
        }

        const INST_EMOJI = { '보컬': '🎤', '기타': '🎸', '베이스': '<img src="https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/base_icon.png" style="height:1em;vertical-align:middle">', '키보드': '🎹', '드럼': '🥁' };
        function instBadges(instruments) {
            if (!instruments) return '';
            const insts = instruments.split(',').map(s => s.trim()).filter(Boolean);
            if (insts.length === 0) return '';
            return `<span style="font-size:0.78rem;color:var(--wds-gray-500);margin-left:4px;white-space:nowrap">(+${insts.map(escapeHtml).join(', ')})</span>`;
        }

        async function renderMembersTab(container) {
            const paint = (members) => {
                const approved = (members || []).filter(m => m.status === 'approved' && !isHiddenMember(m));
                const sig = JSON.stringify(approved.map(m => [m.id, m.name, m.role, m.avatar_url, m.instruments, m.music_taste, m.phone, m.email]));
                if (container.dataset.sig === sig && container.querySelector('#memberPanelList')) return; // 바뀐 게 없으면 DOM 그대로(검색창 포커스 유지)
                container.dataset.sig = sig;
                const isS = isSuper();
                container.innerHTML = '';
                if (approved.length === 0) {
                    container.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.9rem;text-align:center;padding:40px">아직 멤버가 없습니다.</p>';
                    return;
                }
                const searchWrap = document.createElement('div');
                searchWrap.style.marginBottom = '10px';
                const curQ = state.memberPanelSearch || '';
            searchWrap.innerHTML = `<input type="text" id="memberPanelSearchInput" placeholder="이름, 세션 검색..." value="${escapeHtml(curQ)}" oninput="filterMemberPanelList()" style="width:100%;height:36px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:8px;font-size:0.85rem;font-family:inherit;outline:none;box-sizing:border-box">`;
                container.appendChild(searchWrap);
                const listDiv = document.createElement('div');
                listDiv.id = 'memberPanelList';
                container.appendChild(listDiv);
                window._memberPanelData = { approved, isS };
                renderMemberPanelList();
            };
            // 즉시: 캐시 HTML 이 이미 보이면 그대로, 아니면 로그인 때 받아 둔 멤버로 그린다(둘 다 없으면 자리표시)
            if (!container.dataset.cached) { delete container.dataset.sig; if ((state.cachedMembers || []).length) paint(state.cachedMembers); else _gtPlaceholder(container); }
            else delete container.dataset.sig;
            const members = await fetchMembers();
            if (state.memberPanelTab !== 'list') return; // 기다리는 동안 다른 하위 화면으로 옮겼으면 덮어쓰지 않는다
            const approvedAll = (members || []).filter(m => m.status === 'approved');
            if (approvedAll.length) state.cachedMembers = approvedAll;
            paint(members);
        }

        function filterMemberPanelList() {
            const inp = document.getElementById('memberPanelSearchInput');
            state.memberPanelSearch = inp ? inp.value : '';
            renderMemberPanelList();
        }

        function renderMemberPanelList() {
            const listDiv = document.getElementById('memberPanelList');
            if (!listDiv || !window._memberPanelData) return;
            const { approved, isS } = window._memberPanelData;
            const q = (state.memberPanelSearch || '').trim().toLowerCase();
            const filtered = q ? approved.filter(m => {
                const nq = q.replace(/-/g,'');
                return (m.name||'').toLowerCase().includes(q)
                    || (m.instruments||'').toLowerCase().includes(q)
                    || (m.phone||'').replace(/-/g,'').includes(nq)
                    || (m.email||'').toLowerCase().includes(q)
                    || (m.music_taste||'').toLowerCase().includes(q);
            }) : approved;

            if (filtered.length === 0) {
                listDiv.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.88rem;text-align:center;padding:24px">검색 결과가 없습니다.</p>';
                return;
            }

            // 악기별 그룹화: 주 악기(첫 번째) 기준
            const ORDER = ['보컬', '기타', '베이스', '키보드', '드럼'];
            const groups = {};
            const noneKey = '기타';
            filtered.forEach(m => {
                const insts = (m.instruments || '').split(',').map(s => s.trim()).filter(Boolean);
                const primary = insts[0] || '미지정';
                (groups[primary] = groups[primary] || []).push(m);
            });
            const groupKeys = Object.keys(groups).sort((a, b) => {
                const ai = ORDER.indexOf(a), bi = ORDER.indexOf(b);
                if (ai === -1 && bi === -1) return a.localeCompare(b, 'ko');
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
            });

            const roleStyles = {
                '운영 총괄': { bg:'#fdeee6', fg:'#e04000', label:'운영총괄' },
                '총괄':     { bg:'#ebf0ff', fg:'#3366FF', label:'👑 총괄' },
                '세션장':   { bg:'#e6f9f2', fg:'#00b894', label:'⭐ 세션장' }
            };
            const renderItem = (m) => {
                const role = m.role || '일반';
                const rs = roleStyles[role];
                const roleTag = rs ? `<span class="mlist-role" style="background:${rs.bg};color:${rs.fg}">${rs.label}</span>` : '';
                // 부 악기만 서브 라인으로
                const insts = (m.instruments || '').split(',').map(s => s.trim()).filter(Boolean);
                const subInsts = insts.slice(1).join(', ');
                const subLine = subInsts ? `<div class="mlist-sub">+ ${escapeHtml(subInsts)}</div>` : '';
                const adminMeta = isS ? `<div class="mlist-meta">
                    <span>${m.email ? escapeHtml(m.email) : '카카오 로그인'}</span>
                    ${m.phone ? `<span>${escapeHtml(m.phone)}</span>` : ''}
                </div>` : '';
                // 아바타는 이름·연락처 줄 옆(머리 줄)에만 — 취향 태그·곡은 그 아래 전체 폭 (2026-10-15 요청: 왼쪽 기둥형은 위아래 여백이 남는다)
                return `<div class="mlist-card">
                    <div class="mlist-head">
                        ${gaAvatar(m.name, { url: m.avatar_url })}
                        <div class="mlist-body">
                            <div class="mlist-name-row"><span class="mlist-name">${memberDisplayName(m)}</span>${roleTag}</div>
                            ${subLine}
                            ${adminMeta}
                        </div>
                    </div>
                    ${musicTasteTags(m.music_taste)}
                </div>`;
            };

            listDiv.innerHTML = groupKeys.map(gKey => {
                const list = groups[gKey];
                const emoji = INST_EMOJI[gKey] || '🎵';
                return `
                    <div class="member-group">
                        <div class="member-group-header">${emoji} ${escapeHtml(gKey)} <span class="member-group-count">${list.length}</span></div>
                        <div class="mlist">${list.map(renderItem).join('')}</div>
                    </div>`;
            }).join('');
        }

        function renderMyPage(container) {
            const allRes = state.reservations
                .filter(r => r.kakao_id === state.user.kakaoId)
                .sort((a, b) => new Date(b.res_date) - new Date(a.res_date));

            if (allRes.length === 0) {
                container.innerHTML = '<p style="text-align:center; padding: 40px; color: var(--wds-gray-500);">예약 내역이 없습니다.</p>';
                return;
            }

            const { items: myRes, page, totalPages, total } = getPaged(allRes, 'myRes');
            const list = document.createElement('div');
            list.className = 'my-res-list';
            myRes.forEach(r => {
                const item = document.createElement('div');
                item.className = 'my-res-item';
                const endIdx = TIMES.indexOf(r.end_time);
                const endTimeDisplay = TIMES[endIdx + 1] || '23:00';
                const statusMap = { pending: ['status-pending', '승인 대기'], approved: ['status-approved', '승인됨'], rejected: ['status-rejected', '거절됨'] };
                const [statusClass, statusText] = statusMap[r.status] || statusMap['pending'];
                const canCancel = r.status !== 'rejected';
                const editable = isReservationEditable(r);
                item.style.flexWrap = 'wrap';
                item.style.rowGap = '6px';
                const etcLine = r.participant_etc
                    ? `<div style="flex-basis:100%;font-size:0.76rem;color:#e07b00;padding-top:2px">📝 기타: ${escapeHtml(r.participant_etc)}</div>`
                    : '';
                const pNames = participantNames(r);
                const membersLine = pNames
                    ? `<div style="flex-basis:100%;font-size:0.76rem;color:var(--wds-primary);padding-top:2px">👥 멤버: ${escapeHtml(pNames)}</div>`
                    : '';
                item.innerHTML = `
                    <div class="my-res-info">
                        <div class="my-res-date">${r.res_date} <span class="status-badge sm ${statusClass}" style="margin-left:8px">${statusText}</span></div>
                        <div class="my-res-time">${r.start_time} ~ ${endTimeDisplay}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                        ${editable ? `<button class="gaa-btn gaa-btn-primary" type="button" onclick="openEditParticipantsModal('${r.id}')">멤버 수정</button>` : ''}
                        ${canCancel ? `<button class="gaa-btn gaa-btn-sm gaa-btn-danger" type="button" onclick="cancelReservation('${r.id}')">취소</button>` : ''}
                    </div>
                    ${membersLine}${etcLine}`;
                list.appendChild(item);
            });
            container.appendChild(list);
            container.insertAdjacentHTML('beforeend', pagerHTML('myRes', page, totalPages, total));
        }

        async function renderAdminPage(container) {
            // 서브탭 바
            const subtabBar = document.createElement('div');
            subtabBar.className = 'admin-subtabs';
            const subtabDefs = [
                { key: 'approval', label: '⏳ 예약승인' },
                { key: 'members', label: '👥 멤버현황' },
                ...(canPostNotice() ? [{ key: 'notice', label: '📢 공지' }] : []),
                ...(isSuper() ? [{ key: 'blocks', label: '🚫 시간차단' }, { key: 'bgm', label: '🎵 BGM' }] : []),
                ...(canApproveRes() ? [{ key: 'docs', label: '📖 문서관리' }, { key: 'push', label: '🔔 알림설정' }] : []),
                ...(isSuper() ? [{ key: 'perfbooking', label: '🎭 공간대관' }] : []), // 대관 신청엔 연락처 등 외부인 개인정보 포함 — 운영 총괄 전용
                ...(isSuper() ? [{ key: 'ops', label: '🛠️ 운영 도구' }] : []) // 브라우저 오류 기록 · 백업 내려받기(2026-11-10)
            ];
            subtabDefs.forEach(t => {
                const btn = document.createElement('div');
                btn.className = 'admin-subtab' + (state.adminTab === t.key ? ' active' : '');
                btn.textContent = t.label;
                btn.onclick = () => { state.adminTab = t.key; renderGatheOAdmin(); };
                subtabBar.appendChild(btn);
            });
            container.appendChild(subtabBar);

            const content = document.createElement('div');
            container.appendChild(content);

            if (state.adminTab === 'approval') {
                renderAdminApprovalSection(content);
            } else if (state.adminTab === 'members') {
                await renderAdminMembersSection(content);
            } else if (state.adminTab === 'blocks') {
                renderAdminBlocksSection(content);
            } else if (state.adminTab === 'bgm') {
                renderAdminBgmSection(content);
            } else if (state.adminTab === 'push') {
                await renderAdminPushSection(content);
            } else if (state.adminTab === 'docs') {
                renderAdminDocsSection(content);
            } else if (state.adminTab === 'perfbooking') {
                await renderPerfAdminTab(content);
            } else if (state.adminTab === 'ops') {
                await renderAdminOpsSection(content);
            } else {
                renderAdminNoticeSection(content);
            }
        }

        // ── 운영 도구(운영 총괄, 2026-11-10): 브라우저 오류 기록 + 백업 내려받기. 둘 다 /gatheo-api 가 운영 총괄만 허용한다. ──
        async function renderAdminOpsSection(container) {
            if (!isSuper()) { container.innerHTML = '<p class="ops-empty">운영 총괄만 볼 수 있습니다.</p>'; return; }
            container.innerHTML = `
                <div class="gt-card ops-card">
                    <div class="ops-head"><strong>백업 내려받기</strong></div>
                    <p class="ops-note">예약·멤버·합주팀·대관·공연·커뮤니티·포스터 꾸미기 자료를 파일 하나(JSON)로 내려받습니다. 사진 파일은 포함되지 않습니다.<br>
                    <b>이름·연락처가 들어 있는 파일</b>이니 개인 기기의 안전한 곳에만 보관하고 공유하지 마세요. 한 달에 한 번, 큰 변경 전에 받아 두기를 권합니다.</p>
                    <div class="ops-row"><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" id="opsBackupBtn" onclick="opsBackupDownload(this)">백업 파일 내려받기</button><span id="opsBackupMsg" class="ops-msg"></span></div>
                </div>
                <div class="gt-card ops-card">
                    <div class="ops-head"><strong>브라우저 오류 기록</strong>
                        <span class="ops-actions"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="opsLoadErrors()">새로고침</button>
                        <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="opsClearErrors()">기록 비우기</button></span></div>
                    <p class="ops-note">방문자 화면에서 난 스크립트 오류가 자동으로 모입니다(개인정보 없음). 같은 오류가 여러 번 보이면 알려주세요.</p>
                    <div id="opsErrorList"><p class="ops-empty">불러오는 중…</p></div>
                </div>`;
            await opsLoadErrors();
        }
        async function opsLoadErrors() {
            const el = document.getElementById('opsErrorList'); if (!el) return;
            const res = await _gwAction('client_errors', {}, { interactive: true });
            if (!document.getElementById('opsErrorList')) return;
            if (res.down) { el.innerHTML = '<p class="ops-empty">이 환경에서는 서버 함수를 쓸 수 없습니다.</p>'; return; }
            if (!res.ok) { el.innerHTML = `<p class="ops-empty">${escapeHtml(res.message || '불러오지 못했습니다.')}</p>`; return; }
            if (res.missing) { el.innerHTML = '<p class="ops-empty">기록 표가 아직 없습니다. supabase/migrations/20261110_client_errors.sql 을 실행하면 모이기 시작합니다.</p>'; return; }
            const rows = res.rows || [];
            if (!rows.length) { el.innerHTML = '<p class="ops-empty">기록된 오류가 없습니다.</p>'; return; }
            // 같은 메시지끼리 묶어 횟수·최근 시각으로
            const groups = new Map();
            rows.forEach(r => { const g = groups.get(r.message) || { first: r, n: 0, pages: new Set(), roles: new Set() }; g.n++; if (r.page) g.pages.add(r.page); if (r.role) g.roles.add(r.role); groups.set(r.message, g); });
            const roleKo = { member: '멤버', admin: '관리자', band: '합주팀', guest: '비로그인' };
            const dev = (ua) => /iPhone|iPad/.test(ua || '') ? 'iOS' : /Android/.test(ua || '') ? '안드로이드' : /KAKAOTALK/i.test(ua || '') ? '카톡' : 'PC';
            el.innerHTML = [...groups.values()].map(g => {
                const r = g.first, t = new Date(r.created_at);
                const when = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                return `<details class="ops-err"><summary><span class="ops-err-msg">${escapeHtml(r.message)}</span>
                    <span class="ops-err-meta">${g.n > 1 ? `<b>${g.n}회</b> · ` : ''}최근 ${when} · ${escapeHtml([...g.pages].slice(0, 3).join(', ') || '-')} · ${escapeHtml([...g.roles].map(x => roleKo[x] || x).join('/'))} · ${dev(r.ua)}${/KAKAOTALK/i.test(r.ua || '') ? '(카톡)' : ''}</span></summary>
                    <pre class="ops-err-stack">${escapeHtml([r.source, r.stack].filter(Boolean).join('\n') || '(스택 없음)')}</pre></details>`;
            }).join('');
        }
        async function opsClearErrors() {
            if (!confirm('오류 기록을 모두 지울까요?')) return;
            const res = await _gwAction('client_errors_clear', {}, { interactive: true });
            if (res.down || !res.ok) { showToast('지우지 못했습니다.', 4000); return; }
            showToast('오류 기록을 비웠습니다.'); opsLoadErrors();
        }
        async function opsBackupDownload(btn) {
            const msg = document.getElementById('opsBackupMsg');
            const say = (t, bad) => { if (msg) { msg.textContent = t; msg.style.color = bad ? '#e74c3c' : ''; } };
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const list = await _gwAction('backup_tables', {}, { interactive: true });
                if (list.down) { say('이 환경에서는 서버 함수를 쓸 수 없습니다.', true); return; }
                if (!list.ok) { say(list.message || '권한을 확인하지 못했습니다.', true); return; }
                const out = { exported_at: new Date().toISOString(), site: location.hostname, note: '게더 올 어라운드 백업 — 개인정보 포함, 공유 금지. 사진 파일(Storage)은 포함되지 않음.', tables: {}, missing: [] };
                let total = 0;
                for (let i = 0; i < list.tables.length; i++) {
                    const t = list.tables[i]; say(`${i + 1}/${list.tables.length} · ${t}`);
                    const rows = []; let offset = 0;
                    for (let guard = 0; guard < 200; guard++) {
                        const res = await _gwAction('backup_table', { table: t, offset });
                        if (res.down || !res.ok) { say(`${t} 를 받지 못해 중단했습니다. 다시 시도해주세요.`, true); return; }
                        if (res.missing) { out.missing.push(t); break; }
                        rows.push(...(res.rows || [])); offset += (res.rows || []).length;
                        if (!res.more) break;
                    }
                    if (!out.missing.includes(t)) { out.tables[t] = rows; total += rows.length; }
                }
                const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
                const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gatherallaround-backup-${stamp}.json`;
                document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                say(`완료 · 표 ${Object.keys(out.tables).length}개 · ${total.toLocaleString()}행 (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
            } finally { btn.disabled = false; }
        }

        function renderAdminPollsSection(container) {
            if (!container) return;
            container.id = 'adminPollContent';
            const opts = state.editingPoll.options;
            const openPolls = state.polls.filter(p => p.status === 'open');
            const closedPolls = state.polls.filter(p => p.status === 'closed');
            const voteCount = (pollId) => state.pollVotes.filter(v => v.poll_id === pollId).length;
            container.innerHTML = `
                <div class="admin-section">
                    <div class="admin-section-title">🗳️ 새 투표 만들기</div>
                    <div style="display:flex;flex-direction:column;gap:10px">
                        <input id="pollTitle" type="text" placeholder="투표 제목 (예: 다음 합주 곡 선정)" value="${escapeHtml(state.editingPoll.title || '')}" style="padding:10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.95rem">
                        <div style="display:flex;flex-direction:column;gap:6px" id="pollOptionsWrap">
                            ${opts.map((o, i) => `
                                <div style="display:flex;gap:6px">
                                    <input type="text" value="${o.replace(/"/g,'&quot;')}" onchange="updatePollOption(${i}, this.value)" placeholder="옵션 ${i + 1}" style="flex:1;padding:8px 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem">
                                    <button class="gaa-btn gaa-btn-sm gaa-btn-danger" type="button" onclick="removePollOption(${i})">−</button>
                                </div>
                            `).join('')}
                        </div>
                        <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="align-self:flex-start" type="button" onclick="addPollOption()">+ 옵션 추가</button>
                        <div style="display:flex;gap:14px;font-size:0.88rem;color:var(--wds-gray-700)">
                            <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" id="pollMulti"> 다중 선택 허용</label>
                            <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" id="pollAnon"> 익명 투표</label>
                        </div>
                        <button type="button" class="admin-post-btn" onclick="createPoll()">투표 만들기</button>
                    </div>
                </div>

                <div class="admin-section">
                    <div class="admin-section-title">🔴 진행 중 (${openPolls.length})</div>
                    ${openPolls.length === 0 ? '<p style="color:var(--wds-gray-500);font-size:0.9rem">진행 중인 투표가 없습니다.</p>' :
                    openPolls.map(p => `
                        <div class="my-res-item" style="margin-bottom:8px;flex-direction:column;align-items:stretch">
                            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
                                <strong style="flex:1">${escapeHtml(p.title)}</strong>
                                <span style="font-size:0.78rem;color:var(--wds-gray-500)">${voteCount(p.id)}표 · ${p.multi_select ? '다중' : '단일'}${p.anonymous ? ' · 익명' : ''}</span>
                            </div>
                            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                                <button type="button" onclick="sharePollKakao('${p.id}')" style="padding:4px 10px;font-size:0.78rem;background:#FEE500;color:#3C1E1E;border:none;border-radius:var(--wds-radius-s);cursor:pointer;font-weight:600">카카오 공유</button>
                                <button class="gaa-btn gaa-btn-xs gaa-btn-primary" type="button" onclick="closePoll('${p.id}')">투표 종료</button>
                                <button class="gaa-btn gaa-btn-xs gaa-btn-danger" type="button" onclick="deletePoll('${p.id}')">삭제</button>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="admin-section">
                    <div class="admin-section-title">✅ 종료된 투표 (${closedPolls.length})</div>
                    ${closedPolls.length === 0 ? '<p style="color:var(--wds-gray-500);font-size:0.9rem">종료된 투표가 없습니다.</p>' :
                    closedPolls.map(p => `
                        <div class="my-res-item" style="margin-bottom:8px;flex-direction:column;align-items:stretch">
                            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
                                <strong style="flex:1;color:var(--wds-gray-600)">${escapeHtml(p.title)}</strong>
                                <span style="font-size:0.78rem;color:var(--wds-gray-500)">${voteCount(p.id)}표</span>
                            </div>
                            <div style="display:flex;gap:6px;margin-top:8px">
                                <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="reopenPoll('${p.id}')">재오픈</button>
                                <button class="gaa-btn gaa-btn-xs gaa-btn-danger" type="button" onclick="deletePoll('${p.id}')">삭제</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        async function renderAdminBgmSection(container) {
            const section = document.createElement('div');
            section.className = 'admin-section';
            section.innerHTML = `
                <div class="admin-section-title">🎵 BGM 플레이리스트 관리</div>
                <div style="font-size:0.82rem;color:var(--wds-gray-500);margin-bottom:12px;line-height:1.5">
                    Suno 곡 ID와 제목을 입력해 곡을 추가/제거할 수 있습니다.<br>
                    저장 시 GitHub의 <code style="background:var(--wds-gray-100);padding:1px 4px;border-radius:3px">music.json</code>이 업데이트됩니다.
                </div>
                <div style="margin-bottom:12px">
                    <label style="display:block;font-size:0.78rem;font-weight:700;color:var(--wds-gray-700);margin-bottom:4px">GitHub Personal Access Token</label>
                    <input type="password" id="bgmPat" placeholder="github_pat_..." autocomplete="off"
                        style="width:100%;padding:8px 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.85rem;font-family:inherit;outline:none">
                    <div style="font-size:0.7rem;color:var(--wds-gray-500);margin-top:4px">Contents: Read & Write 권한 필요. 브라우저에만 저장됩니다.</div>
                </div>
                <div id="bgmAdminList" style="margin-bottom:12px"></div>
                <div style="background:var(--wds-gray-100);padding:10px;border-radius:var(--wds-radius-s);margin-bottom:10px">
                    <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-700);margin-bottom:6px">새 곡 추가</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                        <input type="text" id="bgmNewId" placeholder="Suno 곡 ID (UUID)"
                            style="flex:2;min-width:160px;padding:7px 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.82rem;font-family:inherit">
                        <input type="text" id="bgmNewTitle" placeholder="곡 제목"
                            style="flex:1;min-width:120px;padding:7px 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.82rem;font-family:inherit">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex-shrink:0" type="button" onclick="bgmAdminAdd()">+ 추가</button>
                    </div>
                </div>
                <button type="button" onclick="bgmAdminSave()" class="admin-post-btn" style="width:100%">💾 GitHub에 저장</button>
                <div id="bgmAdminStatus" style="margin-top:10px;font-size:0.85rem;min-height:20px"></div>
            `;
            container.appendChild(section);

            // 저장된 PAT 복원
            const savedPat = localStorage.getItem('bgm_admin_pat');
            if (savedPat) document.getElementById('bgmPat').value = savedPat;
            document.getElementById('bgmPat').addEventListener('change', e => {
                localStorage.setItem('bgm_admin_pat', e.target.value.trim());
            });

            // music.json 로드
            try {
                const r = await fetch('/music.json?v=' + Date.now());
                state.bgmTracks = await r.json();
            } catch (e) {
                state.bgmTracks = [];
            }
            renderBgmAdminList();
        }

        function renderBgmAdminList() {
            const list = document.getElementById('bgmAdminList');
            if (!list) return;
            const tracks = state.bgmTracks || [];
            if (tracks.length === 0) {
                list.innerHTML = '<p style="text-align:center;padding:14px;color:var(--wds-gray-500);font-size:0.85rem;background:var(--wds-gray-100);border-radius:var(--wds-radius-s)">등록된 곡이 없습니다.</p>';
                return;
            }
            list.innerHTML = `<div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-700);margin-bottom:6px">현재 ${tracks.length}곡</div>` + tracks.map((t, i) => `
                <div class="admin-member-row" style="margin-bottom:4px">
                    <span style="font-size:0.78rem;color:var(--wds-gray-500);width:20px;flex-shrink:0">${i + 1}</span>
                    <input type="text" value="${escapeHtml(t.title)}" onchange="bgmAdminEditTitle(${i}, this.value)" style="flex:1;padding:4px 8px;font-size:0.82rem;border:1px solid var(--wds-gray-300);border-radius:4px;font-family:inherit">
                    <span style="font-size:0.68rem;color:var(--wds-gray-500);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px" title="${escapeHtml(t.id)}">${escapeHtml(t.id.slice(0, 8))}…</span>
                    <button class="gaa-btn gaa-btn-xs gaa-btn-danger" style="flex-shrink:0" type="button" onclick="bgmAdminRemove(${i})">×</button>
                </div>`).join('');
        }
