import { useMemo, type CSSProperties } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CST, EV_LBL, FEEDS } from '../lib/constants';
import { TH_M, addMonths, dtTh, fmtN, isoTh, pad, ymTh } from '../lib/format';
import type { Cert } from '../lib/types';
import { feedMeta } from '../lib/feeds';
import type { Company, Dicts, FeedKey } from '../lib/types';
import { PageHead, SectionHead, card, tabular } from '../components/ui';

/** A feed row's grey context (lib/feeds.ts words it). */
export const feedLine = (D: Dicts, k: FeedKey, c: Company) => feedMeta(D, k, c);

const AMB = 'var(--bar-warn)', NORM = 'var(--bar)';
const panel: CSSProperties = { ...card, padding: 22, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 };
const panelT: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 500 };
const pairGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,400px),1fr))', gap: 16, alignItems: 'stretch' };

export function Track() {
  const { engine: e, ui, set, setF, go, open } = useApp();
  const v = useEngineVersion();
  const { oInd, oProv, oExpM, oFy, oSt } = ui;
  const CD = e.B.CD, D = e.B.D, W = e.W;

  const ob = useMemo(() => {
    const certs = e.B.certs;
    const m = (ct: Cert, skip?: string) =>
      (skip === 'ind' || oInd === '' || String(ct.ind) === oInd) &&
      (skip === 'prov' || !oProv || ct.provName === oProv) &&
      (skip === 'expM' || !oExpM || ct.exM === oExpM) &&
      (skip === 'fy' || !oFy || ct.yr === oFy) &&
      (skip === 'st' || !oSt || ct.st === oSt);
    // each chart ignores its own filter so the other options stay visible (dimmed)
    const fx = (skip?: string) => certs.filter((ct) => m(ct, skip));
    const f = fx();
    const group = (get: (ct: Cert) => string, key: 'ind' | 'prov', sel: string) => {
      const mm: Record<string, { t: number; a: number }> = {};
      fx(key).forEach((ct) => {
        const k = get(ct);
        if (k == null || k === '') return;
        const g = mm[k] || (mm[k] = { t: 0, a: 0 });
        g.t++;
        if (ct.st === 'active' || ct.st === 'soon') g.a++;
      });
      const arr = Object.entries(mm).map(([i, g]) => ({ i, total: g.t, active: g.a })).sort((a, b) => b.total - a.total).slice(0, 12);
      if (sel && !arr.some((a) => a.i === sel) && mm[sel]) arr.push({ i: sel, total: mm[sel].t, active: mm[sel].a });
      const mx = Math.max(1, ...arr.map((a) => a.total));
      return arr.map((a) => {
        const on = sel === a.i, dim = !!sel && !on;
        return { key: a.i, label: key === 'ind' ? CD.ind[+a.i] || '(ไม่ระบุ)' : a.i, total: a.total, active: a.active, w: (a.total / mx) * 100, wa: (a.active / mx) * 100, ca: dim ? '#B9C8F5' : 'var(--bar)', ct: dim ? 'var(--bar-track)' : '#C9D7F6', fw: on ? 500 : 400, on };
      });
    };
    const indBars = group((ct) => String(ct.ind), 'ind', oInd);
    const provBars = group((ct) => ct.provName, 'prov', oProv);
    const fyM: Record<string, number> = {};
    fx('fy').forEach((ct) => {
      if (/^\d{4}$/.test(ct.yr) && +ct.yr >= 2555 && +ct.yr <= 2575) fyM[ct.yr] = (fyM[ct.yr] || 0) + 1;
    });
    const fyA = Object.entries(fyM).sort((a, b) => a[0].localeCompare(b[0]));
    const fmx = Math.max(1, ...fyA.map((x) => x[1]));
    const fyCols = fyA.map(([l, c]) => ({ label: l, count: c, h: (c / fmx) * 84, color: oFy && oFy !== l ? '#C9D7F6' : 'var(--bar)' }));

    const [ry, rm] = e.ref.split('-').map(Number);
    const endISO = addMonths(e.ref, 12);
    const endT = Date.parse(endISO);
    const months: { y: number; m: number; count: number; soon: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(ry, rm - 1 + i, 1));
      months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth(), count: 0, soon: 0 });
    }
    let expTotal = 0, expSoon = 0;
    fx('expM').forEach((ct) => {
      if (ct.days == null || ct.days < 0 || Date.parse(ct.ex) >= endT) return;
      const [y, mo] = ct.ex.split('-').map(Number);
      const x = months.find((z) => z.y === y && z.m === mo - 1);
      if (x) {
        x.count++;
        expTotal++;
        if (ct.st === 'soon') {
          x.soon++;
          expSoon++;
        }
      }
    });
    const mmx = Math.max(1, ...months.map((x) => x.count));
    const expMonths = months.map((x) => {
      const key = `${x.y}-${pad(x.m + 1)}`;
      return { key, label: `${TH_M[x.m]} ${String((x.y + 543) % 100).padStart(2, '0')}`, count: x.count, h: (x.count / mmx) * 80, color: x.soon ? AMB : NORM, op: oExpM && oExpM !== key ? 0.35 : 1, ol: oExpM === key ? '2px solid var(--ink)' : 'none' };
    });

    const sc = f.filter((ct) => ct.hasScope);
    const avg = (k: 's1' | 's2' | 's3') => (sc.length ? (sc.reduce((a, ct) => a + (ct[k] || 0), 0) / sc.length) * 100 : 0);
    const a1 = avg('s1'), a2 = avg('s2'), a3 = avg('s3'), t = a1 + a2 + a3 || 1;
    const pct = (x: number) => (sc.length ? x.toFixed(1) + '%' : '—');
    const fs = fx('st');
    const tt = fs.length || 1;
    const statusMix = ([['อยู่ในอายุ', 'active', 'var(--bar)'], ['ใกล้หมดอายุ', 'soon', AMB], ['หมดอายุ', 'expired', '#A9B4CC'], ['ไม่ระบุ', 'unknown', '#DDE2EC']] as const)
      .map(([label, k, color]) => ({ label, k, color, n: fs.filter((ct) => ct.st === k).length }))
      .filter((x) => x.n)
      .map((x) => ({ ...x, w: (x.n / tt) * 100, on: oSt === x.k }));
    const from = e.T - 30 * 864e5;
    const rec = f.filter((ct) => ct.apT <= e.T && ct.apT > from).sort((a, b) => b.apT - a.apT);
    const soonL = f.filter((ct) => ct.st === 'soon').sort((a, b) => a.days! - b.days!);
    const last = f.filter((ct) => ct.apT && ct.apT <= e.T).sort((a, b) => b.apT - a.apT)[0];
    const lastApText = last ? `อนุมัติล่าสุด ${isoTh(last.ap)} (${fmtN(f.filter((ct) => ct.ap === last.ap).length)} ใบ)` : '';
    return { count: f.length, indBars, provBars, fyCols, expMonths, expTotal, expSoon, endISO, scope: { n: sc.length, w1: (a1 / t) * 100, w2: (a2 / t) * 100, w3: (a3 / t) * 100, t1: pct(a1), t2: pct(a2), t3: pct(a3) }, statusMix, nextUp: soonL.slice(0, 7), soonN: soonL.length, recent: rec.slice(0, 6), recentN: rec.length, lastApText };
  }, [e, v, oInd, oProv, oExpM, oFy, oSt, CD]);

  const chips: { label: string; p: Partial<typeof ui> }[] = [];
  if (oExpM) {
    const [y, mo] = oExpM.split('-').map(Number);
    chips.push({ label: `หมดอายุ ${TH_M[mo - 1]} ${y + 543}`, p: { oExpM: '' } });
  }
  if (oSt) chips.push({ label: 'สถานะ: ' + CST[oSt as keyof typeof CST][0], p: { oSt: '' } });
  if (oInd !== '') chips.push({ label: CD.ind[+oInd] || '(ไม่ระบุ)', p: { oInd: '' } });
  if (oProv) chips.push({ label: oProv, p: { oProv: '' } });
  if (oFy) chips.push({ label: 'ปีที่ยื่น ' + oFy, p: { oFy: '' } });

  const goTable = () => setF({ view: 'cert', tgt: '', cfo: oSt, expM: oExpM, cInd: oInd, cFy: oFy, cProv: oProv, sort: oExpM || oSt === 'soon' ? 'exp' : 'ap' });
  const goSoon = () => setF({ view: 'cert', tgt: '', cfo: 'soon', expM: '', cInd: oInd, cFy: oFy, cProv: oProv, sort: 'exp' });

  // ---- company-level feeds
  const feeds = useMemo(
    () => FEEDS.map(([k, label, , desc]) => ({ k, label, desc, all: e.feedItems(k) })),
    [e, v],
  );
  const mon = e.monCfg();

  return (
    <>
      <PageHead title="ใบรับรอง CFO ที่ต้องติดตาม" sub={`${fmtN(ob.count)} ใบรับรอง · สถานะ ณ ${isoTh(e.ref)}`} />
      <div className="tr-bar">
        {chips.map((c) => (
          <button key={c.label} onClick={() => set(c.p)} className="ftag">{c.label} ×</button>
        ))}
        {!chips.length && <span className="t-meta" style={{ fontSize: 13 }}>คลิกแท่งกราฟ สถานะ หรือเดือน เพื่อกรองทั้งหน้า</span>}
        {chips.length > 0 && <button onClick={() => set({ oInd: '', oProv: '', oExpM: '', oFy: '', oSt: '' })} className="quiet">ล้างทั้งหมด</button>}
        <span style={{ flex: 1 }} />
        <button onClick={goTable} className="btn sm">ดูรายชื่อ {fmtN(ob.count)} รายการในตาราง</button>
      </div>

      <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>หมดอายุใน 12 เดือนข้างหน้า</h2>
            <span className="t-meta" style={{ fontSize: 13 }} title="คลิกที่เดือนเพื่อกรองทั้งหน้า">{`${isoTh(e.ref)} ถึง ${isoTh(ob.endISO)} · สีเหลือง = ภายใน ${W} วัน`}</span>
          </div>
          <div style={{ display: 'flex', gap: 28 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              <span className="t-sec">รวม 12 เดือน</span>
              <span style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.2, ...tabular }}>{fmtN(ob.expTotal)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              <span className="t-sec">ภายใน {W} วัน</span>
              <span style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.2, color: 'var(--warn)', ...tabular }}>{fmtN(ob.expSoon)}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,minmax(0,1fr))', gap: 8, alignItems: 'end', height: 200 }}>
          {ob.expMonths.map((m) => (
            <button key={m.key} onClick={() => set({ oExpM: oExpM === m.key ? '' : m.key })} aria-label={`${m.label}: ${m.count}`} aria-pressed={oExpM === m.key} className="hv" style={{ cursor: 'pointer', border: 0, borderRadius: 10, padding: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 6, height: '100%' }}>
              <span style={{ fontSize: 13, color: 'var(--ink)', visibility: m.count ? undefined : 'hidden', ...tabular }}>{m.count}</span>
              <span style={{ width: '100%', height: `${m.h}%`, minHeight: m.count ? 3 : 0, background: m.color, opacity: m.op, outline: m.ol, outlineOffset: 2, borderRadius: '8px 8px 3px 3px' }} />
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,minmax(0,1fr))', gap: 8, marginTop: -8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          {ob.expMonths.map((m) => <span key={m.key} style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.25 }}>{m.label}</span>)}
        </div>
      </div>

      <section style={pairGrid}>
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={panelT}>ใกล้หมดอายุที่สุด</h3>
            {ob.soonN > 0 && <button onClick={goSoon} className="lnk" style={{ whiteSpace: 'nowrap' }}>ดูทั้งหมด {fmtN(ob.soonN)} รายการ</button>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {ob.nextUp.map((ct) => (
              <CertRow key={ct.cid} ct={ct} onOpen={() => open(ct.gid)} badge={<span style={{ color: 'var(--warn)', fontSize: 14, ...tabular }}>{ct.days} วัน</span>} sub={`${ct.cert || '—'} · ${ct.provName}`} right={isoTh(ct.ex)} />
            ))}
            {!ob.soonN && <span className="empty" style={{ padding: '6px 0' }}>ไม่มีรายการที่จะหมดอายุภายใน {W} วัน</span>}
          </div>
        </div>
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={panelT}>อนุมัติใหม่ใน 30 วันล่าสุด</h3>
            <span className="t-sec">{fmtN(ob.recentN)} รายการ</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {ob.recent.map((ct) => (
              <CertRow key={ct.cid} ct={ct} onOpen={() => open(ct.gid)} badge={<span className="t-ok" style={{ fontSize: 13 }}>ใหม่</span>} sub={`${ct.cert || '—'} · ${ct.indName}`} right={isoTh(ct.ap)} />
            ))}
            {!ob.recentN && <span className="empty" style={{ padding: '6px 0' }}>ไม่มีใบที่อนุมัติใน 30 วันล่าสุด{ob.lastApText ? ` · ${ob.lastApText}` : ''}</span>}
          </div>
        </div>
      </section>

      <section style={pairGrid}>
        <div style={{ ...panel, gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={panelT}>สัดส่วนคาร์บอนฟุตพริ้นท์เฉลี่ย</h3>
            <span className="t-meta" style={{ fontSize: 13 }} title="ค่าเฉลี่ยร้อยละ จากรายการที่มีข้อมูลสัดส่วน (เว็บไม่แสดงปริมาณ tCO2e)">{`ร้อยละเฉลี่ย จาก ${fmtN(ob.scope.n)} รายการ`}</span>
          </div>
          <div style={{ display: 'flex', height: 28, borderRadius: 10, overflow: 'hidden', gap: 2 }}>
            <span style={{ width: `${ob.scope.w1}%`, background: 'var(--brand-deep)' }} />
            <span style={{ width: `${ob.scope.w2}%`, background: '#5F86E0' }} />
            <span style={{ width: `${ob.scope.w3}%`, background: '#B9C8F5' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {([['ประเภทที่ 1', 'var(--brand-deep)', ob.scope.t1], ['ประเภทที่ 2', '#5F86E0', ob.scope.t2], ['ประเภทที่ 3', '#B9C8F5', ob.scope.t3]] as const).map(([l, c, t]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, color: 'var(--ink-2)', display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}</span>
                <span style={{ fontSize: 18, fontWeight: 500, ...tabular }}>{t}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 14, borderTop: '1px solid var(--divider)' }}>
            <span className="t-sec">สถานะ ณ {isoTh(e.ref)}</span>
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
              {ob.statusMix.map((x) => <span key={x.k} style={{ width: `${x.w}%`, background: x.color, opacity: oSt && !x.on ? 0.35 : 1 }} />)}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ob.statusMix.map((x) => (
                <button key={x.k} onClick={() => set({ oSt: x.on ? '' : x.k })} aria-pressed={x.on} className="hv" style={{ cursor: 'pointer', fontSize: 13, color: 'var(--ink-2)', display: 'flex', gap: 6, alignItems: 'center', height: 30, padding: '0 10px', borderRadius: 999, border: `1px solid ${x.on ? 'var(--brand)' : 'transparent'}`, ...(x.on ? { '--bg': 'var(--tint)', '--hv': 'var(--tint-2)' } : {}) }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: x.color }} />
                  {x.label} {fmtN(x.n)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={panel}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={panelT}>องค์กรที่ยื่นขอการรับรองในแต่ละปี</h3>
            <span className="t-meta" style={{ fontSize: 13 }} title="ปี พ.ศ. ที่ยื่นขอการรับรอง (ปีงบประมาณ อบก.) จากเลขที่ใบรับรอง หรือจากวันที่อนุมัติเมื่อไม่มีเลข FY">ปีงบประมาณ อบก. ที่ยื่น</span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 220, flex: 1 }}>
            {ob.fyCols.map((c) => (
              <button key={c.label} onClick={() => set({ oFy: oFy === c.label ? '' : c.label })} aria-pressed={oFy === c.label} className="hv" style={{ cursor: 'pointer', border: 0, borderRadius: 8, padding: 0, flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, height: '100%' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'nowrap', ...tabular }}>{fmtN(c.count)}</span>
                <span style={{ width: '100%', height: `${c.h}%`, minHeight: 3, background: c.color, borderRadius: '6px 6px 2px 2px' }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={pairGrid}>
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={panelT}>จำนวนตามอุตสาหกรรม</h3>
            <span style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)' }}>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--bar)' }} />อยู่ในอายุ</span>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: '#C9D7F6' }} />ทั้งหมด</span>
            </span>
          </div>
          <Bars bars={ob.indBars} labelW={170} ellipsis onPick={(k, on) => set({ oInd: on ? '' : k })} />
        </div>
        <div style={panel}>
          <h3 style={panelT}>จังหวัดที่มีรายการมากที่สุด</h3>
          <Bars bars={ob.provBars} labelW={130} onPick={(k, on) => set({ oProv: on ? '' : k })} />
        </div>
      </section>

      <div style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        <SectionHead title="รายการติดตามระดับบริษัท" sub={`ใกล้หมดอายุ = ${W} วัน · นับหลังตัดข้อมูลซ้ำ`} />
      </div>
      <section style={pairGrid}>
        {feeds.map(({ k, label, desc, all }) => {
          const months = k === 'newFac' ? Object.entries(all.reduce<Record<string, number>>((m, c) => ((m[c.newYm] = (m[c.newYm] || 0) + 1), m), {})).sort((a, b) => b[0].localeCompare(a[0])) : [];
          return (
            <div key={k} style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <h3 style={panelT}>{label}</h3>
                  <span className="t-meta" style={{ fontSize: 13, textWrap: 'pretty' }}>{k === 'cfoSoon' ? `ใบล่าสุดจะหมดอายุภายใน ${W} วัน` : desc}</span>
                </div>
                <span style={{ fontSize: 18, fontWeight: all.length ? 500 : 400, color: all.length ? 'var(--ink)' : 'var(--muted)', ...tabular }}>{fmtN(all.length)}</span>
              </div>
              {months.length > 0 && (
                <div className="no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                  {months.map(([ym, n]) => (
                    <button key={ym} onClick={() => setF({ ym, feed: '', tgt: '', view: 'co', sort: 'invest' })} className="btn xs" style={{ flex: 'none' }}>{ymTh(ym)} · {fmtN(n)}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {all.slice(0, 5).map((c) => (
                  <button key={c.id} className="hv" onClick={() => open(c.id)} style={{ cursor: 'pointer', border: 0, borderTop: '1px solid var(--divider)', textAlign: 'left', padding: '9px 8px', margin: '0 -8px', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', color: 'var(--ink)' }}>
                    <span style={{ fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{feedLine(D, k, c)}</span>
                  </button>
                ))}
                {!all.length && <span className="empty" style={{ borderTop: '1px solid var(--divider)', paddingTop: 9 }}>{k === 'watch' ? 'กด ติดตาม ในหน้าบริษัทเพื่อเพิ่ม' : k === 'setNew' ? 'จะเริ่มนับเมื่ออัปโหลดข้อมูลชุดถัดไป' : 'ไม่มีรายการ'}</span>}
              </div>
              {all.length > 0 && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4 }}>
                  <button onClick={() => setF({ feed: k, tgt: '', view: 'co', sort: k === 'cfoSoon' || k === 'cfoExp' ? 'exp' : k === 'newFac' ? 'invest' : 'default' })} className="lnk">ดูทั้งหมด {fmtN(all.length)}</button>
                  <button onClick={() => go('plan', { plFeed: k, picked: {}, plLim: 60 })} className="lnk">วางแผนติดต่อ</button>
                  {k === 'watch' && e.can('edit') && <button onClick={() => set({ sendIds: all.map((c) => c.id) })} className="lnk">ส่งเข้า Sales Tracker</button>}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* the automatic status check: folded (its settings are on อัปเดตข้อมูล) */}
      <details className="card tr-mon">
        <summary className="hv">
          <span className="card-t">เหตุการณ์จากการตรวจสถานะอัตโนมัติ</span>
          <span className="t-meta" style={{ fontSize: 13 }}>{mon.last ? `${fmtN((mon.events || []).length)} รายการ · ตรวจล่าสุด ${dtTh(mon.last)}` : 'ยังไม่เคยตรวจ'}</span>
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 22px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="t-sec">{e.monMsg || 'ตรวจเองทุก 10 นาทีที่เปิดเว็บค้างไว้ และเมื่อขึ้นวันใหม่'}</span>
            <button onClick={() => e.checkMonitor(true)} className="btn sm">ตรวจเดี๋ยวนี้</button>
          </div>
          {!(mon.events || []).length && <span className="empty">ยังไม่มีเหตุการณ์ · จะบันทึกเมื่อสถานะบริษัทเปลี่ยน</span>}
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 360, overflow: 'auto' }}>
            {(mon.events || []).slice(0, 60).map((x, i) => {
              const c = e.company(x.id);
              const [tag] = EV_LBL[x.t] || ['เหตุการณ์'];
              return (
                <button key={i} onClick={() => c && open(c.id)} className="hv" style={{ cursor: 'pointer', textAlign: 'left', border: 0, borderTop: '1px solid var(--divider)', padding: '9px 8px', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, color: 'var(--ink)' }}>{c ? c.name : String(x.id)}</span>
                  <span className="t-meta">{`${tag} · ${c && c.cfoEx ? 'CFO หมดอายุ ' + isoTh(c.cfoEx) + ' · ' : ''}บันทึก ${dtTh(x.at)}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      </details>
    </>
  );
}

function CertRow({ ct, onOpen, badge, sub, right }: { ct: Cert; onOpen: () => void; badge: React.ReactNode; sub: string; right: string }) {
  return (
    <button onClick={onOpen} className="hv" style={{ cursor: 'pointer', border: 0, borderBottom: '1px solid var(--divider)', padding: '11px 8px', margin: '0 -8px', display: 'grid', gridTemplateColumns: '56px minmax(0,1fr) auto', gap: 12, alignItems: 'center', textAlign: 'left', color: 'var(--ink)' }}>
      {badge}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ct.org}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{sub}</span>
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{right}</span>
    </button>
  );
}

interface BarItem { key: string; label: string; total: number; active: number; w: number; wa: number; ca: string; ct: string; fw: number; on: boolean }
function Bars({ bars, labelW, ellipsis, onPick }: { bars: BarItem[]; labelW: number; ellipsis?: boolean; onPick: (k: string, on: boolean) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {bars.map((b) => (
        <button key={b.key} onClick={() => onPick(b.key, b.on)} aria-pressed={b.on} className="hv-tx" style={{ cursor: 'pointer', border: 0, borderRadius: 8, padding: 0, display: 'grid', gridTemplateColumns: `${labelW}px minmax(0,1fr) 76px`, gap: 10, alignItems: 'center', fontSize: 13, textAlign: 'left', color: 'var(--ink)' }}>
          <span style={{ fontWeight: b.fw, ...(ellipsis ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>{b.label}</span>
          <span style={{ position: 'relative', height: 12, background: 'var(--bar-track)', borderRadius: 6 }}>
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b.w}%`, background: b.ct, borderRadius: 6 }} />
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b.wa}%`, background: b.ca, borderRadius: 6 }} />
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-2)', textAlign: 'right', ...tabular }}>{fmtN(b.active)}/{fmtN(b.total)}</span>
        </button>
      ))}
    </div>
  );
}
