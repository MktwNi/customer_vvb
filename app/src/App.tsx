import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useEngineVersion } from './state';
import { isTeamUrl } from './lib/teamSync';
import { Banners, TopBar } from './components/Header';
import { MOBILE_NAV, Sidebar, WIDE_NAV, useMedia } from './components/Sidebar';
import { PREF, prefs } from './lib/storage';
import { CompanyDrawer } from './components/CompanyDrawer';
import { ScheduleModal } from './components/ScheduleModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Overview } from './tabs/Overview';
import { Search } from './tabs/Search';
import { Track } from './tabs/Track';
import { Plan } from './tabs/Plan';
import { MapTab } from './tabs/MapTab';
import { Dedup } from './tabs/Dedup';
import { Update } from './tabs/Update';
import { Notes } from './tabs/Notes';
import { Sales } from './tabs/Sales';
import { DealPanel } from './components/DealPanel';
import { AddCustomer, SendToTracker } from './components/AddCustomer';
import { AddPerson, People } from './tabs/People';
import { commitFocus } from './components/useDialog';

function Loading({ msg }: { msg: string }) {
  const sk = { height: 64, borderRadius: 16, background: '#E6EAF4' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} aria-busy="true">
      <div style={{ height: 210, borderRadius: 28, background: 'linear-gradient(135deg,#1745B8,#1F5BD8)', opacity: 0.2 }} />
      <span style={{ fontSize: 14, color: '#475069' }}>{msg}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <div style={sk} /><div style={sk} /><div style={sk} /><div style={sk} />
      </div>
      <div style={{ height: 320, borderRadius: 22, background: '#E6EAF4' }} />
    </div>
  );
}

export default function App() {
  const { engine: e, ui, set } = useApp();
  useEngineVersion();
  const mobile = useMedia(MOBILE_NAV);
  const wide = useMedia(WIDE_NAV);
  // wide screens keep the full menu docked unless folded to the icon rail (remembered per browser)
  const [pinned, setPinned] = useState(() => prefs.getRaw(PREF.nav) !== 'rail');
  const docked = !mobile && wide && pinned;
  const [navOpen, setNavOpen] = useState(false); // full menu slid out (over the icon rail; phones: drawer)
  const open = navOpen && !docked;
  // a slid-out menu doesn't survive a change of layout (it would reappear when coming back)
  useEffect(() => setNavOpen(false), [mobile, wide]);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleNav = useCallback(() => {
    if (!wide || mobile) return setNavOpen((o) => !o);
    setNavOpen(false);
    setPinned((p) => {
      prefs.set(PREF.nav, p ? 'rail' : 'dock');
      return !p;
    });
  }, [wide, mobile]);

  useEffect(() => {
    e.load();
    return () => e.dispose();
  }, [e]);

  // invite link: #team=<web-app url> → prefill the team-sync card on the update tab.
  // Only Apps Script web-app URLs are accepted, so a forged link can't collect the team code.
  useEffect(() => {
    const onHash = () => {
      const m = /^#team=(.+)$/.exec(window.location.hash);
      if (!m) return;
      let url = '';
      try {
        url = decodeURIComponent(m[1]).trim();
      } catch {
        /* ignore */
      }
      history.replaceState(null, '', window.location.pathname + window.location.search);
      if (!isTeamUrl(url)) return;
      e.teamJoinUrl = url;
      set({ tab: 'update', sel: null });
      e.emit();
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [e, set]);

  // Escape closes the top layer only. The field being typed in is blurred first: the deal panel's
  // fields save when they lose focus, and closing without a blur would drop what was typed.
  const uiRef = useRef(ui);
  uiRef.current = ui;
  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      const s = uiRef.current;
      const p = s.sched ? { sched: null } : s.addCust ? { addCust: null } : s.addPerson ? { addPerson: null } : s.sendIds ? { sendIds: null } : s.sel != null ? { sel: null } : s.deal ? { deal: null } : null;
      if (!p) return;
      commitFocus();
      set(p);
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [set]);

  const ready = e.ready;
  // once loaded, Page Down / Space scroll the page straight away (on desktop the content scrolls inside
  // the window, so it must hold the focus rather than the document)
  useEffect(() => {
    if (ready && !mobile && document.activeElement === document.body) document.getElementById('scroller')?.focus({ preventScroll: true });
  }, [ready, mobile]);
  return (
    <div className={'shell' + (docked ? ' docked' : '')}>
      <div className="frame">
        <TopBar navOpen={open} docked={docked} onMenu={() => setNavOpen(true)} onToggle={toggleNav} />
        <div className="frame-body">
          <Sidebar open={open} docked={docked} mobile={mobile} onClose={closeNav} />
          <div className="content" id="scroller" tabIndex={-1} role="region" aria-labelledby="page-title">
            <Banners />
            {/* a new page fades in (keyed by the tab, so each switch plays it once) */}
            <main className="main page-in" key={ready ? ui.tab : 'loading'}>
              {!ready && <Loading msg={e.loadMsg} />}
              <ErrorBoundary resetKey={ui.tab}>
                {ready && ui.tab === 'overview' && <Overview />}
                {ready && ui.tab === 'sales' && <Sales />}
                {ready && ui.tab === 'people' && <People />}
                {ready && ui.tab === 'search' && <Search />}
                {ready && ui.tab === 'track' && <Track />}
                {ready && ui.tab === 'plan' && <Plan />}
                {ready && ui.tab === 'map' && <MapTab />}
                {ready && ui.tab === 'dedup' && <Dedup />}
                {ready && ui.tab === 'update' && <Update />}
                {ready && ui.tab === 'notes' && <Notes />}
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </div>
      {ready && ui.deal && (
        <ErrorBoundary resetKey={ui.deal}>
          <DealPanel />
        </ErrorBoundary>
      )}
      {ready && ui.sel != null && (
        <ErrorBoundary resetKey={String(ui.sel)}>
          <CompanyDrawer />
        </ErrorBoundary>
      )}
      {ready && ui.addCust && (
        <ErrorBoundary resetKey="addCust">
          <AddCustomer />
        </ErrorBoundary>
      )}
      {ready && ui.addPerson && (
        <ErrorBoundary resetKey="addPerson">
          <AddPerson />
        </ErrorBoundary>
      )}
      {ready && ui.sendIds && (
        <ErrorBoundary resetKey="send">
          <SendToTracker />
        </ErrorBoundary>
      )}
      {ready && ui.sched && (
        <ErrorBoundary resetKey="sched">
          <ScheduleModal />
        </ErrorBoundary>
      )}
    </div>
  );
}
