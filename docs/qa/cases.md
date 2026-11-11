# 用例库

长期积累的人工用例。本轮实测保留原有 `TC-` 编号。确认缺陷使用 `SL-BUG-`，并映射到已有 `TC-`，不把同一症状再写一遍步骤。从历史修复提取的回归使用 `SL-REG-`。

维护规则见 [README.md](README.md)。某一次的完整环境和截图在 [runs/](runs/)。历史回归的状态是「历史来源待实测」或「不适用」。修复已经在 `main` 上，不等于这些条在当前构建上人工通过。

2026-11-11 的运行只执行了下面 12 条 `TC-`。[运行记录](runs/2026-11-11-dba68d08.md) 不覆盖 `SL-REG-`。

## 索引

### 本轮实测（12）

| ID | 状态 | 类型 |
| --- | --- | --- |
| TC-ENV-reload | 通过 | 回归检查 |
| TC-158-X-small | 部分通过 | 功能缺陷 |
| TC-X-fullscreen | blocked | 功能缺陷 |
| TC-159-connection | 通过 | 功能缺陷 |
| TC-159-state-yt-off | 失败 | 功能缺陷 |
| TC-159-state-yt-on | 失败 | 功能缺陷 |
| TC-159-state-x-on | 失败 | 功能缺陷 |
| TC-159-state-reopen | 通过 | 功能缺陷 |
| TC-160-popup | 通过 | 体验改进 |
| TC-160-style | 通过 | 体验改进 |
| TC-YT-playback | 通过 | 回归检查 |
| TC-A11Y-smoke | 通过 | 体验改进 |

### 确认缺陷映射

| ID | 映射 | 本轮状态 |
| --- | --- | --- |
| SL-BUG-001 | TC-159-state-yt-off、TC-159-state-yt-on、TC-159-state-x-on；重开观察是 TC-159-state-reopen | 失败 |

### 历史回归（25）

