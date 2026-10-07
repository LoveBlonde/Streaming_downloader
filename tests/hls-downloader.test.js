import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HlsDownloader } from '../src/lib/hls-downloader.js';
import { sequenceToIv } from '../src/lib/m3u8.js';

const KEY = new Uint8Array(16).map((_, i) => i * 7);

async function encrypt(plain, iv) {
  const key = await crypto.subtle.importKey('raw', KEY, { name: 'AES-CBC' }, false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plain));
}

/** URL → 바이트 맵 기반 가짜 fetch. 응답 순서를 섞기 위해 무작위 지연을 준다. */
function fakeFetch(files, { failOnce = new Set(), calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, range: init?.headers?.Range });
    await new Promise((r) => setTimeout(r, Math.random() * 15));
    if (failOnce.has(url)) {
      failOnce.delete(url);
      return new Response('boom', { status: 503 });
    }
    if (!(url in files)) return new Response('nf', { status: 404 });
    return new Response(files[url], { status: 200 });
  };
}

function memorySink() {
  const chunks = [];
  return {
    chunks,
    write: async (c) => void chunks.push(Buffer.from(c)),
    text: () => Buffer.concat(chunks).toString(),
  };
}

test('병렬로 받아도 순서대로 기록하고, 실패한 세그먼트는 재시도한다', async () => {
  const files = {};
  const segments = [];
  for (let i = 0; i < 40; i++) {
    files[`https://x/s${i}.ts`] = `[${i}]`;
    segments.push({ uri: `https://x/s${i}.ts`, sequence: i, key: null, map: null, byteRange: null });
  }
  const sink = memorySink();
  const progress = [];
  const dl = new HlsDownloader({
    segments,
    sink,
    concurrency: 5,
    retries: 2,
    fetchImpl: fakeFetch(files, { failOnce: new Set(['https://x/s3.ts', 'https://x/s17.ts']) }),
    onProgress: (p) => progress.push(p.done),
  });
  // 재시도 대기(backoff)를 짧게 만들기 위해 내부 sleep은 그대로 두되 retries 2회면 충분히 빠르다.
  const res = await dl.run();
  assert.equal(sink.text(), Array.from({ length: 40 }, (_, i) => `[${i}]`).join(''));
  assert.equal(res.segments, 40);
  assert.equal(progress.at(-1), 40);
  assert.equal(dl.retryCount, 2);
});

test('AES-128: 명시 IV와 시퀀스 기반 IV 모두 복호화하고, 키는 한 번만 받는다', async () => {
  const explicitIv = new Uint8Array(16).fill(9);
  const files = {
    'https://x/key': KEY,
    'https://x/a.ts': await encrypt(new TextEncoder().encode('hello '), sequenceToIv(100)),
    'https://x/b.ts': await encrypt(new TextEncoder().encode('world'), explicitIv),
  };
  const calls = [];
  const sink = memorySink();
  await new HlsDownloader({
    segments: [
      { uri: 'https://x/a.ts', sequence: 100, key: { method: 'AES-128', uri: 'https://x/key', iv: null }, map: null, byteRange: null },
      { uri: 'https://x/b.ts', sequence: 101, key: { method: 'AES-128', uri: 'https://x/key', iv: explicitIv }, map: null, byteRange: null },
    ],
    sink,
    fetchImpl: fakeFetch(files, { calls }),
  }).run();
  assert.equal(sink.text(), 'hello world');
  assert.equal(calls.filter((c) => c.url === 'https://x/key').length, 1);
});

test('fMP4: init 세그먼트를 맨 앞에 한 번 기록하고 Range 헤더를 보낸다', async () => {
  const map = { uri: 'https://x/init.mp4', byteRange: null };
  const calls = [];
  const sink = memorySink();
  await new HlsDownloader({
    segments: [
      { uri: 'https://x/m.mp4', sequence: 0, key: null, map, byteRange: { offset: 0, length: 2 } },
      { uri: 'https://x/m.mp4', sequence: 1, key: null, map, byteRange: { offset: 2, length: 2 } },
    ],
    sink,
    concurrency: 1,
    fetchImpl: async (url, init) => {
      calls.push(init?.headers?.Range);
      if (url.endsWith('init.mp4')) return new Response('INIT', { status: 200 });
      const [, s, e] = init.headers.Range.match(/bytes=(\d+)-(\d+)/);
      return new Response('abcd'.slice(+s, +e + 1), { status: 206 });
    },
  }).run();
  assert.equal(sink.text(), 'INITabcd');
  assert.ok(calls.includes('bytes=0-1') && calls.includes('bytes=2-3'));
});

test('재시도를 다 써도 실패하면 에러를 던진다', async () => {
  const dl = new HlsDownloader({
    segments: [{ uri: 'https://x/missing.ts', sequence: 0, key: null, map: null, byteRange: null }],
    sink: memorySink(),
    retries: 1,
    fetchImpl: fakeFetch({}),
  });
  await assert.rejects(dl.run(), /HTTP 404/);
});

test('취소(AbortSignal)하면 중단된다', async () => {
  const files = {};
  const segments = [];
  for (let i = 0; i < 100; i++) {
    files[`https://x/${i}`] = 'x';
    segments.push({ uri: `https://x/${i}`, sequence: i, key: null, map: null, byteRange: null });
  }
  const ac = new AbortController();
  const dl = new HlsDownloader({
    segments,
    sink: memorySink(),
    signal: ac.signal,
    fetchImpl: fakeFetch(files),
    onProgress: (p) => p.done === 5 && ac.abort(),
  });
  await assert.rejects(dl.run(), (e) => e.name === 'AbortError');
});
