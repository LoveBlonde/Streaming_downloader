# HLS Segment Downloader (Chrome Extension)

[한국어](README.md) | **English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

A Chrome/Edge extension that automatically detects HLS (`.m3u8`) streams playing on a web page, downloads their segments in parallel, and merges them into **a single MP4 file**. Streams whose video and audio are split into separate tracks are merged automatically as well.

The UI is available in Korean, English, Simplified Chinese and Japanese (see [Settings](#settings-ui-language)).

## Installation (Developer mode)

1. Download (clone) this repository.
2. In Chrome, open `chrome://extensions` → turn on **Developer mode** (top right)
3. Click **Load unpacked** → select the repository root folder (the one containing `manifest.json`)
4. (Same for Edge at `edge://extensions`)

## Usage

1. **Play the video** on the page. When an m3u8 request is detected, a number badge appears on the extension icon.
   - If the video was already playing, reload the page and play it again (requests made before the extension was installed can't be detected).
2. Click the extension icon → click **Download** next to the detected stream
   - **It is normal for 2 or more m3u8s to be detected for one video.** The player first loads the **quality list (master)** and then the **playlist (media)** of the chosen quality.
   - The popup checks each entry and labels it `Quality list · Recommended` / `Single playlist`; a playlist that belongs to a quality list is dimmed and moved down. **Download the entry marked `Recommended`.** Downloading only the playlist gives you no quality choice and may lose the audio on sites that serve audio as a separate track.
   - If you already know the URL, use **Enter URL manually** in the popup. Set the Referer to the address of the page the video was on.
3. In the new tab, choose quality / audio track (when there are several) / file name / number of parallel connections, then click **Start download**
   - Stages: video download → audio download (if separate) → MP4 conversion
4. When finished, a save dialog appears. **Do not close the tab while downloading.**

## Settings (UI language)

Choose the UI language with the **⚙** button at the top right of the popup (or `chrome://extensions` → Details → Extension options).

- Automatic (browser language) / 한국어 / English / 简体中文 / 日本語
- Applies immediately to the popup and settings page; download tabs that are already open apply it after a reload.
- The name/description in Chrome's extension list follow the browser language (a Chrome restriction).

## How it works

| Stage | Implementation |
| --- | --- |
| Detection | Observes tab requests via `webRequest`. Records requests whose URL ends with `.m3u8` or whose response `Content-Type` is HLS, together with the **Referer** used at that time |
| Header replay | To pass CDN hotlink protection (Referer/Origin checks), a `declarativeNetRequest` session rule sets Referer/Origin to the original page's values **only for requests from the download tab** |
| Parsing | Master (quality list) / media (segment) playlists, `EXT-X-KEY`, `EXT-X-MAP` (fMP4), `EXT-X-BYTERANGE` |
| Download | N parallel requests, per-segment exponential-backoff retries, in-order writing, bounded memory use (limits how far ahead it fetches) |
| Decryption | `METHOD=AES-128` is decrypted automatically with WebCrypto (AES-CBC). When no IV is given, the media sequence number is used as per the spec |
| Temporary storage | Segments are appended per track to **OPFS (the browser's private on-disk storage)** instead of RAM → multi-GB videos without memory pressure |
| MP4 conversion | Uses [Mediabunny](https://github.com/Vanilagy/mediabunny) to **remux into MP4 without re-encoding** (only the container changes). A separate audio track is merged with the video at this stage. No quality loss, and fast |
| Saving | Saved via `chrome.downloads`, then the temporary files are deleted |

## Output format

Always saved as `.mp4` (original codecs kept as-is, e.g. H.264/H.265 + AAC).

- Input segments: MPEG-TS, fMP4, packed audio (ADTS `.aac`)
- Split video/audio streams (`EXT-X-MEDIA TYPE=AUDIO`): the selected audio track is downloaded and merged into one MP4
- If MP4 conversion ever fails, the downloaded data is not discarded: it is saved in the original format (`.ts`) and the reason is shown.
- Because the original and the MP4 briefly coexist during conversion, you need **free disk space of about 2× the video size**.

## Not supported (by design / current limitations)

- **DRM-protected content** (Widevine, FairPlay, PlayReady, `SAMPLE-AES`): the download is refused when detected. Most paid streaming services (Netflix, Disney+, etc.) fall into this category, and no feature to bypass it will be added.
- **Live streams**: only the segments present in the playlist at download time are saved (no recording).
- Streams whose timestamps reset midway (`EXT-X-DISCONTINUITY`, e.g. inserted ads) may go out of sync at that point (a warning is shown).
- On sites whose cookies/tokens expire quickly, long downloads may hit 403 errors partway through.

## Development

```bash
npm test   # unit tests for the parser, downloader and MP4 remux (Node 20+, no dependencies to install)
```

```
manifest.json
_locales/              # extension name/description (en, ko, ja, zh_CN)
src/
  background.js        # m3u8 request detection (service worker)
  popup.html/js        # detected-stream list UI (master/media labels)
  options.html/js      # settings page (language)
  downloader.html/js   # quality selection, progress and save UI; installs the Referer rule
  lib/m3u8.js          # playlist parser
  lib/hls-downloader.js# parallel download, retries, AES-128 decryption, in-order writing
  lib/opfs-sink.js     # OPFS temporary files
  lib/remux.js         # TS/fMP4/ADTS → MP4 remux, video + audio merge
  lib/i18n.js          # UI translations and language setting
  lib/classify.js      # master/media relationship of detected streams
  lib/errors.js, format.js
  vendor/mediabunny/   # Mediabunny 1.61.3 (MPL-2.0), bundled file included unmodified
tests/                 # fixtures/ contains short TS/AAC test files
```

## Disclaimer

Use this only for content you own the copyright to or are permitted to download. Saving or distributing videos without the copyright holder's permission may violate copyright law, and responsibility for use lies with the user.
