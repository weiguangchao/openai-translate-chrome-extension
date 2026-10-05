# E 类陷阱：从 DevTools 调试走向可重复的扩展验收

日期：2026-10-04。代码基线：`774dd06f789f255eb4df4a5d5cdb071feb40d667`。

本文是对 [原审查方案 E 类](2026-10-04-correct-plan.md) 的实施建议，尚未实施测试框架、CI 或仓库设置变更。本次读取了源码、测试、构建配置，实际运行了测试发现命令，并核对 Chrome、Playwright、GitHub 官方资料；没有运行真实 YouTube/HBO 扩展验收。浏览器研究依据另见 [资料笔记](2026-10-04-e-browser-research.md)。

**建议采用三层验证：现有行为测试 → 加载实际扩展的可控浏览器测试 → 本地 Chrome 真实平台验收。DevTools 用来定位和采集证据；固定命令与必需状态检查保证验证真正执行。**

## 1. 当前真正缺什么

| 当前事实                                                                      | 对验证方案的影响                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `vite.config.ts` 的 node project 只有排除规则，没有限制正式测试目录           | 本次 `vitest list --filesOnly --json` 列出 22 条：21 个正式测试文件，以及 `.artifacts/latency-sim/sim.test.ts`。必须先稳定测试发现。 |
| YouTube/HBO 测试运行在 jsdom，background/content 测试替换了 Chrome API 或网络 | 已有测试能验证字幕算法和不少生命周期行为，但不能证明浏览器真实注入、跨执行环境消息、权限及扩展打包正确。                             |
| manifest 同时使用 `MAIN` 页面脚本、隔离环境内容脚本和 MV3 Service Worker      | 只打开 Vite 设置页，或者把 controller 放进演示网页，不算完成扩展端到端验收。                                                         |
| `SubtitleOverlay` 使用开放的 Shadow DOM                                       | 浏览器可以直接观察原文、译文、可见性和几何位置，不必为测试向网页暴露内部控制接口。                                                   |
| HBO 页面适配读取 React Fiber 中的播放器状态；YouTube 读取播放器对象及字幕轨道 | 可控夹具能检测自身逻辑回归，但无法证明真实网站今天仍保持相同结构。需要真实平台验收。                                                 |
| Provider 请求实际由 `src/extension/background.ts` 调用 API 发出               | 只看视频页面的 Network 面板不能作为完整 Provider 请求证据；需观察后台上下文或独立的模拟端点。                                        |

原文中 257 个正式测试通过属于已有审查结果；本次只重新确认了发现列表，没有把那次结果冒充本次执行结果。GitHub Actions 和 main 保护状态沿用原报告的历史描述，本次没有重新查询或修改。

## 2. DevTools 在这里怎么用

先给每个观察点一个明确问题，避免以“截图正常”代替完整验收。

| 观察点                                                    | 要回答的问题                                                                  | 可保留的证据                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 视频页 DevTools：Elements、Console、Network               | 是否取得指定原文轨道？MAIN 脚本与内容脚本是否连通？字幕是否遮挡、越界或重复？ | 来源下载状态；当前播放时间；Shadow DOM 原文/译文；播放器和字幕边界；截图 |
| `chrome://extensions` 中该扩展的 Service Worker Inspector | 是否真的发送 Provider POST？是否有兼容重试、错误、超额请求？                  | 每次实际请求的时序与结果、后台异常；不要只数 queue 调用                  |
| 扩展设置页与弹出页                                        | 保存设置、语言切换、域名授权后是否传到正在播放的页面？                        | 操作前后状态和视频页结果；权限允许/拒绝的实际结果                        |
| 单独的生命周期测试                                        | 后台停止后能否重新处理消息？扩展重载后旧脚本能否恢复原生字幕？                | 停止/重启或上下文失效的证据，以及后续可见行为                            |

Chrome 官方明确说明：**正在检查 Service Worker 的 DevTools 会保持它活跃**。[1] 因此，保持 Inspector 打开时得到的播放成功，不能证明后台休眠后也成功。延迟和缓存观测还应注明是否开启 Inspector、网络节流或 Disable cache。

