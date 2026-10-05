# OpenAI Translate Chrome Extension

- When debugging or verifying, prefer the local Chrome browser. On macOS, Chrome is located at `/Applications/Google Chrome.app`.
- Run `npm run verify` for the same checks used in CI. Install its isolated test browser with `npx playwright install chromium`; real-site acceptance can reuse the user's logged-in Chrome profile.
- Any prose surface → the unslop skill. Your reply is a prose surface. Write it per Writing the reply.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: fix(web): new threads no longer spike CPU.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before/after images. Motion or timing needs a short video.

## Glossary

### Sentence

A sentence is one cue in the source subtitle timeline. YouTube and HBO WebVTT timelines first rejoin cues and split them at sentence-ending punctuation; overlapping HBO cues retain their original intervals. Sentences over 80 display columns are split locally at commas, except DOM-only or overlapping subtitles.

### Caption

An input caption is a whole sentence or one locally split part. An input still over 80 display columns is split and translated into display captions by the Provider in the same request. Provider-split captions appear only when ready, with matching source and translation shown together at times computed by the extension.

### Segment

A segment contains up to ten consecutive input captions sent in one Provider request; segments are numbered from zero. Each result maps to an input ID and may contain multiple display captions, so the limit applies before Provider splitting. A sentence moves to the next segment if it does not fit; only a sentence with more than ten input captions spans segments.
