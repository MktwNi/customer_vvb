import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp, useEngineVersion, useNarrow } from '../state';
import { fmtN } from '../lib/format';
import {
  BIG, bulkActs, confirmWords, createSel, followNote, followSplit, ownerNote, ownerSplit, pickedCos, pickedRows, selWord, tooManyWord, unfollowNote,
  type Row, type SelStore,
} from '../lib/bulk';
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
/** The picked keys of a store; re-renders the page that reads them, not the whole app. */
export function useSel(store: SelStore = searchSel) {
  return useSyncExternalStore(store.sub, store.get);
}

type Act = 'follow' | 'unfollow' | 'tracker' | 'plan' | 'owner' | 'csv';

/**
 * The bar over the search results while rows are picked (the owner's "เลือกทั้งหมด แล้วเลือกได้ว่าจะทำอะไร"):
 * how many, then what this account may do with them (lib/bulk.ts bulkActs): ติดตาม / เลิกติดตาม, ส่งเข้า
 * Sales Tracker (the send dialog), วางแผนติดต่อ (the appointment dialog, spread per day), ตั้งผู้รับผิดชอบ,
 * ส่งออก CSV, ล้างที่เลือก. It stays under the top of the page while the list scrolls. Acting on more than
 * BIG companies asks first; each action says what it did at the bottom, with a link to where they went.
 * Phones: the count, one "ทำรายการ" menu and ล้าง.
 */
export function BulkBar({ view, rows, sel, n }: { view: 'co' | 'cert'; rows: readonly Row[]; sel: ReadonlySet<number>; n: number }) {
  const { engine: e, set, openSched } = useApp();
  const ver = useEngineVersion();
  const narrow = useNarrow();
  const { say } = useSalesActs();
  const cos = useMemo(() => pickedCos(sel, rows), [sel, rows]);
  const watch = useMemo(() => new Set(e.crm.watch), [e, ver]);
  const fs = followSplit(cos, watch);
  const acts = bulkActs((c) => e.can(c), fs.on, cos.length);
  const [ask, setAsk] = useState<'follow' | 'unfollow' | null>(null);
  const [owner, setOwner] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const clear = () => searchSel.set({ key: searchSel.get().key, ids: new Set() });

  const follow = (on: boolean) => {
    setAsk(null);
    const r = e.setWatchMany(cos, on);
    if (on) say(followNote(r.changed, r.same), { ms: 8000, acts: r.changed ? [{ label: 'ดูรายการติดตาม', act: 'goTrack', primary: true }] : undefined });
    else say(unfollowNote(r.changed, r.same), { ms: 6000 });
  };
  const run = (a: Act) => {
    setMenu(false);
    if (a === 'follow') return fs.off > BIG ? setAsk('follow') : follow(true);
    if (a === 'unfollow') return fs.on > BIG ? setAsk('unfollow') : follow(false);
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
  const cw = ask ? confirmWords(ask, ask === 'follow' ? fs.off : fs.on, ask === 'follow' ? fs.on : fs.off) : null;

  return (
    <>
      <div className="bk-bar" role="region" aria-label="บริษัทที่เลือก">
        <span className="bk-n" aria-live="polite">{selWord(view, n, cos.length)}</span>
        {narrow ? (
          <button ref={menuBtn} type="button" className="btn sm bk-menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            ทำรายการ
            <Chevron />
          </button>
        ) : (
          <span className="bk-acts">
            {shown.map(([a, label]) => (
              <button key={a} type="button" className="btn sm" onClick={() => run(a)}>{label}</button>
            ))}
          </span>
        )}
        <button type="button" className="quiet bk-clear" onClick={clear}>ล้างที่เลือก</button>
        {acts.tooMany && <span className="bk-why">{tooManyWord(cos.length)}</span>}
      </div>
      {menu && (
        <Pop anchor={menuBtn} onClose={() => setMenu(false)} label={selWord(view, n, cos.length)} kind="list" role="none" width={260} className="menu" align="start">
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
            <button type="button" className="btn pri" onClick={() => follow(ask === 'follow')}>{cw.ok}</button>
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
    say(ownerNote(v, r), { ms: 6000 });
  };
  return (
    <Modal title="ตั้งผู้รับผิดชอบ" onClose={onClose} width={480}>
      <span className="t-sec">{`ให้ ${fmtN(ids.length)} บริษัทที่เลือก · ทั้งทีมเห็นชื่อนี้ในหน้าบริษัท และใช้กรองได้`}</span>
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
