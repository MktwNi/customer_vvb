import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useApp, useEngineVersion, useNarrow } from '../state';
import { todayISO } from '../lib/format';
import { bellEmpty, bellItems, dayTh, type BellRow } from '../lib/notify';
import { planDayLink } from '../lib/planCal';
import type { GccEngine } from '../lib/engine';
import { payBackBell, returnedTo } from '../lib/payCheck';
import { expBackBell } from '../lib/expenseMoney';
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
 * instalments late or due soon (งวดเงิน), appointments due today or late (นัดหมาย). My quotations waiting say
 * who the team script mailed, or why nobody was (lib/notify.ts qtSentView; a link to fix it for an admin). Opening
 * the bell pulls from the team's sheet (engine.teamPoke). Worked out from what
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
        // job expenses sent back (only for those who see them)
        xback: e.can('view.exp') ? expBackBell(e.sales, e.expChecks(), e.payChkCfg().since, e.me()) : [],
        // who was told about my quotations, or why nobody was
        sent: e.qtSentAll(),
      }),
    [v, today, scope], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // the list takes the keyboard: its first row (or ตั้งค่า when it is empty)
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>('.nf-i, .nf-act, .nf-foot .lnk')?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);
  const pick = (row: BellRow) => {
    btn.current?.focus();
    // the day with every customer and type shown: a legend filter pressed earlier would hide the row's entry
    if (row.go.day) return go('plan', { ...planDayLink(row.go.day), bell: false });
    // a quotation to check opens over its deal; mine sent back opens the deal (the note is on its card)
    set({ bell: false, deal: row.go.deal || null, ...(row.kind === 'chk' && row.go.doc ? { qtCheck: row.go.doc, qtSig: '' } : {}) });
  };
  const keys = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const all = [...(pop.current?.querySelectorAll<HTMLElement>('.nf-i, .nf-act, .nf-foot .lnk') || [])];
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
        onClick={() => {
          // opening asks the team's sheet for anything new (a teammate's quotation just attached)
          if (!open) e.teamPoke();
          set({ bell: !open });
        }}
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
                  <div key={row.key} className="nf-ir">
                    <button type="button" className="nf-i" onClick={() => pick(row)}>
                      <span className="nf-t co-name dense" title={row.title}>{row.title}</span>
                      <span className={'nf-s' + (row.wrap ? ' wrap' : '')}>{row.sub}</span>
                      <span className="nf-r">{row.right.chip != null ? <span className={'chip' + (row.right.chip ? ' ' + row.right.chip : '')}>{row.right.text}</span> : row.right.text}</span>
                    </button>
                    {row.act && (
                      <button type="button" className="lnk nf-act" onClick={() => (btn.current?.focus(), go('users', { usersSec: row.act!.to, bell: false }))}>
                        {row.act.label}
                      </button>
                    )}
                  </div>
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
