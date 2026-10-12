import { useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useApp } from '../state';
import { TT } from '../lib/constants';
import { addDays, fmtN, nextWork, todayISO } from '../lib/format';
import type { TaskForm, TaskType } from '../lib/types';
import { DateField, Opts } from './ui';
import { useDialog } from './useDialog';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-2)' };

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
  const [date, setDate] = useState(() => (init ? init.date : nextWork(addDays(todayISO(), 1))));
  const cancel = () => set({ sched: null });
  const save = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const g = (k: string) => String(fd.get(k) || '').trim();
    const p = { type: (g('type') || 'call') as TaskType, date: g('date') || todayISO(), time: g('time'), note: g('note') };
    if (o.taskId) {
      if (t) e.updateTask(t.id, p, init); // gone: a teammate deleted it meanwhile, and that stands (see `gone`)
    } else e.addTasks(o.ids, p, +(g('spread') || 0), o.pid);
    set({ sched: null, picked: {} });
  };

  return (
    <>
      <div onClick={cancel} className="dlg-back" style={{ zIndex: 50 }} />
      <form ref={ref} role="dialog" aria-modal="true" aria-label="นัดติดต่อ" onSubmit={save} className="dlg" style={{ width: 'min(480px,94vw)', zIndex: 51, gap: 12 }}>
        <span className="dlg-t">{o.taskId ? 'เลื่อน / แก้ไขนัด' : o.ids.length > 1 ? `นัดติดต่อ ${fmtN(o.ids.length)} บริษัท` : 'นัดติดต่อ'}</span>
        <span className="t-sec">{c ? c.name + (o.pid && e.people[o.pid] ? ' · กับ ' + e.people[o.pid].name : '') : o.ids.length > 1 ? 'กระจายนัดเฉพาะวันทำการตามจำนวนต่อวันที่เลือก' : ''}</span>
        <label style={field}>
          ประเภท
          <select name="type" defaultValue={init ? init.type : 'call'} className="fld sel"><Opts options={TT.map(([v, label]) => ({ v, label }))} /></select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={field}>วันที่<DateField name="date" value={date} onChange={(v) => v && setDate(v)} /></label>
          <label style={field}>เวลา<input name="time" type="time" defaultValue={init ? init.time : ''} className="fld" /></label>
        </div>
        {isMulti && (
          <label style={field}>
            กระจายนัด
            <select name="spread" defaultValue="5" className="fld sel">
              <option value="0">ทั้งหมดในวันเดียว</option>
              <option value="3">วันละ 3 ราย (วันทำการ)</option>
              <option value="5">วันละ 5 ราย (วันทำการ)</option>
              <option value="10">วันละ 10 ราย (วันทำการ)</option>
            </select>
          </label>
        )}
        <label style={field}>หมายเหตุ<input name="note" defaultValue={init ? init.note : ''} className="fld" /></label>
        {gone && <span role="alert" className="note err">คนในทีมลบนัดนี้ไปแล้วระหว่างที่เปิดอยู่ จึงบันทึกไม่ได้ กดยกเลิก แล้วเพิ่มนัดใหม่ถ้ายังต้องการ</span>}
        <div className="dlg-act">
          <button type="button" onClick={cancel} className="quiet">ยกเลิก</button>
          {!gone && <button type="submit" className="btn pri">บันทึกนัด</button>}
        </div>
      </form>
    </>
  );
}
