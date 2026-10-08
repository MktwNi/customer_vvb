import { useApp, useEngineVersion } from '../state';
import { GCOL, GDESC, TGT, tgtName } from '../lib/constants';
import { fmtN, isoTh } from '../lib/format';
import { PageHead } from '../components/ui';

const DEDUP_NOTES = [
  '1 บริษัท = 1 แถว รวมทุกแหล่ง (TGO, GI, กรอ., SET) ด้วยเลขนิติบุคคลและชื่อบริษัทจากไฟล์ต้นทาง',
  'ระบบตรวจซ้ำอีกชั้น: ชื่อเหมือนกันหลังตัดคำนำหน้า (บริษัท จำกัด มหาชน) และชื่อสาขา ถ้ามีเลขนิติบุคคลแค่แถวเดียวจะรวมให้อัตโนมัติ ที่เหลือ (ไม่มีเลขทั้งคู่ เลขต่างกัน หรือใช้เบอร์เดียวกัน) ส่งเข้าคิวตรวจข้อมูลซ้ำ',
  'ชื่อจาก TGO ที่ขึ้นต้นด้วย "บริษัท บริษัท" ถูกแก้เป็น "บริษัท" ก่อนเทียบ',
  'บริษัทที่รวมแล้วจะแสดงว่ามาจากรหัสใด และรายละเอียดทุกรายการระบุแหล่งที่มา (TGO / GI / กรอ. / SET) พร้อมรหัสแถวต้นทาง',
];
const srcCols = 'minmax(0,1.4fr) minmax(0,2fr) 110px 90px minmax(0,2fr)';
/** null/undefined render as empty, like the prototype runtime */
const txt = (v: unknown) => (v == null ? '' : String(v));

export function Notes() {
  const { engine: e, setF } = useApp();
  useEngineVersion();
  const W = e.W, T = e.T;
  const by: Record<string, number> = {};
  e.B.companies.forEach((c) => {
    if (c.rnd) by[c.rnd] = (by[c.rnd] || 0) + 1;
  });
  const nextOpen = e.R.find((x) => x.docT >= T);

  return (
    <>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHead no="01" title="นิยามกลุ่มเป้าหมาย" nowrap />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,400px),1fr))', gap: 12 }}>
          {GDESC.map((desc, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 18, padding: '16px 18px', display: 'flex', gap: 14 }}>
              <span style={{ width: 32, height: 32, flex: 'none', borderRadius: '50%', background: GCOL[i][0], color: GCOL[i][1], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14 }}>{i + 1}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 500 }}>{i === 0 ? tgtName(0, W) : TGT[i]}</span>
                <span style={{ fontSize: 13.5, color: '#475069', fontWeight: 300, lineHeight: 1.6, textWrap: 'pretty' }}>{desc}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHead no="02" title="การรวมข้อมูลและตัดข้อมูลซ้ำ" nowrap />
        <div style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 20, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DEDUP_NOTES.map((t) => <span key={t} style={{ fontSize: 14, color: '#384155', lineHeight: 1.65, textWrap: 'pretty' }}>{t}</span>)}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHead no="03" title="รอบการพิจารณาของ อบก." sub="รอบที่ต้องยื่นต่ออายุ = รอบสุดท้ายที่ประกาศผลไม่เกินวันหมดอายุ ถ้าปิดรับเอกสารแล้วเลื่อนไปรอบถัดไป" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 12 }}>
          {e.R.map((x) => {
            const left = Math.round((x.docT - T) / 864e5);
            const st: [string, string, string] =
              x.docT >= T ? ['เปิดรับเอกสาร · เหลือ ' + fmtN(left) + ' วัน', left <= 14 ? '#FDECC8' : '#DDF5F1', left <= 14 ? '#9A5A00' : '#0B6E66']
              : x.annT >= T ? ['ปิดรับเอกสาร · รอประกาศผล', '#E6ECFD', '#1745B8']
              : ['ประกาศผลแล้ว', '#EEF1F8', '#475069'];
            const n = by[x.no] || 0;
            const dates: [string, string][] = [['ส่งเอกสาร', isoTh(x.doc)], ['ชำระค่าธรรมเนียม', isoTh(x.fee)], ['ประชุมครั้งที่ 1', isoTh(x.m1)], ['ประกาศผล', isoTh(x.ann)], ['ดาวน์โหลดใบรับรอง', isoTh(x.dl)]];
            return (
              <div key={x.no} style={{ background: x.annT < T ? '#F7F8FC' : '#fff', border: nextOpen && nextOpen.no === x.no ? '2px solid #1F5BD8' : '1px solid #E3E7F1', borderRadius: 20, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 22, fontWeight: 500, color: '#1F5BD8' }}>รอบ {x.no}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 500, padding: '3px 10px', borderRadius: 999, background: st[1], color: st[2] }}>{st[0]}</span>
                </div>
                {dates.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                    <span style={{ color: '#475069' }}>{k}</span>
                    <span style={{ fontWeight: 500, textAlign: 'right' }}>{v}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid #EEF1F8', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: '#475069' }}>ต้องยื่นรอบนี้ <span style={{ fontSize: 20, fontWeight: 500, color: '#1F5BD8' }}>{fmtN(n)}</span> บริษัท</span>
                  {n > 0 && <button onClick={() => setF({ rnd: x.no, view: 'co', sort: 'exp', tgt: '' })} className="btn pri" style={{ height: 32, padding: '0 12px', fontSize: 12.5 }}>ดูรายชื่อ</button>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHead no="04" title="ไฟล์ต้นทาง" sub={`${fmtN(e.sources.length)} ไฟล์`} />
        <div style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 22, overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            <div style={{ display: 'grid', gridTemplateColumns: srcCols, gap: 14, padding: '13px 22px', fontSize: 12.5, color: '#475069', background: '#F7F8FC', borderBottom: '1px solid #E3E7F1' }}>
              <span>แหล่งข้อมูล</span><span>หน่วยงาน / ไฟล์</span><span>ข้อมูล ณ</span><span style={{ textAlign: 'right' }}>แถว</span><span>หมายเหตุ</span>
            </div>
            {e.sources.map((x, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: srcCols, gap: 14, padding: '11px 22px', fontSize: 13, borderBottom: '1px solid #EEF1F8' }}>
                <span style={{ fontWeight: 500 }}>{txt(x[0])}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, color: '#475069' }}>
                  <span>{txt(x[1])}</span>
                  <span style={{ fontSize: 12, color: '#5E6680', wordBreak: 'break-all' }}>{txt(x[2])}</span>
                </span>
                <span>{txt(x[3])}</span>
                <span style={{ textAlign: 'right' }}>{fmtN(x[4] as number)}</span>
                <span style={{ color: '#475069', fontSize: 12.5, lineHeight: 1.55 }}>{txt(x[6])}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
