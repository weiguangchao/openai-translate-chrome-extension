import { t } from '../shared/i18n';
import { failureText } from '../shared/provider-error';
import type { PublicSettings } from '../shared/settings';

const LOADING_TRANSLATION = t('翻译中', 'Translating');
const TIMEOUT_TRANSLATION = t('接口调用超时', 'Request timed out');

export type TranslationLine =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly translation: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'timedOut' }
  | { readonly kind: 'repeated' }
  | { readonly kind: 'unsupported-language' };

export interface CaptionView {
  readonly original: string;
  readonly line: TranslationLine;
}

type Status = 'error' | null;

function lineContent(line: TranslationLine): { text: string; status: Status } {
  switch (line.kind) {
    case 'none':
      return { text: '', status: null };
    case 'loading':
      return { text: LOADING_TRANSLATION, status: null };
    case 'ready':
      return { text: line.translation, status: null };
    case 'failed':
      return { text: line.message, status: 'error' };
    case 'timedOut':
      return { text: TIMEOUT_TRANSLATION, status: 'error' };
    case 'unsupported-language':
      return { text: failureText({ kind: 'unsupported-language' }), status: 'error' };
    case 'repeated':
      return { text: '', status: null };
  }
}

function write(node: HTMLDivElement | null, text: string, status: Status): void {
  if (!node) return;
  node.classList.toggle('error', status === 'error');
  if (node.textContent !== text) node.textContent = text;
  node.hidden = !text;
}

const OVERLAY_STYLE =
  ':host{all:initial}.stack{position:absolute;left:50%;transform:translateX(-50%);width:max-content;max-width:92%;display:flex;flex-direction:column;align-items:center;padding:4px 12px;border-radius:3px;box-sizing:border-box;text-align:center;font-family:Arial,"PingFang SC",sans-serif;line-height:1.4;pointer-events:none}.stack:not(:has(>.line:not([hidden]))){display:none}.line{max-width:100%;padding:1px 0;white-space:normal;overflow-wrap:anywhere;text-shadow:0 1px 3px #000;box-sizing:border-box}.error{color:#ffcc00!important}';

export class SubtitleOverlay {
  private player: HTMLElement | null = null;
  private host: HTMLDivElement | null = null;
  private original: HTMLDivElement | null = null;
  private translation: HTMLDivElement | null = null;
  private positioned = false;
  private layers: HTMLElement[] = [];

  showsIn(player: HTMLElement): boolean {
    return this.player === player && Boolean(this.host?.isConnected);
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
    stack.append(this.original, this.translation);
    shadow.append(css, stack);
    this.updateStyle(settings);
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
    }
    const stack = this.host?.shadowRoot?.querySelector<HTMLElement>('.stack');
    if (stack) {
      stack.style.backgroundColor = `rgba(0,0,0,${settings.backgroundOpacity / 100})`;
      stack.style.gap = `${settings.subtitleGap}px`;
    }
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

  render(view: CaptionView): void {
    write(this.original, view.original, null);
    const { text, status } = lineContent(view.line);
    write(this.translation, text, status);
  }
}
