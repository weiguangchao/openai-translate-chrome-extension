# Debug Chromium tests

Skill tests are grouped by the behavior they cover.

| Directory                                                                        | Coverage                                                                         |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `tests/debug-chromium/`                                                          | Debug commands, sessions, browser operations and Subline protocol compatibility. |
| [`tests/setup-headless-chromium/`](../setup-headless-chromium/README.md)         | Browser launch, handoff, failure evidence and cleanup.                           |
| [`tests/verify-chromium-performance/`](../verify-chromium-performance/README.md) | Trace timing, subtitle metrics, measurement validity and recovery.               |

`support.py` and the extension and site fixtures belong to debug-chromium. The other suites use this browser harness through `PYTHONPATH`; performance trace fixtures live with the performance tests. The runtime scripts remain in `.agents/skills/`.

Run the debug suite from the repository root:

```bash
python3 -m unittest discover -s tests/debug-chromium
```

The browser tests launch isolated headless Chromium with a Subline test double and a local player page. Install Chromium with `npx playwright install chromium`, or set `DEBUG_CHROMIUM_TEST_BROWSER` to its executable. Set `DEBUG_CHROMIUM_TEST_HEADED=1` to show its window. The tests never reach the user's Chrome or holder.

Run the debug modules included in CI:

```bash
npm run test:debug-chromium
```

This command runs `test_contract.py` and `test_rules.py`. The full suite also runs `test_browser.py` and `test_known_issues.py`. `npm run verify` runs the CI commands for all three skills.
