// 병합 결과를 메모리가 아닌 OPFS(Origin Private File System)에 스트리밍으로 기록한다.
// 수 GB짜리 영상도 RAM에 올리지 않고 합칠 수 있고, 완료 후 디스크 기반 Blob URL로 저장한다.
// OPFS를 쓸 수 없는 환경이면 메모리 Blob으로 대체한다.

const LOCK_PREFIX = 'hls-part:';

/** 다른 다운로드 탭이 사용 중이지 않은(=비정상 종료로 남은) 임시 파일을 지운다. */
export async function cleanupOrphanedParts() {
  const root = await navigator.storage.getDirectory();
  const { held = [] } = await navigator.locks.query();
  const inUse = new Set(held.map((l) => l.name));
  for await (const name of root.keys()) {
    if (name.endsWith('.part') && !inUse.has(LOCK_PREFIX + name)) {
      await root.removeEntry(name).catch(() => {});
    }
  }
}

export async function createSink() {
  try {
    return await createOpfsSink();
  } catch (e) {
    console.warn('[hls] OPFS 사용 불가, 메모리 모드로 전환', e);
    return createMemorySink();
  }
}

async function createOpfsSink() {
  const root = await navigator.storage.getDirectory();
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.part`;

  // 이 탭이 살아있는 동안 잠금을 쥐고 있어, 다른 탭의 정리 작업이 파일을 지우지 못하게 한다.
  let releaseLock;
  await new Promise((acquired) => {
    navigator.locks.request(LOCK_PREFIX + name, () => {
      acquired();
      return new Promise((r) => (releaseLock = r));
    });
  });

  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let closed = false;

  return {
    write: (chunk) => writable.write(chunk),
    async finish() {
      await writable.close();
      closed = true;
      return URL.createObjectURL(await handle.getFile());
    },
    async cleanup() {
      if (!closed) await writable.abort().catch(() => {});
      await root.removeEntry(name).catch(() => {});
      releaseLock?.();
    },
  };
}

function createMemorySink() {
  const parts = [];
  return {
    write: async (chunk) => void parts.push(chunk),
    finish: async () => URL.createObjectURL(new Blob(parts)),
    cleanup: async () => void (parts.length = 0),
  };
}
