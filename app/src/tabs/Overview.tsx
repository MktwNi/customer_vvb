import { useMemo, useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { FEEDS, GDESC, SRCC, SRC_SUB, tgtName } from '../lib/constants';
import { fmtN, isoTh } from '../lib/format';
import { Kpi, PageHead, SectionHead } from '../components/ui';

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
  const [allInd, setAllInd] = useState(false);
  const gmax = Math.max(...ov.g.slice(0, 8).map((x) => x[0]));
  const inds = Object.entries(ov.ind).sort((a, b) => b[1].n - a[1].n);
  const im = inds[0] ? inds[0][1].n : 1;
  const provs = Object.entries(ov.prov).sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  const pm = provs[0] ? provs[0][1].n : 1;

  return (
    <>
      <PageHead title="ภาพรวมลูกค้าทั้งหมด (GCC)" sub={`นับระดับบริษัท รวมทุกแหล่ง · สถานะ ณ ${isoTh(e.ref)}`} />
      {/* one KPI row: the whole register (the lead figure), then where it was found */}
      <section className="kpis k5" aria-label="จำนวนบริษัท">
        <Kpi
          hero
          big
          label="บริษัททั้งหมด · ตัดข้อมูลซ้ำแล้ว"
          value={fmtN(e.B.companies.length)}
          foot={<>CFO ในอายุ <b>{fmtN(ov.act)}</b> · มีเบอร์โทร <b>{fmtN(ov.ph)}</b></>}
          title={`รวม TGO · GI · กรอ. · SET เข้าเป็นบริษัทเดียว ${fmtN(ov.merged)} ราย · รอตรวจข้อมูลซ้ำ ${fmtN(ov.pending)} กลุ่ม`}
        />
        {ov.src.map((n, i) => (
          <Kpi key={i} label={SRCC[i][0]} value={fmtN(n)} foot={SRC_SUB[i]} onClick={() => setF({ src: String(i), tgt: '', view: 'co' })} />
        ))}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionHead title="สิ่งที่ต้องติดตาม" sub="กดตัวเลขเพื่อดูรายชื่อในแท็บค้นหา" />
        <div className="card ov-feeds">
          {FEEDS.map(([k, label]) => (
            <button key={k} className="ov-feed hv" onClick={() => setF({ feed: k, tgt: '', view: 'co', sort: k === 'cfoSoon' || k === 'cfoExp' ? 'exp' : 'default' })}>
              <span className="ov-feed-l">{label}</span>
              <span className={'ov-feed-n' + (ov.feeds[k] ? '' : ' zero')}>{fmtN(ov.feeds[k])}</span>
            </button>
          ))}
        </div>
        <button onClick={() => go('track')} className="lnk" style={{ alignSelf: 'flex-start' }}>ดูทั้งหมดในแท็บติดตาม</button>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionHead title="กลุ่มเป้าหมายสำหรับทีมขาย" sub="จัดลำดับตามข้อแรกที่เข้าเงื่อนไข" />
        <div className="card" style={{ overflow: 'hidden' }}>
          {ov.g.map(([n, ph], i) => (
            <button key={i} className="ov-tg hv" onClick={() => setF({ tgt: String(i), view: 'co' })}>
              <span className="ov-rank">{i + 1}.</span>
              <span className="ov-tg-t">
                <b>{tgtName(i, W)}</b>
                <span>{GDESC[i]}</span>
              </span>
              <span className="ov-bar" aria-hidden="true"><i style={{ width: Math.min(100, (n / gmax) * 100).toFixed(1) + '%' }} /></span>
              <span className="ov-num"><b>{fmtN(n)}</b><small>บริษัท</small></span>
              <span className="ov-num ph"><b>{fmtN(ph)}</b><small>มีเบอร์โทร</small></span>
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,560px),1fr))', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <SectionHead title="กลุ่มอุตสาหกรรม" />
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="ov-tbl-h ov-ind thead">
              <span>อุตสาหกรรม</span><span>บริษัท</span><span className="r">CFO ในอายุ</span><span className="r">ยังไม่มี CFO</span><span className="r">GI 3–5</span>
            </div>
            {(allInd ? inds : inds.slice(0, 10)).map(([k, x]) => (
              <button key={k} className="ov-tbl-r ov-ind hv" onClick={() => setF({ ind: k, tgt: '', view: 'co' })}>
                <span>{D.ind[+k]}</span>
                <Bar w={(x.n / im) * 100} n={x.n} />
                <span className="r">{fmtN(x.act)}</span>
                <span className="r">{fmtN(x.none)}</span>
                <span className="r">{fmtN(x.gi)}</span>
              </button>
            ))}
            {inds.length > 10 && (
              <div className="ov-more">
                <button className="lnk" onClick={() => setAllInd(!allInd)} aria-expanded={allInd}>{allInd ? 'แสดง 10 อันดับแรก' : `ดูทั้งหมด ${fmtN(inds.length)} อุตสาหกรรม`}</button>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <SectionHead title="จังหวัด" link={<button onClick={() => go('map')} className="lnk">เปิดแผนที่</button>} />
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="ov-tbl-h ov-prov thead">
              <span>จังหวัด</span><span>บริษัท</span><span className="r">CFO ในอายุ</span>
            </div>
            {provs.map(([k, x]) => (
              <button key={k} className="ov-tbl-r ov-prov hv" onClick={() => setF({ prov: k, tgt: '', view: 'co' })}>
                <span>{D.prov[+k]}</span>
                <Bar w={(x.n / pm) * 100} n={x.n} />
                <span className="r">{fmtN(x.act)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Bar({ w, n }: { w: number; n: number }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="ov-bar" style={{ flex: 1 }} aria-hidden="true"><i style={{ width: w.toFixed(1) + '%' }} /></span>
      <span style={{ width: 52, textAlign: 'right' }}>{fmtN(n)}</span>
    </span>
  );
}
