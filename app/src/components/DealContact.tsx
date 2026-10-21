import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useApp } from '../state';
import { norm } from '../lib/core';
import { telHref } from '../lib/format';
import { ROLE_TH, contactChoices, nameKey, personExtras, splitList, typedExtras, typedMatch } from '../lib/people';
import type { GccEngine } from '../lib/engine';
import type { Deal } from '../lib/sales';
import type { Person } from '../lib/types';
import { PersonAvatar, useOpenPerson } from '../tabs/People';
// one person, several companies: who someone from outside the deal's company is, in one line
import { coShort, whoLine } from '../tabs/PeopleCos';
import { foundWhy, type PersonAt } from '../lib/people';
import { labelCol } from './ui';

/**
 * A deal's contact (ผู้ติดต่อ) in its contact card. The contact is a person in ผู้ติดต่อ linked to the deal
 * (lib/people.ts PLink), never a copy: their name, position, phone and e-mail come from their record, and
 * "แก้เบอร์ / อีเมล" edits that record. A deal without one is offered the people of its company (one: "ใช้คนนี้";
 * several: a short list; none: "เพิ่มผู้ติดต่อ", which records the person for the whole team). What an older deal
 * had typed stays as it was typed, offered as the person it names ("เชื่อมกับ …") or as a new one
 * ("บันทึกเป็นผู้ติดต่อ"). A person deals with several companies (a consultant): the people of the deal's company are
 * those who deal with it, shown with their position there; one picked from outside it gets it added to theirs.
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
const roleLine = (p: Person) => [p.pos, p.role ? ROLE_TH[p.role] : '', (p as Partial<PersonAt>).ncos! > 1 ? `ผู้ติดต่อของ ${(p as PersonAt).ncos} บริษัท` : ''].filter(Boolean).join(' · ');

export function DealContact({ d, ro }: { d: Deal; ro: boolean }) {
  const { engine: e, set } = useApp();
  const openPerson = useOpenPerson();
  const hid = useId();
  const [pick, setPick] = useState<'' | 'set' | 'add'>('');
  const [editing, setEditing] = useState('');
  // the keyboard keeps its place: after a choice, the block's first control; after a form or the list closes,
  // the button that opened it (data-fk), as the rest of the panel does
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef('');
  const focusTo = (k = '') =>
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      // (no key: the main contact's "เปิดหน้าผู้ติดต่อ", else the block's first button)
      (el.querySelector<HTMLElement>(k ? `[data-fk="${CSS.escape(k)}"]` : '[data-fk^="open-"]') || el.querySelector<HTMLElement>('button, input'))?.focus();
    });
  const open = (mode: 'set' | 'add', from: string) => {
    opener.current = from;
    setPick(mode);
  };
  if (typedFieldsOnly(e, d, ro)) return null;
  const people = e.dealPeople(d.id);
  // linking needs both: this deal's ดีลและขั้นตอน (ro) and ลูกค้าและผู้ติดต่อ
  const can = !ro && e.can('edit.cust');
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const pool = e.dealPool(d);
  const typed = d.contactName.trim();
  // a new person from this deal: at its company (or named after the client), then the deal's contact
  const addNew = (main = false) => set({ addPerson: c ? { gid: c.id, deal: d.id, main } : { company: d.client, deal: d.id, main } });
  const link = (pid: string, main = false) => {
    e.linkPerson(d.id, pid, { main });
    focusTo();
  };
  // someone from outside the deal's company (a consultant who brings it): it becomes one more company of theirs
  const inPool = new Set(pool.map((p) => p.id));
  const linkFrom = (pid: string, main = false) => {
    if (c && !inPool.has(pid)) e.addCompanyToPerson(pid, c.id);
    link(pid, main);
  };
  const head = <span className="dc-h" id={hid}>ผู้ติดต่อ</span>;
  const wrap = (body: ReactNode) => (
    <div className="dc-who" role="group" aria-labelledby={hid} ref={box}>
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
        many={people.length > 1}
        onPick={(pid) => {
          setPick('');
          linkFrom(pid, pick === 'set');
        }}
        onNew={() => {
          addNew(pick === 'set');
          setPick('');
        }}
        onNone={() => {
          // every contact off, as the words say (the people stay in ผู้ติดต่อ)
          e.clearContacts(d.id);
          setPick('');
          focusTo();
        }}
        onCancel={() => {
          setPick('');
          focusTo(opener.current);
        }}
      />,
    );

  // ---- linked: the people, from their own record
  if (people.length) {
    const main = people[0];
    // whose the typed contact is: the linked person with its name (none typed: the main one); what the deal holds
    // for them that their record lacks is said under them, one tap to carry it over (personExtras)
    const owner = typed ? people.find((p) => nameKey(p.name) === nameKey(typed)) : main;
    // a typed name none of them has: an older contact of the deal, kept and said once
    const old = typed && !owner ? typedExtras(d, null, c) : null;
    const ids = new Set(people.map((p) => p.id));
    const oldOne = old ? typedMatch(d, pool.filter((p) => !ids.has(p.id)), c) : null;
    const oldMatch = oldOne && oldOne.by === 'name' && oldOne.list.length === 1 ? oldOne.list[0] : undefined;
    return wrap(
      <>
        <div className="dc-box">
          {people.map((p, i) => {
            const ex = p === owner ? personExtras(d, p, c) : null;
            const more = ex ? [...ex.phones, ...ex.emails] : [];
            // at another company than the deal's (it was linked to another company since, or they moved); one who
            // deals with it as another company of theirs is not (their position there is shown)
            const away = e.contactElsewhere(d, p);
            const v = e.personView(p, d.gid);
            return (
              <div key={p.id} className="dc-pw">
                <div className="dc-p">
                  <PersonAvatar p={p} size={40} />
                  <span className="dc-t">
                    <span className="dc-n">
                      {p.name}
                      {v.status === 'left' && <span className="chip warn">{away ? 'ย้ายงานแล้ว' : 'ไม่อยู่บริษัทนี้แล้ว'}</span>}
                      {people.length > 1 && i === 0 && <span className="t-meta">ผู้ติดต่อหลัก</span>}
                    </span>
                    {roleLine(v) && <span className="dc-s">{roleLine(v)}</span>}
                    {away && <span className="dc-s">อยู่ที่ {e.personCompany(p)?.name || p.company || 'บริษัทอื่น'} ไม่ใช่บริษัทของดีลนี้</span>}
                    <Reach phone={p.phone} email={p.email} />
                    {!p.phone && !p.email && <span className="dc-s">{more.length ? 'ยังไม่มีเบอร์และอีเมลในหน้าผู้ติดต่อ' : 'ยังไม่มีเบอร์และอีเมล'}</span>}
                    {more.length > 0 && <span className="dc-s">พิมพ์ไว้ใน<span className="dc-nw">ดีลนี้</span> {more.join(' · ')}</span>}
                  </span>
                  <button type="button" className="btn xs dc-open" data-fk={'open-' + p.id} onClick={() => openPerson(p.id)} aria-label={'เปิดหน้าผู้ติดต่อ ' + p.name}>เปิดหน้าผู้ติดต่อ</button>
                </div>
                {editing === p.id ? (
                  <QuickEdit
                    p={p}
                    onDone={() => {
                      setEditing('');
                      focusTo('edit-' + p.id);
                    }}
                  />
                ) : (
                  can && (
                    <div className="dc-a dc-in">
                      {/* an older link to someone this company is not theirs: add it to their companies */}
                      {away && c && d.gid != null && <button type="button" className="lnk" onClick={() => (e.addCompanyToPerson(p.id, c.id), focusTo())}>เพิ่ม {coShort(c.name)} ให้ {p.name}</button>}
                      {more.length > 0 && (
                        <button type="button" className="lnk" data-fk={'give-' + p.id} onClick={() => (e.addTypedToPerson(d.id, p.id), focusTo('edit-' + p.id))}>เพิ่มให้ {p.name}</button>
                      )}
                      <button type="button" className="lnk" data-fk={'edit-' + p.id} onClick={() => setEditing(p.id)} aria-label={'แก้เบอร์และอีเมลของ ' + p.name}>แก้เบอร์ / อีเมล</button>
                      {i === 0 ? (
                        <>
                          <button type="button" className="lnk" data-fk="set" onClick={() => open('set', 'set')}>เปลี่ยนผู้ติดต่อ</button>
                          <button type="button" className="lnk" data-fk="add" onClick={() => open('add', 'add')}>เพิ่มอีกคน</button>
                        </>
                      ) : (
                        <button type="button" className="lnk" onClick={() => (e.unlinkPerson(d.id, p.id), focusTo())} aria-label={`เอา ${p.name} ออกจากดีลนี้`}>เอาออกจากดีลนี้</button>
                      )}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
        {old && (
          <span className="dc-note">
            ผู้ติดต่อที่พิมพ์ไว้ใน<span className="dc-nw">ดีลนี้</span>เดิม: {[typed, ...old.phones, ...old.emails].join(' · ')}
            {can && (
              <>
                {' '}
                {oldMatch ? (
                  <button type="button" className="lnk" onClick={() => link(oldMatch.id)}>เพิ่ม {oldMatch.name} เป็นผู้ติดต่ออีกคน</button>
                ) : (
                  <button type="button" className="lnk" onClick={() => (e.saveTypedContact(d.id), focusTo())}>บันทึกเป็นผู้ติดต่ออีกคน</button>
                )}
              </>
            )}
          </span>
        )}
        {can && !editing && (
          <span className="t-meta">ข้อมูลชุดเดียวกับหน้าผู้ติดต่อ แก้ที่ไหนก็เห็นตรงกัน<span className="dc-nw">ทุกดีล</span></span>
        )}
      </>,
    );
  }

  // ---- an older deal's typed contact: kept as typed, offered as the person it names or a new one
  if (typed) {
    const ex = typedExtras(d, null, c);
    const m = typedMatch(d, pool, c);
    const one = m.list.length === 1 ? m.list[0] : undefined;
    // the same name: link it; only the phone or e-mail is the same (the names differ): someone else at that number
    // most likely, so it is recorded as a person first, the link offered as a second choice
    const byName = m.by === 'name';
    const reach = m.by === 'phone' ? 'เบอร์โทร' : 'อีเมล';
    // nobody of the company: someone recorded at another company it surely is (a consultant who brings it)
    const fe = !m.list.length ? e.findExisting({ name: typed, phone: ex.phones.join(' | '), email: ex.emails.join(' | ') }, d.gid, d.client).filter((x) => !x.here) : [];
    const elsewhere = fe.length === 1 ? fe[0] : undefined;
    const note = byName
      ? one
        ? `ตรงกับ ${one.name} ในรายชื่อผู้ติดต่อ${one.pos ? ` (${one.pos})` : ''}`
        : `ตรงกับ ${m.list.length} คนในรายชื่อผู้ติดต่อ เลือกคนที่ใช่`
      : elsewhere
        ? `คนนี้มีอยู่แล้ว: ${elsewhere.p.name}${whoLine(e, elsewhere.p) ? ` (${whoLine(e, elsewhere.p)})` : ''} · ${foundWhy(elsewhere.by)}`
        : ['ยังไม่อยู่ในรายชื่อผู้ติดต่อ', m.list.length ? `${reach}ตรงกับ ${one ? one.name : m.list.length + ' คน'}` : ''].filter(Boolean).join(' · ');
    return wrap(
      <div className="dc-box ask">
        <div className="dc-typed">
          <span className="dc-n">{typed}</span>
          <Reach phone={ex.phones.join(' | ')} email={ex.emails.join(' | ')} />
          <span className="dc-note">พิมพ์ไว้ใน<span className="dc-nw">ดีลนี้</span> · {note}</span>
        </div>
        {can && byName && m.list.length > 1 && (
          <div className="dc-list">
            {m.list.map((p) => <Opt key={p.id} p={p} onPick={() => link(p.id)} />)}
          </div>
        )}
        {can && (
          <div className="dc-a">
            {byName ? (
              one && <button type="button" className="btn xs pri" onClick={() => link(one.id)}>เชื่อมกับ {one.name}</button>
            ) : elsewhere ? (
              <>
                <button type="button" className="btn xs pri" onClick={() => (e.saveTypedContact(d.id, undefined, { pid: elsewhere.p.id }), focusTo())}>
                  {c ? `เพิ่มบริษัทนี้ให้ ${elsewhere.p.name}` : `ใช้ ${elsewhere.p.name}`}
                </button>
                <button type="button" className="lnk" onClick={() => (e.saveTypedContact(d.id), focusTo())}>สร้างคนใหม่</button>
              </>
            ) : (
              <>
                <button type="button" className="btn xs pri" onClick={() => (e.saveTypedContact(d.id), focusTo())}>บันทึกเป็นผู้ติดต่อ</button>
                {one && <button type="button" className="lnk" onClick={() => link(one.id)}>{`ใช้ ${one.name} แทน`}</button>}
              </>
            )}
            <button type="button" className="lnk" data-fk="other" onClick={() => open('set', 'other')}>เลือกคนอื่น</button>
          </div>
        )}
      </div>,
    );
  }

  // ---- no contact yet: the company's people, one tap
  const ex = typedExtras(d, null, c);
  const typedLine = ex.phones.length + ex.emails.length > 0 && <span className="dc-note">พิมพ์ไว้ใน<span className="dc-nw">ดีลนี้</span>: {[...ex.phones, ...ex.emails].join(' · ')}</span>;
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
        <span className="dc-note">ยังไม่ได้เลือกผู้ติดต่อของ<span className="dc-nw">ดีลนี้</span> · บริษัทนี้มี 1 คนในรายชื่อผู้ติดต่อ</span>
        <div className="dc-p">
          <PersonAvatar p={p} size={40} />
          <span className="dc-t">
            <span className="dc-n">{p.name}</span>
            {roleLine(p) && <span className="dc-s">{roleLine(p)}</span>}
            <Reach phone={p.phone} email={p.email} />
          </span>
          <button type="button" className="btn xs pri dc-open" onClick={() => link(p.id)} aria-label={'ใช้ ' + p.name + ' เป็นผู้ติดต่อของดีลนี้'}>ใช้คนนี้</button>
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
        <span className="dc-note">ยังไม่ได้เลือกผู้ติดต่อของ<span className="dc-nw">ดีลนี้</span> · เลือกจากรายชื่อของบริษัทนี้ ({list.length} คน)</span>
        <ShortList list={list} onPick={(pid) => link(pid)} />
        <div className="dc-a">
          <button type="button" className="lnk" onClick={() => addNew()}>เพิ่มผู้ติดต่อใหม่</button>
        </div>
        {typedLine}
      </div>,
    );
  return wrap(
    <div className="dc-box ask">
      <span className="dc-note">{c ? 'ยังไม่มีผู้ติดต่อของบริษัทนี้ในรายชื่อ' : 'ยังไม่มีผู้ติดต่อ'} · เพิ่มครั้งเดียว ใช้ได้ทั้งใน<span className="dc-nw">ดีลนี้</span>และหน้าผู้ติดต่อ</span>
      <div className="dc-a">
        <button type="button" className="btn xs pri" onClick={() => addNew()}>เพิ่มผู้ติดต่อ</button>
        {e.livePeople().length > 0 && <button type="button" className="lnk" data-fk="search" onClick={() => open('set', 'search')}>ค้นจากรายชื่อผู้ติดต่อทั้งหมด</button>}
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
function Picker({ d, mode, pool, skip, hasMain, many, onPick, onNew, onNone, onCancel }: {
  d: Deal; mode: 'set' | 'add'; pool: Person[]; skip: string[]; hasMain: boolean; many: boolean;
  onPick: (pid: string) => void; onNew: () => void; onNone: () => void; onCancel: () => void;
}) {
  const { engine: e } = useApp();
  const [q, setQ] = useState('');
  const k = norm(q);
  const inPool = useMemo(() => new Set(pool.map((p) => p.id)), [pool]);
  const found = useMemo(() => {
    if (k.length < 2) return contactChoices(pool, skip);
    // (in the company's: as seen there; from outside: their companies' names and positions searched too)
    const at = new Map(pool.map((p) => [p.id, p]));
    return e.livePeople()
      .filter((p) => !skip.includes(p.id) && norm([p.name, p.nick, p.pos, p.company, ...e.personCos(p).flatMap((x) => [x.c?.name || x.company, x.pos])].join(' ')).includes(k))
      .map((p) => at.get(p.id) || p)
      .sort((a, b) => +inPool.has(b.id) - +inPool.has(a.id) || a.name.localeCompare(b.name, 'th'))
      .slice(0, 8);
  }, [k, pool, skip, e, inPool]);
  const c = d.gid != null ? e.company(d.gid) : undefined;
  const outside = k.length >= 2 && found.some((p) => !inPool.has(p.id));
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
        <ShortList list={found} onPick={onPick} sub={(p) => (inPool.has(p.id) ? undefined : whoLine(e, p) || 'ไม่ระบุบริษัท')} />
      ) : (
        <span className="dc-note">{k.length < 2 ? (d.gid != null ? 'บริษัทนี้ยังไม่มีคนอื่นในรายชื่อผู้ติดต่อ' : 'พิมพ์ชื่อเพื่อค้น') : `ไม่พบ “${q.trim()}” ในรายชื่อผู้ติดต่อ`}</span>
      )}
      {outside && c && <span className="dc-note">คนจากบริษัทอื่น: เลือกแล้วจะเพิ่ม {c.name} ในบริษัทที่คนนี้ติดต่อด้วย และใช้เป็นผู้ติดต่อของดีลนี้</span>}
      <div className="dc-a">
        <button type="button" className="lnk" onClick={onNew}>เพิ่มผู้ติดต่อใหม่</button>
        {/* (every contact of the deal: with several, the words say so) */}
        {mode === 'set' && hasMain && <button type="button" className="quiet" onClick={onNone}>{many ? 'ไม่ระบุผู้ติดต่อทุกคน' : 'ไม่ระบุผู้ติดต่อ'}</button>}
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
