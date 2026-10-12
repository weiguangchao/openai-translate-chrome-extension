# Plugin test audit

The audit covers all plugin unit tests and packaged-extension tests at `6b1da64`. It follows the test-audit campaign sequence and uses git commits, PR descriptions and project T3 records to identify historical failures. Chrome-debug tooling has its own test subsystem and is outside this campaign.

## Baseline

`npm run verify` passed on `6b1da64`: lint, TypeScript, discovery, 29 unit files with 378 tests, build, and 53 packaged-extension tests in 5.6 minutes. The resumed thread had also passed the same suite on `bcfc9f5`. The intervening main change replaces logo assets and does not alter these contracts.

## History and test ownership

| Failure                                                                                                            | Evidence                                                                                                                    | Primary proof to preserve                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Provider results were assigned by position or the source text field was accepted as a translation.                 | `3ea3e23`, PR #40; October 11 T3 threads `fabaa538-919d-4395-a7dc-cf390b07d413` and `87b67a81-b7be-4d9e-be64-6ecb1af0f9e3`. | Provider response contract, plus queue retry/cache behavior.                                     |
| Draft JSON entered the cache before final JSON was selected.                                                       | `fd20dab`, `ff0fa5d`, PR #11.                                                                                               | Response parser and queue final-only persistence, packaged extension draft scenarios.            |
| Pausing canceled useful requests or resumed captions returned to loading.                                          | October 2 pause correction, October 5 thread `47e2e2ca-344c-4ee5-914c-109749437a78`; `a5c6e0c`, PR #7.                      | Queue finish-without-new-work and controller cached-resume lifecycle.                            |
| An old document's pause survived navigation in the same tab.                                                       | `1462efe`, PR #11; cross-site browser repro failed on the old build while same-site navigation passed.                      | Background document identity and packaged extension cross-site navigation.                       |
| Cached captions flashed loading and worker restart lost completed translations.                                    | `2d1ad2f`, PR #15; October 7 T3 thread `05ab845b-ede8-4551-aa88-a7efcf5a89a2`.                                              | Controller transition history and actual stopped-worker session-storage restoration.             |
| Timeout paused every later request and retried a caption already past playback.                                    | `2f2b63c`, PR #13; October 7 T3 thread `c3b88077-13a8-4a5e-ae85-c9bab0ee457e`.                                              | Queue timeout continuation and packaged worker actual timeout.                                   |
| Normal playback snapshots canceled useful requests, and the window failed to cover slow replies or playback speed. | `82524ed`, `0181cdf`, PR #27/#28; October 9 T3 thread `21caa5fc-fb17-4b03-8025-bed3c4d20518`.                               | Planner independent expected plans, queue preservation, browser slow-tail/scrub scenarios.       |
| Batch constants were copied into unrelated tests; source scans depended on retired scheduling vocabulary.          | `63bf1d5`, PR #26; October 8 T3 thread `1345073c-a9ef-4d29-b116-d01c81eca6e0`.                                              | Scheduling cases own constants; discovery still excludes experiments and assigns each file once. |
| Long HBO/X sentences joined lyrics and speech, delaying translations.                                              | `4eee53f`, PR #35; October 10 T3 thread `d8d5af7c-7215-4056-8414-54ab2e382f3a`.                                             | Sentence pauses/tags, balanced caption splits, downloaded platform timelines.                    |
| Style settings canceled model work and source state diverged from overlay state.                                   | `1cb11b3`, `4043624`, `836d8d2`, PR #5/#40; October 4 review.                                                               | Setting scope table, background cache revision and controller display state.                     |
| HBO source appeared before its downloaded timeline was ready.                                                      | `56ae620`, PR #11.                                                                                                          | Controller checking state and delayed manifest browser scenario.                                 |
| Formal tests accidentally collected local experiments.                                                             | October 4 review and `23c2812`; CI runs `npm run verify`.                                                                   | Executed discovery script and explicit environment projects.                                     |

## Audit decisions

The read-only ledgers cover 299 declarations. Table-driven declarations count once unless their rows need different decisions. These are audit counts, not the number of expanded test runs.

