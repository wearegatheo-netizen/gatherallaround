// 게더 올 어라운드 본 스크립트 5/8 (community) — index.html 이 번호 순서대로 읽는 클래식 스크립트. 전역(함수·let/const)을 서로 공유한다.
// 고친 뒤에는 node tools/stamp-assets.mjs 로 index.html 의 ?v= 를 갱신할 것(tests/assets-unit.mjs 가 검사).

        // 안내 메시지 복사·카카오 공유·?perfmsg= 오버레이는 안내 메시지 기능과 함께 제거됨(2026-08).
        // ?perfmsg= 오버레이는 임의 문구를 공식 팝업처럼 보이게 할 수 있는 표면이기도 했다.
        // ===== /공간 대관 예약 =====

        async function showBandNewsSection() {
            _pushNav('band-news');
            document.body.classList.add('portal-view');
            document.body.classList.add('fullwidth-view');
            _hideAllScreens();
            document.getElementById('band-news-page').classList.remove('hidden');
            document.getElementById('band-news-viewer').classList.add('hidden');
            document.getElementById('band-news-list').classList.remove('hidden');
            await renderBandNewsList();
        }

        async function renderBandNewsList() {
            const listEl = document.getElementById('band-news-list');
            listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wds-gray-600)">불러오는 중…</div>`;
            try {
                const q = encodeURIComponent(`'${DRIVE_NEWS_FOLDER_ID}' in parents and trashed=false and (mimeType='text/html' or name contains '.html')`);
                const fields = encodeURIComponent('files(id,name,modifiedTime)');
                const url = `https://www.googleapis.com/drive/v3/files?q=${q}&key=${DRIVE_API_KEY}&fields=${fields}&orderBy=modifiedTime desc&pageSize=100`;
                const res = await fetch(url);
                const data = await res.json();
                const files = data.files || [];
                if (!files.length) {
                    listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wds-gray-600)">아직 등록된 뉴스가 없습니다.</div>`;
                    return;
                }
                const cards = files.map(f => {
                    const date = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString('ko-KR') : '';
                    const title = f.name.replace(/\.html?$/i, '');
                    const safeTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    return `<button type="button" class="band-news-card" onclick="openBandNewsItem('${f.id}','${safeTitle}')">
                        <div class="band-news-card-title">${escapeHtml(title)}</div>
                        <div class="band-news-card-date">${date}</div>
                    </button>`;
                }).join('');
                listEl.innerHTML = `<div class="band-news-grid">${cards}</div>`;
            } catch (e) {
                listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wds-gray-600)">목록을 불러오지 못했습니다.</div>`;
            }
        }

        async function openBandNewsItem(fileId, title) {
            // 제목 비어있으면 Drive에서 파일명 가져오기
            if (!title) {
                try {
                    const metaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name&key=${DRIVE_API_KEY}`;
                    const r = await fetch(metaUrl);
                    if (r.ok) {
                        const meta = await r.json();
                        title = (meta.name || '').replace(/\.html?$/i, '');
                    }
                } catch(e) {}
            }
            // 기존 뷰어 오버레이 제거
            document.getElementById('band-news-fullscreen')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'band-news-fullscreen';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--wds-white);display:flex;flex-direction:column';
            overlay.innerHTML = `
                <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--wds-gray-200);background:var(--wds-white);flex-shrink:0;gap:12px">
                    <button class="portal-back-btn" onclick="closeBandNewsFullscreen()" style="margin:0;flex-shrink:0;line-height:1">← 목록</button>
                    <span style="font-family:'KkuBulLim',sans-serif;font-size:1rem;font-weight:700;flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1">${escapeHtml(title)}</span>
                    <button onclick="shareBandNewsItem('${jsStr(fileId)}','${jsStr(title)}')" style="background:none;border:none;cursor:pointer;font-size:1.2rem;padding:2px 0;line-height:1;flex-shrink:0" title="공유">🔗</button>
                </div>
                <div id="band-news-iframe-wrap" style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;background:var(--wds-white)">
                    <div style="text-align:center;padding:40px;color:var(--wds-gray-600)">불러오는 중…</div>
                </div>`;
            document.body.appendChild(overlay);
            const wrap = overlay.querySelector('#band-news-iframe-wrap');
            try {
                const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error('fetch failed');
                const html = await res.text();
                const safeHtml = html.replace(/"/g, '&quot;');
                wrap.innerHTML = `<div style="max-width:900px;margin:0 auto"><iframe id="band-news-iframe" srcdoc="${safeHtml}" style="width:100%;border:none;display:block" sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></div>`;
                const iframe = wrap.querySelector('iframe');
                const fit = () => {
                    try {
                        const h = iframe.contentDocument.documentElement.scrollHeight;
                        iframe.style.height = h + 'px';
                    } catch(e) {}
                };
                iframe.addEventListener('load', () => {
                    fit(); setTimeout(fit, 300);
                    // 내부 링크 클릭을 새 창으로 열기
                    try {
                        const doc = iframe.contentDocument;
                        doc.addEventListener('click', (ev) => {
                            const a = ev.target.closest && ev.target.closest('a');
                            if (!a) return;
                            const href = a.getAttribute('href');
                            if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
                            ev.preventDefault();
                            window.open(href, '_blank', 'noopener,noreferrer');
                        }, true);
                    } catch(e) {}
                });
            } catch (e) {
                wrap.innerHTML = `<iframe src="https://drive.google.com/file/d/${fileId}/preview" style="width:100%;height:100%;border:none;display:block" allowfullscreen></iframe>`;
            }
        }

        function closeBandNewsFullscreen() {
            document.getElementById('band-news-fullscreen')?.remove();
        }

        async function shareBandNewsItem(fileId, title) {
            const shareUrl = `${location.origin}${location.pathname}?news=${encodeURIComponent(fileId)}`;
            if (navigator.share) {
                try {
                    await navigator.share({ url: shareUrl });
                    return;
                } catch(e) {}
            }
            try {
                await navigator.clipboard.writeText(shareUrl);
                showToast('링크가 클립보드에 복사됐습니다!');
            } catch(e) {
                prompt('링크를 복사하세요:', shareUrl);
            }
        }

        function backToBandNewsList() {
            document.getElementById('band-news-viewer').classList.add('hidden');
            document.getElementById('band-news-list').classList.remove('hidden');
        }

        // 섹션 진입용 글자 로딩 오버레이(부팅용 #portalLoadingScreen[data-boot] 와 같은 모양, data-boot 없음).
        // opts.hold: 자동으로 걷지 않음 — 다른 페이지(와펜)로 떠날 때 새 문서가 뜰 때까지 덮어 둔다(bfcache 로 돌아오면 pageshow 가 치운다).
        function showPortalLoading(opts = {}) {
            return new Promise(resolve => {
                document.getElementById('portalLoadingScreen')?.remove();
                const text = 'Gather all around';
                const letters = text.split('').map((c, i) =>
                    c === ' '
                        ? `<span class="pll-space"> </span>`
                        : `<span class="pll" style="animation-delay:${(i * 0.055).toFixed(2)}s">${c}</span>`
                ).join('');
                const el = document.createElement('div');
                el.id = 'portalLoadingScreen';
                el.innerHTML = `<div class="portal-loading-text">${letters}</div>`;
                document.body.appendChild(el);
                if (opts.hold) return;
                setTimeout(() => {
                    el.classList.add('fade-out');
                    setTimeout(() => { el.remove(); resolve(); }, 380);
                }, 950);
            });
        }
        // 포털 → 섹션 전환 로딩(2026-10-09): 포털이 보이는 상태에서 섹션으로 들어갈 때만 띄운다 — 뒤로가기(popstate)·섹션 안 이동·
        // 부팅 딥링크(부팅 오버레이가 아직 덮고 있음)에는 띄우지 않는다. 반드시 _hideAllScreens() 보다 먼저 부를 것(포털 표시 여부로 판단).
        function showSectionLoadingFromPortal() {
            const portal = document.getElementById('portal-page');
            const cur = document.getElementById('portalLoadingScreen');
            if (!portal || portal.classList.contains('hidden')) return Promise.resolve();
            if (cur && cur.dataset.boot === '1' && !cur.classList.contains('fade-out')) return Promise.resolve();
            return showPortalLoading();
        }
        // 와펜(별도 페이지)으로 — 새 문서가 뜰 때까지 오버레이를 덮어 두고 이동
        function goWappen() {
            showPortalLoading({ hold: true });
            location.href = '/wappen/';
        }
        // 뒤로가기로 이 문서가 bfcache 에서 복원되면(와펜에서 복귀) 남아 있던 섹션 오버레이를 치운다(부팅 오버레이는 해당 없음)
        window.addEventListener('pageshow', (e) => {
            if (!e.persisted) return;
            document.querySelectorAll('#portalLoadingScreen:not([data-boot])').forEach(el => el.remove());
        });

        function showGatheoSection() {
            // 부팅 때 조용히 복구해 둔 게더링 세션이 있으면 로그인 폼 대신 바로 진입 (포털 → 게더링 버튼)
            if (state.user) { _pushNav('gatheo'); showSectionLoadingFromPortal(); loginUI(state.user.nickname); return; } // 로그인 폼 경로와 같이 로딩 화면
            _pushNav('gatheo');
            document.body.classList.add('portal-view');
            document.body.classList.remove('fullwidth-view');
            _hideAllScreens();
            document.getElementById('landing-page').classList.remove('hidden');
            showLoginForm();
            showPortalLoading();
        }

        function showBandSection() {
            if (state.bandProfile) { _pushNav('band'); showSectionLoadingFromPortal(); loginBandUI(state.bandProfile); return; } // 복구된 합주팀 세션 → 바로 진입(로딩 화면 포함)
            _pushNav('band');
            document.body.classList.add('portal-view');
            document.body.classList.remove('fullwidth-view');
            _hideAllScreens();
            document.getElementById('landing-page-band').classList.remove('hidden');
            showBandMenu();
            showPortalLoading();
        }

        function showComingSoon() {
            showToast('준비 중입니다. 곧 오픈 예정입니다! 😊');
        }

        // ── Community Section ──────────────────────────────────────────────────

        function genSalt() {
            const arr = new Uint8Array(16);
            crypto.getRandomValues(arr);
            return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async function hashPw(pw, salt) {
            const enc = new TextEncoder();
            const data = enc.encode(pw + salt);
            const buf = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        // 모임장 알림 메일 — Cloudflare 함수 /send-email이 DB에서 직접 조회해 구성·발송한다.
        // (기존 Supabase Edge Function 'send-email'은 배포돼 있지 않아 항상 실패했음)
        // 실패·미설정 시 false 반환 → 호출부가 mailto 폴백을 쓴다.
        // ── 신청자 명단은 서버 경유(2026-11-10) ── 이름·연락처가 든 community_applications 는 공개 키로 읽고 쓰지 않는다.
        // /community-admin 의 app_* 액션: 공개 화면은 인원 수·선택형 답만, 내 신청은 이름+연락처 일치, 전체 명단은 모임장 토큰.
        // 서버 함수가 없는 환경(정적 서버·테스트: 404/405/501)은 { down:true } → 호출부가 종전 직접 조회.
        let _cmApiDown = false;
        async function _cmApi(action, payload = {}) {
            if (_cmApiDown) return { down: true };
            let r;
            try { r = await fetch('/community-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) }); }
            catch (_) { return { ok: false, message: '네트워크 오류로 서버에 연결하지 못했습니다.' }; }
            if (r.status === 404 || r.status === 405 || r.status === 501) { _cmApiDown = true; return { down: true }; }
            const j = await r.json().catch(() => null);
            return j ? { ...j, status: r.status } : { ok: false, status: r.status, message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' };
        }
        // 모임장 전용 호출 — 토큰이 없거나 만료면 인증을 풀고 안내
        async function _cmOrgApi(action, meetingId, payload = {}) {
            const res = await _cmApi(action, { meeting_id: meetingId, token: state.communityOrgTok[meetingId], ...payload });
            if (!res.down && res.status === 401) { delete state.communityEditAuth[meetingId]; delete state.communityOrgTok[meetingId]; }
            return res;
        }

        async function sendOrganizerMail(meetingId, applicationId) {
            try {
                const r = await fetch('/send-email', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meeting_id: meetingId, application_id: applicationId }),
                });
                const j = await r.json().catch(() => ({}));
                if (!j.ok && !j.skipped) console.error('메일 발송 실패:', j.error || r.status, j.detail || '');
                return !!j.ok || j.skipped === 'already-sent';
            } catch (e) {
                console.error('메일 발송 실패:', e);
                return false;
            }
        }

        async function showCommunitySection() {
            _pushNav('community');
            document.body.classList.remove('portal-view');
            document.body.classList.remove('fullwidth-view');
            _hideAllScreens();
            document.getElementById('landing-page-community').classList.remove('hidden');
            state.communityView = 'list';
            state.communityCurrentId = null;
            state.communityCreateOpen = false;
            state.communityTab = 'current';
            // 딥링크(#community/past 등) 복원 — _routeToPage가 맡겨둔 탭을 수령
            if (window.__routeCommunityTab) { state.communityTab = window.__routeCommunityTab; window.__routeCommunityTab = null; }
            state.communityEditAuth = {};
            state.communityEditPw = {};
            state.communityOrgTok = {}; // 모임장 토큰(신청자 명단 조회·처리용, /community-admin app_auth 가 발급 — 2시간)
            state.communityTestType = null;
            state.communityTestStep = 0;
            state.communityTestAnswers = [];
            state.communityTestResult = null;
            state.communityTestDetail = null;
            window.scrollTo({ top: 0, behavior: 'instant' });
            await Promise.all([
                showPortalLoading(),
                incrementCommunityVisit(),
                fetchCommunityMeetings(),
                fetchCommunityReservationsAndBlocks(),
            ]);
            // 모임 딥링크 복원 — _routeToPage가 맡겨둔 모임 id를 수령해 상세로 진입
            if (window.__routeCommunityMeeting) {
                const mid = window.__routeCommunityMeeting;
                window.__routeCommunityMeeting = null;
                renderCommunityDetail(mid);
                return;
            }
            renderCommunityList();
        }

        async function fetchCommunityReservationsAndBlocks() {
            try {
                const [rb, bb, pb] = await Promise.all([
                    supabaseClient.from('reservations').select('id, res_date, start_time, end_time, status'),
                    supabaseClient.from('time_blocks').select('*'),
                    supabaseClient.from('performance_bookings').select('id, date, start_time, end_time, status, created_at').not('status', 'in', '("rejected","expired","cancelled")'),
                ]);
                // 공간 대관(확정·대기, 4시간 만료 제외)도 예약과 같은 모양으로 합친다 — 달력(loadPerfRangeConflicts)과 같은 기준
                const perfVirtual = ((pb && pb.data) || []).filter(b => !_pbExpired(b))
                    .map(b => ({ id: 'perf-' + b.id, res_date: b.date, start_time: b.start_time, end_time: b.end_time, status: 'approved' }));
                if (rb.data) state.reservations = [...rb.data, ...perfVirtual];
                if (bb.data) state.blocks = bb.data;
            } catch (e) { /* ignore */ }
        }

        // 반환: null(겹침 없음) | { kind:'invalid'|'reservation', message } (등록 불가)
        //      | { kind:'block', message, range, reason } (게더링 차단 — 운영진 수락 요청으로 진행 가능). 예약·대관이 차단보다 우선.
        function checkCommunityTimeConflict(dateStr, startTime, endTime) {
            const sIdx = TIMES.indexOf(startTime);
            const eIdx = TIMES.indexOf(endTime);
            if (sIdx < 0 || eIdx < 0 || sIdx > eIdx) return { kind: 'invalid', message: '시간 범위가 올바르지 않습니다.' };
            const [y, m, d] = dateStr.split('-').map(Number);
            const dow = new Date(y, m - 1, d).getDay();

            // 예약·대관(approved + pending)
            for (const r of (state.reservations || [])) {
                if (r.status === 'rejected' || r.status === 'cancelled') continue;
                if (r.res_date !== dateStr) continue;
                const rSIdx = TIMES.indexOf(r.start_time);
                const rEIdx = TIMES.indexOf(r.end_time);
                if (sIdx <= rEIdx && eIdx >= rSIdx) {
                    return { kind: 'reservation', message: `해당 시간대에 이미 예약이 있습니다 (${r.start_time}~${TIMES[rEIdx + 1] || '23:00'}).` };
                }
            }
            // 게더링 차단(time_blocks) — 요청 가능
            for (const b of (state.blocks || [])) {
                if (b.day_of_week !== dow) continue;
                if (b.start_date && dateStr < b.start_date) continue;
                if (b.end_date && dateStr > b.end_date) continue;
                if (_blockSkipped(b, dateStr)) continue;
                const bSIdx = TIMES.indexOf(b.start_time);
                const bEIdx = TIMES.indexOf(b.end_time);
                if (sIdx <= bEIdx && eIdx >= bSIdx) {
                    const range = `${b.start_time}~${TIMES[bEIdx + 1] || '23:00'}`;
                    return { kind: 'block', range, reason: b.reason || '', message: `게더링이 막아 둔 시간과 겹칩니다 (${range}${b.reason ? ' · ' + b.reason : ''}).` };
                }
            }
            return null;
        }

        async function incrementCommunityVisit() {
            try {
                const today = new Date().toLocaleDateString('en-CA');
                const { data: existing } = await supabaseClient
                    .from('community_visits')
                    .select('count')
                    .eq('visit_date', today)
                    .maybeSingle();
                const newCount = (existing ? existing.count : 0) + 1;
                await supabaseClient
                    .from('community_visits')
                    .upsert({ visit_date: today, count: newCount }, { onConflict: 'visit_date' });
                state.communityTodayVisits = newCount;
            } catch (e) { /* ignore */ }
            const el = document.getElementById('communityVisitorCount');
            if (el) el.textContent = `오늘 ${state.communityTodayVisits}명 방문`;
        }

        async function fetchCommunityMeetings() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient
                .from('community_meetings')
                .select('*')
                .order('meeting_date', { ascending: true, nullsFirst: false });
            if (!error && data) {
                // pending(운영진 수락 대기)·rejected 모임은 공개 목록에서 제외 (status 컬럼 없던 행은 active)
                state.communityMeetings = data.filter(m => (m.status || 'active') === 'active');
                // Fetch application counts — 거절 건은 정원에서 제외 (status 컬럼 마이그레이션 전이면 전체 집계 폴백)
                const ids = state.communityMeetings.map(m => m.id);
                const srvCounts = ids.length > 0 ? await _cmApi('app_counts', { meeting_ids: ids }) : null;
                if (srvCounts && !srvCounts.down) {
                    if (srvCounts.ok) state.communityApplicationCounts = srvCounts.counts || {};
                } else if (ids.length > 0) {
                    let { data: appData, error: appErr } = await supabaseClient
                        .from('community_applications')
                        .select('meeting_id,status')
                        .in('meeting_id', ids);
                    if (appErr) {
                        ({ data: appData } = await supabaseClient
                            .from('community_applications')
                            .select('meeting_id')
                            .in('meeting_id', ids));
                    }
                    const counts = {};
                    if (appData) appData.forEach(a => {
                        if ((a.status || 'pending') === 'rejected') return;
                        counts[a.meeting_id] = (counts[a.meeting_id] || 0) + 1;
                    });
                    state.communityApplicationCounts = counts;
                }
            }
        }

        async function uploadCommunityImage(file) {
            const ext = file.name.split('.').pop();
            const path = `covers/${Date.now()}.${ext}`;
            const { data, error } = await supabaseClient.storage
                .from('community-images')
                .upload(path, file, { cacheControl: '3600', upsert: false });
            if (error) throw error;
            const { data: urlData } = supabaseClient.storage.from('community-images').getPublicUrl(path);
            return urlData.publicUrl;
        }

        // ── 대표 이미지 정방형 크롭(2026-10-13): 파일 선택 → 정방형 상자 안에서 끌기(이동)·슬라이더(확대) → 제출 때 1080² JPEG 로 잘라 업로드.
        //    저장되는 파일 자체가 정방형이라 목록·상세는 object-fit 만으로 같은 영역을 보인다. 상태는 prefix('cc' 만들기 / 'ce' 수정)별.
        const CM_CROP_OUT = 1080;
        const _cmCrops = {};
        function cmCropLoad(prefix, file) {
            cmCropClear(prefix);
            if (!file) return;
            const wrap = document.getElementById(prefix + '_crop'), imgEl = document.getElementById(prefix + '_crop_img'), box = document.getElementById(prefix + '_crop_box');
            if (!wrap || !imgEl || !box) return;
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                wrap.classList.remove('hidden'); // 먼저 보여야 상자 폭을 잴 수 있다
                const B = box.clientWidth || 280, nw = img.naturalWidth, nh = img.naturalHeight;
                if (!nw || !nh) { URL.revokeObjectURL(url); wrap.classList.add('hidden'); return; }
                _cmCrops[prefix] = { img, url, nw, nh, B, base: B / Math.min(nw, nh), zoom: 1, x: 0, y: 0 }; // base = 짧은 변이 상자에 꽉 차는 배율
                imgEl.src = url;
                const z = document.getElementById(prefix + '_crop_zoom'); if (z) z.value = 100;
                cmCropCenter(prefix); cmCropApply(prefix); cmCropBind(prefix);
            };
            img.onerror = () => { URL.revokeObjectURL(url); showToast('이미지를 읽을 수 없습니다. 다른 파일을 선택해주세요.'); };
            img.src = url;
        }
        function cmCropClear(prefix) {
            const c = _cmCrops[prefix]; if (c && c.url) { try { URL.revokeObjectURL(c.url); } catch (_) {} }
            delete _cmCrops[prefix];
            const wrap = document.getElementById(prefix + '_crop'); if (wrap) wrap.classList.add('hidden');
        }
        function _cmCropSize(c) { const sc = c.base * c.zoom; return { w: c.nw * sc, h: c.nh * sc, sc }; }
        function cmCropCenter(prefix) { const c = _cmCrops[prefix]; if (!c) return; const { w, h } = _cmCropSize(c); c.x = (c.B - w) / 2; c.y = (c.B - h) / 2; }
        function cmCropApply(prefix) {
            const c = _cmCrops[prefix], imgEl = document.getElementById(prefix + '_crop_img'); if (!c || !imgEl) return;
            const { w, h } = _cmCropSize(c);
            c.x = Math.min(0, Math.max(c.B - w, c.x)); c.y = Math.min(0, Math.max(c.B - h, c.y)); // 상자가 비지 않게
            imgEl.style.width = w + 'px'; imgEl.style.height = h + 'px'; imgEl.style.transform = `translate(${c.x}px, ${c.y}px)`;
        }
        function cmCropZoom(prefix, v) {
            const c = _cmCrops[prefix]; if (!c) return;
            const z = Math.max(1, Math.min(3, Number(v) / 100)), old = c.base * c.zoom, nw = c.base * z, cx = c.B / 2, cy = c.B / 2;
            c.x = cx - (cx - c.x) * (nw / old); c.y = cy - (cy - c.y) * (nw / old); c.zoom = z; // 상자 중심 기준 확대
            cmCropApply(prefix);
        }
        function cmCropReset(prefix) { const c = _cmCrops[prefix]; if (!c) return; c.zoom = 1; const z = document.getElementById(prefix + '_crop_zoom'); if (z) z.value = 100; cmCropCenter(prefix); cmCropApply(prefix); }
        function cmCropBind(prefix) {
            const box = document.getElementById(prefix + '_crop_box'); if (!box || box.dataset.bound) return; box.dataset.bound = '1';
            let drag = null;
            box.addEventListener('pointerdown', e => { const c = _cmCrops[prefix]; if (!c) return; drag = { px: e.clientX, py: e.clientY, x: c.x, y: c.y }; try { box.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
            box.addEventListener('pointermove', e => { const c = _cmCrops[prefix]; if (!c || !drag) return; c.x = drag.x + (e.clientX - drag.px); c.y = drag.y + (e.clientY - drag.py); cmCropApply(prefix); });
            const end = () => { drag = null; };
            box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
        }
        // 보이는 정방형을 JPEG File 로 — 크롭 상태가 없으면(미리보기 실패 등) 원본 파일 그대로
        async function cmCropExport(prefix, fallbackFile) {
            const c = _cmCrops[prefix]; if (!c) return fallbackFile || null;
            const { sc } = _cmCropSize(c);
            const canvas = document.createElement('canvas'); canvas.width = CM_CROP_OUT; canvas.height = CM_CROP_OUT;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, CM_CROP_OUT, CM_CROP_OUT);
            ctx.drawImage(c.img, -c.x / sc, -c.y / sc, c.B / sc, c.B / sc, 0, 0, CM_CROP_OUT, CM_CROP_OUT);
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
            return blob ? new File([blob], 'cover.jpg', { type: 'image/jpeg' }) : (fallbackFile || null);
        }

        function communityPlaceholderImg(title, size) {
            const ch = title ? title.charAt(0) : '모';
            const s = size || 80;
            return `<div class="community-placeholder-img" style="width:${s}px;height:${s}px;font-size:${Math.round(s*0.36)}px;">${escapeHtml(ch)}</div>`;
        }

        function communityIsFreeMeeting(fee) {
            if (!fee) return false;
            return parseInt(fee.replace(/[^\d]/g, '') || '9') === 0;
        }

        function communityIsClosed(m) {
            if (m.is_closed) return true;
            if (m.application_deadline && m.application_deadline < new Date().toLocaleDateString('en-CA')) return true;
            const cnt = state.communityApplicationCounts[m.id] || 0;
            if (m.capacity && cnt >= m.capacity) return true;
            return false;
        }

        // ── 커뮤니티 공통 조각(2026-10-13 개편) ──────────────────────────────
        const COMMUNITY_SHOW_APPLICANT_COUNT = false; // 신청 인원(N/정원) 공개 여부 — 정책상 숨김(모임장은 [신청자 관리] 탭에서 확인). true 면 목록 카드에 "N/정원명"
        const _CM_WD = ['일', '월', '화', '수', '목', '금', '토'];
        const _CM_ICON = {
            plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
            pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
            share: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
            down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
            up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>',
        };
        function _cmDate(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); } // 'YYYY-MM-DD' → 로컬 자정
        function _cmDaysFromToday(s) { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((_cmDate(s) - t) / 86400000); }
        function _cmDateLong(s) { const x = _cmDate(s); return `${x.getMonth() + 1}월 ${x.getDate()}일 (${_CM_WD[x.getDay()]})`; }
        function _cmDateShort(s) { const x = _cmDate(s); return `${x.getMonth() + 1}/${x.getDate()} (${_CM_WD[x.getDay()]})`; }
        function _cmDday(s) { const n = _cmDaysFromToday(s); return n === 0 ? 'D-DAY' : n > 0 ? 'D-' + n : 'D+' + (-n); }
        function _cmRelLabel(s) { const n = _cmDaysFromToday(s); return n === 0 ? '오늘' : n === 1 ? '내일' : n < 7 ? '이번 주' : n < 14 ? '다음 주' : ''; }
        function _cmFeeLabel(m) { return communityIsFreeMeeting(m.fee) ? '무료' : (m.fee ? escapeHtml(m.fee) : ''); }
        function communityBarVisible(on) { const bar = document.getElementById('communityBar'); if (bar) bar.classList.toggle('hidden', !on); }
        function communitySegHTML(tab) {
            const today = new Date().toLocaleDateString('en-CA');
            const cur = state.communityMeetings.filter(m => !m.meeting_date || m.meeting_date >= today).length;
            const past = state.communityMeetings.length - cur;
            return `<div class="cm-seg">
                <button type="button" class="${tab === 'current' ? 'on' : ''}" onclick="communitySetTab('current')">모집 중<b>${cur}</b></button>
                <button type="button" class="${tab === 'past' ? 'on' : ''}" onclick="communitySetTab('past')">지난 모임<b>${past}</b></button>
                <button type="button" class="${tab === 'test' ? 'on' : ''}" onclick="communitySetTab('test')">테스트</button>
            </div>`;
        }
        function _cmPlaceholder(title) { return `<div class="ph">${escapeHtml((title || '모')[0])}</div>`; }
        function _cmCoverImg(m) {
            if (!m.cover_image_url) return _cmPlaceholder(m.title);
            return `<img src="${escapeHtml(m.cover_image_url)}" alt="${escapeHtml(m.title)}" onerror="this.parentNode.innerHTML='<div class=\\'ph\\'>${jsStr(escapeHtml((m.title || '모')[0]))}</div>'">`;
        }
        // 카드 썸네일을 왼쪽 글 상자와 위아래가 맞는 정방형으로(2026-10-13 요청) — 글 높이가 제목 줄 수·장소 유무·화면 폭에 따라 달라지므로 그린 뒤 재서 맞춘다.
        // 썸네일을 키우면 글 상자가 좁아져 줄바꿈이 늘 수 있으니 안정될 때까지 최대 3번 반복. 화면 폭이 바뀌면 다시 맞춘다.
        function _cmFitThumbs() {
            document.querySelectorAll('#communityContent .cm-ev').forEach(ev => {
                const th = ev.querySelector('.th'), bd = ev.querySelector('.bd'); if (!th || !bd) return;
                for (let pass = 0; pass < 3; pass++) {
                    const h = Math.round(bd.getBoundingClientRect().height); if (!h) break;
                    if (Math.abs((parseFloat(th.style.width) || 0) - h) < 1) break;
                    th.style.width = th.style.height = h + 'px';
                }
            });
        }
        let _cmFitTimer = null;
        window.addEventListener('resize', () => { clearTimeout(_cmFitTimer); _cmFitTimer = setTimeout(_cmFitThumbs, 120); });
        function _cmEventCardHTML(m) {
            const closed = communityIsClosed(m);
            const isFree = communityIsFreeMeeting(m.fee);
            const cnt = state.communityApplicationCounts[m.id] || 0;
            const chips = (closed ? '<span class="cm-chip closed">마감</span>' : '<span class="cm-chip ok">모집중</span>') + (!closed && isFree ? ' <span class="cm-chip free">무료</span>' : '');
            const people = m.capacity ? (COMMUNITY_SHOW_APPLICANT_COUNT ? `<b>${cnt}</b>/${m.capacity}명` : `정원 ${m.capacity}명`) : '';
            return `<div class="cm-ev${closed ? ' closed' : ''}" role="button" tabindex="0" onclick="renderCommunityDetail('${m.id}')" onkeydown="if(event.key==='Enter'){renderCommunityDetail('${m.id}')}">
                <div class="bd">
                    <div class="time">${m.meeting_time ? escapeHtml(m.meeting_time) : ''}${chips}</div>
                    <div class="tt">${escapeHtml(m.title)}</div>
                    <div class="by"><i class="cm-av">${escapeHtml((m.organizer_name || '?')[0])}</i>${escapeHtml(m.organizer_name || '')} 모임장</div>
                    ${m.location ? `<div class="mt">${_CM_ICON.pin} ${escapeHtml(m.location)}</div>` : ''}
                    <div class="ft"><span>${people}</span><b>${_cmFeeLabel(m)}</b></div>
                </div>
                <div class="th">${_cmCoverImg(m)}</div>
            </div>`;
        }

        function renderCommunityList() {
            if (state.communityTab === 'test') { renderCommunityTestHome(); return; }
            const el = document.getElementById('communityContent');
            if (!el) return;
            const today = new Date().toLocaleDateString('en-CA');
            const currentMeetings = state.communityMeetings.filter(m => !m.meeting_date || m.meeting_date >= today).sort((a, b) => (a.meeting_date || '9999').localeCompare(b.meeting_date || '9999')); // 가까운 날짜부터(날짜 미정은 끝)
            const pastMeetings = state.communityMeetings.filter(m => m.meeting_date && m.meeting_date < today).sort((a, b) => (b.meeting_date || '').localeCompare(a.meeting_date || '')); // 최근 것부터
            const tab = state.communityTab;
            const list = tab === 'current' ? currentMeetings : pastMeetings;
            const paged = getPaged(list, 'commList');

            communityBarVisible(true);
            let html = '';
            // 알약 탭 + 한 줄 요약 (모임 생성 중에는 숨김). [신청 조회]는 앱 바, [모임 만들기]는 떠 있는 버튼(.cm-fab)
            if (!state.communityCreateOpen) {
                const weekCnt = currentMeetings.filter(m => m.meeting_date && _cmDaysFromToday(m.meeting_date) < 7).length;
                html += communitySegHTML(tab) + `<div class="cm-subline"><span>${tab === 'current' ? `이번 주 모임 ${weekCnt}개 · ` : ''}<span id="communityVisitorCount">오늘 ${state.communityTodayVisits}명 방문</span></span><span>${tab === 'current' ? '날짜순' : '최근순'}</span></div>`;
            }

            // Create form — Google Forms 스타일
            if (state.communityCreateOpen) {
                html += `<div id="communityCreateForm">
                    <div class="gforms-header">
                        <h2>새 모임 만들기</h2>
                        <p>모임을 만들고 참여자를 모집해보세요. <span class="gforms-required-note">* 표시는 필수 항목입니다.</span></p>
                    </div>
                    <div class="gforms-card">
                        <label class="gforms-label">모임명<span class="req">*</span></label>
                        <input type="text" id="cc_title" class="gforms-input" placeholder="모임 제목을 입력해주세요">
                    </div>
                    <div class="gforms-card" id="ccCalCard">
                        <label class="gforms-label">공간 시간표에서 날짜·시간 선택</label>
                        <p style="margin:0 0 10px;font-size:0.8rem;color:var(--wds-gray-500);line-height:1.5">게더 올 어라운드 공간의 예약·대관 현황입니다. 비어 있는 시간을 고르면 아래 날짜·시간이 자동 입력됩니다. (다른 장소라면 아래에 직접 입력하세요)</p>
                        <div class="perf-cal-toggle">
                            <button type="button" id="ccCalMonthBtn" class="active" onclick="setPerfCalView('month')">월간</button>
                            <button type="button" id="ccCalWeekBtn" onclick="setPerfCalView('week')">주간</button>
                        </div>
                        <div class="perf-cal-nav">
                            <button type="button" onclick="perfCalPrev()">◀</button>
                            <span id="ccCalLabel"></span>
                            <button type="button" onclick="perfCalNext()">▶</button>
                        </div>
                        <div id="ccCalContainer"></div>
                        <div id="ccCalSummary" style="margin-top:10px;font-size:0.86rem;font-weight:700;color:var(--wds-primary);min-height:20px"></div>
                    </div>
                    <div class="gforms-card">
                        <label class="gforms-label">모임 날짜<span class="req">*</span></label>
                        <input type="date" id="cc_date" class="gforms-input">
                    </div>
                    <div class="community-grid-2">
                        <div class="gforms-card">
                            <label class="gforms-label">시작 시간<span class="req">*</span></label>
                            <select id="cc_start_time" class="gforms-select">${TIMES.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
                        </div>
                        <div class="gforms-card">
                            <label class="gforms-label">종료 시간<span class="req">*</span></label>
                            <select id="cc_end_time" class="gforms-select">${TIMES.map((t, i) => `<option value="${t}">${TIMES[i+1] || '23:00'}</option>`).join('')}</select>
                        </div>
                    </div>
                    <div class="community-grid-2">
                        <div class="gforms-card">
                            <label class="gforms-label">모임장 이름<span class="req">*</span></label>
                            <input type="text" id="cc_org_name" class="gforms-input" placeholder="모임장 이름">
                        </div>
                        <div class="gforms-card">
                            <label class="gforms-label">모임장 연락처<span class="req">*</span></label>
                            <input type="tel" id="cc_org_phone" class="gforms-input" placeholder="010-0000-0000">
                        </div>
                    </div>
                    <div class="gforms-card">
                        <label class="gforms-label">모임장 이메일<span class="req">*</span></label>
                        <input type="email" id="cc_org_email" class="gforms-input" placeholder="organizer@example.com">
                        <p style="font-size:0.8rem;color:var(--wds-gray-500);margin:8px 0 0;">해당 이메일로 신청 알림이 전달됩니다.</p>
                    </div>
                    <div class="community-grid-2">
                        <div class="gforms-card">
                            <label class="gforms-label">참여비용</label>
                            <div style="display:flex;align-items:baseline;gap:8px;">
                                <input type="number" id="cc_fee" class="gforms-input" placeholder="0" min="0" step="100" style="flex:1;">
                                <span style="font-size:0.95rem;color:var(--wds-gray-600);font-weight:600;">원</span>
                            </div>
                        </div>
                        <div class="gforms-card">
                            <label class="gforms-label">준비물</label>
                            <input type="text" id="cc_items" class="gforms-input" placeholder="필요 준비물">
                        </div>
                    </div>
                    <div class="community-grid-2">
                        <div class="gforms-card">
                            <label class="gforms-label">정원<span class="req">*</span></label>
                            <input type="number" id="cc_capacity" class="gforms-input" placeholder="1 이상 필수" min="1" required>
                        </div>
                        <div class="gforms-card">
                            <label class="gforms-label">신청 마감일</label>
                            <input type="date" id="cc_deadline" class="gforms-input">
                        </div>
                    </div>
                    <div class="gforms-card">
                        <label class="gforms-label">모임 설명<span class="req">*</span></label>
                        ${docEditorHTML('cc_desc', '', '진행 컨텐츠 및 타임라인 등을 작성해주세요. 링크(🔗)와 사진(🖼)도 넣을 수 있어요.', { image: true })}
                    </div>
                    <div class="gforms-card">
                        <label class="gforms-label">대표 이미지</label>
<input type="file" id="cc_image" accept="image/*" style="font-size:0.9rem;padding:6px 0;" onchange="cmCropLoad('cc', this.files[0])">
                        <div id="cc_crop" class="cm-crop hidden">
                            <div class="cm-crop-box" id="cc_crop_box"><img id="cc_crop_img" alt="" draggable="false"></div>
                            <div class="cm-crop-ctl"><span>확대</span><input type="range" id="cc_crop_zoom" min="100" max="300" value="100" oninput="cmCropZoom('cc', this.value)"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="cmCropReset('cc')">처음으로</button></div>
                            <p>목록과 상세에 정방형으로 보여요. 사진을 끌어 보일 부분을 맞추고, 슬라이더로 확대하세요.</p>
                        </div>
                        <p style="font-size:0.8rem;color:var(--wds-gray-500);margin:8px 0 0;">미입력 시 모임명 첫 글자가 표시됩니다.</p>
                    </div>
                    <div class="community-grid-2">
                        <div class="gforms-card">
                            <label class="gforms-label">비밀번호<span class="req">*</span> <span style="font-size:0.8rem;color:var(--wds-gray-500);font-weight:400;">(수정/삭제용)</span></label>
                            <input type="password" id="cc_pw" class="gforms-input" placeholder="비밀번호 입력">
                        </div>
                        <div class="gforms-card">
                            <label class="gforms-label">비밀번호 확인<span class="req">*</span></label>
                            <input type="password" id="cc_pw2" class="gforms-input" placeholder="비밀번호 재입력">
                        </div>
                    </div>
                    <div class="gforms-card">
                        <label class="gforms-label" style="font-size:1.05rem;font-weight:700;">참여자 작성 내용</label>
                        <div style="background:var(--wds-gray-100);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-size:0.85rem;color:var(--wds-gray-600);">
                            <div style="font-weight:700;margin-bottom:6px;color:var(--wds-gray-700);">기본 필수 항목 (자동 포함)</div>
                            <div style="display:flex;flex-direction:column;gap:4px;">
                                <span>• 이름 <span style="color:#e74c3c;font-weight:700;">*</span></span>
                                <span>• 연락처 <span style="color:#e74c3c;font-weight:700;">*</span></span>
                            </div>
                        </div>
                        <div id="communityCreateFieldEditor"></div>
                        <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="margin-top:4px" onclick="addCommunityCreateField()">+ 항목 추가</button>
                    </div>
                    <div class="gforms-submit-row" style="gap:8px;justify-content:flex-end;">
                        <button class="gaa-btn gaa-btn-secondary" onclick="communityToggleCreate()">취소</button>
                        <button class="gforms-submit" onclick="submitCommunityCreate()">모임 만들기</button>
                    </div>
                </div>`;
            }

            // 날짜별 타임라인(2026-10-13, 루마 lu.ma 식) — 모임 생성 중에는 숨김
            if (state.communityCreateOpen) {
                // hide existing meetings while creating
            } else if (paged.items.length === 0) {
                html += `<div class="cm-empty">${tab === 'current' ? '현재 모집 중인 모임이 없어요.' : '지난 모임이 없어요.'}</div>`;
            } else {
                const groups = [];
                paged.items.forEach(m => { const k = m.meeting_date || ''; let g = groups.find(x => x.k === k); if (!g) { g = { k, items: [] }; groups.push(g); } g.items.push(m); });
                const past = tab === 'past';
                html += `<div class="cm-tl">` + groups.map(g => {
                    const head = g.k
                        ? `<b>${_cmDateLong(g.k)}</b><span>${past ? '' : _cmRelLabel(g.k)}</span>${past ? '' : `<span class="dd cm-chip d">${_cmDday(g.k)}</span>`}`
                        : `<b>날짜 미정</b>`;
                    return `<div class="cm-grp${past ? ' past' : ''}"><div class="cm-day">${head}</div>${g.items.map(_cmEventCardHTML).join('')}</div>`;
                }).join('') + `</div>`;
                html += pagerHTML('commList', paged.page, paged.totalPages, paged.total);
            }
            if (!state.communityCreateOpen) html += `<button type="button" class="cm-fab" onclick="communityToggleCreate()">${_CM_ICON.plus} 모임 만들기</button>`;

            el.innerHTML = html;
            if (state.communityCreateOpen) { renderCommunityCreateFieldEditor(); initCommunityCal(); }
            _cmFitThumbs();
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(_cmFitThumbs);
        }

        // 모임 등록 폼의 공간 시간표 달력 — 대관 달력 렌더러를 커뮤니티 컨텍스트로 구동
        let _ccCalState = null;
        function initCommunityCal() {
            if (!document.getElementById('ccCalContainer')) return;
            _ccCalState = { calView: 'month', viewDate: new Date(), selectedDate: null, startSlot: null, endSlot: null, rangeConflicts: {}, blocks: [] };
            _calCtx = { state: _ccCalState, minSlots: 1, onChange: _ccCalOnChange, allowBlocked: true, // 차단 시간은 '요청' 칸
                ids: { container: 'ccCalContainer', label: 'ccCalLabel', monthBtn: 'ccCalMonthBtn', weekBtn: 'ccCalWeekBtn' } };
            renderPerfCal();
        }
        // 달력에서 고른 범위와 겹치는 게더링 차단(time_blocks) — 있으면 모임은 운영진 수락 후 공개된다
        function _ccRangeBlock() {
            const st = _ccCalState; if (!st || !st.selectedDate || st.startSlot === null || st.endSlot === null) return null;
            return perfBlocksForDate(st.selectedDate).find(b => { const bs = TIMES.indexOf(b.start_time), be = TIMES.indexOf(b.end_time); return st.startSlot <= be && st.endSlot >= bs; }) || null;
        }
        function _ccCalOnChange() {
            const st = _ccCalState; if (!st) return;
            const dateEl = document.getElementById('cc_date');
            const sEl = document.getElementById('cc_start_time');
            const eEl = document.getElementById('cc_end_time');
            const sum = document.getElementById('ccCalSummary');
            if (st.selectedDate && dateEl) dateEl.value = st.selectedDate;
            if (st.startSlot !== null && sEl) sEl.value = TIMES[st.startSlot];
            if (st.endSlot !== null && eEl) eEl.value = TIMES[st.endSlot];
            if (!sum) return;
            if (st.selectedDate && st.startSlot !== null && st.endSlot !== null) {
                sum.textContent = `선택: ${st.selectedDate.replace(/-/g, '.')} ${TIMES[st.startSlot]} ~ ${TIMES[st.endSlot + 1] || '23:00'} → 아래 날짜·시간에 입력됨`;
                if (_ccRangeBlock()) sum.textContent += ' · ⚠ 게더링이 막아 둔 시간이 포함돼 운영진 수락 후 공개됩니다';
            } else if (st.selectedDate && st.startSlot !== null) {
                sum.textContent = `${st.selectedDate.replace(/-/g, '.')} ${TIMES[st.startSlot]} 시작 — 종료 슬롯을 클릭하세요`;
            } else if (st.selectedDate) {
                sum.textContent = `${st.selectedDate.replace(/-/g, '.')} — 시작 시간 슬롯을 클릭하세요`;
            } else sum.textContent = '';
        }

        function communitySetTab(tab) {
            state.communityTab = tab;
            state.paging['commList'] = 0;
            _pushNav('community/' + tab); // 탭 단위 딥링크 주소 발행
            if (tab === 'test') {
                renderCommunityTestHome();
            } else {
                renderCommunityList();
            }
        }

        function communityToggleCreate() {
            // 열기 전에 사전 미팅 확인 게이트를 거친다 (닫기는 즉시)
            if (!state.communityCreateOpen) { showCommunityPreMeetingGate(); return; }
            state.communityCreateOpen = false;
            renderCommunityList();
        }
        function _openCommunityCreate() {
            state.communityCreateOpen = true;
            state.communityCreateFields = [];
            renderCommunityList();
        }

        // 모임 생성 게이트 — 사전 미팅 여부 확인. '아니오'면 사전 미팅 신청 구글폼으로 안내.
        const COMMUNITY_PREMEETING_FORM_URL = 'https://forms.gle/FRPAsjnbKJwMDHmE7';
        function showCommunityPreMeetingGate() {
            document.getElementById('commPreMeetingModal')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'commPreMeetingModal';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = `<div style="background:var(--wds-white);border-radius:var(--wds-radius-l);padding:28px 24px 24px;max-width:380px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.25);text-align:center;word-break:keep-all;">
                <div style="font-size:2rem;line-height:1;margin-bottom:12px">🤝</div>
                <h3 style="margin:0 0 10px;font-size:1.05rem;font-weight:800;color:var(--wds-black);">모임 관련 사전 미팅을 진행하셨나요?</h3>
                <p style="margin:0 0 22px;font-size:0.86rem;color:var(--wds-gray-700);line-height:1.6;">사전 미팅을 거치지 않은 모임은 삭제될 수 있습니다.<br>아직이라면 <b>아니오</b>를 눌러 사전 미팅 신청 폼을 먼저 작성해주세요.</p>
                <div style="display:flex;gap:8px;">
                    <button type="button" class="gaa-btn gaa-btn-secondary" style="flex:1" onclick="communityPreMeetingAnswer(false)">아니오</button>
                    <button type="button" class="gaa-btn gaa-btn-primary" style="flex:1" onclick="communityPreMeetingAnswer(true)">예</button>
                </div>
            </div>`;
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);
        }
        function communityPreMeetingAnswer(yes) {
            document.getElementById('commPreMeetingModal')?.remove();
            if (yes) { _openCommunityCreate(); return; }
            window.open(COMMUNITY_PREMEETING_FORM_URL, '_blank', 'noopener');
            showToast('사전 미팅 신청 폼이 열렸습니다. 미팅 후 모임을 만들어주세요.');
        }

        // ── 신청폼 질문 편집기(2026-10-13): 만들기('cc' → state.communityCreateFields)·수정('ce' → state.communityEditFields) 공용 ──
        // 질문 { label, type:'text'|'textarea'|'select'|'multi'|'consent', required, placeholder, options:[], limits:{선택지:정원}, showIf:{field:기준 질문 label, value}, text(동의 문구) }
        // 답변 form_data[label]: text/textarea/select → 문자열, multi → 배열, consent → '동의' | ''. 조건으로 숨겨진 질문은 저장하지 않는다.
        const CM_Q_TYPES = [['text', '텍스트'], ['textarea', '장문'], ['select', '단일 선택'], ['multi', '복수 선택'], ['consent', '동의'], ['note', '안내문']]; // note = 입력칸 없는 안내 글(섹션 제목·주의사항·마무리 인사)
        const _cmQKeys = { cc: 'communityCreateFields', ce: 'communityEditFields' };
        const cmQHasOptions = (f) => f.type === 'select' || f.type === 'multi';
        const cmQIsCond = (f) => f.type === 'select' || f.type === 'multi' || f.type === 'consent'; // 표시 조건의 기준이 될 수 있는 질문
        const cmAnswerText = (v) => Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v)); // 메일·CSV 표기
        function _cmQList(k) { if (!Array.isArray(state[_cmQKeys[k]])) state[_cmQKeys[k]] = []; return state[_cmQKeys[k]]; }
        function _cmQRerender(k) { if (k === 'cc') renderCommunityCreateFieldEditor(); else renderCommunityFieldEditor(); }
        function cmQ(k, i, patch) { // 질문 속성 바꾸기 — label 이 바뀌면 이 질문을 조건으로 쓰는 질문의 showIf 도 따라간다
            const list = _cmQList(k), f = list[i]; if (!f) return;
            if (patch.label !== undefined && patch.label !== f.label) list.forEach(g => { if (g.showIf && g.showIf.field === f.label) g.showIf.field = patch.label; });
            Object.assign(f, patch);
            if (patch.type !== undefined) { if (cmQHasOptions(f) && !Array.isArray(f.options)) f.options = ['', '']; _cmQRerender(k); }
            if (patch.label !== undefined) _cmQRerender(k); // 조건 선택지 목록 갱신
        }
        function cmQAdd(k) { _cmQList(k).push({ label: '', type: 'text', placeholder: '', required: false }); _cmQRerender(k); setTimeout(() => { const els = document.querySelectorAll(`#${k === 'cc' ? 'communityCreateFieldEditor' : 'communityFieldEditor'} .cm-q-label`); els[els.length - 1]?.focus(); }, 0); }
        function cmQRemove(k, i) { const list = _cmQList(k); const [f] = list.splice(i, 1); if (f) list.forEach(g => { if (g.showIf && g.showIf.field === f.label) delete g.showIf; }); _cmQRerender(k); }
        function cmQMove(k, i, dir) { const list = _cmQList(k), j = i + dir; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; _cmQRerender(k); }
        function cmQDup(k, i) { const list = _cmQList(k); if (!list[i]) return; const c = JSON.parse(JSON.stringify(list[i])); c.label = (c.label || '') + ' (복사)'; delete c.showIf; list.splice(i + 1, 0, c); _cmQRerender(k); }
        function cmQOptAdd(k, i) { const f = _cmQList(k)[i]; if (!f) return; (f.options = f.options || []).push(''); _cmQRerender(k); setTimeout(() => document.getElementById(`${k}_q${i}_opt${f.options.length - 1}`)?.focus(), 0); }
        function cmQOptSet(k, i, j, v) { // 선택지 글 바꾸기 — 정원·조건이 그 선택지를 가리키면 함께 옮긴다
            const f = _cmQList(k)[i]; if (!f || !f.options) return; const old = f.options[j]; if (old === v) return; f.options[j] = v;
            if (f.limits && old in f.limits) { f.limits[v] = f.limits[old]; delete f.limits[old]; }
            _cmQList(k).forEach(g => { if (g.showIf && g.showIf.field === f.label && g.showIf.value === old) g.showIf.value = v; });
        }
        function cmQOptLimit(k, i, j, v) { const f = _cmQList(k)[i]; if (!f || !f.options) return; const n = parseInt(v, 10); f.limits = f.limits || {}; if (n > 0) f.limits[f.options[j]] = n; else delete f.limits[f.options[j]]; }
        function cmQOptRemove(k, i, j) { const f = _cmQList(k)[i]; if (!f || !f.options) return; const [o] = f.options.splice(j, 1); if (f.limits) delete f.limits[o]; _cmQRerender(k); }
        function cmQOptKey(e, k, i, j) { if (e.key === 'Enter') { e.preventDefault(); cmQOptSet(k, i, j, e.target.value); cmQOptAdd(k, i); } }
        function cmQCond(k, i, field) { // 표시 조건 기준 질문 고르기(값은 그 질문의 첫 선택지)
            const list = _cmQList(k), f = list[i]; if (!f) return;
            const src = field ? list.find(g => g.label === field) : null;
            if (!src) delete f.showIf; else f.showIf = { field, value: src.type === 'consent' ? 'yes' : ((src.options || []).find(Boolean) || '') };
            _cmQRerender(k);
        }
        function cmQCondValue(k, i, value) { const f = _cmQList(k)[i]; if (f && f.showIf) f.showIf.value = value; }
        function cmQEditorHTML(k) {
            const list = _cmQList(k);
            if (!list.length) return `<div class="cm-q-empty">추가된 질문이 없어요. 이름·연락처는 기본으로 받습니다.</div>`;
            return list.map((f, i) => {
                const typeSel = `<select class="cm-q-type" onchange="cmQ('${k}', ${i}, { type: this.value })" aria-label="질문 유형">${CM_Q_TYPES.map(([v, l]) => `<option value="${v}"${f.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
                let body = '';
                if (cmQHasOptions(f)) {
                    const opts = f.options || [];
                    body = `<div class="cm-q-opts">${opts.map((o, j) => `<div class="cm-q-opt">
                        <input type="text" id="${k}_q${i}_opt${j}" value="${escapeHtml(o)}" placeholder="선택지 ${j + 1}" onchange="cmQOptSet('${k}', ${i}, ${j}, this.value)" onkeydown="cmQOptKey(event, '${k}', ${i}, ${j})">
                        <input type="number" min="1" inputmode="numeric" value="${f.limits && f.limits[o] ? f.limits[o] : ''}" placeholder="정원" title="이 선택지를 고를 수 있는 최대 인원 (비우면 제한 없음)" onchange="cmQOptLimit('${k}', ${i}, ${j}, this.value)">
                        <button type="button" class="cm-q-x" onclick="cmQOptRemove('${k}', ${i}, ${j})" aria-label="선택지 삭제">×</button>
                    </div>`).join('')}
                    <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="cmQOptAdd('${k}', ${i})">+ 선택지 추가</button>
                    <div class="cm-q-hint">정원을 적으면 그 수만큼 신청되는 순간 그 선택지는 "마감"으로 표시돼요. 선택지 칸에서 Enter 를 누르면 다음 선택지가 추가됩니다.</div></div>`;
                } else if (f.type === 'consent') {
                    body = `<textarea class="cm-q-text" rows="2" placeholder="동의 문구 (예: 모임 사진이 게더링 SNS 에 올라갈 수 있어요)" onchange="cmQ('${k}', ${i}, { text: this.value })">${escapeHtml(f.text || '')}</textarea><div class="cm-q-hint">신청자에게 체크 한 칸으로 보여요. 필수로 두면 체크해야 신청할 수 있어요.</div>`;
                } else if (f.type === 'note') {
                    body = `<textarea class="cm-q-text" rows="2" placeholder="안내 글 (예: 적어주신 번호로 1~3일 안에 연락드려요)" onchange="cmQ('${k}', ${i}, { text: this.value })">${escapeHtml(f.text || '')}</textarea><div class="cm-q-hint">입력칸 없이 제목(위 칸)과 글만 보여요. 섹션 제목·주의사항·마무리 인사에 쓰세요.</div>`;
                } else {
                    body = `<input type="text" class="cm-q-ph" value="${escapeHtml(f.placeholder || '')}" placeholder="작성 안내 (예: 곡명 - 아티스트)" onchange="cmQ('${k}', ${i}, { placeholder: this.value })">`;
                }
                // 표시 조건: 다른 선택/동의 질문의 답이 특정 값일 때만 보이기
                const srcs = list.map((g, gi) => ({ g, gi })).filter(x => x.gi !== i && cmQIsCond(x.g) && x.g.label);
                const cur = f.showIf || null;
                const src = cur ? srcs.find(x => x.g.label === cur.field) : null;
                const vals = src ? (src.g.type === 'consent' ? [['yes', '동의함']] : (src.g.options || []).filter(Boolean).map(o => [o, o])) : [];
                const cond = srcs.length ? `<div class="cm-q-cond"><span>표시 조건</span>
                    <select onchange="cmQCond('${k}', ${i}, this.value)" aria-label="표시 조건 기준 질문"><option value="">항상 표시</option>${srcs.map(x => `<option value="${escapeHtml(x.g.label)}"${cur && cur.field === x.g.label ? ' selected' : ''}>Q${x.gi + 1} ${escapeHtml(x.g.label)}</option>`).join('')}</select>
                    ${src ? `<span>의 답이</span><select onchange="cmQCondValue('${k}', ${i}, this.value)" aria-label="표시 조건 값">${vals.map(([v, l]) => `<option value="${escapeHtml(v)}"${cur.value === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select><span>일 때만</span>` : ''}
                </div>` : '';
                return `<div class="cm-q" data-qi="${i}">
                    <div class="cm-q-head">
                        <span class="cm-q-no">Q${i + 1}</span>
                        <input type="text" class="cm-q-label" value="${escapeHtml(f.label || '')}" placeholder="질문 (예: 담당 파트)" onchange="cmQ('${k}', ${i}, { label: this.value })">
                        ${typeSel}
                    </div>
                    ${body}
                    <div class="cm-q-foot">
                        ${f.type === 'note' ? '' : `<label class="cm-q-req"><input type="checkbox" ${f.required ? 'checked' : ''} onchange="cmQ('${k}', ${i}, { required: this.checked })"> 필수</label>`}
                        ${cond}
                        <span class="cm-q-tools">
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="cmQMove('${k}', ${i}, -1)"${i === 0 ? ' disabled' : ''} aria-label="위로">↑</button>
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="cmQMove('${k}', ${i}, 1)"${i === list.length - 1 ? ' disabled' : ''} aria-label="아래로">↓</button>
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="cmQDup('${k}', ${i})">복제</button>
                            <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost-danger" onclick="cmQRemove('${k}', ${i})">삭제</button>
                        </span>
                    </div>
                </div>`;
            }).join('');
        }
        // 저장 전 정리: 빈 질문 제거, 선택지 공백 정리, 정원은 있는 선택지만, 조건은 존재하는 질문만
        function cmCleanFields(fields) {
            const out = (Array.isArray(fields) ? fields : []).map(f => ({ ...f, label: String(f.label || '').trim() })).filter(f => f.label);
            const labels = new Set(out.map(f => f.label));
            out.forEach(f => {
                if (cmQHasOptions(f)) {
                    f.options = (f.options || []).map(o => String(o).trim()).filter(Boolean);
                    const lim = {}; Object.entries(f.limits || {}).forEach(([o, n]) => { if (f.options.includes(o) && parseInt(n, 10) > 0) lim[o] = parseInt(n, 10); });
                    if (Object.keys(lim).length) f.limits = lim; else delete f.limits;
                } else { delete f.options; delete f.limits; }
                if (f.type !== 'consent' && f.type !== 'note') delete f.text; else f.text = String(f.text || '').trim();
                if (f.type === 'consent' || f.type === 'note' || cmQHasOptions(f)) delete f.placeholder;
                if (f.type === 'note') { delete f.required; delete f.showIf; }
                if (f.showIf && (!labels.has(f.showIf.field) || f.showIf.field === f.label || !f.showIf.value)) delete f.showIf;
            });
            return out;
        }
        function cmDupLabel(fields) { const seen = new Set(); for (const f of fields) { if (seen.has(f.label)) return f.label; seen.add(f.label); } return null; }
        function cmFieldsProblem(fields) { // 저장 막을 문제가 있으면 문구
            const dup = cmDupLabel(fields); if (dup) return `질문 "${dup}"이(가) 두 번 있어요. 질문 이름은 서로 달라야 합니다.`;
            const noOpt = fields.find(f => cmQHasOptions(f) && (f.options || []).length < 1); if (noOpt) return `"${noOpt.label}" 질문에 선택지를 하나 이상 적어주세요.`;
            return null;
        }
        // ── 신청 폼 쪽: 선택지 정원·조건·값 읽기·집계 ──
        function cmOptionCounts(formFields, apps) { // 선택지별 신청 수(거절 제외) — 정원 마감 판정·집계 공용
            const counts = {};
            formFields.forEach(f => { if (cmQHasOptions(f) || f.type === 'consent') counts[f.label] = {}; });
            (apps || []).forEach(a => {
                if ((a.status || 'pending') === 'rejected') return;
                const fd = a.form_data || {};
                formFields.forEach(f => {
                    const c = counts[f.label], v = fd[f.label]; if (!c || v === undefined || v === null || v === '') return;
                    (Array.isArray(v) ? v : [v]).forEach(o => { c[o] = (c[o] || 0) + 1; });
                });
            });
            return counts;
        }
        const cmOptFull = (f, counts, o) => !!(f.limits && f.limits[o] && ((counts[f.label] || {})[o] || 0) >= f.limits[o]);
        function cmApplyFieldsHTML(formFields, appList) {
            const counts = cmOptionCounts(formFields, appList);
            let no = 0; // 안내문을 뺀 질문 번호
            return formFields.map((f, i) => {
                if (f.type === 'note') return `<div class="cm-f" data-qi="${i}"><div class="cm-note">${f.label ? `<b>${escapeHtml(f.label)}</b>` : ''}${escapeHtml(f.text || '')}</div></div>`;
                no++;
                const fid = `ca_custom_${i}`, req = f.required ? '<span class="req">*</span>' : '', num = `<span class="cm-f-no">${no}</span>`;
                let inner;
                if (f.type === 'textarea') inner = `<label for="${fid}">${num}${escapeHtml(f.label)}${req}</label><textarea id="${fid}" rows="3" placeholder="${escapeHtml(f.placeholder || '')}" oninput="cmGrow(this)"></textarea>`;
                else if (f.type === 'select') inner = `<label for="${fid}">${num}${escapeHtml(f.label)}${req}</label><select id="${fid}" onchange="cmApplyCond()"><option value="">선택하세요</option>${(f.options || []).map(o => { const full = cmOptFull(f, counts, o); return `<option value="${escapeHtml(o)}"${full ? ' disabled' : ''}>${escapeHtml(o)}${full ? ' (마감)' : ''}</option>`; }).join('')}</select>`;
                else if (f.type === 'multi') inner = `<span class="cm-f-label">${num}${escapeHtml(f.label)}${req}</span><div class="cm-checks" id="${fid}">${(f.options || []).map(o => { const full = cmOptFull(f, counts, o); return `<label class="cm-check${full ? ' full' : ''}"><input type="checkbox" value="${escapeHtml(o)}"${full ? ' disabled' : ''} onchange="cmApplyCond()"> ${escapeHtml(o)}${full ? ' <small>마감</small>' : ''}</label>`; }).join('')}</div>`;
                else if (f.type === 'consent') inner = `<span class="cm-f-label">${num}${escapeHtml(f.label)}${req}</span><label class="cm-consent"><input type="checkbox" id="${fid}" onchange="cmApplyCond()"> <span><b>동의합니다</b>${f.text ? `<small>${escapeHtml(f.text)}</small>` : ''}</span></label>`;
                else inner = `<label for="${fid}">${num}${escapeHtml(f.label)}${req}</label><input type="text" id="${fid}" placeholder="${escapeHtml(f.placeholder || '')}">`;
                return `<div class="cm-f" data-qi="${i}"${f.showIf ? ' hidden' : ''}>${inner}</div>`;
            }).join('');
        }
        function cmGrow(el) { el.style.height = 'auto'; el.style.height = Math.max(84, el.scrollHeight) + 'px'; } // 장문 칸: 내용만큼 늘어남
        function cmPhoneFmt(el) { // 연락처 자동 하이픈(010-1234-5678 / 02-… 는 그대로 둠)
            const d = el.value.replace(/\D/g, '').slice(0, 11);
            if (!d.startsWith('01')) return;
            el.value = d.length <= 3 ? d : d.length <= 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : d.length <= 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
        }
        // 신청 폼 인라인 오류: 해당 칸을 빨갛게 표시하고 안내를 아래 붙인 뒤 그리로 스크롤(알림창 대신)
        function cmFieldError(wrapSel, msg) {
            document.querySelectorAll('#communityApplyForm .cm-f.err').forEach(w => { w.classList.remove('err'); w.querySelector('.cm-f-err')?.remove(); });
            const w = document.querySelector(wrapSel);
            if (!w) { showToast(msg); return; }
            w.classList.add('err');
            const e = document.createElement('div'); e.className = 'cm-f-err'; e.textContent = msg; w.appendChild(e);
            w.scrollIntoView({ behavior: 'smooth', block: 'center' });
            (w.querySelector('input:not([type=checkbox]), select, textarea') || w.querySelector('input'))?.focus({ preventScroll: true });
            const clear = () => { w.classList.remove('err'); w.querySelector('.cm-f-err')?.remove(); };
            w.addEventListener('input', clear, { once: true }); w.addEventListener('change', clear, { once: true });
        }
        function cmFieldValue(f, i) {
            if (f.type === 'multi') return [...document.querySelectorAll(`#ca_custom_${i} input:checked`)].map(x => x.value);
            const el = document.getElementById(`ca_custom_${i}`); if (!el) return '';
            if (f.type === 'consent') return el.checked ? '동의' : '';
            if (f.type === 'note') return '';
            return String(el.value || '').trim();
        }
        function cmCondVisible(f, formFields, i, depth = 0) { // 표시 조건 평가 — 기준 질문이 숨겨져 있으면 같이 숨김
            if (!f.showIf || depth > 10) return true;
            const si = formFields.findIndex(g => g.label === f.showIf.field); if (si < 0) return true;
            const src = formFields[si];
            if (!cmCondVisible(src, formFields, si, depth + 1)) return false;
            const v = cmFieldValue(src, si);
            if (src.type === 'consent') return v === '동의';
            return Array.isArray(v) ? v.includes(f.showIf.value) : v === f.showIf.value;
        }
        function cmApplyCond() {
            const formFields = state.communityCurrentFormFields || [];
            formFields.forEach((f, i) => { const w = document.querySelector(`#communityApplyForm .cm-f[data-qi="${i}"]`); if (w) w.hidden = !cmCondVisible(f, formFields, i); });
            let no = 0; // 보이는 질문만 다시 번호 매김(조건으로 숨긴 질문 때문에 번호가 건너뛰지 않게)
            document.querySelectorAll('#communityApplyForm .cm-f[data-qi]:not([hidden]) .cm-f-no').forEach(e => { e.textContent = ++no; });
        }
        function cmAggregationHTML(formFields, appList) { // 신청자 관리 탭 「답변 집계」
            const qs = (formFields || []).filter(f => f.label && f.type !== 'note');
            if (!qs.length) return '';
            const counts = cmOptionCounts(qs, appList);
            const active = (appList || []).filter(a => (a.status || 'pending') !== 'rejected');
            const rows = qs.map((f, i) => {
                if (cmQHasOptions(f) || f.type === 'consent') {
                    const c = counts[f.label] || {}, opts = f.type === 'consent' ? ['동의'] : (f.options || []);
                    // 선택지마다 「이름 N(/정원)」 칩 한 줄 — 0명은 흐리게, 정원 찬 것은 주황
                    return `<div class="cm-agg"><div class="cm-agg-q">Q${i + 1} ${escapeHtml(f.label)}</div><div class="cm-agg-chips">${opts.map(o => { const n = c[o] || 0, lim = f.limits && f.limits[o]; return `<span class="cm-agg-row${lim && n >= lim ? ' full' : (n ? '' : ' zero')}"><span class="o">${escapeHtml(o)}</span><span class="n">${n}${lim ? `/${lim}` : ''}</span></span>`; }).join('')}</div></div>`;
                }
                const answered = active.filter(a => cmAnswerText((a.form_data || {})[f.label]).trim()).length;
                return `<div class="cm-agg"><div class="cm-agg-q">Q${i + 1} ${escapeHtml(f.label)}<small>답변 ${answered}명 · 내용은 CSV 에서</small></div></div>`;
            }).join('');
            return `<details class="cm-agg-wrap"><summary>답변 집계 <small>${active.length}명 기준 · 질문 ${qs.length}개 (거절 제외)</small></summary><div class="cm-agg-body">${rows}</div></details>`;
        }

        function renderCommunityCreateFieldEditor() {
            const el = document.getElementById('communityCreateFieldEditor');
            if (el) el.innerHTML = cmQEditorHTML('cc');
        }
        function addCommunityCreateField() { cmQAdd('cc'); }
        function removeCommunityCreateField(i) { cmQRemove('cc', i); }

        async function submitCommunityCreate() {
            const title = document.getElementById('cc_title').value.trim();
            const date = document.getElementById('cc_date').value;
            const startTime = document.getElementById('cc_start_time').value;
            const endTime = document.getElementById('cc_end_time').value;
            const orgName = document.getElementById('cc_org_name').value.trim();
            const orgPhone = document.getElementById('cc_org_phone').value.trim();
            const orgEmail = document.getElementById('cc_org_email').value.trim();
            const feeRaw = document.getElementById('cc_fee').value.trim();
            const fee = feeRaw ? `${parseInt(feeRaw).toLocaleString('ko-KR')}원` : null;
            const items = document.getElementById('cc_items').value.trim();
            const capacity = document.getElementById('cc_capacity').value;
            const deadline = document.getElementById('cc_deadline').value;
            const desc = rteValue('cc_desc'); // 서식 HTML(링크·사진 포함, 살균됨)
            const pw = document.getElementById('cc_pw').value;
            const pw2 = document.getElementById('cc_pw2').value;
            const imgFile = document.getElementById('cc_image').files[0];

            if (!title) return showToast('모임명을 입력해주세요.');
            if (!date) return showToast('모임 날짜를 입력해주세요.');
            if (!startTime || !endTime) return showToast('모임 시간을 선택해주세요.');
            if (TIMES.indexOf(startTime) > TIMES.indexOf(endTime)) return showToast('시작 시간이 종료 시간보다 늦을 수 없습니다.');
            if (!orgName) return showToast('모임장 이름을 입력해주세요.');
            if (!orgPhone) return showToast('모임장 연락처를 입력해주세요.');
            if (!orgEmail) return showToast('모임장 이메일을 입력해주세요.');
            if (!desc) return showToast('모임 설명을 입력해주세요.');
            if (!capacity || parseInt(capacity) < 1) return showToast('정원은 1명 이상 필수입니다.');
            if (deadline && date && deadline > date) return showToast('신청 마감일은 모임 날짜보다 늦을 수 없습니다.');
            if (!pw) return showToast('비밀번호는 필수입니다.');
            if (pw !== pw2) return showToast('비밀번호가 일치하지 않습니다.');
            const qProblem = cmFieldsProblem(cmCleanFields(state.communityCreateFields)); if (qProblem) return showToast(qProblem);

            // 예약·대관과 겹치면 불가, 게더링 차단(time_blocks)만 겹치면 운영진 수락 요청(pending)으로 진행
            await fetchCommunityReservationsAndBlocks();
            const conflict = checkCommunityTimeConflict(date, startTime, endTime);
            if (conflict && conflict.kind !== 'block') return showToast(conflict.message);
            const needsApproval = !!conflict;
            if (needsApproval && !confirm(`선택한 시간은 게더링이 막아 둔 시간과 겹칩니다.\n${conflict.range}${conflict.reason ? ' · ' + conflict.reason : ''}\n\n운영진에게 사용 요청을 보내고, 수락되면 모임이 커뮤니티에 공개됩니다.\n요청을 보낼까요?`)) return;

            const salt = genSalt();
            const hash = await hashPw(pw, salt);

            let coverImageUrl = null;
            if (imgFile) {
                try { coverImageUrl = await uploadCommunityImage(await cmCropExport('cc', imgFile)); cmCropClear('cc'); } // 정방형으로 잘라 올린다
                catch (e) { alert('이미지 업로드 실패: ' + e.message + '\n이미지 없이 모임을 생성합니다.'); }
            }

            const timeText = `${startTime} ~ ${TIMES[TIMES.indexOf(endTime)+1] || '23:00'}`;
            const payload = {
                title, cover_image_url: coverImageUrl,
                meeting_date: date || null,
                meeting_time: timeText,
                organizer_name: orgName, organizer_phone: orgPhone || null, organizer_email: orgEmail,
                fee: fee || null, items_to_bring: items || null,
                capacity: capacity ? parseInt(capacity) : null,
                application_deadline: deadline || null,
                description: desc || null,
                password_salt: salt, password_hash: hash,
                is_closed: false, form_fields: cmCleanFields(state.communityCreateFields)
            };

            payload.status = needsApproval ? 'pending' : 'active'; // pending = 운영진 수락 전(목록 비공개), 수락은 /community-admin 이 처리
            const { data, error } = await supabaseClient.from('community_meetings').insert(payload).select().single();
            if (error) {
                console.error('community_meetings insert:', error);
                const em = String(error.message || '');
                if (/status/.test(em) && /column|schema/i.test(em)) return showToast('모임 상태 컬럼이 아직 없습니다. 관리자가 supabase/migrations/20261013_community_meeting_status.sql 을 실행해야 합니다.');
                return showToast('모임 생성 실패: ' + em);
            }

            if (!needsApproval) {
                // 시간표(time_blocks)에 반영 — 요청 건은 운영진이 수락할 때 서버가 넣는다
                try {
                    const [y, m, d] = date.split('-').map(Number);
                    const dow = new Date(y, m - 1, d).getDay();
                    await supabaseClient.from('time_blocks').insert({
                        day_of_week: dow,
                        start_time: startTime,
                        end_time: endTime,
                        reason: `[커뮤니티] ${title}`,
                        start_date: date,
                        end_date: date,
                    });
                } catch (e) { console.warn('time_block 생성 실패:', e); }
            }
            // 운영 총괄 배너(푸시) 알림 — 실패해도 모임 생성은 완료
            sendAdminPush(needsApproval ? '🙋 커뮤니티 모임 시간 사용 요청' : '🎪 새 커뮤니티 모임 등록',
                `${title} · ${date.replace(/-/g, '.')} ${timeText} · ${orgName}${needsApproval ? ' — 공간대관 탭에서 수락/거절' : ''}`,
                { roles: ['운영 총괄'] }).catch(() => {});

            state.communityCreateOpen = false;
            await fetchCommunityMeetings();
            renderCommunityList();
            if (needsApproval) alert('사용 요청을 보냈습니다.\n운영진이 수락하면 모임이 커뮤니티 목록에 공개됩니다. 수락·거절 결과는 모임장 이메일로 안내됩니다.');
        }

        async function renderCommunityDetail(id) {
            state.communityView = 'detail';
            state.communityCurrentId = id;
            const m = state.communityMeetings.find(x => x.id === id);
            if (!m) { await fetchCommunityMeetings(); }
            const meeting = state.communityMeetings.find(x => x.id === id);
            if (!meeting) return showToast('모임 정보를 찾을 수 없습니다.');
            state.communityCurrentMeeting = meeting;
            _pushNav('community/meeting/' + id); // 모임별 공유 링크 — 뒤로가기로 목록 복귀

            // 공개 화면은 이름·연락처 없는 요약(상태 + 선택형 답)만 받고, 모임장 인증 뒤에만 전체 명단을 받는다
            let apps = null, srv = null;
            if (state.communityEditAuth[id] && state.communityOrgTok[id]) {
                srv = await _cmOrgApi('app_list', id);
                if (!srv.down && !srv.ok) { showToast(srv.message || '모임장 인증이 만료되었습니다. 비밀번호를 다시 입력해주세요.', 5000); srv = null; }
            }
            if (!srv) srv = await _cmApi('app_public', { meeting_id: id });
            if (srv.down) {
                ({ data: apps } = await supabaseClient
                    .from('community_applications')
                    .select('*')
                    .eq('meeting_id', id)
                    .order('created_at', { ascending: true }));
            } else apps = srv.ok ? srv.rows : [];
            const appList = apps || [];
            const cnt = appList.length;
            // 정원·신청 현황은 거절 건 제외 — 거절하면 자리가 다시 열린다 (status 컬럼 이전 데이터는 pending 취급)
            const activeCnt = appList.filter(a => (a.status || 'pending') !== 'rejected').length;
            state.communityApplicationCounts[id] = activeCnt;
            state.communityCurrentAppList = appList;
            state.communityCurrentFormFields = Array.isArray(meeting.form_fields) ? meeting.form_fields : [];

            const authed = !!state.communityEditAuth[id];
            const editMode = authed && state.communityEditView === id;
            const closed = communityIsClosed(meeting);
            const dateStr = meeting.meeting_date ? meeting.meeting_date.replace(/-/g, '.') : '';
            const formFields = state.communityCurrentFormFields;

            const el = document.getElementById('communityContent');
            if (!el) return;
            communityBarVisible(false);
            cmApplySheetClose(); // 신청 완료 재렌더·재진입 때 남은 시트 정리

            // 상단 줄: [‹ 목록으로] … [공유] [수정]
            let html = `<div class="cm-top">
                <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="${editMode ? `communityExitEdit('${id}')` : 'communityBackToList()'}">‹ ${editMode ? '상세보기' : '목록으로'}</button>
                ${editMode ? '' : `<div class="r"><button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="shareCommunityMeeting('${id}')">${_CM_ICON.share} 공유</button><button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="communityShowAuthModal('${id}')">수정</button></div>`}
            </div>`;

            // 수정 모드일 때는 hero/설명/신청폼 모두 숨기고 수정 폼만 렌더링
            if (editMode) {
                html += renderCommunityEditView(meeting, id, appList, formFields);
                el.innerHTML = html;
                if (state.communityEditTab === 'fields') {
                    state.communityEditFields = JSON.parse(JSON.stringify(formFields));
                    renderCommunityFieldEditor();
                }
                window.scrollTo({ top: 0, behavior: 'instant' });
                return;
            }

            // ── 절제형 발전안(2026-10-13): 사진 → [모집중 + 날짜] → 제목 → 장소 → 요약 띠(참여비·정원·마감) → 모임장·준비물 → 설명(접기) → 신청 카드, 아래 고정 신청 바.
            //    데스크톱(≥768px)은 사진 왼쪽·정보 오른쪽 2단(.cm-hero). 신청 인원은 공개하지 않는다(COMMUNITY_SHOW_APPLICANT_COUNT 참고).
            const isFree = communityIsFreeMeeting(meeting.fee);
            const feeLabel = isFree ? '무료' : (meeting.fee ? escapeHtml(meeting.fee) : '미정');
            const phoneDigits = String(meeting.organizer_phone || '').replace(/[^\d+]/g, '');
            html += `<div class="cm-hero">
                <div class="cm-cover">${_cmCoverImg(meeting)}</div>
                <div>
                    <div class="cm-eyebrow">${closed ? '<span class="cm-chip closed">모집 마감</span>' : '<span class="cm-chip ok">모집중</span>'}${!closed && isFree ? '<span class="cm-chip free">무료</span>' : ''}${meeting.meeting_date ? `<span>${_cmDateLong(meeting.meeting_date)}${meeting.meeting_time ? ' ' + escapeHtml(meeting.meeting_time) : ''}</span>` : (meeting.meeting_time ? `<span>${escapeHtml(meeting.meeting_time)}</span>` : '')}</div>
                    <h1 class="cm-title">${escapeHtml(meeting.title)}</h1>
                    ${meeting.location ? `<div class="cm-place">${_CM_ICON.pin} ${escapeHtml(meeting.location)}</div>` : ''}
                    <div class="cm-stats">
                        <div><small>참여비</small><b>${feeLabel}</b></div>
                        <div><small>정원</small><b>${meeting.capacity ? meeting.capacity + '명' : '제한 없음'}</b></div>
                        <div><small>신청 마감</small><b>${meeting.application_deadline ? _cmDateShort(meeting.application_deadline) : (meeting.meeting_date ? '모임 당일' : '-')}</b></div>
                    </div>
                    <div class="cm-rows">
                        <div class="r"><span class="k">모임장</span><span class="v"><span class="cm-av">${escapeHtml((meeting.organizer_name || '?')[0])}</span><span class="txt">${escapeHtml(meeting.organizer_name || '')}</span>${phoneDigits ? `<a class="lnk" href="tel:${phoneDigits}">문의하기</a>` : ''}</span></div>
                        ${meeting.items_to_bring ? `<div class="r"><span class="k">준비물</span><span class="v"><span class="txt">${escapeHtml(meeting.items_to_bring)}</span></span></div>` : ''}
                    </div>
                </div>
            </div>
            <div class="cm-lower">`;

            // 모임 설명 — 항상 전부 보인다(2026-10-13, 접기 없음)
            if (meeting.description) html += `<div class="cm-sec"><h2>모임 설명</h2><div class="cm-desc" id="communityDesc">${renderMarkdown(meeting.description)}</div></div>`; // 서식 HTML·옛 평문 모두 DOMPurify 경유
            html += `</div>`; // .cm-lower

            // 참여 신청서는 본문에 두지 않고 [참여 신청하기] 를 누르면 시트로 연다(cmApplySheetOpen). 입력 id 는 submitCommunityApplication 과 동일: ca_name/ca_phone/ca_custom_i
            state.communityApplyFormHTML = closed ? '' : cmApplyFormHTML(id, formFields, appList);

            // 아래 고정 신청 바 — 마감이면 비활성
            html += `<div class="cm-sticky-pad"></div><div class="cm-sticky"><div class="pr"><small>참여비</small><b>${feeLabel}</b></div>${closed
                ? `<button type="button" class="gaa-btn gaa-btn-primary" disabled>모집 마감</button>`
                : `<button type="button" class="gaa-btn gaa-btn-primary" onclick="cmApplySheetOpen()">참여 신청하기</button>`}</div>`;

            el.innerHTML = html;
            window.scrollTo({ top: 0, behavior: 'instant' });
        }
        // 신청서 본문(시트 안 .cm-form 내용)
        function cmApplyFormHTML(id, formFields, appList) {
            const qCount = formFields.filter(f => f.type !== 'note').length;
            return `<p>${qCount ? `이름·연락처와 질문 ${qCount}개를 적어 주세요.` : '이름과 연락처만 적으면 돼요.'} 신청 내용은 모임장에게 바로 전달됩니다.</p>
                <div class="legend"><span class="req">*</span> 표시는 필수 항목이에요</div>
                <div class="cm-f2">
                    <div class="cm-f" id="cm_f_name"><label for="ca_name">이름<span class="req">*</span></label><input type="text" id="ca_name" placeholder="이름" autocomplete="name"></div>
                    <div class="cm-f" id="cm_f_phone"><label for="ca_phone">연락처<span class="req">*</span></label><input type="tel" id="ca_phone" placeholder="010-0000-0000" autocomplete="tel" inputmode="tel" oninput="cmPhoneFmt(this)"></div>
                </div>
                ${cmApplyFieldsHTML(formFields, appList)}
                <button type="button" class="gaa-btn gaa-btn-primary gaa-btn-block" onclick="submitCommunityApplication('${id}')">신청하기</button>
                <div class="cm-hint">신청 내역은 목록 상단 [신청 조회]에서 연락처로 확인·취소할 수 있어요</div>`;
        }
        function cmApplySheetOpen() {
            if (!state.communityApplyFormHTML) return;
            cmApplySheetClose();
            const wrap = document.createElement('div');
            wrap.id = 'cmApplySheet'; wrap.className = 'cm-sheet-wrap'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', '참여 신청');
            wrap.innerHTML = `<div class="cm-sheet-bg" onclick="cmApplySheetClose()"></div>
                <div class="cm-sheet">
                    <div class="cm-sheet-head"><span class="grab" aria-hidden="true"></span><h3>참여 신청</h3><button type="button" class="cm-ib" onclick="cmApplySheetClose()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
                    <div class="cm-sheet-body"><div class="cm-form" id="communityApplyForm">${state.communityApplyFormHTML}</div></div>
                </div>`;
            document.body.appendChild(wrap);
            document.body.classList.add('cm-sheet-open');
            requestAnimationFrame(() => wrap.classList.add('on'));
            cmApplyCond(); // 조건부 질문 초기 표시·번호
            wrap._esc = (e) => { if (e.key === 'Escape') cmApplySheetClose(); };
            document.addEventListener('keydown', wrap._esc);
            if (window.matchMedia && matchMedia('(hover:hover)').matches) setTimeout(() => document.getElementById('ca_name')?.focus({ preventScroll: true }), 250); // 터치 기기는 키보드가 바로 올라오지 않게
        }
        function cmApplySheetClose() {
            const wrap = document.getElementById('cmApplySheet'); if (!wrap) return;
            if (wrap._esc) document.removeEventListener('keydown', wrap._esc);
            wrap.remove(); document.body.classList.remove('cm-sheet-open');
        }
        window.addEventListener('popstate', () => { if (typeof cmApplySheetClose === 'function') cmApplySheetClose(); if (typeof closeBookingSheet === 'function') closeBookingSheet(); });

        function renderCommunityEditView(meeting, id, appList, formFields) {
            const cnt = appList.length;
            const tab = state.communityEditTab || 'info';
            const tabs = [
                { key: 'info', label: '모임 정보' },
                { key: 'fields', label: '참여자 작성 내용' },
                { key: 'applicants', label: `신청자 관리 (${cnt})` },
            ];
            const tabBar = `<div style="display:flex;gap:0;border-bottom:2px solid var(--wds-gray-200);margin-bottom:20px;overflow-x:auto;">
                ${tabs.map(t => `<button onclick="switchCommunityEditTab('${id}','${t.key}')" style="padding:10px 20px;font-size:0.92rem;font-weight:${tab===t.key?'700':'600'};color:${tab===t.key?'var(--wds-primary)':'var(--wds-gray-700)'};background:none;border:none;border-bottom:${tab===t.key?'2px solid var(--wds-primary)':'2px solid transparent'};margin-bottom:-2px;cursor:pointer;white-space:nowrap;transition:color 0.15s;">${t.label}</button>`).join('')}
            </div>`;
            let html = `<div class="gforms-header">
                <h2>모임 수정</h2>
                <p>모임 정보를 수정하세요. <span style="color:var(--wds-gray-500);">날짜·시간은 변경할 수 없습니다.</span></p>
            </div>${tabBar}`;

            if (tab === 'info') {
                html += `<div class="gforms-card">
                <label class="gforms-label">모임명<span class="req">*</span></label>
                <input type="text" id="ce_title" class="gforms-input" value="${escapeHtml(meeting.title)}">
            </div>
            <div class="community-grid-2">
                <div class="gforms-card" style="opacity:0.6;">
                    <label class="gforms-label">날짜 <span style="font-size:0.78rem;font-weight:400;color:var(--wds-gray-500);">(수정 불가)</span></label>
                    <input type="date" id="ce_date" class="gforms-input" value="${escapeHtml(meeting.meeting_date || '')}" disabled>
                </div>
                <div class="gforms-card" style="opacity:0.6;">
                    <label class="gforms-label">시간 <span style="font-size:0.78rem;font-weight:400;color:var(--wds-gray-500);">(수정 불가)</span></label>
                    <input type="text" id="ce_time" class="gforms-input" value="${escapeHtml(meeting.meeting_time || '')}" disabled>
                </div>
            </div>
            <div class="community-grid-2">
                <div class="gforms-card">
                    <label class="gforms-label">모임장 이름<span class="req">*</span></label>
                    <input type="text" id="ce_org_name" class="gforms-input" value="${escapeHtml(meeting.organizer_name)}">
                </div>
                <div class="gforms-card">
                    <label class="gforms-label">연락처<span class="req">*</span></label>
                    <input type="tel" id="ce_org_phone" class="gforms-input" value="${escapeHtml(meeting.organizer_phone || '')}">
                </div>
            </div>
            <div class="gforms-card">
                <label class="gforms-label">이메일<span class="req">*</span></label>
                <input type="email" id="ce_org_email" class="gforms-input" value="${escapeHtml(meeting.organizer_email)}">
            </div>
            <div class="community-grid-2">
                <div class="gforms-card">
                    <label class="gforms-label">참여비용</label>
                    <input type="text" id="ce_fee" class="gforms-input" value="${escapeHtml(meeting.fee || '')}" placeholder="예: 5,000원">
                </div>
                <div class="gforms-card">
                    <label class="gforms-label">준비물</label>
                    <input type="text" id="ce_items" class="gforms-input" value="${escapeHtml(meeting.items_to_bring || '')}">
                </div>
            </div>
            <div class="gforms-card">
                <label class="gforms-label">모임 설명</label>
                ${docEditorHTML('ce_desc', renderMarkdown(meeting.description || ''), '진행 컨텐츠 및 타임라인 등을 작성해주세요. 링크(🔗)와 사진(🖼)도 넣을 수 있어요.', { image: true })}
            </div>
            <div class="community-grid-2">
                <div class="gforms-card">
                    <label class="gforms-label">정원</label>
                    <input type="number" id="ce_capacity" class="gforms-input" value="${meeting.capacity || ''}" min="1">
                </div>
                <div class="gforms-card">
                    <label class="gforms-label">신청 마감일</label>
                    <input type="date" id="ce_deadline" class="gforms-input" value="${escapeHtml(meeting.application_deadline || '')}">
                </div>
            </div>
            <div class="gforms-card">
                <label class="gforms-label">대표 이미지 교체</label>
                <input type="file" id="ce_image" accept="image/*" style="font-size:0.9rem;padding:6px 0;" onchange="cmCropLoad('ce', this.files[0])">
                <div id="ce_crop" class="cm-crop hidden">
                    <div class="cm-crop-box" id="ce_crop_box"><img id="ce_crop_img" alt="" draggable="false"></div>
                    <div class="cm-crop-ctl"><span>확대</span><input type="range" id="ce_crop_zoom" min="100" max="300" value="100" oninput="cmCropZoom('ce', this.value)"><button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="cmCropReset('ce')">처음으로</button></div>
                    <p>목록과 상세에 정방형으로 보여요. 사진을 끌어 보일 부분을 맞추고, 슬라이더로 확대하세요.</p>
                </div>
            </div>
            <button class="gforms-submit" style="width:100%;margin-top:4px;" onclick="saveCommunityMeetingEdit('${id}')">수정 저장</button>`;
            }

            if (tab === 'fields') {
                html += `<div class="gforms-card">
                <div style="background:var(--wds-gray-100);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-size:0.85rem;color:var(--wds-gray-600);">
                    <div style="font-weight:700;margin-bottom:6px;color:var(--wds-gray-700);">기본 필수 항목 (자동 포함)</div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <span>• 이름 <span style="color:#e74c3c;font-weight:700;">*</span></span>
                        <span>• 연락처 <span style="color:#e74c3c;font-weight:700;">*</span></span>
                    </div>
                </div>
                <div id="communityFieldEditor"></div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="addCommunityFormField()">+ 항목 추가</button>
                    <button id="communityFieldSaveBtn" class="gaa-btn gaa-btn-sm gaa-btn-primary" style="display:none;" onclick="saveCommunityFormFields('${id}')">항목 저장</button>
                </div>
            </div>`;
            }

            if (tab === 'applicants') {
                html += `<div class="gforms-card" style="margin-bottom:12px;background:var(--wds-gray-50,#fafafa);">
                <p style="margin:0;font-size:0.85rem;color:var(--wds-gray-600);line-height:1.65;">
                    신청자 목록은 아래에서 확인하거나 <b>CSV 다운로드</b> 버튼으로 엑셀/스프레드시트에서 열 수 있는 파일로 저장할 수 있습니다.<br>
                    <span style="color:var(--wds-gray-400);font-size:0.8rem;">CSV 파일에는 이름·연락처·신청일시와 모임에서 설정한 모든 추가 항목이 포함됩니다.</span>
                </p>
            </div>
            ${cmAggregationHTML(formFields, appList)}
            <div class="gforms-card">
                <label class="gforms-label" style="font-size:1.05rem;font-weight:700;">신청자 목록 (${cnt}명)</label>
                <div>`;
                if (appList.length === 0) {
                    html += `<div style="padding:18px 10px;color:var(--wds-gray-500);font-size:0.88rem;text-align:center;">아직 신청자가 없습니다.</div>`;
                } else {
                    appList.forEach(a => {
                        const st = a.status || 'pending';
                        const chip = _CA_STATUS_CHIP(st);
                        const btn = (label, onclick, color) =>
                            `<button class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="color:${color};border-color:${color};flex-shrink:0" onclick="${onclick}">${label}</button>`;
                        html += `<div style="display:flex;align-items:center;gap:8px;padding:10px 4px;border-bottom:1px solid var(--wds-gray-200);font-size:0.88rem;flex-wrap:wrap;">
                        <span style="background:${chip[1]};color:${chip[2]};font-size:0.72rem;font-weight:700;padding:3px 9px;border-radius:10px;flex:none;">${chip[0]}</span>
                        <div style="flex:1;min-width:140px;">
                            <span style="font-weight:600;">${escapeHtml(a.applicant_name)}</span>
                            ${a.applicant_phone ? `<span style="color:var(--wds-gray-500);margin-left:8px;">${escapeHtml(a.applicant_phone)}</span>` : ''}
                            ${a.applicant_email ? `<span style="color:var(--wds-gray-500);margin-left:8px;">${escapeHtml(a.applicant_email)}</span>` : ''}
                            <span style="color:var(--wds-gray-400);margin-left:8px;font-size:0.78rem;">${new Date(a.created_at).toLocaleDateString('ko-KR')}</span>
                        </div>
                        <span style="display:flex;gap:5px;flex-shrink:0;margin-left:auto;">
                            ${st !== 'accepted' ? btn('수락', `setCommunityApplicationStatus('${id}','${a.id}','accepted')`, '#166534') : ''}
                            ${st !== 'rejected' ? btn('거절', `setCommunityApplicationStatus('${id}','${a.id}','rejected')`, '#B45309') : ''}
                            ${btn('삭제', `deleteCommunityApplication('${id}','${a.id}')`, '#e74c3c')}
                        </span>
                    </div>`;
                    });
                }
                html += `</div></div>
            <div class="gforms-card">
                <label class="gforms-label" style="font-size:1.05rem;font-weight:700;">관리</label>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="white-space:nowrap;padding-left:6px;padding-right:6px;" onclick="toggleCommunityMeetingClosed('${id}', ${meeting.is_closed})">${meeting.is_closed ? '모집 재개' : '수동 마감'}</button>
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="white-space:nowrap;padding-left:6px;padding-right:6px;" onclick="downloadCommunityApplicantsCsv('${id}')">CSV 다운로드</button>
                    <button class="gaa-btn gaa-btn-sm gaa-btn-danger" style="white-space:nowrap;padding-left:6px;padding-right:6px;" onclick="deleteCommunityMeeting('${id}')">모임 삭제</button>
                </div>
            </div>`;
            }

            return html;
        }

        function switchCommunityEditTab(id, tab) {
            state.communityEditTab = tab;
            const el = document.getElementById('communityContent');
            if (!el) return;
            const meeting = state.communityMeetings.find(m => m.id === id) || state.communityCurrentMeeting;
            const appList = state.communityCurrentAppList || [];
            const formFields = state.communityCurrentFormFields || [];
            const topbar = el.querySelector('.cm-top')?.outerHTML || ''; // 상세 개편(2026-10-13)으로 상단 줄 클래스가 .cm-top 으로 바뀜 — 탭 전환 때 [‹ 상세보기] 유지
            el.innerHTML = topbar + renderCommunityEditView(meeting, id, appList, formFields);
            if (tab === 'fields') {
                state.communityEditFields = JSON.parse(JSON.stringify(formFields));
                renderCommunityFieldEditor();
            }
            window.scrollTo({ top: 0, behavior: 'instant' });
        }

        function communityExitEdit(id) {
            state.communityEditView = null;
            state.communityEditTab = 'info';
            renderCommunityDetail(id);
        }

        function communityShowAuthModal(id) {
            if (state.communityEditAuth[id]) {
                state.communityEditView = id;
                state.communityEditTab = 'info';
                renderCommunityDetail(id);
                return;
            }
            document.getElementById('commAuthModal')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'commAuthModal';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = `<div style="background:var(--wds-white);border-radius:var(--wds-radius-l);padding:28px 24px;max-width:360px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.25);">
                <h3 style="margin:0 0 6px;font-size:1rem;font-weight:700;color:var(--wds-black);">모임장 인증</h3>
                <p style="font-size:0.85rem;color:var(--wds-gray-500);margin:0 0 16px;">모임 수정을 위해 비밀번호를 입력해주세요.</p>
                <input type="password" id="commAuthModalPw" placeholder="비밀번호" style="width:100%;height:40px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:var(--wds-radius-s);font-size:0.9rem;box-sizing:border-box;font-family:inherit;margin-bottom:12px;" onkeydown="if(event.key==='Enter')communityOrganizerAuthModal('${id}')">
                <div style="display:flex;gap:8px;">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" onclick="document.getElementById('commAuthModal').remove()">취소</button>
                    <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex:1" onclick="communityOrganizerAuthModal('${id}')">확인</button>
                </div>
            </div>`;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
            setTimeout(() => document.getElementById('commAuthModalPw')?.focus(), 50);
        }

        async function verifyCommunityAdminPw(pw) {
            try {
                const { data, error } = await supabaseClient.functions.invoke('verify-community-admin', { body: { password: pw } });
                if (error) return false;
                return !!(data && data.ok);
            } catch (_) { return false; }
        }

        // 모임별 주최자 비밀번호를 서버(verify-meeting-password)에서 검증.
        // 함수 미배포/오류 시 null 반환 → 호출부에서 기존 클라 해시 비교로 폴백(하위호환).
        async function verifyMeetingPassword(meetingId, pw) {
            try {
                const { data, error } = await supabaseClient.functions.invoke('verify-meeting-password', { body: { meetingId, password: pw } });
                if (error) return null;
                return !!(data && data.ok);
            } catch (_) { return null; }
        }

        // 주최자 인증 공통: 서버 모임별 검증 → 실패 시 클라 해시 폴백 → 마스터 비밀번호
        async function checkCommunityOrganizer(meeting, pw) {
            // 모임별 비번은 서버(verify-meeting-password)에서만 검증 → 해시를 클라로 내려받지 않음.
            // 실패 시 마스터 비번(verify-community-admin)으로 재시도.
            let ok = (await verifyMeetingPassword(meeting.id, pw)) === true;
            if (!ok) ok = await verifyCommunityAdminPw(pw);
            if (ok) {
                state.communityEditPw[meeting.id] = pw; // 이후 수정/삭제 서버 검증에 사용
                const t = await _cmApi('app_auth', { meeting_id: meeting.id, pw }); // 신청자 명단용 모임장 토큰(2시간)
                if (!t.down && t.ok && t.token) state.communityOrgTok[meeting.id] = t.token;
                else if (!t.down) showToast('신청자 명단 권한을 확인하지 못했습니다. 명단이 비어 보이면 다시 인증해주세요.', 5000);
            }
            return ok;
        }

        // 커뮤니티 모임 수정/삭제는 서버 RPC(비밀번호 재검증)를 통해서만 실제 반영되게 한다.
        // - RPC 가 아직 없으면(미배포) 기존 직접 쿼리로 폴백(하위호환).
        // - RPC 가 비번 불일치(FORBIDDEN)를 반환하면 폴백하지 않고 실패 처리(콘솔 우회 차단).
        function _communityForbidden(err) {
            return (((err && (err.message || '')) + '').toUpperCase()).includes('FORBIDDEN');
        }
        async function communityUpdate(id, patch) {
            const pw = state.communityEditPw[id];
            if (pw) {
                const { error } = await supabaseClient.rpc('community_update_meeting', { p_id: id, p_pw: pw, p_patch: patch });
                if (!error) return { error: null };
                if (_communityForbidden(error)) return { error };
            }
            return await supabaseClient.from('community_meetings').update(patch).eq('id', id);
        }
        async function communityDelete(id) {
            const pw = state.communityEditPw[id];
            if (pw) {
                const { error } = await supabaseClient.rpc('community_delete_meeting', { p_id: id, p_pw: pw });
                if (!error) return { error: null };
                if (_communityForbidden(error)) return { error };
            }
            return await supabaseClient.from('community_meetings').delete().eq('id', id);
        }

        async function communityOrganizerAuthModal(id) {
            const pw = document.getElementById('commAuthModalPw')?.value || '';
            if (!pw) return showToast('비밀번호를 입력해주세요.');
            const meeting = state.communityMeetings.find(m => m.id === id);
            if (!meeting) return showToast('모임 정보를 찾을 수 없습니다.');
            const ok = await checkCommunityOrganizer(meeting, pw);
            if (!ok) return showToast('비밀번호가 틀렸습니다.');
            state.communityEditAuth[id] = true;
            state.communityEditView = id;
            state.communityEditTab = 'info';
            document.getElementById('commAuthModal')?.remove();
            renderCommunityDetail(id);
        }

        function renderCommunityFieldEditor() {
            const el = document.getElementById('communityFieldEditor');
            if (!el) return;
            const saveBtn = document.getElementById('communityFieldSaveBtn');
            if (saveBtn) saveBtn.style.display = ''; // 질문을 전부 지우는 것도 저장할 수 있어야 한다
            el.innerHTML = cmQEditorHTML('ce');
        }
        function addCommunityFormField() { cmQAdd('ce'); }
        function removeCommunityFormField(i) { cmQRemove('ce', i); }

        async function saveCommunityFormFields(id) {
            const fields = cmCleanFields(state.communityEditFields);
            const problem = cmFieldsProblem(fields); if (problem) return showToast(problem);
            const { error } = await communityUpdate(id, { form_fields: fields });
            if (error) return showToast('저장 실패: ' + error.message);
            await fetchCommunityMeetings();
            showToast('질문이 저장되었습니다.');
            renderCommunityDetail(id);
        }

        async function communityOrganizerAuth(id) {
            const pw = document.getElementById('comm_auth_pw').value;
            if (!pw) return showToast('비밀번호를 입력해주세요.');
            const meeting = state.communityMeetings.find(m => m.id === id);
            if (!meeting) return showToast('모임 정보를 찾을 수 없습니다.');
            const ok = await checkCommunityOrganizer(meeting, pw);
            if (!ok) return showToast('비밀번호가 틀렸습니다.');
            state.communityEditAuth[id] = true;
            renderCommunityDetail(id);
        }

        async function saveCommunityMeetingEdit(id) {
            const title = document.getElementById('ce_title').value.trim();
            const location = document.getElementById('ce_location')?.value.trim() || '';
            const meeting0 = state.communityMeetings.find(m => m.id === id);
            const date = meeting0?.meeting_date || null;
            const time = meeting0?.meeting_time || null;
            const orgName = document.getElementById('ce_org_name').value.trim();
            const orgPhone = document.getElementById('ce_org_phone').value.trim();
            const orgEmail = document.getElementById('ce_org_email').value.trim();
            const fee = document.getElementById('ce_fee').value.trim();
            const items = document.getElementById('ce_items').value.trim();
            const capacity = document.getElementById('ce_capacity').value;
            const deadline = document.getElementById('ce_deadline').value;
            const desc = rteValue('ce_desc');
            const imgFile = document.getElementById('ce_image').files[0];

            if (!title) return showToast('모임명을 입력해주세요.');
            if (document.getElementById('ce_capacity')?.value && parseInt(document.getElementById('ce_capacity').value) < 1) return showToast('정원은 1명 이상이어야 합니다.');
            if (deadline && date && deadline > date) return showToast('신청 마감일은 모임 날짜보다 늦을 수 없습니다.');

            const meeting = state.communityMeetings.find(m => m.id === id);
            let coverImageUrl = meeting.cover_image_url;
            if (imgFile) {
                try { coverImageUrl = await uploadCommunityImage(await cmCropExport('ce', imgFile)); cmCropClear('ce'); } // 정방형으로 잘라 올린다
                catch (e) { showToast('이미지 업로드 실패: ' + e.message); }
            }

            const payload = {
                title, cover_image_url: coverImageUrl,
                meeting_date: date || null,
                meeting_time: time || null,
                location: location || null,
                organizer_name: orgName, organizer_phone: orgPhone || null, organizer_email: orgEmail,
                fee: fee || null, items_to_bring: items || null,
                capacity: capacity ? parseInt(capacity) : null,
                application_deadline: deadline || null,
                description: desc || null,
            };

            const { error } = await communityUpdate(id, payload);
            if (error) return showToast('수정 실패: ' + error.message);
            await fetchCommunityMeetings();
            delete state.communityEditAuth[id];
            showToast('수정되었습니다.');
            renderCommunityDetail(id);
        }

        async function toggleCommunityMeetingClosed(id, currentlyClosed) {
            const { error } = await communityUpdate(id, { is_closed: !currentlyClosed });
            if (error) return showToast('상태 변경 실패: ' + error.message);
            await fetchCommunityMeetings();
            renderCommunityDetail(id);
        }

        async function deleteCommunityMeeting(id) {
            if (!confirm('모임을 삭제하면 모든 신청 정보도 삭제됩니다. 정말 삭제하시겠습니까?')) return;
            const meeting = state.communityMeetings.find(m => m.id === id);
            const { error } = await communityDelete(id);
            if (error) return showToast('삭제 실패: ' + error.message);
            // Remove associated time_block in GatheO
            if (meeting) {
                try {
                    await supabaseClient.from('time_blocks')
                        .delete()
                        .eq('reason', `[커뮤니티] ${meeting.title}`)
                        .eq('start_date', meeting.meeting_date);
                } catch (e) { /* ignore */ }
            }
            delete state.communityEditAuth[id];
            await fetchCommunityMeetings();
            communityBackToList();
        }

        async function submitCommunityApplication(id) {
            const meeting = state.communityMeetings.find(m => m.id === id) || state.communityCurrentMeeting;
            if (!meeting) return showToast('모임 정보를 찾을 수 없습니다.');

            const name = (document.getElementById('ca_name') || {}).value?.trim() || '';
            const email = '';
            const phone = (document.getElementById('ca_phone') || {}).value?.trim() || '';

            if (!name) return cmFieldError('#cm_f_name', '이름을 입력해주세요.');
            if (!phone) return cmFieldError('#cm_f_phone', '연락처를 입력해주세요.');
            if (phone.replace(/\D/g, '').length < 9) return cmFieldError('#cm_f_phone', '연락처를 끝까지 입력해주세요.');

            const formFields = Array.isArray(meeting.form_fields) ? meeting.form_fields : [];
            const formData = {};
            for (let i = 0; i < formFields.length; i++) {
                const f = formFields[i];
                if (f.type === 'note') continue; // 안내문은 답이 없다
                if (!cmCondVisible(f, formFields, i)) continue; // 조건으로 숨겨진 질문은 저장하지 않음
                const val = cmFieldValue(f, i);
                const empty = Array.isArray(val) ? val.length === 0 : !val;
                if (f.required && empty) return cmFieldError(`#communityApplyForm .cm-f[data-qi="${i}"]`, f.type === 'consent' ? '동의해야 신청할 수 있어요.' : f.type === 'multi' ? '하나 이상 골라주세요.' : f.type === 'select' ? '골라주세요.' : '적어주세요.');
                formData[f.label] = val;
            }

            // 중복 신청 방지 — 같은 연락처(숫자 기준)로 이 모임에 이미 신청했으면 차단.
            // ※ DB의 (meeting_id, applicant_email) unique는 이메일 칸 제거 후 모든 신청이
            //   ''로 저장되며 서로 충돌하는 오작동을 일으켰다 — 이메일은 null로 저장해 회피.
            const phoneDigits = phone.replace(/\D/g, '');
            const pre = await _cmApi('app_public', { meeting_id: id }); // 서버 경유: 정원 계산용 요약(이름·연락처 없음)
            let dupCheck, dupErr;
            if (pre.down) {
                ({ data: dupCheck, error: dupErr } = await supabaseClient.from('community_applications')
                    .select('applicant_phone,status,form_data').eq('meeting_id', id));
                if (dupErr) ({ data: dupCheck } = await supabaseClient.from('community_applications').select('applicant_phone').eq('meeting_id', id)); // status 컬럼 이전 폴백
                if ((dupCheck || []).some(a => String(a.applicant_phone || '').replace(/\D/g, '') === phoneDigits)) {
                    return alert('이미 신청하셨습니다.\n신청 내역은 목록의 [신청 조회]에서 확인·취소할 수 있습니다.');
                }
            } else {
                if (!pre.ok) return showToast(pre.message || '신청 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', 5000);
                dupCheck = pre.rows || [];
            }
            // 선택지 정원 — 제출 직전에 다시 센다(그 사이 마감됐으면 되돌림)
            const optCounts = cmOptionCounts(formFields, dupCheck || []);
            for (const f of formFields) {
                if (!cmQHasOptions(f) || !f.limits) continue;
                const v = formData[f.label], chosen = Array.isArray(v) ? v : (v ? [v] : []);
                const full = chosen.find(o => cmOptFull(f, optCounts, o));
                if (full) { showToast(`"${f.label}"의 "${full}" 선택지가 방금 마감되었어요. 다른 선택지를 골라주세요.`); return renderCommunityDetail(id); }
            }

            let newApp, error;
            if (pre.down) {
                ({ data: newApp, error } = await supabaseClient.from('community_applications').insert({
                    meeting_id: id,
                    applicant_name: name,
                    applicant_email: email || null,
                    applicant_phone: phone || null,
                    form_data: formData
                }).select('id').single());
            } else {
                // 중복(같은 연락처) 확인과 저장은 서버가 한다
                const res = await _cmApi('app_apply', { meeting_id: id, name, phone, email: email || null, form_data: formData });
                if (res.error === 'dup') return alert('이미 신청하셨습니다.\n신청 내역은 목록의 [신청 조회]에서 확인·취소할 수 있습니다.');
                if (!res.ok) error = { message: res.message || '서버 오류' };
                else newApp = { id: res.id };
            }

            if (error) {
                if (error.code === '23505') return showToast('이미 신청하셨습니다.');
                return showToast('신청 실패: ' + error.message);
            }

            // 모임장 알림 메일 — /send-email(Resend), 실패·미설정 시 mailto 폴백
            let emailSent = false;
            const mailSubject = `[${meeting.title}] 신규 신청: ${name}`;
            const dateStr = meeting.meeting_date ? meeting.meeting_date.replace(/-/g, '.') : '';
            const timeStr = meeting.meeting_time || '';
            const locStr = meeting.location || '';

            // Plain text (mailto: fallback)
            let mailBodyText = `안녕하세요, ${meeting.organizer_name}님!\n\n[${meeting.title}]에 새로운 신청이 접수되었습니다.\n\n`;
            mailBodyText += `■ 모임 정보\n`;
            if (dateStr) mailBodyText += `- 날짜: ${dateStr}${timeStr ? ' ' + timeStr : ''}\n`;
            if (locStr) mailBodyText += `- 장소: ${locStr}\n`;
            mailBodyText += `\n■ 신청자 정보\n- 이름: ${name}\n- 연락처: ${phone}`;
            Object.entries(formData).forEach(([k, v]) => { const t = cmAnswerText(v); if (t) mailBodyText += `\n- ${k}: ${t}`; });
            mailBodyText += `\n\n※ 신청자 전체 목록은 모임 수정 화면 → [신청자 관리] 탭 → 'CSV 다운로드' 버튼으로 확인하실 수 있습니다.\n\n감사합니다.\n게어드 커뮤니티`;

            if (newApp && newApp.id) {
                emailSent = await sendOrganizerMail(id, newApp.id);
            }
            if (!emailSent) {
                const mailto = `mailto:${encodeURIComponent(meeting.organizer_email)}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBodyText)}`;
                window.open(mailto);
            }

            state.communityApplicationCounts[id] = (state.communityApplicationCounts[id] || 0) + 1;
            showToast('신청이 완료되었습니다! 감사합니다.');
            renderCommunityDetail(id);
        }

        async function deleteCommunityApplication(meetingId, appId) {
            if (!confirm('해당 신청을 삭제하시겠습니까?')) return;
            let error;
            const srv = await _cmOrgApi('app_delete', meetingId, { app_id: appId });
            if (srv.down) ({ error } = await supabaseClient.from('community_applications').delete().eq('id', appId));
            else if (!srv.ok) error = { message: srv.message || '서버 오류' };
            if (error) return showToast('삭제 실패: ' + error.message, 5000);
            state.communityApplicationCounts[meetingId] = Math.max(0, (state.communityApplicationCounts[meetingId] || 1) - 1);
            renderCommunityDetail(meetingId);
        }

        async function downloadCommunityApplicantsCsv(id) {
            const meeting = state.communityMeetings.find(m => m.id === id);
            let apps, error;
            const srv = await _cmOrgApi('app_list', id);
            if (srv.down) {
                ({ data: apps, error } = await supabaseClient
                    .from('community_applications')
                    .select('*')
                    .eq('meeting_id', id)
                    .order('created_at', { ascending: true }));
            } else if (!srv.ok) error = { message: srv.message || '서버 오류' };
            else apps = srv.rows;
            if (error) return showToast('다운로드 실패: ' + error.message, 5000);

            const formFields = (meeting ? (Array.isArray(meeting.form_fields) ? meeting.form_fields : []) : []).filter(f => f.type !== 'note'); // 안내문은 답이 없다
            const headers = ['이름', '이메일', '전화번호', '상태', '신청일시', ...formFields.map(f => f.label)];
            const stLabel = { accepted: '수락', rejected: '거절', pending: '대기' };
            const rows = (apps || []).map(a => {
                const fd = a.form_data || {};
                return [
                    a.applicant_name, a.applicant_email, a.applicant_phone || '',
                    stLabel[a.status || 'pending'] || '대기',
                    new Date(a.created_at).toLocaleString('ko-KR'),
                    ...formFields.map(f => cmAnswerText(fd[f.label]))
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
            });

            const csv = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `신청자_${meeting ? meeting.title : id}.csv`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
        }

        // 음악취향(JSON) → {genre, artists, songs} 개별 필드로
        function musicTasteFields(raw) {
            const mt = parseMusicTaste(raw);
            if (!mt) return { genre: '', artists: '', songs: '' };
            const genre = Array.isArray(mt.genres) && mt.genres.length
                ? mt.genres.join(', ')
                : (mt.genre || '');
            return { genre, artists: mt.artists || '', songs: mt.songs || '' };
        }

        const MAIN_INSTS = ['보컬', '기타', '베이스', '키보드', '드럼'];
        // 세션 문자열 → {main, extra} (메인 세션 / 추가 세션 분리)
        function splitInstruments(raw) {
            const list = (raw || '').split(',').map(s => s.trim()).filter(Boolean);
            const main = list.filter(s => MAIN_INSTS.includes(s));
            const extra = list.filter(s => !MAIN_INSTS.includes(s));
            return { main: main.join(', '), extra: extra.join(', ') };
        }

        // GatheO 멤버 목록 CSV 다운로드 (개인정보 포함 — 관리자 전용)
        // 공개 멤버&팀 목록과 동일하게 주 세션(첫 번째 악기) 기준으로 그룹화
        window.downloadMembersCsv = async function() {
            if (!canApproveRes()) { showToast('권한이 없습니다.'); return; }
            const all = await fetchMembers();
            const members = (all || []).filter(m => m.status !== 'rejected'); // 거절 멤버 제외
            const statusLabel = { approved: '승인', pending: '대기', blocked: '차단' };

            // 주 세션(첫 번째 악기)으로 그룹화 — 공개 목록과 동일 순서
            const groups = {};
            members.forEach(m => {
                const insts = (m.instruments || '').split(',').map(s => s.trim()).filter(Boolean);
                const primary = insts[0] || '미지정';
                (groups[primary] = groups[primary] || []).push(m);
            });
            const groupKeys = Object.keys(groups).sort((a, b) => {
                const ai = MAIN_INSTS.indexOf(a), bi = MAIN_INSTS.indexOf(b);
                if (ai === -1 && bi === -1) return a.localeCompare(b, 'ko');
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
            });

            const headers = ['세션그룹', '이름', '이메일', '연락처', '메인세션', '추가세션', '장르', '가수', '곡', '역할', '상태', '가입일'];
            const esc = v => `"${String(v).replace(/"/g, '""')}"`;
            const blank = headers.slice(1).map(() => '');
            const lines = [headers.map(esc).join(',')];
            groupKeys.forEach(gKey => {
                const list = groups[gKey].slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
                lines.push([`▶ ${gKey} (${list.length}명)`, ...blank].map(esc).join(',')); // 그룹 구분 행
                list.forEach(m => {
                    const inst = splitInstruments(m.instruments);
                    const mt = musicTasteFields(m.music_taste);
                    lines.push([
                        gKey,
                        m.name || '',
                        m.email || '',
                        m.phone || '',
                        inst.main,
                        inst.extra,
                        mt.genre,
                        mt.artists,
                        mt.songs,
                        m.role || '일반',
                        statusLabel[m.status] || m.status || '',
                        m.created_at ? new Date(m.created_at).toLocaleString('ko-KR') : ''
                    ].map(esc).join(','));
                });
            });

            const csv = lines.join('\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const today = new Date().toLocaleDateString('en-CA');
            a.href = url; a.download = `GatheO_멤버목록_${today}.csv`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
            showToast(`멤버 ${members.length}명 목록을 다운로드했습니다.`);
        };

        // ── 모임 공유: 경로형 /meet/<id> 를 공유한다(2026-10-27). 인스타 프로필 링크·카톡 인앱은 #해시를 버려 포털에서 멈췄고
        // 크롤러도 해시 뒤를 못 보므로, 서버 함수(functions/meet/[id].js)가 이 경로에서 대표 이미지·제목·일시를 OG 로 넣고 사람은 상세로 라우팅한다.
        async function shareCommunityMeeting(id) {
            const url = `${location.origin}/meet/${id}`;
            if (navigator.share) {
                try { await navigator.share({ url }); return; }
                catch (e) { if (e && e.name === 'AbortError') return; /* 미지원·실패 → 복사 폴백 */ }
            }
            try {
                await navigator.clipboard.writeText(url);
                showToast('모임 링크가 복사되었습니다.');
            } catch (_) {
                prompt('아래 링크를 복사하세요', url);
            }
        }

        // ── 신청 조회: 이름+연락처로 내 신청 내역 확인·취소 (비로그인)
        const _CA_STATUS_CHIP = (status) => {
            const s = status || 'pending';
            return s === 'accepted' ? ['✅ 수락됨', '#DCFCE7', '#166534']
                : s === 'rejected' ? ['❌ 거절됨', '#FEE2E2', '#991B1B']
                : ['⏳ 확인 대기', '#FEF3C7', '#92400E'];
        };

        function renderCommunityMyApps() {
            state.communityView = 'myapps';
            const el = document.getElementById('communityContent');
            if (!el) return;
            communityBarVisible(false);
            el.innerHTML = `
                <div class="cm-top">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="communityBackToList()">‹ 목록으로</button>
                </div>
                <div class="gforms-header">
                    <h2>신청 조회</h2>
                    <p>신청할 때 입력한 <b>이름</b>과 <b>연락처</b>를 입력하면 신청 내역을 확인하고 취소할 수 있습니다.</p>
                </div>
                <div class="gforms-card">
                    <label class="gforms-label">이름<span class="req">*</span></label>
                    <input type="text" id="myAppName" class="gforms-input" placeholder="신청 시 입력한 이름">
                </div>
                <div class="gforms-card">
                    <label class="gforms-label">연락처<span class="req">*</span></label>
                    <input type="tel" id="myAppPhone" class="gforms-input" placeholder="010-0000-0000">
                </div>
                <div id="myAppResult" style="font-size:0.88rem;text-align:center;min-height:22px;padding:2px 0"></div>
                <button class="gforms-submit" style="width:100%;" onclick="lookupCommunityMyApps()">조회하기</button>
                <div id="myAppList" style="margin-top:18px;"></div>`;
            window.scrollTo({ top: 0, behavior: 'instant' });
        }

        async function lookupCommunityMyApps() {
            const res = document.getElementById('myAppResult');
            const listEl = document.getElementById('myAppList');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (listEl) listEl.innerHTML = '';
            const name = (document.getElementById('myAppName')?.value || '').trim();
            const phoneDigits = (document.getElementById('myAppPhone')?.value || '').replace(/\D/g, '');
            if (!name) { showErr('이름을 입력해주세요.'); return; }
            if (phoneDigits.length < 10) { showErr('연락처를 정확히 입력해주세요.'); return; }
            // 서버가 이름+연락처가 모두 맞는 신청만 돌려준다(같은 이름의 다른 사람 연락처가 브라우저로 내려오지 않게)
            let mine;
            const srv = await _cmApi('app_mine', { name, phone: phoneDigits });
            if (srv.down) {
                const { data, error } = await supabaseClient.from('community_applications')
                    .select('*').eq('applicant_name', name).order('created_at', { ascending: false });
                if (error) { showErr('조회 중 오류가 발생했습니다: ' + error.message); return; }
                mine = (data || []).filter(a => String(a.applicant_phone || '').replace(/\D/g, '') === phoneDigits);
            } else {
                if (!srv.ok) { showErr(srv.message || '조회 중 오류가 발생했습니다.'); return; }
                mine = srv.rows || [];
            }
            if (!mine.length) { showErr('일치하는 신청 내역이 없습니다. 이름과 연락처를 확인해주세요.'); return; }
            if (!state.communityMeetings.length) await fetchCommunityMeetings();
            const today = new Date().toLocaleDateString('en-CA');
            if (listEl) listEl.innerHTML = mine.map(a => {
                const m = state.communityMeetings.find(x => x.id === a.meeting_id);
                const chip = _CA_STATUS_CHIP(a.status);
                const dateStr = m && m.meeting_date ? m.meeting_date.replace(/-/g, '.') : '';
                const isPast = !!(m && m.meeting_date && m.meeting_date < today);
                return `<div class="gforms-card" style="display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span style="background:${chip[1]};color:${chip[2]};font-size:0.76rem;font-weight:700;padding:3px 10px;border-radius:11px;flex:none;">${chip[0]}</span>
                        <span style="font-weight:700;font-size:0.95rem;">${m ? escapeHtml(m.title) : '(삭제된 모임)'}</span>
                        ${isPast ? '<span style="font-size:0.74rem;color:var(--wds-gray-500);">지난 모임</span>' : ''}
                    </div>
                    <div style="font-size:0.84rem;color:var(--wds-gray-600);">
                        ${dateStr ? `📅 ${dateStr}${m.meeting_time ? ' · ' + escapeHtml(m.meeting_time) : ''}` : ''}
                        ${m && m.location ? ` &nbsp;📍 ${escapeHtml(m.location)}` : ''}
                        <span style="color:var(--wds-gray-400);"> · ${new Date(a.created_at).toLocaleDateString('ko-KR')} 신청</span>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        ${m ? `<button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="renderCommunityDetail('${a.meeting_id}')">모임 보기</button>` : ''}
                        ${!isPast ? `<button class="gaa-btn gaa-btn-sm gaa-btn-danger" onclick="cancelMyCommunityApplication('${a.id}','${a.meeting_id}')">신청 취소</button>` : ''}
                    </div>
                </div>`;
            }).join('');
        }

        async function cancelMyCommunityApplication(appId, meetingId) {
            if (!confirm('신청을 취소하시겠습니까?\n취소 후에는 되돌릴 수 없습니다.')) return;
            let data, error;
            const srv = await _cmApi('app_cancel', { app_id: appId, phone: (document.getElementById('myAppPhone')?.value || '').replace(/\D/g, '') });
            if (srv.down) ({ data, error } = await supabaseClient.from('community_applications').delete().eq('id', appId).select('id'));
            else if (!srv.ok) error = { message: srv.message || '서버 오류' };
            else data = srv.cancelled ? [{ id: appId }] : [];
            if (error) { showToast('취소 중 오류가 발생했습니다: ' + error.message, 5000); return; }
            if (!data || !data.length) { showToast('이미 처리된 신청입니다.'); }
            else {
                state.communityApplicationCounts[meetingId] = Math.max(0, (state.communityApplicationCounts[meetingId] || 1) - 1);
                showToast('신청이 취소되었습니다.');
            }
            lookupCommunityMyApps(); // 폼에 남은 입력값으로 재조회
        }

        // ── 신청자 관리: 수락/거절 (모임장 전용 탭에서 호출)
        async function setCommunityApplicationStatus(meetingId, appId, status) {
            const label = status === 'accepted' ? '수락' : '거절';
            if (!confirm(`이 신청을 ${label}하시겠습니까?`)) return;
            let data, error;
            const srv = await _cmOrgApi('app_status', meetingId, { app_id: appId, status });
            if (srv.down) ({ data, error } = await supabaseClient.from('community_applications').update({ status }).eq('id', appId).select('id'));
            else if (!srv.ok) error = { message: srv.message || '서버 오류' };
            else data = srv.changed ? [{ id: appId }] : [];
            if (error) { alert(`${label} 실패: ` + error.message + '\n\nstatus 컬럼이 없다면 20260901 SQL 실행이 필요합니다.'); return; }
            if (!data || !data.length) { showToast('신청을 찾을 수 없습니다. 목록을 새로고침합니다.'); }
            else showToast(`${label} 처리되었습니다.`);
            renderCommunityDetail(meetingId);
        }

        function communityBackToList() {
            _pushNav('community');
            state.communityView = 'list';
            state.communityCurrentId = null;
            state.communityCurrentMeeting = null;
            state.communityCreateOpen = false;
            state.communityEditView = null;
            fetchCommunityMeetings().then(() => renderCommunityList());
        }

        // ─── 커뮤니티 밴드 성향 테스트 ───────────────────────────────────────

        const INST_RESULTS = {
            vocalist:    { name:'보컬', emoji:'🎤', color:'#FF6B6B', desc:'무대의 주인공. 강한 존재감과 표현력으로 타고난 퍼포머! 밴드의 얼굴이자 목소리입니다.',
                songs:[
                    { title:'아메리카노',              artist:'10cm',   vibe:'편한 음역대에 멜로디도 쉬워 보컬 입문에 추천하는 국민곡' },
                    { title:'주저하는 연인들을 위해', artist:'잔나비', vibe:'대중적인 발성과 감정 전달을 동시에 연습할 수 있는 명곡' },
                    { title:'모든 날, 모든 순간',     artist:'폴킴',   vibe:'호흡과 감정선을 익히기 좋은 감성 발라드의 정석' },
                ]},
            guitarist:   { name:'기타', emoji:'🎸', color:'#4ECDC4', desc:'감성과 기술의 예술가. 섬세한 감수성과 독창적 개성으로 곡의 색깔을 만듭니다.',
                songs:[
                    { title:'벚꽃엔딩',                artist:'버스커버스커', vibe:'몇 개의 코드만으로 완성되는 기타 입문 1순위 곡' },
                    { title:'주저하는 연인들을 위해', artist:'잔나비',        vibe:'무난한 코드 진행으로 어쿠스틱 스트로크 연습에 좋음' },
                    { title:'서른 즈음에',             artist:'김광석',        vibe:'어쿠스틱 기타 입문의 클래식, 단순한 코드로 감성 연습' },
                ]},
            bassist:     { name:'베이스', emoji:'<img src="https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/base_icon.png" style="height:1em;vertical-align:middle">', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/base_icon.png', color:'#45B7D1', desc:'없어선 안 될 기둥. 그루브와 안정감으로 밴드 전체를 완성시키는 든든한 존재입니다.',
                songs:[
                    { title:'청춘',                    artist:'산울림',  vibe:'단순한 라인 반복으로 베이스 입문에 추천되는 정석곡' },
                    { title:'말달리자',                artist:'크라잉넛', vibe:'빠른 8비트 펑크 라인으로 리듬감 연습에 최적' },
                    { title:'주저하는 연인들을 위해', artist:'잔나비',   vibe:'기본 워킹 베이스 연습용으로 좋은 대중적 명곡' },
                ]},
            drummer:     { name:'드럼', emoji:'🥁', color:'#F7B731', desc:'밴드의 엔진. 폭발적인 에너지로 공연장을 뒤흔드는 밴드의 심장입니다.',
                songs:[
                    { title:'말달리자',                artist:'크라잉넛',  vibe:'8비트 펑크 비트의 정석, 드럼 입문곡으로 가장 많이 선택됨' },
                    { title:'아니 벌써',               artist:'산울림',    vibe:'단순한 록 비트로 합주 입문에 안성맞춤' },
                    { title:'주저하는 연인들을 위해', artist:'잔나비',    vibe:'무난한 8비트 발라드 드럼 패턴으로 연습 시작하기 좋음' },
                ]},
            keyboardist: { name:'키보드', emoji:'🎹', color:'#A29BFE', desc:'화음의 완성자. 누구와도 잘 어울리며 음악을 완성시키는 다재다능한 만능 플레이어.',
                songs:[
                    { title:'River Flows in You',     artist:'이루마',          vibe:'피아노 입문자들이 가장 먼저 도전하는 대중적인 곡' },
                    { title:'봄날, 벚꽃, 그리고 너', artist:'에피톤프로젝트', vibe:'감성적인 피아노 멜로디로 양손 연주 연습에 좋음' },
                    { title:'사랑하기 때문에',        artist:'유재하',          vibe:'피아노 발라드 입문의 클래식, 코드 반주 연습용' },
                ]},
        };

        const INST_QUESTIONS = [
            { q:'주말 오후, 예상치 못한 자유 시간이 생겼다면?', opts:[
                { label:'친구에게 연락해 밖에 나가서 신나게 논다', key:'vocalist' },
                { label:'가보고 싶었던 새 장소나 활동을 즉흥적으로 도전', key:'drummer' },
                { label:'혼자 카페나 집에서 좋아하는 것에 완전히 몰입', key:'keyboardist' },
                { label:'집에서 느긋하게 쉬며 재충전하는 시간', key:'bassist' },
            ]},
            { q:'카페에서 자리를 고른다면?', opts:[
                { label:'창가 자리 — 밖을 바라보며 감성에 잠기는 곳', key:'guitarist' },
                { label:'바 자리 — 활기차고 바리스타와 가볍게 대화', key:'drummer' },
                { label:'포근한 소파 자리 — 편하고 아늑한 공간', key:'bassist' },
                { label:'조용한 구석 자리 — 집중할 수 있는 나만의 공간', key:'keyboardist' },
            ]},
            { q:'팀 프로젝트에서 나의 포지션은?', opts:[
                { label:'앞에 서서 발표하고 팀을 이끄는 리더', key:'vocalist' },
                { label:'새 아이디어를 내고 기획을 주도하는 역할', key:'guitarist' },
                { label:'아이디어보다 누구보다 빠르게 실행에 옮기는 역할', key:'drummer' },
                { label:'모두의 의견을 조율하고 팀을 지원하는 역할', key:'bassist' },
            ]},
            { q:'나의 성격을 가장 잘 표현하는 단어는?', opts:[
                { label:'카리스마 — 강한 존재감, 자연스러운 주목', key:'vocalist' },
                { label:'감성 — 섬세하고 독특한 감수성 보유', key:'guitarist' },
                { label:'조화 — 어디서나 잘 녹아들고 분위기를 맞춤', key:'keyboardist' },
                { label:'의리 — 묵묵히 곁을 지키는 든든함', key:'bassist' },
            ]},
            { q:'친구들이 나에게 자주 하는 말은?', opts:[
                { label:'"넌 누구와도 잘 지내, 어떻게 하는 거야?"', key:'keyboardist' },
                { label:'"예술가 감성이야, 감수성이 달라"', key:'guitarist' },
                { label:'"너 진짜 눈에 띄어, 어딜 가도 주목받아"', key:'vocalist' },
                { label:'"너 없으면 우리 팀 진짜 힘들어"', key:'bassist' },
            ]},
            { q:'처음 만나는 사람과 어떻게 친해지나요?', opts:[
                { label:'먼저 말 걸고 자연스럽게 대화를 주도한다', key:'vocalist' },
                { label:'재미있는 상황을 만들며 유쾌하게 분위기를 깬다', key:'drummer' },
                { label:'상대가 편하도록 배려하며 조용히 맞춰간다', key:'bassist' },
                { label:'분위기 파악하며 차분히 공통점을 찾아간다', key:'keyboardist' },
            ]},
            { q:'오래 지속하고 있는 나의 취미나 관심사는?', opts:[
                { label:'독서·전시회·영화 감상 등 감성 활동', key:'keyboardist' },
                { label:'SNS나 유튜브로 나만의 콘텐츠 만들기', key:'vocalist' },
                { label:'운동·클라이밍 등 격렬한 신체 활동', key:'drummer' },
                { label:'그림·사진·글쓰기 등 혼자 하는 창작 활동', key:'guitarist' },
            ]},
            { q:'친구 모임에서 나의 역할은?', opts:[
                { label:'처음엔 조용하지만 알고 보면 독특하고 재미있는 사람', key:'guitarist' },
                { label:'분위기가 가라앉으면 제일 먼저 살리는 에너자이저', key:'drummer' },
                { label:'자연스럽게 모임의 중심이 되는 사람', key:'vocalist' },
                { label:'없으면 뭔가 허전한, 없어선 안 될 든든한 존재', key:'bassist' },
            ]},
        ];

        const BAND_RESULTS = {
            jannabi:       { name:'잔나비', emoji:'🌙', color:'#8B6914', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/jannabi.jpeg', v:[2,3,4,4,4],
                desc:'레트로 감성과 깊은 가사로 세대를 아우르는 밴드. 팬과의 진한 소통과 열정적인 무대가 특징.',
                sns:{ instagram:'https://www.instagram.com/bandjannabi/' },
                songs:[
                    { title:'주저하는 연인들을 위해', vibe:'말 못 한 사랑의 서툰 온기, 레트로 감성으로 빚어낸 고백' },
                    { title:'화창한 날에',             vibe:'햇살처럼 가볍고 자유롭게, 아무 걱정 없이 떠나고 싶은 날' },
                    { title:'사랑하긴 했었나요',       vibe:'지난 사랑에 대한 솔직하고 담담한 물음' },
                ]},
            hyukoh:        { name:'혁오', emoji:'🌊', color:'#2C3E50', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/hyuckoh.jpg', v:[1,5,4,1,4],
                desc:'쿨한 쇼게이즈 사운드와 독창적 세계관. 트렌드보다 자기 색깔을 추구하는 아티스트.',
                sns:{ instagram:'https://www.instagram.com/hyukohofficial/' },
                songs:[
                    { title:'위잉위잉',  vibe:'뇌를 가득 채우는 몽환적인 집착의 소용돌이' },
                    { title:'Gondry',    vibe:'쿨하게 포장한 그리움, 무심한 듯 감성적인' },
                    { title:'와리가리', vibe:'방황하는 청춘의 에너지를 날 것 그대로 담은 곡' },
                ]},
            silicagel:     { name:'실리카겔', emoji:'🔮', color:'#6C3483', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/silicagel.jpeg', v:[4,5,1,2,3],
                desc:'사이키델릭과 노이즈팝의 경계를 허무는 실험정신. 강렬한 라이브로 음악 마니아를 사로잡는다.',
                sns:{ instagram:'https://www.instagram.com/silicagel.official/' },
                songs:[
                    { title:'NO PAIN',      vibe:'극한의 노이즈 속에서 터져 나오는 강렬한 카타르시스' },
                    { title:'Desert Eagle', vibe:'폭발하는 사이키델릭 사운드, 음악 마니아를 사로잡은 명곡' },
                    { title:'Tik Tak Tok',  vibe:'기묘하게 중독적인 리듬, 실험성과 대중성의 완벽한 균형' },
                ]},
            sesoneeon:     { name:'새소년', emoji:'🌆', color:'#2E4057', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/Sesoneeon.jpg', v:[4,4,3,3,2],
                desc:'도시의 불안과 자유를 청량한 인디록으로 담아낸다. 기존 틀을 거부하는 독립적 감성.',
                sns:{ instagram:'https://www.instagram.com/se_so_neon/' },
                songs:[
                    { title:'난춘',  vibe:'계절을 타지 않는 자유로운 감성, 그냥 이대로도 충분해' },
                    { title:'파도',  vibe:'도시 속 청춘의 불안과 해방이 교차하는 청량감' },
                    { title:'병',    vibe:'말 못 하고 쌓이는 감정의 무게를 담담하게 풀어낸 곡' },
                ]},
            tencm:         { name:'10cm', emoji:'☕', color:'#795548', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/tencm.jpeg', v:[2,3,2,4,3],
                desc:'일상의 솔직한 관찰과 위트 있는 가사. 친근한 어쿠스틱 사운드로 팬과 가까이 호흡하는 뮤지션.',
                sns:{ instagram:'https://www.instagram.com/10cm_official/' },
                songs:[
                    { title:'아메리카노',  vibe:'일상의 소소한 불평과 위트, 공감 100%의 생활 밀착형 팝' },
                    { title:'봄이 좋냐',   vibe:'봄과 사랑을 유쾌하게 등치시킨 발랄한 감성' },
                    { title:'Lazy Love',   vibe:'게으른 듯 자연스럽게 익어가는 사랑의 온도' },
                ]},
            leenalchi:     { name:'이날치', emoji:'🥁', color:'#C0392B', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/leenalchi.jpeg', v:[5,4,1,4,2],
                desc:'판소리를 전자음악과 펑크로 재창조. 한국 전통의 리듬을 현대적으로 폭발시키는 퓨전 밴드.',
                sns:{ instagram:'https://www.instagram.com/leenalchi/' },
                songs:[
                    { title:'범 내려온다', vibe:'판소리 리듬을 현대 펑크로 폭발시킨, 듣는 순간 몸이 움직이는 곡' },
                    { title:'수궁가 메들리', vibe:'전통의 해학과 현대의 에너지가 충돌하는 쾌감' },
                    { title:'어류도감',     vibe:'바다 생물을 의인화한 익살, 독특한 세계관의 진수' },
                ]},
            nell:          { name:'넬', emoji:'🌑', color:'#1A252F', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/nell.jpeg', v:[2,4,5,2,5],
                desc:'25년간 한국 록의 서정을 지킨 전설. 존재적 고뇌를 시처럼 담아내는 깊고 아름다운 음악.',
                sns:{ instagram:'https://www.instagram.com/spacebohemians/' },
                songs:[
                    { title:'기억을 걷는 시간', vibe:'지나간 사람을 떠올리며 걷는 새벽, 서정의 극치' },
                    { title:'Lost',              vibe:'존재의 공허함을 거대한 사운드로 가득 채운 록의 서정' },
                    { title:'멀어지다',          vibe:'멀어질수록 선명해지는 감정, 깊고 조용한 이별의 결' },
                ]},
            broccoli:      { name:'브로콜리너마저', emoji:'🌿', color:'#27AE60', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/broccoli.jpeg', v:[2,1,4,5,3],
                desc:'일상의 소소함을 따뜻하게 담는 포크팝. 남녀 보컬의 조화로 듣는 이에게 위로를 건넨다.',
                sns:{ instagram:'https://www.instagram.com/band_broccoliyoutoo/' },
                songs:[
                    { title:'졸업',          vibe:'끝이 슬프지 않은 이유, 따뜻한 이별과 새 출발의 온기' },
                    { title:'앵콜요청금지', vibe:'끝났지만 끝나지 않은 공연, 또 만날 것 같은 예감' },
                    { title:'보편적인 노래', vibe:'누구나 공감할 평범한 감정을 담담하게 노래한 포크팝' },
                ]},
            blackskirts:   { name:'검정치마', emoji:'🖤', color:'#2C2C2C', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/blackskirts.webp', v:[2,4,3,1,3],
                desc:'신랄하고 세련된 인디록. 독보적인 세계관으로 자신만의 언어를 만드는 솔로 프로젝트.',
                sns:{ instagram:'https://www.instagram.com/holideez/' },
                songs:[
                    { title:'EVERYTHING',     vibe:'전부를 쏟아붓는 사랑의 무게와 아름다움' },
                    { title:'한시 오분',      vibe:'늦은 밤 새벽 한 시의 쓸쓸한 공기, 세련된 인디록의 정수' },
                    { title:'기다린 만큼, 더', vibe:'담담하게 깊어지는 그리움, 검정치마 특유의 결이 묻어나는 곡' },
                ]},
            cryingnut:     { name:'크라잉넛', emoji:'⚡', color:'#E74C3C', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/cryingnut.jpeg', v:[5,1,1,5,2],
                desc:'30년을 달려온 한국 펑크의 살아있는 역사. 폭발적 에너지로 관객과 하나되는 공연의 전설.',
                sns:{ instagram:'https://www.instagram.com/crying.nut/' },
                songs:[
                    { title:'말달리자',    vibe:'30년을 달려온 한국 펑크의 심장, 듣는 순간 뛰고 싶어지는 곡' },
                    { title:'룩셈부르크', vibe:'함께라면 어디든 달려갈 것 같은 청춘의 질주' },
                    { title:'갈매기',     vibe:'바다를 향해 외치는 듯한 펑크의 자유, 1집 시절의 패기' },
                ]},
            galaxyexpress: { name:'갤럭시익스프레스', emoji:'🚀', color:'#E67E22', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/galaxyexpress.jpeg', v:[4,4,1,2,2],
                desc:'홍대 가라지 록의 정수. 땀 튀기는 생생한 에너지와 거침없는 사운드가 라이브의 전부다.',
                sns:{ instagram:'https://www.instagram.com/galaxy_express_official/' },
                songs:[
                    { title:'진짜 너를 원해', vibe:'땀 냄새 나는 홍대 라이브의 에너지를 그대로 담은 가라지 록' },
                    { title:'호롱불',         vibe:'어둠을 밝히는 작은 불빛처럼, 거칠지만 따뜻한 사운드' },
                    { title:'언제까지나',     vibe:'질주를 멈추지 않는 청춘의 의지, 갤럭시익스프레스의 트레이드마크' },
                ]},
            guckkasten:    { name:'국카스텐', emoji:'🔥', color:'#922B21', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/guckkasten.jpeg', v:[4,4,2,1,3],
                desc:'시각 예술과 사이키델릭 록의 결합. 강렬한 보컬 퍼포먼스와 실험적 무대 연출로 압도한다.',
                sns:{ instagram:'https://www.instagram.com/guckkasten_official/' },
                songs:[
                    { title:'거울',     vibe:'자아와 마주하는 강렬한 사이키델릭 록, 거울을 보듯 오싹한' },
                    { title:'매니큐어', vibe:'본 모습을 감추려는 위장의 색채, 국카스텐 특유의 강렬한 이미지' },
                    { title:'감(感)',   vibe:'본능적인 감각의 흐름, 시각적 사운드로 압도하는 라이브의 정수' },
                ]},
            sultandisco:   { name:'술탄오브더디스코', emoji:'🪩', color:'#F39C12', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/sultandisco.jpeg', v:[5,3,1,5,1],
                desc:'디스코·펑크·소울로 온몸을 흔드는 파티 그 자체. 어디서나 흥을 폭발시키는 밴드.',
                sns:{ instagram:'https://www.instagram.com/sultan_of_the_disco/' },
                songs:[
                    { title:'요술왕자',                    vibe:'마법 같은 그루브, 디스코 펑크의 신호탄' },
                    { title:'캐러밴',                      vibe:'사막을 가로지르는 듯한 이국적 비트, 멈출 수 없는 리듬' },
                    { title:'Waiting For Your Calling Back', vibe:'중독적인 디스코 사운드, 자꾸만 듣게 되는 파티 찬가' },
                ]},
            yozoh:         { name:'요조', emoji:'📚', color:'#16A085', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/yozoh.jpeg', v:[2,2,4,3,2],
                desc:'홍대 감성의 뮤즈. 책·카페·산책이 어울리는 따뜻하고 아기자기한 인디팝.',
                sns:{ instagram:'https://www.instagram.com/official_yozoh/' },
                songs:[
                    { title:'My Name Is Yozoh', vibe:'귀엽고 솔직한 자기소개, 홍대 감성의 시그니처' },
                    { title:'꽃',               vibe:'봄볕처럼 부드럽고 따뜻한, 요조 특유의 아기자기한 인디팝' },
                    { title:'Honey Honey Baby', vibe:'달콤하게 속삭이는 듯한 멜로디, 듣기만 해도 마음이 포근해지는 곡' },
                ]},
            soran:         { name:'소란', emoji:'☀️', color:'#D4AC0D', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/soran.jpeg', v:[2,1,3,5,2],
                desc:'대화하듯 일상을 노래하는 인디록. 팬과의 거리가 없는 따뜻한 소통이 트레이드마크.',
                sns:{ instagram:'https://www.instagram.com/band_soran/' },
                songs:[
                    { title:'분홍',                    vibe:'봄볕처럼 따뜻하고 사랑스러운, 설레는 감정의 결' },
                    { title:'그대 있어 준 것만으로도', vibe:'함께해줘서 충분해, 소박하지만 진심 어린 감사의 노래' },
                    { title:'아름다워',                vibe:'일상의 아름다움을 발견하는 소란 특유의 따뜻한 시선' },
                ]},
            sunwoo:        { name:'선우정아', emoji:'🎷', color:'#1ABC9C', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/sunwoo.jpeg', v:[1,4,4,1,5],
                desc:'재즈와 인디팝을 넘나드는 뮤지션. 음악적 깊이와 세련된 감각으로 동료 뮤지션에게도 존경받는다.',
                sns:{ instagram:'https://www.instagram.com/sunwoojunga_official/' },
                songs:[
                    { title:'까만 밤',       vibe:'재즈와 팝의 경계를 유영하는 세련된 밤의 감성' },
                    { title:'삐에로',        vibe:'웃음 뒤의 슬픔, 선우정아 특유의 날카롭고 진한 감성' },
                    { title:'아 이게 아닌데', vibe:'어긋난 감정을 위트 있게 풀어낸 독특한 매력' },
                ]},
            surl:          { name:'SURL', emoji:'🌤️', color:'#5DADE2', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/surl.jpeg', v:[3,4,3,2,2],
                desc:'어쿠스틱 기반의 감성 인디팝. OST로 먼저 알려진 뒤 라이브에서 팬들과 깊은 교감을 나누는 밴드.',
                sns:{ instagram:'https://www.instagram.com/surlofficial/' },
                songs:[
                    { title:'Fall In Fall', vibe:'가을 감성을 담은 어쿠스틱 팝, 드라마 OST로 더 유명해진 명곡' },
                    { title:'Picnic',       vibe:'아무 걱정 없이 나들이 나온 듯 가볍고 청량한 인디팝' },
                    { title:'VIBE',         vibe:'부드럽고 감각적인 리듬, 듣는 것만으로 기분이 좋아지는 곡' },
                ]},
            epitone:       { name:'에피톤프로젝트', emoji:'🎹', color:'#85929E', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/epitone.jpeg', v:[1,1,4,4,4],
                desc:"피아노 선율에 담긴 위로와 희망. '봄날, 벚꽃, 그리고 너'처럼 일상의 감동을 조용히 전달한다.",
                sns:{ instagram:'https://www.instagram.com/epitone.project/' },
                songs:[
                    { title:'봄날, 벚꽃, 그리고 너', vibe:'봄비 같은 피아노 선율, 계절이 바뀌어도 지워지지 않는 기억' },
                    { title:'어른',                   vibe:'성장의 쓸쓸함을 담담하게 담아낸 에피톤의 대표작' },
                    { title:'사랑은 은하수 다방에서', vibe:'레트로 감성에 담긴 순수한 사랑, 따뜻하고 그리운 분위기' },
                ]},
            lucy:          { name:'루시', emoji:'🎻', color:'#6C5CE7', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/lucy.jpeg', v:[4,3,4,4,2],
                desc:'바이올린을 품은 인디 팝록. 클래식과 록의 경계를 허물며 Coldplay도 반한 섬세한 감성.',
                sns:{ instagram:'https://www.instagram.com/band_lucy/' },
                songs:[
                    { title:'조각',    vibe:'바이올린과 밴드 사운드의 완벽한 조화, 섬세하게 빛나는 감성' },
                    { title:'개화',    vibe:'봄꽃처럼 피어나는 감정, 클래식과 팝록의 아름다운 만남' },
                    { title:'Stardust', vibe:'별처럼 흩어진 기억들, 루시 특유의 서정적 세계관' },
                ]},
            monni:         { name:'몽니', emoji:'🌙', color:'#7F8C8D', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/monni.jpeg', v:[3,2,4,4,4],
                desc:'욕심 많다는 이름처럼 좋은 음악에 대한 진지한 탐구. 성숙하고 차분하게 깊어지는 인디록.',
                sns:{ instagram:'https://www.instagram.com/band__monni/' },
                songs:[
                    { title:'그대와 함께',      vibe:'EBS 스페이스 공감을 빛낸 몽니의 진심 담긴 명곡' },
                    { title:'소나기',           vibe:'갑작스럽게 쏟아지는 감정, 보컬 김신의의 실화를 담은 곡' },
                    { title:'행복을 주는 사람', vibe:'소중한 사람에 대한 진지하고 따뜻한 고백' },
                ]},
            hanlolo:       { name:'한로로', emoji:'🌸', color:'#E8A0B4', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/hanroro.jpeg', v:[2,3,5,2,3],
                desc:'담백하고 솔직한 감성으로 일상의 감정을 노래하는 싱어송라이터. 따뜻한 온기가 가득한 인디팝.',
                sns:{ instagram:'https://www.instagram.com/hanr0r0/' },
                songs:[
                    { title:'사랑하게 될 거야', vibe:'멜론·애플뮤직 차트를 휩쓴 한로로의 대표곡, 설레는 감정의 결' },
                    { title:'입춘',             vibe:'덤덤한 듯 깊은 울림, 한국대중음악상 후보에 오른 강한 첫인상' },
                    { title:'0+0',              vibe:'\'자몽살구클럽\' 수록곡, 차트 상위권을 점령한 풋풋한 감성' },
                ]},
            leeseungyoon:  { name:'이승윤', emoji:'🪵', color:'#6D4C41', imgSrc:'https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/leeseungyoon.jpeg', v:[2,4,3,3,5],
                desc:'깊고 진한 이야기를 담은 포크록. 삶의 무게와 진정성을 무대 위에서 온전히 쏟아내는 아티스트.',
                sns:{ instagram:'https://www.instagram.com/bgsmsyl/' },
                songs:[
                    { title:'폭포',           vibe:'한국대중음악상 최우수 모던록 노래, 웅장한 사운드로 압도하는 명곡' },
                    { title:'역성',           vibe:'정규 3집 타이틀곡, 최우수 록 노래를 수상한 이승윤의 정수' },
                    { title:'들려주고 싶었던', vibe:'싱어게인 우승 직후 발표한 신곡, 진심을 꾹꾹 눌러 담은 메시지' },
                ]},
        };

        const RESULT_WHY = {
            vocalist:     '자연스럽게 주목받고 앞에 서는 걸 즐기는 당신. 강한 존재감과 표현력이 보컬리스트 DNA와 정확히 일치해요.',
            guitarist:    '독창적인 감수성으로 자신만의 세계를 만드는 당신. 기타의 섬세함과 개성이 당신의 내면과 딱 맞아요.',
            bassist:      '팀의 든든한 버팀목이자 조력자인 당신. 눈에 띄지 않아도 없으면 안 되는 베이스처럼 묵묵히 빛나요.',
            drummer:      '폭발적인 에너지와 즉흥적인 행동력을 가진 당신. 밴드 전체를 이끄는 드러머의 추진력이 당신 그 자체예요.',
            keyboardist:  '어디서나 자연스럽게 녹아들며 화음을 완성시키는 당신. 다재다능한 키보디스트의 유연함이 강점이에요.',
            jannabi:       '레트로 감성에 빠져드는 당신에게 잔나비는 시간을 되돌려주는 밴드예요. 깊고 진한 가사가 당신의 감성을 정확히 건드릴 거예요.',
            hyukoh:        '트렌드보다 나만의 색깔을 고집하는 당신. 혁오의 독창적인 세계관과 쿨한 감성이 당신의 개성과 공명해요.',
            silicagel:     '기존 틀을 깨고 실험하는 걸 두려워하지 않는 당신. 실리카겔의 경계 없는 사운드가 당신의 탐구 정신을 자극해요.',
            sesoneeon:     '도시 속 자유와 불안을 동시에 느끼는 당신. 새소년의 청량한 인디록이 당신의 복잡한 내면을 시원하게 뚫어줄 거예요.',
            tencm:         '일상에서 소소한 위트와 감성을 발견하는 당신. 10cm의 친근한 가사가 당신의 하루를 노래해요.',
            leenalchi:     '전통과 현대를 동시에 즐기는 독특한 취향의 당신. 이날치의 파격적인 퓨전이 당신의 열린 귀를 사로잡을 거예요.',
            nell:          '존재에 대한 깊은 고뇌와 서정성을 품은 당신. 넬의 25년 음악 여정이 당신의 내면 깊은 곳에 닿을 거예요.',
            broccoli:      '일상의 소소함에서 따뜻함을 찾는 당신. 브로콜리너마저의 위로 담긴 포크팝이 당신의 마음에 꼭 맞아요.',
            blackskirts:   '신랄하고 독보적인 세계관을 가진 당신. 검정치마의 세련된 언어가 당신의 솔직한 내면을 대변해요.',
            cryingnut:     '펑크 정신과 폭발적인 에너지를 가진 당신. 크라잉넛의 30년 전설이 당신의 열정에 불을 지펴줄 거예요.',
            galaxyexpress: '가라지 록의 날 것 그대로의 에너지를 사랑하는 당신. 갤럭시익스프레스의 땀 튀기는 라이브가 당신을 완전히 사로잡을 거예요.',
            guckkasten:    '음악을 시각 예술처럼 체험하고 싶은 당신. 국카스텐의 강렬한 퍼포먼스와 실험적 사운드가 당신의 감각을 압도할 거예요.',
            sultandisco:   '어디서나 흥을 폭발시키는 에너지를 가진 당신. 술탄오브더디스코의 파티 바이브가 당신의 본능과 정확히 맞아요.',
            yozoh:         '책·카페·산책이 어울리는 감성적인 당신. 요조의 아기자기한 인디팝이 당신의 일상 속 BGM이 되어줄 거예요.',
            soran:         '대화하듯 따뜻하게 소통하는 걸 좋아하는 당신. 소란의 편안한 인디록이 당신의 마음을 그대로 노래해요.',
            sunwoo:        '재즈와 팝의 경계를 자유롭게 넘나드는 세련된 당신. 선우정아의 음악적 깊이가 당신의 감각을 더욱 풍요롭게 해줄 거예요.',
            surl:          '감성적인 OST에 감동받고 라이브에서 진한 교감을 나누는 당신. SURL의 어쿠스틱 감성이 당신의 심장에 조용히 스며들 거예요.',
            epitone:       '피아노 선율 하나로 하루의 감정을 정리하는 당신. 에피톤프로젝트의 위로와 희망이 당신의 일상에 꼭 필요한 음악이에요.',
            lucy:          '클래식과 록 사이를 유연하게 오가는 섬세한 당신. 루시의 바이올린이 어우러진 팝록이 당신의 감성을 정확히 자극해요.',
            monni:         '좋은 음악에 대한 높은 기준을 가진 진지한 당신. 몽니의 깊고 성숙한 인디록이 당신의 음악적 욕심을 채워줄 거예요.',
            hanlolo:       '솔직하고 담백한 감성으로 일상을 바라보는 당신. 한로로의 따뜻한 온기가 당신의 마음속 빈자리를 채워줄 거예요.',
            leeseungyoon:  '삶의 무게를 진지하게 담아내는 깊이 있는 당신. 이승윤의 포크록이 당신의 진정성 있는 내면과 정확히 맞닿아요.',
        };

        // 축 의미: [0]에너지(조용↔폭발) [1]실험성(익숙↔실험) [2]감성(쿨↔서정) [3]친화력(마이웨이↔소통) [4]깊이(유쾌↔묵직)
        const BAND_AXES = [
            { name:'에너지', emoji:'🔥' },
            { name:'실험성', emoji:'🧪' },
            { name:'감성',   emoji:'🌙' },
            { name:'친화력', emoji:'🤝' },
            { name:'깊이',   emoji:'🌊' },
        ];
        // ⚠️ 문항·선택지 벡터나 밴드 v를 바꾸면 반드시 전수 시뮬레이션으로 22팀 분포 재검증할 것
        //    (2026-07 리밸런싱: 전 팀 3.7~6.6% 균등, 이전엔 혁오 31% 편중 + 요조/SURL 도달 불가였음)
        const BAND_QUESTIONS = [
            { q:'공연장에 갔다. 나는 어디에 있을까?', opts:[
                { label:'맨 앞줄 — 뛰고 떼창하고 땀범벅', v:[2,0,-1,1,-1] },
                { label:'사운드 제일 좋은 스팟 — 연주를 뜯어듣는 중', v:[0,1,0,-1,2] },
                { label:'중간 어딘가 — 조명과 분위기에 스며드는 중', v:[-1,0,2,0,1] },
                { label:'친구들과 같이 — 공연 반, 수다 반', v:[1,-1,0,2,-1] },
            ]},
            { q:'플레이리스트에 노래를 담는 기준은?', opts:[
                { label:'텐션! 출근길도 페스티벌로 만들어주는 곡', v:[2,0,-1,1,-1] },
                { label:'아무도 모르는 노래를 발굴하는 재미', v:[0,2,0,-1,1] },
                { label:'가사가 꼭 내 얘기 같은 곡', v:[-1,0,2,0,1] },
                { label:'다 같이 따라 부를 수 있는 곡', v:[1,-1,0,2,-1] },
            ]},
            { q:'스트레스가 한계치를 찍으면?', opts:[
                { label:'소리 지르고 몸으로 털어낸다', v:[2,0,-1,0,-1] },
                { label:'평소 안 하던 걸 저지르며 환기한다', v:[1,2,0,-1,0] },
                { label:'슬픈 노래 틀고 오히려 더 깊이 잠긴다', v:[-2,0,2,0,1] },
                { label:'사람들을 만나서 털어놓는다', v:[0,-1,0,2,0] },
            ]},
            { q:'처음 만난 사람들 사이에서 나는?', opts:[
                { label:'먼저 말 걸고 분위기를 끌어올리는 쪽', v:[2,0,0,2,-1] },
                { label:'관찰하다가 흥미로운 사람에게만 훅 들어감', v:[-1,2,0,-1,1] },
                { label:'잘 들어주다 보면 어느새 깊은 얘기 담당', v:[-1,0,1,1,2] },
                { label:'낯은 가리지만 한번 마음 열면 오래 감', v:[-1,0,2,1,0] },
            ]},
            { q:'여행지에서 제일 기대되는 순간은?', opts:[
                { label:'현지 축제나 시장 — 시끌벅적 그 자체', v:[2,1,-1,1,-1] },
                { label:'검색해도 안 나오는 골목 — 나만의 발견', v:[0,2,0,-1,1] },
                { label:'노을 지는 바닷가 — 말없이 오래 보기', v:[-2,0,2,0,1] },
                { label:'숙소에서 일행들과 밤새 떠드는 시간', v:[1,-1,0,2,0] },
            ]},
            { q:'내 플레이리스트가 유출됐다. 사람들의 반응은?', opts:[
                { label:'"이거 완전 파티 플리잖아"', v:[2,0,-1,1,-1] },
                { label:'"이런 밴드를 어떻게 알아?"', v:[0,2,0,-1,1] },
                { label:'"...너 요즘 무슨 일 있어?"', v:[-1,0,2,0,1] },
                { label:'"어? 나도 이 노래 좋아하는데"', v:[0,-1,0,2,0] },
            ]},
            { q:'팀 프로젝트에서 나의 역할은?', opts:[
                { label:'일단 시동 거는 추진력 담당', v:[2,0,-1,1,0] },
                { label:'아무도 생각 못 한 방향을 던지는 쪽', v:[0,2,0,-1,1] },
                { label:'디테일과 완성도를 끝까지 붙잡는 쪽', v:[-1,0,1,0,2] },
                { label:'의견 조율하고 팀 분위기 챙기는 쪽', v:[0,-1,1,2,0] },
            ]},
            { q:'"인생곡"의 조건은?', opts:[
                { label:'전주 1초 만에 심장이 뛰는 곡', v:[2,0,0,0,-1] },
                { label:'들을 때마다 새로운 게 들리는 곡', v:[0,2,0,-1,1] },
                { label:'특정 계절·사람·거리가 떠오르는 곡', v:[-1,0,2,1,0] },
                { label:'힘들 때 꺼내 듣는, 나를 일으키는 곡', v:[-1,0,1,1,2] },
            ]},
            { q:'금요일 밤 10시, 나의 이상적인 모습은?', opts:[
                { label:'시끌벅적한 곳에서 놀고 있는 중', v:[2,0,-1,2,-1] },
                { label:'이색적인 공간이나 심야 전시를 탐험 중', v:[0,2,0,-1,1] },
                { label:'혼자 이어폰 끼고 새벽 감성 예열 중', v:[-2,0,2,-1,1] },
                { label:'가까운 사람들과 깊은 대화 중', v:[-1,0,1,2,1] },
            ]},
            { q:'만약 내가 밴드를 시작한다면, 첫 곡은?', opts:[
                { label:'첫 소절부터 관객을 뛰게 만드는 곡', v:[2,0,-1,1,-1] },
                { label:'"이게 뭐지?" 싶은 실험적인 곡', v:[0,2,0,-1,1] },
                { label:'내 마음속 이야기를 눌러 담은 곡', v:[-1,0,2,0,1] },
                { label:'듣는 사람이 위로받았으면 하는 곡', v:[-1,-1,1,2,1] },
            ]},
        ];

        function renderCommunityTestHome() {
            const el = document.getElementById('communityContent');
            if (!el) return;
            state.communityTestShared = false;
            if (location.search) history.replaceState({}, '', location.pathname);
            communityBarVisible(true);
            el.innerHTML = communitySegHTML('test') + `
                <div style="padding:24px 0 48px;">
                    <h3 style="font-size:0.8rem;font-weight:700;color:var(--wds-gray-500);letter-spacing:0.06em;margin:0 0 12px;text-transform:uppercase">🎯 성향 테스트</h3>
                    <div style="display:flex;flex-direction:column;gap:14px;">
                        <div onclick="startCommunityTest('inst')" style="background:linear-gradient(135deg,#FF6B6B,#F7B731);border-radius:16px;padding:24px 20px;cursor:pointer;color:#fff;text-align:center;transition:transform 0.15s;" onmouseenter="this.style.transform='scale(1.02)'" onmouseleave="this.style.transform='scale(1)'">
                            <div style="font-size:2.2rem;margin-bottom:8px">🎸🥁🎤🎹<img src="https://raw.githubusercontent.com/wearegatheo-netizen/gatherallaround/master/base_icon.png" style="height:1em;vertical-align:middle"></div>
                            <div style="font-size:1.05rem;font-weight:700;margin-bottom:4px">나에게 어울리는 악기 세션은?</div>
                            <div style="font-size:0.82rem;opacity:0.9">8가지 일상 질문으로 알아보는 나만의 악기 포지션</div>
                        </div>
                        <div onclick="startCommunityTest('band')" style="background:linear-gradient(135deg,#6C5CE7,#2C3E50);border-radius:16px;padding:24px 20px;cursor:pointer;color:#fff;text-align:center;transition:transform 0.15s;" onmouseenter="this.style.transform='scale(1.02)'" onmouseleave="this.style.transform='scale(1)'">
                            <div style="font-size:2.2rem;margin-bottom:8px">🌙🌊🔥⚡🌿</div>
                            <div style="font-size:1.05rem;font-weight:700;margin-bottom:4px">나랑 어울리는 밴드는?</div>
                            <div style="font-size:0.82rem;opacity:0.9">국내 인디 밴드 중 나와 가장 닮은 밴드 찾기</div>
                        </div>
                    </div>
                </div>`;
        }

        // ───────────────────────────────────────────────
        // 성향 테스트 (게임 2종은 2026-10-13 요청으로 삭제 — game_scores 테이블은 DB 에 남아 있음)
        // ───────────────────────────────────────────────
        function startCommunityTest(type) {
            state.communityTestType = type;
            state.communityTestStep = 0;
            state.communityTestAnswers = [];
            state.communityTestResult = null;
            state.communityTestDetail = null;
            state.communityTestShared = false;
            renderCommunityTestQuestion();
        }

        function renderCommunityTestQuestion() {
            const el = document.getElementById('communityContent');
            if (!el) return;
            const questions = state.communityTestType === 'inst' ? INST_QUESTIONS : BAND_QUESTIONS;
            const step = state.communityTestStep;
            const total = questions.length;
            const q = questions[step];
            const pct = Math.round((step / total) * 100);
            const title = state.communityTestType === 'inst' ? '나에게 어울리는 악기 세션은?' : '나랑 어울리는 밴드는?';

            el.innerHTML = `
                <div style="padding-top:8px;padding-bottom:48px;">
                    <button onclick="renderCommunityTestHome()" style="background:none;border:none;color:var(--wds-gray-500);cursor:pointer;font-size:0.88rem;padding:0 0 16px;display:flex;align-items:center;gap:4px">← 테스트 & 게임</button>
                    <div style="font-size:0.78rem;color:var(--wds-gray-500);margin-bottom:6px">${title}</div>
                    <div style="font-size:0.75rem;color:var(--wds-gray-400);margin-bottom:8px">${step + 1} / ${total}</div>
                    <div style="background:var(--wds-gray-200);border-radius:4px;height:6px;margin-bottom:24px;overflow:hidden">
                        <div style="height:100%;width:${pct}%;background:var(--wds-primary);border-radius:4px;transition:width 0.3s"></div>
                    </div>
                    <div style="font-size:1.05rem;font-weight:700;color:var(--wds-black);margin-bottom:20px;line-height:1.5">Q${step + 1}. ${escapeHtml(q.q)}</div>
                    <div style="display:flex;flex-direction:column;gap:10px">
                        ${q.opts.map((opt, i) => `
                            <button onclick="answerCommunityTest(${i})" style="text-align:center;padding:14px 16px;border:1.5px solid var(--wds-gray-200);border-radius:12px;background:var(--wds-white);color:var(--wds-black);font-size:0.9rem;cursor:pointer;line-height:1.4;transition:all 0.15s" onmouseenter="this.style.borderColor='var(--wds-primary)';this.style.background='var(--wds-gray-100)'" onmouseleave="this.style.borderColor='var(--wds-gray-200)';this.style.background='var(--wds-white)'">
                                <span style="color:var(--wds-primary);font-weight:700;margin-right:8px">${String.fromCharCode(65+i)}</span>${escapeHtml(opt.label)}
                            </button>`).join('')}
                    </div>
                </div>`;
        }

        function answerCommunityTest(optIdx) {
            const questions = state.communityTestType === 'inst' ? INST_QUESTIONS : BAND_QUESTIONS;
            const q = questions[state.communityTestStep];
            state.communityTestAnswers.push(q.opts[optIdx]);
            state.communityTestStep++;
            if (state.communityTestStep >= questions.length) {
                state.communityTestResult = calcCommunityTestResult();
                renderCommunityTestResult();
            } else {
                renderCommunityTestQuestion();
            }
        }

        // 매칭된 밴드 기준 비슷한/반대 성향 밴드 찾기 (5차원 벡터 거리)
        function findRelatedBands(key) {
            const base = BAND_RESULTS[key];
            if (!base) return { similar: [], opposite: [] };
            const others = Object.entries(BAND_RESULTS)
                .filter(([k]) => k !== key)
                .map(([k, b]) => ({
                    key: k, band: b,
                    dist: Math.sqrt(b.v.reduce((s, val, i) => s + Math.pow(val - base.v[i], 2), 0)),
                }));
            others.sort((a, b) => a.dist - b.dist);
            return {
                similar: others.slice(0, 2),
                opposite: others.slice(-2).reverse(),
            };
        }

        // ── 밴드 매칭 정규화 통계 ──
        // 균등 선택 가정 하에 각 축 합의 평균·표준편차를 닫힌형으로 계산 (문항이 바뀌면 자동 갱신됨)
        let _bandTestStats = null;
        function getBandTestStats() {
            if (_bandTestStats) return _bandTestStats;
            const mean = [0, 0, 0, 0, 0], sd = [0, 0, 0, 0, 0], vari = [0, 0, 0, 0, 0];
            BAND_QUESTIONS.forEach(q => {
                for (let d = 0; d < 5; d++) {
                    const vals = q.opts.map(o => o.v[d]);
                    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
                    mean[d] += m;
                    vari[d] += vals.reduce((s, x) => s + (x - m) * (x - m), 0) / vals.length;
                }
            });
            for (let d = 0; d < 5; d++) sd[d] = Math.sqrt(vari[d]) || 1;
            _bandTestStats = { mean, sd };
            return _bandTestStats;
        }

        // 유저 원점수 합 → 1~5 성향 축 값 (z-score 기반. SCALE=1.5는 전수 시뮬레이션으로 22팀 균등 분포 검증된 값)
        function normalizeBandUserVec(raw) {
            const { mean, sd } = getBandTestStats();
            return raw.map((x, d) => Math.max(1, Math.min(5, 3 + (x - mean[d]) / sd[d] * 1.5)));
        }

        // 거리 → 매칭률 % (1위 기준 대략 77~95% 분포가 되도록 보정)
        function bandMatchPct(dist) {
            return Math.max(60, Math.min(99, Math.round(99 - dist * 9)));
        }

        function calcCommunityTestResult() {
            if (state.communityTestType === 'inst') {
                const counts = {};
                state.communityTestAnswers.forEach(a => { counts[a.key] = (counts[a.key] || 0) + 1; });
                return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            } else {
                const raw = [0, 0, 0, 0, 0];
                state.communityTestAnswers.forEach(a => {
                    a.v.forEach((d, i) => { raw[i] += d; });
                });
                const userAxes = normalizeBandUserVec(raw);
                const ranking = Object.entries(BAND_RESULTS).map(([key, band]) => {
                    const dist = Math.sqrt(band.v.reduce((s, val, i) => s + Math.pow(val - userAxes[i], 2), 0));
                    return { key, dist, pct: bandMatchPct(dist) };
                }).sort((a, b) => a.dist - b.dist);
                state.communityTestDetail = { userAxes, ranking };
                return ranking[0].key;
            }
        }

        function getBandCardStyle(key, color) {
            const s = {
                jannabi:       `background:linear-gradient(135deg,${color} 0%,#5D4037 100%);color:#fff`,
                hyukoh:        `background:linear-gradient(160deg,${color} 0%,#0D47A1 100%);color:#fff`,
                silicagel:     `background:linear-gradient(135deg,#1a0533 0%,${color} 50%,#0d001a 100%);color:#fff`,
                sesoneeon:     `background:linear-gradient(150deg,${color} 0%,#1A237E 100%);color:#fff`,
                tencm:         `background:linear-gradient(135deg,${color} 0%,#3E2723 100%);color:#fff`,
                leenalchi:     `background:linear-gradient(135deg,${color} 0%,#B71C1C 100%);color:#fff`,
                nell:          `background:linear-gradient(180deg,${color} 0%,#000000 100%);color:#fff`,
                broccoli:      `background:linear-gradient(135deg,${color} 0%,#1B5E20 100%);color:#fff`,
                blackskirts:   `background:linear-gradient(135deg,#1a1a1a 0%,${color} 50%,#000000 100%);color:#fff`,
                cryingnut:     `background:linear-gradient(135deg,${color} 0%,#B71C1C 100%);color:#fff`,
                galaxyexpress: `background:linear-gradient(135deg,${color} 0%,#E65100 100%);color:#fff`,
                guckkasten:    `background:linear-gradient(135deg,#1a0000 0%,${color} 100%);color:#fff`,
                sultandisco:   `background:linear-gradient(135deg,${color} 0%,#F57F17 50%,#E65100 100%);color:#fff`,
                yozoh:         `background:linear-gradient(135deg,${color} 0%,#00695C 100%);color:#fff`,
                soran:         `background:linear-gradient(135deg,${color} 0%,#F9A825 100%);color:#fff`,
                sunwoo:        `background:linear-gradient(160deg,${color} 0%,#004D40 100%);color:#fff`,
                surl:          `background:linear-gradient(135deg,${color} 0%,#1565C0 100%);color:#fff`,
                epitone:       `background:linear-gradient(135deg,${color} 0%,#37474F 100%);color:#fff`,
                lucy:          `background:linear-gradient(135deg,${color} 0%,#4527A0 100%);color:#fff`,
                monni:         `background:linear-gradient(135deg,${color} 0%,#455A64 100%);color:#fff`,
                hanlolo:       `background:linear-gradient(135deg,#fff0f5 0%,${color} 50%,#d63384 100%);color:#3d001a`,
                leeseungyoon:  `background:linear-gradient(135deg,${color} 0%,#3E2723 100%);color:#fff`,
            };
            return s[key] || `background:${color};color:#fff`;
        }

        // 한글 받침 유무에 따라 와/과 조사 선택 (영문/숫자는 와)
        function withWaGwa(name) {
            const ch = name.charCodeAt(name.length - 1);
            if (ch >= 0xAC00 && ch <= 0xD7A3) {
                return name + (((ch - 0xAC00) % 28 === 0) ? '와' : '과');
            }
            return name + '와';
        }

        function renderCommunityTestResult() {
            const el = document.getElementById('communityContent');
            if (!el) return;
            const type = state.communityTestType;
            const key = state.communityTestResult;
            const result = type === 'inst' ? INST_RESULTS[key] : BAND_RESULTS[key];
            if (!result) { renderCommunityTestHome(); return; }

            // 매칭 상세(내 성향 축·전체 랭킹) — 공유 링크 진입 시엔 없거나 매칭률만 있을 수 있음
            const detail = type === 'band' ? state.communityTestDetail : null;
            const topPct = (detail && detail.ranking && detail.ranking[0] && detail.ranking[0].key === key) ? detail.ranking[0].pct : null;
            const shared = !!state.communityTestShared;

            const shareUrl = `${location.origin}${location.pathname}?ct=${type}&cr=${key}${topPct ? `&m=${topPct}` : ''}`;
            history.replaceState({}, '', `?ct=${type}&cr=${key}${topPct ? `&m=${topPct}` : ''}`);

            const title = type === 'inst' ? '나에게 어울리는 악기 세션은?' : '나랑 어울리는 밴드는?';
            const resultLabel = type === 'inst' ? `나는 ${result.name} 타입!` : `나는 ${withWaGwa(result.name)} 잘 어울리는 사람!`;
            const cardStyle = type === 'band'
                ? `${getBandCardStyle(key, result.color)};border-radius:24px;overflow:hidden;text-align:center;margin-bottom:20px;box-shadow:0 14px 40px -12px rgba(0,0,0,0.35);position:relative;`
                : `background:${result.color};border-radius:24px;overflow:hidden;padding:32px 24px;text-align:center;color:#fff;margin-bottom:20px;box-shadow:0 14px 40px -12px rgba(0,0,0,0.35);position:relative;`;

            el.innerHTML = `
                <div style="padding-top:8px;padding-bottom:48px;">
                    <button onclick="renderCommunityTestHome()" style="background:none;border:none;color:var(--wds-gray-500);cursor:pointer;font-size:0.88rem;padding:0 0 16px;display:flex;align-items:center;gap:4px">← 테스트 & 게임</button>
                    ${shared ? `
                    <div style="background:var(--wds-gray-100);border:1.5px dashed var(--wds-gray-200);border-radius:14px;padding:12px 16px;margin-bottom:14px;text-align:center;">
                        <div style="font-size:0.85rem;font-weight:700;color:var(--wds-black)">👀 친구가 공유한 결과예요</div>
                        <div style="font-size:0.75rem;color:var(--wds-gray-500);margin-top:2px">나는 어떤 밴드가 나올까? 아래에서 바로 확인!</div>
                    </div>` : ''}
                    <div id="testResultCard" style="${cardStyle}">
                        ${type === 'band' && result.imgSrc ? `
                        <div style="position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;background:rgba(0,0,0,0.35);">
                            <img src="${result.imgSrc}" crossorigin="anonymous" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(28px) brightness(0.55);transform:scale(1.1);">
                            <img src="${result.imgSrc}" crossorigin="anonymous" style="position:relative;width:100%;height:100%;object-fit:contain;display:block;">
                            <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0.05) 65%,rgba(0,0,0,0.55) 100%);pointer-events:none;"></div>
                            <div style="position:absolute;top:12px;left:14px;background:rgba(0,0,0,0.4);backdrop-filter:blur(8px);padding:5px 11px;border-radius:999px;font-size:0.7rem;color:#fff;font-weight:600;letter-spacing:0.04em">✨ ${escapeHtml(title)}</div>
                            <div style="position:absolute;top:12px;right:14px;font-size:1.6rem;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">${result.emoji}</div>
                        </div>
                        <div style="padding:22px 22px 28px;color:#fff;">
                            <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.12em;opacity:0.75;margin-bottom:6px">YOUR BAND MATCH</div>
                            <div style="font-size:1.7rem;font-weight:800;margin-bottom:12px;line-height:1.2">${escapeHtml(resultLabel)}</div>
                            ${topPct ? `<div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.4);border-radius:999px;padding:4px 14px;font-size:0.82rem;font-weight:800;margin-bottom:12px;letter-spacing:0.02em">매칭률 ${topPct}%</div>` : ''}
                            <div style="height:2px;width:40px;background:rgba(255,255,255,0.5);margin:0 auto 14px;border-radius:2px"></div>
                            <div style="font-size:0.88rem;opacity:0.92;line-height:1.65;max-width:300px;margin:0 auto">${escapeHtml(result.desc)}</div>
                        </div>
                        ` : `
                        <div style="padding:32px 24px;">
                            <div style="font-size:0.8rem;opacity:0.85;margin-bottom:12px">${escapeHtml(title)}</div>
                            <div style="font-size:3.5rem;margin-bottom:12px">${result.emoji}</div>
                            <div style="font-size:1.5rem;font-weight:800;margin-bottom:10px">${escapeHtml(resultLabel)}</div>
                            <div style="font-size:0.88rem;opacity:0.9;line-height:1.6;max-width:280px;margin:0 auto">${escapeHtml(result.desc)}</div>
                        </div>
                        `}
                    </div>
                    ${RESULT_WHY[key] ? `
                    <div style="background:var(--wds-gray-100);border-radius:14px;padding:14px 16px;margin-bottom:16px;">
                        <div style="font-size:0.72rem;font-weight:700;color:var(--wds-primary);letter-spacing:0.06em;margin-bottom:6px">💡 이 결과가 나온 이유</div>
                        <div style="font-size:0.85rem;color:var(--wds-black);line-height:1.6">${escapeHtml(RESULT_WHY[key])}</div>
                    </div>` : ''}
                    ${detail && detail.userAxes ? `
                    <div style="background:var(--wds-gray-100);border-radius:14px;padding:14px 16px;margin-bottom:16px;">
                        <div style="font-size:0.72rem;font-weight:700;color:var(--wds-primary);letter-spacing:0.06em;margin-bottom:12px">📊 나의 성향 그래프</div>
                        ${BAND_AXES.map((ax, i) => {
                            const uPct = Math.round((detail.userAxes[i] - 1) / 4 * 100);
                            const bPct = Math.round((result.v[i] - 1) / 4 * 100);
                            return `
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
                            <span style="font-size:0.75rem;width:66px;flex-shrink:0;color:var(--wds-black);font-weight:600">${ax.emoji} ${ax.name}</span>
                            <div style="flex:1;position:relative;height:14px;">
                                <div style="position:absolute;inset:0;background:var(--wds-gray-200);border-radius:999px"></div>
                                <div style="position:absolute;top:0;left:0;bottom:0;width:${uPct}%;background:linear-gradient(90deg,var(--wds-primary),#6C5CE7);border-radius:999px;min-width:6px"></div>
                                <div style="position:absolute;top:50%;left:${bPct}%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;background:#fff;border:2.5px solid ${result.color};box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>
                            </div>
                        </div>`;
                        }).join('')}
                        <div style="font-size:0.68rem;color:var(--wds-gray-500);margin-top:6px">막대 = 나의 성향 · 점 = ${escapeHtml(result.name)}의 성향</div>
                    </div>` : ''}
                    ${result.songs ? `
                    <div style="margin-bottom:20px">
                        <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);letter-spacing:0.06em;margin-bottom:10px">🎵 추천 트랙</div>
                        <div style="display:flex;flex-direction:column;gap:8px">
                            ${result.songs.map((s, i) => `
                            <div style="background:var(--wds-gray-100);border-radius:12px;padding:12px 14px;">
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                                    <span style="font-size:0.72rem;font-weight:700;color:var(--wds-white);background:var(--wds-black);border-radius:6px;padding:2px 7px;opacity:0.7">${i + 1}</span>
                                    <span style="font-size:0.9rem;font-weight:700;color:var(--wds-black)">${escapeHtml(s.title)}</span>
                                    ${s.artist ? `<span style="font-size:0.75rem;color:var(--wds-gray-500)">· ${escapeHtml(s.artist)}</span>` : ''}
                                </div>
                                <div style="font-size:0.8rem;color:var(--wds-gray-500);line-height:1.5;padding-left:4px">${escapeHtml(s.vibe || s.lyric || '')}</div>
                            </div>`).join('')}
                        </div>
                    </div>` : ''}
                    ${type === 'band' ? (() => {
                        const rel = findRelatedBands(key);
                        const renderMini = (item, tag) => {
                            const b = item.band;
                            const style = getBandCardStyle(item.key, b.color);
                            return `<div style="flex:1;min-width:0;border-radius:14px;overflow:hidden;${style};box-shadow:0 6px 16px -8px rgba(0,0,0,0.4)">
                                ${b.imgSrc ? `<div style="position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background:rgba(0,0,0,0.25)">
                                    <img src="${b.imgSrc}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(18px) brightness(0.55);transform:scale(1.1)">
                                    <img src="${b.imgSrc}" style="position:relative;width:100%;height:100%;object-fit:contain;display:block">
                                    <div style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,0.55);color:#fff;font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:999px;letter-spacing:0.04em">${tag}</div>
                                </div>` : `<div style="aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:2.5rem">${b.emoji}</div>`}
                                <div style="padding:10px 12px 12px">
                                    <div style="font-size:0.92rem;font-weight:800;color:inherit;margin-bottom:2px">${escapeHtml(b.name)}</div>
                                    <div style="font-size:0.7rem;opacity:0.75;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(b.desc)}</div>
                                </div>
                            </div>`;
                        };
                        const runners = (detail && detail.ranking && detail.ranking.length > 2)
                            ? detail.ranking.slice(1, 3).map(r => ({ key: r.key, band: BAND_RESULTS[r.key], pct: r.pct }))
                            : null;
                        return `
                        ${runners ? `
                        <div style="margin-bottom:18px">
                            <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);letter-spacing:0.06em;margin-bottom:10px">🥈 아깝게 놓친 매칭</div>
                            <div style="display:flex;gap:10px">${runners.map((it, i) => renderMini(it, `${i + 2}위 · ${it.pct}%`)).join('')}</div>
                        </div>` : `
                        <div style="margin-bottom:18px">
                            <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);letter-spacing:0.06em;margin-bottom:10px">💚 비슷한 성향의 밴드</div>
                            <div style="display:flex;gap:10px">${rel.similar.map(it => renderMini(it, '비슷')).join('')}</div>
                        </div>`}
                        <div style="margin-bottom:18px">
                            <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);letter-spacing:0.06em;margin-bottom:10px">🔥 완전 반대 성향의 밴드</div>
                            <div style="display:flex;gap:10px">${rel.opposite.map(it => renderMini(it, '반대')).join('')}</div>
                        </div>`;
                    })() : ''}
                    ${type === 'band' && result.sns ? `
                    <div style="margin-bottom:16px">
                        <div style="font-size:0.78rem;font-weight:700;color:var(--wds-gray-500);letter-spacing:0.06em;margin-bottom:8px">📱 팔로우하기</div>
                        <a href="${result.sns.instagram}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);border-radius:12px;text-decoration:none;color:#fff;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                            <span style="font-size:0.88rem;font-weight:700">Instagram에서 ${escapeHtml(result.name)} 팔로우</span>
                        </a>
                    </div>` : ''}
                    ${shared ? `
                    <div style="display:flex;flex-direction:column;gap:10px">
                        <button onclick="startCommunityTest('${type}')" style="padding:16px;border-radius:14px;border:none;background:linear-gradient(135deg,var(--wds-primary),#6C5CE7);color:#fff;cursor:pointer;font-size:1rem;font-weight:800;box-shadow:0 8px 20px -8px rgba(0,0,0,0.35)">🎸 나도 테스트하러 가기 (1분)</button>
                        <button onclick="renderCommunityTestHome()" style="padding:12px;border-radius:12px;border:1.5px solid var(--wds-gray-200);background:var(--wds-white);color:var(--wds-black);cursor:pointer;font-size:0.88rem;font-weight:600">다른 테스트 보기</button>
                    </div>` : `
                    <div style="background:linear-gradient(135deg,var(--wds-primary),#6C5CE7);border-radius:14px;padding:14px 16px;margin-bottom:12px;text-align:center;">
                        <div style="font-size:0.88rem;font-weight:700;color:#fff;margin-bottom:4px">📣 결과 공유하기</div>
                        <div style="font-size:0.78rem;color:rgba(255,255,255,0.85);line-height:1.5">링크를 받은 친구가 내 결과를 보고<br>자기 테스트도 바로 해볼 수 있어요!</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
                        <button onclick="shareTestUrl('${escapeHtml(shareUrl)}')" style="padding:12px;border-radius:12px;border:1.5px solid var(--wds-gray-200);background:var(--wds-white);cursor:pointer;font-size:0.9rem;font-weight:600;color:var(--wds-black)">🔗 링크 복사</button>
                        <button onclick="downloadTestImage()" style="padding:12px;border-radius:12px;border:1.5px solid var(--wds-gray-200);background:var(--wds-white);cursor:pointer;font-size:0.9rem;font-weight:600;color:var(--wds-black)">🖼️ 이미지 저장</button>
                    </div>
                    <div style="display:flex;gap:10px">
                        <button onclick="startCommunityTest('${type}')" style="flex:1;padding:12px;border-radius:12px;border:1.5px solid var(--wds-primary);background:var(--wds-white);color:var(--wds-primary);cursor:pointer;font-size:0.88rem;font-weight:600">다시하기</button>
                        <button onclick="renderCommunityTestHome()" style="flex:1;padding:12px;border-radius:12px;border:none;background:var(--wds-primary);color:#fff;cursor:pointer;font-size:0.88rem;font-weight:600">다른 테스트</button>
                    </div>`}
                </div>`;
        }

        function shareTestUrl(url) {
            navigator.clipboard.writeText(url).then(() => showToast('링크가 복사되었습니다!')).catch(() => {
                prompt('아래 링크를 복사하세요:', url);
            });
        }

        function shareTestKakao() {
            const type = state.communityTestType;
            const key = state.communityTestResult;
            const result = type === 'inst' ? INST_RESULTS[key] : BAND_RESULTS[key];
            if (!result) return;
            if (typeof Kakao === 'undefined' || !Kakao.isInitialized()) {
                showToast('카카오 공유를 사용할 수 없습니다. 링크 복사를 이용해주세요.');
                return;
            }
            const _kd = type === 'band' ? state.communityTestDetail : null;
            const _kPct = (_kd && _kd.ranking && _kd.ranking[0] && _kd.ranking[0].key === key) ? _kd.ranking[0].pct : null;
            const shareUrl = `${location.origin}${location.pathname}?ct=${type}&cr=${key}${_kPct ? `&m=${_kPct}` : ''}`;
            const resultLabel = type === 'inst' ? `나는 ${result.name} 타입!` : `나는 ${withWaGwa(result.name)} 잘 어울리는 사람!`;
            const emojiText = (typeof result.emoji === 'string' && result.emoji.startsWith('<')) ? '🎵' : result.emoji;
            const linkObj = { webUrl: shareUrl, mobileWebUrl: shareUrl };

            // SDK 호환: Kakao.Share (신) 우선, 없으면 Kakao.Link (구)
            const shareApi = (Kakao.Share && Kakao.Share.sendDefault) ? Kakao.Share : Kakao.Link;
            const uploadFn = (Kakao.Share && Kakao.Share.uploadImage) ? Kakao.Share.uploadImage
                            : (Kakao.Link && Kakao.Link.uploadImage) ? Kakao.Link.uploadImage : null;

            function sendFeed(imageUrl) {
                try {
                    shareApi.sendDefault({
                        objectType: 'feed',
                        content: {
                            title: `${emojiText} ${resultLabel}`,
                            description: result.desc,
                            imageUrl: imageUrl || '',
                            link: linkObj,
                        },
                        buttons: [
                            { title: '내 결과 자세히 보기', link: linkObj },
                            { title: '나도 테스트해보기', link: linkObj },
                        ],
                    });
                } catch (e) {
                    console.error('Kakao share error:', e);
                    shareTestUrl(shareUrl);
                    showToast('카카오 공유에 실패했습니다. 링크가 클립보드에 복사되었습니다.');
                }
            }

            function sendTextFallback() {
                try {
                    shareApi.sendDefault({
                        objectType: 'text',
                        text: `${emojiText} ${resultLabel}\n\n${result.desc}\n\n링크 눌러서 나도 테스트해보기 👇`,
                        link: linkObj,
                        buttonTitle: '내 결과 자세히 보기',
                    });
                } catch (e) {
                    console.error('Kakao share error:', e);
                    shareTestUrl(shareUrl);
                    showToast('카카오 공유에 실패했습니다. 링크가 클립보드에 복사되었습니다.');
                }
            }

            if (!uploadFn) { sendTextFallback(); return; }

            // 결과 이미지 생성 → Kakao 서버 업로드 → feed 전송
            try {
                downloadTestImage((blob) => {
                    if (!blob) { sendTextFallback(); return; }
                    const file = new File([blob], `${type}-test-${key}.png`, { type: 'image/png' });
                    uploadFn.call(Kakao.Share || Kakao.Link, { file: [file] })
                        .then((res) => {
                            const url = res && res.infos && res.infos.original && res.infos.original.url;
                            sendFeed(url);
                        })
                        .catch((err) => {
                            console.error('Kakao image upload error:', err);
                            sendTextFallback();
                        });
                });
            } catch (e) {
                console.error('Kakao share blob error:', e);
                sendTextFallback();
            }
        }

        function downloadTestImage(onBlob) {
            // onBlob 제공 시: 다운로드 대신 콜백으로 Blob 전달 (Kakao 업로드용)
            const type = state.communityTestType;
            const key = state.communityTestResult;
            const result = type === 'inst' ? INST_RESULTS[key] : BAND_RESULTS[key];
            if (!result) return;

            // 2·3위 매칭 — 이미지에 한 줄로 표기 (매칭 상세가 있을 때만)
            const _dd = type === 'band' ? state.communityTestDetail : null;
            const runners = (_dd && _dd.ranking && _dd.ranking.length > 2)
                ? _dd.ranking.slice(1, 3).map(r => ({ name: BAND_RESULTS[r.key].name, pct: r.pct }))
                : null;

            function loadImg(src) {
                return new Promise(resolve => {
                    if (!src) return resolve(null);
                    const im = new Image();
                    im.crossOrigin = 'anonymous';
                    im.onload = () => resolve(im);
                    im.onerror = () => resolve(null);
                    im.src = src;
                });
            }

            function saveBlob(blob, fname) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = fname;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }

            // ── 결과 이미지: 인스타 스토리 9:16 (1080×1920) 단일 포맷 — 핵심 정보만 크게
            // done(blob) 콜백으로 전달 (저장/카카오 공유 공용)
            function drawStory(mainImg, done) {
                const canvas = document.createElement('canvas');
                const DPR = 2, W = 540, H = 960;
                canvas.width = W * DPR; canvas.height = H * DPR;
                const ctx = canvas.getContext('2d');
                ctx.scale(DPR, DPR);
                ctx.textBaseline = 'alphabetic';
                function rr(x, y, w, h, r) {
                    ctx.beginPath();
                    ctx.moveTo(x+r, y);
                    ctx.arcTo(x+w, y, x+w, y+h, r);
                    ctx.arcTo(x+w, y+h, x, y+h, r);
                    ctx.arcTo(x, y+h, x, y, r);
                    ctx.arcTo(x, y, x+w, y, r);
                    ctx.closePath();
                }

                const _sd = type === 'band' ? state.communityTestDetail : null;
                const sPct = (_sd && _sd.ranking && _sd.ranking[0] && _sd.ranking[0].key === key) ? _sd.ranking[0].pct : null;
                const hasAxes = !!(_sd && _sd.userAxes);

                // 배경
                const g = ctx.createLinearGradient(0, 0, 0, H);
                g.addColorStop(0, darkenColor(result.color, 0.15));
                g.addColorStop(1, darkenColor(result.color, 0.6));
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, W, H);
                ctx.fillStyle = 'rgba(255,255,255,0.06)';
                ctx.beginPath(); ctx.arc(W-40, 200, 150, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(40, 760, 120, 0, Math.PI*2); ctx.fill();

                // 상단 브랜드 칩 (IG 상단 UI 안전 여백 아래)
                const chipText = type === 'band' ? '✨ 밴드 성향 테스트' : '🎵 악기 세션 테스트';
                ctx.font = 'bold 14px sans-serif';
                const chipW = ctx.measureText(chipText).width + 36;
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                rr(W/2 - chipW/2, 92, chipW, 34, 17); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText(chipText, W/2, 114);

                // 히어로 (밴드 사진 / 악기 이모지)
                const px = 60, pw = W - 120;
                const py = 138;
                const ph = type === 'band' ? (hasAxes ? 320 : 420) : 300;
                if (type === 'band' && mainImg && typeof mainImg !== 'string') {
                    ctx.save();
                    rr(px, py, pw, ph, 26); ctx.clip();
                    const cr = pw / ph, ir = mainImg.width / mainImg.height;
                    let bsx=0, bsy=0, bsw=mainImg.width, bsh=mainImg.height;
                    if (ir > cr) { bsw = mainImg.height * cr; bsx = (mainImg.width - bsw)/2; }
                    else { bsh = mainImg.width / cr; bsy = (mainImg.height - bsh)/2; }
                    ctx.filter = 'blur(24px) brightness(0.55)';
                    ctx.drawImage(mainImg, bsx, bsy, bsw, bsh, px-10, py-10, pw+20, ph+20);
                    ctx.filter = 'none';
                    let dw, dh, dx, dy;
                    if (ir > cr) { dw = pw; dh = pw / ir; dx = px; dy = py + (ph - dh)/2; }
                    else { dh = ph; dw = ph * ir; dx = px + (pw - dw)/2; dy = py; }
                    ctx.drawImage(mainImg, dx, dy, dw, dh);
                    ctx.restore();
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.1)';
                    rr(px, py, pw, ph, 26); ctx.fill();
                    if (mainImg && typeof mainImg !== 'string') {
                        // inst의 이미지 아이콘(베이스 등)
                        const icon = 130;
                        ctx.drawImage(mainImg, W/2 - icon/2, py + (ph - icon)/2, icon, icon);
                    } else {
                        const heroEmoji = (typeof result.emoji === 'string' && !result.emoji.startsWith('<')) ? result.emoji : (type === 'band' ? '🎸' : '🎵');
                        ctx.font = '110px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(heroEmoji, W/2, py + ph/2 + 40);
                    }
                }

                // 결과 라벨
                let sy = py + ph + 44;
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(type === 'band' ? 'YOUR BAND MATCH' : 'YOUR INSTRUMENT', W/2, sy);
                sy += 36;
                const sLabel = type === 'band' ? `나는 ${withWaGwa(result.name)} 잘 어울리는 사람!` : `나는 ${result.name} 타입!`;
                ctx.fillStyle = '#fff';
                let sSize = 28;
                while (sSize > 15) {
                    ctx.font = `bold ${sSize}px sans-serif`;
                    if (ctx.measureText(sLabel).width <= W - 70) break;
                    sSize--;
                }
                ctx.fillText(sLabel, W/2, sy);
                sy += 22;

                // 매칭률 (크게)
                if (sPct) {
                    const pctText = `매칭률 ${sPct}%`;
                    ctx.font = 'bold 19px sans-serif';
                    const pw2 = ctx.measureText(pctText).width + 44;
                    ctx.fillStyle = '#fff';
                    rr(W/2 - pw2/2, sy, pw2, 42, 21); ctx.fill();
                    ctx.fillStyle = darkenColor(result.color, 0.45);
                    ctx.fillText(pctText, W/2, sy + 28);
                    sy += 58;
                } else if (result.desc) {
                    // 매칭률이 없으면 소개 문구 한 줄로 공백 보완
                    ctx.fillStyle = 'rgba(255,255,255,0.85)';
                    ctx.font = '14px sans-serif';
                    const d = result.desc.length > 34 ? result.desc.slice(0, 34) + '…' : result.desc;
                    ctx.fillText(d, W/2, sy + 10);
                    sy += 40;
                }

                // 성향 미니 그래프
                if (hasAxes) {
                    const boxX = 56, boxW = W - 112;
                    const rowH = 22;
                    const boxH = 18 + BAND_AXES.length * rowH + 14;
                    ctx.fillStyle = 'rgba(255,255,255,0.14)';
                    rr(boxX, sy, boxW, boxH, 14); ctx.fill();
                    const trackX = boxX + 96, trackW = boxX + boxW - 18 - trackX;
                    BAND_AXES.forEach((ax, i) => {
                        const ry = sy + 22 + i * rowH;
                        ctx.fillStyle = '#fff';
                        ctx.font = 'bold 11.5px sans-serif';
                        ctx.textAlign = 'left';
                        ctx.fillText(`${ax.emoji} ${ax.name}`, boxX + 16, ry + 9);
                        ctx.fillStyle = 'rgba(255,255,255,0.2)';
                        rr(trackX, ry, trackW, 9, 4.5); ctx.fill();
                        const uw = Math.max(7, trackW * (_sd.userAxes[i] - 1) / 4);
                        ctx.fillStyle = 'rgba(255,255,255,0.92)';
                        rr(trackX, ry, uw, 9, 4.5); ctx.fill();
                        const bx = trackX + trackW * (result.v[i] - 1) / 4;
                        ctx.beginPath(); ctx.arc(bx, ry + 4.5, 5.5, 0, Math.PI*2);
                        ctx.fillStyle = darkenColor(result.color, 0.45); ctx.fill();
                        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
                    });
                    sy += boxH;
                }

                // 2·3위 매칭 한 줄
                if (runners) {
                    const runnersText = `아깝게 놓친 매칭  🥈 ${runners[0].name} ${runners[0].pct}% · 🥉 ${runners[1].name} ${runners[1].pct}%`;
                    let rSize = 13;
                    while (rSize > 10) {
                        ctx.font = `bold ${rSize}px sans-serif`;
                        if (ctx.measureText(runnersText).width <= W - 60) break;
                        rSize--;
                    }
                    ctx.fillStyle = 'rgba(255,255,255,0.75)';
                    ctx.textAlign = 'center';
                    ctx.fillText(runnersText, W/2, sy + 26);
                }

                // inst: 입문 추천 트랙 컴팩트 박스
                if (type === 'inst' && result.songs && result.songs.length) {
                    const boxX = 56, boxW = W - 112;
                    const tr = result.songs.slice(0, 3);
                    const trBoxH = 24 + tr.length * 42 + 8;
                    ctx.fillStyle = 'rgba(255,255,255,0.14)';
                    rr(boxX, sy, boxW, trBoxH, 14); ctx.fill();
                    ctx.fillStyle = 'rgba(255,255,255,0.7)';
                    ctx.font = 'bold 11px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.fillText('🎸 입문 추천 트랙', boxX + 16, sy + 20);
                    tr.forEach((s, i) => {
                        const ty = sy + 40 + i * 42;
                        ctx.fillStyle = '#fff';
                        ctx.font = 'bold 13.5px sans-serif';
                        const tt = s.title.length > 22 ? s.title.slice(0, 22) + '…' : s.title;
                        ctx.fillText(`${i + 1}. ${tt}`, boxX + 16, ty);
                        ctx.fillStyle = 'rgba(255,255,255,0.6)';
                        ctx.font = '11.5px sans-serif';
                        ctx.fillText(s.artist ? `— ${s.artist}` : '', boxX + 32, ty + 17);
                    });
                    sy += trBoxH;
                }

                // 하단 CTA + 도메인 (IG 하단 UI 안전 여백 위)
                const ctaText2 = type === 'band' ? '🎸 너의 밴드도 찾아보기' : '🎯 나에게 맞는 악기 찾아보기';
                ctx.font = 'bold 15px sans-serif';
                ctx.textAlign = 'center';
                const cw2 = ctx.measureText(ctaText2).width + 52;
                ctx.fillStyle = '#fff';
                rr(W/2 - cw2/2, 806, cw2, 44, 22); ctx.fill();
                ctx.fillStyle = darkenColor(result.color, 0.45);
                ctx.fillText(ctaText2, W/2, 834);
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.font = 'bold 12px sans-serif';
                ctx.fillText((location.hostname || 'gatherallaround.com'), W/2, 878);

                canvas.toBlob(done);
            }


            loadImg(result.imgSrc).then(mainImg => {
                drawStory(mainImg, blob => {
                    if (!blob) return;
                    if (onBlob) { onBlob(blob); return; } // 카카오 공유용
                    saveBlob(blob, `${type === 'band' ? 'band' : 'inst'}-test-${key}.png`);
                });
            });
        }
