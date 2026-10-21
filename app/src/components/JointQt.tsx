import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useApp, useEngineVersion } from '../state';
import { norm } from '../lib/core';
import { dmTh, fmtN, isoTh, todayISO } from '../lib/format';
import {
  DEAL_STAGE, QUOTE_STAGE, closeReady, dealMoney, dealResult, fmtMoney, jointOf, jointSplit, parseAmount, payState, dealSteps, stepOf,
  type Deal, type DealDoc, type JointGroup, type SalesState,
} from '../lib/sales';
import { JOINT_PAID, nextStepView, shortName, statusView } from '../lib/salesUi';
import { jointCloseCount } from '../lib/workUi';
import {
  OWN_TH, bandPart, closeSummary, closedJoint, closedWord, jointNo, jointShort, jointSub, jointTitle, memberLine, memberShares, outWord, ownJob, parseShare, payerShort, pickLine, pickParts, resultsWord, sentDay, shareOf, sharesCheck,
  sharesWord,
  type JRow, type JointPick, type RowFate,
} from '../lib/joint';
import { qtView } from '../lib/quotes';
import type { DocFacts } from '../lib/docExtract';
import type { CashLens } from '../lib/cashUi';
import { DOC_ACCEPT, DOC_MAX_BYTES, docMime } from '../lib/teamFiles';
import { Modal, DialogActions } from './Dialog';
// ค่าใช้จ่ายของงาน: the band's ⋯ menu records one on the joint quotation; cancelling it names the header's
import { cancelExpWords, openExp } from './ExpCard';
import { CoAvatar } from './CoAvatar';
import { DateField, Notice, Status } from './ui';
import { SelField } from './Select';
import { Icon } from './icons';
import { Chevron } from './StageTrack';
import { QtCard } from './QtCard';
import { QtCheckLine } from './QtCheckSheet';
import { checkedLine, waitShort } from '../lib/notify';
import { useSalesActs } from './SalesToast';
import { LensMoney } from '../tabs/SalesCash';
import type { AttachEntry } from '../lib/attachPlan';
import { DealSvcRow } from './DealSvc';
import { svcText } from '../lib/jobs';
import { jobServices } from '../lib/sales';

/**
 * The joint quotation (ใบเสนอราคาร่วม, package quotes item 7) on screen: making one ("สร้างใบเสนอราคาร่วม",
 * or "รวมเป็นใบเสนอราคาร่วม" from a deal's quotation), changing its companies, closing it, its band and
 * member rows in the table, its card on a phone, its rows in ปิดงาน, its panel, and the line a member's own
 * panel opens with. The rules are lib/sales.ts (money once, on the header) and lib/joint.ts.
 */

const m0 = (n: number | null | undefined) => (n == null ? '—' : fmtMoney(n) || '0');

// ------------------------------------------------------------------ dialogs (mounted once, in App)

/** The dialog ui.jqDlg asks for. */
export function JointDialogs() {
  const { ui, set } = useApp();
  useEngineVersion();
  const q = ui.jqDlg;
  if (!q) return null;
  const close = () => set({ jqDlg: null });
  if (q.k === 'close') return <JointClose hid={q.hid} onClose={close} />;
  return <JointEdit key={q.k === 'new' ? 'n' + (q.from || '') : 'm' + q.hid} from={q.k === 'new' ? q.from : undefined} section={q.k === 'new' ? q.section : undefined} hid={q.k === 'members' ? q.hid : undefined} onClose={close} />;
}

/** One company in the dialog's list: what joining does to it (`sub`), and the part typed (`typed`);
 *  `lock`: a member whose row this account may not edit (it stays: no "เอาออก"). */
interface Row { key: string; pick: Omit<JointPick, 'share' | 'pct'>; name: string; sub: string; typed: string; lock?: boolean }
/** A search result: a row of the year, a registry company not in the table, or a name typed. */
interface Hit { key: string; name: string; sub: string; act: string; pick?: Omit<JointPick, 'share' | 'pct'>; off?: boolean }

/** "321,000" / "25%" / '' from a stored part. */
const typedOf = (m: { share: number | null; pct: number | null }) => (m.share != null ? fmtMoney(m.share) : m.pct != null ? m.pct + '%' : '');

/**
 * "สร้างใบเสนอราคาร่วม" (screen 10): the quotation's header on the left (its file, read for the number, date
 * and total; the job's name; the payer, from the registry or typed; services, owner, หมวด) and its companies
 * on the right (a search over this year's rows and the registry, each result saying what joining does:
 * "ใช้แถวเดิม" / "เพิ่มแถวใหม่"; a part each in baht or %, or an equal split; the sum against the total).
 * `from`: "รวมเป็นใบเสนอราคาร่วม" (that deal's quotation becomes the header's, the deal its first company);
 * `hid`: "แก้ไขรายชื่อ" of a joint quotation (its companies only).
 */
