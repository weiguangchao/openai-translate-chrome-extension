# Product features

This document describes Subline's implemented behavior based on the current code. See the [project README](../../README.md) for installation and build instructions. When a feature changes, update its description and check the source references listed with it.

## Supported platforms

Subline displays source captions and translations in YouTube and X video players. It requires Chrome 120 or later.

The extension runs on `www.youtube.com`, `m.youtube.com`, `x.com`, and `twitter.com`. On YouTube, it reads the selected caption track, including existing authored and automatic captions. Captions must be enabled in the player. Subline captions are hidden when YouTube captions are off or an advertisement is playing.

On X, Subline reads subtitle files from the selected player track or captions from an existing browser text track. When several videos are present, it prefers visible videos that are playing, then compares their visible areas. In fullscreen mode, it considers only videos inside the fullscreen element.

On YouTube, advertisements and turning captions off preserve the downloaded track for reuse after the same video, track, and language are selected again. New subtitle request credentials trigger an immediate source check; periodic checks still discover other player changes.

Translation requires existing caption text. Subline does not transcribe audio. It waits when no captions are available. If caption text is available but its language cannot be recognized, it shows an unsupported-language message.

Source references: [extension manifest](../../public/manifest.json), [YouTube caption source](../../src/platforms/youtube/page.ts), [YouTube caption visibility](../../src/platforms/youtube/player.ts), [X platform adapter](../../src/platforms/x/platform.ts), and [X video selection](../../src/platforms/x/player.ts).

## First use and defaults

Open settings from the extension popup, choose a translation service and target language, accept the service's data-use consent, and save. Grant access when Chrome requests permission to connect to the translation service.

Microsoft Translate is selected by default, with Simplified Chinese as the target language. The global caption switch and the YouTube and X switches start enabled. Bilingual display is the default. Video captions are not sent until the user gives consent, even when these switches are on.

Existing OpenAI endpoint, API key, and model settings from earlier versions are preserved and continue to be recognized as an OpenAI configuration.

Source references: [defaults and legacy settings](../../src/shared/settings.ts), [settings and consent controls](../../src/ui/App.tsx), and [caption request requirements](../../src/extension/background.ts).

## Caption languages

The source language comes from the video's selected caption track. The language selected in Subline is the target language.

Both source and target languages support:

- English.
- Simplified Chinese.
- Traditional Chinese.
- Japanese.
- Korean.

Unsupported source languages show "Unsupported subtitle language" without translation requests. When the source and target languages match, Subline shows only the source captions and makes no translation requests.

Source references: [language definitions](../../src/shared/languages.ts), [caption language detection](../../src/core/controller.ts), and [same-language display](../../src/core/translator.ts).

## Caption organization and display

### Bilingual and translation-only display

Bilingual mode places the source text above its translation. Selecting "Translation only" in the popup or settings hides the source text. When the source and target languages match, the source text is still shown.

For captions that need translation, the source appears together with the completed translation. While waiting, Subline may show "Translating" instead of showing the source alone. Captions appear near the bottom of the player. The configured font sizes and line spacing are the largest they get: in players narrower than 640 px they shrink with the player's width, and font sizes stop shrinking at 14 px, or at the configured size if that is smaller.

If a YouTube caption track cannot be read or its download fails, Subline restores the website's selected captions and reports the source problem in the popup. This recovery also applies in Translation only mode. Normal source loading and waiting for a translation keep the existing display behavior. Successful source recovery returns to Subline captions; turning website captions off or playing an advertisement still hides Subline captions.

### Caption boundaries

Downloaded captions and loaded native text-track captions are organized into display units using language boundaries, pauses, and source timing. Longer English, Chinese, and Japanese sentences are split using phrase and source cue boundaries, with word boundaries used within longer spans. Japanese word splitting covers mixed kanji, hiragana, and katakana text, including captions without punctuation. Lyrics and sound tags can stand alone, while overlapping source cues stay whole.

Korean captions can be translated, but do not use language-specific sentence and long-sentence splitting logic. In X's live caption fallback, the currently active text is read and kept whole.

Each display unit is sent as an independent translation input. The extension chooses the caption boundaries.

Source references: [caption organization](../../src/core/sentences.ts), [native text-track processing](../../src/core/native.ts), [X live caption reading](../../src/platforms/x/player.ts), [language segmenter selection](../../src/shared/segmenter/index.ts), [display state](../../src/core/translator.ts), and [caption rendering](../../src/core/overlay.ts).