DevTools Recorder 可辅助重放页面点击和生成调试脚本，但不会自动替我们判断字幕语义、跨后台收集 Provider 请求或建立合并规则。正式回归采用带断言的脚本；DevTools 保留为定位问题的工具。

## 3. 第一层：先把现有验证变成必经入口

保留现有 Vitest 和分层设计，先完成小而独立的治理：

1. node project 显式只发现 `tests/` 下约定的单元测试文件。DOM、YouTube、HBO 分配由一份配置列表派生，保留各自环境和站点 URL。
2. 新增 `test:discovery`：扫描正式测试集合，与 `vitest list --filesOnly --json` 对比；每个文件恰好出现在一个 project，且环境分配正确。不要把“21 个文件”写死为永久标准。
3. 发现检查自行创建一个唯一命名的临时实验测试，确认它不会被收集，结束时只删除自己创建的文件。保留用户已有的 `.artifacts/latency-sim`。
4. 初始 `npm run verify` 顺序执行 `check → test:discovery → test → build`，CI 和本地执行同一入口。测试失败立即非零退出。
5. CI 使用锁文件 `npm ci`、固定 Node 24 版本，覆盖 PR 和 main push。等真实成功记录产生后，将唯一名称的 `verify` job 设为 main 必需检查，并让日常管理员操作也遵守规则。[6]

不增加任意覆盖率门槛，不要求每次运行历史重放。原审查的 evidence 脚本把“预期的红例出现”算成功，不能直接作为产品测试的绿灯。

## 4. 第二层：真实扩展 + 可控网页和响应

### 4.1 推荐形态

在独立、临时的浏览器 profile 中，用锁定版本的 Playwright 与其配套 Chromium 启动 persistent context，加载同一次 `build` 生成的原始 `dist/`。CI 安装与该版本匹配的浏览器及系统依赖。无头模式显式使用 `channel: 'chromium'`，遵循官方扩展测试配置，不假定默认 headless shell 等价。[2]

```text
受控的 YouTube / HBO 页面与字幕资源
        ↓ manifest 正常注入
MAIN 页面脚本 → bridge → 内容脚本
        ↓ 真实 chrome.runtime 消息
MV3 Service Worker → 真实 API 请求路径 → 可控 Provider 响应
        ↓
真实播放器 DOM 中的 Shadow DOM 字幕层
        ↓
行为断言 + 请求记录 + 失败截图/trace
```

浏览器用 Chromium 并不意味着产品改为支持另一个浏览器。这里需要其稳定的扩展自动化能力；本地真实平台验收仍用 `/Applications/Google Chrome.app`。Chrome 137 起普通 branded Chrome 移除了 `--load-extension`，Chromium 和 Chrome for Testing 保留支持，不能直接套用旧的 Chrome 启动教程。[3]

第一版以单 worker 串行执行浏览器用例；用例间新建或严格重置 profile，避免后台缓存、设置和授权状态互相污染。先固定一套桌面视口；需要全屏用户手势的场景用实际点击进入，Linux CI 可用有窗口的 Chromium 配合虚拟显示。

### 4.2 模拟边界要放在哪里

**保留真实的扩展、Chrome API、注入时机、消息和渲染，只控制扩展外部的页面与响应。**

- 在 context 建立路由后，再导航到形如 `https://www.youtube.com/watch?v=e2e-a`、`https://play.hbomax.com/video/watch/e2e-a` 的受控 URL，由路由返回本地 HTML。这样不修改正式 manifest 的匹配范围，也不把 localhost 加进产品权限。
- 页面夹具提供最小播放器结构、短的本地可播放媒体和对应播放器接口。YouTube 提供轨道信息与 JSON3；HBO 提供播放器选择状态、DASH 清单和 WebVTT。引用资源也由路由处理。路由外请求默认失败，避免夹具悄悄退回真实网站。
- 不手动调用 `startContentScript`，不在测试中替换 `chrome.runtime.sendMessage`，不直接给 overlay 填译文，也不从 bridge 直接灌入最终时间轴。让打包后的适配器真的读取资源并走完整链路。
- Provider 按事先写好的输入/ID 返回固定且可区分的译文，支持受控延迟、乱序、400/422、无效结果和请求中止。输出断言来自独立预期，不用被测切分函数现场生成预期。
- 页面夹具对平台结构的模拟只是本地契约，必须保留第三层真实平台检查，否则两个地方共享同一个错误假设仍可能全绿。

