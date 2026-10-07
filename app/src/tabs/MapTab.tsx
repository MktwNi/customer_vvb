import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { useApp, useEngineVersion } from '../state';
import { TGT } from '../lib/constants';
import { dataUrl } from '../lib/core';
import { fmtN, isoTh } from '../lib/format';
import type { Company } from '../lib/types';
import { PageHead, card, heroGrad, selectStyle } from '../components/ui';

type Geo = FeatureCollection<Geometry, { th: string }>;
type Metric = 'all' | 'act' | 'soon' | 'exp' | 'opp' | 'gi';
interface Agg { n: number; act: number; soon: number; exp: number; opp: number; gi: number; ph: number; tg: number[]; ind: Record<string, number> }

let geoCache: Promise<Geo> | null = null;
const loadGeo = () =>
  geoCache ||
  (geoCache = fetch(dataUrl('th-provinces.json'))
    .then((r) => r.json() as Promise<Geo>)
    .then((geo) => {
      // some rings are wound clockwise in the source file; d3 needs them reversed
      geo.features.forEach((f) => {
        const g = f.geometry as unknown as { coordinates: number[][][][] };
        g.coordinates = g.coordinates.map((poly) => (d3.geoArea({ type: 'Polygon', coordinates: poly } as d3.GeoPermissibleObjects) > 2 * Math.PI ? poly.map((r) => r.slice().reverse()) : poly));
      });
      return geo;
    }));

function agg(list: Company[], D: { ind: string[] }): Agg {
  const a: Agg = { n: list.length, act: 0, soon: 0, exp: 0, opp: 0, gi: 0, ph: 0, tg: Array(9).fill(0), ind: {} };
  list.forEach((r) => {
    if (r.cfoSt === 'active' || r.cfoSt === 'soon') a.act++;
    if (r.cfoSt === 'soon') a.soon++;
    if (r.cfoSt === 'expired') a.exp++;
    if (r.tgt >= 4 && r.tgt <= 7) a.opp++;
    if ((r.giLive || 0) >= 3) a.gi++;
    if (r.hasPh) a.ph++;
    a.tg[r.tgt]++;
    const k = D.ind[r.ind] || '';
    a.ind[k] = (a.ind[k] || 0) + 1;
  });
  return a;
}

