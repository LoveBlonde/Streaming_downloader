import { parsePlaylist, getUnsupportedReason } from './lib/m3u8.js';
import { HlsDownloader } from './lib/hls-downloader.js';
import { createTempFile, cleanupOrphanedParts } from './lib/opfs-sink.js';
import { remuxToMp4 } from './lib/remux.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sourceUrl = params.get('url');
const referer = params.get('referer') || '';
const pageTitle = params.get('title') || 'video';

let videoMedia = null;
let audioMedia = null;
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
async function loadPlaylist(url) {
  const pl = parsePlaylist(await fetchText(url), url);
  if (pl.type !== 'media') throw new Error('중첩된 마스터 플레이리스트는 지원하지 않습니다.');
  const reason = getUnsupportedReason(pl);
  if (reason) throw new Error(`${reason} 이 확장은 DRM 보호 콘텐츠를 다운로드하지 않습니다.`);
  return pl;
}

function describe(pl) {
  const isFmp4 = pl.segments.some((s) => s.map);
  return (
    `세그먼트 ${pl.segments.length}개 · ${fmtTime(pl.totalDuration)} · ${isFmp4 ? 'fMP4' : 'MPEG-TS/raw'}` +
    (pl.keyMethods.includes('AES-128') ? ' · AES-128 암호화(자동 복호화)' : '')
  );
}

/** 현재 선택된 화질/음성 트랙의 플레이리스트를 읽어 정보를 표시한다. */
async function refreshSelection(videoUrl, audioUrl) {
  $('warnings').replaceChildren();
  $('info').textContent = '플레이리스트 분석 중…';
  $('start').disabled = true;
  videoMedia = audioMedia = null;

  try {
    [videoMedia, audioMedia] = await Promise.all([loadPlaylist(videoUrl), audioUrl ? loadPlaylist(audioUrl) : null]);
  } catch (e) {
    $('info').textContent = '';
    addWarning(e.message);
    return;
  }

  $('info').replaceChildren(
    Object.assign(document.createElement('div'), { textContent: `영상: ${describe(videoMedia)}` }),
    Object.assign(document.createElement('div'), {
      textContent: `음성: ${audioMedia ? `별도 트랙 · ${describe(audioMedia)} (MP4로 합쳐 저장)` : '영상 파일에 포함'}`,
    }),
  );

  if (!videoMedia.endList || (audioMedia && !audioMedia.endList)) {
    addWarning('라이브(진행 중) 스트림으로 보입니다. 지금 시점의 플레이리스트에 있는 구간만 저장됩니다.');
  }
  if (videoMedia.segments.some((s, i) => i > 0 && s.discontinuity)) {
    addWarning('중간에 불연속 구간(광고 삽입 등)이 있습니다. 해당 지점에서 화면/소리가 어긋나면 알려주세요.');
  }
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
  $('filename').value = sanitizeFilename(pageTitle) + '.mp4';

  if (top.type === 'media') return refreshSelection(sourceUrl, null);

  if (top.variants.length === 0) throw new Error('마스터 플레이리스트에 화질 정보가 없습니다.');
  $('variantBox').hidden = false;
  top.variants.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = [v.resolution, v.bandwidth ? `${Math.round(v.bandwidth / 1000)} kbps` : null, v.codecs]
      .filter(Boolean)
      .join(' · ');
    $('variant').append(opt);
  });

  // 화질이 바뀌면 그 화질의 오디오 그룹에 맞춰 음성 트랙 목록을 다시 채운다.
  const fillAudioOptions = () => {
    const variant = top.variants[+$('variant').value];
    const tracks = top.renditions.filter((r) => r.type === 'AUDIO' && r.groupId === variant.audio && r.uri);
    $('audio').replaceChildren();
    $('audioBox').hidden = tracks.length === 0;
    for (const r of tracks) {
      const opt = document.createElement('option');
      opt.value = r.uri;
      opt.textContent = [r.name, r.language].filter(Boolean).join(' · ') || r.uri;
      opt.selected = r.isDefault;
      $('audio').append(opt);
    }
  };
  const onChange = () =>
    refreshSelection(top.variants[+$('variant').value].uri, $('audioBox').hidden ? null : $('audio').value);

  $('variant').onchange = () => {
    fillAudioOptions();
    onChange();
  };
  $('audio').onchange = onChange;
  fillAudioOptions();
  await onChange();
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

