export const providerTimeoutMessage = '接口请求超时，请检查网络或更换响应更快的模型。';
export const repeatedSourceMessage = '译文与原文相同。';

export class ProviderTimeoutError extends Error {
  constructor() {
    super(providerTimeoutMessage);
    this.name = 'ProviderTimeoutError';
  }
}

export class RepeatedSourceError extends Error {
  constructor() {
    super(repeatedSourceMessage);
    this.name = 'RepeatedSourceError';
  }
}
