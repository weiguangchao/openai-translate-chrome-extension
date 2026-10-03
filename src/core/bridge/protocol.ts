import type { PlatformId } from '../../shared/platforms';
import { copyCues, validCues, type TimedCue } from '../cues';

export type SourceMode = 'checking' | 'model';

export interface TimelineState {
  mode: SourceMode;
  source: TimedCue[] | null;
  sourceId?: string;
}

export interface TimelineRequest {
  videoId: string;
  sourceLanguage: string;
}

export function bridgeMessages(channel: PlatformId) {
  return {
    request: `subline:${channel}-timeline-request`,
    response: `subline:${channel}-timeline-response`,
    stop: `subline:${channel}-timeline-stop`,
  } as const;
}

export function readTimelineState(value: unknown): TimelineState | null {
  const state = value as Partial<Record<keyof TimelineState, unknown>> | null;
  if (
    !state ||
    (state.mode !== 'checking' && state.mode !== 'model') ||
    (state.source !== null && !validCues(state.source))
  )
    return null;
  return {
    mode: state.mode,
    source: state.source === null ? null : copyCues(state.source),
    sourceId: typeof state.sourceId === 'string' ? state.sourceId : undefined,
  };
}
