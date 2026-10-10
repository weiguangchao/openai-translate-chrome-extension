# Subline 双语字幕

在 YouTube、HBO Max 和 X 上显示双语字幕。扩展读取原文字幕时间轴，用你自己的 OpenAI 兼容 API 分段翻译，再以自定义字幕显示原文和译文。项目使用 Chrome Manifest V3、React、TypeScript 和 Vite，没有后端。

## 使用

需要 Node.js 22.13 或更高版本。执行 `npm install` 和 `npm run build`，在 `chrome://extensions` 开启「开发者模式」，加载本项目的 `dist` 文件夹，并在安装或重新加载后刷新已经打开的视频页面。点击扩展图标可以开关双语字幕、修改语言，并填写 Base URL、API Key 和 Model ID。原文和译文语言可选英语、简体中文和繁体中文。保存后，在 YouTube、HBO Max 或 X 的播放器中打开原文字幕。扩展只把原文发给你选定的 API 翻译，设置留在本机，已发出的请求仍可能计费。

## 开发

```sh
npm ci
npm run dev
npm test
npm run build
npm run verify
```

`npm ci` 按锁文件安装依赖。`npm run dev` 启动设置页预览，默认地址是 http://localhost:5173。`npm test` 运行接口、配置、翻译队列和字幕生命周期测试。`npm run build`把扩展输出到`dist/`。`npm run verify` 依次执行 lint、类型检查、测试、构建和 YouTube、HBO、X 的浏览器回归，任一步失败时进程以非零状态退出。

超过 80 列（汉字算两列）的句子由扩展按原文语言在本地断成多行：先在逗号、分号等子句标点处断开，仍超过 80 列的子句再按词断开，英文按空格，中文用 `Intl.Segmenter` 分词。Provider 只逐行翻译，不负责断句。断行规则和浏览器验证见 [改造记录](docs/reviews/2026-10-09-local-line-splitting.md)。

字幕队列提前请求未来至少 30 秒播放时间的字幕，近期请求耗时的 90 分位越慢，提前量越长，播放速度越快，覆盖的视频时间越长。每个请求最多四句，且跨度不超过 10 秒视频；即将播放的句子单独请求，1 秒内就要消失的句子不进计划。同时最多两个字幕请求在途，正常播放时不取消已发出的请求。拖动过程中不发送新请求，落点稳定 400 毫秒后才恢复调度。调度测试和浏览器验证见 [改造记录](docs/reviews/2026-10-09-playback-buffer-plan.md)。
