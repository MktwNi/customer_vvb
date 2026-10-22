import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp, useEngineVersion } from '../state';
import {
  BIG, bulkActs, confirmWords, createSel, followNote, followSplit, followedPicked, hintWord, localWord, ownerNote, ownerSplit, ownerSub, pickedCos, pickedRows, rowFits,
  selWord, tooManyWord, unfollowNote, unfollowedWord, type Row, type SelStore,
} from '../lib/bulk';
import { fmtN } from '../lib/format';
import { Modal, DialogActions } from './Dialog';
import { Notice } from './ui';
import { SelField } from './Select';
import { Av, Pop } from './Pop';
import { Chevron } from './StageTrack';
import { menuKeys } from './usePopover';
import { useSalesActs } from './SalesToast';

/** What is picked on the search page: kept while the person opens a company or another page and comes
 *  back; let go when the filters change (tabs/Search.tsx). */
export const searchSel = createSel();
/** The same for บริษัทที่ติดตาม's list (tabs/TrackFollow.tsx): its own picks, let go when its quick filter changes. */
export const followSel = createSel();
/** The picked keys of a store; re-renders the page that reads them, not the whole app. */
export function useSel(store: SelStore = searchSel) {
  return useSyncExternalStore(store.sub, store.get, store.get);
}

type Act = 'follow' | 'unfollow' | 'tracker' | 'plan' | 'owner' | 'csv';

/**
 * The bar over the search results (the owner's "เลือกทั้งหมด แล้วเลือกได้ว่าจะทำอะไร"). It is there whenever
 * there are results, so ticking the first row moves nothing under the pointer: before anything is picked
 * it is a quiet line saying what ticking does; then how many are picked and what this account may do with
 * them (lib/bulk.ts bulkActs): ติดตาม / เลิกติดตาม, ส่งเข้า Sales Tracker (the send dialog), วางแผนติดต่อ (the
 * appointment dialog, spread per day), ตั้งผู้รับผิดชอบ, ส่งออก CSV, ล้างที่เลือก. It keeps one row (the same
 * height either way): when the buttons do not fit, they are one "ทำรายการ" menu (phones, narrow windows).
 * While something is picked it stays under the top of the page as the list scrolls. Acting on more than
 * BIG companies asks first (บริษัทที่ติดตาม: every unfollow asks, `sure`); on บริษัทที่ติดตาม (`undo`) an unfollow says
 * how many it took off, with เลิกทำ to put exactly those back; elsewhere it keeps its earlier toast. Each action says
 * what it did at the bottom, with a link to where they went.
 */
