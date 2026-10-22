import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { Icon } from '../components/icons';
import { BulkBar, followSel, useSel } from '../components/BulkBar';
import { TickBox } from '../components/MonthCheck';
import { useSalesActs } from '../components/SalesToast';
import { CST } from '../lib/constants';
import { fmtN, isoTh, todayISO } from '../lib/format';
import { beYear, jobServices } from '../lib/sales';
import { JobSvc } from '../components/SvcChips';
import { LOCAL_ONLY, NOT_IN_TRACKER, apptLine, apptWhen, followCounts, followFilter, followIdsOf, followMeta, followQOf, followRows, followSelKey, type FollowRow } from '../lib/follow';
import { allPickWord, bulkPickable, clearedWord, followedBatch, followedSendTip, followedSendWord, pruneSel, selView, toggleAll, toggleKey } from '../lib/bulk';
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
const NONE: ReadonlySet<number> = new Set();

/**
 * บริษัทที่ติดตาม, first on the ติดตาม page: the companies the team follows (crm.watch: one list for the
 * whole team once connected, else this browser's), each with its certificates, its row in the Sales
 * Tracker of the year, its next appointment and its owner, the ones needing attention first (lib/follow.ts).
 * A click on a row opens the company. Read-only accounts see the list without its buttons; an account that may change
 * follows also gets a box on each row, "เลือกทั้งหมด" and the bulk bar (components/BulkBar.tsx), as on ค้นหา.
 */
