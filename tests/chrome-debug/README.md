# Chrome debug tests

These tests cover the scripts in `.agents/skills/chrome-debug/scripts/`. Test helpers and fixtures live here; the skill keeps its runtime scripts, check plans and usage instructions.

After changing the scripts, run the full suite from the repository root:

```bash
python3 -m unittest discover -s tests/chrome-debug
```

The browser tests launch their own headless Chromium from Playwright's cache with a Subline test double and a local player page. Install Chromium with `npx playwright install chromium`, or set `CHROME_DEBUG_TEST_BROWSER` to its executable. Set `CHROME_DEBUG_TEST_HEADED=1` to show its window. The tests never reach the user's Chrome or holder. A full run takes about six minutes.

To run the four modules that need no browser:

```bash
npm run test:chrome-debug
```

`npm run verify` includes these four modules. `test_browser.py` covers browser interactions; `test_known_issues.py` contains regressions for failures reported in T3 Code sessions. Both run with the full-suite command above.
