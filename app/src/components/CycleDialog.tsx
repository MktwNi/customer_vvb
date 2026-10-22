import { useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { todayISO } from '../lib/format';
import { CYCLE_LABEL, cycleBlock, cycleDefault, cycleYears, nextYear } from '../lib/recontact';
import { jobName } from '../lib/salesUi';
import { DialogActions, Modal } from './Dialog';

/**
 * เปิดรอบใหม่ (lib/recontact.ts): a new job of a closed single job's company, for a later year the person picks
 * (the tracker's years and the next one; the next one by default). What it copies, and what stays on the old job,
 * is said in the dialog. A viewer, or an account that may not edit the job, sees the button off with the reason.
 */
export function CycleDialog({ id }: { id: string }) {
  const { engine: e, set } = useApp();
  useEngineVersion();
  const d = e.sales.deals[id];
  const today = todayISO();
  const next = nextYear(today);
  const years = d ? cycleYears(Object.values(e.sales.deals), d.year, next) : [];
  const [picked, setPicked] = useState('');
  const sel = years.includes(picked) ? picked : cycleDefault(years, next);
  const close = () => set({ cycleDlg: null });
  const reason = !d ? 'ไม่พบงานนี้' : !e.canDeal('edit.deal', d) ? 'บัญชีนี้แก้งานนี้ไม่ได้ จึงเปิดรอบใหม่ไม่ได้' : cycleBlock(e.sales, d) || (!years.length ? 'ไม่มีปีที่ต่อจากปีของงานนี้' : '');
  const go = () => {
    if (!d || reason || !sel) return;
    const n = e.newCycle(d.id, sel);
    if (!n) {
      set((s) => ({ cycleDlg: null, slToast: { text: e.teamNote || 'เปิดรอบใหม่ไม่ได้', ms: 6000, n: (s.slToast?.n || 0) + 1 } }));
      return;
    }
    set((s) => ({
      cycleDlg: null, deal: n.id, slYear: sel,
      slToast: { text: `เปิดรอบใหม่ปี ${sel} แล้ว งานเดิมยังอยู่ที่เดิม`, ms: 5000, n: (s.slToast?.n || 0) + 1 },
    }));
  };
  return (
    <Modal title={CYCLE_LABEL} onClose={close} focus="dialog">
      {d && (
        <>
          <p style={{ margin: 0, lineHeight: 1.6 }}>{`เปิดงานใหม่ของ “${jobName(d)}” สำหรับปีที่เลือก งานเดิมยังอยู่ที่เดิม`}</p>
          {years.length > 0 && (
            <fieldset className="cl-how">
              <legend>ปีของรอบใหม่</legend>
              {years.map((y) => (
                <label key={y} className="cl-opt">
                  <input type="radio" name="cycle-year" checked={sel === y} disabled={!!reason} onChange={() => setPicked(y)} />
                  <span>
                    <b>{`ปี ${y}`}</b>
                    {y === next && <small>ปีถัดไป</small>}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="t-meta" style={{ margin: 0, lineHeight: 1.6 }}>
            คัดลอกมาให้: บริษัท ผู้ติดต่อ เบอร์ อีเมล ผู้รับผิดชอบ ที่มา หมวด และบริการ ไม่คัดลอก: ขั้นตอน เอกสาร ใบเสนอราคา การชำระ แผน หรือผลการขาย
          </p>
          {reason && <p role="alert" className="t-warn" style={{ margin: 0 }}>{reason}</p>}
        </>
      )}
      <DialogActions>
        <button type="button" className="quiet" onClick={close}>ยกเลิก</button>
        <button type="button" className="btn pri" disabled={!!reason || !sel} onClick={go}>{CYCLE_LABEL}</button>
      </DialogActions>
    </Modal>
  );
}
