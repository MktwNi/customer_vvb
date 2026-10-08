import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ReadOnly } from './ReadOnly';
import { useApp, useEngineVersion, type DetailTab } from '../state';
import { CST, LOG_RESULTS, STG, stageOf } from '../lib/constants';
import { dtTh, fmtN, gccCode, isoTh, money, telHref, todayISO, ymTh } from '../lib/format';
import type { Cert, Company, ContactForm, Detail, StageKey } from '../lib/types';
import { beYear, dealMoney, fmtMoney, lastContact, trackerStatus, type Deal } from '../lib/sales';
import { dedupFilter } from '../tabs/Dedup';
import { DoneBox, taskInfo } from '../tabs/Plan';
import { Opts, srcWords } from './ui';
import { Icon } from './icons';
import { CoAvatar } from './CoAvatar';
import { CompanyPeople, logType } from '../tabs/People';
import { useDialog } from './useDialog';

const box: CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 };
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-2)' };
/** A card's title (16/500 ink). */
const H = ({ children }: { children: string }) => <h3 className="card-t">{children}</h3>;
/** The colour of a status word: ok / warn / bad, else ink. */
const inkOf = (k: 'ok' | 'warn' | 'bad' | '') => (k ? `var(--${k})` : 'var(--ink)');

interface BlockItem { key: string; h: string; badge: string; kind: 'ok' | 'warn' | 'bad' | ''; t1: string; t2: string; kv: [string, string][]; scope?: [number, number, number, string, string, string]; from: string }
interface Block { k: 't' | 'g' | 'f' | 's'; src: number; title: string; items: BlockItem[] }

