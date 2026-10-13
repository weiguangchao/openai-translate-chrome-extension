# Subline 隐私政策

English version: [Subline privacy policy](#subline-privacy-policy)

本政策自 2026 年 10 月 12 日起生效。

Subline 是一个 Chrome 扩展，在 YouTube、HBO Max 和 X 的视频上显示双语字幕。它用你自己填写的 OpenAI 兼容 API 翻译字幕。Subline 没有开发者服务器，开发者收不到你的字幕、API Key、设置或用量统计。本政策说明扩展处理哪些数据、发给谁、保存多久，以及怎样删除。

## 扩展处理的数据

### 字幕原文和译文

在你开启了 Subline 的视频网站上，扩展从字幕文件或播放器显示的字幕中读取原文。扩展只从视频网站给出的地址下载字幕文件。

你开启 Subline 并填好 API 设置后，扩展把即将播放的字幕原文发到你填写的 API 地址，请模型翻译。同一个请求还带有你的 API Key、Model ID、原文和译文的语言名称，以及一段固定的翻译要求。请求不包含视频地址、视频标题、你的视频网站账号或浏览记录。

扩展把字幕原文和译文缓存在 Chrome 的会话存储 chrome.storage.session 中，回看时不用重新请求。会话存储只在内存中，不写入磁盘。

### API 设置

你填写的 Base URL、API Key 和 Model ID 保存在本机 Chrome 的扩展存储 chrome.storage.local 中，不会同步到其他设备。Chrome 不加密这块存储。视频网站的页面读不到 API Key，扩展在视频页面里运行的脚本也读不到。扩展只在三种请求里把 API Key 发给你填写的 API 地址，分别是翻译字幕、获取模型列表和测试连接。测试连接发送一句固定的英文例句，不发送字幕。

### 模型列表

扩展把 API 返回的模型 ID 列表缓存在 chrome.storage.local 中。每份缓存以 API 地址和 API Key 的 SHA-256 哈希值区分，缓存里只有哈希值，没有 API Key 原文。

### 显示设置

总开关、各网站开关、语言、字幕颜色、字号、背景透明度和两行字幕的间距保存在 chrome.storage.local 中。

### 用量统计

API 在响应中返回 token 用量时，扩展把它累加成输入、输出和缓存三个 token 总数，保存在 chrome.storage.local 中，并显示在扩展弹窗里。用量统计不记录视频、时间或单次请求，扩展也不把它发到任何地方。

### 视频页面信息

扩展在视频页面里读取视频编号或页面地址，以及播放进度，用来区分不同视频并对齐字幕时间。这些信息只在浏览器内存中使用，扩展不保存也不发送。

## 数据接收方

你填写的 API 服务是唯一的接收方。它可以是 OpenAI、其他兼容服务商或你自己的服务器。它会收到上面列出的请求内容，也会像其他网站一样看到你的 IP 地址。该服务怎样保存和使用这些数据，由它自己的隐私政策和条款决定。

Subline 不使用统计分析、广告、错误上报或远程代码。Subline 不出售数据，也不把数据用于广告、信用评估或借贷。

### 使用 HTTP 地址时

如果 Base URL 以 `http://` 开头，API Key 和字幕原文会以明文在网络上传输。请尽量使用 HTTPS，只对本机或你信任的局域网服务使用 HTTP。

## 保存期限和删除方式

- 浏览器关闭，或扩展重新加载、更新、停用时，Chrome 会清空字幕原文和译文缓存。
- API 设置、模型列表、显示设置和用量统计保留在本机，直到你删除。
- 要删除 API Key，在设置页清空 API Key 后保存。旧 API Key 对应的模型列表缓存会保留到你移除扩展。
- 要删除全部本地数据，在 `chrome://extensions` 中移除 Subline，Chrome 会一并删除扩展保存的全部数据。
- 已经发给 API 服务的数据由该服务保管，Subline 无法删除，请按服务商提供的方式处理。

## 权限

- `storage` 用来保存上面列出的设置和缓存。
- YouTube、HBO Max 和 X 的网站访问权限用来读取字幕，并在播放器上显示双语字幕。
- 可选的网站访问权限用来连接你的 API。保存设置时，扩展只请求你填写的 API 地址所在主机的权限。

## Limited Use

Subline 对所处理信息的使用遵守 [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies)，包括其中的 [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) 要求。扩展只为翻译和显示字幕使用这些数据。

## 政策变更

处理数据的方式改变时，我们会在发布新版本前更新本政策和生效日期。本文件的历史版本见仓库的提交记录。

## 联系方式

有问题请在 [GitHub Issues](https://github.com/weiguangchao/openai-translate-chrome-extension/issues) 提出。

---

# Subline privacy policy

This policy takes effect on October 12, 2026.

Subline is a Chrome extension that shows bilingual subtitles on YouTube, HBO Max and X videos. It translates subtitles with an OpenAI-compatible API that you configure. Subline has no developer server, so the developer never receives your subtitles, API key, settings or usage counts. This policy lists the data the extension handles, who receives it, how long the extension keeps it and how to delete it.

## Data the extension handles

### Subtitle text and translations

On video sites where Subline is turned on, the extension reads the original subtitles from subtitle files or from the subtitles the player shows. It downloads subtitle files only from the addresses the video site provides.

After you turn Subline on and fill in the API settings, the extension sends the text of upcoming subtitles to the API address you entered and asks the model to translate it. Each request also carries your API key, the model ID, the names of the source and target languages, and fixed translation instructions. Requests do not include the video address, the video title, your video site account or your browsing history.

The extension caches subtitle text and translations in Chrome session storage, chrome.storage.session, so replayed subtitles need no new request. Session storage lives in memory and is never written to disk.

### API settings

Chrome stores the base URL, API key and model ID you enter in chrome.storage.local, inside your Chrome profile on this device. Chrome does not sync this storage to other devices and does not encrypt it. Video site pages cannot read the API key, and neither can the scripts the extension runs inside those pages. The extension sends the API key only to the API address you entered, in three kinds of requests: translating subtitles, fetching the model list and testing the connection. The connection test sends a fixed English sentence, not subtitles.

### Model list

The extension caches the model IDs your API returns in chrome.storage.local. It keys each cached list by a SHA-256 hash of the API address and API key. The cache holds the hash, not the API key.

### Display settings

The extension stores the main switch, the per-site switches, the languages, subtitle colors, font sizes, background opacity and the gap between the two subtitle lines in chrome.storage.local.

### Usage counts

When your API reports token usage in its response, the extension adds it to three running totals for input, output and cached tokens. It stores the totals in chrome.storage.local and shows them in the extension popup. The totals record no videos, times or individual requests, and the extension sends them nowhere.

### Video page information

Inside the video page, the extension reads the video ID or page address and the playback position to tell videos apart and to time subtitles. This information stays in browser memory. The extension neither stores nor sends it.

## Who receives data

The API service you configure is the only recipient. It can be OpenAI, another compatible provider or your own server. It receives the request contents described above and, like any website, your IP address. Its own privacy policy and terms govern how it stores and uses that data.

Subline uses no analytics, ads, error reporting or remote code. Subline does not sell data and does not use data for advertising, credit-worthiness or lending.

### HTTP addresses

If the base URL starts with `http://`, your API key and subtitle text cross the network unencrypted. Use HTTPS when you can, and use HTTP only for a service on your own computer or on a local network you trust.

## Retention and deletion

- Chrome clears the subtitle and translation cache when the browser closes or when the extension is reloaded, updated or disabled.
- API settings, model lists, display settings and usage counts stay on this device until you delete them.
- To delete your API key, clear the API Key field on the settings page and save. Model lists cached for the old key stay until you remove the extension.
- To delete all local data, remove Subline at `chrome://extensions`. Chrome deletes everything the extension stored.
- Subline cannot delete data already sent to your API service. Use that provider's own deletion options.

## Permissions

- `storage` saves the settings and caches listed above.
- Access to YouTube, HBO Max and X lets the extension read subtitles and show bilingual subtitles on the player.
- Optional site access lets the extension reach your API. When you save settings, the extension asks only for the host of the API address you entered.

## Limited Use

Subline's use of the information it handles adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements. The extension uses this data only to translate and show subtitles.

## Changes

If the way Subline handles data changes, we update this policy and its effective date before releasing the new version. The repository's commit history keeps earlier versions of this file.

## Contact

Ask questions in [GitHub Issues](https://github.com/weiguangchao/openai-translate-chrome-extension/issues).
