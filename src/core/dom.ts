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