## Playback, pause, and seeking

During playback, Subline translates upcoming captions in advance and prioritizes the caption currently needed on screen. Prefetch planning considers video time, playback speed, and recent service response times.

Pausing lets requests already sent finish, while new caption translation requests wait. Caption display checks for existing results during a pause. If no result is available, a new request waits until playback resumes.

The delay before showing "Translating" counts only time when the video is not paused. Resuming continues the remaining delay; a pause does not add another delay once it has already elapsed. Buffering while the player is not paused still counts. Existing translations remain displayed, and captions that arrive during a pause can still be checked against the cache.

Seeking cancels obsolete work that has not been sent. Requests already sent remain reusable until they finish, including when seeking back to an earlier position. Each sent request continues to count toward the service origin's send limit. A landing caption that needs a new request takes priority when the next send slot opens. Results for old captions do not replace the caption displayed at the new position.

Changing the video, caption source, source language, or translation configuration makes Subline match the current captions to their translation tasks again. Saved settings are sent to supported video pages that are already open.

Source references: [playback events](../../src/core/controller.ts), [prefetch planning](../../src/shared/playback-plan.ts), [caption request state](../../src/core/translator.ts), [translation queues](../../src/extension/queue.ts), and [settings notifications](../../src/extension/background.ts).

## Translation services

### Microsoft Translate

Microsoft Translate requires no API key or model. The user must still agree to send captions to Microsoft and grant the required site access.

Requests send source captions, the source language, and the target language to `edge.microsoft.com`. Results in a batch correspond to captions in input order.

Source references: [Microsoft translation requests](../../src/shared/provider/microsoft.ts) and [permission requests](../../src/shared/storage.ts).

### OpenAI-compatible services

Selecting OpenAI Chat Completions requires a Base URL, API Key, and Model ID. The service must support Chat Completions requests for text translation.

The Base URL includes any version path required by the service, such as `https://api.openai.com/v1`, without `/chat/completions` or `/models`. HTTPS is required except for HTTP services on `localhost` or `127.0.0.1`.

Translation requests carry caption text, the target language, the selected model, and the API key. The page title is sent as translation context after its notification count and site suffix have been removed.

Source references: [endpoint and settings validation](../../src/shared/settings.ts), [OpenAI requests and context](../../src/shared/provider/openai.ts), and [page title normalization](../../src/core/platform.ts).

### Temporary Microsoft translations

When OpenAI is selected, the user can also enable "I agree to send subtitle text to Microsoft for temporary translations". Saving this setting requests site access for Microsoft as well.

Subline can then request translations from OpenAI and Microsoft at the same time. The first valid result can supply the current caption. OpenAI continues its work. Once OpenAI has translated every caption in the current prefetch window, further Microsoft prefetch requests stop until seeking allows them again for the new position.

Resuming playback can request one temporary Microsoft translation for the current caption when it still lacks a result, even if Microsoft prefetch has stopped. This first checks the cache and reuses pending work. It leaves the OpenAI request running and does not restart Microsoft prefetch for upcoming captions. Each displayed caption attempts this recovery once; pauses suspend unsent recovery work. Leaving the caption, changing its source or configuration, or finishing the caption closes the recovery subscription. A later failure cannot replace an already displayed translation.

Temporary Microsoft requests require the additional consent and current host access. Revoking access cancels unsent temporary requests without stopping OpenAI. If the supplemental channel ends, the original request can still complete. An original failure waits for supplemental work only after that work has actually been sent, and the existing Provider deadline also bounds its remaining storage wait.

Temporary Microsoft translations are reused only within the current prefetch window and are removed when that window leaves. OpenAI results enter its session cache. Without the additional Microsoft consent, only the selected OpenAI service is used.

Source references: [temporary translation consent](../../src/ui/App.tsx), [consent checks](../../src/extension/background.ts), [recovery subscriptions](../../src/extension/recovery.ts), [Microsoft host access](../../src/extension/microsoft-access.ts), [parallel requests and stop conditions](../../src/extension/queue.ts), and [temporary storage](../../src/extension/translation-store.ts).

## Model lists and connection tests

OpenAI model IDs can be entered manually or selected from a list after clicking "Fetch models". Successfully fetched lists are cached locally by endpoint and API key. Changing the endpoint or key loads the corresponding cache.

"Test connection" sends fixed sample text using the current draft settings. Fetching models and testing a connection contact the service immediately, without first saving settings or reading captions from the current video.

