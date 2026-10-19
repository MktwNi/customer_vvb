import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CST } from '../lib/constants';
import { fmtN, isoTh, todayISO } from '../lib/format';
import { beYear } from '../lib/sales';
import { LOCAL_ONLY, NOT_IN_TRACKER, apptLine, apptWhen, followCounts, followIdsOf, followMatch, followMeta, followRows, type FollowRow } from '../lib/follow';
import type { CfoStatus, Task } from '../lib/types';
import { PageHead, Status } from '../components/ui';
import { CoAvatar } from '../components/CoAvatar';
import { isLocalId } from '../lib/teamSync';

/** A CFO status as on ค้นหา: dot + word; "ใกล้หมดอายุ" (needs action now) a tinted chip. */
const cfoStatus = (st: CfoStatus) =>
  st === 'soon' ? <Status kind="warn" chip>{CST[st][0]}</Status> : <Status kind={st === 'active' ? 'ok' : st === 'expired' ? 'bad' : 'neutral'}>{CST[st][0]}</Status>;
/** Show this many, then more on request (the ones needing attention are first). */
const STEP = 40;
/** A quick filter once the list is longer than this. */
const FILTER_FROM = 8;

/**
 * บริษัทที่ติดตาม, first on the ติดตาม page: the companies the team follows (crm.watch: one list for the
 * whole team once connected, else this browser's), each with its certificates, its row in the Sales
 * Tracker of the year, its next appointment and its owner, the ones needing attention first (lib/follow.ts).
 * A click on a row opens the company. Read-only accounts see the list without its buttons.
 */
