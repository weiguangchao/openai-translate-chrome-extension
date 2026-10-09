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

## Test

In a real-browser check, report the metrics below for each build at 1x, 1.25x, 1.5x and 2x. For each build and rate, seek once to a segment with no cached translations, trace 45 s from the landing point, then keep playing and trace 180 s. Durations are video seconds.

A run counts only if its traces report the tested `playbackRate`, none is marked `throttled` (keep Chrome in front), and the landing trace starts at the seek target; YouTube may resume at the last watched position instead.

- Loading while playing: the share of subtitle time that shows the loading placeholder instead of a translation, from the 180 s trace: `states.loading / (states.loading + states.ready)`.
- Wait after seeking: the seconds a viewer waits after the seek until the first subtitle on screen shows its translation, from the 45 s trace: `(firstReadyAt - firstCaptionAt) / playbackRate`.
- Loading after seeking: the same share as Loading while playing, from the 45 s trace.

## Glossary

### Sentence

A sentence is one cue in the source subtitle timeline. YouTube timelines and HBO and X WebVTT timelines first rejoin cues and split them at sentence-ending punctuation; overlapping HBO and X cues retain their original intervals. Sentences over 80 display columns are flagged for the Provider to split, except DOM-only or overlapping subtitles; the extension never splits them locally.

### Caption

An input caption is a whole sentence. An input over 80 display columns is split and translated into display captions by the Provider in the same request. No caption shows its source before its translation is ready; Provider-split captions then show matching source and translation together at times computed by the extension.

### Segment

A segment contains up to four consecutive input captions, one per sentence, sent in one Provider request; segments are numbered from zero. Each result maps to an input ID and may contain multiple display captions, so the limit applies before Provider splitting.
