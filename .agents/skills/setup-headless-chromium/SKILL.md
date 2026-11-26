---
name: setup-headless-chromium
description: Launch isolated headless Chromium with Subline for browser checks. Use only when the user asks for a real-browser check.
---

# Headless setup

From the repo root, use full Chromium/Chrome for Testing supporting unpacked extensions; `npx playwright install chromium` provides the printed path:

```bash
npm run build
node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())'
python3 .agents/skills/setup-headless-chromium/scripts/launch.py --browser "/path/to/Chromium" --extension "$PWD/dist" --output "$PWD/.artifacts/headless-check" --provider microsoft --background
```

`--background` prints the record and returns once `session.json` state is `ready` (at most 180 s); the launcher keeps running and owns the browser. Without it the command blocks until Chromium exits. `--output` takes a task-owned directory without an earlier `session.json`. State `ready` confirms endpoint/developer mode and any `--provider`; it records PIDs/profile/configuration/fingerprint. Without `--provider` Subline never translates. The window is 1280×900; override `--window-size WIDTH,HEIGHT` and verify geometry/screenshots. For Linux/failures read [diagnostics](references/startup.md), `chromium.log`/`session.json` before changes.

Use only Providers the developer authorized. `--provider microsoft` needs nothing else. `--provider openai --provider-env FILE` reads `OPENAI_BASE_URL`, `OPENAI_MODEL` and `OPENAI_API_KEY` from a private file, normally the main checkout's `.env` ([how to find it](../verify-chromium-performance/SKILL.md)); add `--microsoft-fallback` to also consent to Microsoft temporary translations. Keys stay in that file, never in arguments/source/manifests/evidence; never print it.

Headless Chromium shows no origin approval, so the launcher grants exactly the requested origins, then saves the real settings page with the data use notice accepted and passes Test connection before `ready`. `session.json` records the Provider kind and origins, never the key. A failed save or test ends in state `failed` with the page's error: preserve it, never grant other origins, write storage or change the production manifest.

The launcher closes its own DevTools connections before `ready`; connect only through `live.py`. Pass `--launch-session .artifacts/headless-check/session.json` to every `live.py` command; follow [debug context rules](../debug-chromium/SKILL.md) to start/reload.

## Cleanup

Close task tabs, stop holder, `kill -TERM` the `launcher_pid` in `session.json`, never by process name: owned Chromium stops, profile/endpoint disappear. Remove secret bootstrap files; retain metadata/needed diagnostics, sanitize shared logs, leave other browsers/launchers alone.
