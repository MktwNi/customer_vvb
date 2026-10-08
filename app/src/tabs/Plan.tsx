import { useMemo } from 'react';
import { useApp, useEngineVersion } from '../state';
import { FEEDS, STG, TT, stageOf } from '../lib/constants';
import { TH_M, addDays, dow, fmtN, isoTh, telHref, todayISO } from '../lib/format';
import type { Company, FeedKey, StageKey, Task } from '../lib/types';
import { feedMeta } from '../lib/feeds';
import { Opts, PageHead, card, heroGrad, labelCol } from '../components/ui';
import { CoAvatar } from '../components/CoAvatar';

const sel = { height: 40, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14, background: '#fff', color: '#0E1430' } as const;

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

/** Checkbox-style "done" toggle used in the plan list and the company drawer. `ro` (an account that
 *  can only read): it only shows whether the task is done, and says why it can't be pressed. */
export function DoneBox({ t, color, onToggle, size = 13, ro = false }: { t: Task; color: string; onToggle: () => void; size?: number; ro?: boolean }) {
  return (
    <button onClick={onToggle} disabled={ro} title={ro ? 'บัญชีนี้ดูข้อมูลได้ แต่แก้ไขไม่ได้' : undefined} aria-label="ทำเสร็จ" aria-pressed={t.done} style={{ cursor: ro ? 'default' : 'pointer', width: 22, height: 22, flex: 'none', borderRadius: 6, border: `1.5px solid ${color}`, background: t.done ? color : '#fff', color: '#fff', fontSize: size, padding: 0 }}>
      {t.done ? '✓' : ''}
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

  // parts of the open tasks: [label, count, bar colour, text colour]
  const segs: [string, number, string, string][] = [
    ['เกินกำหนด', open_.filter((t) => t.date < today).length, '#A33A1A', '#fff'],
    ['วันนี้', open_.filter((t) => t.date === today).length, '#F2B84B', '#0E1430'],
    ['7 วันข้างหน้า', open_.filter((t) => t.date > today && t.date <= wk).length, '#1F5BD8', '#fff'],
    ['หลังจากนั้น', open_.filter((t) => t.date > wk).length, '#C9D1E6', '#0E1430'],
  ];
  const avOf = (key: string, gid: number, title: string, ring?: string, size = 22) => {
    const c = e.company(gid);
    return <CoAvatar key={key} name={c ? c.name : title} web={c?.web} set={c?.set} size={size} ring={ring} />;
  };
  const upcoming = open_.filter((t) => t.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  const teamOpts = [{ v: '-', label: 'ยังไม่มีผู้รับผิดชอบ' }].concat(C.team.map((v) => ({ v, label: v })));

  return (
    <>
      <PageHead title="แผนติดต่อ" sub={`นัดโทร ส่งอีเมล หรือเข้าพบ ${e.teamCfg ? "แชร์กับทีม" : "บันทึกในเครื่องนี้"}`} />
      <section className="pl-sum" style={card} aria-label="สรุปงานที่นัดไว้">
        <div className="pl-sum-total">
          <span>งานค้างทั้งหมด</span>
          <b>{fmtN(open_.length)}</b>
          <small>{open_.length ? `นัดไว้ ${fmtN(new Set(open_.map((t) => e.canonical(t.gid))).size)} บริษัท` : 'ยังไม่มีนัด · เลือกบริษัทด้านล่างแล้วกด + นัด'}</small>
        </div>
        <div className="pl-segs">
          {segs.map(([label, n, bg, fg]) => (
            <div key={label} className="pl-seg" style={{ flexGrow: Math.max(n, open_.length ? 0.6 : 1) }}>
              <span className="pl-seg-l">{label}</span>
              <span className="pl-seg-bar" style={{ background: n ? bg : undefined, color: n ? fg : undefined }}>{fmtN(n)} งาน</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,520px),1fr))', gap: 16, alignItems: 'start' }}>
        <div className="pl-cal" style={card}>
          <div className="pl-cal-head">
            <span className="pl-month">{`${TH_M[m - 1]} ${y + 543}`}</span>
            <div className="pl-nav">
              {calM !== today.slice(0, 7) && <button className="pl-today" onClick={() => set({ calM: today.slice(0, 7), calDay: today })}>วันนี้</button>}
              <button aria-label="เดือนก่อน" onClick={() => set({ calM: new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) })}>‹</button>
              <button aria-label="เดือนถัดไป" onClick={() => set({ calM: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7) })}>›</button>
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
                  {ts.length > 0 && (
                    <>
                      {/* up to three bubbles: company pictures (ring = task type), the last one "+n" when there are more */}
                      <span className="pl-avs">
                        {ts.slice(0, ts.length > 3 ? 2 : 3).map((t) => avOf(t.id, t.gid, t.title, (TT.find((x) => x[0] === t.type) || TT[0])[2], 18))}
                        {ts.length > 3 && <span className="pl-more">+{ts.length - 2}</span>}
                      </span>
                      <span className="pl-cnt">{fmtN(ts.length)}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="pl-legend">
            {TT.map(([k, label, color]) => <span key={k}><i style={{ borderColor: color }} />{label}</span>)}
            <span className="pl-legend-note">วงรอบรูปบริษัท = ประเภทงาน</span>
          </div>
        </div>

        <div className="pl-day" style={card}>
          <div className="pl-day-head hero" style={{ background: heroGrad }}>
            <span className="pl-day-dn">{+selISO.slice(8)}</span>
            <span className="pl-day-t">
              <b>{selISO === today ? 'วันนี้' : ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'][dow(selISO)]}</b>
              <span>{isoTh(selISO)}</span>
            </span>
            <span className="pl-day-n">{fmtN(dayT.length)} งาน</span>
          </div>
          {!dayT.length && <span className="pl-empty">ไม่มีงานในวันนี้ · เลือกวันอื่นในปฏิทิน หรือกด + นัด ที่รายชื่อด้านล่าง</span>}
          {dayT.map((t) => {
            const ti = taskInfo(e, t);
            return (
              <div key={t.id} className="pl-task">
                <DoneBox t={t} color={ti.color} onToggle={() => !ro && e.toggleTask(t)} ro={ro} />
                {avOf(t.id, t.gid, t.title, ti.color, 40)}
                <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <button onClick={() => ti.company && open(ti.company.id)} style={{ cursor: 'pointer', border: 0, background: 'transparent', textAlign: 'left', padding: 0, fontSize: 14, fontWeight: 500, color: '#0E1430', textDecoration: t.done ? 'line-through' : 'none' }}>{ti.title}</button>
                  <span style={{ fontSize: 12.5, color: '#475069' }}>{ti.meta}</span>
                  {t.note && <span style={{ fontSize: 12.5, color: '#384155' }}>{t.note}</span>}
                </div>
                <div className="pl-task-act">
                  {ti.tel && <a href={ti.tel} style={{ fontSize: 12.5, textDecoration: 'none', border: '1.5px solid #D5DBEA', borderRadius: 999, padding: '4px 10px' }}>โทร</a>}
                  {!ro && <button onClick={() => openSched({ taskId: t.id, ids: [t.gid] })} style={{ cursor: 'pointer', border: '1.5px solid #D5DBEA', background: '#fff', borderRadius: 999, padding: '4px 10px', fontSize: 12.5 }}>เลื่อน</button>}
                  {!ro && <button onClick={() => e.delTask(t)} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#A33A1A', fontSize: 12.5 }}>ลบ</button>}
                </div>
              </div>
            );
          })}
          <span className="pl-up-h">งานที่กำลังจะถึง</span>
          {!upcoming.length && <span className="pl-empty">ยังไม่มีงานที่กำลังจะถึง</span>}
          {upcoming.map((t) => {
            const ti = taskInfo(e, t);
            return (
              <button key={t.id} className="pl-up" onClick={() => set({ calDay: t.date, calM: t.date.slice(0, 7) })} style={{ cursor: 'pointer', border: 0, borderTop: '1px solid #EEF1F8', background: 'transparent', textAlign: 'left', padding: '8px 0', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, color: '#0E1430' }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>{avOf(t.id, t.gid, t.title, ti.color, 30)}<span style={{ minWidth: 0 }}>{ti.title}</span></span>
                <span style={{ color: '#475069', whiteSpace: 'nowrap' }}>{ti.when}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>รายชื่อที่ต้องติดต่อ</span>
            <span style={{ fontSize: 13, color: '#475069', fontWeight: 300 }}>{`${fmtN(tg.length)} บริษัท · ยังไม่มีนัด ${fmtN(unpl.length)}`}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={labelCol}>รายการ<select value={feedKey} onChange={(ev) => set({ plFeed: ev.target.value as FeedKey, picked: {}, plLim: 60 })} style={sel}><Opts options={FEEDS.map(([v, label]) => ({ v, label }))} /></select></label>
            <label style={labelCol}>สถานะการขาย<select value={ui.plStage} onChange={(ev) => set({ plStage: ev.target.value as StageKey | '', picked: {} })} style={sel}><Opts all="ทั้งหมด" options={STG.map(([v, label]) => ({ v, label }))} /></select></label>
            <label style={labelCol}>ผู้รับผิดชอบ<select value={ui.plOwner} onChange={(ev) => set({ plOwner: ev.target.value, picked: {} })} style={sel}><Opts all="ทั้งหมด" options={teamOpts} /></select></label>
            {!ro && <label style={labelCol}>นัดอัตโนมัติวันละ<select value={String(ui.perDay)} onChange={(ev) => set({ perDay: +ev.target.value })} style={sel}>{[3, 5, 10, 20].map((n) => <option key={n} value={n}>{n} ราย</option>)}</select></label>}
            {!ro && <button onClick={() => unpl.length && e.autoPlan(unpl, ui.perDay || 5)} style={{ cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13.5 }}>นัดรายที่ยังไม่มีแผน ({fmtN(unpl.length)})</button>}
          </div>
        </div>
        {/* picking companies only leads to making appointments or sending them to the tracker */}
        {!ro && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#F6F8FE', borderRadius: 12, padding: '8px 12px' }}>
          <button
            onClick={() => {
              const p = { ...pk };
              if (allOn) shown.forEach((c) => delete p[c.id]);
              else shown.forEach((c) => (p[c.id] = 1));
              set({ picked: p });
            }}
            style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#1F5BD8', fontSize: 13, textDecoration: 'underline' }}
          >
            {allOn ? 'ยกเลิกเลือกทั้งหมด' : `เลือก ${fmtN(shown.length)} รายที่แสดง`}
          </button>
          <span style={{ fontSize: 13, color: '#475069', flex: 1 }}>{pkIds.length ? `เลือกแล้ว ${fmtN(pkIds.length)} ราย` : 'ติ๊กช่องหน้าชื่อเพื่อนัดหลายรายพร้อมกัน'}</span>
          {pkIds.length > 0 && <button onClick={() => openSched({ ids: pkIds })} style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13 }}>นัดที่เลือก {fmtN(pkIds.length)} ราย</button>}
          {pkIds.length > 0 && <button onClick={() => set({ sendIds: pkIds })} style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: '1.5px solid #1F5BD8', background: '#fff', color: '#1F5BD8', fontSize: 13 }}>ส่งเข้า Sales Tracker</button>}
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
                    style={{ cursor: 'pointer', width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${p ? '#1F5BD8' : '#C9D1E6'}`, background: p ? '#1F5BD8' : '#fff', color: '#fff', fontSize: 12, padding: 0 }}
                  >
                    {p ? '✓' : ''}
                  </button>
                )}
                <button onClick={() => open(c.id)} style={{ cursor: 'pointer', border: 0, background: 'transparent', textAlign: 'left', padding: 0, display: 'flex', gap: 12, alignItems: 'center', minWidth: 0, color: '#0E1430' }}>
                  <CoAvatar name={c.name} web={c.web} set={c.set} size={38} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: '#475069' }}>{[D.prov[c.prov], feedMeta(D, feedKey, c), C.owners[c.id]].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
                <span style={{ fontSize: 12.5, color: '#384155', wordBreak: 'break-word' }}>{c.phone || 'ยังไม่มีเบอร์'}</span>
                <select value={st[0]} disabled={ro} onChange={(ev) => e.setStage(c.id, ev.target.value as StageKey)} aria-label="สถานะการขาย" style={{ height: 32, borderRadius: 999, border: 0, padding: '0 10px', fontSize: 12.5, background: st[2], color: st[3] }}>
                  <Opts options={STG.map(([v, label]) => ({ v, label }))} />
                </select>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {ro ? null : ot ? (
                    <button onClick={() => openSched({ taskId: ot.id, ids: [c.id] })} style={{ cursor: 'pointer', border: 0, fontSize: 12, padding: '5px 10px', borderRadius: 999, background: '#E6ECFD', color: '#1745B8' }}>นัดแล้ว {isoTh(ot.date)}</button>
                  ) : (
                    <button onClick={() => openSched({ ids: [c.id] })} style={{ cursor: 'pointer', border: '1.5px solid #1F5BD8', background: '#fff', color: '#1F5BD8', fontSize: 12.5, padding: '5px 12px', borderRadius: 999 }}>+ นัด</button>
                  )}
                </span>
              </div>
            );
          })}
          {!tg.length && <span style={{ fontSize: 13.5, color: '#475069', padding: '16px 0' }}>ไม่มีรายชื่อในรายการนี้</span>}
          {tg.length > shown.length && <button onClick={() => set({ plLim: (ui.plLim || 60) + 120 })} style={{ cursor: 'pointer', alignSelf: 'center', marginTop: 10, border: 0, background: 'transparent', color: '#1F5BD8', fontSize: 13.5, textDecoration: 'underline' }}>{`แสดงเพิ่ม (อีก ${fmtN(tg.length - shown.length)} ราย)`}</button>}
        </div>
      </section>
    </>
  );
}
