# OpenAI Translate Chrome Extension

## Principle

- Any prose surface → the unslop skill. Your reply is a prose surface. Write it per Writing the reply.
- Before commit → the deslop skill
- When the user asks for a real-browser check → the chrome-debug skill

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: fix(web): new threads no longer spike CPU.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before/after images. Motion or timing needs a short video.

## Verifying

In a real-browser check, report the metrics below for each build on YouTube, HBO Max and X at 1x, 1.25x, 1.5x and 2x. Each run seeks once into a segment with no cached translations, traces 45 s from the landing point, then keeps playing and traces 180 s; durations are video seconds. Most X videos are too short for both traces, so use the X video in the chrome-debug smoke checks.

A run counts only if its traces report the tested `playbackRate`, none is marked `throttled` (keep Chrome in front), and the landing trace starts at the seek target rather than where YouTube or HBO Max last stopped.

- Loading while playing: the share of subtitle time that shows the loading placeholder instead of a translation, from the 180 s trace: `states.loading / (states.loading + states.ready)`.
- Wait after seeking: the seconds a viewer waits after the seek until the first subtitle on screen shows its translation, from the 45 s trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Loading after seeking: the same share as Loading while playing, from the 45 s trace.

## Glossary

### Sentence

A sentence is one cue in the source subtitle timeline. YouTube timelines and HBO and X WebVTT timelines first rejoin cues and split them at the source language's sentence-ending punctuation; overlapping HBO and X cues retain their original intervals. Sentences over 80 display columns are split locally, except DOM-only or overlapping subtitles. The Provider never splits them.

### Caption

An input caption is a whole sentence. The source language's segmenter in `src/shared/segmenter` splits an input over 80 display columns into display captions: at clause punctuation first, then between words inside a clause that is still over 80 columns. The Provider translates each display caption of an input in the same request. No caption shows its source before its translation is ready; display captions then show matching source and translation together at times computed by the extension.

### Segment

A segment contains up to four consecutive input captions, one per sentence, sent in one Provider request; segments are numbered from zero. Each result maps to an input ID and may contain multiple display captions, so the limit applies before line splitting.
