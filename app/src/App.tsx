import { useCallback, useEffect, useState } from 'react';
import { useApp, useEngineVersion } from './state';
import { isTeamUrl } from './lib/teamSync';
import { Banners, TopBar } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { CompanyDrawer } from './components/CompanyDrawer';
import { ScheduleModal } from './components/ScheduleModal';
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

function Loading({ msg }: { msg: string }) {
  const sk = { height: 64, borderRadius: 16, background: '#E6EAF4' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} aria-busy="true">
      <div style={{ height: 210, borderRadius: 28, background: 'linear-gradient(135deg,#0D2390,#1C3FE6)', opacity: 0.25 }} />
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
  const [navOpen, setNavOpen] = useState(false); // full menu shown (desktop: over the icon rail; phones: drawer)
  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleNav = useCallback(() => setNavOpen((o) => !o), []);

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

  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      set((s) => (s.sched ? { sched: null } : s.addCust ? { addCust: null } : s.sendIds ? { sendIds: null } : s.sel != null ? { sel: null } : s.deal ? { deal: null } : {}));
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [set]);

  const ready = e.ready;
  return (
    <div className="shell">
      <Sidebar open={navOpen} onToggle={toggleNav} onClose={closeNav} />
      <div className="content">
        <TopBar navOpen={navOpen} onMenu={() => setNavOpen(true)} />
        <Banners />
        <main className="main">
          {!ready && <Loading msg={e.loadMsg} />}
          {ready && ui.tab === 'overview' && <Overview />}
          {ready && ui.tab === 'sales' && <Sales />}
          {ready && ui.tab === 'search' && <Search />}
          {ready && ui.tab === 'track' && <Track />}
          {ready && ui.tab === 'plan' && <Plan />}
          {ready && ui.tab === 'map' && <MapTab />}
          {ready && ui.tab === 'dedup' && <Dedup />}
          {ready && ui.tab === 'update' && <Update />}
          {ready && ui.tab === 'notes' && <Notes />}
        </main>
      </div>
      {ready && ui.deal && <DealPanel />}
      {ready && ui.sel != null && <CompanyDrawer />}
      {ready && ui.addCust && <AddCustomer />}
      {ready && ui.sendIds && <SendToTracker />}
      {ready && ui.sched && <ScheduleModal />}
    </div>
  );
}