function JointEdit({ from, section, hid, onClose }: { from?: string; section?: string; hid?: string; onClose: () => void }) {
  const { engine: e, ui, set } = useApp();
  const acts = useSalesActs();
  const S = e.sales, C = S.cfg;
  const g = hid ? jointOf(S, { id: hid }) : null;
  const src = from ? S.deals[from] : undefined;
  const srcQt = src ? qtView(S, src).head?.doc : undefined;
  const year = g?.head.year || src?.year || ui.slYear;
  const money = e.can('view.money');
  const [file, setFile] = useState<File | null>(null);
  const [facts, setFacts] = useState<DocFacts | null>(null);
  const [reading, setReading] = useState('');
  const [docNo, setDocNo] = useState(srcQt?.docNo || '');
  const [docDate, setDocDate] = useState(srcQt?.docDate || '');
  const [title, setTitle] = useState('');
  const [payer, setPayer] = useState<{ name: string; gid: number | null }>({ name: '', gid: null });
  const [payerQ, setPayerQ] = useState(false);
  const [total, setTotal] = useState(srcQt?.amount != null ? fmtMoney(srcQt.amount) : '');
  const [service, setService] = useState(src?.service[0] || '');
  const [resp, setResp] = useState(src?.resp || e.me());
  const [sec, setSec] = useState(src?.section ?? section ?? (C.sections.includes('อื่นๆ') ? 'อื่นๆ' : C.sections[0] || ''));
  const [rows, setRows] = useState<Row[]>(() => {
    if (g) return g.members.map((x) => ({ key: x.deal.id, pick: { deal: x.deal.id }, name: x.deal.client, sub: rowSub(S, x.deal, 'reuse'), typed: typedOf(x.m), lock: !e.canDeal('edit.deal', x.deal) }));
    if (src) return [{ key: src.id, pick: { deal: src.id }, name: src.client, sub: `ใช้แถวเดิม · ใบเสนอราคา${srcQt?.docNo ? ' ' + srcQt.docNo : ''} ย้ายมาเป็นของใบเสนอราคาร่วม`, typed: '' }];
    return [];
  });
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const abort = useRef<AbortController | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const qIn = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const totalN = g ? dealMoney(S, g.head).forecast : parseAmount(total) ?? null;
  const shares = rows.map((r) => parseShare(r.typed));
  const picks = shares.map((x) => x || { share: null, pct: null });
  // the parts as the panel will show them (a company of this joint quotation that withdrew gets none)
  const out = rows.map((r) => !!g && !!r.pick.deal && g.members.some((x) => x.deal.id === r.pick.deal) && dealResult(S, S.deals[r.pick.deal]) === 'NO');
  const parts = pickParts(picks, totalN, out);
  const sum = sharesCheck(out.every(Boolean) ? picks : picks.filter((_, i) => !out[i]), totalN);
  const autoTitle = [service, payer.name].filter(Boolean).join(' ');

  /** Read the quotation's file: its number, date and total fill what is empty; the customer on it is the payer. */
  const pick = async (f: File) => {
    abort.current?.abort();
    setErr('');
    const bad = f.size > DOC_MAX_BYTES ? 'ไฟล์ใหญ่เกิน 10 MB' : !docMime(f) ? 'รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)' : '';
    if (bad) return setErr(`${bad} — เลือกไฟล์อื่น (${f.name})`);
    setFile(f);
    setFacts(null);
    const ctl = new AbortController();
    abort.current = ctl;
    setReading('กำลังอ่านไฟล์');
    try {
      const [{ readDocText }, { analyzeDocText, factsScore }] = await Promise.all([import('../lib/docText'), import('../lib/docExtract')]);
      const t = await readDocText(f, { signal: ctl.signal, onProgress: (msg) => setReading(msg), judge: (x) => factsScore(analyzeDocText(x)) });
      if (ctl.signal.aborted) return;
      const fx = analyzeDocText(t.text);
      setFacts(fx);
      if (fx.docNo) setDocNo(fx.docNo);
      if (fx.docDate) setDocDate(fx.docDate);
      const v = fx.total ?? fx.candidates[0]?.value ?? null;
      if (v != null) setTotal(fmtMoney(v));
      if (fx.party && !payer.name) {
        const c = e.B.companies.find((x) => norm(x.name) === norm(fx.party));
        setPayer({ name: c?.name || fx.party, gid: c?.id ?? null });
      }
    } catch {
      // nothing read: the fields are typed by hand
    } finally {
      if (!ctl.signal.aborted) setReading('');
    }
  };

  // the companies to add: this year's rows (not headers, not in another joint quotation), registry companies
  // not in the table, and the name typed
  const hits = useMemo<Hit[]>(() => {
    const k = norm(q);
    if (k.length < 2) return [];
    const inList = new Set(rows.map((r) => r.pick.deal).filter(Boolean));
    const gidsIn = new Set(rows.map((r) => r.pick.gid).filter((x) => x != null));
    const out: Hit[] = [];
    const yearDeals = Object.values(S.deals).filter((d) => d.year === year && d.id !== hid && !inList.has(d.id) && norm(d.client).includes(k));
    yearDeals.slice(0, 6).forEach((d) => {
      const fate = e.jointFate(d, hid || '');
      if (fate === 'taken' && S.jqt?.[d.id]) return; // a joint quotation's header is not a company to add
      out.push({
        key: 'd' + d.id, name: d.client, sub: rowSub(S, d, fate),
        act: fate === 'reuse' ? 'ใช้แถวเดิม' : fate === 'new' ? 'เพิ่มแถวใหม่' : '', off: fate === 'taken' || fate === 'locked',
        pick: fate === 'reuse' ? { deal: d.id } : { deal: d.id, like: d.id },
      });
    });
    const tracked = new Set(Object.values(S.deals).filter((d) => d.year === year && d.gid != null).map((d) => e.canonical(d.gid!)));
    e.B.companies
      .filter((c) => !tracked.has(c.id) && !gidsIn.has(c.id) && norm(c.name).includes(k))
      .slice(0, Math.max(0, 7 - out.length))
      .forEach((c) => out.push({ key: 'c' + c.id, name: c.name, sub: 'ในทะเบียน · ยังไม่อยู่ในตาราง', act: 'เพิ่มแถวใหม่', pick: { gid: c.id } }));
    const typed = q.trim();
    if (typed && !out.some((h) => norm(h.name) === k)) out.push({ key: 't' + typed, name: typed, sub: 'ไม่มีในทะเบียน · เพิ่มเป็นลูกค้าใหม่', act: 'เพิ่มแถวใหม่', pick: { name: typed } });
    return out;
  }, [q, rows, S, e, year, hid]);
  const add = (h: Hit) => {
    if (h.off || !h.pick) return;
    setRows([...rows, { key: h.key, pick: h.pick, name: h.name, sub: h.sub.startsWith('ในทะเบียน') || h.sub.startsWith('ไม่มีในทะเบียน') ? 'เพิ่มแถวใหม่ · ' + h.sub : (h.act === 'ใช้แถวเดิม' ? 'ใช้แถวเดิม · ' : 'เพิ่มแถวใหม่ · ') + h.sub, typed: '' }]);
    setQ('');
    qIn.current?.focus();
  };
  // the payer: registry companies by name (the name typed stays a free-text payer)
  const payerHits = useMemo(() => {
    const k = norm(payer.name);
    if (!payerQ || k.length < 2) return [];
    return e.B.companies.filter((c) => norm(c.name).includes(k)).slice(0, 6);
  }, [payer.name, payerQ, e]);

  const save = async () => {
    setErr('');
    const bad = rows.findIndex((_, i) => !shares[i]);
    if (bad >= 0) return setErr(`ส่วนแบ่งของ ${shortName(rows[bad].name)} อ่านไม่ได้ พิมพ์ยอด เช่น 321,000 หรือ 25%`);
    const members: JointPick[] = rows.map((r, i) => ({ ...r.pick, ...shares[i]! }));
    if (g) {
      e.setJointMembers(g.head.id, members);
      onClose();
      acts.say(`บันทึกรายชื่อบริษัทของใบเสนอราคาร่วมแล้ว · ${rows.length} บริษัท`);
      return;
    }
    if (!payer.name.trim()) return setErr('ใส่ผู้จ่าย (ผู้ที่ใบเสนอราคาส่งถึง)');
    if (!rows.length) return setErr('เพิ่มบริษัทในใบเสนอราคานี้อย่างน้อย 1 บริษัท');
    const tn = parseAmount(total);
    if (tn === undefined) return setErr('อ่านยอดรวมไม่ได้ พิมพ์ตัวเลขเดียว เช่น 1,284,000');
    const basis: DealDoc['basis'] = facts && tn != null ? (tn === facts.total ? 'total' : tn === facts.subtotal ? 'subtotal' : tn === facts.netPay ? 'netPay' : 'manual') : 'manual';
    setBusy('กำลังสร้าง');
    try {
      const r = await e.createJoint({
        title: title.trim() || autoTitle, payer: payer.name, payerGid: payer.gid, year, section: sec, resp, service: service ? [service] : [],
        total: tn, docNo: docNo.trim(), docDate, file: file || undefined, basis, detected: basis === 'manual' ? tn : tn, from, members,
      });
      onClose();
      set({ deal: r.hid });
      acts.say(r.attachErr ? `สร้างใบเสนอราคาร่วมแล้ว แต่แนบไฟล์ไม่สำเร็จ: ${r.attachErr} · แนบใหม่ได้ที่การ์ดใบเสนอราคา` : `สร้างใบเสนอราคาร่วมแล้ว · ${rows.length} บริษัท${tn != null ? ' · นับยอด ' + fmtMoney(tn) + ' บาทครั้งเดียว' : ''}`, { ms: r.attachErr ? 0 : 6000 });
    } catch (x) {
      setBusy('');
      setErr('สร้างไม่สำเร็จ: ' + ((x as Error)?.message || x));
    }
  };

  const team = [...new Set([...e.crm.team, resp, e.me()].filter(Boolean))];
  /** who a new row of a registry company, or of a name typed, is followed up by (engine.addDeal) */
  const newResp = (p: Row['pick']) => (p.gid != null && e.crm.owners[e.company(p.gid)?.id ?? p.gid]) || e.me();
  const head = !g && (
    <div className="jc-sec">
      <div className="jc-h"><b>หัวใบเสนอราคา</b></div>
      {src ? (
        <div className="jc-lab">
          <span>ไฟล์ใบเสนอราคา</span>
          <span className="jc-file"><span className="t-sec">{srcQt ? `${srcQt.docNo || srcQt.name} ของ ${shortName(src.client)} · ย้ายมาพร้อมทุกฉบับ` : 'ไม่มีใบเสนอราคา'}</span></span>
        </div>
      ) : (
        <div className="jc-lab">
          <span>ไฟล์ใบเสนอราคา · ระบบอ่านเลขที่ วันที่ และยอดให้</span>
          <span className="jc-file">
            <button type="button" className="btn sm" onClick={() => fileIn.current?.click()}>{file ? 'เลือกไฟล์อื่น' : 'เลือกไฟล์'}</button>
            <span className="t-sec" title={file?.name}>{reading || file?.name || 'ยังไม่ได้เลือก · แนบทีหลังได้ที่การ์ดใบเสนอราคา'}</span>
            <input ref={fileIn} type="file" accept={DOC_ACCEPT} hidden onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) void pick(f); }} />
          </span>
        </div>
      )}
      <div className="jc-g2">
        <label className="jc-lab">เลขที่ใบเสนอราคา<input className="fld" value={docNo} maxLength={60} disabled={!!src} onChange={(ev) => setDocNo(ev.target.value)} placeholder="เช่น QT-2569-052" /></label>
        <span className="jc-lab">ลงวันที่<DateField value={docDate} onChange={setDocDate} label="ลงวันที่" placeholder="ไม่ระบุ" /></span>
      </div>
      <label className="jc-lab">ชื่องาน<input className="fld" value={title} maxLength={200} placeholder={autoTitle || 'เช่น CFP มหาวิทยาลัย…'} onChange={(ev) => setTitle(ev.target.value)} /></label>
      <div className="jc-lab jc-payer">
        <span id="jc-payer-l">ผู้จ่าย / ส่งใบเสนอราคาถึง</span>
        <input
          className="fld"
          aria-labelledby="jc-payer-l"
          value={payer.name}
          placeholder="พิมพ์ชื่อเพื่อค้นในทะเบียน หรือพิมพ์เอง"
          onChange={(ev) => (setPayer({ name: ev.target.value, gid: null }), setPayerQ(true))}
          onBlur={() => setTimeout(() => setPayerQ(false), 150)}
        />
        {payer.gid != null && <small className="t-meta">ในทะเบียน · {e.company(payer.gid)?.code || ''}</small>}
        {payerHits.length > 0 && (
          <div className="menu jc-res" role="listbox" aria-label="บริษัทในทะเบียน">
            {payerHits.map((c) => (
              <button key={c.id} type="button" role="option" aria-selected={false} className="menu-i" onMouseDown={(ev) => ev.preventDefault()} onClick={() => (setPayer({ name: c.name, gid: c.id }), setPayerQ(false))}>
                <span>{c.name}<small>{c.code}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="jc-g2">
        <label className="jc-lab">ยอดรวม (บาท) · รวม VAT<input className="fld jc-tot" value={total} inputMode="decimal" disabled={!!src} onChange={(ev) => setTotal(ev.target.value)} placeholder="เช่น 1,284,000" aria-invalid={parseAmount(total) === undefined} /></label>
        <SelField className="jc-lab" text="Services" value={service} onChange={setService} options={[{ v: '', label: 'ไม่ระบุ' }, ...C.services.map((x) => ({ v: x, label: x }))]} />
      </div>
      <div className="jc-g2">
        <SelField className="jc-lab" text="ผู้รับผิดชอบ" value={resp} onChange={setResp} options={team.map((x) => ({ v: x, label: x }))} />
        <SelField className="jc-lab" text="หมวด" value={sec} onChange={setSec} options={[...new Set([...C.sections, sec])].map((x) => ({ v: x, label: x || 'ไม่ระบุหมวด' }))} />
      </div>
    </div>
  );
  const list = (
    <div className="jc-sec">
      <div className="jc-h">
        <b>บริษัทในใบเสนอราคานี้ · {fmtN(rows.length)} บริษัท</b>
        {rows.length > 1 && <button type="button" className="lnk" onClick={() => setRows(rows.map((r) => ({ ...r, typed: '' })))}>แบ่งเท่ากัน</button>}
      </div>
      <div className="jc-add">
        <label className="jc-q">
          <Icon name="search" size={16} />
          <input ref={qIn} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="ค้นหาบริษัทเพื่อเพิ่ม (ปีนี้ หรือในทะเบียน)" aria-label="ค้นหาบริษัทเพื่อเพิ่ม" onKeyDown={(ev) => ev.key === 'Enter' && hits[0] && (ev.preventDefault(), add(hits.find((h) => !h.off) || hits[0]))} />
        </label>
        {hits.length > 0 && (
          <div className="menu jc-res" role="listbox" aria-label="ผลการค้นหา">
            {hits.map((h) => (
              <button key={h.key} type="button" role="option" aria-selected={false} aria-disabled={h.off} className={'menu-i' + (h.off ? ' off' : '')} onClick={() => add(h)}>
                <span>{h.name}<small>{h.sub}</small></span>
                {h.act && <em>{h.act}</em>}
              </button>
            ))}
          </div>
        )}
      </div>
      {rows.length > 0 ? (
        <div className={'jc-list' + (money ? '' : ' nomoney')} role="table" aria-label="บริษัทในใบเสนอราคานี้">
          <div className="jc-r ph" role="row"><span role="columnheader">บริษัท · แถวใน Sales Tracker</span>{money && <><span role="columnheader" className="r">ส่วนแบ่ง (บาท)</span><span role="columnheader" className="r">%</span></>}<span /></div>
          {rows.map((r, i) => (
            <div key={r.key} className="jc-r" role="row">
              <span className="jc-nm" role="cell"><b className="co-name dense" title={r.name}>{shortName(r.name)}</b><small title={r.sub}>{pickLine(S, r.pick, g ? g.head.section : sec, newResp(r.pick))}</small></span>
              {money && (
                <>
                  <input className="fld" role="cell" value={r.typed} inputMode="decimal" placeholder={out[i] ? 'ถอนตัว' : parts.amt ? fmtMoney(parts.amt[i]) || '0' : 'เท่ากัน'} aria-label={'ส่วนแบ่ง ' + r.name} aria-invalid={!shares[i]} onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, typed: ev.target.value } : x)))} />
                  <span className="jc-pct" role="cell">{out[i] && !out.every(Boolean) ? '—' : parts.pct[i] + '%'}</span>
                </>
              )}
              <button type="button" className="quiet" role="cell" disabled={r.lock} title={r.lock ? 'แถวของคนอื่น บัญชีของคุณเอาออกไม่ได้' : undefined} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={'เอาออก ' + r.name}>เอาออก</button>
            </div>
          ))}
        </div>
      ) : (
        <span className="empty-box">ยังไม่มีบริษัท ค้นหาแล้วเลือก บริษัทที่มีแถวปีนี้อยู่แล้วใช้แถวเดิมได้ ถ้าแถวนั้นมีงานของตัวเองแล้ว (ใบเสนอราคา ยอดรับเงิน แผนชำระ หรือปิดงานแล้ว) ระบบเพิ่มแถวใหม่ให้ ยอดเดิมไม่หาย</span>
      )}
      {money && rows.length > 0 && (
        <div className="jc-sum">
          <span>ส่วนแบ่งไม่บังคับ ช่องว่างแบ่งเท่ากัน ใช้แบ่งยอดตามคนและหน่วยงาน</span>
          <span className={sum.warn ? 't-warn' : ''}>{sum.text}</span>
        </div>
      )}
    </div>
  );
  return (
    <Modal title={g ? 'แก้ไขรายชื่อบริษัท' : 'สร้างใบเสนอราคาร่วม'} onClose={onClose} width={g ? 640 : 1040}>
      <span className="sl-dlg-sub">{g ? `${jointTitle(S, g)} · ยอดนับครั้งเดียวที่ใบเสนอราคาร่วม แต่ละบริษัทยังมีแถวติดตามของตัวเอง` : 'ใบเสนอราคาใบเดียวที่ครอบคลุมหลายบริษัท ยอดนับครั้งเดียว แต่ละบริษัทยังมีแถวติดตามของตัวเอง'}</span>
      <div className={g ? 'jc-one' : 'jc-cols'}>
        {head}
        {list}
      </div>
      {err && <Notice kind="error" role="alert">{err}</Notice>}
      <DialogActions>
        <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn pri" disabled={!!busy || !!reading} onClick={() => void save()}>{busy || (g ? 'บันทึกรายชื่อ' : 'สร้างใบเสนอราคาร่วม')}</button>
      </DialogActions>
    </Modal>
  );
}
/** What joining does to a row of the year, in the picker and the dialog's list. */
function rowSub(S: SalesState, d: Deal, fate: RowFate) {
  // (the row's services first: a company's CFO job and its CFP job are told apart)
  const where = [svcText(jobServices(S, d)) || 'ยังไม่ระบุบริการ', d.section || 'ไม่ระบุหมวด', d.resp].filter(Boolean).join(' · ');
  if (fate === 'taken') return 'อยู่ในใบเสนอราคาร่วมอื่นแล้ว';
  if (fate === 'locked') return `งานของ ${d.resp || 'คนอื่น'} · บัญชีของคุณแก้ไขแถวนี้ไม่ได้ ให้ผู้รับผิดชอบหรือหัวหน้าเพิ่ม`;
  const why = ownJob(S, d);
  return fate === 'new' && why ? `${OWN_TH[why]} · แถวเดิมและยอดเดิมยังอยู่ · ${where}` : `อยู่ในตารางปีนี้แล้ว · ${stepOf(S, d.id, QUOTE_STAGE).n.trim() ? 'ยังไม่มีใบเสนอราคาของตัวเอง' : 'ยังไม่มีใบเสนอราคา'} · ${where}`;
}

