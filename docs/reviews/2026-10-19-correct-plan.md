# Agent 重复陷阱审查与治理方案（第二轮）

审查基线：`619ea13`（2026-10-19）。上一轮：[2026-10-04-correct-plan.md](2026-10-04-correct-plan.md)，基线 `774dd06`，A 到 E 类已在 `44902dd` 等提交落地。

状态：待审查方案，已按开发者 2026-10-19 的四条决定修订（见第 6 节）。业务代码未改动；所有原型都在临时 worktree 中运行，已删除。原始证据、原型脚本和补丁在 `.artifacts/correct-2026-10-19/`（gitignore，本仓库公开，会话原文不入库）。

结论：上一轮修好的两类（限流旁路、响应多路径解析）在 6 天和 8 天后各回归了一次，其中限流回归至今仍在 HEAD。这说明“修好一次 + 写进 AGENTS.md”不够，需要让同一个错误在下一次出现时直接失败。本轮最常见的陷阱是不经测量调参数（13 次）和测量工具本身出错（11 次），两者合计 24 次，比其余各类加起来还多。

## 1. 证据范围

| 来源 | 数量 | 其中纠正/返工 |
| --- | --- | --- |
| `774dd06..HEAD` 非合并提交 | 104 | 约 50 个 fix/refactor 逐个追溯到引入提交，11 条 fix-of-fix 链 |
| PR #1 到 #52 | 47 | 0 条 review 评论，纠正都发生在会话里 |
| T3 Code 会话（含 3 个已删除） | 11 个线程，38 条用户消息 | 14 条纠正 |
| 本地 Codex / Claude Code 会话 | 5 个文件，17 条用户消息（其中 2 个属于其他仓库） | 6 条纠正 |
| CI | 128 次运行 | main 45/45 通过；PR 4 次失败，均未进 main |
| AGENTS.md 规则表 | 14 行 | 逐行注入违规探针验证 |

10-04 到 10-12 之间没有本地会话记录，那段时间只有提交历史可查。次数是观察到的下限。

## 2. 陷阱分类（至少 2 次独立出现）

| # | 类别 | 次数 | 代表证据 | 现状 |
| --- | --- | --- | --- | --- |
| C1 | 限流回归 | 2 | `44902dd` 修好，`2de51a8`（提交信息只谈 open/seek 预取）让已发送后被中止的 POST 归还名额 | HEAD 仍在。探针：121 ms 内发出 6 个 POST，上限是每 1000 ms 3 个 |
| C2 | 不测量就调参 + 测量工具出错 | 13 + 11 | batch 10→5→4，预取形态 39.6 h 内改 5 次，前 5 次没有前后对比；`reasoning_effort` low→none→low；长句机制 5 天换 6 种；`61030c9` 发现 trace 只统计了 18% 到 98% 的播放时间，PR #30 结论反转 | chrome-debug 的 Python 测试不在 verify 里 |
| C3 | 类型化结果被压成字符串再靠字符串比较还原 | 8 + 8 | `background.ts:99` 只回传 `error.message`；`translator.ts:203-204` 用 `message === repeatedSourceMessage` 判状态。显示状态链 `2f2b63c`、`f60e132`、`15833aa`、`b31c518`；响应解析链 `21be06b` 到 `70d0d6a` 共 8 个提交 | `b31c518` 在 `836d8d2` 收拢之后又引入一次 |
| C4 | 只改了一处，漏掉兄弟位置 | 会话 4 + 提交 5 | 弹窗改了“原文/译文”，设置页没改；`1601dea` 加的说明文字 2.8 h 后被 `229864b` 删除；设置页有一份自己的开关样式（`0b80e84` 删掉）；echo 修复只覆盖 `text` 没覆盖 `translation` | `src/ui` 仍有 6 个中文文案在多个文件里各写一份；`styles.css` 1729 行只有 5 个 CSS 变量 |
| C5 | 加了没被要求的兜底、上限、重试 | 提交 6 + 会话 3 | 一字符译文的客户端防护和重试被要求整体撤销；用户说过“不缓存”后仍推荐缓存；UI 提交 `229864b` 顺手加了 `maxWorkers: 1` 和更长的超时 | AGENTS.md 已有该规则，只靠判断 |
| C6 | 没跑完整检查就开 PR | 6 | PR #52 只跑了单测，CI 的 tsc 失败（`70d0d6a`），用户报告了两次；`c06c539` 为过 CI 放宽断言 | 本机完整 verify 968 到 1218 s 且计时类测试不稳定，CI 390 s 通过 |
| C7 | 测试和实现耦合 | 6 | 每次调参要改 6 到 9 个测试文件；`tests/playback-budget.test.ts` 存活 15.5 h；`0dee952` 发现期望值由被测规划器生成 | `0dee952` 已清理一轮；test-audit skill 不在仓库内 |
| C8 | 文档漂移与指令反复 | 6 + 5 对 | 术语表复制常量值（`6390f5a` 修过）；README 仍复制数值；AGENTS.md 引用从未存在的 “Writing the reply”（`a29e03d`）；规则加了又在 2 分钟、13 分钟内删掉 | 引用仍悬空 |
| C9 | 已有规则的执行漏洞 | 探针 | transport lint 只覆盖 `src/shared`，在 `background.ts` 直接 `fetch` 能通过；`queue.ts` 的 `translate` 禁令可用 `'../shared/api.ts'` 绕过；API Key 加密只守在 `saveSettings`；`SubtitleOverlay` 有公开的 `player/mounted/connected` | 8 个探针全部通过检查（即全部漏网） |

