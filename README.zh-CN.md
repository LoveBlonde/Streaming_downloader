# HLS Segment Downloader（Chrome 扩展）

[한국어](README.md) | [English](README.en.md) | **简体中文** | [日本語](README.ja.md)

一款 Chrome/Edge 扩展：自动检测网页中正在播放的 HLS（`.m3u8`）流，并行下载分片（segment），并合并保存为**单个 MP4 文件**。视频与音频分为独立轨道的流也会自动合并。

> 扩展界面目前仅提供韩语。下文括号中注明了对应的按钮文字。

## 安装（开发者模式）

1. 下载（克隆）本仓库。
2. 在 Chrome 中打开 `chrome://extensions` → 开启右上角的**开发者模式**
3. 点击**加载已解压的扩展程序** → 选择仓库根目录（包含 `manifest.json` 的文件夹）
4. （Edge 在 `edge://extensions` 中操作相同）

## 使用方法

1. 在有视频的页面上**播放视频**。检测到 m3u8 请求后，扩展图标上会显示数字角标。
   - 如果视频在安装扩展前已在播放，请刷新页面后重新播放（无法检测安装前发出的请求）。
2. 点击扩展图标 → 点击所检测到的流旁边的**下载**（다운로드）
   - 通常会同时捕获 `master.m3u8`（清晰度列表）和 `index.m3u8`（实际分片列表）。一般选择 master 即可选择清晰度。
   - 如果已知 URL，可使用弹窗中的**手动输入 URL**（URL 직접 입력）。Referer 建议填写视频所在页面的地址。
3. 在新标签页中选择清晰度 / 音轨（有多个时）/ 文件名 / 并发连接数，然后点击**开始下载**（다운로드 시작）
   - 进度阶段：下载视频 →（音频独立时）下载音频 → 转换为 MP4
4. 完成后会弹出保存位置对话框。**下载过程中请勿关闭该标签页。**

## 工作原理

| 阶段 | 实现 |
| --- | --- |
| 检测 | 通过 `webRequest` 监听标签页的请求。记录 URL 以 `.m3u8` 结尾或响应 `Content-Type` 为 HLS 的请求，并同时保存当时的 **Referer** |
| 请求头还原 | 为通过 CDN 的防盗链（Referer/Origin 校验），使用 `declarativeNetRequest` 会话规则，**仅对下载标签页发出的请求**将 Referer/Origin 设置为原页面的值 |
| 解析 | 支持主播放列表（清晰度列表）/ 媒体播放列表（分片）、`EXT-X-KEY`、`EXT-X-MAP`（fMP4）、`EXT-X-BYTERANGE` |
| 下载 | N 路并行请求、按分片指数退避重试、按顺序写入、限制内存占用（限制提前下载的数量） |
| 解密 | `METHOD=AES-128` 通过 WebCrypto（AES-CBC）自动解密。未指定 IV 时按规范使用媒体序列号 |
| 临时存储 | 分片不放在内存中，而是按轨道追加写入 **OPFS（浏览器专用磁盘空间）** → 数 GB 的视频也不会占用大量内存 |
| MP4 转换 | 使用 [Mediabunny](https://github.com/Vanilagy/mediabunny) **不重新编码，仅将容器转换（remux）为 MP4**。独立音轨在此阶段与视频合并。无画质损失，速度快 |
| 保存 | 通过 `chrome.downloads` 保存后删除临时文件 |

## 输出格式

始终保存为 `.mp4`（保留原始编码，如 H.264/H.265 + AAC）。

- 输入分片：支持 MPEG-TS、fMP4、packed audio（ADTS `.aac`）
- 音视频分离的流（`EXT-X-MEDIA TYPE=AUDIO`）：下载所选音轨并合并为一个 MP4
- 万一 MP4 转换失败，不会丢弃已下载的数据，而是以原始格式（`.ts`）保存并显示原因。
- 转换期间原始文件与 MP4 会短暂同时存在，因此需要**约为视频大小 2 倍的可用磁盘空间**。

## 不支持的内容（有意为之 / 当前限制）

- **受 DRM 保护的内容**（Widevine、FairPlay、PlayReady、`SAMPLE-AES`）：检测到时会拒绝下载。Netflix、Disney+ 等大多数付费流媒体属于此类，不会加入任何绕过功能。
- **直播流**：仅保存下载时播放列表中已有的片段（不提供录制功能）。
- 因插入广告等原因导致时间戳中途重置（`EXT-X-DISCONTINUITY`）的流，可能在该处出现音画不同步（会显示警告）。
- 对于 Cookie/令牌很快过期的网站，耗时较长的下载可能中途出现 403 错误。

## 开发

```bash
npm test   # 解析器、下载器、MP4 转换的单元测试（Node 20+，无需安装依赖）
```

```
manifest.json
src/
  background.js        # 检测 m3u8 请求（Service Worker）
  popup.html/js        # 检测列表 UI
  downloader.html/js   # 清晰度选择、进度、保存 UI，安装 Referer 规则
  lib/m3u8.js          # 播放列表解析器
  lib/hls-downloader.js# 并行下载、重试、AES-128 解密、按顺序写入
  lib/opfs-sink.js     # OPFS 临时文件
  lib/remux.js         # TS/fMP4/ADTS → MP4 remux，合并视频与音频
  vendor/mediabunny/   # Mediabunny 1.61.3（MPL-2.0），未经修改直接包含打包文件
tests/                 # fixtures/ 中为简短的 TS/AAC 测试文件
```

## 注意事项

请仅用于您拥有版权或被允许下载的内容。未经版权方许可保存、传播视频可能违反著作权法，使用责任由用户自行承担。
