import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useApp, useEngineVersion, type DetailTab } from '../state';
import { CST, LOG_RESULTS, LOG_TYPES, PILL, SRCC, STG, TGT, stageOf } from '../lib/constants';
import { dtTh, fmtN, gccCode, isoTh, money, telHref, todayISO, ymTh } from '../lib/format';
import type { Cert, Company, ContactForm, Detail, StageKey } from '../lib/types';
import { dealMoney, dealStatus, fmtMoney, lastContact, lastStage, type Deal, type SalesState } from '../lib/sales';
import { dedupFilter } from '../tabs/Dedup';
import { DoneBox, taskInfo } from '../tabs/Plan';
import { Opts, SrcTags, heroGrad, inputStyle } from './ui';
import { CoAvatar } from './CoAvatar';
import { useDialog } from './useDialog';

const box: CSSProperties = { background: '#fff', border: '1px solid #E3E7F1', borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 };
const kicker: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#1F5BD8' };
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: '#475069' };

interface BlockItem { key: string; h: string; badge: string; bBg: string; bFg: string; t1: string; t2: string; kv: [string, string][]; scope?: [number, number, number, string, string, string]; from: string }
interface Block { k: 't' | 'g' | 'f' | 's'; src: number; title: string; items: BlockItem[] }

export function CompanyDrawer() {
  const { engine: e, ui, set, go, openSched } = useApp();
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
      key: 'c' + x.cid, h: x.cert || 'ไม่มีเลขที่ใบรับรอง', badge: CST[x.st][0], bBg: PILL[x.st][0], bFg: PILL[x.st][1], t1: x.org, t2: x.act && x.act !== x.org ? x.act : '',
      kv: [['อนุมัติ', isoTh(x.ap)], ['หมดอายุ', isoTh(x.ex)], ['จังหวัด', x.provTxt || CD.prov[x.prov] || '—']],
      scope: sc ? [((x.s1 || 0) / tot) * 100, ((x.s2 || 0) / tot) * 100, ((x.s3 || 0) / tot) * 100, p(x.s1), p(x.s2), p(x.s3)] : undefined,
      from: x.tgo ? x.note : from(x.gid0),
    };
  };
  const pill = (x: string) => (/อยู่ในอายุ/.test(x) ? ['#DDF5F1', '#0B6E66'] : ['#EEF1F8', '#475069']);
  const s = (v: unknown) => (v == null ? '' : String(v));
  const blocks: Block[] = [];
  if (certs.length) blocks.push({ k: 't', src: 0, title: 'ใบรับรอง CFO', items: certs.map(certItem) });
  if (d && d.g.length)
    blocks.push({
      k: 'g', src: 1, title: 'อุตสาหกรรมสีเขียว (GI)',
      items: d.g.slice().sort((a, b) => (b.x[0] as number) - (a.x[0] as number) || (b.x[1] as number) - (a.x[1] as number)).map(({ src, x }, i) => ({
        key: 'g' + i, h: `ระดับ ${s(x[1])} · ปีงบ ${s(x[0])}`, badge: s(x[9]), bBg: pill(s(x[9]))[0], bFg: pill(s(x[9]))[1], t1: s(x[3]), t2: s(x[2]),
        kv: ([['รับรอง', isoTh(s(x[7]))], ['หมดอายุ', x[8] ? isoTh(s(x[8])) : 'ไม่มีกำหนด'], ['จังหวัด', s(x[6]) || '—']] as [string, string][]).concat(x[4] ? [['ทะเบียนโรงงาน', s(x[4])]] : []),
        from: from(src),
      })),
    });
  if (d && d.f.length)
    blocks.push({
      k: 'f', src: 2, title: 'โรงงานที่เริ่มประกอบกิจการ (กรอ.)',
      items: d.f.map(({ src, x }, i) => ({
        key: 'f' + i, h: s(x[2]), badge: 'เริ่ม ' + ymTh(s(x[0])), bBg: '#E6ECFD', bFg: '#1745B8', t1: s(x[3]), t2: s(x[4]),
        kv: ([['เงินทุน', money(x[7] as number | null)]] as [string, string][]).concat(x[8] ? [['คนงาน', fmtN(x[8] as number) + ' คน']] : []).concat(x[5] ? [['โทร', s(x[5])]] : []),
        from: from(src),
      })),
    });
  if (d && d.s.length)
    blocks.push({
      k: 's', src: 3, title: 'บริษัทจดทะเบียน (SET)',
      items: d.s.map(({ src, x }, i) => ({
        key: 's' + i, h: s(x[0]), badge: s(x[2]), bBg: '#1745B8', bFg: '#fff', t1: s(x[1]), t2: s(x[5]),
        kv: ([['กลุ่มอุตสาหกรรม', s(x[3]) || '—']] as [string, string][]).concat(x[4] ? [['หมวดธุรกิจ', s(x[4])]] : []),
        from: from(src),
      })),
    });
  const shown = blocks.filter((b) => (dt === 'cfo' ? b.k === 't' : dt === 'src' ? b.k !== 't' : false));
  const srcN = d ? d.g.length + d.f.length + d.s.length : 0;
  const dTabs: [DetailTab, string, number][] = [['info', 'ข้อมูลบริษัท', 0], ['cfo', 'CFO · รอบ อบก.', certs.length], ['src', 'GI · โรงงาน · SET', srcN], ['crm', 'การติดต่อ', logs.length + nOpenT]];

  const cvT = CST[c.cfoSt];
  const cvSub = c.cfoSt === 'none' ? '' : c.cfoSt === 'soon' ? `เหลือ ${fmtN(c.days)} วัน · ${isoTh(c.cfoEx)}` : c.cfoEx ? isoTh(c.cfoEx) : '';
  const kpis = [
    { k: 'CFO', v: cvT[0], c: cvT[1], sub: c.cfoN ? `${fmtN(c.cfoN)} ใบ${cvSub ? ' · ' + cvSub : ''}` : 'ไม่พบใน TGO' },
    { k: 'GI ที่ยังใช้ได้', v: c.giLive ? 'ระดับ ' + c.giLive : '—', c: '#0B6E66', sub: c.giMax ? `สูงสุดที่เคยได้ ${c.giMax}${c.giUntil ? ' · ถึง ' + isoTh(c.giUntil) : ''}` : 'ไม่พบใน GI' },
    { k: 'โรงงานใหม่ (กรอ.)', v: c.invest ? money(c.invest) : '—', c: '#1F5BD8', sub: c.newYm ? 'เริ่ม ' + ymTh(c.newYm) : 'ไม่พบในรายชื่อโรงงานใหม่' },
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
      <aside ref={ref} className="panel" tabIndex={-1} role="dialog" aria-modal="true" aria-label={c.name} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(680px,100vw)', background: '#F6F8FE', zIndex: 41, overflowY: 'auto', boxShadow: '-20px 0 60px -20px rgba(4,10,60,.4)', outline: 'none' }}>
        <div className="hero" style={{ background: heroGrad, color: '#fff', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#fff' }}>{c.code} · {D.type[c.type]}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => e.toggleWatch(c.id)} style={{ cursor: 'pointer', height: 36, padding: '0 14px', borderRadius: 999, border: 0, background: 'rgba(6,22,90,.2)', color: '#fff', fontSize: 13 }}>{watched ? '★ ติดตามอยู่' : '☆ ติดตาม'}</button>
              <button onClick={close} aria-label="ปิด" style={{ cursor: 'pointer', width: 36, height: 36, borderRadius: '50%', border: 0, background: 'rgba(6,22,90,.2)', color: '#fff', fontSize: 18 }}>×</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <CoAvatar name={c.name} web={c.web} set={c.set} size={56} ring="rgba(255,255,255,.9)" />
            <span style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.35, textWrap: 'pretty', minWidth: 0 }}>{c.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 999, background: '#fff', color: '#1F5BD8', fontWeight: 500 }}>{`กลุ่ม ${c.tgt + 1} · ${TGT[c.tgt]}`}</span>
            <SrcTags mask={c.src} size="lg" />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#fff' }}>
            {deal ? (
              <span>สถานะการขาย <b style={{ fontWeight: 500, color: '#fff' }}>{trackerStatus(e.sales, deal)}</b> (Sales Tracker ปี {deal.year})</span>
            ) : (
              <span>สถานะการขาย <b style={{ fontWeight: 500, color: '#fff' }}>{st[1]}</b></span>
            )}
            {deal && st[0] !== 'none' && <span>แผนติดต่อ <b style={{ fontWeight: 500, color: '#fff' }}>{st[1]}</b></span>}
            <span>ผู้รับผิดชอบ <b style={{ fontWeight: 500, color: '#fff' }}>{owner || 'ยังไม่มี'}</b></span>
            <span>{lastAt ? 'ติดต่อล่าสุด ' + isoTh(lastAt) : 'ยังไม่เคยติดต่อ'}</span>
          </div>
        </div>

        <div role="tablist" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#F6F8FE', padding: '8px 24px 0', display: 'flex', gap: 2, borderBottom: '1px solid #E3E7F1', overflowX: 'auto' }}>
          {dTabs.map(([k, label, n]) => {
            const on = dt === k;
            return (
              <button key={k} role="tab" aria-selected={on} onClick={() => set({ dTab: k })} style={{ cursor: 'pointer', flex: 'none', border: 0, background: 'transparent', padding: '12px 12px 10px', fontSize: 14, fontWeight: on ? 600 : 400, color: on ? '#1F5BD8' : '#475069', borderBottom: `2.5px solid ${on ? '#1F5BD8' : 'transparent'}`, display: 'flex', gap: 6, alignItems: 'center' }}>
                {label}
                {n > 0 && <span style={{ fontSize: 11, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: '#E6ECFD', color: '#1745B8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fmtN(n)}</span>}
              </button>
            );
          })}
        </div>

        <div style={{ padding: '18px 24px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {dt === 'info' && (
            <>
              <SalesBox c={c} />
              {multi && (
                <div style={{ background: '#E6ECFD', borderRadius: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1F5BD8' }}>รวมจาก {c.ids.length} แถวในไฟล์ต้นทาง</span>
                  {c.ids.map((id) => {
                    const rr = e.B.rawById.get(id)!;
                    return (
                      <span key={id} style={{ fontSize: 12.5, color: '#1745B8', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontWeight: 500 }}>{gccCode(id)}</span>
                        <span>{rr.name}</span>
                        <SrcTags mask={rr.src} size="sm" />
                      </span>
                    );
                  })}
                </div>
              )}
              {myG.length > 0 && (
                <button onClick={() => go('dedup', { sel: null, ddF: 'pending', ddPage: Math.floor(pendingG.indexOf(myG[0]) / 20) })} style={{ cursor: 'pointer', textAlign: 'left', background: '#FFF7E6', border: '1px solid #F3D9A4', borderRadius: 14, padding: '10px 14px', fontSize: 13, color: '#6B4100' }}>
                  {`มีข้อมูลที่อาจซ้ำกับบริษัทนี้ ${myG.length} กลุ่ม รอตรวจ · กดเพื่อไปที่ตรวจข้อมูลซ้ำ`}
                </button>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
                {kpis.map((k) => (
                  <div key={k.k} style={{ background: '#fff', border: '1px solid #E3E7F1', borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12, color: '#475069' }}>{k.k}</span>
                    <span style={{ fontSize: 18, fontWeight: 500, color: k.c }}>{k.v}</span>
                    <span style={{ fontSize: 11.5, color: '#5E6680' }}>{k.sub}</span>
                  </div>
                ))}
              </div>
              <div style={box}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <span style={kicker}>ข้อมูลติดต่อ</span>
                  <button onClick={() => setEditC(editC ? null : { phone: c.phone || '', email: c.email || '', web: c.web || '', note: (ce && ce.note) || '' })} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#1F5BD8', fontSize: 13, textDecoration: 'underline' }}>{editC ? 'ปิดการแก้ไข' : 'แก้ไข'}</button>
                </div>
                {!ph.length && !em.length && !c.web && !dc && <span style={{ fontSize: 14, color: '#475069' }}>ยังไม่มีเบอร์โทร อีเมล หรือเว็บไซต์ในทุกแหล่ง</span>}
                {ph.map((t) => <a key={t} href={telHref(t)} style={{ fontSize: 16, fontWeight: 500, textDecoration: 'none' }}>{t}</a>)}
                {em.map((t) => <a key={t} href={'mailto:' + t} style={{ fontSize: 14 }}>{t}</a>)}
                {c.web && <a href={/^https?:\/\//.test(c.web) ? c.web : 'https://' + c.web} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, wordBreak: 'break-all' }}>{c.web}</a>}
                {dc && (
                  <span style={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap', alignItems: 'baseline', fontSize: 14, wordBreak: 'break-word' }}>
                    <span style={{ fontSize: 12.5, color: '#475069' }}>ผู้ติดต่อใน Sales Tracker</span>
                    {dc.name && <span>{dc.name}</span>}
                    {dc.phones.map((t) => <a key={t} href={telHref(t)}>{t}</a>)}
                    {dc.emails.map((t) => <a key={t} href={'mailto:' + t}>{t}</a>)}
                  </span>
                )}
                {ctSrc && <span style={{ fontSize: 12, color: '#475069' }}>{ctSrc}</span>}
                {editC && (
                  <form onSubmit={saveContact} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#F6F8FE', borderRadius: 12, padding: 14 }}>
                    <label style={field}>เบอร์โทร (คั่นหลายเบอร์ด้วย |)<input name="phone" defaultValue={editC.phone} style={inputStyle} /></label>
                    <label style={field}>อีเมล<input name="email" defaultValue={editC.email} style={inputStyle} /></label>
                    <label style={field}>เว็บไซต์<input name="web" defaultValue={editC.web} style={inputStyle} /></label>
                    <label style={field}>ผู้ติดต่อ / หมายเหตุ<input name="note" defaultValue={editC.note} style={inputStyle} /></label>
                    <button type="submit" style={{ cursor: 'pointer', alignSelf: 'flex-start', height: 38, padding: '0 16px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13.5 }}>บันทึก</button>
                  </form>
                )}
              </div>
              <div style={{ ...box, gap: 9 }}>
                {facts.map(([k, v]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0,1fr)', gap: 12, fontSize: 14 }}>
                    <span style={{ color: '#475069' }}>{k}</span>
                    <span style={{ wordBreak: 'break-word' }}>{v}</span>
                  </div>
                ))}
              </div>
              <span style={{ fontSize: 12, color: '#5E6680' }}>การจับคู่ข้อมูล: {c.merged ? 'รวมจากหลายแถว (ชื่อตรงกัน)' : D.match[c.match] || '—'}</span>
            </>
          )}

          {(dt === 'cfo' || dt === 'src') && (
            <>
              {dt === 'cfo' && r && (
                <div style={{ ...box, padding: '14px 18px', gap: 8 }}>
                  <span style={kicker}>รอบ อบก. ที่ต้องยื่นต่ออายุ</span>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>รอบ {c.rnd}</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
                    {([['ส่งเอกสารภายใน', isoTh(r.doc)], ['ชำระค่าธรรมเนียม', isoTh(r.fee)], ['ประกาศผล', isoTh(r.ann)]] as const).map(([k, v]) => (
                      <div key={k} style={{ background: '#F6F8FE', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 11.5, color: '#475069' }}>{k}</span>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {rndWarn && <span style={{ fontSize: 13, color: '#8A2B12', background: '#FBE3DC', borderRadius: 10, padding: '8px 10px' }}>{rndWarn}</span>}
                </div>
              )}
              {dt === 'src' && !d && <span style={{ fontSize: 13.5, color: '#475069' }}>กำลังโหลดรายละเอียดรายแหล่ง…</span>}
              {shown.map((b) => {
                const all = more[b.k] ? b.items : b.items.slice(0, 6);
                return (
                  <div key={b.k} style={box}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 999, background: SRCC[b.src][1], color: SRCC[b.src][2] }}>{SRCC[b.src][0]}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{b.title}</span>
                      </span>
                      <span style={{ fontSize: 12, color: '#475069' }}>{fmtN(b.items.length)} รายการ</span>
                    </div>
                    {all.map((it) => <BlockRow key={it.key} it={it} />)}
                    {!more[b.k] && b.items.length > 6 && (
                      <button onClick={() => setMore({ ...more, [b.k]: true })} style={{ cursor: 'pointer', alignSelf: 'flex-start', border: 0, background: 'transparent', color: '#1F5BD8', fontSize: 13, textDecoration: 'underline', padding: 0 }}>ดูทั้งหมด {fmtN(b.items.length)} รายการ</button>
                    )}
                  </div>
                );
              })}
              {!shown.length && !(dt === 'src' && !d) && (
                <div style={{ ...box, padding: 24, textAlign: 'center', fontSize: 14, color: '#475069' }}>{dt === 'cfo' ? 'ไม่พบใบรับรอง CFO ของบริษัทนี้ใน TGO' : 'ไม่พบข้อมูลใน GI, กรอ. หรือ SET'}</div>
              )}
            </>
          )}

          {dt === 'crm' && (
            <>
              <div style={{ ...box, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                <label style={{ ...field, gap: 5 }}>
                  สถานะการขาย
                  <select value={st[0]} onChange={(ev) => e.setStage(c.id, ev.target.value as StageKey)} style={{ height: 40, borderRadius: 10, border: 0, padding: '0 12px', fontSize: 14, background: st[2], color: st[3] }}>
                    <Opts options={STG.map(([v, label]) => ({ v, label }))} />
                  </select>
                </label>
                <label style={{ ...field, gap: 5 }}>
                  ผู้รับผิดชอบ
                  <select value={C.owners[c.id] || ''} onChange={(ev) => e.setOwner(c.id, ev.target.value)} style={{ height: 40, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14, background: '#fff', color: '#0E1430' }}>
                    <Opts all="ยังไม่มีผู้รับผิดชอบ" options={C.team.map((v) => ({ v, label: v }))} />
                  </select>
                </label>
                {!C.team.length && <button onClick={() => go('update', { sel: null })} style={{ cursor: 'pointer', gridColumn: '1/-1', textAlign: 'left', border: 0, background: 'transparent', color: '#1F5BD8', fontSize: 13, textDecoration: 'underline', padding: 0 }}>ยังไม่มีรายชื่อทีม เพิ่มได้ที่แท็บอัปเดตข้อมูล</button>}
              </div>
              <div style={box}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={kicker}>นัดหมาย</span>
                  <button onClick={() => openSched({ ids: [c.id] })} style={{ cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: '1.5px solid #1F5BD8', background: '#fff', color: '#1F5BD8', fontSize: 13 }}>+ เพิ่มนัด</button>
                </div>
                {!tasks.length && <span style={{ fontSize: 13.5, color: '#5E6680' }}>ยังไม่มีนัด</span>}
                {tasks.map((t) => {
                  const ti = taskInfo(e, t);
                  return (
                    <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid #EEF1F8', paddingTop: 8 }}>
                      <DoneBox t={t} color={ti.color} onToggle={() => e.toggleTask(t)} size={12} />
                      <span style={{ flex: 1, fontSize: 13.5, textDecoration: t.done ? 'line-through' : 'none' }}>{ti.meta}{t.note ? ' · ' + t.note : ''}</span>
                      <button onClick={() => openSched({ taskId: t.id, ids: [t.gid] })} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#1F5BD8', fontSize: 12.5 }}>เลื่อน</button>
                      <button onClick={() => e.delTask(t)} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#A33A1A', fontSize: 12.5 }}>ลบ</button>
                    </div>
                  );
                })}
              </div>
              <div style={{ ...box, gap: 12 }}>
                <span style={kicker}>บันทึกการติดต่อ</span>
                <form onSubmit={addLog} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#F6F8FE', borderRadius: 14, padding: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <select name="type" aria-label="ประเภท" style={{ height: 40, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14, background: '#fff', color: '#0E1430' }}>
                      <Opts options={[{ v: 'call', label: 'โทร' }, { v: 'email', label: 'อีเมล' }, { v: 'meet', label: 'นัดพบ' }, { v: 'note', label: 'โน้ต' }]} />
                    </select>
                    <select name="result" aria-label="ผลการติดต่อ" style={{ height: 40, border: '1.5px solid #D5DBEA', borderRadius: 10, padding: '0 10px', fontSize: 14, background: '#fff', color: '#0E1430' }}>
                      <Opts all="ผลการติดต่อ" options={LOG_RESULTS.map((v) => ({ v, label: v }))} />
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input name="text" aria-label="รายละเอียด" placeholder="เช่น คุยกับฝ่ายจัดซื้อ ให้ส่งใบเสนอราคา" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                    <button type="submit" style={{ cursor: 'pointer', height: 40, padding: '0 16px', borderRadius: 999, border: 0, background: '#1F5BD8', color: '#fff', fontSize: 13.5 }}>บันทึก</button>
                  </div>
                </form>
                {!logs.length && <span style={{ fontSize: 13.5, color: '#5E6680' }}>ยังไม่มีประวัติการติดต่อ</span>}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {logs.map((l, i) => {
                    const [tag, color] = LOG_TYPES[l.type] || LOG_TYPES.note;
                    return (
                      <div key={l.at + i} style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', gap: 12, padding: '10px 0', borderTop: '1px solid #EEF1F8' }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, marginTop: 6 }} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 500, color }}>{tag}</span>
                            {l.result && <span style={{ fontSize: 11.5, padding: '1px 8px', borderRadius: 999, background: '#F6F8FE', color: '#384155' }}>{l.result}</span>}
                          </span>
                          {l.text && <span style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l.text}</span>}
                          <span style={{ fontSize: 11.5, color: '#5E6680' }}>{[dtTh(l.at), l.by].filter(Boolean).join(' · ')}</span>
                        </span>
                        <button onClick={() => e.delLog(c.id, l)} style={{ cursor: 'pointer', border: 0, background: 'transparent', color: '#A33A1A', fontSize: 12, alignSelf: 'flex-start' }}>ลบ</button>
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
    <div style={{ borderTop: '1px solid #EEF1F8', paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{it.h}</span>
        {it.badge && <span style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, background: it.bBg, color: it.bFg }}>{it.badge}</span>}
      </div>
      {it.t1 && <span style={{ fontSize: 13, color: '#384155', lineHeight: 1.55, wordBreak: 'break-word' }}>{it.t1}</span>}
      {it.t2 && <span style={{ fontSize: 13, color: '#475069', lineHeight: 1.55, wordBreak: 'break-word' }}>{it.t2}</span>}
      <span style={{ fontSize: 12.5, color: '#475069', display: 'flex', gap: '4px 14px', flexWrap: 'wrap' }}>
        {it.kv.map(([k, v]) => (
          <span key={k}><span style={{ color: '#5E6680' }}>{k}</span> {v}</span>
        ))}
      </span>
      {it.scope && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
            <span style={{ width: `${it.scope[0]}%`, background: '#0A1A86' }} />
            <span style={{ width: `${it.scope[1]}%`, background: '#4D72FF' }} />
            <span style={{ width: `${it.scope[2]}%`, background: '#34D1C4' }} />
          </div>
          <span style={{ fontSize: 11.5, color: '#475069' }}>ประเภท 1 {it.scope[3]} · ประเภท 2 {it.scope[4]} · ประเภท 3 {it.scope[5]}</span>
        </div>
      )}
      {it.from && <span style={{ fontSize: 11.5, color: '#5E6680' }}>{it.from}</span>}
    </div>
  );
}

/** Newest year first; in a year, open jobs first. */
const newestFirst = (deals: Deal[]) => deals.sort((a, b) => b.year.localeCompare(a.year) || (a.jobStatus === 'open' ? 0 : 1) - (b.jobStatus === 'open' ? 0 : 1) || b.at.localeCompare(a.at));

/** One line for a deal: its status, and the result when the job is closed ("ปิดงาน" alone doesn't say whether it was won), else the stage reached. */
function trackerStatus(S: SalesState, d: Deal) {
  const st = dealStatus(S, d);
  const res = st.result === 'YES' || st.result === 'NO' ? st.result : '';
  const last = lastStage(S, d);
  const overall = st.overall.length > 40 ? st.overall.slice(0, 40) + '…' : st.overall; // a waiting note can be long
  return [overall, d.jobStatus === 'closed' && res ? 'ผล ' + res : '', !res && last ? 'ขั้นล่าสุด ' + last : ''].filter(Boolean).join(' · ');
}

/** Where the company stands in the Sales Tracker, and a one-click way to put it there. */
function SalesBox({ c }: { c: Company }) {
  const { engine: e, set } = useApp();
  const deals = newestFirst(e.dealsOf(c.id));
  const custom = e.custom[c.id];
  const btn: CSSProperties = { cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 999, border: '1.5px solid #1F5BD8', background: '#fff', color: '#1F5BD8', fontSize: 13 };
  return (
    <div style={{ ...box, gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={kicker}>Sales Tracker</span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {custom && <button onClick={() => set({ addCust: { deal: false, edit: c.id } })} style={{ ...btn, borderColor: '#D5DBEA', color: '#0E1430' }}>แก้ไขข้อมูลลูกค้า</button>}
          <button onClick={() => set({ sendIds: [c.id] })} style={{ ...btn, background: '#1F5BD8', color: '#fff' }}>+ ส่งเข้า Sales Tracker</button>
        </span>
      </div>
      {!deals.length && <span style={{ fontSize: 13, color: '#475069' }}>ยังไม่อยู่ในตารางติดตามการขาย — กดส่งเข้า แล้วข้อมูลติดต่อจะถูกกรอกให้อัตโนมัติ</span>}
      {deals.map((d) => {
        const m = dealMoney(e.sales, d);
        const more = [d.resp && 'ผู้รับผิดชอบ ' + d.resp, lastContact(e.sales, d, todayISO()) && 'ติดต่อล่าสุด ' + isoTh(lastContact(e.sales, d, todayISO())), m.forecast != null && 'Forecast ' + fmtMoney(m.forecast) + (m.fcConfirmed ? ' ✓' : '')].filter(Boolean);
        return (
          <button key={d.id} onClick={() => set({ sel: null, deal: d.id })} className="h-bg" style={{ cursor: 'pointer', border: '1px solid #E3E7F1', borderRadius: 12, background: '#fff', textAlign: 'left', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5, flexWrap: 'wrap' }}>
            <span>ปี {d.year} · {d.section || 'ไม่ระบุหมวด'} · <b style={{ fontWeight: 500 }}>{trackerStatus(e.sales, d)}</b></span>
            <span style={{ color: '#475069', fontSize: 12.5 }}>{[...more, 'เปิด →'].join(' · ')}</span>
          </button>
        );
      })}
    </div>
  );
}
