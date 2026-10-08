import { useApp, useEngineVersion } from '../state';
import { fmtN, gccCode } from '../lib/format';
import type { DupGroup } from '../lib/types';
import { PageHead, Pager, SrcTags } from '../components/ui';

const WHY: Record<DupGroup['why'], [string, string, string]> = {
  auto: ['ชื่อตรงกัน · มีเลขนิติบุคคลแถวเดียว', '#DDF5F1', '#0B6E66'],
  nojur: ['ชื่อตรงกัน · ไม่มีเลขนิติบุคคล', '#FDECC8', '#9A5A00'],
  diffjur: ['ชื่อตรงกัน · เลขนิติบุคคลต่างกัน', '#FBE3DC', '#8A2B12'],
  phone: ['ใช้เบอร์โทรเดียวกัน', '#E6ECFD', '#1745B8'],
};
const PS = 20;
type F = 'pending' | 'auto' | 'decided' | 'all';
export const dedupFilter = (k: F) => (g: DupGroup) =>
  k === 'pending' ? g.state === 'pending' : k === 'auto' ? g.why === 'auto' : k === 'decided' ? g.why !== 'auto' && g.state !== 'pending' : true;

export function Dedup() {
  const { engine: e, ui, set, open } = useApp();
  // deciding what is a duplicate changes every company list of the team: the admin's job
  const admin = e.can('admin');
  useEngineVersion();
  const G = e.B.groups, D = e.B.D;
  const list = G.filter(dedupFilter(ui.ddF));
  const pages = Math.max(1, Math.ceil(list.length / PS));
  const page = Math.min(ui.ddPage, pages - 1);
  const kp: [F, string, number, string][] = [
    ['pending', 'รอตรวจ', G.filter(dedupFilter('pending')).length, 'กดรวมหรือแยกเอง'],
    ['auto', 'รวมอัตโนมัติ', G.filter(dedupFilter('auto')).length, 'กดแยกออกได้ถ้าไม่ใช่บริษัทเดียวกัน'],
    ['decided', 'ตัดสินแล้ว', G.filter(dedupFilter('decided')).length, 'รวมหรือแยกด้วยตนเอง'],
    ['all', 'ทั้งหมด', G.length, 'ทุกกลุ่มที่ระบบพบ'],
  ];

  return (
    <>
      <PageHead title="ตรวจข้อมูลซ้ำ" wrapSub sub={`ชื่อบริษัทเทียบหลังตัดคำนำหน้า/สาขา · เบอร์โทรเทียบ 9 หลักแรก · การตัดสินใจ${e.teamCfg ? "แชร์กับทีม" : "บันทึกในเครื่องนี้"}และใช้กับทุกหน้า`} />
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
        {kp.map(([k, label, n, sub]) => {
          const on = ui.ddF === k;
          return (
            <button key={k} onClick={() => set({ ddF: k, ddPage: 0 })} aria-pressed={on} style={{ cursor: 'pointer', textAlign: 'left', background: on ? '#EEF2FF' : '#fff', border: `1.5px solid ${on ? '#1F5BD8' : '#E3E7F1'}`, borderRadius: 18, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, color: '#475069' }}>{label}</span>
              <span style={{ fontSize: 28, fontWeight: 500, color: '#0E1430' }}>{fmtN(n)}</span>
              <span style={{ fontSize: 12, color: '#475069', fontWeight: 300 }}>{sub}</span>
            </button>
          );
        })}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.slice(page * PS, page * PS + PS).map((g) => {
          const [whyLabel, whyBg, whyFg] = WHY[g.why];
          const decided = g.state !== 'pending';
          const canMerge = g.state === 'pending' || g.state === 'split';
          const canSplit = g.state === 'pending' || g.state === 'merged' || g.state === 'merge';
          const canUndo = decided && !(g.why === 'auto' && g.state === 'merged');
          const stateLabel = g.state === 'merged' ? 'รวมเป็นบริษัทเดียวแล้ว' : g.state === 'merge' ? 'รวมแล้ว (ตัดสินเอง)' : g.state === 'split' ? 'แยกเป็นคนละบริษัท' : 'รอตรวจ';
          return (
            <div key={g.key} style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 20, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 10px', borderRadius: 999, background: whyBg, color: whyFg }}>{whyLabel}</span>
                  <span style={{ fontSize: 12.5, color: '#475069' }}>{stateLabel}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!admin && <span style={{ fontSize: 12.5, color: '#5E6680' }}>การตัดสินข้อมูลซ้ำทำโดยผู้ดูแลระบบ</span>}
                  {admin && canMerge && <button onClick={() => e.decide(g.key, g.why === 'auto' ? null : 'merge')} style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13 }}>รวมเป็นบริษัทเดียว</button>}
                  {admin && canSplit && <button onClick={() => e.decide(g.key, 'split')} style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: '1.5px solid #1F5BD8', background: '#fff', color: '#1F5BD8', fontSize: 13 }}>{g.state === 'pending' ? 'ไม่ซ้ำ แยกกัน' : 'แยกออก'}</button>}
                  {admin && canUndo && <button onClick={() => e.decide(g.key, null)} style={{ cursor: 'pointer', height: 34, padding: '0 10px', border: 0, background: 'transparent', color: '#475069', fontSize: 13, textDecoration: 'underline' }}>ยกเลิกการตัดสินใจ</button>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 10 }}>
                {g.ids.map((id) => {
                  const r = e.B.rawById.get(id)!;
                  const facts: [string, string][] = [['รหัส', gccCode(id)], ['เลขนิติบุคคล', r.jur || '—'], ['ประเภท', D.type[r.type]], ['จังหวัด', D.prov[r.prov] || '—'], ['โทรศัพท์', r.phone || '—']];
                  return (
                    <button key={id} onClick={() => open(id)} style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid #EEF1F8', background: '#F7F8FC', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 5, color: '#0E1430' }}>
                      <span style={{ fontSize: 14, fontWeight: 500, textWrap: 'pretty' }}>{r.name}</span>
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><SrcTags mask={r.src} /></span>
                      {facts.map(([k, v]) => (
                        <span key={k} style={{ fontSize: 12.5, color: '#475069', display: 'flex', gap: 6 }}>
                          <span style={{ minWidth: 84, color: '#5E6680' }}>{k}</span>
                          <span style={{ wordBreak: 'break-word' }}>{v}</span>
                        </span>
                      ))}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!list.length && <div style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 20, padding: 32, textAlign: 'center', color: '#475069' }}>ไม่มีรายการในหมวดนี้</div>}
      </section>
      <Pager page={page} pages={pages} onPrev={() => set({ ddPage: page - 1 })} onNext={() => set({ ddPage: page + 1 })} />
    </>
  );
}