The settings page shows the connection test status for the current session. Changing the service, endpoint, key, or model requires a new test for that configuration. Settings must still be saved after a successful test before video pages use the changes.

Source references: [model and test controls](../../src/ui/App.tsx), [model list requests](../../src/shared/provider/openai.ts), [model cache and test entry point](../../src/shared/storage.ts), and [background connection tests](../../src/extension/background.ts).

## Translation cache and replay

Completed translations are stored in browser session storage for replay or reuse by other pages. They remain available after the extension's background worker restarts. The cache has a capacity limit and evicts older entries.

Translations that arrive together share a storage write and index update. Each result is delivered after its write finishes, without waiting for another network response or a full batch. Temporary translation cleanup retains its order relative to saves.

Cache entries distinguish the translation service, endpoint, model, source language, target language, page title, and caption text. Identical captions on differently titled pages are translated separately. Changing colors, font sizes, spacing, or display mode does not change a translation's cache identity.

Translations made while Microsoft is selected enter the Microsoft session cache. With OpenAI selected, temporary Microsoft results follow the window rules above, while OpenAI results enter the OpenAI session cache.

Source references: [cache identity](../../src/shared/settings.ts), [translation storage](../../src/extension/translation-store.ts), and [cache lookup and window cleanup](../../src/extension/queue.ts).

## Popup and switches

The extension popup provides controls to:

- Enable or disable subtitles.
- Change the target language.
- Choose Bilingual or Translation only display.
- Open the full settings page.
- Expand the current service or model and token usage details.

Popup changes are saved immediately, with saving and saved feedback in the header. Keyboard focus returns to the edited control after saving unless the user has focused another control. Setup and consent guidance appears with the page status and opens Translation service. It reuses an existing settings tab, preserves its unsaved draft, and brings that window forward. The global caption switch applies to all supported sites. Separate YouTube and X switches are available on the full settings page and apply to pages on the corresponding site.

Quick controls stay disabled while popup settings load. A read failure ends the loading state and keeps editing disabled, shows an error asking the user to reopen the extension, and leaves the settings button available.

The popup tracks the active tab's caption status, including disabled, disabled for this site, awaiting configuration, caption data consent needed, no active video, waiting for captions, translating, bilingual, translation-only, original, failed, and unsupported language. It distinguishes a failed YouTube caption download from an unavailable selected track and reports that website captions have been restored. Missing player metadata or a video without captions continues to show waiting. When it cannot connect to the page, it reports that the page is unsupported or its status is unavailable.

Source references: [popup controls and page status](../../src/ui/Popup.tsx), [page status definitions](../../src/shared/messages.ts), and [status notifications](../../src/core/content.ts).

## Subtitle style

The full settings page provides separate source and translation colors and font sizes, plus preset color buttons. Font sizes range from 12 to 48 px, line spacing from 0 to 24 px, and background opacity from 0% to 90%. The background covers the whole subtitle area.

Both text colors default to white. The source font size defaults to 24 px, the translation font size to 22 px, line spacing to 6 px, and background opacity to 45%. During playback, font sizes and line spacing shrink in narrow players but never grow past the configured values.

The style preview follows the current edits and supports switching samples and an expanded view. Both previews grow to keep the sample captions complete at large font sizes. The expanded view scrolls when needed in a short window. "Reset style" restores colors, font sizes, spacing, and background without resetting the translation service or language. Previewed and reset styles must be saved before they apply to video pages.

Source references: [style controls](../../src/ui/App.tsx), [style defaults](../../src/shared/settings.ts), [preview components](../../src/ui/components.tsx), and [player subtitle styling](../../src/core/overlay.ts).

## Saving settings

Settings use a sidebar with General, Translation service, Subtitle style, and About; navigation moves above the content in smaller windows and scrolls away at phone widths while the heading and save actions stay visible. General groups caption controls, display mode, per-site switches, and the interface language, with a shortcut showing the selected translation service and whether setup is needed. Incomplete setup appears first with a highlighted action. Translation service has direct choices for Microsoft Translate and an OpenAI-compatible API, alongside configuration, data consent, and connection testing. Navigation supports URL fragments and browser Back and Forward without discarding edits. The popup setup action opens Translation service directly. On the settings page, display-mode choices include a visual example of the source and translation lines; the popup shows them as a compact two-option switch. The save button and draft actions stay visible while scrolling, including on About when there are unsaved edits. Discard changes restores the last saved settings across all sections. The subtitle preview precedes the style controls in keyboard navigation and appears above them on narrow windows.

