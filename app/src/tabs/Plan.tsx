import { useMemo } from 'react';
import { useApp, useEngineVersion } from '../state';
import { FEEDS, STG, TT, stageOf } from '../lib/constants';
import { TH_M, addDays, daysBetween, dow, fmtN, isoTh, telHref, todayISO } from '../lib/format';
import { fmtMoney, type Deal, type LineView } from '../lib/sales';
import { shortName } from '../lib/salesUi';
import { ccVars, custKey, dealKey } from '../lib/custColor';
import { activeCust, cellDots, cellLabel, cellLines, chipName, monthCustomers, onlyCust } from '../lib/planCal';
import type { Company, FeedKey, StageKey, Task } from '../lib/types';
import { feedLine } from './Track';
import { PageHead } from '../components/ui';
import { FilterBar } from '../components/FilterBar';
import { Select } from '../components/Select';
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

/** An appointment with its customer: the key (colour, legend, filter), the full name and the short one. */
interface TaskK { t: Task; ck: string; full: string; name: string; date: string }
/** An installment still to be received, with its deal's customer. */
interface PayK { deal: Deal; line: LineView; ck: string }
/** One line of a day cell: an installment or an appointment. */
type CellEntry = { p: PayK; x?: undefined } | { x: TaskK; p?: undefined };

