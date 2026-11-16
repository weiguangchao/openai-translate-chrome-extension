import { MICROSOFT_ORIGIN } from '../shared/settings';

export class MicrosoftAccess {
  allowed = false;
  private version = 0;

  constructor(private revoked: () => void) {
    chrome.permissions.onRemoved.addListener(({ origins }) => {
      if (
        !origins?.some((origin) => {
          if (origin === '<all_urls>') return true;
          const host = origin.match(/^(?:\*|https):\/\/([^/]+)\//)?.[1];
          return (
            host === '*' ||
            host === 'edge.microsoft.com' ||
            (host?.startsWith('*.') && 'edge.microsoft.com'.endsWith(host.slice(1)))
          );
        })
      )
        return;
      this.version++;
      this.allowed = false;
      this.revoked();
      void this.refresh();
    });
    chrome.permissions.onAdded.addListener(() => void this.refresh());
  }

  async refresh(): Promise<void> {
    const version = ++this.version;
    let allowed = false;
    try {
      allowed = await chrome.permissions.contains({ origins: [`${MICROSOFT_ORIGIN}/*`] });
    } catch {}
    if (version !== this.version) return;
    const revoked = this.allowed && !allowed;
    this.allowed = allowed;
    if (revoked) this.revoked();
  }
}
