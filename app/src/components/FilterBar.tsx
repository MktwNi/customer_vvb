import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { fmtN } from '../lib/format';
import { useMedia } from './Sidebar';
import { Chevron } from './StageTrack';
import { Av, Check, Pop, Radio, XMark, useHL, type PopWhy } from './Pop';

/** One choice of a filter: `n` = how many rows have it (with every other filter on); `sub` a grey word
 *  after it ("ฉัน"); `chip` = how the chip says it, when shorter than the label ("ได้งาน"). */
export interface FOpt { v: string; label: string; n?: number; sub?: string; chip?: string }
/** A filter the row offers: a list (ticks, several values, "คือ / ไม่ใช่") or a single choice (radios). */
export interface FField {
  key: string; label: string;
  /** the field menu's grey line under the name (a few words) */
  hint?: string;
  kind: 'multi' | 'single';
  /** "คือ / ไม่ใช่" (lists only) */
  ops?: boolean;
  /** people's names: an initial before each */
  people?: boolean;
  /** single choice: the first radio, meaning no filter ("ทั้งหมด") */
  all?: string;
  options: FOpt[];
  /** always shown as a pill (not in the field menu) */
  pinned?: boolean;
  /** what a pinned pill says while unused ("ทุกคน", "ทั้งหมด") */
  rest?: string;
  /** the find field's placeholder (default "ค้นหา{label}") */
  find?: string;
  /** a hairline in the field menu before this one */
  sep?: boolean;
}
export interface FVal { v: string[]; not?: true }

const MAX_SHOWN = 2;
const optOf = (f: FField, v: string) => f.options.find((o) => o.v === v);
const chipWord = (f: FField, v: string) => {
  const o = optOf(f, v);
  return o?.chip ?? (o ? o.label + (o.sub === 'ฉัน' ? ' (ฉัน)' : '') : v === '(ไม่ระบุ)' ? 'ไม่ระบุ' : v);
};
/** "หมิว", "หมิว, คุณบี", "หมิว, คุณบี และอีก 2" */
export const valText = (f: FField, v: string[]) => {
  const w = v.map((x) => chipWord(f, x));
  return w.slice(0, MAX_SHOWN).join(', ') + (w.length > MAX_SHOWN ? ` และอีก ${w.length - MAX_SHOWN}` : '');
};
const opWord = (f: FField, v?: FVal) => (f.kind === 'multi' && v?.not ? 'ไม่ใช่' : 'คือ');
/** The whole sentence of a filter in use: "ผู้รับผิดชอบ คือ หมิว (ฉัน), คุณบี, คุณเอ". */
export const sentence = (f: FField, v: FVal) => `${f.label} ${opWord(f, v)} ${v.v.map((x) => chipWord(f, x)).join(', ')}`;

/**
 * The filter row (the reference's pattern, in the brand): the date chip (`lead`), the pinned pills,
 * read-only chips (`extra`), each filter in use as a chip that reads like a sentence ("SOURCE คือ TGO,
 * SET/mai ×": a click edits it, × removes it), "เพิ่มตัวกรอง" → the field menu → that field's value popover
 * beside it, "ล้างทั้งหมด", and "แสดง 5 จาก 32 งาน" at the end. Nothing applies until "ใช้ตัวกรอง".
 * Filters live in view state only: read-only accounts use them too.
 */
