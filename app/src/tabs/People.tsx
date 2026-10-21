import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { LOG_RESULTS, LOG_TYPES, TT } from '../lib/constants';
import { dtTh, fmtN, isoTh, localDay, telHref, todayISO } from '../lib/format';
import { norm } from '../lib/core';
import { ACT_TH, KIND_TH, beYear, dealSteps, docsOf, fmtMoney, jobServices, jointRole, trackerStatus, type Deal, type DealAct } from '../lib/sales';
import { JobSvc } from '../components/SvcChips';
import { NOTE_CAP, PERSON_FIELDS, ROLES, ROLE_TH, nameKey, personInitial, phoneKeys, type PersonForm } from '../lib/people';
import { actCode } from '../components/DealActs';
import { moneyWords } from '../lib/joint';
import type { Company, LogEntry, Person, Task } from '../lib/types';
import { CoAvatar, monoSize } from '../components/CoAvatar';
import { Modal } from '../components/Dialog';
import { DoneBox, taskInfo } from './Plan';
import { Notice, PageHead, Pager, labelCol } from '../components/ui';
import { SelField, Select } from '../components/Select';
// one person, several companies: their companies card, the "คนนี้มีอยู่แล้ว" prompt, merging two records, the CSV
import { CompaniesCard, DupLine, ExistsPrompt, MergePick, SchedBtn, coShort, downloadPeopleCsv, whoLine } from './PeopleCos';

type Engine = ReturnType<typeof useApp>['engine'];
const PER_PAGE = 30;
const CONTACT = ['call', 'email', 'meet', 'follow'];
/** Text colour of a type label: the light type colours (cyan, amber, periwinkle) darkened to be readable. */
const TYPE_INK: Record<string, string> = { email: '#0B6E7A', meet: '#8A5300', follow: '#3949B8' };
/** A contact-log type: [its word, its readable colour] (the colour is the only cue besides the word). */
export const logType = (t: string): [string, string] => {
  const ty = LOG_TYPES[t] || LOG_TYPES.note;
  return [ty[0], TYPE_INK[t] || ty[1]];
};

/** A person's picture: the first letter of the name (without คุณ / นาย / Dr …) on the light tint. */
export function PersonAvatar({ p, size = 40, ring }: { p: Pick<Person, 'id' | 'name'>; size?: number; ring?: string }) {
  return (
    <span className="pe-ava" aria-hidden="true" style={{ width: size, height: size, fontSize: monoSize(size, 1), boxShadow: ring ? `0 0 0 ${size >= 64 ? 4 : 2}px ${ring}` : undefined }}>
      {personInitial(p.name)}
    </span>
  );
}

/** "วันนี้" / "เมื่อวาน" / "5 วันก่อน", or the date when long ago. */
function ago(iso: string, today: string) {
  if (!iso) return '';
  const d = localDay(iso);
  const n = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 864e5);
  if (!isFinite(n)) return '';
  if (n <= 0) return 'วันนี้';
  if (n === 1) return 'เมื่อวาน';
  return n <= 45 ? `${n} วันก่อน` : isoTh(d);
}

