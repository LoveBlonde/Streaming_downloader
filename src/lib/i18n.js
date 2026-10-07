// 확장 화면 다국어 처리.
// chrome.i18n은 브라우저 언어를 따라가기만 하고 실행 중 바꿀 수 없으므로,
// 설정 페이지에서 고른 언어(chrome.storage.sync 'language')를 적용하는 자체 사전을 쓴다.

export const LANGUAGES = {
  ko: '한국어',
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
};
export const DEFAULT_LANGUAGE_SETTING = 'auto';
const FALLBACK = 'en';

const MESSAGES = {
  ko: {
    // 팝업
    popupTitle: '감지된 HLS 스트림',
    popupEmpty: '아직 감지된 m3u8이 없습니다.\n영상을 재생한 뒤(또는 새로고침 후 재생) 다시 열어 보세요.',
    copy: '복사',
    copied: '복사됨',
    download: '다운로드',
    manualUrl: 'URL 직접 입력',
    manualRefererPlaceholder: 'Referer (선택, 비우면 현재 탭 주소)',
    openDownloader: '다운로드 페이지 열기',
    settings: '설정',
    checking: '확인 중…',
    kindMaster: '화질 목록 · 화질 {n}개',
    kindMasterAudio: '화질 목록 · 화질 {n}개 · 음성 트랙 {a}개',
    kindMedia: '단일 재생목록 · {duration}',
    recommended: '추천',
    includedInMaster: '위 화질 목록에 포함된 재생목록입니다. 화질 선택과 별도 음성 트랙 처리를 위해 위의 화질 목록으로 받는 것을 권장합니다.',
    checkFailed: '종류 확인 실패 ({error})',

    // 다운로드 페이지
    dlTitle: 'HLS 세그먼트 다운로드',
    sourceUrl: '원본 URL',
    referer: 'Referer',
    none: '(없음)',
    loadingPlaylist: '플레이리스트를 불러오는 중…',
    quality: '화질',
    audioTrack: '음성 트랙',
    filename: '파일 이름',
    concurrency: '동시 연결 수',
    start: '다운로드 시작',
    cancel: '취소',
    analyzing: '플레이리스트 분석 중…',
    segInfo: '세그먼트 {n}개 · {duration} · {format}',
    encrypted: ' · AES-128 암호화(자동 복호화)',
    videoLine: '영상: {desc}',
    audioSeparate: '음성: 별도 트랙 · {desc} (MP4로 합쳐 저장)',
    audioIncluded: '음성: 영상 파일에 포함',
    warnLive: '라이브(진행 중) 스트림으로 보입니다. 지금 시점의 플레이리스트에 있는 구간만 저장됩니다.',
    warnDiscontinuity: '중간에 불연속 구간(광고 삽입 등)이 있습니다. 해당 지점에서 화면/소리가 어긋날 수 있습니다.',
    errNoUrl: 'URL이 지정되지 않았습니다.',
    errNoVariants: '마스터 플레이리스트에 화질 정보가 없습니다.',
    errNestedMaster: '중첩된 마스터 플레이리스트는 지원하지 않습니다.',
    errHttp: '플레이리스트 요청 실패: HTTP {status}',
    drmSuffix: '{reason} 이 확장은 DRM 보호 콘텐츠를 다운로드하지 않습니다.',
    progressSegments: '{done} / {total} 세그먼트 ({pct}%)',
    eta: '남은 시간 {time}',
    retries: '재시도 {n}회',
    dontClose: '이 탭을 닫지 마세요.',
    phaseVideo: '{i}/{n} 영상 다운로드',
    phaseAudio: '{i}/{n} 음성 다운로드',
    phaseRemux: '{i}/{n} MP4로 변환 중 (재인코딩 없음)',
    noteNoAudio: ' (참고: 이 스트림에는 음성 트랙이 없습니다)',
    noteRemuxFailed: ' ⚠️ MP4 변환 실패({error}) — 원본 형식({ext})으로 저장했습니다.',
    noteRemuxNoAudio: ' 별도 음성 트랙은 포함되지 않았습니다.',
    doneChooseLocation: '완료 ({size}, {time}). 저장 위치를 선택하세요…',
    saved: '✅ 저장 완료! 이 탭을 닫아도 됩니다.',
    saveCancelled: '저장이 취소되었거나 중단되었습니다.',
    cancelled: '취소되었습니다.',
    errorPrefix: '오류: {message}',

    // 라이브러리 에러
    errInvalidM3u8: '유효한 M3U8 파일이 아닙니다 (#EXTM3U 헤더 없음).',
    errDrmMethod: 'DRM/미지원 암호화 방식({method})이 적용된 스트림입니다.',
    errDrmKeyFormat: 'DRM 키 포맷({format})이 적용된 스트림입니다.',
    errNoSegments: '세그먼트가 없는 플레이리스트입니다.',
    errKeyLength: 'AES-128 키 길이가 16바이트가 아닙니다 ({n}바이트).',
    errUnsupportedMethod: '지원하지 않는 암호화 방식: {method}',
    errNoTracks: '파일에서 영상/음성 트랙을 찾지 못했습니다.',
    errCodecVideo: 'MP4에 담을 수 없는 영상 코덱입니다.',
    errCodecAudio: 'MP4에 담을 수 없는 음성 코덱입니다.',

    // 설정
    settingsTitle: '설정',
    language: '언어',
    languageAuto: '자동 (브라우저 언어: {lang})',
    languageHint: '팝업과 설정 화면에는 바로 적용됩니다. 이미 열려 있는 다운로드 탭은 새로고침하면 적용됩니다.',
    savedToast: '저장되었습니다.',
  },

  en: {
    popupTitle: 'Detected HLS streams',
    popupEmpty: 'No m3u8 detected yet.\nPlay the video (or reload and play it), then open this again.',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download',
    manualUrl: 'Enter URL manually',
    manualRefererPlaceholder: 'Referer (optional; defaults to the current tab address)',
    openDownloader: 'Open download page',
    settings: 'Settings',
    checking: 'Checking…',
    kindMaster: 'Quality list · qualities: {n}',
    kindMasterAudio: 'Quality list · qualities: {n} · audio tracks: {a}',
    kindMedia: 'Single playlist · {duration}',
    recommended: 'Recommended',
    includedInMaster: 'This playlist is part of the quality list above. Download the quality list instead so you can choose the quality and get separate audio tracks.',
    checkFailed: 'Could not check type ({error})',

    dlTitle: 'HLS segment download',
    sourceUrl: 'Source URL',
    referer: 'Referer',
    none: '(none)',
    loadingPlaylist: 'Loading playlist…',
    quality: 'Quality',
    audioTrack: 'Audio track',
    filename: 'File name',
    concurrency: 'Parallel connections',
    start: 'Start download',
    cancel: 'Cancel',
    analyzing: 'Analyzing playlist…',
    segInfo: '{n} segments · {duration} · {format}',
    encrypted: ' · AES-128 encrypted (decrypted automatically)',
    videoLine: 'Video: {desc}',
    audioSeparate: 'Audio: separate track · {desc} (merged into the MP4)',
    audioIncluded: 'Audio: included in the video file',
    warnLive: 'This looks like a live stream. Only the segments currently in the playlist will be saved.',
    warnDiscontinuity: 'The stream has discontinuities (e.g. inserted ads). Video and audio may go out of sync at those points.',
    errNoUrl: 'No URL was given.',
    errNoVariants: 'The master playlist contains no quality variants.',
    errNestedMaster: 'Nested master playlists are not supported.',
    errHttp: 'Playlist request failed: HTTP {status}',
    drmSuffix: '{reason} This extension does not download DRM-protected content.',
    progressSegments: '{done} / {total} segments ({pct}%)',
    eta: '{time} left',
    retries: 'Retries: {n}',
    dontClose: 'Do not close this tab.',
    phaseVideo: '{i}/{n} Downloading video',
    phaseAudio: '{i}/{n} Downloading audio',
    phaseRemux: '{i}/{n} Converting to MP4 (no re-encoding)',
    noteNoAudio: ' (Note: this stream has no audio track)',
    noteRemuxFailed: ' ⚠️ MP4 conversion failed ({error}) — saved in the original format ({ext}).',
    noteRemuxNoAudio: ' The separate audio track is not included.',
    doneChooseLocation: 'Done ({size}, {time}). Choose where to save…',
    saved: '✅ Saved! You can close this tab.',
    saveCancelled: 'Saving was cancelled or interrupted.',
    cancelled: 'Cancelled.',
    errorPrefix: 'Error: {message}',

    errInvalidM3u8: 'Not a valid M3U8 file (missing #EXTM3U header).',
    errDrmMethod: 'The stream uses DRM / an unsupported encryption method ({method}).',
    errDrmKeyFormat: 'The stream uses a DRM key format ({format}).',
    errNoSegments: 'The playlist has no segments.',
    errKeyLength: 'The AES-128 key is not 16 bytes long ({n} bytes).',
    errUnsupportedMethod: 'Unsupported encryption method: {method}',
    errNoTracks: 'No video or audio track was found in the file.',
    errCodecVideo: 'The video codec cannot be stored in MP4.',
    errCodecAudio: 'The audio codec cannot be stored in MP4.',

    settingsTitle: 'Settings',
    language: 'Language',
    languageAuto: 'Automatic (browser language: {lang})',
    languageHint: 'Applies immediately to the popup and this page. Download tabs that are already open apply it after a reload.',
    savedToast: 'Saved.',
  },

  'zh-CN': {
    popupTitle: '检测到的 HLS 流',
    popupEmpty: '尚未检测到 m3u8。\n请播放视频（或刷新后播放），然后再次打开。',
    copy: '复制',
    copied: '已复制',
    download: '下载',
    manualUrl: '手动输入 URL',
    manualRefererPlaceholder: 'Referer（可选，留空则使用当前标签页地址）',
    openDownloader: '打开下载页面',
    settings: '设置',
    checking: '检查中…',
    kindMaster: '清晰度列表 · {n} 种清晰度',
    kindMasterAudio: '清晰度列表 · {n} 种清晰度 · {a} 条音轨',
    kindMedia: '单个播放列表 · {duration}',
    recommended: '推荐',
    includedInMaster: '该播放列表包含在上方的清晰度列表中。建议下载上方的清晰度列表，以便选择清晰度并处理独立音轨。',
    checkFailed: '无法确认类型（{error}）',

    dlTitle: 'HLS 分片下载',
    sourceUrl: '源 URL',
    referer: 'Referer',
    none: '（无）',
    loadingPlaylist: '正在加载播放列表…',
    quality: '清晰度',
    audioTrack: '音轨',
    filename: '文件名',
    concurrency: '并发连接数',
    start: '开始下载',
    cancel: '取消',
    analyzing: '正在分析播放列表…',
    segInfo: '{n} 个分片 · {duration} · {format}',
    encrypted: ' · AES-128 加密（自动解密）',
    videoLine: '视频：{desc}',
    audioSeparate: '音频：独立音轨 · {desc}（合并保存为 MP4）',
    audioIncluded: '音频：包含在视频文件中',
    warnLive: '这似乎是直播流。只会保存当前播放列表中已有的片段。',
    warnDiscontinuity: '流中存在不连续片段（如插入的广告）。这些位置可能出现音画不同步。',
    errNoUrl: '未指定 URL。',
    errNoVariants: '主播放列表中没有清晰度信息。',
    errNestedMaster: '不支持嵌套的主播放列表。',
    errHttp: '播放列表请求失败：HTTP {status}',
    drmSuffix: '{reason} 本扩展不下载受 DRM 保护的内容。',
    progressSegments: '{done} / {total} 个分片（{pct}%）',
    eta: '剩余 {time}',
    retries: '重试 {n} 次',
    dontClose: '请勿关闭此标签页。',
    phaseVideo: '{i}/{n} 下载视频',
    phaseAudio: '{i}/{n} 下载音频',
    phaseRemux: '{i}/{n} 正在转换为 MP4（不重新编码）',
    noteNoAudio: '（提示：此流没有音轨）',
    noteRemuxFailed: ' ⚠️ MP4 转换失败（{error}）— 已以原始格式（{ext}）保存。',
    noteRemuxNoAudio: '独立音轨未包含在内。',
    doneChooseLocation: '完成（{size}，{time}）。请选择保存位置…',
    saved: '✅ 保存完成！可以关闭此标签页。',
    saveCancelled: '保存已取消或中断。',
    cancelled: '已取消。',
    errorPrefix: '错误：{message}',

    errInvalidM3u8: '不是有效的 M3U8 文件（缺少 #EXTM3U 头）。',
    errDrmMethod: '该流使用了 DRM / 不支持的加密方式（{method}）。',
    errDrmKeyFormat: '该流使用了 DRM 密钥格式（{format}）。',
    errNoSegments: '播放列表中没有分片。',
    errKeyLength: 'AES-128 密钥长度不是 16 字节（{n} 字节）。',
    errUnsupportedMethod: '不支持的加密方式：{method}',
    errNoTracks: '在文件中未找到视频或音频轨道。',
    errCodecVideo: '该视频编码无法存入 MP4。',
    errCodecAudio: '该音频编码无法存入 MP4。',

    settingsTitle: '设置',
    language: '语言',
    languageAuto: '自动（浏览器语言：{lang}）',
    languageHint: '弹窗和本页面会立即生效。已打开的下载标签页需刷新后生效。',
    savedToast: '已保存。',
  },

  ja: {
    popupTitle: '検出された HLS ストリーム',
    popupEmpty: 'まだ m3u8 が検出されていません。\n動画を再生してから（または再読み込みして再生してから）もう一度開いてください。',
    copy: 'コピー',
    copied: 'コピーしました',
    download: 'ダウンロード',
    manualUrl: 'URL を直接入力',
    manualRefererPlaceholder: 'Referer（任意。空欄なら現在のタブのアドレス）',
    openDownloader: 'ダウンロードページを開く',
    settings: '設定',
    checking: '確認中…',
    kindMaster: '画質一覧 · {n} 画質',
    kindMasterAudio: '画質一覧 · {n} 画質 · 音声トラック {a} 本',
    kindMedia: '単一プレイリスト · {duration}',
    recommended: 'おすすめ',
    includedInMaster: 'このプレイリストは上の画質一覧に含まれています。画質の選択や別トラックの音声に対応するため、上の画質一覧からダウンロードすることをおすすめします。',
    checkFailed: '種類を確認できませんでした（{error}）',

    dlTitle: 'HLS セグメントダウンロード',
    sourceUrl: '元の URL',
    referer: 'Referer',
    none: '（なし）',
    loadingPlaylist: 'プレイリストを読み込み中…',
    quality: '画質',
    audioTrack: '音声トラック',
    filename: 'ファイル名',
    concurrency: '同時接続数',
    start: 'ダウンロード開始',
    cancel: 'キャンセル',
    analyzing: 'プレイリストを解析中…',
    segInfo: 'セグメント {n} 個 · {duration} · {format}',
    encrypted: ' · AES-128 暗号化（自動で復号）',
    videoLine: '映像：{desc}',
    audioSeparate: '音声：別トラック · {desc}（MP4 に結合して保存）',
    audioIncluded: '音声：映像ファイルに含まれています',
    warnLive: 'ライブ（配信中）ストリームのようです。現時点のプレイリストにある区間のみ保存されます。',
    warnDiscontinuity: '途中に不連続な区間（広告の挿入など）があります。その地点で映像と音声がずれることがあります。',
    errNoUrl: 'URL が指定されていません。',
    errNoVariants: 'マスタープレイリストに画質情報がありません。',
    errNestedMaster: '入れ子になったマスタープレイリストには対応していません。',
    errHttp: 'プレイリストの取得に失敗しました：HTTP {status}',
    drmSuffix: '{reason} この拡張機能は DRM で保護されたコンテンツをダウンロードしません。',
    progressSegments: '{done} / {total} セグメント（{pct}%）',
    eta: '残り {time}',
    retries: '再試行 {n} 回',
    dontClose: 'このタブを閉じないでください。',
    phaseVideo: '{i}/{n} 映像をダウンロード中',
    phaseAudio: '{i}/{n} 音声をダウンロード中',
    phaseRemux: '{i}/{n} MP4 に変換中（再エンコードなし）',
    noteNoAudio: '（注：このストリームには音声トラックがありません）',
    noteRemuxFailed: ' ⚠️ MP4 変換に失敗しました（{error}）— 元の形式（{ext}）で保存しました。',
    noteRemuxNoAudio: '別トラックの音声は含まれていません。',
    doneChooseLocation: '完了（{size}、{time}）。保存先を選択してください…',
    saved: '✅ 保存しました！このタブは閉じても大丈夫です。',
    saveCancelled: '保存がキャンセルまたは中断されました。',
    cancelled: 'キャンセルしました。',
    errorPrefix: 'エラー：{message}',

    errInvalidM3u8: '有効な M3U8 ファイルではありません（#EXTM3U ヘッダーがありません）。',
    errDrmMethod: 'DRM / 非対応の暗号化方式（{method}）が使われているストリームです。',
    errDrmKeyFormat: 'DRM の鍵形式（{format}）が使われているストリームです。',
    errNoSegments: 'セグメントのないプレイリストです。',
    errKeyLength: 'AES-128 の鍵の長さが 16 バイトではありません（{n} バイト）。',
    errUnsupportedMethod: '非対応の暗号化方式：{method}',
    errNoTracks: 'ファイル内に映像・音声トラックが見つかりません。',
    errCodecVideo: 'MP4 に格納できない映像コーデックです。',
    errCodecAudio: 'MP4 に格納できない音声コーデックです。',

    settingsTitle: '設定',
    language: '言語',
    languageAuto: '自動（ブラウザの言語：{lang}）',
    languageHint: 'ポップアップとこの画面にはすぐに反映されます。すでに開いているダウンロードタブは再読み込みすると反映されます。',
    savedToast: '保存しました。',
  },
};

