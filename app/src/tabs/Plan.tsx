import { useMemo } from 'react';
import { useApp, useEngineVersion } from '../state';
import { FEEDS, STG, TT, stageOf } from '../lib/constants';
import { TH_M, addDays, dow, fmtN, isoTh, telHref, todayISO } from '../lib/format';
import type { Company, FeedKey, StageKey, Task } from '../lib/types';
import { feedMeta } from '../lib/feeds';
import { Opts, PageHead, card, labelCol } from '../components/ui';

const sel = { height: 40, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14, background: '#fff', color: '#0E1430' } as const;

export function taskInfo(e: ReturnType<typeof useApp>['engine'], t: Task) {
  const today = todayISO();
  const ty = TT.find((x) => x[0] === t.type) || TT[0];
  const c = e.company(t.gid);
  const over = !t.done && t.date < today;
  return {
    title: c ? c.name : t.title,
    meta: [ty[1], t.time, isoTh(t.date), over ? 'เกินกำหนด' : ''].filter(Boolean).join(' · '),
    color: ty[2],
    tel: c && c.phone ? telHref(c.phone) : '',
    company: c,
    when: `${isoTh(t.date)}${t.time ? ' ' + t.time : ''}`,
  };
}

/** Checkbox-style "done" toggle used in the plan list and the company drawer. */
export function DoneBox({ t, color, onToggle, size = 13 }: { t: Task; color: string; onToggle: () => void; size?: number }) {
  return (
    <button onClick={onToggle} aria-label="ทำเสร็จ" aria-pressed={t.done} style={{ cursor: 'pointer', width: 22, height: 22, flex: 'none', borderRadius: 6, border: `1.5px solid ${color}`, background: t.done ? color : '#fff', color: '#fff', fontSize: size, padding: 0 }}>
      {t.done ? '✓' : ''}
    </button>
  );
}

