// 서비스 워커: 각 탭의 네트워크 요청을 관찰해 m3u8 요청을 감지하고 탭별로 저장한다.

const HLS_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
];
const MAX_PER_TAB = 50;
const tabKey = (tabId) => `tab:${tabId}`;

function isM3u8Url(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

// 확장 자신(다운로드 페이지)이 보낸 요청은 감지 대상에서 제외한다.
function isOwnRequest(details) {
  return details.tabId < 0 || (details.initiator ?? '').startsWith('chrome-extension://');
}

// storage.session 읽기-수정-쓰기를 직렬화해 동시 요청에서 항목이 유실되지 않게 한다.
let queue = Promise.resolve();
function addStream(tabId, entry) {
  queue = queue
    .then(async () => {
      const key = tabKey(tabId);
      const list = (await chrome.storage.session.get(key))[key] ?? [];
      const existing = list.find((s) => s.url === entry.url);
      if (existing) {
        // 나중에 Referer 정보를 얻었으면 보강한다.
        if (!existing.referer && entry.referer) {
          existing.referer = entry.referer;
          await chrome.storage.session.set({ [key]: list });
        }
        return;
      }
      list.unshift(entry);
      await chrome.storage.session.set({ [key]: list.slice(0, MAX_PER_TAB) });
      await chrome.action.setBadgeText({ tabId, text: String(Math.min(list.length, 99)) });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
    })
    .catch((err) => console.warn('[hls] addStream 실패', err));
}

function clearTab(tabId) {
  queue = queue.then(() => chrome.storage.session.remove(tabKey(tabId))).catch(() => {});
}

function getHeader(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
}

// 1) URL이 .m3u8로 끝나는 요청: 요청 헤더에서 실제 Referer를 함께 기록한다.
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (isOwnRequest(details) || !isM3u8Url(details.url)) return;
    addStream(details.tabId, {
      url: details.url,
      referer: getHeader(details.requestHeaders, 'referer') || (details.initiator ? details.initiator + '/' : ''),
      detectedAt: Date.now(),
    });
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] },
  ['requestHeaders', 'extraHeaders'],
);

// 2) 확장자가 없지만 Content-Type이 HLS인 응답도 감지한다.
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (isOwnRequest(details) || isM3u8Url(details.url)) return;
    const type = getHeader(details.responseHeaders, 'content-type').toLowerCase().split(';')[0].trim();
    if (!HLS_CONTENT_TYPES.includes(type)) return;
    addStream(details.tabId, {
      url: details.url,
      referer: details.initiator ? details.initiator + '/' : '',
      detectedAt: Date.now(),
    });
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] },
  ['responseHeaders'],
);

// 탭이 다른 페이지로 이동하거나 닫히면 목록을 비운다.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) clearTab(tabId);
});
chrome.tabs.onRemoved.addListener(clearTab);