### 4.3 先做最小可行性验证，尤其是域名权限

当前扩展对自定义 Provider 使用 `optional_host_permissions`。Playwright `grantPermissions()` 的 Web 权限并不等同于扩展 host 权限；不能靠调用它就宣称已解决本地 Provider 授权。CDP Extensions 域的存在也不代表有 host 授权接口。`chrome.permissions.request()` 需要用户手势，并可能弹浏览器确认。[7]

推荐第一条 smoke 先用 manifest 已授权的测试端点，例如 `https://www.youtube.com/__e2e_provider__/v1`，把来自扩展后台的请求由 context 路由返回固定响应。它只是隔离 profile 中的夹具地址，必须断言请求被拦截；禁止漏到真实 YouTube。此方法**不覆盖自定义域名授权 UI**。

正式投资更多场景前，先实测下面四点：

1. 原封不动的 `dist/` 能加载，MAIN/隔离环境注入按 manifest 生效。
2. 视频页面请求能通过真实 background 得到模拟 Provider 结果。
3. runner 能识别并记录 **扩展 Service Worker 发起** 的 HTTP，而不只是网页 fetch。Playwright 的 Service Worker 请求应在 BrowserContext 层考虑，不能假设 `page.route` 能接住；也不照搬通用网页测试的 `serviceWorkers: 'block'` 配置。[4]
4. 在 DOM 能观察到与夹具唯一预期匹配的原文和译文，并能在切断关键链路后确定性失败。

该路由组合本次仅完成官方能力调查，尚未在此项目验证。如果所锁定版本无法路由扩展后台请求，先解决这一项；可评估隔离 profile 中已完成真实 host 授权的本地 HTTP Provider，或针对该 worker 的 CDP 请求拦截。不得通过替换后台 fetch 或修改测试版 manifest 权限，把未解决的问题隐藏起来。

首次授权、拒绝授权、更换 Provider 域名仍走真实设置页点击，在本地 Chrome 单独验收；自动化能力确认后再纳入独立用例。

### 4.4 首批场景与通过标准

不用把全部 257 个行为测试搬到浏览器，只补浏览器边界最容易遗漏的行为。

| 场景                                 | 必须断言的结果                                                                          | 安排                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| YouTube 与 HBO 各一条完整链路        | manifest 实际注入；读取原文资源；后台真实发请求；恰好一个 overlay；原文和预期译文都显示 | 首批必需                                            |
| Provider 长句切分，响应故意延迟      | 未 ready 时不闪现整条超长原文；ready 后按当前播放位置显示成对的原文和译文               | 首批必需                                            |
| seek / 换视频或换集，旧响应晚到      | 新位置显示新字幕；释放旧响应后旧译文不能覆盖；请求与页面身份对应                        | 首批必需                                            |
| 暂停 / 恢复 / 已完成缓存复用         | 暂停不启动新的翻译工作，已发送的请求可以完成；同一后台生命周期内缓存命中不重复 POST     | 首批必需                                            |
| 字幕语言和轨道切换                   | 取得新源轨道；不下载网站目标语言轨道来冒充模型译文；旧字幕不残留                        | 首批必需                                            |
| 开关、全屏、扩展重载                 | 容器全屏字幕仍在可见区域；关闭/重载旧内容脚本后原生字幕恢复；页面刷新后重新正常接管     | 首批必需                                            |
| 后台被终止后的恢复                   | 确认终止后从页面触发请求仍能翻译；不要求内存缓存跨后台重启保留                          | 框架能力确认后纳入                                  |
| 仅改字号，同时有未完成 Provider 请求 | 字号变化；原请求不取消；不重新下载原文，也不增加翻译请求                                | 随 A 修复加入；原报告已有红例                       |
| 兼容重试和实际发送预算               | 记录每次 HTTP；重试消耗发送名额且最终能完成                                             | 随 C 修复加入；精确滚动时间窗以 fake-clock 测试为准 |
| 草稿 JSON + 最终 JSON                | DOM 和缓存只显示选定的最终译文                                                          | 随 D 修复加入                                       |

