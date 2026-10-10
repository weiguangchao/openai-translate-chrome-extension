"""live.py and the holder against a real headless Chromium.

Each class launches its own Chromium with the Subline test double and its own
holder state, so nothing here reaches the user's Chrome or holder. Pages come
from tests/fixtures/site and copy the site behaviour the history ran into.
"""
import contextlib
import io
import json
import os
import shutil
import socket
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from support import SESSION, Browser, BrowserCase, Site, copy_extension, step

import holder
import live as live_module


class Media(BrowserCase):

    def test_seeks_once_while_the_video_plays_on_at_2x(self):
        """61030c9: a seek written into every poll pulled a playing video back 66-89 times."""
        tab = self.open("seek-once", player="youtube")
        media = self.result(self.do(tab, action="media", time=30, rate=2, play=True))
        self.assertEqual(media["seeks"], 1)
        self.assertEqual((media["video"]["rate"], media["video"]["paused"]), (2, False))
        self.assertGreaterEqual(media["video"]["time"], 30)
        self.result(self.do(tab, action="wait", time=40))
        self.assertEqual([e["time"] for e in self.site.log("seek-once", "seeking")], [30])

    def test_seeks_again_when_the_site_moves_the_video(self):
        """4ce2031: YouTube jumps to a resume position after a seek; media follows it up."""
        tab = self.open("pull-once", pullback="once")
        media = self.result(self.do(tab, action="media", time=30, play=True))
        self.assertEqual(media["seeks"], 2)
        self.assertGreaterEqual(media["video"]["time"], 28.5)

    def test_gives_up_after_three_seeks(self):
        tab = self.open("pull-always", pullback="always")
        media = self.result(self.do(tab, action="media", time=30, play=True), ok=False)
        self.assertEqual(media["reason"], "fail")
        self.assertRegex(media["value"]["fail"], r"^video left 30 s after 3 seeks, now at ")
        self.assertEqual(media["seeks"], 3)
        self.assertLess(media["seconds"], 20)

    def test_rate_holds_against_youtube_and_is_undone_on_close(self):
        """4ce2031: YouTube resets the element to its own rate every second."""
        tab = self.open("rate", player="youtube")
        self.result(self.do(tab, action="media", rate=1.5, play=True))
        self.result(self.do(tab, action="wait", seconds=3))
        self.assertEqual(self.result(self.do(tab, action="media"))["video"]["rate"], 1.5)
        self.assertEqual(self.call("close", tab).code, 0)
        restored = self.until(lambda: [e for e in self.site.log("rate", "ratechange") if e["rate"] == 1])
        self.assertTrue(restored, self.site.log("rate", "ratechange"))

    def test_keep_playing_resumes_until_pause(self):
        """4ce2031: keep_playing resumes a paused video during later steps; pause turns it off."""
        tab = self.open("keep")
        self.result(self.do(tab, action="media", play=True, keep_playing=True))
        self.result(self.do(tab, action="evaluate", expression="document.querySelector('video').pause() ?? true"))
        self.result(self.do(tab, action="wait", seconds=2))
        self.assertFalse(self.result(self.do(tab, action="media"))["video"]["paused"])
        self.assertTrue(self.result(self.do(tab, action="media", pause=True))["video"]["paused"])
        self.result(self.do(tab, action="wait", seconds=2))
        self.assertTrue(self.result(self.do(tab, action="media"))["video"]["paused"])

    def test_media_stays_muted(self):
        """1a99823: check tabs stay muted from navigation until they close, even if the page unmutes."""
        tab = self.open("muted", unmute=1)
        self.result(self.do(tab, action="media", play=True))
        self.result(self.do(tab, action="wait", seconds=1))
        events = self.site.log("muted")
        self.assertTrue([e for e in events if e["type"] == "unmute"], events)
        self.assertTrue(all(e["muted"] for e in events), events)

    def test_frozen_video_fails_with_the_reason(self):
        """00834c8: a playable video that never advanced used the whole budget."""
        tab = self.open("stuck", stuck=1)
        media = self.result(self.do(tab, timeout=60, action="media", play=True), ok=False)
        self.assertEqual(media["value"]["fail"], "video time stuck at 0 s, paused")
        self.assertLess(media["seconds"], 30)