export function MapTab() {
  const { engine: e, setF, open } = useApp();
  const v = useEngineVersion();
  const D = e.B.D, W = e.W;
  const METRICS: [Metric, string][] = [['all', 'บริษัททั้งหมด'], ['act', 'CFO อยู่ในอายุ'], ['soon', `CFO ใกล้หมดอายุ ≤ ${W} วัน`], ['exp', 'CFO หมดอายุยังไม่ต่อ'], ['opp', 'ยังไม่มี CFO (กลุ่ม 5–8)'], ['gi', 'GI ระดับ 3–5']];
  const [metric, setMetric] = useState<Metric>('all');
  const [fInd, setFInd] = useState('');
  const [fTgt, setFTgt] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [err, setErr] = useState('');
  const [width, setWidth] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  // Tooltip position/visibility are written straight to the DOM (like the prototype) so moving the
  // mouse doesn't re-render the map; only hovering a different province updates its text.
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipName, setTipName] = useState<string | null>(null);

  useEffect(() => {
    loadGeo().then(setGeo, () => setErr('โหลดขอบเขตจังหวัดไม่สำเร็จ'));
  }, []);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const indCounts = useMemo(() => {
    const ic: Record<string, number> = {};
    e.B.companies.forEach((c) => {
      const k = D.ind[c.ind] || '';
      ic[k] = (ic[k] || 0) + 1;
    });
    return Object.entries(ic).filter(([k]) => k).sort((a, b) => b[1] - a[1]);
  }, [e, v, D]);

  const { list, by, A } = useMemo(() => {
    const list = e.B.companies.filter((c) => (!fInd || D.ind[c.ind] === fInd) && (fTgt === '' || c.tgt === +fTgt));
    const by: Record<string, Company[]> = {};
    list.forEach((c) => {
      const p = D.prov[c.prov] || '';
      (by[p] || (by[p] = [])).push(c);
    });
    const A: Record<string, Agg> = {};
    Object.entries(by).forEach(([k, l]) => (A[k] = agg(l, D)));
    return { list, by, A };
  }, [e, v, D, fInd, fTgt]);

  const val = (a?: Agg) => (!a ? 0 : metric === 'all' ? a.n : a[metric]);
  const mx = geo ? Math.max(2, ...geo.features.map((f) => val(A[f.properties.th]))) : 2;
  const ramp = d3.interpolateRgb('#DCE6FF', '#0A1A86');
  const color = d3.scaleSequentialLog([1, mx], ramp);
  const fill = (n: number) => (!n ? '#EEF1F8' : color(Math.max(1, n)));
  const H = Math.min(860, Math.max(560, width * 1.45));
  const path = useMemo(() => (geo && width ? d3.geoPath(d3.geoMercator().fitExtent([[20, 20], [width - 20, H - 20]], geo)) : null), [geo, width, H]);
  /** Province outlines, built once per layout. */
  const ds = useMemo(() => (geo && path ? geo.features.map((f) => path(f) || '') : []), [geo, path]);

  // pan / zoom
  const zoom = useMemo(
    () =>
      d3.zoom<SVGSVGElement, unknown>().scaleExtent([1, 10]).on('zoom', (ev) => {
        const g = d3.select(gRef.current);
        g.attr('transform', ev.transform.toString());
        g.selectAll<SVGPathElement, unknown>('path').attr('stroke-width', function () {
          return (this.dataset.sel ? 2 : 0.8) / ev.transform.k;
        });
      }),
    [],
  );
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.call(zoom).on('dblclick.zoom', null);
  }, [zoom, path]);
  const zoomBy = (k: number) => svgRef.current && d3.select(svgRef.current).transition().duration(300).call(zoom.scaleBy, k);
  const zoomReset = () => svgRef.current && d3.select(svgRef.current).transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  const k0 = svgRef.current ? d3.zoomTransform(svgRef.current).k : 1;

  const ticks = [1, 10, 100, 1000, 10000].filter((t) => t <= mx * 1.5);
  const mLabel = METRICS.find((m) => m[0] === metric)![1];
  const rank = geo ? Object.keys(A).filter((k) => k && geo.features.some((f) => f.properties.th === k)).map((k) => [k, val(A[k])] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 12) : [];
  const tipA = tipName ? A[tipName] : undefined;
  const moveTip = (ev: React.MouseEvent, name: string) => {
    const el = tipRef.current, card = cardRef.current;
    if (!el || !card) return;
    const r = card.getBoundingClientRect();
    let x = ev.clientX - r.left + 14;
    const y = ev.clientY - r.top + 14;
    if (x > r.width - 210) x -= 230;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.opacity = '1';
    if (name !== tipName) setTipName(name);
  };
  const hideTip = () => {
    if (tipRef.current) tipRef.current.style.opacity = '0';
  };
  const panelList = useMemo(() => (sel ? by[sel] || [] : list), [sel, by, list]);
  const clearSel = useCallback(() => setSel(null), []);
  const toTable = useCallback(() => {
    const p = D.prov.indexOf(sel || ''), i = D.ind.indexOf(fInd);
    setF({ prov: p >= 0 ? String(p) : '', ind: i >= 0 ? String(i) : '', tgt: fTgt, view: 'co' });
  }, [D, sel, fInd, fTgt, setF]);

  return (
    <>
      <PageHead title="แผนที่ลูกค้ารายจังหวัด" sub="กดจังหวัดเพื่อดูกลุ่มเป้าหมายและรายชื่อที่ต้องติดต่อก่อน" />
      <div className="map-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, color: '#475069' }}>
            ระบายสีแผนที่ตาม
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: '#E6ECFD', padding: 4, borderRadius: 999 }}>
              {METRICS.map(([k, l]) => (
                <button key={k} onClick={() => setMetric(k)} aria-pressed={metric === k} style={{ border: 0, cursor: 'pointer', height: 32, padding: '0 13px', borderRadius: 999, fontSize: 13, background: metric === k ? '#1F5BD8' : 'transparent', color: metric === k ? '#fff' : '#1745B8' }}>{l}</button>
              ))}
            </div>
          </div>
          <span style={{ flex: 1 }} />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, color: '#475069' }}>
            กลุ่มอุตสาหกรรม
            <select value={fInd} onChange={(ev) => setFInd(ev.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
              <option value="">ทั้งหมด</option>
              {indCounts.map(([k, n]) => <option key={k} value={k}>{`${k} (${fmtN(n)})`}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, color: '#475069' }}>
            กลุ่มเป้าหมาย
            <select value={fTgt} onChange={(ev) => setFTgt(ev.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
              <option value="">ทั้งหมด</option>
              {TGT.map((l, i) => <option key={i} value={String(i)}>{`${i + 1}. ${l}`}</option>)}
            </select>
          </label>
        </div>

        <div className="map-grid">
          <div ref={cardRef} style={{ ...card, position: 'relative', overflow: 'hidden', background: '#EEF2FF', minHeight: 300 }}>
            <div className="map-zoom" style={{ position: 'absolute', right: 14, top: 14, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 2 }}>
              <button onClick={() => zoomBy(1.6)} aria-label="ขยาย">+</button>
              <button onClick={() => zoomBy(1 / 1.6)} aria-label="ย่อ">−</button>
              <button onClick={zoomReset} aria-label="รีเซ็ต" style={{ fontSize: 13 }}>⟲</button>
            </div>
            {err && <span style={{ position: 'absolute', inset: 20, fontSize: 13.5, color: '#8A2B12' }}>{err}</span>}
            {path && geo && (
              <svg ref={svgRef} viewBox={`0 0 ${width} ${H}`} height={H} style={{ display: 'block', width: '100%' }} role="img" aria-label="แผนที่ประเทศไทยรายจังหวัด">
                <g ref={gRef}>
                  {geo.features.map((f: Feature<Geometry, { th: string }>, i) => {
                    const name = f.properties.th;
                    const isSel = name === sel;
                    return (
                      <path
                        key={name}
                        d={ds[i]}
                        data-sel={isSel ? '1' : undefined}
                        fill={fill(val(A[name]))}
                        stroke={isSel ? '#081247' : '#fff'}
                        strokeWidth={(isSel ? 2 : 0.8) / k0}
                        style={{ cursor: 'pointer', transition: 'fill .25s' }}
                        onMouseMove={(ev) => moveTip(ev, name)}
                        onMouseLeave={hideTip}
                        onClick={() => setSel(isSel ? null : name)}
                      />
                    );
                  })}
                  {/* draw the selected province last so its outline is on top */}
                  {sel && geo.features.map((f, i) => (f.properties.th === sel ? (
                    <path key="sel" d={ds[i]} data-sel="1" fill="none" stroke="#081247" strokeWidth={2 / k0} pointerEvents="none" />
                  ) : null))}
                </g>
              </svg>
            )}
            <div style={{ position: 'absolute', left: 16, bottom: 14, background: 'rgba(255,255,255,.94)', border: '1px solid #E3E7F1', borderRadius: 14, padding: '10px 12px', fontSize: 11.5, color: '#475069', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontWeight: 500, color: '#0E1430' }}>{mLabel}</span>
              <span style={{ display: 'block', width: 190, height: 10, borderRadius: 5, background: `linear-gradient(90deg,${d3.range(0, 1.01, 0.1).map((t) => ramp(t)).join(',')})` }} />
              <span style={{ display: 'flex', justifyContent: 'space-between', width: 190 }}>{ticks.map((t) => <span key={t}>{fmtN(t)}</span>)}</span>
            </div>
            <div ref={tipRef} className="map-tip" style={{ left: 0, top: 0, opacity: 0 }}>
              {tipName && (
                <>
                  <b style={{ fontSize: 14, fontWeight: 500 }}>{tipName}</b><br />
                  บริษัท {fmtN(tipA ? tipA.n : 0)} · CFO ในอายุ {fmtN(tipA ? tipA.act : 0)}<br />
                  ใกล้หมดอายุ {fmtN(tipA ? tipA.soon : 0)} · ยังไม่มี CFO {fmtN(tipA ? tipA.opp : 0)}
                </>
              )}
            </div>
          </div>
          <Panel list={panelList} name={sel} refISO={e.ref} D={D} onClear={clearSel} onOpen={open} onTable={toTable} />
        </div>

        <div style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 500 }}>อันดับจังหวัด · {mLabel}</h3>
            <span style={{ fontSize: 12.5, color: '#475069', lineHeight: 1.5 }}>กดเพื่อดูรายละเอียดจังหวัด</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 8 }}>
            {rank.map(([k, n], i) => (
              <button key={k} onClick={() => setSel(k)} style={{ cursor: 'pointer', display: 'grid', gridTemplateColumns: '26px minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '9px 12px', borderRadius: 12, border: `1px solid ${k === sel ? '#081247' : '#E3E7F1'}`, background: k === sel ? '#EEF2FF' : '#fff', fontSize: 13, color: '#0E1430', textAlign: 'left' }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#E6ECFD', color: '#1F5BD8', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                <b style={{ fontWeight: 500 }}>{fmtN(n)}</b>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

const Panel = memo(function Panel({ list, name, refISO, D, onClear, onOpen, onTable }: { list: Company[]; name: string | null; refISO: string; D: { ind: string[] }; onClear: () => void; onOpen: (id: number) => void; onTable: () => void }) {
  const a = useMemo(() => agg(list, D), [list, D]);
  const tm = Math.max(1, ...a.tg.slice(0, 8));
  const inds = Object.entries(a.ind).sort((x, y) => y[1] - x[1]).slice(0, 6);
  const im = Math.max(1, ...inds.map((x) => x[1]));
  const orgs = list.filter((r) => r.tgt <= 1).sort((x, y) => x.tgt - y.tgt || (x.days ?? 1e9) - (y.days ?? 1e9)).slice(0, 8);
  const h3 = { margin: 0, fontSize: 15.5, fontWeight: 500 } as const;
  const row = { display: 'grid', gridTemplateColumns: '170px minmax(0,1fr) 54px', gap: 10, alignItems: 'center', fontSize: 13 } as const;
  const ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
  const bar = (w: number, c = '#1F5BD8') => (
    <span style={{ height: 10, background: '#EEF1F8', borderRadius: 6, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${w}%`, background: c, borderRadius: 6 }} /></span>
  );
  return (
    <div style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="hero" style={{ borderRadius: 22, padding: '18px 20px', color: '#fff', background: heroGrad, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, color: '#E4ECFF' }}>{name ? 'จังหวัด' : 'ภาพรวม'} · สถานะ ณ {isoTh(refISO)}</span>
            <span style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.3 }}>{name || 'ทั้งประเทศ'}</span>
          </div>
          {name && <button onClick={onClear} style={{ cursor: 'pointer', border: '1px solid rgba(185,200,255,.5)', background: 'rgba(255,255,255,.1)', color: '#fff', height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5 }}>ดูทั้งประเทศ</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 }}>
          {([['บริษัท', a.n], ['CFO ในอายุ', a.act], ['ใกล้หมดอายุ', a.soon], ['มีเบอร์โทร', a.ph]] as const).map(([k, n]) => (
            <div key={k} style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(185,200,255,.3)', borderRadius: 12, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11.5, color: '#fff' }}>{k}</span>
              <span style={{ fontSize: 20, fontWeight: 500 }}>{fmtN(n)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={h3}>กลุ่มเป้าหมาย</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {a.tg.slice(0, 8).map((n, i) => (
            <div key={i} style={row}><span style={ell}>{i + 1}. {TGT[i]}</span>{bar((n / tm) * 100)}<span style={{ textAlign: 'right', color: '#475069', fontVariantNumeric: 'tabular-nums' }}>{fmtN(n)}</span></div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={h3}>กลุ่มอุตสาหกรรมหลัก</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {inds.map(([k, n]) => (
            <div key={k} style={row}><span style={ell}>{k}</span>{bar((n / im) * 100, '#4D72FF')}<span style={{ textAlign: 'right', color: '#475069', fontVariantNumeric: 'tabular-nums' }}>{fmtN(n)}</span></div>
          ))}
        </div>
      </div>
      {name ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={h3}>ต้องติดต่อก่อน (กลุ่ม 1–2)</h3>
            <div>
              {orgs.map((r) => {
                const s = r.tgt === 0 ? ['ใกล้หมดอายุ', '#FDECC8', '#9A5A00'] : ['หมดอายุไม่เกิน 12 เดือน', '#EEF1F8', '#475069'];
                return (
                  <button key={r.id} className="map-org" onClick={() => onOpen(r.id)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '10px 0', border: 0, borderBottom: '1px solid #EEF1F8', cursor: 'pointer', background: 'none', textAlign: 'left', font: 'inherit', color: 'inherit', width: '100%' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span className="on" style={{ fontSize: 13.5, fontWeight: 500, ...ell }}>{r.name}</span>
                      <span style={{ fontSize: 12.5, color: '#475069', lineHeight: 1.5 }}>CFO หมดอายุ {isoTh(r.cfoEx)}</span>
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 500, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap', background: s[1], color: s[2] }}>{s[0]}</span>
                  </button>
                );
              })}
              {!orgs.length && <span style={{ fontSize: 12.5, color: '#475069' }}>ไม่มี</span>}
            </div>
          </div>
          <div><button onClick={onTable} style={{ cursor: 'pointer', height: 38, padding: '0 16px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13.5, fontWeight: 500 }}>ดูรายชื่อทั้งหมด {fmtN(a.n)} บริษัท →</button></div>
        </>
      ) : (
        <span style={{ fontSize: 12.5, color: '#475069', lineHeight: 1.5 }}>กดจังหวัดบนแผนที่หรือในอันดับด้านล่างเพื่อดูรายละเอียด</span>
      )}
    </div>
  );
});
