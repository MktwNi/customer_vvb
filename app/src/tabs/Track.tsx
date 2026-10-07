import { useMemo, type CSSProperties } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CST, EV_LBL, FEEDS } from '../lib/constants';
import { TH_M, addMonths, dtTh, fmtN, isoTh, pad, ymTh } from '../lib/format';
import type { Cert } from '../lib/types';
import { feedMeta } from '../lib/feeds';
import { PageHead, card, tabular } from '../components/ui';

const AMB = '#F2B84B', NORM = '#B9C8FF';
const panel: CSSProperties = { ...card, padding: 22, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 };
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
        return { key: a.i, label: key === 'ind' ? CD.ind[+a.i] || '(ไม่ระบุ)' : a.i, total: a.total, active: a.active, w: (a.total / mx) * 100, wa: (a.active / mx) * 100, ca: dim ? '#B9C8FF' : '#1A3FE0', ct: dim ? '#EEF1F8' : on ? '#7C93FF' : '#DCE6FF', fw: on ? 600 : 400, on };
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
    const fyCols = fyA.map(([l, c]) => ({ label: l, count: c, h: (c / fmx) * 84, color: oFy && oFy !== l ? '#C9D1E6' : oFy ? '#0A1A86' : '#1A3FE0' }));

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
      return { key, label: `${TH_M[x.m]} ${String((x.y + 543) % 100).padStart(2, '0')}`, count: x.count, h: (x.count / mmx) * 80, color: x.soon ? AMB : NORM, op: oExpM && oExpM !== key ? 0.35 : 1, ol: oExpM === key ? '2px solid #fff' : 'none' };
    });

    const sc = f.filter((ct) => ct.hasScope);
    const avg = (k: 's1' | 's2' | 's3') => (sc.length ? (sc.reduce((a, ct) => a + (ct[k] || 0), 0) / sc.length) * 100 : 0);
    const a1 = avg('s1'), a2 = avg('s2'), a3 = avg('s3'), t = a1 + a2 + a3 || 1;
    const pct = (x: number) => (sc.length ? x.toFixed(1) + '%' : '—');
    const fs = fx('st');
    const tt = fs.length || 1;
    const statusMix = ([['อยู่ในอายุ', 'active', '#1A3FE0'], ['ใกล้หมดอายุ', 'soon', AMB], ['หมดอายุ', 'expired', '#C9D1E6'], ['ไม่ระบุ', 'unknown', '#E3E7F1']] as const)
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
    () => FEEDS.map(([k, label, dot, desc]) => ({ k, label, dot, desc, all: e.feedItems(k) })),
    [e, v],
  );
  const mon = e.monCfg();

  return (
    <>
      <PageHead gap={12} title="ใบรับรอง CFO ที่ต้องติดตาม" sub={`${fmtN(ob.count)} ใบรับรอง · สถานะ ณ ${isoTh(e.ref)}`} />
      <div style={{ position: 'sticky', top: 'var(--topbar-h)', zIndex: 5, background: 'rgba(244,246,252,.92)', backdropFilter: 'blur(8px)', margin: '-8px -8px 0', padding: '10px 8px', borderRadius: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#475069' }}>ตัวกรอง:</span>
        {chips.map((c) => (
          <button key={c.label} onClick={() => set(c.p)} style={{ cursor: 'pointer', height: 32, padding: '0 8px 0 14px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
            {c.label}
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>×</span>
          </button>
        ))}
        {!chips.length && <span style={{ fontSize: 13, color: '#5E6680' }}>ยังไม่ได้เลือก · คลิกแท่งกราฟ สถานะ หรือเดือน เพื่อกรองทั้งแดชบอร์ด (คลิกซ้ำเพื่อยกเลิก)</span>}
        <span style={{ flex: 1 }} />
        {chips.length > 0 && <button onClick={() => set({ oInd: '', oProv: '', oExpM: '', oFy: '', oSt: '' })} style={{ cursor: 'pointer', height: 32, padding: '0 10px', border: 0, background: 'transparent', color: '#1A3FE0', fontSize: 13, textDecoration: 'underline' }}>ล้างทั้งหมด</button>}
        <button onClick={goTable} style={{ cursor: 'pointer', height: 32, padding: '0 16px', borderRadius: 999, border: '1.5px solid #0A1A86', background: '#fff', color: '#0A1A86', fontSize: 13, fontWeight: 500 }}>ดูรายชื่อ {fmtN(ob.count)} รายการในตาราง →</button>
      </div>

      <div style={{ background: 'linear-gradient(135deg,#071060 0%,#0D2390 60%,#1C3FE6 100%)', color: '#fff', borderRadius: 24, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 500 }}>ใบรับรองที่จะหมดอายุใน 12 เดือนข้างหน้า</span>
            <span style={{ fontSize: 13.5, color: '#C9D4FF', fontWeight: 300 }}>นับจาก {isoTh(e.ref)} ถึง {isoTh(ob.endISO)} · คลิกที่เดือนเพื่อกรองทั้งแดชบอร์ด · สีเหลือง = อยู่ในช่วงใกล้หมดอายุ ({W} วัน)</span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              <span style={{ fontSize: 12.5, color: '#B9C8FF' }}>รวม 12 เดือน</span>
              <span style={{ fontSize: 30, fontWeight: 600, lineHeight: 1 }}>{fmtN(ob.expTotal)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              <span style={{ fontSize: 12.5, color: '#B9C8FF' }}>ภายใน {W} วัน</span>
              <span style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, color: '#F2B84B' }}>{fmtN(ob.expSoon)}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,minmax(0,1fr))', gap: 8, alignItems: 'end', height: 200 }}>
          {ob.expMonths.map((m) => (
            <button key={m.key} onClick={() => set({ oExpM: oExpM === m.key ? '' : m.key })} aria-label={`${m.label}: ${m.count}`} style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 6, height: '100%' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>{m.count}</span>
              <span className="h-op" style={{ width: '100%', height: `${m.h}%`, minHeight: 3, background: m.color, opacity: m.op, outline: m.ol, outlineOffset: 2, borderRadius: '8px 8px 3px 3px' }} />
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,minmax(0,1fr))', gap: 8, marginTop: -8, borderTop: '1px solid rgba(185,200,255,.3)', paddingTop: 8 }}>
          {ob.expMonths.map((m) => <span key={m.key} style={{ fontSize: 12, color: '#C9D4FF', textAlign: 'center', lineHeight: 1.25 }}>{m.label}</span>)}
        </div>
      </div>

      <section style={pairGrid}>
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>ใกล้หมดอายุที่สุด</span>
            <button onClick={goSoon} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#1A3FE0', fontSize: 13.5, textDecoration: 'underline', padding: 0, whiteSpace: 'nowrap' }}>ดูทั้งหมด {fmtN(ob.soonN)} รายการ</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {ob.nextUp.map((ct) => (
              <CertRow key={ct.cid} ct={ct} onOpen={() => open(ct.gid)} badge={<span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#FDECC8', color: '#8A5300', borderRadius: 12, padding: '6px 0' }}><span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.1 }}>{ct.days}</span><span style={{ fontSize: 10.5 }}>วัน</span></span>} sub={`${ct.cert || '—'} · ${ct.provName}`} right={isoTh(ct.ex)} />
            ))}
            {!ob.soonN && <span style={{ fontSize: 14, color: '#5E6680', padding: '18px 0' }}>ไม่มีรายการที่จะหมดอายุภายใน {W} วัน</span>}
          </div>
        </div>
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>อนุมัติใหม่ใน 30 วันล่าสุด</span>
            <span style={{ fontSize: 13, color: '#475069' }}>{fmtN(ob.recentN)} รายการ</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {ob.recent.map((ct) => (
              <CertRow key={ct.cid} ct={ct} onOpen={() => open(ct.gid)} badge={<span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#DDF5F1', color: '#0B6E66', borderRadius: 12, padding: '8px 0', fontSize: 12, fontWeight: 600 }}>ใหม่</span>} sub={`${ct.cert || '—'} · ${ct.indName}`} right={isoTh(ct.ap)} />
            ))}
            {!ob.recentN && (
              <div style={{ flex: 1, minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#F7F8FC', borderRadius: 16, textAlign: 'center', padding: 20 }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: '#475069' }}>ไม่มีใบรับรองที่อนุมัติใน 30 วันล่าสุด</span>
                <span style={{ fontSize: 13, color: '#5E6680' }}>{ob.lastApText}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section style={pairGrid}>
        <div style={{ ...panel, gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>สัดส่วนคาร์บอนฟุตพริ้นท์เฉลี่ย</span>
            <span style={{ fontSize: 13, color: '#475069', fontWeight: 300 }}>ค่าเฉลี่ยร้อยละ จาก {fmtN(ob.scope.n)} รายการที่มีข้อมูลสัดส่วน (เว็บไม่แสดงปริมาณ tCO2e)</span>
          </div>
          <div style={{ display: 'flex', height: 38, borderRadius: 12, overflow: 'hidden', gap: 2 }}>
            <span style={{ width: `${ob.scope.w1}%`, background: '#0A1A86' }} />
            <span style={{ width: `${ob.scope.w2}%`, background: '#4D72FF' }} />
            <span style={{ width: `${ob.scope.w3}%`, background: '#34D1C4' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {([['ประเภทที่ 1', '#0A1A86', ob.scope.t1], ['ประเภทที่ 2', '#4D72FF', ob.scope.t2], ['ประเภทที่ 3', '#34D1C4', ob.scope.t3]] as const).map(([l, c, t]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5, color: '#475069', display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}</span>
                <span style={{ fontSize: 24, fontWeight: 500 }}>{t}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 14, borderTop: '1px solid #EEF1F8' }}>
            <span style={{ fontSize: 13, color: '#475069' }}>สถานะ ณ {isoTh(e.ref)}</span>
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
              {ob.statusMix.map((x) => <span key={x.k} style={{ width: `${x.w}%`, background: x.color, opacity: oSt && !x.on ? 0.35 : 1 }} />)}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {ob.statusMix.map((x) => (
                <button key={x.k} onClick={() => set({ oSt: x.on ? '' : x.k })} aria-pressed={x.on} style={{ cursor: 'pointer', fontSize: 12.5, color: '#384155', display: 'flex', gap: 6, alignItems: 'center', height: 28, padding: '0 10px', borderRadius: 999, border: `1.5px solid ${x.on ? '#0A1A86' : 'transparent'}`, background: x.on ? '#EEF2FF' : 'transparent' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: x.color }} />
                  {x.label} {fmtN(x.n)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={panel}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>จำนวนองค์กรที่ยื่นขอการรับรองในแต่ละปี</span>
            <span style={{ fontSize: 13, color: '#475069', fontWeight: 300 }}>ปี พ.ศ. ที่ยื่นขอการรับรอง (ปีงบประมาณ อบก.) จากเลขที่ใบรับรอง หรือจากวันที่อนุมัติเมื่อไม่มีเลข FY</span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 220, flex: 1 }}>
            {ob.fyCols.map((c) => (
              <button key={c.label} onClick={() => set({ oFy: oFy === c.label ? '' : c.label })} style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0, flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, height: '100%' }}>
                <span style={{ fontSize: 10.5, color: '#384155', whiteSpace: 'nowrap' }}>{fmtN(c.count)}</span>
                <span style={{ width: '100%', height: `${c.h}%`, minHeight: 3, background: c.color, borderRadius: '6px 6px 2px 2px' }} />
                <span style={{ fontSize: 10.5, fontWeight: 500, color: '#475069' }}>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={pairGrid}>
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>จำนวนตามอุตสาหกรรม</span>
            <span style={{ display: 'flex', gap: 12, fontSize: 12.5, color: '#475069' }}>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: '#1A3FE0' }} />อยู่ในอายุ</span>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: '#DCE6FF' }} />ทั้งหมด</span>
            </span>
          </div>
          <Bars bars={ob.indBars} labelW={170} ellipsis onPick={(k, on) => set({ oInd: on ? '' : k })} />
        </div>
        <div style={panel}>
          <span style={{ fontSize: 17, fontWeight: 500 }}>จังหวัดที่มีรายการมากที่สุด</span>
          <Bars bars={ob.provBars} labelW={130} onPick={(k, on) => set({ oProv: on ? '' : k })} />
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid #E3E7F1' }}>
        <h2 style={{ margin: '16px 0 0', fontSize: 28, fontWeight: 500 }}>รายการติดตามระดับบริษัท</h2>
        <span style={{ fontSize: 14, color: '#475069', fontWeight: 300 }}>ช่วงใกล้หมดอายุ CFO {W} วัน · นับระดับบริษัทหลังตัดข้อมูลซ้ำ</span>
      </div>
      <section style={pairGrid}>
        {feeds.map(({ k, label, dot, desc, all }) => {
          const months = k === 'newFac' ? Object.entries(all.reduce<Record<string, number>>((m, c) => ((m[c.newYm] = (m[c.newYm] || 0) + 1), m), {})).sort((a, b) => b[0].localeCompare(a[0])) : [];
          return (
            <div key={k} style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', minHeight: 52 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} /><span style={{ fontSize: 16, fontWeight: 500 }}>{label}</span></span>
                  <span style={{ fontSize: 12.5, color: '#475069', fontWeight: 300, textWrap: 'pretty' }}>{k === 'cfoSoon' ? `ใบล่าสุดจะหมดอายุภายใน ${W} วัน` : desc}</span>
                </div>
                <span style={{ fontSize: 28, fontWeight: 500, ...tabular }}>{fmtN(all.length)}</span>
              </div>
              {months.length > 0 && (
                <div className="no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                  {months.map(([ym, n]) => (
                    <button key={ym} onClick={() => setF({ ym, feed: '', tgt: '', view: 'co', sort: 'invest' })} style={{ cursor: 'pointer', height: 30, padding: '0 10px', borderRadius: 999, border: '1.5px solid #D5DBEA', background: '#fff', fontSize: 12.5, color: '#0E1430', whiteSpace: 'nowrap', flex: 'none' }}>{ymTh(ym)} · {fmtN(n)}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 205 }}>
                {all.slice(0, 5).map((c) => (
                  <button key={c.id} className="h-blue" onClick={() => open(c.id)} style={{ cursor: 'pointer', border: 0, borderTop: '1px solid #EEF1F8', background: 'transparent', textAlign: 'left', padding: '9px 0', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', color: '#0E1430' }}>
                    <span style={{ fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: '#475069', whiteSpace: 'nowrap' }}>{feedMeta(D, k, c)}</span>
                  </button>
                ))}
                {!all.length && <span style={{ fontSize: 13, color: '#5E6680', borderTop: '1px solid #EEF1F8', paddingTop: 9 }}>{k === 'watch' ? 'กดดาวที่รายชื่อเพื่อเพิ่ม' : k === 'setNew' ? 'จะเริ่มนับเมื่ออัปโหลดข้อมูลชุดถัดไป' : 'ไม่มีรายการ'}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4, minHeight: 40 }}>
                {all.length > 0 && (
                  <>
                    <button onClick={() => setF({ feed: k, tgt: '', view: 'co', sort: k === 'cfoSoon' || k === 'cfoExp' ? 'exp' : k === 'newFac' ? 'invest' : 'default' })} style={{ cursor: 'pointer', height: 36, padding: '0 14px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13 }}>ดูทั้งหมด</button>
                    <button onClick={() => go('plan', { plFeed: k, picked: {}, plLim: 60 })} style={{ cursor: 'pointer', height: 36, padding: '0 14px', borderRadius: 999, border: '1.5px solid #0A1A86', background: '#fff', color: '#0A1A86', fontSize: 13 }}>วางแผนติดต่อ</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>เหตุการณ์จากการตรวจสถานะอัตโนมัติ</span>
            <span style={{ fontSize: 13, color: '#475069', fontWeight: 300 }}>{mon.last ? `ตรวจล่าสุด ${dtTh(mon.last)} · ${e.monMsg || 'ตรวจเองทุก 10 นาทีที่เปิดเว็บค้างไว้ และเมื่อขึ้นวันใหม่'}` : 'ยังไม่เคยตรวจ'}</span>
          </div>
          <button onClick={() => e.checkMonitor(true)} style={{ cursor: 'pointer', height: 38, padding: '0 16px', borderRadius: 999, border: '1.5px solid #0A1A86', background: '#fff', color: '#0A1A86', fontSize: 13.5 }}>ตรวจเดี๋ยวนี้</button>
        </div>
        {!(mon.events || []).length && <span style={{ fontSize: 13.5, color: '#475069' }}>ระบบบันทึกสถานะตั้งต้นแล้ว จะเริ่มบันทึกเหตุการณ์เมื่อสถานะบริษัทเปลี่ยน</span>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflow: 'auto' }}>
          {(mon.events || []).slice(0, 60).map((x, i) => {
            const c = e.company(x.id);
            const [tag, bg, fg] = EV_LBL[x.t] || ['เหตุการณ์', '#EEF1F8', '#475069'];
            return (
              <button key={i} onClick={() => c && open(c.id)} style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid #EEF1F8', background: '#fff', borderRadius: 12, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, padding: '2px 8px', borderRadius: 999, background: bg, color: fg }}>{tag}</span>
                <span style={{ fontSize: 13.5, color: '#0E1430' }}>{c ? c.name : String(x.id)}</span>
                <span style={{ fontSize: 12.5, color: '#475069' }}>{`${c && c.cfoEx ? 'CFO หมดอายุ ' + isoTh(c.cfoEx) + ' · ' : ''}บันทึก ${dtTh(x.at)}`}</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function CertRow({ ct, onOpen, badge, sub, right }: { ct: Cert; onOpen: () => void; badge: React.ReactNode; sub: string; right: string }) {
  return (
    <button onClick={onOpen} style={{ cursor: 'pointer', border: 0, borderBottom: '1px solid #EEF1F8', background: 'transparent', padding: '11px 0', display: 'grid', gridTemplateColumns: '64px minmax(0,1fr) auto', gap: 12, alignItems: 'center', textAlign: 'left', color: '#0E1430' }}>
      {badge}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ct.org}</span>
        <span style={{ fontSize: 12.5, color: '#5E6680' }}>{sub}</span>
      </span>
      <span style={{ fontSize: 12.5, color: '#384155' }}>{right}</span>
    </button>
  );
}

interface BarItem { key: string; label: string; total: number; active: number; w: number; wa: number; ca: string; ct: string; fw: number; on: boolean }
function Bars({ bars, labelW, ellipsis, onPick }: { bars: BarItem[]; labelW: number; ellipsis?: boolean; onPick: (k: string, on: boolean) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {bars.map((b) => (
        <button key={b.key} onClick={() => onPick(b.key, b.on)} aria-pressed={b.on} style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0, display: 'grid', gridTemplateColumns: `${labelW}px minmax(0,1fr) 76px`, gap: 10, alignItems: 'center', fontSize: 13, textAlign: 'left', color: '#0E1430' }}>
          <span style={{ fontWeight: b.fw, ...(ellipsis ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>{b.label}</span>
          <span style={{ position: 'relative', height: 14, background: '#EEF1F8', borderRadius: 7 }}>
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b.w}%`, background: b.ct, borderRadius: 7 }} />
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b.wa}%`, background: b.ca, borderRadius: 7 }} />
          </span>
          <span style={{ fontSize: 12.5, color: '#384155', textAlign: 'right', ...tabular }}>{fmtN(b.active)}/{fmtN(b.total)}</span>
        </button>
      ))}
    </div>
  );
}