## 3. 方案

排序依据：出现次数乘以复发代价，HEAD 上的现存缺陷排第一。每类一个提交，每个提交都跑同一个 `npm run verify`。“回放结果”一列是原型在真实历史提交上的实测。

| 顺序 | 类别 | 机制与层级 | 回放结果 |
| --- | --- | --- | --- |
| 1 | C1 | 架构 + 行为测试：已发送的 POST 只能随时间过期，删除中止监听 | 新测试在 HEAD 和 `2de51a8` 上失败（6 个 POST），在 `2de51a8^` 和修复后通过（3 个）；单测 383/383、e2e 53/53 通过 |
| 2 | 开发者决定 | 行为：seek 不再中止已发出的 Provider 请求，结果照常进缓存；这些请求不再计入并发上限和速率限制 | 实现时补测试：seek 前已发出的请求完成并写入缓存，trace 中没有 `aborted` |
| 3 | C6 | 测试配置：vitest 增加 `types` 项目，任何一次测试运行都对所跑文件做类型检查；修复本机不稳定的计时测试 | `b31c518` 上单文件运行即报出 CI 的 TS2345；`70d0d6a` 通过 |
| 4 | C3 | 类型：worker 回复携带 `failure` 联合类型，没有 `error` 字符串；overlay 返回只写句柄 | 历史上添加字符串比较的 4 个提交全部命中，104 个提交中误报 0 |
| 5 | C2 | 架构 + lint：调参值只在 `tuning.ts`；chrome-debug 纯函数测试进 verify。不要求测量记录 | HEAD 上 17 处调参常量在表外，需迁入 |
| 6 | C4 | 架构 + 检查：弹窗和设置页共用 `src/ui/controls.tsx` 的控件和 `copy` 表；同一中文文案出现在两个 `src/ui` 文件即失败 | 命中开发者纠正的那一轮 T3 检查点 `3d34f75`；提交级误报 1（`1601dea`） |
| 7 | C9 | 架构 + lint：用 `checkConnection` 取代 `translate`，删掉 queue 的导入禁令；唯一存储写入口拒绝明文 Key；transport lint 扩到 `src/extension` 和 XHR/WebSocket；边界检查覆盖 `src/ui` | 8 个漏网探针修复后全部失败，对照组通过 |
| 8 | C8 | CI 检查：AGENTS.md 内部引用必须存在；术语表和 README 不得复制常量值 | 命中 `a29e03d` 和 5 个复制数值的提交，40 个相关提交误报 0 |
| 9 | C5 | CI 检查：新增调参项、响应兼容项、失败类型或测试运行参数时，提交必须带 `Requested-by:` | 历史上无法回放；被撤销的一字符防护需要新增失败类型，会被拦下 |
| 10 | C7 | 测试（可选）：额外一轮把所有调参值改掉再跑，只允许每个值的归属测试失败 | `63bf1d5` 之前失败 14 个测试/7 个文件，其中 6 个正是 `63bf1d5` 后来手改的；HEAD 有 23 个基线条目 |

