import { afterEach, expect, it, vi } from 'vitest';
import { BridgeTimeline } from '../src/core/bridge/client';

let timeline: BridgeTimeline | undefined;

afterEach(() => {
  timeline?.destroy();
  timeline = undefined;
  vi.restoreAllMocks();
});

it.each(['request-id', 'origin', 'source', 'cue-timing'] as const)(
  'accepts a matching timeline and rejects a reply with invalid %s',
  (invalid) => {
    const changed = vi.fn();
    const send = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    timeline = new BridgeTimeline('hbo', changed);
    timeline.read('video', 'en');
    const request = send.mock.calls[0][0] as { requestId: number };
    const accepted = [{ startTime: 1, endTime: 3, text: 'Accepted caption.' }];
    const response = {
      type: 'subline:hbo-timeline-response',
      requestId: request.requestId,
      revision: 1,
      state: { mode: 'model', source: accepted },
    };
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: response,
      }),
    );
    expect(changed).toHaveBeenCalledOnce();
    expect(timeline.read('video', 'en')?.source).toEqual(accepted);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: invalid === 'source' ? null : window,
        origin: invalid === 'origin' ? 'https://untrusted.example' : location.origin,
        data: {
          ...response,
          requestId: invalid === 'request-id' ? request.requestId + 1 : request.requestId,
          revision: 2,
          state: {
            mode: 'model',
            source: [
              {
                startTime: 2,
                endTime: invalid === 'cue-timing' ? 1 : 4,
                text: 'Rejected caption.',
              },
            ],
          },
        },
      }),
    );
    expect(changed).toHaveBeenCalledOnce();
    expect(timeline.read('video', 'en')?.source).toEqual(accepted);
  },
);
