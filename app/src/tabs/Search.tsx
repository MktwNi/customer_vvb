import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { scrollTop, useApp, useEngineVersion, useNarrow } from '../state';
import { CONFIG, CST, FEEDS, GDESC, SRCC, STG, TGT, stageOf } from '../lib/constants';
import { fmtN, isoTh, ymTh } from '../lib/format';
import { CLEAR_FILTERS, filterAll, joinVals, splitVals, type Filters } from '../lib/search';
import type { CfoStatus, Cert, Company } from '../lib/types';
import { Pager, Status, card, srcWords, tabular } from '../components/ui';
import { Icon } from '../components/icons';
import { useSlide } from '../components/useSlide';
import { FilterBar, ReadChip, type FField, type FVal } from '../components/FilterBar';
import { Select } from '../components/Select';
import { TickBox } from '../components/MonthCheck';
import { BulkBar, searchSel, useSel } from '../components/BulkBar';
import { useSalesActs } from '../components/SalesToast';
import { allWord, clearedWord, keyView, pruneSel, selKey, selView, toggleAll, toggleKey } from '../lib/bulk';

const empty = (text: string) => <div className="empty" style={{ padding: '24px 20px' }}>{text}</div>;
const NONE: ReadonlySet<number> = new Set();
/** A CFO status as dot + word; "ใกล้หมดอายุ" is the one that needs action now, so it is a tinted chip. */
const cfoStatus = (st: CfoStatus, label: string) =>
  st === 'soon' ? <Status kind="warn" chip>{label}</Status> : <Status kind={st === 'active' ? 'ok' : st === 'expired' ? 'bad' : 'neutral'}>{label}</Status>;