E 的基础设施提交先运行可以诚实通过的基线场景。A/C/D 的已知缺陷各自在修复提交中加入回归门槛；不能用 `skip`、`expected failure` 或放松断言，把已知缺陷包装成完成治理。

对短暂错字幕，记录 DOM 变化及对应 `video.currentTime`，并在关键播放点验证。只在末尾截一张正确图片无法证明中间没有闪错。视觉检查优先使用文字、可见性、边界和层数断言；截图用于审阅和定位，不立即引入跨系统的逐像素门槛。

### 4.5 后台休眠需要独立测试方式

区分三个事件：页面 SPA 导航、Service Worker 停止、整个扩展重载。它们不能共用“reset 后没报错”作为通过标准。

- **确定性恢复测试**：让后台完成一次工作，使用所选 runner 支持的真实 worker 终止能力，再从仍打开的页面触发新需求。Chrome 官方有此类 Puppeteer 测试方法，可作为能力参照。[5] 先验证当前 runner 的控制接口，不把 Playwright 对象接口与 Puppeteer 混用。
- **自然 idle 检查**：关闭 worker Inspector，停止待处理任务和会唤醒后台的测试探测，获取确实发生停止/重启的证据，再验证恢复。等待 40 秒本身不是停止证据；内容脚本消息也可能重置计时。
- 当前 Playwright 官方扩展指南已经描述对 worker idle suspension 的支持，Worker handle 可能跨重启保持同一个对象。因此不能笼统声称“CDP 一连就不休眠”，也不能只靠对象变化或第二次 `serviceworker` 事件判断重启。[2] 能力和观测方式跟随锁定版本验证。
- 增加一个慢响应诊断：模拟 Provider 首响应在 35–45 秒后到达，比较 Inspector 打开与关闭时的实际行为。Chrome 生命周期文档列出了 fetch 响应等待超过 30 秒的终止条件，而本项目应用层超时为 60 秒；这是应实测的浏览器边界，不能直接推定已发生缺陷，也不在 E 中擅自调整超时。[10]
- 后台队列缓存当前仅在内存，终止后丢失属于现有产品语义。此次 E 治理不引入缓存持久化，也不为了通过测试添加保活轮询。

第一期把自然 idle 留给单独的生命周期验收；能力稳定后再加入定期自动检查。不要用它拖慢每个短场景。

## 5. 第三层：本地 Chrome 真实 YouTube/HBO 验收

真实平台检验夹具无法保证的事实：站点 DOM/播放器内部结构、字幕下载上下文、登录后的实际播放、画面叠层和全屏。HBO 的账户、地区及受保护播放条件也决定了它不适合作为所有 PR 必须在线成功的普通 CI 依赖；字幕夹具没有覆盖真实 HBO 播放条件。

**真实平台验收优先连接用户正在使用、已有站点登录会话的 Chrome profile；可控 CI 测试继续使用独立临时 Chromium profile。** 两者的登录准备不同：CI 的页面和响应全部由夹具提供，不需要账号；全新的 profile 若访问要求登录的真实站点，需要用户先完成登录。若改用固定测试 profile，可在首次登录后复用其会话，直到网站要求重新验证。YouTube 部分公开视频可以匿名访问，但实际用户的登录环境仍应纳入验收；HBO 点播需要可用账号及对应内容访问条件。

本次后续检查已通过 Chrome DevTools 工具列出用户原本打开的标签页，并确认当前浏览器中 `Subline · 双语字幕` v0.1.0 已启用。这证明现有 Chrome 连接可用；尚未核对 YouTube/HBO 会话是否有效、已安装扩展的加载目录是否对应目标构建，也未执行真实播放验收。无需为了开始现场检查先要求用户在另一个 Chromium 中登录。