| Lane                 | Retain | Repair | Consolidate | Delete | Ledger                                                       |
| -------------------- | -----: | -----: | ----------: | -----: | ------------------------------------------------------------ |
| Provider and worker  |    101 |      7 |          11 |      0 | [119 declarations](2026-10-12-test-audit/provider-worker.md) |
| Caption and text     |     70 |      9 |           4 |      4 | [87 declarations](2026-10-12-test-audit/caption-text.md)     |
| Platform, UI and E2E |     83 |      6 |           2 |      2 | [93 declarations](2026-10-12-test-audit/platform-ui-e2e.md)  |

[Baseline file results and counts](2026-10-12-test-audit/baseline.json) record every in-scope unit file. Ledger locations refer to `6b1da64`, before moves. The ledgers are the discovery evidence; the final decisions below record deviations from their proposals.

The ledgers record every declaration, including table rows where decisions differ, and every removal's original purpose, actual failure detection, non-test caller, keeper, deletion, risk and validation. Locations refer to the baseline. Retained runtime, type, architecture, storage and browser contracts remain independent proof even when a lower-level test covers a related value.

| Retired or repaired layer                                           | Primary keeper and carried assertions                                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API response parsing and caption helper replays                     | `provider-responses.test.ts` owns strict ids, accepted peers, final JSON selection and publications. `background.test.ts` owns actual session restoration validation. |
| Mixed playback schedule suite                                       | `timeline.test.ts` owns intervals, independent overlap text and segment numbering. `playback.test.ts` owns seek settling. `queue.test.ts` owns request admission.     |
| Duplicate hand-written YouTube worker pipelines                     | YouTube parser and source-selection tests retain protocol proof. Packaged extension source tests retain actual worker delivery.                                       |
| HBO negative case whose failing target URL was never reached        | The retained configured/unconfigured source-selection table proves Provider admission and no target-track downloads.                                                  |
| Prefetch expectations generated by the planner under test           | Literal HTTP groups and source/translation pairs prove wiring independently.                                                                                          |
| Negative-only shared bridge proof                                   | `bridge.test.ts` accepts a valid reply before rejecting independent origin, source, id and malformed inputs.                                                          |
| CSS string assertion and incorrect cache-flash measurement interval | Existing packaged timeout checks computed color and font. Cache frame collection begins before seek.                                                                  |
| Mixed E2E spec                                                      | All 53 scenarios move into source, playback, Provider and worker lifecycle owners. `withPlayer` remains the common browser/profile/network helper.                    |

Production removes the unused `captionWindow` wrapper and combines translation-string validation through its existing validator. No settings, Provider protocol or retry policy changes are intended. Optional settings-suite moves and a shared React setup refactor were deferred because they add file churn without stronger proof.

## Preservation review

Three reviewers compared deleted baseline assertions with actual keepers across the other lanes. Their reports cover [Provider and worker](2026-10-12-test-audit/preservation-provider-worker.md), [caption and text](2026-10-12-test-audit/preservation-caption-text.md), and [platform, UI and E2E](2026-10-12-test-audit/preservation-platform-e2e.md).

The review found and resolved three issues. Two compatibility cases still referenced a moved fixture, so both now use the shared Provider response fixture. A missing-id row lacked the results wrapper and failed the wrong guard; it now supplies a valid wrapper. Segment expectations used the correct constant but both constants equaled four; the timeline dependency fixture now gives segmentCaptions and translationBatchLimit different values. No remaining deleted contract lost its proof.

The SPA fixture holds its opening reply until after navigation. It never has an old ready pair to clear, and an old route fulfilled after cancellation may not deliver a stale callback. Its frame interval provides a successful new-video control and replacement proof. It does not independently prove clearing an old ready pair or rejecting a delivered stale callback. The controller's controlled late-response keeper owns the latter contract.

Twenty-three serial mutations failed at their intended assertions. [Mutation inputs and commands](2026-10-12-test-audit/mutations.json) record each change. Source files were restored byte for byte after each run.

