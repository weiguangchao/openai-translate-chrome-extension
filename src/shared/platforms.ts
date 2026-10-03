export type PlatformId = 'youtube' | 'hbo';

export interface PlatformSite {
  id: PlatformId;
  domains: readonly string[];
  matches: readonly string[];
}

export const PLATFORMS: readonly PlatformSite[] = [
  {
    id: 'youtube',
    domains: ['youtube.com'],
    matches: ['https://www.youtube.com/*', 'https://m.youtube.com/*'],
  },
  {
    id: 'hbo',
    domains: ['max.com', 'hbomax.com', 'hbo.com'],
    matches: ['https://*.max.com/*', 'https://*.hbomax.com/*', 'https://*.hbo.com/*'],
  },
];

export const platformMatches = PLATFORMS.flatMap((platform) => platform.matches);

export function platformForUrl(value: string | undefined): PlatformId | undefined {
  try {
    const url = new URL(value ?? '');
    if (url.protocol !== 'https:') return;
    return PLATFORMS.find((platform) =>
      platform.domains.some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      ),
    )?.id;
  } catch {
    return;
  }
}