连接现有 Chrome 与用旧命令行方式启动调试浏览器要分开描述。Chrome 136 对 `--remote-debugging-port` / `--remote-debugging-pipe` 的非默认用户数据目录要求仍然存在。[8] 但 Chrome DevTools MCP 官方另提供 Chrome 144+ 的现有浏览器连接方式：`chrome://inspect/#remote-debugging` 配合 `--autoConnect` 与浏览器授权；它可以沿用所选 profile 的窗口及登录状态。[11] 因此不能把旧 flags 的限制概括成“个人 profile 无法连接”。当前连接已经可用，不需要重配。

正式验收前确认已加载扩展对应指定构建；使用任务相关标签页进行检查。干净权限、缓存隔离、故障注入等需要重置环境的测试继续放在独立测试 profile，现场验收的环境差异则如实记录。

建议固定以下实际路径：

| 平台    | 最小真实验收内容                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| YouTube | 人工字幕与自动字幕各一个可用视频；配置的源语言；网站自动翻译打开时仍读取原文；seek；SPA 切视频；播放器容器全屏；关闭扩展恢复原字幕 |
| HBO     | 登录后的可播放内容；真实 DASH/WebVTT 读取；字幕关闭/轨道切换；seek；换集；容器全屏；关闭扩展恢复原字幕                             |
| 共用    | 语言或设置更新传到视频页；Provider 出错能恢复；扩展重载使旧脚本清理；后台停止后的恢复单独检查                                      |

真实网站验收可先连已授权的本地模拟 Provider，隔离“适配器失效”和“模型服务不稳定”。需要核对真实 Provider 时另做少量固定样本，记录模型、响应外形和人工译文判断；不用模型输出逐字相等做稳定门槛。

触发规则：

- 改 YouTube/HBO 适配器时，验收对应平台。
- 改 core、bridge、overlay、content、后台消息或 manifest/build 注入配置时，验收两平台相关路径。
- 单纯与平台无关的解析或配置内部修改，由自动化覆盖相应约束；发布候选版本再执行两平台完整清单。

记录日期、实际 Chrome 版本、构建身份、站点域名、所用视频/剧集标识、源轨道、执行项及结果。缺少 HBO 登录条件时标记 `blocked` 和原因；没有执行标记 `not-run`，不能写成通过。

这层第一期是明确的维护者验收流程，不伪装成自动防绕过。CI 门槛稳定后，若需要对相关 PR 强制要求现场证据，再增加检查报告结构/构建身份的机制和维护者确认；检查报告存在仍不能证明浏览器动作真的发生过。

## 6. 让验证结果可审查，而不是“Agent 说通过”

浏览器 smoke 稳定后，完整入口扩为：

```text
npm run verify
  check → test:discovery → test → build → test:e2e
```

`test:e2e` 消费上一步的构建产物。CI 输出构建文件摘要、实际 checkout SHA、浏览器/Node/runner 版本、场景列表、结果及耗时。PR 的 head SHA 和 Actions 测试合并 SHA 可能不同，按实际执行身份记录；不拿旧 commit 的绿灯替代当前版本。[9]

最小证据包含：

- 正常运行：命令、执行身份、场景 pass/fail、源下载和实际 Provider 请求的结构化计数。
- 失败运行：断言内容、播放器与字幕状态、截图、trace，以及页面和 worker 的相关异常。页面广告等无关站点错误和扩展错误分开归因。
- 真实平台：同一构建的验收记录、关键截图或短录屏，以及未验证项。

不默认导出真实登录会话的完整 HAR 或带凭据的响应。CI 仅用假密钥和合成字幕；真实诊断记录不包含 Authorization、Cookie、签名查询参数和账号信息。trace 是否覆盖 worker 请求需实测，独立请求记录是必要补充。

必需检查需避免以下“没跑也绿”的缺口：[6][9]

