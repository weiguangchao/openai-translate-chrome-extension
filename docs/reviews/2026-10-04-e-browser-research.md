# E 类治理：Chrome 扩展浏览器验证资料核查

日期：2026-10-04。配套阅读：[原审查方案](2026-10-04-correct-plan.md)。初次资料研究没有启动浏览器、运行新的浏览器测试、改业务代码或改仓库设置。后续已核查个人 Chrome 的现有连接能力，补充见第 2 节；仍未执行真实平台播放验收。引用的在线文档与主分支源码会更新；实际落地必须固定测试框架及浏览器版本。

结论：DevTools 适合定位现场问题，CDP/浏览器测试框架能把部分诊断变成可重复断言。E 类的“验证必须运行”仍需固定测试发现、统一命令、CI 和合并条件。建议先做少量针对构建产物的离线扩展集成测试，再保留真实 YouTube/HBO 的本机 Chrome 验收。不要把录制回放或一次截图当成完整验证链。

## 1. DevTools 对扩展生命周期有观察者效应，但不能泛化到所有 CDP 自动化

**确证。** Chrome 官方调试教程明确写道：“Inspecting the service worker keeps it active”，并要求测试 worker 终止行为时关闭 DevTools。因此，打开扩展 `service worker` 的 Inspector 后，一次成功播放不能证明它能从自然休眠恢复。[S1]

**确证。** Chrome MV3 生命周期文档描述了通常的终止条件：约 30 秒无活动、单个请求处理超过 5 分钟、`fetch()` 响应超过 30 秒才到达。接收事件和调用扩展 API 会重置计时；worker 全局变量会在关闭后丢失。文档还单独说明 Chrome 118 起，通过扩展 `chrome.debugger` API 建立的 active debugger sessions 会保活。这一条针对扩展 API，不能据此推导所有外部 CDP 客户端都会保活。[S2]

**确证。** 当前 Playwright 扩展文档已专门说明 MV3 idle suspension：worker 可因空闲暂停、按需重启；Playwright 保留同一个 `Worker` 对象，不再发出新的 `serviceworker` 事件；重启时新 `evaluate()` 会等待执行上下文恢复，已经进行中的调用则可能报 `Service worker restarted`。因此，“只要用了 Playwright/CDP 就一定测不到休眠”也是错误的。[S3]

当前 Playwright 主分支 `crServiceWorker.ts` 处理 `Inspector.targetCrashed`、`Inspector.targetReloadedAfterCrash`、执行上下文重建，并调用 `Runtime.enable`。这是其重启支持的补充源码证据，不能替代固定版本的实际检查。[S4]

**建议。** 把两个问题分开验证：

1. **确定性终止恢复**：构建扩展正常翻译一次 → 定位该扩展的 worker → 主动终止 → 从正常页面动作触发新的翻译 → 断言新字幕能完成、旧结果不覆盖新画面。Chrome 官方已有 Puppeteer `WebWorker.close()` 的对应教程；CDP 也有 `Target.closeTarget`。只终止匹配扩展 ID 的 worker。[S5][S6]
2. **自然空闲恢复**：关闭 worker Inspector，减少会持续唤醒它的页面活动，观察执行上下文确实销毁/重新创建，再验证恢复。只等待 40 秒不能证明休眠发生；本项目页面轮询或消息可能重置计时。这个观测方案需针对选定框架/浏览器实测，首次未验证前标记为待验证。[S2][S3]

不要额外增加生产扩展的 `debugger` 权限来“方便测试”。测试进程控制 CDP 与扩展自身申请 `chrome.debugger` 是两种不同机制。[S2][S6]

**与本项目的边界。** `src/extension/background.ts` 当前将 `TranslationQueue` 和设置快照保存在 worker 内存中。恢复检查应首先要求“可以重新工作”，不能把“内存译文缓存必须跨 worker 关闭保留”擅自作为新需求。本轮也不据 30 秒浏览器规则直接断言现有 60 秒 Provider 超时实现有缺陷；应将超过 30 秒首响应列为有价值的运行时探针。[本地源码；S2]