/** The phone numbers in a field ("a | b", "a, b", "a / b"), as typed. */
const phones = (phone: string) => (phone || '').split(/[|,/;]/).map((x) => x.trim()).filter(Boolean);
/** A LINE ID as a link: an official account (@…) or a personal ID; a pasted link as it is. */
function lineHref(line: string) {
  const id = (line || '').trim();
  if (!id) return '';
  if (/^https?:\/\//i.test(id)) return id;
  return 'https://line.me/R/ti/p/' + (id.startsWith('@') ? encodeURIComponent(id) : '~' + encodeURIComponent(id));
}
/** Open a person's page from anywhere: no company page or deal over it, at the top, with the keyboard on it. */
export function useOpenPerson() {
  const { go } = useApp();
  return (id: string) => go('people', { person: id, sel: null, deal: null });
}

/** Per person: last contact, how many contacts, and the next appointment (from the log and the plan). */
function usePeopleIndex(e: Engine, ver: number) {
  return useMemo(() => {
    const today = todayISO();
    const idx = new Map<string, { last: string; n: number; next?: Task }>();
    // (a record merged into another: the kept person's)
    const get = (pid: string) => {
      const id = e.resolvePid(pid);
      return idx.get(id) || (idx.set(id, { last: '', n: 0 }), idx.get(id)!);
    };
    Object.values(e.crm.log).forEach((a) =>
      (a || []).forEach((l) => {
        if (!l.pid || !CONTACT.includes(l.type)) return;
        const x = get(l.pid);
        x.n++;
        if (l.at > x.last) x.last = l.at;
      }),
    );
    // calls, e-mails and meetings recorded in a deal "กับ" the person (a deal deleted since: not counted)
    Object.values(e.sales.acts || {}).forEach((a) => {
      if (!a.pid || !e.sales.deals[a.deal]) return;
      const x = get(a.pid);
      x.n++;
      if (a.d > x.last.slice(0, 10)) x.last = a.d;
    });
    e.crm.tasks.forEach((t) => {
      if (!t.pid || t.done || t.date < today) return;
      const x = get(t.pid);
      if (!x.next || t.date + t.time < x.next.date + x.next.time) x.next = t;
    });
    return idx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, ver]);
}

export function People() {
  const { engine: e, ui } = useApp();
  useEngineVersion();
  // a record merged into another (an older link, a teammate merged it meanwhile): the kept person's page
  const id = ui.person && e.isMerged(ui.person) && e.people[e.resolvePid(ui.person)] ? e.resolvePid(ui.person) : ui.person;
  return id ? <PersonPage key={id} id={id} /> : <PeopleList />;
}

// ------------------------------------------------------------------ list

function PeopleList() {
  const { engine: e, ui, set } = useApp();
  const ver = useEngineVersion();
  const today = todayISO();
  const me = e.me();
  const idx = usePeopleIndex(e, ver);
  // everyone but the records merged into another; a person still deals with some company of theirs, or left them all
  // (ไม่อยู่แล้ว); their companies, positions there and names all searched
  const { all, active, cosOf } = useMemo(() => {
    const all = e.livePeople();
    const cosOf = new Map(all.map((p) => [p.id, e.personCos(p)]));
    const on = (p: Person) => {
      const c = cosOf.get(p.id)!;
      return c.length ? c.some((x) => x.st === 'active') : p.status !== 'left';
    };
    return { all, active: all.filter(on), cosOf };
  }, [e, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = { all: active.length, mine: active.filter((p) => me && p.owner === me).length, left: all.length - active.length };
  const q = norm(ui.pQ);
  const isOn = new Set(active.map((p) => p.id));
  const list = (ui.pView === 'left' ? all.filter((p) => !isOn.has(p.id)) : ui.pView === 'mine' ? active.filter((p) => me && p.owner === me) : active)
    .filter((p) => !q || norm([p.name, p.nick, p.pos, p.dept, p.company, ...cosOf.get(p.id)!.flatMap((x) => [x.c?.name || x.company, x.pos, x.dept]), p.phone, p.email, p.line].join(' ')).includes(q))
    .sort((a, b) => (idx.get(b.id)?.last || b.upAt || '').localeCompare(idx.get(a.id)?.last || a.upAt || '') || a.name.localeCompare(b.name, 'th'));
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const page = Math.min(ui.pPage, pages - 1);
  const shown = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  // the companies the people still deal with
  const cos = new Set(active.flatMap((p) => cosOf.get(p.id)!.filter((x) => x.st === 'active').map((x) => (x.gid != null ? 'g' + x.gid : 'n' + norm(x.company))))).size;
  const sugg = useMemo(() => e.personSuggestions(), [e, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showSugg, setShowSugg] = useState(false);
  const openPerson = useOpenPerson();
  const cur = ui.last.person;
  // back from a person's page: their row (marked) is brought into view, with the keyboard on it
  useEffect(() => {
    if (!cur) return;
    const row = document.querySelector('.pe-row[aria-current="true"]');
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector<HTMLElement>('.pe-open')?.focus({ preventScroll: true });
  }, [cur]);
  const views: [typeof ui.pView, string, number][] = [['all', 'ทั้งหมด', counts.all], ['mine', 'ที่ฉันดูแล', counts.mine], ['left', 'ไม่อยู่แล้ว', counts.left]];

  return (
    <>
      <PageHead
        title="ผู้ติดต่อ"
        sub={all.length ? `${fmtN(active.length)} คน · จาก ${fmtN(cos)} บริษัท · ทั้งทีมเห็นข้อมูลเดียวกัน` : 'บันทึกคนที่คุยด้วยในแต่ละบริษัท พร้อมประวัติการติดต่อ นัด และโน้ต'}
        right={
          all.length || e.can('edit.cust') ? (
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {/* (the people shown: this view and search, one row per person) */}
              {all.length > 0 && <button onClick={() => downloadPeopleCsv(e, list, idx)} className="btn" disabled={!list.length}>ดาวน์โหลด CSV</button>}
              {e.can('edit.cust') && <button onClick={() => set({ addPerson: {} })} className="btn pri">เพิ่มผู้ติดต่อ</button>}
            </span>
          ) : undefined
        }
      />
      <DupLine />
      {sugg.length > 0 && e.can('edit.cust') && (
        <div className="pe-sugg">
          <div className="note">
            <span>พบชื่อผู้ติดต่อใน Sales Tracker ที่ยังไม่ได้บันทึก {fmtN(sugg.length)} คน</span>
            <button onClick={() => setShowSugg(!showSugg)} aria-expanded={showSugg} className="lnk" style={{ fontSize: 13 }}>{showSugg ? 'ซ่อนรายการ' : 'ดูและเพิ่ม'}</button>
            {showSugg && (
              // (one who is someone recorded at another company already is left for its own button)
              <button onClick={() => e.addPeople(sugg.filter((s) => !s.same).map((s) => ({ id: s.id, name: s.name, gid: s.gid, company: s.company, phone: s.phone, email: s.email })))} className="lnk" style={{ fontSize: 13 }}>
                เพิ่มทั้งหมด
              </button>
            )}
          </div>
          {showSugg && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {sugg.map((s) => (
                <div key={s.id} className="pe-sugg-row">
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <b style={{ fontWeight: 500 }}>{s.name}</b>
                    <span className="t-sec">{[s.company, s.phone, s.email].filter(Boolean).join(' · ')} · จาก {s.from}</span>
                    {s.same && <span className="t-sec">คนนี้มีอยู่แล้ว: {s.same.name}{whoLine(e, s.same) ? ' · ' + whoLine(e, s.same) : ''}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 6, flex: 'none', alignItems: 'center' }}>
                    {s.same && s.gid != null ? (
                      <button onClick={() => e.addToExisting(s.same!.id, { gid: s.gid, phone: s.phone, email: s.email })} className="btn xs">เพิ่ม {coShort(s.company)} ให้ {s.same.name}</button>
                    ) : (
                      <button onClick={() => e.addPerson({ name: s.name, gid: s.gid, company: s.company, phone: s.phone, email: s.email }, { id: s.id, nx: true })} className="btn xs" aria-label={'เพิ่ม ' + s.name}>เพิ่ม</button>
                    )}
                    <button onClick={() => e.hideSuggestion(s.id)} className="quiet" aria-label={'ไม่ต้องเพิ่ม ' + s.name}>ไม่ต้อง</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <section className="pe-list-card">
        <div className="pe-toolbar">
          <div role="group" aria-label="แสดง" className="utabs pe-views">
            {views.map(([k, label, n]) => (
              <button key={k} aria-pressed={ui.pView === k} onClick={() => set({ pView: k, pPage: 0 })}>
                {label} <span className="n">{fmtN(n)}</span>
              </button>
            ))}
          </div>
          <input value={ui.pQ} onChange={(ev) => set({ pQ: ev.target.value, pPage: 0 })} placeholder="ค้นหาชื่อ ตำแหน่ง บริษัท เบอร์ อีเมล LINE" aria-label="ค้นหาผู้ติดต่อ" className="fld pe-q" />
        </div>
        {!all.length ? (
          <div className="pe-empty">
            <span>ยังไม่มีรายชื่อผู้ติดต่อ · บันทึกคนที่คุยด้วยในแต่ละบริษัท ทั้งทีมเห็นเหมือนกัน</span>
            {sugg.length > 0 && e.can('edit.cust') && <button onClick={() => setShowSugg(true)} className="lnk">นำเข้าจาก Sales Tracker ({fmtN(sugg.length)})</button>}
          </div>
        ) : !list.length ? (
          <div className="pe-empty">
            <span>{q ? `ไม่พบผู้ติดต่อที่ตรงกับ “${ui.pQ}”` : ui.pView === 'mine' ? (me ? `ยังไม่มีผู้ติดต่อที่ ${me} ดูแล` : 'ใส่ชื่อของคุณที่ "ฉันคือ" (แท็บอัปเดตข้อมูล) ก่อน') : 'ไม่มีรายการ'}</span>
            {q && <button onClick={() => set({ pQ: '' })} className="lnk">ล้างคำค้นหา</button>}
          </div>
        ) : (
          <>
            <div className="pe-head" aria-hidden="true">
              <span>ชื่อ</span>
              <span>บริษัท</span>
              <span>โทรศัพท์</span>
              <span>ผู้ดูแล</span>
              <span>นัดถัดไป</span>
              <span>ติดต่อล่าสุด</span>
            </div>
            <ul className="pe-rows">
              {shown.map((p) => {
                const x = idx.get(p.id);
                const c = e.personCompany(p);
                const pc = cosOf.get(p.id)!;
                const more = pc.filter((k) => !k.main && k.st === 'active').length;
                const left = !isOn.has(p.id);
                const ph = phones(p.phone)[0] || '';
                const nt = x?.next;
                const ty = nt ? TT.find((t) => t[0] === nt.type) || TT[0] : null;
                return (
                  <li key={p.id} className="pe-row" aria-current={cur === p.id ? 'true' : undefined}>
                    <span className="pe-who">
                      <PersonAvatar p={p} size={34} />
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <button className="pe-open" onClick={() => openPerson(p.id)}>{p.name}</button>
                        <span className="pe-sub">
                          {left && <span className="chip warn" style={{ height: 20, marginRight: 6 }}>ไม่อยู่แล้ว</span>}
                          {[p.pos, p.dept].filter(Boolean).join(' · ') || (p.role ? ROLE_TH[p.role] : '—')}
                        </span>
                      </span>
                    </span>
                    <span className="pe-co">
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span className="pe-clamp">{c?.name || p.company || pc.find((k) => !k.main)?.c?.name || '—'}</span>
                        {more > 0 && (c || p.company) && <span className="pe-sub">และอีก {fmtN(more)} บริษัท</span>}
                      </span>
                    </span>
                    <span className="pe-cell">{ph ? <a href={telHref(p.phone)} className="pe-link">{ph}</a> : <span className="pe-sub">—</span>}</span>
                    <span className="pe-cell">{p.owner || <span className="pe-sub">—</span>}</span>
                    <span className="pe-cell">
                      {nt && ty ? (
                        <span className="pe-clamp1" title={`${ty[1]} ${isoTh(nt.date)}${nt.time ? ' ' + nt.time : ''}`}>{ty[1]} {isoTh(nt.date)}{nt.time ? ' ' + nt.time : ''}</span>
                      ) : (
                        <span className="pe-sub">—</span>
                      )}
                    </span>
                    <span className="pe-cell">{x?.last ? ago(x.last, today) : <span className="pe-sub">ยังไม่เคย</span>}</span>
                  </li>
                );
              })}
            </ul>
            {pages > 1 && <Pager page={page} pages={pages} onPrev={() => set({ pPage: page - 1 })} onNext={() => set({ pPage: page + 1 })} />}
          </>
        )}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ person page

function PersonPage({ id }: { id: string }) {
  const { engine: e, set, open } = useApp();
  const ver = useEngineVersion();
  const p = e.people[id];
  const idx = usePeopleIndex(e, ver);
  const [edit, setEdit] = useState<PersonForm | null>(null);
  const [tab, setTab] = useState<'log' | 'tasks' | 'deals'>('log');
  const [allNotes, setAllNotes] = useState(false);
  const logRef = useRef<HTMLTextAreaElement>(null);
  const today = todayISO();
  const back = () => set({ person: null });
  // an account that can only read changes nothing; a call or note is deleted by an admin or its author
  const ro = !e.can('edit.cust');
  const mayDel = (l: LogEntry) => e.can('del.log', l.by || '');
  if (!p)
    return (
      <div className="pe-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <span className="empty">ไม่พบผู้ติดต่อนี้ อาจมีคนในทีมลบไปแล้ว</span>
        <button onClick={back} className="lnk">กลับไปที่รายชื่อ</button>
      </div>
    );
  // their main company (the deals tab's send); the companies they deal with (one person, several companies)
  const c = e.personCompany(p);
  const cos = e.personCos(p);
  const nCos = cos.filter((x) => x.st === 'active').length;
  const ids = e.idsOf(p.id);
  const logs = e.personLogs(p);
  const contacts = logs.filter((x) => CONTACT.includes(x.l.type));
  // and the contact records of the deals, "กับ" this person
  const acts = e.personActs(p.id);
  const notes = logs.filter((x) => x.l.type === 'note');
  // the appointments of the companies they deal with, and theirs
  const tasks = e.personTasks(p);
  const upcoming = tasks.filter((t) => !t.done).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // the profile counts this person's own appointments still ahead (the tab lists the companies')
  const mineAhead = tasks.filter((t) => !!t.pid && ids.includes(t.pid) && !t.done && t.date >= today).length;
  const doneTasks = tasks.filter((t) => t.done).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  // the deals of their companies (their documents), and the deals this person is the contact of (the link)
  const byYear = (a: Deal, b: Deal) => b.year.localeCompare(a.year);
  const coIds = [...new Set(cos.filter((x) => x.st === 'active' || x.main).map((x) => x.c?.id).filter((x): x is number => x != null))];
  const deals = coIds.flatMap((g) => e.dealsOf(g)).sort(byYear);
  const linked = e.personDeals(p.id).sort(byYear);
  const away = !e.personActive(p);
  const lineUrl = lineHref(p.line);
  const openDeals = linked.filter((d) => d.jobStatus === 'open').length;
  const startLog = () => {
    setTab('log');
    requestAnimationFrame(() => logRef.current?.focus());
  };
  // (their position, department and role are each company's: the companies card)
  const info: [string, ReactNode][] = [
    ['ชื่อเล่น', p.nick],
    ['โทรศัพท์', phones(p.phone).map((x) => (telHref(x) ? <a key={x} href={telHref(x)} className="pe-link" style={{ display: 'block' }}>{x}</a> : <span key={x} style={{ display: 'block' }}>{x}</span>))],
    ['อีเมล', p.email ? <a href={'mailto:' + p.email} className="pe-link" style={{ wordBreak: 'break-all' }}>{p.email}</a> : ''],
    ['LINE ID', p.line && lineUrl ? <a href={lineUrl} target="_blank" rel="noopener noreferrer" className="pe-link">{p.line}</a> : p.line],
    ['ผู้ดูแล', p.owner],
  ];
  // said once, as a grey footer line under the facts
  const foot = [`บันทึกโดย ${p.by || '—'}${p.at ? ' · ' + isoTh(localDay(p.at)) : ''}`, p.upAt && p.upAt !== p.at ? `แก้ล่าสุด ${p.upBy || '—'} ${isoTh(localDay(p.upAt))}` : ''].filter(Boolean).join(' · ');

  return (
    <>
      <nav className="pe-crumb" aria-label="ตำแหน่ง">
        <button onClick={back}>ผู้ติดต่อ</button>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{p.name}</span>
      </nav>
      <div className="pe-grid">
        <div className="pe-col pe-col-l">
        {/* profile */}
        <section className="pe-card pe-prof" aria-label="โปรไฟล์">
          <div className="pe-prof-body">
            <span className="pe-prof-ava">
              <PersonAvatar p={p} size={72} />
            </span>
            <h2 className="pe-name">{p.name}{p.nick ? <span className="pe-nick"> ({p.nick})</span> : null}</h2>
            <span className="pe-pos">
              {[p.pos, p.dept].filter(Boolean).join(' · ') || 'ยังไม่ระบุตำแหน่ง'}
              {(c || p.company) && (
                <>
                  {' @ '}
                  {c ? <button className="pe-colink" onClick={() => open(c.id)}>{c.name}</button> : p.company}
                </>
              )}
            </span>
            {nCos > 1 && <span className="t-meta">ผู้ติดต่อของ {fmtN(nCos)} บริษัท</span>}
            {away && <span className="chip warn">ไม่อยู่แล้ว</span>}
            <div className="pe-stats">
              <span><b>{fmtN(contacts.length + acts.length)}</b>ติดต่อแล้ว</span>
              <span><b>{fmtN(mineAhead)}</b>นัดกับคนนี้</span>
              <span><b>{fmtN(openDeals)}</b>ดีลที่เปิด</span>
            </div>
            {!ro && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
                <button onClick={startLog} className="btn" style={{ padding: 0 }}>บันทึกการโทร</button>
                <SchedBtn p={p} style={{ padding: 0, width: '100%' }} />
              </div>
            )}
          </div>
        </section>

        {/* their companies + documents */}
        <SideCard p={p} deals={deals} last={idx.get(p.id)?.last || ''} today={today} />
        </div>
        <div className="pe-col pe-col-c">
        {/* info */}
        <section className="pe-card pe-info" aria-label="ข้อมูลผู้ติดต่อ">
          <div className="pe-card-h">
            <h3>ข้อมูลผู้ติดต่อ</h3>
            {!edit && !ro && (
              <button className="lnk" onClick={() => setEdit(Object.fromEntries(PERSON_FIELDS.map((k) => [k, p[k]])) as PersonForm)}>แก้ไข</button>
            )}
          </div>
          {edit ? (
            <PersonEdit p={p} init={edit} onDone={() => setEdit(null)} />
          ) : (
            <>
              <dl className="pe-dl">
                {info.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v || <span className="pe-sub">—</span>}</dd>
                  </div>
                ))}
              </dl>
              {p.note && (
                <div className="pe-about">
                  <span className="pe-k">ข้อมูลเพิ่มเติม</span>
                  <span style={{ whiteSpace: 'pre-line' }}>{p.note}</span>
                </div>
              )}
              <span className="t-meta">{foot}</span>
            </>
          )}
        </section>

        {/* timeline tabs */}
        <TabsCard p={p} c={c} tab={tab} setTab={setTab} logRef={logRef} contacts={contacts} acts={acts} upcoming={upcoming} doneTasks={doneTasks} deals={deals} linked={linked} today={today} />
        </div>
        <div className="pe-col pe-col-r">
        {/* notes */}
        <section className="pe-card pe-notes" aria-label="โน้ต">
          <div className="pe-card-h">
            <h3>โน้ต</h3>
            <span className="pe-sub">{fmtN(notes.length)} รายการ</span>
          </div>
          {!ro && <NoteForm pid={p.id} />}
          {!notes.length && <span className="pe-sub">ยังไม่มีโน้ต</span>}
          {(allNotes ? notes : notes.slice(0, 6)).map(({ l, key }) => (
            <NoteItem key={l.id || l.at} l={l} onDel={mayDel(l) ? () => window.confirm('ลบโน้ตนี้?') && e.delLog(key, l) : undefined} />
          ))}
          {notes.length > 6 && (
            <button className="pe-act" style={{ alignSelf: 'flex-start' }} onClick={() => setAllNotes(!allNotes)} aria-expanded={allNotes}>
              {allNotes ? 'แสดงน้อยลง' : `ดูทั้งหมด (${fmtN(notes.length)})`}
            </button>
          )}
        </section>

        </div>
      </div>
    </>
  );
}

/** One entry of a person's history: a contact-log entry (company page) or a deal's contact record "กับ" them. */
type Hist = { at: string; l: LogEntry; key: string; a?: undefined } | { at: string; a: DealAct; l?: undefined };

function TabsCard({ p, c, tab, setTab, logRef, contacts, acts, upcoming, doneTasks, deals, linked, today }: {
  p: Person; c: Company | undefined; tab: 'log' | 'tasks' | 'deals'; setTab: (t: 'log' | 'tasks' | 'deals') => void; logRef: React.RefObject<HTMLTextAreaElement | null>;
  contacts: { l: LogEntry; key: string }[]; acts: DealAct[]; upcoming: Task[]; doneTasks: Task[]; deals: Deal[]; linked: Deal[]; today: string;
}) {
  const { engine: e, ui, set, openSched } = useApp();
  const ro = !e.can('edit.cust');
  const mayDel = (l: LogEntry) => e.can('del.log', l.by || '');
  // a person who deals with several companies: each entry says which one; the tabs cover them all
  const many = e.personCos(p).filter((x) => x.st === 'active').length > 1;
  // newest first: a deal's record by its day (its time of writing when written that day)
  const hist: Hist[] = [
    ...contacts.map(({ l, key }) => ({ at: l.at, l, key })),
    ...acts.map((a) => ({ at: localDay(a.at) === a.d ? a.at : a.d + 'T12:00:00', a })),
  ].sort((x, y) => localDay(y.at).localeCompare(localDay(x.at)) || y.at.localeCompare(x.at));
  // the company's other deals: listed, not counted (this person is not their contact)
  const rest = deals.filter((d) => !linked.includes(d));
  return (
    <section className="pe-card pe-tabs" aria-label="ประวัติและนัดหมาย">
      <div role="tablist" className="utabs">
        {/* (a phone leaves out the .pe-long words, so the three tabs fit across it) */}
        {([['log', <>ประวัติ<span className="pe-long">การติดต่อ</span></>, hist.length], ['tasks', 'นัดหมาย', upcoming.length], ['deals', <>ดีล<span className="pe-long">ใน Sales Tracker</span></>, linked.length]] as const).map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label} <span className="n">{fmtN(n)}</span>
          </button>
        ))}
      </div>
      {tab === 'log' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!ro && <LogForm pid={p.id} taRef={logRef} />}
          {!hist.length ? (
            <span className="empty">ยังไม่มีประวัติ · บันทึกหลังคุยเสร็จ</span>
          ) : (
            <ol className="pe-tl">
              {hist.map((h) => {
                if (h.a) return <ActEntry key={'a' + h.a.deal + h.a.id} a={h.a} many={many} />;
                const { l, key } = h;
                // the node's colour is the type's only cue besides its word in the grey line
                const [tag, ink] = logType(l.type);
                return (
                  <li key={l.id || l.at} className="dr-row">
                    <span className="pe-tl-node" style={{ borderColor: ink }} />
                    <div className="pe-tl-date">
                      <b>{+localDay(l.at).slice(8, 10)}</b>
                      <span>{isoTh(localDay(l.at)).replace(/^\d+\s/, '')}</span>
                    </div>
                    <div className="pe-tl-card">
                      {l.text && <span style={{ whiteSpace: 'pre-line' }}>{l.text}</span>}
                      <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span className="pe-sub"><span style={{ color: ink }}>{tag}</span>{[l.result, dtTh(l.at).split(' ').slice(-2).join(' '), l.by || 'ไม่ระบุชื่อ', many && /^\d+$/.test(key) ? coShort(e.company(+key)?.name || '') : ''].filter(Boolean).map((x) => ' · ' + x).join('')}</span>
                        {mayDel(l) && <span className="dr-acts"><button className="quiet" onClick={() => window.confirm('ลบรายการนี้?') && e.delLog(key, l)} aria-label="ลบรายการนี้">ลบ</button></span>}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
      {tab === 'tasks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="pe-sub">{many ? 'นัดของบริษัทที่คนนี้ติดต่อด้วย · ที่ทำกับ ' + p.name + ' มีป้ายกำกับ' : c ? 'นัดของบริษัทนี้ · ที่ทำกับ ' + p.name + ' มีป้ายกำกับ' : 'เชื่อมกับบริษัทก่อนจึงนัดได้'}</span>
            {!ro && (many ? <SchedBtn p={p} className="btn sm" /> : c && <button onClick={() => openSched({ ids: [c.id], pid: p.id })} className="btn sm">นัดหมาย</button>)}
          </div>
          {!upcoming.length && <span className="empty">ยังไม่มีนัดที่จะถึง</span>}
          <ol className="pe-tl">
            {upcoming.map((t) => (
              <TaskItem key={t.id} t={t} p={p} today={today} />
            ))}
          </ol>
          {doneTasks.length > 0 && (
            <details className="pe-more">
              <summary>นัดที่ทำแล้ว ({fmtN(doneTasks.length)})</summary>
              <ol className="pe-tl">
                {doneTasks.map((t) => (
                  <TaskItem key={t.id} t={t} p={p} today={today} />
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
      {tab === 'deals' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* the deals this person is the contact of (linked in the deal's ผู้ติดต่อ) */}
          {linked.map((d) => (
            <DealMini key={d.id} d={d} p={p} />
          ))}
          {!linked.length && (c || !deals.length) && <span className="empty">{c && !deals.length ? 'บริษัทนี้ยังไม่อยู่ใน Sales Tracker' : c ? 'ยังไม่ได้เป็นผู้ติดต่อของดีลใด' : 'ยังไม่ได้เชื่อมกับบริษัท'}</span>}
          {c && e.can('edit.deal') && (
            // a new deal is ดีลและขั้นตอน's, not the person record's (as CompanyDrawer's SalesBox); this person is its
            // contact. A company with a job this year may get another (another service): the dialog says its jobs
            <button onClick={() => set({ sendIds: [c.id], sendPid: p.id })} className="btn sm" style={{ alignSelf: 'flex-start' }}>
              {deals.some((d) => d.year === (ui.slYear || beYear()) && jointRole(e.sales, d) !== 'header') ? 'เพิ่มงานใน Sales Tracker' : 'ส่งเข้า Sales Tracker'}
            </button>
          )}
          {rest.length > 0 && (
            <>
              <span className="pe-k">{many ? 'ดีลอื่นของบริษัทเหล่านี้' : 'ดีลอื่นของบริษัทนี้'}</span>
              {rest.map((d) => {
                // the deal has a contact already: in their place, or one more (both said, the card shows who it is now)
                const cur = e.dealPeople(d.id)[0];
                return (
                  <div key={d.id} className="pe-deal-w">
                    <DealMini d={d} p={p} />
                    {p.status !== 'left' && e.canLink(d) && (
                      <span className="pe-deal-use">
                        {cur ? (
                          <>
                            <button type="button" className="lnk" onClick={() => e.linkPerson(d.id, p.id, { main: true })}>ใช้ {p.name} แทน {cur.name}</button>
                            <button type="button" className="lnk" onClick={() => e.linkPerson(d.id, p.id)}>เพิ่มเป็นผู้ติดต่ออีกคน</button>
                          </>
                        ) : (
                          <button type="button" className="lnk" onClick={() => e.linkPerson(d.id, p.id)}>ใช้ {p.name} เป็นผู้ติดต่อของ<span className="dc-nw">ดีลนี้</span></button>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function SideCard({ p, deals, last, today }: { p: Person; deals: Deal[]; last: string; today: string }) {
  const { engine: e, set } = useApp();
  const docs = deals.flatMap((d) => docsOf(e.sales, d.id).map((doc) => ({ doc, d })));
  return (
    <section className="pe-card pe-side" aria-label="บริษัทที่ติดต่อด้วยและเอกสาร">
      {/* the companies they deal with (one person, several companies), the other people there */}
      <CompaniesCard p={p} />
      <div className="pe-card-h" style={{ marginTop: 6 }}>
        <h3>เอกสาร</h3>
        <span className="pe-sub">{fmtN(docs.length)} ไฟล์</span>
      </div>
      {!docs.length && <span className="pe-sub">ยังไม่มีเอกสาร · แนบได้ในดีลของบริษัท</span>}
      {docs.slice(0, 8).map(({ doc, d }) => (
        <button key={d.id + doc.id} className="pe-doc" onClick={() => set({ deal: d.id })} title="เปิดดีลเพื่อดู / ดาวน์โหลดเอกสาร">
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
            <span className="pe-clamp">{KIND_TH[doc.kind]}{doc.docNo ? ' ' + doc.docNo : ''}</span>
            <span className="pe-sub">{[/pdf/i.test(doc.mime || doc.name) ? 'PDF' : 'รูปภาพ', doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : '', 'ปี ' + d.year].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
      ))}
      {last && <span className="pe-sub" style={{ marginTop: 4 }}>ติดต่อล่าสุด {ago(last, today)}</span>}
    </section>
  );
}

function NoteItem({ l, onDel }: { l: LogEntry; onDel?: () => void }) {
  return (
    <div className="pe-note dr-row">
      <span style={{ whiteSpace: 'pre-line' }}>{l.text}</span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="pe-sub">{l.by || 'ไม่ระบุชื่อ'} · {dtTh(l.at)}</span>
        {onDel && <span className="dr-acts"><button className="quiet" onClick={onDel} aria-label="ลบโน้ตนี้">ลบ</button></span>}
      </span>
    </div>
  );
}

function NoteForm({ pid }: { pid: string }) {
  const { engine: e } = useApp();
  const [t, setT] = useState('');
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!t.trim()) return;
        e.addPersonLog(pid, 'note', '', t.trim());
        setT('');
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <textarea value={t} onChange={(ev) => setT(ev.target.value)} rows={3} maxLength={NOTE_CAP} placeholder="เช่น ชอบให้ส่งข้อมูลทาง LINE ก่อนโทร" aria-label="โน้ตใหม่" className="pe-ta" />
      {t.trim() && <button type="submit" className="btn sm" style={{ alignSelf: 'flex-end' }}>บันทึกโน้ต</button>}
    </form>
  );
}

function LogForm({ pid, taRef }: { pid: string; taRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { engine: e } = useApp();
  const [type, setType] = useState('call');
  const [result, setResult] = useState('');
  const [text, setText] = useState('');
  // a person who deals with several companies: at which one (its contact log, the company page shows it too)
  const p = e.people[pid];
  const at = p ? e.personCos(p).filter((x) => x.st === 'active' && x.gid != null && !!x.c) : [];
  const [gid, setGid] = useState<number | null>(null);
  const cur = at.find((x) => x.gid === gid) || at[0];
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    if (!text.trim() && !result) return;
    e.addPersonLog(pid, type, result, text.trim(), cur?.gid ?? null);
    setText('');
    setResult('');
  };
  return (
    <form onSubmit={save} className="pe-logform">
      {at.length > 1 && <Select label="ที่บริษัท" value={String(cur!.gid)} onChange={(v) => setGid(+v)} options={at.map((x) => ({ v: String(x.gid), label: 'ที่ ' + coShort(x.c!.name) }))} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
        <Select label="ประเภท" value={type} onChange={setType} options={CONTACT.map((k) => ({ v: k, label: LOG_TYPES[k][0] }))} />
        <Select label="ผลการติดต่อ" value={result} onChange={setResult} options={[{ v: '', label: 'ผลการติดต่อ' }, ...LOG_RESULTS.map((r) => ({ v: r, label: r }))]} />
      </div>
      <textarea ref={taRef} value={text} onChange={(ev) => setText(ev.target.value)} rows={2} placeholder="คุยเรื่องอะไร ผลเป็นอย่างไร" aria-label="รายละเอียดการติดต่อ" className="pe-ta" />
      {/* the primary shows once there is something to save */}
      {(text.trim() || result) && <button type="submit" className="btn sm pri" style={{ alignSelf: 'flex-end' }}>บันทึก</button>}
    </form>
  );
}

function TaskItem({ t, p, today }: { t: Task; p: Person; today: string }) {
  const { engine: e, openSched } = useApp();
  const ro = !e.can('edit.cust');
  const ti = taskInfo(e, t);
  const ty = TT.find((x) => x[0] === t.type) || TT[0];
  const over = !t.done && t.date < today;
  const withP = !!t.pid && e.idsOf(p.id).includes(t.pid);
  const other = t.pid && !withP ? e.people[e.resolvePid(t.pid)] : undefined;
  return (
    <li className={'dr-row' + (t.done ? ' done' : '')}>
      <span className="pe-tl-node" style={{ borderColor: logType(t.type)[1], background: t.done ? logType(t.type)[1] : '#fff' }} />
      <div className="pe-tl-date">
        <b>{+t.date.slice(8, 10)}</b>
        <span>{isoTh(t.date).replace(/^\d+\s/, '')}</span>
      </div>
      <div className={'pe-tl-card' + (withP ? ' mine' : '')}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <DoneBox t={t} onToggle={() => !ro && e.toggleTask(t)} ro={ro} />
          <span>{t.time || 'ทั้งวัน'}</span>
          <span className="pe-sub"><span style={{ color: logType(t.type)[1] }}>{ty[1]}</span>{withP ? ' · กับ ' + p.name : other ? ' · กับ ' + other.name : ''}</span>
          {over && <span className="chip bad">เกินกำหนด</span>}
        </span>
        {t.note && <span>{t.note}</span>}
        <span style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="pe-sub">{ti.title}</span>
          {!ro && (
            <span className="dr-acts">
              <button className="lnk" style={{ fontSize: 13 }} onClick={() => openSched({ taskId: t.id, ids: [t.gid] })}>เลื่อน / แก้ไข</button>
              <button className="quiet" onClick={() => e.delTask(t)}>ลบนัด</button>
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

/** A deal's contact record "กับ" the person, in their history: where it was recorded, and the deal to open. */
function ActEntry({ a, many }: { a: DealAct; many?: boolean }) {
  const { engine: e, set } = useApp();
  const d = e.sales.deals[a.deal];
  const [, ink] = logType(a.type);
  return (
    <li className="dr-row">
      <span className="pe-tl-node" style={{ borderColor: ink }} />
      <div className="pe-tl-date">
        <b>{+a.d.slice(8, 10)}</b>
        <span>{isoTh(a.d).replace(/^\d+\s/, '')}</span>
      </div>
      <div className="pe-tl-card">
        {a.note && <span style={{ whiteSpace: 'pre-line' }}>{a.note}</span>}
        <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="pe-sub"><span style={{ color: ink }}>{ACT_TH[a.type]}</span>{[d ? `ในดีล Sales Tracker ปี ${d.year}` : '', actCode(e.sales, a), a.by || 'ไม่ระบุชื่อ', many && d ? coShort(d.client) : ''].filter(Boolean).map((x) => ' · ' + x).join('')}</span>
          {d && <span className="dr-acts"><button className="lnk" style={{ fontSize: 13 }} onClick={() => set({ deal: d.id })}>เปิดดีล</button></span>}
        </span>
      </div>
    </li>
  );
}

function DealMini({ d, p }: { d: Deal; p: Person }) {
  const { engine: e, set } = useApp();
  const S = e.sales;
  const tr = dealSteps(S, d, todayISO());
  const mine = e.dealPeople(d.id).some((x) => x.id === p.id);
  // another deal of the company: who its contact is now (so a tap below says what it changes)
  const now = mine ? '' : e.dealContact(d).name;
  return (
    <button className="pe-deal" onClick={() => set({ deal: d.id })}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 500 }}>ปี {d.year} · <JobSvc svc={jobServices(S, d)} /> · {d.section || 'ไม่ระบุหมวด'}</span>
        <span className="pe-sub">{trackerStatus(S, d)}</span>
      </span>
      <span className="pe-mini" role="img" aria-label={`ทำแล้ว ${tr.done} จาก ${tr.total} ขั้น`}>
        {tr.steps.filter((v) => v.counted).map((v) => <i key={v.id} className={'s-' + v.state} title={v.code} />)}
      </span>
      <span className="pe-sub">
        {/* (a joint quotation's member: its part, never its own typed figures, which count nowhere) */}
        {[...moneyWords(S, d, e.can('view.money')), d.resp ? 'ผู้รับผิดชอบ ' + d.resp : '', mine ? 'ผู้ติดต่อในดีลนี้' : now ? 'ผู้ติดต่อตอนนี้ ' + now : ''].filter(Boolean).join(' · ')}
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ edit / add

function PersonEdit({ p, init, onDone }: { p: Person; init: PersonForm; onDone: () => void }) {
  const { engine: e, set } = useApp();
  const [f, setF] = useState<PersonForm>(init);
  const [merge, setMerge] = useState(false);
  const up = <K extends keyof PersonForm>(k: K) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value as PersonForm[K] });
  const team = [...new Set([...e.crm.team, p.owner].filter(Boolean))];
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    if (!f.name.trim()) return;
    e.updatePerson(p.id, f, init);
    onDone();
  };
  const del = () => {
    // calls and notes kept under the person (no company the team shares) go with them
    const own = (e.crm.log['p-' + p.id] || []).length;
    const atCo = e.personLogs(p).length - own;
    const nd = e.personDeals(p.id).length;
    const msg = [
      `ลบ "${p.name}" ออกจากรายชื่อผู้ติดต่อของทั้งทีม?`,
      nd ? `คนนี้เป็นผู้ติดต่อของ ${fmtN(nd)} ดีลใน Sales Tracker ดีลเหล่านั้นจะไม่มีผู้ติดต่อ` : '',
      atCo ? `ประวัติการติดต่อ ${fmtN(atCo)} รายการยังอยู่ในหน้าบริษัท` : '',
      own ? `ประวัติและโน้ต ${fmtN(own)} รายการที่ไม่ได้อยู่กับบริษัทใดจะถูกลบด้วย` : '',
    ].filter(Boolean).join('\n');
    if (!window.confirm(msg)) return;
    e.deletePerson(p.id);
    set({ person: null });
  };
  return (
    <form onSubmit={save} className="pe-form">
      <label style={labelCol}>ชื่อ *<input value={f.name} onChange={up('name')} required maxLength={200} className="fld" /></label>
      <label style={labelCol}>ชื่อเล่น<input value={f.nick} onChange={up('nick')} maxLength={100} className="fld" /></label>
      {/* (position, department, role, status and the company are each company's: บริษัทที่ติดต่อด้วย) */}
      <label style={labelCol}>โทรศัพท์ (หลายเบอร์คั่นด้วย |)<input value={f.phone} onChange={up('phone')} type="tel" maxLength={200} className="fld" /></label>
      <label style={labelCol}>อีเมล<input value={f.email} onChange={up('email')} type="text" inputMode="email" autoComplete="off" maxLength={200} className="fld" /></label>
      <label style={labelCol}>LINE ID<input value={f.line} onChange={up('line')} maxLength={100} className="fld" /></label>
      <SelField style={labelCol} text="ผู้ดูแล" value={f.owner} onChange={(v) => up('owner')({ target: { value: v } })} options={[{ v: '', label: 'ไม่ระบุ' }, ...team.map((x) => ({ v: x, label: x }))]} />
      <span className="t-meta" style={{ gridColumn: '1 / -1' }}>ตำแหน่ง บทบาท และสถานะของแต่ละบริษัท แก้ที่ “บริษัทที่ติดต่อด้วย”</span>
      <label style={{ ...labelCol, gridColumn: '1 / -1' }}>
        ข้อมูลเพิ่มเติม
        <textarea value={f.note} onChange={up('note')} rows={3} maxLength={NOTE_CAP} placeholder="เช่น ช่วงเวลาที่สะดวก ความสนใจ" className="pe-ta" />
      </label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {e.can('del.rec') && <button type="button" onClick={del} className="quiet">ลบผู้ติดต่อ</button>}
        {/* two records of one human: one (needs ลูกค้าและผู้ติดต่อ only: nothing is deleted) */}
        <button type="button" onClick={() => setMerge(true)} className="quiet" style={{ marginRight: 'auto' }}>รวมกับคนที่ซ้ำ</button>
        <button type="button" onClick={onDone} className="quiet">ยกเลิก</button>
        <button type="submit" className="btn pri">บันทึก</button>
      </div>
      {merge && <MergePick p={p} onClose={() => setMerge(false)} />}
    </form>
  );
}

/** Pick the company a person works at: one in the registry or added by hand, or just type its name. */
export function CompanyPicker({ gid, company, onChange }: { gid: number | null; company: string; onChange: (gid: number | null, company: string) => void }) {
  const { engine: e } = useApp();
  const cur = gid != null ? e.company(gid) : undefined;
  const [q, setQ] = useState('');
  // "เปลี่ยน" opens the search but keeps the company until another one is picked (or it is cleared)
  const [changing, setChanging] = useState(false);
  const pick = (g: number | null, name: string) => {
    onChange(g, name);
    setQ('');
    setChanging(false);
  };
  const found = useMemo(() => {
    const k = norm(q);
    if (k.length < 2) return [] as Company[];
    return e.B.companies.filter((c) => norm(c.name).includes(k) || c.jur === q.trim()).slice(0, 6);
  }, [q, e]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>บริษัท</span>
      {(cur || company) && (
        <span className="pe-picked">
          {cur && <CoAvatar name={cur.name} web={cur.web} set={cur.set} size={26} />}
          <span style={{ flex: 1, minWidth: 0 }}>{cur ? cur.name : company} {!cur && <span className="pe-sub">(พิมพ์ชื่อเอง ไม่ได้เชื่อมกับทะเบียน)</span>}</span>
          {changing ? (
            <>
              <button type="button" className="pe-act" onClick={() => pick(null, '')}>ไม่ระบุบริษัท</button>
              <button type="button" className="pe-act" onClick={() => (setChanging(false), setQ(''))}>ยกเลิก</button>
            </>
          ) : (
            <button type="button" className="pe-act" onClick={() => setChanging(true)}>เปลี่ยน</button>
          )}
        </span>
      )}
      {(changing || !(cur || company)) && (
        <>
          <input
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            onKeyDown={(ev) => {
              // Enter here picks the one match; it never sends the whole form
              if (ev.key !== 'Enter') return;
              ev.preventDefault();
              if (found.length === 1) pick(found[0].id, found[0].name);
            }}
            autoFocus={changing}
            placeholder="พิมพ์ชื่อบริษัทหรือเลขนิติบุคคล"
            aria-label="ค้นหาบริษัท"
            className="fld"
          />
          {found.map((c) => (
            <button type="button" key={c.id} className="pe-other" onClick={() => pick(c.id, c.name)}>
              <CoAvatar name={c.name} web={c.web} set={c.set} size={26} />
              <span style={{ minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block' }}>{c.name}</span>
                <span className="pe-sub">{c.code}{c.jur ? ' · ' + c.jur : ''}</span>
              </span>
            </button>
          ))}
          {q.trim().length >= 2 && (
            <button type="button" className="pe-act" style={{ alignSelf: 'flex-start' }} onClick={() => pick(null, q.trim())}>
              ใช้ชื่อ “{q.trim()}” โดยไม่เชื่อมกับทะเบียน
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** "Add a person" dialog (from the People page, or a company's page with that company set). */
export function AddPerson() {
  const { engine: e, ui, set } = useApp();
  const openPerson = useOpenPerson();
  useEngineVersion();
  const a = ui.addPerson!;
  const c0 = a.gid != null ? e.company(a.gid) : undefined;
  // opened from a deal's contact card: the new person becomes that deal's contact too
  const deal = a.deal ? e.sales.deals[a.deal] : undefined;
  const useIn = (pid: string) => deal && e.linkPerson(deal.id, pid, { main: !!a.main });
  const [f, setF] = useState({ name: '', pos: '', phone: '', email: '', line: '', role: '' as Person['role'], gid: c0 ? c0.id : (null as number | null), company: c0?.name || a.company || '' });
  const close = () => set({ addPerson: null });
  const up = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  // the same person already recorded at this company (name, phone or e-mail)
  const dup = useMemo(() => {
    const nk = nameKey(f.name), ph = phoneKeys(f.phone), em = f.email.trim().toLowerCase();
    if (!nk && !ph.length && !em) return undefined;
    const pool = f.gid != null ? e.peopleOf(f.gid) : e.livePeople().filter((p) => p.gid == null && norm(p.company) === norm(f.company));
    return pool.find((p) => (nk.length > 1 && nameKey(p.name) === nk) || phoneKeys(p.phone).some((x) => ph.includes(x)) || (!!em && p.email.trim().toLowerCase() === em));
  }, [f, e]);
  // someone recorded already at another company (the same mobile, e-mail or full name): this company is added to
  // them instead of a second record of them ("เพิ่มบริษัทนี้ให้คนเดิม", the primary; "สร้างคนใหม่" beside it)
  const found = useMemo(() => (dup ? [] : e.findExisting({ name: f.name, phone: f.phone, email: f.email }, f.gid, f.company).filter((x) => !x.here)), [f, e, dup]);
  const one = found.length === 1 ? found[0].p : undefined;
  // several: one of them to choose ("ใช้คนนี้"), or a new person on purpose; Enter makes nobody
  const several = found.length > 1;
  const co = f.gid != null ? e.company(f.gid) : undefined;
  const create = () => {
    if (!f.name.trim()) return;
    const id = e.addPerson({ ...f, name: f.name.trim() });
    if (!id) return;
    useIn(id);
    // from the People page, the new person's page opens; from a company page or a deal, it stays there
    set({ addPerson: null });
    if (deal) return;
    if (ui.tab === 'people' && ui.sel == null) openPerson(id);
  };
  const useOld = (pid: string) => {
    e.addToExisting(pid, { gid: co ? co.id : null, pos: f.pos, role: f.role, phone: f.phone, email: f.email, line: f.line }, deal ? { id: deal.id, main: !!a.main } : undefined);
    set({ addPerson: null });
    if (!deal && ui.tab === 'people' && ui.sel == null) openPerson(pid);
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!f.name.trim()) return;
    // (Enter: the dialog's primary)
    if (one) useOld(one.id);
    else if (!several) create();
  };
  return (
    <Modal title="เพิ่มผู้ติดต่อ" onClose={close} width={620}>
      <form onSubmit={submit} className="pe-form">
        {deal && <p className="t-sec" style={{ gridColumn: '1 / -1', margin: 0 }}>สำหรับดีลปี {deal.year} · {deal.section || 'ไม่ระบุหมวด'} บันทึกแล้วจะเป็นผู้ติดต่อของดีลนี้ และอยู่ในหน้าผู้ติดต่อด้วย</p>}
        <label style={{ ...labelCol, gridColumn: '1 / -1' }}>ชื่อ *<input value={f.name} onChange={up('name')} required autoFocus maxLength={200} placeholder="เช่น คุณสมชาย ใจดี" className="fld" /></label>
        <div style={{ gridColumn: '1 / -1' }}>
          <CompanyPicker gid={f.gid} company={f.company} onChange={(gid, company) => setF({ ...f, gid, company })} />
        </div>
        <label style={labelCol}>ตำแหน่ง<input value={f.pos} onChange={up('pos')} maxLength={200} placeholder="เช่น ผู้จัดการฝ่ายจัดซื้อ" className="fld" /></label>
        <SelField style={labelCol} text="บทบาทในการซื้อ" value={f.role} onChange={(v) => up('role')({ target: { value: v } })} options={ROLES.map((r) => ({ v: r, label: ROLE_TH[r] }))} />
        <label style={labelCol}>โทรศัพท์<input value={f.phone} onChange={up('phone')} type="tel" maxLength={200} className="fld" /></label>
        <label style={labelCol}>อีเมล<input value={f.email} onChange={up('email')} type="text" inputMode="email" autoComplete="off" maxLength={200} className="fld" /></label>
        {found.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <ExistsPrompt found={found} coName={co?.name || ''} onUse={useOld} onOpen={(pid) => (set({ addPerson: null }), openPerson(pid))} />
          </div>
        )}
        <label style={labelCol}>LINE ID<input value={f.line} onChange={up('line')} maxLength={100} className="fld" /></label>
        {dup && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Notice kind="error" role="status">
              มีผู้ติดต่อที่อาจเป็นคนเดียวกันแล้ว: <b style={{ fontWeight: 500 }}>{dup.name}</b>{dup.pos ? ' · ' + dup.pos : ''}{' '}
              {deal ? (
                <button type="button" className="pe-act" onClick={() => (useIn(dup.id), set({ addPerson: null }))}>ใช้คนนี้ในดีลนี้</button>
              ) : (
                <button type="button" className="pe-act" onClick={() => (set({ addPerson: null }), openPerson(dup.id))}>เปิดดู</button>
              )}
            </Notice>
          </div>
        )}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={close} className="quiet">ยกเลิก</button>
          {one ? (
            <>
              <button type="button" onClick={create} className="btn">สร้างคนใหม่</button>
              <button type="submit" className="btn pri">{co ? 'เพิ่มบริษัทนี้ให้คนเดิม' : deal ? 'ใช้คนเดิมในดีลนี้' : 'ใช้คนเดิม'}</button>
            </>
          ) : several ? (
            <button type="button" onClick={create} className="btn">สร้างคนใหม่</button>
          ) : (
            <button type="submit" className="btn pri">{deal ? 'เพิ่มและใช้ในดีลนี้' : 'เพิ่มผู้ติดต่อ'}</button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** A company's people, on its page (CompanyDrawer, also from the Search drawer): everyone who deals with it, whose main
 *  company it is or not, with their position there; those no longer there folded under them. */
export function CompanyPeople({ c }: { c: Company }) {
  const { engine: e, set } = useApp();
  const openPerson = useOpenPerson();
  const all = e.peopleOf(c.id).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  const list = all.filter((p) => p.status !== 'left'), gone = all.filter((p) => p.status === 'left');
  const box: CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 };
  const row = (p: (typeof all)[number]) => (
    <button key={p.id} className="pe-other" onClick={() => openPerson(p.id)}>
      <PersonAvatar p={p} size={32} />
      <span style={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
        <span style={{ display: 'block' }}>{p.name}</span>
        <span className="pe-sub">{[p.pos, phones(p.phone)[0], p.ncos > 1 ? `ผู้ติดต่อของ ${fmtN(p.ncos)} บริษัท` : ''].filter(Boolean).join(' · ') || '—'}</span>
      </span>
    </button>
  );
  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <h3 className="card-t">ผู้ติดต่อ{list.length ? ` (${fmtN(list.length)})` : ''}</h3>
        {e.can('edit.cust') && <button onClick={() => set({ addPerson: { gid: c.id } })} className="lnk">เพิ่มผู้ติดต่อ</button>}
      </div>
      {!list.length && <span className="empty">{e.can('edit.cust') ? 'ยังไม่มี · บันทึกคนที่คุยด้วย เพื่อเก็บเบอร์ ตำแหน่ง และประวัติ' : 'ยังไม่มีผู้ติดต่อ'}</span>}
      {list.map(row)}
      {gone.length > 0 && (
        <details className="pe-more">
          <summary>ไม่อยู่บริษัทนี้แล้ว {fmtN(gone.length)} คน</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{gone.map(row)}</div>
        </details>
      )}
    </div>
  );
}