export function FollowList() {
  const { engine: e, ui, set, go, open, openSched } = useApp();
  const v = useEngineVersion();
  const D = e.B.D;
  const today = todayISO();
  const year = ui.slYear || beYear();
  const rows = useMemo(() => followRows(e, year, today), [e, v, year, today]);
  // the quick filter the picks were made under is read back (followSel's key), so a page that comes back keeps both
  const [q, setQ] = useState(() => followQOf(followSel.get().key));
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
  // the quick filter's rows: all of them, not only the page shown (the select-all picks every one of them)
  const shownAll = useMemo(() => followFilter(rows, q, (r) => D.prov[r.c.prov] || ''), [rows, q, D]);
  const shown = shownAll.slice(0, lim);

  // ---- picking companies for the bulk bar (components/BulkBar.tsx, the same as ค้นหา): kept while the list is
  // open; let go (and said) when the quick filter changes, and a company that left the list is let go
  const rowsCo = useMemo(() => shownAll.map((r) => r.c), [shownAll]);
  const key = followSelKey(q);
  const S = useSel(followSel);
  const sel = S.key === key ? S.ids : NONE;
  const sv = useMemo(() => selView(sel, rowsCo), [sel, rowsCo]);
  const { say } = useSalesActs();
  useEffect(() => {
    const cur = followSel.get();
    if (cur.key !== key) {
      if (cur.ids.size && cur.key) say(clearedWord(cur.ids.size, 'co'));
      followSel.set({ key, ids: new Set() });
    } else {
      const p = pruneSel(cur.ids, rowsCo);
      if (p !== cur.ids) followSel.set({ key, ids: p });
    }
  }, [key, rowsCo]); // eslint-disable-line react-hooks/exhaustive-deps
  // boxes and the bar only for an account that may change follows (as the row's ติดตาม button, canCust)
  const canPick = bulkPickable((c) => e.can(c));
  const pickOne = (id: number) => followSel.set({ key, ids: toggleKey(sel, id) });
  const pickAll = () => followSel.set({ key, ids: toggleAll(sel, rowsCo) });
  // Escape lets the picks go, but not while a dialog or a menu is open, nor from a field
  const picked = sv.n > 0;
  useEffect(() => {
    if (!picked) return;
    const h = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return;
      const t = ev.target instanceof Element ? ev.target : null;
      if (t?.closest('input, textarea, select, [contenteditable]') || document.querySelector('[role=dialog], [role=menu]')) return;
      followSel.set({ key, ids: new Set() });
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [picked, key]);
  // a bulk unfollow confirmed from the keyboard: the bar and its dialog go with the companies taken off, and the focus
  // would fall to the page's body. It moves to the list's own control instead (the header box, else the link of the
  // empty state or of the filter that matched nothing). A pointer's confirm leaves the focus as it falls.
  const selAllRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const [unfollowN, setUnfollowN] = useState(0);
  useEffect(() => {
    if (!unfollowN) return;
    (selAllRef.current ?? listRef.current?.querySelector<HTMLElement>('.fw-empty .lnk, .fw-none .lnk'))?.focus();
  }, [unfollowN]);
  /** A row's box, first in its name's cell. Its cell reaches the row's left edge (tabs track.css .fw-pk), so a near
   *  miss does not open the company. */
  const rowPick = (r: FollowRow) =>
    canPick && (
      <span className="fw-pk" onClick={() => pickOne(r.c.id)}>
        <TickBox checkbox on={sel.has(r.c.id)} label={'เลือก ' + r.c.name} onClick={() => pickOne(r.c.id)} />
      </span>
    );
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
    if ((ev.target as HTMLElement).closest('button, a, input, .fw-pk')) return;
    if (window.getSelection()?.toString()) return;
    open(id);
  };
  /** ส่งเข้า Sales Tracker ทั้งหมด: the ones not in the year's table, at most TRACKER_MAX a send (the dialog says how
   *  many are left for the next press). */
  const sendAll = () => {
    const b = followedBatch(notIn.map((r) => r.c.id));
    set({ sendIds: b.ids, sendMore: b.more });
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
              // one send adds at most TRACKER_MAX rows: past that, the first ones in the list's order (lib/bulk.ts)
              <button onClick={sendAll} className="btn sm" title={followedSendTip(notIn.length, year)}>
                {followedSendWord(notIn.length)}
              </button>
            )}
            {canPlan && <button onClick={() => go('plan', { plFeed: 'watch', picked: {}, plLim: 60 })} className="btn sm pri">วางแผนติดต่อทั้งหมด</button>}
          </div>
        ) : undefined}
      />
      </div>
      {/* the bulk bar above the list, as on ค้นหา (outside the card, so it stays under the top while the list scrolls) */}
      {canPick && rowsCo.length > 0 && <BulkBar view="co" rows={rowsCo} sel={sel} n={sv.n} store={followSel} sure undo onUnfollowed={(keyboard) => { if (keyboard) setUnfollowN((k) => k + 1); }} />}
      <section ref={listRef} className="fw card" aria-label="บริษัทที่ติดตาม">
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
                {canPick && rowsCo.length > 0 && (
                  <button ref={selAllRef} type="button" role="checkbox" aria-checked={sv.mixed ? 'mixed' : sv.all} className="bk-all fw-selall hv" onClick={pickAll}>
                    <span className={'ckb' + (sv.all || sv.mixed ? ' on' : '')} aria-hidden="true">
                      {sv.mixed ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" focusable="false"><path d="M6.5 12h11" /></svg> : sv.all ? <Icon name="check" size={14} /> : null}
                    </span>
                    {allPickWord(rowsCo.length)}
                  </button>
                )}
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
              <span className="fw-hd-who">{canPick && <span className="fw-hd-pk" />}<span>บริษัท</span></span>
              <span>CFO · GI</span>
              {seeSales && <span>Sales Tracker ปี {year}</span>}
              <span>นัดถัดไป</span>
              <span>ผู้รับผิดชอบ</span>
              {acts && <span />}
            </div>
            <div className="fw-list">
              {shown.map((r) => (
                <div key={r.c.id} className={'fw-r' + (sel.has(r.c.id) ? ' on' : '')} style={{ gridTemplateColumns: cols }} onClick={(ev) => rowOpen(ev, r.c.id)}>
                  <span className="fw-who">
                    {rowPick(r)}
                    <button onClick={() => open(r.c.id)} className="fw-name">
                      <CoAvatar name={r.c.name} web={r.c.web} set={r.c.set} size={32} />
                      <span className="fw-name-t">
                        <span className="co-name">{r.c.name}</span>
                        <span className="t-sec" title={team && isLocalId(r.c.id) ? 'บริษัทที่ดึงเพิ่มจากเว็บ TGO เก็บเฉพาะเครื่องนี้ เพื่อนร่วมทีมไม่เห็นในรายชื่อ' : undefined}>{followMeta(r.c, prov(r), team)}</span>
                      </span>
                    </button>
                  </span>
                  <Cell label="CFO · GI">
                    {cfoStatus(r.cfoSt)}
                    <CertLine r={r} />
                  </Cell>
                  {seeSales && (
                    <Cell label={`Sales Tracker ปี ${year}`}>
                      {/* (the job's services: a company may have several jobs this year, the open one first is said, then
                          how many more, as the plan page's "Sales Tracker 2 งาน") */}
                      {r.deal ? (
                        <span>
                          <JobSvc svc={jobServices(e.sales, r.deal)} none={r.jobs > 1} /> {r.status}
                          {r.jobs > 1 && <span className="t-sec">{` · อีก ${fmtN(r.jobs - 1)} งาน`}</span>}
                        </span>
                      ) : <span className="t-muted">{NOT_IN_TRACKER}</span>}
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
