// Suno 페이지에서 플레이리스트 곡 정보 수집
async function collectSongs(playlistId) {
  const out = { ids: [], titles: {} };

  // 1) Suno 내부 API 시도 (로그인 세션 활용)
  try {
    const r = await fetch(`/api/playlist/${playlistId}/?page=1`, { credentials: 'include' });
    if (r.ok) {
      const j = await r.json();
      (j.playlist_clips || j.clips || []).forEach(c => {
        const cl = c.clip || c;
        if (cl.id && !out.ids.includes(cl.id)) {
          out.ids.push(cl.id);
          if (cl.title) out.titles[cl.id] = cl.title;
        }
      });
    }
  } catch (e) {}

  // 2) DOM 보강 (스크롤로 로드된 곡들)
  document.querySelectorAll('a[href*="/song/"]').forEach(a => {
    const m = a.href.match(/\/song\/([0-9a-f-]{36})/i);
    if (!m) return;
    const id = m[1];
    if (!out.ids.includes(id)) out.ids.push(id);
    if (!out.titles[id]) {
      const row = a.closest('[class*="row"],[class*="item"],li,tr');
      const t = a.textContent.trim() || row?.querySelector('[class*="title"],[class*="name"]')?.textContent?.trim();
      if (t && t.length < 200) out.titles[id] = t;
    }
  });

  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'COLLECT') {
    collectSongs(msg.playlistId).then(sendResponse);
    return true; // async
  }
});