export function Plan() {
  const { engine: e, ui, set, open, openSched } = useApp();
  // an account without นัดหมาย sees the plan but makes no appointments
  const ro = !e.can('edit.task');
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
  // every appointment with its customer (lib/custColor.ts: one key, so one colour on every page)
  const tasksK: TaskK[] = C.tasks.map((t) => {
    const c = e.company(t.gid), full = c ? c.name : t.title;
    return { t, ck: custKey(e, t.gid, t.title), full, name: shortName(full), date: t.date };
  });
  // installments of won deals still to be received (the payment plan): read-only entries, never stored
  const pays = e.payDue('', '9999-12-31');
  const paysK: PayK[] = pays.map((x) => ({ ...x, ck: dealKey(e, x.deal) }));
  // the customer pressed in the legend (this session only), while it still has an entry
  const only = activeCust(ui.plCust, [...tasksK, ...paysK].map((x) => x.ck));
  const onlyName = only ? tasksK.find((x) => x.ck === only)?.name || shortName(paysK.find((x) => x.ck === only)?.deal.client || '') : '';
  const byDay: Record<string, TaskK[]> = {};
  onlyCust(tasksK, only).forEach((x) => (byDay[x.date] || (byDay[x.date] = [])).push(x));
  // untimed first, then by time (the day list's order)
  Object.values(byDay).forEach((l) => l.sort((a, b) => (a.t.time || '').localeCompare(b.t.time || '')));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i)).filter((_, i) => i < 35 || addDays(start, 35).slice(0, 7) === calM);
  const dayT = byDay[selISO] || [];
  const payBy: Record<string, PayK[]> = {};
  onlyCust(paysK, only).forEach((x) => (payBy[x.line.due] || (payBy[x.line.due] = [])).push(x));
  const dayP = payBy[selISO] || [];
  const legend = monthCustomers(tasksK, calM);

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
    // installments late or due within 7 days
    ['รับเงิน', pays.filter((x) => x.line.due <= wk).length, 't-warn'],
  ];
  const avOf = (key: string, gid: number, title: string, size = 28) => {
    const c = e.company(gid);
    return <CoAvatar key={key} name={c ? c.name : title} web={c?.web} set={c?.set} size={size} />;
  };
  const upcoming = onlyCust(tasksK, only).filter((x) => !x.t.done && x.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.t.time || '').localeCompare(b.t.time || '')).slice(0, 8);
  const upPays = onlyCust(paysK, only).filter((x) => x.line.due >= today).slice(0, 4);
  /** "รับชำระ PAY2 · กรีนวัลเลย์ ฟู้ดส์ · 53,500 บาท": opens the deal (the receipt is recorded there). */
  const payItem = (x: { deal: Deal; line: LineView }, when?: boolean) => (
    <button key={x.deal.id + x.line.stage} className={'pl-pay hv' + (when ? ' up' : '') + (x.line.lateDays ? ' late' : '')} onClick={() => set({ deal: x.deal.id })}>
      <span>รับชำระ {x.line.stage} · {shortName(x.deal.client)} · {fmtMoney(x.line.left || x.line.amt)} บาท</span>
      <small>{x.line.lateDays ? `เลยกำหนด ${fmtN(x.line.lateDays)} วัน` : when ? isoTh(x.line.due) : x.line.due === today ? 'ครบกำหนดวันนี้' : `อีก ${fmtN(daysBetween(today, x.line.due))} วัน`}</small>
    </button>
  );
  /** A day's appointment in its cell: the customer's colour bar on its tint and the short name in ink (the
   *  time too when the chip is wide enough); the full name, type and time in its tooltip. */
  const taskChip = (x: TaskK) => {
    const ty = TT.find((k) => k[0] === x.t.type) || TT[0];
    return (
      <span key={x.t.id} className={'pl-ev' + (x.t.done ? ' done' : '')} style={ccVars(x.ck)} title={[x.full, ty[1], x.t.time, x.t.done ? 'ทำแล้ว' : ''].filter(Boolean).join(' · ')}>
        {x.t.time && <span className="pl-ev-t">{x.t.time}</span>}
        <span className="pl-ev-n">{chipName(x.full)}</span>
      </span>
    );
  };
  /** A day's installment in its cell: outlined in its status colour (late: red) with the word รับเงิน, never
   *  in a customer colour, so it does not read as an appointment. */
  const payChip = (x: PayK) => (
    <span key={x.deal.id + x.line.stage} className={'pl-ev pay' + (x.line.lateDays ? ' late' : '')} title={`รับชำระ ${x.line.stage} · ${shortName(x.deal.client)} · ${fmtMoney(x.line.left || x.line.amt)} บาท${x.line.lateDays ? ` · เลยกำหนด ${fmtN(x.line.lateDays)} วัน` : ''}`}>
      <span className="pl-ev-k">รับเงิน</span>
      <span className="pl-ev-n">{chipName(x.deal.client)}</span>
    </span>
  );
  const teamOpts = [{ v: '-', label: 'ยังไม่มีผู้รับผิดชอบ' }].concat(C.team.map((v) => ({ v, label: v })));

  return (
    <>
      <PageHead title="แผนติดต่อ" sub={`นัดโทร ส่งอีเมล หรือเข้าพบ ${e.teamCfg ? "แชร์กับทีม" : "บันทึกในเครื่องนี้"} · สีแยกตามลูกค้า`} />
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

      {/* the calendar 2/3, the day 1/3; stacked below 1180px */}
      <section className="pl-wrap">
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
              const ps = payBy[d] || [];
              const inM = d.slice(0, 7) === calM, isSel = d === selISO, wkd = dow(d) === 0 || dow(d) === 6;
              const cls = 'pl-cell' + (inM ? '' : ' out') + (wkd ? ' wk' : '') + (d === today ? ' today' : '') + (isSel ? ' sel' : '');
              // installments first, then the appointments by time: up to 3 lines (phones: 3 dots)
              const entries: CellEntry[] = [...ps.map((p) => ({ p })), ...ts.map((x) => ({ x }))];
              const lines = cellLines(entries), dots = cellDots(entries);
              return (
                <button key={d} className={cls} onClick={() => set({ calDay: d })} aria-pressed={isSel} aria-label={cellLabel(isoTh(d), d === today, ts.map((x) => x.name), ps.map((x) => ({ name: shortName(x.deal.client), late: x.line.lateDays > 0 })))}>
                  <span className="pl-dn">{+d.slice(8)}</span>
                  {entries.length > 0 && (
                    <>
                      <span className="pl-evs" aria-hidden="true">
                        {lines.shown.map((en) => (en.p ? payChip(en.p) : taskChip(en.x)))}
                        {lines.more > 0 && <span className="pl-more">อีก {fmtN(lines.more)}</span>}
                      </span>
                      <span className="pl-dots" aria-hidden="true">
                        {dots.shown.map((en) => en.p
                          ? <i key={en.p.deal.id + en.p.line.stage} className={'pl-dot pay' + (en.p.line.lateDays ? ' late' : '')} />
                          : <i key={en.x.t.id} className={'pl-dot' + (en.x.t.done ? ' done' : '')} style={ccVars(en.x.ck)} />)}
                        {dots.more > 0 && <span className="pl-dmore">อีก {fmtN(dots.more)}</span>}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {/* the month's customers: a colour dot and the name (the type tag elsewhere is coloured text) */}
          <div className="pl-legend">
            <span className="pl-lg-h">
              ลูกค้าในเดือนนี้
              <small>{legend.length ? `${fmtN(legend.length)} บริษัท · กดชื่อเพื่อดูเฉพาะรายนั้น` : ro ? 'ยังไม่มีนัดในเดือนนี้' : 'ยังไม่มีนัดในเดือนนี้ · เลือกบริษัทที่รายชื่อด้านล่างแล้วกด นัด'}</small>
              {only && <button className="lnk" onClick={() => set({ plCust: '' })}>แสดงทุกบริษัท</button>}
            </span>
            {legend.length > 0 && (
              <>
                <div className="pl-lg-list">
                  {legend.map((it) => (
                    <button key={it.ck} className="pl-lg" aria-pressed={it.ck === only} style={ccVars(it.ck)} onClick={() => set({ plCust: it.ck === only ? '' : it.ck })} title={`${it.name} · ${fmtN(it.n)} นัดในเดือนนี้`}>
                      <i aria-hidden="true" />
                      {it.name}
                      <small>{fmtN(it.n)}</small>
                    </button>
                  ))}
                </div>
                <span className="pl-lg-key">
                  <span className="pl-ev pay"><span className="pl-ev-k">รับเงิน</span></span>
                  งวดที่ต้องรับเงิน · กรอบแดงหนาคือเลยกำหนด
                </span>
              </>
            )}
          </div>
        </div>

        <div className="pl-day card">
          <div className="pl-day-head">
            <span className="pl-day-dn">{+selISO.slice(8)}</span>
            <span className="pl-day-t">
              <b>{(selISO === today ? 'วันนี้ · ' : '') + ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'][dow(selISO)] + ' ' + isoTh(selISO)}</b>
              <span>{fmtN(dayT.length)} งาน{dayP.length ? ` · รับเงิน ${fmtN(dayP.length)} งวด` : ''}</span>
            </span>
          </div>
          {only && (
            <div className="pl-filt" style={ccVars(only)}>
              <i aria-hidden="true" />
              <span>แสดงเฉพาะ {onlyName}</span>
              <button className="lnk" onClick={() => set({ plCust: '' })}>แสดงทุกบริษัท</button>
            </div>
          )}
          {!dayT.length && !dayP.length && <span className="pl-empty">ไม่มีงานในวันนี้ · เลือกวันอื่น หรือกด นัด ที่รายชื่อด้านล่าง</span>}
          {dayP.map((x) => payItem(x))}
          {dayT.map(({ t, ck }) => {
            const ti = taskInfo(e, t);
            // the customer's colour as a stripe beside the card: a website icon in the avatar never hides it
            return (
              <div key={t.id} className={'pl-task cc' + (t.done ? ' done-t' : '')} style={ccVars(ck)}>
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
          {!upcoming.length && !upPays.length && <span className="pl-empty">ยังไม่มีงานที่กำลังจะถึง</span>}
          {/* contacts and installments in one list by date */}
          {[...upcoming.map((u) => ({ at: u.date, u, x: undefined })), ...upPays.map((x) => ({ at: x.line.due, u: undefined, x }))].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 10).map(({ u, x }) => {
            // an installment keeps its status look and has no customer bar
            if (x) return payItem(x, true);
            if (!u) return null;
            const t = u.t, ti = taskInfo(e, t);
            return (
              <button key={t.id} className="pl-up hv" onClick={() => set({ calDay: t.date, calM: t.date.slice(0, 7) })} style={{ cursor: 'pointer', border: 0, borderTop: '1px solid var(--divider)', textAlign: 'left', padding: '8px', margin: '0 4px', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14, color: 'var(--ink)' }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}><i className="pl-bar" style={ccVars(u.ck)} aria-hidden="true" />{avOf(t.id, t.gid, t.title, 28)}<span style={{ minWidth: 0 }}>{ti.title}</span></span>
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
          <div className="pl-tools">
            <Select variant="tool" prefix="รายการ" label="รายการ" value={feedKey} onChange={(v) => set({ plFeed: v as FeedKey, picked: {}, plLim: 60 })} options={FEEDS.map(([v, label]) => ({ v, label }))} search={false} width={280} />
            {/* two filters, always shown as pills (no field menu) */}
            <FilterBar
              fields={[
                { key: 'stage', label: 'สถานะการขาย', kind: 'single', all: 'ทั้งหมด', pinned: true, rest: 'ทั้งหมด', options: STG.map(([v, label]) => ({ v, label })) },
                { key: 'owner', label: 'ผู้รับผิดชอบ', kind: 'single', all: 'ทั้งหมด', pinned: true, rest: 'ทุกคน', people: true, options: teamOpts },
              ]}
              value={{ stage: ui.plStage ? { v: [ui.plStage] } : undefined, owner: ui.plOwner ? { v: [ui.plOwner] } : undefined }}
              onChange={(k, x) => set(k === 'stage' ? { plStage: (x?.v[0] ?? '') as StageKey | '', picked: {} } : { plOwner: x?.v[0] ?? '', picked: {} })}
              anySet={false}
            />
            {!ro && <Select variant="tool" prefix="นัดอัตโนมัติวันละ" label="นัดอัตโนมัติวันละ" value={String(ui.perDay)} onChange={(v) => set({ perDay: +v })} options={[3, 5, 10, 20].map((n) => ({ v: String(n), label: `${n} ราย` }))} search={false} />}
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
                {/* the stage reads as plain text; a picker under the pointer (plain text for viewers) */}
                <Select variant="cell" className="pl-stage" value={st[0]} disabled={!e.can('edit.cust')} onChange={(v) => e.setStage(c.id, v as StageKey)} label={'สถานะการขาย ' + c.name} search={false} width={220} options={STG.map(([v, label]) => ({ v, label }))} />
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
