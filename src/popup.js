import { parsePlaylist } from './lib/m3u8.js';
import { classifyStreams, sortStreams } from './lib/classify.js';
import { fmtTime } from './lib/format.js';
import { initI18n, applyI18n, t, getLanguage, errorText } from './lib/i18n.js';

await initI18n();
applyI18n();

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

/** "호스트 · 상위폴더/파일명". 토큰처럼 긴 경로 조각은 줄여서 보여준다. */
function shortName(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split('/')
      .filter(Boolean)
      .slice(-2)
      .map((p) => (p.length > 24 ? `${p.slice(0, 10)}…${p.slice(-8)}` : p));
    return `${u.hostname} · ${parts.join('/')}`;
  } catch {
    return url;
  }
}

// ---------- 스트림 종류 확인 ----------
// 팝업의 요청은 탭에 속하지 않으므로(tabId = -1) 그 조건으로 Referer/Origin을 붙이는 임시 규칙을 건다.
const RULE_BASE = 900000;

async function withRefererRules(fn) {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const stale = existing.filter((r) => r.id >= RULE_BASE && r.id < RULE_BASE + 1000).map((r) => r.id);
  const byHost = new Map();
  for (const s of streams) {
    try {
      const host = new URL(s.url).hostname;
      if (s.referer && !byHost.has(host)) byHost.set(host, s.referer);
    } catch {}
  }
  const addRules = [...byHost].slice(0, 1000).map(([host, ref], i) => {
    const requestHeaders = [{ header: 'referer', operation: 'set', value: ref }];
    try {
      requestHeaders.push({ header: 'origin', operation: 'set', value: new URL(ref).origin });
    } catch {}
    return {
      id: RULE_BASE + i,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders },
      condition: { tabIds: [chrome.tabs.TAB_ID_NONE], requestDomains: [host], resourceTypes: ['xmlhttprequest'] },
    };
  });
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale, addRules });
  try {
    return await fn();
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: addRules.map((r) => r.id) });
  }
}

async function inspect(stream) {
  try {
    const res = await fetch(stream.url, { credentials: 'include', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { url: stream.url, playlist: parsePlaylist(await res.text(), stream.url) };
  } catch (error) {
    return { url: stream.url, error };
  }
}

// ---------- 렌더링 ----------
function describe(entry) {
  if (!entry) return { text: t('checking') };
  if (entry.kind === 'master') {
    const text = entry.audioTracks
      ? t('kindMasterAudio', { n: entry.variants, a: entry.audioTracks })
      : t('kindMaster', { n: entry.variants });
    return { text, recommended: true };
  }
  if (entry.kind === 'media') return { text: t('kindMedia', { duration: fmtTime(entry.duration) }), note: entry.parent && t('includedInMaster') };
  return { text: t('checkFailed', { error: errorText(entry.error) }) };
}

function render(info) {
  listEl.replaceChildren();
  if (streams.length === 0) {
    listEl.innerHTML = '<div class="empty"></div>';
    listEl.firstChild.textContent = t('popupEmpty');
    return;
  }
  for (const s of info ? sortStreams(streams, info) : streams) {
    const d = describe(info?.get(s.url));
    const item = document.createElement('div');
    item.className = 'item' + (d.note ? ' included' : '');
    item.innerHTML = `<div class="head"><b class="name"></b><span class="badge" hidden></span></div>
      <div class="kind"></div><div class="note" hidden></div><div class="url"></div>
      <div class="row"><small class="time"></small>
      <span><button class="copy secondary"></button> <button class="go"></button></span></div>`;
    item.querySelector('.name').textContent = shortName(s.url);
    item.querySelector('.name').title = s.url;
    item.querySelector('.kind').textContent = d.text;
    if (d.recommended) {
      const badge = item.querySelector('.badge');
      badge.hidden = false;
      badge.textContent = t('recommended');
    }
    if (d.note) {
      item.querySelector('.note').hidden = false;
      item.querySelector('.note').textContent = d.note;
    }
    item.querySelector('.url').textContent = s.url;
    item.querySelector('.time').textContent = new Date(s.detectedAt).toLocaleTimeString(getLanguage());
    const go = item.querySelector('.go');
    go.textContent = t('download');
    if (d.note) go.className = 'go secondary';
    go.onclick = () => openDownloader(s.url, s.referer);
    const copy = item.querySelector('.copy');
    copy.textContent = t('copy');
    copy.onclick = () => {
      navigator.clipboard.writeText(s.url);
      copy.textContent = t('copied');
    };
    listEl.append(item);
  }
}

render(null);
if (streams.length) {
  withRefererRules(() => Promise.all(streams.map(inspect)))
    .then((results) => render(classifyStreams(results)))
    .catch((e) => console.warn('[hls] 스트림 종류 확인 실패', e));
}

document.getElementById('manualGo').onclick = () => {
  const url = document.getElementById('manualUrl').value.trim();
  if (!url) return;
  openDownloader(url, document.getElementById('manualReferer').value.trim());
};
document.getElementById('openSettings').onclick = () => chrome.runtime.openOptionsPage();
