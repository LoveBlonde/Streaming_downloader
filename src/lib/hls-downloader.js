// HLS 세그먼트 병렬 다운로드 + AES-128 복호화 + 순서 보장 쓰기.
// chrome.* API에 의존하지 않으므로 Node 테스트에서도 그대로 실행된다.

import { sequenceToIv } from './m3u8.js';

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * @typedef {object} Sink
 * @property {(chunk: Uint8Array) => Promise<void>} write
 */

/**
 * @typedef {object} Progress
 * @property {number} done        완료(파일에 기록)된 세그먼트 수
 * @property {number} total       전체 세그먼트 수
 * @property {number} bytes       기록된 바이트 수
 * @property {number} failedRetries 지금까지 발생한 재시도 횟수
 */

export class HlsDownloader {
  /**
   * @param {object} opts
   * @param {import('./m3u8.js').Segment[]} opts.segments
   * @param {Sink} opts.sink
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {number} [opts.concurrency] 동시에 받을 세그먼트 수
   * @param {number} [opts.retries] 세그먼트당 최대 재시도 횟수
   * @param {(p: Progress) => void} [opts.onProgress]
   * @param {AbortSignal} [opts.signal]
   */
  constructor({ segments, sink, fetchImpl, concurrency = 6, retries = 5, onProgress, signal }) {
    this.segments = segments;
    this.sink = sink;
    this.fetch = fetchImpl ?? ((...a) => fetch(...a));
    this.concurrency = Math.max(1, concurrency);
    this.retries = retries;
    this.onProgress = onProgress ?? (() => {});
    this.signal = signal;
    this.keyCache = new Map();
    this.retryCount = 0;
  }

  async fetchBytes(url, byteRange) {
    const headers = {};
    if (byteRange) {
      headers.Range = `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`;
    }

    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (this.signal?.aborted) throw this.signal.reason;
      try {
        const res = await this.fetch(url, { headers, credentials: 'include', signal: this.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
        const buf = new Uint8Array(await res.arrayBuffer());
        // Range 요청인데 서버가 전체 파일(200)을 돌려주는 경우 직접 잘라낸다.
        if (byteRange && res.status === 200 && buf.length > byteRange.length) {
          return buf.subarray(byteRange.offset, byteRange.offset + byteRange.length);
        }
        return buf;
      } catch (err) {
        if (this.signal?.aborted) throw this.signal.reason ?? err;
        lastError = err;
        if (attempt < this.retries) {
          this.retryCount++;
          await sleep(Math.min(500 * 2 ** attempt, 8000), this.signal);
        }
      }
    }
    throw lastError;
  }

  getKey(uri) {
    if (!this.keyCache.has(uri)) {
      const p = this.fetchBytes(uri, null).then((raw) => {
        if (raw.length !== 16) throw new Error(`AES-128 키 길이가 16바이트가 아닙니다 (${raw.length}바이트).`);
        return crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['decrypt']);
      });
      // 실패한 키 요청은 캐시에서 빼서 다음 세그먼트가 다시 시도할 수 있게 한다.
      p.catch(() => this.keyCache.delete(uri));
      this.keyCache.set(uri, p);
    }
    return this.keyCache.get(uri);
  }

  async downloadSegment(seg) {
    const data = await this.fetchBytes(seg.uri, seg.byteRange);
    if (!seg.key) return data;
    if (seg.key.method !== 'AES-128') throw new Error(`지원하지 않는 암호화 방식: ${seg.key.method}`);
    const key = await this.getKey(seg.key.uri);
    const iv = seg.key.iv ?? sequenceToIv(seg.sequence);
    // WebCrypto AES-CBC는 PKCS#7 패딩을 자동으로 제거한다.
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data));
  }

  /**
   * 모든 세그먼트를 받아 순서대로 sink에 기록한다.
   * 워커 N개가 병렬로 받되, 메모리 폭주를 막기 위해 "기록 위치보다 maxAhead개 이상 앞서" 받지 않는다.
   */
  async run() {
    const { segments } = this;
    const total = segments.length;
    const maxAhead = this.concurrency * 3;
    const ready = new Map();
    let cursor = 0;
    let written = 0;
    let bytes = 0;
    let failure = null;
    let wakeWriter = null;
    let spaceWaiters = [];

    const wakeAll = () => {
      wakeWriter?.();
      wakeWriter = null;
      const w = spaceWaiters;
      spaceWaiters = [];
      w.forEach((r) => r());
    };

    const onAbort = () => {
      failure ??= this.signal.reason ?? new DOMException('Aborted', 'AbortError');
      wakeAll();
    };
    this.signal?.addEventListener('abort', onAbort, { once: true });

    const worker = async () => {
      while (!failure && cursor < total) {
        if (cursor - written >= maxAhead) {
          await new Promise((r) => spaceWaiters.push(r));
          continue;
        }
        const i = cursor++;
        try {
          ready.set(i, await this.downloadSegment(segments[i]));
        } catch (err) {
          failure ??= err;
        }
        wakeAll();
      }
    };

    const writer = async () => {
      let lastMap = null;
      while (written < total) {
        if (failure) throw failure;
        if (!ready.has(written)) {
          await new Promise((r) => (wakeWriter = r));
          continue;
        }
        const seg = segments[written];
        // fMP4: 초기화 세그먼트(EXT-X-MAP)가 바뀔 때마다 앞에 기록한다.
        if (seg.map && (!lastMap || seg.map.uri !== lastMap.uri || seg.map.byteRange?.offset !== lastMap.byteRange?.offset)) {
          const init = await this.fetchBytes(seg.map.uri, seg.map.byteRange);
          await this.sink.write(init);
          bytes += init.length;
          lastMap = seg.map;
        }
        const data = ready.get(written);
        ready.delete(written);
        await this.sink.write(data);
        bytes += data.length;
        written++;
        wakeAll();
        this.onProgress({ done: written, total, bytes, failedRetries: this.retryCount });
      }
    };

    try {
      const workers = Array.from({ length: Math.min(this.concurrency, total) }, worker);
      await Promise.all([writer(), ...workers]);
      if (failure) throw failure;
    } catch (err) {
      failure ??= err;
      wakeAll();
      throw failure;
    } finally {
      this.signal?.removeEventListener('abort', onAbort);
    }
    return { bytes, segments: total };
  }
}
