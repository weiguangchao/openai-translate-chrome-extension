import { afterEach, expect, it, vi } from 'vitest';
import { SubtitleOverlay } from '../src/core/overlay';
import { TraceReporter } from '../src/core/trace';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';
import { readTraceRequest, TRACE_ATTRIBUTE, TRACE_WORKER_ATTRIBUTE } from '../src/shared/trace';

afterEach(() => {
  document.documentElement.removeAttribute(TRACE_ATTRIBUTE);
  document.documentElement.removeAttribute(TRACE_WORKER_ATTRIBUTE);
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const video = (currentTime: number, paused = false) =>
  ({ currentTime, paused, seeking: false }) as HTMLVideoElement;

it('stays silent until the page opts in, then reports changes and a heartbeat while playing', () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const reporter = new TraceReporter(send, () => 'subline-id');
  const caption = { text: 'Sentence one.', cue: 3, start: 10, end: 14, segment: 0 };
  reporter.note(video(10.2), caption, 'loading');
  expect(send).not.toHaveBeenCalled();
  expect(document.documentElement.hasAttribute(TRACE_WORKER_ATTRIBUTE)).toBe(false);

  document.documentElement.setAttribute(TRACE_ATTRIBUTE, 'run-1');
  reporter.note(video(10.304), caption, 'loading');
  reporter.note(video(10.45), caption, 'loading');
  expect(document.documentElement.getAttribute(TRACE_WORKER_ATTRIBUTE)).toBe('subline-id');
  expect(send.mock.calls).toEqual([
    [
      {
        type: 'trace',
        run: 'run-1',
        time: 10.3,
        paused: false,
        seeking: false,
        state: 'loading',
        text: 'Sentence one.',
        cue: 3,
        start: 10,
        end: 14,
        segment: 0,
      },
    ],
  ]);
  reporter.note(video(11.1), caption, 'ready');
  expect(send).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(2000);
  reporter.note(video(13.1), caption, 'ready');
  expect(send).toHaveBeenCalledTimes(3);
  reporter.note(video(13.1, true), caption, 'ready');
  vi.advanceTimersByTime(5000);
  reporter.note(video(13.1, true), caption, 'ready');
  expect(send).toHaveBeenCalledTimes(4);
  reporter.note(video(13.2), null, 'empty');
  expect(send).toHaveBeenLastCalledWith({
    type: 'trace',
    run: 'run-1',
    time: 13.2,
    paused: false,
    seeking: false,
    state: 'empty',
  });
});

it('keeps only the known fields of a trace event and rejects malformed ones', () => {
  const event = {
    type: 'trace',
    run: 'run-1',
    time: 3.25,
    paused: false,
    seeking: false,
    state: 'ready',
    cue: 2,
    start: 1,
    end: 4,
    segment: 0,
    text: 'x'.repeat(80),
    settings: { apiKey: 'secret' },
  };
  expect(readTraceRequest(event)).toEqual({
    run: 'run-1',
    t: 3.25,
    state: 'ready',
    paused: false,
    seeking: false,
    cue: 2,
    start: 1,
    end: 4,
    seg: 0,
    text: 'x'.repeat(40),
  });
  expect(() => readTraceRequest({ ...event, state: 'shown' })).toThrow();
  expect(() => readTraceRequest({ ...event, run: '' })).toThrow();
  expect(() => readTraceRequest({ ...event, time: Number.NaN })).toThrow();
});

it('names what the translation line shows', () => {
  const player = document.createElement('div');
  document.body.append(player);
  const overlay = new SubtitleOverlay();
  expect(overlay.state).toBe('empty');
  overlay.mount(player, publicSettings(DEFAULT_SETTINGS));
  expect(overlay.state).toBe('empty');
  overlay.showLoading();
  expect(overlay.state).toBe('loading');
  overlay.showTranslation('你好');
  expect(overlay.state).toBe('ready');
  overlay.showTimeout();
  expect(overlay.state).toBe('timeout');
  const root = player.querySelector('[data-subline-overlay]')!.shadowRoot!;
  const translation = root.querySelector<HTMLElement>('.translation')!;
  expect(translation.classList.contains('timeout')).toBe(true);
  expect(translation.classList.contains('error')).toBe(false);
  expect(root.querySelector('style')!.textContent).toContain('.timeout{color:#ffcc00!important}');
  expect(translation.style.fontSize).toBe('20px');
  overlay.updateStyle(
    publicSettings({ ...DEFAULT_SETTINGS, translation: { color: '#112233', size: 18 } }),
  );
  expect(translation.classList.contains('timeout')).toBe(true);
  expect(translation.style.color).toBe('rgb(17, 34, 51)');
  expect(translation.style.fontSize).toBe('18px');
  overlay.showError('翻译失败。');
  expect(overlay.state).toBe('error');
  expect(translation.classList.contains('timeout')).toBe(false);
  overlay.showTimeout();
  expect(overlay.state).toBe('timeout');
  expect(translation.classList.contains('error')).toBe(false);
  overlay.showTranslation('你好');
  expect(overlay.state).toBe('ready');
  expect(translation.classList.contains('timeout')).toBe(false);
  expect(translation.style.color).toBe('rgb(17, 34, 51)');
  overlay.hideTranslation();
  expect(overlay.state).toBe('empty');
});
