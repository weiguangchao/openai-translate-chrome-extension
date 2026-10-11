# Subline

## Principle

- Any prose surface → the unslop skill. Your reply is a prose surface. Write it per Writing the reply.
- Before commit → the deslop skill

## Rules

Each rule names what fails when it is broken. When the developer corrects a mistake, fix it and add its rule here; if the rule is already here and only judgment enforces it, enforce it in the same change.

| Rule | Enforced by |
| --- | --- |
| A Provider reply is read only as `{"results":[{"id","translation"}]}`, and each translation goes to the id it names. | `src/shared/api.ts` reads no other shape; `tests/provider-responses.test.ts` |
| `CaptionTranslator` owns what each caption shows; the overlay only renders it. | `SubtitleOverlay` exposes no state; `TranslationLine` switches are exhaustive; `tests/controller.test.ts` |
| Every setting has one scope, which decides what changing it invalidates and whether it is part of the translation cache key. | `SETTING_SCOPES` in `src/shared/settings.ts`; `tests/settings-scope.test.ts` |
| Provider HTTP goes through `src/shared/provider/transport.ts`. | ESLint `local/provider-transport` |
| Caption queues call `translateCaptionBatch`, never `translate`. | ESLint `no-restricted-imports` in `src/extension/queue.ts` |
| Imports flow platforms → core → shared, and platforms never import each other. | ESLint `local/dependency-boundaries`; `tests/dependency-boundaries.test.ts` |
| TypeScript has no comments. | ESLint `local/no-comments` |
| Local runs and CI run the same checks. | `npm run verify` in the `verify` workflow; `npm run test:discovery` |
| The glossary names constants instead of copying their values. | Judgment |
| Don't add a fallback, alternate format, retry, cap or cache the request didn't ask for; propose it instead. | Judgment |

## Git

- When Codex creates a commit, append `Co-authored-by: Codex <noreply@openai.com>` to the commit message.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: fix(web): new threads no longer spike CPU.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before/after images.

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
