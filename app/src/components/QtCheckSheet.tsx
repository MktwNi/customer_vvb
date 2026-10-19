import { useEffect, useId, useRef, useState } from 'react';
import { useApp, useEngineVersion, useNarrow } from '../state';
import { dmTh, downloadBlob, isoTh, localDay, pad, todayISO } from '../lib/format';
import { dealMoney, fmtMoney, type DealDoc } from '../lib/sales';
import { qtFacts, qtView } from '../lib/quotes';
import { QT_CHIP, QT_NOTE_MAX, QT_WORD, checkedLine, docById, qtDayOf, type QtCheckView } from '../lib/notify';
import { errText } from '../lib/teamSync';
import type { DocFacts } from '../lib/docExtract';
import { commitFocus, isTopDialog, useDialog } from './useDialog';
import { openDocFile, sameParty } from './DocAttach';
import { useSalesActs } from './SalesToast';
import { Notice } from './ui';
import { Icon } from './icons';

const BASIS_WORD: Record<DealDoc['basis'], string> = { total: 'ยอดรวม VAT', subtotal: 'ยอดก่อน VAT', netPay: 'หลังหัก ณ ที่จ่าย', manual: 'ยอดที่พิมพ์' };
const baht2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' บาท';
const hm = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The check status on a quotation (card, table row, phone editor): the chip, who and when, and for a
 *  checker "ตรวจใบนี้" while it waits. Shared words (plan.md §1); neutral or info chips only. */
export function QtCheckLine({ doc, v, onCheck, bare }: { doc: DealDoc; v: QtCheckView; onCheck?: () => void; bare?: boolean }) {
  const chip = <span className={QT_CHIP[v.status]}>{QT_WORD[v.status]}</span>;
  if (bare) return chip;
  const meta = v.status === 'wait' ? (v.stale ? 'แก้หลังตรวจ รอตรวจอีกครั้ง' : `ส่งให้ผู้ตรวจแล้ว ${dmTh(qtDayOf(doc))}`) : checkedLine(v.rec!);
  return (
    <span className="qt-chk">
      {chip}
      <span className="t-meta">{meta}</span>
      {onCheck && (
        <button type="button" className="lnk qt-go" onClick={onCheck}>
          ตรวจใบนี้
        </button>
      )}
    </span>
  );
}
/** What the checker asked to change, under the card head while the quotation is sent back. */
export function QtBack({ v }: { v: QtCheckView | null }) {
  if (!v || v.status !== 'back' || !v.rec?.note) return null;
  return (
    <div className="qt-back">
      <span className="qt-back-h">สิ่งที่ต้องแก้ จาก {v.rec.by}</span>
      <p>{v.rec.note}</p>
    </div>
  );
}

/**
 * ตรวจใบเสนอราคา (package notify, screens 03–03d and 08): the file's first page on the left, what was read
 * from it on the right (customer, number, date, before VAT, VAT, total, each said to match where it can),
 * what the Forecast counts, and the check status. A checker approves ("ข้อมูลถูกต้อง อนุมัติ") or sends it
 * back with a note ("ส่งกลับแก้ไข"); anyone else, or the uploader, reads it only. "Approve" is a check of
 * the figures: it changes no money. On a phone the sheet docks to the bottom with its buttons in view.
 */
export function QtCheckSheet() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const doc = ui.qtCheck ? docById(e.sales, ui.qtCheck) : undefined;
  const gone = !!ui.qtCheck && e.ready && (!doc || !e.sales.deals[doc.deal]);
  // deleted meanwhile (a teammate, or a revision moved it): the sheet goes
  useEffect(() => {
    if (gone) set({ qtCheck: null, qtSig: '' });
  }, [gone, set]);
  if (!doc || gone) return null;
  return <Sheet key={doc.id} doc={doc} sig={ui.qtSig} onClose={() => set({ qtCheck: null, qtSig: '' })} />;
}