/**
 * "ปิดงานใบเสนอราคาร่วม?" (screen 13): it closes the header and every company at once, so it always asks. Every
 * company with its result and part, the total counted once, where the payer's payment stands.
 */
function JointClose({ hid, onClose }: { hid: string; onClose: () => void }) {
  const { engine: e, set } = useApp();
  const S = e.sales, today = todayISO();
  const g = jointOf(S, { id: hid });
  if (!g) return null;
  const sum = closeSummary(S, g, today), v = qtView(S, g.head).head, money = e.can('view.money');
  // it closes as one: a company this account may not edit stops it (named, with its owner)
  const block = e.jointCloseBlock(hid);
  // what it then counts (mockup m3): 1 job, and its companies won as the ปิดงาน tab will count them (the
  // engine's workTally over the tracker as closing leaves it: the payer's result recorded for those without one)
  const A = closedJoint(S, g, today);
  const count = jointCloseCount({
    worked: e.workTally(g.members.map((x) => A.deals[x.deal.id]), { s: A }).worked,
    fill: sum.fill,
    filled: sum.rows.filter((x) => x.by).length,
    waiting: sum.rows.filter((x) => !/^(YES|NO)$/.test(x.after)).length,
    payer: payerShort(g),
  });
  const go = () => {
    const n = e.closeJoint(hid);
    if (!n && e.jointCloseBlock(hid)) return;
    onClose();
    set((s) => ({
      deal: s.deal && (s.deal === hid || g.members.some((x) => x.deal.id === s.deal)) ? null : s.deal,
      slToast: n ? { text: `ย้ายใบเสนอราคาร่วม ${jointShort(g)} และ ${fmtN(sum.open)} บริษัทไปแท็บปิดงานแล้ว`, ms: 8000, n: (s.slToast?.n || 0) + 1, acts: [{ label: 'ดูแท็บปิดงาน', act: 'closedTab', primary: true }, { label: 'เลิกทำ', act: 'jqUndo', deal: hid }] } : s.slToast,
    }));
  };
  return (
    <Modal title="ปิดงานใบเสนอราคาร่วม?" onClose={onClose} width={560} focus="dialog">
      <p className="jx-p">
        {[jointNo(S, g), jointShort(g)].filter(Boolean).join(' · ')}
        <small>ผู้จ่าย {g.head.client}{v ? ` · ฉบับที่ ${v.n}` : ''}</small>
      </p>
      <div className="jx-list" role="table" aria-label="บริษัทในใบเสนอราคานี้">
        <div className="jx-r ph" role="row"><span role="columnheader">บริษัท</span><span role="columnheader">ผล</span><span role="columnheader" className="r">{money ? 'ส่วนแบ่ง (บาท)' : ''}</span></div>
        {sum.rows.map((x) => (
          <div key={x.deal.id} className="jx-r" role="row">
            <span role="cell"><span className="co-name dense" title={x.deal.client}>{shortName(x.deal.client)}</span>{x.closed && <small className="t-meta"> · ปิดแล้ว</small>}</span>
            {/* a company without a result shows the one closing records for it: the payer's */}
            <span role="cell" className="jx-res"><ResultWord r={x.after} />{x.by && <small className="jx-by">ตามผู้จ่าย</small>}</span>
            <span role="cell" className="r">{money ? (x.share != null && x.after !== 'NO' ? fmtMoney(x.share) : <span className="none">—</span>) : ''}</span>
          </div>
        ))}
        {money && <div className="jx-r sum" role="row"><span role="cell">รวม นับครั้งเดียว</span><span role="cell" /><span role="cell" className="r">{m0(sum.total)}</span></div>}
      </div>
      <p className="jx-n">
        {money && <>{sum.pay}<br /></>}
        <b>{count.count}</b>
        {count.more.map((x) => ' · ' + x).join('')}
      </p>
      {block && <Notice kind="error" role="alert">{block}</Notice>}
      <DialogActions>
        <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn pri" disabled={!!block} onClick={go}>{sum.open ? `ปิดงานทั้ง ${fmtN(sum.open)} บริษัท` : 'ปิดงานใบเสนอราคาร่วม'}</button>
      </DialogActions>
    </Modal>
  );
}
/** A member's result in words (dot + word). */
function ResultWord({ r }: { r: string }) {
  return r === 'YES' ? <Status kind="ok">ได้งาน</Status> : r === 'NO' ? <Status kind="bad">ไม่ได้งาน</Status> : r === 'WAIT' ? <Status kind="warn">รอผล</Status> : <Status kind="neutral">ยังไม่มีผล</Status>;
}

