import { useId, useState, type FormEvent } from 'react';
import { useApp } from '../../state';
import type { TeamDir, TeamUser } from '../../lib/engine';
import { CAP, CAPS, LOCKED_CAP, closeNeeds, hasWrite, needsChain, resolveCaps, roleLine, unionCaps, type CapGrant, type CapId, type CapSet } from '../../lib/caps';
import { addDays, isoTh, todayISO } from '../../lib/format';
import { Modal } from '../../components/Dialog';
import { Select } from '../../components/Select';
import { DateField, Notice } from '../../components/ui';
import { authError } from '../../components/Login';
import { EMAIL_RE, extrasOf, roleOf, userName } from './shared';

/**
 * แก้ไขบัญชี (an account's row ⋯): its display name (only before its first sign-in: afterwards the name is
 * in the data), notification e-mail (verified with a code the script sends; package notify), unit
 * (package dash: a placeholder until units exist), role, and the extras given to this person alone
 * (until a date, or for good). Saved together with บันทึก, online only.
 */
export function AccountDialog({ u, dir, self, guard, onClose, onSaved, onRoles, lost }: {
  u: TeamUser; dir: TeamDir; self: boolean; guard: string; onClose: () => void; onSaved: (msg: string) => void; onRoles: (rid: string) => void; lost: (x: unknown) => void;
}) {
  const { engine: e } = useApp();
  const ids = useId();
  const today = todayISO();
  const [name, setName] = useState(u.name);
  const [em, setEm] = useState(u.em || '');
  const [role, setRole] = useState(u.role);
  const [drop, setDrop] = useState<string[]>([]); // extras (cap ids, or 'role') to take away
  const [add, setAdd] = useState<CapGrant[]>([]);
  const [give, setGive] = useState<{ k: CapId | ''; until: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const r = roleOf(dir.roles, role);
  const extras = extrasOf(dir, u.u, today);
  const tmpRole = dir.grants[u.u]?.r && (!dir.grants[u.u]!.r!.until || dir.grants[u.u]!.r!.until! >= today) ? dir.grants[u.u]!.r! : null;
  // what this person has now with the role picked and the extras kept: what can still be given
  const keep = extras.filter((x) => !drop.includes(x.k));
  const now = resolveCaps(role, Object.fromEntries(dir.roles.map((x) => [x.id, x.c])), { c: [...keep, ...add].map((x) => ({ ...x, until: x.until || undefined })) }, today);
  const givable = CAPS.filter((c) => c.id !== LOCKED_CAP && !now[c.id]);
  const nameOk = !u.ll; // the display name is fixed once the account has signed in
  const emailChanged = em.trim() !== (u.em || '');
  const verified = !!u.em && !emailChanged && (u.ok === 1 || u.ok === true);
  const stage = () => {
    if (!give?.k) return;
    const k = give.k;
    const need = needsChain(k, unionCaps(now, Object.fromEntries(add.map((x) => [x.k, 'all'])) as CapSet));
    const at = new Date().toISOString();
    setAdd((a) => [...a.filter((x) => x.k !== k && !need.includes(x.k as CapId)), { k, s: 'all', ...(give.until ? { until: give.until } : {}), at }, ...need.map((n) => ({ k: n, s: 'all' as const, ...(give.until ? { until: give.until } : {}), at }))]);
    setGive(null);
  };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return setErr('ใส่ชื่อที่แสดง');
    const mail = em.trim();
    if (mail && !EMAIL_RE.test(mail)) return setErr('อีเมลไม่ถูกต้อง');
    setBusy(true);
    setErr('');
    const said: string[] = [];
    try {
      if (nameOk && n !== u.name) {
        await e.adminRename(u, n);
        said.push('ชื่อที่แสดง');
      }
      if (dir.v4 && emailChanged) {
        await e.adminUpdate(u.u, { em: mail });
        said.push(mail ? 'อีเมล (ส่งรหัสยืนยันแล้ว)' : 'อีเมล');
      }
      if (!guard && role !== u.role) {
        await e.adminUpdate(u.u, { role });
        said.push('บทบาท');
      }
      for (const k of drop) await e.grantDel(u.u, k as CapId | 'role');
      if (add.length) await e.grantSave(u.u, add.map((x) => ({ k: x.k as CapId, s: x.s || 'all', ...(x.until ? { until: x.until } : {}) })));
      if (drop.length || add.length) said.push('สิทธิ์เพิ่ม');
      onSaved(said.length ? `บันทึก${said.join(' ')} ของ ${n} แล้ว` : '');
      onClose();
    } catch (x) {
      lost(x);
      setErr(authError(x).msg);
      setBusy(false);
    }
  };
  const roleNoWrite = role !== u.role && !hasWrite(closeNeeds(r.c));
  return (
    <Modal title={`แก้ไขบัญชี · ${u.name}`} onClose={busy ? () => {} : onClose} width={600}>
      <form className="rl-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <div className="auth-field">
          <label htmlFor={ids + 'n'}>ชื่อที่แสดง</label>
          {nameOk ? (
            <input id={ids + 'n'} className="auth-input" value={name} onChange={(ev) => (setName(ev.target.value), setErr(''))} maxLength={40} />
          ) : (
            <div id={ids + 'n'} className="rl-ro-box">{u.name}</div>
          )}
          <span className="auth-hint">@{u.u} · แก้ชื่อได้เฉพาะก่อนเข้าสู่ระบบครั้งแรก{nameOk ? '' : ' เพราะชื่อนี้อยู่ในข้อมูลแล้ว'}</span>
        </div>
        <div className="us-2">
          <div className="auth-field">
            <label htmlFor={ids + 'e'}>
              อีเมลแจ้งเตือน {verified && <span className="st ok" style={{ marginLeft: 6, fontSize: 12 }}>ยืนยันแล้ว</span>}
            </label>
            <input id={ids + 'e'} className="auth-input" type="email" value={em} onChange={(ev) => (setEm(ev.target.value), setErr(''))} disabled={!dir.v4} placeholder={dir.v4 ? 'name@example.com' : ''} autoComplete="off" />
            <span className="auth-hint">
              {dir.v4 ? 'เห็นเฉพาะผู้ดูแลระบบและเจ้าตัว ถ้าเปลี่ยน ระบบส่งรหัสยืนยันไปที่อีเมลใหม่ก่อนเริ่มส่ง' : 'ใส่อีเมลได้หลังอัปเดตสคริปต์ของทีม (Code.gs)'}
            </span>
          </div>
          <div className="auth-field">
            <span className="rl-lbl" id={ids + 'u'} style={{ margin: 0 }}>หน่วยงาน/ฝ่าย</span>
            {/* units (package dash) come with the commission split: until then the field says so */}
            <Select label="หน่วยงาน/ฝ่าย" labelledBy={ids + 'u'} value="" onChange={() => {}} disabled options={[{ v: '', label: 'ยังไม่มีหน่วยงาน' }]} />
            <span className="auth-hint">ใช้แบ่งยอดและค่าคอมมิชชั่นตามหน่วยงาน · เลือกได้เมื่อตั้งหน่วยงานแล้ว (มาพร้อมการแบ่งยอดตามหน่วยงาน)</span>
          </div>
        </div>
        <div className="auth-field">
          <span className="rl-lbl" id={ids + 'r'} style={{ margin: 0 }}>บทบาท</span>
          <Select label="บทบาท" labelledBy={ids + 'r'} value={role} onChange={(v) => setRole(v)} disabled={!!guard} search={false} options={dir.roles.map((x) => ({ v: x.id, label: x.n }))} />
          <span className="auth-hint">
            {guard || roleLine(r)} · <button type="button" className="lnk" style={{ fontSize: 12 }} onClick={() => onRoles(role)}>ดูสิทธิ์ทั้งหมด</button>
          </span>
          {roleNoWrite && <span className="auth-hint">รายการที่ {u.name} แก้ไว้แต่ยังไม่ถึงทีมจะส่งไม่ได้</span>}
        </div>
        {!self && dir.v4 && role !== 'admin' && (
          <div>
            <p className="rl-lbl">สิทธิ์เพิ่มเฉพาะคนนี้</p>
            <div className="rl-capl" style={{ gap: 8 }}>
              {tmpRole && (
                <div className={'rl-extra rl-extra-r' + (drop.includes('role') ? ' gone' : '')}>
                  <span>
                    <span>บทบาทชั่วคราว {roleOf(dir.roles, tmpRole.id).n}{tmpRole.until ? ` · ถึง ${isoTh(tmpRole.until)}` : ''}</span>
                    <small>{tmpRole.by ? `อนุมัติโดย ${userName(dir, tmpRole.by)}` : ''}{tmpRole.at ? ` เมื่อ ${isoTh(tmpRole.at)}` : ''}</small>
                  </span>
                  <button type="button" className="quiet" onClick={() => setDrop((d) => (d.includes('role') ? d.filter((x) => x !== 'role') : [...d, 'role']))}>{drop.includes('role') ? 'คงไว้' : 'เอาออก'}</button>
                </div>
              )}
              {extras.map((x) => (
                <div key={x.k} className={'rl-extra rl-extra-r' + (drop.includes(x.k) ? ' gone' : '')}>
                  <span>
                    <span>{CAP[x.k as CapId]?.label || x.k}{x.until ? ` · ถึง ${isoTh(x.until)}` : ''}</span>
                    <small>{x.by ? `ให้โดย ${userName(dir, x.by)}` : ''}{x.at ? ` เมื่อ ${isoTh(x.at)}` : ''}</small>
                  </span>
                  <button type="button" className="quiet" onClick={() => setDrop((d) => (d.includes(x.k) ? d.filter((y) => y !== x.k) : [...d, x.k]))}>{drop.includes(x.k) ? 'คงไว้' : 'เอาออก'}</button>
                </div>
              ))}
              {add.map((x) => (
                <div key={'n' + x.k} className="rl-extra rl-extra-r">
                  <span>
                    <span>{CAP[x.k as CapId].label}{x.until ? ` · ถึง ${isoTh(x.until)}` : ''}</span>
                    <small>ให้ใหม่ · มีผลเมื่อกดบันทึก</small>
                  </span>
                  <button type="button" className="quiet" onClick={() => setAdd((a) => a.filter((y) => y.k !== x.k))}>เอาออก</button>
                </div>
              ))}
              {!tmpRole && !extras.length && !add.length && <span className="rl-sub">ยังไม่มี</span>}
            </div>
            {give ? (
              <div className="rl-give">
                <Select label="สิทธิ์ที่ให้เพิ่ม" value={give.k} onChange={(v) => setGive({ ...give, k: v as CapId })} placeholder="เลือกสิทธิ์" options={givable.map((c) => ({ v: c.id, label: c.label }))} />
                <DateField value={give.until} onChange={(v) => setGive({ ...give, until: v })} min={addDays(today, 1)} placeholder="ไม่มีวันสิ้นสุด" label="ถึงวันที่ (ไม่บังคับ)" />
                <button type="button" className="btn sm" disabled={!give.k} onClick={stage}>เพิ่ม</button>
                <button type="button" className="quiet" onClick={() => setGive(null)}>ยกเลิก</button>
              </div>
            ) : (
              givable.length > 0 && <button type="button" className="lnk" style={{ marginTop: 8 }} onClick={() => setGive({ k: '', until: '' })}>ให้สิทธิ์เพิ่ม</button>
            )}
          </div>
        )}
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        <div className="dlg-act">
          <button type="button" className="quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="btn pri" disabled={busy}>
            {busy && <span className="auth-spin" aria-hidden="true" />}
            บันทึก
          </button>
        </div>
      </form>
    </Modal>
  );
}
