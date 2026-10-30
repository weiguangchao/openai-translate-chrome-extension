# Verify Chromium performance tests

`test_measure.py` checks measurement validity, media clocks, evidence recovery and build restoration. `test_worker_trace.py` checks subtitle and Provider statistics, including the recorded traces in `fixtures/traces/`.

Run these modules without a browser from the repository root:

```bash
npm run test:verify-chromium-performance
```

`test_browser.py` checks opening and landing traces, rate changes and measurement recovery through local Chromium. Run the full performance suite with:

```bash
PYTHONPATH=tests/debug-chromium python3 -m unittest discover -s tests/verify-chromium-performance
```

These tests reuse the [debug-chromium browser harness and fixtures](../debug-chromium/README.md). Install Chromium as described there before running browser tests. `npm run verify` includes the modules that need no browser; the full command also runs browser regressions.