export function FilterBar({ fields, value, onChange, lead, extra, search, onClearAll, anySet, count, liveCount, unit = 'งาน', menuTitle = 'เพิ่มตัวกรอง' }: {
  fields: FField[];
  value: Record<string, FVal | undefined>;
  onChange: (key: string, v: FVal | null) => void;
  /** the date chip (always first) */
  lead?: ReactNode;
  /** read-only chips, after the pinned pills */
  extra?: ReactNode;
  /** a search field sharing the row (first) */
  search?: ReactNode;
  onClearAll?: () => void;
  anySet: boolean;
  /** "แสดง 5 จาก 32 งาน" */
  count?: { shown: number; total: number } | null;
  /** rows a value popover's draft would leave ("เหลือ N งาน"); none = no such line */
  liveCount?: (key: string, draft: FVal | null) => number;
  unit?: string;
  menuTitle?: string;
}) {
  const phone = useMedia('(max-width: 900px)');
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<{ key: string; from: 'menu' | 'chip' } | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const menuBox = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hl = useHL();
  const on = (f: FField) => !!value[f.key]?.v.length;
  const pinned = fields.filter((f) => f.pinned);
  const listed = fields.filter((f) => !f.pinned);
  const used = listed.filter(on);
  const editing = edit && fields.find((f) => f.key === edit.key);
  const fromMenu = edit?.from === 'menu';
  const focusChip = (k: string | null) =>
    requestAnimationFrame(() => ((k && chipRefs.current[k]) || addBtn.current || row.current?.querySelector<HTMLElement>('.fchip-b'))?.focus({ preventScroll: true }));

  const chip = (f: FField) => {
    const v = value[f.key];
    const isOn = !!v?.v.length;
    const open = edit?.key === f.key && edit.from === 'chip';
    const s = isOn ? sentence(f, v!) : `${f.label} ${f.rest ?? 'ทั้งหมด'}`;
    return (
      <span key={f.key} className={'fchip' + (isOn ? ' on' : '') + (open ? ' open' : '')}>
        <button
          ref={(el) => { chipRefs.current[f.key] = el; }}
          type="button"
          className="fchip-b"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={s}
          aria-label={isOn ? `ตัวกรอง ${s} — แก้ไข` : `ตัวกรอง ${s} — เลือก`}
          onClick={() => {
            setMenu(false);
            setEdit(open ? null : { key: f.key, from: 'chip' });
          }}
        >
          <span className="fchip-f">{f.label}</span>
          {isOn ? (
            <>
              <span className="fchip-op">{opWord(f, v)}</span>
              <span className="fchip-v">{valText(f, v!.v)}</span>
            </>
          ) : (
            <>
              <span className="fchip-v">{f.rest ?? 'ทั้งหมด'}</span>
              <Chevron size={14} />
            </>
          )}
        </button>
        {isOn && (
          <button
            type="button"
            className="fchip-x"
            aria-label={`ล้างตัวกรอง ${f.label}`}
            onClick={() => {
              onChange(f.key, null);
              if (f.pinned) return focusChip(f.key);
              // the next chip in use, else เพิ่มตัวกรอง
              const i = used.indexOf(f);
              focusChip(used[i + 1]?.key ?? null);
            }}
          >
            <XMark />
          </button>
        )}
      </span>
    );
  };

  const menuKeys = (ev: KeyboardEvent<HTMLDivElement>) => {
    const items = [...ev.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const i = items.indexOf(document.activeElement as HTMLElement), n = items.length;
    const j = ev.key === 'ArrowDown' ? (i + 1) % n : ev.key === 'ArrowUp' ? (i - 1 + n) % n : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : -1;
    if (j >= 0) {
      ev.preventDefault();
      items[j].focus();
    } else if (ev.key === 'ArrowRight' && i >= 0) {
      ev.preventDefault();
      items[i].click();
    }
  };

  return (
    <div className="fb" role="group" aria-label="ตัวกรอง" ref={row}>
      {search}
      <div className="fb-chips">
        {lead}
        {pinned.map(chip)}
        {extra}
        {used.map(chip)}
        {used.length < listed.length && (
          <button
            ref={addBtn}
            type="button"
            className={'fb-add' + (menu ? ' open' : '')}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => {
              setEdit(null);
              setMenu(!menu);
            }}
          >
            {menuTitle}
          </button>
        )}
        {anySet && onClearAll && (
          <button
            type="button"
            className="fb-clear quiet"
            onClick={() => {
              onClearAll();
              requestAnimationFrame(() => row.current?.querySelector<HTMLElement>('.fchip-b')?.focus({ preventScroll: true }));
            }}
          >
            ล้างทั้งหมด
          </button>
        )}
        <span className="fb-count" role="status" aria-live="polite">
          {count ? `แสดง ${fmtN(count.shown)} จาก ${fmtN(count.total)} ${unit}` : ''}
        </span>
      </div>
      {menu && !(phone && edit) && (
        <Pop
          anchor={addBtn}
          boxRef={menuBox}
          onClose={() => {
            setMenu(false);
            setEdit((x) => (x?.from === 'menu' ? null : x));
          }}
          label="เลือกตัวกรอง"
          title={menuTitle}
          kind="list"
          role="none"
          width={240}
          className="menu"
        >
          <div role="menu" aria-label="เลือกตัวกรอง" className="hl-list fmenu" onKeyDown={menuKeys} {...hl.bind}>
            <i className="hl" aria-hidden="true" />
            {listed.map((f) => (
              <FragmentSep key={f.key} sep={f.sep}>
                <button
                  ref={(el) => { itemRefs.current[f.key] = el; }}
                  type="button"
                  role="menuitem"
                  data-hl=""
                  aria-haspopup="dialog"
                  aria-expanded={edit?.key === f.key}
                  className={'fmi' + (edit?.key === f.key ? ' cur' : '')}
                  onClick={() => setEdit({ key: f.key, from: 'menu' })}
                >
                  <span className="fmi-l">
                    {f.label}
                    {f.hint && <span className="fmi-s">{f.hint}</span>}
                  </span>
                  {on(f) && <span className="fmi-on">ใช้อยู่</span>}
                </button>
              </FragmentSep>
            ))}
          </div>
        </Pop>
      )}
      {editing && (
        <ValuePop
          key={editing.key}
          f={editing}
          init={value[editing.key]}
          anchor={fromMenu && !phone ? menuBox : fromMenu ? addBtn : { current: chipRefs.current[editing.key] ?? null }}
          place={fromMenu && !phone ? 'side' : 'below'}
          back={fromMenu ? itemRefs.current[editing.key] : chipRefs.current[editing.key]}
          unit={unit}
          liveCount={liveCount}
          onBack={phone && fromMenu ? () => setEdit(null) : undefined}
          onClose={(why) => {
            // ยกเลิก from the menu (desktop): back to the menu, on that item
            if (fromMenu && !phone && why !== 'out') {
              setEdit(null);
              requestAnimationFrame(() => itemRefs.current[editing.key]?.focus({ preventScroll: true }));
            } else if (fromMenu && why === 'out') setEdit(null);
            else {
              setEdit(null);
              setMenu(false);
            }
          }}
          onApply={(v) => {
            onChange(editing.key, v);
            setEdit(null);
            setMenu(false);
            focusChip(v || editing.pinned ? editing.key : null);
          }}
        />
      )}
    </div>
  );
}

