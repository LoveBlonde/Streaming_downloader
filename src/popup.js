const listEl = document.getElementById('list');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const key = `tab:${tab?.id}`;
const streams = (tab && (await chrome.storage.session.get(key))[key]) || [];

function openDownloader(url, referer) {
  const params = new URLSearchParams({
    url,
    referer: referer || tab?.url || '',
    title: tab?.title || 'video',
  });
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/downloader.html?${params}`) });
  window.close();
}

function shortName(url) {
  try {
    const u = new URL(url);
    return `${u.hostname} · ${u.pathname.split('/').slice(-2).join('/')}`;
  } catch {
    return url;
  }
}

if (streams.length === 0) {
  listEl.innerHTML =
    '<div class="empty">아직 감지된 m3u8이 없습니다.<br>영상을 재생한 뒤(또는 새로고침 후 재생) 다시 열어 보세요.</div>';
} else {
  for (const s of streams) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `<b class="name"></b><div class="url"></div>
      <div class="row"><small class="time"></small>
      <span><button class="copy secondary">복사</button> <button class="go">다운로드</button></span></div>`;
    item.querySelector('.name').textContent = shortName(s.url);
    item.querySelector('.url').textContent = s.url;
    item.querySelector('.time').textContent = new Date(s.detectedAt).toLocaleTimeString();
    item.querySelector('.go').onclick = () => openDownloader(s.url, s.referer);
    item.querySelector('.copy').onclick = (e) => {
      navigator.clipboard.writeText(s.url);
      e.target.textContent = '복사됨';
    };
    listEl.append(item);
  }
}

document.getElementById('manualGo').onclick = () => {
  const url = document.getElementById('manualUrl').value.trim();
  if (!url) return;
  openDownloader(url, document.getElementById('manualReferer').value.trim());
};
