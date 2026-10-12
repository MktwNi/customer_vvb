import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Chevron } from './StageTrack';
import { Pop, Tick, useHL } from './Pop';

export interface SelOpt<V extends string = string> {
  v: V; label: string;
  /** a grey line under the label */
  sub?: string;
  /** a count or short figure at the right ("12 งาน") */
  n?: ReactNode;
  /** before the label (an avatar) */
  lead?: ReactNode;
  disabled?: boolean;
}

const lower = (s: string) => s.toLocaleLowerCase('th');

/**
 * The app's dropdown in place of a native <select> (whose grey system menu does not match the app): a
 * button with the value and a caret, opening a white listbox popover; the chosen option is in link blue
 * with a brand tick, the active one under the sliding tint. Keys as a select: ↓ / ↑ / Enter / Space open,
 * ↑ ↓ Home End PgUp PgDn move, typing jumps, Enter / Space choose, Escape closes, Tab closes and moves
 * on. A closed button never changes its value (a printable key opens the list at the match): the deal
 * panel's หมวด moves the deal when it changes. Phones get a bottom sheet.
 *
 * Variants: `field` (a 40px form field), `tool` (a 36px toolbar pill; `prefix` in grey before the value),
 * `head` (the page-head pill), `cell` (a table cell that reads as text). Never inside a <label> (a click
 * on an option would click the button again): give a visible label an id and pass `labelledBy`.
 */
export function Select<V extends string>({ value, defaultValue, onChange, options, label, labelledBy, describedBy, variant = 'field', prefix, shown, placeholder, search = 'auto', width, name, id, disabled, className = '', title }: {
  value?: V; defaultValue?: V; onChange?: (v: V) => void;
  options: SelOpt<V>[];
  /** accessible name; the sheet's title */
  label: string;
  /** id of a visible label: the button is named "{that label} {its own text}" */
  labelledBy?: string;
  describedBy?: string;
  variant?: 'field' | 'tool' | 'head' | 'cell';
  prefix?: string;
  /** the button's text in place of the chosen label ("ปี 2569") */
  shown?: ReactNode;
  /** shown (grey) when the value matches no option */
  placeholder?: string;
  /** a find field over the list: 'auto' = more than 8 options */
  search?: boolean | 'auto';
  /** popover width (default: the button's, at least 220) */
  width?: number;
  /** a hidden input with this name carries the value (forms read with FormData) */
  name?: string;
  id?: string; disabled?: boolean; className?: string; title?: string;
}) {
  const [own, setOwn] = useState<V | undefined>(defaultValue);
  const cur = value !== undefined ? value : own;
  const [open, setOpen] = useState<{ seed: string } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const bid = id || uid + '-b', lid = uid + '-l';
  const opt = options.find((o) => o.v === cur);
  const find = search === 'auto' ? options.length > 8 : search;
  const choose = (v: V) => {
    setOpen(null);
    btn.current?.focus({ preventScroll: true });
    if (value === undefined) setOwn(v);
    if (v !== cur) onChange?.(v);
  };
  const text = shown ?? opt?.label ?? placeholder ?? '';
  return (
    <>
      <button
        ref={btn}
        id={bid}
        type="button"
        className={`sel-btn ${variant} ${className}`}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={!!open}
        aria-controls={open ? lid : undefined}
        aria-label={labelledBy ? undefined : `${label}: ${opt?.label ?? placeholder ?? 'ยังไม่ได้เลือก'}`}
        aria-labelledby={labelledBy ? `${labelledBy} ${bid}` : undefined}
        aria-describedby={describedBy}
        onClick={() => setOpen(open ? null : { seed: '' })}
        onKeyDown={(ev) => {
          if (open) return;
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            setOpen({ seed: '' });
          } else if (ev.key.length === 1 && /\S/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
            // a closed select would change its value here: this one opens at the match instead
            ev.preventDefault();
            setOpen({ seed: ev.key });
          }
        }}
      >
        {prefix && <span className="sel-pre">{prefix}</span>}
        <span className={'sel-v' + (opt || shown != null ? '' : ' ph')}>{text}</span>
        <Chevron size={14} />
      </button>
      {name && <input type="hidden" name={name} value={cur ?? ''} />}
      {open && (
        <Pop anchor={btn} onClose={() => setOpen(null)} label={label} kind="list" role="none" className="sel" width={width ?? Math.max(btn.current?.offsetWidth || 0, 220)}>
          <SelList id={lid} value={cur} options={options} label={label} search={find} seed={open.seed} onPick={choose} />
        </Pop>
      )}
    </>
  );
}

