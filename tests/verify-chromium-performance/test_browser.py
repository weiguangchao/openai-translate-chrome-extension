"""Playback traces, media clocks and measurement recovery through local Chromium."""
import json
import shutil
import subprocess
import sys
import unittest

from support import SESSION, BrowserCase, copy_extension

import live as live_module
import measure


class Trace(BrowserCase):

    def test_trace_at_2x_counts_what_played(self):
        """61030c9 and 00834c8: at 2x the trace counted 18-50% of what played."""
        tab = self.open("trace-2x", trace=True, player="youtube")
        self.result(self.do(tab, action="media", time=20, rate=2, play=True))
        folder = self.folder()
        done = self.do(tab, action="trace", seconds=40, save=str(folder / "trace.json"))
        stats = self.result(done)["stats"]
        self.assertEqual(stats["playbackRate"], 2)
        self.assertNotIn("clock", stats)
        self.assertNotIn("sparse", stats)
        self.assertGreaterEqual(stats["played"], 40)
        self.assertGreaterEqual(stats["counted"], 0.8 * stats["played"])
        self.assertGreater(stats["states"]["ready"], 0)
        self.assertGreaterEqual(stats["lag"]["sentences"], 9)
        self.assertGreater(stats["batches"]["count"], 0)
        self.assertIn(", rate 2, visible 1.0,", done.err)
        self.assertNotIn("throttled", done.err)
        saved = json.loads((folder / "trace.json").read_text())
        self.assertEqual(set(saved), {"stats", "sentences", "episodes", "batches", "views", "events", "media"})
        self.assertTrue(saved['events'])
        self.assertTrue(saved['media'])

    def test_landing_trace_reports_the_wait_after_seeking(self):
        """verify-chromium-performance: seek wait is (firstReadyAt - firstCaptionAt) / playbackRate."""
        tab = self.open("landing", trace=True, delay=3000)
        self.result(self.do(tab, action="media", time=40, rate=1.5, play=True))
        stats = self.result(self.do(tab, action="trace", seconds=12))["stats"]
        self.assertGreater(stats["states"]["loading"], 0)
        self.assertGreaterEqual(stats["loading"]["episodes"], 1)
        self.assertGreater(stats["firstReadyAt"], stats["firstCaptionAt"])
        self.assertEqual(stats["playbackRate"], 1.5)

    def test_landing_trace_starts_at_the_seek_target(self):
        """43d03e2b and docs/reviews/2026-10-09-debug-chromium-high-rate.md.

        media returns once playback resumes, so without since the trace started
        1.7-4.3 s of video after the target and the wait after seeking read low.
        """
        tab = self.open("since-seek", trace=True)
        self.result(self.do(tab, action="media", time=40, rate=2, play=True))
        stats = self.result(self.do(tab, action="trace", seconds=6, since="seek"))["stats"]
        self.assertLessEqual(abs(stats["from"] - 40), 1.0, stats)
        self.assertEqual(stats["since"], "seek")
        self.assertGreaterEqual(stats["played"] + stats["before"], 6)

    def test_opening_trace_reports_the_wait_after_opening(self):
        """verify-chromium-performance: open wait is (firstReadyAt - firstCaptionAt) / playbackRate from the open."""
        tab = self.open("since-open", trace=True, delay=5000)
        self.result(self.do(tab, action="media", rate=1.5, play=True))
        stats = self.result(self.do(tab, action="trace", seconds=12, since="open"))["stats"]
        self.assertLessEqual(stats["from"], 1.0, stats)
        self.assertGreater(stats["firstReadyAt"], stats["firstCaptionAt"])
        self.assertLess(stats["firstCaptionWall"], stats["firstReadyWall"])

    def test_opening_trace_starts_where_the_video_settled(self):
        """A site may start the video elsewhere; the opening trace counts from where it settled."""
        tab = self.open("since-resume", trace=True)
        self.result(self.do(tab, action="media", time=30, play=True))
        stats = self.result(self.do(tab, action="trace", seconds=4, since="open"))["stats"]
        self.assertLessEqual(abs(stats["from"] - 30), 1.0, stats)

    def test_since_seek_fails_when_the_video_left_the_target(self):
        tab = self.open("since-left", trace=True)
        self.result(self.do(tab, action="media", time=40, play=True))
        self.result(self.do(tab, action="evaluate", expression="(document.querySelector('video').currentTime = 5) && 1"))
        failed = self.result(self.do(tab, action="trace", seconds=5, since="seek"), ok=False)
        self.assertRegex(failed["value"]["fail"], r"^video at \d(\.\d+)? s, out of reach of 40(\.0)? s since the seek$")
        missing = self.result(self.do(self.open("since-none", trace=True), action="trace", seconds=5, since="seek"),
                              ok=False)
        self.assertEqual(missing["value"]["fail"], "since seek needs an earlier media step with time")

    def test_landing_fails_if_the_site_jumps_during_the_trace(self):
        tab = self.open('since-later-jump', trace=True)
        self.result(self.do(tab, action='media', time=40, play=True))
        self.result(self.do(tab, action='evaluate', expression=
                    "setTimeout(() => { document.querySelector('video').currentTime = 5; }, 2500)"))
        result = self.result(self.do(tab, action='trace', seconds=15, since='seek'), ok=False)
        self.assertIn('during the landing trace', result['value']['fail'])


