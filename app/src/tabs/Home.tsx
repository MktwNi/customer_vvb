import { useState } from 'react';
import { useApp, useEngineVersion, type Tab } from '../state';
import { NAV, pageOk } from '../components/Sidebar';
import { Icon, type IconName } from '../components/icons';
import { TT } from '../lib/constants';
import { TH_M, addDays, dmTh, dow, fmtN, isoTh, todayISO } from '../lib/format';
import type { Task } from '../lib/types';
import { planDayLink } from '../lib/planCal';
import { dayItems, tgoDaySet } from '../lib/homeDay';

/**
 * ระบบงานทวนสอบ GCC (owner, Nov 2569: "งานทวนสอบให้ลิงค์ไปที่ ระบบงาน VVB GCC ... แล้วล๊อคสิทธิไว้"): its own
 * site (repo MktwNi/gcc-case-demo) with its own invited accounts, so the tile only opens the way for the
 * accounts given mp.view here (the verification work); signing in there is still that system's own.
 * A link, not a page of this site: the two systems stay apart (owner, Nov 2569, "ไม่ต้องเอาไปรวม ... แยกกันเลย").
 */
const VVB_URL = 'https://mktwni.github.io/gcc-case-demo/app/';

/** A system on หน้าแรก: open here, a link to its own site, not this account's, or not built yet. */
type SysState = 'open' | 'link' | 'locked' | 'soon';
interface Sys { key: 'sales' | 'consult' | 'verify' | 'event'; name: string; sub: string; icon: IconName; state: SysState; to?: Tab }
/** The systems' own pages in this site: the tiles stand for them, so they are not menu tiles too. */
const SYS_TABS: Tab[] = ['home', 'consult'];

const WD = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const byTime = (a: Task, b: Task) => (a.time || '99').localeCompare(b.time || '99');
const byWhen = (a: Task, b: Task) => a.date.localeCompare(b.date) || byTime(a, b);

/**
 * หน้าแรก (owner, Nov 2569: "หลัง Login ผมอยากให้ขึ้นมาเป็นหน้าแบบนี้", design 2A on the design canvas):
 * the systems of the company in one place — each opens only for the accounts allowed to use it — today's
 * appointments, every page this account may open and what waits for this account (the search is the top
 * bar's, on every page). The side column is this month's calendar over the next appointments (owner's pick
 * A of three, "มันดูโล่งๆ" with one card there): it holds its place with no appointment at all. A day picked on
 * the calendar (today at first) lists its appointments and TGO round dates under it, in the same card (owner's
 * pick A of three, Nov 2569: "เมื่อกดแล้วอยากให้มีกำหนดการหรืออะไรให้ดูคร่าวๆ ด้านล่าง"); แผนติดต่อ is one more tap.
 * On the UAT copy of the site only for now (lib/uat.ts); งานที่ปรึกษา and Event are designs, not built yet.
 */
