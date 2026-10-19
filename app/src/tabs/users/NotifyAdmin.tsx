import { useEffect, useId, useState } from 'react';
import { useApp, useEngineVersion, useNarrow } from '../../state';
import type { TeamDir, TeamUser } from '../../lib/engine';
import { BUILTIN, can, resolveCaps, type CapSet } from '../../lib/caps';
import { PRE_DAYS, parseMyNotify, unmatchedNames, wantsLine, type ApptRule, type LateRule, type NotifyCfg, type NotifyStatus } from '../../lib/notify';
import { errText } from '../../lib/teamSync';
import { fmtN, pad, todayISO } from '../../lib/format';
import { Notice, Segmented } from '../../components/ui';
import { Select } from '../../components/Select';
import { Check } from '../../components/Pop';
import { nameLetter } from '../../components/Login';
import { effRole, isOn, roleOf } from './shared';

const LATE: { v: LateRule; label: string }[] = [
  { v: 'daily', label: 'ทุกวัน' },
  { v: 'mon', label: 'ทุกวันจันทร์' },
  { v: 'once', label: 'ครั้งเดียว' },
];
const APPT: { v: ApptRule; label: string }[] = [
  { v: 'today', label: 'นัดวันนี้' },
  { v: 'today+1', label: 'นัดวันนี้และพรุ่งนี้' },
];
const hm = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** The id of the form the page head's "บันทึก" submits (tabs/Users.tsx). */
export const NA_FORM = 'na-form';

/** What each account may do today (its role, a temporary role, extras), for who checks and who gets mail. */
export function capsOfUser(dir: TeamDir, u: TeamUser, today: string): CapSet {
  const roles = Object.fromEntries((dir.v4 ? dir.roles : Object.values(BUILTIN)).map((r) => [r.id, r.c]));
  return resolveCaps(u.role, roles, dir.grants[u.u], today);
}

/**
 * ผู้ใช้และสิทธิ์ › การแจ้งเตือน (package notify, screens 06 and 06b): whether the script sends e-mail (its
 * last run, today's sending against the quota, a test mail), who checks quotations (the holders of ตรวจ/
 * อนุมัติใบเสนอราคา; the uploader may check their own only if switched on here), how early and how often
 * instalments are mentioned, which appointments the digest lists, who gets what (each person chooses in
 * การแจ้งเตือนของฉัน) and the names in ผู้รับผิดชอบ that match no account, and the sender's name. The rules
 * are one team record (scfg/notify.cfg), saved by the page head's "บันทึก". Before the script update: the
 * owner's three steps, the rules dimmed.
 */
