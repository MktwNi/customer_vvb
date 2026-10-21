import { useMemo } from 'react';
import { useApp, useEngineVersion } from '../state';
import { STG, TT, stageOf } from '../lib/constants';
import { TH_M, addDays, daysBetween, dow, fmtN, isoTh, telHref, todayISO } from '../lib/format';
import { beYear, fmtMoney, type Deal, type LineView } from '../lib/sales';
import { shortName } from '../lib/salesUi';
import { ccVars, custKey, dealKey } from '../lib/custColor';
import { activeCust, cellDots, cellLabel, cellLines, chipName, monthCustomers, onlyCust } from '../lib/planCal';
import { filterRows, jobTag, openJob, ownerChoices, planRows, planSrc, rowsOf, srcCounts, unplanned, type PlanRow, type PlanSrc } from '../lib/planList';
import { NO_TYPES, SVC_TYPES, activeType, custTypes, dealTypes, filterTypes, mainType, monthTypes, onlyType, svcType, typeCounts, typeSel, typeVars, typesOf, type CustTypes, type SvcTypeId } from '../lib/svcType';
import type { Company, StageKey, Task } from '../lib/types';
import { PageHead, Segmented } from '../components/ui';
import { FilterBar, type FVal } from '../components/FilterBar';
import { SvcChips } from '../components/SvcChips';
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

/** An appointment with its customer: the key (colour, legend, filter), the full name and the short one, and
 *  the customer's service types (lib/svcType.ts: chips, the type colour, the type legend and filter). */
interface TaskK { t: Task; ck: string; full: string; name: string; date: string; ct: CustTypes; types: readonly SvcTypeId[] }
/** An installment still to be received, with its deal's customer and the types of its deal's Services. */
interface PayK { deal: Deal; line: LineView; ck: string; ct: CustTypes; types: readonly SvcTypeId[] }
/** One line of a day cell: an installment or an appointment. */
type CellEntry = { p: PayK; x?: undefined } | { x: TaskK; p?: undefined };

