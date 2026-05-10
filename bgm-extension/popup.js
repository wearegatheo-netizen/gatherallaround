const REPO   = 'wearegatheo-netizen/gatherallaround';
const BRANCH = 'master';
const FILE   = 'music.json';

const patEl  = document.getElementById('pat');
const plEl   = document.getElementById('playlist-id');
const btn    = document.getElementById('sync-btn');
const status = document.getElementById('status');

// 저장된 값 복원
chrome.storage.local.get(['pat', 'playlistId'], d => {
  if (d.pat)        patEl.value = d.pat;
  if (d.playlistId) plEl.value  = d.playlistId;
});

// 입력 시 자동 저장
patEl.addEventListener('change', () => chrome.storage.local.set({ pat: patEl.value.trim() }));
plEl.addEventListener('change',  () => chrome.storage.local.set({ playlistId: plEl.value.trim() }));

btn.addEventListener('click', sync);

function setStatus(type, html) {
  status.style.display = 'block';
  status.className = type;
  status.innerHTML = html;
}

async function sync() {
  const pat        = patEl.value.trim();
  const playlistId = plEl.value.trim();

  if (!pat)        return setStatus('error', '❌ GitHub PAT를 입력해주세요.');
  if (!playlistId) return setStatus('error', '❌ 플레이리스트 ID를 입력해주세요.');

  btn.disabled = true;
  setStatus('loading', '⏳ Suno 페이지에서 곡 수집 중...');

  // 현재 탭 확인
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  if (!url.includes('suno.com')) {
    btn.disabled = false;
    return setStatus('error', '❌ Suno 페이지에서 실행해주세요.<br><span style="font-size:11px;color:#888">현재: ' + (url.split('/')[2] || '알 수 없음') + '</span>');
  }

  // content script 주입 후 곡 수집
  let songs;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    songs = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT', playlistId });
  } catch (e) {
    btn.disabled = false;
    return setStatus('error', '❌ 곡 수집 실패<br><span style="font-size:11px;color:#888">' + e.message + '</span>');
  }

  if (!songs?.ids?.length) {
    btn.disabled = false;
    return setStatus('error', '❌ 곡을 찾지 못했습니다.<br><span style="font-size:11px;color:#888">플레이리스트 페이지에서 곡이 모두 로드된 후 시도해주세요.</span>');
  }

  setStatus('loading', `⏳ GitHub 업데이트 중... (${songs.ids.length}곡 발견)`);

  try {
    // 현재 music.json 조회
    const cur = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github+json' } }
    ).then(r => r.json());

    if (!cur.sha) {
      btn.disabled = false;
      return setStatus('error', '❌ music.json 조회 실패<br><span style="font-size:11px;color:#888">' + (cur.message || '') + '</span>');
    }

    const existing = JSON.parse(atob(cur.content.replace(/\s/g, '')));
    const exMap    = new Map(existing.map(t => [t.id, t]));

    // 머지
    const merged = songs.ids.map(id => {
      const ex = exMap.get(id);
      return { id, title: songs.titles[id] || (ex && ex.title) || 'Track' };
    });

    const added   = merged.filter(t => !exMap.has(t.id)).length;
    const removed = existing.filter(t => !merged.find(m => m.id === t.id)).length;
    const same    = merged.length === existing.length
                 && merged.every((t, i) => existing[i] && existing[i].id === t.id);

    if (same) {
      btn.disabled = false;
      return setStatus('info', `✅ 변경사항 없음<br><span style="font-size:11px">총 ${merged.length}곡 · 이미 최신 상태입니다.</span>`);
    }

    const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(merged, null, 2) + '\n')));
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
      method: 'PUT',
      headers: { Authorization: `token ${pat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `BGM: sync ${merged.length} songs from Suno playlist`,
        content: newContent,
        sha: cur.sha,
        branch: BRANCH
      })
    });

    const j = await res.json();
    btn.disabled = false;

    if (res.ok) {
      const parts = [];
      if (added)   parts.push(`+${added}곡 추가`);
      if (removed) parts.push(`-${removed}곡 제거`);
      setStatus('success',
        `✅ 동기화 완료!<br><span style="font-size:11px">총 ${merged.length}곡` +
        (parts.length ? ' · ' + parts.join(', ') : '') + '</span>'
      );
    } else {
      setStatus('error', '❌ 업로드 실패<br><span style="font-size:11px;color:#888">' + (j.message || res.status) + '</span>');
    }
  } catch (e) {
    btn.disabled = false;
    setStatus('error', '❌ 오류<br><span style="font-size:11px;color:#888">' + e.message + '</span>');
  }
}
