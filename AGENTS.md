# OpenAI Translate Chrome Extension

## Non-negotiables

- Any prose surface → the unslop skill. Your reply is a prose surface. Write it per Writing the reply.
- Before commit → the deslop skill

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: fix(web): new threads no longer spike CPU.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before/after images. Motion or timing needs a short video.

## Test

When the user asks for a real-browser check with the chrome-debug skill, report these metrics for each build under test. Measure on an uncached video segment at 1x playback with the tab visible; a trace whose end line says `throttled` does not count.

- Steady translating share: the share of subtitle time spent showing the loading placeholder during at least 180 s of uninterrupted playback, computed from the trace stats as `states.loading / (states.loading + states.ready)`.
- Seek landing first-caption wait: the video seconds from the seek landing until the first caption on screen shows its translation, computed as `firstReadyAt - firstCaptionAt` from a 45 s trace started at the landing point. Confirm the video is at the landing point before tracing; YouTube may resume at the last watched position.
- Post-seek 45 s translating share: the same share as the steady metric, computed from that 45 s landing trace.

## Glossary

### Sentence

A sentence is one cue in the source subtitle timeline. YouTube timelines and HBO and X WebVTT timelines first rejoin cues and split them at sentence-ending punctuation; overlapping HBO and X cues retain their original intervals. Sentences over 80 display columns are flagged for the Provider to split, except DOM-only or overlapping subtitles; the extension never splits them locally.

### Caption

An input caption is a whole sentence. An input over 80 display columns is split and translated into display captions by the Provider in the same request. No caption shows its source before its translation is ready; Provider-split captions then show matching source and translation together at times computed by the extension.

### Segment

A segment contains up to four consecutive input captions, one per sentence, sent in one Provider request; segments are numbered from zero. Each result maps to an input ID and may contain multiple display captions, so the limit applies before Provider splitting.
