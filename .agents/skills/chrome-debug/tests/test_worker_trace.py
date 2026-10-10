"""Trace statistics from Subline's worker events, without Chrome."""
import json
import unittest

from support import FIXTURES

import worker_trace as wt


def playing(rate, wall_steps, start=100.0, state="ready", cue=1, cue_start=None, stamp=0.0, **extra):
    """Views at the given wall gaps (seconds) while the video plays at rate."""
    views, t = [], start
    for gap in [0.0, *wall_steps]:
        stamp += gap * 1000
        t += gap * rate
        view = {"t": round(t, 2), "state": state, "paused": False, "cue": cue,
                "start": start if cue_start is None else cue_start, **extra}
        views.append((stamp, view))
    return views


def as_events(views, run="r", tab="1:0"):
    return [(stamp, {"e": "view", "run": run, "tab": tab, "seeking": False, **view}) for stamp, view in views]


class Continuity(unittest.TestCase):
    """61030c9: Subline sends a view every 2 s of wall time when nothing changes.

    At 1.5x that is 3 s of video and at 2x 4 s, so a rule written in video time
    dropped normal playback and counted 18-50% of what played.
    """

    def test_two_second_heartbeats_count_at_every_rate(self):
        for rate in (1, 1.25, 1.5, 2, 4):
            with self.subTest(rate=rate):
                states, captions, ready, sentences, _, counted = wt.walk(playing(rate, [2.0] * 30))
                self.assertAlmostEqual(counted, 60 * rate, places=1)
                self.assertAlmostEqual(states["ready"], 60 * rate, places=1)
                self.assertEqual(len(sentences), 1, "one cue must stay one sentence")

    def test_a_wall_gap_over_three_seconds_is_not_playback(self):
        views = playing(1, [2.0, 3.5, 2.0])
        _, _, _, sentences, _, counted = wt.walk(views)
        self.assertAlmostEqual(counted, 4.0)
        self.assertEqual(len(sentences), 2)

    def test_a_jump_ahead_is_a_seek_not_playback(self):
        views = playing(1, [2.0]) + playing(1, [2.0], start=300, stamp=3000)
        _, _, _, sentences, _, counted = wt.walk(views)
        self.assertAlmostEqual(counted, 4.0)
        self.assertEqual(len(sentences), 2)

    def test_paused_time_is_not_counted(self):
        views = playing(1, [2.0, 2.0])
        views[1][1]["paused"] = True
        self.assertAlmostEqual(wt.walk(views)[-1], 2.0)

    def test_video_faster_than_four_times_wall_is_not_continuous(self):
        self.assertTrue(wt.continuous(8.5, 2.0))
        self.assertFalse(wt.continuous(8.6, 2.0))
        self.assertFalse(wt.continuous(-0.1, 1.0))
        self.assertFalse(wt.continuous(1.0, 3.01))


class Lag(unittest.TestCase):

    def sentence(self, views):
        sentences = wt.walk(views)[3]
        self.assertEqual(len(sentences), 1)
        return wt.lag_of(sentences[0])

    def test_ready_on_arrival_has_no_lag(self):
        self.assertEqual(self.sentence(playing(1, [1.0, 1.0])), 0.0)

    def test_lag_runs_from_the_cue_start(self):
        views = playing(1, [0.5, 1.0, 1.0], start=10.0, state="loading")
        views[-1][1]["state"] = "ready"
        self.assertAlmostEqual(self.sentence(views), 2.5)

    def test_a_cue_seen_late_counts_from_when_it_was_seen(self):
        views = playing(1, [1.0, 1.0], start=12.0, cue_start=10.0, state="loading")
        views[-1][1]["state"] = "ready"
        self.assertAlmostEqual(self.sentence(views), 2.0)

    def test_never_ready_is_missed(self):
        stats = wt.summarize(as_events(playing(1, [1.0, 1.0], state="loading")), "r", 0, 2.0)["stats"]
        self.assertEqual(stats["lag"]["missed"], 1)
        self.assertIsNone(stats["firstReadyAt"])


