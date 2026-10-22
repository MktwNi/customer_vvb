/**
 * One person, several companies (ผู้ติดต่อของหลายบริษัท), on the People pages: the person page's "บริษัทที่ติดต่อด้วย"
 * (each company with their position, role and status there, "เพิ่มบริษัท", "ไม่อยู่แล้ว" kept as history), the
 * "คนนี้มีอยู่แล้ว" prompt of the add dialog, two records of one human merged into one, the people CSV and the
 * appointment button that asks which company. The data is lib/people.ts PCo and the engine's people section.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useApp, useEngineVersion } from '../state';
import { norm } from '../lib/core';
import { downloadBlob, fmtN, isoTh, localDay, todayISO } from '../lib/format';
import { isLocalId } from '../lib/teamSync';
import { ROLES, ROLE_TH, foundWhy, mergePlan, peopleCsv, splitList, type CsvPerson, type DupPair, type Found, type PersonCo } from '../lib/people';
import { TT } from '../lib/constants';
import type { Company, Person, Task } from '../lib/types';
import { CoAvatar } from '../components/CoAvatar';
import { Modal } from '../components/Dialog';
import { SelField } from '../components/Select';
import { labelCol } from '../components/ui';
import { CompanyPicker, PersonAvatar, useOpenPerson } from './People';
import '../people.css';

type Engine = ReturnType<typeof useApp>['engine'];
type Co = PersonCo & { c?: Company };
const CONTACT = ['call', 'email', 'meet', 'follow'];

/** A company's name as said in a line ("บริษัท ซากิโนมิยะ ประเทศไทย จำกัด" → "ซากิโนมิยะ ประเทศไทย"). */
export const coShort = (name: string) => (name || '').replace(/^(บริษัท|บจก\.?|ห้างหุ้นส่วนจำกัด|หจก\.?)\s*/, '').replace(/\s*(จำกัด\s*\(มหาชน\)|จำกัด|\(มหาชน\))\s*$/, '').trim() || name;
const coName = (x: Co) => x.c?.name || x.company || 'ไม่ระบุบริษัท';

/** A person's deals and contacts at one company (their companies' rows: "ดีล n · ติดต่อ n ครั้ง"). */
export function coCounts(e: Engine, p: Person, gid: number | null) {
  if (gid == null) return { deals: 0, contacts: 0 };
  const g = e.canonical(gid);
  const at = (x: number | null | undefined) => x != null && e.canonical(x) === g;
  const deals = e.personDeals(p.id).filter((d) => at(d.gid)).length;
  const logs = e.personLogs(p).filter((x) => CONTACT.includes(x.l.type) && /^\d+$/.test(x.key) && at(+x.key)).length;
  const acts = e.personActs(p.id).filter((a) => at(e.sales.deals[a.deal]?.gid)).length;
  return { deals, contacts: logs + acts };
}
/** "ที่ปรึกษาโครงการ · บริษัทหลัก" / "ดีล 1 · ติดต่อ 2 ครั้ง". */
function countLine(n: { deals: number; contacts: number }) {
  if (!n.deals && !n.contacts) return 'ยังไม่มีดีลกับคนนี้ · ยังไม่เคยติดต่อ';
  return [n.deals ? `ดีล ${fmtN(n.deals)}` : 'ยังไม่มีดีล', n.contacts ? `ติดต่อ ${fmtN(n.contacts)} ครั้ง` : 'ยังไม่เคยติดต่อ'].join(' · ');
}

// ------------------------------------------------------------------ บริษัทที่ติดต่อด้วย
/** The person page's companies: the ones they deal with now (main first), the ones they left (folded), "เพิ่มบริษัท",
 *  and the other people of those companies. */
