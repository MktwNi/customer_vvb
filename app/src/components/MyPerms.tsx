import { useEffect, useState } from 'react';
import { useApp, useEngineVersion } from '../state';
import { CAPS, GROUPS, LOCKED_CAP, capsOf, live, scopeWord, type CapId, type CapSet } from '../lib/caps';
import { isoTh, stampTh, todayISO } from '../lib/format';
import { Modal } from './Dialog';
import { RoleChip, nameLetter } from './Login';

/**
 * สิทธิ์ของฉัน: what this account may do now, by group (ดูได้ / แก้ไขได้ / เข้าถึงและจัดการ), its extras
 * beyond its role (and until when), what it may not do (folded), and the way to ask for more.
 * Works with a script that sends no capabilities too (the built-in caps of the account's role).
 */
export function MyPerms({ onClose }: { onClose: () => void }) {
  const { engine: e, set } = useApp();
  useEngineVersion();
  const [showNo, setShowNo] = useState(false);
  const s = e.session;
  // the role's own capabilities, to tell the extras apart (read through `me` once; built-ins otherwise)
  useEffect(() => {
    if (e.rolesLive && typeof navigator !== 'undefined' && navigator.onLine !== false) e.teamRoles().catch(() => {});
  }, [e]);
  if (!s) return null;
  const caps: CapSet = capsOf(s) || {};
  const rid = s.rid || s.role;
  const role = e.knownRoles.find((r) => r.id === rid);
  const today = todayISO();
  const grants = (s.g?.c || []).filter((x) => live(x.until, today));
  const tmpRole = s.g?.r && live(s.g.r.until, today) ? s.g.r : null;
  // an extra: held now but not by the role (only when the role's capabilities are known from the script)
  const extra = (k: CapId) => grants.find((x) => x.k === k) || (role && e.rolesLive && !role.c[k] ? { k, until: '' } : null);
  const admin = !!caps[LOCKED_CAP];
  const no = e.capsShown().filter((c) => !caps[c.id]);
  const mayAsk = e.rolesLive && !admin;
  const pend = s.req?.st === 'p';
  return (
    <Modal title="สิทธิ์ของฉัน" onClose={onClose} width={600}>
      <div className="rl-form">
        <div className="rl-me">
          <span className="acct-ava" aria-hidden="true">{nameLetter(s.name)}</span>
          <span className="rl-me-t">
            <b>{s.name}</b>
            <small>@{s.u}</small>
          </span>
          <RoleChip name={e.roleName()} admin={admin} />
        </div>
        {tmpRole && (
          <div className="rl-extra">
            <span>บทบาทชั่วคราว: {e.roleName()}{tmpRole.until ? ` ถึง ${isoTh(tmpRole.until)}` : ''}</span>
            <small>{[tmpRole.by && `อนุมัติโดย ${tmpRole.by}`, tmpRole.at && `เมื่อ ${stampTh(tmpRole.at)}`].filter(Boolean).join(' ')} · หมดอายุแล้วจะกลับเป็นบทบาทเดิมเอง</small>
          </div>
        )}
        {grants.map((g) => (
          <div key={g.k} className="rl-extra">
            <span>สิทธิ์เพิ่ม{g.until ? 'ชั่วคราว' : ''}: {CAPS.find((c) => c.id === g.k)?.label}{g.until ? ` ถึง ${isoTh(g.until)}` : ''}</span>
            <small>
              {[g.by && `อนุมัติโดย ${g.by}`, g.at && `เมื่อ ${stampTh(g.at)}`].filter(Boolean).join(' ')}
              {g.until ? ` · หมดอายุแล้วจะกลับเป็นสิทธิ์ของ ${e.roleName()} เอง` : ''}
            </small>
          </div>
        ))}
        <div>
          <p className="rl-lbl">สิ่งที่คุณทำได้</p>
          <dl className="rl-can">
            {GROUPS.map((g) => {
              const list = CAPS.filter((c) => c.g === g.id && caps[c.id]);
              if (!list.length) return null;
              return (
                <div key={g.id} style={{ display: 'contents' }}>
                  <dt>{g.title}</dt>
                  <dd>
                    <ul>
                      {list.map((c) => {
                        const x = extra(c.id);
                        return (
                          <li key={c.id}>
                            {c.label}
                            {x ? <small>สิทธิ์เพิ่ม{x.until ? ` ถึง ${isoTh(x.until)}` : ''}</small> : caps[c.id] === 'own' ? <small>{scopeWord(c.id, 'own')}</small> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
        {no.length > 0 && (
          <div className="rl-cant-w">
            <div className="rl-cant">
              ทำไม่ได้ {no.length} รายการ
              <button type="button" className="lnk" aria-expanded={showNo} onClick={() => setShowNo(!showNo)}>{showNo ? 'ซ่อน' : 'แสดง'}</button>
            </div>
            {showNo && (
              <div className="rl-cant">
                <ul>
                  {no.map((c) => <li key={c.id}>{c.label}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="rl-dlg-f">
          <span className="rl-sub">
            {admin ? 'ผู้ดูแลระบบทำได้ทุกอย่างเสมอ' : !e.rolesLive ? 'ขอสิทธิ์เพิ่มได้หลังผู้ดูแลระบบอัปเดตสคริปต์ของทีม (Code.gs)' : pend ? 'มีคำขอที่รออนุมัติอยู่ ส่งใหม่จะแทนคำขอเดิม' : 'อยากได้สิทธิ์เพิ่ม ส่งคำขอให้ผู้ดูแลระบบอนุมัติ'}
          </span>
          <button type="button" className="quiet" onClick={onClose}>ปิด</button>
          {mayAsk && (
            <button type="button" className="btn pri" onClick={() => set({ acctDlg: 'request', reqInit: pend ? { k: s.req!.st === 'p' ? s.req!.k : 'role' } : null })}>
              {pend ? 'ดูคำขอ' : 'ขอเปลี่ยนสิทธิ์'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
