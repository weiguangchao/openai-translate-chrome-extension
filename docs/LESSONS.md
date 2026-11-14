# Lessons

These lessons cover Subline's caption translation, playback, settings, and tooling. Each entry names its automated checks or manual review requirements.

## Update rules

- When the developer corrects a mistake or merged work exposes a regression, fix it and add or update its lesson in the same change.
- Give each lesson a short heading naming the failure. Below it, state the rule that would have caught it and name the enforcing code, test, lint rule, or manual check.
- Verify behavior against the current implementation and relevant tests before describing it as enforced. State the scope of automated checks and identify requirements that still need manual review.
- Update an existing lesson when it covers the same failure. Merge duplicates and remove lessons whose rules no longer apply.
- If a mistake repeats despite an existing lesson and only judgment enforces its rule, add an automated check in the same change.
- Describe verified failures. Do not invent incident details, dates, or PR references.
- After an update, run `node scripts/check-docs.mjs` and manually confirm that Markdown links, skill references, and the named checks still resolve.

## Recorded lessons

### Invalid Provider responses

Each Provider request sends up to `translationBatchLimit` captions. OpenAI uses the plugin translation instructions with the page title and the multi-item ID protocol. Microsoft sends a string array and maps results by array order. Each input returns exactly one translation, including text that should remain unchanged.

An OpenAI reply may end with one echoed `[[source_end]]` line, and a reply to a single caption may omit its ID line. Missing or duplicate OpenAI IDs, mismatched counts, and empty or oversized translations fail the batch without a retry. OpenAI does not detect the language of the returned text. Microsoft also requires each result's `to` field to match the requested target language.

Enforced by `src/shared/api.ts`, `src/shared/provider/openai.ts`, `src/shared/provider/microsoft.ts`, `tests/provider-responses.test.ts`, and `tests/microsoft-provider.test.ts`.

### Cache collisions across page titles

The page title, without its notification count or site suffix, is part of the translation cache key. Identical captions on differently titled pages translate separately.

Enforced by `pageTitle` in `src/core/platform.ts`, `translationIdentity` in `src/shared/settings.ts`, `tests/background.test.ts`, `tests/x.test.ts`, and `tests/youtube.test.ts`.

### Failure state inferred from strings

A failure reaches the page as a `TranslateFailure` kind. Nothing decides state by comparing a message, `textContent`, or a class name.

Enforced by the `Reply` type in `src/shared/messages.ts` and ESLint `local/typed-outcomes`.

### Caption state owned by the overlay

`CaptionTranslator` owns what each caption shows. The overlay only renders it.

Enforced by ESLint `local/write-only-overlay`, exhaustive `TranslationLine` switches, and `tests/controller.test.ts`.

### Inconsistent subtitle errors

Every visible subtitle error uses the Provider 500 presentation: yellow text at the configured translation size, the subtitle background and position, no source caption, and no Subline prefix.

Enforced by `src/core/overlay.ts`, `tests/controller.test.ts`, `e2e/provider.spec.ts`, and `e2e/caption-sources.spec.ts`.

### Incorrect source-language selection

Subtitle language comes from the selected video caption track, never a saved setting. Settings choose only the translation language.

English, Simplified Chinese, Traditional Chinese, Japanese, and Korean are supported. Other languages show `原文语言不支持` without Provider traffic. A track already in the translation language shows its captions alone, without Provider traffic.

Enforced by `src/shared/languages.ts`, `tests/youtube.test.ts`, `tests/controller.test.ts`, and `e2e/caption-sources.spec.ts`.

### Unclear setting invalidation

Every setting has one scope. That scope decides what changing it invalidates and whether it belongs in the translation cache key.

Enforced by `SETTING_SCOPES` in `src/shared/settings.ts` and `tests/settings-scope.test.ts`.

### Scattered tuning values

Shared playback planning, batching, send-rate, deadline, and subtitle sizing parameters live in `src/shared/tuning.ts`. Some existing inline values and allowlisted constants remain outside that file, including DOM-caption debounce, Provider error backoff, and translation cache capacity.

ESLint `local/tuning-home` checks top-level numeric constants outside `src/shared/tuning.ts`, with explicit exceptions. It does not detect every inline number. Review new playback and Provider parameters manually as well.

### Unrequested configuration changes