### 3.1 C1：已发送的请求不归还名额

```ts
const sentAt: number[] = [];

export function providerFetch(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  signal?: AbortSignal,
  policy?: ProviderSendPolicy,
): Promise<{ response: Response; signal: AbortSignal }>;
```

`start()` 里 `sentAt.push(Date.now())` 之后不再监听 abort。排队中（尚未发送）的取消保持现有行为。新测试：发出 3 个、排队 3 个，中止前 3 个，断言在 `providerSendWindowMs` 内总发送数等于 `translationSendsPerSecond`，推进时间后后 3 个全部完成。

受影响的旧测试只有一个：`tests/prefetch.test.ts` 的 seek 用例原来断言 400 ms 内发出 4 个请求，这个断言记录的就是本缺陷。

为什么不再往上一层：Grok 方案把记录拆到独立模块并用 lint 禁止 `splice`。回归是在 `transport.ts` 内部写进去的，模块私有挡不住文件作者本人；能挡住的是行为测试。拆模块加 lint 增加了面积，没有增加保护。

代价：seek 刚中止了已发出的请求时，落点请求最多多等 1 s。这 1 s 就是“每秒 3 个”的含义；refund 让 Provider 实际收到的请求超过了上限。

### 3.1a seek 不中止已发出的请求（开发者决定）

现在 `TranslationQueue.hold()`（seek 时调用）执行 `prune(true)`，把不再需要的已发送请求一并中止。改为 seek 时只丢弃尚未发送的工作，已发送的请求继续完成，译文照常写入缓存。关闭标签页、关闭平台等 `release()` 场景保持中止。

按开发者决定，seek 发生时已经发出的请求从这一刻起既不计入 `maxInFlightRequests`，也不计入每秒 3 个的限流，落点请求可以立即发出。后果：seek 前后 1 s 内，Provider 最多可能收到 3 + 3 = 6 个请求；正在进行的旧请求数量不设上限（连续 seek 时会累积）。C1 的“中止也不归还名额”仍适用于 seek 以外的情况（关闭标签页、关闭平台、超时）。

### 3.2 C6：测试命令本身做类型检查

vitest 增加一个只做类型检查的 `types` 项目，`include` 与现有项目相同；`scripts/check-test-discovery.mjs` 改 7 行，让它不把同一文件算作两次收集。代价：单文件运行 +9 s，全量单测 +22 s（161 s 对 139 s）。Vitest 把 typecheck 标为实验特性。

本机 verify 不稳定的原因之一已原型验证：`tests/captions.test.ts:335` 用假时钟推进 4 次 30 s，控制器每 150 ms 轮询一次，jsdom 要跑约 800 次 DOM 更新，本机单测耗时 13.4 s，超时 15 s。把每段推进改为 16 s（刚过代码里最长的 15 s 定时器）后三次运行 6.7 s、7.3 s、7.5 s；把 `controller.ts` 里暂停时的 `cacheOnly` 判断改坏后该测试仍然失败。补丁：`.artifacts/correct-2026-10-19/c6-captions-test.patch`。

不采用 pre-push hook：hook 不随仓库分发，`--no-verify` 可跳过；PR #52 的失败类型已被 `types` 项目覆盖。

