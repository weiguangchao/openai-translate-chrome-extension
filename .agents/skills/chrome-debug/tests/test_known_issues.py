"""Problems agents hit with chrome-debug that the current scripts still have.

Each test states the behaviour chrome-debug should have and is marked
expectedFailure. When a fix lands, its test passes, unittest reports an
unexpected success and the run fails until the marker is removed, so the fix
stays covered. Thread ids are T3 Code sessions where the problem showed up.
"""
import contextlib
import io
import socket
import threading
import time
import unittest
from unittest.mock import patch

from support import SESSION, BrowserCase, step

import holder
import worker_trace as wt


class Steps(BrowserCase):

    @unittest.expectedFailure
    def test_evaluate_fails_once_the_budget_is_spent(self):
        """43f82664: with a 2 s budget, a Promise that resolved at 5 s passed at 5.2 s.

        Tab.until accepts a value before it checks the deadline, and each
        evaluate waits up to 8 s whatever time is left.
        """
        tab = self.open("slow-evaluate")
        done = self.do(tab, timeout=2, action="evaluate",
                       expression="new Promise((resolve) => setTimeout(() => resolve(true), 5000))")
        self.assertEqual(done.code, 1, done)

    @unittest.expectedFailure
    def test_overlay_wait_needs_an_overlay_the_viewer_can_see(self):
        """43f82664: overlay wait passed while the overlay host had display:none.

        OVERLAY reads each line's hidden flag and ignores the host's CSS.
        """
        tab = self.open("hidden-overlay", hidden=1)
        self.result(self.do(tab, action="media", time=40, play=True))
        self.assertEqual(self.do(tab, timeout=6, action="overlay", wait=True).code, 1)

    @unittest.expectedFailure
    def test_a_rate_the_page_keeps_resetting_is_reported(self):
        """21caa5fc: page events showed 1x and 1.5x every other second; media and trace said 1.5.

        The watch probe sets the rate and reads it back in the same poll, and
        played/wall averaged about 1.25x, inside the 20% the clock allows.
        """
        tab = self.open("rate-fight", trace=True, ratefight=1)
        self.result(self.do(tab, action="media", rate=1.5, play=True))
        stats = self.result(self.do(tab, action="trace", seconds=12))["stats"]
        self.assertTrue(stats.get("clock") == "throttled" or stats["playbackRate"] != 1.5, stats)

    @unittest.expectedFailure
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


class Status(BrowserCase):

    @unittest.expectedFailure
    def test_status_answers_while_a_step_runs(self):
        """43f82664, b11662a7 and 43c2b370: status waited for the running step, or 15 s.

        Holder.serve handles one client at a time.
        """
        tab = self.open("busy")
        waiting = self.live.spawn("do", tab, step(action="wait", seconds=10), session=SESSION)
        self.addCleanup(waiting.communicate)
        time.sleep(1)
        started = time.monotonic()
        self.call("status", session=None)
        self.assertLess(time.monotonic() - started, 3)


class KilledClient(BrowserCase):

    @unittest.expectedFailure
    def test_a_killed_client_frees_its_tab(self):
        """05ab845b and 43c2b370: the client died at 01:06:32; the holder noticed at 01:07:28.

        The holder only finds out when it writes the next 30 s progress line,
        and serves nobody else until then.
        """
        tab = self.open("killed")
        waiting = self.live.spawn("do", tab, step(action="wait", seconds=60), "--timeout", 90, session=SESSION)
        time.sleep(1)
        waiting.kill()
        waiting.communicate()
        self.assertEqual(self.call("do", tab, step(action="media"), timeout=5).code, 0)


class Batches(unittest.TestCase):

    @unittest.expectedFailure
    def test_batch_stats_leave_out_batches_finished_before_the_trace(self):
        """43d03e2b: the 180 s trace listed 36 requests, 15 of them from the landing trace.

        summarize collects every batch of the tab and never looks at started.
        """
        view = {"e": "view", "run": "r", "tab": "1:0", "t": 50, "state": "ready", "paused": False,
                "seeking": False, "cue": 3, "start": 49}
        events = [
            (0, {"e": "batch", "id": 1, "tab": "1:0", "size": 4, "start": 0, "end": 16}),
            (100, {"e": "sent", "id": 1}),
            (900, {"e": "done", "id": 1, "result": "ok"}),
            (5000, {"e": "batch", "id": 2, "tab": "1:0", "size": 4, "start": 48, "end": 64}),
            (5100, {"e": "sent", "id": 2}),
            (5900, {"e": "done", "id": 2, "result": "ok"}),
            (6000, view),
            (7000, {**view, "t": 51}),
        ]
        self.assertEqual(wt.summarize(events, "r", 4000, 1.0)["stats"]["batches"]["count"], 1)


class Handshake(unittest.TestCase):

    @unittest.expectedFailure
    def test_no_click_by_hand_warning_after_chrome_accepted(self):
        """43d03e2b, 29bba869, 21caa5fc and others.

        "Could not click Allow automatically (osascript timed out). Click it by
        hand." was followed in the same second by "Ready.": handshake runs the
        Allow script before it looks at the socket again.
        """
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        self.addCleanup(server.close)

        def accept_late():
            connection, _ = server.accept()
            self.addCleanup(connection.close)
            connection.recv(4096)
            time.sleep(2.5)
            connection.sendall(b"HTTP/1.1 101 Switching Protocols\r\n\r\n")

        threading.Thread(target=accept_late, daemon=True).start()

        def slow_click():
            time.sleep(1.5)
            return "osascript timed out"

        errors = io.StringIO()
        with patch.object(holder, "click_allow", slow_click), contextlib.redirect_stderr(errors):
            holder.handshake(server.getsockname()[1], "/devtools/browser/test").close()
        self.assertNotIn("Click it by hand", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