## 2. 普通 Chrome、Chrome for Testing 和 Playwright Chromium 要分清

| 情况                        | 已核实的能力/约束                                                                                                                                                                | 对本项目的含义                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright 测试扩展         | 官方路径为 Chromium + persistent context；示例使用 `--load-extension`、`--disable-extensions-except`。[S3]                                                                       | 每次测试使用独立临时 profile，加载实际构建目录；不能按普通 Web 项目仅调用 `browser.newContext()`。                                    |
| Headless 扩展               | Playwright 文档明确推荐 `channel: 'chromium'`，使用完整 Chromium 的新版 headless；默认 headless shell 与此不同。[S3][S7]                                                         | CI 可以无头运行受控 fixture，但应固定这一启动方式并先 smoke。                                                                         |
| 普通 branded Chrome 137+    | Chrome 官方公告移除了 `--load-extension` flag；Chromium 与 Chrome for Testing 保留。[S8]                                                                                         | 不能直接把本机 `/Applications/Google Chrome.app` 塞进旧教程的 flags 就承诺可用。                                                      |
| 新的扩展安装 API            | 当前 Puppeteer 支持 `enableExtensions` / `browser.installExtension()`；CDP 存在 `Extensions.loadUnpacked`；Chrome 自己的 Puppeteer 教程也使用 `enableExtensions`。[S9][S10][S11] | 上一条不等于“普通 Chrome 完全无法自动装扩展”。若选择这条路，应另核对实际 Chrome/Puppeteer 版本和启用条件，不同时引入两套完整 runner。 |
| 普通 Chrome 136+ 的远程调试 | 默认用户数据目录不再接受 `--remote-debugging-port` / `--remote-debugging-pipe`，需要非默认 `--user-data-dir`。[S12]                                                              | 自动化单独 profile；不要依赖附着日常默认 profile。正常人工打开 DevTools 不受这条远程调试参数规则等同限制。                            |
| Chrome for Testing          | 官方用于自动化的版本化 Chrome，不自动更新，与 Chrome 发布过程绑定。[S13]                                                                                                         | 适合需要 Chrome 版本对应关系的测试；不必因为可用就再增设与 Chromium 重复的整套 CI。                                                   |

**建议。** 第一版选择一种自动化框架即可：Playwright 配套 Chromium 的文档路径足够覆盖 fixture 集成链路；本机稳定版 Chrome 承担真实站点验收。若团队更看重 Chrome 官方扩展示例、真实 toolbar popup 或直接终止 worker，可改选 Puppeteer，理由是工作量匹配，不能声称它天然消除了所有生命周期干扰。[S3][S5][S9]

**后续补充：个人 profile 可以通过现有浏览器连接复用。** Chrome DevTools MCP 官方将 Chrome 144+ 的 `--autoConnect` 与传统 remote-debugging-port 连接分开说明：用户在 `chrome://inspect/#remote-debugging` 启用并允许连接后，可访问 Chrome 选定 profile 的已有窗口；多 profile 时以 Chrome 决定的默认 profile 为准。[S22] 上表 Chrome 136 的限制针对旧命令行端口/pipe 方式，不等于所有个人 profile 连接都被禁止。

本次已通过当前 Chrome DevTools 工具列出原有标签页，并确认 `Subline · 双语字幕` v0.1.0 已启用；不需要为现场验收另外建立 Chromium 登录会话。具体两个站点的会话有效性和扩展构建身份尚未检查。可控 fixture CI 不需要账号；新建 profile 做真实登录站点验收则需要用户首次登录，可用持久测试 profile 复用后续会话。

## 3. Provider 请求在 background worker，page.route 不够

