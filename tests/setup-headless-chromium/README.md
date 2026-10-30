# Setup headless Chromium tests

`test_headless.py` checks browser launch, the handoff to debug-chromium, failure evidence and cleanup of task-owned processes and profiles.

Run from the repository root:

```bash
npm run test:setup-headless-chromium
```

The equivalent discovery command is:

```bash
PYTHONPATH=tests/debug-chromium python3 -m unittest discover -s tests/setup-headless-chromium
```

These tests reuse the [debug-chromium browser harness and fixtures](../debug-chromium/README.md). Install Chromium as described there before running. `npm run verify` includes this suite.
