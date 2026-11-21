import { BUILD } from '../lib/uat';

/**
 * On the UAT copy of the site (lib/uat.ts): says so on every screen, the sign-in too (home.css), with the
 * version it shows: the one to name when moving it to the real site (.github/workflows/promote-live.yml).
 */
export function UatBadge() {
  return (
    <div className="uat-badge" role="note">
      เว็บทดสอบ (UAT){BUILD ? ` · รุ่น ${BUILD}` : ''} · ข้อมูลที่บันทึกที่นี่แยกจากเว็บจริง
    </div>
  );
}
