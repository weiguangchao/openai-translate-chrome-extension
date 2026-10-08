import type { PublicSettings } from '../shared/settings';
import type { ViewState } from '../shared/trace';

const LOADING_TRANSLATION = '翻译中';
const TIMEOUT_TRANSLATION = '接口调用超时';
const OVERLAY_STYLE =
  ':host{all:initial}.stack{position:absolute;left:4%;width:92%;text-align:center;font-family:Arial,"PingFang SC",sans-serif;line-height:1.4;pointer-events:none}.line{width:fit-content;max-width:100%;margin-inline:auto;padding:1px 8px;border-radius:3px;white-space:normal;overflow-wrap:anywhere;text-shadow:0 1px 3px #000;box-sizing:border-box}.error{font-size:13px!important;color:#ffe3b0!important}.timeout{color:#ffcc00!important}';

export class SubtitleOverlay {
  player: HTMLElement | null = null;
  private host: HTMLDivElement | null = null;
  private original: HTMLDivElement | null = null;
  private translation: HTMLDivElement | null = null;
  private positioned = false;
  private layers: HTMLElement[] = [];

  get mounted(): boolean {
    return Boolean(this.host);
  }

  get connected(): boolean {
    return Boolean(this.host?.isConnected);
  }

  get failed(): boolean {
    return Boolean(this.translation?.classList.contains('error'));
  }

  get state(): ViewState {
    const text = this.translation && !this.translation.hidden ? this.translation.textContent : '';
    if (!text) return 'empty';
    if (this.failed) return 'error';
    if (text === LOADING_TRANSLATION) return 'loading';
    return text === TIMEOUT_TRANSLATION ? 'timeout' : 'ready';
  }

  mount(player: HTMLElement, settings: PublicSettings): void {
    this.unmount();
    this.player = player;
    this.positioned = getComputedStyle(player).position === 'static';
    if (this.positioned) player.style.position = 'relative';
    player.classList.add('subline-player');
    this.host = document.createElement('div');
    this.host.dataset.sublineOverlay = '';
    this.host.style.cssText =
      'position:absolute;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const css = document.createElement('style');
    css.textContent = OVERLAY_STYLE;
    const stack = document.createElement('div');
    stack.className = 'stack';
    stack.style.bottom = '9%';
    this.original = document.createElement('div');
    this.original.className = 'line original';
    this.translation = document.createElement('div');
    this.translation.className = 'line translation';
    for (const node of [this.original, this.translation]) {
      node.setAttribute('dir', 'auto');
      node.hidden = true;
    }
    this.updateStyle(settings);
    stack.append(this.original, this.translation);
    shadow.append(css, stack);
    player.append(this.host);
  }

  updateStyle(settings: PublicSettings): void {
    for (const [node, style] of [
      [this.original, settings.original],
      [this.translation, settings.translation],
    ] as const) {
      if (!node) continue;
      node.style.color = style.color;
      node.style.fontSize = `${style.size}px`;
      node.style.backgroundColor = `rgba(0,0,0,${settings.backgroundOpacity / 100})`;
    }
    if (this.translation) this.translation.style.marginTop = `${settings.subtitleGap}px`;
  }

  unmount(): void {
    this.hide([]);
    if (this.player) {
      this.player.classList.remove('subline-player');
      if (this.positioned && this.player.style.position === 'relative')
        this.player.style.removeProperty('position');
    }
    this.host?.remove();
    this.player = null;
    this.host = null;
    this.original = null;
    this.translation = null;
    this.positioned = false;
  }

  hide(layers: readonly HTMLElement[]): void {
    const next = new Set(layers);
    for (const element of this.layers) {
      if (!next.has(element)) element.removeAttribute('data-subline-caption');
    }
    for (const element of next) element.setAttribute('data-subline-caption', '');
    this.layers = [...next];
  }

  showOriginal(text: string): void {
    if (!this.original) return;
    if (this.original.textContent !== text) this.original.textContent = text;
    this.original.hidden = !text;
  }

  showTranslation(text: string): void {
    if (!this.translation) return;
    this.translation.classList.remove('error', 'timeout');
    if (this.translation.textContent !== text) this.translation.textContent = text;
    this.translation.hidden = !text;
  }

  showLoading(): void {
    this.showStatus(LOADING_TRANSLATION, false);
  }

  showTimeout(): void {
    this.showStatus(TIMEOUT_TRANSLATION, true);
  }

  private showStatus(text: string, timeout: boolean): void {
    const node = this.translation;
    if (!node) return;
    if (
      node.textContent === text &&
      !node.hidden &&
      !this.failed &&
      node.classList.contains('timeout') === timeout
    )
      return;
    node.classList.remove('error');
    node.classList.toggle('timeout', timeout);
    node.textContent = text;
    node.hidden = false;
  }

  clearLoading(): void {
    if (this.translation?.textContent === LOADING_TRANSLATION) this.hideTranslation();
  }

  showError(message: string): void {
    if (!this.translation) return;
    this.translation.textContent = `Subline：${message}`;
    this.translation.classList.remove('timeout');
    this.translation.classList.add('error');
    this.translation.hidden = false;
  }

  hideTranslation(): void {
    if (!this.translation) return;
    this.translation.classList.remove('error', 'timeout');
    this.translation.textContent = '';
    this.translation.hidden = true;
  }

  clear(): void {
    this.hideTranslation();
    this.showOriginal('');
  }
}
