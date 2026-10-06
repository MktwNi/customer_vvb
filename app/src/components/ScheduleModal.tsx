import type { CSSProperties, FormEvent } from 'react';
import { useApp } from '../state';
import { TT } from '../lib/constants';
import { addDays, fmtN, nextWork, todayISO } from '../lib/format';
import type { TaskType } from '../lib/types';
import { Opts } from './ui';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: '#475069' };
const ctl: CSSProperties = { height: 40, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14 };

export function ScheduleModal() {
  const { engine: e, ui, set } = useApp();
  const o = ui.sched;
  if (!o) return null;
  const t = o.taskId ? e.crm.tasks.find((x) => x.id === o.taskId) : undefined;
  const c = o.ids.length === 1 ? e.company(o.ids[0]) : undefined;
  const isMulti = !t && o.ids.length > 1;
  const cancel = () => set({ sched: null });
  const save = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const g = (k: string) => String(fd.get(k) || '').trim();
    const p = { type: (g('type') || 'call') as TaskType, date: g('date') || todayISO(), time: g('time'), note: g('note') };
    if (t) e.updateTask(t.id, p);
    else e.addTasks(o.ids, p, +(g('spread') || 0));
    set({ sched: null, picked: {} });
  };

  return (
    <>
      <div onClick={cancel} style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,60,.45)', zIndex: 50 }} />
      <form role="dialog" aria-modal="true" onSubmit={save} style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(480px,94vw)', background: '#fff', borderRadius: 22, padding: 22, zIndex: 51, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 500 }}>{t ? 'เลื่อน / แก้ไขนัด' : o.ids.length > 1 ? `นัดติดต่อ ${fmtN(o.ids.length)} บริษัท` : 'นัดติดต่อ'}</span>
        <span style={{ fontSize: 13, color: '#475069' }}>{c ? c.name : o.ids.length > 1 ? 'ระบบจะกระจายนัดเฉพาะวันทำการตามจำนวนต่อวันที่เลือก' : ''}</span>
        <label style={field}>
          ประเภท
          <select name="type" defaultValue={t ? t.type : 'call'} style={ctl}><Opts options={TT.map(([v, label]) => ({ v, label }))} /></select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={field}>วันที่<input name="date" type="date" defaultValue={t ? t.date : nextWork(addDays(todayISO(), 1))} style={ctl} /></label>
          <label style={field}>เวลา<input name="time" type="time" defaultValue={t ? t.time : ''} style={ctl} /></label>
        </div>
        {isMulti && (
          <label style={field}>
            กระจายนัด
            <select name="spread" defaultValue="5" style={ctl}>
              <option value="0">ทั้งหมดในวันเดียว</option>
              <option value="3">วันละ 3 ราย (วันทำการ)</option>
              <option value="5">วันละ 5 ราย (วันทำการ)</option>
              <option value="10">วันละ 10 ราย (วันทำการ)</option>
            </select>
          </label>
        )}
        <label style={field}>หมายเหตุ<input name="note" defaultValue={t ? t.note : ''} style={ctl} /></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={cancel} style={{ cursor: 'pointer', height: 40, padding: '0 14px', border: 0, background: 'transparent', color: '#475069', fontSize: 14 }}>ยกเลิก</button>
          <button type="submit" style={{ cursor: 'pointer', height: 40, padding: '0 18px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 14 }}>บันทึกนัด</button>
        </div>
      </form>
    </>
  );
}
