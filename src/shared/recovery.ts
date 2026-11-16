import { readStoredTranslation } from './caption-translation';
import { readTranslateRequest, type TranslateRequest } from './messages';

export const RECOVERY_PORT = 'subline-recovery:';

export interface RecoveryRequest extends TranslateRequest {
  revision: string;
  paused: boolean;
}

export type RecoveryEvent =
  { type: 'sync' | 'sent' | 'ended' } | { type: 'translation'; translation: string };

export function recoveryRequest(name: string): RecoveryRequest {
  const value: unknown = JSON.parse(name.slice(RECOVERY_PORT.length));
  if (!value || typeof value !== 'object') throw new Error('Invalid recovery request');
  const { paused, revision } = value as Record<string, unknown>;
  if (typeof paused !== 'boolean' || typeof revision !== 'string')
    throw new Error('Invalid recovery state');
  return { ...readTranslateRequest(value), paused, revision };
}

export function recoveryEvent(value: unknown): RecoveryEvent | null {
  if (!value || typeof value !== 'object') return null;
  const { type, translation } = value as Record<string, unknown>;
  if (type === 'sync' || type === 'sent' || type === 'ended') return { type };
  const text = readStoredTranslation(translation);
  return type === 'translation' && text !== null ? { type, translation: text } : null;
}
