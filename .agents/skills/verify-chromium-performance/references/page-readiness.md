# Page and subtitle checks

## YouTube

Wait for pre-roll ads to finish and confirm the selected caption track is enabled before seeking into speech. Fresh profiles may have CC off.

If seeking breaks playback, inspect the player error and media response before changing the seek method or timeout. HTTP 200 can still carry `STREAM_PROTECTION_STATUS` rejection, with `ump.spsrejectfailure` or `HTML5_SPS_UMP_STATUS_REJECTED`.

## X

Confirm the main video, selected subtitle language, track mode, loaded cues and active cues. Inspect the actual caption source. A React controller may expose live native cues without the full HLS timeline expected at `playerApi.video.hlsJs`.

A source mode named model or successful Provider replies does not prove timeline prefetch or timely subtitles. Check whether replies arrive before the caption changes.

## Visible subtitles

Inspect screenshots as well as `overlay` results. Fit both subtitle lines in the viewport, scroll them clear of fixed login or reply panels, and record viewport and scroll position. DOM visibility cannot prove another element is not covering a subtitle. Do not inject CSS to remove page elements for a passing screenshot.

A paused frame can diagnose translation and rendering. Label it separately; it does not replace opening, landing or continuous-playing traces.
