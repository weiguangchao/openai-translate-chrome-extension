"""What chrome-debug reads from Subline, checked against Subline's source and the test double.

The browser tests run against tests/fixtures/extension. These checks keep that
double, holder.py and Subline speaking the same protocol, so a rename in
Subline fails here instead of making every trace report "no trace events".
"""
import json
import re
import unittest

from support import FIXTURES, REPO

import holder
import worker_trace


def source(path):
    file = REPO / path
    if not file.exists():
        raise unittest.SkipTest(f"{path} is not beside this skill")
    return file.read_text()


def constant(text, name):
    match = re.search(rf"\b{name}\s*=\s*(['\"])(.*?)\1", text) or re.search(rf"\b{name}\s*=\s*(\d+)", text)
    if not match:
        raise AssertionError(f"{name} not found")
    return match.group(match.lastindex)


class SublineContract(unittest.TestCase):

    def test_trace_names(self):
        trace = source("src/shared/trace.ts")
        self.assertEqual(constant(trace, "TRACE_PREFIX"), holder.TRACE_PREFIX)
        self.assertEqual(constant(trace, "TRACE_ATTRIBUTE"), holder.TRACE_ATTRIBUTE)
        self.assertEqual(constant(trace, "TRACE_WORKER_ATTRIBUTE"), holder.TRACE_WORKER_ATTRIBUTE)

    def test_view_event_fields(self):
        trace = source("src/shared/trace.ts")
        self.assertIn("const event: TraceEvent = { run, t: time, state, paused, seeking };", trace)
        for field, value in (("cue", "cue"), ("start", "start"), ("seg", "segment"), ("text", "text")):
            self.assertIn(f"event.{field} = {value}", trace)
        self.assertIn("printTrace({ e: 'view', tab: consumer,", source("src/extension/background.ts"))

    def test_batch_events(self):
        queue = source("src/extension/queue.ts")
        for kind in ("batch", "sent", "first", "done"):
            self.assertRegex(queue, rf"e: '{kind}',?\s*id")
        for field in ("tab: first.consumer", "size: batch.length", "start,", "end,"):
            self.assertIn(field, queue)

    def test_heartbeat_fits_inside_a_trace_gap(self):
        """61030c9: views 2 s of wall time apart must stay continuous at any rate."""
        heartbeat = int(constant(source("src/core/trace.ts"), "HEARTBEAT_MS")) / 1000
        self.assertTrue(worker_trace.continuous(heartbeat * worker_trace.MAX_RATE, heartbeat))

    def test_overlay(self):
        overlay = source("src/core/overlay.ts")
        self.assertEqual(constant(overlay, "LOADING_TRANSLATION"), holder.LOADING_TEXT)
        self.assertIn("this.host.dataset.sublineOverlay = ''", overlay)
        self.assertIn("attachShadow({ mode: 'open' })", overlay)
        self.assertIn("className = 'line original'", overlay)
        self.assertIn("className = 'line translation'", overlay)
        self.assertIn("classList.contains('error')", overlay)
        for selector in ("[data-subline-overlay]", ".original", ".translation", "classList.contains('error')"):
            self.assertIn(selector, holder.OVERLAY)

    def test_manifest(self):
        manifest = json.loads(source("public/manifest.json"))
        self.assertTrue(manifest["name"].startswith(holder.SUBLINE_NAME))
        self.assertEqual(manifest["background"]["service_worker"], "background.js")
        self.assertEqual(manifest["action"]["default_popup"], "popup.html")


class TestDouble(unittest.TestCase):

    def setUp(self):
        folder = FIXTURES / "extension"
        self.content = (folder / "content.js").read_text()
        self.background = (folder / "background.js").read_text()
        self.manifest = json.loads((folder / "manifest.json").read_text())

    def test_speaks_the_same_protocol(self):
        self.assertEqual(constant(self.background, "TRACE_PREFIX"), holder.TRACE_PREFIX)
        self.assertEqual(constant(self.content, "TRACE_ATTRIBUTE"), holder.TRACE_ATTRIBUTE)
        self.assertEqual(constant(self.content, "TRACE_WORKER_ATTRIBUTE"), holder.TRACE_WORKER_ATTRIBUTE)
        self.assertEqual(constant(self.content, "LOADING_TRANSLATION"), holder.LOADING_TEXT)
        self.assertTrue(self.manifest["name"].startswith(holder.SUBLINE_NAME))
        self.assertEqual(self.manifest["background"]["service_worker"], "background.js")
        self.assertEqual(self.manifest["action"]["default_popup"], "popup.html")

    def test_matches_subline_where_subline_is_present(self):
        try:
            subline = source("src/core/trace.ts")
        except unittest.SkipTest:
            return
        self.assertEqual(constant(self.content, "HEARTBEAT_MS"), constant(subline, "HEARTBEAT_MS"))


if __name__ == "__main__":
    unittest.main()
