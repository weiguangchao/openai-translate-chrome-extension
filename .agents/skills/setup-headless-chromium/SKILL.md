---
name: setup-headless-chromium
description: Prepare isolated headless Chromium with Subline for a requested browser check, then hand it to debug-chromium.
---

# Set up headless Chromium

## Launch

From the repository root, build with `npm run build` and choose a full Chromium or Chrome for Testing binary that loads unpacked extensions:

```bash
node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())'
python3 .agents/skills/setup-headless-chromium/scripts/launch.py --browser "/absolute/path/to/Chromium" --extension "$PWD/dist" --output "$PWD/.artifacts/headless-check"
```

Use a new task-owned output directory and keep the launcher running in a tool session. Wait for `session.json` to report `state: "ready"`. It records process IDs, the isolated profile, browser configuration and build fingerprint. Ready means the endpoint and extension developer mode are available.

The launcher uses a nonzero debugging port, a normal Chrome User-Agent and a 1280 by 900 window. Use `--window-size WIDTH,HEIGHT` when needed; verify actual geometry and screenshots after handoff. Use this launcher for real sites, rather than the test harness.

On Linux, check sandbox setup in [startup diagnostics](references/startup.md). If launch fails, inspect `chromium.log` and `session.json` there before changing the setup.

## Configure translation when needed

Use authorized Provider settings through the real settings page. Grant origin permission, obtain caption-sharing consent and pass the connection test. Keep keys in private files or a secret tool, outside arguments, source, manifests and evidence.

Complete any settings bootstrap connection before handoff, then close it. Do not enable the page's Runtime domain or evaluate custom code in extension contexts. If host permission approval cannot finish headlessly, preserve the failure and report setup as blocked; do not bypass consent or change the production manifest.

## Hand off

Export the values from this launch's `session.json` in every later command environment:

```bash
export DEBUG_CHROMIUM_PORT_FILE="$PWD/.artifacts/headless-check/endpoint"
export DEBUG_CHROMIUM_STATE="$PWD/.artifacts/headless-check/holder.json"
```

Continue with [debug-chromium](../debug-chromium/SKILL.md) to start the holder and verify the extension with `reload`. The launcher's bootstrap connection is closed before ready; the launcher makes no debugging calls after handoff.

## Clean up

After debug-chromium closes its tabs and stops its holder, send SIGTERM to this launch's recorded `launcher_pid`. The launcher stops its Chromium and removes the temporary profile and endpoint. Remove secret-bearing bootstrap files, retain session metadata and needed diagnostics, and sanitize network logs before sharing. Leave the user's browser and other tasks' launchers alone.