| Contract                            | Deliberate mutation                                                 | Observed failure                                                                              |
| ----------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Silence boundary                    | Move the stop beyond two seconds.                                   | The exactly-two-second input joins instead of splitting.                                      |
| Overlap exemption and text          | Split overlapping authored input; join active captions with spaces. | Both short and long overlapping rows change timing/text; timeline loses the newline.          |
| Punctuated ASR pause                | Omit automatic pause boundaries.                                    | The ASR row joins across its 1.2-second gap.                                                  |
| Caption width and language fallback | Admit one extra column; use Chinese rules for unknown languages.    | The 91-column English input stays whole; both fallback keys lose English sentence boundaries. |
| Seek settling and rate              | Release at 399 ms; force rate 1 in controller plans.                | Landing sends appear early; ratechange produces no new 1.5x plan.                             |
| Stale request slot                  | Skip a snapshot update when no new pack is planned.                 | A third, obsolete HTTP request sends after the surviving request completes.                   |
| Provider duration                   | Measure from queue creation.                                        | The expected 250 ms becomes 1250 ms.                                                          |
| Bridge admission                    | Remove origin, source or request-id checks separately.              | Only the corresponding rejection row calls changed twice.                                     |
| Scope completeness                  | Permit arbitrary string keys instead of every Settings key.         | The required missing-temperature diagnostic disappears.                                       |
| UI model persistence                | Skip saveCachedModels.                                              | The expected addressed save call is absent.                                                   |
| Exact token counts                  | Format with the German locale.                                      | Literal comma-grouped strings differ.                                                         |
| Segment independence                | Divide by translationBatchLimit.                                    | Labels disagree with the differing segmentCaptions fixture.                                   |
| Send-time deadline                  | Create the deadline before waiting for a send slot.                 | The fourth HTTP signal expires one second early.                                              |
| Stored strings                      | Remove maximum length; omit trimming.                               | Restart serves the oversized value or retains padding.                                        |
| Missing result id                   | Default a missing id to zero.                                       | The valid wrapped reply returns a translation rather than null.                               |
| Cached browser display              | Initialize each new caption as loading.                             | The measured cached-caption interval records 翻译中.                                          |
| Timeout browser style               | Change the warning to magenta.                                      | Computed color is rgb 255,0,204 rather than 255,204,0.                                        |

Changing only the splitter's <= comparison to < can preserve its output through the later optimizer. The width mutation therefore admits an extra column, which changes observable behavior. No product defect was reproduced on the passing baseline; the fixes above repair test evidence.

## Validation

`npm run verify` passed after all implementation, preservation and mutation work. It ran lint, TypeScript, discovery, 31 unit files with 367 tests, the production build, and all 53 packaged-extension tests. Playwright finished in 5.4 minutes with no failures or retries. The expanded E2E names and platform/draft rows match the baseline exactly.

The first cutover unit run exposed the two missing fixture references. Both repaired compatibility cases then passed. The differing-segment fixture passed its focused control; every mutation failed on the intended behavioral assertion. The full final run verifies the restored candidate. Prettier, `git diff --check` and the deslop diff review passed.

[Final per-file results and counts](2026-10-12-test-audit/final.json) keep production and test changes separate.

| Files counted                                    | Baseline lines | Final lines | Change |
| ------------------------------------------------ | -------------: | ----------: | -----: |
| Production TypeScript                            |           6101 |        6088 |    -13 |
| Unit test files                                  |           8092 |        7615 |   -477 |
| Unit fixtures                                    |             72 |          73 |     +1 |
| E2E TypeScript, including shared browser support |           1161 |        1211 |    +50 |
| E2E HTML fixture                                 |            236 |         236 |      0 |

Production adds 5 lines and removes 18. Test discovery/routing adds 3 and removes 2. Unit tests add 783 and remove 1260. Unit fixtures add 4 and remove 3. E2E scenarios add 631 and remove 618; shared browser support adds 37. No shrink-only line-cap file exists in this repository.

Static architecture, manifest/registry, default, storage and compiler contracts remain because they compare independently consumed configuration or exercise a real lifecycle. Platform protocol variations absent from the packaged fixture also remain. Transport tests own send budgets and deadlines; API tests own request bodies and compatibility state, so neither substitutes for the other.

## Scope and follow-ups

The October 11 reports distinguish an invalid echoed `text` field from a valid `translation` equal to the source. The latter remains a product decision; this audit adds no same-text rejection or retry policy. An older Provider cache read arriving after a credential change is a possible future UI case, with no confirmed historical defect in the evidence read.

The test-audit skill names OpenClaw commands and an autoreview skill that are absent here. Validation uses this repository's focused Vitest and Playwright commands, `npm run verify`, formatting, diff checks and independent preservation reviews. This audit does not claim live YouTube, HBO Max or X acceptance.
