import { useMemo } from 'react';
import { useApp, useEngineVersion } from '../state';
import { FEEDS, GCOL, GDESC, SRCC, SRC_SUB, tgtName } from '../lib/constants';
import { fmtN, isoTh } from '../lib/format';
import { PageHead, card, heroGrad, tabular } from '../components/ui';

export function Overview() {
  const { engine: e, setF, go } = useApp();
  const v = useEngineVersion();
  const W = e.W;

  const ov = useMemo(() => {
    const cos = e.B.companies;
    const src = [0, 0, 0, 0];
    const g = Array.from({ length: 9 }, () => [0, 0]);
    const ind: Record<number, { n: number; act: number; none: number; gi: number }> = {};
    const prov: Record<number, { n: number; act: number; none: number; gi: number }> = {};
    let act = 0, ph = 0;
    const add = (m: typeof ind, k: number, a: boolean, none: boolean, gi: boolean) => {
      const x = m[k] || (m[k] = { n: 0, act: 0, none: 0, gi: 0 });
      x.n++;
      if (a) x.act++;
      if (none) x.none++;
      if (gi) x.gi++;
    };
    cos.forEach((c) => {
      for (let i = 0; i < 4; i++) if (c.src & (1 << i)) src[i]++;
      g[c.tgt][0]++;
      if (c.hasPh) {
        g[c.tgt][1]++;
        ph++;
      }
      const a = c.cfoSt === 'active' || c.cfoSt === 'soon';
      if (a) act++;
      add(ind, c.ind, a, c.cfoSt === 'none', (c.giLive || 0) >= 3);
      if (e.B.D.prov[c.prov]) add(prov, c.prov, a, c.cfoSt === 'none', (c.giLive || 0) >= 3);
    });
    const feeds = Object.fromEntries(FEEDS.map(([k]) => [k, cos.reduce((n, c) => n + (c.fl[k] ? 1 : 0), 0)]));
    const merged = cos.filter((c) => c.ids.length > 1).length;
    const pending = e.B.groups.filter((x) => x.state === 'pending').length;
    return { src, g, ind, prov, act, ph, feeds, merged, pending };
  }, [e, v]);

  const D = e.B.D;
  const gmax = Math.max(...ov.g.slice(0, 8).map((x) => x[0]));
  const inds = Object.entries(ov.ind).sort((a, b) => b[1].n - a[1].n);
  const im = inds[0] ? inds[0][1].n : 1;
  const provs = Object.entries(ov.prov).sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  const pm = provs[0] ? provs[0][1].n : 1;
  const indCols = 'minmax(0,1.6fr) minmax(0,1.2fr) 80px 80px 70px';

  return (
    <>
      <PageHead gap={12} title="ภาพรวมลูกค้าทั้งหมด (GCC)" sub={`นับระดับบริษัท รวมทุกแหล่ง · สถานะ ณ ${isoTh(e.ref)}`} />
      <section className="hero" style={{ background: heroGrad, color: '#fff', borderRadius: 32, padding: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 28, alignItems: 'end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 14, color: '#fff' }}>บริษัท/ผู้ประกอบการ หลังตัดข้อมูลซ้ำ</span>
          <span style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.15 }}>{fmtN(e.B.companies.length)}</span>
          <span style={{ fontSize: 15, color: '#fff', fontWeight: 300, textWrap: 'pretty', maxWidth: 540 }}>
            {`รวม TGO · GI · กรอ. · SET เข้าเป็นบริษัทเดียว ${fmtN(ov.merged)} รายรวมจากหลายแถว · CFO อยู่ในอายุ ${fmtN(ov.act)} ราย · มีเบอร์โทร ${fmtN(ov.ph)} ราย · รอตรวจข้อมูลซ้ำ ${fmtN(ov.pending)} กลุ่ม`}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          {ov.src.map((n, i) => (
            <button key={i} onClick={() => setF({ src: String(i), tgt: '', view: 'co' })} className="hv-w" style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid rgba(255,255,255,.22)', '--bg': 'rgba(6,22,90,.2)', color: '#fff', borderRadius: 20, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, color: '#fff' }}>{SRCC[i][0]}</span>
              <span style={{ fontSize: 28, fontWeight: 500 }}>{fmtN(n)}</span>
              <span style={{ fontSize: 12, color: '#fff', fontWeight: 300 }}>{SRC_SUB[i]}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHead no="01" title="สิ่งที่ต้องติดตาม" sub="กดตัวเลขเพื่อดูรายชื่อในแท็บค้นหา" />
        <div style={{ ...card, padding: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 2 }}>
          {FEEDS.map(([k, label, dot]) => (
            <button key={k} className="h-bg" onClick={() => setF({ feed: k, tgt: '', view: 'co', sort: k === 'cfoSoon' || k === 'cfoExp' ? 'exp' : 'default' })} style={{ cursor: 'pointer', textAlign: 'left', border: 0, background: 'transparent', borderRadius: 14, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, color: '#0E1430' }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: '#384155', minWidth: 0 }}>
                <span style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', background: dot }} />
                {label}
              </span>
              <span style={{ fontSize: 20, fontWeight: 500, ...tabular }}>{fmtN(ov.feeds[k])}</span>
            </button>
          ))}
        </div>
        <button onClick={() => go('track')} className="hv-tx" style={{ cursor: 'pointer', alignSelf: 'flex-start', border: 0, color: '#1F5BD8', fontSize: 14, textDecoration: 'underline', padding: 0 }}>
          เปิดแท็บติดตาม: กราฟใบรับรองหมดอายุ 12 เดือน และรายชื่อแต่ละรายการ →
        </button>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHead no="02" title="กลุ่มเป้าหมายสำหรับทีมขาย" sub="จัดลำดับตามข้อแรกที่เข้าเงื่อนไข" />
        <div style={{ ...card, overflow: 'hidden' }}>
          {ov.g.map(([n, ph], i) => (
            <button key={i} className="h-bg" onClick={() => setF({ tgt: String(i), view: 'co' })} style={{ cursor: 'pointer', width: '100%', border: 0, borderBottom: '1px solid #EEF1F8', background: '#fff', textAlign: 'left', padding: '15px 22px', display: 'grid', gridTemplateColumns: '44px minmax(0,1.3fr) minmax(0,1fr) 110px 110px 24px', gap: 16, alignItems: 'center' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: GCOL[i][0], color: GCOL[i][1], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 15 }}>{i + 1}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 500 }}>{tgtName(i, W)}</span>
                <span style={{ fontSize: 13, color: '#475069', fontWeight: 300, textWrap: 'pretty' }}>{GDESC[i]}</span>
              </span>
              <span style={{ height: 10, background: '#EEF1F8', borderRadius: 999, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: Math.min(100, (n / gmax) * 100).toFixed(1) + '%', background: GCOL[i][2], borderRadius: 999 }} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 22, fontWeight: 500, ...tabular }}>{fmtN(n)}</span>
                <span style={{ fontSize: 12, color: '#475069' }}>บริษัท</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 18, fontWeight: 500, color: '#1F5BD8', ...tabular }}>{fmtN(ph)}</span>
                <span style={{ fontSize: 12, color: '#475069' }}>มีเบอร์โทร</span>
              </span>
              <span style={{ color: '#6B7390', fontSize: 18 }}>›</span>
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,560px),1fr))', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PageHead no="03" title="กลุ่มอุตสาหกรรม" nowrap />
          <div style={{ ...card, overflowX: 'auto' }}>
            <div style={{ minWidth: 560 }}>
              <div style={{ display: 'grid', gridTemplateColumns: indCols, gap: 12, padding: '12px 20px', fontSize: 12, color: '#475069', background: '#F7F8FC', borderBottom: '1px solid #E3E7F1' }}>
                <span>อุตสาหกรรม</span><span>ทั้งหมด</span><span style={{ textAlign: 'right' }}>CFO ในอายุ</span><span style={{ textAlign: 'right' }}>ยังไม่มี CFO</span><span style={{ textAlign: 'right' }}>GI 3–5</span>
              </div>
              {inds.map(([k, x]) => (
                <button key={k} className="h-bg" onClick={() => setF({ ind: k, tgt: '', view: 'co' })} style={{ cursor: 'pointer', width: '100%', border: 0, borderBottom: '1px solid #EEF1F8', background: '#fff', textAlign: 'left', display: 'grid', gridTemplateColumns: indCols, gap: 12, padding: '9px 20px', alignItems: 'center', fontSize: 13.5, ...tabular }}>
                  <span>{D.ind[+k]}</span>
                  <Bar w={(x.n / im) * 100} color="#4D72FF" n={x.n} />
                  <span style={{ textAlign: 'right', color: '#0E8A9A', fontWeight: 500 }}>{fmtN(x.act)}</span>
                  <span style={{ textAlign: 'right', color: '#475069' }}>{fmtN(x.none)}</span>
                  <span style={{ textAlign: 'right', color: '#1F5BD8' }}>{fmtN(x.gi)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PageHead no="04" title="จังหวัด" nowrap right={<button onClick={() => go('map')} className="hv-tx" style={{ cursor: 'pointer', border: 0, color: '#1F5BD8', fontSize: 14, textDecoration: 'underline' }}>เปิดแผนที่</button>} />
          <div style={{ ...card, padding: '6px 0' }}>
            {provs.map(([k, x]) => (
              <button key={k} className="h-bg" onClick={() => setF({ prov: k, tgt: '', view: 'co' })} style={{ cursor: 'pointer', width: '100%', border: 0, background: 'transparent', textAlign: 'left', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr) 80px', gap: 12, padding: '8px 20px', alignItems: 'center', fontSize: 13.5, ...tabular }}>
                <span>{D.prov[+k]}</span>
                <Bar w={(x.n / pm) * 100} color="#1F5BD8" n={x.n} />
                <span style={{ textAlign: 'right', color: '#0E8A9A', fontWeight: 500 }}>{fmtN(x.act)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Bar({ w, color, n }: { w: number; color: string; n: number }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, height: 8, background: '#EEF1F8', borderRadius: 999, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: w.toFixed(1) + '%', background: color, borderRadius: 999 }} />
      </span>
      <span style={{ width: 48, textAlign: 'right' }}>{fmtN(n)}</span>
    </span>
  );
}
