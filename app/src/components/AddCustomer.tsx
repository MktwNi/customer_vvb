import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useApp, useEngineVersion, type ToastAct } from '../state';
import { beYear } from '../lib/sales';
import type { Company } from '../lib/types';
import { Modal } from './Dialog';
import { Notice, labelCol } from './ui';
import { ReadOnly } from './ReadOnly';
import { SelField, type SelOpt } from './Select';
import { customersOf, jobServices, jointRole, payerDeal } from '../lib/sales';
import { fmtN, todayISO } from '../lib/format';
import { BIG, TRACKER_MAX, followedLeftWord, followedMoreWord, trackerCapWord, trackerNote, trackerWarn } from '../lib/bulk';
import { followRows } from '../lib/follow';
import { useSalesActs } from './SalesToast';
import { SECTION_LABEL, clashing, rowPick, sendState, svcText, type SendState } from '../lib/jobs';
import { JobSvc, SvcPick } from './SvcChips';
import { jobWord } from './DealSvc';

/** The บริการ picker's line under it: one job carries what one quotation offers. */
const SVC_HINT = 'เลือกได้หลายบริการ ถ้าเสนอในใบเสนอราคาเดียวกัน ถ้าแยกใบ ส่งทีละบริการ';
const SVC_HINT_ADD = 'เลือกได้หลายบริการ ถ้าเสนอในใบเสนอราคาเดียวกัน';
const SVC_HINT_NONE = 'ยังไม่ได้เลือก บริษัทที่มีงานปีนี้แล้วจะไม่ถูกติ๊กไว้ เพราะยังแยกไม่ได้ว่าเป็นงานใหม่หรือไม่ · เลือกบริการภายหลังได้ที่หน้ารายละเอียดของงาน';
/** The years the dialogs offer: this one, next year, and the one shown. */
const yearOpts = (year: string) => [...new Set([beYear(), String(+beYear() + 1), year])].sort().map((y) => ({ v: y, label: y }));

/** The หมวด choices with how many of the year's customers each has ("4 ราย"): a joint quotation's header is
 *  not one, its members count in the header's หมวด (where the table draws them), as the table counts them. */
function sectionOpts(e: ReturnType<typeof useApp>['engine'], year: string): SelOpt[] {
  const n = new Map<string, number>(), S = e.sales;
  customersOf(S, Object.values(S.deals).filter((d) => d.year === year)).forEach((d) => {
    const sec = payerDeal(S, d).section;
    n.set(sec, (n.get(sec) || 0) + 1);
  });
  return e.sales.cfg.sections.map((x) => ({ v: x, label: x, n: n.get(x) ? `${n.get(x)} ราย` : undefined }));
}

