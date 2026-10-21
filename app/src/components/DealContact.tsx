import { useId, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useApp } from '../state';
import { norm } from '../lib/core';
import { telHref } from '../lib/format';
import { ROLE_TH, contactChoices, nameKey, splitList, typedExtras, typedMatches } from '../lib/people';
import type { GccEngine } from '../lib/engine';
import type { Deal } from '../lib/sales';
import type { Person } from '../lib/types';
import { PersonAvatar, useOpenPerson } from '../tabs/People';
import { labelCol } from './ui';

/**
 * A deal's contact (ผู้ติดต่อ) in its contact card. The contact is a person in ผู้ติดต่อ linked to the deal
 * (lib/people.ts PLink), never a copy: their name, position, phone and e-mail come from their record, and
 * "แก้เบอร์ / อีเมล" edits that record. A deal without one is offered the people of its company (one: "ใช้คนนี้";
 * several: a short list; none: "เพิ่มผู้ติดต่อ", which records the person for the whole team). What an older deal
 * had typed stays as it was typed, offered as the person it names ("เชื่อมกับ …") or as a new one
 * ("บันทึกเป็นผู้ติดต่อ").
 */

/** An account that may edit the deal but not the contacts (a custom role) types the contact in the deal as before:
 *  only while no person is linked (a linked one is shown, read-only). */
export const typedFieldsOnly = (e: GccEngine, d: Deal, ro: boolean) => !ro && !e.can('edit.cust') && !e.dealPeople(d.id).length;

/** The card's folded line: the contact's name; "ยังไม่ได้เลือกผู้ติดต่อ" when the company has people to choose from. */
export function contactSummary(e: GccEngine, d: Deal) {
  const ct = e.dealContact(d);
  if (ct.name) return ct.name;
  return contactChoices(e.dealPool(d)).length ? 'ยังไม่ได้เลือกผู้ติดต่อ' : '';
}

/** Phone numbers and e-mails as plain text links. */
function Reach({ phone, email }: { phone: string; email: string }) {
  const ph = splitList(phone), em = splitList(email);
  if (!ph.length && !em.length) return null;
  return (
    <span className="dc-c">
      {ph.map((x) => (telHref(x) ? <a key={'t' + x} href={telHref(x)} className="pe-link dc-tel">{x}</a> : <span key={'t' + x}>{x}</span>))}
      {em.map((x) => <a key={'m' + x} href={'mailto:' + x} className="pe-link">{x}</a>)}
    </span>
  );
}
const roleLine = (p: Person) => [p.pos, p.role ? ROLE_TH[p.role] : ''].filter(Boolean).join(' · ');

