function ancestor(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
}
export function visible(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = ancestor(node)) {
    const style = getComputedStyle(node);
    const replaced = node.matches('[data-subline-caption]');
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      (style.opacity === '0' && !replaced)
    )
      return false;
  }
  return true;
}
function within(node: Node, ancestorNode: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === ancestorNode) return true;
    current = current instanceof ShadowRoot ? current.host : current.parentNode;
  }
  return false;
}
function flatText(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}
export function domCaptionText(element: HTMLElement): string {
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof HTMLElement) || !visible(node)) return '';
    if (node.tagName === 'BR') return ' ';
    const text = [...node.childNodes].map(read).join('');
    return /^(block|flex|grid|list-item|table)/.test(getComputedStyle(node).display)
      ? ` ${text} `
      : text;
  };
  return read(element).replace(/\s+/g, ' ').trim();
}
function playerElements(root: ParentNode): HTMLElement[] {
  const elements = [...root.querySelectorAll<HTMLElement>('*')].filter(
    (element) => !element.closest('[data-subline-overlay]'),
  );
  return [
    ...elements,
    ...elements.flatMap((element) =>
      element.shadowRoot ? playerElements(element.shadowRoot) : [],
    ),
  ];
}
function cueBoxes(nodes: HTMLElement[], playerRect: DOMRect): HTMLElement[] {
  const limit = playerRect.height * 0.5;
  const boxes = nodes.filter((node) => {
    if (!visible(node) || !flatText(node)) return false;
    const rect = node.getBoundingClientRect();
    return (
      rect.width > 1 &&
      rect.height > 1 &&
      rect.height <= limit &&
      rect.bottom > playerRect.top + 1 &&
      rect.top < playerRect.bottom - 1
    );
  });
  if (!boxes.length) return [];
  const lowest = Math.max(...boxes.map((node) => node.getBoundingClientRect().bottom));
  const slack = Math.max(96, playerRect.height * 0.2);
  const aligned = boxes.filter((node) => lowest - node.getBoundingClientRect().bottom <= slack);
  return aligned.filter((node) => !aligned.some((other) => other !== node && within(node, other)));
}
export function captionBoxes(player: HTMLElement, source: HTMLElement): HTMLElement[] {
  const playerRect = player.getBoundingClientRect();
  if (playerRect.height <= 1) return [];
  const inside = cueBoxes([source, ...playerElements(source)], playerRect);
  const insideBottom = inside.length
    ? Math.max(...inside.map((node) => node.getBoundingClientRect().bottom)) - playerRect.top
    : null;
  if (inside.length && insideBottom !== null && insideBottom > playerRect.height * 0.35)
    return inside;
  const text = flatText(source);
  if (!text) return inside;
  const outside = cueBoxes(
    playerElements(player).filter(
      (node) => !within(node, source) && !within(source, node) && flatText(node) === text,
    ),
    playerRect,
  ).filter((node) => node.getBoundingClientRect().top - playerRect.top > playerRect.height * 0.35);
  return outside.length ? outside : inside;
}
