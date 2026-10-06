import { useEffect } from 'react';
import { useApp, useEngineVersion } from './state';
import { Banners, Header } from './components/Header';
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

  useEffect(() => {
    e.load();
    return () => e.dispose();
  }, [e]);

  // invite link: #team=<web-app url> → prefill the team-sync card on the update tab
  useEffect(() => {
    const m = /^#team=(.+)$/.exec(window.location.hash);
    if (!m) return;
    try {
      e.teamJoinUrl = decodeURIComponent(m[1]);
    } catch {
      return;
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    set({ tab: 'update' });
    e.emit();
  }, [e, set]);

  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      set((s) => (s.sched ? { sched: null } : s.sel != null ? { sel: null } : {}));
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [set]);

  const ready = e.ready;
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <Banners />
      <main style={{ flex: 1, maxWidth: 1400, width: '100%', margin: '0 auto', padding: '24px 28px 64px', display: 'flex', flexDirection: 'column', gap: 26 }}>
        {!ready && <Loading msg={e.loadMsg} />}
        {ready && ui.tab === 'overview' && <Overview />}
        {ready && ui.tab === 'search' && <Search />}
        {ready && ui.tab === 'track' && <Track />}
        {ready && ui.tab === 'plan' && <Plan />}
        {ready && ui.tab === 'map' && <MapTab />}
        {ready && ui.tab === 'dedup' && <Dedup />}
        {ready && ui.tab === 'update' && <Update />}
        {ready && ui.tab === 'notes' && <Notes />}
      </main>
      {ready && ui.sel != null && <CompanyDrawer />}
      {ready && ui.sched && <ScheduleModal />}
    </div>
  );
}
