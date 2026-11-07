---
name: setup-headless-chromium
description: Launch isolated headless Chromium with Subline for browser checks.
---

# Headless setup

From the repo root, use full Chromium/Chrome for Testing supporting unpacked extensions:

```bash
npm run build
node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())'
python3 .agents/skills/setup-headless-chromium/scripts/launch.py --browser "/path/to/Chromium" --extension "$PWD/dist" --output "$PWD/.artifacts/headless-check" --provider microsoft --background
```

`--background` prints the record and returns once `session.json` state is `ready`; the launcher keeps running and owns the browser. Without it the command blocks until Chromium exits. `--output` takes a task-owned directory without an earlier `session.json`. State `ready` confirms endpoint/developer mode/Provider; it records PIDs/profile/configuration/fingerprint. Use this launcher for real sites: nonzero port, normal Chrome User-Agent, 1280×900 window. Override `--window-size WIDTH,HEIGHT`; verify geometry/screenshots. For Linux/failures read [diagnostics](references/startup.md), `chromium.log`/`session.json` before changes.

Use only Providers the developer authorized. `--provider microsoft` needs nothing else. `--provider openai --provider-env FILE` reads `OPENAI_BASE_URL`, `OPENAI_MODEL` and `OPENAI_API_KEY` from a private file, normally the main checkout's `.env` ([how to find it](../verify-chromium-performance/SKILL.md)); add `--microsoft-fallback` to also consent to Microsoft temporary translations. Keys stay in that file, never in arguments/source/manifests/evidence; never print it.

Headless Chromium shows the native origin approval in no window, so a save that requests an ungranted origin waits forever. The launcher grants exactly the origins the save requests through the `chrome://extensions` site access control, fills the real settings page, accepts the data use notice, saves and passes Test connection, all before `ready`. `session.json` records the Provider kind and origins, never the key. A failed save or test ends in state `failed` with the page's error: preserve it, never grant other origins, write storage or change the production manifest.

Close bootstrap connections before handoff. Pass `--launch-session "$PWD/.artifacts/headless-check/session.json"` to every `live.py` command; follow [debug context rules](../debug-chromium/SKILL.md) to start/reload. The CLI derives endpoint/state paths and rejects stopped or mismatched sessions. Launcher bootstrap closes before ready; no later debugging calls.

## Cleanup

Close task tabs, stop holder, SIGTERM recorded `launcher_pid`: owned Chromium stops, profile/endpoint disappear. Remove secret bootstrap files; retain metadata/needed diagnostics, sanitize shared logs, leave other browsers/launchers alone.