/** The listbox of a Select (and of any picker that shows choices the same way). */
function SelList<V extends string>({ id, value, options, label, search, seed, onPick }: { id: string; value: V | undefined; options: SelOpt<V>[]; label: string; search: boolean; seed: string; onPick: (v: V) => void }) {
  const [q, setQ] = useState('');
  const t = lower(q.trim());
  const list = t ? options.filter((o) => lower(o.label).includes(t)) : options;
  const ok = (i: number) => !!list[i] && !list[i].disabled;
  const [act, setAct] = useState(() => {
    const s = seed ? list.findIndex((o) => !o.disabled && lower(o.label).startsWith(lower(seed))) : -1;
    const c = list.findIndex((o) => o.v === value);
    return s >= 0 ? s : c >= 0 ? c : Math.max(0, list.findIndex((o) => !o.disabled));
  });
  const hl = useHL();
  const typed = useRef({ s: seed, t: seed ? Date.now() : 0 });
  const optId = (i: number) => `${id}-${i}`;
  const show = (i: number) => {
    const el = document.getElementById(optId(i));
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    hl.move(el);
  };
  // the chosen (or matched) option is in view and under the highlight from the start
  useLayoutEffect(() => show(act), []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (i: number, dir = 1) => {
    if (!list.length) return;
    let n = Math.max(0, Math.min(list.length - 1, i));
    while (!ok(n) && n + dir >= 0 && n + dir < list.length) n += dir;
    if (!ok(n)) return;
    setAct(n);
    requestAnimationFrame(() => show(n));
  };
  const key = (ev: KeyboardEvent) => {
    const k = ev.key;
    if (k === 'ArrowDown') go(act + 1, 1);
    else if (k === 'ArrowUp') go(act - 1, -1);
    else if (k === 'Home') go(0, 1);
    else if (k === 'End') go(list.length - 1, -1);
    else if (k === 'PageDown') go(act + 8, 1);
    else if (k === 'PageUp') go(act - 8, -1);
    else if (k === 'Enter' || (k === ' ' && !search)) {
      if (ok(act)) onPick(list[act].v);
    } else if (!search && k.length === 1 && /\S/.test(k) && !ev.ctrlKey && !ev.metaKey) {
      // type-ahead (Thai or Latin): the letters typed within 600ms make one word
      const b = typed.current, now = Date.now();
      b.s = (now - b.t < 600 ? b.s : '') + k;
      b.t = now;
      const i = list.findIndex((o) => !o.disabled && lower(o.label).startsWith(lower(b.s)));
      if (i >= 0) go(i);
    } else return;
    ev.preventDefault();
  };
  const ad = ok(act) ? optId(act) : undefined;
  return (
    <>
      {search && (
        <div className="fval-find">
          <input
            value={q}
            onChange={(ev) => {
              setQ(ev.target.value);
              setAct(0);
              requestAnimationFrame(() => show(0));
            }}
            onKeyDown={key}
            placeholder="ค้นหา"
            aria-label={'ค้นหา ' + label}
            data-autofocus=""
            role="combobox"
            aria-expanded="true"
            aria-controls={id}
            aria-autocomplete="list"
            aria-activedescendant={ad}
          />
        </div>
      )}
      <div
        className="hl-list sel-list"
        id={id}
        role="listbox"
        aria-label={label}
        aria-activedescendant={search ? undefined : ad}
        tabIndex={search ? -1 : 0}
        data-autofocus={search ? undefined : ''}
        onKeyDown={search ? undefined : key}
        {...hl.bind}
      >
        <i className="hl" aria-hidden="true" />
        {list.map((o, i) => (
          <div
            key={o.v}
            id={optId(i)}
            role="option"
            aria-selected={o.v === value}
            aria-disabled={o.disabled || undefined}
            data-hl={o.disabled ? undefined : ''}
            className={'sel-opt' + (i === act ? ' act' : '') + (o.v === value ? ' on' : '') + (o.disabled ? ' off' : '')}
            onClick={() => !o.disabled && onPick(o.v)}
            onPointerMove={() => i !== act && !o.disabled && setAct(i)}
          >
            {o.lead}
            <span className="sel-opt-tx">
              <span className="sel-opt-l">{o.label}</span>
              {o.sub && <span className="sel-opt-s">{o.sub}</span>}
            </span>
            {o.n != null && <span className="sel-opt-n">{o.n}</span>}
            <span className="sel-ck">{o.v === value && <Tick />}</span>
          </div>
        ))}
        {!list.length && <div className="pop-empty">ไม่พบ “{q.trim()}”</div>}
      </div>
    </>
  );
}
