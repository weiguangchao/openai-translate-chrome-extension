# 七项已复现问题的修复与证据

本次只修复原则审查中的 R1 至 R7。基线为 `4f117ea`。下列影像使用仓库 `e2e/harness.ts` 的 Chromium 打包扩展流程，播放器、Provider 和凭据均为合成夹具。截图来自实际扩展页面和字幕覆盖层，没有修改截图内容。

| 问题                              | 修复及可观察结果                                                                                                 | 修复前                                                                                                                                | 修复后                                                                                                                                       | 主要回归所有者                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| R1 设置页覆盖弹窗已保存的字段     | 页面仅提交自己修改的字段，写入在 Web Lock 内合并最新设置。弹窗关闭字幕后，旧设置页保存字号 32，关闭状态仍保留。  | [重载弹窗](assets/2026-10-24-audit-fixes/r1-reloaded-popup-before.png)                                                                | [重载弹窗](assets/2026-10-24-audit-fixes/r1-reloaded-popup-after.png) · [字号 32](assets/2026-10-24-audit-fixes/r1-reloaded-style-after.png) | `tests/settings-storage.test.ts`   |
| R2 保存完成撤销等待期间的新编辑   | 保存结果更新持久基线，并合并提交之后的草稿修改。本次持久值仍为 Off，草稿保持后来改回的 On，按钮为 Save changes。 | [保存完成](assets/2026-10-24-audit-fixes/r2-completed-save-before.png) · [视频](assets/2026-10-24-audit-fixes/r2-options-before.webm) | [保存完成](assets/2026-10-24-audit-fixes/r2-completed-save-after.png) · [视频](assets/2026-10-24-audit-fixes/r2-options-after.webm)          | `tests/settings-alerts.test.tsx`   |
| R3 HBO 将旧英文文本标成选中的中文 | 原生来源必须匹配选中语言，DOM 读取也遵循同一判断。中文目标显示中文 DOM 字幕，Provider 请求为零。                 | [旧英文](assets/2026-10-24-audit-fixes/r3-hbo-selected-track-before.png)                                                              | [选中的中文](assets/2026-10-24-audit-fixes/r3-hbo-selected-track-after.png)                                                                  | `tests/hbo.test.ts`                |
| R4 解析 thinking 包装破坏合法译文 | 解析时保留 JSON 内的字面标签，截断尾项不再清空已完成的结果。                                                     | [标签丢失](assets/2026-10-24-audit-fixes/r4-literal-tags-before.png)                                                                  | [标签保留](assets/2026-10-24-audit-fixes/r4-literal-tags-after.png)                                                                          | `tests/provider-responses.test.ts` |
| R5 退避丢失 HTTP 失败类型         | 退避保存原始 Error，下一条字幕继续收到 HTTP 500。显示与首次失败一致，两次字幕请求只发一次 POST。                 | [退避中变为普通失败](assets/2026-10-24-audit-fixes/r5-backoff-error-before.png)                                                       | [保留 HTTP 失败显示](assets/2026-10-24-audit-fixes/r5-backoff-error-after.png)                                                               | `tests/queue.test.ts`              |
| R6 Token 读取失败覆盖历史总量     | 累加读取失败时不写入，展示入口保留原有降级。已有 1000/100/20 不被本次 10/2/0 覆盖，翻译仍成功。                  | [历史丢失](assets/2026-10-24-audit-fixes/r6-token-history-before.png)                                                                 | [历史保留](assets/2026-10-24-audit-fixes/r6-token-history-after.png)                                                                         | `tests/token-usage.test.ts`        |
| R7 YouTube 人工重叠对白提前消失   | 人工字幕复用现有重叠保留流程。第 4 秒同时显示 1 至 5 秒和 3 至 7 秒两句，预取包含两句。ASR 规则保留。            | [只剩第二句](assets/2026-10-24-audit-fixes/r7-overlapping-dialogue-before.png)                                                        | [两句同时显示](assets/2026-10-24-audit-fixes/r7-overlapping-dialogue-after.png)                                                              | `tests/youtube-captions.test.ts`   |

R1 还检查跨模块上下文的并发写入、嵌套样式字段和同字段写入顺序。R3 回归同时检查英文及简中目标、原生 timeline 和 activeCues、DOM 缺失，以及语言匹配的正例。R4 覆盖关闭标签、转义引号、fence、thinking 包装和截断恢复，也覆盖 thinking 中未配对的引号、未闭合草稿，以及截断尾项内的字面标签。R6 检查失败不写入，以及后续正常增量累加。

HBO 原生轨道语言冲突且没有 DOM 字幕时，页面暂不显示字幕。Token 读取失败时放弃本次增量，历史总量不变。本次没有增加补偿、重试或缓存。

## 验证

每项均先在基线证明失败，再检查修复后的行为。R1、R2 另录制了完整页面操作视频，其余五项使用同一打包流程录制前后字幕或 Token 页面。

影像结果与构建标识见 [修复前 JSON](assets/2026-10-24-audit-fixes/results-before.json) 和 [修复后 JSON](assets/2026-10-24-audit-fixes/results-after.json)。修复后录制来自代码提交 `733e525`，两套录制流程的构建 SHA-256 一致。本报告保留 15 张必要截图和 R2 的两段操作视频。截图状态均通过浏览器断言，图像文件检查通过。视频均能完整解码，另抽查了保存完成帧。

独立复核在 252 个公开边界内存探针中未发现剩余 P1/P2，TypeScript 诊断为零。`npm run verify` 全部通过，包括 760 项 Vitest、68 项 Python 和 50 项真实时间浏览器用例，类型检查无错误。ESLint、文档与策略检查、测试发现检查和打包构建通过。Prettier 与 `git diff --check` 也通过。

## 原则如何改变选择

- Separate Before Serializing Shared State 使页面提交字段差量。设置必须保持一份配置，因此用 Web Lock 保护读、合并、加密、写入，明文迁移也在锁内重读。
- Foundational Thinking、Model the Domain、Type System Discipline 使字段差量有明确类型，退避截止时间与原始错误配对，轨道文本与其语言保持同一个来源对象。
- Experience First 使保存期间的新编辑继续留在页面，完成后仍显示待保存，无需冻结整页。
- Fix Root Causes、Boundary Discipline 使修复落在设置写入、轨道选择、响应解析、失败保存和统计读取入口，覆盖层继续只渲染结果。
- Laziness Protocol、Subtract Before You Add、Minimize Reader Load 使修复删除整对象覆盖、语言混配和错误文字副本，复用字幕与字符串解析实现，不新增后台写入协议。
- Sequence Work into Verifiable Units、Test Behavior, Not Implementation 使每项先证明基线错误，再断言持久设置、字幕、失败类型或 POST 数量。每项回归保留一个主要所有者，浏览器影像补充真实打包与生命周期证据。
- Guard the Context Window 使批量修复按独占文件分工，另安排只读复核，主线程串行运行测试。