**确证。** Playwright service worker 文档说明，worker 自己发起的网络请求通过 `BrowserContext` 事件及 `browserContext.route()` 处理；`request.serviceWorker()` 可区分其归属。非空 service worker 请求没有 frame，调用其 `request.frame()` 会报错。文档同时说明，受网页 service worker 控制的同一资源可能产生 frame-owned 与 worker-owned 两类事件，不能无条件把所有事件求和。[S14]

**确证。** Playwright 通用网络文档里的 `serviceWorkers: 'block'` 是对一些普通 Web mock 问题的建议，不能不加分析地套到本项目。当前 Playwright 源码在该设置下关闭其 worker 网络观察；扩展测试必须实际确认 worker 和 Provider 路由都正常工作。[S4][S15]

**本地事实。** 本项目 Provider 请求通过 `src/extension/background.ts` 调用 shared API；字幕采集另外有 MAIN-world 页面脚本与 content script。只对播放器页面设置 `page.route('**/chat/completions')`，或只在该页面 Network 面板计数，不能被当成后台流量已完整被观测的证据。

**建议的 preflight，正式写场景前先证明这四件事：**

1. 加载未经修改的构建产物，MAIN 脚本及 content script 确实注入匹配 URL。
2. 从页面触发字幕翻译，使用 context-level route 捕获 background 的 Provider POST；以 `request.serviceWorker()`、扩展 URL、接口路径确认归属。
3. 返回确定的假结果，页面显示预期原文与译文；这是端到端成功断言，不能只断言“有请求”。
4. 所有未声明的 HTTP(S) 请求中止并让测试失败，不允许 fixture 意外回落到真实 YouTube/HBO 或付费 Provider。记录的请求体和凭据只来自假配置。

**推断/待验证。** 可用 `context.route()` 把 `https://www.youtube.com/watch?...`、受支持的 HBO URL、本地字幕数据和媒体文件全部 fulfill 为 fixture，保留 manifest 匹配和平台判断所需的 origin/path。这样不需要修改生产 manifest 来匹配 localhost；但 MAIN-world 初始化时序、播放器对象 shape、HBO React 数据入口、CSP 和真实可播放媒体仍需最小 smoke 证明。本笔记未运行这个方案，不声称已可用。

fixture 能验证自家扩展跨上下文接线，不能证明未来网站的私有播放器对象、React fiber 或字幕请求格式保持不变。真实站点检查仍必需。

## 4. optional_host_permissions 不能用 Web 权限 API 冒充

**确证。** `chrome.permissions.request()` 请求可选扩展权限，官方要求它发生在 user gesture 内，新的权限警告可能显示浏览器授权提示。[S16]

**确证。** Playwright `browserContext.grantPermissions()` 支持的是 geolocation、camera、notifications 等 Web 权限。CDP `Browser.grantPermissions` / `Browser.setPermission` 同样描述网页权限；当前 CDP `Extensions` 域有安装、列举、卸载、存储等命令，没有直接设置扩展 host grants 的命令。不能声称 `context.grantPermissions(['https://provider.example/*'])` 可以授权本扩展访问 Provider。[S17][S11]

**本地事实。** `public/manifest.json` 对 YouTube/HBO 站点有 required host permissions，对任意 HTTP(S) Provider 使用 `optional_host_permissions`；`src/shared/storage.ts` 的 `allowApiHost()` 请求相应 origin。

**建议。** 第一版有两条诚实的路径：

- 使用真实设置页点击动作申请本地假 Provider 的权限，先确认选定自动化框架能处理该版本 Chrome 的浏览器授权提示，再纳入流水线。文档不能证明这个项目的整条授权链已可自动完成，必须把它列为 harness preflight。
- 若上述路径阻碍最小集成 smoke，可将假 Provider 的 Base URL 临时配置为 manifest 已有权限的站点，例如 `https://www.youtube.com/__e2e_provider__/v1`，由 context route 完全接管。这不改构建产物和权限；它仅覆盖“已授权配置下的翻译链路”，不能声称覆盖 Provider 可选权限弹窗、拒绝和撤销。这个具体假路径也需先 smoke。

