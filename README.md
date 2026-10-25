# Subline 双语字幕

## 项目介绍

Subline 是一个 Chrome 扩展，在 YouTube、HBO Max 和 X 的播放器中显示原文字幕和译文。它读取视频已有的字幕，用你自己的 OpenAI 兼容 API 翻译。使用前需要准备 API Key 和可用的模型。

## 项目功能

- 支持 YouTube、HBO Max 和 X 的视频字幕翻译。
- 自动读取当前字幕轨道的语言，支持英语、简体中文、繁体中文和日语，也可将这些语言设为译文语言。
- 提前翻译即将播放的字幕，并缓存译文供回看使用。
- 支持双语显示或只显示译文，可调整字号、颜色、行间距和译文背景不透明度。
- 支持自定义 OpenAI 兼容 API 的地址和模型，设置保存在本机，API Key 加密保存。

## 安装

以下步骤从源码构建并安装到 Chrome。需要 Chrome 120 或更高版本，以及 Node.js 和 npm。Node.js 版本请使用 [`.nvmrc`](.nvmrc) 中指定的版本。

1. 获取源码并构建扩展。

   ```sh
   git clone https://github.com/weiguangchao/openai-translate-chrome-extension.git
   cd openai-translate-chrome-extension
   npm ci
   npm run build
   ```

2. 在 Chrome 地址栏打开 `chrome://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择项目中的 `dist/` 文件夹。
4. 确认扩展列表中出现 `Subline · Alpha`，然后刷新已经打开的视频页面。

## 使用

1. 点击扩展图标，再点击弹窗右上角的设置图标。在「常规设置」中填写翻译服务信息。
   - `Base URL` 是包含版本路径的接口根地址，例如 `https://api.openai.com/v1`。
   - `API Key` 是你的翻译服务密钥。
   - `Model ID` 是服务商提供的模型标识，可手动填写或获取模型列表后选择。
2. 选择译文语言，在「数据使用说明」中勾选同意发送字幕原文，然后保存。Chrome 提示网站访问权限时，允许扩展连接你填写的 API 地址。
3. 在 YouTube、HBO Max 或 X 上打开带字幕的视频，并在播放器中开启原文字幕。
4. 点击扩展图标，开启「启用双语字幕」。弹窗中可以切换译文语言，或勾选「只显示译文」。

原文语言由视频当前选择的字幕轨道决定。原文与译文语言相同时，扩展只显示原文，不请求翻译。遇到不支持的原文语言时，扩展显示「原文语言不支持」，不发送翻译请求。

在设置页的「字幕样式」中可以调整显示效果。安装或重新加载扩展后，需要刷新视频页面。

Subline 没有自己的服务器。字幕原文只发送给你选定的翻译服务，请求可能产生费用。未同意数据使用说明时，扩展不发送字幕。更换 API 的协议、域名或端口后，需要重新同意。API 地址须使用 HTTPS，只有 `localhost` 和 `127.0.0.1` 的本机服务可以使用 HTTP。数据保存和删除方式见[隐私政策](PRIVACY.md)。

## 开发

项目使用 Chrome Manifest V3、React、TypeScript 和 Vite，没有后端。完成上面的依赖安装后，可以启动设置页预览。

```sh
npm run dev
```

默认预览地址是 `http://localhost:5173`。预览只用于设置页开发。验证视频字幕功能时，运行 `npm run build`，在 `chrome://extensions` 重新加载扩展，再刷新视频页面。

常用检查命令如下。

```sh
npm test
npx playwright install chromium
npm run verify
```

`npm test` 运行单元测试。完整检查前需安装 Playwright 的 Chromium。`npm run verify` 运行 lint、类型检查、测试、上架版构建和浏览器回归。`npm run build:store` 可单独构建上架版，输出目录同为 `dist/`。

字幕切分和调度设计见[字幕切分记录](docs/reviews/2026-10-10-caption-split.md)和[播放缓冲记录](docs/reviews/2026-10-09-playback-buffer-plan.md)。浏览器调试说明见 [`tests/chrome-debug/`](tests/chrome-debug/README.md)。正式发布流程见 [release.yml](.github/workflows/release.yml)。

[prerelease.yml](.github/workflows/prerelease.yml) 每天北京时间 00:00 检查 `main` 在刚结束的自然日内是否有提交。有提交时运行 `npm run verify`，把检查时的 `main` 代码打包为 `subline-prerelease.zip`，更新固定的 `prerelease` 标签和同一个 GitHub 预发布。没有提交时跳过构建和发布。预发布不上传 Chrome Web Store。GitHub 定时任务可能延迟执行。
