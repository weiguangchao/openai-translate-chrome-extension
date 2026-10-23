import { t } from './i18n';
export type TranslateFailure =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'copied-source' }
  | { readonly kind: 'unsupported-language' }
  | { readonly kind: 'error'; readonly message: string };

export function failureText(failure: TranslateFailure): string {
  switch (failure.kind) {
    case 'timeout':
      return t(
        '接口请求超时，请检查网络或更换响应更快的模型。',
        'The request timed out. Check your network or choose a faster model.',
      );
    case 'unsupported-language':
      return t('原文语言不支持', 'Unsupported subtitle language');
    case 'copied-source':
      return t('译文与原文相同。', 'The translation matches the source text.');
    case 'error':
      return failure.message;
  }
}

export class ProviderTimeoutError extends Error {
  readonly failure = { kind: 'timeout' } as const;
  constructor() {
    super(failureText({ kind: 'timeout' }));
    this.name = 'ProviderTimeoutError';
  }
}

export class RepeatedSourceError extends Error {
  readonly failure = { kind: 'copied-source' } as const;
  constructor() {
    super(failureText({ kind: 'copied-source' }));
    this.name = 'RepeatedSourceError';
  }
}

export class UnsupportedLanguageError extends Error {
  readonly failure = { kind: 'unsupported-language' } as const;
  constructor() {
    super(failureText({ kind: 'unsupported-language' }));
    this.name = 'UnsupportedLanguageError';
  }
}

export function failureOf(error: unknown, fallback: string): TranslateFailure {
  if (
    error instanceof ProviderTimeoutError ||
    error instanceof RepeatedSourceError ||
    error instanceof UnsupportedLanguageError
  )
    return error.failure;
  return { kind: 'error', message: error instanceof Error ? error.message : fallback };
}