不要为了方便，把测试版 manifest 的 host permissions 改成 `<all_urls>` 后声称原产物已验收。也不要直接修改 Chrome profile 权限数据库当成默认测试方案。对真实权限 UX，保留单独的授权、拒绝、撤销后失败检查；没有自动化证据时如实列为本机 Chrome 验收范围。

## 5. Recorder 能留操作步骤，但不足以直接验证整个扩展

**确证。** DevTools Recorder 支持用户动作、DOM 属性/数量等断言、等待表达式、网络节流、步骤编辑和 JSON/Puppeteer 导出。Recorder 步骤有 `target` 与 `frame` 属性，因此不应描述为“只能一个页面/不能 iframe”。[S18][S19]

**推断。** 官方描述的能力围绕页面操作和 DOM；它不会自动生成本项目需要的下列行为断言：

- 一次兼容重试到底产生了几个 background Provider POST；
- 字号变化是否取消了仍在等待的翻译；
- 旧视频的晚到结果是否写入新视频；
- 扩展 worker 是否真正终止、再次触发后是否恢复；
- 页面 MAIN world、content script 隔离上下文和 background 间的消息是否来自正确来源。

Recorder 的多 target 属性也不等价于已经能直接录制浏览器原生权限框、工具栏所有交互或任意 worker 执行上下文。因此它适合产出简短复现步骤，必要时导出后加断言；不适合独自充当 E 类必经验证入口。[S18][S19]

CDP 的 target/session 能区分页面和 worker，Runtime 还能选择执行上下文；自动化框架已经封装其中大部分能力。除非现成接口不足，不建议为本项目重造通用 CDP target 管理平台。[S6][S20]

## 6. 无头 fixture 通过，不代表真实 HBO 播放已通过

**确证。** Playwright 官方说明 Chromium 与 branded Chrome 的媒体 codec 包含范围不同，部分 codec 与平台、许可有关。[S7] Widevine 官方把 HBO Max 列为使用方，也列出受支持的平台及加密方案。[S21]

**不能据此推出的结论。** 这些资料不证明“所有 Chromium/headless 都不支持 DRM”，也不证明“任何 Chrome for Testing 都能成功播放 HBO”。后者还依赖具体构建、CDM、站点、账号、地区、内容和当前服务状态。此处必须保留实测边界。

**建议。** CI 用自有短视频/明确可播放的 fixture 验证字幕播放、seek、pause、全屏布局和消息链路，不下载/重放受保护的 HBO 正片。真实 HBO 和 YouTube 在本机 Chrome、实际页面及可用登录环境下，按变更影响做有边界的验收。若 HBO 无法进入播放或没有可用字幕，应标“环境阻塞，未验收”，不能把它记作扩展通过或扩展失败。

真实站点最少记录：构建 commit、Chrome 版本、站点/内容定位、字幕轨道、动作、预期与实际、成功或阻塞、必要截图。精确限流和异步竞态尽量留在 fake-clock 行为测试；不把真实 Provider 输出是否逐字相同作为 PR 硬门槛。

## 7. 对 E 类治理的最小落地顺序

以下为建议，不是已经实施的状态：