class Measurements(BrowserCase):

    def test_matrix_restores_build_and_resume_skips_complete_runs(self):
        folder = self.folder()
        source = copy_extension('0.2.0')
        self.addCleanup(shutil.rmtree, source, True)
        plan = folder / 'plan.json'
        plan.write_text(json.dumps({'durations': {'opening': 12, 'landing': 20, 'playing': 20},
                                    'cases': [{'name': 'clip', 'url': self.site.url('measure'),
                                               'rate': 1, 'seek': [44]}]}))
        output = folder / 'results'
        command = [sys.executable, measure.__file__, str(plan), '--build', f'new={source}',
                   '--loaded', str(self.extension), '--output', str(output), '--session', SESSION]
        before = live_module.fingerprint(self.extension)
        result = subprocess.run(command, env=self.live.env, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        summary = json.loads((output / 'summary.json').read_text())
        self.assertTrue(summary['runs'][0]['assessment']['dataValid'])
        self.assertTrue(summary['restoration']['reloadVerified'])
        self.assertEqual(live_module.fingerprint(self.extension), before)
        run_path = output / summary['runs'][0]['path']
        original = run_path.read_bytes()
        resumed = subprocess.run(command + ['--resume'], env=self.live.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(resumed.returncode, 0, resumed.stdout + resumed.stderr)
        self.assertIn('kept completed run', resumed.stdout)
        self.assertEqual(run_path.read_bytes(), original)
        self.assertEqual(len(json.loads((output / 'summary.json').read_text())['runs']), 1)


class TraceClock(BrowserCase):

    def test_a_rate_the_page_keeps_resetting_is_reported(self):
        """21caa5fc: page events showed 1x and 1.5x every other second; media and trace said 1.5.

        The watch probe sets the rate and reads it back in the same poll, and
        played/wall averaged about 1.25x, inside the 20% the clock allows.
        """
        tab = self.open("rate-fight", trace=True, ratefight=1)
        self.result(self.do(tab, action="media", rate=1.5, play=True))
        stats = self.result(self.do(tab, action="trace", seconds=12))["stats"]
        self.assertTrue(stats.get("clock") == "throttled" or stats["playbackRate"] != 1.5, stats)

    def test_each_trace_reports_its_own_clock(self):
        """Tab.rates, clock_samples and clock_visible add up over the tab's life.

        A second trace in an open/do tab reports the rate and visible share of
        everything before it.
        """
        tab = self.open("two-traces", trace=True)
        self.result(self.do(tab, action="media", play=True))
        self.result(self.do(tab, action="trace", seconds=8))
        self.result(self.do(tab, action="media", rate=2))
        stats = self.result(self.do(tab, action="trace", seconds=4))["stats"]
        self.assertEqual(stats["playbackRate"], 2, stats)
        self.assertNotIn("clock", stats)


if __name__ == "__main__":
    unittest.main()
