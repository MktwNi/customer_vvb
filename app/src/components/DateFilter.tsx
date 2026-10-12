import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { TH_M, addDays, dow, fmtN, isoTh } from '../lib/format';
import { BASES, ceOf, monthEnd, monthStart, navBounds, presetKey, presetList, rangeTh, resolveDate, twinOf, weekStart, type DateBasis, type DateF, type DatePreset, type Range } from '../lib/dateRange';
import { BASIS_TH } from '../lib/salesUi';
import { Chevron } from './StageTrack';
import { Pop, XMark, useHL } from './Pop';
import { Select } from './Select';

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const WD = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
/** "ตุลาคม 2569" for the 1st of a month */
const monthTitle = (m1: string) => `${MONTHS[+m1.slice(5, 7) - 1]} ${+m1.slice(0, 4) + 543}`;
/** the same day `n` months on, kept inside the month (31 → 30) */
const shiftMonthDay = (iso: string, n: number) => {
  const m = monthStart(iso, n), end = monthEnd(m);
  const d = m.slice(0, 8) + iso.slice(8);
  return d > end ? end : d;
};

/** The chip's words for a date filter in use: "ติดต่อ" + "ช่วง" + "ต.ค. 2569", or "วันที่" for one day. */
export function dateWords(f: DateF, r: Range) {
  return { field: BASIS_TH[f.basis].short, op: r.from === r.to ? 'วันที่' : 'ช่วง', value: rangeTh(r) };
}

/**
 * The date chip, first in a filter row: "ช่วงเวลา ทั้งปี 2569" while no date is set (the whole table of
 * that year), else the range in use ("ติดต่อ ช่วง 1–12 ต.ค. 2569 ×"). It opens the date popover: ranges
 * one click away, which date of a deal counts (นับจากวันที่), จาก – ถึง, a Monday-first month (or the 12
 * months with their counts), and the rows the draft would leave. Nothing applies before "ใช้ตัวกรอง".
 */
export function DateFilter({ value, onChange, year, today, count, monthCounts, bases = BASES, unit = 'งาน', elsewhere }: {
  value: DateF | null | undefined;
  onChange: (v: DateF | null) => void;
  /** the Buddhist-era year of the table */
  year: string;
  today: string;
  /** rows a draft would leave (every other filter on) */
  count: (draft: DateF | null) => number;
  /** rows with a date of `basis` in each month of `ceYear` (the month grid) */
  monthCounts: (basis: DateBasis, ceYear: number) => number[];
  bases?: DateBasis[];
  unit?: string;
  /** a draft whose rows are not in this view: where they are, in place of "· 0 งาน" (null: they are here) */
  elsewhere?: (draft: DateF) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const popId = useId() + '-date';
  const f = value || null;
  const r = f ? resolveDate(f, year, today) : null;
  const w = f && r ? dateWords(f, r) : null;
  const pre = f ? (f.preset !== 'custom' && presetKey(year, today, f.basis === 'due', f.preset)?.label) || 'กำหนดเอง' : '';
  const title = f && r ? `${pre} · ${BASIS_TH[f.basis].sent} ${rangeTh(r)}` : `ทั้งปี ${year} · ไม่กรองวันที่`;
  return (
    <>
      <span className={'fchip fdate-chip' + (w ? ' on' : '') + (open ? ' open' : '')}>
        <button
          ref={btn}
          type="button"
          className="fchip-b"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          title={title}
          // the words on the chip, whole (no colon inside them): what a person using speech says
          aria-label={w ? `ตัวกรอง ช่วงเวลา ${w.field} ${w.op} ${w.value} — แก้ไข` : `ตัวกรอง ช่วงเวลา ทั้งปี ${year} — เลือก`}
          onClick={() => setOpen(!open)}
        >
          {w ? (
            <>
              <span className="fchip-f">{w.field}</span>
              <span className="fchip-op">{w.op}</span>
              <span className="fchip-v">{w.value}</span>
            </>
          ) : (
            <>
              <span className="fchip-f">ช่วงเวลา</span>
              <span className="fchip-v">ทั้งปี {year}</span>
              <Chevron size={14} />
            </>
          )}
        </button>
        {w && (
          <button
            type="button"
            className="fchip-x"
            aria-label="ล้างช่วงเวลา (กลับเป็นทั้งปี)"
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => btn.current?.focus({ preventScroll: true }));
            }}
          >
            <XMark />
          </button>
        )}
      </span>
      {open && (
        <DatePop
          init={f}
          year={year}
          today={today}
          bases={bases}
          unit={unit}
          count={count}
          monthCounts={monthCounts}
          elsewhere={elsewhere}
          id={popId}
          anchor={btn}
          onClose={() => setOpen(false)}
          onApply={(x) => {
            setOpen(false);
            onChange(x);
            requestAnimationFrame(() => btn.current?.focus({ preventScroll: true }));
          }}
        />
      )}
    </>
  );
}