// ------------------------------------------------------------------ the table (screen 11)

/** A member's figure in the table, grey and never summed: its part of the quotation ("321,000 · ส่วนแบ่ง
 *  25%") under Forecast, its part of what the payer paid under Actual; a company that withdrew: "ถอนตัว". */
export function JointShare({ S, d, col }: { S: SalesState; d: Deal; col: 'fc' | 'ac' }) {
  const v = shareOf(S, d);
  if (!v) return <span className="sl-mn"><b className="none">—</b></span>;
  if (v.out) return <span className="sl-mn jq-sh"><b className="none">—</b>{col === 'fc' && <small>{outWord(S, d)}</small>}</span>;
  const title = `ส่วนแบ่งใน ${jointNo(S, v.g) || 'ใบเสนอราคาร่วม'} · นับยอดครั้งเดียวที่ใบเสนอราคาร่วม ไม่นับซ้ำในยอดรวม`;
  if (col === 'fc') return <span className="sl-mn jq-sh" title={title}><b className="share">{v.amt != null ? fmtMoney(v.amt) : v.pct + '%'}</b><small>ส่วนแบ่ง {v.pct}%</small></span>;
  const ac = dealMoney(S, v.g.head).actual;
  const i = v.g.members.findIndex((x) => x.deal.id === d.id);
  const part = ac ? jointSplit(S, v.g, ac)[i] : 0;
  return part ? <span className="sl-mn jq-sh" title={title}><b className="share">{fmtMoney(part)}</b><small>ส่วนแบ่ง</small></span> : <span className="sl-mn"><b className="none">—</b></span>;
}

/** The band's ⋯ menu: words only, Escape or a click elsewhere closes it, arrows move through it. */
function JMenu({ label, items }: { label: string; items: { label: string; sub?: string; act: () => void; sep?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  return (
    <span
      ref={ref}
      className="sl-actw jq-mw"
      onBlur={(ev) => open && !ev.currentTarget.contains(ev.relatedTarget as Node) && setOpen(false)}
      onKeyDown={(ev) => {
        if (!open) return;
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          close();
        } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') || [])];
          const i = all.indexOf(document.activeElement as HTMLElement);
          all[(i + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
          ev.preventDefault();
        }
      }}
    >
      <button ref={btn} type="button" className="sl-more hv" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <span role="menu" className="menu sl-menu sl-rowmenu" aria-label={label}>
          {items.map((x) => (
            <Fragment key={x.label}>
              {x.sep && <hr />}
              <button role="menuitem" type="button" className="menu-i" onClick={() => (close(), x.act())}>
                {x.label}
                {x.sub && <small>{x.sub}</small>}
              </button>
            </Fragment>
          ))}
        </span>
      )}
    </span>
  );
}

