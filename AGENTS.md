# Subline

Subline is a Chrome Manifest V3 extension that shows bilingual subtitles on YouTube and X. It translates existing video captions through Microsoft Translate or the user's OpenAI-compatible API and caches translations for replay. The project uses TypeScript, React, and Vite and has no backend.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images embedded in the PR body.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or other PR-only assets into the repo.
- When babysitting: call `watch_pull_request` and end your turn. T3 Code wakes you on checks, comments, or conflicts. Do not poll or sleep. Verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Lessons

Before changing code, read [LESSONS.md](docs/LESSONS.md): what recent merged work got wrong and the rule that would have caught it.

## Product features

Read [the product feature documentation](docs/feature/README.md) for current user-facing behavior, settings, translation services, and data handling. Update it when a change alters that behavior.

## Real browser verifying

For user-requested real-browser performance checks, use [verify-chromium-performance](.agents/skills/verify-chromium-performance/SKILL.md). Do not start real-browser checks for unrelated code or documentation work.

## Glossary

### Sentence

A sentence is text Subline rejoins from downloaded subtitle cues and splits where sentences end: using the English or Chinese segmenter, at a silence of at least `sentencePauseSeconds`, and around lyric lines (♪) and sound tags ([…]), which stand alone. Overlapping cues are left as they are.

### Caption

A caption is what Subline translates and shows. A sentence at or below `captionDisplayLimit` display columns is one caption. A longer sentence goes through the language segmenter once, with no length check afterward. English and Chinese use Echogarden phrase boundaries with source cue breaks to choose balanced captions. English uses Echogarden word boundaries; Chinese also uses native `Intl.Segmenter` word boundaries within Han text and accepts source cue breaks only at word boundaries. Other languages pass through without language-specific splitting. Each caption ends where the next begins. Overlapping cues and captions read from the page DOM stay whole. The Provider translates each caption as its own input and never chooses the breaks. A caption shows its source only together with its translation.

### Segment

A segment is `segmentCaptions` consecutive captions, numbered from zero and recorded in traces as `seg`. It only labels the timeline and doesn't decide Provider requests: each request carries up to `translationBatchLimit` upcoming captions within `packSpanSeconds` of video, whichever segments they belong to.
