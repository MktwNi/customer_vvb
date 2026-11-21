import { useMemo, useState, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { Icon } from '../components/icons';
import { Segmented, Status, type StatusKind } from '../components/ui';
import { TH_M, addDays, daysBetween, dmTh, fmtN, isoTh, todayISO } from '../lib/format';
import {
  STATUS_TH, TEMPLATES, dueWords, moneyTotals, ownerOf, projectView, sampleBills, sampleProjects, taskState, templateOf, weekLoad,
  type OwnerGroup, type Project, type ProjStatus, type Task,
} from '../lib/consult';

const ST_KIND: Record<ProjStatus, StatusKind> = { going: 'warn', open: 'neutral', hold: 'bad', done: 'ok' };
type StF = 'all' | ProjStatus;
type GroupF = 'all' | 'gcc' | 'client' | 'ext';
const inGroup = (g: OwnerGroup, f: GroupF) => f === 'all' || (f === 'ext' ? g === 'ext' || g === 'tgo' : g === f);
const pctW = (x: number) => `${Math.round(x * 100)}%`;
const shortDate = (iso: string, today: string) => dmTh(iso) + (iso.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + String(+iso.slice(0, 4) + 543).slice(-2));

/**
 * งานที่ปรึกษา (lib/consult.ts; designs 3A, 3B and 3C on the design canvas): the projects, a project with its plan
 * (แผนโครงการ), and the billing, the module's only page with money (owner: "ตัวเลขเงินไม่ต้องอยู่ในทุกหน้า จัดกลุ่มไว้ที่
 * เดียว"), for the accounts that see amounts (view.money).
 * On the UAT copy only, with sample projects: nothing here is saved. Who may open the module is the next step, with
 * the team script (a capability of its own); for now the page is open on UAT, like the rest of หน้าแรก's systems.
 */
export function Consult() {
  const { engine: e } = useApp();
  useEngineVersion();
  const today = todayISO();
  const projects = useMemo(() => sampleProjects(today), [today]);
  const [view, setView] = useState<'list' | 'money'>('list');
  const [pid, setPid] = useState<string | null>(null);
  const money = e.can('view.money');
  const open = projects.find((p) => p.id === pid) || null;
  const go = (v: 'list' | 'money') => (setPid(null), setView(v));

  return (
    <div className="cs">
      <div className="cs-bar">
        <span className="cs-mark" aria-hidden="true"><Icon name="briefcase" /></span>
        <span className="cs-bar-t">
          <b>งานที่ปรึกษา</b>
          <span>โมดูลแยกสิทธิ์ · ข้อมูลตัวอย่าง ยังไม่บันทึกเข้าระบบทีม</span>
        </span>
        <nav className="cs-tabs" aria-label="เมนูงานที่ปรึกษา">
          <button type="button" aria-current={view === 'list' ? 'page' : undefined} onClick={() => go('list')}>โครงการ</button>
          <button type="button" aria-current={view === 'money' ? 'page' : undefined} onClick={() => go('money')}>วางบิลและค่าใช้จ่าย</button>
        </nav>
      </div>
      {open ? (
        <ProjectPage p={open} today={today} back={() => setPid(null)} />
      ) : view === 'money' ? (
        <Finance projects={projects} today={today} money={money} openP={setPid} />
      ) : (
        <ProjectList projects={projects} today={today} openP={setPid} toMoney={() => go('money')} />
      )}
    </div>
  );
}

/** 3A: every project of the year, its phase, progress and next task; the team's week; the templates. */
function ProjectList({ projects, today, openP, toMoney }: { projects: Project[]; today: string; openP: (id: string) => void; toMoney: () => void }) {
  const [st, setSt] = useState<StF>('all');
  const [q, setQ] = useState('');
  const views = new Map(projects.map((p) => [p.id, projectView(p, today)]));
  const n = (k: ProjStatus) => projects.filter((p) => p.status === k).length;
  const going = projects.filter((p) => p.status === 'going');
  const lateTasks = going.reduce((s, p) => s + views.get(p.id)!.late.length, 0);
  const lateProjects = going.filter((p) => views.get(p.id)!.late.length).length;
  const qq = q.trim().toLowerCase();
  const shown = projects.filter((p) => (st === 'all' || p.status === st) && (!qq || [p.name, p.client, ownerOf(p.owner).name].some((s) => s.toLowerCase().includes(qq))));
  const load = weekLoad(projects, today);
  const loadMax = Math.max(1, ...load.map((x) => x.n));
  const year = +today.slice(0, 4) + 543;

  return (
    <>
      <div className="cs-h">
        <div>
          <h1 id="page-title">โครงการที่ปรึกษา ปี {year}</h1>
          <p>ทุกโครงการใช้แผนจากแม่แบบเดียวกัน กดชื่อโครงการเพื่อดูแผนโครงการ · ยอดเงินอยู่ที่ <button type="button" className="lnk" onClick={toMoney}>วางบิลและค่าใช้จ่าย</button></p>
        </div>
        <input className="fld cs-q" type="search" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="ค้นหาโครงการ ลูกค้า หรือผู้รับผิดชอบ" aria-label="ค้นหาโครงการ" />
      </div>

      <section className="cs-kpis" aria-label="ภาพรวมโครงการ">
        <div className="cs-kpi hero"><span>กำลังทำ</span><b>{fmtN(n('going'))}</b><small>โครงการ</small></div>
        <div className="cs-kpi"><span>ยังไม่เริ่มและพักไว้</span><b>{fmtN(n('open') + n('hold'))}</b><small>โครงการ</small></div>
        <div className={'cs-kpi' + (lateTasks ? ' late' : '')}><span>งานเลยกำหนด</span><b>{fmtN(lateTasks)}</b><small>{lateTasks ? `งาน ใน ${fmtN(lateProjects)} โครงการ` : 'งาน'}</small></div>
      </section>

      <div className="cs-grid">
        <section className="card cs-card" aria-labelledby="cs-all-t">
          <div className="cs-sec">
            <h2 id="cs-all-t">โครงการทั้งหมด</h2>
            <Segmented
              label="สถานะโครงการ"
              value={st}
              onChange={setSt}
              options={[{ v: 'all', label: 'ทั้งหมด', n: projects.length }, ...(['going', 'open', 'hold', 'done'] as ProjStatus[]).map((k) => ({ v: k, label: STATUS_TH[k], n: n(k) }))]}
            />
          </div>
          <div className="cs-tbl" role="table" aria-label="โครงการ">
            <div className="cs-tr cs-th" role="row">
              <span role="columnheader">โครงการ</span><span role="columnheader">ผู้รับผิดชอบ</span><span role="columnheader">สถานะ</span>
              <span role="columnheader">ช่วงงาน</span><span role="columnheader">ความคืบหน้า</span><span role="columnheader">งานถัดไป</span>
            </div>
            {shown.map((p) => {
              const v = views.get(p.id)!, tpl = templateOf(p.tpl);
              const nx = p.status === 'done' ? null : v.next[0];
              const late = !!nx && taskState(nx, today, p.status === 'hold') === 'late';
              return (
                <div className="cs-tr" role="row" key={p.id}>
                  <span role="cell" className="cs-name">
                    <button type="button" className="lnk" onClick={() => openP(p.id)}>{p.name}</button>
                    <small>{tpl.code} · {tpl.phases} ช่วง</small>
                  </span>
                  <span role="cell">{ownerOf(p.owner).name}</span>
                  <span role="cell"><Status kind={ST_KIND[p.status]} chip>{STATUS_TH[p.status]}</Status></span>
                  <span role="cell" className="cs-ph">
                    <span className="cs-dots" aria-hidden="true">
                      {v.phases.map((ph) => <i key={ph.no} className={ph.state === 'done' ? 'done' : ph.no === v.phaseNow && p.status !== 'open' ? 'now' : ''} />)}
                    </span>
                    <small>{v.phaseNow > v.phases.length ? 'เสร็จครบทุกช่วง' : `ช่วงที่ ${v.phaseNow} จาก ${v.phases.length}`}</small>
                  </span>
                  <span role="cell" className="cs-pr">
                    <small>{pctW(v.progress)}</small>
                    <span className="cs-meter" aria-hidden="true"><i style={{ width: pctW(v.progress) }} /></span>
                  </span>
                  <span role="cell" className="cs-nx">
                    {p.status === 'done' ? (
                      <><b>เสร็จทุกงาน</b><small>ปิดเมื่อ {isoTh(v.to)}</small></>
                    ) : nx ? (
                      <><b>{nx.wbs} {nx.name}</b><small className={late ? 'late' : ''}>{p.status === 'hold' ? p.holdNote : p.status === 'open' ? `เริ่ม ${shortDate(v.from, today)}` : `${dueWords(nx.end, today)} (${shortDate(nx.end, today)})`}</small></>
                    ) : null}
                  </span>
                </div>
              );
            })}
            {!shown.length && <p className="cs-empty">ไม่พบโครงการที่ตรงกับที่เลือก</p>}
          </div>
        </section>

        <aside className="cs-side">
          <section className="card cs-card" aria-labelledby="cs-load-t">
            <h2 id="cs-load-t">งานของทีมสัปดาห์นี้</h2>
            <p className="cs-note">งานที่ยังไม่เสร็จในสัปดาห์นี้ (จันทร์ถึงอาทิตย์) ของโครงการที่กำลังทำ</p>
            {load.length ? load.map((x) => (
              <div className="cs-load" key={x.owner}>
                <span>{x.name}</span><b>{fmtN(x.n)} งาน</b>
                <span className="cs-meter" aria-hidden="true"><i style={{ width: `${(x.n / loadMax) * 100}%` }} /></span>
              </div>
            )) : <p className="cs-empty">สัปดาห์นี้ไม่มีงานของทีม</p>}
          </section>
          <section className="card cs-card" aria-labelledby="cs-tpl-t">
            <h2 id="cs-tpl-t">แม่แบบแผนงาน</h2>
            {TEMPLATES.map((t) => (
              <div className="cs-tpl" key={t.id}>
                <b>{t.title}</b>
                <small>{t.phases} ช่วง {t.tasks} งาน · {t.flow}</small>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}

const BAR_CLS = { done: 'done', going: 'going', late: 'late', todo: 'todo' } as const;

/** 3B: one project, its phases and its plan as a timeline, what is late or next, and its deliverables. */
function ProjectPage({ p, today, back }: { p: Project; today: string; back: () => void }) {
  const [grp, setGrp] = useState<GroupF>('all');
  const v = projectView(p, today), tpl = templateOf(p.tpl), hold = p.status === 'hold';
  // the timeline: the 1st of the plan's first month to the end of its last
  const from = v.from.slice(0, 8) + '01';
  const lastM = new Date(Date.UTC(+v.to.slice(0, 4), +v.to.slice(5, 7), 0)).toISOString().slice(0, 10);
  const span = daysBetween(from, lastM) + 1;
  const at = (iso: string) => (daysBetween(from, iso) / span) * 100;
  const months: { left: number; label: string }[] = [];
  for (let d = from; d <= lastM; d = addDays(d, 1)) if (d.endsWith('-01')) months.push({ left: at(d), label: TH_M[+d.slice(5, 7) - 1] + ' ' + String(+d.slice(0, 4) + 543).slice(-2) });
  // today's line, drawn in every row's timeline (none when the plan is all before or after today)
  const now = today >= from && today <= lastM ? <i className="cs-now" style={{ left: `${at(today) + 50 / span}%` }} aria-hidden="true" /> : null;
  const deliver = p.phases.flatMap((ph) => ph.tasks).filter((t) => t.deliver);
  const bar = (s: string, e: string) => ({ left: `${at(s)}%`, width: `${Math.max(0.6, ((daysBetween(s, e) + 1) / span) * 100)}%` });

  return (
    <>
      <button type="button" className="lnk cs-back" onClick={back}>กลับไปรายการโครงการ</button>
      <section className="card cs-card cs-proj" aria-labelledby="page-title">
        <div className="cs-sec">
          <div>
            <h1 id="page-title">{p.name}</h1>
            <div className="cs-chips">
              <Status kind={ST_KIND[p.status]} chip>{STATUS_TH[p.status]}</Status>
              <span className="cs-chip">ความสำคัญ {p.priority}</span>
              <span className="cs-chip">ความซับซ้อน {p.level}</span>
              <span className="cs-chip">แม่แบบ {tpl.code} · {tpl.phases} ช่วง {tpl.tasks} งาน</span>
            </div>
          </div>
        </div>
        <dl className="cs-dl">
          <div><dt>ลูกค้า</dt><dd>{p.client}</dd></div>
          <div><dt>ผู้รับผิดชอบโครงการ</dt><dd>{ownerOf(p.owner).name}</dd></div>
          <div><dt>ช่วงโครงการตามแผน</dt><dd>{isoTh(v.from)} ถึง {isoTh(v.to)}</dd></div>
          {hold && <div><dt>หมายเหตุ</dt><dd>{p.holdNote}</dd></div>}
        </dl>
        <div className="cs-kpis sm">
          <div className="cs-kpi"><span>ความคืบหน้าเฉลี่ย</span><b>{pctW(v.progress)}</b><span className="cs-meter" aria-hidden="true"><i style={{ width: pctW(v.progress) }} /></span></div>
          <div className="cs-kpi"><span>งานเสร็จ</span><b>{fmtN(v.done)}</b><small>จาก {fmtN(v.total)} งาน</small></div>
          <div className={'cs-kpi' + (v.late.length ? ' late' : '')}><span>เลยกำหนด</span><b>{fmtN(v.late.length)}</b><small>งาน</small></div>
        </div>
        <ol className="cs-steps" aria-label="ช่วงของโครงการ">
          {v.phases.map((ph) => (
            <li key={ph.no} className={ph.state}>
              <small>ช่วงที่ {ph.no}</small>
              <b>{ph.short}</b>
              <span className="cs-meter" aria-hidden="true"><i style={{ width: pctW(ph.pct) }} /></span>
              <span>{shortDate(ph.from, today)} ถึง {shortDate(ph.to, today)} · {ph.state === 'done' ? 'เสร็จ' : ph.state === 'now' ? `กำลังทำ ${pctW(ph.pct)}` : 'ยังไม่เริ่ม'}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card cs-card" aria-labelledby="cs-plan-t">
        <div className="cs-sec">
          <div>
            <h2 id="cs-plan-t">แผนโครงการ</h2>
            <p className="cs-note">ตามแม่แบบ {tpl.title} · แถบสีคือช่วงวันที่ของแต่ละงาน เส้นแดงคือวันนี้</p>
          </div>
          <Segmented label="ผู้ทำงาน" value={grp} onChange={setGrp} options={[{ v: 'all', label: 'ทั้งหมด' }, { v: 'gcc', label: 'ทีม GCC' }, { v: 'client', label: 'ลูกค้า' }, { v: 'ext', label: 'ผู้ทวนสอบและ อบก.' }]} />
        </div>
        <div className="cs-legend" aria-hidden="true">
          <span><i className="ph" />ช่วงงาน</span><span><i className="done" />เสร็จ</span><span><i className="going" />กำลังทำ</span>
          <span><i className="late" />เลยกำหนด</span><span><i className="todo" />ยังไม่เริ่ม</span>
        </div>
        <div className="cs-gantt">
          <div className="cs-g">
            <div className="cs-gr cs-gh">
              <span>WBS</span><span>งาน</span><span>ผู้รับผิดชอบ</span><span>%</span>
              <span className="cs-gt">
                {months.map((m) => <span key={m.label} className="cs-gm" style={{ left: `${m.left}%` }}>{m.label}</span>)}
                {now}
              </span>
            </div>
            {p.phases.map((ph) => {
              const ts = ph.tasks.filter((t) => inGroup(ownerOf(t.owner).group, grp));
              if (!ts.length) return null;
              const pv = v.phases.find((x) => x.no === ph.no)!;
              return (
                <div key={ph.no} role="rowgroup" className="cs-gp">
                  <div className="cs-gr ph">
                    <b>{ph.no}. {ph.name}</b><span>{pctW(pv.pct)}</span>
                    <span className="cs-gt"><i className="ph" style={bar(pv.from, pv.to)} />{now}</span>
                  </div>
                  {ts.map((t) => <PlanRow key={t.wbs} t={t} today={today} hold={hold} bar={bar(t.start, t.end)} now={now} />)}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="cs-3">
        <section className="card cs-card" aria-labelledby="cs-nx-t">
          <h2 id="cs-nx-t">เลยกำหนดและถัดไป</h2>
          {v.next.length ? v.next.map((t) => {
            const late = taskState(t, today, hold) === 'late';
            return (
              <div className={'cs-nxr' + (late ? ' late' : '')} key={t.wbs}>
                <b>{t.wbs} {t.name}</b>
                <small>{ownerOf(t.owner).name} · {hold ? 'โครงการพักไว้' : `${dueWords(t.end, today)} (${shortDate(t.end, today)})`}</small>
              </div>
            );
          }) : <p className="cs-empty">เสร็จทุกงานแล้ว</p>}
        </section>
        <section className="card cs-card" aria-labelledby="cs-dv-t">
          <h2 id="cs-dv-t">เอกสารส่งมอบ</h2>
          {deliver.length ? deliver.map((t) => (
            <div className="cs-dv" key={t.wbs}>
              <span>{t.name}<small>งาน {t.wbs} · ครบกำหนด {shortDate(t.end, today)}</small></span>
              <Status kind={t.pr >= 1 ? 'ok' : 'neutral'} chip>{t.pr >= 1 ? 'ส่งแล้ว' : 'ยังไม่ส่ง'}</Status>
            </div>
          )) : <p className="cs-empty">แม่แบบนี้ไม่มีเอกสารส่งมอบ</p>}
        </section>
        <section className="card cs-card" aria-labelledby="cs-rk-t">
          <h2 id="cs-rk-t">ความเสี่ยงและประเด็น</h2>
          <p className="cs-empty">ยังไม่มีประเด็นในโครงการนี้ ขั้นต่อไปจะบันทึกได้ 5 แบบ: แก้ไข ปัญหา ความเสี่ยง คำถาม และอื่นๆ</p>
        </section>
      </div>
    </>
  );
}

function PlanRow({ t, today, hold, bar, now }: { t: Task; today: string; hold: boolean; bar: { left: string; width: string }; now: ReactNode }) {
  const o = ownerOf(t.owner), s = taskState(t, today, hold);
  return (
    <div className={'cs-gr' + (s === 'late' ? ' late' : '')}>
      <span className="cs-wbs">{t.wbs}</span>
      <span className="cs-tn" title={t.name}>{t.name}</span>
      <span><span className={'cs-own ' + o.group}>{o.name}</span></span>
      <span>{pctW(t.pr)}</span>
      <span className="cs-gt">
        <i className={BAR_CLS[s]} style={bar} title={`${t.wbs} ${t.name} · ${shortDate(t.start, today)}${t.start === t.end ? '' : ' ถึง ' + shortDate(t.end, today)}`} />
        {now}
      </span>
    </div>
  );
}

/** 3C: the money of every project in one place: value, billed, received, still owed, expenses; invoices; expenses. */
function Finance({ projects, today, money, openP }: { projects: Project[]; today: string; money: boolean; openP: (id: string) => void }) {
  if (!money)
    return (
      <section className="card cs-card cs-lock">
        <span className="cs-mark" aria-hidden="true"><Icon name="lock" /></span>
        <h1 id="page-title">วางบิลและค่าใช้จ่าย</h1>
        <p>หน้านี้รวมยอดเงินของงานที่ปรึกษาทั้งหมด เปิดได้เฉพาะบัญชีที่มีสิทธิ์ดูยอดเงิน เช่น ผู้บริหารและบัญชี</p>
      </section>
    );
  const T = moneyTotals(projects);
  const { invoices, expenses } = sampleBills(today);
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name || id;
  const m = (x: number) => fmtN(x);
  return (
    <>
      <div className="cs-h">
        <div>
          <h1 id="page-title">วางบิลและค่าใช้จ่าย</h1>
          <p>ยอดเงินของงานที่ปรึกษาทั้งหมดอยู่ที่หน้านี้หน้าเดียว · หน่วยเป็นบาท</p>
        </div>
      </div>
      <section className="cs-kpis five" aria-label="ยอดรวม">
        <div className="cs-kpi hero"><span>มูลค่าโครงการรวม</span><b>{m(T.budget)}</b></div>
        <div className="cs-kpi"><span>วางบิลแล้ว</span><b>{m(T.billed)}</b><small>{pctW(T.billedShare)} ของมูลค่า</small></div>
        <div className="cs-kpi"><span>รับเงินแล้ว</span><b>{m(T.paid)}</b></div>
        <div className={'cs-kpi' + (T.due ? ' late' : '')}><span>ค้างรับ</span><b>{m(T.due)}</b><small>วางบิลแล้ว ยังไม่ได้รับ</small></div>
        <div className="cs-kpi"><span>ค่าใช้จ่าย</span><b>{m(T.exp)}</b></div>
      </section>
      <section className="card cs-card" aria-labelledby="cs-mp-t">
        <h2 id="cs-mp-t">รายโครงการ</h2>
        <div className="cs-tbl money" role="table" aria-label="ยอดเงินรายโครงการ">
          <div className="cs-tr cs-th" role="row">
            <span role="columnheader">โครงการ</span><span role="columnheader">มูลค่า</span><span role="columnheader">วางบิลแล้ว</span>
            <span role="columnheader">รับแล้ว</span><span role="columnheader">ค้างรับ</span><span role="columnheader">ยังไม่วางบิล</span><span role="columnheader">ค่าใช้จ่าย</span>
          </div>
          {projects.map((p) => {
            const x = p.money, due = x.billed - x.paid;
            return (
              <div className="cs-tr" role="row" key={p.id}>
                <span role="cell" className="cs-name"><button type="button" className="lnk" onClick={() => openP(p.id)}>{p.name}</button><small>{ownerOf(p.owner).name}</small></span>
                <span role="cell" className="num">{x.budget ? m(x.budget) : 'ยังไม่กำหนด'}</span>
                <span role="cell" className="num cs-pr">
                  <small>{m(x.billed)}</small>
                  <span className="cs-meter" aria-hidden="true"><i style={{ width: x.budget ? pctW(Math.min(1, x.billed / x.budget)) : '0%' }} /></span>
                </span>
                <span role="cell" className="num">{m(x.paid)}</span>
                <span role="cell" className={'num' + (due > 0 ? ' due' : '')}>{m(due)}</span>
                <span role="cell" className="num">{m(Math.max(0, x.budget - x.billed))}</span>
                <span role="cell" className="num">{m(x.exp)}</span>
              </div>
            );
          })}
        </div>
      </section>
      <div className="cs-2">
        <section className="card cs-card" aria-labelledby="cs-inv-t">
          <h2 id="cs-inv-t">ใบแจ้งหนี้</h2>
          {invoices.map((v) => (
            <div className="cs-li" key={v.no}>
              <span><b>{v.no}</b><small>{nameOf(v.project)} · {isoTh(v.date)} · {v.terms}</small></span>
              <span className="num"><b>{m(v.amount)}</b><small className={v.amount - v.paid > 0 ? 'due' : ''}>{v.amount - v.paid > 0 ? `ค้างรับ ${m(v.amount - v.paid)}` : 'รับครบแล้ว'}</small></span>
            </div>
          ))}
        </section>
        <section className="card cs-card" aria-labelledby="cs-exp-t">
          <h2 id="cs-exp-t">ค่าใช้จ่าย</h2>
          {expenses.map((x, i) => (
            <div className="cs-li" key={i}>
              <span><b>{x.item}</b><small>{nameOf(x.project)} · {isoTh(x.date)}</small></span>
              <span className="num"><b>{m(x.amount)}</b></span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
