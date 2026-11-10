// 게더 올 어라운드 본 스크립트 8/8 (shows) — index.html 이 번호 순서대로 읽는 클래식 스크립트. 전역(함수·let/const)을 서로 공유한다.
// 고친 뒤에는 node tools/stamp-assets.mjs 로 index.html 의 ?v= 를 갱신할 것(tests/assets-unit.mjs 가 검사).

        function initTheme() {
            let saved = null;
            try { saved = localStorage.getItem('gaa_theme'); } catch (e) {}
            if (!saved) saved = 'light'; // 기본 라이트 모드 (직접 바꾼 사용자는 저장된 선택 유지)
            applyTheme(saved);
        }

        initTheme();
        document.addEventListener('DOMContentLoaded', () => { initTheme(); initApp(); initPullToRefresh(); });

        // Pull-to-refresh (PWA standalone 모드에서도 동작)
        function initPullToRefresh() {
            const indicator = document.createElement('div');
            indicator.id = 'ptrIndicator';
            indicator.innerHTML = '<span id="ptrIcon">↓</span>';
            document.body.appendChild(indicator);
            const icon = indicator.querySelector('#ptrIcon');
            const THRESHOLD = 70;
            let startY = 0, currentY = 0, pulling = false, refreshing = false;
            document.addEventListener('touchstart', (e) => {
                if (refreshing) return;
                if (window.scrollY > 0) { pulling = false; return; }
                startY = e.touches[0].clientY;
                currentY = startY;
                pulling = true;
            }, { passive: true });
            document.addEventListener('touchmove', (e) => {
                if (!pulling || refreshing) return;
                currentY = e.touches[0].clientY;
                const dy = currentY - startY;
                if (dy <= 0) { indicator.classList.remove('visible'); return; }
                const pulled = Math.min(dy, THRESHOLD * 1.5);
                indicator.style.transform = `translateY(${pulled - 60}px)`;
                indicator.classList.add('visible');
                icon.textContent = dy >= THRESHOLD ? '↑' : '↓';
            }, { passive: true });
            document.addEventListener('touchend', () => {
                if (!pulling || refreshing) return;
                const dy = currentY - startY;
                indicator.style.transform = '';
                if (dy >= THRESHOLD) {
                    refreshing = true;
                    icon.textContent = '⟳';
                    icon.classList.add('ptr-spin');
                    indicator.classList.add('visible');
                    setTimeout(() => location.reload(), 250);
                } else {
                    indicator.classList.remove('visible');
                }
                pulling = false;
            }, { passive: true });
        }

        // ═══════════════ 공연 예매 (shows) — 공개 존 ═══════════════
        // 두둥식 티켓 플랫폼. 읽기는 anon(events/event_seats), 쓰기는 전부 /event-api(service role).
        // 관객은 로그인 없이 이름+전화번호로 예매하고, 예매번호+전화번호로 조회·취소한다.
        let _showsState = { events: [], seats: {}, event: null, ticket: null, tEvent: null, busy: false, transferLinks: {} }; // transferLinks: 이번 세션에 만든 양도 링크(좌석 코드 → {url, expires_at})

        // 소형 액션 버튼 헬퍼 — 대관 관리(_pbtn)·호스트 센터(_hbtn) 공용. color 는 의미 표시용:
        //   #EF4444 → danger(취소·삭제), #166534/#1E40AF → primary(확인·승인·체크인), 그 외 → secondary
        function _gaaBtn(label, onclick, color) {
            const v = color === '#EF4444' ? 'danger' : (color === '#166534' || color === '#1E40AF') ? 'primary' : 'secondary';
            return `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-${v}" onclick="${onclick}">${label}</button>`;
        }

        async function eventApi(payload) {
            let out = null;
            try {
                const res = await fetch('/event-api', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                out = await res.json().catch(() => null);
            } catch (_) {}
            return out || { ok: false, error: 'network', message: '서버와 통신하지 못했습니다. 잠시 후 다시 시도해주세요.' };
        }

        function showShowsSection(sub) {
            const subArr = Array.isArray(sub) ? sub : [];
            _pushNav('shows' + (subArr.length ? '/' + subArr.join('/') : ''));
            showSectionLoadingFromPortal(); // 포털에서 들어올 때만(뒤로가기·목록↔상세 이동엔 없음)
            document.body.classList.add('portal-view');
            document.body.classList.add('fullwidth-view');
            _hideAllScreens();
            document.getElementById('shows-page').classList.remove('hidden');
            if (!supabaseClient) {
                document.getElementById('shows-container').innerHTML =
                    '<p style="text-align:center;padding:40px;color:var(--wds-gray-500)">일시적인 오류입니다. 잠시 후 새로고침해주세요.</p>';
                return;
            }
            if (subArr[0] === 'ticket' && subArr[1]) {
                const code = String(subArr[1]).toUpperCase();
                // 예매 직후 이동이면 메모리의 티켓을 바로 표시, 새로고침 진입이면 전화번호 검증(조회 폼)
                if (_showsState.ticket && _showsState.ticket.code === code) renderTicketView();
                else renderTicketLookup(code);
                return;
            }
            if (subArr[0] === 'find') { renderTicketLookup(''); return; }
            if (subArr[0] === 'claim' && subArr[1]) { renderTransferClaim(String(subArr[1]).toUpperCase()); return; } // 티켓 양도받기(2026-10-20)
            if (subArr[0] && _UUID_RE.test(subArr[0])) { renderShowDetail(subArr[0].toLowerCase()); return; }
            renderShowsList();
        }

        function _showDateStr(iso) {
            const d = new Date(iso);
            if (isNaN(d)) return '';
            const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
            const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            return `${d.getMonth() + 1}/${d.getDate()}(${wd}) ${hm}`;
        }
        const _showChip = (label, bg, fg) => `<span class="show-chip" style="background:${bg};color:${fg}">${label}</span>`;

        // 잔여석 배지 — event_seats 조회 실패 시에도 목록이 뜨도록 소프트 처리
        function _seatInfo(ev) {
            const s = _showsState.seats[ev.id];
            const past = new Date(ev.starts_at) <= new Date();
            // cls = .cm-chip 변형(2026-10-16): closed/warn/ok/sold — 목록 카드·상세 눈썹 줄이 쓴다(bg/fg 는 호스트 센터 등 옛 _showChip 호환)
            if (past) return { label: '공연 종료', cls: 'closed', bg: 'var(--wds-gray-100)', fg: 'var(--wds-gray-500)', bookable: false, remaining: 0 };
            if (ev.status !== 'published') return { label: '예매 마감', cls: 'closed', bg: 'var(--wds-gray-100)', fg: 'var(--wds-gray-500)', bookable: false, remaining: 0 };
            if (ev.sales_open_at && new Date(ev.sales_open_at) > new Date()) {
                return { label: '오픈 예정', cls: 'warn', bg: '#FEF3C7', fg: '#92400E', bookable: false, remaining: null, opensAt: ev.sales_open_at };
            }
            if (!s) return { label: '예매 가능', cls: 'ok', bg: '#DCFCE7', fg: '#166534', bookable: true, remaining: null };
            const rem = Math.max(0, s.capacity - s.taken);
            if (rem <= 0) return { label: '매진', cls: 'sold', bg: '#FEE2E2', fg: '#991B1B', bookable: false, remaining: 0 };
            if (rem <= 10) return { label: `잔여 ${rem}석`, cls: 'warn', bg: '#FEF3C7', fg: '#92400E', bookable: true, remaining: rem };
            return { label: '예매 가능', cls: 'ok', bg: '#DCFCE7', fg: '#166534', bookable: true, remaining: rem };
        }
        const _sxChip = (label, cls) => `<span class="cm-chip ${cls || 'closed'}">${label}</span>`;
        function _showDateLong(iso) { // "10월 23일 (금) 19:30"
            const d = new Date(iso); if (isNaN(d)) return '';
            const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
            return `${d.getMonth() + 1}월 ${d.getDate()}일 (${wd}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
        function _sxSheetReset() { document.body.classList.remove('cm-sheet-open'); } // 예매 시트가 열린 채 화면이 바뀌어도 스크롤 잠금이 남지 않게

        async function fetchShows() {
            const { data, error } = await supabaseClient.from('events').select('*').order('starts_at', { ascending: true });
            if (error) throw error;
            _showsState.events = data || [];
            _showsState.seats = {};
            try {
                const { data: seats, error: se } = await supabaseClient.from('event_seats').select('*');
                if (!se && Array.isArray(seats)) seats.forEach(s => { _showsState.seats[s.event_id] = s; });
            } catch (_) { /* 잔여석은 부가 정보 */ }
        }

        // D-day 라벨 — 오늘/D-n (7일 이내만), 지났거나 멀면 null
        function _dday(iso) {
            const d = new Date(iso);
            if (isNaN(d)) return null;
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const day = new Date(d); day.setHours(0, 0, 0, 0);
            const diff = Math.round((day - today) / 86400e3);
            if (diff < 0 || diff > 7) return null;
            return diff === 0 ? '오늘 공연' : `D-${diff}`;
        }

        // 목록 카드(2026-10-16): 포스터 격자(두둥식)는 유지 — 칩은 포스터 위 왼쪽(D-day·잔여석), 글 상자는 일시 → 제목 → 팀·장소 → 가격. 지난·마감 공연은 흐리게
        function _showCardHTML(ev) {
            const seat = _seatInfo(ev);
            const poster = ev.poster_url ? `<img src="${escapeHtml(ev.poster_url)}" alt="" loading="lazy">` : '🎸';
            const priceStr = ev.price > 0 ? `₩${Number(ev.price).toLocaleString()}` : '무료';
            const dday = _dday(ev.starts_at);
            const go = `showShowsSection(['${jsStr(ev.id)}'])`;
            return `<div class="show-card${seat.cls === 'closed' ? ' closed' : ''}" role="button" tabindex="0" onclick="${go}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${go}}">
                <div class="show-poster">${poster}<div class="chips">${dday ? _sxChip(dday, 'd') : ''}${_sxChip(seat.label, seat.cls)}</div></div>
                <div class="show-card-body">
                    <div class="when">${_showDateStr(ev.starts_at)}</div>
                    <div class="show-card-title">${escapeHtml(ev.title)}</div>
                    <div class="show-card-meta"><b>${escapeHtml(ev.host_name || '')}</b><span class="venue">${escapeHtml(ev.venue)}</span></div>
                    <div class="show-card-price"><span>${priceStr}</span></div>
                </div>
            </div>`;
        }

        async function renderShowsList() {
            const c = document.getElementById('shows-container');
            c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wds-gray-500)">공연을 불러오는 중…</div>';
            try { await fetchShows(); } catch (e) {
                c.innerHTML = '<p style="text-align:center;padding:40px;color:var(--wds-gray-500)">공연 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
                return;
            }
            // 2026-10-16: 머리는 앱 바(내 티켓 조회 알약) — 본문은 알약 탭 → 한 줄 요약(+호스트 센터 링크) → 검색 → 포스터 격자
            _sxSheetReset();
            c.innerHTML = `<div id="showsListTabs"></div>
            <div class="sx-sub"><span id="showsSubCount"></span><span class="r"><span class="q">호스트이신가요?</span><button type="button" onclick="showHostSection()">호스트 센터</button></span></div>
            <div class="sx-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" class="perf-form-input" id="showSearch" placeholder="공연명 · 팀 · 장소 검색" value="${escapeHtml(_showsState.q || '')}"
                oninput="_showsState.q=this.value;_renderShowsListBody()"></div>
            <div id="showsListBody"></div>`;
            _renderShowsTabs();
            _renderShowsListBody();
        }

        // 다가오는/지난 공연 탭 — 검색 입력 밖에 두고 부분 재렌더 (포커스 보존)
        function _renderShowsTabs() {
            const el = document.getElementById('showsListTabs');
            if (!el) return;
            const now = new Date();
            const nUp = _showsState.events.filter(ev => new Date(ev.starts_at) > now).length;
            const nPast = _showsState.events.length - nUp;
            const cur = _showsState.listTab || 'upcoming';
            const tb = (key, label, n) => `<button type="button" class="${cur === key ? 'on' : ''}" onclick="_showsState.listTab='${key}';_renderShowsTabs();_renderShowsListBody()">${label}<b>${n || ''}</b></button>`;
            el.innerHTML = `<div class="cm-seg">${tb('upcoming', '다가오는 공연', nUp)}${tb('past', '지난 공연', nPast)}</div>`;
            const sub = document.getElementById('showsSubCount');
            if (sub) {
                const nBook = _showsState.events.filter(ev => _seatInfo(ev).bookable).length;
                sub.textContent = cur === 'upcoming' ? (nUp ? `다가오는 공연 ${nUp}개 · 예매 가능 ${nBook}개` : '예정된 공연이 없어요') : `지난 공연 ${nPast}개`;
            }
        }

        // 목록 본문만 재렌더 — 검색 입력의 포커스를 유지하기 위해 분리
        function _renderShowsListBody() {
            const el = document.getElementById('showsListBody');
            if (!el) return;
            const q = (_showsState.q || '').trim().toLowerCase();
            const match = (ev) => !q || [ev.title, ev.host_name, ev.venue].some(v => String(v || '').toLowerCase().includes(q));
            const now = new Date();
            const tab = _showsState.listTab || 'upcoming';
            let list = _showsState.events.filter(ev => (tab === 'past') === (new Date(ev.starts_at) <= now) && match(ev));
            if (tab === 'past') list = list.slice().reverse(); // 최근에 끝난 공연부터
            if (!list.length) {
                el.innerHTML = q
                    ? '<div class="cm-empty">검색 결과가 없습니다.</div>'
                    : (tab === 'past'
                        ? '<div class="cm-empty">지난 공연이 없습니다.</div>'
                        : `<div class="cm-empty">
                            <div style="font-size:2.2rem;margin-bottom:10px">🎸</div>
                            <div style="font-size:0.92rem;font-weight:700;color:var(--wds-gray-700)">아직 예정된 공연이 없어요</div>
                            <div style="font-size:0.8rem;margin-top:4px">곧 새로운 공연이 올라올 거예요!</div>
                        </div>`);
                return;
            }
            el.innerHTML = `<div class="show-grid">${list.map(_showCardHTML).join('')}</div>`;
        }

        // 공연 상세 공유 — 경로형 /show/<id> 를 공유한다. 카카오톡 등은 #해시를 버리고 크롤러가 해시 뒤를 못 보므로,
        // 서버 함수(functions/show/[id].js)가 이 경로에서 포스터·제목·일시를 OG 로 넣어 미리보기에 뜨게 하고 사람은 상세로 라우팅한다.
        async function shareShow(id) {
            const ev = (_showsState.event && _showsState.event.id === id) ? _showsState.event : (_showsState.events || []).find(e => e.id === id);
            const url = `${location.origin}/show/${id}`;
            // 링크만 넘긴다(2026-10-20) — title/text 를 주면 카톡 등이 그 글까지 메시지에 써 넣는다. 미리보기 카드는 /show/<id> 의 OG 가 만든다.
            if (navigator.share) {
                try { await navigator.share({ url }); return; }
                catch (e) { if (e && e.name === 'AbortError') return; /* 미지원·실패 → 복사 폴백 */ }
            }
            try {
                await navigator.clipboard.writeText(url);
                showToast('공연 링크가 복사되었습니다.');
            } catch (_) {
                prompt('아래 링크를 복사하세요', url);
            }
        }

        async function renderShowDetail(id) {
            const c = document.getElementById('shows-container');
            let ev = _showsState.events.find(e => e.id === id) || null;
            if (!ev) c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wds-gray-500)">불러오는 중…</div>';
            // 캐시가 있어도 항상 최신 행을 다시 읽는다 — 호스트가 방금 수정한 질문·가격·잔여석이
            // 목록 캐시 때문에 안 보이던 문제 방지 (실패 시에만 캐시 폴백)
            try {
                const { data, error } = await supabaseClient.from('events').select('*').eq('id', id).maybeSingle();
                if (error) throw error;
                if (data) {
                    ev = data;
                    const i = _showsState.events.findIndex(e => e.id === id);
                    if (i >= 0) _showsState.events[i] = data; // 목록 캐시도 갱신
                }
                if (!ev) throw new Error('not found');
                try {
                    const { data: s } = await supabaseClient.from('event_seats').select('*').eq('event_id', id).maybeSingle();
                    if (s) _showsState.seats[id] = s;
                } catch (_) {}
            } catch (_) {
                if (!ev) {
                    c.innerHTML = `<p style="text-align:center;padding:40px;color:var(--wds-gray-500)">공연을 찾을 수 없습니다.</p>
                        <p style="text-align:center"><button class="gaa-btn gaa-btn-secondary" onclick="showShowsSection()">← 공연 목록</button></p>`;
                    return;
                }
            }
            _showsState.event = ev;
            // 팀 프로필·공동 관리팀(공개 뷰) — 부가 정보라 실패해도 상세는 뜬다
            let hostProf = null, coTeams = [];
            try {
                const { data: hp } = await supabaseClient.from('event_host_profiles').select('*').eq('id', ev.host_id).maybeSingle();
                hostProf = hp || null;
            } catch (_) {}
            try {
                const { data: cts } = await supabaseClient.from('event_co_hosts_public').select('*').eq('event_id', ev.id);
                if (Array.isArray(cts)) coTeams = cts;
            } catch (_) {}
            const seat = _seatInfo(ev);
            const priceStr = ev.price > 0 ? `₩${Number(ev.price).toLocaleString()}` : '무료';
            const maxQty = Math.max(1, Math.min(ev.max_per_booking || 4, seat.remaining == null ? (ev.max_per_booking || 4) : seat.remaining));
            const descHtml = ev.description ? renderMarkdown(ev.description) : '';
            const hasCoords = ev.venue_lat != null && ev.venue_lng != null;
            const mapLink = hasCoords
                ? `https://map.kakao.com/link/map/${encodeURIComponent(ev.venue)},${ev.venue_lat},${ev.venue_lng}` : '';
            const snsUrl = hostProf && hostProf.sns ? (/^https?:\/\//i.test(hostProf.sns) ? hostProf.sns : 'https://' + hostProf.sns) : '';
            // ── 2026-10-16 커뮤니티 상세 골격: [‹ 공연 목록]·[공유] → 포스터(3:4, 데스크톱은 왼쪽) → 눈썹(D-day·잔여석 칩 + 일시) → 제목 → 장소 →
            //    요약 띠(가격·잔여석·예매 마감/오픈) → 줄(주최·장소·결제) → 주최 팀·오시는 길·공연 소개 → 아래 고정 바(가격 + [예매하기]) → 예매 시트(.cm-sheet, 입력 id 종전 그대로)
            _sxSheetReset();
            const dday = _dday(ev.starts_at);
            const seatRow = _showsState.seats[ev.id];
            const capStr = (seatRow && seatRow.capacity) || ev.capacity || 0;
            const remainStr = seat.remaining == null ? (seat.bookable ? '여유' : '-') : (seat.remaining > 0 ? `${seat.remaining}석${capStr ? ` <span class="of">/ ${capStr}</span>` : ''}` : '매진');
            const posterHtml = ev.poster_url ? `<img src="${escapeHtml(ev.poster_url)}" alt="공연 포스터">` : '🎸';
            const hostLogo = hostProf && hostProf.logo_url ? `<img class="sx-logo" src="${escapeHtml(hostProf.logo_url)}" alt="">` : `<span class="cm-av">${escapeHtml((ev.host_name || '?')[0])}</span>`;
            const hasBio = !!(hostProf && hostProf.bio);
            const venueRow = (ev.venue_address || mapLink)
                ? `<div class="r"><span class="k">장소</span><span class="v"><span class="txt">${escapeHtml(ev.venue)}${ev.venue_address ? `<span class="sub">${escapeHtml(ev.venue_address)}</span>` : ''}</span>${mapLink ? `<a class="lnk" href="${mapLink}" target="_blank" rel="noopener">지도</a>` : ''}</span></div>` : '';
            let html = `<div class="cm-top">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="showShowsSection()">‹ 공연 목록</button>
                    <div class="r"><button class="gaa-btn gaa-btn-sm gaa-btn-secondary" id="showShareBtn" onclick="shareShow('${ev.id}')">${_CM_ICON.share} 공유</button></div>
                </div>
                <div class="cm-hero sx-hero">
                    <div class="sx-poster">${posterHtml}</div>
                    <div>
                        <div class="cm-eyebrow">${dday ? _sxChip(dday, 'd') : ''}${_sxChip(seat.label, seat.cls)}<span>${_showDateLong(ev.starts_at)}</span></div>
                        <h1 class="cm-title">${escapeHtml(ev.title)}</h1>
                        <div class="cm-place">${_CM_ICON.pin} ${escapeHtml(ev.venue)}</div>
                        <div class="cm-stats">
                            <div><small>가격</small><b>${priceStr}</b></div>
                            <div><small>잔여석</small><b>${remainStr}</b></div>
                            <div><small>${seat.opensAt ? '예매 오픈' : '예매 마감'}</small><b>${seat.opensAt ? _showDateStr(seat.opensAt) : (seat.bookable ? '공연 시작 전' : seat.label)}</b></div>
                        </div>
                        <div class="cm-rows">
                            <div class="r"><span class="k">주최</span><span class="v">${hostLogo}<span class="txt">${escapeHtml(ev.host_name || '')}${coTeams.length ? `<span class="sub">with ${coTeams.map(t => escapeHtml(t.name)).join(', ')}</span>` : ''}</span>${snsUrl && !hasBio ? `<a class="lnk" href="${escapeHtml(snsUrl)}" target="_blank" rel="noopener">SNS</a>` : ''}</span></div>
                            ${venueRow}
                            ${ev.price > 0 ? `<div class="r"><span class="k">결제</span><span class="v"><span class="txt">계좌이체 · 1매 기준 · 입금 확인 후 확정</span></span></div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="cm-lower">`;
            if (hostProf && (hasBio || snsUrl)) html += `<div class="cm-sec"><h2>주최 팀</h2><div class="sx-host">${_teamLogoHTML(hostProf.logo_url, 44)}<div style="flex:1;min-width:0"><b>${escapeHtml(hostProf.name || ev.host_name || '')}</b>${hasBio ? `<div>${escapeHtml(hostProf.bio).replace(/\n/g, '<br>')}</div>` : ''}${snsUrl ? `<a href="${escapeHtml(snsUrl)}" target="_blank" rel="noopener">🔗 ${escapeHtml(String(hostProf.sns).replace(/^https?:\/\//i, ''))}</a>` : ''}</div></div></div>`;
            if (hasCoords) html += `<div class="cm-sec"><h2>오시는 길</h2><div id="showMap" style="height:200px;border-radius:14px;background:var(--wds-gray-100)"></div>
                <div style="font-size:0.8rem;margin-top:8px;display:flex;justify-content:space-between;gap:10px;color:var(--wds-gray-600)"><span style="white-space:pre-line">${escapeHtml(ev.venue_address || ev.venue)}</span><a href="${mapLink}" target="_blank" rel="noopener" style="color:var(--wds-primary);text-decoration:none;font-weight:700;flex:none">카카오맵에서 보기 →</a></div></div>`;
            if (descHtml) html += `<div class="cm-sec"><h2>공연 소개</h2><div class="cm-desc docs-card-content">${descHtml}</div></div>`;
            html += `<div class="cm-sec" id="showPosterProjects" hidden></div>`; // 연결된 포스터 꾸미기 프로젝트(2026-10-20) — 렌더 뒤 채움
            html += `</div>`; // .cm-lower
            if (seat.bookable) {
                const qtyOpts = Array.from({ length: maxQty }, (_, i) => `<option value="${i + 1}">${i + 1}매</option>`).join('');
                const ctaLabel = `예매하기${ev.price > 0 ? ` · ₩${Number(ev.price).toLocaleString()}/매` : ' · 무료'}`;
                html += `<div class="cm-sticky-pad"></div>
                <div class="cm-sticky"><div class="pr"><small>${ev.price > 0 ? '1매' : '참가비'}</small><b>${priceStr}</b></div><button type="button" class="gaa-btn gaa-btn-primary" id="showBookOpenBtn" onclick="openBookingSheet()">예매하기</button></div>
                <div id="bookSheetWrap" class="cm-sheet-wrap hidden" role="dialog" aria-modal="true" aria-label="예매하기">
                    <div class="cm-sheet-bg" onclick="closeBookingSheet()"></div>
                    <div class="cm-sheet">
                        <div class="cm-sheet-head"><span class="grab" aria-hidden="true"></span><h3>예매하기</h3><button type="button" class="cm-ib" onclick="closeBookingSheet()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
                        <div class="cm-sheet-body"><div class="cm-form">
                            <p>${escapeHtml(ev.title)} · ${_showDateStr(ev.starts_at)}</p>
                            ${ev.price > 0 ? `<div class="cm-note" style="margin-bottom:14px">계좌이체 예매 — 예매 후 안내되는 계좌로 입금하시면 호스트 확인 후 확정됩니다.</div>` : ''}
                            <div class="cm-f"><label>이름 <span class="req">*</span></label><input type="text" id="showName" placeholder="실명 입력"></div>
                            <div class="cm-f"><label>연락처 <span class="req">*</span></label><input type="tel" id="showPhone" placeholder="010-0000-0000"></div>
                            <div class="cm-f"><label>매수 <span class="req">*</span></label><select id="showQty" style="width:140px">${qtyOpts}</select></div>
                            ${_evQuestionsOf(ev).map((qq, i) => `<div class="cm-f"><label>${escapeHtml(qq.q)}${qq.required ? ' <span class="req">*</span>' : ''}</label><input type="text" id="showAnswer-${i}" maxlength="300" placeholder="답변 입력${qq.required ? '' : ' (선택)'}"></div>`).join('')}
                            <div class="cm-f">
                                <label class="cm-consent"><input type="checkbox" id="showPrivacyAgree" style="width:18px;height:18px;margin-top:1px;flex:none;cursor:pointer"> <span><b>[필수] 개인정보 수집·이용에 동의합니다.</b><small style="display:block;font-size:0.74rem;color:var(--wds-gray-600);margin-top:4px;line-height:1.6">· 수집 항목: 이름, 연락처 · 이용 목적: 공연 예매 확인 및 입장 관리<br>· 보유 기간: 공연 종료 후 1년 보관 후 파기 · 거부 시 예매가 제한됩니다.</small></span></label>
                            </div>
                            <div id="showsBookResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:2px 0;color:#e74c3c"></div>
                            <button class="gaa-btn gaa-btn-block gaa-btn-primary" id="showBookBtn" onclick="submitShowBooking('${jsStr(ev.id)}')">${ctaLabel}</button>
                        </div></div>
                    </div>
                </div>`;
            } else {
                html += `<div class="cm-sticky-pad"></div><div class="cm-sticky"><div class="pr"><small>${seat.opensAt ? '예매 오픈' : '예매 상태'}</small><b>${seat.opensAt ? _showDateStr(seat.opensAt) : seat.label}</b></div><button type="button" class="gaa-btn gaa-btn-primary" disabled>${seat.opensAt ? '오픈 예정' : seat.label}</button></div>`;
            }
            c.innerHTML = html;
            window.scrollTo({ top: 0, behavior: 'instant' });
            if (hasCoords) _renderShowMap(ev);
            _renderShowPosterProjects(ev.id);
        }
        // 포스터 꾸미기 연결(2026-10-20): 이 공연에 연결된 프로젝트(wappen_projects.event_id, anon 읽기)가 있으면 상세 아래에 — 없거나 실패(마이그레이션 전)면 숨긴 채
        async function _renderShowPosterProjects(eventId) {
            try {
                const { data } = await supabaseClient.from('wappen_projects').select('id,title,thumb_url,base_image_url,works_count,author_name').eq('status', 'active').eq('event_id', eventId).limit(6);
                const rows = (data || []).filter(p => p && p.id && p.title);
                const el = document.getElementById('showPosterProjects'); if (!el || !rows.length) return;
                el.hidden = false;
                el.innerHTML = `<h2>포스터 꾸미기</h2><div class="sx-wp">${rows.map(p => `<a class="sx-wp-card" href="/wappen/#/project/${p.id}">
                        <img src="${escapeHtml(p.thumb_url || p.base_image_url || '')}" alt="" loading="lazy"><b>${escapeHtml(p.title)}</b><small>작품 ${p.works_count || 0}개${p.author_name ? ' · ' + escapeHtml(p.author_name) : ''}</small></a>`).join('')}</div>
                    <div class="sx-note" style="margin-top:6px">이 공연 포스터에 와펜을 붙여 나만의 포스터를 만들 수 있어요.</div>`;
            } catch (_) { /* 선택 기능 — 조용히 생략 */ }
        }

        // 예매 작성 바텀시트 열기/닫기
        function openBookingSheet() {
            const el = document.getElementById('bookSheetWrap');
            if (!el) return;
            el.classList.remove('hidden'); document.body.classList.add('cm-sheet-open');
            requestAnimationFrame(() => el.classList.add('on'));
            const res = document.getElementById('showsBookResult');
            if (res) res.textContent = '';
            el._esc = (e) => { if (e.key === 'Escape') closeBookingSheet(); };
            document.addEventListener('keydown', el._esc);
            if (window.matchMedia && matchMedia('(hover:hover)').matches) setTimeout(() => document.getElementById('showName')?.focus({ preventScroll: true }), 250); // 터치 기기는 키보드가 바로 올라오지 않게
        }
        function closeBookingSheet() {
            const el = document.getElementById('bookSheetWrap');
            document.body.classList.remove('cm-sheet-open');
            if (!el) return;
            if (el._esc) { document.removeEventListener('keydown', el._esc); el._esc = null; }
            el.classList.remove('on'); el.classList.add('hidden');
        }

        // 상세 페이지 지도 — SDK 로드 실패 시 지도 영역만 숨김(카카오맵 링크는 항상 동작)
        async function _renderShowMap(ev) {
            if (!document.getElementById('showMap')) return;
            const kk = await loadKakaoMaps();
            const el = document.getElementById('showMap'); // 로드 대기 중 화면 전환 대비 재조회
            if (!el) return;
            if (!kk || !kk.maps || !kk.maps.Map) { el.style.display = 'none'; return; }
            try {
                const pos = new kk.maps.LatLng(ev.venue_lat, ev.venue_lng);
                const map = new kk.maps.Map(el, { center: pos, level: 4, draggable: false, scrollwheel: false, disableDoubleClickZoom: true });
                new kk.maps.Marker({ map, position: pos });
            } catch (_) { el.style.display = 'none'; }
        }

        async function submitShowBooking(eventId) {
            const res = document.getElementById('showsBookResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (_showsState.busy) return;
            const name = document.getElementById('showName')?.value.trim();
            const phone = document.getElementById('showPhone')?.value.trim();
            const qty = parseInt(document.getElementById('showQty')?.value, 10) || 1;
            if (!name) { showErr('이름을 입력해주세요.'); return; }
            if (!/^01[016789][0-9]{7,8}$/.test((phone || '').replace(/\D/g, ''))) { showErr('휴대폰 번호를 확인해주세요.'); return; }
            if (!document.getElementById('showPrivacyAgree')?.checked) { showErr('개인정보 수집·이용에 동의해주세요.'); return; }
            // 호스트 질문 답변 수집 — 문답 쌍으로 저장 (질문이 나중에 바뀌어도 당시 문답 보존)
            const evQs = _evQuestionsOf(_showsState.event || {});
            const answers = evQs.map((qq, i) => ({ q: qq.q, a: document.getElementById('showAnswer-' + i)?.value.trim() || '' }));
            for (let i = 0; i < evQs.length; i++) {
                if (evQs[i].required && !answers[i].a) { showErr(`'${evQs[i].q}' 질문에 답변을 입력해주세요.`); return; }
            }
            const btn = document.getElementById('showBookBtn');
            _showsState.busy = true;
            if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
            try {
                const out = await eventApi({ action: 'book', event_id: eventId, name, phone, qty,
                    ...(answers.some(x => x.a) ? { answers } : {}) });
                if (!out.ok) { showErr(out.message || '예매에 실패했습니다.'); return; }
                _showsState.ticket = { ...out.ticket, seats: out.seats || [], transfers: out.transfers || [] };
                _showsState.tEvent = out.event;
                renderTicketView();
                _pushNav('shows/ticket/' + out.ticket.code);
            } finally {
                _showsState.busy = false;
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            }
        }

        function _ticketChip(t) {
            if (t.status === 'cancelled') return _showChip('취소됨', '#FEE2E2', '#991B1B');
            if (t.checked_in_at) return _showChip('입장 완료', '#DBEAFE', '#1E40AF');
            if (t.status === 'confirmed') return _showChip('예매 확정', '#DCFCE7', '#166534');
            return _showChip('입금 확인 중', '#FEF3C7', '#92400E');
        }

        function renderTicketView() {
            const c = document.getElementById('shows-container');
            _sxSheetReset();
            const t = _showsState.ticket, ev = _showsState.tEvent;
            if (!t || !ev) { renderTicketLookup(''); return; }
            const cancellable = (t.status === 'pending_payment' || t.status === 'confirmed')
                && !t.checked_in_at && new Date(ev.starts_at) > new Date() && !_ticketTransferred(t); // 양도받은 티켓은 직접 취소 불가(2026-10-20)
            const amount = (ev.price || 0) * (t.qty || 1);
            let html = `
                <div class="ticket-box">
                    <div style="margin-bottom:10px">${_ticketChip(t)}</div>
                    ${t.transferred_from_name ? `<div style="font-size:0.8rem;color:#6B4FD8;font-weight:700;margin:-4px 0 8px;line-height:1.5">🎁 ${escapeHtml(t.transferred_from_name)}님에게서 양도받은 티켓이에요 · 취소·환불은 호스트에게 문의</div>` : ''}
                    <div style="font-size:1.05rem;font-weight:800;color:var(--wds-black);margin-bottom:4px">${escapeHtml(ev.title)}</div>
                    <div style="font-size:0.82rem;color:var(--wds-gray-700);line-height:1.7;margin-bottom:14px">
                        ${escapeHtml(ev.host_name || '')} · 📍 ${escapeHtml(ev.venue)}<br>
                        📅 ${_showDateStr(ev.starts_at)}
                    </div>
                    ${_ticketSeatBlocks(t)}
                    <div style="font-size:0.82rem;color:var(--wds-gray-700);margin-top:8px">${escapeHtml(t.buyer_name)} · ${t.qty}매${amount > 0 ? ` · ₩${amount.toLocaleString()}` : ''}</div>
                </div>`;
            if (t.status === 'pending_payment') {
                html += `
                <div style="background:#FEF3C7;color:#92400E;border-radius:12px;padding:14px 16px;margin-top:14px;font-size:0.84rem;line-height:1.7">
                    <div style="font-weight:800;margin-bottom:6px">입금 안내</div>
                    입금 금액: <strong>₩${amount.toLocaleString()}</strong><br>
                    입금 계좌: <strong id="ticketBankInfo">${escapeHtml(ev.bank_info || '호스트에게 문의')}</strong>
                    ${ev.bank_info ? `<button onclick="copyBankInfo()" style="margin-left:6px;padding:3px 10px;border-radius:6px;border:1px solid #92400E;background:none;color:#92400E;cursor:pointer;font-size:0.74rem;font-weight:700;font-family:inherit">복사</button>` : ''}<br>
                    입금자명은 <strong>예매자 이름(${escapeHtml(t.buyer_name)})</strong>과 동일하게 해주세요.<br>
                    호스트가 입금을 확인하면 <strong>예매 확정</strong>으로 바뀝니다.
                </div>`;
            }
            html += `
                <div style="font-size:0.78rem;color:var(--wds-gray-500);text-align:center;margin-top:14px;line-height:1.6">
                    이 화면을 캡처하거나 예매번호를 저장해주세요.<br>공연 입장 시 QR 또는 예매번호를 제시하시면 됩니다.<br>
                    "내 티켓 조회"에서 예매번호+전화번호로 언제든 다시 볼 수 있습니다.
                </div>
                <div style="display:flex;gap:8px;margin-top:18px">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" onclick="showShowsSection()">공연 목록</button>
                    ${cancellable ? `<button class="gaa-btn gaa-btn-sm gaa-btn-danger" style="flex:1" onclick="cancelMyTicket()">예매 취소</button>` : ''}
                </div>`;
            c.innerHTML = html;
            // QR 렌더 — 라이브러리 미로드 시 예매번호 텍스트로 충분(저장 버튼도 숨김 유지)
            _ticketSeats(t).forEach(s => {
                if (typeof renderTicketQR === 'function') renderTicketQR(document.getElementById('ticketQrSlot-' + s.seat_no), s.code);
            });
            if (typeof qrcode !== 'undefined') {
                document.querySelectorAll('#shows-container .qr-save-btn').forEach(b => { b.style.display = 'inline-block'; });
            }
        }

        // 매수별 QR — 좌석 목록 (구버전 응답엔 seats가 없으므로 예매번호 1장으로 폴백)
        function _ticketSeats(t) {
            return (t.seats && t.seats.length) ? t.seats : [{ code: t.code, seat_no: 1, checked_in_at: t.checked_in_at }];
        }

        function _ticketTransferred(t) { return !!(t && (t.transferred_from_name || _ticketSeats(t).some(s => !s.cancelled_at && s.transferred_from_name))); }
        function _ticketSeatBlocks(t) {
            const ev = _showsState.tEvent;
            const seats = _ticketSeats(t);
            const active = seats.filter(s => !s.cancelled_at);
            // 양도 현황(2026-10-20): pending = 링크 대기(좌석은 아직 내 것), claimed = 받는 사람 티켓으로 옮겨짐(좌석 목록엔 없음 → 아래에 「양도 완료」 블록)
            const transfers = t.transfers || [];
            const claimed = transfers.filter(x => x.status === 'claimed');
            const pendingBy = {}; transfers.forEach(x => { if (x.status === 'pending') pendingBy[x.seat_code] = x; });
            const multi = seats.length + claimed.length > 1;
            const upcoming = !!(ev && new Date(ev.starts_at) > new Date());
            // 좌석 부분 취소 가능 조건 — 공연 시작 전 + 예매가 살아있고 + 그 좌석 미입장·미취소 + 2장 이상
            const seatCancelable = multi && active.length > 1
                && (t.status === 'pending_payment' || t.status === 'confirmed') && upcoming;
            const transferable = t.status === 'confirmed' && upcoming; // 양도 규칙: 입금 확정 뒤·공연 전(미입장·미취소는 좌석별로)
            const note = multi ? `<div style="font-size:0.78rem;color:var(--wds-primary);font-weight:700;margin-bottom:4px">티켓 ${active.length}장 — 동행인에게 한 장씩 전달하세요. QR 1개당 1명 입장합니다.</div>` : '';
            const blocks = seats.map((s, i) => {
                if (s.cancelled_at) {
                    return `<div style="${i ? 'border-top:1px dashed var(--wds-gray-300);margin-top:14px;padding-top:12px' : ''};opacity:0.5">
                        <div style="font-size:0.78rem;color:var(--wds-gray-500)">티켓 ${s.seat_no} · <span style="color:#991B1B;font-weight:700">취소됨</span></div>
                        <div class="ticket-code" style="text-decoration:line-through">${escapeHtml(s.code)}</div>
                    </div>`;
                }
                const pend = pendingBy[s.code];
                const link = _showsState.transferLinks[s.code];
                const pendHtml = pend ? `<div class="tk-pend">양도 대기 중 · 링크 만료 ${_showDateStr(pend.expires_at)}<small>받는 분이 수락하면 이 QR은 무효가 되고 새 QR이 발급돼요.</small>
                        <div class="btns">${link ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-primary" onclick="shareTransferLink('${jsStr(s.code)}')">링크 다시 공유</button>` : ''}<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="cancelTransferLink('${jsStr(s.code)}')">링크 취소</button></div></div>` : '';
                return `
                <div style="${i ? 'border-top:1px dashed var(--wds-gray-300);margin-top:14px;padding-top:12px' : ''}">
                    <div style="font-size:0.78rem;color:var(--wds-gray-500)">${multi ? `티켓 ${s.seat_no}` : '예매번호'}${s.checked_in_at ? ' · <span style="color:#1E40AF;font-weight:700">입장 완료</span>' : ''}${pend ? ' · <span style="color:#6B4FD8;font-weight:700">양도 대기 중</span>' : ''}</div>
                    ${s.transferred_from_name && !t.transferred_from_name ? `<div style="font-size:0.74rem;color:#6B4FD8;font-weight:700;margin-top:2px">🎁 ${escapeHtml(s.transferred_from_name)}님에게서 양도받음</div>` : ''}
                    <div class="ticket-code">${escapeHtml(s.code)}</div>
                    <div id="ticketQrSlot-${s.seat_no}"></div>
                    ${pendHtml}
                    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
                        <button class="qr-save-btn" onclick="downloadTicketQR('${jsStr(s.code)}')" style="display:none;margin-top:2px;padding:7px 14px;border-radius:8px;border:1px solid var(--wds-gray-300);background:none;color:var(--wds-gray-700);cursor:pointer;font-size:0.78rem;font-weight:600;font-family:inherit">QR 이미지 저장</button>
                        ${transferable && !s.checked_in_at && !pend ? `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="margin-top:2px" onclick="openTransferSheet('${jsStr(s.code)}',${s.seat_no})">양도</button>` : ''}
                        ${seatCancelable && !s.checked_in_at && !s.transferred_from_name ? `<button class="gaa-btn gaa-btn-xs gaa-btn-danger" style="margin-top:2px" onclick="cancelMySeat('${jsStr(s.code)}',${s.seat_no})">이 티켓만 취소</button>` : ''}
                    </div>
                </div>`;
            });
            claimed.forEach(x => blocks.push(`
                <div style="border-top:1px dashed var(--wds-gray-300);margin-top:14px;padding-top:12px;opacity:0.65">
                    <div style="font-size:0.78rem;color:var(--wds-gray-500)">티켓 ${x.seat_no} · <span style="color:#6B4FD8;font-weight:700">양도 완료 → ${escapeHtml(x.to_name || '')}</span>${x.claimed_at ? ` · ${_showDateStr(x.claimed_at)}` : ''}</div>
                    <div style="font-size:0.78rem;color:var(--wds-gray-500);margin-top:4px;line-height:1.5">받는 분의 티켓으로 옮겨졌어요. 이 자리의 예전 QR은 더 이상 쓸 수 없어요.</div>
                </div>`));
            return note + blocks.join('');
        }

        // ── 티켓 양도(링크 방식, 2026-10-20): 좌석 1장 → 48시간 1회용 링크(서버 create_transfer) → 받는 사람이 #shows/claim/<토큰> 에서 이름·연락처 입력(claim_transfer)
        //    → 그 사람 명의 예매로 분리·통째 변경·합치기(서버 규칙). 링크 평문은 서버에 없어 이 세션의 _showsState.transferLinks 에만 두고, 잃으면 취소 후 새로 만든다.
        function openTransferSheet(seatCode, seatNo) {
            const t = _showsState.ticket, ev = _showsState.tEvent; if (!t || !ev) return;
            gtSheetOpen('티켓 양도', `<div id="transferSheetBody">
                <div class="cm-note" style="margin-bottom:12px"><b>${escapeHtml(ev.title)} · 티켓 ${seatNo}</b>${_showDateStr(ev.starts_at)} · ${escapeHtml(ev.venue || '')}</div>
                <ul style="margin:0 0 14px;padding-left:18px;font-size:0.86rem;line-height:1.8;color:var(--wds-gray-800)">
                    <li>양도 링크는 <b>48시간</b> 동안 <b>한 사람만</b> 받을 수 있어요.</li>
                    <li>받는 분이 링크에서 이름·연락처를 입력하면 양도가 끝나고, 이 티켓의 QR은 새로 발급돼요(지금 QR은 무효).</li>
                    <li>받는 분은 자기 예매번호+전화번호로 티켓을 조회해요. 양도받은 티켓은 받는 분이 직접 취소할 수 없고, 환불은 호스트와 상의해요.</li>
                </ul>
                <div id="transferResult" style="font-size:0.84rem;text-align:center;min-height:20px;color:#e74c3c"></div>
                <button type="button" class="gaa-btn gaa-btn-block gaa-btn-primary" id="transferMakeBtn" onclick="createTransferLink('${jsStr(seatCode)}',${seatNo})">양도 링크 만들기</button>
            </div>`);
        }
        async function createTransferLink(seatCode, seatNo) {
            const t = _showsState.ticket; if (!t) return;
            const btn = document.getElementById('transferMakeBtn'); if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
            const out = await eventApi({ action: 'create_transfer', code: t.code, phone: t.buyer_phone, seat_code: seatCode });
            if (!out.ok) {
                const r = document.getElementById('transferResult'); if (r) r.textContent = out.message || '양도 링크를 만들지 못했습니다.';
                if (btn) { btn.disabled = false; btn.textContent = '양도 링크 만들기'; }
                return;
            }
            const url = `${location.origin}/shows/claim/${out.token}`; // 경로형 — 카톡으로 보내도 #해시가 안 깎이게(2026-11-05)
            _showsState.transferLinks[seatCode] = { url, expires_at: out.expires_at };
            t.transfers = Array.isArray(out.transfers) && out.transfers.length ? out.transfers
                : [...(t.transfers || []).filter(x => !(x.seat_code === seatCode && x.status === 'pending')), { seat_code: seatCode, seat_no: seatNo, status: 'pending', expires_at: out.expires_at }];
            renderTicketView(); // 뒤의 티켓 화면에 「양도 대기 중」
            const body = document.getElementById('transferSheetBody');
            if (body) body.innerHTML = `<div class="cm-note" style="margin-bottom:12px;text-align:center"><b>양도 링크가 준비됐어요</b><span id="transferUrl" style="display:block;word-break:break-all;font-size:0.8rem;color:var(--wds-gray-700);margin-top:6px">${escapeHtml(url)}</span></div>
                <div style="font-size:0.8rem;color:var(--wds-gray-600);text-align:center;margin-bottom:12px">만료 ${_showDateStr(out.expires_at)} · 받는 분께 카카오톡 등으로 보내주세요</div>
                <button type="button" class="gaa-btn gaa-btn-block gaa-btn-primary" onclick="shareTransferLink('${jsStr(seatCode)}')">링크 공유하기</button>
                <button type="button" class="gaa-btn gaa-btn-block gaa-btn-secondary" style="margin-top:8px" onclick="copyTransferLink('${jsStr(seatCode)}')">링크 복사</button>
                <button type="button" class="gaa-btn gaa-btn-block gaa-btn-ghost" style="margin-top:8px" onclick="gtSheetClose()">닫기</button>`;
        }
        async function shareTransferLink(seatCode) {
            const l = _showsState.transferLinks[seatCode]; if (!l) return;
            if (navigator.share) {
                try { await navigator.share({ url: l.url }); return; }
                catch (e) { if (e && e.name === 'AbortError') return; }
            }
            copyTransferLink(seatCode);
        }
        async function copyTransferLink(seatCode) {
            const l = _showsState.transferLinks[seatCode]; if (!l) return;
            try { await navigator.clipboard.writeText(l.url); showToast('양도 링크가 복사되었습니다.'); }
            catch (_) { prompt('아래 링크를 복사하세요', l.url); }
        }
        async function cancelTransferLink(seatCode) {
            const t = _showsState.ticket; if (!t) return;
            if (!confirm('양도 링크를 취소할까요? 받는 분은 더 이상 이 링크로 받을 수 없어요.')) return;
            const out = await eventApi({ action: 'cancel_transfer', code: t.code, phone: t.buyer_phone, seat_code: seatCode });
            if (!out.ok) { showToast(out.message || '취소하지 못했습니다.'); return; }
            delete _showsState.transferLinks[seatCode];
            t.transfers = Array.isArray(out.transfers) ? out.transfers : (t.transfers || []).filter(x => !(x.seat_code === seatCode && x.status === 'pending'));
            renderTicketView(); showToast('양도 링크를 취소했습니다.');
        }
        // 받는 사람 화면(#shows/claim/<토큰>): 공연·좌석 확인 → 이름·연락처·동의 → [양도받기] → 내 티켓 화면
        async function renderTransferClaim(token) {
            const c = document.getElementById('shows-container');
            _sxSheetReset();
            c.innerHTML = '<div class="cm-empty">양도 정보를 확인하는 중…</div>';
            const out = await eventApi({ action: 'transfer_info', token });
            const back = `<div class="cm-top"><button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="showShowsSection()">‹ 공연 목록</button></div>`;
            if (!out.ok) { c.innerHTML = back + `<div class="cm-empty">${escapeHtml(out.message || '유효하지 않은 양도 링크입니다.')}</div>`; return; }
            const ev = out.event || {};
            if (out.status !== 'pending') {
                const msg = { claimed: '이미 양도가 완료된 링크예요.', cancelled: '양도하는 분이 링크를 취소했어요.', expired: '링크가 만료됐어요(48시간). 양도하는 분께 새 링크를 요청해주세요.',
                    unavailable: '이 티켓은 더 이상 양도할 수 없는 상태예요(취소·입장 등).', started: '공연이 이미 시작되어 양도할 수 없어요.' }[out.status] || '유효하지 않은 양도 링크입니다.';
                c.innerHTML = back + `<div class="cm-empty"><div style="font-size:2rem;margin-bottom:8px">🎫</div><div style="font-weight:700;color:var(--wds-gray-700)">${escapeHtml(ev.title || '')}</div><div style="margin-top:6px">${msg}</div></div>`;
                return;
            }
            c.innerHTML = back + `<div class="cm-form">
                <h3>티켓 양도받기</h3>
                <p><b>${escapeHtml(out.from_name || '')}</b>님이 <b>${escapeHtml(ev.title || '')}</b> 티켓 1장(티켓 ${out.seat_no})을 양도합니다.</p>
                <div class="cm-stats" style="margin-bottom:14px">
                    <div><small>일시</small><b>${_showDateStr(ev.starts_at)}</b></div>
                    <div><small>장소</small><b style="white-space:normal">${escapeHtml(ev.venue || '')}</b></div>
                    <div><small>가격</small><b>${ev.price > 0 ? '₩' + Number(ev.price).toLocaleString() : '무료'}</b></div>
                </div>
                <div class="cm-note" style="margin-bottom:14px">받으면 내 이름으로 된 예매번호와 QR이 새로 발급돼요. 이후 「내 티켓 조회」에서 예매번호+전화번호로 볼 수 있어요. 양도받은 티켓은 직접 취소할 수 없고, 환불·변경은 호스트와 상의해주세요.</div>
                <div class="cm-f"><label>이름 <span class="req">*</span></label><input type="text" id="claimName" placeholder="실명 입력" maxlength="40"></div>
                <div class="cm-f"><label>연락처 <span class="req">*</span></label><input type="tel" id="claimPhone" placeholder="010-0000-0000"></div>
                <div class="cm-f">
                    <label class="cm-consent"><input type="checkbox" id="claimPrivacyAgree" style="width:18px;height:18px;margin-top:1px;flex:none;cursor:pointer"> <span><b>[필수] 개인정보 수집·이용에 동의합니다.</b><small style="display:block;font-size:0.74rem;color:var(--wds-gray-600);margin-top:4px;line-height:1.6">· 수집 항목: 이름, 연락처 · 이용 목적: 공연 입장 확인 및 안내<br>· 보유 기간: 공연 종료 후 1년 보관 후 파기 · 거부 시 양도를 받을 수 없습니다.</small></span></label>
                </div>
                <div id="claimResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:2px 0;color:#e74c3c"></div>
                <div style="font-size:0.76rem;color:var(--wds-gray-500);text-align:center;margin-bottom:8px">링크 만료 ${_showDateStr(out.expires_at)}</div>
                <button class="gaa-btn gaa-btn-block gaa-btn-primary" id="claimBtn" onclick="claimTransfer('${jsStr(token)}')">양도받기</button>
            </div>`;
        }
        async function claimTransfer(token) {
            const res = document.getElementById('claimResult');
            const showErr = (m) => { if (res) res.textContent = m; };
            if (res) res.textContent = '';
            const name = (document.getElementById('claimName')?.value || '').trim();
            const phone = document.getElementById('claimPhone')?.value || '';
            if (!name) { showErr('이름을 입력해주세요.'); return; }
            if (!/^01[016789][0-9]{7,8}$/.test(phone.replace(/\D/g, ''))) { showErr('휴대폰 번호를 확인해주세요.'); return; }
            if (!document.getElementById('claimPrivacyAgree')?.checked) { showErr('개인정보 수집·이용에 동의해주세요.'); return; }
            const btn = document.getElementById('claimBtn'); if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }
            const out = await eventApi({ action: 'claim_transfer', token, name, phone });
            if (!out.ok) { showErr(out.message || '양도를 받지 못했습니다.'); if (btn) { btn.disabled = false; btn.textContent = '양도받기'; } return; }
            _showsState.ticket = { ...out.ticket, seats: out.seats || [], transfers: out.transfers || [] };
            _showsState.tEvent = out.event;
            renderTicketView();
            _pushNav('shows/ticket/' + out.ticket.code);
            showToast('티켓을 양도받았어요. 예매번호를 꼭 저장해주세요.');
        }

        // 티켓 1장(좌석) 부분 취소 — 예: 3장 중 1장만
        async function cancelMySeat(code, seatNo) {
            const t = _showsState.ticket;
            if (!t) return;
            if (!confirm(`티켓 ${seatNo}번 1장만 취소할까요?`
                + (t.status === 'confirmed' ? '\n(이미 입금하셨다면 차액 환불은 호스트에게 문의해주세요.)' : ''))) return;
            const out = await eventApi({ action: 'cancel_seat', code, phone: t.buyer_phone });
            if (!out.ok) { showToast(out.message || '취소에 실패했습니다.'); return; }
            _showsState.ticket = { ..._showsState.ticket, ...out.ticket, seats: out.seats || [] };
            renderTicketView();
            showToast(out.whole ? '예매가 취소되었습니다.' : `티켓 ${seatNo}번이 취소되었습니다.`);
        }

        // 예매 QR을 PNG 이미지로 저장 — 캔버스에 직접 그려서(외부 이미지 없음 → taint 없음) 다운로드
        function downloadTicketQR(code) {
            if (typeof qrcode === 'undefined') return;
            try {
                const qr = qrcode(0, 'M');
                qr.addData(location.origin + '/host/checkin/' + code);
                qr.make();
                const n = qr.getModuleCount();
                const cell = 10, margin = 40, size = n * cell + margin * 2;
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size + 70;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#111111';
                for (let r = 0; r < n; r++) for (let col = 0; col < n; col++)
                    if (qr.isDark(r, col)) ctx.fillRect(margin + col * cell, margin + r * cell, cell, cell);
                ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(code, size / 2, size + 42);
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = 'ticket-' + code + '.png';
                document.body.appendChild(a); a.click(); a.remove();
                showToast('QR 이미지가 저장되었습니다.');
            } catch (_) { showToast('이미지 저장에 실패했습니다. 이 화면을 캡처해주세요.'); }
        }

        function copyBankInfo() {
            const txt = document.getElementById('ticketBankInfo')?.textContent || '';
            if (!txt) return;
            const done = () => showToast('계좌 정보가 복사되었습니다.');
            if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done).catch(() => showToast('복사에 실패했습니다. 길게 눌러 복사해주세요.'));
            else showToast('복사에 실패했습니다. 길게 눌러 복사해주세요.');
        }

        async function cancelMyTicket() {
            const t = _showsState.ticket;
            if (!t) return;
            if (!confirm(`예매를 ${(t.qty || 1) > 1 ? `전체(${t.qty}장) ` : ''}취소하시겠습니까?` + (t.status === 'pending_payment' ? '' : '\n(이미 입금하셨다면 호스트에게 환불을 문의해주세요.)'))) return;
            const out = await eventApi({ action: 'cancel', code: t.code, phone: t.buyer_phone });
            if (!out.ok) { showToast(out.message || '취소에 실패했습니다.'); return; }
            _showsState.ticket = { ..._showsState.ticket, ...out.ticket };
            renderTicketView();
            showToast('예매가 취소되었습니다.');
        }

        function renderTicketLookup(prefillCode) {
            const c = document.getElementById('shows-container');
            _sxSheetReset();
            c.innerHTML = `
                <div class="cm-top"><button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="showShowsSection()">‹ 공연 목록</button></div>
                <div class="cm-form">
                    <h3>내 티켓 조회</h3>
                    <p>예매 시 발급된 <strong>예매번호(6자리)</strong>와 <strong>전화번호</strong>를 입력해주세요.</p>
                    <div class="cm-f"><label>예매번호</label><input type="text" id="findCode" maxlength="6" placeholder="예: AB3XKP" value="${escapeHtml(prefillCode || '')}" style="text-transform:uppercase;letter-spacing:0.2em;font-weight:700" autocomplete="off"></div>
                    <div class="cm-f"><label>연락처</label><input type="tel" id="findPhone" placeholder="010-0000-0000"></div>
                    <div id="showsFindResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:2px 0;color:#e74c3c"></div>
                    <button class="gaa-btn gaa-btn-block gaa-btn-primary" onclick="lookupTicket()">조회하기</button>
                </div>`;
        }

        async function lookupTicket() {
            const res = document.getElementById('showsFindResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const code = (document.getElementById('findCode')?.value || '').trim().toUpperCase();
            const phone = document.getElementById('findPhone')?.value || '';
            if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) { showErr('예매번호 6자리를 확인해주세요.'); return; }
            if (!/^01[016789][0-9]{7,8}$/.test(phone.replace(/\D/g, ''))) { showErr('휴대폰 번호를 확인해주세요.'); return; }
            const out = await eventApi({ action: 'lookup', code, phone });
            if (!out.ok) { showErr(out.message || '조회에 실패했습니다.'); return; }
            _showsState.ticket = { ...out.ticket, seats: out.seats || [], transfers: out.transfers || [] };
            _showsState.tEvent = out.event;
            renderTicketView();
            _pushNav('shows/ticket/' + out.ticket.code);
        }

        // 티켓 QR — 체크인 딥링크(/host/checkin/CODE = #host/checkin/CODE, 2026-11-05 경로형)를 인코딩. 예전 해시형 QR 도 그대로 동작. 호스트가 폰 기본 카메라로
        // 스캔하면 사이트가 열리고 로그인 상태면 원탭 체크인된다. 라이브러리 미로드 시
        // 예매번호 텍스트가 이미 표시돼 있으므로 조용히 생략.
        function renderTicketQR(el, code) {
            if (!el) return;
            if (typeof qrcode === 'undefined') { el.innerHTML = ''; return; }
            try {
                const qr = qrcode(0, 'M');
                qr.addData(location.origin + '/host/checkin/' + code);
                qr.make();
                el.innerHTML = '<div class="qr-frame">' + qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) + '</div>';
            } catch (_) { el.innerHTML = ''; }
        }

        // ═══════════════ 호스트 센터 (host) ═══════════════
        // 게더링 멤버십(state.user/loginUI)과 완전 분리 — 카카오 라이브 토큰만 신뢰하고
        // 모든 판단은 서버(host_me 등, kapi 검증)가 한다. localStorage 자체 신뢰 금지.
        let _hostState = { token: null, teams: [], curTeamId: null, isAdmin: false, curEventId: null,
                           attendees: [], attEvent: null, attQuery: '', pendingCheckin: null, pendingJoin: null,
                           posterUrl: '', busy: false };
        const _curTeam = () => (_hostState.teams || []).find(t => t.id === _hostState.curTeamId) || null;

        function showHostSection(sub) {
            const subArr = Array.isArray(sub) ? sub : [];
            _pushNav('host' + (subArr.length ? '/' + subArr.join('/') : ''));
            document.body.classList.add('portal-view');
            document.body.classList.add('fullwidth-view');
            _hideAllScreens();
            document.getElementById('host-page').classList.remove('hidden');
            _hostState.curEventId = null; // 이전 화면의 명단 컨텍스트가 새 진입을 가로채지 않도록 초기화
            if (subArr[0] === 'checkin' && subArr[1]) {
                _hostState.pendingCheckin = String(subArr[1]).toUpperCase();
            } else if (subArr[0] === 'join' && subArr[1]) {
                _hostState.pendingJoin = String(subArr[1]).toUpperCase();
            } else if (subArr[0] === 'eventjoin' && subArr[1]) {
                _hostState.pendingEventJoin = String(subArr[1]).toUpperCase();
            } else if (subArr[0] === 'event' && subArr[1] && _UUID_RE.test(subArr[1])) {
                _hostState.curEventId = subArr[1].toLowerCase();
            }
            hostResume();
        }

        async function hostResume() {
            try { sessionStorage.removeItem('gaa_return_host'); } catch (_) {} // 팝업 로그인 성공 — 복귀 마커 소진
            const c = document.getElementById('host-container');
            c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wds-gray-500)">확인 중…</div>';
            try { if (typeof initKakao === 'function') initKakao(); } catch (_) {}
            const token = (typeof Kakao !== 'undefined' && Kakao.Auth && Kakao.Auth.getAccessToken && Kakao.Auth.getAccessToken()) || null;
            if (!token) { renderHostLogin(); return; }
            _hostState.token = token;
            // 체크인·초대 수락·명단은 해당 액션이 서버에서 토큰·권한을 직접 검증하므로 host_me를 건너뛴다.
            // 401이면 각 렌더러가 로그인 화면으로 되돌린다.
            if (_hostState.pendingCheckin) {
                const code = _hostState.pendingCheckin;
                _hostState.pendingCheckin = null;
                hostDoCheckin(code);
                return;
            }
            if (_hostState.pendingJoin) {
                const tk = _hostState.pendingJoin;
                _hostState.pendingJoin = null;
                hostAcceptJoin(tk);
                return;
            }
            if (_hostState.curEventId) { renderHostAttendees(_hostState.curEventId); return; }
            await hostLoadTeams();
        }

        // 팀 목록 로드 → 팀 없으면 팀 등록 강제, 있으면 대시보드
        async function hostLoadTeams(next) {
            const out = await eventApi({ action: 'host_me', kakao_token: _hostState.token });
            if (!out.ok) { _hostState.token = null; renderHostLogin(out.error === 'auth' ? '' : (out.message || '')); return; }
            _hostState.teams = out.teams || [];
            _hostState.isAdmin = !!out.is_admin;
            if (!_hostState.teams.find(t => t.id === _hostState.curTeamId)) {
                _hostState.curTeamId = _hostState.teams.length ? _hostState.teams[0].id : null;
            }
            if (!_hostState.teams.length && !_hostState.isAdmin) {
                renderTeamForm(null); // 공연 생성 전 팀 등록 먼저 (pendingEventJoin은 팀 생성 후 이어짐)
                _prefillKakaoNick();
                return;
            }
            if (_hostState.pendingEventJoin) {
                const tk = _hostState.pendingEventJoin;
                _hostState.pendingEventJoin = null;
                renderEventJoin(tk);
                return;
            }
            (next || renderHostDashboard)();
        }

        function _prefillKakaoNick() {
            if (_hostState.kakaoNick || typeof Kakao === 'undefined' || !Kakao.API || !Kakao.API.request) return;
            try {
                Kakao.API.request({ url: '/v2/user/me', success: (res) => {
                    _hostState.kakaoNick = (res.kakao_account && res.kakao_account.profile && res.kakao_account.profile.nickname)
                        || (res.properties && res.properties.nickname) || '';
                    const el = document.getElementById('hostName');
                    if (el && !el.value && _hostState.kakaoNick) el.value = _hostState.kakaoNick;
                }, fail: () => {} });
            } catch (_) {}
        }

        // 초대 링크 수락 (#host/join/{token})
        async function hostAcceptJoin(token) {
            const c = document.getElementById('host-container');
            c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wds-gray-500)">초대를 확인하는 중…</div>';
            const out = await eventApi({ action: 'accept_invite', kakao_token: _hostState.token, token });
            if (!out.ok) {
                if (out.error === 'auth') { _hostState.token = null; _hostState.pendingJoin = token; renderHostLogin(); return; }
                c.innerHTML = `<div style="text-align:center;padding:40px">
                    <div style="font-size:2rem;margin-bottom:10px">😥</div>
                    <p style="color:var(--wds-gray-700);font-size:0.9rem;margin:0 0 18px">${escapeHtml(out.message || '초대를 확인하지 못했습니다.')}</p>
                    <button class="gaa-btn gaa-btn-secondary" onclick="showHostSection()">호스트 센터로</button></div>`;
                return;
            }
            showToast(`🎉 '${out.team.name}' 팀의 공동호스트가 되었습니다!`);
            _hostState.curTeamId = out.team.id;
            _hostState.tab = 'teams'; // 합류한 팀을 팀 관리 탭에서 바로 확인
            hostLoadTeams();
        }

        // 공연 공동 관리팀 초대 수락 (#host/eventjoin/{token}) — 내 팀 중 하나를 골라 팀 단위로 합류
        async function renderEventJoin(token) {
            const c = document.getElementById('host-container');
            c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wds-gray-500)">초대를 확인하는 중…</div>';
            const info = await eventApi({ action: 'event_invite_info', kakao_token: _hostState.token, token });
            if (!info.ok) {
                if (info.error === 'auth') { _hostState.token = null; _hostState.pendingEventJoin = token; renderHostLogin(); return; }
                c.innerHTML = `<div style="text-align:center;padding:40px">
                    <div style="font-size:2rem;margin-bottom:10px">😥</div>
                    <p style="color:var(--wds-gray-700);font-size:0.9rem;margin:0 0 18px">${escapeHtml(info.message || '초대를 확인하지 못했습니다.')}</p>
                    <button class="gaa-btn gaa-btn-secondary" onclick="showHostSection()">호스트 센터로</button></div>`;
                return;
            }
            const ownerTeams = (_hostState.teams || []).filter(t => t.my_role === 'owner');
            const ev = info.event;
            const evCard = `<div class="host-card" style="margin-bottom:14px">
                    <div style="font-size:0.75rem;font-weight:700;color:var(--wds-primary);margin-bottom:4px">🤝 공연 공동 관리팀 초대</div>
                    <div style="font-size:1rem;font-weight:800;color:var(--wds-black)">${escapeHtml(ev.title)}</div>
                    <div style="font-size:0.8rem;color:var(--wds-gray-700);margin-top:4px">📅 ${_showDateStr(ev.starts_at)} · 주최 ${escapeHtml(ev.host_name || '')}</div>
                </div>`;
            if (!ownerTeams.length) {
                c.innerHTML = `${evCard}
                    <p style="font-size:0.85rem;color:var(--wds-gray-700);line-height:1.7;margin:0 0 16px">팀 단위 초대는 <strong>팀 소유자</strong>만 수락할 수 있습니다.<br>새 팀을 만들면 그 팀으로 참여할 수 있어요.</p>
                    <button class="gaa-btn gaa-btn-block gaa-btn-primary" onclick="_hostState.pendingEventJoin='${jsStr(token)}';renderTeamForm(null)">+ 새 팀 만들고 참여하기</button>`;
                return;
            }
            c.innerHTML = `${evCard}
                <div class="perf-form-group">
                    <label class="perf-form-label">어느 팀으로 참여할까요?</label>
                    <select class="perf-form-input" id="ejTeamSel">${ownerTeams.map(t => `<option value="${jsStr(t.id)}">${escapeHtml(t.name)}</option>`).join('')}</select>
                </div>
                <div id="ejResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:2px 0;color:#e74c3c"></div>
                <button class="gaa-btn gaa-btn-block gaa-btn-primary" onclick="acceptEventJoin('${jsStr(token)}')">이 팀으로 공연 관리에 참여하기</button>
                <p style="font-size:0.76rem;color:var(--wds-gray-500);text-align:center;margin-top:10px;line-height:1.6">참여하면 팀 전체 멤버가 이 공연의 예매자 관리·입금 확인·체크인을 함께 할 수 있습니다.</p>`;
        }

        async function acceptEventJoin(token) {
            const res = document.getElementById('ejResult');
            const hostId = document.getElementById('ejTeamSel')?.value;
            if (!hostId) return;
            const out = await eventApi({ action: 'accept_event_invite', kakao_token: _hostState.token, token, host_id: hostId });
            if (!out.ok) { if (res) res.textContent = out.message || '수락에 실패했습니다.'; return; }
            showToast(`🎉 '${out.event.title}' 공연을 함께 관리합니다!`);
            _hostState.curTeamId = hostId;
            _hostState.tab = 'events'; // 함께 관리하게 된 공연을 공연 관리 탭에서 바로 확인
            hostLoadTeams();
        }

        function hostKakaoLogin() {
            try { if (typeof initKakao === 'function') initKakao(); } catch (_) {}
            if (typeof Kakao === 'undefined' || !Kakao.Auth) { showToast('카카오 SDK를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.'); return; }
            // 일부 인앱 브라우저는 팝업 대신 리다이렉트로 로그인해 페이지가 새로 뜬다(해시 유실).
            // 복귀 마커를 남겨 부트가 게더링 자동 로그인 대신 호스트 센터로 돌아오게 한다.
            try { sessionStorage.setItem('gaa_return_host', '1'); } catch (_) {}
            Kakao.Auth.login({
                success: () => hostResume(),
                fail: () => showToast('카카오 로그인에 실패했습니다. 다시 시도해주세요.'),
            });
        }

        function renderHostLogin(extraMsg) {
            const c = document.getElementById('host-container');
            c.innerHTML = `
                <div class="host-card sx-login" style="text-align:center;padding:32px 20px">
                    <div class="ic">🎤</div>
                    <div style="font-size:1.05rem;font-weight:800;color:var(--wds-black);margin-bottom:8px">호스트 센터</div>
                    <p style="font-size:0.85rem;color:var(--wds-gray-700);line-height:1.7;margin:0 0 18px">
                        카카오 로그인만 하면 누구나 공연을 등록하고<br>예매자를 관리할 수 있습니다.
                    </p>
                    ${_hostState.pendingCheckin ? '<div style="background:#FEF3C7;color:#92400E;border-radius:10px;padding:10px 12px;font-size:0.82rem;font-weight:600;margin-bottom:14px">티켓 체크인을 하려면 호스트 로그인이 필요합니다.</div>' : ''}
                    ${_hostState.pendingJoin ? '<div style="background:#DBEAFE;color:#1E40AF;border-radius:10px;padding:10px 12px;font-size:0.82rem;font-weight:600;margin-bottom:14px">💌 공동호스트 초대를 받았습니다! 카카오 로그인하면 팀에 합류됩니다.</div>' : ''}
                    ${_hostState.pendingEventJoin ? '<div style="background:#DBEAFE;color:#1E40AF;border-radius:10px;padding:10px 12px;font-size:0.82rem;font-weight:600;margin-bottom:14px">🤝 공연 공동 관리팀 초대를 받았습니다! 카카오 로그인 후 참여할 팀을 선택하세요.</div>' : ''}
                    ${extraMsg ? `<div style="color:#e74c3c;font-size:0.82rem;margin-bottom:12px">${escapeHtml(extraMsg)}</div>` : ''}
                    <button onclick="hostKakaoLogin()" style="width:100%;max-width:320px;padding:14px;border-radius:10px;border:none;background:#FEE500;color:#3C1E1E;font-size:0.95rem;font-weight:700;cursor:pointer;font-family:inherit">💬 카카오로 시작하기</button>
                </div>`;
        }

        // 팀 로고 표시 (없으면 🎤 이모지)
        function _teamLogoHTML(url, size) {
            return url
                ? `<img src="${escapeHtml(url)}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex:none;background:var(--wds-gray-100)">`
                : `<span style="font-size:${Math.round(size * 0.62)}px;line-height:1">🎤</span>`;
        }

        async function uploadTeamLogo(input) {
            const st = document.getElementById('teamLogoStatus');
            const file = input.files && input.files[0];
            if (!file) return;
            if (!/^image\//.test(file.type)) { if (st) st.textContent = '이미지 파일만 올릴 수 있습니다.'; input.value = ''; return; }
            if (file.size > 2 * 1024 * 1024) { if (st) st.textContent = '2MB 이하 이미지만 올릴 수 있습니다.'; input.value = ''; return; }
            if (st) st.textContent = '업로드 중…';
            try {
                const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
                const path = `events/logo-${Date.now()}.${ext}`;
                const { error } = await supabaseClient.storage.from('community-images').upload(path, file, { cacheControl: '3600', upsert: false });
                if (error) throw error;
                const { data: urlData } = supabaseClient.storage.from('community-images').getPublicUrl(path);
                _hostState.teamLogoUrl = urlData.publicUrl;
                const pv = document.getElementById('teamLogoPreview');
                if (pv) pv.innerHTML = `<img src="${escapeHtml(_hostState.teamLogoUrl)}" style="width:100%;height:100%;object-fit:cover" alt="">`;
                if (st) st.textContent = '✅ 업로드 완료';
            } catch (e) {
                if (st) st.textContent = '업로드 실패: ' + (e.message || e);
                input.value = '';
            }
        }

        // 팀 등록/수정 폼 — team이 null이면 새 팀 생성
        function renderTeamForm(team) {
            const c = document.getElementById('host-container');
            const t = team || {};
            _hostState.teamLogoUrl = t.logo_url || '';
            const hasTeams = (_hostState.teams || []).length > 0;
            c.innerHTML = `
                ${hasTeams ? '<div class="cm-top" style="padding-top:0"><button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="renderHostDashboard()">‹ 대시보드</button></div>' : ''}
                <div class="perf-section-title">${t.id ? '팀 정보 수정' : (hasTeams ? '새 팀 만들기' : '공연 주최팀 등록')}</div>
                <p style="font-size:0.82rem;color:var(--wds-gray-700);margin:0 0 14px;line-height:1.6">${t.id ? '' : '공연을 등록하려면 먼저 팀을 만들어야 합니다. '}예매 페이지에 표시될 팀 정보를 입력해주세요. 입금 계좌는 공연 등록 시 입력합니다.</p>
                <div class="perf-form-group">
                    <label class="perf-form-label">팀 이름 *</label>
                    <input type="text" class="perf-form-input" id="hostName" maxlength="40" placeholder="예: 밴드 스컬" value="${escapeHtml(t.name || (!t.id && !hasTeams ? (_hostState.kakaoNick || '') : ''))}">
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">팀 소개 (선택)</label>
                    <textarea class="perf-form-input" id="hostBio" maxlength="500" style="height:84px;padding:10px 12px;resize:vertical" placeholder="예: 신촌에서 활동하는 5인조 밴드입니다.">${escapeHtml(t.bio || '')}</textarea>
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">SNS / 링크 (선택)</label>
                    <input type="text" class="perf-form-input" id="hostSns" maxlength="200" placeholder="예: instagram.com/ourband" value="${escapeHtml(t.sns || '')}">
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">팀 로고 (선택)</label>
                    <div style="display:flex;align-items:center;gap:12px">
                        <div id="teamLogoPreview" style="width:46px;height:46px;border-radius:50%;background:var(--wds-gray-100);flex:none;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:1.15rem">${t.logo_url ? `<img src="${escapeHtml(t.logo_url)}" style="width:100%;height:100%;object-fit:cover" alt="">` : '🎤'}</div>
                        <div style="flex:1;min-width:0">
                            <input type="file" id="teamLogo" accept="image/*" onchange="uploadTeamLogo(this)" style="font-size:0.82rem;max-width:100%">
                            <div id="teamLogoStatus" style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:4px">정사각형 이미지 권장 · 2MB 이하</div>
                        </div>
                    </div>
                </div>
                <div id="hostRegResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:2px 0;color:#e74c3c"></div>
                <div style="display:flex;gap:8px">
                    ${t.id ? `<button class="gaa-btn gaa-btn-secondary" style="flex:1" onclick="renderTeamManage('${jsStr(t.id)}')">취소</button>` : ''}
                    <button class="gaa-btn gaa-btn-primary" style="flex:2" onclick="submitTeamForm(${t.id ? `'${jsStr(t.id)}'` : 'null'})">${t.id ? '저장' : '팀 만들고 시작하기'}</button>
                </div>
                ${!hasTeams ? `<p style="text-align:center;margin-top:16px;font-size:0.8rem;color:var(--wds-gray-500)">팀 초대 코드를 받으셨나요?
                    <a href="javascript:void(0)" onclick="renderInviteCodeEntry()" style="color:var(--wds-primary);font-weight:700;text-decoration:underline">초대 코드 입력</a></p>` : ''}`;
        }

        async function submitTeamForm(teamId) {
            const res = document.getElementById('hostRegResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const name = document.getElementById('hostName')?.value.trim();
            const bio = document.getElementById('hostBio')?.value.trim();
            const sns = document.getElementById('hostSns')?.value.trim();
            if (!name) { showErr('팀 이름을 입력해주세요.'); return; }
            const logo_url = _hostState.teamLogoUrl || '';
            const out = teamId
                ? await eventApi({ action: 'update_team', kakao_token: _hostState.token, host_id: teamId, name, bio, sns, logo_url })
                : await eventApi({ action: 'create_team', kakao_token: _hostState.token, name, bio, sns, logo_url });
            if (!out.ok) { showErr(out.message || '저장에 실패했습니다.'); return; }
            showToast(teamId ? '팀 정보가 저장되었습니다.' : `'${out.team.name}' 팀이 만들어졌습니다!`);
            _hostState.curTeamId = out.team.id;
            hostLoadTeams();
        }

        // 팀 관리 진입 (기존 호출부 호환) — 팀 관리 탭으로 전환
        function renderTeamManage(teamId) {
            if (teamId) _hostState.curTeamId = teamId;
            _hostState.tab = 'teams';
            renderHostDashboard();
        }

        // 팀 관리 탭 — 팀 정보·멤버·초대 (공연 관리와 분리)
        async function renderHostTeamsTab() {
            const c = document.getElementById('host-container');
            const team = _curTeam();
            const inviteEntry = `
                <button class="gaa-btn gaa-btn-sm gaa-btn-block gaa-btn-secondary" style="margin-top:14px" onclick="renderInviteCodeEntry()">초대 코드 입력</button>
                <div style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:6px;line-height:1.5;text-align:center">받은 6자리 코드로 팀 합류·공연 공동 관리 초대를 여기서 수락합니다.</div>`;
            const newTeamBtn = `<button class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="flex:none;align-self:stretch" onclick="renderTeamForm(null)" title="새 팀 만들기">+ 새 팀</button>`;
            if (!team) { // 관리자 계정인데 소속 팀 없음
                c.innerHTML = `${_hostTabBar()}
                    <p style="text-align:center;padding:26px 0 18px;color:var(--wds-gray-500);font-size:0.88rem">아직 소속된 팀이 없습니다.</p>
                    <button class="gaa-btn gaa-btn-sm gaa-btn-block gaa-btn-primary" onclick="renderTeamForm(null)">+ 새 팀 만들기</button>
                    ${inviteEntry}`;
                return;
            }
            c.innerHTML = `${_hostTabBar()}${_hostTeamSelectRow(newTeamBtn)}<div style="text-align:center;padding:30px;color:var(--wds-gray-500)">불러오는 중…</div>`;
            const out = await eventApi({ action: 'list_members', kakao_token: _hostState.token, host_id: team.id });
            if (!out.ok) {
                if (out.error === 'auth') { _hostState.token = null; renderHostLogin(); return; }
                c.innerHTML = `${_hostTabBar()}<p style="text-align:center;padding:40px;color:var(--wds-gray-500)">${escapeHtml(out.message || '불러오지 못했습니다.')}</p>`;
                return;
            }
            const amOwner = out.my_role === 'owner' || _hostState.isAdmin;
            const rows = out.members.map(m => `
                <div style="display:flex;align-items:center;gap:8px;padding:10px 2px;border-bottom:1px solid var(--wds-gray-100)">
                    <span style="font-size:0.88rem;font-weight:600;color:var(--wds-black)">${escapeHtml(m.name || '이름 없음')}</span>
                    ${m.role === 'owner' ? _showChip('팀 소유자', '#DBEAFE', '#1E40AF') : _showChip('공동호스트', 'var(--wds-gray-100)', 'var(--wds-gray-700)')}
                    ${m.kakao_id === out.my_kakao_id ? '<span style="font-size:0.72rem;color:var(--wds-gray-500)">(나)</span>' : ''}
                    ${amOwner && m.role !== 'owner' ? `<button class="gaa-btn gaa-btn-xs gaa-btn-danger" style="margin-left:auto" onclick="hostRemoveMember('${jsStr(team.id)}','${jsStr(m.kakao_id)}','${jsStr(m.name || '')}')">내보내기</button>` : ''}
                </div>`).join('');
            c.innerHTML = `
                ${_hostTabBar()}
                ${_hostTeamSelectRow(newTeamBtn)}
                <div class="host-card">
                    <div style="display:flex;align-items:center;gap:10px">
                        ${_teamLogoHTML(team.logo_url, 40)}
                        <div style="flex:1;min-width:0">
                            <div style="font-size:0.95rem;font-weight:800;color:var(--wds-black)">${escapeHtml(team.name)}</div>
                            ${team.bio ? `<div style="font-size:0.78rem;color:var(--wds-gray-700);margin-top:2px;line-height:1.5">${escapeHtml(team.bio)}</div>` : ''}
                        </div>
                        ${amOwner ? `<button onclick="renderTeamForm(_hostState.teams.find(t=>t.id==='${jsStr(team.id)}'))" style="flex:none;padding:8px 12px;border-radius:8px;border:1px solid var(--wds-gray-300);background:none;color:var(--wds-gray-700);cursor:pointer;font-size:0.78rem;font-weight:600;font-family:inherit">팀 정보 수정</button>` : ''}
                    </div>
                </div>
                <div class="host-card">
                    <div style="font-size:0.85rem;font-weight:700;color:var(--wds-black);margin-bottom:4px">멤버 (${out.members.length})</div>
                    ${rows}
                    ${amOwner ? `
                    <div style="margin-top:14px">
                        <button class="gaa-btn gaa-btn-sm gaa-btn-block gaa-btn-primary" onclick="hostInvite('${jsStr(team.id)}')">공동호스트 초대 코드 만들기</button>
                        <div id="inviteLinkBox" style="margin-top:8px"></div>
                        <div style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:6px;line-height:1.5">초대 코드는 7일간 유효하며, 새로 만들면 이전 코드는 무효가 됩니다. 합류한 멤버는 이 팀의 공연 등록·입금 확인·체크인을 함께 할 수 있습니다.</div>
                    </div>` : ''}
                </div>`;
        }

        async function hostRemoveMember(teamId, memberKakaoId, memberName) {
            if (!confirm(`'${memberName}' 님을 팀에서 내보내시겠습니까?`)) return;
            const out = await eventApi({ action: 'remove_member', kakao_token: _hostState.token, host_id: teamId, member_kakao_id: memberKakaoId });
            if (!out.ok) { showToast(out.message || '처리에 실패했습니다.'); return; }
            showToast('멤버를 내보냈습니다.');
            renderTeamManage(teamId);
        }

        // 초대 코드 박스 — 코드를 크게 보여주고 카카오톡 공유/복사는 보조 수단
        function _renderInviteBox(boxId, code, url, shareText) {
            const box = document.getElementById(boxId);
            if (!box) return;
            const shareApi = (typeof Kakao !== 'undefined') ? ((Kakao.Share && Kakao.Share.sendDefault) ? Kakao.Share : (Kakao.Link && Kakao.Link.sendDefault ? Kakao.Link : null)) : null;
            box.innerHTML = `
                <div style="border:1.5px dashed var(--wds-gray-300);border-radius:12px;padding:14px;text-align:center;margin:8px 0 10px;background:var(--wds-white)">
                    <div style="font-size:0.74rem;color:var(--wds-gray-500);font-weight:700;margin-bottom:4px">초대 코드 · 7일 유효</div>
                    <div style="font-size:1.5rem;font-weight:800;letter-spacing:0.3em;padding-left:0.3em;color:var(--wds-black)">${escapeHtml(code)}</div>
                    <div style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:6px;line-height:1.5">받는 분이 호스트 센터 → [초대 코드 입력]에 이 코드를 넣으면 됩니다.</div>
                    <div style="display:flex;gap:6px;margin-top:10px">
                        ${shareApi ? `<button id="${boxId}-share" style="flex:1;padding:9px;border-radius:8px;border:none;background:#FEE500;color:#3C1E1E;font-size:0.8rem;font-weight:700;cursor:pointer;font-family:inherit">카카오톡 공유</button>` : ''}
                        <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" id="${boxId}-copy">코드 복사</button>
                    </div>
                </div>`;
            const shareBtn = document.getElementById(boxId + '-share');
            if (shareBtn && shareApi) shareBtn.onclick = () => {
                try { shareApi.sendDefault({ objectType: 'text', text: shareText, link: { webUrl: url, mobileWebUrl: url } }); }
                catch (_) { showToast('카카오톡 공유를 열지 못했습니다. 코드를 복사해 보내주세요.'); }
            };
            const copyBtn = document.getElementById(boxId + '-copy');
            if (copyBtn) copyBtn.onclick = async () => {
                try { await navigator.clipboard.writeText(code); showToast('초대 코드가 복사되었습니다.'); }
                catch (_) { showToast('복사에 실패했습니다. 코드를 직접 전달해주세요.'); }
            };
        }

        // 공동호스트(팀원) 초대 — 6자리 초대 코드 생성
        async function hostInvite(teamId) {
            const team = (_hostState.teams || []).find(t => t.id === teamId);
            const out = await eventApi({ action: 'create_invite', kakao_token: _hostState.token, host_id: teamId });
            if (!out.ok) { showToast(out.message || '초대 생성에 실패했습니다.'); return; }
            const url = location.origin + location.pathname + '?hostjoin=' + out.token;
            _renderInviteBox('inviteLinkBox', out.token,url,
                `'${(team && team.name) || '우리 팀'}' 팀의 공동호스트로 초대합니다!\n호스트 센터 → [초대 코드 입력]에 ${out.token} 를 넣거나, 아래 링크를 열어주세요. (7일간 유효)`);
        }

        const _EV_STATUS_CHIP = {
            published: ['공개중', '#DCFCE7', '#166534'],
            closed: ['예매 마감', '#FEF3C7', '#92400E'],
            hidden: ['숨김', 'var(--wds-gray-100)', 'var(--wds-gray-500)'],
        };
        const _hbtn = _gaaBtn; // 색 인자 → gaa-btn 변형 (색 코드는 하위호환용 의미 표시: 빨강=danger, 초록/파랑=primary, 그 외 secondary)

        // 호스트 센터 탭 — 공연 관리 / 팀 관리 분리
        function _hostTabBar() {
            const cur = _hostState.tab || 'events';
            const tb = (key, label) => `<button type="button" class="${cur === key ? 'on' : ''}" onclick="_hostState.tab='${key}';renderHostDashboard()">${label}</button>`;
            return `<div class="cm-seg" style="margin-bottom:12px">${tb('events', '공연 관리')}${tb('teams', '팀 관리')}</div>`; // 2026-10-16 알약 탭(커뮤니티·게더링과 동일)
        }

        // 팀 선택 줄 (두 탭 공용) — extra: 오른쪽 추가 버튼
        function _hostTeamSelectRow(extra) {
            const team = _curTeam();
            return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
                    ${team && team.logo_url ? _teamLogoHTML(team.logo_url, 34) : ''}
                    <select class="perf-form-input" style="flex:1;height:44px;font-weight:700;margin:0" onchange="_hostState.curTeamId=this.value;renderHostDashboard()">
                        ${(_hostState.teams || []).map(t => `<option value="${jsStr(t.id)}"${t.id === _hostState.curTeamId ? ' selected' : ''}>${escapeHtml(t.name)}${t.my_role === 'owner' ? '' : ' · 공동호스트'}</option>`).join('')}
                        ${_hostState.isAdmin && !_hostState.teams.length ? '<option value="" selected>전체 공연 (관리자)</option>' : ''}
                    </select>
                    ${extra || ''}
                </div>`;
        }

        async function renderHostDashboard() {
            const c = document.getElementById('host-container');
            _hostState.curEventId = null;
            const team = _curTeam();
            if (!team && !_hostState.isAdmin) { renderTeamForm(null); _prefillKakaoNick(); return; }
            if ((_hostState.tab || 'events') === 'teams') { renderHostTeamsTab(); return; }
            c.innerHTML = _hostTabBar() + '<div style="text-align:center;padding:40px;color:var(--wds-gray-500)">불러오는 중…</div>';
            const out = await eventApi({ action: 'my_events', kakao_token: _hostState.token, host_id: team ? team.id : undefined });
            if (!out.ok) {
                if (out.error === 'auth') { _hostState.token = null; renderHostLogin(); return; }
                c.innerHTML = `${_hostTabBar()}<p style="text-align:center;padding:40px;color:var(--wds-gray-500)">${escapeHtml(out.message || '불러오지 못했습니다.')}</p>`;
                return;
            }
            let html = `
                ${_hostTabBar()}
                ${_hostState.isAdmin ? '<div style="margin-bottom:10px"><span class="show-chip" style="background:#DBEAFE;color:#1E40AF">관리자 계정</span></div>' : ''}
                ${_hostTeamSelectRow()}
                <div style="display:flex;gap:8px;margin-bottom:14px">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-primary" style="flex:2" onclick="renderHostEventForm()">+ 새 공연 등록</button>
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" onclick="renderInviteCodeEntry()" title="팀 합류·공연 공동 관리 초대 코드 수락">초대 코드 입력</button>
                </div>`;
            const now = new Date();
            const upcoming = out.events.filter(ev => new Date(ev.starts_at) > now)
                .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)); // 임박한 공연부터
            const pastEvents = out.events.filter(ev => new Date(ev.starts_at) <= now); // 서버 정렬(최신순) 유지
            // 요약 통계 — 다가오는 공연 기준
            const agg = upcoming.reduce((a, ev) => {
                const s = ev.stats || {};
                a.taken += s.taken || 0;
                a.pending += s.pending || 0;
                a.sales += (s.confirmed || 0) * (ev.price || 0);
                return a;
            }, { taken: 0, pending: 0, sales: 0 });
            if (out.events.length) {
                html += `
                <div class="gt-tiles">
                    <div class="gt-tile"><b>${upcoming.length}</b><span>예정 공연</span></div>
                    <div class="gt-tile"><b>${agg.taken}${agg.pending ? `<small> 대기 ${agg.pending}</small>` : ''}</b><span>예매 매수</span></div>
                    <div class="gt-tile"><b style="font-size:1rem;line-height:1.9">₩${agg.sales.toLocaleString()}</b><span>확정 매출</span></div>
                </div>`;
            }
            const evCard = (ev) => {
                const chip = _EV_STATUS_CHIP[ev.status] || _EV_STATUS_CHIP.hidden;
                const s = ev.stats || { taken: 0, pending: 0, confirmed: 0, checked_in: 0 };
                const pct = ev.capacity ? Math.min(100, Math.round((s.taken || 0) / ev.capacity * 100)) : 0;
                const sales = (s.confirmed || 0) * (ev.price || 0);
                const toggle = ev.status === 'published'
                    ? _hbtn('마감', `hostSetEventStatus('${jsStr(ev.id)}','closed')`, '#92400E', '#F3D9A4')
                    : _hbtn('오픈', `hostSetEventStatus('${jsStr(ev.id)}','published')`, '#166534', '#B7E4C7');
                const poster = ev.poster_url
                    ? `<img src="${escapeHtml(ev.poster_url)}" alt="" loading="lazy" style="width:56px;height:75px;border-radius:8px;object-fit:cover;flex:none;background:var(--wds-gray-100)">`
                    : `<div style="width:56px;height:75px;border-radius:8px;background:linear-gradient(135deg,var(--wds-gray-100),var(--wds-gray-300));flex:none;display:flex;align-items:center;justify-content:center;font-size:1.3rem;color:var(--wds-gray-500)">🎸</div>`;
                return `<div class="host-card">
                    <div style="display:flex;gap:12px;margin-bottom:8px">
                        ${poster}
                        <div style="flex:1;min-width:0">
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                <span class="show-chip" style="background:${chip[1]};color:${chip[2]}">${chip[0]}</span>
                                ${ev.sales_open_at && new Date(ev.sales_open_at) > new Date() ? `<span class="show-chip" style="background:#FEF3C7;color:#92400E">오픈 ${_showDateStr(ev.sales_open_at)}</span>` : ''}
                                ${ev.co_hosted ? `<span class="show-chip" style="background:#DBEAFE;color:#1E40AF">공동 관리 · 주최 ${escapeHtml(ev.host_name || '')}</span>` : ''}
                                <span style="margin-left:auto;font-size:0.78rem;font-weight:700;color:var(--wds-gray-500)">${ev.price > 0 ? '₩' + Number(ev.price).toLocaleString() : '무료'}</span>
                            </div>
                            <div style="font-size:0.95rem;font-weight:800;color:var(--wds-black);line-height:1.35;margin:5px 0 3px">${escapeHtml(ev.title)}</div>
                            <div style="font-size:0.8rem;color:var(--wds-gray-700);line-height:1.6">${_showDateStr(ev.starts_at)} · ${escapeHtml(ev.venue)}</div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:baseline;gap:6px;font-size:0.78rem;color:var(--wds-gray-700);flex-wrap:wrap">
                        <span style="font-weight:800;color:var(--wds-black)">예매 ${s.taken}/${ev.capacity}석</span>
                        <span style="color:var(--wds-primary);font-weight:700">${pct}%</span>
                        <span style="margin-left:auto">확정 ${s.confirmed} · 입금대기 ${s.pending} · 입장 ${s.checked_in}</span>
                    </div>
                    <div style="height:6px;background:var(--wds-gray-100);border-radius:3px;overflow:hidden;margin:6px 0 8px">
                        <div style="height:100%;width:${pct}%;background:${pct >= 100 ? '#EF4444' : 'var(--wds-primary)'}"></div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:0.78rem;color:var(--wds-gray-700)">
                        ${ev.price > 0 ? `확정 매출 <strong style="color:var(--wds-black)">₩${sales.toLocaleString()}</strong>` : '무료 공연'}
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                        ${_hbtn('바로가기', `showShowsSection(['${jsStr(ev.id)}'])`, 'var(--wds-gray-700)', 'var(--wds-gray-300)')}
                        ${toggle}
                        <button class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="renderHostAttendees('${jsStr(ev.id)}')">예매자 관리</button>
                        ${_hbtn('수정', `hostEditEvent('${jsStr(ev.id)}')`, 'var(--wds-gray-700)', 'var(--wds-gray-300)')}
                        ${_hbtn('삭제', `hostDeleteEvent('${jsStr(ev.id)}')`, '#EF4444', '#F5B5B5')}
                    </div>
                </div>`;
            };
            if (!out.events.length) {
                html += '<p style="text-align:center;padding:36px 0;color:var(--wds-gray-500)">등록한 공연이 없습니다.<br>첫 공연을 등록해보세요!</p>';
            } else {
                html += upcoming.length
                    ? `<div style="font-size:0.8rem;font-weight:800;color:var(--wds-gray-500);margin:0 0 8px">다가오는 공연 ${upcoming.length}</div>` + upcoming.map(evCard).join('')
                    : '<p style="text-align:center;padding:20px 0;color:var(--wds-gray-500);font-size:0.88rem">예정된 공연이 없습니다. 새 공연을 등록해보세요!</p>';
                if (pastEvents.length) {
                    html += `<details style="margin-top:16px"><summary style="cursor:pointer;font-size:0.8rem;font-weight:800;color:var(--wds-gray-500);user-select:none;padding:6px 0">지난 공연 ${pastEvents.length}개 보기</summary>
                        <div style="margin-top:8px;opacity:0.78">${pastEvents.map(evCard).join('')}</div></details>`;
                }
            }
            _hostState.dashEvents = out.events;
            c.innerHTML = html;
        }

        async function hostSetEventStatus(id, status) {
            if (status === 'hidden' && !confirm('공연을 목록에서 숨기시겠습니까?')) return;
            const out = await eventApi({ action: 'set_event_status', kakao_token: _hostState.token, event_id: id, status });
            if (!out.ok) { showToast(out.message || '변경에 실패했습니다.'); return; }
            showToast(status === 'published' ? '예매가 오픈되었습니다.' : status === 'closed' ? '예매를 마감했습니다.' : '공연을 숨겼습니다.');
            renderHostDashboard();
        }

        function hostEditEvent(id) {
            const ev = (_hostState.dashEvents || []).find(e => e.id === id);
            if (ev) renderHostEventForm(ev);
        }

        // 공연 삭제 — 주최팀만, 살아있는 예매가 있으면 서버가 거부
        async function hostDeleteEvent(id) {
            const ev = (_hostState.dashEvents || []).find(e => e.id === id);
            if (!confirm(`'${(ev && ev.title) || '이 공연'}'을(를) 삭제할까요?\n공연 정보가 영구 삭제되며 되돌릴 수 없습니다.\n(예매가 있으면 모두 취소한 뒤에만 삭제할 수 있습니다)`)) return;
            const out = await eventApi({ action: 'delete_event', kakao_token: _hostState.token, event_id: id });
            if (!out.ok) { showToast(out.message || '삭제에 실패했습니다.'); return; }
            showToast('공연이 삭제되었습니다.');
            renderHostDashboard();
        }

        function _isoToLocalInput(iso) {
            const d = iso ? new Date(iso) : null;
            if (!d || isNaN(d)) return '';
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
        }

        // ── 카카오 지도 SDK 지연 로더 — 필요 화면(장소 검색·상세 지도)에서만 로드.
        // 실패 시 null 반환 + 캐시 리셋(다음 시도 허용). 로그인 SDK(window.Kakao)와 별개 네임스페이스(window.kakao).
        let _kakaoMapsPromise = null;
        function loadKakaoMaps() {
            if (window.kakao && window.kakao.maps && window.kakao.maps.services) return Promise.resolve(window.kakao);
            if (_kakaoMapsPromise) return _kakaoMapsPromise;
            _kakaoMapsPromise = new Promise((resolve) => {
                const done = (v) => { if (!v) _kakaoMapsPromise = null; resolve(v); };
                const to = setTimeout(() => done(null), 8000);
                const s = document.createElement('script');
                s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + KAKAO_KEY + '&libraries=services&autoload=false';
                s.onload = () => { try { window.kakao.maps.load(() => { clearTimeout(to); done(window.kakao); }); } catch (_) { clearTimeout(to); done(null); } };
                s.onerror = () => { clearTimeout(to); done(null); };
                document.head.appendChild(s);
            });
            return _kakaoMapsPromise;
        }

        // 가격 입력 콤마 표기 (숫자만 추출 → 1,000 단위 콤마)
        function _fmtCommaInput(el) {
            const d = el.value.replace(/[^\d]/g, '').slice(0, 7);
            el.value = d ? Number(d).toLocaleString() : '';
        }

        // 입금 계좌: 폼은 은행/계좌번호/예금주 분리, 저장은 기존 형식("은행 계좌번호 예금주") 유지
        const _BANKS = ['카카오뱅크', '토스뱅크', '국민은행', '신한은행', '우리은행', '하나은행', '농협은행', '기업은행', 'SC제일은행', '케이뱅크', '새마을금고', '우체국'];
        function _parseBankInfo(str) {
            const parts = String(str || '').trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return { bank: '', custom: '', acct: '', holder: '' };
            const known = _BANKS.includes(parts[0]);
            if (parts.length === 1) return known ? { bank: parts[0], custom: '', acct: '', holder: '' } : { bank: '기타', custom: '', acct: parts[0], holder: '' };
            const holder = parts.length >= 3 ? parts[parts.length - 1] : '';
            const acct = parts.slice(1, parts.length >= 3 ? -1 : undefined).join(' ');
            return known ? { bank: parts[0], custom: '', acct, holder } : { bank: '기타', custom: parts[0], acct, holder };
        }

        // 장소 검색 (카카오 Places) — 선택 시 좌표 저장, 직접 입력하면 좌표 없이 텍스트만
        async function hostVenueSearch() {
            const q = document.getElementById('evVenue')?.value.trim();
            const box = document.getElementById('evVenueResults');
            if (!box) return;
            if (!q) { box.innerHTML = '<div style="font-size:0.78rem;color:var(--wds-gray-500);padding:6px 2px">장소 이름을 입력한 뒤 검색을 눌러주세요.</div>'; return; }
            box.innerHTML = '<div style="font-size:0.78rem;color:var(--wds-gray-500);padding:6px 2px">검색 중…</div>';
            const kk = await loadKakaoMaps();
            if (!kk || !kk.maps.services) {
                box.innerHTML = '<div style="font-size:0.78rem;color:var(--wds-gray-500);padding:6px 2px">장소 검색을 사용할 수 없습니다. 장소명을 직접 입력하셔도 됩니다.</div>';
                return;
            }
            // 검색 결과와 무관하게 항상 '입력한 이름 그대로 사용' 선택지를 제공 — 직접 입력 지원
            const directRow = `<div onclick="hostVenueDirect()" style="padding:9px 12px;border:1px dashed var(--wds-gray-300);border-radius:8px;margin-top:6px;cursor:pointer;background:none">
                <div style="font-size:0.85rem;font-weight:600;color:var(--wds-gray-700)">'${escapeHtml(q)}' 그대로 사용 (직접 입력)</div>
                <div style="font-size:0.74rem;color:var(--wds-gray-500)">지도 없이 장소명만 표시됩니다. 아래에 주소를 함께 적을 수 있어요.</div>
            </div>`;
            new kk.maps.services.Places().keywordSearch(q, (data, status) => {
                if (status !== kk.maps.services.Status.OK || !data.length) {
                    box.innerHTML = '<div style="font-size:0.78rem;color:var(--wds-gray-500);padding:6px 2px">검색 결과가 없습니다.</div>' + directRow;
                    return;
                }
                window.__venueResults = data.slice(0, 5);
                box.innerHTML = window.__venueResults.map((p, i) =>
                    `<div onclick="hostVenuePick(${i})" style="padding:9px 12px;border:1px solid var(--wds-gray-300);border-radius:8px;margin-top:6px;cursor:pointer;background:var(--wds-white)">
                        <div style="font-size:0.85rem;font-weight:600;color:var(--wds-black)">${escapeHtml(p.place_name)}</div>
                        <div style="font-size:0.74rem;color:var(--wds-gray-500)">${escapeHtml(p.road_address_name || p.address_name || '')}</div>
                    </div>`).join('') + directRow;
            });
        }
        function hostVenuePick(i) {
            const p = (window.__venueResults || [])[i];
            if (!p) return;
            _hostState.venuePick = { name: p.place_name, address: p.road_address_name || p.address_name || '', lat: parseFloat(p.y), lng: parseFloat(p.x) };
            const inp = document.getElementById('evVenue');
            if (inp) inp.value = p.place_name;
            const ai = document.getElementById('evVenueDetail');
            if (ai && !ai.value.trim()) ai.value = _hostState.venuePick.address; // 작성해둔 상세설명은 덮어쓰지 않는다
            const box = document.getElementById('evVenueResults');
            if (box) box.innerHTML = '';
            const addr = document.getElementById('evVenueAddr');
            if (addr) addr.textContent = '📍 검색으로 선택됨 — 예매 페이지에 지도로 표시됩니다.';
        }
        // 직접 입력 확정 — 좌표 없이 장소명(+선택 주소)만 저장
        function hostVenueDirect() {
            _hostState.venuePick = null;
            const box = document.getElementById('evVenueResults');
            if (box) box.innerHTML = '';
            const addr = document.getElementById('evVenueAddr');
            if (addr) addr.textContent = '직접 입력한 장소로 저장됩니다. (지도 없이 장소명·주소 표시)';
        }
        function _hostVenueTyped(el) {
            if (_hostState.venuePick && el.value.trim() !== _hostState.venuePick.name) {
                _hostState.venuePick = null; // 직접 수정하면 검색 좌표 무효화
                const addr = document.getElementById('evVenueAddr');
                if (addr) addr.textContent = '';
            }
        }

        function renderHostEventForm(ev) {
            const c = document.getElementById('host-container');
            // 팀 없이는 공연 등록 불가 — 팀 등록 먼저
            if (!_curTeam()) { renderTeamForm(null); _prefillKakaoNick(); return; }
            const h = _curTeam() || {}; // 팀의 기존 계좌(레거시)를 유료 폼 프리필로 활용
            _hostState.posterUrl = (ev && ev.poster_url) || '';
            _hostState.venuePick = (ev && ev.venue_lat != null && ev.venue_lng != null)
                ? { name: ev.venue, address: ev.venue_address || '', lat: ev.venue_lat, lng: ev.venue_lng } : null;
            const isPaid = ev ? ev.price > 0 : false;
            const bank = _parseBankInfo(ev?.bank_info || h.bank_info || '');
            const bankOpts = `<option value="">은행 선택</option>`
                + _BANKS.map(b => `<option value="${b}"${bank.bank === b ? ' selected' : ''}>${b}</option>`).join('')
                + `<option value="기타"${bank.bank === '기타' ? ' selected' : ''}>기타 (직접 입력)</option>`;
            c.innerHTML = `
                <div class="cm-top" style="padding-top:0"><button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="renderHostDashboard()">‹ 대시보드</button></div>
                <div class="perf-section-title">${ev ? '공연 수정' : '새 공연 등록'}</div>
                <div class="perf-form-group">
                    <label class="perf-form-label">공연명 *</label>
                    <input type="text" class="perf-form-input" id="evTitle" maxlength="80" placeholder="예: 한여름 밤의 락" value="${escapeHtml(ev?.title || '')}">
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">공연 일시 *</label>
                    <input type="datetime-local" class="perf-form-input" id="evStartsAt" value="${_isoToLocalInput(ev?.starts_at)}">
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">예매 오픈 일시 (선택)</label>
                    <input type="datetime-local" class="perf-form-input" id="evSalesOpen" value="${_isoToLocalInput(ev?.sales_open_at)}">
                    <div style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:5px;line-height:1.5">설정하면 그 전에는 '오픈 예정'으로 표시되고 예매가 안 됩니다. 비워두면 공개 즉시 예매 가능합니다.</div>
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">장소 *</label>
                    <div style="display:flex;gap:8px">
                        <input type="text" class="perf-form-input" id="evVenue" maxlength="120" placeholder="장소 이름 (검색 또는 직접 입력)" style="flex:1" value="${escapeHtml(ev?.venue || '게더 올 어라운드')}" oninput="_hostVenueTyped(this)">
                        <button class="gaa-btn gaa-btn-xs gaa-btn-secondary" style="flex:none" type="button" onclick="hostVenueSearch()">🔍 검색</button>
                    </div>
                    <div id="evVenueResults"></div>
                    <textarea class="perf-form-input" id="evVenueDetail" maxlength="500" placeholder="장소 상세설명 (선택) — 주소, 찾아오는 길, 층수 등&#10;예: 홍대입구역 3번 출구 도보 5분, OO빌딩 지하 1층 (간판 없음)" style="margin-top:8px;height:64px;padding:10px 12px;resize:vertical">${escapeHtml(ev?.venue_address || '')}</textarea>
                    <div style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:4px;line-height:1.5">예매 페이지의 장소 아래에 그대로 표시됩니다.</div>
                    <div id="evVenueAddr" style="font-size:0.76rem;color:var(--wds-gray-500);margin-top:6px">${_hostState.venuePick ? '📍 검색으로 선택됨 — 예매 페이지에 지도로 표시됩니다.' : ''}</div>
                </div>
                <div style="display:flex;gap:10px">
                    <div class="perf-form-group" style="flex:1">
                        <label class="perf-form-label">정원 *</label>
                        <input type="number" class="perf-form-input" id="evCapacity" min="1" max="1000" value="${ev?.capacity || 30}">
                    </div>
                    <div class="perf-form-group" style="flex:1">
                        <label class="perf-form-label">1인 최대 매수</label>
                        <select class="perf-form-input" id="evMaxPer">${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}"${(ev?.max_per_booking || 4) === n ? ' selected' : ''}>${n}매</option>`).join('')}</select>
                    </div>
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">티켓 가격 *</label>
                    <div style="display:flex;gap:8px;align-items:center">
                        <label style="display:flex;align-items:center;gap:5px;font-size:0.86rem;cursor:pointer"><input type="radio" name="evPriceType" value="free"${isPaid ? '' : ' checked'} onchange="document.getElementById('evPaidRow').style.display='none'"> 무료</label>
                        <label style="display:flex;align-items:center;gap:5px;font-size:0.86rem;cursor:pointer"><input type="radio" name="evPriceType" value="paid"${isPaid ? ' checked' : ''} onchange="document.getElementById('evPaidRow').style.display='block'"> 유료</label>
                    </div>
                    <div id="evPaidRow" style="display:${isPaid ? 'block' : 'none'};margin-top:10px">
                        <input type="text" inputmode="numeric" class="perf-form-input" id="evPrice" placeholder="1매 가격 (원)" value="${isPaid ? Number(ev.price).toLocaleString() : ''}" oninput="_fmtCommaInput(this)" style="margin-bottom:8px">
                        <div style="display:flex;gap:8px;margin-bottom:8px">
                            <select class="perf-form-input" id="evBankSel" style="flex:1.2" onchange="document.getElementById('evBankCustom').style.display=this.value==='기타'?'block':'none'">${bankOpts}</select>
                            <input type="text" class="perf-form-input" id="evBankHolder" maxlength="20" placeholder="예금주" style="flex:1" value="${escapeHtml(bank.holder)}">
                        </div>
                        <input type="text" class="perf-form-input" id="evBankCustom" maxlength="20" placeholder="은행/기관명 직접 입력" style="display:${bank.bank === '기타' ? 'block' : 'none'};margin-bottom:8px" value="${escapeHtml(bank.custom)}">
                        <input type="text" inputmode="numeric" class="perf-form-input" id="evBankAcct" maxlength="30" placeholder="계좌번호 (숫자만 입력해도 됩니다)" value="${escapeHtml(bank.acct)}">
                        <div style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:5px;line-height:1.5">관객이 이 계좌로 입금하면 예매자 관리에서 [입금 확인]을 눌러 확정합니다.</div>
                    </div>
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">공연 소개 *</label>
                    ${docEditorHTML('evDescRte', renderMarkdown(ev?.description || ''), '라인업, 시간표, 관람 안내 등 — 서식(제목·굵게·목록)을 자유롭게 사용하세요')}
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">예매자 질문 (선택 · 최대 5개)</label>
                    <div id="evQList"></div>
                    <button class="gaa-btn gaa-btn-sm gaa-btn-block gaa-btn-secondary" type="button" onclick="addEvQuestionRow()">+ 질문 추가</button>
                    <div style="font-size:0.74rem;color:var(--wds-gray-500);margin-top:5px;line-height:1.5">예매 작성 화면에 표시되고, 답변은 예매자 관리·명단 다운로드에서 볼 수 있습니다. '필수' 체크 시 답변 없이는 예매할 수 없습니다.</div>
                </div>
                <div class="perf-form-group">
                    <label class="perf-form-label">포스터 이미지 (선택)</label>
                    <input type="file" id="evPoster" accept="image/*" onchange="uploadEventPoster(this)" style="font-size:0.84rem">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px">
                        <button type="button" class="gaa-btn gaa-btn-sm gaa-btn-secondary" id="evPosterPickBtn" onclick="openWappenPosterPicker()">🎨 포스터 꾸미기에서 가져오기</button>
                        <span style="font-size:0.74rem;color:var(--wds-gray-500)">포스터 꾸미기에서 저장한 내 작품을 바로 포스터로 씁니다</span>
                    </div>
                    <div id="evPosterStatus" style="font-size:0.78rem;color:var(--wds-gray-500);margin-top:6px">${_hostState.posterUrl ? '✅ 현재 포스터 유지 (새 파일·작품 선택 시 교체)' : ''}</div>
                    <div id="evPosterPreview">${_hostState.posterUrl ? `<img src="${escapeHtml(_hostState.posterUrl)}" alt="포스터 미리보기">` : ''}</div>
                </div>
                <div id="evFormResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:2px 0;color:#e74c3c"></div>
                <button class="gaa-btn gaa-btn-block gaa-btn-primary" id="evSaveBtn" onclick="saveHostEvent(${ev ? `'${jsStr(ev.id)}'` : 'null'})">${ev ? '수정 저장' : '공연 등록'}</button>`;
            _evQuestionsOf(ev).forEach(q => addEvQuestionRow(q)); // 기존 질문 프리필
        }

        // 공연의 질문 배열 — 신형 booking_questions 우선, 구형 단일 컬럼 폴백
        function _evQuestionsOf(ev) {
            if (ev && Array.isArray(ev.booking_questions) && ev.booking_questions.length) return ev.booking_questions;
            if (ev && ev.booking_question) return [{ q: ev.booking_question, required: !!ev.booking_question_required }];
            return [];
        }

        // 질문 입력 행 추가 (최대 5개) — 다른 입력값을 잃지 않도록 전체 재렌더 대신 DOM 추가
        function addEvQuestionRow(q) {
            const list = document.getElementById('evQList');
            if (!list) return;
            if (list.children.length >= 5) { showToast('질문은 최대 5개까지입니다.'); return; }
            const row = document.createElement('div');
            row.className = 'ev-q-row';
            row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px';
            row.innerHTML = `
                <input type="text" class="perf-form-input ev-q-text" maxlength="200" placeholder="예: 어떤 팀을 보러 오시나요?" style="flex:1;margin:0;min-width:0">
                <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;color:var(--wds-gray-700);flex:none;cursor:pointer"><input type="checkbox" class="ev-q-req" style="width:15px;height:15px;cursor:pointer">필수</label>
                <button class="gaa-btn gaa-btn-sm gaa-btn-danger" style="flex:none" type="button" onclick="this.parentElement.remove()" title="질문 삭제">✕</button>`;
            row.querySelector('.ev-q-text').value = (q && q.q) || '';
            row.querySelector('.ev-q-req').checked = !!(q && q.required);
            list.appendChild(row);
        }

        async function uploadEventPoster(input) {
            const st = document.getElementById('evPosterStatus');
            const file = input.files && input.files[0];
            if (!file) return;
            if (!/^image\//.test(file.type)) { if (st) st.textContent = '이미지 파일만 올릴 수 있습니다.'; input.value = ''; return; }
            if (file.size > 5 * 1024 * 1024) { if (st) st.textContent = '5MB 이하 이미지만 올릴 수 있습니다.'; input.value = ''; return; }
            if (st) st.textContent = '업로드 중…';
            try {
                const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
                const path = `events/${Date.now()}.${ext}`;
                const { error } = await supabaseClient.storage.from('community-images').upload(path, file, { cacheControl: '3600', upsert: false });
                if (error) throw error;
                const { data: urlData } = supabaseClient.storage.from('community-images').getPublicUrl(path);
                _hostState.posterUrl = urlData.publicUrl;
                if (st) st.textContent = '✅ 업로드 완료';
                _evPosterPreview();
            } catch (e) {
                if (st) st.textContent = '업로드 실패: ' + (e.message || e);
                input.value = '';
            }
        }
        function _evPosterPreview() {
            const box = document.getElementById('evPosterPreview'); if (!box) return;
            box.innerHTML = _hostState.posterUrl ? `<img src="${escapeHtml(_hostState.posterUrl)}" alt="포스터 미리보기">` : '';
        }

        // ── 포스터 꾸미기(/wappen/) 작품을 공연 포스터로 ──
        // 같은 출처라 localStorage.wappen_session(와펜 로그인 토큰)을 그대로 /wappen-api my_content 에 보낸다.
        // 미리보기(previews/<uid>/…, 1080px JPEG) URL 을 poster_url 로 쓰고, 서버(event-api posterOk)가 wappen 버킷 접두를 허용한다.
        function _wpPickerBox(inner) {
            return `<div style="background:var(--wds-white);border-radius:var(--wds-radius-l);padding:22px 20px;max-width:560px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,0.25);">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                    <h3 style="margin:0;font-size:1rem;font-weight:700;color:var(--wds-black)">포스터 꾸미기에서 가져오기</h3>
                    <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-ghost" onclick="document.getElementById('wpPosterModal')?.remove()">닫기</button>
                </div>${inner}</div>`;
        }
        async function openWappenPosterPicker() {
            document.getElementById('wpPosterModal')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'wpPosterModal';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = _wpPickerBox('<p style="font-size:0.86rem;color:var(--wds-gray-500);margin:0">불러오는 중…</p>');
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
            const openBtn = `<a class="gaa-btn gaa-btn-sm gaa-btn-primary" href="/wappen/" target="_blank" rel="noopener">포스터 꾸미기 열기</a>`;
            const loginHint = `<p class="wp-pick-msg">포스터 꾸미기에 로그인되어 있지 않습니다.<br>포스터 꾸미기에서 카카오 로그인 후 작품을 저장하면 여기서 바로 고를 수 있어요.</p>${openBtn}`;
            let session = null; try { session = localStorage.getItem('wappen_session'); } catch (_) {}
            if (!session) { overlay.innerHTML = _wpPickerBox(loginHint); return; }
            let works = [];
            try {
                const r = await fetch('/wappen-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'my_content', session }) });
                const j = await r.json().catch(() => ({}));
                if (r.status === 401) { overlay.innerHTML = _wpPickerBox(loginHint); return; }
                if (!r.ok || !j.ok) throw new Error(j.message || ('HTTP ' + r.status));
                works = (j.works || []).filter(w => w && w.preview_url);
            } catch (e) {
                console.error('[wappen picker]', e);
                overlay.innerHTML = _wpPickerBox(`<p class="wp-pick-msg">작품을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>${openBtn}`);
                return;
            }
            if (!document.getElementById('wpPosterModal')) return; // 기다리는 동안 닫음
            if (!works.length) { overlay.innerHTML = _wpPickerBox(`<p class="wp-pick-msg">저장한 작품이 없습니다.<br>포스터 꾸미기에서 작품을 저장한 뒤 다시 열어주세요.</p>${openBtn}`); return; }
            state.wpPickerWorks = works;
            overlay.innerHTML = _wpPickerBox(`<p class="wp-pick-msg">작품을 누르면 공연 포스터로 사용합니다. (${works.length}개)</p>
                <div class="wp-pick-grid">${works.map(w => `<button type="button" class="wp-pick" onclick="pickWappenPoster('${jsStr(w.id)}')">
                    <img src="${escapeHtml(w.preview_url)}" alt="" loading="lazy"><span>${escapeHtml(w.title || '제목 없음')}</span><small>${escapeHtml((w.wappen_projects && w.wappen_projects.title) || '')}</small></button>`).join('')}</div>`);
        }
        function pickWappenPoster(id) {
            const w = (state.wpPickerWorks || []).find(x => x.id === id); if (!w) return;
            _hostState.posterUrl = w.preview_url;
            const st = document.getElementById('evPosterStatus'); if (st) st.textContent = `✅ 포스터 꾸미기 작품 「${w.title || '제목 없음'}」 선택됨`;
            const inp = document.getElementById('evPoster'); if (inp) inp.value = '';
            _evPosterPreview();
            document.getElementById('wpPosterModal')?.remove();
        }

        async function saveHostEvent(evId) {
            const res = document.getElementById('evFormResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            if (_hostState.busy) return;
            const title = document.getElementById('evTitle')?.value.trim();
            const startsLocal = document.getElementById('evStartsAt')?.value;
            const venue = document.getElementById('evVenue')?.value.trim();
            const capacity = parseInt(document.getElementById('evCapacity')?.value, 10);
            const maxPer = parseInt(document.getElementById('evMaxPer')?.value, 10) || 4;
            const paid = document.querySelector('input[name="evPriceType"]:checked')?.value === 'paid';
            const price = paid ? (parseInt((document.getElementById('evPrice')?.value || '').replace(/[^\d]/g, ''), 10) || 0) : 0;
            let bank = '';
            if (paid) {
                const sel = document.getElementById('evBankSel')?.value || '';
                const bankName = sel === '기타' ? (document.getElementById('evBankCustom')?.value.trim() || '') : sel;
                // 입력 중 강제 치환은 모바일 IME에서 입력이 씹히는 원인이라 저장 시점에만 정리
                const acct = (document.getElementById('evBankAcct')?.value || '').replace(/[^\d-]/g, '');
                const holder = document.getElementById('evBankHolder')?.value.trim() || '';
                if (!bankName || !acct || !holder) { showErr('입금 계좌의 은행·계좌번호·예금주를 모두 입력해주세요.'); return; }
                bank = `${bankName} ${acct} ${holder}`;
            }
            const desc = rteValue('evDescRte');
            if (desc.length > 12000) { showErr('공연 소개가 너무 깁니다. 내용을 조금 줄여주세요.'); return; }
            if (!desc.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim()) { showErr('공연 소개를 입력해주세요.'); return; }
            if (!title) { showErr('공연명을 입력해주세요.'); return; }
            if (!startsLocal) { showErr('공연 일시를 선택해주세요.'); return; }
            const startsAt = new Date(startsLocal);
            if (isNaN(startsAt)) { showErr('공연 일시를 확인해주세요.'); return; }
            if (!evId && startsAt <= new Date()) { showErr('공연 일시는 미래여야 합니다.'); return; }
            if (!venue) { showErr('장소를 입력해주세요.'); return; }
            const salesLocal = document.getElementById('evSalesOpen')?.value;
            let salesOpenAt = null;
            if (salesLocal) {
                const d = new Date(salesLocal);
                if (isNaN(d)) { showErr('예매 오픈 일시를 확인해주세요.'); return; }
                if (d >= startsAt) { showErr('예매 오픈 일시는 공연 일시보다 앞서야 합니다.'); return; }
                salesOpenAt = d.toISOString();
            }
            if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) { showErr('정원은 1~1000명 사이여야 합니다.'); return; }
            if (paid && price < 1000) { showErr('유료 공연 가격은 1,000원 이상이어야 합니다.'); return; }
            // 검색으로 고른 장소(이름이 그대로면)만 좌표 저장 — 직접 입력·수정 시 좌표 제거
            const pick = (_hostState.venuePick && _hostState.venuePick.name === venue) ? _hostState.venuePick : null;
            const booking_questions = [...document.querySelectorAll('#evQList .ev-q-row')]
                .map(r => ({ q: r.querySelector('.ev-q-text')?.value.trim() || '', required: !!r.querySelector('.ev-q-req')?.checked }))
                .filter(x => x.q).slice(0, 5);
            // 장소 상세설명(주소·찾아오는 길) — 검색 선택 시 주소가 프리필되고, 직접 자유 작성도 가능
            const addrTyped = document.getElementById('evVenueDetail')?.value.trim() || '';
            const event = { title, starts_at: startsAt.toISOString(), venue, capacity, price,
                max_per_booking: maxPer, description: desc, bank_info: bank, poster_url: _hostState.posterUrl || '',
                booking_questions, sales_open_at: salesOpenAt,
                venue_address: addrTyped || (pick ? pick.address : null),
                venue_lat: pick ? pick.lat : null,
                venue_lng: pick ? pick.lng : null };
            const btn = document.getElementById('evSaveBtn');
            _hostState.busy = true;
            if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
            try {
                const out = evId
                    ? await eventApi({ action: 'update_event', kakao_token: _hostState.token, event_id: evId, patch: event })
                    : await eventApi({ action: 'create_event', kakao_token: _hostState.token, host_id: _hostState.curTeamId, event });
                if (!out.ok) { showErr(out.message || '저장에 실패했습니다.'); return; }
                showToast(evId ? '공연이 수정되었습니다.' : '공연이 등록되었습니다!');
                renderHostDashboard();
            } finally {
                _hostState.busy = false;
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            }
        }

        // 예매자 질문 답변 — 신형은 [{q,a}] JSON, 구형은 평문. 각각 표시용으로 변환
        function _answerPairs(raw) {
            if (!raw) return [];
            try { const j = JSON.parse(raw); if (Array.isArray(j)) return j.filter(x => x && x.a); } catch (_) {}
            return [{ q: '', a: String(raw) }];
        }
        function _answerHTML(raw) {
            return _answerPairs(raw).map(x => `${x.q ? `<span style="font-weight:700">${escapeHtml(x.q)}</span> ` : '답변: '}${escapeHtml(x.a)}`).join('<br>');
        }
        function _answerText(raw) {
            return _answerPairs(raw).map(x => (x.q ? x.q + ': ' : '') + x.a).join(' | ');
        }

        // 좌석 단위 입장 현황 — 취소된 좌석 제외, seats가 없는 구버전 데이터는 티켓 checked_in_at으로 폴백
        const _seatProgress = (t) => {
            const all = t.seats || [];
            const seats = all.filter(s => !s.cancelled_at);
            const total = (all.length ? seats.length : (t.qty || 1)) || 1;
            const checked = all.length ? seats.filter(s => s.checked_in_at).length : (t.checked_in_at ? total : 0);
            return { checked, total };
        };
        const _TICKET_STATUS_CHIP = (t) => {
            if (t.status === 'cancelled') return _showChip('취소', '#FEE2E2', '#991B1B');
            const p = _seatProgress(t);
            if (p.checked > 0 && p.checked >= p.total) return _showChip('입장', '#DBEAFE', '#1E40AF');
            if (p.checked > 0) return _showChip(`입장 ${p.checked}/${p.total}`, '#DBEAFE', '#1E40AF');
            if (t.status === 'confirmed') return _showChip('확정', '#DCFCE7', '#166534');
            return _showChip('입금대기', '#FEF3C7', '#92400E');
        };

        async function renderHostAttendees(eventId) {
            const c = document.getElementById('host-container');
            _hostState.curEventId = eventId;
            _pushNav('host/event/' + eventId); // 대시보드에서 직접 진입해도 딥링크·뒤로가기 유지 (같은 경로면 no-op)
            c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wds-gray-500)">명단을 불러오는 중…</div>';
            const out = await eventApi({ action: 'attendees', kakao_token: _hostState.token, event_id: eventId });
            if (!out.ok) {
                if (out.error === 'auth') { _hostState.token = null; renderHostLogin(); return; }
                c.innerHTML = `<p style="text-align:center;padding:40px;color:var(--wds-gray-500)">${escapeHtml(out.message || '불러오지 못했습니다.')}</p>`;
                return;
            }
            _hostState.attEvent = out.event;
            _hostState.attendees = out.tickets;
            _hostState.attCoTeams = out.co_teams || [];
            _hostState.attIsHostTeam = !!out.is_host_team;
            _renderAttendeeList();
        }

        // 공연 공동 관리팀 초대 — 6자리 초대 코드 생성 (받는 팀 소유자가 코드 입력 또는 링크로 수락)
        async function hostEventInvite(eventId) {
            const out = await eventApi({ action: 'create_event_invite', kakao_token: _hostState.token, event_id: eventId });
            if (!out.ok) { showToast(out.message || '초대 생성에 실패했습니다.'); return; }
            const url = location.origin + location.pathname + '?eventjoin=' + out.token;
            _renderInviteBox('coInviteBox', out.token, url,
                `'${out.event.title}' 공연의 공동 관리팀으로 초대합니다!\n초대받은 팀의 소유자가 호스트 센터 → [초대 코드 입력]에 ${out.token} 를 넣고 팀을 선택하면 함께 관리할 수 있어요. (7일간 유효)`);
        }

        // 초대 코드 직접 입력 — 팀원 초대/공연 관리팀 초대 모두 이 입구로 수락
        function renderInviteCodeEntry() {
            const c = document.getElementById('host-container');
            c.innerHTML = `
                <div class="cm-top" style="padding-top:0"><button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="renderHostDashboard()">‹ 대시보드</button></div>
                <div class="perf-section-title">초대 코드 입력</div>
                <p style="font-size:0.82rem;color:var(--wds-gray-700);margin:0 0 14px;line-height:1.6">받은 <strong>6자리 초대 코드</strong>를 입력하세요.<br>팀 합류 초대와 공연 공동 관리 초대 모두 여기서 수락할 수 있습니다.</p>
                <input type="text" class="perf-form-input" id="inviteCodeInput" maxlength="6" placeholder="예: AB3XKP" style="text-transform:uppercase;letter-spacing:0.3em;text-align:center;font-size:1.1rem;font-weight:700">
                <div id="inviteCodeResult" style="font-size:0.86rem;text-align:center;min-height:22px;padding:6px 0 2px;color:#e74c3c"></div>
                <button class="gaa-btn gaa-btn-block gaa-btn-primary" onclick="submitInviteCode()">확인</button>`;
        }

        async function submitInviteCode() {
            const res = document.getElementById('inviteCodeResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            if (res) res.textContent = '';
            const code = (document.getElementById('inviteCodeInput')?.value || '').trim().toUpperCase();
            if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) { showErr('6자리 초대 코드를 확인해주세요.'); return; }
            const out = await eventApi({ action: 'lookup_invite', kakao_token: _hostState.token, token: code });
            if (!out.ok) { showErr(out.message || '초대를 확인하지 못했습니다.'); return; }
            if (out.type === 'team') {
                if (!confirm(`'${out.team.name}' 팀의 공동호스트로 합류할까요?`)) return;
                hostAcceptJoin(code);
                return;
            }
            renderEventJoin(code); // 공연 관리팀 초대 → 참여할 팀 선택 화면
        }

        async function hostRemoveCoTeam(eventId, hostId, name) {
            if (!confirm(`'${name}' 팀을 이 공연의 관리팀에서 제외할까요?`)) return;
            const out = await eventApi({ action: 'remove_co_team', kakao_token: _hostState.token, event_id: eventId, host_id: hostId });
            if (!out.ok) { showToast(out.message || '처리에 실패했습니다.'); return; }
            showToast('관리팀에서 제외했습니다.');
            renderHostAttendees(eventId);
        }

        function _renderAttendeeList() {
            const c = document.getElementById('host-container');
            const ev = _hostState.attEvent;
            const q = (_hostState.attQuery || '').trim().toLowerCase();
            const list = _hostState.attendees.filter(t => !q
                || t.buyer_name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.buyer_phone.includes(q.replace(/\D/g, '') || ' '));
            const act = _hostState.attendees.filter(t => t.status !== 'cancelled');
            const sum = {
                taken: act.reduce((n, t) => n + t.qty, 0),
                confirmed: act.filter(t => t.status === 'confirmed').reduce((n, t) => n + t.qty, 0),
                pending: act.filter(t => t.status === 'pending_payment').reduce((n, t) => n + t.qty, 0),
                checked: act.reduce((n, t) => n + _seatProgress(t).checked, 0),
            };
            const rows = list.map(t => {
                const phone = t.buyer_phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
                const p = _seatProgress(t);
                const seats = t.seats || [];
                let btns = '';
                if (t.status === 'pending_payment') {
                    btns = _hbtn('입금 확인', `hostTicketAction('confirm_payment','${jsStr(t.id)}')`, '#166534', '#B7E4C7')
                         + _hbtn('취소', `hostCancelTicket('${jsStr(t.id)}')`, '#EF4444', '#F5B5B5');
                } else if (t.status === 'confirmed' && p.checked === 0) {
                    btns = (p.total === 1 ? _hbtn('체크인', `hostCheckinByCode('${jsStr(t.code)}')`, '#1E40AF', '#BFDBFE') : '')
                         + _hbtn('확정 취소', `hostTicketAction('revert_payment','${jsStr(t.id)}')`, 'var(--wds-gray-700)', 'var(--wds-gray-300)')
                         + _hbtn('취소', `hostCancelTicket('${jsStr(t.id)}')`, '#EF4444', '#F5B5B5');
                } else if (t.status === 'confirmed' && p.total === 1 && p.checked > 0) {
                    btns = _hbtn('입장 취소', `hostUncheckinSeat('${jsStr((seats[0] || { code: t.code }).code)}')`, 'var(--wds-gray-700)', 'var(--wds-gray-300)');
                }
                // 매수>1 예매 — 티켓(좌석)별 토글: 입장(확정만)·부분 취소 (QR 1개 = 1명)
                const activeSeats = seats.filter(s => !s.cancelled_at);
                const seatChip = (s) => {
                    const sn = `${s.seat_no}${s.transferred_from_name ? '·양도' : ''}`; // 양도받은 좌석 표식(2026-10-20)
                    if (s.cancelled_at) return `<span title="취소된 티켓" style="padding:5px 12px;border-radius:14px;border:1px solid var(--wds-gray-300);color:var(--wds-gray-500);font-size:0.74rem;font-weight:700;text-decoration:line-through;opacity:0.6">${sn}</span>`;
                    if (s.checked_in_at) return `<button onclick="hostUncheckinSeat('${jsStr(s.code)}')" title="입장 취소" style="padding:5px 12px;border-radius:14px;border:none;background:#1E40AF;color:#fff;font-size:0.74rem;font-weight:700;cursor:pointer;font-family:inherit">${sn} ✓</button>`;
                    const num = t.status === 'confirmed'
                        ? `<button onclick="hostCheckinByCode('${jsStr(s.code)}')" title="체크인" style="padding:5px 12px;border-radius:14px 0 0 14px;border:1px solid #BFDBFE;border-right:none;background:none;color:#1E40AF;font-size:0.74rem;font-weight:700;cursor:pointer;font-family:inherit">${sn}</button>`
                        : `<span style="padding:5px 12px;border-radius:14px 0 0 14px;border:1px solid var(--wds-gray-300);border-right:none;color:var(--wds-gray-700);font-size:0.74rem;font-weight:700">${sn}</span>`;
                    const cxl = activeSeats.length > 1
                        ? `<button onclick="hostCancelSeat('${jsStr(s.code)}',${s.seat_no})" title="이 티켓만 취소" style="padding:5px 9px;border-radius:0 14px 14px 0;border:1px solid #F5B5B5;background:none;color:#EF4444;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:inherit">✕</button>`
                        : '';
                    return `<span style="display:inline-flex;align-items:stretch">${num}${cxl}</span>`;
                };
                const seatRow = ((t.status === 'confirmed' || t.status === 'pending_payment') && (p.total > 1 || seats.some(s => s.cancelled_at)) && seats.length) ? `
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
                        <span style="font-size:0.72rem;font-weight:700;color:var(--wds-gray-500)">티켓별</span>
                        ${seats.map(seatChip).join('')}
                    </div>` : '';
                return `<div class="host-card" style="padding:12px${t.status === 'cancelled' ? ';opacity:0.55' : ''}">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        ${_TICKET_STATUS_CHIP(t)}
                        <span style="font-size:0.9rem;font-weight:700;color:var(--wds-black)">${escapeHtml(t.buyer_name)}</span>
                        ${t.transferred_from_name ? _showChip('양도받음 · 원예매 ' + escapeHtml(t.transferred_from_name), '#F1ECFF', '#6B4FD8') : ''}${t.status === 'cancelled' && t.transferred_at ? _showChip('양도로 종료', '#F1ECFF', '#6B4FD8') : ''}
                        <span style="font-size:0.8rem;color:var(--wds-gray-700)">${t.qty}매 · <span style="letter-spacing:0.12em">${escapeHtml(t.code)}</span></span>
                        <a href="tel:${t.buyer_phone}" style="margin-left:auto;font-size:0.8rem;color:var(--wds-gray-700);text-decoration:none">📞 ${phone}</a>
                    </div>
                    ${t.answer ? `<div style="font-size:0.78rem;color:var(--wds-gray-700);background:var(--wds-gray-100);border-radius:8px;padding:6px 9px;margin-top:8px;line-height:1.6">${_answerHTML(t.answer)}</div>` : ''}
                    ${seatRow}
                    ${btns ? `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-top:8px">${btns}</div>` : ''}
                </div>`;
            }).join('');
            c.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" onclick="renderHostDashboard()">‹ 대시보드</button>
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="margin-left:auto" onclick="downloadAttendeesCSV()">명단 다운로드</button>
                </div>
                <div class="perf-section-title" style="margin-bottom:6px">${escapeHtml(ev.title)} — 예매자 관리</div>
                <div style="font-size:0.8rem;color:var(--wds-gray-700);background:var(--wds-gray-100);border-radius:8px;padding:8px 10px;margin-bottom:10px">
                    예매 <strong>${sum.taken}</strong>/${ev.capacity}석 · 확정 ${sum.confirmed} · 입금대기 ${sum.pending} · 입장 ${sum.checked}
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">
                    <span style="font-size:0.74rem;font-weight:700;color:var(--wds-gray-500)">관리팀</span>
                    ${_showChip('주최 · ' + escapeHtml(ev.host_name || ''), '#DBEAFE', '#1E40AF')}
                    ${(_hostState.attCoTeams || []).map(t => `<span class="show-chip" style="background:var(--wds-gray-100);color:var(--wds-gray-700)">${escapeHtml(t.name)}${_hostState.attIsHostTeam ? ` <a href="javascript:void(0)" onclick="hostRemoveCoTeam('${jsStr(ev.id)}','${jsStr(t.id)}','${jsStr(t.name)}')" style="color:#EF4444;text-decoration:none;font-weight:800">✕</a>` : ''}</span>`).join('')}
                    ${_hostState.attIsHostTeam ? `<button class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="hostEventInvite('${jsStr(ev.id)}')">+ 팀 초대</button>` : ''}
                </div>
                <div id="coInviteBox"></div>
                <div style="font-size:0.76rem;color:var(--wds-gray-500);margin-bottom:12px;line-height:1.6">공연 당일: 관객의 QR을 <strong>폰 기본 카메라</strong>로 스캔하면 자동 체크인됩니다. QR이 안 되면 아래 검색창에 예매번호를 입력해 [체크인]을 눌러주세요.</div>
                <input type="text" class="perf-form-input" placeholder="이름 / 예매번호 / 전화번호 검색" value="${escapeHtml(_hostState.attQuery || '')}"
                    oninput="_hostState.attQuery=this.value;_renderAttendeeList();requestAnimationFrame(()=>{const i=document.querySelector('#host-container input');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}})" style="margin-bottom:12px">
                ${rows || '<p style="text-align:center;padding:24px;color:var(--wds-gray-500)">표시할 예매가 없습니다.</p>'}`;
        }

        // 예매자 명단을 서식 있는 엑셀 파일로 다운로드 — 엑셀이 여는 HTML 테이블(.xls) 방식이라
        // 제목·요약·색상 헤더·상태 색·줄무늬까지 표현된다. 티켓 1장 = 1행, 질문별 칸 분리.
        function downloadAttendeesCSV() {
            const ev = _hostState.attEvent;
            const list = _hostState.attendees || [];
            if (!ev || !list.length) { showToast('다운로드할 명단이 없습니다.'); return; }
            const stName = { pending_payment: '입금대기', confirmed: '확정', cancelled: '취소' };
            const fmtDt = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('ko-KR'); };
            // 전화번호는 화면과 동일한 하이픈 형식 — 엑셀이 숫자로 해석해 앞자리 0을 지우는 것도 방지
            const fmtPhone = (v) => String(v || '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
            // 질문별로 칸 분리 — 현재 공연 질문이 헤더가 되고, 예전 질문의 답변은 '기타 답변'으로
            const qCols = _evQuestionsOf(ev).map(x => x.q);
            const perTicket = list.map(t => {
                const ansMap = {}, etc = [];
                _answerPairs(t.answer).forEach(x => {
                    if (x.q && qCols.includes(x.q)) ansMap[x.q] = x.a;
                    else etc.push((x.q ? x.q + ': ' : '') + x.a);
                });
                return { t, ansCells: qCols.map(q => ansMap[q] || ''), etc: etc.join(' | ') };
            });
            const hasEtc = perTicket.some(x => x.etc);
            const heads = ['이름', '연락처', '티켓번호', '상태', '체크인 시각', ...qCols, ...(hasEtc ? ['기타 답변'] : []), '예매번호', '매수', '예매 일시'];
            const act = list.filter(t => t.status !== 'cancelled');
            const sum = {
                taken: act.reduce((n, t) => n + t.qty, 0),
                confirmed: act.filter(t => t.status === 'confirmed').reduce((n, t) => n + t.qty, 0),
                pending: act.filter(t => t.status === 'pending_payment').reduce((n, t) => n + t.qty, 0),
                checked: act.reduce((n, t) => n + _seatProgress(t).checked, 0),
            };
            const ST_STYLE = {
                '입장 완료': 'background:#DBEAFE;color:#1E40AF;font-weight:bold',
                '확정': 'background:#DCFCE7;color:#166534;font-weight:bold',
                '입금대기': 'background:#FEF3C7;color:#92400E;font-weight:bold',
                '취소': 'background:#FEE2E2;color:#991B1B',
            };
            // mso-number-format 텍스트 서식 — 전화번호·코드·날짜가 숫자로 변형되는 것 방지
            const TD = "padding:4pt 8pt;border:0.5pt solid #C9CDD3;mso-number-format:'\\@';white-space:nowrap;vertical-align:middle";
            // 티켓 1장(좌석) = 1행 — 예매 묶음으로 합치지 않고 전 티켓번호를 나열
            let body = '', idx = 0;
            for (const { t, ansCells, etc } of perTicket) {
                const seats = (t.seats && t.seats.length) ? t.seats
                    : [{ code: t.code, seat_no: 1, checked_in_at: t.checked_in_at, cancelled_at: null }];
                for (const s of seats) {
                    const st = (t.status === 'cancelled' || s.cancelled_at) ? '취소'
                        : s.checked_in_at ? '입장 완료' : (stName[t.status] || t.status);
                    const cells = [t.buyer_name, fmtPhone(t.buyer_phone), s.code, st, fmtDt(s.checked_in_at),
                        ...ansCells, ...(hasEtc ? [etc] : []), t.code, t.qty, fmtDt(t.created_at)];
                    const rowStyle = st === '취소' ? 'color:#999999' : (idx % 2 ? 'background:#F5F6F8' : '');
                    body += `<tr style="${rowStyle}">` + cells.map((v, ci) => {
                        const extra = heads[ci] === '상태' ? ';text-align:center;' + (ST_STYLE[st] || '')
                            : (ci === 2 ? ';font-weight:bold;letter-spacing:1pt' : '');
                        return `<td style="${TD}${extra}">${escapeHtml(v == null ? '' : String(v))}</td>`;
                    }).join('') + '</tr>';
                    idx++;
                }
            }
            const nCols = heads.length;
            const meta = `${_showDateStr(ev.starts_at)}${ev.venue ? ' · ' + escapeHtml(ev.venue) : ''}${ev.host_name ? ' · 주최 ' + escapeHtml(ev.host_name) : ''}`;
            const html = `<meta charset="utf-8"><title>예매자 명단</title>
<table style="border-collapse:collapse;font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:10pt">
<tr><td colspan="${nCols}" style="border:none;font-size:15pt;font-weight:bold;padding:8pt 2pt 2pt">${escapeHtml(ev.title || '공연')} — 예매자 명단</td></tr>
<tr><td colspan="${nCols}" style="border:none;color:#667085;padding:0 2pt 2pt">${meta}</td></tr>
<tr><td colspan="${nCols}" style="border:none;font-weight:bold;padding:0 2pt 8pt">예매 ${sum.taken}/${ev.capacity || '-'}석 · 확정 ${sum.confirmed} · 입금대기 ${sum.pending} · 입장 ${sum.checked} <span style="font-weight:normal;color:#667085">(다운로드 ${new Date().toLocaleString('ko-KR')})</span></td></tr>
<tr>${heads.map(h => `<th style="background:#1F2937;color:#FFFFFF;font-weight:bold;padding:5pt 8pt;border:0.5pt solid #111827;white-space:nowrap">${escapeHtml(h)}</th>`).join('')}</tr>
${body}
</table>`;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(['\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
            a.download = `예매자_${String(ev.title || '공연').replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xls`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            showToast('명단 엑셀 파일이 저장되었습니다.');
        }

        async function hostTicketAction(action, ticketId) {
            if (_hostState.busy) return;
            _hostState.busy = true;
            try {
                const out = await eventApi({ action, kakao_token: _hostState.token, ticket_id: ticketId });
                if (!out.ok) showToast(out.message || '처리에 실패했습니다.');
            } finally { _hostState.busy = false; }
            renderHostAttendees(_hostState.curEventId);
        }

        function hostCancelTicket(ticketId) {
            if (!confirm('이 예매를 취소하시겠습니까?\n(입금된 건이면 환불은 별도로 진행해주세요.)')) return;
            hostTicketAction('host_cancel', ticketId);
        }

        // 티켓 1장(좌석) 부분 취소 — 부분 입장 후 남은 미입장 티켓도 취소 가능
        async function hostCancelSeat(code, seatNo) {
            if (!confirm(`${seatNo}번 티켓 1장만 취소할까요?\n(입금된 건이면 환불은 별도로 진행해주세요.)`)) return;
            if (_hostState.busy) return;
            _hostState.busy = true;
            try {
                const out = await eventApi({ action: 'host_cancel_seat', kakao_token: _hostState.token, code });
                if (!out.ok) showToast(out.message || '처리에 실패했습니다.');
                else showToast(out.whole ? '예매가 취소되었습니다.' : `${seatNo}번 티켓이 취소되었습니다.`);
            } finally { _hostState.busy = false; }
            if (_hostState.curEventId) renderHostAttendees(_hostState.curEventId);
        }

        // 입장 취소 — 좌석(티켓 1장) 단위
        async function hostUncheckinSeat(code) {
            if (!confirm('이 티켓의 입장 처리를 취소할까요?')) return;
            if (_hostState.busy) return;
            _hostState.busy = true;
            try {
                const out = await eventApi({ action: 'uncheckin', kakao_token: _hostState.token, code });
                if (!out.ok) showToast(out.message || '처리에 실패했습니다.');
            } finally { _hostState.busy = false; }
            if (_hostState.curEventId) renderHostAttendees(_hostState.curEventId);
        }

        async function hostCheckinByCode(code) {
            if (_hostState.busy) return;
            _hostState.busy = true;
            try {
                const out = await eventApi({ action: 'checkin', kakao_token: _hostState.token, code });
                if (out.ok) {
                    const tk = out.ticket || {};
                    const multi = (tk.seats_total || tk.qty || 1) > 1;
                    showToast(`✅ ${tk.buyer_name || ''} 입장 처리${multi && tk.seats_checked != null ? ` (${tk.seats_checked}/${tk.seats_total})` : ''}`);
                } else showToast(out.message || '체크인에 실패했습니다.');
            } finally { _hostState.busy = false; }
            if (_hostState.curEventId) renderHostAttendees(_hostState.curEventId);
        }

        // QR 딥링크(#host/checkin/CODE) 체크인 — 결과를 큰 패널로 표시
        async function hostDoCheckin(code) {
            const c = document.getElementById('host-container');
            c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wds-gray-500)">체크인 처리 중…</div>';
            const out = await eventApi({ action: 'checkin', kakao_token: _hostState.token, code });
            if (!out.ok && out.error === 'auth') { _hostState.token = null; _hostState.pendingCheckin = code; renderHostLogin(); return; }
            renderCheckinResult(out, code);
        }

        function renderCheckinResult(out, code) {
            const c = document.getElementById('host-container');
            const t = out.ticket || {};
            let panel;
            if (out.ok) {
                const multi = (t.seats_total || t.qty || 1) > 1;
                panel = `<div style="background:#DCFCE7;border-radius:16px;padding:34px 20px;text-align:center">
                    <div style="font-size:3rem;margin-bottom:8px">✅</div>
                    <div style="font-size:1.25rem;font-weight:800;color:#166534;margin-bottom:6px">입장 확인</div>
                    <div style="font-size:1.05rem;font-weight:700;color:#166534">${escapeHtml(t.buyer_name || '')}${multi ? ` · ${t.seat_no || 1}번 티켓` : ' · 1매'}</div>
                    ${multi && t.seats_checked != null ? `<div style="font-size:0.88rem;font-weight:700;color:#166534;margin-top:4px">이 예매 입장 ${t.seats_checked}/${t.seats_total}</div>` : ''}
                    <div style="font-size:0.82rem;color:#166534;opacity:0.8;margin-top:6px">${escapeHtml(t.event_title || '')} · ${escapeHtml(code)}</div>
                </div>`;
            } else if (out.error === 'already_checked_in') {
                const when = out.checked_in_at ? new Date(out.checked_in_at) : null;
                const hm = when && !isNaN(when) ? `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '';
                panel = `<div style="background:#FEF3C7;border-radius:16px;padding:34px 20px;text-align:center">
                    <div style="font-size:3rem;margin-bottom:8px">⚠️</div>
                    <div style="font-size:1.15rem;font-weight:800;color:#92400E;margin-bottom:6px">이미 입장한 티켓입니다</div>
                    <div style="font-size:0.9rem;color:#92400E">${escapeHtml(t.buyer_name || '')}${(t.qty || 1) > 1 && t.seat_no ? ` · ${t.seat_no}번 티켓` : ''}${hm ? ` · ${hm} 입장` : ''}</div>
                </div>`;
            } else if (out.error === 'not_confirmed') {
                panel = `<div style="background:#FEE2E2;border-radius:16px;padding:34px 20px;text-align:center">
                    <div style="font-size:3rem;margin-bottom:8px">💳</div>
                    <div style="font-size:1.15rem;font-weight:800;color:#991B1B;margin-bottom:6px">입금 미확인 티켓</div>
                    <div style="font-size:0.9rem;color:#991B1B;margin-bottom:14px">${escapeHtml(t.buyer_name || '')} · ${t.qty || 1}매 · ${escapeHtml(code)}</div>
                    <button class="gaa-btn gaa-btn-sm gaa-btn-danger" onclick="hostConfirmAndCheckin('${jsStr(t.id || '')}','${jsStr(code)}')">입금 확인 후 바로 체크인</button>
                </div>`;
            } else {
                panel = `<div style="background:#FEE2E2;border-radius:16px;padding:34px 20px;text-align:center">
                    <div style="font-size:3rem;margin-bottom:8px">❌</div>
                    <div style="font-size:1.15rem;font-weight:800;color:#991B1B;margin-bottom:6px">${escapeHtml(out.error === 'cancelled' ? '취소된 티켓입니다' : out.error === 'not_found' ? '없는 예매번호입니다' : '체크인 불가')}</div>
                    <div style="font-size:0.9rem;color:#991B1B">${escapeHtml(out.message || '')} (${escapeHtml(code)})</div>
                </div>`;
            }
            c.innerHTML = `${panel}
                <div style="font-size:0.82rem;color:var(--wds-gray-500);text-align:center;margin-top:16px">📷 다음 관객의 QR을 폰 카메라로 스캔하세요</div>
                <div style="display:flex;gap:8px;margin-top:14px">
                    ${t.event_id ? `<button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" onclick="renderHostAttendees('${jsStr(t.event_id)}')">예매자 명단</button>` : ''}
                    <button class="gaa-btn gaa-btn-sm gaa-btn-secondary" style="flex:1" onclick="showHostSection()">대시보드</button>
                </div>`;
        }

        async function hostConfirmAndCheckin(ticketId, code) {
            if (!ticketId) return;
            const o1 = await eventApi({ action: 'confirm_payment', kakao_token: _hostState.token, ticket_id: ticketId });
            if (!o1.ok) { showToast(o1.message || '입금 확인에 실패했습니다.'); return; }
            hostDoCheckin(code);
        }
