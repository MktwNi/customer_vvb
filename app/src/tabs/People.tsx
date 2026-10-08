import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import { LOG_RESULTS, LOG_TYPES, TT } from '../lib/constants';
import { dtTh, fmtN, isoTh, localDay, telHref, todayISO } from '../lib/format';
import { norm } from '../lib/core';
import { KIND_TH, docsOf, fmtMoney, dealMoney, stageTrack, trackerStatus, type Deal } from '../lib/sales';
import { NOTE_CAP, PERSON_FIELDS, ROLES, ROLE_TH, nameKey, personColor, personInitial, phoneKeys, type PersonForm } from '../lib/people';
import type { Company, LogEntry, Person, Task } from '../lib/types';
import { CoAvatar } from '../components/CoAvatar';
import { Modal } from './Sales';
import { DoneBox, taskInfo } from './Plan';
import { Notice, PageHead, Pager, btnOutline, btnPrimary, heroGrad, inputStyle, labelCol, selectStyle } from '../components/ui';

type Engine = ReturnType<typeof useApp>['engine'];
const PER_PAGE = 30;
const CONTACT = ['call', 'email', 'meet', 'follow'];
/** Text colour of a type label: the light type colours (cyan, amber, periwinkle) darkened to be readable. */
const TYPE_INK: Record<string, string> = { email: '#0B6E7A', meet: '#8A5300', follow: '#3949B8' };

/** A person's picture: the first letter of the name (without คุณ / นาย / Dr …) on their own colour. */
export function PersonAvatar({ p, size = 40, ring }: { p: Pick<Person, 'id' | 'name'>; size?: number; ring?: string }) {
  return (
    <span className="pe-ava" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: personColor(p.id), boxShadow: ring ? `0 0 0 ${size >= 64 ? 4 : 2}px ${ring}` : undefined }}>
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
    const get = (id: string) => idx.get(id) || (idx.set(id, { last: '', n: 0 }), idx.get(id)!);
    Object.values(e.crm.log).forEach((a) =>
      (a || []).forEach((l) => {
        if (!l.pid || !CONTACT.includes(l.type)) return;
        const x = get(l.pid);
        x.n++;
        if (l.at > x.last) x.last = l.at;
      }),
    );
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
  const { ui } = useApp();
  useEngineVersion();
  return ui.person ? <PersonPage key={ui.person} id={ui.person} /> : <PeopleList />;
}

// ------------------------------------------------------------------ list