/** The quotation's check (package notify) for the band's and the card's status, when it has one. */
function useHeadCheck(S: SalesState, g: JointGroup) {
  const { engine: e } = useApp();
  const doc = qtView(S, g.head).head?.doc;
  const cv = doc ? e.qtCheckFor(doc) : null;
  // while it waits: who the team script told (as this browser heard it), else since when
  return doc && cv ? { doc, cv, short: waitShort(e.qtSentFor(doc), doc, e.qtSentCtx()) } : null;
}
/** What the band's and the card's status cell says: the quotation's check, else the payer's state. */
function HeadState({ S, g, compact }: { S: SalesState; g: JointGroup; compact?: boolean }) {
  const ck = useHeadCheck(S, g);
  if (ck) return compact ? <QtCheckLine doc={ck.doc} v={ck.cv} bare /> : <span className="jq-st"><QtCheckLine doc={ck.doc} v={ck.cv} bare /><small>{ck.cv.rec ? checkedLine(ck.cv.rec) : ck.cv.stale ? 'แก้หลังตรวจ' : ck.short}</small></span>;
  const sv = statusView(S, g.head, todayISO());
  return <span className="jq-st"><Status kind={sv.kind}>{sv.word}</Status>{!compact && sv.sub && <small>{sv.sub}</small>}</span>;
}

type BandPart = ReturnType<typeof bandPart>;
const PART_T = 'ตัวกรองผู้รับผิดชอบ / SOURCE / แหล่งที่มา นับเฉพาะส่วนแบ่งของบริษัทที่แสดง';
const NONE_T = 'ใบเสนอราคาร่วมนี้ไม่อยู่ในรายการตามตัวกรอง (แสดงเพราะมีบริษัทในใบนี้) ยอดจึงไม่นับในยอดของหมวดและ KPI';
/**
 * A band's figure as the view counts it beside the section's sum (lib/joint bandPart): the whole, once (with
 * `note`, e.g. "นับครั้งเดียว"); the part of the companies shown, "จาก" the whole; or, when the view counts none
 * of it, the whole muted with "ไม่นับในมุมมองนี้".
 */
function BandFig({ v, bp, note, children }: { v: number | null; bp: BandPart; note?: ReactNode; children?: ReactNode }) {
  if (v == null) return <span className="sl-mn"><b className="none">—</b>{bp.whole && note}</span>;
  if (bp.none) return <span className="sl-mn" title={NONE_T}><b className="none">{m0(v)}</b><small>ไม่นับในมุมมองนี้</small></span>;
  if (!bp.whole) return <span className="sl-mn" title={PART_T}><b>{m0(bp.part(v))}</b><small>จาก {m0(v)}</small></span>;
  return <span className="sl-mn"><b>{m0(v)}</b>{note}{children}</span>;
}

/**
 * A joint quotation in the table: the band ("ใบเสนอราคาร่วม QT-… · CFP มจพ", "4 บริษัท · ผู้จ่าย … · หมิว", the
 * day it was sent, the Forecast counted once, the Actual, the check, ⋯), then its members' rows (`children`,
 * drawn by the table with their left edge), then a small gap. Its caret folds the members away. `onRevise`:
 * "แนบใบเสนอราคาฉบับแก้ไข" opens the attach dialog for that version (the table hosts it).
 */
export function JointBand({ b, folded, onFold, ro, cash, attr, onOpen, onRevise, children }: { b: Extract<JRow, { k: 'band' }>; folded: boolean; onFold: () => void; ro: boolean; cash: CashLens | null; attr?: boolean; onOpen: (id: string, plan?: '' | 'edit') => void; onRevise?: (docId: string) => void; children: ReactNode }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const S = e.sales, g = b.g, h = g.head, today = todayISO();
  const money = e.can('view.money');
  const m = dealMoney(S, h), P = dealResult(S, h) === 'YES' ? payState(S, h, today).plan : null;
  // what of its money the view counts, as the section's sum does: the whole, the parts of the companies shown
  // (a ผู้รับผิดชอบ / SOURCE / REFERRAL filter), or none (its header filtered out)
  const bp = bandPart(S, b, !!attr), pt = bp.part;
  const sent = sentDay(S, g), title = jointTitle(S, g), part = closedWord(g);
  const qv = qtView(S, h).head;
  const canEdit = !ro && e.canJoint();
  const items = [
    { label: 'เปิดรายละเอียด', act: () => onOpen(h.id) },
    ...(canEdit ? [{ label: 'แก้ไขรายชื่อบริษัท', sub: `${g.members.length} บริษัท`, act: () => set({ jqDlg: { k: 'members', hid: h.id } }) }] : []),
    ...(!ro && qv && onRevise ? [{ label: 'แนบใบเสนอราคาฉบับแก้ไข', sub: `${qv.doc.docNo || 'ใบเสนอราคา'} · ตอนนี้ฉบับที่ ${qv.n}`, act: () => onRevise(qv.doc.id) }] : []),
    ...(!ro && money ? [{ label: 'แผนการชำระเงิน', sub: P ? 'แก้ไขแผนของผู้จ่าย' : 'ตั้งแผนของผู้จ่าย', act: () => onOpen(h.id, 'edit') }] : []),
    ...(e.canExp(h) ? [{ label: 'บันทึกค่าใช้จ่าย', sub: 'ค่าใช้จ่ายของใบเสนอราคาร่วม', act: () => openExp(h.id) }] : []),
    ...(!ro && h.jobStatus === 'open' ? [{ label: 'ปิดงาน', sub: `ปิดทั้งใบเสนอราคาและ ${g.members.length} บริษัท (ถามยืนยัน)`, act: () => acts.close(h.id), sep: true }] : []),
  ];
  return (
    <>
      <tr className="jq-gap" aria-hidden="true"><td colSpan={10} /></tr>
      <tr className={'jq-band' + (folded ? ' folded' : '')} data-jqt={h.id}>
        <td className="k-chev">
          <button type="button" className="sl-caret hv2" aria-expanded={!folded} aria-label={`${folded ? 'แสดง' : 'ย่อ'}บริษัทใน${title}`} onClick={onFold}><Chevron /></button>
        </td>
        <th scope="rowgroup" colSpan={4} className="k-name">
          <span className="jq-in">
            <button type="button" className="jq-nm hv-tx" onClick={() => onOpen(h.id)} title={`${g.qt.title || title} เปิดรายละเอียด`}>{title}</button>
            <span className="jq-sub" title={jointSub(g)}>{jointSub(g)}{part ? ' · ' + part : ''}</span>
          </span>
        </th>
        <td className="k-last"><span className="jq-kdate">{sent ? isoTh(sent) : '—'}<small>{sent ? 'ส่งใบเสนอราคา' : 'ยังไม่ได้ส่ง'}</small></span></td>
        <td className="k-fc">
          {money && (cash ? <LensMoney L={cash} d={h} col="fc" won={dealResult(S, h) === 'YES'} /> : (
            <BandFig v={m.forecast} bp={bp} note={<small title="ยอดของใบเสนอราคาร่วมนับครั้งเดียวที่นี่ ส่วนแบ่งของแต่ละบริษัทไม่นับซ้ำ">นับครั้งเดียว</small>}>
              {m.actual != null && <span className="sl-ac2">Actual <b>{fmtMoney(m.actual)}</b></span>}
            </BandFig>
          ))}
        </td>
        <td className="k-ac">
          {money && (cash ? <LensMoney L={cash} d={h} col="ac" won={dealResult(S, h) === 'YES'} /> : bp.none ? (
            <span className="sl-mn" title={NONE_T}><b className="none">—</b></span>
          ) : (
            <span className="sl-mn">
              <b className={P ? (P.got ? '' : 'none') : m.actual == null ? 'none' : ''}>{P ? (P.got ? fmtMoney(pt(P.got)) || '0' : '—') : m.actual == null ? '—' : m0(pt(m.actual))}</b>
              {P && (P.left ? <small className={P.late.length ? 'bad' : ''}>ค้าง {fmtMoney(pt(P.left)) || '0'}</small> : <small className="ok">รับครบ</small>)}
            </span>
          ))}
        </td>
        <td className="k-st"><HeadState S={S} g={g} /></td>
        <td className="k-act"><JMenu label={'เพิ่มเติม ' + title} items={items} /></td>
      </tr>
      {children}
      <tr className="jq-gap" aria-hidden="true"><td colSpan={10} /></tr>
    </>
  );
}