export function FollowList() {
  const { engine: e, ui, set, go, open, openSched } = useApp();
  const v = useEngineVersion();
  const D = e.B.D;
  const today = todayISO();
  const year = ui.slYear || beYear();
  const rows = useMemo(() => followRows(e, year, today), [e, v, year, today]);
  const [q, setQ] = useState('');
  const [lim, setLim] = useState(STEP);
  // the one just unfollowed, to take it back (gone after a while)
  const [gone, setGone] = useState<{ ids: number[]; name: string } | null>(null);
  useEffect(() => {
    if (!gone) return;
    const t = setTimeout(() => setGone(null), 12000);
    return () => clearTimeout(t);
  }, [gone]);

  const canCust = e.can('edit.cust'), canTask = e.can('edit.task');
  const seeSales = e.can('view.sales'), canSend = seeSales && e.can('edit.deal');
  // แผนติดต่อ is a page of its own (view.plan): a role that may make appointments but not open it plans here, row by row
  const canPlan = canTask && e.can('view.plan');
  const acts = canCust || canTask;
  const prov = (r: FollowRow) => D.prov[r.c.prov] || '';
  const team = !!e.teamCfg;
  // companies from the TGO website sync are this device's own: their follow is not shared with the team
  const localN = team ? rows.filter((r) => isLocalId(r.c.id)).length : 0;
  const shownAll = q.trim() ? rows.filter((r) => followMatch(q, r, prov(r))) : rows;
  const shown = shownAll.slice(0, lim);
  const n = followCounts(rows, today);
  const notIn = rows.filter((r) => !r.deal);
  const pageActs = (canSend && notIn.length > 0) || canPlan;
  const cols = ['minmax(0,2fr)', 'minmax(152px,1.1fr)', seeSales ? 'minmax(0,1.2fr)' : '', 'minmax(146px,1fr)', 'minmax(76px,.7fr)', acts ? '140px' : ''].filter(Boolean).join(' ');

  /** Stop following: every followed id that is this company (a row since merged into it counts). */
  const unfollow = (r: FollowRow) => {
    const ids = followIdsOf(e.crm.watch, r.c.id, (id) => e.canonical(id));
    ids.forEach((id) => e.toggleWatch(id));
    setGone({ ids, name: r.c.name });
  };
  const refollow = () => {
    gone?.ids.forEach((id) => !e.crm.watch.includes(id) && e.toggleWatch(id));
    setGone(null);
  };
  /** A click anywhere on a row opens the company (not on its buttons, nor when text was selected). */
  const rowOpen = (ev: MouseEvent, id: number) => {
    if ((ev.target as HTMLElement).closest('button, a, input')) return;
    if (window.getSelection()?.toString()) return;
    open(id);
  };
  const toSearch = () => {
    go('search');
    setTimeout(() => document.getElementById('search-q')?.focus(), 60);
  };

  const sum: [string, number, string][] = [
    ['นัดเลยกำหนด', n.late, 't-bad'],
    ['นัดวันนี้', n.today, 't-warn'],
    ['ใบรับรองใกล้หมดอายุ', n.expiring, 't-warn'],
    ['ยังไม่มีนัด', n.noPlan, ''],
    ...(seeSales ? [['ยังไม่อยู่ใน Sales Tracker', n.notIn, ''] as [string, number, string]] : []),
  ];
  const sumOn = sum.filter((x) => x[1] > 0);

  return (
    <>
      {/* (its name stays on a phone, where page titles give way to the top bar's: this is a section of ติดตาม;
          track-watch: where the search page's "ดูบริษัทที่ติดตาม" lands, components/SalesToast.tsx goTrack) */}
      <div className="fw-head" id="track-watch">
      <PageHead
        title="บริษัทที่ติดตาม"
        sub={`${rows.length ? fmtN(rows.length) + ' บริษัท · ' : ''}${team ? 'รายชื่อเดียวกันทั้งทีม' + (localN ? ` ยกเว้น ${fmtN(localN)} บริษัทที่${LOCAL_ONLY}` : '') : 'บันทึกในเครื่องนี้'}`}
        right={rows.length > 0 && pageActs ? (
          <div className="fw-pacts">
            {canSend && notIn.length > 0 && (
              <button onClick={() => set({ sendIds: notIn.map((r) => r.c.id) })} className="btn sm" title={`${fmtN(notIn.length)} บริษัทที่ยังไม่อยู่ในตารางปี ${year}`}>
                ส่งเข้า Sales Tracker ทั้งหมด ({fmtN(notIn.length)})
              </button>
            )}
            {canPlan && <button onClick={() => go('plan', { plFeed: 'watch', picked: {}, plLim: 60 })} className="btn sm pri">วางแผนติดต่อทั้งหมด</button>}
          </div>
        ) : undefined}
      />
      </div>
      <section className="fw card" aria-label="บริษัทที่ติดตาม">
        {/* (the live region is always there, so the line is read out when it comes) */}
        <div role="status">
          {gone && (
            <div className="fw-undo">
              <span>เลิกติดตาม {gone.name} แล้ว</span>
              <button onClick={refollow} className="lnk">ติดตามต่อ</button>
            </div>
          )}
        </div>
        {!rows.length ? (
          <div className="fw-empty">
            <span className="card-t">ยังไม่ได้ติดตามบริษัท</span>
            {canCust ? (
              <>
                <span className="t-sec">เปิดหน้าบริษัทแล้วกด “ติดตาม” หรือในหน้าค้นหา กด “เลือกทั้งหมด” หรือติ๊กหลายบริษัท แล้วกด “ติดตาม” บริษัทจะขึ้นที่นี่ พร้อมนัดถัดไปและสถานะใน Sales Tracker</span>
                <button onClick={toSearch} className="lnk">เลือกบริษัทจากหน้าค้นหา</button>
              </>
            ) : (
              <span className="t-sec">เมื่อทีมกด “ติดตาม” ที่หน้าบริษัท รายชื่อจะขึ้นที่นี่</span>
            )}
          </div>
        ) : (
          <>
            <div className="fw-top">
              <div className="fw-top-t">
                <p className="fw-sum">
                  {sumOn.length ? sumOn.map(([l, x, cls]) => <span key={l} className={cls || undefined}>{l} {fmtN(x)}</span>) : <span>ทุกบริษัทมีนัดแล้ว และไม่มีใบรับรองใกล้หมดอายุ</span>}
                </p>
                <span className="t-meta">เรียงจากเรื่องที่ต้องทำก่อน: นัดที่ถึงกำหนด ใบรับรองใกล้หมดอายุ แล้วบริษัทที่ยังไม่มีนัด</span>
              </div>
              {(rows.length > FILTER_FROM || q !== '') && (
                <input
                  type="search"
                  className="fld fw-q"
                  value={q}
                  onChange={(ev) => { setQ(ev.target.value); setLim(STEP); }}
                  placeholder="ค้นหาชื่อ จังหวัด หรือผู้รับผิดชอบ"
                  aria-label="ค้นหาในบริษัทที่ติดตาม"
                />
              )}
            </div>
            <div className="fw-th thead" style={{ gridTemplateColumns: cols }} aria-hidden="true">
              <span>บริษัท</span>
              <span>CFO · GI</span>
              {seeSales && <span>Sales Tracker ปี {year}</span>}
              <span>นัดถัดไป</span>
              <span>ผู้รับผิดชอบ</span>
              {acts && <span />}
            </div>
            <div className="fw-list">
              {shown.map((r) => (
                <div key={r.c.id} className="fw-r" style={{ gridTemplateColumns: cols }} onClick={(ev) => rowOpen(ev, r.c.id)}>
                  <button onClick={() => open(r.c.id)} className="fw-name">
                    <CoAvatar name={r.c.name} web={r.c.web} set={r.c.set} size={32} />
                    <span className="fw-name-t">
                      <span className="t-name">{r.c.name}</span>
                      <span className="t-meta" title={team && isLocalId(r.c.id) ? 'บริษัทที่ดึงเพิ่มจากเว็บ TGO เก็บเฉพาะเครื่องนี้ เพื่อนร่วมทีมไม่เห็นในรายชื่อ' : undefined}>{followMeta(r.c, prov(r), team)}</span>
                    </span>
                  </button>
                  <Cell label="CFO · GI">
                    {cfoStatus(r.cfoSt)}
                    <CertLine r={r} />
                  </Cell>
                  {seeSales && (
                    <Cell label={`Sales Tracker ปี ${year}`}>
                      {r.deal ? <span>{r.status}</span> : <span className="t-muted">{NOT_IN_TRACKER}</span>}
                      {!r.deal && canSend && <button onClick={() => set({ sendIds: [r.c.id] })} className="lnk fw-a">ส่งเข้า Sales Tracker</button>}
                    </Cell>
                  )}
                  <Cell label="นัดถัดไป">
                    {r.task ? (
                      <>
                        <Appt t={r.task} />
                        <When date={r.task.date} today={today} />
                      </>
                    ) : (
                      <span className="t-muted">ยังไม่มีนัด</span>
                    )}
                  </Cell>
                  <Cell label="ผู้รับผิดชอบ">{r.owner ? <span>{r.owner}</span> : <span className="t-muted" title="ยังไม่มีผู้รับผิดชอบ">—</span>}</Cell>
                  {acts && (
                    <span className="fw-acts">
                      {canTask && <button onClick={() => openSched({ ids: [r.c.id] })} className="btn xs" aria-label={'นัด ' + r.c.name}>นัด</button>}
                      {canCust && <button onClick={() => unfollow(r)} className="quiet" aria-label={'เลิกติดตาม ' + r.c.name}>เลิกติดตาม</button>}
                    </span>
                  )}
                </div>
              ))}
              {!shown.length && (
                <div className="fw-none">
                  <span className="empty">ไม่พบบริษัทที่ติดตามที่ตรงกับคำค้น</span>
                  <button onClick={() => setQ('')} className="lnk">ล้างคำค้น</button>
                </div>
              )}
            </div>
            {shownAll.length > shown.length && (
              <div className="fw-more">
                <button onClick={() => setLim(lim + STEP)} className="lnk">แสดงเพิ่ม (อีก {fmtN(shownAll.length - shown.length)} บริษัท)</button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

/** A cell of the list; its column's name shows inside it when the rows are stacked (narrow card, phone). */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="fw-c">
      <span className="fw-lbl">{label}</span>
      {children}
    </span>
  );
}

/** The CFO's days or date, then the GI level in force (amber while it is about to end). */
function CertLine({ r }: { r: FollowRow }) {
  const c = r.c;
  const cfo = c.cfoSt === 'soon' ? `เหลือ ${fmtN(c.days)} วัน · ${isoTh(c.cfoEx)}` : c.cfoSt === 'expired' ? `หมด ${isoTh(c.cfoEx)}` : c.cfoSt === 'active' ? `ถึง ${isoTh(c.cfoEx)}` : '';
  const gi = c.giLive
    ? `GI ระดับ ${c.giLive}${r.giSoon && r.giDays != null ? ` · เหลือ ${fmtN(r.giDays)} วัน` : c.giUntil ? ` · ถึง ${isoTh(c.giUntil)}` : ''}`
    : c.giMax ? `GI เคยได้ระดับ ${c.giMax}` : '';
  return (
    <>
      {cfo && <span className="t-meta">{cfo}</span>}
      {gi && <span className={r.giSoon ? 't-warn fw-gi' : 't-meta'}>{gi}</span>}
    </>
  );
}

/** "โทร · 14 ต.ค. 2569 10:00", the day and time kept on one line. */
function Appt({ t }: { t: Task }) {
  const [type, ...rest] = apptLine(t).split(' · ');
  return (
    <span>
      {type} · <span className="fw-nw">{rest.join(' · ')}</span>
    </span>
  );
}

function When({ date, today }: { date: string; today: string }) {
  const w = apptWhen(date, today);
  return <span className={w.kind ? 't-' + w.kind + ' fw-when' : 't-meta'}>{w.text}</span>;
}
