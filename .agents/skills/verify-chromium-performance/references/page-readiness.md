# Page checks

YouTube: wait out ads, enable selected CC, seek into speech. Fresh profiles may have CC off. Inspect player/media errors before method/timeout changes. HTTP 200 may contain `STREAM_PROTECTION_STATUS`, `ump.spsrejectfailure`, `HTML5_SPS_UMP_STATUS_REJECTED`.

X: confirm main video, subtitle language, track mode, loaded/active cues and source. Fresh profiles start with X's subtitle track disabled, so Subline shows nothing; the plan's X cases set media `captions` to turn the first native subtitle track on. React may expose native cues without full HLS at `playerApi.video.hlsJs`. Model mode/successful replies do not prove timely prefetch; check replies precede caption changes.

Inspect screenshots/`overlay`; fit both lines, scroll clear of fixed login/reply panels, record viewport/scroll. DOM visibility cannot rule out occlusion. Never hide elements with CSS for a pass. Label paused diagnostics separately; they cannot replace playback traces.
