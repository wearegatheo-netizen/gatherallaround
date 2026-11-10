// 게더 올 어라운드 본 스크립트 3/8 (admin) — index.html 이 번호 순서대로 읽는 클래식 스크립트. 전역(함수·let/const)을 서로 공유한다.
// 고친 뒤에는 node tools/stamp-assets.mjs 로 index.html 의 ?v= 를 갱신할 것(tests/assets-unit.mjs 가 검사).

        window.bgmAdminEditTitle = function(idx, value) {
            if (state.bgmTracks && state.bgmTracks[idx]) state.bgmTracks[idx].title = value.trim();
        };
        window.bgmAdminRemove = function(idx) {
            if (!confirm('이 곡을 제거하시겠습니까?')) return;
            state.bgmTracks.splice(idx, 1);
            renderBgmAdminList();
        };
        window.bgmAdminAdd = function() {
            const id = document.getElementById('bgmNewId').value.trim();
            const title = document.getElementById('bgmNewTitle').value.trim();
            if (!id || !title) { showToast('곡 ID와 제목을 모두 입력해주세요.'); return; }
            if (!/^[0-9a-f-]{36}$/i.test(id)) { showToast('Suno 곡 ID는 UUID 형식이어야 합니다.'); return; }
            if ((state.bgmTracks || []).some(t => t.id === id)) { showToast('이미 등록된 곡입니다.'); return; }
            (state.bgmTracks = state.bgmTracks || []).push({ id, title });
            document.getElementById('bgmNewId').value = '';
            document.getElementById('bgmNewTitle').value = '';
            renderBgmAdminList();
        };
        window.bgmAdminSave = async function() {
            const pat = document.getElementById('bgmPat').value.trim();
            const status = document.getElementById('bgmAdminStatus');
            if (!pat) { status.innerHTML = '<span style="color:#e74c3c">❌ PAT을 입력해주세요.</span>'; return; }
            const REPO = 'wearegatheo-netizen/gatherallaround';
            const FILE = 'music.json';
            const BRANCH = 'master';
            status.innerHTML = '<span style="color:var(--wds-gray-500)">⏳ 저장 중...</span>';
            try {
                const cur = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`,
                    { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github+json' } }).then(r => r.json());
                if (!cur.sha) { status.innerHTML = `<span style="color:#e74c3c">❌ 조회 실패: ${cur.message || ''}</span>`; return; }
                const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(state.bgmTracks, null, 2) + '\n')));
                const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
                    method: 'PUT',
                    headers: { Authorization: `token ${pat}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: `BGM: 관리자 페이지에서 ${state.bgmTracks.length}곡 업데이트`,
                        content: newContent, sha: cur.sha, branch: BRANCH
                    })
                });
                const j = await res.json();
                if (res.ok) status.innerHTML = `<span style="color:#00b894">✅ 저장 완료! (${state.bgmTracks.length}곡)</span>`;
                else status.innerHTML = `<span style="color:#e74c3c">❌ 저장 실패: ${j.message || res.status}</span>`;
            } catch (e) {
                status.innerHTML = `<span style="color:#e74c3c">❌ 오류: ${e.message}</span>`;
            }
        };

        // 다중 날짜 선택용 임시 상태
        let multiDates = [];

        function renderAdminBlocksSection(container) {
            const section = document.createElement('div');
            section.className = 'admin-section';
            const dayNames = ['일','월','화','수','목','금','토'];
            const timeOptions = TIMES.map(t => `<option value="${t}">${t}</option>`).join('');
            const endTimeOptions = TIMES.map((t, i) => `<option value="${t}">${TIMES[i + 1] || '23:00'}</option>`).join('');
            const dayOptions = dayNames.map((d,i) => `<option value="${i}">${d}요일</option>`).join('');
            multiDates = [];
            section.innerHTML = `
                <div class="admin-section-title">🚫 시간 차단 관리</div>

                <div class="block-form-card">
                    <div class="block-form-row">
                        <label class="block-form-label">반복 유형</label>
                        <select id="blockRepeat" onchange="onBlockRepeatChange()" class="block-form-input">
                            <option value="weekly">🔄 매주 반복</option>
                            <option value="once">📌 1회 (특정 날짜)</option>
                            <option value="multi">📅 여러 날짜 선택</option>
                        </select>
                    </div>

                    <div id="weeklyOptions" class="block-form-row">
                        <label class="block-form-label">요일</label>
                        <select id="blockDow" class="block-form-input">${dayOptions}</select>
                    </div>

                    <div id="onceOptions" class="block-form-row" style="display:none">
                        <label class="block-form-label">날짜</label>
                        <input type="date" id="blockSingleDate" class="block-form-input">
                    </div>

                    <div id="multiOptions" class="block-form-row" style="display:none;align-items:flex-start">
                        <label class="block-form-label" style="padding-top:8px">날짜 목록</label>
                        <div style="flex:1;min-width:0">
                            <input type="date" id="blockMultiInput" class="block-form-input" onchange="addMultiDate()" aria-label="차단할 날짜 (고르면 바로 목록에 추가)" style="width:100%">
                            <div class="block-form-hint" style="margin-top:4px">날짜를 고르면 바로 목록에 추가돼요. 칩의 ×로 빼기.</div>
                            <div id="multiDateList" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px"></div>
                        </div>
                    </div>

                    <div class="block-form-row">
                        <label class="block-form-label">시간</label>
                        <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:0">
                            <select id="blockStart" class="block-form-input" style="flex:1;min-width:0">${timeOptions}</select>
                            <span style="color:var(--wds-gray-500);font-size:0.85rem">~</span>
                            <select id="blockEnd" class="block-form-input" style="flex:1;min-width:0">${endTimeOptions}</select>
                        </div>
                    </div>

                    <div id="dateRangeRow" class="block-form-row" style="align-items:flex-start">
                        <label class="block-form-label" style="padding-top:8px">적용 기간</label>
                        <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:0;flex-wrap:wrap">
                            <input type="date" id="blockStartDate" class="block-form-input" style="flex:1;min-width:120px" placeholder="시작일">
                            <span style="color:var(--wds-gray-500);font-size:0.85rem">~</span>
                            <input type="date" id="blockEndDate" class="block-form-input" style="flex:1;min-width:120px" placeholder="종료일">
                        </div>
                    </div>

                    <div class="block-form-row">
                        <label class="block-form-label">사유</label>
                        <input type="text" id="blockReason" placeholder="(선택) 예: 정기 점검" class="block-form-input">
                    </div>

                    <button type="button" id="blockAddBtn" class="admin-post-btn" onclick="addTimeBlock()" style="width:100%;margin-top:4px">+ 차단 추가</button>
                    <div id="blockFormResult" style="font-size:0.88rem;text-align:center;min-height:22px;padding:2px 0"></div>
                    <div class="block-form-hint">같은 시간이 이미 차단돼 있으면 추가되지 않고, 일부만 겹치면 확인 뒤 추가됩니다. 고정팀 차단은 고정 합주팀 운영자 화면 › 팀 관리에서, 커뮤니티 모임 차단은 모임과 함께 관리됩니다.</div>
                </div>

                <div class="block-list-header">
                    <span>등록된 차단</span>
                    <span id="blockListCount" class="member-group-count"></span>
                    <span id="blockDupAction" style="margin-left:auto"></span>
                </div>
                <div id="blockList"></div>
            `;
            container.appendChild(section);
            renderBlockList();
        }

        // 날짜 input 의 change 로 바로 추가(2026-11-08, [+ 추가] 버튼 제거) — 같은 날짜는 토스트
        window.addMultiDate = function () {
            const inp = document.getElementById('blockMultiInput');
            const v = inp.value;
            if (!v) return;
            if (multiDates.includes(v)) showToast('이미 목록에 있는 날짜예요.');
            else multiDates.push(v);
            multiDates.sort();
            inp.value = '';
            renderMultiDateList();
        };
        window.removeMultiDate = function (date) {
            multiDates = multiDates.filter(d => d !== date);
            renderMultiDateList();
        };
        function renderMultiDateList() {
            const el = document.getElementById('multiDateList');
            if (!el) return;
            if (multiDates.length === 0) {
                el.innerHTML = '<span style="font-size:0.78rem;color:var(--wds-gray-500)">날짜를 추가해주세요</span>';
                return;
            }
            el.innerHTML = multiDates.map(d => `
                <span class="multi-date-chip">
                    ${d}
                    <button type="button" onclick="removeMultiDate('${d}')" title="제거">×</button>
                </span>`).join('');
        }

        // ── 시간 차단(time_blocks) 공용 판정 (2026-11-08 재점검) ─────────────────────────────
        // 종류: 1회(start_date === end_date, 그 날짜 하루) / 매주 반복(그 외 — 기간 null 은 무기한)
        // end_time 은 마지막 슬롯의 시작(inclusive) — 비교는 전부 TIMES 인덱스로
        const _BLOCK_DAYS = ['일','월','화','수','목','금','토'];
        const _blockToday = () => new Date().toLocaleDateString('en-CA');
        function _blockOnceDate(b) { return b && b.start_date && b.start_date === b.end_date ? b.start_date : null; }
        // 출처: band(고정팀 반복) · sub(고정팀 대체 합주 1회) · community(커뮤니티 모임) · admin(운영 차단)
        // 고정팀 쪽 차단(band·sub)에 band_claim_id 가 있으면 팀 관리(고정 합주팀 운영자 화면)가 주인 — 시간차단 탭에서는 보기만(_blockLocked)
        function _blockSource(b) {
            const r = String((b && b.reason) || '');
            if (r.startsWith('[고정팀 대체]')) return 'sub';
            if (r.startsWith('[고정팀]') || (b && b.band_claim_id)) return 'band';
            if (r.startsWith('[커뮤니티]')) return 'community';
            return 'admin';
        }
        const _blockLocked = (b) => !!(b && b.band_claim_id && (_blockSource(b) === 'band' || _blockSource(b) === 'sub'));
        const _blockLockHint = (b) => _blockSource(b) === 'sub' ? '팀 관리 › 건너뛰기권 [삭제]로 관리' : '팀 관리 › 고정 시간 [해제]로 관리';
        const _BLOCK_SRC_RANK = { band: 0, sub: 1, community: 2, admin: 3 };
        const _blockEndExcl = (b) => TIMES[TIMES.indexOf(b.end_time) + 1] || '23:00';
        const _blockTimeText = (b) => `${b.start_time} ~ ${_blockEndExcl(b)}`;
        const _blockPeriod = (b) => (b.start_date && b.end_date) ? `${b.start_date} ~ ${b.end_date}` : b.start_date ? `${b.start_date} ~` : b.end_date ? `~ ${b.end_date}` : '영구';
        function _blockLabel(b) {
            const once = _blockOnceDate(b);
            if (once) return `${once} (${_BLOCK_DAYS[b.day_of_week]})`;
            return `매주 ${_BLOCK_DAYS[b.day_of_week]}요일 · ${_blockPeriod(b)}`;
        }
        // 한 줄 설명(확인창·오류문): 「2026-11-13 (금) 10:00 ~ 20:00 · 공연」 / 「매주 금요일 18:00 ~ 23:00 (2026-11-06 ~) · [고정팀] 벤더」
        const _blockText = (b) => (_blockOnceDate(b) ? `${_blockOnceDate(b)} (${_BLOCK_DAYS[b.day_of_week]}) ${_blockTimeText(b)}` : `매주 ${_BLOCK_DAYS[b.day_of_week]}요일 ${_blockTimeText(b)} (${_blockPeriod(b)})`) + (b.reason ? ' · ' + b.reason : '');
        // [from, to] 안에 해당 요일 날짜가 있는가 (to null = 무기한 → 항상 있음)
        function _rangeHasDow(from, to, dow) {
            if (!to) return true;
            const d = new Date(from + 'T00:00:00');
            for (let i = 0; i < 7; i++) {
                if (d.toLocaleDateString('en-CA') > to) return false;
                if (d.getDay() === dow) return true;
                d.setDate(d.getDate() + 1);
            }
            return false;
        }
        // 두 차단이 **오늘 이후** 실제로 겹치는가 → 겹치면 { s, e(슬롯 인덱스), from, to(null=무기한) }, 아니면 null
        // · 지난 1회 차단·끝난 반복 차단은 겹침으로 보지 않는다 (종전엔 지난 날짜의 1회 차단 때문에 새 반복 차단을 못 넣었다)
        // · 1회 차단 날짜가 상대 반복 차단의 skip_dates(고정팀 건너뛰는 날)면 안 겹침
        // · 두 기간이 겹쳐도 그 안에 해당 요일 날짜가 없으면 안 겹침
        function timeBlocksOverlap(a, b, todayStr) {
            todayStr = todayStr || _blockToday();
            if (!a || !b || Number(a.day_of_week) !== Number(b.day_of_week)) return null;
            const aS = TIMES.indexOf(a.start_time), aE = TIMES.indexOf(a.end_time), bS = TIMES.indexOf(b.start_time), bE = TIMES.indexOf(b.end_time);
            if (aS < 0 || aE < 0 || bS < 0 || bE < 0) return null;
            const s = Math.max(aS, bS), e = Math.min(aE, bE);
            if (s > e) return null;
            const fromOf = (x) => (x.start_date && x.start_date > todayStr ? x.start_date : todayStr);
            const from = fromOf(a) > fromOf(b) ? fromOf(a) : fromOf(b);
            let to = null;
            [a.end_date, b.end_date].forEach(d => { if (d && (!to || d < to)) to = d; });
            if (to && to < from) return null;
            const ao = _blockOnceDate(a), bo = _blockOnceDate(b);
            if (ao && _blockSkipped(b, ao)) return null;
            if (bo && _blockSkipped(a, bo)) return null;
            if (!_rangeHasDow(from, to, Number(a.day_of_week))) return null;
            return { s, e, from, to };
        }
        function timeBlocksConflict(a, b) { return !!timeBlocksOverlap(a, b); }
        // 새 차단(ins)이 기존 차단들로 오늘 이후 **전부** 막혀 있는가 — 추가해도 달라지는 칸이 없는 완전 중복이면 덮는 차단 목록, 아니면 null
        function blockFullyCovered(ins, blocks, todayStr) {
            todayStr = todayStr || _blockToday();
            const aS = TIMES.indexOf(ins.start_time), aE = TIMES.indexOf(ins.end_time);
            if (aS < 0 || aE < 0 || aS > aE) return null;
            const once = _blockOnceDate(ins);
            const insFrom = ins.start_date && ins.start_date > todayStr ? ins.start_date : todayStr;
            const covering = (blocks || []).filter(b => {
                if (!timeBlocksOverlap(ins, b, todayStr)) return false;
                if (once) return true;                        // 1회: 그 날짜에 적용되는 차단이면 덮는다
                if (_blockOnceDate(b)) return false;          // 반복 차단은 1회 차단이 덮지 못한다
                const bFrom = b.start_date && b.start_date > todayStr ? b.start_date : todayStr;
                if (bFrom > insFrom) return false;             // 늦게 시작하면 앞부분이 빈다
                if (b.end_date && (!ins.end_date || b.end_date < ins.end_date)) return false; // 먼저 끝나면 뒷부분이 빈다
                if ((b.skip_dates || []).some(d => d >= insFrom && (!ins.end_date || d <= ins.end_date))) return false; // 건너뛰는 날이 빈다
                return true;
            });
            if (!covering.length) return null;
            const hit = new Array(aE - aS + 1).fill(false);
            covering.forEach(b => {
                const lo = Math.max(aS, TIMES.indexOf(b.start_time)), hi = Math.min(aE, TIMES.indexOf(b.end_time));
                for (let i = lo; i <= hi; i++) hit[i - aS] = true;
            });
            return hit.every(Boolean) ? covering : null;
        }
        // 완전히 같은 차단(요일·시간·기간·사유 동일) 묶음 — 이중 제출 등으로 생긴 중복. 각 묶음은 2개 이상
        const _blockDupKey = (b) => [b.day_of_week, b.start_time, b.end_time, b.start_date || '', b.end_date || '', String(b.reason || '').trim()].join('|');
        function findDuplicateBlocks(blocks) {
            const groups = {};
            (blocks || []).forEach(b => { const k = _blockDupKey(b); (groups[k] = groups[k] || []).push(b); });
            return Object.values(groups).filter(g => g.length > 1);
        }
        // 묶음에서 지울 것: 고정팀 차단(band_claim_id)은 남기고, 나머지는 먼저 만든 것 하나만 남긴다
        function duplicateBlockExtras(groups) {
            const extras = [];
            (groups || []).forEach(g => {
                const keepBand = g.filter(x => x.band_claim_id);
                const rest = g.filter(x => !x.band_claim_id).sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')) || String(x.id).localeCompare(String(y.id)));
                extras.push(...(keepBand.length ? rest : rest.slice(1)));
            });
            return extras;
        }

        function renderBlockList() {
            const list = document.getElementById('blockList');
            const countEl = document.getElementById('blockListCount');
            const dupEl = document.getElementById('blockDupAction');
            if (!list) return;
            if (dupEl) dupEl.innerHTML = '';
            if (!state.blocks || state.blocks.length === 0) {
                list.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.85rem;padding:14px;text-align:center;background:var(--wds-gray-100);border-radius:var(--wds-radius-s)">등록된 차단이 없습니다.</p>';
                if (countEl) countEl.textContent = '0';
                return;
            }
            if (countEl) countEl.textContent = state.blocks.length;

            // 지난 차단 분리: 특정 날짜는 그 날짜가 지났으면, 매주 반복은 적용 종료일이 지났으면 '지난 차단'
            const todayStr = _blockToday();
            const isPastBlock = (b) => {
                const once = _blockOnceDate(b);
                return once ? once < todayStr : !!(b.end_date && b.end_date < todayStr);
            };
            const pastBlocks = state.blocks.filter(isPastBlock);
            const activeBlocks = state.blocks.filter(b => !isPastBlock(b));
            const weekly = activeBlocks.filter(b => !_blockOnceDate(b));
            const once   = activeBlocks.filter(b =>  _blockOnceDate(b));
            weekly.sort((a,b) => a.day_of_week - b.day_of_week || TIMES.indexOf(a.start_time) - TIMES.indexOf(b.start_time));
            once.sort((a,b) => (a.start_date || '').localeCompare(b.start_date || '') || TIMES.indexOf(a.start_time) - TIMES.indexOf(b.start_time));
            pastBlocks.sort((a,b) => (b.start_date || b.end_date || '').localeCompare(a.start_date || a.end_date || ''));

            // 겹침·중복 표시: 진행 중인 차단끼리만 본다
            const dupGroups = findDuplicateBlocks(activeBlocks);
            const dupIds = new Set(dupGroups.flat().map(b => b.id));
            const overlapsOf = (b) => activeBlocks.filter(x => x.id !== b.id && timeBlocksOverlap(b, x, todayStr));
            const extras = duplicateBlockExtras(dupGroups);
            if (dupEl && extras.length) {
                dupEl.innerHTML = `<button type="button" class="gaa-btn gaa-btn-xs gaa-btn-danger" onclick="cleanupDuplicateBlocks()">중복 ${extras.length}개 정리</button>`;
            }

            const srcChip = (src) => src === 'band' ? '<span class="status-badge sm status-info">고정팀</span>'
                : src === 'sub' ? '<span class="status-badge sm status-info">대체 합주</span>'
                : src === 'community' ? '<span class="status-badge sm status-neutral">커뮤니티</span>' : '';
            const renderOne = (b) => {
                const isOnce = !!_blockOnceDate(b);
                const src = _blockSource(b);
                const locked = _blockLocked(b);   // 팀 관리(고정 합주팀 운영자 화면)가 주인 — 여기서 고치면 claim·건너뛰기권과 어긋난다
                const label = `${isOnce ? '📌' : '🔄'} ${_blockLabel(b)} ${srcChip(src)}${dupIds.has(b.id) ? ' <span class="status-badge sm status-rejected">중복</span>' : ''}`;
                let sub = `${_blockTimeText(b)}${b.reason ? ' · ' + escapeHtml(b.reason) : ''}`;
                if (!isOnce) {
                    const skips = (b.skip_dates || []).filter(d => d >= todayStr).sort();
                    if (skips.length) sub += ` · <span style="color:#b45309">건너뜀 ${skips.map(d => d.slice(5).replace('-', '/')).join(', ')}</span>`;
                }
                let warn = '';
                if (!isPastBlock(b)) {
                    const ov = overlapsOf(b).filter(x => !(dupIds.has(b.id) && _blockDupKey(x) === _blockDupKey(b)));
                    if (ov.length) warn = `<div class="block-list-warn">⚠ 겹침 · ${ov.slice(0, 2).map(x => escapeHtml(_blockText(x))).join(' / ')}${ov.length > 2 ? ` 외 ${ov.length - 2}개` : ''}</div>`;
                }
                const selStart = TIMES.map(t => `<option value="${t}"${t===b.start_time?' selected':''}>${t}</option>`).join('');
                const selEnd   = TIMES.map((t, i) => `<option value="${t}"${t===b.end_time?' selected':''}>${TIMES[i + 1] || '23:00'}</option>`).join('');
                const selDow   = _BLOCK_DAYS.map((d, i) => `<option value="${i}"${i===Number(b.day_of_week)?' selected':''}>${d}요일</option>`).join('');
                const inputStyle = 'font-size:0.78rem;padding:3px 4px;border-radius:4px;border:1px solid var(--wds-gray-300)';
                const editHtml = locked ? '' : `
                        <div class="blk-edit-${b.id}" style="display:none;margin-top:6px">
                            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                                ${isOnce ? '' : `<select id="blk-dw-${b.id}" style="${inputStyle}">${selDow}</select>`}
                                <select id="blk-st-${b.id}" style="${inputStyle}">${selStart}</select>
                                <span style="font-size:0.78rem">~</span>
                                <select id="blk-et-${b.id}" style="${inputStyle}">${selEnd}</select>
                                <input type="text" id="blk-rs-${b.id}" value="${escapeHtml(b.reason||'')}" placeholder="사유" style="${inputStyle};padding:3px 6px;width:90px;height:auto;box-sizing:border-box">
                            </div>
                            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:5px">
                                ${isOnce
                                    ? `<span style="font-size:0.75rem;color:var(--wds-gray-500);white-space:nowrap">날짜</span>
                                       <input type="date" id="blk-sd-${b.id}" value="${b.start_date||''}" style="${inputStyle}">`
                                    : `<span style="font-size:0.75rem;color:var(--wds-gray-500);white-space:nowrap">적용 기간</span>
                                       <input type="date" id="blk-sd-${b.id}" value="${b.start_date||''}" placeholder="시작일" style="${inputStyle}">
                                       <span style="font-size:0.78rem">~</span>
                                       <input type="date" id="blk-ed-${b.id}" value="${b.end_date||''}" placeholder="종료일" style="${inputStyle}">`
                                }
                                <button class="gaa-btn gaa-btn-xs gaa-btn-primary" type="button" onclick="saveBlockEdit('${b.id}')">저장</button>
                                <button type="button" class="gaa-btn gaa-btn-xs gaa-btn-secondary" onclick="cancelBlockEdit('${b.id}')">취소</button>
                            </div>
                            <div class="block-edit-err" id="blk-err-${b.id}"></div>
                        </div>`;
                const lockLine = locked ? `<div class="block-list-lock">🔒 ${_blockLockHint(b)}</div>` : '';
                const btns = locked ? '' : `<div style="display:flex;gap:4px;flex-shrink:0" id="blk-btns-${b.id}">
                        <button class="gaa-btn gaa-btn-xs gaa-btn-primary" type="button" onclick="toggleBlockEdit('${b.id}')">수정</button>
                        <button class="gaa-btn gaa-btn-xs gaa-btn-danger" type="button" onclick="deleteTimeBlock('${b.id}')">삭제</button>
                    </div>`;
                return `<div class="block-list-row${dupIds.has(b.id) ? ' dup' : ''}" id="blk-row-${b.id}" data-src="${src}">
                    <div class="block-list-info" style="flex:1">
                        <div class="block-list-label">${label}</div>
                        <div class="block-list-sub blk-view-${b.id}">${sub}</div>
                        ${warn}${lockLine}${editHtml}
                    </div>
                    ${btns}
                </div>`;
            };

            const sectionHtml = (title, color, arr, pageKey) => {
                if (arr.length === 0) return '';
                const { items, page, totalPages, total } = getPaged(arr, pageKey);
                return `<div class="block-list-section">
                    <div class="block-list-section-title" style="border-left-color:${color}">${title} <span class="member-group-count">${arr.length}</span></div>
                    ${items.map(renderOne).join('')}
                    ${pagerHTML(pageKey, page, totalPages, total)}
                </div>`;
            };

            // 지난 차단: 접힌 영역 (펼침 상태는 페이저 재렌더에도 유지)
            let pastHtml = '';
            if (pastBlocks.length > 0) {
                const open = !!window.__pastBlocksOpen;
                const { items, page, totalPages, total } = getPaged(pastBlocks, 'blockPast');
                pastHtml = `
                    <div class="reply-toggle" style="margin:14px 0 0;text-align:center" onclick="togglePastBlocks()"><span id="pastBlocksToggleText">${open ? '▴' : '▾'} 지난 차단 ${pastBlocks.length}개 ${open ? '접기' : '보기'}</span></div>
                    <div id="pastBlocksList" class="${open ? '' : 'hidden'}" style="margin-top:8px;opacity:0.8">
                        ${items.map(renderOne).join('')}
                        ${pagerHTML('blockPast', page, totalPages, total)}
                    </div>`;
            }

            list.innerHTML = sectionHtml('🔄 매주 반복', '#3366FF', weekly, 'blockWeekly')
                           + sectionHtml('📌 특정 날짜', '#f0a050', once, 'blockOnce')
                           + (weekly.length + once.length === 0 ? '<p style="color:var(--wds-gray-500);font-size:0.85rem;padding:14px;text-align:center;background:var(--wds-gray-100);border-radius:var(--wds-radius-s)">진행 중인 차단이 없습니다.</p>' : '')
                           + pastHtml;
        }

        window.togglePastBlocks = function() {
            window.__pastBlocksOpen = !window.__pastBlocksOpen;
            const el = document.getElementById('pastBlocksList');
            const txt = document.getElementById('pastBlocksToggleText');
            if (!el || !txt) return;
            el.classList.toggle('hidden', !window.__pastBlocksOpen);
            const count = (state.blocks || []).length && txt.textContent.match(/\d+/) ? txt.textContent.match(/\d+/)[0] : '';
            txt.textContent = window.__pastBlocksOpen ? `▴ 지난 차단 ${count}개 접기` : `▾ 지난 차단 ${count}개 보기`;
        }

        window.toggleBlockEdit = function(id) {
            const editDiv = document.querySelector(`.blk-edit-${id}`);
            const viewDiv = document.querySelector(`.blk-view-${id}`);
            const btnsDiv = document.getElementById(`blk-btns-${id}`);
            if (!editDiv || !viewDiv) return;
            const isHidden = editDiv.style.display === 'none' || editDiv.style.display === '';
            editDiv.style.display = isHidden ? 'block' : 'none';
            viewDiv.style.display = isHidden ? 'none' : 'block';
            if (btnsDiv) btnsDiv.style.display = isHidden ? 'none' : 'flex';
        };
        window.cancelBlockEdit = function(id) {
            const editDiv = document.querySelector(`.blk-edit-${id}`);
            const viewDiv = document.querySelector(`.blk-view-${id}`);
            const btnsDiv = document.getElementById(`blk-btns-${id}`);
            if (editDiv) editDiv.style.display = 'none';
            if (viewDiv) viewDiv.style.display = 'block';
            if (btnsDiv) btnsDiv.style.display = 'flex';
        };
        // 겹침 안내문 (추가·수정 공용) — 완전 중복은 막고, 일부 겹침은 확인 뒤 진행
        const _blockOverlapLines = (arr) => [...new Set(arr.map(_blockText))].slice(0, 6).map(t => '• ' + t).join('\n');
        window.saveBlockEdit = async function(id) {
            const b = (state.blocks || []).find(x => x.id === id);
            if (!b) return;
            const errEl = document.getElementById(`blk-err-${id}`);
            const showErr = (m) => { if (errEl) errEl.textContent = m; else showToast(m, 4000); };
            if (errEl) errEl.textContent = '';
            if (saveBlockEdit._busy) return;
            const st = document.getElementById(`blk-st-${id}`)?.value;
            const et = document.getElementById(`blk-et-${id}`)?.value;
            const rs = (document.getElementById(`blk-rs-${id}`)?.value || '').trim();
            if (TIMES.indexOf(st) > TIMES.indexOf(et)) { showErr('시작 시간이 종료 시간보다 늦을 수 없습니다.'); return; }
            const isOnce = !!_blockOnceDate(b);
            const updateData = { start_time: st, end_time: et, reason: rs || null };
            if (isOnce) {
                const newDate = document.getElementById(`blk-sd-${id}`)?.value;
                if (!newDate) { showErr('날짜를 입력해주세요.'); return; }
                updateData.start_date = newDate;
                updateData.end_date = newDate;
                updateData.day_of_week = new Date(newDate + 'T00:00:00').getDay(); // 로컬 자정 파싱
            } else {
                const dowSel = document.getElementById(`blk-dw-${id}`);
                const dow = dowSel ? parseInt(dowSel.value, 10) : Number(b.day_of_week);
                const sd = document.getElementById(`blk-sd-${id}`)?.value || null;
                const ed = document.getElementById(`blk-ed-${id}`)?.value || null;
                if (sd && ed && sd > ed) { showErr('시작일이 종료일보다 늦을 수 없습니다.'); return; }
                if (sd && ed && !_rangeHasDow(sd, ed, dow)) { showErr(`선택한 기간에 ${_BLOCK_DAYS[dow]}요일이 없습니다.`); return; }
                updateData.day_of_week = dow;
                updateData.start_date = sd;
                updateData.end_date = ed;
            }
            saveBlockEdit._busy = true;
            try {
                await fetchBlocks();   // 최신 데이터로 겹침 검사 (자기 자신 제외)
                const others = (state.blocks || []).filter(x => x.id !== id);
                const candidate = { ...b, ...updateData };
                const cover = blockFullyCovered(candidate, others);
                if (cover) { showErr(`이미 전부 차단된 시간입니다: ${_blockText(cover[0])}${cover.length > 1 ? ` 외 ${cover.length - 1}개` : ''}`); return; }
                const ov = others.filter(x => timeBlocksOverlap(candidate, x));
                if (ov.length && !confirm(`일부 시간이 이미 차단되어 있습니다:\n${_blockOverlapLines(ov)}\n\n겹치는 칸은 두 차단이 함께 적용됩니다. 그래도 저장할까요?`)) return;
                const { error } = await supabaseClient.from('time_blocks').update(updateData).eq('id', id);
                if (error) { console.error('time_block update:', error); showErr('수정하지 못했습니다. (' + error.message + ')'); return; }
                const cur = (state.blocks || []).find(x => x.id === id);
                if (cur) Object.assign(cur, updateData);
                renderBlockList();
                render();   // 예약 달력 그리드에도 차단 변경 반영
                showToast('시간 차단을 수정했습니다.');
            } finally { saveBlockEdit._busy = false; }
        };

        function onBlockRepeatChange() {
            const type = document.getElementById('blockRepeat').value;
            document.getElementById('weeklyOptions').style.display   = type === 'weekly' ? 'flex' : 'none';
            document.getElementById('dateRangeRow').style.display    = type === 'weekly' ? 'flex' : 'none';
            document.getElementById('onceOptions').style.display     = type === 'once' ? 'flex' : 'none';
            document.getElementById('multiOptions').style.display    = type === 'multi' ? 'flex' : 'none';
            const res = document.getElementById('blockFormResult'); if (res) res.textContent = '';
            if (type === 'multi') renderMultiDateList();
        }

        async function addTimeBlock() {
            const btn = document.getElementById('blockAddBtn');
            const res = document.getElementById('blockFormResult');
            const showErr = (msg) => { if (res) { res.textContent = msg; res.style.color = '#e74c3c'; } };
            const showInfo = (msg) => { if (res) { res.textContent = msg; res.style.color = 'var(--wds-gray-600)'; } };
            if (res) res.textContent = '';
            if (addTimeBlock._busy) return;   // 빠른 두 번 클릭 → 같은 차단이 두 개 생기던 것(두 요청 모두 검사 통과) 차단
            const type = document.getElementById('blockRepeat').value;
            const startTime = document.getElementById('blockStart').value;
            const endTime = document.getElementById('blockEnd').value;
            const reason = document.getElementById('blockReason').value.trim();
            if (TIMES.indexOf(startTime) > TIMES.indexOf(endTime)) { showErr('시작 시간이 종료 시간보다 늦을 수 없습니다.'); return; }
            const dowOf = (ds) => new Date(ds + 'T00:00:00').getDay();
            const mk = (dow, sd, ed) => ({ day_of_week: dow, start_time: startTime, end_time: endTime, reason: reason || null, start_date: sd, end_date: ed });
            const todayStr = _blockToday();
            const inserts = [];
            if (type === 'once') {
                const d = document.getElementById('blockSingleDate').value;
                if (!d) { showErr('날짜를 선택해주세요.'); return; }
                if (d < todayStr) { showErr('이미 지난 날짜입니다.'); return; }
                inserts.push(mk(dowOf(d), d, d));
            } else if (type === 'multi') {
                if (multiDates.length === 0) { showErr('날짜를 1개 이상 추가해주세요.'); return; }
                const future = multiDates.filter(d => d >= todayStr);
                if (!future.length) { showErr('모두 지난 날짜입니다.'); return; }
                future.forEach(d => inserts.push(mk(dowOf(d), d, d)));
            } else {
                const dow = parseInt(document.getElementById('blockDow').value, 10);
                const sd = document.getElementById('blockStartDate').value || null;
                const ed = document.getElementById('blockEndDate').value || null;
                if (sd && ed && sd > ed) { showErr('시작일이 종료일보다 늦을 수 없습니다.'); return; }
                if (ed && ed < todayStr) { showErr('종료일이 이미 지났습니다.'); return; }
                if (sd && ed && !_rangeHasDow(sd, ed, dow)) { showErr(`선택한 기간(${sd} ~ ${ed})에 ${_BLOCK_DAYS[dow]}요일이 없습니다.`); return; }
                // 시작일 = 종료일이면 하루짜리 → 1회 차단과 같은 모양(start_date === end_date)으로 저장되므로 요일이 그 날짜와 같아야 한다(위 검사)
                inserts.push(mk(dow, sd, ed));
            }

            addTimeBlock._busy = true;
            if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = '추가 중…'; }
            try {
                // 기존 차단과 비교 (최신 데이터로): 완전 중복(추가해도 달라지는 칸 없음)은 건너뛰고, 일부 겹침은 확인 뒤 진행
                await fetchBlocks();
                const blocks = state.blocks || [];
                const skipped = [], partial = [], todo = [];
                for (const ins of inserts) {
                    const cover = blockFullyCovered(ins, blocks, todayStr);
                    if (cover) { skipped.push({ ins, by: cover }); continue; }
                    const ov = blocks.filter(b => timeBlocksOverlap(ins, b, todayStr));
                    if (ov.length) partial.push(...ov);
                    todo.push(ins);
                }
                if (!todo.length) {
                    const by = skipped.flatMap(s => s.by);
                    showErr(`이미 전부 차단된 시간입니다: ${[...new Set(by.map(_blockText))].slice(0, 3).join(' / ')}`);
                    return;
                }
                if (partial.length && !confirm(`일부 시간이 이미 차단되어 있습니다:\n${_blockOverlapLines(partial)}\n\n겹치는 칸은 두 차단이 함께 적용됩니다. 그래도 추가할까요?`)) {
                    showInfo('추가를 취소했습니다.'); return;
                }
                const { error } = await supabaseClient.from('time_blocks').insert(todo);
                if (error) { console.error('time_block insert:', error); showErr('차단을 추가하지 못했습니다. (' + error.message + ')'); return; }
                multiDates = [];
                await fetchBlocks();
                renderBlockList();   // 관리자 탭의 차단 목록 즉시 갱신
                render();            // 예약 달력 그리드에도 차단 반영
                showToast(`시간 차단 ${todo.length}개를 추가했습니다${skipped.length ? ` · 이미 차단된 ${skipped.length}개 날짜는 건너뜀` : ''}.`);
                if (skipped.length) showInfo(`건너뜀(이미 차단됨): ${skipped.map(s => s.ins.start_date).join(', ')}`);
            } finally {
                addTimeBlock._busy = false;
                if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || '+ 차단 추가'; }
            }
        }

        async function deleteTimeBlock(id) {
            const b = (state.blocks || []).find(x => x.id === id);
            const src = b ? _blockSource(b) : 'admin';
            if (b && _blockLocked(b)) { showToast(`고정팀 차단은 고정 합주팀 운영자 화면 › ${_blockLockHint(b).replace('팀 관리 › ', '').replace('로 관리', '')}로 지워주세요.`, 5000); return; }
            let msg = (b ? _blockText(b) + '\n\n' : '') + '이 시간 차단을 해제하시겠습니까?';
            if (src === 'community') msg += '\n(커뮤니티 모임 자체는 남습니다 — 모임을 없애려면 커뮤니티에서 삭제하세요)';
            if (src === 'sub') msg += '\n(고정팀 대체 합주 — 팀 카드의 건너뛰기권 기록은 그대로 남습니다)';
            if (!confirm(msg)) return;
            const { error } = await supabaseClient.from('time_blocks').delete().eq('id', id);
            if (error) { console.error('time_block delete:', error); showToast('삭제하지 못했습니다. (' + error.message + ')', 4000); return; }
            await fetchBlocks();
            renderBlockList();   // 관리자 탭의 차단 목록 즉시 갱신
            render();            // 예약 달력 그리드에도 차단 반영
            showToast('시간 차단을 해제했습니다.');
        }

        // 완전히 같은 차단(요일·시간·기간·사유)이 두 개 이상이면 하나만 남기고 지운다 — 고정팀 차단(band_claim_id)은 지우지 않는다
        window.cleanupDuplicateBlocks = async function() {
            await fetchBlocks();
            const groups = findDuplicateBlocks(state.blocks || []);
            const extras = duplicateBlockExtras(groups);
            if (!extras.length) { showToast('정리할 중복 차단이 없습니다.'); renderBlockList(); return; }
            const lines = [...new Set(groups.map(g => _blockText(g[0])))].slice(0, 6).map(t => '• ' + t).join('\n');
            if (!confirm(`완전히 같은 차단이 두 번 이상 등록되어 있습니다 (${groups.length}묶음):\n${lines}\n\n각 묶음에 하나씩만 남기고 ${extras.length}개를 지울까요?`)) return;
            const ids = extras.map(x => x.id);
            const { error } = await supabaseClient.from('time_blocks').delete().in('id', ids);
            if (error) { console.error('time_block dedupe:', error); showToast('중복을 정리하지 못했습니다. (' + error.message + ')', 5000); return; }
            await fetchBlocks();
            renderBlockList();
            render();
            showToast(`중복 차단 ${ids.length}개를 정리했습니다.`);
        };

        function renderAdminApprovalSection(container) {
            // 승인 대기 — 공간 대관 입금 대기 가상 행(__perf, id 'perf-…')은 reservations 표에 없으므로 승인/거절 대상이 아니다(2026-11-07: 승인 누르면 uuid 오류).
            // 달력 자리만 차지하게 두고 여기선 건수 안내 + 공간대관 탭으로 보낸다.
            const perfPending = state.reservations.filter(r => r.status === 'pending' && r.__perf);
            const allPending = state.reservations.filter(r => r.status === 'pending' && !r.__perf).sort((a, b) => new Date(a.res_date) - new Date(b.res_date));
            const pendingSection = document.createElement('div');
            pendingSection.className = 'admin-section';
            pendingSection.innerHTML = `<div class="admin-section-title">⏳ 승인 대기 (${allPending.length}건)</div>`;
            if (perfPending.length) pendingSection.innerHTML += `<div class="admin-perf-pending-note" style="font-size:0.8rem;color:var(--wds-gray-500);padding:0 0 8px">🎭 공간 대관 입금 대기 ${perfPending.length}건은 달력에서 자리만 차지하며, 입금 확인·승인은 ${isSuper() ? `<a href="#" onclick="event.preventDefault();state.adminTab='perfbooking';renderGatheOAdmin()">공간대관 탭</a>` : '공간대관 탭'}에서 합니다.</div>`;
            if (allPending.length === 0) {
                pendingSection.innerHTML += '<p style="text-align:center;padding:20px;color:var(--wds-gray-500);">대기 중인 예약이 없습니다.</p>';
            } else {
                const { items: pending, page: pp, totalPages: ptp, total: pt } = getPaged(allPending, 'adminPending');
                const pendingList = document.createElement('div'); pendingList.className = 'my-res-list';
                pending.forEach(r => {
                    const endTimeDisplay = TIMES[TIMES.indexOf(r.end_time) + 1] || '23:00';
                    const item = document.createElement('div'); item.className = 'my-res-item';
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
                            <div class="my-res-date">${r.res_date} <span style="font-size:0.8rem;color:var(--wds-gray-500);font-weight:normal">(${escapeHtml(r.user_name)})</span></div>
                            <div class="my-res-time">${r.start_time} ~ ${endTimeDisplay}</div>
                        </div>
                        <div>
                            ${canApproveRes() ? `<button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="approveReservation('${r.id}')">승인</button>` : ''}
                            ${canCancelRes() ? `<button class="gaa-btn gaa-btn-sm gaa-btn-danger" type="button" onclick="rejectReservation('${r.id}')">거절</button>` : ''}
                        </div>
                        ${membersLine}${etcLine}`;
                    pendingList.appendChild(item);
                });
                pendingSection.appendChild(pendingList);
                pendingSection.insertAdjacentHTML('beforeend', pagerHTML('adminPending', pp, ptp, pt));
            }
            container.appendChild(pendingSection);

            // 승인된 예약 (총괄은 지나간 예약도 표시)
            const todayStr = new Date().toLocaleDateString('en-CA');
            const allApproved = state.reservations
                .filter(r => r.status === 'approved' && (isSuper() || r.res_date >= todayStr))
                .sort((a, b) => b.res_date.localeCompare(a.res_date) || b.start_time.localeCompare(a.start_time));
            const approvedSection = document.createElement('div');
            approvedSection.className = 'admin-section';
            approvedSection.innerHTML = `<div class="admin-section-title">✅ 승인된 예약 (${allApproved.length}건)</div>`;
            if (allApproved.length === 0) {
                approvedSection.innerHTML += '<p style="text-align:center;padding:16px;color:var(--wds-gray-500);font-size:0.85rem;">승인된 예약이 없습니다.</p>';
            } else {
                const { items: approved, page: ap, totalPages: atp, total: at } = getPaged(allApproved, 'adminApproved');
                const approvedList = document.createElement('div');
                approvedList.className = 'admin-member-list';
                approved.forEach(r => {
                    const endTimeDisplay = TIMES[TIMES.indexOf(r.end_time) + 1] || '23:00';
                    const item = document.createElement('div');
                    item.className = 'admin-member-row';
                    item.id = `admin-res-row-${r.id}`;
                    item.dataset.resDate = r.res_date;
                    item.dataset.startTime = r.start_time;
                    item.dataset.endTime = r.end_time;
                    item.dataset.userName = r.user_name;
                    item.dataset.etc = r.participant_etc || '';
                    item.style.cssText = 'flex-wrap:wrap;row-gap:4px';
                    const etcLine = canApproveRes() && r.participant_etc
                        ? `<div style="flex-basis:100%;font-size:0.74rem;color:#e07b00;padding-top:2px;padding-left:2px">📝 기타: ${escapeHtml(r.participant_etc)}</div>`
                        : '';
                    const pNames = canApproveRes() ? participantNames(r) : '';
                    const membersLine = pNames
                        ? `<div style="flex-basis:100%;font-size:0.74rem;color:var(--wds-primary);padding-top:2px;padding-left:2px">👥 멤버: ${escapeHtml(pNames)}</div>`
                        : '';
                    // 공간 대관 가상 행(id 'perf-…')은 reservations 테이블에 없다 —
                    // 일반 수정/취소를 연결하면 uuid 오류. 공간대관 탭으로 안내한다.
                    const isPerf = !!r.__perf;
                    const sideBtns = isPerf
                        ? `${isSuper() ? `<button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="state.adminTab='perfbooking';renderGatheOAdmin()">공간대관 탭</button>` : ''}
                           ${canCancelRes() ? `<button class="gaa-btn gaa-btn-sm gaa-btn-danger" type="button" onclick="cancelPerfReservation('${r.id.replace(/^perf-/, '')}')">취소</button>` : ''}`
                        : `${isSuper() ? `<button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="editResInfo('${r.id}')">수정</button>` : ''}
                           ${canCancelRes() ? `<button class="gaa-btn gaa-btn-sm gaa-btn-danger" type="button" onclick="cancelReservation('${r.id}', true)">취소</button>` : ''}`;
                    item.innerHTML = `
                        <div class="admin-member-main">
                            <span style="font-size:0.82rem;font-weight:700;white-space:nowrap">${r.res_date}</span>
                            <span style="font-size:0.78rem;color:var(--wds-gray-500);white-space:nowrap;padding-left:4px">${r.start_time}–${endTimeDisplay}</span>
                            <span style="font-size:0.82rem;font-weight:600;padding-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${isPerf ? '🎭 ' : ''}${escapeHtml(r.user_name)}</span>
                        </div>
                        <div class="admin-member-side">
                            ${sideBtns}
                        </div>
                        ${membersLine}${etcLine}`;
                    approvedList.appendChild(item);
                });
                approvedSection.appendChild(approvedList);
                approvedSection.insertAdjacentHTML('beforeend', pagerHTML('adminApproved', ap, atp, at));
            }
            container.appendChild(approvedSection);
        }

        async function renderAdminMembersSection(container) {
            const dashSection = document.createElement('div');
            dashSection.className = 'admin-section';
            dashSection.innerHTML = `<div class="admin-section-title">📊 멤버 대시보드</div><div id="memberDash"><p style="color:var(--wds-gray-500);font-size:0.9rem">불러오는 중...</p></div>`;
            container.appendChild(dashSection);

            const roleSection = document.createElement('div');
            roleSection.className = 'admin-section';
            const ROLE_MATRIX = [
                            ['합주실 예약 신청',                 '✅', '✅', '✅', '✅'],
                            ['예약 즉시 확정 (승인 불필요)',     '✅', '✅', '✅', '2시간 이하만'],
                            ['미래 예약 가능 기간',              '제한 없음', '제한 없음', '제한 없음', '최대 2개월'],
                            ['다른 팀원 예약 승인 / 거절',      '✅', '✅', '✅', '—'],
                            ['모든 예약 강제 취소',             '✅', '—', '—', '—'],
                            ['달력 클릭으로 예약 취소',         '✅', '—', '—', '—'],
                            ['예약 메모(기타) 전체 열람',       '✅', '✅', '✅', '내 것만'],
                            ['신규 멤버 가입 승인',             '✅', '✅', '✅', '—'],
                            ['멤버 이용 차단',                  '✅', '✅', '—', '—'],
                            ['멤버 역할 변경',                  '✅', '—', '—', '—'],
                            ['공지사항 작성 · 수정',            '✅', '✅', '—', '—'],
                            ['투표 만들기 · 관리',              '✅', '✅', '✅', '—'],
                            ['운영 안내 문서 관리',             '✅', '✅', '✅', '—'],
                            ['전체 푸시 알림 발송',             '✅', '✅', '✅', '—'],
                            ['예약 불가 시간 설정 · BGM',       '✅', '—', '—', '—'],
                        ];
            const ROLE_HEADS = [['운영 총괄', '#e04000'], ['총괄', '#3366FF'], ['세션장', '#00b894'], ['일반', '#999']];
            // 폰(≤640px)에선 가로 600px 표 대신 기능별 카드(2026-11-09 QA) — CSS 가 폭에 따라 하나만 보인다
            const roleCards = ROLE_MATRIX.map(row => `<div class="role-card"><div class="role-card-title">${row[0]}</div><div class="role-card-grid">${ROLE_HEADS.map(([h, c], k) => `<div><span style="color:${c}">${h}</span><b class="${row[k + 1] === '—' ? 'no' : ''}">${row[k + 1]}</b></div>`).join('')}</div></div>`).join('');
            roleSection.innerHTML = `
                <div class="admin-section-title">🔐 권한 안내</div>
                <div class="role-cards">${roleCards}</div>
                <div class="role-table-wrap" style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;font-size:0.82rem;min-width:600px">
                    <thead>
                        <tr style="background:var(--wds-gray-100)">
                            <th style="padding:10px 8px;text-align:left;border-bottom:2px solid var(--wds-gray-300);white-space:nowrap">기능 / 권한</th>
                            <th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--wds-gray-300);color:#e04000;white-space:nowrap">운영 총괄</th>
                            <th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--wds-gray-300);color:#3366FF;white-space:nowrap">총괄</th>
                            <th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--wds-gray-300);color:#00b894;white-space:nowrap">세션장</th>
                            <th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--wds-gray-300);color:#999;white-space:nowrap">일반</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ROLE_MATRIX.map((row, i) => `
                            <tr style="${i % 2 === 0 ? 'background:white' : 'background:var(--wds-gray-100)'}">
                                <td style="padding:8px;border-bottom:1px solid var(--wds-gray-200)">${row[0]}</td>
                                <td style="padding:8px;text-align:center;border-bottom:1px solid var(--wds-gray-200);font-weight:600;color:#e04000">${row[1]}</td>
                                <td style="padding:8px;text-align:center;border-bottom:1px solid var(--wds-gray-200);font-weight:600">${row[2]}</td>
                                <td style="padding:8px;text-align:center;border-bottom:1px solid var(--wds-gray-200);font-weight:600">${row[3]}</td>
                                <td style="padding:8px;text-align:center;border-bottom:1px solid var(--wds-gray-200);font-weight:600;color:var(--wds-gray-600)">${row[4]}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
                </div>
                <div style="margin-top:12px;padding:12px 14px;background:var(--wds-primary-light);border-radius:var(--wds-radius-s);font-size:0.8rem;color:var(--wds-gray-700);line-height:1.8">
                    <div style="font-weight:700;margin-bottom:6px">📋 역할 설명</div>
                    <div>🔴 <strong>운영 총괄</strong> — 모든 기능을 사용할 수 있는 최고 관리자</div>
                    <div>🔵 <strong>총괄</strong> — 예약 관리, 멤버 승인, 공지 작성 등 대부분 가능</div>
                    <div>🟢 <strong>세션장</strong> — 예약 승인, 멤버 승인, 투표 관리 가능</div>
                    <div>⚪ <strong>일반</strong> — 본인 예약 신청만 가능 (일부 기능 제한)</div>
                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--wds-gray-300)">✋ <strong>역할 변경</strong>은 운영 총괄만 가능하며, 아래 멤버 목록에서 직접 지정합니다.</div>
                </div>
            `;
            container.appendChild(roleSection);

            const memberSection = document.createElement('div');
            memberSection.className = 'admin-section';
            memberSection.innerHTML = `<div class="admin-section-title">👥 멤버 목록</div>
                ${canApproveRes() ? `<div style="margin-bottom:10px;display:flex;justify-content:flex-end">
                    <button class="gaa-btn gaa-btn-sm gaa-btn-primary" onclick="downloadMembersCsv()">⬇️ 멤버 목록 엑셀(CSV) 다운로드</button>
                </div>` : ''}
                <div style="margin-bottom:10px">
                    <input type="text" id="memberSearchInput" placeholder="이름, 세션, 연락처 검색..." oninput="filterAdminMemberList()"
                        style="width:100%;height:38px;padding:0 12px;border:1px solid var(--wds-gray-300);border-radius:8px;font-size:0.88rem;font-family:inherit;outline:none;box-sizing:border-box">
                </div>
                <div id="memberList"></div>`;
            container.appendChild(memberSection);

            const members = await fetchMembers();

            // 대시보드 통계
            const dashEl = document.getElementById('memberDash');
            if (!dashEl) return; // 탭을 바꾼 뒤 도착한 응답(2026-11-09 QA: null 에 innerHTML 쓰던 오류)
            const total = members.length;
            const pending = members.filter(m => m.status === 'pending').length;
            const approved = members.filter(m => m.status === 'approved').length;
            const rejected = members.filter(m => m.status === 'rejected').length;
            const opSupers = members.filter(m => m.role === '운영 총괄').length;
            const supers = members.filter(m => m.role === '총괄').length;
            const leaders = members.filter(m => m.role === '세션장').length;
            const normals = members.filter(m => !m.role || m.role === '일반').length;
            const instMembers = {};
            members.filter(m => m.status === 'approved' && m.instruments).forEach(m => {
                m.instruments.split(',').forEach(inst => {
                    const i = inst.trim();
                    if (i) (instMembers[i] = instMembers[i] || []).push(m.name);
                });
            });
            const instList = Object.entries(instMembers).sort((a,b) => b[1].length - a[1].length);
            const namesOf = (filter) => members.filter(filter).map(m => m.name);
            const statCard = (label, value, color, names) => {
                const namesHtml = names && names.length > 0 ? `<div class="stat-names">${names.join(', ')}</div>` : '';
                return `<div class="stat-card" style="border-left:4px solid ${color}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${namesHtml}</div>`;
            };
            dashEl.innerHTML = `
                <div class="stat-grid">
                    ${statCard('전체', total, '#3366FF')}
                    ${statCard('승인됨', approved, '#00b894', namesOf(m => m.status === 'approved'))}
                    ${statCard('대기', pending, '#f0a050', namesOf(m => m.status === 'pending'))}
                    ${statCard('거절', rejected, '#e74c3c', namesOf(m => m.status === 'rejected'))}
                </div>
                <div style="margin-top:14px;font-size:0.85rem;color:var(--wds-gray-700);font-weight:600">권한 분포</div>
                <div class="stat-grid" style="margin-top:6px">
                    ${opSupers > 0 ? statCard('운영 총괄', opSupers, '#e04000', namesOf(m => m.role === '운영 총괄')) : ''}
                    ${statCard('총괄', supers, '#3366FF', namesOf(m => m.role === '총괄'))}
                    ${statCard('세션장', leaders, '#00b894', namesOf(m => m.role === '세션장'))}
                    ${statCard('일반', normals, '#999', namesOf(m => !m.role || m.role === '일반'))}
                </div>
                ${instList.length > 0 ? `
                <div style="margin-top:14px;font-size:0.85rem;color:var(--wds-gray-700);font-weight:600">세션 분포 (승인된 멤버)</div>
                <div class="stat-grid" style="margin-top:6px">
                    ${instList.map(([k, names]) => statCard(k, names.length, '#3366FF', names)).join('')}
                </div>` : ''}
            `;

            state.allMembers = members;
            const memberList = document.getElementById('memberList');
            if (!members || members.length === 0) {
                memberList.innerHTML = '<p style="color:var(--wds-gray-500);font-size:0.9rem">회원이 없습니다.</p>';
                return;
            }
            renderAdminMemberListEl(memberList);
        }

        function renderAdminMemberListEl(memberList) {
            const members = state.allMembers;
            if (!members || members.length === 0) return;
            const isS = isSuper();
            const roleColors = { '운영 총괄': '#e04000', '총괄': '#3366FF', '세션장': '#00b894', '일반': '#999' };
            const statusMap = { pending: ['status-pending', '대기'], approved: ['status-approved', '승인'], rejected: ['status-rejected', '거절'] };

            const renderAdminItem = (m) => {
                const [sc, st] = statusMap[m.status] || statusMap['pending'];
                const date = new Date(m.created_at).toLocaleDateString('ko-KR');
                const role = m.role || '일반';
                const roleColor = roleColors[role] || '#999';
                const insts = (m.instruments || '').split(',').map(s=>s.trim()).filter(Boolean);
                let actions = '';
                if (m.status === 'pending') {
                    if (canApproveMember()) actions += `<button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="approveMember('${m.id}')">승인</button>`;
                    if (canBanMember())     actions += `<button class="gaa-btn gaa-btn-sm gaa-btn-danger" type="button"  onclick="rejectMember('${m.id}')">거절</button>`;
                } else if (m.status === 'approved') {
                    if (canBanMember())     actions += `<button class="gaa-btn gaa-btn-sm gaa-btn-danger" type="button"  onclick="rejectMember('${m.id}')">차단</button>`;
                } else {
                    if (canApproveMember()) actions += `<button class="gaa-btn gaa-btn-sm gaa-btn-primary" type="button" onclick="approveMember('${m.id}')">재승인</button>`;
                }
                const roleSelect = isS ? `
                    <select onchange="updateMemberRole('${m.id}', this.value)" style="font-size:0.7rem;padding:2px 4px;border:1px solid var(--wds-gray-300);border-radius:4px;color:${roleColor};background:white">
                        <option value="일반" ${role==='일반'?'selected':''}>일반</option>
                        <option value="세션장" ${role==='세션장'?'selected':''}>세션장</option>
                        <option value="총괄" ${role==='총괄'?'selected':''}>총괄</option>
                        <option value="운영 총괄" ${role==='운영 총괄'?'selected':''}>운영 총괄</option>
                    </select>` : '';
                const contactInfo = isS
                    ? `<span style="font-size:0.7rem;color:var(--wds-gray-500);white-space:nowrap">${escapeHtml(m.email || '카카오')}</span>${m.phone ? `<span style="font-size:0.7rem;color:var(--wds-primary);white-space:nowrap;cursor:pointer;text-decoration:underline;text-underline-offset:2px" title="클릭하여 복사" onclick="(function(el,t){const p='${jsStr(m.phone)}';if(navigator.clipboard){navigator.clipboard.writeText(p).then(function(){el.textContent='✓ 복사됨';setTimeout(function(){el.textContent=p},1200)})}else{const ta=document.createElement('textarea');ta.value=p;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);el.textContent='✓ 복사됨';setTimeout(function(){el.textContent=p},1200)}})(this)">${escapeHtml(m.phone)}</span>` : `<span style="font-size:0.7rem;color:var(--wds-gray-400);white-space:nowrap">-</span>`}`
                    : '';
                const editBtn = (isHiddenMember(m) ? '<span class="status-badge sm status-neutral" title="멤버 목록에서 숨긴 계정">숨김</span>' : '')
                    + (isS && (m.status === 'pending' || m.status === 'approved')
                    ? `<button class="gaa-btn gaa-btn-xs gaa-btn-secondary" type="button" onclick="editMemberInfo('${m.id}')">수정</button>`
                    : '');
                return `<div class="admin-member-row" id="admin-member-row-${m.id}"
                    data-name="${escapeHtml(m.name)}" data-email="${escapeHtml(m.email||'')}" data-phone="${escapeHtml(m.phone||'')}" data-instruments="${escapeHtml(m.instruments||'')}">
                    <div class="admin-member-main">
                        <span class="status-badge sm ${sc}" style="margin-left:6px">${st}</span>
                        <span class="admin-member-name">${escapeHtml(m.name)}</span>
                        ${insts.length > 0 ? instBadges(m.instruments) : ''}
                        ${contactInfo}
                        <span style="font-size:0.7rem;color:var(--wds-gray-400);white-space:nowrap;margin-left:auto">${date}</span>
                    </div>
                    <div class="admin-member-side">${editBtn}${roleSelect}${actions}</div>
                </div>`;
            };

            const buildGroup = (label, color, pageKey, allItems) => {
                if (allItems.length === 0) return '';
                const { items, page, totalPages, total } = getPaged(allItems, pageKey);
                return `<div class="admin-member-group">
                    <div class="admin-member-group-header" style="border-left-color:${color}">${label} <span class="member-group-count">${allItems.length}</span></div>
                    <div class="admin-member-list">${items.map(renderAdminItem).join('')}</div>
                    ${pagerHTML(pageKey, page, totalPages, total)}
                </div>`;
            };

            const q = (document.getElementById('memberSearchInput') || {}).value || '';
            const filtered = q.trim() ? members.filter(m => {
                const s = q.toLowerCase();
                return (m.name || '').toLowerCase().includes(s)
                    || (m.phone || '').replace(/-/g,'').includes(s.replace(/-/g,''))
                    || (m.instruments || '').toLowerCase().includes(s)
                    || (m.email || '').toLowerCase().includes(s);
            }) : members;
            memberList.innerHTML = q.trim()
                ? (filtered.length ? filtered.map(renderAdminItem).join('') : '<p style="color:var(--wds-gray-500);font-size:0.88rem;padding:12px 0">검색 결과가 없습니다.</p>')
                : buildGroup('⏳ 승인 대기', '#f0a050', 'adminMemberPending',  members.filter(m => m.status === 'pending')) +
                  buildGroup('✅ 승인됨',   '#00b894', 'adminMemberApproved', members.filter(m => m.status === 'approved')) +
                  buildGroup('🚫 거절됨',   '#e74c3c', 'adminMemberRejected', members.filter(m => m.status === 'rejected'));
        }

        function filterAdminMemberList() {
            const memberList = document.getElementById('memberList');
            if (memberList) renderAdminMemberListEl(memberList);
        }

        function renderAdminNoticeSection(container) {
            const noticeSection = document.createElement('div');
            noticeSection.className = 'admin-section';
            noticeSection.innerHTML = `
                <div class="admin-section-title">📢 공지사항 관리</div>
                <div class="notice-input-group">
                    <input type="text" id="noticeTitle" placeholder="공지 제목">
                    <textarea id="noticeContent" placeholder="공지 내용"></textarea>
                    <button type="button" class="admin-post-btn" onclick="postNotice()">공지 등록</button>
                </div>
                <div id="adminNoticeList"></div>
            `;
            container.appendChild(noticeSection);
            renderAdminNotices();
        }

        async function cancelReservation(id, isAdmin = false) {
            if (String(id).startsWith('perf-')) { cancelPerfReservation(String(id).replace(/^perf-/, '')); return; }
            const confirmMsg = isAdmin ? "관리자 권한으로 이 예약을 강제로 취소하시겠습니까?" : "정말로 예약을 취소하시겠습니까?";
            if (!confirm(confirmMsg)) return;

            const { error } = await supabaseClient
                .from('reservations')
                .delete()
                .eq('id', id);

            if (error) {
                showToast("취소 실패: " + error.message);
            } else {
                showToast(isAdmin ? '예약을 강제로 취소했습니다.' : '예약을 취소했습니다.');
                fetchReservations(); // 내역 갱신
            }
        }

        function renderMonth(container) {
            const grid = document.createElement('div'); grid.className = 'calendar-grid';
            ['일', '월', '화', '수', '목', '금', '토'].forEach(h => {
                const el = document.createElement('div'); el.className = 'calendar-day-header'; el.textContent = h; grid.appendChild(el);
            });
            const d = state.viewDate;
            const startDay = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
            const lastDate = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            for (let i = 0; i < startDay; i++) grid.appendChild(Object.assign(document.createElement('div'), {className: 'calendar-day empty'}));
            const today = new Date();
            for (let i = 1; i <= lastDate; i++) {
                const day = document.createElement('div'); day.className = 'calendar-day';
                const numEl = document.createElement('div'); numEl.className = 'cal-day-num'; numEl.textContent = i;
                day.appendChild(numEl);
                const loopDate = new Date(d.getFullYear(), d.getMonth(), i);
                if (isSameDay(loopDate, today)) day.classList.add('today');
                if (state.selectedDate && isSameDay(loopDate, state.selectedDate)) day.classList.add('selected');

                // 해당 날짜의 예약 요약 (시작-종료 시간 표시)
                const dayRes = state.reservations
                    .filter(r => isSameDay(new Date(r.res_date), loopDate))
                    .filter(r => r.status === 'approved' || r.status === 'pending')
                    .sort((a, b) => TIMES.indexOf(a.start_time) - TIMES.indexOf(b.start_time));
                // 해당 날짜에 적용되는 차단 블록 수집
                const dow = loopDate.getDay();
                const dateStr = loopDate.toLocaleDateString('en-CA');
                const dayBlocks = (state.blocks || []).filter(b => {
                    if (b.day_of_week !== dow) return false;
                    if (b.start_date && dateStr < b.start_date) return false;
                    if (b.end_date && dateStr > b.end_date) return false;
                    if (_blockSkipped(b, dateStr)) return false;
                    return true;
                });

                const info = document.createElement('div'); info.className = 'cal-day-info';
                const display = dayRes.slice(0, 3);
                display.forEach(r => {
                    const startH = parseInt(r.start_time.split(':')[0]);
                    const endStr = TIMES[TIMES.indexOf(r.end_time) + 1] || '23:00';
                    const endH = parseInt(endStr.split(':')[0]);
                    const cls = (r.status === 'approved' ? 'approved' : 'pending') + (state.user && r.kakao_id === state.user.kakaoId ? ' mine' : '');
                    const icon = r.status === 'approved' ? '✓' : '⏳';
                    const etcTitle = canApproveRes() && r.participant_etc ? ` title="기타: ${r.participant_etc.replace(/"/g,'&quot;')}"` : '';
                    const etcMark = canApproveRes() && r.participant_etc ? '<span style="color:#e07b00">*</span>' : '';
                    info.innerHTML += `<span class="${cls}"${etcTitle}><i class="cal-ri">${icon}</i>${startH}-${endH}<i class="cal-ru">시</i>${etcMark}</span>`;
                });
                if (dayRes.length > 3) {
                    info.innerHTML += `<span style="color:var(--wds-gray-500)">+${dayRes.length - 3}<i class="cal-ru">건</i></span>`;
                }
                dayBlocks.forEach(b => {
                    const sh = parseInt(b.start_time.split(':')[0]);
                    const endStr = TIMES[TIMES.indexOf(b.end_time) + 1] || '23:00';
                    const eh = parseInt(endStr.split(':')[0]);
                    info.innerHTML += `<span style="color:#e74c3c"><i class="cal-ri">🚫</i>${sh}-${eh}<i class="cal-ru">시</i></span>`;
                });
                if (dayRes.length > 0 || dayBlocks.length > 0) day.appendChild(info);

                day.onclick = () => { state.viewDate = loopDate; state.currentView = 'week'; document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'week')); render(); gtFocus('#viewContainer', { flash: false, ifHidden: true }); }; // 주간 시간표가 화면 밖이면 거기로(2026-10-19)
                grid.appendChild(day);
            }
            container.appendChild(grid);
        }

        function renderWeek(container) {
            const wrap = document.createElement('div'); wrap.className = 'weekly-container';
            const grid = document.createElement('div'); grid.className = 'weekly-grid';
            grid.appendChild(Object.assign(document.createElement('div'), {className: 'weekly-cell weekly-header-cell'}));
            const base = new Date(state.viewDate);
            base.setDate(base.getDate() - base.getDay()); // 일요일 시작
            const days = ['일', '월', '화', '수', '목', '금', '토'];
            const today = new Date();
            for (let i = 0; i < 7; i++) {
                const d = new Date(base); d.setDate(base.getDate() + i);
                const h = document.createElement('div'); h.className = 'weekly-cell weekly-header-cell';
                if (i === 0) h.classList.add('week-sun');
                if (i === 6) h.classList.add('week-sat');
                if (isSameDay(d, today)) h.classList.add('week-today');
                h.innerHTML = `<div style="font-size:0.7rem; opacity:0.75">${days[d.getDay()]}</div><div>${d.getDate()}</div>`;
                grid.appendChild(h);
            }
            TIMES.forEach((time, idx) => {
                const endTime = TIMES[idx + 1] || '23:00';
                const tc = document.createElement('div');
                tc.className = 'weekly-cell weekly-time-cell';
                tc.style.lineHeight = '1.15';
                tc.innerHTML = `<div style="font-weight:600;font-size:0.82rem">${time}</div><div style="font-size:0.64rem;color:var(--wds-gray-500)">~${endTime}</div>`;
                grid.appendChild(tc);
                for (let i = 0; i < 7; i++) {
                    const d = new Date(base); d.setDate(base.getDate() + i);
                    const s = document.createElement('div'); s.className = 'weekly-cell weekly-slot';
                    if (i === 0) s.classList.add('week-sun');
                    if (i === 6) s.classList.add('week-sat');
                    if (isSameDay(d, today)) s.classList.add('week-today');

                    const cellBlocks = getBlocks(d, time);
                    const block = cellBlocks[0] || null;
                    const occupiedRes = getOccupiedReservation(d, time);
                    const past = isPastSlot(d, time);
                    if (past && !block && !occupiedRes) {
                        s.classList.add('slot-past');
                        s.style.cursor = 'not-allowed';
                        s.style.opacity = '0.45';
                    } else if (block) {
                        s.classList.add('slot-blocked');
                        s.style.cursor = 'not-allowed';
                        s.style.fontSize = '0.65rem';
                        s.style.padding = '4px 2px';
                        s.style.overflow = 'hidden';
                        s.style.display = 'flex';
                        s.style.flexDirection = 'column';
                        s.style.alignItems = 'center';
                        s.style.justifyContent = 'center';
                        s.style.lineHeight = '1.2';
                        const reason = _weekCellNarrow() ? _blockCellShort(cellBlocks) : _blockCellReason(cellBlocks); // 폰에선 짧은 라벨, 전체는 title 로
                        s.innerHTML = `<div style="font-size:0.85rem">🚫</div><div style="overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:keep-all;max-width:100%">${escapeHtml(reason)}</div>`;
                        s.title = cellBlocks.map(x => x.reason || '예약 차단됨').join(' · ');
                    } else if (occupiedRes) {
                        s.classList.add('slot-occupied');
                        s.style.fontSize = '0.72rem';
                        s.style.color = 'var(--wds-gray-700)';
                        const showEtc = canApproveRes() && occupiedRes.participant_etc;
                        if (occupiedRes.__perf) {
                            s.style.color = 'var(--wds-gray-600)';
                            if (isSuper()) {
                                const realId = occupiedRes.id.replace(/^perf-/, '');
                                s.style.cursor = 'pointer';
                                s.title = (occupiedRes.status === 'pending' ? '공간 대관 입금 대기' : '공간 대관 예약') + ' — 클릭하여 취소';
                                s.onclick = () => { if (confirm(`공간 대관 예약(${d.toLocaleDateString('ko-KR')} ${time})을 취소하시겠습니까?`)) cancelPerfReservation(realId); };
                            } else {
                                s.style.cursor = 'not-allowed';
                                s.title = occupiedRes.status === 'pending' ? '공간 대관 입금 대기 중 — 예약할 수 없어요' : '공간 대관 예약';
                            }
                            s.textContent = _weekCellNarrow() ? (occupiedRes.status === 'pending' ? '🎭 대기' : '🎭 대관') : (occupiedRes.status === 'pending' ? '🎭 대관 대기' : '🎭 공간 대관');
                        } else if (isSuper()) {
                            s.style.cursor = 'pointer';
                            const weekPNames = participantNames(occupiedRes);
                            const tParts = [occupiedRes.user_name];
                            if (weekPNames) tParts.push(`멤버: ${weekPNames}`);
                            if (showEtc) tParts.push(`기타: ${occupiedRes.participant_etc}`);
                            tParts.push('— 클릭하여 예약 취소');
                            s.title = tParts.join('\n');
                            s.onclick = () => { if (confirm(`${occupiedRes.user_name}의 예약(${d} ${time})을 취소하시겠습니까?`)) cancelReservation(occupiedRes.id, true); };
                        } else {
                            s.style.cursor = 'not-allowed';
                            const weekPNames = canApproveRes() ? participantNames(occupiedRes) : '';
                            const tParts = [];
                            if (weekPNames) tParts.push(`멤버: ${weekPNames}`);
                            if (showEtc) tParts.push(`기타: ${occupiedRes.participant_etc}`);
                            if (tParts.length) s.title = tParts.join('\n');
                        }
                        if (!occupiedRes.__perf) {
                            if (showEtc) {
                                s.innerHTML = `${escapeHtml(maskName(occupiedRes.user_name))}<span style="color:#e07b00">*</span>`;
                            } else {
                                s.textContent = maskName(occupiedRes.user_name);
                            }
                        }
                    } else {
                        if (isSlotSelected(d, time)) s.classList.add('selected');
                        s.onclick = () => onSlotClick(d, time);
                    }
                    grid.appendChild(s);
                }
            });
            wrap.appendChild(grid); container.appendChild(wrap);
        }

        function renderDay(container) {
            const grid = document.createElement('div'); grid.className = 'weekly-grid day-grid'; grid.style.gridTemplateColumns = '130px 1fr';
            TIMES.forEach((time, idx) => {
                const endTime = TIMES[idx + 1] || '23:00';
                const tc = document.createElement('div');
                tc.className = 'weekly-cell weekly-time-cell';
                tc.style.lineHeight = '1.3';
                tc.innerHTML = `<div style="font-weight:600">${time}</div><div style="font-size:0.72rem;color:var(--wds-gray-500)">~ ${endTime}</div>`;
                grid.appendChild(tc);
                const s = document.createElement('div'); s.className = 'weekly-cell weekly-slot'; s.style.textAlign = 'left'; s.style.paddingLeft = '24px';
                
                const cellBlocks = getBlocks(state.viewDate, time);
                const block = cellBlocks[0] || null;
                const occupiedRes = getOccupiedReservation(state.viewDate, time);
                const past = isPastSlot(state.viewDate, time);
                if (past && !block && !occupiedRes) {
                    s.classList.add('slot-past');
                    s.style.cursor = 'not-allowed';
                    s.style.opacity = '0.45';
                    s.style.color = 'var(--wds-gray-500)';
                    s.textContent = '지난 시간';
                } else if (block) {
                    s.classList.add('slot-blocked');
                    s.style.cursor = 'not-allowed';
                    s.innerHTML = `🚫 예약 차단됨${cellBlocks.some(x => x.reason) ? ` <span style="color:var(--wds-gray-500);font-size:0.82rem">(${escapeHtml(cellBlocks.map(x => x.reason || '차단').join(' · '))})</span>` : ''}`;
                } else if (occupiedRes) {
                    s.classList.add('slot-occupied');
                    s.style.cursor = 'not-allowed';
                    if (occupiedRes.__perf) {
                        const realId = occupiedRes.id.replace(/^perf-/, '');
                        const perfCancelBtn = isSuper() ? `<button class="gaa-btn gaa-btn-xs gaa-btn-danger" style="margin-left:8px;vertical-align:middle" type="button" onclick="event.stopPropagation();if(confirm('공간 대관 예약을 취소하시겠습니까?'))cancelPerfReservation('${realId}')">취소</button>` : '';
                        s.innerHTML = `🎭 공간 대관 <span style="color:var(--wds-gray-500);font-size:0.82rem">(${occupiedRes.status === 'pending' ? '외부 예약 · 입금 대기' : '외부 예약'})</span>${perfCancelBtn}`;
                    } else {
                        const etcNote = canApproveRes() && occupiedRes.participant_etc ? `<div style="font-size:0.72rem;color:#e07b00;margin-top:2px;white-space:normal;text-align:left">기타: ${escapeHtml(occupiedRes.participant_etc)}</div>` : '';
                        const dayPNames = canApproveRes() ? participantNames(occupiedRes) : '';
                        const membersNote = dayPNames ? `<div style="font-size:0.72rem;color:var(--wds-primary);margin-top:2px;white-space:normal;text-align:left">멤버: ${escapeHtml(dayPNames)}</div>` : '';
                        const cancelBtn = isSuper() ? `<button class="gaa-btn gaa-btn-xs gaa-btn-danger" style="margin-left:8px;vertical-align:middle" type="button" onclick="event.stopPropagation();if(confirm('이 예약을 취소하시겠습니까?'))cancelReservation('${occupiedRes.id}',true)">취소</button>` : '';
                        if (isSuper()) s.style.cursor = 'default';
                        s.innerHTML = `이미 예약됨 <span style="color:var(--wds-gray-500);font-size:0.82rem">(${maskName(occupiedRes.user_name)})</span>${cancelBtn}${membersNote}${etcNote}`;
                    }
                } else {
                    if (isSlotSelected(state.viewDate, time)) {
                        s.classList.add('selected');
                        if (state.startTime === time && (!state.endTime || state.endTime === time)) s.textContent = '🟢 시작';
                        else if (state.startTime === time) s.textContent = '🟢 시작';
                        else if (state.endTime === time) s.textContent = '🔴 끝';
                        else s.textContent = '선택됨';
                    }
                    s.onclick = () => onSlotClick(state.viewDate, time);
                }
                grid.appendChild(s);
            });
            container.appendChild(grid);

            // 선택 요약
            if (state.startTime && state.selectedDate && isSameDay(state.selectedDate, state.viewDate)) {
                const summary = document.createElement('div');
                summary.style.cssText = 'margin-top:14px;padding:14px;background:var(--wds-primary-light);border-radius:var(--wds-radius-m);text-align:center;font-size:0.95rem;color:var(--wds-primary);font-weight:600';
                const endIdx = state.endTime ? TIMES.indexOf(state.endTime) : TIMES.indexOf(state.startTime);
                const endStr = TIMES[endIdx + 1] || '23:00';
                summary.textContent = state.endTime
                    ? `✅ 선택: ${state.startTime} ~ ${endStr}`
                    : `🟢 시작: ${state.startTime} — 끝 시간을 클릭하세요`;
                container.appendChild(summary);
            }
        }

        function maskName(name) {
            if (!name) return '?';
            if (name.length === 1) return name + '*';
            return name[0] + '*'.repeat(name.length - 1);
        }

        function getOccupiedReservation(date, time) {
            return state.reservations.find(r => {
                if (r.status === 'rejected' || r.status === 'cancelled') return false;
                if (!isSameDay(new Date(r.res_date), date)) return false;
                const startIdx = TIMES.indexOf(r.start_time);
                const endIdx = TIMES.indexOf(r.end_time);
                const curIdx = TIMES.indexOf(time);
                return curIdx >= startIdx && curIdx <= endIdx;
            }) || null;
        }

        function isOccupied(date, time) {
            return !!getOccupiedReservation(date, time);
        }

        // 그 날짜·시간 칸에 적용되는 차단 전부 (겹치면 여러 개) — 고정팀 → 대체 합주 → 커뮤니티 → 운영 차단 순
        function getBlocks(date, time) {
            const dow = date.getDay();
            const tIdx = TIMES.indexOf(time);
            const dateStr = date.toLocaleDateString('en-CA');
            return (state.blocks || []).filter(b => {
                if (Number(b.day_of_week) !== dow) return false;
                const sIdx = TIMES.indexOf(b.start_time);
                const eIdx = TIMES.indexOf(b.end_time);
                if (!(tIdx >= sIdx && tIdx <= eIdx)) return false;
                if (b.start_date && dateStr < b.start_date) return false;
                if (b.end_date && dateStr > b.end_date) return false;
                if (_blockSkipped(b, dateStr)) return false;
                return true;
            }).sort((a, b) => (_BLOCK_SRC_RANK[_blockSource(a)] - _BLOCK_SRC_RANK[_blockSource(b)]) || String(a.id).localeCompare(String(b.id)));
        }
        function getBlock(date, time) { return getBlocks(date, time)[0] || null; }
        // 폰(≤480px)에선 주간 시간표 7일이 한 화면에 들어와 칸이 좁다 — 라벨을 줄인다(2026-11-09 QA)
        const _weekCellNarrow = () => window.innerWidth <= 480;
        function _blockCellShort(blocks) {
            if (!blocks.length) return '';
            const r = String(blocks[0].reason || '');
            const short = r.startsWith('[고정팀 대체]') ? '대체' : r.startsWith('[고정팀]') ? '고정팀' : r.startsWith('[커뮤니티]') ? '모임' : (r.replace(/^\[[^\]]*\]\s*/, '').slice(0, 5) || '차단');
            return blocks.length > 1 ? `${short}+${blocks.length - 1}` : short;
        }
        // 칸 라벨: 첫 차단 사유 (+ 겹치는 다른 차단 수)
        function _blockCellReason(blocks) {
            if (!blocks.length) return '';
            const first = blocks[0].reason || '차단';
            return blocks.length > 1 ? `${first} +${blocks.length - 1}` : first;
        }
        function isBlocked(date, time) { return !!getBlock(date, time); }
        // 고정팀 건너뛰기(time_blocks.skip_dates): 그 날짜엔 반복 차단이 적용되지 않는다 — 날짜 범위 검사와 항상 같이 쓸 것
        function _blockSkipped(b, dateStr) { return Array.isArray(b.skip_dates) && b.skip_dates.includes(dateStr); }

        async function fetchBlocks() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient.from('time_blocks').select('*');
            if (error) { console.error('time_blocks fetch:', error); return; }
            state.blocks = data || [];
        }

        function isPastSlot(date, time) {
            const now = new Date();
            const slotDate = new Date(date);
            const [h] = time.split(':').map(Number);
            const slotDateTime = new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate(), h, 0, 0);
            return slotDateTime <= now;
        }

        // 시작~종료 사이(양끝 포함)에 차단/예약된 슬롯이 끼어 있는지 검사
        function rangeHasObstacle(date, lo, hi) {
            for (let i = lo; i <= hi; i++) {
                if (getBlock(date, TIMES[i]) || getOccupiedReservation(date, TIMES[i])) return true;
            }
            return false;
        }

        function onSlotClick(date, time) {
            if (isPastSlot(date, time)) return;
            const wasUnselected = !state.startTime;
            const hadRange = !!(state.startTime && state.endTime);
            if (!state.selectedDate || !isSameDay(state.selectedDate, date)) {
                state.selectedDate = new Date(date); state.startTime = time; state.endTime = null;
            } else {
                if (!state.startTime || (state.startTime && state.endTime)) { state.startTime = time; state.endTime = null; }
                else {
                    const startIdx = TIMES.indexOf(state.startTime), curIdx = TIMES.indexOf(time);
                    if (curIdx === startIdx) { state.startTime = null; }
                    else {
                        // 범위에 차단·기존예약이 끼어 있으면 범위 선택 불가 — 클릭한 칸을 새 시작점으로
                        const lo = Math.min(startIdx, curIdx), hi = Math.max(startIdx, curIdx);
                        if (rangeHasObstacle(date, lo, hi)) {
                            showToast('차단되었거나 이미 예약된 시간이 포함되어 있어 연속 선택할 수 없습니다.');
                            state.startTime = time; state.endTime = null;
                        } else if (curIdx < startIdx) {
                            state.startTime = time; state.endTime = TIMES[startIdx];
                        } else {
                            state.endTime = time;
                        }
                    }
                }
            }
            if (wasUnselected && state.startTime && state.user) {
                const me = (state.cachedMembers || []).find(m => m.kakao_id === state.user.kakaoId || m.email === state.user.email);
                if (me && !state.participantIds.includes(me.id)) state.participantIds = [me.id];
            }
            const scrollY = window.scrollY;
            render();
            window.scrollTo({ top: scrollY });
            // 범위를 막 완성했으면 다음 단계(참여 멤버·제출)가 화면 밖에 있을 때만 거기로(2026-10-19)
            if (!hadRange && state.startTime && state.endTime) gtFocus('#participantSection', { block: 'center', ifHidden: true, flash: false });
        }

        function isSlotSelected(date, time) {
            if (!state.selectedDate || !isSameDay(state.selectedDate, date) || !state.startTime) return false;
            const startIdx = TIMES.indexOf(state.startTime), curIdx = TIMES.indexOf(time);
            if (!state.endTime) return curIdx === startIdx;
            const endIdx = TIMES.indexOf(state.endTime);
            return curIdx >= startIdx && curIdx <= endIdx;
        }

        function isSameDay(d1, d2) { return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate(); }

        let _resBusy = false;
        async function onReserve(e) {
            e.preventDefault();
            if (_resBusy) return;
            _resBusy = true;
            let reserveBtn = null, origLabel = '';
            // 검증·충돌 안내는 알림창 대신 제출 버튼 아래 인라인(#reserveResult) — 2026-11-09 QA(알림창이 흐름을 끊음)
            const resMsg = document.getElementById('reserveResult');
            const showErr = (m) => { if (resMsg) { resMsg.textContent = m; resMsg.classList.add('on'); try { resMsg.scrollIntoView({ block: 'nearest' }); } catch (_) {} } else showToast(m, 4000); };
            if (resMsg) { resMsg.textContent = ''; resMsg.classList.remove('on'); }
            try {
            if (!state.selectedDate || !state.startTime) { showErr('날짜와 시간을 먼저 선택해주세요.'); return; }
            if (isPastSlot(state.selectedDate, state.startTime)) { showErr('지나간 날짜·시간에는 예약할 수 없습니다.'); return; }
            if (!supabaseClient) { showErr('Supabase 설정이 필요합니다.'); return; }

            const startIdx = TIMES.indexOf(state.startTime);
            const endIdx = state.endTime ? TIMES.indexOf(state.endTime) : startIdx;
            const effectiveEndTime = state.endTime || state.startTime;
            const dateStr = state.selectedDate.toLocaleDateString('en-CA');

            // 충돌 체크 직전 서버 최신 데이터 갱신 (stale 캐시로 인한 중복예약 방지)
            await fetchBlocks();
            const { data: _freshDayRes } = await supabaseClient
                .from('reservations')
                .select('id, res_date, start_time, end_time, status')
                .eq('res_date', dateStr);
            if (_freshDayRes) {
                state.reservations = [
                    ...state.reservations.filter(r => r.res_date !== dateStr || r.__perf),
                    ..._freshDayRes,
                ];
            }

            for (let i = startIdx; i <= endIdx; i++) {
                const blk = getBlock(state.selectedDate, TIMES[i]);
                if (blk) {
                    state.startTime = null; state.endTime = null; render(); // 갱신된 차단 현황 반영
                    showErr('차단된 시간이 포함되어 있어요' + (blk.reason ? ` · ${blk.reason}` : '') + '. 다른 시간을 골라주세요.');
                    return;
                }
            }
            // 기존 예약과 겹치는지 확인 (거절/취소 제외)
            const overlap = state.reservations.some(r => {
                if (r.status === 'rejected' || r.status === 'cancelled') return false;
                if (!isSameDay(new Date(r.res_date), state.selectedDate)) return false;
                const rs = TIMES.indexOf(r.start_time), re = TIMES.indexOf(r.end_time);
                return startIdx <= re && endIdx >= rs;
            });
            if (overlap) {
                state.startTime = null; state.endTime = null; render(); // 갱신된 예약 현황 반영
                showErr('이미 예약된 시간대가 포함되어 있어요. 다른 시간을 선택해주세요.');
                return;
            }
            const name = (state.user && state.user.nickname) || document.getElementById('userNameInput').value || '';
            if (!name) { showErr('사용자 정보를 불러오지 못했습니다. 다시 로그인해주세요.'); return; }
            const etcTrimmed = (state.participantEtc || '').trim();
            const etcCount = state.participantCount || 0;
            const etcFinal = etcCount > 0 ? (etcTrimmed ? `${etcTrimmed} (${etcCount}명)` : `(${etcCount}명)`) : etcTrimmed;
            const hasMembers = state.participantIds && state.participantIds.length > 0;
            if (!hasMembers && !etcFinal) { showErr('참여 멤버를 1명 이상 추가하거나 기타란에 이름을 적어주세요.'); return; }

            // 시간을 고르면 본인이 자동으로 담기므로(위 slot 선택 로직), 아무도 더 추가하지
            // 않으면 '혼자 예약'이 된다. 실수인 경우가 많아 제출 전에 한 번 확인받는다.
            if (hasMembers && state.participantIds.length === 1 && !etcFinal) {
                const me = (state.cachedMembers || []).find(m =>
                    m.kakao_id === (state.user && state.user.kakaoId) || m.email === (state.user && state.user.email));
                if (me && state.participantIds[0] === me.id) {
                    const ok = confirm('참여 멤버가 본인 한 명뿐입니다.\n다른 참여 멤버를 추가하지 않고 이대로 예약할까요?\n\n(참여 멤버는 참여 횟수 집계에 반영됩니다)');
                    if (!ok) return;
                }
            }

            // 일반 멤버: 오늘로부터 2개월 이내만 예약 가능
            if (!canApproveRes()) {
                const maxDate = new Date();
                maxDate.setMonth(maxDate.getMonth() + 2);
                if (state.selectedDate > maxDate) {
                    showErr(`일반 멤버는 오늘로부터 2개월 이내(${maxDate.toLocaleDateString('en-CA')}까지)만 선예약할 수 있어요.`);
                    return;
                }
            }

            // 관리자(총괄·세션장)는 자동 승인, 일반 멤버는 2시간 이하 자동 승인
            const reservationStatus = canApproveRes() ? 'approved' : ((endIdx - startIdx) > 1 ? 'pending' : 'approved');

            // 일반 멤버: 5분 내 중복 예약 방지 (서버 created_at 기준)
            if (!canApproveRes()) {
                const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
                const resQuery = supabaseClient.from('reservations').select('id').gte('created_at', fiveMinAgo).limit(1);
                if (state.user.kakaoId) resQuery.eq('kakao_id', state.user.kakaoId);
                else resQuery.eq('user_name', name);
                const { data: recentRes } = await resQuery;
                if (recentRes && recentRes.length > 0) {
                    showErr('예약은 5분에 1회만 가능해요. 잠시 후 다시 시도해주세요.');
                    return;
                }
            }

            reserveBtn = document.querySelector('button[type="submit"]');
            origLabel = reserveBtn ? reserveBtn.textContent : '';
            if (reserveBtn) { reserveBtn.disabled = true; reserveBtn.textContent = '처리 중...'; }
            const { data, error } = await supabaseClient
                .from('reservations')
                .insert([{
                    kakao_id: state.user.kakaoId,
                    user_name: name,
                    res_date: dateStr,
                    start_time: state.startTime,
                    end_time: effectiveEndTime,
                    status: reservationStatus,
                    participant_ids: state.participantIds || [],
                    participant_etc: etcFinal || null
                }]);

            if (error) {
                console.error('reservation insert:', error);
                if (/SLOT_TAKEN/.test((error.code || '') + ' ' + (error.message || ''))) { showErr('방금 다른 예약이 먼저 들어왔습니다. 다른 시간을 선택해주세요.'); fetchReservations().then(() => render()); }
                else if (error.code === 'RATE_LIMIT' || error.code === 'FORBIDDEN' || error.code === 'UNAUTHORIZED') showErr(error.message);
                else showErr('예약하지 못했습니다. 잠시 후 다시 시도해주세요. (' + error.message + ')');
            } else {
                const timeStr = `${state.startTime} ~ ${TIMES[endIdx + 1] || '23:00'}`;
                state.lastReservation = {
                    dateStr, timeStr, name,
                    participantIds: [...state.participantIds],
                    etc: etcFinal
                };
                const res = document.getElementById('result');
                const isApproved = (reservationStatus === 'approved' || canApproveRes());
                res.innerHTML = `
                    <strong>${escapeHtml(name)}</strong>님, <strong>${dateStr} ${timeStr}</strong> ${isApproved ? '예약 확정!' : '예약 신청 완료!'}<br>
                    <small style="opacity:0.8">${isApproved ? '예약이 확정되었습니다.' : '관리자 승인 후 확정됩니다.'}</small>`;
                state.selectedDate = null; state.startTime = null; state.endTime = null;
                state.participantIds = []; state.participantEtc = ''; state.participantCount = 0;
                const etcEl = document.getElementById('participantEtcInput');
                if (etcEl) etcEl.value = '';
                const cntEl = document.getElementById('participantCountInput');
                if (cntEl) cntEl.value = '0';
                fetchReservations();
                const pushTitle = isApproved ? '🎸 예약 확정' : '🎸 새 예약 신청';
                sendAdminPush(pushTitle, `${name} · ${dateStr} ${timeStr}`).catch(() => {});
            }
            } finally {
                _resBusy = false;
                if (reserveBtn) { reserveBtn.disabled = false; if (origLabel) reserveBtn.textContent = origLabel; }
            }
        }

        // --- 이메일 인증 ---
        function toggleInstrument(btn) {
            const wasSelected = btn.classList.contains('selected');
            btn.closest('.instrument-buttons').querySelectorAll('.inst-btn').forEach(b => b.classList.remove('selected'));
            if (!wasSelected) btn.classList.add('selected');
        }

        // Portal navigation
        // ── History API navigation ──────────────────────────────────────────────
        // 포털을 허브로 하는 단일파일 SPA. 각 섹션 진입 시 history에 항목을 쌓아
        // 브라우저 뒤로가기로 이전 섹션/포털로 돌아갈 수 있게 하고, 새로고침 시
        // location.hash를 읽어 현재 섹션을 복원한다.
        const _NAV_PAGES = ['gatheo', 'band', 'community', 'band-news', 'perf', 'shows', 'host'];
        let _navFromPop = false;       // popstate/복원 중에는 pushState 억제
        let _pendingRoute = null;      // 로드 시 hash로부터 복원할 섹션
        let _authResolved = false;     // login/logout UI가 한 번이라도 실행됐는지
        let _gatheoEntered = false;    // 이번 로드에서 loginUI(게더링 데이터 로딩 포함)가 실행됐는지 — 세션만 조용히 복구한 상태와 구분

        // 모든 최상위 화면 컨테이너 — 화면 전환 시 이전 화면이 남는(누수) 버그 방지용 일괄 숨김
        const _ALL_SCREEN_IDS = ['portal-page','landing-page','landing-page-band','landing-page-community','main-content','band-main-content','notice_container','band-news-page','performance-booking-page','pending-screen','shows-page','host-page'];
        function _hideAllScreens() {
            _ALL_SCREEN_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
            if (typeof cmApplySheetClose === 'function') cmApplySheetClose(); // 커뮤니티 신청 시트가 떠 있으면 닫는다
            if (typeof gtSheetClose === 'function') gtSheetClose();
            if (typeof closeBookingSheet === 'function') closeBookingSheet(); // 공연 예매 시트
            // GatheO 하단 탭바(+BGM 스택·본문 여백)는 GatheO 메인에서만 — 모든 화면 전환이 여길 거치므로 여기가 유일한 해제 지점
            document.body.classList.remove('gatheo-nav');
        }

        // 로그인된 GatheO 메인 뷰를 (재-fetch 없이) 다시 표시 — 뒤로/앞으로 복원용
        function _showGatheoMain() {
            document.body.classList.add('portal-view');
            document.body.classList.remove('fullwidth-view');
            _hideAllScreens();
            document.getElementById('main-content').classList.remove('hidden');
            document.body.classList.add('gatheo-nav');
        }

        // ── 서브 경로(탭 단위 딥링크) ──────────────────────────
        // #gatheo/board, #gatheo/member/schedule, #community/test 형태.
        // 허용 목록에 없는 세그먼트는 섹션까지로 절단 — 임의 해시로 이상 상태 방지.
        const _GATHEO_TABS = ['home', 'reservation', 'member', 'board', 'mypage', 'admin']; // home: 2026-10-15 시안 B
        const _MEMBER_SUBTABS = ['docs', 'list', 'teams', 'schedule', 'stats', 'activity'];
        const _COMMUNITY_TABS = ['current', 'past', 'test'];
        // 공연 예매 파라미터 라우트 검증 — _pageFromHash가 부팅 초기에 실행되므로 여기(사용처 옆)에 선언
        const _SHOW_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/i;
        const _TRANSFER_TOKEN_RE = /^[A-HJ-NP-Z2-9]{24}$/i; // 티켓 양도 링크 토큰(2026-10-20)
        const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let _pendingGatheoSub = null; // 비로그인 상태로 #gatheo/... 진입 시, 로그인 후 이어갈 탭 경로

        function _pageFromHash() {
            const segs = (location.hash || '').replace(/^#/, '').split('/').filter(Boolean);
            if (!_NAV_PAGES.includes(segs[0])) return 'portal';
            if (segs[0] === 'gatheo' && segs[1]) {
                if (!_GATHEO_TABS.includes(segs[1])) return 'gatheo';
                if (segs[1] === 'member' && segs[2])
                    return _MEMBER_SUBTABS.includes(segs[2]) ? segs.slice(0, 3).join('/') : 'gatheo/member';
                if (segs[1] === 'board' && segs[2]) // 게시글 딥링크(공지에 붙이는 링크, 2026-10-29)
                    return _UUID_RE.test(segs[2]) ? 'gatheo/board/' + segs[2].toLowerCase() : 'gatheo/board';
                return segs.slice(0, 2).join('/');
            }
            if (segs[0] === 'band' && (segs[1] === 'times' || segs[1] === 'guide')) return 'band/' + segs[1]; // 고정 가능 시간 보기(2026-11-05) · 운영 안내(2026-11-07)
            if (segs[0] === 'community' && segs[1]) {
                if (segs[1] === 'meeting' && _UUID_RE.test(segs[2] || '')) return 'community/meeting/' + segs[2].toLowerCase();
                return _COMMUNITY_TABS.includes(segs[1]) ? segs.slice(0, 2).join('/') : 'community';
            }
            // 공연 예매/호스트 — 파라미터 라우트(형식 검증, 화이트리스트 아님)
            if (segs[0] === 'shows' && segs[1]) {
                if (segs[1] === 'find') return 'shows/find';
                if (segs[1] === 'ticket' && _SHOW_CODE_RE.test(segs[2] || '')) return 'shows/ticket/' + segs[2].toUpperCase();
                if (segs[1] === 'claim' && _TRANSFER_TOKEN_RE.test(segs[2] || '')) return 'shows/claim/' + segs[2].toUpperCase(); // 양도받기
                if (_UUID_RE.test(segs[1])) return 'shows/' + segs[1].toLowerCase();
                return 'shows';
            }
            if (segs[0] === 'host' && segs[1]) {
                if (segs[1] === 'checkin' && _SHOW_CODE_RE.test(segs[2] || '')) return 'host/checkin/' + segs[2].toUpperCase();
                if (segs[1] === 'event' && _UUID_RE.test(segs[2] || '')) return 'host/event/' + segs[2].toLowerCase();
                if (segs[1] === 'join' && _SHOW_CODE_RE.test(segs[2] || '')) return 'host/join/' + segs[2].toUpperCase();
                if (segs[1] === 'eventjoin' && _SHOW_CODE_RE.test(segs[2] || '')) return 'host/eventjoin/' + segs[2].toUpperCase();
                return 'host';
            }
            return segs[0];
        }

        function _pushNav(path) {
            if (_navFromPop) return;
            const cur = (history.state && history.state.page) || '';
            if (cur === path) return; // 같은 경로 재클릭 → 항목 중복 방지
            // 섹션 항목(#gatheo)이 기본 탭(#gatheo/reservation)으로 구체화될 땐 교체 — 뒤로가기 한 번에 섹션을 빠져나가게.
            // 단 shows/host와 커뮤니티 모임 상세는 목록→상세가 별개 화면이므로 항상 push (뒤로가기로 목록 복귀 보장).
            const root = path.split('/')[0];
            const method = (cur === root && root !== 'shows' && root !== 'host' && !path.startsWith('community/meeting/'))
                ? 'replaceState' : 'pushState';
            history[method]({ page: path }, '', '#' + path);
        }

        function _routeToPage(path) {
            _navFromPop = true; // 복원이므로 pushState 하지 않음 (항목은 이미 존재)
            try {
                const segs = String(path || 'portal').split('/');
                const page = segs[0];
                if (page === 'gatheo') {
                    if (state.user) {
                        if (_gatheoEntered) _showGatheoMain(); else loginUI(state.user.nickname); // 세션만 복구된 상태면 데이터 로딩 포함 진입
                        let tab = _GATHEO_TABS.includes(segs[1]) ? segs[1] : null;
                        if (tab === 'admin' && !isAdminUser()) tab = 'home'; // 권한 없는 딥링크 방어
                        if (tab) {
                            setGatheOTab(tab);
                            if (tab === 'member' && _MEMBER_SUBTABS.includes(segs[2])) setMemberTab(segs[2]);
                            if (tab === 'board' && _UUID_RE.test(segs[2] || '')) gtOpenPost(segs[2].toLowerCase());
                        }
                    } else {
                        _pendingGatheoSub = segs.slice(1); // 로그인 후 loginUI가 이어감
                        _saveReturnTo(path); // 리다이렉트 로그인·새로고침 대비(2026-10-29)
                        showGatheoSection();
                    }
                }
                else if (page === 'band') {
                    if (state.bandProfile) { loginBandUI(state.bandProfile); if (segs[1] === 'guide') setTimeout(() => bandPageTab('guide'), 0); }
                    else { showBandSection(); if (segs[1] === 'times') showBandScheduleView(); else if (segs[1] === 'guide') showBandGuideView(); } // #band/times = 고정 가능 시간 보기 · #band/guide = 운영 안내
                }
                else if (page === 'community') {
                    // showCommunitySection이 탭을 'current'로 리셋하므로, 원하는 탭을 미리 맡겨둔다
                    if (_COMMUNITY_TABS.includes(segs[1])) window.__routeCommunityTab = segs[1];
                    // 모임 딥링크(#community/meeting/<id>) — 목록 로딩 후 상세로 진입
                    if (segs[1] === 'meeting' && segs[2]) window.__routeCommunityMeeting = segs[2];
                    showCommunitySection();
                }
                else if (page === 'band-news') showBandNewsSection();
                else if (page === 'perf') showPerformanceBookingSection();
                else if (page === 'shows') showShowsSection(segs.slice(1));
                else if (page === 'host') showHostSection(segs.slice(1));
                else showPortal();
            } finally {
                _navFromPop = false;
            }
        }

        // 인증 상태가 정해진 뒤(login/logout UI 실행 후, 또는 타임아웃) 한 번 호출.
        function applyPendingRoute() {
            if (!_pendingRoute) return;
            const page = _pendingRoute;
            _pendingRoute = null;
            _routeToPage(page);
        }

        window.addEventListener('popstate', (e) => {
            const page = (e.state && e.state.page) || _pageFromHash();
            _routeToPage(page);
        });
        // ────────────────────────────────────────────────────────────────────────

        function showPortal() {
            // Clean any test result URL params so refresh doesn't re-trigger share entry
            if (location.search || location.hash) history.replaceState({ page: 'portal' }, '', location.pathname);
            document.body.classList.add('portal-view');
            document.body.classList.remove('fullwidth-view');
            _hideAllScreens();
            document.getElementById('portal-page').classList.remove('hidden');
        }