function DatePop({ init, year, today, bases, unit, count, monthCounts, elsewhere, id, anchor, onClose, onApply }: {
  init: DateF | null; year: string; today: string; bases: DateBasis[]; unit: string;
  count: (draft: DateF | null) => number;
  monthCounts: (basis: DateBasis, ceYear: number) => number[];
  elsewhere?: (draft: DateF) => string | null;
  id: string;
  anchor: { current: HTMLElement | null };
  onClose: () => void;
  onApply: (v: DateF | null) => void;
}) {
  const Y = ceOf(year), nb = navBounds(year);
  const thisYear = today.slice(0, 4) === String(Y);
  const [basis, setBasis] = useState<DateBasis>(init?.basis || 'contact');
  const P = presetList(year, today, basis === 'due');
  const r0 = init ? resolveDate(init, year, today) : null;
  // a 7-day range not offered today opens as the one with the same days (สัปดาห์นี้ on a Monday)
  const [preset, setPreset] = useState<DatePreset>(init ? (init.preset !== 'custom' && presetKey(year, today, init.basis === 'due', init.preset)?.k) || 'custom' : 'year');
  const [from, setFrom] = useState(r0?.from || '');
  const [to, setTo] = useState(r0?.to || '');
  const [end, setEnd] = useState<'from' | 'to'>('from');
  const [hover, setHover] = useState('');
  const [ym, setYm] = useState(() => monthStart(r0?.from || (thisYear ? today : `${Y}-01-01`)));
  const [months, setMonths] = useState(false);
  const [gy, setGy] = useState(+ym.slice(0, 4));
  const [mPick, setMPick] = useState('');
  const [fday, setFday] = useState('');
  /** the month of the 12 that takes Tab (a roving stop, as the days) */
  const [fm, setFm] = useState(0);
  const titleBtn = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const hl = useHL();
  const on = preset !== 'year' && !!from;
  const draft: DateF | null = on ? { basis, preset: preset as DateF['preset'], from, to: to || from } : null;
  const n = useMemo(() => count(draft), [basis, preset, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const away = useMemo(() => (draft && elsewhere ? elsewhere(draft) : null), [basis, preset, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const mc = useMemo(() => (months ? monthCounts(basis, gy) : []), [months, basis, gy]); // eslint-disable-line react-hooks/exhaustive-deps
  /** where กำหนดเอง starts with nothing picked: today (when the calendar may show it), else the month shown */
  const startDay = () => (today >= nb.from && today <= nb.to ? today : ym);

  const pick = (k: DatePreset) => {
    const p = P.find((x) => x.k === k);
    setPreset(k);
    setEnd('from');
    setMPick('');
    if (p?.r) {
      setFrom(p.r.from);
      setTo(p.r.to);
      setYm(monthStart(p.r.from));
      setMonths(false);
    } else if (k === 'custom' && !from) {
      const s = startDay();
      setFrom(s);
      setTo(s);
      setYm(monthStart(s));
    }
  };
  const changeBasis = (b: DateBasis) => {
    const flip = (b === 'due') !== (basis === 'due');
    setBasis(b);
    if (!flip || preset === 'year' || preset === 'custom') return;
    // 7 วันล่าสุด ↔ 7 วันข้างหน้า, เดือนที่แล้ว ↔ เดือนหน้า; one the new list lacks stays as its days
    const twin = presetKey(year, today, b === 'due', twinOf(preset));
    if (twin?.r) {
      setPreset(twin.k);
      setFrom(twin.r.from);
      setTo(twin.r.to);
      setYm(monthStart(twin.r.from));
    } else setPreset('custom');
  };
  const day = (iso: string) => {
    setPreset('custom');
    setFday(iso);
    if (end === 'from' || !on) {
      setFrom(iso);
      setTo(iso);
      setEnd('to');
    } else {
      if (iso < from) {
        setTo(from);
        setFrom(iso);
      } else setTo(iso);
      setEnd('from');
    }
  };
  const slot = (which: 'from' | 'to') => {
    setEnd(which);
    setMPick('');
    if (preset === 'year') {
      setPreset('custom');
      if (!from) {
        const s = startDay();
        setFrom(s);
        setTo(s);
      }
    }
    const at = which === 'to' ? to || from : from;
    if (at) setYm(monthStart(at));
    setMonths(false);
  };
  const pickMonth = (m1: string) => {
    setPreset('custom');
    setEnd('from');
    if (!mPick) {
      setFrom(m1);
      setTo(monthEnd(m1));
      setMPick(m1);
    } else {
      const a = mPick < m1 ? mPick : m1, b = mPick < m1 ? m1 : mPick;
      setFrom(a);
      setTo(monthEnd(b));
      setMPick('');
    }
  };

  // ---- the month of days, Monday first; days of other months are blank
  const last = monthEnd(ym), lead = (dow(ym) + 6) % 7;
  const cells: string[] = Array(lead).fill('');
  for (let d = ym; d <= last; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push('');
  const weeks: string[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const hi = on && end === 'to' && hover && hover > from ? hover : to || from;
  const inMonth = (x: string) => !!x && x.slice(0, 7) === ym.slice(0, 7);
  const tabDay = inMonth(fday) ? fday : on && inMonth(from) ? from : inMonth(today) ? today : ym;
  const prevOk = monthStart(ym, -1) >= nb.from, nextOk = monthStart(ym, 1) <= nb.to;
  /** เดือนก่อน / เดือนถัดไป / ปีก่อน / ปีถัดไป: at the calendar's bound it stays where it is (a focused button
   *  that vanished would drop the focus to the page), greyed and aria-disabled */
  const navBtn = (ok: boolean, text: string, go: () => void) => (
    <button type="button" className="quiet cal-nav" aria-disabled={!ok || undefined} onClick={() => ok && go()}>{text}</button>
  );
  const gridKeys = (ev: KeyboardEvent) => {
    const cur = (ev.target as HTMLElement).dataset?.day;
    if (!cur) return;
    const k = ev.key;
    const nx = k === 'ArrowLeft' ? addDays(cur, -1) : k === 'ArrowRight' ? addDays(cur, 1) : k === 'ArrowUp' ? addDays(cur, -7) : k === 'ArrowDown' ? addDays(cur, 7) : k === 'PageUp' ? shiftMonthDay(cur, -1) : k === 'PageDown' ? shiftMonthDay(cur, 1) : k === 'Home' ? weekStart(cur) : k === 'End' ? addDays(weekStart(cur), 6) : '';
    if (!nx) return;
    ev.preventDefault();
    const to2 = nx < nb.from ? nb.from : nx > nb.to ? nb.to : nx;
    setFday(to2);
    // a day of this month is there already; another month's after it renders
    const there = grid.current?.querySelector<HTMLElement>(`[data-day="${to2}"]`);
    if (there) there.focus();
    else {
      setYm(monthStart(to2));
      requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-day="${to2}"]`)?.focus());
    }
  };

  // ---- the 12 months of a year with how many rows have a date of the basis in each
  const gyPrev = `${gy - 1}-12-31` >= nb.from, gyNext = `${gy + 1}-01-01` <= nb.to;
  const mFrom = on ? from.slice(0, 7) : '', mTo = on ? (to || from).slice(0, 7) : '';
  const monthKeys = (ev: KeyboardEvent) => {
    const i = +((ev.target as HTMLElement).dataset?.m ?? -1);
    if (i < 0) return;
    const j = ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowUp' ? i - 4 : ev.key === 'ArrowDown' ? i + 4 : -1;
    if (j < 0 || j > 11) return;
    ev.preventDefault();
    grid.current?.querySelector<HTMLElement>(`[data-m="${j}"]`)?.focus();
  };

  const presetKeys = (ev: KeyboardEvent<HTMLDivElement>) => {
    const i = P.findIndex((p) => p.k === preset);
    const j = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? (i + 1) % P.length : ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' ? (i - 1 + P.length) % P.length : -1;
    if (j < 0) return;
    ev.preventDefault();
    pick(P[j].k);
    const box = ev.currentTarget;
    requestAnimationFrame(() => box.querySelector<HTMLElement>(`[data-k="${P[j].k}"]`)?.focus());
  };

  return (
    <Pop id={id} anchor={anchor} onClose={onClose} label="ช่วงเวลา" title="ช่วงเวลา" kind="dialog" width={640} className="date">
      <div className="fdate">
        <div className="hl-list fdate-pre" role="radiogroup" aria-label="ช่วงที่ใช้บ่อย" onKeyDown={presetKeys} {...hl.bind}>
          <i className="hl" aria-hidden="true" />
          {P.map((p) => {
            const ch = preset === p.k;
            return (
              <button
                key={p.k}
                type="button"
                role="radio"
                aria-checked={ch}
                tabIndex={ch ? 0 : -1}
                data-k={p.k}
                data-hl=""
                data-autofocus={ch ? '' : undefined}
                className={'fpre' + (ch ? ' on' : '')}
                onClick={() => pick(p.k)}
              >
                <span>{p.label}</span>
                {p.r ? <small>{rangeTh(p.r, { dropYear: year })}</small> : p.k === 'year' ? <small>ไม่กรองวันที่</small> : null}
              </button>
            );
          })}
        </div>
        <div className="fdate-main">
          <div className="fdate-basis">
            <span className="fdate-lab" id="fdate-basis-l">นับจากวันที่</span>
            <Select
              variant="tool"
              value={basis}
              options={bases.map((b) => ({ v: b, label: BASIS_TH[b].label, sub: BASIS_TH[b].sub }))}
              onChange={changeBasis}
              label="นับจากวันที่"
              labelledBy="fdate-basis-l"
              width={300}
              search={false}
            />
          </div>
          <p className="fdate-hint">{BASIS_TH[basis].hint}</p>
          <div className="fdate-slots" role="group" aria-label="จาก – ถึง">
            <button type="button" className={'fslot' + (on && end === 'from' ? ' on' : '')} aria-pressed={on && end === 'from'} onClick={() => slot('from')}>
              <small>จาก</small>
              <span className={on ? '' : 'ph'}>{on ? isoTh(from) : 'เลือกวัน'}</span>
            </button>
            <span className="fdate-dash" aria-hidden="true">–</span>
            <button type="button" className={'fslot' + (on && end === 'to' ? ' on' : '')} aria-pressed={on && end === 'to'} onClick={() => slot('to')}>
              <small>ถึง</small>
              <span className={on ? '' : 'ph'}>{on ? isoTh(to || from) : 'เลือกวัน'}</span>
            </button>
          </div>
          {!months ? (
            <div className="cal">
              <div className="cal-h">
                {navBtn(prevOk, 'เดือนก่อน', () => setYm(monthStart(ym, -1)))}
                <button
                  ref={titleBtn}
                  type="button"
                  className="cal-t"
                  // it swaps the days for the 12 months (and goes away): a name that says so, no expanded state
                  aria-label={`${monthTitle(ym)} — เลือกทั้งเดือน`}
                  title="เลือกทั้งเดือน"
                  onClick={() => {
                    const m = +ym.slice(5, 7) - 1;
                    setGy(+ym.slice(0, 4));
                    setMPick('');
                    setFm(m);
                    setMonths(true);
                    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-m="${m}"]`)?.focus());
                  }}
                >
                  {monthTitle(ym)}
                  <Chevron size={12} />
                </button>
                {navBtn(nextOk, 'เดือนถัดไป', () => setYm(monthStart(ym, 1)))}
              </div>
              <div ref={grid} className="cal-g" role="grid" aria-label={monthTitle(ym)} onKeyDown={gridKeys} onPointerLeave={() => setHover('')}>
                <div role="row" className="cal-row">
                  {WD.map((w) => <span key={w} className="cal-wd" role="columnheader">{w}</span>)}
                </div>
                {weeks.map((wk, i) => (
                  <div role="row" className="cal-row" key={i}>
                    {wk.map((d, j) =>
                      !d ? (
                        <span key={'b' + j} className="cal-d blank" role="gridcell" />
                      ) : (
                        <button
                          key={d}
                          type="button"
                          role="gridcell"
                          data-day={d}
                          aria-selected={on && d >= from && d <= hi}
                          aria-current={d === today ? 'date' : undefined}
                          aria-label={isoTh(d)}
                          tabIndex={d === tabDay ? 0 : -1}
                          className={'cal-d' + (on && d >= from && d <= hi ? ' in' : '') + (on && d === from ? ' a' : '') + (on && d === hi ? ' b' : '') + (d === today ? ' today' : '')}
                          onClick={() => day(d)}
                          onPointerEnter={() => setHover(d)}
                          onFocus={() => setFday(d)}
                        >
                          <span>{+d.slice(8)}</span>
                        </button>
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="cal">
              <div className="cal-h">
                {navBtn(gyPrev, 'ปีก่อน', () => setGy(gy - 1))}
                <span className="cal-t static">เลือกเดือน · ปี {gy + 543}</span>
                {navBtn(gyNext, 'ปีถัดไป', () => setGy(gy + 1))}
                <button
                  type="button"
                  className="lnk cal-back"
                  onClick={() => {
                    setMonths(false);
                    if (on) setYm(monthStart(from));
                    // this button goes with the months: the focus moves to the month's title, not the page
                    requestAnimationFrame(() => titleBtn.current?.focus());
                  }}
                >
                  ดูรายวัน
                </button>
              </div>
              <div ref={grid} className="cal-mg" role="group" aria-label={`เดือนของปี ${gy + 543}`} onKeyDown={monthKeys}>
                {TH_M.map((m, i) => {
                  const m1 = `${gy}-${String(i + 1).padStart(2, '0')}-01`, key = m1.slice(0, 7);
                  const inR = on && key >= mFrom && key <= mTo, isEnd = on && (key === mFrom || key === mTo);
                  const c = mc[i] || 0;
                  return (
                    <button
                      key={m}
                      type="button"
                      data-m={i}
                      tabIndex={i === fm ? 0 : -1}
                      onFocus={() => setFm(i)}
                      aria-pressed={inR}
                      aria-label={`${MONTHS[i]} ${gy + 543}: ${c ? fmtN(c) + ' ' + unit : 'ไม่มี' + unit}`}
                      className={'cal-m' + (inR ? ' in' : '') + (isEnd ? ' end' : '') + (key === today.slice(0, 7) ? ' today' : '') + (mPick === m1 ? ' first' : '')}
                      onClick={() => pickMonth(m1)}
                    >
                      <span>{m}</span>
                      <small>{c ? fmtN(c) : '–'}</small>
                    </button>
                  );
                })}
              </div>
              <p className="fdate-hint" role="status">{mPick ? 'กดอีกเดือนเพื่อเลือกเป็นช่วง' : 'กดเดือนเพื่อเลือกทั้งเดือน · ตัวเลขคือจำนวน' + unit}</p>
            </div>
          )}
        </div>
      </div>
      <div className="fval-foot">
        <span className="pop-sum" aria-live="polite">
          {draft ? (
            <>
              {BASIS_TH[basis].sent} <b>{rangeTh({ from: draft.from, to: draft.to })}</b> · {away ?? `${fmtN(n)} ${unit}`}
            </>
          ) : (
            <>ทั้งปี {year} · ไม่กรองวันที่ · {fmtN(n)} {unit}</>
          )}
        </span>
        <button type="button" className="quiet fval-cancel" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn pri sm" onClick={() => onApply(draft)}>ใช้ตัวกรอง</button>
      </div>
    </Pop>
  );
}

