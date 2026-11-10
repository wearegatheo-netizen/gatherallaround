// 게더 올 어라운드 본 스크립트 7/8 (members) — index.html 이 번호 순서대로 읽는 클래식 스크립트. 전역(함수·let/const)을 서로 공유한다.
// 고친 뒤에는 node tools/stamp-assets.mjs 로 index.html 의 ?v= 를 갱신할 것(tests/assets-unit.mjs 가 검사).

        async function handleResetPw() {
            const np = document.getElementById('resetPwNew').value;
            const cp = document.getElementById('resetPwConfirm').value;
            const result = document.getElementById('resetPwResult');
            if (!np || np.length < 6) { result.textContent = '비밀번호는 6자 이상이어야 합니다.'; result.style.color = '#e74c3c'; return; }
            if (np !== cp) { result.textContent = '비밀번호가 일치하지 않습니다.'; result.style.color = '#e74c3c'; return; }
            result.textContent = '변경 중...'; result.style.color = 'var(--wds-gray-500)';
            const { error } = await supabaseClient.auth.updateUser({ password: np });
            if (error) { result.textContent = '변경 실패: ' + error.message; result.style.color = '#e74c3c'; return; }
            recoveryMode = false;
            await supabaseClient.auth.signOut();
            history.replaceState(null, '', window.location.pathname);
            showToast('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.');
            document.getElementById('reset-pw-form').classList.add('hidden');
            document.getElementById('email-login-form').classList.remove('hidden');
        }

        async function handleFindPw() {
            const email = document.getElementById('findPwEmail').value.trim();
            const result = document.getElementById('findPwResult');
            if (!email) { result.textContent = '이메일을 입력해주세요.'; result.style.color = '#e74c3c'; return; }
            result.textContent = '이메일 발송 중...'; result.style.color = 'var(--wds-gray-500)';
            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + window.location.pathname
            });
            if (error) { result.textContent = '발송 실패: ' + error.message; result.style.color = '#e74c3c'; return; }
            result.textContent = '재설정 이메일을 발송했습니다. 메일함을 확인해주세요.';
            result.style.color = '#00b894';
        }

        function showPendingScreen(name) {
            hideBootOverlay();
            document.getElementById('portal-page').classList.add('hidden');
            document.getElementById('landing-page').classList.add('hidden');
            document.getElementById('landing-page-band').classList.add('hidden');
            document.getElementById('pending-screen').classList.remove('hidden');
            document.getElementById('pendingName').textContent = name;
        }

        let _signupBusy = false;
        async function handleEmailSignup() {
            if (_signupBusy) return;
            const name = document.getElementById('signupName').value.trim();
            const phone = document.getElementById('signupPhone').value.trim();
            const email = document.getElementById('signupEmail').value.trim();
            const password = document.getElementById('signupPassword').value;
            const confirm = document.getElementById('signupPasswordConfirm').value;
            const consent = document.getElementById('privacyConsent').checked;
            const res = document.getElementById('signupResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';

            // 폼이 잠겨 있어 버튼도 비활성이지만, 우회 제출을 막는 백스톱
            if (_signupPreformOk !== true) {
                if (_signupPreformOk === false) { showSignupPreformNotice(); return; }
                showErr('가입 신청서 작성 여부를 선택해주세요.');
                return;
            }

            if (!name || !phone || !email || !password) { showErr('모든 항목을 입력해주세요.'); return; }
            if (!/^010-\d{4}-\d{4}$/.test(phone) && !/^01[0-9]{8,9}$/.test(phone.replace(/-/g, ''))) { showErr('올바른 전화번호를 입력해주세요. (예: 010-0000-0000)'); return; }
            if (password.length < 6) { showErr('비밀번호는 6자 이상이어야 합니다.'); return; }
            if (password !== confirm) { showErr('비밀번호가 일치하지 않습니다.'); return; }
            if (!consent) { showErr('개인정보 수집·이용에 동의해주세요.'); return; }

            const selectedInsts = Array.from(document.querySelectorAll('#emailSignupInstBtns .inst-btn.selected')).map(b => b.dataset.inst);
            const customInsts = ['customInst1']
                .map(id => document.getElementById(id).value.trim())
                .filter(v => v);
            const instruments = [...selectedInsts, ...customInsts].join(', ');
            if (!instruments) { showErr('메인 세션을 1개 이상 선택하거나 입력해주세요.'); return; }

            const music_taste = getMtEditValue('mtEdit_signup');
            if (!music_taste) { showToast('음악 취향을 입력해주세요. 장르를 선택하거나 가수/곡을 검색해주세요.'); return; }

            _signupBusy = true;
            const submitBtn = document.querySelector('button[onclick="handleEmailSignup()"]');
            const origLabel = submitBtn ? submitBtn.textContent : '';
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '처리 중...'; }
            try {
                const { data, error } = await supabaseClient.auth.signUp({ email, password });
                if (error) { showErr('회원가입 실패: ' + error.message); return; }
                if (!data.user) { showErr('회원가입 처리에 문제가 발생했습니다.'); return; }

                const { error: pErr } = await supabaseClient.from('profiles').insert([{
                    id: data.user.id, name, phone, email, instruments, music_taste, status: 'pending'
                }]);
                if (pErr) { showErr('프로필 저장 실패: ' + pErr.message); return; }

                sendAdminPush('🙋 새 가입 신청', `${name} · ${instruments || '세션 미입력'}`);
                showPendingScreen(name);
            } finally {
                _signupBusy = false;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
            }
        }

        let _loginBusy = false;
        async function handleEmailLogin() {
            if (_loginBusy) return;
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;
            const res = document.getElementById('loginResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (!email || !password) { showErr('이메일과 비밀번호를 입력해주세요.'); return; }

            _loginBusy = true;
            const btn = document.querySelector('#email-login-form .email-primary-btn');
            const orig = btn ? btn.textContent : '';
            if (btn) { btn.disabled = true; btn.textContent = '로그인 중...'; }
            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) { showErr('로그인 실패: 이메일 또는 비밀번호를 확인해주세요.'); return; }
                await checkEmailUserApproval(data.user);
            } finally {
                _loginBusy = false;
                if (btn) { btn.disabled = false; btn.textContent = orig; }
            }
        }

        async function checkEmailUserApproval(user, opts = {}) {
            // opts.target: 부팅 복원 시 들어가려는 섹션('gatheo'|'band'|'portal'|공개 섹션). 세션 주인의 구역과 다르면
            // 상태(state.user / state.bandProfile)만 복구하고 화면은 _finishBoot 가 정한다(포털 또는 딥링크 섹션).
            // 로그인 폼에서 직접 호출될 때는 target 이 없으므로 항상 그 화면으로 들어간다.
            const target = opts.target || null;
            const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
            if (error || !data) { showToast('프로필 정보를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.'); return; }

            if (data.member_type === 'band') {
                if (data.status === 'approved') {
                    state.bandProfile = data;
                    if (!target || target === 'band') loginBandUI(data); else _finishBoot();
                } else if (data.status === 'rejected') {
                    showToast('가입이 거절되었습니다. 관리자에게 문의해주세요.');
                    await supabaseClient.auth.signOut();
                } else {
                    showPendingScreen(data.name || data.leader_name || '신청자');
                }
                return;
            }

            if (data.status === 'approved') {
                state.user = { nickname: data.name, kakaoId: user.id, authType: 'email', role: data.role || '일반', email: data.email, avatarUrl: data.avatar_url || null };
                if (!target || target === 'gatheo') loginUI(data.name); else _finishBoot();
            } else if (data.status === 'rejected') {
                showToast('회원가입이 거절되었습니다. 관리자에게 문의해주세요.');
                await supabaseClient.auth.signOut();
            } else {
                showPendingScreen(data.name);
            }
        }

        // --- 회원 관리 ---
        let _membersInflight = null;
        async function fetchMembers() {
            if (!supabaseClient) return [];
            if (_membersInflight) return _membersInflight;
            _membersInflight = (async () => {
                try {
                    const { data, error } = await supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
                    if (error) return [];
                    return (data || []).filter(m => m.member_type !== 'band');
                } finally {
                    setTimeout(() => { _membersInflight = null; }, 300);
                }
            })();
            return _membersInflight;
        }

        async function fetchBandProfiles() {
            if (!supabaseClient) return [];
            const { data, error } = await supabaseClient.from('profiles').select('*').eq('member_type', 'band').order('created_at', { ascending: false });
            return error ? [] : (data || []);
        }

        // --- 투표 ---
        async function fetchPolls() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient.from('polls').select('*').order('created_at', { ascending: false });
            if (!error) { state.polls = data || []; updatePollBadges(); }
        }

        function updatePollBadges() {
            const open = state.polls.filter(p => p.status === 'open');
            const badge = document.getElementById('livePollBadge');
            const banner = document.getElementById('livePollBanner');
            if (badge) badge.style.display = open.length > 0 ? 'inline-flex' : 'none';
            if (banner) {
                if (open.length > 0) {
                    const titles = open.map(p => `"${escapeHtml(p.title)}"`).join(', ');
                    banner.innerHTML = `<div class="live-poll-banner-inner" onclick="goToVotesTab()"><span class="live-poll-banner-icon">🗳️</span><span class="live-poll-banner-text">투표 진행 중 (${open.length}건): ${titles}</span><span class="live-poll-banner-arrow">투표하기 →</span></div>`;
                    banner.classList.remove('hidden');
                } else {
                    banner.classList.add('hidden');
                }
            }
        }

        async function fetchPollVotes() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient.from('poll_votes').select('*');
            if (!error) state.pollVotes = data || [];
        }

        function getCurrentUserProfileId() {
            if (!state.user) return null;
            const me = (state.cachedMembers || []).find(m => m.kakao_id === state.user.kakaoId || m.email === state.user.email);
            return me ? me.id : null;
        }

        // 같은 날에 여러 번 올라가도 1회로 카운트 — 예약 + 일정표 distinct 날짜 합집합
        function countParticipationDates(profileId, reservations, schedules) {
            if (!profileId) return 0;
            const today = new Date().toLocaleDateString('en-CA');
            const dates = new Set();
            (reservations || []).forEach(r => {
                if (Array.isArray(r.participant_ids) && r.participant_ids.includes(profileId) && r.res_date && r.res_date <= today) {
                    dates.add(r.res_date);
                }
            });
            (schedules || []).forEach(s => {
                if (Array.isArray(s.members) && s.members.some(m => m.memberId === profileId) && s.date && s.date <= today) {
                    dates.add(s.date);
                }
            });
            // 일정표 직접 신청 출석 (schedule_attendees) 합산
            // 전역 상태에서 읽되, (1) 과거 날짜만(<= today) (2) 호출자가 넘긴 schedules의
            // 날짜 범위 내(월/년 필터 반영)로 제한 — 미래 신청/타월 집계 inflation 방지
            const scopeDates = new Set((schedules || []).map(s => s.date).filter(Boolean));
            const inScope = (d) => d && d <= today && scopeDates.has(d);
            Object.entries(state.scheduleAttendees || {}).forEach(([d, ids]) => {
                if (inScope(d) && Array.isArray(ids) && ids.includes(profileId)) dates.add(d);
            });
            Object.entries(state.scheduleGroupAttendees || {}).forEach(([d, groups]) => {
                if (inScope(d) && groups && Object.values(groups).some(ids => Array.isArray(ids) && ids.includes(profileId))) dates.add(d);
            });
            Object.entries(state.scheduleSlotAttendees || {}).forEach(([d, slots]) => {
                if (inScope(d) && slots && Object.values(slots).some(ids => Array.isArray(ids) && ids.includes(profileId))) dates.add(d);
            });
            return dates.size;
        }

        function getMyVote(pollId) {
            const myId = getCurrentUserProfileId();
            if (!myId) return null;
            return state.pollVotes.find(v => v.poll_id === pollId && v.voter_id === myId) || null;
        }

        function addPollOption() {
            const titleEl = document.getElementById('pollTitle');
            if (titleEl) state.editingPoll.title = titleEl.value;
            state.editingPoll.options.push('');
            renderAdminPollsSection(document.getElementById('adminPollContent'));
        }

        function removePollOption(idx) {
            if (state.editingPoll.options.length <= 2) { showToast('최소 2개 옵션이 필요합니다.'); return; }
            const titleEl = document.getElementById('pollTitle');
            if (titleEl) state.editingPoll.title = titleEl.value;
            state.editingPoll.options.splice(idx, 1);
            renderAdminPollsSection(document.getElementById('adminPollContent'));
        }

        function updatePollOption(idx, value) {
            state.editingPoll.options[idx] = value;
        }

        async function createPoll() {
            const title = document.getElementById('pollTitle').value.trim();
            const options = state.editingPoll.options.map(o => o.trim()).filter(Boolean);
            const multiSelect = document.getElementById('pollMulti').checked;
            const anonymous = document.getElementById('pollAnon').checked;
            if (!title) { showToast('투표 제목을 입력해주세요.'); return; }
            if (options.length < 2) { showToast('옵션을 2개 이상 입력해주세요.'); return; }
            const creatorName = (state.user && state.user.nickname) || '관리자';
            const { error } = await supabaseClient.from('polls').insert([{
                title, options, multi_select: multiSelect, anonymous, status: 'open',
                created_by: state.user.kakaoId, creator_name: creatorName
            }]);
            if (error) { showToast('투표 생성 실패: ' + error.message); return; }
            state.editingPoll = { options: ['', ''], title: '' };
            await fetchPolls();
            renderAdminPollsSection(document.getElementById('adminPollContent'));
        }

        async function closePoll(pollId) {
            if (!confirm('이 투표를 종료하시겠습니까?')) return;
            const { error } = await supabaseClient.from('polls').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', pollId);
            if (error) { showToast('종료 실패: ' + error.message); return; }
            await fetchPolls();
            renderAdminPollsSection(document.getElementById('adminPollContent'));
        }

        async function reopenPoll(pollId) {
            const { error } = await supabaseClient.from('polls').update({ status: 'open', closed_at: null }).eq('id', pollId);
            if (error) { showToast('재오픈 실패: ' + error.message); return; }
            await fetchPolls();
            renderAdminPollsSection(document.getElementById('adminPollContent'));
        }

        async function deletePoll(pollId) {
            if (!confirm('이 투표를 완전히 삭제하시겠습니까? (모든 투표 결과가 사라집니다)')) return;
            const { error } = await supabaseClient.from('polls').delete().eq('id', pollId);
            if (error) { showToast('삭제 실패: ' + error.message); return; }
            await fetchPolls(); await fetchPollVotes();
            renderAdminPollsSection(document.getElementById('adminPollContent'));
        }

        async function submitVote(pollId) {
            const myId = getCurrentUserProfileId();
            if (!myId) { showToast('가입 승인된 멤버만 투표할 수 있습니다.'); return; }
            const checked = Array.from(document.querySelectorAll(`input[name="vote-${pollId}"]:checked`)).map(el => parseInt(el.value));
            if (checked.length === 0) { showToast('옵션을 선택해주세요.'); return; }
            const poll = state.polls.find(p => p.id === pollId);
            if (!poll) return;
            if (!poll.multi_select && checked.length > 1) { showToast('1개만 선택 가능합니다.'); return; }
            const myName = (state.cachedMembers.find(m => m.id === myId) || {}).name || '익명';
            const existing = getMyVote(pollId);
            let error;
            if (existing) {
                ({ error } = await supabaseClient.from('poll_votes').update({ option_indices: checked, voter_name: myName }).eq('id', existing.id));
            } else {
                ({ error } = await supabaseClient.from('poll_votes').insert([{ poll_id: pollId, voter_id: myId, voter_name: myName, option_indices: checked }]));
            }
            if (error) { showToast('투표 실패: ' + error.message); return; }
            await fetchPollVotes();
            if (state.memberPanelTab === 'votes') renderMemberPanel();
        }

        async function cancelMyVote(pollId) {
            if (!confirm('투표를 취소하시겠습니까?')) return;
            const existing = getMyVote(pollId);
            if (!existing) return;
            const { error } = await supabaseClient.from('poll_votes').delete().eq('id', existing.id);
            if (error) { showToast('취소 실패: ' + error.message); return; }
            await fetchPollVotes();
            if (state.memberPanelTab === 'votes') renderMemberPanel();
        }

        function sharePollKakao(pollId) {
            const poll = state.polls.find(p => p.id === pollId);
            if (!poll) return;
            if (typeof Kakao === 'undefined' || !Kakao.isInitialized()) { showToast('카카오 SDK가 초기화되지 않았습니다.'); return; }
            const siteUrl = window.location.origin + window.location.pathname;
            const optionLines = (poll.options || []).map((o, i) => `  ${i + 1}. ${o}`).join('\n');
            const voteCount = state.pollVotes.filter(v => v.poll_id === pollId).length;
            const modeTag = [poll.multi_select ? '복수 선택 가능' : '단일 선택', poll.anonymous ? '익명' : '기명'].join(' · ');
            const text = [
                '🗳️ [게더올어라운드 투표]',
                '',
                `📊 ${poll.title}`,
                '',
                `📋 선택지 (${(poll.options || []).length}개)`,
                optionLines,
                '',
                `👥 현재 ${voteCount}명 참여 중 · ${modeTag}`,
                '',
                '지금 바로 투표에 참여해보세요! 👇'
            ].join('\n');
            Kakao.Link.sendDefault({ objectType: 'text', text, link: { webUrl: siteUrl, mobileWebUrl: siteUrl } });
        }

        function _kakaoLink(text) {
            if (typeof Kakao === 'undefined' || !Kakao.isInitialized()) { showToast('카카오 SDK가 초기화되지 않았습니다.'); return; }
            const siteUrl = window.location.origin + window.location.pathname;
            Kakao.Link.sendDefault({ objectType: 'text', text, link: { webUrl: siteUrl, mobileWebUrl: siteUrl } });
        }

        function shareLastReservationKakao() {
            const r = state.lastReservation;
            if (!r) return;
            const memberNames = (r.participantIds || [])
                .map(id => (state.cachedMembers.find(m => m.id === id) || {}).name || '')
                .filter(Boolean);
            const membersLine = memberNames.length > 0 ? memberNames.join(', ') : '미정';
            const lines = [
                '🎸 [게더올어라운드 합주 예약]',
                '',
                `📅 일시    ${r.dateStr} ${r.timeStr}`,
                `👤 예약자  ${r.name}`,
                `👥 멤버    ${membersLine}`,
            ];
            if (r.etc) lines.push(`📝 기타    ${r.etc}`);
            lines.push('');
            lines.push('같이 합주해요! 🎵');
            _kakaoLink(lines.join('\n'));
        }

        function notifyAdminReservationKakao() {
            const r = state.lastReservation;
            if (!r) return;
            const memberNames = (r.participantIds || [])
                .map(id => (state.cachedMembers.find(m => m.id === id) || {}).name || '')
                .filter(Boolean);
            const membersLine = memberNames.length > 0 ? memberNames.join(', ') : '미정';
            const now = new Date().toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const lines = [
                '🔔 [GAA 예약 신청 알림]',
                '',
                `📅 일시    ${r.dateStr} ${r.timeStr}`,
                `👤 신청자  ${r.name}`,
                `👥 멤버    ${membersLine}`,
            ];
            if (r.etc) lines.push(`📝 기타    ${r.etc}`);
            lines.push('');
            lines.push(`⏰ 신청 시각: ${now}`);
            lines.push('관리자 페이지에서 확인 후 승인해 주세요!');
            _kakaoLink(lines.join('\n'));
        }

        function notifyAdminSignupKakao(name, instruments) {
            const instLine = instruments ? `🎵 세션    ${instruments}` : '';
            const now = new Date().toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const lines = [
                '🙋 [GAA 가입 신청 알림]',
                '',
                `👤 신청자  ${name}`,
            ];
            if (instLine) lines.push(instLine);
            lines.push('');
            lines.push(`⏰ 신청 시각: ${now}`);
            lines.push('관리자 페이지에서 확인 후 승인해 주세요!');
            _kakaoLink(lines.join('\n'));
        }

        // ── Web Push Notifications ──────────────────────────────────────────
        let _swReg = null;

        async function initServiceWorker() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
            try {
                _swReg = await navigator.serviceWorker.register('/sw.js');
            } catch (e) { console.warn('SW registration failed', e); }
        }

        // ── PWA 앱 설치 안내 배너 ────────────────────────────────────────────
        let _deferredInstallPrompt = null;
        const INSTALL_DISMISS_KEY = 'gaa_install_dismissed';

        function _isStandalone() {
            return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        }
        function _isIOS() {
            const ua = navigator.userAgent || '';
            if (/iphone|ipad|ipod/i.test(ua) && !window.MSStream) return true;
            return /macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1; // iPadOS 13+ 는 Mac Safari UA 로 보인다
        }
        // iOS 에서 Safari 인가 (Chrome·Firefox·Edge·Opera 는 각자 UA 표식이 있다) — 인앱은 _isInAppBrowser 가 먼저 걸러낸다
        function _isIOSSafari() {
            return _isIOS() && !/crios|fxios|edgios|opr\/|opt\/|yabrowser|duckduckgo/i.test(navigator.userAgent || '');
        }
        function _isAndroid() {
            return /android/i.test(navigator.userAgent);
        }
        // 카카오톡/인스타/페북/네이버/라인 등 인앱 브라우저(WebView) 감지 — PWA 설치 불가
        function _isInAppBrowser() {
            const ua = (navigator.userAgent || '').toLowerCase();
            return /kakaotalk|instagram|fban|fbav|fb_iab|line\/|naver\(inapp|daumapps|everytimeapp|band\//.test(ua);
        }

        // Android/Chrome: 설치 가능 시점에 이벤트 발생
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            _deferredInstallPrompt = e;
            maybeShowInstallBanner();
        });
        window.addEventListener('appinstalled', () => {
            _deferredInstallPrompt = null;
            const b = document.getElementById('installBanner');
            if (b) b.style.display = 'none';
            try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (_) {}
        });

        // 설치 절차 안내 문구 — 2026-09 기준 최신 OS·브라우저 UI 로 점검
        //  · iOS 26 Safari: 하단 공유 → (목록 아래) 홈 화면에 추가 → 추가. 컴팩트 레이아웃이면 주소창 옆 ··· → 공유.
        //    iOS 26 부터 추가 시트에 '웹 앱으로 열기' 토글이 있다(기본 켜짐). Chrome 등 타 브라우저도 iOS 16.4+ 부터 같은 방식.
        //  · Android Chrome: ⋮ → '홈 화면에 추가' → 팝업에서 '설치'(기존 '앱 설치' 항목은 이렇게 바뀌었다).
        //    삼성 인터넷: 하단 ≡ → 현재 페이지 추가 → 홈 화면 (주소창 설치 아이콘도 가능).
        const _SHARE_ICON = '<svg class="ig-ico" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="공유"><path d="M12 3v14"/><path d="M7 8l5-5 5 5"/><path d="M8 12H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V13a1 1 0 0 0-1-1h-3"/></svg>';
        function _installGuideHTML(kind) {
            const step = (mark, html) => `<div class="ig-step">${mark} ${html}</div>`;
            if (kind === 'ios-safari') {
                return step('①', `Safari 아래쪽 <strong>공유</strong> ${_SHARE_ICON} 버튼을 누르세요. <span class="ig-sub">(주소창 옆 <strong>···</strong> 메뉴만 보이면 ··· → 공유)</span>`)
                    + step('②', `목록을 아래로 내려 <strong>홈 화면에 추가</strong>를 선택하세요.`)
                    + step('③', `오른쪽 위 <strong>추가</strong>를 누르세요. <span class="ig-sub">(‘웹 앱으로 열기’는 켠 채로)</span>`);
            }
            if (kind === 'ios-other') {
                return step('①', `주소창 옆 <strong>⋮</strong> 메뉴(또는 공유 ${_SHARE_ICON} 버튼) → <strong>공유</strong>를 누르세요.`)
                    + step('②', `<strong>홈 화면에 추가</strong>를 선택한 뒤 오른쪽 위 <strong>추가</strong>를 누르세요.`)
                    + `<div class="ig-step ig-sub">항목이 안 보이면 이 주소를 <strong>Safari</strong>에서 열어 진행해 주세요.</div>`;
            }
            return step('•', `<strong>Chrome</strong>: 오른쪽 위 <strong>⋮</strong> 메뉴 → <strong>홈 화면에 추가</strong> → <strong>설치</strong>`)
                + step('•', `<strong>삼성 인터넷</strong>: 아래 <strong>≡</strong> 메뉴 → <strong>현재 페이지 추가</strong> → <strong>홈 화면</strong> <span class="ig-sub">(주소창의 설치 아이콘도 돼요)</span>`);
        }

        function maybeShowInstallBanner() {
            if (_isStandalone()) return;                 // 이미 설치/실행 중
            try { if (localStorage.getItem(INSTALL_DISMISS_KEY)) return; } catch (_) {}
            const banner = document.getElementById('installBanner');
            if (!banner) return;
            const title = document.getElementById('installBannerTitle');
            const desc = document.getElementById('installBannerDesc');
            const iosGuide = document.getElementById('installBannerIosGuide');
            const androidGuide = document.getElementById('installBannerAndroidGuide');
            const actions = document.getElementById('installBannerActions');
            const inappBtn = document.getElementById('installBannerInappBtn');
            const inappGuide = document.getElementById('installBannerInappGuide');
            // 모든 보조 섹션 초기화
            [iosGuide, androidGuide, actions, inappBtn, inappGuide].forEach(el => { if (el) el.style.display = 'none'; });
            if (title) title.textContent = '앱으로 설치하기';
            if (desc) desc.textContent = '홈 화면에 추가해 앱처럼 빠르게 이용하세요.';

            if (_isInAppBrowser()) {
                // 카카오톡 등 인앱 브라우저 → 설치 불가, 기본 브라우저로 유도
                if (title) title.textContent = '기본 브라우저에서 열어주세요';
                if (desc) desc.textContent = '카카오톡 등 앱 안에서는 설치할 수 없어요.';
                // Android는 외부 브라우저 강제 호출 가능, iOS는 수동 안내
                if (_isAndroid()) { if (inappBtn) inappBtn.style.display = 'block'; }
                else { if (inappGuide) inappGuide.style.display = 'block'; }
                banner.style.display = 'block';
            } else if (_isIOS()) {
                // iOS 는 beforeinstallprompt 가 없다 → 브라우저별 홈 화면 추가 수동 안내
                if (iosGuide) { iosGuide.innerHTML = _installGuideHTML(_isIOSSafari() ? 'ios-safari' : 'ios-other'); iosGuide.style.display = 'block'; }
                banner.style.display = 'block';
            } else if (_deferredInstallPrompt) {
                if (actions) actions.style.display = 'block';
                banner.style.display = 'block';
            } else if (_isAndroid()) {
                // 설치 이벤트가 아직/전혀 없는 안드로이드(삼성 인터넷·Firefox 등) → 메뉴 경로 수동 안내.
                // 이벤트가 나중에 오면 beforeinstallprompt 핸들러가 다시 그려 [설치하기] 버튼으로 바뀐다.
                if (androidGuide) { androidGuide.innerHTML = _installGuideHTML('android'); androidGuide.style.display = 'block'; }
                banner.style.display = 'block';
            }
        }

        function openInExternalBrowser() {
            const url = location.href;
            const ua = (navigator.userAgent || '').toLowerCase();
            if (_isAndroid()) {
                if (ua.includes('kakaotalk')) {
                    // 카카오톡 전용 스킴 — 외부(기본) 브라우저로 열기
                    location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
                    return;
                }
                // 그 외 안드로이드 인앱 → Chrome intent로 열기
                const noScheme = url.replace(/^https?:\/\//, '');
                location.href = 'intent://' + noScheme + '#Intent;scheme=https;package=com.android.chrome;end';
                return;
            }
            // iOS 등은 프로그래밍 방식 강제 불가 → 안내 노출
            const inappGuide = document.getElementById('installBannerInappGuide');
            if (inappGuide) inappGuide.style.display = 'block';
        }

        async function triggerInstall() {
            if (!_deferredInstallPrompt) return;
            _deferredInstallPrompt.prompt();
            try { await _deferredInstallPrompt.userChoice; } catch (_) {}
            _deferredInstallPrompt = null;
            const b = document.getElementById('installBanner');
            if (b) b.style.display = 'none';
        }

        function dismissInstallBanner() {
            const b = document.getElementById('installBanner');
            if (b) b.style.display = 'none';
            try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (_) {}
        }

        function initInstallBanner() {
            // iOS·인앱 브라우저는 beforeinstallprompt 이벤트가 없으므로 로드 시 직접 판단(첫 화면 안정화 후).
            // 안드로이드는 이벤트를 조금 기다렸다가(Chrome 은 보통 수 초 안에 준다) 없으면 수동 안내로.
            if (_isIOS() || _isInAppBrowser()) setTimeout(maybeShowInstallBanner, 1200);
            else if (_isAndroid()) setTimeout(maybeShowInstallBanner, 3000);
        }

        async function getAdminPushSubscriptions() {
            if (!supabaseClient) return [];
            const { data } = await supabaseClient
                .from('profiles')
                .select('push_subscription')
                .in('role', ['운영 총괄', '총괄', '세션장'])
                .not('push_subscription', 'is', null);
            return (data || []).map(r => r.push_subscription).filter(Boolean);
        }

        async function sendAdminPush(title, body, opts = {}) { // opts.roles: 수신 역할 좁히기(예: ['운영 총괄'])
            // ⚠️ 반드시 "릴레이 우선 + 직접 발송 폴백" 하이브리드 유지할 것 (둘 중 하나만 쓰지 말 것).
            //  - 릴레이(/notify-admins)는 service role 로 '모든' 관리자에게 발송 → 커버리지 완전.
            //    (직접 발송은 호출자 RLS 로 읽히는 일부 관리자만 도달 → 운영총괄 등이 누락됨.
            //     이 때문에 로그인 멤버의 예약 알림이 운영총괄에게 안 오던 버그가 있었음. 2026-07-07)
            //  - 릴레이가 실패(예: Cloudflare SUPABASE_* env 미설정)하면 직접 발송으로 폴백.
            //    (릴레이 단독은 env 없으면 전부 죽으므로 폴백 필수.)
            try {
                const r = await fetch('/notify-admins', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Array.isArray(opts.roles) && opts.roles.length ? { title, body, roles: opts.roles } : { title, body })
                });
                const j = await r.json().catch(() => ({}));
                console.log('[push] notify-admins:', r.status, j);
                if (r.ok && j && j.ok) return; // 릴레이 성공 → 전원 발송 완료
                console.warn('[push] relay failed — falling back to direct send');
            } catch (e) { console.warn('[push] notify-admins error — falling back to direct', e); }
            // 폴백: 클라가 RLS 로 읽을 수 있는 구독으로 직접 발송(커버리지는 제한적)
            try {
                const subs = await getAdminPushSubscriptions();
                console.log('[push] direct fallback subs:', subs.length);
                const results = await Promise.allSettled(subs.map(sub =>
                    fetch('/push', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, body, subscription: sub })
                    }).then(r => r.json())
                ));
                console.log('[push] direct results:', results);
            } catch (e) { console.warn('[push] direct fallback error', e); }
        }

        async function subscribePush() {
            if (!_swReg) { showToast('서비스 워커가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.'); return; }
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') { showToast('알림 권한을 허용해주세요.'); return; }
            try {
                const res = await fetch('/push?key');
                const { key } = await res.json();
                if (!key) { showToast('VAPID 키가 설정되지 않았습니다. Cloudflare 환경 변수를 확인해주세요.', 6000); return; }
                const sub = await _swReg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(key)
                });
                const q = state.user.authType === 'email'
                    ? supabaseClient.from('profiles').update({ push_subscription: sub.toJSON() }).eq('id', state.user.kakaoId)
                    : supabaseClient.from('profiles').update({ push_subscription: sub.toJSON() }).eq('kakao_id', state.user.kakaoId);
                await q;
                showToast('✅ 푸시 알림이 활성화되었습니다.');
                render();
            } catch (e) { showToast('구독 실패: ' + e.message, 5000); }
        }

        async function unsubscribePush() {
            try {
                if (_swReg) {
                    const sub = await _swReg.pushManager.getSubscription();
                    if (sub) await sub.unsubscribe();
                }
                const q2 = state.user.authType === 'email'
                    ? supabaseClient.from('profiles').update({ push_subscription: null }).eq('id', state.user.kakaoId)
                    : supabaseClient.from('profiles').update({ push_subscription: null }).eq('kakao_id', state.user.kakaoId);
                await q2;
                showToast('푸시 알림이 비활성화되었습니다.');
                render();
            } catch (e) { showToast('구독 해제 실패: ' + e.message, 5000); }
        }

        async function getPushSubscriptionStatus() {
            if (!_swReg || !('PushManager' in window)) return 'unsupported';
            const sub = await _swReg.pushManager.getSubscription().catch(() => null);
            return sub ? 'subscribed' : 'unsubscribed';
        }

        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = atob(base64);
            return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
        }

        async function renderAdminPushSection(container) {
            const supported = ('serviceWorker' in navigator) && ('PushManager' in window);
            const status = supported ? await getPushSubscriptionStatus() : 'unsupported';
            const isOn = status === 'subscribed';
            container.innerHTML = `
                <div class="admin-section">
                    <div style="font-size:1rem;font-weight:700;margin-bottom:12px">🔔 브라우저 푸시 알림</div>
                    ${!supported ? `<p style="color:var(--wds-gray-500);font-size:0.88rem">이 브라우저는 푸시 알림을 지원하지 않습니다.</p>` : `
                    <p style="font-size:0.85rem;color:var(--wds-gray-600);margin-bottom:14px">
                        활성화하면 새 예약 신청, 가입 신청 시 이 기기로 푸시 알림을 받을 수 있습니다.<br>
                        <span style="color:var(--wds-gray-400);font-size:0.78rem">※ 브라우저/탭이 닫혀있어도 알림이 옵니다 (Service Worker 기반)</span>
                    </p>
                    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                        <span style="font-size:0.9rem;font-weight:600">현재 상태: ${isOn
                            ? '<span style="color:#16a34a">🟢 활성화됨</span>'
                            : '<span style="color:var(--wds-gray-400)">⚪ 비활성화</span>'}
                        </span>
                        ${isOn
                            ? `<button class="gaa-btn gaa-btn-sm gaa-btn-secondary" type="button" onclick="unsubscribePush()">알림 끄기</button>`
                            : `<button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="subscribePush()">알림 켜기</button>`
                        }
                        ${isOn ? `<button class="gaa-btn gaa-btn-sm gaa-btn-secondary" type="button" onclick="testPush()">테스트 알림</button>` : ''}
                    </div>
                    <div style="margin-top:16px;padding:12px;background:var(--wds-gray-100);border-radius:var(--wds-radius-s);font-size:0.78rem;color:var(--wds-gray-500)">
                        💡 <strong style="color:var(--wds-gray-700)">최초 설정 가이드</strong><br>
                        1. 아래 버튼으로 VAPID 키 생성<br>
                        2. Cloudflare Pages → Settings → 환경변수에 <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code>, <code>VAPID_SUBJECT</code> 설정<br>
                        3. Supabase SQL 에디터에서 실행: <code>ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_subscription jsonb;</code><br>
                        <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="margin-top:8px" type="button" onclick="generateVapidKeys()">VAPID 키 생성</button>
                    </div>
                    `}
                </div>`;
        }

        async function testPush() {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = '전송 중...';
            try {
                const subs = await getAdminPushSubscriptions();
                if (!subs.length) { showToast('저장된 구독 정보가 없습니다. Supabase profiles 테이블에서 push_subscription 컬럼이 있는지, 값이 저장됐는지 확인해주세요.', 6000); return; }
                const results = await Promise.allSettled(subs.map(async sub => {
                    const r = await fetch('/push', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: '🔔 테스트 알림', body: '푸시 알림이 정상 작동합니다!', subscription: sub })
                    });
                    const text = await r.text();
                    return { httpStatus: r.status, contentType: r.headers.get('content-type') || '', body: text };
                }));
                const msgs = results.map((r, i) => {
                    if (r.status !== 'fulfilled') return `구독${i+1}: ❌ ${r.reason?.message || r.reason}`;
                    const { httpStatus, contentType, body } = r.value;
                    return `구독${i+1}: HTTP ${httpStatus} · ${contentType}\n${body.slice(0, 300)}`;
                }).join('\n\n');
                gtSheetOpen(`푸시 테스트 결과 · ${subs.length}개 구독`, `<div style="white-space:pre-wrap;font-size:0.86rem;line-height:1.6;word-break:break-all">${escapeHtml(msgs)}</div>`);
            } catch (e) {
                showToast('오류: ' + e.message, 5000);
            } finally {
                btn.disabled = false;
                btn.textContent = '테스트 알림';
            }
        }

        async function generateVapidKeys() {
            const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
            const pub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
            const priv = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
            const toB64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            const pubB64 = toB64url(pub);
            const privB64 = toB64url(priv);
            alert(`VAPID 키 생성 완료!\n\nCLOUDFLARE 환경변수에 설정하세요:\n\nVAPID_PUBLIC_KEY:\n${pubB64}\n\nVAPID_PRIVATE_KEY:\n${privB64}\n\nVAPID_SUBJECT:\nmailto:admin@example.com\n\n(이 창을 닫기 전에 복사하세요)`);
        }

        // ── 운영안내 문서 ─────────────────────────────────────────────────
        async function fetchDocs() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient.from('documents').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true });
            if (!error) state.docs = data || [];
        }

        function renderMarkdown(md) {
            if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
                // CDN 미로드: 편집기가 저장한 HTML 은 최소 살균으로 그대로, 평문은 이스케이프 + 줄바꿈
                if (/^\s*<[a-z]/i.test(md || '')) return _htmlSanitizeFallback(md);
                return (md || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
            }
            return DOMPurify.sanitize(marked.parse(md || '', { breaks: true, gfm: true }));
        }

        // ── 문서 서식 편집기 (블로그형) ───────────────────────────────
        // 저장 형식은 그대로 마크다운 컬럼(content)을 쓰되 HTML을 담는다.
        // 표시 경로가 renderMarkdown = DOMPurify(marked.parse(...))라 마크다운/HTML 둘 다
        // 처리되므로, 기존 마크다운 문서도 편집기에서 열면 서식으로 보이고 그대로 저장된다.
        function docEditorHTML(id, initialHtml, placeholder, opts = {}) { // opts.image: 🖼 사진 버튼(커뮤니티 이미지 버킷에 올려 본문에 삽입)
            const b = (label, cmd, val, title, extra) =>
                `<button type="button" class="rte-btn" title="${title}" onmousedown="event.preventDefault()" onclick="rteExec('${id}','${cmd}'${val ? ",'" + val + "'" : ''})"${extra || ''}>${label}</button>`;
            return `
                <div class="rte-wrap" id="rte-wrap-${id}">
                    <div class="rte-toolbar">
                        ${b('<strong>B</strong>', 'bold', '', '굵게')}
                        ${b('<em>I</em>', 'italic', '', '기울임')}
                        ${b('<u>U</u>', 'underline', '', '밑줄')}
                        ${b('<s>S</s>', 'strikeThrough', '', '취소선')}
                        <div class="rte-sep"></div>
                        ${b('제목', 'formatBlock', 'h1', '제목(가장 큼)')}
                        ${b('큰제목', 'formatBlock', 'h2', '큰 제목')}
                        ${b('소제목', 'formatBlock', 'h3', '소제목')}
                        ${b('본문', 'formatBlock', 'p', '본문')}
                        <select class="rte-size" title="글자 크기" onmousedown="event.stopPropagation()" onchange="rteFontSize('${id}', this.value); this.value=''">
                            <option value="">글자 크기</option><option value="0.85em">작게</option><option value="1em">보통</option><option value="1.2em">크게</option><option value="1.45em">아주 크게</option><option value="1.8em">최대</option>
                        </select>
                        <div class="rte-sep"></div>
                        ${b('• 목록', 'insertUnorderedList', '', '글머리 기호')}
                        ${b('1. 목록', 'insertOrderedList', '', '번호 매기기')}
                        ${b('❝ 인용', 'formatBlock', 'blockquote', '인용구')}
                        <div class="rte-sep"></div>
                        ${b('☰', 'justifyLeft', '', '왼쪽 정렬')}
                        ${b('☰', 'justifyCenter', '', '가운데 정렬')}
                        <div class="rte-sep"></div>
                        <button type="button" class="rte-btn" title="링크" onmousedown="event.preventDefault()" onclick="rteLink('${id}')">🔗</button>
                        ${opts.image ? `<button type="button" class="rte-btn" title="사진 넣기" onmousedown="event.preventDefault()" onclick="rteImage('${id}')">🖼</button>` : ''}
                        ${b('─', 'insertHorizontalRule', '', '구분선')}
                        ${b('✕서식', 'removeFormat', '', '서식 지우기')}
                    </div>
                    <div class="rte-body" id="${id}" contenteditable="true" data-placeholder="${escapeHtml(placeholder || '내용을 입력하세요')}">${initialHtml || ''}</div>
                </div>`;
        }

        function rteExec(id, cmd, val) {
            const el = document.getElementById(id);
            if (!el) return;
            el.focus();
            try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
            // 같은 블록 서식을 다시 누르면 본문으로 되돌린다 (토글)
            if (cmd === 'formatBlock' && val !== 'p') {
                const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
                if (cur === val) val = 'p';
            }
            document.execCommand(cmd, false, val || null);
        }

        // 글자 크기(2026-10-21): execCommand('fontSize', 7) 가 남기는 <font size="7"> 을 <span style="font-size:…"> 로 바꾼다(<font> 는 저장하지 않음)
        function rteFontSize(id, em) {
            const el = document.getElementById(id); if (!el || !em) return;
            el.focus();
            try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
            document.execCommand('fontSize', false, '7');
            el.querySelectorAll('font[size="7"]').forEach(f => {
                const sp = document.createElement('span');
                sp.style.fontSize = em; // '1em' = 보통(상속 크기) — 저장 시 _rteScrubStyles 가 font-size 만 남긴다
                while (f.firstChild) sp.appendChild(f.firstChild);
                f.replaceWith(sp);
            });
        }
        // 저장 전 인라인 style 정리: font-size·text-align 만 남긴다 — 붙여넣기로 딸려온 color/background 는 다크 모드에서 고정 색으로 남아 보기 흉하다(2026-10-21)
        function _rteScrubStyles(html) {
            try {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                doc.body.querySelectorAll('[style]').forEach(n => {
                    const fs = n.style.fontSize, ta = n.style.textAlign;
                    n.removeAttribute('style');
                    if (fs) n.style.fontSize = fs;
                    if (ta) n.style.textAlign = ta;
                    if (!n.getAttribute('style')) n.removeAttribute('style');
                });
                doc.body.querySelectorAll('font').forEach(f => { const sp = doc.createElement('span'); while (f.firstChild) sp.appendChild(f.firstChild); f.replaceWith(sp); });
                doc.body.querySelectorAll('[color],[bgcolor]').forEach(n => { n.removeAttribute('color'); n.removeAttribute('bgcolor'); });
                return doc.body.innerHTML;
            } catch (_) { return html; }
        }

        function rteLink(id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.focus();
            const sel = window.getSelection();
            const hasSel = sel && String(sel).trim().length > 0;
            const url = prompt('연결할 주소를 입력하세요 (예: https://...)');
            if (!url) return;
            const safe = /^(https?:|mailto:)/i.test(url) ? url : 'https://' + url.replace(/^\/+/, '');
            if (hasSel) document.execCommand('createLink', false, safe);
            else document.execCommand('insertHTML', false,
                `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener">${escapeHtml(safe)}</a>`);
        }

        // 🖼 사진 넣기 — 파일 선택 → 긴 변 1600px JPEG 로 줄여 community-images 에 올리고 커서 자리에 <img>
        function rteImage(id) {
            const el = document.getElementById(id); if (!el) return;
            const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = async () => {
                const f = inp.files && inp.files[0]; if (!f) return;
                el.focus();
                try { document.execCommand('insertHTML', false, '<p class="rte-uploading">🖼 사진 올리는 중…</p>'); } catch (_) {}
                try {
                    const url = await uploadCommunityImage(await _rteShrink(f));
                    const html = `<p><img src="${escapeHtml(url)}" alt=""></p>`;
                    const ph = el.querySelector('.rte-uploading');
                    if (ph) ph.outerHTML = html; else el.insertAdjacentHTML('beforeend', html);
                } catch (e) {
                    el.querySelector('.rte-uploading')?.remove();
                    console.error('rteImage:', e); showToast('사진을 올리지 못했습니다. 잠시 후 다시 시도해주세요.');
                }
            };
            inp.click();
        }
        async function _rteShrink(file, max = 1600) {
            if (!/^image\//.test(file.type)) throw new Error('이미지 파일만 넣을 수 있습니다.');
            const bmp = await createImageBitmap(file).catch(() => null);
            if (!bmp) return file;
            const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
            if (s === 1 && file.size < 400 * 1024) return file;
            const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
            return new File([blob], 'desc.jpg', { type: 'image/jpeg' });
        }

        // 편집기 내용을 저장용으로 정리 — 저장 시점에도 한 번 살균한다(표시 경로와 이중 방어).
        // 문서 본문(마크다운 또는 HTML)에서 태그를 걷어낸 순수 텍스트 — 목록 미리보기용
        function docPlainText(content) {
            const t = document.createElement('div');
            // 블록 경계에 공백을 넣지 않으면 textContent가 "소제목굵게 본문"처럼 단어를 붙여버린다
            t.innerHTML = renderMarkdown(content || '').replace(/<\/(p|h[1-6]|li|div|blockquote|tr)>|<br\s*\/?>/gi, ' ');
            return (t.textContent || '').replace(/\s+/g, ' ').trim();
        }

        function rteValue(id) {
            const el = document.getElementById(id);
            if (!el) return '';
            const raw = el.innerHTML.trim();
            if (!raw || raw === '<br>' || !el.textContent.trim()) return '';
            const clean = _rteScrubStyles(raw);
            if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(clean);
            // DOMPurify 미로드(CDN 지연·차단) 시에도 위험 요소는 남기지 않는다.
            // 표시 경로에도 폴백 이스케이프가 있지만, 애초에 저장하지 않는 편이 안전하다.
            return _htmlSanitizeFallback(clean);
        }
        // DOMPurify 없이 쓰는 최소 살균(저장·표시 공용): 위험 태그 제거, on* 속성·javascript: 주소 제거
        function _htmlSanitizeFallback(raw) {
            const doc = new DOMParser().parseFromString(raw, 'text/html');
            doc.body.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(n => n.remove());
            doc.body.querySelectorAll('*').forEach(n => {
                [...n.attributes].forEach(a => {
                    const name = a.name.toLowerCase();
                    if (name.startsWith('on')) n.removeAttribute(a.name);
                    else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
                });
            });
            return doc.body.innerHTML;
        }

        function renderDocsPage(container) {
            const docs = state.docs || [];
            const isAdmin = canApproveRes();
            if (!docs.length) {
                container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wds-gray-500);font-size:0.9rem">등록된 운영 안내가 없습니다.</div>'
                    + (isAdmin ? `<div style="text-align:center"><button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="quickAddDoc()">+ 새 문서 추가</button></div>` : '');
                return;
            }
            const categories = [];
            docs.forEach(d => { if (d.category && !categories.includes(d.category)) categories.push(d.category); });
            const selectedCat = state.docsCategory && categories.includes(state.docsCategory) ? state.docsCategory : categories[0];

            const catTabs = categories.map(c => {
                const safeCat = c.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                return `<button type="button" class="docs-cat-tab${c === selectedCat ? ' active' : ''}" onclick="state.docsCategory='${safeCat}';render()">${escapeHtml(c)}</button>`;
            }).join('');

            const filtered = docs.filter(d => d.category === selectedCat);
            const cards = filtered.map(d => {
                const safeC = (d.category||'').replace(/"/g,'&quot;');
                const safeT = (d.title||'').replace(/"/g,'&quot;');
                const adminBar = isAdmin ? `
                    <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
                        <button class="gaa-btn gaa-btn-xs gaa-btn-primary" type="button" onclick="toggleDocEdit('${d.id}')">수정</button>
                        <button class="gaa-btn gaa-btn-xs gaa-btn-danger" type="button" onclick="deleteDoc('${d.id}')">삭제</button>
                    </div>` : '';
                const editBlock = isAdmin ? `
                    <div class="doc-edit-${d.id}" style="display:none">
                        <input id="doc-edit-cat-${d.id}" type="text" value="${safeC}" placeholder="카테고리" style="width:100%;margin-bottom:6px;padding:8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.85rem;box-sizing:border-box">
                        <input id="doc-edit-title-${d.id}" type="text" value="${safeT}" placeholder="제목" style="width:100%;margin-bottom:6px;padding:8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;box-sizing:border-box">
                        <input id="doc-edit-summary-${d.id}" type="text" value="${(d.summary||'').replace(/"/g,'&quot;')}" placeholder="간단 요약 (제목 옆에 작은 글씨로 표시)" style="width:100%;margin-bottom:6px;padding:8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.85rem;box-sizing:border-box">
                        <div style="margin-bottom:8px">${docEditorHTML('doc-edit-content-' + d.id, renderMarkdown(d.content), '내용을 입력하세요')}</div>
                        <div style="display:flex;gap:6px;justify-content:flex-end">
                            <button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="updateDoc('${d.id}')">저장</button>
                            <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" type="button" onclick="toggleDocEdit('${d.id}')">취소</button>
                        </div>
                    </div>` : '';
                return `
                <div class="docs-card collapsed" id="docs-card-${d.id}">
                    <div class="doc-view-${d.id}">
                        <div class="docs-card-title" onclick="toggleDocsCard('${d.id}')"><span class="docs-toggle-icon">▼</span><span style="flex:1">${escapeHtml(d.title)}</span>${d.summary ? `<span style="font-size:0.72rem;font-weight:400;color:var(--wds-gray-400);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;flex-shrink:1">${escapeHtml(d.summary)}</span>` : ''}</div>
                        <div class="docs-card-body">
                            <div class="docs-card-content">${renderMarkdown(d.content)}</div>
                            ${adminBar}
                        </div>
                    </div>
                    ${editBlock}
                </div>`;
            }).join('');

            const addBtn = isAdmin ? `<div style="text-align:right;margin-top:16px"><button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="quickAddDoc()">+ 새 문서 추가</button></div>` : '';
            container.innerHTML = `
                <div class="docs-categories">${catTabs}</div>
                <div class="docs-list">${cards}</div>
                ${addBtn}
            `;
        }

        async function quickAddDoc() {
            // 2026-11-09 QA: prompt 3번(모바일에서 불편·서식 없음) 대신 관리자 › 문서관리의 편집기로 보낸다
            if (!isAdminUser()) return;
            state.adminTab = 'docs';
            setGatheOTab('admin');
            renderGatheOAdmin();
            gtFocus('#newDocTitle', { focus: '#newDocTitle', flash: true });
        }

        function renderAdminDocsSection(container) {
            const docs = state.docs || [];
            const grouped = {};
            const catOrder = [];
            docs.forEach(d => {
                const c = d.category || '(미분류)';
                if (!(c in grouped)) { grouped[c] = []; catOrder.push(c); }
                grouped[c].push(d);
            });

            const datalistOptions = catOrder.map(c => `<option value="${escapeHtml(c)}">`).join('');

            const groupedHtml = catOrder.map(cat => `
                <div style="margin-bottom:16px">
                    <div style="font-weight:700;margin-bottom:8px;color:var(--wds-gray-700);font-size:0.92rem">📂 ${escapeHtml(cat)}</div>
                    ${grouped[cat].map(d => {
                        const safeC = (d.category||'').replace(/"/g,'&quot;');
                        const safeT = (d.title||'').replace(/"/g,'&quot;');
                        // 본문에 HTML 서식이 들어가므로 미리보기는 태그를 제거한 순수 텍스트로
                        const preview = docPlainText(d.content).slice(0, 120);
                        return `<div class="my-res-item" style="margin-bottom:6px" id="doc-row-${d.id}">
                            <div class="doc-view-${d.id}">
                                <div style="margin-bottom:4px"><strong>${escapeHtml(d.title)}</strong></div>
                                <div style="font-size:0.78rem;color:var(--wds-gray-500);margin-bottom:6px">${escapeHtml(preview)}${docPlainText(d.content).length > 120 ? '...' : ''}</div>
                                <div style="display:flex;gap:6px">
                                    <button class="gaa-btn gaa-btn-xs gaa-btn-primary" type="button" onclick="toggleDocEdit('${d.id}')">수정</button>
                                    <button class="gaa-btn gaa-btn-xs gaa-btn-danger" type="button" onclick="deleteDoc('${d.id}')">삭제</button>
                                </div>
                            </div>
                            <div class="doc-edit-${d.id}" style="display:none">
                                <input id="doc-edit-cat-${d.id}" type="text" value="${safeC}" placeholder="카테고리" list="docCategoriesList" style="width:100%;margin-bottom:4px;padding:6px 8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.85rem;box-sizing:border-box">
                                <input id="doc-edit-title-${d.id}" type="text" value="${safeT}" placeholder="제목" style="width:100%;margin-bottom:4px;padding:6px 8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;box-sizing:border-box">
                                <input id="doc-edit-summary-${d.id}" type="text" value="${(d.summary||'').replace(/"/g,'&quot;')}" placeholder="간단 요약 (제목 옆 작은 글씨)" style="width:100%;margin-bottom:4px;padding:6px 8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.85rem;box-sizing:border-box">
                                <div style="margin-bottom:6px">${docEditorHTML('doc-edit-content-' + d.id, renderMarkdown(d.content), '내용을 입력하세요')}</div>
                                <div style="display:flex;gap:6px">
                                    <button class="gaa-btn gaa-btn-xs gaa-btn-primary" type="button" onclick="updateDoc('${d.id}')">저장</button>
                                    <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="toggleDocEdit('${d.id}')">취소</button>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            `).join('');

            container.innerHTML = `
                <div class="admin-section">
                    <div style="font-size:1rem;font-weight:700;margin-bottom:12px">📖 운영안내 문서 관리</div>
                    <datalist id="docCategoriesList">${datalistOptions}</datalist>

                    <div style="margin-bottom:16px;padding:12px;background:var(--wds-gray-100);border-radius:var(--wds-radius-s)">
                        <div style="font-weight:600;margin-bottom:8px;font-size:0.9rem">새 문서 추가</div>
                        <input id="newDocCategory" type="text" placeholder="카테고리 (예: 운영규칙, FAQ, 멤버가이드)" list="docCategoriesList" style="width:100%;margin-bottom:6px;padding:6px 8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;box-sizing:border-box">
                        <input id="newDocTitle" type="text" placeholder="제목" style="width:100%;margin-bottom:6px;padding:6px 8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;box-sizing:border-box">
                        <input id="newDocSummary" type="text" placeholder="간단 요약 (제목 옆에 작은 글씨로 표시, 선택)" style="width:100%;margin-bottom:6px;padding:6px 8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;box-sizing:border-box">
                        <div style="margin-bottom:8px">${docEditorHTML('newDocContent', '', '내용을 입력하세요. 위 버튼으로 굵게·제목·목록·링크 등을 지정할 수 있습니다.')}</div>
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="addDoc()">추가</button>
                    </div>

                    ${groupedHtml || '<p style="color:var(--wds-gray-500);font-size:0.9rem">등록된 문서가 없습니다.</p>'}

                </div>`;
        }

        async function addDoc() {
            const category = document.getElementById('newDocCategory').value.trim();
            const title = document.getElementById('newDocTitle').value.trim();
            const summary = (document.getElementById('newDocSummary')?.value || '').trim();
            const content = rteValue('newDocContent');
            if (!category || !title || !content) { showToast('카테고리/제목/내용을 모두 입력해주세요.'); return; }
            const { error } = await supabaseClient.from('documents').insert([{ category, title, summary, content }]);
            if (error) { showToast('추가 실패: ' + error.message, 5000); return; }
            document.getElementById('newDocCategory').value = '';
            document.getElementById('newDocTitle').value = '';
            const sumEl = document.getElementById('newDocSummary');
            if (sumEl) sumEl.value = '';
            document.getElementById('newDocContent').innerHTML = ''; // contenteditable이라 value가 아니다
            showToast('문서가 추가되었습니다.');
            await refreshDocsViews();
        }

        // 문서 추가/수정/삭제 후 열려 있는 문서 화면들을 최신 데이터로 재렌더.
        // (기존엔 state.currentView === 'admin' 이라는 옛 레이아웃 조건이라 관리자
        // 문서관리 목록이 갱신되지 않았다 — currentView는 예약 달력 뷰 상태다.)
        async function refreshDocsViews() {
            await fetchDocs();
            if (state.gatheoTab === 'admin' && state.adminTab === 'docs') renderGatheOAdmin();
            if (state.memberPanelTab === 'docs') {
                const view = document.getElementById('memberPanelView');
                if (view) renderDocsPage(view);
            }
        }

        function toggleDocsCard(id) {
            const card = document.getElementById(`docs-card-${id}`);
            if (card) card.classList.toggle('collapsed');
        }

        function toggleDocEdit(id) {
            const v = document.querySelector(`.doc-view-${id}`);
            const e = document.querySelector(`.doc-edit-${id}`);
            if (!v || !e) return;
            const editing = e.style.display !== 'none';
            v.style.display = editing ? '' : 'none';
            e.style.display = editing ? 'none' : '';
        }

        async function updateDoc(id) {
            const c = document.getElementById(`doc-edit-cat-${id}`).value.trim();
            const t = document.getElementById(`doc-edit-title-${id}`).value.trim();
            const co = rteValue(`doc-edit-content-${id}`);
            const sumEl = document.getElementById(`doc-edit-summary-${id}`);
            const s = sumEl ? sumEl.value.trim() : '';
            if (!c || !t || !co) { showToast('카테고리/제목/내용 모두 입력해주세요.'); return; }
            const { error } = await supabaseClient.from('documents').update({ category: c, title: t, content: co, summary: s, updated_at: new Date().toISOString() }).eq('id', id);
            if (error) { showToast('수정 실패: ' + error.message, 5000); return; }
            showToast('문서가 수정되었습니다.');
            await refreshDocsViews();
        }

        async function deleteDoc(id) {
            if (!confirm('이 문서를 삭제하시겠습니까?')) return;
            const { error } = await supabaseClient.from('documents').delete().eq('id', id);
            if (error) { showToast('삭제 실패: ' + error.message, 5000); return; }
            showToast('문서가 삭제되었습니다.');
            await refreshDocsViews();
        }
        // ────────────────────────────────────────────────────────────────────

        let _pollsChannel = null;
        function subscribeToPolls() {
            if (!supabaseClient) return;
            if (_pollsChannel) { try { supabaseClient.removeChannel(_pollsChannel); } catch (e) {} _pollsChannel = null; }
            _pollsChannel = supabaseClient.channel('polls-channel')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, async () => {
                    await fetchPolls();
                    updatePollBadges();
                    if (state.adminTab === 'polls' && state.currentView === 'admin') renderAdminPollsSection(document.getElementById('adminPollContent'));
                    if (state.memberPanelTab === 'votes') renderMemberPanel();
                })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, async () => {
                    await fetchPollVotes();
                    if (state.adminTab === 'polls' && state.currentView === 'admin') renderAdminPollsSection(document.getElementById('adminPollContent'));
                    if (state.memberPanelTab === 'votes') renderMemberPanel();
                })
                .subscribe();
        }

        const _memberActionInflight = new Set();

        // participant_etc는 "메모 (N명)" 한 문자열에 메모와 비등록 인원수가 함께 담긴다.
        // 자유 텍스트로 편집하면 "(5 명)"처럼 오타 하나에 인원이 통째로 유실되므로,
        // 편집 시엔 메모/인원을 분리해 다루고 저장할 때 다시 합친다. (예약 폼·멤버 수정 모달과 동일 규칙)
        function splitEtc(raw) {
            const s = String(raw || '');
            const m = s.match(/^(.*?)\s*\((\d+)명\)$/);
            return { text: m ? m[1].trim() : s, count: m ? parseInt(m[2], 10) : 0 };
        }
        function joinEtc(text, count) {
            const t = (text || '').trim();
            const n = Math.max(0, parseInt(count, 10) || 0);
            return n > 0 ? (t ? `${t} (${n}명)` : `(${n}명)`) : t;
        }

        function editResInfo(id) {
            if (String(id).startsWith('perf-')) { showToast('공간 대관 건은 관리자 탭의 🎭 공간대관에서 관리해주세요.'); return; }
            const row = document.getElementById(`admin-res-row-${id}`);
            if (!row) return;
            const { resDate, startTime, endTime, userName, etc } = row.dataset;
            const { text: etcText, count: etcCount } = splitEtc(etc);
            const r = (state.reservations || []).find(x => x.id === id);
            const memberCount = Array.isArray(r && r.participant_ids) ? r.participant_ids.length : 0;
            const memberNames = r ? participantNames(r) : '';
            const timeOpts = TIMES.map(t => `<option value="${t}" ${t===startTime?'selected':''}>${t}</option>`).join('');
            const endOpts  = TIMES.map((t, i) => `<option value="${t}" ${t===endTime?'selected':''}>${TIMES[i+1]||'23:00'}</option>`).join('');
            row.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:8px;padding:6px 0;width:100%">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                        <input id="er-date-${id}" type="date" value="${escapeHtml(resDate)}" style="height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit">
                        <select id="er-start-${id}" style="height:32px;padding:0 6px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit">${timeOpts}</select>
                        <span style="font-size:0.8rem">~</span>
                        <select id="er-end-${id}" style="height:32px;padding:0 6px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit">${endOpts}</select>
                        <input id="er-name-${id}" value="${escapeHtml(userName)}" placeholder="예약자명" style="height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit;flex:1;min-width:80px">
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:var(--wds-gray-100);border:1px solid var(--wds-gray-300);border-radius:6px;padding:7px 9px">
                        <span style="font-size:0.76rem;font-weight:700;color:var(--wds-primary);white-space:nowrap">👥 참여 멤버 ${memberCount}명</span>
                        <span id="er-mnames-${id}" style="font-size:0.74rem;color:var(--wds-gray-700);flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(memberNames) || '(없음)'}</span>
                        <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="white-space:nowrap" type="button" onclick="openEditParticipantsModal('${id}')">멤버 수정</button>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                        <input id="er-etc-${id}" value="${escapeHtml(etcText)}" placeholder="기타 메모 (예: 아워플레이스 예지님)" style="height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit;flex:1;min-width:120px">
                        <span style="font-size:0.76rem;color:var(--wds-gray-700);white-space:nowrap">비등록 인원</span>
                        <input id="er-etccnt-${id}" type="number" min="0" max="30" value="${etcCount}" style="width:62px;height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit">
                        <span style="font-size:0.76rem;color:var(--wds-gray-700)">명</span>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="saveResEdit('${id}')">저장</button>
                        <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="refreshAdminApprovalView()">취소</button>
                    </div>
                </div>`;
        }

        // 예약승인 탭을 최신 데이터로 다시 그린다 (저장/취소 후 라이브 반영용).
        // 관리자 탭이 아닌 화면에서 호출돼도 안전하도록 컨테이너 존재를 확인한다.
        async function refreshAdminApprovalView() {
            await fetchReservations();
            render();
            if (document.getElementById('gatheOTabAdmin') && state.gatheoTab === 'admin') renderGatheOAdmin();
        }

        async function saveResEdit(id) {
            const resDate   = document.getElementById(`er-date-${id}`)?.value.trim();
            const startTime = document.getElementById(`er-start-${id}`)?.value;
            const endTime   = document.getElementById(`er-end-${id}`)?.value;
            const userName  = document.getElementById(`er-name-${id}`)?.value.trim();
            const etcText   = document.getElementById(`er-etc-${id}`)?.value.trim();
            const etcCount  = document.getElementById(`er-etccnt-${id}`)?.value;
            if (!resDate || !startTime || !endTime || !userName) { showToast('날짜·시간·예약자명은 필수입니다.'); return; }
            // 종료 슬롯은 포함형(1시간 예약은 start_time === end_time). 시작이 종료보다 늦을 때만 거부.
            if (TIMES.indexOf(startTime) > TIMES.indexOf(endTime)) { showToast('종료 시간은 시작 시간보다 이후여야 합니다.'); return; }
            const { error } = await supabaseClient.from('reservations')
                .update({ res_date: resDate, start_time: startTime, end_time: endTime, user_name: userName, participant_etc: joinEtc(etcText, etcCount) || null })
                .eq('id', id);
            if (error) { showToast('저장 실패: ' + error.message, 5000); return; }
            showToast('예약이 수정되었습니다.');
            await refreshAdminApprovalView();
        }

        function editMemberInfo(id) {
            const row = document.getElementById(`admin-member-row-${id}`);
            if (!row) return;
            const { name, email, phone, instruments } = row.dataset;
            row.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:8px;padding:6px 0;width:100%">
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                        <input id="em-name-${id}" value="${escapeHtml(name)}" placeholder="이름" style="height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit;flex:1;min-width:80px">
                        <input id="em-phone-${id}" value="${escapeHtml(phone)}" placeholder="전화번호" style="height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit;flex:1;min-width:110px">
                        <input id="em-email-${id}" value="${escapeHtml(email)}" placeholder="이메일" style="height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit;flex:2;min-width:140px">
                    </div>
                    <input id="em-inst-${id}" value="${escapeHtml(instruments)}" placeholder="세션 (쉼표로 구분, 예: 기타, 보컬)" style="height:32px;padding:0 8px;border:1px solid var(--wds-gray-300);border-radius:4px;font-size:0.82rem;font-family:inherit;width:100%;box-sizing:border-box">
                    <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;color:var(--wds-gray-700);min-height:32px;cursor:pointer">
                        <input type="checkbox" id="em-hidden-${id}" ${isHiddenMember((state.allMembers || []).find(x => x.id === id)) ? 'checked' : ''} style="width:18px;height:18px;margin:0">
                        멤버 목록에서 숨김 <span style="color:var(--wds-gray-500)">(중복·옛 계정)</span>
                    </label>
                    <div style="display:flex;gap:6px">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="saveMemberEdit('${id}')">저장</button>
                        <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="cancelMemberEdit()">취소</button>
                    </div>
                </div>`;
        }

        function cancelMemberEdit() {
            const memberList = document.getElementById('memberList');
            if (memberList) renderAdminMemberListEl(memberList);
            else render();
        }

        async function saveMemberEdit(id) {
            const name = document.getElementById(`em-name-${id}`)?.value.trim();
            const phone = document.getElementById(`em-phone-${id}`)?.value.trim();
            const email = document.getElementById(`em-email-${id}`)?.value.trim();
            const instruments = document.getElementById(`em-inst-${id}`)?.value.trim();
            if (!name) { showToast('이름을 입력해주세요.'); return; }
            const hidden = !!document.getElementById(`em-hidden-${id}`)?.checked;
            const cur = (state.allMembers || []).find(x => x.id === id);
            const payload = { name, phone, email, instruments };
            if (!cur || isHiddenMember(cur) !== hidden) payload.hidden = hidden; // 바뀔 때만 보낸다(컬럼 없는 DB 에서도 일반 수정은 그대로)
            let { error } = await supabaseClient.from('profiles').update(payload).eq('id', id);
            if (error && 'hidden' in payload && /hidden/.test(error.message || '')) { // 마이그레이션(20261110_profile_hidden) 전
                delete payload.hidden;
                ({ error } = await supabaseClient.from('profiles').update(payload).eq('id', id));
                if (!error) showToast('숨김 설정은 저장되지 않았습니다. supabase/migrations/20261110_profile_hidden.sql 실행 후 다시 시도해주세요.', 6000);
            }
            if (error) { showToast('저장 실패: ' + error.message, 5000); return; }
            if (cur && 'hidden' in payload) { cur.hidden = hidden; const cm = (state.cachedMembers || []).find(x => x.id === id); if (cm) cm.hidden = hidden; }
            const m = (state.allMembers || []).find(x => x.id === id);
            if (m) { m.name = name; m.phone = phone || ''; m.email = email || ''; m.instruments = instruments || ''; }
            const memberList = document.getElementById('memberList');
            if (memberList) renderAdminMemberListEl(memberList);
            else render();
        }

        async function approveMember(id) {
            if (_memberActionInflight.has(id)) return;
            _memberActionInflight.add(id);
            try {
                const { error } = await supabaseClient.from('profiles').update({ status: 'approved' }).eq('id', id);
                if (error) { showToast('승인 실패: ' + error.message, 5000); return; }
                state.paging.adminMemberPending = 0;
                const fresh = await fetchMembers(); state.allMembers = fresh;
                const el = document.getElementById('memberList');
                if (el) renderAdminMemberListEl(el); else render();
            } finally {
                _memberActionInflight.delete(id);
            }
        }

        async function rejectMember(id) {
            if (_memberActionInflight.has(id)) return;
            if (!confirm('이 회원의 가입을 거절하시겠습니까?')) return;
            _memberActionInflight.add(id);
            try {
                const { error } = await supabaseClient.from('profiles').update({ status: 'rejected' }).eq('id', id);
                if (error) { showToast('거절 실패: ' + error.message, 5000); return; }
                state.paging.adminMemberApproved = 0;
                const fresh = await fetchMembers(); state.allMembers = fresh;
                const el = document.getElementById('memberList');
                if (el) renderAdminMemberListEl(el); else render();
            } finally {
                _memberActionInflight.delete(id);
            }
        }

        async function updateMemberRole(id, role) {
            const { error } = await supabaseClient.from('profiles').update({ role }).eq('id', id);
            if (error) { showToast('권한 변경 실패: ' + error.message, 5000); return; }
            const m = (state.allMembers || []).find(x => x.id === id); if (m) m.role = role;
        }

        // --- 예약 승인/거절 ---
        async function approveReservation(id) {
            const { error } = await supabaseClient.from('reservations').update({ status: 'approved' }).eq('id', id);
            if (error) showToast('승인 실패: ' + error.message);
            else { await fetchReservations(); renderGatheOAdmin(); }
        }

        async function rejectReservation(id) {
            if (!confirm('이 예약을 거절하시겠습니까?')) return;
            const { error } = await supabaseClient.from('reservations').update({ status: 'rejected' }).eq('id', id);
            if (error) showToast('거절 실패: ' + error.message);
            else { await fetchReservations(); renderGatheOAdmin(); }
        }

        // --- 공지사항 ---
        let notices = [];

        async function fetchNotices() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient.from('notices').select('*').order('created_at', { ascending: false });
            if (!error) { notices = data; renderNotices(); gtHomeRefresh(); }
        }

        function renderScheduleBanner() {
            const banner = document.getElementById('schedule_banner');
            if (!banner) return;
            const today = new Date().toLocaleDateString('en-CA');
            const now = new Date();
            const upcoming = (state.schedules || [])
                .filter(s => s.date >= today && s.show_banner
                    && !(s.signup_close && now > new Date(s.signup_close))) // 신청 마감 지나면 배너 제외
                .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time||'').localeCompare(b.start_time||''));
            // Group by date
            const dateMap = {};
            upcoming.forEach(s => {
                if (!dateMap[s.date]) dateMap[s.date] = [];
                dateMap[s.date].push(s);
            });
            const dates = Object.keys(dateMap).sort().slice(0, 2);
            if (dates.length === 0) {
                banner.classList.add('hidden');
                banner.innerHTML = '';
                gtHomeRefresh();
                return;
            }
            const isToday = (d) => d === today;
            const fmtDate = (d) => {
                const [y,m,day] = d.split('-');
                const days = ['일','월','화','수','목','금','토'];
                const dow = new Date(d).getDay();
                return `${parseInt(m)}/${parseInt(day)}(${days[dow]})`;
            };
            const items = dates.map(date => {
                const entries = dateMap[date];
                const groupNames = [...new Set(entries.map(e => e.group_name).filter(Boolean))];
                const timeRange = entries.length > 0 ? `${entries[0].start_time || ''}${entries[entries.length-1].end_time ? ' ~ ' + entries[entries.length-1].end_time : ''}` : '';
                const groupsLabel = groupNames.length > 0
                    ? escapeHtml(groupNames[0])
                    : [...new Set(entries.map(e => e.team_name).filter(Boolean))].slice(0,1).map(g => escapeHtml(g)).join('');
                return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:var(--wds-radius-m);color:#fff;margin-bottom:8px;cursor:pointer" onclick="openScheduleForDate('${date}')">
                    <div style="min-width:0;flex:1">
                        <span style="font-size:0.7rem;font-weight:700;background:rgba(255,255,255,0.25);padding:2px 8px;border-radius:10px;margin-right:8px">${isToday(date)?'오늘':fmtDate(date)}</span>
                        ${groupsLabel ? `<span style="font-size:0.82rem;font-weight:600">${groupsLabel}</span>` : ''}
                        ${timeRange ? `<span style="font-size:0.78rem;opacity:0.85;margin-left:6px">${timeRange}</span>` : ''}
                    </div>
                    <span style="font-size:0.78rem;font-weight:600;background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:8px;flex-shrink:0">보기 →</span>
                </div>`;
            }).join('');
            banner.innerHTML = items;
            gtHomeRefresh(); // 배너 자체는 숨김(홈 카드가 대신) — 데이터 갱신만 홈에 반영
            // 신청 마감 시각이 지나면 새로고침 없이도 자동으로 배너가 내려가도록 주기적 재렌더
            if (!window._scheduleBannerTimer) {
                window._scheduleBannerTimer = setInterval(() => {
                    const b = document.getElementById('schedule_banner');
                    if (!b) return;
                    renderScheduleBanner();
                }, 60000);
            }
        }

        function openScheduleForDate(date) {
            const today = new Date().toLocaleDateString('en-CA');
            state.scheduleFilter = date < today ? 'past' : 'upcoming';
            state.scheduleEditorDate = date;
            setGatheOTab('member');
            setMemberTab('schedule');
            gtFocus('#schedDay-' + date); // 해당 날짜 카드로(2026-10-19) — 일정표가 그려지길 기다렸다가 스크롤·강조
        }

        // 공지는 홈 탭 카드(renderGatheoHome)가 보여준다(2026-10-15). 옛 #notice_container 에 관리자 편집 마크업까지 그리면
        // 관리자 탭 목록과 같은 id(notice-edit-title-…)·클래스(.notice-view-…)가 숨은 채 겹쳐 [수정]이 숨은 쪽을 토글하고 [저장]이
        // 숨은 입력값을 읽는 버그가 있었다 — 여기선 아무것도 그리지 않고 홈만 갱신한다.
        function renderNotices() {
            const container = document.getElementById('notice_container');
            if (container) { container.innerHTML = ''; container.classList.add('hidden'); }
            gtHomeRefresh();
        }

        async function quickAddNotice() {
            const title = prompt('공지 제목');
            if (!title) return;
            const content = prompt('공지 내용');
            if (!content) return;
            const { error } = await supabaseClient.from('notices').insert([{ title: title.trim(), content: content.trim() }]);
            if (error) { showToast('추가 실패: ' + error.message, 5000); return; }
            await fetchNotices();
        }

        function renderAdminNotices() {
            const list = document.getElementById('adminNoticeList');
            if (!list) return;
            if (!notices || notices.length === 0) { list.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.9rem">등록된 공지가 없습니다.</p>'; return; }
            list.innerHTML = notices.map(n => {
                const date = new Date(n.created_at).toLocaleDateString('ko-KR');
                const safeTitle = n.title.replace(/</g,'&lt;').replace(/"/g,'&quot;');
                const safeContent = (n.content||'').replace(/</g,'&lt;').replace(/"/g,'&quot;');
                return `<div class="my-res-item" style="margin-bottom:8px" id="notice-row-${n.id}">
                    <div class="notice-view-${n.id}">
                        <div style="margin-bottom:4px"><strong>${n.title.replace(/</g,'&lt;')}</strong> <span style="font-size:0.8rem;color:var(--wds-gray-500)">${date}</span></div>
                        <div style="font-size:0.85rem;color:var(--wds-gray-600);margin-bottom:6px;white-space:pre-wrap">${(n.content||'').replace(/</g,'&lt;')}</div>
                        <div style="display:flex;gap:6px">
                            <button class="gaa-btn gaa-btn-xs gaa-btn-primary" type="button" onclick="toggleNoticeEdit('${n.id}')">수정</button>
                            <button class="gaa-btn gaa-btn-xs gaa-btn-danger" type="button" onclick="deleteNotice('${n.id}')">삭제</button>
                        </div>
                    </div>
                    <div class="notice-edit-${n.id}" style="display:none">
                        <input id="notice-edit-title-${n.id}" type="text" value="${safeTitle}" style="width:100%;margin-bottom:6px;padding:6px 8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;box-sizing:border-box">
                        <textarea id="notice-edit-content-${n.id}" style="width:100%;height:80px;margin-bottom:6px;padding:6px 8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.85rem;resize:vertical;box-sizing:border-box">${safeContent}</textarea>
                        <div style="display:flex;gap:6px">
                            <button class="gaa-btn gaa-btn-xs gaa-btn-primary" type="button" onclick="updateNotice('${n.id}')">저장</button>
                            <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="toggleNoticeEdit('${n.id}')">취소</button>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        function toggleNoticeEdit(id) {
            const viewEl = document.querySelector(`.notice-view-${id}`);
            const editEl = document.querySelector(`.notice-edit-${id}`);
            if (!viewEl || !editEl) return;
            const isEditing = editEl.style.display !== 'none';
            viewEl.style.display = isEditing ? '' : 'none';
            editEl.style.display = isEditing ? 'none' : '';
        }

        async function updateNotice(id) {
            const titleEl = document.getElementById(`notice-edit-title-${id}`);
            const contentEl = document.getElementById(`notice-edit-content-${id}`);
            const title = titleEl ? titleEl.value.trim() : '';
            const content = contentEl ? contentEl.value.trim() : '';
            if (!title || !content) { showToast('제목과 내용을 입력해주세요.'); return; }
            const { error } = await supabaseClient.from('notices').update({ title, content }).eq('id', id);
            if (error) { showToast('수정 실패: ' + error.message, 5000); return; }
            const idx = notices.findIndex(n => String(n.id) === String(id));
            if (idx !== -1) notices[idx] = { ...notices[idx], title, content };
            renderAdminNotices();
            renderNotices();
        }

        async function postNotice() {
            const title = document.getElementById('noticeTitle').value.trim();
            const content = document.getElementById('noticeContent').value.trim();
            if (!title || !content) { showToast('제목과 내용을 입력해주세요.'); return; }
            const { error } = await supabaseClient.from('notices').insert([{ title, content }]);
            if (error) { showToast('공지 등록 실패: ' + error.message, 5000); return; }
            document.getElementById('noticeTitle').value = '';
            document.getElementById('noticeContent').value = '';
            await fetchNotices();
            renderAdminNotices();
        }

        async function deleteNotice(id) {
            if (!confirm('공지사항을 삭제하시겠습니까?')) return;
            const { error } = await supabaseClient.from('notices').delete().eq('id', id);
            if (error) { showToast('삭제 실패: ' + error.message); return; }
            await fetchNotices();
            renderAdminNotices();
        }

        // --- Comments ---
        async function fetchComments() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient
                .from('comments')
                .select('*')
                .order('created_at', { ascending: false });
            if (!error) { state.comments = data || []; renderComments(data); gtHomeRefresh(); }
        }

        function toggleBoardWriteForm() {
            const form = document.getElementById('boardWriteForm');
            if (form) { const show = form.style.display === 'none'; form.style.display = show ? 'block' : 'none'; }
        }

        function renderComments(comments) {
            const list = document.getElementById('commentList');
            if (!comments || comments.length === 0) {
                list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--wds-gray-400);font-size:0.9rem">아직 게시글이 없습니다. 첫 글을 작성해보세요!</div>';
                return;
            }
            const likedKey = state.user ? 'liked_' + state.user.kakaoId : '';
            const liked = likedKey ? (() => { try { return JSON.parse(localStorage.getItem(likedKey) || '[]'); } catch(e) { return []; } })() : [];

            // 고정 글(관리자가 📌, comments.pinned) 먼저 — 고정한 순(pinned_at) 뒤 최신순
            const parents = comments.filter(c => !c.parent_id).sort((a,b) => {
                const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
                if (pa !== pb) return pb - pa;
                if (pa && pb) return new Date(b.pinned_at || b.created_at) - new Date(a.pinned_at || a.created_at);
                return new Date(b.created_at) - new Date(a.created_at);
            });
            const replyMap = {};
            comments.filter(c => c.parent_id).forEach(c => {
                (replyMap[c.parent_id] = replyMap[c.parent_id] || []).push(c);
            });
            Object.keys(replyMap).forEach(p => replyMap[p].sort((a,b) => new Date(a.created_at) - new Date(b.created_at)));

            // isExpandParent: 접힌 행을 펼친 본문 — 제목·작성자·날짜는 바로 위 행에 이미
            // 보이므로 반복하지 않고, 전체 작성일시만 액션 줄 오른쪽에 작게 표시한다.
            const renderItem = (c, isReply, parentComment, isExpandParent) => {
                const date = new Date(c.created_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                const isMine = state.user && state.user.kakaoId === c.kakao_id;
                const isLiked = liked.includes(String(c.id));
                const likesCount = c.likes || 0;
                let canDelete = false;
                if (state.user) {
                    if (isMine) canDelete = true;
                    else if (!isReply && isSuper()) canDelete = true;
                    else if (isReply && parentComment && state.user.kakaoId === parentComment.kakao_id) canDelete = true;
                    else if (isReply && isSuper()) canDelete = true;
                }
                // 답글은 제목 없음. 게시글은 제목/본문 분리
                const { title, body } = isReply ? { title: '', body: String(c.content || '').replace(/\x1F/g, '') } : parseBoardPost(c.content);
                const titleHtml = (!isReply && !isExpandParent && title) ? `<div class="board-post-title">${escapeHtml(title)}</div>` : '';
                const authorHtml = isExpandParent ? '' : `<div class="comment-author">${_gtAvatarOf(_gtMemberByKakao(c.kakao_id), c.user_name)}<div><div class="comment-author-name">${escapeHtml(c.user_name)}</div><div class="comment-author-date">${date}</div></div></div>`;
                const footDateHtml = isExpandParent ? `<span class="comment-date-foot">${date}</span>` : '';
                const canEdit = isMine && !isReply;
                return `
                    <div class="comment-item${isReply ? ' comment-reply' : ''}" id="comment-wrap-${c.id}">
                        <div style="flex:1;min-width:0">
                            ${authorHtml}
                            <div id="comment-view-${c.id}">
                                ${titleHtml}
                                <div class="comment-content">${escapeHtml(body)}</div>
                            </div>
                            <div id="comment-edit-${c.id}" class="hidden" style="margin-top:6px">
                                <input type="text" id="edit-title-${c.id}" value="${escapeHtml(title)}" placeholder="제목"
                                    style="width:100%;height:38px;padding:0 10px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;font-weight:600;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:6px">
                                <textarea id="edit-body-${c.id}" style="width:100%;min-height:80px;padding:8px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-family:inherit;font-size:0.9rem;resize:vertical;box-sizing:border-box">${escapeHtml(body)}</textarea>
                                <div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end">
                                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" type="button" onclick="cancelEditComment('${c.id}')">취소</button>
                                    <button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="saveEditComment('${c.id}')">저장</button>
                                </div>
                            </div>
                            <div class="comment-actions">
                                <button class="like-btn ${isLiked ? 'liked' : ''}" onclick="likeComment('${c.id}')">${isLiked ? '♥' : '♡'} 좋아요 ${likesCount}</button>
                                ${!isReply ? `<button class="reply-btn" onclick="toggleReplyForm('${c.id}')">답글 달기</button>` : ''}
                                ${canEdit ? `<button class="reply-btn" onclick="startEditComment('${c.id}')">수정</button>` : ''}
                                ${!isReply ? `<button class="reply-btn" onclick="copyBoardPostLink('${c.id}')">🔗 링크 복사</button>` : ''}
                                ${(!isReply && isAdminUser()) ? `<button class="reply-btn" onclick="togglePinComment('${c.id}', ${c.pinned ? 'false' : 'true'})">${c.pinned ? '📌 고정 해제' : '📌 상단 고정'}</button>` : ''}
                                ${footDateHtml}
                            </div>
                            ${!isReply ? `<div id="reply-form-${c.id}" class="reply-form hidden">
                                <textarea id="replyInput-${c.id}" placeholder="답글을 입력하세요..."></textarea>
                                <button type="button" onclick="postReply('${c.id}')">답글 등록</button>
                            </div>` : ''}
                        </div>
                        ${canDelete ? `<button class="comment-delete-btn" onclick="deleteComment('${c.id}')">삭제</button>` : ''}
                    </div>`;
            };

            const rows = parents.map(p => {
                const replies = replyMap[p.id] || [];
                const { title, body } = parseBoardPost(p.content);
                const bodyOneLine = body.replace(/\s+/g, ' ').trim();
                const displayTitle = title || bodyOneLine.slice(0, 40) || '(제목 없음)';
                const shortDate = new Date(p.created_at).toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' });
                return `<div class="board-row-wrap${p.pinned ? ' pinned' : ''}">
                    <div class="board-row" onclick="toggleBoardPost('${p.id}')">
                        <div class="board-row-head">
                            <span class="board-row-chevron" id="board-chevron-${p.id}">▾</span>
                            ${p.pinned ? '<span class="board-row-pin" title="상단 고정">📌</span>' : ''}
                            <span class="board-row-title">${escapeHtml(displayTitle)}</span>
                            ${replies.length>0?`<span class="board-row-replies">답글 ${replies.length}</span>`:''}
                        </div>
                        <div class="board-row-meta">
                            <span class="board-row-author">${escapeHtml(p.user_name)}</span>
                            <span>${shortDate}</span>
                            <span class="board-row-likes">♥ ${p.likes||0}</span>
                        </div>
                    </div>
                    <div id="board-post-${p.id}" class="hidden board-post-expand">
                        ${renderItem(p, false, null, true)}
                        ${replies.length > 0 ? `<div class="reply-toggle" onclick="toggleReplies('${p.id}')"><span id="reply-toggle-text-${p.id}">▾ 답글 ${replies.length}개 보기</span></div><div class="comment-replies hidden" id="replies-${p.id}">${replies.map(r => renderItem(r, true, p)).join('')}</div>` : ''}
                    </div>
                </div>`;
            }).join('');
            list.innerHTML = rows;
        }

        function toggleReplyForm(parentId) {
            const form = document.getElementById('reply-form-' + parentId);
            if (form) form.classList.toggle('hidden');
        }

        function toggleReplies(parentId) {
            const repliesEl = document.getElementById('replies-' + parentId);
            const toggleEl = document.getElementById('reply-toggle-text-' + parentId);
            if (!repliesEl || !toggleEl) return;
            const willHide = !repliesEl.classList.contains('hidden');
            repliesEl.classList.toggle('hidden');
            const count = repliesEl.querySelectorAll('.comment-reply').length;
            toggleEl.textContent = willHide ? `▾ 답글 ${count}개 보기` : `▴ 답글 ${count}개 접기`;
        }

        function toggleBoardPost(id) {
            const el = document.getElementById('board-post-' + id);
            if (el) {
                const opened = el.classList.toggle('hidden') === false;
                const chevron = document.getElementById('board-chevron-' + id);
                if (chevron) chevron.classList.toggle('open', opened);
                const row = el.previousElementSibling;
                if (row && row.classList.contains('board-row')) row.classList.toggle('active', opened);
            }
        }

        async function postReply(parentId) {
            if (!state.user) { showToast('로그인이 필요합니다.'); return; }
            const input = document.getElementById('replyInput-' + parentId);
            const content = input.value.trim();
            if (!content) { showToast('답글 내용을 입력해주세요.'); return; }
            const { error } = await supabaseClient.from('comments').insert([{
                kakao_id: state.user.kakaoId, user_name: state.user.nickname, content, parent_id: parentId
            }]);
            if (error) {
                alert('답글 등록 실패: ' + error.message + '\n\nparent_id 컬럼이 없다면:\nALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES comments(id) ON DELETE CASCADE;');
                return;
            }
            input.value = '';
            fetchComments();
        }

        async function postComment() {
            if (!state.user) { showToast('로그인이 필요합니다.'); return; }
            const input = document.getElementById('commentInput');
            const rawContent = input.value.trim();
            const titleVal = (document.getElementById('boardTitleInput') || {}).value?.trim() || '';
            const markErr = (el) => { if (!el) return; el.classList.add('gt-field-err'); el.focus(); };
            if (!titleVal) { showToast('제목을 입력해주세요.'); markErr(document.getElementById('boardTitleInput')); return; }
            if (!rawContent) { showToast('내용을 입력해주세요.'); markErr(input); return; }
            // 본문에 구분자(\x1F)가 섞여 글이 깨지는 것 방지
            const content = `\x1F${titleVal.replace(/\x1F/g, '')}\x1F\n${rawContent.replace(/\x1F/g, '')}`;

            const { error } = await supabaseClient
                .from('comments')
                .insert([{ kakao_id: state.user.kakaoId, user_name: state.user.nickname, content }]);

            if (error) {
                showToast('댓글 등록 실패: ' + error.message);
            } else {
                input.value = '';
                const ti = document.getElementById('boardTitleInput'); if (ti) ti.value = '';
                const wf = document.getElementById('boardWriteForm'); if (wf) wf.style.display = 'none';
                fetchComments();
            }
        }

        async function likeComment(id) {
            if (!state.user) { showToast('로그인이 필요합니다.'); return; }
            const likedKey = 'liked_' + state.user.kakaoId;
            const liked = (() => { try { return JSON.parse(localStorage.getItem(likedKey) || '[]'); } catch(e) { return []; } })();
            const sid = String(id);
            const alreadyLiked = liked.includes(sid);

            const { data: comment, error: selErr } = await supabaseClient.from('comments').select('likes').eq('id', id).single();
            if (selErr) {
                alert('좋아요 오류: ' + selErr.message + '\n\nSupabase SQL Editor에서 실행 필요:\nALTER TABLE comments ADD COLUMN IF NOT EXISTS likes integer DEFAULT 0;');
                return;
            }
            const current = comment ? (comment.likes || 0) : 0;
            const newCount = alreadyLiked ? Math.max(0, current - 1) : current + 1;
            const { error: updErr } = await supabaseClient.from('comments').update({ likes: newCount }).eq('id', id);
            if (updErr) {
                showToast('좋아요 업데이트 실패: ' + updErr.message);
                return;
            }

            const newLiked = alreadyLiked ? liked.filter(x => x !== sid) : [...liked, sid];
            localStorage.setItem(likedKey, JSON.stringify(newLiked));
            fetchComments();
        }

        // --- 자동 로그아웃 ---
        let inactivityTimer = null;
        let warnTimer = null;
        const INACTIVITY_MS = 5 * 60 * 1000;

        function showToast(msg, duration = 3500) {
            const t = document.getElementById('auto-toast');
            if (!t) return;
            t.textContent = msg;
            t.style.opacity = '1';
            setTimeout(() => { t.style.opacity = '0'; }, duration);
        }

        // 로그아웃 1분 전 경고 배너 — 남은 초 카운트다운 + [연장] 버튼.
        // 어떤 활동이든(연장 버튼 포함) resetInactivityTimer를 타므로 배너가 떠 있던 중의
        // 활동은 '연장'으로 안내한다.
        let warnCountdownId = null;
        function showLogoutWarning(deadline) {
            hideLogoutWarning();
            const el = document.createElement('div');
            el.id = 'logout-warn-banner';
            el.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%) translateZ(0);will-change:transform;z-index:10000;background:rgba(28,28,30,0.94);color:#fff;padding:11px 12px 11px 18px;border-radius:14px;display:flex;align-items:center;gap:14px;font-size:0.88rem;box-shadow:0 6px 20px rgba(0,0,0,0.28);white-space:nowrap';
            el.innerHTML = `<span>⚠️ <strong id="logoutWarnSec">60</strong>초 후 자동 로그아웃됩니다</span>
                <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex:none" type="button" onclick="extendSession()">연장</button>`;
            document.body.appendChild(el);
            warnCountdownId = setInterval(() => {
                const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
                const s = document.getElementById('logoutWarnSec');
                if (s) s.textContent = left;
            }, 1000);
        }

        function hideLogoutWarning() {
            clearInterval(warnCountdownId);
            warnCountdownId = null;
            document.getElementById('logout-warn-banner')?.remove();
        }

        function extendSession() {
            resetInactivityTimer(); // 배너 제거 + 연장 안내 + 타이머 리셋
        }

        function resetInactivityTimer() {
            if (!state.user) return;
            clearTimeout(inactivityTimer);
            clearTimeout(warnTimer);
            if (document.getElementById('logout-warn-banner')) {
                hideLogoutWarning();
                showToast('로그인이 연장되었습니다.');
            }
            warnTimer = setTimeout(() => showLogoutWarning(Date.now() + 60000), INACTIVITY_MS - 60000);
            inactivityTimer = setTimeout(async () => {
                hideLogoutWarning();
                showToast('자동 로그아웃되었습니다.');
                await handleLogout();
            }, INACTIVITY_MS);
        }

        function startInactivityWatcher() {
            ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart', 'click'].forEach(ev => {
                document.addEventListener(ev, resetInactivityTimer, true);
            });
            resetInactivityTimer();
        }

        function stopInactivityWatcher() {
            clearTimeout(inactivityTimer);
            clearTimeout(warnTimer);
            inactivityTimer = null;
            warnTimer = null;
            hideLogoutWarning();
        }

        async function deleteComment(id) {
            if (!confirm('댓글을 삭제하시겠습니까?')) return;
            const { data, error } = await supabaseClient
                .from('comments')
                .delete()
                .eq('id', id)
                .select();
            if (error) {
                showToast('삭제 실패: ' + error.message);
                return;
            }
            if (!data || data.length === 0) {
                alert('삭제 권한이 없습니다.\nSupabase SQL Editor에서 실행 필요:\nCREATE POLICY "allow delete comments" ON comments FOR DELETE USING (true);');
                return;
            }
            fetchComments();
        }

        // 게시글 링크 복사 — 카톡 공지에 붙이는 딥링크(/gatheo/board/<id> = #gatheo/board/<id>, 로그인 뒤 이 글로 복귀).
        // 경로형(2026-11-05): 카톡·인스타 인앱이 #해시를 버려도 열리도록 — functions/_middleware.js 가 셸을 내고 해시 라우트로 바꾼다.
        function copyBoardPostLink(id) {
            const url = location.origin + '/gatheo/board/' + id;
            const done = () => showToast('글 링크를 복사했습니다. 로그인이 필요한 멤버도 이 링크로 바로 글을 볼 수 있어요.');
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
            else prompt('링크를 복사하세요', url);
        }

        // 게시글 상단 고정/해제(관리자, 2026-10-29) — comments.pinned/pinned_at(마이그레이션 20261029_comments_pinned.sql)
        async function togglePinComment(id, pin) {
            if (!isAdminUser()) return;
            const { data, error } = await supabaseClient.from('comments')
                .update({ pinned: !!pin, pinned_at: pin ? new Date().toISOString() : null }).eq('id', id).select('id');
            if (error) {
                console.error('고정 실패:', error);
                const col = /pinned/.test(error.message || '') && /column|schema/i.test(error.message || '');
                showToast(col ? '고정 기능을 쓰려면 DB 마이그레이션(20261029_comments_pinned.sql)이 필요합니다.' : '고정 상태를 바꾸지 못했습니다. 잠시 후 다시 시도해주세요.');
                return;
            }
            if (!data || !data.length) { showToast('고정 권한이 없습니다.'); return; }
            showToast(pin ? '📌 글을 상단에 고정했습니다.' : '고정을 해제했습니다.');
            fetchComments();
        }

        function startEditComment(id) {
            document.getElementById('comment-view-' + id)?.classList.add('hidden');
            document.getElementById('comment-edit-' + id)?.classList.remove('hidden');
        }
        function cancelEditComment(id) {
            document.getElementById('comment-edit-' + id)?.classList.add('hidden');
            document.getElementById('comment-view-' + id)?.classList.remove('hidden');
        }
        async function saveEditComment(id) {
            const titleEl = document.getElementById('edit-title-' + id);
            const bodyEl = document.getElementById('edit-body-' + id);
            const titleVal = (titleEl?.value || '').trim();
            const bodyVal = (bodyEl?.value || '').trim();
            if (!titleVal) { showToast('제목을 입력해주세요.'); return; }
            if (!bodyVal) { showToast('내용을 입력해주세요.'); return; }
            const content = `\x1F${titleVal.replace(/\x1F/g, '')}\x1F\n${bodyVal.replace(/\x1F/g, '')}`;
            const { error } = await supabaseClient.from('comments').update({ content }).eq('id', id);
            if (error) { showToast('수정 실패: ' + error.message); return; }
            fetchComments();
        }

        function applyTheme(theme) {
            const isDark = theme === 'dark';
            document.body.classList.toggle('dark', isDark);
            const label = isDark ? '☀️' : '🌙';
            const b = document.getElementById('themeToggleBtnLanding');
            const d = document.getElementById('themeToggleBtnBand');
            // 포털·커뮤니티·멤버 페이지 버튼(themeToggleBtnPortal/Community/themeToggleBtn)은 SVG 달/해 아이콘을 CSS(body.dark)로 바꾼다 — textContent 를 쓰면 아이콘이 지워진다
            if (b) b.textContent = label;
            if (d) d.textContent = label;
        }

        function toggleTheme() {
            const next = document.body.classList.contains('dark') ? 'light' : 'dark';
            try { localStorage.setItem('gaa_theme', next); } catch (e) {}
            applyTheme(next);
        }
