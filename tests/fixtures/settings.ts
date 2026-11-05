import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings';

export const consentedSettings: Settings = {
  ...DEFAULT_SETTINGS,
  provider: 'openai',
  providerConsent: 'https://api.openai.com',
};
