# Startup diagnostics

## Linux sandbox

A version check does not prove sandbox startup. For `No usable sandbox!`, inspect `chromium.log` before page or Provider debugging. Ubuntu's AppArmor may restrict unprivileged user namespaces.

Use the executable-specific `userns` rule in the [verify workflow](../../../../.github/workflows/verify.yml) with the actual resolved browser path. See Chromium's [AppArmor guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) for host details. Do not use `--no-sandbox`, disable host restrictions globally or overwrite an existing rule. Record any task-created rule and remove it only after this task's browser stops.

## Real-site failures

Preserve failed attempts and inspect navigation status and media errors. The launcher's nonzero port and normal Chrome User-Agent address failures observed with port-zero fixtures and HeadlessChrome. Do not replace them with navigator overrides to conceal a failure. Local fixture success does not prove real-site playback or captions.

For a playable browser with missing captions or failed seeks, use the selected platform's [page checks](../../verify-chromium-performance/references/page-readiness.md).
