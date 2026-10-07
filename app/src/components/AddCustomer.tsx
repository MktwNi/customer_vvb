import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useApp, useEngineVersion } from '../state';
import { beYear } from '../lib/sales';
import type { Company } from '../lib/types';
import { Modal } from '../tabs/Sales';
import { Notice, inputStyle, labelCol, selectStyle } from './ui';

const small: CSSProperties = { cursor: 'pointer', height: 36, padding: '0 14px', borderRadius: 999, border: '1.5px solid #D5DBEA', background: '#fff', color: '#0E1430', fontSize: 13 };
const EMPTY = { name: '', jur: '', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' };

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
  const [similar, setSimilar] = useState<Company[]>([]);
  const D = e.B.D;
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 10 }}>
          <label style={{ ...labelCol, gridColumn: '1 / -1' }}>
            ชื่อบริษัท / ลูกค้า *
            <input value={f.name} onChange={up('name')} autoFocus required maxLength={200} placeholder="เช่น บริษัท ตัวอย่าง จำกัด" style={inputStyle} />
          </label>
          {/* right under the name, where it is seen while typing (on a phone the rest of the form is below the fold) */}
          {similar.length > 0 && (
            <div style={{ gridColumn: '1 / -1', background: '#FFF4DC', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13.5, color: '#6B4100' }}>พบบริษัทที่คล้ายกันในทะเบียนแล้ว — ใช้บริษัทเดิมเพื่อไม่ให้ข้อมูลซ้ำ</span>
              {similar.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 13.5 }}>
                  <span>
                    {c.name} <span style={{ color: '#6B4100', fontSize: 12 }}>· {c.code}{c.jur ? ' · ' + c.jur : ''} · {D.prov[c.prov] || 'ไม่ระบุจังหวัด'}</span>
                  </span>
                  <button type="button" onClick={() => useExisting(c)} style={{ ...small, height: 30 }}>ใช้บริษัทนี้</button>
                </div>
              ))}
            </div>
          )}
          <label style={labelCol}>เลขนิติบุคคล (13 หลัก)<input value={f.jur} onChange={up('jur')} inputMode="numeric" maxLength={20} style={inputStyle} /></label>
          <label style={labelCol}>ผู้ติดต่อ<input value={f.contact} onChange={up('contact')} style={inputStyle} /></label>
          <label style={labelCol}>เบอร์โทร<input value={f.phone} onChange={up('phone')} type="tel" style={inputStyle} /></label>
          <label style={labelCol}>อีเมล<input value={f.email} onChange={up('email')} type="email" style={inputStyle} /></label>
          <label style={labelCol}>
            จังหวัด
            <select value={f.prov} onChange={up('prov')} style={selectStyle}>
              <option value="">ไม่ระบุ</option>
              {provs.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label style={labelCol}>
            กลุ่มอุตสาหกรรม
            <select value={f.ind} onChange={up('ind')} style={selectStyle}>
              <option value="">ไม่ระบุ</option>
              {D.ind.filter((x) => x && x !== 'ไม่ระบุ').map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label style={labelCol}>ประกอบกิจการ<input value={f.biz} onChange={up('biz')} style={inputStyle} /></label>
          <label style={labelCol}>เว็บไซต์<input value={f.web} onChange={up('web')} style={inputStyle} /></label>
          <label style={{ ...labelCol, gridColumn: '1 / -1' }}>ที่อยู่<input value={f.addr} onChange={up('addr')} style={inputStyle} /></label>
          <label style={{ ...labelCol, gridColumn: '1 / -1' }}>หมายเหตุ<textarea value={f.note} onChange={up('note')} rows={2} style={{ ...inputStyle, height: 'auto', padding: 10, resize: 'vertical' }} /></label>
          {a.deal && !edit && (
            <label style={labelCol}>
              เพิ่มเข้า Sales Tracker ในหมวด
              <select value={section} onChange={(ev) => setSection(ev.target.value)} style={selectStyle}>
                {e.sales.cfg.sections.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          )}
        </div>
        {err && <Notice kind="error" role="alert">{err}</Notice>}
        <span style={{ fontSize: 12, color: '#5E6680' }}>ลูกค้าที่เพิ่มเองจะมีป้าย "เพิ่มเอง" ค้นหา ติดดาว นัดหมาย และบันทึกการติดต่อได้เหมือนบริษัทในทะเบียน และทั้งทีมเห็นด้วย (เมื่อเชื่อมต่อทีม)</span>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {edit && (
            <button type="button" onClick={() => { if (window.confirm(`ลบ "${edit.name}" ออกจากรายชื่อลูกค้า?`)) { e.deleteCustomer(edit.id); set({ addCust: null, sel: null }); } }} style={{ ...small, color: '#8A2B12', marginRight: 'auto' }}>
              ลบลูกค้านี้
            </button>
          )}
          <button type="button" onClick={close} style={small}>ยกเลิก</button>
          <button type="submit" style={{ ...small, background: '#1F5BD8', borderColor: '#1F5BD8', color: '#fff' }}>{edit ? 'บันทึก' : a.deal ? 'เพิ่มลูกค้าและเข้า Sales Tracker' : 'เพิ่มลูกค้า'}</button>
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
      <span style={{ fontSize: 13.5, color: '#475069', lineHeight: 1.6 }}>ชื่อบริษัท เบอร์ อีเมล และผู้รับผิดชอบจะถูกกรอกให้อัตโนมัติ ไม่ต้องพิมพ์ซ้ำ</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
        <label style={labelCol}>
          หมวด
          <select value={section} onChange={(ev) => setSection(ev.target.value)} style={selectStyle}>
            {cos.length > 1 && <option value={AUTO}>อัตโนมัติ — ตามแหล่งที่พบ (TGO / SET/mai)</option>}
            {e.sales.cfg.sections.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label style={labelCol}>
          ปี (พ.ศ.)
          <select value={year} onChange={(ev) => setYear(ev.target.value)} style={selectStyle}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
        {cos.map((c) => (
          <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, padding: '6px 4px', borderTop: '1px solid #EEF1F8', opacity: has(c) ? 0.55 : 1 }}>
            <input type="checkbox" checked={!!pick[c.id] && !has(c)} disabled={has(c)} onChange={(ev) => setPick({ ...pick, [c.id]: ev.target.checked })} />
            <span style={{ flex: 1 }}>{c.name}</span>
            <span style={{ fontSize: 12, color: '#5E6680' }}>{has(c) ? `มีในตารางปี ${year} แล้ว` : c.phone || 'ยังไม่มีเบอร์'}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={close} style={small}>ยกเลิก</button>
        <button onClick={send} disabled={!chosen.some((c) => !has(c))} style={{ ...small, background: '#1F5BD8', borderColor: '#1F5BD8', color: '#fff' }}>
          ส่ง {chosen.filter((c) => !has(c)).length} รายการ
        </button>
      </div>
    </Modal>
  );
}