const EMPTY = { name: '', jur: '', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' };
const RO_NOTE = 'บัญชีนี้ดูข้อมูลได้ แต่แก้ไขไม่ได้';

/**
 * Add a customer that is not in the registry (or edit one added by hand). Similar registry companies are
 * suggested first so the team doesn't create duplicates. Opened from the Sales Tracker it also starts a
 * deal; opened from a deal it links that deal to the new customer.
 */
export function AddCustomer() {
  const { engine: e, ui, set } = useApp();
  const ver = useEngineVersion();
  const a = ui.addCust!;
  const edit = a.edit != null ? e.custom[a.edit] : undefined;
  const [f, setF] = useState({ ...EMPTY, ...(edit || {}), name: edit?.name ?? a.name ?? '' });
  // the values the dialog opened with: saving an edit writes only what was changed here, so a
  // teammate's change to another field while it was open is kept
  const [init] = useState(f);
  const [section, setSection] = useState(a.section ?? e.sales.cfg.sections[0] ?? '');
  // the job's year and services (เพิ่มลูกค้า into the Sales Tracker)
  const [year, setYear] = useState(ui.slYear || beYear());
  const [svc, setSvc] = useState<string[]>([]);
  const [err, setErr] = useState('');
  // the four fields needed on day one first; the rest fold (open when editing, or one already has a value)
  const [moreOpen, setMoreOpen] = useState(() => !!edit && (['jur', 'prov', 'ind', 'biz', 'web', 'addr', 'note'] as const).some((k) => !!f[k]));
  const [similar, setSimilar] = useState<Company[]>([]);
  const D = e.B.D;
  // an account that may not add customers has no way here; should it get here anyway, nothing can be saved
  const ro = !e.can('edit.cust');
  const provs = useMemo(() => D.prov.filter(Boolean).slice().sort((x, y) => x.localeCompare(y, 'th')), [D]);
  const close = () => set({ addCust: null });
  // teammates' latest first: a customer one of them added a moment ago is then suggested below
  useEffect(() => {
    if (!edit) void e.teamSyncNow();
  }, [e, edit]);
  useEffect(() => {
    if (edit) return;
    const t = setTimeout(() => setSimilar(e.similarCompanies(f.name, f.jur)), 300);
    return () => clearTimeout(t);
  }, [f.name, f.jur, e, edit, ver]);
  const up = (k: keyof typeof EMPTY) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });

  /** The contact typed here (name, phone, e-mail as typed; '' each when nothing was). */
  const typed = { name: f.contact.trim(), phone: f.phone.trim(), email: f.email.trim() };
  /** The deal's contact from what was typed: the person of its company with that name, else a new one in
   *  ผู้ติดต่อ with the phone and e-mail typed beside it (typed once, linked everywhere). */
  const takeContact = (dealId: string) => {
    const d = e.sales.deals[dealId];
    if (typed.name && d && e.canLink(d)) e.saveTypedContact(dealId, typed);
  };
  /** Use an existing company instead of adding a new one. */
  const useExisting = (c: Company) => {
    if (a.link) {
      e.updateDeal(a.link, { gid: c.id });
      takeContact(a.link);
    }
    if (a.deal) {
      // the company's job of the year that this may be (lib/jobs.ts: of a service picked here, or any job when
      // none is picked or it lists none) is opened; a job of other services gets this one beside it (a joint
      // quotation's header is the payer's row for that quotation, not the company's own row)
      const jobs = e.dealsOf(c.id).filter((x) => x.year === year && jointRole(e.sales, x) !== 'header');
      const old = clashing(e.sales, svc, jobs)[0];
      // a new row carries what was typed (a tab on an older build reads it there); a contact typed is its contact,
      // else the company's one person on record, if it has one (addDeal: never someone else than what was typed)
      const d =
        old ||
        e.addDeal(
          { gid: c.id, section, year, ...(svc.length ? { service: svc.slice() } : {}), ...(typed.name ? { contactName: typed.name } : {}), ...(typed.phone ? { phone: typed.phone } : {}), ...(typed.email ? { email: typed.email } : {}) },
          undefined,
          typed.name ? {} : { contact: '' },
        );
      takeContact(d.id);
      set({ addCust: null, deal: d.id, slYear: year });
    } else if (a.link) set({ addCust: null });
    else set({ addCust: null, sel: c.id, dTab: 'info' });
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (ro) return;
    if (!f.name.trim()) {
      setErr('กรุณาใส่ชื่อบริษัท / ลูกค้า');
      return;
    }
    if (edit) {
      e.updateCustomer(edit.id, Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== init[k as keyof typeof init])));
      close();
      return;
    }
    const id = e.addCustomer(f);
    if (a.link) {
      e.updateDeal(a.link, { gid: id });
      takeContact(a.link);
    }
    if (a.deal) {
      const d = e.addDeal({ gid: id, section, year, ...(svc.length ? { service: svc.slice() } : {}) });
      // the contact typed here is a person (ผู้ติดต่อ), with the phone and e-mail typed beside it, and the deal's
      // contact: typed once, linked everywhere
      takeContact(d.id);
      set({ addCust: null, deal: d.id, slYear: year });
    } else if (a.link) set({ addCust: null });
    else set({ addCust: null, sel: id, dTab: 'info' });
  };

  return (
    <Modal title={edit ? 'แก้ไขข้อมูลลูกค้าที่เพิ่มเอง' : 'เพิ่มลูกค้าใหม่ (ไม่มีในทะเบียน)'} onClose={close} width={640}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ro && <Notice kind="info">{RO_NOTE}</Notice>}
        <ReadOnly ro={ro}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 10 }}>
          <label style={{ ...labelCol, gridColumn: '1 / -1' }}>
            ชื่อบริษัท / ลูกค้า *
            <input value={f.name} onChange={up('name')} autoFocus required maxLength={200} placeholder="เช่น บริษัท ตัวอย่าง จำกัด" className="fld" />
          </label>
          {/* right under the name, where it is seen while typing (on a phone the rest of the form is below the fold) */}
          {similar.length > 0 && (
            <div style={{ gridColumn: '1 / -1', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="t-warn" style={{ fontSize: 13 }}>พบบริษัทที่คล้ายกันในทะเบียน ใช้บริษัทเดิมเพื่อไม่ให้ข้อมูลซ้ำ</span>
              {similar.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 14 }}>
                  <span>
                    {c.name} <span className="t-meta">· {c.code}{c.jur ? ' · ' + c.jur : ''} · {D.prov[c.prov] || 'ไม่ระบุจังหวัด'}</span>
                  </span>
                  <button type="button" onClick={() => useExisting(c)} className="btn xs">ใช้บริษัทนี้</button>
                </div>
              ))}
            </div>
          )}
          {/* the job in the Sales Tracker: หมวด and ปี on one row, then บริการ (as the send dialog) */}
          {a.deal && !edit && (
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px', gap: 10 }}>
              <SelField style={{ ...labelCol, minWidth: 0 }} text={SECTION_LABEL} value={section} onChange={setSection} options={sectionOpts(e, year)} width={320} />
              <SelField style={labelCol} text="ปี (พ.ศ.)" value={year} onChange={setYear} options={yearOpts(year)} />
            </div>
          )}
          {a.deal && !edit && (
            <div style={{ ...labelCol, gridColumn: '1 / -1' }}>
              <span id="ac-svc">บริการ</span>
              <SvcPick all={e.sales.cfg.services} value={svc} onChange={setSvc} />
              <small className="t-meta">{SVC_HINT_ADD}</small>
            </div>
          )}
          <label style={labelCol}>ผู้ติดต่อ<input value={f.contact} onChange={up('contact')} className="fld" /></label>
          <label style={labelCol}>เบอร์โทร<input value={f.phone} onChange={up('phone')} type="tel" className="fld" /></label>
          <label style={labelCol}>อีเมล<input value={f.email} onChange={up('email')} type="email" className="fld" /></label>
        </div>
        <details className="upd-more" open={moreOpen} onToggle={(ev) => setMoreOpen((ev.currentTarget as HTMLDetailsElement).open)}>
          <summary className="lnk">ข้อมูลบริษัท (ไม่บังคับ)</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 10, paddingTop: 10 }}>
          <label style={labelCol}>เลขนิติบุคคล (13 หลัก)<input value={f.jur} onChange={up('jur')} inputMode="numeric" maxLength={20} className="fld" /></label>
          <SelField style={labelCol} text="จังหวัด" value={f.prov} onChange={(v) => setF({ ...f, prov: v })} search options={[{ v: '', label: 'ไม่ระบุ' }, ...provs.map((p) => ({ v: p, label: p }))]} />
          <SelField style={labelCol} text="กลุ่มอุตสาหกรรม" value={f.ind} onChange={(v) => setF({ ...f, ind: v })} search options={[{ v: '', label: 'ไม่ระบุ' }, ...D.ind.filter((x) => x && x !== 'ไม่ระบุ').map((x) => ({ v: x, label: x }))]} />
          <label style={labelCol}>ประกอบกิจการ<input value={f.biz} onChange={up('biz')} className="fld" /></label>
          <label style={labelCol}>เว็บไซต์<input value={f.web} onChange={up('web')} className="fld" /></label>
          <label style={{ ...labelCol, gridColumn: '1 / -1' }}>ที่อยู่<input value={f.addr} onChange={up('addr')} className="fld" /></label>
          <label style={{ ...labelCol, gridColumn: '1 / -1' }}>หมายเหตุ<textarea value={f.note} onChange={up('note')} rows={2} className="fld" style={{ height: 'auto', padding: 10, resize: 'vertical' }} /></label>
          </div>
        </details>
        </ReadOnly>
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        <span className="t-meta">ค้นหา ติดตาม นัด และบันทึกการติดต่อได้เหมือนบริษัทในทะเบียน ทั้งทีมเห็นด้วย</span>
        <div className="dlg-act">
          {edit && e.can('del.rec') && (
            <button type="button" onClick={() => { if (window.confirm(`ลบ "${edit.name}" ออกจากรายชื่อลูกค้า?`)) { e.deleteCustomer(edit.id); set({ addCust: null, sel: null }); } }} className="quiet" style={{ marginRight: 'auto' }}>
              ลบลูกค้านี้
            </button>
          )}
          <button type="button" onClick={close} className="quiet">ยกเลิก</button>
          {!ro && <button type="submit" className="btn pri">{edit ? 'บันทึก' : a.deal ? 'เพิ่มลูกค้าและเข้า Sales Tracker' : 'เพิ่มลูกค้า'}</button>}
        </div>
      </form>
    </Modal>
  );
}