While settings load, the page shows a loading indicator. If loading fails, it keeps an error message and a Retry button visible. Controls appear after settings are successfully read, so failed reads do not present default values as saved settings.

Changes on the full settings page require "Save changes". If saving or a service action finds an invalid Base URL, the page opens Translation service, focuses the field, and keeps the draft and its inline error visible for correction without a duplicate notification. Leaving with unsaved edits triggers the browser's leave confirmation. Saved settings are stored locally and sent to open video pages.

Style changes preserve ongoing translations. Changing the service, endpoint, model, key, or target language recreates translation tasks. Disabling captions, disabling a site, or withdrawing consent for the current service stops the corresponding translation work.

Source references: [settings editing and saving](../../src/ui/App.tsx), [local persistence](../../src/shared/storage.ts), [settings change classification](../../src/shared/settings.ts), and [task updates](../../src/extension/background.ts).

## Token usage

The popup's "Model and usage" section shows cumulative input, output, and cache token counts, plus a total of input and output. Large numbers use a compact format, with exact values available on hover.

Statistics come from usage fields in OpenAI-compatible responses, including translation and connection test requests that return usage. The cache count adds the cache read and cache write tokens the provider reports. Unrecognized or absent usage fields do not increase the corresponding counts.

Counts are stored locally and retained across model or service changes. Selecting Microsoft still shows previously accumulated usage. Microsoft translation requests do not add to these OpenAI usage counts.

Source references: [usage parsing, accumulation, and storage](../../src/shared/token-usage.ts), [OpenAI response usage](../../src/shared/provider/openai.ts), and [popup display](../../src/ui/Popup.tsx).

## Waiting and error messages

While waiting for a response, the subtitle area may show "Translating". A timeout shows "Request timed out". HTTP errors and invalid responses show the corresponding error message.

Visible errors use yellow text with the configured translation font size, subtitle background, and position. The source text is hidden. Failed captions are not automatically retried within the same prefetch window. They can be requested again when encountered after leaving the window. Some service errors also delay subsequent requests.

The popup provides setup guidance when configuration or caption consent is missing. Settings saves, model fetches, and connection tests report their results through notifications at the bottom of the settings window. Invalid Base URLs use the persistent inline field error.

Source references: [caption state](../../src/core/translator.ts), [error rendering](../../src/core/overlay.ts), [failure tracking and subsequent requests](../../src/extension/queue.ts), and [settings notifications](../../src/ui/Alert.tsx).

## Data and privacy

Subline has no backend of its own. Translation requests go directly to the selected service. Microsoft may also receive captions when temporary Microsoft translations are enabled. OpenAI receives the page title as context, while Microsoft translation requests contain captions and language parameters.

Sending video captions requires consent for the corresponding service origin, which includes its scheme, hostname, and port. Switching to an origin without existing consent requires agreeing again and saving. Fetching models and testing connections also require Chrome's permission to access the service.

Settings, model lists, and token usage are stored locally. Translations use browser session storage. In the installed extension, the API key is encrypted at rest and excluded from public settings sent to video pages.

Source references: [service consent](../../src/shared/settings.ts), [caption request checks](../../src/extension/background.ts), [storage and permissions](../../src/shared/storage.ts), [API-key encryption](../../src/shared/api-key.ts), and [public settings](../../src/shared/settings.ts).

## Interface language, About, and browser preview

The interface language is Simplified Chinese, Traditional Chinese, English, or Japanese, chosen under General. When no interface language has been saved, it follows the browser: Traditional Chinese for Chinese locales written in Traditional script, such as `zh-TW` and `zh-HK`, Simplified Chinese for other Chinese locales, Japanese for `ja`, and English otherwise. The saved language applies after saving to the settings page, the popup, and the status and error text on video pages. The extension name and toolbar title come from Chrome's own language, not this setting. The About page describes the extension and links to its GitHub repository and the author's X profile. The installed extension also shows its version.

The browser preview supports editing settings and testing services. An inline notice on Translation service explains API-key handling. Its API key stays only on the current page and must be entered again after a refresh. The style preview uses built-in sample captions. Captions on video pages run through the installed extension.

Source references: [interface language](../../src/shared/i18n.ts), [About page](../../src/ui/App.tsx), [version and caption preview](../../src/ui/components.tsx), and [browser preview persistence](../../src/shared/storage.ts).
