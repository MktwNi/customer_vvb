import { useId, useState } from 'react';
import { useApp } from '../state';
import { isoTh, todayISO } from '../lib/format';
import { membersOf, rateMode, rateOk, retiredSince, staffKey, unassigned, unitOfName, unitsOf, type Unit, type UnitRate } from '../lib/contrib';
import { Modal } from './Dialog';
import { Select } from './Select';
import { Icon } from './icons';

/** What a unit's latest rate says: "5%", "3% · VVB 5%", "ไม่คิดค่าคอมมิชชั่น". */
export function rateWords(e?: UnitRate | null): string {
  if (!e) return 'ไม่คิดค่าคอมมิชชั่น';
  const svc = Object.entries(e.svc || {}).map(([k, r]) => `${k} ${r}%`);
  if (e.r == null && !svc.length) return 'ไม่คิดค่าคอมมิชชั่น';
  return [e.r != null ? `${e.r}%` : 'ไม่คิด', ...svc].join(' · ');
}
/** A rate as typed ('' = none); NaN when not a rate. */
const rateIn = (s: string) => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')));
const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ');

/** `back`: a rate given to a unit that has only been ไม่คิด prices the money received before too (rateMode 'choose'). */
interface Draft { n: string; r: string; members: string[]; svc: { s: string; r: string }[]; back: boolean }

/**
 * หน่วยงานและค่าคอมมิชชั่น (dash impl-note §4, mockups 07, 07b): the units with their people and rates, one
 * open at a time in an inline editor (name, rate with what it applies to, people, rates by service), a new
 * unit, retiring one, and the names in no unit yet (their jobs count as "ยังไม่ระบุหน่วยงาน") with a quick
 * pick of a unit for each. For accounts with ตั้งค่าหน่วยงานและอัตราคอมมิชชั่น. Starts empty: the real units are
 * the team's to set up.
 */