/** How many companies the list shows at first: a selection of thousands (the search page) lists the rest
 *  on request, so the dialog opens at once. */
const LIST_FIRST = 150;

/**
 * Send companies (one from its page, the starred ones, or the search page's selection) to the Sales Tracker: one
 * job each, under the หมวด (the channel the customer came from) and the year, with the services picked (one job
 * quoted together). A company that already has jobs that year is never locked: its jobs are said on its row, and
 * whether this is a new job (its services and the picked ones are named and share none: ticked) or may repeat one
 * (not ticked, "อาจซ้ำ": tick it if it is other work) is the row's own (lib/jobs.ts sendState, rowPick).
 */
export function SendToTracker() {
  const { engine: e, ui, set } = useApp();
  const ver = useEngineVersion();
  const { say } = useSalesActs();
  // teammates' latest first: a company one of them sent a moment ago shows its job
  useEffect(() => void e.teamSyncNow(), [e]);
  const ro = !e.can('edit.deal');
  const S = e.sales;
  const cos = useMemo(() => (ui.sendIds || []).map((id) => e.company(id)).filter(Boolean) as Company[], [ui.sendIds, e, ver]);
  // opened from a person's page: that person is the deal's contact
  const from = ui.sendPid && e.can('edit.cust') ? e.people[ui.sendPid] : undefined;
  // the person's own ticks, with the row's state when they made them: kept when the services change
  const [mine, setMine] = useState<Record<number, { on: boolean; st: SendState }>>({});
  // several companies: by default each goes to the section of where it was found (TGO, SET/mai…)
  const AUTO = '\u0000auto';
  const [section, setSection] = useState(() => (cos.length > 1 ? AUTO : e.suggestSection(cos[0]) || e.sales.cfg.sections[0] || ''));
  const [year, setYear] = useState(ui.slYear || beYear());
  const [svc, setSvc] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const close = () => set({ sendIds: null });
  // the year's jobs once, not once per company
  const jobsOf = useMemo(() => e.jobsIn(year), [e, year, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(
    () =>
      cos.map((c) => {
        const jobs = jobsOf(c);
        const st = sendState(svc, jobs.map((d) => jobServices(S, d)));
        return { c, jobs, st, ...rowPick(st, mine[c.id]) };
      }),
    [cos, jobsOf, svc, mine, S],
  );
  const chosen = rows.filter((r) => r.on);
  const toAdd = chosen.length;
  const inYear = rows.filter((r) => r.jobs.length).length;
  const dupOff = rows.filter((r) => r.st === 'dup' && !r.on).length;
  // one send adds at most TRACKER_MAX rows (the table draws its whole year for every teammate)
  const over = toAdd > TRACKER_MAX;
  const team = !!e.teamCfg;
  const shown = all ? rows : rows.slice(0, LIST_FIRST);
  const one = rows.length === 1 ? rows[0] : null;
  // one company that may repeat a job, not ticked: the button opens that job instead
  const clash = one && one.st === 'dup' ? clashing(S, svc, one.jobs) : [];
  const openJob = (id: string) => set({ sendIds: null, sel: null, deal: id, slYear: year });
  const send = () => {
    if (over) return;
    const r = e.addDealsFromCompanies(chosen.map((x) => x.c.id), {
      ...(section === AUTO ? {} : { section }), year, pid: ui.sendPid, service: svc, force: chosen.filter((x) => x.force).map((x) => x.c.id),
    });
    const note = trackerNote(r.added, r.skipped, year, svcText(svc));
    if (ui.sendStay) {
      // from the search page's selection: stay there, say what was sent, link to the table; an account
      // that may delete deals can take the rows back (เลิกทำ, 10 minutes: engine.undoSent)
      set({ sendIds: null });
      const acts: ToastAct[] = r.added ? [{ label: `ดูตารางปี ${year}`, act: 'goSales', year, primary: true }] : [];
      if (r.added && e.can('del.rec')) acts.push({ label: 'เลิกทำ', act: 'sendUndo', k: r.k });
      say(note, { ms: acts.length > 1 ? 12000 : 8000, acts: acts.length ? acts : undefined });
      return;
    }
    if (cos.length === 1) {
      // the new job; skipped (a teammate's job of this service arrived meanwhile): that job, and why
      const id = r.ids[0] || clashing(S, svc, jobsOf(cos[0]))[0]?.id || null;
      if (!r.added) say(note, { ms: 8000 });
      set({ sendIds: null, sel: null, deal: id, slYear: year });
    } else {
      // a batch of the followed companies (ui.sendMore: opened with more left over): say how many still wait
      const left = ui.sendMore > 0 ? followRows(e, year, todayISO()).filter((x) => !x.deal).length : 0;
      set({ sendIds: null, sel: null, tab: 'sales', slView: 'table', slYear: year, slNote: note + followedLeftWord(left, year) });
    }
  };
  const tick = (id: number, st: SendState, on: boolean) => setMine((m) => ({ ...m, [id]: { on, st } }));
  /** The line about a company's jobs this year: "มีงานปี 2569: CFO · กำลังดำเนินการ", two jobs, then "อีก N งาน". */
  const jobsLine = (r: (typeof rows)[number]) => {
    if (one && r.st === 'dup' && clash.length) {
      const d = clash[0];
      return (
        <>
          <span className="sv-sub">
            มีงาน <JobSvc svc={jobServices(S, d)} /> ปี {year} อยู่แล้ว · {jobWord(S, d)} ·{' '}
            <button type="button" className="lnk" onClick={() => openJob(d.id)}>เปิดงานเดิม</button>
          </span>
          {!r.on && <span className="sv-sub t-muted">ถ้าเป็นคนละงาน ติ๊กเพื่อเพิ่มอีกงาน</span>}
        </>
      );
    }
    return (
      <span className="sv-sub">
        มีงานปี {year}:{' '}
        {r.jobs.slice(0, 2).map((d, i) => (
          <span key={d.id} className="sv-job">
            {i > 0 && ' · '}
            <JobSvc svc={jobServices(S, d)} /> {jobWord(S, d)}
          </span>
        ))}
        {r.jobs.length > 2 && ` · อีก ${fmtN(r.jobs.length - 2)} งาน`}
      </span>
    );
  };
  const meta = [
    `${fmtN(cos.length)} บริษัท`,
    inYear ? `มีงานปี ${year} แล้ว ${fmtN(inYear)} บริษัท` : '',
    dupOff ? (svc.length ? `อาจซ้ำ ${fmtN(dupOff)} บริษัท ไม่ได้ติ๊กไว้ ติ๊กได้ถ้าเป็นคนละงาน` : `${fmtN(dupOff)} บริษัทไม่ได้ติ๊กไว้ เลือกบริการด้านบนเพื่อแยกงาน`) : '',
    // the first TRACKER_MAX of the followed companies (บริษัทที่ติดตาม's ส่งเข้า Sales Tracker ทั้งหมด)
    ui.sendMore > 0 ? followedMoreWord(ui.sendMore) : '',
  ].filter(Boolean).join(' · ');
  return (
    <Modal title="ส่งเข้า Sales Tracker" onClose={close} width={560}>
      {ro ? <Notice kind="info">{RO_NOTE}</Notice> : <span className="t-sec">ชื่อบริษัท เบอร์ อีเมล และผู้รับผิดชอบจะถูกกรอกให้อัตโนมัติ · {from ? `ผู้ติดต่อของดีลคือ ${from.name}` : <>บริษัทที่มีผู้ติดต่อในรายชื่อคนเดียว จะใช้คนนั้นเป็นผู้ติดต่อ<span className="dc-nw">ของดีล</span></>}</span>}
      {/* many at once: how many rows the team's table gets, before sending */}
      {!ro && (over ? <Notice kind="warn">{trackerCapWord(toAdd, team)}</Notice> : toAdd > BIG && <Notice kind="warn">{trackerWarn(toAdd, year, team)}</Notice>)}
      <ReadOnly ro={ro} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* (minmax: the long "อัตโนมัติ — …" choice must not widen the column past the dialog) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px', gap: 10 }}>
        <SelField
          style={{ ...labelCol, minWidth: 0 }}
          text={SECTION_LABEL}
          value={section}
          onChange={setSection}
          options={[...(cos.length > 1 ? [{ v: AUTO, label: 'อัตโนมัติ', sub: 'ตามแหล่งที่พบ (TGO / SET/mai)' }] : []), ...sectionOpts(e, year)]}
          width={320}
        />
        <SelField style={labelCol} text="ปี (พ.ศ.)" value={year} onChange={setYear} options={yearOpts(year)} />
      </div>
      <div style={labelCol}>
        <span>บริการ</span>
        <SvcPick all={e.sales.cfg.services} value={svc} onChange={setSvc} />
        <small className="t-meta">{!svc.length && inYear ? SVC_HINT_NONE : SVC_HINT}</small>
      </div>
      {cos.length > 1 && <span className="t-sec">{meta}</span>}
      <div className="sv-rows">
        {shown.map((r) => (
          <label key={r.c.id} className="sv-row hv">
            <input type="checkbox" checked={r.on} onChange={(ev) => tick(r.c.id, r.st, ev.target.checked)} style={{ accentColor: 'var(--brand)' }} />
            <span className="sv-n">
              <span>{r.c.name}</span>
              {r.jobs.length > 0 && jobsLine(r)}
            </span>
            <span className="sv-tag">
              {r.st === 'new' ? <span className="chip info">เพิ่มเป็นงานใหม่</span> : r.st === 'dup' ? <span className="chip warn">อาจซ้ำ</span> : <span className="t-meta">{r.c.phone || 'ยังไม่มีเบอร์'}</span>}
            </span>
          </label>
        ))}
        {shown.length < rows.length && (
          <button type="button" className="lnk" style={{ alignSelf: 'flex-start', fontSize: 13, padding: '8px 4px', borderTop: '1px solid var(--divider)' }} onClick={() => setAll(true)}>
            {`แสดงอีก ${fmtN(rows.length - shown.length)} บริษัท`}
          </button>
        )}
      </div>
      </ReadOnly>
      <div className="dlg-act">
        <button onClick={close} className="quiet">ยกเลิก</button>
        {!ro && toAdd > 0 && !over && <button onClick={send} className="btn pri">ส่ง {fmtN(toAdd)} รายการ</button>}
        {!ro && !toAdd && clash.length > 0 && (
          <button onClick={() => openJob(clash[0].id)} className="btn pri">{`เปิดงาน${svcText(jobServices(S, clash[0])) ? ' ' + svcText(jobServices(S, clash[0])) + ' ' : ''}เดิม`}</button>
        )}
      </div>
    </Modal>
  );
}