export function Home() {
  const { engine: e, go, set } = useApp();
  useEngineVersion();
  const today = todayISO();
  const me = e.me();
  const s = e.session;
  // asking for a permission needs an account on a script that knows roles (components/RequestDialog)
  const canAsk = !!s && e.rolesLive;
  const ask = () => set({ acctDlg: 'request', reqInit: { k: 'caps' } });

  const plan = e.can('view.plan');
  const tasks: Task[] = plan ? e.crm.tasks : [];
  const todays = tasks.filter((t) => t.date === today).sort(byTime);
  const done = todays.filter((t) => t.done).length;
  const next = todays.find((t) => !t.done);
  const upcoming = tasks.filter((t) => !t.done && t.date >= today).sort(byWhen).slice(0, 5);
  const who = (t: Task) => e.company(t.gid)?.name || t.title;
  const kind = (t: Task) => TT.find((x) => x[0] === t.type)?.[1] || '';
  const [sel, setSel] = useState(today);
  const selItems = dayItems(sel, tasks, e.R, who, kind);
  const C = 2 * Math.PI * 30;

  // this month, weeks from Sunday as on แผนติดต่อ (tabs/Plan.tsx): a dot on each day with an appointment
  const month = today.slice(0, 7);
  const [yy, mm] = month.split('-').map(Number);
  const first = `${month}-01`;
  const start = addDays(first, -dow(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i)).filter((_, i) => i < 35 || addDays(start, 35).slice(0, 7) === month);
  const perDay = new Map<string, number>();
  tasks.forEach((t) => perDay.set(t.date, (perDay.get(t.date) || 0) + 1));
  const tgoDays = tgoDaySet(e.R);
  const monthN = tasks.filter((t) => t.date.slice(0, 7) === month).length;

  const systems: Sys[] = [
    { key: 'sales', name: 'ฐานลูกค้าและงานขาย', sub: 'ทะเบียนบริษัท Sales Tracker ผู้ติดต่อ และแผนติดต่อ', icon: 'sales', state: 'open', to: 'overview' },
    { key: 'consult', name: 'งานที่ปรึกษา', sub: 'โครงการ แผนโครงการ และวางบิล · ข้อมูลตัวอย่าง', icon: 'briefcase', state: 'open', to: 'consult' },
    { key: 'verify', name: 'งานทวนสอบ', sub: 'ระบบงาน VVB GCC · เข้าด้วยบัญชีที่ได้รับเชิญ', icon: 'audit', state: e.can('mp.view') ? 'link' : 'locked' },
    { key: 'event', name: 'Event', sub: 'ปฏิทินงานและผู้เข้าร่วม', icon: 'ticket', state: 'soon' },
  ];

  // every page of the menu: open, or (signed in, roles on the script) locked with a way to ask for it;
  // managing users is never offered to ask for
  const pages = NAV.filter((g) => g.title && g.items.some((it) => !SYS_TABS.includes(it.key))).flatMap((g) =>
    g.items.filter((it) => !SYS_TABS.includes(it.key)).map((it) => ({ ...it, group: g.title, ok: pageOk(e, it.key) })),
  );
  const shown = pages.filter((p) => p.ok || (canAsk && !p.accounts && p.cap !== 'set.users'));
  const openN = pages.filter((p) => p.ok).length;

  return (
    <div className="hm">
      <div className="hm-main">
        <header className="hm-hello">
          <h1 id="page-title">{me ? `สวัสดี คุณ${me}` : 'สวัสดี'}</h1>
          <span className="hm-bar" aria-hidden="true" />
          <p>{isoTh(today)} · วันนี้จะทำงานส่วนไหน เลือกระบบด้านล่างได้เลย</p>
        </header>

        <section className="hm-sys" aria-label="ระบบงาน">
          {systems.map((x) => {
            const body = (
              <>
                <span className="hm-ic"><Icon name={x.state === 'locked' ? 'lock' : x.icon} /></span>
                <b>{x.name}</b>
                <span className="hm-sub">
                  {x.state === 'soon' ? 'กำลังพัฒนา' : x.state === 'locked' ? (canAsk ? 'ยังไม่มีสิทธิ์ · กดเพื่อขอสิทธิ์' : 'ยังไม่มีสิทธิ์ใช้ระบบนี้') : x.sub}
                </span>
              </>
            );
            if (x.state === 'open' && x.to) {
              const to = x.to;
              return <button key={x.key} type="button" className={'hm-tile ' + x.key} onClick={() => go(to)}>{body}</button>;
            }
            if (x.state === 'link') return <a key={x.key} className={'hm-tile ' + x.key} href={VVB_URL} target="_blank" rel="noopener">{body}</a>;
            if (x.state === 'locked' && canAsk) return <button key={x.key} type="button" className="hm-tile locked" onClick={ask}>{body}</button>;
            return <div key={x.key} className={'hm-tile ' + (x.state === 'locked' ? 'locked' : 'soon')}>{body}</div>;
          })}
        </section>

        {plan && (
          <section className="hm-today" aria-label="งานวันนี้">
            <span className="hm-ring" aria-hidden="true">
              <svg viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="7" />
                <circle cx="36" cy="36" r="30" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${todays.length ? (done / todays.length) * C : 0} ${C}`} transform="rotate(-90 36 36)" />
              </svg>
              <b>{done}/{todays.length}</b>
            </span>
            <span className="hm-tcol">
              <b>นัดวันนี้</b>
              <span>{todays.length ? `ทั้งหมด ${fmtN(todays.length)} · ทำแล้ว ${fmtN(done)} · เหลือ ${fmtN(todays.length - done)}` : 'วันนี้ยังไม่มีนัด'}</span>
            </span>
            <span className="hm-sep" aria-hidden="true" />
            <span className="hm-tcol">
              <b>{next ? `ถัดไป ${next.time ? next.time + ' น.' : 'วันนี้'}` : 'ไม่มีนัดค้างวันนี้'}</b>
              <span>{next ? `${kind(next)} · ${who(next)}` : 'ดูนัดวันอื่นได้ที่แผนติดต่อ'}</span>
            </span>
            <button type="button" className="btn hm-white" onClick={() => go('plan')}>เปิดแผนติดต่อ</button>
          </section>
        )}

        <section className="hm-pages-wrap" aria-labelledby="hm-pages-t">
          <div className="hm-sec">
            <h2 id="hm-pages-t">เมนูทั้งหมด</h2>
            <span className="hm-note">{shown.length > openN ? `เปิดได้ ${fmtN(openN)} จาก ${fmtN(shown.length)} เมนู` : `${fmtN(openN)} เมนู`}</span>
          </div>
          <div className="hm-pages">
            {shown.map((p) =>
              p.ok ? (
                <button key={p.key} type="button" className="hm-pg" onClick={() => go(p.key)}>
                  <span className="hm-pg-ic"><Icon name={p.icon} /></span>
                  <b>{p.label}</b>
                  <small>{p.group}</small>
                </button>
              ) : (
                <button key={p.key} type="button" className="hm-pg locked" onClick={ask} title="ยังไม่มีสิทธิ์ กดเพื่อขอสิทธิ์">
                  <span className="hm-pg-ic"><Icon name="lock" /></span>
                  <b>{p.label}</b>
                  <small>ขอสิทธิ์</small>
                </button>
              ),
            )}
          </div>
        </section>
      </div>

      <aside className="hm-side">
        {s && e.can('set.users') && (s.rq || 0) > 0 && (
          <section className="card hm-card" aria-labelledby="hm-rq-t">
            <h2 id="hm-rq-t">รอคุณอนุมัติ</h2>
            <button type="button" className="hm-req" onClick={() => go('users', { usersSec: 'req' })}>
              <b>คำขอสิทธิ์ {fmtN(s.rq || 0)} รายการ</b>
              <span>เปิดผู้ใช้และสิทธิ์</span>
            </button>
          </section>
        )}

        {plan && (
          <section className="card hm-card" aria-labelledby="hm-cal-t">
            <div className="hm-sec">
              <h2 id="hm-cal-t">{TH_M[mm - 1]} {yy + 543}</h2>
              <span className="hm-note">{monthN ? `นัดเดือนนี้ ${fmtN(monthN)}` : 'เดือนนี้ยังไม่มีนัด'}</span>
            </div>
            <div className="hm-cal">
              {WD.map((d) => <span key={d} className="hm-cal-h" aria-hidden="true">{d}</span>)}
              {cells.map((d) => {
                const n = perDay.get(d) || 0;
                const tgo = tgoDays.has(d);
                const cls = 'hm-cal-d' + (d.slice(0, 7) !== month ? ' out' : '') + (d === today ? ' today' : '') + (d === sel ? ' sel' : '');
                return (
                  <button key={d} type="button" className={cls} onClick={() => setSel(d)} aria-pressed={d === sel} aria-label={isoTh(d) + (n ? ` นัด ${fmtN(n)} รายการ` : '') + (tgo ? ' มีกำหนดการ TGO' : '')} aria-current={d === today ? 'date' : undefined}>
                    {Number(d.slice(8))}
                    {(n > 0 || tgo) && <span className="hm-dots" aria-hidden="true">{n > 0 && <i />}{tgo && <i className="tgo" />}</span>}
                  </button>
                );
              })}
            </div>
            <div className="hm-legend" aria-hidden="true"><span><i />นัด</span><span><i className="tgo" />กำหนดการ TGO</span></div>
            <div className="hm-day" aria-live="polite">
              <div className="hm-sec">
                <h3>{sel === today ? 'วันนี้ · ' : ''}{WD[dow(sel)]} {dmTh(sel)}</h3>
                <span className="hm-note">{selItems.length ? `${fmtN(selItems.length)} รายการ` : 'ไม่มีกำหนดการ'}</span>
              </div>
              {selItems.map((x) => {
                const body = (
                  <>
                    <span className="hm-tm">{x.tm}</span>
                    <span className="hm-ap-t">
                      <span className="co-name dense">{x.t}</span>
                      <span className="hm-ap-sub">{x.sub}</span>
                    </span>
                  </>
                );
                // a TGO date has no page of its own here; an appointment opens its day on แผนติดต่อ
                return x.tgo ? <div key={x.k} className="hm-ap tgo">{body}</div> : <button key={x.k} type="button" className="hm-ap" onClick={() => go('plan', planDayLink(sel))}>{body}</button>;
              })}
              <button type="button" className="lnk" onClick={() => go('plan', planDayLink(sel))}>{selItems.some((x) => !x.tgo) ? 'เปิดในแผนติดต่อ' : 'เพิ่มนัดในแผนติดต่อ'}</button>
            </div>
          </section>
        )}

        {plan && (
          <section className="card hm-card" aria-labelledby="hm-up-t">
            <div className="hm-sec">
              <h2 id="hm-up-t">นัดถัดไป</h2>
              <button type="button" className="lnk" onClick={() => go('plan')}>ดูทั้งหมด</button>
            </div>
            {upcoming.length ? (
              upcoming.map((t) => (
                <button key={t.id} type="button" className="hm-ap" onClick={() => go('plan', planDayLink(t.date))}>
                  <span className="hm-tm">{t.date === today ? t.time || 'วันนี้' : dmTh(t.date)}</span>
                  <span className="hm-ap-t">
                    <span className="co-name dense">{who(t)}</span>
                    <span className="hm-ap-sub">{kind(t)}{t.date !== today && t.time ? ` · ${t.time} น.` : ''}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="hm-empty">ยังไม่มีนัดที่จะถึง</p>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
