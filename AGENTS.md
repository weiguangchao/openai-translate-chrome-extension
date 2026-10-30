# Subline

Subline is a Chrome Manifest V3 extension that shows bilingual subtitles on YouTube, HBO Max, and X. It translates existing video captions through the user's OpenAI-compatible API and caches translations for replay. The project uses TypeScript, React, and Vite and has no backend.

## Non-negotiables

The Principles section below grounds every trigger. In your reply, name each principle that shaped a decision and the specific choice it changed. Cite only principles whose leaf SKILL.md you read this session.

Remaining triggers:

- Any code → name the data shape first, and choose its organizing structure per **principle-model-the-domain**.
- Any prose surface, your reply to the user included → the **unslop** skill.
- Before commit → the **deslop** skill.
- Broken skill mid-task → fix it in its own PR. Don't block. Don't silently work around it.
- When meeting any `.ts` or `.tsx` file → the **typescript-best-practices** skill.

## Principles

Read the leaf skill in full for any principle you apply. Each entry names when it applies. Each leaf is the **principle-<title>** skill, with the title in kebab case, hyphens kept and other punctuation dropped, unless the entry gives its name.

### Core

- **Laziness Protocol**. Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading. Bias to deletion and the smallest change that solves the problem.

- **Foundational Thinking**. Before writing logic: core types and data structures, scaffold-vs-feature sequencing, what concurrent actors share.

- **Redesign from First Principles**. Integrating a new requirement into an existing design. Redesign as if it had been foundational from day one.

- **Subtract Before You Add**. Sequencing an addition, refactor, or rewrite. Remove dead weight first, then build on the simpler base.

- **Minimize Reader Load**. Reviewing or shaping code that's hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.

- **Outcome-Oriented Execution**. Planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture, don't preserve throwaway compatibility states.

- **Experience First**. Product, UX, or feature-scope tradeoffs. Choose user delight over implementation convenience.

### Architecture

- **Model the Domain**. Writing stateful logic, or code that branches a lot or repeats a shape assumption across files. Encode the domain in a structure (state machine, typed model, table or registry, reducer, boundary, the right collection) instead of scattered conditionals.

- **Boundary Discipline**. Wiring validation, error handling, or framework adapters. Guards at system boundaries, trust internal types, keep business logic pure.

- **Type System Discipline**. Designing types or a signature in any typed language. Make illegal states unrepresentable, brand primitives, parse external data at boundaries.

- **Make Operations Idempotent**. Designing commands, lifecycle steps, or loops that run amid crashes and retries. Converge to the same end state.

- **Migrate Callers Then Delete Legacy APIs**. Introducing a new internal API while old callers exist. Migrate and delete in one wave.

- **Separate Before Serializing Shared State**. Concurrent actors might write the same file, branch, key, or object. Eliminate the sharing first.

### Verification

- **Fix Root Causes**. Debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.

- **Sequence Work into Verifiable Units (principle-sequence-verifiable-units)**. Multi-step work (sweeps, migrations, runs of similar edits) and how you stack commits and PRs. Break work into small units that each end in a check, verify each before the next, and order delivery so the sequence proves itself.

- **Test Behavior, Not Implementation**. Writing, changing, or keeping a test. Assert what the code's users can observe, so the test fails when that behavior breaks and keeps passing when only the internals change.

### Delegation

- **Guard the Context Window**. Context fills up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents, keep summaries in the main thread.

- **Never Block on the Human**. Tempted to ask "should I do X?" on reversible work. Proceed, present the result, let the human course-correct.

### Meta

- **Encode Lessons in Structure**. You catch yourself writing the same instruction a second time. Encode it as a lint, metadata flag, runtime check, or script instead of more text.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or other PR-only assets into the repo.
- When babysitting: call `watch_pull_request` and end your turn. T3 Code wakes you on checks, comments, or conflicts. Do not poll or sleep. Verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Rules

Each rule names what fails when it is broken. When the developer corrects a mistake, fix it and add its rule here; if the rule is already here and only judgment enforces it, enforce it in the same change.

