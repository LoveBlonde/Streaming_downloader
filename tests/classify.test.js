import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylist } from '../src/lib/m3u8.js';
import { classifyStreams, sortStreams } from '../src/lib/classify.js';

const BASE = 'https://cdn.example.com/oo5/TOKEN/qc/v.m3u8';
const master = parsePlaylist(
  `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="ko",URI="../audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"
../video.m3u8`,
  BASE,
);
const media = parsePlaylist('#EXTM3U\n#EXTINF:5,\na.ts\n#EXTINF:5,\nb.ts\n#EXT-X-ENDLIST', 'https://x/');

test('마스터가 참조하는 미디어 플레이리스트를 찾아 묶는다 (쿼리 차이는 무시)', () => {
  const info = classifyStreams([
    { url: 'https://cdn.example.com/oo5/TOKEN/video.m3u8?t=123', playlist: media },
    { url: BASE, playlist: master },
    { url: 'https://other/standalone.m3u8', playlist: media },
    { url: 'https://other/broken.m3u8', error: new Error('403') },
  ]);
  assert.deepEqual(info.get(BASE), { kind: 'master', variants: 1, audioTracks: 1 });
  assert.equal(info.get('https://cdn.example.com/oo5/TOKEN/video.m3u8?t=123').parent, BASE);
  assert.equal(info.get('https://other/standalone.m3u8').parent, undefined);
  assert.equal(info.get('https://other/standalone.m3u8').duration, 10);
  assert.equal(info.get('https://other/broken.m3u8').kind, 'unknown');

  const order = sortStreams(
    [{ url: 'https://cdn.example.com/oo5/TOKEN/video.m3u8?t=123' }, { url: 'https://other/broken.m3u8' }, { url: 'https://other/standalone.m3u8' }, { url: BASE }],
    info,
  ).map((s) => s.url);
  assert.deepEqual(order, [BASE, 'https://other/standalone.m3u8', 'https://other/broken.m3u8', 'https://cdn.example.com/oo5/TOKEN/video.m3u8?t=123']);
});