export function UnitsDialog({ onClose }: { onClose: () => void }) {
  const { engine: e } = useApp();
  const ids = useId();
  const ctx = e.unitCtx();
  const all = unitsOf(ctx, true), live = all.filter((u) => !u.off), off = all.filter((u) => u.off);
  const [open, setOpen] = useState<string | null>(() => (all.length ? null : 'new'));
  const [dr, setDr] = useState<Draft>({ n: '', r: '', members: [], svc: [], back: false });
  const [err, setErr] = useState('');
  const names = [...new Set([...e.legacyNames().map((x) => x.name), ...Object.values(ctx.members).map((m) => m.n)])].filter((x) => staffKey(x));
  const services = e.sales.cfg.services;

  const begin = (u: Unit | null) => {
    const last = u?.rates[u.rates.length - 1];
    setDr({
      n: u?.n || '',
      r: last?.r != null ? String(last.r) : '',
      members: u ? membersOf(ctx, u.id) : [],
      svc: Object.entries(last?.svc || {}).map(([s, r]) => ({ s, r: String(r) })),
      back: false,
    });
    setErr('');
    setOpen(u ? u.id : 'new');
  };
  const save = () => {
    const n = cleanName(dr.n);
    const id = open === 'new' ? null : open;
    if (!n) return setErr('ใส่ชื่อหน่วยงาน');
    if (all.some((u) => u.id !== id && staffKey(u.n) === staffKey(n))) return setErr(`มีหน่วยงานชื่อ “${n}” แล้ว`);
    const r = rateIn(dr.r);
    if (r != null && !rateOk(r)) return setErr('อัตราค่าคอมมิชชั่นต้องเป็นตัวเลข 0–100 (ทศนิยมได้ 2 ตำแหน่ง) หรือเว้นว่างถ้าไม่คิด');
    const svc: Record<string, number> = {};
    for (const x of dr.svc) {
      if (!x.s && !x.r.trim()) continue;
      const v = rateIn(x.r);
      if (!x.s) return setErr('เลือกบริการของอัตราตามบริการให้ครบ');
      if (v == null || !rateOk(v)) return setErr(`อัตราของ ${x.s} ต้องเป็นตัวเลข 0–100`);
      if (x.s in svc) return setErr(`ใส่อัตราของ ${x.s} ซ้ำ`);
      svc[x.s] = v;
    }
    e.saveUnit(id, { n, r, svc, members: dr.members, back: dr.back });
    setOpen(null);
  };
  const retire = (u: Unit) => {
    const ms = membersOf(ctx, u.id);
    const who = ms.length ? ` (คนในหน่วยงานนี้ ${ms.length} คนยังอยู่ จะขึ้นในรายชื่อ “ยังไม่อยู่หน่วยงานใด” ให้ย้าย)` : '';
    if (!window.confirm(`เลิกใช้ “${u.n}”?\n\nเงินที่รับก่อนวันนี้ยังนับให้หน่วยงานนี้เหมือนเดิม ส่วนเงินที่รับตั้งแต่วันนี้ของงานที่นับให้หน่วยงานนี้ (งานของคนในหน่วยงานและสัดส่วนที่แบ่งไว้) จะนับเป็น “ยังไม่ระบุหน่วยงาน” ไม่มีค่าคอมมิชชั่น จนกว่าจะย้ายคนไปหน่วยงานอื่นหรือแบ่งสัดส่วนใหม่${who}\n\nย้ายคนแล้ว งานของเขาที่ไม่ได้แบ่งสัดส่วนไว้จะนับให้หน่วยงานใหม่ทั้งหมด รวมเงินที่รับไปแล้ว หน่วยงานที่เลิกใช้เลือกให้งานหรือคนใหม่ไม่ได้ ใช้อีกครั้งได้ภายหลัง`)) return;
    e.retireUnit(u.id, true);
    setOpen(null);
  };
  const free = unassigned(ctx, names);

  const editor = (u: Unit | null) => {
    const hist = u?.rates || [];
    // what the rate set now does to the money received before: the first one prices it too; a change does
    // not; a unit that has only been ไม่คิด asks (from today unless the admin says otherwise)
    const today = todayISO();
    const mode = u ? rateMode(u.rates, today) : 'first';
    const savedToday = !!u && u.rates[u.rates.length - 1]?.d === today;
    const typed = rateIn(dr.r) != null || dr.svc.some((x) => x.s && x.r.trim());
    const ask = mode === 'choose' && typed;
    const offSince = u?.rates.find((x) => x.d)?.d;
    const inUnit = new Set(dr.members.map(staffKey));
    const addable = names.filter((x) => !inUnit.has(staffKey(x))).sort((a, b) => a.localeCompare(b, 'th'));
    return (
      <div className="ut-ed" role="group" aria-label={u ? `แก้ไข ${u.n}` : 'เพิ่มหน่วยงาน'} key={u?.id || 'new'}>
        <div className="ut-g">
          <label className="ut-f">
            <span>ชื่อหน่วยงาน</span>
            <input className="ut-in" value={dr.n} maxLength={40} placeholder="เช่น ฝ่ายขาย" autoFocus={!u} onChange={(ev) => (setDr({ ...dr, n: ev.target.value }), setErr(''))} />
          </label>
          <label className="ut-f">
            <span>อัตราค่าคอมมิชชั่น</span>
            <span className="ut-pct">
              <input className="ut-in r" inputMode="decimal" value={dr.r} placeholder="ไม่คิด" onChange={(ev) => (setDr({ ...dr, r: ev.target.value.replace(/[^\d.,]/g, '').slice(0, 6) }), setErr(''))} />
              <span aria-hidden="true">%</span>
            </span>
            <small>
              {mode === 'first' ? 'อัตรานี้ใช้กับเงินที่รับมาแล้วทั้งหมดด้วย' : mode === 'choose' ? (ask ? 'เลือกด้านล่างว่าใช้กับเงินช่วงไหน' : 'ตอนนี้ไม่คิดค่าคอมมิชชั่น') : savedToday ? 'แก้อัตราที่บันทึกวันนี้' : 'อัตราใหม่ใช้กับเงินที่รับตั้งแต่วันที่บันทึก เงินที่รับก่อนหน้าใช้อัตราเดิม'} · เว้นว่างถ้าไม่คิดค่าคอมมิชชั่น
            </small>
          </label>
        </div>
        {ask && (
          <fieldset className="ut-when">
            <legend>อัตรานี้ใช้กับ</legend>
            <label>
              <input type="radio" name={ids + 'w'} checked={!dr.back} onChange={() => setDr({ ...dr, back: false })} />
              <span>เงินที่รับตั้งแต่วันนี้<small>เงินที่รับก่อนหน้ายังไม่คิดค่าคอมมิชชั่น{offSince ? ` ตามที่ตั้งไว้ตั้งแต่ ${isoTh(offSince)}` : ''}</small></span>
            </label>
            <label>
              <input type="radio" name={ids + 'w'} checked={dr.back} onChange={() => setDr({ ...dr, back: true })} />
              <span>เงินที่รับมาแล้วทั้งหมดด้วย<small>เมื่อตั้งหน่วยงานไว้ก่อนรู้อัตรา ไตรมาสที่ผ่านมาจะคิดค่าคอมมิชชั่นด้วยอัตรานี้</small></span>
            </label>
          </fieldset>
        )}
        {hist.length > 1 && (
          <span className="ut-hist">
            ประวัติอัตรา: {hist.map((x, i) => `${rateWords(x)} ${x.from ? 'ตั้งแต่ ' + isoTh(x.from) : 'ตั้งแต่เริ่ม'}${i === hist.length - 1 ? ' (ตอนนี้)' : ''}`).join(' · ')}
          </span>
        )}
        <div className="ut-f">
          <span id={ids + 'm'}>คนในหน่วยงาน <small>งานที่คนเหล่านี้รับผิดชอบนับให้หน่วยงานนี้ 100% ถ้าไม่ได้แบ่งสัดส่วนไว้</small></span>
          <div className="ut-chips">
            {dr.members.map((m) => {
              const was = unitOfName(ctx, m);
              const moving = was && was !== u?.id;
              return (
                <span key={m} className="ut-chip">
                  {m}
                  {moving && <small>ย้ายจาก{ctx.units[was].n}</small>}
                  <button type="button" aria-label={`เอา ${m} ออกจากหน่วยงาน`} onClick={() => setDr({ ...dr, members: dr.members.filter((x) => x !== m) })}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              );
            })}
            {addable.length > 0 && (
              <Select
                variant="tool"
                label="เพิ่มคนในหน่วยงาน"
                value=""
                shown="เพิ่มคน"
                ariaLabel="เพิ่มคนในหน่วยงาน"
                onChange={(v) => setDr({ ...dr, members: [...dr.members, v] })}
                options={addable.map((x) => {
                  const w = unitOfName(ctx, x);
                  return { v: x, label: x, sub: w && w !== u?.id ? `อยู่${ctx.units[w].n}${ctx.units[w].off ? ' (เลิกใช้)' : ''}` : undefined };
                })}
              />
            )}
            {!dr.members.length && !addable.length && <small>ยังไม่มีชื่อในทีม</small>}
          </div>
        </div>
        <div className="ut-f">
          <span>อัตราตามบริการ (ไม่บังคับ)</span>
          {dr.svc.map((x, i) => (
            <div key={i} className="ut-svc">
              <Select
                label={`บริการแถวที่ ${i + 1}`}
                value={x.s}
                placeholder="เลือกบริการ"
                onChange={(v) => setDr({ ...dr, svc: dr.svc.map((y, j) => (j === i ? { ...y, s: v } : y)) })}
                options={services.filter((s) => s === x.s || !dr.svc.some((y) => y.s === s)).map((s) => ({ v: s, label: s }))}
              />
              <span className="ut-pct">
                <input className="ut-in r" inputMode="decimal" value={x.r} aria-label={`อัตรา ${x.s || `แถวที่ ${i + 1}`} (%)`} onChange={(ev) => setDr({ ...dr, svc: dr.svc.map((y, j) => (j === i ? { ...y, r: ev.target.value.replace(/[^\d.,]/g, '').slice(0, 6) } : y)) })} />
                <span aria-hidden="true">%</span>
              </span>
              <span className="ut-svc-h">{rateIn(dr.r) != null ? `ใช้แทน ${dr.r.trim()}% เมื่องานมีบริการนี้` : 'ใช้เมื่องานมีบริการนี้'}</span>
              <button type="button" className="quiet sp-x" aria-label={`เอาอัตรา ${x.s || `แถวที่ ${i + 1}`} ออก`} onClick={() => setDr({ ...dr, svc: dr.svc.filter((_, j) => j !== i) })}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          {dr.svc.length < services.length && <button type="button" className="lnk ut-more" onClick={() => setDr({ ...dr, svc: [...dr.svc, { s: '', r: '' }] })}>เพิ่มอัตราตามบริการ</button>}
        </div>
        <div className="ut-act">
          {u && <button type="button" className="quiet" onClick={() => retire(u)}>เลิกใช้หน่วยงานนี้</button>}
          <span className="sp" />
          {err && <span className="ut-err" role="alert">{err}</span>}
          <button type="button" className="quiet" onClick={() => (all.length ? setOpen(null) : onClose())}>ยกเลิก</button>
          <button type="button" className="btn pri" onClick={save}>บันทึก</button>
        </div>
      </div>
    );
  };

  return (
    <Modal title="หน่วยงานและค่าคอมมิชชั่น" onClose={onClose} width={780}>
      <div className="ut-dlg-b">
        <p className="ut-sub">ใช้แบ่งสัดส่วนรายได้ของแต่ละงาน และคิดค่าคอมมิชชั่นจากเงินที่รับแล้ว เห็นและแก้ได้เฉพาะบทบาทที่มีสิทธิ์ ตั้งค่าหน่วยงานและอัตราคอมมิชชั่น</p>
        {!all.length && open !== 'new' && <p className="ut-ex">ยังไม่มีหน่วยงาน เพิ่มหน่วยงานแรก เช่น ฝ่ายขาย แล้วใส่คนในหน่วยงานและอัตราค่าคอมมิชชั่น</p>}
        {live.length > 0 && (
          <div className="ut-t" role="table" aria-label="หน่วยงาน">
            <div className="ut-r ph" role="row">
              <span role="columnheader">หน่วยงาน</span>
              <span role="columnheader">คนในหน่วยงาน</span>
              <span role="columnheader" className="r">อัตราค่าคอมมิชชั่น</span>
              <span role="columnheader"><span className="sr-only">แก้ไข</span></span>
            </div>
            {live.map((u) =>
              open === u.id ? (
                editor(u)
              ) : (
                <div key={u.id} className="ut-r" role="row">
                  <span role="cell" className="un"><i className={'ud u' + u.c} aria-hidden="true" /><b className="un-n">{u.n}</b></span>
                  <span role="cell" className={'ut-m' + (membersOf(ctx, u.id).length ? '' : ' z')}>{membersOf(ctx, u.id).join(' · ') || 'ยังไม่มีคน'}</span>
                  <span role="cell" className={'r' + (rateWords(u.rates[u.rates.length - 1]) === 'ไม่คิดค่าคอมมิชชั่น' ? ' z' : '')}>{rateWords(u.rates[u.rates.length - 1])}</span>
                  <span role="cell" style={{ justifySelf: 'end' }}>
                    <button type="button" className="lnk ut-e" onClick={() => begin(u)} aria-label={`แก้ไข ${u.n}`}>แก้ไข</button>
                  </span>
                </div>
              ),
            )}
          </div>
        )}
        {open === 'new' && editor(null)}
        <div className="ut-foot">
          {open !== 'new' && <button type="button" className="lnk" onClick={() => begin(null)}>เพิ่มหน่วยงาน</button>}
          {live.length > 0 && free.length > 0 && (
            <span className="ut-none">
              {free.some((n) => unitOfName(ctx, n))
                ? `ยังไม่อยู่หน่วยงานใด หรืออยู่หน่วยงานที่เลิกใช้ (${free.length} คน) งานที่คนเหล่านี้รับผิดชอบนับเป็น “ยังไม่ระบุหน่วยงาน” (คนในหน่วยงานที่เลิกใช้: เงินที่รับตั้งแต่วันที่เลิกใช้) · เลือกหน่วยงาน:`
                : `ยังไม่อยู่หน่วยงานใด (${free.length} คน) งานที่คนเหล่านี้รับผิดชอบนับเป็น “ยังไม่ระบุหน่วยงาน” · เลือกหน่วยงาน:`}
              {free.slice(0, 8).map((n) => {
                const was = unitOfName(ctx, n);
                return (
                  <Select key={n} variant="tool" label={`เลือกหน่วยงานให้${n}`} ariaLabel={`เลือกหน่วยงานให้${n}${was ? ` (อยู่${ctx.units[was].n} ที่เลิกใช้แล้ว)` : ''}`} value="" shown={was ? <>{n}<small className="ut-was">{ctx.units[was].n} เลิกใช้</small></> : n} onChange={(v) => e.setUnitMember(n, v)} options={live.map((u) => ({ v: u.id, label: u.n, lead: <i className={'ud u' + u.c} aria-hidden="true" /> }))} />
                );
              })}
              {free.length > 8 && <span>และอีก {free.length - 8} คน (เพิ่มได้ที่ “แก้ไข” ของหน่วยงาน)</span>}
            </span>
          )}
        </div>
        {off.length > 0 && (
          <div className="ut-off">
            <span>เลิกใช้แล้ว:</span>
            {off.map((u) => {
              const ms = membersOf(ctx, u.id), since = retiredSince(u);
              return (
                <span key={u.id} className="ut-off-i">
                  <span className="ut-off-n">{u.n}</span>
                  {since ? ` ตั้งแต่ ${isoTh(since)}` : ''}
                  {ms.length > 0 && <span> · คนที่ยังอยู่ {ms.join(' · ')}</span>}{' '}
                  <button type="button" className="lnk" onClick={() => e.retireUnit(u.id, false)} aria-label={`ใช้ ${u.n} อีกครั้ง`} title="เงินที่รับระหว่างที่เลิกใช้ยังนับเป็น “ยังไม่ระบุหน่วยงาน”">ใช้อีกครั้ง</button>
                </span>
              );
            })}
          </div>
        )}
        <p className="ut-ex">ตัวอย่าง: เงินเข้า 1,000,000 บาท งานนี้แบ่ง หน่วยงาน ก 60% หน่วยงาน ข 20% หน่วยงาน ค 20% หน่วยงาน ก ได้ส่วน 600,000 บาท ถ้าอัตรา 5% เป็นค่าคอมมิชชั่น 30,000 บาท</p>
      </div>
    </Modal>
  );
}
