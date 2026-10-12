import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Tab } from '../state';
import { HELP_FAQ, HELP_GROUPS, HELP_TOPICS, QUICK_STARTS, searchHelp, type HelpFaq, type HelpTopic } from '../lib/helpContent';
import { CONFIG } from '../lib/constants';
import { PageHead, SectionHead } from './ui';
import { Icon } from './icons';
import { isTopDialog, useDialog } from './useDialog';

const GROUP_NAME: Record<string, string> = Object.fromEntries(HELP_GROUPS.map((g) => [g.id, g.name]));
const SUB = 'ในเว็บนี้ทำอะไรได้บ้าง และทำอย่างไร';

export interface HelpProps {
  /** Inside the app: "ไปที่หน้านี้" on a topic switches to its page. Left out (before signing in), no such buttons. */
  onGo?: (tab: Tab) => void;
  /** Whether this person can open that page (ผู้ใช้และสิทธิ์ is for admins). */
  canGo?: (tab: Tab) => boolean;
  /** The page's name, for the button's accessible name. */
  tabName?: (tab: Tab) => string;
  /** Over the sign-in screen: the overlay's bar holds the title. */
  overlay?: boolean;
}

/**
 * The help center (คู่มือการใช้งาน): a search, the table of contents (one card per group, its topics as
 * links), two quick starts, the topics by group, the FAQ and who to contact. Topics and questions open
 * one by one (closed at first: title and summary); what is open stays open while searching. Needs no
 * data, so it also works before signing in (HelpOverlay).
 */
