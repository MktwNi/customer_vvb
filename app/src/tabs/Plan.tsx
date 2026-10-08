import { useMemo } from 'react';
import { useApp, useEngineVersion } from '../state';
import { FEEDS, STG, TT, stageOf } from '../lib/constants';
import { TH_M, addDays, dow, fmtN, isoTh, telHref, todayISO } from '../lib/format';
import type { Company, FeedKey, StageKey, Task } from '../lib/types';
import { feedLine } from './Track';
import { Opts, PageHead, labelCol } from '../components/ui';
import { Icon } from '../components/icons';
import { CoAvatar } from '../components/CoAvatar';

export function taskInfo(e: ReturnType<typeof useApp>['engine'], t: Task) {
  const today = todayISO();
  const ty = TT.find((x) => x[0] === t.type) || TT[0];
  const c = e.company(t.gid);
  const over = !t.done && t.date < today;
  return {
    title: c ? c.name : t.title,
    meta: [ty[1], t.time, isoTh(t.date), t.pid && e.people[t.pid] ? 'กับ ' + e.people[t.pid].name : '', over ? 'เกินกำหนด' : ''].filter(Boolean).join(' · '),
    color: ty[2],
    tel: c && c.phone ? telHref(c.phone) : '',
    company: c,
    when: `${isoTh(t.date)}${t.time ? ' ' + t.time : ''}`,
  };
}

/** Checkbox-style "done" toggle used in the plan list and the company drawer (the tick is part of the
 *  control). `ro` (an account that can only read): it only shows whether the task is done, and says why
 *  it can't be pressed. */
export function DoneBox({ t, onToggle, ro = false }: { t: Task; onToggle: () => void; ro?: boolean; color?: string; size?: number }) {
  return (
    <button onClick={onToggle} disabled={ro} title={ro ? 'บัญชีนี้ดูข้อมูลได้ แต่แก้ไขไม่ได้' : undefined} aria-label="ทำเสร็จ" aria-pressed={t.done} className={'ckb ' + (t.done ? 'hv-dk on' : 'hv')} style={{ cursor: ro ? 'default' : 'pointer' }}>
      {t.done && <Icon name="check" size={14} />}
    </button>
  );
}