class Summary(unittest.TestCase):

    def test_only_this_run_after_the_start_and_not_seeking(self):
        mine = as_events(playing(1, [1.0] * 4))
        mine[0][1]["seeking"] = True
        other = as_events(playing(1, [1.0] * 4, start=500), run="other")
        early = as_events(playing(1, [1.0], start=50, stamp=-5000))
        stats = wt.summarize(early + mine + other, "r", 0, 3.0)["stats"]
        self.assertEqual(stats["views"], 4)
        self.assertEqual(stats["from"], 101.0)

    def test_first_caption_and_first_ready_give_the_wait_after_seeking(self):
        views = playing(2, [1.0, 1.0, 1.0], start=600, state="loading")
        views[0][1].pop("cue")
        views[0][1]["state"] = "empty"
        views[-1][1]["state"] = "ready"
        stats = wt.summarize(as_events(views), "r", 0, 6.0)["stats"]
        self.assertEqual(stats["firstCaptionAt"], 602.0)
        self.assertEqual(stats["firstReadyAt"], 606.0)
        self.assertEqual(stats["firstReadyWall"], 3.0)
        loading, ready = stats["states"]["loading"], stats["states"].get("ready", 0)
        self.assertEqual(loading / (loading + ready), 1.0)

    def test_since_counts_from_the_mark_without_the_old_position(self):
        """docs/reviews/2026-10-09-chrome-debug-high-rate.md: the landing trace began 1.7-4.3 s after the target."""
        stale = as_events(playing(1, [], start=12.0, stamp=100))
        landed = as_events(playing(2, [1.0] * 6, start=40.0, stamp=600, state="loading"))
        landed[-1][1]["state"] = "ready"
        stats = wt.summarize(stale + landed, "r", 3000, 7.0, since=(0, 40.0), before=5.0)["stats"]
        self.assertEqual((stats["from"], stats["firstCaptionAt"], stats["firstReadyAt"]), (40.0, 40.0, 52.0))
        self.assertEqual((stats["firstCaptionWall"], stats["firstReadyWall"]), (0.6, 6.6))
        self.assertEqual((stats["played"], stats["before"], stats["wall"]), (7.0, 5.0, 3.6),
                         "played and wall stay the step's own for the clock")
        self.assertNotIn("sparse", stats)
        self.assertTrue(wt.summarize(stale + landed, "r", 3000, 11.0, since=(0, 40.0), before=5.0)["stats"]["sparse"])
        self.assertEqual(wt.summarize(stale + landed, "r", 3000, 7.0)["stats"]["from"], 46.0)

    def test_settled_skips_a_resume_and_a_pre_roll_ad(self):
        resumed = as_events(playing(1, [1.0], start=0.0) + playing(1, [2.0, 2.0], start=1135.8, stamp=4000))
        self.assertEqual(wt.settled(resumed, "r", 9000), (4000, 1135.8))
        self.assertEqual(wt.settled(resumed, "r", 3000), (0, 0.0))
        after_ad = as_events(playing(1, [2.0] * 3, start=9.0) + playing(1, [2.0], start=0.0, stamp=7000))
        self.assertEqual(wt.settled(after_ad, "r", 9000), (7000, 0.0))
        self.assertIsNone(wt.settled(resumed, "other", 9000))

    def test_sparse_when_states_cover_under_80_percent(self):
        views = as_events(playing(1, [2.0] * 4))
        self.assertNotIn("sparse", wt.summarize(views, "r", 0, 9.0)["stats"])
        self.assertTrue(wt.summarize(views, "r", 0, 10.1)["stats"]["sparse"])

    def test_short_loading_is_a_flash_not_an_episode(self):
        views = playing(1, [0.2, 0.2, 2.0, 2.0, 2.0], state="ready")
        views[1][1]["state"] = "loading"
        views[3][1]["state"] = "loading"
        views[4][1]["state"] = "loading"
        stats = wt.summarize(as_events(views), "r", 0, 6.4)["stats"]
        self.assertEqual(stats["loading"]["episodes"], 1)
        self.assertEqual(stats["loading"]["flashes"], 1)
        self.assertEqual(stats["loading"]["longest"], 4.0)

    def test_batches_belong_to_the_sentence_inside_their_time_range(self):
        views = as_events(playing(1, [1.0, 1.0], start=20.0, state="loading"))
        views[-1][1]["state"] = "ready"
        batches = [
            (-500, {"e": "batch", "id": 1, "tab": "1:0", "size": 4, "start": 0, "end": 16}),
            (-400, {"e": "batch", "id": 2, "tab": "1:0", "size": 4, "start": 16, "end": 32}),
            (-300, {"e": "batch", "id": 3, "tab": "9:0", "size": 4, "start": 16, "end": 32}),
            (-200, {"e": "sent", "id": 2}),
            (1200, {"e": "first", "id": 2}),
            (1500, {"e": "done", "id": 2, "result": "ok"}),
        ]
        summary = wt.summarize(batches + views, "r", 0, 2.0)
        self.assertEqual(summary["stats"]["batches"]["count"], 2, "another tab's batch is not ours")
        batch = summary["sentences"][0]["batch"]
        self.assertEqual((batch["id"], batch["wait"], batch["first"], batch["roundTrip"]), (2, 0.2, 1.4, 1.7))

    def test_a_reused_batch_id_does_not_take_older_events(self):
        events = [
            (0, {"e": "batch", "id": 1, "tab": "1:0", "size": 4}),
            (10, {"e": "sent", "id": 1}),
            (20, {"e": "batch", "id": 1, "tab": "1:0", "size": 2}),
            (30, {"e": "done", "id": 1, "result": "ok"}),
        ]
        first, second = wt.collect_batches(events, "1:0")
        self.assertEqual((first["sent"], "done" in first), (10, False))
        self.assertEqual((second["done"], "sent" in second), (30, False))