| Rule | Enforced by |
| --- | --- |
| A Provider reply is read as `{"results":[{"id","translation"}]}`, and each translation is stored under the input it answers. The only variants accepted are the ones `tests/provider-responses.test.ts` covers: thinking or fenced wrappers, string or one-based ids, truncated results and the reasoning channel. | `src/shared/api.ts`; `tests/provider-responses.test.ts` |
| A failure reaches the page as a `TranslateFailure` kind; nothing decides state by comparing a message, `textContent` or a class name. | The `Reply` type in `src/shared/messages.ts`; ESLint `local/typed-outcomes` |
| `CaptionTranslator` owns what each caption shows; the overlay only renders it. | ESLint `local/write-only-overlay`; `TranslationLine` switches are exhaustive; `tests/controller.test.ts` |
| Every visible subtitle error uses the Provider 500 presentation, with yellow text at the configured translation size, the subtitle background and position, no source caption and no Subline prefix. | `src/core/overlay.ts`; `tests/controller.test.ts`; `e2e/provider.spec.ts`; `e2e/caption-sources.spec.ts` |
| Subtitle language comes from the selected video caption track, never a saved setting. Settings choose only the translation language. English, Simplified Chinese, Traditional Chinese, Japanese and Korean are supported; other languages show `原文语言不支持` without Provider traffic. A track already in the translation language shows its captions alone, without Provider traffic. | `src/shared/languages.ts`; `tests/youtube.test.ts`; `tests/controller.test.ts`; `e2e/caption-sources.spec.ts` |
| Every setting has one scope, which decides what changing it invalidates and whether it is part of the translation cache key. | `SETTING_SCOPES` in `src/shared/settings.ts`; `tests/settings-scope.test.ts` |
| Every number that shapes playback, Provider traffic or what a caption shows lives in `src/shared/tuning.ts`. | ESLint `local/tuning-home` |
| A new tuning value, failure kind or test runner setting needs a `Requested-by:` line in its commit message. | `scripts/check-policy.mjs` in `npm run check` |
| Provider HTTP goes through `src/shared/provider/transport.ts`. | ESLint `local/provider-transport` over `src/shared`, `src/extension` and `src/ui` |
| Translation requests send `reasoning_effort: "low"`, and HTTP errors return without compatibility retries or remembered parameter rejections. | `src/shared/api.ts`; `tests/api.test.ts` |
| A sent Provider POST keeps its rate slot for `providerSendWindowMs`, even if it is aborted. | `tests/provider-transport.test.ts` |
| A seek drops only unsent work. Requests already sent finish into the cache and stop counting toward `maxInFlightRequests` and `translationSendsPerSecond`. | `tests/prefetch.test.ts`; `tests/queue.test.ts` |
| A failed caption is not retried, and is not requested again while it stays in the prefetch window. | `tests/queue.test.ts`; `tests/captions.test.ts`; `e2e/provider.spec.ts` |
| Provider requests leave the computer only over HTTPS; plain HTTP goes only to `localhost` or `127.0.0.1`, or the Chrome Web Store rejects the extension. | `validateBaseUrl` in `src/shared/settings.ts`; `optional_host_permissions` in `public/manifest.json`; `tests/api.test.ts` |
| The API key reaches `chrome.storage` only encrypted under the device key. | `saveSettings` in `src/shared/storage.ts`; ESLint `local/storage-writers`; `tests/settings-storage.test.ts` |
| No caption reaches the Provider until the user has agreed, on the settings page, to send captions to that Provider's origin. | `hasProviderConsent` in `src/extension/background.ts`; `tests/background.test.ts` |
| Caption queues call `translateCaptionBatch`, never `translate`. | ESLint `no-restricted-imports` over `src/extension` except `src/extension/background.ts` |
| Imports flow platforms → core → shared, platforms never import each other, and the settings pages import only shared code. | ESLint `local/dependency-boundaries`; `tests/dependency-boundaries.test.ts` |
| Text shown on more than one page comes from `src/ui/copy.ts`. | `scripts/check-ui-copy.mjs` in `npm run check` |
| TypeScript has no comments. | ESLint `local/no-comments` |
| Every test run type-checks the files it runs. | The `types` project in `vite.config.ts` |
| Local runs and CI run the same checks. | `npm run verify` in the `verify` workflow; `npm run test:discovery` |
| References in this file resolve, and the glossary names constants instead of copying their values. | `scripts/check-docs.mjs` in `npm run check` |
| Each test contract has one primary owner. Expected values come from the contract, and rejection cases reach the guard they claim to test. | The test-audit skill; `docs/reviews/2026-10-12-test-audit.md` |
| Don't add a fallback, alternate format, retry, cap or cache the request didn't ask for; propose it instead. | `scripts/check-policy.mjs` for tuning values, failure kinds and test runner settings; judgment otherwise |
| Attach a real-browser measurement to a tuning change only when the developer asks for one. | Judgment |
| End-to-end tests run in real time. When one times out on this machine, say so in the notes; don't raise its timeout. | Judgment |
| The settings page and popup show a label and its control without explanatory secondary text; links are icons or quiet underlined text. | Judgment |
| The About page's GitHub and X links are borderless, and the author's profile link uses the current X logo. | `src/ui/App.tsx`; `src/ui/styles.css` |
| When you name a gap you could close, such as failing tests or a check you skipped, close it before you stop. | Judgment |

## Real browser verifying

For a user-requested real-browser check, default to the [headless-chromium skill](.agents/skills/headless-chromium/SKILL.md) to launch and initialize an isolated headless browser. Then use the [chrome-debug skill](.agents/skills/chrome-debug/SKILL.md) for page operations, debugging and trace collection. Use an existing or headed browser when the user requests one. Do not start real-browser checks for unrelated code or documentation work.

