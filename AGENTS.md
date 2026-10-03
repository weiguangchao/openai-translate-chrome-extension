# OpenAI Translate Chrome Extension

- When debugging or verifying, prefer the local Chrome browser. On macOS, Chrome is located at `/Applications/Google Chrome.app`.

## Glossary

### Sentence

A sentence is one cue in the source subtitle timeline. YouTube and HBO WebVTT timelines first rejoin cues and split them at sentence-ending punctuation; overlapping HBO cues retain their original intervals. Sentences over 80 display columns are split locally at commas, except DOM-only or overlapping subtitles.

### Caption

An input caption is a whole sentence or one locally split part. An input still over 80 display columns is split and translated into display captions by the Provider in the same request. Provider-split captions appear only when ready, with matching source and translation shown together at times computed by the extension.

### Segment

A segment contains up to ten consecutive input captions sent in one Provider request; segments are numbered from zero. Each result maps to an input ID and may contain multiple display captions, so the limit applies before Provider splitting. A sentence moves to the next segment if it does not fit; only a sentence with more than ten input captions spans segments.
