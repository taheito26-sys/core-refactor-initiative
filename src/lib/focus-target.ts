export function focusElementBySelectors(selectors: string[], highlightClass = 'ring-2 ring-primary/60') {
  const target = selectors
    .map((selector) => document.querySelector(selector) as HTMLElement | null)
    .find(Boolean);
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightClass.split(' ').forEach((cls) => target.classList.add(cls));
  window.setTimeout(() => highlightClass.split(' ').forEach((cls) => target.classList.remove(cls)), 2200);
  return true;
}