export function CompanyDrawer() {
  const { engine: e, ui, set, go, openSched } = useApp();
  // an account that can only read: no star, no edits, no new calls or appointments
  const ro = !e.can('edit');
  const role = e.role(); // null: no accounts (team code, or this browser only)
  useEngineVersion();
  const c = ui.sel != null ? e.company(ui.sel) : undefined;
  const [det, setDet] = useState<{ id: number; d: Detail } | null>(null);
  const [more, setMore] = useState<Record<string, boolean>>({});
  // the contact form's values when it was opened: saving writes only what was changed in it
  const [editC, setEditC] = useState<ContactForm | null>(null);
  const ref = useRef<HTMLElement>(null);
  // takes the keyboard (also when opened over the deal panel), gives focus back on close
  useDialog(ref, { focus: 'dialog', on: !!c });
  const cid = c?.id;
  const idsKey = c?.ids.join(',');

  useEffect(() => {
    setMore({});
    setEditC(null);
  }, [cid]);
  useEffect(() => {
    if (!c) return;
    let live = true;
    e.getDetail(c).then((d) => live && setDet({ id: c.id, d }));
    return () => {
      live = false;
    };
  }, [cid, idsKey]);

  if (!c) return null;
  const close = () => set({ sel: null });
  const D = e.B.D, CD = e.B.CD, C = e.crm;
  const d = det && det.id === c.id ? det.d : null;
  const dt = ui.dTab;
  const multi = c.ids.length > 1;
  const from = (src: number) => (multi ? 'จาก ' + gccCode(src) : '');
  const st = stageOf(C.stages[c.id]);
  const watched = C.watch.includes(c.id);
  const certs = (e.certsBy.get(c.id) || []).slice().sort((a, b) => (b.ex || '').localeCompare(a.ex || ''));
  const logs = (C.log[c.id] || []).slice().sort((a, b) => b.at.localeCompare(a.at));
  const lastC = logs.find((l) => ['call', 'email', 'meet', 'follow'].includes(l.type));
  // the Sales Tracker's view of this customer, so the header doesn't say "ยังไม่ติดต่อ" for one the
  // tracker shows as called or won (the contact-plan stage below is kept separately)
  const deals = newestFirst(e.dealsOf(c.id));
  const deal = deals[0];
  const owner = C.owners[c.id] || deal?.resp || '';
  // the latest real contact: the contact log, or a deal's typed contact date / stage dates (not the day it was sent to the tracker)
  const today = todayISO();
  const lastAt = [lastC ? lastC.at.slice(0, 10) : '', ...deals.map((x) => lastContact(e.sales, x, today))].reduce((a, b) => (b > a ? b : a), '');
  const tasks = e.tasksOf(c.id).sort((a, b) => a.date.localeCompare(b.date));
  const nOpenT = tasks.filter((t) => !t.done).length;
  const pendingG = e.B.groups.filter(dedupFilter('pending'));
  const myG = pendingG.filter((g) => g.ids.some((i) => c.ids.includes(i)));

  const certItem = (x: Cert): BlockItem => {
    const sc = x.s1 != null && (x.s1 || 0) + (x.s2 || 0) + (x.s3 || 0) > 0;
    const tot = sc ? (x.s1 || 0) + (x.s2 || 0) + (x.s3 || 0) : 1;
    const p = (v: number | null) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
    return {
      key: 'c' + x.cid, h: x.cert || 'ไม่มีเลขที่ใบรับรอง', badge: CST[x.st][0], kind: x.st === 'active' ? 'ok' : x.st === 'soon' ? 'warn' : x.st === 'expired' ? 'bad' : '', t1: x.org, t2: x.act && x.act !== x.org ? x.act : '',
      kv: [['อนุมัติ', isoTh(x.ap)], ['หมดอายุ', isoTh(x.ex)], ['จังหวัด', x.provTxt || CD.prov[x.prov] || '—']],
      scope: sc ? [((x.s1 || 0) / tot) * 100, ((x.s2 || 0) / tot) * 100, ((x.s3 || 0) / tot) * 100, p(x.s1), p(x.s2), p(x.s3)] : undefined,
      from: x.tgo ? x.note : from(x.gid0),
    };
  };
  const giKind = (x: string): BlockItem['kind'] => (/อยู่ในอายุ/.test(x) ? 'ok' : /หมดอายุ/.test(x) ? 'bad' : '');
  const s = (v: unknown) => (v == null ? '' : String(v));
  const blocks: Block[] = [];
  if (certs.length) blocks.push({ k: 't', src: 0, title: 'ใบรับรอง CFO', items: certs.map(certItem) });
  if (d && d.g.length)
    blocks.push({
      k: 'g', src: 1, title: 'อุตสาหกรรมสีเขียว (GI)',
      items: d.g.slice().sort((a, b) => (b.x[0] as number) - (a.x[0] as number) || (b.x[1] as number) - (a.x[1] as number)).map(({ src, x }, i) => ({
        key: 'g' + i, h: `ระดับ ${s(x[1])} · ปีงบ ${s(x[0])}`, badge: s(x[9]), kind: giKind(s(x[9])), t1: s(x[3]), t2: s(x[2]),
        kv: ([['รับรอง', isoTh(s(x[7]))], ['หมดอายุ', x[8] ? isoTh(s(x[8])) : 'ไม่มีกำหนด'], ['จังหวัด', s(x[6]) || '—']] as [string, string][]).concat(x[4] ? [['ทะเบียนโรงงาน', s(x[4])]] : []),
        from: from(src),
      })),
    });
  if (d && d.f.length)
    blocks.push({
      k: 'f', src: 2, title: 'โรงงานที่เริ่มประกอบกิจการ (กรอ.)',
      items: d.f.map(({ src, x }, i) => ({
        key: 'f' + i, h: s(x[2]), badge: 'เริ่ม ' + ymTh(s(x[0])), kind: '', t1: s(x[3]), t2: s(x[4]),
        kv: ([['เงินทุน', money(x[7] as number | null)]] as [string, string][]).concat(x[8] ? [['คนงาน', fmtN(x[8] as number) + ' คน']] : []).concat(x[5] ? [['โทร', s(x[5])]] : []),
        from: from(src),
      })),
    });
  if (d && d.s.length)
    blocks.push({
      k: 's', src: 3, title: 'บริษัทจดทะเบียน (SET)',
      items: d.s.map(({ src, x }, i) => ({
        key: 's' + i, h: s(x[0]), badge: s(x[2]), kind: '', t1: s(x[1]), t2: s(x[5]),
        kv: ([['กลุ่มอุตสาหกรรม', s(x[3]) || '—']] as [string, string][]).concat(x[4] ? [['หมวดธุรกิจ', s(x[4])]] : []),
        from: from(src),
      })),
    });
  const shown = blocks.filter((b) => (dt === 'cfo' ? b.k === 't' : dt === 'src' ? b.k !== 't' : false));
  const srcN = d ? d.g.length + d.f.length + d.s.length : 0;
  const dTabs: [DetailTab, string, number][] = [['info', 'ข้อมูลบริษัท', 0], ['cfo', 'CFO · รอบ อบก.', certs.length], ['src', 'GI · โรงงาน · SET', srcN], ['crm', 'การติดต่อ', logs.length + nOpenT]];

  const cvT = CST[c.cfoSt];
  const cvSub = c.cfoSt === 'none' ? '' : c.cfoSt === 'soon' ? `เหลือ ${fmtN(c.days)} วัน · ${isoTh(c.cfoEx)}` : c.cfoEx ? isoTh(c.cfoEx) : '';
  // figures in ink; only a status word keeps its colour ("ใกล้หมดอายุ" warn)
  const kpis: { k: string; v: string; kind: BlockItem['kind']; sub: string }[] = [
    { k: 'CFO', v: cvT[0], kind: c.cfoSt === 'active' ? 'ok' : c.cfoSt === 'soon' ? 'warn' : c.cfoSt === 'expired' ? 'bad' : '', sub: c.cfoN ? `${fmtN(c.cfoN)} ใบ${cvSub ? ' · ' + cvSub : ''}` : 'ไม่พบใน TGO' },
    { k: 'GI ที่ยังใช้ได้', v: c.giLive ? 'ระดับ ' + c.giLive : '—', kind: '', sub: c.giMax ? `สูงสุดที่เคยได้ ${c.giMax}${c.giUntil ? ' · ถึง ' + isoTh(c.giUntil) : ''}` : 'ไม่พบใน GI' },
    { k: 'โรงงานใหม่ (กรอ.)', v: c.invest ? money(c.invest) : '—', kind: '', sub: c.newYm ? 'เริ่ม ' + ymTh(c.newYm) : 'ไม่พบในรายชื่อโรงงานใหม่' },
  ];
  const facts = ([['เลขนิติบุคคล', c.jur], ['จังหวัด', D.prov[c.prov]], ['ที่อยู่', c.addr], ['กลุ่มอุตสาหกรรม', D.ind[c.ind]], ['กิจการ', c.biz], ['จำนวนโรงงาน', c.fac ? fmtN(c.fac) + ' แห่ง' : ''], ['SET', c.set ? `${c.set} · ตลาด ${c.mkt}` : '']] as [string, string][]).filter((x) => x[1]);
  const ph = (c.phone || '').split('|').map((x) => x.trim()).filter(Boolean);
  const em = (c.email || '').split('|').map((x) => x.trim()).filter(Boolean);
  // the contact typed in the Sales Tracker (what is not already listed above)
  const split = (s: string) => s.split('|').map((x) => x.trim()).filter(Boolean);
  const dc = deals
    .map((x) => ({ name: x.contactName.trim(), phones: split(x.phone).filter((t) => !ph.includes(t)), emails: split(x.email).filter((t) => !em.includes(t)) }))
    .find((x) => x.name || x.phones.length || x.emails.length);
  const ce = c.cEdited;
  const ctSrc = ce ? `แก้ไขด้วยตนเอง ${isoTh(ce.at.slice(0, 10))}${ce.note ? ' · ' + ce.note : ''}` : D.ct[c.ct] ? 'แหล่งข้อมูลติดต่อ: ' + D.ct[c.ct] : '';
  const r = c.rndR;
  const rndWarn = r && c.rndLapse ? `${c.rndIdeal && c.rndIdeal !== c.rnd ? `รอบที่ควรยื่น (${c.rndIdeal}) ปิดรับเอกสารแล้ว ` : ''}ใบรับรองจะขาดช่วง ${fmtN(c.rndLapse)} วัน` : '';

  const saveContact = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const g = (k: string) => String(fd.get(k) || '').trim();
    e.saveContact(c, { phone: g('phone'), email: g('email'), web: g('web'), note: g('note') }, editC || undefined);
    setEditC(null);
  };
  const addLog = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const fd = new FormData(f);
    const g = (k: string) => String(fd.get(k) || '').trim();
    if (!g('text') && !g('result')) return;
    e.addLog(c.id, g('type') || 'note', g('result'), g('text'));
    f.reset();
  };

  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,60,.38)', zIndex: 40 }} />
      <aside ref={ref} className="panel" tabIndex={-1} role="dialog" aria-modal="true" aria-label={c.name} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(680px,100vw)', background: 'var(--frame)', zIndex: 41, overflowY: 'auto', boxShadow: 'var(--sh-pop)', outline: 'none' }}>
        {/* a white head: what it is, the name, then one line (the sales status lives in the Sales Tracker card) */}
        <div className="dr-head">
          <div className="dr-meta">
            <span>{[c.code, D.type[c.type], 'กลุ่ม ' + (c.tgt + 1), srcWords(c.src).join(' · ')].filter(Boolean).join(' · ')}</span>
            <span style={{ display: 'flex', gap: 8, flex: 'none' }}>
              {!ro && <button onClick={() => e.toggleWatch(c.id)} aria-pressed={watched} className="btn sm">{watched ? 'ติดตามอยู่' : 'ติดตาม'}</button>}
              <button onClick={close} aria-label="ปิด" className="dlg-x"><Icon name="close" size={18} /></button>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <CoAvatar name={c.name} web={c.web} set={c.set} size={44} />
            <h2 className="dr-name">{c.name}</h2>
          </div>
          <span className="dr-line">
            {owner ? <>ผู้รับผิดชอบ <b>{owner}</b></> : 'ยังไม่มีผู้รับผิดชอบ'}
            {' · '}
            {lastAt ? <>ติดต่อล่าสุด <b>{isoTh(lastAt)}</b></> : 'ยังไม่เคยติดต่อ'}
          </span>
        </div>

        <div role="tablist" className="utabs dr-tabs">
          {dTabs.map(([k, label, n]) => {
            const on = dt === k;
            return (
              <button key={k} role="tab" aria-selected={on} onClick={() => set({ dTab: k })}>
                {label}
                {n > 0 && <span className="n">{fmtN(n)}</span>}
              </button>
            );
          })}
        </div>

        <div style={{ padding: '18px 28px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {dt === 'info' && (
            <>
              <SalesBox c={c} />
              {multi && (
                <div style={{ ...box, gap: 6 }}>
                  <H>{`รวมจาก ${c.ids.length} แถวในไฟล์ต้นทาง`}</H>
                  {c.ids.map((id) => {
                    const rr = e.B.rawById.get(id)!;
                    return (
                      <span key={id} style={{ fontSize: 13, color: 'var(--ink-2)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>{gccCode(id)}</span>
                        <span style={{ color: 'var(--ink)' }}>{rr.name}</span>
                        <span className="t-muted">{srcWords(rr.src).join(' · ')}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {myG.length > 0 && (
                <span className="note">
                  <span className="t-warn">{`อาจซ้ำกับบริษัทอื่น ${myG.length} กลุ่ม รอตรวจ`}</span>
                  <button onClick={() => go('dedup', { sel: null, ddF: 'pending', ddPage: Math.floor(pendingG.indexOf(myG[0]) / 20) })} className="lnk" style={{ fontSize: 13 }}>ไปที่ตรวจข้อมูลซ้ำ</button>
                </span>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
                {kpis.map((k) => (
                  <div key={k.k} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r-inner)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{k.k}</span>
                    <span style={{ fontSize: 18, fontWeight: 500, color: inkOf(k.kind) }}>{k.v}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{k.sub}</span>
                  </div>
                ))}
              </div>
              <div style={box}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <H>ข้อมูลติดต่อ</H>
                  {!ro && <button onClick={() => setEditC(editC ? null : { phone: c.phone || '', email: c.email || '', web: c.web || '', note: (ce && ce.note) || '' })} className="lnk">{editC ? 'ปิดการแก้ไข' : 'แก้ไข'}</button>}
                </div>
                {!ph.length && !em.length && !c.web && !dc && <span className="empty">ยังไม่มีเบอร์โทร อีเมล หรือเว็บไซต์ในทุกแหล่ง</span>}
                {ph.map((t) => <a key={t} href={telHref(t)} className="hv-tx" style={{ alignSelf: 'flex-start', fontSize: 14 }}>{t}</a>)}
                {em.map((t) => <a key={t} href={'mailto:' + t} className="hv-tx" style={{ alignSelf: 'flex-start', fontSize: 14 }}>{t}</a>)}
                {c.web && <a href={/^https?:\/\//.test(c.web) ? c.web : 'https://' + c.web} target="_blank" rel="noopener noreferrer" className="hv-tx" style={{ alignSelf: 'flex-start', fontSize: 14, wordBreak: 'break-all' }}>{c.web}</a>}
                {dc && (
                  <span style={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap', alignItems: 'baseline', fontSize: 14, wordBreak: 'break-word' }}>
                    <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>ผู้ติดต่อใน Sales Tracker</span>
                    {dc.name && <span>{dc.name}</span>}
                    {dc.phones.map((t) => <a key={t} href={telHref(t)} className="hv-tx">{t}</a>)}
                    {dc.emails.map((t) => <a key={t} href={'mailto:' + t} className="hv-tx">{t}</a>)}
                  </span>
                )}
                {ctSrc && <span className="t-meta">{ctSrc}</span>}
                {editC && (
                  <form onSubmit={saveContact} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--divider)', paddingTop: 12 }}>
                    <label style={field}>เบอร์โทร (คั่นหลายเบอร์ด้วย |)<input name="phone" defaultValue={editC.phone} className="fld" /></label>
                    <label style={field}>อีเมล<input name="email" defaultValue={editC.email} className="fld" /></label>
                    <label style={field}>เว็บไซต์<input name="web" defaultValue={editC.web} className="fld" /></label>
                    <label style={field}>ผู้ติดต่อ / หมายเหตุ<input name="note" defaultValue={editC.note} className="fld" /></label>
                    <button type="submit" className="btn pri" style={{ alignSelf: 'flex-start' }}>บันทึก</button>
                  </form>
                )}
              </div>
              <CompanyPeople c={c} />
              <div style={{ ...box, gap: 9 }}>
                {facts.map(([k, v]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0,1fr)', gap: 12, fontSize: 14 }}>
                    <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{k}</span>
                    <span style={{ wordBreak: 'break-word' }}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {(dt === 'cfo' || dt === 'src') && (
            <>
              {dt === 'cfo' && r && (
                <div style={{ ...box, padding: '14px 18px', gap: 8 }}>
                  <H>{`รอบ อบก. ที่ต้องยื่นต่ออายุ · รอบ ${c.rnd}`}</H>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
                    {([['ส่งเอกสารภายใน', isoTh(r.doc)], ['ชำระค่าธรรมเนียม', isoTh(r.fee)], ['ประกาศผล', isoTh(r.ann)]] as const).map(([k, v]) => (
                      <div key={k} style={{ border: '1px solid var(--divider)', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{k}</span>
                        <span style={{ fontSize: 14 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {rndWarn && <span className="t-bad" style={{ fontSize: 13 }}>{rndWarn}</span>}
                </div>
              )}
              {dt === 'src' && !d && <span className="empty">กำลังโหลดรายละเอียดรายแหล่ง…</span>}
              {shown.map((b) => {
                const all = more[b.k] ? b.items : b.items.slice(0, 6);
                return (
                  <div key={b.k} style={box}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <H>{b.title}</H>
                      {b.items.length > 6 && <span className="t-meta">{fmtN(b.items.length)} รายการ</span>}
                    </div>
                    {all.map((it) => <BlockRow key={it.key} it={it} />)}
                    {!more[b.k] && b.items.length > 6 && (
                      <button onClick={() => setMore({ ...more, [b.k]: true })} className="lnk" style={{ alignSelf: 'flex-start' }}>ดูทั้งหมด {fmtN(b.items.length)} รายการ</button>
                    )}
                  </div>
                );
              })}
              {!shown.length && !(dt === 'src' && !d) && (
                <div className="empty-box">{dt === 'cfo' ? 'ไม่พบใบรับรอง CFO ของบริษัทนี้ใน TGO' : 'ไม่พบข้อมูลใน GI, กรอ. หรือ SET'}</div>
              )}
            </>
          )}

          {dt === 'crm' && (
            <>
              <ReadOnly ro={ro}>
              <div style={{ ...box, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                <label style={field}>
                  สถานะในแผนติดต่อ
                  <select value={st[0]} onChange={(ev) => e.setStage(c.id, ev.target.value as StageKey)} className="fld sel">
                    <Opts options={STG.map(([v, label]) => ({ v, label }))} />
                  </select>
                </label>
                <label style={field}>
                  ผู้รับผิดชอบ
                  <select value={C.owners[c.id] || ''} onChange={(ev) => e.setOwner(c.id, ev.target.value)} className="fld sel">
                    <Opts all="ยังไม่มีผู้รับผิดชอบ" options={C.team.map((v) => ({ v, label: v }))} />
                  </select>
                </label>
                {/* with accounts the names come from the accounts an admin creates (the Update page has no team list) */}
                {!C.team.length && (role == null || role === 'admin' ? (
                  <button onClick={() => go(role ? 'users' : 'update', { sel: null })} className="lnk" style={{ gridColumn: '1/-1', justifySelf: 'start', fontSize: 13 }}>
                    {role ? 'ยังไม่มีรายชื่อทีม สร้างบัญชีให้ทีมได้ที่ ผู้ใช้และสิทธิ์' : 'ยังไม่มีรายชื่อทีม เพิ่มได้ที่แท็บอัปเดตข้อมูล'}
                  </button>
                ) : (
                  <span className="t-meta" style={{ gridColumn: '1/-1', fontSize: 13 }}>ยังไม่มีรายชื่อทีม ผู้ดูแลระบบเพิ่มได้เมื่อสร้างบัญชีให้ทีม</span>
                ))}
              </div>
              </ReadOnly>
              <ReadOnly ro={ro}>
              <div style={box}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <H>นัดหมาย</H>
                  <button onClick={() => openSched({ ids: [c.id] })} className="btn sm">เพิ่มนัด</button>
                </div>
                {!tasks.length && <span className="empty">ยังไม่มีนัด</span>}
                {tasks.map((t) => {
                  const ti = taskInfo(e, t);
                  return (
                    <div key={t.id} className="dr-row" style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid var(--divider)', paddingTop: 8 }}>
                      <DoneBox t={t} onToggle={() => e.toggleTask(t)} />
                      <span style={{ flex: 1, fontSize: 14, textDecoration: t.done ? 'line-through' : 'none' }}>{ti.meta}{t.note ? ' · ' + t.note : ''}</span>
                      <span className="dr-acts">
                        <button onClick={() => openSched({ taskId: t.id, ids: [t.gid] })} className="lnk" style={{ fontSize: 13 }}>เลื่อน</button>
                        <button onClick={() => e.delTask(t)} className="quiet">ลบ</button>
                      </span>
                    </div>
                  );
                })}
              </div>
              </ReadOnly>
              <div style={{ ...box, gap: 12 }}>
                <H>บันทึกการติดต่อ</H>
                {!ro && <form onSubmit={addLog} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <select name="type" aria-label="ประเภท" className="fld sel">
                      <Opts options={[{ v: 'call', label: 'โทร' }, { v: 'email', label: 'อีเมล' }, { v: 'meet', label: 'นัดพบ' }, { v: 'note', label: 'โน้ต' }]} />
                    </select>
                    <select name="result" aria-label="ผลการติดต่อ" className="fld sel">
                      <Opts all="ผลการติดต่อ" options={LOG_RESULTS.map((v) => ({ v, label: v }))} />
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input name="text" aria-label="รายละเอียด" placeholder="เช่น คุยกับฝ่ายจัดซื้อ ให้ส่งใบเสนอราคา" className="fld" style={{ flex: 1, minWidth: 0 }} />
                    <button type="submit" className="btn pri">บันทึก</button>
                  </div>
                </form>}
                {!logs.length && <span className="empty">ยังไม่มีประวัติการติดต่อ</span>}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {logs.map((l, i) => {
                    // the type is said once, in the node's colour (the darkened ink); the rest is one grey line
                    const [tag, ink] = logType(l.type);
                    return (
                      <div key={l.at + i} className="dr-row" style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', gap: 12, padding: '10px 0', borderTop: '1px solid var(--divider)' }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: ink, marginTop: 6 }} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                          {l.text && <span style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l.text}</span>}
                          <span className="t-meta"><span style={{ color: ink }}>{tag}</span>{[l.result, dtTh(l.at), l.by].filter(Boolean).map((x) => ' · ' + x).join('')}</span>
                        </span>
                        {(e.can('admin') || (!ro && l.by === e.me())) && <span className="dr-acts"><button onClick={() => e.delLog(c.id, l)} className="quiet" style={{ alignSelf: 'flex-start' }}>ลบ</button></span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function BlockRow({ it }: { it: BlockItem }) {
  return (
    <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="t-name">{it.h}</span>
        {it.badge && <span style={{ fontSize: 13, color: inkOf(it.kind) === 'var(--ink)' ? 'var(--ink-2)' : inkOf(it.kind) }}>{it.badge}</span>}
      </div>
      {it.t1 && <span style={{ fontSize: 14, lineHeight: 1.55, wordBreak: 'break-word' }}>{it.t1}</span>}
      {it.t2 && <span style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, wordBreak: 'break-word' }}>{it.t2}</span>}
      <span style={{ fontSize: 13, color: 'var(--ink-2)', display: 'flex', gap: '4px 14px', flexWrap: 'wrap' }}>
        {it.kv.map(([k, v]) => (
          <span key={k}><span className="t-muted">{k}</span> {v}</span>
        ))}
      </span>
      {it.scope && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
          {/* brand shades, each with its words */}
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
            <span style={{ width: `${it.scope[0]}%`, background: 'var(--brand-deep)' }} />
            <span style={{ width: `${it.scope[1]}%`, background: '#5F86E0' }} />
            <span style={{ width: `${it.scope[2]}%`, background: '#B9C8F5' }} />
          </div>
          <span className="t-meta">ประเภท 1 {it.scope[3]} · ประเภท 2 {it.scope[4]} · ประเภท 3 {it.scope[5]}</span>
        </div>
      )}
      {it.from && <span className="t-meta">{it.from}</span>}
    </div>
  );
}

/** Newest year first; in a year, open jobs first. */
const newestFirst = (deals: Deal[]) => deals.sort((a, b) => b.year.localeCompare(a.year) || (a.jobStatus === 'open' ? 0 : 1) - (b.jobStatus === 'open' ? 0 : 1) || b.at.localeCompare(a.at));

/** Where the company stands in the Sales Tracker, and a one-click way to put it there (only while it
 *  has no deal this year). */
function SalesBox({ c }: { c: Company }) {
  const { engine: e, ui, set } = useApp();
  const ro = !e.can('edit');
  const deals = newestFirst(e.dealsOf(c.id));
  const custom = e.custom[c.id];
  const year = ui.slYear || beYear();
  const hasYear = deals.some((d) => d.year === year);
  return (
    <div style={{ ...box, gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <H>Sales Tracker</H>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {custom && !ro && <button onClick={() => set({ addCust: { deal: false, edit: c.id } })} className="lnk">แก้ไขข้อมูลลูกค้า</button>}
          {!ro && !hasYear && <button onClick={() => set({ sendIds: [c.id] })} className="btn sm">ส่งเข้า Sales Tracker</button>}
        </span>
      </div>
      {!deals.length && <span className="empty">ยังไม่อยู่ในตารางติดตามการขาย · ส่งเข้าแล้วข้อมูลติดต่อจะถูกกรอกให้</span>}
      {deals.map((d) => {
        const m = dealMoney(e.sales, d);
        const lc = lastContact(e.sales, d, todayISO());
        const more = [d.resp && 'ผู้รับผิดชอบ ' + d.resp, lc && 'ติดต่อล่าสุด ' + isoTh(lc), m.forecast != null && 'Forecast ' + fmtMoney(m.forecast) + (m.fcConfirmed ? ' (ยืนยันจากเอกสาร)' : '')].filter(Boolean);
        return (
          <button key={d.id} onClick={() => set({ sel: null, deal: d.id })} className="hv dr-deal">
            <span>ปี {d.year} · {d.section || 'ไม่ระบุหมวด'} · <b style={{ fontWeight: 500 }}>{trackerStatus(e.sales, d)}</b></span>
            {more.length > 0 && <span className="t-meta" style={{ fontSize: 13 }}>{more.join(' · ')}</span>}
          </button>
        );
      })}
    </div>
  );
}