export function Plan() {
  const { engine: e, ui, set, open, openSched } = useApp();
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

  const kpis: [string, number, string][] = [
    ['งานเกินกำหนด', open_.filter((t) => t.date < today).length, '#A33A1A'],
    ['งานวันนี้', open_.filter((t) => t.date === today).length, '#E8A23B'],
    ['7 วันข้างหน้า', open_.filter((t) => t.date > today && t.date <= wk).length, '#1A3FE0'],
    ['งานค้างทั้งหมด', open_.length, '#7C93FF'],
  ];
  const upcoming = open_.filter((t) => t.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  const teamOpts = [{ v: '-', label: 'ยังไม่มีผู้รับผิดชอบ' }].concat(C.team.map((v) => ({ v, label: v })));

  return (
    <>
      <PageHead title="แผนติดต่อ" sub={`นัดโทร ส่งอีเมล หรือเข้าพบ ${e.teamCfg ? "แชร์กับทีม" : "บันทึกในเครื่องนี้"}`} />
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
        {kpis.map(([label, n, dot]) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 18, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#475069' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />{label}</span>
            <span style={{ fontSize: 28, fontWeight: 500 }}>{fmtN(n)}</span>
          </div>
        ))}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,520px),1fr))', gap: 16, alignItems: 'start' }}>
        <div style={{ ...card, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button aria-label="เดือนก่อน" onClick={() => set({ calM: new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) })} style={{ cursor: 'pointer', width: 36, height: 36, borderRadius: '50%', border: '1.5px solid #D5DBEA', background: '#fff', fontSize: 16 }}>‹</button>
            <span style={{ fontSize: 17, fontWeight: 500 }}>{`${TH_M[m - 1]} ${y + 543}`}</span>
            <button aria-label="เดือนถัดไป" onClick={() => set({ calM: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7) })} style={{ cursor: 'pointer', width: 36, height: 36, borderRadius: '50%', border: '1.5px solid #D5DBEA', background: '#fff', fontSize: 16 }}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 4 }}>
            {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((w) => <span key={w} style={{ textAlign: 'center', fontSize: 12, color: '#475069', padding: '4px 0' }}>{w}</span>)}
            {cells.map((d) => {
              const ts = byDay[d] || [];
              const inM = d.slice(0, 7) === calM, isSel = d === selISO;
              return (
                <button key={d} onClick={() => set({ calDay: d })} aria-label={`${isoTh(d)} · ${ts.length} งาน`} style={{ cursor: 'pointer', minHeight: 62, borderRadius: 12, border: `1.5px solid ${isSel ? '#0A1A86' : d === today ? '#7C93FF' : '#EEF1F8'}`, background: isSel ? '#EEF2FF' : '#fff', color: '#0E1430', padding: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', opacity: inM ? 1 : 0.4 }}>
                  <span style={{ fontSize: 13, fontWeight: d === today ? 600 : 400 }}>{+d.slice(8)}</span>
                  <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {ts.slice(0, 6).map((t) => <span key={t.id} style={{ width: 7, height: 7, borderRadius: '50%', background: (TT.find((x) => x[0] === t.type) || TT[0])[2] }} />)}
                  </span>
                  {ts.length > 6 && <span style={{ fontSize: 10.5, color: '#475069' }}>+{ts.length - 6}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {TT.map(([k, label, color]) => <span key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#475069' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />{label}</span>)}
          </div>
        </div>

        <div style={{ ...card, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <span style={{ fontSize: 17, fontWeight: 500 }}>{selISO === today ? `วันนี้ · ${isoTh(selISO)}` : isoTh(selISO)}</span>
            <span style={{ fontSize: 12.5, color: '#475069' }}>{fmtN(dayT.length)} งาน</span>
          </div>
          {!dayT.length && <span style={{ fontSize: 13.5, color: '#475069' }}>ไม่มีงานในวันนี้</span>}
          {dayT.map((t) => {
            const ti = taskInfo(e, t);
            return (
              <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderTop: '1px solid #EEF1F8', paddingTop: 10 }}>
                <DoneBox t={t} color={ti.color} onToggle={() => e.toggleTask(t)} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <button onClick={() => ti.company && open(ti.company.id)} style={{ cursor: 'pointer', border: 0, background: 'transparent', textAlign: 'left', padding: 0, fontSize: 14, fontWeight: 500, color: '#0E1430', textDecoration: t.done ? 'line-through' : 'none' }}>{ti.title}</button>
                  <span style={{ fontSize: 12.5, color: '#475069' }}>{ti.meta}</span>
                  {t.note && <span style={{ fontSize: 12.5, color: '#384155' }}>{t.note}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                  {ti.tel && <a href={ti.tel} style={{ fontSize: 12.5, textDecoration: 'none', border: '1.5px solid #D5DBEA', borderRadius: 999, padding: '4px 10px' }}>โทร</a>}
                  <button onClick={() => openSched({ taskId: t.id, ids: [t.gid] })} style={{ cursor: 'pointer', border: '1.5px solid #D5DBEA', background: '#fff', borderRadius: 999, padding: '4px 10px', fontSize: 12.5 }}>เลื่อน</button>
                  <button onClick={() => e.delTask(t)} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#A33A1A', fontSize: 12.5 }}>ลบ</button>
                </div>
              </div>
            );
          })}
          <span style={{ fontSize: 14, fontWeight: 500, paddingTop: 8 }}>งานที่กำลังจะถึง</span>
          {upcoming.map((t) => {
            const ti = taskInfo(e, t);
            return (
              <button key={t.id} onClick={() => set({ calDay: t.date, calM: t.date.slice(0, 7) })} style={{ cursor: 'pointer', border: 0, borderTop: '1px solid #EEF1F8', background: 'transparent', textAlign: 'left', padding: '8px 0', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, color: '#0E1430' }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: ti.color, flex: 'none' }} />{ti.title}</span>
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
            <label style={labelCol}>นัดอัตโนมัติวันละ<select value={String(ui.perDay)} onChange={(ev) => set({ perDay: +ev.target.value })} style={sel}>{[3, 5, 10, 20].map((n) => <option key={n} value={n}>{n} ราย</option>)}</select></label>
            <button onClick={() => unpl.length && e.autoPlan(unpl, ui.perDay || 5)} style={{ cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#0A1A86', color: '#fff', fontSize: 13.5 }}>นัดรายที่ยังไม่มีแผน ({fmtN(unpl.length)})</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#F4F6FC', borderRadius: 12, padding: '8px 12px' }}>
          <button
            onClick={() => {
              const p = { ...pk };
              if (allOn) shown.forEach((c) => delete p[c.id]);
              else shown.forEach((c) => (p[c.id] = 1));
              set({ picked: p });
            }}
            style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#1A3FE0', fontSize: 13, textDecoration: 'underline' }}
          >
            {allOn ? 'ยกเลิกเลือกทั้งหมด' : `เลือก ${fmtN(shown.length)} รายที่แสดง`}
          </button>
          <span style={{ fontSize: 13, color: '#475069', flex: 1 }}>{pkIds.length ? `เลือกแล้ว ${fmtN(pkIds.length)} ราย` : 'ติ๊กช่องหน้าชื่อเพื่อนัดหลายรายพร้อมกัน'}</span>
          {pkIds.length > 0 && <button onClick={() => openSched({ ids: pkIds })} style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: 0, background: '#1A3FE0', color: '#fff', fontSize: 13 }}>นัดที่เลือก {fmtN(pkIds.length)} ราย</button>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((c) => {
            const st = stageOf(C.stages[c.id]);
            const ot = plannedBy[c.id];
            const p = !!pk[c.id];
            return (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,2fr) minmax(0,1fr) 150px 150px', gap: 12, alignItems: 'center', padding: '9px 0', borderTop: '1px solid #EEF1F8' }}>
                <button
                  onClick={() => {
                    const q = { ...pk };
                    if (q[c.id]) delete q[c.id];
                    else q[c.id] = 1;
                    set({ picked: q });
                  }}
                  aria-label="เลือก" aria-pressed={p}
                  style={{ cursor: 'pointer', width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${p ? '#1A3FE0' : '#C9D1E6'}`, background: p ? '#1A3FE0' : '#fff', color: '#fff', fontSize: 12, padding: 0 }}
                >
                  {p ? '✓' : ''}
                </button>
                <button onClick={() => open(c.id)} style={{ cursor: 'pointer', border: 0, background: 'transparent', textAlign: 'left', padding: 0, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, color: '#0E1430' }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: '#475069' }}>{[D.prov[c.prov], feedMeta(D, feedKey, c), C.owners[c.id]].filter(Boolean).join(' · ')}</span>
                </button>
                <span style={{ fontSize: 12.5, color: '#384155', wordBreak: 'break-word' }}>{c.phone || 'ยังไม่มีเบอร์'}</span>
                <select value={st[0]} onChange={(ev) => e.setStage(c.id, ev.target.value as StageKey)} aria-label="สถานะการขาย" style={{ height: 32, borderRadius: 999, border: 0, padding: '0 10px', fontSize: 12.5, background: st[2], color: st[3] }}>
                  <Opts options={STG.map(([v, label]) => ({ v, label }))} />
                </select>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {ot ? (
                    <button onClick={() => openSched({ taskId: ot.id, ids: [c.id] })} style={{ cursor: 'pointer', border: 0, fontSize: 12, padding: '5px 10px', borderRadius: 999, background: '#E6ECFD', color: '#1A2FB0' }}>นัดแล้ว {isoTh(ot.date)}</button>
                  ) : (
                    <button onClick={() => openSched({ ids: [c.id] })} style={{ cursor: 'pointer', border: '1.5px solid #0A1A86', background: '#fff', color: '#0A1A86', fontSize: 12.5, padding: '5px 12px', borderRadius: 999 }}>+ นัด</button>
                  )}
                </span>
              </div>
            );
          })}
          {!tg.length && <span style={{ fontSize: 13.5, color: '#475069', padding: '16px 0' }}>ไม่มีรายชื่อในรายการนี้</span>}
          {tg.length > shown.length && <button onClick={() => set({ plLim: (ui.plLim || 60) + 120 })} style={{ cursor: 'pointer', alignSelf: 'center', marginTop: 10, border: 0, background: 'transparent', color: '#1A3FE0', fontSize: 13.5, textDecoration: 'underline' }}>{`แสดงเพิ่ม (อีก ${fmtN(tg.length - shown.length)} ราย)`}</button>}
        </div>
      </section>
    </>
  );
}
