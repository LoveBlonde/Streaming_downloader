import { parsePlaylist, getUnsupportedReason } from './lib/m3u8.js';
import { HlsDownloader } from './lib/hls-downloader.js';
import { createSink, cleanupOrphanedParts } from './lib/opfs-sink.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sourceUrl = params.get('url');
const referer = params.get('referer') || '';
const pageTitle = params.get('title') || 'video';

let media = null;
let abortController = null;
let downloading = false;

// ---------- 유틸 ----------
const fmtBytes = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtTime = (sec) => {
  if (!isFinite(sec)) return '--:--';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
};
// chrome.downloads는 OS 금지 문자, 제어 문자(C0/C1), 앞뒤 점·공백이 있으면 "Invalid filename"으로 거부한다.
function sanitizeFilename(name) {
  const m = name.match(/^(.*?)(\.(?:ts|mp4))?$/i);
  let base = m[1]
    .replace(/[\\/:*?"<>|~\x00-\x1f\x7f-\x9f​-‏‪-‮﻿]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120)
    .replace(/[\s.]+$/, '');
  if (!base || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = 'video';
  return base + (m[2] ?? '');
}

function fail(message) {
  $('loading').hidden = true;
  $('fatal').hidden = false;
  $('fatal').textContent = message;
}

function addWarning(text) {
  const div = document.createElement('div');
  div.className = 'warn';
  div.textContent = text;
  $('warnings').append(div);
}

// ---------- Referer / Origin 헤더 주입 ----------
// 많은 CDN이 Referer를 검사해 핫링크를 막는다. fetch()로는 Referer를 임의 지정할 수 없으므로
// declarativeNetRequest 세션 규칙으로 "이 다운로드 탭에서 나가는 요청"에만 헤더를 덮어쓴다.
let ruleId = null;
async function installHeaderRule() {
  if (!referer) return;
  const tab = await chrome.tabs.getCurrent();
  ruleId = tab.id;
  const requestHeaders = [{ header: 'referer', operation: 'set', value: referer }];
  try {
    requestHeaders.push({ header: 'origin', operation: 'set', value: new URL(referer).origin });
  } catch {}
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [
      {
        id: ruleId,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders },
        condition: { tabIds: [tab.id], resourceTypes: ['xmlhttprequest', 'other'] },
      },
    ],
  });
}
function removeHeaderRule() {
  if (ruleId !== null) chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
}
window.addEventListener('pagehide', removeHeaderRule);

async function fetchText(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`플레이리스트 요청 실패: HTTP ${res.status}`);
  return res.text();
}

// ---------- 플레이리스트 로드 ----------
async function loadMedia(url) {
  $('warnings').replaceChildren();
  $('info').textContent = '미디어 플레이리스트 분석 중…';
  $('start').disabled = true;

  const pl = parsePlaylist(await fetchText(url), url);
  if (pl.type !== 'media') throw new Error('중첩된 마스터 플레이리스트는 지원하지 않습니다.');
  media = pl;

  const reason = getUnsupportedReason(pl);
  if (reason) {
    $('info').textContent = '';
    addWarning(`${reason} 이 확장은 DRM 보호 콘텐츠를 다운로드하지 않습니다.`);
    return;
  }

  const encrypted = pl.keyMethods.includes('AES-128');
  const isFmp4 = pl.segments.some((s) => s.map);
  $('info').textContent =
    `세그먼트 ${pl.segments.length}개 · 길이 ${fmtTime(pl.totalDuration)} · ` +
    `${isFmp4 ? 'fMP4' : 'MPEG-TS'}${encrypted ? ' · AES-128 암호화(자동 복호화)' : ''}`;

  if (!pl.endList) {
    addWarning('라이브(진행 중) 스트림으로 보입니다. 지금 시점의 플레이리스트에 있는 구간만 저장됩니다.');
  }
  if (pl.segments.some((s, i) => i > 0 && s.discontinuity)) {
    addWarning('중간에 불연속 구간(광고 삽입 등)이 있습니다. 일부 플레이어에서 해당 지점 탐색이 어색할 수 있습니다.');
  }

  const base = $('filename').value.replace(/\.(ts|mp4)$/i, '') || sanitizeFilename(pageTitle);
  $('filename').value = `${base}.${isFmp4 ? 'mp4' : 'ts'}`;
  $('start').disabled = false;
}

