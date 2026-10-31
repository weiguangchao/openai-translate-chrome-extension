---
name: setup-headless-chromium
description: Launch isolated headless Chromium with Subline for browser checks.
---

# Headless setup

From the repo root, use full Chromium/Chrome for Testing supporting unpacked extensions:

```bash
npm run build
node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())'
python3 .agents/skills/setup-headless-chromium/scripts/launch.py --browser "/path/to/Chromium" --extension "$PWD/dist" --output "$PWD/.artifacts/headless-check"
```

Keep launcher running in a tool session/new task-owned directory. `session.json` state `ready` confirms endpoint/developer mode; it records PIDs/profile/configuration/fingerprint. Use this launcher for real sites: nonzero port, normal Chrome User-Agent, 1280×900 window. Override `--window-size WIDTH,HEIGHT`; verify geometry/screenshots. For Linux/failures read [diagnostics](references/startup.md), `chromium.log`/`session.json` before changes.

Use authorized Providers through real settings/caption-sharing consent. Keys belong in private files/secret tools, never arguments/source/manifests/evidence. Headless macOS saving may await native origin approval, absent from DOM/screenshots. Inspect native UI, approve only authorized origin, verify saving/connection. Failed/unavailable approval blocks setup; preserve failure, never bypass consent/change production manifest.

Close bootstrap connections before handoff. Export session `debug_chromium_env`; follow [debug context rules](../debug-chromium/SKILL.md) to start/reload. Launcher bootstrap closes before ready; no later debugging calls.

## Cleanup

Close task tabs, stop holder, SIGTERM recorded `launcher_pid`: owned Chromium stops, profile/endpoint disappear. Remove secret bootstrap files; retain metadata/needed diagnostics, sanitize shared logs, leave other browsers/launchers alone.
