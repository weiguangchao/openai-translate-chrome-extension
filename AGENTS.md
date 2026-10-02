# OpenAI Translate Chrome Extension

- When debugging or verifying, prefer the local Chrome browser. On macOS, Chrome is located at `/Applications/Google Chrome.app`.

## Glossary

### Sentence

A sentence is a unit of subtitle text produced by splitting the captions. Multiple sentences can be combined into a segment and sent to the Provider for translation in one request. Sentences are numbered starting from zero and increase sequentially.

### Segment

A segment is up to ten consecutive source sentences sent to the Provider in one request. The Provider returns one translation per sentence, in order. Segments are numbered starting from zero and increase sequentially.