`e2e/playback.spec.ts:180` 按真实视频时间等待，时限 100 s 中 60 s 是必须等完的播放。CI 上耗时 1.1 分钟；本机通过时 1.6 分钟，失败时超时那一刻视频在 60.74 s 且正常播放，时间耗在 Chromium 启动、录屏和 tracing 上。按开发者决定保持真实时间和现有时限；本机超时时在备注中写明。

### 3.3 C3：失败原因是类型，不是文案

```ts
export type TranslateFailure =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'copied-source' }
  | { readonly kind: 'error'; readonly message: string };

export type Reply<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly failure: TranslateFailure };

export function failureText(failure: TranslateFailure): string;
export function lineFor(failure: TranslateFailure): TranslationLine;

export interface OverlayHandle {
  update(view: CaptionView): void;
  updateStyle(settings: Settings): void;
  destroy(): void;
}
export function attachOverlay(player: HTMLElement, settings: Settings): OverlayHandle;
```

`background.ts` 回传 `Reply`，`translator.ts` 对 `failure.kind` 做穷尽 `switch`，`message === …` 无从下笔，因为 `timeout` 和 `copied-source` 没有 `message` 字段。`failureText` 是唯一把失败变成句子的函数。overlay 只暴露句柄，“overlay 只渲染”从文字规则变成类型。另加一条 lint，禁止把 `textContent`/`classList` 读回来当状态（`f60e132`、`15833aa` 的写法）。

响应解析保留现有全部兼容项，集中成一张表：

```ts
export type ReplyDeviation =
  | 'fenced-or-thinking-wrapper' | 'last-of-several-payloads' | 'json-inside-a-string'
  | 'one-based-ids' | 'string-ids' | 'truncated-results' | 'reasoning-channel';
export const REPLY_DEVIATIONS: readonly ReplyDeviation[];
```

AGENTS.md 第一条规则改为：“Provider 回复按 `{"results":[{"id","translation"}]}` 读取，只接受 `REPLY_DEVIATIONS` 列出的偏差。”现在的规则文字说 “goes to the id it names”，代码却把 1 基 id 映射到 0 基，测试也锁定了这个行为，规则和代码互相矛盾，照规则改代码会打破 14 个以上的测试。

### 3.4 C2：调参值只有一个家

```ts
export const tuning = {
  translationBatchLimit: 4,
  planBufferSeconds: 30,
  packSpanSeconds: 10,
  captionDisplayLimit: 90,
  loadingDelayMs: 300,
  reasoningEffort: 'low',
} as const;
```

（完整 20 项见 `sketch-opus/sketch/src/shared/tuning.ts`。）

- lint `local/tuning-home`：`tuning.ts` 之外出现命名的调参常量即报错，报错指向 `src/shared/tuning.ts`。HEAD 上目前有 17 处要迁入。
- chrome-debug 的 4 个纯函数测试模块（68 个测试，0.27 s）加入 verify。回放显示，`00834c8`、`4ce2031`、`61030c9` 这类测量工具改动当时没有测试；测试进 verify 后，测量工具的回归不会再静默合并。需要 DevTools 端口的 `test_browser.py`、`test_known_issues.py` 不进 CI。
- 按开发者决定，不要求调参附带实机测量记录；只有开发者明确要求时才附带。原方案的 `check-tuning`、基线记录和豁免机制全部删除。代价：回放中 13 次未测量调参本可拦下 9 次，现在仍靠判断。

### 3.5 C4：一个控件，一份文案

```ts
export const copy = {
  subtitles: '双语字幕', enableSubtitles: '启用双语字幕',
  source: '原文', target: '译文', swapLanguages: '互换原文和译文语言',
  saveFailed: '保存失败，请重试。', subtitlePreview: '字幕预览',
} as const;
export function SubtitleSwitch(props: SubtitleSwitchProps): ReactElement;
export function LanguagePair(props: LanguagePairProps): ReactElement;
```

