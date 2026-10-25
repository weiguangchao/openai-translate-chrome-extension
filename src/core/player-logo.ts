import logo from '../../public/logo.svg?raw';
import type { PlayerToolbar } from './platform';

export class PlayerLogo {
  private host = document.createElement('span');
  private icon = document.createElement('img');

  constructor() {
    this.host.dataset.sublineLogo = '';
    this.host.setAttribute('role', 'img');
    this.host.setAttribute('aria-label', 'Subline');
    this.host.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;align-self:center;vertical-align:middle;pointer-events:none;box-sizing:border-box;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    this.icon.src = `data:image/svg+xml,${encodeURIComponent(logo)}`;
    this.icon.alt = '';
    shadow.append(this.icon);
    this.icon.setAttribute('aria-hidden', 'true');
    this.icon.style.cssText = 'display:block;';
  }

  update(toolbar: PlayerToolbar | null): void {
    const native = toolbar?.button.querySelector('svg');
    if (!toolbar || !native) {
      this.unmount();
      return;
    }
    const button = toolbar.button.getBoundingClientRect();
    const canvas = native.getBoundingClientRect();
    const transform = native.getScreenCTM();
    if (!button.width || !button.height || !canvas.width || !canvas.height || !transform) {
      this.unmount();
      return;
    }
    const bounds = native.getBBox();
    const size = Math.max(
      bounds.width * Math.hypot(transform.a, transform.b),
      bounds.height * Math.hypot(transform.c, transform.d),
    );
    const style = getComputedStyle(toolbar.button);
    this.host.style.width = `${button.width}px`;
    this.host.style.height = `${button.height}px`;
    this.host.style.margin = style.margin;
    this.host.style.cssFloat = style.cssFloat;
    this.icon.style.width = `${size}px`;
    this.icon.style.height = `${size}px`;
    if (toolbar.container.firstElementChild !== this.host) toolbar.container.prepend(this.host);
  }

  unmount(): void {
    this.host.remove();
  }
}
