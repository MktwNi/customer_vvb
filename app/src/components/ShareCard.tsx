import { useState, type ReactNode } from 'react';
import { useApp } from '../state';
import { isoTh, localDay, todayISO } from '../lib/format';
import { cashLines, dealMoney, fmtMoney, type Deal } from '../lib/sales';
import { apportioned, equalSplit, pctOk, shareOf, shareSum, shareValid, splitSatang, unitsOf, type ShareLine } from '../lib/contrib';
import { Select } from './Select';
import { Icon } from './icons';
import { UnitName, unitCls } from './UnitBits';
import { UnitsDialog } from './UnitsDialog';

const m0 = (n: number) => fmtMoney(Math.round(n * 100) / 100) || '0';
/** A share as typed: "60", "33.3" (a comma for the decimal point too); NaN when it is not a number. */
const pctIn = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));

/**
 * สัดส่วนรายได้ (% Contribution) in the deal panel (dash impl-note §4, mockups 05, 05b, 06): how this deal's
 * money is split between units, which the Dashboard's quarter and commission cards count. Not saved: 100%
 * to the ผู้รับผิดชอบ's unit (computed). Saved: the units with their %, what each got of the money received
 * and of the whole job (Forecast). Editing: a unit and a % per row, "เพิ่มหน่วยงาน", "แบ่งเท่ากัน", and
 * บันทึก only once it adds up to 100. Only for accounts that see commission; read-only without
 * แก้สัดส่วน % ของงาน; a joint quotation's header is split by its member companies' shares.
 */
