import { useEffect, useState, type RefObject } from 'react';

/**
 * Keyboard focus for a modal dialog or side panel (aria-modal): focus moves into it when it opens,
 * Tab / Shift+Tab stay inside it, and focus goes back to what opened it when it closes.
 * Dialogs that are open at the same time stack: the last one opened has the keyboard.
 */
const stack: HTMLElement[] = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])';
const shown = (el: HTMLElement) => el.getClientRects().length > 0;

/** The dialog that has the keyboard (the last one opened)? Escape closes only that one. */
export const isTopDialog = (el: HTMLElement | null) => !!el && stack[stack.length - 1] === el;

/** Fields that save when they lose focus: blur the focused one so it saves before its dialog closes. */
export function commitFocus() {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || a === document.body) return;
  closingBlur = true; // a field that refuses its value must say so now: its dialog is about to go
  try {
    a.blur();
  } finally {
    closingBlur = false;
  }
}
let closingBlur = false;
/** True while commitFocus blurs a field because its dialog is closing. */
export const isClosingBlur = () => closingBlur;

/**
 * `focus`: 'field' focuses the first field (input / select / textarea, unless one has autoFocus),
 * else the dialog itself; 'dialog' always focuses the dialog (give it tabIndex={-1}).
 * `on`: false while the component renders no dialog.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, { focus = 'field', on = true }: { focus?: 'field' | 'dialog'; on?: boolean } = {}) {
  // what had focus before this dialog rendered (an autoFocus field takes focus before effects run)
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    stack.push(el);
    const cur = document.activeElement;
    const from = opener instanceof HTMLElement && opener.isConnected && !el.contains(opener) ? opener : cur instanceof HTMLElement && cur !== document.body && !el.contains(cur) ? cur : null;
    if (!el.contains(document.activeElement)) {
      const first = focus === 'field' ? [...el.querySelectorAll<HTMLElement>(FIELD)].find(shown) : undefined;
      (first || el).focus();
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Tab' || ev.defaultPrevented || !isTopDialog(el)) return;
      // another modal that doesn't use this hook is open (e.g. the appointment form): leave Tab to it
      const others = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some((x) => !stack.includes(x) && !stack.some((s) => s.contains(x)));
      if (others) return;
      const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);
      const a = document.activeElement;
      if (!list.length) {
        ev.preventDefault();
        el.focus();
        return;
      }
      const first = list[0], last = list[list.length - 1];
      if (a === el || !el.contains(a)) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
      } else if (ev.shiftKey && a === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && a === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.lastIndexOf(el);
      if (i >= 0) stack.splice(i, 1);
      // closed for real (not StrictMode's trial unmount): give focus back unless the person moved it elsewhere
      const a = document.activeElement;
      if (!el.isConnected && from && from.isConnected && (!a || a === document.body || el.contains(a))) from.focus();
    };
  }, [on]); // ref, opener and focus mode are fixed for the dialog's life
}
