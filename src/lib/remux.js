// 받은 세그먼트 파일(MPEG-TS / fMP4 / ADTS)을 재인코딩 없이 MP4로 다시 포장(remux)한다.
// 영상과 음성이 별도 플레이리스트로 나뉜 경우 두 입력을 하나의 MP4로 합친다.

import {
  Input,
  ALL_FORMATS,
  BlobSource,
  Output,
  Mp4OutputFormat,
  StreamTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  AdtsInputFormat,
  Mp3InputFormat,
  FlacInputFormat,
  WaveInputFormat,
  OggInputFormat,
} from '../vendor/mediabunny/mediabunny.min.mjs';

// MPEG-TS/MP4는 원본 타임스탬프(PTS)를 담고 있어 영상·음성 파일이 같은 타임라인을 공유한다.
// 반면 ADTS/MP3 같은 raw 오디오는 타임스탬프가 없어 항상 0부터 시작하므로 각자 0으로 맞춰야 한다.
const RAW_AUDIO_FORMATS = [AdtsInputFormat, Mp3InputFormat, FlacInputFormat, WaveInputFormat, OggInputFormat];
// 공유 타임라인이라도 시작점이 이만큼(초) 넘게 어긋나면 비정상으로 보고 각자 0으로 맞춘다.
const MAX_SHARED_START_GAP = 30;

/**
 * @param {object} opts
 * @param {Blob} opts.video              영상(또는 영상+음성) 세그먼트를 이어붙인 파일
 * @param {Blob} [opts.audio]            별도 음성 트랙 파일
 * @param {WritableStream|import('../vendor/mediabunny/mediabunny.min.mjs').Target} opts.target
 *        OPFS FileSystemWritableFileStream(위치 지정 쓰기 지원) 또는 mediabunny Target
 * @param {number} [opts.duration]       진행률 계산용 전체 길이(초)
 * @param {(ratio: number) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{hasVideo: boolean, hasAudio: boolean, videoCodec: string|null, audioCodec: string|null}>}
 */
export async function remuxToMp4({ video, audio, target, duration, onProgress, signal }) {
  const inputs = [];
  const open = (blob) => {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    inputs.push(input);
    return input;
  };

  try {
    const videoInput = open(video);
    const videoTrack = await videoInput.getPrimaryVideoTrack();
    // 별도 음성이 있으면 그것을, 없으면 영상 파일 안의 음성을 사용한다.
    const audioInput = audio ? open(audio) : videoInput;
    const audioTrack = await audioInput.getPrimaryAudioTrack();
    const audioFormat = audio ? await audioInput.getFormat() : null;
    const audioIsRaw = RAW_AUDIO_FORMATS.some((F) => audioFormat instanceof F);
    if (!videoTrack && !audioTrack) throw new Error('파일에서 영상/음성 트랙을 찾지 못했습니다.');

    const output = new Output({
      // fastStart: false → 샘플을 순서대로 쓰고 moov를 마지막에 기록. 메모리를 거의 쓰지 않는다.
      format: new Mp4OutputFormat({ fastStart: false }),
      target: target instanceof WritableStream ? new StreamTarget(target) : target,
    });

    const streams = [];
    for (const [track, kind] of [
      [videoTrack, 'video'],
      [audioTrack, 'audio'],
    ]) {
      if (!track) continue;
      const codec = await track.getCodec();
      if (!codec) throw new Error(`MP4에 담을 수 없는 ${kind === 'video' ? '영상' : '음성'} 코덱입니다.`);
      const iterator = new EncodedPacketSink(track).packets();
      const first = await iterator.next();
      if (first.done) continue;
      const source = kind === 'video' ? new EncodedVideoPacketSource(codec) : new EncodedAudioPacketSource(codec);
      if (kind === 'video') output.addVideoTrack(source);
      else output.addAudioTrack(source);
      streams.push({
        kind,
        codec,
        source,
        iterator,
        head: first.value,
        decoderConfig: await track.getDecoderConfig(),
        firstTimestamp: first.value.timestamp,
        offset: 0,
        started: false,
      });
    }

    // 타임스탬프 기준 맞추기
    const firsts = streams.map((s) => s.firstTimestamp);
    const shared = !audioIsRaw && Math.max(...firsts) - Math.min(...firsts) < MAX_SHARED_START_GAP;
    for (const s of streams) s.offset = shared ? Math.min(...firsts) : s.firstTimestamp;

    await output.start();

    // 두 트랙을 타임스탬프 순으로 교차(interleave)해서 넣는다.
    let lastReported = 0;
    while (streams.some((s) => s.head)) {
      if (signal?.aborted) throw signal.reason;
      const s = streams.filter((x) => x.head).reduce((a, b) => (b.head.timestamp < a.head.timestamp ? b : a));
      const packet = s.head.clone({ timestamp: s.head.timestamp - s.offset });
      await s.source.add(packet, s.started ? undefined : { decoderConfig: s.decoderConfig });
      s.started = true;

      if (onProgress && duration && packet.timestamp - lastReported > 1) {
        lastReported = packet.timestamp;
        onProgress(Math.min(1, packet.timestamp / duration));
      }
      const next = await s.iterator.next();
      s.head = next.done ? null : next.value;
    }

    await output.finalize();
    onProgress?.(1);
    const pick = (kind) => streams.find((s) => s.kind === kind);
    return {
      hasVideo: !!pick('video'),
      hasAudio: !!pick('audio'),
      videoCodec: pick('video')?.codec ?? null,
      audioCodec: pick('audio')?.codec ?? null,
    };
  } finally {
    for (const input of inputs) input.dispose?.();
  }
}
