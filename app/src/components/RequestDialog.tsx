import { useEffect, useId, useState, type FormEvent } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CAP, CAPS, GROUPS, LOCKED_CAP, capsOf, closeNeeds, gained, listWords, lost, needsChain, type CapId, type CapSet, type RoleDef } from '../lib/caps';
import { addDays, todayISO } from '../lib/format';
import { Modal } from './Dialog';
import { RoleChip, authError } from './Login';
import { Check, Radio } from './Pop';
import { DateField, Notice } from './ui';

const NOTE_MAX = 300;

/**
 * ขอเปลี่ยนสิทธิ์: ask the admins for another role (each role says what it adds and takes away) or for
 * some capabilities on top of the role (one that needs another asks for both), with a reason and, if
 * only for a while, the last day. One request per person: sending again replaces the pending one.
 * Online only (it goes straight to the team script, like a password change).
 */
export function RequestDialog({ onClose }: { onClose: () => void }) {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const s = e.session;
  const pend = s?.req?.st === 'p' ? s.req : null;
  const [k, setK] = useState<'role' | 'caps'>(ui.reqInit?.k || pend?.k || 'role');
  const [roles, setRoles] = useState<RoleDef[]>(e.knownRoles);
  const [role, setRole] = useState(pend?.k === 'role' ? pend.role || '' : '');
  const [pick, setPick] = useState<CapSet>(() => Object.fromEntries((pend?.caps || []).map((x) => [x.k, x.s])) as CapSet);
  const [note, setNote] = useState(pend?.note || '');
  const [tmp, setTmp] = useState(!!pend?.until);
  const [until, setUntil] = useState(pend?.until || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ids = useId();
  useEffect(() => {
    e.teamRoles().then(setRoles, () => {});
  }, [e]);
  if (!s) return null;
  const have: CapSet = capsOf(s) || {};
  const rid = s.rid || s.role;
  const baseName = e.roleName();
  // the roles one may ask for: not admin (an admin sets that), not the one held now
  const choices = roles.filter((r) => r.id !== 'admin' && r.id !== rid);
  const tomorrow = addDays(todayISO(), 1);
  // capabilities to ask for: not held, never set.users; ticking one asks for what it needs too
  const toggle = (id: CapId) =>
    setPick((p) => {
      const n: CapSet = { ...p };
      if (n[id]) {
        delete n[id];
        // what needed it (and is not held) goes too
        const keep = closeNeeds({ ...have, ...n });
        (Object.keys(n) as CapId[]).forEach((x) => !keep[x] && delete n[x]);
      } else {
        n[id] = 'all';
        needsChain(id, { ...have, ...n }).forEach((x) => (n[x] = 'all'));
      }
      return n;
    });
  const picked = (Object.keys(pick) as CapId[]).filter((x) => !have[x]);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (k === 'role' && !role) return setErr('เลือกบทบาทที่ขอ');
    if (k === 'caps' && !picked.length) return setErr('เลือกสิทธิ์ที่ขออย่างน้อย 1 รายการ');
    if (!note.trim()) return setErr('ใส่เหตุผลของคำขอ');
    if (tmp && (!until || until < tomorrow)) return setErr('เลือกวันสุดท้ายที่ต้องการสิทธิ์ (หลังวันนี้)');
    setBusy(true);
    setErr('');
    try {
      await e.reqSend({ k, ...(k === 'role' ? { role } : { caps: picked.map((x) => ({ k: x, s: pick[x] || 'all' })) }), note, ...(tmp ? { until } : {}) });
      onClose();
    } catch (x) {
      setErr(authError(x).msg);
      setBusy(false);
    }
  };
  return (
    <Modal title="ขอเปลี่ยนสิทธิ์" onClose={busy ? () => {} : onClose} width={600}>
      <form className="rl-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <div className="rl-now">
          ตอนนี้คุณเป็น <RoleChip name={baseName} admin={!!have[LOCKED_CAP]} />
          <button type="button" className="lnk" onClick={() => set({ acctDlg: 'perms' })}>ดูสิทธิ์ของฉัน</button>
        </div>
        {pend && <span className="rl-sub">คุณมีคำขอที่รออนุมัติอยู่ ส่งใหม่จะแทนคำขอเดิม</span>}
        <div className="seg rl-req-seg" role="group" aria-label="ขออะไร">
          <button type="button" aria-pressed={k === 'role'} onClick={() => (setK('role'), setErr(''))}>ขอบทบาทใหม่</button>
          <button type="button" aria-pressed={k === 'caps'} onClick={() => (setK('caps'), setErr(''))}>ขอสิทธิ์เพิ่มบางรายการ</button>
        </div>
        {k === 'role' ? (
          <div role="radiogroup" aria-labelledby={ids + 'r'}>
            <p className="rl-lbl" id={ids + 'r'}>บทบาทที่ขอ</p>
            <div className="rl-rcs">
              {!choices.length && <span className="rl-sub">ยังไม่มีบทบาทอื่นให้ขอ</span>}
              {choices.map((r) => {
                const g = gained(have, r.c), l = lost(have, r.c);
                const on = role === r.id;
                return (
                  <label key={r.id} className={'rl-rc' + (on ? ' on' : '')}>
                    <span className={'fck' + (on ? ' on' : '')}>
                      <input type="radio" name="req-role" className="sr-only" checked={on} onChange={() => (setRole(r.id), setErr(''))} />
                      <Radio />
                    </span>
                    <span className="rl-rc-t">
                      <b>{r.n}</b>
                      {g.length > 0 && <span className="gain">ทำได้เพิ่ม: {listWords(g)}</span>}
                      {l.length > 0 && <span>ทำไม่ได้แล้ว: {listWords(l, 2)}</span>}
                      {!g.length && !l.length && <span>สิทธิ์เท่ากับที่มีอยู่</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <p className="rl-lbl">เลือกสิทธิ์ที่ขอเพิ่ม{picked.length ? ` · เลือกแล้ว ${picked.length} รายการ` : ''}</p>
            <div className="rl-capl">
              {GROUPS.map((g) => {
                const items = CAPS.filter((c) => c.g === g.id && !have[c.id] && c.id !== LOCKED_CAP);
                if (!items.length) return null;
                return (
                  <div key={g.id} role="group" aria-label={g.title} style={{ display: 'contents' }}>
                    <span className="rl-capl-g">{g.title}</span>
                    {items.map((c) => {
                      const on = !!pick[c.id];
                      const need = needsChain(c.id, { ...have, ...pick });
                      const hint = !on && need.length ? `ติ๊กแล้วจะขอ “${need.map((x) => CAP[x].label).join('” และ “')}” ให้ด้วย` : c.desc;
                      return (
                        <label key={c.id} className={'rl-rc' + (on ? ' on' : '') + (!on && need.length ? ' need' : '')}>
                          <span className={'fck' + (on ? ' on' : '')}>
                            <input type="checkbox" className="sr-only" checked={on} onChange={() => (toggle(c.id), setErr(''))} />
                            <Check on={on} />
                          </span>
                          <span className="rl-rc-t">
                            <b>{c.label}</b>
                            <span>{hint}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="auth-field">
          <label htmlFor={ids + 'n'}>
            เหตุผล <span className="rl-sub">(ต้องใส่)</span>
          </label>
          <textarea id={ids + 'n'} className="fld rl-ta" rows={k === 'role' ? 3 : 2} maxLength={NOTE_MAX} value={note} onChange={(ev) => (setNote(ev.target.value), setErr(''))} placeholder="เช่น ดูแลงานแทนเพื่อนช่วงลา" />
        </div>
        <div className="rl-tmp">
          <label className={'fck' + (tmp ? ' on' : '')}>
            <input type="checkbox" className="sr-only" checked={tmp} onChange={() => setTmp(!tmp)} />
            <Check on={tmp} />
            <span>ขอแบบชั่วคราว ถึงวันที่</span>
          </label>
          {tmp && <DateField value={until} onChange={(v) => (setUntil(v), setErr(''))} min={tomorrow} label="วันสุดท้ายที่ต้องการสิทธิ์" />}
          {tmp && k === 'role' && <span className="rl-sub" style={{ flexBasis: '100%' }}>ครบกำหนดแล้วกลับเป็น {baseName} เอง</span>}
        </div>
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        <div className={'rl-dlg-f' + (k === 'caps' ? ' rl-stick' : '')}>
          <span className="rl-sub">{k === 'caps' && picked.length ? `เลือกแล้ว ${picked.length} รายการ · ` : ''}ผู้ดูแลระบบจะเห็นคำขอในหน้า ผู้ใช้และสิทธิ์ และได้อีเมลแจ้ง ถ้าเปิดรับไว้</span>
          <button type="button" className="quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="btn pri" disabled={busy}>
            {busy && <span className="auth-spin" aria-hidden="true" />}
            ส่งคำขอ
          </button>
        </div>
      </form>
    </Modal>
  );
}
