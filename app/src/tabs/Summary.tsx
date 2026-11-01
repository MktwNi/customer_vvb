import { useMemo, useState } from 'react';
import { useApp, useEngineVersion, type Tab } from '../state';
import { execSummary, type ExecChange, type ExecFollowUp, type ExecPeriodKind, type ExecStage, type ExecSummary, type ExecWeek } from '../lib/execSummary';
import { dmTh, fmtN, isoTh, money, todayISO } from '../lib/format';
import { rangeTh } from '../lib/dateRange';
import { Kpi, PageHead, SectionHead, Segmented, Status, type StatusKind } from '../components/ui';

/** The period buttons, in order, and the word each one compares with. */
const PERIODS: { v: ExecPeriodKind; label: string; before: string }[] = [
  { v: 'week', label: 'สัปดาห์นี้', before: 'สัปดาห์ก่อน' },
  { v: 'month', label: 'เดือนนี้', before: 'เดือนก่อน' },
  { v: 'quarter', label: 'ไตรมาส', before: 'ไตรมาสก่อน' },
];
/** The period the page opens on (kept on the page only: a new visit starts here again). */
export const DEFAULT_PERIOD: ExecPeriodKind = 'month';

/** A count against the period before it, in words (no arrows): "สูงกว่าช่วงก่อน 21% (จาก 121 ครั้ง)". */
export function changeWords(c: ExecChange, unit: string): string {
  if (c.delta === 0) return `เท่ากับช่วงก่อน (${fmtN(c.prev)} ${unit})`;
  if (c.pct == null) return 'ช่วงก่อนไม่มีรายการ';
  return `${c.delta > 0 ? 'สูงกว่า' : 'ต่ำกว่า'}ช่วงก่อน ${Math.round(Math.abs(c.pct) * 100)}% (จาก ${fmtN(c.prev)} ${unit})`;
}

/** A bar's width in per cent of the largest figure (0 when nothing is counted). */
const share = (n: number, max: number) => (max > 0 ? `${(n / max) * 100}%` : '0%');
/** One bucket of the period as a short range: "1–3 ต.ค." (a bucket that is not in the period has no range). */
const bucketTh = (w: ExecWeek) => (!w.from ? '—' : w.from === w.to ? dmTh(w.from) : `${dmTh(w.from)}–${dmTh(w.to)}`);
const STATUS: Record<string, StatusKind> = { bad: 'bad', warn: 'warn', '': 'neutral' };
/** The period's name as the bucket caption reads it: "รายช่วงของเดือน". */
const UNIT_TH: Record<ExecPeriodKind, string> = { week: 'สัปดาห์', month: 'เดือน', quarter: 'ไตรมาส' };

/**
 * The page's data and its period buttons: the period is kept on the page (useState) and every figure is read from
 * lib/execSummary.ts for it. It writes nothing and calls nothing over the network.
 */
export function Summary() {
  const { engine: e, ui, go, open, set } = useApp();
  const v = useEngineVersion();
  const [kind, setKind] = useState<ExecPeriodKind>(DEFAULT_PERIOD);
  const today = todayISO();
  const s = useMemo(() => execSummary(e, kind, today, { year: ui.slYear }), [e, kind, today, ui.slYear, v]);
  return (
    <SummaryPage
      s={s} kind={kind} year={ui.slYear} today={today} canMoney={e.can('view.money')}
      onKind={setKind}
      onOpen={(id) => open(id)}
      onOpenDeal={(id) => set({ deal: id })}
      onGo={(t: Tab) => go(t)}
    />
  );
}

export interface SummaryPageProps {
  s: ExecSummary;
  kind: ExecPeriodKind;
  /** The Sales Tracker year (B.E.) the jobs and the funnel are read in. */
  year: string;
  today: string;
  /** Money (Forecast, Actual) shows only to an account that may see it. */
  canMoney: boolean;
  onKind: (k: ExecPeriodKind) => void;
  onOpen: (companyId: number) => void;
  onOpenDeal: (dealId: string) => void;
  onGo: (t: Tab) => void;
}