export function BulkBar({ view, rows, sel, n, store = searchSel, sure = false, undo = false, onUnfollowed }: {
  view: 'co' | 'cert'; rows: readonly Row[]; sel: ReadonlySet<number>; n: number;
  /** the store the picks are kept in (searchSel, or followSel on บริษัทที่ติดตาม) */
  store?: SelStore;
  /** ask before any unfollow, not only from BIG companies (บริษัทที่ติดตาม: every bulk unfollow is confirmed) */
  sure?: boolean;
  /** a bulk unfollow's toast says what it took off and offers เลิกทำ (บริษัทที่ติดตาม); the search page's toast stays as it was */
  undo?: boolean;
  /** after a bulk unfollow: the bar and its dialog go with the companies taken off. `keyboard`: it was confirmed from
   *  the keyboard, so the page keeps the focus on its list (a pointer's confirm leaves it as it falls) */
  onUnfollowed?: (keyboard: boolean) => void;
}) {
  const { engine: e, set, openSched } = useApp();
  const ver = useEngineVersion();
  const { say } = useSalesActs();
  const idle = n === 0;
  const cos = useMemo(() => (idle ? [] : pickedCos(sel, rows)), [idle, sel, rows]);
  // followed by any of its ids (a follow made on a row since merged into it: lib/follow.ts followIdsOf)
  const watch = useMemo(() => new Set(e.crm.watch.map((id) => e.canonical(id))), [e, ver]);
  const fs = followSplit(cos.map((id) => e.canonical(id)), watch);
  const can = (c: Parameters<typeof e.can>[0]) => e.can(c);
  const acts = bulkActs(can, fs.on, cos.length);
  const team = !!e.teamCfg;
  const [ask, setAsk] = useState<'follow' | 'unfollow' | null>(null);
  const [owner, setOwner] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const clear = () => store.set({ key: store.get().key, ids: new Set() });

  const follow = (on: boolean, keyboard = false) => {
    setAsk(null);
    if (on) {
      const r = e.setWatchMany(cos, true);
      say(followNote(r.changed, r.same) + localWord(r.local), { ms: 8000, acts: r.changed ? [{ label: 'ดูบริษัทที่ติดตาม', act: 'goTrack', primary: true }] : undefined });
      return;
    }
    // the ids taken off, as stored (a company followed through a row since merged into it keeps that id): เลิกทำ
    // puts exactly these back, not the others picked
    const gone = followedPicked(cos, e.crm.watch, (id) => e.canonical(id));
    const r = e.setWatchMany(cos, false);
    if (undo) say(unfollowedWord(r.changed, r.same) + localWord(r.local), { ms: 10000, acts: r.changed ? [{ label: 'เลิกทำ', act: 'refollow', ids: gone }] : undefined });
    else say(unfollowNote(r.changed, r.same) + localWord(r.local), { ms: 6000 });
    onUnfollowed?.(keyboard);
  };
  const run = (a: Act) => {
    setMenu(false);
    if (a === 'follow') return fs.off > BIG ? setAsk('follow') : follow(true);
    if (a === 'unfollow') return sure || fs.on > BIG ? setAsk('unfollow') : follow(false);
    if (a === 'tracker') return set({ sendIds: cos, sendStay: true });
    if (a === 'plan') return openSched({ ids: cos, stay: true });
    if (a === 'owner') return setOwner(true);
    // the same columns as ส่งออก CSV beside the search box, the picked rows only
    e.exportCsv(view, pickedRows(sel, rows));
  };
  const list: [Act, string, boolean][] = [
    ['follow', 'ติดตาม', acts.follow],
    ['unfollow', 'เลิกติดตาม', acts.unfollow],
    ['tracker', 'ส่งเข้า Sales Tracker', acts.tracker],
    ['plan', 'วางแผนติดต่อ', acts.plan],
    ['owner', 'ตั้งผู้รับผิดชอบ', acts.owner],
    ['csv', 'ส่งออก CSV', acts.csv],
  ];
  const shown = list.filter((x) => x[2]);
  const cw = ask ? confirmWords(ask, ask === 'follow' ? fs.off : fs.on, ask === 'follow' ? fs.on : fs.off, team) : null;
  const long = selWord(view, n, cos.length);
  // before anything is picked: what ticking leads to (an account that may only export is told so)
  const some = bulkActs(can, 0, 1);
  const hint = hintWord(view, !(some.follow || some.tracker || some.plan || some.owner));

  // ---- one row: the buttons when they fit, else the menu. Measured on a hidden copy (the full count and
  // every button), so the choice does not depend on which one is showing and never flips back and forth.
  const barRef = useRef<HTMLDivElement>(null);
  const measRef = useRef<HTMLSpanElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState(true);
  const why = idle || !acts.tooMany ? '' : tooManyWord(cos.length);
  const shape = long + '|' + shown.map((x) => x[0]).join() + '|' + why;
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (idle || !bar) return;
    const check = () => {
      const meas = measRef.current, clr = clearRef.current;
      if (!meas || !clr) return;
      const cs = getComputedStyle(bar);
      const inner = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const gap = parseFloat(cs.columnGap) || 0;
      const w = (sel: string) => [...meas.querySelectorAll<HTMLElement>(sel)].map((x) => x.offsetWidth);
      const btns = w('.btn'), [count] = w('.bk-mn'), whyW = w('.bk-mw');
      // the count (and its 4px), the buttons as one group (8px apart), the reason when only the export is
      // left (in full, or it goes into the menu), ล้างที่เลือก
      const ok = rowFits(inner, [count + 4, btns.reduce((a, b) => a + b, 0) + 8 * Math.max(0, btns.length - 1), ...whyW, clr.offsetWidth], gap);
      setFit((f) => (f === ok ? f : ok));
      if (ok) setMenu(false);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(bar);
    void document.fonts?.ready.then(check);
    return () => ro.disconnect();
  }, [idle, shape]);

  if (idle)
    return (
      <div className="bk-bar idle" role="region" aria-label="บริษัทที่เลือก">
        <span className="bk-n" aria-live="polite">{hint}</span>
      </div>
    );
  return (
    <>
      <div ref={barRef} className="bk-bar" role="region" aria-label="บริษัทที่เลือก">
        <span className="bk-n" aria-live="polite" title={fit ? undefined : long}>{fit ? long : selWord(view, n, cos.length, true)}</span>
        {fit ? (
          <span className="bk-acts">
            {shown.map(([a, label]) => (
              <button key={a} type="button" className="btn sm" onClick={() => run(a)}>{label}</button>
            ))}
          </span>
        ) : (
          <button ref={menuBtn} type="button" className="btn sm bk-menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            ทำรายการ
            <Chevron />
          </button>
        )}
        {fit && why && <span className="bk-why" title={why}>{why}</span>}
        <button ref={clearRef} type="button" className="quiet bk-clear" onClick={clear}>ล้างที่เลือก</button>
        {/* (the hidden copy the one-row choice is measured on) */}
        <span ref={measRef} className="bk-meas" aria-hidden="true">
          <span className="bk-mn">{long}</span>
          {shown.map(([a, label]) => (
            <span key={a} className="btn sm">{label}</span>
          ))}
          {why && <span className="bk-mw">{why}</span>}
        </span>
      </div>
      {menu && (
        <Pop anchor={menuBtn} onClose={() => setMenu(false)} label={long} kind="list" role="none" width={280} className="menu" align="start">
          {why && <p className="bk-mwhy">{why}</p>}
          <div role="menu" aria-label="ทำรายการกับบริษัทที่เลือก" className="fmenu bk-mlist" onKeyDown={menuKeys}>
            {shown.map(([a, label]) => (
              <button key={a} type="button" role="menuitem" className="fmi hv" onClick={() => run(a)}>
                <span className="fmi-l">{label}</span>
              </button>
            ))}
          </div>
        </Pop>
      )}
      {ask && cw && (
        <Modal title={cw.title} onClose={() => setAsk(null)} focus="dialog" width={460}>
          <p style={{ margin: 0, lineHeight: 1.6 }}>{cw.body}</p>
          <DialogActions>
            <button type="button" className="quiet" onClick={() => setAsk(null)}>ยกเลิก</button>
            {/* (a keyboard's Enter or Space clicks with detail 0; a pointer's click has its count) */}
            <button type="button" className="btn pri" onClick={(ev) => follow(ask === 'follow', ev.detail === 0)}>{cw.ok}</button>
          </DialogActions>
        </Modal>
      )}
      {owner && <OwnerDialog ids={cos} onClose={() => setOwner(false)} />}
    </>
  );
}

