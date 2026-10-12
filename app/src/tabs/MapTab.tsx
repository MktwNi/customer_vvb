import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { useApp, useEngineVersion } from '../state';
import { TGT } from '../lib/constants';
import { dataUrl } from '../lib/core';
import { fmtN, isoTh } from '../lib/format';
import type { Company } from '../lib/types';
import { Kpi, PageHead, card } from '../components/ui';

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
  // "ดูทั้งประเทศ" also puts the zoom back (there is no separate reset button)
  const clearSel = useCallback(() => {
    setSel(null);
    if (svgRef.current) d3.select(svgRef.current).transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  }, [zoom]);
  const toTable = useCallback(() => {
    const p = D.prov.indexOf(sel || ''), i = D.ind.indexOf(fInd);
    setF({ prov: p >= 0 ? String(p) : '', ind: i >= 0 ? String(i) : '', tgt: fTgt, view: 'co' });
  }, [D, sel, fInd, fTgt, setF]);

  return (
    <>
      <PageHead title="แผนที่ลูกค้ารายจังหวัด" sub="กดจังหวัดบนแผนที่หรือในอันดับ เพื่อดูกลุ่มเป้าหมายและรายชื่อที่ต้องติดต่อก่อน" />
      <div className="map-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px 18px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}>
            ระบายสีตาม
            <select value={metric} onChange={(ev) => setMetric(ev.target.value as Metric)} className="fld sel" style={{ minWidth: 220 }}>
              {METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}>
            กลุ่มอุตสาหกรรม
            <select value={fInd} onChange={(ev) => setFInd(ev.target.value)} className="fld sel" style={{ minWidth: 200 }}>
              <option value="">ทั้งหมด</option>
              {indCounts.map(([k, n]) => <option key={k} value={k}>{`${k} (${fmtN(n)})`}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}>
            กลุ่มเป้าหมาย
            <select value={fTgt} onChange={(ev) => setFTgt(ev.target.value)} className="fld sel" style={{ minWidth: 200 }}>
              <option value="">ทั้งหมด</option>
              {TGT.map((l, i) => <option key={i} value={String(i)}>{`${i + 1}. ${l}`}</option>)}
            </select>
          </label>
        </div>

        <div className="map-grid">
          <div ref={cardRef} style={{ ...card, position: 'relative', overflow: 'hidden', background: '#F2F5FC', minHeight: 300 }}>
            <div className="map-zoom" style={{ position: 'absolute', right: 14, top: 14, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 2 }}>
              <button onClick={() => zoomBy(1.6)} aria-label="ขยาย">+</button>
              <button onClick={() => zoomBy(1 / 1.6)} aria-label="ย่อ">−</button>
            </div>
            {err && <span className="t-bad" style={{ position: 'absolute', inset: 20, fontSize: 14 }}>{err}</span>}
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
                        className="map-prov"
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
            <div style={{ position: 'absolute', left: 16, bottom: 14, background: 'rgba(255,255,255,.94)', border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'var(--ink)', fontSize: 13 }}>{mLabel}</span>
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

        <div className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 className="card-t">อันดับจังหวัด · {mLabel}</h3>
          <div className="map-rank">
            {rank.map(([k, n], i) => (
              <button key={k} onClick={() => setSel(k)} aria-pressed={k === sel} className="hv" style={{ cursor: 'pointer', display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '9px 10px', borderRadius: 10, border: 0, borderBottom: '1px solid var(--divider)', ...(k === sel ? { '--bg': 'var(--tint)', '--hv': 'var(--tint-2)' } : {}), fontSize: 14, color: 'var(--ink)', textAlign: 'left' }}>
                <span className="ov-rank">{i + 1}.</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: k === sel ? 500 : 400 }}>{k}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtN(n)}</span>
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
  const h3 = { margin: 0, fontSize: 16, fontWeight: 500 } as const;
  const row = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 54px', gap: 10, alignItems: 'center', fontSize: 13 } as const;
  const ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
  const bar = (w: number) => (
    <span className="ov-bar"><i style={{ width: `${w}%` }} /></span>
  );
  return (
    <div className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="t-meta" style={{ fontSize: 13 }}>{name ? 'จังหวัด' : 'ภาพรวม'} · สถานะ ณ {isoTh(refISO)}</span>
          <span style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.3 }}>{name || 'ทั้งประเทศ'}</span>
        </div>
        {name && <button onClick={onClear} className="lnk" style={{ flex: 'none' }}>ดูทั้งประเทศ</button>}
      </div>
      <div className="kpis k3">
        <Kpi hero label="บริษัท" value={fmtN(a.n)} />
        <Kpi label="CFO ในอายุ" value={fmtN(a.act)} zero={!a.act} />
        <Kpi label="ใกล้หมดอายุ" value={fmtN(a.soon)} zero={!a.soon} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={h3}>กลุ่มเป้าหมาย</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {a.tg.slice(0, 8).map((n, i) => (
            <div key={i} style={row}><span style={ell}>{i + 1}. {TGT[i]}</span>{bar((n / tm) * 100)}<span style={{ textAlign: 'right', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtN(n)}</span></div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={h3}>กลุ่มอุตสาหกรรมหลัก</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {inds.map(([k, n]) => (
            <div key={k} style={row}><span style={ell}>{k}</span>{bar((n / im) * 100)}<span style={{ textAlign: 'right', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtN(n)}</span></div>
          ))}
        </div>
      </div>
      {name ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={h3}>ต้องติดต่อก่อน (กลุ่ม 1–2)</h3>
            <div>
              {orgs.map((r) => (
                <button key={r.id} className="map-org hv" onClick={() => onOpen(r.id)} style={{ display: 'flex', flexDirection: 'column', padding: '10px 8px', margin: '0 -8px', border: 0, borderBottom: '1px solid var(--divider)', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', width: 'calc(100% + 16px)', minWidth: 0 }}>
                  <span className="on" style={{ fontSize: 14, fontWeight: 500, ...ell }}>{r.name}</span>
                  <span className="t-meta">{r.tgt === 0 && r.days != null ? `เหลือ ${fmtN(r.days)} วัน · หมดอายุ ${isoTh(r.cfoEx)}` : `หมดอายุ ${isoTh(r.cfoEx)}`}</span>
                </button>
              ))}
              {!orgs.length && <span className="empty">ไม่มี</span>}
            </div>
          </div>
          <div><button onClick={onTable} className="btn pri">ดูรายชื่อทั้งหมด {fmtN(a.n)} บริษัท</button></div>
        </>
      ) : null}
    </div>
  );
});