export function CompaniesCard({ p }: { p: Person }) {
  const { engine: e } = useApp();
  const ver = useEngineVersion();
  const openPerson = useOpenPerson();
  const ro = !e.can('edit.cust');
  const [edit, setEdit] = useState('');
  const [adding, setAdding] = useState(false);
  const [allOthers, setAllOthers] = useState(false);
  const cos = e.personCos(p);
  const act = cos.filter((x) => x.st === 'active'), left = cos.filter((x) => x.st === 'left');
  const main = cos.find((x) => x.main);
  const keyOf = (x: Co) => (x.main ? 'main' : 'g' + x.gid);
  // the keyboard keeps its place: after a row's form closes, that row's "แก้ไข" (the company's row, wherever it is
  // now: made the main one, or ไม่อยู่แล้ว), else "เพิ่มบริษัท"
  const focusTo = (k: string) =>
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-fk="${CSS.escape('co-' + k)}"]`) || document.querySelector<HTMLElement>('[data-fk="co-add"]'))?.focus());
  const rowKey = (x: Co) => (x.gid != null ? 'g' + x.gid : 'main');
  // their main company left while another is still theirs: one tap makes that one the main one
  const promote = !ro && main && main.st === 'left' && main.gid != null ? act.find((x) => !x.main && x.c) : undefined;
  const ids = new Set(e.idsOf(p.id));
  const others = useMemo(() => {
    const seen = new Set<string>();
    return act.flatMap((x) => (x.c ? e.peopleOf(x.c.id).filter((o) => o.status !== 'left' && !ids.has(o.id) && !seen.has(o.id) && (seen.add(o.id), true)).map((o) => ({ o, at: coName(x) })) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, ver, p]);
  const row = (x: Co) =>
    edit === keyOf(x) ? (
      <CoEdit key={keyOf(x)} p={p} x={x} mainTyped={!!main && main.gid == null} onDone={(g) => (setEdit(''), focusTo(g !== undefined ? (g != null ? 'g' + g : 'main') : rowKey(x)))} />
    ) : (
      <CoRow key={keyOf(x)} p={p} x={x} fk={'co-' + rowKey(x)} onEdit={ro ? undefined : () => setEdit(keyOf(x))} />
    );
  return (
    <>
      <div className="pe-card-h">
        <h3>บริษัทที่ติดต่อด้วย</h3>
        {cos.length > 0 && <span className="pe-sub">{fmtN(act.length)} บริษัท</span>}
      </div>
      {!cos.length && <span className="pe-sub">ยังไม่ได้ระบุบริษัท</span>}
      {promote && (
        <span className="pc-note">
          ไม่อยู่ที่บริษัทหลักแล้ว{' '}
          <button type="button" className="pe-act" onClick={() => e.setMainCompany(p.id, promote.gid!)}>ใช้ {coShort(coName(promote))} เป็นบริษัทหลัก</button>
        </span>
      )}
      <div className="pc-list">{act.map(row)}</div>
      {left.length > 0 && (
        <details className="pe-more pc-left">
          <summary>ไม่อยู่แล้ว {fmtN(left.length)} บริษัท</summary>
          <div className="pc-list">{left.map(row)}</div>
        </details>
      )}
      {!ro && (adding ? <AddCo p={p} cos={cos} onDone={(g) => (setAdding(false), focusTo(g != null ? 'g' + g : 'add'))} /> : (
        <button type="button" className="pe-act" data-fk="co-add" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>เพิ่มบริษัท</button>
      ))}
      {others.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="pe-k">{act.length > 1 ? 'คนอื่นในบริษัทเหล่านี้' : 'คนอื่นในบริษัทนี้'}</span>
          {(allOthers ? others : others.slice(0, 6)).map(({ o, at }) => (
            <button key={o.id} className="pe-other" onClick={() => openPerson(o.id)}>
              <PersonAvatar p={o} size={28} />
              <span style={{ minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block' }}>{o.name}</span>
                <span className="pe-sub">{[o.pos, act.length > 1 ? coShort(at) : ''].filter(Boolean).join(' · ') || '—'}</span>
              </span>
            </button>
          ))}
          {others.length > 6 && (
            <button type="button" className="pe-act" style={{ alignSelf: 'flex-start' }} aria-expanded={allOthers} onClick={() => setAllOthers(!allOthers)}>
              {allOthers ? 'แสดงน้อยลง' : `ดูทั้งหมด ${fmtN(others.length)} คน`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function CoRow({ p, x, fk, onEdit }: { p: Person; x: Co; fk: string; onEdit?: () => void }) {
  const { engine: e, open } = useApp();
  const name = coName(x);
  const n = coCounts(e, p, x.gid);
  const sub = [x.pos, x.role ? ROLE_TH[x.role] : '', x.main ? 'บริษัทหลัก' : ''].filter(Boolean).join(' · ');
  return (
    <div className={'pc-row' + (x.st === 'left' ? ' left' : '')}>
      <CoAvatar name={name} web={x.c?.web} set={x.c?.set} size={32} />
      <span className="pc-t">
        {x.c ? (
          <button type="button" className="pc-name co-name dense" onClick={() => open(x.c!.id)} title="เปิดหน้าบริษัท">{name}</button>
        ) : (
          <span className="co-name dense">{name}</span>
        )}
        {x.st === 'left' && <span className="chip warn" style={{ alignSelf: 'flex-start' }}>ไม่อยู่แล้ว</span>}
        {sub && <span className="t-sec">{sub}</span>}
        {!x.c && <span className="t-meta">พิมพ์ชื่อเอง ไม่ได้เชื่อมกับทะเบียน</span>}
        {x.c && <span className="t-meta">{countLine(n)}{x.st === 'left' && x.upAt ? ` · ไม่อยู่แล้วตั้งแต่ ${isoTh(localDay(x.upAt))}` : ''}</span>}
      </span>
      {onEdit && <button type="button" className="lnk pc-edit" data-fk={fk} onClick={onEdit} aria-label={'แก้ไขบริษัท ' + name}>แก้ไข</button>}
    </div>
  );
}

/** One company's row opened: their position, department, role and status there; the main one is changed with
 *  "เปลี่ยน"; another one becomes the main one, or goes (added by mistake, nothing recorded there). `onDone(g)`: the
 *  company whose row the keyboard goes back to (another one picked with เปลี่ยน; undefined: this one). */
function CoEdit({ p, x, mainTyped, onDone }: { p: Person; x: Co; mainTyped: boolean; onDone: (g?: number | null) => void }) {
  const { engine: e } = useApp();
  const [init] = useState({ pos: x.pos, dept: x.dept, role: x.role, st: x.st });
  const [f, setF] = useState(init);
  const [changing, setChanging] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const used = x.gid != null && e.personCoUsed(p, x.gid);
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    // (the company the form was opened for: a teammate making another one the main one meanwhile never gets this)
    e.updatePersonCo(p.id, x.gid, f, init);
    onDone();
  };
  return (
    <form
      ref={ref}
      className="pc-edit-f"
      onSubmit={save}
      onKeyDown={(ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        onDone();
      }}
    >
      <span className="pc-edit-h">
        <span className="pc-edit-who">
          <CoAvatar name={coName(x)} web={x.c?.web} set={x.c?.set} size={32} />
          <span className="pc-t">
            <span className="co-name dense">{coName(x)}</span>
            <span className="t-meta">{[x.c ? countLine(coCounts(e, p, x.gid)) : '', x.main ? 'บริษัทหลัก' : x.by ? `เพิ่มโดย ${x.by}${x.at ? ' ' + isoTh(localDay(x.at)) : ''}` : ''].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
        {x.main && !changing && <button type="button" className="pe-act" onClick={() => setChanging(true)}>เปลี่ยน</button>}
      </span>
      {changing && (
        <>
        {x.gid != null && (
          <span className="t-meta">
            เลือกบริษัทอื่นของคนนี้: สองบริษัทสลับกัน · เลือกบริษัทใหม่: {coShort(coName(x))}{' '}
            {used ? 'ยังอยู่ในรายการแบบ “ไม่อยู่แล้ว” เพราะมีดีลหรือประวัติกับคนนี้ที่นั่น' : 'ออกจากรายการ เพราะยังไม่มีดีลหรือประวัติที่นั่น'}
          </span>
        )}
        <CompanyPicker
          gid={p.gid}
          company={p.company}
          onChange={(gid, company) => {
            // one of their other companies: the two swap (the one so far stays theirs); another company: the one so
            // far is kept as ไม่อยู่แล้ว when something is recorded with them there, else it goes
            const theirs = gid != null ? e.personCos(p).find((k) => !k.main && k.gid === e.canonical(gid) && k.c) : undefined;
            if (theirs) e.setMainCompany(p.id, theirs.gid!);
            else e.updatePerson(p.id, { gid, company }, { gid: p.gid, company: p.company });
            onDone(gid);
          }}
        />
        </>
      )}
      <label style={labelCol}>ตำแหน่งที่บริษัทนี้<input value={f.pos} onChange={(ev) => setF({ ...f, pos: ev.target.value })} maxLength={200} autoFocus className="fld" /></label>
      <label style={labelCol}>ฝ่าย / แผนก<input value={f.dept} onChange={(ev) => setF({ ...f, dept: ev.target.value })} maxLength={200} className="fld" /></label>
      <SelField style={labelCol} text="บทบาทในการซื้อ" value={f.role} onChange={(v) => setF({ ...f, role: v as Person['role'] })} options={ROLES.map((r) => ({ v: r, label: ROLE_TH[r] }))} />
      <div style={labelCol}>
        <span>สถานะที่บริษัทนี้</span>
        <span role="group" aria-label="สถานะที่บริษัทนี้" className="seg">
          <button type="button" aria-pressed={f.st === 'active'} onClick={() => setF({ ...f, st: 'active' })}>ยังติดต่อได้</button>
          <button type="button" aria-pressed={f.st === 'left'} onClick={() => setF({ ...f, st: 'left' })}>ไม่อยู่แล้ว</button>
        </span>
      </div>
      <span className="pc-edit-a">
        {!x.main && x.c && !mainTyped && (
          <button type="button" className="pe-act" onClick={() => (e.setMainCompany(p.id, x.gid!), onDone())}>ใช้เป็นบริษัทหลัก</button>
        )}
        {!x.main && !used && (
          <button type="button" className="quiet" onClick={() => (e.removePersonCo(p.id, x.gid!), onDone(null))} title="เพิ่มผิดบริษัท: เอาออกจากรายการ">เอาออก</button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="quiet" onClick={() => onDone()}>ยกเลิก</button>
        <button type="submit" className="btn sm pri">บันทึก</button>
      </span>
    </form>
  );
}

/** "เพิ่มบริษัท": search the companies the team has (registry and added by hand), pick one, an optional position. */
function AddCo({ p, cos, onDone }: { p: Person; cos: Co[]; onDone: (g?: number | null) => void }) {
  const { engine: e } = useApp();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Company | null>(null);
  const [pos, setPos] = useState('');
  const posRef = useRef<HTMLInputElement>(null);
  const have = new Map(cos.filter((x) => x.gid != null).map((x) => [x.gid!, x]));
  const noMain = !cos.some((x) => x.main);
  const found = useMemo(() => {
    const k = norm(q);
    if (k.length < 2) return [] as Company[];
    return e.B.companies.filter((c) => !isLocalId(c.id) && have.get(e.canonical(c.id))?.st !== 'active' && (norm(c.name).includes(k) || c.jur === q.trim())).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, e]);
  const choose = (c: Company) => {
    setPick(c);
    requestAnimationFrame(() => posRef.current?.focus());
  };
  const add = (ev: FormEvent) => {
    ev.preventDefault();
    if (!pick) {
      if (found.length === 1) choose(found[0]);
      return;
    }
    e.addCompanyToPerson(p.id, pick.id, { pos });
    onDone(e.canonical(pick.id));
  };
  const was = (c: Company) => have.get(e.canonical(c.id));
  return (
    <form className="pc-add" onSubmit={add} onKeyDown={(ev) => ev.key === 'Escape' && (ev.preventDefault(), ev.stopPropagation(), onDone())}>
      <span className="pe-k">เพิ่มบริษัทที่คนนี้ติดต่อด้วย</span>
      {pick ? (
        <span className="pe-picked">
          <CoAvatar name={pick.name} web={pick.web} set={pick.set} size={26} />
          <span style={{ flex: 1, minWidth: 0 }}>{pick.name}</span>
          <button type="button" className="pe-act" onClick={() => setPick(null)}>เปลี่ยน</button>
        </span>
      ) : (
        <>
          <input value={q} onChange={(ev) => setQ(ev.target.value)} autoFocus placeholder="พิมพ์ชื่อบริษัทหรือเลขนิติบุคคล" aria-label="ค้นหาบริษัท" className="fld" />
          {found.map((c) => (
            <button type="button" key={c.id} className="pe-other" onClick={() => choose(c)}>
              <CoAvatar name={c.name} web={c.web} set={c.set} size={26} />
              <span style={{ minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block' }}>{c.name}</span>
                <span className="pe-sub">{was(c) ? `เคยอยู่ · ไม่อยู่แล้ว${was(c)!.upAt ? 'ตั้งแต่ ' + isoTh(localDay(was(c)!.upAt)) : ''} · เลือกเพื่อกลับมาติดต่อได้` : [c.code, c.jur].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
          {norm(q).length >= 2 && !found.length && !noMain && <span className="pe-sub">ไม่พบบริษัทนี้ในทะเบียน · เพิ่มลูกค้าใหม่ก่อน แล้วค่อยเพิ่มที่นี่</span>}
          {/* (no company at all yet: their main one may be a name typed, as on the add dialog) */}
          {noMain && q.trim().length >= 2 && (
            <button type="button" className="pe-act" style={{ alignSelf: 'flex-start' }} onClick={() => (e.updatePerson(p.id, { gid: null, company: q.trim().slice(0, 200) }, { gid: p.gid, company: p.company }), onDone(null))}>
              ใช้ชื่อ “{q.trim()}” โดยไม่เชื่อมกับทะเบียน
            </button>
          )}
        </>
      )}
      <label style={labelCol}>ตำแหน่งที่บริษัทนี้ (ไม่ใส่ก็ได้)<input ref={posRef} value={pos} onChange={(ev) => setPos(ev.target.value)} maxLength={200} placeholder="เช่น ที่ปรึกษาโครงการ" className="fld" /></label>
      <span className="pc-edit-a">
        <span style={{ flex: 1 }} />
        <button type="button" className="quiet" onClick={() => onDone()}>ยกเลิก</button>
        {pick && <button type="submit" className="btn sm pri">เพิ่มบริษัท</button>}
      </span>
    </form>
  );
}

// ------------------------------------------------------------------ นัดหมาย at one of their companies
/** "นัดหมาย": straight to the appointment form at their company; with several, which one first (a row of its own
 *  under the button, the whole width of where the button is; Escape or a click elsewhere closes it). */
export function SchedBtn({ p, className = 'btn', style }: { p: Person; className?: string; style?: CSSProperties }) {
  const { engine: e, openSched } = useApp();
  const [ask, setAsk] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ask) return;
    const out = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (!box.current?.contains(t) && !btn.current?.contains(t)) setAsk(false);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      setAsk(false);
      btn.current?.focus();
    };
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', out);
      document.removeEventListener('keydown', esc, true);
    };
  }, [ask]);
  const at = e.personCos(p).filter((x) => x.c && (x.st === 'active' || x.main));
  if (!at.length) return null;
  const go = (c: Company) => {
    setAsk(false);
    openSched({ ids: [c.id], pid: p.id });
  };
  return (
    <span className="pc-sched">
      <button ref={btn} type="button" className={className} style={style} aria-expanded={at.length > 1 ? ask : undefined} onClick={() => (at.length > 1 ? setAsk(!ask) : go(at[0].c!))}>นัดหมาย</button>
      {ask && (
        <span ref={box} className="pc-sched-pop" role="group" aria-label="นัดที่บริษัทไหน">
          <span className="pe-k">นัดที่บริษัทไหน</span>
          {at.map((x) => (
            <button type="button" key={x.c!.id} className="pe-other" onClick={() => go(x.c!)}>
              <CoAvatar name={x.c!.name} web={x.c!.web} set={x.c!.set} size={24} />
              <span style={{ minWidth: 0, textAlign: 'left' }}>{x.c!.name}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ คนนี้มีอยู่แล้ว (the add dialog)
/** The company a person is described by now (the list's company, the profile's "ตำแหน่ง @ บริษัท"): their main one
 *  while they are still there (or are at none), else the first one they still deal with; `left`: they left it. */
export function nowAt(e: Engine, p: Person): (Co & { more: number }) | undefined {
  const cos = e.personCos(p);
  const act = cos.filter((x) => x.st === 'active');
  const main = cos.find((x) => x.main);
  const at = main && (main.st === 'active' || !act.length) ? main : act[0] || cos[0];
  return at && { ...at, more: act.filter((x) => x !== at).length };
}
/** Who a found person is, in one line: their position, main company and how many more. */
export function whoLine(e: Engine, p: Person) {
  const cos = e.personCos(p).filter((x) => x.st === 'active');
  const main = cos.find((x) => x.main) || cos[0];
  return [main?.pos || p.pos, main ? (main.c?.name || main.company) + (cos.length > 1 ? ` และอีก ${fmtN(cos.length - 1)} บริษัท` : '') : ''].filter(Boolean).join(' · ');
}
/**
 * The add dialog's check, under โทรศัพท์ / อีเมล: someone recorded already at another company is this contact
 * ("เพิ่มบริษัทนี้ให้คนเดิม" is the dialog's primary then, Enter chooses it); several: one to choose.
 * `pick`: the company picked for a deal typed by name that has no company yet (the deal, its client's name, the company's
 * id). Where that company is not the one the deal gets for a person, that person's line says so: they get that company
 * only, and the deal is linked from its card's button, or from the company search on the deal when the card has none.
 */
export function ExistsPrompt({ found, coName: co, typedCo = '', dealCo = '', pick, onUse, onOpen }: { found: Found[]; coName: string; typedCo?: string; dealCo?: string; pick?: { deal: string; client: string; gid: number }; onUse: (pid: string) => void; onOpen: (pid: string) => void }) {
  const { engine: e } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const key = found.map((x) => x.p.id).join(',');
  // (on a phone the dialog's lower half is below the fold: brought into view once, when it appears)
  useEffect(() => {
    if (key) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [key]);
  if (!found.length) return null;
  const one = found.length === 1 ? found[0] : null;
  const apart = (pid: string) => !!pick && !e.pickedIsDealCompany(pick.deal, pid, pick.gid);
  // how the deal gets linked, for a person apart: the card's button when their card shows one (contactNotHere, as it
  // is before the pick), else the company search on the deal
  const linkHow = (pid: string) => {
    const d = pick ? e.sales.deals[pick.deal] : undefined;
    const p = e.people[pid];
    return d && p && e.contactNotHere(d, p) ? '(กดปุ่มในการ์ดดีลถ้าจะเชื่อม)' : '(เชื่อมได้ที่ช่องค้นบริษัทของดีล)';
  };
  return (
    <div ref={ref} className="pc-exists" role="status">
      <span className="pc-exists-h">{one ? `คนนี้มีอยู่แล้วในรายชื่อผู้ติดต่อ · ${foundWhy(one.by)}` : `อาจเป็นคนที่มีอยู่แล้ว ${fmtN(found.length)} คน · เลือกคนที่ใช่ หรือสร้างคนใหม่`}</span>
      {found.map(({ p, by }) => (
        <div key={p.id} className="pc-exists-p">
          <PersonAvatar p={p} size={36} />
          <span className="pc-t">
            <span style={{ fontWeight: 500 }}>{p.name}</span>
            {whoLine(e, p) && <span className="t-sec">{whoLine(e, p)}</span>}
            <span className="t-meta">{[splitList(p.phone)[0], splitList(p.email)[0], one ? '' : foundWhy(by)].filter(Boolean).join(' · ')}</span>
            {pick && !one && apart(p.id) && (
              <span className="t-sec">
                จะเพิ่ม “{co}” ให้คนนี้เท่านั้น · ดีลยังไม่ได้เชื่อมกับ “{pick.client}” {linkHow(p.id)}
              </span>
            )}
          </span>
          <span className="pc-exists-a">
            <button type="button" className="pe-act" onClick={() => onOpen(p.id)}>เปิดดู</button>
            {!one && <button type="button" className="btn xs" onClick={() => onUse(p.id)}>ใช้คนนี้</button>}
          </span>
        </div>
      ))}
      {one && (
        <span className="t-sec">
          {co && pick && apart(one.p.id)
            ? `เพิ่ม “${co}” ให้ “${one.p.name}” และผูกกับดีลนี้ · ดีลยังไม่ได้เชื่อมกับ “${pick.client}” ${linkHow(one.p.id)} · `
            : co
              ? `เพิ่ม ${co} ให้คนเดิม ไม่ต้องสร้างรายชื่อซ้ำ · ตำแหน่งที่พิมพ์ไว้เป็นตำแหน่งที่บริษัทนี้ · `
              : 'ใช้คนเดิม ไม่ต้องสร้างรายชื่อซ้ำ · '}
          {/* (the deal's company, typed by name: added to them and the deal, made into one in the registry when it is not) */}
          {!co && dealCo ? `เพิ่ม “${dealCo}” ให้คนเดิม และเป็นบริษัทของดีลนี้ (ถ้ายังไม่อยู่ในทะเบียนจะเพิ่มให้ก่อน) · ` : ''}
          {/* (a company typed by name on the dialog alone can't be one more company of theirs: where it goes, said) */}
          {!co && !dealCo && typedCo ? `“${typedCo}” ไม่ได้อยู่ในทะเบียน จะบันทึกไว้ในโน้ตของคนเดิม (เป็นบริษัทหลักถ้ายังไม่มี) · ` : ''}
          เบอร์และอีเมลใหม่ (ถ้ามี) เพิ่มให้คนเดิม
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ รายชื่อซ้ำ: merge two records
/** The People list's line: pairs that may be one human, each to look at and merge, or "ไม่ใช่คนเดียวกัน". */
export function DupLine() {
  const { engine: e } = useApp();
  const ver = useEngineVersion();
  const pairs = useMemo(() => e.likelyDups(), [e, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const [show, setShow] = useState(false);
  const [merge, setMerge] = useState<DupPair | null>(null);
  if (!pairs.length || !e.can('edit.cust')) return null;
  // (the reasons the pairs have: the same for every pair, said as they are, "เบอร์โทรและชื่อ"; else each one that some
  // pair has, "เบอร์โทรหรือชื่อ"; each row says its own)
  const sig = (by: Found['by']) => (['phone', 'email', 'name'] as const).filter((k) => by.includes(k));
  const all = new Set(pairs.map((x) => sig(x.by).join()));
  const why = all.size === 1 ? foundWhy(sig(pairs[0].by)) : (['phone', 'email', 'name'] as const).filter((k) => pairs.some((x) => x.by.includes(k))).map((x) => (x === 'phone' ? 'เบอร์โทร' : x === 'email' ? 'อีเมล' : 'ชื่อ')).join('หรือ') + 'ตรงกัน';
  return (
    <div className="pe-sugg">
      <div className="note">
        <span>พบรายชื่อที่อาจเป็นคนเดียวกัน {fmtN(pairs.length)} คู่ ({why})</span>
        <button onClick={() => setShow(!show)} aria-expanded={show} className="lnk" style={{ fontSize: 13 }}>{show ? 'ซ่อนรายการ' : 'ดูและรวม'}</button>
      </div>
      {show && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          {pairs.map((x) => (
            <div key={x.key} className="pe-sugg-row">
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontWeight: 500 }}>{x.a.name} · {x.b.name}</span>
                <span className="t-sec">{[whoLine(e, x.a) || 'ไม่ระบุบริษัท', whoLine(e, x.b) || 'ไม่ระบุบริษัท'].join(' / ')} · {foundWhy(x.by)}</span>
              </span>
              <span style={{ display: 'flex', gap: 6, flex: 'none', alignItems: 'center' }}>
                <button onClick={() => setMerge(x)} className="btn xs" aria-label={`ดูและรวม ${x.a.name} กับ ${x.b.name}`}>ดูและรวม</button>
                <button onClick={() => e.notDup(x.a.id, x.b.id)} className="quiet" aria-label={`${x.a.name} กับ ${x.b.name} ไม่ใช่คนเดียวกัน`}>ไม่ใช่คนเดียวกัน</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {merge && <MergeDialog a={merge.a} b={merge.b} why={merge.by} onClose={() => setMerge(null)} />}
    </div>
  );
}

/** The person edit's "รวมกับคนที่ซ้ำ": which record is the same human (the likely ones first, or search). */
export function MergePick({ p, onClose }: { p: Person; onClose: () => void }) {
  const { engine: e } = useApp();
  const [q, setQ] = useState('');
  const [b, setB] = useState<{ p: Person; by: Found['by'] } | null>(null);
  const likely = useMemo(() => e.likelyDups().filter((x) => x.a.id === p.id || x.b.id === p.id).map((x) => ({ p: x.a.id === p.id ? x.b : x.a, by: x.by })), [e, p]);
  const k = norm(q);
  const list = k.length < 2 ? likely : e.livePeople().filter((x) => x.id !== p.id && norm([x.name, x.nick, x.phone, x.email].join(' ')).includes(k)).slice(0, 8).map((x) => ({ p: x, by: likely.find((l) => l.p.id === x.id)?.by || [] }));
  if (b) return <MergeDialog a={p} b={b.p} why={b.by} onClose={onClose} />;
  return (
    <Modal title="รวมกับคนที่ซ้ำ" onClose={onClose} width={560}>
      <div className="pc-dlg">
        <span className="t-sec">เลือกรายชื่อที่เป็นคนเดียวกับ {p.name} ดีล ประวัติการติดต่อ นัด และโน้ตของทั้งสองรายชื่อจะอยู่ที่คนเดียวกัน</span>
        <input value={q} onChange={(ev) => setQ(ev.target.value)} autoFocus className="fld" placeholder="พิมพ์ชื่อ เบอร์ หรืออีเมลเพื่อค้น" aria-label="ค้นผู้ติดต่อ" />
        {!list.length && <span className="pe-sub">{k.length < 2 ? 'ไม่พบรายชื่อที่น่าจะซ้ำ · พิมพ์เพื่อค้นจากรายชื่อทั้งหมด' : `ไม่พบ “${q.trim()}”`}</span>}
        {list.map(({ p: x, by }) => (
          <button type="button" key={x.id} className="pe-other" onClick={() => setB({ p: x, by })}>
            <PersonAvatar p={x} size={32} />
            <span style={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
              <span style={{ display: 'block' }}>{x.name}</span>
              <span className="pe-sub">{[whoLine(e, x), by.length ? foundWhy(by) : ''].filter(Boolean).join(' · ') || '—'}</span>
            </span>
            <span className="btn xs" aria-hidden="true">เลือก</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** One record's card in the merge dialog: what it holds, and what it is chosen as (one radio of "เก็บรายชื่อไหน":
 *  the chosen one is the Tab stop, the arrow keys move the choice). */
function MergeCard({ e, p, keep, onPick, onKey }: { e: Engine; p: Person; keep: boolean; onPick: () => void; onKey: (ev: React.KeyboardEvent<HTMLButtonElement>) => void }) {
  const cos = e.personCos(p);
  const nTasks = e.personTasks(p).filter((t) => t.pid && e.idsOf(p.id).includes(t.pid)).length;
  const nContacts = e.personLogs(p).filter((x) => CONTACT.includes(x.l.type)).length + e.personActs(p.id).length;
  return (
    <button type="button" role="radio" className={'pc-mcard' + (keep ? ' keep' : '')} aria-checked={keep} tabIndex={keep ? 0 : -1} onClick={onPick} onKeyDown={onKey} data-pid={p.id}>
      <span className="t-meta">{keep ? 'เก็บรายชื่อนี้' : 'รวมเข้ามา แล้วไม่แสดงแยกอีก'}</span>
      <span className="pc-mcard-n">
        <PersonAvatar p={p} size={32} />
        <span style={{ fontWeight: 500 }}>{p.name}</span>
      </span>
      <span className="t-sec">{cos.map((x) => coShort(x.c?.name || x.company) + (x.main && cos.length > 1 ? ' (หลัก)' : '') + (x.st === 'left' ? ' (ไม่อยู่แล้ว)' : '')).join(' · ') || 'ไม่ระบุบริษัท'}</span>
      <span className="t-sec">{[p.phone, p.email, p.line ? 'LINE ' + p.line : ''].filter(Boolean).join(' · ') || 'ไม่มีเบอร์และอีเมล'}</span>
      <span className="t-sec">ดีล {fmtN(e.personDeals(p.id).length)} · ติดต่อ {fmtN(nContacts)} ครั้ง · นัด {fmtN(nTasks)}</span>
      <span className="t-meta">บันทึกโดย {p.by || '—'}{p.at ? ' · ' + isoTh(localDay(p.at)) : ''}</span>
    </button>
  );
}

/** "รวมรายชื่อที่ซ้ำ": which record stays, what it holds after, one tap. Needs ลูกค้าและผู้ติดต่อ (nothing is deleted). */
export function MergeDialog({ a, b, why, onClose }: { a: Person; b: Person; why: Found['by']; onClose: () => void }) {
  const { engine: e, ui, set } = useApp();
  // the record with more on it stays by default (more companies, deals, older)
  const [swap, setSwap] = useState(() => e.personDeals(b.id).length + e.personCos(b).length > e.personDeals(a.id).length + e.personCos(a).length);
  const keep = swap ? b : a, gone = swap ? a : b;
  const cards = useRef<HTMLDivElement>(null);
  // the arrow keys move the choice, and the keyboard with it (a radio group)
  const onKey = (ev: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    ev.preventDefault();
    const next = keep.id === a.id ? b : a;
    setSwap(next.id === b.id);
    requestAnimationFrame(() => cards.current?.querySelector<HTMLElement>(`[data-pid="${CSS.escape(next.id)}"]`)?.focus());
  };
  const plan = mergePlan(keep, gone, e.personCos(keep), e.personCos(gone));
  const after = { ...keep, ...plan.patch } as Person;
  const kc = e.personCos(keep);
  const coLine = [
    ...kc.map((x) => coShort(x.c?.name || x.company) + (x.main ? ' (หลัก)' : '') + (x.st === 'left' ? ' (ไม่อยู่แล้ว)' : '')),
    ...(plan.patch.company && !kc.some((x) => x.main) ? [coShort(e.company(plan.patch.gid ?? -1)?.name || plan.patch.company) + ' (หลัก)'] : []),
    ...plan.cos.filter((x) => !x.fill).map((x) => coShort(e.company(x.gid)?.name || '') + (x.st === 'left' ? ' (ไม่อยู่แล้ว)' : '')),
  ].filter(Boolean).join(' · ');
  const deals = new Set([...e.personDeals(keep.id), ...e.personDeals(gone.id)].map((d) => d.id)).size;
  const contacts = [keep, gone].reduce((n, p) => n + e.personLogs(p).filter((x) => CONTACT.includes(x.l.type)).length + e.personActs(p.id).length, 0);
  const tasks = e.crm.tasks.filter((t) => t.pid && [...e.idsOf(keep.id), ...e.idsOf(gone.id)].includes(t.pid)).length;
  const go = () => {
    if (!e.mergePeople(keep.id, gone.id)) return;
    onClose();
    if (ui.person === gone.id) set({ person: keep.id });
  };
  const rows: [string, string][] = [
    ['ชื่อ', after.name],
    ['บริษัท', coLine || '—'],
    ['โทรศัพท์', after.phone || '—'],
    ['อีเมล', after.email || '—'],
    ...(after.line ? ([['LINE ID', after.line]] as [string, string][]) : []),
    ['ผู้ดูแล', after.owner || '—'],
    ['ดีล ประวัติ นัด', `ดีล ${fmtN(deals)} · ติดต่อ ${fmtN(contacts)} ครั้ง · นัด ${fmtN(tasks)}`],
  ];
  return (
    <Modal title="รวมรายชื่อที่ซ้ำ" onClose={onClose} width={760}>
      <div className="pc-dlg">
        <span className="t-sec">
          สองรายชื่อนี้น่าจะเป็นคนเดียวกัน{why.length ? ` (${foundWhy(why)})` : ''} รวมแล้วเหลือรายชื่อเดียว ดีล ประวัติการติดต่อ นัด และโน้ตของทั้งสองรายชื่ออยู่ที่คนเดียวกัน
        </span>
        <span className="pe-k" id="pc-keep-h">เก็บรายชื่อไหน (แตะอีกรายชื่อเพื่อเก็บรายชื่อนั้นแทน)</span>
        <div className="pc-mcards" role="radiogroup" aria-labelledby="pc-keep-h" ref={cards}>
          {/* (the two in the same places whichever is kept) */}
          <MergeCard e={e} p={a} keep={keep.id === a.id} onPick={() => setSwap(false)} onKey={onKey} />
          <MergeCard e={e} p={b} keep={keep.id === b.id} onPick={() => setSwap(true)} onKey={onKey} />
        </div>
        <div className="pc-after">
          <span className="t-meta">หลังรวม</span>
          <dl>
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {plan.typedCo && <span className="t-meta">บริษัท “{plan.typedCo}” พิมพ์ชื่อเองไว้ ไม่ได้เชื่อมกับทะเบียน จะบันทึกไว้ในโน้ตแทน</span>}
          <span className="t-meta">บันทึกไว้ในโน้ตของคนนี้ว่าใครรวมเมื่อไร · รวมแล้วแยกกลับไม่ได้</span>
        </div>
        <span className="pc-edit-a">
          <span style={{ flex: 1 }} />
          <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn pri" onClick={go}>รวมเป็นคนเดียวกัน</button>
        </span>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ CSV
/** The people shown (this view and search) as a CSV, one row per person, their other companies in one cell. */
export function downloadPeopleCsv(e: Engine, list: Person[], idx: Map<string, { last: string; next?: Task }>) {
  const rows: CsvPerson[] = list.map((p) => {
    const x = idx.get(p.id);
    const nt = x?.next;
    const ty = nt ? TT.find((t) => t[0] === nt.type) || TT[0] : null;
    return {
      p,
      cos: e.personCos(p).map((c) => ({ name: c.c?.name || c.company, pos: c.pos, main: c.main, st: c.st })),
      last: x?.last ? isoTh(localDay(x.last)) : '',
      next: nt && ty ? `${ty[1]} ${isoTh(nt.date)}${nt.time ? ' ' + nt.time : ''}` : '',
      active: e.personActive(p),
    };
  });
  downloadBlob(new Blob(['\ufeff' + peopleCsv(rows)], { type: 'text/csv;charset=utf-8' }), `ผู้ติดต่อ_${todayISO()}.csv`);
}
