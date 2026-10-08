真实站点验收由 `chrome-debug` skill 完成。一个后台进程持有到用户已登录 Chrome 的唯一一条 DevTools 连接，用户只需允许一次；检查文件写明要打开的页面和步骤。本次补齐了 skill 实际使用中暴露的 8 个问题，并让 Subline 的 service worker 打印计时事件，`trace` 步骤据此测量字幕延迟。

## skill 的 8 处改动

1. 标签页被关闭或崩溃时立即判失败，报告写明当时的视频时间。此前会一直重试到预算耗尽（实测空等 414 秒）。
2. 检查可设 `on_fail` 表达式和 `fail_screenshot`，失败时在关闭标签页之前保留页面数据。
3. `evaluate` 返回带 `fail` 键的对象时立即失败，不再等预算（实测空等 377 秒）。
4. 运行中在 stderr 输出每步的开始、结束和每 30 秒的等待进度。
5. `evaluate` 的返回值上限从 2000 字符放宽到 20000；`save` 把完整结果写入文件。
6. `expression_file` 从检查文件所在目录读取 JavaScript。
7. 内置 `trace` 动作，见下节。
8. 报告保留检查里写的原始 URL，只有抓到的网络请求才去掉查询参数。

## Service worker 计时事件

- 页面 `<html>` 带 `data-subline-trace` 时，内容脚本把画面状态（视频时间、`翻译中` 或译文、cue 序号和所在段）发给 service worker，并在 `data-subline-trace-worker` 写回扩展 id。没有这个属性的页面什么都不发。
- service worker 为每个 Provider 批次打印组成、发出、首条返回和完成四条 `console.debug`，只含 tab、段号、耗时和结果。队列的 key 含 API key，事件不使用它；Provider 的错误信息也不打印。
- holder 连上 Subline 的 service worker，只监听 `[subline] ` 开头的日志。它不在网页上开启 `Runtime` 域：开启后 YouTube 不再返回字幕，原生字幕和 Subline 一起消失。
- `live reload` 按 `dist` 的路径算出解包扩展的 id，在 Subline 的 popup 页执行 `chrome.runtime.reload()`，并确认新的 service worker 已启动。

最初的 `trace` 在页面里每 250 毫秒读取一次字幕层和平台原生字幕，再按词重叠配对。改用计时事件后，延迟按 cue 计算，不再依赖配对，这一版已删除。

## 真实站点验收

用户的 Chrome，Provider 为用户已配置的服务，视频 YouTube `iG9CE55wbtY`（Ken Robinson TED 演讲）。

两种 trace 在同一次播放中并行 150 秒（从 982 秒开始）：

| 指标                | 计时事件                               | 页面采样    |
| ------------------- | -------------------------------------- | ----------- |
| 覆盖率              | 90.2%                                  | 89.5%       |
| `翻译中`            | 1 段，14.0 秒                          | 1 段，14 秒 |
| 首条译文距开始      | 14.8 秒                                | 15.0 秒     |
| 每句延迟 p90 / 最大 | 0.1 / 0.1 秒                           | 0.3 / 3 秒  |
| 未出译文的句子      | 4                                      | 不可见      |
| Provider 批次往返   | 14.0（放弃）、3.5、14.3、33.9、47.0 秒 | 不可见      |

页面采样的 3 秒最大延迟来自配对错误：YouTube 原生字幕按行滚动，Subline 显示整句。

`live reload` 后从头播放 120 秒：26 句全部按时出现译文，覆盖率 99.9%，每句延迟 p90 0.1 秒。第一个批次（第 0 段 10 句）往返 16.9 秒，演讲在第 27 秒才开口，刚好盖住。

## 发现

- 每个批次第一条结果到达的时间等于整批完成的时间，第一句要等整段 10 句一起返回。这是冷启动慢的直接原因。
- 进入稳定播放后，预取把十几秒到几十秒的批次耗时都盖住了。
- YouTube 的 CC 按钮会显示为按下而播放器不拉字幕。验收时在看到原生字幕之前反复关开 CC。
- 每换一句字幕会先闪现约 0.1 秒 `翻译中`；service worker 重启后缓存丢失，已翻译的段会再请求一次。两者另行修复。
- Chrome for Testing 用 `--load-extension` 加载的扩展，重新加载后会被禁用，`live reload` 只在用户的 Chrome 中验证。
