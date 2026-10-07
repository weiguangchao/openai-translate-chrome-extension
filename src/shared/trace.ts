export const TRACE_ATTRIBUTE = 'data-subline-trace';
export const TRACE_WORKER_ATTRIBUTE = 'data-subline-trace-worker';
export const TRACE_PREFIX = '[subline] ';
export const TRACE_TEXT_LIMIT = 40;

export type ViewState = 'empty' | 'loading' | 'ready' | 'timeout' | 'error';
const VIEW_STATES: readonly string[] = ['empty', 'loading', 'ready', 'timeout', 'error'];

export interface TraceRequest {
  type: 'trace';
  run: string;
  time: number;
  paused: boolean;
  seeking: boolean;
  state: ViewState;
  cue?: number;
  start?: number;
  end?: number;
  segment?: number;
  text?: string;
}

export type TraceEvent = Record<string, string | number | boolean | null>;

export function printTrace(event: TraceEvent): void {
  console.debug(TRACE_PREFIX + JSON.stringify(event));
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function readTraceRequest(message: object): TraceEvent {
  const { run, time, paused, seeking, state, cue, start, end, segment, text } = message as Record<
    string,
    unknown
  >;
  if (
    typeof run !== 'string' ||
    !run ||
    run.length > 64 ||
    !finite(time) ||
    typeof paused !== 'boolean' ||
    typeof seeking !== 'boolean' ||
    typeof state !== 'string' ||
    !VIEW_STATES.includes(state)
  )
    throw new Error('调试事件无效。');
  const event: TraceEvent = { run, t: time, state, paused, seeking };
  if (Number.isSafeInteger(cue) && (cue as number) >= 0) event.cue = cue as number;
  if (finite(start)) event.start = start;
  if (finite(end)) event.end = end;
  if (Number.isSafeInteger(segment) && (segment as number) >= 0) event.seg = segment as number;
  if (typeof text === 'string' && text) event.text = text.slice(0, TRACE_TEXT_LIMIT);
  return event;
}