export function DealContact({ d, ro }: { d: Deal; ro: boolean }) {
  const { engine: e, set } = useApp();
  const openPerson = useOpenPerson();
  const hid = useId();
  const [pick, setPick] = useState<'' | 'set' | 'add'>('');
  const [editing, setEditing] = useState('');
  if (typedFieldsOnly(e, d, ro)) return null;
  const people = e.dealPeople(d.id);
  // linking needs both: this deal's ดีลและขั้นตอน (ro) and ลูกค้าและผู้ติดต่อ
  const can = !ro && e.can('edit.cust');
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const pool = e.dealPool(d);
  const typed = d.contactName.trim();
  // a new person from this deal: at its company (or named after the client), then the deal's contact
  const addNew = (main = false) => set({ addPerson: c ? { gid: c.id, deal: d.id, main } : { company: d.client, deal: d.id, main } });
  const head = <span className="dc-h" id={hid}>ผู้ติดต่อ</span>;
  const wrap = (body: ReactNode) => (
    <div className="dc-who" role="group" aria-labelledby={hid}>
      {head}
      {body}
    </div>
  );

  if (pick && can)
    return wrap(
      <Picker
        d={d}
        mode={pick}
        pool={pool}
        skip={people.map((p) => p.id)}
        hasMain={people.length > 0}
        onPick={(pid) => {
          e.linkPerson(d.id, pid, { main: pick === 'set' });
          setPick('');
        }}
        onNew={() => {
          addNew(pick === 'set');
          setPick('');
        }}
        onNone={() => {
          if (people[0]) e.unlinkPerson(d.id, people[0].id);
          setPick('');
        }}
        onCancel={() => setPick('')}
      />,
    );

  // ---- linked: the people, from their own record
  if (people.length) {
    const main = people[0];
    // what was typed in the deal and is not on their record (nor the company's): kept, said once
    const theirs = !typed || nameKey(typed) === nameKey(main.name);
    const ex = typedExtras(d, theirs ? main : null, c);
    const extra = [...(theirs ? [] : [typed]), ...ex.phones, ...ex.emails];
    return wrap(
      <>
        <div className="dc-box">
          {people.map((p, i) => (
            <div key={p.id} className="dc-pw">
              <div className="dc-p">
                <PersonAvatar p={p} size={40} />
                <span className="dc-t">
                  <span className="dc-n">
                    {p.name}
                    {p.status === 'left' && <span className="chip warn">ย้ายงานแล้ว</span>}
                    {people.length > 1 && i === 0 && <span className="t-meta">ผู้ติดต่อหลัก</span>}
                  </span>
                  {roleLine(p) && <span className="dc-s">{roleLine(p)}</span>}
                  <Reach phone={p.phone} email={p.email} />
                  {!p.phone && !p.email && <span className="dc-s">ยังไม่มีเบอร์และอีเมล</span>}
                </span>
                <button type="button" className="btn xs dc-open" onClick={() => openPerson(p.id)}>เปิดหน้าผู้ติดต่อ</button>
              </div>
              {editing === p.id ? (
                <QuickEdit p={p} onDone={() => setEditing('')} />
              ) : (
                can && (
                  <div className="dc-a dc-in">
                    <button type="button" className="lnk" onClick={() => setEditing(p.id)}>แก้เบอร์ / อีเมล</button>
                    {i === 0 ? (
                      <>
                        <button type="button" className="lnk" onClick={() => setPick('set')}>เปลี่ยนผู้ติดต่อ</button>
                        <button type="button" className="lnk" onClick={() => setPick('add')}>เพิ่มอีกคน</button>
                      </>
                    ) : (
                      <button type="button" className="lnk" onClick={() => e.unlinkPerson(d.id, p.id)}>เอาออกจากดีลนี้</button>
                    )}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
        {extra.length > 0 && (
          <span className="dc-note">
            {theirs ? 'พิมพ์ไว้ในดีลนี้' : 'ผู้ติดต่อที่พิมพ์ไว้ในดีลนี้เดิม'}: {extra.join(' · ')}
            {can && theirs && (ex.phones.length > 0 || ex.emails.length > 0) && (
              <>
                {' '}
                <button type="button" className="lnk" onClick={() => e.addTypedToPerson(d.id, main.id)}>เพิ่มให้ {main.name}</button>
              </>
            )}
          </span>
        )}
        {can && !editing && <span className="t-meta">ข้อมูลชุดเดียวกับหน้าผู้ติดต่อ แก้ที่นี่หรือที่หน้าผู้ติดต่อ ก็เห็นตรงกันทุกดีล</span>}
      </>,
    );
  }

  // ---- an older deal's typed contact: kept as typed, offered as the person it names or a new one
  if (typed) {
    const ex = typedExtras(d, null, c);
    const m = typedMatches(d, pool);
    const one = m.length === 1 ? m[0] : undefined;
    return wrap(
      <div className="dc-box ask">
        <div className="dc-typed">
          <span className="dc-n">{typed}</span>
          <Reach phone={ex.phones.join(' | ')} email={ex.emails.join(' | ')} />
          <span className="dc-note">
            {one ? `พิมพ์ไว้ในดีลนี้ · ตรงกับ ${one.name} ในรายชื่อผู้ติดต่อ${one.pos ? ` (${one.pos})` : ''}` : m.length > 1 ? `พิมพ์ไว้ในดีลนี้ · ตรงกับ ${m.length} คนในรายชื่อผู้ติดต่อ เลือกคนที่ใช่` : 'พิมพ์ไว้ในดีลนี้ · ยังไม่อยู่ในรายชื่อผู้ติดต่อ'}
          </span>
        </div>
        {can && m.length > 1 && (
          <div className="dc-list">
            {m.map((p) => <Opt key={p.id} p={p} onPick={() => e.linkPerson(d.id, p.id)} />)}
          </div>
        )}
        {can && (
          <div className="dc-a">
            {one ? (
              <button type="button" className="btn xs pri" onClick={() => e.linkPerson(d.id, one.id)}>เชื่อมกับ {one.name}</button>
            ) : (
              !m.length && <button type="button" className="btn xs pri" onClick={() => e.saveTypedContact(d.id)}>บันทึกเป็นผู้ติดต่อ</button>
            )}
            <button type="button" className="lnk" onClick={() => setPick('set')}>เลือกคนอื่น</button>
          </div>
        )}
      </div>,
    );
  }

  // ---- no contact yet: the company's people, one tap
  const ex = typedExtras(d, null, c);
  const typedLine = ex.phones.length + ex.emails.length > 0 && <span className="dc-note">พิมพ์ไว้ในดีลนี้: {[...ex.phones, ...ex.emails].join(' · ')}</span>;
  const list = contactChoices(pool);
  if (!can)
    return wrap(
      <>
        <span className="t-sec">{list.length ? 'ยังไม่ได้เลือกผู้ติดต่อของดีลนี้' : 'ยังไม่มีผู้ติดต่อ'}</span>
        {typedLine}
      </>,
    );
  if (list.length === 1) {
    const p = list[0];
    return wrap(
      <div className="dc-box ask">
        <span className="dc-note">ยังไม่ได้เลือกผู้ติดต่อของดีลนี้ · บริษัทนี้มี 1 คนในรายชื่อผู้ติดต่อ</span>
        <div className="dc-p">
          <PersonAvatar p={p} size={40} />
          <span className="dc-t">
            <span className="dc-n">{p.name}</span>
            {roleLine(p) && <span className="dc-s">{roleLine(p)}</span>}
            <Reach phone={p.phone} email={p.email} />
          </span>
          <button type="button" className="btn xs pri dc-open" onClick={() => e.linkPerson(d.id, p.id)}>ใช้คนนี้</button>
        </div>
        <div className="dc-a dc-in">
          <button type="button" className="lnk" onClick={() => addNew()}>เพิ่มผู้ติดต่อคนอื่น</button>
        </div>
        {typedLine}
      </div>,
    );
  }
  if (list.length > 1)
    return wrap(
      <div className="dc-box ask">
        <span className="dc-note">ยังไม่ได้เลือกผู้ติดต่อของดีลนี้ · เลือกจากรายชื่อของบริษัทนี้ ({list.length} คน)</span>
        <ShortList list={list} onPick={(pid) => e.linkPerson(d.id, pid)} />
        <div className="dc-a">
          <button type="button" className="lnk" onClick={() => addNew()}>เพิ่มผู้ติดต่อใหม่</button>
        </div>
        {typedLine}
      </div>,
    );
  return wrap(
    <div className="dc-box ask">
      <span className="dc-note">{c ? 'ยังไม่มีผู้ติดต่อของบริษัทนี้ในรายชื่อ' : 'ยังไม่มีผู้ติดต่อ'} · เพิ่มครั้งเดียว ใช้ได้ทั้งในดีลนี้และหน้าผู้ติดต่อ</span>
      <div className="dc-a">
        <button type="button" className="btn xs pri" onClick={() => addNew()}>เพิ่มผู้ติดต่อ</button>
        {Object.keys(e.people).length > 0 && <button type="button" className="lnk" onClick={() => setPick('set')}>ค้นจากรายชื่อผู้ติดต่อทั้งหมด</button>}
      </div>
      {typedLine}
    </div>,
  );
}

/** One person to choose: name, position · role (or their company, from outside this one), "เลือก". */
function Opt({ p, sub, onPick }: { p: Person; sub?: string; onPick: () => void }) {
  return (
    <button type="button" className="dc-opt hv" onClick={onPick} aria-label={'เลือก ' + p.name}>
      <PersonAvatar p={p} size={32} />
      <span className="dc-t">
        <span>{p.name}{p.status === 'left' ? ' (ย้ายงานแล้ว)' : ''}</span>
        <span className="dc-s">{sub ?? (roleLine(p) || 'ยังไม่ระบุตำแหน่ง')}</span>
      </span>
      <span className="btn xs" aria-hidden="true">เลือก</span>
    </button>
  );
}
/** The first five, then "ดูทั้งหมด n คน". */
function ShortList({ list, onPick, sub }: { list: Person[]; onPick: (pid: string) => void; sub?: (p: Person) => string | undefined }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 5);
  return (
    <div className="dc-list">
      {shown.map((p) => <Opt key={p.id} p={p} sub={sub?.(p)} onPick={() => onPick(p.id)} />)}
      {list.length > 5 && (
        <button type="button" className="lnk dc-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'แสดงน้อยลง' : `ดูทั้งหมด ${list.length} คน`}</button>
      )}
    </div>
  );
}

/** Choose a person: the company's people still there first; typing searches everyone in ผู้ติดต่อ. `set`: the deal's
 *  (main) contact; `add`: one more. */
function Picker({ d, mode, pool, skip, hasMain, onPick, onNew, onNone, onCancel }: {
  d: Deal; mode: 'set' | 'add'; pool: Person[]; skip: string[]; hasMain: boolean;
  onPick: (pid: string) => void; onNew: () => void; onNone: () => void; onCancel: () => void;
}) {
  const { engine: e } = useApp();
  const [q, setQ] = useState('');
  const k = norm(q);
  const inPool = useMemo(() => new Set(pool.map((p) => p.id)), [pool]);
  const found = useMemo(() => {
    if (k.length < 2) return contactChoices(pool, skip);
    return Object.values(e.people)
      .filter((p) => !skip.includes(p.id) && norm([p.name, p.nick, p.pos, p.company, e.personCompany(p)?.name || ''].join(' ')).includes(k))
      .sort((a, b) => +inPool.has(b.id) - +inPool.has(a.id) || a.name.localeCompare(b.name, 'th'))
      .slice(0, 8);
  }, [k, pool, skip, e, inPool]);
  const keys = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    onCancel();
  };
  return (
    <div className="dc-box ask" onKeyDown={keys}>
      <span className="dc-note">{mode === 'add' ? 'เพิ่มผู้ติดต่ออีกคนในดีลนี้' : hasMain ? 'เลือกผู้ติดต่อคนใหม่ของดีลนี้' : 'เลือกผู้ติดต่อของดีลนี้'}</span>
      <input value={q} onChange={(ev) => setQ(ev.target.value)} autoFocus className="fld" placeholder="พิมพ์ชื่อเพื่อค้นในรายชื่อผู้ติดต่อทั้งหมด" aria-label="ค้นผู้ติดต่อ" />
      {found.length ? (
        <ShortList list={found} onPick={onPick} sub={(p) => (inPool.has(p.id) ? undefined : [e.personCompany(p)?.name || p.company || 'ไม่ระบุบริษัท', p.pos].filter(Boolean).join(' · '))} />
      ) : (
        <span className="dc-note">{k.length < 2 ? (d.gid != null ? 'บริษัทนี้ยังไม่มีคนอื่นในรายชื่อผู้ติดต่อ' : 'พิมพ์ชื่อเพื่อค้น') : `ไม่พบ “${q.trim()}” ในรายชื่อผู้ติดต่อ`}</span>
      )}
      <div className="dc-a">
        <button type="button" className="lnk" onClick={onNew}>เพิ่มผู้ติดต่อใหม่</button>
        {mode === 'set' && hasMain && <button type="button" className="quiet" onClick={onNone}>ไม่ระบุผู้ติดต่อ</button>}
        <button type="button" className="quiet" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

/** "แก้เบอร์ / อีเมล": the person's own record (only what changed here goes: updatePerson). */
function QuickEdit({ p, onDone }: { p: Person; onDone: () => void }) {
  const { engine: e } = useApp();
  const [init] = useState({ phone: p.phone, email: p.email });
  const [f, setF] = useState(init);
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    e.updatePerson(p.id, { phone: f.phone.trim(), email: f.email.trim() }, init);
    onDone();
  };
  const keys = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    onDone();
  };
  return (
    <form className="dc-edit" onSubmit={save} onKeyDown={keys}>
      <label style={labelCol}>โทรศัพท์ (หลายเบอร์คั่นด้วย |)<input value={f.phone} onChange={(ev) => setF({ ...f, phone: ev.target.value })} type="tel" maxLength={200} autoFocus className="fld" /></label>
      <label style={labelCol}>อีเมล<input value={f.email} onChange={(ev) => setF({ ...f, email: ev.target.value })} type="text" inputMode="email" autoComplete="off" maxLength={200} className="fld" /></label>
      <span className="t-meta dc-wide">บันทึกที่ข้อมูลของ {p.name} หน้าผู้ติดต่อและทุกดีลของคนนี้เห็นตรงกัน</span>
      <span className="dc-a dc-wide dc-end">
        <button type="button" className="quiet" onClick={onDone}>ยกเลิก</button>
        <button type="submit" className="btn xs pri">บันทึก</button>
      </span>
    </form>
  );
}
