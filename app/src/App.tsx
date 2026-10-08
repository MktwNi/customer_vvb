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
import { Users } from './tabs/Users';
import { AuthScreen, ChangePasswordDialog, LogoutDialog, ReLogin } from './components/Login';
import { commitFocus } from './components/useDialog';

function Loading({ msg }: { msg: string }) {
  const sk = { height: 120, borderRadius: 'var(--r-card)', background: '#E9EDF6' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} aria-busy="true">
      <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{msg}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
        <div style={{ ...sk, background: 'var(--hero)', opacity: 0.25 }} /><div style={sk} /><div style={sk} /><div style={sk} />
      </div>
      <div style={{ height: 320, borderRadius: 'var(--r-card)', background: '#E9EDF6' }} />
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
    e.load(); // (already started by main.tsx, so a gate is there from the first frame)
    // a team that signs in: the sign-in screen shows while this browser's data loads behind it
    if (e.auth) e.emit();
    return () => e.dispose();
  }, [e]);

  // invite link: #team=<web-app url> → a team with accounts shows its sign-in (or first-admin setup);
  // a team-code team prefills the team-sync card on the update tab, as before.
  // Only Apps Script web-app URLs are accepted, so a forged link can't collect the team code; a site
  // with a home team takes only that team's link (it belongs to one team).
  const [invited, setInvited] = useState(false);
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
      if (!isTeamUrl(url) || e.foreign(url)) return;
      setInvited(true);
      e.teamOpen(url).then((m) => {
        if (m === 'legacy' || m === '') set({ tab: 'update', sel: null }); // the team-code form (or why the link failed)
      });
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

  // the home team uses the team code and this browser has not joined it: its code form, on the update tab
  const joinHome = !!e.homeTeam && e.teamJoinUrl === e.homeTeam && !e.teamCfg && !e.auth;
  useEffect(() => {
    if (joinHome) set({ tab: 'update', sel: null });
  }, [joinHome, set]);

  const ready = e.ready;
  const auth = e.auth;
  const gate = auth === 'connect' || auth === 'login' || auth === 'setup' || auth === 'change' || auth === 'disabled';
  // once loaded, Page Down / Space scroll the page straight away (on desktop the content scrolls inside
  // the window, so it must hold the focus rather than the document)
  useEffect(() => {
    if (ready && !gate && !mobile && document.activeElement === document.body) document.getElementById('scroller')?.focus({ preventScroll: true });
  }, [ready, mobile, gate]);
  // ผู้ใช้และสิทธิ์ is for admins of a team that signs in; anyone else gets the overview
  const admin = e.role() === 'admin';
  useEffect(() => {
    if (ready && !auth && ui.tab === 'users' && !admin) set({ tab: 'overview' });
  }, [ready, auth, ui.tab, admin, set]);
  // account dialogs belong to the session they were opened in; the expired sign-in comes back for a new expiry
  useEffect(() => {
    if (auth && auth !== 'expired' && ui.acctDlg) set({ acctDlg: '' });
    if (auth !== 'expired' && ui.hideRelogin) set({ hideRelogin: false });
  }, [auth, ui.acctDlg, ui.hideRelogin, set]);

  // checking the home team, signed out, first-admin setup, a password to set, account disabled: a
  // screen instead of the app (the data keeps loading behind it, so the app is there right after signing in)
  if (gate) return <AuthScreen invited={invited} />;
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
                {ready && ui.tab === 'users' && (admin ? <Users /> : <Overview />)}
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
      {e.session && ui.acctDlg === 'passwd' && <ChangePasswordDialog onClose={() => set({ acctDlg: '' })} />}
      {e.session && ui.acctDlg === 'logout' && <LogoutDialog onClose={() => set({ acctDlg: '' })} />}
      {/* the session ended: sign in again over the app (open panels and typed text stay) */}
      {auth === 'expired' && !ui.hideRelogin && <ReLogin onClose={() => set({ hideRelogin: true })} />}
    </div>
  );
}
