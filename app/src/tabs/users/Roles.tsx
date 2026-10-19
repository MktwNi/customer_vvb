import { useEffect, useId, useState, type FormEvent } from 'react';
import { useApp } from '../../state';
import type { TeamDir } from '../../lib/engine';
import {
  CAP, CAPS, GROUPS, LOCKED_CAP, MAX_ROLES, REAL_TIP, REAL_WORD, ROLE_NAME_MAX, capShort, closeNeeds, roleLine, sameCaps, scopeWord,
  type CapDef, type CapId, type CapSet, type RoleDef, type Scope,
} from '../../lib/caps';
import { Modal } from '../../components/Dialog';
import { Select } from '../../components/Select';
import { Check, Radio, Tick } from '../../components/Pop';
import { Notice } from '../../components/ui';
import { authError } from '../../components/Login';
import { membersOf, peopleLine } from './shared';

/**
 * บทบาทและสิทธิ์: the roles on the left (built-in, then made here; "เทียบทุกบทบาท" on top), the chosen
 * role's capabilities on the right in three groups (ดูได้ / แก้ไขได้ / เข้าถึงและจัดการ). Changes are
 * marked until saved from the sticky bar; leaving with changes asks first. The admin role is locked to
 * everything; a script without configurable roles shows the built-in roles read-only.
 */
