import { useLayoutEffect, type RefObject } from 'react';

type Registration = { count: number; stop: () => void };
const lists = new WeakMap<HTMLElement, Registration>();
const height = (element: Element | null) => element instanceof HTMLElement
  ? Math.ceil(Math.max(element.offsetHeight, parseFloat(getComputedStyle(element).height) || 0)) : 0;

function register(list: HTMLElement) {
  const existing = lists.get(list);
  if (existing) { existing.count++; return; }
  let frame = 0;
  let stopped = false;
  const measure = () => {
    if (stopped) return;
    const cards = Array.from(list.querySelectorAll<HTMLElement>('.ov2-card'));
    if (!cards.length) return;
    let name = 0, marks = 0, avatar = 0, reference = 0, metadata = 0, stat = 0;
    for (const card of cards) {
      name = Math.max(name, height(card.querySelector('.ov2-name-content')));
      avatar = Math.max(avatar, height(card.querySelector('.ov2-avatar')));
      const markBox = card.querySelector('.ov2-c-marks');
      const extras = Math.max(height(card.querySelector('.ov2-mark-relation')), height(card.querySelector('.ov2-mark-loan')), height(card.querySelector('.ov2-mark-alert')));
      marks = Math.max(marks, height(card.querySelector('.ov2-mark-source')) + extras + (markBox ? parseFloat(getComputedStyle(markBox).rowGap) || 0 : 0));
      reference = Math.max(reference, height(card.querySelector('.ov2-reference-text')), height(card.querySelector('.ov2-c-ref svg')));
      const status = card.querySelector<HTMLElement>('.ov2-status');
      const statusStyle = status ? getComputedStyle(status) : null;
      const statusPadding = statusStyle ? (parseFloat(statusStyle.paddingTop) || 0) + (parseFloat(statusStyle.paddingBottom) || 0) : 0;
      metadata = Math.max(metadata, height(card.querySelector('.ov2-status-text')) + statusPadding, height(card.querySelector('.ov2-c-when')));
      for (const cell of card.querySelectorAll('.ov2-stats > div')) stat = Math.max(stat, height(cell));
    }
    const identity = list.classList.contains('grid') ? name + marks + 4 : Math.max(name, marks, avatar);
    for (const [part, value] of [['name', name], ['marks', marks], ['identity', identity], ['reference', reference], ['metadata', metadata], ['stat', stat]] as const) {
      const key = `--ov2-${part}-height`;
      const next = `${Math.ceil(value)}px`;
      if (list.style.getPropertyValue(key) !== next) list.style.setProperty(key, next);
    }
  };
  const schedule = () => {
    if (stopped || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; measure(); });
  };
  const resize = new ResizeObserver(schedule); resize.observe(list);
  const content = new MutationObserver(schedule); content.observe(list, { childList: true, characterData: true, subtree: true });
  const theme = new MutationObserver(schedule); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'dir'] });
  document.fonts?.addEventListener('loadingdone', schedule);
  void document.fonts?.ready?.then(schedule);
  lists.set(list, { count: 1, stop: () => {
    stopped = true; cancelAnimationFrame(frame); resize.disconnect(); content.disconnect(); theme.disconnect();
    document.fonts?.removeEventListener('loadingdone', schedule);
    for (const part of ['name', 'marks', 'identity', 'reference', 'metadata', 'stat']) list.style.removeProperty(`--ov2-${part}-height`);
  } });
  measure();
}

/** Reserve the tallest displayed name and field rows throughout a card list. */
export function useAlignedCardRows(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const list = ref.current?.closest<HTMLElement>('.orders-cards-list');
    if (!list) return;
    register(list);
    return () => {
      const registration = lists.get(list);
      if (registration && --registration.count === 0) { registration.stop(); lists.delete(list); }
    };
  }, [ref]);
}