`Popup.tsx` 和 `App.tsx` 都从 `controls.tsx` 取这两个控件和文案。检查规则：同一个中文字符串出现在两个及以上 `src/ui` 文件中即失败，报错指向 `copy`。同一提交消除 HEAD 上的 6 处重复。

视觉口味（不要说明文字、用图标、次要操作用下划线文字）无法机械检查，在规则表里记为判断项。

### 3.6 C9：补齐已有规则

- `checkConnection(settings)` 取代自由文本 `translate`，queue 没有可误用的函数，`no-restricted-imports` 禁令随之删除。
- `writeStored(key, value)` 是唯一的 `chrome.storage` 写入口，类型要求 `apiKey` 是密文结构，运行时 `refusePlaintextKey` 再拦一次。lint 只允许 `storage.ts` 出现 `chrome.storage`。
- `local/provider-transport` 覆盖 `src/extension`、设置页，并拦 `XMLHttpRequest`、`WebSocket`、`sendBeacon`、计算属性名。
- `local/dependency-boundaries` 覆盖 `src/ui`、`src/main.tsx`，并且不再依赖 ESLint 的运行目录。

### 3.7 C8：文档引用和复制值

`scripts/check-docs.mjs`：AGENTS.md 中引用的章节名必须存在；术语表和 README 出现与 `tuning`/limits 常量相等的数字时失败。同一提交删掉 “Write it per Writing the reply”。

### 3.8 C5：新增策略要写明谁要求的

`scripts/check-policy.mjs` 只看几张封闭表的新增：`tuning` 的键、`REPLY_DEVIATIONS`、`TranslateFailure` 的 `kind`、vitest 的 `testTimeout`/`maxWorkers`/`hookTimeout`。有新增而提交信息没有 `Requested-by:` 时失败。CI checkout 改为 `fetch-depth: 0`。

曾试过以“新增数字字面量”为信号的代理检查，104 个提交中命中 11 个，一半是噪声，已放弃。

这条检查靠诚信：agent 可以伪造 trailer。它的作用是把新策略摆到开发者会读的提交信息里，并让如实填写的 agent 停下来提议，而不是直接加。

### 3.9 C7（可选，放最后）

额外跑一轮把每个调参值都改掉的单测，只允许该值的归属测试失败，其余失败记入 `tests/tuning-coupling.baseline.json`（HEAD 23 条），只减不增。代价：CI 约 +42 s，本机约 +140 s。0dee952 已清理过一轮，所以排在最后，可以不做。

## 4. 合成决定

两个独立候选：Opus 5.5 xhigh（`sketch-opus/`）和 Grok 4.7 xhigh（`sketch-grok/`），在相同的证据包上分别设计和做原型。

以 Opus 方案为基础：它的每个检查都在历史上回放过，覆盖面更全，C4 的检查命中了 T3 检查点里开发者真正纠正过的那一轮。

从 Grok 方案采纳：overlay 返回句柄（类型）代替 Opus 的只写 lint；用调整假时钟推进来修计时测试，不调高超时。

拒绝：

- Grok 删除 1 基 id、字符串 id、截断 JSON、`reasoning_content` 兼容：这些来自真实 Provider（`7a41406` 的 GLM 夹具），手上没有新的 Provider 回复样本，删除可能直接打断现有用户。
- Grok 的独立 `send-budget.ts` 加 `splice` 禁令：见 3.1。
- Opus 的会过期豁免：会让 main 随日期变红。
- Opus 的 pre-push hook：不随仓库分发，可跳过。

两个方案在 C2 上的差异：Grok 比较数字字面量集合（命中 10/13，误报 1/104），Opus 把调参值集中到一张表再比较（命中 9/13，误报 2/104）。采用 Opus 的集中表：回放召回率只差 1 个，但 agent 只需要看一个文件，`tuning-home` lint 让新常量无法放到表外。开发者决定不要求测量记录后，两者用于拦截调参的部分都不再采用，只保留 Opus 的集中表。

