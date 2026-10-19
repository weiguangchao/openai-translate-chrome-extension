import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybackGate } from '../src/core/playback';
import { seekJumpSeconds, seekSettleMs } from '../src/shared/tuning';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('holds a jump and releases it only after the playhead stays still', async () => {
  const hooks = { hold: vi.fn(), changed: vi.fn() };
  const gate = new PlaybackGate(hooks);
  gate.observe(2);
  gate.observe(2 + seekJumpSeconds);
  expect(hooks.hold).not.toHaveBeenCalled();
  gate.observe(2 + seekJumpSeconds * 2 + 0.01);
  expect(gate.settling).toBe(true);
  expect(hooks.hold).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(seekSettleMs - 1);
  expect(gate.settling).toBe(true);
  gate.hold();
  await vi.advanceTimersByTimeAsync(seekSettleMs - 1);
  expect(gate.settling).toBe(true);
  expect(hooks.changed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(gate.settling).toBe(false);
  expect(hooks.changed).toHaveBeenCalledOnce();
});