/** ตั้งผู้รับผิดชอบ for the picked companies: a name from the team list (or none); when some are looked
 *  after by someone else, whether to change those too. */
function OwnerDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const { engine: e, go } = useApp();
  useEngineVersion();
  const { say } = useSalesActs();
  const NONE = '\u0000none';
  const [name, setName] = useState('');
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const team = e.crm.team;
  const v = name === NONE ? '' : name;
  const sp = ownerSplit(ids, e.crm.owners, v);
  // a name: the empty ones, and the others' unless only the empty ones; none: every one that has a name
  const only = onlyEmpty && !!v;
  const willChange = !name ? 0 : v ? sp.none + (only ? 0 : sp.other) : sp.other;
  const accounts = e.role() != null;
  const save = () => {
    const r = e.setOwners(ids, v, only);
    onClose();
    say(ownerNote(v, r) + localWord(r.local), { ms: 6000 });
  };
  return (
    <Modal title="ตั้งผู้รับผิดชอบ" onClose={onClose} width={480}>
      <span className="t-sec">{ownerSub(ids.length, !!e.teamCfg)}</span>
      {team.length ? (
        <SelField
          style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}
          text="ผู้รับผิดชอบ"
          value={name}
          onChange={setName}
          placeholder="เลือกชื่อ"
          options={[...team.map((x) => ({ v: x, label: x, lead: <Av name={x} /> })), { v: NONE, label: 'ยังไม่มีผู้รับผิดชอบ', sub: 'ล้างชื่อเดิมออก' }]}
        />
      ) : (
        <Notice kind="info">
          {accounts ? 'ยังไม่มีรายชื่อทีม ผู้ดูแลระบบเพิ่มได้เมื่อสร้างบัญชีให้ทีม' : 'ยังไม่มีรายชื่อทีม เพิ่มได้ที่แท็บอัปเดตข้อมูล'}
          {!accounts && <button type="button" className="lnk" style={{ fontSize: 13 }} onClick={() => (onClose(), go('update'))}>ไปที่อัปเดตข้อมูล</button>}
        </Notice>
      )}
      {/* some are someone else's: change those too, or only fill the empty ones */}
      {!!v && sp.other > 0 && (
        <div role="radiogroup" aria-label="บริษัทที่มีผู้รับผิดชอบอยู่แล้ว" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          <label className="hv" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', padding: '4px 2px', borderRadius: 8 }}>
            <input type="radio" name="bk-own" checked={!onlyEmpty} onChange={() => setOnlyEmpty(false)} style={{ accentColor: 'var(--brand)' }} />
            {`ทุกบริษัทที่เลือก (เปลี่ยนจากคนอื่น ${fmtN(sp.other)} บริษัท)`}
          </label>
          <label className="hv" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', padding: '4px 2px', borderRadius: 8 }}>
            <input type="radio" name="bk-own" checked={onlyEmpty} onChange={() => setOnlyEmpty(true)} style={{ accentColor: 'var(--brand)' }} />
            {`เฉพาะที่ยังไม่มีผู้รับผิดชอบ (${fmtN(sp.none)} บริษัท)`}
          </label>
        </div>
      )}
      {!!name && sp.same > 0 && <span className="t-meta">{v ? `${v} ดูแลอยู่แล้ว ${fmtN(sp.same)} บริษัท` : `ยังไม่มีผู้รับผิดชอบอยู่แล้ว ${fmtN(sp.same)} บริษัท`}</span>}
      {willChange > BIG && <Notice kind="warn">{`จะเปลี่ยนผู้รับผิดชอบ ${fmtN(willChange)} บริษัท และบันทึกในประวัติของแต่ละบริษัท`}</Notice>}
      <DialogActions>
        <button type="button" className="quiet" onClick={onClose}>ยกเลิก</button>
        {team.length > 0 && <button type="button" className="btn pri" disabled={!name || willChange <= 0} onClick={save}>{willChange > 0 ? `บันทึก ${fmtN(willChange)} บริษัท` : 'บันทึก'}</button>}
      </DialogActions>
    </Modal>
  );
}
