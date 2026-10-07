import { parsePlaylist, getUnsupportedReason } from './lib/m3u8.js';
import { HlsDownloader } from './lib/hls-downloader.js';
import { createTempFile, cleanupOrphanedParts } from './lib/opfs-sink.js';
import { remuxToMp4 } from './lib/remux.js';
import { fmtBytes, fmtTime } from './lib/format.js';
import { initI18n, applyI18n, t, errorText } from './lib/i18n.js';

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
// chrome.downloads는 OS 금지 문자, 제어 문자(C0/C1), 앞뒤 점·공백이 있으면 "Invalid filename"으로 거부한다.
function sanitizeFilename(name) {
  const m = name.match(/^(.*?)(\.(?:ts|mp4))?$/i);
  let base = m[1]
    .replace(/[\\/:*?"<>|~\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\ufeff]/g, '_')
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
  if (!res.ok) throw new Error(t('errHttp', { status: res.status }));
  return res.text();
}

// ---------- 플레이리스트 로드 ----------
async function loadPlaylist(url) {
  const pl = parsePlaylist(await fetchText(url), url);
  if (pl.type !== 'media') throw new Error(t('errNestedMaster'));
  const reason = getUnsupportedReason(pl);
  if (reason) throw new Error(t('drmSuffix', { reason: t(reason.key, reason.params) }));
  return pl;
}

function describe(pl) {
  const isFmp4 = pl.segments.some((s) => s.map);
  return (
    t('segInfo', { n: pl.segments.length, duration: fmtTime(pl.totalDuration), format: isFmp4 ? 'fMP4' : 'MPEG-TS/raw' }) +
    (pl.keyMethods.includes('AES-128') ? t('encrypted') : '')
  );
}

/** 현재 선택된 화질/음성 트랙의 플레이리스트를 읽어 정보를 표시한다. */
async function refreshSelection(videoUrl, audioUrl) {
  $('warnings').replaceChildren();
  $('info').textContent = t('analyzing');
  $('start').disabled = true;
  videoMedia = audioMedia = null;

  try {
    [videoMedia, audioMedia] = await Promise.all([loadPlaylist(videoUrl), audioUrl ? loadPlaylist(audioUrl) : null]);
  } catch (e) {
    $('info').textContent = '';
    addWarning(errorText(e));
    return;
  }

  $('info').replaceChildren(
    Object.assign(document.createElement('div'), { textContent: t('videoLine', { desc: describe(videoMedia) }) }),
    Object.assign(document.createElement('div'), {
      textContent: audioMedia ? t('audioSeparate', { desc: describe(audioMedia) }) : t('audioIncluded'),
    }),
  );

  if (!videoMedia.endList || (audioMedia && !audioMedia.endList)) {
    addWarning(t('warnLive'));
  }
  if (videoMedia.segments.some((s, i) => i > 0 && s.discontinuity)) {
    addWarning(t('warnDiscontinuity'));
  }
  $('start').disabled = false;
}

async function init() {
  await initI18n();
  applyI18n();
  document.title = t('dlTitle');
  $('srcUrl').textContent = sourceUrl;
  $('srcReferer').textContent = referer || t('none');
  if (!sourceUrl) return fail(t('errNoUrl'));

  cleanupOrphanedParts().catch(() => {});
  await installHeaderRule();

  const top = parsePlaylist(await fetchText(sourceUrl), sourceUrl);
  $('loading').hidden = true;
  $('setup').hidden = false;
  $('filename').value = sanitizeFilename(pageTitle) + '.mp4';

  if (top.type === 'media') return refreshSelection(sourceUrl, null);

  if (top.variants.length === 0) throw new Error(t('errNoVariants'));
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
    $('pSegments').textContent = t('progressSegments', { done, total, pct: ((done / total) * 100).toFixed(1) });
    $('pBytes').textContent = fmtBytes(bytes);
    $('pSpeed').textContent = speed ? `${fmtBytes(speed)}/s` : '';
    $('pEta').textContent = speed ? t('eta', { time: fmtTime(((total - done) * (bytes / done)) / speed) }) : '';
    $('pRetries').textContent = failedRetries ? t('retries', { n: failedRetries }) : '';
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
  $('status').textContent = t('dontClose');
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
    setPhase(t('phaseVideo', { i: 1, n: steps }));
    const videoFile = await downloadTrack(videoMedia, await tempFile('video'), concurrency);

    let audioFile = null;
    if (audioMedia) {
      setPhase(t('phaseAudio', { i: 2, n: steps }));
      audioFile = await downloadTrack(audioMedia, await tempFile('audio'), concurrency);
    }

    setPhase(t('phaseRemux', { i: steps, n: steps }));
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
      if (!info.hasAudio) note = t('noteNoAudio');
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      // 변환에 실패해도 받은 데이터는 버리지 않고 원본 형식으로 저장한다.
      console.error('[hls] MP4 변환 실패', e);
      saveFile = videoFile;
      saveName = filename.replace(/\.mp4$/i, videoMedia.segments[0].map ? '.mp4' : '.ts');
      note =
        t('noteRemuxFailed', { error: errorText(e), ext: saveName.split('.').pop() }) +
        (audioFile ? t('noteRemuxNoAudio') : '');
    }

    $('cancel').hidden = true;
    $('bar').value = 1;
    $('status').textContent = t('doneChooseLocation', {
      size: fmtBytes(saveFile.size),
      time: fmtTime((performance.now() - startedAt) / 1000),
    });
    const url = URL.createObjectURL(saveFile);
    const id = await chrome.downloads.download({ url, filename: saveName, saveAs: true });
    const state = await waitForDownload(id);
    URL.revokeObjectURL(url);
    $('status').textContent = t(state === 'complete' ? 'saved' : 'saveCancelled') + note;
  } catch (e) {
    $('cancel').hidden = true;
    $('status').className = 'error';
    $('status').textContent = e?.name === 'AbortError' ? t('cancelled') : t('errorPrefix', { message: errorText(e) });
  } finally {
    for (const t of temps) await t.remove().catch(() => {});
    downloading = false;
    removeHeaderRule();
  }
}

$('start').onclick = startDownload;
$('cancel').onclick = () => abortController?.abort(new DOMException('User cancelled', 'AbortError'));
window.addEventListener('beforeunload', (e) => {
  if (downloading) e.preventDefault();
});

init().catch((e) => fail(errorText(e)));
