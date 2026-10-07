import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylist, sequenceToIv, hexToBytes, getUnsupportedReason } from '../src/lib/m3u8.js';

const BASE = 'https://cdn.example.com/path/v.m3u8?token=abc';

test('마스터 플레이리스트: 화질 목록을 대역폭 내림차순으로 정렬하고 상대 경로를 해석한다', () => {
  const pl = parsePlaylist(
    `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Korean",LANGUAGE="ko",DEFAULT=YES,URI="audio/ko.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="aud"
/abs/1080p.m3u8
`,
    BASE,
  );
  assert.equal(pl.type, 'master');
  assert.equal(pl.variants.length, 2);
  assert.equal(pl.variants[0].resolution, '1920x1080');
  assert.equal(pl.variants[0].uri, 'https://cdn.example.com/abs/1080p.m3u8');
  assert.equal(pl.variants[0].audio, 'aud');
  assert.equal(pl.variants[1].uri, 'https://cdn.example.com/path/360p/index.m3u8');
  assert.equal(pl.variants[1].codecs, 'avc1.4d401e,mp4a.40.2');
  assert.equal(pl.renditions[0].uri, 'https://cdn.example.com/path/audio/ko.m3u8');
});

test('미디어 플레이리스트: 세그먼트, 시퀀스, AES-128 키, ENDLIST를 파싱한다', () => {
  const pl = parsePlaylist(
    `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:10.0,
seg0.ts
#EXT-X-KEY:METHOD=AES-128,URI="key2.bin",IV=0x000102030405060708090a0b0c0d0e0f
#EXTINF:9.5,
seg1.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:3,
seg2.ts
#EXT-X-ENDLIST`,
    BASE,
  );
  assert.equal(pl.type, 'media');
  assert.equal(pl.segments.length, 3);
  assert.equal(pl.endList, true);
  assert.equal(pl.totalDuration, 22.5);
  assert.equal(pl.segments[0].sequence, 7);
  assert.equal(pl.segments[0].key.uri, 'https://cdn.example.com/path/key.bin');
  assert.equal(pl.segments[0].key.iv, null);
  assert.deepEqual([...pl.segments[1].key.iv], [...Array(16).keys()]);
  assert.equal(pl.segments[2].key, null);
  assert.equal(getUnsupportedReason(pl), null);
});

test('fMP4(EXT-X-MAP)와 BYTERANGE를 파싱한다', () => {
  const pl = parsePlaylist(
    `#EXTM3U
#EXT-X-MAP:URI="init.mp4",BYTERANGE="700@0"
#EXTINF:4,
#EXT-X-BYTERANGE:1000@700
media.mp4
#EXTINF:4,
#EXT-X-BYTERANGE:500
media.mp4
#EXT-X-ENDLIST`,
    BASE,
  );
  assert.deepEqual(pl.segments[0].map.byteRange, { offset: 0, length: 700 });
  assert.deepEqual(pl.segments[0].byteRange, { offset: 700, length: 1000 });
  assert.deepEqual(pl.segments[1].byteRange, { offset: 1700, length: 500 });
});

test('DRM 스트림은 지원 불가로 판정한다', () => {
  const sampleAes = parsePlaylist(
    `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:4,
a.ts`,
    BASE,
  );
  assert.match(getUnsupportedReason(sampleAes), /SAMPLE-AES/);
});

test('#EXTM3U 헤더가 없으면 에러', () => {
  assert.throws(() => parsePlaylist('<html></html>', BASE), /유효한 M3U8/);
});

test('IV 유틸리티', () => {
  assert.deepEqual([...sequenceToIv(258)], [...Array(14).fill(0), 1, 2]);
  assert.deepEqual([...hexToBytes('0x0102')], [...Array(14).fill(0), 1, 2]);
});
