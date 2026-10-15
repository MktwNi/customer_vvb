import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useApp, useEngineVersion, useNarrow } from '../state';
import { todayISO } from '../lib/format';
import { bellEmpty, bellItems, dayTh, type BellRow } from '../lib/notify';
import type { GccEngine } from '../lib/engine';
import { payBackBell, returnedTo } from '../lib/payCheck';
import { Icon } from './icons';
import { usePopover } from './usePopover';

/** What the bell's foot says about the e-mails: the digest's days and time, or what is missing. */
export function mailLine(e: GccEngine) {
  const live = e.notifyLive, nf = e.session?.nf;
  if (!e.session || !live?.on || !nf) return '';
  if (!e.can('notify.mail')) return 'บทบาทนี้ไม่รับอีเมล';
  if (!nf.em) return 'ยังไม่ได้ใส่อีเมลแจ้งเตือน';
  if (!nf.ok) return 'รอยืนยันอีเมล';
  return nf.on.dg ? `สรุปทางอีเมล จ.–ศ. ${nf.t}` : 'ไม่รับอีเมลสรุป';
}

/**
 * The bell in the top bar (package notify): how many things need doing now, and a list of them in groups
 * — quotations waiting for this checker (รอตรวจ) or this person's own sent back (ใบเสนอราคาของฉัน),
 * money this person recorded that accounting sent back (รับเงินที่บัญชีส่งกลับ, lib/payCheck.ts returnedTo),
 * instalments late or due soon (งวดเงิน), appointments due today or late (นัดหมาย). Worked out from what
 * this browser holds (lib/notify.ts bellItems), so it works offline and before the team script has
 * notifications (then quotations are left out). A row opens what it is about; "ตั้งค่า" opens
 * การแจ้งเตือนของฉัน. On a phone the list is a sheet under the top bar.
 */
export function Bell() {
  const { engine: e, ui, set, go } = useApp();
  const v = useEngineVersion();
  const narrow = useNarrow(761);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const open = ui.bell;
  const close = () => set({ bell: false });
  usePopover(open, close, btn, pop);
  const today = todayISO();
  const scope = e.bellScope();
  const r = useMemo(
    () =>
      bellItems({
        S: e.sales, tasks: e.crm.tasks, owners: e.crm.owners, coName: (gid) => e.company(gid)?.name || '',
        me: e.me(), caps: e.myCaps(), live: e.notifyLive, checks: e.checks(), cfg: e.notifyCfg(), scope, today,
        back: payBackBell(returnedTo(e.sales, e.payChecks(), e.payChkCfg().since, e.me(), today)),
      }),
    [v, today, scope], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // the list takes the keyboard: its first row (or ตั้งค่า when it is empty)
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>('.nf-i, .nf-foot .lnk')?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);
  const pick = (row: BellRow) => {
    btn.current?.focus();
    if (row.go.day) return go('plan', { calDay: row.go.day, calM: row.go.day.slice(0, 7), bell: false });
    // a quotation to check opens over its deal; mine sent back opens the deal (the note is on its card)
    set({ bell: false, deal: row.go.deal || null, ...(row.kind === 'chk' && row.go.doc ? { qtCheck: row.go.doc, qtSig: '' } : {}) });
  };
  const keys = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const all = [...(pop.current?.querySelectorAll<HTMLElement>('.nf-i, .nf-foot .lnk') || [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    ev.preventDefault();
  };
  const n = r.count;
  const sc = scope === 'team' ? 'งานของทั้งทีม' : 'งานที่ฉันรับผิดชอบ';
  const foot = [mailLine(e), narrow ? '' : sc].filter(Boolean).join(' · ') || sc;
  return (
    <div className="nf">
      <button
        ref={btn}
        type="button"
        className="tb-round nf-bell"
        onClick={() => set({ bell: !open })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={n ? `การแจ้งเตือน ${n} รายการ` : 'การแจ้งเตือน ไม่มีรายการ'}
        title="การแจ้งเตือน"
      >
        <Icon name="bell" />
        {n > 0 && <span className="nf-n" aria-hidden="true">{n > 99 ? '99+' : n}</span>}
      </button>
      {open && narrow && <div className="nf-scrim" onClick={close} aria-hidden="true" />}
      {open && (
        <div ref={pop} className="nf-pop" role="dialog" aria-label="การแจ้งเตือน" onKeyDown={keys}>
          <div className="nf-head">
            <h3>การแจ้งเตือน</h3>
            <span>{dayTh(today)}</span>
          </div>
          {r.groups.length ? (
            r.groups.map((g) => (
              <div key={g.kind} className="nf-g" role="group" aria-label={g.title}>
                <div className="nf-gh">
                  <span>{g.title}</span>
                  {g.n > 0 && <span className="n">{g.n}</span>}
                </div>
                {g.rows.map((row) => (
                  <button key={row.key} type="button" className="nf-i" onClick={() => pick(row)}>
                    <span className="nf-t">{row.title}</span>
                    <span className="nf-s">{row.sub}</span>
                    <span className="nf-r">{row.right.chip != null ? <span className={'chip' + (row.right.chip ? ' ' + row.right.chip : '')}>{row.right.text}</span> : row.right.text}</span>
                  </button>
                ))}
              </div>
            ))
          ) : (
            <div className="nf-empty">
              ไม่มีเรื่องที่ต้องทำตอนนี้
              <small>{bellEmpty((c) => e.can(c), e.qtLive)}</small>
            </div>
          )}
          <div className="nf-foot">
            <span>{foot}</span>
            {e.session && (
              <button type="button" className="lnk" onClick={() => (btn.current?.focus(), set({ bell: false, acctDlg: 'notify' }))}>
                ตั้งค่า
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
