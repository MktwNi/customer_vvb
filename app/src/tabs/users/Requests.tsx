import { useState } from 'react';
import { useApp } from '../../state';
import type { TeamDir, TeamUser } from '../../lib/engine';
import { CAP, gained, listWords, scopeWord, type ReqPending } from '../../lib/caps';
import { histLine, spanWords } from '../../lib/reqText';
import { dtTh, todayISO } from '../../lib/format';
import { Notice } from '../../components/ui';
import { RoleChip, authError, nameLetter } from '../../components/Login';
import { effRole, roleOf, userName } from './shared';

/**
 * คำขอสิทธิ์: the requests waiting (who, what they ask, what they would gain, for how long, why), each
 * approved or not with a note to the requester; under them the history of permission changes (decided
 * requests, roles an admin set, extras given, taken or run out) from the script's audit tab.
 */
export function Requests({ dir, reload, lost }: { dir: TeamDir; reload: () => Promise<void> | void; lost: (x: unknown) => void }) {
  const { engine: e } = useApp();
  const me = e.session?.u || '';
  const list = Object.entries(dir.reqs).sort((a, b) => (a[1].at < b[1].at ? -1 : 1));
  const nameOf = (id: string) => roleOf(dir.roles, id).n;
  const hist = dir.audit.map((a) => histLine(a, nameOf, (u) => userName(dir, u))).filter((x): x is NonNullable<typeof x> => !!x);
  if (!dir.v4)
    return <p className="rl-old">คำขอสิทธิ์ใช้ได้หลังผู้ดูแลระบบอัปเดตสคริปต์ของทีม (Code.gs) แล้ว Deploy เวอร์ชันใหม่ จากนั้นพนักงานส่งคำขอได้จากเมนูบัญชี และคำขอจะขึ้นที่นี่</p>;
  return (
    <>
      {list.length ? (
        <div className="rl-req-head">
          <h3>รออนุมัติ {list.length} คำขอ</h3>
          <span>อนุมัติได้เฉพาะผู้ดูแลระบบ · อนุมัติคำขอของตัวเองไม่ได้ · มีผลกับผู้ขอภายใน 1 นาที</span>
        </div>
      ) : (
        <div className="rl-req-head">
          <h3>ไม่มีคำขอที่รออนุมัติ</h3>
          <span>เมื่อมีคนส่งคำขอ จะขึ้นที่นี่และมีตัวเลขที่เมนู ผู้ใช้และสิทธิ์</span>
        </div>
      )}
      {list.length > 0 && (
        <div className="rl-reqs">
          {list.map(([u, q]) => {
            const acc = dir.users.find((x) => x.u === u);
            // keyed by the account: a request replaced meanwhile shows in the same card, with the note why
            return <ReqCard key={u} u={u} acc={acc} q={q} dir={dir} self={u === me} reload={reload} lost={lost} />;
          })}
        </div>
      )}
      <section className="us-card rl-hist" aria-labelledby="rl-hist-h">
        <div className="rl-hist-h">
          <h3 id="rl-hist-h">ประวัติการเปลี่ยนสิทธิ์</h3>
          <span>คำขอที่ตัดสินแล้ว และการเปลี่ยนบทบาทโดยผู้ดูแลระบบ · เก็บไว้ 12 เดือน</span>
        </div>
        {hist.length ? (
          <table className="rl-ht">
            <thead>
              <tr>
                <th scope="col">วันที่</th>
                <th scope="col">ผู้ขอ</th>
                <th scope="col">คำขอ</th>
                <th scope="col">ผล</th>
                <th scope="col">ตัดสินโดย</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((h, i) => (
                <tr key={i}>
                  <td className="d">{h.at}</td>
                  <td>{h.who}</td>
                  <td>
                    {h.what}
                    {h.sub && <small>{h.sub}</small>}
                  </td>
                  <td><span className={'st' + (h.kind ? ' ' + h.kind : '')}>{h.result}</span></td>
                  <td>{h.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="us-state">ยังไม่มีประวัติ</p>
        )}
      </section>
    </>
  );
}

function ReqCard({ u, acc, q, dir, self, reload, lost }: { u: string; acc?: TeamUser; q: ReqPending; dir: TeamDir; self: boolean; reload: () => Promise<void> | void; lost: (x: unknown) => void }) {
  const { engine: e } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'ok' | 'no'>('');
  const [err, setErr] = useState('');
  const name = acc?.name || u;
  const baseId = acc ? effRole(dir, acc, todayISO()) : '';
  const base = roleOf(dir.roles, baseId || 'viewer');
  const decide = async (ok: boolean) => {
    setBusy(ok ? 'ok' : 'no');
    setErr('');
    try {
      // the id of the request on screen: one the requester replaced since is refused, not decided unseen
      await e.reqDecide(u, ok, note, q.id);
      await reload();
    } catch (x) {
      lost(x);
      setErr(authError(x).msg);
      setBusy('');
      // the request was replaced (or withdrawn): show what is there now
      if (authError(x).code === 'req_changed' || authError(x).code === 'no_request') await Promise.resolve(reload()).catch(() => {});
    }
  };
  const want = q.k === 'role' && q.role ? roleOf(dir.roles, q.role) : null;
  const g = want ? gained(base.c, want.c) : [];
  return (
    <article className="us-card rl-req" aria-label={`คำขอของ ${name}`}>
      <div className="rl-req-h">
        <span className="us-who">
          <span className="us-ava" aria-hidden="true">{nameLetter(name)}</span>
          <span className="us-who-t">
            <span className="us-name">{name}</span>
            <span className="us-u">@{u}</span>
          </span>
        </span>
        <span className="rl-req-when">ส่งเมื่อ {dtTh(q.at)}</span>
      </div>
      {want ? (
        <p className="rl-ask">
          ขอเปลี่ยนบทบาท จาก <RoleChip name={base.n} admin={base.id === 'admin'} /> เป็น <RoleChip name={want.n} />
        </p>
      ) : (
        <p className="rl-ask">
          ขอสิทธิ์เพิ่ม {(q.caps || []).length} รายการ บทบาทยังเป็น <RoleChip name={base.n} admin={base.id === 'admin'} />
        </p>
      )}
      <dl className="rl-dl">
        {want ? (
          <>
            <dt>ทำได้เพิ่ม</dt>
            <dd>
              {g.length ? (
                <ul className="rl-diff">
                  {g.map((x) => <li key={x}>{x}</li>)}
                </ul>
              ) : (
                'ไม่มีสิทธิ์ใหม่'
              )}
            </dd>
          </>
        ) : (
          <>
            <dt>สิทธิ์ที่ขอ</dt>
            <dd>
              <ul className="rl-diff">
                {(q.caps || []).map((c) => (
                  <li key={c.k}>
                    {CAP[c.k].label}
                    {CAP[c.k].scope && <small>{scopeWord(c.k, c.s)}</small>}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>ระยะเวลา</dt>
        <dd>{spanWords(q, base.n)}</dd>
        <dt>เหตุผล</dt>
        <dd><div className="rl-quote">{q.note || '—'}</div></dd>
      </dl>
      {err && <Notice kind="error" role="alert">{err}</Notice>}
      <div className="rl-dec">
        {self ? (
          <span className="rl-sub">คำขอของคุณเอง ให้ผู้ดูแลระบบคนอื่นอนุมัติ</span>
        ) : (
          <>
            <input className="fld" value={note} maxLength={300} onChange={(ev) => setNote(ev.target.value)} placeholder={`หมายเหตุถึง${name} (ไม่บังคับ)`} aria-label={`หมายเหตุถึง${name} (ไม่บังคับ)`} />
            <div className="rl-dec-r">
              <button type="button" className="btn" disabled={!!busy} onClick={() => decide(false)}>
                {busy === 'no' && <span className="auth-spin dark" aria-hidden="true" />}
                ไม่อนุมัติ
              </button>
              <button type="button" className="btn pri" disabled={!!busy} onClick={() => decide(true)}>
                {busy === 'ok' && <span className="auth-spin" aria-hidden="true" />}
                อนุมัติ
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

/** "ดูค่าคอมมิชชั่น / … และอีก 2 รายการ" (for tests of the card's words). */
export const gainWords = (g: string[]) => listWords(g);