/** A chip that only removes (a view reached from elsewhere: "เฉพาะงวดเลยกำหนด", a drill-down of ค้นหา):
 *  its words are text, × clears it. */
export function ReadChip({ text, onClear, label }: { text: string; onClear: () => void; label?: string }) {
  return (
    <span className="fchip on ro" title={text}>
      <span className="fchip-t">{text}</span>
      <button type="button" className="fchip-x" aria-label={label ?? `ล้างตัวกรอง ${text}`} onClick={onClear}>
        <XMark />
      </button>
    </span>
  );
}

function FragmentSep({ sep, children }: { sep?: boolean; children: ReactNode }) {
  return (
    <>
      {sep && <span className="fmi-sep" role="separator" />}
      {children}
    </>
  );
}

/** A field's values: "คือ / ไม่ใช่", a find field over a long list, ticks (a list) or radios (a single
 *  choice) with their counts and a person's initial, "เหลือ N งาน" from the draft, ยกเลิก / ใช้ตัวกรอง. */
function ValuePop({ f, init, anchor, place, back, unit, liveCount, onClose, onApply, onBack }: {
  f: FField; init?: FVal;
  anchor: { current: HTMLElement | null };
  place: 'side' | 'below';
  back?: HTMLElement | null;
  unit: string;
  liveCount?: (key: string, draft: FVal | null) => number;
  onClose: (why: PopWhy) => void;
  onApply: (v: FVal | null) => void;
  onBack?: () => void;
}) {
  const phone = useMedia('(max-width: 900px)');
  const single = f.kind === 'single';
  const [sel, setSel] = useState<string[]>(init?.v || []);
  const [not, setNot] = useState(!!init?.not);
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const hl = useHL();
  const long = f.options.length > 7;
  // chosen first (as when it opened), then the field's order with the empty ones last; fixed while ticking
  const [order] = useState(() => {
    const picked = f.options.filter((o) => init?.v.includes(o.v));
    const rest = f.options.filter((o) => !init?.v.includes(o.v));
    return [...picked, ...rest.filter((o) => o.n !== 0), ...rest.filter((o) => o.n === 0)];
  });
  const t = q.trim().toLocaleLowerCase('th');
  const list = t ? order.filter((o) => o.label.toLocaleLowerCase('th').includes(t)) : order;
  const draft: FVal | null = sel.length ? { v: sel, ...(f.ops && not ? { not: true as const } : {}) } : null;
  const left = liveCount?.(f.key, draft);
  const allN = single && f.all != null ? liveCount?.(f.key, null) : undefined;
  const flip = (v: string) => setSel(single ? (v ? [v] : []) : sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);
  const apply = () => onApply(draft);
  const boxes = () => [...(listRef.current?.querySelectorAll<HTMLInputElement>('input') || [])];
  const moveTo = (i: number) => {
    const b = boxes();
    if (!b.length) return;
    const n = Math.max(0, Math.min(b.length - 1, i));
    setAct(n);
    b[n].focus();
  };
  const listKeys = (ev: KeyboardEvent) => {
    if (single) return; // a radio group moves (and chooses) with the arrows natively
    const b = boxes(), i = b.indexOf(document.activeElement as HTMLInputElement);
    const k = ev.key, to = k === 'ArrowDown' ? i + 1 : k === 'ArrowUp' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? b.length - 1 : k === 'PageDown' ? i + 8 : k === 'PageUp' ? i - 8 : null;
    if (to == null || i < 0) return;
    ev.preventDefault();
    moveTo(to);
  };
  const name = 'fv-' + f.key;
  const row = (v: string, label: string, n: number | undefined, sub?: string, i = 0) => {
    const isOn = single ? (v ? sel[0] === v : !sel.length) : sel.includes(v);
    return (
      <label key={v || '~all'} data-hl="" className={'fck' + (isOn ? ' on' : '') + (n === 0 ? ' zero' : '')}>
        <input
          type={single ? 'radio' : 'checkbox'}
          name={name}
          className="sr-only"
          checked={isOn}
          tabIndex={single ? undefined : i === act ? 0 : -1}
          onChange={() => flip(v)}
          onFocus={() => !single && setAct(i)}
        />
        {single ? <Radio /> : <Check on={isOn} />}
        {f.people && v && <Av name={v} />}
        <span className="fck-l">
          {label}
          {sub && <span className="fck-s">{sub}</span>}
        </span>
        {n != null && <span className="fck-n">{fmtN(n)}</span>}
      </label>
    );
  };
  return (
    <Pop
      anchor={anchor}
      back={back}
      onClose={onClose}
      place={place}
      label={'ตัวกรอง ' + f.label}
      title={f.label}
      kind="dialog"
      width={320}
      className="val"
    >
      <div
        className="fval"
        onKeyDown={(ev) => {
          // Enter anywhere but on a button applies
          if (ev.key === 'Enter' && !(ev.target as HTMLElement).closest('button')) {
            ev.preventDefault();
            apply();
          }
        }}
      >
        <div className="fval-h">
          {onBack && <button type="button" className="lnk fval-back" onClick={onBack}>เลือกตัวกรองอื่น</button>}
          <span className="fval-t">{f.label}</span>
          {f.ops && (
            <div className="seg fval-ops" role="group" aria-label="เงื่อนไข">
              <button type="button" aria-pressed={!not} onClick={() => setNot(false)}>คือ</button>
              <button type="button" aria-pressed={not} onClick={() => setNot(true)}>ไม่ใช่</button>
            </div>
          )}
        </div>
        {long && (
          <div className="fval-find">
            <input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'ArrowDown') {
                  ev.preventDefault();
                  moveTo(0);
                }
              }}
              placeholder={f.find ?? (f.people ? 'ค้นหาชื่อ' : 'ค้นหา' + f.label)}
              aria-label={f.find ?? (f.people ? 'ค้นหาชื่อ' : 'ค้นหา' + f.label)}
              data-autofocus={phone ? undefined : ''}
            />
          </div>
        )}
        {!single && (
          <div className="fval-line">
            {sel.length ? (
              <>
                เลือกแล้ว {fmtN(sel.length)} ·{' '}
                <button type="button" className="quiet" onClick={() => setSel([])}>ล้างที่เลือก</button>
              </>
            ) : (
              'เลือกได้หลายรายการ'
            )}
          </div>
        )}
        <div
          ref={(el) => {
            listRef.current = el;
            hl.ref.current = el;
          }}
          className="hl-list fval-list"
          role={single ? 'radiogroup' : 'group'}
          aria-label={f.label}
          onKeyDown={listKeys}
          onPointerOver={hl.bind.onPointerOver}
          onFocus={hl.bind.onFocus}
          onPointerLeave={hl.bind.onPointerLeave}
          onBlur={hl.bind.onBlur}
        >
          <i className="hl" aria-hidden="true" />
          {single && f.all != null && !t && row('', f.all, allN)}
          {list.map((o, i) => row(o.v, o.label, o.n, o.sub, i))}
          {!list.length && <div className="pop-empty">ไม่พบ “{q.trim()}”</div>}
        </div>
        <div className="fval-foot">
          <span className="pop-sum">{left != null && <>เหลือ <b>{fmtN(left)}</b> {unit}</>}</span>
          <button type="button" className="quiet fval-cancel" onClick={() => onClose('cancel')}>ยกเลิก</button>
          <button type="button" className="btn pri sm" onClick={apply}>ใช้ตัวกรอง</button>
        </div>
      </div>
    </Pop>
  );
}