export function NotifyAdmin({ dir, onEditUser, onRoles }: { dir: TeamDir | null; onEditUser: (u: TeamUser) => void; onRoles: () => void }) {
  const { engine: e, go } = useApp();
  useEngineVersion();
  const narrow = useNarrow(761);
  const ids = useId();
  const live = e.notifyLive;
  const on = !!live?.on;
  const [cfg, setCfg] = useState<NotifyCfg>(() => e.notifyCfg());
  const [dirty, setDirty] = useState(false);
  // the team's record as it arrives (another admin saved): taken while nothing was changed here
  const saved = JSON.stringify(e.notifyCfg());
  useEffect(() => {
    if (!dirty) setCfg(JSON.parse(saved));
  }, [saved, dirty]);
  const [st, setSt] = useState<NotifyStatus | null>(null);
  const [stErr, setStErr] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!on) return;
    let ok = true;
    e.notifyStatus().then(
      (x) => ok && setSt(x),
      (x) => ok && setStErr(errText(x, 'connect')),
    );
    return () => {
      ok = false;
    };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = todayISO();
  const users = (dir?.users || []).filter(isOn);
  /** What an account chose to get: the users reply has it (users[].notify), an older status reply too. */
  const wants = (u: TeamUser) => st?.users[u.u] || parseMyNotify(u.notify, can(capsOf(u), 'set.users'));
  const capsOf = (u: TeamUser) => (dir ? capsOfUser(dir, u, today) : {});
  const checkers = users.filter((u) => can(capsOf(u), 'qt.check'));
  const roleName = (u: TeamUser) => roleOf(dir?.roles || [], effRole(dir || { grants: {} }, u, today)).n;
  const un = dir ? unmatchedNames(e.sales, e.crm.tasks, e.crm.owners, dir.users.map((u) => u.name)) : [];
  const upd = (p: Partial<NotifyCfg>) => {
    setCfg((c) => ({ ...c, ...p }));
    setDirty(true);
    setNote('');
  };
  const sent = st?.sent ?? null, left = st?.left ?? null;
  const total = sent != null && left != null ? sent + left : null;
  const test = async () => {
    setBusy(true);
    setErr('');
    setNote('');
    try {
      await e.notifyTest();
      setNote('ส่งอีเมลทดสอบไปที่อีเมลของคุณแล้ว ถ้าไม่เห็นใน 5 นาที ดูในโฟลเดอร์สแปม');
    } catch (x) {
      setErr(errText(x, 'connect'));
    } finally {
      setBusy(false);
    }
  };
  // st.on: the script's timer is there (setupNotify ran and nobody removed it); without it nothing is mailed
  const word = !st ? null : !st.on ? ['wait', 'หยุดส่งอยู่'] : st.last && !st.last.ok ? ['wait', 'มีปัญหา'] : left != null && left <= 5 ? ['wait', 'ใกล้ครบโควตาวันนี้'] : ['', 'ทำงานอยู่'];

  return (
    <form
      id={NA_FORM}
      className="na"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!on) return;
        e.saveNotifyCfg({ ...cfg, sender: cfg.sender.trim() || 'GCC Sales Tracker' });
        setDirty(false);
        setErr('');
        setNote('บันทึกการตั้งค่าการแจ้งเตือนแล้ว มีผลกับทั้งทีม');
      }}
    >
      {note && <Notice kind="ok" role="status">{note}</Notice>}
      {err && <Notice kind="error" role="alert">{err}</Notice>}
      {on ? (
        <section className="us-card na-st" aria-label="ระบบส่งอีเมล">
          <div className="na-st-t">
            <div className="na-st-h">
              <b>ระบบส่งอีเมล</b>
              {word && <span className={'na-word ' + word[0]}><i aria-hidden="true" />{word[1]}</span>}
            </div>
            <small>
              {[
                st?.from ? `ส่งจาก ${st.from} (บัญชี Google ที่เป็นเจ้าของสคริปต์ของทีม)` : 'ส่งจากบัญชี Google ที่เป็นเจ้าของสคริปต์ของทีม',
                st?.last?.at ? `ตรวจรอบล่าสุด ${hm(st.last.at)}` : '',
                'ตรวจทุก 10 นาที',
              ].filter(Boolean).join(' · ')}
            </small>
            {st && !st.on && <small className="t-warn">ไม่พบตัวตั้งเวลาของสคริปต์ ให้เจ้าของสคริปต์เปิด Apps Script เลือกฟังก์ชัน “setupNotify” แล้วกด “Run” อีกครั้ง</small>}
            {st?.last && !st.last.ok && st.last.err && <small className="t-warn">{st.last.err}</small>}
            {stErr && <small className="t-warn">{stErr}</small>}
            {!e.notifyCfg().site && <small>กด “บันทึก” ที่หน้านี้ 1 ครั้ง เพื่อให้อีเมลมีลิงก์และโลโก้ของเว็บนี้</small>}
          </div>
          {total != null && total > 0 && (
            <div className="na-quota">
              <span>วันนี้ส่งไปแล้ว <b>{fmtN(sent)}</b> จาก {fmtN(total)} ฉบับ</span>
              <span className="na-bar"><i style={{ width: Math.min(100, Math.round((sent! / total) * 100)) + '%' }} /></span>
            </div>
          )}
          <button type="button" className="btn sm" disabled={busy} onClick={test}>ส่งอีเมลทดสอบถึงฉัน</button>
        </section>
      ) : (
        <section className="us-card na-setup" aria-label="ระบบส่งอีเมล">
          <div className="na-st-h">
            <b>ระบบส่งอีเมล</b>
            <span className="na-word off"><i aria-hidden="true" />ยังไม่เปิดใช้</span>
          </div>
          <span className="na-lead">
            {live
              ? 'สคริปต์ของทีมเป็นรุ่นใหม่แล้ว แต่ยังไม่ได้เปิดการส่งอีเมล เจ้าของสคริปต์ (บัญชีที่สร้างชีตของทีม) ทำข้อ 2 และ 3 ด้านล่าง'
              : 'สคริปต์ของทีมยังเป็นรุ่นที่ส่งอีเมลไม่ได้ เจ้าของสคริปต์ (บัญชีที่สร้างชีตของทีม) ต้องอัปเดตครั้งเดียว ใช้เวลาประมาณ 5 นาที'}
          </span>
          <ol>
            <li>เปิดชีตของทีม เมนู “ส่วนขยาย” แล้วเลือก “Apps Script” วางโค้ดรุ่นใหม่ทับ (เก็บบรรทัด TEAM_KEY เดิมไว้) แล้วกดบันทึก</li>
            <li>เลือกฟังก์ชัน “setupNotify” แล้วกด “Run” Google จะถามสิทธิ์ใหม่ 2 อย่าง: ส่งอีเมลในนามคุณ และทำงานเมื่อคุณไม่ได้เปิดอยู่ กด “อนุญาต”</li>
            <li>กด “Deploy” เลือก “Manage deployments” กด “Edit” เลือก Version เป็น “New version” แล้วกด Deploy (อย่ากด New deployment เพราะลิงก์ของทีมจะเปลี่ยน)</li>
          </ol>
          <span className="na-m">ระหว่างนี้ กระดิ่งในเว็บใช้ได้แล้วสำหรับงวดเงินและนัดหมาย · การตรวจใบเสนอราคาและอีเมลเริ่มหลังอัปเดต · ทำข้อ 2 ก่อนข้อ 3 เสมอ</span>
        </section>
      )}
      <div className={'na-grid' + (on ? '' : ' na-dim')} inert={!on}>
        <div className="na-col">
          <section className="us-card na-card" aria-labelledby={ids + 'q'}>
            <h3 className="us-h" id={ids + 'q'}>
              ใบเสนอราคา
              <button type="button" className="lnk" onClick={onRoles}>แก้ผู้ตรวจในบทบาทและสิทธิ์</button>
            </h3>
            <div className="na-blk">
              <span>{dir ? `ผู้ตรวจ ${checkers.length} คน` : 'กำลังโหลดรายชื่อผู้ตรวจ'}</span>
              {checkers.length > 0 && (
                <ul className="na-who">
                  {checkers.map((u) => (
                    <li key={u.u} className="us-chip">
                      <span className="us-chip-ava" aria-hidden="true">{nameLetter(u.name)}</span>
                      <span className="us-chip-t">{u.name} <small>{roleName(u)}</small></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <span className="na-m">คือบัญชีที่มีสิทธิ์ “ตรวจ/อนุมัติใบเสนอราคา” คนใดคนหนึ่งตรวจก็พอ · แต่ละคนปิดอีเมลรอตรวจของตัวเองได้ · การอนุมัติคือยืนยันว่าตัวเลขตรงกับไฟล์ ไม่เปลี่ยน Forecast</span>
            <span className="na-m">แนบฉบับแก้ไข แก้ยอด หรือเปลี่ยนไฟล์ ใบนั้นกลับเป็น “รอตรวจ” และส่งอีเมลให้ผู้ตรวจอีกครั้งเสมอ</span>
            <div className="ns-rows">
              <div className={'ns-row' + (cfg.self ? ' on' : ' off')}>
                <label className="ns-l">
                  <input type="checkbox" className="sr-only" checked={cfg.self} onChange={(ev) => upd({ self: ev.target.checked })} />
                  <Check on={cfg.self} />
                  <span className="ns-t">ผู้แนบตรวจใบของตัวเองได้</span>
                  <span className="ns-s">{cfg.self ? 'เปิดไว้: ผู้ตรวจที่แนบใบเองตรวจใบนั้นได้' : 'ปิดไว้: ต้องให้ผู้ตรวจคนอื่นตรวจ'}</span>
                </label>
              </div>
            </div>
          </section>
          <section className="us-card na-card" aria-labelledby={ids + 'p'}>
            <h3 className="us-h" id={ids + 'p'}>งวดเงิน</h3>
            <div className="na-f">
              <span id={ids + 'pre'}>เตือนล่วงหน้า</span>
              <Select label="เตือนล่วงหน้า" labelledBy={ids + 'pre'} variant="tool" search={false} value={String(cfg.pre)} onChange={(v) => upd({ pre: +v })} options={[...new Set([...PRE_DAYS, cfg.pre])].sort((a, b) => a - b).map((n) => ({ v: String(n), label: `${n} วันก่อนครบกำหนด` }))} />
            </div>
            <div className="na-f">
              <span>เลยกำหนดแล้ว เตือนซ้ำ</span>
              <Segmented label="เลยกำหนดแล้ว เตือนซ้ำ" value={cfg.late} options={LATE} onChange={(v) => upd({ late: v })} />
            </div>
            <span className="na-m">ส่งถึงผู้รับผิดชอบงาน และคนที่เลือก “ทั้งทีม” · นับเฉพาะงวดของงานที่ได้งานแล้ว และยังไม่ได้รับเงิน · งวดที่ยังไม่กำหนดวันไม่มีการเตือน</span>
          </section>
          <section className="us-card na-card" aria-labelledby={ids + 'a'}>
            <h3 className="us-h" id={ids + 'a'}>นัดหมาย</h3>
            <div className="na-f">
              <span>ใส่ในสรุปวันนี้</span>
              <Segmented label="นัดของวันไหน" value={cfg.appt} options={APPT} onChange={(v) => upd({ appt: v })} />
            </div>
            <span className="na-m">นัดในแผนติดต่อส่งถึงผู้รับผิดชอบบริษัท · นัดในขั้นตอน Sales Tracker ส่งถึงผู้รับผิดชอบงาน · นัดที่เลยมาแล้วและยังไม่ได้ทำ ใส่ในสรุปจนกว่าจะทำ</span>
          </section>
        </div>
        <div className="na-col">
          <section className="us-card na-card" aria-labelledby={ids + 'r'}>
            <h3 className="us-h" id={ids + 'r'}>
              ผู้รับอีเมล
              <span className="na-m">แต่ละคนเลือกเองที่ “การแจ้งเตือนของฉัน”</span>
            </h3>
            {!dir ? (
              <span className="na-m">กำลังโหลดรายชื่อ</span>
            ) : narrow ? (
              <ul className="na-list">
                {users.map((u) => (
                  <li key={u.u}>
                    <Person u={u} role={roleName(u)} />
                    <MailCell u={u} c={capsOf(u)} onEdit={() => onEditUser(u)} />
                    <span className="na-want">{wantText(u)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <table className="us-table na-t">
                <thead>
                  <tr>
                    <th scope="col">ผู้ใช้</th>
                    <th scope="col">อีเมล</th>
                    <th scope="col">รับอะไร</th>
                    <th scope="col">เวลาสรุป</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const p = wants(u);
                    return (
                      <tr key={u.u}>
                        <td><Person u={u} role={roleName(u)} /></td>
                        <td><MailCell u={u} c={capsOf(u)} onEdit={() => onEditUser(u)} /></td>
                        <td>{wantText(u)}</td>
                        <td className="tm">{can(capsOf(u), 'notify.mail') && p?.on.dg ? p.t : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {un.length > 0 && (
              <div className="na-un">
                <span>
                  ชื่อผู้รับผิดชอบที่ไม่ตรงกับบัญชีใด:{' '}
                  {un.map((x, i) => (
                    <span key={x.name}>
                      {i > 0 && ' · '}
                      <b>{x.name}</b> {fmtN(x.n)} งาน
                    </span>
                  ))}
                </span>
                <span className="na-m">งวดเงินและนัดของงานเหล่านี้ส่งถึงเฉพาะคนที่เลือก “ทั้งทีม” · แก้ช่องผู้รับผิดชอบให้เป็นชื่อบัญชี</span>
                <button type="button" className="lnk" onClick={() => go('sales', { slView: 'table', slF: { resp: { v: un.map((x) => x.name) } } })}>ดูงานเหล่านี้</button>
              </div>
            )}
            <span className="na-m">อีเมลของแต่ละคนแก้ได้ที่แท็บ บัญชีผู้ใช้ · อีเมลใหม่ต้องยืนยันด้วยรหัส 6 หลักก่อน ระบบจึงเริ่มส่ง · ไม่ส่งอีเมลถึงลูกค้าเด็ดขาด</span>
          </section>
          <section className="us-card na-card" aria-labelledby={ids + 's'}>
            <h3 className="us-h" id={ids + 's'}>อีเมลที่ส่ง</h3>
            <div className="na-f">
              <label htmlFor={ids + 'sn'}>ชื่อผู้ส่ง</label>
              <input id={ids + 'sn'} className="fld" value={cfg.sender} maxLength={60} onChange={(ev) => upd({ sender: ev.target.value })} />
            </div>
            <span className="na-m">ผู้รับจะเห็น “{cfg.sender.trim() || 'GCC Sales Tracker'}” แทนชื่อบัญชี · กดตอบกลับอีเมลรอตรวจ จะถึงคนที่แนบใบนั้น</span>
          </section>
        </div>
      </div>
    </form>
  );

  function wantText(u: TeamUser) {
    if (!can(capsOf(u), 'notify.mail')) return <span className="no">บทบาทนี้ไม่รับอีเมล</span>;
    const p = wants(u);
    return p ? wantsLine(p, can(capsOf(u), 'qt.check')) : <span className="no">—</span>;
  }
}

function Person({ u, role }: { u: TeamUser; role: string }) {
  return (
    <span className="us-who">
      <span className="us-ava" aria-hidden="true">{nameLetter(u.name)}</span>
      <span className="us-who-t">
        <span className="us-name">{u.name}</span>
        <span className="us-u">{role}</span>
      </span>
    </span>
  );
}

function MailCell({ u, c, onEdit }: { u: TeamUser; c: CapSet; onEdit: () => void }) {
  if (!can(c, 'notify.mail')) return <span className="no">—</span>;
  if (!u.em)
    return (
      <span className="na-mail">
        <span className="no">ยังไม่ใส่อีเมล</span>
        <button type="button" className="lnk" onClick={onEdit}>ใส่อีเมล</button>
      </span>
    );
  const ok = u.ok === 1 || u.ok === true;
  return (
    <span className="na-mail">
      <span className="ml">{u.em}</span>
      {!ok && <span className="na-word wait sm"><i aria-hidden="true" />รอยืนยันอีเมล</span>}
    </span>
  );
}
