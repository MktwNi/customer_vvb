import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useEngineVersion } from './state';
import { isTeamUrl } from './lib/teamSync';
import { Banners, TopBar } from './components/Header';
import { MOBILE_NAV, Sidebar, WIDE_NAV, pageOk, useMedia } from './components/Sidebar';
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
import { SalesMessages } from './components/SalesToast';
import { AddCustomer, SendToTracker } from './components/AddCustomer';
import { AddPerson, People } from './tabs/People';
import { Users } from './tabs/Users';
import { HelpPage } from './tabs/Help';
import { AuthScreen, ChangePasswordDialog, LogoutDialog, ReLogin } from './components/Login';
import { MyPerms } from './components/MyPerms';
import { RequestDialog } from './components/RequestDialog';
import { NotifySettings } from './components/NotifySettings';
import { QtCheckSheet } from './components/QtCheckSheet';
import { JointDialogs } from './components/JointQt';
import { commitFocus } from './components/useDialog';
import { docById, parseGo } from './lib/notify';

/** A link from an e-mail (#go=…) waiting to be opened: kept through signing in, in this tab only. */
const GO_KEY = 'gcc-go';
const goRead = (): (ReturnType<typeof parseGo> & { t: number }) | null => {
  try {
    return JSON.parse(sessionStorage.getItem(GO_KEY) || 'null');
  } catch {
    return null;
  }
};
const goDone = () => {
  try {
    sessionStorage.removeItem(GO_KEY);
  } catch {
    /* ignore */
  }
};

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
  const { engine: e, ui, set, go } = useApp();
  const version = useEngineVersion();
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

  // links in the notification e-mails: #go=qt&doc=…&s=… (a quotation to check), #go=deal&id=…, #go=plan&d=…,
  // #go=notify, #go=reqs (an admin's waiting permission requests), #go=cash&m=… (lib/notify.ts parseGo). The link is kept through signing in (this tab's
  // sessionStorage), then opened once its record is here (or a sync round found nothing); the hash is cleared.
  // It carries no authority: the check itself needs a signed-in checker.
  const [goN, setGoN] = useState(0);
  useEffect(() => {
    const onHash = () => {
      const g = parseGo(window.location.hash);
      if (!g) return;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      try {
        sessionStorage.setItem(GO_KEY, JSON.stringify({ ...g, t: Date.now() }));
      } catch {
        /* ignore: opened only now */
      }
      setGoN((n) => n + 1);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!e.ready || e.auth) return; // signed out, expired, setting a password: the link waits
    const g = goRead();
    if (!g) return;
    // a sync round ended after the link came: what is not here by now is not on the team either
    const synced = !e.teamCfg || (!!e.team.last && Date.parse(e.team.last) > g.t);
    const say = (text: string) => set((s) => ({ slToast: { text, ms: 6000, n: (s.slToast?.n || 0) + 1 } }));
    if (g.go === 'qt' || g.go === 'deal') {
      const doc = g.go === 'qt' ? docById(e.sales, g.doc) : undefined;
      const deal = g.go === 'qt' ? doc?.deal : g.id;
      if (deal && e.sales.deals[deal]) {
        goDone();
        set({ deal: e.can('view.sales') ? deal : null, ...(doc ? { qtCheck: doc.id, qtSig: g.go === 'qt' ? g.s : '' } : {}) });
      } else if (synced) {
        goDone();
        say(g.go === 'qt' ? 'ไม่พบใบเสนอราคาจากลิงก์ในอีเมล อาจถูกลบหรือแนบฉบับใหม่แล้ว' : 'ไม่พบงานจากลิงก์ในอีเมล อาจถูกลบไปแล้ว');
      }
      return;
    }
    goDone();
    if (g.go === 'plan') go('plan', g.d ? { calDay: g.d, calM: g.d.slice(0, 7) } : {});
    else if (g.go === 'notify') e.session && set({ acctDlg: 'notify' });
    else if (g.go === 'reqs') e.can('set.users') && go('users', { usersSec: 'req' });
    else if (g.go === 'cash') go('sales', { slView: 'cash' });
  }, [e, version, goN, set, go]);

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
  // a page this account may not open (ผู้ใช้และสิทธิ์ without managing users, Sales Tracker without ดู Sales
  // Tracker, …: lib/caps.ts) gives way to the overview, which every account has
  const allowed = pageOk(e, ui.tab);
  useEffect(() => {
    if (ready && !auth && !allowed) set({ tab: 'overview' });
  }, [ready, auth, allowed, set]);
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
            {/* a new page fades in (keyed by the tab, so each switch plays it once); the help center needs
                no data, so it shows (and stays, with what is open in it) while the data loads */}
            <main className="main page-in" key={ready || ui.tab === 'help' ? ui.tab : 'loading'}>
              {!ready && ui.tab !== 'help' && <Loading msg={e.loadMsg} />}
              <ErrorBoundary resetKey={ui.tab}>
                {ready && (ui.tab === 'overview' || !allowed) && <Overview />}
                {ready && allowed && ui.tab === 'sales' && <Sales />}
                {ready && allowed && ui.tab === 'people' && <People />}
                {ready && ui.tab === 'search' && <Search />}
                {ready && ui.tab === 'track' && <Track />}
                {ready && allowed && ui.tab === 'plan' && <Plan />}
                {ready && ui.tab === 'map' && <MapTab />}
                {ready && ui.tab === 'dedup' && <Dedup />}
                {ready && ui.tab === 'update' && <Update />}
                {ready && ui.tab === 'notes' && <Notes />}
                {ready && allowed && ui.tab === 'users' && <Users />}
                {ui.tab === 'help' && <HelpPage />}
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </div>
      {ready && ui.deal && e.can('view.sales') && (
        <ErrorBoundary resetKey={ui.deal}>
          <DealPanel />
        </ErrorBoundary>
      )}
      {/* the Sales Tracker's messages and its closing question, over the table and the deal panel alike */}
      {ready && <SalesMessages />}
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
      {e.session && ui.acctDlg === 'perms' && <MyPerms onClose={() => set({ acctDlg: '' })} />}
      {e.session && ui.acctDlg === 'request' && <RequestDialog key={ui.reqInit?.k || ''} onClose={() => set({ acctDlg: '', reqInit: null })} />}
      {e.session && ui.acctDlg === 'notify' && <NotifySettings onClose={() => set({ acctDlg: '' })} />}
      {/* the quotation check, over the deal panel (from its card, the bell or an e-mail link) */}
      {ready && ui.qtCheck && (
        <ErrorBoundary resetKey={'qt' + ui.qtCheck}>
          <QtCheckSheet />
        </ErrorBoundary>
      )}
      {/* a joint quotation's dialogs: make one, change its companies, close it (over the table and the panel) */}
      {ready && ui.jqDlg && (
        <ErrorBoundary resetKey="jq">
          <JointDialogs />
        </ErrorBoundary>
      )}
      {/* the session ended: sign in again over the app (open panels and typed text stay) */}
      {auth === 'expired' && !ui.hideRelogin && <ReLogin onClose={() => set({ hideRelogin: true })} />}
    </div>
  );
}
