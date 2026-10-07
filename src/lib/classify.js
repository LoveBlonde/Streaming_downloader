// 팝업에 감지된 스트림들의 관계를 정리한다.
// 플레이어는 보통 "마스터(화질 목록)"를 먼저 받고, 그중 고른 화질의 "미디어 플레이리스트"를 이어서 받는다.
// 그래서 영상 하나에 m3u8이 2개 이상 감지되는데, 어떤 미디어 플레이리스트가 어느 마스터에 속하는지 표시한다.

/** 쿼리(토큰 등)를 뺀 주소로 비교한다. 플레이어가 미디어 URL에 토큰을 덧붙이는 경우가 있기 때문. */
const pathKey = (url) => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
};

/**
 * @param {{url: string, playlist?: object, error?: Error}[]} results 각 스트림의 파싱 결과
 * @returns {Map<string, {kind: 'master'|'media'|'unknown', variants?: number, audioTracks?: number,
 *          duration?: number, parent?: string, error?: Error}>}
 */
export function classifyStreams(results) {
  const info = new Map();
  const owner = new Map(); // 미디어 경로 → 그걸 포함하는 마스터 URL

  for (const { url, playlist, error } of results) {
    if (!playlist) {
      info.set(url, { kind: 'unknown', error });
    } else if (playlist.type === 'master') {
      const audio = playlist.renditions.filter((r) => r.type === 'AUDIO' && r.uri);
      info.set(url, { kind: 'master', variants: playlist.variants.length, audioTracks: audio.length });
      for (const uri of [...playlist.variants.map((v) => v.uri), ...audio.map((r) => r.uri)]) {
        if (!owner.has(pathKey(uri))) owner.set(pathKey(uri), url);
      }
    } else {
      info.set(url, { kind: 'media', duration: playlist.totalDuration });
    }
  }
  for (const [url, entry] of info) {
    if (entry.kind === 'media' && owner.has(pathKey(url))) entry.parent = owner.get(pathKey(url));
  }
  return info;
}

/** 표시 순서: 마스터 → 독립 미디어 → 확인 실패 → 마스터에 포함된 미디어 */
export function sortStreams(streams, info) {
  const rank = (s) => {
    const e = info.get(s.url);
    if (!e) return 2;
    if (e.kind === 'master') return 0;
    if (e.kind === 'media') return e.parent ? 3 : 1;
    return 2;
  };
  return [...streams].sort((a, b) => rank(a) - rank(b));
}