A new tuning value, caption failure kind, or test runner setting needs a `Requested-by:` line in its commit message.

`scripts/check-policy.mjs` inspects commits for new tuning names exported from `src/shared/tuning.ts`, new failure kinds in `src/shared/provider-error.ts`, and added or changed `testTimeout`, `hookTimeout`, or `maxWorkers` entries in `vite.config.ts`. It runs in `npm run check` and does not inspect uncommitted changes. Other test runner settings require manual review.

### Provider requests bypassing transport

Provider HTTP goes through `src/shared/provider/transport.ts`.

Enforced by ESLint `local/provider-transport` over `src/shared`, `src/extension`, and `src/ui`.

### OpenAI compatibility retries

OpenAI translation requests omit `reasoning_effort` and send `temperature: 0` and `thinking: { type: "disabled" }`. Translation HTTP errors return without compatibility retries or remembered parameter rejections.

Enforced by `src/shared/provider/openai.ts` and `tests/api.test.ts`.

### Rate slots released by aborts

A sent Provider POST is recorded for `providerSendWindowMs`. Aborting it does not remove that record. Requests detached by a seek stop contributing to the send count through their request policy, even while their HTTP requests finish.

Implemented in `src/shared/provider/transport.ts` and `src/extension/queue.ts`. Covered by `tests/provider-transport.test.ts`, `tests/queue.test.ts`, and `tests/prefetch.test.ts`.

### Providers blocking each other's sends

POST send windows are keyed by URL origin. Requests to the same origin share the `translationSendsPerSecond` budget, including connection tests. GET requests do not consume that POST budget.

OpenAI and Microsoft have independent windows when their origins differ. A full OpenAI window then does not delay a Microsoft send, so the visible caption can take the Microsoft translation while OpenAI is still waiting.

Enforced by `src/shared/provider/transport.ts`, `tests/provider-transport.test.ts`, and `tests/background.test.ts`.

### Sent work discarded after seeking

A seek drops unsent work and detaches obsolete sent work. Detached requests finish without counting toward `translationSendsPerSecond`. OpenAI results and translations made while Microsoft is the selected provider enter the cache.

Microsoft results produced as fallback while OpenAI is selected use temporary session entries. They are reused only within the current prefetch window and removed when that window leaves. Results arriving after their window has left are not retained.

Enforced by `src/extension/queue.ts`, `tests/prefetch.test.ts`, `tests/queue.test.ts`, and `tests/background.test.ts`.

### Completed translations retained in memory

Translation text is cached only in `chrome.storage.session`. Queues keep pending work and playback state. They never retain completed translations in an in-memory cache.

Enforced by `src/extension/translation-store.ts`, `tests/queue.test.ts`, and `tests/background.test.ts`.

### Failed captions requested again

A failed caption is not automatically retried. Its failure is retained while it remains the current caption or belongs to a prefetch window. Leaving those windows clears the failure marker, so a later visit can request it again.

Enforced by `src/extension/queue.ts`, `tests/queue.test.ts`, `tests/captions.test.ts`, and `e2e/provider.spec.ts`.

### Insecure Provider origins

Provider requests leave the computer only over HTTPS. Plain HTTP goes only to `localhost` or `127.0.0.1`.

Enforced by `validateBaseUrl` in `src/shared/settings.ts`, `optional_host_permissions` in `public/manifest.json`, and `tests/api.test.ts`.

### Plaintext API-key storage

The API key reaches `chrome.storage` only encrypted under the device key.

Enforced by `saveSettings` in `src/shared/storage.ts`, ESLint `local/storage-writers`, and `tests/settings-storage.test.ts`.

### Captions sent without consent

No caption reaches the Provider until the user has agreed, on the settings page, to send captions to that Provider's origin. Saving OpenAI settings that include Microsoft consent also requests host access to `https://edge.microsoft.com`.

Enforced by the `hasProviderConsent` check in `src/extension/background.ts`, `allowApiHost` in `src/shared/storage.ts`, `tests/background.test.ts`, and `tests/settings-storage.test.ts`.

### Caption queues bypassing batch translation

Caption queues call `translateCaptionBatch`, never `translate`.

Enforced by ESLint `no-restricted-imports` over `src/extension`, except `src/extension/background.ts`.

### Dependency boundaries crossed