function setPhase(text) {
  $('phase').textContent = text;
  $('bar').value = 0;
  for (const id of ['pSegments', 'pBytes', 'pSpeed', 'pEta', 'pRetries']) $(id).textContent = '';
}

/** 한 트랙(영상 또는 음성)의 세그먼트를 모두 받아 임시 파일에 기록한다. */
async function downloadTrack(media, file, concurrency) {
  let lastBytes = 0;
  let lastTime = performance.now();
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
    $('pEta').textContent = speed ? `남은 시간 ${fmtTime(((total - done) * (bytes / done)) / speed)}` : '';
    $('pRetries').textContent = failedRetries ? `재시도 ${failedRetries}회` : '';
  };

  await new HlsDownloader({
    segments: media.segments,
    sink: file,
    concurrency,
    onProgress,
    signal: abortController.signal,
  }).run();
  return file.close();
}

async function startDownload() {
  const filename = sanitizeFilename($('filename').value.replace(/\.(mp4|ts)$/i, '')) + '.mp4';
  const concurrency = Math.min(16, Math.max(1, parseInt($('concurrency').value, 10) || 6));
  const steps = audioMedia ? 3 : 2;

  $('setup').hidden = true;
  $('progressCard').hidden = false;
  $('status').textContent = '이 탭을 닫지 마세요.';
  downloading = true;
  abortController = new AbortController();
  const startedAt = performance.now();
  const temps = [];
  const tempFile = async (label) => {
    const t = await createTempFile(label);
    temps.push(t);
    return t;
  };

  try {
    setPhase(`1/${steps} 영상 다운로드`);
    const videoFile = await downloadTrack(videoMedia, await tempFile('video'), concurrency);

    let audioFile = null;
    if (audioMedia) {
      setPhase(`2/${steps} 음성 다운로드`);
      audioFile = await downloadTrack(audioMedia, await tempFile('audio'), concurrency);
    }

    setPhase(`${steps}/${steps} MP4로 변환 중 (재인코딩 없음)`);
    const out = await tempFile('mp4');
    let saveFile;
    let saveName = filename;
    let note = '';
    try {
      const info = await remuxToMp4({
        video: videoFile,
        audio: audioFile,
        target: out.writable,
        duration: videoMedia.totalDuration,
        onProgress: (r) => {
          $('bar').value = r;
          $('pSegments').textContent = `${(r * 100).toFixed(0)}%`;
        },
        signal: abortController.signal,
      });
      out.markClosed(); // finalize 시 mediabunny가 스트림을 닫는다
      saveFile = await out.close();
      if (!info.hasAudio) note = ' (참고: 이 스트림에는 음성 트랙이 없습니다)';
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      // 변환에 실패해도 받은 데이터는 버리지 않고 원본 형식으로 저장한다.
      console.error('[hls] MP4 변환 실패', e);
      saveFile = videoFile;
      saveName = filename.replace(/\.mp4$/i, videoMedia.segments[0].map ? '.mp4' : '.ts');
      note = ` ⚠️ MP4 변환 실패(${e.message}) — 원본 형식(${saveName.split('.').pop()})으로 저장했습니다.` +
        (audioFile ? ' 별도 음성 트랙은 포함되지 않았습니다.' : '');
    }

    $('cancel').hidden = true;
    $('bar').value = 1;
    $('status').textContent = `완료 (${fmtBytes(saveFile.size)}, ${fmtTime((performance.now() - startedAt) / 1000)}). 저장 위치를 선택하세요…`;
    const url = URL.createObjectURL(saveFile);
    const id = await chrome.downloads.download({ url, filename: saveName, saveAs: true });
    const state = await waitForDownload(id);
    URL.revokeObjectURL(url);
    $('status').textContent = (state === 'complete' ? '✅ 저장 완료! 이 탭을 닫아도 됩니다.' : '저장이 취소되었거나 중단되었습니다.') + note;
  } catch (e) {
    $('cancel').hidden = true;
    $('status').className = 'error';
    $('status').textContent = e?.name === 'AbortError' ? '취소되었습니다.' : `오류: ${e?.message ?? e}`;
  } finally {
    for (const t of temps) await t.remove().catch(() => {});
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