function Sheet({ doc, sig, onClose }: { doc: DealDoc; sig: string; onClose: () => void }) {
  const { engine: e } = useApp();
  const acts = useSalesActs();
  const narrow = useNarrow(761);
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useDialog(ref, { focus: 'dialog' });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !isTopDialog(ref.current)) return;
      ev.stopPropagation();
      commitFocus();
      closeRef.current();
    };
    document.addEventListener('keydown', kd, true);
    return () => document.removeEventListener('keydown', kd, true);
  }, []);

  const S = e.sales, d = S.deals[doc.deal];
  const [img, setImg] = useState<{ url?: string; err?: string; away?: boolean }>({});
  const [facts, setFacts] = useState<DocFacts | null>(qtFacts.get(doc.id) || null);
  const [pages, setPages] = useState(0);
  const [reading, setReading] = useState('กำลังเปิดไฟล์');
  const [mode, setMode] = useState<'ask' | 'return'>('ask');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // the first page as a picture, and the figures read from the file (kept for this session, lib/quotes qtFacts)
  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      const local = await e.docLocalBlob(doc);
      if (!local && !doc.fileId) {
        setImg({ away: true });
        setReading('');
        return;
      }
      const blob = local || (await e.docBlob(doc));
      const [{ docThumb, readDocText }, { analyzeDocText, factsScore }] = await Promise.all([import('../lib/docText'), import('../lib/docExtract')]);
      const url = await docThumb(blob, 1400).catch(() => '');
      if (ctl.signal.aborted) return;
      setImg(url ? { url } : { err: 'แสดงตัวอย่างไฟล์นี้ไม่ได้ กด “เปิดไฟล์เต็ม”' });
      setReading('กำลังอ่านค่าจากไฟล์');
      const t = await readDocText(blob, { signal: ctl.signal, onProgress: (msg) => setReading(msg), judge: (x) => factsScore(analyzeDocText(x)) });
      if (ctl.signal.aborted) return;
      const fx = analyzeDocText(t.text);
      qtFacts.set(doc.id, fx);
      setFacts(fx);
      setPages(t.pages);
      setReading('');
    })().catch((x) => {
      if (ctl.signal.aborted) return;
      setImg((i) => (i.url ? i : { err: (x as Error)?.message || String(x) }));
      setReading('');
    });
    return () => ctl.abort();
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;

  const v = e.qtCheckFor(doc);
  const block = e.checkBlock(doc);
  const n = qtView(S, d).versions.find((x) => x.doc.id === doc.id)?.n || 1;
  const no = doc.docNo || 'ใบเสนอราคา';
  const who = doc.by || 'ผู้แนบ';
  const m = dealMoney(S, d);
  const counted = m.fcDoc?.id === doc.id;
  const typedWas = d.forecast != null && doc.amount != null && Math.abs(d.forecast - doc.amount) >= 0.005 ? d.forecast : null;
  const mailOn = !!e.notifyLive?.on;
  const party = facts?.party || '';
  const wordsOk = facts && facts.words != null && facts.total != null && Math.abs(facts.words - facts.total) < 0.01;
  // a checker on a quotation waiting (or changed since its check) asks; a decided one, someone else's, or
  // one this account attached is read only
  const canAsk = !block && v?.status === 'wait';
  const kb = Math.max(1, Math.round(doc.size / 1024)) + ' KB';

  const run = async (st: 'ok' | 'back') => {
    setBusy(true);
    setErr('');
    try {
      await e.qtCheck(doc, st, st === 'back' ? note : '', sig);
      onClose();
      const tell = mailOn && doc.by ? ` · ${doc.by} จะได้อีเมลแจ้งผล` : '';
      acts.say(st === 'ok' ? `อนุมัติ ${no} แล้ว${tell}` : `ส่ง ${no} กลับให้ ${who} แก้ไขแล้ว${tell}`, { ms: 10000, acts: [{ label: 'เลิกทำ', act: 'qtUndo', k: `${doc.deal}/${doc.id}` }] });
    } catch (x) {
      setErr(errText(x, 'connect'));
      setBusy(false);
    }
  };

  const status = v ? (
    <div className="apv-st">
      <QtCheckLine doc={doc} v={v} bare />
      <span>
        {v.status === 'wait'
          ? v.stale
            ? `แก้หลัง${QT_WORD[v.stale.st]} (${checkedLine(v.stale)}) จึงต้องตรวจอีกครั้ง`
            : `${mailOn ? 'ส่งให้ผู้ตรวจทางอีเมลแล้ว' : 'รอผู้ตรวจ'} ${dmTh(qtDayOf(doc))}${qtDayOf(doc) === todayISO() ? ' ' + hm(doc.cAt || doc.at) : ''}`
          : `${checkedLine(v.rec!)}${v.rec!.at ? ' ' + hm(v.rec!.at) : ''}`}
      </span>
    </div>
  ) : null;
  const why =
    block === 'cap' ? 'บัญชีนี้ไม่มีสิทธิ์ตรวจใบเสนอราคา ผู้ตรวจคือบัญชีที่มีสิทธิ์ “ตรวจ/อนุมัติใบเสนอราคา”'
    : block === 'self' ? 'คุณเป็นผู้แนบใบนี้ ให้ผู้ตรวจคนอื่นตรวจ'
    : block === 'off' ? 'การตรวจใบเสนอราคาเริ่มใช้ได้หลังผู้ดูแลระบบอัปเดตสคริปต์ของทีม'
    : !v ? 'ใบนี้ไม่ต้องตรวจ (แนบก่อนเริ่มใช้การตรวจ หรืองานปิดแล้ว)'
    : '';

  return (
    <>
      <div className="dlg-back" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={tid} className="dlg apv">
        <div className="dlg-head">
          <div className="apv-ht">
            <span className="dlg-t" id={tid}>ตรวจใบเสนอราคา{narrow ? '' : ' ' + (doc.docNo || '')}</span>
            <small>
              {d.client} · {who} แนบเมื่อ {doc.at ? `${isoTh(localDay(doc.at))} ${hm(doc.at)}` : '—'}
              {narrow ? '' : ` · ฉบับที่ ${n}`}
            </small>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="dlg-x">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="apv-body">
          <div className="apv-doc">
            <div className="apv-view">
              {img.url ? (
                <div className="apv-page">
                  <img src={img.url} alt={`หน้า 1 ของ ${doc.name}`} />
                </div>
              ) : (
                <span className="apv-ph" role={img.err ? 'alert' : 'status'}>
                  {img.away ? 'ไฟล์ยังอยู่ในเครื่องของผู้แนบ ยังไม่ได้อัปโหลดขึ้น Drive ของทีม' : img.err || 'กำลังเปิดไฟล์ (ไฟล์ใน Drive ของทีมอาจใช้เวลาสักครู่)'}
                </span>
              )}
            </div>
            <div className="apv-docf">
              <span>{[doc.name, pages ? `${pages} หน้า` : '', kb].filter(Boolean).join(' · ')}</span>
              <span className="sp" />
              {!img.away && (
                <button type="button" className="lnk" onClick={() => openDocFile(e, doc)}>
                  {narrow ? 'ดูเต็มจอ' : 'เปิดไฟล์เต็ม'}
                </button>
              )}
              {!img.away && !narrow && (
                <button type="button" className="lnk" onClick={() => e.docBlob(doc).then((b) => downloadBlob(b, doc.name), (x) => setErr((x as Error)?.message || String(x)))}>
                  ดาวน์โหลด
                </button>
              )}
            </div>
          </div>
          <div className="apv-vals">
            <div className="apv-vh">
              <b>ค่าที่ระบบอ่านจากไฟล์</b>
              <span>{reading ? reading : `ดูว่าตรงกับไฟล์${narrow ? 'ด้านบน' : 'ทางซ้าย'}หรือไม่`}</span>
            </div>
            <dl className="apv-dl">
              <dt>ลูกค้า</dt>
              <dd>
                {party || d.client}
                {party && (sameParty(party, d.client) ? <small className="ok">ตรงกับลูกค้าของงานนี้</small> : <small>ไม่ตรงกับลูกค้าของงานนี้ ({d.client})</small>)}
              </dd>
              <dt>เลขที่</dt>
              <dd>
                {doc.docNo || '—'}
                {facts?.docNo && facts.docNo.trim() !== doc.docNo.trim() && <small>ในไฟล์อ่านได้ {facts.docNo}</small>}
              </dd>
              <dt>ลงวันที่</dt>
              <dd>
                {doc.docDate ? isoTh(doc.docDate) : '—'}
                {facts?.docDate && facts.docDate !== doc.docDate && <small>ในไฟล์อ่านได้ {isoTh(facts.docDate)}</small>}
              </dd>
              <dt>ยอดก่อน VAT</dt>
              <dd>{facts?.subtotal != null ? baht2(facts.subtotal) : '—'}</dd>
              <dt>VAT 7%</dt>
              <dd>{facts?.vat != null ? baht2(facts.vat) : '—'}</dd>
              <dt>ยอดรวม VAT</dt>
              <dd className="big">
                <b>{facts?.total != null ? baht2(facts.total) : doc.basis === 'total' && doc.amount != null ? baht2(doc.amount) : '—'}</b>
                {wordsOk && <small className="ok">ตรงกับจำนวนเงินตัวอักษร</small>}
              </dd>
            </dl>
            {mode === 'return' ? (
              <label className="apv-ret">
                บอก {who} ว่าต้องแก้อะไร
                <textarea className="fld" rows={3} value={note} maxLength={QT_NOTE_MAX} autoFocus onChange={(ev) => setNote(ev.target.value)} />
                <small>{who} จะเห็นข้อความนี้บนใบเสนอราคา{mailOn ? ' และได้รับทางอีเมล' : ''}</small>
              </label>
            ) : (
              <>
                {doc.amount != null && (
                  <div className="apv-fc">
                    {counted ? (
                      <>
                        นับเป็น Forecast ของงานนี้ <b>{fmtMoney(doc.amount)} บาท</b> ({BASIS_WORD[doc.basis]}){typedWas != null && ` · เดิมพิมพ์ไว้ ${fmtMoney(typedWas)}`}
                      </>
                    ) : (
                      <>
                        ยอดในระบบ <b>{fmtMoney(doc.amount)} บาท</b> ({BASIS_WORD[doc.basis]}) · ตอนนี้ไม่ได้นับเป็น Forecast (มียอดที่ใหม่กว่า)
                      </>
                    )}
                  </div>
                )}
                {status}
              </>
            )}
            {err && <Notice kind="error" role="alert">{err}</Notice>}
          </div>
        </div>
        <div className="apv-act">
          {canAsk && mode === 'ask' && (
            <>
              <span className="apv-why">อนุมัติแล้ว {who} จะเห็น “ตรวจแล้ว” พร้อมชื่อคุณ · ถ้ามีการแก้ยอดหรือแนบฉบับใหม่ ต้องตรวจอีกครั้ง</span>
              <span className="sp" />
              <button type="button" className="btn" disabled={busy} onClick={() => setMode('return')}>ส่งกลับแก้ไข</button>
              {/* the file is not on the team's Drive yet: nothing to check it against */}
              {!img.away && (
                <button type="button" className="btn pri" disabled={busy} onClick={() => run('ok')}>ข้อมูลถูกต้อง อนุมัติ</button>
              )}
            </>
          )}
          {canAsk && mode === 'return' && (
            <>
              <span className="apv-why">ระหว่างรอแก้ ใบนี้ยังนับเป็น Forecast ตามเดิม</span>
              <span className="sp" />
              <button type="button" className="quiet" disabled={busy} onClick={() => (setMode('ask'), setErr(''))}>ยกเลิก</button>
              <button type="button" className="btn pri" disabled={busy || !note.trim()} onClick={() => run('back')}>ส่งกลับให้ {who} แก้ไข</button>
            </>
          )}
          {!canAsk && (
            <>
              {why ? <div className="apv-ro">{why}</div> : <span className="apv-why">{v?.status === 'ok' ? 'ตรวจแล้ว ถ้ามีการแก้ยอด เลขที่ วันที่ หรือแนบฉบับใหม่ จะกลับเป็น “รอตรวจ”' : `รอ ${who} แนบฉบับแก้ไข หรือแก้ข้อมูล แล้วใบนี้จะกลับเป็น “รอตรวจ”`}</span>}
              <span className="sp" />
              <button type="button" className="btn" onClick={onClose}>ปิด</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
