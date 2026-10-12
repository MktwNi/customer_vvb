import { useApp } from '../state';
import { Help } from '../components/Help';
import { TABS } from '../components/Sidebar';

const NAMES = new Map(TABS);

/** คู่มือการใช้งาน in the app: the help center, with "ไปที่หน้านี้" to the pages this account can open. */
export function HelpPage() {
  const { engine: e, go } = useApp();
  // ผู้ใช้และสิทธิ์ is for the admins of a team that signs in (App shows the overview to anyone else)
  const admin = e.role() === 'admin';
  return <Help onGo={(t) => go(t)} canGo={(t) => NAMES.has(t) && (t !== 'users' || admin)} tabName={(t) => NAMES.get(t) || ''} />;
}
