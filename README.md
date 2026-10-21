# Subline 双语字幕

在 YouTube、HBO Max 和 X 上显示双语字幕。扩展读取原文字幕时间轴，用你自己的 OpenAI 兼容 API 分段翻译，再以自定义字幕显示原文和译文。项目使用 Chrome Manifest V3、React、TypeScript 和 Vite，没有后端。

## 使用

需要 Node.js 22.13 或更高版本。执行 `npm install` 和 `npm run build`，在 `chrome://extensions` 开启「开发者模式」，加载本项目的 `dist` 文件夹，并在安装或重新加载后刷新已经打开的视频页面。点击扩展图标可以开关双语字幕、选择译文语言；在设置页填写 Base URL、API Key 和 Model ID。扩展自动读取当前视频字幕轨道的语言，支持英语、简体中文、繁体中文和日语。遇到其他语言时，译文位置显示「原文语言不支持」，不发送翻译请求。在设置页的「数据使用说明」里勾选同意并保存后，在 YouTube、HBO Max 或 X 的播放器中打开原文字幕。没有同意时扩展不发送字幕；换成另一个域名的 Base URL 后要重新同意。扩展只把原文发给你选定的 API 翻译，设置留在本机，API Key 加密后保存，已发出的请求仍可能计费。扩展处理哪些数据、保存多久和怎样删除，见[隐私政策](PRIVACY.md)。

## 开发

```sh
npm ci
npm run dev
npm test
npm run build
npm run verify
```

`npm ci` 按锁文件安装依赖。`npm run dev` 启动设置页预览，默认地址是 http://localhost:5173。`npm test` 运行接口、配置、翻译队列和字幕生命周期测试。`npm run build`把扩展输出到`dist/`。`npm run verify` 依次执行 lint、类型检查、测试、构建和 YouTube、HBO、X 的浏览器回归，任一步失败时进程以非零状态退出。

chrome-debug skill 的测试、辅助代码和 fixtures 位于 [`tests/chrome-debug/`](tests/chrome-debug/README.md)。`npm run test:chrome-debug` 运行其中不需要浏览器的测试，完整测试的运行方法见该目录的说明。

字幕先按句末标点断成句子；2 秒以上的静音、歌词行（♪）和音效标注（[…]）也会断开。超过 90 列（汉字算两列）的句子再由扩展按原文语言在本地切成几条字幕：先在逗号、分号等子句标点处或原字幕片段之间切，仍超过 90 列的再按词切，英文按空格，中文和日语用各自语言的 `Intl.Segmenter` 分词。每条字幕单独翻译、单独显示，Provider 不负责断句。规则和浏览器验证见 [改造记录](docs/reviews/2026-10-10-caption-split.md)。

字幕队列提前请求未来至少 30 秒播放时间的字幕，近期请求耗时的 90 分位越慢，提前量越长，播放速度越快，覆盖的视频时间越长。每个请求最多四条字幕，且跨度不超过 10 秒视频；即将播放的字幕单独请求，1 秒内就要消失的字幕不进计划。同时最多两个字幕请求在途，已发出的请求不会因播放或拖动被取消。拖动过程中不发送新请求，落点稳定 400 毫秒后才恢复调度；拖动前已发出的请求继续完成并写入缓存，但不再占用在途和每秒发送的名额。翻译失败的字幕不会重试，仍在预取范围内时也不会再次请求。调度测试和浏览器验证见 [改造记录](docs/reviews/2026-10-09-playback-buffer-plan.md)。
