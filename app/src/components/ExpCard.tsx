import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useApp, useEngineVersion } from '../state';
import type { GccEngine } from '../lib/engine';
import { dtTh, isoTh, todayISO } from '../lib/format';
import { fmtMoney, jointOf, jointRole, type Deal } from '../lib/sales';
import { shortName } from '../lib/salesUi';
import { unitCtx, unitsOf } from '../lib/contrib';
import { EXP_CAT_MAX, EXP_NOTE_MAX, expensesOf, type DealExp } from '../lib/expense';
import { CAT_EXAMPLES, catSuggest, expForm, jobComm, jobSum, readExpForm, type ExpField, type ExpForm, type JobSum } from '../lib/expenseJob';
import { DOC_ACCEPT } from '../lib/teamFiles';
import { Modal } from './Dialog';
import { SHOWABLE } from './DocAttach';
import { Check } from './Pop';
import { useSalesActs } from './SalesToast';
import { DateField, Status } from './ui';

/**
 * ค่าใช้จ่ายของงาน (job expenses) where a job is worked on: the deal panel's card after the payment plan, the
 * phone card's row, and the dialog that records one (lib/expense.ts, lib/expenseJob.ts). Nothing here shows
 * without ดูค่าใช้จ่ายและกำไรของงาน (the team script sends such an account none of it either); recording needs
 * บันทึกค่าใช้จ่ายของงาน, for its own work only on a deal it is the ผู้รับผิดชอบ of (engine.canExp). Money going
 * out reads in its own calm colour with its words (เงินออก / ค่าใช้จ่าย), never red: red is late.
 */

const m0 = (n: number) => fmtMoney(Math.round(n * 100) / 100) || '0';
const pctWord = (p: number | null) => (p == null ? '' : ` (${p}%)`);

// ------------------------------------------------------------------ the dialog, opened from anywhere

