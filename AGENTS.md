# Subline

## Non-negotiables

- Any prose surface → the unslop skill. Your reply is a prose surface.
- Before commit → the deslop skill
- For testing -> the test-audit skill

## Principles

Read the leaf skill in full for any principle you apply. Each entry names when it applies. Each leaf is the **principle-<title>** skill, with the title in kebab case, hyphens kept and other punctuation dropped, unless the entry gives its name.

### Delegation

- **Never Block on the Human.** Tempted to ask "should I do X?" on reversible work. Proceed, present the result, let the human course-correct.

## Rules

Each rule names what fails when it is broken. When the developer corrects a mistake, fix it and add its rule here; if the rule is already here and only judgment enforces it, enforce it in the same change.

| Rule | Enforced by |
| --- | --- |
| A Provider reply is read as `{"results":[{"id","translation"}]}`, and each translation is stored under the input it answers. The only variants accepted are the ones `tests/provider-responses.test.ts` covers: thinking or fenced wrappers, string or one-based ids, truncated results and the reasoning channel. | `src/shared/api.ts`; `tests/provider-responses.test.ts` |
| A failure reaches the page as a `TranslateFailure` kind; nothing decides state by comparing a message, `textContent` or a class name. | The `Reply` type in `src/shared/messages.ts`; ESLint `local/typed-outcomes` |
| `CaptionTranslator` owns what each caption shows; the overlay only renders it. | ESLint `local/write-only-overlay`; `TranslationLine` switches are exhaustive; `tests/controller.test.ts` |
| Every setting has one scope, which decides what changing it invalidates and whether it is part of the translation cache key. | `SETTING_SCOPES` in `src/shared/settings.ts`; `tests/settings-scope.test.ts` |
| Every number that shapes playback, Provider traffic or what a caption shows lives in `src/shared/tuning.ts`. | ESLint `local/tuning-home` |
| A new tuning value, failure kind or test runner setting needs a `Requested-by:` line in its commit message. | `scripts/check-policy.mjs` in `npm run check` |
| Provider HTTP goes through `src/shared/provider/transport.ts`. | ESLint `local/provider-transport` over `src/shared`, `src/extension` and `src/ui` |
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
| When you name a gap you could close, such as failing tests or a check you skipped, close it before you stop. | Judgment |

## Git

- When Codex creates a commit, append `Co-authored-by: Codex <noreply@openai.com>` to the commit message.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: fix(web): new threads no longer spike CPU.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before/after images.

## Additional tips

- Don't verify with real-browser unless the user explicitly agrees or requests it.

## Verifying

When use the chrome-debug skill for a real-browser check, report the metrics below for each build on YouTube, HBO Max and X at 1x, 1.25x, 1.5x and 2x. Each run reloads Subline so no translation is cached, opens the video, sets the rate and traces 45 s with `"since": "open"`. It then seeks once into a segment with no cached translations, away from where the opening trace played, traces 45 s with `"since": "seek"` for the landing trace, then keeps playing and traces 180 s; durations are video seconds. On YouTube, the first `media` step's `time` starts the video where someone is speaking; YouTube ignores `&t=`.

A run counts only if its traces report the tested `playbackRate` and none is marked `throttled` (keep Chrome in front). The landing trace fails by itself when the video leaves the seek target.

- Wait after opening: the seconds a viewer waits after opening the video until the first subtitle on screen shows its translation, from the opening trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Wait after seeking: the seconds a viewer waits after the seek until the first subtitle on screen shows its translation, from the landing trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Loading while playing: the share of subtitle time that shows the loading placeholder instead of a translation, from the 180 s trace: `states.loading / (states.loading + states.ready)`.
- Loading after seeking: the same share as Loading while playing, from the landing trace.
- Provider duration p50: the median wall seconds from `sent` to `done` for successful Provider requests completed during the 180 s trace, from `batches.p50`. Exclude queue time, failed, aborted and pending requests. Include the full duration when a request was sent before this trace but completed within it.
- Provider duration p90: the 90th percentile of the same requests, from `batches.p90`. Both percentiles use nearest rank and are not divided by playback rate. Report the sample count from `batches.measured` and the outcome counts from `batches.results`; no samples means unavailable, not zero.

## Glossary

### Sentence

A sentence is text Subline rejoins from downloaded subtitle cues and splits where sentences end: at sentence-ending punctuation, at a silence of at least `sentencePauseSeconds`, and around lyric lines (♪) and sound tags ([…]), which stand alone. Overlapping cues are left as they are.

### Caption

A caption is what Subline translates and shows. A sentence over `captionDisplayLimit` display columns is cut into captions no wider than that: at clause punctuation or between source cues first, then between words, into the fewest balanced pieces, each ending where the next begins. Overlapping cues and captions read from the page DOM stay whole. The Provider translates each caption as its own input and never chooses the breaks. A caption shows its source only together with its translation.

### Segment

A segment is `segmentCaptions` consecutive captions, numbered from zero and recorded in traces as `seg`. It only labels the timeline and doesn't decide Provider requests: each request carries up to `translationBatchLimit` upcoming captions within `packSpanSeconds` of video, whichever segments they belong to.