async function init() {
  $('srcUrl').textContent = sourceUrl;
  $('srcReferer').textContent = referer || '(없음)';
  if (!sourceUrl) return fail('URL이 지정되지 않았습니다.');

  cleanupOrphanedParts().catch(() => {});
  await installHeaderRule();

  const top = parsePlaylist(await fetchText(sourceUrl), sourceUrl);
  $('loading').hidden = true;
  $('setup').hidden = false;
  $('filename').value = sanitizeFilename(pageTitle);

  if (top.type === 'media') return loadMedia(sourceUrl);

  if (top.variants.length === 0) throw new Error('마스터 플레이리스트에 화질 정보가 없습니다.');
  $('variantBox').hidden = false;
  for (const v of top.variants) {
    const opt = document.createElement('option');
    opt.value = v.uri;
    opt.textContent = [v.resolution, v.bandwidth ? `${Math.round(v.bandwidth / 1000)} kbps` : null, v.codecs]
      .filter(Boolean)
      .join(' · ');
    opt.dataset.audio = v.audio ?? '';
    $('variant').append(opt);
  }

  const onVariant = async () => {
    const opt = $('variant').selectedOptions[0];
    try {
      await loadMedia(opt.value);
      const separateAudio = top.renditions.some((r) => r.type === 'AUDIO' && r.groupId === opt.dataset.audio && r.uri);
      if (separateAudio) {
        addWarning('이 화질은 오디오가 별도 트랙으로 분리되어 있어, 현재 버전에서는 영상 트랙만 저장됩니다(소리 없음).');
      }
    } catch (e) {
      addWarning(e.message);
    }
  };
  $('variant').onchange = onVariant;
  await onVariant();
}

// ---------- 다운로드 ----------
function waitForDownload(downloadId) {
  return new Promise((resolve) => {
    const listener = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener);
        resolve(delta.state.current);
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

async function startDownload() {
  const filename = sanitizeFilename($('filename').value);
  const concurrency = Math.min(16, Math.max(1, parseInt($('concurrency').value, 10) || 6));

  $('setup').hidden = true;
  $('progressCard').hidden = false;
  $('status').textContent = '다운로드 중… 이 탭을 닫지 마세요.';
  downloading = true;
  abortController = new AbortController();

  const sink = await createSink();
  const startedAt = performance.now();
  let lastBytes = 0;
  let lastTime = startedAt;
  let speed = 0;

  const onProgress = ({ done, total, bytes, failedRetries }) => {
    const now = performance.now();
    if (now - lastTime >= 1000) {
      const inst = ((bytes - lastBytes) * 1000) / (now - lastTime);
      speed = speed ? speed * 0.7 + inst * 0.3 : inst;
      lastBytes = bytes;
      lastTime = now;
    }
    $('bar').value = done / total;
    $('pSegments').textContent = `${done} / ${total} 세그먼트 (${((done / total) * 100).toFixed(1)}%)`;
    $('pBytes').textContent = fmtBytes(bytes);
    $('pSpeed').textContent = speed ? `${fmtBytes(speed)}/s` : '';
    const avgPerSeg = bytes / done;
    $('pEta').textContent = speed ? `남은 시간 ${fmtTime(((total - done) * avgPerSeg) / speed)}` : '';
    $('pRetries').textContent = failedRetries ? `재시도 ${failedRetries}회` : '';
  };

  try {
    const result = await new HlsDownloader({
      segments: media.segments,
      sink,
      concurrency,
      onProgress,
      signal: abortController.signal,
    }).run();

    $('cancel').hidden = true;
    $('status').textContent = `병합 완료 (${fmtBytes(result.bytes)}, ${fmtTime((performance.now() - startedAt) / 1000)}). 저장 위치를 선택하세요…`;
    const url = await sink.finish();
    const id = await chrome.downloads.download({ url, filename, saveAs: true });
    const state = await waitForDownload(id);
    URL.revokeObjectURL(url);
    await sink.cleanup();
    $('status').textContent = state === 'complete' ? '✅ 저장 완료! 이 탭을 닫아도 됩니다.' : '저장이 취소되었거나 중단되었습니다.';
  } catch (e) {
    await sink.cleanup().catch(() => {});
    $('cancel').hidden = true;
    $('status').className = 'error';
    $('status').textContent = e.name === 'AbortError' ? '취소되었습니다.' : `오류: ${e.message}`;
  } finally {
    downloading = false;
    removeHeaderRule();
  }
}

$('start').onclick = startDownload;
$('cancel').onclick = () => abortController?.abort(new DOMException('사용자 취소', 'AbortError'));
window.addEventListener('beforeunload', (e) => {
  if (downloading) e.preventDefault();
});

init().catch((e) => fail(e.message));
