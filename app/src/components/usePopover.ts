import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

/**
 * A small menu that drops down from a button (account menu, a row's ⋯ menu): while open, its first
 * item takes the focus; Escape closes it and gives the focus back to the button; a click outside or
 * the focus moving out of it closes it.
 */
export function usePopover(open: boolean, close: () => void, trigger: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus());
    const down = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (pop.current?.contains(t) || trigger.current?.contains(t)) return;
      closeRef.current();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // only this menu closes (not the panel or dialog underneath)
      ev.stopPropagation();
      ev.preventDefault();
      closeRef.current();
      trigger.current?.focus();
    };
    const out = (ev: FocusEvent) => {
      const to = ev.relatedTarget as Node | null;
      if (to && !pop.current?.contains(to) && !trigger.current?.contains(to)) closeRef.current();
    };
    const el = pop.current;
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    el?.addEventListener('focusout', out);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      el?.removeEventListener('focusout', out);
    };
  }, [open, trigger, pop]);
}

/** Arrow keys, Home and End move between the items of a role="menu". */
export function menuKeys(ev: ReactKeyboardEvent<HTMLElement>) {
  const items = [...ev.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const j = ev.key === 'ArrowDown' ? (i + 1) % items.length : ev.key === 'ArrowUp' ? (i - 1 + items.length) % items.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? items.length - 1 : -1;
  if (j < 0) return;
  ev.preventDefault();
  items[j].focus();
}