/** The dialog open: the deal, and the expense being changed (none: a new one). */
type ExpDlg = { deal: string; exp?: string } | null;
let dlg: ExpDlg = null;
const subs = new Set<() => void>();
const setDlg = (v: ExpDlg) => {
  dlg = v;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
/** Open the expense dialog: a new expense on `deal`, or expense `exp` of it. */
export const openExp = (deal: string, exp?: string) => setDlg({ deal, exp });
/** Hosts the dialog over the app (the table's menu, the panel, the phone card all open it). */
export function ExpDialogHost() {
  const v = useSyncExternalStore(subscribe, () => dlg);
  if (!v) return null;
  return <ExpDialog key={v.deal + '/' + (v.exp || '')} dealId={v.deal} expId={v.exp} onClose={() => setDlg(null)} />;
}

/** Open an expense's bill (this browser's copy, or the team's Drive): the tab opens within the click. */
export async function openBill(e: GccEngine, x: DealExp) {
  const f = x.file;
  if (!f) return;
  const w = SHOWABLE.test(f.mime) ? window.open('', '_blank') : null;
  try {
    const url = URL.createObjectURL(await e.expBill(x));
    if (w) w.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    w?.close();
    window.alert('เปิดบิลไม่สำเร็จ: ' + ((err as Error)?.message || err));
  }
}

/** "ใบเสร็จ/บิล" of a line: opens the file; one still waiting in another browser says so. */
function BillLink({ x }: { x: DealExp }) {
  const { engine: e } = useApp();
  if (!x.file) return <span className="xp-nobill">ไม่มีบิล</span>;
  // (with no team there is nowhere to upload it: this browser's copy is the bill)
  const waiting = !x.file.id && !!e.teamCfg;
  return (
    <button type="button" className="lnk xp-bill" onClick={() => void openBill(e, x)} title={`${x.file.name}${waiting ? ' · ยังไม่ได้อัปโหลดขึ้น Drive ของทีม' : ''}`}>
      ใบเสร็จ/บิล{waiting ? ' (รออัปโหลด)' : ''}
    </button>
  );
}

// ------------------------------------------------------------------ the summary

/** "เงินเข้า 100,000 · ค่าใช้จ่าย 35,000 · คงเหลือ 65,000 (65%)", the Forecast line under it, and (with
 *  ดูค่าคอมมิชชั่น and units) what is left after the computed commission. `jr`: a joint quotation's header
 *  counts the whole quotation, a member company its part. */
function Summary({ j, comm, jr }: { j: JobSum; comm: number | null; jr: 'plain' | 'header' | 'member' }) {
  const t = j.t;
  const share = j.inc > 0 ? Math.min(100, Math.round((t.out / j.inc) * 100)) : 0;
  return (
    <div className="xp-sum">
      <p className="xp-line">
        {j.inc > 0 ? <>เงินเข้า <b>{m0(j.inc)}</b></> : <span className="t-muted">ยังไม่มีเงินเข้า</span>}
        {' · '}ค่าใช้จ่าย <b className="xp-out">{m0(t.out)}</b>
        {t.unpaid > 0 && <span className="xp-unpaid"> (ค้างจ่าย {m0(t.unpaid)})</span>}
        {j.inc > 0 && <> · คงเหลือ <b>{m0(j.left)}</b>{pctWord(j.pct)}</>}
      </p>
      {j.inc > 0 && (
        <span className={'xp-bar' + (j.left < 0 ? ' over' : '')} role="img" aria-label={`ค่าใช้จ่าย ${share}% ของเงินเข้า`}>
          <i className="out" style={{ width: share + '%' }} />
          {share < 100 && <i className="left" />}
        </span>
      )}
      {j.fc != null && j.fc > 0 && j.fc !== j.inc && (
        <p className="xp-sub">ถ้ารับครบตาม Forecast {m0(j.fc)}{jr === 'header' ? ' (ทั้งใบ)' : jr === 'member' ? ' (ส่วนแบ่ง)' : ''}: คงเหลือ <b>{m0(j.fcLeft!)}</b>{pctWord(j.fcPct)}</p>
      )}
      {comm != null && comm > 0 && j.inc > 0 && (
        <p className="xp-sub">หลังหักค่าคอมมิชชั่น (คำนวณ) {m0(comm)}: คงเหลือ <b>{m0(j.left - comm)}</b>{pctWord(Math.round(((j.left - comm) / j.inc) * 100))}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the deal panel's card

/** One expense: category and description, amount, paid or ค้างจ่าย, the bill, who recorded it; แก้ไข / ลบ. */
function ExpRow({ x, can }: { x: DealExp; can: boolean }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const del = () => {
    if (!window.confirm(`ลบค่าใช้จ่าย "${x.c}" ${m0(x.amt)} บาท?${x.file ? ' (บิลที่แนบไปถังขยะของ Drive ทีม)' : ''}`)) return;
    if (e.deleteExpense(x.deal, x.id)) acts.say(`ลบค่าใช้จ่าย ${x.c} แล้ว`);
  };
  return (
    <div className="xp-r" role="row">
      <span className="c-cat" role="cell">
        <b>{x.c || 'ไม่ระบุประเภท'}</b>
        {x.n && <small>{x.n}</small>}
      </span>
      <span className="c-amt" role="cell">{m0(x.amt)}</span>
      <span className="c-st" role="cell">
        {x.paid ? <Status kind="neutral">จ่ายแล้ว {isoTh(x.paid)}</Status> : <Status kind="warn">ค้างจ่าย</Status>}
      </span>
      <span className="c-meta" role="cell">
        <span>บิล {x.d ? isoTh(x.d) : 'ไม่ระบุวันที่'} · <BillLink x={x} /> · บันทึกโดย {x.by || 'ไม่ระบุ'}{x.at ? ' ' + dtTh(x.at) : ''}</span>
        {can && (
          <span className="xp-acts">
            <button type="button" className="lnk" onClick={() => openExp(x.deal, x.id)} aria-label={`แก้ไขค่าใช้จ่าย ${x.c} ${m0(x.amt)} บาท`}>แก้ไข</button>
            <button type="button" className="quiet" onClick={del} aria-label={`ลบค่าใช้จ่าย ${x.c} ${m0(x.amt)} บาท`}>ลบ</button>
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The deal panel's "ค่าใช้จ่ายของงาน", after the payment plan. A joint quotation's header (its own panel) adds
 * its member companies' expenses to its own (each company's row, with a link to it); a member company shows
 * its own against its part of the quotation's money.
 */
export function ExpCard({ d }: { d: Deal }) {
  const { engine: e, set } = useApp();
  useEngineVersion();
  if (!e.can('view.exp')) return null;
  const S = e.sales, today = todayISO();
  const can = e.canExp(d);
  const list = expensesOf(S, d.id);
  const j = jobSum(S, d, today);
  const jr = jointRole(S, d);
  const comm = e.seesComm() && unitsOf(unitCtx(S), true).length ? jobComm(e.unitCtx(), S, d, today) : null;
  const g = jr === 'member' ? jointOf(S, d) : null;
  const empty = !list.length && !j.members.length;
  const add = can && <button type="button" className="btn xs" onClick={() => openExp(d.id)}>บันทึกค่าใช้จ่าย</button>;
  return (
    <section className="dp-card xp-card" aria-labelledby="dp-exp">
      <div className="xp-h">
        <h3 id="dp-exp">ค่าใช้จ่ายของงาน</h3>
        {!empty && add}
      </div>
      {g && (
        <p className="xp-note">
          เงินเข้าเป็นส่วนแบ่งของบริษัทนี้ในใบเสนอราคาร่วม · ค่าใช้จ่ายรวมทุกบริษัทดูที่ <button type="button" className="lnk" onClick={() => set({ deal: g.head.id })}>ใบเสนอราคาร่วม</button>
        </p>
      )}
      {empty ? (
        <div className="xp-empty">
          <span>
            {can ? 'ยังไม่มีค่าใช้จ่าย บันทึกเงินที่จ่ายออกไปสำหรับงานนี้ เช่น ผู้รับเหมา ค่าเดินทาง ค่าธรรมเนียม TGO ค่าแล็บ แล้วจะเห็นว่าเหลือเท่าไรจากเงินที่รับ' : 'ยังไม่มีค่าใช้จ่ายที่บันทึกไว้'}
          </span>
          {add}
        </div>
      ) : (
        <>
          <Summary j={j} comm={comm} jr={jr} />
          <div className="xp-t" role="table" aria-label="รายการค่าใช้จ่าย">
            <div className="xp-r ph" role="row">
              <span role="columnheader">ประเภท / รายละเอียด</span>
              <span role="columnheader" className="r">ยอด (บาท)</span>
              <span role="columnheader">การจ่าย</span>
            </div>
            {list.map((x) => <ExpRow key={x.id} x={x} can={can} />)}
            {j.members.map((m) => (
              <div key={m.deal.id} className="xp-r mem" role="row">
                <span className="c-cat" role="cell">
                  <button type="button" className="hv-tx xp-co" onClick={() => set({ deal: m.deal.id })} title={`เปิดแถวของ ${m.deal.client}`}>{shortName(m.deal.client)}</button>
                  <small>{m.t.n} รายการ · {[...new Set(m.list.map((x) => x.c))].join(', ')}</small>
                </span>
                <span className="c-amt" role="cell">{m0(m.t.out)}</span>
                <span className="c-st" role="cell">{m.t.nUnpaid ? <Status kind="warn">ค้างจ่าย {m.t.nUnpaid} รายการ</Status> : <Status kind="neutral">จ่ายแล้วทั้งหมด</Status>}</span>
              </div>
            ))}
            {comm != null && (
              <div className="xp-r comp" role="row">
                <span className="c-cat" role="cell">
                  <b>ค่าคอมมิชชั่น (คำนวณ)</b>
                  <small>คิดจากเงินที่รับแล้วตามอัตราของหน่วยงาน · ไม่ได้บันทึกเป็นรายการ ไม่รวมในยอดค่าใช้จ่าย</small>
                </span>
                <span className="c-amt" role="cell">{m0(comm)}</span>
                <span className="c-st" role="cell"><span className="chip">คำนวณ</span></span>
              </div>
            )}
          </div>
          <div className="xp-f">
            <span>
              {j.members.length ? `รวมทั้งใบเสนอราคาร่วม ${j.t.n} รายการ` : `รวม ${j.t.n} รายการ`} · <b>{m0(j.t.out)}</b> บาท
              {j.t.nUnpaid > 0 ? ` · ค้างจ่าย ${j.t.nUnpaid} รายการ ${m0(j.t.unpaid)}` : ' · จ่ายครบแล้ว'}
            </span>
            {j.members.length > 0 && <span>ของใบนี้เอง {m0(j.own.out)} · บริษัทในใบ {m0(j.t.out - j.own.out)}</span>}
          </div>
        </>
      )}
      {!can && e.can('edit.exp') && <p className="xp-ro">บันทึกค่าใช้จ่ายได้เฉพาะงานที่คุณเป็นผู้รับผิดชอบ{d.resp ? ` (งานนี้: ${d.resp})` : ''}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ the phone card

/** The open phone card's row "ค่าใช้จ่าย": the same summary, the latest lines, and บันทึกค่าใช้จ่าย. */
export function ExpMini({ d, onOpen }: { d: Deal; onOpen: () => void }) {
  const { engine: e } = useApp();
  if (!e.can('view.exp')) return null;
  const S = e.sales, today = todayISO();
  const can = e.canExp(d);
  const list = expensesOf(S, d.id);
  const j = jobSum(S, d, today);
  if (!can && !list.length && !j.members.length) return null;
  const last = [...list].sort((a, b) => (b.d || '').localeCompare(a.d || '') || b.at.localeCompare(a.at)).slice(0, 3);
  return (
    <div className="sl-mk xp-mk" role="listitem">
      <span className="sl-mk-dot xp-dot" aria-hidden="true" />
      <div className="sl-mk-t">
        <div><b>ค่าใช้จ่าย</b><span>{j.t.n ? `${j.t.n} รายการ` : 'ยังไม่มี'}</span></div>
        {j.t.n > 0 && <Summary j={j} comm={null} jr={jointRole(S, d)} />}
        {last.length > 0 && (
          <ul className="xp-ml" aria-label={'ค่าใช้จ่ายล่าสุดของ ' + shortName(d.client)}>
            {last.map((x) => (
              <li key={x.id}>
                <span>{x.c}</span>
                <b>{m0(x.amt)}</b>
                <small className={x.paid ? '' : 't-warn'}>{x.paid ? 'จ่ายแล้ว' : 'ค้างจ่าย'}</small>
              </li>
            ))}
          </ul>
        )}
        <span className="xp-ma">
          {can && <button type="button" className="btn xs" onClick={() => openExp(d.id)}>บันทึกค่าใช้จ่าย</button>}
          {(list.length > 0 || j.members.length > 0) && <button type="button" className="lnk" onClick={onOpen}>ดูทั้งหมด</button>}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the dialog

const FILE_HINT = 'PDF หรือรูปภาพ ไม่เกิน 10 MB';

function ExpDialog({ dealId, expId, onClose }: { dealId: string; expId?: string; onClose: () => void }) {
  const { engine: e } = useApp();
  useEngineVersion();
  const acts = useSalesActs();
  const S = e.sales, today = todayISO();
  const d = S.deals[dealId];
  const x = expId ? expensesOf(S, dealId).find((y) => y.id === expId) || null : null;
  const [f, setF] = useState<ExpForm>(() => expForm(x, today));
  const [err, setErr] = useState<Partial<Record<ExpField, string>>>({});
  const [file, setFile] = useState<File | null>(null);
  const [dropBill, setDropBill] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileIn = useRef<HTMLInputElement>(null);
  const title = expId ? 'แก้ค่าใช้จ่าย' : 'บันทึกค่าใช้จ่าย';
  const up = (p: Partial<ExpForm>) => {
    setF((v) => ({ ...v, ...p }));
    setErr((o) => {
      const n = { ...o };
      (Object.keys(p) as (keyof ExpForm)[]).forEach((k) => delete n[(k === 'paidOn' ? 'paid' : k) as ExpField]);
      return n;
    });
  };
  if (!d || (expId && !x) || !e.canExp(d))
    return (
      <Modal title={title} onClose={onClose} width={460}>
        <p className="t-sec" style={{ margin: 0 }}>{!d || (expId && !x) ? 'ไม่พบรายการนี้แล้ว (อาจมีคนลบไประหว่างนี้)' : 'บัญชีของคุณบันทึกค่าใช้จ่ายของงานนี้ไม่ได้'}</p>
        <div className="dlg-act"><button type="button" className="btn" onClick={onClose}>ปิด</button></div>
      </Modal>
    );
  const sugg = catSuggest(S, f.c, 8);
  const pick = (fl: File | undefined) => {
    if (!fl) return;
    setMsg('');
    if (fl.size > 10 * 1024 * 1024) return setMsg('ไฟล์ใหญ่เกิน 10 MB');
    setFile(fl);
    setDropBill(false);
  };
  const save = async () => {
    const r = readExpForm(f);
    if (!r.ok) {
      setErr(r.err);
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      let id = expId || '';
      if (expId) {
        if (!e.updateExpense(dealId, expId, r.v)) throw new Error('บันทึกไม่สำเร็จ (อาจมีคนลบรายการนี้ไประหว่างนี้)');
      } else {
        const n = e.addExpense(dealId, r.v);
        if (!n) throw new Error('บันทึกไม่สำเร็จ');
        id = n.id;
      }
      if (dropBill && x?.file) e.removeExpenseBill(dealId, id);
      if (file) {
        try {
          await e.attachExpenseBill(dealId, id, file);
        } catch (er) {
          // the expense is saved: the file alone is refused, and can be attached again from แก้ไข
          window.alert(`บันทึกค่าใช้จ่ายแล้ว แต่แนบบิลไม่สำเร็จ: ${(er as Error)?.message || er}`);
        }
      }
      acts.say(`${expId ? 'แก้' : 'บันทึก'}ค่าใช้จ่ายแล้ว · ${r.v.c} ${m0(r.v.amt)} บาท${r.v.paid ? '' : ' · ค้างจ่าย'}`);
      onClose();
    } catch (er) {
      setMsg((er as Error)?.message || String(er));
      setBusy(false);
    }
  };
  const remove = () => {
    if (!x || !window.confirm(`ลบค่าใช้จ่าย "${x.c}" ${m0(x.amt)} บาท?${x.file ? ' (บิลที่แนบไปถังขยะของ Drive ทีม)' : ''}`)) return;
    if (e.deleteExpense(dealId, x.id)) acts.say(`ลบค่าใช้จ่าย ${x.c} แล้ว`);
    onClose();
  };
  const bill = file ? { name: file.name, size: file.size, now: true } : x?.file && !dropBill ? { name: x.file.name, size: x.file.size, now: false } : null;
  const fieldErr = (k: ExpField) => err[k] && <small className="xp-err" id={'xp-e-' + k} role="alert">{err[k]}</small>;
  const jr = jointRole(S, d);
  return (
    <Modal title={title} onClose={onClose} width={560}>
      <form
        className="xp-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!busy) void save();
        }}
      >
        <p className="xp-for">
          {shortName(d.client)}
          {jr === 'header' ? ' · ใบเสนอราคาร่วม' : jr === 'member' ? ' · บริษัทในใบเสนอราคาร่วม' : ''}
          {d.resp ? ' · ผู้รับผิดชอบ ' + d.resp : ''}
        </p>
        <div className="xp-fld">
          <label htmlFor="xp-c">ประเภทค่าใช้จ่าย</label>
          <input
            id="xp-c"
            className="fld"
            value={f.c}
            maxLength={EXP_CAT_MAX}
            placeholder={CAT_EXAMPLES}
            autoComplete="off"
            aria-invalid={!!err.c}
            aria-describedby={err.c ? 'xp-e-c' : undefined}
            onChange={(ev) => up({ c: ev.target.value })}
          />
          {fieldErr('c')}
          {sugg.length > 0 && (
            <div className="xp-sugg" role="group" aria-label="ประเภทที่ทีมเคยใช้">
              <span>{f.c.trim() ? 'ที่ตรงกับที่พิมพ์' : 'ที่ทีมเคยใช้'}</span>
              {sugg.map((s) => (
                <button key={s.c} type="button" className="sl-opt hv" onClick={() => up({ c: s.c })} title={`ใช้แล้ว ${s.n} รายการ`}>{s.c}</button>
              ))}
            </div>
          )}
          {!sugg.length && !f.c.trim() && <small className="xp-hint">พิมพ์ประเภทเองได้ ไม่มีรายการตายตัว ครั้งต่อไประบบจะแนะนำประเภทที่ทีมเคยใช้</small>}
        </div>
        <div className="xp-fld">
          <label htmlFor="xp-n">รายละเอียด <span className="xp-opt">(ไม่บังคับ)</span></label>
          <input id="xp-n" className="fld" value={f.n} maxLength={EXP_NOTE_MAX} placeholder="เช่น ค่าตรวจวัดที่โรงงานระยอง งวดที่ 1" onChange={(ev) => up({ n: ev.target.value })} />
        </div>
        <div className="xp-g2">
          <div className="xp-fld">
            <label htmlFor="xp-amt">ยอดตามบิล (บาท)</label>
            <input
              id="xp-amt"
              className="fld num"
              value={f.amt}
              inputMode="decimal"
              placeholder="เช่น 35,000"
              aria-invalid={!!err.amt}
              aria-describedby={err.amt ? 'xp-e-amt' : 'xp-amt-h'}
              onChange={(ev) => up({ amt: ev.target.value })}
            />
            {fieldErr('amt') || <small className="xp-hint" id="xp-amt-h">รวม VAT ตามที่เขียนในบิล</small>}
          </div>
          <div className="xp-fld">
            <span className="xp-lbl" id="xp-d-l">วันที่ในบิล</span>
            <DateField value={f.d} onChange={(v) => up({ d: v })} label="วันที่ในบิล" />
            {fieldErr('d')}
          </div>
        </div>
        <div className="xp-paid">
          <label className={'fck' + (f.paidOn ? ' on' : '')}>
            <input type="checkbox" className="sr-only" checked={f.paidOn} onChange={(ev) => up({ paidOn: ev.target.checked, paid: f.paid || today })} />
            <Check on={f.paidOn} />
            <span>จ่ายแล้ว</span>
          </label>
          {f.paidOn ? (
            <span className="xp-paid-d">
              <span className="xp-lbl">วันที่จ่าย</span>
              <DateField value={f.paid} onChange={(v) => up({ paid: v })} label="วันที่จ่าย" />
              {fieldErr('paid')}
            </span>
          ) : (
            <small className="xp-hint">ยังไม่จ่าย · นับเป็นค้างจ่าย จนกว่าจะบันทึกวันที่จ่าย</small>
          )}
        </div>
        <div
          className={'sl-drop xp-drop' + (over ? ' over' : '')}
          onDragOver={(ev) => (ev.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(ev) => {
            ev.preventDefault();
            setOver(false);
            pick(ev.dataTransfer.files?.[0]);
          }}
        >
          <span className="sl-drop-t">
            {bill ? (
              <>
                <span>{bill.now ? 'บิลที่จะแนบ' : 'บิลที่แนบไว้'}: {bill.name}</span>
                <small>{Math.max(1, Math.round(bill.size / 1024))} KB{!bill.now && x?.file && !x.file.id && e.teamCfg ? ' · ยังไม่ได้อัปโหลดขึ้น Drive ของทีม' : ''}</small>
              </>
            ) : (
              <>
                <span>แนบบิลหรือใบเสร็จ <span className="xp-opt">(ไม่บังคับ)</span></span>
                <small>ลากไฟล์มาวาง หรือเลือกไฟล์ · {FILE_HINT}{dropBill ? ' · บิลเดิมจะถูกย้ายไปถังขยะเมื่อบันทึก' : ''}</small>
              </>
            )}
          </span>
          <span className="sl-drop-b">
            {bill && !bill.now && x && <button type="button" className="lnk" onClick={() => void openBill(e, x)}>เปิด</button>}
            <button type="button" className="btn xs" onClick={() => fileIn.current?.click()}>{bill ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}</button>
            {bill && <button type="button" className="quiet" onClick={() => (file ? setFile(null) : setDropBill(true))}>{bill.now ? 'ไม่แนบไฟล์นี้' : 'เอาบิลออก'}</button>}
            {dropBill && !file && <button type="button" className="quiet" onClick={() => setDropBill(false)}>ใช้บิลเดิม</button>}
            <input ref={fileIn} type="file" hidden accept={DOC_ACCEPT} onChange={(ev) => { const fl = ev.target.files?.[0]; ev.target.value = ''; pick(fl); }} />
          </span>
        </div>
        {msg && <p className="note err" role="alert" style={{ margin: 0 }}>{msg}</p>}
        <div className="dlg-act">
          {x && <button type="button" className="quiet xp-del" onClick={remove} disabled={busy}>ลบรายการนี้</button>}
          <button type="button" className="quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="btn pri" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
        {x && <p className="xp-last">บันทึกล่าสุดโดย {x.by || 'ไม่ระบุ'}{x.at ? ' · ' + dtTh(x.at) : ''}</p>}
      </form>
    </Modal>
  );
}

/** A note for a member company's row in the table menu: how its expenses relate to the joint quotation. */
export const expMenuSub = (jr: ReturnType<typeof jointRole>): ReactNode => (jr === 'header' ? 'ค่าใช้จ่ายของใบเสนอราคาร่วม' : jr === 'member' ? 'ค่าใช้จ่ายของบริษัทนี้ในใบเสนอราคาร่วม' : 'เงินที่จ่ายออกสำหรับงานนี้');