/** The one-page summary as markup: no state, no engine. */
export function SummaryPage({ s, kind, year, today, canMoney, onKind, onOpen, onOpenDeal, onGo }: SummaryPageProps) {
  const P = s.period;
  const before = PERIODS.find((p) => p.v === kind)?.before ?? '';
  const { won } = s.kpis;
  const chMax = Math.max(0, ...s.channels.map((c) => c.count));
  const wkMax = Math.max(0, ...s.weeks.map((w) => w.count));
  const stMax = Math.max(0, ...s.funnel.map((f: ExecStage) => f.count));
  const late = s.kpis.followOverdue, due = s.kpis.followDue;

  return (
    <>
      <PageHead
        title="สรุปผู้บริหาร"
        sub={`${rangeTh({ from: P.from, to: P.to })} · เทียบกับช่วงเดียวกันของ${before}`}
        right={<Segmented value={kind} label="ช่วงเวลา" options={PERIODS.map((p) => ({ v: p.v, label: p.label }))} onChange={onKind} />}
      />

      <section className="kpis" aria-label="ตัวเลขหลัก">
        <Kpi label="ติดต่อทั้งหมด" value={fmtN(s.kpis.contacts.value)} unit="ครั้ง" foot={changeWords(s.kpis.contacts, 'ครั้ง')} />
        <Kpi label="บริษัทที่ติดต่อ" value={fmtN(s.kpis.companies.value)} unit="บริษัท" foot={changeWords(s.kpis.companies, 'บริษัท')} />
        <Kpi
          label="งานที่ปิดได้"
          value={fmtN(won.jobs)}
          unit="งาน"
          foot={canMoney ? `มูลค่า Forecast ${money(won.fc)}` : `ทำงานให้ ${fmtN(won.worked)} บริษัท`}
        />
        <Kpi
          label="ต้องติดตามต่อ"
          value={fmtN(late + due)}
          unit="รายการ"
          foot={<><span className={late ? 'bad' : undefined}>เกินกำหนด {fmtN(late)}</span> · วันนี้ {fmtN(due)}</>}
        />
      </section>

      <div className="ex-cols">
        <section className="card ex-card" aria-labelledby="ex-ch-h">
          <SectionHead as="h3" id="ex-ch-h" title="ติดต่อด้วยช่องทางไหน" sub={`${fmtN(s.total)} ครั้ง`} />
          {s.total === 0 ? (
            <p className="empty">ยังไม่มีการติดต่อในช่วงนี้</p>
          ) : (
            <div className="ex-chan">
              {s.channels.map((c) => (
                <div className="ex-row" key={c.key}>
                  <span>{c.label}</span>
                  <span className="ex-bar" aria-hidden="true"><i style={{ width: share(c.count, chMax) }} /></span>
                  <span className="ex-num">{fmtN(c.count)} <span className="t-muted">{Math.round(c.share * 100)}%</span></span>
                </div>
              ))}
            </div>
          )}
          <div>
            <p className="t-meta ex-cap">จำนวนการติดต่อรายช่วงของ{UNIT_TH[kind]}</p>
            <div className="ex-wk">
              {s.weeks.map((w, i) => (
                <div className="ex-wk-c" key={i}>
                  <span className="num">{fmtN(w.count)}</span>
                  <span className="ex-wk-b" aria-hidden="true"><i style={{ height: share(w.count, wkMax) }} /></span>
                  <span className="t-meta">{bucketTh(w)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card ex-card" aria-labelledby="ex-fn-h">
          <SectionHead as="h3" id="ex-fn-h" title="งานเดินหน้าไปถึงไหน" sub={`ทั้งปี ${year} · ไม่ตามช่วงเวลา`} />
          <div className="ex-stages">
            {s.funnel.map((f) => (
              <div className="ex-stage" key={f.key}>
                <span>{f.label}</span>
                <b className="num">{fmtN(f.count)}</b>
                <span className="ex-bar" aria-hidden="true"><i style={{ width: share(f.count, stMax) }} /></span>
              </div>
            ))}
          </div>
          <div className="ex-won">
            <span className="t-sec">ได้งานในช่วงที่เลือก {fmtN(won.jobs)} งาน · ทำงานให้ {fmtN(won.worked)} บริษัท</span>
            {canMoney && (
              <span className="ex-money num">
                <span className="t-meta">Forecast</span> <b>{money(won.fc)}</b>
                <span className="t-meta"> · Actual</span> <b>{money(won.ac)}</b>
              </span>
            )}
          </div>
          <p className="t-meta">ปิดงานในช่วงที่เลือกทั้งหมด {fmtN(won.closedJobs)} งาน · ไม่ได้งาน {fmtN(won.lost)} งาน</p>
        </section>
      </div>

      <div className="ex-cols">
        <section className="card ex-card" aria-labelledby="ex-rc-h">
          <SectionHead as="h3" id="ex-rc-h" title="สิ่งที่ติดต่อไปแล้ว (ล่าสุด)" />
          {s.recent.length === 0 ? (
            <p className="empty">ยังไม่มีการติดต่อในช่วงนี้</p>
          ) : (
            <table className="ex-tbl">
              <thead>
                <tr><th className="ex-d">วันที่</th><th>บริษัท</th><th className="ex-ch">ช่องทาง</th><th className="ex-rs">ผล</th></tr>
              </thead>
              <tbody>
                {s.recent.map((r, i) => {
                  const openable = r.deal !== '' || r.companyId != null;
                  return (
                    <tr key={i}>
                      <td className="ex-d num">{dmTh(r.day)}</td>
                      <td>
                        {openable ? (
                          <button type="button" className="ex-name co-name dense" onClick={() => (r.deal ? onOpenDeal(r.deal) : onOpen(r.companyId!))}>{r.name}</button>
                        ) : (
                          r.name
                        )}
                      </td>
                      <td className="ex-ch">{r.channel}</td>
                      <td className={'ex-rs' + (r.result ? '' : ' t-muted')}>{r.result || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="card ex-card" aria-labelledby="ex-fu-h">
          <SectionHead as="h3" id="ex-fu-h" title="ต้องติดตามต่อ" sub="เลยกำหนดก่อน แล้วนัดวันนี้ และนัดถัดไป" />
          {s.followUps.length === 0 ? (
            <p className="empty">ไม่มีรายการที่ต้องติดตามต่อ</p>
          ) : (
            <ul className="ex-fu">
              {s.followUps.map((f: ExecFollowUp) => (
                <li key={f.id}>
                  <div className="ex-fu-h">
                    <button type="button" className="ex-name co-name" onClick={() => onOpen(f.id)}>{f.name}</button>
                    <Status kind={STATUS[f.when.kind]} chip>{f.when.text}</Status>
                  </div>
                  {f.line && <span className="t-sec">{f.line}</span>}
                  <span className="t-meta">{f.contact}</span>
                  {f.owner && <span className="t-meta">ผู้รับผิดชอบ {f.owner}</span>}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="lnk ex-more" onClick={() => onGo('track')}>ดูทั้งหมดในหน้าติดตาม</button>
        </section>
      </div>

      <p className="ex-foot">คำนวณจากบันทึกการติดต่อและงานในระบบ · ข้อมูล ณ สิ้นสุดวันนี้ ({isoTh(today)})</p>
    </>
  );
}