class Clock(unittest.TestCase):
    """00834c8: a trace from a hidden or throttled tab must say so."""

    def stats(self, played, wall, visible=10, samples=10, rates=None):
        stats = {"played": played, "wall": wall}
        wt.clock(stats, rates or {2: samples}, visible, samples)
        return stats

    def test_steady_playback_is_not_throttled(self):
        stats = self.stats(played=40, wall=20)
        self.assertEqual((stats["playbackRate"], stats["visible"]), (2, 1.0))
        self.assertNotIn("clock", stats)

    def test_mostly_hidden_tab_is_throttled(self):
        self.assertEqual(self.stats(played=40, wall=20, visible=4)["clock"], "throttled")

    def test_played_far_from_rate_times_wall_is_throttled(self):
        self.assertEqual(self.stats(played=30, wall=20)["clock"], "throttled")
        self.assertNotIn("clock", self.stats(played=33, wall=20))

    def test_reports_the_rate_seen_most(self):
        self.assertEqual(self.stats(played=20, wall=20, rates={1: 2, 2: 8})["playbackRate"], 2)

    def test_end_line_shows_before_only_with_since(self):
        self.assertIn("played 7.0, before 5.0, counted", wt.trace_line({"played": 7.0, "before": 5.0}))
        self.assertNotIn("before", wt.trace_line({"played": 7.0}))

    def test_end_line_flags_throttled_and_sparse(self):
        line = wt.trace_line({"clock": "throttled", "sparse": True, "playbackRate": 2})
        self.assertTrue(line.endswith("rate 2, visible None, coverage None, missed None, lag.max None, "
                                      "throttled, sparse"))


class RecordedTraces(unittest.TestCase):
    """PR #30's YouTube and HBO traces, recounted after 61030c9.

    Expected values come from docs/reviews/assets/chrome-debug-high-rate-summary.json.
    Subtitle text was replaced with placeholders; timing and states are as recorded.
    """

    @classmethod
    def setUpClass(cls):
        cls.traces = json.loads((FIXTURES / "traces/pr30.json").read_text())

    def test_recount_matches_the_review(self):
        for trace in self.traces:
            with self.subTest(run=trace["run"], trace=trace["trace"], rate=trace["rate"]):
                states, _, _, sentences, _, counted = wt.walk([tuple(view) for view in trace["views"]])
                self.assertEqual(round(counted, 1), trace["counted_after"])
                self.assertEqual(len(sentences), trace["sentences_after"])
                loading, ready = states.get("loading", 0), states.get("ready", 0)
                share = round(100 * loading / (loading + ready), 1) if loading + ready else 0.0
                self.assertEqual(share, trace["loading_after"])

    def test_high_rates_count_nearly_all_played_time(self):
        for trace in self.traces:
            with self.subTest(run=trace["run"], trace=trace["trace"], rate=trace["rate"]):
                counted = wt.walk([tuple(view) for view in trace["views"]])[-1]
                self.assertGreaterEqual(counted, 0.9 * trace["played"])


if __name__ == "__main__":
    unittest.main()
