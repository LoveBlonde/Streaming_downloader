import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { remuxToMp4 } from '../src/lib/remux.js';
import { Input, ALL_FORMATS, BufferSource, BufferTarget } from '../src/vendor/mediabunny/mediabunny.min.mjs';

const fixture = (name) => new Blob([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))]);

async function probe(buffer) {
  const input = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  return {
    format: (await input.getFormat()).name,
    video: v && (await v.getCodec()),
    audio: a && (await a.getCodec()),
    duration: await input.computeDuration(),
    videoStart: v && (await v.getFirstTimestamp()),
    audioStart: a && (await a.getFirstTimestamp()),
  };
}

async function remux(opts) {
  const target = new BufferTarget();
  const progress = [];
  const info = await remuxToMp4({ ...opts, target, duration: 2, onProgress: (p) => progress.push(p) });
  return { info, out: await probe(target.buffer), progress };
}

test('영상+음성이 함께 든 TS → MP4', async () => {
  const { info, out, progress } = await remux({ video: fixture('muxed.ts') });
  assert.deepEqual([info.videoCodec, info.audioCodec], ['avc', 'aac']);
  assert.equal(out.format, 'MP4');
  assert.deepEqual([out.video, out.audio], ['avc', 'aac']);
  assert.ok(Math.abs(out.duration - 2) < 0.2, `duration ${out.duration}`);
  assert.ok(out.videoStart < 0.2 && out.audioStart < 0.2, '타임스탬프가 0 근처에서 시작해야 함');
  assert.equal(progress.at(-1), 1);
});

test('별도 음성 트랙(TS)을 영상과 합친다', async () => {
  const { out } = await remux({ video: fixture('video-only.ts'), audio: fixture('audio-only.ts') });
  assert.deepEqual([out.video, out.audio], ['avc', 'aac']);
  assert.ok(Math.abs(out.duration - 2) < 0.2);
});

test('별도 음성 트랙(ADTS packed audio)을 영상과 합친다', async () => {
  const { out } = await remux({ video: fixture('video-only.ts'), audio: fixture('audio.aac') });
  assert.deepEqual([out.video, out.audio], ['avc', 'aac']);
  assert.ok(Math.abs(out.videoStart - out.audioStart) < 0.2, `영상/음성 시작 시점이 맞아야 함 (${out.videoStart} vs ${out.audioStart})`);
});

test('미디어가 아닌 파일은 에러', async () => {
  await assert.rejects(remux({ video: new Blob(['not a video']) }));
});
