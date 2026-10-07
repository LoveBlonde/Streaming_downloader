// 임시 파일을 메모리가 아닌 OPFS(Origin Private File System, 브라우저 전용 디스크 영역)에 만든다.
// 수 GB짜리 영상도 RAM에 올리지 않고 받고·합치고·변환할 수 있다.

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

/**
 * OPFS 임시 파일을 만든다.
 * - `writable`: 위치 지정 쓰기({type:'write', position, data})를 지원하는 WritableStream
 * - `write(chunk)`: 순차 쓰기
 * - `close()`: 쓰기를 끝내고 디스크 기반 File(Blob)을 돌려준다
 * - `remove()`: 파일 삭제
 */
export async function createTempFile(label = 'tmp') {
  const root = await navigator.storage.getDirectory();
  const name = `${Date.now()}-${label}-${Math.random().toString(36).slice(2)}.part`;

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
    writable,
    write: (chunk) => writable.write(chunk),
    /** 쓰기 스트림을 직접 닫은 경우(예: mediabunny StreamTarget이 finalize 시 닫음)에 호출 */
    markClosed() {
      closed = true;
    },
    async close() {
      if (!closed) await writable.close();
      closed = true;
      return handle.getFile();
    },
    async remove() {
      if (!closed) await writable.abort().catch(() => {});
      closed = true;
      await root.removeEntry(name).catch(() => {});
      releaseLock?.();
    },
  };
}
