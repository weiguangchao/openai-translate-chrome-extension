# Startup diagnostics

Linux `No usable sandbox!`: inspect `chromium.log`; version checks do not prove sandbox startup. For Ubuntu AppArmor user namespaces, apply the [workflow's](../../../../.github/workflows/verify.yml) executable-specific `userns` rule to the resolved browser. See [Chromium guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md). Never use `--no-sandbox`, disable restrictions globally or overwrite rules. Record task-created rules and remove after shutdown.

Preserve navigation/media failures. Nonzero port/normal User-Agent address observed port-zero/HeadlessChrome failures; never hide failures with navigator overrides. Fixtures do not prove real-site playback/captions. Read [page checks](../../verify-chromium-performance/references/page-readiness.md) for caption/seek failures.
