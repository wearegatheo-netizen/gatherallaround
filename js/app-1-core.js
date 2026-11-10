// 게더 올 어라운드 본 스크립트 1/8 (core) — index.html 이 번호 순서대로 읽는 클래식 스크립트. 전역(함수·let/const)을 서로 공유한다.
// 고친 뒤에는 node tools/stamp-assets.mjs 로 index.html 의 ?v= 를 갱신할 것(tests/assets-unit.mjs 가 검사).
        // 전역 에러 핸들러 추가 (디버깅용)
        window.onerror = function(msg, url, lineNo, columnNo, error) {
            console.error('Global Error: ' + msg + ' at ' + url + ':' + lineNo);
            return false;
        };

        // --- Configuration ---
        const KAKAO_KEY = '9627dd6537f30f1c42b30de51ceea2cf';
        const DRIVE_API_KEY = 'AIzaSyDk7iyY1XU0mepXOOqwY6h5YitbHHg6t40';
        const DRIVE_ROOT_FOLDER_ID = '1owC5gliLIPF124mHr9Ow_2QdvVC0xcQJ';
        const DRIVE_NEWS_FOLDER_ID = '1NoiFMt_VkHXaqtwamm9C5trbyScwgMGQ';
        const SUPABASE_URL = 'https://xdcygyvsybsirmaknmpq.supabase.co'; 
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkY3lneXZzeWJzaXJtYWtubXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNTMxNTIsImV4cCI6MjA5MzcyOTE1Mn0.KknBzg2OfcsVawxp0BTBJuwXMWX6tNZo-6nCm64nGeI'; 
        const ADMIN_ID = '4883868250'; // 관리자 카카오 ID (최경수)
        // 커뮤니티 마스터 비밀번호는 Edge Function 'verify-community-admin'을 통해 서버에서 검증됩니다.
        // 신청 알림 메일은 Cloudflare 함수 /send-email(Resend 프록시)이 발송한다 —
        // RESEND_API_KEY는 Cloudflare 환경변수에만 저장, 미설정이면 mailto 폴백.

        let supabaseClient = null;

        // ── 브라우저 오류 수집(2026-11-10) ── 방문자 폰에서 난 스크립트 오류를 /client-log 로 보낸다(운영 총괄이 관리자 › 운영 도구에서 확인).
        // 세션당 최대 8건·같은 메시지는 한 번, 개인정보 없음(메시지·스택·화면 경로만; 서버가 전화·이메일·토큰 모양을 한 번 더 가림).
        // 로컬(127.0.0.1·localhost)에서는 보내지 않는다(테스트는 window.__gaaLogTest 로 켬).
        (function () {
            const seen = new Set(); let count = 0, queue = [], timer = null;
            const enabled = () => window.__gaaLogTest || !/^(127\.0\.0\.1|localhost)$/.test(location.hostname);
            const page = () => ((location.hash || '').replace(/^#/, '') || location.pathname.replace(/^\//, '') || 'portal').split('/').slice(0, 2).join('/').slice(0, 60);
            const role = () => {
                try {
                    const bandEl = document.getElementById('band-main-content');
                    if (state.bandProfile && bandEl && !bandEl.classList.contains('hidden')) return 'band';
                    if (state.user) return isAdminUser() ? 'admin' : 'member';
                } catch (_) {}
                return 'guest';
            };
            function flush() {
                if (!queue.length) return;
                const body = JSON.stringify({ errors: queue.splice(0) });
                try { if (navigator.sendBeacon && navigator.sendBeacon('/client-log', new Blob([body], { type: 'application/json' }))) return; } catch (_) {}
                try { fetch('/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}); } catch (_) {}
            }
            function report(kind, message, stack, source) {
                try {
                    if (!enabled()) return;
                    const msg = String(message || '').slice(0, 500);
                    if (!msg || (/^Script error\.?$/.test(msg) && !stack)) return; // 다른 출처 스크립트의 내용 없는 오류
                    const key = msg.slice(0, 120);
                    if (seen.has(key) || count >= 8) return;
                    seen.add(key); count++;
                    queue.push({ kind, message: msg, stack: String(stack || '').slice(0, 3000), source: String(source || '').slice(0, 200), page: page(), role: role() });
                    clearTimeout(timer); timer = setTimeout(flush, 1500);
                } catch (_) {}
            }
            window.addEventListener('error', (e) => { if (e && e.message) report('error', e.message, e.error && e.error.stack, String(e.filename || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0] + ':' + (e.lineno || 0) + ':' + (e.colno || 0)); });
            window.addEventListener('unhandledrejection', (e) => { const r = e && e.reason; report('promise', (r && r.message) || String(r), r && r.stack, ''); });
            window.addEventListener('pagehide', flush);
            window._gaaReportError = report;
        })();

        // ── 서버 경유 쓰기(gw, 2026-11-10 보안 개선) ──────────────────────────────────────────
        // 카카오 멤버는 DB 입장에서 익명이라 권한을 가릴 수 없었다 → 아래 표의 **쓰기 전부**와 개인정보가 든 읽기
        // (profiles 전체, performance_bookings 의 달력용 외 컬럼)는 supabaseClient.from(...) 호출을 그대로 기록해
        // /gatheo-api(service role)로 보내고, 서버가 신원·역할을 확인한 뒤 실행한다. 호출부는 고치지 않는다.
        // 서버 함수가 없는 환경(정적 서버·테스트: 404/405/501)에서는 종전처럼 직접 호출(_gwDown).
        const GW_TABLES = new Set(['profiles', 'reservations', 'time_blocks', 'performance_bookings', 'comments', 'schedule_guests', 'schedule_attendees',
            'teams', 'poll_votes', 'polls', 'schedules', 'documents', 'notices']);
        const GW_PERF_SAFE = ['id', 'date', 'start_time', 'end_time', 'status', 'created_at'];
        const GW_SESSION_KEY = 'gaa_session';
        let _gwDown = false;
        function _gwSessionGet() {
            try { const s = JSON.parse(localStorage.getItem(GW_SESSION_KEY) || 'null'); if (s && s.t && s.e > Date.now() + 60000) return s; } catch (_) {}
            return null;
        }
        function _gwSessionClear() { try { localStorage.removeItem(GW_SESSION_KEY); } catch (_) {} }
        async function _gwPost(payload) {
            let r;
            try { r = await fetch('/gatheo-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
            catch (e) { return { status: 0, body: null }; }
            if (r.status === 404 || r.status === 405 || r.status === 501) { _gwDown = true; return { down: true }; }
            return { status: r.status, body: await r.json().catch(() => null) };
        }
        function _gwKakaoToken() {
            try { if (typeof Kakao !== 'undefined' && Kakao.Auth) { if (!Kakao.isInitialized()) initKakao(); return (Kakao.Auth.getAccessToken && Kakao.Auth.getAccessToken()) || null; } } catch (_) {}
            return null;
        }
        // 카카오 토큰 → 서버 세션(30일). 성공하면 저장하고 토큰 문자열을 돌려준다.
        let _gwLoginInflight = null;
        async function _gwLogin(kakaoToken) {
            if (!kakaoToken) return null;
            if (_gwLoginInflight) return _gwLoginInflight;
            _gwLoginInflight = (async () => {
                const res = await _gwPost({ action: 'login', kakao_token: kakaoToken });
                if (res.down || !res.body || !res.body.session) return null;
                try { localStorage.setItem(GW_SESSION_KEY, JSON.stringify({ t: res.body.session, e: res.body.exp, k: res.body.kakao_id })); } catch (_) {}
                return res.body.session;
            })();
            try { return await _gwLoginInflight; } finally { _gwLoginInflight = null; }
        }
        function _gwKakaoPopup() {
            if (typeof Kakao === 'undefined' || !Kakao.Auth || !Kakao.Auth.login) return Promise.resolve(null);
            return new Promise(resolve => {
                try {
                    if (!Kakao.isInitialized()) initKakao();
                    Kakao.Auth.login({ success: a => resolve(a && a.access_token ? a.access_token : null), fail: () => resolve(null) });
                } catch (_) { resolve(null); }
            });
        }
        // 부팅 때 캐시된 카카오 멤버의 서버 세션 확인 — 있으면(또는 살아 있는 카카오 토큰으로 새로 받으면) true.
        // 서버 함수가 없는 환경이면 종전처럼 통과(true).
        async function _gwBootSessionOk(kakaoId) {
            const s = _gwSessionGet();
            if (s && String(s.k) === String(kakaoId)) return true;
            if (s) _gwSessionClear();
            if (_gwDown) return true;
            const kt = _gwKakaoToken();
            if (kt && await _gwLogin(kt)) { const n = _gwSessionGet(); if (n && String(n.k) === String(kakaoId)) return true; _gwSessionClear(); return false; }
            if (_gwDown) return true;
            const ping = await _gwPost({ action: 'ping' });
            return !!ping.down || ping.status === 0; // 서버 없음·오프라인이면 막지 않는다
        }
        // 서버에 보낼 신원 — 카카오 세션과 Supabase 세션이 같이 있으면 둘 다(합주팀 화면이면 prefer:'sb')
        async function _gwIds(opts = {}) {
            const ids = {};
            const kakaoUser = state.user && state.user.authType !== 'email' ? state.user.kakaoId : null;
            let s = _gwSessionGet();
            if (s && kakaoUser && String(s.k) !== String(kakaoUser)) { _gwSessionClear(); s = null; }
            if (s) ids.session = s.t;
            else {
                const kt = _gwKakaoToken();
                let t = kt ? await _gwLogin(kt) : null;
                if (!t && !_gwDown && kakaoUser && opts.interactive) { const nt = await _gwKakaoPopup(); t = nt ? await _gwLogin(nt) : null; }
                if (t) ids.session = t;
            }
            try { const { data } = await supabaseClient.auth.getSession(); if (data && data.session && data.session.access_token) ids.sb_token = data.session.access_token; } catch (_) {}
            const bandEl = document.getElementById('band-main-content');
            if (ids.sb_token && (state.bandProfile && bandEl && !bandEl.classList.contains('hidden') || !ids.session)) ids.prefer = 'sb';
            return ids;
        }
        // 전용 액션(조회·취소·계정 찾기). 서버 함수가 없으면 { down:true } — 호출부가 종전 방식으로 처리
        async function _gwAction(action, payload = {}, opts = {}) {
            if (_gwDown) return { down: true };
            const ids = opts.anon ? {} : await _gwIds({ interactive: !!opts.interactive });
            if (_gwDown) return { down: true };
            const res = await _gwPost({ action, ...payload, ...ids });
            if (res.down) return { down: true };
            if (res.status === 401 && ids.session) _gwSessionClear();
            return res.body || { ok: false, message: '서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' };
        }
        class GwBuilder {
            constructor(table, real, first) { this.table = table; this.real = real; this.calls = [first]; }
            then(onOk, onErr) { return this._run().then(onOk, onErr); }
            catch(onErr) { return this._run().catch(onErr); }
            _replay() { let q = this.real; for (const [m, ...a] of this.calls) q = q[m](...a); return q; }
            async _run() {
                if (this._p) return this._p;
                this._p = (async () => {
                    if (_gwDown) return this._replay();
                    const write = this.calls[0][0] !== 'select';
                    let ids = await _gwIds({ interactive: write });
                    if (_gwDown) return this._replay();
                    let res = await _gwPost({ action: 'db', table: this.table, calls: this.calls, ...ids });
                    if (res.down) return this._replay();
                    if (res.status === 401 && ids.session) { // 세션 만료·무효 → 한 번만 다시 받아 재시도
                        _gwSessionClear();
                        ids = await _gwIds({ interactive: write });
                        res = await _gwPost({ action: 'db', table: this.table, calls: this.calls, ...ids });
                        if (res.down) return this._replay();
                    }
                    if (res.status !== 200 || !res.body) {
                        const msg = (res.body && res.body.message) || (res.status === 0 ? '네트워크 오류로 서버에 연결하지 못했습니다.' : '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
                        return { data: null, error: { message: msg, code: String(res.status) }, count: null, status: res.status };
                    }
                    return { data: res.body.data == null ? null : res.body.data, error: res.body.error || null, count: null, status: 200 };
                })();
                return this._p;
            }
        }
        ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'not', 'order', 'limit', 'range', 'select', 'single', 'maybeSingle'].forEach(m => {
            GwBuilder.prototype[m] = function (...a) { this.calls.push([m, ...a]); return this; };
        });
        function _gwInstall(client) {
            if (!client || client._gwInstalled) return;
            client._gwInstalled = true;
            const orig = client.from.bind(client);
            client.from = (table) => {
                const real = orig(table);
                if (_gwDown || !GW_TABLES.has(table)) return real;
                return {
                    select: (cols, o) => {
                        const list = String(cols == null ? '*' : cols).replace(/\s+/g, '').split(',');
                        const viaServer = table === 'profiles' || (table === 'performance_bookings' && !list.every(c => GW_PERF_SAFE.includes(c)));
                        return viaServer && !(o && (o.count || o.head)) ? new GwBuilder(table, real, ['select', cols]) : real.select(cols, o);
                    },
                    insert: (v, o) => new GwBuilder(table, real, o ? ['insert', v, o] : ['insert', v]),
                    upsert: (v, o) => new GwBuilder(table, real, o ? ['upsert', v, o] : ['upsert', v]),
                    update: (v, o) => new GwBuilder(table, real, o ? ['update', v, o] : ['update', v]),
                    delete: () => new GwBuilder(table, real, ['delete']),
                };
            };
        }

        // --- Kakao Auth ---
        function initKakao() {
            try {
                if (typeof Kakao !== 'undefined' && !Kakao.isInitialized()) {
                    Kakao.init(KAKAO_KEY);
                    console.log("Kakao SDK v1 Initialized:", Kakao.isInitialized());
                }
            } catch (e) {
                console.error("Kakao Init Error:", e);
            }
        }

        function handleLogin() {
            console.log("카카오 로그인 시퀀스 시작 (v1 Popup)...");
            if (typeof Kakao === 'undefined') {
                showToast("카카오 SDK를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
                return;
            }
            if (!Kakao.isInitialized()) initKakao();
            // 일부 인앱 브라우저는 팝업 대신 리다이렉트로 로그인해 페이지가 새로 뜬다(해시·메모리 유실, 2026-10-29).
            // 돌아갈 경로를 sessionStorage 에 남겨 initSession 이 토큰으로 로그인을 마저 하고 그 화면으로 보낸다.
            _saveReturnTo();

            Kakao.Auth.login({
                success: function(auth) {
                    console.log("카카오 인증 성공:", auth);
                    _completeKakaoLogin();
                },
                fail: function(err) {
                    console.error("카카오 인증 실패:", err);
                    showToast("로그인 실패: " + (err.error_description || err.error || "알 수 없는 오류"));
                }
            });
        }

        // 카카오 토큰이 있는 상태에서 프로필 조회 → 승인 상태 분기 → loginUI. 팝업 성공 콜백과
        // 리다이렉트 복귀(initSession, gaa_return_to) 양쪽이 쓴다.
        function _completeKakaoLogin() {
            return new Promise((resolve) => {
                    Kakao.API.request({
                        url: '/v2/user/me',
                        success: async function(res) {
                            console.log("사용자 정보 요청 성공:", res);
                            const nickname = (res.kakao_account && res.kakao_account.profile)
                                ? res.kakao_account.profile.nickname
                                : (res.properties ? res.properties.nickname : '사용자');
                            const kakaoId = res.id.toString();
                            const prof = (res.kakao_account && res.kakao_account.profile) || {};
                            const kakaoAvatar = prof.thumbnail_image_url || prof.profile_image_url || (res.properties && (res.properties.thumbnail_image || res.properties.profile_image)) || null;
                            if (supabaseClient) {
                                { const gs = _gwSessionGet(); if (gs && String(gs.k) !== kakaoId) _gwSessionClear(); } // 다른 카카오 계정의 서버 세션이 남아 있으면 버린다
                                const { data } = await supabaseClient.from('profiles').select('*').eq('kakao_id', kakaoId).maybeSingle();
                                if (!data) { state.user = { nickname, kakaoId }; loginUI(nickname); return; }
                                if (data.status === 'pending') { showPendingScreen(data.name || nickname); return; }
                                if (data.status === 'rejected') { showToast('회원가입이 거절되었습니다. 자세한 사항은 관리자에게 문의해주세요.'); return; }
                                if (data.status !== 'approved') { showToast('계정 상태를 확인할 수 없습니다. 관리자에게 문의해주세요.'); return; }
                                state.user = { nickname: data.name || nickname, kakaoId, role: data.role || '일반', avatarUrl: data.avatar_url || kakaoAvatar || null, kakaoAvatar };
                                // 아바타 기본값 = 카카오 프로필 사진(2026-10-15): 아직 없으면 저장해 둔다(컬럼 없으면 조용히 실패)
                                if (!data.avatar_url && kakaoAvatar) supabaseClient.from('profiles').update({ avatar_url: kakaoAvatar }).eq('kakao_id', kakaoId).then(() => {}, () => {});
                                // 승인된 게더링 로그인만 자동 로그인 캐시에 기록 — 재방문 자동 진입은 이 캐시로만 판단
                                try { localStorage.setItem('gaa_kakao_uid', kakaoId); } catch(e) {}
                            } else {
                                state.user = { nickname, kakaoId };
                            }
                            loginUI(state.user.nickname);
                            resolve(true);
                        },
                        fail: function(err) {
                            showToast("사용자 정보 요청 실패: " + JSON.stringify(err));
                            resolve(false);
                        }
                    });
            });
        }

        // ── 로그인 뒤 원래 페이지로 복귀(2026-10-29, 리더즈 회의 건의) ──
        // 공지 링크(#gatheo/board/<글 id> 등)로 들어와 로그인하면 홈이 아니라 그 화면으로. 메모리(_pendingGatheoSub)와
        // sessionStorage(gaa_return_to) 둘 다에 두어 카카오 리다이렉트 로그인·새로고침에도 살아남는다.
        const _RETURN_TO_KEY = 'gaa_return_to';
        function _saveReturnTo(path) {
            let p = path;
            if (!p && Array.isArray(_pendingGatheoSub) && _pendingGatheoSub.length) p = 'gatheo/' + _pendingGatheoSub.join('/');
            if (!p) { const h = (history.state && history.state.page) || _pageFromHash(); if (String(h).startsWith('gatheo/')) p = h; }
            try { if (p) sessionStorage.setItem(_RETURN_TO_KEY, p); } catch (_) {}
        }
        function _takeReturnTo() {
            let p = null;
            try { p = sessionStorage.getItem(_RETURN_TO_KEY); sessionStorage.removeItem(_RETURN_TO_KEY); } catch (_) {}
            if (!p || !/^gatheo(\/|$)/.test(p)) return null;
            const segs = p.split('/').filter(Boolean);
            if (segs[1] && !_GATHEO_TABS.includes(segs[1])) return null;
            return p;
        }

        async function handleLogout() {
            try { localStorage.setItem('gaa_portal_required', '1'); } catch(e) {}
            try { localStorage.removeItem('gaa_kakao_uid'); } catch(e) {}
            _gwSessionClear();
            // 즉시 UI 전환 (서버 응답 기다리지 않음)
            logoutUI();
            showToast('로그아웃 되었습니다.');
            // 백그라운드에서 서버 세션 종료
            if (state.user && state.user.authType === 'email') {
                supabaseClient.auth.signOut().catch(() => {});
            } else if (typeof Kakao !== 'undefined' && Kakao.Auth) {
                // 카카오 토큰을 서버·로컬 모두에서 제거 — 로컬에 남으면 재방문 시 자동 로그인된다.
                // logout()은 비동기(서버 호출)라 페이지 이탈 시 유실될 수 있어 setAccessToken(null)로 즉시 로컬 제거.
                try { if (Kakao.Auth.getAccessToken()) Kakao.Auth.logout(() => {}); } catch(e) {}
                try { Kakao.Auth.setAccessToken(null); } catch(e) {}
            }
            // 호스트 센터도 같은 카카오 세션을 쓰므로 함께 로그아웃
            try { if (typeof _hostState !== 'undefined') _hostState.token = null; } catch(e) {}
        }

        function loginUI(nickname) {
            if (window.__shareEntryMode) return; // 공유 링크 진입 시 GatheO 화면 노출 차단
            // 로그아웃 표식 해제 — 로그아웃 뒤 새로고침 없이 다시 로그인하면 표식이 남아 다음 새로고침 때 세션을 지우던 버그(2026-10-08)
            try { localStorage.removeItem('gaa_portal_required'); } catch(e) {}
            if (location.search) history.replaceState(history.state || {}, '', location.pathname + location.hash); // 해시(#gatheo/…)는 남긴다
            hideBootOverlay();
            document.body.classList.add('portal-view');
            document.body.classList.remove('fullwidth-view');
            _hideAllScreens();
            document.getElementById('main-content').classList.remove('hidden');
            document.body.classList.add('gatheo-nav');
            document.getElementById('userNameDisplay').textContent = nickname;
            document.getElementById('userNameInput').value = nickname;
            
            // 관리자인 경우 gatheo 탭바에 관리자 탭 표시
            if (isAdminUser()) {
                const adminBtn = document.getElementById('gatheoTab-admin');
                if (adminBtn) adminBtn.classList.remove('hidden');
            }
            // 내 예약은 마이 탭(gtMypageSub('res'))과 예약 탭 머리 줄에서 — 달력 안쪽 탭은 월간/주간만(2026-10-15)
            // 비로그인 상태로 #gatheo/... 딥링크 진입했다가 로그인한 경우 — 그 탭으로 이어간다
            {
                let sub = Array.isArray(_pendingGatheoSub) && _pendingGatheoSub.length ? _pendingGatheoSub : null;
                _pendingGatheoSub = null;
                const saved = _takeReturnTo(); // 리다이렉트 로그인·새로고침으로 메모리가 비었으면 sessionStorage 의 경로
                if (!sub && saved) sub = saved.split('/').slice(1);
                let initTab = sub && _GATHEO_TABS.includes(sub[0]) ? sub[0] : 'home';
                if (initTab === 'admin' && !isAdminUser()) initTab = 'home';
                setGatheOTab(initTab);
                if (initTab === 'member' && sub && _MEMBER_SUBTABS.includes(sub[1])) setMemberTab(sub[1]);
                if (initTab === 'board' && sub && _UUID_RE.test(sub[1] || '')) gtOpenPost(sub[1].toLowerCase()); // 글 딥링크 #gatheo/board/<id>
                if (sub) _pushNav('gatheo/' + sub.filter(Boolean).join('/'));
            }
            fetchReservations();
            fetchComments();
            fetchNotices();
            fetchDocs();
            fetchBlocks().then(() => render());
            fetchMembers().then(ms => { state.cachedMembers = (ms || []).filter(m => m.status === 'approved'); render(); });
            fetchSchedules();
            fetchPolls();
            fetchPollVotes();
            subscribeToPolls();
            fetchTeams();
            // 공지·일정 배너는 홈 탭 카드로 통합(2026-10-15) — #notice_container/#schedule_banner 는 숨긴 채 데이터만 유지
            startInactivityWatcher();
            checkKakaoUserProfile();
            _gatheoEntered = true;
            _authResolved = true;
            applyPendingRoute();
        }

        async function checkKakaoUserProfile() {
            if (!state.user || state.user.authType === 'email') return;
            if (!supabaseClient) return;
            const { data } = await supabaseClient.from('profiles').select('id, name, status').eq('kakao_id', state.user.kakaoId).maybeSingle();
            if (!data) { showKakaoSignupModal(); return; }
            if (data.status === 'pending') {
                logoutUI();
                showPendingScreen(data.name || state.user.nickname);
                return;
            }
            if (data.status === 'rejected') {
                showToast('회원가입이 거절되었습니다. 자세한 사항은 관리자에게 문의해주세요.');
                logoutUI();
                return;
            }
            if (data.name) {
                state.user.nickname = data.name;
                const el = document.getElementById('userNameDisplay');
                if (el) el.textContent = data.name;
                const inp = document.getElementById('userNameInput');
                if (inp) inp.value = data.name;
            }
        }

        function showKakaoSignupModal() {
            const modal = document.getElementById('kakaoSignupModal');
            if (!modal) return;
            const nameEl = document.getElementById('ksName');
            if (nameEl && state.user) nameEl.value = state.user.nickname || '';
            showKakaoSignupView();
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            setTimeout(() => renderMtEditUI('mtEdit_ks', null), 0);
        }

        function hideKakaoSignupModal() {
            const modal = document.getElementById('kakaoSignupModal');
            if (modal) modal.classList.add('hidden');
            document.body.style.overflow = '';
        }

        function showKakaoSignupView() {
            document.getElementById('kakaoSignupView').style.display = 'block';
            document.getElementById('kakaoLinkView').style.display = 'none';
        }

        function showKakaoLinkView() {
            document.getElementById('kakaoSignupView').style.display = 'none';
            document.getElementById('kakaoLinkView').style.display = 'block';
            document.getElementById('klName').value = '';
            document.getElementById('klPhone').value = '';
        }

        let _kakaoLinkBusy = false;
        async function submitKakaoLink() {
            if (_kakaoLinkBusy) return;
            const name = document.getElementById('klName').value.trim();
            const phone = document.getElementById('klPhone').value.trim();
            if (!name) { showToast('이름을 입력해주세요.'); return; }
            if (!phone) { showToast('전화번호를 입력해주세요.'); return; }
            const phoneNorm = phone.replace(/-/g, '');

            _kakaoLinkBusy = true;
            const btn = document.querySelector('button[onclick="submitKakaoLink()"]');
            if (btn) { btn.disabled = true; btn.textContent = '확인 중...'; }
            try {
                // 서버가 이름+연락처를 대조해 연결한다(2026-11-10 — 다른 멤버 연락처를 브라우저로 내려받지 않게)
                const srv = await _gwAction('kakao_link', { name, phone: phoneNorm }, { interactive: true });
                if (!srv.down) {
                    if (!srv.ok) { showToast(srv.message || '연동하지 못했습니다.', 5000); return; }
                    if (!srv.linked) { showToast('일치하는 계정을 찾을 수 없습니다. 이름과 전화번호를 다시 확인해주세요.', 6000); return; }
                    hideKakaoSignupModal();
                    showToast('계정이 연동되었습니다! 기존 계정으로 로그인됩니다.');
                    fetchMembers().then(ms => { state.cachedMembers = (ms || []).filter(m => m.status === 'approved'); render(); });
                    return;
                }
                const { data, error } = await supabaseClient
                    .from('profiles')
                    .select('id, name, phone')
                    .eq('name', name)
                    .is('kakao_id', null);
                if (error) { showToast('오류: ' + error.message, 5000); return; }

                const match = (data || []).find(p => (p.phone || '').replace(/-/g, '') === phoneNorm);
                if (!match) {
                    showToast('일치하는 계정을 찾을 수 없습니다. 이름과 전화번호를 다시 확인해주세요.', 6000);
                    return;
                }

                const { error: upErr } = await supabaseClient
                    .from('profiles')
                    .update({ kakao_id: state.user.kakaoId })
                    .eq('id', match.id);
                if (upErr) { showToast('연동 실패: ' + upErr.message, 5000); return; }

                hideKakaoSignupModal();
                showToast('계정이 연동되었습니다! 기존 계정으로 로그인됩니다.');
                fetchMembers().then(ms => { state.cachedMembers = (ms || []).filter(m => m.status === 'approved'); render(); });
            } finally {
                _kakaoLinkBusy = false;
                if (btn) { btn.disabled = false; btn.textContent = '연동하기'; }
            }
        }

        let _kakaoSignupBusy = false;
        async function submitKakaoSignup() {
            if (_kakaoSignupBusy) return;
            const name = document.getElementById('ksName').value.trim();
            const email = document.getElementById('ksEmail').value.trim();
            const phone = document.getElementById('ksPhone').value.trim();
            if (!name) { showToast('이름을 입력해주세요.'); return; }
            if (!phone) { showToast('전화번호를 입력해주세요.'); return; }
            if (!/^010-\d{4}-\d{4}$/.test(phone) && !/^01[0-9]{8,9}$/.test(phone.replace(/-/g, ''))) {
                showToast('올바른 전화번호를 입력해주세요. (예: 010-0000-0000)'); return;
            }
            const selectedInsts = Array.from(document.querySelectorAll('#ksInstBtns .inst-btn.selected')).map(b => b.dataset.inst);
            const customInst = document.getElementById('ksCustomInst').value.trim();
            const customs = customInst ? customInst.split(',').map(s => s.trim()).filter(s => s) : [];
            const instruments = [...selectedInsts, ...customs].join(', ');
            if (!instruments) { showToast('메인 세션을 1개 이상 선택하거나 입력해주세요.'); return; }

            const music_taste = getMtEditValue('mtEdit_ks');
            if (!music_taste) { showToast('음악 취향을 입력해주세요. 장르를 선택하거나 가수/곡을 검색해주세요.'); return; }

            _kakaoSignupBusy = true;
            const submitBtn = document.querySelector('button[onclick="submitKakaoSignup()"]');
            const origLabel = submitBtn ? submitBtn.textContent : '';
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '처리 중...'; }
            try {
                const { error } = await supabaseClient.from('profiles').insert([{
                    id: genUUID(),
                    kakao_id: state.user.kakaoId,
                    name, email, phone, instruments, music_taste,
                    status: 'pending',
                    role: '일반'
                }]);
                if (error) { showToast('가입 신청 실패: ' + error.message, 5000); return; }
                hideKakaoSignupModal();
                showToast('가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.');
                setTimeout(() => sendAdminPush('🙋 새 가입 신청', `${name} · ${instruments || '세션 미입력'}`), 400);
                fetchMembers().then(ms => { state.cachedMembers = (ms || []).filter(m => m.status === 'approved'); render(); });
            } finally {
                _kakaoSignupBusy = false;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
            }
        }

        function onTabClick(e) {
            state.currentView = e.target.dataset.view;
            state.viewDate = new Date();
            state.selectedDate = null;
            state.startTime = null;
            state.endTime = null;
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            e.target.classList.add('active');
            render();
        }

        function logoutUI() {
            hideBootOverlay();
            if (window.__shareEntryMode) return; // 공유 링크 진입 시 포털 재노출 차단
            _hideAllScreens();
            document.getElementById('portal-page').classList.remove('hidden');
            document.getElementById('userNameInput').value = '';
            const ksModal = document.getElementById('kakaoSignupModal');
            if (ksModal) ksModal.classList.add('hidden');
            const epModal = document.getElementById('editParticipantsModal');
            if (epModal) epModal.classList.add('hidden');
            document.body.style.overflow = '';

            // 관리자 탭 숨기기, 내 예약 탭 제거
            const gatheoAdminBtn = document.getElementById('gatheoTab-admin');
            if (gatheoAdminBtn) gatheoAdminBtn.classList.add('hidden');
            const myTab = document.querySelector('[data-view="my"]');
            if (myTab) myTab.remove();
            state.user = null;
            try { Object.keys(_gtViewCache).forEach(k => delete _gtViewCache[k]); } catch (_) {} // 멤버 페이지 화면 캐시(다음 로그인 사용자에게 안 보이게)
            state._attLoaded = null; state.myProfile = null;
            state.bandProfile = null;
            state.bandNotices = [];
            state.bandMembers = [];
            state.bandComments = [];
            notices = [];
            document.getElementById('notice_container').classList.add('hidden');
            const mpc = document.getElementById('memberPanelContent');
            const mpa = document.getElementById('memberPanelArrow');
            if (mpc) mpc.classList.add('hidden');
            if (mpa) mpa.textContent = '▼ 펼치기';
            const mypc = document.getElementById('mypagePanelContent');
            const mypa = document.getElementById('mypagePanelArrow');
            if (mypc) { mypc.classList.add('hidden'); mypc.innerHTML = ''; }
            if (mypa) mypa.textContent = '▼ 펼치기';
            stopInactivityWatcher();
            _gatheoEntered = false;
            _authResolved = true;
            applyPendingRoute();
        }

        // --- GatheO tab navigation ---
        const _GT_TITLES = { home: '', reservation: '예약', member: '멤버', board: '게시판', mypage: '마이', admin: '관리자' };
        function setGatheOTab(tab) {
            state.gatheoTab = tab;
            const map = { home: 'gatheOTabHome', reservation: 'gatheOTabReservation', member: 'gatheOTabMember', board: 'comments_container', mypage: 'gatheOTabMypage', admin: 'gatheOTabAdmin' };
            Object.entries(map).forEach(([t, id]) => {
                const btn = document.getElementById('gatheoTab-' + t);
                const body = document.getElementById(id);
                if (btn) btn.classList.toggle('active', t === tab);
                if (body) body.classList.toggle('hidden', t !== tab);
            });
            gtUpdateBar();
            gtSheetClose();
            window.scrollTo({ top: 0 });
            if (tab === 'home') {
                renderGatheoHome();
            } else if (tab === 'reservation') {
                gtUpdateMyResRow();
            } else if (tab === 'member') {
                document.getElementById('memberPanelContent')?.classList.remove('hidden');
                renderMemberPanel();
            } else if (tab === 'mypage') {
                state.mypageSub = null;
                document.getElementById('mypagePanelContent')?.classList.remove('hidden');
                renderMypagePanel();
            } else if (tab === 'admin') {
                renderGatheOAdmin();
            } else if (tab === 'board') {
                fetchComments();
            }
            _pushNav('gatheo/' + tab); // 탭 단위 딥링크 주소 발행
        }
        // 앱 바: 홈이면 워드마크, 다른 탭은 제목. 아바타 버튼(→ 마이)은 내 프로필 사진/이니셜
        function gtUpdateBar() {
            const wm = document.getElementById('gtBarWm'), tt = document.getElementById('gtBarTitle');
            const title = _GT_TITLES[state.gatheoTab] || '';
            if (wm) wm.classList.toggle('hidden', !!title);
            if (tt) { tt.textContent = title; tt.classList.toggle('hidden', !title); }
            const av = document.getElementById('gtAvatarBtn');
            if (av && state.user) { const me = _gtMe(); av.innerHTML = gaAvatar((me && me.name) || state.user.nickname, { url: (me && me.avatar_url) || state.user.avatarUrl }); }
        }

        // ── 활동기록: Google Drive 갤러리 ─────────────────────────────────────
        // 폴더 탐색 스택 (JSON.stringify를 HTML 속성에 쓰면 따옴표 충돌 → 전역 스택으로 관리)
        window.__driveStack = []; // [{id, name}, ...]  — 현재 위치까지의 경로

        function drivePushFolder(folderId, folderName) {
            const cur = window.__driveStack.length
                ? window.__driveStack[window.__driveStack.length - 1]
                : { id: DRIVE_ROOT_FOLDER_ID, name: '활동기록' };
            window.__driveStack.push({ id: folderId, name: folderName, parentId: cur.id });
            renderDriveGallery(folderId);
        }

        function drivePopTo(idx) {
            // idx = 브레드크럼 배열 인덱스 (0 = 루트)
            if (idx === 0) {
                window.__driveStack = [];
                renderDriveGallery(DRIVE_ROOT_FOLDER_ID);
            } else {
                window.__driveStack = window.__driveStack.slice(0, idx);
                renderDriveGallery(window.__driveStack[window.__driveStack.length - 1].id);
            }
        }

        const DRIVE_IMG_PER_PAGE = 12;
        const DRIVE_VID_PER_PAGE = 6;

        function drivePageBtn(type, page, label, disabled) {
            return `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="driveSetPage('${type}',${page})" ${disabled ? 'disabled' : ''}>${label}</button>`;
        }

        function drivePageControls(type, page, total, perPage) {
            if (total <= perPage) return '';
            const totalPages = Math.ceil(total / perPage);
            const start = page * perPage + 1;
            const end = Math.min((page + 1) * perPage, total);
            return `<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin:10px 0 20px">
                ${drivePageBtn(type, page - 1, '‹ 이전', page === 0)}
                <span style="font-size:0.82rem;color:var(--wds-gray-500)">${start}–${end} / ${total}</span>
                ${drivePageBtn(type, page + 1, '다음 ›', page >= totalPages - 1)}
            </div>`;
        }

        function driveSetPage(type, page) {
            window.__drivePaging = window.__drivePaging || { images: 0, videos: 0 };
            window.__drivePaging[type] = page;
            renderDriveGalleryContent();
            document.getElementById('driveGalleryRoot')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function renderDriveGalleryContent() {
            const root = document.getElementById('driveGalleryRoot');
            if (!root) return;

            const folders = window.__driveAllFolders || [];
            const images  = window.__driveAllImages  || [];
            const videos  = window.__driveAllVideos  || [];
            const others  = window.__driveAllOthers  || [];
            const pg = window.__drivePaging || { images: 0, videos: 0 };

            const thumbUrl = (f) => f.thumbnailLink
                ? f.thumbnailLink.replace(/=s\d+/, '=s320')
                : `https://drive.google.com/thumbnail?id=${f.id}&sz=w320`;

            const folderCards = folders.map(f => {
                const safeName = jsStr(f.name);
                return `<div onclick="drivePushFolder('${jsStr(f.id)}','${safeName}')"
                     style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--wds-gray-100);border-radius:12px;cursor:pointer;transition:background 0.15s"
                     onmouseenter="this.style.background='var(--wds-gray-200)'" onmouseleave="this.style.background='var(--wds-gray-100)'">
                    <span style="font-size:1.6rem">📁</span>
                    <span style="font-weight:600;font-size:0.95rem;color:var(--wds-black)">${escapeHtml(f.name)}</span>
                </div>`;
            }).join('');

            const mediaCard = (f, type) => {
                const thumb = thumbUrl(f);
                if (type === 'video') {
                    return `<div style="background:var(--wds-gray-100);border-radius:12px;overflow:hidden;cursor:pointer" onclick="openDrivePreview('${f.id}','video')">
                        <div style="position:relative;aspect-ratio:16/9;background:#111">
                            <img src="${thumb}" alt="${escapeHtml(f.name)}" loading="lazy"
                                 style="width:100%;height:100%;object-fit:cover;opacity:0.82"
                                 onerror="this.style.display='none'">
                            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
                                <div style="width:56px;height:56px;background:rgba(0,0,0,0.7);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.5rem">▶</div>
                            </div>
                        </div>
                        <div style="padding:8px 10px;font-size:0.78rem;font-weight:600;color:var(--wds-black);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</div>
                    </div>`;
                } else {
                    return `<div onclick="openDrivePreview('${f.id}','image')"
                                 style="position:relative;aspect-ratio:1;background:var(--wds-gray-100);border-radius:10px;overflow:hidden;cursor:pointer;">
                        <img src="${thumb}" alt="${escapeHtml(f.name)}" loading="lazy"
                             style="width:100%;height:100%;object-fit:cover;display:block;transition:transform 0.2s"
                             onmouseenter="this.style.transform='scale(1.04)'" onmouseleave="this.style.transform='scale(1)'"
                             onerror="this.parentElement.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem\'>🖼️</div>'">
                        <div style="position:absolute;bottom:0;left:0;right:0;padding:6px 8px;background:linear-gradient(transparent,rgba(0,0,0,0.65));color:#fff;font-size:0.72rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</div>
                    </div>`;
                }
            };

            const otherRows = others.map(f => `
                <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--wds-gray-100)">
                    <span style="font-size:1.3rem">📄</span>
                    <a href="https://drive.google.com/file/d/${f.id}/view" target="_blank" rel="noopener"
                       style="flex:1;font-size:0.88rem;color:var(--wds-primary);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</a>
                </div>`).join('');

            const isRoot = window.__driveStack.length === 0;
            const parentBtn = isRoot ? '' : `
                <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:14px" onclick="drivePopTo(${window.__driveStack.length - 1})"
                   >
                    ←
                </button>`;

            const bcItems = [{ id: DRIVE_ROOT_FOLDER_ID, name: '활동기록' }, ...window.__driveStack];
            const bcHtml = bcItems.map((b, i) => {
                const isLast = i === bcItems.length - 1;
                return isLast
                    ? `<span style="color:var(--wds-black);font-weight:700">${escapeHtml(b.name)}</span>`
                    : `<span onclick="drivePopTo(${i})" style="cursor:pointer;color:var(--wds-primary)">${escapeHtml(b.name)}</span> <span style="color:var(--wds-gray-300)">›</span> `;
            }).join('');

            // 페이지네이션 슬라이스
            const imgPage  = pg.images || 0;
            const vidPage  = pg.videos || 0;
            const imgSlice = images.slice(imgPage * DRIVE_IMG_PER_PAGE, (imgPage + 1) * DRIVE_IMG_PER_PAGE);
            const vidSlice = videos.slice(vidPage * DRIVE_VID_PER_PAGE, (vidPage + 1) * DRIVE_VID_PER_PAGE);

            root.innerHTML = `
                <div style="padding:16px 16px 0">
                    <div style="font-size:0.83rem;margin-bottom:14px">${bcHtml}</div>
                    ${parentBtn}
                    ${folders.length ? `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">${folderCards}</div>` : ''}
                    ${images.length ? `
                        <div style="font-size:0.8rem;font-weight:700;color:var(--wds-gray-500);margin-bottom:10px">사진 (${images.length})</div>
                        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:6px">
                            ${imgSlice.map(f => mediaCard(f, 'image')).join('')}
                        </div>
                        ${drivePageControls('images', imgPage, images.length, DRIVE_IMG_PER_PAGE)}` : ''}
                    ${videos.length ? `
                        <div style="font-size:0.8rem;font-weight:700;color:var(--wds-gray-500);margin-bottom:10px">영상 (${videos.length})</div>
                        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:6px">
                            ${vidSlice.map(f => mediaCard(f, 'video')).join('')}
                        </div>
                        ${drivePageControls('videos', vidPage, videos.length, DRIVE_VID_PER_PAGE)}` : ''}
                    ${others.length ? `
                        <div style="font-size:0.8rem;font-weight:700;color:var(--wds-gray-500);margin-bottom:6px">기타 파일 (${others.length})</div>
                        <div style="margin-bottom:20px">${otherRows}</div>` : ''}
                    ${!folders.length && !images.length && !videos.length && !others.length
                        ? `<div style="text-align:center;padding:32px;color:var(--wds-gray-400)">폴더가 비어있습니다.</div>` : ''}
                </div>`;
        }

        async function renderDriveGallery(folderId) {
            const root = document.getElementById('driveGalleryRoot');
            if (!root) return;

            if (!DRIVE_API_KEY || !DRIVE_ROOT_FOLDER_ID) {
                root.innerHTML = `
                    <div style="padding:32px 16px;text-align:center;color:var(--wds-gray-500)">
                        <div style="font-size:2rem;margin-bottom:12px">📁</div>
                        <div style="font-weight:700;margin-bottom:8px;color:var(--wds-black)">드라이브 연결 설정이 필요합니다</div>
                        <div style="font-size:0.85rem;line-height:1.7">
                            index.html 상단의<br>
                            <code style="background:var(--wds-gray-100);padding:2px 6px;border-radius:4px">DRIVE_API_KEY</code> 와
                            <code style="background:var(--wds-gray-100);padding:2px 6px;border-radius:4px">DRIVE_ROOT_FOLDER_ID</code><br>
                            값을 입력해주세요.
                        </div>
                    </div>`;
                return;
            }

            root.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--wds-gray-400)">불러오는 중…</div>`;

            const effectiveFolder = folderId || DRIVE_ROOT_FOLDER_ID;
            const q = encodeURIComponent(`'${effectiveFolder}' in parents and trashed = false`);
            const fields = encodeURIComponent('files(id,name,mimeType,thumbnailLink,size,modifiedTime,videoMediaMetadata)');
            const url = `https://www.googleapis.com/drive/v3/files?q=${q}&key=${DRIVE_API_KEY}&fields=${fields}&orderBy=folder,name&pageSize=1000`;

            let files;
            try {
                const res = await fetch(url);
                const data = await res.json();
                if (!res.ok) {
                    const reason = data?.error?.errors?.[0]?.reason || '';
                    const msg = data?.error?.message || `HTTP ${res.status}`;
                    let hint = '';
                    if (res.status === 403) {
                        if (reason === 'accessNotConfigured' || reason === 'forbidden') hint = '<br><b>Google Cloud Console에서 Drive API가 활성화되어 있는지 확인해주세요.</b>';
                        else if (reason === 'keyInvalid') hint = '<br><b>API 키가 잘못되었습니다.</b>';
                        else hint = '<br><b>API 키 HTTP 리퍼러 제한을 확인하거나, 드라이브 폴더 공유 설정을 확인해주세요.</b>';
                    }
                    throw new Error(msg + hint);
                }
                files = data.files || [];
            } catch (e) {
                root.innerHTML = `<div style="padding:24px;text-align:center;color:#e53e3e;line-height:1.7">파일을 불러오지 못했습니다.<br><small>${e.message}</small></div>`;
                return;
            }

            // 파일 메타데이터 전역 맵
            window.__driveFileMeta = window.__driveFileMeta || {};
            files.forEach(f => { window.__driveFileMeta[f.id] = f; });

            const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
            const media   = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
            const images  = media.filter(f => f.mimeType.startsWith('image/'));
            const videos  = media.filter(f => f.mimeType.startsWith('video/') || f.videoMediaMetadata);
            const others  = media.filter(f => !f.mimeType.startsWith('image/') && !f.mimeType.startsWith('video/') && !f.videoMediaMetadata);

            // 전체 목록 저장 (모달 좌우 탐색 + 페이지네이션 공유)
            window.__driveAllFolders = folders;
            window.__driveAllImages  = images;
            window.__driveAllVideos  = videos;
            window.__driveAllOthers  = others;
            window.__driveCurrentVideos = videos.map(f => f.id);
            window.__driveCurrentImages = images.map(f => f.id);
            // 폴더 진입 시 페이지 초기화
            window.__drivePaging = { images: 0, videos: 0 };

            renderDriveGalleryContent();
        }

        async function driveDownload(fileId) {
            const meta = (window.__driveFileMeta || {})[fileId] || {};
            const filename = meta.name || 'download';
            const size = parseInt(meta.size || '0', 10);
            const LIMIT = 200 * 1024 * 1024; // 200MB

            // 너무 크면 Drive 뷰어로 폴백
            if (size > LIMIT) {
                showDriveFallbackSheet(fileId, `파일이 너무 큽니다 (${(size/1024/1024).toFixed(0)}MB)`);
                return;
            }

            // 진행률 토스트
            const toast = document.createElement('div');
            toast.id = 'driveDownloadToast';
            toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:14px 20px;border-radius:12px;font-size:0.85rem;z-index:99999;min-width:260px;max-width:90vw;box-shadow:0 4px 20px rgba(0,0,0,0.4)';
            toast.innerHTML = `
                <div style="margin-bottom:8px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">⬇ ${escapeHtml(filename)}</div>
                <div style="height:6px;background:rgba(255,255,255,0.18);border-radius:3px;overflow:hidden">
                    <div id="dlBar" style="height:100%;width:0%;background:var(--wds-primary);transition:width 0.2s"></div>
                </div>
                <div id="dlPct" style="margin-top:6px;font-size:0.75rem;color:rgba(255,255,255,0.7)">준비 중…</div>`;
            document.body.appendChild(toast);
            const bar = document.getElementById('dlBar');
            const pct = document.getElementById('dlPct');

            try {
                const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`;
                const res = await fetch(url);
                if (!res.ok) {
                    if (res.status === 403 || res.status === 404) {
                        toast.remove();
                        showDriveFallbackSheet(fileId, '파일에 직접 접근할 수 없습니다');
                        return;
                    }
                    throw new Error(`HTTP ${res.status}`);
                }
                const total = parseInt(res.headers.get('content-length') || size || '0', 10);
                const reader = res.body.getReader();
                const chunks = [];
                let loaded = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    if (total > 0) {
                        const p = Math.round(loaded / total * 100);
                        bar.style.width = p + '%';
                        pct.textContent = `${p}% · ${(loaded/1024/1024).toFixed(1)}MB / ${(total/1024/1024).toFixed(1)}MB`;
                    } else {
                        pct.textContent = `${(loaded/1024/1024).toFixed(1)}MB 받는 중…`;
                    }
                }

                pct.textContent = '저장 중…';
                const blob = new Blob(chunks);
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);

                bar.style.width = '100%';
                pct.textContent = '✓ 다운로드 완료';
                setTimeout(() => toast.remove(), 2500);
            } catch (e) {
                toast.remove();
                showDriveFallbackSheet(fileId, e.message || '다운로드 실패');
            }
        }

        function showDriveFallbackSheet(fileId, reason) {
            const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;
            const existing = document.getElementById('driveDownloadSheet');
            if (existing) existing.remove();
            const sheet = document.createElement('div');
            sheet.id = 'driveDownloadSheet';
            sheet.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:flex-end;justify-content:center';
            sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
            sheet.innerHTML = `
                <div style="width:100%;max-width:480px;background:#fff;border-radius:18px 18px 0 0;padding:24px 20px 36px;box-sizing:border-box">
                    <div style="width:36px;height:4px;background:#ddd;border-radius:2px;margin:0 auto 20px"></div>
                    <div style="font-weight:700;font-size:1rem;margin-bottom:6px">⚠️ ${escapeHtml(reason)}</div>
                    <div style="font-size:0.85rem;color:#666;margin-bottom:20px;line-height:1.6">
                        Google Drive에서 직접 다운로드해주세요.<br>
                        뷰어 우상단 <b>⋮ → 다운로드</b>
                    </div>
                    <a href="${viewUrl}" target="_blank" rel="noopener"
                       style="display:block;text-align:center;padding:13px;background:var(--wds-primary);color:#fff;border-radius:12px;font-weight:700;font-size:0.95rem;text-decoration:none;margin-bottom:10px"
                       onclick="document.getElementById('driveDownloadSheet').remove()">
                        Google Drive에서 열기 →
                    </a>
                    <button type="button" class="gaa-btn gaa-btn-block gaa-btn-secondary" onclick="document.getElementById('driveDownloadSheet').remove()">닫기</button>
                </div>`;
            document.body.appendChild(sheet);
        }

        function openDrivePreview(fileId, type) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px';
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

            const closeBtn = `<button onclick="this.closest('[data-drive-overlay]').remove()" style="position:absolute;top:12px;right:12px;background:rgba(255,255,255,0.18);border:none;color:#fff;font-size:1.3rem;width:38px;height:38px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>`;
            overlay.setAttribute('data-drive-overlay', '1');

            if (type === 'video') {
                const videos = window.__driveCurrentVideos || [];
                let curIdx = videos.indexOf(fileId);
                if (curIdx === -1) { videos.unshift(fileId); curIdx = 0; }

                overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999;display:flex;flex-direction:column';
                overlay.onclick = null;

                const hdrH = 52;
                const iframeH = Math.max(window.innerHeight - hdrH, 200);
                const iframeW = window.innerWidth;

                // 영상 로드 함수 (좌우 탐색 시 재사용)
                const loadVideo = (idx) => {
                    const fid = videos[idx];
                    const m = (window.__driveFileMeta || {})[fid] || {};
                    const dl = fid; // driveDownload에 fileId 전달
                    const name = m.name || '';
                    const iframeId = 'driveIframe_' + Date.now();
                    const hasPrev = idx > 0;
                    const hasNext = idx < videos.length - 1;
                    const counter = videos.length > 1 ? `<span style="color:rgba(255,255,255,0.55);font-size:0.78rem;white-space:nowrap">${idx+1} / ${videos.length}</span>` : '';
                    overlay.innerHTML = `
                        <div style="width:100%;height:${hdrH}px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#111;box-sizing:border-box;flex-shrink:0">
                            <button onclick="document.querySelector('[data-drive-overlay]').remove()"
                                style="background:rgba(255,255,255,0.12);border:none;color:#fff;font-size:1.1rem;width:38px;height:38px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
                            <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.78rem;color:rgba(255,255,255,0.75);min-width:0">${escapeHtml(name)}</div>
                            ${counter}
                            <button class="gaa-btn gaa-btn-xs gaa-btn-primary" style="white-space:nowrap;flex-shrink:0" onclick="driveDownload('${dl}')"
                              >⬇</button>
                        </div>
                        <div id="${iframeId}_loading" style="position:absolute;top:${hdrH}px;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.45);font-size:0.9rem;pointer-events:none">영상 불러오는 중…</div>
                        <iframe id="${iframeId}" src="https://drive.google.com/file/d/${fid}/preview"
                            style="width:${iframeW}px;height:${iframeH}px;border:none;display:block;flex-shrink:0"
                            allow="autoplay; fullscreen" allowfullscreen
                            onload="document.getElementById('${iframeId}_loading').style.display='none'"></iframe>
                        ${hasPrev ? `<button onclick="window.__driveNavTo(${idx-1})" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:1.6rem;width:44px;height:44px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10">‹</button>` : ''}
                        ${hasNext ? `<button onclick="window.__driveNavTo(${idx+1})" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:1.6rem;width:44px;height:44px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10">›</button>` : ''}`;

                    // 스와이프 제스처
                    let tx = 0;
                    const iframe = document.getElementById(iframeId);
                    overlay.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
                    overlay.addEventListener('touchend', e => {
                        const dx = e.changedTouches[0].clientX - tx;
                        if (Math.abs(dx) < 50) return;
                        if (dx < 0 && hasNext) window.__driveNavTo(idx + 1);
                        else if (dx > 0 && hasPrev) window.__driveNavTo(idx - 1);
                    }, { passive: true });
                };

                window.__driveNavTo = (idx) => { loadVideo(idx); };
                loadVideo(curIdx);
            } else {
                // 이미지: 라이트박스 + 좌우 탐색
                const imgs = window.__driveCurrentImages || [];
                let curIdx = imgs.indexOf(fileId);
                if (curIdx === -1) { imgs.unshift(fileId); curIdx = 0; }
                overlay.setAttribute('data-drive-overlay', '1');

                const loadImage = (idx) => {
                    const fid = imgs[idx];
                    const m = (window.__driveFileMeta || {})[fid] || {};
                    const hasPrev = idx > 0;
                    const hasNext = idx < imgs.length - 1;
                    const counter = imgs.length > 1 ? `<div style="position:absolute;top:14px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.55);color:#fff;padding:5px 12px;border-radius:14px;font-size:0.78rem;z-index:2">${idx+1} / ${imgs.length}</div>` : '';
                    overlay.innerHTML = `${closeBtn}
                        ${counter}
                        <img src="https://drive.google.com/thumbnail?id=${fid}&sz=w1600" alt="${escapeHtml(m.name||'')}"
                             style="max-width:min(96vw,1200px);max-height:72vh;border-radius:10px;object-fit:contain">
                        <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
                            <a href="https://drive.google.com/file/d/${fid}/view" target="_blank" rel="noopener"
                               style="padding:9px 20px;background:rgba(255,255,255,0.15);color:#fff;border-radius:10px;font-size:0.85rem;font-weight:600;text-decoration:none">↗ 드라이브</a>
                            <button class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="driveDownload('${fid}')"
                              >⬇ 다운로드</button>
                        </div>
                        ${hasPrev ? `<button onclick="window.__driveImgNavTo(${idx-1})" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:1.6rem;width:44px;height:44px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10">‹</button>` : ''}
                        ${hasNext ? `<button onclick="window.__driveImgNavTo(${idx+1})" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:1.6rem;width:44px;height:44px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10">›</button>` : ''}`;

                    let tx = 0;
                    overlay.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
                    overlay.addEventListener('touchend', e => {
                        const dx = e.changedTouches[0].clientX - tx;
                        if (Math.abs(dx) < 50) return;
                        if (dx < 0 && hasNext) window.__driveImgNavTo(idx + 1);
                        else if (dx > 0 && hasPrev) window.__driveImgNavTo(idx - 1);
                    }, { passive: true });
                };

                window.__driveImgNavTo = (idx) => { loadImage(idx); };
                loadImage(curIdx);
            }
            document.body.appendChild(overlay);
        }

        // ══ GatheO 멤버 페이지 개편(2026-10-15, 시안 B) ═══════════════════════════════════════════
        // 홈 탭: 인사 → 다음 합주 카드(참석 상태·참석자) → 내 다음 예약 → 공지(접힘) → 바로가기 → 게시판 새 글
        // 탭 전환 체감 속도(2026-10-16): 멤버 하위 화면·마이는 마지막으로 그린 HTML 을 캐시해 두고 다시 들어오면 그걸 즉시 보여준 뒤
        // 서버 데이터로 갱신한다(stale-while-revalidate). 자리표시("불러오는 중")는 보여줄 캐시가 없을 때만.
        const _gtViewCache = {};
        const _GT_PLACEHOLDER = '<p style="color:var(--wds-gray-500);font-size:0.9rem;text-align:center;padding:20px">불러오는 중...</p>';
        function _gtPlaceholder(el) { if (el && !el.dataset.cached) el.innerHTML = _GT_PLACEHOLDER; }
        // ── 이동 뒤 포커스(2026-10-19): 홈 카드·편집 버튼 등에서 다른 탭/폼으로 갈 때 해당 요소로 스크롤(앱 바 54px 만큼 띄움)·잠깐 강조(.gt-flash)·첫 입력 포커스.
        //    비동기 렌더 뒤에 생기는 요소는 최대 3초(100ms×tries) 기다린다. ifHidden:true 면 이미 화면에 다 보이는 요소는 스크롤하지 않는다. focus 는 포인터 기기에서만(터치는 키보드가 올라오지 않게).
        function gtFocus(target, opts = {}) {
            const { tries = 30, focus = null, flash = true, block = 'start', ifHidden = false } = opts;
            let n = 0;
            const tick = () => {
                const el = typeof target === 'string' ? document.querySelector(target) : target;
                if (!el || !el.isConnected || el.offsetParent === null) { if (n++ < tries) setTimeout(tick, 100); return; }
                const r = el.getBoundingClientRect();
                const visible = r.top >= 64 && r.bottom <= innerHeight - 60;
                if (!(ifHidden && visible)) {
                    const top = window.scrollY + r.top - (block === 'center' ? Math.max(70, (innerHeight - r.height) / 2) : 70);
                    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
                }
                if (flash) { el.classList.remove('gt-flash'); void el.offsetWidth; el.classList.add('gt-flash'); setTimeout(() => el.classList.remove('gt-flash'), 1700); }
                if (focus) setTimeout(() => { const f = el.querySelector(focus); if (f && (!window.matchMedia || matchMedia('(hover:hover)').matches)) f.focus({ preventScroll: true }); }, 400);
            };
            setTimeout(tick, 0);
        }
        // ── 일정표 참여자 명단 보기(2026-10-16): [이름|세션별|팀장별] — 패널(.gt-att)에 ids 를 data 로 두고 모드 전환 시 제자리에서 다시 그린다 ──
        const _ATT_MODES = [['plain', '이름'], ['session', '세션별'], ['leader', '팀장별']];
        function _attPanelHTML(ids, opts) {
            const mode = state.attMode || 'session';
            const seg = `<div class="gt-att-seg">${_ATT_MODES.map(([k, l]) => `<button type="button" data-mode="${k}" class="${mode === k ? 'on' : ''}" onclick="event.stopPropagation();gtAttMode('${k}')">${l}</button>`).join('')}</div>`;
            const guests = opts.guests && opts.guests.length ? `<div class="gt-att-guests"><div class="gt-att-h">👥 외부 참여<b>${_guestTotal(opts.guests)}</b></div><div class="gt-att-chips">${_guestChipsHTML(opts.guests, opts.myId)}</div></div>` : '';
            return `<div class="gt-att" data-ids="${ids.join(',')}" data-team="${opts.teamId || ''}" data-my="${opts.myId || ''}">${ids.length ? seg + `<div class="gt-att-body">${_attBodyHTML(ids, opts)}</div>` : ''}${guests}</div>`;
        }
        // ── 외부인 참여 신청(2026-11-02): 멤버가 슬롯마다 「몇 명·누구」 한 줄 — state.scheduleGuests[date] = 행 배열(slot_key = slotAttKey)
        function _dateGuests(date) { return ((state.scheduleGuests || {})[date] || []); }
        // 날짜별 「외부인 참여 신청 받기」(schedules.allow_guests, 2026-11-02) — 컬럼이 없으면(마이그레이션 전) 허용, 있으면 그 날짜 행 중 하나라도 true 일 때
        function _guestsAllowed(date) {
            const rows = (state.schedules || []).filter(x => x.date === date);
            if (!rows.length) return false;
            if (rows.every(x => x.allow_guests === undefined)) return true;
            return rows.some(x => x.allow_guests === true);
        }
        function _slotGuests(date, key) { return _dateGuests(date).filter(g => (g.slot_key || '') === key); }
        function _guestTotal(list) { return (list || []).reduce((n, g) => n + (Number(g.guest_count) || 0), 0); }
        function _guestChipsHTML(list, myId) {
            return (list || []).map(g => {
                const host = _gtMemberById(g.host_profile_id); const hn = host ? host.name.replace(/\s*\(.*?\)\s*$/, '') : '멤버';
                const names = (g.guest_names || '').trim();
                const label = names ? escapeHtml(names) : `외부 ${g.guest_count}명`;
                const cnt = names && Number(g.guest_count) > 1 ? ` <b style="font-weight:800">${g.guest_count}명</b>` : '';
                return `<span class="gt-att-chip guest${g.host_profile_id === myId ? ' me' : ''}" title="${escapeHtml(hn)} 님이 데려오는 외부 참여자">👤 ${label}${cnt} <small>· ${escapeHtml(hn)}</small></span>`;
            }).join('');
        }
        // 슬롯의 외부인 신청 시트 — 내 줄이 있으면 수정·삭제, 없으면 새로
        function gtGuestSheet(date, gn, startTime) {
            if (!state.user) { showToast('로그인이 필요합니다.'); return; }
            const me = _gtMe(); if (!me) { showToast('승인된 멤버만 외부인 참여를 신청할 수 있어요.'); return; }
            if (state._guestsUnavailable) { showToast('외부인 참여 기능을 쓰려면 Supabase 에서 20261102_schedule_guests.sql 을 실행해주세요.'); return; }
            const key = slotAttKey(gn, startTime);
            const mine = _slotGuests(date, key).find(g => g.host_profile_id === me.id) || null;
            if (!mine && !_guestsAllowed(date)) { showToast('이 일정은 외부인 참여 신청을 받지 않아요.'); return; }
            if (!mine) { const p = checkSignupPeriod(date); if (!p.ok) { showToast(p.msg, 4000); return; } }
            const opts = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<option value="${n}" ${mine && Number(mine.guest_count) === n ? 'selected' : ''}>${n}명</option>`).join('');
            gtSheetOpen(`외부인 참여 신청 · ${_gtFmtDate(date)} ${escapeHtml(startTime || '')}`, `
                <form class="gt-guest-form" id="gtGuestForm" onsubmit="event.preventDefault();gtGuestSave('${date}','${(gn || '').replace(/'/g, "\\'")}','${startTime || ''}')">
                    <div class="row"><label for="gtGuestCount">인원 수</label><select id="gtGuestCount">${opts}</select></div>
                    <div class="row"><label for="gtGuestNames">누구</label><input type="text" id="gtGuestNames" maxlength="80" placeholder="예: 김민수, 박지영(친구)" value="${escapeHtml(mine ? mine.guest_names || '' : '')}"></div>
                    <div class="hint">내 신청과 별도로 데려오는 사람입니다. 전체 참여자 수에 합산되고, 참여 횟수에는 들어가지 않아요.</div>
                    <div id="gtGuestResult" style="font-size:0.84rem;min-height:20px;color:#e74c3c;margin-bottom:6px"></div>
                    <div style="display:flex;gap:8px">
                        ${mine ? `<button type="button" class="gaa-btn gaa-btn-danger" style="flex:1" onclick="gtGuestDelete('${mine.id}','${date}')">삭제</button>` : ''}
                        <button type="submit" class="gaa-btn gaa-btn-primary" style="flex:2">${mine ? '수정 저장' : '신청'}</button>
                    </div>
                </form>`);
            setTimeout(() => { const f = document.getElementById('gtGuestNames'); if (f && (!window.matchMedia || matchMedia('(hover:hover)').matches)) f.focus(); }, 250);
        }
        async function gtGuestSave(date, gn, startTime) {
            const me = _gtMe(); if (!me || !supabaseClient) return;
            const key = slotAttKey(gn, startTime);
            const count = Math.max(1, Math.min(30, parseInt(document.getElementById('gtGuestCount').value, 10) || 1));
            const names = (document.getElementById('gtGuestNames').value || '').trim().slice(0, 80);
            const res = document.getElementById('gtGuestResult');
            const mine = _slotGuests(date, key).find(g => g.host_profile_id === me.id) || null;
            const payload = { guest_count: count, guest_names: names, updated_at: new Date().toISOString() };
            let error, row;
            if (mine) { ({ error } = await supabaseClient.from('schedule_guests').update(payload).eq('id', mine.id)); row = Object.assign({}, mine, payload); }
            else {
                const ins = { schedule_date: date, slot_key: key, host_profile_id: me.id, ...payload };
                const r = await supabaseClient.from('schedule_guests').insert(ins).select().single(); error = r.error; const d = Array.isArray(r.data) ? r.data[0] : r.data; row = d || Object.assign({ id: 'tmp-' + Date.now() }, ins);
            }
            if (error) {
                console.error('schedule_guests save error:', error);
                if (error.code === '42P01') { state._guestsUnavailable = true; if (res) res.textContent = 'Supabase 에서 20261102_schedule_guests.sql 을 먼저 실행해주세요.'; }
                else if (res) res.textContent = '저장하지 못했습니다. 잠시 후 다시 시도해주세요.';
                return;
            }
            if (!state.scheduleGuests) state.scheduleGuests = {};
            state.scheduleGuests[date] = _dateGuests(date).filter(g => g.id !== row.id).concat([row]);
            gtSheetClose(); showToast(mine ? '외부인 참여 내용을 수정했어요.' : `외부인 ${count}명 참여를 신청했어요.`);
            renderMemberPanel(); gtHomeRefresh();
        }
        // ── 팀으로 신청(2026-11-03): 내가 속한 진행 중 팀을 골라 팀원 전원을 그 슬롯에 신청/취소 — 행은 개인 신청과 같은 schedule_attendees(slot 키)
        function _myActiveTeams(myId) {
            if (!myId) return [];
            return (state.teams || []).filter(t => !isPastTeam(t) && (t.members || []).some(sl => sl.memberId === myId));
        }
        function _teamMemberIds(t) { return [...new Set(((t && t.members) || []).map(sl => sl.memberId).filter(Boolean))]; }
        function gtTeamApplySheet(date, gn, startTime) {
            if (!state.user) { showToast('로그인이 필요합니다.'); return; }
            const me = _gtMe(); if (!me) { showToast('승인된 멤버만 신청할 수 있어요.'); return; }
            const key = slotAttKey(gn, startTime);
            const teams = _myActiveTeams(me.id);
            if (!teams.length) { showToast('소속된 진행 중 팀이 없어요. 팀 탭에서 팀을 먼저 만들어주세요.'); return; }
            const cur = ((state.scheduleSlotAttendees || {})[date] || {})[key] || [];
            const period = checkSignupPeriod(date);
            const cards = teams.map(t => {
                const ids = _teamMemberIds(t), applied = ids.filter(id => cur.includes(id)), rest = ids.length - applied.length;
                const lid = teamLeaderId(t);
                const chips = [...ids].sort((a, b) => (b === lid ? 1 : 0) - (a === lid ? 1 : 0)).map(id => { const m = _gtMemberById(id); const n = m ? m.name.replace(/\s*\(.*?\)\s*$/, '') : '?'; const on = cur.includes(id); return `<span class="gt-att-chip${on ? ' me' : ''}" title="${on ? '신청됨' : '미신청'}">${id === lid ? '👑 ' : ''}${escapeHtml(n)}${on ? ' ✓' : ''}</span>`; }).join('');
                const canApply = rest > 0 && period.ok;
                return `<div class="gt-team-apply" data-team="${t.id}">
                    <div class="h"><b>${escapeHtml(t.name)}</b><span>${applied.length}/${ids.length}명 신청됨</span></div>
                    <div class="gt-att-chips" style="margin:6px 0 10px">${chips}</div>
                    <div style="display:flex;gap:8px">
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex:2" ${canApply ? '' : 'disabled'} onclick="gtTeamApply('${date}','${key.replace(/'/g, "\\'")}','${t.id}')">${rest > 0 ? `팀 전체 신청 (+${rest}명)` : '모두 신청됨'}</button>
                        ${applied.length ? `<button type="button" class="gaa-btn gaa-btn-sm gaa-btn-danger" style="flex:1" onclick="gtTeamCancel('${date}','${key.replace(/'/g, "\\'")}','${t.id}')">팀 전체 취소</button>` : ''}
                    </div>
                </div>`;
            }).join('');
            gtSheetOpen(`팀으로 신청 · ${_gtFmtDate(date)} ${escapeHtml(startTime || '')}`, `
                ${period.ok ? '' : `<div style="font-size:0.82rem;color:#e74c3c;margin-bottom:10px">${escapeHtml(period.msg.replace(/\n/g, ' '))} — 취소만 할 수 있어요.</div>`}
                ${cards}
                <div style="font-size:0.78rem;color:var(--wds-gray-500);margin-top:4px">팀원 각자의 신청과 같은 기록이에요. 이미 신청한 팀원은 건너뛰고, 취소는 팀원 전원의 이 슬롯 신청을 지웁니다.</div>`);
        }
        async function gtTeamApply(date, key, teamId) {
            const me = _gtMe(); if (!me || !supabaseClient) return;
            const t = (state.teams || []).find(x => x.id === teamId); if (!t) return;
            const p = checkSignupPeriod(date); if (!p.ok) { showToast(p.msg, 4000); return; }
            const cur = ((state.scheduleSlotAttendees || {})[date] || {})[key] || [];
            const ids = _teamMemberIds(t).filter(id => !cur.includes(id));
            if (!ids.length) { showToast('이미 모두 신청돼 있어요.'); return; }
            const { error } = await supabaseClient.from('schedule_attendees').insert(ids.map(id => ({ schedule_date: date, profile_id: id, group_name: key })));
            if (error) { console.error('team apply error:', error); showToast('신청하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            if (!state.scheduleSlotAttendees) state.scheduleSlotAttendees = {};
            if (!state.scheduleSlotAttendees[date]) state.scheduleSlotAttendees[date] = {};
            state.scheduleSlotAttendees[date][key] = [...cur, ...ids];
            gtSheetClose(); showToast(`${t.name} 팀원 ${ids.length}명을 신청했어요.`);
            renderMemberPanel(); gtHomeRefresh();
        }
        async function gtTeamCancel(date, key, teamId) {
            const me = _gtMe(); if (!me || !supabaseClient) return;
            const t = (state.teams || []).find(x => x.id === teamId); if (!t) return;
            const cur = ((state.scheduleSlotAttendees || {})[date] || {})[key] || [];
            const ids = _teamMemberIds(t).filter(id => cur.includes(id));
            if (!ids.length) return;
            if (!confirm(`${t.name} 팀원 ${ids.length}명의 이 슬롯 신청을 모두 취소할까요?`)) return;
            const { error } = await supabaseClient.from('schedule_attendees').delete().eq('schedule_date', date).eq('group_name', key).in('profile_id', ids);
            if (error) { console.error('team cancel error:', error); showToast('취소하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            state.scheduleSlotAttendees[date][key] = cur.filter(id => !ids.includes(id));
            gtSheetClose(); showToast(`${t.name} 팀원 ${ids.length}명의 신청을 취소했어요.`);
            renderMemberPanel(); gtHomeRefresh();
        }
        async function gtGuestDelete(id, date) {
            if (!supabaseClient || !confirm('외부인 참여 신청을 삭제할까요?')) return;
            const { error } = await supabaseClient.from('schedule_guests').delete().eq('id', id);
            if (error) { console.error('schedule_guests delete error:', error); showToast('삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'); return; }
            if (state.scheduleGuests) state.scheduleGuests[date] = _dateGuests(date).filter(g => g.id !== id);
            gtSheetClose(); showToast('외부인 참여 신청을 삭제했어요.');
            renderMemberPanel(); gtHomeRefresh();
        }
        function gtAttMode(mode) {
            state.attMode = mode;
            document.querySelectorAll('.gt-att').forEach(p => {
                const ids = (p.dataset.ids || '').split(',').filter(Boolean);
                p.querySelectorAll('.gt-att-seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
                p.querySelector('.gt-att-body').innerHTML = _attBodyHTML(ids, { myId: p.dataset.my || null, teamId: p.dataset.team || null });
            });
        }
        function _attChip(id, myId) {
            const m = _gtMemberById(id); const name = m ? m.name.replace(/\s*\(.*?\)\s*$/, '') : '?';
            return `<span class="gt-att-chip${id === myId ? ' me' : ''}">${_gtAvatarOf(m, name)}${escapeHtml(name)}</span>`;
        }
        function _attBodyHTML(ids, { myId, teamId }) {
            const mode = state.attMode || 'session';
            const sorted = [...ids].sort((a, b) => (b === myId ? 1 : 0) - (a === myId ? 1 : 0)); // 나를 맨 앞으로
            if (mode === 'plain') return `<div class="gt-att-chips">${sorted.map(id => _attChip(id, myId)).join('')}</div>`;
            const groups = [];
            if (mode === 'session') {
                const ORDER = ['보컬', '기타', '베이스', '키보드', '드럼'];
                const by = {};
                sorted.forEach(id => { const m = _gtMemberById(id); const k = ((m && m.instruments) || '').split(',').map(x => x.trim()).filter(Boolean)[0] || '미지정'; (by[k] = by[k] || []).push(id); });
                Object.keys(by).sort((a, b) => { const ai = ORDER.indexOf(a), bi = ORDER.indexOf(b); if (ai === -1 && bi === -1) return a.localeCompare(b, 'ko'); if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi; })
                    .forEach(k => groups.push({ label: `${INST_EMOJI[k] || '🎵'} ${escapeHtml(k)}`, ids: by[k] }));
            } else {
                // 팀장별 = 소속 팀(진행 중)별, 머리글은 팀장 이름 — 이 슬롯의 팀이 있으면 그 팀 먼저, 여러 팀이면 각각에 표시
                const teams = (state.teams || []).filter(t => !isPastTeam(t)).sort((a, b) => (b.id === teamId ? 1 : 0) - (a.id === teamId ? 1 : 0));
                const placed = new Set();
                teams.forEach(t => {
                    const lid = teamLeaderId(t);
                    const inT = sorted.filter(id => (t.members || []).some(sl => sl.memberId === id)).sort((a, b) => (b === lid ? 1 : 0) - (a === lid ? 1 : 0));
                    if (!inT.length) return;
                    inT.forEach(id => placed.add(id));
                    const lead = _gtMemberById(lid);
                    groups.push({ label: `👑 ${lead ? escapeHtml(lead.name.replace(/\s*\(.*?\)\s*$/, '')) : '팀장 미지정'} <small>· ${escapeHtml(t.name)}</small>`, ids: inT });
                });
                const rest = sorted.filter(id => !placed.has(id));
                if (rest.length) groups.push({ label: '소속 팀 없음', ids: rest });
            }
            return groups.map(g => `<div class="gt-att-grp"><div class="gt-att-h">${g.label}<b>${g.ids.length}</b></div><div class="gt-att-chips">${g.ids.map(id => _attChip(id, myId)).join('')}</div></div>`).join('');
        }
        function _gtMe() {
            const u = state.user; if (!u) return null;
            return (state.cachedMembers || []).find(m => m.kakao_id === u.kakaoId || m.id === u.kakaoId || (u.email && m.email && m.email === u.email)) || null;
        }
        function _gtMemberById(id) { return (state.cachedMembers || []).find(m => m.id === id) || null; }
        function _gtMemberByKakao(kid) { return (state.cachedMembers || []).find(m => m.kakao_id === kid || m.id === kid) || null; }
        function _gtAvatarOf(m, fallbackName) { return gaAvatar(m ? m.name : (fallbackName || '?'), { url: m && m.avatar_url }); }
        function _gtFmtDate(d) {
            const [y, m, dd] = String(d).split('-').map(Number); if (!y) return '';
            return `${m}/${dd} (${['일','월','화','수','목','금','토'][new Date(y, m - 1, dd).getDay()]})`;
        }
        function _gtDday(iso) {
            if (!iso) return null; const c = new Date(iso), n = new Date(); if (isNaN(c)) return null;
            const days = Math.ceil((new Date(c.getFullYear(), c.getMonth(), c.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
            return days > 0 ? `D-${days}` : days === 0 ? 'D-day' : null;
        }
        function _gtAgo(iso) {
            const ms = Date.now() - new Date(iso).getTime(); if (isNaN(ms)) return '';
            const m = Math.floor(ms / 60000); if (m < 1) return '방금'; if (m < 60) return `${m}분 전`;
            const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`; const d = Math.floor(h / 24); if (d < 7) return `${d}일 전`;
            return new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
        }
        function _gtDateAttendees(date) {
            const a = (state.scheduleAttendees || {})[date] || [];
            const g = Object.values((state.scheduleGroupAttendees || {})[date] || {}).flat();
            const s = Object.values((state.scheduleSlotAttendees || {})[date] || {}).flat();
            return [...new Set([...a, ...g, ...s])];
        }
        let _gtAttInflight = null;
        function gtHomeRefresh() { if (state.gatheoTab !== 'home') return; clearTimeout(window._gtHomeT); window._gtHomeT = setTimeout(renderGatheoHome, 60); }
        function renderGatheoHome() {
            const el = document.getElementById('gatheOTabHome'); if (!el || !state.user) return;
            const today = new Date().toLocaleDateString('en-CA');
            const me = _gtMe(); const myId = me ? me.id : null;
            const name = ((me && me.name) || state.user.nickname || '멤버').replace('(관리자)', '').trim();
            // ── 다음 합주(날짜 단위) + 참석 상태
            const upcoming = (state.schedules || []).filter(s => s.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
            const dates = [...new Set(upcoming.map(s => s.date))].slice(0, 30);
            if (dates.length && !_gtAttInflight && dates.some(d => !(state._attLoaded && state._attLoaded.has(d)))) {
                _gtAttInflight = fetchScheduleAttendees(dates).catch(() => {}).then(() => { _gtAttInflight = null; if (state.gatheoTab === 'home') renderGatheoHome(); });
            }
            const in7 = (d) => { const diff = (new Date(d + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000; return diff >= 0 && diff < 7; };
            let bigHtml = '';
            if (!dates.length) {
                bigHtml = `<div class="gt-big"><div class="eb">다음 합주</div><h3>예정된 합주 일정이 없어요</h3><p>일정이 등록되면 여기에 바로 보여드릴게요.</p></div>`;
            } else {
                const date = dates[0], entries = upcoming.filter(s => s.date === date), first = entries[0];
                const title = [...new Set(entries.map(e => e.group_name || e.team_name).filter(Boolean))].slice(0, 2).join(' · ') || '합주 일정';
                const last = entries[entries.length - 1];
                const timeRange = `${first.start_time || ''}${last.end_time ? ' ~ ' + last.end_time : ''}`;
                const att = _gtDateAttendees(date), mine = !!(myId && att.includes(myId));
                const now = new Date();
                const closed = !!(first.signup_close && now > new Date(first.signup_close));
                const before = !!(first.signup_open && now < new Date(first.signup_open));
                const dd = !closed && first.signup_close ? _gtDday(first.signup_close) : null;
                const stack = att.slice(0, 3).map(id => _gtAvatarOf(_gtMemberById(id))).join('') + (att.length > 3 ? `<span class="ga-avatar" style="background:rgba(255,255,255,0.3)">+${att.length - 3}</span>` : '');
                // 상태 줄: 참석 확정은 아래 줄에서 한 번만 말하고, 여기엔 메모와 신청 상태만
                const status = mine ? '' : closed ? '신청 마감' : before ? '신청 전' : dd ? `신청 마감 ${dd}` : '신청 가능';
                const pLine = [first.note ? escapeHtml(first.note) : '', status].filter(Boolean).join(' · ');
                const guestN = _guestTotal(_dateGuests(date)), totalN = att.length + guestN; // 외부인 합산(2026-11-02)
                const info = totalN ? `${totalN}명 참석${guestN ? ` (외부 ${guestN})` : ''}${mine ? ' · 참석 확정 ✓' : ''}` : (mine ? '참석 확정 ✓' : '아직 참석 신청이 없어요');
                bigHtml = `<div class="gt-big" id="gtNextSched">
                    <div class="eb">다음 합주 · ${_gtFmtDate(date)} ${escapeHtml(timeRange)}</div>
                    <h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                    ${pLine ? `<p>${pLine}</p>` : ''}
                    <div class="ft">
                        ${att.length ? `<div class="gt-stack">${stack}</div>` : ''}<span class="info">${info}</span>
                        <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" onclick="openScheduleForDate('${date}')">${mine || closed || before ? '일정 보기' : '참석 신청'}</button>
                    </div></div>`;
                // 운영진이 배너로 표시한 다른 날짜(show_banner, 신청 마감 전)는 큰 카드 아래 한 줄씩 — 옛 보라색 일정 배너의 자리
                const flagged = dates.filter(d => d !== date && upcoming.some(s => s.date === d && s.show_banner) && !upcoming.filter(s => s.date === d).some(s => s.signup_close && now > new Date(s.signup_close))).slice(0, 2);
                bigHtml += flagged.map(d => {
                    const es = upcoming.filter(s => s.date === d), f = es[0], l = es[es.length - 1];
                    const t = [...new Set(es.map(e => e.group_name || e.team_name).filter(Boolean))].slice(0, 2).join(' · ') || '합주 일정';
                    const tr = `${f.start_time || ''}${l.end_time ? ' ~ ' + l.end_time : ''}`;
                    return `<button type="button" class="gt-myres gt-banner" onclick="openScheduleForDate('${d}')">📌 ${_gtFmtDate(d)} <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">${escapeHtml(t)}</span><span class="r">${escapeHtml(tr)}</span></button>`;
                }).join('');
                const myNext = dates.find(d => myId && _gtDateAttendees(d).includes(myId));
                if (myNext && myNext !== date) bigHtml += `<button type="button" class="gt-myres" onclick="openScheduleForDate('${myNext}')">✅ 내 다음 참여 일정<span class="r">${_gtFmtDate(myNext)}</span></button>`;
            }
            // ── 내 다음 예약
            const myRes = (state.reservations || []).filter(r => r.kakao_id === state.user.kakaoId && r.res_date >= today && (r.status === 'approved' || r.status === 'pending'))
                .sort((a, b) => a.res_date.localeCompare(b.res_date) || TIMES.indexOf(a.start_time) - TIMES.indexOf(b.start_time));
            const r0 = myRes[0];
            let resHtml;
            if (r0) {
                const endDisp = TIMES[TIMES.indexOf(r0.end_time) + 1] || '23:00';
                const chip = r0.status === 'approved' ? '<span class="gt-chip ok">승인됨</span>' : '<span class="gt-chip wn">승인 대기</span>';
                const ids = Array.isArray(r0.participant_ids) ? r0.participant_ids : [];
                const stack = ids.slice(0, 4).map(id => _gtAvatarOf(_gtMemberById(id))).join('');
                const names = participantNames(r0) || (r0.participant_etc ? '기타: ' + r0.participant_etc : '');
                resHtml = `<div class="gt-card" id="gtNextRes">
                    <div class="gt-row">${chip}<b style="font-size:0.95rem">내 다음 예약</b><span style="margin-left:auto;font-size:0.78rem;color:var(--wds-gray-500)">${_gtFmtDate(r0.res_date)}</span></div>
                    <div class="gt-time">${r0.start_time} ~ ${endDisp}</div>
                    <div class="gt-row" style="margin-top:8px">${ids.length ? `<div class="gt-stack">${stack}</div>` : ''}<span style="font-size:0.78rem;color:var(--wds-gray-500);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(names || '멤버 미등록')}</span>${isReservationEditable(r0) ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="openEditParticipantsModal('${r0.id}')">멤버 수정</button>` : ''}</div>
                    ${myRes.length > 1 ? `<button type="button" class="gt-link" style="margin:4px 0 0" onclick="gtMypageSub('res')">예정 예약 ${myRes.length}건 전체 보기 ›</button>` : ''}
                </div>`;
            } else {
                resHtml = `<div class="gt-card gt-row" id="gtNextRes"><div style="flex:1;min-width:0"><b style="font-size:0.95rem">예정된 예약이 없어요</b><div style="font-size:0.78rem;color:var(--wds-gray-500);margin-top:2px">합주실을 쓰려면 먼저 예약해 주세요</div></div><button type="button" class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="setGatheOTab('reservation')">예약하기</button></div>`;
            }
            // ── 공지(최신 1건 접힘, 펼치면 전체)
            const ns = Array.isArray(notices) ? notices : [];
            const fmtN = (n) => new Date(n.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
            const ntcHtml = ns.length ? `<div class="gt-ntc${state.gtNoticeOpen ? ' open' : ''}" id="gtNotice" onclick="state.gtNoticeOpen=!state.gtNoticeOpen;renderGatheoHome()">
                <span>📢</span><b>${escapeHtml(ns[0].title)}</b><small>${fmtN(ns[0])}${ns.length > 1 ? ` · 공지 ${ns.length}` : ''}</small><small>${state.gtNoticeOpen ? '▴' : '▾'}</small>
                ${state.gtNoticeOpen ? ns.map((n, i) => `<div class="gt-ntc-body">${i ? `<b>${escapeHtml(n.title)} <small>${fmtN(n)}</small></b>` : ''}${escapeHtml(n.content || '')}</div>`).join('') : ''}
            </div>` : '';
            // ── 게시판 새 글
            const all = state.comments || [];
            const posts = all.filter(c => !c.parent_id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const newPosts = posts.filter(p => Date.now() - new Date(p.created_at).getTime() < 7 * 86400000).length;
            const postsHtml = posts.length ? `<div class="gt-card" style="padding:4px 16px">${posts.slice(0, 3).map(p => {
                const { title, body } = parseBoardPost(p.content);
                const t = title || String(body || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '(제목 없음)';
                const replies = all.filter(c => c.parent_id === p.id).length;
                return `<div class="gt-post" onclick="gtOpenPost('${p.id}')"><b>${escapeHtml(t)}</b><span>${escapeHtml(p.user_name || '')} · ${_gtAgo(p.created_at)}${replies ? ' · 답글 ' + replies : ''}${p.likes ? ' · ♥ ' + p.likes : ''}</span></div>`;
            }).join('')}</div>` : `<div class="gt-card" style="text-align:center;color:var(--wds-gray-500);font-size:0.84rem">아직 글이 없어요</div>`;
            const weekCnt = dates.filter(in7).length;
            el.innerHTML = `<div class="gt-hello"><h1>안녕하세요, ${escapeHtml(name)}님 👋</h1><p>이번 주 합주 ${weekCnt}건 · 내 예약 ${myRes.length}건 · 새 글 ${newPosts}</p></div>
                ${bigHtml}${resHtml}${ntcHtml}
                <div class="gt-qa">
                    <button type="button" onclick="setGatheOTab('reservation')"><i>📅</i>예약하기</button>
                    <button type="button" onclick="setMemberTab('schedule')"><i>🗓️</i>일정표</button>
                    <button type="button" onclick="setMemberTab('teams')"><i>🎸</i>팀 구성</button>
                    <button type="button" onclick="gtMypageSub('docs')"><i>📖</i>운영안내</button>
                </div>
                <div class="gt-sec"><h2>게시판 새 글</h2><button type="button" onclick="setGatheOTab('board')">전체 보기 ›</button></div>
                ${postsHtml}`;
        }
        function gtOpenPost(id) {
            setGatheOTab('board');
            let n = 0;
            const open = () => { // 게시판 fetch 가 끝나 글이 그려질 때까지(최대 4초) 기다린다(2026-10-19 — 고정 0.6초 대기는 느린 망에서 빗나갔다)
                const el = document.getElementById('board-post-' + id);
                if (!el) { if (n++ < 40) setTimeout(open, 100); return; }
                if (el.classList.contains('hidden')) toggleBoardPost(id);
                gtFocus(el.closest('.board-row-wrap') || el, { block: 'start' });
            };
            setTimeout(open, 50);
        }
        // 공용 바닥 시트(커뮤니티 .cm-sheet 스킨 재사용)
        function gtSheetOpen(title, html) {
            gtSheetClose();
            const w = document.createElement('div'); w.id = 'gtSheet'; w.className = 'cm-sheet-wrap'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', title);
            w.innerHTML = `<div class="cm-sheet-bg" onclick="gtSheetClose()"></div><div class="cm-sheet"><div class="cm-sheet-head"><span class="grab"></span><h3>${escapeHtml(title)}</h3><button type="button" class="cm-ib" onclick="gtSheetClose()" aria-label="닫기">✕</button></div><div class="cm-sheet-body">${html}</div></div>`;
            document.body.appendChild(w); document.body.classList.add('cm-sheet-open');
            requestAnimationFrame(() => w.classList.add('on'));
        }
        function gtSheetClose() { const w = document.getElementById('gtSheet'); if (!w) return; w.remove(); document.body.classList.remove('cm-sheet-open'); }
        function gtRulesSheet() {
            gtSheetOpen('예약 전 확인해주세요', `<ul style="margin:4px 0 8px;padding-left:18px;font-size:0.9rem;line-height:1.9;color:var(--wds-gray-800)">
                <li>예약 가능 시간: <strong>오전 8시 ~ 오후 11시</strong></li>
                <li><strong>2시간 초과</strong> 예약은 관리자 승인이 필요합니다</li>
                <li>합주실 사용 후 <strong>정리 및 원상복구</strong>는 필수입니다</li>
                <li>참여 멤버를 정확히 등록해주세요 <span style="color:var(--wds-gray-500)">(참여 횟수 집계에 반영됩니다)</span></li>
                <li>달력에서 날짜를 누르면 주간 시간표가 열리고, 시작·끝 칸을 차례로 누르면 시간이 정해집니다</li>
            </ul><button type="button" class="gaa-btn gaa-btn-block gaa-btn-primary" onclick="gtSheetClose()">확인</button>`);
        }
        // 예약 탭 머리 줄: 예정 예약의 승인/대기 수
        function gtUpdateMyResRow() {
            const el = document.getElementById('gtMyResChips'); if (!el || !state.user) return;
            const today = new Date().toLocaleDateString('en-CA');
            const mine = (state.reservations || []).filter(r => r.kakao_id === state.user.kakaoId && r.res_date >= today);
            const ok = mine.filter(r => r.status === 'approved').length, wait = mine.filter(r => r.status === 'pending').length;
            el.innerHTML = (ok ? `<span class="gt-chip ok">승인 ${ok}</span>` : '') + (wait ? `<span class="gt-chip wn">대기 ${wait}</span>` : '') + (!ok && !wait ? '<span class="gt-chip g">예정 없음</span>' : '');
        }
        // 마이 탭 하위 화면: res(내 예약) · taste(음악 취향) · docs(운영안내) · activity(활동 앨범)
        function gtMypageSub(kind) {
            if (state.gatheoTab !== 'mypage') setGatheOTab('mypage'); // 탭 전환(renderMypagePanel 비동기) — 아래 mypageSub 가 그 결과를 덮지 않게 막는다
            state.mypageSub = kind;
            renderMypageSubView();
            _pushNav('gatheo/mypage');
        }
        function renderMypageSubView() {
            const c = document.getElementById('mypagePanelContent'); if (!c || !state.mypageSub) return;
            const kind = state.mypageSub;
            const titles = { res: '내 예약', taste: '음악 취향', docs: '운영안내', activity: '활동 앨범' };
            c.innerHTML = `<div class="gt-sub-head"><button type="button" class="cm-ib" onclick="state.mypageSub=null;renderMypagePanel()" aria-label="마이로">‹</button><h2>${titles[kind] || ''}</h2></div><div id="gtSubBody"></div>`;
            const body = document.getElementById('gtSubBody');
            if (kind === 'res') {
                renderMyPage(body);
            } else if (kind === 'taste') {
                const p = state.myProfile;
                body.innerHTML = `<div class="gt-card" style="margin-top:0">${p && p.music_taste ? musicTasteTags(p.music_taste) : '<div style="font-size:0.86rem;color:var(--wds-gray-500)">아직 등록한 음악 취향이 없어요.</div>'}
                    <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="margin-top:12px" onclick="state.mypageSub=null;renderMypagePanel().then(()=>showMypageEditForm())">취향 수정</button></div>`;
            } else if (kind === 'docs') {
                renderDocsPage(body);
                // 문서 분류 버튼은 종전 달력 render() 대신 이 화면을 다시 그린다
                body.querySelectorAll('.docs-cat-tab').forEach(b => b.setAttribute('onclick', (b.getAttribute('onclick') || '').replace(/render\(\)/, 'renderMypageSubView()')));
            } else if (kind === 'activity') {
                body.innerHTML = '<div id="driveGalleryRoot"></div>';
                window.__driveStack = [];
                renderDriveGallery(DRIVE_ROOT_FOLDER_ID);
            }
            window.scrollTo({ top: 0 });
        }
        // 팀 카드 ⋯ → 수정/삭제 시트
        function gtTeamMenu(id) {
            const t = (state.teams || []).find(x => x.id === id); if (!t) return;
            gtSheetOpen(t.name, `<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0 6px">
                <button type="button" class="gaa-btn gaa-btn-block gaa-btn-secondary" onclick="gtSheetClose();editTeam('${id}')">팀 수정</button>
                <button type="button" class="gaa-btn gaa-btn-block gaa-btn-danger" onclick="gtSheetClose();deleteTeam('${id}')">팀 삭제</button></div>`);
        }

        function renderGatheOAdmin() {
            const container = document.getElementById('gatheOTabAdmin');
            if (!container) return;
            container.innerHTML = '';
            renderAdminPage(container);
        }

        // --- 마이페이지 ---
        function toggleMypagePanel() { setGatheOTab('mypage'); }


        async function renderMypagePanel(opts = {}) {
            const content = document.getElementById('mypagePanelContent');
            if (!content || !state.user) return;

            const isEmailUser = state.user.authType === 'email';
            if (_gtViewCache.mypage && !state.mypageSub) content.innerHTML = _gtViewCache.mypage; else content.innerHTML = _GT_PLACEHOLDER;

            let profile = null;
            if (opts.quick) {
                profile = _gtMe(); // 로그인 때 받아 둔 내 프로필 행(select('*'))
            } else {
                if (!_gtViewCache.mypage && _gtMe()) await renderMypagePanel({ quick: true }); // 첫 진입: 먼저 그려 두고 아래서 서버 값으로 갱신(2026-10-16)
                const lookupCol = isEmailUser ? 'id' : 'kakao_id';
                const { data, error } = await supabaseClient.from('profiles').select('*').eq(lookupCol, state.user.kakaoId).single();
                if (!error && data) profile = data;
            }

            if (state.teams.length === 0) await fetchTeams();

            let approvedCount = 0, pendingCount = 0;
            const myRes = state.reservations.filter(r => {
                if (r.kakao_id !== state.user.kakaoId) return false;
                if (r.status === 'approved') approvedCount++;
                else if (r.status === 'pending') pendingCount++;
                return true;
            });
            const myProfileId = profile ? profile.id : null;
            const baseResForCount = (state.reservations || []).filter(r => r.status === 'approved' || r.status === 'pending');
            const participationCount = countParticipationDates(myProfileId, baseResForCount, state.schedules || []);
            const myTeams = profile
                ? state.teams.filter(t => (t.members || []).some(s => s.memberId === profile.id))
                : [];

            state.myProfile = profile;
            if (state.mypageSub) { renderMypageSubView(); return; } // 하위 화면(내 예약·운영안내 …)이 열려 있으면 그쪽을 그린다
            const roleChipMap = { '운영 총괄': ['운영총괄', 'p'], '총괄': ['총괄', 'p'], '세션장': ['세션장', 'g'] };
            const rc = profile && roleChipMap[profile.role];
            const sessionChips = profile ? (profile.instruments || '').split(',').map(s => s.trim()).filter(Boolean).map((s, i) => `<span class="gt-chip ${i ? 'g' : 'p'}">${INST_EMOJI[s] ? INST_EMOJI[s] + ' ' : ''}${escapeHtml(s)}</span>`).join('') : '';
            const profileHtml = profile ? `
                <div id="mypageInfoView">
                    <div class="gt-prof">
                        ${gaAvatar(profile.name, { url: profile.avatar_url })}
                        <div style="flex:1;min-width:0">
                            <div class="nm">${escapeHtml(profile.name)}${rc ? `<span class="gt-chip ${rc[1]}" style="height:20px;font-size:0.66rem">${rc[0]}</span>` : ''}</div>
                            <div class="ss">${sessionChips || '<span style="font-size:0.78rem;color:var(--wds-gray-500)">세션 미입력</span>'}</div>
                        </div>
                        <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex-shrink:0" onclick="showMypageEditForm()">수정</button>
                    </div>
                </div>
                <div id="mypageEditForm" class="hidden" style="margin-top:12px" data-music-taste="${escapeHtml(typeof profile.music_taste === 'string' ? profile.music_taste : (profile.music_taste ? JSON.stringify(profile.music_taste) : ''))}">
                    <div style="display:flex;flex-direction:column;gap:8px">
                        <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700)">프로필 사진</label>
                        <div class="gt-avatar-edit" id="gtAvatarEdit">
                            ${gaAvatar(profile.name, { url: profile.avatar_url })}
                            <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0">
                                <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="gtAvatarPick('${profile.id}')">사진 바꾸기</button>${profile.avatar_url ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="gtAvatarReset('${profile.id}')">${state.user.kakaoAvatar ? '카카오 사진으로' : '기본(이니셜)으로'}</button>` : ''}</div>
                                <div style="font-size:0.74rem;color:var(--wds-gray-500)">기본은 카카오 프로필 사진이고, 여기서 바꾼 사진은 멤버 목록·게시판에 함께 보여요.</div>
                            </div>
                        </div>
                        <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700)">전화번호</label>
                        <input type="tel" id="mypagePhone" value="${escapeHtml(profile.phone || '')}" placeholder="010-0000-0000"
                            style="height:42px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;font-family:inherit;outline:none">
                        <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700)">메인 세션</label>
                        <div class="instrument-buttons" id="mypageInstBtns">
                            ${['보컬','기타','베이스','키보드','드럼'].map(inst => {
                                const icons = {보컬:'🎤',기타:'🎸',베이스:'<img src="https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/base_icon.png" style="height:16px;vertical-align:middle">',키보드:'🎹',드럼:'🥁'};
                                const mainInsts = ['보컬','기타','베이스','키보드','드럼'];
                                const firstMain = (profile.instruments || '').split(',').map(s=>s.trim()).find(s => mainInsts.includes(s)) || '';
                                const sel = firstMain === inst;
                                return `<button type="button" class="inst-btn${sel ? ' selected' : ''}" data-inst="${inst}" onclick="toggleInstrument(this)">${icons[inst]} ${inst}</button>`;
                            }).join('')}
                        </div>
                        <input type="text" id="mypageCustomInst" placeholder='","로 구분하여 추가 세션 작성'
                            value="${escapeHtml((profile.instruments || '').split(',').map(s=>s.trim()).filter(s=>s && !['보컬','기타','베이스','키보드','드럼'].includes(s)).join(', '))}"
                            style="height:42px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;font-family:inherit;outline:none">
                        <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700);margin-top:4px">음악 취향</label>
                        <div id="mtEdit_mypage" style="margin-top:6px"></div>
                        <div style="display:flex;gap:8px;margin-top:4px">
                            <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" type="button" onclick="hideMypageEditForm()"
                               >취소</button>
                            <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex:1" type="button" onclick="saveMypageProfile('${profile.id}')"
                               >저장</button>
                        </div>
                        ${isEmailUser ? `
                        <hr style="border:none;border-top:1px solid var(--wds-gray-300);margin:14px 0 6px">
                        <div style="font-size:0.82rem;font-weight:700;color:var(--wds-gray-700);margin-bottom:6px">비밀번호 변경</div>
                        <input type="password" id="changePwCurrent" placeholder="현재 비밀번호" autocomplete="current-password"
                            style="height:40px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.88rem;font-family:inherit;outline:none">
                        <input type="password" id="changePwNew" placeholder="새 비밀번호 (6자 이상)" autocomplete="new-password"
                            style="height:40px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.88rem;font-family:inherit;outline:none">
                        <input type="password" id="changePwConfirm" placeholder="새 비밀번호 확인" autocomplete="new-password"
                            style="height:40px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.88rem;font-family:inherit;outline:none">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="height:40px" type="button" onclick="handleChangePassword()"
                           >비밀번호 변경</button>
                        <div id="changePwResult" style="font-size:0.82rem;min-height:18px"></div>
                        ` : ''}
                    </div>
                </div>
                <hr style="border:none;border-top:1px solid var(--wds-gray-100);margin:16px 0">
            ` : (isEmailUser ? `<div style="font-size:0.85rem;color:var(--wds-gray-500);margin-bottom:16px">프로필을 찾을 수 없습니다.</div>` : `
                <div style="background:var(--wds-gray-100);padding:20px;border-radius:var(--wds-radius-m);text-align:center;margin-bottom:16px">
                    <div style="font-size:0.9rem;font-weight:700;margin-bottom:8px">멤버 가입 정보가 없습니다.</div>
                    <p style="font-size:0.82rem;color:var(--wds-gray-500);margin-bottom:16px">가입 정보를 등록하면 멤버 현황에 노출되며<br>팀 구성에 참여할 수 있습니다.</p>
                    <button class="submit-btn" style="height:44px;font-size:0.9rem" onclick="showMypageRegisterForm()">멤버 가입 정보 등록하기</button>
                </div>
                <div id="mypageRegisterForm" class="hidden" style="margin-top:12px;border:1px solid var(--wds-primary);padding:16px;border-radius:var(--wds-radius-m)">
                    <div style="display:flex;flex-direction:column;gap:12px">
                        <div>
                            <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700)">이름 (실명)</label>
                            <input type="text" id="regName" value="${escapeHtml(state.user.nickname || '')}" placeholder="실명 입력"
                                style="width:100%;height:42px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;font-family:inherit;outline:none;box-sizing:border-box">
                        </div>
                        <div>
                            <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700)">이메일</label>
                            <input type="email" id="regEmail" placeholder="example@email.com"
                                style="width:100%;height:42px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;font-family:inherit;outline:none;box-sizing:border-box">
                        </div>
                        <div>
                            <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700)">전화번호</label>
                            <input type="tel" id="regPhone" placeholder="010-0000-0000"
                                style="width:100%;height:42px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;font-family:inherit;outline:none;box-sizing:border-box">
                        </div>
                        <div>
                            <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700)">메인 세션</label>
                            <div class="instrument-buttons" id="regInstBtns">
                                ${['보컬','기타','베이스','키보드','드럼'].map(inst => {
                                    const icons = {보컬:'🎤',기타:'🎸',베이스:'<img src="https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/base_icon.png" style="height:16px;vertical-align:middle">',키보드:'🎹',드럼:'🥁'};
                                    return `<button type="button" class="inst-btn" data-inst="${inst}" onclick="toggleInstrument(this)">${icons[inst]} ${inst}</button>`;
                                }).join('')}
                            </div>
                            <input type="text" id="regCustomInst" placeholder='","로 구분하여 추가 세션 작성'
                                style="width:100%;height:42px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;font-family:inherit;outline:none;box-sizing:border-box;margin-top:8px">
                        </div>
                        <div>
                            <label style="font-size:0.82rem;font-weight:600;color:var(--wds-gray-700)">음악 취향 <span style="color:#e74c3c">*</span></label>
                            <div id="mtEdit_reg" style="margin-top:6px"></div>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:4px">
                            <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" type="button" onclick="hideMypageRegisterForm()"
                               >취소</button>
                            <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex:1" type="button" onclick="saveMypageProfile(null)"
                               >가입 신청</button>
                        </div>
                    </div>
                </div>
            `);

            const teamsHtml = myTeams.length > 0 ? `
                <div class="mypage-section-label">🎸 소속 팀</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px">
                    ${myTeams.map(t => `<span style="background:var(--wds-primary-light);color:var(--wds-primary);padding:4px 12px;border-radius:16px;font-size:0.82rem;font-weight:600">${escapeHtml(t.name)}</span>`).join('')}
                </div>` : '';

            if (state.mypageSub) { renderMypageSubView(); return; }
            const todayStr = new Date().toLocaleDateString('en-CA');
            const upcomingCnt = myRes.filter(r => r.res_date >= todayStr && r.status !== 'rejected').length;
            const tasteSummary = profile && profile.music_taste ? (() => { const t = document.createElement('div'); t.innerHTML = musicTasteTags(profile.music_taste); return [...t.querySelectorAll('.mt-tag')].map(e => e.textContent.trim()).slice(0, 3).join(' · '); })() : '';
            const contact = profile ? (profile.phone || profile.email || '') : '';
            const pendingAdmin = isAdminUser() ? (state.reservations || []).filter(r => r.status === 'pending' && !r.__perf).length : 0;
            const pushOn = !!(profile && profile.push_subscription);
            content.innerHTML = `
                <div class="gt-card" style="margin-top:0">${profileHtml}</div>
                <div class="gt-tiles">
                    <div class="gt-tile"><b>${myRes.length}</b><span>전체 예약</span></div>
                    <div class="gt-tile"><b>${approvedCount}</b><span>승인됨</span></div>
                    <div class="gt-tile"><b>${pendingCount}</b><span>대기 중</span></div>
                    <div class="gt-tile" title="실제 참여한 날짜 수 (오늘 이전, 같은 날 중복 1회)"><b>${participationCount}</b><span>참여 횟수</span></div>
                </div>
                <div class="gt-list">
                    <button type="button" onclick="gtMypageSub('res')"><span class="ic">📌</span>내 예약<span class="r">${upcomingCnt ? `예정 ${upcomingCnt}건` : '예정 없음'}</span></button>
                    <button type="button" onclick="gtMypageSub('taste')"><span class="ic">🎧</span>음악 취향<span class="r">${escapeHtml(tasteSummary || '미입력')}</span></button>
                    ${profile ? `<button type="button" onclick="showMypageEditForm();document.getElementById('mypageEditForm')?.scrollIntoView({block:'center'})"><span class="ic">📞</span>연락처<span class="r">${escapeHtml(contact || '미입력')}</span></button>` : ''}
                    ${myTeams.length ? `<button type="button" onclick="setMemberTab('teams')"><span class="ic">🎸</span>소속 팀<span class="r">${escapeHtml(myTeams.map(t => t.name).join(', '))}</span></button>` : ''}
                    <button type="button" onclick="gtMypageSub('docs')"><span class="ic">📖</span>운영안내<span class="r">${(state.docs || []).length ? `${(state.docs || []).length}개 문서` : ''}</span></button>
                    <button type="button" onclick="gtMypageSub('activity')"><span class="ic">📷</span>활동 앨범<span class="r"></span></button>
                    ${isAdminUser() ? `<button type="button" onclick="setGatheOTab('admin')"><span class="ic">🛠️</span>관리자<span class="r">${pendingAdmin ? `예약 승인 대기 ${pendingAdmin}` : ''}</span></button>` : ''}
                </div>
                <div class="gt-list">
                    ${profile ? `<button type="button" onclick="${pushOn ? 'unsubscribePush()' : 'subscribePush()'}"><span class="ic">🔔</span>푸시 알림<span class="r">${pushOn ? '켜짐' : '꺼짐'}</span></button>` : ''}
                    <button type="button" onclick="toggleTheme();renderMypagePanel()"><span class="ic">${document.body.classList.contains('dark') ? '☀️' : '🌙'}</span>다크 모드<span class="r">${document.body.classList.contains('dark') ? '켜짐' : '꺼짐'}</span></button>
                    <button type="button" class="muted" onclick="handleLogout()"><span class="ic">↩︎</span>로그아웃<span class="r"></span></button>
                </div>`;
            _gtViewCache.mypage = content.innerHTML;
            if (profile) setTimeout(() => renderMtEditUI('mtEdit_mypage', profile.music_taste), 0);
        }

        // ── 프로필 사진 바꾸기(2026-10-15): 가운데 정방형으로 잘라 256px JPEG → community-images/avatars/ → profiles.avatar_url ──
        function gtAvatarPick(profileId) {
            const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = async () => {
                const f = inp.files && inp.files[0]; if (!f) return;
                try {
                    const small = await _gtSquareThumb(f, 256);
                    const path = `avatars/${profileId}-${Date.now()}.jpg`;
                    const { error } = await supabaseClient.storage.from('community-images').upload(path, small, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' });
                    if (error) throw error;
                    const { data: urlData } = supabaseClient.storage.from('community-images').getPublicUrl(path);
                    await gtAvatarSave(profileId, urlData.publicUrl);
                    showToast('프로필 사진을 바꿨습니다.');
                } catch (e) { console.error('avatar upload:', e); showToast('사진을 올리지 못했습니다. 잠시 후 다시 시도해주세요.'); }
            };
            inp.click();
        }
        async function gtAvatarReset(profileId) {
            await gtAvatarSave(profileId, state.user && state.user.kakaoAvatar ? state.user.kakaoAvatar : null);
            showToast(state.user && state.user.kakaoAvatar ? '카카오 프로필 사진으로 되돌렸습니다.' : '기본 이니셜로 되돌렸습니다.');
        }
        async function gtAvatarSave(profileId, url) {
            const { error } = await supabaseClient.from('profiles').update({ avatar_url: url }).eq('id', profileId);
            if (error) { console.error(error); if (/avatar_url/.test(error.message || '')) showToast('프로필 사진 컬럼이 아직 없습니다. 관리자가 supabase/migrations/20261015_profile_avatar.sql 을 실행해야 합니다.', 6000); else showToast('저장하지 못했습니다.'); return; }
            if (state.user) state.user.avatarUrl = url;
            const me = _gtMe(); if (me) me.avatar_url = url;
            await renderMypagePanel(); showMypageEditForm(); gtUpdateBar();
        }
        async function _gtSquareThumb(file, size) {
            if (!/^image\//.test(file.type)) throw new Error('이미지 파일만 올릴 수 있습니다.');
            const bmp = await createImageBitmap(file);
            const s = Math.min(bmp.width, bmp.height), sx = (bmp.width - s) / 2, sy = (bmp.height - s) / 2;
            const c = document.createElement('canvas'); c.width = size; c.height = size;
            c.getContext('2d').drawImage(bmp, sx, sy, s, s, 0, 0, size, size);
            const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
            return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
        }

        async function handleChangePassword() {
            const cur = document.getElementById('changePwCurrent').value;
            const np = document.getElementById('changePwNew').value;
            const cp = document.getElementById('changePwConfirm').value;
            const result = document.getElementById('changePwResult');
            if (!cur || !np || !cp) { result.textContent = '모든 항목을 입력해주세요.'; result.style.color = '#e74c3c'; return; }
            if (np.length < 6) { result.textContent = '새 비밀번호는 6자 이상이어야 합니다.'; result.style.color = '#e74c3c'; return; }
            if (np !== cp) { result.textContent = '새 비밀번호가 일치하지 않습니다.'; result.style.color = '#e74c3c'; return; }
            if (cur === np) { result.textContent = '현재 비밀번호와 다른 값을 입력해주세요.'; result.style.color = '#e74c3c'; return; }
            result.textContent = '확인 중...'; result.style.color = 'var(--wds-gray-500)';
            const { data: sess } = await supabaseClient.auth.getSession();
            const email = sess?.session?.user?.email;
            if (!email) { result.textContent = '세션 정보를 가져올 수 없습니다. 다시 로그인해주세요.'; result.style.color = '#e74c3c'; return; }
            const { error: signErr } = await supabaseClient.auth.signInWithPassword({ email, password: cur });
            if (signErr) { result.textContent = '현재 비밀번호가 올바르지 않습니다.'; result.style.color = '#e74c3c'; return; }
            const { error: upErr } = await supabaseClient.auth.updateUser({ password: np });
            if (upErr) { result.textContent = '변경 실패: ' + upErr.message; result.style.color = '#e74c3c'; return; }
            result.textContent = '비밀번호가 변경되었습니다.'; result.style.color = '#00b894';
            document.getElementById('changePwCurrent').value = '';
            document.getElementById('changePwNew').value = '';
            document.getElementById('changePwConfirm').value = '';
        }

        function showMypageEditForm() {
            const iv = document.getElementById('mypageInfoView');
            const ef = document.getElementById('mypageEditForm');
            if (iv) iv.classList.add('hidden');
            if (ef) ef.classList.remove('hidden');
            const raw = ef ? (ef.dataset.musicTaste || null) : null;
            renderMtEditUI('mtEdit_mypage', raw);
        }

        function hideMypageEditForm() {
            const iv = document.getElementById('mypageInfoView');
            const ef = document.getElementById('mypageEditForm');
            if (iv) iv.classList.remove('hidden');
            if (ef) ef.classList.add('hidden');
        }

        function showMypageRegisterForm() {
            const rf = document.getElementById('mypageRegisterForm');
            if (rf) rf.classList.remove('hidden');
            setTimeout(() => renderMtEditUI('mtEdit_reg', null), 0);
        }

        function hideMypageRegisterForm() {
            const rf = document.getElementById('mypageRegisterForm');
            if (rf) rf.classList.add('hidden');
        }

        function genUUID() {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        }

        async function saveMypageProfile(profileId) {
            const isNew = !profileId;
            const phoneEl = document.getElementById(isNew ? 'regPhone' : 'mypagePhone');
            const phone = phoneEl ? phoneEl.value.trim() : '';
            if (phone && !/^010-\d{4}-\d{4}$/.test(phone) && !/^01[0-9]{8,9}$/.test(phone.replace(/-/g,''))) {
                showToast('올바른 전화번호를 입력해주세요. (예: 010-0000-0000)'); return;
            }
            const instBtnsId = isNew ? 'regInstBtns' : 'mypageInstBtns';
            const customInstId = isNew ? 'regCustomInst' : 'mypageCustomInst';
            const selectedInsts = Array.from(document.querySelectorAll(`#${instBtnsId} .inst-btn.selected`)).map(b => b.dataset.inst);
            const customInst = document.getElementById(customInstId).value.trim();
            const customs = customInst ? customInst.split(',').map(s=>s.trim()).filter(s=>s) : [];
            const instruments = [...selectedInsts, ...customs].join(', ');
            if (!instruments) { showToast('메인 세션을 1개 이상 선택하거나 입력해주세요.'); return; }

            const music_taste = getMtEditValue(isNew ? 'mtEdit_reg' : 'mtEdit_mypage');
            if (isNew && !music_taste) { showToast('음악 취향을 입력해주세요.'); return; }

            let result;
            if (isNew) {
                const name = document.getElementById('regName').value.trim();
                const email = document.getElementById('regEmail').value.trim();
                if (!name) { showToast('이름을 입력해주세요.'); return; }
                result = await supabaseClient.from('profiles').insert([{
                    id: genUUID(),
                    kakao_id: state.user.kakaoId,
                    name, email, phone, instruments, music_taste,
                    status: 'pending',
                    role: '일반'
                }]);
            } else {
                result = await supabaseClient.from('profiles').update({ phone, instruments, music_taste }).eq('id', profileId);
            }
            if (result.error) { showToast('저장 실패: ' + result.error.message); return; }
            showToast(isNew ? '가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.' : '프로필이 저장되었습니다.');
            if (isNew) {
                const regName = document.getElementById('regName') ? document.getElementById('regName').value.trim() : (state.user && state.user.nickname) || '';
                setTimeout(() => sendAdminPush('🙋 새 가입 신청', `${regName} · ${instruments || '세션 미입력'}`), 400);
            }
            renderMypagePanel();
        }

        let recoveryMode = false;

        // --- Reservation Logic ---
        const APP_VERSION = '2026.06.04';
        console.log('%cGatheO build: ' + APP_VERSION, 'color:#6c5ce7;font-weight:700');
        let state = {
            user: null,
            currentView: 'month',
            adminTab: 'approval',
            docs: [],
            docsCategory: null,
            viewDate: new Date(),
            selectedDate: null,
            startTime: null,
            endTime: null,
            reservations: [],
            blocks: [],
            teams: [],
            gatheoTab: 'home',
            memberPanelTab: 'list',
            mypageSub: null, // 마이 탭 하위 화면: res|taste|docs|activity
            gtNoticeOpen: false,
            editingTeam: null,
            editingSlots: [],
            editingSongs: [],
            cachedMembers: [],
            allMembers: [],
            mtEdits: {},
            bgmTracks: [],
            participantIds: [],
            participantEtc: '',
            participantCount: 0,
            lastReservation: null,
            polls: [],
            pollVotes: [],
            editingPoll: { options: ['', ''] },
            statsFilter: 'all',
            paging: {},
            schedules: [],
            scheduleAttendees: {},
            scheduleGroupAttendees: {},
            scheduleSlotAttendees: {},
            scheduleFilter: 'upcoming',
            scheduleEditorDate: new Date().toLocaleDateString('en-CA'),
            scheduleEditorGroups: [],
            scheduleEditorShowBanner: false,
            bandProfile: null,
            bandNotices: [],
            bandMembers: [],
            bandComments: [],
            communityMeetings: [],
            communityApplicationCounts: {},
            communityView: 'list',
            communityCurrentId: null,
            communityCurrentMeeting: null,
            communityEditAuth: {},
            communityEditPw: {},
            communityEditView: null,
            communityEditTab: 'info',
            communityCurrentAppList: [],
            communityCurrentFormFields: [],
            communityTab: 'current',
            communityTodayVisits: 0,
            communityCreateOpen: false,
            communityEditFields: [],
            communityTestType: null,
            communityTestStep: 0,
            communityTestAnswers: [],
            communityTestResult: null,
            communityTestDetail: null,
        };

        const PAGE_SIZE = 10;

        function getPaged(items, key) {
            let page = state.paging[key] || 0;
            const total = items.length;
            const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            page = Math.min(page, totalPages - 1);
            state.paging[key] = page;
            return { items: items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), page, totalPages, total };
        }

        function pagerHTML(key, page, totalPages, total) {
            if (total <= PAGE_SIZE) return '';
            const start = page * PAGE_SIZE + 1;
            const end = Math.min((page + 1) * PAGE_SIZE, total);
            const btnS = (disabled) => `padding:5px 14px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);background:var(--wds-gray-100);cursor:${disabled?'default':'pointer'};font-size:0.82rem;color:${disabled?'var(--wds-gray-400)':'var(--wds-black)'};font-weight:600;font-family:inherit`;
            return `<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 0;margin-top:4px">
                <button type="button" ${page<=0?'disabled':''} onclick="changePage('${key}',${page-1})" style="${btnS(page<=0)}">‹ 이전</button>
                <span style="min-width:100px;text-align:center;font-size:0.82rem;color:var(--wds-gray-600)">${start}–${end} / 전체 ${total}개</span>
                <button type="button" ${page>=totalPages-1?'disabled':''} onclick="changePage('${key}',${page+1})" style="${btnS(page>=totalPages-1)}">다음 ›</button>
            </div>`;
        }

        function changePage(key, page) {
            state.paging[key] = page;
            if (key === 'myRes' && state.gatheoTab === 'mypage') { renderMypageSubView(); return; }
            if (key.startsWith('adminMember')) {
                const el = document.getElementById('memberList');
                if (el) renderAdminMemberListEl(el);
            } else if (key === 'adminApproved' || key === 'adminPending') {
                // 관리자 예약승인 목록은 #gatheOTabAdmin 에 렌더됨 → render()(viewContainer) 아닌 관리자탭 재렌더
                renderGatheOAdmin();
            } else if (key.startsWith('member_') || key === 'statsRanking') {
                renderMemberPanel();
            } else if (key.startsWith('block')) {
                renderBlockList();
            } else if (key.startsWith('comm')) {
                renderCommunityList();
            } else {
                render();
            }
        }

        // 예약 그리드 슬롯(시작 시각). 2026-11-05 08:00~23:00 으로 확장(종전 10:00~) — 끝 시각 표시는 TIMES[i+1] || '23:00'
        const TIMES = GAA_RULES.TIMES; // /shared/rules.js

        // --- 권한 헬퍼 ---
        function isSuper() { return state.user && (state.user.kakaoId === ADMIN_ID || state.user.role === '운영 총괄'); }
        function canApproveRes() { return state.user && (isSuper() || state.user.role === '총괄' || state.user.role === '세션장'); }
        function canCancelRes() { return isSuper(); }
        function canApproveMember() { return state.user && (isSuper() || state.user.role === '총괄' || state.user.role === '세션장'); }
        function canBanMember() { return state.user && (isSuper() || state.user.role === '총괄'); }
        function canPostNotice() { return state.user && (isSuper() || state.user.role === '총괄'); }
        function isAdminUser() { return canApproveRes(); }

        async function fetchReservations() {
            if (!supabaseClient) {
                console.warn("Supabase가 초기화되지 않아 예약을 불러올 수 없습니다.");
                return;
            }
            // 공간 대관은 확정(approved)뿐 아니라 **입금 대기(pending)도 자리를 차지**한다(2026-11-04) — 대관 달력과 같은 규칙.
            // 4시간이 지난 대기 건은 sweep 전이라도 만료로 보고 뺀다(_pbExpired, lazy 자동취소).
            const [resResult, perfResult] = await Promise.all([
                supabaseClient.from('reservations').select('*'),
                supabaseClient.from('performance_bookings').select('id,date,start_time,end_time,status,created_at').in('status', ['approved', 'pending']),
            ]);
            if (resResult.error) { console.error('Fetch error:', resResult.error); return; }
            const perfVirtual = (perfResult.data || []).filter(b => !_pbExpired(b)).map(b => ({
                id: 'perf-' + b.id,
                res_date: b.date,
                start_time: b.start_time,
                end_time: b.end_time,
                user_name: b.status === 'pending' ? '공간 대관(입금 대기)' : '공간 대관',
                status: b.status === 'pending' ? 'pending' : 'approved',
                __perf: true,
            }));
            state.reservations = [...(resResult.data || []), ...perfVirtual];
            render();
        }

        // ── 포털 히어로·연락처 ─────────────────────────────────────────────
        // 공간 대관 페이지에 등록된 사진(PERF_SPACE_PHOTOS)을 그대로 돌려 보여준다 — 단, 원본(0.7~3.6MB)은 첫 화면에 너무 무거워
        // 저장소의 경량본 img/portal/<파일명>.webp(가로 960px) 를 쓴다. 사진을 추가하면 같은 이름의 webp 도 함께 넣을 것(tools/make-portal-hero.js).
        // 다음 장은 넘어가기 직전에 한 장만 내려받고, 포털이 안 보이거나 탭이 숨겨지면 멈춘다.
        const PORTAL_HERO_MS = 4000;
        const PORTAL_PHONE = '010-5109-1042';
        const PORTAL_INSTAGRAM_URL = 'https://www.instagram.com/gatherallaround'; // 비어 있으면 버튼을 숨긴다
        let _portalHero = null;
        function portalHeroUrls() {
            const list = typeof PERF_SPACE_PHOTOS !== 'undefined' && Array.isArray(PERF_SPACE_PHOTOS) ? PERF_SPACE_PHOTOS : [];
            return list.map(u => `/img/portal/${String(u).split('/').pop().replace(/\.(jpe?g|png|webp)$/i, '')}.webp`);
        }
        function initPortalHero() {
            const box = document.getElementById('portalHero');
            if (!box || _portalHero) return;
            const insta = document.getElementById('portalInstaBtn');
            if (insta && PORTAL_INSTAGRAM_URL) { insta.href = PORTAL_INSTAGRAM_URL; insta.style.display = ''; }
            const urls = portalHeroUrls();
            if (!urls.length) { box.classList.add('noimg'); return; } // 사진이 없어도 워드마크·모드 버튼·헤드라인은 보여야 하므로 숨기지 않는다
            const dots = document.getElementById('portalHeroDots');
            if (dots) dots.innerHTML = urls.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('');
            const layers = [0, 1].map(() => { const im = document.createElement('img'); im.alt = ''; im.className = 'portal-hero-img'; im.decoding = 'async'; box.prepend(im); return im; });
            layers[0].fetchPriority = 'high';
            layers[0].onerror = () => { box.classList.add('noimg'); };
            layers[0].src = urls[0]; layers[0].classList.add('on');
            _portalHero = { urls, idx: 0, layer: 0, timer: null };
            if (urls.length < 2) return;
            _portalHero.timer = setInterval(() => {
                const portal = document.getElementById('portal-page');
                if (document.hidden || !portal || portal.classList.contains('hidden')) return;
                const h = _portalHero, next = (h.idx + 1) % h.urls.length, nl = 1 - h.layer, im = layers[nl];
                const show = () => {
                    layers[h.layer].classList.remove('on'); im.classList.add('on');
                    if (dots) { if (dots.children[h.idx]) dots.children[h.idx].classList.remove('on'); if (dots.children[next]) dots.children[next].classList.add('on'); }
                    h.idx = next; h.layer = nl;
                };
                if (im.dataset.src === h.urls[next] && im.complete && im.naturalWidth) { show(); return; }
                im.onload = show; im.onerror = () => {}; im.dataset.src = h.urls[next]; im.src = h.urls[next];
            }, PORTAL_HERO_MS);
        }
        async function copyPortalPhone() {
            try { await navigator.clipboard.writeText(PORTAL_PHONE); showToast(`전화번호가 복사되었습니다 · ${PORTAL_PHONE}`); }
            catch (_) { prompt('전화번호를 복사하세요', PORTAL_PHONE); }
        }

        // ── 부팅 로딩 스크린 걷기 ──────────────────────────────────────────
        const BOOT_MIN_MS = 900;   // 첫 페인트(__bootT0) 후 최소 노출
        const BOOT_MAX_MS = 1800;  // 인증 판단이 늦어도 이 시점엔 걷는다
        let _bootHiding = false;
        function hideBootOverlay() {
            const el = document.getElementById('portalLoadingScreen');
            if (!el || el.dataset.boot !== '1' || _bootHiding) return; // 섹션 진입용 showPortalLoading() 오버레이는 건드리지 않는다
            _bootHiding = true;
            const wait = Math.max(0, BOOT_MIN_MS - (Date.now() - (window.__bootT0 || 0)));
            // 로딩 글꼴(라틴)과 포털 버튼 한글 글꼴이 준비된 뒤 걷는다 — 걷힌 직후 글꼴이 바뀌는 것 방지, 상한 500ms
            const fontReady = (document.fonts && document.fonts.load)
                ? Promise.race([
                      Promise.all([document.fonts.load('1em KkuBulLim', 'Gather all around'), document.fonts.load('1em KkuBulLim', '게더링 커뮤니티 고정 합주팀 공간 대관')]).catch(() => {}),
                      new Promise(r => setTimeout(r, 500)),
                  ])
                : Promise.resolve();
            Promise.all([fontReady, new Promise(r => setTimeout(r, wait))]).then(() => {
                el.classList.add('fade-out');
                setTimeout(() => el.remove(), 380);
            });
        }
