/**
 * Ref callback for a list drawn in a portal on document.body. An open Radix dialog
 * locks scrolling for everything outside its own content by cancelling wheel and
 * touchmove events at the document, which also kills scrolling inside such a list.
 * Stopping those two events at the list itself keeps them from reaching that lock,
 * so the browser scrolls the list natively.
 */
export function isolateScroll(node: HTMLElement | null): void {
  if (!node || (node as HTMLElement & { __isolated?: boolean }).__isolated) return;
  (node as HTMLElement & { __isolated?: boolean }).__isolated = true;
  const stop = (e: Event) => e.stopPropagation();
  node.addEventListener('wheel', stop, { passive: true });
  node.addEventListener('touchmove', stop, { passive: true });
}
