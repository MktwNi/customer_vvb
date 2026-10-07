import { useState, type CSSProperties } from 'react';

/** Background colours for monogram avatars (white text on each is at least 4.5:1). */
const SWATCH = ['#1F5BD8', '#0B6E66', '#6D4BD8', '#B4570B', '#B03A64', '#2E7D32', '#3949AB', '#0E7490'];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** The company's own name without the legal-form words around it ("บริษัท … จำกัด (มหาชน)"). */
export function coreName(name: string) {
  return name
    .replace(/\((สำนักงานใหญ่|มหาชน|ประเทศไทย|สาขา[^)]*)\)/g, ' ')
    .replace(/^\s*(บริษัท|บจก\.?|บมจ\.?|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วนสามัญ|หจก\.?|โรงงาน|สหกรณ์|มูลนิธิ|สมาคม)\s*/, '')
    .replace(/\s*(จำกัด|จก\.|co\.?,?\s*ltd\.?|company limited|public company limited|plc\.?|ltd\.?|limited|inc\.?)\s*$/i, '')
    .trim();
}

/** One or two letters for the avatar: the SET symbol when listed, else the name's first letter(s). */
export function monogram(name: string, set?: string) {
  if (set) return set.slice(0, 4).toUpperCase();
  const n = coreName(name) || name;
  const words = n.split(/\s+/).filter((w) => /[A-Za-z]/.test(w[0] || ''));
  if (words.length && /^[A-Za-z]/.test(n)) return (words[0][0] + (words[1]?.[0] || '')).toUpperCase();
  return Array.from(n).find((ch) => /[ก-ฮA-Za-z0-9]/.test(ch)) || '•';
}

const hostOf = (web?: string) => {
  if (!web) return '';
  try {
    return new URL(/^https?:\/\//i.test(web) ? web : 'https://' + web).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * A company's picture: its website icon when it has a website (fetched by the browser from Google's
 * favicon service, shown only if it is a real, sharp icon), otherwise a coloured monogram — the SET
 * symbol for listed companies, else the first letter of the name. Decorative: the name is always
 * written next to it.
 */
export function CoAvatar({ name, web, set, size = 36, ring, style }: { name: string; web?: string; set?: string; size?: number; ring?: string; style?: CSSProperties }) {
  const host = hostOf(web);
  const [logo, setLogo] = useState<'wait' | 'ok' | 'none'>(host ? 'wait' : 'none');
  const text = monogram(name, set);
  const bg = SWATCH[hash(coreName(name) || name) % SWATCH.length];
  const fs = Math.round(size * (text.length > 2 ? 0.3 : text.length > 1 ? 0.36 : 0.44));
  return (
    <span
      className="co-ava"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: fs, background: logo === 'ok' ? '#fff' : bg, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined, ...style }}
    >
      {logo !== 'ok' && text}
      {host && logo !== 'none' && (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          // the service answers unknown sites with a tiny generic globe: keep the monogram then
          onLoad={(ev) => setLogo((ev.target as HTMLImageElement).naturalWidth >= 32 ? 'ok' : 'none')}
          onError={() => setLogo('none')}
          // kept in the layout (not display:none) or the lazy image would never load
          style={{ opacity: logo === 'ok' ? 1 : 0 }}
        />
      )}
    </span>
  );
}
