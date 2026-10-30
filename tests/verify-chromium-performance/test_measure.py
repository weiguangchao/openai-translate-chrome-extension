"""Measurement validity, evidence recovery and build restoration without Chrome."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import support  # noqa: F401
import live
import measure
import verify
import worker_trace


def collected():
    traces = {}
    for phase, seconds in zip(verify.PHASES, (45, 45, 180)):
        stats = {'complete': True, 'played': seconds, 'counted': seconds, 'playbackRate': 2,
                 'from': 300, 'to': 300 + seconds, 'firstCaptionAt': 300, 'firstReadyAt': 304,
                 'states': {'loading': 5, 'ready': 20},
                 'batches': {'p50': 3, 'p90': 8, 'measured': 10, 'results': {'ok': 10, 'aborted': 2}}}
        if phase != 'playing':
            stats['since'] = 'open' if phase == 'opening' else 'seek'
        traces[phase] = {'ok': True, 'stats': stats}
    return {'case': {'name': 'clip', 'rate': 2}, 'build': {'name': 'new'},
            'durations': dict(zip(verify.PHASES, (45, 45, 180))), 'traces': traces,
            'seek': {'seeks': 1}, 'seekTarget': 300, 'reloadVerified': True}


class Validity(unittest.TestCase):
    def test_valid_measurement_can_have_poor_performance(self):
        result = verify.assess(collected(), {'loadingWhilePlaying': 0.1})
        self.assertTrue(result['dataValid'])
        self.assertFalse(result['performancePassed'])
        self.assertEqual(result['metrics']['waitAfterSeeking'], 2)
        self.assertEqual(result['metrics']['providerP50'], 3)
        self.assertEqual(result['metrics']['providerResults'], {'ok': 10, 'aborted': 2})

    def test_missing_translation_or_successful_requests_is_not_zero(self):
        run = collected()
        for trace in run['traces'].values():
            trace['stats'].update(firstReadyAt=None, states={'loading': 45},
                                  batches={'measured': 0, 'p50': 0, 'p90': 0, 'results': {'aborted': 12}})
        result = verify.assess(run)
        self.assertTrue(result['dataValid'])
        for metric in ('waitAfterOpening', 'waitAfterSeeking', 'providerP50', 'providerP90'):
            self.assertIsNone(result['metrics'][metric])
        self.assertEqual(result['metrics']['loadingWhilePlaying'], 1)

    def test_invalid_clocks_and_incomplete_windows_are_rejected(self):
        for changes in ({'playbackRate': 1}, {'clock': 'throttled'}, {'sparse': True},
                        {'truncated': True}, {'clockTruncated': True}, {'clockMissing': True},
                        {'rateMismatch': True}, {'rateChanges': [{'from': 2, 'to': 1}]},
                        {'played': 40}, {'counted': 40}, {'complete': False}):
            with self.subTest(changes=changes):
                run = collected()
                run['traces']['playing']['stats'].update(changes)
                self.assertFalse(verify.assess(run)['dataValid'])

    def test_wrong_seek_mark_multiple_seeks_and_unverified_build_are_rejected(self):
        for key, value in [('seek', {'seeks': 2}), ('seekTarget', 900), ('reloadVerified', False)]:
            run = collected()
            run[key] = value
            self.assertFalse(verify.assess(run)['dataValid'])

    def test_opening_at_the_wrong_position_is_rejected(self):
        run = collected()
        run['case']['start'] = 60
        self.assertFalse(verify.assess(run)['dataValid'])


class Clock(unittest.TestCase):
    def test_each_window_ignores_earlier_rates_and_visibility(self):
        events = [{'at': 0, 'rate': 1, 'visible': 'hidden'},
                  {'at': 10000, 'rate': 2, 'visible': 'visible'},
                  {'at': 12000, 'rate': 2, 'visible': 'visible'}]
        stats = {'played': 20}
        worker_trace.media_clock(stats, events, 10000, 20000, 2)
        self.assertEqual(stats['playbackRate'], 2)
        self.assertEqual(stats['rates'], {'2': 10})
        self.assertEqual(stats['visible'], 1)
        self.assertNotIn('clock', stats)

    def test_brief_external_rate_reset_is_kept_even_if_the_average_looks_right(self):
        events = [{'at': 0, 'rate': 2, 'visible': 'visible'},
                  {'at': 5000, 'rate': 1, 'visible': 'visible'},
                  {'at': 5100, 'rate': 2, 'visible': 'visible'}]
        stats = {'played': 19.9}
        worker_trace.media_clock(stats, events, 0, 10000, 2)
        self.assertEqual(stats['rates'], {'2': 9.9, '1': 0.1})
        self.assertEqual(len(stats['rateChanges']), 2)
        self.assertTrue(stats['rateMismatch'])


class Recovery(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.loaded = self.build('loaded', 'original')
        self.source = self.build('new', 'updated')
        self.output = self.root / 'output'
        self.output.mkdir()
        self.plan = {'cases': [], 'durations': {}}

    def build(self, name, content):
        path = self.root / name
        path.mkdir()
        (path / 'manifest.json').write_text(json.dumps({'name': 'Subline'}))
        (path / 'background.js').write_text(content)
        return path

    def test_resume_keeps_original_backup_and_rejects_changed_inputs(self):
        manifest = measure.prepare(self.output, self.plan, [('new', self.source)], self.loaded, False)
        live.sync(self.source, self.loaded)
        self.assertEqual(measure.prepare(self.output, self.plan, [('new', self.source)], self.loaded, True), manifest)
        (self.source / 'background.js').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'changed'):
            measure.prepare(self.output, self.plan, [('new', self.source)], self.loaded, True)
        self.assertEqual((self.output / 'original-build/background.js').read_text(), 'original')

    def test_restore_files_after_connection_loss_but_report_reload_failure(self):
        manifest = measure.prepare(self.output, self.plan, [('new', self.source)], self.loaded, False)
        live.sync(self.source, self.loaded)
        commands = Mock()
        commands.call.side_effect = measure.CommandError('disconnected')
        with patch.object(live, 'load_state', return_value=None):
            result = measure.restore(commands, self.output, self.loaded, manifest)
        self.assertTrue(result['filesRestored'])
        self.assertFalse(result['reloadVerified'])

    def test_restore_does_not_overwrite_another_build(self):
        manifest = measure.prepare(self.output, self.plan, [('new', self.source)], self.loaded, False)
        (self.loaded / 'background.js').write_text('external change')
        with patch.object(live, 'load_state', return_value=None):
            result = measure.restore(Mock(), self.output, self.loaded, manifest)
        self.assertFalse(result['filesRestored'])
        self.assertEqual((self.loaded / 'background.js').read_text(), 'external change')

    def test_recover_completed_and_interrupted_runs_without_summary(self):
        run = collected()
        measure.write_json(self.output / 'runs/clip/new/1/run.json', run)
        partial = copy.deepcopy(run)
        del partial['traces']['playing']
        measure.write_json(self.output / 'runs/clip/new/2/run.json', partial)
        results = measure.recover_runs(self.output)
        self.assertEqual([r['assessment']['dataValid'] for r in results], [True, False])

    def test_seek_avoids_opening_prefetch_and_the_video_end(self):
        opening = {'stats': {'from': 0, 'to': 45}, 'batches': [{'start': 70, 'end': 210}]}
        self.assertEqual(measure.choose_seek([120, 600, 300], opening, 800, 225), 300)
        with self.assertRaisesRegex(ValueError, 'no candidate'):
            measure.choose_seek([120, 600], opening, 800, 225)


if __name__ == '__main__':
    unittest.main()
