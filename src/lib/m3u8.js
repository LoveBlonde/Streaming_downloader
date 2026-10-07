// M3U8 (HLS) 플레이리스트 파서.
// 브라우저(확장 페이지)와 Node(테스트) 양쪽에서 동작하도록 외부 의존성 없이 작성한다.

/**
 * `KEY=VALUE,KEY="VALUE"` 형태의 속성 목록을 객체로 변환한다.
 * @param {string} str
 * @returns {Record<string, string>}
 */
export function parseAttributes(str) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    let value = m[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    attrs[m[1]] = value;
  }
  return attrs;
}

/** "0x0123..." 형태의 IV를 16바이트 배열로 변환한다. */
export function hexToBytes(hex) {
  let h = hex.replace(/^0x/i, '');
  if (h.length % 2) h = '0' + h;
  const out = new Uint8Array(16);
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  // 16바이트보다 짧으면 앞쪽을 0으로 채운다(big-endian).
  out.set(bytes.slice(-16), Math.max(0, 16 - bytes.length));
  return out;
}

/** IV가 명시되지 않은 경우 HLS 스펙대로 미디어 시퀀스 번호를 128bit big-endian IV로 쓴다. */
export function sequenceToIv(seq) {
  const iv = new Uint8Array(16);
  let n = BigInt(seq);
  for (let i = 15; i >= 0 && n > 0n; i--) {
    iv[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return iv;
}

function resolveUrl(uri, baseUrl) {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return uri;
  }
}

/** "length[@offset]" 형식의 BYTERANGE를 파싱한다. offset이 없으면 직전 범위의 끝을 사용한다. */
function parseByteRange(value, prevEnd) {
  const [len, off] = value.split('@');
  const length = parseInt(len, 10);
  const offset = off !== undefined ? parseInt(off, 10) : prevEnd ?? 0;
  return { offset, length };
}

/**
 * 플레이리스트 텍스트를 파싱한다.
 * @param {string} text
 * @param {string} baseUrl 상대 경로를 풀기 위한 플레이리스트 URL
 * @returns {MasterPlaylist | MediaPlaylist}
 */
export function parsePlaylist(text, baseUrl) {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines[0] !== '#EXTM3U') {
    throw new Error('유효한 M3U8 파일이 아닙니다 (#EXTM3U 헤더 없음).');
  }

  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  return isMaster ? parseMaster(lines, baseUrl) : parseMedia(lines, baseUrl);
}

/**
 * @typedef {{type: 'master', variants: Variant[], renditions: Rendition[]}} MasterPlaylist
 * @typedef {{uri: string, bandwidth: number, resolution: string|null, codecs: string|null, audio: string|null}} Variant
 * @typedef {{type: string, groupId: string, name: string, language: string|null, uri: string|null, isDefault: boolean}} Rendition
 */
function parseMaster(lines, baseUrl) {
  const variants = [];
  const renditions = [];
  let pending = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      pending = {
        bandwidth: parseInt(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH || '0', 10),
        resolution: a.RESOLUTION || null,
        codecs: a.CODECS || null,
        audio: a.AUDIO || null,
      };
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
      renditions.push({
        type: a.TYPE,
        groupId: a['GROUP-ID'],
        name: a.NAME || '',
        language: a.LANGUAGE || null,
        uri: a.URI ? resolveUrl(a.URI, baseUrl) : null,
        isDefault: a.DEFAULT === 'YES',
      });
    } else if (!line.startsWith('#') && pending) {
      variants.push({ ...pending, uri: resolveUrl(line, baseUrl) });
      pending = null;
    }
  }

  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return { type: 'master', variants, renditions };
}

/**
 * @typedef {{method: string, uri: string|null, iv: Uint8Array|null, keyFormat: string}} KeyInfo
 * @typedef {{uri: string, byteRange: {offset: number, length: number}|null}} MapInfo
 * @typedef {{uri: string, duration: number, sequence: number, key: KeyInfo|null, map: MapInfo|null,
 *            byteRange: {offset: number, length: number}|null, discontinuity: boolean}} Segment
 * @typedef {{type: 'media', segments: Segment[], targetDuration: number, mediaSequence: number,
 *            endList: boolean, totalDuration: number, keyMethods: string[], keyFormats: string[]}} MediaPlaylist
 */
function parseMedia(lines, baseUrl) {
  const segments = [];
  let targetDuration = 0;
  let mediaSequence = 0;
  let endList = false;
  let key = null;
  let map = null;
  let duration = 0;
  let byteRange = null;
  let discontinuity = false;
  const prevEndByUri = new Map();
  const keyMethods = new Set();
  const keyFormats = new Set();

  for (const line of lines) {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseFloat(line.split(':')[1]);
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.split(':')[1], 10);
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      endList = true;
    } else if (line.startsWith('#EXTINF:')) {
      duration = parseFloat(line.slice('#EXTINF:'.length).split(',')[0]);
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      byteRange = line.slice('#EXT-X-BYTERANGE:'.length);
    } else if (line.startsWith('#EXT-X-DISCONTINUITY') && !line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE')) {
      discontinuity = true;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const a = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      const method = (a.METHOD || 'NONE').toUpperCase();
      keyMethods.add(method);
      if (a.KEYFORMAT) keyFormats.add(a.KEYFORMAT);
      key =
        method === 'NONE'
          ? null
          : {
              method,
              uri: a.URI ? resolveUrl(a.URI, baseUrl) : null,
              iv: a.IV ? hexToBytes(a.IV) : null,
              keyFormat: a.KEYFORMAT || 'identity',
            };
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      map = {
        uri: resolveUrl(a.URI, baseUrl),
        byteRange: a.BYTERANGE ? parseByteRange(a.BYTERANGE, 0) : null,
      };
    } else if (!line.startsWith('#')) {
      const uri = resolveUrl(line, baseUrl);
      let range = null;
      if (byteRange) {
        range = parseByteRange(byteRange, prevEndByUri.get(uri));
        prevEndByUri.set(uri, range.offset + range.length);
      }
      segments.push({
        uri,
        duration,
        sequence: mediaSequence + segments.length,
        key,
        map,
        byteRange: range,
        discontinuity,
      });
      duration = 0;
      byteRange = null;
      discontinuity = false;
    }
  }

  return {
    type: 'media',
    segments,
    targetDuration,
    mediaSequence,
    endList,
    totalDuration: segments.reduce((s, x) => s + x.duration, 0),
    keyMethods: [...keyMethods],
    keyFormats: [...keyFormats],
  };
}

/**
 * 이 확장으로 받을 수 없는(=DRM으로 보호된) 플레이리스트인지 검사한다.
 * AES-128(전체 세그먼트 암호화, 키 URI 공개)은 표준 HLS 암호화로 지원하지만,
 * SAMPLE-AES / Widevine / FairPlay / PlayReady 등 DRM은 지원하지 않는다.
 * @param {MediaPlaylist} media
 * @returns {string|null} 지원 불가 사유. 지원 가능하면 null.
 */
export function getUnsupportedReason(media) {
  const badMethod = media.keyMethods.find((m) => m !== 'NONE' && m !== 'AES-128');
  if (badMethod) return `DRM/미지원 암호화 방식(${badMethod})이 적용된 스트림입니다.`;
  const badFormat = media.keyFormats.find((f) => f !== 'identity');
  if (badFormat) return `DRM 키 포맷(${badFormat})이 적용된 스트림입니다.`;
  if (media.segments.length === 0) return '세그먼트가 없는 플레이리스트입니다.';
  return null;
}
