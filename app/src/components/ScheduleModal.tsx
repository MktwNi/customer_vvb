import { useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useApp } from '../state';
import { TT } from '../lib/constants';
import { addDays, fmtN, nextWork, todayISO } from '../lib/format';
import type { TaskForm, TaskType } from '../lib/types';
import { Opts } from './ui';
import { useDialog } from './useDialog';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: '#475069' };
const ctl: CSSProperties = { height: 40, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14 };

export function ScheduleModal() {
  const { ui } = useApp();
  const o = ui.sched;
  return o ? <ScheduleForm key={o.taskId || o.ids.join(',')} /> : null;
}

function ScheduleForm() {
  const { engine: e, ui, set } = useApp();
  const ref = useRef<HTMLFormElement>(null);
  useDialog(ref); // takes keyboard focus, keeps Tab inside, gives it back on close
  const o = ui.sched!;
  const t = o.taskId ? e.crm.tasks.find((x) => x.id === o.taskId) : undefined;
  // the appointment as the form opened: saving writes only what was changed here, so a teammate's
  // tick or note meanwhile is kept
  const [init] = useState<TaskForm | undefined>(() => t && { type: t.type, date: t.date, time: t.time, note: t.note });
  const c = o.ids.length === 1 ? e.company(o.ids[0]) : undefined;
  const isMulti = !o.taskId && o.ids.length > 1;
  const gone = !!o.taskId && !t; // a teammate deleted it while the form was open
  const cancel = () => set({ sched: null });
  const save = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const g = (k: string) => String(fd.get(k) || '').trim();
    const p = { type: (g('type') || 'call') as TaskType, date: g('date') || todayISO(), time: g('time'), note: g('note') };
    if (o.taskId) {
      if (t) e.updateTask(t.id, p, init); // gone: a teammate deleted it meanwhile, and that stands (see `gone`)
    } else e.addTasks(o.ids, p, +(g('spread') || 0));
    set({ sched: null, picked: {} });
  };

  return (
    <>
      <div onClick={cancel} style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,60,.45)', zIndex: 50 }} />
      <form ref={ref} role="dialog" aria-modal="true" onSubmit={save} style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(480px,94vw)', background: '#fff', borderRadius: 22, padding: 22, zIndex: 51, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 500 }}>{o.taskId ? 'เลื่อน / แก้ไขนัด' : o.ids.length > 1 ? `นัดติดต่อ ${fmtN(o.ids.length)} บริษัท` : 'นัดติดต่อ'}</span>
        <span style={{ fontSize: 13, color: '#475069' }}>{c ? c.name : o.ids.length > 1 ? 'ระบบจะกระจายนัดเฉพาะวันทำการตามจำนวนต่อวันที่เลือก' : ''}</span>
        <label style={field}>
          ประเภท
          <select name="type" defaultValue={init ? init.type : 'call'} style={ctl}><Opts options={TT.map(([v, label]) => ({ v, label }))} /></select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={field}>วันที่<input name="date" type="date" defaultValue={init ? init.date : nextWork(addDays(todayISO(), 1))} style={ctl} /></label>
          <label style={field}>เวลา<input name="time" type="time" defaultValue={init ? init.time : ''} style={ctl} /></label>
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
        <label style={field}>หมายเหตุ<input name="note" defaultValue={init ? init.note : ''} style={ctl} /></label>
        {gone && <span role="alert" style={{ fontSize: 13, color: '#8A2B12' }}>คนในทีมลบนัดนี้ไปแล้วระหว่างที่เปิดอยู่ จึงบันทึกไม่ได้ — กดยกเลิก แล้วเพิ่มนัดใหม่ถ้ายังต้องการ</span>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={cancel} style={{ cursor: 'pointer', height: 40, padding: '0 14px', border: 0, background: 'transparent', color: '#475069', fontSize: 14 }}>ยกเลิก</button>
          <button type="submit" disabled={gone} style={{ cursor: gone ? 'default' : 'pointer', height: 40, padding: '0 18px', borderRadius: 999, border: 0, background: gone ? '#A8B0C8' : '#1F5BD8', color: '#fff', fontSize: 14 }}>บันทึกนัด</button>
        </div>
      </form>
    </>
  );
}