export function Help({ onGo, canGo, tabName, overlay }: HelpProps) {
  const pfx = 'hp' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, true>>({});
  // where to go after the next render: scroll to it and give its button the keyboard
  const [jump, setJump] = useState<{ id: string; focus?: string; n: number } | null>(null);
  const res = useMemo(() => searchHelp(q), [q]);
  const searching = q.trim() !== '';

  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById(jump.id);
    if (!el) return;
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    document.getElementById(jump.focus || jump.id)?.focus({ preventScroll: true });
  }, [jump]);

  const tId = (id: string) => `${pfx}-t-${id}`;
  const fId = (id: string) => `${pfx}-f-${id}`;
  const gId = (id: string) => `${pfx}-g-${id}`;
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = { ...o };
      if (n[k]) delete n[k];
      else n[k] = true;
      return n;
    });
  /** Open a topic and bring it into view (from the contents, a quick start, or Enter in the search). */
  const goTopic = (id: string) => {
    setOpen((o) => ({ ...o, ['t:' + id]: true }));
    setJump({ id: tId(id), focus: tId(id) + '-btn', n: Date.now() });
  };
  const goFaq = (id: string) => {
    setOpen((o) => ({ ...o, ['f:' + id]: true }));
    setJump({ id: fId(id), focus: fId(id) + '-btn', n: Date.now() });
  };
  // (a section takes the keyboard itself: tabIndex -1, no ring, see .hp-sec in index.css)
  const goGroup = (id: string) => setJump({ id: gId(id), n: Date.now() });
  const toToc = () => setJump({ id: `${pfx}-toc`, n: Date.now() });

  const onSearchKey = (ev: ReactKeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (!searching) return;
      if (res.topics[0]) goTopic(res.topics[0].id);
      else if (res.faq[0]) goFaq(res.faq[0].id);
    } else if (ev.key === 'Escape' && q) {
      // clears the search first; a second Escape is for whatever holds the page (the overlay closes)
      ev.preventDefault();
      ev.stopPropagation();
      setQ('');
    }
  };

  const topicRow = (t: HelpTopic, meta?: boolean) => {
    const on = !!open['t:' + t.id];
    const id = tId(t.id);
    const goable = !!(onGo && t.tab && (!canGo || canGo(t.tab)));
    const page = t.tab && tabName ? tabName(t.tab) : '';
    return (
      <div key={t.id} className="hp-t" id={id}>
        <h3 className="hp-th">
          <button type="button" id={id + '-btn'} className="hp-tg hv" aria-expanded={on} aria-controls={id + '-body'} aria-describedby={id + '-sum'} onClick={() => toggle('t:' + t.id)}>
            <span className="hp-tg-tx">
              {meta && <span className="hp-tg-meta">{GROUP_NAME[t.group]}</span>}
              <span className="hp-tg-t">{t.title}</span>
              <span className="hp-tg-s" id={id + '-sum'}>{t.summary}</span>
            </span>
            <span className="hp-tg-w" aria-hidden="true">{on ? 'ซ่อน' : 'วิธีทำ'}</span>
          </button>
        </h3>
        <div className="hp-body" id={id + '-body'} hidden={!on}>
          <ol className="hp-steps">
            {t.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {t.tips.length > 0 && (
            <div className="hp-tips">
              <h4 className="hp-lbl">ควรรู้</h4>
              <ul>
                {t.tips.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="hp-tfoot">
            <span className="hp-role">ใครทำได้: {t.roles}</span>
            {goable && (
              <button type="button" className="lnk" aria-label={page ? `ไปที่หน้านี้ (${page})` : undefined} title={page ? `ไปที่หน้า ${page}` : undefined} onClick={() => onGo!(t.tab!)}>
                ไปที่หน้านี้
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const faqRow = (f: HelpFaq) => {
    const on = !!open['f:' + f.id];
    const id = fId(f.id);
    return (
      <div key={f.id} className="hp-t" id={id}>
        <h3 className="hp-th">
          <button type="button" id={id + '-btn'} className="hp-tg hv" aria-expanded={on} aria-controls={id + '-body'} onClick={() => toggle('f:' + f.id)}>
            <span className="hp-tg-tx">
              <span className="hp-tg-t">{f.q}</span>
            </span>
            <span className="hp-tg-w" aria-hidden="true">{on ? 'ซ่อน' : 'ดูคำตอบ'}</span>
          </button>
        </h3>
        <p className="hp-ans" id={id + '-body'} hidden={!on}>
          {f.a}
        </p>
      </div>
    );
  };

  const search = (
    <label className="hp-search">
      <Icon name="search" />
      <input
        type="search"
        className="fld"
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        onKeyDown={onSearchKey}
        placeholder="ค้นหาในคู่มือ เช่น แผนชำระ โทร"
        aria-label="ค้นหาในคู่มือ"
        aria-describedby={`${pfx}-count`}
        enterKeyHint="search"
        autoComplete="off"
      />
    </label>
  );
  const n = res.topics.length + res.faq.length;

  return (
    <div className={'hp' + (overlay ? ' in-ov' : '')}>
      {/* (over the sign-in screen the overlay's bar says the title and the line under it) */}
      <div className="pg-row hp-head">
        {!overlay && <PageHead title="คู่มือการใช้งาน" sub={SUB} />}
        {search}
      </div>

      {/* (always there, so a screen reader hears the count change; out of sight until there is a search) */}
      <div className={'hp-count' + (searching ? '' : ' sr-only')}>
        <span id={`${pfx}-count`} role="status">
          {searching ? (n ? `พบ ${res.topics.length} หัวข้อ${res.faq.length ? ` และ ${res.faq.length} คำถาม` : ''}` : `ไม่พบหัวข้อที่ตรงกับ “${q.trim()}”`) : ''}
        </span>
        {searching && (
          <button type="button" className="quiet" onClick={() => setQ('')}>
            ล้างคำค้น
          </button>
        )}
      </div>

      {searching ? (
        <>
          {res.topics.length > 0 && <div className="card hp-list">{res.topics.map((t) => topicRow(t, true))}</div>}
          {res.faq.length > 0 && (
            <section className="hp-sec" aria-labelledby={`${pfx}-faq-h`}>
              <SectionHead id={`${pfx}-faq-h`} title="คำถามที่พบบ่อย" />
              <div className="card hp-list">{res.faq.map(faqRow)}</div>
            </section>
          )}
          {!n && <p className="hp-none">ลองคำที่สั้นลง เช่น แผนชำระ โทร รหัสผ่าน หรือดูสารบัญหลังล้างคำค้น</p>}
        </>
      ) : (
        <>
          <section className="hp-sec" id={`${pfx}-toc`} tabIndex={-1} aria-labelledby={`${pfx}-toc-h`}>
            <SectionHead id={`${pfx}-toc-h`} title="สารบัญ" sub="กดชื่อหัวข้อเพื่ออ่านวิธีทำ" />
            <div className="hp-toc">
              {HELP_GROUPS.map((g) => (
                <div key={g.id} className="card hp-gc">
                  <h3 className="hp-gc-h">
                    <button type="button" className="hv-tx" onClick={() => goGroup(g.id)}>
                      {g.name}
                    </button>
                  </h3>
                  <p className="hp-gc-d">{g.desc}</p>
                  <ul className="hp-gc-l">
                    {HELP_TOPICS.filter((t) => t.group === g.id).map((t) => (
                      <li key={t.id}>
                        <button type="button" className="lnk" onClick={() => goTopic(t.id)}>
                          {t.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="hp-sec" aria-labelledby={`${pfx}-qs-h`}>
            <SectionHead id={`${pfx}-qs-h`} title="เริ่มต้นใช้งาน" sub="กดแต่ละขั้นเพื่ออ่านวิธีทำ" />
            <div className="hp-qs">
              {QUICK_STARTS.map((s) => (
                <div key={s.id} className="card hp-qc">
                  <h3 className="card-t">{s.title}</h3>
                  <p className="hp-qc-who">{s.who}</p>
                  <ol className="hp-qsteps">
                    {s.steps.map((st, i) => (
                      <li key={i}>
                        <button type="button" className="hp-qstep hv" onClick={() => goTopic(st.topic)}>
                          <span className="hp-n" aria-hidden="true">{i + 1}.</span>
                          <span>{st.text}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {s.devGuide && (
                    <p className="hp-dev">
                      ขั้นตอนละเอียดสำหรับผู้ตั้งค่าระบบและผู้พัฒนา:{' '}
                      <a className="lnk" href={CONFIG.teamGuideUrl} target="_blank" rel="noopener noreferrer">
                        team-sync/README.md
                      </a>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {HELP_GROUPS.map((g) => (
            <section key={g.id} className="hp-sec" id={gId(g.id)} tabIndex={-1} aria-labelledby={gId(g.id) + '-h'}>
              <SectionHead
                id={gId(g.id) + '-h'}
                title={g.name}
                sub={g.desc}
                link={
                  <button type="button" className="quiet" onClick={toToc}>
                    กลับไปสารบัญ
                  </button>
                }
              />
              <div className="card hp-list">{HELP_TOPICS.filter((t) => t.group === g.id).map((t) => topicRow(t))}</div>
            </section>
          ))}

          <section className="hp-sec" aria-labelledby={`${pfx}-faq-h`}>
            <SectionHead id={`${pfx}-faq-h`} title="คำถามที่พบบ่อย" />
            <div className="card hp-list">{HELP_FAQ.map(faqRow)}</div>
          </section>
        </>
      )}

      <p className="hp-end">ใช้งานไม่ได้ หรือไม่เจอคำตอบที่ต้องการ ติดต่อผู้ดูแลระบบของทีม</p>
    </div>
  );
}

/** The help center over the sign-in screens (no app shell, no data): a bar with the title and "ปิด". */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { focus: 'dialog' });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !isTopDialog(ref.current)) return;
      ev.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', kd);
    // the sign-in screen under it stays where it was
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', kd);
      html.style.overflow = prev;
    };
  }, []);
  return createPortal(
    <div ref={ref} className="hp-ov" role="dialog" aria-modal="true" aria-labelledby="hp-ov-t" tabIndex={-1}>
      <header className="hp-ov-bar">
        <div className="pg-h">
          <h1 id="hp-ov-t">คู่มือการใช้งาน</h1>
          <span className="pg-h-sub hp-ov-sub">{SUB}</span>
        </div>
        <button type="button" className="btn sm" onClick={onClose}>
          ปิด
        </button>
      </header>
      <div className="hp-ov-main">
        <Help overlay />
      </div>
    </div>,
    document.body,
  );
}
