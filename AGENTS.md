# OpenAI Translate Chrome Extension

## Principle

- Any prose surface → the unslop skill. Your reply is a prose surface. Write it per Writing the reply.
- Before commit → the deslop skill
- When the user asks for a real-browser check → the chrome-debug skill

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: fix(web): new threads no longer spike CPU.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before/after images.

## Verifying

In a real-browser check, report the metrics below for each build on YouTube, HBO Max and X at 1x, 1.25x, 1.5x and 2x. Each run reloads Subline so no translation is cached, opens the video, sets the rate and traces 45 s with `"since": "open"`. It then seeks once into a segment with no cached translations, away from where the opening trace played, traces 45 s with `"since": "seek"` for the landing trace, then keeps playing and traces 180 s; durations are video seconds. Use an X video long enough for all three traces, such as the one in the chrome-debug smoke checks.

A run counts only if its traces report the tested `playbackRate` and none is marked `throttled` (keep Chrome in front). The landing trace fails by itself when the video leaves the seek target.

- Wait after opening: the seconds a viewer waits after opening the video until the first subtitle on screen shows its translation, from the opening trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Wait after seeking: the seconds a viewer waits after the seek until the first subtitle on screen shows its translation, from the landing trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Loading while playing: the share of subtitle time that shows the loading placeholder instead of a translation, from the 180 s trace: `states.loading / (states.loading + states.ready)`.
- Loading after seeking: the same share as Loading while playing, from the landing trace.

## Glossary

### Sentence

A sentence is one cue in the source subtitle timeline. YouTube timelines and HBO and X WebVTT timelines first rejoin cues and split them at the source language's sentence-ending punctuation; overlapping HBO and X cues retain their original intervals. A rejoined sentence still over 240 display columns is cut into sentences of at most 240 columns, between cues or at clause punctuation first, then between words. Sentences over 80 display columns are split locally, except DOM-only or overlapping subtitles. The Provider never splits them.

### Caption

An input caption is a whole sentence. The source language's segmenter in `src/shared/segmenter` splits an input over 80 display columns into display captions: at clause punctuation first, then between words inside a clause that is still over 80 columns. The Provider translates each display caption of an input in the same request. No caption shows its source before its translation is ready; display captions then show matching source and translation together at times computed by the extension.

### Segment

A segment contains up to four consecutive input captions, one per sentence, sent in one Provider request; segments are numbered from zero. Each result maps to an input ID and may contain multiple display captions, so the limit applies before line splitting.
