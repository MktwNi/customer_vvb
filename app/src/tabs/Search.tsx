import { useDeferredValue, useMemo, type CSSProperties } from 'react';
import { useApp, useEngineVersion, useNarrow } from '../state';
import { CONFIG, CST, FEEDS, GCOL, GI_COL, PILL, SRCC, STG, TGT, stageOf } from '../lib/constants';
import { fmtN, isoTh, ymTh } from '../lib/format';
import { CLEAR_FILTERS, filterAll, type Filters } from '../lib/search';
import type { Cert, Company } from '../lib/types';
import { Opts, Pager, SrcTags, card, tabular } from '../components/ui';

const empty = (text: string, boxed?: boolean) => (
  <div style={boxed ? { padding: 32, textAlign: 'center', color: '#475069', background: '#fff', borderRadius: 18 } : { padding: 40, textAlign: 'center', color: '#475069' }}>{text}</div>
);

export function Search() {
  const { engine: e, ui, set, setF, open } = useApp();
  const v = useEngineVersion();
  const narrow = useNarrow();
  const s = ui.f;
  // Typing only defers the query; memo on the other filter fields (not the `s` object, which
  // changes identity on every keystroke) so the urgent render reuses the previous result.
  const q = useDeferredValue(s.q);
  const { q: _q, ...rest } = s;
  const restKey = JSON.stringify(rest);
  const fs: Filters = useMemo(() => ({ ...(JSON.parse(restKey) as Omit<Filters, 'q'>), q }), [restKey, q]);
  const F = useMemo(() => filterAll(e, fs), [e, fs, v]);
  const D = e.B.D, CD = e.B.CD, C = e.crm, W = e.W;

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
  const rowPad = CONFIG.density === 'compact' ? '8px 20px' : '12px 20px';

  const dictOpts = (arr: string[], m: Record<number, number>, byName?: boolean) =>
    arr.map((l, i) => ({ v: String(i), label: `${l} (${fmtN(m[i] || 0)})`, l, n: m[i] || 0 }))
      .filter((o) => o.l && o.n)
      .sort((a, b) => (byName ? a.l.localeCompare(b.l, 'th') : b.n - a.n));
  const rndOpts = e.R.filter((x) => x.docT >= e.T || x.annT >= e.T).map((x) => ({ v: x.no, label: 'รอบ ' + x.no })).concat([{ v: 'later', label: 'หลังรอบในตาราง' }]);
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
  const sortOpts = s.view === 'cert'
    ? [['ap', 'อนุมัติล่าสุด'], ['exp', 'หมดอายุก่อน'], ['name', 'ชื่อ ก–ฮ']]
    : [['default', 'กลุ่มเป้าหมาย'], ['exp', 'CFO หมดอายุก่อน'], ['invest', 'เงินลงทุนโรงงานใหม่สูงสุด'], ['gi', 'GI ระดับสูงสุด'], ['fac', 'จำนวนโรงงานมากสุด'], ['name', 'ชื่อ ก–ฮ']];

  const star = (id: number) => {
    const on = C.watch.includes(id);
    return { star: on ? '★' : '☆', fg: on ? '#E8A23B' : '#C9D1E6', toggle: () => e.toggleWatch(id) };
  };
  const rndPill = (c: Company) =>
    c.rnd ? { label: (c.cfoSt === 'expired' ? 'ยื่นใหม่รอบ ' : 'ยื่นรอบ ') + c.rnd, bg: c.rndLapse ? '#FBE3DC' : '#E6ECFD', fg: c.rndLapse ? '#8A2B12' : '#1A2FB0' } : null;
  const cfoView = (c: Company) => {
    const [t, fg] = CST[c.cfoSt];
    return { t, fg, sub: c.cfoSt === 'none' ? '' : c.cfoSt === 'soon' ? `เหลือ ${fmtN(c.days)} วัน · ${isoTh(c.cfoEx)}` : c.cfoEx ? isoTh(c.cfoEx) : '' };
  };
  const contactOf = (c: Company) => (c.phone ? c.phone.split('|')[0].trim() : c.web ? c.web.replace(/^https?:\/\//, '') : '—');
  const go = (p: number) => {
    set({ page: p });
    window.scrollTo(0, 0);
  };
  const sel: CSSProperties = { height: 42, borderRadius: 12, padding: '0 10px', fontSize: 14, color: '#0E1430' };

  const coCols = '32px minmax(0,2.3fr) minmax(0,1.2fr) 140px 160px 80px minmax(0,1.2fr)';
  const ctCols = '32px 160px minmax(0,2.2fr) minmax(0,1fr) 110px 150px 120px';

  return (
    <>
      <section style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#E6ECFD', borderRadius: 999, padding: 4, gap: 2 }}>
            {([['co', 'บริษัท'], ['cert', 'ใบรับรอง CFO']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setF({ view: k, sort: k === 'cert' ? 'ap' : 'default' })} style={{ cursor: 'pointer', border: 0, height: 40, padding: '0 18px', borderRadius: 999, fontSize: 14, background: s.view === k ? '#0A1A86' : 'transparent', color: s.view === k ? '#fff' : '#1A2FB0' }}>{label}</button>
            ))}
          </div>
          <input value={s.q} onChange={(ev) => setF({ q: ev.target.value })} placeholder="ค้นหาชื่อบริษัท เลขนิติบุคคล เลขที่ใบรับรอง ชื่อย่อ SET เบอร์โทร หรือรหัส GCC" aria-label="ค้นหา" style={{ flex: 1, minWidth: 260, height: 48, border: '1.5px solid #D5DBEA', borderRadius: 14, padding: '0 16px', fontSize: 15, color: '#0E1430', background: '#fff', outline: 'none' }} />
          <button onClick={() => e.exportCsv(s.view, (s.q === q ? F : filterAll(e, s)).out)} style={{ cursor: 'pointer', height: 48, padding: '0 18px', borderRadius: 14, border: '1.5px solid #0A1A86', background: '#fff', color: '#0A1A86', fontSize: 14 }}>ส่งออก CSV</button>
          <button onClick={() => set({ addCust: { deal: false, name: q } })} title="เพิ่มบริษัทที่ไม่มีในทะเบียน" style={{ cursor: 'pointer', height: 48, padding: '0 18px', borderRadius: 14, border: 0, background: '#0A1A86', color: '#fff', fontSize: 14 }}>+ เพิ่มลูกค้าใหม่</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tgtChips.map((c) => (
            <button key={c.label} onClick={() => setF({ tgt: c.i == null ? '' : String(c.i) })} style={{ cursor: 'pointer', height: 34, padding: '0 12px', borderRadius: 999, border: `1.5px solid ${c.act ? '#0A1A86' : '#D5DBEA'}`, background: c.act ? '#0A1A86' : '#fff', color: c.act ? '#fff' : '#0E1430', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>{c.label}</span>
              <span style={{ opacity: 0.75, ...tabular }}>{fmtN(c.n)}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px 12px' }}>
          {selects.map(([label, k, options]) => {
            const val = s[k] as string;
            const on = val !== '';
            return (
              <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, color: '#475069' }}>
                {label}
                <select value={val} onChange={(ev) => setF({ [k]: ev.target.value } as Partial<Filters>)} style={{ ...sel, border: `1.5px solid ${on ? '#1A3FE0' : '#D5DBEA'}`, background: on ? '#EEF2FF' : '#fff' }}>
                  <Opts options={options} all="ทั้งหมด" />
                </select>
              </label>
            );
          })}
        </div>
        {activeChips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {activeChips.map((c) => (
              <button key={c.label} onClick={() => setF(c.p)} style={{ cursor: 'pointer', height: 30, padding: '0 12px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 12.5 }}>{c.label} ×</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 15 }}>
            <span style={{ fontWeight: 600, fontSize: 20 }}>{fmtN(F.out.length)}</span> {s.view === 'cert' ? 'ใบรับรอง' : 'บริษัท'}{' '}
            <span style={{ color: '#475069', fontSize: 13.5 }}>{s.view === 'cert' ? '· ตัวกรองบริษัทใช้กับบริษัทเจ้าของใบรับรอง' : `· มีเบอร์โทร ${fmtN(F.ph)}`}</span>
          </span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {hasFilter && <button onClick={() => setF(CLEAR_FILTERS)} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#1A3FE0', fontSize: 13.5, textDecoration: 'underline' }}>ล้างตัวกรอง</button>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#475069' }}>
              เรียงตาม
              <select value={s.sort} onChange={(ev) => setF({ sort: ev.target.value })} style={{ height: 38, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 13.5, background: '#fff', color: '#0E1430' }}>
                <Opts options={sortOpts.map(([v, label]) => ({ v, label }))} />
              </select>
            </label>
          </div>
        </div>
      </section>

      {s.view === 'co' && narrow && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(sl as Company[]).map((c) => {
            const st = star(c.id), cv = cfoView(c), g = GI_COL[c.giLive || 1] || GI_COL[1];
            return (
              <div key={c.id} style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 18, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <button onClick={() => open(c.id)} style={{ cursor: 'pointer', flex: 1, border: 0, background: 'transparent', textAlign: 'left', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, color: '#0E1430' }}>
                    <span style={{ fontSize: 15, fontWeight: 500, textWrap: 'pretty' }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: '#475069' }}>{c.code} · {D.prov[c.prov] || '—'}</span>
                  </button>
                  <button onClick={st.toggle} aria-label="ติดตาม" style={{ cursor: 'pointer', width: 44, height: 44, flex: 'none', border: 0, background: 'transparent', fontSize: 22, color: st.fg }}>{st.star}</button>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 6, background: GCOL[c.tgt][0], color: GCOL[c.tgt][1] }}>กลุ่ม {c.tgt + 1}</span>
                  <SrcTags mask={c.src} />
                  {!!c.giLive && <span style={{ fontSize: 11.5, fontWeight: 500, padding: '2px 8px', borderRadius: 8, background: g[0], color: g[1] }}>GI ระดับ {c.giLive}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderTop: '1px solid #EEF1F8', paddingTop: 10, fontSize: 13 }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11.5, color: '#5E6680' }}>CFO</span>
                    <span style={{ color: cv.fg, fontWeight: 500 }}>{cv.t}</span>
                    <span style={{ fontSize: 12, color: '#475069' }}>{cv.sub}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 11.5, color: '#5E6680' }}>ติดต่อ</span>
                    <span style={{ wordBreak: 'break-word' }}>{contactOf(c)}</span>
                    {C.owners[c.id] && <span style={{ fontSize: 12, color: '#475069' }}>ผู้รับผิดชอบ {C.owners[c.id]}</span>}
                  </span>
                </div>
              </div>
            );
          })}
          {!F.out.length && empty('ไม่พบรายการตามเงื่อนไข', true)}
        </section>
      )}

      {s.view === 'cert' && narrow && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(sl as Cert[]).map((ct) => {
            const [bg, fg] = PILL[ct.st];
            return (
              <button key={ct.cid} onClick={() => open(ct.gid)} style={{ cursor: 'pointer', textAlign: 'left', background: '#fff', border: '1px solid #E3E7F1', borderRadius: 18, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, color: '#0E1430' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: '#0A1A86' }}>{ct.cert || '—'}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 10px', borderRadius: 999, background: bg, color: fg }}>{CST[ct.st][0]}</span>
                </span>
                <span style={{ fontSize: 15, fontWeight: 500, textWrap: 'pretty' }}>{ct.org}</span>
                <span style={{ fontSize: 12.5, color: '#475069' }}>{ct.provTxt || CD.prov[ct.prov] || '—'} · อนุมัติ {isoTh(ct.ap)} · หมดอายุ {isoTh(ct.ex)}</span>
              </button>
            );
          })}
          {!F.out.length && empty('ไม่พบรายการตามเงื่อนไข', true)}
        </section>
      )}

      {s.view === 'co' && !narrow && (
        <section style={{ ...card, overflowX: 'auto' }}>
          <div style={{ minWidth: 1060 }}>
            <div style={{ display: 'grid', gridTemplateColumns: coCols, gap: 14, padding: '13px 20px', fontSize: 12.5, color: '#475069', background: '#F7F8FC', borderBottom: '1px solid #E3E7F1' }}>
              <span /><span>บริษัท</span><span>จังหวัด · อุตสาหกรรม</span><span>แหล่งข้อมูล</span><span>CFO</span><span>GI</span><span>ติดต่อ · สถานะการขาย</span>
            </div>
            {(sl as Company[]).map((c) => {
              const st = star(c.id), cv = cfoView(c), g = GI_COL[c.giLive || 1] || GI_COL[1], rp = rndPill(c), sg = stageOf(C.stages[c.id]);
              const owner = C.owners[c.id];
              return (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: coCols, gap: 14, padding: rowPad, borderBottom: '1px solid #EEF1F8', alignItems: 'center' }}>
                  <button onClick={st.toggle} title="ติดตาม" style={{ cursor: 'pointer', border: 0, background: 'transparent', fontSize: 19, color: st.fg, padding: 0 }}>{st.star}</button>
                  <button onClick={() => open(c.id)} style={{ cursor: 'pointer', border: 0, background: 'transparent', textAlign: 'left', padding: 0, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, color: '#0E1430' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 500, textWrap: 'pretty' }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: '#475069', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ padding: '1px 7px', borderRadius: 6, background: GCOL[c.tgt][0], color: GCOL[c.tgt][1] }}>กลุ่ม {c.tgt + 1}</span>
                      <span>{c.code}</span>
                      <span>{D.type[c.type]}</span>
                      {c.set && <span style={{ fontWeight: 500, color: '#0E1F7A' }}>{c.set}</span>}
                      {c.ids.length > 1 && <span style={{ color: '#1A3FE0' }}>รวม {c.ids.length} แถว</span>}
                    </span>
                  </button>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13.5, minWidth: 0 }}>
                    <span>{D.prov[c.prov] || '—'}</span>
                    <span style={{ fontSize: 12, color: '#475069' }}>{D.ind[c.ind]}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><SrcTags mask={c.src} /></span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, alignItems: 'flex-start' }}>
                    <span style={{ color: cv.fg, fontWeight: 500 }}>{cv.t}</span>
                    <span style={{ fontSize: 12, color: '#475069' }}>{cv.sub}</span>
                    {rp && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: rp.bg, color: rp.fg }}>{rp.label}</span>}
                  </span>
                  <span>{!!c.giLive && <span style={{ fontSize: 12.5, fontWeight: 500, padding: '2px 8px', borderRadius: 8, background: g[0], color: g[1] }}>ระดับ {c.giLive}</span>}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', fontSize: 13, minWidth: 0 }}>
                    <span style={{ wordBreak: 'break-word' }}>{contactOf(c)}</span>
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {sg[0] !== 'none' && <span style={{ fontSize: 11.5, padding: '1px 8px', borderRadius: 999, background: sg[2], color: sg[3] }}>{sg[1]}</span>}
                      {owner && <span style={{ fontSize: 11.5, padding: '1px 8px', borderRadius: 999, background: '#F4F6FC', color: '#384155' }}>{owner}</span>}
                    </span>
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
          <div style={{ minWidth: 1000 }}>
            <div style={{ display: 'grid', gridTemplateColumns: ctCols, gap: 14, padding: '13px 20px', fontSize: 12.5, color: '#475069', background: '#F7F8FC', borderBottom: '1px solid #E3E7F1' }}>
              <span /><span>เลขที่ใบรับรอง</span><span>องค์กร · กิจกรรม</span><span>จังหวัด</span><span>วันที่อนุมัติ</span><span>วันหมดอายุ</span><span>สถานะ</span>
            </div>
            {(sl as Cert[]).map((ct) => {
              const st = star(ct.gid), [bg, fg] = PILL[ct.st];
              const rp = ct.isLatest && !ct.bad && ct.co ? rndPill(ct.co) : null;
              return (
                <div key={ct.cid} style={{ display: 'grid', gridTemplateColumns: ctCols, gap: 14, padding: rowPad, borderBottom: '1px solid #EEF1F8', alignItems: 'center', fontSize: 13.5 }}>
                  <button onClick={st.toggle} title="ติดตาม" style={{ cursor: 'pointer', border: 0, background: 'transparent', fontSize: 19, color: st.fg, padding: 0 }}>{st.star}</button>
                  <span style={{ fontWeight: 500, color: '#0A1A86' }}>{ct.cert || '—'}</span>
                  <button onClick={() => open(ct.gid)} style={{ cursor: 'pointer', border: 0, background: 'transparent', textAlign: 'left', padding: 0, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, color: '#0E1430' }}>
                    <span style={{ fontWeight: 500, textWrap: 'pretty' }}>{ct.org}</span>
                    <span style={{ fontSize: 12, color: '#475069' }}>{ct.act}</span>
                  </button>
                  <span>{ct.provTxt || CD.prov[ct.prov] || '—'}</span>
                  <span style={tabular}>{isoTh(ct.ap)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                    <span style={tabular}>{isoTh(ct.ex)}</span>
                    {rp && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: rp.bg, color: rp.fg }}>{rp.label}</span>}
                    {ct.bad && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: '#FDECC8', color: '#9A5A00' }}>วันหมดอายุผิดปกติ</span>}
                  </span>
                  <span><span style={{ fontSize: 12, fontWeight: 500, padding: '3px 10px', borderRadius: 999, background: bg, color: fg }}>{CST[ct.st][0]}</span></span>
                </div>
              );
            })}
            {!F.out.length && empty('ไม่พบรายการตามเงื่อนไข')}
          </div>
        </section>
      )}

      <Pager page={page} pages={pages} onPrev={() => go(page - 1)} onNext={() => go(page + 1)} wrap color="#0E1430" />
    </>
  );
}
