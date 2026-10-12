import { useApp, useEngineVersion } from '../state';
import { fmtN, gccCode } from '../lib/format';
import type { DupGroup } from '../lib/types';
import { PageHead, Pager, Segmented, srcWords } from '../components/ui';

const WHY: Record<DupGroup['why'], string> = {
  auto: 'ชื่อตรงกัน · มีเลขนิติบุคคลแถวเดียว',
  nojur: 'ชื่อตรงกัน · ไม่มีเลขนิติบุคคล',
  diffjur: 'ชื่อตรงกัน · เลขนิติบุคคลต่างกัน',
  phone: 'ใช้เบอร์โทรเดียวกัน',
};
const PS = 20;
type F = 'pending' | 'auto' | 'decided' | 'all';
export const dedupFilter = (k: F) => (g: DupGroup) =>
  k === 'pending' ? g.state === 'pending' : k === 'auto' ? g.why === 'auto' : k === 'decided' ? g.why !== 'auto' && g.state !== 'pending' : true;

export function Dedup() {
  const { engine: e, ui, set, open, go } = useApp();
  // deciding what is a duplicate changes every company list of the team: the admin's job
  const admin = e.can('admin');
  useEngineVersion();
  const G = e.B.groups, D = e.B.D;
  const list = G.filter(dedupFilter(ui.ddF));
  const pages = Math.max(1, Math.ceil(list.length / PS));
  const page = Math.min(ui.ddPage, pages - 1);
  const kp: { v: F; label: string; n: number }[] = [
    { v: 'pending', label: 'รอตรวจ', n: G.filter(dedupFilter('pending')).length },
    { v: 'auto', label: 'รวมอัตโนมัติ', n: G.filter(dedupFilter('auto')).length },
    { v: 'decided', label: 'ตัดสินแล้ว', n: G.filter(dedupFilter('decided')).length },
    { v: 'all', label: 'ทั้งหมด', n: G.length },
  ];

  return (
    <>
      <PageHead
        title="ตรวจข้อมูลซ้ำ"
        sub={<>รอตรวจ {fmtN(kp[0].n)} กลุ่ม · <button className="lnk" style={{ fontSize: 13 }} onClick={() => go('notes')}>วิธีเทียบดูที่หมายเหตุ</button></>}
      />
      <Segmented label="แสดง" value={ui.ddF} options={kp} onChange={(k) => set({ ddF: k, ddPage: 0 })} />
      {!admin && <span className="note">การตัดสินข้อมูลซ้ำทำโดยผู้ดูแลระบบ</span>}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.slice(page * PS, page * PS + PS).map((g) => {
          const canMerge = g.state === 'pending' || g.state === 'split';
          const canSplit = g.state === 'pending' || g.state === 'merged' || g.state === 'merge';
          const canUndo = g.state !== 'pending' && !(g.why === 'auto' && g.state === 'merged');
          const stateLabel = g.state === 'merged' ? 'รวมเป็นบริษัทเดียวแล้ว' : g.state === 'merge' ? 'รวมแล้ว (ตัดสินเอง)' : g.state === 'split' ? 'แยกเป็นคนละบริษัท' : '';
          const rows = g.ids.map((id) => e.B.rawById.get(id)!);
          // a compact comparison: what differs is ink 500, what is the same is grey; empty on every side is left out
          const facts: [string, string[]][] = ([
            ['รหัส', g.ids.map((id) => gccCode(id))],
            ['เลขนิติบุคคล', rows.map((r) => r.jur || '—')],
            ['ประเภท', rows.map((r) => D.type[r.type] || '—')],
            ['จังหวัด', rows.map((r) => D.prov[r.prov] || '—')],
            ['โทรศัพท์', rows.map((r) => r.phone || '—')],
            ['แหล่ง', rows.map((r) => srcWords(r.src).join(' · ') || '—')],
          ] as [string, string[]][]).filter(([, v]) => v.some((x) => x !== '—'));
          const cols = `100px repeat(${g.ids.length},minmax(150px,1fr))`;
          return (
            <div key={g.key} className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="chip">{WHY[g.why]}</span>
                  {stateLabel && <span className="t-sec">{stateLabel}</span>}
                </span>
                {admin && (
                  <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {canMerge && <button onClick={() => e.decide(g.key, g.why === 'auto' ? null : 'merge')} className="btn sm">รวมเป็นบริษัทเดียว</button>}
                    {canSplit && <button onClick={() => e.decide(g.key, 'split')} className="btn sm">{g.state === 'pending' ? 'ไม่ซ้ำ แยกกัน' : 'แยกออก'}</button>}
                    {canUndo && <button onClick={() => e.decide(g.key, null)} className="quiet">ยกเลิกการตัดสินใจ</button>}
                  </span>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div className="dd-cmp" style={{ gridTemplateColumns: cols }}>
                  <span />
                  {rows.map((r, k) => (
                    <button key={g.ids[k]} onClick={() => open(g.ids[k])} className="hv-tx dd-name">{r.name}</button>
                  ))}
                  {facts.map(([k, v]) => {
                    const same = v.every((x) => x === v[0]);
                    return [
                      <span key={k} className="t-meta">{k}</span>,
                      ...v.map((x, j) => <span key={k + j} className={'dd-v' + (same || x === '—' ? ' same' : '')}>{x}</span>),
                    ];
                  })}
                </div>
              </div>
            </div>
          );
        })}
        {!list.length && <div className="card empty" style={{ padding: '20px 22px' }}>ไม่มีรายการในหมวดนี้</div>}
      </section>
      <Pager page={page} pages={pages} onPrev={() => set({ ddPage: page - 1 })} onNext={() => set({ ddPage: page + 1 })} />
    </>
  );
}
