import type { CSSProperties, ReactNode } from 'react';
import { tagsOf } from '../lib/constants';

export const card: CSSProperties = { background: '#fff', border: '1px solid #E6EBF5', borderRadius: 24, boxShadow: '0 1px 2px rgba(16,40,120,.04), 0 10px 28px -18px rgba(16,40,120,.22)' };
export const heroGrad = 'linear-gradient(125deg,#1745B8 0%,#1F5BD8 62%,#2462DD 100%)';
export const selectStyle: CSSProperties = { height: 40, border: '1.5px solid #D5DBEA', borderRadius: 12, padding: '0 10px', fontSize: 14, background: '#fff', color: '#0E1430' };
export const inputStyle: CSSProperties = { height: 40, border: '1.5px solid #D5DBEA', borderRadius: 12, padding: '0 12px', fontSize: 14 };
export const labelCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, color: '#475069' };
export const btnPrimary: CSSProperties = { cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13.5 };
export const btnOutline: CSSProperties = { cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: '1.5px solid #1F5BD8', background: '#fff', color: '#1F5BD8', fontSize: 13.5 };
export const linkBtn: CSSProperties = { cursor: 'pointer', border: 0, background: 'transparent', color: '#1F5BD8', fontSize: 13.5, textDecoration: 'underline', padding: 0 };
export const tabular: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** Page title row: big heading + light subtitle. */
export function PageHead({ title, sub, no, right, wrapSub, gap = 14, nowrap }: { title: string; sub?: ReactNode; no?: string; right?: ReactNode; wrapSub?: boolean; gap?: number; nowrap?: boolean }) {
  const head = (
    <div style={{ display: 'flex', alignItems: 'baseline', gap, flexWrap: nowrap ? undefined : 'wrap' }}>
      {no && <span style={{ fontSize: 15, fontWeight: 600, color: '#1F5BD8' }}>{no}</span>}
      <h2 style={{ margin: 0, fontSize: 28, fontWeight: 500, color: 'var(--brand-deep)' }}>{title}</h2>
      {sub != null && <span style={{ fontSize: 14, color: '#475069', fontWeight: 300, textWrap: wrapSub ? 'pretty' : undefined }}>{sub}</span>}
    </div>
  );
  if (!right) return head;
  return <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, justifyContent: 'space-between', flexWrap: 'wrap' }}>{head}{right}</div>;
}

export function SrcTags({ mask, size = 'md' }: { mask: number; size?: 'sm' | 'md' | 'lg' }) {
  const st: CSSProperties =
    size === 'sm' ? { fontSize: 10.5, padding: '1px 6px', borderRadius: 999 }
    : size === 'lg' ? { fontSize: 11.5, fontWeight: 500, padding: '3px 9px', borderRadius: 999 }
    : { fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 999 };
  return (
    <>
      {tagsOf(mask).map((t) => (
        <span key={t.t} style={{ ...st, background: t.bg, color: t.fg }}>{t.t}</span>
      ))}
    </>
  );
}

export function Pill({ bg, fg, children, style }: { bg: string; fg: string; children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: bg, color: fg, ...style }}>{children}</span>;
}

/** Prev/next pager. `color` is optional: without it the browser's default (and its disabled grey) applies, as in the design's dedup pager. */
export function Pager({ page, pages, onPrev, onNext, wrap, color }: { page: number; pages: number; onPrev: () => void; onNext: () => void; wrap?: boolean; color?: string }) {
  const b: CSSProperties = { cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: '1.5px solid #D5DBEA', background: '#fff', color, fontSize: 14 };
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, flexWrap: wrap ? 'wrap' : undefined }}>
      <button onClick={onPrev} disabled={page <= 0} style={b}>‹ ก่อนหน้า</button>
      <span style={{ fontSize: 14, color: '#475069' }}>หน้า {(page + 1).toLocaleString('en-US')} / {pages.toLocaleString('en-US')}</span>
      <button onClick={onNext} disabled={page >= pages - 1} style={b}>ถัดไป ›</button>
    </div>
  );
}

export function Notice({ kind, children, role }: { kind: 'error' | 'ok'; children: ReactNode; role?: 'alert' | 'status' }) {
  const [bg, fg] = kind === 'error' ? ['#FBE3DC', '#8A2B12'] : ['#DDF5F1', '#0B6E66'];
  return <div role={role} style={{ background: bg, color: fg, borderRadius: 12, padding: '12px 14px', fontSize: 13.5 }}>{children}</div>;
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, flex: 'none', display: 'inline-block' }} />;
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