export function ShareCard({ d }: { d: Deal }) {
  const { engine: e } = useApp();
  const [ed, setEd] = useState<{ u: string; p: string }[] | null>(null);
  const [setup, setSetup] = useState(false);
  if (!e.seesComm()) return null;
  const S = e.sales, today = todayISO();
  const ctx = e.unitCtx();
  const live = unitsOf(ctx);
  const canEdit = e.can('edit.share');
  const canSet = e.can('set.units');
  const head = (link?: ReactNode, sub?: ReactNode) => (
    <div className="sl-pc-h">
      <h3 id="dp-share">สัดส่วนรายได้ (% Contribution)</h3>
      {link}
      {sub && <span className="sl-pc-s">{sub}</span>}
    </div>
  );
  const dialog = setup && <UnitsDialog onClose={() => setSetup(false)} />;
  if (!unitsOf(ctx, true).length)
    return canSet ? (
      <section className="dp-card sp-card" aria-labelledby="dp-share">
        {head(<button type="button" className="lnk" onClick={() => setSetup(true)}>ตั้งค่าหน่วยงาน</button>, 'ยังไม่ได้ตั้งหน่วยงาน · ตั้งหน่วยงานและคนในหน่วยงานก่อน แล้วจึงแบ่งสัดส่วนรายได้ของงานได้')}
        {dialog}
      </section>
    ) : null;
  if (apportioned(ctx, d))
    return (
      <section className="dp-card sp-card" aria-labelledby="dp-share">
        {head(undefined, 'แบ่งตามส่วนแบ่งของบริษัทในใบเสนอราคาร่วม แล้วแบ่งให้หน่วยงานตามสัดส่วนของงานแต่ละบริษัท')}
      </section>
    );
  const sh = shareOf(ctx, d);
  const fc = dealMoney(S, d).forecast;
  const got = cashLines(S, [d], today).reduce((a, l) => a + (l.kind === 'got' ? l.amt : 0), 0);

  // ---- editing
  if (ed && canEdit) {
    const lines = ed.map((x) => ({ u: x.u, p: pctIn(x.p) }));
    const sum = shareSum(lines.map((l) => ({ p: Number.isFinite(l.p) ? l.p : 0 })));
    const ok = shareValid(lines as ShareLine[]);
    const missing = lines.some((l) => !l.u);
    // a row left empty counts as 0 in the sum; one with something else than a share is said first
    const badPct = ed.some((x) => x.p.trim() !== '' && !pctOk(pctIn(x.p)));
    const empty = ed.some((x) => x.p.trim() === '');
    const left = Math.round((100 - sum) * 10) / 10;
    // each row's part of the whole job as typed (the rows need not add up yet)
    const amts = lines.map((l) => (fc != null && pctOk(l.p) ? Math.round(fc * l.p) / 100 : 0));
    const set = (i: number, p: Partial<{ u: string; p: string }>) => setEd(ed.map((x, j) => (j === i ? { ...x, ...p } : x)));
    const free = (i: number) => live.filter((u) => u.id === ed[i].u || !ed.some((x) => x.u === u.id));
    const save = () => {
      if (!ok) return;
      e.setShare(d.id, lines as ShareLine[]);
      setEd(null);
    };
    const words = ok ? (
      <><b>รวม 100%</b> · บันทึกได้</>
    ) : missing ? (
      'เลือกหน่วยงานให้ครบทุกแถว'
    ) : badPct ? (
      'ใส่สัดส่วนเป็นตัวเลขมากกว่า 0 ทศนิยมได้ 1 ตำแหน่ง เช่น 60 หรือ 33.3'
    ) : left > 0 ? (
      <><b>รวม {sum}%</b> · ยังขาด {left}% ใส่ให้ครบ 100% แล้วจึงบันทึกได้</>
    ) : left < 0 ? (
      <><b>รวม {sum}%</b> · เกิน {-left}% ลดให้เหลือ 100% แล้วจึงบันทึกได้</>
    ) : empty ? (
      <><b>รวม 100%</b> · แถวที่ยังไม่ได้ใส่สัดส่วน ใส่ % หรือเอาออกก่อนบันทึก</>
    ) : (
      ''
    );
    return (
      <section className="dp-card sp-card editing" aria-labelledby="dp-share">
        {head(undefined, 'แบ่งเงินของงานนี้ให้หน่วยงานที่ร่วมทำ รวมต้องเท่ากับ 100%')}
        <div className="sp-bar" role="img" aria-label={`แบ่งแล้ว ${sum}%`}>
          {lines.map((l, i) => (pctOk(l.p) && l.u ? <i key={i} className={unitCls(ctx, l.u)} style={{ flex: `${l.p} 1 0` }} /> : null))}
          {sum < 100 && <i className="gap" style={{ flex: `${100 - sum} 1 0` }} />}
        </div>
        <div className="sp-ed">
          <div className="sp-er ph" aria-hidden="true">
            <span>หน่วยงาน</span>
            <span className="r">สัดส่วน</span>
            <span className="r sp-amt">{fc != null ? `จากยอดงาน ${m0(fc)}` : ''}</span>
            <span />
          </div>
          {ed.map((x, i) => {
            const u = ctx.units[x.u];
            return (
              <div key={i} className="sp-er">
                <Select
                  label={`หน่วยงานแถวที่ ${i + 1}`}
                  value={x.u}
                  placeholder="เลือกหน่วยงาน"
                  // the unit's colour beside its name, as in the list
                  shown={u ? <span className="un"><i className={'ud u' + u.c} aria-hidden="true" /><span className="un-n">{u.n}</span></span> : 'เลือกหน่วยงาน'}
                  valueText={u ? u.n : undefined}
                  onChange={(v) => set(i, { u: v })}
                  options={free(i).map((y) => ({ v: y.id, label: y.n, lead: <i className={'ud u' + y.c} aria-hidden="true" /> }))}
                />
                <span className="sp-pct">
                  <input
                    className="sp-in"
                    inputMode="decimal"
                    value={x.p}
                    placeholder="0"
                    aria-label={`สัดส่วน ${u ? u.n : `แถวที่ ${i + 1}`} (%)`}
                    aria-invalid={x.p.trim() !== '' && !pctOk(pctIn(x.p)) ? true : undefined}
                    onChange={(ev) => set(i, { p: ev.target.value.replace(/[^\d.,]/g, '').slice(0, 5) })}
                  />
                  <span aria-hidden="true">%</span>
                </span>
                <span className="r sp-amt">{fc != null && pctOk(lines[i].p) ? m0(amts[i]) : <span className="z">—</span>}</span>
                <button type="button" className="quiet sp-x" aria-label={`เอา ${u ? u.n : `แถวที่ ${i + 1}`} ออก`} disabled={ed.length < 2} onClick={() => setEd(ed.filter((_, j) => j !== i))}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="sp-tools">
          {ed.length < live.length && <button type="button" className="lnk" onClick={() => setEd([...ed, { u: live.find((y) => !ed.some((x) => x.u === y.id))?.id || '', p: '' }])}>เพิ่มหน่วยงาน</button>}
          {ed.length > 1 && <button type="button" className="lnk" onClick={() => setEd(ed.map((x, i) => ({ ...x, p: String(equalSplit(ed.length)[i]) })))}>แบ่งเท่ากัน</button>}
          {sh.rec && <button type="button" className="lnk" onClick={() => window.confirm('ล้างสัดส่วนที่แบ่งไว้? งานนี้จะกลับไปนับให้หน่วยงานของผู้รับผิดชอบ 100%') && (e.setShare(d.id, null), setEd(null))}>กลับไปนับตามผู้รับผิดชอบ</button>}
        </div>
        <div className="sp-act">
          <span className={'sp-sum ' + (ok ? 'ok' : 'warn')} role="status">{words}</span>
          <button type="button" className="quiet" onClick={() => setEd(null)}>ยกเลิก</button>
          {ok && <button type="button" className="btn pri sm" onClick={save}>บันทึก</button>}
        </div>
      </section>
    );
  }

  const startEdit = () => setEd(sh.dflt ? [{ u: sh.own && ctx.units[sh.own] && !ctx.units[sh.own].off ? sh.own : live[0]?.id || '', p: '100' }] : sh.lines.map((l) => ({ u: l.u, p: String(l.p) })));
  const editLink = canEdit && live.length > 0 && <button type="button" className="lnk" onClick={startEdit}>{sh.dflt ? 'แบ่งสัดส่วน' : 'แก้ไข'}</button>;

  // ---- not split: 100% to the ผู้รับผิดชอบ's unit
  if (sh.dflt) {
    const who = d.resp ? `ผู้รับผิดชอบ (${d.resp})` : 'ผู้รับผิดชอบ';
    return (
      <section className="dp-card sp-card sp-def" aria-labelledby="dp-share">
        {head(
          editLink,
          sh.own ? (
            <>นับให้ <span className="un-i"><i className={'ud ' + unitCls(ctx, sh.own)} aria-hidden="true" />{ctx.units[sh.own].n}</span> 100% ตาม{who} · ยังไม่ได้แบ่ง</>
          ) : (
            <>นับเป็น “ยังไม่ระบุหน่วยงาน” เพราะ{d.resp ? `${d.resp} ยังไม่อยู่หน่วยงานใด` : 'ยังไม่มอบหมายผู้รับผิดชอบ'} · ยังไม่ได้แบ่ง{canSet && d.resp ? <> · <button type="button" className="lnk" style={{ fontSize: 'inherit' }} onClick={() => setSetup(true)}>ตั้งค่าหน่วยงาน</button></> : null}</>
          ),
        )}
        {sh.bad && <p className="sp-note t-warn">สัดส่วนที่บันทึกไว้รวมไม่ครบ 100% จึงนับตามผู้รับผิดชอบไปก่อน{canEdit ? ' กด “แบ่งสัดส่วน” เพื่อแก้' : ''}</p>}
        <div className="sp-bar" role="img" aria-label={`${sh.own ? ctx.units[sh.own].n : 'ยังไม่ระบุหน่วยงาน'} 100%`}>
          <i className={unitCls(ctx, sh.own)} style={{ flex: 1 }} />
        </div>
        {dialog}
      </section>
    );
  }

  // ---- saved split
  const ps = sh.lines.map((l) => l.p);
  const gotBy = splitSatang(got, ps), fcBy = fc != null ? splitSatang(fc, ps) : [];
  const by = sh.rec?.by ? `แก้ล่าสุดโดย ${sh.rec.by}${sh.rec.at ? ' · ' + isoTh(localDay(sh.rec.at)) : ''}` : '';
  return (
    <section className="dp-card sp-card" aria-labelledby="dp-share">
      {head(editLink, `แบ่งให้ ${sh.lines.length} หน่วยงาน · รวม 100% · ใช้คิดยอดและค่าคอมมิชชั่นตามหน่วยงานใน Dashboard`)}
      <div className="sp-bar" role="img" aria-label={sh.lines.map((l) => `${ctx.units[l.u]?.n || 'ยังไม่ระบุหน่วยงาน'} ${l.p}%`).join(' · ')}>
        {sh.lines.map((l) => <i key={l.u || '-'} className={unitCls(ctx, l.u)} style={{ flex: `${l.p} 1 0` }} />)}
      </div>
      <div className="sp-t" role="table" aria-label="สัดส่วนรายได้ตามหน่วยงาน">
        <div className="sp-r ph" role="row">
          <span role="columnheader">หน่วยงาน</span>
          <span role="columnheader" className="r">สัดส่วน</span>
          <span role="columnheader" className="r">รับแล้ว (บาท)</span>
          <span role="columnheader" className="r">ทั้งงาน (บาท)</span>
        </div>
        {sh.lines.map((l, i) => (
          <div key={l.u || '-'} className="sp-r" role="row">
            <span role="cell"><UnitName ctx={ctx} id={l.u} /></span>
            <span role="cell" className="r">{l.p}%</span>
            <span role="cell" className="r">{m0(gotBy[i])}</span>
            <span role="cell" className="r">{fc != null ? m0(fcBy[i]) : '—'}</span>
          </div>
        ))}
        <div className="sp-r sum" role="row">
          <span role="cell">รวม</span>
          <span role="cell" className="r">100%</span>
          <span role="cell" className="r">{m0(got)}</span>
          <span role="cell" className="r">{fc != null ? m0(fc) : '—'}</span>
        </div>
      </div>
      <div className="sl-pc-f">
        <span>{by}</span>
        <span>ถ้าไม่แบ่ง งานจะนับให้หน่วยงานของผู้รับผิดชอบ 100%</span>
      </div>
    </section>
  );
}
