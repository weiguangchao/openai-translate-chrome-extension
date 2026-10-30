"""Regression tests for problems reported in T3 Code sessions.

Thread ids identify the sessions that originally exposed each problem.
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


class Steps(BrowserCase):

    def test_evaluate_fails_once_the_budget_is_spent(self):
        """43f82664: with a 2 s budget, a Promise that resolved at 5 s passed at 5.2 s.

        Tab.until accepts a value before it checks the deadline, and each
        evaluate waits up to 8 s whatever time is left.
        """
        tab = self.open("slow-evaluate")
        started = time.monotonic()
        done = self.do(tab, timeout=2, action="evaluate",
                       expression="new Promise((resolve) => setTimeout(() => resolve(true), 5000))")
        self.assertEqual(done.code, 1, done)
        self.assertLess(time.monotonic() - started, 3)

    def test_overlay_wait_needs_an_overlay_the_viewer_can_see(self):
        """43f82664: overlay wait passed while the overlay host had display:none.

        OVERLAY reads each line's hidden flag and ignores the host's CSS.
        """
        tab = self.open("hidden-overlay", hidden=1)
        self.result(self.do(tab, action="media", time=40, play=True))
        self.assertEqual(self.do(tab, timeout=6, action="overlay", wait=True).code, 1)


class Status(BrowserCase):

    def test_status_answers_while_a_step_runs(self):
        """43f82664, b11662a7 and 43c2b370: status waited for the running step, or 15 s.

        Holder.serve handles one client at a time.
        """
        tab = self.open("busy")
        waiting = self.live.spawn("do", tab, step(action="wait", seconds=10), session=SESSION)
        self.addCleanup(waiting.communicate)
        time.sleep(1)
        started = time.monotonic()
        status = self.call("status", session=None)
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(status.json['state'], 'running')
        self.assertEqual(status.json['active']['tab'], tab)


class KilledClient(BrowserCase):

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


class Handshake(unittest.TestCase):

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