| ID | 状态 | 来源 |
| --- | --- | --- |
| SL-REG-001 | 历史来源待实测 | [#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R1 |
| SL-REG-002 | 历史来源待实测 | [#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R2 |
| SL-REG-003 | 不适用 | [#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R3；HBO 已由 [#136](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/136) 移除 |
| SL-REG-004 | 历史来源待实测 | [#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R4 |
| SL-REG-005 | 历史来源待实测 | [#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R5 |
| SL-REG-006 | 历史来源待实测 | [#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R6 |
| SL-REG-007 | 历史来源待实测 | [#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R7 |
| SL-REG-008 | 历史来源待实测 | [#7](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/7) |
| SL-REG-009 | 历史来源待实测 | [#15](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/15) |
| SL-REG-010 | 历史来源待实测 | `1462efec` |
| SL-REG-011 | 历史来源待实测 | `d391af8e` |
| SL-REG-012 | 历史来源待实测 | `e24ff787` |
| SL-REG-013 | 历史来源待实测 | `19ee52b9` |
| SL-REG-014 | 历史来源待实测 | [#155](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/155) |
| SL-REG-015 | 历史来源待实测 | [#155](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/155) |
| SL-REG-016 | 历史来源待实测 | [#13](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/13)、`cd21051d` |
| SL-REG-017 | 历史来源待实测 | `b31c5187` |
| SL-REG-018 | 历史来源待实测 | [#140](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/140) |
| SL-REG-019 | 历史来源待实测 | [#141](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/141) |
| SL-REG-020 | 历史来源待实测 | [#147](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/147) |
| SL-REG-021 | 历史来源待实测 | `1c792b36`、`0c11f358` |
| SL-REG-022 | 历史来源待实测 | [#149](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/149) |
| SL-REG-023 | 历史来源待实测 | [#105](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/105) |
| SL-REG-024 | 历史来源待实测 | [#133](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/133) |
| SL-REG-025 | 历史来源待实测 | [#114](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/114)、[#120](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/120) |

## SL-BUG-001 同一 popup 展开期间，状态提示与开关和画面不一致

- 优先级：低 / P3
- 类型：功能缺陷
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，[`dba68d08f7b48178a7ae208f18ff5dba84317df4`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/dba68d08f7b48178a7ae208f18ff5dba84317df4)
- 最近实测结果：失败。即时检查跨 YouTube 与 X 为 3/3。重开 popup 后 3/3 次提示正确，该观察属于 TC-159-state-reopen，不把本条改成通过。见 [2026-11-11 运行](runs/2026-11-11-dba68d08.md)。
- 状态：失败
- 映射：TC-159-state-yt-off、TC-159-state-yt-on、TC-159-state-x-on。不另编号。

**问题**

已经打开的同一个 popup 里切换 Bilingual subtitles 之后，立刻查看时，状态提示与开关、以及当前标签页上的字幕不一致。画面字幕仍随开关变化。过期提示会保持多久，这次没有测量。

**前提**

与所映射的 TC 相同。

**步骤**

1. 按 TC-159-state-yt-off、TC-159-state-yt-on、TC-159-state-x-on 的步骤做即时检查。
2. 按 TC-159-state-reopen 记录重开后的阅读。重开结果不替代前三条的验收。

**验收**

- [ ] 关闭双语后，不必重开 popup，提示与开关、画面一致
- [ ] 开启双语且字幕已显示后，不必重开 popup，提示与画面一致。加载过程允许 Loading / Waiting
- [ ] 仅译文模式下，提示与画面一致，不必重开 popup。2026-11-11 未测
- [ ] 切换标签页后，提示与当前标签页实际状态一致。2026-11-11 未测

**来源**

[#161](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/161)。截图 E1–E5 在运行记录中。修改建议写在该次运行的 BUG-01，尚未证实为根因。

## TC-ENV-reload Reload 后确认产品名、版本和扩展 ID

- 优先级：未标注
- 类型：回归检查
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：通过。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：通过

**问题**

原位重新加载之后，扩展卡片上的产品名、版本和 ID 需要与这次要测的构建一致。

**前提**

Chrome 已加载该次构建的解压目录。已知产品名、版本和扩展 ID。

**步骤**

1. 打开 `chrome://extensions`，找到 Subline。
2. 对该扩展点击重新加载，保持原来的解压路径。
3. 阅读卡片上的名称、版本、ID 和开关。

**验收**

- [ ] 名称、版本、ID 与当次运行记录一致
- [ ] 出现重新加载完成的提示，且该扩展为开启

**本轮结果**

Reload 后出现 Reloaded。卡片为 Subline ·20261111，0.1.2，ID `lanjbmaenpfbpdjjmjdedococodoiboe`，开关为开。Sand Accept-Language 为关。同页另有已关闭的扩展，未参与功能验证。

**证据**

[extensions-reload-confirmation.webp](assets/2026-11-11-dba68d08/extensions-reload-confirmation.webp)

## TC-158-X-small X 小窗可见尺寸下的长句字幕与原生控件

- 优先级：未标注
- 类型：功能缺陷
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：部分通过。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：部分通过
- 关联 issue：[#158](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/158)

**问题**

[#158](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/158) 记录 X 小窗长句字幕遮挡画面。本条只检查当时可见尺寸下，长句是否可读、译文是否挡住原生控制条。

**前提**

公开帖 <https://x.com/theo/status/2107935187825008691> 的小窗可以播放。双语开启。

**步骤**

1. 打开帖内小窗，开启双语字幕。
2. 等到长句英文折行，观察译文与进度、音量、全屏等原生控制条。
3. 打开 popup，记录当时的状态提示。

**验收**

- [ ] 该可见尺寸下长句仍可读
- [ ] 译文不遮住原生控制条
- [ ] 本条不要求更窄尺寸，也不要求证明全部重要图文都不被挡

**本轮结果**

可见尺寸下长句英文折行，译文未遮住原生控制条。没有再缩小播放器，也没有逐项核对全部重要图文。该次 popup 为 Showing bilingual subtitles，与当时画面一致。这一帧不是 SL-BUG-001 的过期提示。不能据此关闭 #158。

**证据**

[x-small-window-controls-original.webp](assets/2026-11-11-dba68d08/x-small-window-controls-original.webp)、[x-popup-status-small-window.webp](assets/2026-11-11-dba68d08/x-popup-status-small-window.webp)、[x-small-window-initial.png](assets/2026-11-11-dba68d08/x-small-window-initial.png)

## TC-X-fullscreen X 全屏字幕

- 优先级：未标注
- 类型：功能缺陷
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：blocked。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：blocked
- 关联 issue：[#158](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/158)

**问题**

需要在 X 全屏里看字幕是否可读、是否挡住控件。这次没有进入全屏。

**前提**

与 TC-158-X-small 同一帖的小窗播放器。

**步骤**

1. 尝试进入全屏。
2. 若进入了全屏，再看字幕和控件。

**验收**

- [ ] 能进入全屏时，记录字幕是否可读、是否挡住控件
- [ ] 进不了全屏时，写明挡住操作的页面条件，且不把登录墙记成产品缺陷

**本轮结果**

页面出现 X 登录 / Continue to X。这次没有登录，没有全屏结果。没有单独的全屏失败截图。登录栏出现在 TC-158 的 X 截图里。

## TC-159-connection 设置页 Test connection 与重开 popup 后的对应状态

- 优先级：未标注
- 类型：功能缺陷
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：通过。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：通过
- 关联 issue：[#159](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/159)

**问题**

设置页会同时涉及保存状态和 Provider 是否测试过。本条只检查一次 Test connection，以及重开 popup 后能否看到与该次测试对应的状态。

**前提**

设置页可以执行 Test connection。操作过程中不修改 provider、base、model、key。

**步骤**

1. 在未改 provider、base、model、key 的前提下执行 Test connection。
2. 记录结果文案。
3. 关闭 popup 后重新打开，查看与这次测试对应的状态。

**验收**

- [ ] 测试给出明确结果，且该次配置未改
- [ ] 重开 popup 后能看到与该次测试对应的状态
- [ ] 该状态与「设置已保存」不是同一句话
- [ ] 同一 popup 内切换字幕开关的提示不并入本条

**本轮结果**

结果文案为 Connection test passed。provider、base、model、key 未改。重开 popup 后能看到对应状态。未留截图。本条通过不关闭 #159。开关提示见 SL-BUG-001。

## TC-159-state-yt-off YouTube：同一 popup 内关闭双语后的提示

- 优先级：低 / P3
- 类型：功能缺陷
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：失败。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：失败
- 映射：SL-BUG-001
- 关联 issue：[#161](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/161)

**问题**

YouTube 上，同一个已打开的 popup 里关闭双语后，提示仍可能说正在显示双语。

**前提**

<https://www.youtube.com/watch?v=qp0HIF3SfI4> 已打开并可显示字幕。popup 在检查完成前不关闭。这次译文语言是简体中文。

**步骤**

1. 在该 popup 内把 Bilingual subtitles 从开切换到关。
2. popup 仍展开时，立刻对照开关、提示和画面字幕。

**验收**

- [ ] 译文消失，原生英文字幕可以保留
- [ ] 开关为关
- [ ] 提示与开关、画面一致，表示字幕已关闭

**本轮结果**

译文已消失，原生英文 CC 为 “I call it the golden circle.”，开关为关，提示仍为 Showing bilingual subtitles。未测量这段提示会保持多久。

**证据**

[bug-01-youtube-off-stale-status.webp](assets/2026-11-11-dba68d08/bug-01-youtube-off-stale-status.webp) 是真实截图。[bug-01-youtube-off-stale-status-annotated.png](assets/2026-11-11-dba68d08/bug-01-youtube-off-stale-status-annotated.png) 是同一帧裁切加红框，画面未改。

## TC-159-state-yt-on YouTube：同一 popup 内再次开启且画面已有字幕

- 优先级：低 / P3
- 类型：功能缺陷
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：失败。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：失败
- 映射：SL-BUG-001
- 关联 issue：[#161](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/161)

**问题**

画面已经出现双语之后，同一个 popup 的提示仍可能停在 Waiting for captions。

**前提**

承接 TC-159-state-yt-off。先关闭并重开 popup，确认重开后的提示与关闭后的画面一致，再在这个新 popup 里继续。检查完成前不关闭它。

**步骤**

1. 在该 popup 内打开 Bilingual subtitles。
2. 待画面已经出现双语后，立刻查看提示。

**验收**

- [ ] 加载过程可以出现 Loading / Waiting
- [ ] 字幕已经显示之后，提示更新为正在显示双语，并与开关一致

**本轮结果**

重开后的提示曾为 Subtitles are off，与关闭后的画面一致。再次开启后，画面已有 “I call it the golden circle.” 和「我称之为“黄金圈”。」，开关为开，提示仍为 Waiting for captions。没有记录从点击到截图的毫秒数。未测仅译文模式。

**证据**

[bug-01-youtube-on-waiting-status.webp](assets/2026-11-11-dba68d08/bug-01-youtube-on-waiting-status.webp)

## TC-159-state-x-on X：同一 popup 内开启且画面已有字幕

- 优先级：低 / P3
- 类型：功能缺陷
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：失败。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：失败
- 映射：SL-BUG-001
- 关联 issue：[#161](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/161)

**问题**

与 TC-159-state-yt-on 相同，发生在 X 的已打开 popup 里。

**前提**

<https://x.com/theo/status/2107935187825008691>。popup 打开后保持不关闭。

**步骤**

1. 在该 popup 内打开 Bilingual subtitles。
2. 待画面已经出现双语后，立刻查看提示。

**验收**

- [ ] 字幕已经显示后，提示与当前标签页一致
- [ ] 该次检查不依靠再次重开 popup

**本轮结果**

画面已有 “usually just touching a few files here and there.” 与「通常只是偶尔碰几个文件。」，开关为开，提示仍为 Waiting for captions。这是跨 YouTube / X 的 3 次即时检查之一。X 上关闭开关后的即时提示，这次没有单独一条用例。

**证据**

[bug-01-x-after-enable-waiting-status.webp](assets/2026-11-11-dba68d08/bug-01-x-after-enable-waiting-status.webp)

## TC-159-state-reopen 关闭并重开 popup 后的提示

- 优先级：低 / P3
- 类型：功能缺陷
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：通过。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：通过
- 映射：SL-BUG-001 的重开观察，不覆盖 SL-BUG-001 的失败
- 关联 issue：[#161](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/161)

**问题**

提示与画面已经不一致之后，新打开的 popup 是否反映当前画面。

**前提**

刚刚在同一 popup 内切换过双语开关，并且已经记下即时提示。

**步骤**

1. 关闭 popup，再重新打开。
2. 对照新 popup 的提示、开关和当前画面。

**验收**

- [ ] 新打开的 popup 反映当前标签页的实际状态
- [ ] 本条只覆盖重开之后的阅读。它不证明提示会自行更新，也不证明必须重开才能恢复

**本轮结果**

重开后 3/3 次提示正确。YouTube 在双语已经显示时重开，提示为 Showing bilingual subtitles，与开关和画面一致。未测静置多久会自行更新。

**证据**

[bug-01-youtube-status-recovered-after-reopen.webp](assets/2026-11-11-dba68d08/bug-01-youtube-status-recovered-after-reopen.webp)

## TC-160-popup 弹窗入口与模型用量折叠

- 优先级：未标注
- 类型：体验改进
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：通过。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：通过
- 关联 issue：[#160](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/160)

**问题**

[#160](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/160) 讨论弹窗首屏的信息架构。本条只检查 Settings 文字、用量折叠和 Subtitle style 入口。信息架构建议不是另一条确认缺陷。

**前提**

popup 可以打开。

**步骤**

1. 查看 Settings 入口是否有文字。
2. 展开 Model and usage，再收起。
3. 从 popup 进入 Subtitle style。

**验收**

- [ ] Settings 有文字或同等清晰的入口
- [ ] 模型与用量可以展开，也可以收起，展开不删除数据
- [ ] Subtitle style 可以打开

**本轮结果**

Settings 带文字。该帧模型为 `mimo-v2.6-flash`，Token usage 约 343.5K（Input 289.7K / Output 53.9K / Cache 40.7K），可以收起。Subtitle style 可以进入。用量是该帧读数，不是性能指标。本条通过不关闭 #160。

**证据**

[popup-model-usage-expanded.webp](assets/2026-11-11-dba68d08/popup-model-usage-expanded.webp)

## TC-160-style 临时样式预览与恢复后的读数

- 优先级：未标注
- 类型：体验改进
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：通过。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：通过
- 关联 issue：[#160](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/160)

**问题**

临时颜色需要出现在预览和实际画面上。恢复默认白色之后，只能记录当时看到的值。

**前提**

能打开 Subtitle style。当次 X 与 YouTube 页面可以显示字幕。

**步骤**

1. 把 Source / Translation 改成一组临时颜色，查看预览。
2. 到 X 与 YouTube 核对该样式。
3. 恢复为默认白色，查看字号、间距、背景和双语 / 仅译文开关。

**验收**

- [ ] 临时预览与实际画面一致
- [ ] 恢复之后界面为白色系，双语仍可使用
- [ ] 没有改色前的截图时，恢复后的值只是当时读数，不是原始状态快照

**本轮结果**

临时颜色为 Source `#A0D5FF`、Translation `#FFE3A3`，字号 24px / 22px，间距 6px，背景 45%，预览与 X、YouTube 一致。随后两侧为 `#FFFFFF`、24px / 22px、间距 6px、背景 45%。仅译文未勾选，双语为开。没有改色前的完整对照。

**证据**

[style-preview-temporary-colors.png](assets/2026-11-11-dba68d08/style-preview-temporary-colors.png)、[x-style-actual-applied.png](assets/2026-11-11-dba68d08/x-style-actual-applied.png)、[style-restored-default.png](assets/2026-11-11-dba68d08/style-restored-default.png)

## TC-YT-playback YouTube 广告跳过、播放控制与开关

- 优先级：未标注
- 类型：回归检查
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：通过。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：通过

**问题**

在一条 YouTube 视频上检查广告跳过、播放控制、倍速、全屏和双语开关是否让字幕消失。本条不代替 SL-REG 里更具体的 seek、倍速误判或全屏层级用例。

**前提**

<https://www.youtube.com/watch?v=qp0HIF3SfI4>。播放器里原文字幕可用。

**步骤**

1. 若出现广告，使用 Skip 一次。
2. 观察 Skip 后约 0:02 是否出现双语。
3. 实际操作播放、暂停、seek、1.25× 再恢复 1×、进入全屏再退出。
4. 退出全屏后看字幕是否还在。
5. 关闭双语，再开启。

**验收**

- [ ] Skip 后出现双语
- [ ] 上述播放控制之后字幕仍在
- [ ] 关闭去掉译文并保留原生英文；再开启后双语恢复

**本轮结果**

广告 Skip 一次。Skip 后约 0:02 出现双语。播放、暂停、seek、1.25× 再恢复 1×、全屏再退出都实际操作过，退出后字幕仍在。关闭后译文消失、原生英文保留，再开启后双语恢复。各步没有精确毫秒。性能未测。

**证据**

[youtube-after-skip-captions.png](assets/2026-11-11-dba68d08/youtube-after-skip-captions.png)、[youtube-fullscreen-subtitles.png](assets/2026-11-11-dba68d08/youtube-fullscreen-subtitles.png)、[youtube-post-skip-popup-state.webp](assets/2026-11-11-dba68d08/youtube-post-skip-popup-state.webp)、[youtube-playing-bilingual-popup.webp](assets/2026-11-11-dba68d08/youtube-playing-bilingual-popup.webp)。最后一张是播放中的对照，不是刚刚在同一 popup 里拨动开关的帧。

## TC-A11Y-smoke Subtitle style 页的键盘焦点冒烟

- 优先级：未标注
- 类型：体验改进
- 发现版本：2026-11-11，manifest 0.1.2，Subline ·20261111，`dba68d08f7b48178a7ae208f18ff5dba84317df4`
- 最近实测结果：通过。[2026-11-11 运行](runs/2026-11-11-dba68d08.md)
- 状态：通过
- 关联 issue：[#160](https://github.com/weiguangchao/openai-translate-chrome-extension/issues/160)

**问题**

只检查两个控件能否用 Tab 到达。这不是无障碍审计。

**前提**

Subtitle style 页已打开。

**步骤**

1. 用 Tab 移动焦点。
2. 确认能否到达 Source font color 文本框和 Font size 滑块。

**验收**

- [ ] Tab 可以到达 Source font color 文本框
- [ ] Tab 可以到达 Font size 滑块
- [ ] 对比度、读屏和其余控件不在本条里

**本轮结果**

两个控件都可以用 Tab 到达。未留截图。

## SL-REG-001 设置页保存覆盖弹窗已经改过的字段

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：修复提交 [`2559e909`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/2559e9093261e7f3c2f9c3e0737ae231a23e9024) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有执行本条。
- 状态：历史来源待实测

**问题**

设置页保存时会把整份设置写回去，弹窗里已经保存的字段被旧页面盖掉。审查记录中的例子是：弹窗关闭字幕之后，旧设置页保存字号 32，关闭状态丢失。

**前提**

设置页和 popup 可以同时改不同字段。使用当时已复现的构建；当前构建尚未按本条人工复验。

**步骤**

1. 在 popup 关闭双语并确认已经保存。
2. 打开较早载入的设置页，只改字号等该页字段并保存。
3. 重新打开 popup，看双语开关和字号。

**验收**

- [ ] 设置页只提交自己改过的字段
- [ ] 弹窗里已经保存的关闭状态仍在
- [ ] 设置页保存的字号仍在

**来源**

[#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77)，提交 [`2559e9093261e7f3c2f9c3e0737ae231a23e9024`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/2559e9093261e7f3c2f9c3e0737ae231a23e9024)。当前测试：`tests/settings-storage.test.ts`。

**历史运行**

2026-10-24 的审查记录写在提交 `e419d3b` 当时的 `docs/reviews/2026-10-24-seven-fixes.md`（该文件不在现在的 `main` 上）。记录称修复后用打包扩展和合成夹具看到关闭状态与字号 32 同时保留。那次结果不延伸到 `dba68d08`。

**步骤完整度**

审查记录给出了可观察步骤。当前仓库里的证明是测试，不是 2026-11-11 的人工复验。

## SL-REG-002 保存完成时撤销保存期间的新编辑

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`2559e909`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/2559e9093261e7f3c2f9c3e0737ae231a23e9024) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有执行本条。
- 状态：历史来源待实测

**问题**

保存还没结束时又改了控件。保存完成后，这段新编辑被回到保存前的值。审查例子：持久值仍是 Off，等待期间改回 On，完成后草稿丢失，按钮变成 Saved。

**前提**

设置页的保存可以慢到让人在完成前再改一次。

**步骤**

1. 从 Off 发起保存。
2. 保存尚未完成时把控件改回 On。
3. 等保存结束，看控件和按钮。

**验收**

- [ ] 持久值保持这次保存要写入的 Off
- [ ] 保存期间改回的 On 仍留在草稿
- [ ] 按钮仍表示还有未保存的修改，而不是 Saved

**来源**

[#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77)。当前测试：`tests/settings-alerts.test.tsx`。

**历史运行**

2026-10-24 审查记录称修复后草稿保持 On，按钮为 Save changes，并有操作录像。该录像不在现在的 `main` 上。那次结果不延伸到 `dba68d08`。

## SL-REG-003 HBO 把旧英文文本标成选中的中文轨道

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`6d3b378a`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/6d3b378afe7ebf444a0fcdec93c3cc951ac550e3) 之前。引入版本未单独立档。
- 最近实测结果：未测。
- 状态：不适用

**问题**

HBO 上，选中中文轨道时仍可能显示旧的英文文本，并把它当成选中语言。审查记录要求原生文本的语言与选中语言一致；中文目标应显示中文 DOM 字幕，且不向 Provider 发请求。没有 DOM 字幕时页面暂不显示字幕。

**前提**

产品仍提供 HBO 播放器。

**步骤**

1. 在 HBO 播放器选择中文轨道，并留下一份旧的英文文本。
2. 看画面字幕和是否发出翻译请求。

**验收**

- [ ] 画面使用与选中语言一致的文本
- [ ] 选中语言已是目标语言时，不向 Provider 发请求

**来源**

[#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R3。当时测试为 `tests/hbo.test.ts`。

**不适用原因**

[#136](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/136)（[`bf527426508cf2deee7f7da2d19f013b513ee8fd`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/bf527426508cf2deee7f7da2d19f013b513ee8fd)）移除了 HBO。当前产品没有这条路径，不能把本条标成通过或失败。其他只针对 HBO 的旧修复一并停在这里，不另编号。

**历史运行**

2026-10-24 审查记录称修复后中文 DOM 字幕可见且 Provider 请求为零。那是 HBO 还在时的合成夹具记录。

## SL-REG-004 解析剥掉译文里的字面标签

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`733e5252`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/733e525277024765d488ca62f9849170dcf35a91) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有执行本条。
- 状态：历史来源待实测

**问题**

Provider 回复里，JSON 中的字面 thinking 标签被解析过程剥掉，截断的尾项还会清掉已经解析完的结果。合法译文因此变短或整批丢失。

**前提**

翻译结果里包含应原样保留的字面标签。可用会返回这类文本的模型，或测试夹具。

**步骤**

1. 让一条字幕的译文包含字面 thinking 标签。
2. 看画面上的译文是否还带着该标签。
3. 再准备一批里只有末项损坏的回复，看已完成的前面几项是否还在。

**验收**

- [ ] 字面标签留在译文里
- [ ] 截断尾项不清空已经完成的其他结果

**来源**

[#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R4。审查记录指向 `tests/provider-responses.test.ts`。后续回复协议有改动；复验时以画面是否保留字面标签、是否丢掉整批为准，不要照抄已经删除的解析分支。

**历史运行**

2026-10-24 审查记录有修复前后的字幕截图，不在现在的 `main` 上。

**步骤完整度**

历史来源推导。人工点击路径待补充，当前锁定在解析测试。

## SL-REG-005 退避之后下一条字幕丢失 HTTP 失败类型

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`733e5252`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/733e525277024765d488ca62f9849170dcf35a91) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有执行本条。
- 状态：历史来源待实测

**问题**

Provider 返回 HTTP 500 后进入退避。下一条字幕把这次失败显示成普通失败。审查记录还要求两次字幕请求只发出一次 POST，下一条继续收到 HTTP 500 的呈现。

**前提**

Provider 对请求返回 HTTP 500，并且紧跟着还有下一条字幕。

**步骤**

1. 播放到一条会收到 HTTP 500 的字幕。
2. 在退避期间看下一条字幕的失败呈现。
3. 核对这段时间发出的 POST 次数。

**验收**

- [ ] 下一条的失败呈现与首次 HTTP 失败一致
- [ ] 这两条字幕只发出一次 POST

**来源**

[#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R5。当时的主要测试是 `tests/queue.test.ts`。

**历史运行**

2026-10-24 审查记录称修复后仍显示 HTTP 失败。那次结果不延伸到 `dba68d08`。

**步骤完整度**

历史来源推导。POST 次数需要网络面板或测试断言，画面只够核对失败呈现。

## SL-REG-006 Token 读取失败时覆盖已有用量

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`733e5252`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/733e525277024765d488ca62f9849170dcf35a91) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有执行本条。
- 状态：历史来源待实测

**问题**

累加用量时如果读取失败，已有总量被这次增量盖掉。审查例子：已有 1000/100/20，失败的那次 10/2/0 把它写成了新总量。翻译本身仍然成功。

**前提**

popup 里已经有一份用量。可以让用量读取在下一次累加时失败。

**步骤**

1. 记下当前 Input / Output / Cache。
2. 制造一次用量读取失败，并完成一条翻译。
3. 再看 popup 里的用量。

**验收**

- [ ] 翻译仍然成功
- [ ] 读取失败时不写入，已有总量保持不变
- [ ] 之后一次正常累加加在原来的总量上

**来源**

[#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R6。当前测试：`tests/token-usage.test.ts`。

**历史运行**

2026-10-24 审查记录称历史总量保留。那次结果不延伸到 `dba68d08`。TC-160-popup 只读过一帧用量，没有制造读取失败。

**步骤完整度**

历史来源推导。怎样稳定制造读取失败，待补充人工步骤。

## SL-REG-007 人工重叠对白只剩后一句

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`6d3b378a`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/6d3b378afe7ebf444a0fcdec93c3cc951ac550e3) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有执行本条。
- 状态：历史来源待实测

**问题**

YouTube 人工字幕里，时间重叠的两句对白提前只剩后一句。审查记录的例子是第 4 秒应同时看见 1–5 秒和 3–7 秒两句。自动字幕的原有规则保留。

**前提**

一条带人工字幕、且有两人重叠说话的 YouTube 视频。

**步骤**

1. 打开该视频并开启双语。
2. 播到两句时间重叠的位置。
3. 看画面上是否两句都在，预取是否包含两句。

**验收**

- [ ] 重叠时段两句同时可见
- [ ] 预取包含这两句
- [ ] 自动字幕的处理不因本条被改掉

**来源**

[#77](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/77) R7。当前测试：`tests/youtube-captions.test.ts` 中保留同时出现的人工字幕行。

**历史运行**

2026-10-24 审查记录有只剩第二句和两句同时显示的前后截图，不在现在的 `main` 上。

**步骤完整度**

重叠时间来自审查记录。具体视频 URL 未写入现在的 `main`，待补充。

## SL-REG-008 缓冲 seek 把已完成译文换成「翻译中」

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`a5c6e0cd`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/a5c6e0cdd1447552adf959627cbf5fe084fdaade) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 的播放/暂停没有覆盖本条。
- 状态：历史来源待实测

**问题**

暂停后 YouTube 会在重新缓冲时发出 seek。扩展把这次 seek 当成拖动进度，清掉已经显示的译文，并在回复超过当时的 400ms 窗口后显示「翻译中」。同一句上的缓冲应保留译文。拖到另一句仍然换句。

**前提**

一句字幕的译文已经显示。可以暂停并让播放器在同一句上缓冲。

**步骤**

1. 等到一句双语已经显示。
2. 暂停，再继续，让播放器在同一句上发出 seek。
3. 看这句译文是否还在。
4. 再拖到另一句，确认旧译文会换掉。

**验收**

- [ ] 同一句上的缓冲 seek 之后，已显示的译文还在，不出现「翻译中」
- [ ] 拖到另一句时，画面改为那一句的字幕

**来源**

[#7](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/7)，[`a5c6e0cdd1447552adf959627cbf5fe084fdaade`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/a5c6e0cdd1447552adf959627cbf5fe084fdaade)。当前测试：`tests/controller.test.ts` 的 “keeps a displayed translation when playback resumes through a rebuffer seek”。

**步骤完整度**

PR 说明了暂停、缓冲 seek 和拖动的区别。400ms 是当时的窗口，复验以画面是否闪「翻译中」为准。

## SL-REG-009 已缓存字幕闪「翻译中」，worker 重启后缓存丢失

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`2d1ad2f4`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/2d1ad2f474bc46e9f22f1578d967bcf4a4139b38) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有重启 worker。
- 状态：历史来源待实测

**问题**

每次字幕切换都先显示「翻译中」，即使 worker 里已经有译文。缓存只在 worker 内存里，Chrome 停掉空闲 worker 之后，下一次把已经译过的句子再发给 Provider。

**前提**

一段字幕已经译过。可以在 `chrome://serviceworker-internals` 或扩展管理页停掉该扩展的 service worker。

**步骤**

1. 播放到一句双语已经出现，再让时间走到下一句已缓存的字幕。
2. 看切换时是否先闪「翻译中」。
3. 停掉 extension service worker，再回到刚才的句子。
4. 看是否再次向 Provider 发送这句。

**验收**

- [ ] 已经有译文的句子切换时不先闪「翻译中」
- [ ] worker 重启后，这句仍使用已有译文，不再次请求 Provider
- [ ] 缓存键里没有 API key

**来源**

[#15](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/15)，[`2d1ad2f474bc46e9f22f1578d967bcf4a4139b38`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/2d1ad2f474bc46e9f22f1578d967bcf4a4139b38)。当前测试：`tests/background.test.ts` 的 “keeps translations in session storage, without the API key, for a restarted worker”。

**步骤完整度**

PR 说明了闪烁和重启。当时「翻译中」在等待约 300ms 后出现；复验以是否闪烁为准，不把旧毫秒数写成现行规格。

## SL-REG-010 同一标签页的新页面沿用上一页的暂停

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`1462efec`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/1462efecbab3d8fcf5abfd2702c90187026f0c7c) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有换视频。
- 状态：历史来源待实测

**问题**

同一标签页里，上一页暂停了预取。打开下一个视频后，新页面仍保持暂停，字幕不再往下翻译。

**前提**

同一 Chrome 标签页。第一个视频处于暂停或已发出预取暂停。

**步骤**

1. 在一个视频上暂停播放，使预取暂停。
2. 在同一标签页打开另一个视频。
3. 看新视频是否开始翻译。

**验收**

- [ ] 新页面的预取会发出，不继承上一页的暂停
- [ ] 新视频上出现译文

**来源**

[`1462efecbab3d8fcf5abfd2702c90187026f0c7c`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/1462efecbab3d8fcf5abfd2702c90187026f0c7c)。当前测试：`tests/background.test.ts` 的 “starts a new page in the same tab without the pause the previous page left”。测试用不同的 `documentId` 区分页面。

**步骤完整度**

人工路径由测试推导：同一标签页打开下一个视频。待补充具体点击。

## SL-REG-011 整页全屏时字幕离开播放器

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`d391af8e`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/d391af8e15cbf87ccb70d061eb161f4f856e0284) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 的 YouTube 全屏只确认字幕还在，没有检查叠层父节点。
- 状态：历史来源待实测

**问题**

文档或整页进入全屏时，字幕叠层离开播放器。修复要求叠层留在播放器内，并且不给 documentElement 或 body 加上播放器类名。

**前提**

视频已有双语字幕。页面可以进入播放器全屏，也可以进入浏览器的整页全屏。

**步骤**

1. 让字幕显示在播放器里。
2. 对整个文档进入全屏。
3. 看字幕是否仍在播放器画面内。
4. 退出后，再只对 video 元素进入全屏，看原生字幕层是否恢复。

**验收**

- [ ] 整页全屏时，字幕叠层仍在播放器内
- [ ] html 和 body 不被标成播放器根
- [ ] 仅 video 元素全屏时，扩展叠层不留下，原生字幕层可见

**来源**

[`d391af8e15cbf87ccb70d061eb161f4f856e0284`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/d391af8e15cbf87ccb70d061eb161f4f856e0284)。当前测试在覆盖整合提交里仍叫 “keeps the overlay in the player when the whole document is fullscreen” 和 “keeps captions inside a fullscreen ancestor…”，文件是 `tests/controller.test.ts`。

**步骤完整度**

整页全屏的现象来自修复说明。仅 video 全屏的验收来自当前测试，人工点击路径待补充。

## SL-REG-012 暂停时的缓存查询被 seek 取消后不再重试

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`e24ff787`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/e24ff787509567b281ba27f486b9e48a6d458d4c) 之前。引入版本未单独立档。
- 最近实测结果：未测。TC-YT-playback 的 seek 不是这条暂停后的缓存查询。
- 状态：历史来源待实测

**问题**

视频暂停时发出的缓存查询被随后的 seek 取消。旧查询的结果仍可能画上画面，seek 之后也不再查一次，当前位置没有译文。

**前提**

一句字幕已有缓存。视频处于暂停，并且可以在查询返回前 seek。

**步骤**

1. 暂停在一句已缓存的字幕上。
2. 在缓存查询返回之前 seek 到另一时间。
3. 看画面使用的是哪一次查询的译文。

**验收**

- [ ] seek 之后会再发出一次缓存查询
- [ ] seek 之前那次查询的结果不画到画面上
- [ ] 画面显示 seek 之后那次查询的译文

**来源**

[`e24ff787509567b281ba27f486b9e48a6d458d4c`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/e24ff787509567b281ba27f486b9e48a6d458d4c)。当前测试：`tests/controller.test.ts` 的 “retries a paused cache lookup invalidated by a later seek event”。

**步骤完整度**

历史来源推导。测试用暂停、`seeked` 和两次 cache-only 查询区分新旧结果。

## SL-REG-013 seek 中止已经发出的翻译请求

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`19ee52b9`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/19ee52b9635cd42f42b1ee89c62efcfc08172683) 之前。引入版本未单独立档。
- 最近实测结果：未测。TC-YT-playback 的 seek 没有核对已发出的请求是否被中止。
- 状态：历史来源待实测

**问题**

seek 时，已经发给 Provider 的请求被取消。落点句子不能马上请求，已经返回的译文也不能留在缓存里供回到原处时使用。

**前提**

播放中已有在途的翻译请求。可以 seek 到后面，再 seek 回已经返回过的句子。

**步骤**

1. 在有多句字幕的视频上开始播放，等到已经发出请求。
2. seek 到后面的句子。
3. 看落点是否立刻开始请求，且 seek 前已发出的请求没有被中止。
4. 等其中一句的译文返回后，seek 回那一句。

**验收**

- [ ] seek 前已发出的请求继续，不被中止
- [ ] 落点句子马上发出请求
- [ ] 回到已经有译文的句子时显示该译文，且不再请求这一句

**来源**

[`19ee52b9635cd42f42b1ee89c62efcfc08172683`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/19ee52b9635cd42f42b1ee89c62efcfc08172683)。当前测试：`tests/prefetch.test.ts` 的 “keeps requests sent before a seek running, sends the landing at once and caches their replies”。

**步骤完整度**

历史来源推导。请求是否被中止需要网络面板或测试断言。

## SL-REG-014 普通播放或倍速的时间跳动被当成 seek

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`df337c72`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/df337c724ebd9cf04eefca56dab71ed4d3d3c5da) 之前。引入版本未单独立档。
- 最近实测结果：未测。TC-YT-playback 在 1.25× 下看过字幕还在，没有检查预取是否被暂停。
- 状态：历史来源待实测

**问题**

卡顿之后的普通播放，或 2 倍速下 `currentTime` 一次跳过一秒以上，被时间差启发式当成 seek。预取因此暂停，字幕被重新发送。真正的 seek 应只来自 `seeking` 和 `seeked`。

**前提**

视频可以 2 倍速播放，或可以制造一次不带 seeking 事件的时间跳动。

**步骤**

1. 以 2 倍速播放，或在卡顿后让播放时间一次前进超过一秒，同时不发生 seeking。
2. 看预取是否被暂停、已显示的译文是否被清掉。
3. 再做一次真正的拖动，确认落点会重新取字幕。

**验收**

- [ ] 只有 timeupdate 的时间跳动不暂停预取，也不把当前译文清掉
- [ ] 真正的 seeking / seeked 仍会按落点重新取字幕

**来源**

[#155](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/155)，[`df337c724ebd9cf04eefca56dab71ed4d3d3c5da`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/df337c724ebd9cf04eefca56dab71ed4d3d3c5da)。当前测试：`tests/prefetch.test.ts` 的 “keeps prefetch running when ordinary playback advances by more than one second”。与 SL-REG-015 是同一次 PR 里的两个症状，分开编号。

**步骤完整度**

历史来源推导。PR 写了 2 倍速和卡顿后的播放。

## SL-REG-015 页面标题变化后字幕停在 Subtitles have changed

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`1e300d71`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/1e300d71049927db4dad17fae56cd0ae8fd2953e) 之前。引入版本未单独立档。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有在同一句上改标题。
- 状态：历史来源待实测

**问题**

同一句字幕还在画面上时，页面标题变了。字幕行停在 “Subtitles have changed.”，直到下一句才恢复。同一句原文在不同标题下还应各自翻译，不能共用缓存。

**前提**

一句字幕正在显示。页面标题会变化，例如未读计数或换到另一条标题不同的视频但原文句子相同。

**步骤**

1. 停在一句已经显示译文的字幕上。
2. 只改变页面标题，保持这句原文不变。
3. 看这句是否离开 “Subtitles have changed.” 并显示新标题下的译文。
4. 用同一句原文打开另一个标题，确认不会直接复用上一标题的译文。

**验收**

- [ ] 标题变化后，当前句重新请求并显示新译文
- [ ] 画面不再停在 “Subtitles have changed.”
- [ ] 相同原文、不同页面标题的译文分开缓存

**来源**

[#155](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/155)，[`1e300d71049927db4dad17fae56cd0ae8fd2953e`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/1e300d71049927db4dad17fae56cd0ae8fd2953e)。当前测试：`tests/controller.test.ts` 的 “replaces the visible caption when only the page title changes”，以及 `tests/background.test.ts` 的 “keeps translations of identical text apart by page title”。

**步骤完整度**

可见失败来自 PR 说明和控制器测试。缓存分开来自后台测试。人工上如何只改标题、不换句，待补充。

## SL-REG-016 Provider 超时或失败后队列停住，或失败句被反复请求

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`2f2b63c9`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/2f2b63c9a50a7619eab11d94916f043560c62ab6) 之前。引入版本未单独立档。后续收紧见 `cd21051d`。
- 最近实测结果：未测。[2026-11-11 运行](runs/2026-11-11-dba68d08.md) 没有制造超时。
- 状态：历史来源待实测

**问题**

Provider 超时后，整条翻译队列暂停约 15 秒再重试该批，此时播放往往已经走过这些句子。失败的那句在仍处于当前窗口时也不应再次发送。后面的句子应继续翻译。

**前提**

可以让当前句的 Provider 请求超时或返回失败，后面还有句子。

**步骤**

1. 播放到一句会超时或失败的字幕。
2. 看这句的译文位置。
3. 继续播放到后面的句子。
4. 核对失败句是否再次发出请求。

**验收**

- [ ] 失败句的译文位置出现失败提示，原文行不显示
- [ ] 这句在当前窗口内只请求一次
- [ ] 后面的句子仍能译出，不必先空等再重试失败批

**来源**

[#13](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/13)，[`2f2b63c9a50a7619eab11d94916f043560c62ab6`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/2f2b63c9a50a7619eab11d94916f043560c62ab6)。同一验收的后续收紧：[`cd21051dce1e960eb86c27a3fb5ebf036720adc2`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/cd21051dce1e960eb86c27a3fb5ebf036720adc2)。当前测试：`tests/prefetch.test.ts` 的 “shows timeout/500 without its source, skips that batch, and translates the later segment”。

**步骤完整度**

PR 13 当时的可见文案是「接口调用超时」，并要求与「翻译中」同一字号颜色。现行失败呈现已改为与 Provider 500 相同的黄色样式。本条验收只保留队列继续、失败句不重试、画面有失败提示。不把旧文案写成当前规格。HTTP 429 是否仍会暂停，本条不写。

## SL-REG-017 译文原样抄下原文时仍当作译文显示

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`b31c5187`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/b31c5187c84cfbadb667535a335d26fd7b4aa88f) 之前。引入版本未单独立档。
- 最近实测结果：未测。
- 状态：历史来源待实测

**问题**

Provider 返回与原文相同的文本时，画面仍把它显示成译文，并会再次请求。

**前提**

一句字幕的翻译结果与原文相同。

**步骤**

1. 播放到会得到与原文相同的译文的一句。
2. 看双语行。
3. 停留足够长的时间，核对这句是否再次请求。

**验收**

- [ ] 画面只显示原文，不另显示一份相同译文
- [ ] 这句不再次请求

**来源**

[`b31c5187c84cfbadb667535a335d26fd7b4aa88f`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/b31c5187c84cfbadb667535a335d26fd7b4aa88f)。当前测试：`tests/controller.test.ts` 的 “shows only the source when the translation copies it and does not ask again”。

**步骤完整度**

历史来源推导。怎样在真实 Provider 上稳定得到抄原文的回复，待补充。

## SL-REG-018 seek 之后 Microsoft 不再补齐未译窗口

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`0e1ebde0`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/0e1ebde0786998b3c919638f74098c6c967c34d6) 之前。引入版本未单独立档。
- 最近实测结果：未测。TC-YT-playback 没有区分 Microsoft 补齐和 OpenAI。
- 状态：历史来源待实测

**问题**

OpenAI 模式下，若已同意 Microsoft，Microsoft 会在 OpenAI 完成前先补字幕，OpenAI 追上后停止。seek 到还没译过的位置后，Microsoft 不再开始，画面一直空着，直到 OpenAI 返回。

**前提**

当前 Provider 是 OpenAI，并且已经同意 Microsoft。视频里有一段还没缓存的位置。

**步骤**

1. 从头播放，直到 OpenAI 追上、Microsoft 不再补新句。
2. seek 到没有缓存的位置。
3. 看 seek 后的句子在 OpenAI 返回前是否有 Microsoft 译文。
4. 再 seek 到已经有 OpenAI 缓存的句子。

**验收**

- [ ] seek 到未译位置后，Microsoft 再次补齐，直到 OpenAI 追上
- [ ] 已经有 OpenAI 缓存的句子不再发给 Microsoft
- [ ] 整段都已缓存时，不启动 Microsoft
- [ ] 已经显示着 Microsoft 译文的句子保留该译文；OpenAI 的结果用于它之后的句子

**来源**

[#140](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/140)，[`0e1ebde0786998b3c919638f74098c6c967c34d6`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/0e1ebde0786998b3c919638f74098c6c967c34d6)。当前测试：`tests/background.test.ts` 的 “runs Microsoft beside OpenAI again after a seek…” 和 “takes OpenAI translations from the cache after a seek…”。

**步骤完整度**

PR 说明了画面会空着。测试核对的是两个 Provider 的发送和缓存，人工复验时以画面为准。

## SL-REG-019 回复末尾回显 [[source_end]] 导致整批失败

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`90ec0bba`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/90ec0bba083d0155452e2c03d7c2b9f3ab4e3491) 之前。引入版本未单独立档。
- 最近实测结果：未测。
- 状态：历史来源待实测

**问题**

OpenAI 模式的 YouTube 字幕显示 “Provider 回复非法信息流，无法翻译”。模型把结尾的 `[[source_end]]` 又写了一遍，解析把这一行当成多出来的一项，整批失败。打开视频或 seek 后马上发出的单句请求最容易遇到。PR 记录的例子在 `y5TEATUDDfc` 约 7:00。

**前提**

OpenAI 兼容 Provider 会在回复末尾回显一次 `[[source_end]]`。

**步骤**

1. 打开会触发该回复的视频，或 seek 到一次只发送一句的位置。
2. 看字幕是译文还是 “Provider 回复非法信息流，无法翻译”。

**验收**

- [ ] 回复只在末尾多一行 `[[source_end]]` 时，各句译文仍显示
- [ ] 终结标记出现在中间，或末尾出现两次时，该批仍然失败，并且不公布半截结果

**来源**

[#141](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/141)，[`90ec0bba083d0155452e2c03d7c2b9f3ab4e3491`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/90ec0bba083d0155452e2c03d7c2b9f3ab4e3491)。当前测试：`tests/provider-responses.test.ts` 的 “accepts one echoed [[source_end]] line at the end of the reply”，以及同文件里拒绝多余 `[[source_end]]` 的用例。

**历史运行**

PR 记录用 `mimo-v2.6-flash` 重放了 `y5TEATUDDfc` 300–600 秒的字幕。那次不是 2026-11-11 的人工浏览，不记为本轮通过。

## SL-REG-020 单句回复没有 id 行时整句失败

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`49a514b6`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/49a514b6029b4705449df84f3289fbe8c993fe09) 之前。引入版本未单独立档。
- 最近实测结果：未测。
- 状态：历史来源待实测

**问题**

只有一句的批次，模型只返回译文、不写 `[[p0]]`。画面显示 “Provider 回复非法信息流，无法翻译”。PR 记录的位置是 <https://www.youtube.com/watch?v=vYrvx_IQkrI> 约 2:22，对应约 2:19 的那句。两句及以上的批次仍然必须每句都有 id。

**前提**

OpenAI 兼容 Provider 对单句批次只返回译文正文。

**步骤**

1. 打开上述视频或另一条会单句发送的位置，播到该句。
2. 看画面是译文还是非法信息流提示。
3. 准备一个两句批次且缺少 id 的回复，确认它仍然失败。

**验收**

- [ ] 单句批次没有 id 行时，整段回复作为这一句的译文显示
- [ ] 空回复和过长回复仍然失败
- [ ] 两句及以上缺少 id、id 重复或 id 错位时，整批失败且不公布半截结果

**来源**

[#147](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/147)，[`49a514b6029b4705449df84f3289fbe8c993fe09`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/49a514b6029b4705449df84f3289fbe8c993fe09)。当前测试：`tests/provider-responses.test.ts` 的 “accepts a reply to one caption without its id line”。

**历史运行**

PR 记录对 2:19 那句和 1:50–2:50 的单句重放。那次不是 2026-11-11 的人工浏览。

## SL-REG-021 Microsoft 临时译文被写成正式缓存，或查询未完成时临时译文消失

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`1c792b36`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/1c792b3619bdb93f5df34036370046962ff0f8ed) 与 [`0c11f358`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/0c11f358ae2b223f6a6940d51539c51aa0b70da1) 之前。引入版本未单独立档。两条提交是同一缓存症状的两侧，不分开编号。
- 最近实测结果：未测。
- 状态：历史来源待实测

**问题**

OpenAI 模式下，Microsoft 的临时译文被写进长期翻译缓存。OpenAI 完成后，回看仍可能拿到 Microsoft 的文本。会话查询还没结束时，已经显示的临时译文也会被拿掉。

**前提**

当前 Provider 是 OpenAI，并且已经同意 Microsoft。OpenAI 可以慢于 Microsoft。

**步骤**

1. 播放一句，让 Microsoft 先显示译文，此时 OpenAI 尚未返回。
2. 在 OpenAI 返回前 seek 或回看这一句，看临时译文是否还在。
3. 等 OpenAI 返回后，再回看这一句。

**验收**

- [ ] OpenAI 返回前，画面可以显示 Microsoft 的临时译文
- [ ] 这段临时译文不是长期缓存里的最终译文
- [ ] OpenAI 返回后，回看使用 OpenAI 的译文，不再保留 Microsoft 那一份

**来源**

[`1c792b3619bdb93f5df34036370046962ff0f8ed`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/1c792b3619bdb93f5df34036370046962ff0f8ed)，[`0c11f358ae2b223f6a6940d51539c51aa0b70da1`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/0c11f358ae2b223f6a6940d51539c51aa0b70da1)。当前测试：`tests/background.test.ts` 的 “keeps a Microsoft translation only in temporary session entries until OpenAI finishes” 与 “keeps Microsoft enabled when a visible result finishes during a prefetch lookup”。

**步骤完整度**

长期缓存和临时条目的区分来自测试。人工复验以画面上的先后译文为准。选定 Provider 就是 Microsoft 时，译文应进入缓存；那是另一条行为，不属于本缺陷。

## SL-REG-022 OpenAI 的发送窗口占满时，当前句等不到 Microsoft

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`19ea791c`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/19ea791c3bb5fd78721f7af3696ced5eeeba08ae) 之前。引入版本未单独立档。
- 最近实测结果：未测。
- 状态：历史来源待实测

**问题**

OpenAI 的预取占满仅有的发送名额后，画面上的当前句要等这个窗口结束，Microsoft 才能开始。当前句因此空着。

**前提**

OpenAI 与 Microsoft 都启用。预取已经占满 OpenAI 的发送窗口，当前句还没有译文。

**步骤**

1. 播放到预取繁忙、当前句尚未显示译文的位置。
2. 看当前句是否还要等 OpenAI 窗口结束才出现 Microsoft 译文。

**验收**

- [ ] OpenAI 窗口已满时，当前句仍能先显示 Microsoft 译文
- [ ] OpenAI 的预取不挡住 Microsoft 这一次发送

**来源**

[#149](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/149)，[`19ea791c3bb5fd78721f7af3696ced5eeeba08ae`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/19ea791c3bb5fd78721f7af3696ced5eeeba08ae)。当前测试：`tests/background.test.ts` 的 “shows the Microsoft translation while the OpenAI send window is full”。

**步骤完整度**

历史来源推导。PR 正文里关于广告 Skip 的句子属于测量工具，不并入本条，也不单立产品缺陷。

## SL-REG-023 X 没有 HLS 控制器时不预取原生字幕

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[#105](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/105) 之前。引入版本未单独立档。
- 最近实测结果：未测。TC-158-X-small 只看了小窗折行，没有覆盖无 HLS 控制器时的预取。
- 状态：历史来源待实测

**问题**

X 在没有 HLS 控制器时只读当前已经显示的原生字幕，后面的句子进不了预取。seek 之后也要等句子出现才开始翻译。

**前提**

一条带原生字幕时间轴、且播放器没有 HLS 控制器的 X 视频。

**步骤**

1. 打开该视频并开启双语。
2. 在第一句出现前，确认后面的句子已经开始翻译。
3. seek 到后面的时间，看落点及其后一句是否已经有译文。

**验收**

- [ ] 当前句还没出现时，时间轴上后面的句子已经进入预取
- [ ] seek 后落点显示双语，其后的句子也已请求
- [ ] 这个路径不另外下载 m3u8 或 vtt

**来源**

[#105](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/105)，分支尖端 [`3c536242d336ae5e2cadec20351dc360604c6a91`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/3c536242d336ae5e2cadec20351dc360604c6a91)。当前测试：`tests/x.test.ts` 的 “prefetches loaded native X captions before they appear and after seeking without an HLS controller”。

**步骤完整度**

PR 说明了只读 active cue 的现象。怎样在人工环境确认「没有 HLS 控制器」，待补充。PR 里的 1× 到 2× 耗时是当时的性能测量，本条不引用那些数字。

## SL-REG-024 中文长字幕不按词切开

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`bb9eb97e`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/bb9eb97ec286727361d8aa41b51dd6af5c3d9e61) 之前。引入版本未单独立档。
- 最近实测结果：未测。2026-11-11 的视频原文是英文。
- 状态：历史来源待实测

**问题**

中文轨道被收成大段，因为当时只有英文有分句。源 cue 结束在「气」时，会把「气氛」从中切开。

**前提**

一条中文原文字幕的长视频。修复记录重放过一条 X 视频的 154 条 cue。

**步骤**

1. 打开中文原文字幕的长句视频，译文语言也设为中文，或只观察原文如何被切开。
2. 看长句是否分成可读的短字幕。
3. 找到跨 cue 的「气氛」，看它是否被拆开。

**验收**

- [ ] 中文长句分成可读字幕，而不是整段堆在一起
- [ ] 「气氛」保持完整
- [ ] 原文已经是译文语言时，不为这些句子向 Provider 发请求

**来源**

[#133](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/133)，[`bb9eb97ec286727361d8aa41b51dd6af5c3d9e61`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/bb9eb97ec286727361d8aa41b51dd6af5c3d9e61)。当前测试：`tests/subtitle-sentences.test.ts` 里中文分句和按词切开的用例。

**历史运行**

PR 记录用抓到的 154 条 cue 做了打包回放，并写明隔离环境里没能检查扩展叠层。那次不记为本轮通过。具体帖子 URL 未写入本条，待补充。

## SL-REG-025 译文在句子没说完的字幕边界自行加省略号

- 优先级：未在来源中单列
- 类型：功能缺陷
- 发现版本：[`ced745ee`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/ced745ee16a76a9c741f19f6969a4de232edc550) 与 [`ac5f26de`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/ac5f26de3850b14bb48bc91eac50f1dd7ec1f7dd) 之前。引入版本未单独立档。两次提交是同一症状，不分开编号。
- 最近实测结果：未测。
- 状态：历史来源待实测

**问题**

一句原文跨过几条字幕时，译文会在切分处自行加上省略号。原文里本来有的省略号则应保留。

**前提**

一句没有说完、被切成连续字幕的视频。Provider 为 OpenAI 兼容接口。

**步骤**

1. 播放到一句被切成前后两条、原文没有省略号的字幕。
2. 看译文在边界处有没有多出的省略号。
3. 再找一句原文本身带省略号的字幕，看译文是否保留它。

**验收**

- [ ] 原文没有省略号时，译文不在字幕边界自行添加
- [ ] 原文有省略号时，译文保留
- [ ] 译文不把没说完的句子补完

**来源**

[#114](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/114)，[`ced745ee16a76a9c741f19f6969a4de232edc550`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/ced745ee16a76a9c741f19f6969a4de232edc550)。[#120](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/120)，[`ac5f26de3850b14bb48bc91eac50f1dd7ec1f7dd`](https://github.com/weiguangchao/openai-translate-chrome-extension/commit/ac5f26de3850b14bb48bc91eac50f1dd7ec1f7dd)。当前测试锁定的是请求里的提示词，不是画面。

**步骤完整度**

历史来源推导、待补充。PR 写了现象，并称当时的真实请求没有多加省略号。那不是本轮人工浏览，也不能只凭提示词测试把本条标成通过。

## 审阅后未单立

下面这些看过标题、PR 正文或测试，但没有另立用例。

- 图标、圆角、默认字号 22px、缩短提示词（[#143](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/143)）：体验或提示调整，没有单独的缺陷复现步骤。
- chrome-debug、headless、测量技能、CI：工具链。测量技能里把广告算作无效样本，或在广告上点击 Skip，不是播放器字幕缺陷。本轮广告只以 TC-YT-playback 为准。
- 倍速下保留已译字幕的测试来自覆盖整合 `0dee9523`，没有找到单独的缺陷修复说明。SL-REG-014 只覆盖「时间跳动被当成 seek」。
- 已中止的请求仍占用发送名额（`37f8dbb`）：传输层测试，没有人工步骤。
- `d16c44e` 曾让一批里的坏结果单独重试、邻居照常公布。现行规则是坏回复整批失败且不重试。旧验收已不适用，不立为当前回归。
- 日语分句的 PR 标题见过（[#115](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/115)、[#117](https://github.com/weiguangchao/openai-translate-chrome-extension/pull/117)）。这次没有读到可复跑步骤，不凭标题编号。
