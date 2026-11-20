/** On the UAT copy of the site (lib/uat.ts): says so on every screen, the sign-in too (home.css). */
export function UatBadge() {
  return (
    <div className="uat-badge" role="note">
      เว็บทดสอบ (UAT) · ข้อมูลที่บันทึกที่นี่แยกจากเว็บจริง
    </div>
  );
}