export function Roles({ dir, reload, lost }: { dir: TeamDir; reload: () => Promise<void> | void; lost: (x: unknown) => void }) {
  const { engine: e } = useApp();
  const [sel, setSel] = useState<string>('cmp');
  const [draft, setDraft] = useState<CapSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dlg, setDlg] = useState<null | { kind: 'new' | 'copy' | 'rename' | 'del'; r?: RoleDef }>(null);
  const roles = dir.roles;
  const r = roles.find((x) => x.id === sel) || null;
  // the role went away (deleted elsewhere): back to the comparison
  useEffect(() => {
    if (sel !== 'cmp' && !roles.some((x) => x.id === sel)) setSel('cmp');
  }, [roles, sel]);
  const cur = r ? draft || r.c : {};
  const dirty = !!r && !!draft && !sameCaps(draft, r.c);
  const pick = (id: string) => {
    if (id === sel) return;
    if (dirty && !window.confirm('ยังไม่ได้บันทึกสิทธิ์ที่แก้ไว้ ออกจากบทบาทนี้โดยไม่บันทึก?')) return;
    setSel(id);
    setDraft(null);
    setErr('');
  };
  const save = async () => {
    if (!r || !draft) return;
    setBusy(true);
    setErr('');
    try {
      await e.roleSave({ id: r.id, n: r.n, d: r.d, c: closeNeeds(draft) });
      await reload();
      setDraft(null);
    } catch (x) {
      lost(x);
      setErr(authError(x).msg);
    } finally {
      setBusy(false);
    }
  };
  const builtins = roles.filter((x) => x.builtin);
  const custom = roles.filter((x) => !x.builtin);
  const left = MAX_ROLES - roles.length;
  const item = (x: RoleDef) => {
    const n = membersOf(dir, x.id).length;
    return (
      <button key={x.id} type="button" className="rl-ri" data-role={x.id} aria-current={sel === x.id} onClick={() => pick(x.id)}>
        <b>{x.n}</b>
        <span>{n} คน{x.id === 'admin' ? ' · ล็อกไว้ ทำได้ทุกอย่าง' : ''}</span>
      </button>
    );
  };
  return (
    <>
      {!dir.v4 && (
        <p className="rl-old">
          ตอนนี้แสดงบทบาทตั้งต้นตามที่ใช้อยู่ · สร้างหรือแก้บทบาทได้หลังผู้ดูแลระบบอัปเดตสคริปต์ของทีม (Code.gs) แล้ว Deploy เวอร์ชันใหม่ (ดูคู่มือ หัวข้อบทบาทและสิทธิ์)
        </p>
      )}
      <div className="rl-roles">
        <nav className="us-card rl-list" aria-label="บทบาท">
          <button type="button" className="rl-ri rl-ri-cmp" aria-current={sel === 'cmp'} onClick={() => pick('cmp')}>
            <b>เทียบทุกบทบาท</b>
            <span>ดูสิทธิ์ทุกบทบาทในตารางเดียว</span>
          </button>
          <span className="rl-list-h">บทบาทตั้งต้น</span>
          {builtins.map(item)}
          {custom.length > 0 && <span className="rl-list-h">สร้างเอง</span>}
          {custom.map(item)}
          {dir.v4 && (
            <div className="rl-list-f">
              <button type="button" className="btn sm" disabled={left <= 0} onClick={() => setDlg({ kind: 'new' })}>สร้างบทบาท</button>
              <span className="rl-sub">{left > 0 ? `สร้างได้อีก ${left} บทบาท (สูงสุด ${MAX_ROLES})` : `มีครบ ${MAX_ROLES} บทบาทแล้ว`}</span>
            </div>
          )}
        </nav>
        {sel === 'cmp' || !r ? (
          <Matrix dir={dir} />
        ) : (
          <section className="us-card rl-ed" style={{ padding: 0 }} aria-labelledby="rl-ed-h">
            <div className="rl-ed-h">
              <div>
                <h3 id="rl-ed-h">{r.n}</h3>
                <p>{r.builtin ? 'บทบาทตั้งต้น' : 'บทบาทที่สร้างเอง'}{r.id === 'admin' ? ' · ล็อกไว้ ทำได้ทุกอย่างเสมอ' : ''} · {peopleLine(dir, r.id)}</p>
              </div>
              {dir.v4 && (
                <div className="rl-ed-acts">
                  {r.id !== 'admin' && <button type="button" className="lnk" onClick={() => setDlg({ kind: 'rename', r })}>เปลี่ยนชื่อ</button>}
                  <button type="button" className="lnk" disabled={left <= 0} title={left <= 0 ? `มีครบ ${MAX_ROLES} บทบาทแล้ว` : undefined} onClick={() => setDlg({ kind: 'copy', r })}>ทำสำเนา</button>
                  {!r.builtin && <button type="button" className="quiet" onClick={() => setDlg({ kind: 'del', r })}>ลบบทบาท</button>}
                </div>
              )}
            </div>
            {err && <div className="rl-ed-note"><Notice kind="error" role="alert">{err}</Notice></div>}
            <Editor r={r} cur={cur} locked={r.id === 'admin' || !dir.v4} onChange={setDraft} />
            {dirty && (
              <div className="rl-save">
                <span className="rl-save-t" role="status">
                  <SaveWords from={r.c} to={draft!} /> · มีผลกับ{membersOf(dir, r.id).length ? ' ' + membersOf(dir, r.id).map((u) => u.name).join(', ') : 'ผู้ใช้บทบาทนี้'} ภายใน 1 นาทีหลังบันทึก
                </span>
                <button type="button" className="quiet" disabled={busy} onClick={() => setDraft(null)}>ยกเลิก</button>
                <button type="button" className="btn pri" disabled={busy} onClick={save}>
                  {busy && <span className="auth-spin" aria-hidden="true" />}
                  บันทึก
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      {dlg && (dlg.kind === 'new' || dlg.kind === 'copy') && (
        <RoleDialog
          roles={roles}
          from={dlg.r}
          onClose={() => setDlg(null)}
          onDone={async (id) => {
            await reload();
            setDlg(null);
            if (id) {
              setSel(id);
              setDraft(null);
            }
          }}
          lost={lost}
        />
      )}
      {dlg?.kind === 'rename' && dlg.r && <RenameRole r={dlg.r} roles={roles} onClose={() => setDlg(null)} onDone={async () => { await reload(); setDlg(null); }} lost={lost} />}
      {dlg?.kind === 'del' && dlg.r && <DeleteRole r={dlg.r} dir={dir} onClose={() => setDlg(null)} onDone={async () => { await reload(); setDlg(null); setSel('cmp'); setDraft(null); }} lost={lost} />}
    </>
  );
}

/** "แก้แล้ว 2 รายการ: เปิด ค่าคอมมิชชั่น, แก้สัดส่วน % ของงาน" */
function SaveWords({ from, to }: { from: CapSet; to: CapSet }) {
  const on = CAPS.filter((c) => to[c.id] && !from[c.id]).map((c) => capShort(c.id));
  const off = CAPS.filter((c) => from[c.id] && !to[c.id]).map((c) => capShort(c.id));
  const sc = CAPS.filter((c) => from[c.id] && to[c.id] && from[c.id] !== to[c.id]).map((c) => `${capShort(c.id)} ${scopeWord(c.id, to[c.id]!)}`);
  const n = on.length + off.length + sc.length;
  return (
    <>
      แก้แล้ว {n} รายการ:{' '}
      {[on.length ? `เปิด ${on.join(', ')}` : '', off.length ? `ปิด ${off.join(', ')}` : '', sc.length ? sc.join(', ') : ''].filter(Boolean).map((t, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          <b>{t}</b>
        </span>
      ))}
    </>
  );
}

/** The capabilities of one role, ticked or not, in their three groups. */
function Editor({ r, cur, locked, onChange }: { r: RoleDef; cur: CapSet; locked: boolean; onChange: (c: CapSet) => void }) {
  const toggle = (k: CapId) => {
    const n: CapSet = { ...cur };
    if (n[k]) {
      delete n[k];
      onChange(closeNeeds(n)); // what needed it goes too
    } else onChange({ ...n, [k]: 'all' });
  };
  const scope = (k: CapId, s: Scope) => onChange({ ...cur, [k]: s });
  return (
    <>
      {GROUPS.map((g) => (
        <section key={g.id} className="rl-grp" aria-labelledby={'rl-g-' + g.id}>
          <div className="rl-grp-h">
            <h4 id={'rl-g-' + g.id}>{g.title}</h4>
            <span>{g.note}</span>
          </div>
          {CAPS.filter((c) => c.g === g.id).map((c) => (
            <CapRow key={c.id} c={c} cur={cur} saved={r.c} locked={locked || c.id === LOCKED_CAP} onToggle={() => toggle(c.id)} onScope={(s) => scope(c.id, s)} />
          ))}
          {g.id === 'v' && <p className="rl-foot">หน้าทะเบียนบริษัท (ภาพรวม ค้นหา ติดตาม แผนที่ หมายเหตุ) ทุกบทบาทเห็นเสมอ เพราะเป็นข้อมูลสาธารณะ</p>}
          {g.id === 'e' && <p className="rl-foot">งานของตัวเอง คือดีลที่ ผู้รับผิดชอบ เป็นชื่อของบัญชีนั้น</p>}
        </section>
      ))}
    </>
  );
}

function CapRow({ c, cur, saved, locked, onToggle, onScope }: { c: CapDef; cur: CapSet; saved: CapSet; locked: boolean; onToggle: () => void; onScope: (s: Scope) => void }) {
  const v = cur[c.id];
  const on = !!v;
  // a capability whose prerequisite is off can't be ticked (it says which)
  const blocked = !!c.needs && !cur[c.needs] && !on;
  const dis = locked || blocked;
  const changed = (saved[c.id] || '') !== (v || '');
  const id = useId();
  const desc = blocked ? `ต้องเปิด “${CAP[c.needs!].label}” ก่อน` : c.desc;
  return (
    <div className={'rl-cap' + (on ? ' on' : '') + (changed ? ' chg' : '') + (dis ? ' dis' : '')}>
      <label className={'fck rl-ck' + (on ? ' on' : '') + (dis ? ' dis' : '')}>
        <input type="checkbox" className="sr-only" checked={on} disabled={dis} onChange={onToggle} aria-labelledby={id} aria-describedby={id + 'd'} />
        <Check on={on} />
      </label>
      <span className="rl-cap-t">
        <b id={id}>{c.label}</b>
        <span id={id + 'd'}>{desc}</span>
      </span>
      <span className="rl-cap-r">
        {c.real && <span className="rl-real" title={REAL_TIP}>{REAL_WORD}</span>}
        {c.scope && on && (
          <div className="seg rl-scope" role="group" aria-label={`ขอบเขต ${c.label}`}>
            {(['all', 'own'] as Scope[]).map((s) => (
              <button key={s} type="button" aria-pressed={v === s} disabled={locked} onClick={() => onScope(s)}>{scopeWord(c.id, s)}</button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

/** เทียบทุกบทบาท: one read-only table, a row per capability, a column per role. */
function Matrix({ dir }: { dir: TeamDir }) {
  const roles = dir.roles;
  return (
    <section className="us-card rl-ed rl-mx" style={{ padding: 0 }} aria-labelledby="rl-mx-h">
      <div className="rl-ed-h">
        <div>
          <h3 id="rl-mx-h">เทียบทุกบทบาท</h3>
          <p>กดชื่อบทบาททางซ้ายเพื่อแก้ไข · ผู้ดูแลระบบทำได้ทุกอย่างเสมอ</p>
        </div>
      </div>
      {/* a wide table (many roles) scrolls inside the card: reachable by keyboard too */}
      <div className="rl-mx-w" tabIndex={0} role="region" aria-label="ตารางเทียบสิทธิ์ทุกบทบาท">
        <table className="rl-mx-tb">
          <thead>
            <tr>
              <th scope="col" className="rl-mx-cap"><span className="sr-only">สิทธิ์</span></th>
              {roles.map((r) => (
                <th key={r.id} scope="col">
                  <span className="rl-mx-r">{r.n}</span>
                  <span className="rl-mx-n">{membersOf(dir, r.id).length} คน</span>
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((g) => (
            <tbody key={g.id}>
              <tr className="rl-mx-g">
                <th scope="rowgroup" colSpan={roles.length + 1}>{g.title}</th>
              </tr>
              {CAPS.filter((c) => c.g === g.id).map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <span className="rl-mx-t">
                      {c.label}
                      {c.real && <span className="rl-real" title={REAL_TIP}>{REAL_WORD}</span>}
                    </span>
                  </th>
                  {roles.map((r) => {
                    const v = r.c[c.id];
                    return (
                      <td key={r.id}>
                        {v === 'all' ? (
                          <span className="rl-mx-y" role="img" aria-label="ได้"><Tick size={14} /></span>
                        ) : v === 'own' ? (
                          <span className="rl-mx-own">ของตัวเอง</span>
                        ) : (
                          <span className="rl-mx-no" aria-label="ไม่ได้">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

/** สร้างบทบาท (or ทำสำเนา of `from`): a name, an optional line, and whose capabilities to start from. */
function RoleDialog({ roles, from, onClose, onDone, lost }: { roles: RoleDef[]; from?: RoleDef; onClose: () => void; onDone: (id: string) => Promise<void> | void; lost: (x: unknown) => void }) {
  const { engine: e } = useApp();
  const ids = useId();
  const starts = roles.filter((r) => r.id !== 'admin');
  const [n, setN] = useState(from ? `สำเนา ${from.n}`.slice(0, ROLE_NAME_MAX) : '');
  const [d, setD] = useState('');
  const [src, setSrc] = useState<string>(from ? from.id : starts.find((r) => r.id === 'viewer')?.id || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const name = n.trim().replace(/\s+/g, ' ');
    if (!name) return setErr('ใส่ชื่อบทบาท');
    if (roles.some((r) => r.n === name)) return setErr('มีบทบาทชื่อนี้แล้ว');
    const base = roles.find((r) => r.id === src);
    setBusy(true);
    setErr('');
    try {
      const c: CapSet = base ? { ...base.c } : {};
      delete c[LOCKED_CAP];
      const r = await e.roleSave({ n: name, d, c, ...(base ? { from: base.id } : {}) });
      const id = r.id || r.roles?.find((x) => x.n === name)?.id || '';
      await onDone(id);
    } catch (x) {
      lost(x);
      setErr(authError(x).msg);
      setBusy(false);
    }
  };
  const opts: { id: string; n: string; line: string }[] = [...starts.map((r) => ({ id: r.id, n: r.n, line: roleLine(r) })), { id: '', n: 'เริ่มจากว่าง', line: 'ยังไม่มีสิทธิ์ใดเลย แล้วค่อยติ๊กเอง' }];
  return (
    <Modal title={from ? 'ทำสำเนาบทบาท' : 'สร้างบทบาท'} onClose={busy ? () => {} : onClose} width={560}>
      <form className="rl-form" onSubmit={submit} noValidate>
        <div className="auth-field">
          <label htmlFor={ids + 'n'}>ชื่อบทบาท</label>
          <input id={ids + 'n'} className="auth-input" value={n} maxLength={ROLE_NAME_MAX} onChange={(ev) => (setN(ev.target.value), setErr(''))} placeholder="เช่น ผู้บริหาร" autoFocus />
        </div>
        <div className="auth-field">
          <label htmlFor={ids + 'd'}>คำอธิบายสั้น (ไม่บังคับ)</label>
          <input id={ids + 'd'} className="auth-input" value={d} maxLength={120} onChange={(ev) => setD(ev.target.value)} />
          <span className="auth-hint">แสดงเมื่อเลือกบทบาทให้ผู้ใช้ ถ้าเว้นว่าง ระบบสรุปจากสิทธิ์ที่ติ๊กให้</span>
        </div>
        <div role="radiogroup" aria-labelledby={ids + 's'}>
          <p className="rl-lbl" id={ids + 's'}>เริ่มจากสิทธิ์ของ</p>
          <div className="rl-rcs">
            {opts.map((o) => (
              <label key={o.id || 'none'} className={'rl-rc' + (src === o.id ? ' on' : '')}>
                <span className={'fck' + (src === o.id ? ' on' : '')}>
                  <input type="radio" name="rl-src" className="sr-only" checked={src === o.id} onChange={() => setSrc(o.id)} />
                  <Radio />
                </span>
                <span className="rl-rc-t">
                  <b>{o.n}</b>
                  <span>{o.line}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        <div className="rl-dlg-f">
          <span className="rl-sub">สร้างแล้วจะเปิดบทบาทนี้ให้ติ๊กสิทธิ์ทีละรายการ</span>
          <button type="button" className="quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="btn pri" disabled={busy}>
            {busy && <span className="auth-spin" aria-hidden="true" />}
            {from ? 'ทำสำเนา' : 'สร้างบทบาท'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameRole({ r, roles, onClose, onDone, lost }: { r: RoleDef; roles: RoleDef[]; onClose: () => void; onDone: () => Promise<void> | void; lost: (x: unknown) => void }) {
  const { engine: e } = useApp();
  const ids = useId();
  const [n, setN] = useState(r.n);
  const [d, setD] = useState(r.d);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const name = n.trim().replace(/\s+/g, ' ');
    if (!name) return setErr('ใส่ชื่อบทบาท');
    if (roles.some((x) => x.id !== r.id && x.n === name)) return setErr('มีบทบาทชื่อนี้แล้ว');
    setBusy(true);
    setErr('');
    try {
      await e.roleSave({ id: r.id, n: name, d, c: r.c });
      await onDone();
    } catch (x) {
      lost(x);
      setErr(authError(x).msg);
      setBusy(false);
    }
  };
  return (
    <Modal title="เปลี่ยนชื่อบทบาท" onClose={busy ? () => {} : onClose} width={480}>
      <form className="rl-form" onSubmit={submit} noValidate>
        <div className="auth-field">
          <label htmlFor={ids + 'n'}>ชื่อบทบาท</label>
          <input id={ids + 'n'} className="auth-input" value={n} maxLength={ROLE_NAME_MAX} onChange={(ev) => (setN(ev.target.value), setErr(''))} autoFocus />
        </div>
        <div className="auth-field">
          <label htmlFor={ids + 'd'}>คำอธิบายสั้น (ไม่บังคับ)</label>
          <input id={ids + 'd'} className="auth-input" value={d} maxLength={120} onChange={(ev) => setD(ev.target.value)} />
          <span className="auth-hint">ถ้าเว้นว่าง ระบบสรุปจากสิทธิ์ที่ติ๊กให้</span>
        </div>
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        <div className="dlg-act">
          <button type="button" className="quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="btn pri" disabled={busy}>บันทึก</button>
        </div>
      </form>
    </Modal>
  );
}

/** ลบบทบาท: its accounts (and anyone holding it for a while) move to another role in the same save. */
function DeleteRole({ r, dir, onClose, onDone, lost }: { r: RoleDef; dir: TeamDir; onClose: () => void; onDone: () => Promise<void> | void; lost: (x: unknown) => void }) {
  const { engine: e } = useApp();
  const ids = useId();
  const others = dir.roles.filter((x) => x.id !== r.id && x.id !== 'admin');
  const [to, setTo] = useState(others.find((x) => x.id === 'sales')?.id || others[0]?.id || 'viewer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const m = membersOf(dir, r.id);
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      await e.roleDel(r.id, to);
      await onDone();
    } catch (x) {
      lost(x);
      setErr(authError(x).msg);
      setBusy(false);
    }
  };
  return (
    <Modal title="ลบบทบาท" onClose={busy ? () => {} : onClose} width={480} focus="dialog">
      <div className="rl-form">
        <p className="us-ask">ลบบทบาท {r.n}? {m.length ? `ผู้ใช้ ${m.length} คน (${m.map((u) => u.name).join(', ')}) จะย้ายไปบทบาทที่เลือก` : 'ยังไม่มีผู้ใช้บทบาทนี้'}</p>
        {m.length > 0 && (
          <div className="auth-field">
            <span className="rl-lbl" id={ids} style={{ margin: 0 }}>ย้ายผู้ใช้ไปที่</span>
            <Select label="ย้ายผู้ใช้ไปที่" labelledBy={ids} value={to} onChange={setTo} search={false} options={others.map((x) => ({ v: x.id, label: x.n }))} />
          </div>
        )}
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        <div className="dlg-act">
          <button type="button" className="quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className="us-btn primary danger" onClick={go} disabled={busy}>
            {busy && <span className="auth-spin" aria-hidden="true" />}
            ลบบทบาท
          </button>
        </div>
      </div>
    </Modal>
  );
}