## 5. 取舍

- 不要求调参附带测量记录，调参是否需要实测由开发者在请求中说明。
- seek 以外的中止不归还名额（C1），换来 Provider 平时收到的请求不超过每秒 3 个；seek 时放行（3.1a），换来落点不等待、已计费的译文不被丢弃，代价是 seek 前后短时间内可能超过每秒 3 个。
- 每次测试运行多 9 到 22 s 的类型检查，换来 PR #52 那类错误在 agent 自己跑测试时就出现。
- `Requested-by:` 可被伪造，换来新策略在提交信息里可见。
- 保留全部 Provider 兼容项，换来不在没有样本的情况下打断现有 Provider；代价是解析器仍然复杂，但复杂度集中在一张表里。

## 6. 开发者决定（2026-10-19）

1. 调参不要求附带实机记录，只有开发者明确强调时才附带。C2 只保留“调参值集中在 `tuning.ts`”和“chrome-debug 测试进 verify”。
2. 20 个调参值的含义已列给开发者；因第 1 条，不再需要基线记录。
3. `e2e/playback.spec.ts:180` 保持真实时间和现有时限。本机超时时，在提交说明、PR 正文或报告的备注中写明，不改测试。
4. seek 时不中止已发出的请求；seek 时已发出的请求不再计入并发上限和速率限制，见 3.1a。

## 7. AGENTS.md 规则表变更草案

落地对应提交时再写入，不提前写未实现的规则。

| 规则 | 执行机制 |
| --- | --- |
| 已发送的 Provider POST 在 `providerSendWindowMs` 内一直占用名额，中止也不归还 | `tests/provider-transport.test.ts` 中止后计数用例 |
| seek 不中止已发出的请求，结果照常缓存；这些请求不计入并发上限和速率限制 | `tests/queue.test.ts`、`tests/provider-transport.test.ts` seek 用例 |
| 本机 e2e 按真实时间运行；超时时在备注中写明，不改时限 | 判断 |
| Provider 回复只接受 `{"results":[{"id","translation"}]}` 和 `REPLY_DEVIATIONS` 列出的偏差 | `src/shared/provider/reply.ts`；`check-policy` |
| 失败原因以 `TranslateFailure` 跨进程传递，不比较文案 | 类型；lint 禁止读回 DOM 文本/类名 |
| `SubtitleOverlay` 只渲染 | `attachOverlay` 返回 `OverlayHandle`，没有可读状态 |
| 调参值只在 `src/shared/tuning.ts` | `local/tuning-home` |
| 弹窗和设置页共用控件与文案 | `src/ui/controls.tsx`；重复文案检查 |
| 存储只经 `writeStored`，API Key 必须是密文 | 类型；`refusePlaintextKey`；lint |
| 新增调参项、响应偏差、失败类型、测试运行参数需要 `Requested-by:` | `check-policy` |
| 测试运行即类型检查 | vitest `types` 项目 |
| AGENTS.md 引用存在，文档不复制常量值 | `check-docs` |
| 设置页和弹窗不加说明性副文字；用图标代替文字链接 | 判断 |
| 只换机制、不改数值的策略重写要附测量 | 判断 |
| 列出已知缺口后继续做完，不在缺口处停下 | 判断 |

“Caption queues call `translateCaptionBatch`, never `translate`” 在 `checkConnection` 落地后删除，因为这个错误已经无法写出。

## 8. 复核

- 原型输出和补丁：`.artifacts/correct-2026-10-19/sketch-opus/prototypes/`、`sketch-grok/prototypes/`
- C1 探针：`node --experimental-strip-types .artifacts/correct-2026-10-19/cc-probe/run/probe.mts "$PWD/src/shared/provider/transport.ts"`（路径须为绝对路径）
- 分类原始报告：`commit-classes.md`、`enforcement-audit.md`、`t3-corrections.md`、`session-corrections.md`
- 未运行完整 `npm run verify`（本机超时情况按第 6 节第 3 条在此写明）。本机两次运行分别在 968 s 和 1218 s 失败于上述两个计时测试，同一提交在 CI 上 390 s 通过。

