import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useApp } from '../state';
import { TT } from '../lib/constants';
import { addDays, fmtN, isoTh, nextWork, todayISO } from '../lib/format';
import type { TaskForm, TaskType } from '../lib/types';
import { BIG, localWord, noTimeWord, planNote, planWarn, spread as spreadOf, timedOk } from '../lib/bulk';
import { pageOk } from './Sidebar';
import { DateField, Notice } from './ui';
import { Modal } from './Dialog';
import { SelField } from './Select';
import { useSalesActs } from './SalesToast';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-2)' };

export function ScheduleModal() {
  const { ui } = useApp();
  const o = ui.sched;
  return o ? <ScheduleForm key={o.taskId || o.ids.join(',')} /> : null;
}

function ScheduleForm() {
  const { engine: e, ui, set } = useApp();
  const o = ui.sched!;
  const t = o.taskId ? e.crm.tasks.find((x) => x.id === o.taskId) : undefined;
  // the appointment as the form opened: saving writes only what was changed here, so a teammate's
  // tick or note meanwhile is kept
  const [init] = useState<TaskForm | undefined>(() => t && { type: t.type, date: t.date, time: t.time, note: t.note });
  const c = o.ids.length === 1 ? e.company(o.ids[0]) : undefined;
  const isMulti = !o.taskId && o.ids.length > 1;
  const gone = !!o.taskId && !t; // a teammate deleted it while the form was open
  const [date, setDate] = useState(() => (init ? init.date : nextWork(addDays(todayISO(), 1))));
  const [perDay, setPerDay] = useState('5');
  const { say } = useSalesActs();
  // several companies: those with an appointment not done yet can be left out (on by default)
  const planned = useMemo(() => {
    if (!isMulti) return new Set<number>();
    const open = new Set(e.crm.tasks.filter((x) => !x.done).map((x) => e.canonical(x.gid)));
    return new Set(o.ids.filter((id) => open.has(e.canonical(id))));
  }, [e, isMulti, o.ids]);
  const [skip, setSkip] = useState(true);
  const ids = isMulti && skip && planned.size ? o.ids.filter((id) => !planned.has(id)) : o.ids;
  const sp = isMulti ? spreadOf(date, ids.length, +perDay) : null;
  const team = !!e.teamCfg;
  // several at once keep a เวลา only while a day has a few: each timed appointment mails a reminder an hour
  // before to everyone who chose reminders, and hundreds at one time would use up the team's daily mails
  const [time, setTime] = useState(() => (init ? init.time : ''));
  const timeOn = !isMulti || timedOk(ids.length, +perDay);
  const cancel = () => set({ sched: null });
  const save = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const g = (k: string) => String(fd.get(k) || '').trim();
    const p = { type: (g('type') || 'call') as TaskType, date: g('date') || todayISO(), time: timeOn ? g('time') : '', note: g('note') };
    if (o.taskId) {
      if (t) e.updateTask(t.id, p, init); // gone: a teammate deleted it meanwhile, and that stands (see `gone`)
    } else if (ids.length) {
      const r = e.addTasks(ids, p, isMulti ? +perDay : 0, o.pid);
      // from the search page's selection: say what was made and where to see it
      if (o.stay && r.n) say(planNote(r.n, r.first, r.last) + (ids.length < o.ids.length ? ` (ข้าม ${fmtN(o.ids.length - ids.length)} บริษัทที่มีนัดอยู่แล้ว)` : '') + localWord(r.local), { ms: 8000, acts: pageOk(e, 'plan') ? [{ label: 'ดูแผนติดต่อ', act: 'goPlan', day: r.first, primary: true }] : undefined });
    }
    set({ sched: null, picked: {} });
  };

  // the shared dialog (title row with its ×, keyboard focus kept inside, given back on close)
  return (
    <Modal title={o.taskId ? 'เลื่อน / แก้ไขนัด' : o.ids.length > 1 ? `นัดติดต่อ ${fmtN(o.ids.length)} บริษัท` : 'นัดติดต่อ'} onClose={cancel} width={480}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="t-sec">{c ? c.name + (o.pid && e.people[o.pid] ? ' · กับ ' + e.people[o.pid].name : '') : o.ids.length > 1 ? 'กระจายนัดเฉพาะวันทำการตามจำนวนต่อวันที่เลือก' : ''}</span>
        <SelField style={field} text="ประเภท" name="type" defaultValue={init ? init.type : 'call'} options={TT.map(([v, label]) => ({ v, label }))} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={field}>วันที่<DateField name="date" value={date} onChange={(v) => v && setDate(v)} /></label>
          <label style={field}>เวลา<input name="time" type="time" value={timeOn ? time : ''} onChange={(ev) => setTime(ev.target.value)} disabled={!timeOn} aria-describedby={timeOn ? undefined : 'sched-notime'} className="fld" /></label>
        </div>
        {isMulti && (
          <SelField
            style={field}
            text="กระจายนัด"
            value={perDay}
            onChange={setPerDay}
            options={[{ v: '0', label: 'ทั้งหมดในวันเดียว' }, { v: '3', label: 'วันละ 3 ราย (วันทำการ)' }, { v: '5', label: 'วันละ 5 ราย (วันทำการ)' }, { v: '10', label: 'วันละ 10 ราย (วันทำการ)' }, { v: '20', label: 'วันละ 20 ราย (วันทำการ)' }]}
          />
        )}
        {!timeOn && <span id="sched-notime" className="t-meta">{noTimeWord(team)}</span>}
        {isMulti && planned.size > 0 && (
          <label className="hv" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, cursor: 'pointer', padding: '4px 2px', borderRadius: 8 }}>
            <input type="checkbox" checked={skip} onChange={(ev) => setSkip(ev.target.checked)} style={{ accentColor: 'var(--brand)' }} />
            {`ข้าม ${fmtN(planned.size)} บริษัทที่มีนัดที่ยังไม่ทำอยู่แล้ว`}
          </label>
        )}
        {/* the spread before saving: how many, until when (thousands at 5 a day run for months) */}
        {sp && ids.length > 0 && (
          <span className="t-meta">
            {`จะนัด ${fmtN(ids.length)} บริษัท ` + (sp.first === sp.last ? `วันที่ ${isoTh(sp.first)}` : `${isoTh(sp.first)} ถึง ${isoTh(sp.last)} (${fmtN(sp.days)} วันทำการ)`)}
          </span>
        )}
        {isMulti && ids.length > BIG && <Notice kind="warn">{planWarn(ids.length, team)}</Notice>}
        {isMulti && !ids.length && <Notice kind="info">ทุกบริษัทที่เลือกมีนัดอยู่แล้ว</Notice>}
        <label style={field}>หมายเหตุ<input name="note" defaultValue={init ? init.note : ''} className="fld" /></label>
        {gone && <span role="alert" className="note err">คนในทีมลบนัดนี้ไปแล้วระหว่างที่เปิดอยู่ จึงบันทึกไม่ได้ กดยกเลิก แล้วเพิ่มนัดใหม่ถ้ายังต้องการ</span>}
        <div className="dlg-act">
          <button type="button" onClick={cancel} className="quiet">ยกเลิก</button>
          {!gone && !(isMulti && !ids.length) && <button type="submit" className="btn pri">{isMulti ? `บันทึก ${fmtN(ids.length)} นัด` : 'บันทึกนัด'}</button>}
        </div>
      </form>
    </Modal>
  );
}
