import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useMedia } from './Sidebar';

/** Why a popover closed: Escape, a press outside it, Tab out of a list, or its own ×, backdrop or ยกเลิก
 *  (on a phone sheet). Only 'out' leaves the focus where the person put it. */
export type PopWhy = 'esc' | 'out' | 'tab' | 'cancel';

/** The open popovers, innermost last: Escape and Tab belong to the last one only. */
const stack: number[] = [];
let seq = 0;
/** Sheets open now: the page under them does not scroll. */
let sheets = 0;

/** Inside a popover (portalled to the body, so outside the dialog or row that opened it)? Outside-click
 *  and focus-leave checks elsewhere in the app ask this before closing their own menu or editor. */
export const insidePop = (node: EventTarget | Node | null | undefined) => !!(node as Element | null)?.closest?.('[data-pop]');

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const shown = (el: HTMLElement) => el.getClientRects().length > 0;
/** What Tab moves between inside a popover: a radio group is one stop (its checked radio, else the first). */
function tabStops(box: HTMLElement) {
  const seen = new Set<string>();
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (!shown(el) || el.tabIndex < 0) return false;
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      if (seen.has(el.name)) return false;
      const group = [...box.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
      const pick = group.find((x) => x.checked) || group[0];
      if (pick !== el) return false;
      seen.add(el.name);
    }
    return true;
  });
}

/** Swallows the click that follows this press (and nothing later: it is dropped at the next press or
 *  key, or soon after the press ends without one). */
