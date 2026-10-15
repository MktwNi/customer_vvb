import { useApp } from '../state';
import { Help } from '../components/Help';
import { TABS, pageOk } from '../components/Sidebar';

const NAMES = new Map(TABS);

/** คู่มือการใช้งาน in the app: the help center, with "ไปที่หน้านี้" to the pages this account can open. */
export function HelpPage() {
  const { engine: e, go } = useApp();
  // "ไปที่หน้านี้" only to the pages this account has (lib/caps.ts: pageOk); the one-time team setup is
  // for whoever can manage the team (an admin, or anyone without accounts)
  return <Help onGo={(t) => go(t)} canGo={(t) => NAMES.has(t) && pageOk(e, t)} tabName={(t) => NAMES.get(t) || ''} setup={e.can('set.users')} />;
}