export function Plan() {
  const { engine: e, ui, set, open, openSched } = useApp();
  // an account that can only read sees the plan but makes no appointments
  const ro = !e.can('edit');
  const v = useEngineVersion();
  const C = e.crm, D = e.B.D;
  const today = todayISO();
  const open_ = C.tasks.filter((t) => !t.done);
  const wk = addDays(today, 7);

  const calM = ui.calM || today.slice(0, 7);
  const [y, m] = calM.split('-').map(Number);
  const first = `${calM}-01`;
  const start = addDays(first, -dow(first));
  const selISO = ui.calDay || today;
  const byDay: Record<string, Task[]> = {};
  C.tasks.forEach((t) => (byDay[t.date] || (byDay[t.date] = [])).push(t));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i)).filter((_, i) => i < 35 || addDays(start, 35).slice(0, 7) === calM);
  const dayT = (byDay[selISO] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const plannedBy: Record<number, Task> = {};
  open_.forEach((t) => {
    const g = e.canonical(t.gid);
    if (!plannedBy[g] || t.date < plannedBy[g].date) plannedBy[g] = t;
  });
  const feedAll = useMemo(() => e.feedItems(ui.plFeed || 'cfoSoon'), [e, v, ui.plFeed]);
  let tg: Company[] = feedAll;
  if (ui.plStage) tg = tg.filter((c) => (C.stages[c.id] || 'none') === ui.plStage);
  if (ui.plOwner) tg = tg.filter((c) => (ui.plOwner === '-' ? !C.owners[c.id] : C.owners[c.id] === ui.plOwner));
  const unpl = tg.filter((c) => !plannedBy[c.id]);
  const shown = tg.slice(0, ui.plLim || 60);
  const pk = ui.picked || {};
  const pkIds = Object.keys(pk).map(Number);
  const allOn = shown.length > 0 && shown.every((c) => pk[c.id]);
  const feedKey = ui.plFeed || 'cfoSoon';

  // parts of the open tasks: [label, count, colour class when there are some]
  const segs: [string, number, string][] = [
    ['เกินกำหนด', open_.filter((t) => t.date < today).length, 't-bad'],
    ['วันนี้', open_.filter((t) => t.date === today).length, 't-warn'],
    ['7 วันข้างหน้า', open_.filter((t) => t.date > today && t.date <= wk).length, ''],
    ['หลังจากนั้น', open_.filter((t) => t.date > wk).length, ''],
  ];
  const avOf = (key: string, gid: number, title: string, size = 28) => {
    const c = e.company(gid);
    return <CoAvatar key={key} name={c ? c.name : title} web={c?.web} set={c?.set} size={size} />;
  };
  const upcoming = open_.filter((t) => t.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  const teamOpts = [{ v: '-', label: 'ยังไม่มีผู้รับผิดชอบ' }].concat(C.team.map((v) => ({ v, label: v })));

  return (
    <>
      <PageHead title="แผนติดต่อ" sub={`นัดโทร ส่งอีเมล หรือเข้าพบ ${e.teamCfg ? "แชร์กับทีม" : "บันทึกในเครื่องนี้"}`} />
      <section className="pl-sum card" aria-label="สรุปงานที่นัดไว้">
        <div className="pl-sum-total">
          <span>งานค้างทั้งหมด</span>
          <b>{fmtN(open_.length)}</b>
          <small>{open_.length ? `นัดไว้ ${fmtN(new Set(open_.map((t) => e.canonical(t.gid))).size)} บริษัท` : 'ยังไม่มีนัด · เลือกบริษัทด้านล่างแล้วกด นัด'}</small>
        </div>
        <div className="pl-segs">
          {segs.map(([label, n, cls]) => (
            <div key={label} className="pl-seg">
              <span className="pl-seg-l">{label}</span>
              <span className={'pl-seg-n' + (n ? (cls ? ' ' + cls : '') : ' zero')}>{fmtN(n)}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,520px),1fr))', gap: 16, alignItems: 'start' }}>
        <div className="pl-cal card">
          <div className="pl-cal-head">
            <span className="pl-month">{`${TH_M[m - 1]} ${y + 543}`}</span>
            <div className="pl-nav">
              {calM !== today.slice(0, 7) && <button className="btn xs" onClick={() => set({ calM: today.slice(0, 7), calDay: today })}>วันนี้</button>}
              <button className="btn xs" onClick={() => set({ calM: new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) })}>เดือนก่อน</button>
              <button className="btn xs" onClick={() => set({ calM: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7) })}>เดือนถัดไป</button>
            </div>
          </div>
          <div className="pl-grid">
            {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((w, i) => <span key={w} className={'pl-wd' + (i === 0 || i === 6 ? ' wk' : '')}>{w}</span>)}
            {cells.map((d) => {
              const ts = byDay[d] || [];
              const inM = d.slice(0, 7) === calM, isSel = d === selISO, wkd = dow(d) === 0 || dow(d) === 6;
              const cls = 'pl-cell' + (inM ? '' : ' out') + (wkd ? ' wk' : '') + (d === today ? ' today' : '') + (isSel ? ' sel' : '');
              return (
                <button key={d} className={cls} onClick={() => set({ calDay: d })} aria-pressed={isSel} aria-label={`${isoTh(d)}${d === today ? ' (วันนี้)' : ''} · ${ts.length} งาน`}>
                  <span className="pl-dn">{+d.slice(8)}</span>
                  {ts.length > 0 && <span className="pl-cnt">{fmtN(ts.length)}<span className="pl-cnt-u"> งาน</span></span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pl-day card">
          <div className="pl-day-head">
            <span className="pl-day-dn">{+selISO.slice(8)}</span>
            <span className="pl-day-t">
              <b>{(selISO === today ? 'วันนี้ · ' : '') + ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'][dow(selISO)] + ' ' + isoTh(selISO)}</b>
              <span>{fmtN(dayT.length)} งาน</span>
            </span>
          </div>
          {!dayT.length && <span className="pl-empty">ไม่มีงานในวันนี้ · เลือกวันอื่น หรือกด นัด ที่รายชื่อด้านล่าง</span>}
          {dayT.map((t) => {
            const ti = taskInfo(e, t);
            return (
              <div key={t.id} className="pl-task">
                <DoneBox t={t} onToggle={() => !ro && e.toggleTask(t)} ro={ro} />
                {avOf(t.id, t.gid, t.title, 36)}
                <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <button onClick={() => ti.company && open(ti.company.id)} className="hv-tx" style={{ cursor: 'pointer', border: 0, textAlign: 'left', padding: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink)', textDecoration: t.done ? 'line-through' : 'none' }}>{ti.title}</button>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{ti.meta}</span>
                  {t.note && <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{t.note}</span>}
                </div>
                <div className="pl-task-act">
                  {ti.tel && <a href={ti.tel} className="btn xs">โทร</a>}
                  {!ro && <button onClick={() => openSched({ taskId: t.id, ids: [t.gid] })} className="btn xs">เลื่อน</button>}
                  {!ro && <button onClick={() => e.delTask(t)} className="quiet">ลบ</button>}
                </div>
              </div>
            );
          })}
          <span className="pl-up-h">งานที่กำลังจะถึง</span>
          {!upcoming.length && <span className="pl-empty">ยังไม่มีงานที่กำลังจะถึง</span>}
          {upcoming.map((t) => {
            const ti = taskInfo(e, t);
            return (
              <button key={t.id} className="pl-up hv" onClick={() => set({ calDay: t.date, calM: t.date.slice(0, 7) })} style={{ cursor: 'pointer', border: 0, borderTop: '1px solid var(--divider)', textAlign: 'left', padding: '8px', margin: '0 4px', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14, color: 'var(--ink)' }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>{avOf(t.id, t.gid, t.title, 28)}<span style={{ minWidth: 0 }}>{ti.title}</span></span>
                <span style={{ color: 'var(--ink-2)', fontSize: 13, whiteSpace: 'nowrap' }}>{ti.when}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h3 className="card-t">รายชื่อที่ต้องติดต่อ</h3>
            <span className="t-sec">{`${fmtN(tg.length)} บริษัท · ยังไม่มีนัด ${fmtN(unpl.length)}`}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={labelCol}>รายการ<select value={feedKey} onChange={(ev) => set({ plFeed: ev.target.value as FeedKey, picked: {}, plLim: 60 })} className="fld sel"><Opts options={FEEDS.map(([v, label]) => ({ v, label }))} /></select></label>
            <label style={labelCol}>สถานะการขาย<select value={ui.plStage} onChange={(ev) => set({ plStage: ev.target.value as StageKey | '', picked: {} })} className="fld sel"><Opts all="ทั้งหมด" options={STG.map(([v, label]) => ({ v, label }))} /></select></label>
            <label style={labelCol}>ผู้รับผิดชอบ<select value={ui.plOwner} onChange={(ev) => set({ plOwner: ev.target.value, picked: {} })} className="fld sel"><Opts all="ทั้งหมด" options={teamOpts} /></select></label>
            {!ro && <label style={labelCol}>นัดอัตโนมัติวันละ<select value={String(ui.perDay)} onChange={(ev) => set({ perDay: +ev.target.value })} className="fld sel">{[3, 5, 10, 20].map((n) => <option key={n} value={n}>{n} ราย</option>)}</select></label>}
            {!ro && unpl.length > 0 && (
              <button
                onClick={() => window.confirm(`นัด ${fmtN(unpl.length)} รายที่ยังไม่มีแผน วันละ ${ui.perDay || 5} ราย (วันทำการ)?`) && e.autoPlan(unpl, ui.perDay || 5)}
                className="btn"
              >
                นัดรายที่ยังไม่มีแผน ({fmtN(unpl.length)})
              </button>
            )}
          </div>
        </div>
        {/* picking companies only leads to making appointments or sending them to the tracker */}
        {!ro && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--divider)', paddingTop: 10 }}>
          <button
            onClick={() => {
              const p = { ...pk };
              if (allOn) shown.forEach((c) => delete p[c.id]);
              else shown.forEach((c) => (p[c.id] = 1));
              set({ picked: p });
            }}
            className="lnk"
            style={{ fontSize: 13 }}
          >
            {allOn ? 'ยกเลิกเลือกทั้งหมด' : `เลือก ${fmtN(shown.length)} รายที่แสดง`}
          </button>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>{pkIds.length ? `เลือกแล้ว ${fmtN(pkIds.length)} ราย` : 'เลือกหลายรายเพื่อนัดพร้อมกัน'}</span>
          {pkIds.length > 0 && <button onClick={() => openSched({ ids: pkIds })} className="btn sm pri">นัดที่เลือก {fmtN(pkIds.length)} ราย</button>}
          {pkIds.length > 0 && <button onClick={() => set({ sendIds: pkIds })} className="btn sm">ส่งเข้า Sales Tracker</button>}
        </div>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((c) => {
            const st = stageOf(C.stages[c.id]);
            const ot = plannedBy[c.id];
            const p = !!pk[c.id];
            return (
              <div key={c.id} className="plan-row">
                {ro ? <span /> : (
                  <button
                    onClick={() => {
                      const q = { ...pk };
                      if (q[c.id]) delete q[c.id];
                      else q[c.id] = 1;
                      set({ picked: q });
                    }}
                    aria-label="เลือก" aria-pressed={p}
                    className={'ckb ' + (p ? 'hv-dk on' : 'hv')}
                  >
                    {p && <Icon name="check" size={14} />}
                  </button>
                )}
                <button onClick={() => open(c.id)} className="hv-tx" style={{ cursor: 'pointer', border: 0, textAlign: 'left', padding: 0, display: 'flex', gap: 12, alignItems: 'center', minWidth: 0, color: 'var(--ink)' }}>
                  <CoAvatar name={c.name} web={c.web} set={c.set} size={28} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
                    <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{[D.prov[c.prov], feedLine(D, feedKey, c), C.owners[c.id]].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
                <span style={{ fontSize: 13, color: 'var(--ink-2)', wordBreak: 'break-word' }}>{c.phone || 'ยังไม่มีเบอร์'}</span>
                {/* the stage reads as plain text; it is still a select (a border shows under the pointer) */}
                <select value={st[0]} disabled={ro} onChange={(ev) => e.setStage(c.id, ev.target.value as StageKey)} aria-label="สถานะการขาย" className="fld sel pl-stage">
                  <Opts options={STG.map(([v, label]) => ({ v, label }))} />
                </select>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {ro ? null : ot ? (
                    <button onClick={() => openSched({ taskId: ot.id, ids: [c.id] })} className="lnk" style={{ fontSize: 13 }}>นัดแล้ว {isoTh(ot.date)}</button>
                  ) : (
                    <button onClick={() => openSched({ ids: [c.id] })} className="lnk">นัด</button>
                  )}
                </span>
              </div>
            );
          })}
          {!tg.length && <span className="empty" style={{ padding: '16px 0' }}>ไม่มีรายชื่อในรายการนี้</span>}
          {tg.length > shown.length && <button onClick={() => set({ plLim: (ui.plLim || 60) + 120 })} className="lnk" style={{ alignSelf: 'center', marginTop: 10 }}>{`แสดงเพิ่ม (อีก ${fmtN(tg.length - shown.length)} ราย)`}</button>}
        </div>
      </section>
    </>
  );
}