class Steps(BrowserCase):

    def test_a_closed_tab_ends_the_step_at_once(self):
        """c3b792e: a closed tab used to retry until the budget ran out (414 s)."""
        tab = self.open("closed")
        self.result(self.do(tab, action="media", play=True))
        waiting = self.live.spawn("do", tab, step(action="wait", seconds=120), "--timeout", 150, session=SESSION)
        time.sleep(2)
        [target] = [t for t in self.browser.targets() if "page=closed" in t["url"]]
        self.browser.close_target(target["id"])
        out, err = waiting.communicate(timeout=20)
        self.assertEqual(waiting.returncode, 1, err)
        reply = json.loads(out)
        self.assertRegex(reply["closed"], r"^tab closed at video \d")
        self.assertLess(reply["result"]["seconds"], 10)
        self.assertEqual(self.call("status").json["tabs"], [])

    def test_an_evaluate_fail_ends_the_step_at_once(self):
        """c3b792e: a value with a fail key used to wait out the budget (377 s)."""
        tab = self.open("fail")
        failed = self.result(self.do(tab, action="evaluate", expression="({fail: 'nope'})"), ok=False)
        self.assertEqual((failed["reason"], failed["value"]), ("fail", {"fail": "nope"}))
        self.assertLess(failed["seconds"], 3)

    def test_a_falsy_value_retries_until_the_budget(self):
        tab = self.open("falsy")
        spent = self.result(self.do(tab, timeout=3, action="evaluate", expression="false"), ok=False)
        self.assertEqual(spent["reason"], "budget spent")

    def test_overlay_waits_for_the_translation(self):
        tab = self.open("overlay", delay=2000)
        self.result(self.do(tab, action="media", time=40, play=True))
        overlay = self.result(self.do(tab, action="overlay", wait=True))["overlay"]
        self.assertFalse(overlay["original"]["hidden"])
        self.assertRegex(overlay["translation"]["text"], r"^译文 \d+$")

    def test_trace_needs_a_traced_tab(self):
        tab = self.open("untraced")
        refused = self.do(tab, action="trace", seconds=5)
        self.assertEqual(refused.code, 1)
        self.assertIn("trace needs a tab opened with --trace", refused.json["error"])

    def test_screenshot_and_save_write_where_asked(self):
        tab = self.open("shot")
        folder = self.folder()
        shot = self.result(self.do(tab, action="screenshot", path=str(folder / "page.jpg")))
        self.assertEqual((shot["path"], (folder / "page.jpg").read_bytes()[:2]), (str(folder / "page.jpg"), b"\xff\xd8"))
        saved = self.result(self.do(tab, action="evaluate", expression="({title: document.title})",
                                    save=str(folder / "value.json")))
        self.assertEqual(json.loads((folder / "value.json").read_text()), {"title": "chrome-debug fixture"})
        self.assertEqual(saved["saved"], str(folder / "value.json"))


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
        self.assertEqual(set(saved), {"stats", "sentences", "episodes", "batches", "views"})

    def test_landing_trace_reports_the_wait_after_seeking(self):
        """AGENTS.md: wait after seeking is (firstReadyAt - firstCaptionAt) / playbackRate."""
        tab = self.open("landing", trace=True, delay=3000)
        self.result(self.do(tab, action="media", time=40, rate=1.5, play=True))
        stats = self.result(self.do(tab, action="trace", seconds=12))["stats"]
        self.assertGreater(stats["states"]["loading"], 0)
        self.assertGreaterEqual(stats["loading"]["episodes"], 1)
        self.assertGreater(stats["firstReadyAt"], stats["firstCaptionAt"])
        self.assertEqual(stats["playbackRate"], 1.5)

    def test_landing_trace_starts_at_the_seek_target(self):
        """43d03e2b and docs/reviews/2026-10-09-chrome-debug-high-rate.md.

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
        """AGENTS.md: wait after opening is (firstReadyAt - firstCaptionAt) / playbackRate from the open."""
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


class Run(BrowserCase):

    def write_checks(self, checks, **files):
        folder = self.folder()
        for name, text in files.items():
            (folder / name).write_text(text)
        (folder / "checks.json").write_text(json.dumps(checks).replace("FOLDER", str(folder)))
        return folder / "checks.json"

    def test_reports_every_check_and_closes_their_tabs(self):
        """c1d5f06 and c3b792e: a failed check keeps its evidence and the next check still runs."""
        checks = self.write_checks([
            {"name": "broken", "url": self.site.url("run-broken"), "budget": 20,
             "steps": [{"action": "evaluate", "expression": "({fail: 'broken on purpose'})"}],
             "on_fail": "document.title", "fail_screenshot": "FOLDER/broken.png"},
            {"name": "smoke", "url": self.site.url("run-smoke", player="youtube"), "budget": 60,
             "steps": [{"action": "media", "time": 8, "rate": 2, "play": True, "keep_playing": True},
                       {"action": "trace", "seconds": 8},
                       {"action": "overlay", "wait": True},
                       {"action": "evaluate", "expression_file": "probe.js"}]},
        ], **{"probe.js": "document.querySelector('video') && document.title"})
        done = self.call("run", checks)
        self.assertEqual(done.code, 1, done)
        broken, smoke = done.reports
        self.assertEqual((broken["name"], broken["ok"], broken["on_fail"]), ("broken", False, "chrome-debug fixture"))
        self.assertEqual((checks.parent / "broken.png").read_bytes()[:4], b"\x89PNG")
        self.assertTrue(smoke["ok"], smoke)
        self.assertEqual([s["action"] for s in smoke["steps"]], ["media", "trace", "overlay", "evaluate"])
        self.assertEqual(smoke["steps"][-1]["value"], "chrome-debug fixture")
        self.assertIn("smoke 2/4 trace: ok in", done.err)
        self.assertEqual(done.out.strip().splitlines()[-1], "1/2 checks passed; failed: broken")
        self.assertEqual(self.call("status").json["tabs"], [])
        self.assertEqual(self.call("run", checks, "--only", "smoke").code, 0)

    def test_bad_checks_are_rejected_before_any_tab_opens(self):
        """c1d5f06: action [] used to crash the holder with TypeError: unhashable type: 'list'."""
        before = len(self.browser.targets())
        for action in ("seek", []):
            with self.subTest(action=action):
                checks = self.write_checks([{"name": "bad", "url": self.site.url("bad"), "budget": 10,
                                             "steps": [{"action": action, "time": 5}]}])
                done = self.call("run", checks)
                self.assertEqual(done.code, 2, done)
                self.assertIn(f"Holder rejected the checks: check 'bad' step 0: unknown action {action!r}", done.err)
        self.assertEqual(len(self.browser.targets()), before)
        self.assertTrue(self.call("status").json["ok"], "the holder keeps serving")


class Reload(BrowserCase):

    def test_reload_prints_the_build_it_reloaded(self):
        done = self.call("reload", "--path", self.extension)
        self.assertEqual(done.code, 0, done)
        build = live_module.fingerprint(self.extension)
        self.assertIn(f"Reloaded Subline test double from {self.extension}, build {build}.", done.out)

    def test_reload_from_runs_the_other_build_and_traces_it(self):
        """4ce2031: --from copies another build into the folder Chrome loaded."""
        other = copy_extension(version="2.0")
        self.addCleanup(shutil.rmtree, other, True)
        done = self.call("reload", "--path", self.extension, "--from", other)
        self.assertEqual(done.code, 0, done)
        self.assertEqual(live_module.fingerprint(self.extension), live_module.fingerprint(other))
        tab = self.open("reloaded", trace=True)
        build = self.do(tab, action="evaluate", expression="document.documentElement.dataset.fixtureBuild")
        self.assertEqual(self.result(build)["value"], "2.0")
        self.result(self.do(tab, action="media", play=True))
        self.assertGreater(self.result(self.do(tab, action="trace", seconds=4))["stats"]["views"], 0)

    def test_reload_refuses_a_folder_chrome_did_not_load(self):
        """21caa5fc: an agent reloaded a folder Chrome had not loaded and measured the old build."""
        stranger = copy_extension()
        self.addCleanup(shutil.rmtree, stranger, True)
        done = self.call("reload", "--path", stranger)
        self.assertEqual(done.code, 1, done)
        self.assertIn("is not Subline, or Chrome did not load it from that folder", done.err)


class Sessions(BrowserCase):
    """c1d5f06: one task's holder never serves, restarts or stops for another task."""

    def test_another_task_cannot_use_or_stop_the_holder(self):
        pid = self.live.state["pid"]
        start = self.call("start", session="other-task")
        self.assertEqual(start.code, 1, start)
        self.assertIn("Holder belongs to another session", start.err)
        anonymous = self.call("open", self.site.url("anonymous"), session=None)
        self.assertEqual(anonymous.code, 1)
        self.assertIn("A session id is required", anonymous.err)
        self.assertEqual(self.call("stop", session="other-task").code, 1)
        self.assertEqual(self.live.state["pid"], pid)
        status = self.call("status", session=None)
        self.assertEqual(status.code, 0, status)
        self.assertTrue(status.json["ok"])

    def test_the_owner_reuses_its_holder(self):
        pid = self.live.state["pid"]
        again = self.call("start")
        self.assertEqual(again.code, 0, again)
        self.assertIn(f"Holder already running (pid {pid})", again.out)