1. 第一版单个 `verify` job 始终触发，不按路径跳过，不配置 `continue-on-error`，不让 shell 吞掉测试退出码。
2. 若以后拆成多个 jobs，最终必需 job 使用 `always()` 并显式确认每个必需依赖为 `success`；依赖被跳过不能算通过。
3. 不靠自动重试抹掉第一次失败。确定性 CI 场景默认不重试；额外复跑是诊断证据。
4. 必需检查绑定清楚的来源与唯一 job 名称；工作流生效并产生成功记录后再启用保护，避免等待一个永远不会产生的状态。
5. 上线时做一次可逆验证：在临时分支制造一个明确断言失败，确认 `verify` 变红且 main 合并被阻止，然后撤回故障。这比只看 YAML 更能证明 E 已落地。

测试本身也要能抓住故障：在临时构建中移除一个 content script 入口、阻断 bridge 或让译文发布成为空操作，相关浏览器用例必须因预期行为不出现而失败；不是靠启动器坏掉通过“红灯证明”。只做少量定向校验，不引入全仓 mutation 平台。

## 7. 实施顺序与完成定义

| 顺序         | 交付                                            | 完成标准                                                                        |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| 1            | 稳定测试发现、统一 verify、CI 与必需检查        | 临时 test 不被误收集；正式文件无遗漏/重复；干净环境通过；明确的失败能阻止合并   |
| 2            | 最小 MV3 浏览器 harness，YouTube/HBO 各一条链路 | 加载未改权限的真实 dist；真实消息与后台 HTTP 连通；预期字幕显示；断开链路会失败 |
| 3            | 首批浏览器回归及诊断产物，纳入 verify           | 表中首批场景执行稳定；失败有原因和证据；无真实账户/付费 Provider 依赖           |
| 4            | 本地 Chrome 验收清单与生命周期检查              | 两平台现场记录；调试与休眠验证区分；结果关联同一构建；blocked/not-run 如实记录  |
| 后续 A/C/D/B | 相应缺陷回归用例加入已建立的入口                | 先证明同一行为断言能复现，再随修复变绿；不以 E 方案替代业务修复                 |

预计主要新增位置为 `scripts/check-test-discovery.mjs`、`playwright.config.ts`、`e2e/`、`.github/workflows/verify.yml` 和简短验收说明。浏览器用例放 `e2e/`，与现有 `tests/` 的 Vitest 发现范围分离；不搬迁已有测试，不增加生产 debug 消息或 `debugger` 权限。具体文件组织服从最小 smoke 的实际结果。

**E 的完成定义是：同一套正式检查能在干净环境重现；扩展链路确实经过浏览器验证；失败真实阻止合并；实际执行过什么、没有执行什么均可查证。** 安装 DevTools 工具、增加测试文件、录一段成功视频，分别只完成其中一部分。

## 资料来源

以下官方资料于 2026-10-04 核对；浏览器工具版本相关能力应以落地时锁定版本复核。

1. [Chrome：Debug extensions](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug) — Service Worker Inspector 的保活影响与扩展调试入口。
2. [Playwright：Chrome extensions](https://playwright.dev/docs/chrome-extensions) — persistent context、Chromium、后台访问及 worker 生命周期支持。
3. [Chrome Extensions 官方公告：Removing --load-extension in Chrome 137](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY) — 普通 Chrome 与 Chromium/Chrome for Testing 的差异。
4. [Playwright：Service Workers](https://playwright.dev/docs/service-workers) — worker 请求、BrowserContext 级网络事件与路由。
5. [Chrome：Test service worker termination with Puppeteer](https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer) — 真实终止后验证行为恢复。
6. [GitHub：About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) — 必需检查、来源、管理员绕过和 skipped/neutral 语义。
7. [Chrome：permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions) — 扩展运行时授权及用户手势要求；参见资料笔记中 Playwright/CDP 权限边界。
8. [Chrome：Changes to remote debugging switches](https://developer.chrome.com/blog/remote-debugging-port) — Chrome 136 起非默认用户数据目录要求。
9. [GitHub：Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks) — 当前 SHA、检查跳过与依赖失败的实际行为。
10. [Chrome：The extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — 后台终止条件、事件活动与运行时版本差异。
11. [Chrome DevTools MCP：Advanced Usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md) — 连接正在运行的 Chrome、Chrome 144+ 自动连接与所选 profile 范围。
