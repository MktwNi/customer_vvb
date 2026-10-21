import { useRef, useState } from 'react';
import { useApp } from '../state';
import { jobServices, jointRole, payerDeal, trackerStatus, type Deal, type SalesState } from '../lib/sales';
import { jobCoKey, otherJobs, otherWords, repeatWords, repeats, svcChoices, svcClean, svcCommon, svcText } from '../lib/jobs';
import type { GccEngine } from '../lib/engine';
import { fmtN } from '../lib/format';
import { Pop } from './Pop';
import { JobSvc, SvcPick } from './SvcChips';

/** A job's state in one short phrase ("กำลังดำเนินการ", "ปิดงานแล้ว"). */
export const jobWord = (S: SalesState, d: Deal) => (d.jobStatus === 'closed' ? 'ปิดงานแล้ว' : trackerStatus(S, d).split(' · ')[0]);

/** Every row of `d`'s company (any year): the registry company's (engine.dealsOf, merged ids, a company of the
 *  TGO website sync by name), else the rows typed with the same name (never a placeholder name). */
export function coJobs(e: Pick<GccEngine, 'dealsOf' | 'sales'>, d: Deal): Deal[] {
  if (d.gid != null) return e.dealsOf(d.gid);
  const k = jobCoKey(d);
  return k ? Object.values(e.sales.deals).filter((x) => x.gid == null && jobCoKey(x) === k) : [d];
}

/**
 * The deal panel's "บริการ [CFP] แก้บริการ" under the name: the job's services, edited in one place (a popover
 * with the team's services; each tap is saved item by item, so a teammate's tick on another service stays). A
 * joint quotation's member is sold under its header's services: shown, edited on the quotation. Picking a
 * service another job of the company has that year is allowed (two products, two projects) and said.
 */
export function DealSvcRow({ d }: { d: Deal }) {
  const { engine: e } = useApp();
  const S = e.sales;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const jr = jointRole(S, d);
  const head = jr === 'member' ? payerDeal(S, d) : d;
  const fromHead = head !== d && head.service.length > 0;
  const svc = jobServices(S, d);
  const ro = !e.canDeal('edit.deal', d) || fromHead;
  const others = jr === 'header' ? [] : otherJobs(S, d, coJobs(e, d));
  const othersSvc = svcClean(others.flatMap((o) => jobServices(S, o)));
  const rep = repeats(S, d.service, others);
  return (
    <div className="dp-svc">
      <span className="dp-svc-l">บริการ</span>
      <JobSvc svc={svc} label={false} />
      {fromHead && <span className="t-meta">ตามใบเสนอราคาร่วม</span>}
      {!ro && (
        <button ref={btn} type="button" className="lnk" aria-expanded={open} onClick={() => setOpen(true)}>
          {svc.length ? 'แก้บริการ' : 'เลือกบริการ'}
        </button>
      )}
      {open && (
        <Pop anchor={btn} onClose={() => setOpen(false)} label="บริการของงานนี้" title="บริการของงานนี้" kind="dialog" width={520} className="val">
          <div className="dp-svc-pop">
            <span className="t-sec">บริการของงานนี้ เลือกได้หลายบริการ ถ้าอยู่ในใบเสนอราคาเดียวกัน</span>
            <SvcPick all={svcChoices(S)} team={S.cfg.services} value={d.service} onChange={(v) => e.updateDeal(d.id, { service: v })} label="บริการ" />
            {rep.length > 0 ? (
              <span className="t-warn" role="status">{repeatWords(svcCommon(d.service, rep.flatMap((o) => jobServices(S, o))), rep.length, d.year)}</span>
            ) : othersSvc.length > 0 ? (
              <span className="t-meta">{otherWords(othersSvc, others.length, d.year)}</span>
            ) : null}
            <button type="button" className="btn sm" style={{ alignSelf: 'flex-end' }} onClick={() => setOpen(false)}>เสร็จ</button>
          </div>
        </Pop>
      )}
    </div>
  );
}

/** "งานอื่นของบริษัทนี้ปี 2569 [CFO] กำลังดำเนินการ · เปิดงาน CFO": the company's other jobs of the year (two,
 *  then "อีก N งาน"), each a step away. Nothing when it has none. */
export function OtherJobs({ d }: { d: Deal }) {
  const { engine: e, set } = useApp();
  const S = e.sales;
  if (jointRole(S, d) === 'header') return null;
  const others = otherJobs(S, d, coJobs(e, d));
  if (!others.length) return null;
  return (
    <div className="dp-oth">
      <span>งานอื่นของบริษัทนี้ปี {d.year}</span>
      {others.slice(0, 2).map((o, i, shown) => {
        const sv = svcText(jobServices(S, o));
        // two of them with the same services: told apart by who is responsible
        const twin = shown.some((x) => x !== o && svcText(jobServices(S, x)) === sv);
        return (
          <span key={o.id} className="dp-oth-j">
            <JobSvc svc={jobServices(S, o)} /> {jobWord(S, o)} ·{' '}
            <button type="button" className="lnk" onClick={() => set({ deal: o.id })}>{`เปิดงาน${sv ? ' ' + sv : ''}${twin ? ` ของ${o.resp || 'งานที่ ' + (i + 1)}` : ''}`}</button>
          </span>
        );
      })}
      {others.length > 2 && <span>{`อีก ${fmtN(others.length - 2)} งาน`}</span>}
    </div>
  );
}
