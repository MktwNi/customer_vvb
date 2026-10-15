import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion, useNarrow, type UIState } from '../state';
import type { TeamDir, TeamUser } from '../lib/engine';
import { USER_RE, normUser } from '../lib/auth';
import { TeamSyncError, type Role } from '../lib/teamSync';
import { hasWrite, roleLine, type RoleDef } from '../lib/caps';
import { reqWords } from '../lib/reqText';
import { dtTh, fmtN, isoTh, todayISO } from '../lib/format';
import { Notice } from '../components/ui';
import { Icon } from '../components/icons';
import { inviteLink } from '../components/TeamSync';
import { RoleChip, authError, hhmm, nameLetter } from '../components/Login';
import { menuKeys, usePopover } from '../components/usePopover';
import { Modal } from '../components/Dialog';
import { Select } from '../components/Select';
import { AccountDialog } from './users/AccountDialog';
import { Roles } from './users/Roles';
import { Requests } from './users/Requests';
import { NA_FORM, NotifyAdmin } from './users/NotifyAdmin';
import { EMAIL_RE, effRole, extrasOf, isOn as on, roleOf, roleRank } from './users/shared';

/**
 * ผู้ใช้และสิทธิ์ (accounts that manage users, set.users): four sections — บัญชีผู้ใช้ (everyone's account,
 * role, unit, notification e-mail and status; new accounts with a temporary password shown once; names
 * used in the team's data that have no account yet), บทบาทและสิทธิ์ (the roles and what each may do),
 * คำขอสิทธิ์ (requests to approve, and the history of permission changes) and การแจ้งเตือน (notify).
 * Everything here is read from and saved to the team script directly (online only, never queued). A script
 * deployed before configurable roles sends only the accounts: the built-in roles stand in, read-only.
 */
const LOST = ['session_expired', 'login_required', 'account_disabled', 'must_change_password', 'forbidden'];
const SELF_GUARD = 'เปลี่ยนบทบาทหรือปิดบัญชีของตัวเองไม่ได้';
const ADMIN_GUARD = 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน';
const USER_HINT = 'ภาษาอังกฤษตัวเล็ก ตัวเลข . _ - ยาว 3–32 ตัว';
const HONEST = [
  'ข้อมูลทีมใน Google Sheet และเอกสารแนบ เปิดหรือแก้ได้เฉพาะผู้ที่เข้าสู่ระบบ ชื่อผู้แก้ไขบันทึกโดยเซิร์ฟเวอร์ ปลอมไม่ได้',
  'ฐานข้อมูลบริษัท (ทะเบียน) เป็นข้อมูลสาธารณะของเว็บ',
  'ข้อมูลที่ซิงก์ลงเบราว์เซอร์ยังอ่านได้บนเครื่องนั้นจนกว่าจะออกจากระบบแบบลบข้อมูล',
];

/** Give the focus back to a control after its dialog closed (when the control that opened it is gone). */
const refocus = (sel: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus());

interface Cred { user: TeamUser; temp: string; reset?: boolean }
interface Ask { title: string; text: string; yes: string; danger?: boolean; run: () => Promise<void> }
interface Item { label: string; run: () => void; danger?: boolean }

type Sec = UIState['usersSec'];