function eatClick() {
  let tm = 0;
  const eat = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    off();
  };
  const up = () => {
    clearTimeout(tm);
    tm = window.setTimeout(off, 400);
  };
  const off = () => {
    clearTimeout(tm);
    window.removeEventListener('click', eat, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', off, true);
    window.removeEventListener('pointerdown', off, true);
    window.removeEventListener('keydown', off, true);
  };
  window.addEventListener('click', eat, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', off, true);
  // added while this press is past the window's capture phase: only a later press removes it
  window.addEventListener('pointerdown', off, true);
  window.addEventListener('keydown', off, true);
}

/**
 * A floating panel on a control (a filter chip, a picker, the field menu), portalled to the body and
 * fixed to the window, so no scrolling card clips it. Desktop: under its anchor (start- or end-aligned),
 * the page's content scrolled up first when there is no room below, flipped above when that is still
 * short, kept 12px inside the window; `place:'side'` puts it beside a menu box (the field menu → the
 * value popover). It fades and lifts in (none under reduced motion). Phones (<= 900px): a bottom sheet
 * with a grab bar, its title and ×, over a veil that cancels when tapped.
 *
 * Keys (the last popover opened only): Escape closes it and gives the focus back (`back`, else the
 * anchor). Tab cycles inside a `kind:'dialog'` popover and inside any sheet; a `kind:'list'` popover (a
 * menu or listbox) closes and the focus moves on from the anchor, as from a native select. A press
 * outside it (and outside its anchor and the popovers opened from it) closes it and leaves the focus
 * where it went; inside a modal dialog or panel, a press on its dimmed backdrop only closes the popover
 * (as a native select's list: the dialog and what was typed in it stay).
 *
 * The first focus: `[data-autofocus]`, else the first stop. A sheet opened by touch takes the focus
 * itself (a text field would bring the phone's keyboard up over it); opened from the keyboard (a 900px
 * window: a laptop zoomed in) it focuses as a popover does, so arrows, Enter and Tab work.
 */
export function Pop({ anchor, onClose, place = 'below', align = 'start', width, label, title, kind, role = 'dialog', back, sheet = true, className = '', initialFocus = 'auto', boxRef, id: domId, children }: {
  anchor: RefObject<HTMLElement | null> | HTMLElement | null;
  onClose: (why: PopWhy) => void;
  /** 'below' = under the anchor; 'side' = beside a menu box (the anchor), tops lined up */
  place?: 'below' | 'side';
  align?: 'start' | 'end';
  /** desktop width (never wider than the window less 24px) */
  width?: number;
  /** the popover's accessible name (and the sheet's title unless `title` says otherwise) */
  label: string;
  title?: ReactNode;
  /** 'dialog' = a small dialog (Tab stays inside); 'list' = it holds a menu or listbox (Tab closes it) */
  kind: 'dialog' | 'list';
  /** 'none' when the child carries role=menu / listbox */
  role?: 'dialog' | 'none';
  back?: HTMLElement | null;
  /** false: never a sheet (stays a popover on phones too) */
  sheet?: boolean;
  /** 'menu' | 'val' | 'date' | 'sel' */
  className?: string;
  initialFocus?: 'auto' | 'container';
  /** gets the popover's box (the field menu: what the value popover lines up with) */
  boxRef?: RefObject<HTMLDivElement | null>;
  /** the box's id, for the opener's aria-controls */
  id?: string;
  children: ReactNode;
}) {
  const asSheet = useMedia('(max-width: 900px)') && sheet;
  // opened from the keyboard? (read while rendering: the opener may be gone once this mounts)
  const [kb] = useState(() => typeof document !== 'undefined' && !!document.activeElement?.matches?.(':focus-visible'));
  /** a press on the veil that began there (a drag out of the sheet that ends on it is not a tap on it) */
  const veilDown = useRef(false);
  const box = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const [at, setAt] = useState('');
  const id = useRef(0);
  if (!id.current) id.current = ++seq;
  const why = useRef<PopWhy | null>(null);
  const live = useRef({ onClose, back, anchor });
  live.current = { onClose, back, anchor };
  const el = () => {
    const a = live.current.anchor;
    return a && 'current' in a ? a.current : a;
  };
  const close = (w: PopWhy) => {
    why.current = w;
    live.current.onClose(w);
  };
  const setBox = (n: HTMLDivElement | null) => {
    box.current = n;
    if (boxRef) boxRef.current = n;
  };

  // ---- placement (desktop)
  useLayoutEffect(() => {
    if (asSheet) return;
    let first = true, raf = 0;
    const put = () => {
      const a = el(), b = box.current;
      if (!a || !b || !a.isConnected) return;
      const M = 12, G = 8, W = window.innerWidth, H = window.innerHeight;
      const w = b.offsetWidth, h = b.scrollHeight + (b.offsetHeight - b.clientHeight);
      let r = a.getBoundingClientRect();
      if (!first && (r.bottom < 0 || r.top > H)) return close('out'); // its anchor scrolled away
      let left: number, top: number, maxH: number, side: string;
      if (place === 'side') {
        left = r.right + G;
        side = 'right';
        if (left + w > W - M) {
          left = r.left - G - w;
          side = 'left';
        }
        // tops lined up with the menu (it never climbs over the filter row); a tall list scrolls inside
        top = Math.max(M, Math.min(r.top, H - M - 240));
        maxH = H - top - M;
      } else {
        // no room under it: the page's content scrolls up first (rather than the popover covering the anchor)
        const sc = first ? a.closest<HTMLElement>('#scroller') : null, need = r.bottom + G + h + M - H;
        if (sc && need > 0) {
          const stuck = sc.getBoundingClientRect().top + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top')) || 0) + 16;
          const by = Math.min(need, sc.scrollHeight - sc.clientHeight - sc.scrollTop, r.top - stuck);
          if (by > 0) {
            sc.scrollTop += by;
            r = a.getBoundingClientRect();
          }
        }
        top = r.bottom + G;
        side = 'below';
        maxH = H - top - M;
        // short below: above when it fits there, or when there is more room above than below
        const room = r.top - G - M;
        if (top + h > H - M && (room >= h || room > maxH)) {
          top = Math.max(M, r.top - G - h);
          side = 'above';
          maxH = room;
        }
        // a short page cannot scroll it into place: when the window holds it, it is shown whole, over
        // its anchor if it must (cut short, its preset or the last week of the month would be out of view)
        if (h <= H - 2 * M && top + h > H - M) top = H - M - h;
        if (h <= H - 2 * M) maxH = H - M - top;
        maxH = Math.max(160, maxH);
        left = align === 'end' ? r.right - w : r.left;
      }
      left = Math.max(M, Math.min(left, W - M - w));
      setPos({ left, top, maxHeight: maxH });
      if (first) setAt(side);
      first = false;
    };
    put();
    const again = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(put);
    };
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(again) : null;
    if (box.current) ro?.observe(box.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
      ro?.disconnect();
    };
  }, [asSheet, place, align]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the stack, keys, outside presses, the first focus
  useLayoutEffect(() => {
    const me = id.current;
    stack.push(me);
    return () => {
      const i = stack.lastIndexOf(me);
      if (i >= 0) stack.splice(i, 1);
      // closed by its own button, Escape or Tab: the focus was inside, so it goes back to what opened it
      // (a press elsewhere keeps the focus there); the opener can still move it on afterwards
      const b = box.current;
      if (why.current !== 'out' && b && b.contains(document.activeElement)) {
        const to = live.current.back?.isConnected ? live.current.back : el();
        to?.focus({ preventScroll: true });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const me = id.current;
    const top = () => stack[stack.length - 1] === me;
    const raf = requestAnimationFrame(() => {
      const b = box.current;
      if (!b || b.contains(document.activeElement)) return;
      // a sheet opened by touch takes the focus itself (a focused text field would pop the keyboard up over
      // it); opened from the keyboard, its first control does, as in a popover (a sheet's own × is not that)
      const f = initialFocus === 'container' || (asSheet && !kb) ? null : b.querySelector<HTMLElement>('[data-autofocus]') || tabStops(b).find((x) => !x.classList.contains('pop-x'));
      (f || b).focus({ preventScroll: true });
    });
    const key = (ev: KeyboardEvent) => {
      if (!top() || (ev.key !== 'Escape' && ev.key !== 'Tab')) return;
      const b = box.current;
      if (ev.key === 'Escape') {
        // window capture: before a dialog's own Escape (document capture), so only this layer closes
        ev.stopPropagation();
        ev.preventDefault();
        (live.current.back?.isConnected ? live.current.back : el())?.focus({ preventScroll: true });
        return close('esc');
      }
      if (!b || !b.contains(document.activeElement)) return;
      // a list closes on Tab, as a native select; a sheet is a modal layer: Tab goes round inside it
      if (kind === 'list' && !asSheet) {
        // leave Tab to the browser, from the anchor: the focus moves on to the next field
        (live.current.back?.isConnected ? live.current.back : el())?.focus({ preventScroll: true });
        return close('tab');
      }
      // a small dialog: Tab and Shift+Tab go round inside it (and a dialog underneath leaves Tab alone)
      const list = tabStops(b), n = list.length;
      ev.preventDefault();
      if (!n) return b.focus();
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[i < 0 ? (ev.shiftKey ? n - 1 : 0) : (i + (ev.shiftKey ? -1 : 1) + n) % n].focus();
    };
    const down = (ev: PointerEvent) => {
      const t = ev.target as Element | null;
      const a = el();
      if (!t || a?.contains(t)) return;
      const host = t.closest?.('[data-pop]');
      if (host) {
        // inside this popover, or one opened from it (later in the stack)
        const other = +(host.getAttribute('data-pop') || 0);
        if (other === me || stack.indexOf(other) > stack.indexOf(me)) return;
      }
      // opened in a modal dialog or panel, pressed outside it (its dimmed backdrop): the press only closes
      // this list, as a native select's would; the backdrop's click would close the dialog and lose what was typed
      const modal = a?.closest('[aria-modal="true"]');
      if (modal && !modal.contains(t) && !host) eatClick();
      close('out');
    };
    window.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', down, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a sheet: the page under it stays put
  useEffect(() => {
    if (!asSheet) return;
    if (!sheets++) document.documentElement.style.overflow = 'hidden';
    return () => {
      if (!--sheets) document.documentElement.style.overflow = '';
    };
  }, [asSheet]);

  const aria = role === 'none' ? {} : { role, 'aria-label': label };
  if (asSheet)
    return createPortal(
      <div
        className="pop-back"
        data-pop={id.current}
        // the veil cancels on a tap's click, not its press: closed on the press, the veil would be gone
        // before the click, and the click would land on whatever was under it
        onPointerDown={(ev) => (veilDown.current = ev.target === ev.currentTarget)}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget && veilDown.current) close('cancel');
          veilDown.current = false;
        }}
      >
        <div ref={setBox} id={domId} className={'pop-sheet ' + className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
          <div className="pop-grab" aria-hidden="true" />
          <div className="pop-head">
            <span className="pop-title">{title ?? label}</span>
            <button type="button" className="pop-x" aria-label="ปิด" onClick={() => { el()?.focus({ preventScroll: true }); close('cancel'); }}>
              <XMark size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>,
      document.body,
    );
  return createPortal(
    <div ref={setBox} id={domId} data-pop={id.current} data-at={at || undefined} className={'pop ' + className} style={{ ...pos, width: width ? `min(${width}px, calc(100vw - 24px))` : undefined }} {...aria} tabIndex={-1}>
      {children}
    </div>,
    document.body,
  );
}

/** A soft highlight that slides between the items of a list under the pointer (and the keyboard, when
 *  focus is visible): `{...hl.bind}` on the list (class `hl-list`), `<i className="hl" />` first inside
 *  it, `data-hl` on the items. It measures inside the list, so a scrolled list stays right. */
export function useHL() {
  const ref = useRef<HTMLDivElement>(null);
  const move = (t: EventTarget | null, kb?: boolean) => {
    const box = ref.current, it = (t as HTMLElement | null)?.closest?.<HTMLElement>('[data-hl]');
    // the list itself carries data-hl (its on / off state): focus on the list is not an item
    if (!box || !it || it === box || !box.contains(it)) return;
    // the focus a popover gives on opening does not move it: only the keyboard's
    if (kb && !document.activeElement?.matches(':focus-visible')) return;
    box.style.setProperty('--hy', it.offsetTop + 'px');
    box.style.setProperty('--hh', it.offsetHeight + 'px');
    if (box.dataset.hl !== 'on') {
      // the first placement does not slide in from the top
      box.classList.add('hl-still');
      box.dataset.hl = 'on';
      requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove('hl-still')));
    }
  };
  const off = () => {
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) box.dataset.hl = 'off';
  };
  return {
    ref, move,
    bind: { ref, onPointerOver: (ev: { target: EventTarget }) => move(ev.target), onFocus: (ev: { target: EventTarget }) => move(ev.target, true), onPointerLeave: off, onBlur: off },
  };
}

/** A person's initial in a small circle (the first letter after "คุณ"); no name ("(ไม่ระบุ)", "-") an
 *  empty dashed one. */
export function Av({ name }: { name: string }) {
  const ch = name === '(ไม่ระบุ)' ? '' : Array.from(name.replace(/^คุณ\s*/, '')).find((c) => /[ก-ฮA-Za-z0-9]/.test(c)) || '';
  const none = !ch;
  return <span className={'fav' + (none ? ' none' : '')} aria-hidden="true">{none ? '' : ch.toUpperCase()}</span>;
}

/** The drawn marks of a checkbox and a radio (the real input sits before them, visually hidden). */
export const Check = ({ on }: { on: boolean }) => <span className="fbox" aria-hidden="true">{on && <Tick />}</span>;
export const Radio = () => <span className="fradio" aria-hidden="true" />;

export const Tick = ({ size = 12 }: { size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
    <path d="M3.5 8.4l2.9 2.9 6-6.3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const XMark = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