function PeopleList() {
  const { engine: e, ui, set } = useApp();
  const ver = useEngineVersion();
  const today = todayISO();
  const me = e.me();
  const idx = usePeopleIndex(e, ver);
  const all = Object.values(e.people);
  const active = all.filter((p) => p.status !== 'left');
  const counts = { all: active.length, mine: active.filter((p) => me && p.owner === me).length, left: all.length - active.length };
  const q = norm(ui.pQ);
  const list = (ui.pView === 'left' ? all.filter((p) => p.status === 'left') : ui.pView === 'mine' ? active.filter((p) => me && p.owner === me) : active)
    .filter((p) => !q || norm([p.name, p.nick, p.pos, p.dept, p.company, e.personCompany(p)?.name || '', p.phone, p.email, p.line].join(' ')).includes(q))
    .sort((a, b) => (idx.get(b.id)?.last || b.upAt || '').localeCompare(idx.get(a.id)?.last || a.upAt || '') || a.name.localeCompare(b.name, 'th'));
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const page = Math.min(ui.pPage, pages - 1);
  const shown = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const cos = new Set(active.map((p) => (p.gid != null ? 'g' + e.canonical(p.gid) : 'n' + norm(p.company)))).size;
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
  const views: [typeof ui.pView, string, number][] = [['all', 'ทั้งหมด', counts.all], ['mine', 'ที่ฉันดูแล', counts.mine], ['left', 'ย้ายงานแล้ว', counts.left]];

  return (
    <>
      <PageHead
        title="ผู้ติดต่อ"
        sub={all.length ? `${fmtN(active.length)} คน · จาก ${fmtN(cos)} บริษัท · ทั้งทีมเห็นข้อมูลเดียวกัน` : 'บันทึกคนที่คุยด้วยในแต่ละบริษัท พร้อมประวัติการติดต่อ นัด และโน้ต'}
        right={e.can('edit') ? <button onClick={() => set({ addPerson: {} })} style={btnPrimary}>+ เพิ่มผู้ติดต่อ</button> : undefined}
      />
      {sugg.length > 0 && e.can('edit') && (
        <div className="pe-sugg">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: '#1745B8' }}>
              พบชื่อผู้ติดต่อใน Sales Tracker ที่ยังไม่ได้บันทึก <b style={{ fontWeight: 600 }}>{fmtN(sugg.length)} คน</b>
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              {showSugg && (
                <button
                  onClick={() => e.addPeople(sugg.map((s) => ({ id: s.id, name: s.name, gid: s.gid, company: s.company, phone: s.phone, email: s.email })))}
                  style={{ ...btnOutline, height: 34, background: '#fff' }}
                >
                  เพิ่มทั้งหมด
                </button>
              )}
              <button onClick={() => setShowSugg(!showSugg)} aria-expanded={showSugg} style={{ ...btnPrimary, height: 34 }}>{showSugg ? 'ซ่อนรายการ' : 'ดูและเพิ่ม'}</button>
            </span>
          </div>
          {showSugg && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {sugg.map((s) => (
                <div key={s.id} className="pe-sugg-row">
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <b style={{ fontWeight: 500 }}>{s.name}</b>
                    <span style={{ fontSize: 12.5, color: '#475069' }}>{[s.company, s.phone, s.email].filter(Boolean).join(' · ')} · จาก {s.from}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <button onClick={() => e.addPerson({ name: s.name, gid: s.gid, company: s.company, phone: s.phone, email: s.email }, { id: s.id, nx: true })} style={{ ...btnPrimary, height: 30, fontSize: 12.5, padding: '0 12px' }} aria-label={'เพิ่ม ' + s.name}>เพิ่ม</button>
                    <button onClick={() => e.hideSuggestion(s.id)} style={{ ...btnOutline, height: 30, fontSize: 12.5, padding: '0 12px', borderColor: '#D5DBEA', color: '#475069' }} aria-label={'ไม่ต้องเพิ่ม ' + s.name}>ไม่ต้อง</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <section className="pe-list-card">
        <div className="pe-toolbar">
          <div role="group" aria-label="แสดง" className="pe-views">
            {views.map(([k, label, n]) => (
              <button key={k} aria-pressed={ui.pView === k} onClick={() => set({ pView: k, pPage: 0 })}>
                {label} <span>{fmtN(n)}</span>
              </button>
            ))}
          </div>
          <input value={ui.pQ} onChange={(ev) => set({ pQ: ev.target.value, pPage: 0 })} placeholder="ค้นหาชื่อ ตำแหน่ง บริษัท เบอร์ อีเมล LINE" aria-label="ค้นหาผู้ติดต่อ" className="pe-q" />
        </div>
        {!all.length ? (
          <div className="pe-empty">
            <span style={{ fontSize: 16, fontWeight: 500, color: '#0E1430' }}>ยังไม่มีรายชื่อผู้ติดต่อ</span>
            <span>บันทึกคนที่คุยด้วยในแต่ละบริษัท เพื่อดูประวัติการโทร นัด และโน้ตของแต่ละคน ทั้งทีมเห็นเหมือนกัน</span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {e.can('edit') && <button onClick={() => set({ addPerson: {} })} style={btnPrimary}>+ เพิ่มผู้ติดต่อ</button>}
              {sugg.length > 0 && e.can('edit') && <button onClick={() => setShowSugg(true)} style={btnOutline}>นำเข้าจาก Sales Tracker ({fmtN(sugg.length)})</button>}
            </span>
          </div>
        ) : !list.length ? (
          <div className="pe-empty">
            <span>{q ? `ไม่พบผู้ติดต่อที่ตรงกับ “${ui.pQ}”` : ui.pView === 'mine' ? (me ? `ยังไม่มีผู้ติดต่อที่ ${me} ดูแล` : 'ใส่ชื่อของคุณที่ "ฉันคือ" (แท็บอัปเดตข้อมูล) ก่อน') : 'ไม่มีรายการ'}</span>
            {q && <button onClick={() => set({ pQ: '' })} style={{ ...btnOutline, height: 34 }}>ล้างคำค้นหา</button>}
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
              <span />
            </div>
            <ul className="pe-rows">
              {shown.map((p) => {
                const x = idx.get(p.id);
                const c = e.personCompany(p);
                const ph = phones(p.phone)[0] || '';
                const nt = x?.next;
                const ty = nt ? TT.find((t) => t[0] === nt.type) || TT[0] : null;
                return (
                  <li key={p.id} className="pe-row" aria-current={cur === p.id ? 'true' : undefined}>
                    <span className="pe-who">
                      <PersonAvatar p={p} size={40} ring={cur === p.id ? '#fff' : undefined} />
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <button className="pe-open" onClick={() => openPerson(p.id)}>{p.name}</button>
                        <span className="pe-sub">
                          {p.status === 'left' && <span className="pe-chip warn sm">ย้ายงานแล้ว</span>}
                          {[p.pos, p.dept].filter(Boolean).join(' · ') || (p.role ? ROLE_TH[p.role] : '—')}
                        </span>
                      </span>
                    </span>
                    <span className="pe-co">
                      {c ? <CoAvatar name={c.name} web={c.web} set={c.set} size={24} /> : null}
                      <span className="pe-clamp">{c?.name || p.company || '—'}</span>
                    </span>
                    <span className="pe-cell">{ph ? <a href={telHref(p.phone)} className="pe-link">{ph}</a> : <span className="pe-sub">—</span>}</span>
                    <span className="pe-cell">{p.owner ? <span className="pe-chip">{p.owner}</span> : <span className="pe-sub">—</span>}</span>
                    <span className="pe-cell">
                      {nt && ty ? (
                        <span className="pe-nextappt" title={`${ty[1]} ${isoTh(nt.date)}${nt.time ? ' ' + nt.time : ''}`}>
                          <span className="pe-dot" style={{ background: ty[2] }} />
                          <span className="pe-clamp1">{ty[1]} {isoTh(nt.date)}{nt.time ? ' ' + nt.time : ''}</span>
                        </span>
                      ) : (
                        <span className="pe-sub">—</span>
                      )}
                    </span>
                    <span className="pe-cell pe-sub2">{x?.last ? ago(x.last, today) : 'ยังไม่เคย'}</span>
                    <span className="pe-chev" aria-hidden="true">›</span>
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
  const { engine: e, set, open, openSched } = useApp();
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
  const ro = !e.can('edit');
  const mayDel = (l: LogEntry) => e.can('admin') || (!ro && l.by === e.me());
  if (!p)
    return (
      <div className="pe-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 16 }}>ไม่พบผู้ติดต่อนี้ — อาจมีคนในทีมลบไปแล้ว</span>
        <button onClick={back} style={btnOutline}>← กลับไปที่รายชื่อ</button>
      </div>
    );
  const c = e.personCompany(p);
  const logs = e.personLogs(p);
  const contacts = logs.filter((x) => CONTACT.includes(x.l.type));
  const notes = logs.filter((x) => x.l.type === 'note');
  const tasks = c ? e.tasksOf(c.id) : e.crm.tasks.filter((t) => t.pid === p.id);
  const upcoming = tasks.filter((t) => !t.done).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // the profile counts this person's own appointments still ahead (the tab lists the company's)
  const mineAhead = tasks.filter((t) => t.pid === p.id && !t.done && t.date >= today).length;
  const doneTasks = tasks.filter((t) => t.done).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const deals = c ? e.dealsOf(c.id).sort((a, b) => b.year.localeCompare(a.year)) : [];
  const others = c ? e.peopleOf(c.id).filter((x) => x.id !== p.id) : [];
  const ph = telHref(p.phone);
  const lineUrl = lineHref(p.line);
  const openDeals = deals.filter((d) => d.jobStatus === 'open').length;
  const startLog = () => {
    setTab('log');
    requestAnimationFrame(() => logRef.current?.focus());
  };
  const info: [string, ReactNode][] = [
    ['ชื่อเล่น', p.nick],
    ['ตำแหน่ง', p.pos],
    ['ฝ่าย / แผนก', p.dept],
    ['บทบาทในการซื้อ', p.role ? ROLE_TH[p.role] : ''],
    ['โทรศัพท์', phones(p.phone).map((x) => (telHref(x) ? <a key={x} href={telHref(x)} className="pe-link" style={{ display: 'block' }}>{x}</a> : <span key={x} style={{ display: 'block' }}>{x}</span>))],
    ['อีเมล', p.email ? <a href={'mailto:' + p.email} className="pe-link" style={{ wordBreak: 'break-all' }}>{p.email}</a> : ''],
    ['LINE ID', p.line],
    ['ผู้ดูแล', p.owner],
    ['สถานะ', p.status === 'left' ? 'ย้ายงาน / ไม่อยู่บริษัทนี้แล้ว' : 'ยังติดต่อได้'],
    ['บันทึกโดย', `${p.by || '—'}${p.at ? ' · ' + isoTh(localDay(p.at)) : ''}`],
  ];

  return (
    <>
      <nav className="pe-crumb" aria-label="ตำแหน่ง">
        <button onClick={back}>ผู้ติดต่อ</button>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{p.name}</span>
      </nav>
      <div className="pe-grid">
        <div className="pe-col pe-col-l">
        {/* profile */}
        <section className="pe-card pe-prof" aria-label="โปรไฟล์">
          <div className="pe-band" style={{ background: heroGrad }} />
          <div className="pe-prof-body">
            <span className="pe-prof-ava">
              <PersonAvatar p={p} size={84} ring="#fff" />
              {c && <CoAvatar name={c.name} web={c.web} set={c.set} size={28} ring="#fff" style={{ position: 'absolute', right: -4, bottom: -2 }} />}
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
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {p.role && <span className="pe-chip strong">{ROLE_TH[p.role]}</span>}
              {p.status === 'left' && <span className="pe-chip warn">ย้ายงานแล้ว</span>}
              {p.owner && <span className="pe-chip">ดูแลโดย {p.owner}</span>}
            </span>
            <div className="pe-stats">
              <span><b>{fmtN(contacts.length)}</b>ติดต่อแล้ว</span>
              <span><b>{fmtN(mineAhead)}</b>นัดกับคนนี้</span>
              <span><b>{fmtN(openDeals)}</b>ดีลที่เปิด</span>
            </div>
            <div className="pe-reach">
              <a href={ph || undefined} aria-disabled={!ph} className={'pe-round' + (ph ? '' : ' off')} title={phones(p.phone)[0] || 'ยังไม่มีเบอร์'} onClick={() => ph && setTimeout(startLog, 300)}>
                <span aria-hidden="true">📞</span>โทร
              </a>
              <a href={p.email ? 'mailto:' + p.email : undefined} aria-disabled={!p.email} className={'pe-round' + (p.email ? '' : ' off')} title={p.email || 'ยังไม่มีอีเมล'}>
                <span aria-hidden="true">✉️</span>อีเมล
              </a>
              <a href={lineUrl || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!lineUrl} className={'pe-round' + (lineUrl ? '' : ' off')} title={p.line || 'ยังไม่มี LINE ID'}>
                <span aria-hidden="true">💬</span>LINE
              </a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
              <button onClick={startLog} disabled={ro} style={{ ...btnPrimary, padding: 0, opacity: ro ? 0.5 : 1 }}>บันทึกการโทร</button>
              <button onClick={() => (c && !ro ? openSched({ ids: [c.id], pid: p.id }) : undefined)} disabled={!c || ro} title={c ? '' : 'เชื่อมกับบริษัทก่อนจึงนัดได้'} style={{ ...btnOutline, padding: 0, opacity: c && !ro ? 1 : 0.5 }}>นัดหมาย</button>
            </div>
          </div>
        </section>

        {/* company + documents */}
        <SideCard p={p} c={c} deals={deals} others={others} last={idx.get(p.id)?.last || ''} today={today} />
        </div>
        <div className="pe-col pe-col-c">
        {/* info */}
        <section className="pe-card pe-info" aria-label="ข้อมูลผู้ติดต่อ">
          <div className="pe-card-h">
            <h3>ข้อมูลผู้ติดต่อ</h3>
            {!edit && !ro && (
              <button className="pe-edit" onClick={() => setEdit(Object.fromEntries(PERSON_FIELDS.map((k) => [k, p[k]])) as PersonForm)}>✎ แก้ไข</button>
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
            </>
          )}
        </section>

        {/* timeline tabs */}
        <TabsCard p={p} c={c} tab={tab} setTab={setTab} logRef={logRef} contacts={contacts} upcoming={upcoming} doneTasks={doneTasks} deals={deals} today={today} />
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

function TabsCard({ p, c, tab, setTab, logRef, contacts, upcoming, doneTasks, deals, today }: {
  p: Person; c: Company | undefined; tab: 'log' | 'tasks' | 'deals'; setTab: (t: 'log' | 'tasks' | 'deals') => void; logRef: React.RefObject<HTMLTextAreaElement | null>;
  contacts: { l: LogEntry; key: string }[]; upcoming: Task[]; doneTasks: Task[]; deals: Deal[]; today: string;
}) {
  const { engine: e, set, openSched } = useApp();
  const ro = !e.can('edit');
  const mayDel = (l: LogEntry) => e.can('admin') || (!ro && l.by === e.me());
  return (
    <section className="pe-card pe-tabs" aria-label="ประวัติและนัดหมาย">
      <div role="tablist" className="pe-tablist">
        {([['log', 'ประวัติการติดต่อ', contacts.length], ['tasks', 'นัดหมาย', upcoming.length], ['deals', 'ดีลใน Sales Tracker', deals.length]] as const).map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label} <span>{fmtN(n)}</span>
          </button>
        ))}
      </div>
      {tab === 'log' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!ro && <LogForm pid={p.id} taRef={logRef} />}
          {!contacts.length ? (
            <span className="pe-sub">ยังไม่มีประวัติ — กด “บันทึกการโทร” หลังคุยเสร็จ</span>
          ) : (
            <ol className="pe-tl">
              {contacts.map(({ l, key }) => {
                const ty = LOG_TYPES[l.type] || LOG_TYPES.note;
                return (
                  <li key={l.id || l.at}>
                    <span className="pe-tl-node" style={{ borderColor: ty[1] }} />
                    <div className="pe-tl-date">
                      <b>{+localDay(l.at).slice(8, 10)}</b>
                      <span>{isoTh(localDay(l.at)).replace(/^\d+\s/, '')}</span>
                    </div>
                    <div className="pe-tl-card">
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="pe-type" style={{ color: TYPE_INK[l.type] || ty[1], background: ty[1] + '14' }}>{ty[0]}</span>
                        {l.result && <span className="pe-chip">{l.result}</span>}
                        <span className="pe-sub">{dtTh(l.at).split(' ').slice(-2).join(' ')} · {l.by || 'ไม่ระบุชื่อ'}</span>
                        {mayDel(l) && <button className="pe-del" onClick={() => window.confirm('ลบรายการนี้?') && e.delLog(key, l)} aria-label="ลบรายการนี้">ลบ</button>}
                      </span>
                      {l.text && <span style={{ whiteSpace: 'pre-line' }}>{l.text}</span>}
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
            <span className="pe-sub">{c ? 'นัดของบริษัทนี้ · ที่ทำกับ ' + p.name + ' มีป้ายกำกับ' : 'เชื่อมกับบริษัทก่อนจึงนัดได้'}</span>
            {c && !ro && <button onClick={() => openSched({ ids: [c.id], pid: p.id })} style={{ ...btnOutline, height: 34 }}>+ นัดหมาย</button>}
          </div>
          {!upcoming.length && <span className="pe-sub">ยังไม่มีนัดที่จะถึง</span>}
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
          {!c && <span className="pe-sub">ยังไม่ได้เชื่อมกับบริษัท</span>}
          {c && !deals.length && (
            <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="pe-sub">บริษัทนี้ยังไม่อยู่ใน Sales Tracker</span>
              {!ro && <button onClick={() => set({ sendIds: [c.id] })} style={{ ...btnOutline, height: 34 }}>+ ส่งเข้า Sales Tracker</button>}
            </span>
          )}
          {deals.map((d) => (
            <DealMini key={d.id} d={d} p={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function SideCard({ p, c, deals, others, last, today }: { p: Person; c: Company | undefined; deals: Deal[]; others: Person[]; last: string; today: string }) {
  const { engine: e, set, open } = useApp();
  const openPerson = useOpenPerson();
  const docs = deals.flatMap((d) => docsOf(e.sales, d.id).map((doc) => ({ doc, d })));
  return (
    <section className="pe-card pe-side" aria-label="บริษัทและเอกสาร">
      <div className="pe-card-h">
        <h3>บริษัท</h3>
      </div>
      {c ? (
        <button className="pe-cobox" onClick={() => open(c.id)}>
          <CoAvatar name={c.name} web={c.web} set={c.set} size={40} />
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
            <b style={{ fontWeight: 500 }}>{c.name}</b>
            <span className="pe-sub">{c.code} · เปิดหน้าบริษัท ›</span>
          </span>
        </button>
      ) : (
        <span className="pe-sub">{p.company || 'ยังไม่ได้ระบุบริษัท'}</span>
      )}
      {others.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="pe-k">คนอื่นในบริษัทนี้</span>
          {others.slice(0, 6).map((o) => (
            <button key={o.id} className="pe-other" onClick={() => openPerson(o.id)}>
              <PersonAvatar p={o} size={28} />
              <span style={{ minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block' }}>{o.name}</span>
                <span className="pe-sub">{o.pos || '—'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="pe-card-h" style={{ marginTop: 6 }}>
        <h3>เอกสาร</h3>
        <span className="pe-sub">{fmtN(docs.length)} ไฟล์</span>
      </div>
      {!docs.length && <span className="pe-sub">ยังไม่มีเอกสาร — แนบได้ในดีลของบริษัท (Sales Tracker)</span>}
      {docs.slice(0, 8).map(({ doc, d }) => (
        <button key={d.id + doc.id} className="pe-doc" onClick={() => set({ deal: d.id })} title="เปิดดีลเพื่อดู / ดาวน์โหลดเอกสาร">
          <span className="pe-doc-ic" aria-hidden="true">{/pdf/i.test(doc.mime || doc.name) ? 'PDF' : 'IMG'}</span>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
            <span className="pe-clamp">{KIND_TH[doc.kind]}{doc.docNo ? ' ' + doc.docNo : ''}</span>
            <span className="pe-sub">{[doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : '', 'ปี ' + d.year].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
      ))}
      {last && <span className="pe-sub" style={{ marginTop: 4 }}>ติดต่อล่าสุด {ago(last, today)}</span>}
    </section>
  );
}

function NoteItem({ l, onDel }: { l: LogEntry; onDel?: () => void }) {
  return (
    <div className="pe-note">
      <span style={{ whiteSpace: 'pre-line' }}>{l.text}</span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="pe-sub">{l.by || 'ไม่ระบุชื่อ'} · {dtTh(l.at)}</span>
        {onDel && <button className="pe-del" onClick={onDel} aria-label="ลบโน้ตนี้">ลบ</button>}
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
      <button type="submit" disabled={!t.trim()} style={{ ...btnPrimary, height: 34, alignSelf: 'flex-end', opacity: t.trim() ? 1 : 0.5 }}>บันทึกโน้ต</button>
    </form>
  );
}

function LogForm({ pid, taRef }: { pid: string; taRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { engine: e } = useApp();
  const [type, setType] = useState('call');
  const [result, setResult] = useState('');
  const [text, setText] = useState('');
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    if (!text.trim() && !result) return;
    e.addPersonLog(pid, type, result, text.trim());
    setText('');
    setResult('');
  };
  return (
    <form onSubmit={save} className="pe-logform">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={type} onChange={(ev) => setType(ev.target.value)} aria-label="ประเภท" style={{ ...selectStyle, height: 34, fontSize: 13 }}>
          {CONTACT.map((k) => <option key={k} value={k}>{LOG_TYPES[k][0]}</option>)}
        </select>
        {LOG_RESULTS.map((r) => (
          <button type="button" key={r} aria-pressed={result === r} onClick={() => setResult(result === r ? '' : r)} className="pe-res">{r}</button>
        ))}
      </div>
      <textarea ref={taRef} value={text} onChange={(ev) => setText(ev.target.value)} rows={2} placeholder="คุยเรื่องอะไร ผลเป็นอย่างไร" aria-label="รายละเอียดการติดต่อ" className="pe-ta" />
      <button type="submit" disabled={!text.trim() && !result} style={{ ...btnPrimary, height: 34, alignSelf: 'flex-end', opacity: text.trim() || result ? 1 : 0.5 }}>บันทึก</button>
    </form>
  );
}

function TaskItem({ t, p, today }: { t: Task; p: Person; today: string }) {
  const { engine: e, openSched } = useApp();
  const ro = !e.can('edit');
  const ti = taskInfo(e, t);
  const ty = TT.find((x) => x[0] === t.type) || TT[0];
  const over = !t.done && t.date < today;
  const withP = t.pid === p.id;
  const other = t.pid && t.pid !== p.id ? e.people[t.pid] : undefined;
  return (
    <li className={t.done ? 'done' : ''}>
      <span className="pe-tl-node" style={{ borderColor: ty[2], background: t.done ? ty[2] : '#fff' }} />
      <div className="pe-tl-date">
        <b>{+t.date.slice(8, 10)}</b>
        <span>{isoTh(t.date).replace(/^\d+\s/, '')}</span>
      </div>
      <div className={'pe-tl-card' + (withP ? ' mine' : '')}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <DoneBox t={t} color={ty[2]} onToggle={() => !ro && e.toggleTask(t)} size={12} ro={ro} />
          <span className="pe-type" style={{ color: TYPE_INK[ty[0]] || ty[2], background: ty[2] + '14' }}>{ty[1]}</span>
          <span style={{ fontWeight: 500 }}>{t.time || 'ทั้งวัน'}</span>
          {over && <span className="pe-chip warn">เกินกำหนด</span>}
          {withP && <span className="pe-chip strong">กับ {p.name}</span>}
          {other && <span className="pe-chip">กับ {other.name}</span>}
        </span>
        {t.note && <span>{t.note}</span>}
        <span style={{ display: 'flex', gap: 12 }}>
          {!ro && <button className="pe-act" onClick={() => openSched({ taskId: t.id, ids: [t.gid] })}>เลื่อน / แก้ไข</button>}
          {!ro && <button className="pe-del" onClick={() => e.delTask(t)}>ลบนัด</button>}
          <span className="pe-sub">{ti.title}</span>
        </span>
      </div>
    </li>
  );
}

function DealMini({ d, p }: { d: Deal; p: Person }) {
  const { engine: e, set } = useApp();
  const S = e.sales;
  const tr = stageTrack(S, d, todayISO());
  const m = dealMoney(S, d);
  const mine = !!d.contactName && nameKey(d.contactName) === nameKey(p.name);
  return (
    <button className="pe-deal" onClick={() => set({ deal: d.id })}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 500 }}>ปี {d.year} · {d.section || 'ไม่ระบุหมวด'}</span>
        <span className="pe-sub">{trackerStatus(S, d)}</span>
      </span>
      <span className="pe-mini" role="img" aria-label={`ทำแล้ว ${tr.done} จาก ${tr.total} ขั้น`}>
        {S.cfg.stages.map((s) => <i key={s} className={'s-' + tr.states[s]} title={s} />)}
      </span>
      <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: '#475069' }}>
        {m.forecast != null && <span>Forecast {fmtMoney(m.forecast)}</span>}
        {m.actual != null && <span>Actual {fmtMoney(m.actual)}</span>}
        {d.resp && <span>ผู้รับผิดชอบ {d.resp}</span>}
        {mine && <span className="pe-chip strong">ผู้ติดต่อในดีลนี้</span>}
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ edit / add

function PersonEdit({ p, init, onDone }: { p: Person; init: PersonForm; onDone: () => void }) {
  const { engine: e, set } = useApp();
  const [f, setF] = useState<PersonForm>(init);
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
    const msg = [
      `ลบ "${p.name}" ออกจากรายชื่อผู้ติดต่อของทั้งทีม?`,
      atCo ? `ประวัติการติดต่อ ${fmtN(atCo)} รายการยังอยู่ในหน้าบริษัท` : '',
      own ? `ประวัติและโน้ต ${fmtN(own)} รายการที่ไม่ได้อยู่กับบริษัทใดจะถูกลบด้วย` : '',
    ].filter(Boolean).join('\n');
    if (!window.confirm(msg)) return;
    e.deletePerson(p.id);
    set({ person: null });
  };
  return (
    <form onSubmit={save} className="pe-form">
      <label style={labelCol}>ชื่อ *<input value={f.name} onChange={up('name')} required maxLength={200} style={inputStyle} /></label>
      <label style={labelCol}>ชื่อเล่น<input value={f.nick} onChange={up('nick')} maxLength={100} style={inputStyle} /></label>
      <label style={labelCol}>ตำแหน่ง<input value={f.pos} onChange={up('pos')} maxLength={200} style={inputStyle} /></label>
      <label style={labelCol}>ฝ่าย / แผนก<input value={f.dept} onChange={up('dept')} maxLength={200} style={inputStyle} /></label>
      <label style={labelCol}>
        บทบาทในการซื้อ
        <select value={f.role} onChange={up('role')} style={selectStyle}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_TH[r]}</option>)}</select>
      </label>
      <label style={labelCol}>โทรศัพท์ (หลายเบอร์คั่นด้วย |)<input value={f.phone} onChange={up('phone')} type="tel" maxLength={200} style={inputStyle} /></label>
      <label style={labelCol}>อีเมล<input value={f.email} onChange={up('email')} type="text" inputMode="email" autoComplete="off" maxLength={200} style={inputStyle} /></label>
      <label style={labelCol}>LINE ID<input value={f.line} onChange={up('line')} maxLength={100} style={inputStyle} /></label>
      <label style={labelCol}>
        ผู้ดูแล
        <select value={f.owner} onChange={up('owner')} style={selectStyle}>
          <option value="">ไม่ระบุ</option>
          {team.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label style={labelCol}>
        สถานะ
        <select value={f.status} onChange={up('status')} style={selectStyle}>
          <option value="active">ยังติดต่อได้</option>
          <option value="left">ย้ายงาน / ไม่อยู่บริษัทนี้แล้ว</option>
        </select>
      </label>
      <div style={{ gridColumn: '1 / -1' }}>
        <CompanyPicker gid={f.gid} company={f.company} onChange={(gid, company) => setF({ ...f, gid, company })} />
      </div>
      <label style={{ ...labelCol, gridColumn: '1 / -1' }}>
        ข้อมูลเพิ่มเติม
        <textarea value={f.note} onChange={up('note')} rows={3} maxLength={NOTE_CAP} placeholder="เช่น ช่วงเวลาที่สะดวก ความสนใจ" className="pe-ta" />
      </label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {e.can('delete') ? <button type="button" onClick={del} style={{ ...btnOutline, borderColor: '#E9B9AC', color: '#8A2B12', marginRight: 'auto' }}>ลบผู้ติดต่อ</button> : <span style={{ marginRight: 'auto' }} />}
        <button type="button" onClick={onDone} style={{ ...btnOutline, borderColor: '#D5DBEA', color: '#0E1430' }}>ยกเลิก</button>
        <button type="submit" style={btnPrimary}>บันทึก</button>
      </div>
    </form>
  );
}

/** Pick the company a person works at: one in the registry or added by hand, or just type its name. */
function CompanyPicker({ gid, company, onChange }: { gid: number | null; company: string; onChange: (gid: number | null, company: string) => void }) {
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
      <span style={{ fontSize: 12.5, color: '#475069' }}>บริษัท</span>
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
            style={inputStyle}
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
  const [f, setF] = useState({ name: '', pos: '', phone: '', email: '', line: '', role: '' as Person['role'], gid: c0 ? c0.id : (null as number | null), company: c0?.name || '' });
  const close = () => set({ addPerson: null });
  const up = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  // the same person already recorded at this company (name, phone or e-mail)
  const dup = useMemo(() => {
    const nk = nameKey(f.name), ph = phoneKeys(f.phone), em = f.email.trim().toLowerCase();
    if (!nk && !ph.length && !em) return undefined;
    const pool = f.gid != null ? e.peopleOf(f.gid) : Object.values(e.people).filter((p) => p.gid == null && norm(p.company) === norm(f.company));
    return pool.find((p) => (nk.length > 1 && nameKey(p.name) === nk) || phoneKeys(p.phone).some((x) => ph.includes(x)) || (!!em && p.email.trim().toLowerCase() === em));
  }, [f, e]);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!f.name.trim()) return;
    const id = e.addPerson({ ...f, name: f.name.trim() });
    if (!id) return;
    // from the People page, the new person's page opens; from a company page, it stays there
    set({ addPerson: null });
    if (ui.tab === 'people' && ui.sel == null) openPerson(id);
  };
  return (
    <Modal title="เพิ่มผู้ติดต่อ" onClose={close} width={620}>
      <form onSubmit={submit} className="pe-form">
        <label style={{ ...labelCol, gridColumn: '1 / -1' }}>ชื่อ *<input value={f.name} onChange={up('name')} required autoFocus maxLength={200} placeholder="เช่น คุณสมชาย ใจดี" style={inputStyle} /></label>
        <div style={{ gridColumn: '1 / -1' }}>
          <CompanyPicker gid={f.gid} company={f.company} onChange={(gid, company) => setF({ ...f, gid, company })} />
        </div>
        <label style={labelCol}>ตำแหน่ง<input value={f.pos} onChange={up('pos')} maxLength={200} placeholder="เช่น ผู้จัดการฝ่ายจัดซื้อ" style={inputStyle} /></label>
        <label style={labelCol}>
          บทบาทในการซื้อ
          <select value={f.role} onChange={up('role')} style={selectStyle}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_TH[r]}</option>)}</select>
        </label>
        <label style={labelCol}>โทรศัพท์<input value={f.phone} onChange={up('phone')} type="tel" maxLength={200} style={inputStyle} /></label>
        <label style={labelCol}>อีเมล<input value={f.email} onChange={up('email')} type="text" inputMode="email" autoComplete="off" maxLength={200} style={inputStyle} /></label>
        <label style={labelCol}>LINE ID<input value={f.line} onChange={up('line')} maxLength={100} style={inputStyle} /></label>
        {dup && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Notice kind="error" role="status">
              มีผู้ติดต่อที่อาจเป็นคนเดียวกันแล้ว: <b style={{ fontWeight: 600 }}>{dup.name}</b>{dup.pos ? ' · ' + dup.pos : ''}{' '}
              <button type="button" className="pe-act" onClick={() => (set({ addPerson: null }), openPerson(dup.id))}>เปิดดู</button>
            </Notice>
          </div>
        )}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={close} style={{ ...btnOutline, borderColor: '#D5DBEA', color: '#0E1430' }}>ยกเลิก</button>
          <button type="submit" style={btnPrimary}>เพิ่มผู้ติดต่อ</button>
        </div>
      </form>
    </Modal>
  );
}

/** A company's people, on its page (CompanyDrawer). */
export function CompanyPeople({ c }: { c: Company }) {
  const { engine: e, set } = useApp();
  const openPerson = useOpenPerson();
  const list = e.peopleOf(c.id).sort((a, b) => (a.status === 'left' ? 1 : 0) - (b.status === 'left' ? 1 : 0) || a.name.localeCompare(b.name, 'th'));
  const box: CSSProperties = { background: '#fff', border: '1px solid #E3E7F1', borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 };
  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1F5BD8' }}>ผู้ติดต่อ{list.length ? ` (${fmtN(list.length)})` : ''}</span>
        {e.can('edit') && <button onClick={() => set({ addPerson: { gid: c.id } })} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#1F5BD8', fontSize: 13, textDecoration: 'underline' }}>+ เพิ่มผู้ติดต่อ</button>}
      </div>
      {!list.length && <span style={{ fontSize: 13, color: '#475069' }}>ยังไม่มี — บันทึกคนที่คุยด้วย เพื่อเก็บเบอร์ ตำแหน่ง และประวัติของแต่ละคน</span>}
      {list.map((p) => (
        <button key={p.id} className="pe-other" onClick={() => openPerson(p.id)}>
          <PersonAvatar p={p} size={32} />
          <span style={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
            <span style={{ display: 'block' }}>{p.name}{p.status === 'left' ? ' (ย้ายงานแล้ว)' : ''}</span>
            <span className="pe-sub">{[p.pos, phones(p.phone)[0]].filter(Boolean).join(' · ') || '—'}</span>
          </span>
          <span aria-hidden="true" style={{ color: '#8A93AD' }}>›</span>
        </button>
      ))}
    </div>
  );
}
