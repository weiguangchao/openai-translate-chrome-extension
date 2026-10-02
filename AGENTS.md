# OpenAI Translate Chrome Extension

- When debugging or verifying, prefer the local Chrome browser. On macOS, Chrome is located at `/Applications/Google Chrome.app`.

## Glossary

### Sentence

A sentence is one cue of the source subtitle timeline; on YouTube, cues are first rejoined and cut at sentence-ending punctuation, so each one is a complete sentence. A sentence becomes one caption, or several when it is split at commas.

### Caption

A caption is the text shown on screen at one time and translated as one item: a whole sentence, or one comma-split part of a sentence wider than 90 display columns. Each caption has its own start and end time, and captions are numbered sequentially from zero.

### Segment

A segment is up to ten consecutive captions sent to the Provider in one request, which returns one translation per caption in order; segments are numbered sequentially from zero. A segment never ends inside a sentence: a sentence whose captions do not fit starts the next segment, so a segment may hold fewer than ten captions. Only a sentence with more than ten captions spans several segments.