Collect and report the metrics below for each build on YouTube and X by default. Include HBO Max only when the user explicitly requests HBO. Test each included platform at 1x, 1.25x, 1.5x and 2x. Each run reloads Subline so no translation is cached, opens the video, sets the rate and traces 45 s with `"since": "open"`. It then seeks once into a segment with no cached translations, away from where the opening trace played, traces 45 s with `"since": "seek"` for the landing trace, then keeps playing and traces 180 s; durations are video seconds. On YouTube, the first `media` step's `time` starts the video where someone is speaking; YouTube ignores `&t=`.

A run counts only if its traces report the tested `playbackRate` and none is marked `throttled` (keep Chrome in front). The landing trace fails by itself when the video leaves the seek target.

- Wait after opening: the seconds a viewer waits after opening the video until the first subtitle on screen shows its translation, from the opening trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Wait after seeking: the seconds a viewer waits after the seek until the first subtitle on screen shows its translation, from the landing trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Loading while playing: the share of subtitle time that shows the loading placeholder instead of a translation, from the 180 s trace: `states.loading / (states.loading + states.ready)`.
- Provider duration p90. Report the 90th percentile of wall seconds from `sent` to `done` for successful Provider requests completed during the 180 s trace, from `batches.p90`. Exclude queue time, failed, aborted and pending requests. Include the full duration when a request was sent before this trace but completed within it. Use nearest rank and do not divide by playback rate. Report the sample count from `batches.measured` and the outcome counts from `batches.results`. No samples means unavailable, not zero.

### Page readiness and visible subtitles

- On YouTube, wait for pre-roll ads to finish and confirm the selected caption track is enabled before seeking into spoken content. A fresh profile may have CC off. If the player fails after seeking, inspect its error and media response before changing the seek method or timeout. The investigation observed HTTP 200 media responses carrying STREAM_PROTECTION_STATUS rejection and player errors ump.spsrejectfailure and HTML5_SPS_UMP_STATUS_REJECTED. HTTP 200 alone does not establish playable media.
- On X, confirm the main video, selected subtitle language, track mode, loaded cues and active cues. Inspect the actual caption source before assuming prefetch works. The investigated page exposed a React controller instead of the adapter's expected `playerApi.video.hlsJs`. Subline used live native cues without a full timeline. The traces suggest many successful Provider replies arrived after their caption had changed. A source mode named model or successful requests alone do not prove timeline prefetch or timely subtitles.
- Check screenshots as well as `overlay` results. Choose a viewport that fits the subtitle area. DOM visibility and viewport intersection do not detect another element covering a subtitle. In the investigated 756 by 413 viewport, X's fixed See all the replies and Continue to X login panel covered the translation while the DOM check reported it visible. Scroll the subtitle region clear of page panels and inspect both lines. Do not remove page elements with injected CSS to manufacture a passing screenshot. Record viewport and scroll position with the evidence.
- A paused frame can confirm real translation and rendering. Label it as a separate diagnostic. It does not prove continuous playback quality and must not replace the opening, landing or playing traces. X displayed both lines after scrolling and pausing even when continuous playback showed almost entirely loading.

### Evidence and cleanup

- For authorized MiMo measurements, read the current worktree's Git-ignored `.env` fields MIMO_BASE_URL, MIMO_MODEL and MIMO_API_KEY before asking for configuration. Keep this user-requested persistent file at mode `0600`, fill the real settings page from it, and retain it during task cleanup. Never copy its key into evidence or a build.
- Preserve failed attempts and raw traces. Check saved runs with `.agents/skills/chrome-debug/scripts/verify.py`. Report collection completeness, timing validity, visible subtitle behavior and performance thresholds separately. Report wait time as unavailable when no caption becomes ready in its window. Report Provider duration as unavailable when its successful sample count is zero. The loading share excludes empty and error states. A value of zero does not mean all captions succeeded. Do not increase timeouts or weaken assertions to obtain a pass.
- Close only this task's tabs and stop its `live.py` holder. Stop any browser launcher owned by this task after the holder has stopped, and remove its temporary profile and secret-bearing setup files. Do not close the user's browser. Retain the evidence needed to reproduce the finding. Sanitize diagnostic network logs before sharing because they can contain cookies and signed media URLs.

## Glossary

### Sentence

A sentence is text Subline rejoins from downloaded subtitle cues and splits where sentences end: at sentence-ending punctuation, at a silence of at least `sentencePauseSeconds`, and around lyric lines (♪) and sound tags ([…]), which stand alone. Overlapping cues are left as they are.

### Caption

A caption is what Subline translates and shows. A sentence over `captionDisplayLimit` display columns is cut into captions no wider than that: at clause punctuation or between source cues first, then between words, into the fewest balanced pieces, each ending where the next begins. Overlapping cues and captions read from the page DOM stay whole. The Provider translates each caption as its own input and never chooses the breaks. A caption shows its source only together with its translation.

### Segment

A segment is `segmentCaptions` consecutive captions, numbered from zero and recorded in traces as `seg`. It only labels the timeline and doesn't decide Provider requests: each request carries up to `translationBatchLimit` upcoming captions within `packSpanSeconds` of video, whichever segments they belong to.