export function Users() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const narrow = useNarrow(760);
  const me = e.session?.u || '';
  const [dir, setDir] = useState<TeamDir | null>(null);
  const users = dir?.users || null;
  const setUsers = (f: (l: TeamUser[] | null) => TeamUser[] | null) => setDir((d) => (d ? { ...d, users: f(d.users) || [] } : d));
  const [at, setAt] = useState(0); // when the list was read (lock times count from then)
  const [load, setLoad] = useState<'loading' | 'ok' | 'error' | 'offline'>('loading');
  const [loadErr, setLoadErr] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busyU, setBusyU] = useState('');
  const [add, setAdd] = useState<{ name?: string; from: string } | null>(null);
  const [cred, setCred] = useState<Cred | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [acct, setAcct] = useState<TeamUser | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // the session ended or the role changed: a sync round makes the engine notice (sign in again / no page)
  const lost = useCallback(
    (x: unknown) => {
      if (x instanceof TeamSyncError && LOST.includes(x.code)) e.teamSyncNow();
    },
    [e],
  );
  const fetchUsers = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setLoad('offline');
    setLoad('loading');
    try {
      const d = await e.adminDir();
      if (!alive.current) return;
      setDir(d);
      setAt(Date.now());
      setLoad('ok');
    } catch (x) {
      if (!alive.current) return;
      const r = authError(x);
      if (r.code === 'offline') return setLoad('offline');
      setLoadErr(r.msg);
      setLoad('error');
      lost(x);
    }
  }, [e, lost]);
  const signedIn = !e.auth;
  useEffect(() => {
    if (signedIn) fetchUsers();
  }, [fetchUsers, signedIn]);
  useEffect(() => {
    const online = () => fetchUsers();
    const offline = () => setLoad((l) => (l === 'loading' ? 'offline' : l));
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [fetchUsers]);

  const roles = dir?.roles || e.knownRoles;
  const rank = roleRank(roles);
  const list = [...(users || [])].sort((a, b) => (rank.get(a.role) ?? 99) - (rank.get(b.role) ?? 99) || a.name.localeCompare(b.name, 'th'));
  const today = todayISO();
  const reqN = dir ? Object.keys(dir.reqs).length : e.session?.rq || 0;
  const sec: Sec = ui.usersSec;
  const goSec = (s: Sec) => set({ usersSec: s });
  const activeAdmins = list.filter((u) => u.role === 'admin' && on(u)).length;
  const guardOf = (u: TeamUser) => (u.u === me ? SELF_GUARD : u.role === 'admin' && on(u) && activeAdmins <= 1 ? ADMIN_GUARD : '');
  const offline = load === 'offline';

  const replace = (nu: TeamUser) => setUsers((l) => (l ? (l.some((x) => x.u === nu.u) ? l.map((x) => (x.u === nu.u ? nu : x)) : [...l, nu]) : l));
  /** One account change; `quiet` leaves the error to the dialog that asked. */
  const exec = async (u: string, f: () => Promise<void>, quiet = false) => {
    setBusyU(u);
    setErr('');
    setNote('');
    try {
      await f();
    } catch (x) {
      lost(x);
      if (quiet) throw x;
      if (alive.current) setErr(authError(x).msg);
    } finally {
      if (alive.current) setBusyU('');
    }
  };
  const setRole = (u: TeamUser, role: Role) => {
    if (role === u.role) return;
    const go = () => exec(u.u, async () => { replace(await e.adminUpdate(u.u, { role })); fetchUsers(); }, true);
    const r = roleOf(roles, role);
    // a role that sends nothing (view only): what this person has typed and not sent stays unsent
    if (hasWrite(r.c)) return void go().catch(() => {});
    setAsk({ title: 'เปลี่ยนบทบาท', text: `เปลี่ยน ${u.name} เป็น ${r.n}? รายการที่ ${u.name} แก้ไว้แต่ยังไม่ถึงทีมจะส่งไม่ได้`, yes: `เปลี่ยนเป็น ${r.n}`, run: go });
  };
  const itemsOf = (u: TeamUser): Item[] => {
    const self = u.u === me;
    const lockedNow = !!u.locked && at + u.locked * 1000 > Date.now();
    const out: (Item | false)[] = [
      { label: 'แก้ไขบัญชี', run: () => setAcct(u) },
      !self && {
        label: 'ตั้งรหัสผ่านชั่วคราวใหม่',
        run: () =>
          setAsk({
            title: 'ตั้งรหัสผ่านชั่วคราวใหม่',
            text: `ตั้งรหัสผ่านชั่วคราวใหม่ให้ ${u.name}? ${u.name} จะถูกออกจากระบบทุกเครื่องทันที`,
            yes: 'ตั้งรหัสผ่านชั่วคราวใหม่',
            run: () =>
              exec(
                u.u,
                async () => {
                  const r = await e.adminReset(u.u);
                  replace(r.user);
                  setCred({ ...r, reset: true });
                },
                true,
              ),
          }),
      },
      lockedNow && { label: 'ปลดล็อก', run: () => void exec(u.u, async () => { replace(await e.adminUnlock(u.u)); setNote(`ปลดล็อก ${u.name} แล้ว`); }) },
      !self && { label: 'ออกจากระบบทุกเครื่อง', run: () => void exec(u.u, async () => { replace(await e.adminKick(u.u)); setNote(`${u.name} ถูกออกจากระบบทุกเครื่องแล้ว`); }) },
      // (not for your own account or the last admin: the line under the role select says why)
      on(u)
        ? !guardOf(u) && {
            label: 'ปิดการใช้งาน',
            danger: true,
            run: () =>
              setAsk({
                title: 'ปิดการใช้งาน',
                text: `ปิดการใช้งานบัญชี ${u.name}? จะเข้าสู่ระบบไม่ได้และถูกออกจากระบบทุกเครื่อง ข้อมูลที่ ${u.name} บันทึกไว้ยังอยู่ครบ`,
                yes: 'ปิดการใช้งาน',
                danger: true,
                run: () => exec(u.u, async () => replace(await e.adminUpdate(u.u, { on: 0 })), true),
              }),
          }
        : { label: 'เปิดใช้งานอีกครั้ง', run: () => void exec(u.u, async () => replace(await e.adminUpdate(u.u, { on: 1 }))) },
    ];
    return out.filter((x): x is Item => !!x);
  };

  // names used in the team's data that no account has yet (each needs one to keep its history); one
  // only on the team list (a partner, someone who left) can come off it instead
  const taken = new Set(list.map((u) => u.name.trim().toLowerCase()));
  const missing = users ? e.legacyNames().filter((x) => !taken.has(x.name.trim().toLowerCase())) : [];
  const unlist = (name: string) =>
    setAsk({
      title: 'ลบออกจากรายชื่อ',
      text: `ลบ ${name} ออกจากรายชื่อทีม? จะไม่มีชื่อนี้ให้เลือกเป็นผู้รับผิดชอบอีก ส่วนข้อมูลเดิมที่ใช้ชื่อนี้ยังอยู่ครบ`,
      yes: 'ลบออกจากรายชื่อ',
      danger: true,
      run: async () => {
        e.delTeam(name);
        setErr('');
        setNote('');
        refocus('#us-add'); // its chip (or its button) is gone
      },
    });

  const sub = users ? `${fmtN(list.length)} บัญชี · ${fmtN(roles.length)} บทบาท · ${reqN ? `คำขอรออนุมัติ ${fmtN(reqN)}` : 'ไม่มีคำขอรออนุมัติ'}` : undefined;
  const tabs: [Sec, string, number | null][] = [
    ['acc', 'บัญชีผู้ใช้', users ? list.length : null],
    ['roles', 'บทบาทและสิทธิ์', roles.length],
    ['req', 'คำขอสิทธิ์', dir ? reqN : null],
    ['notify', 'การแจ้งเตือน', null],
  ];
  /** Under the role: why it can't change, a request waiting, or the extras that hold. */
  const under = (u: TeamUser): ReactNode => {
    const g = guardOf(u);
    if (g) return null;
    const q = dir?.reqs[u.u];
    if (q)
      return (
        <span className="rl-sub">
          {reqWords(q, (id) => roleOf(roles, id).n)} · <button type="button" className="lnk" onClick={() => goSec('req')}>รออนุมัติ</button>
        </span>
      );
    const x = dir ? extrasOf(dir, u.u, today) : [];
    const tr = dir?.grants[u.u]?.r;
    if (tr && effRole(dir!, u, today) !== u.role) return <span className="rl-sub">บทบาทชั่วคราว {roleOf(roles, tr.id).n}{tr.until ? ` ถึง ${isoTh(tr.until)}` : ''}</span>;
    if (x.length) {
      const last = x.map((y) => y.until || '').sort().pop();
      return <span className="rl-sub">สิทธิ์เพิ่ม {x.length} รายการ{last ? ` ถึง ${isoTh(last)}` : ''}</span>;
    }
    return null;
  };
  const unitCell = <span className="rl-none">ยังไม่ระบุ</span>;
  const mailCell = (u: TeamUser) =>
    u.em ? (
      <>
        <span className="rl-mail">{u.em}</span>
        {!(u.ok === 1 || u.ok === true) && <span className="rl-sub" style={{ display: 'block' }}>รอยืนยันอีเมล</span>}
      </>
    ) : (
      <span className="rl-none">ยังไม่ใส่อีเมล</span>
    );
  return (
    <>
      <div className="rl-top">
        <div className="pg-row rl-pgrow">
          <div className="pg-h">
            <h2>ผู้ใช้และสิทธิ์</h2>
            {sub && <span className="pg-h-sub">{sub}</span>}
          </div>
          {sec === 'acc' && users && !offline && (
            <button id="us-add" className="us-btn primary" onClick={() => setAdd({ from: '#us-add' })}>
              เพิ่มผู้ใช้
            </button>
          )}
          {/* the notification rules are one team record: saved from here (the section's form) */}
          {sec === 'notify' && e.notifyLive?.on && (
            <button type="submit" form={NA_FORM} className="us-btn primary">
              บันทึก
            </button>
          )}
        </div>
        {/* the page's sections: the page-tab style the Sales Tracker uses; counts are plain muted numbers */}
        <div className="utabs rl-tabs" role="tablist" aria-label="ผู้ใช้และสิทธิ์">
          {tabs.map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={sec === k} onClick={() => goSec(k)}>
              <span>{label}</span>
              {n != null && <span className="n">{fmtN(n)}</span>}
            </button>
          ))}
        </div>
      </div>
      {note && <Notice kind="ok" role="status">{note}</Notice>}
      {err && <Notice kind="error" role="alert">{err}</Notice>}
      {sec !== 'acc' && sec !== 'notify' && (offline || load === 'error') && (
        <section className="us-card">
          <div className={'us-state' + (offline ? '' : ' bad')} role={offline ? undefined : 'alert'}>
            <span>{offline ? 'ต้องออนไลน์เพื่อจัดการผู้ใช้และสิทธิ์' : loadErr}</span>
            <button className="lnk" onClick={fetchUsers}>ลองอีกครั้ง</button>
          </div>
        </section>
      )}
      {sec === 'roles' && dir && !offline && load !== 'error' && <Roles dir={dir} reload={fetchUsers} lost={lost} />}
      {sec === 'req' && dir && !offline && load !== 'error' && <Requests dir={dir} reload={fetchUsers} lost={lost} />}
      {sec === 'notify' && <NotifyAdmin dir={dir} onEditUser={(u) => setAcct(u)} onRoles={() => goSec('roles')} />}
      {sec === 'acc' && (
      <>
      <section className="us-card" aria-labelledby="us-list-h" aria-busy={load === 'loading' || undefined}>
        <h3 id="us-list-h" className="sr-only">บัญชีผู้ใช้ของทีม</h3>
        {offline && (
          <div className="us-state">
            <span>ต้องออนไลน์เพื่อจัดการผู้ใช้</span>
            <button className="lnk" onClick={fetchUsers}>ลองอีกครั้ง</button>
          </div>
        )}
        {load === 'error' && (
          <div className="us-state bad" role="alert">
            <span>{loadErr}</span>
            <button className="lnk" onClick={fetchUsers}>ลองอีกครั้ง</button>
          </div>
        )}
        {load === 'loading' && !users && (
          <div className="us-skel" aria-label="กำลังโหลดรายชื่อผู้ใช้">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <i className="c" />
                <i />
                <i className="s" />
              </div>
            ))}
          </div>
        )}
        {users && !offline && load !== 'error' && (narrow ? (
          <ul className="us-cards">
            {list.map((u) => (
              <li key={u.u} className={'us-c' + (on(u) ? '' : ' off')}>
                <div className="us-c-top">
                  <Who u={u} self={u.u === me} admin={u.role === 'admin'} />
                  <RowMenu u={u} items={itemsOf(u)} busy={busyU === u.u} />
                </div>
                <div className="us-c-grid">
                  <div className="wide">
                    <span className="us-k">บทบาท</span>
                    <RoleSelect u={u} roles={roles} guard={guardOf(u)} under={under(u)} busy={busyU === u.u} onPick={(r) => setRole(u, r)} />
                  </div>
                  <div>
                    <span className="us-k">หน่วยงาน</span>
                    {unitCell}
                  </div>
                  <div>
                    <span className="us-k">สถานะ</span>
                    <Status u={u} at={at} />
                  </div>
                  <div className="wide">
                    <span className="us-k">อีเมลแจ้งเตือน</span>
                    <span>{mailCell(u)}</span>
                  </div>
                  <div className="wide">
                    <span className="us-k">เข้าสู่ระบบล่าสุด</span>
                    <span className="us-ll">{u.ll ? dtTh(u.ll) : 'ยังไม่เคยเข้าสู่ระบบ'}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <table className="us-table rl-acc">
            <thead>
              <tr>
                <th scope="col">ผู้ใช้</th>
                <th scope="col">บทบาท</th>
                <th scope="col">หน่วยงาน</th>
                <th scope="col">อีเมลแจ้งเตือน</th>
                <th scope="col">สถานะ</th>
                <th scope="col">เข้าสู่ระบบล่าสุด</th>
                <th scope="col"><span className="sr-only">จัดการ</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.u} className={on(u) ? undefined : 'off'}>
                  <td><Who u={u} self={u.u === me} admin={u.role === 'admin'} /></td>
                  <td><RoleSelect u={u} roles={roles} guard={guardOf(u)} under={under(u)} busy={busyU === u.u} onPick={(r) => setRole(u, r)} /></td>
                  <td>{unitCell}</td>
                  <td>{mailCell(u)}</td>
                  <td><Status u={u} at={at} /></td>
                  <td className="us-ll">{u.ll ? <DateTime iso={u.ll} /> : <span className="us-muted">ยังไม่เคยเข้าสู่ระบบ</span>}</td>
                  <td className="us-act"><RowMenu u={u} items={itemsOf(u)} busy={busyU === u.u} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>

      <div className="us-grid">
        {missing.length > 0 && (
          <section className="us-card us-names" aria-labelledby="us-names-h">
            <h3 id="us-names-h" className="us-h">ชื่อในทีมที่ยังไม่มีบัญชี</h3>
            <ul className="us-chips">
              {missing.map((x, i) => (
                <li key={x.name} className="us-chip">
                  <span className="us-chip-ava" aria-hidden="true">{nameLetter(x.name)}</span>
                  <span className="us-chip-t">{x.name} · {fmtN(x.cos)} บริษัท</span>
                  <button id={'us-mk-' + i} className="us-btn sm" onClick={() => setAdd({ name: x.name, from: '#us-mk-' + i })} disabled={offline} aria-label={`สร้างบัญชี ${x.name}`}>
                    สร้างบัญชี
                  </button>
                  {e.crm.team.includes(x.name) && (
                    <button className="us-btn sm bare" onClick={() => unlist(x.name)} aria-label={`ลบ ${x.name} ออกจากรายชื่อ`}>
                      ลบออกจากรายชื่อ
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="us-card us-honest" aria-labelledby="us-honest-h">
          <h3 id="us-honest-h" className="us-h">เข้าสู่ระบบช่วยอะไร</h3>
          <ul>
            {HONEST.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </div>

      {/* (was on the update page, which a team that signs in no longer has) */}
      {e.can('set.data') && (
      <section className="us-card us-backup" aria-labelledby="us-backup-h">
        <h3 id="us-backup-h" className="us-h">ไฟล์สำรองข้อมูลทีม</h3>
        <div className="us-row">
          <button className="us-btn" onClick={() => e.exportCrm()}>ส่งออกไฟล์สำรอง (.json)</button>
          <button className="us-btn" onClick={() => file.current?.click()}>นำเข้าไฟล์สำรอง</button>
          <input
            ref={file}
            type="file"
            accept=".json"
            hidden
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = '';
              if (f) e.importCrm(f);
            }}
          />
        </div>
        <span className="us-muted us-small">ไฟล์สำรองมีข้อมูลทั้งทีม</span>
        {e.tmMsg && <span className="us-tm" role="status">{e.tmMsg}</span>}
      </section>
      )}
      </>
      )}

      {add && (
        <AddUser
          initName={add.name || ''}
          users={list}
          roles={roles}
          v4={!!dir?.v4}
          onClose={() => {
            const from = add.from;
            setAdd(null);
            refocus(document.querySelector(from) ? from : '#us-add');
          }}
          onDone={(r) => {
            replace(r.user);
            setNote('');
            fetchUsers();
          }}
          lost={lost}
        />
      )}
      {cred && (
        <Modal title="ตั้งรหัสผ่านชั่วคราวใหม่" onClose={() => { setCred(null); refocus(`[data-more="${cred.user.u}"]`); }} width={520} focus="dialog">
          <CredCard cred={cred} roles={roles} onDone={() => { setCred(null); refocus(`[data-more="${cred.user.u}"]`); }} />
        </Modal>
      )}
      {ask && <Confirm ask={ask} onClose={() => setAsk(null)} />}
      {acct && dir && (
        <AccountDialog
          u={acct}
          dir={dir}
          self={acct.u === me}
          guard={guardOf(acct)}
          onClose={() => { const u = acct.u; setAcct(null); refocus(`[data-more="${u}"]`); }}
          onSaved={(msg) => { setErr(''); setNote(msg); fetchUsers(); }}
          onRoles={(rid) => { setAcct(null); set({ usersSec: 'roles' }); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-role="${rid}"]`)?.click()); }}
          lost={lost}
        />
      )}
    </>
  );
}

/** "15 ต.ค. 2569" over "08:53 น." */
function DateTime({ iso }: { iso: string }) {
  const s = dtTh(iso);
  const m = /^(.*\S)\s+(\d{1,2}:\d{2}.*)$/.exec(s);
  return m ? <>{m[1]}<span className="t">{m[2]}</span></> : <>{s}</>;
}

function Who({ u, self, admin }: { u: TeamUser; self: boolean; admin: boolean }) {
  return (
    <span className="us-who">
      <span className={'us-ava r-' + (admin ? 'admin' : 'sales')} aria-hidden="true">{nameLetter(u.name)}</span>
      <span className="us-who-t">
        <span className="us-name">
          {u.name}
          {self && <span className="us-you">คุณ</span>}
        </span>
        <span className="us-u">@{u.u}</span>
      </span>
    </span>
  );
}

function RoleSelect({ u, roles, guard, under, busy, onPick }: { u: TeamUser; roles: RoleDef[]; guard: string; under: ReactNode; busy: boolean; onPick: (r: Role) => void }) {
  const id = useId();
  // a role id the list doesn't have (deleted meanwhile): shown as it is until changed
  const opts = roles.some((r) => r.id === u.role) ? roles : [...roles, roleOf(roles, u.role)];
  return (
    <span className="us-role">
      <Select
        variant="tool"
        className={'us-rsel' + (busy ? ' busy' : '')}
        value={u.role}
        onChange={(v) => onPick(v as Role)}
        disabled={!!guard}
        label={`บทบาทของ ${u.name}`}
        describedBy={guard ? id : undefined}
        search={false}
        options={opts.map((r) => ({ v: r.id, label: r.n }))}
      />
      {guard && <span id={id} className="us-guard">{guard}</span>}
      {!guard && under}
    </span>
  );
}

function Status({ u, at }: { u: TeamUser; at: number }) {
  const until = u.locked ? at + u.locked * 1000 : 0;
  const [label, cls] = !on(u) ? ['ปิดการใช้งาน', 'off'] : until > Date.now() ? [`ถูกพักถึง ${hhmm(until)}`, 'lock'] : u.mc ? ['รอตั้งรหัสผ่าน', 'wait'] : ['ใช้งานได้', 'ok'];
  return (
    <span className={'us-st ' + cls}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

function RowMenu({ u, items, busy }: { u: TeamUser; items: Item[]; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  usePopover(open, () => setOpen(false), btn, pop);
  // nothing to do with this account (your own, once it has signed in): no ⋯ at all
  if (!items.length && !busy) return null;
  return (
    <div className="us-more">
      <button
        ref={btn}
        data-more={u.u}
        className="us-more-btn"
        onClick={() => !busy && setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`จัดการบัญชี ${u.name}`}
        aria-busy={busy || undefined}
        title="จัดการบัญชี"
      >
        {busy ? <span className="auth-spin dark" aria-hidden="true" /> : <Icon name="more" size={20} />}
      </button>
      {open && (
        <div ref={pop} id={id} role="menu" aria-label={`จัดการบัญชี ${u.name}`} className="us-menu" onKeyDown={menuKeys}>
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={'us-mi' + (it.danger ? ' danger' : '')}
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
                it.run();
              }}
            >
              <span className="us-mi-t">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Confirm({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const yes = async () => {
    setBusy(true);
    setErr('');
    try {
      await ask.run();
      onClose();
    } catch (x) {
      setErr(authError(x).msg);
      setBusy(false);
    }
  };
  return (
    <Modal title={ask.title} onClose={busy ? () => {} : onClose} width={460} focus="dialog">
      <p className="us-ask">{ask.text}</p>
      {err && <Notice kind="error" role="alert">{err}</Notice>}
      <div className="dlg-act">
        <button className="quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
        <button className={'us-btn primary' + (ask.danger ? ' danger' : '')} onClick={yes} disabled={busy}>
          {busy && <span className="auth-spin" aria-hidden="true" />}
          {ask.yes}
        </button>
      </div>
    </Modal>
  );
}

/** The temporary password, shown once, with the invitation to send privately. */
function CredCard({ cred, roles, onDone }: { cred: Cred; roles: RoleDef[]; onDone: () => void }) {
  const { engine: e } = useApp();
  const [copied, setCopied] = useState('');
  // the browser refused the clipboard: the text to copy by hand, selected (in place of its own prompt box)
  const [manual, setManual] = useState('');
  const doneRef = useRef<HTMLButtonElement>(null);
  const manRef = useRef<HTMLTextAreaElement>(null);
  const mid = useId();
  useEffect(() => {
    doneRef.current?.closest<HTMLElement>('[role=dialog]')?.focus();
  }, []);
  useEffect(() => {
    if (manual) manRef.current?.select();
  }, [manual]);
  const { user, temp } = cred;
  const invite = `เชิญเข้าใช้ฐานข้อมูลลูกค้า GCC\nลิงก์: ${inviteLink(e.teamCfg?.url || '', e.homeTeam)}\nชื่อผู้ใช้: ${user.u}\nรหัสผ่านชั่วคราว: ${temp}\n(ระบบจะให้ตั้งรหัสผ่านใหม่เมื่อเข้าครั้งแรก)`;
  const copy = async (k: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setManual('');
      setCopied(k);
      setTimeout(() => setCopied((c) => (c === k ? '' : c)), 2500);
    } catch {
      setCopied('');
      setManual(text);
    }
  };
  const rows: [string, string, string][] = [
    ['u', 'ชื่อผู้ใช้', user.u],
    ['p', 'รหัสผ่านชั่วคราว', temp],
  ];
  return (
    <div className="us-cred">
      <div className="us-cred-h">
        <b>{cred.reset ? `ตั้งรหัสผ่านชั่วคราวใหม่ให้ ${user.name} แล้ว` : `สร้างบัญชี ${user.name} แล้ว`}</b>
        <RoleChip name={roleOf(roles, user.role).n} admin={user.role === 'admin'} />
      </div>
      <dl className="us-cred-rows">
        {rows.map(([k, label, v]) => (
          <div key={k} className="us-cred-row">
            <dt>{label}</dt>
            <dd>
              <code>{v}</code>
              <button className="us-btn sm" onClick={() => copy(k, v)} aria-label={`คัดลอก${label}`}>
                {copied === k ? 'คัดลอกแล้ว' : 'คัดลอก'}
              </button>
            </dd>
          </div>
        ))}
      </dl>
      <button className="us-btn primary wide" onClick={() => copy('i', invite)}>
        {copied === 'i' ? 'คัดลอกข้อความเชิญแล้ว' : 'คัดลอกข้อความเชิญ'}
      </button>
      {manual && (
        <div className="auth-field">
          <label htmlFor={mid}>คัดลอกให้อัตโนมัติไม่ได้ ข้อความเลือกไว้แล้ว กดคัดลอกเอง (Ctrl+C หรือกดค้าง)</label>
          <textarea ref={manRef} id={mid} className="fld us-manual" readOnly value={manual} rows={manual.split('\n').length} onFocus={(ev) => ev.currentTarget.select()} />
        </div>
      )}
      <span className="us-amber">รหัสผ่านชั่วคราวแสดงครั้งเดียว ส่งให้เจ้าตัวทางแชตส่วนตัว ไม่ใช่ในกลุ่ม</span>
      <span className="sr-only" role="status">{copied ? 'คัดลอกแล้ว' : ''}</span>
      <div className="us-row end">
        <button ref={doneRef} className="quiet" onClick={onDone}>ปิด</button>
      </div>
    </div>
  );
}

function AddUser({ initName, users, roles, v4, onClose, onDone, lost }: { initName: string; users: TeamUser[]; roles: RoleDef[]; v4: boolean; onClose: () => void; onDone: (r: Cred) => void; lost: (x: unknown) => void }) {
  const { engine: e } = useApp();
  const [name, setName] = useState(initName);
  const [u, setU] = useState('');
  const [uTouched, setUTouched] = useState(false);
  const [role, setRole] = useState<Role>('sales');
  const [em, setEm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cred, setCred] = useState<Cred | null>(null);
  const user = normUser(u);
  const exists = !!user && users.some((x) => x.u === user);
  const uErr = exists ? 'มีชื่อผู้ใช้นี้แล้ว' : uTouched && u && !USER_RE.test(user) ? USER_HINT : '';
  const ids = useId();
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return setErr('ใส่ชื่อที่แสดง');
    if (!USER_RE.test(user) || exists) {
      setUTouched(true);
      return setErr(exists ? 'มีชื่อผู้ใช้นี้แล้ว' : 'ชื่อผู้ใช้ใช้ได้เฉพาะ' + USER_HINT);
    }
    const mail = em.trim();
    if (mail && !EMAIL_RE.test(mail)) return setErr('อีเมลไม่ถูกต้อง');
    setBusy(true);
    setErr('');
    try {
      const r = await e.adminCreate({ u: user, name: n, role, ...(v4 && mail ? { em: mail } : {}) });
      setCred(r);
      onDone(r);
    } catch (x) {
      lost(x);
      setErr(authError(x).msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="เพิ่มผู้ใช้" onClose={busy ? () => {} : onClose} width={560}>
      {cred ? (
        <CredCard cred={cred} roles={roles} onDone={onClose} />
      ) : (
        <form className="us-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
          <div className="us-2">
            <div className="auth-field">
              <label htmlFor={ids + 'n'}>ชื่อที่แสดง</label>
              <input id={ids + 'n'} className="auth-input" value={name} onChange={(ev) => { setName(ev.target.value); setErr(''); }} maxLength={40} placeholder="เช่น มกร" autoFocus={!initName} aria-describedby={ids + 'nh'} />
              <span id={ids + 'nh'} className="auth-hint">ชื่อที่ใช้ในข้อมูล (ผู้รับผิดชอบ ผู้บันทึก)</span>
            </div>
            <div className="auth-field">
              <label htmlFor={ids + 'u'}>ชื่อผู้ใช้</label>
              <input
                id={ids + 'u'}
                className="auth-input"
                value={u}
                onChange={(ev) => {
                  setU(ev.target.value);
                  setErr('');
                }}
                onBlur={() => setUTouched(true)}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="เช่น makorn"
                autoFocus={!!initName}
                aria-invalid={uErr ? true : undefined}
                aria-describedby={ids + 'uh'}
              />
              <span id={ids + 'uh'} className={uErr ? 'auth-field-err' : 'auth-hint'} aria-live="polite">{uErr || USER_HINT}</span>
            </div>
          </div>
          {v4 && (
            <div className="auth-field">
              <label htmlFor={ids + 'e'}>อีเมลแจ้งเตือน <span className="rl-sub">(ไม่บังคับ)</span></label>
              <input id={ids + 'e'} className="auth-input" type="email" value={em} onChange={(ev) => { setEm(ev.target.value); setErr(''); }} autoComplete="off" placeholder="name@example.com" aria-describedby={ids + 'eh'} />
              <span id={ids + 'eh'} className="auth-hint">ระบบส่งรหัสยืนยันไปที่อีเมลนี้ก่อนเริ่มส่งการแจ้งเตือน</span>
            </div>
          )}
          <div className="auth-field">
            <span className="rl-lbl" id={ids + 'r'} style={{ margin: 0 }}>บทบาท</span>
            <Select label="บทบาท" labelledBy={ids + 'r'} value={role} onChange={(v) => setRole(v as Role)} search={false} options={roles.map((r) => ({ v: r.id, label: r.n }))} />
            <span className="auth-hint">{roleLine(roleOf(roles, role))}</span>
          </div>
          {err && <Notice kind="error" role="alert">{err}</Notice>}
          <div className="dlg-act">
            <button type="button" className="quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button type="submit" className="us-btn primary" disabled={busy}>
              {busy && <span className="auth-spin" aria-hidden="true" />}
              สร้างบัญชี
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
