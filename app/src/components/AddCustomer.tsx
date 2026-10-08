import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useApp, useEngineVersion } from '../state';
import { beYear } from '../lib/sales';
import type { Company } from '../lib/types';
import { Modal } from './Dialog';
import { Notice, labelCol } from './ui';
import { ReadOnly } from './ReadOnly';

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
  const [err, setErr] = useState('');
  // the four fields needed on day one first; the rest fold (open when editing, or one already has a value)
  const [moreOpen, setMoreOpen] = useState(() => !!edit && (['jur', 'prov', 'ind', 'biz', 'web', 'addr', 'note'] as const).some((k) => !!f[k]));
  const [similar, setSimilar] = useState<Company[]>([]);
  const D = e.B.D;
  // an account that can only read has no way here; should it get here anyway, nothing can be saved
  const ro = !e.can('edit');
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

  /** Use an existing company instead of adding a new one. */
  const useExisting = (c: Company) => {
    if (a.link) e.updateDeal(a.link, { gid: c.id });
    if (a.deal) {
      const d = e.dealsOf(c.id).find((x) => x.year === ui.slYear) || e.addDeal({ gid: c.id, section, year: ui.slYear });
      set({ addCust: null, deal: d.id });
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
    if (a.link) e.updateDeal(a.link, { gid: id });
    if (a.deal) {
      const d = e.addDeal({ gid: id, section, year: ui.slYear || beYear() });
      set({ addCust: null, deal: d.id });
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
          {a.deal && !edit && (
            <label style={labelCol}>
              หมวดใน Sales Tracker
              <select value={section} onChange={(ev) => setSection(ev.target.value)} className="fld sel">
                {e.sales.cfg.sections.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          )}
          <label style={labelCol}>ผู้ติดต่อ<input value={f.contact} onChange={up('contact')} className="fld" /></label>
          <label style={labelCol}>เบอร์โทร<input value={f.phone} onChange={up('phone')} type="tel" className="fld" /></label>
          <label style={labelCol}>อีเมล<input value={f.email} onChange={up('email')} type="email" className="fld" /></label>
        </div>
        <details className="upd-more" open={moreOpen} onToggle={(ev) => setMoreOpen((ev.currentTarget as HTMLDetailsElement).open)}>
          <summary className="lnk">ข้อมูลบริษัท (ไม่บังคับ)</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 10, paddingTop: 10 }}>
          <label style={labelCol}>เลขนิติบุคคล (13 หลัก)<input value={f.jur} onChange={up('jur')} inputMode="numeric" maxLength={20} className="fld" /></label>
          <label style={labelCol}>
            จังหวัด
            <select value={f.prov} onChange={up('prov')} className="fld sel">
              <option value="">ไม่ระบุ</option>
              {provs.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label style={labelCol}>
            กลุ่มอุตสาหกรรม
            <select value={f.ind} onChange={up('ind')} className="fld sel">
              <option value="">ไม่ระบุ</option>
              {D.ind.filter((x) => x && x !== 'ไม่ระบุ').map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
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
          {edit && e.can('delete') && (
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

/** Send companies (one from its page, or the starred ones) to the Sales Tracker. */
export function SendToTracker() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  // teammates' latest first: a company one of them sent a moment ago shows as already in the table
  useEffect(() => void e.teamSyncNow(), [e]);
  const ro = !e.can('edit');
  const ids = ui.sendIds || [];
  const cos = ids.map((id) => e.company(id)).filter(Boolean) as Company[];
  const [pick, setPick] = useState<Record<number, boolean>>(() => Object.fromEntries(cos.map((c) => [c.id, true])));
  // several companies: by default each goes to the section of where it was found (TGO, SET/mai…)
  const AUTO = '\u0000auto';
  const [section, setSection] = useState(() => (cos.length > 1 ? AUTO : e.suggestSection(cos[0]) || e.sales.cfg.sections[0] || ''));
  const [year, setYear] = useState(ui.slYear || beYear());
  const close = () => set({ sendIds: null });
  const chosen = cos.filter((c) => pick[c.id]);
  const has = (c: Company) => e.dealsOf(c.id).some((d) => d.year === year);
  const send = () => {
    const r = e.addDealsFromCompanies(chosen.map((c) => c.id), section === AUTO ? { year } : { section, year });
    const note = `ส่งเข้า Sales Tracker แล้ว ${r.added} ราย${r.skipped ? ` (ข้าม ${r.skipped} รายที่มีในตารางปี ${year} แล้ว)` : ''}`;
    if (cos.length === 1) {
      const d = e.dealsOf(cos[0].id).find((x) => x.year === year);
      set({ sendIds: null, sel: null, deal: d ? d.id : null, slYear: year });
    } else {
      set({ sendIds: null, sel: null, tab: 'sales', slView: 'table', slYear: year, slNote: note });
    }
  };
  const years = [...new Set([beYear(), String(+beYear() + 1), year])].sort();
  return (
    <Modal title="ส่งเข้า Sales Tracker" onClose={close} width={560}>
      {ro ? <Notice kind="info">{RO_NOTE}</Notice> : <span className="t-sec">ชื่อบริษัท เบอร์ อีเมล และผู้รับผิดชอบจะถูกกรอกให้อัตโนมัติ</span>}
      <ReadOnly ro={ro} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
        <label style={labelCol}>
          หมวด
          <select value={section} onChange={(ev) => setSection(ev.target.value)} className="fld sel">
            {cos.length > 1 && <option value={AUTO}>อัตโนมัติ — ตามแหล่งที่พบ (TGO / SET/mai)</option>}
            {e.sales.cfg.sections.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label style={labelCol}>
          ปี (พ.ศ.)
          <select value={year} onChange={(ev) => setYear(ev.target.value)} className="fld sel">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
        {cos.map((c) => (
          <label key={c.id} className={has(c) ? undefined : 'hv'} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, padding: '6px 4px', borderTop: '1px solid var(--divider)', cursor: has(c) ? 'default' : 'pointer', color: has(c) ? 'var(--muted)' : undefined }}>
            <input type="checkbox" checked={!!pick[c.id] && !has(c)} disabled={has(c)} onChange={(ev) => setPick({ ...pick, [c.id]: ev.target.checked })} style={{ accentColor: 'var(--brand)' }} />
            <span style={{ flex: 1 }}>{c.name}</span>
            <span className="t-meta">{has(c) ? `มีในตารางปี ${year} แล้ว` : c.phone || 'ยังไม่มีเบอร์'}</span>
          </label>
        ))}
      </div>
      </ReadOnly>
      <div className="dlg-act">
        <button onClick={close} className="quiet">ยกเลิก</button>
        {!ro && chosen.some((c) => !has(c)) && <button onClick={send} className="btn pri">
          ส่ง {chosen.filter((c) => !has(c)).length} รายการ
        </button>}
      </div>
    </Modal>
  );
}
