---
name: headless-chromium
description: Launch an isolated headless Chromium with Subline installed, then hand browser debugging and playback traces to chrome-debug. Use when the user requests real-browser verification in this repository.
---

# Headless Chromium

Use this skill to prepare the browser for a requested real-browser check. Use [chrome-debug](../chrome-debug/SKILL.md) for subsequent page operations and traces. Follow the playback protocol in `AGENTS.md`. A request to edit code or documentation alone does not call for a real-site measurement.

## Launch

Run from the repository root. Build the requested extension first with `npm run build`. Use a full Chromium or Chrome for Testing binary that supports unpacked extensions. The Playwright browser path can be obtained without launching it.

```bash
node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())'
python3 .agents/skills/headless-chromium/scripts/launch.py \
  --browser "/absolute/path/to/Chromium" \
  --extension "$PWD/dist" \
  --output "$PWD/.artifacts/headless-check"
```

Choose a new task-owned output directory for each launch. Keep the launcher running in a tool session. Wait for `session.json` to report `state` as `ready`. The launcher records its PID, browser PID, version, flags, User-Agent, isolated profile, extension path and build fingerprint. It creates the endpoint file consumed by chrome-debug. It does not modify the extension or configure a Provider.

The launcher chooses an explicit nonzero debugging port, uses `--headless=new` and a normal Chrome User-Agent derived from the browser's major version. It enables extension developer mode through a short bootstrap connection to `chrome://extensions`, then closes that connection before declaring readiness. Its default window size is 1280 by 900. Use `--window-size WIDTH,HEIGHT` when another viewport is needed. Check actual page geometry and screenshots after launch.

Linux must allow Chromium to create its sandbox namespaces. The Ubuntu 24.04 CI runner exited with No usable sandbox because AppArmor restricted unprivileged user namespaces. The [verify workflow](../../../.github/workflows/verify.yml) installs an AppArmor rule for the exact Playwright Chromium executable before testing. For another Linux host, arrange the host's approved sandbox configuration before launch. Read Chromium's [AppArmor guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) when this error occurs. Do not add `--no-sandbox` or disable AppArmor restrictions system-wide to make real-site checks pass.

Do not substitute `tests/chrome-debug/support.py` as the real-site launcher. Its port-zero fixture default caused YouTube seek failures in the Chrome for Testing 153.0.8010.12 controls on 2026-10-28. Port zero exposed `navigator.webdriver=true`; an explicit nonzero port exposed `navigator.webdriver=false` and the seek succeeded in headed and headless controls. Those observations do not establish the server's detection rule. Do not inject navigator overrides to conceal a failed setup.

In the same controls, X returned HTTP 403 with the default HeadlessChrome User-Agent and HTTP 200 with a normal Chrome User-Agent. Record actual navigation status when diagnosing another failure. Local fixture success does not prove real-site playback or captions.

## Configure the Provider when needed

Before measuring translation, save through the real extension settings page. Grant the Provider origin permission, obtain caption-sharing consent and pass the extension's connection test. Use the task's authorized Provider settings. Deliver secrets through a private file or secret tool. Never embed an API key in launch arguments, source files, a manifest or evidence.

Settings bootstrap may use its own UI automation connection before chrome-debug starts. Close that connection before handing off the browser. Do not enable the page's Runtime domain. Do not evaluate custom code in extension contexts. Use the real settings controls for Provider configuration.

In the headless investigation, Save stalled at optional host permission approval. Do not treat that as a Provider timeout or keep extending the wait. If approval cannot complete in headless mode, retain the failure and report the initialization as blocked. A separate diagnostic copy may preauthorize the requested Provider origin in its manifest to isolate the permission step. Compare its files, record its fingerprint and label its results separately. That copy does not validate the original build's authorization flow. Do not modify the production manifest to claim a pass.

## Hand off to chrome-debug

Read [chrome-debug](../chrome-debug/SKILL.md) before connecting. Set the two environment variables from this launch's `session.json` in every command environment. For the example output directory above, use the following values.

```bash
export CHROME_DEBUG_PORT_FILE="$PWD/.artifacts/headless-check/endpoint"
export CHROME_DEBUG_STATE="$PWD/.artifacts/headless-check/holder.json"
python3 .agents/skills/chrome-debug/scripts/live.py start
```

Keep the session ID returned by `start`. Pass it to later commands.

```bash
python3 .agents/skills/chrome-debug/scripts/live.py reload --path "$PWD/dist" --session SESSION
python3 .agents/skills/chrome-debug/scripts/live.py open "https://www.youtube.com/watch?v=VIDEO_ID" --trace --session SESSION
```

Readiness means the endpoint and developer mode are ready. Confirm the extension loaded with `reload` before opening the requested videos. From `start` until `stop`, only `live.py` may connect to this browser. Do not launch a second Playwright or DevTools connection, read `DevToolsActivePort`, or enable the page's Runtime domain. Do not evaluate custom code or enable Network in extension contexts. The launcher stays idle and makes no further debugging calls after handoff.

For playback measurements, read [measurement.md](../chrome-debug/references/measurement.md). Omit its example's `--focus` flag and do not use `focus` steps for a headless run. They activate the user's Google Chrome through AppleScript. Keep the loaded build path and fingerprint with the evidence. Observe the page readiness, screenshot, timing validity and failure preservation rules in `AGENTS.md`.

## Stop

Close this task's tabs and stop its holder with `live.py` and the session ID. Then send SIGTERM to the `launcher_pid` recorded in this task's `session.json`. The launcher terminates its own Chromium, removes its temporary profile and endpoint file, and records the final state. Do not terminate the user's browser or another task's launcher. Remove any secret-bearing bootstrap files. Keep session metadata and only the logs and evidence needed for the task. Sanitize network logs before sharing them.