## 9. 实施结果（分支 `correct/agent-pitfalls`）

| 提交 | 内容 | 证明 |
| --- | --- | --- |
| `fix(playback): a seek lets requests already sent finish` | seek 只丢弃未发送的工作；已发出的请求完成并写入缓存，不再占用在途和每秒发送名额 | 新测试在旧代码上失败于“请求被中止”；把速率豁免改坏后同一测试失败；播放 e2e 14/14 通过 |
| `fix(provider): an aborted request keeps its rate slot` | 已发送的 POST 在窗口内一直占用名额 | 新测试在旧代码上发出 6 个、修复后 3 个 |
| `fix(captions): a failed caption is not requested again` | 删除 15 秒重试和 15 秒重发预取窗口；队列记住所有失败（原来只记超时） | 改写后的 e2e 在旧构建上失败（旧构建重试后显示了译文），新构建三平台通过 |
| `test: every test run type-checks the files it runs` | vitest `types` 项目；暂停字幕测试从 13.4 s 降到约 7 s | 单文件运行即报出类型错误；改坏暂停判断后测试仍失败 |
| `refactor(captions): failures cross to the page as a kind, not a message` | `TranslateFailure` 跨进程；`local/typed-outcomes` | lint 对 `2f2b63c`、`15833aa`、`b31c518` 的原文件报错 |
| `refactor(captions): the overlay exposes no state` | 只保留 `showsIn(player)`；`local/write-only-overlay` | lint 对 `619ea13` 的 overlay 报出 3 个公开状态 |
| `refactor(core): every tuning value lives in src/shared/tuning.ts` | 23 个调参值集中；`local/tuning-home`；chrome-debug 纯函数测试进 verify | lint 对 `2d1ad2f`、`2de51a8` 新增的常量报错 |
| `refactor(ui): text shown on both the popup and settings comes from one table` | `src/ui/copy.ts`；`scripts/check-ui-copy.mjs` | 对 `619ea13` 和 T3 检查点 `3d34f75` 列出 6 处重复 |
| `fix(lint): close the gaps the rules table claimed were covered` | transport、translate、存储写入、边界规则补洞 | 12 个探针用例在旧配置上失败 |
| `docs(agents): AGENTS.md references must resolve` | `scripts/check-docs.mjs`；删除悬空引用 | 对 `a29e03d`、`3ff5b8d`、`46b7a29` 报错 |
| `ci: a new tuning value, failure kind or test runner setting says who asked for it` | `scripts/check-policy.mjs`；CI 取完整历史 | `774dd06..619ea13` 中 104 个提交标出 7 个 |
| `docs(agents): the rules table names what now enforces each rule` | 规则表与实现对齐 | `check-docs` 通过 |

与第 3 节方案的差异：

- 没有做 `REPLY_DEVIATIONS` 表。容忍的回复形态分散在约 7 个解析函数里，要让表真正起作用需要改写解析代码，否则只是又一份手工同步的清单。改为把 AGENTS.md 规则改成与代码一致，列出 `tests/provider-responses.test.ts` 覆盖的形态。
- 没有做共用的 `SubtitleSwitch`、`LanguagePair` 组件。弹窗即时保存、设置页按按钮保存，两边标记和样式不同，合并会改变页面外观。只做了文案表和重复检查。
- 没有用 `checkConnection` 取代 `translate`。约 20 个 `api.test.ts` 用例以自由文本为测试对象。改为修补 `no-restricted-imports` 的绕过。
- 存储写入用 lint 限定在三个现有文件，没有新建统一的 `writeStored`。
- 没有做 C7（改值重跑测试）和 pre-push hook。