Cross-layer imports point from platform adapters to core or shared, and from core, extension, or UI to shared. Platforms never import each other.

Enforced by ESLint `local/dependency-boundaries` and `tests/dependency-boundaries.test.ts`.

### Duplicated UI text

Keep UI copy reused across pages in `src/ui/copy.ts`.

`scripts/check-ui-copy.mjs` scans TypeScript and TSX files in `src/ui`, excluding `src/ui/copy.ts`, for duplicate text containing Chinese characters. It runs in `npm run check`. English-only copy requires manual review.

### Comments in TypeScript

TypeScript has no comments.

Enforced by ESLint `local/no-comments`.

### Tests running without type checks

The default Vitest run includes a `types` project that type-checks every formal test in `tests`. Direct Playwright runs do not add a type-checking step. `npm run check` and the build commands run `tsc`, whose project includes the E2E files.

Run verification with the Node version specified in `.nvmrc`. The storage test fixture uses Node's Web Locks API.

Enforced by `vite.config.ts`, `tsconfig.json`, `package.json`, `scripts/check-test-discovery.mjs`, and `tests/fixtures/extension-storage.ts`.

### Local and CI checks diverging

CI runs `npm run verify`, the same command used for a full local verification. CI skips end-to-end tests tagged `@local` and gives Vitest and Playwright more workers. A local run executes each test runner with one worker.

The commands and runner settings are defined in `.github/workflows/verify.yml`, `package.json`, `playwright.config.ts`, and `vite.config.ts`. `npm run test:discovery` checks Vitest collection and type-checking coverage. Review each `@local` exclusion to keep its behavior covered by a unit test or a YouTube equivalent that runs on CI.

### Stale documentation references

Keep references in AGENTS.md and this document valid. The AGENTS.md glossary names constants instead of copying their values.

`scripts/check-docs.mjs` checks recognized file paths, lint rule names, and identifiers inside backticks, plus copied numeric values in the glossary. It runs in `npm run check`. Markdown links and skill references require manual verification.

### Tests asserting the wrong contract

Each test contract has one primary owner. Expected values come from the contract, and rejection cases reach the guard they claim to test.

This is a manual review requirement.

### Unrequested fallback behavior

Do not add a fallback, alternate format, retry, cap, or cache the request did not ask for. Propose it instead.

This is a manual review requirement. `scripts/check-policy.mjs` checks commit metadata for the specific tuning values, failure kinds, and test runner settings described above.

### Unrequested browser measurements

Attach a real-browser measurement to a tuning change only when the developer asks for one.

This is a manual workflow requirement.

### Timeouts hidden by longer limits

End-to-end tests run in real time. When one times out on this machine, report it in the notes. Do not raise its timeout.

This is a manual workflow requirement.

### Explanatory text added to settings controls

Keep settings controls focused on their label and control. The current Base URL field includes inline help, and the popup includes setup and consent hints. These are existing exceptions to the preference against secondary explanatory text. Links use icons or quiet underlined text.

Implemented in `src/ui/App.tsx`, `src/ui/Popup.tsx`, and `src/ui/styles.css`. Changes to explanatory text and link styling require manual review.

### Incorrect About-page link styling

The About page's GitHub and X links are borderless, and the author's profile link uses the X logo.

Implemented in `src/ui/App.tsx` and `src/ui/styles.css`. Visual conformance requires manual review.

### Known verification gaps left open

When you name a gap you could close, such as failing tests or a check you skipped, close it before you stop.

This is a manual workflow requirement.

### Chromium commands targeting the wrong session

Chromium debug commands require an explicit launch session or existing-browser endpoint. Headless sessions never fall back to personal Chrome or activate its native UI. Mismatched or stopped launches cannot receive page operations.

Enforced by `tests/debug-chromium/test_rules.py` and `tests/setup-headless-chromium/test_headless.py`.

### Icons unreadable at small sizes

Packaged icons use smooth curves and readable small-size counters. The 128 px icon keeps the main D1 drawing. UI SVG uses optical spacing.

`scripts/build-icons.mjs` rejects hard-edge modes for packaged icons. `scripts/check-icons.mjs` checks dimensions, selected miniature and UI gaps, and opaque cores. The source and review requirements are documented in `assets/icons/README.md`.

Review both palettes manually at native resolution and in separate DPR 1 and DPR 2 captures.