/**
 * A joint quotation on a phone (screen 15): one card in its section: the quotation, the Forecast counted
 * once (as the view counts it: `attr`, lib/joint bandPart), its check (else the payer's state, said so), and
 * its companies (a tap opens that company's row, where its steps are recorded); "รายละเอียด" opens the joint
 * quotation. The members are not repeated as cards of their own.
 */
export function JointCard({ b, attr, onOpen }: { b: Extract<JRow, { k: 'band' }>; attr?: boolean; onOpen: (id: string) => void }) {
  const { engine: e } = useApp();
  const S = e.sales, g = b.g, h = g.head, today = todayISO(), money = e.can('view.money');
  const m = dealMoney(S, h), sent = sentDay(S, g), no = jointNo(S, g);
  const shares = memberShares(S, g);
  const bp = bandPart(S, b, !!attr);
  const checked = !!useHeadCheck(S, g);
  const list = b.shown.length ? b.shown : [];
  return (
    <article className="jm" aria-label={jointTitle(S, g)} data-jqt={h.id}>
      <div className="jm-h">
        <span className="jm-l">ใบเสนอราคาร่วม · {fmtN(g.members.length)} บริษัท{closedWord(g) ? ' · ' + closedWord(g) : ''}</span>
        <button type="button" className="jm-nm hv-tx" onClick={() => onOpen(h.id)}>{[no, jointShort(g)].filter(Boolean).join(' · ')}</button>
        <span className="jm-s">{['ผู้จ่าย ' + payerShort(g), h.resp, sent ? 'ส่ง ' + dmTh(sent) : 'ยังไม่ได้ส่ง'].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="jm-money">
        {money && <div className="sl-mc-m"><span>Forecast</span><BandFig v={m.forecast} bp={bp} note={<small>นับครั้งเดียว</small>} /></div>}
        <div className="sl-mc-m"><span>{checked ? 'ตรวจใบเสนอราคา' : 'สถานะ'}</span><HeadState S={S} g={g} compact /></div>
      </div>
      <div className="jm-list">
        {list.map((d) => {
          const i = g.members.findIndex((x) => x.deal.id === d.id), sh = shares[i];
          const c = d.gid != null ? e.company(d.gid) : undefined;
          const nx = nextStepView(S, d, today);
          return (
            <button key={d.id} type="button" className="jm-r hv" onClick={() => onOpen(d.id)} aria-label={`${d.client} เปิดแถวติดตาม`}>
              <CoAvatar name={c?.name || d.client} web={c?.web} set={c?.set} size={30} />
              <span className="jm-t"><b className="co-name dense" title={d.client}>{shortName(d.client)}</b><small>{[d.resp, nx.code ? 'ถัดไป ' + nx.code : nx.hint].filter(Boolean).join(' · ')}</small></span>
              {money && sh && <span className="jm-a">{sh.out ? <><span>—</span><small>ถอนตัว</small></> : <><span>{sh.amt != null ? fmtMoney(sh.amt) : sh.pct + '%'}</span><small>ส่วนแบ่ง {sh.pct}%</small></>}</span>}
            </button>
          );
        })}
      </div>
      <div className="jm-f"><span>แตะชื่อบริษัทเพื่อบันทึกขั้นตอนของบริษัทนั้น</span><button type="button" className="lnk" onClick={() => onOpen(h.id)}>รายละเอียด</button></div>
    </article>
  );
}

// ------------------------------------------------------------------ ปิดงาน (screen 14)

/** A joint quotation in the ปิดงาน list: its band (results "ได้ 3 · ไม่ได้ 1", the Forecast and Actual once, as
 *  the list's sum counts them: `attr`, lib/joint bandPart) and its closed companies under it (their parts grey,
 *  a withdrawn one "ถอนตัว"). It reopens as one, from its band (`onReopen`, engine.reopenJoint): a company has no
 *  reopen of its own here (owner text, mockups m1 / m2); its panel's "เปิดใบเสนอราคาร่วมอีกครั้ง" is the same. */
export function JointClosedRows({ b, attr, onReopen }: { b: Extract<JRow, { k: 'band' }>; attr?: boolean; onReopen?: () => void }) {
  const { engine: e, set } = useApp();
  const S = e.sales, g = b.g, h = g.head, today = todayISO(), money = e.can('view.money');
  const m = dealMoney(S, h), P = payState(S, h, today).plan, v = qtView(S, h);
  const part = closedWord(g), bp = bandPart(S, b, !!attr);
  return (
    <>
      <tr className="jq-cband" data-jqt={h.id}>
        {/* the name spans ลูกค้า, หมวด and ผู้รับผิดชอบ, so the job's name and its line are read whole */}
        <td colSpan={3}>
          <span className="jq-in">
            <button type="button" className="jq-nm hv-tx" onClick={() => set({ deal: h.id })} title={g.qt.title}>{jointTitle(S, g)}</button>
            <span className="jq-sub">{[`${g.members.length} บริษัท`, 'ผู้จ่าย ' + h.client, v.cur ? `ฉบับที่ ${v.cur.n}` : '', part].filter(Boolean).join(' · ')}</span>
          </span>
        </td>
        <td><span className="jq-res">{resultsWord(S, g) || 'ยังไม่มีผล'}</span></td>
        <td className="r">{money && <BandFig v={m.forecast} bp={bp} note={<small className={m.fcConfirmed ? 'ok' : ''}>{m.fcDoc ? (v.cur && v.versions.length > 1 ? `จากเอกสาร ฉบับที่ ${v.cur.n}` : 'จากเอกสาร') : 'นับครั้งเดียว'}</small>} />}</td>
        <td className="r c-opt">{money && <BandFig v={m.actual} bp={bp} note={P && <small className={P.left ? '' : 'ok'}>{P.left ? `ค้าง ${fmtMoney(bp.part(P.left))}` : `รับครบ ${P.n} งวด`}</small>} />}</td>
        <td className="c-opt t-sec">{h.jobStatus === 'closed' && h.closedDate ? isoTh(h.closedDate) : 'ยังเปิดอยู่'}</td>
        <td className="r">{onReopen && (h.jobStatus === 'closed' || b.shown.some((d) => d.jobStatus === 'closed')) && <button type="button" className="lnk sl-reopen" onClick={onReopen} title="เปิดกลับทั้งใบเสนอราคาและทุกบริษัท">เปิดงานอีกครั้ง</button>}</td>
      </tr>
      {b.shown.map((d, i) => {
        const r = dealResult(S, d);
        return (
          <tr key={d.id} className={'jq-cm' + (i === b.shown.length - 1 ? ' last' : '')}>
            <td><button type="button" className="sl-nm-b hv-tx co-name dense" onClick={() => set({ deal: d.id })} title={d.client}>{shortName(d.client)}</button></td>
            <td className="c-opt t-sec">{d.section || 'ไม่ระบุหมวด'}</td>
            <td className="c-opt">{d.resp || '—'}</td>
            <td><ResultWord r={r} /></td>
            <td className="r">{money && <JointShare S={S} d={d} col="fc" />}</td>
            <td className="r c-opt">{money && <JointShare S={S} d={d} col="ac" />}</td>
            <td className="c-opt t-sec">{d.closedDate ? isoTh(d.closedDate) : '—'}</td>
            <td className="r" />
          </tr>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ the panels (screens 12, 12b)

/** The joint quotation's name in the panel's head, edited in place (saved on leaving it, or Enter). */
function TitleBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <input
      key={value}
      defaultValue={value}
      aria-label="ชื่องาน"
      className="dp-name hv"
      onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
      onBlur={(ev) => {
        const v = ev.currentTarget.value.trim();
        if (!v) ev.currentTarget.value = value;
        else if (v !== value) onSave(v);
      }}
    />
  );
}

type Attach = (entry: AttachEntry, file?: File) => void;
/**
 * The joint quotation's panel (the header deal's): its name, number, payer, owner and companies; สถานะ /
 * Forecast / Actual / ค้างรับ; the companies with their parts, next steps and states ("แก้ไขรายชื่อ"); the
 * quotation (QtCard: revisions, check); the payer's decision (CLOSED DEAL of the header: the plan's due
 * dates count from it); the payer's payment plan; the quotation's details; its history; "ยกเลิกใบเสนอราคาร่วม".
 * The deal panel hosts it (its keyboard, Escape, the attach dialog) and passes its own cards in.
 */
export function JointPanel({ d, panelRef, close, attach, plan, info, history }: { d: Deal; panelRef: RefObject<HTMLElement | null>; close: () => void; attach: Attach; plan: ReactNode; info: ReactNode; history: ReactNode }) {
  const { engine: e, set } = useApp();
  const acts = useSalesActs();
  const S = e.sales, today = todayISO();
  const g = jointOf(S, d);
  if (!g) return null;
  const hid = d.id, ro = !e.canDeal('edit.deal', d), canJ = !ro && e.canJoint(), money = e.can('view.money');
  const m = dealMoney(S, d), r = dealResult(S, d), ps = payState(S, d, today), P = ps.plan, won = r === 'YES';
  const no = jointNo(S, g), payer = payerShort(g), title = g.qt.title || jointShort(g);
  const res = resultsWord(S, g);
  const stWord = won ? (P ? (ps.left.length ? `ได้งาน · รับ ${P.paidN}/${P.n} งวด` : 'ได้งาน · รับครบทุกงวด') : 'ได้งาน') : r === 'NO' ? 'ไม่ได้งาน' : r === 'WAIT' ? 'รอผล' : 'กำลังติดตาม';
  const stKind = won ? 'ok' : r === 'NO' ? 'bad' : r === 'WAIT' ? 'warn' : 'info';
  const shares = memberShares(S, g);
  const sumParts = shares.reduce((a, x) => a + (x.amt || 0), 0);
  const live = g.members.filter((_, i) => !shares[i].out);
  const check = sharesCheck((live.length ? live : g.members).map((x) => x.m), m.forecast);
  const pick = (v: 'YES' | 'NO' | 'WAIT') => {
    const cur = stepOf(S, hid, DEAL_STAGE);
    if (r === v) return;
    const was = closeReady(S, d, today);
    const filled = e.setStep(hid, DEAL_STAGE, { d: cur.d || today, n: v === 'WAIT' ? 'รอผล' : v });
    if (v === 'WAIT') acts.say(`บันทึกผลจาก ${payer} เป็น รอผล แล้ว`);
    // closed already: the companies without a result got the payer's (engine.setStep)
    else if (d.jobStatus === 'closed') acts.say(`บันทึกผลจาก ${payer} แล้ว${filled ? ` · ${fmtN(filled)} บริษัทที่ยังไม่มีผลได้ผล “${v === 'YES' ? 'ได้งาน' : 'ไม่ได้งาน'}” ตามผู้จ่าย` : ''}`);
    else acts.afterResult(d, was);
  };
  return (
    <>
      <div onClick={close} className="dp-back" />
      <aside ref={panelRef} className="panel dp jp" tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dp-head">
          <div className="dp-top">
            <span className="dp-crumb">Sales Tracker · ปี {d.year} · {d.section || 'ไม่ระบุหมวด'} · ใบเสนอราคาร่วม</span>
            <span className="dp-acts">
              {!ro && (d.jobStatus === 'closed' ? (
                <button type="button" className="btn xs" onClick={() => acts.say(e.reopenJoint(hid) ? 'เปิดใบเสนอราคาร่วมอีกครั้งแล้ว' : e.teamNote || 'ไม่มีรายการให้เปิดอีกครั้ง', { ms: 6000 })}>เปิดงานอีกครั้ง</button>
              ) : (
                <button type="button" className="btn xs" onClick={() => set({ jqDlg: { k: 'close', hid } })} title="ปิดทั้งใบเสนอราคาและทุกบริษัท (ถามยืนยัน)">ปิดงาน</button>
              ))}
              <button type="button" onClick={close} aria-label="ปิด" className="dlg-x"><Icon name="close" size={18} /></button>
            </span>
          </div>
          {canJ ? <TitleBox value={title} onSave={(v) => e.setJointTitle(hid, v)} /> : <h3 className="dp-name ro">{title}</h3>}
          {/* the quotation's services: its companies are sold under them */}
          <DealSvcRow d={d} />
          <span className="dp-meta">{[no, 'ผู้จ่าย ' + payer, d.resp ? 'ผู้รับผิดชอบ ' + d.resp : '', `${g.members.length} บริษัท`].filter(Boolean).join(' · ')}</span>
          <div className="dp-strip">
            <div>
              <span>สถานะ</span>
              <Status kind={stKind}>{stWord}</Status>
              <small>{d.jobStatus === 'closed' ? `ปิดงานแล้ว${d.closedDate ? ' ' + isoTh(d.closedDate) : ''}` : `${g.members.length} บริษัท · ${res || 'ยังไม่มีผลการขาย'}`}</small>
            </div>
            {money && (
              <>
                <div>
                  <span>Forecast</span>
                  <b className={m.forecast == null ? 'none' : ''}>{m0(m.forecast)}</b>
                  {m.fcDoc ? <small className="ok" title={m.fcDoc.docNo}>จากเอกสาร {m.fcDoc.docNo}</small> : <small>{m.forecast != null ? 'พิมพ์เอง · แนบใบเสนอราคาได้ด้านล่าง' : 'ยังไม่มีใบเสนอราคา'}</small>}
                </div>
                <div>
                  <span>Actual</span>
                  <b className={m.actual == null ? 'none' : ''}>{m0(m.actual)}</b>
                  <small>จากแผนชำระของ {payer}</small>
                </div>
                <div>
                  <span>ค้างรับ</span>
                  <b className={won && P?.left ? (P.late.length ? 'bad' : 'warn') : 'none'}>{won && P?.left ? fmtMoney(P.left) : '—'}</b>
                  <small>{P ? `แผน ${P.n} งวด · ${fmtMoney(P.total)}` : won ? 'ยังไม่มีแผนชำระ' : 'ยังไม่มีผลจากผู้จ่าย'}</small>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="dp-body">
          <section className="dp-card" aria-labelledby="jp-m">
            <div className="dp-h">
              <h3 id="jp-m">บริษัทในใบเสนอราคานี้</h3>
              <span className="dp-h-r">
                <span>{fmtN(g.members.length)} บริษัท{money && g.members.length > 1 ? ' · ' + sharesWord(g) : ''}</span>
                {canJ && <button type="button" className="btn xs" onClick={() => set({ jqDlg: { k: 'members', hid } })}>แก้ไขรายชื่อ</button>}
              </span>
            </div>
            {g.members.length ? (
              <div className={'jp-list' + (money ? '' : ' nomoney')} role="table" aria-label="บริษัทในใบเสนอราคานี้">
                <div className="jp-r ph" role="row"><span role="columnheader">บริษัท</span>{money && <span role="columnheader" className="r">ส่วนแบ่ง (บาท)</span>}<span role="columnheader">ขั้นตอน</span><span role="columnheader">สถานะ</span></div>
                {g.members.map((x, i) => {
                  const c = x.deal.gid != null ? e.company(x.deal.gid) : undefined;
                  const t = dealSteps(S, x.deal, today), nx = nextStepView(S, x.deal, today), sv = statusView(S, x.deal, today), sh = shares[i];
                  return (
                    <div key={x.deal.id} className="jp-r" role="row">
                      <span className="jp-co" role="cell">
                        <CoAvatar name={c?.name || x.deal.client} web={c?.web} set={c?.set} size={32} />
                        <span className="jp-nm">
                          <button type="button" className="hv-tx co-name dense" onClick={() => set({ deal: x.deal.id })} title={`เปิดแถวติดตามของ ${x.deal.client}`}>{shortName(x.deal.client)}</button>
                          <small>ผู้รับผิดชอบ {x.deal.resp || 'ยังไม่ระบุ'}</small>
                        </span>
                      </span>
                      {money && <span className="jp-sh" role="cell">{sh.out ? <><span className="t-muted">—</span><small>{outWord(S, x.deal)}</small></> : <><span>{sh.amt != null ? fmtMoney(sh.amt) : '—'}</span><small>{sh.pct}%</small></>}</span>}
                      {/* (paid in full by the payer, a company has nothing left but ปิดงาน: "ครบทุกขั้น" beside
                          "ทำแล้ว 2 จาก 6 ขั้น" would contradict itself when it skipped stages) */}
                      <span className="jp-nx" role="cell"><span>{nx.kind === 'done' ? (x.deal.jobStatus === 'closed' ? 'ปิดงานแล้ว' : 'พร้อมปิดงาน') : nx.code ? 'ถัดไป ' + nx.code : nx.hint}</span><small>ทำแล้ว {t.done} จาก {t.total} ขั้น</small></span>
                      <span role="cell"><Status kind={sv.kind}>{sv.word}</Status>{x.deal.jobStatus === 'closed' && <small className="t-meta"> · ปิดแล้ว</small>}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="empty">ยังไม่มีบริษัทในใบเสนอราคานี้{canJ ? ' กด “แก้ไขรายชื่อ” เพื่อเพิ่ม' : ''}</span>
            )}
            <div className="jp-f">
              <span>กดชื่อบริษัทเพื่อเปิดแถวติดตามของบริษัทนั้น</span>
              {money && g.members.length > 0 && (check.warn || m.forecast == null ? <span className={check.warn ? 't-warn' : ''}>{check.text}</span> : <span>รวมส่วนแบ่ง <b>{fmtMoney(sumParts) || '0'}</b> · เท่ากับยอดใบเสนอราคา</span>)}
            </div>
          </section>
          <section className="dp-card" aria-labelledby="jp-q">
            <div className="dp-h"><h3 id="jp-q">ใบเสนอราคา</h3><span>ใบเดียวสำหรับทั้ง {fmtN(g.members.length)} บริษัท</span></div>
            {qtView(S, d).head ? (
              <QtCard d={d} onRevise={(id) => attach({ at: 'quote', revise: id })} />
            ) : (
              <div className="sl-pc-empty">
                <span>ยังไม่มีไฟล์ใบเสนอราคา แนบแล้วยอดในใบจะเป็น Forecast ของใบเสนอราคาร่วม (นับครั้งเดียว)</span>
                {e.canQuote(d) && <button type="button" className="btn xs" onClick={() => attach({ at: 'quote' })}>แนบใบเสนอราคา</button>}
              </div>
            )}
          </section>
          <section className="dp-card jp-res" aria-labelledby="jp-r">
            <div className="dp-h"><h3 id="jp-r">ผลจาก {payer}</h3><span>{stepOf(S, hid, DEAL_STAGE).d && r ? 'บันทึก ' + isoTh(stepOf(S, hid, DEAL_STAGE).d) : 'ผู้จ่ายตอบรับหรือยัง'}</span></div>
            {ro ? (
              <ResultWord r={r} />
            ) : (
              <span className="sl-yn lg" role="group" aria-label={'ผลจาก ' + payer}>
                <button type="button" className="yes" aria-pressed={r === 'YES'} onClick={() => pick('YES')}>ได้งาน (YES)</button>
                <button type="button" className="no" aria-pressed={r === 'NO'} onClick={() => pick('NO')}>ไม่ได้งาน (NO)</button>
                <button type="button" className="wait" aria-pressed={r === 'WAIT'} onClick={() => pick('WAIT')}>รอผล</button>
              </span>
            )}
            <span className="sl-capt">ผลของใบเสนอราคาร่วม วันครบกำหนดแบบ “หลังได้งาน” ในแผนชำระนับจากวันที่บันทึก YES · ผลของแต่ละบริษัทบันทึกที่แถวของบริษัทนั้น</span>
          </section>
          {money && plan}
          {money && <p className="jp-cf">Cashflow นับเป็นรายการเดียวของ {payer} ({fmtN(g.members.length)} บริษัท) · ยอดไม่นับซ้ำที่แถวของแต่ละบริษัท</p>}
          {info}
          {history}
          {e.can('del.rec') && (
            <button type="button" className="quiet dp-del" onClick={() => window.confirm(`ยกเลิกใบเสนอราคาร่วม ${no || title}? ใบเสนอราคา แผนชำระของผู้จ่าย และไฟล์ใบเสนอราคาจะถูกลบ (ไฟล์ไปถังขยะของ Drive ทีม) บริษัททั้ง ${g.members.length} รายยังอยู่ในตารางตามเดิม${cancelExpWords(e, hid)}`) && (e.cancelJoint(hid), close())}>
              ยกเลิกใบเสนอราคาร่วม · บริษัทยังอยู่ในตารางตามเดิม
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

/** A member's deal panel opens with where it belongs: "อยู่ในใบเสนอราคาร่วม QT-… (มจพ) · ร่วมกับอีก 3 บริษัท ·
 *  ส่วนแบ่ง 321,000 (25%) · เปิดใบเสนอราคาร่วม". */
export function MemberBanner({ d }: { d: Deal }) {
  const { engine: e, set } = useApp();
  const S = e.sales;
  const v = shareOf(S, d);
  if (!v) return null;
  return (
    <p className="jq-mb">
      <span>{memberLine(S, d, e.can('view.money'))}</span>
      <button type="button" className="lnk" onClick={() => set({ deal: v.g.head.id })}>เปิดใบเสนอราคาร่วม</button>
    </p>
  );
}
/** A member's Forecast in its panel's strip: its part, grey, "ส่วนแบ่งใน QT ร่วม" (never summed). */
export function MemberStrip({ d }: { d: Deal }) {
  const { engine: e } = useApp();
  const v = shareOf(e.sales, d);
  if (!v) return null;
  return (
    <>
      <b className="share">{v.out ? '—' : v.amt != null ? fmtMoney(v.amt) : v.pct + '%'}</b>
      <small>{v.out ? outWord(e.sales, d) : `ส่วนแบ่งใน QT ร่วม · ${v.pct}%`}</small>
    </>
  );
}
/** A member's QUOTATION and PAY stages in its panel: the joint quotation does them ("ใบเสนอราคาร่วม QT-… ·
 *  เปิดใบเสนอราคาร่วม", "ชำระผ่านใบเสนอราคาร่วม"); null for any other stage or deal. */
export function MemberStage({ d, stage, pay }: { d: Deal; stage: string; pay: boolean }) {
  const { engine: e, set } = useApp();
  const v = shareOf(e.sales, d);
  if (!v || (stage !== QUOTE_STAGE && !pay)) return null;
  if (pay) return <p className="sl-tl-plan">{JOINT_PAID} · ผู้จ่าย {payerShort(v.g)}</p>;
  const no = jointNo(e.sales, v.g);
  return (
    <p className="sl-tl-plan jq-ms">
      ใบเสนอราคาร่วม{no ? ' ' + no : ''} · ส่งถึง {payerShort(v.g)} · <button type="button" className="lnk" onClick={() => set({ deal: v.g.head.id })}>เปิดใบเสนอราคาร่วม</button>
    </p>
  );
}