/** 브라우저 UI 언어를 지원 언어 중 하나로 매핑한다. */
export function detectBrowserLanguage(uiLang) {
  const l = (uiLang || '').toLowerCase();
  if (l.startsWith('ko')) return 'ko';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('zh')) return 'zh-CN';
  if (l.startsWith('en')) return 'en';
  return FALLBACK;
}

function browserUiLanguage() {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return globalThis.navigator?.language ?? '';
  }
}

export function resolveLanguage(setting) {
  return setting && setting !== 'auto' && MESSAGES[setting] ? setting : detectBrowserLanguage(browserUiLanguage());
}

let current = resolveLanguage('auto');

export function setLanguage(lang) {
  current = MESSAGES[lang] ? lang : FALLBACK;
  if (globalThis.document) document.documentElement.lang = current;
}

export function getLanguage() {
  return current;
}

/** 저장된 언어 설정을 읽어 적용한다. 페이지 시작 시 한 번 호출. */
export async function initI18n() {
  let setting = DEFAULT_LANGUAGE_SETTING;
  try {
    setting = (await chrome.storage.sync.get('language')).language ?? DEFAULT_LANGUAGE_SETTING;
  } catch {}
  setLanguage(resolveLanguage(setting));
  return setting;
}

/** 메시지를 찾아 {name} 자리표시자를 채운다. 없는 키는 영어 → 키 이름 순으로 대체한다. */
export function t(key, params = {}, lang = current) {
  const template = MESSAGES[lang]?.[key] ?? MESSAGES[FALLBACK][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/** data-i18n / data-i18n-placeholder / data-i18n-title 속성이 붙은 요소에 번역을 적용한다. */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

/** 라이브러리가 던진 LocalizedError는 현재 언어로, 그 외 에러는 원문 메시지로 표시한다. */
export function errorText(err) {
  if (err?.i18nKey) return t(err.i18nKey, err.params);
  return err?.message ?? String(err);
}

// 테스트용
export const _MESSAGES = MESSAGES;
