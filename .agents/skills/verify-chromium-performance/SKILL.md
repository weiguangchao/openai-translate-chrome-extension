---
name: verify-chromium-performance
description: Measure or compare Subline playback in Chromium on request.
---

# Verify performance

Use [setup](../setup-headless-chromium/SKILL.md)/[debug](../debug-chromium/SKILL.md), or requested existing/headed browsers. Edits alone need no real-site measurements. Test YouTube/X at 1x, 1.25x, 1.5x, 2x per build. Read [page checks](references/page-readiness.md).

Authorized MiMo: read `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` from the ignored `.env` before asking. Git does not copy `.env` into new worktrees, so it usually lives only in the main checkout. This prints the first `.env` found, checking the current worktree and then every worktree of the repository:

```sh
{ git rev-parse --show-toplevel; git worktree list --porcelain | sed -n 's/^worktree //p'; } | while read -r d; do [ -f "$d/.env" ] && echo "$d/.env" && break; done
```

Read that file where it is. Don't copy it, change it, or loosen its `0600` mode. Configure the values in real settings and keep keys out of builds and evidence.

Each run: reload to clear translations, open/set rate; trace 45 video seconds `since: "open"`, seek once to uncached captions outside opening/prefetch, trace 45 seconds `since: "seek"`, then 180 continuous video seconds. YouTube needs first `media.time` in speech, not unreliable `&t=`. Keep headed Chrome in front; omit headless `focus`. For plans/comparisons/resume/saved checks read [measurement](references/measurement.md).

Reject wrong/changing rates, throttled clocks, sparse/truncated/short traces and landing jumps. `ok` alone proves no timing validity. Report completeness/timing/visible behavior/thresholds separately. Preserve failures; never raise timeouts/weaken assertions. Follow debug/setup cleanup; sanitize shared logs.

## Report

Per-run waits are `(firstReadyAt-firstCaptionAt)/playbackRate` viewer seconds. Playing loading is `states.loading/(states.loading+states.ready)`, excluding empty/errors; zero does not prove caption success. Report playing `batches.p90`, `measured`, `results`.

Provider p90 is nearest-rank full sent-to-done wall time for successes completed during playing, including earlier sends. Exclude queue/failed/aborted/pending requests; never divide durations by rate. Missing ready captions/successes mean unavailable wait/duration.

Every results reply, including interim metrics, directly includes this table. Operational updates need none; charts/links only supplement it.

| 平台 | 有效组数 | 打开等待中位数 s | 跳转等待中位数 s | 播放 loading | Provider p90 s | 成功样本 |
| --- | --- | --- | --- | --- | --- | --- |

Group by platform/conditions; separate builds/Providers/models/settings. Add relevant comparison columns after platform; sends-per-second only in send-rate comparisons.

- Valid/planned retains full denominator, normally four rates, even interim. Include one completed timing-valid attempt per case, even threshold failures; preserve exclusions.
- Convert waits before available medians/counts: `2.12 (4/4)`, `不可用 (0/N)`. Missing never means zero.
- Sum playing loading/rate and ready/rate; loading share is summed loading/their sum. Never average percentages; zero denominator is unavailable.
- Pool eligible successful durations for p90/sample count; never average p90s. Zero samples means unavailable p90.

Aggregate at full precision; display seconds/percentages to two decimals, integer counts. Retain per-run metrics/Provider outcomes/raw traces; state contributing rates, missing/excluded runs and repetitions per condition.
