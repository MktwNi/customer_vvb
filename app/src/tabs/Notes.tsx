import { useApp, useEngineVersion } from '../state';
import { GDESC, TGT, tgtName } from '../lib/constants';
import { fmtN, isoTh } from '../lib/format';
import { PageHead, SectionHead } from '../components/ui';

const DEDUP_NOTES = [
  '1 บริษัท = 1 แถว รวมทุกแหล่ง (TGO, GI, กรอ., SET) ด้วยเลขนิติบุคคลและชื่อบริษัทจากไฟล์ต้นทาง',
  'ระบบตรวจซ้ำอีกชั้น: ชื่อเหมือนกันหลังตัดคำนำหน้า (บริษัท จำกัด มหาชน) และชื่อสาขา ถ้ามีเลขนิติบุคคลแค่แถวเดียวจะรวมให้อัตโนมัติ ที่เหลือ (ไม่มีเลขทั้งคู่ เลขต่างกัน หรือใช้เบอร์เดียวกัน) ส่งเข้าคิวตรวจข้อมูลซ้ำ',
  'ชื่อจาก TGO ที่ขึ้นต้นด้วย "บริษัท บริษัท" ถูกแก้เป็น "บริษัท" ก่อนเทียบ',
  'บริษัทที่รวมแล้วจะแสดงว่ามาจากรหัสใด และรายละเอียดทุกรายการระบุแหล่งที่มา (TGO / GI / กรอ. / SET) พร้อมรหัสแถวต้นทาง',
];
const srcCols = 'minmax(0,1.4fr) minmax(0,2fr) 110px 90px minmax(0,2fr)';
const rndCols = '96px repeat(4,minmax(110px,1fr)) 110px minmax(150px,1.3fr)';
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
  const live = e.R.filter((x) => x.annT >= T);
  const past = e.R.filter((x) => x.annT < T);
  const round = (x: (typeof e.R)[number]) => {
    const left = Math.round((x.docT - T) / 864e5);
    const st = x.docT >= T ? `เปิดรับเอกสาร · เหลือ ${fmtN(left)} วัน` : x.annT >= T ? 'ปิดรับเอกสาร · รอประกาศผล' : 'ประกาศผลแล้ว';
    const n = by[x.no] || 0;
    return (
      <div key={x.no} className={'nt-rnd' + (nextOpen && nextOpen.no === x.no ? ' next' : '')} style={{ gridTemplateColumns: rndCols }}>
        <span className="t-name">รอบ {x.no}</span>
        <span>{isoTh(x.doc)}</span>
        <span>{isoTh(x.fee)}</span>
        <span>{isoTh(x.ann)}</span>
        <span>{isoTh(x.dl)}</span>
        <span>{n > 0 ? <button onClick={() => setF({ rnd: x.no, view: 'co', sort: 'exp', tgt: '' })} className="lnk">{fmtN(n)} บริษัท</button> : <span className="t-muted">0</span>}</span>
        <span className={x.docT >= T && left <= 14 ? 't-warn' : 't-sec'} style={{ fontSize: 13 }}>{st}</span>
      </div>
    );
  };
  const head = (
    <div className="nt-rnd thead" style={{ gridTemplateColumns: rndCols }}>
      <span>รอบ</span><span>ส่งเอกสาร</span><span>ชำระค่าธรรมเนียม</span><span>ประกาศผล</span><span>ดาวน์โหลด</span><span>ต้องยื่น</span><span>สถานะ</span>
    </div>
  );

  return (
    <>
      <PageHead title="หมายเหตุ" sub="นิยามกลุ่มเป้าหมาย รอบ อบก. และแหล่งข้อมูล" />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionHead title="นิยามกลุ่มเป้าหมาย" />
        <div className="nt-groups">
          {GDESC.map((desc, i) => (
            <div key={i} className="nt-group">
              <span className="ov-rank">{i + 1}.</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="t-name">{i === 0 ? tgtName(0, W) : TGT[i]}</span>
                <span className="t-sec" style={{ lineHeight: 1.6, textWrap: 'pretty' }}>{desc}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionHead title="การรวมข้อมูลและตัดข้อมูลซ้ำ" />
        <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DEDUP_NOTES.map((t) => <span key={t} style={{ fontSize: 14, lineHeight: 1.65, textWrap: 'pretty' }}>{t}</span>)}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionHead title="รอบการพิจารณาของ อบก." sub="รอบที่ต้องยื่นต่ออายุ = รอบสุดท้ายที่ประกาศผลไม่เกินวันหมดอายุ ถ้าปิดรับเอกสารแล้วเลื่อนไปรอบถัดไป" />
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            {head}
            {live.map(round)}
            {!live.length && <div className="empty" style={{ padding: '14px 20px' }}>ยังไม่มีรอบที่กำลังเปิด</div>}
          </div>
        </div>
        {past.length > 0 && (
          <details className="nt-past">
            <summary className="lnk">{`รอบที่ประกาศผลแล้ว (${fmtN(past.length)} รอบ)`}</summary>
            <div className="card" style={{ overflowX: 'auto', marginTop: 10 }}>
              <div style={{ minWidth: 860 }}>
                {head}
                {past.map(round)}
              </div>
            </div>
          </details>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <details className="nt-past">
          <summary className="hv-tx" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
            <span className="sec-h" style={{ display: 'inline-flex' }}><h2>ไฟล์ต้นทาง</h2><span className="sec-h-sub">{fmtN(e.sources.length)} ไฟล์</span></span>
          </summary>
          <div className="card" style={{ overflowX: 'auto', marginTop: 12 }}>
            <div style={{ minWidth: 860 }}>
              <div className="thead" style={{ display: 'grid', gridTemplateColumns: srcCols, gap: 14, padding: '12px 22px 10px' }}>
                <span>แหล่งข้อมูล</span><span>หน่วยงาน / ไฟล์</span><span>ข้อมูล ณ</span><span style={{ textAlign: 'right' }}>แถว</span><span>หมายเหตุ</span>
              </div>
              {e.sources.map((x, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: srcCols, gap: 14, padding: '11px 22px', fontSize: 14, borderBottom: '1px solid var(--divider)' }}>
                  <span className="t-name">{txt(x[0])}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--ink-2)', minWidth: 0 }}>
                    <span>{txt(x[1])}</span>
                    <span className="t-meta" style={{ overflowWrap: 'anywhere' }}>{txt(x[2])}</span>
                  </span>
                  <span>{txt(x[3])}</span>
                  <span style={{ textAlign: 'right' }}>{fmtN(x[4] as number)}</span>
                  <span style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.55 }}>{txt(x[6])}</span>
                </div>
              ))}
            </div>
          </div>
        </details>
      </section>
    </>
  );
}