1. **先修稳定入口。** 沿用原方案：Vitest 明确仅发现 `tests`；为新增浏览器测试独立目录/匹配规则；建立 `verify`；CI 锁文件安装、固定运行时；稳定产生检查后再把对应检查设为合并条件。DevTools 不替代这一层。
2. **做一个 harness 可行性提交。** 只验证扩展真实构建加载、平台 fixture 注入、worker Provider 路由、权限策略、出现一条正确字幕、网络无逃逸。成功后才批量写用例。失败应报告具体能力阻塞，不能悄悄换成直接导入 source 的单元测试。
3. **加少量高价值跨边界场景。** 初期选：两平台各一条翻译链路；切换内容后旧结果不覆盖；Provider 切分前后显示契约；关闭扩展恢复原生字幕；worker 终止后再次翻译；设置变更影响范围。已知 A/C/D 红例保持“当前缺口”身份，修复后才成为必须绿的功能断言；不能为了先上 CI 放宽成错误行为快照。
4. **证据跟随执行。** 失败留 trace、截图、浏览器/扩展错误和经过筛选的假 Provider 请求记录；记录 commit 和浏览器版本。不要上传真实账号 profile、真实 key 或完整 HBO/YouTube 网络包。首次失败仍要可见，避免依靠无上限重试把 flaky 场景漂成绿。
5. **真实站点验证按风险触发。** adapter、manifest、MAIN-world 桥接、字幕层、播放器事件变更触发本机 Chrome 场景；纯函数修改不必每次要求登录 HBO。必须明确谁检查证据，不能只有 PR 文本中的一个手工复选框却宣称已强制。

这一范围不需要先构建大规模视觉基线、所有站点的 nightly 真网回放、AI judge、全仓 mutation 平台或定制调试面板。先证明小链路真的检测到故障，再扩充场景。

## 一手资料

- **S1** Chrome：Debug extensions，worker Inspector 会保持活动。<https://developer.chrome.com/docs/extensions/get-started/tutorial/debug>
- **S2** Chrome：The extension service worker lifecycle。<https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle>
- **S3** Playwright：Chrome extensions，persistent context、新版 headless、idle suspension。<https://playwright.dev/docs/chrome-extensions>
- **S4** Playwright 官方源码：`CRServiceWorker`。<https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crServiceWorker.ts>
- **S5** Chrome：Test service worker termination with Puppeteer。<https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer>
- **S6** CDP Target 协议；本次通过官方协议 JSON 核对 `getTargets`、`attachToTarget`、`setAutoAttach`、`closeTarget`。<https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json>
- **S7** Playwright：Browsers，headless shell、新版 headless、media codecs。<https://playwright.dev/docs/browsers>
- **S8** Chromium 扩展团队公告：Removing `--load-extension` flag in Chrome branded builds，Chrome 137。<https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY>
- **S9** Puppeteer：Chrome Extensions，`enableExtensions` 与运行时安装 API。<https://pptr.dev/guides/chrome-extensions>
- **S10** Chrome：Test Chrome Extensions with Puppeteer。<https://developer.chrome.com/docs/extensions/how-to/test/puppeteer>
- **S11** CDP 官方协议定义：`Browser` permissions 与 `Extensions` commands。<https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json>
- **S12** Chrome：Changes to remote debugging switches to improve security，Chrome 136。<https://developer.chrome.com/blog/remote-debugging-port>
- **S13** Chrome：Chrome for Testing。<https://developer.chrome.com/blog/chrome-for-testing>
- **S14** Playwright：Service Workers，网络事件归属与 context routing。<https://playwright.dev/docs/service-workers>
- **S15** Playwright：Network，Missing Network Events and Service Workers。<https://playwright.dev/docs/network#missing-network-events-and-service-workers>
- **S16** Chrome：`chrome.permissions`。<https://developer.chrome.com/docs/extensions/reference/api/permissions>
- **S17** Playwright：`BrowserContext.grantPermissions`。<https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions>
- **S18** Chrome：Recorder，record/replay/measure user flows。<https://developer.chrome.com/docs/devtools/recorder>
- **S19** Chrome：Recorder features reference，step properties、assertions 与导出。<https://developer.chrome.com/docs/devtools/recorder/reference>
- **S20** CDP 官方 Runtime 协议定义。<https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/js_protocol.json>
- **S21** Google：Widevine DRM overview。<https://developers.google.com/widevine/drm/overview>
- **S22** Chrome DevTools MCP：Advanced Usage，连接现有 Chrome 与自动连接的 profile 选择。<https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md>