export function Search() {
  const { engine: e, ui, set, setF, open } = useApp();
  const v = useEngineVersion();
  const narrow = useNarrow();
  const chipsRef = useRef<HTMLDivElement>(null);
  const s = ui.f;
  // the white pill slides between บริษัท and ใบรับรอง CFO
  const toggleRef = useRef<HTMLDivElement>(null);
  useSlide(toggleRef, 'button[aria-pressed=true]', s.view);
  // Typing only defers the query; memo on the other filter fields (not the `s` object, which
  // changes identity on every keystroke) so the urgent render reuses the previous result.
  const q = useDeferredValue(s.q);
  const { q: _q, ...rest } = s;
  const restKey = JSON.stringify(rest);
  const fs: Filters = useMemo(() => ({ ...(JSON.parse(restKey) as Omit<Filters, 'q'>), q }), [restKey, q]);
  const F = useMemo(() => filterAll(e, fs), [e, fs, v]);
  const D = e.B.D, CD = e.B.CD, C = e.crm, W = e.W;
  const { say } = useSalesActs();

  // ---- picking rows for the bulk actions (components/BulkBar.tsx): every result, not only this page;
  // kept while paging, sorting, opening a company or another page; let go (and said) when the rows change
  const key = selKey(fs);
  const S = useSel();
  const sel = S.key === key ? S.ids : NONE;
  const sv = useMemo(() => selView(sel, F.out), [sel, F.out]);
  useEffect(() => {
    const cur = searchSel.get();
    if (cur.key !== key) {
      if (cur.ids.size && cur.key) say(clearedWord(cur.ids.size, keyView(cur.key)));
      searchSel.set({ key, ids: new Set() });
    } else {
      // a picked company that left the results (e.g. เลิกติดตาม with the ติดตาม filter on) is let go
      const p = pruneSel(cur.ids, F.out);
      if (p !== cur.ids) searchSel.set({ key, ids: p });
    }
  }, [key, F.out]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (k: number) => searchSel.set({ key, ids: toggleKey(sel, k) });
  const pickAll = () => searchSel.set({ key, ids: toggleAll(sel, F.out) });
  /** A row's box. Its whole cell picks the row (`cell`: on the desktop rows, out to the row's edges: its full
   *  height, its left padding, half the gap), so a near miss never opens the company; the box itself is the
   *  control a keyboard or a screen reader uses. */
  const tick = (k: number, name: string, cell?: React.CSSProperties) => (
    <span className="sx-tk" style={cell} onClick={(ev) => (ev.stopPropagation(), pick(k))}>
      <TickBox on={sel.has(k)} label={'เลือก ' + name} onClick={() => pick(k)} />
    </span>
  );

  const counts = useMemo(() => {
    const cnt = (k: 'ind' | 'prov' | 'type') => {
      const m: Record<number, number> = {};
      e.B.companies.forEach((c) => (m[c[k]] = (m[c[k]] || 0) + 1));
      return m;
    };
    return { ind: cnt('ind'), prov: cnt('prov'), type: cnt('type') };
  }, [e, v]);

  const ps = CONFIG.pageSize;
  const pages = Math.max(1, Math.ceil(F.out.length / ps));
  const page = Math.min(ui.page, pages - 1);
  const sl = F.out.slice(page * ps, page * ps + ps);
  const rowPy = CONFIG.density === 'compact' ? 8 : 12;
  const rowPad = `${rowPy}px 20px`;
  const tickCell: React.CSSProperties = { margin: `-${rowPy}px -7px -${rowPy}px -20px`, padding: `${rowPy}px 7px ${rowPy}px 20px` };

  const dictOpts = (arr: string[], m: Record<number, number>, byName?: boolean) =>
    arr.map((l, i) => ({ v: String(i), label: `${l} (${fmtN(m[i] || 0)})`, l, n: m[i] || 0 }))
      .filter((o) => o.l && o.n)
      .sort((a, b) => (byName ? a.l.localeCompare(b.l, 'th') : b.n - a.n));
  const rndOpts = e.R.filter((x) => x.docT >= e.T || x.annT >= e.T).map((x) => ({ v: x.no, label: 'รอบ ' + x.no })).concat([{ v: 'later', label: 'หลังรอบในตาราง' }]);
  // the five filters most used come first in the field menu, then a hairline and the other seven
  const MAIN: (keyof Filters)[] = ['prov', 'ind', 'cfo', 'stage', 'owner'];
  const selects: [string, keyof Filters, { v: string; label: string }[]][] = [
    ['พบในแหล่งข้อมูล', 'src', SRCC.map(([t], i) => ({ v: String(i), label: t }))],
    ['กลุ่มอุตสาหกรรม', 'ind', dictOpts(D.ind, counts.ind)],
    ['จังหวัด', 'prov', dictOpts(D.prov, counts.prov, true)],
    ['ประเภทผู้ประกอบการ', 'type', dictOpts(D.type, counts.type)],
    [s.view === 'cert' ? 'สถานะใบรับรอง' : 'สถานะ CFO', 'cfo', Object.entries(CST).filter(([k]) => s.view !== 'cert' || k !== 'none').map(([k, [l]]) => ({ v: k, label: k === 'soon' ? `${l} ≤ ${W} วัน` : l }))],
    ['GI ระดับที่ยังใช้ได้', 'gi', [['35', 'ระดับ 3–5'], ['5', 'ระดับ 5'], ['4', 'ระดับ 4'], ['3', 'ระดับ 3'], ['2', 'ระดับ 2'], ['1', 'ระดับ 1'], ['none', 'ไม่เคยได้ GI']].map(([v, label]) => ({ v, label }))],
    ['รอบ อบก. ที่ต้องยื่น', 'rnd', rndOpts],
    ['ติดตาม', 'feed', FEEDS.map(([v, label]) => ({ v, label }))],
    ['สถานะการขาย', 'stage', STG.map(([v, label]) => ({ v, label }))],
    ['ผู้รับผิดชอบ', 'owner', [{ v: '-', label: 'ยังไม่มีผู้รับผิดชอบ' }].concat(C.team.map((v) => ({ v, label: v })))],
    ['เงินลงทุนโรงงานใหม่', 'inv', [['5000000', '≥ 5 ล้านบาท'], ['50000000', '≥ 50 ล้านบาท'], ['500000000', '≥ 500 ล้านบาท']].map(([v, label]) => ({ v, label }))],
    ['ข้อมูลติดต่อ', 'ph', [{ v: '1', label: 'มีเบอร์โทร' }, { v: '0', label: 'ยังไม่มีเบอร์โทร' }]],
  ];

  const tgtChips = [{ label: 'ทุกกลุ่ม', n: F.tc.reduce((a, b) => a + b, 0), act: s.tgt === '', i: null as number | null }].concat(
    TGT.map((l, i) => ({ label: `${i + 1}. ${l.replace('ยังไม่มี CFO · ', '')}`, n: F.tc[i], act: s.tgt === String(i), i })),
  );
  const activeChips: { label: string; p: Partial<Filters> }[] = [];
  if (s.ym) activeChips.push({ label: 'โรงงานใหม่ ' + ymTh(s.ym), p: { ym: '' } });
  if (s.expM) activeChips.push({ label: 'หมดอายุเดือน ' + ymTh(String(+s.expM.slice(0, 4) + 543) + s.expM.slice(4)), p: { expM: '' } });
  if (s.cInd !== '') activeChips.push({ label: 'อุตสาหกรรม (TGO): ' + CD.ind[+s.cInd], p: { cInd: '' } });
  if (s.cFy) activeChips.push({ label: 'ปีที่ยื่น ' + s.cFy, p: { cFy: '' } });
  if (s.cProv) activeChips.push({ label: 'จังหวัด (TGO): ' + s.cProv, p: { cProv: '' } });
  const hasFilter = Object.keys(CLEAR_FILTERS).some((k) => s[k as keyof Filters] !== '');
  const mainSel = MAIN.map((k) => selects.find((x) => x[1] === k)!);
  const moreSel = selects.filter(([, k]) => !MAIN.includes(k));
  // the filter row: each field one choice, "ทั้งหมด" first; counts where the lists have them (provinces,
  // industries, operator types), a find field over a long list
  const unit = s.view === 'cert' ? 'ใบรับรอง' : 'บริษัท';
  // the rounds take several ticks; every other field is one choice
  const fields: FField[] = [...mainSel, ...moreSel].map(([label, k, options], i) => ({
    key: k, label, kind: k === 'rnd' ? 'multi' : 'single', all: 'ทั้งหมด', sep: i === MAIN.length,
    options: options.map((o) => ({ v: o.v, label: 'l' in o ? String(o.l) : o.label, n: 'n' in o ? Number(o.n) : undefined })),
  }));
  // a field's value in the filter state: several values comma-joined (lib/search.ts), one value as it is
  const stored = (x: FVal | null) => joinVals(x?.v ?? []);
  const fval: Record<string, FVal | undefined> = Object.fromEntries(fields.map((f) => {
    const raw = String(s[f.key as keyof Filters]);
    const v = f.kind === 'multi' ? [...splitVals(raw)] : raw === '' ? [] : [raw];
    return [f.key, v.length ? { v } : undefined];
  }));
  // screen readers hear the count once typing / filtering settles, not on every keystroke
  const [said, setSaid] = useState('');
  const sayNow = `${fmtN(F.out.length)} ${s.view === 'cert' ? 'ใบรับรอง' : 'บริษัท'}`;
  useEffect(() => {
    const t = setTimeout(() => setSaid(sayNow), 800);
    return () => clearTimeout(t);
  }, [sayNow]);
  // phones scroll the chips sideways: keep the chosen group in view (e.g. when another page set it)
  useEffect(() => {
    const r = chipsRef.current, a = r?.querySelector<HTMLElement>('[aria-pressed=true]');
    if (!r || !a) return;
    const ar = a.getBoundingClientRect(), rr = r.getBoundingClientRect();
    if (ar.left < rr.left || ar.right > rr.right) r.scrollLeft += ar.left - rr.left - 6;
  }, [s.tgt]);
  const sortOpts = s.view === 'cert'
    ? [['ap', 'อนุมัติล่าสุด'], ['exp', 'หมดอายุก่อน'], ['name', 'ชื่อ ก–ฮ']]
    : [['default', 'กลุ่มเป้าหมาย'], ['exp', 'CFO หมดอายุก่อน'], ['invest', 'เงินลงทุนโรงงานใหม่สูงสุด'], ['gi', 'GI ระดับสูงสุด'], ['fac', 'จำนวนโรงงานมากสุด'], ['name', 'ชื่อ ก–ฮ']];

  // following a company (the team's watch list): on its page, or many at once with the bar; a followed row says so in grey
  // (followed by any of its ids: a follow made on a row since merged into it is the company's, lib/follow.ts)
  const watchSet = useMemo(() => new Set(C.watch.map((id) => e.canonical(id))), [e, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const watched = (id: number) => watchSet.has(e.canonical(id));
  const cfoView = (c: Company) => ({ st: c.cfoSt, t: CST[c.cfoSt][0], sub: c.cfoSt === 'none' ? '' : c.cfoSt === 'soon' ? `เหลือ ${fmtN(c.days)} วัน · ${isoTh(c.cfoEx)}` : c.cfoEx ? isoTh(c.cfoEx) : '' });
  const rndText = (c: Company) => (c.rnd ? (c.cfoSt === 'expired' ? 'ยื่นใหม่รอบ ' : 'ยื่นรอบ ') + c.rnd : '');
  /** A click anywhere on a result row opens the company (not on its buttons, nor when text was selected). */
  const rowOpen = (ev: React.MouseEvent, id: number) => {
    if ((ev.target as HTMLElement).closest('button, a, input, select, label, .sx-tk')) return;
    if (window.getSelection()?.toString()) return;
    open(id);
  };
  const contactOf = (c: Company) => (c.phone ? c.phone.split('|')[0].trim() : c.web ? c.web.replace(/^https?:\/\//, '') : '—');
  const go = (p: number) => {
    set({ page: p });
    scrollTop();
  };
  /** Sales status and owner as grey text, "ได้งาน" in green. */
  const saleLine = (c: Company) => {
    const sg = stageOf(C.stages[c.id]);
    const owner = C.owners[c.id];
    if (sg[0] === 'none' && !owner) return null;
    return (
      <span className="t-meta">
        {sg[0] !== 'none' && <span className={sg[0] === 'won' ? 't-ok' : undefined}>{sg[1]}</span>}
        {sg[0] !== 'none' && owner ? ' · ' : ''}
        {owner}
      </span>
    );
  };
  // certificates only concern groups 1–4 (the others have no CFO)
  const chipsShown = tgtChips.filter((c) => s.view !== 'cert' || c.i == null || c.i < 4);

  const coCols = '22px minmax(0,2.3fr) minmax(0,1.2fr) 120px 170px 72px minmax(0,1.2fr)';
  const ctCols = '22px 150px minmax(0,2.2fr) minmax(96px,1fr) 110px 150px 140px';
  const unitN = F.out.length;
  /** The header's box: every result (not only this page), with the count in its name. */
  const headTick = <TickBox on={sv.all} mixed={sv.mixed} label={allWord(s.view, unitN)} onClick={pickAll} />;

  return (
    <>
      <section className="sx card">
        <div className="sx-band">
          <h2 className="sr-only">ค้นหาลูกค้า</h2>
          <div className="sx-row">
            <div className="sx-toggle" role="group" aria-label="ค้นหาจาก" ref={toggleRef}>
              <span className="slide-ind" aria-hidden="true" />
              {([['co', 'บริษัท'], ['cert', 'ใบรับรอง CFO']] as const).map(([k, label]) => (
                <button
                  key={k}
                  aria-pressed={s.view === k}
                  // certificates have no "ยังไม่มี CFO" status: don't carry that filter over (it would hide everything)
                  onClick={() => setF({ view: k, sort: k === 'cert' ? 'ap' : 'default', ...(k === 'cert' && s.cfo === 'none' ? { cfo: '' } : {}), ...(k === 'cert' && +s.tgt >= 4 ? { tgt: '' } : {}) })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="sx-input">
              <Icon name="search" />
              <input id="search-q" value={s.q} onChange={(ev) => setF({ q: ev.target.value })} placeholder="ชื่อบริษัท เลขนิติบุคคล เลขที่ใบรับรอง ชื่อย่อ SET เบอร์โทร หรือรหัส GCC" aria-label="ค้นหา" />
              {s.q && (
                <button className="sx-clear" onClick={() => { setF({ q: '' }); document.getElementById('search-q')?.focus(); }} aria-label="ล้างคำค้น">
                  <Icon name="close" />
                </button>
              )}
            </div>
            <button className="btn" onClick={() => e.exportCsv(s.view, (s.q === q ? F : filterAll(e, s)).out)}>ส่งออก CSV</button>
          </div>
        </div>
        <div className="sx-body">
          <div className="sx-groups">
            <span id="sx-chips-h" className="card-t">กลุ่มเป้าหมาย</span>
            <div className="sx-chips" ref={chipsRef} role="group" aria-labelledby="sx-chips-h">
              {chipsShown.map((c) => (
                <button key={c.label} className="sx-chip" aria-pressed={c.act} title={c.i == null ? 'ทุกบริษัทที่ตรงกับคำค้นและตัวกรอง' : `กลุ่ม ${c.i + 1}: ${GDESC[c.i]} (บริษัทหนึ่งอยู่ได้กลุ่มเดียว ตามข้อแรกที่เข้า)`} onClick={() => setF({ tgt: c.i == null ? '' : String(c.i) })}>
                  <span className="sx-chip-label">{c.label}</span>
                  <span className={'sx-n' + (c.n ? '' : ' zero')}>{fmtN(c.n)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="sx-filters">
            <FilterBar
              fields={fields}
              value={fval}
              onChange={(k, x) => setF({ [k]: stored(x) } as Partial<Filters>)}
              // a drill-down from another page (ภาพรวม, ติดตาม, แผนที่): × only
              extra={activeChips.length ? activeChips.map((c) => <ReadChip key={c.label} text={c.label} onClear={() => setF(c.p)} />) : undefined}
              anySet={hasFilter}
              // the keyword too, as the help says
              onClearAll={() => setF(CLEAR_FILTERS)}
              unit={unit}
              liveCount={(k, x) => filterAll(e, { ...fs, [k]: stored(x) } as Filters, { sort: false }).out.length}
            />
          </div>
          <span className="sr-only" role="status">{said}</span>
          <div className="sx-foot">
            <span className="sx-total">
              <b>{fmtN(F.out.length)}</b> {s.view === 'cert' ? 'ใบรับรอง' : 'บริษัท'}
              {s.view !== 'cert' && <span className="sx-sub">มีเบอร์โทร {fmtN(F.ph)}</span>}
            </span>
            <span className="sx-foot-r">
              {unitN > 0 && (
                <button type="button" role="checkbox" aria-checked={sv.mixed ? 'mixed' : sv.all} className="bk-all hv" onClick={pickAll}>
                  <span className={'ckb' + (sv.all || sv.mixed ? ' on' : '')} aria-hidden="true">
                    {sv.mixed ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" focusable="false"><path d="M6.5 12h11" /></svg> : sv.all ? <Icon name="check" size={14} /> : null}
                  </span>
                  {allWord(s.view, unitN)}
                </button>
              )}
              <Select variant="tool" prefix="เรียงตาม" label="เรียงตาม" value={s.sort} onChange={(v) => setF({ sort: v })} options={sortOpts.map(([v, label]) => ({ v, label }))} search={false} width={260} align="end" />
            </span>
          </div>
        </div>
      </section>

      {/* always in its place while there are results (a quiet line until something is picked): ticking the
          first row never moves the list */}
      {unitN > 0 && <BulkBar view={s.view} rows={F.out} sel={sel} n={sv.n} />}

      {s.view === 'co' && narrow && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(sl as Company[]).map((c) => {
            const cv = cfoView(c);
            const src = srcWords(c.src).map((t) => (t === 'GI' && c.giLive ? 'GI ' + c.giLive : t)).join(' · ');
            return (
              <div key={c.id} className={'sx-mcard card' + (sel.has(c.id) ? ' on' : '')}>
                <div className="sx-mtop">
                  {tick(c.id, c.name)}
                  <button onClick={() => open(c.id)} className="hv-tx sx-mname">
                    <span className="co-name">{c.name}</span>
                    <span className="t-sec">{[c.code, D.prov[c.prov] || '—', 'กลุ่ม ' + (c.tgt + 1), watched(c.id) ? 'ติดตามอยู่' : ''].filter(Boolean).join(' · ')}</span>
                    {src && <span className="t-meta">{src}</span>}
                  </button>
                </div>
                <div className="sx-mgrid">
                  <span className="sx-mcol">
                    <span className="t-meta">CFO</span>
                    {cfoStatus(cv.st, cv.t)}
                    {cv.sub && <span className="t-meta">{cv.sub}</span>}
                  </span>
                  <span className="sx-mcol" style={{ minWidth: 0 }}>
                    <span className="t-meta">ติดต่อ</span>
                    <span style={{ wordBreak: 'break-word' }}>{contactOf(c)}</span>
                    {saleLine(c)}
                  </span>
                </div>
              </div>
            );
          })}
          {!F.out.length && <div className="card">{empty('ไม่พบรายการตามเงื่อนไข')}</div>}
        </section>
      )}

      {s.view === 'cert' && narrow && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(sl as Cert[]).map((ct) => (
            <div key={ct.cid} className={'sx-mcard card' + (sel.has(ct.cid) ? ' on' : '')}>
              <div className="sx-mtop">
                {tick(ct.cid, ct.org)}
                <button onClick={() => open(ct.gid)} className="hv-tx sx-mname">
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <span className="t-sec">{ct.cert || '—'}</span>
                    {cfoStatus(ct.st, CST[ct.st][0])}
                  </span>
                  <span className="co-name">{ct.org}</span>
                  <span className="t-meta">{ct.provTxt || CD.prov[ct.prov] || '—'} · อนุมัติ {isoTh(ct.ap)} · หมดอายุ {isoTh(ct.ex)}</span>
                </button>
              </div>
            </div>
          ))}
          {!F.out.length && <div className="card">{empty('ไม่พบรายการตามเงื่อนไข')}</div>}
        </section>
      )}

      {s.view === 'co' && !narrow && (
        <section style={{ ...card, overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div className="sx-head thead" style={{ gridTemplateColumns: coCols }}>
              {headTick}
              <span>บริษัท</span><span>จังหวัด · อุตสาหกรรม</span><span>แหล่งข้อมูล</span><span>CFO</span><span>GI</span><span>ติดต่อ · สถานะการขาย</span>
            </div>
            {(sl as Company[]).map((c) => {
              const cv = cfoView(c), rt = rndText(c);
              return (
                <div key={c.id} className={'sxr' + (sel.has(c.id) ? ' on' : '')} onClick={(ev) => rowOpen(ev, c.id)} style={{ gridTemplateColumns: coCols, padding: rowPad }}>
                  {tick(c.id, c.name, tickCell)}
                  <button onClick={() => open(c.id)} className="sxr-name">
                    <span className="co-name dense">{c.name}</span>
                    <span className="t-sec sxr-sub">
                      {['กลุ่ม ' + (c.tgt + 1), c.code, D.type[c.type], c.set || '', c.ids.length > 1 ? `รวม ${c.ids.length} แถว` : ''].filter(Boolean).join(' · ')}
                      {watched(c.id) && <span className="t-meta"> · ติดตามอยู่</span>}
                    </span>
                  </button>
                  <span className="sxr-col">
                    <span>{D.prov[c.prov] || '—'}</span>
                    <span className="t-sec">{D.ind[c.ind]}</span>
                  </span>
                  <span className="t-meta" style={{ fontSize: 13 }}>{srcWords(c.src).join(' · ')}</span>
                  <span className="sxr-col">
                    {cfoStatus(cv.st, cv.t)}
                    {cv.sub && <span className="t-meta">{cv.sub}</span>}
                    {rt && <span className="t-meta">{rt}</span>}
                  </span>
                  <span>{c.giLive ? `ระดับ ${c.giLive}` : <span className="t-muted">—</span>}</span>
                  <span className="sxr-col">
                    <span style={{ wordBreak: 'break-word' }}>{contactOf(c)}</span>
                    {saleLine(c)}
                  </span>
                </div>
              );
            })}
            {!F.out.length && empty('ไม่พบรายการตามเงื่อนไข')}
          </div>
        </section>
      )}

      {s.view === 'cert' && !narrow && (
        <section style={{ ...card, overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div className="sx-head thead" style={{ gridTemplateColumns: ctCols }}>
              {headTick}
              <span>เลขที่ใบรับรอง</span><span>องค์กร · กิจกรรม</span><span>จังหวัด</span><span>วันที่อนุมัติ</span><span>วันหมดอายุ</span><span>สถานะ</span>
            </div>
            {(sl as Cert[]).map((ct) => {
              const rt = ct.isLatest && !ct.bad && ct.co ? rndText(ct.co) : '';
              return (
                <div key={ct.cid} className={'sxr' + (sel.has(ct.cid) ? ' on' : '')} onClick={(ev) => rowOpen(ev, ct.gid)} style={{ gridTemplateColumns: ctCols, padding: rowPad }}>
                  {tick(ct.cid, ct.org, tickCell)}
                  <span className="t-sec">{ct.cert || '—'}</span>
                  <button onClick={() => open(ct.gid)} className="sxr-name">
                    <span className="co-name dense">{ct.org}</span>
                    <span className="t-sec sxr-sub">{ct.act}{watched(ct.gid) && <span className="t-meta"> · ติดตามอยู่</span>}</span>
                  </button>
                  <span>{ct.provTxt || CD.prov[ct.prov] || '—'}</span>
                  <span style={tabular}>{isoTh(ct.ap)}</span>
                  <span className="sxr-col">
                    <span style={tabular}>{isoTh(ct.ex)}</span>
                    {rt && <span className="t-meta">{rt}</span>}
                    {ct.bad && <span className="t-warn" style={{ fontSize: 12 }}>วันหมดอายุผิดปกติ</span>}
                  </span>
                  <span>{cfoStatus(ct.st, CST[ct.st][0])}</span>
                </div>
              );
            })}
            {!F.out.length && empty('ไม่พบรายการตามเงื่อนไข')}
          </div>
        </section>
      )}

      <Pager page={page} pages={pages} onPrev={() => go(page - 1)} onNext={() => go(page + 1)} wrap />
    </>
  );
}
