---
name: verify-chromium-performance
description: Measure or compare Subline playback in Chromium on request.
---

# Verify performance

Use [setup](../setup-headless-chromium/SKILL.md)/[debug](../debug-chromium/SKILL.md), or requested existing/headed browsers. Edits alone need no real-site measurements. Test YouTube/X at 1x, 1.25x, 1.5x, 2x per build. Read [page checks](references/page-readiness.md).

Reported metrics come from `measure.py`, never from hand-driven `live.py` traces; it runs and validates the sequence below. Read [measurement](references/measurement.md) for plans/comparisons/resume/saved checks:

```bash
python3 .agents/skills/debug-chromium/scripts/measure.py PLAN.json --build current=/path/to/dist --loaded /path/to/loaded/dist --output /path/to/results --session SESSION --launch-session /path/to/headless-check/session.json
```

Each run reloads to clear translations, opens/sets rate, traces 45 video seconds `since: "open"`, seeks once to uncached captions outside opening/prefetch, traces 45 seconds `since: "seek"`, then 180 continuous video seconds. YouTube needs first `media.time` in speech, not unreliable `&t=`. Keep headed Chrome in front; omit headless `focus`.

Authorized OpenAI-compatible Provider (MiMo): read `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` from the ignored `.env` before asking. Git does not copy `.env` into new worktrees, so it usually lives only in the main checkout. This prints the first `.env` found, checking the current worktree and then every worktree of the repository:

```sh
{ git rev-parse --show-toplevel; git worktree list --porcelain | sed -n 's/^worktree //p'; } | while read -r d; do [ -f "$d/.env" ] && echo "$d/.env" && break; done
```

Read that file where it is. Don't copy it, print it, change it, or loosen its `0600` mode. Pass its path to the [launcher](../setup-headless-chromium/SKILL.md) as `--provider-env`, and keep keys out of builds and evidence.

Reject runs with a wrong or changing rate, a throttled clock, a sparse/truncated/short trace or a landing jump; `ok` alone does not prove valid timing. Report completeness/timing/visible behavior/thresholds separately. Preserve failures; never raise timeouts/weaken assertions. Follow debug/setup cleanup; sanitize shared logs.

## Report

Per-run waits are `(firstReadyAt-firstCaptionAt)/playbackRate` viewer seconds. Playing loading is `states.loading/(states.loading+states.ready)`, excluding empty/errors; zero does not prove caption success. Report playing `batches.p90`, `measured`, `results`.

Provider p90 is nearest-rank full sent-to-done wall time for successes completed during playing, including earlier sends. Exclude queue/failed/aborted/pending requests; never divide durations by rate. Missing ready captions/successes mean unavailable wait/duration.

Every results reply, including interim metrics, directly includes this table. Name the platforms/Providers/builds measured; none stands in for another. Operational updates need none; charts/links only supplement it.

| 平台 | 有效组数 | 打开等待中位数 s | 跳转等待中位数 s | 播放 loading | Provider p90 s | 成功样本 |
| --- | --- | --- | --- | --- | --- | --- |

Group by platform/conditions; separate builds/Providers/models/settings. Add relevant comparison columns after platform; sends-per-second only in send-rate comparisons.

- Valid/planned retains full denominator, normally four rates, even interim. Include one completed timing-valid attempt per case, even threshold failures; preserve exclusions.
- Convert waits before available medians/counts: `2.12 (4/4)`, `不可用 (0/N)`. Missing never means zero.
- Sum playing loading/rate and ready/rate; loading share is summed loading/their sum. Never average percentages; zero denominator is unavailable.
- Pool eligible successful durations for p90/sample count; never average p90s. Zero samples means unavailable p90.

Aggregate at full precision; display seconds/percentages to two decimals, integer counts. Retain per-run metrics/Provider outcomes/raw traces; state contributing rates, missing/excluded runs and repetitions per condition.
