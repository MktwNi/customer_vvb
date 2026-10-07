import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GccEngine } from './lib/engine';
import type { FeedKey, StageKey } from './lib/types';
import { EMPTY_FILTERS, type Filters } from './lib/search';
import { prefs, PREF } from './lib/storage';
import { beYear, type SalesFilter } from './lib/sales';

export type Tab = 'overview' | 'sales' | 'people' | 'search' | 'track' | 'plan' | 'map' | 'dedup' | 'update' | 'notes';
export type DetailTab = 'info' | 'cfo' | 'src' | 'crm';
/** `pid`: made from a person's page (the appointment is with them). */
export interface SchedReq { ids: number[]; taskId?: string; pid?: string }

export interface UIState {
  tab: Tab;
  f: Filters;
  page: number;
  sel: number | null;
  dTab: DetailTab;
  sched: SchedReq | null;
  // CFO dashboard cross-filter (Track tab)
  oInd: string; oProv: string; oExpM: string; oFy: string; oSt: string;
  // Plan tab
  calM: string; calDay: string; plFeed: FeedKey; plStage: StageKey | ''; plOwner: string; perDay: number; picked: Record<number, 1>; plLim: number;
  // Dedup tab
  ddF: 'pending' | 'auto' | 'decided' | 'all'; ddPage: number;
  // Sales Tracker
  slView: 'table' | 'dash' | 'closed' | 'log'; slYear: string; slF: Omit<SalesFilter, 'year'>; slCollapsed: Record<string, 1>;
  /** Open deal panel (deal id). */
  deal: string | null;
  /** "Add a customer by hand" dialog: open, and whether to also start a deal in the tracker. */
  addCust: { deal: boolean; section?: string; name?: string; link?: string; edit?: number } | null;
  /** "Send to Sales Tracker" dialog for these company ids. */
  sendIds: number[] | null;
  /** One-line result shown at the top of the Sales Tracker (e.g. after sending companies to it). */
  slNote: string;
  /** People (ผู้ติดต่อ): the person whose page is open, list search / view / page. */
  person: string | null; pQ: string; pView: 'all' | 'mine' | 'left'; pPage: number;
  /** "Add a person" dialog (at this company when `gid` is set). */
  addPerson: { gid?: number } | null;
  /** The record being worked on: open, or opened last (marked in its list so you keep your place). */
  last: { deal?: string; person?: string };
}

const TAB_KEYS: Tab[] = ['overview', 'sales', 'people', 'search', 'track', 'plan', 'map', 'dedup', 'update', 'notes'];

const initial = (): UIState => {
  const s = prefs.get<{ tab?: unknown; view?: unknown } | null>(PREF.ui, {}) || {};
  const tab = TAB_KEYS.includes(s.tab as Tab) ? (s.tab as Tab) : 'overview';
  const view = s.view === 'cert' ? 'cert' : 'co';
  return {
    tab,
    f: { ...EMPTY_FILTERS, view, sort: view === 'cert' ? 'ap' : 'default' },
    page: 0, sel: null, dTab: 'info', sched: null,
    oInd: '', oProv: '', oExpM: '', oFy: '', oSt: '',
    calM: '', calDay: '', plFeed: 'cfoSoon', plStage: '', plOwner: '', perDay: 5, picked: {}, plLim: 60,
    ddF: 'pending', ddPage: 0,
    slView: 'table', slYear: beYear(), slF: {}, slCollapsed: {}, deal: null, addCust: null, sendIds: null, slNote: '',
    person: null, pQ: '', pView: 'all', pPage: 0, addPerson: null, last: {},
  };
};

interface Ctx {
  engine: GccEngine;
  ui: UIState;
  set: (p: Partial<UIState> | ((s: UIState) => Partial<UIState>)) => void;
  /** Switch tab (scrolls to top). */
  go: (tab: Tab, p?: Partial<UIState>) => void;
  /** Apply search filters and jump to the search tab (page reset). */
  setF: (p: Partial<Filters>) => void;
  open: (id: number) => void;
  openSched: (o: SchedReq) => void;
  /** Change the reference date / soon window (recalculates everything, back to page 1). */
  setRef: (ref?: string | null, win?: number | null) => void;
}
const AppCtx = createContext<Ctx | null>(null);

/** Back to the top of the page: the content scrolls inside the app window on desktop, with the page on phones. */
export function scrollTop() {
  window.scrollTo(0, 0);
  document.getElementById('scroller')?.scrollTo(0, 0);
}

export function AppProvider({ engine, children }: { engine: GccEngine; children: ReactNode }) {
  const [ui, setUi] = useState(initial);
  const set = useCallback<Ctx['set']>(
    (p) =>
      setUi((s) => {
        const n = { ...s, ...(typeof p === 'function' ? p(s) : p) };
        // opening a deal or a person makes it the one marked in its list
        if (n.deal && n.deal !== s.deal) n.last = { ...n.last, deal: n.deal };
        if (n.person && n.person !== s.person) n.last = { ...n.last, person: n.person };
        return n;
      }),
    [],
  );
  useEffect(() => prefs.set(PREF.ui, { tab: ui.tab, view: ui.f.view }), [ui.tab, ui.f.view]);
  const value = useMemo<Ctx>(() => ({
    engine, ui, set,
    go: (tab, p) => {
      set({ tab, ...(p || {}) });
      scrollTop();
      // the new page takes the keyboard: Page Down / Space scroll it (on desktop only the content scrolls)
      requestAnimationFrame(() => document.getElementById('scroller')?.focus({ preventScroll: true }));
    },
    setF: (p) => {
      set((s) => ({ f: { ...s.f, ...p }, page: 0, tab: 'search' }));
      scrollTop();
    },
    open: (id) => {
      const c = engine.company(id);
      if (c) set({ sel: c.id, dTab: 'info' });
    },
    openSched: (o) => set({ sched: o }),
    setRef: (ref, win) => {
      engine.setRef(ref, win);
      set({ page: 0 });
    },
  }), [engine, ui, set]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}
/** Re-render on any engine change; returns the engine version (use it as a memo key). */
export function useEngineVersion() {
  const { engine } = useApp();
  return useSyncExternalStore(engine.subscribe, engine.getVersion);
}
export function useNarrow(px = 760) {
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => {
    const f = () => setN(window.innerWidth < px);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [px]);
  return n;
}
