import { useLayoutEffect, type RefObject } from 'react';

/**
 * A highlight that slides to the selected item instead of jumping: the selected item's place inside
 * `box` is put in CSS variables (--ix, --iy, --iw, --ih) that a `.slide-ind` element in the box
 * follows with a transition. `box[data-ind]` is "on" while there is a selected item (its own
 * background is then left to the indicator); the first placement and a resize don't animate.
 */
export function useSlide(box: RefObject<HTMLElement | null>, selector: string, key: unknown) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const put = (animate: boolean) => {
      const cur = el.querySelector<HTMLElement>(selector);
      if (!cur) {
        el.dataset.ind = 'off';
        return;
      }
      const b = el.getBoundingClientRect(), r = cur.getBoundingClientRect();
      if (!animate) el.classList.add('ind-still');
      el.style.setProperty('--ix', r.left - b.left - el.clientLeft + 'px');
      el.style.setProperty('--iy', r.top - b.top - el.clientTop + 'px');
      el.style.setProperty('--iw', r.width + 'px');
      el.style.setProperty('--ih', r.height + 'px');
      el.dataset.ind = 'on';
      if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('ind-still')));
    };
    // a new selection slides; the first one (and one made while hidden) is just placed
    put(el.dataset.ind === 'on');
    if (typeof ResizeObserver === 'undefined') return;
    // the menu folding to icons, a font loading, a badge appearing: follow without a slide (only a
    // real change of size: an observer also reports once when it starts, mid-slide)
    const seen = new Map<Element, string>();
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const en of entries) {
        const s = `${Math.round(en.contentRect.width)}x${Math.round(en.contentRect.height)}`;
        if (seen.has(en.target) && seen.get(en.target) !== s) changed = true;
        seen.set(en.target, s);
      }
      if (changed) put(false);
    });
    ro.observe(el);
    const cur = el.querySelector(selector);
    if (cur) ro.observe(cur);
    return () => ro.disconnect();
  }, [box, selector, key]);
}