export function Plan() {
  const { engine: e, ui, set, go, open, openSched } = useApp();
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
  // the Sales Tracker (for an account that sees it) and its year: the contact list's jobs and every
  // customer's service types (lib/svcType.ts), read from the Services of its jobs, never stored
  const sees = e.can('view.sales');
  const year = ui.slYear || beYear();
  const typeMap = useMemo(
    () => custTypes(sees ? e.sales : null, (d) => dealKey(e, d), year, (d) => openJob(e.sales, d, year, today)),
    [e, v, sees, year, today],
  );
  // "แยกสีตาม": by customer (as always) or by service type; types need the tracker
  const mode: 'cust' | 'type' = sees && ui.plColor === 'type' ? 'type' : 'cust';
  // every appointment with its customer (lib/custColor.ts: one key, so one colour on every page)
  const tasksK: TaskK[] = C.tasks.map((t) => {
    const c = e.company(t.gid), full = c ? c.name : t.title;
    const ck = custKey(e, t.gid, t.title), ct = typesOf(typeMap, ck);
    return { t, ck, full, name: shortName(full), date: t.date, ct, types: ct.types };
  });
  // installments of won deals still to be received (the payment plan): read-only entries, never stored
  // (amounts the account may not see: no installments at all, as the bell)
  const money = e.can('view.money');
  const pays = money ? e.payDue('', '9999-12-31') : [];
  const paysK: PayK[] = pays.map((x) => {
    const ct = sees ? dealTypes(e.sales, x.deal) : NO_TYPES;
    return { ...x, ck: dealKey(e, x.deal), ct, types: ct.types };
  });
  // the customer (or, by type, the type) pressed in the legend (this session only), while it still has an
  // entry; each belongs to its own colour mode
  const only = mode === 'cust' ? activeCust(ui.plCust, [...tasksK, ...paysK].map((x) => x.ck)) : '';
  const onlyT = mode === 'type' ? activeType(ui.plOnlyT, [...tasksK, ...paysK]) : '';
  const onlyName = only ? tasksK.find((x) => x.ck === only)?.name || shortName(paysK.find((x) => x.ck === only)?.deal.client || '') : '';
  /** The entries the calendar shows: the customer or the type pressed, or all. */
  const pick = <X extends { ck: string; types: readonly SvcTypeId[] }>(xs: X[]) => onlyType(onlyCust(xs, only), onlyT);
  /** An entry's colour: its customer's (lib/custColor.ts), or by type its type's (the type shown alone when
   *  it has several). */
  const markVars = (ck: string, types: readonly SvcTypeId[]) => (mode === 'type' ? typeVars(mainType(types, onlyT)) : ccVars(ck));
  /** "CFO, ทวนสอบ": a tooltip's and a day's label words for the types. */
  const typeWords = (types: readonly SvcTypeId[]) => types.map((t) => svcType(t).n).join(', ');
  const byDay: Record<string, TaskK[]> = {};
  pick(tasksK).forEach((x) => (byDay[x.date] || (byDay[x.date] = [])).push(x));
  // untimed first, then by time (the day list's order)
  Object.values(byDay).forEach((l) => l.sort((a, b) => (a.t.time || '').localeCompare(b.t.time || '')));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i)).filter((_, i) => i < 35 || addDays(start, 35).slice(0, 7) === calM);
  const dayT = byDay[selISO] || [];
  const payBy: Record<string, PayK[]> = {};
  pick(paysK).forEach((x) => (payBy[x.line.due] || (payBy[x.line.due] = [])).push(x));
  const dayP = payBy[selISO] || [];
  const legend = monthCustomers(tasksK, calM);
  // by type: "ประเภทบริการในเดือนนี้" (an appointment of a company with two types counts under both)
  const tLegend = monthTypes(tasksK, calM);
  const tLegendN = tasksK.filter((x) => x.date.slice(0, 7) === calM).length;

  // "รายชื่อที่ต้องติดต่อ": the team's real work (lib/planList.ts), never a registry list: the companies followed
  // and the open jobs of the Sales Tracker's year (for an account that sees the tracker), one row per company
  const rowsAll = useMemo(
    () => planRows<Company>({ company: (id) => e.company(id), watch: C.watch, tasks: C.tasks, owners: C.owners, stages: C.stages, sales: sees ? e.sales : null, year, today, phoneOf: e.contactPhone }),
    [e, v, sees, year, today],
  );
  const counts = srcCounts(rowsAll);
  // an older value (a registry feed) or the tracker for an account without it: the default
  const src: PlanSrc = planSrc(ui.plFeed) === 'sales' && !sees ? 'all' : planSrc(ui.plFeed);
  const srcRows = rowsOf(rowsAll, src);
  // a row's service types: its company's (or, for a client not linked, its jobs' client's), as the calendar reads them
  const rowCt = (r: PlanRow<Company>): CustTypes => typesOf(typeMap, r.c ? custKey(e, r.c.id, r.c.name) : r.jobs[0] ? dealKey(e, r.jobs[0].deal) : '');
  const rowTypes = (r: PlanRow<Company>) => rowCt(r).types;
  const plTypes = sees ? typeSel(ui.plTypes) : [];
  // the ประเภทบริการ filter after the other two: its counts are what each type would leave
  const tgBase = filterRows(srcRows, ui.plStage, ui.plOwner);
  const tCounts = typeCounts(tgBase, rowTypes);
  const tg = filterTypes(tgBase, plTypes, rowTypes);
  /** "เหลือ N บริษัท" in a filter's popover: the rows its draft would leave with the other filters as they are. */
  const liveCount = (k: string, d: FVal | null) => {
    const st = k === 'stage' ? ((d?.v[0] ?? '') as StageKey | '') : ui.plStage, ow = k === 'owner' ? d?.v[0] ?? '' : ui.plOwner;
    return filterTypes(filterRows(srcRows, st, ow), k === 'type' ? d?.v ?? [] : plTypes, rowTypes).length;
  };
  // "ยังไม่มีแผน": no appointment and no step planned ahead in the tracker (lib/planList.ts hasPlan); an
  // appointment needs a company of the register: a client not linked to one is opened in the tracker
  const unpl = unplanned(tg);
  const unlinked = tg.filter((r) => !r.c).length;
  // the hints above the list point at it only when it has a company to press นัด on
  const pickHere = !ro && srcRows.some((r) => r.c);
  const shown = tg.slice(0, ui.plLim || 60);
  const shownCos = shown.flatMap((r) => (r.c ? [r.c] : []));
  const pk = ui.picked || {};
  const pkIds = Object.keys(pk).map(Number);
  const allOn = shownCos.length > 0 && shownCos.every((c) => pk[c.id]);
  const srcOpts = [
    { v: 'all' as const, label: 'ทั้งหมดที่ต้องติดต่อ', n: fmtN(counts.all), sub: sees ? 'ที่ติดตาม และงานที่ยังเปิดใน Sales Tracker' : 'บริษัทที่ติดตาม' },
    { v: 'watch' as const, label: 'ที่ติดตาม', n: fmtN(counts.watch), sub: 'บริษัทที่ทีมกดติดตามไว้' },
    ...(sees ? [{ v: 'sales' as const, label: 'Sales Tracker (งานที่ยังเปิดอยู่)', n: fmtN(counts.sales), sub: `งานในตารางปี ${year} ที่ยังไม่ปิด` }] : []),
  ];

  // parts of the open tasks: [label, count, colour class when there are some]
  const segs: [string, number, string][] = [
    ['เกินกำหนด', open_.filter((t) => t.date < today).length, 't-bad'],
    ['วันนี้', open_.filter((t) => t.date === today).length, 't-warn'],
    ['7 วันข้างหน้า', open_.filter((t) => t.date > today && t.date <= wk).length, ''],
    ['หลังจากนั้น', open_.filter((t) => t.date > wk).length, ''],
    // installments late or due within 7 days
    ...(money ? [['รับเงิน', pays.filter((x) => x.line.due <= wk).length, 't-warn'] as [string, number, string]] : []),
  ];
  const avOf = (key: string, gid: number, title: string, size = 28) => {
    const c = e.company(gid);
    return <CoAvatar key={key} name={c ? c.name : title} web={c?.web} set={c?.set} size={size} />;
  };
  const upcoming = pick(tasksK).filter((x) => !x.t.done && x.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.t.time || '').localeCompare(b.t.time || '')).slice(0, 8);
  const upPays = pick(paysK).filter((x) => x.line.due >= today).slice(0, 4);
  /** "กรีนวัลเลย์ ฟู้ดส์" with its deal's service types, "รับชำระ PAY2 · 53,500 บาท" ("PAY" for a single installment) under it: opens the deal (the
   *  receipt is recorded there). It keeps its status look in both colour modes. In งานที่กำลังจะถึง (`when`) the
   *  name is 14px, as the appointments there: a short list under the day's 16px cards. */
  const payItem = (x: PayK, when?: boolean) => (
    <button key={x.deal.id + x.line.stage} className={'pl-pay hv' + (when ? ' up' : '') + (x.line.lateDays ? ' late' : '')} onClick={() => set({ deal: x.deal.id })}>
      {/* the customer's name is the title (as on an appointment); what is due under it */}
      <span className="pl-pay-t">
        <span className="pl-nm-row"><span className={'co-name' + (when ? ' dense' : '')}>{shortName(x.deal.client)}</span>{sees && <SvcChips ct={x.ct} />}</span>
        <span className="t-sec">รับชำระ {x.line.code} · {fmtMoney(x.line.left || x.line.amt)} บาท</span>
      </span>
      <small>{x.line.lateDays ? `เลยกำหนด ${fmtN(x.line.lateDays)} วัน` : when ? isoTh(x.line.due) : x.line.due === today ? 'ครบกำหนดวันนี้' : `อีก ${fmtN(daysBetween(today, x.line.due))} วัน`}</small>
    </button>
  );
  /** A day's appointment in its cell: the customer's colour bar on its tint (by type: its type's) and the
   *  short name in ink (the time too when the chip is wide enough); the full name, type and time in its
   *  tooltip (by type: the service types too). */
  const taskChip = (x: TaskK) => {
    const ty = TT.find((k) => k[0] === x.t.type) || TT[0];
    return (
      <span key={x.t.id} className={'pl-ev' + (x.t.done ? ' done' : '')} style={markVars(x.ck, x.types)} title={[x.full, mode === 'type' ? typeWords(x.types) : '', ty[1], x.t.time, x.t.done ? 'ทำแล้ว' : ''].filter(Boolean).join(' · ')}>
        {x.t.time && <span className="pl-ev-t">{x.t.time}</span>}
        <span className="pl-ev-n">{chipName(x.full)}</span>
      </span>
    );
  };
  /** A day's installment in its cell: outlined in its status colour (late: red) with the word รับเงิน, never
   *  in a customer or a type colour, so it does not read as an appointment. */
  const payChip = (x: PayK) => (
    <span key={x.deal.id + x.line.stage} className={'pl-ev pay' + (x.line.lateDays ? ' late' : '')} title={`รับชำระ ${x.line.code} · ${shortName(x.deal.client)}${mode === 'type' ? ' · ' + typeWords(x.types) : ''} · ${fmtMoney(x.line.left || x.line.amt)} บาท${x.line.lateDays ? ` · เลยกำหนด ${fmtN(x.line.lateDays)} วัน` : ''}`}>
      <span className="pl-ev-k">รับเงิน</span>
      <span className="pl-ev-n">{chipName(x.deal.client)}</span>
    </span>
  );
  // the team and every other name a row shows (a tracker job's ผู้รับผิดชอบ), and the one picked if it has gone
  const owners = ownerChoices(C.team, rowsAll);
  if (ui.plOwner && ui.plOwner !== '-' && !owners.includes(ui.plOwner)) owners.push(ui.plOwner);
  const teamOpts = [{ v: '-', label: 'ยังไม่มีผู้รับผิดชอบ' }].concat(owners.map((v) => ({ v, label: v })));
  // the six types, อื่นๆ and ยังไม่ระบุประเภท, each with the rows it would leave and the Services it stands for
  const typeOpts = SVC_TYPES.map((t) => ({
    v: t.id,
    label: t.n,
    n: tCounts[t.id],
    desc: t.svc.length ? 'Services ' + t.svc.join(', ') : t.id === 'oth' ? 'Services อื่น เช่น Course Training, CF-EVENT' : 'ติดตามอย่างเดียว หรืองานยังไม่ได้เลือก Services',
  }));

  return (
    <>
      <PageHead title="แผนติดต่อ" sub={`นัดติดต่อบริษัทที่ติดตาม${sees ? 'และงานที่ยังเปิดใน Sales Tracker' : ''} · ${e.teamCfg ? 'แชร์กับทีม' : 'บันทึกในเครื่องนี้'} · สีแยกตาม${mode === 'type' ? 'ประเภทบริการ' : 'ลูกค้า'}`} />
      <section className="pl-sum card" aria-label="สรุปงานที่นัดไว้">
        <div className="pl-sum-total">
          <span>งานค้างทั้งหมด</span>
          <b>{fmtN(open_.length)}</b>
          <small>{open_.length ? `นัดไว้ ${fmtN(new Set(open_.map((t) => e.canonical(t.gid))).size)} บริษัท` : pickHere ? 'ยังไม่มีนัด · เลือกบริษัทด้านล่างแล้วกด นัด' : 'ยังไม่มีนัด'}</small>
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
            {/* the colours by customer (as always) or by service type; a filter pressed in the legend is the old mode's */}
            {sees && (
              <div className="pl-colorby">
                <span className="pl-colorby-l" aria-hidden="true">แยกสีตาม</span>
                <Segmented label="แยกสีตาม" value={mode} onChange={(x) => set({ plColor: x, plCust: '', plOnlyT: '' })} options={[{ v: 'cust', label: 'ลูกค้า' }, { v: 'type', label: 'ประเภทบริการ' }]} />
              </div>
            )}
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
              // by type, each name says its types ("ซากิโนมิยะ ประเทศไทย (CFO, CFP)"): the colour is not seen
              const said = (name: string, types: readonly SvcTypeId[]) => (mode === 'type' ? `${name} (${typeWords(types)})` : name);
              return (
                <button key={d} className={cls} onClick={() => set({ calDay: d })} aria-pressed={isSel} aria-label={cellLabel(isoTh(d), d === today, ts.map((x) => said(x.name, x.types)), ps.map((x) => ({ name: said(shortName(x.deal.client), x.types), late: x.line.lateDays > 0 })))}>
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
                          : <i key={en.x.t.id} className={'pl-dot' + (en.x.t.done ? ' done' : '')} style={markVars(en.x.ck, en.x.types)} />)}
                        {dots.more > 0 && <span className="pl-dmore">อีก {fmtN(dots.more)}</span>}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {/* the month's customers: a colour dot and the name (the type tag elsewhere is coloured text); by type,
              the month's service types: a colour dot, the type's name and its appointments */}
          <div className="pl-legend">
            {mode === 'type' ? (
              <span className="pl-lg-h">
                ประเภทบริการในเดือนนี้
                <small>{tLegend.length ? `${fmtN(tLegendN)} นัด · กดชื่อประเภทเพื่อดูเฉพาะประเภทนั้น` : pickHere ? 'ยังไม่มีนัดในเดือนนี้ · เลือกบริษัทที่รายชื่อด้านล่างแล้วกด นัด' : 'ยังไม่มีนัดในเดือนนี้'}</small>
                {onlyT && <button className="lnk" onClick={() => set({ plOnlyT: '' })}>แสดงทุกประเภท</button>}
              </span>
            ) : (
              <span className="pl-lg-h">
                ลูกค้าในเดือนนี้
                <small>{legend.length ? `${fmtN(legend.length)} บริษัท · กดชื่อเพื่อดูเฉพาะรายนั้น` : pickHere ? 'ยังไม่มีนัดในเดือนนี้ · เลือกบริษัทที่รายชื่อด้านล่างแล้วกด นัด' : 'ยังไม่มีนัดในเดือนนี้'}</small>
                {only && <button className="lnk" onClick={() => set({ plCust: '' })}>แสดงทุกบริษัท</button>}
              </span>
            )}
            {(mode === 'type' ? tLegend.length : legend.length) > 0 && (
              <>
                {mode === 'type' ? (
                  <div className="pl-lg-list">
                    {tLegend.map((it) => (
                      <button key={it.id} className="pl-lg" aria-pressed={it.id === onlyT} style={typeVars(it.id)} onClick={() => set({ plOnlyT: it.id === onlyT ? '' : it.id })} title={`${svcType(it.id).n} · ${fmtN(it.n)} นัด · ${fmtN(it.cos)} บริษัทในเดือนนี้`}>
                        <i aria-hidden="true" />
                        {svcType(it.id).n}
                        <small>{fmtN(it.n)}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pl-lg-list">
                    {legend.map((it) => (
                      <button key={it.ck} className="pl-lg" aria-pressed={it.ck === only} style={ccVars(it.ck)} onClick={() => set({ plCust: it.ck === only ? '' : it.ck })} title={`${it.name} · ${fmtN(it.n)} นัดในเดือนนี้`}>
                        <i aria-hidden="true" />
                        {it.name}
                        <small>{fmtN(it.n)}</small>
                      </button>
                    ))}
                  </div>
                )}
                {money && (
                  <span className="pl-lg-key">
                    <span className="pl-ev pay"><span className="pl-ev-k">รับเงิน</span></span>
                    งวดที่ต้องรับเงิน · กรอบแดงหนาคือเลยกำหนด
                  </span>
                )}
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
          {onlyT && (
            <div className="pl-filt" style={typeVars(onlyT)}>
              <i aria-hidden="true" />
              <span>แสดงเฉพาะประเภท {svcType(onlyT).n}</span>
              <button className="lnk" onClick={() => set({ plOnlyT: '' })}>แสดงทุกประเภท</button>
            </div>
          )}
          {!dayT.length && !dayP.length && <span className="pl-empty">{pickHere ? 'ไม่มีงานในวันนี้ · เลือกวันอื่น หรือกด นัด ที่รายชื่อด้านล่าง' : 'ไม่มีงานในวันนี้ · เลือกวันอื่น'}</span>}
          {dayP.map((x) => payItem(x))}
          {dayT.map(({ t, ck, ct, types }) => {
            const ti = taskInfo(e, t);
            // the customer's colour (by type: its type's) as a stripe beside the card: a website icon in the
            // avatar never hides it; the service types as words beside the name, in both modes
            return (
              <div key={t.id} className={'pl-task cc' + (t.done ? ' done-t' : '')} style={markVars(ck, types)}>
                <DoneBox t={t} onToggle={() => !ro && e.toggleTask(t)} ro={ro} />
                {avOf(t.id, t.gid, t.title, 36)}
                <div className="pl-task-t">
                  <span className="pl-nm-row">
                    <button onClick={() => ti.company && open(ti.company.id)} className="hv-tx pl-task-n co-name">{ti.title}</button>
                    {sees && <SvcChips ct={ct} />}
                  </span>
                  <span className="t-sec">{ti.meta}</span>
                  {t.note && <span className="t-sec">{t.note}</span>}
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
                <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}><i className="pl-bar" style={markVars(u.ck, u.types)} aria-hidden="true" />{avOf(t.id, t.gid, t.title, 28)}<span className="pl-up-n"><span className="co-name dense">{ti.title}</span>{sees && <SvcChips ct={u.ct} />}</span></span>
                <span className="pl-up-when">{ti.when}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h3 className="card-t">รายชื่อที่ต้องติดต่อ</h3>
            {/* nothing to count over an empty list (its own words say why) */}
            {tg.length > 0 && <span className="t-sec">{`${fmtN(tg.length)} บริษัท · ยังไม่มีแผน ${fmtN(unpl.length)}${unlinked ? ` · ยังไม่ได้เชื่อมบริษัท ${fmtN(unlinked)}` : ''}`}</span>}
          </div>
          <div className="pl-tools">
            <Select variant="tool" prefix="รายการ" label="รายการ" value={src} onChange={(x) => set({ plFeed: x, picked: {}, plLim: 60 })} options={srcOpts} search={false} width={320} />
            {/* the filters, always shown as pills (no field menu): ประเภทบริการ for an account that sees the tracker */}
            <FilterBar
              fields={[
                { key: 'stage', label: 'สถานะการขาย', kind: 'single', all: 'ทั้งหมด', pinned: true, rest: 'ทั้งหมด', options: STG.map(([v, label]) => ({ v, label })) },
                { key: 'owner', label: 'ผู้รับผิดชอบ', kind: 'single', all: 'ทั้งหมด', pinned: true, rest: 'ทุกคน', people: true, options: teamOpts },
                ...(sees ? [{ key: 'type', label: 'ประเภทบริการ', kind: 'multi' as const, pinned: true, rest: 'ทุกประเภท', options: typeOpts }] : []),
              ]}
              value={{ stage: ui.plStage ? { v: [ui.plStage] } : undefined, owner: ui.plOwner ? { v: [ui.plOwner] } : undefined, type: plTypes.length ? { v: plTypes } : undefined }}
              onChange={(k, x) => set(k === 'stage' ? { plStage: (x?.v[0] ?? '') as StageKey | '', picked: {} } : k === 'type' ? { plTypes: typeSel(x?.v), picked: {} } : { plOwner: x?.v[0] ?? '', picked: {} })}
              anySet={false}
              liveCount={liveCount}
              unit="บริษัท"
            />
            {!ro && unpl.length > 0 && <Select variant="tool" prefix="นัดอัตโนมัติวันละ" label="นัดอัตโนมัติวันละ" value={String(ui.perDay)} onChange={(v) => set({ perDay: +v })} options={[3, 5, 10, 20].map((n) => ({ v: String(n), label: `${n} ราย` }))} search={false} />}
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
        {/* picking companies only leads to making appointments or sending them to the tracker (a client not
            linked to the register is not picked: an appointment needs a company) */}
        {!ro && shownCos.length > 0 && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--divider)', paddingTop: 10 }}>
          <button
            onClick={() => {
              const p = { ...pk };
              if (allOn) shownCos.forEach((c) => delete p[c.id]);
              else shownCos.forEach((c) => (p[c.id] = 1));
              set({ picked: p });
            }}
            className="lnk"
            style={{ fontSize: 13 }}
          >
            {allOn ? 'ยกเลิกเลือกทั้งหมด' : `เลือก ${fmtN(shownCos.length)} รายที่แสดง`}
          </button>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>{pkIds.length ? `เลือกแล้ว ${fmtN(pkIds.length)} ราย` : 'เลือกหลายรายเพื่อนัดพร้อมกัน'}</span>
          {pkIds.length > 0 && <button onClick={() => openSched({ ids: pkIds })} className="btn sm pri">นัดที่เลือก {fmtN(pkIds.length)} ราย</button>}
          {pkIds.length > 0 && sees && e.can('edit.deal') && <button onClick={() => set({ sendIds: pkIds })} className="btn sm">ส่งเข้า Sales Tracker</button>}
        </div>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((r) => {
            const c = r.c, j = r.jobs[0];
            const p = !!(c && pk[c.id]);
            const ot = r.task;
            // what is late, in words (the order already puts it first; the deal panel's words for a job)
            const warn = ot && ot.date < today ? 'นัดเกินกำหนด' : r.idle != null ? `ไม่ได้ติดต่อ ${fmtN(r.idle)} วัน` : '';
            const meta = [c ? D.prov[c.prov] : j && j.deal.section ? 'หมวด ' + j.deal.section : '', r.owner].filter(Boolean).join(' · ');
            const openDeal = () => j && set({ deal: j.deal.id });
            return (
              <div key={r.key} className="plan-row">
                {ro || !c ? <span /> : (
                  <button
                    onClick={() => {
                      const q = { ...pk };
                      if (q[c.id]) delete q[c.id];
                      else q[c.id] = 1;
                      set({ picked: q });
                    }}
                    aria-label={'เลือก ' + r.name} aria-pressed={p}
                    className={'ckb ' + (p ? 'hv-dk on' : 'hv')}
                  >
                    {p && <Icon name="check" size={14} />}
                  </button>
                )}
                <div className="pl-who">
                  <CoAvatar name={r.name} web={c?.web} set={c?.set} size={28} />
                  <div className="pl-who-t">
                    <span className="pl-nm-row">
                      <button onClick={() => (c ? open(c.id) : openDeal())} className="hv-tx pl-who-n co-name" title={c ? 'เปิดหน้าบริษัท' : 'เปิดงานใน Sales Tracker'}>{r.name}</button>
                      {sees && <SvcChips ct={rowCt(r)} />}
                    </span>
                    {/* where it comes from: followed, and/or its tracker job's next step (opens the job) */}
                    <span className="pl-src">
                      {r.watch && <span className="chip">ติดตาม</span>}
                      {j && <button type="button" className="chip pl-tag hv" onClick={openDeal} title="เปิดงานใน Sales Tracker">{jobTag(r.jobs)}</button>}
                      {warn && <span className="pl-warn">{warn}</span>}
                      {meta && <span className="pl-meta">{meta}</span>}
                    </span>
                  </div>
                </div>
                <span style={{ fontSize: 13, color: 'var(--ink-2)', wordBreak: 'break-word' }}>{r.phone || 'ยังไม่มีเบอร์'}</span>
                {/* the stage reads as plain text; a picker under the pointer (plain text for viewers); a client
                    not linked to the register has none (it is a company's) */}
                {c ? (
                  <Select variant="cell" className="pl-stage" value={stageOf(r.stage || 'none')[0]} disabled={!e.can('edit.cust')} onChange={(v) => e.setStage(c.id, v as StageKey)} label={'สถานะการขาย ' + c.name} search={false} width={220} options={STG.map(([v, label]) => ({ v, label }))} />
                ) : (
                  <span className="pl-nolink">ยังไม่ได้เชื่อมบริษัท</span>
                )}
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {!c ? (
                    <button onClick={openDeal} className="lnk" title={e.can('edit.deal') ? 'เปิดงานใน Sales Tracker แล้วเชื่อมกับบริษัทในทะเบียนที่ “ข้อมูลติดต่อ · SOURCE / บริการ” จึงจะนัดได้' : 'เปิดงานใน Sales Tracker'}>เปิดงาน</button>
                  ) : ro ? null : ot ? (
                    <button onClick={() => openSched({ taskId: ot.id, ids: [c.id] })} className="lnk" style={{ fontSize: 13 }}>นัดแล้ว {isoTh(ot.date)}</button>
                  ) : (
                    <button onClick={() => openSched({ ids: [c.id] })} className="lnk">นัด</button>
                  )}
                </span>
              </div>
            );
          })}
          {!tg.length && srcRows.length > 0 && (
            <span className="empty" style={{ padding: '16px 0' }}>
              ไม่มีรายชื่อที่ตรงกับตัวกรอง · <button className="lnk" onClick={() => set({ plStage: '', plOwner: '', plTypes: [], picked: {} })}>ล้างตัวกรอง</button>
            </span>
          )}
          {!srcRows.length && (
            <div className="pl-none">
              <b>ยังไม่มีรายชื่อที่ต้องติดต่อ</b>
              <span>
                {src === 'watch'
                  ? 'ยังไม่ได้ติดตามบริษัทไหน · กด ติดตาม ในหน้าบริษัท หรือเลือกบริษัทในหน้าค้นหา'
                  : src === 'sales'
                    ? `ยังไม่มีงานที่ยังเปิดอยู่ใน Sales Tracker ปี ${year}`
                    : `รายชื่อมาจากบริษัทที่ทีมติดตาม${sees ? ` และงานที่ยังเปิดอยู่ใน Sales Tracker ปี ${year}` : ''} · เลือกบริษัทในหน้าค้นหา แล้วกด ติดตาม${sees ? ' หรือ ส่งเข้า Sales Tracker' : ''}`}
              </span>
              <span className="pl-none-a">
                <button className="lnk" onClick={() => go('search')}>หาบริษัทจากหน้าค้นหา</button>
                {sees && <button className="lnk" onClick={() => go('sales', { slView: 'table' })}>ไปที่ Sales Tracker</button>}
              </span>
            </div>
          )}
          {tg.length > shown.length && <button onClick={() => set({ plLim: (ui.plLim || 60) + 120 })} className="lnk" style={{ alignSelf: 'center', marginTop: 10 }}>{`แสดงเพิ่ม (อีก ${fmtN(tg.length - shown.length)} ราย)`}</button>}
        </div>
      </section>
    </>
  );
}
