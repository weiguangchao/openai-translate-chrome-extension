export type TranslateFailure =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'copied-source' }
  | { readonly kind: 'error'; readonly message: string };

export function failureText(failure: TranslateFailure): string {
  switch (failure.kind) {
    case 'timeout':
      return '接口请求超时，请检查网络或更换响应更快的模型。';
    case 'copied-source':
      return '译文与原文相同。';
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

export function failureOf(error: unknown, fallback: string): TranslateFailure {
  if (error instanceof ProviderTimeoutError || error instanceof RepeatedSourceError)
    return error.failure;
  return { kind: 'error', message: error instanceof Error ? error.message : fallback };
}
