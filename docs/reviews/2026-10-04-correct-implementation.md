# A–D 治理实施与验证

范围：2026-10-04 审查方案中的 A、B、C、D；基线 `774dd06`。E 类测试发现、CI 和分支保护未纳入本次修改。原审查方案和历史重放附件保持原样。

## 实施结果

| 类别 | 实现                                                                                                                                                         | 正式回归证据                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | shared 分类设置变化；样式原地更新；后台发送随机的翻译配置版本；按消费者批量释放任务；源缓存状态和 revision 只读                                              | `background.test.ts` 覆盖 12 类设置变化、共享平台任务、凭据不下发；`controller.test.ts` 检查保留字幕层、进行中结果及迟到缓存；保留 source-cache、seek、pause、pagehide 场景       |
| B    | 全链路只读 `PrefetchItem[]`；去重保留输入到结果的显式索引；普通/切分显示状态使用联合类型；区分 input/display；校验后才能形成 TranslationPart，跨消息再次校验 | `caption-types.test.ts` 通过 TS 编译器检查 13 种非法状态；保留整句迁段、>10 个输入、HBO 重叠、DOM-only、异步切分和缓存测试；新增 Provider 输出 12 条而 segment 仍按 10 个输入计数 |
| C    | 每个执行上下文唯一 transport 在实际 fetch 处计数；滚动 1000ms 最多 3 次 POST；每次 HTTP 的 60 秒从发送开始；GET 模型列表不计数                               | `provider-transport.test.ts` 覆盖 400/422 探测与单次纠正重试组合、共享、取消、连接测试、超时起点、配置重置、可见字幕优先级及未发送窗口替换                                        |
| D    | 完整响应只选定一份候选集；解析失败才恢复截断的完整项；ID 对齐与逐项校验后发布；冲突 ID 全部拒绝，部分列表不猜 ID 基数                                        | `provider-responses.test.ts` 覆盖草稿/最终双 JSON、重复/非法/缺失 ID、乱序一基 ID、截断恢复和取消；保留 GLM、thinking、fence、content 数组、混合切分及部分成功用例                |

ESLint 约束所有 shared Provider fetch 经过 transport，queue 不得导入自由文本 translate；平台依赖检查覆盖静态、动态、类型导入、重导出、require 和任意新平台目录。正反例位于 `dependency-boundaries.test.ts`。

## 已执行验证

```sh
npm run check
npm test -- tests
npm run build
npm run format:check
git diff --check
```

正式测试：25 个文件，316 个测试通过。构建产出 `dist/` Chrome 扩展。显式使用 `tests` 过滤器，因为工作区已有 `.artifacts/latency-sim/sim.test.ts`，测试发现治理属于本次未包含的 E 类。

修复前后使用相同行为断言：

- A：原实现的字体、颜色、背景、间距及其他平台关闭场景错误中止请求，修复后保留原 AbortSignal 和返回内容；字幕层身份及请求次数保持不变。
- C：将当前 400/422 预算测试复制到由 `git archive 774dd06` 创建的临时目录重放，两个用例均因首个窗口实际 POST 为 12 而失败（期望 3）。修复后共 15 次探测/纠正请求分散到预算窗口，三项任务全部完成。
- D：修复前双 JSON 返回草稿；修复后返回值和唯一一次发布均为最终译文。重复 ID、歧义 ID、非法单条 ID 也先复现失败再修复。

## 浏览器验证与限制

使用 macOS 本地 `/Applications/Google Chrome.app`，Chrome `154.0.8037.93`，headless 模式。测试页面运行真实 Controller、Queue、YouTube/HBO 平台适配器与 Overlay，Provider 和源字幕使用本地 fixture，没有外部翻译请求或计费。

两个平台各通过 7 项断言：切分未完成时隐藏原句、样式变化保留字幕层和请求、原译文同步出现、seek 按新时间读取已有切分缓存、pause 保持译文、启用时隐藏原生字幕、关闭后恢复原生字幕。检查了渲染截图。当地工作区复核产物位于 `.artifacts/governance-review/`，不纳入版本控制。

T3 collaborative preview 返回 `available:false`；Chrome UI 控制工具返回 `Codex auth token is unavailable`。因此未完成真实登录态 YouTube/HBO 播放器与真实全屏验收，也没有调用真实 Provider。上述浏览器 fixture 验证不代表真实站点验收。