class Restart(BrowserCase):

    def test_restart_closes_tabs_a_killed_holder_left_open(self):
        opened = self.call("open", self.site.url("left-open"))
        self.assertEqual(opened.code, 0, opened)
        self.live.kill_holder()
        status = self.call("status", session=None)
        self.assertEqual(status.code, 1)
        self.assertIn("Not running. Stale state file", status.out)
        restarted = self.call("start")
        self.assertEqual(restarted.code, 0, restarted)
        self.assertIn("Closed a tab a stopped holder left open.", restarted.err)
        self.assertFalse([t for t in self.browser.targets() if "page=left-open" in t["url"]])
        stopped = self.call("stop")
        self.assertEqual(stopped.out.strip(), "Stopped.")
        self.assertIsNone(self.live.state)
        self.assertIsNone(self.browser.process.poll(), "stop leaves Chrome running")


class Protocol(unittest.TestCase):
    """c3b792e and SKILL.md: what the holder may send Chrome.

    Enabling Runtime on a YouTube page stops YouTube serving captions, and the
    holder must not run custom code or enable Network in Subline's contexts.
    This drives a Holder in this process and records every CDP call.
    """

    @classmethod
    def setUpClass(cls):
        cls.extension = copy_extension()
        cls.site = Site()
        try:
            cls.browser = Browser(cls.extension)
        except BaseException:
            cls.site.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.site.close()
        shutil.rmtree(cls.extension, ignore_errors=True)

    def test_page_runtime_and_extension_network_stay_off(self):
        folder = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, folder, True)
        port, path = self.browser.port_file.read_text().split()[:2]
        calls = []
        with patch.dict(os.environ, {"CHROME_DEBUG_SESSION": "protocol"}), \
                patch.object(holder, "STATE", folder / "holder.json"), \
                contextlib.redirect_stderr(io.StringIO()):
            chrome = holder.handshake(int(port), path)
            self.addCleanup(chrome.close)
            original = chrome.call

            def record(method, params=None, session=None, **options):
                calls.append((method, session, (params or {}).get("expression")))
                return original(method, params, session=session, **options)

            chrome.call = record
            server = holder.Holder(chrome, int(port))
            self.addCleanup(server.server.close)
            tab = server.open_tab(self.site.url("protocol", player="youtube"), True,
                                  time.monotonic() + 60, lambda _event: None)
            steps = [
                {"action": "media", "time": 10, "rate": 2, "play": True, "keep_playing": True, "skip_ads": True},
                {"action": "overlay", "wait": True},
                {"action": "trace", "seconds": 4},
                {"action": "wait", "seconds": 1},
                {"action": "evaluate", "expression": "document.title"},
                {"action": "click", "selector": "video"},
                {"action": "requests", "match": ["clip.webm"]},
                {"action": "screenshot", "path": str(folder / "page.png")},
            ]
            for index, current in enumerate(steps, 1):
                tab.deadline = time.monotonic() + 30
                result = tab.run(current, {"check": "protocol", "step": index, "of": len(steps),
                                           "action": current["action"]})
                self.assertTrue(result["ok"], result)
            page, workers = tab.session, set(tab.workers)
            server.close_tab(tab)
            client, peer = socket.socketpair()
            self.addCleanup(client.close)
            self.addCleanup(peer.close)
            server.reload(client, live_module.extension_id(self.extension))
            self.assertTrue(json.loads(peer.recv(65536))["ok"])
        self.assertTrue(workers, "the trace attached to Subline's worker")
        enabled = [(method, session) for method, session, _ in calls if method.endswith(".enable")]
        self.assertNotIn(("Runtime.enable", page), enabled)
        self.assertEqual({s for m, s in enabled if m == "Runtime.enable"}, workers)
        self.assertEqual({s for m, s in enabled if m == "Network.enable"}, {page})
        self.assertFalse([c for c in calls if c[0] == "Runtime.evaluate" and c[1] in workers])
        page_or_worker = workers | {page}
        popup = {expression for method, session, expression in calls
                 if method == "Runtime.evaluate" and session not in page_or_worker}
        self.assertEqual(popup, {"chrome.runtime.getManifest().name", "chrome.runtime.reload()"})


if __name__ == "__main__":
    unittest.main()
