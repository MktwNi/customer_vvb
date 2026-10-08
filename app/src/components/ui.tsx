import type { CSSProperties, ReactNode } from 'react';
import { SRCC, tagsOf } from '../lib/constants';
import { isoTh } from '../lib/format';

/** One white card (design §7.2): radius 20, hairline border, the card shadow. The class `.card` is the same. */
export const card: CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)' };
/** The brand gradient: the shell, the hero KPI card and the sign-in panel only. */
export const heroGrad = 'var(--hero)';
// fields and buttons are classes (.fld, .fld.sel, .btn.pri, .btn, .lnk, .quiet in index.css), not inline
// styles: an inline background or border would beat their :hover
export const labelCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-2)' };
export const tabular: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** Inline-style helpers for the text roles (design §4). */
export const T = {
  meta: { fontSize: 12, color: 'var(--muted)' },
  sec: { fontSize: 13, color: 'var(--ink-2)' },
  body: { fontSize: 14, color: 'var(--ink)' },
  name: { fontSize: 14, fontWeight: 500, color: 'var(--ink)' },
  card: { fontSize: 16, fontWeight: 500, color: 'var(--ink)' },
  section: { fontSize: 18, fontWeight: 500, color: 'var(--ink)' },
  title: { fontSize: 24, fontWeight: 500, color: 'var(--ink)' },
} satisfies Record<string, CSSProperties>;

/** The page's one title (24/500) with a short grey subtitle; `right` holds the page's actions. Phones
 *  hide the title (the top bar says it). */
export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  const head = (
    <div className="pg-h">
      <h2>{title}</h2>
      {sub != null && sub !== '' && <span className="pg-h-sub">{sub}</span>}
    </div>
  );
  if (!right) return head;
  return <div className="pg-row">{head}{right}</div>;
}

/** A block's heading on a page (18/500), an optional short subtitle, and one text link at the right. */
export function SectionHead({ title, sub, link, id, as: H = 'h2' }: { title: string; sub?: ReactNode; link?: ReactNode; id?: string; as?: 'h2' | 'h3' }) {
  return (
    <div className="sec-h">
      <H id={id}>{title}</H>
      {sub != null && sub !== '' && <span className="sec-h-sub">{sub}</span>}
      {link && <span className="sec-h-link">{link}</span>}
    </div>
  );
}

/** A KPI card (§7.1): label, figure (+ unit), hairline, footer. `hero` = the first card of a row.
 *  With `onClick` it is a button that filters. */
export function Kpi({ label, value, unit, foot, hero, big, zero, onClick, title, pressed }: { label: ReactNode; value: ReactNode; unit?: string; foot?: ReactNode; hero?: boolean; big?: boolean; zero?: boolean; onClick?: () => void; title?: string; pressed?: boolean }) {
  const body = (
    <>
      <span className="kpi-l">{label}</span>
      <span className={'kpi-v' + (big ? ' big' : '') + (zero ? ' zero' : '')}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {foot != null && <span className="kpi-f">{foot}</span>}
    </>
  );
  const cls = 'kpi' + (hero ? ' hero' : '');
  return onClick ? (
    <button type="button" className={cls + (hero ? '' : ' hv')} onClick={onClick} title={title} aria-pressed={pressed}>{body}</button>
  ) : (
    <div className={cls} title={title}>{body}</div>
  );
}

export type StatusKind = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
/** A status (§7.5): dot + word, or a tinted chip (`chip`) only for a state that needs action now. */
export function Status({ kind, children, chip, title }: { kind: StatusKind; children: ReactNode; chip?: boolean; title?: string }) {
  return <span className={(chip ? 'chip ' : 'st ') + kind} title={title}>{children}</span>;
}

/** Segmented control (§7.7): one neutral track; counts plain, an overdue count red (`od`). */
export function Segmented<V extends string>({ value, options, onChange, label, id }: { value: V; options: { v: V; label: ReactNode; n?: number; od?: boolean; title?: string }[]; onChange: (v: V) => void; label: string; id?: string }) {
  return (
    <div className="seg" role="group" aria-label={label} id={id}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)} title={o.title}>
          {o.label}
          {o.n != null && <span className={'n' + (o.od && o.n > 0 ? ' od' : '')}>{o.n.toLocaleString('en-US')}</span>}
        </button>
      ))}
    </div>
  );
}

/** The sources a company was found in, as plain grey text: "TGO · GI · SET" (metadata is never a coloured pill). */
export function SrcTags({ mask }: { mask: number; size?: 'sm' | 'md' | 'lg' }) {
  const t = tagsOf(mask).map((x) => x.t);
  return t.length ? <span className="t-muted">{t.join(' · ')}</span> : null;
}
/** The sources as words, for a " · "-joined line. */
export const srcWords = (mask: number) => SRCC.filter((_, i) => mask & (1 << i)).map(([t]) => t);

/** A short piece of metadata: plain text, muted (the colours are ignored, kept for old callers). */
export function Pill({ children, style }: { bg?: string; fg?: string; children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontSize: 12, color: 'var(--muted)', ...style }}>{children}</span>;
}

/** Prev/next pager in words (no arrows). */
export function Pager({ page, pages, onPrev, onNext, wrap }: { page: number; pages: number; onPrev: () => void; onNext: () => void; wrap?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, flexWrap: wrap ? 'wrap' : undefined }}>
      <button className="btn sm" onClick={onPrev} disabled={page <= 0}>ก่อนหน้า</button>
      <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>หน้า {(page + 1).toLocaleString('en-US')} / {pages.toLocaleString('en-US')}</span>
      <button className="btn sm" onClick={onNext} disabled={page >= pages - 1}>ถัดไป</button>
    </div>
  );
}

/** A notice (§7.11): one quiet line; only an error gets a fill. */
const NOTICE = { error: 'note err', ok: 'note t-ok', info: 'note', warn: 'note t-warn' } as const;
export function Notice({ kind, children, role }: { kind: keyof typeof NOTICE; children: ReactNode; role?: 'alert' | 'status' }) {
  return <div role={role} className={NOTICE[kind]}>{children}</div>;
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, flex: 'none', display: 'inline-block' }} />;
}

/**
 * A date field that reads as Thai text ("8 ต.ค. 2569", design §7.10): the browser's own date input does
 * the picking (a click opens its calendar), but its mm/dd/yyyy never shows.
 */
export function DateField({ value, onChange, label, placeholder = 'เลือกวันที่', id, name, min, max, style }: { value: string; onChange: (iso: string) => void; label?: string; placeholder?: string; id?: string; name?: string; min?: string; max?: string; style?: CSSProperties }) {
  const open = (el: HTMLInputElement) => {
    try {
      el.showPicker();
    } catch {
      /* an older browser: its own field still works */
    }
  };
  return (
    <span className="dfld" style={style}>
      <input
        type="date"
        id={id}
        name={name}
        className="fld"
        value={value}
        min={min}
        max={max}
        aria-label={label}
        onChange={(ev) => onChange(ev.target.value)}
        onClick={(ev) => open(ev.currentTarget)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            open(ev.currentTarget);
          }
        }}
      />
      <span className={'dfld-tx' + (value ? '' : ' empty')} aria-hidden="true">{value ? isoTh(value) : placeholder}</span>
    </span>
  );
}

/** <select> for an options list with a leading "ทั้งหมด" option. */
export function Opts({ options, all }: { options: { v: string; label: string }[]; all?: string }) {
  return (
    <>
      {all != null && <option value="">{all}</option>}
      {options.map((o) => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </>
  );
}
